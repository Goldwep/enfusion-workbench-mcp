/**
 * Project file watcher.
 *
 * Wraps chokidar so live edits to a project (gproj/conf/et/layout/ent files)
 * trigger an incremental re-crawl of the project root. Deletes drop the
 * file's rows from resources / resource_refs / files.
 *
 * Per CONVENTIONS adoption notes: callback-based class (no EventEmitter),
 * inline debounce (no debounce lib), and a SIGINT handler is the caller's
 * responsibility so we don't fight other shutdown owners.
 */

import chokidar, { type FSWatcher } from "chokidar";
import { relative } from "node:path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";
import { crawl } from "../project-index/crawler.js";
import { resolveOwningProject } from "../project-index/project-index.js";
import type { ResourceSource } from "../project-index/types.js";

/** File extensions we react to. Mirrors scanProject's SCANNABLE_EXTENSIONS. */
const WATCHED_EXTENSIONS = [
  ".gproj",
  ".conf",
  ".et",
  ".layout",
  ".ent",
  ".emat",
  ".ptc",
  ".styles",
  ".st",
];

/**
 * Debounce window in milliseconds. Workbench atomic saves can cascade across
 * several files within a few tens of ms; coalesce them into one flush.
 */
const DEBOUNCE_MS = 100;

/** Directories never recursed into by the watcher. */
const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist", ".emcp"]);

export class ProjectWatcher {
  private watcher: FSWatcher | null = null;
  private pendingTimer: NodeJS.Timeout | null = null;
  private readonly pending: Set<string> = new Set();

  /**
   * @param db Open project-index database. Caller owns the lifecycle.
   * @param projectRoot Absolute path to the project (.gproj-containing folder).
   * @param source Where this project lives — propagated into source columns.
   */
  constructor(
    private readonly db: Database.Database,
    private readonly projectRoot: string,
    private readonly source: ResourceSource,
  ) {}

  /** Begin watching. Safe to call once. Idempotent if already started. */
  start(): void {
    if (this.watcher !== null) return;
    logger.info(`[watcher] starting on ${this.projectRoot} (source=${this.source})`);

    this.watcher = chokidar.watch(this.projectRoot, {
      persistent: true,
      // Don't replay existing files as add events at startup.
      ignoreInitial: true,
      ignored: (watchedPath) => isIgnoredPath(watchedPath),
    });

    this.watcher.on("add", (path) => this.handleChange(path));
    this.watcher.on("change", (path) => this.handleChange(path));
    this.watcher.on("unlink", (path) => this.handleUnlink(path));
    // L6: watcher failures (EPERM on a locked dir, ENOSPC inotify limits,
    // a root that vanished) used to be debug-only — invisible in a normal
    // log. Surface at warn with the watched root so a silently-dead watcher
    // is diagnosable.
    this.watcher.on("error", (err) =>
      logger.warn(
        `[watcher] error on ${this.projectRoot}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  /**
   * Stop watching. Cancels any pending debounce. Safe to call multiple
   * times. Returns a promise that resolves once chokidar releases its file
   * handles (matters on Windows).
   */
  async stop(): Promise<void> {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pending.clear();
    if (this.watcher !== null) {
      const w = this.watcher;
      this.watcher = null;
      try {
        await w.close();
      } catch (e) {
        logger.debug(`[watcher] close failed: ${e}`);
      }
    }
  }

  private handleChange(absPath: string): void {
    if (!hasWatchedExtension(absPath)) return;
    this.pending.add(absPath);
    this.scheduleFlush();
  }

  private handleUnlink(absPath: string): void {
    if (!hasWatchedExtension(absPath)) return;

    // Rows are stored with file_path RELATIVE to the OWNING project's root
    // (dirname of its .gproj), which is NOT necessarily the watched source
    // root: an addon can live in a subfolder. Keying the delete off the
    // source root would miss every nested addon's rows (WATCH-1/3), leaking
    // resources / files / resource_refs entries forever.
    //
    // Resolve the owning project the same way the crawler assigns it, then
    // compute the relPath off THAT root and scope every delete by its id
    // (schema v3, C2): two addons that both ship `Prefabs/Foo.et` must not
    // lose each other's rows when one copy is deleted.
    const owner = resolveOwningProject(this.db, absPath);
    if (owner === null) {
      // No indexed project contains this file → nothing of ours to delete.
      logger.debug(`[watcher] unlink ${absPath}: no owning project indexed, ignoring`);
      return;
    }
    const relPath = relative(owner.root_path, absPath).split("\\").join("/");
    logger.debug(`[watcher] unlink ${relPath} (project=${owner.id}, root=${owner.root_path})`);
    const deleteTx = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM resources WHERE project_id = ? AND file_path = ?")
        .run(owner.id, relPath);
      this.db
        .prepare("DELETE FROM resource_refs WHERE project_id = ? AND source_file = ?")
        .run(owner.id, relPath);
      this.db
        .prepare("DELETE FROM files WHERE project_id = ? AND path = ?")
        .run(owner.id, relPath);
    });
    try {
      deleteTx();
    } catch (e) {
      logger.warn(`[watcher] delete failed for ${relPath} (project=${owner.id}): ${e}`);
    }

    // A deleted .gproj means the project itself may be gone. Schedule a
    // re-crawl so M16's stale-project prune (CASCADE) runs promptly instead
    // of waiting for the next unrelated change.
    if (absPath.toLowerCase().endsWith(".gproj")) {
      this.pending.add(absPath);
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.flush();
    }, DEBOUNCE_MS);
  }

  /**
   * Flush pending changes by re-crawling the project root. The files-table
   * mtime/size check inside scanProject makes this incremental: only the
   * actually-changed files re-parse. Re-walking the directory tree is cheap
   * (microseconds for small projects, ~tens of ms for large ones).
   *
   * Future optimization: scan only `pending` files instead of the whole root.
   */
  private flush(): void {
    const changedCount = this.pending.size;
    this.pending.clear();
    if (changedCount === 0) return;

    logger.debug(`[watcher] flush ${changedCount} change(s) — re-crawling ${this.projectRoot}`);
    try {
      crawl(this.db, [{ path: this.projectRoot, kind: this.source }]);
    } catch (e) {
      logger.warn(
        `[watcher] crawl failed for ${this.projectRoot}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasWatchedExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return WATCHED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isIgnoredPath(watchedPath: string): boolean {
  // chokidar passes directory and file paths through this matcher. We only
  // need to filter out junk dirs; file-level extension filtering happens in
  // the event handlers.
  const parts = watchedPath.split(/[\\/]/);
  return parts.some((p) => SKIP_DIRS.has(p));
}
