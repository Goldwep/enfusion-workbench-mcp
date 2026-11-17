/**
 * E13 — launch-log miner (plan 4.5; section 2.1 finding 1 and 5.3 step 9).
 *
 * Reads the retained Workbench session logs
 * (`<profile>/logs/logs_<timestamp>/{console,error,script}.log` and the
 * `CrashReports.log` next to them) and answers three questions from evidence:
 *
 *   (a) which command-line switches Workbench has been started with, as echoed
 *       by its own log (`CLI Params:`), and in how many sessions;
 *   (b) per launch form: the gap between engine creation and engine
 *       initialisation, whether the session opened the project the switches
 *       asked for (the exact line is `Using autosave directory: .../Projects/
 *       <name>/autosaves`), and what the phantom `-wbProjectPath` flag led to;
 *   (c) the error and dialog vocabulary: lines that name a hazard (a virtual
 *       machine exception, a missing addon dependency, a script-authorization
 *       prompt, a crash report, an assert) become hazard-dialog rows.
 *
 * PRIVACY. Logs hold account names, home paths, addon names and recent-file
 * paths. Nothing is copied: the parsers extract facts and rebuild every kept
 * string from placeholders. Paths become `%USERPROFILE%`, `<addons>`, `<game>`,
 * `<tools>`, `<profile>`, `<logs>`, `%TEMP%`; project and addon names become
 * `<project-N>` (numbered by first appearance over the sorted sessions) unless
 * they are a Bohemia base-game name; free text is reduced to a shape (quoted
 * strings, numbers and GUIDs replaced). Every output string then passes
 * `assertScrubbed`, which refuses the whole run on a surviving account name,
 * home path, drive path, Steam id or e-mail. Raw log text never reaches the
 * repository; the derived tables go to the artifacts folder
 * (`census/<build>/E13/*.json`) and the observation rows cite them as
 * `artifact:<sha256>#<row key>`.
 *
 * This script never starts, queries or executes Workbench: it only reads log
 * files. The game's own logs folder is read for one question (do Workbench
 * sessions appear there?) and contributes no rows.
 *
 *   npx tsx scripts/census/enumerators/e13-launch-logs.ts [--build <tag>] [--data <dir>]
 *       [--logs <dir>] [--game-logs <dir>] [--artifacts <dir>] [--out <file>] [--json]
 *
 * --logs       default <profile>/My Games/ArmaReforgerWorkbench/logs under the home directory
 * --game-logs  default <profile>/My Games/ArmaReforger/logs
 * --artifacts  default <artifacts folder>/census/<build>/E13
 *
 * Exit: 0 written; 1 refused (output location, or a scrub check failed);
 * 2 usage or no Workbench logs folder (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  compareCodeUnits,
  formatJson,
  jsonlLine,
  sha256,
  splitLines,
} from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { type Observation } from "../../../src/census/schemas.js";
import { MODULES } from "../../../src/census/vocab.js";
import { artifactsDir, insideGitWorkTree } from "../../live/paths.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "../cli-common.js";

/** Enumerator id (main ruling 11). */
export const ENUMERATOR_ID = "E13";
/** Registered generator path (must equal universes.json `enumerators.E13.generator`). */
export const GENERATOR = "scripts/census/enumerators/e13-launch-logs.ts";
const QUOTE_MAX = 200;

/** The one project-selecting switch the recon found to be absent from the executable (plan 2.1). */
export const PHANTOM_SWITCHES: readonly string[] = ["wbProjectPath"];
/** Switches that name the project to open. */
export const PROJECT_SWITCHES: readonly string[] = ["gproj", "wbProjectPath"];
/** Names that stay readable because they are Bohemia's own (lower-case compare). */
export const BASE_GAME_NAMES: readonly string[] = ["ArmaReforger", "core"];

// ── Scrub context ─────────────────────────────────────────────────────────────

export interface ScrubContext {
  /** Home directories, forward slashes, lower case. */
  homes: string[];
  /** Account names as written; matched case-insensitively. */
  accounts: string[];
  /** Base-game names, lower case. */
  baseNames: Set<string>;
  /** Lower-case project name to its `<project-N>` token (never written out). */
  projects: Map<string, string>;
}

export interface ScrubOptions {
  homes?: readonly string[];
  accounts?: readonly string[];
  baseNames?: readonly string[];
  /** Also treat the current user's home and account name as known (default true). */
  ambient?: boolean;
}

