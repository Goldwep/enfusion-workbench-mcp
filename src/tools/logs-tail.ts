/**
 * `logs_tail` — last N lines from one channel of one log session.
 *
 * Defaults to the newest Workbench session's console.log. The fastest path
 * from "something looks broken" to "what does the engine say about it".
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { resolveSession, parseLogFile, type LogLine } from "../logs/parser.js";
import type { Config } from "../config.js";

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatTail(input: {
  sessionName: string;
  channel: string;
  totalLines: number;
  shown: LogLine[];
}): string {
  const { sessionName, channel, totalLines, shown } = input;
  const lines: string[] = [];
  lines.push(`## ${sessionName} / ${channel}.log — last ${shown.length} of ${totalLines} lines`);
  lines.push("");
  if (shown.length === 0) {
    lines.push("(no lines — channel may not exist in this session)");
    return lines.join("\n");
  }
  lines.push("```");
  for (const l of shown) {
    lines.push(`${String(l.lineNumber).padStart(6, " ")}: ${l.raw}`);
  }
  lines.push("```");
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerLogsTail(server: McpServer, config: Config): void {
  server.registerTool(
    "logs_tail",
    {
      description:
        "Show the last N lines of a log channel from a session. " +
        "Defaults to the newest Workbench session's console.log — the fastest path from 'something broke' to engine output. " +
        "Use `which`/`session`/`channel` to override.",
      inputSchema: {
        which: z
          .enum(["workbench", "game"])
          .default("workbench")
          .describe("Which logs root to use"),
        session: z
          .string()
          .default("latest")
          .describe("Session ref: 'latest', 'logs_YYYY-MM-DD_HH-MM-SS', or an absolute path"),
        channel: z
          .enum(["console", "error", "script", "crash"])
          .default("console")
          .describe("Which channel to tail"),
        lines: z
          .number()
          .min(1)
          .max(2000)
          .default(50)
          .describe("Number of lines from the end (1-2000, default 50)"),
      },
    },
    async ({ which, session, channel, lines: numLines }) => {
      try {
        const rootPath = which === "game" ? config.gameLogsPath : config.logsPath;
        if (!rootPath) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No ${which} logs path configured.`,
              },
            ],
          };
        }
        const resolved = resolveSession(rootPath, session);
        if (!resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session '${session}' not found under ${rootPath}. Try \`logs_list\` first.`,
              },
            ],
          };
        }
        const channelPath = join(resolved.absPath, `${channel}.log`);
        const parsed = parseLogFile(channelPath);
        const shown = parsed.slice(-numLines);
        const text = formatTail({
          sessionName: resolved.name,
          channel,
          totalLines: parsed.length,
          shown,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error tailing log: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
