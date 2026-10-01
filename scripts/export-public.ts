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
 *   3. Runs the PII gate (`scripts/pii-gate.ts`) over every exported text file,
 *      with the PII allow-list, honouring `CI`. Any finding aborts the export.
 *   4. Builds the tree in the index of a temporary worktree of <repo>, commits it
 *      with the current <target> tip as the only parent (or as a root commit when
 *      <target> does not exist yet), and moves <target> with a compare-and-swap
 *      `git update-ref`. It never forces, never rewrites, never deletes history and
 *      never pushes. Hooks do not run on this commit; the gate already ran.
 *
 * `--dry-run` prints the included and excluded lists and the would-be diff stat
 * and writes nothing to any branch. Without `--dry-run` the flag
 * `--i-know-this-writes-the-public-branch` is required; the refusal names the
 * origin remote when it points at github.com.
 *
 * Exit codes: 0 done (or nothing to export), 1 PII findings, 2 usage, configuration
 * or git error.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ALLOW_PATH as DEFAULT_PII_ALLOW_PATH,
  formatFinding,
  isBinary,
  loadAllowList,
  loadPatterns,
  scanText,
  applyAllowList,
  type AllowEntry,
  type LoadedPatterns,
  type PiiFinding,
} from "./pii-gate.js";

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
  /** PII allow-list file (default scripts/pii-allow.json). */
  piiAllowPath?: string;
  /** Environment for the PII gate (CI, ENFUSION_PII_PATTERNS, ...). */
  env?: NodeJS.ProcessEnv;
  /** Output sink (default console.log). */
  print?: (line: string) => void;
}

export interface ExportResult {
  /** 0 done, 1 PII findings, 2 usage/configuration/git error. */
  code: number;
  /** Exported paths. */
  included: string[];
  /** Dropped paths and reasons. */
  excluded: ExcludedEntry[];
  /** PII findings (masked when printed). */
  findings: Array<{ path: string; finding: PiiFinding }>;
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
  return { include, exclude, tags, excludeTags };
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

function readBlob(repo: string, oid: string): Buffer {
  return execFileSync("git", ["cat-file", "blob", oid], {
    cwd: repo,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  const result: ExportResult = { code: 2, included: [], excluded: [], findings: [] };
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
  let piiAllow: AllowEntry[];
  let patterns: LoadedPatterns;
  try {
    allow = loadExportAllow(options.allowPath ?? DEFAULT_EXPORT_ALLOW_PATH);
    piiAllow = loadAllowList(options.piiAllowPath ?? DEFAULT_PII_ALLOW_PATH);
    patterns = loadPatterns({ env: options.env ?? process.env });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(2, `configuration error: ${msg}`);
  }
  if (patterns.notice) print(`export-public: ${patterns.notice}`);

  const { included, excluded } = filterEntries(readTree(repo, tagCommit), allow);
  result.included = included.map((e) => e.path);
  result.excluded = excluded;

  // PII gate over the exported set. Every text file is scanned, whatever its size.
  let binaries = 0;
  for (const e of included) {
    const buf = readBlob(repo, e.oid);
    if (isBinary(buf)) {
      binaries++;
      continue;
    }
    const raw = scanText(buf.toString("utf-8"), patterns.patterns);
    const { kept } = applyAllowList(e.path, raw, piiAllow, "scripts/pii-allow.json");
    for (const f of kept) result.findings.push({ path: e.path, finding: f });
  }

  print(`export-public: tag ${options.tag} (${tagCommit.slice(0, 12)}) -> ${target}`);
  print(`Included (${included.length}):`);
  for (const p of result.included) print(`  + ${p}`);
  print(`Excluded (${excluded.length}):`);
  for (const x of excluded) print(`  - ${x.path}  [${x.reason}]`);
  print(
    `PII gate: ${included.length - binaries} text file${included.length - binaries !== 1 ? "s" : ""} ` +
      `scanned, ${binaries} binary skipped, ${patterns.ownerCount} owner pattern` +
      `${patterns.ownerCount !== 1 ? "s" : ""}.`,
  );

  if (result.findings.length > 0) {
    for (const { path, finding } of result.findings) print(formatFinding(path, finding));
    return fail(1, `aborted: ${result.findings.length} PII finding(s) in the exported tree.`);
  }

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