function normHome(h: string): string {
  return h.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a scrub context. With `ambient` the running user's home and account name are known. */
export function makeScrubContext(opts: ScrubOptions = {}): ScrubContext {
  const homes = new Set<string>();
  const accounts = new Set<string>();
  for (const h of opts.homes ?? []) if (h) homes.add(normHome(h));
  for (const a of opts.accounts ?? []) if (a) accounts.add(a);
  if (opts.ambient !== false) {
    const candidates = [homedir(), process.env.USERPROFILE ?? "", process.env.HOME ?? ""];
    for (const h of candidates) {
      if (!h) continue;
      homes.add(normHome(h));
      accounts.add(basename(h.replace(/\\/g, "/")));
    }
    for (const a of [process.env.USERNAME ?? "", process.env.USER ?? ""]) if (a) accounts.add(a);
    try {
      accounts.add(userInfo().username);
    } catch {
      // no user record on this host: the environment names above are enough
    }
  }
  return {
    homes: [...homes].filter((h) => h.length > 2).sort(compareCodeUnits),
    accounts: [...accounts].filter((a) => a.length > 0).sort(compareCodeUnits),
    baseNames: new Set([...BASE_GAME_NAMES, ...(opts.baseNames ?? [])].map((n) => n.toLowerCase())),
    projects: new Map(),
  };
}

/** Account names that the text itself reveals through a home-path shape. */
export function discoverAccounts(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s'"<>|:*?,]+)/gi,
    /(?:^|[^A-Za-z0-9_.<>%-])\/(?:home|Users)\/([^/\s'"]+)/g,
    /[A-Za-z]--Users-([A-Za-z0-9_.]+)-/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (name && !/^[<%]/.test(name)) found.add(name);
    }
  }
  return [...found].sort(compareCodeUnits);
}

/** Adds newly discovered account names and home directories to a context. */
export function learnAccounts(ctx: ScrubContext, names: readonly string[]): void {
  for (const n of names) {
    if (!ctx.accounts.includes(n)) ctx.accounts.push(n);
  }
  ctx.accounts.sort(compareCodeUnits);
}

/** The `<project-N>` token of a name; base-game names pass through unchanged. */
export function projectToken(ctx: ScrubContext, name: string): string {
  const key = name.toLowerCase();
  if (ctx.baseNames.has(key)) return name;
  let token = ctx.projects.get(key);
  if (token === undefined) {
    token = `<project-${ctx.projects.size + 1}>`;
    ctx.projects.set(key, token);
  }
  return token;
}

// ── Scrubbing ─────────────────────────────────────────────────────────────────

const SAFE_SEGMENTS = new Set(
  [
    "addons",
    "data",
    "core",
    "documents",
    "github",
    "my games",
    "armareforgerworkbench",
    "armareforger",
    "profile",
    "logs",
    "projects",
    "autosaves",
    "thumbnails",
    "addon.gproj",
    "armareforger.gproj",
    "core.gproj",
    "resourcedatabase.rdb",
    "arma reforger workbench",
  ].map((s) => s.toLowerCase()),
);

const FILE_EXT = /\.(gproj|rdb|json|conf|ini|log|c|et|layout|bin)$/i;

function mapSegments(segs: readonly string[], ctx: ScrubContext): string[] {
  const clean = segs.filter((s) => s !== "" && s !== ".");
  return clean.map((seg, i) => {
    const low = seg.toLowerCase();
    if (SAFE_SEGMENTS.has(low) || ctx.baseNames.has(low)) return seg;
    const isLast = i === clean.length - 1;
    const ext = FILE_EXT.exec(seg);
    if (isLast && ext) {
      const stem = seg.slice(0, seg.length - ext[0].length);
      if (/^gproj$/i.test(ext[1]) && stem !== "") return `${projectToken(ctx, stem)}${ext[0]}`;
      return `<file>${ext[0]}`;
    }
    return projectToken(ctx, seg);
  });
}

function joinPlaceholder(prefix: string, segs: readonly string[], ctx: ScrubContext): string {
  return [prefix, ...mapSegments(segs, ctx)].join("/");
}

function scrubTemp(rest: readonly string[], ctx: ScrubContext): string {
  if (rest[0]?.toLowerCase() === "arma reforger workbench") {
    return joinPlaceholder("%TEMP%/Arma Reforger Workbench", rest.slice(1), ctx);
  }
  const last = rest[rest.length - 1];
  if (rest.length >= 2 && last.toLowerCase() === "addon.gproj") {
    return `%TEMP%/<scratch>/${projectToken(ctx, rest[rest.length - 2])}/addon.gproj`;
  }
  return "%TEMP%/<scratch>";
}

function scrubUnderHome(rest: readonly string[], ctx: ScrubContext): string {
  const low = rest.map((s) => s.toLowerCase());
  if (low[0] === "documents" && low[1] === "my games" && low[2] === "armareforgerworkbench") {
    if (low[3] === "addons") return joinPlaceholder("<addons>", rest.slice(4), ctx);
    if (low[3] === "profile") return "<profile>";
    if (low[3] === "logs") return "<logs>";
  }
  if (low[0] === "appdata" && low[1] === "local" && low[2] === "temp") {
    return scrubTemp(rest.slice(3), ctx);
  }
  return joinPlaceholder("%USERPROFILE%", rest, ctx);
}

/**
 * One path (or path-like value) to its placeholder form. Names that are not
 * Bohemia's become `<project-N>` tokens; anything absolute and unrecognised
 * collapses to `<path>`.
 */
export function scrubPath(raw: string, ctx: ScrubContext): string {
  const s = raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  if (s === "") return "";
  const segs = s.split("/");
  const low = segs.map((x) => x.toLowerCase());
  const toolsAt = low.indexOf("arma reforger tools");
  if (toolsAt >= 0) return joinPlaceholder("<tools>", segs.slice(toolsAt + 1), ctx);
  const gameAt = low.indexOf("arma reforger");
  if (gameAt >= 0) return joinPlaceholder("<game>", segs.slice(gameAt + 1), ctx);
  if (low[0] === "." && low[1] === "addons") return joinPlaceholder("<game>", segs.slice(1), ctx);

  const lowerPath = s.toLowerCase();
  if (low[0] === "%userprofile%") return scrubUnderHome(segs.slice(1), ctx);
  if (low[0] === "%localappdata%")
    return scrubUnderHome(["AppData", "Local", ...segs.slice(1)], ctx);
  if (low[0] === "%temp%" || low[0] === "%tmp%") return scrubTemp(segs.slice(1), ctx);
  for (const home of ctx.homes) {
    if (lowerPath === home || lowerPath.startsWith(`${home}/`)) {
      const homeParts = home.split("/").filter((p) => p !== "").length;
      return scrubUnderHome(segs.filter((x) => x !== "").slice(homeParts), ctx);
    }
  }
  const drive = /^[A-Za-z]:\/users\/[^/]+(?:\/(.*))?$/i.exec(s);
  if (drive)
    return scrubUnderHome(
      (drive[1] ?? "").split("/").filter((x) => x !== ""),
      ctx,
    );
  const posix = /^\/(?:home|users)\/[^/]+(?:\/(.*))?$/i.exec(s);
  if (posix)
    return scrubUnderHome(
      (posix[1] ?? "").split("/").filter((x) => x !== ""),
      ctx,
    );
  if (/^(?:[A-Za-z]:|\/)/.test(s)) return "<path>";
  return joinPlaceholder("<relative>", segs, ctx);
}

/**
 * Free text reduced to a safe shape: known home paths and account names,
 * drive paths, Steam ids and e-mail addresses are replaced before anything
 * else is looked at.
 */
export function scrubText(text: string, ctx: ScrubContext): string {
  // A path that starts at a known home is swallowed up to the next quote or the
  // end of the line, spaces included: whatever follows may name an addon.
  const homeRest = (_m: string, rest: string | undefined): string =>
    rest ? "%USERPROFILE%/<path>" : "%USERPROFILE%";
  let t = text;
  for (const home of ctx.homes) {
    const parts = home.split("/").filter((p) => p !== "");
    const body = parts.map(escapeRegExp).join("[\\/]+");
    const lead = home.startsWith("/") ? "[\\/]" : "";
    t = t.replace(new RegExp(`${lead}${body}([\\/][^'"]*)?`, "gi"), homeRest);
  }
  t = t.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"<>|:*?,]+([\\/][^'"]*)?/gi, homeRest);
  t = t.replace(/(?<![\w.<>%-])\/(?:home|Users)\/[^/\s'"]+(\/[^'"]*)?/g, homeRest);
  t = t.replace(/[A-Za-z]--Users-[^\s'"/\\]*/gi, "<path>");
  t = t.replace(/[A-Za-z]:[\\/][^'"]*/g, "<path>");
  for (const a of ctx.accounts) {
    if (a.length >= 2) t = t.replace(new RegExp(escapeRegExp(a), "gi"), "<account>");
  }
  t = t.replace(/(?<!\d)7656\d{13}(?!\d)/g, "<steam-id>");
  t = t.replace(/\buser\d{10,}\b/gi, "user<id>");
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "<email>");
  return t;
}

export class ScrubError extends Error {
  constructor(what: string) {
    super(`scrub check failed: ${what} (the offending text is not printed)`);
    this.name = "ScrubError";
  }
}

/**
 * Defence in depth: throws when a string that is about to be written still
 * holds an account name, a home path, a drive or POSIX home path, a Steam id
 * or an e-mail address. The message never repeats the offending text.
 */
export function assertScrubbed(text: string, ctx: ScrubContext, where = "output"): void {
  const lower = text.toLowerCase();
  if (containsMachinePath(text)) throw new ScrubError(`${where} holds a machine path`);
  if (/Users[\\/]/i.test(text)) throw new ScrubError(`${where} holds a Users path segment`);
  for (const home of ctx.homes) {
    if (home.length > 2 && lower.includes(home)) throw new ScrubError(`${where} holds a home path`);
    if (home.length > 2 && lower.includes(home.replace(/\//g, "\\\\"))) {
      throw new ScrubError(`${where} holds a home path`);
    }
  }
  for (const a of ctx.accounts) {
    if (a.length >= 3 && lower.includes(a.toLowerCase())) {
      throw new ScrubError(`${where} holds an account name`);
    }
  }
  if (/(?<!\d)7656\d{13}(?!\d)/.test(text)) throw new ScrubError(`${where} holds a Steam id`);
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(text)) {
    throw new ScrubError(`${where} holds an e-mail address`);
  }
}

// ── Line shapes ───────────────────────────────────────────────────────────────

const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(.*)$/;
const CHANNEL_RE = /^([A-Z][A-Z_]*)\s*(?:\(([A-Z])\))?\s*:\s?(.*)$/;

/** Milliseconds since midnight of a log timestamp, or null. */
export function timeOfLine(line: string): number | null {
  const m = TIME_RE.exec(line);
  if (!m) return null;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

export interface LogLine {
  /** Milliseconds since midnight; null for lines without a timestamp. */
  ms: number | null;
  channel: string | null;
  level: string | null;
  message: string;
}

/** Splits `HH:MM:SS.mmm  CHANNEL (L): message`. Lines in another shape keep their text as the message. */
export function parseLogLine(line: string): LogLine {
  const t = TIME_RE.exec(line);
  if (!t) return { ms: null, channel: null, level: null, message: line };
  const body = t[5];
  const c = CHANNEL_RE.exec(body);
  const ms = timeOfLine(line);
  if (!c) return { ms, channel: null, level: null, message: body };
  return { ms, channel: c[1], level: c[2] ?? null, message: c[3] };
}

/**
 * The shape of a message: quoted names, resource strings, GUIDs, numbers and
 * hex offsets replaced by tokens, so that nothing a user named survives.
 */
export function shapeMessage(message: string, ctx: ScrubContext): string {
  let t = scrubText(message, ctx);
  t = t.replace(/@"[^"]*"/g, '@"<res>"');
  t = t.replace(/\b[0-9A-F]{16}\b/g, "<guid>");
  t = t.replace(/'([^']*)'/g, (_m, inner: string) =>
    inner === "<guid>" ? "'<guid>'" : "'<name>'",
  );
  t = t.replace(/"([^"]*)"/g, (_m, inner: string) => (inner === "<res>" ? '"<res>"' : '"<name>"'));
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<guid>");
  t = t.replace(/0x[0-9a-fA-F]+/g, "<hex>");
  t = t.replace(/\b\d+(?:\.\d+)?\b/g, "<n>");
  t = t.replace(/ is obsolete(?::.*)?$/, " is obsolete");
  return t.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** `CHANNEL (L): shape` for a parsed line, or null when the line has no channel. */
export function shapeOfLine(line: LogLine, ctx: ScrubContext): string | null {
  if (line.channel === null) return null;
  const head = line.level ? `${line.channel} (${line.level})` : line.channel;
  return `${head}: ${shapeMessage(line.message, ctx)}`;
}

// ── CLI echo ──────────────────────────────────────────────────────────────────

export interface CliToken {
  switch: string;
  /** Raw value text, or null for a bare flag. Never written out unscrubbed. */
  value: string | null;
}

const SWITCH_RE = /(?:^|\s)-{1,2}([A-Za-z][A-Za-z0-9_]*)(?==|\s|$)/g;

/** Splits the text after `CLI Params:` into switches and their values. */
export function parseCliEcho(text: string): CliToken[] {
  const hits = [...text.matchAll(SWITCH_RE)];
  const out: CliToken[] = [];
  for (let i = 0; i < hits.length; i++) {
    const m = hits[i];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < hits.length ? (hits[i + 1].index ?? text.length) : text.length;
    let value = text.slice(start, end);
    if (value.startsWith("=")) value = value.slice(1);
    value = value.trim();
    out.push({ switch: m[1], value: value === "" ? null : value });
  }
  return out;
}

/** The project name a `.gproj` path names (the folder of `addon.gproj`, else the file stem). */
export function projectNameOfGproj(path: string): string | null {
  const segs = path
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
  if (segs.length === 0) return null;
  const last = segs[segs.length - 1];
  if (!/\.gproj$/i.test(last)) return null;
  if (last.toLowerCase() === "addon.gproj") return segs.length >= 2 ? segs[segs.length - 2] : null;
  return last.replace(/\.gproj$/i, "");
}

/** What kind of value a switch carried. */
export function valueKind(value: string | null): string {
  if (value === null) return "flag";
  if (/\.gproj$/i.test(value.trim())) return "project-file";
  if (/^[0-9A-Fa-f]{16}(?:,[0-9A-Fa-f]{16})*$/.test(value)) return "guid-list";
  if (/[\\/]/.test(value)) return value.includes(",") ? "path-list" : "path";
  if ((MODULES as readonly string[]).includes(value)) return "module-name";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return "number";
  return "other";
}

/** A switch value as it may be written: paths to placeholders, anything else to its kind. */
export function scrubValue(value: string | null, ctx: ScrubContext): string {
  if (value === null) return "";
  const kind = valueKind(value);
  if (kind === "path" || kind === "project-file") return scrubPath(value, ctx);
  if (kind === "path-list")
    return value
      .split(",")
      .map((p) => scrubPath(p, ctx))
      .join(",");
  if (kind === "module-name") return value;
  if (kind === "guid-list") return "<guid-list>";
  if (kind === "number") return "<n>";
  return "<value>";
}

/** The scrubbed `CLI Params:` line (`CLI Params: -a <v> -b`). */
export function scrubbedEcho(tokens: readonly CliToken[], ctx: ScrubContext): string {
  const parts = tokens.map((t) => {
    const v = scrubValue(t.value, ctx);
    return v === "" ? `-${t.switch}` : `-${t.switch} ${v}`;
  });
  return `CLI Params: ${parts.join(" ")}`.trim();
}

// ── Hazards ───────────────────────────────────────────────────────────────────

export interface HazardDef {
  /** Row key in the artifact table and `#` part of the ref. */
  key: string;
  /** Key path of the hazard-dialog row (a dialog title or an exception name). */
  title: string;
  /** Detector, tried on the message of every log line. */
  test: RegExp;
}

/**
 * The hazard vocabulary. Only the missing-dependency and crash-report wordings
 * are observed in the retained logs; the others are the names the plan lists
 * and match if they ever appear.
 */
export const HAZARDS: readonly HazardDef[] = [
  {
    key: "assert-prompt",
    title: "Assertion",
    test: /\bassert(?:ion)?\b/i,
  },
  {
    key: "crash-reporter",
    title: "Crash report result",
    test: /\bcrash report/i,
  },
  {
    key: "missing-addon-dependency",
    title: "Addon dependency can't be added",
    test: /\bAddon '[^']*' dependency '[^']*' can't be added/,
  },
  {
    key: "script-authorization",
    title: "Script authorization",
    test: /\bscripts?\b.*\bauthori[sz]|\bauthori[sz]\w*\b.*\bscripts?\b/i,
  },
  {
    key: "vm-exception",
    title: "Virtual Machine Exception",
    test: /\bVirtual Machine Exception\b/i,
  },
];

const CRASH_LINE_RE =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \(UTC\) : Version: (\S+) - Report Result: (.*?)- Crash GUID: ([0-9a-fA-F-]{36})\s*$/;

/** `<date> <time> (UTC) : Version: <version> - Report Result: ... - Crash GUID: <guid>`, or null. */
export function shapeOfCrashLine(line: string): string | null {
  const m = CRASH_LINE_RE.exec(line.trim());
  if (!m) return null;
  const result = /^[-A-Z ]{0,40}$/.test(m[4]) ? m[4] : "<result> ";
  return `<date> <time> (UTC) : Version: <version> - Report Result: ${result}- Crash GUID: <guid>`;
}

export interface HazardHit {
  /** Lines that matched, per log file name (`CrashReports.log` for the crash list). */
  lines: Map<string, number>;
  /** Shape of the first matching line. */
  quote: string | null;
}

function emptyHits(): Map<string, HazardHit> {
  return new Map(HAZARDS.map((h) => [h.key, { lines: new Map<string, number>(), quote: null }]));
}

// ── One session ───────────────────────────────────────────────────────────────

export interface VocabEntry {
  channel: string;
  level: string;
  lines: number;
}

export interface SessionFacts {
  /** Folder name without the `logs_` prefix (a timestamp). */
  session: string;
  /** `YYYY-MM-DD` from the folder name. */
  date: string | null;
  /** `.log` files that exist in the folder. */
  files: string[];
  /** Scrubbed echo, or null when the session never logged one. */
  echo: string | null;
  /** Switch names as echoed, in order. */
  switches: string[];
  /** Per switch, the value kind. */
  value_kinds: Record<string, string>;
  /** `gproj+addonsDir`-style form key; `none` without an echo. */
  form: string;
  asked_project: string | null;
  opened_project: string | null;
  /** Lower-case raw names, for comparison only (never written). */
  askedRaw: string | null;
  openedRaw: string | null;
  opened_matches_asked: boolean | null;
  thumbnail_matches_autosave: boolean | null;
  last_loaded_addon_matches_autosave: boolean | null;
  cwd: "game" | "other" | null;
  game_version: string | null;
  reached_init: boolean;
  create_to_init_ms: number | null;
  startup_ms: number | null;
  hazards: Map<string, HazardHit>;
  vocab: Map<string, VocabEntry>;
}

/** Regex that names the opened project (group 1). Documented in the table and the return value. */
export const OPENED_PROJECT_PATTERN =
  "Using autosave directory: .*[\\\\/]Projects[\\\\/]([^\\\\/]+)[\\\\/]autosaves";
const OPENED_RE = new RegExp(OPENED_PROJECT_PATTERN);
const THUMBNAIL_RE =
  /Using thumbnail cache directory: .*[\\/]Projects[\\/]([^\\/]+)[\\/]thumbnails/;

function sessionDate(folder: string): string | null {
  const m = /^logs_(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}$/.exec(folder);
  return m ? m[1] : null;
}

function lastLoadedAddon(lines: readonly LogLine[]): string | null {
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].channel === "ENGINE" && /^Loaded addons:\s*$/.test(lines[i].message)) at = i;
  }
  if (at < 0) return null;
  let last: string | null = null;
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^gproj: '([^']+)'/.exec(lines[i].message);
    if (!m) break;
    last = projectNameOfGproj(m[1]);
  }
  return last;
}

