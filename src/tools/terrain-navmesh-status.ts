/**
 * `terrain_navmesh_status` — Node-side wrapper for the L7 navmesh
 * coverage query.
 *
 * Calls `EMCP_WB_Terrain { action: "navmesh_status", world_path }`.
 * Currently the Enforce handler returns `status: "not_implemented"`
 * (see `mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c`); next
 * session wires it to `NavmeshWorldComponent.IsTileLoaded / IsTileValid /
 * IsTileRequested` over a tile grid spanning the world bounds.
 *
 * This tool ships now so the next-session work is purely Enforce-side —
 * Node-side surface stays stable.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";

interface NavmeshStatusResponse {
  status?: string;
  message?: string;
  payload?: string;
}

export function registerTerrainNavmeshStatus(
  server: McpServer,
  client: WorkbenchClient,
): void {
  server.registerTool(
    "terrain_navmesh_status",
    {
      description:
        "Report navmesh tile coverage for a world (loaded / valid / requested counts + bake recency). " +
        "Requires Workbench + the EMCP_WB_Terrain.c `navmesh_status` action — currently a placeholder " +
        "(see docs/L7-PLAN.md). Returns a structured 'not implemented' message until the handler ships.",
      inputSchema: {
        world_path: z.string().describe("Path to the world `.ent` to query"),
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
        const resp = (await (client.call as (
          m: string,
          a: Record<string, unknown>,
        ) => Promise<NavmeshStatusResponse>)("EMCP_WB_Terrain", {
          action: "navmesh_status",
          world_path,
        })) ?? {};
        if (
          resp.status === "not_implemented" ||
          (resp.status === "error" && String(resp.message ?? "").startsWith("not implemented"))
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Navmesh status query is not yet implemented in the Workbench-side handler. ` +
                  `Tracking: docs/L7-PLAN.md (L7-1 EMCP_WB_Terrain navmesh_status). ` +
                  `Underlying message: ${resp.message ?? "(none)"}`,
              },
            ],
          };
        }
        if (resp.status !== "ok") {
          return {
            content: [{ type: "text" as const, text: `Handler error: ${resp.message ?? "(no message)"}` }],
            isError: true,
          };
        }
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(resp.payload ?? "{}") as Record<string, unknown>;
        } catch {
          data = { raw: resp.payload ?? "" };
        }
        const lines: string[] = [];
        lines.push(`## terrain_navmesh_status: ${world_path}`);
        lines.push("");
        for (const [k, v] of Object.entries(data)) {
          lines.push(`- **${k}:** ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error in terrain_navmesh_status: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
