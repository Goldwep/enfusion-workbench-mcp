/**
 * `find_references` — paginated lookup of every file that references a
 * given resource GUID in the project-index.
 *
 * This is the first paginated tool in the codebase. Pagination shape and
 * cursor encoding follow `docs/TOOL_TEMPLATE.md` §4.
 *
 * Cursors are opaque base64url-encoded JSON and are bound to BOTH the GUID
 * and the kind filter — the decoder throws on mismatch so a cursor from one
 * query cannot be silently reused on another.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { RefKind } from "../project-index/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Filter argument: any of the four real `RefKind`s, or `"any"` for no filter. */
export type RefKindFilter = RefKind | "any";

/** One row rendered into the page output. */
export interface ReferenceRow {
  /** Owning project of `source_file` (schema v3) — shown so same-named
   *  files in different addons are distinguishable. Optional so pre-v3
   *  fixtures in tests still type-check. */
  project_id?: string;
  source_file: string;
  ref_kind: RefKind;
  context: string;
}

/** Decoded cursor payload — opaque to callers, parseable to the tool. */
export interface CursorPayload {
  /** Offset to resume from (number of rows already shown). */
  o: number;
  /** GUID this cursor was issued for. Normalized: 16 hex chars, uppercase. */
  g: string;
  /** Kind filter this cursor was issued for. */
  k: RefKindFilter;
  /** Cursor schema version, for forward compatibility. */
  v: 1;
}

/** Input to `formatPage` — everything needed to render one page of results. */
export interface PageRenderInput {
  guid: string;
  kind: RefKindFilter;
  totalCount: number;
  offset: number;
  rows: ReferenceRow[];
  nextCursor: string | null;
}

// ── Helpers (exported for tests) ──────────────────────────────────────────────

/**
 * Normalize a user-supplied GUID: strip surrounding braces, uppercase.
 * Throws if the result is not exactly 16 hex chars.
 */
export function normalizeGuid(raw: string): string {
  const stripped = raw.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!/^[0-9A-Fa-f]{16}$/.test(stripped)) {
    throw new Error(
      `Invalid GUID "${raw}": expected 16 hex characters, with or without braces`,
    );
  }
  return stripped.toUpperCase();
}

/** Base64url-encode a cursor payload. */
export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

/**
 * Decode an opaque cursor and validate it matches the current query.
 * Throws on any malformed input, version mismatch, or guid/kind mismatch —
 * the tool handler catches and surfaces as `isError: true`.
 */
export function decodeCursor(
  s: string,
  expectedGuid: string,
  expectedKind: RefKindFilter,
): CursorPayload {
  let parsed: CursorPayload;
  try {
    const json = Buffer.from(s, "base64url").toString("utf-8");
    parsed = JSON.parse(json) as CursorPayload;
  } catch {
    throw new Error("Invalid cursor: not base64url-encoded JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid cursor: payload is not an object");
  }
  if (parsed.v !== 1) {
    throw new Error(`Invalid cursor: unsupported version ${String(parsed.v)}`);
  }
  if (typeof parsed.o !== "number" || !Number.isInteger(parsed.o) || parsed.o < 0) {
    throw new Error("Invalid cursor: bad offset");
  }
  if (typeof parsed.g !== "string" || parsed.g !== expectedGuid) {
    throw new Error(
      "Invalid cursor: cursor does not match the current query (cursors are bound to a specific GUID)",
    );
  }
  if (parsed.k !== expectedKind) {
    throw new Error(
      "Invalid cursor: cursor does not match the current query (cursors are bound to a specific kind filter)",
    );
  }
  return parsed;
}

/**
 * Render one page of results as the markdown-ish text returned by the tool.
 * Surfaces total_count and next_cursor inline so the LLM can drive pagination
 * without needing structured response fields.
 */
