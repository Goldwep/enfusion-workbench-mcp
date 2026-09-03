import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse } from "../workbench/response.js";

export function registerWbTerrain(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_terrain",
    {
      description:
        "Query terrain information. Get the terrain height at a world coordinate or get the world bounds (min/max extents).",
      inputSchema: {
        action: z
          .enum(["getHeight", "getBounds"])
          .describe("Action: getHeight (sample terrain Y at x,z) or getBounds (world extents)"),
        x: z.number().optional().describe("World X coordinate (required for getHeight)"),
        z: z.number().optional().describe("World Z coordinate (required for getHeight)"),
      },
    },
    async ({ action, x, z: zCoord }) => {
      try {
        if (action === "getHeight" && (x === undefined || zCoord === undefined)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: `x` and `z` coordinates are required for getHeight.",
              },
            ],
            isError: true,
          };
        }

        // Send x/z as strings — Enfusion RegV for float ignores JSON integers
        // (no decimal point), so "6400" as a number → 0.0, but "6400" as a string → parsed via ToFloat()
        const params: Record<string, unknown> = { action };
        if (x !== undefined) params.x = String(x);
        if (zCoord !== undefined) params.z = String(zCoord);

        const result = await client.call<Record<string, unknown>>("EMCP_WB_Terrain", params);
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, `Error querying terrain (${action})`);
        }

        if (action === "getHeight") {
          // Handler emits `height` (float). Never print a default when it is
          // absent — an error path must not read as "Height 0".
          if (typeof result.height !== "number") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `**Terrain Height unavailable** at (${x}, ${zCoord}): handler returned no \`height\` field.${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `**Terrain Height**\n\n- **Position:** (${x}, ${zCoord})\n- **Height (Y):** ${result.height}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        // getBounds — handler emits boundsMin / boundsMax as "x y z" strings.
        const boundsMin = typeof result.boundsMin === "string" ? result.boundsMin : undefined;
        const boundsMax = typeof result.boundsMax === "string" ? result.boundsMax : undefined;
        if (!boundsMin || !boundsMax) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**World Bounds unavailable**: handler returned no boundsMin/boundsMax.${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }

        const lines = ["**World Bounds**\n"];
        lines.push(`- **Min (x y z):** ${boundsMin}`);
        lines.push(`- **Max (x y z):** ${boundsMax}`);
        const minParts = boundsMin.trim().split(/\s+/).map(Number);
        const maxParts = boundsMax.trim().split(/\s+/).map(Number);
        if (
          minParts.length === 3 &&
          maxParts.length === 3 &&
          ![...minParts, ...maxParts].some(Number.isNaN)
        ) {
          lines.push(`- **Size X:** ${maxParts[0]! - minParts[0]!}`);
          lines.push(`- **Size Z:** ${maxParts[2]! - minParts[2]!}`);
        }

        return {
          content: [
            { type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error querying terrain: ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
