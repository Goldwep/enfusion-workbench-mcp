/**
 * Wave W1 (World Editor core), the live battery (docs/v2/design/phase5-w1-spec.md section 6, DEC-061).
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch profile with `-scriptAuthorizeAll` (DEC-053 ruling 2, the standing go), with the
 * shipped bundle installed and NO probe pack. This script never launches, never takes the lease for
 * itself (the lane given with --id holds it) and reaches Workbench through the shipped TS tools run
 * IN PROCESS (`runEntity`, `runView`, `runWorld`, `runContainer`, `runLayers`, `runTerrain`,
 * `runPrefabs`, `runModule`) over a `WorkbenchClient` WITHOUT a Config (no lease, no auto-launch, no
 * handler recovery), so each step tests the TS mapping and the handler together. Undo goes through
 * the shipped `EMCP_WB_EditorControl {action: "undo"}` (Edit > Undo, policy execute_action allow-list),
 * as S-E's se-09 did.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan and the queue with preflight's validateQueue; `--out` writes
 * the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/W1-queue.json;
 * a test keeps the two equal). The runbook is docs/v2/sessions/queues/W1.md.
 *
 * Blocks, in the order of the spec's section 6 (one launch; each block is ordered read-only,
 * reversible, mutating for the queue):
 *   W1.0 setup     the test-bed gate (EMCP_WB_Info names EMCP2_sandbox, build stamp), the sandbox
 *                  snapshot, the fixture world written by `wb_world new` under _throwaway/W1/ and
 *                  opened with `wb_module setResource`
 *   W1.1 read      section 6 item 1: read-only reads on the fixture, plus the 1.x alias reads (item 6)
 *   W1.2 memory    item 2: in-memory edits, each followed by its undo check; the world is never saved
 *   W1.3 files     item 3: file writes under _throwaway/W1/ only
 *   W1.4 terrain   item 4: vanilla worlds/Arland/EmptyArland.ent opened read-only, never saved (OD-5)
 *   W1.7 settle    session 023: the observations that settle the probes run 4 left PARTIAL. Hand
 *                  steps first (the main session's hand answers a request file in the run folder:
 *                  a mouse position, the hierarchy panel, the viewport), then throwaway worlds under
 *                  _throwaway/W1/ that are SAVED (wb_world saveAs of the open throwaway world) and
 *                  read back from the reopened copy, the prefab member round trip and an exact diff
 *                  of the container path writes. Placed before W1.5 so play stays the last edit.
 *   W1.5 play     item 5: play, state, stop (stop guaranteed in a finally path), playEvents
 *   W1.6 net-zero  item 6: the sandbox outside _throwaway/W1/ hashed against the gate's snapshot
 * Everything under _throwaway/W1/ (plant, fixture, copies, prefabs, .meta files) is removed by this
 * script's `rollback` subcommand once Workbench is closed: deleting a registered or open resource
 * while Workbench runs is not done.
 *
 * Stop rules: a dialog-like window already up refuses the step; the pid's windows are polled while a
 * step runs (scripts/census/live/common.ts `watched`): a new dialog-like or disabled window is a
 * HANDOFF, any other new window a STOP, and the first verdict cuts the step (its next call throws);
 * busy windows alone (the play-mode transition, a world load) are waited out under WATCH_OPTIONS'
 * grace.
 * A LOST, WEDGED or MODAL_OPEN client error stops the battery; three consecutive unexpected FAILs
 * stop it. A stop undoes what the current step left on the undo stack and deletes the W1_ entities
 * it made, unless a dialog is up or the client is LOST or WEDGED (then nothing more is sent and the debt is
 * recorded). A mutating call is never retried. A probe whose kill criterion is met is recorded
 * KILLED with the observed value; steps that depend on it are SKIPPED with that reason.
 *
 * Usage:
 *   npx --no tsx tests/live/w1.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w1.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w1.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w1.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
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
import { loadConfig } from "../../src/config.js";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runView } from "../../src/tools/wb-view.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runLayers } from "../../src/tools/wb-layers.js";
import { OTHER_TOOL_ACTIONS, runTerrain } from "../../src/tools/wb-terrain.js";
import { registerTerrainInspect } from "../../src/tools/terrain-inspect.js";
import { registerTerrainNavmeshStatus } from "../../src/tools/terrain-navmesh-status.js";
import { registerTerrainRoadExportGraph } from "../../src/tools/terrain-road-export-graph.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPrefabs } from "../../src/tools/wb-prefabs.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
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
import { runPowerShell } from "../../scripts/live/powershell.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../scripts/live/s-c-natives.js";
import { WORKBENCH_EXE } from "../../scripts/live/launch.js";
import { defaultExec, processesByImage } from "../../scripts/live/win.js";
import {
  BUSY_GRACE_MS,
  EXIT,
  StepCut,
  StopBattery,
  watched,
  type VerdictOptions,
} from "../../scripts/census/live/common.js";

export { EXIT, StopBattery };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W1";
/** The last step; the runner also runs it after a stop (not after a dialog, LOST or WEDGED). */
export const CLOSABLE_STEP = "w1-95-closable";

/**
 * The window watch of every step (W1 cold run fix-up, W4's and W8's treatment). The cold run
 * (1.9.0.37) handed off w1-60-play on the World Editor window and the main window, both disabled,
 * owner 0, no window added: the play-mode entry transient. Afterwards no dialog was on screen and
 * Workbench was back in edit mode. Those are busy windows (isBusyWindow); the grace (busyGraceMs)
 * waits them out for at most BUSY_GRACE_MS, re-checks at the step's end, and is a handoff past it.
 * An owned window, a #32770, a known modal title or an unexpected window beside them is still a
 * verdict at once.
 */
export const WATCH_OPTIONS: VerdictOptions = { popups: false, busyGraceMs: BUSY_GRACE_MS };
export const SCRIPT_PATH = "tests/live/w1.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W1.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W1-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));

/** The one switch the launch carries, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<sitting>/w1-scratch.ini",
  SAA,
];

/** Every file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W1_ROOT = `${THROWAWAY}/W1`;
export const WORLDS_DIR = `${W1_ROOT}/worlds`;
export const FIXTURE_NAME = "EMCP_W1_Tiny";
export const FIXTURE_WORLD = `${WORLDS_DIR}/${FIXTURE_NAME}.ent`;
export const DUP_WORLD = `${WORLDS_DIR}/EMCP_W1_Dup.ent`;
export const SAVEAS_WORLD = `${WORLDS_DIR}/EMCP_W1_SaveAs.ent`;
export const PREFABS_DIR = `${W1_ROOT}/prefabs`;
export const TEMPLATE_ET = `${PREFABS_DIR}/EMCP_W1_Template.et`;
export const CLONE_ET = `${PREFABS_DIR}/EMCP_W1_Clone.et`;
export const CHILD_ET = `${PREFABS_DIR}/EMCP_W1_Child.et`;
/** The planted .conf copy (train2's U16 known-good source, vanilla inputCommon.conf). */
export const VANILLA_CONF = "configs/inputCommon.conf";
export const PLANT_CONF = `${W1_ROOT}/conf/inputCommon.conf`;
/** describe page columns w1-40 asks for (wb-container COLUMNS: path and objectClass are not default). */
export const DESCRIBE_FIELDS = "path,name,type,set,objectClass,value";
export const PLANT_FILE = "plant-w1.json";
/**
 * The runbook's name for its copy of the pre-flight manifest (post-flight `--before`). The
 * battery never writes or prefers it (fix-up 3); w1-90 reads it only when its own is absent.
 */
export const SNAPSHOT_FILE = "w1-snapshot-before.json";
export const RESULT_FILE = "w1-result.json";
/** The terrain fixture (OD-5): a vanilla world, opened read-only and never saved. 8.2 KB in the paks. */
export const TERRAIN_WORLD = "worlds/Arland/EmptyArland.ent";
/** W1.7: throwaway worlds that are saved, and the copy saveAs opens (read back from the files). */
export const PERSIST_WORLD = `${WORLDS_DIR}/EMCP_W1_Persist.ent`;
export const PERSIST2_WORLD = `${WORLDS_DIR}/EMCP_W1_Persist2.ent`;
export const PERSIST3_WORLD = `${WORLDS_DIR}/EMCP_W1_Persist3.ent`;
export const LAYERDEL_WORLD = `${WORLDS_DIR}/EMCP_W1_LayerDel.ent`;
export const LAYERDEL2_WORLD = `${WORLDS_DIR}/EMCP_W1_LayerDel2.ent`;
export const REMOVE_ET = `${PREFABS_DIR}/EMCP_W1_Remove.et`;
/** How long a W1.7 hand step waits for the main session's answer file (per request). */
export const HAND_WAIT_MS = 900_000;
/** The layers folder of a world file (`<name>_Layers/`, as duplicate writes it). */
export function layersDirOf(world: string): string {
  return `${world.replace(/\.ent$/i, "")}_Layers`;
}
/** The prop S-E's U19 created and undid (DEC-045). */
export const PROP = "{3F23DA7ACAC0ED90}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et";
/** Every entity the battery creates carries this prefix; the sweep deletes what is left. */
export const NAME_PREFIX = "W1_";
/** Files whose change outside _throwaway/W1/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];

export const TIMEOUTS = {
  step: 180_000,
  open: 600_000,
  poll: 5_000,
  play: 300_000,
} as const;

/** Client codes that stop the battery (the brief's stop rules). */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/** Refusals that are data, never a failure. */
export const RECORD_ONLY_CODES: ReadonlySet<string> = new Set(["UNPROVEN", "GATED"]);

/** Titles a world open may add (DEC-045's se-24 list, as train2 WORLD_EDITOR_WINDOWS). */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
export const WORLD_EDITOR_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  DEBUG_TITLE,
  /^Enfusion Workbench - EMCP2 sandbox \(2\.0 live lane\)$/,
  /^Procedural Animation Editor$/,
  /^String Editor$/,
  /^Behavior Editor - EMCP2_sandbox$/,
  /^Audio Editor$/,
  /^Animation Editor$/,
];

// ── Coverage tables ──────────────────────────────────────────────────────────

/** The seven W1 contracts in contracts/ and the TS tool that drives each. */
export const W1_CONTRACTS = {
  EMCP_WB_Entity: "wb_entity",
  EMCP_WB_View: "wb_view",
  EMCP_WB_World: "wb_world",
  EMCP_WB_Layers: "wb_layers",
  EMCP_WB_Terrain: "wb_terrain",
  EMCP_WB_Prefabs: "wb_prefabs",
  EMCP_WB_Container: "wb_container",
} as const;

/** wb_world's TS-only actions (spec 2.6): not in the contract, exercised all the same. */
export const WORLD_OFFLINE_ACTIONS = ["new", "duplicate", "saveAs", "setWorldEntity"] as const;

/**
 * Contract actions no step exercises, with the reason. Empty: every action of the seven contracts
 * and the four TS-only wb_world actions is sent by at least one step (saveAs as a dry run only: its
 * confirmed form saves the open world, which the battery never does).
 */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {};

/** Probes no step can settle hand-free, with the reason (the rest are assigned to steps). */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {
  "P-W1-25":
    "the shipped EMCP_WB_Entity never calls BeginEditSequence/IsEditSequenceActive/EndEditSequence (spec 2.1: not used until the probe passes) and no probe pack carries them; no hand-free route reaches the calls",
};

/** The probe ids P-W1-01 .. P-W1-26. */
export const PROBE_IDS: readonly string[] = Array.from(
  { length: 26 },
  (_, i) => `P-W1-${String(i + 1).padStart(2, "0")}`,
);

// ── Types ────────────────────────────────────────────────────────────────────

export type W1Tool =
  | "wb_entity"
  | "wb_view"
  | "wb_world"
  | "wb_container"
  | "wb_layers"
  | "wb_terrain"
  | "wb_prefabs"
  | "wb_module";

export const HANDLER_OF: Readonly<Record<W1Tool, string>> = {
  wb_entity: "EMCP_WB_Entity",
  wb_view: "EMCP_WB_View",
  wb_world: "EMCP_WB_World",
  wb_container: "EMCP_WB_Container",
  wb_layers: "EMCP_WB_Layers",
  wb_terrain: "EMCP_WB_Terrain",
  wb_prefabs: "EMCP_WB_Prefabs",
  wb_module: "EMCP_WB_Module",
};

export type Block = "W1.0" | "W1.1" | "W1.2" | "W1.3" | "W1.4" | "W1.7" | "W1.5" | "W1.6";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "KILLED" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED";

export interface ProbeResult {
  id: string;
  /** SETTLED: answered as the probe asks; KILLED: its kill criterion is met; PARTIAL: part answered. */
  result: "SETTLED" | "KILLED" | "PARTIAL";
  /** The observed values, verbatim from the readbacks. */
  observed: Record<string, unknown>;
  note: string;
}

export interface ToolResponse {
  ok: boolean;
  action?: string;
  target?: string;
  code?: string;
  message?: string;
  changed?: unknown;
  readback?: unknown;
  next?: string;
  warnings?: string[];
  [extra: string]: unknown;
}

export interface UndoResult {
  ok: boolean;
  message: string;
  code?: string;
}

export interface StepOutcome {
  status: Verdict;
  detail: string;
  evidence: Record<string, unknown>;
  probes?: ProbeResult[];
}

export interface StepRecord {
  step: string;
  block: Block;
  title: string;
  status: RecordStatus;
  detail: string;
  startedAt: string;
  endedAt: string;
  probes: ProbeResult[];
  evidence: Record<string, unknown>;
  stop?: string;
}

export interface W1Deps {
  /** One shipped TS tool, run in process against a client WITHOUT a Config. */
  tool: (name: W1Tool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** EMCP_WB_EditorControl {action: "undo"} (Edit > Undo), never retried. */
  undo: () => Promise<UndoResult>;
  /** EMCP_WB_Info and EMCP_WB_Ping through client.probe (reads). */
  info: () => Promise<Record<string, unknown> | null>;
  ping: () => Promise<Record<string, unknown> | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  /** Relative paths of every file under `dir` (forward slashes), [] when absent. */
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W1Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

/** What a step left behind: undo points still on the stack and view state to restore. */
export interface Debt {
  undos: number;
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W1Deps;
  opts: W1Options;
  prior: (id: string) => StepRecord | null;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  /** A tool call: guarded by the window poller; a stop code throws; an undo point is counted. */
  tool: (
    name: W1Tool,
    args: Record<string, unknown>,
    o?: { restore?: boolean },
  ) => Promise<ToolResponse>;
  /** One Edit > Undo; pays one undo point when it answers ok. */
  undo: () => Promise<UndoResult>;
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
  /** Probe ids this step settles (fully or in part). */
  probes: string[];
  /** Probes whose KILLED result skips this step. */
  dependsOn?: string[];
  /** Project-relative files or folders this step may create or change. */
  writes: string[];
  expectsWindows?: readonly RegExp[];
  plan: () => PlanAction[];
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

// ── Small helpers ────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function field(o: unknown, name: string): unknown {
  return o && typeof o === "object" ? (o as Raw)[name] : undefined;
}

function S(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

function rb(r: ToolResponse): Raw {
  return r.readback && typeof r.readback === "object" ? (r.readback as Raw) : {};
}

function brief(r: ToolResponse): Raw {
  return r.ok
    ? { ok: true, readback: r.readback ?? null, warnings: r.warnings ?? [] }
    : { ok: false, code: r.code ?? null, message: r.message ?? null, readback: r.readback ?? null };
}

function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(sandboxDir: string, rel: string): string {
  return join(sandboxDir, ...rel.split("/"));
}

/** Three numbers from "x y z" (or "x,y,z"); [] when it does not parse. */
export function vec(text: unknown): number[] {
  const parts = S(text)
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((p) => p !== "")
    .map(Number);
  return parts.length >= 3 && parts.every(Number.isFinite) ? parts.slice(0, 3) : [];
}

export function near(a: number[], b: number[], eps: number): boolean {
  return a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= eps);
}

function recordOnly(r: ToolResponse): boolean {
  return !r.ok && RECORD_ONLY_CODES.has(S(r.code));
}

function readJson<T>(path: string, deps: Pick<W1Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W1Deps, "writeBytes">): void {
  deps.writeBytes(path, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8"));
}

const settled = (id: string, observed: Raw, note = ""): ProbeResult => ({
  id,
  result: "SETTLED",
  observed,
  note,
});
const killed = (id: string, observed: Raw, note: string): ProbeResult => ({
  id,
  result: "KILLED",
  observed,
  note,
});
const partial = (id: string, observed: Raw, note: string): ProbeResult => ({
  id,
  result: "PARTIAL",
  observed,
  note,
});

/** A step's verdict from its checks: any failed check FAIL, else KILLED when a probe was killed. */
function verdictOf(
  fails: string[],
  probes: ProbeResult[],
  passDetail: string,
): Pick<StepOutcome, "status" | "detail"> {
  if (fails.length) return { status: "FAIL", detail: fails.join("; ") };
  const k = probes.filter((p) => p.result === "KILLED");
  if (k.length) return { status: "KILLED", detail: k.map((p) => `${p.id}: ${p.note}`).join("; ") };
  return { status: "PASS", detail: passDetail };
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The plan entry of one tool call: the handler it sends to, the wire action, tool and action. */
export function tc(
  tool: W1Tool,
  action: string,
  params: Raw = {},
  extra: { toolAction?: string; note?: string } = {},
): PlanAction {
  return {
    kind: "net-call",
    target: HANDLER_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: extra.toolAction ?? action,
    note: extra.note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

/** The shipped undo: its net-call and the ExecuteAction it runs (the checker reads the path). */
export function undoPlan(times = 1): PlanAction[] {
  const out: PlanAction[] = [];
  for (let i = 0; i < times; i++) {
    out.push({
      kind: "net-call",
      target: "EMCP_WB_EditorControl",
      params: { action: "undo" },
      note: "Edit > Undo through the shipped EditorControl",
    } as PlanAction);
    out.push({
      kind: "execute-action",
      target: { path: ["Edit", "Undo"], module: "WorldEditor" },
      via: "EMCP_WB_EditorControl {action: undo}",
    } as PlanAction);
  }
  return out;
}

const sweepPlan = (): PlanAction[] => [
  tc("wb_entity", "list", { name: NAME_PREFIX }),
  tc("wb_entity", "delete", { entities: ["name:W1_*"] }, { note: "only W1_ leftovers, if any" }),
];

/** Tool actions that write a file (the plan scan of the harness test checks their paths). */
export const FILE_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  "wb_world.new",
  "wb_world.duplicate",
  "wb_world.saveAs",
  "wb_world.setWorldEntity",
  "wb_world.register",
  "wb_prefabs.createTemplate",
  "wb_prefabs.clone",
  "wb_prefabs.createChild",
  "wb_prefabs.save",
  "wb_container.save",
]);

// ── Shared step bodies ───────────────────────────────────────────────────────

const WINDOW_KILL =
  "a new dialog-like window: HANDOFF (nothing sent to it); any other new window: STOP; LOST, WEDGED or MODAL_OPEN: STOP";

function entityRef(r: ToolResponse): string {
  const b = rb(r);
  const name = S(b.name);
  if (name) return `name:${name}`;
  const id = S(b.id);
  return id ? (id.startsWith("id:") ? id : `id:${id}`) : "";
}

async function create(
  ctx: StepContext,
  name: string,
  extra: Raw = {},
): Promise<{ r: ToolResponse; ref: string }> {
  const r = await ctx.tool("wb_entity", { action: "create", prefab: PROP, name, ...extra });
  return { r, ref: r.ok ? entityRef(r) : "" };
}

async function get(ctx: StepContext, ref: string): Promise<ToolResponse> {
  return ctx.tool("wb_entity", { action: "get", entity: ref });
}

/** Absent: get answers ENTITY_NOT_FOUND. */
async function gone(ctx: StepContext, ref: string): Promise<boolean> {
  if (!ref) return true;
  const r = await get(ctx, ref);
  return !r.ok && r.code === "ENTITY_NOT_FOUND";
}

/** Undo every undo point the step still owes; the messages in order. */
async function payUndos(ctx: StepContext): Promise<UndoResult[]> {
  const out: UndoResult[] = [];
  while (ctx.debt.undos > 0) {
    const u = await ctx.undo();
    out.push(u);
    if (!u.ok) break;
  }
  return out;
}

/** Delete every entity named W1_* that is still in the open world (a restore, no undo point counted). */
async function sweep(ctx: StepContext): Promise<{ found: string[]; deleted: boolean | null }> {
  const l = await ctx.tool("wb_entity", { action: "list", name: NAME_PREFIX, limit: 200 });
  const rows = Array.isArray(rb(l).rows) ? (rb(l).rows as Raw[]) : [];
  const found = rows.map((x) => S(x.name)).filter((n) => n.startsWith(NAME_PREFIX));
  if (!found.length) return { found, deleted: null };
  const d = await ctx.tool(
    "wb_entity",
    { action: "delete", entities: found.map((n) => `name:${n}`) },
    { restore: true },
  );
  return { found, deleted: d.ok };
}

/** At most this many undos beyond the counted debt, while W1_ entities remain (fix-up 2). */
export const MAX_EXTRA_UNDOS = 6;

async function w1Names(ctx: StepContext): Promise<string[]> {
  const l = await ctx.tool("wb_entity", { action: "list", name: NAME_PREFIX, limit: 200 });
  const rows = Array.isArray(rb(l).rows) ? (rb(l).rows as Raw[]) : [];
  return rows.map((x) => S(x.name)).filter((n) => n.startsWith(NAME_PREFIX));
}

/**
 * Undo back to clean: more undos while a W1_ entity is still in the open document, at most
 * MAX_EXTRA_UNDOS, stopping at an undo that answers false. A delete by the sweep is itself an edit,
 * so a world cleaned by the sweep stays dirty and its next switch raises the engine's save prompt
 * (run 2, w1-42 then w1-43); an undo leaves the history where it was before the step.
 */
async function undoUntilClean(
  ctx: StepContext,
  max = MAX_EXTRA_UNDOS,
): Promise<{ extra: UndoResult[]; left: string[] }> {
  const extra: UndoResult[] = [];
  let left = await w1Names(ctx);
  while (left.length && extra.length < max) {
    const u = await ctx.undo();
    extra.push(u);
    if (!u.ok) break;
    left = await w1Names(ctx);
  }
  return { extra, left };
}

/**
 * Before a world switch or a prefab open: undo back to clean. Anything left means the document is
 * dirty and the switch raises the engine's save prompt; the record says so (the hand answers No).
 */
async function beforeSwitch(ctx: StepContext): Promise<Raw> {
  const pre = await undoUntilClean(ctx);
  return {
    extraUndos: pre.extra.length,
    left: pre.left,
    expectSavePrompt: pre.left.length > 0,
  };
}

/** Undo what is owed, then sweep: the end of every in-memory step. Fails when anything is left. */
async function settle(ctx: StepContext, evidence: Raw, fails: string[]): Promise<void> {
  const undos = await payUndos(ctx);
  evidence.finalUndos = undos;
  if (undos.some((u) => !u.ok))
    fails.push(`an undo answered false: ${undos.map((u) => u.message).join(" | ")}`);
  // The counted debt fell short (run 2, w1-42: three file writes made undo steps the count missed):
  // undo on while a W1_ entity is left, so the sweep never has to delete and dirty the world.
  const more = await undoUntilClean(ctx);
  if (more.extra.length) evidence.extraUndos = more.extra;
  const sw = await sweep(ctx);
  evidence.sweep = sw;
  if (sw.found.length)
    fails.push(`left after the undos and deleted by the sweep: ${sw.found.join(", ")}`);
}

/**
 * Why the battery refuses to open `rel`, or null: a world under _throwaway/ must exist on disk in
 * the sandbox (game worlds outside it are not checked here).
 */
export function missingWorldRefusal(
  ctx: { opts: { sandboxDir: string }; deps: { exists(p: string): boolean } },
  rel: string,
): string | null {
  const r = rel.replace(/\\/g, "/");
  if (!r.startsWith("_throwaway/")) return null;
  if (ctx.deps.exists(abs(ctx.opts.sandboxDir, r))) return null;
  return `the world ${r} is not on disk under the sandbox: the open is not sent`;
}

/** Open a world in the World Editor and wait until wb_world state names it. */
async function openWorld(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; evidence: Raw; worldPath: string }> {
  // A load of a world that is not on disk leaves the World Editor with an API and no world (the
  // 2026-11-11 crash): a sandbox world must exist before setResource is sent.
  const refusal = missingWorldRefusal(ctx, rel);
  if (refusal) return { ok: false, worldPath: "", evidence: { refused: refusal } };
  const pre = await beforeSwitch(ctx);
  const open = await ctx.tool("wb_module", { action: "open", module: "WorldEditor" });
  const set = await ctx.tool("wb_module", {
    action: "setResource",
    module: "WorldEditor",
    target: `path:${rel}`,
  });
  const started = ctx.deps.now();
  let polls = 0;
  let worldPath = "";
  for (;;) {
    polls++;
    const st = await ctx.tool("wb_world", { action: "state" });
    worldPath = S(rb(st).worldPath);
    const ready = st.ok && worldPath.toLowerCase().endsWith(rel.toLowerCase());
    if (ready || !set.ok || ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open) {
      return {
        ok: ready,
        worldPath,
        evidence: {
          beforeSwitch: pre,
          open: brief(open),
          setResource: brief(set),
          polls,
          worldPath,
        },
      };
    }
    await ctx.sleep(TIMEOUTS.poll);
  }
}

function openPlan(rel: string): PlanAction[] {
  return [
    tc("wb_module", "open", { moduleName: "WorldEditor" }),
    tc("wb_module", "setResource", { moduleName: "WorldEditor", path: rel }),
    tc("wb_world", "state", {}, { note: "polled until worldPath names the world" }),
  ];
}

/**
 * The fixture on disk and registered: `wb_world new` (dry run, then confirm) when the .ent is
 * absent, then `register`. The one code path w1-01 and every step that needs the fixture use, so
 * a `--from`/`--only` run on a fresh launch (w1-01 skipped) still has it (2026-11-11 W1.7 run).
 */
async function makeFixture(ctx: StepContext, evidence: Raw, fails: string[]): Promise<void> {
  const present = ctx.deps.exists(abs(ctx.opts.sandboxDir, FIXTURE_WORLD));
  evidence.alreadyPresent = present;
  if (!present) {
    const dry = await ctx.tool("wb_world", { action: "new", path: FIXTURE_WORLD });
    evidence.newDry = brief(dry);
    if (ctx.deps.exists(abs(ctx.opts.sandboxDir, FIXTURE_WORLD)))
      fails.push("the dry run wrote the world");
    const made = await ctx.tool("wb_world", { action: "new", path: FIXTURE_WORLD, confirm: true });
    evidence.newConfirm = brief(made);
    if (!made.ok) fails.push(`new: ${made.code} ${made.message}`);
  }
  const again = await ctx.tool("wb_world", { action: "register", path: FIXTURE_WORLD });
  evidence.register = brief(again);
  if (!again.ok) fails.push(`register: ${again.code} ${again.message}`);
}

/** The fixture is the open world: made (makeFixture) and opened when it is not. Null when it was. */
async function openFixture(
  ctx: StepContext,
): Promise<{ ok: boolean; worldPath: string; evidence: Raw | null }> {
  const st = await ctx.tool("wb_world", { action: "state" });
  const wp = S(rb(st).worldPath);
  if (st.ok && wp.toLowerCase().endsWith(FIXTURE_WORLD.toLowerCase()))
    return { ok: true, worldPath: wp, evidence: null };
  const evidence: Raw = { stateBefore: brief(st) };
  const fails: string[] = [];
  await makeFixture(ctx, evidence, fails);
  if (fails.length) {
    evidence.fails = fails;
    return { ok: false, worldPath: wp, evidence };
  }
  const o = await openWorld(ctx, FIXTURE_WORLD);
  evidence.open = o.evidence;
  return { ok: o.ok, worldPath: o.worldPath, evidence };
}

/** The fixture world must be the open one (in-memory steps edit nothing else); opened if not. */
async function requireFixture(ctx: StepContext): Promise<void> {
  const f = await openFixture(ctx);
  if (!f.ok) {
    throw new StopBattery(
      "stopped",
      `the open world is '${f.worldPath || "(none)"}' and the fixture ${FIXTURE_WORLD} could not be made and opened: no in-memory edit is sent`,
      { ensure: f.evidence },
    );
  }
}

// ── W1.7 helpers ─────────────────────────────────────────────────────────────

/** The request and answer files of one hand observation, in the run folder (never reused). */
export function handFiles(runDir: string, key: string): { request: string; answer: string } {
  return {
    request: join(runDir, `hand-${key}.request.json`),
    answer: join(runDir, `hand-${key}.json`),
  };
}

/**
 * w1-71 (P-W1-02): the hand's rows under the parent against the children walk. The hand answers the
 * row names (the instruction asks for the rows); a bare count is compared with the walk's total.
 * Run 6 KILLED a true agreement here: `Number(["W1_H2","W1_H3"])` is NaN.
 */
export function panelChildrenAgree(
  panel: unknown,
  walkNames: string[],
  walkTotal: unknown,
): boolean {
  if (Array.isArray(panel)) {
    const names = panel.map((n) => String(n)).sort();
    return (
      Number(walkTotal) === walkNames.length && JSON.stringify(names) === JSON.stringify(walkNames)
    );
  }
  return typeof panel === "number" && panel === Number(walkTotal);
}

/**
 * w1-73 (P-W1-08): the renamed folder, holding its layer W1_PFL, is in the reopened tree: the
 * folder row itself or the layer under it (`<folder>/W1_PFL`).
 */
export function folderPersisted(treeRows: string[], folder: string): boolean {
  if (!folder) return false;
  return treeRows.some((x) => x.endsWith(`:${folder}`) || x.endsWith(`:${folder}/W1_PFL`));
}

/** The one HAND REQUEST log line: the run folder and the full answer-file path. */
export function handLine(runDir: string, key: string, instruction: string): string {
  return `HAND REQUEST ${key}: ${instruction} | run folder: ${runDir} | write the answer (JSON) to: ${handFiles(runDir, key).answer}`;
}

/**
 * Asks the main session's hand for one observation: writes the request file, logs one HAND
 * REQUEST line and polls for the answer file (JSON) up to HAND_WAIT_MS. Null when none came.
 */
async function awaitHand(ctx: StepContext, key: string, instruction: string): Promise<Raw | null> {
  const f = handFiles(ctx.opts.runDir, key);
  writeJson(
    f.request,
    {
      key,
      instruction,
      answer: basename(f.answer),
      answerPath: f.answer,
      runDir: ctx.opts.runDir,
      askedAt: new Date(ctx.deps.now()).toISOString(),
    },
    ctx.deps,
  );
  ctx.deps.log(handLine(ctx.opts.runDir, key, instruction));
  const started = ctx.deps.now();
  for (;;) {
    const a = readJson<Raw>(f.answer, ctx.deps);
    if (a) return a;
    if (ctx.deps.now() - started + TIMEOUTS.poll > HAND_WAIT_MS) return null;
    await ctx.sleep(TIMEOUTS.poll);
  }
}

/** Polls wb_world state until the open world is `rel` (after saveAs opened its copy). */
async function waitWorld(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; worldPath: string }> {
  const started = ctx.deps.now();
  for (;;) {
    const st = await ctx.tool("wb_world", { action: "state" });
    const worldPath = S(rb(st).worldPath);
    if (st.ok && worldPath.toLowerCase().endsWith(rel.toLowerCase()))
      return { ok: true, worldPath };
    if (ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open) return { ok: false, worldPath };
    await ctx.sleep(TIMEOUTS.poll);
  }
}

/**
 * saveAs (confirmed) of the open THROWAWAY world: saves it in place, copies it to `to`, registers
 * the copy and opens it; then waits until the copy is the open world. Nothing is owed afterwards
 * (the world is saved and the copy is a fresh load). Refused here unless the open world lies under
 * _throwaway/W1/.
 */
async function saveAsAndReopen(
  ctx: StepContext,
  to: string,
): Promise<{ ok: boolean; evidence: Raw }> {
  const st = await ctx.tool("wb_world", { action: "state" });
  const open = S(rb(st).worldPath).replace(/\\/g, "/");
  if (!open.includes(`${W1_ROOT}/`))
    return {
      ok: false,
      evidence: { refused: `the open world '${open}' is not under ${W1_ROOT}/` },
    };
  const sv = await ctx.tool("wb_world", { action: "saveAs", to, confirm: true, overwrite: true });
  const w = sv.ok ? await waitWorld(ctx, to) : { ok: false, worldPath: "" };
  ctx.debt.undos = 0;
  return { ok: sv.ok && w.ok, evidence: { from: open, saveAs: brief(sv), reopened: w } };
}

/** The .layer files of a world (under its layers folder), project-relative path to text. */
function layerTexts(ctx: StepContext, world: string): Record<string, string> {
  const dir = layersDirOf(world);
  const out: Record<string, string> = {};
  for (const f of ctx.deps.listTree(abs(ctx.opts.sandboxDir, dir))) {
    if (!f.toLowerCase().endsWith(".layer")) continue;
    out[`${dir}/${f}`] = ctx.deps
      .readBytes(abs(ctx.opts.sandboxDir, `${dir}/${f}`))
      .toString("utf-8");
  }
  return out;
}

/** The layer files whose text names an entity. */
function filesNaming(texts: Record<string, string>, name: string): string[] {
  return Object.keys(texts)
    .filter((k) => texts[k].includes(`"${name}"`) || texts[k].includes(` ${name} `))
    .sort();
}

/** The open world's project-relative path ("$EMCP2_sandbox:" and backslashes stripped). */
function openRel(worldPath: string): string {
  return worldPath.replace(/\\/g, "/").replace(/^\$[^:]*:/, "");
}

/** True for a W1.7 throwaway world: under _throwaway/W1/ and not the fixture (never saved). */
export function isSavableThrowaway(rel: string): boolean {
  const r = openRel(rel);
  return r.startsWith(`${W1_ROOT}/`) && r.toLowerCase() !== FIXTURE_WORLD.toLowerCase();
}

/**
 * W1.7: the open throwaway world (never the fixture) saved in place, so no world switch meets it
 * dirty (run 6: w1-75 left EMCP_W1_LayerDel dirty and the engine's "Do you want to save changes?"
 * prompt came up twice, also on the --from resume). Called at the start of every W1.7 world step
 * (a resume then starts from a saved, known world) and after a step's edits. Null when the open
 * world is not a savable throwaway (the fixture is made clean by undo instead).
 */
async function saveThrowaway(ctx: StepContext): Promise<Raw | null> {
  const st = await ctx.tool("wb_world", { action: "state" });
  const rel = openRel(S(rb(st).worldPath));
  if (!st.ok || !isSavableThrowaway(rel)) return null;
  const sv = await ctx.tool("wb_module", { action: "save", module: "WorldEditor", confirm: true });
  // Saved: what the step owed is now on disk; undoing it would make the world dirty again.
  ctx.debt.undos = 0;
  return { world: rel, save: brief(sv), ok: sv.ok };
}

/** saveThrowaway's plan entries. */
function saveThrowawayPlan(note: string): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc("wb_module", "save", { moduleName: "WorldEditor", confirm: true }, { note }),
  ];
}

/** Make a throwaway world: duplicate the fixture to `rel` (overwrite) and open it. */
async function throwawayWorld(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; evidence: Raw }> {
  const leftOpen = await saveThrowaway(ctx);
  const fixture: Raw = { leftOpenSaved: leftOpen };
  const fixtureFails: string[] = [];
  await makeFixture(ctx, fixture, fixtureFails);
  if (fixtureFails.length || (leftOpen && leftOpen.ok !== true))
    return {
      ok: false,
      evidence: {
        fixture,
        refused: fixtureFails.length
          ? `fixture: ${fixtureFails.join("; ")}`
          : "the open throwaway world was not saved: no switch is sent",
      },
    };
  const dup = await ctx.tool("wb_world", {
    action: "duplicate",
    path: FIXTURE_WORLD,
    to: rel,
    confirm: true,
    overwrite: true,
  });
  const o = dup.ok ? await openWorld(ctx, rel) : null;
  return {
    ok: dup.ok && !!o?.ok,
    evidence: { fixture, duplicate: brief(dup), open: o?.evidence ?? null },
  };
}

/** The fixture is the open world, made and opened when it is not (evidence, or null when it was). */
async function ensureFixture(ctx: StepContext): Promise<Raw | null> {
  return (await openFixture(ctx)).evidence;
}

function rowsOf(r: ToolResponse | null): Raw[] {
  return r && Array.isArray(rb(r).rows) ? (rb(r).rows as Raw[]) : [];
}

/**
 * The battery's own before-snapshot, written by w1-00 (first run of the sitting) and read by w1-90.
 * Fix-up 3: it used to share the name `w1-snapshot-before.json` with the runbook's copy of the
 * pre-flight manifest ({root, declared, files, ...}); the gate found that copy, kept it, and w1-90
 * read the manifest's four keys as file paths, so every sandbox file (all of .git first) read as
 * changed. Its own name, its own form, and the manifest form is read correctly too.
 */
export const BATTERY_SNAPSHOT_FILE = "w1-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w1-battery-snapshot";

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  root: string;
  taken_at: string;
  /** "gate": w1-00 took it; "run start": a run that did not begin at w1-00 (--from, --only). */
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/**
 * Writes the battery's before-snapshot into the sitting folder when none is there, and answers
 * whether it did. Run 7 (2026-11-11g) resumed with --from w1-70 in a sitting with no snapshot, and
 * w1-90 answered NOT-RUN: runBattery now calls this before the first step of every run, so the
 * final diff always has a snapshot (a run-start snapshot cannot see what earlier runs of the
 * sitting changed; w1-90 says which kind it read).
 */
export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W1Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
  takenBy: "gate" | "run start",
): boolean {
  const snap = join(sittingDir, BATTERY_SNAPSHOT_FILE);
  if (deps.exists(snap)) return false;
  const taken: BatterySnapshot = {
    kind: BATTERY_SNAPSHOT_KIND,
    root: sandboxDir,
    taken_at: new Date(deps.now()).toISOString(),
    taken_by: takenBy,
    files: sandboxHashes(sandboxDir, deps),
  };
  writeJson(snap, taken, deps);
  return true;
}

/**
 * The file map of a before-snapshot in any of the forms a sitting folder may hold: the battery's
 * own ({kind, files}), a pre-flight manifest ({root, declared, files}: only its declared paths
 * are compared, `declared` set) or the first runs' flat map (path to sha256). Null: no map.
 */
export function snapshotFiles(
  raw: unknown,
): { files: Record<string, string>; declared: string[] | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Raw;
  if (o.files && typeof o.files === "object" && !Array.isArray(o.files)) {
    const declared = Array.isArray(o.declared) ? o.declared.map((d) => S(d)) : null;
    return { files: o.files as Record<string, string>, declared };
  }
  const values = Object.values(o);
  if (values.length && values.every((v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v)))
    return { files: o as Record<string, string>, declared: null };
  return null;
}

/** True when the path is one of the declared entries or lies under one. */
export function underDeclared(path: string, declared: string[]): boolean {
  return declared.some((d) => path === d || path.startsWith(`${d.replace(/\/$/, "")}/`));
}

/** sha256 of every sandbox file outside _throwaway/W1/ (.git included: compared like any path). */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W1Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W1_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

export function changedFiles(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}

/**
 * w1-90's comparison: the battery's own snapshot (else the runbook's pre-flight manifest copy, read
 * as a manifest: only its declared paths) against the sandbox now, outside _throwaway/W1/. Null
 * when no readable snapshot is in the sitting folder.
 */
export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W1Deps, "exists" | "readBytes" | "listTree">,
): { source: string; declared: string[] | null; changed: string[] } | null {
  for (const name of [BATTERY_SNAPSHOT_FILE, SNAPSHOT_FILE]) {
    const snap = snapshotFiles(readJson<unknown>(join(sittingDir, name), deps));
    if (!snap) continue;
    const before = Object.fromEntries(
      Object.entries(snap.files).filter(([f]) => !f.startsWith(`${W1_ROOT}/`)),
    );
    let now = sandboxHashes(sandboxDir, deps);
    if (snap.declared) {
      const declared = snap.declared;
      now = Object.fromEntries(Object.entries(now).filter(([f]) => underDeclared(f, declared)));
    }
    return { source: name, declared: snap.declared, changed: changedFiles(before, now) };
  }
  return null;
}

