/**
 * Wave W12 (read-only observations), the live battery for three leftovers of the Phase 7 audits.
 * Built in the form of tests/live/w10.live.ts and w11.live.ts: the same CLI, gate, lane, build
 * stamp, battery snapshot and net-zero check, the same evidence and live-result lines for
 * promote.ts, the same stop rules and the window watch with W8's busy grace (WATCH_OPTIONS; the
 * menu popup pair is benign in a walk step).
 *
 * BLOCKS (every one read-only toward the user's data; nothing saves):
 *   W12.1 deny labels   (docs/v2/inbox/phase7/deny-list-proposal.md, live-safety-audit.md): the
 *         menus that should hold the deny labels no live ui row backs (Create Terrain, Pack Project,
 *         Publish Project, Login) are read by the census's own menu walker, L02
 *         (scripts/census/live/L02-menus.ts: Expand, read, Collapse; nothing is invoked), run as a
 *         child process into the run folder. Its `.obs.jsonl` lines are the census's ingest form
 *         (normalise.ts --enumerator L02), and an L02 source is what scripts/audit/live-safety.ts
 *         --strict-labels counts as live. w12-40 (block W12.4, after the other walks: the queue
 *         orders risk within a block) then matches every deny label against the lines of this
 *         sitting and writes `<sitting>/w12-deny-observations.json` (presence, exact label,
 *         path). The `:confirm` labels are never opened: they are recorded "not observable without
 *         invoking" (their dialog sits behind a denied opener).
 *   W12.2 SCR_LocLengthPlugin: W10 run 1 (EV-W10-005) answered PRECONDITION_UNMET "no string table
 *         is open in the Localization Editor" (EMCP_WB_Plugin.c TableReady(false, false): GetTable
 *         non-null with an Items array; no selection needed). The step writes a one-item table under
 *         _throwaway/W12/loc/ with the offline string_table tool's own code (in process, as W11
 *         runs its writers), registers it, opens it with `wb_localization open`, then sends the
 *         `wb_plugin run` dry run and, only when that is ok, the confirm, exactly as w10 does for a
 *         class. The handler's RunProven line for the class is false today, so the confirm is
 *         expected to answer GATED: that is NOT-RUN. Main flips the line for the proving run.
 *   W12.3 sub-editor reads (G7, G3): the one walk the gap map leaves hand-free and unrun on
 *         1.9.0.37: L02 of the Styles sub-editor (its WidgetStyle menu), with the sub-editor opened
 *         by `wb_module setResource` on a planted throwaway .styles copy. The other missing walks
 *         need a right-click, a dialog, a walker that plans no step for the module, or a policy
 *         title list: the runbook lists them as hand blocks or left out (EXCLUDED).
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch ini `<sitting>/scratch.ini` with `-scriptAuthorizeAll` (DEC-053 ruling 2), the shipped
 * bundle installed, no probe pack. This script never launches and never takes the lease. The tools
 * run IN PROCESS over a `WorkbenchClient` WITHOUT a Config; the walkers run as child processes on
 * the same lane id, with their run folders inside this battery's run folder (so inside the sitting
 * folder, never under data/census).
 *
 * DRY RUN BY DEFAULT: without --really it prints the outline and checks the ACTION PLAN with
 * checkPlan, the battery's own plan check and the queue. The runbook is
 * docs/v2/sessions/W12-runbook.md; the noise list docs/v2/sessions/queues/w12-noise.json.
 *
 * Usage:
 *   npx --no tsx tests/live/w12.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w12.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w12.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w12.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: 0 done (or dry run passed), 1 refused / plan check failed / a step FAILED, 2 usage,
 *       3 stopped, 4 aborted (not the test bed), 5 handoff (a dialog; owner hand).
 */

import { spawn } from "node:child_process";
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
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { loadConfig, type Config } from "../../src/config.js";
import { readCurrentBuild } from "../../src/gui/locators.js";
import { DEFAULT_CENSUS_ROOT } from "../../src/census/ledger-io.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runResources } from "../../src/tools/wb-resources.js";
import { runLocalization } from "../../src/tools/wb-localization.js";
import {
  loadAllowList,
  loadCatalog,
  loadRunAllowList,
  runPlugin,
} from "../../src/tools/wb-plugin.js";
import { runStringTable, type StringTableArgs } from "../../src/tools/string-table.js";
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
import { outsideArtifacts } from "../../scripts/live/session-common.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../scripts/live/s-c-natives.js";
import { WORKBENCH_EXE } from "../../scripts/live/launch.js";
import { defaultExec, processesByImage } from "../../scripts/live/win.js";
import {
  EXIT,
  StepCut,
  StopBattery,
  baselineRefusal,
  parseState,
  watched,
} from "../../scripts/census/live/common.js";
import { SCRIPT as L02_SCRIPT, l02Steps } from "../../scripts/census/live/L02-menus.js";
import { denyLabels, looseLabel } from "../../scripts/audit/live-safety.js";
import { changedFiles, recordPath } from "./w2.live.js";
import { WATCH_OPTIONS, WORKBENCH_WINDOWS, carriesForceSettings } from "./w8.live.js";
import { RUN_ANSWERS } from "./w6.live.js";
import { consoleLogOf, type LogEntry } from "./w10.live.js";
import {
  GPROJ,
  LAUNCH_ARGS,
  SCRATCH_INI,
  STOP_CODES,
  THROWAWAY,
  answerOf,
  handAnswer,
  resultTable,
  selectSteps,
  verdictOf,
} from "./w9.live.js";

export { EXIT, LAUNCH_ARGS, StopBattery, recordPath, RUN_ANSWERS, selectSteps };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W12";
export const SCRIPT_PATH = "tests/live/w12.live.ts";
export const RUNBOOK = "docs/v2/sessions/W12-runbook.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W12-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const NOISE_REL = "docs/v2/sessions/queues/w12-noise.json";
export const DENY_REL = "docs/v2/inbox/phase7/deny-list-proposal.md";
export const AUDIT_REL = "docs/v2/inbox/phase7/live-safety-audit.md";
export const GAP_REL = "docs/v2/inbox/phase6/gap-map.md";

export const GATE_STEP = "w12-00-gate";
export const WORLD_STEP = "w12-01-world";
export const WE_MENUS_STEP = "w12-10-we-menus";
export const RM_MENUS_STEP = "w12-11-rm-menus";
export const DENY_STEP = "w12-40-deny-labels";
export const LOCLENGTH_STEP = "w12-20-scr-loclengthplugin";
export const STYLES_STEP = "w12-30-styles-l02";
export const NETZERO_STEP = "w12-95-netzero";
export const CLOSABLE_STEP = "w12-99-closable";

export const W12_ROOT = `${THROWAWAY}/W12`;
export const WORLDS_DIR = `${W12_ROOT}/worlds`;
export const LOC_DIR = `${W12_ROOT}/loc`;
export const SUB_DIR = `${W12_ROOT}/subeditors`;
export const WORLD = `${WORLDS_DIR}/EMCP_W12_Tiny.ent`;
export const PLANT_DIRS: readonly string[] = [W12_ROOT, WORLDS_DIR, LOC_DIR, SUB_DIR];
export const PLANT_FILE = "plant-w12.json";
export const RESULT_FILE = "w12-result.json";
export const DENY_FILE = "w12-deny-observations.json";
export const BATTERY_SNAPSHOT_FILE = "w12-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w12-battery-snapshot";
/** Files whose change outside _throwaway/W12/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** New log lines kept in a step's evidence. */
export const LOG_KEEP = 40;

/** The throwaway string table of W12.2: written by string_table create, opened by wb_localization. */
export const LOC_ST = `${LOC_DIR}/W12_LocLength.st`;
/** One short item, so the table has an Items array (TableReady) and Run prints nothing over the limit. */
export const LOC_ITEMS: ReadonlyArray<Record<string, string>> = [
  { Id: "EMCP_W12_LOCLEN_A", Target_en_us: "W12 throwaway" },
];
export const LOC_MODULE = "LocalizationEditor";
export const LOC_CLASS = "SCR_LocLengthPlugin";
export const LOC_ROW = "plugin:SCR_LocLengthPlugin";

/** The planted Styles copy of W12.3 (W11 verified the source in the 1.9.0.37 paks). */
export const STYLES_SOURCE = "UI/Styles/editor.styles";
export const STYLES_COPY = `${SUB_DIR}/W12_editor.styles`;
export const STYLES_MODULE = "ResourceManager.Styles";
/** The menubar title the Styles tab adds (policy titles_by_module; L01 read it at 1.9.0.37). */
export const STYLES_MENU = "WidgetStyle";
/** The wait after setResource before the walk (the tab draws; rewalk-subeditors.ts OPEN_SETTLE_MS). */
export const OPEN_SETTLE_MS = 2_000;

