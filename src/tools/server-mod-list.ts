/**
 * `server_mod_list` — list and resolve a server.json's `game.mods[]`
 * entries against the project-index. MCP wrapper around the L8 server-mgmt
 * mod-list core.
 *
 * Read-only, no spawn. The only risk vector is the path input, which goes
 * through `rejectFlagLikePath` before `resolve()`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProjectIndex } from "../project-index/project-index.js";
import { buildModListReport } from "../server-mgmt/mod-list.js";

export function registerServerModList(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "server_mod_list",
    {
      description:
        "Read a server.json and list every entry in its `game.mods[]` block, resolving each modId " +
        "against the project-index to show which mods are present in the crawled sources " +
        "(user / core / workshop) and which are unknown. Output is markdown; passwords from the " +
        "config are never echoed.",
      inputSchema: {
        server_config_path: z
          .string()
          .describe("Absolute path to the server.json to read."),
      },
    },
    async ({ server_config_path }) => {
      try {
        const text = buildModListReport(server_config_path, index);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error listing server mods: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
