/**
 * L3-4 verification — exercises the 4 logs tools' formatters against real
 * Workbench log directories. Confirms parser + formatter end-to-end without
 * an MCP server restart.
 *
 * Run: `npx tsx scripts/verify-l3-4.ts`
 * Safe to delete after L3-4 verified.
 */

import { loadConfig } from "../src/config.js";
import {
  listSessions,
  resolveSession,
  parseLogFile,
} from "../src/logs/parser.js";
import { formatSessionsList } from "../src/tools/logs-list.js";
import { formatTail } from "../src/tools/logs-tail.js";
import {
  formatFilterPage,
  encodeCursor as encFilter,
} from "../src/tools/logs-filter.js";
import {
  summarizeErrors,
  formatSummary,
} from "../src/tools/logs-summarize-errors.js";
import { join } from "node:path";

const config = loadConfig();
console.log(`[verify] workbench logs: ${config.logsPath}`);
console.log(`[verify] game logs:      ${config.gameLogsPath ?? "(not derived)"}`);
console.log("");

function section(title: string): void {
  console.log("");
  console.log(`==================== ${title} ====================`);
}

// --- logs_list -------------------------------------------------------------
section("logs_list (workbench, limit=5)");
const sessions = listSessions(config.logsPath);
console.log(
  formatSessionsList({
    rootLabel: "workbench",
    rootPath: config.logsPath,
    sessions,
    limit: 5,
  }),
);

// --- logs_tail (latest console.log, last 15 lines) -------------------------
section("logs_tail (latest, console, lines=15)");
const latest = resolveSession(config.logsPath, "latest");
if (!latest) {
  console.log("(no sessions found)");
} else {
  const consolePath = join(latest.absPath, "console.log");
  const parsed = parseLogFile(consolePath);
  console.log(
    formatTail({
      sessionName: latest.name,
      channel: "console",
      totalLines: parsed.length,
      shown: parsed.slice(-15),
    }),
  );
}

// --- logs_filter (script.log warnings) -------------------------------------
section("logs_filter (latest, script, level=warn, limit=5)");
if (latest) {
  const scriptPath = join(latest.absPath, "script.log");
  const all = parseLogFile(scriptPath);
  const matches = all.filter((l) => l.level === "warn");
  const page = matches.slice(0, 5);
  const nextCursor =
    page.length < matches.length
      ? encFilter({
          o: 5,
          k: JSON.stringify({
            which: "workbench",
            session: "latest",
            channel: "script",
            level: "warn",
          }),
          v: 1,
        })
      : null;
  console.log(
    formatFilterPage({
      sessionName: latest.name,
      channel: "script",
      totalMatches: matches.length,
      offset: 0,
      matches: page,
      nextCursor,
      filterDescription: "[level=warn]",
    }),
  );
}

// --- logs_summarize_errors (latest error.log, top 5) -----------------------
section("logs_summarize_errors (latest, error, top=5)");
if (latest) {
  const errorPath = join(latest.absPath, "error.log");
  const all = parseLogFile(errorPath);
  const groups = summarizeErrors(all);
  const totalWarnings = all.reduce((n, l) => n + (l.level === "warn" ? 1 : 0), 0);
  const totalErrors = all.reduce((n, l) => n + (l.level === "error" ? 1 : 0), 0);
  console.log(
    formatSummary({
      sessionName: latest.name,
      channel: "error",
      groups,
      totalLinesScanned: all.length,
      totalWarnings,
      totalErrors,
      topN: 5,
    }),
  );
}

console.log("");
console.log("[verify] done");
