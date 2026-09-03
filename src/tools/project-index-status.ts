import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { statSync } from "node:fs";
import type Database from "better-sqlite3";
import { pruneStaleProjects } from "../project-index/crawler.js";

/**
 * Aggregate counts pulled from the project-index DB.
 *
 * All four are simple `SELECT COUNT(*)` results; the snapshot is bounded
 * — no individual rows leak through.
 */
export interface IndexTotals {
  projects: number;
  resources: number;
  refs: number;
  files: number;
}

/**
 * Per-project rollup row used by {@link formatStatus}.
 *
 * `resourceCount` is an APPROXIMATION: resources do not carry a `project_id`
 * foreign key, only a `source` column ("user" | "core" | "workshop"). The
 * count here is the total number of resources sharing this project's source,
 * which over-counts when multiple projects share a source. For L1 this is
 * acceptable — the tool is a diagnostic, not an authoritative attribution.
 */
export interface ProjectRollup {
  id: string;
  title: string;
  source: string;
  root_path: string;
  last_scan: number;
  /** Approximation — see {@link ProjectRollup} JSDoc. */
  resourceCount: number;
}

/**
 * On-disk description of the DB: either a real file path with its size in
 * bytes, or `null` size to signal `:memory:`.
 */
export interface DbLocation {
  /** Path string from `db.name`, or the literal `":memory:"`. */
  name: string;
  /** File size in bytes, or `null` for in-memory / unreadable. */
  sizeBytes: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Render a millisecond duration as a coarse human-readable phrase.
 *
 * Buckets: seconds / minutes / hours / yesterday / N days / N weeks / N
 * months. Months use the 30-day approximation since this is a diagnostic
 * summary, not an audit log.
 */
export function formatRelativeDuration(nowMs: number, thenMs: number): string {
  const diffMs = nowMs - thenMs;
  if (diffMs < 0) return "in the future";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? "s" : ""} ago`;
}

/** Format a byte count as a short human-readable size string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Format the full status snapshot as markdown.
 *
 * Pure: takes only data, returns a string. Tests target this function
 * directly rather than spinning up an MCP server.
 *
 * @param totals  Top-level COUNT(*) rollups from the four tables.
 * @param projects Per-project rollup rows, already ordered (typically by
 *   `last_scan DESC` — this formatter does not re-sort).
 * @param db      DB location info (path + size, or in-memory marker).
 * @param nowMs   Current time in ms since epoch. Injected so tests can pin
 *   relative durations deterministically.
 */
export function formatStatus(
  totals: IndexTotals,
  projects: ProjectRollup[],
  db: DbLocation,
  nowMs: number,
  /** M16: projects pruned because their root vanished from disk (default none). */
  staleRemoved: { id: string; root_path: string }[] = [],
): string {
  const lines: string[] = [];
  lines.push("## Project Index Status");
  lines.push("");
  if (staleRemoved.length > 0) {
    lines.push(
      `- **Removed ${staleRemoved.length} stale project${staleRemoved.length !== 1 ? "s" : ""}** (root no longer on disk): ` +
        staleRemoved.map((p) => p.id).join(", "),
    );
  }
  lines.push(`- **Total projects:** ${totals.projects}`);
  lines.push(`- **Total resources:** ${totals.resources}`);
  lines.push(`- **Total references:** ${totals.refs}`);
  lines.push(`- **Total files tracked:** ${totals.files}`);

  const dbDisplay =
    db.name === ":memory:" || db.sizeBytes === null
      ? db.name === ":memory:"
        ? "in-memory"
        : db.name
      : `${db.name} (${formatBytes(db.sizeBytes)})`;
  lines.push(`- **DB:** ${dbDisplay}`);

  lines.push("");
  lines.push("### Projects");
  lines.push("");

  if (projects.length === 0) {
    lines.push("(No projects indexed.)");
    return lines.join("\n");
  }

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const when = formatRelativeDuration(nowMs, p.last_scan);
    lines.push(
      `${i + 1}. **${p.title}** (source=${p.source}) — last scanned ${when}`,
    );
    lines.push(`   Path: ${p.root_path}`);
    lines.push(
      `   Resources (approx by source): ${p.resourceCount}`,
    );
  }

  return lines.join("\n");
}

// ── Query helpers (exported for unit-testing against an in-memory DB) ──────────

/** Pull the four top-level COUNT(*) rollups in a single round of queries. */
export function queryTotals(db: Database.Database): IndexTotals {
  const projects = (
    db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }
  ).n;
  const resources = (
    db.prepare("SELECT COUNT(*) AS n FROM resources").get() as { n: number }
  ).n;
  const refs = (
    db.prepare("SELECT COUNT(*) AS n FROM resource_refs").get() as { n: number }
  ).n;
  const files = (
    db.prepare("SELECT COUNT(*) AS n FROM files").get() as { n: number }
  ).n;
  return { projects, resources, refs, files };
}

/**
 * Pull the per-project rollup, ordered by `last_scan DESC`.
 *
 * The `resourceCount` subquery groups by `source` (see {@link ProjectRollup}
 * for why this is an approximation).
 */
export function queryProjectRollups(db: Database.Database): ProjectRollup[] {
  return db
    .prepare(
      "SELECT p.id, p.title, p.source, p.root_path, p.last_scan, " +
        "  (SELECT COUNT(*) FROM resources r WHERE r.source = p.source) AS resourceCount " +
        "FROM projects p " +
        "ORDER BY p.last_scan DESC",
    )
    .all() as ProjectRollup[];
}

/**
 * Read the DB's on-disk location and size.
 *
 * `db.name` is `":memory:"` for in-memory DBs; otherwise it's the file path
 * `openProjectIndex` was given. Returns `sizeBytes: null` for in-memory DBs
 * or when the file can't be stat'd.
 */
export function readDbLocation(db: Database.Database): DbLocation {
  const name = db.name;
  if (name === ":memory:" || name === "") {
    return { name: ":memory:", sizeBytes: null };
  }
  try {
    const stat = statSync(name);
    return { name, sizeBytes: stat.size };
  } catch {
    return { name, sizeBytes: null };
  }
}

// ── Registration ───────────────────────────────────────────────────────────────

/**
 * Register the `project_index_status` MCP tool.
 *
 * Mirrors the `wb_state` snapshot-reporter pattern: empty `inputSchema`, no
 * arguments, returns a markdown summary of the project-index database.
 * Reports counts and per-project rollups ONLY — never lists individual
 * resources, refs, or files (the bounded-output guarantee is the whole point
 * of this tool vs. `find_references`).
 */
export function registerProjectIndexStatus(
  server: McpServer,
  db: Database.Database,
): void {
  server.registerTool(
    "project_index_status",
    {
      description:
        "Get a snapshot of the project-index — total resources/refs/files indexed plus per-project counts. " +
        "Use this to verify the indexer is running, debug 'why doesn't find_references see X', or see what's been indexed. " +
        "Also prunes index rows for projects whose root folder no longer exists and reports how many were removed. " +
        "Does NOT list individual rows — counts only.",
      inputSchema: {},
    },
    async () => {
      try {
        // M16: drop projects whose root vanished (CASCADE clears their rows)
        // so the counts below are honest, and report what was removed.
        const stale = pruneStaleProjects(db).removed;
        const totals = queryTotals(db);
        const projects = queryProjectRollups(db);
        const location = readDbLocation(db);
        const text = formatStatus(totals, projects, location, Date.now(), stale);
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading project-index status: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
