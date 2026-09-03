/**
 * `server_scenario_picker` — enumerate the official BI scenarios plus any
 * user-project mission headers, returning a markdown table the user (or
 * an LLM) can use to fill in a scenarioId field.
 *
 * MCP wrapper around `src/server-mgmt/scenario-picker.ts`. Pure read; no
 * spawn or network.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { ProjectIndex } from "../project-index/project-index.js";
import { buildScenarioPickerReport } from "../server-mgmt/scenario-picker.js";

export function registerServerScenarioPicker(
  server: McpServer,
  config: Config,
  index: ProjectIndex,
): void {
  server.registerTool(
    "server_scenario_picker",
    {
      description:
        "List available mission scenarios: the curated catalog of official Bohemia scenarios " +
        "(Conflict, Game Master, Combat Ops, Tutorial), plus any `SCR_MissionHeader*` .conf files " +
        "found under your project's Missions/ subdirectories. Set `include_workshop` to also scan " +
        "the workshop addons directory. Returns a markdown table per source.",
      inputSchema: {
        include_workshop: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true, also scan the workshop addons directory for mission .conf files. " +
              "Default false because workshop directories can be large.",
          ),
      },
    },
    async ({ include_workshop }) => {
      try {
        const text = buildScenarioPickerReport(config, index, {
          includeWorkshop: include_workshop ?? false,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error listing scenarios: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
