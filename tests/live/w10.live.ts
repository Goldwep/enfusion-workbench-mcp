/**
 * Wave W10 (plugins), the live battery (gap map item 5; docs/v2/inbox/phase6/plugin-safety-review.md,
 * DEC-097). Built in the form of tests/live/w9.live.ts: the same CLI, the same evidence, the same
 * stop rules, the window watch with W8's busy grace (WATCH_OPTIONS), and no hand step.
 *
 * RUN SET. The battery drives exactly the classes on policy `plugin_run_allow_list.allow_list`
 * ([module, class] pairs, read by `allowListOf` of src/tools/wb-plugin.ts), joined to the census
 * catalog (E03 plugin and tool rows). The main session rules a class in; this script never edits
 * the list. An entry the catalog does not hold, whose module is not the class's, or whose class E03
 * marks modal is refused: it gets no step and the plan check fails. With the list empty (today)
 * the battery drives nothing and still runs its gate, world, run-set, net-zero and closable steps.
 *
 * ONE STEP PER CLASS (block W10.2): for a World Editor class, the W10 world open, the selection set
 * to one entity and the camera read; then the log position (console.log of the newest Workbench
 * log session), the `wb_plugin run` dry run, and the confirm only when the dry run answered ok; a
 * dialog check after the run; the new log lines (polled); the camera and the selection put back;
 * the sandbox's net-zero check against the battery snapshot. A refusal of RUN_ANSWERS (GATED until
 * the handler's RunProven, PRECONDITION_UNMET, NOT_ALLOWLISTED, MODULE_NOT_OPEN, NO_WORLD,
 * WRONG_MODE) is NOT-RUN; PLUGIN_MODAL or any other code is a FAIL. A dialog is a HANDOFF.
 * A live result naming the class's row (`plugin:<class>`) is written only when the confirm answered
 * ok with `ran`, no dialog came up, and the sandbox outside _throwaway/W10/ is unchanged: oracle
 * `state-readback` for a camera move put back, `log-line` for new log lines, else
 * `returned-true-only`. A class whose expected effect (EXPECTED_EFFECT) was not read is NO-EFFECT:
 * recorded, no live result.
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch ini `<sitting>/scratch.ini` with `-scriptAuthorizeAll` (DEC-053 ruling 2), the shipped
 * bundle installed, no probe pack. This script never launches and never takes the lease. The tools
 * run IN PROCESS over a `WorkbenchClient` WITHOUT a Config: `runPlugin`, `runModule`, `runWorld`,
 * `runView`.
 *
 * Nothing saves, closes or reopens a world past the first open; the closable step leaves the
 * throwaway world as it is. DRY RUN BY DEFAULT: without --really it prints the outline, checks the
 * ACTION PLAN with checkPlan, the battery's own plan check and the queue; `--emit-queue` writes the
 * queue (docs/v2/sessions/queues/W10-queue.json; a test keeps the two equal, so re-emit it after a
 * ruling changes the list). The runbook is docs/v2/sessions/queues/W10.md.
 *
 * Usage:
 *   npx --no tsx tests/live/w10.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w10.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w10.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w10.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: 0 done (or dry run passed), 1 refused / plan check failed / a step FAILED, 2 usage,
 *       3 stopped, 4 aborted (not the test bed), 5 handoff (a dialog; owner hand).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runView } from "../../src/tools/wb-view.js";
import {
  allowListOf,
  loadAllowList,
  loadCatalog,
  loadRunAllowList,
  runPlugin,
  type CatalogRow,
} from "../../src/tools/wb-plugin.js";
import { readCurrentBuild } from "../../src/gui/locators.js";
import { DEFAULT_CENSUS_ROOT } from "../../src/census/ledger-io.js";
import { loadConfig } from "../../src/config.js";
import { parseLogFile, resolveSession } from "../../src/logs/parser.js";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { UPDATE_BASELINE_FLAG, applyBaselineGuard } from "./baseline.js";
import { checkPlan, formatResult, type PlanAction } from "../../scripts/live/dry-run.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "../../scripts/live/evidence.js";
import { Lane } from "../../scripts/live/lane.js";
import { DEFAULT_PORT } from "../../scripts/live/netcall.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { lastLine, runPowerShell } from "../../scripts/live/powershell.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../scripts/live/s-c-natives.js";
import { WORKBENCH_EXE } from "../../scripts/live/launch.js";
import { defaultExec, processesByImage } from "../../scripts/live/win.js";
import {
  EXIT,
  StepCut,
  StopBattery,
  baselineRefusal,
  watched,
} from "../../scripts/census/live/common.js";
import { changedFiles, recordPath } from "./w2.live.js";
import { WATCH_OPTIONS, WORKBENCH_WINDOWS, carriesForceSettings } from "./w8.live.js";
import { RUN_ANSWERS } from "./w6.live.js";
import {
  GPROJ,
  LAUNCH_ARGS,
  SCRATCH_INI,
  SETTLE_BUDGET_MS,
  SETTLE_MS,
  SETTLE_POLLS,
  STOP_CODES,
  THROWAWAY,
  answerOf,
  handAnswer,
  resultTable,
  sameCoords,
  selectSteps,
  verdictOf,
} from "./w9.live.js";

export { EXIT, LAUNCH_ARGS, StopBattery, recordPath, RUN_ANSWERS, selectSteps };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W10";
export const SCRIPT_PATH = "tests/live/w10.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W10.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W10-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const NOISE_REL = "docs/v2/sessions/queues/w10-noise.json";
export const REVIEW_REL = "docs/v2/inbox/phase6/plugin-safety-review.md";
export const RUN_LIST_KEY = "plugin_run_allow_list";

export const GATE_STEP = "w10-00-gate";
export const WORLD_STEP = "w10-01-world";
export const RUNSET_STEP = "w10-10-runset";
export const NETZERO_STEP = "w10-95-netzero";
export const CLOSABLE_STEP = "w10-99-closable";

export const W10_ROOT = `${THROWAWAY}/W10`;
export const WORLDS_DIR = `${W10_ROOT}/worlds`;
export const WORLD = `${WORLDS_DIR}/EMCP_W10_Tiny.ent`;
export const PLANT_DIRS: readonly string[] = [W10_ROOT, WORLDS_DIR];
export const PLANT_FILE = "plant-w10.json";
export const RESULT_FILE = "w10-result.json";
export const BATTERY_SNAPSHOT_FILE = "w10-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w10-battery-snapshot";
/** Files whose change outside _throwaway/W10/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** The entity a World Editor class acts on: the throwaway world's first. */
export const SEED = "index:0";
/** New log lines kept in a step's evidence. */
export const LOG_KEEP = 40;

export const TIMEOUTS = {
  /** Per class: the set-up, two run calls, the polled reads and the put-backs. */
  plugin: 180_000,
  open: 600_000,
  poll: 5_000,
  ping: 10_000,
} as const;

/** Per-class step timeouts above TIMEOUTS.plugin (CheckRuin searches every addon by default). */
export const SLOW_CLASSES: Readonly<Record<string, number>> = {
  SCR_CheckRuinModelsAndUsagePlugin: 600_000,
};

/** What a run of the class is expected to show (plugin-safety-review.md, its hand reading). */
export type Effect = "camera" | "log" | "answer";
export const EXPECTED_EFFECT: Readonly<Record<string, Effect>> = {
  CameraOrientationTool: "camera",
  SCR_CheckRuinModelsAndUsagePlugin: "log",
  // LocLength prints only texts over the limit, and LocStatus prints nothing: the answer only.
  SCR_LocLengthPlugin: "answer",
  SCR_LocStatusPlugin: "answer",
};

export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W10.2"]);

// ── Types ────────────────────────────────────────────────────────────────────

export type W10Tool = "wb_plugin" | "wb_module" | "wb_world" | "wb_view";
export type Block = "W10.0" | "W10.1" | "W10.2" | "W10.9";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED";

