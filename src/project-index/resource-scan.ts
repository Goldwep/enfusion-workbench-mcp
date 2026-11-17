/**
 * Resource scanner for the project-index.
 *
 * Walks a project root and writes one `resources` row per registered
 * resource FILE (schema v4). The resource GUID is the one `{GUID}path`
 * references use: the `Name` line of the file's `.meta` sidecar, or a
 * `.gproj`'s `GUID` property (see meta-guid.ts for why a root `ID` or node
 * id is never that GUID). Every file with a sidecar is a resource, text or
 * binary (.edds, .xob, ...); Enfusion text files we recognize (.gproj,
 * .conf, .et, .layout, .ent, ...) are also parsed so the crawler can scan
 * their references and the row carries the root type / class / parent.
 *
 * Per-file metadata (mtime + size, plus the sidecar's mtime + size in the
 * `hash` column) is tracked in the `files` table so re-scans skip unchanged
 * files, and a sidecar edit alone (a GUID change) still re-reads the file.
 *
 * Reconciliation (audit refactor-index-04): after the walk, `files`,
 * `resources` and `resource_refs` rows of this project whose file is no
 * longer on disk are deleted, so a file removed while the server was down
 * (or one the watcher does not watch) cannot linger as a ghost row.
 *
 * Parse errors are tolerated: the offending file is recorded in the
 * `errors` array of the returned ScanResult and its `files` row is still
 * updated, so a re-scan won't endlessly retry the same broken file.
 */

import Database from "better-sqlite3";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import { logger } from "../utils/logger.js";
import { readMetaGuid } from "./meta-guid.js";
import type { ResourceSource } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * File extensions we parse as Enfusion text (for references and the root
 * type / class / parent columns).
 *
 * L4-1 added `.emat` (materials), `.ptc` (particles), `.styles` (UI styles),
 * `.st` (string-table runtimes). All four use the same Enfusion text-container
 * grammar — the parser + ref-scan handle them transparently.
 */
const SCANNABLE_EXTENSIONS = new Set<string>([
  ".gproj",
  ".conf",
  ".et",
  ".layout",
  ".ent",
  ".emat",
  ".ptc",
  ".styles",
  ".st",
  // Audio Editor text files (W5): sound projects, signals, final mixers.
  ".acp",
  ".sig",
  ".afm",
]);

