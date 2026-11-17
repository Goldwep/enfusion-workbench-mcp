/**
 * Offline Enforce linter (plan 5.4 step 1): checks Workbench-side handler
 * sources against the E02 source index before they are installed. See
 * `src/census/enforce-lint.ts` for what is checked and the two levels.
 *
 *   npx tsx scripts/enforce-lint.ts [<file.c|dir> ...] [--json] [--build <tag>]
 *       [--artifacts <dir>] [--index <file>] [--game <dir>] [--contracts <dir>]
 *       [--keys] [--trace]
 *
 * Files: the `.c` files given (a directory adds every `.c` under it); default
 *   every `.c` file under mod/Scripts/WorkbenchGame/EnfusionMCP.
 * --build      build of the source index (default data/census/current-build.json)
 * --artifacts  artifacts folder holding census/<build>/E02/source-index.jsonl
 * --index      an explicit source-index file (instead of --build/--artifacts)
 * --game       game install the index is built from when it is missing
 *              (default: the configured game path)
 * --contracts  directory of <Handler>.json contracts in either form: the flat
 *              prototype form ({ "request": [keys], "response": [keys] },
 *              mod-dev/contracts) or the per-action form (contracts/*.json,
 *              src/manifest/contract.ts). The flat keys are compared for both;
 *              a per-action contract also checks each `req.action == "x"`
 *              branch (keys read within the action's allowed keys, every
 *              required key read, response fields written declared). Without
 *              it the key check is skipped with a note; a path that is not a
 *              directory is a usage error
 *
 * Deny keys (design section 6): FileIO.FindFiles, Workbench.Dialog,
 *   RunCommandline, a Configure( call, a typedef of FileIO or Workbench;
 *   FindFiles matches with any qualifier. A level-1 failure in a file under mod/
 *   (or outside the repo), a warning note under mod-dev/; DENY_ALLOWED lists
 *   the probe pack's deliberate uses by file and line.
 * --keys       print the request and response keys of each handler (JSON)
 *              instead of linting
 * --trace      also list every resolved call with the declaration it
 *              resolved to (the index evidence for a pass)
 *
 * Exit: 0 no level-1 failure and no parse error; 1 at least one level-1
 * failure or a file that does not parse (what a parse error hides is not
 * linted); 2 usage or NO DATA (no source index and no game install to build
 * it from).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compareCodeUnits } from "../src/census/canon.js";
import { loadCurrentBuild } from "../src/census/census-config.js";
import {
  formatLintReport,
  handlerKeysOf,
  lintEnforceFiles,
  lintPassed,
  type HandlerContract,
  type LintInput,
  type LintReport,
} from "../src/census/enforce-lint.js";
import { parseContract, type Contract } from "../src/manifest/contract.js";
import { linterRows, type LinterRow } from "../src/manifest/generate.js";
import {
  ensureSourceIndex,
  loadSourceIndex,
  type SourceIndex,
} from "../src/census/source-index.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  isMainModule,
  pathsFrom,
  type Io,
} from "./census/cli-common.js";

const USAGE =
  "usage: enforce-lint.ts [<file.c|dir> ...] [--json] [--build <tag>] [--artifacts <dir>] [--index <file>] [--game <dir>] [--contracts <dir>] [--keys] [--trace]";

/** Repository root (this script lives in `<repo>/scripts`). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The shipped handler bundle. */
export const DEFAULT_HANDLER_DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");

/** Every `.c` file under a directory, in code-unit order of the path. */
function cFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort(compareCodeUnits)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.c$/i.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Path as shown in the report: repo-relative with forward slashes, else the base name. */
function displayPath(abs: string): string {
  const rel = relative(REPO_ROOT, abs);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  return abs.split(/[\\/]/).pop() ?? abs;
}