// ── Steps ────────────────────────────────────────────────────────────────────

const MEM_ROLLBACK =
  "undo through EMCP_WB_EditorControl for every undo point the step made, then the W1_ sweep; the world is never saved";

export function buildSteps(): StepDef[] {
  const confTarget = `path:${PLANT_CONF}`;
  return [
    // ── W1.0 setup ──
    {
      id: "w1-00-gate",
      block: "W1.0",
      title: "the test-bed gate: EMCP_WB_Info names EMCP2_sandbox, build stamp, sandbox snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; the plant is present`,
      kill_criterion: "not the test bed: ABORTED, nothing else runs; a stamp mismatch: STOPPED",
      side_effects: [`<sitting>/${BATTERY_SNAPSHOT_FILE} written (first run only)`],
      rollback: "none (reads; the snapshot is a file in the sitting folder)",
      probes: [],
      writes: [],
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_Info" } as PlanAction,
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
      ],
      run: async (ctx) => {
        const info = await ctx.deps.info();
        const projectFound = field(info, "projectFound");
        const projectName = field(info, "projectName");
        const found =
          projectFound === true ||
          projectFound === 1 ||
          projectFound === "1" ||
          projectFound === "true";
        const evidence: Raw = { info, projectFound, projectName };
        // The same assertion kernel.live.ts k-03 makes (DEC-058: the guard follows the open project).
        if (!found || projectName !== SANDBOX_NAME)
          throw new StopBattery(
            "aborted",
            `EMCP_WB_Info does not say projectFound with projectName ${SANDBOX_NAME}: not the live lane's test bed`,
            evidence,
          );
        const ping = await ctx.deps.ping();
        const stamp = S(field(ping, "buildStamp"));
        const digest = ctx.deps.bundleDigest();
        evidence.stamp = stamp || null;
        evidence.digest = digest;
        if (!stamp || !digest || stamp !== digest)
          throw new StopBattery(
            "stopped",
            "the build stamp does not match the bundle digest",
            evidence,
          );
        if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, PLANT_CONF)))
          throw new StopBattery(
            "stopped",
            `${PLANT_CONF} is absent: run \`w1.live.ts plant\` first`,
            evidence,
          );
        // The battery's own before-snapshot (fix-up 3): taken on the sitting's first run (by
        // runBattery before the first step, or here) and kept for resumed runs; never the
        // runbook's copy of the pre-flight manifest.
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        evidence.snapshot = BATTERY_SNAPSHOT_FILE;
        return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
      },
    },
    {
      id: "w1-01-fixture",
      block: "W1.0",
      title: `wb_world new (dry run, confirm) writes the fixture ${FIXTURE_WORLD}; register again; open it`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected:
        "the dry run writes nothing; confirm writes the .ent and default.layer and registers them; a second register answers alreadyRegistered; setResource opens it and state names it",
      kill_criterion: `the world does not open: FAIL and every later step on the fixture STOPS; ${WINDOW_KILL}`,
      side_effects: [
        `${WORLDS_DIR}/${FIXTURE_NAME}.ent, ${FIXTURE_NAME}_Layers/default.layer and their .meta`,
      ],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/ after Workbench is closed",
      probes: [],
      writes: [`${WORLDS_DIR}/${FIXTURE_NAME}.ent`, `${WORLDS_DIR}/${FIXTURE_NAME}_Layers/`],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        tc(
          "wb_world",
          "register",
          { path: FIXTURE_WORLD },
          { toolAction: "new", note: "offline writer in TS (dry run)" },
        ),
        tc(
          "wb_world",
          "register",
          { path: FIXTURE_WORLD, confirm: true },
          { toolAction: "new", note: "offline writer in TS, then register" },
        ),
        tc("wb_world", "register", { path: FIXTURE_WORLD }),
        ...openPlan(FIXTURE_WORLD),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        await makeFixture(ctx, evidence, fails);
        const o = await openWorld(ctx, FIXTURE_WORLD);
        evidence.open = o.evidence;
        if (!o.ok)
          throw new StopBattery(
            "stopped",
            `the fixture did not open (worldPath '${o.worldPath}')`,
            evidence,
          );
        return { ...verdictOf(fails, [], `fixture open: ${o.worldPath}`), evidence };
      },
    },

    // ── W1.1 read-only on the fixture ──
    {
      id: "w1-10-world-state",
      block: "W1.1",
      title: "wb_world state twice in edit mode (P-W1-16, edit half)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: "mode edit, booleans and a tool name; the two reads are equal (no side effect)",
      kill_criterion: "any flag call throws (the action fails): KILLED, the row blocked:P-W1-16",
      side_effects: [],
      rollback: "none",
      probes: ["P-W1-16"],
      writes: [],
      plan: () => [tc("wb_world", "state"), tc("wb_world", "state")],
      run: async (ctx) => {
        const a = await ctx.tool("wb_world", { action: "state" });
        const b = await ctx.tool("wb_world", { action: "state" });
        const evidence = { first: brief(a), second: brief(b) };
        const observed = { first: a.readback ?? null, code: a.code ?? null };
        if (!a.ok || !b.ok) {
          const p = killed(
            "P-W1-16",
            observed,
            `state failed: ${a.code ?? b.code} ${a.message ?? b.message}`,
          );
          return { status: "KILLED", detail: p.note, evidence, probes: [p] };
        }
        const same = JSON.stringify(a.readback) === JSON.stringify(b.readback);
        const mode = S(rb(a).mode);
        const p =
          same && mode === "edit"
            ? partial(
                "P-W1-16",
                observed,
                "edit mode: every flag read, no change between two reads; play half in w1-60",
              )
            : partial(
                "P-W1-16",
                { ...observed, second: b.readback },
                `mode '${mode}', reads equal ${same}`,
              );
        return {
          ...verdictOf(
            mode === "edit" ? [] : [`mode is '${mode}', not edit`],
            [p],
            `mode ${mode}, tool '${S(rb(a).toolName)}'`,
          ),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w1-11-layers-read",
      block: "W1.1",
      title: "wb_layers list and tree",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "list names the default layer; tree answers every sub-scene with kinds and lock state",
      kill_criterion: "either read fails: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      plan: () => [tc("wb_layers", "list"), tc("wb_layers", "tree")],
      run: async (ctx) => {
        const l = await ctx.tool("wb_layers", { action: "list" });
        const t = await ctx.tool("wb_layers", { action: "tree" });
        const fails = [l, t].filter((r) => !r.ok).map((r) => `${r.action}: ${r.code} ${r.message}`);
        const layers = Array.isArray(rb(l).layers)
          ? (rb(l).layers as Raw[]).map((x) => S(x.path))
          : [];
        return {
          ...verdictOf(fails, [], `layers ${layers.join(", ")}; active '${S(rb(t).activeLayer)}'`),
          evidence: { list: brief(l), tree: brief(t) },
        };
      },
    },
    {
      id: "w1-12-entity-read",
      block: "W1.1",
      title: "wb_entity list, get index:0, children of index:0, query box (P-W1-02)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "list's kids column equals children's total for index:0; get answers a non-empty niceName; query answers",
      kill_criterion:
        "kids and children's total disagree: KILLED (children by a GetEditorEntity scan filtered by GetParent)",
      side_effects: [],
      rollback: "none",
      probes: ["P-W1-02"],
      writes: [],
      plan: () => [
        tc("wb_entity", "list"),
        tc("wb_entity", "get", { entity: "index:0" }),
        tc("wb_entity", "children", { entity: "index:0" }),
        tc("wb_entity", "query", { mins: "-1000 -1000 -1000", maxs: "1000 1000 1000" }),
      ],
      run: async (ctx) => {
        const l = await ctx.tool("wb_entity", { action: "list" });
        const g = await ctx.tool("wb_entity", { action: "get", entity: "index:0" });
        const c = await ctx.tool("wb_entity", { action: "children", entity: "index:0" });
        const q = await ctx.tool("wb_entity", {
          action: "query",
          mins: "-1000 -1000 -1000",
          maxs: "1000 1000 1000",
        });
        const evidence = { list: brief(l), get: brief(g), children: brief(c), query: brief(q) };
        const fails = [l, g, c, q]
          .filter((r) => !r.ok)
          .map((r) => `${r.action}: ${r.code} ${r.message}`);
        const rows = Array.isArray(rb(l).rows) ? (rb(l).rows as Raw[]) : [];
        const first = rows[0] ?? {};
        const observed = {
          listTotal: rb(l).total ?? null,
          kidsOfIndex0: first.kids ?? null,
          childrenTotal: rb(c).total ?? null,
          childCountFromGet: rb(g).childCount ?? null,
          niceName: rb(g).niceName ?? null,
        };
        let p: ProbeResult;
        if (!c.ok || !l.ok) p = killed("P-W1-02", observed, "children or list failed");
        else if (Number(first.kids) !== Number(rb(c).total))
          p = killed("P-W1-02", observed, "GetNumChildren and the children walk disagree");
        else
          p = partial(
            "P-W1-02",
            observed,
            "counts agree on the fixture's root; the hierarchy-panel comparison and GetEntity(sub,i) are not read hand-free; parent/child counts again in w1-23",
          );
        return {
          ...verdictOf(fails, [p], `${S(observed.listTotal)} entities`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w1-13-view-read",
      block: "W1.1",
      title: "wb_view camera, selection, trace at the viewport centre, underCursor (P-W1-13)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "camera answers a position and a positive screen size; trace at (w/2, h/2) answers; underCursor answers without a dialog",
      kill_criterion:
        "screen size 0: trace, underCursor and placeAtPixel NOT-RUN (no pixel to use); underCursor crash or modal: KILLED (and the HANDOFF rule)",
      side_effects: [],
      rollback: "none",
      probes: ["P-W1-13"],
      writes: [],
      plan: () => [
        tc("wb_view", "camera"),
        tc("wb_view", "selection"),
        tc("wb_view", "trace", { x: "<screenWidth/2>", y: "<screenHeight/2>" }),
        tc("wb_view", "underCursor"),
      ],
      run: async (ctx) => {
        const cam = await ctx.tool("wb_view", { action: "camera" });
        const sel = await ctx.tool("wb_view", { action: "selection" });
        const w = Number(rb(cam).screenWidth);
        const h = Number(rb(cam).screenHeight);
        const evidence: Raw = { camera: brief(cam), selection: brief(sel) };
        const fails = [cam, sel]
          .filter((r) => !r.ok)
          .map((r) => `${r.action}: ${r.code} ${r.message}`);
        if (!(w > 0 && h > 0)) {
          evidence.viewport = null;
          return {
            status: "NOT-RUN",
            detail: `screen size ${w}x${h}: no viewport pixel to use; trace and underCursor not sent`,
            evidence,
            probes: [
              partial("P-W1-13", { screenWidth: w, screenHeight: h }, "not sent: no viewport size"),
            ],
          };
        }
        const x = Math.floor(w / 2);
        const y = Math.floor(h / 2);
        evidence.viewport = { width: w, height: h, x, y };
        const tr = await ctx.tool("wb_view", { action: "trace", x, y });
        const uc = await ctx.tool("wb_view", { action: "underCursor" });
        evidence.trace = brief(tr);
        evidence.underCursor = brief(uc);
        if (!tr.ok) fails.push(`trace: ${tr.code} ${tr.message}`);
        const observed = { underCursor: uc.readback ?? null, code: uc.code ?? null };
        const p = uc.ok
          ? partial(
              "P-W1-13",
              observed,
              "answered without a dialog; the mouse is wherever the desktop left it (no hand-free way to put it outside the viewport): x/y and entity as read",
            )
          : killed("P-W1-13", observed, `underCursor failed: ${uc.code} ${uc.message}`);
        return { ...verdictOf(fails, [p], `viewport ${w}x${h}`), evidence, probes: [p] };
      },
    },
    {
      id: "w1-14-world-reads",
      block: "W1.1",
      title: "wb_world comments and browserSelection (P-W1-24), wb_prefabs editState",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "comments answers (0 on the fixture) with the categories; browserSelection answers without a dialog; editState prefabEdit false",
      kill_criterion:
        "browserSelection opens a dialog (HANDOFF) or fails: KILLED, rows blocked:P-W1-24",
      side_effects: [],
      rollback: "none",
      probes: ["P-W1-24"],
      writes: [],
      plan: () => [
        tc("wb_world", "comments"),
        tc("wb_world", "browserSelection"),
        tc("wb_prefabs", "editState"),
      ],
      run: async (ctx) => {
        const c = await ctx.tool("wb_world", { action: "comments" });
        const b = await ctx.tool("wb_world", { action: "browserSelection" });
        const e = await ctx.tool("wb_prefabs", { action: "editState" });
        const evidence = { comments: brief(c), browserSelection: brief(b), editState: brief(e) };
        const fails = [c, e].filter((r) => !r.ok).map((r) => `${r.action}: ${r.code} ${r.message}`);
        if (e.ok && rb(e).prefabEdit === true)
          fails.push("editState says prefab edit mode on a world");
        const observed = { readback: b.readback ?? null, code: b.code ?? null };
        const p = b.ok
          ? settled("P-W1-24", observed, "answered through the callback, no dialog")
          : killed("P-W1-24", observed, `${b.code} ${b.message}`);
        return {
          ...verdictOf(fails, [p], `browser selection ${S(rb(b).count)}`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w1-15-aliases-read",
      block: "W1.1",
      title:
        "1.x name aliases (spec section 6 item 6): wb_layers getActive/isVisible/getInfo, wb_terrain getBounds/getHeight on the no-terrain fixture",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "the layer aliases answer as their mapped actions; the terrain aliases answer or refuse NO_TERRAIN",
      kill_criterion: "an alias answers a code other than NO_TERRAIN: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      plan: () => [
        tc("wb_layers", "tree", {}, { toolAction: "getActive" }),
        tc("wb_layers", "list", {}, { toolAction: "isVisible" }),
        tc("wb_layers", "list", {}, { toolAction: "getInfo" }),
        tc("wb_terrain", "info", {}, { toolAction: "getBounds" }),
        tc("wb_terrain", "heights", { points: ["0 0"] }, { toolAction: "getHeight" }),
      ],
      run: async (ctx) => {
        const calls: Array<[W1Tool, Raw]> = [
          ["wb_layers", { action: "getActive" }],
          ["wb_layers", { action: "isVisible", layerID: 0 }],
          ["wb_layers", { action: "getInfo", layerID: 0 }],
          ["wb_terrain", { action: "getBounds" }],
          ["wb_terrain", { action: "getHeight", x: 0, z: 0 }],
        ];
        const out: Raw[] = [];
        const fails: string[] = [];
        for (const [t, args] of calls) {
          const r = await ctx.tool(t, args);
          out.push({ tool: t, args, ...brief(r) });
          if (!r.ok && !(t === "wb_terrain" && r.code === "NO_TERRAIN") && !recordOnly(r))
            fails.push(`${t} ${S(args.action)}: ${r.code} ${r.message}`);
        }
        return { ...verdictOf(fails, [], `${out.length} alias calls`), evidence: { aliases: out } };
      },
    },

    // ── W1.2 in-memory on the fixture ──
    {
      id: "w1-20-create-id",
      block: "W1.2",
      title:
        "create, get by name and by id twice, an unrelated create and its undo, get by id again, undo (P-W1-01)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "create answers an id 'id:0x' + 16 hex (EMCP_WB_EntityRef.IdHex: the hex GetID().ToString() holds, else a stable digest of that text); the same id after two reads and after an unrelated undo; W1_B's id differs; id: resolves; get records idText and runtimeIdText verbatim; one undo removes the entity",
      kill_criterion:
        "id empty (no id text at all), changed between reads, or the same for two entities: KILLED (record idText/runtimeIdText and redesign the id source); the undo leaves it: FAIL",
      side_effects: ["entities W1_A, W1_B in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-01"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_A" }),
        tc("wb_entity", "get", { entity: "name:W1_A" }),
        tc("wb_entity", "get", { entity: "id:<id>" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_B" }),
        ...undoPlan(1),
        tc("wb_entity", "get", { entity: "id:<id>" }),
        ...undoPlan(1),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const a = await create(ctx, "W1_A");
        evidence.create = brief(a.r);
        if (!a.r.ok)
          throw new StopBattery("stopped", `create failed: ${a.r.code} ${a.r.message}`, evidence);
        const createdId = S(rb(a.r).id);
        const byName = await get(ctx, a.ref);
        const idRef = createdId
          ? createdId.startsWith("id:")
            ? createdId
            : `id:${createdId}`
          : "";
        const byId1 = idRef ? await get(ctx, idRef) : null;
        const b = await create(ctx, "W1_B");
        const undoB = await ctx.undo();
        const bGone = await gone(ctx, b.ref);
        const byId2 = idRef ? await get(ctx, idRef) : null;
        Object.assign(evidence, {
          getByName: brief(byName),
          getById1: byId1 ? brief(byId1) : null,
          unrelatedCreate: brief(b.r),
          unrelatedUndo: undoB,
          unrelatedGone: bGone,
          getById2: byId2 ? brief(byId2) : null,
        });
        const ids = [
          createdId,
          S(rb(byName).id),
          byId1 ? S(rb(byId1).id) : "",
          byId2 ? S(rb(byId2).id) : "",
        ];
        const idText = S(rb(byName).idText);
        const otherId = S(rb(b.r).id);
        const observed = {
          idAsAnswered: createdId,
          idByName: ids[1],
          idById1: ids[2],
          idAfterUnrelatedUndo: ids[3],
          idOfUnrelated: otherId,
          idText,
          runtimeIdText: S(rb(byName).runtimeIdText),
          idResolves: byId1?.ok ?? false,
          idResolvesAfterUndo: byId2?.ok ?? false,
          route:
            "GetEditorEntity scan comparing EMCP_WB_EntityRef.IdHex (ID_BY_FIND = false): the hex in GetID().ToString(), else a digest of that text",
        };
        let p: ProbeResult;
        if (!createdId)
          p = killed("P-W1-01", observed, `no id: GetID().ToString() gave '${idText}'`);
        else if (new Set(ids).size !== 1)
          p = killed("P-W1-01", observed, "the id changed between reads");
        else if (otherId && otherId === createdId)
          p = killed("P-W1-01", observed, "two entities answered the same id");
        else if (!byId1?.ok || !byId2?.ok)
          p = killed("P-W1-01", observed, "id: did not resolve by the scan");
        else
          p = partial(
            "P-W1-01",
            observed,
            `id stable over reads and an unrelated undo, distinct per entity, resolves by the scan; idText '${idText}' (${/^(0x)?[0-9a-f]{1,16}$/i.test(idText) ? "hex: FindEntityByID is open to a later flip" : "not hex: the id is a digest of it"})`,
          );
        if (!bGone) fails.push("the unrelated create was not removed by one undo");
        await settle(ctx, evidence, fails);
        evidence.aGone = await gone(ctx, a.ref);
        if (!evidence.aGone) fails.push("W1_A is still there after its undo");
        return { ...verdictOf(fails, [p], `id ${createdId}`), evidence, probes: [p] };
      },
    },
    {
      id: "w1-21-create-parent",
      block: "W1.2",
      title: "create with a parent reference (P-W1-03, parent half), undo",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the child's get answers parentName W1_P (and parentId = the parent's id when ids are answered); the parent's childCount is 1; two undos remove both",
      kill_criterion:
        "parent ignored (no parentName, parent childCount 0): KILLED (create at root then ParentEntity in one action)",
      side_effects: ["W1_P, W1_C in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-03"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_P" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_C", parent: "name:W1_P" }),
        tc("wb_entity", "get", { entity: "name:W1_C" }),
        tc("wb_entity", "get", { entity: "name:W1_P" }),
        ...undoPlan(2),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const p0 = await create(ctx, "W1_P");
        const c0 = p0.r.ok ? await create(ctx, "W1_C", { parent: p0.ref }) : null;
        const cg = c0?.r.ok ? await get(ctx, c0.ref) : null;
        const pg = p0.r.ok ? await get(ctx, p0.ref) : null;
        Object.assign(evidence, {
          parent: brief(p0.r),
          child: c0 ? brief(c0.r) : null,
          childGet: cg ? brief(cg) : null,
          parentGet: pg ? brief(pg) : null,
        });
        if (!p0.r.ok || !c0?.r.ok) fails.push("a create failed");
        const observed = {
          parentId: S(rb(p0.r).id),
          childParentIdFromCreate: c0 ? S(rb(c0.r).parentId) : null,
          childParentIdFromGet: cg ? S(rb(cg).parentId) : null,
          childParentNameFromCreate: c0 ? S(rb(c0.r).parentName) : null,
          childParentNameFromGet: cg ? S(rb(cg).parentName) : null,
          parentChildCount: pg ? Number(rb(pg).childCount ?? 0) : null,
        };
        // The id read-back agrees when ids are answered; parentName and childCount need no id.
        const idsAgree = !observed.parentId || observed.childParentIdFromGet === observed.parentId;
        const p =
          cg?.ok &&
          observed.childParentNameFromGet === "W1_P" &&
          observed.parentChildCount === 1 &&
          idsAgree
            ? partial(
                "P-W1-03",
                observed,
                "CreateEntity with a parent source made a child; the CreateEntityExt layer half is in w1-27",
              )
            : killed("P-W1-03", observed, "the parent argument was ignored (or not read back)");
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "child under parent"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-22-rename-transform",
      block: "W1.2",
      title:
        "query sphere and box around a new entity (P-W1-23); rename, transform coords/angles/scale, each read back, undone one by one",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "both queries list W1_R; rename and transform read back; each undo restores the value before it; the create's undo removes it",
      kill_criterion:
        "a query misses the entity: P-W1-23 KILLED (query filters GetEditorEntity by origin distance); a read back differs or an undo does not restore: FAIL",
      side_effects: ["W1_R in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-23"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_R", coords: "1 0 1" }),
        tc("wb_entity", "query", { center: "1 0 1", radius: 5 }),
        tc("wb_entity", "query", { mins: "0 -1 0", maxs: "2 1 2" }),
        tc("wb_entity", "rename", { entity: "name:W1_R", name: "W1_R2" }),
        tc("wb_entity", "transform", {
          entity: "name:W1_R2",
          coords: "2 0 3",
          angles: "0 45 0",
          scale: 2,
        }),
        tc("wb_entity", "get", { entity: "name:W1_R2" }),
        ...undoPlan(1),
        tc("wb_entity", "get", { entity: "name:W1_R2" }),
        ...undoPlan(1),
        tc("wb_entity", "get", { entity: "name:W1_R" }),
        ...undoPlan(1),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const probes: ProbeResult[] = [];
        const c = await create(ctx, "W1_R", { coords: "1 0 1" });
        if (!c.r.ok)
          throw new StopBattery("stopped", `create failed: ${c.r.code}`, { create: brief(c.r) });
        const before = await get(ctx, c.ref);
        // P-W1-23: the world queries in edit mode, around the entity just made.
        const qs = await ctx.tool("wb_entity", { action: "query", center: "1 0 1", radius: 5 });
        const qb = await ctx.tool("wb_entity", { action: "query", mins: "0 -1 0", maxs: "2 1 2" });
        const names = (r: ToolResponse): string[] =>
          Array.isArray(rb(r).rows) ? (rb(r).rows as Raw[]).map((x) => S(x.name)) : [];
        const p23obs = {
          sphere: {
            ok: qs.ok,
            code: qs.code ?? null,
            total: rb(qs).total ?? null,
            names: names(qs),
          },
          aabb: { ok: qb.ok, code: qb.code ?? null, total: rb(qb).total ?? null, names: names(qb) },
        };
        // A refused query is a fault of the call, not an answer to the probe (the first live run
        // refused radius 5: a JSON integer did not reach the handler's float field).
        if (!qs.ok) fails.push(`sphere query refused: ${qs.code} ${qs.message}`);
        if (!qb.ok) fails.push(`box query refused: ${qb.code} ${qb.message}`);
        probes.push(
          qs.ok && qb.ok && names(qs).includes("W1_R") && names(qb).includes("W1_R")
            ? settled(
                "P-W1-23",
                p23obs,
                "sphere and box queries find the new entity in edit mode and map it back to its source",
              )
            : !qs.ok || !qb.ok
              ? partial("P-W1-23", p23obs, "a query was refused, so the probe is not answered")
              : killed(
                  "P-W1-23",
                  p23obs,
                  "a query answered but missed the entity in edit mode: wb_entity.query filters GetEditorEntity by origin distance",
                ),
        );
        evidence.querySphere = brief(qs);
        evidence.queryAabb = brief(qb);
        const rn = await ctx.tool("wb_entity", { action: "rename", entity: c.ref, name: "W1_R2" });
        const tf = await ctx.tool("wb_entity", {
          action: "transform",
          entity: "name:W1_R2",
          coords: "2 0 3",
          angles: "0 45 0",
          scale: 2,
        });
        const after = await get(ctx, "name:W1_R2");
        const u1 = await ctx.undo();
        const afterU1 = await get(ctx, "name:W1_R2");
        const u2 = await ctx.undo();
        const afterU2 = await get(ctx, "name:W1_R");
        Object.assign(evidence, {
          before: brief(before),
          rename: brief(rn),
          transform: brief(tf),
          after: brief(after),
          undo1: u1,
          afterUndo1: brief(afterU1),
          undo2: u2,
          afterUndo2: brief(afterU2),
        });
        if (!rn.ok || !tf.ok) fails.push("rename or transform failed");
        if (!near(vec(rb(after).coords), [2, 0, 3], 0.01))
          fails.push(`coords read back ${S(rb(after).coords)}`);
        if (Math.abs(Number(rb(tf).scale) - 2) > 0.001)
          fails.push(`scale read back ${S(rb(tf).scale)}, sent 2`);
        if (!near(vec(rb(afterU1).coords), vec(rb(before).coords), 0.01))
          fails.push("the transform's undo did not restore the coords");
        if (!afterU2.ok) fails.push("the rename's undo did not restore the name W1_R");
        await settle(ctx, evidence, fails);
        return {
          ...verdictOf(fails, probes, "query, rename, transform and both undos read back"),
          evidence,
          probes,
        };
      },
    },
    {
      id: "w1-23-clone",
      block: "W1.2",
      title: "clone a parent with one child; one undo removes the clone (P-W1-04)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the clone has the same class and component count, childCount 1, a different name; one undo removes it",
      kill_criterion: "clone fails or drops the child: KILLED (clone via the clipboard)",
      side_effects: ["W1_K, W1_KC and the clone in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-04"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_K" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_KC", parent: "name:W1_K" }),
        tc("wb_entity", "clone", { entity: "name:W1_K", name: "W1_K2" }),
        tc("wb_entity", "get", { entity: "name:W1_K2" }),
        ...undoPlan(1),
        tc("wb_entity", "get", { entity: "name:W1_K2" }),
        ...undoPlan(2),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const k = await create(ctx, "W1_K");
        const kc = k.r.ok ? await create(ctx, "W1_KC", { parent: k.ref }) : null;
        const src = k.r.ok ? await get(ctx, k.ref) : null;
        const cl = k.r.ok
          ? await ctx.tool("wb_entity", { action: "clone", entity: k.ref, name: "W1_K2" })
          : null;
        const cref = cl?.ok ? entityRef(cl) : "";
        const cg = cref ? await get(ctx, cref) : null;
        let cloneGone: boolean | null = null;
        let undo: UndoResult | null = null;
        if (cl?.ok) {
          undo = await ctx.undo();
          cloneGone = await gone(ctx, cref);
        }
        Object.assign(evidence, {
          source: src ? brief(src) : null,
          child: kc ? brief(kc.r) : null,
          clone: cl ? brief(cl) : null,
          cloneGet: cg ? brief(cg) : null,
          undo,
          cloneGone,
        });
        const comps = (r: ToolResponse | null): number =>
          r && Array.isArray(rb(r).components) ? (rb(r).components as unknown[]).length : -1;
        const observed = {
          sourceClass: src ? rb(src).className : null,
          cloneClass: cg ? rb(cg).className : null,
          sourceComponents: comps(src),
          cloneComponents: comps(cg),
          sourceChildren: src ? rb(src).childCount : null,
          cloneChildren: cg ? rb(cg).childCount : cl ? rb(cl).childCount : null,
          cloneName: cg ? rb(cg).name : null,
          oneUndoRemovesClone: cloneGone,
        };
        let p: ProbeResult;
        if (!cl?.ok) p = killed("P-W1-04", observed, `clone failed: ${cl?.code} ${cl?.message}`);
        else if (Number(observed.cloneChildren) !== Number(observed.sourceChildren))
          p = killed("P-W1-04", observed, "the clone dropped children");
        else if (cloneGone !== true)
          p = killed("P-W1-04", observed, "one undo did not remove the clone");
        else if (
          observed.cloneClass !== observed.sourceClass ||
          observed.cloneComponents !== observed.sourceComponents
        )
          p = partial(
            "P-W1-04",
            observed,
            "children kept, one undo; class or component count differs",
          );
        else p = settled("P-W1-04", observed, "same class, components and children; one undo step");
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "clone checked"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-24-parent-unparent",
      block: "W1.2",
      title:
        "parent with keepWorldTransform true and false, unparent, origin read back each time (P-W1-06)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "true: the child's coords read the same before and after; false: recorded as read; unparent makes it top-level; undo restores",
      kill_criterion:
        "the call fails: KILLED (loop ParentEntity); the transform jumps with true: KILLED (flag semantics documented)",
      side_effects: ["W1_PA, W1_CA, W1_CB in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-06"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", {
          prefab: PROP,
          name: "W1_PA",
          coords: "10 0 10",
          angles: "0 90 0",
        }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_CA", coords: "12 0 10" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_CB", coords: "14 0 10" }),
        tc("wb_entity", "parent", {
          parent: "name:W1_PA",
          entities: ["name:W1_CA"],
          keepWorldTransform: true,
        }),
        tc("wb_entity", "parent", {
          parent: "name:W1_PA",
          entities: ["name:W1_CB"],
          keepWorldTransform: false,
        }),
        tc("wb_entity", "get", { entity: "name:W1_CA" }),
        tc("wb_entity", "unparent", { entities: ["name:W1_CA", "name:W1_CB"] }),
        tc("wb_entity", "get", { entity: "name:W1_CB" }),
        ...undoPlan(6),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const pa = await create(ctx, "W1_PA", { coords: "10 0 10", angles: "0 90 0" });
        const ca = await create(ctx, "W1_CA", { coords: "12 0 10" });
        const cb = await create(ctx, "W1_CB", { coords: "14 0 10" });
        if (![pa, ca, cb].every((x) => x.r.ok)) {
          await settle(ctx, evidence, fails);
          throw new StopBattery("stopped", "a create failed", evidence);
        }
        const caBefore = await get(ctx, ca.ref);
        const cbBefore = await get(ctx, cb.ref);
        const pTrue = await ctx.tool("wb_entity", {
          action: "parent",
          parent: pa.ref,
          entities: [ca.ref],
          keepWorldTransform: true,
        });
        const pFalse = await ctx.tool("wb_entity", {
          action: "parent",
          parent: pa.ref,
          entities: [cb.ref],
          keepWorldTransform: false,
        });
        const caAfter = await get(ctx, ca.ref);
        const cbAfter = await get(ctx, cb.ref);
        const un = await ctx.tool("wb_entity", { action: "unparent", entities: [ca.ref, cb.ref] });
        const caUn = await get(ctx, ca.ref);
        const cbUn = await get(ctx, cb.ref);
        Object.assign(evidence, {
          parentTrue: brief(pTrue),
          parentFalse: brief(pFalse),
          unparent: brief(un),
          gets: {
            caBefore: brief(caBefore),
            caAfter: brief(caAfter),
            caUnparented: brief(caUn),
            cbBefore: brief(cbBefore),
            cbAfter: brief(cbAfter),
            cbUnparented: brief(cbUn),
          },
        });
        const observed = {
          parentId: S(rb(pa.r).id),
          keepTrue: {
            before: rb(caBefore).coords,
            after: rb(caAfter).coords,
            unparented: rb(caUn).coords,
            parentId: rb(caAfter).parentId,
            parentName: rb(caAfter).parentName ?? null,
          },
          keepFalse: {
            before: rb(cbBefore).coords,
            after: rb(cbAfter).coords,
            unparented: rb(cbUn).coords,
            parentId: rb(cbAfter).parentId,
            parentName: rb(cbAfter).parentName ?? null,
          },
          unparentedParentIds: [rb(caUn).parentId ?? null, rb(cbUn).parentId ?? null],
          unparentedParentNames: [rb(caUn).parentName ?? null, rb(cbUn).parentName ?? null],
          mapping:
            "keepWorldTransform is passed to ParentEntities as transformChildToParentSpace (EMCP_WB_Entity.c; the first live run showed true keeps the world coords, false re-reads them in the parent's space)",
        };
        // The parent read-back by name: the first live run's id was empty, so parentId read null
        // though the parenting happened (W1_CB moved from 14 0 10 to 20 0 -4 under the parent).
        const parentedName = (r: ToolResponse): string => S(rb(r).parentName);
        let p: ProbeResult;
        if (!pTrue.ok || !pFalse.ok || !un.ok)
          p = killed(
            "P-W1-06",
            observed,
            `a call failed: ${[pTrue, pFalse, un]
              .filter((r) => !r.ok)
              .map((r) => `${r.action} ${r.code}`)
              .join(", ")}`,
          );
        else if (
          parentedName(caAfter) !== "W1_PA" ||
          parentedName(cbAfter) !== "W1_PA" ||
          parentedName(caUn) !== "" ||
          parentedName(cbUn) !== ""
        )
          p = killed("P-W1-06", observed, "re-parent or unparent did not read back (parentName)");
        else {
          const trueKeeps = near(vec(rb(caBefore).coords), vec(rb(caAfter).coords), 0.01);
          const falseKeeps = near(vec(rb(cbBefore).coords), vec(rb(cbAfter).coords), 0.01);
          p = (trueKeeps ? settled : killed)(
            "P-W1-06",
            { ...observed, trueKeepsCoords: trueKeeps, falseKeepsCoords: falseKeeps },
            trueKeeps
              ? `keepWorldTransform true keeps the coords read by get; false ${falseKeeps ? "also keeps them" : "changes them"}`
              : "the coords jump with keepWorldTransform true: the flag semantics are the reverse or get reads local coords",
          );
        }
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "parent/unparent read back"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-25-delete-bulk",
      block: "W1.2",
      title: "delete three entities in one call; one undo restores all three (P-W1-05)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected: "all three gone after the delete; all three back after ONE undo",
      kill_criterion: "not all back after one undo: KILLED (loop DeleteEntity in one action)",
      side_effects: ["W1_D1..3 in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-05"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_D1" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_D2" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_D3" }),
        tc("wb_entity", "delete", { entities: ["name:W1_D1", "name:W1_D2", "name:W1_D3"] }),
        ...undoPlan(4),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const made = [
          await create(ctx, "W1_D1"),
          await create(ctx, "W1_D2"),
          await create(ctx, "W1_D3"),
        ];
        const refs = made.map((m) => m.ref);
        if (refs.some((r) => !r)) {
          await settle(ctx, evidence, fails);
          throw new StopBattery("stopped", "a create failed", evidence);
        }
        const del = await ctx.tool("wb_entity", { action: "delete", entities: refs });
        const goneAfterDelete = await Promise.all(refs.map((r) => gone(ctx, r)));
        let backAfterOneUndo: boolean[] = [];
        let undo: UndoResult | null = null;
        if (del.ok) {
          undo = await ctx.undo();
          backAfterOneUndo = (await Promise.all(refs.map((r) => gone(ctx, r)))).map((g) => !g);
        }
        Object.assign(evidence, { delete: brief(del), goneAfterDelete, undo, backAfterOneUndo });
        const observed = {
          deleted: rb(del).deleted ?? null,
          goneAfterDelete,
          backAfterOneUndo,
          undoName: rb(del).undoName ?? null,
        };
        let p: ProbeResult;
        if (!del.ok || !goneAfterDelete.every(Boolean))
          p = killed("P-W1-05", observed, `delete: ${del.code ?? "not all gone"}`);
        else if (!backAfterOneUndo.every(Boolean)) {
          p = killed("P-W1-05", observed, "one undo did not restore all three: not one undo step");
          // The undo stack is now out of step with the debt: the sweep removes what is left.
          ctx.debt.undos = 0;
        } else p = settled("P-W1-05", observed, "DeleteEntities is one undo step");
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "bulk delete"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-26-layers",
      block: "W1.2",
      title:
        "wb_layers create, createFolder, rename/move/delete on a folder AND on a layer path, setActive, lock, unlock; setLayer; CreateEntityExt on a layer (P-W1-08, P-W1-07, P-W1-03 layer half)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "each call reads back in tree; the folder calls answer for a layer path or refuse; setLayer moves the entity and get names the layer; create with layer lands there; undo restores; persistence is not checked (never saved)",
      kill_criterion:
        "a folder call rejects a layer path: KILLED (rename/delete/move folders only); setLayer fails: KILLED (row blocked:P-W1-07); layer ignored on create: P-W1-03 KILLED",
      side_effects: ["layer W1_LA, folder W1_F in memory, undone or deleted"],
      rollback: `${MEM_ROLLBACK}; leftover W1_ layers deleted with wb_layers delete`,
      probes: ["P-W1-08", "P-W1-07", "P-W1-03"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_layers", "tree"),
        tc("wb_layers", "create", { name: "W1_LA" }),
        tc("wb_layers", "createFolder", { name: "W1_F" }),
        tc("wb_layers", "rename", { layer: "W1_F", name: "W1_F2" }),
        tc("wb_layers", "rename", { layer: "<layer path>", name: "W1_LB" }),
        tc("wb_layers", "move", { layer: "<layer path>", parentPath: "W1_F2" }),
        tc("wb_layers", "setActive", { layer: "<layer path>" }),
        tc("wb_layers", "lock", { layer: "<layer path>" }),
        tc("wb_layers", "unlock", { layer: "<layer path>" }),
        tc("wb_layers", "setActive", { layer: "<previous>" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_LE", layer: "<layer path>" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_LS" }),
        tc("wb_entity", "setLayer", { entities: ["name:W1_LS"], layer: "<layer path>" }),
        tc("wb_entity", "get", { entity: "name:W1_LS" }),
        tc(
          "wb_layers",
          "delete",
          { layer: "<layer path>", confirm: true },
          { note: "refused NOT_EMPTY: it holds W1_LE and W1_LS (W1.7 run 7)" },
        ),
        tc("wb_layers", "delete", { layer: "<layer path>", withContents: true }),
        tc("wb_layers", "delete", { layer: "<layer path>", withContents: true, confirm: true }),
        tc("wb_layers", "delete", { layer: "W1_F2" }),
        tc("wb_layers", "tree"),
        ...undoPlan(12),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const probes: ProbeResult[] = [];
        const tree0 = await ctx.tool("wb_layers", { action: "tree" });
        const prevActive = S(rb(tree0).activeLayer);
        ctx.debt.restorers.push({
          label: `setActive ${prevActive}`,
          fn: () =>
            ctx.tool("wb_layers", { action: "setActive", layer: prevActive }, { restore: true }),
        });
        const cl = await ctx.tool("wb_layers", { action: "create", name: "W1_LA" });
        const cf = await ctx.tool("wb_layers", { action: "createFolder", name: "W1_F" });
        let layerPath = S(rb(cl).path) || "W1_LA";
        const folderPath = S(rb(cf).path) || "W1_F";
        const rf = await ctx.tool("wb_layers", {
          action: "rename",
          layer: folderPath,
          name: "W1_F2",
        });
        // A refused rename leaves the folder where it was: keep its real path (the first live run
        // carried on with 'W1_F2', which did not exist, and every later call missed).
        const folder2 = rf.ok ? S(rb(rf).after) || "W1_F2" : folderPath;
        const rl = await ctx.tool("wb_layers", {
          action: "rename",
          layer: layerPath,
          name: "W1_LB",
        });
        if (rl.ok && S(rb(rl).after)) layerPath = S(rb(rl).after);
        const mv = await ctx.tool("wb_layers", {
          action: "move",
          layer: layerPath,
          parentPath: folder2,
        });
        if (mv.ok && S(rb(mv).after)) layerPath = S(rb(mv).after);
        const sa = await ctx.tool("wb_layers", { action: "setActive", layer: layerPath });
        const lk = await ctx.tool("wb_layers", { action: "lock", layer: layerPath });
        const ul = await ctx.tool("wb_layers", { action: "unlock", layer: layerPath });
        const back = await ctx.tool(
          "wb_layers",
          { action: "setActive", layer: prevActive },
          { restore: true },
        );
        ctx.debt.restorers.pop();
        const treeMid = await ctx.tool("wb_layers", { action: "tree" });
        // P-W1-03 layer half: CreateEntityExt on the new layer.
        const le = await create(ctx, "W1_LE", { layer: layerPath });
        const leGet = le.r.ok ? await get(ctx, le.ref) : null;
        // P-W1-07: setLayer and the read back.
        const ls = await create(ctx, "W1_LS");
        const sl = ls.r.ok
          ? await ctx.tool("wb_entity", {
              action: "setLayer",
              entities: [ls.ref],
              layer: layerPath,
            })
          : null;
        const lsGet = ls.r.ok ? await get(ctx, ls.ref) : null;
        // Delete on a non-empty layer: a plain delete is refused NOT_EMPTY (W1.7 run 7: the engine
        // call left a pathless layer holding the entity); withContents is a dry run without confirm,
        // then deletes the entities and the layer in one undo point.
        const delRefused = await ctx.tool("wb_layers", {
          action: "delete",
          layer: layerPath,
          confirm: true,
        });
        const delDry = await ctx.tool("wb_layers", {
          action: "delete",
          layer: layerPath,
          withContents: true,
        });
        const delLayer = await ctx.tool("wb_layers", {
          action: "delete",
          layer: layerPath,
          withContents: true,
          confirm: true,
        });
        const delFolder = await ctx.tool("wb_layers", { action: "delete", layer: folder2 });
        const treeEnd = await ctx.tool("wb_layers", { action: "tree" });
        Object.assign(evidence, {
          tree0: brief(tree0),
          create: brief(cl),
          createFolder: brief(cf),
          renameFolder: brief(rf),
          renameLayer: brief(rl),
          moveLayer: brief(mv),
          setActive: brief(sa),
          lock: brief(lk),
          unlock: brief(ul),
          setActiveBack: brief(back),
          treeMid: brief(treeMid),
          createOnLayer: brief(le.r),
          createOnLayerGet: leGet ? brief(leGet) : null,
          setLayer: sl ? brief(sl) : null,
          setLayerGet: lsGet ? brief(lsGet) : null,
          deleteRefused: brief(delRefused),
          deleteDry: brief(delDry),
          deleteLayer: brief(delLayer),
          deleteFolder: brief(delFolder),
          treeEnd: brief(treeEnd),
        });
        if (!cl.ok || !cf.ok) fails.push("create or createFolder failed");
        if (!sa.ok || !lk.ok || !ul.ok || !back.ok) {
          const which = [
            ["setActive", sa],
            ["lock", lk],
            ["unlock", ul],
            ["setActive back", back],
          ]
            .filter(([, r]) => !(r as ToolResponse).ok)
            .map(([n, r]) => `${n as string} ${(r as ToolResponse).code}`);
          fails.push(`setActive, lock or unlock failed: ${which.join(", ")}`);
        }
        // The tree must read the moved layer as a layer and the folder as a folder (the first live
        // run's tree listed the new folder as a layer with id 0, the default layer's id).
        const midRows = Array.isArray(rb(treeMid).rows) ? (rb(treeMid).rows as Raw[]) : [];
        const kindOf = (path: string): string =>
          S(midRows.find((r) => S(r.path) === path)?.kind) || "absent";
        evidence.treeKinds = { [layerPath]: kindOf(layerPath), [folder2]: kindOf(folder2) };
        if (kindOf(layerPath) !== "layer")
          fails.push(`tree reads ${layerPath} as ${kindOf(layerPath)}`);
        if (kindOf(folder2) !== "folder") fails.push(`tree reads ${folder2} as ${kindOf(folder2)}`);
        const p08obs = {
          folderRename: brief(rf),
          layerRename: brief(rl),
          layerMove: brief(mv),
          layerDeleteRefused: delRefused.ok ? "not refused" : (delRefused.code ?? null),
          layerDeleteDryRun: delDry.readback ?? null,
          layerDelete: brief(delLayer),
          folderDelete: brief(delFolder),
        };
        const layerPathCalls = [rl, mv, delLayer];
        if (delRefused.ok || delRefused.code !== "NOT_EMPTY")
          fails.push(
            `a plain delete of the non-empty layer answered ${delRefused.ok ? "ok" : String(delRefused.code)}, not NOT_EMPTY`,
          );
        probes.push(
          !rf.ok || !delFolder.ok
            ? killed(
                "P-W1-08",
                p08obs,
                "a folder call failed on a folder path: that action ships refused UNPROVEN",
              )
            : layerPathCalls.some((r) => !r.ok)
              ? killed(
                  "P-W1-08",
                  p08obs,
                  "the folder calls reject a layer path: rename/delete/move apply to folders only (layer rows blocked:P-W1-08)",
                )
              : partial(
                  "P-W1-08",
                  p08obs,
                  "folder calls take folder and layer paths in memory; persistence after save and reopen is not checked (the world is never saved)",
                ),
        );
        const p07obs = {
          setLayer: sl ? brief(sl) : null,
          layerReadBack: lsGet ? rb(lsGet).layer : null,
          wanted: layerPath,
        };
        probes.push(
          !sl?.ok
            ? killed("P-W1-07", p07obs, `setLayer failed: ${sl?.code} ${sl?.message}`)
            : S(rb(lsGet ?? ({} as ToolResponse)).layer) === layerPath
              ? partial(
                  "P-W1-07",
                  p07obs,
                  "moved in memory and read back; persistence after save and reopen is not checked (the world is never saved)",
                )
              : killed("P-W1-07", p07obs, "setLayer answered ok but get reads another layer"),
        );
        const p03obs = {
          wantedLayer: layerPath,
          createdLayer: rb(le.r).layer ?? null,
          getLayer: leGet ? rb(leGet).layer : null,
        };
        probes.push(
          le.r.ok && S(p03obs.getLayer) === layerPath
            ? partial(
                "P-W1-03",
                p03obs,
                "CreateEntityExt placed it on the chosen layer (parent half in w1-21)",
              )
            : killed(
                "P-W1-03",
                p03obs,
                "the layer argument was ignored: create then SetEntitySubsceneLayer",
              ),
        );
        await settle(ctx, evidence, fails);
        // Leftover W1_ layers or folders (an undo that does not reverse a folder call): delete them.
        const t = await ctx.tool("wb_layers", { action: "tree" });
        const rows = Array.isArray(rb(t).rows) ? (rb(t).rows as Raw[]) : [];
        const left = rows
          .map((r) => S(r.path))
          .filter((p) => p.split("/").some((seg) => seg.startsWith(NAME_PREFIX)));
        evidence.layersLeft = left;
        for (const path of left.sort((a, b) => b.length - a.length)) {
          const d = await ctx.tool(
            "wb_layers",
            { action: "delete", layer: path, withContents: true, confirm: true },
            { restore: true },
          );
          if (!Array.isArray(evidence.layerCleanup)) evidence.layerCleanup = [];
          (evidence.layerCleanup as unknown[]).push({ path, ...brief(d) });
        }
        if (left.length)
          evidence.layerUndoNote = "the undos left W1_ layers or folders; deleted explicitly";
        return { ...verdictOf(fails, probes, "layers and setLayer read back"), evidence, probes };
      },
    },
    {
      id: "w1-27-select",
      block: "W1.2",
      title: "selection set/add/remove/clear, main read back, prior selection restored (P-W1-09)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "set [A]: 1; add [B]: 2 with main = A; remove [B]: 1; clear: 0; the prior selection restored",
      kill_criterion: "add fails: KILLED (SetEntitySelection with a rebuilt list)",
      side_effects: ["editor selection changed and restored; W1_S1, W1_S2 undone"],
      rollback: `${MEM_ROLLBACK}; select set with the prior ids (or clear)`,
      probes: ["P-W1-09"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_view", "selection"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_S1" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_S2" }),
        tc("wb_view", "select", { mode: "set", entities: ["name:W1_S1"] }),
        tc("wb_view", "select", { mode: "add", entities: ["name:W1_S2"] }),
        tc("wb_view", "selection"),
        tc("wb_view", "select", { mode: "remove", entities: ["name:W1_S2"] }),
        tc("wb_view", "select", { mode: "clear" }),
        tc("wb_view", "select", { mode: "set", entities: ["<prior ids>"] }),
        ...undoPlan(2),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const prior = await ctx.tool("wb_view", { action: "selection", limit: 200 });
        const priorIds = Array.isArray(rb(prior).rows)
          ? (rb(prior).rows as Raw[])
              .map((r) => S(r.id))
              .filter(Boolean)
              .map((id) => (id.startsWith("id:") ? id : `id:${id}`))
          : [];
        const restore = (): Promise<ToolResponse> =>
          priorIds.length
            ? ctx.tool(
                "wb_view",
                { action: "select", mode: "set", entities: priorIds },
                { restore: true },
              )
            : ctx.tool("wb_view", { action: "select", mode: "clear" }, { restore: true });
        ctx.debt.restorers.push({ label: "restore the prior selection", fn: restore });
        const a = await create(ctx, "W1_S1");
        const b = await create(ctx, "W1_S2");
        const set = await ctx.tool("wb_view", { action: "select", mode: "set", entities: [a.ref] });
        const add = await ctx.tool("wb_view", { action: "select", mode: "add", entities: [b.ref] });
        const two = await ctx.tool("wb_view", { action: "selection" });
        const rem = await ctx.tool("wb_view", {
          action: "select",
          mode: "remove",
          entities: [b.ref],
        });
        const clr = await ctx.tool("wb_view", { action: "select", mode: "clear" });
        const res = await restore();
        ctx.debt.restorers.pop();
        Object.assign(evidence, {
          prior: brief(prior),
          set: brief(set),
          add: brief(add),
          selectionAfterAdd: brief(two),
          remove: brief(rem),
          clear: brief(clr),
          restored: brief(res),
        });
        if (!set.ok || !rem.ok || !clr.ok || !res.ok)
          fails.push("set, remove, clear or the restore failed");
        const observed = {
          countAfterSet: rb(set).selectedCount ?? null,
          countAfterAdd: rb(add).selectedCount ?? null,
          totalAfterAdd: rb(two).total ?? null,
          mainId: rb(two).mainId ?? null,
          firstAddedId: S(rb(a.r).id),
          countAfterRemove: rb(rem).selectedCount ?? null,
          countAfterClear: rb(clr).selectedCount ?? null,
        };
        const mainOk =
          S(observed.mainId).replace(/^id:/, "") === S(observed.firstAddedId).replace(/^id:/, "");
        const p = !add.ok
          ? killed("P-W1-09", observed, `add failed: ${add.code} ${add.message}`)
          : Number(observed.totalAfterAdd) === 2 && mainOk
            ? partial(
                "P-W1-09",
                observed,
                "selection grows by one, main is the first; the panel's look after UpdateSelectionGui is not read hand-free",
              )
            : partial(
                "P-W1-09",
                observed,
                "add answered; count or main differs from the expectation",
              );
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "selection round trip"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-28-visible",
      block: "W1.2",
      title: "setVisible false then true on one entity, get reads it (P-W1-10, editor half)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "get visible false after the first call, true after the second; undo reverses; the .layer diff is not taken (never saved)",
      kill_criterion: "the call fails: KILLED (rows blocked:P-W1-10)",
      side_effects: ["W1_V in memory, hidden and shown, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-10"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_V" }),
        tc("wb_view", "setVisible", { entities: ["name:W1_V"], visible: false }),
        tc("wb_entity", "get", { entity: "name:W1_V" }),
        tc("wb_view", "setVisible", { entities: ["name:W1_V"], visible: true }),
        tc("wb_entity", "get", { entity: "name:W1_V" }),
        ...undoPlan(3),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const v = await create(ctx, "W1_V");
        const off = await ctx.tool("wb_view", {
          action: "setVisible",
          entities: [v.ref],
          visible: false,
        });
        const g1 = await get(ctx, v.ref);
        const on = await ctx.tool("wb_view", {
          action: "setVisible",
          entities: [v.ref],
          visible: true,
        });
        const g2 = await get(ctx, v.ref);
        Object.assign(evidence, {
          hide: brief(off),
          getHidden: brief(g1),
          show: brief(on),
          getShown: brief(g2),
        });
        const observed = {
          visibleAfterHide: rb(g1).visible ?? null,
          visibleAfterShow: rb(g2).visible ?? null,
          hideUndoName: rb(off).undoName ?? null,
          showUndoName: rb(on).undoName ?? null,
        };
        const p =
          !off.ok || !on.ok
            ? killed("P-W1-10", observed, `setVisible failed: ${off.code ?? on.code}`)
            : partial(
                "P-W1-10",
                observed,
                observed.visibleAfterHide === false && observed.visibleAfterShow === true
                  ? "toggles and reads back; whether it writes the .layer needs a save (never done)"
                  : "answered ok; the read back does not follow the toggle",
              );
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "visibility toggled and undone"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-29-camera",
      block: "W1.2",
      title: "setCamera and read back, focus on an entity, camera restored (P-W1-11)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "camera after setCamera within 0.01 of the set point; screen size positive; focus moves the camera; the old position and look restored",
      kill_criterion:
        "no read back: KILLED (setCamera returns the request with a warning); screen size 0: KILLED (placeAtPixel and underCursor refuse NO_VIEWPORT)",
      side_effects: ["viewport camera moved and restored; W1_F1 undone"],
      rollback: "setCamera to the camera read before (coords and direction); undo the create",
      probes: ["P-W1-11"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_view", "camera"),
        tc("wb_view", "setCamera", { coords: "20 15 20", look: "-1 -0.5 -1" }),
        tc("wb_view", "camera"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_F1", coords: "30 0 30" }),
        tc("wb_view", "focus", { entity: "name:W1_F1", distance: 8 }),
        tc("wb_view", "camera"),
        tc("wb_view", "setCamera", { coords: "<before>", look: "<before direction>" }),
        ...undoPlan(1),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const before = await ctx.tool("wb_view", { action: "camera" });
        const bc = S(rb(before).coords);
        const bd = S(rb(before).direction);
        const restore = (): Promise<ToolResponse> =>
          ctx.tool(
            "wb_view",
            { action: "setCamera", coords: bc, look: bd || "0 0 1" },
            { restore: true },
          );
        if (vec(bc).length) ctx.debt.restorers.push({ label: "camera restore", fn: restore });
        const set = await ctx.tool("wb_view", {
          action: "setCamera",
          coords: "20 15 20",
          look: "-1 -0.5 -1",
        });
        const after = await ctx.tool("wb_view", { action: "camera" });
        const f = await create(ctx, "W1_F1", { coords: "30 0 30" });
        const focus = f.r.ok
          ? await ctx.tool("wb_view", { action: "focus", entity: f.ref, distance: 8 })
          : null;
        const afterFocus = await ctx.tool("wb_view", { action: "camera" });
        const res = vec(bc).length ? await restore() : null;
        const afterRestore = await ctx.tool("wb_view", { action: "camera" });
        if (vec(bc).length) ctx.debt.restorers.pop();
        Object.assign(evidence, {
          before: brief(before),
          setCamera: brief(set),
          after: brief(after),
          focus: focus ? brief(focus) : null,
          afterFocus: brief(afterFocus),
          restore: res ? brief(res) : null,
          afterRestore: brief(afterRestore),
        });
        const observed = {
          requested: "20 15 20",
          readBack: rb(after).coords ?? null,
          directionAfter: rb(after).direction ?? null,
          screen: [rb(after).screenWidth ?? null, rb(after).screenHeight ?? null],
          focusAfter: rb(afterFocus).coords ?? null,
        };
        const w = Number(rb(after).screenWidth);
        let p: ProbeResult;
        if (!set.ok)
          p = killed("P-W1-11", observed, `setCamera failed: ${set.code} ${set.message}`);
        else if (!(w > 0))
          p = killed(
            "P-W1-11",
            observed,
            "screen size 0: placeAtPixel and underCursor refuse NO_VIEWPORT",
          );
        else if (!near(vec(rb(after).coords), [20, 15, 20], 0.01))
          p = killed("P-W1-11", observed, "GetCurrentCamera does not read the set point back");
        else
          p = settled(
            "P-W1-11",
            observed,
            "SetCamera moved the viewport; GetCurrentCamera reads it back",
          );
        if (res && !near(vec(rb(afterRestore).coords), vec(bc), 0.01))
          fails.push("the camera was not restored");
        if (focus && !focus.ok) fails.push(`focus: ${focus.code} ${focus.message}`);
        await settle(ctx, evidence, fails);
        return {
          ...verdictOf(fails, [p], "camera set, read back and restored"),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w1-30-trace",
      block: "W1.2",
      title: "an entity placed in front of the camera, trace at the viewport centre (P-W1-12)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected: "the centre trace hits and names the entity under the centre",
      kill_criterion: "always false: KILLED (trace rows blocked:P-W1-12)",
      side_effects: ["W1_T in memory, undone; camera moved and restored"],
      rollback: `${MEM_ROLLBACK}; camera restored`,
      probes: ["P-W1-12"],
      dependsOn: ["P-W1-11"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_view", "camera"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_T", coords: "40 0 40" }),
        tc("wb_view", "setCamera", { coords: "40 0.1 38", look: "0 0 1" }),
        tc("wb_view", "trace", { x: "<w/2>", y: "<h/2>" }),
        tc("wb_view", "setCamera", { coords: "<before>", look: "<before>" }),
        ...undoPlan(1),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const before = await ctx.tool("wb_view", { action: "camera" });
        const w = Number(rb(before).screenWidth);
        const h = Number(rb(before).screenHeight);
        if (!(w > 0 && h > 0))
          return {
            status: "NOT-RUN",
            detail: `screen size ${w}x${h}: no viewport pixel`,
            evidence: { camera: brief(before) },
            probes: [
              partial("P-W1-12", { screenWidth: w, screenHeight: h }, "not sent: no viewport size"),
            ],
          };
        const bc = S(rb(before).coords);
        const bd = S(rb(before).direction) || "0 0 1";
        const restore = (): Promise<ToolResponse> =>
          ctx.tool("wb_view", { action: "setCamera", coords: bc, look: bd }, { restore: true });
        ctx.debt.restorers.push({ label: "camera restore", fn: restore });
        const t = await create(ctx, "W1_T", { coords: "40 0 40" });
        const sc = await ctx.tool("wb_view", {
          action: "setCamera",
          coords: "40 0.1 38",
          look: "0 0 1",
        });
        const x = Math.floor(w / 2);
        const y = Math.floor(h / 2);
        const tr = await ctx.tool("wb_view", { action: "trace", x, y });
        const res = await restore();
        ctx.debt.restorers.pop();
        Object.assign(evidence, {
          create: brief(t.r),
          setCamera: brief(sc),
          pixel: { x, y },
          trace: brief(tr),
          restore: brief(res),
        });
        const observed = { pixel: [x, y], trace: tr.readback ?? null, entityId: S(rb(t.r).id) };
        const hit = rb(tr).hit === true;
        const p =
          !tr.ok || !hit
            ? killed(
                "P-W1-12",
                observed,
                tr.ok
                  ? "no hit on a no-terrain world with an entity under the centre"
                  : `trace failed: ${tr.code}`,
              )
            : S(rb(tr).entity).replace(/^id:/, "") === S(rb(t.r).id).replace(/^id:/, "")
              ? settled("P-W1-12", observed, "the centre trace hits the entity under the centre")
              : partial(
                  "P-W1-12",
                  observed,
                  "the trace hits; the entity named is not the one placed",
                );
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "trace at the centre"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-31-place",
      block: "W1.2",
      title: "placeAtPixel at the viewport centre, get, one undo (P-W1-14)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected: "an entity created at the traced position; one undo removes it",
      kill_criterion: "fails for window 0: KILLED (TraceWorldPos then CreateEntity at the hit)",
      side_effects: ["one entity in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-14"],
      dependsOn: ["P-W1-11"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_view", "camera"),
        tc("wb_view", "placeAtPixel", { x: "<w/2>", y: "<h/2>", prefab: PROP, name: "W1_PX" }),
        tc("wb_entity", "get", { entity: "<id>" }),
        ...undoPlan(1),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const cam = await ctx.tool("wb_view", { action: "camera" });
        const w = Number(rb(cam).screenWidth);
        const h = Number(rb(cam).screenHeight);
        if (!(w > 0 && h > 0))
          return {
            status: "NOT-RUN",
            detail: `screen size ${w}x${h}: no viewport pixel`,
            evidence: { camera: brief(cam) },
            probes: [
              partial("P-W1-14", { screenWidth: w, screenHeight: h }, "not sent: no viewport size"),
            ],
          };
        const x = Math.floor(w / 2);
        const y = Math.floor(h / 2);
        const pl = await ctx.tool("wb_view", {
          action: "placeAtPixel",
          x,
          y,
          prefab: PROP,
          name: "W1_PX",
        });
        const id = S(rb(pl).id);
        const ref = id ? (id.startsWith("id:") ? id : `id:${id}`) : "";
        const g = ref ? await get(ctx, ref) : null;
        let oneUndo: boolean | null = null;
        if (pl.ok) {
          const u = await ctx.undo();
          evidence.undo = u;
          oneUndo = await gone(ctx, ref);
        }
        Object.assign(evidence, {
          pixel: { x, y },
          place: brief(pl),
          get: g ? brief(g) : null,
          goneAfterOneUndo: oneUndo,
        });
        const observed = {
          pixel: [x, y],
          placed: pl.readback ?? null,
          getCoords: g ? rb(g).coords : null,
          oneUndoRemoves: oneUndo,
          window: 0,
        };
        const p = !pl.ok
          ? killed("P-W1-14", observed, `window 0 failed: ${pl.code} ${pl.message}`)
          : oneUndo
            ? settled(
                "P-W1-14",
                observed,
                "created at the centre pixel (window 0); one undo removes it",
              )
            : partial("P-W1-14", observed, "created; one undo did not remove it");
        if (oneUndo === false) ctx.debt.undos = 0;
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "placeAtPixel"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-32-comments",
      block: "W1.2",
      title:
        "addComment, comments lists it, undo; annotate add/move/remove on an entity, undone (P-W1-20)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the comment appears in comments as CommentEntity and goes with one undo; annotate answers each mode; undo restores",
      kill_criterion: "addComment fails: FAIL; annotate fails: KILLED; categories empty: recorded",
      side_effects: ["one CommentEntity and W1_N in memory, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-20"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_world", "addComment", {
          text: "W1 comment",
          coords: "5 1 5",
          color: "1 0 0",
          size: 1,
        }),
        tc("wb_world", "comments"),
        ...undoPlan(1),
        tc("wb_world", "comments"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_N" }),
        tc("wb_world", "annotate", { entity: "name:W1_N", mode: "add", text: "W1 note" }),
        tc("wb_world", "annotate", { entity: "name:W1_N", mode: "move", coords: "6 1 6" }),
        tc("wb_world", "annotate", { entity: "name:W1_N", mode: "remove" }),
        ...undoPlan(4),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const c0 = await ctx.tool("wb_world", { action: "comments" });
        const add = await ctx.tool("wb_world", {
          action: "addComment",
          text: "W1 comment",
          coords: "5 1 5",
          color: "1 0 0",
          size: 1,
        });
        const c1 = await ctx.tool("wb_world", { action: "comments" });
        let undo: UndoResult | null = null;
        if (add.ok) undo = await ctx.undo();
        const c2 = await ctx.tool("wb_world", { action: "comments" });
        const n = await create(ctx, "W1_N");
        const aAdd = await ctx.tool("wb_world", {
          action: "annotate",
          entity: n.ref,
          mode: "add",
          text: "W1 note",
        });
        const aMove = await ctx.tool("wb_world", {
          action: "annotate",
          entity: n.ref,
          mode: "move",
          coords: "6 1 6",
        });
        const aRem = await ctx.tool("wb_world", {
          action: "annotate",
          entity: n.ref,
          mode: "remove",
        });
        Object.assign(evidence, {
          commentsBefore: brief(c0),
          addComment: brief(add),
          commentsAfterAdd: brief(c1),
          undo,
          commentsAfterUndo: brief(c2),
          annotateAdd: brief(aAdd),
          annotateMove: brief(aMove),
          annotateRemove: brief(aRem),
        });
        const total = (r: ToolResponse): number => Number(rb(r).total ?? NaN);
        const observed = {
          totals: [total(c0), total(c1), total(c2)],
          categories: rb(c1).categories ?? null,
          commentId: rb(add).id ?? null,
          annotate: [aAdd, aMove, aRem].map((r) => ({
            ok: r.ok,
            code: r.code ?? null,
            readback: r.readback ?? null,
          })),
        };
        if (!add.ok) fails.push(`addComment: ${add.code} ${add.message}`);
        else if (!(total(c1) === total(c0) + 1 && total(c2) === total(c0)))
          fails.push(`comment totals ${observed.totals.join(" -> ")}`);
        const p = [aAdd, aMove, aRem].some((r) => !r.ok)
          ? killed(
              "P-W1-20",
              observed,
              "an annotate call failed (the note is a CommentEntity made, moved and deleted as an entity since run 6)",
            )
          : partial(
              "P-W1-20",
              observed,
              "the calls answer; the viewport look is read by hand in w1-72",
            );
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "comments"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-33-container-entity",
      block: "W1.2",
      title:
        "wb_container on entity:<ref>: describe, get, set, clear, arrayAdd, setClass, arrayRemove, arrayMove (refused), each undone (P-W1-22)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "set reads back; clear answers; arrayAdd grows components by one; setClass replaces the new element's class; arrayRemove removes it; arrayMove on an entity refuses UNPROVEN; undo restores each",
      kill_criterion:
        "setClass on an entity fails: KILLED (ChangeObjectClass only); arrayMove is refused before sending (SetObjectVariableMember not reached): recorded",
      side_effects: ["W1_X in memory with its components edited, undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W1-22"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_X" }),
        tc("wb_container", "describe", { target: "entity:name:W1_X" }),
        tc("wb_container", "get", { target: "entity:name:W1_X", path: "coords" }),
        tc("wb_container", "set", { target: "entity:name:W1_X", path: "coords", value: "1 2 3" }),
        tc("wb_container", "clear", { target: "entity:name:W1_X", path: "coords" }),
        tc("wb_container", "arrayAdd", {
          target: "entity:name:W1_X",
          path: "components",
          className: "Hierarchy",
        }),
        tc("wb_container", "setClass", {
          target: "entity:name:W1_X",
          path: "components[<n>]",
          className: "RplComponent",
        }),
        tc("wb_container", "arrayRemove", {
          target: "entity:name:W1_X",
          path: "components",
          index: "<n>",
        }),
        tc(
          "wb_container",
          "arrayMove",
          { target: "entity:name:W1_X", path: "components", index: 0, toIndex: 1 },
          { note: "refused UNPROVEN in TS: nothing sent" },
        ),
        ...undoPlan(6),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const x = await create(ctx, "W1_X");
        if (!x.r.ok)
          throw new StopBattery("stopped", `create failed: ${x.r.code}`, { create: brief(x.r) });
        const target = `entity:${x.ref}`;
        const comps0 = Array.isArray(rb(await get(ctx, x.ref)).components)
          ? (rb(await get(ctx, x.ref)).components as unknown[]).length
          : -1;
        const d = await ctx.tool("wb_container", { action: "describe", target });
        const g0 = await ctx.tool("wb_container", { action: "get", target, path: "coords" });
        const s = await ctx.tool("wb_container", {
          action: "set",
          target,
          path: "coords",
          value: "1 2 3",
        });
        const g1 = await ctx.tool("wb_container", { action: "get", target, path: "coords" });
        const cl = await ctx.tool("wb_container", { action: "clear", target, path: "coords" });
        const g2 = await ctx.tool("wb_container", { action: "get", target, path: "coords" });
        const add = await ctx.tool("wb_container", {
          action: "arrayAdd",
          target,
          path: "components",
          className: "Hierarchy",
        });
        const after = await get(ctx, x.ref);
        const comps1 = Array.isArray(rb(after).components)
          ? (rb(after).components as unknown[]).length
          : -1;
        const at = comps1 > 0 ? comps1 - 1 : 0;
        const sc = add.ok
          ? await ctx.tool("wb_container", {
              action: "setClass",
              target,
              path: `components[${at}]`,
              className: "RplComponent",
            })
          : null;
        const afterSc = await get(ctx, x.ref);
        const rm = add.ok
          ? await ctx.tool("wb_container", {
              action: "arrayRemove",
              target,
              path: "components",
              index: at,
            })
          : null;
        const afterRm = await get(ctx, x.ref);
        const mv = await ctx.tool("wb_container", {
          action: "arrayMove",
          target,
          path: "components",
          index: 0,
          toIndex: 1,
        });
        Object.assign(evidence, {
          describe: brief(d),
          getBefore: brief(g0),
          set: brief(s),
          getAfterSet: brief(g1),
          clear: brief(cl),
          getAfterClear: brief(g2),
          arrayAdd: brief(add),
          componentsBefore: comps0,
          componentsAfterAdd: comps1,
          setClass: sc ? brief(sc) : null,
          componentsAfterSetClass: rb(afterSc).components ?? null,
          arrayRemove: rm ? brief(rm) : null,
          componentsAfterRemove: Array.isArray(rb(afterRm).components)
            ? (rb(afterRm).components as unknown[]).length
            : -1,
          arrayMove: brief(mv),
        });
        // Container entity writes are undoable edits without an undoName in every shape: counted here.
        for (const r of [s, cl, add, sc, rm]) if (r?.ok && !S(rb(r).undoName)) ctx.debt.undos++;
        if (!d.ok || !g0.ok) fails.push("describe or get failed");
        if (!s.ok) fails.push(`set: ${s.code} ${s.message}`);
        if (mv.ok || mv.code !== "UNPROVEN")
          fails.push(`arrayMove on an entity answered ${mv.ok ? "ok" : mv.code}, not UNPROVEN`);
        const observed = {
          setClass: sc ? { ok: sc.ok, code: sc.code ?? null, readback: sc.readback ?? null } : null,
          classAfter: rb(afterSc).components ?? null,
          arrayMove: { ok: mv.ok, code: mv.code ?? null, message: mv.message ?? null },
        };
        const p = !sc
          ? partial(
              "P-W1-22",
              observed,
              "arrayAdd failed, setClass not sent; arrayMove refused UNPROVEN in TS (SetObjectVariableMember not reached)",
            )
          : !sc.ok
            ? killed(
                "P-W1-22",
                observed,
                `setClass on an entity failed (${sc.code}): setClass uses ChangeObjectClass only`,
              )
            : partial(
                "P-W1-22",
                observed,
                "setClass replaced the element; arrayMove on an entity is refused UNPROVEN before sending, so SetObjectVariableMember stays unproven",
              );
        await settle(ctx, evidence, fails);
        return {
          ...verdictOf(fails, [p], "entity container writes undone"),
          evidence,
          probes: [p],
        };
      },
    },

    // ── W1.3 file writes under _throwaway/W1/ ──
    {
      id: "w1-40-container-path",
      block: "W1.3",
      title: `wb_container path writes on ${PLANT_CONF}: dry runs, set+save, clear, arrayAdd, arrayMove, arrayRemove, setClass, line diff (P-W1-21)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "each dry run changes no file; each confirmed write changes only the planted file, and only the intended lines; get reads the new value",
      kill_criterion:
        "a save rewrites unrelated lines: KILLED (path writes stay refused UNPROVEN); CreateContainer null: arrayAdd/setClass KILLED; any file outside the plant changes: STOP",
      side_effects: [`${PLANT_CONF} rewritten`],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/",
      probes: ["P-W1-21"],
      writes: [PLANT_CONF],
      plan: () => [
        tc("wb_container", "describe", {
          target: confTarget,
          mode: "page",
          limit: 200,
          fields: DESCRIBE_FIELDS,
        }),
        tc("wb_container", "set", { target: confTarget, path: "<scalar>", value: "<new>" }),
        tc("wb_container", "set", {
          target: confTarget,
          path: "<scalar>",
          value: "<new>",
          confirm: true,
        }),
        tc("wb_container", "get", { target: confTarget, path: "<scalar>" }),
        tc("wb_container", "clear", { target: confTarget, path: "<scalar>", confirm: true }),
        tc("wb_container", "arrayAdd", {
          target: confTarget,
          path: "<array>",
          className: "<class>",
          confirm: true,
        }),
        tc("wb_container", "arrayMove", {
          target: confTarget,
          path: "<array>",
          index: 0,
          toIndex: 1,
          confirm: true,
        }),
        tc("wb_container", "arrayRemove", {
          target: confTarget,
          path: "<array>",
          index: "<added>",
          confirm: true,
        }),
        tc("wb_container", "setClass", {
          target: confTarget,
          path: "<object>",
          className: "<class>",
          confirm: true,
        }),
        tc("wb_container", "save", { target: confTarget }),
        tc("wb_container", "save", { target: confTarget, confirm: true }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const file = abs(ctx.opts.sandboxDir, PLANT_CONF);
        const others0 = sandboxHashes(ctx.opts.sandboxDir, ctx.deps);
        const text = (): string => ctx.deps.readBytes(file).toString("utf-8");
        const t0 = text();
        // Ask for the path and objectClass columns (the default page has name, type and value
        // only) and match the engine's type names (INTEGER, SCALAR, BOOLEAN, STRING, OBJECT,
        // OBJECT_ARRAY): the first live run asked for neither and found "no scalar".
        const d = await ctx.tool("wb_container", {
          action: "describe",
          target: confTarget,
          mode: "page",
          limit: 200,
          fields: DESCRIBE_FIELDS,
        });
        const rows = Array.isArray(rb(d).rows) ? (rb(d).rows as Raw[]) : [];
        const scalar =
          rows.find((r) => S(r.type) === "INTEGER" && S(r.path) && S(r.set) === "true") ??
          rows.find((r) => /^(INTEGER|SCALAR|BOOLEAN|STRING)$/.test(S(r.type)) && S(r.path));
        const array = rows.find(
          (r) => S(r.type) === "OBJECT_ARRAY" && S(r.objectClass) && S(r.path),
        );
        const object = rows.find((r) => S(r.type) === "OBJECT" && S(r.objectClass) && S(r.path));
        evidence.describe = {
          ok: d.ok,
          code: d.code ?? null,
          rows: rows.length,
          picked: { scalar, array, object },
        };
        if (!d.ok || !scalar) {
          return {
            status: "NOT-RUN",
            detail: "describe found no scalar property to write",
            evidence,
            probes: [partial("P-W1-21", { describe: brief(d) }, "not sent: no scalar row")],
          };
        }
        const sp = S(scalar.path);
        const oldValue = S(scalar.value);
        const newValue = /BOOLEAN/i.test(S(scalar.type))
          ? oldValue === "1" || oldValue === "true"
            ? "0"
            : "1"
          : /STRING/i.test(S(scalar.type))
            ? "W1"
            : String(Number(oldValue || 0) + 1);
        const steps: Raw[] = [];
        const write = async (label: string, args: Raw): Promise<ToolResponse> => {
          const before = text();
          const dry = await ctx.tool("wb_container", { ...args, target: confTarget });
          const dryChanged = text() !== before;
          const real = await ctx.tool("wb_container", {
            ...args,
            target: confTarget,
            confirm: true,
          });
          const after = text();
          const diff = lineDiffCount(before, after);
          steps.push({
            label,
            dry: brief(dry),
            dryChanged,
            confirm: brief(real),
            changedLines: diff,
          });
          if (dryChanged) fails.push(`${label}: the dry run changed the file`);
          return real;
        };
        const s = await write("set", { action: "set", path: sp, value: newValue });
        const g = await ctx.tool("wb_container", { action: "get", target: confTarget, path: sp });
        steps.push({ label: "get", ...brief(g) });
        const c = await write("clear", { action: "clear", path: sp });
        const arr = array ? S(array.path) : "";
        const elemClass = array ? S(array.objectClass) : "";
        const add =
          arr && elemClass
            ? await write("arrayAdd", { action: "arrayAdd", path: arr, className: elemClass })
            : null;
        const mv = arr
          ? await write("arrayMove", { action: "arrayMove", path: arr, index: 0, toIndex: 1 })
          : null;
        const rm = add?.ok
          ? await write("arrayRemove", {
              action: "arrayRemove",
              path: arr,
              index: Number(field(rb(add), "index") ?? 0),
            })
          : null;
        const sc = object
          ? await write("setClass", {
              action: "setClass",
              path: S(object.path),
              className: S(object.objectClass),
            })
          : null;
        const sv = await write("save", { action: "save" });
        evidence.writes = steps;
        evidence.oldValue = oldValue;
        evidence.newValue = newValue;
        const others1 = sandboxHashes(ctx.opts.sandboxDir, ctx.deps);
        const outside = changedFiles(others0, others1).filter(
          (f) => !NETZERO_TOLERATED.includes(f),
        );
        if (outside.length)
          throw new StopBattery(
            "stopped",
            `files outside the plant changed: ${outside.join(", ")}`,
            evidence,
          );
        if (!s.ok) fails.push(`set: ${s.code} ${s.message}`);
        if (!sv.ok) fails.push(`save: ${sv.code} ${sv.message}`);
        const setLines = Number(
          field(
            steps.find((x) => x.label === "set"),
            "changedLines",
          ) ?? -1,
        );
        const observed = {
          setChangedLines: setLines,
          setReadBack: rb(g).value ?? rb(g) ?? null,
          refusals: steps
            .filter((x) => field(x.confirm, "code") === "UNPROVEN")
            .map((x) => x.label),
          perWrite: steps.map((x) => ({
            label: x.label,
            ok: field(x.confirm, "ok"),
            code: field(x.confirm, "code") ?? null,
            changedLines: x.changedLines,
          })),
          fileChanged: text() !== t0,
        };
        const refused = [c, add, mv, rm, sc].filter((r) => r && r.code === "UNPROVEN").length;
        const p =
          s.ok && setLines > 2
            ? killed(
                "P-W1-21",
                observed,
                `the set+save rewrote ${setLines} lines: path writes stay refused UNPROVEN`,
              )
            : refused
              ? partial(
                  "P-W1-21",
                  observed,
                  `set+save changed ${setLines} line(s); ${refused} path write(s) still refused UNPROVEN by the handler (not sent to the engine)`,
                )
              : settled(
                  "P-W1-21",
                  observed,
                  "every path write changed only its own lines and reads back",
                );
        return { ...verdictOf(fails, [p], `${steps.length} path writes`), evidence, probes: [p] };
      },
    },
    {
      id: "w1-41-world-files",
      block: "W1.3",
      title:
        "wb_world duplicate (dry, confirm), setWorldEntity (dry, confirm), saveAs (dry run only), open the copy (P-W1-26)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected:
        "duplicate copies the .ent and layers without .meta and registers each with new GUIDs; the copy opens with the same layers and entity count; setWorldEntity edits the copy's default.layer; saveAs's dry run plans save, duplicate, register, setResource and writes nothing",
      kill_criterion:
        "the copy does not open, layers missing or GUID clash: KILLED (duplicate refused UNPROVEN); saveAs is never confirmed (it saves the open world)",
      side_effects: [
        `${DUP_WORLD} and its layers folder and .meta files written; the open world switches to the copy`,
      ],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/; the next step reopens what it needs",
      probes: ["P-W1-26"],
      writes: [DUP_WORLD, `${WORLDS_DIR}/EMCP_W1_Dup_Layers/`],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        tc("wb_layers", "list"),
        tc("wb_entity", "list"),
        tc(
          "wb_world",
          "register",
          { path: DUP_WORLD },
          { toolAction: "duplicate", note: "offline copy in TS (dry run)" },
        ),
        tc(
          "wb_world",
          "register",
          { path: DUP_WORLD, confirm: true },
          { toolAction: "duplicate", note: "offline copy in TS, then register each file" },
        ),
        tc(
          "wb_world",
          "state",
          { to: SAVEAS_WORLD },
          {
            toolAction: "saveAs",
            note: "dry run only: plans save, duplicate, register, setResource; never confirmed",
          },
        ),
        tc(
          "wb_world",
          "state",
          { path: DUP_WORLD },
          { toolAction: "setWorldEntity", note: "offline CST edit (dry run)" },
        ),
        tc(
          "wb_world",
          "state",
          { path: DUP_WORLD, confirm: true },
          { toolAction: "setWorldEntity", note: "offline CST edit of the copy's default.layer" },
        ),
        ...openPlan(DUP_WORLD),
        tc("wb_layers", "list"),
        tc("wb_entity", "list"),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const l0 = await ctx.tool("wb_layers", { action: "list" });
        const e0 = await ctx.tool("wb_entity", { action: "list" });
        const dry = await ctx.tool("wb_world", {
          action: "duplicate",
          path: FIXTURE_WORLD,
          to: DUP_WORLD,
        });
        const dryWrote = ctx.deps.exists(abs(ctx.opts.sandboxDir, DUP_WORLD));
        const dup = await ctx.tool("wb_world", {
          action: "duplicate",
          path: FIXTURE_WORLD,
          to: DUP_WORLD,
          confirm: true,
        });
        const saveAsDry = await ctx.tool("wb_world", { action: "saveAs", to: SAVEAS_WORLD });
        const saveAsWrote = ctx.deps.exists(abs(ctx.opts.sandboxDir, SAVEAS_WORLD));
        const swDry = await ctx.tool("wb_world", { action: "setWorldEntity", path: DUP_WORLD });
        const sw = await ctx.tool("wb_world", {
          action: "setWorldEntity",
          path: DUP_WORLD,
          confirm: true,
        });
        const files = ctx.deps.listTree(abs(ctx.opts.sandboxDir, WORLDS_DIR));
        const metaOf = (rel: string): string => {
          const p = abs(ctx.opts.sandboxDir, `${rel}.meta`);
          return ctx.deps.exists(p) ? ctx.deps.readBytes(p).toString("utf-8") : "";
        };
        const guid = (meta: string): string => /\{([0-9A-Fa-f]{16})\}/.exec(meta)?.[1] ?? "";
        const fixtureGuid = guid(metaOf(FIXTURE_WORLD));
        const dupGuid = guid(metaOf(DUP_WORLD));
        const o = dup.ok ? await openWorld(ctx, DUP_WORLD) : null;
        const l1 = o?.ok ? await ctx.tool("wb_layers", { action: "list" }) : null;
        const e1 = o?.ok ? await ctx.tool("wb_entity", { action: "list" }) : null;
        Object.assign(evidence, {
          layersBefore: brief(l0),
          entitiesBefore: brief(e0),
          duplicateDry: brief(dry),
          dryWrote,
          duplicate: brief(dup),
          saveAsDry: brief(saveAsDry),
          saveAsWrote,
          setWorldEntityDry: brief(swDry),
          setWorldEntity: brief(sw),
          worldFiles: files,
          open: o?.evidence ?? null,
          layersAfter: l1 ? brief(l1) : null,
          entitiesAfter: e1 ? brief(e1) : null,
        });
        if (dryWrote) fails.push("the duplicate dry run wrote the copy");
        if (saveAsWrote) fails.push("the saveAs dry run wrote a file");
        if (!saveAsDry.ok) fails.push(`saveAs dry run: ${saveAsDry.code} ${saveAsDry.message}`);
        if (!swDry.ok || !sw.ok)
          fails.push(`setWorldEntity: ${swDry.code ?? sw.code} ${swDry.message ?? sw.message}`);
        const layerPaths = (r: ToolResponse | null): string[] =>
          r && Array.isArray(rb(r).layers)
            ? (rb(r).layers as Raw[]).map((x) => S(x.path)).sort()
            : [];
        const observed = {
          fixtureGuid,
          copyGuid: dupGuid,
          registered: rb(dup).registered ?? null,
          worldPathAfterOpen: o?.worldPath ?? null,
          layersBefore: layerPaths(l0),
          layersAfter: layerPaths(l1),
          entitiesBefore: rb(e0).total ?? null,
          entitiesAfter: e1 ? rb(e1).total : null,
        };
        let p: ProbeResult;
        if (!dup.ok)
          p = killed("P-W1-26", observed, `duplicate failed: ${dup.code} ${dup.message}`);
        else if (!o?.ok) p = killed("P-W1-26", observed, "the registered copy did not open");
        else if (!dupGuid || dupGuid === fixtureGuid)
          p = killed("P-W1-26", observed, "no new GUID (or a GUID clash)");
        else if (
          JSON.stringify(observed.layersAfter) !== JSON.stringify(observed.layersBefore) ||
          Number(observed.entitiesAfter) !== Number(observed.entitiesBefore)
        )
          p = killed("P-W1-26", observed, "layers or entities missing in the opened copy");
        else
          p = settled(
            "P-W1-26",
            observed,
            "the offline copy opens after RegisterResourceFile with new GUIDs, all layers and entities",
          );
        return { ...verdictOf(fails, [p], "world files"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-42-prefab-files",
      block: "W1.3",
      title:
        "createTemplate from an entity, getAncestor, clone and createChild of the prop (dry runs, then confirm) (P-W1-19)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "each dry run writes nothing; confirm writes a project .et and its .meta under prefabs/; the child's ancestor is the prop; no prompt (-scriptAuthorizeAll)",
      kill_criterion:
        "no .meta: KILLED (follow with RegisterResourceFile); a prompt: HANDOFF (both need the flag, DEC-053)",
      side_effects: [
        `${TEMPLATE_ET}, ${CLONE_ET}, ${CHILD_ET} and their .meta; W1_Q in memory and the three writes' undo steps, all undone`,
      ],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/",
      probes: ["P-W1-19"],
      writes: [TEMPLATE_ET, CLONE_ET, CHILD_ET],
      plan: () => [
        tc("wb_entity", "create", { prefab: PROP, name: "W1_Q" }),
        tc("wb_prefabs", "getAncestor", { entity: "name:W1_Q" }),
        tc("wb_prefabs", "createTemplate", { entity: "name:W1_Q", path: TEMPLATE_ET }),
        tc("wb_prefabs", "createTemplate", {
          entity: "name:W1_Q",
          path: TEMPLATE_ET,
          confirm: true,
        }),
        tc("wb_prefabs", "clone", { prefab: PROP, path: CLONE_ET }),
        tc("wb_prefabs", "clone", { prefab: PROP, path: CLONE_ET, confirm: true }),
        tc("wb_prefabs", "createChild", { prefab: PROP, path: CHILD_ET }),
        tc("wb_prefabs", "createChild", { prefab: PROP, path: CHILD_ET, confirm: true }),
        // create, createTemplate, clone and createChild: one undo step each (each answers undoName).
        ...undoPlan(4),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const q = await create(ctx, "W1_Q");
        const anc = q.r.ok
          ? await ctx.tool("wb_prefabs", { action: "getAncestor", entity: q.ref })
          : null;
        const pairs: Array<[string, Raw, string]> = [
          [
            "createTemplate",
            { action: "createTemplate", entity: q.ref, path: TEMPLATE_ET },
            TEMPLATE_ET,
          ],
          ["clone", { action: "clone", prefab: PROP, path: CLONE_ET }, CLONE_ET],
          ["createChild", { action: "createChild", prefab: PROP, path: CHILD_ET }, CHILD_ET],
        ];
        const out: Raw[] = [];
        for (const [label, args, rel] of pairs) {
          if (label === "createTemplate" && !q.r.ok) continue;
          const dry = await ctx.tool("wb_prefabs", args);
          const dryWrote = ctx.deps.exists(abs(ctx.opts.sandboxDir, rel));
          const real = await ctx.tool("wb_prefabs", { ...args, confirm: true });
          const et = ctx.deps.exists(abs(ctx.opts.sandboxDir, rel));
          const meta = ctx.deps.exists(abs(ctx.opts.sandboxDir, `${rel}.meta`));
          out.push({
            label,
            dry: brief(dry),
            dryWrote,
            confirm: brief(real),
            etExists: et,
            metaExists: meta,
          });
          if (dryWrote) fails.push(`${label}: the dry run wrote the file`);
        }
        const childText = ctx.deps.exists(abs(ctx.opts.sandboxDir, CHILD_ET))
          ? ctx.deps.readBytes(abs(ctx.opts.sandboxDir, CHILD_ET)).toString("utf-8").slice(0, 400)
          : null;
        Object.assign(evidence, {
          create: brief(q.r),
          getAncestor: anc ? brief(anc) : null,
          files: out,
          childHead: childText,
        });
        if (anc && !anc.ok) fails.push(`getAncestor: ${anc.code} ${anc.message}`);
        const tpl = out.find((x) => x.label === "createTemplate");
        if (tpl && field(tpl.confirm, "ok") !== true) fails.push("createTemplate failed");
        const observed = {
          clone: out.find((x) => x.label === "clone") ?? null,
          createChild: out.find((x) => x.label === "createChild") ?? null,
          childNamesProp: childText ? childText.includes(PROP.slice(1, 17)) : null,
        };
        const both = [observed.clone, observed.createChild] as Array<Raw | null>;
        const p = both.some((x) => !x || field(x.confirm, "ok") !== true)
          ? killed("P-W1-19", observed, "ClonePrefab or CreateChildPrefab failed")
          : both.some((x) => x?.metaExists !== true)
            ? killed("P-W1-19", observed, "no .meta: follow with RegisterResourceFile")
            : settled(
                "P-W1-19",
                observed,
                `both wrote a registered .et without a prompt; the child ${observed.childNamesProp ? "names" : "does not name"} the prop's GUID`,
              );
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "prefab files"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-43-prefab-edit",
      block: "W1.3",
      title: `open ${TEMPLATE_ET} with setResource; editState (P-W1-18, edit-mode half)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected: "IsPrefabEditMode true and the root's source named",
      kill_criterion:
        "edit mode not entered: KILLED (addMembers/removeMembers ship refused UNPROVEN; w1-44 SKIPPED)",
      side_effects: ["the World Editor switches to prefab edit mode on the throwaway template"],
      rollback: "the next world step reopens a world; nothing saved here",
      probes: ["P-W1-18"],
      writes: [],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        tc("wb_module", "open", { moduleName: "WorldEditor" }),
        tc("wb_module", "setResource", { moduleName: "WorldEditor", path: TEMPLATE_ET }),
        tc("wb_prefabs", "editState"),
      ],
      run: async (ctx) => {
        if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, TEMPLATE_ET)))
          return {
            status: "NOT-RUN",
            detail: `${TEMPLATE_ET} is absent (w1-42)`,
            evidence: {},
            probes: [partial("P-W1-18", {}, "not sent: no template")],
          };
        // Run 2: this open raised the engine's save prompt ("Loading world") over the copy w1-42
        // had left dirty. Undo back to clean first; anything left is recorded (the hand answers No).
        const pre = await beforeSwitch(ctx);
        const open = await ctx.tool("wb_module", { action: "open", module: "WorldEditor" });
        const set = await ctx.tool("wb_module", {
          action: "setResource",
          module: "WorldEditor",
          target: `path:${TEMPLATE_ET}`,
        });
        let es: ToolResponse | null = null;
        const started = ctx.deps.now();
        for (;;) {
          es = await ctx.tool("wb_prefabs", { action: "editState" });
          if (
            (es.ok && rb(es).prefabEdit === true) ||
            !set.ok ||
            ctx.deps.now() - started + TIMEOUTS.poll > 120_000
          )
            break;
          await ctx.sleep(TIMEOUTS.poll);
        }
        const evidence = {
          beforeSwitch: pre,
          open: brief(open),
          setResource: brief(set),
          editState: brief(es),
        };
        const observed = { editState: es?.readback ?? null, setResource: brief(set) };
        const p =
          es?.ok && rb(es).prefabEdit === true
            ? partial(
                "P-W1-18",
                observed,
                "edit mode entered by opening the .et; the member calls in w1-44",
              )
            : killed(
                "P-W1-18",
                observed,
                "edit mode not entered: addMembers/removeMembers ship refused UNPROVEN",
              );
        return {
          ...verdictOf(
            set.ok ? [] : [`setResource: ${set.code} ${set.message}`],
            [p],
            "prefab edit mode",
          ),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w1-44-prefab-members",
      block: "W1.3",
      title:
        "in prefab edit mode: removeMembers of a non-member (refused, never sent), addMembers of the prop, removeMembers of a real member, moveToPrefab, undo, then save the throwaway template (P-W1-18, member half)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "a non-member answers INVALID_ARGUMENT (run 2: it crashed Workbench); addMembers answers ok; a member child appears under the root and removeMembers of it answers ok; moveToPrefab answers; undo works before save; save (confirm) writes the throwaway .et",
      kill_criterion:
        "the non-member is not refused: KILLED, removeMembers ships refused UNPROVEN (the crash reference); addMembers or removeMembers answers false in the vanilla shape: KILLED; SaveEntityTemplate fails: KILLED (save via CreateEntityTemplate to the same path)",
      side_effects: [`${TEMPLATE_ET} saved`],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/",
      probes: ["P-W1-18"],
      dependsOn: ["P-W1-18"],
      writes: [TEMPLATE_ET],
      plan: () => [
        tc("wb_prefabs", "editState"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_M2" }),
        tc(
          "wb_prefabs",
          "removeMembers",
          { entities: ["name:W1_M2"] },
          { note: "a world entity: refused INVALID_ARGUMENT before the engine call (run 2 crash)" },
        ),
        tc("wb_prefabs", "addMembers", { member: "<root>", prefab: PROP }),
        tc("wb_prefabs", "editState"),
        tc("wb_entity", "children", { entity: "<root>" }),
        tc("wb_prefabs", "removeMembers", { entities: ["<the new member child>"] }),
        tc("wb_prefabs", "editState"),
        tc("wb_prefabs", "moveToPrefab", { parent: "<root>", entities: ["name:W1_M2"] }),
        ...undoPlan(4),
        tc("wb_prefabs", "save"),
        tc("wb_prefabs", "save", { confirm: true }),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const es0 = await ctx.tool("wb_prefabs", { action: "editState" });
        // Not in prefab edit mode means w1-43 did not enter it (or did not run): this step depends
        // on it and is skipped, the battery goes on to terrain, play and the final diff (the first
        // live run stopped the whole battery here).
        if (!(es0.ok && rb(es0).prefabEdit === true))
          return {
            status: "SKIPPED",
            detail: `not in prefab edit mode (w1-43 did not enter it): ${S(rb(es0).message) || S(es0.code)}`,
            evidence: { editState: brief(es0) },
            probes: [],
          };
        const root = S(rb(es0).rootId);
        const rootRef = root ? (root.startsWith("id:") ? root : `id:${root}`) : "index:0";
        const m2 = await create(ctx, "W1_M2");
        // Run 2: removeMembers of a world entity crashed Workbench (access violation in
        // RemovePrefabMembers). The handler now maps each entity to its prefab-side member and
        // refuses anything else before the engine call; a world entity must come back refused.
        const remBad = m2.ref
          ? await ctx.tool("wb_prefabs", { action: "removeMembers", entities: [m2.ref] })
          : null;
        const guardHeld = !!remBad && !remBad.ok && remBad.code === "INVALID_ARGUMENT";
        // addMembers in the vanilla shape: the prop as a new member of the root's prefab side.
        const kids0 = await ctx.tool("wb_entity", { action: "children", entity: rootRef });
        const add = await ctx.tool("wb_prefabs", {
          action: "addMembers",
          member: rootRef,
          prefab: PROP,
        });
        const es1 = await ctx.tool("wb_prefabs", { action: "editState" });
        const kids1 = await ctx.tool("wb_entity", { action: "children", entity: rootRef });
        const ids0 = new Set(
          (Array.isArray(rb(kids0).rows) ? (rb(kids0).rows as Raw[]) : []).map((r) => S(r.id)),
        );
        const newKid = (Array.isArray(rb(kids1).rows) ? (rb(kids1).rows as Raw[]) : [])
          .map((r) => S(r.id))
          .find((id) => id && !ids0.has(id));
        const kidRef = newKid ? (newKid.startsWith("id:") ? newKid : `id:${newKid}`) : "";
        let rem = kidRef
          ? await ctx.tool("wb_prefabs", { action: "removeMembers", entities: [kidRef] })
          : null;
        // Run 3: the id the children rows gave (id:0x..05) was not found by the resolver ("no
        // editor entity with id 0x0000000000000005 among 3"). Retry with the editor entity whose
        // parent is the root as the plain list reports it, by id, else by its list position.
        let memberRetry: Raw | null = null;
        if (rem && !rem.ok && rem.code === "ENTITY_NOT_FOUND") {
          const all = await ctx.tool("wb_entity", { action: "list", limit: 200 });
          const rows = Array.isArray(rb(all).rows) ? (rb(all).rows as Raw[]) : [];
          const pos = rows.findIndex((r) => S(r.parent) === rootRef || S(r.parent) === root);
          const listed = pos >= 0 ? S(rows[pos].id) : "";
          const retryRef =
            listed && listed !== kidRef
              ? listed.startsWith("id:")
                ? listed
                : `id:${listed}`
              : pos >= 0
                ? `index:${pos}`
                : "";
          memberRetry = { list: brief(all), position: pos, ref: retryRef || null };
          if (retryRef)
            rem = await ctx.tool("wb_prefabs", { action: "removeMembers", entities: [retryRef] });
        }
        const es2 = await ctx.tool("wb_prefabs", { action: "editState" });
        const mv = m2.ref
          ? await ctx.tool("wb_prefabs", {
              action: "moveToPrefab",
              parent: rootRef,
              entities: [m2.ref],
            })
          : null;
        const undos = await payUndos(ctx);
        const es3 = await ctx.tool("wb_prefabs", { action: "editState" });
        const more = await undoUntilClean(ctx);
        const sw = await sweep(ctx);
        const svDry = await ctx.tool("wb_prefabs", { action: "save" });
        const sv = await ctx.tool("wb_prefabs", { action: "save", confirm: true });
        Object.assign(evidence, {
          editState0: brief(es0),
          removeNonMember: remBad ? brief(remBad) : null,
          childrenBefore: brief(kids0),
          addMembers: brief(add),
          editState1: brief(es1),
          childrenAfterAdd: brief(kids1),
          newMember: kidRef || null,
          memberRetry,
          removeMembers: rem ? brief(rem) : null,
          editState2: brief(es2),
          moveToPrefab: mv ? brief(mv) : null,
          undos,
          extraUndos: more.extra,
          editState3: brief(es3),
          sweep: sw,
          saveDry: brief(svDry),
          save: brief(sv),
        });
        const counts = [es0, es1, es2, es3].map((r) => rb(r).memberCount ?? null);
        const observed = {
          memberCounts: counts,
          nonMemberRefused: guardHeld,
          add: brief(add),
          newMember: kidRef || null,
          remove: rem ? brief(rem) : null,
          move: mv ? brief(mv) : null,
          save: brief(sv),
          undos,
        };
        if (undos.some((u) => !u.ok)) fails.push("an undo answered false in prefab edit mode");
        if (sw.found.length) fails.push(`left after the undos: ${sw.found.join(", ")}`);
        if (!guardHeld)
          fails.push(
            `removeMembers of a world entity was not refused INVALID_ARGUMENT (${remBad?.code ?? "not sent"})`,
          );
        const p = !guardHeld
          ? killed(
              "P-W1-18",
              observed,
              "the non-member guard did not hold: removeMembers ships refused UNPROVEN (crash of run 2, EMCP_WB_Prefabs.c RemoveMembers)",
            )
          : !sv.ok
            ? killed(
                "P-W1-18",
                observed,
                `SaveEntityTemplate failed (${sv.code}): save via CreateEntityTemplate to the same path`,
              )
            : !add.ok
              ? killed(
                  "P-W1-18",
                  observed,
                  `AddPrefabMembers in the vanilla shape answered ${add.code}: addMembers ships refused UNPROVEN`,
                )
              : !rem
                ? partial(
                    "P-W1-18",
                    observed,
                    "addMembers answered ok but no new child appeared under the root: removeMembers of a real member not sent",
                  )
                : !rem.ok && rem.code !== "ENGINE_FALSE"
                  ? partial(
                      "P-W1-18",
                      observed,
                      `removeMembers of the new member did not reach the engine (${rem.code}: ${S(rem.message).slice(0, 160)})`,
                    )
                  : !rem.ok
                    ? killed(
                        "P-W1-18",
                        observed,
                        `RemovePrefabMembers of a mapped member answered ${rem.code}: removeMembers ships refused UNPROVEN`,
                      )
                    : partial(
                        "P-W1-18",
                        observed,
                        `member counts ${counts.join(" -> ")}; non-member refused; save wrote the throwaway .et`,
                      );
        return { ...verdictOf(fails, [p], "prefab members"), evidence, probes: [p] };
      },
    },

    // ── W1.4 terrain ──
    {
      id: "w1-50-terrain",
      block: "W1.4",
      title: `open ${TERRAIN_WORLD} read-only: wb_terrain info, heights (on and off the map), tile, the 1.x inspect and the two placeholders (P-W1-15)`,
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected:
        "non-zero resolution, tiles and scale; heights on the map, null off it; tile samples = tile resolution squared, row-major; never saved",
      kill_criterion: "zero everywhere or NO_TERRAIN: KILLED (terrain rows blocked:P-W1-15)",
      side_effects: ["the World Editor loads a vanilla world; nothing is saved"],
      rollback: "w1-60 reopens the fixture; nothing to undo",
      probes: ["P-W1-15"],
      writes: [],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        ...openPlan(TERRAIN_WORLD),
        tc("wb_terrain", "info", { minMax: true }),
        tc("wb_terrain", "heights", { points: ["<inside>", "-100000 -100000"] }),
        tc("wb_terrain", "tile", { tileX: 0, tileY: 0, limit: 200 }),
        tc("wb_terrain", "inspect", { world_path: TERRAIN_WORLD }),
        tc("wb_terrain", "navmesh_status", { world_path: TERRAIN_WORLD }),
        tc("wb_terrain", "road_export_graph", { world_path: TERRAIN_WORLD }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const o = await openWorld(ctx, TERRAIN_WORLD);
        evidence.open = o.evidence;
        if (!o.ok)
          throw new StopBattery(
            "stopped",
            `the terrain world did not open ('${o.worldPath}')`,
            evidence,
          );
        const t0 = ctx.deps.now();
        const info = await ctx.tool("wb_terrain", { action: "info", minMax: true });
        const infoMs = ctx.deps.now() - t0;
        const i = rb(info);
        // wb_terrain info answers bounds: { min, max } as "x y z" text (fix-up 2: the top-level
        // boundsMin/boundsMax this read first are the handler's keys, not the tool's readback).
        const bmin = vec(field(i.bounds, "min") ?? field(i, "boundsMin"));
        const bmax = vec(field(i.bounds, "max") ?? field(i, "boundsMax"));
        const inside =
          bmin.length && bmax.length
            ? `${(bmin[0] + bmax[0]) / 2} ${(bmin[2] + bmax[2]) / 2}`
            : "100 100";
        const hs = await ctx.tool("wb_terrain", {
          action: "heights",
          points: [inside, "-100000 -100000"],
        });
        const tile = await ctx.tool("wb_terrain", {
          action: "tile",
          tileX: 0,
          tileY: 0,
          limit: 200,
        });
        const insp = await ctx.tool("wb_terrain", { action: "inspect", world_path: TERRAIN_WORLD });
        const nav = await ctx.tool("wb_terrain", {
          action: "navmesh_status",
          world_path: TERRAIN_WORLD,
        });
        const road = await ctx.tool("wb_terrain", {
          action: "road_export_graph",
          world_path: TERRAIN_WORLD,
        });
        Object.assign(evidence, {
          info: brief(info),
          infoMs,
          heights: brief(hs),
          tile: brief(tile),
          inspect: brief(insp),
          navmesh_status: brief(nav),
          road_export_graph: brief(road),
        });
        if (!hs.ok || !tile.ok) fails.push(`heights or tile failed: ${hs.code ?? tile.code}`);
        if (!insp.ok && !recordOnly(insp)) fails.push(`inspect: ${insp.code} ${insp.message}`);
        const points = Array.isArray(rb(hs).points) ? (rb(hs).points as Raw[]) : [];
        const observed = {
          info: info.readback ?? null,
          infoMs,
          onMap: points[0] ?? null,
          offMap: points[1] ?? null,
          tileSampleCount: rb(tile).sampleCount ?? null,
          tileTotal: rb(tile).total ?? null,
          firstSamples: Array.isArray(rb(tile).samples)
            ? (rb(tile).samples as unknown[]).slice(0, 8)
            : null,
        };
        // resolution and tiles are nested { x, y } in the readback (fix-up 2).
        const numbers = [
          field(i.resolution, "x"),
          field(i.resolution, "y"),
          field(i.tiles, "x"),
          field(i.tiles, "y"),
          i.unitScale,
        ].filter((v) => typeof v === "number") as number[];
        const p =
          !info.ok || numbers.every((n) => n === 0)
            ? killed(
                "P-W1-15",
                observed,
                info.ok ? "zero everywhere" : `info: ${info.code} ${info.message}`,
              )
            : settled(
                "P-W1-15",
                observed,
                `terrain getters answer on ${TERRAIN_WORLD}; info with minMax took ${infoMs} ms${infoMs > 2000 ? " (over 2 s: the helper is not exposed)" : ""}; the off-map point ${field(points[1], "onTerrain") === false ? "is off the terrain" : "was not reported off"}`,
              );
        return { ...verdictOf(fails, [p], "terrain read"), evidence, probes: [p] };
      },
    },

    // ── W1.7 settle the PARTIAL probes of run 4 (session 023) ──
    {
      id: "w1-70-cursor-hand",
      block: "W1.7",
      title:
        "underCursor with the mouse put outside the viewport, then at its centre, by the main session's hand (P-W1-13)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 2 * HAND_WAIT_MS + 60_000,
      expected:
        "outside: no entity and a position outside 0..width, 0..height (or the last viewport position, recorded); centre: within 15% of (width/2, height/2)",
      kill_criterion:
        "a crash or a modal: KILLED (underCursor ships refused UNPROVEN, the HANDOFF rule); no hand answer: PARTIAL",
      side_effects: ["the fixture opened when it is not the open world; the mouse moved by hand"],
      rollback: "none: nothing is edited",
      probes: ["P-W1-13"],
      writes: [],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        tc("wb_world", "state"),
        ...openPlan(FIXTURE_WORLD),
        tc("wb_view", "camera"),
        tc("wb_view", "underCursor", {}, { note: "hand: the mouse outside the viewport" }),
        tc("wb_view", "underCursor", {}, { note: "hand: the mouse at the viewport centre" }),
      ],
      run: async (ctx) => {
        const evidence: Raw = { openFixture: await ensureFixture(ctx) };
        const cam = await ctx.tool("wb_view", { action: "camera" });
        const w = Number(rb(cam).screenWidth);
        const h = Number(rb(cam).screenHeight);
        evidence.camera = brief(cam);
        if (!(w > 0 && h > 0))
          return {
            status: "NOT-RUN",
            detail: `screen size ${w}x${h}: no viewport`,
            evidence,
            probes: [partial("P-W1-13", { screenWidth: w, screenHeight: h }, "no viewport")],
          };
        const read = (r: ToolResponse | null): Raw | null =>
          r ? { ok: r.ok, code: r.code ?? null, x: rb(r).x, y: rb(r).y, id: S(rb(r).id) } : null;
        const handOut = await awaitHand(
          ctx,
          "w1-70-outside",
          'move the mouse OUTSIDE the World Editor viewport (over the taskbar or another window), leave it there, then write {"done": true, "over": "<what it is over>"}',
        );
        const out = handOut ? await ctx.tool("wb_view", { action: "underCursor" }) : null;
        const handIn = await awaitHand(
          ctx,
          "w1-70-centre",
          `move the mouse to the centre of the World Editor viewport (the 3D view, ${w}x${h} pixels), leave it there, then write {"done": true}`,
        );
        const inn = handIn ? await ctx.tool("wb_view", { action: "underCursor" }) : null;
        const o = read(out);
        const c = read(inn);
        Object.assign(evidence, {
          handOutside: handOut,
          outside: o,
          handCentre: handIn,
          centre: c,
        });
        const inside = (v: Raw | null): boolean =>
          !!v && Number(v.x) >= 0 && Number(v.x) < w && Number(v.y) >= 0 && Number(v.y) < h;
        const nearCentre =
          !!c &&
          Math.abs(Number(c.x) - w / 2) <= w * 0.15 &&
          Math.abs(Number(c.y) - h / 2) <= h * 0.15;
        const observed = {
          screen: [w, h],
          outside: o,
          centre: c,
          outsideInRange: o ? inside(o) : null,
          centreNear: c ? nearCentre : null,
        };
        const p =
          (out && !out.ok) || (inn && !inn.ok)
            ? killed("P-W1-13", observed, `underCursor failed: ${out?.code ?? inn?.code}`)
            : !o || !c
              ? partial("P-W1-13", observed, "no hand answer: the mouse position is unknown")
              : !nearCentre
                ? partial(
                    "P-W1-13",
                    observed,
                    "the centre reading is not near the viewport centre: the coordinate frame is not the viewport's",
                  )
                : settled(
                    "P-W1-13",
                    observed,
                    `outside the viewport: (${S(o.x)}, ${S(o.y)})${inside(o) ? " inside the range (the last viewport position)" : " out of range"}, entity '${S(o.id)}'; at the centre (${S(c.x)}, ${S(c.y)}), no crash or modal`,
                  );
        return { ...verdictOf([], [p], "underCursor by hand"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-71-panel-hand",
      block: "W1.7",
      title:
        "a parent with two children, both children selected (set then add); the hand reads the Hierarchy panel: rows highlighted, main, child count (P-W1-09, P-W1-02)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step + HAND_WAIT_MS,
      expected:
        "the panel highlights exactly W1_H2 and W1_H3 after UpdateSelectionGui; it shows two children under W1_H1, as wb_entity children reads; main as selection reads",
      kill_criterion:
        "the panel highlights other rows than the selection: KILLED (UpdateSelectionGui does not sync the panel); child counts differ: KILLED (children walk)",
      side_effects: ["W1_H1..3 in memory and the selection changed, all undone and restored"],
      rollback: `${MEM_ROLLBACK}; the prior selection restored`,
      probes: ["P-W1-09", "P-W1-02"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_view", "selection"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_H1" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_H2" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_H3" }),
        tc("wb_entity", "parent", { parent: "name:W1_H1", entities: ["name:W1_H2", "name:W1_H3"] }),
        tc("wb_entity", "children", { entity: "name:W1_H1" }),
        tc("wb_view", "select", { mode: "set", entities: ["name:W1_H2"] }),
        tc("wb_view", "select", { mode: "add", entities: ["name:W1_H3"] }),
        tc("wb_view", "selection", {}, { note: "then the hand reads the Hierarchy panel" }),
        tc("wb_view", "select", { mode: "set", entities: ["<prior ids>"] }),
        ...undoPlan(4),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const prior = await ctx.tool("wb_view", { action: "selection", limit: 200 });
        const priorIds = rowsOf(prior)
          .map((r) => S(r.id))
          .filter(Boolean)
          .map((id) => (id.startsWith("id:") ? id : `id:${id}`));
        const restore = (): Promise<ToolResponse> =>
          priorIds.length
            ? ctx.tool(
                "wb_view",
                { action: "select", mode: "set", entities: priorIds },
                { restore: true },
              )
            : ctx.tool("wb_view", { action: "select", mode: "clear" }, { restore: true });
        ctx.debt.restorers.push({ label: "restore the prior selection", fn: restore });
        const h1 = await create(ctx, "W1_H1");
        const h2 = await create(ctx, "W1_H2");
        const h3 = await create(ctx, "W1_H3");
        const par = await ctx.tool("wb_entity", {
          action: "parent",
          parent: h1.ref,
          entities: [h2.ref, h3.ref],
        });
        const kids = await ctx.tool("wb_entity", { action: "children", entity: h1.ref });
        const set = await ctx.tool("wb_view", {
          action: "select",
          mode: "set",
          entities: [h2.ref],
        });
        const add = await ctx.tool("wb_view", {
          action: "select",
          mode: "add",
          entities: [h3.ref],
        });
        const sel = await ctx.tool("wb_view", { action: "selection" });
        const mainRow = rowsOf(sel).find(
          (r) => S(r.id).replace(/^id:/, "") === S(rb(sel).mainId).replace(/^id:/, ""),
        );
        const hand = await awaitHand(
          ctx,
          "w1-71-panel",
          'in the World Editor Hierarchy panel, expand W1_H1 and write {"children": <rows under W1_H1>, "highlighted": [<names of the highlighted rows>], "main": "<the row drawn as the main selection, or null if none differs>"}',
        );
        const res = await restore();
        ctx.debt.restorers.pop();
        Object.assign(evidence, {
          prior: brief(prior),
          parent: brief(par),
          children: brief(kids),
          set: brief(set),
          add: brief(add),
          selection: brief(sel),
          hand,
          restored: brief(res),
        });
        if (!par.ok || !set.ok || !add.ok || !res.ok)
          fails.push("parent, select or the restore failed");
        const highlighted = Array.isArray(hand?.highlighted)
          ? (hand?.highlighted as unknown[]).map(S).sort()
          : null;
        const p09obs = {
          selectionTotal: rb(sel).total ?? null,
          mainName: mainRow ? S(mainRow.name) : null,
          firstAdded: "W1_H2",
          panelHighlighted: highlighted,
          panelMain: hand ? (hand.main ?? null) : null,
        };
        const walkNames = rowsOf(kids)
          .map((r) => S(r.name))
          .sort();
        const p02obs = {
          childrenTotal: rb(kids).total ?? null,
          walkChildren: walkNames,
          panelChildren: hand ? (hand.children ?? null) : null,
        };
        const probes: ProbeResult[] = [];
        if (!hand) {
          probes.push(partial("P-W1-09", p09obs, "no hand answer: the panel was not read"));
          probes.push(partial("P-W1-02", p02obs, "no hand answer: the panel was not read"));
        } else {
          probes.push(
            JSON.stringify(highlighted) === JSON.stringify(["W1_H2", "W1_H3"])
              ? settled(
                  "P-W1-09",
                  p09obs,
                  `the panel highlights the selection after UpdateSelectionGui; main reads '${S(p09obs.mainName)}' (first added W1_H2), the panel's main '${S(p09obs.panelMain)}'`,
                )
              : killed(
                  "P-W1-09",
                  p09obs,
                  "the panel highlights other rows than the selection: UpdateSelectionGui does not sync it",
                ),
          );
          probes.push(
            panelChildrenAgree(p02obs.panelChildren, walkNames, p02obs.childrenTotal)
              ? settled(
                  "P-W1-02",
                  p02obs,
                  "the children walk matches the Hierarchy panel; GetEntity(sub, i) is used by no handler (the walk is GetEditorEntity), so that half is moot",
                )
              : killed("P-W1-02", p02obs, "the children walk and the panel disagree"),
          );
        }
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, probes, "panel read by hand"), evidence, probes };
      },
    },
    {
      id: "w1-72-annotate-hand",
      block: "W1.7",
      title:
        "annotate add, move and remove on an entity in view; the hand reads the viewport after each (P-W1-20)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step + 3 * HAND_WAIT_MS,
      expected:
        "focus frames W1_N (the hand sees it); the note text shows just above W1_N after add, the whole text readable in the frame (run 7: a fixed 0.5 m height clipped it to 'hand no'; the height now scales from the framing distance and the answer records it), comments total +1 (the note is a CommentEntity), sits higher after move and stays in view, is gone after remove",
      kill_criterion:
        "the note never shows although W1_N is in view: KILLED (the CommentEntity note does not draw); W1_N not in view: focus KILLED; a call fails: KILLED; the text shows but not whole and readable: PARTIAL",
      side_effects: ["W1_N in memory, focused, annotated, undone; the camera restored"],
      rollback: `${MEM_ROLLBACK}; the camera restored`,
      probes: ["P-W1-20"],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        tc("wb_view", "camera"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_N" }),
        tc("wb_view", "focus", { entity: "name:W1_N" }),
        tc("wb_world", "comments"),
        tc("wb_world", "annotate", { entity: "name:W1_N", mode: "add", text: "W1 hand note" }),
        tc("wb_world", "comments"),
        tc("wb_world", "annotate", {
          entity: "name:W1_N",
          mode: "move",
          coords: "<the note's spot + 0 max(4 x noteSize, 0.2) 0>",
        }),
        tc("wb_world", "annotate", { entity: "name:W1_N", mode: "remove" }),
        tc("wb_view", "setCamera", { coords: "<before>", look: "<before direction>" }),
        ...undoPlan(4),
        ...sweepPlan(),
      ],
      run: async (ctx) => {
        await requireFixture(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const cam0 = await ctx.tool("wb_view", { action: "camera" });
        const bc = S(rb(cam0).coords);
        const bd = S(rb(cam0).direction);
        if (vec(bc).length)
          ctx.debt.restorers.push({
            label: "restore the camera",
            fn: () =>
              ctx.tool(
                "wb_view",
                { action: "setCamera", coords: bc, look: bd || "0 0 1" },
                { restore: true },
              ),
          });
        const n = await create(ctx, "W1_N");
        const g = n.r.ok ? await get(ctx, n.ref) : null;
        const origin = g ? vec(rb(g).coords) : [];
        const fo = await ctx.tool("wb_view", { action: "focus", entity: n.ref });
        const c0 = await ctx.tool("wb_world", { action: "comments" });
        const aAdd = await ctx.tool("wb_world", {
          action: "annotate",
          entity: n.ref,
          mode: "add",
          text: "W1 hand note",
        });
        const c1 = await ctx.tool("wb_world", { action: "comments" });
        const seenAdd = aAdd.ok
          ? await awaitHand(
              ctx,
              "w1-72-add",
              'look at the World Editor viewport (focused on W1_N, a beer glass): is W1_N itself visible, is the text "W1 hand note" shown, and is the WHOLE text inside the frame and readable (not clipped at an edge, not too small to read)? write {"entityVisible": true|false, "shown": true|false, "readable": true|false, "where": "<just above the entity, elsewhere>", "note": "<what was clipped or too small, if anything>"}',
            )
          : null;
        // The note sits just above W1_N's bounds (the handler names where and how high). Move lifts
        // it by four text heights (at least 0.2 m), so it stays in the frame (run 7: a 3 m lift took
        // it out of view, and the hand could only infer the move).
        const at = vec(S(rb(aAdd).at));
        const base = at.length ? at : origin.length ? origin : [0, 0, 0];
        const applied = (rb(aAdd).applied ?? {}) as Raw;
        const noteSize = Number(applied.size);
        const lift = Math.round(Math.max(4 * (noteSize > 0 ? noteSize : 0), 0.2) * 1000) / 1000;
        const up = `${base[0]} ${base[1] + lift} ${base[2]}`;
        const aMove = await ctx.tool("wb_world", {
          action: "annotate",
          entity: n.ref,
          mode: "move",
          coords: up,
        });
        const seenMove = aMove.ok
          ? await awaitHand(
              ctx,
              "w1-72-move",
              `look at the viewport again: did "W1 hand note" move up (about ${lift} m) and is it still in the frame? write {"moved": true|false, "inFrame": true|false}`,
            )
          : null;
        const aRem = await ctx.tool("wb_world", {
          action: "annotate",
          entity: n.ref,
          mode: "remove",
        });
        const seenRem = aRem.ok
          ? await awaitHand(
              ctx,
              "w1-72-remove",
              'look at the viewport again: is "W1 hand note" gone? write {"gone": true|false}',
            )
          : null;
        for (const r of [...ctx.debt.restorers].reverse()) await r.fn();
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          camera: brief(cam0),
          create: brief(n.r),
          focus: brief(fo),
          commentsBefore: brief(c0),
          annotateAdd: brief(aAdd),
          commentsAfterAdd: brief(c1),
          handAdd: seenAdd,
          annotateMove: brief(aMove),
          handMove: seenMove,
          annotateRemove: brief(aRem),
          handRemove: seenRem,
        });
        const observed = {
          camera: { before: rb(fo).before ?? null, after: rb(fo).after ?? null },
          focusDistance: rb(fo).distance ?? null,
          entityVisible: seenAdd?.entityVisible ?? null,
          noteAt: S(rb(aAdd).at) || null,
          noteApplied: rb(aAdd).applied ?? null,
          readable: seenAdd?.readable ?? null,
          inFrameAfterMove: seenMove?.inFrame ?? null,
          commentTotals: [rb(c0).total ?? null, rb(c1).total ?? null],
          categories: rb(c1).categories ?? null,
          shown: seenAdd?.shown ?? null,
          moved: seenMove?.moved ?? null,
          gone: seenRem?.gone ?? null,
          movedTo: up,
        };
        const calls = [aAdd, aMove, aRem];
        const p = calls.some((r) => !r.ok)
          ? killed("P-W1-20", observed, "an annotate call failed")
          : !seenAdd || !seenMove || !seenRem
            ? partial("P-W1-20", observed, "no hand answer for every call")
            : seenAdd.entityVisible === false
              ? killed(
                  "P-W1-20",
                  observed,
                  "focus did not bring W1_N into view: the note cannot be judged (wb_view focus defect)",
                )
              : seenAdd.shown !== true
                ? killed(
                    "P-W1-20",
                    observed,
                    "the CommentEntity note does not draw although W1_N is in view",
                  )
                : seenAdd.readable !== true
                  ? partial(
                      "P-W1-20",
                      observed,
                      `the note draws, but the whole text is not readable in the frame at height ${String(noteSize)} m: ${S(seenAdd.note) || "no detail"}`,
                    )
                  : seenMove.moved === true && seenRem.gone === true
                    ? settled(
                        "P-W1-20",
                        observed,
                        `focus frames W1_N; the note shows just above it, whole and readable at ${String(noteSize)} m, moves and goes (a CommentEntity: comments total +1 while it exists)`,
                      )
                    : partial(
                        "P-W1-20",
                        observed,
                        "the note shows, but move or remove did not change the view",
                      );
        await settle(ctx, evidence, fails);
        return { ...verdictOf(fails, [p], "annotate read by hand"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-73-persist",
      block: "W1.7",
      title:
        "a throwaway world: entity moved to a new layer, a folder made and renamed, then SAVED (saveAs to a copy that opens) and read back from the files (P-W1-07, P-W1-08 persistence)",
      risk: "mutating",
      timeout_ms: 3 * TIMEOUTS.open + TIMEOUTS.step,
      expected:
        "after save the old layer file no longer names W1_P1 and the new one does; the reopened copy reads W1_P1 on the new layer and lists the renamed folder W1_PF2 with its layer W1_PFL; the empty folder W1_PE is recorded (run 6: an empty folder is not saved)",
      kill_criterion:
        "the reopened copy reads W1_P1 on the old layer: P-W1-07 KILLED (setLayer in-memory only); the renamed folder holding a layer missing after reopen: P-W1-08 KILLED (folder calls in-memory only)",
      side_effects: [
        `${PERSIST_WORLD} and ${PERSIST2_WORLD} with their layers folders written, registered and saved; the copy is left open`,
      ],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/",
      probes: ["P-W1-07", "P-W1-08"],
      writes: [
        PERSIST_WORLD,
        `${layersDirOf(PERSIST_WORLD)}/`,
        PERSIST2_WORLD,
        `${layersDirOf(PERSIST2_WORLD)}/`,
      ],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        ...saveThrowawayPlan("the open throwaway world, if any, saved in place before the switch"),
        tc(
          "wb_world",
          "register",
          { path: PERSIST_WORLD, confirm: true, overwrite: true },
          { toolAction: "duplicate", note: "the fixture copied to the throwaway world" },
        ),
        ...openPlan(PERSIST_WORLD),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_P1" }),
        tc("wb_layers", "create", { name: "W1_PL" }),
        tc("wb_entity", "setLayer", { entities: ["name:W1_P1"], layer: "W1_PL" }),
        tc("wb_layers", "createFolder", { name: "W1_PF" }),
        tc("wb_layers", "create", { name: "W1_PFL", parentPath: "W1_PF" }),
        tc("wb_layers", "rename", { layer: "W1_PF", name: "W1_PF2" }),
        tc("wb_layers", "createFolder", { name: "W1_PE" }),
        tc("wb_layers", "tree"),
        tc(
          "wb_world",
          "state",
          { to: PERSIST2_WORLD, confirm: true, overwrite: true },
          {
            toolAction: "saveAs",
            note: "confirmed on the open THROWAWAY world: wb_module save of it, duplicate, register, setResource of the copy",
          },
        ),
        tc("wb_world", "state", {}, { note: "polled until the copy is open" }),
        tc("wb_entity", "get", { entity: "name:W1_P1" }),
        tc("wb_layers", "tree"),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const tw = await throwawayWorld(ctx, PERSIST_WORLD);
        evidence.world = tw.evidence;
        if (!tw.ok)
          return {
            status: "FAIL",
            detail: `${PERSIST_WORLD} was not made or did not open`,
            evidence,
            probes: [],
          };
        const tree0 = await ctx.tool("wb_layers", { action: "tree" });
        const p1 = await create(ctx, "W1_P1");
        const g0 = p1.r.ok ? await get(ctx, p1.ref) : null;
        const oldLayer = S(rb(g0 ?? ({} as ToolResponse)).layer);
        const cl = await ctx.tool("wb_layers", { action: "create", name: "W1_PL" });
        const newLayer = S(rb(cl).path) || "W1_PL";
        const sl = await ctx.tool("wb_entity", {
          action: "setLayer",
          entities: [p1.ref],
          layer: newLayer,
        });
        // Run 6: an EMPTY folder, renamed, was gone after save and reopen; the saved files hold only
        // .layer files, so a folder reaches disk only through a layer under it. The persisting form
        // is tested: a folder holding a layer, renamed; an empty folder beside it re-checks the loss.
        const cf = await ctx.tool("wb_layers", { action: "createFolder", name: "W1_PF" });
        const cfPath = S(rb(cf).path) || "W1_PF";
        const fl = await ctx.tool("wb_layers", {
          action: "create",
          name: "W1_PFL",
          parentPath: cfPath,
        });
        const rf = await ctx.tool("wb_layers", { action: "rename", layer: cfPath, name: "W1_PF2" });
        const folder = rf.ok ? S(rb(rf).after) || "W1_PF2" : "";
        const ef = await ctx.tool("wb_layers", { action: "createFolder", name: "W1_PE" });
        const emptyFolder = S(rb(ef).path) || "W1_PE";
        const treeBeforeSave = await ctx.tool("wb_layers", { action: "tree" });
        const g1 = await get(ctx, p1.ref);
        const sv = await saveAsAndReopen(ctx, PERSIST2_WORLD);
        const savedFiles = layerTexts(ctx, PERSIST_WORLD);
        const copyFiles = layerTexts(ctx, PERSIST2_WORLD);
        const g2 = sv.ok ? await get(ctx, "name:W1_P1") : null;
        const tree2 = sv.ok ? await ctx.tool("wb_layers", { action: "tree" }) : null;
        const paths2 = rowsOf(tree2).map((r) => `${S(r.kind)}:${S(r.path)}`);
        Object.assign(evidence, {
          tree0: brief(tree0),
          create: brief(p1.r),
          getBefore: g0 ? brief(g0) : null,
          createLayer: brief(cl),
          setLayer: brief(sl),
          createFolder: brief(cf),
          createLayerInFolder: brief(fl),
          renameFolder: brief(rf),
          createEmptyFolder: brief(ef),
          treeBeforeSave: brief(treeBeforeSave),
          getAfterMove: brief(g1),
          save: sv.evidence,
          savedLayerFilesNaming: filesNaming(savedFiles, "W1_P1"),
          copyLayerFilesNaming: filesNaming(copyFiles, "W1_P1"),
          savedLayerFiles: Object.keys(savedFiles).sort(),
          getInCopy: g2 ? brief(g2) : null,
          treeInCopy: tree2 ? brief(tree2) : null,
        });
        if (!p1.r.ok || !cl.ok || !sl.ok) fails.push("create, layer create or setLayer failed");
        if (!sv.ok) fails.push("saveAs of the throwaway world did not save and reopen");
        const p07obs = {
          oldLayer,
          newLayer,
          layerBeforeSave: rb(g1).layer ?? null,
          layerAfterReopen: g2 ? (rb(g2).layer ?? null) : null,
          savedFilesNaming: evidence.savedLayerFilesNaming,
        };
        const named = filesNaming(savedFiles, "W1_P1");
        const leaf = (newLayer.split("/").pop() ?? newLayer).toLowerCase();
        const onNew = named.length === 1 && named[0].toLowerCase().includes(leaf);
        const copyFileNames = Object.keys(copyFiles).sort();
        const p08obs = {
          folder,
          layerInFolder: S(rb(fl).path) || null,
          emptyFolder,
          treeBeforeSave: rowsOf(treeBeforeSave).map((r) => `${S(r.kind)}:${S(r.path)}`),
          treeAfterReopen: paths2,
          copyLayerFiles: copyFileNames,
          emptyFolderAfterReopen: paths2.some((x) => x.endsWith(`:${emptyFolder}`)),
        };
        const folderKept = folderPersisted(paths2, folder);
        const probes: ProbeResult[] = [];
        probes.push(
          !sv.ok || !g2
            ? partial("P-W1-07", p07obs, "not saved and reopened: persistence not read")
            : S(p07obs.layerAfterReopen) === newLayer && onNew
              ? settled(
                  "P-W1-07",
                  p07obs,
                  "the move persists: the saved files name W1_P1 only in the new layer's file and the reopened copy reads it there",
                )
              : killed(
                  "P-W1-07",
                  p07obs,
                  "after save and reopen W1_P1 is not on the new layer: setLayer is in-memory only",
                ),
        );
        probes.push(
          !sv.ok || !tree2 || !rf.ok || !fl.ok
            ? partial(
                "P-W1-08",
                p08obs,
                "not saved and reopened, or the layer in the folder or the rename failed",
              )
            : folderKept
              ? settled(
                  "P-W1-08",
                  p08obs,
                  `a renamed folder holding a layer survives save and reopen (its layer reads ${folder}/W1_PFL); the empty folder ${p08obs.emptyFolderAfterReopen ? "survives too" : "is lost, as wb_layers now warns"}`,
                )
              : killed(
                  "P-W1-08",
                  p08obs,
                  "a renamed folder holding a layer is gone after save and reopen: the folder calls are in-memory only",
                ),
        );
        return { ...verdictOf(fails, probes, "saved and reopened"), evidence, probes };
      },
    },
    {
      id: "w1-74-visible-file",
      block: "W1.7",
      title:
        "in the saved copy, setVisible false on W1_P1, save again (saveAs to a third copy) and diff its .layer file (P-W1-10)",
      risk: "mutating",
      timeout_ms: 2 * TIMEOUTS.open + TIMEOUTS.step,
      expected:
        "either the .layer file is unchanged (editor-only toggle) or it gains a flag on W1_P1; the third copy reads the visibility as saved",
      kill_criterion:
        "the call fails: KILLED (rows blocked:P-W1-10); the file changes: SETTLED as a file write (setVisible then needs the project+target guard)",
      side_effects: [
        `${PERSIST2_WORLD} saved again; ${PERSIST3_WORLD} written, registered and opened`,
      ],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/",
      probes: ["P-W1-10"],
      writes: [
        PERSIST2_WORLD,
        `${layersDirOf(PERSIST2_WORLD)}/`,
        PERSIST3_WORLD,
        `${layersDirOf(PERSIST3_WORLD)}/`,
      ],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        ...saveThrowawayPlan("the open throwaway world saved in place: a resume starts clean"),
        tc("wb_world", "state"),
        ...openPlan(PERSIST2_WORLD),
        tc("wb_view", "setVisible", { entities: ["name:W1_P1"], visible: false }),
        tc("wb_entity", "get", { entity: "name:W1_P1" }),
        tc(
          "wb_world",
          "state",
          { to: PERSIST3_WORLD, confirm: true, overwrite: true },
          { toolAction: "saveAs", note: "confirmed on the open THROWAWAY copy" },
        ),
        tc("wb_world", "state", {}, { note: "polled until the third copy is open" }),
        tc("wb_entity", "get", { entity: "name:W1_P1" }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        evidence.leftOpenSaved = await saveThrowaway(ctx);
        const st = await ctx.tool("wb_world", { action: "state" });
        if (!S(rb(st).worldPath).toLowerCase().endsWith(PERSIST2_WORLD.toLowerCase())) {
          if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, PERSIST2_WORLD)))
            return {
              status: "NOT-RUN",
              detail: `${PERSIST2_WORLD} is absent (w1-73)`,
              evidence,
              probes: [partial("P-W1-10", {}, "not sent: no saved copy")],
            };
          evidence.open = (await openWorld(ctx, PERSIST2_WORLD)).evidence;
        }
        const before = layerTexts(ctx, PERSIST2_WORLD);
        const off = await ctx.tool("wb_view", {
          action: "setVisible",
          entities: ["name:W1_P1"],
          visible: false,
        });
        const g1 = await get(ctx, "name:W1_P1");
        const sv = await saveAsAndReopen(ctx, PERSIST3_WORLD);
        const after = layerTexts(ctx, PERSIST2_WORLD);
        const g2 = sv.ok ? await get(ctx, "name:W1_P1") : null;
        const diffs: Raw[] = [];
        for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
          const d = exactLineDiff(before[k] ?? "", after[k] ?? "");
          if (d.removed.length || d.added.length) diffs.push({ file: k, ...d });
        }
        Object.assign(evidence, {
          hide: brief(off),
          getHidden: brief(g1),
          save: sv.evidence,
          layerDiffs: diffs,
          getInCopy: g2 ? brief(g2) : null,
        });
        if (!sv.ok) fails.push("saveAs of the throwaway copy did not save and reopen");
        const observed = {
          visibleAfterHide: rb(g1).visible ?? null,
          visibleAfterReopen: g2 ? (rb(g2).visible ?? null) : null,
          changedFiles: diffs.map((d) => d.file),
          lines: diffs.map((d) => ({ removed: d.removed, added: d.added })),
        };
        const p = !off.ok
          ? killed("P-W1-10", observed, `setVisible failed: ${off.code} ${off.message}`)
          : !sv.ok
            ? partial("P-W1-10", observed, "not saved: the file half not read")
            : diffs.length === 0
              ? settled(
                  "P-W1-10",
                  observed,
                  `editor-only: the save left every .layer unchanged; after reopen visible reads ${S(observed.visibleAfterReopen)}`,
                )
              : settled(
                  "P-W1-10",
                  observed,
                  `it writes the layer file (${diffs.length} file(s) changed): setVisible needs the project+target guard`,
                );
        return { ...verdictOf(fails, [p], "visibility saved and diffed"), evidence, probes: [p] };
      },
    },
    {
      id: "w1-75-layer-delete",
      block: "W1.7",
      title:
        "a throwaway world: a layer holding W1_D1; delete refused NOT_EMPTY, then withContents (dry run, delete, one undo restores, delete again), saved and reopened (P-W1-08, the pathless layer of runs 4 and 7)",
      risk: "mutating",
      timeout_ms: 3 * TIMEOUTS.open + TIMEOUTS.step,
      expected:
        "a plain delete of the non-empty layer is refused NOT_EMPTY and changes nothing; withContents without confirm is a dry run (1 entity); withContents with confirm deletes W1_D1 and W1_DL (entitiesDeleted 1), no pathless layer, W1_D1 ENTITY_NOT_FOUND; one undo brings both back; the second delete saved: no layer file names W1_D1, and the reopened copy has neither",
      kill_criterion:
        "the plain delete is not refused, or changes the tree: KILLED; withContents leaves a pathless layer or W1_D1 (in memory, on disk or in the copy): KILLED; one undo does not restore both: PARTIAL",
      side_effects: [`${LAYERDEL_WORLD} and ${LAYERDEL2_WORLD} written, saved, the copy opened`],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/",
      probes: ["P-W1-08"],
      writes: [
        LAYERDEL_WORLD,
        `${layersDirOf(LAYERDEL_WORLD)}/`,
        LAYERDEL2_WORLD,
        `${layersDirOf(LAYERDEL2_WORLD)}/`,
      ],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        ...saveThrowawayPlan("the open throwaway world, if any, saved in place before the switch"),
        tc(
          "wb_world",
          "register",
          { path: LAYERDEL_WORLD, confirm: true, overwrite: true },
          { toolAction: "duplicate", note: "the fixture copied to the throwaway world" },
        ),
        ...openPlan(LAYERDEL_WORLD),
        tc("wb_layers", "create", { name: "W1_DL" }),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_D1", layer: "W1_DL" }),
        ...saveThrowawayPlan("the layer and its entity saved: W1_DL.layer on disk names W1_D1"),
        tc("wb_layers", "tree"),
        tc(
          "wb_layers",
          "delete",
          { layer: "W1_DL", confirm: true },
          { note: "must be refused NOT_EMPTY, nothing changed" },
        ),
        tc("wb_layers", "tree"),
        tc("wb_entity", "get", { entity: "name:W1_D1" }),
        tc(
          "wb_layers",
          "delete",
          { layer: "W1_DL", withContents: true },
          { note: "withContents without confirm: a dry run" },
        ),
        tc("wb_layers", "delete", { layer: "W1_DL", withContents: true, confirm: true }),
        tc("wb_layers", "tree"),
        tc("wb_entity", "get", { entity: "name:W1_D1" }),
        ...undoPlan(1),
        tc("wb_layers", "tree", {}, { note: "one undo restores the layer and its entity" }),
        tc("wb_entity", "get", { entity: "name:W1_D1" }),
        tc("wb_layers", "delete", { layer: "W1_DL", withContents: true, confirm: true }),
        tc("wb_layers", "tree"),
        tc("wb_entity", "get", { entity: "name:W1_D1" }),
        ...saveThrowawayPlan("the delete saved: no layer file names W1_D1"),
        tc(
          "wb_world",
          "state",
          { to: LAYERDEL2_WORLD, confirm: true, overwrite: true },
          { toolAction: "saveAs", note: "confirmed on the open THROWAWAY world" },
        ),
        tc("wb_world", "state", {}, { note: "polled until the copy is open" }),
        tc("wb_layers", "tree"),
        tc("wb_entity", "get", { entity: "name:W1_D1" }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const tw = await throwawayWorld(ctx, LAYERDEL_WORLD);
        evidence.world = tw.evidence;
        if (!tw.ok)
          return {
            status: "FAIL",
            detail: `${LAYERDEL_WORLD} was not made or did not open`,
            evidence,
            probes: [],
          };
        const cl = await ctx.tool("wb_layers", { action: "create", name: "W1_DL" });
        const layer = S(rb(cl).path) || "W1_DL";
        const d1 = await create(ctx, "W1_D1", { layer });
        // Run 6: the layer was created and deleted without a save between, and after saveAs's own
        // save the world still raised the engine's save prompt at the switch (twice). The layer and
        // its entity are saved first (the delete then removes a layer that is on disk, the case a
        // user meets), and the delete is saved in place before saveAs switches.
        const saved0 = await saveThrowaway(ctx);
        const files0 = layerTexts(ctx, LAYERDEL_WORLD);
        const t0 = await ctx.tool("wb_layers", { action: "tree" });
        // Run 7: DeleteSubsceneFolder on this non-empty layer answered true and left a pathless
        // layer still holding W1_D1. A plain delete must now be refused and change nothing.
        const refusal = await ctx.tool("wb_layers", { action: "delete", layer, confirm: true });
        const tR = await ctx.tool("wb_layers", { action: "tree" });
        const gR = await get(ctx, "name:W1_D1");
        const dry = await ctx.tool("wb_layers", { action: "delete", layer, withContents: true });
        const del = await ctx.tool("wb_layers", {
          action: "delete",
          layer,
          withContents: true,
          confirm: true,
        });
        const t1 = await ctx.tool("wb_layers", { action: "tree" });
        const g1 = await get(ctx, "name:W1_D1");
        // One undo must restore the layer and its entity (one entity action in the handler).
        const undo = del.ok ? await ctx.undo() : null;
        const tU = undo ? await ctx.tool("wb_layers", { action: "tree" }) : null;
        const gU = undo ? await get(ctx, "name:W1_D1") : null;
        const del2 = undo
          ? await ctx.tool("wb_layers", {
              action: "delete",
              layer,
              withContents: true,
              confirm: true,
            })
          : null;
        const t1b = del2 ? await ctx.tool("wb_layers", { action: "tree" }) : null;
        const g1b = del2 ? await get(ctx, "name:W1_D1") : null;
        const saved1 = await saveThrowaway(ctx);
        const files1 = layerTexts(ctx, LAYERDEL_WORLD);
        const sv = await saveAsAndReopen(ctx, LAYERDEL2_WORLD);
        const t2 = sv.ok ? await ctx.tool("wb_layers", { action: "tree" }) : null;
        const g2 = sv.ok ? await get(ctx, "name:W1_D1") : null;
        const pathless = (r: ToolResponse | null): Raw[] =>
          rowsOf(r).filter((x) => S(x.kind) !== "folder" && S(x.path) === "");
        const rowOf = (r: ToolResponse | null): Raw | undefined =>
          rowsOf(r).find((x) => S(x.path) === layer);
        const onLayer = (g: ToolResponse | null) => g?.ok === true && S(rb(g).layer) === layer;
        Object.assign(evidence, {
          createLayer: brief(cl),
          createOnLayer: brief(d1.r),
          savedBeforeDelete: saved0,
          filesBeforeDelete: Object.keys(files0).sort(),
          filesNamingBeforeDelete: filesNaming(files0, "W1_D1"),
          treeBefore: brief(t0),
          refusal: brief(refusal),
          treeAfterRefusal: brief(tR),
          getAfterRefusal: brief(gR),
          dryRun: brief(dry),
          delete: brief(del),
          treeAfter: brief(t1),
          getAfter: brief(g1),
          undo,
          treeAfterUndo: tU ? brief(tU) : null,
          getAfterUndo: gU ? brief(gU) : null,
          deleteAgain: del2 ? brief(del2) : null,
          treeAfterDeleteAgain: t1b ? brief(t1b) : null,
          getAfterDeleteAgain: g1b ? brief(g1b) : null,
          savedAfterDelete: saved1,
          filesAfterDelete: Object.keys(files1).sort(),
          filesNamingAfterDelete: filesNaming(files1, "W1_D1"),
          save: sv.evidence,
          treeInCopy: t2 ? brief(t2) : null,
          getInCopy: g2 ? brief(g2) : null,
        });
        if (!cl.ok || !d1.r.ok) fails.push("layer create or create on it failed");
        if (saved0?.ok !== true || saved1?.ok !== true) fails.push("a save in place failed");
        if (!sv.ok) fails.push("saveAs of the throwaway world did not save and reopen");
        const refusedClean =
          !refusal.ok &&
          refusal.code === "NOT_EMPTY" &&
          pathless(tR).length === 0 &&
          Number(rowOf(tR)?.entityCount ?? -1) === 1 &&
          onLayer(gR);
        const dryOk = dry.ok && rb(dry).dryRun === true && Number(rb(dry).entityCount) === 1;
        const cleanAfter = (t: ToolResponse | null, g: ToolResponse | null) =>
          t !== null &&
          t.ok &&
          pathless(t).length === 0 &&
          !rowOf(t) &&
          g !== null &&
          !g.ok &&
          g.code === "ENTITY_NOT_FOUND";
        const deleteClean =
          del.ok &&
          Number(rb(del).entitiesDeleted) === 1 &&
          cleanAfter(t1, g1) &&
          del2?.ok === true &&
          cleanAfter(t1b, g1b) &&
          filesNaming(files1, "W1_D1").length === 0 &&
          (t2 === null || pathless(t2).length === 0) &&
          g2?.ok !== true;
        const undoRestored =
          undo?.ok === true &&
          tU !== null &&
          Number(rowOf(tU)?.entityCount ?? -1) === 1 &&
          pathless(tU).length === 0 &&
          onLayer(gU);
        const observed = {
          filesNamingBeforeDelete: filesNaming(files0, "W1_D1"),
          refusalCode: refusal.ok ? "ok (not refused)" : (refusal.code ?? null),
          refusalNext: refusal.ok ? null : (refusal.next ?? null),
          layerAfterRefusal: rowOf(tR) ?? null,
          entityLayerAfterRefusal: gR.ok ? (rb(gR).layer ?? null) : gR.code,
          dryRun: {
            ok: dry.ok,
            dryRun: rb(dry).dryRun ?? null,
            entityCount: rb(dry).entityCount ?? null,
          },
          deleteAnswer: brief(del),
          pathlessAfterDelete: pathless(t1),
          entityAfterDelete: g1.ok ? (rb(g1).layer ?? "present") : g1.code,
          undoRestored,
          layerAfterUndo: rowOf(tU) ?? null,
          entityLayerAfterUndo: gU ? (gU.ok ? (rb(gU).layer ?? null) : gU.code) : null,
          deleteAgain: del2 ? { ok: del2.ok, code: del2.code ?? null } : null,
          pathlessAfterDeleteAgain: pathless(t1b),
          filesNamingAfterDelete: filesNaming(files1, "W1_D1"),
          pathlessInCopy: t2 ? pathless(t2) : null,
          entityInCopy: g2 ? (g2.ok ? (rb(g2).layer ?? "present") : g2.code) : null,
        };
        const p = !refusedClean
          ? killed(
              "P-W1-08",
              observed,
              "a plain delete of a non-empty layer was not refused NOT_EMPTY, or changed the layer or its entity",
            )
          : !del.ok
            ? partial(
                "P-W1-08",
                observed,
                `the refusal holds; withContents answered ${String(del.code)}: ${S(del.message)}`,
              )
            : !deleteClean
              ? killed(
                  "P-W1-08",
                  observed,
                  "withContents left a pathless layer or W1_D1 (in memory, in a layer file or in the reopened copy)",
                )
              : !dryOk || !undoRestored
                ? partial(
                    "P-W1-08",
                    observed,
                    !dryOk
                      ? "the refusal and the delete hold; withContents without confirm was not a dry run of 1 entity"
                      : "the refusal and the delete hold; one undo did not restore the layer and its entity",
                  )
                : settled(
                    "P-W1-08",
                    observed,
                    "a non-empty layer is refused NOT_EMPTY; withContents deletes its entity and the layer with no pathless layer, one undo restores both, and the delete holds after save and reopen",
                  );
        return {
          ...verdictOf(fails, [p], "layer delete refused, then deleted with its contents"),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w1-76-prefab-remove",
      block: "W1.7",
      title:
        "a throwaway template opened in prefab edit mode: addMembers, save, removeMembers of the new member found in the full list, save; each save diffed (P-W1-18)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + TIMEOUTS.step,
      expected:
        "the first save adds the member's lines to the .et; removeMembers of it answers ok; the second save removes them again",
      kill_criterion:
        "RemovePrefabMembers answers false on a mapped member: KILLED (removeMembers ships refused UNPROVEN); the member is not in the list: PARTIAL (it cannot be addressed)",
      side_effects: [
        `${REMOVE_ET} written and saved twice; the World Editor left in prefab edit mode`,
      ],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/; the next step reopens a world",
      probes: ["P-W1-18"],
      writes: [REMOVE_ET],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        ...saveThrowawayPlan("the open throwaway world saved in place before the switch"),
        ...openPlan(FIXTURE_WORLD),
        tc("wb_world", "state"),
        tc("wb_entity", "create", { prefab: PROP, name: "W1_R" }),
        tc("wb_prefabs", "createTemplate", { entity: "name:W1_R", path: REMOVE_ET, confirm: true }),
        ...undoPlan(2),
        tc("wb_module", "open", { moduleName: "WorldEditor" }),
        tc("wb_module", "setResource", { moduleName: "WorldEditor", path: REMOVE_ET }),
        tc("wb_prefabs", "editState"),
        tc("wb_entity", "list", { limit: 200 }),
        tc("wb_prefabs", "addMembers", { member: "<root>", prefab: PROP }),
        tc("wb_entity", "list", { limit: 200 }),
        tc("wb_prefabs", "save", { confirm: true }),
        tc("wb_prefabs", "removeMembers", { entities: ["index:<the new member>"] }),
        tc("wb_prefabs", "editState"),
        tc("wb_prefabs", "save", { confirm: true }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const etAbs = abs(ctx.opts.sandboxDir, REMOVE_ET);
        // A known, clean world first (run 6: a step must never meet a dirty throwaway world at a
        // switch, and a --from resume must start from a known one): the throwaway world left open
        // is saved in place, then the fixture is opened; the template's entity is undone there.
        evidence.leftOpenSaved = await saveThrowaway(ctx);
        const fx = await openFixture(ctx);
        evidence.fixture = fx.evidence;
        if (!fx.ok)
          return {
            status: "FAIL",
            detail: `the fixture ${FIXTURE_WORLD} did not open`,
            evidence,
            probes: [partial("P-W1-18", {}, "not sent: no known world")],
          };
        const r = await create(ctx, "W1_R");
        const ct = r.r.ok
          ? await ctx.tool("wb_prefabs", {
              action: "createTemplate",
              entity: r.ref,
              path: REMOVE_ET,
              confirm: true,
            })
          : null;
        const undos = await payUndos(ctx);
        evidence.template = { create: brief(r.r), createTemplate: ct ? brief(ct) : null, undos };
        if (!ct?.ok || !ctx.deps.exists(etAbs))
          return {
            status: "FAIL",
            detail: `createTemplate of ${REMOVE_ET} failed`,
            evidence,
            probes: [partial("P-W1-18", {}, "not sent: no template")],
          };
        const pre = await beforeSwitch(ctx);
        const open = await ctx.tool("wb_module", { action: "open", module: "WorldEditor" });
        const set = await ctx.tool("wb_module", {
          action: "setResource",
          module: "WorldEditor",
          target: `path:${REMOVE_ET}`,
        });
        let es0: ToolResponse | null = null;
        const started = ctx.deps.now();
        for (;;) {
          es0 = await ctx.tool("wb_prefabs", { action: "editState" });
          if ((es0.ok && rb(es0).prefabEdit === true) || !set.ok) break;
          if (ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open) break;
          await ctx.sleep(TIMEOUTS.poll);
        }
        Object.assign(evidence, {
          beforeSwitch: pre,
          open: brief(open),
          setResource: brief(set),
          editState0: brief(es0),
        });
        if (!(es0?.ok && rb(es0).prefabEdit === true))
          return {
            status: "FAIL",
            detail: "prefab edit mode not entered",
            evidence,
            probes: [partial("P-W1-18", {}, "edit mode not entered")],
          };
        const root = S(rb(es0).rootId);
        const rootRef = root ? (root.startsWith("id:") ? root : `id:${root}`) : "index:0";
        const text = (): string => ctx.deps.readBytes(etAbs).toString("utf-8");
        const t0 = text();
        const l0 = await ctx.tool("wb_entity", { action: "list", limit: 200 });
        const add = await ctx.tool("wb_prefabs", {
          action: "addMembers",
          member: rootRef,
          prefab: PROP,
        });
        const l1 = await ctx.tool("wb_entity", { action: "list", limit: 200 });
        const sv1 = await ctx.tool("wb_prefabs", { action: "save", confirm: true });
        const t1 = text();
        const ids0 = new Set(rowsOf(l0).map((x) => S(x.id)));
        const rows1 = rowsOf(l1);
        const pos = rows1.findIndex((x) => !ids0.has(S(x.id)));
        const memberRef = pos >= 0 ? (rows1.length > rowsOf(l0).length ? `index:${pos}` : "") : "";
        const rem = memberRef
          ? await ctx.tool("wb_prefabs", { action: "removeMembers", entities: [memberRef] })
          : null;
        const es2 = await ctx.tool("wb_prefabs", { action: "editState" });
        const l2 = await ctx.tool("wb_entity", { action: "list", limit: 200 });
        const sv2 = await ctx.tool("wb_prefabs", { action: "save", confirm: true });
        const t2 = text();
        const d1 = exactLineDiff(t0, t1);
        const d2 = exactLineDiff(t1, t2);
        Object.assign(evidence, {
          list0: brief(l0),
          addMembers: brief(add),
          list1: brief(l1),
          save1: brief(sv1),
          memberRef: memberRef || null,
          removeMembers: rem ? brief(rem) : null,
          editState2: brief(es2),
          list2: brief(l2),
          save2: brief(sv2),
          diffAdd: d1,
          diffRemove: d2,
        });
        if (!add.ok) fails.push(`addMembers: ${add.code} ${add.message}`);
        if (!sv1.ok || !sv2.ok) fails.push("a save failed");
        const observed = {
          listCounts: [rowsOf(l0).length, rows1.length, rowsOf(l2).length],
          memberRef: memberRef || null,
          remove: rem ? brief(rem) : null,
          saveAddLines: { removed: d1.removed.length, added: d1.added.length },
          saveRemoveLines: { removed: d2.removed.length, added: d2.added.length },
          backToStart: exactLineDiff(t0, t2),
        };
        const p =
          !add.ok || !sv1.ok
            ? partial("P-W1-18", observed, "addMembers or the first save failed")
            : !rem
              ? partial(
                  "P-W1-18",
                  observed,
                  "the new member is not in the editor entity list: removeMembers cannot address it",
                )
              : !rem.ok && rem.code === "ENGINE_FALSE"
                ? killed(
                    "P-W1-18",
                    observed,
                    "RemovePrefabMembers answered false on a mapped member",
                  )
                : !rem.ok
                  ? partial(
                      "P-W1-18",
                      observed,
                      `removeMembers did not reach the engine (${rem.code})`,
                    )
                  : d1.added.length > 0 && d2.removed.length > 0
                    ? settled(
                        "P-W1-18",
                        observed,
                        "the saved .et gains the member on add and loses it on remove; the member calls and SaveEntityTemplate work",
                      )
                    : partial(
                        "P-W1-18",
                        observed,
                        "the calls answer ok but a save diff does not show the member",
                      );
        return {
          ...verdictOf(fails, [p], "prefab member round trip saved"),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w1-77-container-diff",
      block: "W1.7",
      title:
        "path writes on the planted .conf measured with an exact (LCS) line diff: set, clear, arrayAdd, setClass (P-W1-21)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "each confirmed write removes or adds only its own lines (clear: the key's line; setClass: the object's block); run 4's 648 and 645 were the positional count",
      kill_criterion:
        "a write changes lines outside its key or object: KILLED (path writes stay refused UNPROVEN)",
      side_effects: [`${PLANT_CONF} written by each confirmed write`],
      rollback: "`w1.live.ts rollback` removes _throwaway/W1/",
      probes: ["P-W1-21"],
      writes: [PLANT_CONF],
      plan: () => [
        tc("wb_container", "describe", {
          target: `path:${PLANT_CONF}`,
          mode: "page",
          limit: 200,
          fields: DESCRIBE_FIELDS,
        }),
        tc("wb_container", "set", {
          target: `path:${PLANT_CONF}`,
          path: "<scalar>",
          value: "<new>",
          confirm: true,
        }),
        tc("wb_container", "clear", {
          target: `path:${PLANT_CONF}`,
          path: "<scalar>",
          confirm: true,
        }),
        tc("wb_container", "arrayAdd", {
          target: `path:${PLANT_CONF}`,
          path: "<array>",
          className: "<class>",
          confirm: true,
        }),
        tc("wb_container", "setClass", {
          target: `path:${PLANT_CONF}`,
          path: "<object>",
          className: "<class>",
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const file = abs(ctx.opts.sandboxDir, PLANT_CONF);
        if (!ctx.deps.exists(file))
          return {
            status: "NOT-RUN",
            detail: `${PLANT_CONF} is absent (the plant of w1-00)`,
            evidence,
            probes: [partial("P-W1-21", {}, "not sent: no plant")],
          };
        const target = `path:${PLANT_CONF}`;
        const text = (): string => ctx.deps.readBytes(file).toString("utf-8");
        const d = await ctx.tool("wb_container", {
          action: "describe",
          target,
          mode: "page",
          limit: 200,
          fields: DESCRIBE_FIELDS,
        });
        const rows = rowsOf(d);
        const scalar = rows.find(
          (r) => /^(INTEGER|SCALAR|BOOLEAN)$/.test(S(r.type)) && S(r.path) && S(r.set) === "true",
        );
        const array = rows.find(
          (r) => S(r.type) === "OBJECT_ARRAY" && S(r.objectClass) && S(r.path),
        );
        const object = rows.find((r) => S(r.type) === "OBJECT" && S(r.objectClass) && S(r.path));
        evidence.picked = { scalar: scalar ?? null, array: array ?? null, object: object ?? null };
        if (!scalar)
          return {
            status: "NOT-RUN",
            detail: "describe found no set scalar",
            evidence,
            probes: [partial("P-W1-21", { describe: brief(d) }, "not sent: no scalar")],
          };
        const writes: Raw[] = [];
        const write = async (label: string, args: Raw): Promise<ToolResponse> => {
          const before = text();
          const res = await ctx.tool("wb_container", { ...args, target, confirm: true });
          const diff = exactLineDiff(before, text());
          writes.push({
            label,
            answer: brief(res),
            positional: lineDiffCount(before, text()),
            ...diff,
          });
          return res;
        };
        const old = S(scalar.value);
        const next = /BOOLEAN/i.test(S(scalar.type))
          ? old === "1" || old === "true"
            ? "0"
            : "1"
          : String(Number(old || 0) + 1);
        // The first write canonicalises the file (run 4: set changed 1 line); the later writes are
        // measured on a canonical file, so their diff is theirs alone.
        const s = await write("set", { action: "set", path: S(scalar.path), value: next });
        const c = await write("clear", { action: "clear", path: S(scalar.path) });
        const a = array
          ? await write("arrayAdd", {
              action: "arrayAdd",
              path: S(array.path),
              className: S(array.objectClass),
            })
          : null;
        const sc = object
          ? await write("setClass", {
              action: "setClass",
              path: S(object.path),
              className: S(object.objectClass),
            })
          : null;
        evidence.writes = writes;
        if (!s.ok) fails.push(`set: ${s.code} ${s.message}`);
        const size = (label: string): number => {
          const w = writes.find((x) => x.label === label);
          return w ? (w.removed as string[]).length + (w.added as string[]).length : -1;
        };
        const observed = {
          perWrite: writes.map((w) => ({
            label: w.label,
            ok: field(w.answer, "ok"),
            code: field(w.answer, "code") ?? null,
            positional: w.positional,
            removed: (w.removed as string[]).length,
            added: (w.added as string[]).length,
          })),
        };
        const clearSize = c.ok ? size("clear") : -1;
        const classSize = sc?.ok ? size("setClass") : -1;
        const p = !c.ok
          ? partial("P-W1-21", observed, `clear answered ${c.code}`)
          : clearSize > 2
            ? killed(
                "P-W1-21",
                observed,
                `clear changed ${clearSize} lines exactly: it rewrites more than its key`,
              )
            : sc && !sc.ok
              ? partial(
                  "P-W1-21",
                  observed,
                  `clear is clean (${clearSize} line(s)); setClass answered ${sc.code}`,
                )
              : sc && classSize > 60
                ? killed(
                    "P-W1-21",
                    observed,
                    `setClass changed ${classSize} lines exactly: more than an object's block`,
                  )
                : sc
                  ? settled(
                      "P-W1-21",
                      observed,
                      `exact diffs: clear ${clearSize} line(s), setClass ${classSize} line(s) of the object's block; arrayAdd ${a ? (a.ok ? "ok" : S(a.code)) : "not sent"}`,
                    )
                  : partial(
                      "P-W1-21",
                      observed,
                      `clear is clean (${clearSize} line(s)); no object to setClass`,
                    );
        return { ...verdictOf(fails, [p], "container path writes diffed"), evidence, probes: [p] };
      },
    },

    // ── W1.5 play, last ──
    {
      id: "w1-60-play",
      block: "W1.5",
      title:
        "reopen the fixture; playEvents; play; state during play; stop (always, in finally); state; playEvents (P-W1-17, P-W1-16 play half)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + TIMEOUTS.play,
      expected:
        "play settles in mode play; state answers during play (the NET API is alive); stop settles in edit; playEvents holds started then ended after the baseline",
      kill_criterion:
        "NET dead in play: KILLED (play returns after the switch; playEvents read after stop); hooks never fire: KILLED (playEvents rows blocked:P-W1-17)",
      side_effects: ["play mode entered and left; nothing saved"],
      rollback: "wb_world stop, sent in a finally path even after a cut by a non-dialog window",
      probes: ["P-W1-17", "P-W1-16"],
      writes: [],
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        ...openPlan(FIXTURE_WORLD),
        tc("wb_world", "playEvents"),
        tc("wb_world", "play", { debugMode: false, fullScreen: false }),
        tc("wb_world", "state"),
        tc("wb_world", "stop"),
        tc("wb_world", "state"),
        tc("wb_world", "playEvents", { after: "<baseline>" }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const probes: ProbeResult[] = [];
        const o = await openWorld(ctx, FIXTURE_WORLD);
        evidence.open = o.evidence;
        if (!o.ok)
          throw new StopBattery("stopped", "the fixture did not reopen for play", evidence);
        const ev0 = await ctx.tool("wb_world", { action: "playEvents" });
        const baseline = Number(rb(ev0).eventSeq ?? 0);
        let play: ToolResponse | null = null;
        let during: ToolResponse | null = null;
        let stop: ToolResponse | null = null;
        // The stop is owed from here: the runner sends it even when the step is cut.
        ctx.debt.restorers.push({
          label: "wb_world stop",
          fn: async () => {
            const s = await ctx.deps.tool("wb_world", { action: "stop" });
            await settleEdit(ctx.deps);
            return s;
          },
        });
        try {
          play = await ctx.tool("wb_world", {
            action: "play",
            debugMode: false,
            fullScreen: false,
          });
          during = await ctx.tool("wb_world", { action: "state" });
        } finally {
          if (!ctx.signal.aborted) {
            stop = await ctx.tool("wb_world", { action: "stop" }, { restore: true });
            // Play is left before the step ends: the next steps and the closable step meet edit mode.
            if (!ctx.signal.aborted) evidence.editPolls = (await waitMode(ctx, "edit")).polls;
            ctx.debt.restorers.pop();
          }
        }
        const after = await ctx.tool("wb_world", { action: "state" });
        const ev1 = await ctx.tool("wb_world", { action: "playEvents", after: baseline });
        Object.assign(evidence, {
          eventsBefore: brief(ev0),
          play: brief(play!),
          stateDuringPlay: during ? brief(during) : null,
          stop: stop ? brief(stop) : null,
          stateAfter: brief(after),
          eventsAfter: brief(ev1),
        });
        const events = Array.isArray(rb(ev1).events)
          ? (rb(ev1).events as Raw[]).map((e) => S(e.event))
          : [];
        const observed = {
          playMode: rb(play!).mode ?? null,
          playSettled: rb(play!).settled ?? null,
          stateDuringPlay: during?.readback ?? null,
          stateDuringPlayCode: during?.code ?? null,
          stopMode: stop ? rb(stop).mode : null,
          modeAfter: rb(after).mode ?? null,
          events,
        };
        if (!stop?.ok || S(rb(after).mode) !== "edit")
          fails.push(`not back in edit mode (${S(rb(after).mode)})`);
        const netAlive = !!during?.ok;
        const started = events.findIndex((e) => /start/i.test(e));
        const ended = events.findIndex((e) => /end/i.test(e));
        probes.push(
          !play?.ok || rb(play).settled !== true
            ? killed("P-W1-17", observed, `play did not settle: ${play?.code ?? S(rb(play!).mode)}`)
            : !netAlive
              ? killed(
                  "P-W1-17",
                  observed,
                  "the NET API did not answer during play: play returns after the switch, playEvents read after stop",
                )
              : started < 0 || ended < started
                ? killed(
                    "P-W1-17",
                    observed,
                    "the recorder hooks did not record started then ended: playEvents rows blocked:P-W1-17",
                  )
                : settled(
                    "P-W1-17",
                    observed,
                    "play and stop by script; NET answers in play; recorder holds started then ended",
                  ),
        );
        probes.push(
          netAlive && S(rb(during!).mode) === "play"
            ? settled(
                "P-W1-16",
                { stateDuringPlay: during!.readback ?? null },
                "the flags read in play mode too (edit half in w1-10)",
              )
            : partial(
                "P-W1-16",
                { stateDuringPlay: during?.readback ?? null, code: during?.code ?? null },
                "no state answer in play mode",
              ),
        );
        return { ...verdictOf(fails, probes, "play round trip"), evidence, probes };
      },
    },

    // ── W1.6 net-zero ──
    {
      id: "w1-90-netzero",
      block: "W1.6",
      title:
        "the sandbox outside _throwaway/W1/ against the gate's snapshot; no W1_ entity left in the fixture",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `no file outside ${W1_ROOT}/ changed (a change of ${NETZERO_TOLERATED.join(", ")} is recorded); the fixture lists no W1_ entity`,
      kill_criterion: "a file outside the throwaway folder changed: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      plan: () => [tc("wb_entity", "list", { name: NAME_PREFIX })],
      run: async (ctx) => {
        const nz = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
        if (!nz)
          return {
            status: "NOT-RUN",
            detail: `${BATTERY_SNAPSHOT_FILE} is absent or unreadable (the run takes it before its first step; check the sitting folder)`,
            evidence: {},
          };
        const changed = nz.changed;
        const bad = changed.filter((f) => !NETZERO_TOLERATED.includes(f));
        const l = await ctx.tool("wb_entity", { action: "list", name: NAME_PREFIX });
        const left = Array.isArray(rb(l).rows) ? (rb(l).rows as Raw[]).map((r) => S(r.name)) : [];
        const snapRaw = readJson<Raw>(join(ctx.opts.sittingDir, nz.source), ctx.deps);
        const evidence = {
          snapshot: nz.source,
          snapshotTakenBy: S(snapRaw?.taken_by) || null,
          snapshotTakenAt: S(snapRaw?.taken_at) || null,
          comparedOnlyDeclared: nz.declared,
          changed,
          outsideThrowaway: bad,
          tolerated: changed.filter((f) => NETZERO_TOLERATED.includes(f)),
          w1EntitiesLeft: left,
        };
        const fails: string[] = [];
        if (bad.length) fails.push(`changed outside ${W1_ROOT}/: ${bad.join(", ")}`);
        if (left.length) fails.push(`W1_ entities left: ${left.join(", ")}`);
        return {
          ...verdictOf(
            fails,
            [],
            `net-zero outside ${W1_ROOT}/ (${changed.length} tolerated change(s))` +
              (evidence.snapshotTakenBy === "run start"
                ? `; the snapshot was taken at the start of a resumed run (${S(evidence.snapshotTakenAt)}): changes before it are not seen`
                : ""),
          ),
          evidence,
        };
      },
    },
    closableStep(),
  ];
}

/**
 * The last step, also run after a stop: leave Workbench closable by one WM_CLOSE. A world with
 * in-memory edits does not exit on WM_CLOSE (DEC-045); the first live run stopped in w1-44 with
 * EMCP_W1_Dup.ent open after edits and undos, and the post-flight close hung on a dialog nobody
 * saw. So: stop play if it runs, then open a world that was not open (a fresh load with no edit:
 * the fixture, or when the fixture is the open one the copy w1-41 made, else the vanilla terrain
 * world), which also leaves prefab edit mode. Nothing is saved.
 */
export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W1.6",
    title:
      "leave Workbench closable: stop play if running, leave prefab edit mode, open a world not open now (fresh, unedited); never save",
    risk: "reversible",
    timeout_ms: TIMEOUTS.open + 60_000,
    expected:
      "mode edit, prefabEdit false, a freshly opened world with no edit; the post-flight WM_CLOSE exits without a save prompt",
    kill_criterion:
      "the world does not open: FAIL (the runbook's hand answers any save prompt with Don't Save)",
    side_effects: ["the World Editor opens another world; nothing is saved"],
    rollback: "none: nothing is edited",
    probes: [],
    writes: [],
    expectsWindows: WORLD_EDITOR_WINDOWS,
    plan: () => [
      tc("wb_world", "state"),
      tc(
        "wb_world",
        "stop",
        {},
        { note: "only when the state reads play; state then polled until edit" },
      ),
      tc("wb_prefabs", "editState"),
      ...openPlan(FIXTURE_WORLD),
      tc("wb_prefabs", "editState"),
    ],
    run: async (ctx) => leaveClosable(ctx),
  };
}

/** The most wb_world state polls a wait for a mode sends: TIMEOUTS.open at TIMEOUTS.poll apart. */
export const MODE_POLLS = Math.ceil(TIMEOUTS.open / TIMEOUTS.poll);

/** Polls wb_world state until the mode is `mode` (W4's and W8's waitMode), at most MODE_POLLS times. */
export async function waitMode(
  ctx: StepContext,
  mode: "edit" | "play",
): Promise<{ ok: boolean; polls: number }> {
  let polls = 0;
  for (;;) {
    polls++;
    const st = await ctx.tool("wb_world", { action: "state" });
    if (st.ok && S(rb(st).mode) === mode) return { ok: true, polls };
    if (polls >= MODE_POLLS) return { ok: false, polls };
    await ctx.sleep(TIMEOUTS.poll);
  }
}

/** The restorer's wait after a stop (deps only: it runs after a cut too): until no play reads. */
async function settleEdit(deps: W1Deps): Promise<void> {
  for (let polls = 1; ; polls++) {
    const st = await deps.tool("wb_world", { action: "state" });
    if (!st.ok || S(rb(st).mode) !== "play" || polls >= MODE_POLLS) return;
    await deps.sleep(TIMEOUTS.poll);
  }
}

/** The body of {@link closableStep}; never throws for a refused call (its record says what happened). */
export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateBefore = brief(st0);
  if (S(rb(st0).mode) === "play") {
    const stop = await ctx.tool("wb_world", { action: "stop" }, { restore: true });
    evidence.stop = brief(stop);
    if (!stop.ok) fails.push(`stop: ${stop.code} ${stop.message}`);
    const w = await waitMode(ctx, "edit");
    evidence.editPolls = w.polls;
    if (!w.ok) fails.push(`play was not left: no edit mode after ${w.polls} poll(s)`);
  }
  const es0 = await ctx.tool("wb_prefabs", { action: "editState" });
  evidence.editStateBefore = brief(es0);
  const open = S(rb(st0).worldPath).toLowerCase();
  const isOpen = (rel: string): boolean => open.endsWith(rel.toLowerCase());
  const dupOnDisk = ctx.deps.exists(abs(ctx.opts.sandboxDir, DUP_WORLD));
  const target =
    !isOpen(FIXTURE_WORLD) || rb(es0).prefabEdit === true
      ? FIXTURE_WORLD
      : dupOnDisk && !isOpen(DUP_WORLD)
        ? DUP_WORLD
        : TERRAIN_WORLD;
  evidence.target = target;
  const o = await openWorld(ctx, target);
  evidence.open = o.evidence;
  if (!o.ok) fails.push(`${target} did not open ('${o.worldPath}')`);
  const es1 = await ctx.tool("wb_prefabs", { action: "editState" });
  evidence.editStateAfter = brief(es1);
  if (rb(es1).prefabEdit === true) fails.push("still in prefab edit mode");
  const st1 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateAfter = brief(st1);
  if (S(rb(st1).mode) !== "edit") fails.push(`mode ${S(rb(st1).mode)}, not edit`);
  return {
    ...verdictOf(fails, [], `closable: ${target} freshly open, mode edit`),
    evidence,
  };
}

/** Changed line count between two texts (positions compared, plus the length difference). */
export function lineDiffCount(a: string, b: string): number {
  const x = a.split(/\r?\n/);
  const y = b.split(/\r?\n/);
  let n = Math.abs(x.length - y.length);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++;
  return n;
}

/**
 * Lines removed from `a` and added in `b` by a longest-common-subsequence diff. Session 023: the
 * positional {@link lineDiffCount} counts every line after an inserted or removed one, so run 4's
 * path clear (648) and setClass (645) read as rewrites of the whole .conf; this count does not.
 */
export function exactLineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const x = a.split(/\r?\n/);
  const y = b.split(/\r?\n/);
  // Common head and tail first: a write touches a few lines, so the table stays small.
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  )
    tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const m = xs.length;
  const n = ys.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      t[i][j] = xs[i] === ys[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (xs[i] === ys[j]) {
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) removed.push(xs[i++]);
    else added.push(ys[j++]);
  }
  while (i < m) removed.push(xs[i++]);
  while (j < n) added.push(ys[j++]);
  return { removed, added };
}

