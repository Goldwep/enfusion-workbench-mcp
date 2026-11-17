/**
 * Release-hygiene scan of an exported tree (PLAN section 11, criterion 11; Phase 7).
 *
 *   npx tsx scripts/audit/export-scan.ts --dir <exported tree> [options]
 *   npx tsx scripts/audit/export-scan.ts --repo <path> --rev <rev> --out <new scratch dir> [options]
 *
 * The second form builds the would-be public export of <rev> without touching any branch: it
 * reads the tree with `git ls-tree`, filters it through the same allow-list and functions as
 * `scripts/export-public.ts` (`loadExportAllow`, `filterEntries`, `readTree`, `applyTransforms`),
 * writes each kept blob's exact bytes, after the export transforms, under --out (which must not exist yet, or be empty, and must lie outside
 * the repository), and then scans that folder. Nothing is committed, tagged or pushed.
 *
 * Options:
 *   --allow <file>      export filter (default scripts/export-allow.json)
 *   --names <file>      untracked file of owner identity strings, one literal per line
 *                       (# starts a comment). EXPORT_SCAN_NAMES (comma separated) adds more.
 *   --no-auto-names     do not add the OS account name and the repo's git user.email
 *   --max-mb <n>        size limit in MiB (default 50, GitHub's push warning)
 *   --json              print the findings as JSON instead of text
 *
 * Rules (each finding carries rule, file, line, column, excerpt):
 *   user-path         a home folder with a concrete account name (C:\Users\<name>, /home/<name>, /Users/<name>)
 *   owner-identity    an owner identity string (names file, env, OS account name, git user.email)
 *   email             an e-mail address that is not an obvious placeholder or no-reply address
 *   steam-id          a Steam64 id (also the one in a Workbench `.projectList_app<id>_user<id>.conf` name)
 *   registry          an HKCU / HKEY_USERS path, or a Windows account SID
 *   exe-strings       raw executable strings: census quotes with an `exe:0x` offset, MSVC RTTI names, PDB paths
 *   executable        a PE or ELF binary in the tree
 *   large-file        a file over the size limit (and `near-limit` from 90 percent of it)
 *   secret            a token, key or private key shape
 *   disallowed-path   a path the export should not carry (programme internals, census evidence, _scratch, local config)
 *   vanilla-asset     an Enfusion resource file outside the authored roots, or a Bohemia copyright header
 *
 * Exit codes: 0 no findings, 1 findings, 2 usage or git error.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_EXPORT_ALLOW_PATH,
  applyTransforms,
  filterEntries,
  loadExportAllow,
  readTree,
  type TransformRecord,
  type TreeEntry,
} from "../export-public.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type Rule =
  | "user-path"
  | "owner-identity"
  | "email"
  | "steam-id"
  | "registry"
  | "exe-strings"
  | "executable"
  | "large-file"
  | "near-limit"
  | "secret"
  | "disallowed-path"
  | "vanilla-asset";

export interface Finding {
  rule: Rule;
  /** Path relative to the scanned root, forward slashes. */
  file: string;
  /** 1-based line; 0 for a whole-file finding. */
  line: number;
  /** 1-based column; 0 for a whole-file finding. */
  column: number;
  /** The match (cut to 120 characters) or a short reason. */
  excerpt: string;
}

export interface ScanOptions {
  /** Owner identity literals (case-insensitive, whole word). */
  names?: string[];
  /** Size limit in bytes (default 50 MiB). */
  maxBytes?: number;
  /** Enfusion resource files are allowed under these path prefixes. */
  authoredRoots?: string[];
}

export interface ScanResult {
  files: number;
  bytes: number;
  findings: Finding[];
}

// ── Patterns ─────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Account names that are placeholders, not a person. Compared case-insensitively. */
const PLACEHOLDER_USERS = new Set(
  [
    "user",
    "users",
    "username",
    "user_name",
    "yourname",
    "your-name",
    "yourusername",
    "you",
    "me",
    "name",
    "public",
    "default",
    "default user",
    "all users",
    "administrator",
    "runneradmin",
    "x",
    "xxx",
    "foo",
    "test",
    "tester",
    "example",
    "someone",
    "alice",
    "bob",
    "...",
    "…",
  ].map((s) => s.toLowerCase()),
);