/** One class of the run set: an allow-list entry joined to its catalog row. */
export interface PluginRun {
  module: string;
  className: string;
  rowId: string;
  label: string;
  kind: "plugin" | "tool";
}

export interface RunSet {
  runs: PluginRun[];
  /** Allow-list entries the battery refuses to drive, with the reason. */
  refused: Array<{ module: string; className: string; why: string }>;
}

export interface ToolResponse {
  ok: boolean;
  action?: string;
  target?: string;
  code?: string;
  message?: string;
  readback?: unknown;
  warnings?: string[];
  [extra: string]: unknown;
}

export interface StepOutcome {
  status: Verdict;
  detail: string;
  evidence: Record<string, unknown>;
  results?: { file: string; lines: Raw[] };
}

export interface StepRecord {
  step: string;
  block: Block;
  title: string;
  status: RecordStatus;
  detail: string;
  startedAt: string;
  endedAt: string;
  evidence: Record<string, unknown>;
  evidenceId?: string | null;
  stop?: string;
}

/** One parsed log line as the battery keeps it. */
export interface LogEntry {
  raw: string;
  level?: string;
}

export interface W10Deps {
  tool: (name: W10Tool, args: Raw) => Promise<ToolResponse>;
  info: () => Promise<Raw | null>;
  ping: () => Promise<Raw | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  commandLine: (pid: number) => Promise<string | null>;
  /** console.log of the newest Workbench log session, parsed; null when there is none. */
  logLines: () => LogEntry[] | null;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W10Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

export interface StepContext {
  deps: W10Deps;
  opts: W10Options;
  calls: Array<Record<string, unknown>>;
  tool: (name: W10Tool, args: Raw, o?: { tolerate?: boolean }) => Promise<ToolResponse>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

export interface StepDef {
  id: string;
  block: Block;
  title: string;
  risk: Risk;
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  writes: string[];
  expectsWindows?: readonly RegExp[];
  plan: () => PlanAction[];
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

type Raw = Record<string, unknown>;

// ── Small helpers ────────────────────────────────────────────────────────────

function S(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

function rb(r: ToolResponse | null | undefined): Raw {
  return r && r.readback && typeof r.readback === "object" ? (r.readback as Raw) : {};
}

function brief(r: ToolResponse | null | undefined): Raw | null {
  if (!r) return null;
  return r.ok
    ? { ok: true, readback: r.readback ?? null, warnings: r.warnings ?? [] }
    : { ok: false, code: r.code ?? null, message: r.message ?? null };
}

function why(r: ToolResponse): string {
  return `${S(r.action)}: ${S(r.code)} ${S(r.message)}`.trim();
}

function sha256(b: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(root: string, rel: string): string {
  return join(root, ...rel.split("/"));
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function readJson<T>(path: string, deps: Pick<W10Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W10Deps, "writeBytes">): void {
  deps.writeBytes(path, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8"));
}

/** The step id of a class: w10-2N-<class>, N its place in the run set. */
export function pluginStepId(p: PluginRun, i: number): string {
  return `w10-${20 + i}-${p.className.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
}

// ── The run set (offline: the policy and the census catalog) ─────────────────

/** The run allow-list joined to the catalog: what W10 drives, and what it refuses to. */
export function runSetOf(policy: unknown, catalog: readonly CatalogRow[]): RunSet {
  const out: RunSet = { runs: [], refused: [] };
  const seen = new Set<string>();
  for (const e of allowListOf(policy, RUN_LIST_KEY)) {
    const key = `${e.module}\u0000${e.className}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = catalog.find((c) => c.className === e.className);
    if (!row) {
      out.refused.push({ ...e, why: "no E03 catalog row of that class" });
      continue;
    }
    if (row.module !== e.module) {
      out.refused.push({ ...e, why: `the catalog puts the class in ${row.module}` });
      continue;
    }
    if (row.modal === "opens" || row.verdict === "modal") {
      out.refused.push({ ...e, why: "E03 marks the class modal (PLUGIN_MODAL)" });
      continue;
    }
    out.runs.push({
      module: e.module,
      className: e.className,
      rowId: row.id,
      label: row.label,
      kind: row.kind,
    });
  }
  return out;
}

let runSetCache: RunSet | null = null;
/** The run set from the committed policy and ledger (cached; the tests pass their own). */
export function loadRunSet(): RunSet {
  runSetCache ??= runSetOf(loadPolicy(), loadCatalog());
  return runSetCache;
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

export const ROUTE_OF: Readonly<Record<W10Tool, string>> = {
  wb_plugin: "EMCP_WB_Plugin",
  wb_module: "EMCP_WB_Module",
  wb_world: "EMCP_WB_World",
  wb_view: "EMCP_WB_View",
};

export function tc(
  tool: W10Tool,
  action: string,
  params: Raw = {},
  extra: { note?: string } = {},
): PlanAction {
  return {
    kind: "net-call",
    target: ROUTE_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: action,
    note: extra.note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

/** The tool actions the battery may send, per tool. */
export const ACTIONS_ALLOWED: Readonly<Record<W10Tool, ReadonlySet<string>>> = {
  wb_plugin: new Set(["run"]),
  wb_module: new Set(["open", "front", "setResource"]),
  wb_world: new Set(["state", "new", "register"]),
  wb_view: new Set(["selection", "select", "camera", "setCamera"]),
};

/** Tool actions that write a file (the harness test checks their paths). */
export const FILE_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  "wb_world.new",
  "wb_world.register",
]);

/**
 * The battery's own gate over the plan, beside checkPlan: only the allowed actions; every
 * wb_plugin run names a class of the run set; nothing saves, closes or reopens a world; a file
 * write lands under _throwaway/W10/; and the run allow-list holds no entry the battery refuses.
 */
export function w10PlanViolations(plan: PlanAction[], set: RunSet): string[] {
  const runs = new Set(set.runs.map((r) => `${r.module}\u0000${r.className}`));
  const out = set.refused.map(
    (r) => `${RUN_LIST_KEY} names ${r.module} ${r.className}: ${r.why} (refused, no step)`,
  );
  plan.forEach((a, i) => {
    if (a.kind !== "net-call" || typeof a.tool !== "string") return;
    const p = (a.params ?? {}) as Raw;
    const tool = a.tool as W10Tool;
    const where = `action ${i} (${S(a.step)} ${tool}.${S(a.toolAction)})`;
    const allowed = ACTIONS_ALLOWED[tool];
    if (!allowed) {
      out.push(`${where}: ${tool} is not a W10 tool`);
      return;
    }
    if (!allowed.has(S(a.toolAction))) out.push(`${where}: not an allowed ${tool} action`);
    if (tool === "wb_plugin" && !runs.has(`${S(p.moduleName)}\u0000${S(p.className)}`))
      out.push(`${where}: ${S(p.moduleName)} ${S(p.className)} is not in the run set`);
    if (tool === "wb_view" && a.toolAction === "select" && !["set", "clear"].includes(S(p.mode)))
      out.push(`${where}: wb_view select only sets or clears the selection`);
    if (
      FILE_WRITE_ACTIONS.has(`${tool}.${S(a.toolAction)}`) &&
      !S(p.path).startsWith(`${W10_ROOT}/`)
    )
      out.push(`${where}: writes outside ${W10_ROOT}/`);
    if (tool === "wb_module" && a.toolAction === "setResource" && S(p.target) !== `path:${WORLD}`)
      out.push(`${where}: setResource opens only the W10 world`);
  });
  return out;
}

// ── World, selection, camera, log helpers ────────────────────────────────────

async function openWorld(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; evidence: Raw; worldPath: string }> {
  if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)))
    return { ok: false, worldPath: "", evidence: { refused: `${rel} is not on disk` } };
  const open = await ctx.tool("wb_module", { action: "open", module: "WorldEditor" });
  const set = await ctx.tool("wb_module", {
    action: "setResource",
    module: "WorldEditor",
    target: `path:${rel}`,
  });
  const started = ctx.deps.now();
  let polls = 0;
  for (;;) {
    polls++;
    const st = await ctx.tool("wb_world", { action: "state" });
    const worldPath = S(rb(st).worldPath);
    const ready = st.ok && worldPath.toLowerCase().endsWith(rel.toLowerCase());
    if (ready || !set.ok || ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open)
      return {
        ok: ready,
        worldPath,
        evidence: { open: brief(open), setResource: brief(set), polls, worldPath },
      };
    await ctx.sleep(TIMEOUTS.poll);
  }
}

/** The W10 world on disk and registered (`wb_world new` when absent), then open. */
export async function ensureWorld(
  ctx: StepContext,
  evidence: Raw,
  fails: string[],
): Promise<boolean> {
  const st = await ctx.tool("wb_world", { action: "state" });
  if (st.ok && S(rb(st).worldPath).toLowerCase().endsWith(WORLD.toLowerCase())) {
    evidence.world = "already open";
    return true;
  }
  const present = ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD));
  evidence.worldPresent = present;
  if (!present) {
    const made = await ctx.tool("wb_world", { action: "new", path: WORLD, confirm: true });
    evidence.newConfirm = brief(made);
    if (!made.ok) {
      fails.push(`new: ${why(made)}`);
      return false;
    }
  }
  const reg = await ctx.tool("wb_world", { action: "register", path: WORLD });
  evidence.register = brief(reg);
  if (!reg.ok) {
    fails.push(`register: ${why(reg)}`);
    return false;
  }
  const o = await openWorld(ctx, WORLD);
  evidence.open = o.evidence;
  if (!o.ok) fails.push(`the W10 world did not open ('${o.worldPath}')`);
  return o.ok;
}

function worldPlan(): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc(
      "wb_world",
      "new",
      { path: WORLD, confirm: true },
      { note: "writes the throwaway world, when absent" },
    ),
    tc("wb_world", "register", { path: WORLD }),
    tc("wb_module", "open", { module: "WorldEditor" }),
    tc("wb_module", "setResource", { module: "WorldEditor", target: `path:${WORLD}` }),
    tc("wb_world", "state", {}, { note: "polled until worldPath names the world" }),
  ];
}

