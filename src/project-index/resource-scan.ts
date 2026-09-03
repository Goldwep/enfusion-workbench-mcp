/**
 * Resource scanner for the project-index.
 *
 * Walks a project root, parses any Enfusion text files we recognize
 * (.gproj, .conf, .et, .layout, .ent) and upserts one row per resource
 * into the `resources` table. Per-file metadata (mtime + size) is tracked
 * in the `files` table so re-scans skip unchanged files.
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
import type { ResourceSource } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * File extensions we recognize as Enfusion text resources.
 *
 * L4-1 added `.emat` (materials), `.ptc` (particles), `.styles` (UI styles),
 * `.st` (string-table runtimes). All four use the same Enfusion text-container
 * grammar — the parser + ref-scan handle them transparently. Adding them to
 * this Set unlocks ~8 L4 tools as thin queries against the resulting index.
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
]);

/** Directories never recursed into during a project scan. */
const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist", ".emcp"]);

/** 16-hex-char GUID format used by Enfusion. */
const GUID_RE = /^[0-9A-Fa-f]{16}$/;

/**
 * Root types whose files never have their own GUID and shouldn't be
 * classified as scan errors when found without one (L2-5.2).
 *
 * `SubScene` is the canonical case — it's a `Parent "{GUID}path"` reference
 * wrapper, not a resource definition. Add more types here as they're
 * discovered (e.g. layers may behave similarly in some encodings).
 */
const UNINDEXABLE_ROOT_TYPES = new Set<string>(["SubScene"]);

// ── Types ────────────────────────────────────────────────────────────────────

