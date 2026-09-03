/**
 * `logs_summarize_errors` — group warnings/errors by (category, leading
 * message fragment), report counts + first-seen + a sample line per group.
 *
 * Cuts a 50,000-line log down to ~20 lines of "here's what broke and how
 * many times". The fastest "is this build healthy?" check.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { resolveSession, parseLogFile, type LogLine } from "../logs/parser.js";
import type { Config } from "../config.js";

// ── Aggregation ──────────────────────────────────────────────────────────────

interface ErrorGroup {
  /** category | "?" when raw. */
  category: string;
  level: "warn" | "error";
  /** First N tokens of the message — used as the grouping key. */
  signature: string;
  count: number;
  firstSeenLine: number;
  sampleRaw: string;
}

/**
 * Group log lines into signature buckets. Only `warn` / `error` levels
 * count; `info` and `raw` are skipped.
 */
export function summarizeErrors(lines: LogLine[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const l of lines) {
    if (l.level !== "warn" && l.level !== "error") continue;
    const sig = signatureOf(l.message);
    const key = `${l.level}:${l.category ?? "?"}:${sig}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, {
        category: l.category ?? "?",
        level: l.level,
        signature: sig,
        count: 1,
        firstSeenLine: l.lineNumber,
        sampleRaw: l.raw,
      });
    }
  }
  // Sort: errors before warnings, then by count desc, then by first-seen.
  return [...groups.values()].sort((a, b) => {
    if (a.level !== b.level) return a.level === "error" ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.firstSeenLine - b.firstSeenLine;
  });
}

/**
 * Derive a stable signature from a message — first ~8 alphanumeric tokens.
 * Strips file-path:line numbers which would otherwise blow out the key
 * space ("@scripts/Game/Foo.c,15" varies per line).
 */
function signatureOf(message: string): string {
  // Strip `@"…,N"` quote-line refs and any standalone numbers.
  const cleaned = message
    .replace(/@"[^"]+"/g, "@FILE")
    .replace(/\b\d+\b/g, "N");
  // Keep first ~80 chars, trimmed.
  const head = cleaned.slice(0, 80).trim();
  return head;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatSummary(input: {
  sessionName: string;
  channel: string;
  groups: ErrorGroup[];
  totalLinesScanned: number;
  totalWarnings: number;
  totalErrors: number;
  topN: number;
}): string {
  const { sessionName, channel, groups, totalLinesScanned, totalWarnings, totalErrors, topN } =
    input;
  const lines: string[] = [];
  lines.push(`## ${sessionName} / ${channel}.log error summary`);
  lines.push("");
  lines.push(
    `Scanned ${totalLinesScanned} lines: ${totalErrors} errors, ${totalWarnings} warnings, ${groups.length} unique groups.`,
  );
  if (groups.length === 0) {
    lines.push("");
    lines.push("(no warnings or errors — clean session)");
    return lines.join("\n");
  }
  const shown = groups.slice(0, topN);
  lines.push(`Showing top ${shown.length} group${shown.length !== 1 ? "s" : ""}:`);
  lines.push("");
  for (let i = 0; i < shown.length; i++) {
    const g = shown[i];
    const label = g.level === "error" ? "(E)" : "(W)";
    lines.push(
      `${i + 1}. ${label} [${g.category}] ×${g.count} — first @ line ${g.firstSeenLine}`,
    );
    lines.push(`   ${g.signature}`);
    lines.push(`   sample: ${g.sampleRaw}`);
    lines.push("");
  }
  if (groups.length > topN) {
    lines.push(`(${groups.length - topN} more groups hidden — increase \`top_n\` to see them)`);
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerLogsSummarizeErrors(server: McpServer, config: Config): void {
  server.registerTool(
    "logs_summarize_errors",
    {
      description:
        "Group warnings and errors in a log channel into signature buckets and report counts, first-seen line, and a sample. " +
        "Cuts a 50,000-line log into ~20 lines of 'here's what broke and how often'. " +
        "Use as your first call after a suspect build — `logs_tail` only shows the latest, this shows the SHAPE of the problems.",
      inputSchema: {
        which: z.enum(["workbench", "game"]).default("workbench").describe("Logs root"),
        session: z.string().default("latest").describe("Session ref: 'latest', name, or absolute path"),
        channel: z
          .enum(["console", "error", "script", "crash"])
          .default("error")
          .describe("Which channel to scan (default error.log)"),
        top_n: z
          .number()
          .min(1)
          .max(100)
          .default(15)
          .describe("How many top groups to display (1-100, default 15)"),
      },
    },
    async ({ which, session, channel, top_n }) => {
      try {
        const rootPath = which === "game" ? config.gameLogsPath : config.logsPath;
        if (!rootPath) {
          return { content: [{ type: "text" as const, text: `No ${which} logs path configured.` }] };
        }
        const resolved = resolveSession(rootPath, session);
        if (!resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session '${session}' not found. Try \`logs_list\`.`,
              },
            ],
          };
        }
        const channelPath = join(resolved.absPath, `${channel}.log`);
        const all = parseLogFile(channelPath);
        const groups = summarizeErrors(all);
        const totalWarnings = all.reduce((n, l) => n + (l.level === "warn" ? 1 : 0), 0);
        const totalErrors = all.reduce((n, l) => n + (l.level === "error" ? 1 : 0), 0);
        const text = formatSummary({
          sessionName: resolved.name,
          channel,
          groups,
          totalLinesScanned: all.length,
          totalWarnings,
          totalErrors,
          topN: top_n,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error summarizing log: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
