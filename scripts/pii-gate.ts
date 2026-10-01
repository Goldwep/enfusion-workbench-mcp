/**
 * PII gate (2.0 plan, section 5.2). Scans files for personal data before it
 * can reach a commit or the public export.
 *
 *   npx tsx scripts/pii-gate.ts --staged            staged blobs (pre-commit hook)
 *   npx tsx scripts/pii-gate.ts --tree <dir>        tracked files under <dir> (`git ls-files`),
 *                                                   or every file when <dir> is not a work tree
 *   npx tsx scripts/pii-gate.ts --files <path...>   the named files
 *   npx tsx scripts/pii-gate.ts ... --allow <json>  use another allow-list (default:
 *                                                   scripts/pii-allow.json next to this script)
 *
 * Exit codes: 0 clean, 1 findings, 2 configuration error.
 *
 * Two pattern sources:
 *
 *   1. Generic patterns, tracked here (see GENERIC_PATTERNS): a Windows home-path
 *      shape, a Steam64 id shape and an e-mail shape.
 *   2. Owner-specific patterns (account name, project names, ...) read from an
 *      UNTRACKED file outside the repository, one entry per line:
 *        win32:     %LOCALAPPDATA%\enfusion-mcp\pii-patterns.txt
 *        elsewhere: $XDG_CONFIG_HOME/enfusion-mcp/pii-patterns.txt
 *                   (or ~/.config/enfusion-mcp/pii-patterns.txt)
 *        override:  ENFUSION_PII_PATTERNS=<file>
 *      A line is a literal, or a regular expression when prefixed with `re:`.
 *      Blank lines and lines starting with `#` are ignored. Both forms match
 *      case-insensitively. When the file is missing (or holds no pattern) the
 *      gate refuses to pass with exit 2, unless the `CI` environment variable is
 *      set, in which case it runs with the generic patterns only and says so.
 *
 * Known-benign matches (placeholder paths in docs) live in `scripts/pii-allow.json`
 * as `{ "path": <repo-relative path>, "string": <exact matched text> }` entries.
 *
 * Output: `path:line: <pattern name>: <masked match>`. The match is masked to its
 * first and last character; the full matched text is never printed, and owner
 * patterns are reported by line number only, never by their text.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep, win32 } from "node:path";
import { pathToFileURL } from "node:url";

// ── Constants ────────────────────────────────────────────────────────────────

/** Files larger than this are skipped by the CLI and reported as skipped. */
export const MAX_SCAN_BYTES = 5 * 1024 * 1024;

/** A NUL byte within this many leading bytes marks a file as binary. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

/** Path segments that are never scanned. */
const SKIPPED_SEGMENTS = new Set([".git", "node_modules", "dist"]);

/** Default allow-list location (tracked, next to this script). */
export const DEFAULT_ALLOW_PATH = join(import.meta.dirname ?? ".", "pii-allow.json");

// ── Types ────────────────────────────────────────────────────────────────────

export interface PiiPattern {
  /** Name printed with each finding. Owner patterns are named by line number only. */
  name: string;
  /** Global regular expression. */
  regex: RegExp;
  /** Returns true when a raw match is a known placeholder and not a finding. */
  ignore?: (match: RegExpMatchArray) => boolean;
}

export interface PiiFinding {
  /** 1-based line number. */
  line: number;
  /** 1-based column of the first matched character. */
  column: number;
  /** Pattern name. */
  pattern: string;
  /** Exact matched text. Never print it; use `maskMatch`. */
  match: string;
}

export interface LoadedPatterns {
  /** Generic patterns followed by owner patterns. */
  patterns: PiiPattern[];
  /** The owner pattern file that was looked for. */
  ownerFile: string;
  /** Number of owner patterns loaded (0 when the file was absent under CI). */
  ownerCount: number;
  /** Human-readable note when the gate runs in a reduced mode (CI, generic only). */
  notice?: string;
}

export interface LoadPatternsOptions {
  /** Environment to read `ENFUSION_PII_PATTERNS`, `CI`, `LOCALAPPDATA`, `XDG_CONFIG_HOME` from. */
  env?: NodeJS.ProcessEnv;
  /** Platform deciding the default owner file location. */
  platform?: NodeJS.Platform;
  /** Home directory used for the non-win32 fallback location. */
  home?: string;
}

