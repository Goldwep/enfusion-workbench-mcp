/**
 * `animation_find_unused_clips` — pure logic.
 *
 * Find `.anm` clip files on disk that aren't referenced by any AGF / ASI / AGR
 * / character `.conf`. Pure-FS, read-only — outputs the set-diff between the
 * `.anm` files walked from disk and those referenced by the project's
 * animation graph + character configs.
 *
 * `.anm` files don't get indexed by `ProjectIndex` directly. We rely on a
 * recursive disk walk (mirroring `walkExtensions` in
 * `material-find-unused-textures.ts`) for the disk side, and a regex sweep
 * over the union of AGF/ASI/AGR/`.conf` raw-text contents on the reference
 * side. Regex matches `{16-hex-GUID}<path>.anm` resource refs — robust to
 * parse failures in malformed source files.
 *
 * Workshop projects are excluded by default — modders usually want to scan
 * their own user-mod content. Pass `includeWorkshop: true` to also walk
 * workshop project roots that show up in the ProjectIndex.
 */

import { statSync } from "node:fs";
import { join } from "node:path";
import { readTextFileBounded } from "../utils/safe-read.js";
import { walkExtensions } from "../utils/walk-extensions.js";

// Re-export for backwards-compat with existing test imports.
export { walkExtensions };

/** File extensions that may carry `.anm` references in raw text. */
export const REFERENCING_EXTENSIONS: ReadonlySet<string> = new Set([
  ".agf",
  ".asi",
  ".agr",
  ".conf",
]);

/** Captures `{16-hex}<path>.anm` resource refs from raw text. */
const ANM_REF_RE = /\{([0-9A-Fa-f]{16})\}([^"\s}]*\.anm)/gi;

/** Per-file metadata for the `unused.anm` list (size in bytes + ISO mtime). */
export interface UnusedAnmRow {
  /** Project-relative, forward-slashed path of the unused .anm. */
  relPath: string;
  /** File size in bytes. */
  size: number;
  /** ISO-8601 last-modified timestamp (file mtime). */
  lastModified: string;
}

export interface FindUnusedClipsResult {
  /** Total `.anm` files discovered on disk (after de-dup across roots). */
  totalOnDisk: number;
  /** Count of `.anm` paths referenced by any AGF / ASI / AGR / character .conf. */
  referencedCount: number;
  /** The unused list — `.anm` files on disk not referenced by anything we scanned. */
  unused: UnusedAnmRow[];
  /** Number of referencing files (AGF/ASI/AGR/.conf) we successfully read + scanned. */
  filesScanned: number;
}

/**
 * Extract every `.anm` path referenced from raw file text. Strips the
 * `{GUID}` prefix so the result is a bare relative path, lowercased + forward-
 * slashed for clean set-diff against the disk-walk output.
 */
export function extractAnmRefs(content: string): Set<string> {
  const refs = new Set<string>();
  // Each call resets lastIndex — regex is module-scoped + sticky-safe.
  ANM_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANM_REF_RE.exec(content)) !== null) {
    refs.add(m[2].toLowerCase().split("\\").join("/"));
  }
  return refs;
}

/** Inputs for the pure analysis — describes one project root to scan. */
export interface ProjectScanRoot {
  /** Absolute path to the project root on disk. */
  rootPath: string;
  /** Identifier for logging / error attribution. */
  projectId?: string;
}

/**
 * Run the unused-clips analysis against `roots`. For each root, walk both
 * `.anm` files and referencing files (.agf/.asi/.agr/.conf), then set-diff.
 *
 * The disk-walk is per-root because the same relative path can exist in
 * different projects — we union the relative paths across roots before
 * computing the diff. Per-file metadata is sourced from the first root that
 * yielded the file (deterministic by `roots` iteration order).
 */
export function findUnusedClips(roots: ProjectScanRoot[]): FindUnusedClipsResult {
  // 1. Disk-walk for .anm files + capture per-file metadata.
  const anmMeta = new Map<string, UnusedAnmRow>();
  for (const root of roots) {
    const relPaths = walkExtensions(root.rootPath, new Set([".anm"]));
    for (const rel of relPaths) {
      const lc = rel.toLowerCase();
      if (anmMeta.has(lc)) continue; // keep first-seen metadata for stability
      const abs = join(root.rootPath, rel);
      let size = 0;
      let lastModified = "";
      try {
        const st = statSync(abs);
        size = st.size;
        lastModified = st.mtime.toISOString();
      } catch {
        // best-effort — leave defaults if stat fails
      }
      anmMeta.set(lc, { relPath: rel, size, lastModified });
    }
  }

  // 2. Walk referencing files (.agf/.asi/.agr/.conf) and union refs.
  const referenced = new Set<string>();
  let filesScanned = 0;
  for (const root of roots) {
    const refFiles = walkExtensions(root.rootPath, REFERENCING_EXTENSIONS);
    for (const rel of refFiles) {
      const abs = join(root.rootPath, rel);
      let content: string;
      try {
        content = readTextFileBounded(abs);
      } catch {
        continue;
      }
      filesScanned++;
      for (const ref of extractAnmRefs(content)) {
        referenced.add(ref);
      }
    }
  }

  // 3. Set-diff: anm-on-disk MINUS anm-referenced = unused.
  const unused: UnusedAnmRow[] = [];
  for (const [lc, meta] of anmMeta) {
    if (!referenced.has(lc)) unused.push(meta);
  }
  unused.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return {
    totalOnDisk: anmMeta.size,
    referencedCount: referenced.size,
    unused,
    filesScanned,
  };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Human-friendly byte formatter. Defaults to KB/MB/GB binary units. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

/** Slice the ISO timestamp down to the date portion (YYYY-MM-DD). */
export function formatModifiedDate(iso: string): string {
  if (!iso) return "(unknown)";
  // Be tolerant — anything not ISO-shaped just renders as-is.
  const i = iso.indexOf("T");
  return i >= 0 ? iso.slice(0, i) : iso;
}

export function formatUnusedClipsMarkdown(input: {
  projectLabel: string;
  result: FindUnusedClipsResult;
}): string {
  const { projectLabel, result } = input;
  const { totalOnDisk, referencedCount, unused, filesScanned } = result;
  const lines: string[] = [];
  lines.push(`## Unused .anm clips in ${projectLabel}`);
  lines.push("");
  lines.push(`Total .anm on disk: ${totalOnDisk}`);
  lines.push(`Referenced: ${referencedCount}`);
  lines.push(`Unused: ${unused.length}`);
  lines.push(`(scanned ${filesScanned} .agf/.asi/.agr/.conf file(s) for references)`);
  lines.push("");
  if (unused.length === 0) {
    lines.push(
      "No unused .anm clips found — every clip on disk is referenced by at least one AGF / ASI / AGR / .conf.",
    );
    return lines.join("\n");
  }
  lines.push("| File | Size | Last Modified |");
  lines.push("|---|---|---|");
  for (const row of unused) {
    lines.push(
      `| ${row.relPath} | ${formatBytes(row.size)} | ${formatModifiedDate(row.lastModified)} |`,
    );
  }
  return lines.join("\n");
}

export function formatUnusedClipsJson(input: {
  projectLabel: string;
  result: FindUnusedClipsResult;
}): string {
  const { projectLabel, result } = input;
  return JSON.stringify(
    {
      project: projectLabel,
      totalOnDisk: result.totalOnDisk,
      referencedCount: result.referencedCount,
      filesScanned: result.filesScanned,
      unused: result.unused,
    },
    null,
    2,
  );
}
