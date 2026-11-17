/**
 * Wave W9 (menu toggles), the live battery (docs/v2/inbox/phase6/menu-battery-plan.md, DEC-091
 * bookkeeping 2, DEC-092). Built in the form of tests/live/w6.live.ts and tests/live/w8.live.ts: the
 * same CLI, the same evidence, the same stop rules, the window watch with W8's busy grace
 * (WATCH_OPTIONS), and no hand step.
 *
 * DEC-092 put the 113 safe-toggle menu rows of the plan (Window and View items whose second run
 * restores the first state) on policy `execute_action.allow_list` and the compiled
 * EMCP_WB_ActionAllowList.c; DEC-100 narrowed that list to the paths with a passing live result (the
 * ones runs 1 to 3 of this battery toggled and restored) and moved the rest to
 * `execute_action.candidates`, which no shipped tool reads. By default this battery is the
 * REGRESSION run of the proven rows: a row whose path is a candidate is recorded NOT-RUN and never
 * sent. With `--candidates` (DEC-100's sitting-local override) a candidate row with a read is driven
 * through the read-only probe pack instead (ECEN_Probe executeAction with candidate: true; the pack
 * compiles the candidates, the shipped handlers do not), so the sitting installs that pack and the
 * gate checks that it answers on the 2.0 sandbox. This battery drives each row it can read back, U9's pattern
 * (w8-40, S-D U9): read the state, run the item, read and require a change, run it again, read and
 * require the first state. The read is the row's dock or tool bar in the module window, through
 * `wb_gui find` (UI Automation, in process): a census dock or tool-bar row of the same module whose
 * label (or object name) is the menu item's label, or a READ_HINTS pairing by object name. A row
 * with no such read is recorded NOT-READ with its reason and never run (Go to, Layout and tab
 * items, radio groups, the World Editor's view toggles, full screen). No toggle row has a
 * `wb_module info` read: info answers containers and the document path only. The World Editor's
 * rows run through `wb_menu run` (EMCP_WB_ExecuteAction), the other modules' through
 * `wb_module action` (EMCP_WB_Module, WBModuleDef.ExecuteAction).
 *
 * A row whose dock reads closed at the first read is NOT-RUN unless `--show-closed`: showing a dock
 * that is not in the layout may float it as an owned window, which the window watch hands off.
 * Every read after a run polls (SETTLE_MS apart, at most SETTLE_POLLS reads and SETTLE_BUDGET_MS)
 * until it reads the state it waits for (fix-up 1, docs/v2/inbox/w9/fixup-1.md). A first run that
 * changes nothing is followed by one more (a run absorbed: the menu item's checked state out of
 * step with its dock, W9 run 1's AnimEditor and BehaviorEditor rows); a row whose first run was
 * absorbed PASSes only on a clean confirm round after its restore. A row that does not come back to
 * its first state is a FAIL: it is run again (the restore) at most twice; the module goes on to
 * its next row, and stops only when both restore runs leave the row away from its first state.
 * A `Window > Go to... > Show X` row in SHOW_PAIRS is driven as a pair with its dock's own toggle:
 * hide the dock by the toggle, show it by the Go to item. The Animation Editor's pairs answered
 * false by the menu-run route in run 3 (ROUTE_ANSWERED_FALSE, probe P-W9-01, DEC-097): they are
 * recorded each run with that reason and never sent. Each
 * row that completes writes a live result naming its census row id
 * (`<sitting>/w9-live-<step>.jsonl`, promote.ts --batch lines; the step's evidence id filled in by
 * the runner), so promote.ts can raise it.
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch ini `<sitting>/scratch.ini` with `-scriptAuthorizeAll` (DEC-053 ruling 2), the shipped
 * bundle installed, no probe pack (with --candidates also the read-only probe pack: launch.ts
 * --install-handlers <sandbox> --probe-pack mod-dev/probe). This script never launches and never takes the lease (the lane
 * given with --id holds it). The tools run IN PROCESS over a `WorkbenchClient` WITHOUT a Config:
 * `runModule`, `runWorld`, and `wb_menu` and `wb_gui` through their register functions
 * (`ENFUSION_GUI=1` for this process only).
 *
 * Toggles do not dirty a world: a dock or tool bar shown or hidden is window state, not world data,
 * and no driven row is a world edit. The battery never saves, never reopens or closes the world: the
 * closable step leaves the throwaway world as it is, so the post-flight's close raises no save
 * prompt; if one is raised, the main session answers it No by hand (handAnswer). The World Editor's
 * View toggles that could touch more than window state (visualizers, world bounds) are NOT-READ and
 * never run.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan (every driven path against the allow-list), the battery's own
 * plan check and the queue with preflight's validateQueue; `--out` writes the plan, `--outline` the
 * outline, `--emit-queue` the queue (docs/v2/sessions/queues/W9-queue.json; a test keeps the two
 * equal). The runbook is docs/v2/sessions/queues/W9.md.
 *
 * Usage:
 *   npx --no tsx tests/live/w9.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w9.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w9.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--show-closed] [--candidates] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w9.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
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
import { registerWbMenu } from "../../src/tools/wb-menu.js";
import { WB_GUI_ENV, registerWbGui } from "../../src/tools/wb-gui.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runView } from "../../src/tools/wb-view.js";
import { runScriptEditor } from "../../src/tools/wb-script-editor.js";
import { readCurrentBuild } from "../../src/gui/locators.js";
import {
  DEFAULT_CENSUS_ROOT,
  censusPaths,
  ledgerMissing,
  loadLedger,
} from "../../src/census/ledger-io.js";
import type { Row } from "../../src/census/schemas.js";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { UPDATE_BASELINE_FLAG, applyBaselineGuard } from "./baseline.js";
import { checkPlan, formatResult, pathOf, type PlanAction } from "../../scripts/live/dry-run.js";
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
import {
  EDITOR_CLASS,
  MODULE_WINDOWS,
  WATCH_OPTIONS,
  WORKBENCH_WINDOWS,
  carriesForceSettings,
  captureServer,
  responseOf,
} from "./w8.live.js";

export { EXIT, StopBattery, recordPath };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W9";
export const SCRIPT_PATH = "tests/live/w9.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W9.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W9-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const NOISE_REL = "docs/v2/sessions/queues/w9-noise.json";
/** The menu battery plan: one line per menu row with its class (DEC-091 bookkeeping 2). */
export const PLAN_REL = "docs/v2/inbox/phase6/bk3/bk3-menu-plan.jsonl";

export const GATE_STEP = "w9-00-gate";
export const WORLD_STEP = "w9-01-world";
export const NETZERO_STEP = "w9-95-netzero";
export const CLOSABLE_STEP = "w9-99-closable";

/** The scratch ini of the sitting (train9.sh: scratch-ini.ts --out "$S/scratch.ini"). */
export const SCRATCH_INI = "scratch.ini";
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
/** The launch argv the two-pass pre-flight builds (the lane owns the lease, so it launches). */
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  GPROJ,
  "-forceSettings",
  `<sitting>/${SCRATCH_INI}`,
  "-scriptAuthorizeAll",
];

/** Every project file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W9_ROOT = `${THROWAWAY}/W9`;
export const WORLDS_DIR = `${W9_ROOT}/worlds`;
export const WORLD = `${WORLDS_DIR}/EMCP_W9_Tiny.ent`;
/** `plant` makes these folders (offline, Workbench closed); `rollback` removes _throwaway/W9/. */
export const PLANT_DIRS: readonly string[] = [W9_ROOT, WORLDS_DIR];
export const PLANT_FILE = "plant-w9.json";
export const RESULT_FILE = "w9-result.json";
export const BATTERY_SNAPSHOT_FILE = "w9-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w9-battery-snapshot";
/** Files whose change outside _throwaway/W9/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];

export const TIMEOUTS = {
  /** Per driven row: up to seven polled reads and five runs. */
  row: 90_000,
  open: 600_000,
  poll: 5_000,
  ping: 10_000,
} as const;
/** The wait before each poll of a read after a run (the dock is shown or hidden on a later event loop). */
export const SETTLE_MS = 500;
/** A read after a run polls at most this many times... */
export const SETTLE_POLLS = 8;
/** ...and stops polling once this much time has passed since its first poll (one read at least). */
export const SETTLE_BUDGET_MS = 5_000;
/** Restore runs of a row not back to its first state before the module stops. */
export const RESTORE_RUNS = 2;
/** Hits a dock read asks wb_gui find for. */
export const FIND_LIMIT = 200;

/** The modules of the plan's safe-toggle rows, in the battery's order (one step each). */
export const MODULES = [
  "WorldEditor",
  "ResourceManager",
  "ScriptEditor",
  "AnimEditor",
  "AudioEditor",
  "BehaviorEditor",
  "ProcAnimEditor",
  "LocalizationEditor",
] as const;
export type ModuleName = (typeof MODULES)[number];

/** The step id of a module's toggle step. */
export function moduleStepId(module: ModuleName): string {
  return `w9-${10 + MODULES.indexOf(module)}-${module.toLowerCase()}`;
}

/**
 * Menu items whose dock or tool bar the census names by object name only (no label, or a label
 * that is not the menu's): the pairing is read from the object name, so it is an inference the
 * first sitting confirms (the row's evidence says `inferred`).
 */
export const READ_HINTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  WorldEditor: {
    "Basic Tools": "toolbarBasicTools",
    "Scripted Tools": "toolbarScriptedTools",
    "Cinematic Timeline": "cinematicsDock",
    "Current Tool": "currentToolDock",
    "Main Toolbar": "toolBar",
    "Ragdoll Editor": "ragdollEditDock",
    "Resource Browser 2": "resourcesDock2",
  },
  ResourceManager: { "Resource Browser 2": "resourceBrowserDock2" },
  AudioEditor: { Playlist: "playlistDockWidget" },
};

/**
 * `Window > Go to... > Show X` items (show and raise a dock, not a toggle) paired with the dock they
 * show, by label: driven as hide by the dock's own `Window > <dock>` toggle, then show by the Go to
 * item, so the item's run is read as a change and is its own restore. An inference by label the
 * first sitting confirms (the row's evidence says `inferred`).
 */
export const SHOW_PAIRS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AnimEditor: {
    "Show Anim Sets": "Animation Sets",
    "Show Controls": "Controls",
    "Show Debug Controls": "Debug Controls",
    "Show Errors": "Errors",
    "Show Graph Window": "Graph",
    "Show Properties": "Properties",
    "Show Workspace": "Workspace",
  },
};

/**
 * Rows the menu-run route has answered false on the census build (probe P-W9-01, EV-W9-044):
 * recorded each run with the reason and the remaining route, never sent. Checked first, so the
 * Anim Editor's SHOW_PAIRS rows leave the run set (DEC-097) and W9 can end green. The pairing in
 * SHOW_PAIRS stays: the wb_gui route reads the same dock.
 */
export const ROUTE_FALSE_PROBE = "P-W9-01";
const GOTO_FALSE =
  "answered false by the menu-run route on 1.9.0.37 (W9 run 3, EV-W9-033: the dock hidden by its toggle, the Go to item sent, ExecuteAction returned false; EV-W9-044); remaining route wb_gui invoke with a 1.9.0.37 locator (probe P-W9-01); not sent";
