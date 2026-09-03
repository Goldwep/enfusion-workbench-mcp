/**
 * Log parsing primitives for Reforger / Workbench / Server log directories
 * (L3-4).
 *
 * Log directory layout (verified on disk 2026-05-21):
 *
 *   <profile>/logs/logs_YYYY-MM-DD_HH-MM-SS/
 *     console.log    — all engine output (info + warnings + errors)
 *     error.log      — just warnings + errors
 *     script.log     — script subsystem channel (compiles, RPC, etc.)
 *     crash.log      — present only when the engine crashed
 *     resourceDatabase.rdb — Workbench-only artifact (skipped here)
 *
 * Line format inside each .log file:
 *
 *   <header>          ::= "Log <path> started at <local> (<utc> UTC)"
 *   <separator>       ::= "-" * 40+   (decorative)
 *   <body line>       ::= "HH:MM:SS.ms  CATEGORY  [(W|E)]  : message"
 *
 * The category column has variable whitespace padding (ENGINE, RESOURCES,
 * SCRIPT, INIT, PROFILING, BACKEND, DEFAULT, …). Some messages have the
 * category re-emitted as a prefix on the message body — that's a logger
 * quirk, not our problem; the parser grabs the FIRST category and leaves
 * everything after the colon as the message.
 *
 * Lines that don't match the grammar (continuation lines, stack traces,
 * blank lines) are surfaced as `level: "raw"` so tools can still display
 * them in context — they're never silently dropped.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

/** Level of one log line. `raw` means "couldn't parse the timestamp/category". */
export type LogLevel = "info" | "warn" | "error" | "raw";

/** Categories surfaced by the engine. Add more as they appear in the wild. */
export type LogCategory = string;

/** One parsed log line. `lineNumber` is 1-based; matches typical editor display. */
export interface LogLine {
  /** Source file basename (e.g. "console", "error", "script"). */
  channel: string;
  /** 1-based line number in the source file. */
  lineNumber: number;
  /** Raw line text, exactly as on disk (trailing CRLF stripped). */
  raw: string;
  /** `HH:MM:SS.ms`, or null when the line couldn't be parsed. */
  timestamp: string | null;
  category: LogCategory | null;
  level: LogLevel;
  /** Message body, with the leading category prefix removed when present. */
  message: string;
}

