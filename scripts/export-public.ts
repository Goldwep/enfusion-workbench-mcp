/**
 * Scripted public export (2.0 plan, section 5.2).
 *
 *   npx tsx scripts/export-public.ts --repo <path> --tag <gate tag>
 *       [--target public-release] [--dry-run] [--i-know-this-writes-the-public-branch]
 *       [--allow <export-allow.json>]
 *
 * Copies the allow-listed tracked tree at <tag> onto <target> as ONE additive commit:
 *
 *   1. Reads the tree at the tag (`git ls-tree -r <tag>`; blobs via `git cat-file`).
 *   2. Filters it through `scripts/export-allow.json`: include globs, then exclude
 *      globs, then any file carrying a tag listed in `excludeTags` (by default the
 *      `executable-derived` label tables, decision D2).
 *   2a. Rewrites the kept files named under `transforms` (by default `redact-e05` on
 *      `data/census/ledger*.jsonl`: E05 quotes and `exe:0x` refs replaced by a length and a
 *      hash, decision D2). A rewritten file becomes a new blob; the source tree is unchanged.
 *   3. Builds the tree in the index of a temporary worktree of <repo>, commits it
 *      with the current <target> tip as the only parent (or as a root commit when
 *      <target> does not exist yet), and moves <target> with a compare-and-swap
 *      `git update-ref`. It never forces, never rewrites, never deletes history and
 *      never pushes. Hooks do not run on this commit. (The PII scan that used to run
 *      before this step was removed by DEC-060.)
 *
 * `--dry-run` prints the included and excluded lists and the would-be diff stat
 * and writes nothing to any branch. Without `--dry-run` the flag
 * `--i-know-this-writes-the-public-branch` is required; the refusal names the
 * origin remote when it points at github.com.
 *
 * Exit codes: 0 done (or nothing to export), 2 usage, configuration or git error.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── Constants ────────────────────────────────────────────────────────────────

/** Default export filter (tracked, next to this script). */
export const DEFAULT_EXPORT_ALLOW_PATH = join(import.meta.dirname ?? ".", "export-allow.json");

/** Default branch the export writes. */
export const DEFAULT_TARGET = "public-release";

/** The flag a real (non-dry-run) export needs. */
export const WRITE_FLAG = "--i-know-this-writes-the-public-branch";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExportAllow {
  /** Include globs; a path must match at least one. */
  include: string[];
  /** Exclude globs; a path matching any is dropped. */
  exclude: string[];
  /** Tag name to globs of the files carrying that tag. */
  tags: Record<string, string[]>;
  /** Tags whose files are dropped (default: executable-derived, decision D2). */
  excludeTags: string[];
  /**
   * Transform name to the globs of the exported files it rewrites (default:
   * `redact-e05` on the census ledger shards, decision D2). Absent means the default.
   */
  transforms?: Record<string, string[]>;
}

/** What one transform did to one exported file. */
export interface TransformRecord {
  /** Repo-relative path. */
  path: string;
  /** Transform name. */
  transform: string;
  /** Lines (or units) the transform rewrote. */
  changed: number;
}

export interface TreeEntry {
  /** Git file mode, e.g. 100644, 100755, 120000. */
  mode: string;
  /** Object type: blob or commit (submodule). */
  type: string;
  /** Object id. */
  oid: string;
  /** Repo-relative path. */
  path: string;
}

export interface ExcludedEntry {
  /** Repo-relative path. */
  path: string;
  /** Why it is not exported. */
  reason: string;
}

export interface ExportOptions {
  /** Repository to read the tag from and write the target branch in. */
  repo: string;
  /** Gate tag to export. */
  tag: string;
  /** Target branch name (default public-release). */
  target?: string;
  /** Print only; write nothing. */
  dryRun?: boolean;
  /** The explicit write acknowledgement. */
  writeFlag?: boolean;
  /** Export filter file (default scripts/export-allow.json). */
  allowPath?: string;
  /** Output sink (default console.log). */
  print?: (line: string) => void;
}

export interface ExportResult {
  /** 0 done, 2 usage/configuration/git error. */
  code: number;
  /** Exported paths. */
  included: string[];
  /** Dropped paths and reasons. */
  excluded: ExcludedEntry[];
  /** Exported files whose bytes a transform rewrote. */
  transformed: TransformRecord[];
  /** The new commit, when one was written. */
  commit?: string;
  /** Why the run stopped, when it did not write. */
  message?: string;
}

