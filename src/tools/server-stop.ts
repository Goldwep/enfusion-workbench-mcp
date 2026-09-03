/**
 * `server_stop` — MCP wrapper that terminates an ArmaReforgerServer.exe
 * launched by `server_launch`.
 *
 * Behavior:
 *   - Derives the PID file path from `server_config_path` (same rule as
 *     `server_launch`: `<dirname>/.arma-reforger-server.pid`).
 *   - Calls `stopServer` from `src/server-mgmt/stop.ts`.
 *   - Formats the structured result as markdown.
 *
 * Security:
 *   - `rejectFlagLikePath` on the path input BEFORE `resolve()`.
 *   - PID is parsed as an integer from our own JSON file — never an LLM
 *     string. No shell anywhere on the stop path.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import type { Config } from "../config.js";
import { pidFilePathFor } from "../server-mgmt/launch.js";
import { rejectFlagLikePath } from "../server-mgmt/redact-io.js";
import { stopServer } from "../server-mgmt/stop.js";
import { logger } from "../utils/logger.js";

export function registerServerStop(server: McpServer, _config: Config): void {
  server.registerTool(
    "server_stop",
    {
      description:
        "Terminate an ArmaReforgerServer.exe previously launched by `server_launch` against the same server.json. " +
        "Reads the PID file at `<dirname(server_config_path)>/.arma-reforger-server.pid`, sends SIGTERM, " +
        "polls for exit up to `timeout_ms` (default 5000), and falls back to a force-kill (taskkill /F /T on Windows, " +
        "SIGKILL on POSIX) if needed. Reports `not_running` when no live process matches the PID file.",
      inputSchema: {
        server_config_path: z
          .string()
          .describe(
            "Absolute path to the server.json the running server was launched with. " +
              "Used only to derive the PID-file path next to it.",
          ),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(60_000)
          .optional()
          .default(5000)
          .describe(
            "Time budget for the graceful SIGTERM wait before falling back to a force-kill. Default 5000.",
          ),
      },
    },
    async ({ server_config_path, timeout_ms }) => {
      try {
        rejectFlagLikePath(server_config_path, "server_config_path");
        const absoluteConfigPath = resolve(server_config_path);
        const pidFilePath = pidFilePathFor(absoluteConfigPath);

        logger.info(
          `[server_stop] attempting stop via PID file ${pidFilePath} (timeout=${timeout_ms}ms)`,
        );

        const result = await stopServer({
          pidFilePath,
          timeout_ms,
        });

        // Compose a markdown response keyed off the status.
        const header = `## server_stop — \`${result.status}\``;
        const pidLine =
          typeof result.pid === "number"
            ? `**PID:** ${result.pid}\n`
            : "";
        const startedLine = result.pidFileContents
          ? `**Started:** ${result.pidFileContents.started_at}\n` +
            `**Scenario:** \`${result.pidFileContents.scenario_id}\`\n`
          : "";
        const pidFileLine = `**PID file:** \`${pidFilePath}\`\n`;
        const detailLine = result.detail ? `\n_${result.detail}_\n` : "";

        let summary: string;
        switch (result.status) {
          case "stopped":
            summary =
              "Server process exited cleanly after SIGTERM. PID file removed.";
            break;
          case "force_killed":
            summary =
              "Server did not exit on SIGTERM within the timeout; force-killed and PID file removed.";
            break;
          case "not_running":
            summary =
              "No live server matched the PID file (either it was already gone or the file was missing).";
            break;
          case "timeout":
            summary =
              "WARNING: Server is still alive after SIGTERM + force-kill within the timeout. " +
              "PID file kept in place — re-run `server_stop` or kill the PID manually.";
            break;
        }

        const isError = result.status === "timeout";

        return {
          content: [
            {
              type: "text" as const,
              text:
                `${header}\n\n` +
                pidLine +
                startedLine +
                pidFileLine +
                `\n${summary}\n` +
                detailLine,
            },
          ],
          ...(isError ? { isError: true } : {}),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error stopping server: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