/** Tally of work done by a single `scanProject` call. */
export interface ScanResult {
  /** Total candidate files visited (includes both skipped and re-parsed). */
  filesScanned: number;
  /** Files whose mtime + size matched the existing `files` row — not re-parsed. */
  filesSkipped: number;
  /** Resources upserted into the `resources` table. */
  resourcesUpserted: number;
  /**
   * Per-file failures: parse errors, or non-SubScene roots missing a GUID.
   * Files-table row still updated so re-scans don't retry the broken file.
   */
  errors: { path: string; reason: string }[];
  /**
   * Files that parse cleanly but inherently can't be indexed as resources —
   * e.g. SubScene files (`SubScene { Parent "{GUID}path" }`) have no own
   * GUID by design; they're a reference, not a resource. L2-5.2 separates
   * these from `errors` so scan reports don't conflate "broken file" with
   * "intentionally unindexable file".
   */
  unindexable: { path: string; reason: string }[];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Walk `projectRoot` recursively and upsert every recognized Enfusion text
 * resource into the project-index database.
 *
 * Counting convention:
 *   - `filesScanned` counts every candidate file visited (skipped + re-parsed).
 *   - `filesSkipped` is the subset where mtime + size matched the existing files
 *     row, so the file was NOT re-parsed.
 *   - `resourcesUpserted` is the count of files that were both re-parsed AND
 *     produced a valid resource row. A parse error or missing GUID does NOT
 *     count as upserted (but DOES still update the files row).
 *
 * Therefore for a fully-stale fresh scan: filesScanned === N, filesSkipped === 0,
 * resourcesUpserted === N (minus error count). For an unchanged re-scan:
 * filesScanned === N, filesSkipped === N, resourcesUpserted === 0. Touching one
 * file in an otherwise unchanged project yields filesScanned === N,
 * filesSkipped === N - 1, resourcesUpserted === 1.
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
     * Called once per successfully-parsed file, regardless of GUID validity.
     * Lets the crawler hook the ref-scanner without double-walking the tree.
     */
    onParsed?: (filePath: string, root: EnfusionNode) => void;
  },
): ScanResult {
  const projectId = options.projectId;
  logger.info(
    `Starting resource scan: ${projectRoot} (source=${source}, project=${projectId})`,
  );

  const result: ScanResult = {
    filesScanned: 0,
    filesSkipped: 0,
    resourcesUpserted: 0,
    errors: [],
    unindexable: [],
  };

  const upsertResource = db.prepare(
    `INSERT INTO resources
       (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed)
     VALUES (@guid, @file_path, @root_type, @class_name, @parent_inherit, @source, @project_id, @last_indexed)
     ON CONFLICT(guid) DO UPDATE SET
       file_path = excluded.file_path,
       root_type = excluded.root_type,
       class_name = excluded.class_name,
       parent_inherit = excluded.parent_inherit,
       source = excluded.source,
       project_id = excluded.project_id,
       last_indexed = excluded.last_indexed`,
  );

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
    "SELECT mtime, size FROM files WHERE project_id = ? AND path = ?",
  );

  for (const absPath of walk(projectRoot)) {
    result.filesScanned += 1;
    const relPath = relative(projectRoot, absPath).split("\\").join("/");

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

    const existing = selectFile.get(projectId, relPath) as
      | { mtime: number; size: number }
      | undefined;
    if (existing && existing.mtime === mtime && existing.size === size) {
      result.filesSkipped += 1;
      logger.debug(`skip unchanged: ${relPath}`);
      continue;
    }

    // Either new or changed — re-parse and upsert. Wrap the two upserts in a
    // transaction so a partial failure rolls back cleanly.
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

    let root: EnfusionNode | null = null;
    let parseError: string | null = null;
    try {
      root = parse(content);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
      logger.debug(`parse failed for ${relPath}: ${parseError}`);
      result.errors.push({ path: relPath, reason: `parse failed: ${parseError}` });
    }

    const now = Date.now();

    // Even on parse failure we still write the files row so subsequent scans
    // don't endlessly retry the broken file. The resource row is only upserted
    // when we successfully extracted a GUID.
    const guid = root ? extractGuid(root) : null;

    if (root && !guid) {
      // L2-5.2: SubScene files are inherently GUID-less (they're a Parent
      // pointer, not a resource definition). Classify as `unindexable`, not
      // an error. Known unindexable root types live in UNINDEXABLE_ROOT_TYPES.
      if (UNINDEXABLE_ROOT_TYPES.has(root.type)) {
        const reason = `${root.type} files reference a parent and have no own GUID`;
        logger.debug(`unindexable (by design): ${relPath} — ${reason}`);
        result.unindexable.push({ path: relPath, reason });
      } else {
        const reason = "no valid 16-hex GUID on root node";
        logger.debug(`${reason}: ${relPath}`);
        result.errors.push({ path: relPath, reason });
      }
    }

    const writeTx = db.transaction(() => {
      if (root && guid) {
        upsertResource.run({
          guid,
          file_path: relPath,
          root_type: root.type,
          class_name: root.className ?? null,
          parent_inherit: root.inheritance ?? null,
          source,
          project_id: projectId,
          last_indexed: now,
        });
        result.resourcesUpserted += 1;
      }
      upsertFile.run({
        project_id: projectId,
        path: relPath,
        mtime,
        size,
        hash: null,
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

  logger.info(
    `Resource scan complete: ${result.filesScanned} scanned, ` +
      `${result.filesSkipped} skipped, ${result.resourcesUpserted} upserted, ` +
      `${result.errors.length} errors`,
  );

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Iterate every file (recursively) under `root` whose extension is in
 * SCANNABLE_EXTENSIONS. Skips node_modules / .git / dist directories.
 *
 * Yields absolute paths. Inaccessible directories are silently skipped — this
 * is an opportunistic discovery loop, matching upstream's `findGproj` /
 * `listDirectory` style.
 */
function* walk(root: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    /* skip */
    return;
  }

  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (SCANNABLE_EXTENSIONS.has(ext)) {
        yield full;
      }
    }
  }
}

/**
 * Extract the resource's GUID from the parsed root node.
 *
 * Enfusion text files express the GUID in one of three places:
 *   1. The bare `node.id` (e.g., `SampleConfigClass "{77AA...}" { ... }` —
 *      the parser leaves the curly braces on, so we strip them here).
 *   2. A property named `GUID` (e.g., on a .gproj GameProject root).
 *   3. A property named `ID` (e.g., on a .et entity root).
 *
 * The first match that's a valid 16-hex GUID wins. Returns the GUID
 * normalized to uppercase, or `null` if none was found.
 */
function extractGuid(root: EnfusionNode): string | null {
  const candidates: (string | undefined)[] = [
    stripBraces(root.id),
    propertyAsString(root, "GUID"),
    propertyAsString(root, "ID"),
  ];

  for (const cand of candidates) {
    if (cand && GUID_RE.test(cand)) {
      return cand.toUpperCase();
    }
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