const GOTO_FAMILY_FALSE =
  "never driven (its dock was closed at the first read in W9 runs 2 and 3); its Go to family answered false by the menu-run route on 1.9.0.37 (EV-W9-044); remaining route wb_gui invoke with a 1.9.0.37 locator (probe P-W9-01); not sent";
export const ROUTE_ANSWERED_FALSE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AnimEditor: {
    "Show Anim Sets": GOTO_FALSE,
    "Show Controls": GOTO_FALSE,
    "Show Debug Controls": GOTO_FAMILY_FALSE,
    "Show Errors": GOTO_FALSE,
    "Show Graph Window": GOTO_FALSE,
    "Show Properties": GOTO_FALSE,
    "Show Workspace": GOTO_FALSE,
  },
};

/**
 * DEC-100: the probe pack's API, the one route a candidate row runs by (`executeAction` with
 * `candidate: true`, under `--candidates` only). The read-only probe pack is development-only and
 * refuses every project but the 2.0 sandbox; no shipped tool sends to it.
 */
export const CANDIDATE_API = "ECEN_Probe";
/** Why a candidate row is not run in the regression run (the default). */
export const CANDIDATE_HELD =
  "a DEC-100 candidate (policy execute_action.candidates: no live result yet): no shipped tool runs it; driven only under --candidates, through the probe pack's candidate override";

/** The plan options: `candidates` plans the candidate rows too (DEC-100's override). */
export interface BuildOptions {
  candidates?: boolean;
}

let menuListsCache: { allow: Set<string>; candidates: Set<string> } | null = null;
/** The policy's proven and candidate menu paths as segments joined by "\n" (cached per process). */
export function menuLists(policy?: CensusPolicy): { allow: Set<string>; candidates: Set<string> } {
  if (!policy && menuListsCache) return menuListsCache;
  const p = policy ?? loadPolicy();
  const keys = (l: Array<string | string[]> | undefined): Set<string> =>
    new Set((l ?? []).map((e) => pathOf(e).join("\n")));
  const out = {
    allow: keys(p.execute_action?.allow_list),
    candidates: keys(p.execute_action?.candidates),
  };
  if (!policy) menuListsCache = out;
  return out;
}

/** True when a path is on `execute_action.candidates` (DEC-100): no shipped tool runs it. */
export function isCandidatePath(segments: readonly string[], policy?: CensusPolicy): boolean {
  return menuLists(policy).candidates.has(segments.join("\n"));
}

/** Whether a row's runs go into the plan: a candidate's only with `candidates`. */
function runnable(segments: readonly string[], o: BuildOptions): boolean {
  return o.candidates === true || !isCandidatePath(segments);
}

/**
 * Safe-toggle rows that are not toggles, or whose state has no read: recorded NOT-READ with the
 * reason and never run. Checked before the dock match.
 */
export const NOT_READ_RULES: ReadonlyArray<{ re: RegExp; why: string }> = [
  {
    re: /^Window > Go to\.\.\. > /,
    why: "shows and raises a dock: a second run does not hide it, so the run is not its own undo",
  },
  {
    re: /^Window > Layout > /,
    why: "applies a saved layout: not a toggle, a second run does not bring the arrangement before it back",
  },
  {
    re: /^Window > Manage Layouts$/,
    why: "opens the layout manager (a window of its own, no trailing ellipsis): not a toggle",
  },
  {
    re: /^Window > (Cycle Tabs|Next Tab|Prev Tab|Previous Tab|Reopen Closed Tab|Switch Active View|Navigate To File)$/,
    why: "moves between documents, tabs or views: not a toggle, and no read of the position",
  },
  {
    re: /^View > (Hex View > .+|Normal view|Text view|Transformation Gizmo > .+)$/,
    why: "selects one mode of a radio group: a second run keeps that mode; no read of the mode",
  },
  { re: /^View > Cycle Prefab Library$/, why: "cycles: a second run does not restore" },
  {
    re: /^View > (Permanent Entity Visualizers|Toggle Visualizers|World Bounds)$/,
    why: "a view toggle whose checked state lives in the closed View menu: no wb_gui or wb_module read of it on 1.9.0.37",
  },
  {
    re: /Toggle Fullscreen Mode/,
    why: "full screen changes the window state: no read of it here, and the screen is the owner's",
  },
];

/** Steps of blocks that are independent proofs (the FAIL counter is per step there). */
export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W9.1", "W9.2"]);
export function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? `${s.block}/${s.id}` : s.block;
}

/** Client codes that stop the battery. */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);

/** Actions no step exercises (none: every tool action the plan names is sent). */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {};

// ── Types ────────────────────────────────────────────────────────────────────

export type W9Tool =
  | "wb_menu"
  | "wb_module"
  | "wb_gui"
  | "wb_world"
  | "wb_view"
  | "wb_script_editor"
  /** DEC-100: ECEN_Probe of the read-only probe pack, sent under --candidates only. */
  | "probe";
export type Block = "W9.0" | "W9.1" | "W9.2" | "W9.9";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED";

/** What a dock read looks for: the census dock or tool-bar row, its object name and its title. */
export interface ReadTarget {
  rowId: string;
  kind: string;
  objectName: string | null;
  title: string | null;
  automationId: string | null;
  /** Paired by READ_HINTS, not by label. */
  inferred: boolean;
}

