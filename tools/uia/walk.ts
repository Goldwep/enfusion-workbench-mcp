/**
 * Entry point of the passive accessibility walker (plan 8 Phase 2, CORE-AUTHOR
 * walker; unknown U7). The walk itself is `tools/uia/walker.py`; this wrapper
 * puts it inside the live-harness rules:
 *
 *   1. builds the walk's ACTION PLAN, one `uia-read` action, and checks it with
 *      the dry-run checker (`scripts/live/dry-run.ts` checkPlan, policy from
 *      data/census/policy.json, the caps of the nine bounds from its
 *      `live_lane.uia_read`) before anything runs, and prints both. The walk
 *      issues none of net-call, menu-open, invoke, key, execute-action or
 *      screenshot. A `--list-windows` run reads Win32 window facts of one pid
 *      only (no UI Automation), so its plan is `[]`;
 *   2. applies the single live gate (`--really`, win32, the lease held by this
 *      lane, scripts/live/cli.ts) and, on top of it, requires the target pid to
 *      be the Workbench pid this lane recorded (`lane.ts record`): the walker
 *      never reads a Workbench this session did not start;
 *   3. runs `python -B walker.py` (no bytecode files) with the redaction table in
 *      ENFUSION_UIA_REDACT and, for a real walk only, ENFUSION_UIA_PLAN_VERDICT=PASS;
 *      heartbeats the lease before, every minute during and after the run (plan
 *      5.3 "During"); kills its own child when budget plus grace has passed or
 *      the heartbeat fails;
 *   4. passes the JSON document through toPlaceholders (scripts/live/paths.ts),
 *      the account and machine names and the generic personal-data shapes a
 *      second time, records whether that pass still changed
 *      anything, and writes it to the artifacts folder (never inside a git
 *      working tree);
 *   5. prints, as its LAST line, a one-line JSON summary the session script reads
 *      (fields in docs/v2/sessions/queues/walker.md).
 *
 * Offline, `--fake-tree <tree.json>` runs the same walker on a fake tree
 * (tools/uia/fake_provider.py); no gate applies because nothing real is read.
 *
 * Usage:
 *   npx tsx tools/uia/walk.ts --pid <wb pid> --class <window class> --title-pattern <regex>
 *       [--view raw|control] [--allow-owned] [--hwnd <n>] [--label <name>] [--out <file>]
 *       [--plan-out <file>] [--policy <policy.json>] [--tools <dir>] [--game <dir>]
 *       [--sandbox <dir>] [--addons <dir>] [--max-depth n] [--max-nodes n] [--budget-ms n]
 *       [--row-sample n] [--max-children n] [--count-cap n] [--call-timeout-ms n]
 *       [--slow-call-ms n] [--max-consecutive-errors n]
 *       [--id <lane id> [--lease-path p] [--marker-path p] --really]
 *   npx tsx tools/uia/walk.ts --pid <wb pid> --list-windows [--id <lane id> --really]
 *   npx tsx tools/uia/walk.ts --fake-tree <tree.json> --pid <n> --class <c> --title-pattern <re> [--out <file>]
 *
 * Exit code: the walker's (0 walked, 3 target refused, 4 provider unavailable,
 * 5 real run refused), 1 when the plan check fails, the walker timed out or its
 * output is not JSON, 2 on a usage error.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import {
  checkPlan,
  formatResult,
  uiaReadViolations,
  type PlanAction,
} from "../../scripts/live/dry-run.js";
import { DEFAULT_HEARTBEAT_MS, Lane } from "../../scripts/live/lane.js";
import {
  artifactsDir,
  defaultPlaceholderContext,
  insideGitWorkTree,
  toPlaceholders,
  type PlaceholderContext,
} from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** This folder (`<repo>/tools/uia`). */
export const UIA_DIR = dirname(fileURLToPath(import.meta.url));

/** The Python walker. */
export const WALKER_SCRIPT = join(UIA_DIR, "walker.py");

/** Repo-relative id of this script, as dry-run exceptions name scripts. */
export const SCRIPT_ID = "tools/uia/walk.ts";

