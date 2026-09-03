/**
 * `terrain_inspect` — first L7 live-Workbench tool (Node-side wrapper).
 *
 * Calls into the planned `EMCP_WB_Terrain.c` Enforce-side handler with
 * `action: "inspect"`. Returns aggregated terrain info: bounds, tile
 * count, layer textures, road count, river count, biome refs.
 *
 * STATUS: Node-side ships now as L7's first wrapper. The EMCP_WB_Terrain
 * Enforce handler is the load-bearing next-session deliverable. Until it
 * lands, the tool degrades to a clear "EMCP handler not deployed" error
 * so users get an actionable signal rather than an opaque timeout.
 *
 * See `docs/L7-PLAN.md` for the handler architecture + dispatch contract.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";

interface TerrainInspectResponse {
  status?: string;
  error?: string;
  payload?: string;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatTerrainSummary(input: {
  worldPath: string;
  data: Record<string, unknown>;
}): string {
  const { worldPath, data } = input;
  const lines: string[] = [];
  lines.push(`## terrain_inspect: ${worldPath}`);
  lines.push("");
  const fields = [
    ["Bounds", data.bounds],
    ["Tile count", data.tile_count],
    ["Layer textures", data.layer_textures],
    ["Roads", data.road_count],
    ["Rivers", data.river_count],
    ["Biome", data.biome],
    ["Last navmesh bake", data.navmesh_last_baked],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined && value !== null) {
      lines.push(`- **${label}:** ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    }
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerTerrainInspect(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "terrain_inspect",
    {
      description:
        "Inspect a Reforger world's terrain — bounds, tile count, layer textures, road/river counts, biome, navmesh status. " +
        "Requires Workbench running + the EMCP_WB_Terrain.c Enforce handler deployed (ships next session). " +
        "Returns a clear 'EMCP handler not deployed' error if the handler is absent.",
      inputSchema: {
        world_path: z
          .string()
          .describe("Path to the world `.ent` to inspect (e.g. 'worlds/MP/MyMap.ent')"),
      },
    },
    async ({ world_path }) => {
      try {
        if (world_path.startsWith("-")) {
          return {
            content: [{ type: "text" as const, text: "Invalid world_path: must not start with '-'" }],
            isError: true,
          };
        }
        // Dispatch to the EMCP_WB_Terrain handler via the workbench client.
        // The handler may not be deployed yet — surface that cleanly.
        let response: TerrainInspectResponse;
        try {
          response = await (client.call as (
            method: string,
            args: Record<string, unknown>,
          ) => Promise<TerrainInspectResponse>)("EMCP_WB_Terrain", {
            action: "inspect",
            world_path,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.toLowerCase().includes("unknown") || msg.toLowerCase().includes("not found")) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `EMCP_WB_Terrain handler not deployed in Workbench. ` +
                    `Deploy mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c (see docs/L7-PLAN.md) and reload the editor. ` +
                    `Underlying error: ${msg}`,
                },
              ],
              isError: true,
            };
          }
          throw e;
        }
        if (response.status === "error") {
          return {
            content: [{ type: "text" as const, text: `EMCP handler returned error: ${response.error ?? "(no message)"}` }],
            isError: true,
          };
        }
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(response.payload ?? "{}") as Record<string, unknown>;
        } catch {
          data = { raw: response.payload ?? "" };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: formatTerrainSummary({ worldPath: world_path, data }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error in terrain_inspect: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