/** Summary of one `logs_*` session directory. */
export interface LogSession {
  /** Directory name (e.g. "logs_2026-05-21_08-42-56"). */
  name: string;
  /** Absolute path to the directory. */
  absPath: string;
  /** Channels present (basenames of .log files, e.g. ["console", "error", "script"]). */
  channels: string[];
  /** Total bytes across all .log files in the session. */
  totalBytes: number;
  /** mtime of the most recent .log file in the session. */
  lastMtimeMs: number;
  /** Whether a crash.log is present in the session. */
  hadCrash: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Regex matching the structured body lines. Greedy on the message tail. */
const LINE_RE =
  /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+([A-Z][A-Z0-9_]*)\s*(?:\(([WE])\))?\s*:\s?(.*)$/;

/** Session dir name pattern: `logs_YYYY-MM-DD_HH-MM-SS`. */
const SESSION_DIR_RE = /^logs_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

// ── Public functions ─────────────────────────────────────────────────────────

/**
 * Parse a single raw log line. Lines that don't match the grammar return
 * a `level: "raw"` entry — never throws.
 */
export function parseLine(raw: string, channel: string, lineNumber: number): LogLine {
  // Strip trailing CR (Windows line endings come through readFileSync as CRLF
  // when we split on \n).
  const trimmed = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  const m = LINE_RE.exec(trimmed);
  if (!m) {
    return {
      channel,
      lineNumber,
      raw: trimmed,
      timestamp: null,
      category: null,
      level: "raw",
      message: trimmed,
    };
  }
  const [, timestamp, category, levelMarker, body] = m;
  // Engine sometimes re-emits the category as a prefix on the message
  // (e.g. "SCRIPT       : SCRIPT       : Initializing scripts"). Strip
  // the redundant prefix so downstream tools see a clean message.
  const dedupedBody = stripRedundantCategoryPrefix(category, body);
  return {
    channel,
    lineNumber,
    raw: trimmed,
    timestamp,
    category,
    level: levelMarker === "E" ? "error" : levelMarker === "W" ? "warn" : "info",
    message: dedupedBody,
  };
}

/** Read + parse every line of a `.log` file. Returns [] when the file is missing. */
export function parseLogFile(absPath: string): LogLine[] {
  if (!existsSync(absPath)) return [];
  const channel = basename(absPath, ".log");
  const content = readFileSync(absPath, "utf-8");
  const lines = content.split("\n");
  // Last element may be empty (trailing newline) — drop it cleanly.
  const trimmed = lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  return trimmed.map((raw, i) => parseLine(raw, channel, i + 1));
}

/**
 * Enumerate `logs_*` session dirs under `logsRoot`. Returns newest first
 * (lexicographic-descending on the directory name, which is timestamped).
 * Skips non-matching subdirs silently.
 */
export function listSessions(logsRoot: string): LogSession[] {
  if (!existsSync(logsRoot)) return [];
  let entries;
  try {
    entries = readdirSync(logsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const sessions: LogSession[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!SESSION_DIR_RE.test(entry.name)) continue;
    const absPath = join(logsRoot, entry.name);
    const logFiles = collectLogFiles(absPath);
    const channels = logFiles.map((f) => basename(f, ".log"));
    let totalBytes = 0;
    let lastMtimeMs = 0;
    for (const f of logFiles) {
      try {
        const st = statSync(f);
        totalBytes += st.size;
        if (st.mtimeMs > lastMtimeMs) lastMtimeMs = st.mtimeMs;
      } catch {
        /* skip unreadable */
      }
    }
    sessions.push({
      name: entry.name,
      absPath,
      channels,
      totalBytes,
      lastMtimeMs,
      hadCrash: channels.includes("crash"),
    });
  }
  // Newest first.
  sessions.sort((a, b) => b.name.localeCompare(a.name));
  return sessions;
}

/**
 * Resolve a session reference to a directory. Accepts:
 *  - "latest" — newest session in logsRoot
 *  - "logs_YYYY-MM-DD_HH-MM-SS" — exact name
 *  - an absolute path
 *
 * Returns null when nothing matches.
 */
export function resolveSession(
  logsRoot: string,
  ref: string,
): { name: string; absPath: string } | null {
  if (ref === "latest") {
    const sessions = listSessions(logsRoot);
    if (sessions.length === 0) return null;
    return { name: sessions[0].name, absPath: sessions[0].absPath };
  }
  // Absolute path?
  if (ref.match(/^[A-Za-z]:[\\/]/) || ref.startsWith("/")) {
    if (!existsSync(ref)) return null;
    return { name: basename(ref), absPath: ref };
  }
  // Treat as a session-directory name.
  if (SESSION_DIR_RE.test(ref)) {
    const abs = join(logsRoot, ref);
    if (!existsSync(abs)) return null;
    return { name: ref, absPath: abs };
  }
  return null;
}

/** Recursively list `.log` files in a session directory (one level deep). */
export function collectLogFiles(sessionDir: string): string[] {
  if (!existsSync(sessionDir)) return [];
  let entries;
  try {
    entries = readdirSync(sessionDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".log"))
    .map((e) => join(sessionDir, e.name))
    .sort();
}

/**
 * Derive the parent `logs/` directory from an arbitrary path inside a
 * session subtree. Useful when a tool gets an absolute path that already
 * resolves to a session — we want the SIBLING sessions for `list`.
 */
export function findLogsRoot(somePath: string): string | null {
  let p = somePath;
  while (true) {
    const parent = dirname(p);
    if (parent === p) return null;
    if (basename(parent) === "logs") return parent;
    p = parent;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip a redundant category prefix from the message body. Engine sometimes
 * formats messages as "CATEGORY       : actual message" — when the prefix
 * matches the parsed category, drop it.
 */
function stripRedundantCategoryPrefix(category: string, body: string): string {
  // Audit-fix L3 C-1: template-literal `\\s` allegedly miscompiled per the
  // architecture audit — switch to explicit string concatenation so the
  // produced regex source is unambiguous. `category` is constrained to
  // [A-Z][A-Z0-9_]* by LINE_RE; safe to interpolate without escaping.
  const re = new RegExp("^" + category + "\\s+:\\s?(.*)$");
  const m = re.exec(body);
  return m ? m[1] : body;
}
