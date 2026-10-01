import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import { checkLease, describeLease, resolveLeasePath } from "../workbench/lease.js";
import type { Config } from "../config.js";
import { formatConnectionStatus } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse } from "../workbench/response.js";

export function registerWbConnect(
  server: McpServer,
  client: WorkbenchClient,
  config?: Config,
): void {
  server.registerTool(
    "wb_connect",
    {
      description:
        "Test connection to Arma Reforger Workbench. Returns connection status and current editor mode. Use this to verify Workbench is running with the NET API enabled.",
      inputSchema: {},
    },
    async () => {
      try {
        // A lease held by another session refuses even the read-only probe:
        // that Workbench belongs to someone else (plan 5.1).
        const leaseCheck = checkLease(resolveLeasePath(config));
        if (leaseCheck.state !== "free" && !client.holdsLease(leaseCheck)) {
          const who =
            "lease" in leaseCheck
              ? describeLease(leaseCheck.lease)
              : `corrupt lease file: ${leaseCheck.reason}`;
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
        const alive = await client.ping();
        if (!alive) {
          return {
            content: [
              {
                type: "text" as const,
                text: "**Connection Failed**\n\nCould not reach Workbench. Ensure:\n1. Arma Reforger Tools (Workbench) is running\n2. NET API is enabled: File > Options > General > Net API\n3. The EnfusionMCP handler addon is loaded in Workbench",
              },
            ],
            isError: true,
          };
        }

        // Get detailed state — Ping returns: status, mode, message
        const details = await client.call<Record<string, unknown>>("EMCP_WB_Ping");
        if (isHandlerError(details)) {
          return handlerErrorResponse(details, client, "Connection Failed — Ping handler error");
        }

        const lines: string[] = [];
        lines.push("**Workbench Connected**\n");
        lines.push("- **Status:** Connected");
        if (details.mode) lines.push(`- **Mode:** ${details.mode}`);
        if (details.message) lines.push(`- **Info:** ${details.message}`);

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