export interface AllowEntry {
  /** Repo-relative path with forward slashes. */
  path: string;
  /** Exact matched text that is benign in that file. */
  string: string;
  /** Why the match is benign. */
  reason?: string;
}

export interface ScanTarget {
  /** Repo-relative (or tree-relative) display path with forward slashes. */
  path: string;
  /** Reads the bytes to scan. */
  read: () => Buffer;
  /** Size in bytes when known without reading. */
  size?: number;
}

export interface FileReport {
  /** Display path. */
  path: string;
  /** Findings left after the allow-list. */
  findings: PiiFinding[];
  /** Findings removed by the allow-list. */
  allowed: number;
  /** Why the file was not scanned, when it was not. */
  skipped?: string;
}

// ── Generic patterns ─────────────────────────────────────────────────────────

/**
 * Profile-name placeholders that are not personal data:
 * `<you>`, `<user>`, `<owner>`, `<name>` and any other `<...>` or `{...}` token
 * (an HTML-escaped `&lt;...&gt;` token stops at `;`, so the bare `&lt` counts too),
 * `%USERPROFILE%` / `%USERNAME%` and any other `%VAR%`, `$env:USERPROFILE` and any
 * other `$env:VAR`, `$USER` / `${USER}`, `~`, an ellipsis, and the built-in
 * Windows profiles `Public` and `Default`.
 */
const PLACEHOLDER_NAME =
  /^(?:<[^<>]*>|&lt|\{[^{}]*\}|%[^%]+%|\$env:[A-Za-z_]\w*|\$\{?[A-Za-z_]\w*\}?|~|\.{2,}|\u2026|public|default)$/i;

/** Characters that end a profile-name segment. */
const NAME_CHARS = "[^\\\\/\\s\"'`|:*?,;()\\[\\]=]+";

/**
 * Generic patterns. Each example below is a placeholder and does not match.
 *
 * - `windows-home-path`: a drive-letter or Git Bash path into `Users\<name>`, either
 *   slash direction, doubled backslashes included (JSON). Example:
 *   `C:\Users\<name>\Documents`. Placeholder names (see PLACEHOLDER_NAME) are ignored.
 * - `steam64-id`: 17 digits starting with 7656. Example: `7656119xxxxxxxxxx`.
 * - `email`: a local part, `@`, a dotted domain. Example: `<user>@example.invalid`. Addresses at the
 *   reserved documentation domains (example.com/.net/.org, .example, .invalid,
 *   .test, .localhost) are ignored.
 */
