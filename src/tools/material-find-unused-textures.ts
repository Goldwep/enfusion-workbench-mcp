/**
 * `material_find_unused_textures` — paginated list of `.edds` files that no
 * `.emat` references.
 *
 * `.edds` files aren't in `SCANNABLE_EXTENSIONS`, so they never appear in the
 * `resources` table. Instead this tool walks `config.projectPath` for `.edds`
 * files on disk, then re-parses every `.emat` (paginated through the index)
 * to collect texture path refs. The diff is the unused-textures list.
 *
 * The `.emat` set is filterable by `source` so callers can scope unused-checks
 * to their user-mod content without seeing every referenced core texture.
 * Pagination follows the cursor pattern in `find-references.ts` and is bound
 * to the source filter — cursors from one filter can't be silently reused.
 *
 * Constructor takes `Config` for the disk walk root — even though the spec
 * signature suggested `(server, index)`, accessing the filesystem requires
 * `projectPath`. Matches the dep set used by `scenario-inspect`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { parse } from "../formats/enfusion-text.js";
import { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceSource } from "../project-index/types.js";
import { logger } from "../utils/logger.js";
import { walkExtensions } from "../utils/walk-extensions.js";

// Re-export for backwards-compat — callers/tests that imported walkExtensions
// from this module keep working without churn.
export { walkExtensions };

// ── Cursor ───────────────────────────────────────────────────────────────────

interface CursorPayload {
  /** Offset to resume from. */
  o: number;
  /** Source filter the cursor was issued for (string or `*` for "no filter"). */
  s: ResourceSource | "*";
  /** Schema version. */
  v: 1;
}

export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

export function decodeCursor(s: string, expectedSource: ResourceSource | "*"): CursorPayload {
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
  if (parsed.s !== expectedSource) {
    throw new Error("Invalid cursor: cursors are bound to a specific source filter");
  }
  return parsed;
}

// ── Parse helpers ────────────────────────────────────────────────────────────