/** The dry-run checker's action kind for a passive accessibility read. */
export const READ_ACTION_KIND = "uia-read";

/** Interpreter override; default `python` on PATH. */
export const PYTHON_ENV = "ENFUSION_PYTHON";

/** Redaction table handed to the walker (JSON `{ paths, tokens }`). */
export const REDACT_ENV = "ENFUSION_UIA_REDACT";

/** Set to PASS for a real walk once the plan check passed. */
export const PLAN_VERDICT_ENV = "ENFUSION_UIA_PLAN_VERDICT";

/** Extra time the wrapper gives the walker beyond its own budget before killing it. */
export const KILL_GRACE_MS = 15_000;

export interface WalkBounds {
  maxDepth: number;
  maxNodes: number;
  budgetMs: number;
  rowSample: number;
  maxChildren: number;
  countCap: number;
  callTimeoutMs: number;
  slowCallMs: number;
  maxConsecutiveErrors: number;
}

/** Mirrors DEFAULT_BOUNDS in walker.py (a test compares the two). */
export const DEFAULT_BOUNDS: WalkBounds = {
  maxDepth: 40,
  maxNodes: 5000,
  budgetMs: 60_000,
  rowSample: 40,
  maxChildren: 1000,
  countCap: 2000,
  callTimeoutMs: 2000,
  slowCallMs: 250,
  maxConsecutiveErrors: 3,
};

/**
 * Mirrors BOUND_CAPS in walker.py, and `live_lane.uia_read` in
 * data/census/policy.json, from which the dry-run checker reads the caps (a
 * test keeps the three equal).
 */
export const BOUND_CAPS: WalkBounds = {
  maxDepth: 200,
  maxNodes: 100_000,
  budgetMs: 600_000,
  rowSample: 1000,
  maxChildren: 10_000,
  countCap: 100_000,
  callTimeoutMs: 30_000,
  slowCallMs: 60_000,
  maxConsecutiveErrors: 50,
};

const BOUND_KEYS = Object.keys(DEFAULT_BOUNDS) as Array<keyof WalkBounds>;