export const GENERIC_PATTERNS: readonly PiiPattern[] = [
  {
    name: "windows-home-path",
    regex: new RegExp(
      `(?:\\b[A-Za-z]:|(?<![\\w./-])/[A-Za-z])[\\\\/]+users[\\\\/]+(${NAME_CHARS})`,
      "gi",
    ),
    ignore: (m) => PLACEHOLDER_NAME.test(m[1] ?? ""),
  },
  {
    name: "steam64-id",
    regex: /(?<!\d)7656\d{13}(?!\d)/g,
  },
  {
    name: "email",
    regex: /(?<![\w.%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g,
    ignore: (m) =>
      /(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost)$/i.test(m[1] ?? ""),
  },
];

// ── Pattern loading ──────────────────────────────────────────────────────────

/** True when the `CI` variable is set to something other than empty, `0` or `false`. */
export function isCi(env: NodeJS.ProcessEnv): boolean {
  const v = env.CI;
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/** Where the owner pattern file is looked for. */
export function resolvePatternsPath(options: LoadPatternsOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  if (env.ENFUSION_PII_PATTERNS) return env.ENFUSION_PII_PATTERNS;
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
    return win32.join(base, "enfusion-mcp", "pii-patterns.txt");
  }
  const base = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "enfusion-mcp", "pii-patterns.txt");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parses the owner pattern file text. Throws on an invalid `re:` line; the
 * message names the line number but never echoes the pattern text.
 */
export function parseOwnerPatterns(text: string): PiiPattern[] {
  const out: PiiPattern[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "" || raw.startsWith("#")) continue;
    const name = `owner-pattern#${i + 1}`;
    if (raw.startsWith("re:")) {
      const body = raw.slice(3);
      if (body === "") throw new Error(`owner pattern line ${i + 1}: empty regular expression`);
      try {
        out.push({ name, regex: new RegExp(body, "gi") });
      } catch {
        throw new Error(`owner pattern line ${i + 1}: invalid regular expression`);
      }
    } else {
      out.push({ name, regex: new RegExp(escapeRegExp(raw), "gi") });
    }
  }
  return out;
}

/**
 * Loads the generic patterns plus the owner patterns. Throws (a configuration
 * error) when the owner file is missing or empty and `CI` is not set.
 */
export function loadPatterns(options: LoadPatternsOptions = {}): LoadedPatterns {
  const env = options.env ?? process.env;
  const ownerFile = resolvePatternsPath(options);
  const generic = [...GENERIC_PATTERNS];
  const ci = isCi(env);

  if (!existsSync(ownerFile)) {
    if (!ci) {
      throw new Error(
        `owner pattern file not found: ${ownerFile}. Create it (one literal or "re:" regular ` +
          "expression per line; see plan OA-9) or set ENFUSION_PII_PATTERNS. " +
          "Only a CI run may proceed without it.",
      );
    }
    return {
      patterns: generic,
      ownerFile,
      ownerCount: 0,
      notice: `CI is set and ${ownerFile} is missing: generic patterns only.`,
    };
  }

  let text: string;
  try {
    text = readFileSync(ownerFile, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`cannot read owner pattern file ${ownerFile}: ${msg}`);
  }
  const owner = parseOwnerPatterns(text);
  if (owner.length === 0) {
    if (!ci) {
      throw new Error(`owner pattern file ${ownerFile} holds no pattern; refusing to pass.`);
    }
    return {
      patterns: generic,
      ownerFile,
      ownerCount: 0,
      notice: `CI is set and ${ownerFile} holds no pattern: generic patterns only.`,
    };
  }
  return { patterns: [...generic, ...owner], ownerFile, ownerCount: owner.length };
}

// ── Scanning ─────────────────────────────────────────────────────────────────

/** Scans text line by line and returns every match not ignored as a placeholder. */
export function scanText(text: string, patterns: readonly PiiPattern[]): PiiFinding[] {
  const findings: PiiFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      const re = p.regex.global ? p.regex : new RegExp(p.regex.source, p.regex.flags + "g");
      for (const m of line.matchAll(re)) {
        if (m[0] === "") continue;
        if (p.ignore?.(m)) continue;
        findings.push({ line: i + 1, column: (m.index ?? 0) + 1, pattern: p.name, match: m[0] });
      }
    }
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

/** Masks a match to its first and last character. */
export function maskMatch(match: string): string {
  const chars = Array.from(match);
  if (chars.length <= 2) return "*".repeat(chars.length);
  return `${chars[0]}***${chars[chars.length - 1]}`;
}

/** Formats one finding as `path:line: <pattern name>: <masked match>`. */
export function formatFinding(path: string, f: PiiFinding): string {
  return `${path}:${f.line}: ${f.pattern}: ${maskMatch(f.match)}`;
}

/** True when the first BINARY_SNIFF_BYTES bytes hold a NUL byte. */
export function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** True when a path has a `.git`, `node_modules` or `dist` segment. */
export function isSkippedPath(path: string): boolean {
  return path.split(/[\\/]/).some((s) => SKIPPED_SEGMENTS.has(s));
}

// ── Allow-list ───────────────────────────────────────────────────────────────

/** Loads and validates an allow-list file. A missing file is an empty list. */
export function loadAllowList(file: string): AllowEntry[] {
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`allow-list ${file} is not valid JSON: ${msg}`);
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) throw new Error(`allow-list ${file} must hold an "entries" array`);
  return entries.map((e, i) => {
    const o = e as Partial<AllowEntry>;
    if (typeof o.path !== "string" || typeof o.string !== "string" || o.string === "") {
      throw new Error(`allow-list ${file} entry ${i} needs string "path" and non-empty "string"`);
    }
    return { path: o.path, string: o.string, reason: o.reason };
  });
}