function addHazards(
  hits: Map<string, HazardHit>,
  file: string,
  line: LogLine,
  ctx: ScrubContext,
): void {
  if (/^Module:/.test(line.message) || /\bdefines:/.test(line.message)) return;
  for (const h of HAZARDS) {
    if (!h.test.test(line.message)) continue;
    const hit = hits.get(h.key);
    if (!hit) continue;
    hit.lines.set(file, (hit.lines.get(file) ?? 0) + 1);
    if (hit.quote === null) hit.quote = shapeOfLine(line, ctx) ?? shapeMessage(line.message, ctx);
  }
}

/**
 * Parses one session folder. `files` maps a `.log` file name to its text. The
 * scrub context collects project tokens as it goes, so sessions must be
 * parsed in sorted order for the numbering to be deterministic.
 */
export function parseSession(
  folder: string,
  files: Readonly<Record<string, string>>,
  ctx: ScrubContext,
): SessionFacts {
  const names = Object.keys(files).sort(compareCodeUnits);
  const facts: SessionFacts = {
    session: folder.replace(/^logs_/, ""),
    date: sessionDate(folder),
    files: names,
    echo: null,
    switches: [],
    value_kinds: {},
    form: "none",
    asked_project: null,
    opened_project: null,
    askedRaw: null,
    openedRaw: null,
    opened_matches_asked: null,
    thumbnail_matches_autosave: null,
    last_loaded_addon_matches_autosave: null,
    cwd: null,
    game_version: null,
    reached_init: false,
    create_to_init_ms: null,
    startup_ms: null,
    hazards: emptyHits(),
    vocab: new Map(),
  };
  const consoleText = files["console.log"];
  if (consoleText === undefined) return facts;
  const lines = splitLines(consoleText).map(parseLogLine);

  const create = lines.find((l) => l.ms !== null)?.ms ?? null;
  const initAt = lines.findIndex((l) => /Workbench Init Engine\s*$/.test(l.message));
  const echoAt = lines.findIndex((l) => l.channel === "ENGINE" && /^CLI Params:/.test(l.message));

  if (echoAt >= 0) {
    const tokens = parseCliEcho(lines[echoAt].message.replace(/^CLI Params:\s*/, ""));
    facts.switches = tokens.map((t) => t.switch);
    for (const t of tokens) facts.value_kinds[t.switch] = valueKind(t.value);
    facts.form = tokens.length > 0 ? tokens.map((t) => t.switch).join("+") : "empty";
    const project = tokens.find((t) => PROJECT_SWITCHES.includes(t.switch) && t.value !== null);
    const askedName = project?.value ? projectNameOfGproj(project.value) : null;
    if (askedName) facts.askedRaw = askedName.toLowerCase();
    // Scrub order fixes token numbering: the echo first, then the opened project.
    facts.echo = scrubbedEcho(tokens, ctx);
    if (askedName) facts.asked_project = projectToken(ctx, askedName);
  }

  const initLine = initAt >= 0 ? initAt : echoAt;
  facts.reached_init = initLine >= 0;
  if (create !== null && initLine >= 0 && lines[initLine].ms !== null) {
    let gap = (lines[initLine].ms as number) - create;
    if (gap < 0) gap += 24 * 3600 * 1000;
    facts.create_to_init_ms = gap;
  }

  for (const l of lines) {
    const startup = /^Workbench startup took:\s*([0-9.]+)\s*ms/.exec(l.message);
    if (startup && facts.startup_ms === null) facts.startup_ms = Math.round(Number(startup[1]));
    const cwd = /^FileSystem: Current working directory: '([^']*)'/.exec(l.message);
    if (cwd && facts.cwd === null) {
      facts.cwd = /[\\/]arma reforger[\\/]?$/i.test(cwd[1].trim()) ? "game" : "other";
    }
    const ver = /^Creating game instance\(\w+\), version (\d+(?:\.\d+){2,3})/.exec(l.message);
    if (ver && facts.game_version === null) facts.game_version = ver[1];
  }

  let thumbRaw: string | null = null;
  for (const l of lines) {
    const o = OPENED_RE.exec(l.message);
    if (o && facts.openedRaw === null) facts.openedRaw = o[1].toLowerCase();
    if (o && facts.opened_project === null) facts.opened_project = projectToken(ctx, o[1]);
    const th = THUMBNAIL_RE.exec(l.message);
    if (th && thumbRaw === null) thumbRaw = th[1].toLowerCase();
  }
  if (facts.openedRaw !== null) {
    facts.opened_matches_asked =
      facts.askedRaw === null ? null : facts.askedRaw === facts.openedRaw;
    facts.thumbnail_matches_autosave = thumbRaw === null ? null : thumbRaw === facts.openedRaw;
    const loaded = lastLoadedAddon(lines);
    facts.last_loaded_addon_matches_autosave =
      loaded === null ? null : loaded.toLowerCase() === facts.openedRaw;
  }

  for (const l of lines) {
    if ((l.level === "E" || l.level === "W") && l.channel !== null) {
      const shape = shapeOfLine(l, ctx);
      if (shape !== null && !containsMachinePath(shape)) {
        const prior = facts.vocab.get(shape);
        if (prior) prior.lines++;
        else facts.vocab.set(shape, { channel: l.channel, level: l.level, lines: 1 });
      }
    }
  }
  for (const name of names) {
    for (const raw of splitLines(files[name]))
      addHazards(facts.hazards, name, parseLogLine(raw), ctx);
  }
  return facts;
}