/** The walker states (the P4-1 state for the editors; the sub-editors declare no axis). */
export const EDIT_NONE = "mode=edit,selection=none";
export const STATE_NONE = "none";

export const TIMEOUTS = {
  /** One L02 walk of a menubar (per-menu budget times titles, the child's own cap). */
  walk: 420_000,
  plugin: 180_000,
  open: 600_000,
  poll: 5_000,
  ping: 10_000,
} as const;

/**
 * Deny labels and the other spellings the census suggests for them (deny-list-proposal.md: "New
 * Terrain...", "Login/Logout", the pack dialog "PackageProjectDialog"). An exact match is what
 * live-safety.ts counts; the others need the owner's spelling ruling.
 */
export const LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Create Terrain": ["New Terrain"],
  "Pack Project": ["Package Project"],
  Login: ["Login/Logout", "Log in"],
};

/** The deny labels W12.1 looks for (no live ui row today, live-safety-audit.md). */
export const UNVERIFIED_LABELS: readonly string[] = [
  "Create Terrain",
  "Pack Project",
  "Publish Project",
  "Login",
  "Publish:confirm",
  "Login:confirm",
  "Create World:confirm",
  "Create Terrain:confirm",
  "Pack Project:confirm",
];

/** The menus W12.1 reads, per module: the census module, its state, the step that reads it. */
export const MENU_WALKS: ReadonlyArray<{ step: string; module: string; state: string; why: string }> = [
  {
    step: WE_MENUS_STEP,
    module: "WorldEditor",
    state: EDIT_NONE,
    why: "Create Terrain: the World Editor's menubar (deny-list-proposal.md observation 1)",
  },
  {
    step: RM_MENUS_STEP,
    module: "ResourceManager",
    state: EDIT_NONE,
    why: "Pack Project, Publish Project, Login: the Resource Manager's menubar, never L02-walked on 1.9.0.37 (observations 2 to 4)",
  },
];

/** Read-only walks and checks this battery leaves out, with the reason. */
export const EXCLUDED: ReadonlyArray<{ what: string; block: string; why: string }> = [
  {
    what: "the :confirm dialogs (Publish, Login, Create World, Create Terrain, Pack Project)",
    block: "W12.1",
    why: "each dialog opens only behind a denied opener (policy openers_main_never_invokes): recorded not observable without invoking; the owner-opened L04 read is deny-list-proposal.md observations 5 to 9",
  },
  {
    what: "the Resource Manager Workbench menu (E07: Publish Project, Login/Logout)",
    block: "W12.1",
    why: "the live menubar has no Workbench title (L01@1.9.0.37 reads eight titles) and policy live_lane.uia_menu.titles_by_module.ResourceManager names none, so L02 may not expand it; a title-list change is the integrator's (data/census/policy.json)",
  },
  {
    what: "the Resource Browser root-folder context menu (Pack Project)",
    block: "W12.1",
    why: "L05 needs one real right-click (P-L05-hand, DEC-090): a hand block",
  },
  {
    what: "the Terrain Tool panel toolbar (Create Terrain)",
    block: "W12.1",
    why: "the panel shows only once Tools > Terrain Tool is selected, an ExecuteAction not on execute_action.allow_list; L03 plans no tool step today",
  },
  {
    what: "L02 of the Config, Font, Material, Model and Texture sub-editors",
    block: "W12.3",
    why: "policy live_lane.uia_menu.titles_by_module has no entry for them, so L02 plans no step (main adds the titles their L01 walk shows)",
  },
  {
    what: "L02 of the Layout and Imageset sub-editors",
    block: "W12.3",
    why: "already walked on 1.9.0.37 (data/census/observations/L02/1.9.0.37.jsonl: Layout 15 lines, Imageset 9); their shortcut cells need a written reason, not a re-walk",
  },
  {
    what: "L04 (dialog and option cells of the eight sub-editors)",
    block: "W12.3",
    why: "every L04 step opens a dialog (an opener, then a Cancel or the owner's hand): a hand block",
  },
  {
    what: "L05 (context-menu and context-item cells)",
    block: "W12.3",
    why: "a real right-click per target (P-L05-hand, DEC-090): a hand block",
  },
  {
    what: "L06 (property and property-group cells)",
    block: "W12.3",
    why: "L06-grids.ts plans steps for the World Editor only; a sub-editor walk needs a walker change first",
  },
  {
    what: "the G3 frontier tabs, panels and property groups of the eight sub-editors",
    block: "W12.3",
    why: "their children show only once each tab is selected (a click on the tab bar); no walker selects a tab",
  },
];

export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W12.1", "W12.2", "W12.3", "W12.4"]);

// ── Types ────────────────────────────────────────────────────────────────────

export type W12Tool = "wb_plugin" | "wb_module" | "wb_world" | "wb_resources" | "wb_localization";
export type OfflineTool = "string_table";
export type Block = "W12.0" | "W12.1" | "W12.2" | "W12.3" | "W12.4" | "W12.9";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED";
export type Oracle = "state-readback" | "log-line" | "returned-true-only";

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

/** One walker run a step makes (a child process of the walker's own CLI). */
export interface WalkSpec {
  walker: "L02";
  module: string;
  /** `--state` as the walker CLI takes it. */
  state: string;
}

export interface W12Deps {
  tool: (name: W12Tool, args: Raw) => Promise<ToolResponse>;
  offline: (name: OfflineTool, args: Raw) => Promise<ToolResponse>;
  /** Run a walker's CLI as a child process (repo-relative script); its exit code. */
  walk: (script: string, argv: string[]) => Promise<number>;
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

export interface W12Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** The lane the walkers get (`--id`, `--lease-path`, `--marker-path`). */
  lane: { id: string; leasePath?: string; markerPath?: string };
  port: number;
}

