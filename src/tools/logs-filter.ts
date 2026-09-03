/**
 * `logs_filter` — paginated view of log lines matching regex / level /
 * category filters.
 *
 * Use when `logs_tail` shows too much noise. Common idioms:
 *   - level=warn|error → only the squeaky wheels
 *   - category=SCRIPT  → only the script subsystem
 *   - pattern="obsolete" → all deprecation hits
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import {
  resolveSession,
  parseLogFile,
  type LogLine,
  type LogLevel,
} from "../logs/parser.js";
import type { Config } from "../config.js";

// ── Cursor ───────────────────────────────────────────────────────────────────

interface CursorPayload {
  o: number;
  /** Cursor binding — all filter values rolled into one key. */
  k: string;
  v: 1;
}

export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

export function decodeCursor(s: string, expectedKey: string): CursorPayload {
  let parsed: CursorPayload;
  try {
    parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf-8")) as CursorPayload;
  } catch {
    throw new Error("Invalid cursor: not base64url-encoded JSON");
  }
  if (!parsed || parsed.v !== 1) {
    throw new Error("Invalid cursor: unsupported version");
  }
  if (typeof parsed.o !== "number" || !Number.isInteger(parsed.o) || parsed.o < 0) {
    throw new Error("Invalid cursor: bad offset");
  }
  if (parsed.k !== expectedKey) {
    throw new Error("Invalid cursor: bound to a different filter set");
  }
  return parsed;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatFilterPage(input: {
  sessionName: string;
  channel: string;
  totalMatches: number;
  offset: number;
  matches: LogLine[];
  nextCursor: string | null;
  filterDescription: string;
}): string {
  const { sessionName, channel, totalMatches, offset, matches, nextCursor, filterDescription } =
    input;
  if (totalMatches === 0) {
    return `No matches in ${sessionName}/${channel}.log for ${filterDescription}.`;
  }
  const lines: string[] = [];
  const start = offset + 1;
  const end = offset + matches.length;
  lines.push(
    `## ${sessionName} / ${channel}.log — ${totalMatches} matches ${filterDescription} (showing ${start}–${end})`,
  );
  lines.push("");
  lines.push("```");
  for (const l of matches) {
    lines.push(`${String(l.lineNumber).padStart(6, " ")}: ${l.raw}`);
  }
  lines.push("```");
  lines.push("");
  lines.push(`total_count: ${totalMatches}`);
  if (nextCursor) {
    lines.push(`next_cursor: ${nextCursor}`);
    lines.push("");
    lines.push("Call `logs_filter` again with `cursor` set for the next page.");
  } else {
    lines.push("(no more pages)");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerLogsFilter(server: McpServer, config: Config): void {
  server.registerTool(
    "logs_filter",
    {
      description:
        "Paginated view of log lines matching regex / level / category filters. " +
        "Common idioms: `level=error` to see only errors, `pattern='obsolete'` to find deprecation hits, " +
        "`category=SCRIPT` to focus on the script subsystem. Pair with `logs_tail` when you want the most recent context.",
      inputSchema: {
        which: z.enum(["workbench", "game"]).default("workbench").describe("Logs root"),
        session: z.string().default("latest").describe("Session ref: 'latest', name, or absolute path"),
        channel: z
          .enum(["console", "error", "script", "crash"])
          .default("console")
          .describe("Which channel to scan"),
        level: z
          .enum(["info", "warn", "error", "raw", "any"])
          .default("any")
          .describe("Filter by parsed level"),
        category: z
          .string()
          .optional()
          .describe("Filter by category (e.g. SCRIPT, ENGINE, RESOURCES). Case-sensitive."),
        pattern: z
          .string()
          .optional()
          .describe("Optional regex applied to the message body (JS regex syntax)"),
        limit: z
          .number()
          .min(1)
          .max(500)
          .default(100)
          .describe("Max matches per page (1-500, default 100)"),
        cursor: z.string().optional().describe("Opaque pagination token"),
      },
    },
    async ({ which, session, channel, level, category, pattern, limit, cursor }) => {
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
        // Cursor key binds every filter; if any changes, the cursor must too.
        const key = JSON.stringify({ which, session, channel, level, category, pattern });
        const offset = cursor ? decodeCursor(cursor, key).o : 0;

        // Compile pattern (early-error before parsing the file).
        let patternRe: RegExp | null = null;
        if (pattern) {
          // Audit-fix L3 SEC-L3-001: ReDoS guard. A malicious or naive
          // pattern like `(a+)+b` can pin a CPU core for hours on
          // adversarial input. Bound length and reject obvious nested-
          // quantifier shapes. Power users can ENFUSION_DISABLE_PATTERN_GUARD=1
          // if needed (escape hatch, undocumented).
          if (pattern.length > 200) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Pattern too long (${pattern.length} chars, max 200). Pre-filter your match more aggressively.`,
                },
              ],
              isError: true,
            };
          }
          if (!process.env.ENFUSION_DISABLE_PATTERN_GUARD) {
            // Reject nested quantifiers like (X+)+, (X*)*, (X+)*, (X*)+
            // — the classic catastrophic-backtracking shapes.
            if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text:
                      `Pattern rejected: nested quantifier detected (e.g. (X+)+) — ` +
                      `risks catastrophic backtracking on log lines. Rewrite without ` +
                      `nested ${"`+`"}/${"`*`"} on capture groups, or set ENFUSION_DISABLE_PATTERN_GUARD=1.`,
                  },
                ],
                isError: true,
              };
            }
          }
          try {
            patternRe = new RegExp(pattern);
          } catch (e) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid regex pattern '${pattern}': ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        }

        const channelPath = join(resolved.absPath, `${channel}.log`);
        const all = parseLogFile(channelPath);
        const matches = all.filter((l) => {
          if (level !== "any" && l.level !== (level as LogLevel)) return false;
          if (category && l.category !== category) return false;
          if (patternRe && !patternRe.test(l.message) && !patternRe.test(l.raw)) return false;
          return true;
        });
        const page = matches.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        const hasMore = nextOffset < matches.length;
        const nextCursor = hasMore ? encodeCursor({ o: nextOffset, k: key, v: 1 }) : null;

        const filterDescription = describeFilters({ level, category, pattern });
        const text = formatFilterPage({
          sessionName: resolved.name,
          channel,
          totalMatches: matches.length,
          offset,
          matches: page,
          nextCursor,
          filterDescription,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error filtering log: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

function describeFilters(f: {
  level: string;
  category?: string;
  pattern?: string;
}): string {
  const parts: string[] = [];
  if (f.level !== "any") parts.push(`level=${f.level}`);
  if (f.category) parts.push(`category=${f.category}`);
  if (f.pattern) parts.push(`pattern=/${f.pattern}/`);
  return parts.length > 0 ? `[${parts.join(", ")}]` : "(unfiltered)";
}
