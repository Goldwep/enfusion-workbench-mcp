/**
 * Project crawler — the public entry point for building the project-index.
 *
 * Discovers .gproj files under one or more source roots, classifies each
 * project (user / core / workshop), and orchestrates the resource and
 * reference scanners. Wires the two scanners via scanProject's onParsed
 * callback so each file is parsed exactly once per crawl.
 */

import Database from "better-sqlite3";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import { logger } from "../utils/logger.js";
import { recoverFromJournal } from "../refactor/byte-edit.js";
import { scanProject, type ScanResult } from "./resource-scan.js";
import { scanRefs } from "./ref-scan.js";
import type { ResourceSource } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** 16-hex-char GUID format used by Enfusion. */
const GUID_RE = /^[0-9A-Fa-f]{16}$/;

/** Directories never recursed into during .gproj discovery. */
const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist", ".emcp"]);

// ── Types ────────────────────────────────────────────────────────────────────

/** One source root to crawl. */
export interface CrawlSource {
  /** Filesystem path that contains addon subdirectories (each with a .gproj). */
  path: string;
  /** Classification — propagated into the `source` column for queries. */
  kind: ResourceSource;
}

/** Aggregated outcome of a full crawl. */
export interface CrawlResult {
  /** Number of .gproj files discovered across all sources. */
  projectsFound: number;
  /** Number successfully indexed (parsed + DB writes succeeded). */
  projectsIndexed: number;
  /** Aggregated file/resource counts (sum across all projects). */
  files: ScanResult;
  /** Aggregated reference counts. */
  refs: { totalExtracted: number; totalUnique: number };
  /** Per-project failures (one entry per .gproj that failed to index). */
  errors: { path: string; reason: string }[];
  /**
   * M16: `projects` rows whose `root_path` no longer exists on disk (or no
   * longer holds a .gproj) are deleted at the start of every crawl so the
   * FK CASCADE drops their resources / files / refs and the stale root stops
   * matching owning-project lookups.
   */
  staleProjectsRemoved: { id: string; root_path: string }[];
  /**
   * RBE-9: torn `atomicCommit` journals found under each source root and
   * each project root were replayed / rolled back before indexing.
   */
  journals: { recovered: number; errors: string[] };
}

/** Outcome of {@link pruneStaleProjects}. */
export interface PruneResult {
  removed: { id: string; root_path: string }[];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Crawl one or more source roots and populate the project-index.
 *
 * For each source:
 *   1. Find every .gproj file under `source.path` (recursive).
 *   2. Parse it, extract project metadata + the Dependencies block.
 *   3. Upsert into `projects` and `project_deps`.
 *   4. Call scanProject on the addon directory with an onParsed callback
 *      that drives scanRefs — single parse per file.
 *
 * Idempotent: re-crawling unchanged files skips them via the files-table
 * mtime/size check. Project + dep tables are upserted unconditionally so
 * stale dep changes get picked up on every crawl.
 */
export function crawl(db: Database.Database, sources: CrawlSource[]): CrawlResult {
  logger.info(`Starting project crawl: ${sources.length} source(s)`);

  const result: CrawlResult = {
    projectsFound: 0,
    projectsIndexed: 0,
    files: {
      filesScanned: 0,
      filesSkipped: 0,
      resourcesUpserted: 0,
      errors: [],
      unindexable: [],
    },
    refs: { totalExtracted: 0, totalUnique: 0 },
    errors: [],
    staleProjectsRemoved: [],
    journals: { recovered: 0, errors: [] },
  };

  // M16: drop projects whose root vanished BEFORE indexing, so a stale root
  // never wins an owning-project lookup during this crawl.
  result.staleProjectsRemoved = pruneStaleProjects(db).removed;

  for (const source of sources) {
    // RBE-9: replay/roll back any torn atomic-commit journal that a crashed
    // refactor left under the source root (legacy location) before we index
    // content that may be mid-write.
    mergeRecovery(result, recoverFromJournal(source.path));

    const gprojs = findGprojs(source.path);
    result.projectsFound += gprojs.length;

    for (const gprojPath of gprojs) {
      // RBE-9: journals anchor at the project root (`.git`, `.emcp`, or the
      // .gproj dir itself) — sweep it before scanning the project's files.
      mergeRecovery(result, recoverFromJournal(dirname(gprojPath)));
      try {
        indexOneProject(db, gprojPath, source.kind, result);
        result.projectsIndexed += 1;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        logger.debug(`crawl: failed to index ${gprojPath}: ${reason}`);
        result.errors.push({ path: gprojPath, reason });
      }
    }
  }

  // Recompute unique-ref count once at the end (cheaper than per-file).
  const uniqueRow = db
    .prepare("SELECT COUNT(*) AS c FROM resource_refs")
    .get() as { c: number };
  result.refs.totalUnique = uniqueRow.c;

  logger.info(
    `Crawl complete: ${result.projectsIndexed}/${result.projectsFound} projects, ` +
      `${result.files.filesScanned} files, ${result.refs.totalExtracted} refs, ` +
      `${result.errors.length} errors, ${result.staleProjectsRemoved.length} stale project(s) removed`,
  );

  return result;
}

/**
 * M16: delete every `projects` row whose `root_path` no longer exists on
 * disk or no longer contains a `.gproj` file. The v2/v3 FK CASCADEs then
 * drop the project's resources, files, and refs, so stale roots stop
 * matching `resolveOwningProject` and per-project counts stay honest.
 *
 * Disk files are never touched — this only prunes index rows. Safe to call
 * from any diagnostic path (project_index_status calls it too).
 */
export function pruneStaleProjects(db: Database.Database): PruneResult {
  const rows = db
    .prepare("SELECT id, root_path FROM projects")
    .all() as { id: string; root_path: string }[];
  const removed: { id: string; root_path: string }[] = [];
  const del = db.prepare("DELETE FROM projects WHERE id = ?");
  const tx = db.transaction((stale: { id: string; root_path: string }[]) => {
    for (const p of stale) del.run(p.id);
  });

  const stale = rows.filter((p) => !projectRootIsLive(p.root_path));
  if (stale.length > 0) {
    tx(stale);
    for (const p of stale) {
      removed.push(p);
      logger.info(`[crawl] removed stale project ${p.id} (root gone: ${p.root_path})`);
    }
  }
  return { removed };
}

/** True when `rootPath` is an existing directory holding at least one .gproj. */
function projectRootIsLive(rootPath: string): boolean {
  try {
    if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) return false;
    return readdirSync(rootPath).some((n) => n.toLowerCase().endsWith(".gproj"));
  } catch {
    return false;
  }
}