/** One safe-toggle row of the plan, with its read (or why it has none). */
export interface ToggleRow {
  id: string;
  module: ModuleName;
  path: string;
  segments: string[];
  route: "wb_menu.run" | "wb_module.action";
  read: ReadTarget | null;
  notRead: string | null;
  /** A show row (SHOW_PAIRS): the dock's own toggle row, run to hide the dock before the show. */
  hideWith?: { id: string; path: string; segments: string[] } | null;
  /** The probe that recorded the menu-run route answering false (ROUTE_ANSWERED_FALSE); not sent. */
  routeFalse?: string | null;
  /** DEC-100: the path is on execute_action.candidates (no live result yet). */
  candidate?: boolean;
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

export interface StepOutcome {
  status: Verdict;
  detail: string;
  evidence: Record<string, unknown>;
  /** promote.ts --batch lines the runner writes to a sitting file, the step's evidence id filled in. */
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

export interface W9Deps {
  /** One shipped TS tool, run in process against a client WITHOUT a Config. */
  tool: (name: W9Tool, args: Raw) => Promise<ToolResponse>;
  info: () => Promise<Raw | null>;
  ping: () => Promise<Raw | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  /** The command line of a process (the gate's -forceSettings check). */
  commandLine: (pid: number) => Promise<string | null>;
  /** The plan's safe-toggle rows with their reads (offline: the plan file and the ledger). */
  toggleRows: () => ToggleRow[];
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W9Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** Also drive rows whose dock reads closed at the first read (may float a window). */
  showClosed?: boolean;
  /** DEC-100: also drive candidate rows, through the probe pack's candidate override. */
  candidates?: boolean;
}

export interface StepContext {
  deps: W9Deps;
  opts: W9Options;
  calls: Array<Record<string, unknown>>;
  tool: (name: W9Tool, args: Raw, o?: { tolerate?: boolean }) => Promise<ToolResponse>;
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
  /** Project-relative files or folders this step may create or change. */
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

function readJson<T>(path: string, deps: Pick<W9Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W9Deps, "writeBytes">): void {
  deps.writeBytes(path, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8"));
}

/** A step's verdict from its checks: any failed check FAIL, else PASS. */
export function verdictOf(
  fails: string[],
  passDetail: string,
): Pick<StepOutcome, "status" | "detail"> {
  return fails.length
    ? { status: "FAIL", detail: fails.join("; ") }
    : { status: "PASS", detail: passDetail };
}

/** "ok" for an answer, else its refusal code. */
export function answerOf(r: ToolResponse | null): string {
  if (!r) return "not sent";
  return r.ok ? "ok" : S(r.code) || "error";
}

const eqi = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// ── The toggle rows (offline, deterministic over the repo's data) ────────────

interface PlanLine {
  id: string;
  module: string;
  path: string;
  cls: string;
  route: string | null;
}

/** The plan's safe-toggle lines. */
export function planToggleLines(text: string): PlanLine[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PlanLine)
    .filter((l) => l.cls === "safe-toggle");
}

type DockRow = Pick<Row, "id" | "kind" | "module" | "status"> & {
  label?: string;
  object_name?: string;
  locator?: { automationId?: string };
};

function targetOf(r: DockRow, inferred: boolean): ReadTarget {
  return {
    rowId: r.id,
    kind: r.kind,
    objectName: r.object_name ?? null,
    title: r.label ?? (r.locator?.automationId ? null : (r.object_name ?? null)),
    automationId: r.locator?.automationId ?? null,
    inferred,
  };
}

/**
 * Each safe-toggle line with its read: a NOT_READ_RULES reason first; else a READ_HINTS pairing
 * by object name; else a census dock or tool-bar row of the module whose label (or, with no label,
 * object name) is the menu item's label; else NOT-READ.
 */
export function classifyToggles(lines: PlanLine[], ledgerRows: readonly DockRow[]): ToggleRow[] {
  const docks = ledgerRows.filter(
    (r) => (r.kind === "dock" || r.kind === "toolbar") && r.status === "active",
  );
  const out: ToggleRow[] = [];
  for (const l of lines) {
    if (!(MODULES as readonly string[]).includes(l.module)) continue;
    const module = l.module as ModuleName;
    const segments = l.path.split(" > ");
    const label = segments[segments.length - 1]!;
    const base = {
      id: l.id,
      module,
      path: l.path,
      segments,
      route: (module === "WorldEditor" ? "wb_menu.run" : "wb_module.action") as ToggleRow["route"],
      candidate: isCandidatePath(segments),
    };
    const mine = docks.filter((r) => r.module === module);
    const answeredFalse = ROUTE_ANSWERED_FALSE[module]?.[label];
    if (answeredFalse) {
      out.push({ ...base, read: null, notRead: answeredFalse, routeFalse: ROUTE_FALSE_PROBE });
      continue;
    }
    const pair = SHOW_PAIRS[module]?.[label];
    if (pair) {
      const hidePath = `Window > ${pair}`;
      const toggle = lines.find((x) => x.module === module && x.path === hidePath);
      const hits = mine.filter((r) => eqi(r.label ?? r.object_name, pair));
      const r = hits.find((x) => x.locator?.automationId) ?? hits[0];
      if (toggle && r) {
        out.push({
          ...base,
          read: targetOf(r, true),
          notRead: null,
          hideWith: { id: toggle.id, path: toggle.path, segments: toggle.path.split(" > ") },
        });
        continue;
      }
    }
    const rule = NOT_READ_RULES.find((x) => x.re.test(l.path));
    if (rule) {
      out.push({ ...base, read: null, notRead: rule.why });
      continue;
    }
    const hint = READ_HINTS[module]?.[label];
    if (hint) {
      const r = mine.find((x) => x.object_name === hint);
      out.push(
        r
          ? { ...base, read: targetOf(r, true), notRead: null }
          : {
              ...base,
              read: null,
              notRead: `READ_HINTS names object ${hint}, which no active census row of ${module} carries`,
            },
      );
      continue;
    }
    const hits = mine.filter((r) => eqi(r.label ?? r.object_name, label));
    const r = hits.find((x) => x.locator?.automationId) ?? hits[0];
    out.push(
      r
        ? { ...base, read: targetOf(r, false), notRead: null }
        : {
            ...base,
            read: null,
            notRead: `no active census dock or tool-bar row of ${module} is labelled '${label}'`,
          },
    );
  }
  return out;
}

let rowsCache: ToggleRow[] | null = null;
/** The toggle rows from the repo's plan file and ledger (cached for the process). */
export function loadToggleRows(): ToggleRow[] {
  if (rowsCache) return rowsCache;
  const lines = planToggleLines(readFileSync(join(REPO_ROOT, ...PLAN_REL.split("/")), "utf-8"));
  const paths = censusPaths(DEFAULT_CENSUS_ROOT);
  const rows = ledgerMissing(paths) ? [] : (loadLedger(paths).rows as unknown as DockRow[]);
  rowsCache = classifyToggles(lines, rows);
  return rowsCache;
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The route each tool's plan entry names. */
export const ROUTE_OF: Readonly<Record<W9Tool, string>> = {
  wb_menu: "EMCP_WB_ExecuteAction",
  wb_module: "EMCP_WB_Module",
  wb_gui: "UIA wb_gui (in process; no NET call)",
  wb_world: "EMCP_WB_World",
  wb_view: "EMCP_WB_View",
  wb_script_editor: "EMCP_WB_ScriptEditor",
  probe: CANDIDATE_API,
};

export function tc(
  tool: W9Tool,
  action: string,
  params: Raw = {},
  extra: { note?: string; target?: string } = {},
): PlanAction {
  return {
    kind: "net-call",
    target: extra.target ?? ROUTE_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: action,
    note: extra.note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

/** One dock read: wb_gui find in the module window (no pattern call, nothing acts). */
export function readPlan(row: ToggleRow, note: string): PlanAction {
  return tc(
    "wb_gui",
    "find",
    {
      windowTitle: MODULE_WINDOWS[row.module],
      className: EDITOR_CLASS,
      query: row.read?.title ?? row.read?.objectName ?? "",
      limit: FIND_LIMIT,
    },
    { note },
  );
}

/**
 * One run of a row: wb_menu run reaches EMCP_WB_ExecuteAction with the path as segments (checkPlan
 * checks it); wb_module action is its net-call plus the execute-action entry checkPlan checks.
 */
export function runPlan(row: ToggleRow, note: string): PlanAction[] {
  if (isCandidatePath(row.segments)) return candidatePlan(row, note);
  if (row.route === "wb_menu.run")
    return [
      {
        kind: "net-call",
        target: ROUTE_OF.wb_menu,
        params: { action: "run", module: row.module, menuPath: [...row.segments], confirm: true },
        tool: "wb_menu",
        toolAction: "run",
        note,
      } as PlanAction,
    ];
  return [
    // wb_module action now dry-runs any item that is not safe unless confirm
    // is true (phase-7 audit live-tools-b-1); this battery means the press.
    tc(
      "wb_module",
      "action",
      { module: row.module, menuPath: [...row.segments], confirm: true },
      { note },
    ),
    {
      kind: "execute-action",
      target: { path: [...row.segments], module: row.module },
      via: "EMCP_WB_Module {action: action}",
    } as PlanAction,
  ];
}

/**
 * DEC-100: one run of a candidate row, planned only under --candidates: the probe pack's
 * executeAction with candidate: true (its net-call) plus the execute-action entry checkPlan checks
 * against execute_action.candidates.
 */
export function candidatePlan(
  row: Pick<ToggleRow, "module" | "segments">,
  note: string,
): PlanAction[] {
  return [
    tc(
      "probe",
      "executeAction",
      { moduleName: row.module, menuPath: [...row.segments], keepFocus: true, candidate: true },
      { note: `${note} (a DEC-100 candidate, --candidates only)` },
    ),
    {
      kind: "execute-action",
      target: { path: [...row.segments], module: row.module },
      candidate: true,
      via: `${CANDIDATE_API} {action: executeAction, candidate: true}`,
    } as PlanAction,
  ];
}

/** The wb_view actions the view block sends (reads, the selection and the camera; DEC-095). */
export const VIEW_ACTIONS_ALLOWED: ReadonlySet<string> = new Set([
  "selection",
  "select",
  "camera",
  "setCamera",
]);

/** Tool actions that write a file (the harness test checks their paths). */
export const FILE_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  "wb_world.new",
  "wb_world.register",
]);

/**
 * The battery's own gate over the plan, beside checkPlan: nothing saves, closes or reopens a world
 * past the first open; every run names a safe-toggle path; wb_gui only reads (find).
 */
export function w9PlanViolations(
  plan: PlanAction[],
  rows: ToggleRow[],
  o: BuildOptions = {},
): string[] {
  const toggles = new Set(rows.map((r) => `${r.module}\u0000${r.segments.join("\n")}`));
  // DEC-095: the view rows with a read, and their counterparts (themselves view rows).
  for (const r of VIEW_ROWS.filter((x) => x.read))
    toggles.add(`${r.module}\u0000${r.segments.join("\n")}`);
  const out: string[] = [];
  plan.forEach((a, i) => {
    const p = (a.params ?? {}) as Raw;
    const where = `action ${i} (${S(a.step)} ${S(a.tool ?? a.kind)}.${S(a.toolAction)})`;
    if (a.kind === "net-call" && (p.action === "save" || /save/i.test(S(a.toolAction))))
      out.push(`${where}: a save is never planned`);
    if (a.tool === "wb_module" && ["close", "save"].includes(S(a.toolAction)))
      out.push(`${where}: a module close or save is never planned`);
    if (a.tool === "wb_gui" && S(a.toolAction) !== "find")
      out.push(`${where}: wb_gui only reads (find)`);
    if (a.tool === "wb_view" && !VIEW_ACTIONS_ALLOWED.has(S(a.toolAction)))
      out.push(`${where}: wb_view only reads and sets the selection and the camera`);
    if (a.tool === "wb_script_editor" && S(a.toolAction) !== "state")
      out.push(`${where}: wb_script_editor only reads (state)`);
    if (
      a.tool === "wb_view" &&
      a.toolAction === "select" &&
      S(p.mode) !== "set" &&
      S(p.mode) !== "clear"
    )
      out.push(`${where}: wb_view select only sets or clears the selection`);
    if (
      (a.tool === "wb_menu" && a.toolAction === "run") ||
      (a.tool === "wb_module" && a.toolAction === "action")
    ) {
      const segs = Array.isArray(p.menuPath) ? (p.menuPath as unknown[]).map(String) : [];
      if (!toggles.has(`${S(p.module)}\u0000${segs.join("\n")}`))
        out.push(`${where}: ${segs.join(" > ")} is not a safe-toggle row of ${S(p.module)}`);
      if (isCandidatePath(segs))
        out.push(`${where}: ${segs.join(" > ")} is a DEC-100 candidate; no shipped tool runs it`);
    }
    if (a.tool === "probe" || a.target === CANDIDATE_API) {
      const segs = Array.isArray(p.menuPath) ? (p.menuPath as unknown[]).map(String) : [];
      if (!o.candidates) out.push(`${where}: the probe pack is sent to only under --candidates`);
      else if (S(a.toolAction) === "executeAction") {
        if (p.candidate !== true) out.push(`${where}: a probe executeAction always says candidate`);
        if (!isCandidatePath(segs))
          out.push(`${where}: ${segs.join(" > ")} is not on execute_action.candidates`);
        if (!toggles.has(`${S(p.moduleName)}\u0000${segs.join("\n")}`))
          out.push(`${where}: ${segs.join(" > ")} is not a W9 row of ${S(p.moduleName)}`);
      } else if (S(a.toolAction) !== "info")
        out.push(`${where}: the probe pack is sent info and executeAction only`);
    }
  });
  return out;
}

// ── World and module helpers ─────────────────────────────────────────────────

async function openWorld(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; evidence: Raw; worldPath: string }> {
  if (rel.startsWith(`${THROWAWAY}/`) && !ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)))
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

/** The W9 world on disk and registered (`wb_world new` when absent), then open. */
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
  if (!o.ok) fails.push(`the W9 world did not open ('${o.worldPath}')`);
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

// ── The dock read and the toggle round ───────────────────────────────────────

/** One dock read: what find saw of the row's dock or tool bar. */
export interface DockState {
  ok: boolean;
  /** Dock or tool-bar elements on screen. */
  shown: number;
  /** Dock or tool-bar elements in the tree (shown or not). */
  present: number;
  /** Dock tabs (a tabified dock) in a main-window tab bar. */
  tabs: number;
  /** The dock is open: shown, or tabified. */
  open: boolean;
  error?: string;
  /** Polls a read after a run took (readUntil). */
  polls?: number;
}

interface FindHit {
  path?: string;
  names?: string[];
  node?: { name?: string; automationId?: string; controlType?: string; offscreen?: boolean | null };
}

/** The state of a dock from a wb_gui find answer (pure; the harness test feeds it hits). */
export function dockStateOf(r: ToolResponse, t: ReadTarget): DockState {
  if (!r.ok) return { ok: false, shown: 0, present: 0, tabs: 0, open: false, error: why(r) };
  const hits = (Array.isArray(rb(r).hits) ? rb(r).hits : []) as FindHit[];
  const name = t.title ?? t.objectName;
  const dockHits = hits.filter((h) => {
    const n = h.node ?? {};
    const aid = S(n.automationId);
    const byAid = !!t.objectName && aid.endsWith(`.${t.objectName}`);
    const byName = ["Window", "ToolBar"].includes(S(n.controlType)) && eqi(S(n.name), name);
    return byAid || byName;
  });
  const tabs = hits.filter((h) => {
    const n = h.node ?? {};
    const names = Array.isArray(h.names) ? h.names : [];
    const parent = S(names[names.length - 2]);
    return S(n.controlType) === "TabItem" && eqi(S(n.name), t.title) && /tabbar/i.test(parent);
  }).length;
  const shown = dockHits.filter((h) => h.node?.offscreen !== true).length;
  return { ok: true, shown, present: dockHits.length, tabs, open: shown > 0 || tabs > 0 };
}

async function readDock(ctx: StepContext, row: ToggleRow): Promise<DockState> {
  const t = row.read!;
  const r = await ctx.tool("wb_gui", {
    action: "find",
    pid: ctx.deps.recordedPid() ?? undefined,
    windowTitle: MODULE_WINDOWS[row.module],
    className: EDITOR_CLASS,
    query: t.title ?? t.objectName ?? "",
    limit: FIND_LIMIT,
  });
  return dockStateOf(r, t);
}

/** One run of the row's menu item; `ran` is what the tool answered (ExecuteAction's true). */
async function runRow(
  ctx: StepContext,
  row: Pick<ToggleRow, "route" | "module" | "segments">,
): Promise<{ ran: boolean; answer: string; r: ToolResponse }> {
  if (isCandidatePath(row.segments)) {
    // DEC-100: no shipped tool sends a candidate; under --candidates the probe pack runs it.
    if (!ctx.opts.candidates) {
      const r: ToolResponse = { ok: false, code: "NOT_ALLOWLISTED", message: CANDIDATE_HELD };
      ctx.calls.push({ notSent: `${row.segments.join(" > ")}: ${CANDIDATE_HELD}` });
      return { ran: false, answer: "NOT_ALLOWLISTED", r };
    }
    const r = await ctx.tool("probe", {
      action: "executeAction",
      moduleName: row.module,
      menuPath: [...row.segments],
      keepFocus: true,
      candidate: true,
    });
    const ran = r.ok && truthy(rb(r).result);
    return { ran, answer: r.ok ? (ran ? "ran" : "returned false") : answerOf(r), r };
  }
  const r =
    row.route === "wb_menu.run"
      ? await ctx.tool("wb_menu", {
          action: "run",
          module: row.module,
          path: row.segments.join(","),
          confirm: true,
        })
      : await ctx.tool("wb_module", {
          action: "action",
          module: row.module,
          menuPath: [...row.segments],
        });
  const ran = r.ok && (row.route === "wb_menu.run" ? truthy(rb(r).ran) : truthy(rb(r).result));
  return { ran, answer: r.ok ? (ran ? "ran" : "returned false") : answerOf(r), r };
}

/** What happened to one row. */
export interface RowResult {
  id: string;
  path: string;
  dock: string | null;
  inferred?: boolean;
  verdict: "PASS" | "FAIL" | "NOT-READ" | "NOT-RUN";
  why: string;
  reads: DockState[];
  runs: string[];
  /** Runs that changed nothing at the read (the first, on W9 run 1's AnimEditor and BehaviorEditor). */
  absorbed?: number;
  /** A show row: the toggle row run to hide its dock first. */
  hideWith?: string;
  /** The module stops after this row (two restore runs left it away from its first state). */
  stopModule?: boolean;
}

const sigOf = (s: DockState): string => (s.ok ? (s.open ? "open" : "closed") : "unread");
const sigB = (open: boolean): string => (open ? "open" : "closed");

/**
 * A read after a run: poll the dock until it reads `want`, SETTLE_MS before each poll, at most
 * SETTLE_POLLS polls and no new poll once SETTLE_BUDGET_MS has passed. W9 run 1 read once, 750 ms
 * after the run; a dock shown or hidden later than that read as no change (fix-up 1).
 */
export async function readUntil(
  ctx: StepContext,
  row: ToggleRow,
  want: boolean,
): Promise<DockState> {
  const started = ctx.deps.now();
  let s: DockState = { ok: false, shown: 0, present: 0, tabs: 0, open: false, error: "not read" };
  let polls = 0;
  while (polls < SETTLE_POLLS) {
    await ctx.sleep(SETTLE_MS);
    s = await readDock(ctx, row);
    polls++;
    if (s.ok && s.open === want) break;
    if (ctx.deps.now() - started >= SETTLE_BUDGET_MS) break;
  }
  return { ...s, polls };
}

/** The round's run and read helpers over one result. */
function rounds(ctx: StepContext, row: ToggleRow, res: RowResult) {
  const run = async (as: ToggleRow = row) => {
    const a = await runRow(ctx, as);
    res.runs.push(a.answer);
    return a;
  };
  const read = async (want: boolean): Promise<boolean> => {
    const s = await readUntil(ctx, row, want);
    res.reads.push(s);
    return s.ok && s.open === want;
  };
  const last = (): string => sigOf(res.reads[res.reads.length - 1]!);
  /** Up to RESTORE_RUNS runs of `by` back to `first`; the module stops when none brings it back. */
  const restore = async (first: boolean, what: string, by: ToggleRow = row): Promise<RowResult> => {
    for (let k = 1; k <= RESTORE_RUNS; k++) {
      await run(by);
      if (await read(first))
        return { ...res, verdict: "FAIL", why: `${what}; restore run ${k} brought it back` };
    }
    return {
      ...res,
      verdict: "FAIL",
      why: `${what}; ${RESTORE_RUNS} restore runs left it ${last()}; the module stops`,
      stopModule: true,
    };
  };
  return { run, read, restore };
}

function rowResult(row: ToggleRow): RowResult {
  return {
    id: row.id,
    path: row.path,
    dock: row.read?.rowId ?? null,
    ...(row.read?.inferred ? { inferred: true } : {}),
    ...(row.hideWith ? { hideWith: row.hideWith.path } : {}),
    verdict: "NOT-READ",
    why: row.notRead ?? "",
    reads: [],
    runs: [],
  };
}

const CLOSED_FIRST =
  "closed at the first read: showing a dock that is not in the layout may float an owned window (a handoff); --show-closed drives it";

/**
 * U9's round on one row: read, run, read (a change), run, read (the first state), each read after a
 * run polled (readUntil). A first run that changes nothing is followed by one more run (absorbed);
 * a row whose first run was absorbed and that came back runs one confirm round (run, change, run,
 * back) and PASSes only on it. A row not back is restored by at most RESTORE_RUNS runs: a FAIL, and
 * the module stops only when no restore run brought it back.
 */
export async function toggleRow(ctx: StepContext, row: ToggleRow): Promise<RowResult> {
  const res = rowResult(row);
  if (!row.read) return res;
  if (row.hideWith) return showRow(ctx, row, res);
  const r0 = await readDock(ctx, row);
  res.reads.push(r0);
  if (!r0.ok) return { ...res, why: `the first read failed (${r0.error ?? "no answer"}): not run` };
  if (!r0.open && !ctx.opts.showClosed) return { ...res, verdict: "NOT-RUN", why: CLOSED_FIRST };
  const first = r0.open;
  const { run, read, restore } = rounds(ctx, row, res);
  let absorbed = 0;
  let changed = false;
  for (let i = 1; i <= 2 && !changed; i++) {
    const a = await run();
    changed = await read(!first);
    if (changed) break;
    if (!a.ran)
      return {
        ...res,
        verdict: "FAIL",
        why: `run ${i} did not run (${a.answer}${a.r.ok ? "" : `: ${S(a.r.message)}`}); nothing changed`,
        ...(absorbed ? { absorbed } : {}),
      };
    absorbed++;
  }
  if (absorbed) res.absorbed = absorbed;
  if (!changed)
    return {
      ...res,
      verdict: "FAIL",
      why: `no change read after two runs (${sigB(first)} at every read, each polled): the first state stands`,
    };
  await run();
  if (!(await read(first)))
    return restore(
      first,
      `not back to its first state (${sigB(first)}) after the toggle back (${sigB(!first)})`,
    );
  if (!absorbed)
    return { ...res, verdict: "PASS", why: `${sigB(first)} -> ${sigB(!first)} -> ${sigB(first)}` };
  // The first run was absorbed: one confirm round, in step now, decides the row.
  await run();
  if (!(await read(!first)))
    return {
      ...res,
      verdict: "FAIL",
      why: `the first run changed nothing, the next two toggled and restored, the confirm run changed nothing again (${sigB(first)}): not a two-state toggle in step with its dock`,
    };
  await run();
  if (!(await read(first)))
    return restore(first, `the confirm round did not come back to ${sigB(first)}`);
  return {
    ...res,
    verdict: "PASS",
    why: `${sigB(first)} -> ${sigB(!first)} -> ${sigB(first)} on the confirm round; the first run changed nothing (its checked state out of step with the dock)`,
  };
}

/**
 * A show row (SHOW_PAIRS): read the dock open, hide it by its own toggle row, run the Go to item and
 * read it open again. The item's run is the restore; a show that does not read open is restored by
 * the toggle row (at most RESTORE_RUNS runs). A hide that changes nothing gets one more run, and so
 * does a show (fix-up 2); a hide that never reads closed is a FAIL with nothing to restore.
 */
async function showRow(ctx: StepContext, row: ToggleRow, res: RowResult): Promise<RowResult> {
  const hw = row.hideWith!;
  const hide: ToggleRow = {
    ...row,
    id: hw.id,
    path: hw.path,
    segments: hw.segments,
    hideWith: null,
  };
  const r0 = await readDock(ctx, row);
  res.reads.push(r0);
  if (!r0.ok) return { ...res, why: `the first read failed (${r0.error ?? "no answer"}): not run` };
  if (!r0.open)
    return { ...res, verdict: "NOT-RUN", why: `${CLOSED_FIRST} (a show row needs it open)` };
  const { run, read, restore } = rounds(ctx, row, res);
  // A hide that changes nothing left the dock open, its first state: nothing to restore. It gets one
  // more run, as a toggle row's first run does (fix-up 2: W9 run 2 swallowed the first hide of all
  // six AnimEditor pairs, and the restore runs that followed closed the dock and reopened it).
  let absorbed = 0;
  let hidden = false;
  for (let i = 1; i <= 2 && !hidden; i++) {
    const h = await run(hide);
    hidden = await read(false);
    if (hidden) break;
    if (!h.ran)
      return {
        ...res,
        verdict: "FAIL",
        why: `the hide (${hw.path}) did not run (${h.answer}); nothing changed`,
        ...(absorbed ? { absorbed } : {}),
      };
    absorbed++;
  }
  if (absorbed) res.absorbed = absorbed;
  if (!hidden)
    return {
      ...res,
      verdict: "FAIL",
      why: `the hide (${hw.path}) did not read closed after two runs (open at every read, each polled): the first state stands, nothing to restore`,
    };
  let showAbsorbed = 0;
  const note = (): string => {
    const n = [
      absorbed ? "the first hide changed nothing" : "",
      showAbsorbed ? "the first show changed nothing" : "",
    ].filter(Boolean);
    return n.length ? `; ${n.join(", ")}` : "";
  };
  let g = await run();
  let shown = await read(true);
  // A Go to item only shows and raises: a second run of it is safe, so a swallowed first show gets one.
  if (!shown && g.ran) {
    showAbsorbed = 1;
    g = await run();
    shown = await read(true);
  }
  if (absorbed + showAbsorbed) res.absorbed = absorbed + showAbsorbed;
  if (shown)
    return {
      ...res,
      verdict: "PASS",
      why: `open -> closed (by ${hw.path}) -> open (by ${row.path})${note()}`,
    };
  return restore(
    true,
    `the show did not read open (${g.answer}); the dock was hidden by ${hw.path}`,
    hide,
  );
}

/** The promote.ts --batch line of a row that completed (the runner fills in the evidence id). */
export function liveResultLine(stepId: string, rowId: string, date: string): Raw {
  return {
    live_result: { test: stepId, rows: [rowId], verdict: "pass", oracle: "state-readback", date },
  };
}

/** The promote.ts --batch row line linking a row to its live test (T5 needs the link). */
export function liveTestLine(stepId: string, rowId: string): Raw {
  return { id: rowId, tests: [{ id: stepId, file: SCRIPT_PATH, kind: "live" }] };
}

/** The sitting file of a module step's live results. */
export function liveFileOf(stepId: string): string {
  return `w9-live-${stepId}.jsonl`;
}

/** One module's step body: open and front it, then each readable row's round. */
export async function moduleToggles(
  ctx: StepContext,
  module: ModuleName,
  stepId: string,
): Promise<StepOutcome> {
  const rows = ctx.deps.toggleRows().filter((r) => r.module === module);
  // DEC-100: a row whose path (or its hide row's) is a candidate is not sent without --candidates.
  const held = (r: ToggleRow): boolean =>
    !ctx.opts.candidates &&
    (isCandidatePath(r.segments) || (!!r.hideWith && isCandidatePath(r.hideWith.segments)));
  // Toggle rows first, show rows (which hide by a toggle row) after them.
  const readable = [
    ...rows.filter((r) => r.read && !r.hideWith),
    ...rows.filter((r) => r.read && r.hideWith),
  ];
  const evidence: Raw = {
    rows: rows.length,
    readable: readable.length,
    notRead: rows.filter((r) => !r.read).map((r) => ({ id: r.id, path: r.path, why: r.notRead })),
    answeredFalse: rows
      .filter((r) => r.routeFalse)
      .map((r) => ({ id: r.id, path: r.path, probe: r.routeFalse })),
  };
  const falseNote = (): string => {
    const n = rows.filter((r) => r.routeFalse).length;
    return n
      ? ` (${n} of them answered false by the menu-run route, ${ROUTE_FALSE_PROBE}, not sent)`
      : "";
  };
  if (!readable.length)
    return {
      status: "PASS",
      detail: `${module}: no row has a read; ${rows.length} recorded NOT-READ, nothing sent`,
      evidence,
    };
  const fails: string[] = [];
  if (module === "WorldEditor" && !(await ensureWorld(ctx, evidence, fails)))
    return { ...verdictOf(fails, ""), evidence };
  const open = await ctx.tool("wb_module", { action: "open", module });
  const front = await ctx.tool("wb_module", { action: "front", module });
  evidence.open = brief(open);
  evidence.front = answerOf(front);
  if (!open.ok) {
    fails.push(`${module} did not open: ${why(open)}`);
    return { ...verdictOf(fails, ""), evidence };
  }
  const results: RowResult[] = [];
  const lines: Raw[] = [];
  const date = new Date(ctx.deps.now()).toISOString().slice(0, 10);
  let stoppedAfter: string | null = null;
  for (const row of readable) {
    if (held(row)) {
      results.push({
        id: row.id,
        path: row.path,
        dock: row.read?.rowId ?? null,
        verdict: "NOT-RUN",
        why: CANDIDATE_HELD,
        reads: [],
        runs: [],
      });
      continue;
    }
    const hideFailed =
      row.hideWith && results.find((x) => x.id === row.hideWith!.id && x.verdict !== "PASS");
    if (stoppedAfter || hideFailed) {
      results.push({
        id: row.id,
        path: row.path,
        dock: row.read?.rowId ?? null,
        verdict: "NOT-RUN",
        why: stoppedAfter
          ? `the module stopped after ${stoppedAfter} (no restore run brought it back)`
          : `its hide row ${row.hideWith!.path} did not PASS this run`,
        reads: [],
        runs: [],
      });
      continue;
    }
    const r = await toggleRow(ctx, row);
    results.push(r);
    if (r.verdict === "PASS")
      lines.push(liveTestLine(stepId, row.id), liveResultLine(stepId, row.id, date));
    if (r.verdict === "FAIL") fails.push(`${row.path}: ${r.why}`);
    if (r.stopModule) stoppedAfter = row.path;
  }
  evidence.results = results;
  const count = (v: RowResult["verdict"]): number => results.filter((r) => r.verdict === v).length;
  evidence.tally = {
    pass: count("PASS"),
    fail: count("FAIL"),
    notRun: count("NOT-RUN"),
    notReadAtRun: count("NOT-READ"),
    notRead: rows.length - readable.length,
    answeredFalse: rows.filter((r) => r.routeFalse).length,
    candidatesHeld: readable.filter(held).length,
  };
  return {
    ...verdictOf(
      fails,
      `${module}: ${count("PASS")} of ${readable.length} readable row(s) toggled and restored; ${count("NOT-RUN")} not run; ${rows.length - readable.length + count("NOT-READ")} NOT-READ${falseNote()}`,
    ),
    evidence,
    results: { file: liveFileOf(stepId), lines },
  };
}

// ── The view and selection items (DEC-095) ───────────────────────────────────

/** What a view row's effect is read through. */
export type ViewRead = "selection" | "camera" | "caret";

/** One DEC-095 view- or selection-only row: its read, or why it has none. */
export interface ViewRow {
  id: string;
  module: string;
  path: string;
  segments: string[];
  route: "wb_menu.run" | "wb_module.action";
  read: ViewRead | null;
  notRead: string | null;
  /** The counterpart item that moves the caret back (Back and Forward, Next and Previous). */
  counterpart?: string[];
}

export const VIEW_UNREAD_STEP = "w9-20-view-unread";
export const VIEW_WE_STEP = "w9-21-view-worldeditor";
export const VIEW_SE_STEP = "w9-22-view-scripteditor";
/** The entity the World Editor rows act on: the throwaway world's first entity, selected by index. */
export const VIEW_SEED = "index:0";
/** Camera coordinates closer than this (metres, per axis) read as the same position. */
export const CAMERA_EPS = 0.01;

const NOT_READ_BROWSER =
  "selects or scrolls to the item in a browser dock (Resource Browser or Prefab Library): no read of that browser's selection on 1.9.0.37";

function viewRow(
  module: string,
  path: string,
  read: ViewRead | null,
  notRead: string | null,
  counterpart?: string[],
): ViewRow {
  const segments = path.split(" > ");
  return {
    id: `ui:${module}/menu-item/${segments.join("/")}`,
    module,
    path,
    segments,
    route: module === "WorldEditor" ? "wb_menu.run" : "wb_module.action",
    read,
    notRead,
    ...(counterpart ? { counterpart } : {}),
  };
}

/**
 * The 19 rows DEC-095 put on the allow-list (main's ruling on
 * docs/v2/inbox/phase6/menu-safe-state-review.md). The 11 with a read are driven; the 8 with
 * none are recorded NOT-READ and never run.
 */
export const VIEW_ROWS: readonly ViewRow[] = [
  ...[
    "Select Children",
    "Select Layer",
    "Select Parent",
    "Select Prefab Instance Members",
    "Select Prefab Instance Root",
    "Select Siblings",
  ].map((l) => viewRow("WorldEditor", `Entities > ${l}`, "selection", null)),
  viewRow("WorldEditor", "Entities > Focus Selection", "camera", null),
  ...["Locate Nested Prefab", "Locate Prefab", "Locate Prefab in Library"].map((l) =>
    viewRow("WorldEditor", `Entities > ${l}`, null, NOT_READ_BROWSER),
  ),
  viewRow("ResourceManager", "Edit > Locate File in Resource Browser", null, NOT_READ_BROWSER),
  ...["Collapse all groups", "Expand all groups", "Show only modified properties"].map((l) =>
    viewRow(
      "ResourceManager.Layout",
      `Properties Tab > Property Grid Options > ${l}`,
      null,
      "changes the Layout editor's property grid view: no read of the grid's groups or filter",
    ),
  ),
  viewRow("ScriptEditor", "Edit > Navigate Back", "caret", null, ["Edit", "Navigate Forward"]),
  viewRow("ScriptEditor", "Edit > Navigate Forward", "caret", null, ["Edit", "Navigate Back"]),
  viewRow("ScriptEditor", "Bookmarks > Next Bookmark", "caret", null, [
    "Bookmarks",
    "Previous Bookmark",
  ]),
  viewRow("ScriptEditor", "Bookmarks > Previous Bookmark", "caret", null, [
    "Bookmarks",
    "Next Bookmark",
  ]),
  viewRow(
    "AnimEditor",
    "Track > Stop",
    null,
    "stops preview playback: no read of the Animation Editor's playback state",
  ),
];

/** The review's rows DEC-095 held back: they open another window or module. Never on the list. */
export const VIEW_HELD: ReadonlyArray<{ id: string; path: string; why: string }> = [
  ...[
    "Animation Editor",
    "Audio Editor",
    "Behavior Editor",
    "Particle Editor",
    "Procedural Animation Editor",
    "Script Editor",
    "String Editor",
    "World Editor",
  ].map((l) => ({
    id: `ui:ResourceManager/menu-item/Editors/${l}`,
    path: `Editors > ${l}`,
    why: "opens or fronts another module window: off the allow-list until a battery shows what it opens (DEC-095)",
  })),
  {
    id: "ui:WorldEditor/menu-item/File/Go to World File",
    path: "File > Go to World File",
    why: "may open a file browser: off the allow-list until a battery shows what it opens (DEC-095)",
  },
];

/** What one view row did. */
export interface ViewResult {
  id: string;
  path: string;
  read: ViewRead | null;
  /** PASS: the after-read showed the effect (a live result is written). NO-EFFECT: it did not. */
  verdict: "PASS" | "NO-EFFECT" | "FAIL" | "NOT-READ" | "NOT-RUN";
  why: string;
  before?: unknown;
  after?: unknown;
  restored?: unknown;
  runs: string[];
}

type MenuRun = Pick<ToggleRow, "route" | "module" | "segments">;
interface Caret {
  file: string;
  line: number;
}

const idRef = (id: string): string => (/^(id|name|index):/.test(id) ? id : `id:${id}`);
const caretKey = (c: Caret): string => `${c.file}\u0000${c.line}`;

/** The selected entity ids, sorted (null when the read failed). */
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

async function readCaret(ctx: StepContext): Promise<Caret | null> {
  const r = await ctx.tool("wb_script_editor", { action: "state" });
  if (!r.ok || !truthy(rb(r).opened)) return null;
  return { file: S(rb(r).file), line: Number(rb(r).line) };
}

/** Same camera position: every axis within CAMERA_EPS. */
export function sameCoords(a: string, b: string): boolean {
  const x = a.trim().split(/\s+/).map(Number);
  const y = b.trim().split(/\s+/).map(Number);
  return (
    x.length === y.length &&
    x.length > 0 &&
    x.every((v, i) => Number.isFinite(v) && Math.abs(v - y[i]!) <= CAMERA_EPS)
  );
}

/** A read polled until `done` holds (SETTLE_MS apart, at most SETTLE_POLLS, SETTLE_BUDGET_MS). */
async function pollRead<T>(
  ctx: StepContext,
  read: () => Promise<T | null>,
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

function viewResult(r: ViewRow): ViewResult {
  return r.read
    ? { id: r.id, path: r.path, read: r.read, verdict: "NOT-RUN", why: "", runs: [] }
    : { id: r.id, path: r.path, read: null, verdict: "NOT-READ", why: r.notRead ?? "", runs: [] };
}

function viewOutcome(
  label: string,
  results: ViewResult[],
  fails: string[],
  evidence: Raw,
  stepId: string,
  lines: Raw[],
): StepOutcome {
  const count = (v: ViewResult["verdict"]): number => results.filter((r) => r.verdict === v).length;
  evidence.results = results;
  evidence.tally = {
    pass: count("PASS"),
    noEffect: count("NO-EFFECT"),
    fail: count("FAIL"),
    notRun: count("NOT-RUN"),
    notRead: count("NOT-READ"),
  };
  return {
    ...verdictOf(
      fails,
      `${label}: ${count("PASS")} effect(s) read and restored; ${count("NO-EFFECT")} ran with no effect read (no live result); ${count("NOT-RUN")} not run; ${count("NOT-READ")} NOT-READ`,
    ),
    evidence,
    results: { file: liveFileOf(stepId), lines },
  };
}

/** Focus Selection: the camera before and after, put back by wb_view setCamera. */
async function cameraRow(ctx: StepContext, row: ViewRow, res: ViewResult): Promise<void> {
  const c0 = await readCamera(ctx);
  if (!c0) {
    res.why = "the camera read failed: not run";
    return;
  }
  res.before = c0;
  const a = await runRow(ctx, row as MenuRun);
  res.runs.push(a.answer);
  const c1 = await pollRead(
    ctx,
    () => readCamera(ctx),
    (c) => !sameCoords(c.coords, c0.coords),
  );
  res.after = c1;
  if (!c1 || sameCoords(c1.coords, c0.coords)) {
    res.verdict = "NO-EFFECT";
    res.why = `the camera did not move (${a.answer})`;
    return;
  }
  await ctx.tool("wb_view", { action: "setCamera", coords: c0.coords, look: c0.direction });
  const c2 = await readCamera(ctx);
  res.restored = c2;
  if (!c2 || !sameCoords(c2.coords, c0.coords)) {
    res.verdict = "FAIL";
    res.why = "the camera moved; wb_view setCamera did not put it back";
    return;
  }
  res.verdict = "PASS";
  res.why = `the camera moved (${c0.coords} -> ${c1.coords}) and setCamera put it back`;
}

/** A selection row: the selected ids before and after (polled). */
async function selectionRow(ctx: StepContext, row: ViewRow, res: ViewResult): Promise<void> {
  const b = await readSelection(ctx);
  if (b === null) {
    res.why = "the selection read failed: not run";
    return;
  }
  res.before = b;
  const a = await runRow(ctx, row as MenuRun);
  res.runs.push(a.answer);
  const after = await pollRead(
    ctx,
    () => readSelection(ctx),
    (x) => x.join("\n") !== b.join("\n"),
  );
  res.after = after;
  if (!after || after.join("\n") === b.join("\n")) {
    res.verdict = "NO-EFFECT";
    res.why = `the selection did not change (${b.length} selected; ${a.answer})`;
    return;
  }
  res.verdict = "PASS";
  res.why = `the selection changed (${b.length} -> ${after.length} selected)`;
}

/**
 * The World Editor's view rows, each from the same start: the throwaway world's first entity
 * selected (wb_view select set index:0). A selection row reads the selected ids before and after
 * its run; Focus Selection reads the camera and is put back by wb_view setCamera. At the end the
 * selection is put back as it was found (nothing selected: select clear); Edit > Undo is not used.
 * A row with no effect read writes no live result.
 */
export async function viewWorldEditor(ctx: StepContext, stepId: string): Promise<StepOutcome> {
  const rows = VIEW_ROWS.filter((r) => r.module === "WorldEditor");
  const evidence: Raw = { rows: rows.length, driven: rows.filter((r) => r.read).length };
  const fails: string[] = [];
  const results = rows.map(viewResult);
  const lines: Raw[] = [];
  const date = new Date(ctx.deps.now()).toISOString().slice(0, 10);
  const label = "WorldEditor view rows";
  const notRun = (why: string): StepOutcome => {
    for (const r of results) if (r.verdict === "NOT-RUN") r.why = why;
    return viewOutcome(label, results, fails, evidence, stepId, lines);
  };
  if (!(await ensureWorld(ctx, evidence, fails))) return notRun("the W9 world did not open");
  const s0 = await readSelection(ctx);
  evidence.selectionBefore = s0;
  if (s0 === null) {
    fails.push("the selection read (wb_view selection) failed");
    return notRun("no selection read");
  }
  for (const [i, row] of rows.entries()) {
    const res = results[i]!;
    if (!row.read) continue;
    if (!ctx.opts.candidates && isCandidatePath(row.segments)) {
      res.why = CANDIDATE_HELD;
      continue;
    }
    const seed = await ctx.tool("wb_view", {
      action: "select",
      mode: "set",
      entities: [VIEW_SEED],
    });
    if (!seed.ok || Number(rb(seed).selectedCount) < 1) {
      res.why = `no entity at ${VIEW_SEED} in the throwaway world (select answered ${answerOf(seed)}): nothing for the item to act on`;
      continue;
    }
    if (row.read === "camera") await cameraRow(ctx, row, res);
    else await selectionRow(ctx, row, res);
    if (res.verdict === "FAIL") fails.push(`${row.path}: ${res.why}`);
    if (res.verdict === "PASS")
      lines.push(liveTestLine(stepId, row.id), liveResultLine(stepId, row.id, date));
  }
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
  return viewOutcome(label, results, fails, evidence, stepId, lines);
}

/**
 * The Script Editor's caret rows: read the active tab's file and caret line, run the item, read
 * again (polled). A move is put back by the counterpart item (Navigate Forward after Back, the
 * previous bookmark after the next) and read back. No script tab open: not run.
 */
export async function viewScriptEditor(ctx: StepContext, stepId: string): Promise<StepOutcome> {
  const rows = VIEW_ROWS.filter((r) => r.module === "ScriptEditor");
  const evidence: Raw = { rows: rows.length };
  const fails: string[] = [];
  const results = rows.map(viewResult);
  const lines: Raw[] = [];
  const date = new Date(ctx.deps.now()).toISOString().slice(0, 10);
  // DEC-100: a row whose path or counterpart is a candidate is not sent without --candidates.
  const held = (r: ViewRow): boolean =>
    !ctx.opts.candidates && (isCandidatePath(r.segments) || isCandidatePath(r.counterpart ?? []));
  if (rows.every((r) => !r.read || held(r))) {
    for (const [i, row] of rows.entries()) if (row.read) results[i]!.why = CANDIDATE_HELD;
    evidence.candidatesHeld = rows.filter((r) => r.read).length;
    return viewOutcome("ScriptEditor view rows", results, fails, evidence, stepId, lines);
  }
  const open = await ctx.tool("wb_module", { action: "open", module: "ScriptEditor" });
  const front = await ctx.tool("wb_module", { action: "front", module: "ScriptEditor" });
  evidence.open = brief(open);
  evidence.front = answerOf(front);
  for (const [i, row] of rows.entries()) {
    const res = results[i]!;
    if (held(row)) {
      res.why = CANDIDATE_HELD;
      continue;
    }
    if (!open.ok) {
      res.why = `the Script Editor did not open (${why(open)})`;
      continue;
    }
    const b = await readCaret(ctx);
    if (!b) {
      res.why = "no script tab open (wb_script_editor state): no caret line to read";
      continue;
    }
    res.before = b;
    const a = await runRow(ctx, row as MenuRun);
    res.runs.push(a.answer);
    const after = await pollRead(
      ctx,
      () => readCaret(ctx),
      (c) => caretKey(c) !== caretKey(b),
    );
    res.after = after;
    if (!after || caretKey(after) === caretKey(b)) {
      res.verdict = "NO-EFFECT";
      res.why = `the caret did not move (line ${b.line}; ${a.answer})`;
      continue;
    }
    const by = row.counterpart!;
    const k = await runRow(ctx, { route: row.route, module: "ScriptEditor", segments: by });
    res.runs.push(k.answer);
    const c = await pollRead(
      ctx,
      () => readCaret(ctx),
      (x) => caretKey(x) === caretKey(b),
    );
    res.restored = c;
    if (!c || caretKey(c) !== caretKey(b)) {
      res.verdict = "FAIL";
      res.why = `the caret moved (line ${b.line} -> ${after.line}); ${by.join(" > ")} did not bring it back`;
      fails.push(`${row.path}: ${res.why}`);
      continue;
    }
    res.verdict = "PASS";
    res.why = `the caret moved (line ${b.line} -> ${after.line}) and ${by.join(" > ")} brought it back`;
    lines.push(liveTestLine(stepId, row.id), liveResultLine(stepId, row.id, date));
  }
  return viewOutcome("ScriptEditor view rows", results, fails, evidence, stepId, lines);
}

/** The view rows of modules with no driven row, and the rows DEC-095 held: recorded, nothing sent. */
export function viewUnread(): StepOutcome {
  const unread = VIEW_ROWS.filter(
    (r) => !r.read && !["WorldEditor", "ScriptEditor"].includes(r.module),
  );
  return {
    status: "PASS",
    detail: `view rows with no read: ${unread.length} recorded NOT-READ, ${VIEW_HELD.length} held off the allow-list (DEC-095); nothing sent`,
    evidence: {
      notRead: unread.map((r) => ({ id: r.id, path: r.path, why: r.notRead })),
      held: VIEW_HELD,
    },
  };
}

/** A view row as the run plan's row (route, module, segments). */
function asPlanRow(r: ViewRow, segments: string[] = r.segments): ToggleRow {
  return {
    id: r.id,
    module: r.module as ModuleName,
    path: segments.join(" > "),
    segments,
    route: r.route,
    read: null,
    notRead: null,
  };
}

function viewSteps(o: BuildOptions = {}): StepDef[] {
  const we = VIEW_ROWS.filter(
    (r) => r.module === "WorldEditor" && r.read && runnable(r.segments, o),
  );
  const se = VIEW_ROWS.filter(
    (r) =>
      r.module === "ScriptEditor" &&
      r.read &&
      runnable(r.segments, o) &&
      runnable(r.counterpart ?? [], o),
  );
  // Read-only first: a launch block runs its steps in risk order (validateQueue).
  return [
    {
      id: VIEW_UNREAD_STEP,
      block: "W9.2",
      title:
        "view rows with no read (Resource Manager Locate File, the Layout editor's property grid items, Anim Editor Track > Stop) recorded NOT-READ, and the rows DEC-095 held; nothing sent",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: "nothing is sent",
      kill_criterion: "none: nothing is sent",
      side_effects: [],
      rollback: "none",
      writes: [],
      plan: () => [],
      run: async () => viewUnread(),
    },
    {
      id: VIEW_WE_STEP,
      block: "W9.2",
      title:
        "WorldEditor view and selection items (DEC-095): each from the world's first entity selected; the selection or the camera read before and after (polled); the camera put back by setCamera, the selection put back as found; NOT-READ rows recorded, not run; DEC-100 candidates not run without --candidates",
      risk: "reversible",
      timeout_ms: Math.max(60_000, TIMEOUTS.row * we.length),
      expected:
        "a row whose after-read shows its effect writes a live result; a row with no effect read writes none; the selection ends as it was found",
      kill_criterion:
        "a camera or a selection not put back: FAIL; a dialog or a floating window: HANDOFF",
      side_effects: [
        "the World Editor selection and camera change and are put back (editor state, not world data)",
      ],
      rollback:
        "wb_view setCamera with the camera read before the run; wb_view select back to the selection found (clear when nothing was selected); Edit > Undo is not used",
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_world", "state", {}, { note: "the W9 world open (ensureWorld)" }),
        tc("wb_view", "selection", { limit: 200 }, { note: "the selection as found" }),
        ...we.flatMap((r) => [
          tc("wb_view", "select", { mode: "set", entities: [VIEW_SEED] }, { note: "the start" }),
          r.read === "camera"
            ? tc("wb_view", "camera", {}, { note: "the camera before" })
            : tc("wb_view", "selection", { limit: 200 }, { note: "the selection before" }),
          ...runPlan(asPlanRow(r), "the item"),
          r.read === "camera"
            ? tc("wb_view", "camera", {}, { note: "the camera after (polled)" })
            : tc("wb_view", "selection", { limit: 200 }, { note: "the selection after (polled)" }),
          ...(r.read === "camera"
            ? [
                tc(
                  "wb_view",
                  "setCamera",
                  { coords: "<before>", look: "<before>" },
                  { note: "the restore, when it moved" },
                ),
                tc("wb_view", "camera", {}, { note: "the camera back" }),
              ]
            : []),
        ]),
        tc(
          "wb_view",
          "select",
          { mode: "clear" },
          { note: "the selection put back (set to the one found when it was not empty)" },
        ),
        tc("wb_view", "selection", { limit: 200 }, { note: "the selection back" }),
      ],
      run: async (ctx) => viewWorldEditor(ctx, VIEW_WE_STEP),
    },
    {
      id: VIEW_SE_STEP,
      block: "W9.2",
      title:
        "ScriptEditor caret items (DEC-095): the file and caret line read before and after (polled); a move put back by the counterpart item; no script tab open: not run; DEC-100 candidates (all four today) not run without --candidates, and then nothing is sent",
      risk: "reversible",
      timeout_ms: Math.max(60_000, TIMEOUTS.row * se.length),
      expected:
        "a row whose caret moved and came back by its counterpart writes a live result; a row with no move writes none",
      kill_criterion: "a caret moved and not brought back: FAIL; a dialog or a window: HANDOFF",
      side_effects: ["the Script Editor caret moves and is moved back (view state)"],
      rollback: "the counterpart item (Navigate Forward after Back, Previous Bookmark after Next)",
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () =>
        se.length === 0
          ? []
          : [
              tc("wb_module", "open", { module: "ScriptEditor" }),
              tc("wb_module", "front", { module: "ScriptEditor" }),
              ...se.flatMap((r) => [
                tc("wb_script_editor", "state", {}, { note: "the caret before" }),
                ...runPlan(asPlanRow(r), "the item"),
                tc("wb_script_editor", "state", {}, { note: "the caret after (polled)" }),
                ...runPlan(asPlanRow(r, r.counterpart), "the counterpart, when it moved"),
                tc("wb_script_editor", "state", {}, { note: "the caret back (polled)" }),
              ]),
            ],
      run: async (ctx) => viewScriptEditor(ctx, VIEW_SE_STEP),
    },
  ];
}

// ── Snapshot and net-zero ────────────────────────────────────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W9/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W9Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W9_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W9Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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
  deps: Pick<W9Deps, "exists" | "readBytes" | "listTree">,
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

// ── Steps ────────────────────────────────────────────────────────────────────

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
      `the planted folder(s) ${missing.map((d) => `<sandbox>/${d}/`).join(", ")} are absent: run \`w9.live.ts plant\` first`,
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
  if (ctx.opts.candidates) {
    // DEC-100: the candidate override runs through the read-only probe pack, which answers only
    // when the sitting installed it; its executeAction refuses every project but the 2.0 sandbox.
    const p = await ctx.deps.tool("probe", { action: "info" });
    evidence.probe = brief(p);
    if (!p.ok || !truthy(rb(p).isSandbox))
      throw new StopBattery(
        "stopped",
        `--candidates needs the read-only probe pack on the 2.0 sandbox (launch.ts --install-handlers <sandbox> --probe-pack mod-dev/probe): ECEN_Probe info answered ${answerOf(p)}${p.ok ? `, isSandbox ${S(rb(p).isSandbox)}` : ""}`,
        evidence,
      );
  }
  if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
    evidence.snapshotTaken = true;
  evidence.snapshot = BATTERY_SNAPSHOT_FILE;
  return {
    status: "PASS",
    detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}${ctx.opts.candidates ? "; probe pack answers (--candidates)" : ""}`,
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
    fails.push(`changed outside ${W9_ROOT}/: ${diff.changed.join(", ")}`);
  return {
    ...verdictOf(fails, "net-zero: nothing changed outside the throwaway folder"),
    evidence,
  };
}

/**
 * The last step, also run after a stop: Workbench left closable. The throwaway world is left as
 * it is (toggles do not dirty a world), never saved, reopened or closed here, so the post-flight's
 * close raises no save prompt; the main session answers one No by hand if it comes.
 */
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
        ? `closable: ${open.toLowerCase().endsWith(WORLD.toLowerCase()) ? "the W9 world" : `'${open}'`} left open and untouched (toggles do not dirty a world); never saved`
        : "closable: no world open",
    ),
    evidence,
  };
}

export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W9.9",
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

function moduleStep(module: ModuleName, o: BuildOptions = {}): StepDef {
  const id = moduleStepId(module);
  const planned = (): ToggleRow[] =>
    loadToggleRows().filter(
      (r) =>
        r.module === module &&
        r.read &&
        runnable(r.segments, o) &&
        (!r.hideWith || runnable(r.hideWith.segments, o)),
    );
  return {
    id,
    block: "W9.1",
    title: `${module}: each allow-listed safe-toggle row with a dock read: read, run, read (a change, polled), run, read (the first state, polled); Go to show rows hidden by their toggle and shown; rows the menu-run route answered false (P-W9-01), DEC-100 candidates (without --candidates) and NOT-READ rows recorded, not run`,
    risk: "reversible",
    timeout_ms: Math.max(60_000, TIMEOUTS.row * planned().length),
    expected:
      "each driven row reads a change after the first run and its first state after the second; each completed row writes a live result naming its census row",
    kill_criterion:
      "a row not back to its first state: FAIL, at most two restore runs, the module goes on; it stops only when neither restore run brings the row back; a dialog or floating window: HANDOFF",
    side_effects: [
      `${module} docks and tool bars hidden and shown again (window state, not world data)`,
    ],
    rollback:
      "each item is run a second time (the toggle is its own undo); a row not back is run again, at most twice; a show row's dock is shown by its Go to item or, failing that, by its toggle",
    writes: [],
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => {
      const rows = planned();
      if (!rows.length) return [];
      return [
        ...(module === "WorldEditor"
          ? [
              tc(
                "wb_world",
                "state",
                {},
                { note: "the W9 world open (ensureWorld on a resumed run)" },
              ),
            ]
          : []),
        tc("wb_module", "open", { module }),
        tc("wb_module", "front", { module }),
        ...rows
          .filter((r) => !r.hideWith)
          .flatMap((r) => [
            readPlan(r, "the first state"),
            ...runPlan(r, "the toggle"),
            readPlan(r, "a change (polled)"),
            ...runPlan(r, "the toggle back"),
            readPlan(r, "the first state again (polled)"),
          ]),
        ...rows
          .filter((r) => r.hideWith)
          .flatMap((r) => [
            readPlan(r, "the dock open"),
            ...runPlan({ ...r, segments: r.hideWith!.segments }, `the hide by ${r.hideWith!.path}`),
            readPlan(r, "the dock closed (polled)"),
            ...runPlan(r, "the show"),
            readPlan(r, "the dock open again (polled)"),
          ]),
      ];
    },
    run: async (ctx) => moduleToggles(ctx, module, id),
  };
}

export function buildSteps(o: BuildOptions = {}): StepDef[] {
  return [
    {
      id: GATE_STEP,
      block: "W9.0",
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
        ...(o.candidates
          ? [
              tc(
                "probe",
                "info",
                {},
                { note: "the probe pack answers on the 2.0 sandbox (DEC-100 candidate override)" },
              ),
            ]
          : []),
      ],
      run: async (ctx) => testBedGate(ctx),
    },
    {
      id: WORLD_STEP,
      block: "W9.0",
      title: `the throwaway world ${WORLD}: wb_world new (when absent), register, open`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected: "the world is written under _throwaway/W9/, registered and open in edit mode",
      kill_criterion: "the world does not open: FAIL (the World Editor step ensures it again)",
      side_effects: [`${WORLD} and its .meta written under _throwaway/W9/`],
      rollback: "`w9.live.ts rollback` removes _throwaway/W9/ after Workbench is closed",
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
    ...MODULES.map((m) => moduleStep(m, o)),
    ...viewSteps(o),
    {
      id: NETZERO_STEP,
      block: "W9.9",
      title: "net-zero: the sandbox outside _throwaway/W9/ against the battery snapshot; edit mode",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "no file outside _throwaway/W9/ changed (resourceDatabase.rdb recorded, not failed)",
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

/** `tool.action` names a step sends. */
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

/** Rows per module: driven (a read) and NOT-READ. */
export function moduleTally(
  rows: ToggleRow[] = loadToggleRows(),
): Record<string, { driven: number; notRead: number }> {
  return Object.fromEntries(
    MODULES.map((m) => {
      const mine = rows.filter((r) => r.module === m);
      return [
        m,
        { driven: mine.filter((r) => r.read).length, notRead: mine.filter((r) => !r.read).length },
      ];
    }),
  );
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  const t = moduleTally();
  return [
    `${SESSION}: menu toggles battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map((s) => `  [${s.block}] ${s.id} (${s.risk}): ${s.title}`),
    `  rows per module (driven / NOT-READ): ${MODULES.map((m) => `${m} ${t[m]!.driven}/${t[m]!.notRead}`).join(", ")}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w9.live.ts --emit-queue` from its step table; tests/live-harness/w9-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: this queue is the regression run, which sends no ECEN_Probe call; a --candidates sitting (DEC-100) installs the read-only probe pack and sends ECEN_Probe info and executeAction with candidate: true.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/inbox/phase6/menu-battery-plan.md",
      "DEC-053",
      "DEC-058",
      "DEC-091",
      "DEC-092",
      "DEC-095",
      "DEC-100",
      "PLAN 5.3",
    ],
    launches: 1,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "pre-flight builds the real arguments; -scriptAuthorizeAll on the owner's standing go (DEC-053)",
    not_exercised: { ...NOT_EXERCISED },
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

export function selectSteps(
  steps: StepDef[],
  sel: { from?: string; only?: string; until?: string },
): StepDef[] | string {
  if (sel.only && (sel.from || sel.until)) return "--only excludes --from and --until";
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  if (sel.only) {
    const i = idx(sel.only);
    return i === -1 ? `${sel.only} is not a step id` : [steps[i]!];
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

/** The engine's save prompt on a world close or reload: its window title. */
export const SAVE_PROMPT_TITLES: readonly string[] = ["Loading world"];

/** The hand's answer to a HANDOFF window: No / Don't Save on a save prompt, Cancel or Close else. */
export function handAnswer(
  message: string,
  stepId: string,
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1]! : "";
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt
    ? "No"
    : "Cancel or Close (a floating dock: dock it back or close it); never OK, Apply or Save";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `hand: the save prompt "${title}": press No / Don't Save (never Save, never Yes), then resume ${resume}`
    : `hand: window "${title}": ${answer}; then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
}

function makeCtx(
  deps: W9Deps,
  opts: W9Options,
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
  deps: W9Deps,
  opts: W9Options,
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

export async function runBattery(
  steps: StepDef[],
  deps: W9Deps,
  opts: W9Options,
): Promise<BatteryReport> {
  const all = buildSteps();
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

function runDirsOf(opts: W9Options, deps: Pick<W9Deps, "listTree">): string[] {
  const runs = new Set(
    deps
      .listTree(opts.sittingDir)
      .filter((f) => f.includes("/"))
      .map((f) => f.split("/")[0]!),
  );
  return [...runs].sort().map((r) => join(opts.sittingDir, r));
}

/** `<sitting>/w9-result.json`: every step's latest record across the sitting's run folders. */
export function writeResult(
  opts: W9Options,
  deps: Pick<W9Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
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
    live_results: MODULES.map((m) => liveFileOf(moduleStepId(m))),
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
    ...records.map((r) => line(r.step, r.status, r.detail.replace(/\s+/g, " ").slice(0, 200))),
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
  removeTree: (p: string) => void;
  makeDir: (p: string) => void;
  log: (l: string) => void;
}

/** `plant`: the folders under _throwaway/W9/ (no Workbench running); the world is written live by w9-01. */
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
  if (io.exists(abs(sandboxDir, W9_ROOT))) {
    io.log(`refused: <sandbox>/${W9_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const record = {
    kind: "w9-plant",
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

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W9/; `_throwaway/` only when empty and absent before the plant. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W9_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W9_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W9_ROOT}/ (${files.length} files)`);
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
    join(sittingDir, "throwaway-w9-listing.json"),
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
  io.log(`removed <sandbox>/${W9_ROOT}/ (listing in throwaway-w9-listing.json)`);
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

/** An ECEN_Probe answer as a tool response: ok on status ok, its facts as the readback. */
export function probeResponse(r: Raw | null | undefined): ToolResponse {
  const status = S(r?.status);
  const keys = Array.isArray(r?.factKeys) ? (r!.factKeys as unknown[]).map(String) : [];
  const values = Array.isArray(r?.factValues) ? (r!.factValues as unknown[]).map(String) : [];
  const readback: Raw = {};
  keys.forEach((k, i) => (readback[k] = values[i] ?? ""));
  const out: ToolResponse = {
    ok: status === "ok",
    action: S(r?.action),
    message: S(r?.message),
    readback,
  };
  if (status === "refused") out.code = "NOT_ALLOWLISTED";
  else if (status !== "ok") out.code = "HANDLER_ERROR";
  return out;
}

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W9Deps {
  process.env[WB_GUI_ENV] = "1";
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const root = artifactsDir();
  const { server, handlers } = captureServer();
  registerWbMenu(server, client);
  registerWbGui(server, {});
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  return {
    tool: async (name, args) => {
      try {
        switch (name) {
          case "wb_module":
            return asResp(await runModule(client, args as unknown as ModuleArgs));
          case "wb_world":
            return asResp(
              await runWorld(client, args, { projectRoot: input.sandboxDir, artifactsRoot: root }),
            );
          case "wb_view":
            return asResp(await runView(client, args));
          case "wb_script_editor":
            return asResp(await runScriptEditor(client, args));
          case "probe":
            // DEC-100: the read-only probe pack, under --candidates only (the gate checks it).
            return probeResponse(await client.call<Raw>(CANDIDATE_API, args));
          default: {
            const h = handlers.get(name);
            if (!h)
              return {
                ok: false,
                code: "INVALID_ARGUMENT",
                message: `${name} is not registered in process`,
              };
            return responseOf(await h(args));
          }
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
    toggleRows: loadToggleRows,
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
const FLAGS = ["really", "show-closed", "candidates", "update-baseline"] as const;
const SUBCOMMANDS = ["plant", "rollback"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: W9Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
}

/** The dry-run gate: the plan against the policy, the W9 plan check and the queue. */
export function dryRunCheck(
  policy: CensusPolicy,
  o: BuildOptions = {},
): { ok: boolean; lines: string[] } {
  const steps = buildSteps(o);
  const plan = buildActionPlan(steps);
  const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
  const lines = [formatResult(check)];
  const own = w9PlanViolations(plan, loadToggleRows(), o);
  lines.push(
    own.length
      ? `W9 plan check: FAIL\n${own.map((v) => `  ${v}`).join("\n")}`
      : "W9 plan check: PASS",
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
  // DEC-100: --candidates also plans and drives the candidate rows, through the probe pack.
  const build: BuildOptions = { candidates: args.flags.has("candidates") };
  if (build.candidates && o["emit-queue"]) {
    say("--emit-queue writes the regression queue; it does not take --candidates");
    return EXIT.usage;
  }
  const steps = buildSteps(build);

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

  const plan = buildActionPlan(steps);
  const policy = over.policy ?? loadPolicy();
  const dry = dryRunCheck(policy, build);
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
    const r = await runBattery(selected, deps, {
      runDir,
      sittingDir,
      sandboxDir: resolve(o.sandbox),
      evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
      ph: { ...ph, sandbox: resolve(o.sandbox) },
      build: o.build ?? readCurrentBuild(DEFAULT_CENSUS_ROOT) ?? "unrecorded",
      showClosed: args.flags.has("show-closed"),
      candidates: build.candidates,
    });
    for (const l of resultTable(r.records)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w9",
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

// Census rows this file tests: the safe-toggle menu rows the module steps drive (a live result
// names each one that completes; promote.ts needs the row named here for its live test link).
// census:ui:AnimEditor/menu-item/Window/Animation Sets
// census:ui:AnimEditor/menu-item/Window/Channel Curves
// census:ui:AnimEditor/menu-item/Window/Controls
// census:ui:AnimEditor/menu-item/Window/Debug Controls
// census:ui:AnimEditor/menu-item/Window/Errors
// census:ui:AnimEditor/menu-item/Window/File Browser
// census:ui:AnimEditor/menu-item/Window/Go to.../Show Anim Sets
// census:ui:AnimEditor/menu-item/Window/Go to.../Show Controls
// census:ui:AnimEditor/menu-item/Window/Go to.../Show Debug Controls
// census:ui:AnimEditor/menu-item/Window/Go to.../Show Errors
// census:ui:AnimEditor/menu-item/Window/Go to.../Show Graph Window
// census:ui:AnimEditor/menu-item/Window/Go to.../Show Properties
// census:ui:AnimEditor/menu-item/Window/Go to.../Show Workspace
// census:ui:AnimEditor/menu-item/Window/Graph
// census:ui:AnimEditor/menu-item/Window/IkTestings Debug
// census:ui:AnimEditor/menu-item/Window/Live Debug
// census:ui:AnimEditor/menu-item/Window/Log Console
// census:ui:AnimEditor/menu-item/Window/Preview
// census:ui:AnimEditor/menu-item/Window/Properties
// census:ui:AnimEditor/menu-item/Window/Workspace
// census:ui:AudioEditor/menu-item/Window/Analyzers
// census:ui:AudioEditor/menu-item/Window/Emitter Simulation
// census:ui:AudioEditor/menu-item/Window/Item Detail
// census:ui:AudioEditor/menu-item/Window/Item Explorer
// census:ui:AudioEditor/menu-item/Window/Listener Setup
// census:ui:AudioEditor/menu-item/Window/Log Console
// census:ui:AudioEditor/menu-item/Window/Output Analyzer
// census:ui:AudioEditor/menu-item/Window/Playlist
// census:ui:AudioEditor/menu-item/Window/Resource Browser
// census:ui:AudioEditor/menu-item/Window/Signal Simulation
// census:ui:AudioEditor/menu-item/Window/Variable Simulation
// census:ui:BehaviorEditor/menu-item/Window/Breakpoints
// census:ui:BehaviorEditor/menu-item/Window/Debug
// census:ui:BehaviorEditor/menu-item/Window/Nodes palette
// census:ui:ProcAnimEditor/menu-item/Window/Item Detail
// census:ui:ProcAnimEditor/menu-item/Window/Item Explorer
// census:ui:ProcAnimEditor/menu-item/Window/Log Console
// census:ui:ProcAnimEditor/menu-item/Window/Resource Browser
// census:ui:ProcAnimEditor/menu-item/Window/View
// census:ui:ResourceManager/menu-item/Window/Log Console
// census:ui:ResourceManager/menu-item/Window/Resource Browser
// census:ui:ResourceManager/menu-item/Window/Resource Browser 2
// census:ui:ScriptEditor/menu-item/Window/Bookmarks
// census:ui:ScriptEditor/menu-item/Window/Breakpoints
// census:ui:ScriptEditor/menu-item/Window/Callstack
// census:ui:ScriptEditor/menu-item/Window/Debug
// census:ui:ScriptEditor/menu-item/Window/Errors
// census:ui:ScriptEditor/menu-item/Window/Find Entity
// census:ui:ScriptEditor/menu-item/Window/Find File
// census:ui:ScriptEditor/menu-item/Window/Find Results
// census:ui:ScriptEditor/menu-item/Window/Find Symbol
// census:ui:ScriptEditor/menu-item/Window/Outline
// census:ui:ScriptEditor/menu-item/Window/Output
// census:ui:ScriptEditor/menu-item/Window/Projects
// census:ui:ScriptEditor/menu-item/Window/Remote Console
// census:ui:ScriptEditor/menu-item/Window/Text Search
// census:ui:ScriptEditor/menu-item/Window/Watch
// census:ui:WorldEditor/menu-item/Window/Basic Tools
// census:ui:WorldEditor/menu-item/Window/Cinematic Timeline
// census:ui:WorldEditor/menu-item/Window/Current Tool
// census:ui:WorldEditor/menu-item/Window/Hierarchy
// census:ui:WorldEditor/menu-item/Window/Log Console
// census:ui:WorldEditor/menu-item/Window/Main Toolbar
// census:ui:WorldEditor/menu-item/Window/Object Properties
// census:ui:WorldEditor/menu-item/Window/Prefab Library
// census:ui:WorldEditor/menu-item/Window/Ragdoll Editor
// census:ui:WorldEditor/menu-item/Window/Resource Browser
// census:ui:WorldEditor/menu-item/Window/Resource Browser 2
// census:ui:WorldEditor/menu-item/Window/Scripted Tools
// census:ui:WorldEditor/menu-item/Window/Terrain Minimap
// DEC-095 view and selection rows (the W9.2 block), each driven row and its counterpart:
// census:ui:WorldEditor/menu-item/Entities/Select Children
// census:ui:WorldEditor/menu-item/Entities/Select Layer
// census:ui:WorldEditor/menu-item/Entities/Select Parent
// census:ui:WorldEditor/menu-item/Entities/Select Prefab Instance Members
// census:ui:WorldEditor/menu-item/Entities/Select Prefab Instance Root
// census:ui:WorldEditor/menu-item/Entities/Select Siblings
// census:ui:WorldEditor/menu-item/Entities/Focus Selection
// census:ui:ScriptEditor/menu-item/Edit/Navigate Back
// census:ui:ScriptEditor/menu-item/Edit/Navigate Forward
// census:ui:ScriptEditor/menu-item/Bookmarks/Next Bookmark
// census:ui:ScriptEditor/menu-item/Bookmarks/Previous Bookmark
