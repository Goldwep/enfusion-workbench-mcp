import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus } from "../workbench/status.js";
import {
  isHandlerError,
  handlerErrorResponse,
  handlerErrorMessage,
} from "../workbench/response.js";
import { openResourceFailed } from "./wb-editor.js";

/**
 * Render the `list` response. The shape returned by the built-in
 * `GetLoadedProjects` NET API function is not verified against a live
 * Workbench (LIVE): render `projects` / `addons` arrays when present, otherwise
 * dump whatever keys arrived instead of claiming nothing is loaded.
 */
export function formatLoadedProjects(result: Record<string, unknown>): string {
  const list = Array.isArray(result.projects)
    ? result.projects
    : Array.isArray(result.addons)
      ? result.addons
      : null;

  if (list === null) {
    const keys = Object.keys(result).filter((k) => k !== "status");
    if (keys.length === 0) {
      return "**Loaded Projects** — handler returned an empty payload (no `projects`/`addons` key). The response shape of GetLoadedProjects is unverified; check Workbench directly.";
    }
    return (
      "**Loaded Projects** — response had no `projects`/`addons` array; raw payload:\n\n```json\n" +
      JSON.stringify(result, null, 2) +
      "\n```"
    );
  }

  if (list.length === 0) {
    return "**Loaded Projects** — the handler returned an empty list.";
  }

  const lines = [`**Loaded Projects** (${list.length})\n`];
  for (const proj of list) {
    if (typeof proj === "string") {
      lines.push(`- ${proj}`);
    } else if (typeof proj === "object" && proj !== null) {
      const p = proj as Record<string, unknown>;
      const pName = p.name || p.id || "(unnamed)";
      const pPath = p.path ? ` - ${p.path}` : "";
      const pGuid = p.guid ? ` (${p.guid})` : "";
      lines.push(`- **${pName}**${pPath}${pGuid}`);
    } else {
      lines.push(`- ${String(proj)}`);
    }
  }
  return lines.join("\n");
}

export function registerWbProjects(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_projects",
    {
      description:
        "Query project information from the Workbench. List all loaded addon projects, locate a specific project by name, or open a .gproj to load it into Workbench.",
      inputSchema: {
        action: z
          .enum(["list", "locate", "open"])
          .describe(
            "Action: list (all loaded projects), locate (find specific project path), or open (load a .gproj into Workbench)",
          ),
        name: z
          .string()
          .optional()
          .describe(
            "Project/addon name to locate (required for locate action), or .gproj file path (required for open action)",
          ),
      },
    },
    async ({ action, name }) => {
      try {
        if (action === "open") {
          if (!name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: `name` is required for the open action. Provide the .gproj file path or addon name.",
                },
              ],
              isError: true,
            };
          }

          const result = await client.call<Record<string, unknown>>("EMCP_WB_EditorControl", {
            action: "openResource",
            path: name,
          });
          if (openResourceFailed(result)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `**Project NOT opened**: ${name}\n${handlerErrorMessage(result)}${formatConnectionStatus(client)}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `**Project Opened**\n\nLoaded: ${name}${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        if (action === "locate") {
          if (!name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: `name` is required for the locate action.",
                },
              ],
              isError: true,
            };
          }

          const result = await client.call<Record<string, unknown>>("LocateProject", {
            name,
          });
          if (isHandlerError(result)) {
            return handlerErrorResponse(result, client, `Error locating project "${name}"`);
          }

          const path = result.path || result.projectPath || "(not found)";
          return {
            content: [
              {
                type: "text" as const,
                text: `**Project Located**\n\n- **Name:** ${name}\n- **Path:** ${path}${result.guid ? `\n- **GUID:** ${result.guid}` : ""}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        // list
        const result = await client.call<Record<string, unknown>>("GetLoadedProjects");
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, "Error listing projects");
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formatLoadedProjects(result) + formatConnectionStatus(client),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error querying projects (${action}): ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