const idRef = (id: string): string => (/^(id|name|index):/.test(id) ? id : `id:${id}`);

async function readSelection(ctx: StepContext): Promise<string[] | null> {
  const r = await ctx.tool("wb_view", { action: "selection", limit: 200 });
  if (!r.ok) return null;
  const rows = Array.isArray(rb(r).rows) ? (rb(r).rows as Raw[]) : [];
  return rows.map((x) => S(x.id)).sort();
}

async function readCamera(ctx: StepContext): Promise<{ coords: string; direction: string } | null> {
  const r = await ctx.tool("wb_view", { action: "camera" });
  if (!r.ok) return null;
  return { coords: S(rb(r).coords), direction: S(rb(r).direction) };
}

/** A read polled until `done` holds (SETTLE_MS apart, at most SETTLE_POLLS, SETTLE_BUDGET_MS). */
async function pollRead<T>(
  ctx: StepContext,
  read: () => Promise<T | null> | T | null,
  done: (v: T) => boolean,
): Promise<T | null> {
  const started = ctx.deps.now();
  let v: T | null = null;
  for (let polls = 0; polls < SETTLE_POLLS; polls++) {
    await ctx.sleep(SETTLE_MS);
    v = await read();
    if (v !== null && done(v)) break;
    if (ctx.deps.now() - started >= SETTLE_BUDGET_MS) break;
  }
  return v;
}

// ── Snapshot and net-zero ────────────────────────────────────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W10/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W10Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W10_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W10Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
  takenBy: "gate" | "run start",
): boolean {
  const snap = join(sittingDir, BATTERY_SNAPSHOT_FILE);
  if (deps.exists(snap)) return false;
  const taken: BatterySnapshot = {
    kind: BATTERY_SNAPSHOT_KIND,
    taken_at: new Date(deps.now()).toISOString(),
    taken_by: takenBy,
    files: sandboxHashes(sandboxDir, deps),
  };
  writeJson(snap, taken, deps);
  return true;
}

export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W10Deps, "exists" | "readBytes" | "listTree">,
): { takenAt: string; changed: string[]; tolerated: string[] } | null {
  const snap = readJson<BatterySnapshot>(join(sittingDir, BATTERY_SNAPSHOT_FILE), deps);
  if (!snap || snap.kind !== BATTERY_SNAPSHOT_KIND || typeof snap.files !== "object") return null;
  const all = changedFiles(snap.files, sandboxHashes(sandboxDir, deps));
  const tolerated = all.filter((f) => NETZERO_TOLERATED.includes(basename(f)));
  return {
    takenAt: S(snap.taken_at),
    changed: all.filter((f) => !tolerated.includes(f)),
    tolerated,
  };
}

// ── Live result lines ────────────────────────────────────────────────────────

export type Oracle = "state-readback" | "log-line" | "returned-true-only";

export function liveResultLine(stepId: string, rowId: string, oracle: Oracle, date: string): Raw {
  return { live_result: { test: stepId, rows: [rowId], verdict: "pass", oracle, date } };
}

export function liveTestLine(stepId: string, rowId: string): Raw {
  return { id: rowId, tests: [{ id: stepId, file: SCRIPT_PATH, kind: "live" }] };
}

export function liveFileOf(stepId: string): string {
  return `w10-live-${stepId}.jsonl`;
}

// ── The plugin step ──────────────────────────────────────────────────────────

export interface PluginResult {
  className: string;
  dry: string;
  confirm: string;
  ran: boolean;
  dialog: string | null;
  logBefore: number | null;
  logNew: number | null;
  camera?: Raw;
  netZero: { changed: string[]; tolerated: string[] } | null;
  verdict: "PASS" | "NO-EFFECT" | "NOT-RUN" | "FAIL";
  oracle: Oracle | null;
  why: string;
}

/**
 * One class: the set-up, the log position, the dry run, the confirm only when the dry run is ok,
 * the dialog check, the new log lines, the put-backs, the net-zero check, the live result.
 */
