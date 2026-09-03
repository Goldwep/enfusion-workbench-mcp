import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { ResourceRow } from "../project-index/types.js";

/**
 * Format a `resources` row into a human-readable markdown block.
 *
 * Null `class_name` / `parent_inherit` are gracefully omitted — neither the
 * word "null" nor a stray bullet appears in the rendered output.
 */
export function formatResolvedGuid(row: ResourceRow): string {
  const lines: string[] = [];
  lines.push(`## Resource {${row.guid}}`);
  lines.push("");
  lines.push(`- **File:** ${row.file_path}`);
  lines.push(`- **Root type:** ${row.root_type}`);
  if (row.class_name) {
    lines.push(`- **Class:** ${row.class_name}`);
  }
  if (row.parent_inherit) {
    lines.push(`- **Inherits from:** ${row.parent_inherit}`);
  }
  lines.push(`- **Source:** ${row.source}`);
  return lines.join("\n");
}

/**
 * Format a "no row matched" response. Success-shaped (the absence of a row is
 * not an error — it usually means the resource lives in an unindexed project).
 */
export function formatNotFound(guid: string): string {
  return (
    `No resource found for GUID \`{${guid}}\` in the project-index. ` +
    "The resource may live in a project not yet indexed, or may not exist " +
    "in this Reforger install. Run `project_index_status` to see what's indexed."
  );
}

/**
 * Format the "input doesn't look like a GUID" error message. Echoes the
 * original (pre-normalized) input so the caller can see what was rejected.
 */
export function formatInvalidGuid(input: string): string {
  return (
    "Invalid GUID: must be 16 hex chars, optionally wrapped in braces. " +
    `Got: ${input}`
  );
}

/** Strip optional `{...}` braces and uppercase. Pure — no validation. */
function normalizeGuid(input: string): string {
  const trimmed = input.trim();
  const unwrapped =
    trimmed.startsWith("{") && trimmed.endsWith("}")
      ? trimmed.slice(1, -1)
      : trimmed;
  return unwrapped.toUpperCase();
}

const GUID_RE = /^[0-9A-F]{16}$/;

export function registerResolveGuid(
  server: McpServer,
  db: Database.Database,
): void {
  const select = db.prepare(
    "SELECT guid, file_path, root_type, class_name, parent_inherit, source " +
      "FROM resources WHERE guid = ?",
  );

  server.registerTool(
    "resolve_guid",
    {
      description:
        "Look up a resource by its 16-hex-character GUID and return the defining file path, root type, class name, and inheritance clause. " +
        "Useful when you have a GUID from a property value or inheritance line (e.g. `{A9806AF617972E97}path/to/file.et`) and need to know what defines it. " +
        "Accepts the GUID with or without curly braces, case-insensitive. Returns a soft-fail message (not an error) when the GUID is not in the project-index — the resource may live in a project not yet indexed.",
      inputSchema: {
        guid: z
          .string()
          .describe(
            "16-character hex GUID, with or without curly braces (e.g., 'A9806AF617972E97' or '{A9806AF617972E97}')",
          ),
      },
    },
    async ({ guid }) => {
      try {
        const normalized = normalizeGuid(guid);
        if (!GUID_RE.test(normalized)) {
          return {
            content: [
              { type: "text" as const, text: formatInvalidGuid(guid) },
            ],
            isError: true,
          };
        }

        const row = select.get(normalized) as ResourceRow | undefined;
        if (!row) {
          return {
            content: [
              { type: "text" as const, text: formatNotFound(normalized) },
            ],
          };
        }

        return {
          content: [
            { type: "text" as const, text: formatResolvedGuid(row) },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error resolving GUID: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
