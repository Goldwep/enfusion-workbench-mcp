/**
 * Shared recursive directory walker for extension-filtered file discovery.
 *
 * Used by `find-unused-clips.ts` (`.anm` + .agf/.asi/.agr/.conf scan) and
 * `material-find-unused-textures.ts` (`.edds` + `.emat` scan). Previously
 * each had its own copy of this walker — two copies that were starting to
 * drift on SKIP_DIRS.
 *
 * Design:
 *   - Pre-flight `statSync(root).isDirectory()` check so a missing or
 *     non-directory root returns `[]` rather than throwing.
 *   - `readdir(withFileTypes: true)` for one syscall per entry.
 *   - Best-effort error swallowing on per-entry stat/readdir failures —
 *     a broken symlink or permission-denied file shouldn't abort the walk.
 *   - Hard cap on the result set via `maxFiles` (default 50_000) to bound
 *     memory even when the walker is pointed at a pathologically large
 *     tree.
 *   - Forward-slashed, project-root-relative paths in the result.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

/** Directory names we never descend into — performance + correctness. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  ".vs",
  ".cache",
]);

/** Default upper bound on the number of files we'll collect in one walk. */
export const DEFAULT_MAX_FILES = 50_000;

/**
 * Walk `root` recursively and return relative, forward-slashed paths for
 * every file whose lowercased extension matches one of `extensions`.
 *
 * Returns `[]` if `root` doesn't exist or isn't a directory. Per-entry
 * stat/readdir errors are swallowed silently — the goal is "find what you
 * can, skip what you can't".
 *
 * Stops collecting once `maxFiles` paths have been gathered. Walks can
 * still descend further, but the result is truncated — protects against
 * runaway memory on hostile inputs.
 */
export function walkExtensions(
  root: string,
  extensions: ReadonlySet<string>,
  maxFiles: number = DEFAULT_MAX_FILES,
): string[] {
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    return [];
  }
  if (!isDir) return [];

  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= maxFiles) return;
    // Intentionally not type-annotated — TS picks the wrong readdirSync
    // overload when forced. Let inference work.
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (extensions.has(ext)) {
        out.push(relative(root, abs).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return out;
}