export async function pluginStep(
  ctx: StepContext,
  p: PluginRun,
  stepId: string,
): Promise<StepOutcome> {
  const fails: string[] = [];
  const evidence: Raw = { className: p.className, module: p.module, row: p.rowId };
  const effect: Effect = EXPECTED_EFFECT[p.className] ?? "answer";
  const res: PluginResult = {
    className: p.className,
    dry: "not sent",
    confirm: "not sent",
    ran: false,
    dialog: null,
    logBefore: null,
    logNew: null,
    netZero: null,
    verdict: "NOT-RUN",
    oracle: null,
    why: "",
  };
  const lines: Raw[] = [];
  const done = (): StepOutcome => {
    evidence.result = res;
    if (res.verdict === "FAIL") fails.push(`${p.className}: ${res.why}`);
    const status: Verdict = fails.length ? "FAIL" : res.verdict === "NOT-RUN" ? "NOT-RUN" : "PASS";
    return {
      status,
      detail: fails.length ? fails.join("; ") : `${p.className}: ${res.verdict}, ${res.why}`,
      evidence,
      results: { file: liveFileOf(stepId), lines },
    };
  };

  // Set-up: the World Editor's classes act on one selected entity of the W10 world.
  let s0: string[] | null = null;
  let c0: { coords: string; direction: string } | null = null;
  const world = p.module === "WorldEditor";
  if (world) {
    if (!(await ensureWorld(ctx, evidence, fails))) {
      res.why = "the W10 world did not open: not run";
      return done();
    }
    s0 = await readSelection(ctx);
    evidence.selectionBefore = s0;
    const seed = await ctx.tool("wb_view", { action: "select", mode: "set", entities: [SEED] });
    evidence.seed = brief(seed);
    if (!seed.ok || Number(rb(seed).selectedCount) !== 1) {
      res.why = `no single entity at ${SEED} (select answered ${answerOf(seed)}): not run`;
      return putBack();
    }
    c0 = await readCamera(ctx);
    evidence.cameraBefore = c0;
  } else {
    evidence.open = brief(await ctx.tool("wb_module", { action: "open", module: p.module }));
    evidence.front = brief(await ctx.tool("wb_module", { action: "front", module: p.module }));
  }

  const before = ctx.deps.logLines();
  res.logBefore = before ? before.length : null;
  const base = { action: "run", moduleName: p.module, className: p.className };
  const dry = await ctx.tool("wb_plugin", base);
  res.dry = answerOf(dry);
  evidence.dry = brief(dry);
  if (dry.ok && truthy(rb(dry).ran)) {
    res.verdict = "FAIL";
    res.why = "the dry run ran the plugin";
  } else if (!dry.ok) {
    if (RUN_ANSWERS.has(S(dry.code))) res.why = `the dry run answered ${S(dry.code)}: not run`;
    else {
      res.verdict = "FAIL";
      res.why = `dry run: ${why(dry)}`;
    }
  } else {
    const conf = await ctx.tool("wb_plugin", { ...base, confirm: true });
    res.confirm = answerOf(conf);
    evidence.confirm = brief(conf);
    res.ran = conf.ok && truthy(rb(conf).ran);
    if (!conf.ok) {
      if (RUN_ANSWERS.has(S(conf.code))) res.why = `the confirm answered ${S(conf.code)}: not run`;
      else {
        res.verdict = "FAIL";
        res.why = `confirm: ${why(conf)}`;
      }
    } else if (!res.ran) res.why = "the confirm answered ok without ran: no live result";
  }

  // A dialog after the run is the owner's hand (the window watch hands it off too).
  const pid = ctx.deps.recordedPid();
  if (res.ran && pid !== null) {
    res.dialog = baselineRefusal(await ctx.deps.windows(), pid);
    if (res.dialog) throw new StopBattery("handoff", `${p.className}: ${res.dialog}`, evidence);
  }

  if (res.ran && before) {
    const after =
      effect === "log"
        ? await pollRead(
            ctx,
            () => ctx.deps.logLines(),
            (l) => l.length > before.length,
          )
        : ctx.deps.logLines();
    const fresh = after ? after.slice(before.length) : [];
    res.logNew = after ? fresh.length : null;
    evidence.logLines = fresh.slice(0, LOG_KEEP).map((l) => l.raw);
  }

  let cameraMoved = false;
  if (world && c0) {
    const c1 = res.ran
      ? await pollRead(
          ctx,
          () => readCamera(ctx),
          (c) => !sameCoords(c.coords, c0!.coords),
        )
      : await readCamera(ctx);
    const cam: Raw = { before: c0, after: c1 };
    if (c1 && !sameCoords(c1.coords, c0.coords)) {
      cameraMoved = true;
      await ctx.tool("wb_view", { action: "setCamera", coords: c0.coords, look: c0.direction });
      const c2 = await readCamera(ctx);
      cam.restored = c2;
      if (!c2 || !sameCoords(c2.coords, c0.coords)) {
        res.verdict = "FAIL";
        res.why = "the camera moved; wb_view setCamera did not put it back";
      }
    }
    res.camera = cam;
  }
  return putBack(cameraMoved);

  async function putBack(cameraMoved = false): Promise<StepOutcome> {
    if (world && s0 !== null) {
      const put = await ctx.tool(
        "wb_view",
        s0.length
          ? { action: "select", mode: "set", entities: s0.map(idRef) }
          : { action: "select", mode: "clear" },
      );
      const back = await readSelection(ctx);
      evidence.selectionAfter = back;
      if (!put.ok || back === null || back.join("\n") !== s0.join("\n"))
        fails.push(
          `the selection was not put back (${s0.length ? `${s0.length} selected` : "nothing selected"} when found)`,
        );
    }
    const diff = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
    res.netZero = diff ? { changed: diff.changed, tolerated: diff.tolerated } : null;
    if (!diff) fails.push(`no ${BATTERY_SNAPSHOT_FILE}`);
    else if (diff.changed.length)
      fails.push(`changed outside ${W10_ROOT}/ after the run: ${diff.changed.join(", ")}`);
    if (res.ran && res.verdict !== "FAIL" && !fails.length) {
      if (effect === "camera" && !cameraMoved) {
        res.verdict = "NO-EFFECT";
        res.why = "ran; the camera did not move (no live result)";
      } else if (effect === "log" && !res.logNew) {
        res.verdict = "NO-EFFECT";
        res.why = `ran; no new log line read (${res.logNew === null ? "no log session" : "none"}; no live result)`;
      } else {
        res.verdict = "PASS";
        res.oracle = cameraMoved
          ? "state-readback"
          : res.logNew
            ? "log-line"
            : "returned-true-only";
        res.why = `ran, no dialog, the sandbox unchanged; oracle ${res.oracle}${res.logNew ? ` (${res.logNew} new log line(s))` : ""}`;
        const date = new Date(ctx.deps.now()).toISOString().slice(0, 10);
        lines.push(
          liveTestLine(stepId, p.rowId),
          liveResultLine(stepId, p.rowId, res.oracle, date),
        );
      }
    }
    return done();
  }
}

function pluginPlan(p: PluginRun): PlanAction[] {
  const run = { moduleName: p.module, className: p.className };
  return [
    ...(p.module === "WorldEditor"
      ? [
          ...worldPlan(),
          tc("wb_view", "selection", { limit: 200 }, { note: "the selection, to put back" }),
          tc("wb_view", "select", { mode: "set", entities: [SEED] }, { note: "one entity" }),
          tc("wb_view", "camera", {}, { note: "the camera before" }),
        ]
      : [
          tc("wb_module", "open", { module: p.module }),
          tc("wb_module", "front", { module: p.module }),
        ]),
    tc("wb_plugin", "run", run, { note: "dry run: preconditions only" }),
    tc(
      "wb_plugin",
      "run",
      { ...run, confirm: true },
      { note: "only when the dry run answered ok; GATED until the handler's RunProven" },
    ),
    ...(p.module === "WorldEditor"
      ? [
          tc("wb_view", "camera", {}, { note: "the camera after (polled)" }),
          tc(
            "wb_view",
            "setCamera",
            { coords: "<before>", look: "<before>" },
            { note: "put back" },
          ),
          tc("wb_view", "camera", {}, { note: "the camera put back" }),
          tc("wb_view", "select", { mode: "set", entities: ["<before>"] }, { note: "put back" }),
          tc("wb_view", "selection", { limit: 200 }, { note: "the selection put back" }),
        ]
      : []),
  ];
}

function pluginStepDef(p: PluginRun, i: number): StepDef {
  const id = pluginStepId(p, i);
  const effect = EXPECTED_EFFECT[p.className] ?? "answer";
  return {
    id,
    block: "W10.2",
    title: `${p.module} ${p.className} (${p.label}): log position, wb_plugin run (dry run, confirm when met), dialog check, new log lines, put-backs, sandbox net-zero`,
    risk: "reversible",
    timeout_ms: SLOW_CLASSES[p.className] ?? TIMEOUTS.plugin,
    expected: `the confirm answers ok with ran, no dialog, the sandbox unchanged outside ${W10_ROOT}/; the expected effect (${effect}) read; a live result naming ${p.rowId}`,
    kill_criterion:
      "PLUGIN_MODAL or an unexpected code: FAIL; a change outside the throwaway folder: FAIL, no live result; a dialog: HANDOFF; GATED / PRECONDITION_UNMET and the other run answers: NOT-RUN",
    side_effects: [
      p.module === "WorldEditor"
        ? "the selection and the editor camera changed and put back"
        : `the ${p.module} opened and fronted`,
      "log lines printed by the plugin",
    ],
    rollback:
      p.module === "WorldEditor"
        ? "wb_view setCamera and select put back the camera and the selection"
        : "none: the reviewed class changes no data (plugin-safety-review.md)",
    writes: p.module === "WorldEditor" ? [WORLD] : [],
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => pluginPlan(p),
    run: async (ctx) => pluginStep(ctx, p, id),
  };
}

