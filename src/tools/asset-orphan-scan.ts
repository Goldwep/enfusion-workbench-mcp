/**
 * `asset_orphan_scan` — find binary asset files on disk that no indexed
 * resource references.
 *
 * Background: binary assets (.edds textures, .acp audio, .fbx meshes, .ogg/.wav
 * sounds) are NOT scanned into the project-index — they're not Enfusion text,
 * so they have no resources row. They only appear as `{GUID}path/to/file.ext`
 * references inside indexed `.emat` / `.layout` / `.ent` / `.conf` files.
 *
 * Strategy:
 *   1. Walk each indexed project's root for files matching the asset extension
 *      filter (pure FS, fast).
 *   2. Re-read indexed file content per project and regex-scan for asset-path
 *      references. Build a set of referenced relative paths.
 *   3. Diff: on-disk minus referenced = orphans.
 *   4. Sort + paginate via cursor (matches find-unused-resources shape).
 *
 * Limitation: any indexed file that won't re-read (deleted between index and
 * scan) is silently skipped. Worst case for orphan detection is a false
 * positive — pair the output with manual review before deletion.
 *
 * Cursor: opaque base64url, bound to (source, sorted-extensions, version).
 * Re-issuing a scan with the same filters returns a deterministically-sorted
 * orphan list so cursors remain stable across calls.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { z } from "zod";
import type { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceSource } from "../project-index/types.js";

// ── Cursor ───────────────────────────────────────────────────────────────────

interface CursorPayload {
  o: number;
  /** Source filter (`*` for none). */
  s: ResourceSource | "*";
  /** Joined+sorted extensions (e.g., "acp,edds,fbx,ogg,wav"). */
  e: string;
  v: 1;
}

export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

export function decodeCursor(
  s: string,
  expectedSource: ResourceSource | "*",
  expectedExtensions: string,
): CursorPayload {
  let parsed: CursorPayload;
  try {
    parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf-8")) as CursorPayload;
  } catch {
    throw new Error("Invalid cursor: not base64url-encoded JSON");
  }
  if (!parsed || parsed.v !== 1) {
    throw new Error("Invalid cursor: unsupported version");
  }
  if (typeof parsed.o !== "number" || !Number.isInteger(parsed.o) || parsed.o < 0) {
    throw new Error("Invalid cursor: bad offset");
  }
  if (parsed.s !== expectedSource || parsed.e !== expectedExtensions) {
    throw new Error("Invalid cursor: bound to a specific source / extensions combination");
  }
  return parsed;
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/** Default asset extensions when the caller doesn't specify any. */
export const DEFAULT_ASSET_EXTENSIONS = ["edds", "acp", "fbx", "ogg", "wav"];

/** Skip dirs during the disk walk — mirrors resource-scan.ts. */
const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist"]);

/**
 * Normalize an extension list: lowercase, strip leading dots, dedupe, sort.
 * Drops empty strings. Returns the canonical comma-joined form for cursor
 * binding plus the Set used for matching.
 */
export function normalizeExtensions(input: string[]): {
  set: Set<string>;
  joined: string;
} {
  const cleaned = Array.from(
    new Set(
      input
        .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
        .filter((e) => e.length > 0),
    ),
  ).sort();
  return { set: new Set(cleaned), joined: cleaned.join(",") };
}

/**
 * Walk a directory yielding files whose extension (lowercased, sans dot) is
 * in `extensions`. Inaccessible directories silently skipped. Yields
 * project-relative paths using forward slashes (matches index storage).
 */
export function* walkForAssets(
  projectRoot: string,
  extensions: Set<string>,
): Generator<string> {
  function* recurse(dir: string): Generator<string> {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        yield* recurse(full);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1).toLowerCase();
        if (extensions.has(ext)) {
          yield relative(projectRoot, full).split("\\").join("/");
        }
      }
    }
  }
  yield* recurse(projectRoot);
}

