import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse } from "../workbench/response.js";

/**
 * Render the `list` response. The shape returned by the built-in
 * `GetLoadedProjects` NET API function is not verified against a live
 * Workbench (LIVE): render `Loaded Projects` / `projects` / `addons` arrays when present, otherwise
 * dump whatever keys arrived instead of claiming nothing is loaded.
 */
export function formatLoadedProjects(result: Record<string, unknown>): string {
  // Live-verified 2026-09-03: the built-in GetLoadedProjects returns
  // { "Loaded Projects": ["ArmaReforger", "Test1_sandbox"] }.
  const loaded = (result as Record<string, unknown>)["Loaded Projects"];
  const list = Array.isArray(loaded)
    ? loaded
    : Array.isArray(result.projects)
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

/**
 * True for an in-payload failure from either handler family. Bohemia's NET
 * handlers (LocateProject, LocatePrefabsFromPath, GetPrefabGUID) report
 * failure as `status: "ERROR"` in upper case, which `isHandlerError` does not
 * match; the EMCP_WB_* handlers use lower-case `"error"`.
 */
export function isBiHandlerError(result: unknown): boolean {
  if (isHandlerError(result)) return true;
  if (typeof result !== "object" || result === null) return false;
  const status = (result as Record<string, unknown>).status;
  return typeof status === "string" && status.toUpperCase() === "ERROR";
}

/**
 * Why `open` refuses (live-tools-b-3): the only call it had, EditorControl openResource, hands a
 * .gproj to the Resource Manager (ResourceManager.SetOpenedResource), which neither loads nor
 * switches the project, and nothing reads back that a project was loaded. A running Workbench
 * loads its project at launch; wb_launch gprojPath is the route that opens one.
 */
export const OPEN_REFUSAL =
  "**Project NOT opened**: wb_projects open cannot load or switch a project in a running Workbench. " +
  "The NET API has no project-switch call; opening a .gproj as a resource only selects it in the " +
  "Resource Manager. Nothing was sent.\n\n" +
  "To work on another project: save your work, close Workbench, then wb_launch gprojPath:<the .gproj>. " +
  "wb_projects list shows the projects loaded now.";

export function registerWbProjects(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_projects",
    {
      description:
        "Query project information from the Workbench. List all loaded addon projects, or find which loaded addon contains an absolute path (locate; not verified live). open refuses: a running Workbench cannot switch project; use wb_launch gprojPath.",
      inputSchema: {
        action: z
          .enum(["list", "locate", "open"])
          .describe(
            "Action: list (all loaded projects), locate (name + root path of the loaded addon that contains an absolute path), or open (refused; it says how to open a project: wb_launch)",
          ),
        name: z
          .string()
          .optional()
          .describe(
            "For locate (required): an absolute file or folder path inside a loaded addon; Bohemia's LocateProject takes a path, not an addon name. For open: ignored",
          ),
      },
    },
    async ({ action, name }) => {
      try {
        if (action === "open") {
          // Nothing is sent: no supported call switches the project (OPEN_REFUSAL).
          return {
            content: [
              {
                type: "text" as const,
                text: `${OPEN_REFUSAL}${name ? `\nRequested: ${name}` : ""}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
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

          // Bohemia's LocateProject declares one request field, `path` (an
          // absolute path), and answers { status, message, projectName,
          // projectPath } for the loaded addon that contains it
          // (AssetLibraryUtils.c:53-78, 80-108). Not verified live.
          const result = await client.call<Record<string, unknown>>("LocateProject", {
            path: name,
          });
          if (isBiHandlerError(result)) {
            return handlerErrorResponse(
              result,
              client,
              `Error locating project containing "${name}" (locate needs an absolute path inside a loaded addon)`,
            );
          }

          const projectName = result.projectName || "(not reported)";
          const projectPath = result.projectPath || "(not reported)";
          return {
            content: [
              {
                type: "text" as const,
                text: `**Project Located**\n\n- **Queried path:** ${name}\n- **Project:** ${projectName}\n- **Project path:** ${projectPath}\n\n_Not verified live._${formatConnectionStatus(client)}`,
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
