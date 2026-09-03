/**
 * `find_unused_resources` — paginated list of resources with zero inbound
 * references (no inheritance / asset_path / dep / value points at them).
 *
 * Use case: pre-publish cleanup. The dry-run nature is implicit — this tool
 * only lists, never deletes. `refactor_remove_unused` (L5) consumes the same
 * underlying query and adds confirm-flag + actual deletion.
 *
 * Cursor: opaque base64url, bound to (source, version). Pagination matches
 * `find-references.ts` shape.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceRow, ResourceSource } from "../project-index/types.js";

// ── Cursor ───────────────────────────────────────────────────────────────────

interface CursorPayload {
  /** Offset to resume from. */
  o: number;
  /** Source filter the cursor was issued for (string or `*` for "no filter"). */
  s: ResourceSource | "*";
  /** Schema version, for forward compatibility. */
  v: 1;
}

export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

export function decodeCursor(
  s: string,
  expectedSource: ResourceSource | "*",
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
  if (parsed.s !== expectedSource) {
    throw new Error(
      "Invalid cursor: cursors are bound to a specific source filter",
    );
  }
  return parsed;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatUnusedPage(input: {
  rows: ResourceRow[];
  total: number;
  offset: number;
  sourceFilter: ResourceSource | "*";
  nextCursor: string | null;
}): string {
  const { rows, total, offset, sourceFilter, nextCursor } = input;
  const lines: string[] = [];
  const filterSuffix = sourceFilter !== "*" ? ` [source=${sourceFilter}]` : "";
  if (total === 0) {
    return `No unused resources found${filterSuffix}. Index may be empty, or every indexed resource has at least one inbound reference.`;
  }
  const start = offset + 1;
  const end = offset + rows.length;
  const word = total !== 1 ? "resources" : "resource";
  lines.push(`Found ${total} unused ${word}${filterSuffix} (showing ${start}–${end}):`);
  lines.push("");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cls = r.class_name ? ` [${r.class_name}]` : "";
    lines.push(
      `  ${start + i}. ${r.file_path} — ${r.root_type}${cls} {${r.guid}} (source=${r.source})`,
    );
  }
  lines.push("");
  lines.push(`total_count: ${total}`);
  if (nextCursor) {
    lines.push(`next_cursor: ${nextCursor}`);
    lines.push("");
    lines.push(
      "Call `find_unused_resources` again with `cursor` set to the value above for the next page.",
    );
  } else {
    lines.push("(no more pages)");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerFindUnusedResources(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "find_unused_resources",
    {
      description:
        "List resources with zero inbound references — orphans that no inheritance / asset_path / dep / value entry points at. " +
        "Use this before publishing a mod to find dead assets you can prune, or for general index hygiene. " +
        "Read-only; pair with `refactor_remove_unused` (L5) when ready to actually delete. Paginate via `cursor`.",
      inputSchema: {
        source: z
          .enum(["user", "core", "workshop"])
          .optional()
          .describe("Optional source filter — usually you want `user` to ignore vanilla content"),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max resources per page (1-200, default 50)"),
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
        const result = index.findUnusedResources({ source, limit, offset });
        const nextOffset = result.offset + result.rows.length;
        const hasMore = nextOffset < result.total;
        const nextCursor = hasMore
          ? encodeCursor({ o: nextOffset, s: sourceKey, v: 1 })
          : null;
        const text = formatUnusedPage({
          rows: result.rows,
          total: result.total,
          offset: result.offset,
          sourceFilter: sourceKey,
          nextCursor,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error listing unused resources: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