// ── Globs and filtering ──────────────────────────────────────────────────────

/** Converts a glob to an anchored RegExp: `**` spans segments, `*` and `?` do not. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/** True when the path matches any of the globs. */
export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** Loads and validates the export filter. */
export function loadExportAllow(file: string): ExportAllow {
  let parsed: Partial<ExportAllow>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<ExportAllow>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`cannot read export allow-list ${file}: ${msg}`);
  }
  const strings = (v: unknown, key: string): string[] => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new Error(`export allow-list ${file}: "${key}" must be an array of strings`);
    }
    return v as string[];
  };
  const include = strings(parsed.include, "include");
  const exclude = strings(parsed.exclude ?? [], "exclude");
  const excludeTags = strings(parsed.excludeTags ?? ["executable-derived"], "excludeTags");
  const tags: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(parsed.tags ?? {})) tags[k] = strings(v, `tags.${k}`);
  const transforms: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(parsed.transforms ?? DEFAULT_TRANSFORMS)) {
    if (!Object.hasOwn(TRANSFORMS, k)) {
      throw new Error(
        `export allow-list ${file}: unknown transform "${k}" (known: ${Object.keys(TRANSFORMS).join(", ")})`,
      );
    }
    transforms[k] = strings(v, `transforms.${k}`);
  }
  return { include, exclude, tags, excludeTags, transforms };
}

// ── Export transforms ────────────────────────────────────────────────────────

/** A transform rewrites one exported file's text; `changed` counts the units it rewrote. */
export type Transform = (text: string) => { text: string; changed: number };

/** Prefix of a withheld E05 quote; a quote that already starts with it is left alone. */
export const WITHHELD_QUOTE_PREFIX = "withheld (D2): ";

/** Prefix of a withheld executable offset ref. */
export const WITHHELD_REF_PREFIX = "exe:withheld-";

const EXE_OFFSET = /exe:0x[0-9A-Fa-f]+/g;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

/** The stand-in for an E05 quote: its length in code points and the first 16 hex of its sha256. */
export function withheldQuote(quote: string): string {
  if (quote.startsWith(WITHHELD_QUOTE_PREFIX)) return quote;
  return `${WITHHELD_QUOTE_PREFIX}${[...quote].length} chars, sha256 ${sha256Hex(quote).slice(0, 16)}`;
}

/** The stand-in for an `exe:0x<offset>` ref: the same ref always maps to the same stand-in. */
export function withheldRef(ref: string): string {
  if (!ref.startsWith("exe:") || ref.startsWith(WITHHELD_REF_PREFIX)) return ref;
  return `${WITHHELD_REF_PREFIX}${sha256Hex(ref).slice(0, 16)}`;
}

interface LedgerLineShape {
  sources?: { enumerator?: unknown; quote?: unknown; ref?: unknown }[];
  tier_evidence?: { ref?: unknown }[];
  unverified?: { claim?: unknown }[];
}

/**
 * Decision D2 for the census ledger: rewrites every JSONL row that carries an E05 source.
 * Each E05 source keeps its enumerator, build and confidence; its `quote` becomes
 * {@link withheldQuote} and its `exe:0x` ref {@link withheldRef}. The same refs in
 * `tier_evidence` and the `exe:0x` offsets inside `unverified` claims get the same stand-ins,
 * so a row's evidence still pairs with its sources. Row ids, labels, tiers, paths and all other
 * sources stay as they are, and a line without an E05 source or an `exe:` ref is not touched
 * (byte for byte). Deterministic and idempotent. A line it must inspect that is not JSON throws:
 * the export fails closed rather than ship it.
 */
export const redactE05Ledger: Transform = (text) => {
  let changed = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cr = line.endsWith("\r") ? "\r" : "";
    const body = cr ? line.slice(0, -1) : line;
    if (!body.includes('"E05"') && !body.includes('"exe:') && !body.includes("exe:0x")) continue;
    let row: LedgerLineShape;
    try {
      row = JSON.parse(body) as LedgerLineShape;
    } catch {
      throw new Error(`redact-e05: line ${i + 1} is not JSON`);
    }
    if (row === null || typeof row !== "object") continue;
    for (const s of Array.isArray(row.sources) ? row.sources : []) {
      if (s?.enumerator !== "E05") continue;
      if (typeof s.quote === "string") s.quote = withheldQuote(s.quote);
      if (typeof s.ref === "string") s.ref = withheldRef(s.ref);
    }
    for (const e of Array.isArray(row.tier_evidence) ? row.tier_evidence : []) {
      if (typeof e?.ref === "string") e.ref = withheldRef(e.ref);
    }
    for (const u of Array.isArray(row.unverified) ? row.unverified : []) {
      if (typeof u?.claim === "string") u.claim = u.claim.replace(EXE_OFFSET, withheldRef);
    }
    const out = JSON.stringify(row);
    if (out !== body) {
      lines[i] = out + cr;
      changed++;
    }
  }
  return { text: changed ? lines.join("\n") : text, changed };
};