/** `maxDepth` -> `max-depth` (the CLI flag of both scripts). */
export function boundFlag(key: keyof WalkBounds): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** `maxDepth` -> `max_depth` (walker.py's key). */
export function boundSnake(key: keyof WalkBounds): string {
  return boundFlag(key).replace(/-/g, "_");
}

// ── Target and plan ──────────────────────────────────────────────────────────

export interface WalkTarget {
  pid: number;
  className: string;
  titlePattern: string;
  hwnd?: number;
  allowOwned?: boolean;
}

export type WalkView = "raw" | "control";

/** Null when the target names one window by pid, class and title pattern together. */
export function validateTarget(t: Partial<WalkTarget>): string | null {
  if (typeof t.pid !== "number" || !Number.isInteger(t.pid) || t.pid <= 0) {
    return "a positive integer --pid is required (never the foreground window)";
  }
  if (!t.className || !t.className.trim()) {
    return "--class is required (never a search by title alone)";
  }
  if (!t.titlePattern) return "--title-pattern is required";
  try {
    new RegExp(t.titlePattern);
  } catch (e) {
    return `--title-pattern does not compile: ${e instanceof Error ? e.message : String(e)}`;
  }
  return null;
}

/** Null when every bound is a positive integer within its cap. */
export function validateBounds(b: WalkBounds): string | null {
  for (const k of BOUND_KEYS) {
    const v = b[k];
    if (!Number.isInteger(v) || v <= 0 || v > BOUND_CAPS[k]) {
      return `--${boundFlag(k)} must be an integer between 1 and ${BOUND_CAPS[k]}`;
    }
  }
  return null;
}

/** The walk's action plan: the read itself as one `uia-read` action. */
export function buildActionPlan(
  target: WalkTarget,
  bounds: WalkBounds,
  view: WalkView,
): PlanAction[] {
  const window: Record<string, unknown> = {
    className: target.className,
    titlePattern: target.titlePattern,
    allowOwned: target.allowOwned === true,
  };
  if (target.hwnd !== undefined) window.hwnd = target.hwnd;
  return [
    {
      kind: READ_ACTION_KIND,
      target: { pid: target.pid, window } as unknown as PlanAction["target"],
      readOnly: true,
      view,
      bounds: { ...bounds },
    },
  ];
}

export interface ReadViolation {
  rule: "uia-read-untargeted" | "uia-read-unbounded" | "uia-read-not-read-only";
  detail: string;
}

/**
 * The `uia-read` rule with this file's caps. The rule itself lives in the
 * dry-run checker (`uiaReadViolations` in scripts/live/dry-run.ts), which reads
 * the caps from `live_lane.uia_read` of the policy; this wrapper applies the
 * caps of the code (BOUND_CAPS, or tighter ones a caller passes):
 *
 *   uia-read-untargeted     target.pid is not a positive integer (or
 *                           "lane-recorded"), or target.window.className or
 *                           target.window.titlePattern is missing or empty, or
 *                           the target names the foreground window, or
 *                           target.window.allowOwned is present and not a
 *                           boolean, or target.window.hwnd is present and not a
 *                           positive integer
 *   uia-read-unbounded      a bound of WalkBounds is missing, not a positive
 *                           integer, or above its cap
 *   uia-read-not-read-only  readOnly is not true, or the action carries an
 *                           element target (path, automationId), an API, keys,
 *                           a dialog or a role
 */
export function checkUiaReadAction(
  action: PlanAction,
  caps: WalkBounds = BOUND_CAPS,
): ReadViolation[] {
  return uiaReadViolations(action, { ...caps }) as ReadViolation[];
}

// ── Redaction ────────────────────────────────────────────────────────────────

export interface RedactionTable {
  paths: Array<[string, string]>;
  tokens: Array<[string, string]>;
}

/**
 * Profile-name placeholders a home path may carry without being redacted (walker.py
 * `_PLACEHOLDER_NAME`, same expression).
 */
const PLACEHOLDER_NAME =
  /^(?:<[^<>]*>|&lt|\{[^{}]*\}|%[^%]+%|\$env:[A-Za-z_]\w*|\$\{?[A-Za-z_]\w*\}?|~|\.{2,}|\u2026|public|default)$/i;

/**
 * The generic personal-data shapes walker.py also replaces (a home path of another account,
 * a Steam64 id, an e-mail address outside the documentation domains), with their placeholders.
 * Plain redaction of the written artifact; no scan and no verdict (DEC-060).
 */
const GENERIC_SHAPES: ReadonlyArray<{
  regex: RegExp;
  placeholder: string;
  keep?: (m: string[]) => boolean;
}> = [
  {
    regex: /(?:\b[A-Za-z]:|(?<![\w./-])\/[A-Za-z])[\\/]+users[\\/]+([^\\/\s"'`|:*?,;()[\]=]+)/gi,
    placeholder: "<home-path>",
    keep: (m) => PLACEHOLDER_NAME.test(m[1] ?? ""),
  },
  { regex: /(?<!\d)7656\d{13}(?!\d)/g, placeholder: "<steam-id>" },
  {
    regex: /(?<![\w.%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g,
    placeholder: "<email>",
    keep: (m) =>
      /(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost)$/i.test(m[1] ?? ""),
  },
];

const CONTEXT_PLACEHOLDERS: ReadonlyArray<[keyof PlaceholderContext, string]> = [
  ["sandbox", "<sandbox>"],
  ["game", "<game>"],
  ["tools", "<tools>"],
  ["v2", "<v2>"],
  ["repo", "<repo>"],
  ["localAppData", "%LOCALAPPDATA%"],
  ["userProfile", "%USERPROFILE%"],
];

/** The table walker.py redacts with: known roots, the addons folder, the account and machine names. */
export function redactionTable(
  ctx: PlaceholderContext,
  addons: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RedactionTable {
  const paths: Array<[string, string]> = [];
  if (addons) paths.push([addons, "<addons>"]);
  for (const [key, placeholder] of CONTEXT_PLACEHOLDERS) {
    const v = ctx[key];
    if (v) paths.push([v, placeholder]);
  }
  const tokens: Array<[string, string]> = [];
  if (env.USERNAME && env.USERNAME.length >= 3) tokens.push([env.USERNAME, "<user>"]);
  if (env.COMPUTERNAME && env.COMPUTERNAME.length >= 3) tokens.push([env.COMPUTERNAME, "<host>"]);
  return { paths, tokens };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace one path in every spelling (both slash styles, JSON-escaped), ignoring case. */
function replacePath(text: string, path: string, placeholder: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed.length < 2) return text;
  const back = trimmed.replace(/\//g, "\\");
  const forms = [...new Set([back, trimmed.replace(/\\/g, "/"), back.replace(/\\/g, "\\\\")])];
  const re = new RegExp(
    `(?:${forms
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})(?![\\w-])`,
    "gi",
  );
  return text.replace(re, placeholder);
}

/**
 * The second redaction pass over the walker's JSON text: the addons folder,
 * toPlaceholders, the account and machine names anywhere (substrings, plain and
 * URL-encoded), then the generic personal-data shapes.
 */
export function secondPass(
  text: string,
  ctx: PlaceholderContext,
  table: RedactionTable,
): { text: string; changed: boolean } {
  let out = text;
  for (const [literal, placeholder] of table.paths) {
    if (placeholder === "<addons>") out = replacePath(out, literal, placeholder);
  }
  out = toPlaceholders(out, ctx);
  for (const [literal, placeholder] of table.tokens) {
    const forms = [...new Set([literal, encodeURIComponent(literal)])];
    out = out.replace(new RegExp(forms.map(escapeRegExp).join("|"), "gi"), placeholder);
  }
  for (const shape of GENERIC_SHAPES) {
    out = out.replace(shape.regex, (...m: unknown[]) => {
      const groups = m.slice(0, -2) as string[];
      return shape.keep?.(groups) ? groups[0] : shape.placeholder;
    });
  }
  return { text: out, changed: out !== text };
}

// ── Running the walker ───────────────────────────────────────────────────────

export interface WalkerRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when a tick (the lease heartbeat) failed and the child was killed. */
  aborted?: string;
}

export function pythonExe(env: NodeJS.ProcessEnv = process.env): string {
  return env[PYTHON_ENV] || "python";
}

/** walker.py's argv (after the interpreter). */
export function walkerArgv(opts: {
  provider: "fake" | "uia";
  fakeTree?: string;
  target: Partial<WalkTarget> & { pid: number };
  bounds: WalkBounds;
  view: WalkView;
  listWindows?: boolean;
  really?: boolean;
}): string[] {
  const argv = ["-B", WALKER_SCRIPT, "--provider", opts.provider];
  if (opts.fakeTree) argv.push("--fake-tree", opts.fakeTree);
  argv.push("--pid", String(opts.target.pid));
  if (opts.listWindows) {
    argv.push("--list-windows");
  } else {
    argv.push(
      "--class",
      opts.target.className ?? "",
      "--title-pattern",
      opts.target.titlePattern ?? "",
    );
    if (opts.target.hwnd !== undefined) argv.push("--hwnd", String(opts.target.hwnd));
    if (opts.target.allowOwned) argv.push("--allow-owned");
    argv.push("--view", opts.view);
  }
  for (const k of BOUND_KEYS) argv.push(`--${boundFlag(k)}`, String(opts.bounds[k]));
  if (opts.really) argv.push("--really");
  return argv;
}

/**
 * Run the walker once; kill the child (ours) after `timeoutMs`. While it runs,
 * `tick` is called every `tickMs`; a tick that throws kills the child too
 * (`aborted` names why).
 */
export function runWalkerProcess(
  argv: string[],
  env: Record<string, string>,
  timeoutMs: number,
  python: string = pythonExe(),
  tick?: { fn: () => void; everyMs: number },
): Promise<WalkerRun> {
  return new Promise((resolvePromise) => {
    const child = spawn(python, argv, {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8", ...env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let aborted: string | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const ticker = tick
      ? setInterval(() => {
          try {
            tick.fn();
          } catch (e) {
            aborted = e instanceof Error ? e.message : String(e);
            child.kill();
          }
        }, tick.everyMs)
      : null;
    const stop = (): boolean => {
      clearTimeout(timer);
      if (ticker) clearInterval(ticker);
      if (settled) return false;
      settled = true;
      return true;
    };
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => {
      if (!stop()) return;
      resolvePromise({ code: null, stdout: "", stderr: e.message, timedOut, aborted });
    });
    child.on("close", (code) => {
      if (!stop()) return;
      resolvePromise({
        aborted,
        code,
        stdout: Buffer.concat(out).toString("utf-8"),
        stderr: Buffer.concat(err).toString("utf-8"),
        timedOut,
      });
    });
  });
}

/** Artifact file name: `uia-walk-<label>-<timestamp>.json`. */
export function walkFileName(label: string, now: Date = new Date()): string {
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 48) || "walk";
  return `uia-walk-${safe}-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** The one-line summary the session script reads (the wrapper's last line). */
export interface WalkSummary {
  out: string | null;
  sha256: string | null;
  exit_code: number | null;
  refused: boolean;
  reason: string | null;
  elapsed_ms: number | null;
  attach_ms: number | null;
  walk_ms: number | null;
  nodes: number | null;
  completed: boolean | null;
  /** True when an element or a child list could not be read. */
  partial: boolean | null;
  stop_reason: string | null;
  uia_calls: Record<string, unknown> | null;
  /** Failed calls of any kind, and child lists that could not be read. */
  errors: number | null;
  child_errors: number | null;
  /** The real provider's client timeouts took effect (null on the fake). */
  client_timeouts_set: boolean | null;
  /** IsHungAppWindow samples during and after the walk, and how many said hung. */
  hung_samples: number | null;
  hung_true: number | null;
  strings_redacted: number | null;
  post_pass_changed: boolean;
}

export interface FinishedWalk {
  summary: WalkSummary;
  /** The redacted document text that was (or would be) written. */
  text: string | null;
  stderr: string;
}

/**
 * Run, redact twice, write. `outPath` must lie outside every git working tree.
 * `heartbeat` (the lane's lease heartbeat, plan 5.3 "During") is called before
 * the child starts, every `heartbeatMs` while it runs, and after it exits; a
 * heartbeat that throws before the start refuses the run, one that throws
 * during it kills the child.
 */
export async function runWalk(opts: {
  argv: string[];
  env: Record<string, string>;
  timeoutMs: number;
  outPath: string;
  ctx: PlaceholderContext;
  table: RedactionTable;
  python?: string;
  heartbeat?: () => void;
  heartbeatMs?: number;
}): Promise<FinishedWalk> {
  if (insideGitWorkTree(dirname(resolve(opts.outPath)))) {
    throw new Error(
      `${opts.outPath} lies inside a git working tree; raw artifacts never enter one`,
    );
  }
  opts.heartbeat?.();
  const run = await runWalkerProcess(
    opts.argv,
    opts.env,
    opts.timeoutMs,
    opts.python,
    opts.heartbeat
      ? { fn: opts.heartbeat, everyMs: opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS }
      : undefined,
  );
  let lateHeartbeat: string | undefined;
  if (opts.heartbeat && !run.aborted) {
    try {
      opts.heartbeat();
    } catch (e) {
      lateHeartbeat = e instanceof Error ? e.message : String(e);
    }
  }
  const empty: WalkSummary = {
    out: null,
    sha256: null,
    exit_code: run.code,
    refused: false,
    reason: null,
    elapsed_ms: null,
    attach_ms: null,
    walk_ms: null,
    nodes: null,
    completed: null,
    partial: null,
    stop_reason: null,
    uia_calls: null,
    errors: null,
    child_errors: null,
    client_timeouts_set: null,
    hung_samples: null,
    hung_true: null,
    strings_redacted: null,
    post_pass_changed: false,
  };
  const stderr = secondPass(
    [run.stderr, lateHeartbeat ? `lease heartbeat after the walk failed: ${lateHeartbeat}` : ""]
      .filter(Boolean)
      .join("\n"),
    opts.ctx,
    opts.table,
  ).text;
  if (run.aborted) {
    const why = secondPass(run.aborted, opts.ctx, opts.table).text;
    return {
      summary: { ...empty, reason: `lease heartbeat failed, walker killed: ${why}` },
      text: null,
      stderr,
    };
  }
  if (run.timedOut) {
    return { summary: { ...empty, reason: "walker timed out and was killed" }, text: null, stderr };
  }
  const line = run.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line)
    return { summary: { ...empty, reason: "walker printed no document" }, text: null, stderr };
  const pass = secondPass(line, opts.ctx, opts.table);
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(pass.text) as Record<string, unknown>;
  } catch {
    return { summary: { ...empty, reason: "walker output is not JSON" }, text: null, stderr };
  }
  const redaction = (doc.redaction ?? {}) as Record<string, unknown>;
  redaction.post_pass_changed = pass.changed;
  doc.redaction = redaction;
  const text = JSON.stringify(doc, null, 1);
  mkdirSync(dirname(resolve(opts.outPath)), { recursive: true });
  writeFileSync(opts.outPath, text, { encoding: "utf-8", flag: "wx" });
  const counts = (doc.counts ?? {}) as Record<string, unknown>;
  const calls = (doc.uia_calls ?? null) as Record<string, unknown> | null;
  const hung = (doc.hung ?? {}) as Record<string, unknown>;
  const info = (doc.provider_info ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  return {
    summary: {
      out: toPlaceholders(opts.outPath, opts.ctx),
      sha256: createHash("sha256").update(text, "utf-8").digest("hex"),
      exit_code: run.code,
      refused: doc.refused === true,
      reason: typeof doc.reason === "string" ? doc.reason : null,
      elapsed_ms: num(doc.elapsed_ms),
      attach_ms: num(doc.attach_ms),
      walk_ms: num(doc.walk_ms),
      nodes: num(counts.nodes),
      completed: bool(doc.completed),
      partial: bool(doc.partial),
      stop_reason: typeof doc.stop_reason === "string" ? doc.stop_reason : null,
      uia_calls: calls
        ? {
            count: calls.count,
            max_ms: calls.max_ms,
            p95_ms: calls.p95_ms,
            slow_calls: calls.slow_calls,
            timeouts: calls.timeouts,
            errors: calls.errors,
          }
        : null,
      errors: calls ? num(calls.errors) : null,
      child_errors: num(counts.child_errors),
      client_timeouts_set: bool(info.client_timeouts_set),
      hung_samples: num(hung.samples),
      hung_true: num(hung.true),
      strings_redacted: num(redaction.strings_redacted),
      post_pass_changed: pass.changed,
    },
    text,
    stderr,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "pid",
  "class",
  "title-pattern",
  "hwnd",
  "view",
  "label",
  "out",
  "plan-out",
  "policy",
  "fake-tree",
  "id",
  "lease-path",
  "marker-path",
  "tools",
  "game",
  "sandbox",
  "addons",
  ...BOUND_KEYS.map(boundFlag),
] as const;

function intOption(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
}

function quoteArg(a: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`;
}

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    console.error(
      toPlaceholders(e instanceof Error ? e.message : String(e), defaultPlaceholderContext()),
    );
    return 2;
  }
  const o = args.options;
  const listWindows = args.flags.has("list-windows");
  const fakeTree = o["fake-tree"];
  const view = (o.view ?? "raw") as WalkView;
  if (view !== "raw" && view !== "control") {
    console.error("--view must be raw or control");
    return 2;
  }
  const bounds: WalkBounds = { ...DEFAULT_BOUNDS };
  for (const k of BOUND_KEYS) {
    const v = intOption(o[boundFlag(k)]);
    if (v !== undefined) bounds[k] = v;
  }
  const boundsError = validateBounds(bounds);
  if (boundsError) {
    console.error(boundsError);
    return 2;
  }
  const target: WalkTarget = {
    pid: intOption(o.pid) ?? Number.NaN,
    className: o.class ?? "",
    titlePattern: o["title-pattern"] ?? "",
    hwnd: intOption(o.hwnd),
    allowOwned: args.flags.has("allow-owned"),
  };
  const targetError = listWindows
    ? validateTarget({ ...target, className: "-", titlePattern: "-" })
    : validateTarget(target);
  if (targetError) {
    console.error(targetError);
    return 2;
  }

  const ctx = defaultPlaceholderContext({ tools: o.tools, game: o.game, sandbox: o.sandbox });
  const table = redactionTable(ctx, o.addons, process.env);

  // 1. The action plan, printed and checked before anything runs. A window
  // list reads Win32 facts of one pid (launcher-nudge's inspect mode, no UI
  // Automation), so its plan holds no action.
  const plan = listWindows ? [] : buildActionPlan(target, bounds, view);
  const check = checkPlan(plan, loadPolicy(o.policy), { script: SCRIPT_ID });
  console.log(
    `ACTION PLAN (scripts/live/dry-run.ts format): ${toPlaceholders(JSON.stringify(plan), ctx)}`,
  );
  console.log(`dry-run check: ${formatResult(check)}`);
  if (o["plan-out"]) {
    writeFileSync(o["plan-out"], toPlaceholders(JSON.stringify(plan, null, 1), ctx), "utf-8");
  }
  if (!check.ok) return 1;

  // 2. Which provider, and the live gate for the real one.
  const provider: "fake" | "uia" = fakeTree ? "fake" : "uia";
  const really = args.flags.has("really");
  const walkerArgs = walkerArgv({
    provider,
    fakeTree,
    target,
    bounds,
    view,
    listWindows,
    really: provider === "uia" && really,
  });
  const env: Record<string, string> = { [REDACT_ENV]: JSON.stringify(table) };
  let lane: Lane | null = null;
  if (provider === "uia") {
    lane = o.id
      ? new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] })
      : null;
    const gate = liveGateReason({
      really,
      platform: process.platform,
      leaseHeld: lane ? lane.holdsLease() : false,
    });
    if (gate !== null) {
      const cmd = [pythonExe(), ...walkerArgs, ...(really ? [] : ["--really"])]
        .map(quoteArg)
        .join(" ");
      console.log(
        `${gate}; would run (with ${REDACT_ENV} and ${PLAN_VERDICT_ENV}=PASS): ${toPlaceholders(cmd, ctx)}`,
      );
      return gate.startsWith("refused") ? 1 : 0;
    }
    const recorded = lane!.recordedPid();
    if (recorded !== target.pid) {
      console.error(
        `refused: pid ${target.pid} is not the Workbench this lane recorded (${recorded === null ? "none recorded" : `pid ${recorded}`}); run lane.ts record first`,
      );
      return 1;
    }
    env[PLAN_VERDICT_ENV] = "PASS";
  }

  // 3-5. Run, redact twice, write, summarise.
  const outPath =
    o.out ??
    join(
      artifactsDir(),
      "uia",
      walkFileName(`${o.label ?? (listWindows ? "windows" : "walk")}-${provider}`),
    );
  let done: FinishedWalk;
  try {
    done = await runWalk({
      argv: walkerArgs,
      env,
      timeoutMs: bounds.budgetMs + 4 * bounds.callTimeoutMs + KILL_GRACE_MS,
      outPath,
      ctx,
      table,
      heartbeat: lane
        ? () => {
            lane!.heartbeat();
          }
        : undefined,
    });
  } catch (e) {
    // In placeholder form like every other printed path (DEC-032, S-C read m6).
    console.error(secondPass(e instanceof Error ? e.message : String(e), ctx, table).text);
    return 1;
  }
  if (done.stderr.trim()) console.error(done.stderr.trim());
  console.log(JSON.stringify(done.summary));
  const code = done.summary.exit_code;
  if (done.text === null) return code !== null && code !== 0 ? code : 1;
  return code ?? 1;
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