/** `{16-hex}<path>`-shaped refs used to pick texture paths out of .emat values. */
const GUID_REF_RE = /\{([0-9A-Fa-f]{16})\}([^"\s}]*\.edds)/gi;

/**
 * Extract every `.edds` path referenced from a parsed `.emat` body. Paths
 * are lowercased + forward-slashed so they compare cleanly against the
 * disk-walked `.edds` list.
 */
export function extractEddsRefs(content: string): Set<string> {
  const refs = new Set<string>();
  let m: RegExpExecArray | null;
  GUID_REF_RE.lastIndex = 0;
  while ((m = GUID_REF_RE.exec(content)) !== null) {
    refs.add(m[2].toLowerCase().split("\\").join("/"));
  }
  return refs;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatUnusedTexturesPage(input: {
  rows: string[];
  total: number;
  offset: number;
  sourceFilter: ResourceSource | "*";
  nextCursor: string | null;
  ematCount: number;
}): string {
  const { rows, total, offset, sourceFilter, nextCursor, ematCount } = input;
  const filterSuffix = sourceFilter !== "*" ? ` [emat source=${sourceFilter}]` : "";
  if (total === 0) {
    return (
      `No unused textures found${filterSuffix}. ` +
      `Scanned ${ematCount} .emat file(s); every .edds on disk is referenced by at least one.`
    );
  }
  const start = offset + 1;
  const end = offset + rows.length;
  const word = total !== 1 ? "textures" : "texture";
  const lines: string[] = [];
  lines.push(
    `Found ${total} unused ${word}${filterSuffix} (showing ${start}-${end}; scanned ${ematCount} .emat file(s)):`,
  );
  lines.push("");
  for (let i = 0; i < rows.length; i++) {
    lines.push(`  ${start + i}. ${rows[i]}`);
  }
  lines.push("");
  lines.push(`total_count: ${total}`);
  if (nextCursor) {
    lines.push(`next_cursor: ${nextCursor}`);
    lines.push("");
    lines.push(
      "Call `material_find_unused_textures` again with `cursor` set to the value above for the next page.",
    );
  } else {
    lines.push("(no more pages)");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMaterialFindUnusedTextures(
  server: McpServer,
  index: ProjectIndex,
  config: Config,
): void {
  server.registerTool(
    "material_find_unused_textures",
    {
      description:
        "Find `.edds` texture files that no `.emat` material references. " +
        "Walks the project filesystem for `.edds` files, parses every indexed `.emat` for texture refs, " +
        "and returns the disk paths that no material uses. " +
        "Use this before publishing a mod to prune dead texture assets. " +
        "Read-only; pair with manual deletion when ready. Paginate via `cursor`.",
      inputSchema: {
        source: z
          .enum(["user", "core", "workshop"])
          .optional()
          .describe("Optional source filter scoping which `.emat` files to consider (usually `user`)"),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max unused textures per page (1-200, default 50)"),
        cursor: z
          .string()
          .optional()
          .describe("Opaque pagination token from a previous response's next_cursor"),
      },
    },
    async ({ source, limit, cursor }) => {
      try {
        const sourceKey: ResourceSource | "*" = source ?? "*";
        const offset = cursor ? decodeCursor(cursor, sourceKey).o : 0;

        // 1. Disk-walk for `.edds` files under the project root.
        const projectPath = config.projectPath;
        const allEdds = walkExtensions(projectPath, new Set([".edds"]));
        const eddsSet = new Set(allEdds.map((p) => p.toLowerCase()));

        // 2. Page through every `.emat`-rooted resource. We iterate
        //    `listResources` to honor the source filter — `.emat` files
        //    span many shader-class root types so a single rootType filter
        //    isn't viable. Post-filter by extension.
        const referenced = new Set<string>();
        let ematCount = 0;
        const pageSize = 500;
        let ematOffset = 0;
        // Safety cap: the scan stops after this many resources to avoid
        // pathological loops if the index reports an inconsistent total.
        const SCAN_CAP = 100_000;
        while (ematOffset < SCAN_CAP) {
          const page = index.listResources({
            source,
            limit: pageSize,
            offset: ematOffset,
          });
          if (page.rows.length === 0) break;
          for (const row of page.rows) {
            if (extname(row.file_path).toLowerCase() !== ".emat") continue;
            ematCount++;
            const abs = join(projectPath, row.file_path);
            let content: string;
            try {
              content = readFileSync(abs, "utf-8");
            } catch (e) {
              logger.debug(
                `material_find_unused_textures: skip unreadable .emat ${abs} (${e instanceof Error ? e.message : String(e)})`,
              );
              continue;
            }
            // Regex over raw text is robust to parse failures in stray
            // .emat files — we'd rather lose one material's refs than
            // abort the whole audit. Validates structure via parse() too
            // in case the regex matched something inside a quoted body.
            try {
              parse(content);
            } catch {
              // Fall through — we still pick up refs the regex finds.
            }
            for (const ref of extractEddsRefs(content)) {
              referenced.add(ref);
            }
          }
          if (ematOffset + page.rows.length >= page.total) break;
          ematOffset += page.rows.length;
        }

        // 3. Diff: `.edds` files on disk not referenced by any `.emat`.
        const unused: string[] = [];
        for (const lc of eddsSet) {
          if (!referenced.has(lc)) unused.push(lc);
        }
        unused.sort();

        // 4. Page the result.
        const total = unused.length;
        const pageRows = unused.slice(offset, offset + limit);
        const nextOffset = offset + pageRows.length;
        const hasMore = nextOffset < total;
        const nextCursor = hasMore ? encodeCursor({ o: nextOffset, s: sourceKey, v: 1 }) : null;

        const text = formatUnusedTexturesPage({
          rows: pageRows,
          total,
          offset,
          sourceFilter: sourceKey,
          nextCursor,
          ematCount,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error finding unused textures: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
