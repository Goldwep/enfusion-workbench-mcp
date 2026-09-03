/**
 * `server_health_probe` — UDP A2S info query against a Reforger server.
 * MCP wrapper around `src/server-mgmt/a2s.ts`.
 *
 * Returns playercount, map, name, and version. Anonymous and read-only —
 * the A2S protocol requires no authentication beyond the challenge-token
 * round-trip handled in `a2s.ts`.
 *
 * RCON read-only allow-list is DEFERRED (see the RCON_ALLOW_LIST comment
 * at the bottom of `a2s.ts` for the deferral rationale).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  formatHealthReport,
  MAX_TIMEOUT_MS,
  queryA2S,
} from "../server-mgmt/a2s.js";

export function registerServerHealthProbe(server: McpServer): void {
  server.registerTool(
    "server_health_probe",
    {
      description:
        "Run a UDP Valve A2S info query against `host:query_port`. Returns the server's " +
        "current player count, map, name, version, and protocol metadata. Anonymous and " +
        "read-only — no auth needed. " +
        "RCON read-only allow-list deferred to v2 (see RCON_ALLOW_LIST comment in source).",
      inputSchema: {
        host: z
          .string()
          .min(1)
          .describe("Hostname or IPv4 address of the server."),
        query_port: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .default(17777)
          .describe("UDP A2S query port (matches `a2s.port` in server.json — default 17777)."),
        timeout_ms: z
          .number()
          .int()
          .min(1)
          .max(MAX_TIMEOUT_MS)
          .optional()
          .default(2000)
          .describe(`Timeout in ms (1 - ${MAX_TIMEOUT_MS}, default 2000).`),
      },
    },
    async ({ host, query_port, timeout_ms }) => {
      try {
        const port = query_port ?? 17777;
        const timeout = timeout_ms ?? 2000;
        const info = await queryA2S(host, port, timeout);
        return {
          content: [
            { type: "text" as const, text: formatHealthReport(host, port, info) },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error probing server: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
