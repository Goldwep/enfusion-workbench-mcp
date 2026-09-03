/**
 * `list_resources` — paginated browse of the project-index, filterable by
 * source / root_type / project_id.
 *
 * The "what's in here?" tool. Complements `find_references`/`resolve_guid`
 * (which need a known GUID) with a discovery surface for exploration:
 * "show me every GenericEntity in Test1", "every config in the workshop source",
 * etc.
 *
 * Cursor: opaque base64url, bound to (source, rootType, projectId, version).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceRow, ResourceSource } from "../project-index/types.js";

// ── Cursor ───────────────────────────────────────────────────────────────────

interface CursorPayload {
  o: number;
  /** Mirror of filter values — `"*"` represents "not filtered". */
  s: ResourceSource | "*";
  t: string;
  p: string;
  v: 1;
}

export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

export function decodeCursor(
  s: string,
  expectedSource: ResourceSource | "*",
  expectedRootType: string,
  expectedProjectId: string,
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
  if (parsed.s !== expectedSource || parsed.t !== expectedRootType || parsed.p !== expectedProjectId) {
    throw new Error(
      "Invalid cursor: cursors are bound to a specific filter combination",
    );
  }
  return parsed;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatListPage(input: {
  rows: ResourceRow[];
  total: number;
  offset: number;
  filterDescription: string;
  nextCursor: string | null;
}): string {
  const { rows, total, offset, filterDescription, nextCursor } = input;
  if (total === 0) {
    return `No resources match ${filterDescription}.`;
  }
  const lines: string[] = [];
  const start = offset + 1;
  const end = offset + rows.length;
  const word = total !== 1 ? "resources" : "resource";
  lines.push(`Found ${total} ${word} matching ${filterDescription} (showing ${start}–${end}):`);
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
    lines.push("Call `list_resources` again with `cursor` set to the value above for the next page.");
  } else {
    lines.push("(no more pages)");
  }
  return lines.join("\n");
}

function describeFilters(
  source: ResourceSource | undefined,
  rootType: string | undefined,
  projectId: string | undefined,
): string {
  const parts: string[] = [];
  if (source) parts.push(`source=${source}`);
  if (rootType) parts.push(`root_type=${rootType}`);
  if (projectId) parts.push(`project_id=${projectId}`);
  return parts.length > 0 ? `[${parts.join(", ")}]` : "(all)";
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerListResources(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "list_resources",
    {
      description:
        "Paginated browse of indexed resources. Filter by source (user/core/workshop), root_type (e.g. GenericEntity, GameProject, SCR_Faction), or project_id. " +
        "Use for discovery — 'show me every GenericEntity in Test1', 'every config in workshop source', etc. " +
        "Paginate via `cursor`. With no filters, returns everything.",
      inputSchema: {
        source: z
          .enum(["user", "core", "workshop"])
          .optional()
          .describe("Filter by source"),
        root_type: z
          .string()
          .optional()
          .describe("Filter by root node type (e.g. GenericEntity, GameProject, SCR_Faction)"),
        project_id: z
          .string()
          .optional()
          .describe("Filter by owning project's ID (from .gproj). Requires project_id FK from schema v2."),
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
    async ({ source, root_type, project_id, limit, cursor }) => {
      try {
        const sourceKey: ResourceSource | "*" = source ?? "*";
        const rootTypeKey = root_type ?? "*";
        const projectIdKey = project_id ?? "*";
        const offset = cursor
          ? decodeCursor(cursor, sourceKey, rootTypeKey, projectIdKey).o
          : 0;
        const result = index.listResources({
          source,
          rootType: root_type,
          projectId: project_id,
          limit,
          offset,
        });
        const nextOffset = result.offset + result.rows.length;
        const hasMore = nextOffset < result.total;
        const nextCursor = hasMore
          ? encodeCursor({
              o: nextOffset,
              s: sourceKey,
              t: rootTypeKey,
              p: projectIdKey,
              v: 1,
            })
          : null;
        const text = formatListPage({
          rows: result.rows,
          total: result.total,
          offset: result.offset,
          filterDescription: describeFilters(source, root_type, project_id),
          nextCursor,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error listing resources: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