function mergeRecovery(
  result: CrawlResult,
  rec: { recovered: number; errors: string[] },
): void {
  result.journals.recovered += rec.recovered;
  // recoverFromJournal reports an unreadable rootDir as an error; a source
  // root that simply doesn't exist is expected (opportunistic discovery), so
  // only keep errors that name a journal file.
  for (const e of rec.errors) {
    if (e.startsWith("Could not read ")) continue;
    result.journals.errors.push(e);
  }
  if (rec.recovered > 0) {
    logger.warn(`[crawl] recovered ${rec.recovered} torn atomic-commit journal(s)`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively find every .gproj file under `root`. */
function findGprojs(root: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    /* skip — root may not exist, opportunistic discovery */
    return out;
  }

  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...findGprojs(full));
    } else if (entry.isFile() && entry.name.endsWith(".gproj")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Index one project: parse its .gproj, upsert projects + project_deps,
 * then run scanProject on its directory with scanRefs wired via onParsed.
 */
function indexOneProject(
  db: Database.Database,
  gprojPath: string,
  source: ResourceSource,
  result: CrawlResult,
): void {
  const content = readFileSync(gprojPath, "utf-8");
  let root: EnfusionNode;
  try {
    root = parse(content);
  } catch (e) {
    throw new Error(
      `parse .gproj failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const id = propertyAsString(root, "ID");
  const guid = propertyAsString(root, "GUID");
  const title = propertyAsString(root, "TITLE") ?? id ?? "(untitled)";

  if (!id) throw new Error("missing ID property in .gproj");
  if (!guid || !GUID_RE.test(guid)) throw new Error("missing or invalid GUID in .gproj");

  const projectRoot = dirname(gprojPath);
  const now = Date.now();
  const deps = extractDeps(root);

  // Upsert projects + project_deps in one transaction.
  const projectTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, guid, title, root_path, source, last_scan)
         VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         guid = excluded.guid,
         title = excluded.title,
         root_path = excluded.root_path,
         source = excluded.source,
         last_scan = excluded.last_scan`,
    ).run(id, guid.toUpperCase(), title, projectRoot, source, now);

    db.prepare("DELETE FROM project_deps WHERE project_id = ?").run(id);
    const insertDep = db.prepare(
      "INSERT INTO project_deps (project_id, dep_guid) VALUES (?, ?)",
    );
    for (const dep of deps) {
      insertDep.run(id, dep);
    }
  });
  projectTx();

  // Walk + scan the addon directory. onParsed hooks scanRefs so each file
  // is parsed exactly once. project_id wires the schema-v2 FK so per-project
  // queries (find_unused, list_resources, etc.) are precise.
  const scanResult = scanProject(db, projectRoot, source, {
    projectId: id,
    onParsed: (filePath, parsedRoot) => {
      const r = scanRefs(db, id, filePath, parsedRoot);
      result.refs.totalExtracted += r.refsExtracted;
    },
  });

  // Aggregate file totals into the crawl result.
  result.files.filesScanned += scanResult.filesScanned;
  result.files.filesSkipped += scanResult.filesSkipped;
  result.files.resourcesUpserted += scanResult.resourcesUpserted;
  result.files.errors.push(...scanResult.errors);
  result.files.unindexable.push(...scanResult.unindexable);
}

/** Extract dep GUIDs from a parsed .gproj's Dependencies block. */
function extractDeps(root: EnfusionNode): string[] {
  const out: string[] = [];
  for (const child of root.children) {
    if (child.type !== "Dependencies") continue;
    for (const val of child.values) {
      if (GUID_RE.test(val)) {
        out.push(val.toUpperCase());
      }
    }
  }
  return out;
}

/** Return a property's string value, or undefined if missing or a node. */
function propertyAsString(node: EnfusionNode, key: string): string | undefined {
  const prop = node.properties.find((p) => p.key === key);
  if (!prop) return undefined;
  return typeof prop.value === "string" ? prop.value : undefined;
}