/** Hazard hits of the crash-reports file (`CrashReports.log`), one line per report. */
export function parseCrashReports(text: string, ctx: ScrubContext): Map<string, HazardHit> {
  const hits = emptyHits();
  const crash = hits.get("crash-reporter");
  if (!crash) return hits;
  for (const raw of splitLines(text)) {
    const shape = shapeOfCrashLine(raw);
    if (shape === null) continue;
    crash.lines.set("CrashReports.log", (crash.lines.get("CrashReports.log") ?? 0) + 1);
    if (crash.quote === null) crash.quote = scrubText(shape, ctx);
  }
  return hits;
}

// ── Game logs (one question) ──────────────────────────────────────────────────

export interface GameLogsCheck {
  present: boolean;
  session_folders: number;
  console_logs_read: number;
  /** Folders whose console.log carries a Workbench startup marker line. */
  folders_with_workbench_session_markers: number;
  /** Folders whose console.log echoes `CLI Params:` (the game's own switches). */
  folders_with_cli_echo: number;
}

const WORKBENCH_MARKER_RE =
  /(?:Workbench Create Engine took|Workbench Init Engine|Workbench startup took)/;

/** Counts game log folders and whether any of them looks like a Workbench session. */
export function checkGameLogs(dir: string): GameLogsCheck {
  const empty: GameLogsCheck = {
    present: false,
    session_folders: 0,
    console_logs_read: 0,
    folders_with_workbench_session_markers: 0,
    folders_with_cli_echo: 0,
  };
  if (!existsSync(dir)) return empty;
  const out = { ...empty, present: true };
  for (const folder of readdirSync(dir)
    .filter((f) => /^logs_/.test(f))
    .sort(compareCodeUnits)) {
    out.session_folders++;
    const file = join(dir, folder, "console.log");
    if (!existsSync(file)) continue;
    out.console_logs_read++;
    const text = readFileSync(file, "utf-8");
    if (WORKBENCH_MARKER_RE.test(text)) out.folders_with_workbench_session_markers++;
    if (/ENGINE\s*:\s*CLI Params:/.test(text)) out.folders_with_cli_echo++;
  }
  return out;
}

