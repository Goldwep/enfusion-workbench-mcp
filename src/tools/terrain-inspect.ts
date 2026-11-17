/**
 * `terrain_inspect` — 1.x extended terrain tool (Node-side wrapper).
 *
 * Calls the `EMCP_WB_Terrain.c` Enforce handler with `action: "inspect"`.
 * The handler reads the world that is OPEN in the World Editor and answers
 * its terrain bounds (or null); it does not load `world_path`. So the tool
 * first asks `EMCP_WB_World` state which world is open and refuses when
 * `world_path` names a different one, instead of labelling the open world's
 * bounds with the asked path. Tile counts, textures and the rest are in
 * `wb_terrain info` / `tile`.
 *
 * See `docs/L7-PLAN.md` for the handler architecture + dispatch contract.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { sameWorld } from "./terrain-road-export-graph.js";

interface TerrainInspectResponse {
  status?: string;
  /** The handler's refusal text (EMCP_WB_Terrain sets `message`, not `error`). */
  message?: string;
  error?: string;
  payload?: string;
}

interface WorldStateResponse {
  status?: string;
  message?: string;
  worldPath?: string;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatTerrainSummary(input: {
  worldPath: string;
  data: Record<string, unknown>;
  openWorld?: string;
}): string {
  const { worldPath, data, openWorld } = input;
  const lines: string[] = [];
  lines.push(`## terrain_inspect: ${worldPath}`);
  lines.push("");
  const readFrom = typeof data.open_world === "string" && data.open_world ? data.open_world : openWorld;
  if (readFrom) lines.push(`- **Open world:** ${readFrom}`);
  const fields = [
    ["Bounds", data.bounds],
    ["Tile count", data.tile_count],
    ["Layer textures", data.layer_textures],
    ["Roads", data.road_count],
    ["Rivers", data.river_count],
    ["Biome", data.biome],
    ["Last navmesh bake", data.navmesh_last_baked],
  ];
  if (data.bounds === null) lines.push("- **Bounds:** none (the open world has no terrain)");
  for (const [label, value] of fields) {
    if (value !== undefined && value !== null) {
      lines.push(`- **${label}:** ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    }
  }
  return lines.join("\n");
}

const err = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

// ── Registration ─────────────────────────────────────────────────────────────

export function registerTerrainInspect(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "terrain_inspect",
    {
      description:
        "Terrain bounds of the world open in the World Editor; world_path must name that world (refused otherwise). " +
        "Requires Workbench running with the EMCP_WB_Terrain.c handler. Tiles, resolution and land area: wb_terrain info.",
      inputSchema: {
        world_path: z
          .string()
          .describe("Path to the world `.ent` to inspect (e.g. 'worlds/MP/MyMap.ent')"),
      },
    },
    async ({ world_path }) => {
      try {
        if (world_path.startsWith("-")) {
          return err("Invalid world_path: must not start with '-'");
        }
        // Bound: client.call reads `this` (the lease claim); a bare reference threw live (W1, 2026-11-14).
        const call = client.call.bind(client) as <T>(
          method: string,
          args: Record<string, unknown>,
          opts?: unknown,
        ) => Promise<T>;

        // The handler reads the open world: check it is the one asked for.
        const state = await call<WorldStateResponse>("EMCP_WB_World", { action: "state" }, { access: "read" });
        if (state?.status !== "ok") {
          return err(`terrain_inspect: wb_world state failed: ${state?.message || "(no message)"}`);
        }
        const openWorld = String(state.worldPath ?? "");
        if (!openWorld) {
          return err(
            "terrain_inspect: no world is open in the World Editor. Open it first (wb_module setResource).",
          );
        }
        if (!sameWorld(openWorld, world_path)) {
          return err(
            `terrain_inspect: the open world is ${openWorld}, not ${world_path}; terrain is read from the open world. ` +
              "Open the world first (wb_module setResource).",
          );
        }

        // Dispatch to the EMCP_WB_Terrain handler via the workbench client.
        let response: TerrainInspectResponse;
        try {
          response = await call<TerrainInspectResponse>("EMCP_WB_Terrain", {
            action: "inspect",
            world_path,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.toLowerCase().includes("unknown") || msg.toLowerCase().includes("not found")) {
            return err(
              `EMCP_WB_Terrain handler not deployed in Workbench. ` +
                `Deploy mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c (see docs/L7-PLAN.md) and reload the editor. ` +
                `Underlying error: ${msg}`,
            );
          }
          throw e;
        }
        if (response.status === "error") {
          return err(`EMCP handler returned error: ${response.message || response.error || "(no message)"}`);
        }
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(response.payload ?? "{}") as Record<string, unknown>;
        } catch {
          data = { raw: response.payload ?? "" };
        }
        // The handler names the world it read (open_world). If another world
        // was opened between the state call and inspect, refuse rather than
        // label that world's bounds with world_path.
        const readFrom = typeof data.open_world === "string" ? data.open_world : "";
        if (readFrom && !sameWorld(readFrom, world_path)) {
          return err(
            `terrain_inspect: the bounds were read from ${readFrom}, not ${world_path}; the open world changed. Try again.`,
          );
        }
        return {
          content: [
            {
              type: "text" as const,
              text: formatTerrainSummary({ worldPath: world_path, data, openWorld }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(`Error in terrain_inspect: ${msg}`);
      }
    },
  );
}