// ── Gate, run set, net-zero, closable ────────────────────────────────────────

/** The test-bed gate: throws StopBattery on any miss. */
async function testBedGate(ctx: StepContext): Promise<StepOutcome> {
  const info = await ctx.deps.info();
  const projectName = info ? info.projectName : undefined;
  const found = truthy(info?.projectFound);
  const evidence: Raw = {
    projectFound: info?.projectFound ?? null,
    projectName: projectName ?? null,
  };
  // The test-bed check lives here, in the battery, never in a shipped handler (DEC-058).
  if (!found || projectName !== SANDBOX_NAME)
    throw new StopBattery(
      "aborted",
      `EMCP_WB_Info does not say projectFound with projectName ${SANDBOX_NAME}: not the live lane's test bed`,
      evidence,
    );
  const ping = await ctx.deps.ping();
  const stamp = S(ping?.buildStamp);
  const digest = ctx.deps.bundleDigest();
  evidence.stamp = stamp || null;
  evidence.digest = digest;
  if (!stamp || !digest || stamp !== digest)
    throw new StopBattery("stopped", "the build stamp does not match the bundle digest", evidence);
  const missing = PLANT_DIRS.filter((d) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, d)));
  evidence.planted = missing.length === 0;
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `the planted folder(s) ${missing.map((d) => `<sandbox>/${d}/`).join(", ")} are absent: run \`w10.live.ts plant\` first`,
      evidence,
    );
  const pid = ctx.deps.recordedPid();
  const cmd = pid === null ? null : await ctx.deps.commandLine(pid);
  const ini = join(ctx.opts.sittingDir, SCRATCH_INI);
  evidence.forceSettings = cmd === null ? "unread" : carriesForceSettings(cmd, ini);
  if (cmd === null || !carriesForceSettings(cmd, ini))
    throw new StopBattery(
      "stopped",
      `the Workbench process does not carry -forceSettings <sitting>/${SCRATCH_INI}: the registry would take its settings at exit`,
      evidence,
    );
  if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
    evidence.snapshotTaken = true;
  evidence.snapshot = BATTERY_SNAPSHOT_FILE;
  return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
}

/** The run set as the steps were built: what W10 drives and what it refused. */
export function runSetOutcome(set: RunSet): StepOutcome {
  const evidence: Raw = {
    key: RUN_LIST_KEY,
    runs: set.runs,
    refused: set.refused,
    review: REVIEW_REL,
  };
  if (set.refused.length)
    return {
      status: "FAIL",
      detail: `${RUN_LIST_KEY} names ${set.refused.length} class(es) W10 refuses: ${set.refused.map((r) => `${r.className} (${r.why})`).join("; ")}`,
      evidence,
    };
  return {
    status: "PASS",
    detail: set.runs.length
      ? `${set.runs.length} class(es) from ${RUN_LIST_KEY}: ${set.runs.map((r) => r.className).join(", ")}`
      : `${RUN_LIST_KEY} is empty: no plugin is driven (main's ruling, ${REVIEW_REL})`,
    evidence,
  };
}

async function netZero(ctx: StepContext): Promise<StepOutcome> {
  const fails: string[] = [];
  const evidence: Raw = {};
  const st = await ctx.tool("wb_world", { action: "state" });
  evidence.mode = rb(st).mode ?? null;
  evidence.worldPath = rb(st).worldPath ?? null;
  if (st.ok && S(rb(st).mode) && S(rb(st).mode) !== "edit")
    fails.push(`mode ${S(rb(st).mode)}, not edit`);
  const diff = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
  evidence.diff = diff;
  if (!diff) fails.push(`no ${BATTERY_SNAPSHOT_FILE}`);
  else if (diff.changed.length)
    fails.push(`changed outside ${W10_ROOT}/: ${diff.changed.join(", ")}`);
  return {
    ...verdictOf(fails, "net-zero: nothing changed outside the throwaway folder"),
    evidence,
  };
}

/** The last step, also run after a stop: Workbench left closable, the world never saved. */
export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st = await ctx.tool("wb_world", { action: "state" }, { tolerate: true });
  evidence.state = brief(st);
  if (st.ok && S(rb(st).mode) && S(rb(st).mode) !== "edit")
    fails.push(`mode ${S(rb(st).mode)}, not edit`);
  const pid = ctx.deps.recordedPid();
  const left = pid === null ? null : baselineRefusal(await ctx.deps.windows(), pid);
  evidence.dialog = left;
  if (left) fails.push(left);
  const open = S(rb(st).worldPath);
  return {
    ...verdictOf(
      fails,
      open
        ? `closable: ${open.toLowerCase().endsWith(WORLD.toLowerCase()) ? "the W10 world" : `'${open}'`} left open and untouched; never saved`
        : "closable: no world open",
    ),
    evidence,
  };
}

export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W10.9",
    title:
      "leave Workbench closable: the world left open and untouched (never saved, reopened or closed), no dialog up",
    risk: "reversible",
    timeout_ms: 60_000,
    expected:
      "edit mode, no dialog-like window; the post-flight WM_CLOSE exits without a save prompt",
    kill_criterion:
      "a dialog is left or the mode is not edit: FAIL (the runbook's hand answers a save prompt No)",
    side_effects: [],
    rollback: "none: nothing is edited",
    writes: [],
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [tc("wb_world", "state")],
    run: async (ctx) => leaveClosable(ctx),
  };
}

export function buildSteps(set: RunSet = loadRunSet()): StepDef[] {
  return [
    {
      id: GATE_STEP,
      block: "W10.0",
      title:
        "the test-bed gate: EMCP_WB_Info names EMCP2_sandbox, build stamp, plant, -forceSettings, sandbox snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; the planted folders on disk; the process carries -forceSettings <sitting>/${SCRATCH_INI}`,
      kill_criterion:
        "not the test bed: ABORTED, nothing else runs; a stamp mismatch, a missing plant or no -forceSettings: STOPPED",
      side_effects: [`<sitting>/${BATTERY_SNAPSHOT_FILE} written (first run of the sitting only)`],
      rollback: "none (reads; the snapshot is a file in the sitting folder)",
      writes: [],
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_Info" } as PlanAction,
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
      ],
      run: async (ctx) => testBedGate(ctx),
    },
    {
      id: WORLD_STEP,
      block: "W10.0",
      title: `the throwaway world ${WORLD}: wb_world new (when absent), register, open`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected: "the world is written under _throwaway/W10/, registered and open in edit mode",
      kill_criterion: "the world does not open: FAIL (each World Editor class ensures it again)",
      side_effects: [`${WORLD} and its .meta written under _throwaway/W10/`],
      rollback: "`w10.live.ts rollback` removes _throwaway/W10/ after Workbench is closed",
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => worldPlan(),
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        return { ...verdictOf(fails, `${WORLD} open`), evidence };
      },
    },
    {
      id: RUNSET_STEP,
      block: "W10.1",
      title: `the run set: policy ${RUN_LIST_KEY} joined to the census catalog (recorded; empty drives nothing)`,
      risk: "read-only",
      timeout_ms: 10_000,
      expected: `every ${RUN_LIST_KEY} entry is a catalog class of its module, not modal`,
      kill_criterion: "an entry W10 refuses: FAIL (the plan check fails first in a dry run)",
      side_effects: [],
      rollback: "none",
      writes: [],
      plan: () => [],
      run: async () => runSetOutcome(set),
    },
    ...set.runs.map(pluginStepDef),
    {
      id: NETZERO_STEP,
      block: "W10.9",
      title:
        "net-zero: the sandbox outside _throwaway/W10/ against the battery snapshot; edit mode",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "no file outside _throwaway/W10/ changed (resourceDatabase.rdb recorded, not failed)",
      kill_criterion: "a change outside the throwaway folder: FAIL",
      side_effects: [],
      rollback: "none",
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [tc("wb_world", "state")],
      run: async (ctx) => netZero(ctx),
    },
    closableStep(),
  ];
}

