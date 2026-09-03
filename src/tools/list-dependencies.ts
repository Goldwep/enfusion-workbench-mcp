/**
 * `list_dependencies` — enumerate a project's declared dependencies and
 * report whether each one resolves to an indexed resource.
 *
 * Not paginated: a project's deps list is small (typically <30). Returns
 * everything in one shot. Joined with the `resources` table so callers
 * can see what file each dep GUID points to (or that it's unresolved,
 * which is the most common pre-publish failure mode).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectIndex, type DependencyRow } from "../project-index/project-index.js";

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatDependencies(input: {
  projectId: string;
  rows: DependencyRow[];
}): string {
  const { projectId, rows } = input;
  const lines: string[] = [];
  lines.push(`## Dependencies of \`${projectId}\``);
  lines.push("");
  if (rows.length === 0) {
    lines.push(
      `(none declared, or project ID \`${projectId}\` is not in the project-index)`,
    );
    return lines.join("\n");
  }

  const resolved = rows.filter((r) => r.file_path !== null);
  const unresolved = rows.filter((r) => r.file_path === null);

  lines.push(`Total deps declared: ${rows.length} (${resolved.length} resolved, ${unresolved.length} unresolved)`);
  lines.push("");

  if (resolved.length > 0) {
    lines.push("### Resolved");
    lines.push("");
    for (const r of resolved) {
      lines.push(`  - {${r.dep_guid}} → ${r.file_path} (source=${r.source})`);
    }
    lines.push("");
  }

  if (unresolved.length > 0) {
    lines.push("### Unresolved (project depends on these but they're not indexed)");
    lines.push("");
    for (const r of unresolved) {
      lines.push(`  - {${r.dep_guid}}`);
    }
    lines.push("");
    lines.push(
      "Unresolved deps may be intentional (workshop mods you haven't downloaded) " +
        "or accidental (deleted projects still referenced). Cross-check against your Workshop subscriptions.",
    );
  }

  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerListDependencies(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "list_dependencies",
    {
      description:
        "List the `Dependencies { ... }` entries of an indexed project's .gproj, with each dep GUID resolved against the project-index. " +
        "Resolved entries show the target file + source; unresolved entries flag missing prerequisites. " +
        "Use for pre-publish dep audit or to understand a third-party mod's surface.",
      inputSchema: {
        project_id: z
          .string()
          .describe("Project ID (from .gproj `ID` property, e.g. 'Test1', 'core')"),
      },
    },
    async ({ project_id }) => {
      try {
        const rows = index.listDependencies(project_id);
        const text = formatDependencies({ projectId: project_id, rows });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error listing dependencies: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
