/**
 * Wrapper of the L05 context-menu kernel `tools/uia/context.py` (Phase 4 design 2.2 `uia-context`),
 * in the form of menus.ts:
 *
 *   1. builds the run's ACTION PLAN, one `uia-context` action (calls ShowContextMenu, Collapse),
 *      and checks it with scripts/live/dry-run.ts checkPlan against the policy
 *      (`live_lane.uia_context`: the target must be listed, timeoutMs within perTargetMs). A real
 *      run needs that check to pass; a fake run prints the verdict and goes on;
 *   2. applies the single live gate (`--really`, win32, the lease held by this lane), requires the
 *      pid to be the one this lane recorded;
 *   3. runs `python -B context.py` with the redaction table and, for a real run only,
 *      ENFUSION_UIA_CONTEXT_PLAN_VERDICT=PASS; heartbeats the lease while it runs;
 *   4. passes the JSON through walk.ts's second redaction pass and writes it to the artifacts
 *      folder (never inside a git working tree);
 *   5. prints, as its LAST line, a one-line JSON summary:
 *      { result, exit_code, out, supported, popup, items, collapsed, leftOpen, selectionChanged,
 *        second_pass_changed }.
 *
 * `--passive` (the sf-15 route): context.py sends nothing; it waits up to `--timeout-ms`
 * (default 20000) for a popup the hand opened by right-clicking, reads it as the active path does
 * and leaves it open for the hand's Esc. The plan is then one `uia-read` of the popup window
 * (PASSIVE_POPUP_WINDOW), no `uia-context` action. Result `no-popup` (exit 0) when none came.
 *
 * Usage:
 *   npx tsx tools/uia/context.ts --pid <wb pid> --class <window class> --title <regex>
 *       --path '["Hierarchy","default"]' --module <ModuleId> [--timeout-ms 15000]
 *       [--out f] [--label n] [--policy p] [--addons d] [--id <lane> [--lease-path p]
 *       [--marker-path p] --really] [--dry-run] [--passive]
 *   npx tsx tools/uia/context.ts --fake-tree <ctx.json> ... --really
 *
 * Exit code: context.py's (0 ok, unsupported or dry run; 3 refused; 4 provider unavailable;
 * 5 popup left open; 6 stopped; 7 real run refused), 1 when the plan check fails for a real run,
 * the tool timed out or printed no JSON, 2 on a usage error.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import {
  LANE_RECORDED_PID,
  checkPlan,
  formatResult,
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
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import {
  DEFAULT_BOUNDS,
  REDACT_ENV,
  UIA_DIR,
  buildActionPlan,
  pythonExe,
  redactionTable,
  runWalkerProcess,
  secondPass,
  type RedactionTable,
} from "./walk.js";

export const CONTEXT_SCRIPT = join(UIA_DIR, "context.py");
export const SCRIPT_ID = "tools/uia/context.ts";
export const CONTEXT_ACTION_KIND = "uia-context";
export const CONTEXT_PLAN_VERDICT_ENV = "ENFUSION_UIA_CONTEXT_PLAN_VERDICT";
export const CONTEXT_CALLS = ["ShowContextMenu", "Collapse"] as const;
export const DEFAULT_TIMEOUT_MS = 15_000;
/** How long a passive read waits for the hand's right-click to open a popup. */
export const DEFAULT_PASSIVE_TIMEOUT_MS = 20_000;
/**
 * The popup window a passive read declares (scripts/census/live/common.ts POPUP_WINDOW_CLASS, the
 * sf-15 walk: `Qt683QWindowPopupDropShadowSaveBits` titled "Arma Reforger Workbench"). context.py
 * itself matches the popup by `QWindowPopup` in the class, unowned, as the active path does.
 */
export const PASSIVE_POPUP_WINDOW = {
  className: "Qt683QWindowPopupDropShadowSaveBits",
  titlePattern: "^Arma Reforger Workbench$",
} as const;
/** A menu is one level deep (sf-15: 19 nodes, depth 1); L05's POPUP_BOUNDS. */
export const PASSIVE_READ_BOUNDS = {
  ...DEFAULT_BOUNDS,
  maxDepth: 4,
  maxNodes: 500,
  budgetMs: 15_000,
};
/** Allowance on top of timeoutMs: attach, the target search, two selection reads, the popup read. */
export const OVERHEAD_MS = 30_000;
export const KILL_GRACE_MS = 15_000;