// ── Plan, outline, queue ─────────────────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: [...LAUNCH_ARGS],
    note: "performed by scripts/live/preflight.ts per the runbook, not by this script",
  } as PlanAction;
}

export function buildActionPlan(steps: StepDef[] = buildSteps()): PlanAction[] {
  const out: PlanAction[] = [launchAction()];
  for (const s of steps) for (const a of s.plan()) out.push({ ...a, step: s.id } as PlanAction);
  return out;
}

export function sessionOutline(
  steps: StepDef[] = buildSteps(),
  set: RunSet = loadRunSet(),
): string[] {
  return [
    `${SESSION}: plugins battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map((s) => `  [${s.block}] ${s.id} (${s.risk}): ${s.title}`),
    `  run set (${RUN_LIST_KEY}): ${set.runs.length ? set.runs.map((r) => `${r.module}/${r.className}`).join(", ") : "empty"}${set.refused.length ? `; refused ${set.refused.map((r) => r.className).join(", ")}` : ""}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w10.live.ts --emit-queue` from its step table; tests/live-harness/w10-battery.test.ts keeps this file equal (re-emit after policy plugin_run_allow_list changes). Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W10 sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [REVIEW_REL, "DEC-053", "DEC-058", "DEC-097", "P-W6-05", "PLAN 5.3"],
    launches: 1,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "pre-flight builds the real arguments; -scriptAuthorizeAll on the owner's standing go (DEC-053)",
    not_exercised: {},
    probes: steps.map((s) => ({
      id: s.id,
      launch: s.block,
      title: s.title,
      settles: [],
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
    })),
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

function makeCtx(
  deps: W10Deps,
  opts: W10Options,
  calls: Array<Record<string, unknown>>,
  abort: AbortController,
  onStop: (code: string) => void,
  guardOn: boolean,
): StepContext {
  const guard = (what: string): void => {
    if (guardOn && abort.signal.aborted) {
      calls.push({ notSent: what });
      throw new StepCut();
    }
  };
  return {
    deps,
    opts,
    calls,
    signal: abort.signal,
    sleep: async (ms) => {
      guard("sleep");
      await deps.sleep(ms);
      guard("sleep");
    },
    tool: async (name, args, o = {}) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.tool(name, args);
      calls.push({ tool: name, action: S(args.action), ok: r.ok, code: r.code ?? null });
      if (
        guardOn &&
        !r.ok &&
        STOP_CODES.has(S(r.code)) &&
        !(o.tolerate && r.code !== "MODAL_OPEN")
      ) {
        onStop(S(r.code));
        throw new StopBattery(
          r.code === "MODAL_OPEN" ? "handoff" : "stopped",
          `${name} ${S(args.action)} answered ${r.code}: ${r.message ?? ""}`,
        );
      }
      return r;
    },
  };
}

async function closeOutAfterStop(
  deps: W10Deps,
  opts: W10Options,
  write: (r: StepRecord) => void,
): Promise<void> {
  const def = closableStep();
  const startedAt = new Date(deps.now()).toISOString();
  const calls: Array<Record<string, unknown>> = [];
  const ctx = makeCtx(deps, opts, calls, new AbortController(), () => undefined, false);
  let out: StepOutcome;
  try {
    out = await def.run(ctx);
  } catch (e) {
    out = {
      status: "FAIL",
      detail: `the close-out threw: ${e instanceof Error ? e.message : String(e)}`,
      evidence: {},
    };
  }
  write({
    step: def.id,
    block: def.block,
    title: `${def.title} (after a stop)`,
    status: out.status,
    detail: out.detail,
    startedAt,
    endedAt: new Date(deps.now()).toISOString(),
    evidence: { ...out.evidence, calls },
  });
}

/** A FAIL unit: each plugin step is its own (one class's FAIL does not count toward the next's). */
function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? s.id : s.block;
}

export async function runBattery(
  steps: StepDef[],
  deps: W10Deps,
  opts: W10Options,
  all: StepDef[] = buildSteps(),
): Promise<BatteryReport> {
  const records: StepRecord[] = [];
  const write = (r: StepRecord, results?: StepOutcome["results"]): void => {
    const path = recordPath(opts.runDir, r.step);
    let evidenceId: string | null = null;
    if (opts.evidenceDir) {
      deps.writeBytes(
        path,
        Buffer.from(toPlaceholders(JSON.stringify(r, null, 2), opts.ph) + "\n", "utf-8"),
      );
      evidenceId = writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${r.step}`,
          build: opts.build,
          result_summary: `${r.step}: ${r.status} - ${r.detail}`.slice(0, 2000),
          artifacts: [path],
        },
        opts.ph,
      ).record.id;
    }
    const clean = JSON.parse(
      toPlaceholders(JSON.stringify({ ...r, evidenceId }), opts.ph),
    ) as StepRecord;
    deps.writeBytes(path, Buffer.from(JSON.stringify(clean, null, 2) + "\n", "utf-8"));
    if (results) {
      const lines = results.lines.map((l) => {
        const lr = l.live_result as Raw | undefined;
        return JSON.stringify(
          lr && evidenceId ? { live_result: { ...lr, evidence: evidenceId } } : l,
        );
      });
      deps.writeBytes(
        join(opts.sittingDir, results.file),
        Buffer.from(lines.join("\n") + (lines.length ? "\n" : ""), "utf-8"),
      );
    }
    records.push(clean);
    writeResult(opts, deps, all);
  };
  if (steps.length && steps[0]!.id !== GATE_STEP)
    ensureBatterySnapshot(opts.sittingDir, opts.sandboxDir, deps, "run start");
  let consecutiveFails = 0;
  let failUnit = "";
  for (const s of steps) {
    const unit = failUnitOf(s);
    if (unit !== failUnit) {
      consecutiveFails = 0;
      failUnit = unit;
    }
    if (deps.exists(recordPath(opts.runDir, s.id)))
      return {
        exit: EXIT.refused,
        records,
        stoppedAt: s.id,
        message: `${s.id} already has a record in this run folder: a step is never run twice (plan 5.3)`,
      };
    const startedAt = new Date(deps.now()).toISOString();
    const base = { step: s.id, block: s.block, title: s.title, startedAt };
    deps.log(`step ${s.id}: ${s.title}`);
    const calls: Array<Record<string, unknown>> = [];
    const abort = new AbortController();
    let clientStop: string | null = null;
    const ctx = makeCtx(deps, opts, calls, abort, (c) => (clientStop = c), true);
    try {
      const pid = deps.recordedPid();
      if (pid === null)
        throw new StopBattery(
          "stopped",
          "the lane recorded no Workbench pid: run the pre-flight first",
        );
      const w = await watched(deps, pid, s.expectsWindows, abort, () => s.run(ctx), WATCH_OPTIONS);
      const out = w.value;
      if (w.added.length)
        out.evidence.windowsAdded = w.added.map((x) => ({
          className: x.className,
          title: x.title,
        }));
      write(
        {
          ...base,
          status: out.status,
          detail: out.detail,
          endedAt: new Date(deps.now()).toISOString(),
          evidence: { ...out.evidence, calls },
        },
        out.results,
      );
      consecutiveFails = out.status === "FAIL" ? consecutiveFails + 1 : 0;
      if (consecutiveFails >= 3) {
        if (s.id !== CLOSABLE_STEP) await closeOutAfterStop(deps, opts, write);
        return {
          exit: EXIT.stopped,
          records,
          stoppedAt: s.id,
          message: "three consecutive unexpected failures: the battery stops",
        };
      }
    } catch (e) {
      const stop = e instanceof StopBattery ? e : null;
      const kind = stop?.kind ?? "stopped";
      const message = e instanceof Error ? e.message : String(e);
      const dialog = kind === "handoff" || clientStop === "MODAL_OPEN";
      const wedged = clientStop === "WEDGED" || clientStop === "LOST";
      const hand = kind === "handoff" ? handAnswer(message, s.id) : null;
      write({
        ...base,
        status: kind === "aborted" ? "ABORTED" : kind === "handoff" ? "HANDOFF" : "STOPPED",
        detail: hand ? `${message}; ${hand.instruction}` : message,
        endedAt: new Date(deps.now()).toISOString(),
        evidence: {
          ...(stop?.evidence ?? {}),
          ...(hand ? { handAnswer: hand } : {}),
          cut: abort.signal.aborted,
          calls,
        },
        stop: message,
      });
      if (
        !dialog &&
        !wedged &&
        kind !== "aborted" &&
        s.id !== CLOSABLE_STEP &&
        !deps.exists(recordPath(opts.runDir, CLOSABLE_STEP))
      )
        await closeOutAfterStop(deps, opts, write);
      return {
        exit: kind === "aborted" ? EXIT.aborted : kind === "handoff" ? EXIT.handoff : EXIT.stopped,
        records,
        stoppedAt: s.id,
        message: hand ? `${message}; ${hand.instruction}` : message,
      };
    }
  }
  const failed = records.some((r) => r.status === "FAIL");
  return {
    exit: failed ? EXIT.refused : EXIT.done,
    records,
    stoppedAt: null,
    message: failed ? "a step FAILED (see the table)" : null,
  };
}

