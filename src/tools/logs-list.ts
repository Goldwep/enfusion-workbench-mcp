/**
 * `logs_list` — enumerate `logs_*` session directories.
 *
 * Newest-first ordering, with per-session totals (bytes, channel count,
 * crash-present flag). The first useful question after a Workbench session
 * is "what's the latest log dir?" — this tool answers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listSessions, type LogSession } from "../logs/parser.js";
import type { Config } from "../config.js";

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatSessionsList(input: {
  rootLabel: string;
  rootPath: string;
  sessions: LogSession[];
  limit: number;
}): string {
  const { rootLabel, rootPath, sessions, limit } = input;
  if (sessions.length === 0) {
    return `No log sessions found under ${rootLabel} (${rootPath}).`;
  }
  const lines: string[] = [];
  const shown = sessions.slice(0, limit);
  lines.push(
    `## ${rootLabel} log sessions (${sessions.length} total, showing newest ${shown.length})`,
  );
  lines.push("");
  lines.push(`Root: ${rootPath}`);
  lines.push("");
  for (let i = 0; i < shown.length; i++) {
    const s = shown[i];
    const sizeStr = humanBytes(s.totalBytes);
    const channels = s.channels.length > 0 ? s.channels.join("/") : "(empty)";
    const crashFlag = s.hadCrash ? "  CRASH" : "";
    lines.push(`  ${i + 1}. ${s.name} — ${channels} — ${sizeStr}${crashFlag}`);
  }
  if (sessions.length > limit) {
    lines.push("");
    lines.push(`(${sessions.length - limit} older sessions hidden — increase \`limit\` to see them)`);
  }
  return lines.join("\n");
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerLogsList(server: McpServer, config: Config): void {
  server.registerTool(
    "logs_list",
    {
      description:
        "List Workbench (or game) log session directories newest-first. " +
        "Each entry shows the channels present (console/error/script/crash) and the total session size. " +
        "Sessions with a CRASH marker include a crash.log — likely worth `logs_tail` first. " +
        "Use to answer 'what was the last session?' or 'do I have a crash to investigate?'",
      inputSchema: {
        which: z
          .enum(["workbench", "game"])
          .default("workbench")
          .describe("Which logs root to list (default workbench)"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Max sessions to show (1-100, default 20)"),
      },
    },
    async ({ which, limit }) => {
      try {
        const rootPath = which === "game" ? config.gameLogsPath : config.logsPath;
        if (!rootPath) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No ${which} logs path configured. Set ENFUSION_GAME_LOGS_PATH or ensure the standard My Games layout exists.`,
              },
            ],
          };
        }
        const sessions = listSessions(rootPath);
        const text = formatSessionsList({
          rootLabel: which,
          rootPath,
          sessions,
          limit,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error listing log sessions: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