export interface StepContext {
  deps: W12Deps;
  opts: W12Options;
  calls: Array<Record<string, unknown>>;
  tool: (name: W12Tool, args: Raw, o?: { tolerate?: boolean }) => Promise<ToolResponse>;
  offline: (name: OfflineTool, args: Raw) => Promise<ToolResponse>;
  walk: (spec: WalkSpec, stepId: string) => Promise<WalkResult>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

export interface OfflineCall {
  tool: OfflineTool;
  params: Raw;
  note?: string;
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
  /** The census rows a PASS names (promote.ts links each to this file). */
  rows: string[];
  expectsWindows?: readonly RegExp[];
  /** A walk step: the menu popup pair is benign under the battery's window watch. */
  popups?: boolean;
  plan: () => PlanAction[];
  offlineCalls: () => OfflineCall[];
  walks: () => WalkSpec[];
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

function readJson<T>(path: string, deps: Pick<W12Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W12Deps, "writeBytes">): void {
  deps.writeBytes(path, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8"));
}

/** True when `rel` is `dir` itself or lies under it (forward slashes, case-insensitive). */
export function under(rel: string, dir: string): boolean {
  const r = rel.replace(/\\/g, "/").toLowerCase();
  const d = dir.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  return r === d || r.startsWith(`${d}/`);
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

export const ROUTE_OF: Readonly<Record<W12Tool, string>> = {
  wb_plugin: "EMCP_WB_Plugin",
  wb_module: "EMCP_WB_Module",
  wb_world: "EMCP_WB_World",
  wb_resources: "EMCP_WB_Resources",
  wb_localization: "EMCP_WB_Localization",
};

export function tc(tool: W12Tool, action: string, params: Raw = {}, note?: string): PlanAction {
  return {
    kind: "net-call",
    target: ROUTE_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: action,
    note: note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

/** The tool actions the battery may send. Nothing saves, closes, sets or edits a document. */
export const ACTIONS_ALLOWED: Readonly<Record<W12Tool, ReadonlySet<string>>> = {
  wb_plugin: new Set(["run"]),
  wb_module: new Set(["open", "front", "setResource"]),
  wb_world: new Set(["state", "new", "register"]),
  wb_resources: new Set(["register"]),
  wb_localization: new Set(["status", "open"]),
};

/** The only class W12 runs, and the modules its walks may read. */
export const PLUGIN_RUNS: ReadonlySet<string> = new Set([`${LOC_MODULE}\u0000${LOC_CLASS}`]);
export const WALK_MODULES: ReadonlySet<string> = new Set([
  ...MENU_WALKS.map((w) => w.module),
  STYLES_MODULE,
]);

/** The walker's plan of one walk (L02's own step plans), so checkPlan sees every uia-menu. */
export function walkPlan(w: WalkSpec): PlanAction[] {
  const state = parseState(w.state);
  if (typeof state === "string") throw new Error(state);
  return l02Steps({ module: w.module, state }).flatMap((s) =>
    s.plan({ module: w.module, state, allowOwned: false }),
  );
}

/**
 * The battery's own gate over the plan, beside checkPlan: only the allowed actions; every target
 * and file write under _throwaway/W12/; the one plugin class; uia-menu only on the W12 modules and
 * only Expand and Collapse; the offline writer only string_table create under _throwaway/W12/.
 */
export function w12PlanViolations(steps: readonly StepDef[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    s.plan().forEach((a, i) => {
      const where = `${s.id} action ${i}`;
      if (a.kind === "uia-menu") {
        const m = S((a as unknown as Raw).module);
        if (!WALK_MODULES.has(m)) out.push(`${where}: uia-menu on ${m || "no module"} is not a W12 walk`);
        const calls = ((a as unknown as Raw).calls ?? []) as unknown[];
        if (calls.some((c) => c !== "Expand" && c !== "Collapse"))
          out.push(`${where}: uia-menu sends more than Expand and Collapse`);
        return;
      }
      if (a.kind !== "net-call" || typeof a.tool !== "string") return;
      const tool = a.tool as W12Tool;
      const p = (a.params ?? {}) as Raw;
      const at = `${where} (${tool}.${S(a.toolAction)})`;
      const allowed = ACTIONS_ALLOWED[tool];
      if (!allowed) {
        out.push(`${at}: ${tool} is not a W12 tool`);
        return;
      }
      if (!allowed.has(S(a.toolAction))) out.push(`${at}: not an allowed ${tool} action`);
      for (const k of ["path", "target"]) {
        const v = S(p[k]);
        if (!v || v.startsWith("<")) continue;
        if (k === "target" && !v.startsWith("path:")) continue;
        const rel = v.replace(/^path:/, "");
        if (!under(rel, W12_ROOT)) out.push(`${at}: ${k} ${v} is outside ${W12_ROOT}/`);
      }
      if (tool === "wb_plugin" && !PLUGIN_RUNS.has(`${S(p.moduleName)}\u0000${S(p.className)}`))
        out.push(`${at}: ${S(p.moduleName)} ${S(p.className)} is not the W12 class`);
      if (truthy(p.buildRuntime)) out.push(`${at}: register builds no runtime resource here`);
    });
    s.offlineCalls().forEach((c, i) => {
      const where = `${s.id} offline ${i} (${c.tool})`;
      if (c.tool !== "string_table" || S(c.params.action) !== "create")
        out.push(`${where}: only string_table create is a W12 writer`);
      if (!under(S(c.params.path), W12_ROOT)) out.push(`${where}: path ${S(c.params.path)} is outside ${W12_ROOT}/`);
      if (truthy(c.params.overwrite)) out.push(`${where}: overwrite replaces a table`);
    });
    for (const w of s.walks())
      if (!WALK_MODULES.has(w.module)) out.push(`${s.id} walk ${w.walker} ${w.module}: not a W12 walk`);
  }
  return out;
}

// ── Walks ────────────────────────────────────────────────────────────────────

export interface WalkResult {
  spec: WalkSpec;
  runDir: string;
  exit: number | null;
  command: string;
  refusal?: string;
  /** The observation lines the walker wrote (every `.obs.jsonl` of its run folder). */
  lines: Raw[];
  obsFiles: string[];
}

const EXIT_NAME: Record<number, string> = {
  0: "done",
  1: "refused",
  2: "usage",
  3: "stopped",
  4: "aborted",
  5: "handoff",
};

/** The walk's run folder: inside the battery's run folder, so inside the sitting folder. */
export function walkDirOf(runDir: string, stepId: string, w: WalkSpec): string {
  return join(runDir, "walks", `${stepId}-${w.walker}-${w.module}`);
}

/** The walker CLI arguments of one walk (`--from` its first planned step), or why there are none. */
export function walkArgv(
  w: WalkSpec,
  o: { lane: W12Options["lane"]; sandbox: string; runDir: string; build: string; port: number; evidenceDir: string | null },
): { script: string; argv: string[] } | { refusal: string } {
  const state = parseState(w.state);
  if (typeof state === "string") return { refusal: state };
  const steps = l02Steps({ module: w.module, state });
  if (!steps.length) return { refusal: `${w.walker} plans no step for ${w.module}` };
  const argv = [
    "--really",
    "--id",
    o.lane.id,
    ...(o.lane.leasePath ? ["--lease-path", o.lane.leasePath] : []),
    ...(o.lane.markerPath ? ["--marker-path", o.lane.markerPath] : []),
    "--sandbox",
    o.sandbox,
    "--run-dir",
    o.runDir,
    "--module",
    w.module,
    "--state",
    w.state,
    "--build",
    o.build,
    "--session",
    SESSION,
    "--port",
    String(o.port),
    ...(o.evidenceDir ? ["--evidence-dir", o.evidenceDir] : []),
    "--from",
    steps[0]!.id,
  ];
  return { script: L02_SCRIPT, argv };
}

export function commandLine(script: string, argv: string[]): string {
  return `npx --no tsx ${script} ${argv.map((a) => (/[\s{"]/.test(a) ? `'${a}'` : a)).join(" ")}`;
}

/** Every observation line under `dir` (its `.obs.jsonl` files), with the files read. */
export function obsLinesUnder(
  dir: string,
  deps: Pick<W12Deps, "listTree" | "readBytes">,
): { lines: Raw[]; files: string[] } {
  const files = deps.listTree(dir).filter((f) => f.endsWith(".obs.jsonl"));
  const lines: Raw[] = [];
  for (const f of files)
    for (const l of deps.readBytes(join(dir, ...f.split("/"))).toString("utf-8").split("\n")) {
      if (!l.trim()) continue;
      try {
        lines.push(JSON.parse(l) as Raw);
      } catch {
        // A line that does not parse is not an observation (the walker validates what it writes).
      }
    }
  return { lines, files };
}

async function runWalk(
  deps: W12Deps,
  opts: W12Options,
  spec: WalkSpec,
  stepId: string,
): Promise<WalkResult> {
  const runDir = walkDirOf(opts.runDir, stepId, spec);
  const a = walkArgv(spec, {
    lane: opts.lane,
    sandbox: opts.sandboxDir,
    runDir,
    build: opts.build,
    port: opts.port,
    evidenceDir: opts.evidenceDir,
  });
  if ("refusal" in a)
    return { spec, runDir, exit: null, command: "", refusal: a.refusal, lines: [], obsFiles: [] };
  const exit = await deps.walk(a.script, a.argv);
  const obs = obsLinesUnder(runDir, deps);
  return {
    spec,
    runDir,
    exit,
    command: toPlaceholders(commandLine(a.script, a.argv), opts.ph),
    lines: obs.lines,
    obsFiles: obs.files,
  };
}

/** A walk's exit as the step's verdict: a handoff or an abort stops the battery (nothing more is sent). */
function walkVerdict(w: WalkResult, fails: string[]): void {
  if (w.refusal) {
    fails.push(`${w.spec.module}: ${w.refusal}`);
    return;
  }
  if (w.exit === EXIT.handoff || w.exit === EXIT.aborted)
    throw new StopBattery(
      w.exit === EXIT.handoff ? "handoff" : "aborted",
      `${w.spec.walker} ${w.spec.module} ended in ${EXIT_NAME[w.exit]} (exit ${w.exit}): a popup or dialog may be up, or another project; nothing more is sent`,
      { walk: { runDir: w.runDir, exit: w.exit } },
    );
  if (w.exit !== EXIT.done)
    fails.push(`${w.spec.walker} ${w.spec.module} exit ${w.exit} (${EXIT_NAME[w.exit ?? -1] ?? "?"})`);
  else if (!w.lines.length) fails.push(`${w.spec.walker} ${w.spec.module} wrote no observation line`);
}

/** What a walker's `*-menus.json` says about one title: on the menubar, opened, popups seen. */
export interface MenuRead {
  menusFile: string | null;
  titleOnMenubar: boolean;
  opened: boolean | null;
  popups: number | null;
  walkerSummary: string | null;
}

/** Reads the walker's menus and step-record files in `runDir` for `title` (no file: all unknown). */
export function menuReadOf(
  runDir: string,
  title: string,
  deps: Pick<W12Deps, "listTree" | "readBytes">,
): MenuRead {
  const out: MenuRead = { menusFile: null, titleOnMenubar: false, opened: null, popups: null, walkerSummary: null };
  const files = deps.listTree(runDir);
  const parse = (f: string): Raw | null => {
    try {
      return JSON.parse(deps.readBytes(join(runDir, ...f.split("/"))).toString("utf-8")) as Raw;
    } catch {
      return null;
    }
  };
  for (const f of files.filter((x) => x.endsWith("-menus.json"))) {
    const j = parse(f);
    if (!j) continue;
    const titles = Array.isArray(j.menu_bar_titles) ? (j.menu_bar_titles as unknown[]) : [];
    const m = (Array.isArray(j.menus) ? (j.menus as Raw[]) : []).find((x) => x.title === title);
    if (!m && !titles.includes(title)) continue;
    out.menusFile = f;
    out.titleOnMenubar = titles.includes(title);
    if (m) {
      out.opened = m.opened === true;
      const c = (m.popup as Raw | undefined)?.count;
      out.popups = typeof c === "number" ? c : null;
    }
    const rec = parse(f.replace(/-menus\.json$/, ".json"));
    if (rec && typeof rec.summary === "string") out.walkerSummary = rec.summary;
    break;
  }
  if (!out.menusFile) {
    const any = files.find((x) => x.endsWith("-menus.json"));
    if (any) out.menusFile = any;
  }
  return out;
}

function walkEvidence(w: WalkResult): Raw {
  return {
    module: w.spec.module,
    state: w.spec.state,
    runDir: w.runDir,
    command: w.command,
    exit: w.exit,
    exitName: w.exit === null ? null : (EXIT_NAME[w.exit] ?? String(w.exit)),
    obsFiles: w.obsFiles,
    lines: w.lines.length,
    ...(w.refusal ? { refusal: w.refusal } : {}),
  };
}

// ── W12.1 deny labels ────────────────────────────────────────────────────────

export type MatchKind = "exact" | "loose" | "variant" | "alias";

export interface LabelHit {
  module: string;
  kind: string;
  path: string[];
  labelRaw: string;
  match: MatchKind;
  file: string;
}

export interface LabelObservation {
  list: string;
  label: string;
  status: "present" | "present-other-spelling" | "absent-in-menus-read" | "not-observable-without-invoking";
  /** True when an exact hit exists: what live-safety.ts --strict-labels counts once ingested. */
  countsForStrictLabels: boolean;
  hits: LabelHit[];
  note: string;
}

/** How a ui line's raw label matches a deny label, or null. */
export function matchLabel(deny: string, labelRaw: string): MatchKind | null {
  if (labelRaw === deny) return "exact";
  const d = looseLabel(deny);
  const l = looseLabel(labelRaw);
  if (l === d) return "loose";
  if (l.startsWith(`${d}/`) || l.startsWith(`${d} `)) return "variant";
  if ((LABEL_ALIASES[deny] ?? []).some((a) => l === looseLabel(a) || l.startsWith(`${looseLabel(a)} `)))
    return "alias";
  return null;
}

/** Every deny label of the policy against the lines read this sitting. */
export function denyObservations(
  policy: unknown,
  lines: ReadonlyArray<{ line: Raw; file: string }>,
  menusRead: readonly string[],
): LabelObservation[] {
  return denyLabels(policy).map(({ list, label }) => {
    if (label.endsWith(":confirm"))
      return {
        list,
        label,
        status: "not-observable-without-invoking",
        countsForStrictLabels: false,
        hits: [],
        note: `the confirm control of the ${label.replace(/:confirm$/, "")} dialog: its opener is denied, so no tool opens it; not opened (deny-list-proposal.md observations 5 to 9 are the owner-opened reads)`,
      } satisfies LabelObservation;
    const hits: LabelHit[] = [];
    for (const { line, file } of lines) {
      if (line.dim !== "ui" || typeof line.label_raw !== "string") continue;
      const m = matchLabel(label, line.label_raw);
      if (!m) continue;
      const key = (line.key ?? {}) as Raw;
      hits.push({
        module: S(line.module),
        kind: S(line.kind),
        path: Array.isArray(key.path) ? (key.path as unknown[]).map(S) : [S(key.object_name)],
        labelRaw: line.label_raw,
        match: m,
        file,
      });
    }
    const exact = hits.some((h) => h.match === "exact");
    return {
      list,
      label,
      status: exact ? "present" : hits.length ? "present-other-spelling" : "absent-in-menus-read",
      countsForStrictLabels: exact,
      hits,
      note: exact
        ? "an L02 line at this build carries the exact label: live once normalise.ts ingests it"
        : hits.length
          ? "read under another spelling: the owner rules the label's spelling (deny-list-proposal.md, sign-off 2 and 3)"
          : `no item with this label in the menus read (${menusRead.join("; ") || "none"}, depth 1)`,
    };
  });
}

/** The W12.1 walk lines of this sitting: every walk folder of the menu steps, in every run folder. */
export function denyWalkLines(
  sittingDir: string,
  deps: Pick<W12Deps, "listTree" | "readBytes">,
): { lines: Array<{ line: Raw; file: string }>; files: string[] } {
  const steps = MENU_WALKS.map((w) => w.step);
  const files = deps
    .listTree(sittingDir)
    .filter((f) => f.endsWith(".obs.jsonl"))
    .filter((f) => {
      const parts = f.split("/");
      const i = parts.indexOf("walks");
      return i >= 0 && steps.some((s) => (parts[i + 1] ?? "").startsWith(`${s}-`));
    });
  const lines: Array<{ line: Raw; file: string }> = [];
  for (const f of files)
    for (const l of deps.readBytes(join(sittingDir, ...f.split("/"))).toString("utf-8").split("\n")) {
      if (!l.trim()) continue;
      try {
        lines.push({ line: JSON.parse(l) as Raw, file: f });
      } catch {
        // not an observation line
      }
    }
  return { lines, files };
}

function menuStepDef(w: (typeof MENU_WALKS)[number]): StepDef {
  const spec: WalkSpec = { walker: "L02", module: w.module, state: w.state };
  return {
    id: w.step,
    block: "W12.1",
    title: `${w.module} menubar: L02 walk (Expand, read items and sub-menus at depth 1, Collapse; nothing invoked) for ${w.why}`,
    risk: "reversible",
    timeout_ms: TIMEOUTS.walk,
    expected:
      "the walker exits 0, every title opened and collapsed, its obs lines written in the run folder",
    kill_criterion:
      "a popup left open, a dialog or a new window: HANDOFF (the owner presses Esc once); a walker that exits 1 or 3: FAIL",
    side_effects: [
      `${w.module} fronted; its menus expanded and collapsed`,
      "the walker's obs, record and menus files under <run>/walks/",
    ],
    rollback: "Collapse by the walker itself; a popup left open: the owner presses Esc once, by hand",
    writes: [],
    rows: [],
    expectsWindows: WORKBENCH_WINDOWS,
    popups: true,
    plan: () => [
      ...(w.module === "WorldEditor" ? worldPlan() : [tc("wb_module", "open", { module: w.module })]),
      ...walkPlan(spec),
    ],
    offlineCalls: () => [],
    walks: () => [spec],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (w.module === "WorldEditor") {
        if (!(await ensureWorld(ctx, evidence, fails)))
          return { status: "FAIL", detail: `the W12 world did not open: ${fails.join("; ")}`, evidence };
      } else evidence.open = brief(await ctx.tool("wb_module", { action: "open", module: w.module }));
      const r = await ctx.walk(spec, w.step);
      evidence.walk = walkEvidence(r);
      walkVerdict(r, fails);
      return {
        ...verdictOf(fails, `${w.module}: ${r.lines.length} L02 line(s) in ${r.obsFiles.join(", ")}`),
        evidence,
      };
    },
  };
}

function denyStepDef(): StepDef {
  return {
    id: DENY_STEP,
    block: "W12.4",
    title: `the deny labels against this sitting's menu walks: presence, exact label and path per label into <sitting>/${DENY_FILE}; :confirm labels recorded not observable without invoking`,
    risk: "read-only",
    timeout_ms: 30_000,
    expected:
      "both menu walks have lines; every deny label is recorded present, present under another spelling, absent, or not observable",
    kill_criterion: "a menu walk with no lines in this sitting: FAIL (run its step again in a new run folder)",
    side_effects: [`<sitting>/${DENY_FILE} written`],
    rollback: "none (a file in the sitting folder)",
    writes: [],
    rows: [],
    plan: () => [],
    offlineCalls: () => [],
    walks: () => [],
    run: async (ctx) => {
      const { lines, files } = denyWalkLines(ctx.opts.sittingDir, ctx.deps);
      const read = MENU_WALKS.filter((w) => lines.some(({ line }) => line.module === w.module));
      const missing = MENU_WALKS.filter((w) => !read.includes(w)).map((w) => w.module);
      const obs = denyObservations(
        loadPolicy(),
        lines,
        read.map((w) => `${w.module} menubar`),
      );
      const focus = obs.filter((o) => UNVERIFIED_LABELS.includes(o.label));
      const value = {
        session: SESSION,
        script: SCRIPT_PATH,
        build: ctx.opts.build,
        enumerator: "L02",
        sources: files,
        menusRead: read.map((w) => w.module),
        menusMissing: missing,
        ingest:
          "the L02 obs files under <run>/walks/ are the census's ingest form: normalise.ts --enumerator L02 --build <build> <walk run dirs>, then build.ts; an exact hit then counts in live-safety.ts --strict-labels",
        labels: obs,
      };
      writeJson(
        join(ctx.opts.sittingDir, DENY_FILE),
        JSON.parse(toPlaceholders(JSON.stringify(value), ctx.opts.ph)),
        ctx.deps,
      );
      const evidence: Raw = {
        file: DENY_FILE,
        sources: files,
        menusRead: value.menusRead,
        unverified: focus.map((o) => ({
          label: o.label,
          status: o.status,
          hits: o.hits.map((h) => `${h.module} ${h.path.join(" > ")} (${h.match})`),
        })),
      };
      const fails = missing.map((m) => `no ${m} menu walk lines in this sitting`);
      return {
        ...verdictOf(
          fails,
          focus.map((o) => `${o.label}: ${o.status}`).join("; "),
        ),
        evidence,
      };
    },
  };
}

// ── W12.0 world (the World Editor walk needs a world in edit mode) ───────────

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

/** The W12 world on disk and registered (`wb_world new` when absent), then open (w10's route). */
export async function ensureWorld(ctx: StepContext, evidence: Raw, fails: string[]): Promise<boolean> {
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
  const reg = await ctx.tool("wb_world", { action: "register", path: WORLD, confirm: true });
  evidence.register = brief(reg);
  if (!reg.ok) {
    fails.push(`register: ${why(reg)}`);
    return false;
  }
  const o = await openWorld(ctx, WORLD);
  evidence.open = o.evidence;
  if (!o.ok) fails.push(`the W12 world did not open ('${o.worldPath}')`);
  return o.ok;
}

function worldPlan(): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc("wb_world", "new", { path: WORLD, confirm: true }, "writes the throwaway world, when absent"),
    tc("wb_world", "register", { path: WORLD, confirm: true }),
    tc("wb_module", "open", { module: "WorldEditor" }),
    tc("wb_module", "setResource", { module: "WorldEditor", target: `path:${WORLD}` }),
    tc("wb_world", "state", {}, "polled until worldPath names the world"),
  ];
}

// ── Snapshot and net-zero ────────────────────────────────────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W12/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W12Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W12_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W12Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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
  deps: Pick<W12Deps, "exists" | "readBytes" | "listTree">,
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

export function liveResultLine(stepId: string, rowId: string, oracle: Oracle, date: string): Raw {
  return { live_result: { test: stepId, rows: [rowId], verdict: "pass", oracle, date } };
}

export function liveTestLine(stepId: string, rowId: string): Raw {
  return { id: rowId, tests: [{ id: stepId, file: SCRIPT_PATH, kind: "live" }] };
}

export function liveFileOf(stepId: string): string {
  return `w12-live-${stepId}.jsonl`;
}

// ── W12.2 SCR_LocLengthPlugin ────────────────────────────────────────────────

export interface LocLengthResult {
  table: string;
  opened: boolean;
  dry: string;
  confirm: string;
  ran: boolean;
  dialog: string | null;
  logBefore: number | null;
  logNew: number | null;
  netZero: { changed: string[]; tolerated: string[] } | null;
  verdict: "PASS" | "NOT-RUN" | "FAIL";
  oracle: Oracle | null;
  why: string;
}

/**
 * The plant (string_table create, register, wb_localization open), then w10's run of one class:
 * the log position, the dry run, the confirm only when the dry run is ok, the dialog check, the new
 * log lines, the net-zero check, the live result on `ran` only.
 */
export async function locLengthStep(ctx: StepContext, stepId: string): Promise<StepOutcome> {
  const fails: string[] = [];
  const evidence: Raw = { className: LOC_CLASS, module: LOC_MODULE, row: LOC_ROW, table: LOC_ST };
  const res: LocLengthResult = {
    table: LOC_ST,
    opened: false,
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
    const diff = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
    res.netZero = diff ? { changed: diff.changed, tolerated: diff.tolerated } : null;
    if (!diff) fails.push(`no ${BATTERY_SNAPSHOT_FILE}`);
    else if (diff.changed.length) fails.push(`changed outside ${W12_ROOT}/: ${diff.changed.join(", ")}`);
    if (res.verdict === "FAIL") fails.push(`${LOC_CLASS}: ${res.why}`);
    if (res.ran && res.verdict !== "FAIL" && !fails.length) {
      res.verdict = "PASS";
      res.oracle = res.logNew ? "log-line" : "returned-true-only";
      res.why = `ran, no dialog, the sandbox unchanged; oracle ${res.oracle}${res.logNew ? ` (${res.logNew} new log line(s))` : ""}`;
      const date = new Date(ctx.deps.now()).toISOString().slice(0, 10);
      lines.push(liveTestLine(stepId, LOC_ROW), liveResultLine(stepId, LOC_ROW, res.oracle, date));
    }
    evidence.result = res;
    const status: Verdict = fails.length ? "FAIL" : res.verdict === "PASS" ? "PASS" : "NOT-RUN";
    return {
      status,
      detail: fails.length ? fails.join("; ") : `${LOC_CLASS}: ${res.verdict}, ${res.why}`,
      evidence,
      results: { file: liveFileOf(stepId), lines },
    };
  };

  // The plant: the table, by the offline tool's own code (kept from an earlier run folder).
  const stAbs = abs(ctx.opts.sandboxDir, LOC_ST);
  if (!ctx.deps.exists(stAbs)) {
    const made = await ctx.offline("string_table", {
      action: "create",
      path: LOC_ST,
      items: LOC_ITEMS,
      confirm: true,
    });
    evidence.create = brief(made);
    if (!made.ok || !ctx.deps.exists(stAbs)) {
      res.verdict = "FAIL";
      res.why = `the plant failed: string_table create answered ${answerOf(made)} ${S(made.message).slice(0, 300)}`.trim();
      return done();
    }
  } else evidence.create = "already on disk (an earlier run folder of the sitting)";
  const reg = await ctx.tool("wb_resources", { action: "register", path: LOC_ST, confirm: true });
  evidence.register = brief(reg);
  evidence.moduleOpen = brief(await ctx.tool("wb_module", { action: "open", module: LOC_MODULE }));
  evidence.front = brief(await ctx.tool("wb_module", { action: "front", module: LOC_MODULE }));
  const st0 = await ctx.tool("wb_localization", { action: "status" });
  evidence.statusBefore = brief(st0);
  const mine = (r: ToolResponse): boolean =>
    r.ok && S(rb(r).table).replace(/\\/g, "/").toLowerCase().endsWith(LOC_ST.toLowerCase());
  if (!mine(st0)) {
    const o = await ctx.tool("wb_localization", { action: "open", path: LOC_ST });
    evidence.open = brief(o);
    if (!o.ok || rb(o).opened !== true) {
      res.verdict = "FAIL";
      res.why = `the plant did not open (wb_localization open answered ${answerOf(o)}${o.ok ? ", opened false" : ` ${S(o.message).slice(0, 300)}`}): TableReady stays unmet`;
      return done();
    }
  }
  const st1 = await ctx.tool("wb_localization", { action: "status" });
  evidence.status = brief(st1);
  res.opened = mine(st1) && Number(rb(st1).total) >= 1;
  if (!res.opened) {
    res.verdict = "FAIL";
    res.why = `wb_localization status does not name ${LOC_ST} with an item (table '${S(rb(st1).table)}', total ${S(rb(st1).total)})`;
    return done();
  }

  const before = ctx.deps.logLines();
  res.logBefore = before ? before.length : null;
  const base = { action: "run", moduleName: LOC_MODULE, className: LOC_CLASS };
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
      if (RUN_ANSWERS.has(S(conf.code)))
        res.why =
          conf.code === "GATED"
            ? "the dry run is ok (TableReady met); the confirm answered GATED: the handler's RunProven line is false until main flips it for the proving run: not run"
            : `the confirm answered ${S(conf.code)}: not run`;
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
    if (res.dialog) throw new StopBattery("handoff", `${LOC_CLASS}: ${res.dialog}`, evidence);
  }
  if (res.ran && before) {
    const after = ctx.deps.logLines();
    const fresh = after ? after.slice(before.length) : [];
    res.logNew = after ? fresh.length : null;
    evidence.logLines = fresh.slice(0, LOG_KEEP).map((l) => l.raw);
  }
  return done();
}

function locLengthPlan(): PlanAction[] {
  const run = { moduleName: LOC_MODULE, className: LOC_CLASS };
  return [
    tc("wb_resources", "register", { path: LOC_ST, confirm: true }, "the .meta of the planted table"),
    tc("wb_module", "open", { module: LOC_MODULE }),
    tc("wb_module", "front", { module: LOC_MODULE }),
    tc("wb_localization", "status"),
    tc("wb_localization", "open", { path: LOC_ST }, "only when status does not name the table"),
    tc("wb_localization", "status", {}, "the table and its item count read back"),
    tc("wb_plugin", "run", run, "dry run: preconditions only (TableReady)"),
    tc(
      "wb_plugin",
      "run",
      { ...run, confirm: true },
      "only when the dry run answered ok; GATED until the handler's RunProven line is flipped by main",
    ),
  ];
}

function locLengthStepDef(): StepDef {
  return {
    id: LOCLENGTH_STEP,
    block: "W12.2",
    title: `${LOC_MODULE} ${LOC_CLASS}: plant ${LOC_ST} (string_table create, register, wb_localization open), then wb_plugin run (dry run, confirm when met), dialog check, new log lines, sandbox net-zero`,
    risk: "reversible",
    timeout_ms: TIMEOUTS.plugin,
    expected: `the dry run answers ok (a table with an Items array is open); the confirm answers GATED while RunProven is false (NOT-RUN), or ok with ran once main flips it (a live result naming ${LOC_ROW})`,
    kill_criterion:
      "the plant not written or not open, PLUGIN_MODAL or an unexpected code: FAIL; a change outside the throwaway folder: FAIL, no live result; a dialog: HANDOFF; GATED / PRECONDITION_UNMET and the other run answers: NOT-RUN",
    side_effects: [
      `${LOC_ST} written by string_table create and its .meta by register`,
      "the String Editor opened and fronted with the table loaded (unedited, never saved)",
      "log lines printed by the plugin, when it runs",
    ],
    rollback: "`w12.live.ts rollback` removes _throwaway/W12/ after Workbench is closed; the table is never edited",
    writes: [LOC_ST],
    rows: [LOC_ROW],
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => locLengthPlan(),
    offlineCalls: () => [
      {
        tool: "string_table",
        params: { action: "create", path: LOC_ST, items: LOC_ITEMS, confirm: true },
        note: "only when the table is absent",
      },
    ],
    walks: () => [],
    run: async (ctx) => locLengthStep(ctx, LOCLENGTH_STEP),
  };
}

// ── W12.3 the Styles sub-editor L02 walk ─────────────────────────────────────

function stylesStepDef(): StepDef {
  const spec: WalkSpec = { walker: "L02", module: STYLES_MODULE, state: STATE_NONE };
  return {
    id: STYLES_STEP,
    block: "W12.3",
    title: `${STYLES_MODULE}: register and open the planted ${STYLES_COPY} (wb_module setResource), then the L02 walk of its WidgetStyle menu (G3 frontier menu/WidgetStyle; G7 Styles menu-item, shortcut)`,
    risk: "reversible",
    timeout_ms: TIMEOUTS.walk,
    expected:
      "setResource answers ok, the walker exits 0 and writes the WidgetStyle menu and its item lines in the run folder",
    kill_criterion:
      "the copy absent: NOT-RUN; the WidgetStyle title on the menubar but its popup not opening on Expand (W12 run 1: popups 0, no item read): NOT-RUN, the menu unread; setResource refused, the walker exits 1 or 3, or no WidgetStyle title on the menubar: FAIL; a popup left open or a dialog: HANDOFF",
    side_effects: [
      `${STYLES_COPY}.meta written by register`,
      "a Styles tab opened in the Resource Manager (unedited, never saved, left open)",
      "the walker's obs, record and menus files under <run>/walks/",
    ],
    rollback: "`w12.live.ts rollback` removes _throwaway/W12/ after Workbench is closed",
    writes: [],
    rows: [],
    expectsWindows: WORKBENCH_WINDOWS,
    popups: true,
    plan: () => [
      tc("wb_resources", "register", { path: STYLES_COPY, confirm: true }),
      tc("wb_module", "open", { module: "ResourceManager" }),
      tc("wb_module", "setResource", { module: "ResourceManager", target: `path:${STYLES_COPY}` }),
      ...walkPlan(spec),
    ],
    offlineCalls: () => [],
    walks: () => [spec],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, STYLES_COPY)))
        return {
          status: "NOT-RUN",
          detail: `${STYLES_COPY} is absent: run \`w12.live.ts plant\` first`,
          evidence,
        };
      evidence.register = brief(
        await ctx.tool("wb_resources", { action: "register", path: STYLES_COPY, confirm: true }),
      );
      evidence.open = brief(await ctx.tool("wb_module", { action: "open", module: "ResourceManager" }));
      const set = await ctx.tool("wb_module", {
        action: "setResource",
        module: "ResourceManager",
        target: `path:${STYLES_COPY}`,
      });
      evidence.setResource = brief(set);
      if (!set.ok)
        return { status: "FAIL", detail: `setResource refused: ${why(set)}`, evidence };
      await ctx.sleep(OPEN_SETTLE_MS);
      const r = await ctx.walk(spec, STYLES_STEP);
      evidence.walk = walkEvidence(r);
      walkVerdict(r, fails);
      if (r.exit === EXIT.done && !r.lines.length && !r.refusal) {
        // W12 run 1: the walker exited 0 with no obs file. Its menus file is the only record of why.
        const read = menuReadOf(r.runDir, STYLES_MENU, ctx.deps);
        evidence.menuRead = read;
        if (read.titleOnMenubar && read.opened === false && read.popups === 0)
          return {
            status: "NOT-RUN",
            detail: `${STYLES_MODULE}: the ${STYLES_MENU} title is on the Resource Manager menubar (the Styles tab opened), but Expand opened no popup (popups 0), so L02 read no item and wrote no observation line. Not settled offline: whether the menu is empty or disabled until a style is selected (Qt opens no popup for an empty or disabled menu); the G3 row menu/${STYLES_MENU} and the G7 Styles menu-item and shortcut cells stay unread`,
            evidence,
          };
        if (read.menusFile && !read.titleOnMenubar)
          fails.splice(0, fails.length, `${STYLES_MODULE}: no ${STYLES_MENU} title on the menubar the walker read: setResource did not bring a Styles tab to the front`);
      }
      const menu = r.lines.some(
        (l) => l.kind === "menu" && JSON.stringify((l.key as Raw | undefined)?.path) === `["${STYLES_MENU}"]`,
      );
      evidence.widgetStyleMenu = menu;
      if (!fails.length && !menu) fails.push("no WidgetStyle menu line was written");
      const items = r.lines.filter((l) => l.kind === "menu-item").length;
      const shortcuts = r.lines.filter((l) => typeof l.shortcut_default === "string").length;
      evidence.items = items;
      evidence.shortcuts = shortcuts;
      return {
        ...verdictOf(
          fails,
          `${STYLES_MODULE}: WidgetStyle read, ${items} menu-item line(s), ${shortcuts} with a shortcut`,
        ),
        evidence,
      };
    },
  };
}