// ── Mining a logs folder ──────────────────────────────────────────────────────

export interface RawInput {
  /** Placeholder path, never absolute. */
  path: string;
  sha256: string;
}

export interface MineResult {
  sessions: SessionFacts[];
  /** Session folders found (with or without a console.log). */
  session_folders: number;
  crash: Map<string, HazardHit>;
  crash_reports_present: boolean;
  inputs: RawInput[];
  log_files_read: Record<string, number>;
}

/** Reads every retained session under `logsDir` and parses it. Sorted order; no writes. */
export function mineLogs(logsDir: string, ctx: ScrubContext): MineResult {
  const folders = readdirSync(logsDir)
    .filter((f) => /^logs_/.test(f) && statSync(join(logsDir, f)).isDirectory())
    .sort(compareCodeUnits);
  const loaded: { folder: string; files: Record<string, string> }[] = [];
  const inputs: RawInput[] = [];
  const counts: Record<string, number> = {};
  for (const folder of folders) {
    const files: Record<string, string> = {};
    for (const name of readdirSync(join(logsDir, folder))
      .filter((n) => n.endsWith(".log"))
      .sort(compareCodeUnits)) {
      const bytes = readFileSync(join(logsDir, folder, name));
      files[name] = bytes.toString("utf-8");
      inputs.push({ path: `<workbench-logs>/${folder}/${name}`, sha256: sha256(bytes) });
      counts[name] = (counts[name] ?? 0) + 1;
      learnAccounts(ctx, discoverAccounts(files[name]));
    }
    loaded.push({ folder, files });
  }
  let crash = emptyHits();
  const crashFile = join(logsDir, "CrashReports.log");
  const crashPresent = existsSync(crashFile);
  if (crashPresent) {
    const bytes = readFileSync(crashFile);
    const text = bytes.toString("utf-8");
    learnAccounts(ctx, discoverAccounts(text));
    inputs.push({ path: "<workbench-logs>/CrashReports.log", sha256: sha256(bytes) });
    counts["CrashReports.log"] = 1;
    crash = parseCrashReports(text, ctx);
  }
  const sessions = loaded.map((l) => parseSession(l.folder, l.files, ctx));
  inputs.sort((a, b) => compareCodeUnits(a.path, b.path));
  return {
    sessions,
    session_folders: folders.length,
    crash,
    crash_reports_present: crashPresent,
    inputs,
    log_files_read: counts,
  };
}