/** Normalises a path to forward slashes without a leading `./`. */
export function toPosixPath(p: string): string {
  return p.split(sep).join("/").replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Splits findings into kept and allowed. A finding is allowed when an entry has
 * the same path and exactly the matched text. Inside the allow-list file itself
 * every listed string is allowed, raw or JSON-escaped, since that file must quote them.
 */
export function applyAllowList(
  path: string,
  findings: readonly PiiFinding[],
  allow: readonly AllowEntry[],
  allowFilePath?: string,
): { kept: PiiFinding[]; allowed: PiiFinding[] } {
  const p = toPosixPath(path);
  const own = allowFilePath !== undefined && toPosixPath(allowFilePath) === p;
  const kept: PiiFinding[] = [];
  const allowed: PiiFinding[] = [];
  for (const f of findings) {
    const ok = allow.some((a) =>
      own
        ? a.string === f.match || JSON.stringify(a.string).slice(1, -1) === f.match
        : toPosixPath(a.path) === p && a.string === f.match,
    );
    (ok ? allowed : kept).push(f);
  }
  return { kept, allowed };
}

/** Scans targets: skips excluded segments, binaries and oversize files, applies the allow-list. */
export function scanTargets(
  targets: readonly ScanTarget[],
  patterns: readonly PiiPattern[],
  allow: readonly AllowEntry[],
  options: { maxBytes?: number; allowFilePath?: string } = {},
): FileReport[] {
  const maxBytes = options.maxBytes ?? MAX_SCAN_BYTES;
  const reports: FileReport[] = [];
  for (const t of targets) {
    if (isSkippedPath(t.path)) continue;
    if (t.size !== undefined && t.size > maxBytes) {
      reports.push({ path: t.path, findings: [], allowed: 0, skipped: `over ${maxBytes} bytes` });
      continue;
    }
    let buf: Buffer;
    try {
      buf = t.read();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reports.push({ path: t.path, findings: [], allowed: 0, skipped: `unreadable: ${msg}` });
      continue;
    }
    if (buf.length > maxBytes) {
      reports.push({ path: t.path, findings: [], allowed: 0, skipped: `over ${maxBytes} bytes` });
      continue;
    }
    if (isBinary(buf)) {
      reports.push({ path: t.path, findings: [], allowed: 0, skipped: "binary" });
      continue;
    }
    const raw = scanText(buf.toString("utf-8"), patterns);
    const { kept, allowed } = applyAllowList(t.path, raw, allow, options.allowFilePath);
    reports.push({ path: t.path, findings: kept, allowed: allowed.length });
  }
  return reports;
}

// ── Target collection (CLI) ──────────────────────────────────────────────────

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitBuffer(cwd: string, args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitTopLevel(dir: string): string | undefined {
  try {
    return git(dir, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return undefined;
  }
}

/** Staged blobs (added, copied, modified, renamed), read from the index. */
function stagedTargets(cwd: string): { root: string; targets: ScanTarget[] } {
  const root = gitTopLevel(cwd);
  if (!root) throw new Error("--staged needs a git work tree");
  const names = git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .split("\0")
    .filter((n) => n !== "");
  const targets = names.map((n) => ({
    path: n,
    read: () => gitBuffer(root, ["show", `:${n}`]),
  }));
  return { root, targets };
}

function walk(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_SEGMENTS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; /* skip */
    }
    if (st.isDirectory()) walk(p, base, out);
    else if (st.isFile()) out.push(toPosixPath(relative(base, p)));
  }
}

/** Tracked files under a work-tree directory, or every file when it is not a work tree. */
function treeTargets(dir: string): { root: string; targets: ScanTarget[] } {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`not a directory: ${dir}`);
  const top = gitTopLevel(abs);
  const fileTarget = (root: string, rel: string): ScanTarget | undefined => {
    const full = join(root, rel);
    let size: number;
    try {
      const st = statSync(full);
      if (!st.isFile()) return undefined;
      size = st.size;
    } catch {
      return undefined; // tracked but deleted in the work tree
    }
    return { path: rel, size, read: () => readFileSync(full) };
  };
  if (top) {
    const names = git(abs, ["ls-files", "-z", "--full-name"])
      .split("\0")
      .filter((n) => n !== "");
    return {
      root: top,
      targets: names.map((n) => fileTarget(top, n)).filter((t): t is ScanTarget => !!t),
    };
  }
  const names: string[] = [];
  walk(abs, abs, names);
  return {
    root: abs,
    targets: names.map((n) => fileTarget(abs, n)).filter((t): t is ScanTarget => !!t),
  };
}