// ── Gate, net-zero, closable ─────────────────────────────────────────────────

/** The test-bed gate: throws StopBattery on any miss. */
async function testBedGate(ctx: StepContext): Promise<StepOutcome> {
  const info = await ctx.deps.info();
  const projectName = info ? info.projectName : undefined;
  const evidence: Raw = { projectFound: info?.projectFound ?? null, projectName: projectName ?? null };
  // The test-bed check lives here, in the battery, never in a shipped handler (DEC-058).
  if (!truthy(info?.projectFound) || projectName !== SANDBOX_NAME)
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
      `the planted folder(s) ${missing.map((d) => `<sandbox>/${d}/`).join(", ")} are absent: run \`w12.live.ts plant\` first`,
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

async function netZero(ctx: StepContext): Promise<StepOutcome> {
  const fails: string[] = [];
  const evidence: Raw = {};
  const st = await ctx.tool("wb_world", { action: "state" });
  evidence.mode = rb(st).mode ?? null;
  evidence.worldPath = rb(st).worldPath ?? null;
  if (st.ok && S(rb(st).mode) && S(rb(st).mode) !== "edit") fails.push(`mode ${S(rb(st).mode)}, not edit`);
  const diff = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
  evidence.diff = diff;
  if (!diff) fails.push(`no ${BATTERY_SNAPSHOT_FILE}`);
  else if (diff.changed.length) fails.push(`changed outside ${W12_ROOT}/: ${diff.changed.join(", ")}`);
  return { ...verdictOf(fails, "net-zero: nothing changed outside the throwaway folder"), evidence };
}

/** The last step, also run after a stop: Workbench left closable, nothing saved. */
export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st = await ctx.tool("wb_world", { action: "state" }, { tolerate: true });
  evidence.state = brief(st);
  if (st.ok && S(rb(st).mode) && S(rb(st).mode) !== "edit") fails.push(`mode ${S(rb(st).mode)}, not edit`);
  const pid = ctx.deps.recordedPid();
  const left = pid === null ? null : baselineRefusal(await ctx.deps.windows(), pid);
  evidence.dialog = left;
  if (left) fails.push(left);
  const open = S(rb(st).worldPath);
  return {
    ...verdictOf(
      fails,
      open
        ? `closable: '${open}' left open and unedited, the String Editor table and the Styles tab unedited; never saved`
        : "closable: no world open; nothing saved",
    ),
    evidence,
  };
}