// ── Tables ────────────────────────────────────────────────────────────────────

export interface TableFile {
  name: string;
  text: string;
  sha256: string;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json | undefined };
type Row = { key: string } & { [k: string]: Json | undefined };

function tableFile(name: string, build: string, comment: string, rows: Row[]): TableFile {
  const sorted = [...rows].sort((a, b) => compareCodeUnits(a.key, b.key));
  const text = formatJson({
    $comment: comment,
    build,
    enumerator: ENUMERATOR_ID,
    rows: sorted,
    table: name,
  });
  return { name: `${name}.json`, text, sha256: sha256(text) };
}

function hasHazardLine(s: SessionFacts, key: string): boolean {
  const h = s.hazards.get(key);
  return h !== undefined && h.lines.size > 0;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

function stats(values: readonly number[]): { min: number; median: number; max: number } | null {
  if (values.length === 0) return null;
  return { min: Math.min(...values), median: median(values) as number, max: Math.max(...values) };
}

function tally<T extends string>(items: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compareCodeUnits(a, b)));
}

export interface ProjectSwitchOutcome {
  switch: string;
  phantom: boolean;
  sessions: number;
  opened_matches_asked: number;
  opened_differs_from_asked: number;
  /** What the differing sessions opened instead (project tokens or base-game names). */
  differing_opened: Record<string, number>;
  /** Differing sessions whose logs carry a missing-addon-dependency line. */
  differing_with_missing_dependency_line: number;
}

export interface Headline {
  session_folders: number;
  sessions_with_console_log: number;
  log_files_read: Record<string, number>;
  log_files_read_total: number;
  date_first: string | null;
  date_last: string | null;
  sessions_with_echo: number;
  sessions_reached_init: number;
  sessions_per_form: Record<string, number>;
  distinct_switches: string[];
  phantom_sessions: number;
  phantom_opened_matches_asked: number;
  phantom_opened_differs: number;
  phantom_opened: Record<string, number>;
  /** Per project-selecting switch: what the sessions that asked for a project actually opened. */
  project_switch_outcomes: ProjectSwitchOutcome[];
  opened_project_pattern: string;
  opened_project_matches: number;
  opened_project_expected: number;
  hazard_lines_by_type: Record<string, number>;
}

export interface Derived {
  tables: TableFile[];
  rows: Observation[];
  headline: Headline;
}

function allHazardCounts(
  mined: MineResult,
): Map<string, { lines: Record<string, number>; sessions: number; quote: string | null }> {
  const out = new Map<
    string,
    { lines: Record<string, number>; sessions: number; quote: string | null }
  >();
  for (const h of HAZARDS) out.set(h.key, { lines: {}, sessions: 0, quote: null });
  const add = (hits: Map<string, HazardHit>, countSession: boolean): void => {
    for (const [key, hit] of hits) {
      const o = out.get(key);
      if (!o) continue;
      let any = false;
      for (const [file, n] of hit.lines) {
        o.lines[file] = (o.lines[file] ?? 0) + n;
        any = true;
      }
      if (any && countSession) o.sessions++;
      if (o.quote === null && hit.quote !== null) o.quote = hit.quote;
    }
  };
  for (const s of mined.sessions) add(s.hazards, true);
  add(mined.crash, false);
  return out;
}