export interface ContextOptions {
  pid: number;
  className: string;
  title: string;
  path: string[];
  module?: string;
  timeoutMs: number;
  fakeTree?: string;
  really?: boolean;
  dryRun?: boolean;
  /** The sf-15 route: no ShowContextMenu, no Collapse; read the popup the hand opened. */
  passive?: boolean;
}

export function validateContextOptions(o: Partial<ContextOptions>): string | null {
  if (!Number.isInteger(o.pid) || (o.pid ?? 0) <= 0) return "--pid must be a positive integer";
  if (!o.className) return "--class is required (never a search by title alone)";
  if (!o.title) return "--title is required";
  try {
    new RegExp(o.title);
  } catch {
    return "--title does not compile as a regular expression";
  }
  if (!Array.isArray(o.path) || !o.path.length || !o.path.every((x) => typeof x === "string" && x))
    return "--path must be a non-empty JSON list of labels";
  if (!Number.isInteger(o.timeoutMs) || (o.timeoutMs ?? 0) < 1 || (o.timeoutMs ?? 0) > 60_000)
    return "--timeout-ms must be 1..60000";
  return null;
}

/** The plan action; `pid` may be the lane-recorded placeholder (L05's plan before a run). */
export function buildContextPlan(
  o: Pick<ContextOptions, "className" | "title" | "path" | "module" | "timeoutMs"> & {
    pid: number | typeof LANE_RECORDED_PID;
  },
): PlanAction[] {
  return [
    {
      kind: CONTEXT_ACTION_KIND,
      ...(o.module !== undefined ? { module: o.module } : {}),
      target: {
        pid: o.pid,
        window: { className: o.className, titlePattern: o.title },
        path: [...o.path],
      } as unknown as PlanAction["target"],
      calls: [...CONTEXT_CALLS],
      timeoutMs: o.timeoutMs,
    },
  ];
}

/**
 * The plan of a passive read: one `uia-read` of the popup window, nothing else (no uia-context:
 * no ShowContextMenu, no Collapse is sent; the hand opens and closes the popup).
 */
export function buildPassivePlan(o: { pid: number | typeof LANE_RECORDED_PID }): PlanAction[] {
  return buildActionPlan(
    {
      pid: o.pid as unknown as number,
      className: PASSIVE_POPUP_WINDOW.className,
      titlePattern: PASSIVE_POPUP_WINDOW.titlePattern,
      allowOwned: false,
    },
    PASSIVE_READ_BOUNDS,
    "raw",
  );
}

export function contextArgv(o: ContextOptions, provider: "fake" | "uia"): string[] {
  const argv = ["-B", CONTEXT_SCRIPT, "--provider", provider];
  if (o.fakeTree) argv.push("--fake-tree", o.fakeTree);
  argv.push("--pid", String(o.pid), "--class", o.className, "--title", o.title);
  argv.push("--path", JSON.stringify(o.path), "--timeout-ms", String(o.timeoutMs));
  if (o.passive) argv.push("--passive");
  if (o.dryRun) argv.push("--dry-run");
  if (o.really) argv.push("--really");
  return argv;
}