/** Every known transform by name. */
export const TRANSFORMS: Readonly<Record<string, Transform>> = {
  "redact-e05": redactE05Ledger,
};

/** Applied when the allow-list names no transforms (decision D2). */
export const DEFAULT_TRANSFORMS: Readonly<Record<string, string[]>> = {
  "redact-e05": ["data/census/ledger*.jsonl"],
};

/** The transforms that apply to a path, in allow-list order. */
export function transformsFor(path: string, allow: ExportAllow): string[] {
  return Object.entries(allow.transforms ?? DEFAULT_TRANSFORMS)
    .filter(([, globs]) => matchesAny(path, globs))
    .map(([name]) => name);
}

/**
 * Applies the path's transforms to a blob's bytes. Returns the same Buffer when none applies
 * or none changed anything, so untouched files keep their exact bytes.
 */
export function applyTransforms(
  path: string,
  body: Buffer,
  allow: ExportAllow,
): { body: Buffer; records: TransformRecord[] } {
  const names = transformsFor(path, allow);
  if (names.length === 0) return { body, records: [] };
  let text = body.toString("utf-8");
  const records: TransformRecord[] = [];
  for (const name of names) {
    const r = TRANSFORMS[name](text);
    if (r.changed > 0) records.push({ path, transform: name, changed: r.changed });
    text = r.text;
  }
  return records.length ? { body: Buffer.from(text, "utf-8"), records } : { body, records };
}

/** Splits tree entries into exported and dropped, in tree order. */
export function filterEntries(
  entries: readonly TreeEntry[],
  allow: ExportAllow,
): { included: TreeEntry[]; excluded: ExcludedEntry[] } {
  const included: TreeEntry[] = [];
  const excluded: ExcludedEntry[] = [];
  for (const e of entries) {
    if (e.type !== "blob") {
      excluded.push({ path: e.path, reason: `not a file (${e.type})` });
    } else if (!matchesAny(e.path, allow.include)) {
      excluded.push({ path: e.path, reason: "matches no include glob" });
    } else if (matchesAny(e.path, allow.exclude)) {
      excluded.push({ path: e.path, reason: "matches an exclude glob" });
    } else {
      const tag = allow.excludeTags.find((t) => matchesAny(e.path, allow.tags[t] ?? []));
      if (tag) excluded.push({ path: e.path, reason: `tagged ${tag}` });
      else included.push(e);
    }
  }
  return { included, excluded };
}

// ── Git helpers ──────────────────────────────────────────────────────────────