// ── Plan, outline, queue ─────────────────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    target: { gproj: `<sandbox>/${SANDBOX_NAME}.gproj` } as unknown as PlanAction["target"],
    args: [...LAUNCH_ARGS],
    note: "performed by scripts/live/preflight.ts per the runbook, not by this script",
  } as PlanAction;
}

export function buildActionPlan(steps: StepDef[] = buildSteps()): PlanAction[] {
  const out: PlanAction[] = [launchAction()];
  for (const s of steps) for (const a of s.plan()) out.push({ ...a, step: s.id } as PlanAction);
  return out;
}

/** `tool.action` names a step sends, from its plan (toolAction is the tool-level name). */
export function exercisedBy(s: StepDef): string[] {
  return [
    ...new Set(
      s
        .plan()
        .filter((a) => typeof a.tool === "string")
        .map((a) => `${String(a.tool)}.${String(a.toolAction)}`),
    ),
  ];
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: World Editor core battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map(
      (s) =>
        `  [${s.block}] ${s.id} (${s.risk})${s.probes.length ? ` {${s.probes.join(", ")}}` : ""}: ${s.title}`,
    ),
    `  not testable hand-free: ${Object.keys(NOT_TESTABLE).join(", ") || "none"}`,
    `  not exercised: ${Object.keys(NOT_EXERCISED).join(", ") || "none"}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w1.live.ts --emit-queue` from its step table; tests/live-harness/w1-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W1 is not in PROBE_MUT_SESSIONS and sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w1-spec.md 3, 6",
      "DEC-045",
      "DEC-053",
      "DEC-058",
      "DEC-061",
      "PLAN 5.3",
      "PLAN 5.4",
    ],
    launches: 1,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "pre-flight builds the real arguments; -scriptAuthorizeAll on the owner's standing go (DEC-053)",
    not_testable: { ...NOT_TESTABLE },
    not_exercised: { ...NOT_EXERCISED },
    probes: steps.map((s) => ({
      id: s.id,
      launch: s.block,
      title: s.title,
      settles: s.probes,
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

export function recordPath(runDir: string, id: string): string {
  return join(runDir, `${id}.json`);
}

export function selectSteps(
  steps: StepDef[],
  sel: { from?: string; only?: string; until?: string },
): StepDef[] | string {
  if (sel.only && (sel.from || sel.until)) return "--only excludes --from and --until";
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  if (sel.only) {
    const i = idx(sel.only);
    return i === -1 ? `${sel.only} is not a step id` : [steps[i]];
  }
  const a = sel.from ? idx(sel.from) : 0;
  const b = sel.until ? idx(sel.until) : steps.length - 1;
  if (a === -1) return `${sel.from} is not a step id`;
  if (b === -1) return `${sel.until} is not a step id`;
  if (b < a) return "--until comes before --from";
  return steps.slice(a, b + 1);
}

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

/** Killed probes recorded in this run folder (they skip the steps that depend on them). */
function killedProbes(
  runDir: string,
  deps: Pick<W1Deps, "exists" | "readBytes">,
  steps: StepDef[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of steps) {
    const r = readJson<StepRecord>(recordPath(runDir, s.id), deps);
    for (const p of r?.probes ?? [])
      if (p.result === "KILLED") out.set(p.id, `${p.id} KILLED in ${s.id}: ${p.note}`);
  }
  return out;
}

/** Undo what a stopped step owes, run its restorers, sweep W1_ entities. Never on a dialog or WEDGED. */
async function cleanupAfterStop(ctx: StepContext, deps: W1Deps): Promise<Raw> {
  const out: Raw = { undos: [] as UndoResult[], restorers: [] as Raw[] };
  while (ctx.debt.undos > 0) {
    const u = await deps.undo();
    ctx.debt.undos--;
    (out.undos as UndoResult[]).push(u);
    if (!u.ok) break;
  }
  for (const r of [...ctx.debt.restorers].reverse()) {
    try {
      const v = (await r.fn()) as ToolResponse | undefined;
      (out.restorers as Raw[]).push({ label: r.label, ok: v?.ok ?? null, code: v?.code ?? null });
    } catch (e) {
      (out.restorers as Raw[]).push({
        label: r.label,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  ctx.debt.restorers = [];
  try {
    const l = await deps.tool("wb_entity", { action: "list", name: NAME_PREFIX, limit: 200 });
    const names = Array.isArray(rb(l).rows)
      ? (rb(l).rows as Raw[]).map((x) => S(x.name)).filter((n) => n.startsWith(NAME_PREFIX))
      : [];
    out.sweepFound = names;
    if (names.length) {
      const d = await deps.tool("wb_entity", {
        action: "delete",
        entities: names.map((n) => `name:${n}`),
      });
      out.sweepDeleted = d.ok;
    }
  } catch (e) {
    out.sweepError = e instanceof Error ? e.message : String(e);
  }
  return out;
}

/** The engine's save prompt: run 2 saw it titled "Loading world" (Yes / No / Cancel). */
export const SAVE_PROMPT_TITLES: readonly string[] = ["Loading world"];

/**
 * What the main session's hand does with a HANDOFF window: the dialog's exact title, the button
 * ("No" on the engine's save prompt: never Yes, never Cancel) and the resume. Run 2: w1-43's open
 * over a dirty copy raised "Do you want to save changes?" in a window titled "Loading world"; No
 * let the open go on and w1-43 passed on --from.
 */
export function handAnswer(
  message: string,
  stepId: string,
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1] : "";
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt ? "No" : "none planned: record the title and text; never Save";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `hand: the engine's save prompt "${title}" ("Do you want to save changes?" Yes / No / Cancel): press No (never Yes, never Cancel), then resume ${resume}`
    : `hand: window "${title}": ${answer}; then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
}

/** The closable step after a stop: no window poll, no stop codes thrown; its record is written. */
async function closeOutAfterStop(
  deps: W1Deps,
  opts: W1Options,
  prior: (id: string) => StepRecord | null,
  write: (r: StepRecord) => void,
): Promise<void> {
  const def = closableStep();
  const startedAt = new Date(deps.now()).toISOString();
  const calls: Array<Record<string, unknown>> = [];
  const ctx: StepContext = {
    deps,
    opts,
    prior,
    calls,
    debt: { undos: 0, restorers: [] },
    signal: new AbortController().signal,
    sleep: (ms) => deps.sleep(ms),
    tool: async (name, args) => {
      const r = await deps.tool(name, args);
      calls.push({ tool: name, args, ok: r.ok, code: r.code ?? null });
      return r;
    },
    undo: async () => {
      const u = await deps.undo();
      calls.push({ undo: u });
      return u;
    },
  };
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
    probes: [],
    evidence: { ...out.evidence, calls },
  });
}

export async function runBattery(
  steps: StepDef[],
  deps: W1Deps,
  opts: W1Options,
): Promise<BatteryReport> {
  const all = buildSteps();
  const records: StepRecord[] = [];
  const write = (r: StepRecord): void => {
    const clean = JSON.parse(toPlaceholders(JSON.stringify(r), opts.ph)) as StepRecord;
    const path = recordPath(opts.runDir, r.step);
    deps.writeBytes(path, Buffer.from(JSON.stringify(clean, null, 2) + "\n", "utf-8"));
    records.push(clean);
    if (opts.evidenceDir) {
      const probes = r.probes.map((p) => `${p.id} ${p.result}`).join(", ");
      writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${r.step}`,
          build: opts.build,
          result_summary:
            `${r.step}: ${r.status}${probes ? ` [${probes}]` : ""} - ${r.detail}`.slice(0, 2000),
          artifacts: [path],
        },
        opts.ph,
      );
    }
    writeResult(opts, deps, all);
  };
  const prior = (id: string): StepRecord | null =>
    readJson<StepRecord>(recordPath(opts.runDir, id), deps);
  // Before any step: a run that starts past w1-00 (--from, --only) in a sitting with no snapshot
  // takes it now, so w1-90 always has one to diff against (run 7 answered NOT-RUN).
  if (steps.length && steps[0]!.id !== "w1-00-gate")
    ensureBatterySnapshot(opts.sittingDir, opts.sandboxDir, deps, "run start");
  let consecutiveFails = 0;
  for (const s of steps) {
    if (deps.exists(recordPath(opts.runDir, s.id)))
      return {
        exit: EXIT.refused,
        records,
        stoppedAt: s.id,
        message: `${s.id} already has a record in this run folder: a step is never run twice (plan 5.3)`,
      };
    const startedAt = new Date(deps.now()).toISOString();
    const base = { step: s.id, block: s.block, title: s.title, startedAt };
    const killedNow = killedProbes(opts.runDir, deps, all);
    const blockers = (s.dependsOn ?? []).filter((p) => killedNow.has(p));
    if (blockers.length) {
      write({
        ...base,
        status: "SKIPPED",
        detail: blockers.map((p) => killedNow.get(p)).join("; "),
        endedAt: startedAt,
        probes: [],
        evidence: {},
      });
      continue;
    }
    deps.log(`step ${s.id}: ${s.title}`);
    const calls: Array<Record<string, unknown>> = [];
    const abort = new AbortController();
    const guard = (what: string): void => {
      if (abort.signal.aborted) {
        calls.push({ notSent: what });
        throw new StepCut();
      }
    };
    const debt: Debt = { undos: 0, restorers: [] };
    let clientStop: string | null = null;
    const ctx: StepContext = {
      deps,
      opts,
      prior,
      calls,
      debt,
      signal: abort.signal,
      sleep: async (ms) => {
        guard("sleep");
        await deps.sleep(ms);
        guard("sleep");
      },
      tool: async (name, args, o = {}) => {
        guard(`${name} ${S(args.action)}`);
        const r = await deps.tool(name, args);
        calls.push({ tool: name, args, ok: r.ok, code: r.code ?? null });
        if (!r.ok && STOP_CODES.has(S(r.code))) {
          clientStop = S(r.code);
          throw new StopBattery(
            r.code === "MODAL_OPEN" ? "handoff" : "stopped",
            `${name} ${S(args.action)} answered ${r.code}: ${r.message ?? ""}`,
          );
        }
        if (r.ok && !o.restore && S(rb(r).undoName)) debt.undos++;
        return r;
      },
      undo: async () => {
        guard("undo");
        const u = await deps.undo();
        calls.push({ undo: u });
        if (u.ok && debt.undos > 0) debt.undos--;
        if (!u.ok && STOP_CODES.has(S(u.code))) {
          clientStop = S(u.code);
          throw new StopBattery(
            u.code === "MODAL_OPEN" ? "handoff" : "stopped",
            `undo answered ${u.code}: ${u.message}`,
          );
        }
        return u;
      },
    };
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
      write({
        ...base,
        status: out.status,
        detail: out.detail,
        endedAt: new Date(deps.now()).toISOString(),
        probes: out.probes ?? [],
        evidence: { ...out.evidence, calls },
      });
      consecutiveFails = out.status === "FAIL" ? consecutiveFails + 1 : 0;
      if (consecutiveFails >= 3) {
        if (s.id !== CLOSABLE_STEP && !deps.exists(recordPath(opts.runDir, CLOSABLE_STEP)))
          await closeOutAfterStop(deps, opts, prior, write);
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
      // LOST or WEDGED: the client is not answering; nothing more is sent (the debt is recorded).
      const wedged = clientStop === "WEDGED" || clientStop === "LOST";
      let cleanup: Raw | null = null;
      if (!dialog && !wedged && kind !== "aborted") {
        try {
          cleanup = await cleanupAfterStop(ctx, deps);
        } catch (ce) {
          cleanup = { error: ce instanceof Error ? ce.message : String(ce) };
        }
      }
      const hand = kind === "handoff" ? handAnswer(message, s.id) : null;
      write({
        ...base,
        status: kind === "aborted" ? "ABORTED" : kind === "handoff" ? "HANDOFF" : "STOPPED",
        detail: hand ? `${message}; ${hand.instruction}` : message,
        endedAt: new Date(deps.now()).toISOString(),
        probes: [],
        evidence: {
          ...(stop?.evidence ?? {}),
          ...(hand ? { handAnswer: hand } : {}),
          cut: abort.signal.aborted,
          calls,
          cleanup,
          pendingDebt: cleanup
            ? null
            : { undos: debt.undos, restorers: debt.restorers.map((r) => r.label) },
        },
        stop: message,
      });
      // Leave Workbench closable even after a stop (the first live run's close hung after one).
      if (
        !dialog &&
        !wedged &&
        kind !== "aborted" &&
        s.id !== CLOSABLE_STEP &&
        !deps.exists(recordPath(opts.runDir, CLOSABLE_STEP))
      )
        await closeOutAfterStop(deps, opts, prior, write);
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

/** `<sitting>/w1-result.json`: every step's latest record across the sitting's run folders, and each probe's result. */
export function writeResult(
  opts: W1Options,
  deps: Pick<W1Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  const runs = new Set(
    deps
      .listTree(opts.sittingDir)
      .filter((f) => f.includes("/"))
      .map((f) => f.split("/")[0]),
  );
  for (const run of [...runs].sort()) {
    for (const s of steps) {
      const r = readJson<StepRecord>(recordPath(join(opts.sittingDir, run), s.id), deps);
      if (r) latest.set(s.id, { ...r, runDir: run });
    }
  }
  const probes: Record<string, unknown> = {};
  for (const id of PROBE_IDS) {
    const hits = steps
      .filter((s) => latest.get(s.id)?.probes?.some((p) => p.id === id))
      .map((s) => ({ step: s.id, ...latest.get(s.id)!.probes.find((p) => p.id === id)! }));
    probes[id] = NOT_TESTABLE[id]
      ? { result: "NOT-TESTABLE", note: NOT_TESTABLE[id] }
      : hits.length
        ? {
            result: hits.some((h) => h.result === "KILLED")
              ? "KILLED"
              : hits.every((h) => h.result === "SETTLED")
                ? "SETTLED"
                : "PARTIAL",
            by: hits,
          }
        : { result: "NOT-RUN", steps: steps.filter((s) => s.probes.includes(id)).map((s) => s.id) };
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
            probes: r.probes.map((p) => `${p.id} ${p.result}`),
            exercises: exercisedBy(s),
          }
        : {
            id: s.id,
            status: "NOT-RUN",
            detail: "no record in this sitting",
            exercises: exercisedBy(s),
          };
    }),
    probes,
    not_exercised: NOT_EXERCISED,
  };
  const clean = JSON.parse(toPlaceholders(JSON.stringify(value), opts.ph)) as unknown;
  writeJson(join(opts.sittingDir, RESULT_FILE), clean, deps);
}

/** The final stdout table: step id, status, one-line detail. */
export function resultTable(records: StepRecord[]): string[] {
  const w = Math.max(4, ...records.map((r) => r.step.length));
  const line = (a: string, b: string, c: string): string => `${a.padEnd(w)}  ${b.padEnd(8)}  ${c}`;
  return [
    line("step", "status", "detail"),
    line("-".repeat(w), "-".repeat(8), "-".repeat(6)),
    ...records.map((r) => line(r.step, r.status, r.detail.replace(/\s+/g, " ").slice(0, 160))),
  ];
}

// ── Offline subcommands: plant and rollback ──────────────────────────────────

export interface OfflineIo {
  workbenchPids: () => number[];
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
  listTree: (p: string) => string[];
  readBytes: (p: string) => Buffer;
  writeBytes: (p: string, b: Buffer) => void;
  makeDir: (p: string) => void;
  removeTree: (p: string) => void;
  readVanilla: (vpath: string) => Promise<Buffer>;
  log: (l: string) => void;
}

/** `plant`: vanilla configs/inputCommon.conf to _throwaway/W1/conf/ and the plant record (no Workbench running). */
export async function runPlant(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): Promise<number> {
  const target = abs(sandboxDir, PLANT_CONF);
  io.log(`plant: ${VANILLA_CONF} (paks) -> <sandbox>/${PLANT_CONF}`);
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the plant is offline`);
    return EXIT.refused;
  }
  if (io.exists(abs(sandboxDir, W1_ROOT))) {
    io.log(`refused: <sandbox>/${W1_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const throwawayExistedBefore = io.exists(abs(sandboxDir, THROWAWAY));
  const bytes = await io.readVanilla(VANILLA_CONF);
  io.writeBytes(
    join(sittingDir, PLANT_FILE),
    Buffer.from(
      JSON.stringify({ rel: PLANT_CONF, sha256: sha256(bytes), throwawayExistedBefore }, null, 2) +
        "\n",
    ),
  );
  io.writeBytes(target, bytes);
  io.log(`planted ${bytes.length} bytes (sha256 ${sha256(bytes)})`);
  // w1-42 writes its prefabs here; wb_prefabs refuses a target whose folder does not exist
  // (NewTargetInProject), which is what the first live run met (NOT_IN_PROJECT on every call).
  io.makeDir(abs(sandboxDir, PREFABS_DIR));
  io.log(`made <sandbox>/${PREFABS_DIR}/`);
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W1/; `_throwaway/` only when empty and absent before. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W1_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W1_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W1_ROOT}/ (${files.length} files)`);
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
    join(sittingDir, "throwaway-w1-listing.json"),
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
  io.log(`removed <sandbox>/${W1_ROOT}/ (listing in throwaway-w1-listing.json)`);
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
      // A file can vanish between the listing and the stat (Workbench writes its settings
      // through a temp file beside the scratch ini): a vanished entry is not listed.
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

type LegacyToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type LegacyToolCallback = (args: Raw) => Promise<LegacyToolResult>;

/**
 * One of the 1.x terrain tools (terrain_inspect, terrain_navmesh_status, terrain_road_export_graph)
 * run in process through its own registered callback (fix-up 2: wb_terrain refuses these actions,
 * so w1-50 would have failed on its first live run). An error answer is ok false, code TOOL_ERROR.
 */
export async function runLegacyTerrainTool(
  client: WorkbenchClient,
  action: string,
  args: Raw,
): Promise<ToolResponse> {
  const holder: { cb: LegacyToolCallback | null } = { cb: null };
  const server = {
    registerTool: (_name: string, _def: unknown, cb: LegacyToolCallback) => {
      holder.cb = cb;
    },
  } as unknown as McpServer;
  if (action === "inspect") registerTerrainInspect(server, client);
  else if (action === "navmesh_status") registerTerrainNavmeshStatus(server, client);
  else registerTerrainRoadExportGraph(server, client);
  if (!holder.cb) return { ok: false, action, code: "INVALID_ARGUMENT", message: "no tool" };
  const out = await holder.cb({ world_path: S(args.world_path) });
  const text = out.content.map((c) => S(c.text)).join("\n");
  return {
    ok: out.isError !== true,
    action,
    ...(out.isError === true ? { code: "TOOL_ERROR" } : {}),
    message: text.slice(0, 500),
    readback: { text: text.slice(0, 2000) },
  };
}

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W1Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const worldDeps = { projectRoot: input.sandboxDir, artifactsRoot: artifactsDir() };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_entity":
          return asResp(await runEntity(client, args));
        case "wb_view":
          return asResp(await runView(client, args));
        case "wb_world":
          return asResp(await runWorld(client, args, worldDeps));
        case "wb_container":
          return asResp(await runContainer(client, args, { artifactsRoot: artifactsDir() }));
        case "wb_layers":
          return asResp(await runLayers(client, args));
        case "wb_terrain":
          // inspect, navmesh_status and road_export_graph belong to the 1.x terrain_* tools, not
          // wb_terrain (which refuses them): they run through those tools' registered callbacks.
          if (OTHER_TOOL_ACTIONS.includes(S(args.action)))
            return runLegacyTerrainTool(client, S(args.action), args);
          return asResp(await runTerrain(client, args));
        case "wb_prefabs":
          return asResp(await runPrefabs(client, args));
        case "wb_module":
          return asResp(await runModule(client, args as unknown as ModuleArgs));
      }
    },
    undo: async () => {
      try {
        const r = await client.call<Raw>(
          "EMCP_WB_EditorControl",
          { action: "undo" },
          { access: "mutate", timeout: 30_000 },
        );
        const message = S(r.message);
        return { ok: S(r.status) !== "error" && /^Undo executed/.test(message), message };
      } catch (e) {
        if (e instanceof WorkbenchError) return { ok: false, message: e.message, code: e.code };
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
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
        return (await client.probe("EMCP_WB_Ping", {}, { timeout: 10_000 })) as Raw;
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
    makeDir: (p) => {
      mkdirSync(p, { recursive: true });
    },
    removeTree: (p) => rmSync(p, { recursive: true, force: false }),
    readVanilla: async (vpath) => {
      const { PakVirtualFS } = await import("../../src/pak/vfs.js");
      const vfs = PakVirtualFS.get(loadConfig().gamePath);
      if (!vfs) throw new Error("the game paks could not be opened (ENFUSION_GAME_PATH)");
      return vfs.readFile(vpath);
    },
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

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: W1Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
  artifactsRoot?: string;
}

/** The dry-run gate: the plan against the policy and the queue against validateQueue. */
export function dryRunCheck(policy: CensusPolicy): { ok: boolean; lines: string[] } {
  const steps = buildSteps();
  const check = checkPlan(buildActionPlan(steps), policy, { script: SCRIPT_PATH });
  const lines = [formatResult(check)];
  let queueOk = true;
  try {
    const q = validateQueue(buildQueue(steps), false);
    lines.push(`queue: ${q.length} probes valid`);
  } catch (e) {
    queueOk = false;
    lines.push(`queue: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: check.ok && queueOk, lines };
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  const sub = argv[0] === "plant" || argv[0] === "rollback" ? argv[0] : null;
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

  if (sub) {
    if (!o.sandbox || basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
      say(`${sub} needs --sandbox <the test bed folder ${SANDBOX_NAME}>`);
      return EXIT.usage;
    }
    if (!o["sitting-dir"]) {
      say(`${sub} needs --sitting-dir <the sitting folder>`);
      return EXIT.usage;
    }
    if (really) {
      if (!o.id) {
        say(`${sub} --really needs --id <lane id>`);
        return EXIT.usage;
      }
      const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
      const gate = liveGateReason({
        really,
        platform: over.platform ?? process.platform,
        leaseHeld: over.leaseHeld ?? lane.holdsLease(),
      });
      if (gate) {
        say(gate);
        return EXIT.refused;
      }
    }
    const io = {
      ...(over.offlineIo ?? realOfflineIo()),
      log: (l: string) => say(toPlaceholders(l, ph)),
    };
    const sandbox = resolve(o.sandbox);
    const sitting = resolve(o["sitting-dir"]);
    return sub === "plant"
      ? runPlant(sandbox, sitting, really, io)
      : runRollback(sandbox, sitting, really, io);
  }

  const steps = buildSteps();
  const plan = buildActionPlan(steps);
  const policy = over.policy ?? loadPolicy();
  const dry = dryRunCheck(policy);
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps).join("\n") + "\n", "utf-8");
  if (o["emit-queue"])
    writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
  if (!really) {
    for (const l of sessionOutline(steps)) say(l);
    for (const l of dry.lines) say(l);
    return dry.ok ? EXIT.done : EXIT.refused;
  }
  if (!dry.ok) {
    for (const l of dry.lines) say(l);
    return EXIT.refused;
  }
  const selected = selectSteps(steps, { from: o.from, only: o.only, until: o.until });
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
  const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  const gate = liveGateReason({
    really,
    platform: over.platform ?? process.platform,
    leaseHeld: over.leaseHeld ?? lane.holdsLease(),
  });
  if (gate) {
    say(gate);
    return EXIT.refused;
  }
  const sittingDir = resolve(o["sitting-dir"]);
  if (!existsSync(join(sittingDir, PLANT_FILE))) {
    say(
      toPlaceholders(
        `refused: ${sittingDir} holds no ${PLANT_FILE}: run \`w1.live.ts plant\` first`,
        ph,
      ),
    );
    return EXIT.refused;
  }
  const runDir = resolve(
    o["run-dir"] ?? join(sittingDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`),
  );
  if (dirname(runDir) !== sittingDir) {
    say(`--run-dir must lie directly in ${sittingDir}`);
    return EXIT.usage;
  }
  mkdirSync(runDir, { recursive: true });
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  const deps = over.deps ?? realDeps({ port, lane, sandboxDir: resolve(o.sandbox) });
  if (!over.deps) lane.startHeartbeat();
  try {
    const r = await runBattery(selected, deps, {
      runDir,
      sittingDir,
      sandboxDir: resolve(o.sandbox),
      evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
      ph: { ...ph, sandbox: resolve(o.sandbox) },
      build: o.build ?? "unrecorded",
    });
    for (const l of resultTable(r.records)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w1",
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
    lane.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  // An explicit exit: a step cut by the window poller may leave a call in flight.
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// Each row names the W1 battery step(s) above as its live test; the results are in data/census/live-results/.
// census:api:SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource/0
// census:api:SCR_WorldEditorToolHelper.GetTerrainMinMaxY/2
// census:api:WorldEditor.GetApi/0
// census:api:WorldEditor.GetResourceBrowserSelection/2
// census:api:WorldEditor.GetTerrainBounds/2
// census:api:WorldEditor.IsPrefabEditMode/0
// census:api:WorldEditor.SwitchToEditMode/0
// census:api:WorldEditor.SwitchToGameMode/2
// census:api:WorldEditorAPI.AddCommentEntity/4
// census:api:WorldEditorAPI.AddPrefabMembers/2
// census:api:WorldEditorAPI.AddToEntitySelection/1
// census:api:WorldEditorAPI.AreGeneratorEventsEnabled/0
// census:api:WorldEditorAPI.BeginEntityAction/3
// census:api:WorldEditorAPI.ChangeObjectClass/3
// census:api:WorldEditorAPI.ClearEntitySelection/0
// census:api:WorldEditorAPI.ClearVariableValue/3
// census:api:WorldEditorAPI.CreateClonedEntity/4
// census:api:WorldEditorAPI.CreateEntity/6
// census:api:WorldEditorAPI.CreateEntityExt/7
// census:api:WorldEditorAPI.CreateEntityInWindowEx/6
// census:api:WorldEditorAPI.CreateEntityTemplate/2
// census:api:WorldEditorAPI.CreateObjectArrayVariableMember/5
// census:api:WorldEditorAPI.CreateSubsceneFolder/3
// census:api:WorldEditorAPI.CreateSubsceneLayer/3
// census:api:WorldEditorAPI.DeleteEntities/1
// census:api:WorldEditorAPI.DeleteEntity/1
// census:api:WorldEditorAPI.DeleteSubsceneFolder/2
// census:api:WorldEditorAPI.EndEntityAction/1
// census:api:WorldEditorAPI.EntityToSource/1
// census:api:WorldEditorAPI.FindEntityByName/1
// census:api:WorldEditorAPI.GetActiveSubsceneLayer/1
// census:api:WorldEditorAPI.GetCommentCategories/1
// census:api:WorldEditorAPI.GetCurrentEntityLayerId/0
// census:api:WorldEditorAPI.GetCurrentSubScene/0
// census:api:WorldEditorAPI.GetCurrentToolName/0
// census:api:WorldEditorAPI.GetEditorEntity/1
// census:api:WorldEditorAPI.GetEditorEntityCount/0
// census:api:WorldEditorAPI.GetEntityNiceName/1
// census:api:WorldEditorAPI.GetEntitySubsceneLayer/2
// census:api:WorldEditorAPI.GetEntityUnderCursor/0
// census:api:WorldEditorAPI.GetMousePosX/1
// census:api:WorldEditorAPI.GetMousePosY/1
// census:api:WorldEditorAPI.GetNumSubScenes/0
// census:api:WorldEditorAPI.GetScreenHeight/0
// census:api:WorldEditorAPI.GetScreenWidth/0
// census:api:WorldEditorAPI.GetSelectedEntitiesCount/0
// census:api:WorldEditorAPI.GetSelectedEntity/1
// census:api:WorldEditorAPI.GetSubsceneFolders/2
// census:api:WorldEditorAPI.GetSubsceneLayerId/2
// census:api:WorldEditorAPI.GetSubsceneLayerPath/2
// census:api:WorldEditorAPI.GetSurfaceMaterials/2
// census:api:WorldEditorAPI.GetTerrainResolutionX/1
// census:api:WorldEditorAPI.GetTerrainResolutionY/1
// census:api:WorldEditorAPI.GetTerrainSurfaceTile/4
// census:api:WorldEditorAPI.GetTerrainTilesX/1
// census:api:WorldEditorAPI.GetTerrainTilesY/1
// census:api:WorldEditorAPI.GetTerrainUnitScale/1
// census:api:WorldEditorAPI.GetWorld/0
// census:api:WorldEditorAPI.GetWorldPath/1
// census:api:WorldEditorAPI.IsCreatingEntityInWindow/0
// census:api:WorldEditorAPI.IsDoingEditAction/0
// census:api:WorldEditorAPI.IsEditMode/0
// census:api:WorldEditorAPI.IsEntityLayerLocked/2
// census:api:WorldEditorAPI.IsEntityLayerLockedHierarchy/2
// census:api:WorldEditorAPI.IsEntityLayerVisible/2
// census:api:WorldEditorAPI.IsEntitySelected/1
// census:api:WorldEditorAPI.IsEntitySelectedAsMain/1
// census:api:WorldEditorAPI.IsEntityVisible/1
// census:api:WorldEditorAPI.IsGameMode/0
// census:api:WorldEditorAPI.IsModifyingData/0
// census:api:WorldEditorAPI.IsPrefabEditMode/0
// census:api:WorldEditorAPI.IsSubsceneLayerVisible/2
// census:api:WorldEditorAPI.LockEntityLayer/2
// census:api:WorldEditorAPI.MoveCommentEntity/2
// census:api:WorldEditorAPI.MoveEntitiesToPrefab/4
// census:api:WorldEditorAPI.ParentEntities/3
// census:api:WorldEditorAPI.ParentEntity/3
// census:api:WorldEditorAPI.RemoveCommentEntity/1
// census:api:WorldEditorAPI.RemoveEntityFromParent/1
// census:api:WorldEditorAPI.RemoveFromEntitySelection/1
// census:api:WorldEditorAPI.RemoveObjectArrayVariableMember/4
// census:api:WorldEditorAPI.RenameEntity/2
// census:api:WorldEditorAPI.RenameSubsceneFolder/3
// census:api:WorldEditorAPI.SaveEntityTemplate/1
// census:api:WorldEditorAPI.SetActiveSubsceneLayer/2
// census:api:WorldEditorAPI.SetCamera/2
// census:api:WorldEditorAPI.SetEntitySelection/1
// census:api:WorldEditorAPI.SetEntitySubsceneLayer/3
// census:api:WorldEditorAPI.SetEntityVisible/3
// census:api:WorldEditorAPI.SetSubsceneFolderParent/3
// census:api:WorldEditorAPI.SetVariableValue/4
// census:api:WorldEditorAPI.SourceToEntity/1
// census:api:WorldEditorAPI.TraceWorldPos/7
// census:api:WorldEditorAPI.TryGetTerrainSurfaceY/3
// census:api:WorldEditorAPI.UndoOrRedoIsRestoring/0
// census:api:WorldEditorAPI.UnlockEntityLayer/2
// census:api:WorldEditorAPI.UpdateSelectionGui/0
// census:api:WorldEditorPlugin.OnGameModeEnded/0
// census:api:WorldEditorPlugin.OnGameModeStarted/5
// census:mcp:action/wb_container.arrayAdd
// census:mcp:action/wb_container.arrayRemove
// census:mcp:action/wb_container.clear
// census:mcp:action/wb_container.describe
// census:mcp:action/wb_container.get
// census:mcp:action/wb_container.save
// census:mcp:action/wb_container.set
// census:mcp:action/wb_container.setClass
// census:mcp:action/wb_entity.children
// census:mcp:action/wb_entity.clone
// census:mcp:action/wb_entity.create
// census:mcp:action/wb_entity.delete
// census:mcp:action/wb_entity.get
// census:mcp:action/wb_entity.list
// census:mcp:action/wb_entity.parent
// census:mcp:action/wb_entity.query
// census:mcp:action/wb_entity.rename
// census:mcp:action/wb_entity.setLayer
// census:mcp:action/wb_entity.transform
// census:mcp:action/wb_entity.unparent
// census:mcp:action/wb_layers.create
// census:mcp:action/wb_layers.createFolder
// census:mcp:action/wb_layers.delete
// census:mcp:action/wb_layers.getActive
// census:mcp:action/wb_layers.getInfo
// census:mcp:action/wb_layers.isVisible
// census:mcp:action/wb_layers.list
// census:mcp:action/wb_layers.lock
// census:mcp:action/wb_layers.move
// census:mcp:action/wb_layers.rename
// census:mcp:action/wb_layers.setActive
// census:mcp:action/wb_layers.tree
// census:mcp:action/wb_layers.unlock
// census:mcp:action/wb_prefabs.addMembers
// census:mcp:action/wb_prefabs.clone
// census:mcp:action/wb_prefabs.createChild
// census:mcp:action/wb_prefabs.createTemplate
// census:mcp:action/wb_prefabs.editState
// census:mcp:action/wb_prefabs.getAncestor
// census:mcp:action/wb_prefabs.moveToPrefab
// census:mcp:action/wb_prefabs.save
// census:mcp:action/wb_terrain.getBounds
// census:mcp:action/wb_terrain.getHeight
// census:mcp:action/wb_terrain.heights
// census:mcp:action/wb_terrain.info
// census:mcp:action/wb_terrain.tile
// census:mcp:action/wb_view.camera
// census:mcp:action/wb_view.focus
// census:mcp:action/wb_view.placeAtPixel
// census:mcp:action/wb_view.select
// census:mcp:action/wb_view.selection
// census:mcp:action/wb_view.setCamera
// census:mcp:action/wb_view.setVisible
// census:mcp:action/wb_view.trace
// census:mcp:action/wb_view.underCursor
// census:mcp:action/wb_world.addComment
// census:mcp:action/wb_world.annotate
// census:mcp:action/wb_world.browserSelection
// census:mcp:action/wb_world.comments
// census:mcp:action/wb_world.play
// census:mcp:action/wb_world.playEvents
// census:mcp:action/wb_world.register
// census:mcp:action/wb_world.state
// census:mcp:action/wb_world.stop
// census:mcp:handler-action/EMCP_WB_Container.arrayAdd
// census:mcp:handler-action/EMCP_WB_Container.arrayRemove
// census:mcp:handler-action/EMCP_WB_Container.clear
// census:mcp:handler-action/EMCP_WB_Container.describe
// census:mcp:handler-action/EMCP_WB_Container.get
// census:mcp:handler-action/EMCP_WB_Container.save
// census:mcp:handler-action/EMCP_WB_Container.set
// census:mcp:handler-action/EMCP_WB_Container.setClass
// census:mcp:handler-action/EMCP_WB_Entity.children
// census:mcp:handler-action/EMCP_WB_Entity.clone
// census:mcp:handler-action/EMCP_WB_Entity.create
// census:mcp:handler-action/EMCP_WB_Entity.delete
// census:mcp:handler-action/EMCP_WB_Entity.get
// census:mcp:handler-action/EMCP_WB_Entity.list
// census:mcp:handler-action/EMCP_WB_Entity.parent
// census:mcp:handler-action/EMCP_WB_Entity.query
// census:mcp:handler-action/EMCP_WB_Entity.rename
// census:mcp:handler-action/EMCP_WB_Entity.setLayer
// census:mcp:handler-action/EMCP_WB_Entity.transform
// census:mcp:handler-action/EMCP_WB_Entity.unparent
// census:mcp:handler-action/EMCP_WB_Layers.create
// census:mcp:handler-action/EMCP_WB_Layers.createFolder
// census:mcp:handler-action/EMCP_WB_Layers.delete
// census:mcp:handler-action/EMCP_WB_Layers.list
// census:mcp:handler-action/EMCP_WB_Layers.lock
// census:mcp:handler-action/EMCP_WB_Layers.move
// census:mcp:handler-action/EMCP_WB_Layers.rename
// census:mcp:handler-action/EMCP_WB_Layers.setActive
// census:mcp:handler-action/EMCP_WB_Layers.tree
// census:mcp:handler-action/EMCP_WB_Layers.unlock
// census:mcp:handler-action/EMCP_WB_Prefabs.addMembers
// census:mcp:handler-action/EMCP_WB_Prefabs.clone
// census:mcp:handler-action/EMCP_WB_Prefabs.createChild
// census:mcp:handler-action/EMCP_WB_Prefabs.createTemplate
// census:mcp:handler-action/EMCP_WB_Prefabs.editState
// census:mcp:handler-action/EMCP_WB_Prefabs.getAncestor
// census:mcp:handler-action/EMCP_WB_Prefabs.moveToPrefab
// census:mcp:handler-action/EMCP_WB_Prefabs.save
// census:mcp:handler-action/EMCP_WB_Terrain.heights
// census:mcp:handler-action/EMCP_WB_Terrain.info
// census:mcp:handler-action/EMCP_WB_Terrain.tile
// census:mcp:handler-action/EMCP_WB_View.camera
// census:mcp:handler-action/EMCP_WB_View.focus
// census:mcp:handler-action/EMCP_WB_View.placeAtPixel
// census:mcp:handler-action/EMCP_WB_View.select
// census:mcp:handler-action/EMCP_WB_View.selection
// census:mcp:handler-action/EMCP_WB_View.setCamera
// census:mcp:handler-action/EMCP_WB_View.setVisible
// census:mcp:handler-action/EMCP_WB_View.trace
// census:mcp:handler-action/EMCP_WB_View.underCursor
// census:mcp:handler-action/EMCP_WB_World.addComment
// census:mcp:handler-action/EMCP_WB_World.annotate
// census:mcp:handler-action/EMCP_WB_World.browserSelection
// census:mcp:handler-action/EMCP_WB_World.comments
// census:mcp:handler-action/EMCP_WB_World.play
// census:mcp:handler-action/EMCP_WB_World.playEvents
// census:mcp:handler-action/EMCP_WB_World.register
// census:mcp:handler-action/EMCP_WB_World.state
// census:mcp:handler-action/EMCP_WB_World.stop
// census:ui:WorldEditor/context-item/Hierarchy/default/Lock
// census:ui:WorldEditor/context-item/Hierarchy/default/Rename
// census:ui:WorldEditor/context-item/Hierarchy/default/Set as active
// census:ui:WorldEditor/context-item/Hierarchy/entity/Apply Changes to Prefab
// census:ui:WorldEditor/context-item/Hierarchy/entity/Focus Selection
// census:ui:WorldEditor/context-item/Hierarchy/entity/Hide%2FShow
// census:ui:WorldEditor/context-item/Hierarchy/entity/Remove from Parent
// census:ui:WorldEditor/context-item/Hierarchy/entity/Rename
// census:ui:WorldEditor/context-item/Hierarchy/entity/Set Layer
// census:ui:WorldEditor/context-item/Hierarchy/entity/Set Parent
// census:ui:WorldEditor/context-item/Hierarchy/world/Create folder
// census:ui:WorldEditor/context-item/Hierarchy/world/Create layer
// census:ui:WorldEditor/context-item/Viewport/Apply Changes to Prefab
// census:ui:WorldEditor/context-item/Viewport/Focus Selection
// census:ui:WorldEditor/context-item/Viewport/Hide%2FShow
// census:ui:WorldEditor/context-item/Viewport/Remove from Parent
// census:ui:WorldEditor/context-item/Viewport/Rename
// census:ui:WorldEditor/context-item/Viewport/Set Layer
// census:ui:WorldEditor/context-item/Viewport/Set Parent
// census:ui:WorldEditor/menu-item/Entities/Add Child Prefab/To Prefab
// census:ui:WorldEditor/menu-item/Entities/Add Child Prefab/To World
// census:ui:WorldEditor/menu-item/Entities/Apply Changes to Prefab
// census:ui:WorldEditor/menu-item/Entities/Delete/From World Delete
// census:ui:WorldEditor/menu-item/Entities/Focus Selection
// census:ui:WorldEditor/menu-item/Entities/Hide%2FShow
// census:ui:WorldEditor/menu-item/Entities/Remove from Parent
// census:ui:WorldEditor/menu-item/Entities/Rename
// census:ui:WorldEditor/menu-item/Entities/Set Layer
// census:ui:WorldEditor/menu-item/Entities/Set Parent
// census:ui:WorldEditor/menu-item/Game/Play Game
