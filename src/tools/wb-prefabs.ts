import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus, requireEditMode } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse, modeGateResponse } from "../workbench/response.js";

const MUTATING_PREFAB_ACTIONS = new Set(["createTemplate", "save"]);

export function registerWbPrefabs(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_prefabs",
    {
      description:
        "Prefab operations in the Workbench. Create entity templates, save prefab changes, look up prefab GUIDs, or locate prefabs by path. createTemplate/save only work in edit mode.",
      inputSchema: {
        action: z
          .enum(["createTemplate", "save", "getGuid", "locate", "getAncestor"])
          .describe(
            "Action: createTemplate (create .et from entity), save (save prefab changes), getGuid (look up GUID), locate (find prefabs in path), getAncestor (get the ancestor prefab path of a scene entity)",
          ),
        entityName: z
          .string()
          .optional()
          .describe("Entity name (required for createTemplate and save)"),
        templatePath: z
          .string()
          .optional()
          .describe("Output path for createTemplate (e.g., 'Prefabs/Custom/MyEntity.et')"),
        addonName: z
          .string()
          .optional()
          .describe(
            "Addon name for createTemplate. templatePath is resolved as $addonName:templatePath inside that addon (absolute, drive-letter and '..' paths are refused by the handler). Required if the handler reports the bare relative path does not resolve.",
          ),
        searchPath: z
          .string()
          .optional()
          .describe("Directory path for locate (e.g., 'Prefabs/Weapons')"),
      },
    },
    async ({ action, entityName, templatePath, searchPath, addonName }) => {
      if (MUTATING_PREFAB_ACTIONS.has(action)) {
        const modeErr = requireEditMode(
          client,
          `${action === "createTemplate" ? "create template" : "save prefab"}`,
        );
        if (modeErr) {
          return modeGateResponse(modeErr, client);
        }
      }
      try {
        if (action === "getGuid") {
          if (!templatePath && !searchPath) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Provide `templatePath` (prefab resource path) for getGuid.",
                },
              ],
              isError: true,
            };
          }

          const result = await client.call<Record<string, unknown>>("GetPrefabGUID", {
            path: templatePath || searchPath,
          });
          if (isHandlerError(result)) {
            return handlerErrorResponse(result, client, "Error looking up prefab GUID");
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `**Prefab GUID**\n\n- **Path:** ${templatePath || searchPath}\n- **GUID:** ${result.guid || result.GUID || "(not found)"}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        if (action === "locate") {
          if (!searchPath) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Provide `searchPath` for the locate action.",
                },
              ],
              isError: true,
            };
          }

          const result = await client.call<Record<string, unknown>>("LocatePrefabsFromPath", {
            path: searchPath,
          });
          if (isHandlerError(result)) {
            return handlerErrorResponse(
              result,
              client,
              `Error locating prefabs in "${searchPath}"`,
            );
          }

          const prefabs = Array.isArray(result.prefabs) ? result.prefabs : [];
          if (prefabs.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `**No prefabs found** in: ${searchPath}${formatConnectionStatus(client)}`,
                },
              ],
            };
          }

          const lines = [`**Prefabs in ${searchPath}** (${prefabs.length})\n`];
          for (const p of prefabs) {
            if (typeof p === "string") {
              lines.push(`- ${p}`);
            } else {
              const pObj = p as Record<string, unknown>;
              lines.push(`- ${pObj.path || pObj.name || JSON.stringify(pObj)}`);
            }
          }
          return {
            content: [
              { type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) },
            ],
          };
        }

        if (action === "getAncestor") {
          if (!entityName) {
            return {
              content: [
                { type: "text" as const, text: "Error: `entityName` is required for getAncestor." },
              ],
              isError: true,
            };
          }
          const result = await client.call<{
            status: string;
            ancestorPath?: string;
            message?: string;
          }>("EMCP_WB_Prefabs", { action: "getAncestor", entityName });
          if (isHandlerError(result)) {
            return handlerErrorResponse(
              result,
              client,
              `Error getting ancestor of "${entityName}"`,
            );
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `**Ancestor Prefab**\n\n- **Entity:** ${entityName}\n- **Ancestor:** ${result.ancestorPath || "(none)"}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        // createTemplate and save use EMCP_WB_Prefabs
        if ((action === "createTemplate" || action === "save") && !entityName) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: \`entityName\` is required for the "${action}" action.`,
              },
            ],
            isError: true,
          };
        }

        const params: Record<string, unknown> = { action, entityName };
        if (templatePath) params.templatePath = templatePath;
        if (addonName) params.addonName = addonName;

        const result = await client.call<Record<string, unknown>>("EMCP_WB_Prefabs", params);
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, `Error with prefab operation (${action})`);
        }

        // Handler emits entityName (+ message); no path/guid keys.
        const resolvedName = result.entityName || entityName;
        if (action === "createTemplate") {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Template Created**\n\n- **Entity:** ${resolvedName}\n- **Path:** ${templatePath || "(auto)"}${result.message ? `\n- **Note:** ${result.message}` : ""}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        // save
        return {
          content: [
            {
              type: "text" as const,
              text: `**Prefab Saved**\n\n- **Entity:** ${resolvedName}${result.message ? `\n- **Note:** ${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error with prefab operation (${action}): ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