/** Named files; display paths are relative to the enclosing work tree (or cwd). */
function fileTargets(files: string[]): { root: string; targets: ScanTarget[] } {
  const cwd = process.cwd();
  const root = gitTopLevel(cwd) ?? cwd;
  const targets: ScanTarget[] = [];
  for (const f of files) {
    const full = resolve(f);
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`not a file: ${f}`);
    const rel = relative(root, full);
    const path = rel.startsWith("..") ? toPosixPath(full) : toPosixPath(rel);
    targets.push({ path, size: statSync(full).size, read: () => readFileSync(full) });
  }
  return { root, targets };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

interface CliArgs {
  mode: "staged" | "tree" | "files";
  dir?: string;
  files: string[];
  allow: string;
}

function parseArgs(argv: string[]): CliArgs {
  let mode: CliArgs["mode"] | undefined;
  let dir: string | undefined;
  const files: string[] = [];
  let allow = DEFAULT_ALLOW_PATH;
  const setMode = (m: CliArgs["mode"]): void => {
    if (mode && mode !== m) throw new Error("use exactly one of --staged, --tree, --files");
    mode = m;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--staged") setMode("staged");
    else if (a === "--tree") {
      setMode("tree");
      dir = argv[++i];
      if (!dir) throw new Error("--tree needs a directory");
    } else if (a === "--files") {
      setMode("files");
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) files.push(argv[++i]);
      if (files.length === 0) throw new Error("--files needs at least one path");
    } else if (a === "--allow") {
      const v = argv[++i];
      if (!v) throw new Error("--allow needs a file");
      allow = resolve(v);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!mode) throw new Error("use one of --staged, --tree <dir>, --files <path...>");
  return { mode, dir, files, allow };
}

/** Runs the CLI and returns the exit code. */
export function main(argv: string[]): number {
  let loaded: LoadedPatterns;
  let allow: AllowEntry[];
  let root: string;
  let targets: ScanTarget[];
  let allowFile: string;
  try {
    const args = parseArgs(argv);
    loaded = loadPatterns();
    allow = loadAllowList(args.allow);
    allowFile = args.allow;
    ({ root, targets } =
      args.mode === "staged"
        ? stagedTargets(process.cwd())
        : args.mode === "tree"
          ? treeTargets(args.dir!)
          : fileTargets(args.files));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`pii-gate: configuration error: ${msg}`);
    return 2;
  }
  if (loaded.notice) console.error(`pii-gate: ${loaded.notice}`);

  const allowRel = toPosixPath(relative(root, allowFile));
  const reports = scanTargets(targets, loaded.patterns, allow, { allowFilePath: allowRel });
  let findings = 0;
  let allowed = 0;
  let scanned = 0;
  for (const r of reports) {
    if (r.skipped) {
      console.log(`${r.path}: skipped (${r.skipped})`);
      continue;
    }
    scanned++;
    allowed += r.allowed;
    for (const f of r.findings) {
      findings++;
      console.log(formatFinding(r.path, f));
    }
  }
  const summary =
    `pii-gate: ${scanned} file${scanned !== 1 ? "s" : ""} scanned, ` +
    `${findings} finding${findings !== 1 ? "s" : ""}, ${allowed} allow-listed, ` +
    `${loaded.ownerCount} owner pattern${loaded.ownerCount !== 1 ? "s" : ""}`;
  console.log(summary);
  return findings > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
