/**
 * `terrain_road_export_graph` — emit the world's road network as a
 * graph (nodes + edges + widths) for downstream analysis or rendering.
 *
 * Calls `EMCP_WB_Terrain { action: "road_export_graph" }`. Handler
 * placeholder; next session wires to `RoadNetworkManager.GetRoadsInAABB`
 * + per-road `GetPoints + GetWidth`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";

interface RoadGraphResponse {
  status?: string;
  message?: string;
  payload?: string;
}

export function registerTerrainRoadExportGraph(
  server: McpServer,
  client: WorkbenchClient,
): void {
  server.registerTool(
    "terrain_road_export_graph",
    {
      description:
        "Export the world's road network as a graph (nodes + edges + widths). " +
        "Each road becomes a polyline with width per segment; intersections detected via spatial-hash. " +
        "Useful for mission planning (where can vehicles drive?) and road-validation audit. " +
        "Handler placeholder; next session wires to RoadNetworkManager APIs.",
      inputSchema: {
        world_path: z.string().describe("Path to the world `.ent` to extract roads from"),
        format: z
          .enum(["json", "mermaid"])
          .default("json")
          .describe("Output format. json = raw graph data; mermaid = visualizable diagram"),
      },
    },
    async ({ world_path, format }) => {
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
        ) => Promise<RoadGraphResponse>)("EMCP_WB_Terrain", {
          action: "road_export_graph",
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
                  `Road graph export is not yet implemented in the Workbench handler. ` +
                  `Tracking: docs/L7-PLAN.md (L7-1 EMCP_WB_Terrain road_export_graph). ` +
                  `Will use RoadNetworkManager.GetRoadsInAABB once wired.`,
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
        let data: { nodes?: unknown[]; edges?: unknown[] } = {};
        try {
          data = JSON.parse(resp.payload ?? "{}");
        } catch {
          /* leave empty */
        }
        const lines: string[] = [];
        lines.push(`## terrain_road_export_graph: ${world_path} (${format})`);
        lines.push("");
        if (format === "json") {
          lines.push("```json");
          lines.push(JSON.stringify(data, null, 2));
          lines.push("```");
        } else {
          // Render as a simple mermaid graph; nodes are connection points,
          // edges connect via road IDs.
          lines.push("```mermaid");
          lines.push("graph LR");
          const edges = (data.edges ?? []) as Array<{ from: string; to: string; width?: number }>;
          for (const e of edges) {
            const label = e.width !== undefined ? `|w=${e.width}m|` : "";
            lines.push(`  ${e.from} -->${label} ${e.to}`);
          }
          lines.push("```");
        }
        lines.push("");
        lines.push(`Nodes: ${(data.nodes ?? []).length}, Edges: ${(data.edges ?? []).length}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error in terrain_road_export_graph: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