function runDirsOf(opts: W10Options, deps: Pick<W10Deps, "listTree">): string[] {
  const runs = new Set(
    deps
      .listTree(opts.sittingDir)
      .filter((f) => f.includes("/"))
      .map((f) => f.split("/")[0]!),
  );
  return [...runs].sort().map((r) => join(opts.sittingDir, r));
}

/** `<sitting>/w10-result.json`: every step's latest record across the sitting's run folders. */
export function writeResult(
  opts: W10Options,
  deps: Pick<W10Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  for (const dir of runDirsOf(opts, deps)) {
    for (const s of steps) {
      const r = readJson<StepRecord>(recordPath(dir, s.id), deps);
      if (r) latest.set(s.id, { ...r, runDir: basename(dir) });
    }
  }
  const value = {
    session: SESSION,
    script: SCRIPT_PATH,
    build: opts.build,
    updated_at: new Date().toISOString(),
    steps: steps.map((s) => {
      const r = latest.get(s.id);
      return r
        ? {
            id: s.id,
            status: r.status,
            detail: r.detail,
            run: r.runDir,
            evidenceId: r.evidenceId ?? null,
          }
        : { id: s.id, status: "NOT-RUN", detail: "no record in this sitting" };
    }),
    live_results: steps.filter((s) => s.block === "W10.2").map((s) => liveFileOf(s.id)),
  };
  const clean = JSON.parse(toPlaceholders(JSON.stringify(value), opts.ph)) as unknown;
  writeJson(join(opts.sittingDir, RESULT_FILE), clean, deps);
}

// ── Offline subcommands: plant and rollback ──────────────────────────────────

export interface OfflineIo {
  workbenchPids: () => number[];
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
  listTree: (p: string) => string[];
  readBytes: (p: string) => Buffer;
  writeBytes: (p: string, b: Buffer) => void;
  removeTree: (p: string) => void;
  makeDir: (p: string) => void;
  log: (l: string) => void;
}

