import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LEASE_SESSION, WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import { checkLease, leaseBlocker, resolveLeasePath } from "../workbench/lease.js";
import type { Config } from "../config.js";
import { formatConnectionStatus } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse } from "../workbench/response.js";
import { readNativeReadiness } from "./wb-scripts.js";

export function registerWbConnect(
  server: McpServer,
  client: WorkbenchClient,
  config?: Config,
): void {
  server.registerTool(
    "wb_connect",
    {
      description:
        "Test the connection to Arma Reforger Workbench.\n" +
        "Read: native readiness (IsWorkbenchRunning, ScriptsCompiled), whether the shipped handlers answer Ping, build-stamp match, editor mode. Sends nothing that changes state.",
      inputSchema: {},
      annotations: {
        title: "Workbench connection",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        // A lease held by another session refuses even the read-only probe:
        // that Workbench belongs to someone else (plan 5.1). A stale lease
        // belongs to nobody and does not refuse.
        const who = leaseBlocker(checkLease(resolveLeasePath(config)), LEASE_SESSION);
        if (who !== null) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Connection Refused — Workbench lease held by another session**\n\n${who}\n\nNothing was sent to Workbench.`,
              },
            ],
            isError: true,
          };
        }
        // Native readiness first: a probe plus a ping, no lease, no launch.
        const ready = await readNativeReadiness(client);
        if (ready.error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Connection Failed**

${ready.error.code}: ${ready.error.message}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }
        if (!ready.running) {
          return {
            content: [
              {
                type: "text" as const,
                text: "**Connection Failed**\n\nIsWorkbenchRunning did not answer. Ensure:\n1. Arma Reforger Tools (Workbench) is running\n2. NET API is enabled: File > Options > General > Net API\n3. Start it with wb_launch",
              },
            ],
            isError: true,
          };
        }

        const lines: string[] = [];
        lines.push("**Workbench Connected**\n");
        lines.push("- **Status:** Connected (native IsWorkbenchRunning answered)");
        lines.push(
          `- **ScriptsCompiled:** ${ready.scriptsCompiled === null ? "not reported" : String(ready.scriptsCompiled)}`,
        );
        lines.push(
          `- **Handlers:** ${ready.handlersAnswer ? "EMCP_WB_Ping answers" : "NOT loaded (EMCP_WB_Ping did not answer)"}`,
        );
        if (ready.buildStamp) {
          lines.push(`- **Build stamp:** ${ready.buildStamp.status}`);
          if (ready.buildStamp.warning) lines.push(`  - ${ready.buildStamp.warning}`);
        }
        if (ready.scriptsCompiled === false) {
          lines.push("- **Warning:** scripts are not compiled; wb_scripts status for detail");
        }
        if (!ready.handlersAnswer) {
          lines.push("- **Next:** wb_scripts status, then wb_scripts reload or wb_launch");
        } else {
          // Mode and message come from the handler's Ping detail.
          const details = await client.probe<Record<string, unknown>>(
            "EMCP_WB_Ping",
            {},
            { access: "read" },
          );
          if (isHandlerError(details)) {
            return handlerErrorResponse(details, client, "Connection Failed — Ping handler error");
          }
          if (details.mode) lines.push(`- **Mode:** ${details.mode}`);
          if (details.message) lines.push(`- **Info:** ${details.message}`);
        }

        return {
          content: [
            { type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof WorkbenchError && e.code === "LEASE_HELD") {
          // Workbench answered the read-only ping, but another session holds
          // the lease, so this server must not drive it.
          return {
            content: [
              {
                type: "text" as const,
                text: `**Workbench Reachable — lease held by another session**\n\n${msg}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `**Connection Failed**\n\n${msg}\n\nEnsure Workbench is running with NET API enabled (File > Options > General > Net API).${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