export function contextFileName(label: string, now: Date = new Date()): string {
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 48) || "context";
  return `uia-context-${safe}-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

export interface ContextItem {
  controlType?: string;
  name?: string;
  className?: string | null;
  automationId?: string | null;
  enabled?: boolean | null;
  checked?: boolean | null;
  acceleratorKey?: string | null;
  /** The item offers ExpandCollapse and is not a leaf (never expanded by this tool). */
  submenu?: boolean;
}

export interface ContextDoc {
  result?: string;
  dry_run?: boolean;
  /** A passive read (`--passive`): nothing was sent. */
  passive?: boolean;
  mode?: "passive";
  /** "hand": the popup was opened by the owner's (or main's) right-click. */
  openedBy?: "hand";
  popupPresentAtStart?: boolean;
  handoff?: string;
  /** Fake provider only: every call it received. */
  fakeCalls?: Array<[string, string | null]>;
  supported?: boolean | null;
  popup?: {
    className?: string;
    controlType?: string;
    name?: string;
    uiaClassName?: string | null;
    automationId?: string | null;
  } | null;
  items?: ContextItem[];
  collapsed?: boolean | null;
  leftOpen?: boolean;
  selectionChanged?: boolean;
  collapseSkipped?: string;
  reason?: string;
  calls?: Array<{ call: string }>;
  /** The resolved target; `liveNames`: steps matched by the Hierarchy dirty marker (P4-5). */
  target?: { liveNames?: LiveName[]; [k: string]: unknown };
}

/** A path step whose live name differs from the census name by one trailing `*` (unsaved world). */
export interface LiveName {
  step: number;
  census: string;
  live: string;
}

export interface ContextSummary {
  result: string | null;
  exit_code: number | null;
  out: string | null;
  supported: boolean | null;
  popup: boolean;
  items: number;
  collapsed: boolean | null;
  leftOpen: boolean;
  selectionChanged: boolean | null;
  second_pass_changed: boolean;
  passive: boolean;
}

export function summarize(
  doc: ContextDoc | null,
  code: number | null,
  out: string | null,
  changed: boolean,
): ContextSummary {
  return {
    result: doc ? (doc.dry_run ? "dry-run" : (doc.result ?? null)) : null,
    exit_code: code,
    out,
    supported: doc?.supported ?? null,
    popup: Boolean(doc?.popup),
    items: (doc?.items ?? []).length,
    collapsed: doc?.collapsed ?? null,
    leftOpen: Boolean(doc?.leftOpen),
    selectionChanged: doc?.selectionChanged ?? null,
    second_pass_changed: changed,
    passive: Boolean(doc?.passive),
  };
}

/** Run context.py once, redact twice, write the artifact (when a document came back). */
export async function runContext(opts: {
  options: ContextOptions;
  provider: "fake" | "uia";
  env: Record<string, string>;
  outPath: string;
  ctx: PlaceholderContext;
  table: RedactionTable;
  python?: string;
  heartbeat?: () => void;
}): Promise<{
  summary: ContextSummary;
  doc: ContextDoc | null;
  text: string | null;
  sha256: string | null;
  stderr: string;
}> {
  const o = opts.options;
  const run = await runWalkerProcess(
    contextArgv(o, opts.provider),
    opts.env,
    o.timeoutMs + OVERHEAD_MS + KILL_GRACE_MS,
    opts.python ?? pythonExe(),
    opts.heartbeat ? { fn: opts.heartbeat, everyMs: DEFAULT_HEARTBEAT_MS } : undefined,
  );
  const stderr = secondPass(run.stderr, opts.ctx, opts.table).text;
  const line = run.stdout.trim().split(/\r?\n/).pop() ?? "";
  let doc: ContextDoc | null = null;
  try {
    doc = line ? (JSON.parse(line) as ContextDoc) : null;
  } catch {
    doc = null;
  }
  if (!doc || run.timedOut || run.aborted) {
    const why = run.timedOut ? "timed out" : run.aborted ? `aborted (${run.aborted})` : "no JSON";
    return {
      summary: summarize(null, run.code, null, false),
      doc: null,
      text: null,
      sha256: null,
      stderr: `${stderr}\ncontext.py ${why}`.trim(),
    };
  }
  const pass = secondPass(JSON.stringify(doc, null, 1), opts.ctx, opts.table);
  let out: string | null = null;
  let sha256: string | null = null;
  if (!doc.dry_run) {
    const dir = dirname(resolve(opts.outPath));
    if (insideGitWorkTree(dir)) {
      throw new Error(`refused: ${toPlaceholders(dir, opts.ctx)} is inside a git working tree`);
    }
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(opts.outPath, pass.text, { encoding: "utf-8", flag: "wx" });
    out = toPlaceholders(opts.outPath, opts.ctx);
    sha256 = createHash("sha256").update(pass.text).digest("hex");
  }
  const redactedDoc = JSON.parse(pass.text) as ContextDoc;
  return {
    summary: summarize(redactedDoc, run.code, out, pass.changed),
    doc: redactedDoc,
    text: pass.text,
    sha256,
    stderr,
  };
}

const VALUED = [
  "pid",
  "class",
  "title",
  "path",
  "module",
  "timeout-ms",
  "fake-tree",
  "out",
  "label",
  "policy",
  "addons",
  "id",
  "lease-path",
  "marker-path",
] as const;

function parsePath(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  try {
    const p = JSON.parse(v) as unknown;
    return Array.isArray(p) ? (p as string[]) : undefined;
  } catch {
    return undefined;
  }
}

export async function main(argv: string[], over: { policy?: CensusPolicy } = {}): Promise<number> {
  const ctx = defaultPlaceholderContext();
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    console.error(toPlaceholders(e instanceof Error ? e.message : String(e), ctx));
    return 2;
  }
  const o = args.options;
  const policy = over.policy ?? loadPolicy(o.policy);
  const passive = args.flags.has("passive");
  const options: ContextOptions = {
    pid: o.pid ? Number(o.pid) : Number.NaN,
    className: o.class ?? "",
    title: o.title ?? "",
    path: parsePath(o.path) ?? [],
    ...(o.module !== undefined ? { module: o.module } : {}),
    timeoutMs:
      o["timeout-ms"] !== undefined
        ? Number(o["timeout-ms"])
        : passive
          ? DEFAULT_PASSIVE_TIMEOUT_MS
          : DEFAULT_TIMEOUT_MS,
    fakeTree: o["fake-tree"],
    really: args.flags.has("really") && !args.flags.has("dry-run"),
    dryRun: args.flags.has("dry-run"),
    ...(passive ? { passive: true } : {}),
  };
  const err = validateContextOptions(options);
  if (err) {
    console.error(err);
    return 2;
  }
  const table = redactionTable(ctx, o.addons, process.env);
  const plan = passive ? buildPassivePlan(options) : buildContextPlan(options);
  const check = checkPlan(plan, policy, { script: SCRIPT_ID });
  console.log(
    `ACTION PLAN (scripts/live/dry-run.ts format): ${toPlaceholders(JSON.stringify(plan), ctx)}`,
  );
  console.log(`dry-run check: ${formatResult(check)}`);

  const provider: "fake" | "uia" = options.fakeTree ? "fake" : "uia";
  const env: Record<string, string> = { [REDACT_ENV]: JSON.stringify(table) };
  let lane: Lane | null = null;
  if (provider === "uia" && options.really) {
    if (!check.ok) {
      console.error(
        `refused: the ${passive ? "passive uia-read" : "uia-context"} plan did not pass the dry-run checker; nothing is touched`,
      );
      return 1;
    }
    lane = o.id
      ? new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] })
      : null;
    const gate = liveGateReason({
      really: true,
      platform: process.platform,
      leaseHeld: lane ? lane.holdsLease() : false,
    });
    if (gate !== null) {
      console.error(gate);
      return 1;
    }
    const recorded = lane!.recordedPid();
    if (recorded !== options.pid) {
      console.error(
        `refused: pid ${options.pid} is not the Workbench this lane recorded (${recorded === null ? "none recorded" : `pid ${recorded}`})`,
      );
      return 1;
    }
    env[CONTEXT_PLAN_VERDICT_ENV] = "PASS";
  }
  const outPath =
    o.out ?? join(artifactsDir(), "uia", contextFileName(`${o.label ?? "context"}-${provider}`));
  let done;
  try {
    done = await runContext({
      options,
      provider,
      env,
      outPath,
      ctx,
      table,
      heartbeat: lane ? () => void lane!.heartbeat() : undefined,
    });
  } catch (e) {
    console.error(secondPass(e instanceof Error ? e.message : String(e), ctx, table).text);
    return 1;
  }
  if (done.stderr.trim()) console.error(done.stderr.trim());
  if (done.summary.result === "dry-run" && done.text)
    console.log(done.text.replace(/\s*\n\s*/g, " "));
  console.log(JSON.stringify(done.summary));
  if (done.text === null) return done.summary.exit_code ? done.summary.exit_code : 1;
  return done.summary.exit_code ?? 1;
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
