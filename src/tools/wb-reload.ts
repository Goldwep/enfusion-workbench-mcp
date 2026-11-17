import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { routeAlias } from "../manifest/aliases.js";
import { runScripts, toToolResult, type ScriptsArgs } from "./wb-scripts.js";

/**
 * `wb_reload` — alias of `wb_scripts reload` (aliases.ts). The 1.x `target`
 * moves to `scope`; only `scripts` has a native (ReloadScripts), so
 * `plugins` and `both` are refused with INVALID_ARGUMENT.
 */
export function registerWbReload(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_reload",
    {
      description:
        "Alias of wb_scripts reload: ReloadScripts, then a re-ping.\n" +
        "Mutating: reloads the scripts; refused while a mutating call is pending; a failed reload keeps the old handlers.",
      inputSchema: {
        target: z
          .enum(["scripts", "plugins", "both"])
          .default("scripts")
          .describe("Only 'scripts' is supported"),
      },
      annotations: {
        title: "Reload scripts",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ target }) => {
      const routed = routeAlias("wb_reload", { target });
      if (!routed) throw new Error("wb_reload alias is not routed");
      return toToolResult(await runScripts(client, routed.args as unknown as ScriptsArgs));
    },
  );
}
