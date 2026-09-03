/**
 * `find_broken_refs` — paginated list of references whose target GUID is
 * not in the resources table. The single most useful pre-publish check.
 *
 * Includes both "missing dependency" cases (dep refs to projects we don't
 * have indexed) and "real bugs" (asset_path / inheritance / value refs that
 * point at deleted or never-existing resources).
 *
 * Cursor: opaque base64url, bound to (source, version).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectIndex, type BrokenRef } from "../project-index/project-index.js";
import type { ResourceSource } from "../project-index/types.js";

// ── Cursor ───────────────────────────────────────────────────────────────────

interface CursorPayload {
  o: number;
  s: ResourceSource | "*";
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
    throw new Error("Invalid cursor: bound to a specific source filter");
  }
  return parsed;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatBrokenPage(input: {
  rows: BrokenRef[];
  total: number;
  offset: number;
  sourceFilter: ResourceSource | "*";
  nextCursor: string | null;
}): string {
  const { rows, total, offset, sourceFilter, nextCursor } = input;
  const filterSuffix = sourceFilter !== "*" ? ` [source=${sourceFilter}]` : "";
  if (total === 0) {
    return `No broken references found${filterSuffix}. Every indexed ref resolves to a known resource.`;
  }
  const lines: string[] = [];
  const start = offset + 1;
  const end = offset + rows.length;
  const word = total !== 1 ? "references" : "reference";
  lines.push(`Found ${total} broken ${word}${filterSuffix} (showing ${start}–${end}):`);
  lines.push("");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ctx = r.context ? ` — ${r.context}` : "";
    lines.push(
      `  ${start + i}. ${r.source_file}${r.project_id ? ` [${r.project_id}]` : ""} → {${r.target_guid}} (${r.ref_kind})${ctx}`,
    );
  }
  lines.push("");
  lines.push(`total_count: ${total}`);
  if (nextCursor) {
    lines.push(`next_cursor: ${nextCursor}`);
    lines.push("");
    lines.push(
      "Call `find_broken_refs` again with `cursor` set to the value above for the next page.",
    );
  } else {
    lines.push("(no more pages)");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerFindBrokenRefs(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "find_broken_refs",
    {
      description:
        "Find references pointing at GUIDs not in the resources table. " +
        "Catches both real bugs (asset/inheritance refs to deleted resources) and missing-dependency cases " +
        "(deps to projects you don't have indexed). " +
        "Run before publishing to catch the most common ship-blocker. Paginate via `cursor`.",
      inputSchema: {
        source: z
          .enum(["user", "core", "workshop"])
          .optional()
          .describe("Filter by the source of the file containing the broken ref"),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max refs per page (1-200, default 50)"),
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
        const result = index.findBrokenRefs({ source, limit, offset });
        const nextOffset = result.offset + result.rows.length;
        const hasMore = nextOffset < result.total;
        const nextCursor = hasMore
          ? encodeCursor({ o: nextOffset, s: sourceKey, v: 1 })
          : null;
        const text = formatBrokenPage({
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
            { type: "text" as const, text: `Error finding broken refs: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
