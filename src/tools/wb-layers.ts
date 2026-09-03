import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus, requireEditMode } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse, modeGateResponse } from "../workbench/response.js";

// Only actions EMCP_WB_Layers.c actually implements. The public WorldEditorAPI
// has no layer create/delete/rename/setActive/setVisibility — those were
// removed from the enum rather than routed to a handler that rejects them.
const LAYER_ACTIONS = [
  "list",
  "getActive",
  "getEntityLayer",
  "isVisible",
  "getInfo",
  "toggleLock",
] as const;

const MUTATING_LAYER_ACTIONS = new Set(["toggleLock"]);
const LAYER_ID_ACTIONS = new Set(["isVisible", "getInfo", "toggleLock"]);

export function registerWbLayers(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_layers",
    {
      description:
        "Query layers in the World Editor. List layers (by numeric ID with entity counts), get the active sub-scene, find which layer an entity is on, query a layer's visibility/lock state, get layer info, or toggle a layer's lock. toggleLock only works in edit mode. Layers are identified by numeric ID (from list), not by path.",
      inputSchema: {
        action: z.enum(LAYER_ACTIONS).describe("Layer action to perform"),
        subScene: z.number().default(0).describe("SubScene index (default 0, the main scene)"),
        layerID: z
          .number()
          .int()
          .optional()
          .describe("Numeric layer ID (from list). Required for isVisible, getInfo, toggleLock."),
        entityName: z.string().optional().describe("Entity name (required for getEntityLayer)"),
      },
    },
    async ({ action, subScene, layerID, entityName }) => {
      if (MUTATING_LAYER_ACTIONS.has(action)) {
        const modeErr = requireEditMode(client, `${action} layer`);
        if (modeErr) {
          return modeGateResponse(modeErr, client);
        }
      }
      try {
        if (LAYER_ID_ACTIONS.has(action) && layerID === undefined) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: \`layerID\` is required for the "${action}" action (use \`list\` to find IDs).`,
              },
            ],
            isError: true,
          };
        }
        if (action === "getEntityLayer" && !entityName) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: `entityName` is required for the getEntityLayer action.",
              },
            ],
            isError: true,
          };
        }

        const params: Record<string, unknown> = { action, subScene };
        // Handler takes the layer ID through its `layerPath` string field and
        // parses it with ToInt().
        if (layerID !== undefined) params.layerPath = String(layerID);
        if (entityName) params.entityName = entityName;

        const result = await client.call<Record<string, unknown>>("EMCP_WB_Layers", params);
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, `Error managing layers (${action})`);
        }

        if (action === "list") {
          const layers = Array.isArray(result.layers) ? result.layers : [];
          if (layers.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `**No layers found.**${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
                },
              ],
            };
          }

          const lines = [`**Layers** (sub-scene ${result.currentSubScene ?? subScene})\n`];
          for (const layer of layers) {
            const l = layer as Record<string, unknown>;
            const count = l.entityCount !== undefined ? ` (${l.entityCount} entities)` : "";
            lines.push(`- Layer ID **${l.layerID ?? "?"}**${count}`);
          }
          if (result.message) lines.push(`\n${result.message}`);

          return {
            content: [
              { type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) },
            ],
          };
        }

        if (action === "getActive") {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Active Sub-Scene:** ${result.currentSubScene ?? "(unknown)"}${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        if (action === "getEntityLayer") {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Entity Layer**\n\n- **Entity:** ${entityName}\n- **Layer ID:** ${result.layerID ?? "(unknown)"}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        if (action === "isVisible" || action === "getInfo") {
          const lines = [`**Layer ${result.layerID ?? layerID}**\n`];
          if (result.layerVisible !== undefined)
            lines.push(`- **Visible:** ${result.layerVisible}`);
          if (result.layerLocked !== undefined) lines.push(`- **Locked:** ${result.layerLocked}`);
          if (result.layerActive !== undefined) lines.push(`- **Active:** ${result.layerActive}`);
          if (result.layerEntityCount !== undefined)
            lines.push(`- **Entities:** ${result.layerEntityCount}`);
          return {
            content: [
              { type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) },
            ],
          };
        }

        // toggleLock
        const nowLocked = result.layerLocked;
        return {
          content: [
            {
              type: "text" as const,
              text: `**Layer Lock Toggled**\n\nLayer ${result.layerID ?? layerID} is now ${nowLocked ? "locked" : "unlocked"}${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing layers (${action}): ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