/** `plant`: the folders under _throwaway/W10/ (no Workbench running); the world is written live by w10-01. */
export function runPlant(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  for (const d of PLANT_DIRS) io.log(`plant: folder <sandbox>/${d}/`);
  io.log(`plant: record <sitting>/${PLANT_FILE}`);
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the plant is offline`);
    return EXIT.refused;
  }
  if (io.exists(abs(sandboxDir, W10_ROOT))) {
    io.log(`refused: <sandbox>/${W10_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const record = {
    kind: "w10-plant",
    dirs: [...PLANT_DIRS],
    throwawayExistedBefore: io.exists(abs(sandboxDir, THROWAWAY)),
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  for (const d of PLANT_DIRS) {
    io.makeDir(abs(sandboxDir, d));
    io.log(`made <sandbox>/${d}/`);
  }
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W10/; `_throwaway/` only when empty and absent before the plant. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W10_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W10_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W10_ROOT}/ (${files.length} files)`);
  if (!really) {
    io.log("dry run: nothing removed");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return EXIT.refused;
  }
  const listing = files.map((rel) => ({
    rel,
    sha256: sha256(io.readBytes(join(dir, ...rel.split("/")))),
  }));
  io.writeBytes(
    join(sittingDir, "throwaway-w10-listing.json"),
    Buffer.from(JSON.stringify(listing, null, 2) + "\n"),
  );
  io.removeTree(dir);
  let plant: { throwawayExistedBefore?: boolean } | null = null;
  try {
    plant = JSON.parse(io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8")) as {
      throwawayExistedBefore?: boolean;
    };
  } catch {
    plant = null;
  }
  const top = abs(sandboxDir, THROWAWAY);
  if (plant?.throwawayExistedBefore === false && io.exists(top) && io.listDir(top).length === 0)
    io.removeTree(top);
  io.log(`removed <sandbox>/${W10_ROOT}/ (listing in throwaway-w10-listing.json)`);
  return EXIT.done;
}

// ── Real dependencies ────────────────────────────────────────────────────────

function listTreeOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      let isDir: boolean;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(p, r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

function workbenchPidsReal(): number[] {
  return processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid);
}

const COMMAND_LINE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$env:EMCP_PID)',
  "if ($p) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$p.CommandLine)) }",
].join("\n");

/** console.log of the newest log session under the configured logs root. */
export function consoleLogOf(logsRoot: string): LogEntry[] | null {
  const s = resolveSession(logsRoot, "latest");
  if (!s) return null;
  return parseLogFile(join(s.absPath, "console.log")).map((l) => ({ raw: l.raw, level: l.level }));
}

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W10Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const root = artifactsDir();
  const logsRoot = loadConfig().logsPath;
  const pluginDeps = {
    client,
    catalog: () => loadCatalog(),
    allowList: () => loadAllowList(),
    runAllowList: () => loadRunAllowList(),
  };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  return {
    tool: async (name, args) => {
      try {
        switch (name) {
          case "wb_plugin":
            return asResp(await runPlugin(args, pluginDeps));
          case "wb_module":
            return asResp(await runModule(client, args as unknown as ModuleArgs));
          case "wb_world":
            return asResp(
              await runWorld(client, args, { projectRoot: input.sandboxDir, artifactsRoot: root }),
            );
          case "wb_view":
            return asResp(await runView(client, args));
          default:
            return {
              ok: false,
              code: "INVALID_ARGUMENT",
              message: `${String(name)} is not a W10 tool`,
            };
        }
      } catch (e) {
        if (e instanceof WorkbenchError) return { ok: false, code: e.code, message: e.message };
        return {
          ok: false,
          code: "HANDLER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
    info: async () => {
      try {
        return (await client.probe("EMCP_WB_Info", {}, { timeout: 10_000 })) as Raw;
      } catch {
        return null;
      }
    },
    ping: async () => {
      try {
        return (await client.probe("EMCP_WB_Ping", {}, { timeout: TIMEOUTS.ping })) as Raw;
      } catch {
        return null;
      }
    },
    bundleDigest: () => bundleDigest(),
    windows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    recordedPid: () => input.lane.recordedPid(),
    commandLine: async (pid) => {
      const r = await runPowerShell(COMMAND_LINE_SCRIPT, {
        timeoutMs: 30_000,
        env: { EMCP_PID: String(pid) },
      });
      const b64 = lastLine(r.stdout);
      return r.ok && b64 ? Buffer.from(b64.trim(), "base64").toString("utf-8") : null;
    },
    logLines: () => consoleLogOf(logsRoot),
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    exists: (p) => existsSync(p),
    listTree: listTreeOf,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
  };
}

function realOfflineIo(): OfflineIo {
  return {
    workbenchPids: workbenchPidsReal,
    exists: (p) => existsSync(p),
    listDir: (p) => readdirSync(p),
    listTree: listTreeOf,
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    removeTree: (p) => rmSync(p, { recursive: true, force: false }),
    makeDir: (p) => mkdirSync(p, { recursive: true }),
    log: (l) => console.log(l),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "id",
  "sandbox",
  "run-dir",
  "sitting-dir",
  "from",
  "until",
  "only",
  "port",
  "evidence-dir",
  "lease-path",
  "marker-path",
  "build",
] as const;
const FLAGS = ["really", "update-baseline"] as const;
const SUBCOMMANDS = ["plant", "rollback"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  /** The run set (the tests'); else from the policy given or the committed one. */
  runSet?: RunSet;
  deps?: W10Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
}

/** The dry-run gate: the plan against the policy, the W10 plan check and the queue. */
export function dryRunCheck(
  policy: CensusPolicy,
  set: RunSet = loadRunSet(),
): { ok: boolean; lines: string[] } {
  const steps = buildSteps(set);
  const plan = buildActionPlan(steps);
  const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
  const lines = [formatResult(check)];
  const own = w10PlanViolations(plan, set);
  lines.push(
    own.length
      ? `W10 plan check: FAIL\n${own.map((v) => `  ${v}`).join("\n")}`
      : "W10 plan check: PASS",
  );
  let queueOk = true;
  try {
    const q = validateQueue(buildQueue(steps), false);
    lines.push(`queue: ${q.length} probes valid`);
  } catch (e) {
    queueOk = false;
    lines.push(`queue: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: check.ok && own.length === 0 && queueOk, lines };
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  const sub = (SUBCOMMANDS as readonly string[]).includes(argv[0] ?? "")
    ? (argv[0] as (typeof SUBCOMMANDS)[number])
    : null;
  let args;
  try {
    args = parseArgs(sub ? argv.slice(1) : argv, VALUED);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const unknown = [...args.flags].filter((f) => !(FLAGS as readonly string[]).includes(f));
  if (unknown.length) {
    say(`unknown option(s): ${unknown.map((f) => `--${f}`).join(", ")}`);
    return EXIT.usage;
  }
  const o = args.options;
  const really = args.flags.has("really");

  const laneGate = (): { lane: Lane | null; refusal: string | null; code: number } => {
    if (!o.id) return { lane: null, refusal: "--really needs --id <lane id>", code: EXIT.usage };
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    const gate = liveGateReason({
      really,
      platform: over.platform ?? process.platform,
      leaseHeld: over.leaseHeld ?? lane.holdsLease(),
    });
    return { lane, refusal: gate, code: EXIT.refused };
  };

  if (sub) {
    if (!o.sandbox || basename(resolve(o.sandbox)) !== SANDBOX_NAME || !o["sitting-dir"]) {
      say(`${sub} needs --sandbox <the test bed folder ${SANDBOX_NAME}> and --sitting-dir <dir>`);
      return EXIT.usage;
    }
    if (really) {
      const g = laneGate();
      if (g.refusal) {
        say(g.refusal);
        return g.code;
      }
    }
    const io = {
      ...(over.offlineIo ?? realOfflineIo()),
      log: (l: string) => say(toPlaceholders(l, ph)),
    };
    return sub === "plant"
      ? runPlant(resolve(o.sandbox), resolve(o["sitting-dir"]), really, io)
      : runRollback(resolve(o.sandbox), resolve(o["sitting-dir"]), really, io);
  }

  const policy = over.policy ?? loadPolicy();
  const set = over.runSet ?? (over.policy ? runSetOf(policy, loadCatalog()) : loadRunSet());
  const steps = buildSteps(set);
  const plan = buildActionPlan(steps);
  const dry = dryRunCheck(policy, set);
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps, set).join("\n") + "\n", "utf-8");
  if (o["emit-queue"])
    writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
  if (!really) {
    for (const l of sessionOutline(steps, set)) say(l);
    for (const l of dry.lines) say(l);
    return dry.ok ? EXIT.done : EXIT.refused;
  }
  if (!dry.ok) {
    for (const l of dry.lines) say(l);
    return EXIT.refused;
  }
  const selected = selectSteps(steps as never, { from: o.from, only: o.only, until: o.until }) as
    | StepDef[]
    | string;
  if (typeof selected === "string") {
    say(selected);
    return EXIT.usage;
  }
  if (!o.id || !o.sandbox || !o["sitting-dir"]) {
    say("--really needs --id <lane id>, --sandbox <the test bed folder> and --sitting-dir <dir>");
    return EXIT.usage;
  }
  if (basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    say(`aborted: --sandbox must be the live lane's test bed ${SANDBOX_NAME}`);
    return EXIT.aborted;
  }
  const g = laneGate();
  if (g.refusal) {
    say(g.refusal);
    return g.code;
  }
  const sittingDir = resolve(o["sitting-dir"]);
  const runDir = resolve(
    o["run-dir"] ?? join(sittingDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`),
  );
  if (dirname(runDir) !== sittingDir) {
    say(`--run-dir must lie directly in ${sittingDir}`);
    return EXIT.usage;
  }
  mkdirSync(runDir, { recursive: true });
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  let deps = over.deps;
  if (!deps) {
    deps = realDeps({ port, lane: g.lane!, sandboxDir: resolve(o.sandbox) });
    g.lane!.startHeartbeat();
  }
  try {
    const r = await runBattery(
      selected,
      deps,
      {
        runDir,
        sittingDir,
        sandboxDir: resolve(o.sandbox),
        evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
        ph: { ...ph, sandbox: resolve(o.sandbox) },
        build: o.build ?? readCurrentBuild(DEFAULT_CENSUS_ROOT) ?? "unrecorded",
      },
      steps,
    );
    for (const l of resultTable(r.records as never)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w10",
      sittingDir,
      resultFile: RESULT_FILE,
      update: args.flags.has(UPDATE_BASELINE_FLAG),
      exitDone: EXIT.done,
      exitRefused: EXIT.refused,
    }))
      say(toPlaceholders(l, ph));
    if (r.message)
      say(
        toPlaceholders(
          `${r.exit === EXIT.handoff ? "HANDOFF" : r.exit === EXIT.done ? "DONE" : r.stoppedAt ? "STOPPED" : "FAILED"}: ${r.message}`,
          ph,
        ),
      );
    say(toPlaceholders(`run folder: ${runDir}; result: ${join(sittingDir, RESULT_FILE)}`, ph));
    return r.exit;
  } finally {
    g.lane?.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}

// Census rows this file tests once main rules them onto policy plugin_run_allow_list (the (a) set
// proposed in docs/v2/inbox/phase6/plugin-safety-review.md); a live result names each one that
// passes, and promote.ts needs the row named here for its live test link. A class main rules in
// that is not listed here needs its line added before its result is promoted.
// census:plugin:CameraOrientationTool
// census:plugin:SCR_CheckRuinModelsAndUsagePlugin
// census:plugin:SCR_LocLengthPlugin
// census:plugin:SCR_LocStatusPlugin