/** Builds the artifact tables, the observation rows and the headline counts. */
export function derive(mined: MineResult, game: GameLogsCheck, build: string): Derived {
  const sessions = mined.sessions.filter((s) => s.files.includes("console.log"));
  const m = sessions.length;
  const dates = sessions
    .map((s) => s.date)
    .filter((d): d is string => d !== null)
    .sort(compareCodeUnits);

  // sessions.json
  const sessionRows: Row[] = sessions.map((s) => ({
    key: `session:${s.session}`,
    session: s.session,
    date: s.date,
    files: s.files,
    form: s.form,
    echo: s.echo,
    switches: s.switches,
    reached_init: s.reached_init,
    create_to_init_ms: s.create_to_init_ms,
    startup_ms: s.startup_ms,
    asked_project: s.asked_project,
    opened_project: s.opened_project,
    opened_matches_asked: s.opened_matches_asked,
    thumbnail_matches_autosave: s.thumbnail_matches_autosave,
    last_loaded_addon_matches_autosave: s.last_loaded_addon_matches_autosave,
    cwd: s.cwd,
    game_version: s.game_version,
    hazard_lines: Object.fromEntries(
      [...s.hazards]
        .filter(([, h]) => h.lines.size > 0)
        .map(([k, h]) => [k, [...h.lines.values()].reduce((a, b) => a + b, 0)]),
    ),
  }));
  const sessionsTable = tableFile(
    "sessions",
    build,
    "One row per retained Workbench session. Paths are placeholders, project names are <project-N> tokens numbered by first appearance over the sorted sessions.",
    sessionRows,
  );

  // cli-switches.json
  const switchNames = [...new Set(sessions.flatMap((s) => s.switches))].sort(compareCodeUnits);
  const switchRows: Row[] = switchNames.map((sw) => {
    const using = sessions.filter((s) => s.switches.includes(sw));
    const withEcho = using.filter((s) => s.echo !== null) as (SessionFacts & { echo: string })[];
    const shortest = [...withEcho].sort(
      (a, b) => a.echo.length - b.echo.length || compareCodeUnits(a.echo, b.echo),
    )[0];
    const matched = using.filter((s) => s.opened_matches_asked === true).length;
    const differed = using.filter((s) => s.opened_matches_asked === false).length;
    const openedSet = new Set(
      using.map((s) => s.opened_project).filter((o): o is string => o !== null),
    );
    return {
      key: sw,
      switch: sw,
      echoed_by: "Workbench console.log (CLI Params line)",
      sessions: using.length,
      of: m,
      forms: [...new Set(using.map((s) => s.form))].sort(compareCodeUnits),
      value_kinds: [...new Set(using.map((s) => s.value_kinds[sw]))].sort(compareCodeUnits),
      example_echo: shortest.echo,
      phantom: PHANTOM_SWITCHES.includes(sw),
      project_selecting: PROJECT_SWITCHES.includes(sw),
      opened_matches_asked: PROJECT_SWITCHES.includes(sw) ? matched : null,
      opened_differs_from_asked: PROJECT_SWITCHES.includes(sw) ? differed : null,
      distinct_projects_opened: PROJECT_SWITCHES.includes(sw) ? openedSet.size : null,
      opened_differs_with_missing_dependency_line: PROJECT_SWITCHES.includes(sw)
        ? using.filter(
            (s) => s.opened_matches_asked === false && hasHazardLine(s, "missing-addon-dependency"),
          ).length
        : null,
    };
  });
  const switchesTable = tableFile(
    "cli-switches",
    build,
    "One row per distinct switch echoed by Workbench itself. example_echo is the shortest scrubbed echo that carries the switch.",
    switchRows,
  );

  // launch-forms.json
  const forms = [...new Set(sessions.map((s) => s.form))].sort(compareCodeUnits);
  const formRows: Row[] = forms.map((form) => {
    const group = sessions.filter((s) => s.form === form);
    const gaps = group.map((s) => s.create_to_init_ms).filter((g): g is number => g !== null);
    const startups = group.map((s) => s.startup_ms).filter((g): g is number => g !== null);
    return {
      key: `form:${form}`,
      form,
      sessions: group.length,
      of: m,
      reached_init: group.filter((s) => s.reached_init).length,
      create_to_init_ms: stats(gaps),
      startup_ms: stats(startups),
      opened_matches_asked: group.filter((s) => s.opened_matches_asked === true).length,
      opened_differs_from_asked: group.filter((s) => s.opened_matches_asked === false).length,
      opened_projects: tally(group.map((s) => s.opened_project ?? "none")),
      asked_projects: tally(group.map((s) => s.asked_project ?? "none")),
      cwd: tally(group.map((s) => s.cwd ?? "unknown")),
      phantom_switch: group.some((s) => s.switches.some((sw) => PHANTOM_SWITCHES.includes(sw))),
    };
  });
  const formsTable = tableFile(
    "launch-forms",
    build,
    "One row per launch form (the echoed switch names joined with +; none = no CLI Params line). Gap = first Workbench Init Engine line minus the first log line (engine creation).",
    formRows,
  );

  // opened-project-line.json
  // "Finished starting" = the engine reached Init and printed the startup line. The launcher
  // stage (cwd in the Tools folder) prints the startup line when it is closed without ever
  // initialising a project, and opens no project, so it is not a session that should name one.
  const completed = sessions.filter((s) => s.startup_ms !== null && s.reached_init);
  const openedMatches = sessions.filter((s) => s.opened_project !== null);
  const openedRow: Row = {
    key: "autosave-directory",
    pattern: OPENED_PROJECT_PATTERN,
    example_shape:
      "DEFAULT: Using autosave directory: %TEMP%/Arma Reforger Workbench/Projects/<project>/autosaves",
    matches_sessions: openedMatches.length,
    of_sessions_with_startup_line: completed.length,
    of_sessions: m,
    thumbnail_line_agrees: openedMatches.filter((s) => s.thumbnail_matches_autosave === true)
      .length,
    last_loaded_addon_agrees: openedMatches.filter(
      (s) => s.last_loaded_addon_matches_autosave === true,
    ).length,
    note: "The capture group is the project that the session opened; it is the folder name under Projects, not a path.",
  };
  const openedTable = tableFile(
    "opened-project-line",
    build,
    "The log line that names the opened project, how many sessions it matches, and two cross-checks.",
    [openedRow],
  );

  // hazard-lines.json
  const hazardCounts = allHazardCounts(mined);
  const hazardRows: Row[] = HAZARDS.map((h) => {
    const c = hazardCounts.get(h.key) as {
      lines: Record<string, number>;
      sessions: number;
      quote: string | null;
    };
    return {
      key: h.key,
      title: h.title,
      detector: h.test.source,
      lines_by_file: Object.fromEntries(
        Object.entries(c.lines).sort(([a], [b]) => compareCodeUnits(a, b)),
      ),
      lines_total: Object.values(c.lines).reduce((a, b) => a + b, 0),
      sessions: c.sessions,
      quote: c.quote,
    };
  });
  const hazardsTable = tableFile(
    "hazard-lines",
    build,
    "Log lines that name a hazard (blocking dialog or exception). Detectors run over console.log, error.log and script.log, and the crash list over CrashReports.log. A zero row means the vocabulary is known but not observed.",
    hazardRows,
  );

  // error-vocabulary.json
  const vocabAgg = new Map<
    string,
    { channel: string; level: string; lines: number; sessions: number }
  >();
  for (const s of sessions) {
    for (const [shape, v] of s.vocab) {
      const prior = vocabAgg.get(shape);
      if (prior) {
        prior.lines += v.lines;
        prior.sessions++;
      } else
        vocabAgg.set(shape, { channel: v.channel, level: v.level, lines: v.lines, sessions: 1 });
    }
  }
  const vocabRows: Row[] = [...vocabAgg].map(([shape, v]) => ({
    key: shape,
    channel: v.channel,
    level: v.level,
    lines: v.lines,
    sessions: v.sessions,
  }));
  const vocabTable = tableFile(
    "error-vocabulary",
    build,
    "Shapes of the (E) and (W) lines of console.log: quoted names, resource strings, GUIDs and numbers replaced by tokens.",
    vocabRows,
  );

  // game-logs-check.json
  const gameTable = tableFile(
    "game-logs-check",
    build,
    "Do Workbench sessions appear in the game's own logs folder? Counts only; no row of the ledger comes from it.",
    [{ key: "game-logs", ...game }],
  );

  // headline
  const perForm = tally(sessions.map((s) => s.form));
  const phantom = sessions.filter((s) => s.switches.some((sw) => PHANTOM_SWITCHES.includes(sw)));
  const hazardTotals: Record<string, number> = {};
  for (const h of HAZARDS) {
    hazardTotals[h.key] = Object.values(
      (hazardCounts.get(h.key) as { lines: Record<string, number> }).lines,
    ).reduce((a, b) => a + b, 0);
  }
  const readTotal = Object.values(mined.log_files_read).reduce((a, b) => a + b, 0);
  const headline: Headline = {
    session_folders: mined.session_folders,
    sessions_with_console_log: m,
    log_files_read: Object.fromEntries(
      Object.entries(mined.log_files_read).sort(([a], [b]) => compareCodeUnits(a, b)),
    ),
    log_files_read_total: readTotal,
    date_first: dates[0] ?? null,
    date_last: dates[dates.length - 1] ?? null,
    sessions_with_echo: sessions.filter((s) => s.echo !== null).length,
    sessions_reached_init: sessions.filter((s) => s.reached_init).length,
    sessions_per_form: perForm,
    distinct_switches: switchNames,
    phantom_sessions: phantom.length,
    phantom_opened_matches_asked: phantom.filter((s) => s.opened_matches_asked === true).length,
    phantom_opened_differs: phantom.filter((s) => s.opened_matches_asked === false).length,
    phantom_opened: tally(phantom.map((s) => s.opened_project ?? "none")),
    project_switch_outcomes: PROJECT_SWITCHES.map((sw) => {
      const using = sessions.filter((s) => s.switches.includes(sw));
      const differing = using.filter((s) => s.opened_matches_asked === false);
      return {
        switch: sw,
        phantom: PHANTOM_SWITCHES.includes(sw),
        sessions: using.length,
        opened_matches_asked: using.filter((s) => s.opened_matches_asked === true).length,
        opened_differs_from_asked: differing.length,
        differing_opened: tally(differing.map((s) => s.opened_project ?? "none")),
        differing_with_missing_dependency_line: differing.filter((s) =>
          hasHazardLine(s, "missing-addon-dependency"),
        ).length,
      };
    }),
    opened_project_pattern: OPENED_PROJECT_PATTERN,
    opened_project_matches: openedMatches.length,
    opened_project_expected: completed.length,
    hazard_lines_by_type: hazardTotals,
  };
  const summaryTable = tableFile(
    "summary",
    build,
    "Headline counts of the E13 run; every number is recomputable from the other tables.",
    [{ key: "headline", ...(headline as unknown as { [k: string]: Json }) }],
  );

  const tables = [
    sessionsTable,
    switchesTable,
    formsTable,
    openedTable,
    hazardsTable,
    vocabTable,
    gameTable,
    summaryTable,
  ];

  // Observation rows.
  const rows: Observation[] = [];
  for (const r of switchRows) {
    const sw = r.key;
    // A phantom switch (absent from the executable, plan 2.1) is echoed because the echo prints
    // whatever was passed; it is not a vanilla switch, so it stays in the artifact table only.
    if (PHANTOM_SWITCHES.includes(sw)) continue;
    const obs: Observation = {
      dim: "cli",
      kind: "cli-switch",
      module: "none",
      key: { switch: sw },
      parent_key: null,
      label: `-${sw}`,
      origin: "vanilla",
      ref: `artifact:${switchesTable.sha256}#${sw}`,
      quote: String(r.example_echo).slice(0, QUOTE_MAX),
      confidence: "high",
    };
    rows.push(obs);
  }
  for (const h of HAZARDS) {
    const c = hazardCounts.get(h.key) as {
      lines: Record<string, number>;
      sessions: number;
      quote: string | null;
    };
    const total = Object.values(c.lines).reduce((a, b) => a + b, 0);
    if (total === 0 || c.quote === null) continue;
    rows.push({
      dim: "ui",
      kind: "hazard-dialog",
      module: "Shared",
      key: { path: [h.title] },
      parent_key: null,
      label: h.title,
      origin: "vanilla",
      ref: `artifact:${hazardsTable.sha256}#${h.key}`,
      quote: c.quote.slice(0, QUOTE_MAX),
      confidence: "medium",
      unverified: [
        "whether a dialog is shown for this condition: the log line names the condition, not a dialog title",
        ...(h.key === "crash-reporter"
          ? [
              "the crash list is cumulative and records the build of each report, so the quoted line may come from a build other than the one enumerated",
            ]
          : []),
      ],
    });
  }
  rows.sort((a, b) => compareCodeUnits(rowId(a), rowId(b)));
  return { tables, rows, headline };
}