export function formatPage(input: PageRenderInput): string {
  const { guid, kind, totalCount, offset, rows, nextCursor } = input;
  const lines: string[] = [];
  const start = offset + 1;
  const end = offset + rows.length;
  const refWord = totalCount !== 1 ? "references" : "reference";
  const kindSuffix = kind !== "any" ? ` [kind=${kind}]` : "";
  lines.push(
    `Found ${totalCount} ${refWord} to {${guid}}${kindSuffix} (showing ${start}–${end}):`,
  );
  lines.push("");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ctx = r.context ? ` — ${r.context}` : "";
    const proj = r.project_id ? ` [${r.project_id}]` : "";
    lines.push(`  ${start + i}. ${r.source_file}${proj} (${r.ref_kind})${ctx}`);
  }
  lines.push("");
  lines.push(`total_count: ${totalCount}`);
  if (nextCursor) {
    lines.push(`next_cursor: ${nextCursor}`);
    lines.push("");
    lines.push(
      "Call `find_references` again with `cursor` set to the value above to get the next page.",
    );
  } else {
    lines.push("(no more pages)");
  }
  return lines.join("\n");
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerFindReferences(
  server: McpServer,
  db: Database.Database,
): void {
  server.registerTool(
    "find_references",
    {
      description:
        "Find every file that references a resource by its GUID. " +
        "Returns paginated results — each ref shows the source file, ref kind " +
        "(inheritance/asset_path/dep/value), and context (property name or parent type). " +
        "Use this for refactor impact analysis, finding broken refs, or tracing inheritance chains. " +
        "Paginate via the `cursor` field when total > limit.",
      inputSchema: {
        guid: z
          .string()
          .describe("Target GUID — 16 hex chars, with or without braces"),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(20)
          .describe("Max refs per page (1-200, default 20)"),
        cursor: z
          .string()
          .optional()
          .describe("Opaque pagination token from a previous response's next_cursor"),
        kind: z
          .enum(["inheritance", "asset_path", "dep", "value", "any"])
          .default("any")
          .describe("Filter by ref kind, or 'any' for all kinds"),
      },
    },
    async ({ guid, limit, cursor, kind }) => {
      try {
        // 1. Normalize + validate the GUID.
        const normalizedGuid = normalizeGuid(guid);

        // 2. Decode cursor if present (validates guid + kind match).
        const offset = cursor ? decodeCursor(cursor, normalizedGuid, kind).o : 0;

        // 3. Run COUNT(*) for total_count (same WHERE clause, no LIMIT).
        const countRow =
          kind === "any"
            ? (db
                .prepare(
                  "SELECT COUNT(*) AS n FROM resource_refs WHERE target_guid = ?",
                )
                .get(normalizedGuid) as { n: number })
            : (db
                .prepare(
                  "SELECT COUNT(*) AS n FROM resource_refs WHERE target_guid = ? AND ref_kind = ?",
                )
                .get(normalizedGuid, kind) as { n: number });
        const totalCount = countRow.n;

        if (totalCount === 0) {
          const kindSuffix = kind !== "any" ? ` [kind=${kind}]` : "";
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No references found for {${normalizedGuid}}${kindSuffix}. ` +
                  "Either the resource is unused, or the project containing references isn't indexed yet.",
              },
            ],
          };
        }

        // 4. Fetch one page. resource_refs has no `id` column; use a stable
        // ordering on the PK columns so pagination is deterministic.
        const rows =
          kind === "any"
            ? (db
                .prepare(
                  `SELECT project_id, source_file, ref_kind, context
                   FROM resource_refs
                   WHERE target_guid = ?
                   ORDER BY project_id, source_file, ref_kind, context
                   LIMIT ? OFFSET ?`,
                )
                .all(normalizedGuid, limit, offset) as ReferenceRow[])
            : (db
                .prepare(
                  `SELECT project_id, source_file, ref_kind, context
                   FROM resource_refs
                   WHERE target_guid = ? AND ref_kind = ?
                   ORDER BY project_id, source_file, ref_kind, context
                   LIMIT ? OFFSET ?`,
                )
                .all(normalizedGuid, kind, limit, offset) as ReferenceRow[]);

        // 5. Compute next-cursor only if there's more.
        const nextOffset = offset + rows.length;
        const hasMore = nextOffset < totalCount;
        const nextCursor = hasMore
          ? encodeCursor({ o: nextOffset, g: normalizedGuid, k: kind, v: 1 })
          : null;

        const text = formatPage({
          guid: normalizedGuid,
          kind,
          totalCount,
          offset,
          rows,
          nextCursor,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error finding references: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