export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W12.9",
    title:
      "leave Workbench closable: the world, the String Editor table and the Styles tab left open and unedited (never saved), no dialog up",
    risk: "reversible",
    timeout_ms: 60_000,
    expected: "edit mode, no dialog-like window; the post-flight WM_CLOSE exits without a save prompt",
    kill_criterion: "a dialog is left or the mode is not edit: FAIL (the runbook's hand answers a save prompt No)",
    side_effects: [],
    rollback: "none: nothing is edited",
    writes: [],
    rows: [],
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [tc("wb_world", "state")],
    offlineCalls: () => [],
    walks: () => [],
    run: async (ctx) => leaveClosable(ctx),
  };
}

export function buildSteps(): StepDef[] {
  return [
    {
      id: GATE_STEP,
      block: "W12.0",
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
      rows: [],
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_Info" } as PlanAction,
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
      ],
      offlineCalls: () => [],
      walks: () => [],
      run: async (ctx) => testBedGate(ctx),
    },
    {
      id: WORLD_STEP,
      block: "W12.0",
      title: `the throwaway world ${WORLD}: wb_world new (when absent), register, open (the World Editor walk reads it in edit mode)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected: "the world is written under _throwaway/W12/, registered and open in edit mode",
      kill_criterion: "the world does not open: FAIL (the World Editor walk ensures it again)",
      side_effects: [`${WORLD} and its .meta written under _throwaway/W12/`],
      rollback: "`w12.live.ts rollback` removes _throwaway/W12/ after Workbench is closed",
      writes: [WORLD],
      rows: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => worldPlan(),
      offlineCalls: () => [],
      walks: () => [],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        return { ...verdictOf(fails, `${WORLD} open`), evidence };
      },
    },
    ...MENU_WALKS.map(menuStepDef),
    locLengthStepDef(),
    stylesStepDef(),
    denyStepDef(),
    {
      id: NETZERO_STEP,
      block: "W12.9",
      title: "net-zero: the sandbox outside _throwaway/W12/ against the battery snapshot; edit mode",
      risk: "read-only",
      timeout_ms: 120_000,
      expected: "no file outside _throwaway/W12/ changed (resourceDatabase.rdb recorded, not failed)",
      kill_criterion: "a change outside the throwaway folder: FAIL",
      side_effects: [],
      rollback: "none",
      writes: [],
      rows: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [tc("wb_world", "state")],
      offlineCalls: () => [],
      walks: () => [],
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

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: read-only observations battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map(
      (s) =>
        `  [${s.block}] ${s.id} (${s.risk}): ${s.title}${s.walks().length ? ` [walks: ${s.walks().map((w) => `${w.walker} ${w.module} --state ${w.state}`).join(", ")}]` : ""}`,
    ),
    `  left out: ${EXCLUDED.map((e) => e.what).join("; ")}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w12.live.ts --emit-queue` from its step table; tests/live-harness/w12-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W12 sends no ECEN_Probe call. The walk steps run the census L02 walker as a child process on the same lane.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [DENY_REL, AUDIT_REL, GAP_REL, "DEC-053", "DEC-058", "DEC-103", "PLAN 5.3", "PLAN 11 criterion 8"],
    launches: 1,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "pre-flight builds the real arguments; -scriptAuthorizeAll on the owner's standing go (DEC-053)",
    not_exercised: Object.fromEntries(EXCLUDED.map((e) => [e.what, e.why])),
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
  deps: W12Deps,
  opts: W12Options,
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
    offline: async (name, args) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.offline(name, args);
      calls.push({ offline: name, action: S(args.action) || null, ok: r.ok, code: r.code ?? null });
      return r;
    },
    walk: async (spec, stepId) => {
      guard(`walk ${spec.walker} ${spec.module}`);
      const r = await runWalk(deps, opts, spec, stepId);
      calls.push({ walk: spec.walker, module: spec.module, exit: r.exit, refusal: r.refusal ?? null });
      return r;
    },
    tool: async (name, args, o = {}) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.tool(name, args);
      calls.push({ tool: name, action: S(args.action), ok: r.ok, code: r.code ?? null });
      if (guardOn && !r.ok && STOP_CODES.has(S(r.code)) && !(o.tolerate && r.code !== "MODAL_OPEN")) {
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

async function closeOutAfterStop(deps: W12Deps, opts: W12Options, write: (r: StepRecord) => void): Promise<void> {
  const def = closableStep();
  const startedAt = new Date(deps.now()).toISOString();
  const calls: Array<Record<string, unknown>> = [];
  const ctx = makeCtx(deps, opts, calls, new AbortController(), () => undefined, false);
  let out: StepOutcome;
  try {
    out = await def.run(ctx);
  } catch (e) {
    out = { status: "FAIL", detail: `the close-out threw: ${e instanceof Error ? e.message : String(e)}`, evidence: {} };
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

/** A FAIL unit: each step of W12.1 to W12.3 is its own (one FAIL does not count toward the next's). */
function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? s.id : s.block;
}

export async function runBattery(
  steps: StepDef[],
  deps: W12Deps,
  opts: W12Options,
  all: StepDef[] = buildSteps(),
): Promise<BatteryReport> {
  const records: StepRecord[] = [];
  const write = (r: StepRecord, results?: StepOutcome["results"]): void => {
    const path = recordPath(opts.runDir, r.step);
    let evidenceId: string | null = null;
    if (opts.evidenceDir) {
      deps.writeBytes(path, Buffer.from(toPlaceholders(JSON.stringify(r, null, 2), opts.ph) + "\n", "utf-8"));
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
    const clean = JSON.parse(toPlaceholders(JSON.stringify({ ...r, evidenceId }), opts.ph)) as StepRecord;
    deps.writeBytes(path, Buffer.from(JSON.stringify(clean, null, 2) + "\n", "utf-8"));
    if (results) {
      const lines = results.lines.map((l) => {
        const lr = l.live_result as Raw | undefined;
        return JSON.stringify(lr && evidenceId ? { live_result: { ...lr, evidence: evidenceId } } : l);
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
      if (pid === null) throw new StopBattery("stopped", "the lane recorded no Workbench pid: run the pre-flight first");
      const w = await watched(deps, pid, s.expectsWindows, abort, () => s.run(ctx), {
        ...WATCH_OPTIONS,
        popups: s.popups === true,
      });
      const out = w.value;
      if (w.added.length) out.evidence.windowsAdded = w.added.map((x) => ({ className: x.className, title: x.title }));
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
        return { exit: EXIT.stopped, records, stoppedAt: s.id, message: "three consecutive unexpected failures: the battery stops" };
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
        evidence: { ...(stop?.evidence ?? {}), ...(hand ? { handAnswer: hand } : {}), cut: abort.signal.aborted, calls },
        stop: message,
      });
      if (!dialog && !wedged && kind !== "aborted" && s.id !== CLOSABLE_STEP && !deps.exists(recordPath(opts.runDir, CLOSABLE_STEP)))
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
  return { exit: failed ? EXIT.refused : EXIT.done, records, stoppedAt: null, message: failed ? "a step FAILED (see the table)" : null };
}

function runDirsOf(opts: W12Options, deps: Pick<W12Deps, "listTree">): string[] {
  const runs = new Set(deps.listTree(opts.sittingDir).filter((f) => f.includes("/")).map((f) => f.split("/")[0]!));
  return [...runs].sort().map((r) => join(opts.sittingDir, r));
}

/** `<sitting>/w12-result.json`: every step's latest record across the sitting's run folders. */
export function writeResult(
  opts: W12Options,
  deps: Pick<W12Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  for (const dir of runDirsOf(opts, deps))
    for (const s of steps) {
      const r = readJson<StepRecord>(recordPath(dir, s.id), deps);
      if (r) latest.set(s.id, { ...r, runDir: basename(dir) });
    }
  const value = {
    session: SESSION,
    script: SCRIPT_PATH,
    build: opts.build,
    updated_at: new Date().toISOString(),
    steps: steps.map((s) => {
      const r = latest.get(s.id);
      return r
        ? { id: s.id, status: r.status, detail: r.detail, run: r.runDir, evidenceId: r.evidenceId ?? null }
        : { id: s.id, status: "NOT-RUN", detail: "no record in this sitting" };
    }),
    excluded: EXCLUDED,
    deny_observations: DENY_FILE,
    live_results: steps.filter((s) => s.rows.length).map((s) => liveFileOf(s.id)),
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
  /** One game file from the paks (throws when absent). */
  readVanilla: (p: string) => Promise<Buffer>;
  log: (l: string) => void;
}

/** What `plant` writes: test-bed-relative path to its source (the table and world are written live). */
export function plantSources(): Array<{ rel: string; from: string }> {
  return [{ rel: STYLES_COPY, from: `paks:${STYLES_SOURCE}` }];
}

/** `plant`: the folders and the Styles copy under _throwaway/W12/ (no Workbench running). */
export async function runPlant(sandboxDir: string, sittingDir: string, really: boolean, io: OfflineIo): Promise<number> {
  for (const s of plantSources()) io.log(`plant: ${s.from} -> <sandbox>/${s.rel}`);
  for (const d of PLANT_DIRS) io.log(`plant: folder <sandbox>/${d}/`);
  io.log(`plant: record <sitting>/${PLANT_FILE}`);
  io.log(`live, not planted: ${WORLD} (w12-01, wb_world new), ${LOC_ST} (w12-20, string_table create)`);
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the plant is offline`);
    return EXIT.refused;
  }
  if (io.exists(abs(sandboxDir, W12_ROOT))) {
    io.log(`refused: <sandbox>/${W12_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const bytes: Record<string, Buffer> = {};
  try {
    for (const s of plantSources()) bytes[s.rel] = await io.readVanilla(s.from.slice("paks:".length));
  } catch (e) {
    io.log(`refused: a vanilla source could not be read (${e instanceof Error ? e.message : String(e)}): nothing written`);
    return EXIT.refused;
  }
  const record = {
    kind: "w12-plant",
    files: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, sha256(b)])),
    dirs: [...PLANT_DIRS],
    throwawayExistedBefore: io.exists(abs(sandboxDir, THROWAWAY)),
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  for (const d of PLANT_DIRS) {
    io.makeDir(abs(sandboxDir, d));
    io.log(`made <sandbox>/${d}/`);
  }
  for (const [rel, b] of Object.entries(bytes)) {
    io.writeBytes(abs(sandboxDir, rel), b);
    io.log(`planted <sandbox>/${rel} (${b.length} bytes, sha256 ${sha256(b)})`);
  }
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W12/; `_throwaway/` only when empty and absent before the plant. */
export function runRollback(sandboxDir: string, sittingDir: string, really: boolean, io: OfflineIo): number {
  const dir = abs(sandboxDir, W12_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W12_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W12_ROOT}/ (${files.length} files)`);
  if (!really) {
    io.log("dry run: nothing removed");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return EXIT.refused;
  }
  const listing = files.map((rel) => ({ rel, sha256: sha256(io.readBytes(join(dir, ...rel.split("/")))) }));
  io.writeBytes(join(sittingDir, "throwaway-w12-listing.json"), Buffer.from(JSON.stringify(listing, null, 2) + "\n"));
  io.removeTree(dir);
  let plant: { throwawayExistedBefore?: boolean } | null = null;
  try {
    plant = JSON.parse(io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8")) as { throwawayExistedBefore?: boolean };
  } catch {
    plant = null;
  }
  const top = abs(sandboxDir, THROWAWAY);
  if (plant?.throwawayExistedBefore === false && io.exists(top) && io.listDir(top).length === 0) io.removeTree(top);
  io.log(`removed <sandbox>/${W12_ROOT}/ (listing in throwaway-w12-listing.json)`);
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

const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W12Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const root = artifactsDir();
  // The test project's folder is passed in here; no tool or handler names it.
  const config: Config = { ...loadConfig(), projectPath: input.sandboxDir };
  const logsRoot = config.logsPath;
  const pluginDeps = {
    client,
    catalog: () => loadCatalog(),
    allowList: () => loadAllowList(),
    runAllowList: () => loadRunAllowList(),
  };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  const wrap = async (f: () => Promise<ToolResponse>): Promise<ToolResponse> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof WorkbenchError) return { ok: false, code: e.code, message: e.message };
      return { ok: false, code: "HANDLER_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    tool: (name, args) =>
      wrap(async () => {
        switch (name) {
          case "wb_plugin":
            return asResp(await runPlugin(args, pluginDeps));
          case "wb_module":
            return asResp(await runModule(client, args as unknown as ModuleArgs));
          case "wb_world":
            return asResp(await runWorld(client, args, { projectRoot: input.sandboxDir, artifactsRoot: root }));
          case "wb_resources":
            return asResp(await runResources(client, args));
          case "wb_localization":
            return asResp(await runLocalization(client, args));
        }
      }),
    offline: (name, args) =>
      wrap(async () => {
        if (name !== "string_table") return { ok: false, code: "INVALID_ARGUMENT", message: `${String(name)} is not a W12 writer` };
        return asResp(runStringTable(config, { ...args, projectPath: input.sandboxDir } as unknown as StringTableArgs));
      }),
    walk: (script, argv) =>
      new Promise((res) => {
        const child = spawn(process.execPath, ["--import", TSX_IMPORT, join(REPO_ROOT, script), ...argv], {
          cwd: REPO_ROOT,
          stdio: "inherit",
        });
        child.on("exit", (code) => res(code ?? 1));
        child.on("error", () => res(1));
      }),
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
      const r = await runPowerShell(COMMAND_LINE_SCRIPT, { timeoutMs: 30_000, env: { EMCP_PID: String(pid) } });
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

async function openVfs() {
  const { PakVirtualFS } = await import("../../src/pak/vfs.js");
  return PakVirtualFS.get(loadConfig().gamePath);
}

function realOfflineIo(): OfflineIo {
  let vfs: Awaited<ReturnType<typeof openVfs>> | undefined;
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
    readVanilla: async (p) => {
      vfs ??= await openVfs();
      if (!vfs) throw new Error("the game paks cannot be opened");
      return vfs.readFile(p);
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
const SUBCOMMANDS = ["plant", "rollback"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  steps?: StepDef[];
  deps?: W12Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
}

/** The dry-run gate: the plan against the policy, the W12 plan check and the queue. */
export function dryRunCheck(policy: CensusPolicy, steps: StepDef[] = buildSteps()): { ok: boolean; lines: string[] } {
  const plan = buildActionPlan(steps);
  const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
  const lines = [formatResult(check)];
  const own = w12PlanViolations(steps);
  lines.push(own.length ? `W12 plan check: FAIL\n${own.map((v) => `  ${v}`).join("\n")}` : "W12 plan check: PASS");
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
  const sub = (SUBCOMMANDS as readonly string[]).includes(argv[0] ?? "") ? (argv[0] as (typeof SUBCOMMANDS)[number]) : null;
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
    const io = { ...(over.offlineIo ?? realOfflineIo()), log: (l: string) => say(toPlaceholders(l, ph)) };
    return sub === "plant"
      ? runPlant(resolve(o.sandbox), resolve(o["sitting-dir"]), really, io)
      : runRollback(resolve(o.sandbox), resolve(o["sitting-dir"]), really, io);
  }

  const policy = over.policy ?? loadPolicy();
  const steps = over.steps ?? buildSteps();
  const plan = buildActionPlan(steps);
  const dry = dryRunCheck(policy, steps);
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps).join("\n") + "\n", "utf-8");
  if (o["emit-queue"]) writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
  if (!really) {
    for (const l of sessionOutline(steps)) say(l);
    for (const l of dry.lines) say(l);
    return dry.ok ? EXIT.done : EXIT.refused;
  }
  if (!dry.ok) {
    for (const l of dry.lines) say(l);
    return EXIT.refused;
  }
  const selected = selectSteps(steps as never, { from: o.from, only: o.only, until: o.until }) as StepDef[] | string;
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
  // The walkers refuse a run folder outside the artifacts folder: refuse here, before any step.
  if (!over.deps && selected.some((s) => s.walks().length)) {
    const outside = outsideArtifacts(sittingDir, artifactsDir());
    if (outside) {
      say(toPlaceholders(`refused: ${outside} (the walk steps write their run folders inside it)`, ph));
      return EXIT.refused;
    }
  }
  const runDir = resolve(o["run-dir"] ?? join(sittingDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`));
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
        lane: { id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] },
        port,
      },
      steps,
    );
    for (const l of resultTable(r.records as never)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w12",
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

// Census rows this file tests: a PASS of w12-20 (once main flips RunProven for the class) writes a
// live result naming it, and promote.ts needs the row named here for its live test link.
// census:plugin:SCR_LocLengthPlugin