function rowId(o: Observation): string {
  return deriveId(o);
}

// ── Files ─────────────────────────────────────────────────────────────────────

/** Exact text of the E13 observation file. */
export function observationFileText(
  rows: readonly Observation[],
  inputs: readonly RawInput[],
  build: string,
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs,
    provisional: false,
    row_count: rows.length,
  };
  return [jsonlLine(header, ["$header"]), ...rows.map((o) => jsonlLine(o))].join("\n") + "\n";
}

/** Resolves `--out`, refusing anything outside `<census>/observations/E13/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E13/ (E13 writes only its own observation directory)",
    );
  }
  return file;
}

/** Default Workbench profile logs folder. */
export function defaultLogsDir(home: string = homedir()): string {
  return join(home, "Documents", "My Games", "ArmaReforgerWorkbench", "logs");
}

/** Default game profile logs folder. */
export function defaultGameLogsDir(home: string = homedir()): string {
  return join(home, "Documents", "My Games", "ArmaReforger", "logs");
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e13-launch-logs.ts [--build <tag>] [--data <dir>] [--logs <dir>] [--game-logs <dir>] [--artifacts <dir>] [--out <file under observations/E13/>] [--json]";

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e13-launch-logs", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        data: { type: "string" },
        logs: { type: "string" },
        "game-logs": { type: "string" },
        artifacts: { type: "string" },
        out: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const paths = pathsFrom(values.data);
    const build = values.build ?? loadCurrentBuild(paths).tag;
    let out: string;
    try {
      out = resolveOut(paths, values.out, build);
    } catch (e) {
      io.err(`e13-launch-logs: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const logsDir = values.logs ? resolve(values.logs) : defaultLogsDir();
    if (!existsSync(logsDir)) {
      io.out("NO DATA: no Workbench logs folder on this machine; nothing mined");
      return EXIT_USAGE;
    }
    let artDir: string;
    try {
      artDir = values.artifacts
        ? resolve(values.artifacts)
        : join(artifactsDir(), "census", build, ENUMERATOR_ID);
      if (insideGitWorkTree(artDir)) {
        throw new Error(
          "the artifacts folder lies inside a git working tree; raw material never enters one",
        );
      }
    } catch (e) {
      io.err(`e13-launch-logs: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const gameDir = values["game-logs"] ? resolve(values["game-logs"]) : defaultGameLogsDir();

    const ctx = makeScrubContext();
    const mined = mineLogs(logsDir, ctx);
    const game = checkGameLogs(gameDir);
    const derived = derive(mined, game, build);
    const obsText = observationFileText(derived.rows, mined.inputs, build);
    try {
      for (const t of derived.tables) assertScrubbed(t.text, ctx, `table ${t.name}`);
      assertScrubbed(obsText, ctx, "observation file");
    } catch (e) {
      io.err(`e13-launch-logs: ${e instanceof Error ? e.message : String(e)}; nothing written`);
      return EXIT_FAIL;
    }

    mkdirSync(artDir, { recursive: true });
    for (const t of derived.tables) writeFileAtomic(join(artDir, t.name), t.text);
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, obsText);

    const h = derived.headline;
    const byKind = {
      "cli-switch": derived.rows.filter((r) => r.kind === "cli-switch").length,
      "hazard-dialog": derived.rows.filter((r) => r.kind === "hazard-dialog").length,
    };
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e13-launch-logs",
          build,
          rows: derived.rows.length,
          rows_by_kind: byKind,
          headline: h,
          tables: derived.tables.map((t) => ({ file: t.name, sha256: t.sha256 })),
          game_logs: game,
        }),
      );
      return EXIT_OK;
    }
    for (const t of derived.tables) io.out(`table ${t.name} sha256 ${t.sha256}`);
    io.out(
      `E13 at build ${build}: ${derived.rows.length} observation${derived.rows.length !== 1 ? "s" : ""} ` +
        `(${byKind["cli-switch"]} cli-switch, ${byKind["hazard-dialog"]} hazard-dialog) from ${h.sessions_with_console_log} session` +
        `${h.sessions_with_console_log !== 1 ? "s" : ""} (${h.session_folders} folder${h.session_folders !== 1 ? "s" : ""}), ` +
        `${h.log_files_read_total} log file${h.log_files_read_total !== 1 ? "s" : ""} read`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
