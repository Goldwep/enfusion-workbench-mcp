/**
 * `terrain_navmesh_status`: the 1.x name of `wb_navmesh status` (W5 OD-1, DEC-068).
 *
 * The 1.x tool called `EMCP_WB_Terrain { action: "navmesh_status", world_path }`, a placeholder
 * that always answered "not implemented" (the Terrain branch is kept, and its census rows are
 * subsumed by EMCP_WB_Navmesh). The alias routes through aliases.ts to wb_navmesh status, which
 * reads the navmesh of the world open in the World Editor: `world_path` has no equivalent and is
 * refused, never dropped. Listed only under ENFUSION_TOOLSET=all (tier alias).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { routeAlias } from "../manifest/aliases.js";
import { VocabularyError, errorResponse } from "../manifest/vocabulary.js";
import { runNavmesh, toToolResult } from "./wb-navmesh.js";

export function registerTerrainNavmeshStatus(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "terrain_navmesh_status",
    {
      description:
        "Alias of wb_navmesh status: navmesh tile coverage (loaded, valid, requested) of the world open in the World Editor, through its AIWorld. " +
        "Open the world first; world_path is refused (no equivalent).",
      inputSchema: {
        world_path: z
          .string()
          .optional()
          .describe("1.x key, refused when given: wb_navmesh reads the open world."),
        project: z.string().optional().describe("Navmesh project (wb_navmesh status)."),
        step: z.string().optional().describe("Grid step in metres (wb_navmesh status)."),
        cursor: z.string().optional().describe("Cursor from the last page."),
        limit: z.number().int().optional().describe("Grid points per page."),
      },
    },
    async (args) => {
      try {
        const routed = routeAlias("terrain_navmesh_status", args as Record<string, unknown>);
        if (!routed) throw new Error("terrain_navmesh_status alias is not routed");
        return toToolResult(await runNavmesh(client, routed.args));
      } catch (e) {
        if (e instanceof VocabularyError) {
          return toToolResult(errorResponse("status", "open:WorldEditor", e.code, e.message));
        }
        throw e;
      }
    },
  );
}