/**
 * Extract every `{GUID}path/to/file.ext` reference whose path tail matches
 * one of `extensions` from a chunk of Enfusion text. Used to build the
 * referenced-asset set without re-parsing each file.
 */
export function extractAssetRefs(
  content: string,
  extensions: Set<string>,
): string[] {
  const out: string[] = [];
  const re = /\{[0-9A-Fa-f]{16}\}([^"\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const path = m[1];
    const dotIdx = path.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const ext = path.slice(dotIdx + 1).toLowerCase();
    if (extensions.has(ext)) {
      out.push(path);
    }
  }
  return out;
}

/** Compute orphans = on-disk paths not present in the referenced set. */
export function computeOrphans(
  onDisk: string[],
  referenced: Set<string>,
): string[] {
  const orphans = onDisk.filter((p) => !referenced.has(p));
  orphans.sort();
  return orphans;
}

// ── Formatter (exported for tests) ───────────────────────────────────────────

export interface OrphanRow {
  project_id: string;
  file_path: string;
}

export function formatOrphanPage(input: {
  rows: OrphanRow[];
  total: number;
  offset: number;
  sourceFilter: ResourceSource | "*";
  extensionsLabel: string;
  nextCursor: string | null;
}): string {
  const { rows, total, offset, sourceFilter, extensionsLabel, nextCursor } = input;
  const filterSuffix =
    sourceFilter !== "*"
      ? ` [source=${sourceFilter}, ext=${extensionsLabel}]`
      : ` [ext=${extensionsLabel}]`;
  if (total === 0) {
    return `No orphan assets found${filterSuffix}. Every asset on disk is referenced from an indexed file (or no projects with matching files are indexed).`;
  }
  const lines: string[] = [];
  const start = offset + 1;
  const end = offset + rows.length;
  const word = total !== 1 ? "assets" : "asset";
  lines.push(`Found ${total} orphan ${word}${filterSuffix} (showing ${start}–${end}):`);
  lines.push("");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push(`  ${start + i}. ${r.project_id}: ${r.file_path}`);
  }
  lines.push("");
  lines.push(`total_count: ${total}`);
  if (nextCursor) {
    lines.push(`next_cursor: ${nextCursor}`);
    lines.push("");
    lines.push(
      "Call `asset_orphan_scan` again with `cursor` set to the value above for the next page.",
    );
  } else {
    lines.push("(no more pages)");
  }
  return lines.join("\n");
}

// ── Core orchestrator (exported for tests, uses an injected fs/index) ────────

export interface ProjectFileGroup {
  project_id: string;
  root_path: string;
  source: ResourceSource;
  indexed_files: string[];
}

/**
 * Build the complete orphan list across all projects in `groups`. The reader
 * is injected so tests can supply synthetic content without touching disk.
 * Returns rows sorted by (project_id, file_path).
 */