/** First character of a placeholder segment: <user>, %USERNAME%, $USER, {user}, *, ... */
const PLACEHOLDER_START = /^[<%${*.…[(]/;

// Built from parts so this file does not match its own rules when it is exported.
const BS = "\\\\";
const HOME_WIN = new RegExp(
  `\\b[A-Za-z]:(?:${BS}|/)+Users(?:${BS}|/)+([^${BS}/\\s"'\`<>|:*?,;]+)`,
  "g",
);
const HOME_NIX = new RegExp("(?<![\\w.:])/(?:home|Users)/([A-Za-z0-9._-]+)(?=/)", "g");
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const EMAIL_PLACEHOLDER =
  /(?:@example\.(?:com|org|net|invalid)|\.example$|\.invalid$|\.test$|\.local$|noreply|no-reply|@users\.noreply\.github\.com|@localhost)/i;
const STEAM64 = new RegExp(`(?<!\\d)${"7656"}119\\d{10}(?!\\d)`, "g");
/**
 * Registry data, not registry key names: a Windows account SID, a key under HKEY_USERS\<SID>,
 * or a .reg export header for a user hive followed by a value line (raw or JSON-escaped).
 * A bare key name such as the product key carries no user data and is not reported.
 */
const NL = `(?:\\r?\\n|${BS}r${BS}n|${BS}n)`;
const REGISTRY = new RegExp(
  [
    "\\bS-1-5-21-\\d{6,10}-\\d{6,10}-\\d{6,10}(?:-\\d{3,7})?\\b",
    `\\[HKEY_(?:CURRENT_USER|USERS)(?:${BS}|/)[^\\]\\r\\n]*\\]${NL}+${BS}?"[^"\\r\\n]*${BS}?"=`,
  ].join("|"),
  "g",
);
const EXE_STRINGS = new RegExp(
  [
    '"ref"\\s*:\\s*"exe:0x[0-9A-Fa-f]+"',
    "\\.\\?A[VU][A-Za-z_][A-Za-z0-9_@]*@@",
    "\\?\\?_[7R][0-9A-Za-z_]*@",
    `\\b[A-Za-z]:(?:${BS}|/)[^"'\\s]*\\.pdb\\b`,
  ].join("|"),
  "g",
);
const SECRET = new RegExp(
  [
    "\\bgh[pousr]_[A-Za-z0-9]{36,}\\b",
    "\\bgithub_pat_[A-Za-z0-9_]{40,}\\b",
    "\\bAKIA[0-9A-Z]{16}\\b",
    "\\bAIza[0-9A-Za-z_-]{35}\\b",
    "\\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}\\b",
    "\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b",
    `-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?${"PRIVATE"} KEY-----`,
    "\\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password)[\"']?\\s*[:=]\\s*[\"'][A-Za-z0-9+/=_-]{20,}[\"']",
  ].join("|"),
  "gi",
);
/** A secret-shaped assignment whose value is an obvious placeholder. */
const SECRET_PLACEHOLDER = /changeme|example|placeholder|your[_-]?|xxxx|dummy|fake|redacted/i;
const BOHEMIA_COPYRIGHT = new RegExp(`copy${"right"}[^\\n]{0,40}bohemia interactive`, "gi");

/** Globs (export-public syntax) the public tree should not carry. */
export const DISALLOWED_PATHS: readonly { glob: string; why: string }[] = [
  { glob: "docs/v2/**", why: "2.0 programme internals" },
  { glob: "data/census/evidence/**", why: "census evidence (local paths, session records)" },
  { glob: "**/_scratch/**", why: "scratch folder" },
  { glob: "**/.claude/**", why: "local agent configuration" },
  { glob: "**/CLAUDE.local.md", why: "private local instructions" },
  { glob: "**/.env", why: "environment file" },
  { glob: "**/.env.*", why: "environment file" },
  { glob: "**/*.pem", why: "key file" },
  { glob: "**/*.key", why: "key file" },
  { glob: "**/*.pfx", why: "key file" },
  { glob: "**/*.log", why: "log file" },
  { glob: "**/node_modules/**", why: "installed dependencies" },
  { glob: "dist/**", why: "build output" },
];

/** Enfusion resource extensions (text and binary). */
const ENFUSION_EXT =
  /\.(?:et|ent|conf|layout|bt|pap|siga|ast|asi|agf|agr|aw|acp|sig|afm|emat|gamemat|physmat|imageset|styles|st|meta|gproj|xob|edds|anm|txa|ptc|nmn|c)$/i;

/** Where authored Enfusion files are expected. */
export const DEFAULT_AUTHORED_ROOTS: readonly string[] = [
  "mod/",
  "mod-dev/",
  "tests/fixtures/",
  "src/templates/",
  "data/recipes/",
  "data/patterns/",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converts an export-public glob to a RegExp (`**` spans segments). */
function globRe(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const DISALLOWED_RES = DISALLOWED_PATHS.map((d) => ({ re: globRe(d.glob), why: d.why }));

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function position(starts: number[], index: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - starts[lo] + 1 };
}

function cut(s: string): string {
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlaceholderUser(name: string): boolean {
  const n = name.toLowerCase();
  return PLACEHOLDER_START.test(name) || PLACEHOLDER_USERS.has(n) || /^x+$/.test(n);
}

function sniff(path: string): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

/** Scans one file's text. `file` is the reported path. */
export function scanText(file: string, text: string, names: readonly string[] = []): Finding[] {
  const out: Finding[] = [];
  let starts: number[] | undefined;
  const at = (rule: Rule, index: number, match: string): void => {
    starts ??= lineStarts(text);
    const p = position(starts, index);
    out.push({ rule, file, line: p.line, column: p.column, excerpt: cut(match) });
  };
  const each = (re: RegExp, fn: (m: RegExpExecArray) => void): void => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      fn(m);
      if (m[0] === "") re.lastIndex++;
    }
  };

  each(HOME_WIN, (m) => {
    if (!isPlaceholderUser(m[1])) at("user-path", m.index, m[0]);
  });
  each(HOME_NIX, (m) => {
    if (!isPlaceholderUser(m[1])) at("user-path", m.index, m[0]);
  });
  each(EMAIL, (m) => {
    if (!EMAIL_PLACEHOLDER.test(m[0])) at("email", m.index, m[0]);
  });
  each(STEAM64, (m) => at("steam-id", m.index, m[0]));
  each(REGISTRY, (m) => at("registry", m.index, m[0]));
  each(EXE_STRINGS, (m) => at("exe-strings", m.index, m[0]));
  each(SECRET, (m) => {
    if (!SECRET_PLACEHOLDER.test(m[0])) at("secret", m.index, m[0]);
  });
  each(BOHEMIA_COPYRIGHT, (m) => at("vanilla-asset", m.index, m[0]));
  for (const name of names) {
    if (name.trim().length < 3) continue;
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(name.trim())}(?![A-Za-z0-9])`, "gi");
    each(re, (m) => at("owner-identity", m.index, m[0]));
  }
  return out;
}

/** Path-only rules for one relative path. */
export function scanPath(file: string, authoredRoots: readonly string[]): Finding[] {
  const out: Finding[] = [];
  for (const d of DISALLOWED_RES) {
    if (d.re.test(file)) {
      out.push({ rule: "disallowed-path", file, line: 0, column: 0, excerpt: d.why });
      break;
    }
  }
  if (ENFUSION_EXT.test(file) && !authoredRoots.some((r) => file.startsWith(r))) {
    out.push({
      rule: "vanilla-asset",
      file,
      line: 0,
      column: 0,
      excerpt: "Enfusion resource file outside the authored roots",
    });
  }
  return out;
}

function walk(root: string, dir: string, acc: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === ".git") continue;
      walk(root, p, acc);
    } else if (ent.isFile()) acc.push(p);
  }
}

/** Scans every file under `root`. */
export function scanTree(root: string, options: ScanOptions = {}): ScanResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const roots = options.authoredRoots ?? DEFAULT_AUTHORED_ROOTS;
  const names = options.names ?? [];
  const files: string[] = [];
  walk(root, root, files);
  files.sort();
  const findings: Finding[] = [];
  let bytes = 0;
  for (const abs of files) {
    const file = relative(root, abs).split(sep).join("/");
    const size = statSync(abs).size;
    bytes += size;
    findings.push(...scanPath(file, roots));
    if (size > maxBytes) {
      findings.push({ rule: "large-file", file, line: 0, column: 0, excerpt: `${size} bytes` });
    } else if (size >= maxBytes * 0.9) {
      findings.push({ rule: "near-limit", file, line: 0, column: 0, excerpt: `${size} bytes` });
    }
    const head = sniff(abs);
    const isPe = head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a;
    const isElf = head.length >= 4 && head.readUInt32BE(0) === 0x7f454c46;
    if (isPe || isElf) {
      findings.push({
        rule: "executable",
        file,
        line: 0,
        column: 0,
        excerpt: isPe ? "PE header" : "ELF header",
      });
      continue;
    }
    if (head.includes(0)) continue; // other binary: no text rules
    findings.push(...scanText(file, readFileSync(abs, "utf-8"), names));
  }
  return { files: files.length, bytes, findings };
}

// ── Building the would-be export ─────────────────────────────────────────────

/** The real path of `p`, resolving the nearest existing ancestor (8.3 names, links). */
function realPath(p: string): string {
  const abs = resolve(p);
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

/**
 * Writes the allow-listed tree of `rev` under `out` with each blob's exact bytes, after the
 * allow-list's export transforms (the same `applyTransforms` as `export-public.ts`). Returns the
 * entries written; `onTransform` hears each file a transform rewrote. Refuses an `out` inside
 * the repository or one that is not empty.
 */
export async function materializeExport(
  repo: string,
  rev: string,
  out: string,
  allowPath: string = DEFAULT_EXPORT_ALLOW_PATH,
  onTransform?: (record: TransformRecord) => void,
): Promise<TreeEntry[]> {
  const repoTop = realPath(
    execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf-8" }).trim(),
  );
  const target = resolve(out);
  const rel = relative(repoTop, realPath(target));
  if (rel === "" || (!rel.startsWith("..") && !/^[A-Za-z]:/.test(rel))) {
    throw new Error(`--out must lie outside the repository: ${target}`);
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`--out must be a new or empty folder: ${target}`);
  }
  mkdirSync(target, { recursive: true });
  const allow = loadExportAllow(allowPath);
  const { included } = filterEntries(readTree(repo, rev), allow);
  const blobs = included.filter((e) => e.mode !== "120000");

  // One `git cat-file --batch` process streams every blob.
  await new Promise<void>((done, fail) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd: repo });
    let buf = Buffer.alloc(0);
    let i = 0;
    let stopped = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stopped) return;
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const nl = buf.indexOf(10);
        if (nl < 0) return;
        const header = buf.subarray(0, nl).toString("utf-8");
        const size = Number(header.split(" ")[2]);
        if (!Number.isFinite(size)) {
          fail(new Error(`git cat-file: ${header}`));
          return;
        }
        if (buf.length < nl + 1 + size + 1) return;
        const raw = buf.subarray(nl + 1, nl + 1 + size);
        let body: Buffer;
        try {
          const t = applyTransforms(blobs[i].path, raw, allow);
          body = t.body;
          for (const r of t.records) onTransform?.(r);
        } catch (e) {
          stopped = true;
          child.kill();
          fail(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        const dest = join(target, ...blobs[i].path.split("/"));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, body);
        buf = buf.subarray(nl + 1 + size + 1);
        i++;
      }
    });
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0 && i === blobs.length
        ? done()
        : fail(new Error(`git cat-file ended with code ${code} after ${i} of ${blobs.length}`)),
    );
    child.stdin.end(blobs.map((e) => e.oid).join("\n") + (blobs.length ? "\n" : ""));
  });
  return included;
}

// ── Names ────────────────────────────────────────────────────────────────────

/** Reads owner identity strings from a file, the environment and (optionally) the machine. */
export function collectNames(opts: { namesFile?: string; auto: boolean; repo?: string }): string[] {
  const names = new Set<string>();
  if (opts.namesFile) {
    for (const raw of readFileSync(opts.namesFile, "utf-8").split(/\r?\n/)) {
      const s = raw.trim();
      if (s && !s.startsWith("#")) names.add(s);
    }
  }
  for (const s of (process.env.EXPORT_SCAN_NAMES ?? "").split(","))
    if (s.trim()) names.add(s.trim());
  if (opts.auto) {
    try {
      const u = userInfo().username;
      if (u) names.add(u);
    } catch {
      /* no account name */
    }
    try {
      const email = execFileSync("git", ["config", "user.email"], {
        cwd: opts.repo ?? process.cwd(),
        encoding: "utf-8",
      }).trim();
      if (email) names.add(email);
    } catch {
      /* no git e-mail */
    }
  }
  return [...names];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

interface CliOptions {
  dir?: string;
  repo?: string;
  rev?: string;
  out?: string;
  allow?: string;
  names?: string;
  auto: boolean;
  maxMb: number;
  json: boolean;
}

export function parseScanArgs(argv: string[]): CliOptions {
  const o: CliOptions = { auto: true, maxMb: 50, json: false };
  const val = (i: number, flag: string): string => {
    const v = argv[i];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") o.dir = val(++i, a);
    else if (a === "--repo") o.repo = val(++i, a);
    else if (a === "--rev") o.rev = val(++i, a);
    else if (a === "--out") o.out = val(++i, a);
    else if (a === "--allow") o.allow = resolve(val(++i, a));
    else if (a === "--names") o.names = resolve(val(++i, a));
    else if (a === "--no-auto-names") o.auto = false;
    else if (a === "--max-mb") o.maxMb = Number(val(++i, a));
    else if (a === "--json") o.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(o.maxMb) || o.maxMb <= 0)
    throw new Error("--max-mb must be a positive number");
  const fromRepo = o.repo !== undefined || o.rev !== undefined || o.out !== undefined;
  if (o.dir && fromRepo) throw new Error("use --dir, or --repo with --rev and --out, not both");
  if (!o.dir && !(o.repo && o.rev && o.out)) {
    throw new Error("--dir <tree>, or --repo <path> --rev <rev> --out <new folder>, is required");
  }
  return o;
}

export async function main(argv: string[]): Promise<number> {
  let o: CliOptions;
  try {
    o = parseScanArgs(argv);
  } catch (e) {
    console.error(`export-scan: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  let root = o.dir ? resolve(o.dir) : "";
  try {
    if (!o.dir) {
      const written = await materializeExport(o.repo!, o.rev!, o.out!, o.allow, (t) =>
        console.error(`export-scan: ${t.transform} rewrote ${t.changed} lines of ${t.path}`),
      );
      root = resolve(o.out!);
      console.error(`export-scan: wrote ${written.length} files of ${o.rev} to ${root}`);
    }
  } catch (e) {
    console.error(`export-scan: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const names = collectNames({ namesFile: o.names, auto: o.auto, repo: o.repo });
  const result = scanTree(root, { names, maxBytes: o.maxMb * 1024 * 1024 });
  if (o.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const byRule = new Map<string, number>();
    for (const f of result.findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    for (const f of result.findings) {
      console.log(`${f.rule}\t${f.file}:${f.line}:${f.column}\t${f.excerpt}`);
    }
    console.log(
      `export-scan: ${result.files} files, ${result.bytes} bytes, ${result.findings.length} findings` +
        (byRule.size ? ` (${[...byRule].map(([r, n]) => `${r} ${n}`).join(", ")})` : ""),
    );
  }
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