/** Contracts of a --contracts directory: flat keys for every file, per-action rows where stated. */
export interface LintContracts {
  /** Flat request/response keys by handler (file name without `.json`), both forms. */
  flat: Map<string, HandlerContract>;
  /** Per-action contracts by handler class (only files with `actions`). */
  perAction: Map<string, Contract>;
}

/**
 * Reads `<dir>/<Handler>.json` files in either form. A file with `actions` is the per-action
 * form and goes through `parseContract` (src/manifest/contract.ts, which throws a named
 * ContractError when it is malformed); any other file is the flat prototype form.
 */
export function loadLintContracts(dir: string): LintContracts {
  const flat = new Map<string, HandlerContract>();
  const perAction = new Map<string, Contract>();
  const keysOf = (v: unknown): string[] | undefined => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    if (v && typeof v === "object") return Object.keys(v);
    return undefined;
  };
  for (const name of readdirSync(dir).sort(compareCodeUnits)) {
    const file = join(dir, name);
    if (!name.endsWith(".json") || !statSync(file).isFile()) continue;
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    const c: HandlerContract = {};
    const req = keysOf(raw.request);
    const resp = keysOf(raw.response);
    if (req) c.request = req;
    if (resp) c.response = resp;
    flat.set(name.slice(0, -".json".length), c);
    if (raw.actions !== undefined) {
      const pc = parseContract(raw, name);
      perAction.set(pc.handler, pc);
    }
  }
  return { flat, perAction };
}

// ── Source helpers ────────────────────────────────────────────────────────────

/** Comments (and string bodies unless kept) blanked to spaces; offsets and newlines kept. */
function blank(text: string, keepStrings: boolean): string {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") out[i++] = " ";
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; i < stop; i++) if (text[i] !== "\n") out[i] = " ";
    } else if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\" && i + 1 < text.length) {
          if (!keepStrings) out[i] = " ";
          i++;
        }
        if (!keepStrings) out[i] = " ";
        i++;
      }
      i++;
    } else i++;
  }
  return out.join("");
}

function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

/** Index of the bracket closing the one at `open` (same kind), or -1. */
function closing(text: string, open: number): number {
  const o = text[open];
  const c = o === "(" ? ")" : o === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++;
    else if (text[i] === c && --depth === 0) return i;
  }
  return -1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Deny keys ─────────────────────────────────────────────────────────────────