export function buildOrphanList(
  groups: ProjectFileGroup[],
  extensions: Set<string>,
  readContent: (absPath: string) => string | null,
  listDiskAssets: (root: string, exts: Set<string>) => string[],
): OrphanRow[] {
  const allRows: OrphanRow[] = [];
  for (const group of groups) {
    const referenced = new Set<string>();
    for (const rel of group.indexed_files) {
      const abs = join(group.root_path, rel);
      const content = readContent(abs);
      if (content === null) continue;
      for (const ref of extractAssetRefs(content, extensions)) {
        referenced.add(ref);
      }
    }
    const onDisk = listDiskAssets(group.root_path, extensions);
    const orphans = computeOrphans(onDisk, referenced);
    for (const o of orphans) {
      allRows.push({ project_id: group.project_id, file_path: o });
    }
  }
  allRows.sort((a, b) => {
    if (a.project_id !== b.project_id) {
      return a.project_id < b.project_id ? -1 : 1;
    }
    return a.file_path < b.file_path ? -1 : 1;
  });
  return allRows;
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerAssetOrphanScan(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "asset_orphan_scan",
    {
      description:
        "Find binary asset files on disk (.edds / .acp / .fbx / .ogg / .wav by default) that no indexed Enfusion text resource references. " +
        "Use this to identify dead textures, audio, and meshes before publishing a mod. " +
        "Read-only — reports paths, never deletes. Configurable extension list and source filter; paginate via `cursor`.",
      inputSchema: {
        source: z
          .enum(["user", "core", "workshop"])
          .optional()
          .describe("Optional source filter — usually `user` to skip vanilla content"),
        asset_extensions: z
          .array(z.string())
          .optional()
          .describe(
            `Asset file extensions to scan (without leading dot). Default: ${DEFAULT_ASSET_EXTENSIONS.join(", ")}`,
          ),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max orphans per page (1-200, default 50)"),
        cursor: z
          .string()
          .optional()
          .describe("Opaque pagination token from a previous response's next_cursor"),
      },
    },
    async ({ source, asset_extensions, limit, cursor }) => {
      try {
        const exts = normalizeExtensions(asset_extensions ?? DEFAULT_ASSET_EXTENSIONS);
        if (exts.set.size === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error scanning orphans: asset_extensions must contain at least one extension",
              },
            ],
            isError: true,
          };
        }
        const sourceKey: ResourceSource | "*" = source ?? "*";
        const offset = cursor ? decodeCursor(cursor, sourceKey, exts.joined).o : 0;

        // Group indexed files by their owning project.
        //
        // Audit-fix BUG-2: `listIndexedProjectFiles` now LEFT JOINs through
        // resources, so untyped files (SubScene, etc.) can surface with NULL
        // project_id / root_path. The orphan scan is project-scoped (needs
        // root_path to walk the disk + read content), so we explicitly opt
        // OUT of untyped rows via `include_untyped: false`. The defensive
        // null-guard below catches any future schema drift.
        //
        // KNOWN LIMITATION: the SubScene false-positive case the audit BUG-2
        // describes is only fully resolved once Schema v3 lands a
        // `files.project_id` FK — then untyped files can be tied to a
        // project without going through resources, and we can flip
        // `include_untyped: true` here to read their content into the
        // referenced-asset set.
        const flatRows = index.listIndexedProjectFiles(source, {
          include_untyped: false,
        });
        const groupMap = new Map<string, ProjectFileGroup>();
        for (const row of flatRows) {
          // Defensive null guard — typed rows always have project info, but
          // future schema changes shouldn't be able to slip a NULL through.
          if (row.project_id === null || row.root_path === null) continue;
          // Reject project root paths starting with '-' (flag-smuggle safety
          // for any code that later passes them to a CLI).
          if (row.root_path.startsWith("-")) continue;
          let group = groupMap.get(row.project_id);
          if (!group) {
            group = {
              project_id: row.project_id,
              root_path: row.root_path,
              source: row.source,
              indexed_files: [],
            };
            groupMap.set(row.project_id, group);
          }
          group.indexed_files.push(row.file_path);
        }
        const groups = Array.from(groupMap.values());

        const allRows = buildOrphanList(
          groups,
          exts.set,
          (abs) => {
            try {
              const stat = statSync(abs);
              if (!stat.isFile()) return null;
              return readFileSync(abs, "utf-8");
            } catch {
              return null;
            }
          },
          (root, e) => Array.from(walkForAssets(root, e)),
        );

        const total = allRows.length;
        const page = allRows.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        const hasMore = nextOffset < total;
        const nextCursor = hasMore
          ? encodeCursor({ o: nextOffset, s: sourceKey, e: exts.joined, v: 1 })
          : null;

        const text = formatOrphanPage({
          rows: page,
          total,
          offset,
          sourceFilter: sourceKey,
          extensionsLabel: exts.joined,
          nextCursor,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error scanning orphans: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