/** True when the index parses this path as Enfusion text (and reads its refs). */
export function isParsedTextPath(path: string): boolean {
  return SCANNABLE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Directories never recursed into during a project scan. */
const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist", ".emcp"]);

/** 16-hex-char GUID format used by Enfusion. */
const GUID_RE = /^[0-9A-Fa-f]{16}$/;

/**
 * Root types whose files never have their own GUID and shouldn't be
 * classified as scan errors when found without one (L2-5.2).
 *
 * `SubScene` is the canonical case — it's a `Parent "{GUID}path"` reference
 * wrapper, not a resource definition.
 */
const UNINDEXABLE_ROOT_TYPES = new Set<string>(["SubScene"]);

// ── Types ────────────────────────────────────────────────────────────────────

/** Tally of work done by a single `scanProject` call. */
export interface ScanResult {
  /** Total candidate files visited (includes both skipped and re-read). */
  filesScanned: number;
  /** Files whose mtime + size (and sidecar's) matched the `files` row — not re-read. */
  filesSkipped: number;
  /** Resources upserted into the `resources` table. */
  resourcesUpserted: number;
  /**
   * Per-file failures: parse errors, unreadable files, a .gproj without a
   * GUID. Files-table row still updated so re-scans don't retry the file.
   */
  errors: { path: string; reason: string }[];
  /**
   * Files that parse cleanly but are not resources: SubScene files
   * (`SubScene { Parent "{GUID}path" }`) by design, and text files with no
   * `.meta` sidecar naming a GUID (not registered with Workbench). L2-5.2
   * separates these from `errors` so scan reports don't conflate "broken
   * file" with "file that has no resource GUID".
   */
  unindexable: { path: string; reason: string }[];
  /** Files whose index rows were dropped because they are no longer on disk. */
  filesRemoved: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Walk `projectRoot` recursively and index every resource file.
 *
 * Counting convention:
 *   - `filesScanned` counts every candidate file visited (skipped + re-read).
 *   - `filesSkipped` is the subset whose file and sidecar stats matched the
 *     existing files row, so the file was NOT re-read.
 *   - `resourcesUpserted` is the count of re-read files that produced a
 *     resource row (a resource GUID was found).
 *   - `filesRemoved` counts files whose rows were deleted because they are
 *     gone from disk.
 *
 * @param db Open project-index database.
 * @param projectRoot Absolute path to the project (.gproj-containing folder).
 * @param source Where this project lives (user / core / workshop).
 */
export function scanProject(
  db: Database.Database,
  projectRoot: string,
  source: ResourceSource,
  options: {
    /**
     * Owning project's `id` (from .gproj). REQUIRED since schema v3: the
     * `files` and `resource_refs` rows are keyed by `(project_id, path)`, so
     * a `projects` row with this id must already exist (FK, ON DELETE CASCADE).
     */
    projectId: string;
    /**
     * Called once per successfully-parsed text file, regardless of GUID.
     * Lets the crawler hook the ref-scanner without double-walking the tree.
     */
    onParsed?: (filePath: string, root: EnfusionNode) => void;
  },
): ScanResult {
  const projectId = options.projectId;
  logger.info(`Starting resource scan: ${projectRoot} (source=${source}, project=${projectId})`);

  const result: ScanResult = {
    filesScanned: 0,
    filesSkipped: 0,
    resourcesUpserted: 0,
    errors: [],
    unindexable: [],
    filesRemoved: 0,
  };

  // Schema v4: one row per file. Re-indexing a file whose GUID changed
  // replaces its row instead of leaving the old GUID behind (refactor-index-03).
  const upsertResource = db.prepare(
    `INSERT INTO resources
       (guid, file_path, root_type, class_name, parent_inherit, entity_id, source, project_id, last_indexed)
     VALUES (@guid, @file_path, @root_type, @class_name, @parent_inherit, @entity_id, @source, @project_id, @last_indexed)
     ON CONFLICT(project_id, file_path) DO UPDATE SET
       guid = excluded.guid,
       root_type = excluded.root_type,
       class_name = excluded.class_name,
       parent_inherit = excluded.parent_inherit,
       entity_id = excluded.entity_id,
       source = excluded.source,
       last_indexed = excluded.last_indexed`,
  );
  const deleteResource = db.prepare(
    "DELETE FROM resources WHERE project_id = ? AND file_path = ?",
  );
  const deleteRefs = db.prepare(
    "DELETE FROM resource_refs WHERE project_id = ? AND source_file = ?",
  );
  const deleteFile = db.prepare("DELETE FROM files WHERE project_id = ? AND path = ?");

  const upsertFile = db.prepare(
    `INSERT INTO files
       (project_id, path, mtime, size, hash, source, last_indexed)
     VALUES (@project_id, @path, @mtime, @size, @hash, @source, @last_indexed)
     ON CONFLICT(project_id, path) DO UPDATE SET
       mtime = excluded.mtime,
       size = excluded.size,
       hash = excluded.hash,
       source = excluded.source,
       last_indexed = excluded.last_indexed`,
  );

  const selectFile = db.prepare(
    "SELECT mtime, size, hash FROM files WHERE project_id = ? AND path = ?",
  );

  const walkState: WalkState = { seen: new Set<string>(), unreadableDirs: [] };

  for (const cand of walk(projectRoot, walkState)) {
    result.filesScanned += 1;
    const absPath = cand.absPath;
    const relPath = toRel(projectRoot, absPath);
    walkState.seen.add(relPath);

    let stat;
    try {
      stat = statSync(absPath);
    } catch (e) {
      logger.debug(`stat failed for ${absPath}: ${e}`);
      result.errors.push({
        path: relPath,
        reason: `stat failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    const mtime = stat.mtimeMs;
    const size = stat.size;
    // The sidecar's stats ride in `hash`, so a .meta-only edit re-reads the file.
    const metaAbs = `${absPath}.meta`;
    const metaSig = cand.hasMeta ? statSignature(metaAbs) : null;

    const existing = selectFile.get(projectId, relPath) as
      | { mtime: number; size: number; hash: string | null }
      | undefined;
    if (
      existing &&
      existing.mtime === mtime &&
      existing.size === size &&
      (existing.hash ?? null) === metaSig
    ) {
      result.filesSkipped += 1;
      logger.debug(`skip unchanged: ${relPath}`);
      continue;
    }

    const isGproj = extname(absPath).toLowerCase() === ".gproj";
    const isText = isParsedTextPath(absPath);

    let root: EnfusionNode | null = null;
    if (isText) {
      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch (e) {
        logger.debug(`read failed for ${relPath}: ${e}`);
        result.errors.push({
          path: relPath,
          reason: `read failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
      try {
        root = parse(content);
      } catch (e) {
        const parseError = e instanceof Error ? e.message : String(e);
        logger.debug(`parse failed for ${relPath}: ${parseError}`);
        result.errors.push({ path: relPath, reason: `parse failed: ${parseError}` });
      }
    }

    let guid: string | null = null;
    if (isGproj) {
      guid = root ? projectGuid(root) : null;
    } else if (cand.hasMeta) {
      guid = readMetaGuid(metaAbs);
    }

    if (!guid && root) {
      if (UNINDEXABLE_ROOT_TYPES.has(root.type)) {
        const reason = `${root.type} files reference a parent and have no own GUID`;
        logger.debug(`unindexable (by design): ${relPath} — ${reason}`);
        result.unindexable.push({ path: relPath, reason });
      } else if (isGproj) {
        result.errors.push({ path: relPath, reason: "no valid 16-hex GUID property on GameProject" });
      } else {
        const reason = cand.hasMeta
          ? '.meta sidecar has no Name "{GUID}path" line'
          : "no .meta sidecar (not registered with Workbench), so no resource GUID";
        logger.debug(`unindexable: ${relPath} — ${reason}`);
        result.unindexable.push({ path: relPath, reason });
      }
    }

    const now = Date.now();
    const writeTx = db.transaction(() => {
      if (guid) {
        upsertResource.run({
          guid,
          file_path: relPath,
          root_type: root ? root.type : extname(absPath).toLowerCase(),
          class_name: root?.className ?? null,
          parent_inherit: root?.inheritance ?? null,
          entity_id: root ? entityId(root) : null,
          source,
          project_id: projectId,
          last_indexed: now,
        });
        result.resourcesUpserted += 1;
      } else {
        // No GUID any more (sidecar removed, parse failed): no stale row.
        deleteResource.run(projectId, relPath);
      }
      // A file that no longer parses keeps no refs from an earlier parse.
      if (!root) deleteRefs.run(projectId, relPath);
      upsertFile.run({
        project_id: projectId,
        path: relPath,
        mtime,
        size,
        hash: metaSig,
        source,
        last_indexed: now,
      });
    });

    try {
      writeTx();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug(`db write failed for ${relPath}: ${msg}`);
      result.errors.push({ path: relPath, reason: `db write failed: ${msg}` });
    }

    // Notify caller of successful parse (independent of GUID validity).
    // Used by the crawler to drive the ref-scanner without a second walk.
    if (root && options?.onParsed) {
      try {
        options.onParsed(relPath, root);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.debug(`onParsed callback failed for ${relPath}: ${msg}`);
        result.errors.push({ path: relPath, reason: `onParsed failed: ${msg}` });
      }
    }
  }

  result.filesRemoved = dropVanished(db, projectId, walkState, {
    deleteFile,
    deleteResource,
    deleteRefs,
  });
  if (result.filesRemoved > 0) {
    logger.info(
      `[scan] dropped index rows for ${result.filesRemoved} file(s) gone from ${projectRoot}`,
    );
  }

  logger.info(
    `Resource scan complete: ${result.filesScanned} scanned, ` +
      `${result.filesSkipped} skipped, ${result.resourcesUpserted} upserted, ` +
      `${result.filesRemoved} removed, ${result.errors.length} errors`,
  );

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface WalkState {
  /** Relative paths of every candidate yielded so far. */
  seen: Set<string>;
  /** Relative paths of directories readdir failed on ("" = the root). */
  unreadableDirs: string[];
}

interface Candidate {
  absPath: string;
  /** A `<name>.meta` sidecar sits next to the file. */
  hasMeta: boolean;
}

function toRel(projectRoot: string, absPath: string): string {
  return relative(projectRoot, absPath).split("\\").join("/");
}

/**
 * Delete the `files` / `resources` / `resource_refs` rows of `projectId`
 * whose path the walk did not see. Paths under a directory the walk could
 * not read are kept: a transient EBUSY must not wipe them. Returns the
 * number of paths dropped.
 */
function dropVanished(
  db: Database.Database,
  projectId: string,
  state: WalkState,
  stmts: {
    deleteFile: Database.Statement;
    deleteResource: Database.Statement;
    deleteRefs: Database.Statement;
  },
): number {
  const known = db
    .prepare(
      `SELECT path AS p FROM files WHERE project_id = ?
       UNION SELECT file_path FROM resources WHERE project_id = ?
       UNION SELECT source_file FROM resource_refs WHERE project_id = ?`,
    )
    .all(projectId, projectId, projectId) as { p: string }[];
  const vanished = known
    .map((r) => r.p)
    .filter(
      (p) =>
        !state.seen.has(p) &&
        !state.unreadableDirs.some((d) => d === "" || p.startsWith(`${d}/`)),
    );
  if (vanished.length === 0) return 0;
  const tx = db.transaction((paths: string[]) => {
    for (const p of paths) {
      stmts.deleteFile.run(projectId, p);
      stmts.deleteResource.run(projectId, p);
      stmts.deleteRefs.run(projectId, p);
    }
  });
  tx(vanished);
  return vanished.length;
}

/**
 * Iterate every resource candidate under `root`: Enfusion text files we
 * parse, plus any other file that has a `.meta` sidecar. Sidecars themselves
 * are not candidates. Skips node_modules / .git / dist / .emcp. Directories
 * readdir fails on are recorded in `state.unreadableDirs`.
 */
function* walk(root: string, state: WalkState, dir: string = root): Generator<Candidate> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    state.unreadableDirs.push(toRel(root, dir));
    return;
  }
  const fileNames = new Set(
    entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase()),
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(root, state, full);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".meta")) continue;
      const hasMeta = fileNames.has(`${lower}.meta`);
      if (hasMeta || SCANNABLE_EXTENSIONS.has(extname(lower))) {
        yield { absPath: full, hasMeta };
      }
    }
  }
}

/** `mtime:size` of a file, or null when it cannot be stat'd. */
function statSignature(abs: string): string | null {
  try {
    const s = statSync(abs);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}

/** A `.gproj`'s project GUID (its `GUID` property), uppercase, or null. */
function projectGuid(root: EnfusionNode): string | null {
  const g = propertyAsString(root, "GUID");
  return g && GUID_RE.test(g) ? g.toUpperCase() : null;
}

/**
 * The root's own id: the `ID` property of an `.et` entity root, else a
 * braced node id (`Class "{ID}" {`). This is an entity / object id, never
 * the resource GUID.
 */
function entityId(root: EnfusionNode): string | null {
  for (const cand of [propertyAsString(root, "ID"), stripBraces(root.id)]) {
    if (cand && GUID_RE.test(cand)) return cand.toUpperCase();
  }
  return null;
}

/** Strip the leading `{` and trailing `}` from an Enfusion-style GUID, if present. */
function stripBraces(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1);
  return s;
}

/** Return a property's string value, or undefined if it's missing or a node. */
function propertyAsString(node: EnfusionNode, key: string): string | undefined {
  const prop = node.properties.find((p) => p.key === key);
  if (!prop) return undefined;
  return typeof prop.value === "string" ? prop.value : undefined;
}