/** Calls a shipped handler must never make (design section 6). */
export const DENY_KEYS: { key: string; re: RegExp; why: string }[] = [
  {
    key: "FileIO.FindFiles",
    // Any qualifier (FileIO or an alias of it), any whitespace around the dot.
    re: /\.\s*FindFiles\s*\(/g,
    why: "raises a modal authorization prompt without -scriptAuthorizeAll (U27); enumerate files offline in TypeScript",
  },
  {
    key: "Workbench.Dialog",
    re: /\bWorkbench\s*\.\s*Dialog\b/g,
    why: "a modal inside a handler blocks the call queue",
  },
  {
    key: "typedef FileIO/Workbench",
    // An alias would hide the qualifier from the qualified keys above.
    re: /\btypedef\s+(?:FileIO|Workbench)\b/g,
    why: "an alias of FileIO or Workbench hides deny-key calls from this lint",
  },
  {
    key: "RunCommandline",
    re: /\bRunCommandline\s*\(/g,
    why: "runs an external command line from a handler",
  },
  {
    key: "Configure(",
    // A call, not a declaration: `override void Configure()` has a type word before the name.
    re: /(?<!\b(?:void|bool|int|float|string|override|static|proto|native|external)\s+)\bConfigure\s*\(/g,
    why: "opens a plugin's settings dialog (a modal)",
  },
];

/**
 * The probe pack's deliberate uses (mod-dev only; never a file under mod/). File + line, so a
 * moved or new use is reported again as a warning instead of passing silently.
 */
export const DENY_ALLOWED: { file: string; line: number; key: string; why: string }[] = [
  // authProbe FindFiles, variants a and b: the U27 measurement of the authorization prompt.
  { file: "mod-dev/probe/ECEN_ProbeAuth.c", line: 121, key: "FileIO.FindFiles", why: "U27 probe" },
  { file: "mod-dev/probe/ECEN_ProbeAuth.c", line: 123, key: "FileIO.FindFiles", why: "U27 probe" },
  // modalTest: the U6 probe opens one dialog on purpose to measure a modal's effect on the queue.
  { file: "mod-dev/probe/ECEN_ProbeSystem.c", line: 287, key: "Workbench.Dialog", why: "U6 probe" },
];

export interface ExtraFinding {
  file: string;
  line: number;
  /** "fail": level-1 failure; "warn": note prefixed `warning:`; "allowed": note naming the table row. */
  level: "fail" | "warn" | "allowed";
  kind: "deny" | "action";
  /** The action name (kind "action") or the deny key (kind "deny"). */
  subject: string;
  message: string;
}

/** mod-dev/ is the probe pack: a warning there; anything else (mod/, outside the repo) fails. */
function denyLevel(file: string): "fail" | "warn" {
  return file.startsWith("mod-dev/") ? "warn" : "fail";
}

/** Deny-key findings of one file (comments and strings are not code). */
export function denyFindings(input: LintInput): ExtraFinding[] {
  const code = blank(input.text, false);
  const out: ExtraFinding[] = [];
  for (const d of DENY_KEYS) {
    for (const m of code.matchAll(d.re)) {
      const line = lineAt(code, m.index ?? 0);
      const allowed = DENY_ALLOWED.find(
        (a) => a.file === input.path && a.line === line && a.key === d.key,
      );
      out.push({
        file: input.path,
        line,
        level: allowed ? "allowed" : denyLevel(input.path),
        kind: "deny",
        subject: d.key,
        message: allowed
          ? `deny key ${d.key} allowed here by DENY_ALLOWED (${allowed.why})`
          : `deny key ${d.key}: ${d.why}`,
      });
    }
  }
  return out;
}

// ── Per-action contract check ─────────────────────────────────────────────────

/** A request variable name no source can contain (a handler or helper without the request). */
const NO_REQUEST = "@noRequest";

interface Region {
  start: number;
  end: number;
  req: string;
  resp: string | undefined;
}

type Methods = Map<string, { params: string[]; start: number; end: number }>;

/** Method bodies of the file by name: parameter names and body span (first declaration wins). */
function methodsOf(code: string): Methods {
  const out: Methods = new Map();
  const re = /\b[A-Za-z_]\w*(?:<[^<>;]*>)?\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{/g;
  for (const m of code.matchAll(re)) {
    const name = m[1];
    if (/^(if|while|for|foreach|switch|return|new)$/.test(name)) continue;
    const open = (m.index ?? 0) + m[0].length - 1;
    const end = closing(code, open);
    if (end < 0 || out.has(name)) continue;
    const params = m[2]
      .split(",")
      .map((p) => p.trim().split(/\s+/).pop() ?? "")
      .filter(Boolean);
    out.set(name, { params, start: open, end });
  }
  return out;
}

/** The branch plus the bodies of same-file methods it passes the request to (depth 3). */
function regionsOf(code: string, first: Region, methods: Methods): Region[] {
  const out: Region[] = [first];
  const seen = new Set<string>();
  const queue: { r: Region; depth: number }[] = [{ r: first, depth: 0 }];
  while (queue.length) {
    const { r, depth } = queue.shift() as { r: Region; depth: number };
    if (depth >= 3) continue;
    const body = code.slice(r.start, r.end);
    for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const meth = methods.get(m[1]);
      if (!meth) continue;
      const open = r.start + (m.index ?? 0) + m[0].length - 1;
      const close = closing(code, open);
      if (close < 0) continue;
      const args = code
        .slice(open + 1, close)
        .split(",")
        .map((a) => a.trim());
      const reqAt = args.indexOf(r.req);
      const respAt = r.resp ? args.indexOf(r.resp) : -1;
      // Follow a helper given the request, the response or both (a resp-only helper's writes count).
      const reqOk = reqAt >= 0 && meth.params[reqAt] !== undefined;
      const respOk = respAt >= 0 && meth.params[respAt] !== undefined;
      if (!reqOk && !respOk) continue;
      const key = `${m[1]}#${reqAt}#${respAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sub: Region = {
        start: meth.start,
        end: meth.end,
        req: reqOk ? meth.params[reqAt] : NO_REQUEST,
        resp: respOk ? meth.params[respAt] : undefined,
      };
      out.push(sub);
      queue.push({ r: sub, depth: depth + 1 });
    }
  }
  return out;
}

/**
 * Per-action findings of one handler file against its per-action contract (linterRows): each
 * `<req>.action == "x"` branch reads only the action's allowed keys and every required key,
 * and writes only its declared response keys; every contract action has a branch and every
 * branch an action. The request and response variables come from `X.Cast(request)` and
 * `new <Name>Response()` in the handler class; a same-file method the branch passes the
 * request to is followed (depth 3). Returns nothing when the handler class is not in the file.
 */
export function actionFindings(input: LintInput, contract: Contract): ExtraFinding[] {
  const out: ExtraFinding[] = [];
  const code = blank(input.text, false);
  const withStrings = blank(input.text, true);
  const fail = (offset: number, subject: string, message: string) =>
    out.push({
      file: input.path,
      line: lineAt(code, offset),
      level: "fail",
      kind: "action",
      subject,
      message,
    });

  const cm = new RegExp(`\\bclass\\s+${escapeRe(contract.handler)}\\b[^{;]*\\{`).exec(code);
  if (!cm) return out;
  const classOpen = cm.index + cm[0].length - 1;
  const classEndAt = closing(code, classOpen);
  const classEnd = classEndAt < 0 ? code.length : classEndAt;
  const cls = code.slice(classOpen, classEnd);
  const reqM = /\b([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*\s*\.\s*Cast\s*\(\s*request\s*\)/.exec(cls);
  // A handler that never casts its request (one action, no keys) reads nothing.
  const req = reqM?.[1] ?? NO_REQUEST;
  const resp = /\b([A-Za-z_]\w*)\s*=\s*new\s+[A-Za-z_]\w*Response\s*\(\s*\)/.exec(cls)?.[1];

  const rows = new Map<string, LinterRow>(linterRows(contract).map((r) => [r.action, r]));
  const methods = methodsOf(code);
  const r = escapeRe(req);
  const branchRe = new RegExp(
    `\\b${r}\\s*\\.\\s*action\\s*==\\s*"([^"]*)"|"([^"]*)"\\s*==\\s*${r}\\s*\\.\\s*action\\b`,
    "g",
  );
  const branches: { action: string; at: number; start: number; end: number }[] = [];
  for (const m of withStrings.slice(classOpen, classEnd).matchAll(branchRe)) {
    const at = classOpen + (m.index ?? 0);
    const action = m[1] ?? m[2];
    // Past the if condition's ")" to the branch: a block or one statement.
    let depth = 0;
    let i = at;
    for (; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
    let j = i + 1;
    while (j < code.length && /\s/.test(code[j])) j++;
    const end = code[j] === "{" ? closing(code, j) : code.indexOf(";", j);
    // The scan starts at the condition: `req.action == "x" && req.k` reads k for this action.
    branches.push({ action, at, start: at, end: end < 0 ? code.length : end + 1 });
  }

  // A one-action handler without a dispatch: its whole class is that action's branch.
  if (branches.length === 0 && contract.actions.length === 1)
    branches.push({
      action: contract.actions[0].name,
      at: cm.index,
      start: classOpen,
      end: classEnd,
    });

  const seenActions = new Set<string>();
  for (const b of branches) {
    seenActions.add(b.action);
    const row = rows.get(b.action);
    if (!row) {
      fail(b.at, b.action, `branch for action "${b.action}", which the contract does not declare`);
      continue;
    }
    const read = new Set<string>();
    for (const g of regionsOf(code, { start: b.start, end: b.end, req, resp }, methods)) {
      const body = code.slice(g.start, g.end);
      const rd = new RegExp(`\\b${escapeRe(g.req)}\\s*\\.\\s*([A-Za-z_]\\w*)`, "g");
      for (const m of body.matchAll(rd)) {
        read.add(m[1]);
        if (!row.allowed.includes(m[1]))
          fail(
            g.start + (m.index ?? 0),
            b.action,
            `action "${b.action}" reads request key "${m[1]}", which is not among its allowed keys (${row.allowed.join(", ")})`,
          );
      }
      if (!g.resp) continue;
      const wr = new RegExp(
        `\\b${escapeRe(g.resp)}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*(?:=(?!=)|\\.|\\[)`,
        "g",
      );
      for (const m of body.matchAll(wr)) {
        if (row.response.includes(m[1])) continue;
        // resp.Fail(...) / resp.Ok(...): a method of the response struct, not a field.
        if (/^[A-Z]/.test(m[1])) continue;
        fail(
          g.start + (m.index ?? 0),
          b.action,
          `action "${b.action}" writes response key "${m[1]}", which its contract response does not declare (${row.response.join(", ")})`,
        );
      }
    }
    for (const k of row.required) {
      if (k === "action" || read.has(k)) continue;
      fail(
        b.at,
        b.action,
        `action "${b.action}" requires key "${k}", but its branch never reads it`,
      );
    }
  }
  for (const a of contract.actions) {
    if (!seenActions.has(a.name))
      fail(
        cm.index,
        a.name,
        `the contract declares action "${a.name}", but ${contract.handler} has no ${req}.action == "${a.name}" branch`,
      );
  }
  return out;
}

/**
 * Adds the deny-key and per-action findings to a lint report in place: failures become
 * level-1 failures (counts and totals follow), warnings and allowed uses become notes.
 */
export function applyExtraChecks(
  report: LintReport,
  inputs: readonly LintInput[],
  perAction: Map<string, Contract> | undefined,
): ExtraFinding[] {
  const all: ExtraFinding[] = [];
  for (const input of inputs) {
    all.push(...denyFindings(input));
    for (const c of perAction?.values() ?? []) all.push(...actionFindings(input, c));
  }
  for (const f of all) {
    const fr = report.files.find((x) => x.file === f.file);
    if (!fr) continue;
    if (f.level === "fail") {
      fr.failures.push({
        file: f.file,
        line: f.line,
        check: f.kind === "action" ? "contract" : "deny",
        expression: f.kind === "action" ? `action ${f.subject}` : `deny ${f.subject}`,
        what: f.message,
        candidates: [],
      });
    } else {
      fr.notes.push({
        file: f.file,
        line: f.line,
        message: f.level === "warn" ? `warning: ${f.message}` : f.message,
      });
    }
  }
  for (const fr of report.files) {
    fr.failures.sort((a, b) => a.line - b.line || compareCodeUnits(a.what, b.what));
    fr.notes.sort((a, b) => a.line - b.line || compareCodeUnits(a.message, b.message));
    fr.counts.failures = fr.failures.length;
  }
  const t = report.totals;
  t.failures = report.files.reduce((n, f) => n + f.counts.failures, 0);
  t.files_failed = report.files.filter(
    (f) => f.failures.length > 0 || f.parse_errors.length > 0,
  ).length;
  if (perAction)
    report.notes.push(
      `per-action contracts: ${[...perAction.keys()].join(", ") || "none"} (dispatch branch keys checked)`,
    );
  return all;
}

export async function run(argv: string[], io: Io = PROCESS_IO): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        build: { type: "string" },
        artifacts: { type: "string" },
        index: { type: "string" },
        game: { type: "string" },
        contracts: { type: "string" },
        keys: { type: "boolean" },
        trace: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }

    // Files.
    const targets = positionals.length
      ? positionals.map((p) => resolve(p))
      : [join(REPO_ROOT, DEFAULT_HANDLER_DIR)];
    const files: string[] = [];
    for (const t of targets) {
      if (!existsSync(t)) {
        io.err(`enforce-lint: no such file or directory: ${displayPath(t)}\n${USAGE}`);
        return EXIT_USAGE;
      }
      if (statSync(t).isDirectory()) files.push(...cFilesUnder(t));
      else files.push(t);
    }
    if (files.length === 0) {
      io.err(`enforce-lint: no .c files to check\n${USAGE}`);
      return EXIT_USAGE;
    }
    const inputs: LintInput[] = files.map((f) => ({
      path: displayPath(f),
      text: readFileSync(f, "utf-8"),
    }));

    // Source index.
    let index: SourceIndex | undefined;
    let noData = "";
    if (values.index !== undefined) {
      const file = resolve(values.index);
      const head = existsSync(file)
        ? readFileSync(file, "utf-8").slice(0, 4096).split("\n")[0]
        : "";
      const build =
        values.build ?? (head ? (JSON.parse(head) as { build?: string }).build : undefined);
      index = build !== undefined ? loadSourceIndex(build, { file }) : undefined;
      if (!index) noData = `NO DATA: no source index at ${displayPath(file)}`;
    } else {
      let build = values.build;
      if (build === undefined) {
        try {
          build = loadCurrentBuild(pathsFrom(undefined)).tag;
        } catch {
          io.err(
            `enforce-lint: no --build given and data/census/current-build.json is unreadable\n${USAGE}`,
          );
          return EXIT_USAGE;
        }
      }
      const opts: { dir?: string; gamePath?: string } = {};
      if (values.artifacts !== undefined) opts.dir = resolve(values.artifacts);
      if (values.game !== undefined) opts.gamePath = resolve(values.game);
      const r = await ensureSourceIndex(build, opts);
      if (r.status === "no-data") noData = r.reason;
      else index = r.index;
    }
    if (!index) {
      if (values.json) io.out(JSON.stringify({ ok: false, no_data: true, reason: noData }));
      else io.out(noData);
      return EXIT_USAGE;
    }

    if (values.keys) {
      io.out(JSON.stringify(handlerKeysOf(index, inputs), null, 2));
      return EXIT_OK;
    }

    // A contracts path that is not a directory is a usage error, never an empty contract set.
    if (values.contracts !== undefined) {
      const dir = resolve(values.contracts);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        io.err(`enforce-lint: --contracts is not a directory: ${displayPath(dir)}\n${USAGE}`);
        return EXIT_USAGE;
      }
    }
    const loaded =
      values.contracts !== undefined ? loadLintContracts(resolve(values.contracts)) : undefined;
    const contracts = loaded?.flat;
    const report = lintEnforceFiles(index, inputs, {
      trace: values.trace === true,
      ...(contracts
        ? { contracts, contractsLabel: displayPath(resolve(values.contracts as string)) }
        : {}),
    });
    applyExtraChecks(report, inputs, loaded?.perAction);
    const ok = lintPassed(report);
    if (values.json) io.out(JSON.stringify({ ok, ...report }, null, 2));
    else io.out(formatLintReport(report));
    return ok ? EXIT_OK : EXIT_FAIL;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: unknown }).code;
    io.err(`enforce-lint: ${msg}`);
    // Same mapping as guard() in cli-common: an argument error is 2, anything else 1.
    if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) return EXIT_USAGE;
    return EXIT_FAIL;
  }
}

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