function git(
  cwd: string,
  args: string[],
  options: { input?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    input: options.input,
    env: options.env,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function gitOk(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function revParse(cwd: string, ref: string): string | undefined {
  try {
    return git(cwd, ["rev-parse", "--verify", "--quiet", ref]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Reads every entry of the tree at a commit-ish. */
export function readTree(repo: string, rev: string): TreeEntry[] {
  const out = git(repo, ["ls-tree", "-r", "-z", "--full-tree", rev]);
  const entries: TreeEntry[] = [];
  for (const rec of out.split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    const [mode, type, oid] = rec.slice(0, tab).split(" ");
    entries.push({ mode, type, oid, path: rec.slice(tab + 1) });
  }
  return entries;
}

/**
 * Runs the allow-list's transforms over the entries they name. A rewritten file is stored as a
 * new blob in `repo`'s object database (`git hash-object -w --no-filters`: exact bytes, no line
 * ending conversion; an unreferenced loose object, no ref moves) and its entry gets that oid.
 */
export function transformEntries(
  repo: string,
  entries: readonly TreeEntry[],
  allow: ExportAllow,
): { entries: TreeEntry[]; records: TransformRecord[] } {
  const records: TransformRecord[] = [];
  const out = entries.map((e) => {
    if (e.type !== "blob" || e.mode === "120000" || transformsFor(e.path, allow).length === 0) {
      return e;
    }
    const body = execFileSync("git", ["cat-file", "blob", e.oid], {
      cwd: repo,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const r = applyTransforms(e.path, body, allow);
    if (r.records.length === 0) return e;
    records.push(...r.records);
    const oid = execFileSync("git", ["hash-object", "-w", "--no-filters", "--stdin"], {
      cwd: repo,
      input: r.body,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { ...e, oid };
  });
  return { entries: out, records };
}

/** Builds a tree object from entries using the index of `cwd` (or GIT_INDEX_FILE in env). */
function writeTree(cwd: string, entries: readonly TreeEntry[], env?: NodeJS.ProcessEnv): string {
  git(cwd, ["read-tree", "--empty"], { env });
  const input = entries.map((e) => `${e.mode} ${e.oid}\t${e.path}\0`).join("");
  if (input !== "") git(cwd, ["update-index", "-z", "--index-info"], { input, env });
  return git(cwd, ["write-tree"], { env }).trim();
}

/**
 * Finds the parent for the export commit: the local target branch, else the
 * remote-tracking one, else none (orphan). `localOld` is the local branch tip the
 * compare-and-swap update expects ("" means the local branch must not exist yet).
 */
function resolveBase(
  repo: string,
  target: string,
): { base?: string; localOld: string; note: string } {
  const local = revParse(repo, `refs/heads/${target}^{commit}`);
  const remote = revParse(repo, `refs/remotes/origin/${target}^{commit}`);
  if (local && remote && local !== remote) {
    if (!gitOk(repo, ["merge-base", "--is-ancestor", remote, local])) {
      throw new Error(
        `local ${target} does not contain origin/${target}; fast-forward it first ` +
          "(the export never rewrites the public branch).",
      );
    }
  }
  if (local) {
    return {
      base: local,
      localOld: local,
      note: `extends local ${target} at ${local.slice(0, 12)}`,
    };
  }
  if (remote) {
    return {
      base: remote,
      localOld: "",
      note: `creates ${target} from origin/${target} at ${remote.slice(0, 12)}`,
    };
  }
  return { localOld: "", note: `creates ${target} as a new root (orphan) commit` };
}

// ── Export ───────────────────────────────────────────────────────────────────

/** Runs the export. Never throws for expected failures; the code says what happened. */
export function runExport(options: ExportOptions): ExportResult {
  const print = options.print ?? ((l: string) => console.log(l));
  const target = options.target ?? DEFAULT_TARGET;
  const result: ExportResult = { code: 2, included: [], excluded: [], transformed: [] };
  const fail = (code: number, message: string): ExportResult => {
    result.code = code;
    result.message = message;
    print(`export-public: ${message}`);
    return result;
  };

  const repo = resolve(options.repo);
  if (!existsSync(repo)) return fail(2, `repository not found: ${options.repo}`);
  if (!gitOk(repo, ["rev-parse", "--git-dir"])) return fail(2, `not a git repository: ${repo}`);
  if (!gitOk(repo, ["check-ref-format", "--branch", target])) {
    return fail(2, `invalid target branch name: ${target}`);
  }

  if (!options.dryRun && !options.writeFlag) {
    let origin = "";
    try {
      origin = git(repo, ["remote", "get-url", "origin"]).trim();
    } catch {
      /* no origin */
    }
    const where = origin.includes("github.com")
      ? "this repository's origin points at github.com; "
      : "";
    return fail(
      2,
      `refusing to write ${target}: ${where}a real export needs ${WRITE_FLAG} ` +
        "(or use --dry-run).",
    );
  }

  // Moving a branch that some worktree has checked out would leave that worktree's
  // index and files describing the old tip; refuse instead.
  const checkedOut = git(repo, ["worktree", "list", "--porcelain"])
    .split("\n")
    .some((l) => l === `branch refs/heads/${target}`);
  if (checkedOut && !options.dryRun) {
    return fail(2, `${target} is checked out in a worktree; switch that worktree away first.`);
  }

  const tagRef = `refs/tags/${options.tag}`;
  const tagCommit = revParse(repo, `${tagRef}^{commit}`);
  if (!tagCommit) return fail(2, `tag not found: ${options.tag}`);

  let allow: ExportAllow;
  try {
    allow = loadExportAllow(options.allowPath ?? DEFAULT_EXPORT_ALLOW_PATH);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(2, `configuration error: ${msg}`);
  }

  const filtered = filterEntries(readTree(repo, tagCommit), allow);
  const excluded = filtered.excluded;
  let included: TreeEntry[];
  try {
    const t = transformEntries(repo, filtered.included, allow);
    included = t.entries;
    result.transformed = t.records;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(2, `transform error: ${msg}`);
  }
  result.included = included.map((e) => e.path);
  result.excluded = excluded;

  print(`export-public: tag ${options.tag} (${tagCommit.slice(0, 12)}) -> ${target}`);
  print(`Included (${included.length}):`);
  for (const p of result.included) print(`  + ${p}`);
  print(`Excluded (${excluded.length}):`);
  for (const x of excluded) print(`  - ${x.path}  [${x.reason}]`);
  print(`Transformed (${result.transformed.length}):`);
  for (const t of result.transformed)
    print(`  ~ ${t.path}  [${t.transform}: ${t.changed} changed]`);
  let base: string | undefined;
  let localOld: string;
  let note: string;
  try {
    ({ base, localOld, note } = resolveBase(repo, target));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(2, msg);
  }
  print(`Target: ${note}.`);

  if (options.dryRun) {
    const scratch = mkdtempSync(join(tmpdir(), "emcp-export-index-"));
    try {
      const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
      const tree = writeTree(repo, included, env);
      const from = base ? `${base}^{tree}` : git(repo, ["mktree"], { input: "" }).trim();
      const stat = git(repo, ["diff-tree", "-r", "--stat", from, tree]).trimEnd();
      print("Would-be diff stat:");
      print(stat === "" ? "  (no changes)" : stat);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    result.code = 0;
    result.message = "dry run: nothing written";
    print("export-public: dry run, nothing written.");
    return result;
  }

  // Real export: build the tree in a temporary worktree's own index.
  const holder = mkdtempSync(join(tmpdir(), "emcp-export-wt-"));
  const wt = join(holder, "wt");
  let added = false;
  try {
    git(repo, ["worktree", "add", "--detach", "--no-checkout", wt, base ?? tagCommit]);
    added = true;
    const tree = writeTree(wt, included);
    if (base && git(wt, ["rev-parse", `${base}^{tree}`]).trim() === tree) {
      result.code = 0;
      result.message = `nothing to export: ${target} already holds this tree`;
      print(`export-public: ${result.message}.`);
      return result;
    }
    const args = ["commit-tree", tree, "-m", `Export ${options.tag} to ${target}`];
    if (base) args.splice(2, 0, "-p", base);
    const commit = git(wt, args).trim();
    git(repo, [
      "update-ref",
      "-m",
      `export-public: ${options.tag}`,
      `refs/heads/${target}`,
      commit,
      localOld,
    ]);
    result.commit = commit;
    result.code = 0;
    print(`export-public: wrote ${commit.slice(0, 12)} on ${target}. Nothing was pushed.`);
    print(`Review with \`git log --stat -1 ${target}\` before any push.`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(2, `git error: ${msg}`);
  } finally {
    if (added) {
      try {
        git(repo, ["worktree", "remove", "--force", wt]);
      } catch {
        /* ignore; pruned below */
      }
    }
    rmSync(holder, { recursive: true, force: true });
    try {
      git(repo, ["worktree", "prune"]);
    } catch {
      /* ignore */
    }
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Parses CLI arguments into export options. Throws on bad usage. */
export function parseExportArgs(argv: string[]): ExportOptions {
  const opts: Partial<ExportOptions> = {};
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") opts.repo = value(++i, a);
    else if (a === "--tag") opts.tag = value(++i, a);
    else if (a === "--target") opts.target = value(++i, a);
    else if (a === "--allow") opts.allowPath = resolve(value(++i, a));
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === WRITE_FLAG) opts.writeFlag = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.repo) throw new Error("--repo <path> is required");
  if (!opts.tag) throw new Error("--tag <gate tag> is required");
  return opts as ExportOptions;
}

/** Runs the CLI and returns the exit code. */
export function main(argv: string[]): number {
  let opts: ExportOptions;
  try {
    opts = parseExportArgs(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`export-public: ${msg}`);
    console.error(
      "usage: npx tsx scripts/export-public.ts --repo <path> --tag <gate tag> " +
        `[--target public-release] [--dry-run] [${WRITE_FLAG}] [--allow <file>]`,
    );
    return 2;
  }
  return runExport(opts).code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
