/**
 * Wave W2 (Resource Manager), the live battery (docs/v2/design/phase5-w2-spec.md section 6, DEC-058,
 * DEC-063). Built on the battery that passed live in full, tests/live/w1.live.ts: the same CLI, the
 * same evidence, the same hand mechanism, the same stop rules.
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch profile with `-scriptAuthorizeAll` (DEC-053 ruling 2, the standing go), with the
 * shipped bundle installed and NO probe pack. This script never launches, never takes the lease for
 * itself (the lane given with --id holds it) and reaches Workbench through the shipped TS tools run
 * IN PROCESS (`runResources`, `runMeta`, `runValidate`, `runContainer`, `runModule`, `runWorld`,
 * `runEntity`, `runBi`) over a `WorkbenchClient` WITHOUT a Config (no lease, no auto-launch, no
 * handler recovery), so each step tests the TS mapping and the handler together. The five W2
 * offline tools (`meta_file`, `imageset`, `layout_edit`, `config_edit`, `project_settings`) run in
 * process on the test project's folder, passed in as `projectPath`; no handler or tool names it.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan and the queue with preflight's validateQueue; `--out` writes
 * the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/W2-queue.json;
 * a test keeps the two equal). The runbook is docs/v2/sessions/queues/W2.md.
 *
 * Blocks (one launch; each block is ordered read-only, reversible, mutating for the queue):
 *   W2.0 setup     the test-bed gate (EMCP_WB_Info names EMCP2_sandbox, build stamp, the plant), the
 *                  sandbox snapshot, the compile gate (P-W2-01), the offline format probes (P-W2-24,
 *                  P-W2-25), the four live fixtures registered (dry run, then confirm)
 *   W2.1 read      search, selection, resolve, addons, newGuid, wait, getInfo, link, schema reads,
 *                  material validation, the Bohemia read handlers
 *   W2.2 meta      wb_meta set/clear/setAncestor/assignMaterial, import, rebuild; each write undone by
 *                  its inverse and the .meta compared byte for byte
 *   W2.3 texture   wb_validate texture and fixTexture after a deliberate wrong ancestor, restored
 *   W2.4 create    wb_resources create (.conf, .emat, .layout, with and without inherit)
 *   W2.5 RM        the Resource Manager's opened resource (open:ResourceManager): describe, get, set,
 *                  save, set back, save
 *   W2.6 prefab    prefabFromModel with the W2 world open; the entity count unchanged
 *   W2.7 offline   the engine-accept proofs of the five offline tools: each edits a throwaway copy,
 *                  Workbench then loads it (wb_container / wb_meta) and the changed value is read back
 *   W2.8 hand      the Resource Browser selection (P-W2-13) and the Resource Browser context menus
 *                  (the hand right-clicks the named file, L05's passive read reads the popup, the hand
 *                  presses Esc)
 *   W2.9 aliases   the 1.x names and the wb_world / wb_module equivalents
 *   W2.10 close    the net-zero hash diff and the closable step
 * Everything under _throwaway/W2/ (plant, worlds, created files, prefabs, .meta files) is removed by
 * this script's `rollback` subcommand once Workbench is closed.
 *
 * Stop rules (W1's): a dialog-like window already up refuses the step; the pid's windows are polled
 * while a step runs (scripts/census/live/common.ts `watched`): a new dialog-like or disabled window
 * is a HANDOFF that names the title and the answer (never Save), any other new window a STOP, and
 * the first verdict cuts the step; busy windows alone (a world load) are waited out under
 * WATCH_OPTIONS' grace. A LOST, WEDGED or MODAL_OPEN client error stops the battery;
 * three consecutive unexpected FAILs in one unit stop it (failUnitOf: the count resets at a block
 * boundary, and each step of an independent block, W2.7, is its own unit). A mutating call is never
 * retried. A probe whose kill
 * criterion is met is recorded KILLED with the observed value; steps that depend on it are SKIPPED.
 *
 * Usage:
 *   npx --no tsx tests/live/w2.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w2.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w2.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w2.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
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
import { deflateSync } from "node:zlib";
import { loadConfig, type Config } from "../../src/config.js";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { runResources, TS_ACTIONS as RESOURCES_TS_ACTIONS } from "../../src/tools/wb-resources.js";
import { runMeta } from "../../src/tools/wb-meta.js";
import { runValidate } from "../../src/tools/wb-validate.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runBi } from "../../src/tools/wb-bi.js";
import { runMetaFile, type MetaArgs } from "../../src/tools/meta-file.js";
import { runImageset, type ImagesetRequest } from "../../src/tools/imageset.js";
import { runLayoutEdit, type LayoutEditArgs } from "../../src/tools/layout-edit.js";
import { runConfigEdit, type ConfigEditArgs } from "../../src/tools/config-edit.js";
import { runProjectSettings, type ProjectSettingsArgs } from "../../src/tools/project-settings.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
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
  EDITOR_WINDOW_CLASS,
  EXIT,
  StepCut,
  StopBattery,
  watched,
  type VerdictOptions,
} from "../../scripts/census/live/common.js";
import {
  PASSIVE_TIMEOUT_MS,
  handPlan as l05HandPlan,
  makeRealKernel,
  moduleTitlePattern,
} from "../../scripts/census/live/L05-context.js";

export { EXIT, StopBattery };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W2";
/** The last step; the runner also runs it after a stop (not after a dialog, LOST or WEDGED). */
export const CLOSABLE_STEP = "w2-99-closable";

/**
 * The window watch of every polled step (W1 cold run fix-up audit; W4's and W8's treatment). W2 opens a world (the fixture, the closable step's fresh load) and
 * runs rebuild and import, each of which can leave the editor windows disabled for a while: the
 * transient that handed off W1's w1-60 and W4's w4-60 on 1.9.0.37 (W2's watch had no grace).
 * A busy-only change (isBusyWindow: unowned, disabled, the editor or tool-window class) is waited
 * out for at most BUSY_GRACE_MS and re-checked at the step's end; past it, a handoff. An owned
 * window, a #32770, a known modal title or an unexpected window beside it is still a verdict at once.
 */
export const WATCH_OPTIONS: VerdictOptions = { popups: false, busyGraceMs: BUSY_GRACE_MS };
export const GATE_STEP = "w2-00-gate";
export const SCRIPT_PATH = "tests/live/w2.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W2.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W2-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));

/** The one switch the launch carries, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<sitting>/w2-scratch.ini",
  SAA,
];

/** Every file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W2_ROOT = `${THROWAWAY}/W2`;
/** The four live fixtures (planted offline, registered by w2-03). */
export const CFG = `${W2_ROOT}/W2_cfg.conf`;
export const MAT = `${W2_ROOT}/W2_mat.emat`;
export const TEX = `${W2_ROOT}/W2_tex_co.png`;
export const LAYOUT = `${W2_ROOT}/W2_ui.layout`;
export const LIVE_FIXTURES: readonly string[] = [CFG, MAT, TEX, LAYOUT];
/** The offline-tool copies: edited by the W2.7 steps first, registered and loaded only after. */
export const OFF_DIR = `${W2_ROOT}/off`;
export const OFF_CONF = `${OFF_DIR}/W2_off.conf`;
export const OFF_CONF_CHILD = `${OFF_DIR}/W2_off_child.conf`;
export const OFF_LAYOUT = `${OFF_DIR}/W2_off.layout`;
export const OFF_LAYOUT_PREFAB = `${OFF_DIR}/W2_off_prefab.layout`;
export const OFF_LAYOUT_CLASS = `${OFF_DIR}/W2_off_widgets.c`;
export const OFF_GPROJ = `${OFF_DIR}/W2_off.gproj`;
export const OFF_TEX = `${OFF_DIR}/W2_tex2_co.png`;
export const OFF_SET = `${OFF_DIR}/W2_set.imageset`;
export const PLANTED: readonly string[] = [
  ...LIVE_FIXTURES,
  OFF_CONF,
  OFF_LAYOUT,
  OFF_GPROJ,
  OFF_TEX,
];
/** Folders the plant makes (NewTargetInProject refuses a target whose parent folder is missing). */
export const CREATED_DIR = `${W2_ROOT}/created`;
export const PREFABS_DIR = `${W2_ROOT}/prefabs`;
export const WORLDS_DIR = `${W2_ROOT}/worlds`;
export const PLANT_DIRS: readonly string[] = [CREATED_DIR, PREFABS_DIR, WORLDS_DIR];
export const WORLD = `${WORLDS_DIR}/EMCP_W2_Tiny.ent`;
export const PREFAB_ET = `${PREFABS_DIR}/W2_probe.et`;
/** Files the missing-path probes name: never created, never opened. */
export const MISSING_CONF = `${W2_ROOT}/W2_missing.conf`;
export const MISSING_EMAT = `${W2_ROOT}/W2_missing.emat`;

/** Vanilla sources (read from the paks by `plant`, or named read-only). */
export const VANILLA_CONF = "Configs/Hints/GeneralHints.conf";
export const VANILLA_EMAT = "Assets/Props/Civilian/GlassBeer_01/Data/Glassbeer_01.emat";
export const VANILLA_LAYOUT = "UI/layouts/Common/DummyRoot.layout";
/** A vanilla .conf ResourceName (Configs/Hints/Editor_Admin.conf names it as its ancestor). */
export const VANILLA_CONF_NAME = "{6B819A076E1A5674}Configs/Hints/Editor.conf";
export const VANILLA_CONF_NAME_CLASS = "SCR_HintConditionList";
/** The vanilla model of GlassBeer_01_base.et's MeshObject (read only, never copied). */
export const VANILLA_XOB = "{2120556A9E0BA9D5}Assets/Props/Civilian/GlassBeer_01/GlassBeer_01.xob";
/** Texture base configs: Unspecified is the catch-all (its GUID from the census corpus). */
export const TEXTURE_UNSPECIFIED =
  "{DC555BD399D92412}Configs/System/ResourceTypes/PC/TextureUnspecified.conf";
export const TEXTURE_NORMAL_PATH = "Configs/System/ResourceTypes/PC/TextureNormalMap.conf";
/** The root class of the planted .conf (vanilla GeneralHints.conf) and the scalar W2 writes. */
export const CFG_CLASS = "SCR_GeneralHintStorage";
export const CFG_SCALAR = "m_fDuration";
/** The vanilla core addon every project depends on (the sandbox .gproj names it). */
export const CORE_DEPENDENCY = "58D0FB3206B6F859";
/** The terrain world W1 reads (vanilla, opened read-only, never saved): the closable fallback. */
export const VANILLA_WORLD = "worlds/Arland/EmptyArland.ent";

export const PLANT_FILE = "plant-w2.json";
export const RESULT_FILE = "w2-result.json";
export const BATTERY_SNAPSHOT_FILE = "w2-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w2-battery-snapshot";
/** Files whose change outside _throwaway/W2/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** How long a hand step waits for the main session's answer file (per request). */
export const HAND_WAIT_MS = 900_000;

export const TIMEOUTS = {
  step: 180_000,
  open: 600_000,
  poll: 5_000,
} as const;

/**
 * Blocks whose steps are independent proofs: W2.7's offline accepts each edit their own copy
 * and check it alone, so three failing in a row says nothing about the session (run 3 stopped
 * on w2-72, w2-73 and w2-74, three unrelated defects, and never reached W2.8 to W2.10).
 */
export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W2.7"]);

/** The unit the consecutive-FAIL stop counts in: the step itself in an independent block, else its block. */
export function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? `${s.block}/${s.id}` : s.block;
}

/** w2-50: describes of open:ResourceManager after an open, while it answers NO_OPEN_RESOURCE
 *  (run 3: is a .conf's empty answer a slow open or a type that exposes no container?). */
export const RM_POLLS = 3;
export const RM_POLL_MS = 2_000;

/** Client codes that stop the battery (the brief's stop rules). */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/**
 * Refusal codes that prove a handler compiled and answered (P-W2-01): a domain refusal is an
 * answer. UNREACHABLE, HANDLER_ERROR or an unknown-handler answer is not. ENGINE_FALSE and
 * STALE_CURSOR are written by the handler itself, so they prove it compiled (W2 run 1: the gate
 * KILLED on a search that answered ENGINE_FALSE).
 */
export const DOMAIN_CODES: ReadonlySet<string> = new Set([
  "ENGINE_FALSE",
  "STALE_CURSOR",
  "META_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "PATH_NOT_FOUND",
  "INVALID_ARGUMENT",
  "NOT_IN_PROJECT",
  "READ_ONLY_SOURCE",
  "UNSUPPORTED_TYPE",
  "NO_OPEN_RESOURCE",
  "ABSOLUTE_PATH",
]);

/** Titles a step may add: W1's World Editor list plus the Resource Manager's main window. */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
export const WORKBENCH_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  /^World Editor$/,
  DEBUG_TITLE,
  /^Enfusion Workbench( - .+)?$/,
  /^Arma Reforger Workbench$/,
  /^Procedural Animation Editor$/,
  /^String Editor$/,
  /^Behavior Editor - EMCP2_sandbox$/,
  /^Audio Editor$/,
  /^Animation Editor$/,
];

// ── Coverage tables ──────────────────────────────────────────────────────────

/** The W2 contracts in contracts/ and the TS tool that drives each (Container: changed by W2). */
export const W2_CONTRACTS = {
  EMCP_WB_Resources: "wb_resources",
  EMCP_WB_Meta: "wb_meta",
  EMCP_WB_Validate: "wb_validate",
  EMCP_WB_Container: "wb_container",
} as const;

/** The TypeScript-only actions of the wave's tools (spec 2.1 TS rows and 2.5). */
export const TS_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  wb_resources: RESOURCES_TS_ACTIONS,
  meta_file: ["read", "scan", "set", "clear", "setAncestor"],
  imageset: [
    "read",
    "create",
    "addTexture",
    "removeTexture",
    "addGroup",
    "addQuad",
    "setQuad",
    "remove",
  ],
  layout_edit: [
    "read",
    "addWidget",
    "removeWidget",
    "moveWidget",
    "duplicateWidget",
    "wrap",
    "convert",
    "setProperty",
    "saveAsPrefab",
    "genClass",
  ],
  config_edit: [
    "read",
    "set",
    "clear",
    "arrayAdd",
    "arrayRemove",
    "setAncestor",
    "createInherited",
    "override",
  ],
  project_settings: [
    "read",
    "set",
    "addDependency",
    "removeDependency",
    "addPlatform",
    "removePlatform",
  ],
};

const W1_CONTAINER_REASON =
  "a W1 action that W2 did not change (spec 2.4: W2 changes describe, get, set and save on the new targets): proven live by tests/live/w1.live.ts (w1-40, w1-77, the 1.9.0.37 confirmation run); on W2's new targets the TS refuses it before anything is sent (class:<Name> WRONG_MODE, open:ResourceManager UNPROVEN)";

/** Contract actions no step exercises, with the reason. */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {
  "wb_container.clear": W1_CONTAINER_REASON,
  "wb_container.arrayAdd": W1_CONTAINER_REASON,
  "wb_container.arrayRemove": W1_CONTAINER_REASON,
  "wb_container.arrayMove": W1_CONTAINER_REASON,
  "wb_container.setClass": W1_CONTAINER_REASON,
};

/** Probes no step can settle in this battery, with the reason (the rest are assigned to steps). */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {
  "P-W2-23":
    "a -buildData CLI run is its own Workbench process (600 s cap per option, one option at a time, process watched); it cannot run beside the GUI Workbench this battery drives on the same profile and project, so the runbook runs it after the post-flight (wb_build_data, W2.md step 8), last, as the spec's run order says",
};

/** The probe ids P-W2-01 .. P-W2-25. */
export const PROBE_IDS: readonly string[] = Array.from(
  { length: 25 },
  (_, i) => `P-W2-${String(i + 1).padStart(2, "0")}`,
);

// ── Types ────────────────────────────────────────────────────────────────────

export type W2Tool =
  | "wb_resources"
  | "wb_meta"
  | "wb_validate"
  | "wb_container"
  | "wb_module"
  | "wb_world"
  | "wb_entity"
  | "wb_bi";

export type OfflineTool =
  | "meta_file"
  | "imageset"
  | "layout_edit"
  | "config_edit"
  | "project_settings";

export const HANDLER_OF: Readonly<Record<W2Tool, string>> = {
  wb_resources: "EMCP_WB_Resources",
  wb_meta: "EMCP_WB_Meta",
  wb_validate: "EMCP_WB_Validate",
  wb_container: "EMCP_WB_Container",
  wb_module: "EMCP_WB_Module",
  wb_world: "EMCP_WB_World",
  wb_entity: "EMCP_WB_Entity",
  wb_bi: "<bi handler>",
};

export type Block =
  | "W2.0"
  | "W2.1"
  | "W2.2"
  | "W2.3"
  | "W2.4"
  | "W2.5"
  | "W2.6"
  | "W2.7"
  | "W2.8"
  | "W2.9"
  | "W2.10";
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

/** What the passive context-menu read returns (L05's readPassive, items flattened). */
export interface ContextRead {
  read: boolean;
  items: string[];
  detail: string;
  artifact: { path: string; sha256: string } | null;
  presentAtStart?: boolean;
}

/** The game data, read from the paks (P-W2-24, P-W2-25). */
export interface VanillaFs {
  paths: () => string[];
  read: (p: string) => Buffer;
}

export interface W2Deps {
  /** One shipped TS tool, run in process against a client WITHOUT a Config. */
  tool: (name: W2Tool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** One offline TS tool, run in process with projectPath set to the test project's folder. */
  offline: (name: OfflineTool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** EMCP_WB_EditorControl {action: "undo"} (World Editor Edit > Undo), never retried. */
  undo: () => Promise<UndoResult>;
  /** EMCP_WB_Info and EMCP_WB_Ping through client.probe (reads). */
  info: () => Promise<Record<string, unknown> | null>;
  ping: () => Promise<Record<string, unknown> | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  /** L05's passive read of the hand-opened Resource Browser popup (sends nothing). */
  contextRead: (pid: number, path: string[]) => Promise<ContextRead>;
  /** The game paks; null when they cannot be opened. */
  vanilla: () => VanillaFs | null;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  /** Relative paths of every file under `dir` (forward slashes), [] when absent. */
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W2Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

/** What a step left behind: undo points still on the stack and state to restore. */
export interface Debt {
  undos: number;
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W2Deps;
  opts: W2Options;
  prior: (id: string) => StepRecord | null;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  /** Values steps share within one run (fixture resource names). */
  state: Map<string, string>;
  /** A tool call: guarded by the window poller; a stop code throws unless `tolerate`. */
  tool: (
    name: W2Tool,
    args: Record<string, unknown>,
    o?: { restore?: boolean; tolerate?: boolean },
  ) => Promise<ToolResponse>;
  offline: (name: OfflineTool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** One Edit > Undo; pays one undo point when it answers ok. */
  undo: () => Promise<UndoResult>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

/** One offline tool call a step makes (no NET call; in the coverage and write checks). */
export interface OfflineCall {
  tool: OfflineTool;
  action: string;
  params: Record<string, unknown>;
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
  /** L05 hand steps: the menu popup pair is recorded, never a stop. */
  popups?: boolean;
  /** A hand step: the main session's hand answers a request file. */
  hand?: boolean;
  plan: () => PlanAction[];
  offlineCalls?: () => OfflineCall[];
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

function rb(r: ToolResponse | null | undefined): Raw {
  return r && r.readback && typeof r.readback === "object" ? (r.readback as Raw) : {};
}

function brief(r: ToolResponse | null | undefined): Raw | null {
  if (!r) return null;
  return r.ok
    ? { ok: true, readback: r.readback ?? null, warnings: r.warnings ?? [] }
    : { ok: false, code: r.code ?? null, message: r.message ?? null, readback: r.readback ?? null };
}

function why(r: ToolResponse): string {
  return `${S(r.action)}: ${S(r.code)} ${S(r.message)}`.trim();
}

function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(sandboxDir: string, rel: string): string {
  return join(sandboxDir, ...rel.split("/"));
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => S(x)) : [];
}

function rowsOf(r: ToolResponse | null | undefined): Raw[] {
  const rows = rb(r).rows;
  return Array.isArray(rows) ? (rows as Raw[]) : [];
}

function readJson<T>(path: string, deps: Pick<W2Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W2Deps, "writeBytes">): void {
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

/** The bytes of a sandbox file, or null when it is absent. */
function bytesOf(ctx: StepContext, rel: string): Buffer | null {
  const p = abs(ctx.opts.sandboxDir, rel);
  return ctx.deps.exists(p) ? ctx.deps.readBytes(p) : null;
}

function same(a: Buffer | null, b: Buffer | null): boolean {
  return !!a && !!b && a.equals(b);
}

/** The text of a sandbox file, "" when absent. */
function textOf(ctx: StepContext, rel: string): string {
  const b = bytesOf(ctx, rel);
  return b ? b.toString("utf-8") : "";
}

/** Lines removed from `a` and added in `b` (longest common subsequence; W1's exactLineDiff). */
export function exactLineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const x = a.split(/\r?\n/);
  const y = b.split(/\r?\n/);
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
      t[i]![j] = xs[i] === ys[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (xs[i] === ys[j]) {
      i++;
      j++;
    } else if (t[i + 1]![j]! >= t[i]![j + 1]!) removed.push(xs[i++]!);
    else added.push(ys[j++]!);
  }
  while (i < m) removed.push(xs[i++]!);
  while (j < n) added.push(ys[j++]!);
  return { removed, added };
}

/** A diff summary for the record (the lines themselves, capped). */
function diffOf(a: Buffer | null, b: Buffer | null): Raw {
  const d = exactLineDiff(a ? a.toString("utf-8") : "", b ? b.toString("utf-8") : "");
  return { removed: d.removed.slice(0, 20), added: d.added.slice(0, 20) };
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The plan entry of one tool call: the handler it sends to, the wire action, tool and action. */
export function tc(
  tool: W2Tool,
  action: string,
  params: Raw = {},
  extra: { toolAction?: string; note?: string; target?: string } = {},
): PlanAction {
  return {
    kind: "net-call",
    target: extra.target ?? HANDLER_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: extra.toolAction ?? action,
    note: extra.note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

/** One offline call of a step (no NET call). */
export function oc(tool: OfflineTool, action: string, params: Raw = {}): OfflineCall {
  return { tool, action, params: { action, ...params } };
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

/** Tool actions that write a file (the plan scan of the harness test checks their paths). */
export const FILE_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  "wb_resources.register",
  "wb_resources.import",
  "wb_resources.create",
  "wb_resources.prefabFromModel",
  "wb_meta.set",
  "wb_meta.clear",
  "wb_meta.setAncestor",
  "wb_meta.assignMaterial",
  "wb_validate.fixTexture",
  "wb_container.set",
  "wb_container.save",
  "wb_world.new",
  "wb_world.register",
]);

/** The path keys a write names (plan params and offline params). */
export const WRITE_PATH_KEYS: readonly string[] = [
  "path",
  "paths",
  "to",
  "newPath",
  "target",
  "resource",
];

const WINDOW_KILL =
  "a new dialog-like window: HANDOFF (nothing sent to it; the record names the title and the answer, never Save); any other new window: STOP; LOST, WEDGED or MODAL_OPEN: STOP";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * The live fixtures on disk and registered, with their resource names (cached for the run). A
 * resolve that finds a .meta needs nothing more; a fixture without one (a resumed run that did not
 * pass w2-03) is registered here. A planted file that is absent stops the battery: nothing is ever
 * opened that is not on disk.
 */
async function ensureFixtures(ctx: StepContext): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = PLANTED.filter((rel) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)));
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `planted file(s) absent: ${missing.join(", ")}: run \`w2.live.ts plant\` first (nothing is sent for a file that is not on disk)`,
    );
  for (const rel of LIVE_FIXTURES) {
    const cached = ctx.state.get(rel);
    if (cached) {
      out[rel] = cached;
      continue;
    }
    const r = await ctx.tool("wb_resources", { action: "resolve", path: rel });
    let name = r.ok && rb(r).hasMeta === true ? S(rb(r).resourceName) : "";
    if (!name) {
      const reg = await ctx.tool("wb_resources", { action: "register", path: rel, confirm: true });
      name = S(rb(reg).resourceName);
      if (!reg.ok || !name)
        throw new StopBattery(
          "stopped",
          `the fixture ${rel} could not be registered (${why(reg)}): no step on it is sent`,
          { resolve: brief(r), register: brief(reg) },
        );
    }
    ctx.state.set(rel, name);
    out[rel] = name;
  }
  return out;
}

function fixturePlan(): PlanAction[] {
  return LIVE_FIXTURES.flatMap((rel) => [
    tc("wb_resources", "resolve", { path: rel }, { note: "the fixture's resource name" }),
    tc(
      "wb_resources",
      "register",
      { path: rel, confirm: true },
      { note: "only when resolve finds no .meta (a resumed run that did not pass w2-03)" },
    ),
  ]);
}

/** The GUID of a resource name `{GUID}path`, "" when it has none. */
function guidOf(name: string): string {
  const m = /^\{([0-9A-Fa-f]{16})\}/.exec(name);
  return m ? m[1]!.toUpperCase() : "";
}

/**
 * Source extensions that register as another resource. Run 1 (console.log 22:46:17.510): register
 * of W2_tex_co.png answered `{8BB6157363C94FBC}_throwaway/W2/W2_tex_co.edds` and the engine wrote
 * W2_tex_co.edds and W2_tex_co.edds.meta at once; no W2_tex_co.png.meta ever existed. Only .png is
 * proven; at run time the resource name decides (metaRelOf).
 */
export const REGISTERS_AS: Readonly<Record<string, string>> = { ".png": ".edds" };

/**
 * The project-relative .meta of a source file: `<resource path>.meta` when its resource name
 * names another file (a .png registers as .edds), else REGISTERS_AS, else `<rel>.meta`.
 */
export function metaRelOf(rel: string, resourceName = ""): string {
  const path = resourceName.replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  if (guidOf(resourceName) && path !== "") return `${path}.meta`;
  const dot = rel.lastIndexOf(".");
  const as = dot > 0 ? REGISTERS_AS[rel.slice(dot).toLowerCase()] : undefined;
  return as ? `${rel.slice(0, dot)}${as}.meta` : `${rel}.meta`;
}

/** The .meta of a fixture this run: from its cached resource name, else the planned form. */
function metaOf(ctx: StepContext, rel: string): string {
  return metaRelOf(rel, ctx.state.get(rel) ?? "");
}

/**
 * Why a byte comparison of a .meta cannot be made (the file is absent at one of the reads), or
 * null. Run 1 compared W2_tex_co.png.meta, which never exists: `same(null, null)` is false, so
 * every check read "changed". An absent .meta is now named as such, never as a change.
 */
export function absentMeta(metaRel: string, ...reads: Array<Buffer | null>): string | null {
  return reads.some((b) => b === null)
    ? `the .meta ${metaRel} is absent on disk at ${reads.filter((b) => b === null).length} of ${reads.length} reads: no byte comparison was made`
    : null;
}

/** One enum variable of a meta configuration, with a value other than its current one. */
export interface EnumPick {
  name: string;
  current: string;
  other: string;
  /** The entries' numbers (the enum column's "Name=value"). */
  currentValue: string;
  otherValue: string;
  setDirectly: boolean;
}

/** ctx.state key: how a .meta's text holds an enum value after an engine write (w2-20 records it). */
export const ENUM_FORM_KEY = "w2.enumTextForm";

/**
 * How the .meta text holds `varName` after an engine write: "number" or "name" from the line
 * that names it among the added lines, "" when no added line names it (not determined).
 */
export function enumTextForm(added: readonly string[], varName: string): "number" | "name" | "" {
  const line = added.find((l) => new RegExp(`^\\s*${varName}\\s`).test(l));
  if (!line) return "";
  const tok = line.trim().slice(varName.length).trim().replace(/^"|"$/g, "");
  return /^-?\d+$/.test(tok) ? "number" : "name";
}

/**
 * From `wb_meta vars` rows (columns name, value, setDirectly, enum): an INTEGER variable with at
 * least two enum entries ("Name=0|Other=1"), preferring ColorSpace and Conversion. Null: none.
 */
export function pickEnumVar(rows: Raw[]): EnumPick | null {
  const cands = rows
    .map((r) => {
      const entries = S(r.enum)
        .split("|")
        .map((e) => e.split("="))
        .filter((e) => e[0] !== "" && e.length === 2) as Array<[string, string]>;
      return { r, entries };
    })
    .filter((c) => c.entries.length >= 2);
  const pref = ["ColorSpace", "Conversion"];
  cands.sort((a, b) => {
    const ia = pref.indexOf(S(a.r.name));
    const ib = pref.indexOf(S(b.r.name));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const c = cands[0];
  if (!c) return null;
  const value = S(c.r.value);
  const cur = c.entries.find(([n, v]) => n === value || v === value) ?? c.entries[0]!;
  const other = c.entries.find(([n]) => n !== cur[0])!;
  const sd = S(c.r.setDirectly);
  return {
    name: S(c.r.name),
    current: cur[0],
    other: other[0],
    currentValue: cur[1],
    otherValue: other[1],
    setDirectly: sd === "1" || sd === "true",
  };
}

/** The current value of a variable in `wb_meta vars` rows, "" when absent. */
function varValue(r: ToolResponse, name: string): string {
  const row = rowsOf(r).find((x) => S(x.name) === name);
  return row ? S(row.value) : "";
}

/** True when `value` names the enum entry `name` (the handler may answer the name or the number). */
function enumIs(r: ToolResponse, varName: string, entry: string): boolean {
  const row = rowsOf(r).find((x) => S(x.name) === varName);
  if (!row) return false;
  const v = S(row.value);
  if (v === entry) return true;
  const hit = S(row.enum)
    .split("|")
    .map((e) => e.split("="))
    .find((e) => e[0] === entry);
  return !!hit && hit[1] === v;
}

const VAR_FIELDS = "name,type,value,set,setDirectly,widget,limits,enum";

/** The inverse of a wb_meta write of `pick`: clear when it was inherited, else set it back. */
async function metaInverse(ctx: StepContext, path: string, pick: EnumPick): Promise<ToolResponse> {
  return pick.setDirectly
    ? ctx.tool("wb_meta", {
        action: "set",
        path,
        name: pick.name,
        value: pick.current,
        confirm: true,
      })
    : ctx.tool("wb_meta", { action: "clear", path, name: pick.name, confirm: true });
}

/** The PC configuration's ancestor from a `wb_meta get` readback. */
function pcAncestor(r: ToolResponse): string {
  const ps = Array.isArray(rb(r).platforms) ? (rb(r).platforms as Raw[]) : [];
  const pc = ps.find((p) => S(p.platform) === "PC") ?? ps[0];
  return pc ? S(pc.ancestor) : "";
}

/**
 * The index of a child node a describe summary lists (`#<i>=<Class> "<Name>" (<n> nodes)`, the
 * handler's Summarize), by class and name; null when none matches.
 */
export function layoutNode(
  nodes: readonly string[],
  className: string,
  name: string,
): number | null {
  for (const n of nodes) {
    const m = /^#(\d+)=([A-Za-z_][A-Za-z0-9_]*) "(.*)" \(\d+ nodes\)$/.exec(n);
    if (m && m[2] === className && m[3] === name) return Number(m[1]);
  }
  return null;
}

/** A describe row by its name column (page mode). */
function rowNamed(r: ToolResponse, name: string): Raw | null {
  return rowsOf(r).find((x) => S(x.name) === name) ?? null;
}

const PAGE_FIELDS = "path,name,type,value";

// ── World (prefabFromModel needs one open) ───────────────────────────────────

/** Why the battery refuses to open `rel`: a world under _throwaway/ must exist on disk. */
export function missingWorldRefusal(
  ctx: { opts: { sandboxDir: string }; deps: { exists(p: string): boolean } },
  rel: string,
): string | null {
  const r = rel.replace(/\\/g, "/");
  if (!r.startsWith(`${THROWAWAY}/`)) return null;
  if (ctx.deps.exists(abs(ctx.opts.sandboxDir, r))) return null;
  return `the world ${r} is not on disk under the sandbox: the open is not sent`;
}

/** Open a world in the World Editor and wait until wb_world state names it. */
async function openWorld(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; evidence: Raw; worldPath: string }> {
  const refusal = missingWorldRefusal(ctx, rel);
  if (refusal) return { ok: false, worldPath: "", evidence: { refused: refusal } };
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
    if (ready || !set.ok || ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open)
      return {
        ok: ready,
        worldPath,
        evidence: { open: brief(open), setResource: brief(set), polls, worldPath },
      };
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

/** The W2 world on disk and registered (`wb_world new` when absent), then open. */
async function ensureWorld(ctx: StepContext, evidence: Raw, fails: string[]): Promise<boolean> {
  const st = await ctx.tool("wb_world", { action: "state" });
  if (st.ok && S(rb(st).worldPath).toLowerCase().endsWith(WORLD.toLowerCase())) {
    evidence.world = "already open";
    return true;
  }
  const present = ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD));
  evidence.worldPresent = present;
  if (!present) {
    const dry = await ctx.tool("wb_world", { action: "new", path: WORLD });
    evidence.newDry = brief(dry);
    if (ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD))) fails.push("the world dry run wrote it");
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
  if (!o.ok) fails.push(`the W2 world did not open ('${o.worldPath}')`);
  return o.ok;
}

function worldPlan(): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc(
      "wb_world",
      "register",
      { path: WORLD },
      { toolAction: "new", note: "offline writer (dry run)" },
    ),
    tc(
      "wb_world",
      "register",
      { path: WORLD, confirm: true },
      { toolAction: "new", note: "offline writer in TS, then register (when absent)" },
    ),
    tc("wb_world", "register", { path: WORLD }),
    ...openPlan(WORLD),
  ];
}

// ── Hand requests (W1's mechanism) ───────────────────────────────────────────

/** The request and answer files of one hand observation, in the run folder (never reused). */
export function handFiles(runDir: string, key: string): { request: string; answer: string } {
  return {
    request: join(runDir, `hand-${key}.request.json`),
    answer: join(runDir, `hand-${key}.json`),
  };
}

/** The one HAND REQUEST log line: the run folder and the full answer-file path. */
export function handLine(runDir: string, key: string, instruction: string): string {
  return `HAND REQUEST ${key}: ${instruction} | run folder: ${runDir} | write the answer (JSON) to: ${handFiles(runDir, key).answer}`;
}

/**
 * Asks the main session's hand for one observation or action: writes the request file, logs one
 * HAND REQUEST line and polls for the answer file (JSON) up to HAND_WAIT_MS. Null when none came.
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

// ── Net-zero (W1's snapshot, rooted at _throwaway/W2/) ───────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  root: string;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W2/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W2Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W2_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

/**
 * Writes the battery's before-snapshot into the sitting folder when none is there, and answers
 * whether it did. runBattery calls it before the first step of every run that does not begin at
 * the gate (--from, --only), so w2-95 always has a baseline (W1 run 7).
 */
export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W2Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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

export function changedFiles(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}

/** w2-95's comparison: the battery's snapshot against the sandbox now, outside _throwaway/W2/. */
export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W2Deps, "exists" | "readBytes" | "listTree">,
): { takenBy: string; takenAt: string; changed: string[] } | null {
  const snap = readJson<BatterySnapshot>(join(sittingDir, BATTERY_SNAPSHOT_FILE), deps);
  if (!snap || snap.kind !== BATTERY_SNAPSHOT_KIND || typeof snap.files !== "object") return null;
  const before = Object.fromEntries(
    Object.entries(snap.files).filter(([f]) => !f.startsWith(`${W2_ROOT}/`)),
  );
  return {
    takenBy: S(snap.taken_by),
    takenAt: S(snap.taken_at),
    changed: changedFiles(before, sandboxHashes(sandboxDir, deps)),
  };
}

// ── Offline formats (P-W2-24, P-W2-25) ───────────────────────────────────────

/**
 * The binary form of a file: "FORM/<type>" for an IFF chunk file, "binary" for other text with a
 * NUL in its first 512 bytes, null for text.
 */
export function binaryKind(b: Buffer): string | null {
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "FORM")
    return `FORM/${b.toString("latin1", 8, 12).replace(/[^\x20-\x7e]/g, "?")}`;
  return b.subarray(0, 512).includes(0) ? "binary" : null;
}

/** P-W2-24: does the smallest vanilla file of each extension parse as container text? */
export function formatProbe(
  fs: VanillaFs,
  exts: readonly string[] = [".ct", ".ragdoll", ".fnt"],
): Record<string, Raw> {
  const all = fs.paths();
  const out: Record<string, Raw> = {};
  for (const ext of exts) {
    const files = all.filter((p) => p.toLowerCase().endsWith(ext));
    let best: { p: string; b: Buffer } | null = null;
    for (const p of files.slice(0, 40)) {
      const b = fs.read(p);
      if (!best || b.length < best.b.length) best = { p, b };
    }
    if (!best) {
      out[ext] = { found: 0, parses: false, note: "no vanilla file of this type" };
      continue;
    }
    // A binary container (an IFF "FORM" chunk or NUL bytes, run 1: robotomono_msdf_28.fnt opens
    // "FORM....FNT5HEAD") is not container text: recorded as binary, never fed to the parser's verdict.
    const sampled = files.slice(0, 40);
    const binaryCount = sampled.filter((p) => binaryKind(fs.read(p)) !== null).length;
    const kind = binaryKind(best.b);
    if (kind !== null) {
      out[ext] = {
        found: files.length,
        file: best.p,
        bytes: best.b.length,
        binary: true,
        magic: kind,
        binarySampled: `${binaryCount} of ${sampled.length}`,
        parses: false,
        head: best.b.toString("latin1").slice(0, 60),
      };
      continue;
    }
    const doc = parseCstBytes(best.b);
    const base = doc.base as { kind?: string; key?: string };
    out[ext] = {
      found: files.length,
      file: best.p,
      bytes: best.b.length,
      binary: false,
      binarySampled: `${binaryCount} of ${sampled.length}`,
      diagnostics: doc.diagnostics.length,
      firstDiagnostic: doc.diagnostics[0]?.message ?? null,
      rootKind: base.kind ?? null,
      rootClass: base.key ?? null,
      parses: doc.diagnostics.length === 0 && (base.kind === "object" || base.kind === "root"),
      head: best.b.toString("latin1").slice(0, 60),
    };
  }
  return out;
}

/** P-W2-25: the engine calls of BI's ExportTextureResource handler (its class body in the paks). */
export function exportTextureCalls(fs: VanillaFs): Raw {
  const files = fs.paths().filter((p) => /^scripts\/Workbench/i.test(p) && p.endsWith(".c"));
  for (const p of files) {
    const text = fs.read(p).toString("utf-8");
    const at = text.search(/class\s+ExportTextureResource\b/);
    if (at < 0) continue;
    const next = text.slice(at + 10).search(/\n\s*class\s+\w+/);
    const body = next < 0 ? text.slice(at) : text.slice(at, at + 10 + next);
    const calls = [
      ...new Set(
        [...body.matchAll(/\b([A-Z][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)\s*\(/g)].map(
          (m) => `${m[1]}.${m[2]}`,
        ),
      ),
    ].sort();
    const fileIo = calls.filter((c) => c.startsWith("FileIO."));
    return { file: p, bodyLines: body.split("\n").length, calls, fileIo };
  }
  return { file: null, calls: [], fileIo: [], note: "class ExportTextureResource not found" };
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** Resource Browser path labels of a fixture (the hand's target, the L05 record's path). */
function browserPath(rel: string): string[] {
  return ["Resource Browser", ...rel.split("/")];
}

/** A hand context-menu step (W2.8): the hand right-clicks, L05 reads, the hand presses Esc. */
function contextStep(
  id: string,
  rel: string,
  dependsOn: string[] = [],
  /** The name the browser lists the file by when it registers as another (a .png as its .edds). */
  shownAs = "",
): StepDef {
  const file = basename(rel);
  const pick = shownAs
    ? `${shownAs} (the Resource Browser lists the registered ${file} by its resource; if only ${file} is listed, right-click that)`
    : file;
  return {
    id,
    block: "W2.8",
    title: `Resource Browser context menu of ${file}: hand right-click, L05 passive read, hand Esc`,
    risk: "reversible",
    timeout_ms: 2 * HAND_WAIT_MS + PASSIVE_TIMEOUT_MS,
    expected:
      "one QMenu popup of the Workbench pid, read passively (nothing sent), its items recorded; the hand's Esc closes it",
    kill_criterion: `no popup within L05's wait: NOT-RUN with the reason; the popup still open after the Esc: HANDOFF; ${WINDOW_KILL}`,
    side_effects: ["the hand's right-click may select the file (a hand action)"],
    rollback: "the hand presses Esc once; no menu entry is ever chosen",
    probes: [],
    dependsOn,
    writes: [],
    expectsWindows: WORKBENCH_WINDOWS,
    popups: true,
    hand: true,
    plan: () => l05HandPlan(),
    run: async (ctx) => {
      const evidence: Raw = { file: rel };
      const opened = await awaitHand(
        ctx,
        `${id}-open`,
        `In the Workbench main window (Resource Manager) Resource Browser, open the folder ${dirname(rel)}/ and RIGHT-CLICK ${pick} once. Choose no menu entry; leave the menu open. Then write {"opened": true} (or {"opened": false, "why": "<what you saw>"})`,
      );
      evidence.openAnswer = opened;
      if (!opened)
        return {
          status: "NOT-RUN",
          detail: "no hand answer within the wait: nothing read",
          evidence,
        };
      if (opened.opened !== true)
        return {
          status: "NOT-RUN",
          detail: `the hand did not open the menu: ${S(opened.why)}`,
          evidence,
        };
      const pid = ctx.deps.recordedPid() ?? 0;
      const read = await ctx.deps.contextRead(pid, browserPath(rel));
      evidence.read = read;
      const closed = await awaitHand(
        ctx,
        `${id}-esc`,
        `Press Esc ONCE to close the context menu of ${file} (never a menu entry). Then write {"closed": true}`,
      );
      evidence.escAnswer = closed;
      const ws = await ctx.deps.windows();
      const left = ws.filter(
        (w) => w.pid === pid && w.owner === 0 && w.className.includes("QWindowPopup"),
      );
      evidence.popupLeftOpen = left.map((w) => w.title);
      if (left.length)
        throw new StopBattery(
          "handoff",
          `the context menu of ${file} is still open after the Esc request ("${left[0]!.title}"): the hand presses Esc once`,
          evidence,
        );
      if (!read.read)
        return { status: "NOT-RUN", detail: `no popup was read: ${read.detail}`, evidence };
      return {
        status: read.items.length ? "PASS" : "FAIL",
        detail: read.items.length
          ? `${file}: ${read.items.length} item(s): ${read.items.slice(0, 12).join(", ")}`
          : `${file}: the popup read holds no item`,
        evidence,
      };
    },
  };
}

export function buildSteps(): StepDef[] {
  return [
    // ── W2.0 setup ──
    {
      id: GATE_STEP,
      block: "W2.0",
      title:
        "the test-bed gate: EMCP_WB_Info names EMCP2_sandbox, build stamp, plant, sandbox snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; every planted file is on disk`,
      kill_criterion:
        "not the test bed: ABORTED, nothing else runs; a stamp mismatch or a missing plant: STOPPED",
      side_effects: [`<sitting>/${BATTERY_SNAPSHOT_FILE} written (first run of the sitting only)`],
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
        // The test-bed check lives here, in the battery, never in a shipped handler (DEC-058).
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
        const missing = PLANTED.filter((rel) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)));
        if (missing.length)
          throw new StopBattery(
            "stopped",
            `planted file(s) absent: ${missing.join(", ")}: run \`w2.live.ts plant\` first`,
            evidence,
          );
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        evidence.snapshot = BATTERY_SNAPSHOT_FILE;
        return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
      },
    },
    {
      id: "w2-01-handlers",
      block: "W2.0",
      title: "compile gate (P-W2-01): each new handler answers (Resources, Meta, Validate)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "newGuid and a search answer ok; wb_meta get and wb_validate material/texture on a missing path answer a domain refusal (META_NOT_FOUND, RESOURCE_NOT_FOUND, ...), never an unknown handler",
      kill_criterion:
        "a handler does not answer (UNREACHABLE, HANDLER_ERROR, an unknown-handler error): KILLED; wb_validate moves its checks into a copy of the BI logic (OD-3 option B) and the dependent steps are SKIPPED",
      side_effects: [],
      rollback: "none",
      probes: ["P-W2-01"],
      writes: [],
      plan: () => [
        tc("wb_resources", "newGuid"),
        tc("wb_resources", "search", {
          rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
          extensions: ["conf"],
          limit: 5,
        }),
        tc("wb_meta", "get", { path: MISSING_CONF }),
        tc("wb_validate", "material", { path: MISSING_EMAT }),
        tc("wb_validate", "texture", { path: `${W2_ROOT}/W2_missing_co.png`, typeName: "co" }),
      ],
      run: async (ctx) => {
        const calls: Array<[string, ToolResponse]> = [
          ["wb_resources.newGuid", await ctx.tool("wb_resources", { action: "newGuid" })],
          [
            "wb_resources.search",
            // The $Addon: form, the one run 1 proved (w2-11); the relative form is w2-11's probe.
            await ctx.tool("wb_resources", {
              action: "search",
              rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
              extensions: ["conf"],
              limit: 5,
            }),
          ],
          ["wb_meta.get", await ctx.tool("wb_meta", { action: "get", path: MISSING_CONF })],
          [
            "wb_validate.material",
            await ctx.tool("wb_validate", { action: "material", path: MISSING_EMAT }),
          ],
          [
            "wb_validate.texture",
            await ctx.tool("wb_validate", {
              action: "texture",
              path: `${W2_ROOT}/W2_missing_co.png`,
              typeName: "co",
            }),
          ],
        ];
        const evidence: Raw = Object.fromEntries(calls.map(([k, r]) => [k, brief(r)]));
        const dead = calls.filter(([, r]) => !r.ok && !DOMAIN_CODES.has(S(r.code)));
        const observed = Object.fromEntries(calls.map(([k, r]) => [k, r.ok ? "ok" : S(r.code)]));
        const p = dead.length
          ? killed(
              "P-W2-01",
              observed,
              `no answer from ${dead.map(([k, r]) => `${k} (${S(r.code)} ${S(r.message)})`).join(", ")}`,
            )
          : settled("P-W2-01", observed, "every new handler compiled and answers on 1.9.0.37");
        return {
          ...verdictOf([], [p], "Resources, Meta and Validate answer"),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w2-02-offline-formats",
      block: "W2.0",
      title:
        "offline (no Workbench call): .ct/.ragdoll/.fnt as container text (P-W2-24); ExportTextureResource's calls (P-W2-25)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "each of the three types parses to a class tree with the lossless parser; ExportTextureResource registers, runs DoChecks or a meta Set, Save and a rebuild, and calls no FileIO",
      kill_criterion:
        "a type does not parse: P-W2-24 KILLED (the row stays re-point W8 with the format noted); the handler calls FileIO: P-W2-25 KILLED (the row re-points W6)",
      side_effects: [],
      rollback: "none (reads from the game paks in this process)",
      probes: ["P-W2-24", "P-W2-25"],
      writes: [],
      plan: () => [],
      run: async (ctx) => {
        const fs = ctx.deps.vanilla();
        if (!fs)
          return {
            status: "NOT-RUN",
            detail: "the game paks could not be opened (ENFUSION_GAME_PATH)",
            evidence: {},
          };
        const formats = formatProbe(fs);
        const calls = exportTextureCalls(fs);
        // Judged per format (fix-up 1): a text file that does not parse is a KILL (the parser or
        // the format is wrong); a binary format is an answer (not container text, its row keeps
        // re-point W8 with the format noted) and leaves the text formats' verdicts standing.
        const bad = Object.entries(formats).filter(([, v]) => v.parses !== true);
        const textBad = bad.filter(([, v]) => v.binary !== true);
        const binary = bad.filter(([, v]) => v.binary === true);
        const parsed = Object.entries(formats).filter(([, v]) => v.parses === true);
        const perFormat = Object.fromEntries(
          Object.entries(formats).map(([e, v]) => [
            e,
            v.parses === true
              ? "container text"
              : v.binary === true
                ? `binary ${S(v.magic)} (${S(v.binarySampled)} sampled)`
                : `does not parse: ${S(v.firstDiagnostic) || S(v.note) || S(v.rootKind)}`,
          ]),
        );
        const p24 = textBad.length
          ? killed(
              "P-W2-24",
              { ...formats, perFormat },
              `not container text: ${textBad.map(([e]) => `${e} (${perFormat[e]})`).join(", ")}`,
            )
          : binary.length
            ? partial(
                "P-W2-24",
                { ...formats, perFormat },
                `${parsed.map(([e]) => e).join(", ") || "no format"} parse as container text; ${binary.map(([e]) => `${e} is ${perFormat[e]}`).join(", ")}: not container text, its row stays re-point W8 (format binary)`,
              )
            : settled("P-W2-24", { ...formats, perFormat }, "all three parse to a class tree");
        const fileIo = strs(calls.fileIo);
        const p25 = !calls.file
          ? partial("P-W2-25", calls, "the handler class was not found in the paks")
          : fileIo.length
            ? killed("P-W2-25", calls, `it calls ${fileIo.join(", ")}`)
            : settled("P-W2-25", calls, "no FileIO call: wb_resources.import subsumes it");
        return {
          ...verdictOf(
            [],
            [p24, p25],
            `${Object.keys(formats).length} formats read; handler ${S(calls.file)}`,
          ),
          evidence: { formats, exportTexture: calls },
          probes: [p24, p25],
        };
      },
    },
    {
      id: "w2-03-register",
      block: "W2.0",
      title: "wb_resources register the four live fixtures (dry run, then confirm), resolve each",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "each dry run writes no .meta; each confirm answers registered with a {GUID}path and writes <file>.meta; a second register answers alreadyRegistered; resolve answers hasMeta",
      kill_criterion: `a fixture is not registered: FAIL, and the steps that need it STOP; ${WINDOW_KILL}`,
      side_effects: LIVE_FIXTURES.map((r) => metaRelOf(r)),
      rollback:
        "`w2.live.ts rollback` removes _throwaway/W2/ (with the .meta files) after Workbench is closed",
      probes: [],
      writes: LIVE_FIXTURES.map((r) => metaRelOf(r)),
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () =>
        LIVE_FIXTURES.flatMap((rel) => [
          tc("wb_resources", "register", { path: rel }, { note: "dry run" }),
          tc("wb_resources", "register", { path: rel, confirm: true }),
          tc("wb_resources", "resolve", { path: rel }),
        ]),
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureFixturesOnDisk(ctx);
        for (const rel of LIVE_FIXTURES) {
          // The planned .meta (a .png's is <stem>.edds.meta) is checked before and after the dry run.
          const planned = metaRelOf(rel);
          const metaBefore = bytesOf(ctx, planned);
          const dry = await ctx.tool("wb_resources", { action: "register", path: rel });
          const metaAfterDry = bytesOf(ctx, planned);
          const conf = await ctx.tool("wb_resources", {
            action: "register",
            path: rel,
            confirm: true,
          });
          const res = await ctx.tool("wb_resources", { action: "resolve", path: rel });
          const name = S(rb(conf).resourceName) || S(rb(res).resourceName);
          // The .meta the engine wrote: beside the resource the register answered.
          const metaRel = metaRelOf(rel, name);
          evidence[rel] = {
            metaBefore: !!metaBefore,
            metaRel,
            metaPlanned: planned,
            dry: brief(dry),
            confirm: brief(conf),
            resolve: brief(res),
          };
          if (!metaBefore && metaAfterDry) fails.push(`${rel}: the dry run wrote ${planned}`);
          if (!conf.ok) fails.push(`${rel}: ${why(conf)}`);
          else if (!bytesOf(ctx, metaRel))
            fails.push(`${rel}: no ${metaRel} on disk after register`);
          if (conf.ok && metaRel !== planned)
            fails.push(
              `${rel}: registered as ${name}; the planned .meta ${planned} differs (REGISTERS_AS)`,
            );
          if (!res.ok) fails.push(`${rel}: resolve ${why(res)}`);
          if (!guidOf(name)) fails.push(`${rel}: no {GUID} in '${name}'`);
          else ctx.state.set(rel, name);
        }
        return { ...verdictOf(fails, [], `${LIVE_FIXTURES.length} fixtures registered`), evidence };
      },
    },

    // ── W2.1 reads ──
    {
      id: "w2-10-resolve",
      block: "W2.1",
      title:
        "wb_meta get (fixture, packed, missing; P-W2-05); newGuid x2 and resolve path/{GUID}/unknown (P-W2-22)",
      risk: "read-only",
      timeout_ms: 90_000,
      expected:
        "get on the relative fixture path answers its GUID and platforms; packed and missing answer META_NOT_FOUND with no prompt; two newGuids are 16 upper-case hex and distinct; resolve of the unknown {0000000000000001} answers RESOURCE_NOT_FOUND",
      kill_criterion:
        "P-W2-05: the relative path answers null (the handler resolves through GetAbsolutePath first); P-W2-22: resolve echoes the unknown GUID as ok",
      side_effects: [],
      rollback: "none",
      probes: ["P-W2-05", "P-W2-22"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_meta", "get", { path: CFG }),
        tc("wb_meta", "get", { path: VANILLA_CONF }),
        tc("wb_meta", "get", { path: MISSING_CONF }),
        tc("wb_resources", "newGuid"),
        tc("wb_resources", "newGuid"),
        tc("wb_resources", "resolve", { path: CFG }),
        tc("wb_resources", "resolve", { path: "{<guid of the fixture>}" }),
        tc("wb_resources", "resolve", { path: "{0000000000000001}" }),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const g1 = await ctx.tool("wb_meta", { action: "get", path: CFG });
        const g2 = await ctx.tool("wb_meta", { action: "get", path: VANILLA_CONF });
        const g3 = await ctx.tool("wb_meta", { action: "get", path: MISSING_CONF });
        const n1 = await ctx.tool("wb_resources", { action: "newGuid" });
        const n2 = await ctx.tool("wb_resources", { action: "newGuid" });
        const r1 = await ctx.tool("wb_resources", { action: "resolve", path: CFG });
        const guid = guidOf(fx[CFG]!);
        const r2 = await ctx.tool("wb_resources", { action: "resolve", path: `{${guid}}` });
        const r3 = await ctx.tool("wb_resources", {
          action: "resolve",
          path: "{0000000000000001}",
        });
        const evidence: Raw = {
          getFixture: brief(g1),
          getPacked: brief(g2),
          getMissing: brief(g3),
          newGuid: [brief(n1), brief(n2)],
          resolvePath: brief(r1),
          resolveGuid: brief(r2),
          resolveUnknown: brief(r3),
        };
        const fails: string[] = [];
        const o5 = {
          fixture: g1.ok ? { guid: rb(g1).guid, platforms: rb(g1).platforms } : g1.code,
          packed: g2.ok ? "ok" : S(g2.code),
          missing: g3.ok ? "ok" : S(g3.code),
        };
        const p5 = !g1.ok
          ? killed(
              "P-W2-05",
              o5,
              `the relative fixture path answered ${S(g1.code)} ${S(g1.message)}`,
            )
          : g2.code === "META_NOT_FOUND" && g3.code === "META_NOT_FOUND"
            ? settled("P-W2-05", o5, "relative resolves; packed and missing answer META_NOT_FOUND")
            : partial("P-W2-05", o5, "relative resolves; packed or missing answered otherwise");
        const a = S(rb(n1).guid);
        const b = S(rb(n2).guid);
        const hex = (x: string) => /^[0-9A-F]{16}$/.test(x);
        const o22 = {
          guids: [a, b],
          unknown: r3.ok ? rb(r3) : S(r3.code),
          byGuid: rb(r2).relPath ?? null,
        };
        let p22: ProbeResult;
        if (r3.ok && S(rb(r3).resourceName) !== "")
          p22 = killed("P-W2-22", o22, "resolve answered ok for a GUID nothing has (an echo)");
        else if (hex(a) && hex(b) && a !== b && r3.code === "RESOURCE_NOT_FOUND")
          p22 = settled(
            "P-W2-22",
            o22,
            "16 upper-case hex, distinct; unknown GUID RESOURCE_NOT_FOUND",
          );
        else
          p22 = partial(
            "P-W2-22",
            o22,
            "the GUID format or the unknown-GUID answer differs from the spec",
          );
        if (!r1.ok) fails.push(`resolve path: ${why(r1)}`);
        if (r1.ok && rb(r1).hasMeta !== true)
          fails.push("resolve path: hasMeta false on a registered fixture");
        if (!r2.ok || !S(rb(r2).relPath).toLowerCase().endsWith(CFG.toLowerCase()))
          fails.push(`resolve {GUID}: ${r2.ok ? `relPath '${S(rb(r2).relPath)}'` : why(r2)}`);
        return { ...verdictOf(fails, [p5, p22], `guids ${a}, ${b}`), evidence, probes: [p5, p22] };
      },
    },
    {
      id: "w2-11-search",
      block: "W2.1",
      title:
        "wb_resources search: rootPath forms (P-W2-03), hits and paging (P-W2-02), STALE_CURSOR, searchStr and tags (P-W2-04)",
      risk: "read-only",
      timeout_ms: 90_000,
      expected:
        "'$EMCP2_sandbox:_throwaway/W2/' answers the registered .conf files under it, no modal; limit 1 pages with nextCursor; a cursor for another total answers STALE_CURSOR; searchStr [W2, cfg] answers the fixture only",
      kill_criterion:
        "P-W2-02: a prompt or zero hits (search falls back to Workbench.SearchResources/5); P-W2-03: no form scopes; P-W2-04: semantics differ (contract note only)",
      side_effects: [],
      rollback: "none",
      probes: ["P-W2-02", "P-W2-03", "P-W2-04"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_resources", "search", {
          rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
          extensions: ["conf"],
          limit: 200,
        }),
        tc("wb_resources", "search", { rootPath: `${W2_ROOT}/`, extensions: ["conf"], limit: 200 }),
        tc(
          "wb_resources",
          "search",
          { rootPath: "<the sandbox's absolute path>", extensions: ["conf"] },
          { note: "refused ABSOLUTE_PATH by the TS before sending" },
        ),
        tc("wb_resources", "search", { rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`, limit: 1 }),
        tc("wb_resources", "search", {
          rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
          limit: 1,
          cursor: "<nextCursor>",
        }),
        tc("wb_resources", "search", {
          rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
          cursor: "0:<total+5>",
        }),
        tc("wb_resources", "search", {
          rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
          searchStr: ["W2", "cfg"],
        }),
        tc("wb_resources", "search", {
          rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
          tags: ["EMCP_W2_NoSuchTag"],
        }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const root = `$${SANDBOX_NAME}:${W2_ROOT}/`;
        // Offline count: the registered .conf files under _throwaway/W2/ (a .meta beside them).
        const tree = ctx.deps.listTree(abs(ctx.opts.sandboxDir, W2_ROOT));
        const expected = tree
          .filter((f) => f.toLowerCase().endsWith(".conf") && tree.includes(`${f}.meta`))
          .map((f) => `${W2_ROOT}/${f}`);
        const a = await ctx.tool("wb_resources", {
          action: "search",
          rootPath: root,
          extensions: ["conf"],
          limit: 200,
        });
        const b = await ctx.tool("wb_resources", {
          action: "search",
          rootPath: `${W2_ROOT}/`,
          extensions: ["conf"],
          limit: 200,
        });
        const c = await ctx.tool("wb_resources", {
          action: "search",
          rootPath: ctx.opts.sandboxDir,
          extensions: ["conf"],
        });
        const p1 = await ctx.tool("wb_resources", { action: "search", rootPath: root, limit: 1 });
        const cur = S(rb(p1).nextCursor);
        const p2 = cur
          ? await ctx.tool("wb_resources", {
              action: "search",
              rootPath: root,
              limit: 1,
              cursor: cur,
            })
          : null;
        const total = Number(rb(p1).total ?? 0);
        const stale = await ctx.tool("wb_resources", {
          action: "search",
          rootPath: root,
          cursor: `0:${total + 5}`,
        });
        const words = await ctx.tool("wb_resources", {
          action: "search",
          rootPath: root,
          searchStr: ["W2", "cfg"],
        });
        const tags = await ctx.tool("wb_resources", {
          action: "search",
          rootPath: root,
          tags: ["EMCP_W2_NoSuchTag"],
        });
        const items = (r: ToolResponse | null) => strs(rb(r).items);
        const paths = (r: ToolResponse | null) =>
          items(r).map((x) => x.replace(/^\{[0-9A-Fa-f]{16}\}/, "").replace(/^\$[^:]*:/, ""));
        const evidence: Raw = {
          expectedOffline: expected,
          addonForm: brief(a),
          relativeForm: {
            ok: b.ok,
            code: b.code ?? null,
            total: rb(b).total ?? null,
            sample: items(b).slice(0, 10),
          },
          absoluteForm: brief(c),
          page1: brief(p1),
          page2: brief(p2),
          stale: brief(stale),
          searchStr: brief(words),
          tags: brief(tags),
        };
        const fails: string[] = [];
        const hitA = paths(a);
        const o2 = { total: rb(a).total ?? null, items: hitA, expected };
        const p02 =
          !a.ok || hitA.length === 0
            ? killed("P-W2-02", o2, `the addon-form search answered ${a.ok ? "no hits" : why(a)}`)
            : expected.every((e) => hitA.some((h) => h.toLowerCase() === e.toLowerCase())) &&
                hitA.length === expected.length
              ? partial(
                  "P-W2-02",
                  o2,
                  "hits equal the offline count, no modal on this -scriptAuthorizeAll launch; the no-flag launch half is not run in this one-launch battery",
                )
              : partial("P-W2-02", o2, "hits answered but differ from the offline count");
        const relTotal = Number(rb(b).total ?? 0);
        const o3 = {
          addon: rb(a).total ?? null,
          relative: b.ok ? relTotal : S(b.code),
          absolute: c.ok ? rb(c).total : S(c.code),
        };
        const p03 =
          a.ok && hitA.length > 0
            ? settled(
                "P-W2-03",
                o3,
                `the $Addon: form scopes to the addon; the relative form answered ${b.ok ? relTotal : S(b.code)}; the absolute form is refused by the TS (${S(c.code)})`,
              )
            : b.ok && relTotal > 0
              ? partial("P-W2-03", o3, "only the relative form answered hits")
              : killed("P-W2-03", o3, "no rootPath form scopes");
        const w = paths(words);
        const o4 = { searchStr: w, tags: tags.ok ? items(tags) : S(tags.code) };
        const p04 =
          words.ok &&
          w.some((x) => x.toLowerCase() === CFG.toLowerCase()) &&
          w.every((x) => /w2/i.test(x) && /cfg/i.test(x))
            ? partial(
                "P-W2-04",
                o4,
                "searchStr matches all words (the fixture only); the tag half needs a tagged meta, which no W2 write makes (the unknown tag answered as recorded)",
              )
            : killed(
                "P-W2-04",
                o4,
                "searchStr semantics differ from the Resource Browser's (contract note only)",
              );
        if (cur && (!p2 || !p2.ok)) fails.push(`page 2: ${p2 ? why(p2) : "not sent"}`);
        if (total >= 2 && !cur) fails.push(`total ${total} with limit 1 answered no nextCursor`);
        if (stale.ok || stale.code !== "STALE_CURSOR")
          fails.push(
            `a cursor for another total answered ${stale.ok ? "ok" : S(stale.code)}, not STALE_CURSOR`,
          );
        if (c.ok) fails.push("the absolute rootPath was sent (the TS must refuse it)");
        return {
          ...verdictOf(fails, [p02, p03, p04], `${hitA.length} hits under ${root}`),
          evidence,
          probes: [p02, p03, p04],
        };
      },
    },
    {
      id: "w2-12-addons-wait",
      block: "W2.1",
      title:
        "addons (loaded, available); selection (unfocused); wait on a file (found) and on a missing file for 10 s (P-W2-10)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "addons lists EMCP2_sandbox loaded and a vanilla addon; wait on the fixture answers found; wait 10000 ms on a missing file answers found=false after about 10 s and the next Ping answers",
      kill_criterion:
        "P-W2-10: the 10 s wait trips the server watchdog (WEDGED, no Ping): KILLED, timeoutMs max drops to 2000",
      side_effects: [],
      rollback: "none",
      probes: ["P-W2-10"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_resources", "addons"),
        tc("wb_resources", "addons", { available: true }),
        tc("wb_resources", "selection"),
        tc("wb_resources", "wait", { path: CFG, timeoutMs: 1000 }),
        tc("wb_resources", "wait", { path: MISSING_CONF, timeoutMs: 10_000 }),
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const ad = await ctx.tool("wb_resources", { action: "addons" });
        const av = await ctx.tool("wb_resources", { action: "addons", available: true });
        const sel = await ctx.tool("wb_resources", { action: "selection" });
        const w1 = await ctx.tool("wb_resources", { action: "wait", path: CFG, timeoutMs: 1000 });
        const t0 = ctx.deps.now();
        const w2 = await ctx.tool(
          "wb_resources",
          { action: "wait", path: MISSING_CONF, timeoutMs: 10_000 },
          { tolerate: true },
        );
        const elapsed = ctx.deps.now() - t0;
        const ping = await ctx.deps.ping();
        const evidence: Raw = {
          addons: brief(ad),
          available: brief(av),
          selection: brief(sel),
          waitFound: brief(w1),
          waitMissing: brief(w2),
          elapsedMs: elapsed,
          pingAfter: ping,
        };
        const fails: string[] = [];
        const rows = Array.isArray(rb(ad).addons) ? (rb(ad).addons as Raw[]) : [];
        if (!ad.ok) fails.push(`addons: ${why(ad)}`);
        else if (!rows.some((r) => S(r.id) === SANDBOX_NAME && r.loaded === true))
          fails.push(`addons does not list ${SANDBOX_NAME} loaded`);
        if (!av.ok) fails.push(`addons available: ${why(av)}`);
        if (!sel.ok) fails.push(`selection: ${why(sel)}`);
        if (!w1.ok || rb(w1).found !== true)
          fails.push(`wait on the fixture: ${w1.ok ? "found false" : why(w1)}`);
        const o = {
          found: rb(w2).found ?? null,
          code: w2.code ?? null,
          elapsedMs: elapsed,
          ping: !!ping,
        };
        if (!ping)
          throw new StopBattery(
            "stopped",
            "Ping did not answer after the 10 s wait: the server is not answering",
            evidence,
          );
        const p = STOP_CODES.has(S(w2.code))
          ? killed(
              "P-W2-10",
              o,
              `the 10 s wait answered ${S(w2.code)}: the watchdog tripped; timeoutMs max drops to 2000`,
            )
          : w2.ok && rb(w2).found === false
            ? settled("P-W2-10", o, `found=false after ${elapsed} ms; the next Ping answered`)
            : partial(
                "P-W2-10",
                o,
                `wait answered ${w2.ok ? `found ${S(rb(w2).found)}` : why(w2)}`,
              );
        return {
          ...verdictOf(fails, [p], `${rows.length} addons; missing wait ${elapsed} ms`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w2-13-info-link",
      block: "W2.1",
      title:
        "getInfo with expandResource (TS, BI GetResourceInfo); link build and parse round trip (TS)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "getInfo answers the fixture's resource name and data; link builds enfusion://ResourceManager/~EMCP2_sandbox:<path> and parses back to the same addon and path",
      kill_criterion: "either fails: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc(
          "wb_resources",
          "getInfo",
          { path: CFG, expandResource: true },
          { target: "GetResourceInfo" },
        ),
        tc(
          "wb_resources",
          "link",
          { addon: SANDBOX_NAME, path: CFG },
          { note: "TS only: nothing is sent" },
        ),
        tc(
          "wb_resources",
          "link",
          { url: "<the built link>" },
          { note: "TS only: nothing is sent" },
        ),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const gi = await ctx.tool("wb_resources", {
          action: "getInfo",
          path: CFG,
          expandResource: true,
        });
        const lb = await ctx.tool("wb_resources", {
          action: "link",
          addon: SANDBOX_NAME,
          path: CFG,
        });
        const url = S(rb(lb).url);
        const lp = await ctx.tool("wb_resources", { action: "link", url });
        const fails: string[] = [];
        if (!gi.ok) fails.push(`getInfo: ${why(gi)}`);
        if (!lb.ok || !url.startsWith("enfusion://ResourceManager/~"))
          fails.push(`link build: ${lb.ok ? url : why(lb)}`);
        if (!lp.ok || S(rb(lp).addon) !== SANDBOX_NAME || S(rb(lp).path) !== CFG)
          fails.push(`link parse: ${lp.ok ? JSON.stringify(rb(lp)) : why(lp)}`);
        return {
          ...verdictOf(fails, [], `getInfo ${S(rb(gi).resourceName)}; ${url}`),
          evidence: { getInfo: brief(gi), linkBuild: brief(lb), linkParse: brief(lp) },
        };
      },
    },
    {
      id: "w2-14-schema",
      block: "W2.1",
      title:
        "schema columns (P-W2-07): wb_meta vars on the texture meta; wb_container describe with schema on the fixture .conf and on class:<Name>",
      risk: "read-only",
      timeout_ms: 90_000,
      expected:
        "vars lists an enum variable (Conversion or ColorSpace) with its names and a float with min,max,step; describe on path: and class: answer widget/limits/enumValues columns; a set on class: is refused WRONG_MODE before sending",
      kill_criterion:
        "every schema column is empty everywhere: KILLED (schema columns ship blank and L08 records type and default only)",
      side_effects: [],
      rollback: "none (the class: set is refused by the TS; nothing is sent)",
      probes: ["P-W2-07"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_meta", "vars", { path: TEX, fields: VAR_FIELDS, limit: 200 }),
        tc("wb_container", "describe", {
          target: `path:${CFG}`,
          mode: "page",
          fields: `${PAGE_FIELDS},widget,limits,enumValues`,
          limit: 200,
        }),
        tc("wb_container", "describe", {
          target: `class:${CFG_CLASS}`,
          mode: "page",
          fields: "schema",
          limit: 200,
        }),
        tc("wb_container", "get", { target: `class:${CFG_CLASS}`, path: "m_aHintEntries" }),
        tc(
          "wb_container",
          "set",
          { target: `class:${CFG_CLASS}`, path: "m_aHintEntries", value: "x" },
          { note: "refused WRONG_MODE by the TS before sending" },
        ),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const v = await ctx.tool("wb_meta", {
          action: "vars",
          path: TEX,
          fields: VAR_FIELDS,
          limit: 200,
        });
        const d1 = await ctx.tool("wb_container", {
          action: "describe",
          target: `path:${CFG}`,
          mode: "page",
          fields: `${PAGE_FIELDS},widget,limits,enumValues`,
          limit: 200,
        });
        const d2 = await ctx.tool("wb_container", {
          action: "describe",
          target: `class:${CFG_CLASS}`,
          mode: "page",
          fields: "schema",
          limit: 200,
        });
        const g = await ctx.tool("wb_container", {
          action: "get",
          target: `class:${CFG_CLASS}`,
          path: "m_aHintEntries",
        });
        const s = await ctx.tool("wb_container", {
          action: "set",
          target: `class:${CFG_CLASS}`,
          path: "m_aHintEntries",
          value: "x",
        });
        const evidence: Raw = {
          vars: brief(v),
          describePath: brief(d1),
          describeClass: brief(d2),
          getClass: brief(g),
          setClass: brief(s),
        };
        const fails: string[] = [];
        const vrows = rowsOf(v);
        const enumRow = vrows.find((r) => S(r.enum).includes("|"));
        const limitRow = vrows.find((r) => S(r.limits).split(",").length === 3);
        const schemaRows = [...rowsOf(d1), ...rowsOf(d2)].filter(
          (r) => S(r.widget) || S(r.limits) || S(r.enumValues),
        );
        const o = {
          enumVar: enumRow ? { name: enumRow.name, enum: enumRow.enum } : null,
          limitVar: limitRow ? { name: limitRow.name, limits: limitRow.limits } : null,
          containerSchemaRows: schemaRows.length,
        };
        const p =
          !enumRow && !limitRow && schemaRows.length === 0
            ? killed(
                "P-W2-07",
                o,
                "widget, limits and enum are empty on the meta and on both containers",
              )
            : enumRow && limitRow && schemaRows.length > 0
              ? settled(
                  "P-W2-07",
                  o,
                  `meta enum ${S(enumRow.name)}, limits on ${S(limitRow.name)}; ${schemaRows.length} container rows carry schema columns`,
                )
              : partial("P-W2-07", o, "some schema columns answer, some are empty");
        for (const [k, r] of [
          ["vars", v],
          ["describe path", d1],
          ["describe class", d2],
        ] as const)
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        if (s.ok || s.code !== "WRONG_MODE")
          fails.push(`a set on class: answered ${s.ok ? "ok" : S(s.code)}, not WRONG_MODE`);
        return {
          ...verdictOf(fails, [p], `${vrows.length} meta vars; class rows ${rowsOf(d2).length}`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w2-15-material",
      block: "W2.1",
      title:
        "wb_validate material on a packed vanilla .emat and on the fixture .emat (P-W2-19, closes KD-011)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: "both answer a severity and a report list with no VM exception",
      kill_criterion:
        "a VM exception or READ_ONLY_SOURCE on packed input: KILLED (material validates project files only)",
      side_effects: [],
      rollback: "none",
      probes: ["P-W2-19"],
      dependsOn: ["P-W2-01"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_validate", "material", { path: VANILLA_EMAT }),
        tc("wb_validate", "material", { path: MAT }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const a = await ctx.tool("wb_validate", { action: "material", path: VANILLA_EMAT });
        const b = await ctx.tool("wb_validate", { action: "material", path: MAT });
        const o = {
          vanilla: a.ok ? { severity: rb(a).severity, reports: rb(a).reports } : S(a.code),
          fixture: b.ok ? { severity: rb(b).severity, reports: rb(b).reports } : S(b.code),
        };
        const p = !a.ok
          ? killed("P-W2-19", o, `packed input answered ${why(a)}`)
          : b.ok
            ? settled("P-W2-19", o, "the five checks run on packed and on project input")
            : partial("P-W2-19", o, `the fixture answered ${why(b)}`);
        return {
          ...verdictOf(
            b.ok ? [] : [`fixture: ${why(b)}`],
            [p],
            `severity ${S(rb(a).severity)} / ${S(rb(b).severity)}`,
          ),
          evidence: { vanilla: brief(a), fixture: brief(b) },
          probes: [p],
        };
      },
    },
    {
      id: "w2-16-bi-reads",
      block: "W2.1",
      title:
        "wb_bi call on Bohemia read handlers that take no absolute path (GetResourceInfo, CheckGUID, GetPathToAssetsFromGuids, GetGameMaterials, GetLoadedProjects) and list",
      risk: "read-only",
      timeout_ms: 90_000,
      expected: "each answers; list names the 14 verified reads",
      kill_criterion: "a call fails: FAIL (no probe)",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_bi", "list", {}, { note: "TS only: the catalog" }),
        tc("wb_bi", "call", { handler: "GetResourceInfo" }, { target: "GetResourceInfo" }),
        tc("wb_bi", "call", { handler: "CheckGUID" }, { target: "CheckGUID" }),
        tc(
          "wb_bi",
          "call",
          { handler: "GetPathToAssetsFromGuids" },
          { target: "GetPathToAssetsFromGuids" },
        ),
        tc("wb_bi", "call", { handler: "GetGameMaterials" }, { target: "GetGameMaterials" }),
        tc("wb_bi", "call", { handler: "GetLoadedProjects" }, { target: "GetLoadedProjects" }),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const list = await ctx.tool("wb_bi", { action: "list" });
        const calls: Array<[string, Raw]> = [
          ["GetResourceInfo", { path: CFG, expandResource: false }],
          ["CheckGUID", { matName: fx[MAT] }],
          ["GetPathToAssetsFromGuids", { guids: [guidOf(fx[CFG]!)] }],
          ["GetGameMaterials", {}],
          ["GetLoadedProjects", {}],
        ];
        const evidence: Raw = { list: { ok: list.ok, callable: rb(list).callable ?? null } };
        const fails: string[] = [];
        for (const [handler, request] of calls) {
          const r = await ctx.tool("wb_bi", { action: "call", handler, request });
          evidence[handler] = brief(r);
          if (!r.ok) fails.push(`${handler}: ${why(r)}`);
        }
        if (!list.ok) fails.push(`list: ${why(list)}`);
        return { ...verdictOf(fails, [], `${calls.length} Bohemia reads answered`), evidence };
      },
    },

    // ── W2.2 meta writes ──
    {
      id: "w2-20-meta-writes",
      block: "W2.2",
      title:
        "wb_meta set (dry, confirm), fresh read (P-W2-06), inverse (clear or set back), setAncestor and assignMaterial dry runs; the .meta byte for byte",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "the dry run leaves the .meta; confirm changes the text; a second read shows the new value; the inverse returns the .meta byte-identical",
      kill_criterion: `P-W2-06: the read after the write is stale: KILLED (get re-reads through LoadContainer); ${WINDOW_KILL}`,
      side_effects: [`${metaRelOf(TEX)} changed, then restored`],
      rollback:
        "the inverse write (clear when the variable was inherited, else set with before); rollback removes the file",
      probes: ["P-W2-06"],
      writes: [metaRelOf(TEX)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_meta", "vars", { path: TEX, fields: VAR_FIELDS, limit: 200 }),
        tc(
          "wb_meta",
          "set",
          { path: TEX, name: "<enum var>", value: "<other>" },
          { note: "dry run" },
        ),
        tc("wb_meta", "set", { path: TEX, name: "<enum var>", value: "<other>", confirm: true }),
        tc("wb_meta", "vars", { path: TEX, fields: VAR_FIELDS, limit: 200 }),
        tc("wb_meta", "get", { path: TEX }),
        tc(
          "wb_meta",
          "clear",
          { path: TEX, name: "<enum var>", confirm: true },
          { note: "the inverse when the variable was inherited" },
        ),
        tc(
          "wb_meta",
          "set",
          { path: TEX, name: "<enum var>", value: "<before>", confirm: true },
          { note: "the inverse when it was set directly" },
        ),
        tc("wb_meta", "clear", { path: TEX, name: "<enum var>" }, { note: "dry run" }),
        tc(
          "wb_meta",
          "setAncestor",
          { path: TEX, value: TEXTURE_UNSPECIFIED },
          { note: "dry run (the confirmed form runs in w2-30)" },
        ),
        tc(
          "wb_meta",
          "assignMaterial",
          { path: TEX, name: "W2_slot", value: "<W2_mat.emat resource name>" },
          { note: "dry run: no FBX-derived fixture exists" },
        ),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const metaRel = metaOf(ctx, TEX);
        const evidence: Raw = { metaRel };
        const fails: string[] = [];
        const start = bytesOf(ctx, metaRel);
        const v0 = await ctx.tool("wb_meta", {
          action: "vars",
          path: TEX,
          fields: VAR_FIELDS,
          limit: 200,
        });
        const pick = pickEnumVar(rowsOf(v0));
        evidence.pick = pick;
        if (!pick)
          return {
            status: "NOT-RUN",
            detail: "no enum variable with two entries on the texture meta",
            evidence: { vars: brief(v0) },
          };
        const dry = await ctx.tool("wb_meta", {
          action: "set",
          path: TEX,
          name: pick.name,
          value: pick.other,
        });
        const afterDry = bytesOf(ctx, metaRel);
        const set = await ctx.tool("wb_meta", {
          action: "set",
          path: TEX,
          name: pick.name,
          value: pick.other,
          confirm: true,
        });
        const mid = bytesOf(ctx, metaRel);
        const v1 = await ctx.tool("wb_meta", {
          action: "vars",
          path: TEX,
          fields: VAR_FIELDS,
          limit: 200,
        });
        const g1 = await ctx.tool("wb_meta", { action: "get", path: TEX });
        const inv = await metaInverse(ctx, TEX, pick);
        const end = bytesOf(ctx, metaRel);
        const clearDry = await ctx.tool("wb_meta", { action: "clear", path: TEX, name: pick.name });
        const afterClearDry = bytesOf(ctx, metaRel);
        const ancDry = await ctx.tool("wb_meta", {
          action: "setAncestor",
          path: TEX,
          value: TEXTURE_UNSPECIFIED,
        });
        const assignDry = await ctx.tool("wb_meta", {
          action: "assignMaterial",
          path: TEX,
          name: "W2_slot",
          value: fx[MAT],
        });
        Object.assign(evidence, {
          dry: brief(dry),
          set: brief(set),
          varsAfter: brief(v1),
          getAfter: brief(g1),
          inverse: brief(inv),
          clearDry: brief(clearDry),
          setAncestorDry: brief(ancDry),
          assignMaterialDry: brief(assignDry),
          metaDiff: diffOf(start, mid),
          dryRunIdentical: same(start, afterDry),
          clearDryIdentical: same(end, afterClearDry),
          restoredIdentical: same(start, end),
        });
        // How the engine wrote the enum into the text (w2-70's offline write sends the same form).
        const form =
          start && mid
            ? enumTextForm(
                exactLineDiff(start.toString("utf-8"), mid.toString("utf-8")).added,
                pick.name,
              )
            : "";
        evidence.enumTextForm = form || "not determined";
        if (form) ctx.state.set(ENUM_FORM_KEY, form);
        const absent = absentMeta(metaRel, start, afterDry, mid, end, afterClearDry);
        if (absent) fails.push(absent);
        else {
          if (!same(start, afterDry)) fails.push(`the set dry run changed ${metaRel}`);
          if (!same(end, afterClearDry)) fails.push(`the clear dry run changed ${metaRel}`);
          if (set.ok && same(start, mid)) fails.push(`the confirmed set left ${metaRel} unchanged`);
          if (!same(start, end))
            fails.push(
              `the inverse did not return ${metaRel} byte-identical: ${JSON.stringify(diffOf(start, end))}`,
            );
        }
        if (!set.ok) fails.push(`set: ${why(set)}`);
        if (!inv.ok) fails.push(`inverse: ${why(inv)}`);
        if (!ancDry.ok || rb(ancDry).dryRun !== true)
          fails.push(`setAncestor dry run: ${ancDry.ok ? "not a dry run" : why(ancDry)}`);
        const fresh = enumIs(v1, pick.name, pick.other);
        const o = {
          var: pick.name,
          sent: pick.other,
          readBack: varValue(v1, pick.name),
          restoredIdentical: same(start, end),
        };
        const p = !set.ok
          ? partial("P-W2-06", o, `the set was refused: ${why(set)}`)
          : fresh
            ? same(start, end)
              ? settled(
                  "P-W2-06",
                  o,
                  "the second read shows the new value; the restore is byte-identical",
                )
              : partial("P-W2-06", o, "fresh read, but the restore is not byte-identical")
            : killed(
                "P-W2-06",
                o,
                `the read after Save+Release answered '${varValue(v1, pick.name)}', not ${pick.other}`,
              );
        return {
          ...verdictOf(fails, [p], `${pick.name} ${pick.current} -> ${pick.other} -> restored`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w2-21-import",
      block: "W2.2",
      title:
        "wb_resources import settings=[<var>=<other>] (dry, confirm), read back with wb_meta, the inverse; the .meta byte for byte",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "the dry run lists wouldChange and writes nothing; confirm sets, saves and rebuilds; wb_meta vars reads the value; the inverse restores the .meta",
      kill_criterion: `the import is refused or the value does not read back: FAIL; ${WINDOW_KILL}`,
      side_effects: [`${metaRelOf(TEX)} changed, then restored; the runtime texture rebuilt`],
      rollback: "wb_meta clear (inherited) or set with before",
      probes: [],
      writes: [metaRelOf(TEX)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_meta", "vars", { path: TEX, fields: VAR_FIELDS, limit: 200 }),
        tc(
          "wb_resources",
          "import",
          { path: TEX, settings: ["<var>=<other>"] },
          { note: "dry run" },
        ),
        tc("wb_resources", "import", { path: TEX, settings: ["<var>=<other>"], confirm: true }),
        tc("wb_meta", "vars", { path: TEX, fields: VAR_FIELDS, limit: 200 }),
        tc(
          "wb_meta",
          "clear",
          { path: TEX, name: "<var>", confirm: true },
          { note: "the inverse when inherited" },
        ),
        tc(
          "wb_meta",
          "set",
          { path: TEX, name: "<var>", value: "<before>", confirm: true },
          { note: "the inverse when set directly" },
        ),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const metaRel = metaOf(ctx, TEX);
        const start = bytesOf(ctx, metaRel);
        const v0 = await ctx.tool("wb_meta", {
          action: "vars",
          path: TEX,
          fields: VAR_FIELDS,
          limit: 200,
        });
        const pick = pickEnumVar(rowsOf(v0));
        if (!pick)
          return {
            status: "NOT-RUN",
            detail: "no enum variable on the texture meta",
            evidence: { vars: brief(v0) },
          };
        // The enum entry by name (the handler maps it through GetEnumValues, fix-up 1), as wb_meta set takes it.
        const setting = `${pick.name}=${pick.other}`;
        const dry = await ctx.tool("wb_resources", {
          action: "import",
          path: TEX,
          settings: [setting],
        });
        const afterDry = bytesOf(ctx, metaRel);
        const imp = await ctx.tool("wb_resources", {
          action: "import",
          path: TEX,
          settings: [setting],
          confirm: true,
        });
        const v1 = await ctx.tool("wb_meta", {
          action: "vars",
          path: TEX,
          fields: VAR_FIELDS,
          limit: 200,
        });
        // The inverse only after a write: run 1 cleared (and saved) a variable the refused import never set.
        const inv = imp.ok ? await metaInverse(ctx, TEX, pick) : null;
        const end = bytesOf(ctx, metaRel);
        const fails: string[] = [];
        if (!dry.ok) fails.push(`import dry run: ${why(dry)}`);
        else if (rb(dry).dryRun !== true)
          fails.push("the import without confirm was not a dry run");
        if (!imp.ok) fails.push(`import: ${why(imp)}`);
        else if (!enumIs(v1, pick.name, pick.other))
          fails.push(`after import ${pick.name} reads '${varValue(v1, pick.name)}'`);
        if (inv && !inv.ok) fails.push(`inverse: ${why(inv)}`);
        const absent = absentMeta(metaRel, start, afterDry, end);
        if (absent) fails.push(absent);
        else {
          if (!same(start, afterDry)) fails.push(`the import dry run changed ${metaRel}`);
          if (!same(start, end))
            fails.push(
              `${metaRel} is not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`,
            );
        }
        return {
          ...verdictOf(fails, [], `import ${setting}, read back, restored`),
          evidence: {
            pick,
            metaRel,
            dry: brief(dry),
            import: brief(imp),
            varsAfter: brief(v1),
            inverse: brief(inv),
            dryRunIdentical: same(start, afterDry),
            restoredIdentical: same(start, end),
          },
        };
      },
    },
    {
      id: "w2-22-rebuild",
      block: "W2.2",
      title: "wb_resources rebuild path (dry, confirm; P-W2-08) and paths=[png, conf] (P-W2-09)",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "WaitForFile on the source path answers within 5 s (rebuilt lists it, pending empty); the batch lists both; sources and metas untouched",
      kill_criterion:
        "P-W2-08: pending (WaitForFile always false): KILLED; P-W2-09: the batch answers before both rebuild (pending): KILLED",
      side_effects: [
        "runtime output of the two fixtures rebuilt (the profile's data cache); sources untouched",
      ],
      rollback: "none needed: the sources and metas are untouched (checked)",
      probes: ["P-W2-08", "P-W2-09"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_resources", "rebuild", { path: TEX }, { note: "dry run" }),
        tc("wb_resources", "rebuild", { path: TEX, timeoutMs: 5000, confirm: true }),
        tc("wb_resources", "rebuild", { paths: [TEX, CFG], timeoutMs: 5000, confirm: true }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        // The watched files: the sources and the .meta beside each resource (a .png's is <stem>.edds.meta).
        const watched = [TEX, metaOf(ctx, TEX), CFG, metaOf(ctx, CFG)];
        const before = watched.map((r) => bytesOf(ctx, r));
        const dry = await ctx.tool("wb_resources", { action: "rebuild", path: TEX });
        const one = await ctx.tool("wb_resources", {
          action: "rebuild",
          path: TEX,
          timeoutMs: 5000,
          confirm: true,
        });
        const two = await ctx.tool("wb_resources", {
          action: "rebuild",
          paths: [TEX, CFG],
          timeoutMs: 5000,
          confirm: true,
        });
        const after = watched.map((r) => bytesOf(ctx, r));
        const fails: string[] = [];
        if (!dry.ok || rb(dry).dryRun !== true)
          fails.push(`dry run: ${dry.ok ? "not a dry run" : why(dry)}`);
        before.forEach((b, i) => {
          if (b === null || after[i] === null)
            fails.push(
              `${watched[i]} is absent on disk (before ${b !== null}, after ${after[i] !== null}): no byte comparison was made`,
            );
          else if (!same(b, after[i]!)) fails.push(`rebuild changed ${watched[i]}`);
        });
        const o8 = {
          rebuilt: strs(rb(one).rebuilt),
          pending: strs(rb(one).pending),
          code: one.code ?? null,
        };
        const p8 = !one.ok
          ? partial("P-W2-08", o8, why(one))
          : strs(rb(one).pending).length
            ? killed("P-W2-08", o8, "WaitForFile did not acknowledge the source path within 5 s")
            : settled("P-W2-08", o8, "WaitForFile on the source path answered true");
        const o9 = {
          rebuilt: strs(rb(two).rebuilt),
          pending: strs(rb(two).pending),
          count: rb(two).count ?? null,
        };
        const p9 = !two.ok
          ? partial("P-W2-09", o9, why(two))
          : strs(rb(two).pending).length
            ? killed("P-W2-09", o9, "the batch answered with files pending")
            : strs(rb(two).rebuilt).length >= 2
              ? settled("P-W2-09", o9, "both rebuilt; mixed types")
              : partial("P-W2-09", o9, "fewer than two files listed rebuilt");
        if (!one.ok) fails.push(`rebuild path: ${why(one)}`);
        if (!two.ok) fails.push(`rebuild paths: ${why(two)}`);
        return {
          ...verdictOf(fails, [p8, p9], "rebuild single and batch"),
          evidence: { watched, dry: brief(dry), single: brief(one), batch: brief(two) },
          probes: [p8, p9],
        };
      },
    },

    // ── W2.3 texture ──
    {
      id: "w2-30-texture",
      block: "W2.3",
      title:
        "wb_validate texture (typeName co, then absent) on the correct texture and after a wrong ancestor (P-W2-17); the ancestor restored",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "correct: every check NothingChanged; wrong ancestor: CheckAncestors a fatal result, fatal true; no prompt (this launch carries -scriptAuthorizeAll); the .meta restored byte-identical",
      kill_criterion: `a prompt on the default launch (typeName becomes required, OD-3): not reachable on this launch, the probe stays PARTIAL; ${WINDOW_KILL}`,
      side_effects: [`${metaRelOf(TEX)} ancestor changed, then restored`],
      rollback: "wb_meta setAncestor with the before ResourceName",
      probes: ["P-W2-17"],
      dependsOn: ["P-W2-01"],
      writes: [metaRelOf(TEX)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_meta", "get", { path: TEX }),
        tc("wb_validate", "texture", { path: TEX, typeName: "co" }),
        tc("wb_validate", "texture", { path: TEX }),
        tc("wb_resources", "resolve", { path: TEXTURE_NORMAL_PATH }),
        tc("wb_meta", "setAncestor", { path: TEX, value: "<wrong base>", confirm: true }),
        tc("wb_validate", "texture", { path: TEX, typeName: "co" }),
        tc("wb_meta", "setAncestor", { path: TEX, value: "<before>", confirm: true }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const start = bytesOf(ctx, metaOf(ctx, TEX));
        const g0 = await ctx.tool("wb_meta", { action: "get", path: TEX });
        const orig = pcAncestor(g0);
        const t1 = await ctx.tool("wb_validate", { action: "texture", path: TEX, typeName: "co" });
        const t2 = await ctx.tool("wb_validate", { action: "texture", path: TEX });
        const wrong = await wrongAncestor(ctx, orig);
        const set = await ctx.tool("wb_meta", {
          action: "setAncestor",
          path: TEX,
          value: wrong,
          confirm: true,
        });
        const t3 = set.ok
          ? await ctx.tool("wb_validate", { action: "texture", path: TEX, typeName: "co" })
          : null;
        const back = orig
          ? await ctx.tool("wb_meta", {
              action: "setAncestor",
              path: TEX,
              value: orig,
              confirm: true,
            })
          : null;
        const end = bytesOf(ctx, metaOf(ctx, TEX));
        const evidence: Raw = {
          origAncestor: orig,
          wrong,
          getBefore: brief(g0),
          typed: brief(t1),
          detected: brief(t2),
          setWrong: brief(set),
          afterWrong: brief(t3),
          restore: brief(back),
          restoredIdentical: same(start, end),
        };
        const fails: string[] = [];
        const checks = (r: ToolResponse | null) =>
          Array.isArray(rb(r).checks) ? (rb(r).checks as Raw[]) : [];
        const clean = (r: ToolResponse) =>
          r.ok && checks(r).every((c) => /NothingChanged|skipped/i.test(S(c.result)));
        const anc = checks(t3).find((c) => S(c.check) === "CheckAncestors");
        const o = {
          correct: checks(t1),
          detected: t2.ok ? { type: rb(t2).textureType, checks: checks(t2) } : S(t2.code),
          wrong: t3 ? { checks: checks(t3), fatal: rb(t3).fatal } : null,
        };
        const p =
          !t1.ok || !t3
            ? partial(
                "P-W2-17",
                o,
                `texture or setAncestor refused: ${!t1.ok ? why(t1) : why(set)}`,
              )
            : clean(t1) && anc && !/NothingChanged/i.test(S(anc.result))
              ? partial(
                  "P-W2-17",
                  o,
                  `correct texture clean; wrong ancestor CheckAncestors=${S(anc.result)}, fatal ${S(rb(t3).fatal)}; no prompt on this -scriptAuthorizeAll launch; the no-flag launch half is not run`,
                )
              : partial("P-W2-17", o, "the results differ from the spec's expectation (recorded)");
        if (!t1.ok) fails.push(`texture co: ${why(t1)}`);
        if (!t2.ok) fails.push(`texture detected: ${why(t2)}`);
        if (!orig) fails.push("the PC configuration names no ancestor: nothing to restore to");
        if (back && !back.ok) fails.push(`restore: ${why(back)}`);
        const metaRel = metaOf(ctx, TEX);
        evidence.metaRel = metaRel;
        const absent = absentMeta(metaRel, start, end);
        if (absent) fails.push(absent);
        else if (!same(start, end))
          fails.push(
            `${metaRel} is not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`,
          );
        return {
          ...verdictOf(
            fails,
            [p],
            `type ${S(rb(t2).textureType)}; wrong ancestor ${S(anc?.result)}`,
          ),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w2-31-fix-texture",
      block: "W2.3",
      title:
        "wb_validate fixTexture (dry, confirm) after a deliberate wrong ancestor (P-W2-18); restored through wb_meta setAncestor",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "the dry run writes nothing; confirm saves the meta with the base config as ancestor; the restore is byte-identical",
      kill_criterion: `no change on disk: KILLED (fixTexture is dropped, DoChecks falls to texture); ${WINDOW_KILL}`,
      side_effects: [`${metaRelOf(TEX)} ancestor changed and fixed, then restored`],
      rollback:
        "wb_meta setAncestor with the original ResourceName; wb_meta clear for any variable fixTexture set",
      probes: ["P-W2-18"],
      dependsOn: ["P-W2-01"],
      writes: [metaRelOf(TEX)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_meta", "get", { path: TEX }),
        tc("wb_resources", "resolve", { path: TEXTURE_NORMAL_PATH }),
        tc("wb_meta", "setAncestor", { path: TEX, value: "<wrong base>", confirm: true }),
        tc("wb_validate", "fixTexture", { path: TEX, typeName: "co" }, { note: "dry run" }),
        tc("wb_validate", "fixTexture", { path: TEX, typeName: "co", confirm: true }),
        tc("wb_meta", "get", { path: TEX }),
        tc("wb_meta", "setAncestor", { path: TEX, value: "<original>", confirm: true }),
        tc(
          "wb_meta",
          "clear",
          { path: TEX, name: "<a variable fixTexture set>", confirm: true },
          { note: "only when the restore is not yet byte-identical" },
        ),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const start = bytesOf(ctx, metaOf(ctx, TEX));
        const g0 = await ctx.tool("wb_meta", { action: "get", path: TEX });
        const orig = pcAncestor(g0);
        if (!orig)
          return {
            status: "NOT-RUN",
            detail: "the PC configuration names no ancestor",
            evidence: { get: brief(g0) },
          };
        const wrong = await wrongAncestor(ctx, orig);
        const set = await ctx.tool("wb_meta", {
          action: "setAncestor",
          path: TEX,
          value: wrong,
          confirm: true,
        });
        const wrongBytes = bytesOf(ctx, metaOf(ctx, TEX));
        const dry = await ctx.tool("wb_validate", {
          action: "fixTexture",
          path: TEX,
          typeName: "co",
        });
        const dryIdentical = same(wrongBytes, bytesOf(ctx, metaOf(ctx, TEX)));
        const fix = await ctx.tool("wb_validate", {
          action: "fixTexture",
          path: TEX,
          typeName: "co",
          confirm: true,
        });
        const fixedBytes = bytesOf(ctx, metaOf(ctx, TEX));
        const g1 = await ctx.tool("wb_meta", { action: "get", path: TEX });
        const back = await ctx.tool("wb_meta", {
          action: "setAncestor",
          path: TEX,
          value: orig,
          confirm: true,
        });
        const extra: Raw[] = [];
        if (!same(start, bytesOf(ctx, metaOf(ctx, TEX)))) {
          // fixTexture may also have written variables (changed rows "PC.Var"): each inverse is a
          // clear when the variable had no value before, else a set with its before value.
          const rows = Array.isArray(fix.changed) ? (fix.changed as Raw[]) : [];
          for (const c of rows) {
            const key = S(c.path).split(".").pop() ?? "";
            if (!key || /ancestor/i.test(key)) continue;
            const before = c.before;
            const r =
              before === null || before === undefined
                ? await ctx.tool("wb_meta", {
                    action: "clear",
                    path: TEX,
                    name: key,
                    confirm: true,
                  })
                : await ctx.tool("wb_meta", {
                    action: "set",
                    path: TEX,
                    name: key,
                    value: S(before),
                    confirm: true,
                  });
            extra.push({ name: key, before: before ?? null, inverse: brief(r) });
          }
        }
        const end = bytesOf(ctx, metaOf(ctx, TEX));
        const evidence: Raw = {
          orig,
          wrong,
          setWrong: brief(set),
          dry: brief(dry),
          fix: brief(fix),
          getAfterFix: brief(g1),
          restore: brief(back),
          extraRestores: extra,
          fixDiff: diffOf(wrongBytes, fixedBytes),
          restoredIdentical: same(start, end),
        };
        const fails: string[] = [];
        if (!set.ok) fails.push(`setAncestor wrong: ${why(set)}`);
        const metaRel = metaOf(ctx, TEX);
        evidence.metaRel = metaRel;
        const absent = absentMeta(metaRel, start, wrongBytes, fixedBytes, end);
        if (absent) fails.push(absent);
        else if (!dryIdentical) fails.push(`the fixTexture dry run changed ${metaRel}`);
        if (!back.ok) fails.push(`restore: ${why(back)}`);
        if (pcAncestor(await ctx.tool("wb_meta", { action: "get", path: TEX })) !== orig)
          fails.push("the ancestor does not read back as the original");
        const o = {
          wrong,
          afterFix: pcAncestor(g1),
          saved: rb(fix).saved ?? null,
          changed: fix.changed ?? null,
          restoredIdentical: same(start, end),
        };
        const p = !fix.ok
          ? partial("P-W2-18", o, why(fix))
          : absent
            ? partial("P-W2-18", o, absent)
            : rb(fix).saved === true && !same(wrongBytes, fixedBytes)
              ? same(start, end)
                ? settled("P-W2-18", o, "fixed on disk; the restore is byte-identical")
                : partial(
                    "P-W2-18",
                    o,
                    "fixed on disk; the restore is not byte-identical (diff recorded)",
                  )
              : killed("P-W2-18", o, "no change on disk after ReportAndFix");
        return {
          ...verdictOf(fails, [p], `ancestor ${wrong} -> ${pcAncestor(g1)} -> restored`),
          evidence,
          probes: [p],
        };
      },
    },

    // ── W2.4 create ──
    {
      id: "w2-40-create",
      block: "W2.4",
      title:
        "wb_resources create .conf, .emat and .layout (dry, confirm), .conf and .emat with inherit (P-W2-11, P-W2-12); each loaded by wb_container describe",
      risk: "mutating",
      timeout_ms: 180_000,
      expected:
        "dry runs write nothing; each confirm writes the file and its .meta and answers a GUID; describe loads each; the inherited .conf's header names the ancestor",
      kill_criterion:
        "P-W2-11: .layout is not a plain container (create refuses UNSUPPORTED_TYPE or it does not load): KILLED for the layout; P-W2-12: the ancestor is dropped: KILLED",
      side_effects: [`five files and their .meta under ${CREATED_DIR}/`],
      rollback: "`w2.live.ts rollback` removes them",
      probes: ["P-W2-11", "P-W2-12"],
      writes: [`${CREATED_DIR}/`],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...CREATES.flatMap((c) => [
          tc(
            "wb_resources",
            "create",
            { path: c.path, className: c.className, ...(c.inherit ? { inherit: c.inherit } : {}) },
            { note: "dry run" },
          ),
          tc(
            "wb_resources",
            "create",
            {
              path: c.path,
              className: c.className,
              ...(c.inherit ? { inherit: c.inherit } : {}),
              confirm: true,
            },
            { note: "only when the file is absent" },
          ),
          tc("wb_container", "describe", { target: `path:${c.path}` }),
        ]),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const result: Record<string, { saved: boolean; loaded: boolean; code: string }> = {};
        for (const c of CREATES) {
          const inherit = c.inherit === "<W2_mat>" ? fx[MAT] : c.inherit;
          const args: Raw = {
            action: "create",
            path: c.path,
            className: c.className,
            ...(inherit ? { inherit } : {}),
          };
          const present = ctx.deps.exists(abs(ctx.opts.sandboxDir, c.path));
          const e: Raw = { alreadyPresent: present };
          let made: ToolResponse | null = null;
          if (!present) {
            const dry = await ctx.tool("wb_resources", args);
            e.dry = brief(dry);
            if (ctx.deps.exists(abs(ctx.opts.sandboxDir, c.path)))
              fails.push(`${c.path}: the dry run wrote it`);
            made = await ctx.tool("wb_resources", { ...args, confirm: true });
            e.confirm = brief(made);
          }
          const onDisk = ctx.deps.exists(abs(ctx.opts.sandboxDir, c.path));
          const d = onDisk
            ? await ctx.tool("wb_container", { action: "describe", target: `path:${c.path}` })
            : null;
          e.describe = brief(d);
          e.head = textOf(ctx, c.path).split(/\r?\n/)[0] ?? "";
          evidence[c.path] = e;
          result[c.path] = {
            saved: onDisk && (!made || made.ok),
            loaded: !!d?.ok,
            code: made && !made.ok ? S(made.code) : d && !d.ok ? S(d.code) : "",
          };
          if (made && !made.ok && !(c.path.endsWith(".layout") && made.code === "UNSUPPORTED_TYPE"))
            fails.push(`${c.path}: ${why(made)}`);
          const createdMeta = metaRelOf(c.path, S(rb(made).resourceName));
          if (onDisk && !ctx.deps.exists(abs(ctx.opts.sandboxDir, createdMeta)))
            fails.push(`${c.path}: no ${createdMeta}`);
        }
        const L = result[CREATES[2]!.path]!;
        const plain = [CREATES[0]!, CREATES[1]!].every(
          (c) => result[c.path]!.saved && result[c.path]!.loaded,
        );
        const p11 =
          !L.saved || !L.loaded
            ? killed(
                "P-W2-11",
                result,
                `.layout: ${L.code || "not loaded"}: create refuses .layout (UNSUPPORTED_TYPE) and layouts stay with layout_create/layout_edit`,
              )
            : plain
              ? settled(
                  "P-W2-11",
                  result,
                  ".conf, .emat and .layout written, registered and loaded",
                )
              : partial("P-W2-11", result, "a .conf or .emat did not save or load");
        const inhConf = CREATES[3]!.path;
        const head = textOf(ctx, inhConf);
        const names = head.includes(guidOf(VANILLA_CONF_NAME));
        const o12 = {
          header: head.split(/\r?\n/)[0] ?? "",
          loaded: result[inhConf]!.loaded,
          emat: result[CREATES[4]!.path],
        };
        const p12 = !result[inhConf]!.saved
          ? partial("P-W2-12", o12, `the inherited create answered ${result[inhConf]!.code}`)
          : names
            ? settled("P-W2-12", o12, "the saved text names the ancestor")
            : killed(
                "P-W2-12",
                o12,
                "the ancestor was dropped: inherit moves to config_edit.createInherited",
              );
        return {
          ...verdictOf(fails, [p11, p12], `${CREATES.length} creates`),
          evidence,
          probes: [p11, p12],
        };
      },
    },

    // ── W2.5 Resource Manager opened resource ──
    {
      id: "w2-50-rm-open",
      block: "W2.5",
      title:
        "open:ResourceManager with none, the .emat, then the .emat and the .conf open (P-W2-14); set, save, set back, save on the opened .emat (P-W2-15)",
      risk: "mutating",
      timeout_ms: 300_000,
      expected:
        "none open: NO_OPEN_RESOURCE; wb_module setResource of the .conf on the World Editor: INVALID_ARGUMENT naming ResourceManager, no window; wb_resources open of the .emat and the .conf: openedIn ResourceManager, no dialog; after the .emat open describe answers the .emat's class (run 3: MatPBRBasicGlass, 166 rows); set and save change the .emat on disk, set back and save return it, the .conf untouched; after the .conf open describe answers the .conf's class, the .emat's, or NO_OPEN_RESOURCE (recorded, run 3: a .conf exposed none)",
      kill_criterion: `P-W2-14: describe answers NO_OPEN_RESOURCE after the .emat and after the .conf, polled ${RM_POLLS} times each: KILLED; P-W2-15: the guard finds no path (set/save NOT_IN_PROJECT): KILLED; ${WINDOW_KILL}`,
      side_effects: [
        `${MAT} changed and saved, then set back and saved (the engine may canonicalise the text, U11)`,
        "two Resource Manager tabs left open, unedited (closed with Workbench)",
      ],
      rollback:
        "set back with before and save; the tabs close with Workbench (wb_module close is refused, DEC-045)",
      probes: ["P-W2-14", "P-W2-15"],
      writes: [MAT],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_container", "describe", { target: "open:ResourceManager" }),
        tc(
          "wb_module",
          "setResource",
          { moduleName: "WorldEditor", path: CFG },
          {
            note: "refused INVALID_ARGUMENT before any module is touched: the World Editor opens only .ent and .et (W2 run 2: a .conf raised a modal)",
          },
        ),
        tc(
          "wb_resources",
          "setResource",
          { moduleName: "ResourceManager", path: MAT },
          {
            toolAction: "open",
            target: "EMCP_WB_Module",
            note: "wb_resources open, routed to wb_module setResource in the owning module (run 3: no dialog)",
          },
        ),
        tc(
          "wb_container",
          "describe",
          { target: "open:ResourceManager", mode: "page", fields: PAGE_FIELDS, limit: 200 },
          {
            note: `polled up to ${RM_POLLS} times, ${RM_POLL_MS} ms apart, while NO_OPEN_RESOURCE`,
          },
        ),
        tc("wb_container", "get", {
          target: "open:ResourceManager",
          resource: MAT,
          path: "<scalar path>",
        }),
        tc(
          "wb_container",
          "set",
          {
            target: "open:ResourceManager",
            resource: MAT,
            path: "<scalar path>",
            value: "<other>",
          },
          { note: "dry run" },
        ),
        tc("wb_container", "set", {
          target: "open:ResourceManager",
          resource: MAT,
          path: "<scalar path>",
          value: "<other>",
          confirm: true,
        }),
        tc(
          "wb_container",
          "save",
          { target: "open:ResourceManager", resource: MAT },
          { note: "dry run" },
        ),
        tc("wb_container", "save", {
          target: "open:ResourceManager",
          resource: MAT,
          confirm: true,
        }),
        tc("wb_container", "set", {
          target: "open:ResourceManager",
          resource: MAT,
          path: "<scalar path>",
          value: "<before>",
          confirm: true,
        }),
        tc("wb_container", "save", {
          target: "open:ResourceManager",
          resource: MAT,
          confirm: true,
        }),
        tc(
          "wb_resources",
          "setResource",
          { moduleName: "ResourceManager", path: CFG },
          {
            toolAction: "open",
            target: "EMCP_WB_Module",
            note: "wb_resources open, routed to wb_module setResource in the owning module (run 3: no dialog)",
          },
        ),
        tc(
          "wb_container",
          "describe",
          { target: "open:ResourceManager" },
          { note: `polled up to ${RM_POLLS} times while NO_OPEN_RESOURCE` },
        ),
        tc(
          "wb_container",
          "set",
          {
            target: "open:ResourceManager",
            resource: MAT,
            path: "<scalar path>",
            value: "<before>",
          },
          { note: "dry run: the write guard's answer with two tabs open" },
        ),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const T = "open:ResourceManager";
        const matStart = bytesOf(ctx, MAT);
        const cfgStart = bytesOf(ctx, CFG);
        const matClass = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(textOf(ctx, MAT))?.[1] ?? "";
        const cfgClass = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(textOf(ctx, CFG))?.[1] ?? "";
        const d0 = await ctx.tool("wb_container", { action: "describe", target: T });
        evidence.describeNone = brief(d0);
        if (d0.ok) {
          // A resumed run: tabs from an earlier run are open.
          return {
            status: "NOT-RUN",
            detail:
              "the Resource Manager already holds an opened resource (an earlier run's tabs): restart Workbench for this step (wb_module close is refused)",
            evidence,
          };
        }
        // W2 run 2: a .conf handed to the World Editor raised the modal "Cannot open prefabs at this
        // time (not implemented)". The World Editor is never asked for a non-world file now.
        const weRefused = await ctx.tool("wb_module", {
          action: "setResource",
          module: "WorldEditor",
          target: `path:${CFG}`,
        });
        evidence.worldEditorRefusal = { ...brief(weRefused), next: weRefused.next ?? null };
        if (weRefused.ok || weRefused.code !== "INVALID_ARGUMENT")
          fails.push(
            `wb_module setResource of ${CFG} on the World Editor answered ${weRefused.ok ? "ok" : S(weRefused.code)}, not INVALID_ARGUMENT`,
          );
        else if (!S(weRefused.next).includes("ResourceManager"))
          fails.push(
            `the World Editor refusal does not name ResourceManager: ${S(weRefused.next)}`,
          );
        // Run 3 opened the .conf first and read NO_OPEN_RESOURCE; the .emat opened next read
        // MatPBRBasicGlass at once. The .emat goes first now, alone, so a write meets one tab, and a
        // describe that is refused is polled to tell a slow open from a type that exposes nothing.
        const polled = async (args: Raw): Promise<{ last: ToolResponse; tries: Raw[] }> => {
          const tries: Raw[] = [];
          let last = await ctx.tool("wb_container", args);
          tries.push({ ok: last.ok, code: last.code ?? null, message: last.message ?? null });
          for (let i = 1; i < RM_POLLS && !last.ok && last.code === "NO_OPEN_RESOURCE"; i++) {
            await ctx.sleep(RM_POLL_MS);
            last = await ctx.tool("wb_container", args);
            tries.push({ ok: last.ok, code: last.code ?? null, message: last.message ?? null });
          }
          return { last, tries };
        };
        const oMat = await ctx.tool("wb_resources", { action: "open", path: MAT });
        evidence.openMat = brief(oMat);
        if (!oMat.ok) fails.push(`open .emat: ${why(oMat)}`);
        else if (S(rb(oMat).openedIn) !== "ResourceManager")
          fails.push(
            `wb_resources open of ${MAT} opened in '${S(rb(oMat).openedIn)}', not ResourceManager`,
          );
        const pm = await polled({
          action: "describe",
          target: T,
          mode: "page",
          fields: PAGE_FIELDS,
          limit: 200,
        });
        const dMat = pm.last;
        evidence.describeMat = {
          ok: dMat.ok,
          code: dMat.code ?? null,
          rootClass: rb(dMat).rootClass ?? null,
          total: rb(dMat).total ?? null,
          tries: pm.tries,
        };
        const matExposed = dMat.ok && S(rb(dMat).rootClass) === matClass && matClass !== "";
        // A top-level scalar of the opened .emat: set to another integer value, never a float sum.
        const row = matExposed
          ? (rowsOf(dMat).find(
              (x) =>
                S(x.type) === "SCALAR" &&
                !S(x.path).includes(".") &&
                /^-?\d+(\.\d+)?$/.test(S(x.value)),
            ) ?? null)
          : null;
        const path = row ? S(row.path) : "";
        let p15: ProbeResult;
        if (!path) {
          p15 = partial(
            "P-W2-15",
            {
              describe: dMat.ok ? `no top-level scalar in ${S(rb(dMat).rootClass)}` : S(dMat.code),
            },
            "no scalar to write",
          );
        } else {
          const g = await ctx.tool("wb_container", { action: "get", target: T, path });
          const v = S(rb(g).value);
          const nv = Number(v) === 1 ? "2" : "1";
          const sDry = await ctx.tool("wb_container", {
            action: "set",
            target: T,
            path,
            value: nv,
          });
          const s1 = await ctx.tool("wb_container", {
            action: "set",
            target: T,
            path,
            value: nv,
            confirm: true,
          });
          const svDry = await ctx.tool("wb_container", { action: "save", target: T });
          const sv1 = await ctx.tool("wb_container", { action: "save", target: T, confirm: true });
          const mid = bytesOf(ctx, MAT);
          const cfgMid = bytesOf(ctx, CFG);
          const s2 = await ctx.tool("wb_container", {
            action: "set",
            target: T,
            path,
            value: v,
            confirm: true,
          });
          const sv2 = await ctx.tool("wb_container", { action: "save", target: T, confirm: true });
          const end = bytesOf(ctx, MAT);
          Object.assign(evidence, {
            get: brief(g),
            setDry: brief(sDry),
            set: brief(s1),
            saveDry: brief(svDry),
            save: brief(sv1),
            setBack: brief(s2),
            saveBack: brief(sv2),
            savedDiff: diffOf(matStart, mid),
            restoredDiff: diffOf(matStart, end),
          });
          const o = {
            path,
            before: v,
            sent: nv,
            setCode: s1.code ?? null,
            saveCode: sv1.code ?? null,
            changedOnDisk: !same(matStart, mid),
            restoredIdentical: same(matStart, end),
            cfgTouched: !same(cfgStart, cfgMid),
          };
          if (o.cfgTouched)
            fails.push(`saving the opened ${MAT} changed ${CFG}: Save wrote another file`);
          if (!s1.ok && s1.code === "NOT_IN_PROJECT")
            p15 = killed(
              "P-W2-15",
              o,
              "the guard found no path for the opened resource: open:ResourceManager stays read-only",
            );
          else if (!s1.ok || !sv1.ok)
            p15 = partial("P-W2-15", o, `set/save answered ${why(s1.ok ? sv1 : s1)}`);
          else if (same(matStart, mid))
            p15 = killed("P-W2-15", o, "the save did not change the disk text");
          else
            p15 = same(matStart, end)
              ? settled(
                  "P-W2-15",
                  o,
                  "the .emat changed on disk and returned byte-identical; the guard resolved the path",
                )
              : partial(
                  "P-W2-15",
                  o,
                  "the .emat changed on disk and was set back, but the engine re-wrote it (canonicalised, U11; diff recorded)",
                );
          if (s1.ok && (!s2.ok || !sv2.ok)) fails.push(`set back / save: ${why(s2.ok ? sv2 : s2)}`);
        }
        const oCfg = await ctx.tool("wb_resources", { action: "open", path: CFG });
        evidence.openCfg = brief(oCfg);
        if (!oCfg.ok) fails.push(`open .conf: ${why(oCfg)}`);
        else if (S(rb(oCfg).openedIn) !== "ResourceManager")
          fails.push(
            `wb_resources open of ${CFG} opened in '${S(rb(oCfg).openedIn)}', not ResourceManager`,
          );
        const pc = await polled({ action: "describe", target: T });
        const dCfg = pc.last;
        evidence.describeAfterCfg = { ...brief(dCfg), tries: pc.tries };
        const afterCfg = dCfg.ok ? S(rb(dCfg).rootClass) : S(dCfg.code);
        const w2 = await ctx.tool("wb_container", {
          action: "set",
          target: T,
          path: path || CFG_SCALAR,
          value: "1",
        });
        evidence.writeWithTwo = brief(w2);
        const held = /holds (\d+) opened/.exec(S(w2.message));
        const o14 = {
          none: S(d0.code),
          noneMessage: S(d0.message),
          emat: dMat.ok ? S(rb(dMat).rootClass) : S(dMat.code),
          ematTries: pm.tries.length,
          afterConf: afterCfg,
          confTries: pc.tries.length,
          confClass: cfgClass,
          heldWithTwo: held ? Number(held[1]) : null,
          writeWithTwo: w2.ok ? "dry run answered" : S(w2.code),
        };
        const cfgExposed = dCfg.ok && S(rb(dCfg).rootClass) === cfgClass;
        const p14 = !oMat.ok
          ? partial(
              "P-W2-14",
              o14,
              `wb_resources open answered ${why(oMat)}: the container after an open is not observed`,
            )
          : !matExposed && !dCfg.ok
            ? killed(
                "P-W2-14",
                o14,
                `GetContainer(0) held no container after the .emat or the .conf open (polled ${RM_POLLS} times each): open:ResourceManager is refused and the rows re-point W8`,
              )
            : matExposed && held && Number(held[1]) === 2 && cfgExposed
              ? settled(
                  "P-W2-14",
                  o14,
                  `the count tracks the tabs (2 with two open); index 0 with two open reads ${afterCfg}`,
                )
              : partial(
                  "P-W2-14",
                  o14,
                  `the .emat's container is read (${matExposed ? matClass : "no"}); after the .conf open index 0 reads ${afterCfg}; the count ${held ? `answers ${held[1]}` : "is 1 with two tabs (the write guard did not refuse)"}`,
                );
        return {
          ...verdictOf(fails, [p14, p15], `rootClass ${S(rb(dMat).rootClass)} / ${afterCfg}`),
          evidence,
          probes: [p14, p15],
        };
      },
    },

    // ── W2.6 prefab from model ──
    {
      id: "w2-60-prefab-model",
      block: "W2.6",
      title:
        "wb_resources prefabFromModel (dry, confirm) with the W2 world open (P-W2-16); the entity count unchanged; the .et loaded",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 180_000,
      expected:
        "the W2 world (wb_world new under _throwaway/W2/worlds/) opens; the .et is written with MeshObject.Object = the xob; the world entity count is unchanged; one undo pays the action",
      kill_criterion: `the world is left dirty or the count changed: KILLED (the battery undoes the action); ${WINDOW_KILL}`,
      side_effects: [`${WORLD} (+ layer and .meta), ${PREFAB_ET} and its .meta`],
      rollback:
        "one Edit > Undo for the action; rollback removes the files; the world is never saved",
      probes: ["P-W2-16"],
      writes: [WORLD, `${WORLDS_DIR}/`, PREFAB_ET],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc(
          "wb_resources",
          "prefabFromModel",
          { xobPath: VANILLA_XOB, path: PREFAB_ET },
          { note: "dry run" },
        ),
        tc(
          "wb_resources",
          "prefabFromModel",
          { xobPath: VANILLA_XOB, path: PREFAB_ET, confirm: true },
          { note: "only when the .et is absent" },
        ),
        tc("wb_entity", "list", { limit: 1 }),
        ...undoPlan(1),
        tc("wb_container", "describe", {
          target: `path:${PREFAB_ET}`,
          mode: "page",
          fields: PAGE_FIELDS,
          limit: 200,
        }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, evidence, fails)))
          return {
            status: "FAIL",
            detail: fails.join("; ") || "the W2 world did not open",
            evidence,
          };
        const c0 = await ctx.tool("wb_entity", { action: "list", limit: 1 });
        const present = ctx.deps.exists(abs(ctx.opts.sandboxDir, PREFAB_ET));
        const dry = await ctx.tool("wb_resources", {
          action: "prefabFromModel",
          xobPath: VANILLA_XOB,
          path: PREFAB_ET,
        });
        if (!present && ctx.deps.exists(abs(ctx.opts.sandboxDir, PREFAB_ET)))
          fails.push("the dry run wrote the .et");
        const made = present
          ? null
          : await ctx.tool("wb_resources", {
              action: "prefabFromModel",
              xobPath: VANILLA_XOB,
              path: PREFAB_ET,
              confirm: true,
            });
        const c1 = await ctx.tool("wb_entity", { action: "list", limit: 1 });
        const undo = made?.ok ? await ctx.undo() : null;
        const c2 = await ctx.tool("wb_entity", { action: "list", limit: 1 });
        const d = ctx.deps.exists(abs(ctx.opts.sandboxDir, PREFAB_ET))
          ? await ctx.tool("wb_container", {
              action: "describe",
              target: `path:${PREFAB_ET}`,
              mode: "page",
              fields: PAGE_FIELDS,
              limit: 200,
            })
          : null;
        const xobRow = rowsOf(d).find((r) => S(r.value).includes("GlassBeer_01.xob"));
        Object.assign(evidence, {
          alreadyPresent: present,
          countBefore: rb(c0).total ?? null,
          dry: brief(dry),
          made: brief(made),
          countAfter: rb(c1).total ?? null,
          undo,
          countAfterUndo: rb(c2).total ?? null,
          describe: d
            ? { ok: d.ok, code: d.code ?? null, rootClass: rb(d).rootClass ?? null, xobRow }
            : null,
          text: textOf(ctx, PREFAB_ET).slice(0, 600),
        });
        const o = {
          countBefore: rb(c0).total ?? null,
          countAfter: rb(c1).total ?? null,
          countAfterUndo: rb(c2).total ?? null,
          xob: xobRow ? S(xobRow.value) : null,
          undo: undo?.message ?? null,
        };
        let p: ProbeResult;
        if (present)
          p = partial(
            "P-W2-16",
            o,
            "the .et was present from an earlier run: no confirm sent; the load and the xob read back",
          );
        else if (!made?.ok)
          p = partial("P-W2-16", o, `prefabFromModel answered ${made ? why(made) : "not sent"}`);
        else if (Number(rb(c0).total) !== Number(rb(c1).total))
          p = killed("P-W2-16", o, "the world entity count changed: the battery undid the action");
        else
          p = xobRow
            ? settled("P-W2-16", o, "the .et names the xob; the count is unchanged; no FileIO call")
            : partial(
                "P-W2-16",
                o,
                "count unchanged, but the .et's MeshObject did not read back the xob",
              );
        if (made && !made.ok) fails.push(`prefabFromModel: ${why(made)}`);
        if (d && !d.ok) fails.push(`the .et did not load: ${why(d)}`);
        return {
          ...verdictOf(
            fails,
            [p],
            `.et ${PREFAB_ET}; count ${S(rb(c0).total)} -> ${S(rb(c1).total)}`,
          ),
          evidence,
          probes: [p],
        };
      },
    },

    // ── W2.7 offline tools: the engine-accept proofs ──
    {
      id: "w2-70-meta-file",
      block: "W2.7",
      title:
        "meta_file read, scan, set, clear, setAncestor on the offline texture copy's .meta; Workbench reads the edit back (P-W2-20)",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "register makes the copy's .meta; meta_file set writes it; wb_meta vars reads the new value with no 'meta file corrupted' answer; clear/setAncestor round trips return the .meta byte-identical",
      kill_criterion: `the edit is rejected (wb_meta refuses or reads the old value): KILLED (meta_file is read-only and writes go through wb_meta); ${WINDOW_KILL}`,
      side_effects: [`${metaRelOf(OFF_TEX)} created by register, then edited offline and restored`],
      rollback: "the inverse meta_file writes; rollback removes the files",
      probes: ["P-W2-20"],
      writes: [metaRelOf(OFF_TEX)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_resources", "register", { path: OFF_TEX, confirm: true }),
        tc("wb_meta", "vars", { path: OFF_TEX, fields: VAR_FIELDS, limit: 200 }),
        tc("wb_meta", "get", { path: OFF_TEX }),
        tc(
          "wb_meta",
          "vars",
          { path: OFF_TEX, fields: VAR_FIELDS, limit: 200 },
          { note: "the engine reads the offline edit" },
        ),
      ],
      offlineCalls: () => [
        oc("meta_file", "read", { path: OFF_TEX }),
        oc("meta_file", "scan", { folder: W2_ROOT }),
        oc("meta_file", "set", {
          path: OFF_TEX,
          key: "<enum var>",
          value: "<other>",
          configuration: "PC",
        }),
        oc("meta_file", "set", {
          path: OFF_TEX,
          key: "<enum var>",
          value: "<other>",
          configuration: "PC",
          confirm: true,
        }),
        oc("meta_file", "clear", {
          path: OFF_TEX,
          key: "<enum var>",
          configuration: "PC",
          confirm: true,
        }),
        oc("meta_file", "set", {
          path: OFF_TEX,
          key: "<enum var>",
          value: "<before>",
          configuration: "PC",
          confirm: true,
        }),
        oc("meta_file", "setAncestor", {
          path: OFF_TEX,
          ancestor: TEXTURE_UNSPECIFIED,
          configuration: "PC",
          confirm: true,
        }),
        oc("meta_file", "setAncestor", {
          path: OFF_TEX,
          ancestor: "<before>",
          configuration: "PC",
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const reg = await ctx.tool("wb_resources", {
          action: "register",
          path: OFF_TEX,
          confirm: true,
        });
        evidence.register = brief(reg);
        if (!reg.ok) return { status: "FAIL", detail: `register: ${why(reg)}`, evidence };
        // The copy registers as <stem>.edds: its .meta is beside the resource the register answered.
        const metaRel = metaRelOf(OFF_TEX, S(rb(reg).resourceName));
        evidence.metaRel = metaRel;
        const start = bytesOf(ctx, metaRel);
        const rd = await ctx.offline("meta_file", { action: "read", path: OFF_TEX });
        const sc = await ctx.offline("meta_file", { action: "scan", folder: W2_ROOT });
        const v0 = await ctx.tool("wb_meta", {
          action: "vars",
          path: OFF_TEX,
          fields: VAR_FIELDS,
          limit: 200,
        });
        const pick = pickEnumVar(rowsOf(v0));
        Object.assign(evidence, {
          read: brief(rd),
          scan: { ok: sc.ok, total: rb(sc).total ?? null },
          pick,
        });
        if (!pick)
          return { status: "NOT-RUN", detail: "no enum variable on the copy's meta", evidence };
        // The text form w2-20 saw the engine write (number or name); not determined: the name, recorded.
        const form = ctx.state.get(ENUM_FORM_KEY) ?? "";
        const otherText = form === "number" ? pick.otherValue : pick.other;
        const currentText = form === "number" ? pick.currentValue : pick.current;
        evidence.enumForm = { observedInW2_20: form || "not determined", sent: otherText };
        const dry = await ctx.offline("meta_file", {
          action: "set",
          path: OFF_TEX,
          key: pick.name,
          value: otherText,
          configuration: "PC",
        });
        const afterDry = bytesOf(ctx, metaRel);
        const set = await ctx.offline("meta_file", {
          action: "set",
          path: OFF_TEX,
          key: pick.name,
          value: otherText,
          configuration: "PC",
          confirm: true,
        });
        const edited = bytesOf(ctx, metaRel);
        const g = await ctx.tool("wb_meta", { action: "get", path: OFF_TEX });
        const v1 = await ctx.tool("wb_meta", {
          action: "vars",
          path: OFF_TEX,
          fields: VAR_FIELDS,
          limit: 200,
        });
        const inv = pick.setDirectly
          ? await ctx.offline("meta_file", {
              action: "set",
              path: OFF_TEX,
              key: pick.name,
              value: currentText,
              configuration: "PC",
              confirm: true,
            })
          : await ctx.offline("meta_file", {
              action: "clear",
              path: OFF_TEX,
              key: pick.name,
              configuration: "PC",
              confirm: true,
            });
        // The other form of the pair, so both clear and set run confirmed.
        const pair1 = pick.setDirectly
          ? await ctx.offline("meta_file", {
              action: "clear",
              path: OFF_TEX,
              key: pick.name,
              configuration: "PC",
              confirm: true,
            })
          : await ctx.offline("meta_file", {
              action: "set",
              path: OFF_TEX,
              key: pick.name,
              value: currentText,
              configuration: "PC",
              confirm: true,
            });
        const pair2 = pick.setDirectly
          ? await ctx.offline("meta_file", {
              action: "set",
              path: OFF_TEX,
              key: pick.name,
              value: currentText,
              configuration: "PC",
              confirm: true,
            })
          : await ctx.offline("meta_file", {
              action: "clear",
              path: OFF_TEX,
              key: pick.name,
              configuration: "PC",
              confirm: true,
            });
        const view = rb(rd).configurations as Raw[] | undefined;
        const pc = Array.isArray(view)
          ? (view.find((c) => S(c.platform) === "PC") ?? view[0])
          : undefined;
        const origAnc =
          pc && pc.ancestor && typeof pc.ancestor === "object" ? S((pc.ancestor as Raw).value) : "";
        const a1 = await ctx.offline("meta_file", {
          action: "setAncestor",
          path: OFF_TEX,
          ancestor: TEXTURE_UNSPECIFIED,
          configuration: "PC",
          confirm: true,
        });
        const a2 = origAnc
          ? await ctx.offline("meta_file", {
              action: "setAncestor",
              path: OFF_TEX,
              ancestor: origAnc,
              configuration: "PC",
              confirm: true,
            })
          : null;
        const end = bytesOf(ctx, metaRel);
        Object.assign(evidence, {
          dry: brief(dry),
          set: brief(set),
          engineGet: brief(g),
          engineVars: { ok: v1.ok, code: v1.code ?? null, value: varValue(v1, pick.name) },
          inverse: brief(inv),
          pair: [brief(pair1), brief(pair2)],
          setAncestor: brief(a1),
          ancestorBack: brief(a2),
          origAncestor: origAnc,
          editDiff: diffOf(start, edited),
          restoredIdentical: same(start, end),
        });
        if (!set.ok) fails.push(`meta_file set: ${why(set)}`);
        for (const [k, r] of [
          ["inverse", inv],
          ["pair clear/set", pair1],
          ["pair set/clear", pair2],
          ["setAncestor", a1],
        ] as const)
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        if (!a2 || !a2.ok)
          fails.push(`setAncestor back: ${a2 ? why(a2) : "no original ancestor read"}`);
        const absent = absentMeta(metaRel, start, afterDry, edited, end);
        if (absent) fails.push(absent);
        else {
          if (!same(start, afterDry)) fails.push(`the meta_file dry run wrote ${metaRel}`);
          if (!same(start, end))
            fails.push(
              `${metaRel} is not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`,
            );
        }
        const accepted = g.ok && enumIs(v1, pick.name, pick.other);
        const o = {
          var: pick.name,
          written: otherText,
          engineReads: varValue(v1, pick.name),
          getCode: g.code ?? null,
        };
        const p = !set.ok
          ? partial("P-W2-20", o, `meta_file set refused: ${why(set)}`)
          : accepted
            ? partial(
                "P-W2-20",
                o,
                "the offline edit is read back by GetMetaFile in the same launch; the next-start half needs a relaunch (not in this one-launch battery; .conf and .imageset metas not edited here)",
              )
            : killed(
                "P-W2-20",
                o,
                `the engine read ${g.ok ? `'${varValue(v1, pick.name)}'` : why(g)} after the offline edit`,
              );
        return {
          ...verdictOf(fails, [p], `${pick.name} written offline and read back`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w2-71-imageset",
      block: "W2.7",
      title:
        "imageset create, addTexture, removeTexture, addGroup, addQuad, setQuad, remove, read; register, open in the Resource Manager, load (P-W2-21)",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "every write writes; register answers a GUID; the Resource Manager opens it; wb_container describe lists the quad W2_Q",
      kill_criterion: `the imageset is rejected (register or the load fails): KILLED (imageset write actions refuse; the Imageset menu rows re-point W8); ${WINDOW_KILL}`,
      side_effects: [`${OFF_SET} and its .meta; a Resource Manager tab (unedited)`],
      rollback: "rollback removes the files; the tab closes with Workbench",
      probes: ["P-W2-21"],
      writes: [OFF_SET],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_resources", "resolve", { path: OFF_TEX }),
        tc("wb_resources", "register", { path: OFF_SET, confirm: true }),
        tc(
          "wb_resources",
          "setResource",
          { moduleName: "ResourceManager", path: OFF_SET },
          {
            toolAction: "open",
            target: "EMCP_WB_Module",
            note: "wb_resources open, routed to wb_module setResource in the owning module (never the World Editor: W2 run 2 modal)",
          },
        ),
        tc("wb_container", "describe", {
          target: `path:${OFF_SET}`,
          mode: "page",
          fields: PAGE_FIELDS,
          limit: 200,
        }),
      ],
      offlineCalls: () => [
        oc("imageset", "create", {
          path: OFF_SET,
          refSize: [64, 64],
          texture: "<W2_tex_co.png resource name>",
          overwrite: true,
          confirm: true,
        }),
        oc("imageset", "addTexture", {
          path: OFF_SET,
          texture: "<W2_tex2_co.png resource name>",
          confirm: true,
        }),
        oc("imageset", "removeTexture", {
          path: OFF_SET,
          texture: "<W2_tex2_co.png resource name>",
          confirm: true,
        }),
        oc("imageset", "addGroup", { path: OFF_SET, group: "W2_G", confirm: true }),
        oc("imageset", "addQuad", {
          path: OFF_SET,
          group: "W2_G",
          name: "W2_Q",
          pos: [0, 0],
          size: [32, 32],
          confirm: true,
        }),
        oc("imageset", "setQuad", {
          path: OFF_SET,
          group: "W2_G",
          name: "W2_Q",
          size: [16, 16],
          confirm: true,
        }),
        oc("imageset", "addQuad", {
          path: OFF_SET,
          name: "W2_R",
          pos: [32, 32],
          size: [32, 32],
          confirm: true,
        }),
        oc("imageset", "remove", { path: OFF_SET, name: "W2_R", confirm: true }),
        oc("imageset", "read", { path: OFF_SET }),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const r2 = await ctx.tool("wb_resources", { action: "resolve", path: OFF_TEX });
        const tex2 = S(rb(r2).resourceName) || OFF_TEX;
        const ops: Array<[string, Raw]> = [
          [
            "create",
            {
              action: "create",
              path: OFF_SET,
              refSize: [64, 64],
              texture: fx[TEX],
              overwrite: true,
              confirm: true,
            },
          ],
          ["addTexture", { action: "addTexture", path: OFF_SET, texture: tex2, confirm: true }],
          [
            "removeTexture",
            { action: "removeTexture", path: OFF_SET, texture: tex2, confirm: true },
          ],
          ["addGroup", { action: "addGroup", path: OFF_SET, group: "W2_G", confirm: true }],
          [
            "addQuad",
            {
              action: "addQuad",
              path: OFF_SET,
              group: "W2_G",
              name: "W2_Q",
              pos: [0, 0],
              size: [32, 32],
              confirm: true,
            },
          ],
          [
            "setQuad",
            {
              action: "setQuad",
              path: OFF_SET,
              group: "W2_G",
              name: "W2_Q",
              size: [16, 16],
              confirm: true,
            },
          ],
          [
            "addQuad root",
            {
              action: "addQuad",
              path: OFF_SET,
              name: "W2_R",
              pos: [32, 32],
              size: [32, 32],
              confirm: true,
            },
          ],
          ["remove", { action: "remove", path: OFF_SET, name: "W2_R", confirm: true }],
          ["read", { action: "read", path: OFF_SET }],
        ];
        for (const [k, a] of ops) {
          const r = await ctx.offline("imageset", a);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        }
        evidence.text = textOf(ctx, OFF_SET);
        const reg = await ctx.tool("wb_resources", {
          action: "register",
          path: OFF_SET,
          confirm: true,
        });
        const open = reg.ok
          ? await ctx.tool("wb_resources", { action: "open", path: OFF_SET })
          : null;
        if (open?.ok && S(rb(open).openedIn) !== "ResourceManager")
          fails.push(
            `wb_resources open of ${OFF_SET} opened in '${S(rb(open).openedIn)}', not ResourceManager`,
          );
        const d = reg.ok
          ? await ctx.tool("wb_container", {
              action: "describe",
              target: `path:${OFF_SET}`,
              mode: "page",
              fields: PAGE_FIELDS,
              limit: 200,
            })
          : null;
        const quad = rowsOf(d).some(
          (r) =>
            S(r.value).includes("W2_Q") || S(r.name).includes("W2_Q") || S(r.path).includes("W2_Q"),
        );
        Object.assign(evidence, {
          register: brief(reg),
          open: brief(open),
          describe: d
            ? {
                ok: d.ok,
                code: d.code ?? null,
                rootClass: rb(d).rootClass ?? null,
                rows: rowsOf(d).slice(0, 40),
              }
            : null,
        });
        const o = {
          register: reg.ok ? S(rb(reg).resourceName) : S(reg.code),
          open: open ? (open.ok ? "ok" : S(open.code)) : null,
          loaded: d?.ok ?? false,
          quadListed: quad,
        };
        const p =
          !reg.ok || !d?.ok
            ? killed("P-W2-21", o, `rejected: ${!reg.ok ? why(reg) : d ? why(d) : "not loaded"}`)
            : quad && open?.ok
              ? partial(
                  "P-W2-21",
                  o,
                  "registered, opened in the Resource Manager and loaded with W2_Q; the texture shown and the log clean are read by the post-flight log check",
                )
              : partial("P-W2-21", o, "loaded, but the quad or the open did not read back");
        return { ...verdictOf(fails, [p], `imageset ${OFF_SET} loaded`), evidence, probes: [p] };
      },
    },
    {
      id: "w2-72-layout-edit",
      block: "W2.7",
      title:
        "layout_edit on the offline layout copy (every action), then Workbench loads it and reads the new widget back; the copy restored",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "each write writes; after register, wb_container describe (summary) of the edited layout lists the child node TextWidgetClass \"W2_T\" and get #<i>.Text reads 'w2 accept' (run 3: a page lists the root's variables only, never its child widgets); removing the two added widgets returns the layout byte-identical",
      kill_criterion: `the edited layout does not load or does not show W2_T: FAIL (no probe); ${WINDOW_KILL}`,
      side_effects: [
        `${OFF_LAYOUT} edited and restored (+ .meta); ${OFF_LAYOUT_PREFAB} and ${OFF_LAYOUT_CLASS} written`,
      ],
      rollback: "removeWidget of what was added; rollback removes the files",
      probes: [],
      writes: [OFF_LAYOUT, OFF_LAYOUT_PREFAB, OFF_LAYOUT_CLASS],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_resources", "register", { path: OFF_LAYOUT, confirm: true }),
        tc(
          "wb_container",
          "describe",
          { target: `path:${OFF_LAYOUT}` },
          { note: 'summary: the child nodes as #<i>=<Class> "<Name>" (GetNumChildren/GetChild)' },
        ),
        tc("wb_container", "get", { target: `path:${OFF_LAYOUT}`, path: "#<W2_T node>.Text" }),
      ],
      offlineCalls: () => LAYOUT_OPS.map(([, a]) => oc("layout_edit", S(a.action), a)),
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const start = bytesOf(ctx, OFF_LAYOUT);
        const [edits, inverses] = [
          LAYOUT_OPS.filter(([k]) => !k.startsWith("undo")),
          LAYOUT_OPS.filter(([k]) => k.startsWith("undo")),
        ];
        for (const [k, a] of edits) {
          const r = await ctx.offline("layout_edit", a);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        }
        const edited = bytesOf(ctx, OFF_LAYOUT);
        const reg = await ctx.tool("wb_resources", {
          action: "register",
          path: OFF_LAYOUT,
          confirm: true,
        });
        // A layout's widgets are child nodes of their parent (GetNumChildren/GetChild), not
        // variables, so run 3's page of the root's variables could never list W2_T. The summary
        // lists the child nodes as `#<i>=<Class> "<Name>"`; get reads one through `#<i>.<var>`.
        const d = await ctx.tool("wb_container", {
          action: "describe",
          target: `path:${OFF_LAYOUT}`,
        });
        const nodes = strs(rb(d).children).filter((c) => c.startsWith("#"));
        const node = layoutNode(nodes, "TextWidgetClass", "W2_T");
        const g =
          node !== null
            ? await ctx.tool("wb_container", {
                action: "get",
                target: `path:${OFF_LAYOUT}`,
                path: `#${node}.Text`,
              })
            : null;
        for (const [k, a] of inverses) {
          const r = await ctx.offline("layout_edit", a);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        }
        const end = bytesOf(ctx, OFF_LAYOUT);
        const seen = node !== null && !!g?.ok && S(rb(g).value) === "w2 accept";
        Object.assign(evidence, {
          register: brief(reg),
          describe: {
            ok: d.ok,
            code: d.code ?? null,
            rootClass: rb(d).rootClass ?? null,
            nodes,
          },
          engineGetText: brief(g),
          editDiff: diffOf(start, edited),
          restoredIdentical: same(start, end),
          prefab: ctx.deps.exists(abs(ctx.opts.sandboxDir, OFF_LAYOUT_PREFAB)),
          genClass: textOf(ctx, OFF_LAYOUT_CLASS).slice(0, 400),
        });
        if (!reg.ok) fails.push(`register: ${why(reg)}`);
        if (!d.ok) fails.push(`the engine did not load the edited layout: ${why(d)}`);
        else if (node === null)
          fails.push(
            `the engine's describe of the edited layout lists no TextWidgetClass "W2_T" node: ${JSON.stringify(nodes)}`,
          );
        else if (!seen)
          fails.push(
            `the engine reads W2_T's Text as ${g ? (g.ok ? `'${S(rb(g).value)}'` : why(g)) : "not sent"}, not 'w2 accept'`,
          );
        if (!same(start, end))
          fails.push(
            `the layout is not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`,
          );
        return {
          ...verdictOf(fails, [], "layout loaded by the engine with W2_T; restored"),
          evidence,
        };
      },
    },
    {
      id: "w2-73-config-edit",
      block: "W2.7",
      title:
        "config_edit on the offline .conf copy (read, set, arrayAdd, arrayRemove, setAncestor, clear, createInherited; override as a dry run), then Workbench loads the edits",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "set writes m_fDuration 12; register and wb_container get read 12; the inherited child loads and reads 15; the copy is restored by the inverses",
      kill_criterion: `the engine reads another value or does not load the file: FAIL (no probe); ${WINDOW_KILL}`,
      side_effects: [`${OFF_CONF} edited and restored (+ .meta); ${OFF_CONF_CHILD} (+ .meta)`],
      rollback:
        "the inverse writes; rollback removes the files; override is never confirmed (it would write the game file's own path outside _throwaway/W2/)",
      probes: [],
      writes: [OFF_CONF, OFF_CONF_CHILD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_resources", "register", { path: OFF_CONF, confirm: true }),
        tc("wb_container", "describe", {
          target: `path:${OFF_CONF}`,
          mode: "page",
          fields: PAGE_FIELDS,
          limit: 200,
        }),
        tc("wb_container", "get", { target: `path:${OFF_CONF}`, path: "<m_fDuration path>" }),
        tc("wb_resources", "register", { path: OFF_CONF_CHILD, confirm: true }),
        tc("wb_container", "get", { target: `path:${OFF_CONF_CHILD}`, path: "<m_fDuration path>" }),
      ],
      offlineCalls: () => [
        oc("config_edit", "read", { path: OFF_CONF, depth: 8 }),
        oc("config_edit", "set", { path: OFF_CONF, property: "<m_fDuration>", value: 12 }),
        oc("config_edit", "set", {
          path: OFF_CONF,
          property: "<m_fDuration>",
          value: 12,
          confirm: true,
        }),
        oc("config_edit", "arrayAdd", {
          path: OFF_CONF,
          property: "m_aHintEntries",
          item: { key: "SCR_HintEntry" },
          confirm: true,
        }),
        oc("config_edit", "arrayRemove", {
          path: OFF_CONF,
          property: "m_aHintEntries",
          index: 1,
          confirm: true,
        }),
        oc("config_edit", "setAncestor", {
          path: OFF_CONF,
          ancestor: VANILLA_CONF_NAME,
          confirm: true,
        }),
        oc("config_edit", "setAncestor", { path: OFF_CONF, ancestor: "", confirm: true }),
        oc("config_edit", "createInherited", {
          path: OFF_CONF,
          ancestor: "<W2_off.conf resource name>",
          newPath: OFF_CONF_CHILD,
          values: { "<m_fDuration>": 15 },
          overwrite: true,
          confirm: true,
        }),
        oc("config_edit", "set", {
          path: OFF_CONF,
          property: "<m_fDuration>",
          value: "<before>",
          confirm: true,
        }),
        oc("config_edit", "clear", { path: OFF_CONF, property: "<m_fDuration>", confirm: true }),
        oc("config_edit", "set", {
          path: OFF_CONF,
          property: "<m_fDuration>",
          value: "<before>",
          confirm: true,
        }),
        oc("config_edit", "override", {
          path: "Configs/Hints/Editor.conf",
          ancestor: VANILLA_CONF_NAME,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const start = bytesOf(ctx, OFF_CONF);
        const rd = await ctx.offline("config_edit", { action: "read", path: OFF_CONF, depth: 8 });
        const entries = Array.isArray(rb(rd).entries) ? (rb(rd).entries as Raw[]) : [];
        const e = entries.find((x) => S(x.key) === CFG_SCALAR && S(x.kind) === "scalar");
        evidence.read = { ok: rd.ok, entries: entries.length, scalar: e ?? null };
        if (!e)
          return {
            status: "FAIL",
            detail: `config_edit read lists no ${CFG_SCALAR} scalar`,
            evidence,
          };
        const prop = S(e.path);
        const before = S(e.value);
        const ops: Array<[string, Raw]> = [
          ["setDry", { action: "set", path: OFF_CONF, property: prop, value: 12 }],
          ["set", { action: "set", path: OFF_CONF, property: prop, value: 12, confirm: true }],
          [
            "arrayAdd",
            {
              action: "arrayAdd",
              path: OFF_CONF,
              property: "m_aHintEntries",
              item: { key: "SCR_HintEntry" },
              confirm: true,
            },
          ],
          [
            "arrayRemove",
            {
              action: "arrayRemove",
              path: OFF_CONF,
              property: "m_aHintEntries",
              index: 1,
              confirm: true,
            },
          ],
          [
            "setAncestor",
            { action: "setAncestor", path: OFF_CONF, ancestor: VANILLA_CONF_NAME, confirm: true },
          ],
          [
            "setAncestorBack",
            { action: "setAncestor", path: OFF_CONF, ancestor: "", confirm: true },
          ],
        ];
        for (const [k, a] of ops) {
          const r = await ctx.offline("config_edit", a);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
          if (k === "setDry" && !same(start, bytesOf(ctx, OFF_CONF)))
            fails.push("the set dry run wrote");
        }
        const reg = await ctx.tool("wb_resources", {
          action: "register",
          path: OFF_CONF,
          confirm: true,
        });
        const name = S(rb(reg).resourceName);
        const d = await ctx.tool("wb_container", {
          action: "describe",
          target: `path:${OFF_CONF}`,
          mode: "page",
          fields: PAGE_FIELDS,
          limit: 200,
        });
        const row = rowNamed(d, CFG_SCALAR);
        const g = row
          ? await ctx.tool("wb_container", {
              action: "get",
              target: `path:${OFF_CONF}`,
              path: S(row.path),
            })
          : null;
        const ci = await ctx.offline("config_edit", {
          action: "createInherited",
          path: OFF_CONF,
          ancestor: name,
          newPath: OFF_CONF_CHILD,
          values: { [prop]: 15 },
          overwrite: true,
          confirm: true,
        });
        const regChild = ci.ok
          ? await ctx.tool("wb_resources", {
              action: "register",
              path: OFF_CONF_CHILD,
              confirm: true,
            })
          : null;
        const gChild =
          regChild?.ok && row
            ? await ctx.tool("wb_container", {
                action: "get",
                target: `path:${OFF_CONF_CHILD}`,
                path: S(row.path),
              })
            : null;
        const back = await ctx.offline("config_edit", {
          action: "set",
          path: OFF_CONF,
          property: prop,
          value: Number(before),
          confirm: true,
        });
        const cl = await ctx.offline("config_edit", {
          action: "clear",
          path: OFF_CONF,
          property: prop,
          confirm: true,
        });
        const back2 = await ctx.offline("config_edit", {
          action: "set",
          path: OFF_CONF,
          property: prop,
          value: Number(before),
          confirm: true,
        });
        const ov = await ctx.offline("config_edit", {
          action: "override",
          path: "Configs/Hints/Editor.conf",
          ancestor: VANILLA_CONF_NAME,
        });
        const end = bytesOf(ctx, OFF_CONF);
        Object.assign(evidence, {
          register: brief(reg),
          describe: { ok: d.ok, code: d.code ?? null, row },
          engineGet: brief(g),
          createInherited: brief(ci),
          registerChild: brief(regChild),
          engineGetChild: brief(gChild),
          setBack: brief(back),
          clear: brief(cl),
          setBack2: brief(back2),
          overrideDry: brief(ov),
          restoredIdentical: same(start, end),
          restoredDiff: diffOf(start, end),
          childText: textOf(ctx, OFF_CONF_CHILD).slice(0, 600),
        });
        if (!reg.ok) fails.push(`register: ${why(reg)}`);
        if (!g || !g.ok)
          fails.push(
            `the engine did not read ${CFG_SCALAR}: ${g ? why(g) : d.ok ? "no row" : why(d)}`,
          );
        else if (Number(rb(g).value) !== 12)
          fails.push(`the engine reads ${CFG_SCALAR} '${S(rb(g).value)}', not 12`);
        if (!ci.ok) fails.push(`createInherited: ${why(ci)}`);
        else if (!gChild || !gChild.ok || Number(rb(gChild).value) !== 15)
          fails.push(
            `the inherited child reads ${gChild ? (gChild.ok ? S(rb(gChild).value) : why(gChild)) : "not loaded"}, not 15`,
          );
        for (const [k, r] of [
          ["set back", back],
          ["clear", cl],
          ["set back after clear", back2],
        ] as const)
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        if (!ov.ok || rb(ov).dryRun !== true)
          fails.push(`override dry run: ${ov.ok ? "not a dry run" : why(ov)}`);
        return {
          ...verdictOf(
            fails,
            [],
            `engine reads 12 and the child 15; copy restored ${same(start, end) ? "byte-identical" : "(diff recorded)"}`,
          ),
          evidence,
        };
      },
    },
    {
      id: "w2-74-project-settings",
      block: "W2.7",
      title:
        "project_settings read (the real .gproj, read only) and set/removeDependency/addDependency/addPlatform/removePlatform on the .gproj COPY; Workbench loads the copy",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "the real .gproj is read and never written; each write on the copy writes and its inverse returns it byte-identical; the copy is not registered (run 3: RegisterResourceFile false for a .gproj); wb_container get path:<copy> TITLE reads the new title when the engine loads it by path, else the engine accept is recorded not testable",
      kill_criterion: `the engine loads the copy and TITLE reads otherwise: FAIL (no probe); the copy not restored byte-identical or the real .gproj changed: FAIL; ${WINDOW_KILL}`,
      side_effects: [`${OFF_GPROJ} edited and restored`],
      rollback: "the inverse writes; rollback removes the copy",
      probes: [],
      writes: [OFF_GPROJ],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc(
          "wb_container",
          "get",
          { target: `path:${OFF_GPROJ}`, path: "TITLE" },
          {
            note: "by path, never registered (run 3: RegisterResourceFile false for a .gproj copy)",
          },
        ),
      ],
      offlineCalls: () => [
        oc("project_settings", "read", {}),
        oc("project_settings", "read", { path: OFF_GPROJ }),
        oc("project_settings", "set", {
          path: OFF_GPROJ,
          key: "TITLE",
          value: "EMCP2 W2 copy",
          confirm: true,
        }),
        oc("project_settings", "removeDependency", {
          path: OFF_GPROJ,
          guid: CORE_DEPENDENCY,
          confirm: true,
        }),
        oc("project_settings", "addDependency", {
          path: OFF_GPROJ,
          guid: CORE_DEPENDENCY,
          confirm: true,
        }),
        oc("project_settings", "addPlatform", {
          path: OFF_GPROJ,
          platform: "XBOX_ONE",
          confirm: true,
        }),
        oc("project_settings", "removePlatform", {
          path: OFF_GPROJ,
          platform: "XBOX_ONE",
          confirm: true,
        }),
        oc("project_settings", "set", {
          path: OFF_GPROJ,
          key: "TITLE",
          value: "<before>",
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const real = `${SANDBOX_NAME}.gproj`;
        const realBefore = bytesOf(ctx, real);
        const start = bytesOf(ctx, OFF_GPROJ);
        const r0 = await ctx.offline("project_settings", { action: "read" });
        const r1 = await ctx.offline("project_settings", { action: "read", path: OFF_GPROJ });
        const title = S(rb(r1).title);
        const ops: Array<[string, Raw]> = [
          [
            "set",
            { action: "set", path: OFF_GPROJ, key: "TITLE", value: "EMCP2 W2 copy", confirm: true },
          ],
          [
            "removeDependency",
            { action: "removeDependency", path: OFF_GPROJ, guid: CORE_DEPENDENCY, confirm: true },
          ],
          [
            "addDependency",
            { action: "addDependency", path: OFF_GPROJ, guid: CORE_DEPENDENCY, confirm: true },
          ],
          [
            "addPlatform",
            { action: "addPlatform", path: OFF_GPROJ, platform: "XBOX_ONE", confirm: true },
          ],
          [
            "removePlatform",
            { action: "removePlatform", path: OFF_GPROJ, platform: "XBOX_ONE", confirm: true },
          ],
        ];
        for (const [k, a] of ops) {
          const r = await ctx.offline("project_settings", a);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        }
        // Run 3: RegisterResourceFile answered false for the .gproj copy, with no line in the
        // Workbench log: a .gproj is the project file the engine reads at start (console.log
        // "gproj: ... guid: ..."), not a registrable resource. The copy is not registered; the
        // engine is asked to load it by path (LoadContainer, as W1 read containers by path). When
        // it loads, its TITLE must be the edited one; when it does not load, the engine accept is
        // not testable this way and the proof stays the byte-exact round trip below.
        const g = await ctx.tool("wb_container", {
          action: "get",
          target: `path:${OFF_GPROJ}`,
          path: "TITLE",
        });
        const loadRefused =
          !g.ok &&
          (g.code === "PATH_NOT_FOUND" || g.code === "INVALID_ARGUMENT") &&
          !/no variable/.test(S(g.message));
        const back = await ctx.offline("project_settings", {
          action: "set",
          path: OFF_GPROJ,
          key: "TITLE",
          value: title,
          confirm: true,
        });
        const end = bytesOf(ctx, OFF_GPROJ);
        Object.assign(evidence, {
          readReal: { ok: r0.ok, source: rb(r0).source ?? null, id: rb(r0).id ?? null },
          readCopy: brief(r1),
          engineGet: brief(g),
          engineAccept: g.ok
            ? "loaded by path"
            : loadRefused
              ? "not testable: the engine does not load the copy by path"
              : "refused otherwise",
          setBack: brief(back),
          restoredIdentical: same(start, end),
          restoredDiff: diffOf(start, end),
        });
        if (!r0.ok) fails.push(`read real: ${why(r0)}`);
        if (!same(realBefore, bytesOf(ctx, real))) fails.push(`the real ${real} changed`);
        if (g.ok && S(rb(g).value) !== "EMCP2 W2 copy")
          fails.push(
            `the engine loads the copy and reads TITLE '${S(rb(g).value)}', not the edited one`,
          );
        else if (!g.ok && !loadRefused) fails.push(`get TITLE of the copy: ${why(g)}`);
        if (!back.ok) fails.push(`set back: ${why(back)}`);
        if (!same(start, end))
          fails.push(
            `the copy is not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`,
          );
        return {
          ...verdictOf(
            fails,
            [],
            g.ok
              ? "the engine loads the copy by path and reads the edited TITLE; restored byte-identical"
              : `engine accept not testable for a .gproj copy (RegisterResourceFile false, run 3; load by path ${S(g.code)}); proof: the byte-exact round trip`,
          ),
          evidence,
        };
      },
    },

    // ── W2.8 hand steps ──
    {
      id: "w2-80-selection-hand",
      block: "W2.8",
      title:
        "Resource Browser selection with the World Editor focused (P-W2-13): hand selects the fixture, then wb_resources selection and wb_world browserSelection",
      risk: "reversible",
      timeout_ms: HAND_WAIT_MS + 60_000,
      expected: "both list the fixture while the Resource Manager window is not focused",
      kill_criterion:
        "empty when unfocused: KILLED (selection answers next='wb_module front ResourceManager')",
      side_effects: ["the hand selects a file and focuses a window (hand actions)"],
      rollback: "none (a selection)",
      probes: ["P-W2-13"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      hand: true,
      plan: () => [
        ...fixturePlan(),
        tc("wb_resources", "selection"),
        tc("wb_world", "browserSelection"),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const a = await awaitHand(
          ctx,
          "w2-80-select",
          `In the Workbench main window (Resource Manager) Resource Browser, open ${W2_ROOT}/ and LEFT-CLICK ${basename(CFG)} once (select it; do not open it). Then click the title bar of the World Editor window so it has focus (if no World Editor window is open, say so). Write {"selected": "<the file name the browser shows selected>", "worldEditorFocused": true|false}`,
        );
        if (!a)
          return { status: "NOT-RUN", detail: "no hand answer within the wait", evidence: {} };
        const s = await ctx.tool("wb_resources", { action: "selection" });
        const w = await ctx.tool("wb_world", { action: "browserSelection" });
        const has = (r: ToolResponse) =>
          JSON.stringify(r.readback ?? {})
            .toLowerCase()
            .includes(basename(CFG).toLowerCase());
        const o = { hand: a, resources: rb(s), world: w.ok ? rb(w) : S(w.code) };
        const p =
          a.worldEditorFocused !== true
            ? partial(
                "P-W2-13",
                o,
                "the World Editor was not focused: the unfocused half is not observed",
              )
            : s.ok && has(s)
              ? has(w)
                ? settled("P-W2-13", o, "both list the fixture with the World Editor focused")
                : partial(
                    "P-W2-13",
                    o,
                    "wb_resources selection lists it; wb_world browserSelection does not",
                  )
              : killed(
                  "P-W2-13",
                  o,
                  "wb_resources selection is empty while the Resource Manager is not focused",
                );
        return {
          ...verdictOf(
            s.ok ? [] : [`selection: ${why(s)}`],
            [p],
            `selection ${S(rb(s).total)} item(s)`,
          ),
          evidence: { hand: a, selection: brief(s), browserSelection: brief(w) },
          probes: [p],
        };
      },
    },
    contextStep("w2-81-context-conf", CFG),
    contextStep("w2-82-context-emat", MAT),
    contextStep("w2-83-context-png", TEX, [], basename(metaRelOf(TEX).replace(/\.meta$/, ""))),
    contextStep("w2-84-context-imageset", OFF_SET, ["P-W2-21"]),
    contextStep("w2-85-context-layout", LAYOUT),

    // ── W2.9 aliases and equivalents ──
    {
      id: "w2-90-aliases",
      block: "W2.9",
      title:
        "1.x names and equivalents: wb_resources browse; wb_world register and browserSelection (OD-6); wb_module list/info/front/action on the Resource Manager; save refused",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "browse answers as search with the 1.x warning; wb_world register answers alreadyRegistered; Window > Log Console runs twice (toggled back); wb_module save on ResourceManager is refused MODULE_NOT_SUPPORTED (World Editor only)",
      kill_criterion: `a call fails other than the expected refusal: FAIL; ${WINDOW_KILL}`,
      side_effects: ["the Log Console dock toggled twice (back to its state)"],
      rollback: "the second toggle",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc(
          "wb_resources",
          "browse",
          { rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`, limit: 5 },
          { toolAction: "browse", note: "1.x name, sent as search" },
        ),
        tc("wb_world", "register", { path: CFG }),
        tc("wb_world", "browserSelection"),
        tc("wb_module", "list"),
        tc("wb_module", "info", { moduleName: "ResourceManager" }),
        tc("wb_module", "front", { moduleName: "ResourceManager" }),
        tc("wb_module", "action", {
          moduleName: "ResourceManager",
          menuPath: ["Window", "Log Console"],
        }),
        {
          kind: "execute-action",
          target: { path: ["Window", "Log Console"], module: "ResourceManager" },
          via: "EMCP_WB_Module {action: action}",
        } as PlanAction,
        tc(
          "wb_module",
          "action",
          { moduleName: "ResourceManager", menuPath: ["Window", "Log Console"] },
          { note: "toggled back" },
        ),
        {
          kind: "execute-action",
          target: { path: ["Window", "Log Console"], module: "ResourceManager" },
          via: "EMCP_WB_Module {action: action}",
        } as PlanAction,
        tc(
          "wb_module",
          "save",
          { moduleName: "ResourceManager" },
          { note: "refused MODULE_NOT_SUPPORTED by the TS before sending" },
        ),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const br = await ctx.tool("wb_resources", {
          action: "browse",
          rootPath: `$${SANDBOX_NAME}:${W2_ROOT}/`,
          limit: 5,
        });
        const wr = await ctx.tool("wb_world", { action: "register", path: CFG });
        const ws = await ctx.tool("wb_world", { action: "browserSelection" });
        const ml = await ctx.tool("wb_module", { action: "list" });
        const mi = await ctx.tool("wb_module", { action: "info", module: "ResourceManager" });
        const mf = await ctx.tool("wb_module", { action: "front", module: "ResourceManager" });
        const a1 = await ctx.tool("wb_module", {
          action: "action",
          module: "ResourceManager",
          menuPath: ["Window", "Log Console"],
        });
        const a2 = await ctx.tool("wb_module", {
          action: "action",
          module: "ResourceManager",
          menuPath: ["Window", "Log Console"],
        });
        const sv = await ctx.tool("wb_module", { action: "save", module: "ResourceManager" });
        const evidence: Raw = {
          browse: brief(br),
          worldRegister: brief(wr),
          worldBrowserSelection: brief(ws),
          list: brief(ml),
          info: brief(mi),
          front: brief(mf),
          action1: brief(a1),
          action2: brief(a2),
          save: brief(sv),
        };
        const fails: string[] = [];
        for (const [k, r] of [
          ["browse", br],
          ["wb_world register", wr],
          ["wb_world browserSelection", ws],
          ["list", ml],
          ["info", mi],
          ["front", mf],
          ["action", a1],
          ["action back", a2],
        ] as const)
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
        if (br.ok && !(br.warnings ?? []).some((w) => /1\.x/.test(w)))
          fails.push("browse answered without the 1.x name warning");
        if (sv.ok || sv.code !== "MODULE_NOT_SUPPORTED")
          fails.push(`wb_module save on ResourceManager answered ${sv.ok ? "ok" : S(sv.code)}`);
        return { ...verdictOf(fails, [], "1.x names and equivalents answer"), evidence };
      },
    },

    // ── W2.10 net-zero and close-out ──
    {
      id: "w2-95-netzero",
      block: "W2.10",
      title: "net-zero: the sandbox outside _throwaway/W2/ hashed against the battery's snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "no file outside _throwaway/W2/ changed (resourceDatabase.rdb recorded, not failed)",
      kill_criterion: "any other change: FAIL with the paths",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      plan: () => [],
      run: async (ctx) => {
        const nz = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
        if (!nz)
          return {
            status: "NOT-RUN",
            detail: `no ${BATTERY_SNAPSHOT_FILE} in the sitting folder`,
            evidence: {},
          };
        const tolerated = nz.changed.filter((f) => NETZERO_TOLERATED.includes(f));
        const bad = nz.changed.filter((f) => !NETZERO_TOLERATED.includes(f));
        const evidence: Raw = {
          snapshotTakenBy: nz.takenBy,
          snapshotTakenAt: nz.takenAt,
          tolerated,
          changed: bad,
        };
        return {
          ...verdictOf(
            bad.length ? [`changed outside ${W2_ROOT}/: ${bad.join(", ")}`] : [],
            [],
            `net-zero outside ${W2_ROOT}/${tolerated.length ? ` (${tolerated.join(", ")} recorded)` : ""}${nz.takenBy === "run start" ? `; the snapshot was taken at the start of a resumed run (${nz.takenAt})` : ""}`,
          ),
          evidence,
        };
      },
    },
    closableStep(),
  ];
}

/** w2-40's creates: .conf, .emat and .layout plain, then .conf and .emat with inherit. */
export const CREATES: ReadonlyArray<{ path: string; className: string; inherit?: string }> = [
  { path: `${CREATED_DIR}/W2_probe.conf`, className: CFG_CLASS },
  { path: `${CREATED_DIR}/W2_probe.emat`, className: "MatPBRBasic" },
  { path: `${CREATED_DIR}/W2_probe.layout`, className: "FrameWidgetClass" },
  {
    path: `${CREATED_DIR}/W2_probe_inh.conf`,
    className: VANILLA_CONF_NAME_CLASS,
    inherit: VANILLA_CONF_NAME,
  },
  { path: `${CREATED_DIR}/W2_probe_inh.emat`, className: "MatPBRBasicGlass", inherit: "<W2_mat>" },
];

/** w2-72's layout_edit calls in order; the `undo*` ones run after the engine read. */
export const LAYOUT_OPS: ReadonlyArray<[string, Raw]> = [
  ["read", { action: "read", path: OFF_LAYOUT }],
  [
    "addWidget",
    {
      action: "addWidget",
      path: OFF_LAYOUT,
      parent: "root",
      widgetClass: "TextWidgetClass",
      name: "W2_T",
      confirm: true,
    },
  ],
  [
    "setProperty",
    {
      action: "setProperty",
      path: OFF_LAYOUT,
      widget: "W2_T",
      property: "Text",
      value: "w2 accept",
      confirm: true,
    },
  ],
  [
    "duplicateWidget",
    { action: "duplicateWidget", path: OFF_LAYOUT, widget: "W2_T", name: "W2_T2", confirm: true },
  ],
  [
    "moveWidget",
    {
      action: "moveWidget",
      path: OFF_LAYOUT,
      widget: "W2_T2",
      parent: "root",
      index: 0,
      confirm: true,
    },
  ],
  [
    "wrap",
    {
      action: "wrap",
      path: OFF_LAYOUT,
      widget: "W2_T2",
      wrapper: "FrameWidgetClass",
      name: "W2_W",
      confirm: true,
    },
  ],
  ["unwrap", { action: "wrap", path: OFF_LAYOUT, widget: "W2_W", unwrap: true, confirm: true }],
  [
    "convert",
    {
      action: "convert",
      path: OFF_LAYOUT,
      widget: "W2_T2",
      toClass: "RichTextWidgetClass",
      confirm: true,
    },
  ],
  [
    "saveAsPrefab",
    {
      action: "saveAsPrefab",
      path: OFF_LAYOUT,
      widget: "W2_T",
      to: OFF_LAYOUT_PREFAB,
      overwrite: true,
      confirm: true,
    },
  ],
  [
    "genClass",
    {
      action: "genClass",
      path: OFF_LAYOUT,
      to: OFF_LAYOUT_CLASS,
      className: "EMCP_W2_OffWidgets",
      overwrite: true,
      confirm: true,
    },
  ],
  ["undoDuplicate", { action: "removeWidget", path: OFF_LAYOUT, widget: "W2_T2", confirm: true }],
  ["undoAdd", { action: "removeWidget", path: OFF_LAYOUT, widget: "W2_T", confirm: true }],
];

/** The planted files on disk (offline steps need no registration first). */
async function ensureFixturesOnDisk(ctx: StepContext): Promise<void> {
  const missing = PLANTED.filter((rel) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)));
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `planted file(s) absent: ${missing.join(", ")}: run \`w2.live.ts plant\` first`,
    );
}

/** A texture base that is not `orig`: TextureNormalMap (resolved live) or Unspecified. */
async function wrongAncestor(ctx: StepContext, orig: string): Promise<string> {
  const r = await ctx.tool("wb_resources", { action: "resolve", path: TEXTURE_NORMAL_PATH });
  const normal = S(rb(r).resourceName);
  const cands = [guidOf(normal) ? normal : "", TEXTURE_UNSPECIFIED].filter((x) => x !== "");
  return cands.find((c) => guidOf(c) !== guidOf(orig)) ?? TEXTURE_UNSPECIFIED;
}

/**
 * The last step, also run after a stop: leave Workbench closable by WM_CLOSE. The Resource Manager
 * tabs W2 opened are unedited or saved (w2-50 saves its set-back); the World Editor world (if any)
 * is replaced by a fresh load of a world that is not open now, so no in-memory edit remains. Nothing
 * is saved.
 */
export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W2.10",
    title:
      "leave Workbench closable: the open world replaced by a fresh load (the W2 world, else vanilla EmptyArland); never save",
    risk: "reversible",
    timeout_ms: TIMEOUTS.open + 60_000,
    expected:
      "no world open (nothing to do), or a freshly opened world in edit mode; the post-flight WM_CLOSE exits without a prompt",
    kill_criterion:
      "the world does not open: FAIL (the runbook's hand answers any save prompt with Don't Save / No)",
    side_effects: ["the World Editor opens another world; nothing is saved"],
    rollback: "none: nothing is edited",
    probes: [],
    writes: [],
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [tc("wb_world", "state"), ...openPlan(VANILLA_WORLD)],
    run: async (ctx) => leaveClosable(ctx),
  };
}

export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateBefore = brief(st0);
  const open = S(rb(st0).worldPath).toLowerCase();
  if (!st0.ok || open === "") {
    return {
      status: "PASS",
      detail: "no world is open: nothing in the World Editor to leave",
      evidence,
    };
  }
  const target =
    !open.endsWith(WORLD.toLowerCase()) && ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD))
      ? WORLD
      : VANILLA_WORLD;
  evidence.target = target;
  const o = await openWorld(ctx, target);
  evidence.open = o.evidence;
  if (!o.ok) fails.push(`${target} did not open ('${o.worldPath}')`);
  const st1 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateAfter = brief(st1);
  if (S(rb(st1).mode) && S(rb(st1).mode) !== "edit")
    fails.push(`mode ${S(rb(st1).mode)}, not edit`);
  return { ...verdictOf(fails, [], `closable: ${target} freshly open`), evidence };
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

/** Every offline call of every step, tagged with the step. */
export function offlinePlan(
  steps: StepDef[] = buildSteps(),
): Array<OfflineCall & { step: string }> {
  return steps.flatMap((s) => (s.offlineCalls?.() ?? []).map((c) => ({ ...c, step: s.id })));
}

/** `tool.action` names a step sends, from its plan and its offline calls. */
export function exercisedBy(s: StepDef): string[] {
  return [
    ...new Set([
      ...s
        .plan()
        .filter((a) => typeof a.tool === "string")
        .map((a) => `${String(a.tool)}.${String(a.toolAction)}`),
      ...(s.offlineCalls?.() ?? []).map((c) => `${c.tool}.${c.action}`),
    ]),
  ];
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: Resource Manager battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map(
      (s) =>
        `  [${s.block}] ${s.id} (${s.risk}${s.hand ? ", hand" : ""})${s.probes.length ? ` {${s.probes.join(", ")}}` : ""}: ${s.title}`,
    ),
    `  not testable in this battery: ${Object.keys(NOT_TESTABLE).join(", ") || "none"}`,
    `  not exercised: ${Object.keys(NOT_EXERCISED).join(", ") || "none"}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w2.live.ts --emit-queue` from its step table; tests/live-harness/w2-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W2 is not in PROBE_MUT_SESSIONS and sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w2-spec.md 2, 3, 6",
      "DEC-053",
      "DEC-058",
      "DEC-061",
      "DEC-063",
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
      ...(s.hand ? { hand: true } : {}),
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

/** Killed probes recorded in this run folder (they skip the steps that depend on them). */
function killedProbes(
  runDir: string,
  deps: Pick<W2Deps, "exists" | "readBytes">,
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

/** Undo what a stopped step owes and run its restorers. Never on a dialog, LOST or WEDGED. */
async function cleanupAfterStop(ctx: StepContext, deps: W2Deps): Promise<Raw> {
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
  return out;
}

/** The engine's save prompt: W1 run 2 saw it titled "Loading world" (Yes / No / Cancel). */
export const SAVE_PROMPT_TITLES: readonly string[] = ["Loading world"];

/**
 * What the main session's hand does with a HANDOFF window: the dialog's exact title, the button
 * ("No" / "Don't Save" on a save prompt: never Save, never Yes, never Cancel) and the resume.
 */
export function handAnswer(
  message: string,
  stepId: string,
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1]! : "";
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt ? "No" : "none planned: record the title and text; never Save";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `hand: the engine's save prompt "${title}" ("Do you want to save changes?"): press No / Don't Save (never Save, never Yes, never Cancel), then resume ${resume}`
    : `hand: window "${title}": ${answer}; then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
}

function makeCtx(
  deps: W2Deps,
  opts: W2Options,
  prior: (id: string) => StepRecord | null,
  state: Map<string, string>,
  calls: Array<Record<string, unknown>>,
  abort: AbortController,
  onStop: (code: string) => void,
  guardOn: boolean,
): StepContext {
  const debt: Debt = { undos: 0, restorers: [] };
  const guard = (what: string): void => {
    if (guardOn && abort.signal.aborted) {
      calls.push({ notSent: what });
      throw new StepCut();
    }
  };
  return {
    deps,
    opts,
    prior,
    calls,
    debt,
    state,
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
      if (r.ok && !o.restore && S(rb(r).undoName)) debt.undos++;
      return r;
    },
    offline: async (name, args) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.offline(name, args);
      calls.push({ offline: name, args, ok: r.ok, code: r.code ?? null });
      return r;
    },
    undo: async () => {
      guard("undo");
      const u = await deps.undo();
      calls.push({ undo: u });
      if (u.ok && debt.undos > 0) debt.undos--;
      if (guardOn && !u.ok && STOP_CODES.has(S(u.code))) {
        onStop(S(u.code));
        throw new StopBattery(
          u.code === "MODAL_OPEN" ? "handoff" : "stopped",
          `undo answered ${u.code}: ${u.message}`,
        );
      }
      return u;
    },
  };
}

/** The closable step after a stop: no window poll, no stop codes thrown; its record is written. */
async function closeOutAfterStop(
  deps: W2Deps,
  opts: W2Options,
  prior: (id: string) => StepRecord | null,
  write: (r: StepRecord) => void,
): Promise<void> {
  const def = closableStep();
  const startedAt = new Date(deps.now()).toISOString();
  const calls: Array<Record<string, unknown>> = [];
  const ctx = makeCtx(
    deps,
    opts,
    prior,
    new Map(),
    calls,
    new AbortController(),
    () => undefined,
    false,
  );
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
  deps: W2Deps,
  opts: W2Options,
): Promise<BatteryReport> {
  const all = buildSteps();
  const records: StepRecord[] = [];
  const state = new Map<string, string>();
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
  // A run that starts past the gate (--from, --only) takes the battery snapshot now when the
  // sitting has none, so w2-95 always has a baseline (W1 run 7).
  if (steps.length && steps[0]!.id !== GATE_STEP)
    ensureBatterySnapshot(opts.sittingDir, opts.sandboxDir, deps, "run start");
  let consecutiveFails = 0;
  let failUnit = "";
  for (const s of steps) {
    // The FAIL count is kept within one unit of dependent steps: it resets at a block boundary,
    // and every step of an independent block is its own unit (failUnitOf). LOST, WEDGED, MODAL
    // and dialog stops are untouched.
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
    let clientStop: string | null = null;
    const ctx = makeCtx(deps, opts, prior, state, calls, abort, (c) => (clientStop = c), true);
    try {
      const pid = deps.recordedPid();
      if (pid === null)
        throw new StopBattery(
          "stopped",
          "the lane recorded no Workbench pid: run the pre-flight first",
        );
      const w = await watched(deps, pid, s.expectsWindows, abort, () => s.run(ctx), {
        ...WATCH_OPTIONS,
        popups: s.popups === true,
      });
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
            : { undos: ctx.debt.undos, restorers: ctx.debt.restorers.map((r) => r.label) },
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

/** `<sitting>/w2-result.json`: every step's latest record across the sitting's run folders, and each probe's result. */
export function writeResult(
  opts: W2Options,
  deps: Pick<W2Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  const runs = new Set(
    deps
      .listTree(opts.sittingDir)
      .filter((f) => f.includes("/"))
      .map((f) => f.split("/")[0]!),
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A plain 8-bit RGBA PNG of one colour (the W2 texture fixtures; no file is copied for them). */
export function solidPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** What `plant` writes: project-relative path to its source. */
export function plantSources(): Array<{ rel: string; from: string }> {
  return [
    { rel: CFG, from: `paks:${VANILLA_CONF}` },
    { rel: MAT, from: `paks:${VANILLA_EMAT}` },
    { rel: TEX, from: "generated: 64x64 RGBA PNG" },
    { rel: LAYOUT, from: `paks:${VANILLA_LAYOUT}` },
    { rel: OFF_CONF, from: `paks:${VANILLA_CONF}` },
    { rel: OFF_LAYOUT, from: `paks:${VANILLA_LAYOUT}` },
    {
      rel: OFF_GPROJ,
      from: `sandbox:${SANDBOX_NAME}.gproj (a copy; the real file is never written)`,
    },
    { rel: OFF_TEX, from: "generated: 64x64 RGBA PNG" },
  ];
}

/** `plant`: the eight fixtures and three folders under _throwaway/W2/ (no Workbench running). */
export async function runPlant(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): Promise<number> {
  for (const s of plantSources()) io.log(`plant: ${s.from} -> <sandbox>/${s.rel}`);
  for (const d of PLANT_DIRS) io.log(`plant: folder <sandbox>/${d}/`);
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the plant is offline`);
    return EXIT.refused;
  }
  if (io.exists(abs(sandboxDir, W2_ROOT))) {
    io.log(`refused: <sandbox>/${W2_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const throwawayExistedBefore = io.exists(abs(sandboxDir, THROWAWAY));
  const bytes: Record<string, Buffer> = {};
  const conf = await io.readVanilla(VANILLA_CONF);
  const layout = await io.readVanilla(VANILLA_LAYOUT);
  bytes[CFG] = conf;
  bytes[MAT] = await io.readVanilla(VANILLA_EMAT);
  bytes[TEX] = solidPng(64, 64, [200, 120, 40, 255]);
  bytes[LAYOUT] = layout;
  bytes[OFF_CONF] = conf;
  bytes[OFF_LAYOUT] = layout;
  bytes[OFF_GPROJ] = io.readBytes(join(sandboxDir, `${SANDBOX_NAME}.gproj`));
  bytes[OFF_TEX] = solidPng(64, 64, [40, 120, 200, 255]);
  const record = {
    files: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, sha256(b)])),
    dirs: [...PLANT_DIRS],
    throwawayExistedBefore,
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  for (const [rel, b] of Object.entries(bytes)) {
    io.writeBytes(abs(sandboxDir, rel), b);
    io.log(`planted <sandbox>/${rel} (${b.length} bytes, sha256 ${sha256(b)})`);
  }
  for (const d of PLANT_DIRS) {
    io.makeDir(abs(sandboxDir, d));
    io.log(`made <sandbox>/${d}/`);
  }
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W2/; `_throwaway/` only when empty and absent before. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W2_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W2_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W2_ROOT}/ (${files.length} files)`);
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
    join(sittingDir, "throwaway-w2-listing.json"),
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
  io.log(`removed <sandbox>/${W2_ROOT}/ (listing in throwaway-w2-listing.json)`);
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

async function openVfs() {
  const { PakVirtualFS } = await import("../../src/pak/vfs.js");
  return PakVirtualFS.get(loadConfig().gamePath);
}

export function realDeps(input: {
  port: number;
  lane: Lane;
  sandboxDir: string;
  vfs: VanillaFs | null;
}): W2Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const worldDeps = { projectRoot: input.sandboxDir, artifactsRoot: artifactsDir() };
  const config: Config = { ...loadConfig(), projectPath: input.sandboxDir };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  const kernel = makeRealKernel({ provider: "uia" });
  const rmTitle = moduleTitlePattern("ResourceManager") ?? "^Enfusion Workbench( - .+)?$";
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_resources":
          return asResp(await runResources(client, args));
        case "wb_meta":
          return asResp(await runMeta(client, args));
        case "wb_validate":
          return asResp(await runValidate(client, args));
        case "wb_container":
          return asResp(await runContainer(client, args, { artifactsRoot: artifactsDir() }));
        case "wb_module":
          return asResp(await runModule(client, args as unknown as ModuleArgs));
        case "wb_world":
          return asResp(await runWorld(client, args, worldDeps));
        case "wb_entity":
          return asResp(await runEntity(client, args));
        case "wb_bi":
          return asResp(await runBi(args, { client }));
      }
    },
    offline: async (name, args) => {
      // The test project's folder is passed in here; no tool or handler names it.
      const a = { ...args, projectPath: input.sandboxDir };
      switch (name) {
        case "meta_file":
          return asResp(runMetaFile(a as unknown as MetaArgs, config));
        case "imageset":
          return asResp(runImageset(a as unknown as ImagesetRequest, config));
        case "layout_edit":
          return asResp(runLayoutEdit(a as unknown as LayoutEditArgs, config));
        case "config_edit":
          return asResp(runConfigEdit(a as unknown as ConfigEditArgs, config));
        case "project_settings":
          return asResp(runProjectSettings(a as unknown as ProjectSettingsArgs, config));
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
    contextRead: async (pid, path) => {
      if (!kernel.readPassive)
        return { read: false, items: [], detail: "the kernel has no passive read", artifact: null };
      try {
        const r = await kernel.readPassive(
          pid,
          { className: EDITOR_WINDOW_CLASS, titlePattern: rmTitle },
          path,
          PASSIVE_TIMEOUT_MS,
        );
        const items = (r.tree?.children ?? [])
          .filter((c) => c.controlType !== "Separator")
          .map((c) => S(c.name) || `@${S(c.controlType)}`);
        return {
          read: !!r.tree,
          items,
          detail: r.detail,
          artifact: r.artifact,
          presentAtStart: r.presentAtStart,
        };
      } catch (e) {
        return {
          read: false,
          items: [],
          detail: e instanceof Error ? e.message : String(e),
          artifact: null,
        };
      }
    },
    vanilla: () => input.vfs,
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
      const vfs = await openVfs();
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
  deps?: W2Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
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
        `refused: ${sittingDir} holds no ${PLANT_FILE}: run \`w2.live.ts plant\` first`,
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
  let deps = over.deps;
  if (!deps) {
    const v = await openVfs();
    const vfs: VanillaFs | null = v
      ? { paths: () => v.allFilePaths(), read: (p) => v.readFile(p) }
      : null;
    deps = realDeps({ port, lane, sandboxDir: resolve(o.sandbox), vfs });
    lane.startHeartbeat();
  }
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
      wave: "w2",
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

// Census rows this file tests (W2 promotion, EV-W2-085).
// Each row names the W2 battery step(s) above as its live test; the results are in data/census/live-results/.
// census:api:ResourceManager.GetMetaFile/1
// census:api:ResourceManager.RebuildResourceFile/3
// census:api:ResourceManager.RebuildResourceFiles/2
// census:api:ResourceManager.RegisterResourceFile/2
// census:api:ResourceManager.WaitForFile/2
// census:mcp:action/config_edit.arrayAdd
// census:mcp:action/config_edit.arrayRemove
// census:mcp:action/config_edit.clear
// census:mcp:action/config_edit.createInherited
// census:mcp:action/config_edit.read
// census:mcp:action/config_edit.set
// census:mcp:action/config_edit.setAncestor
// census:mcp:action/imageset.addGroup
// census:mcp:action/imageset.addQuad
// census:mcp:action/imageset.addTexture
// census:mcp:action/imageset.create
// census:mcp:action/imageset.read
// census:mcp:action/imageset.remove
// census:mcp:action/imageset.removeTexture
// census:mcp:action/imageset.setQuad
// census:mcp:action/layout_edit.addWidget
// census:mcp:action/layout_edit.convert
// census:mcp:action/layout_edit.duplicateWidget
// census:mcp:action/layout_edit.moveWidget
// census:mcp:action/layout_edit.read
// census:mcp:action/layout_edit.removeWidget
// census:mcp:action/layout_edit.setProperty
// census:mcp:action/layout_edit.wrap
// census:mcp:action/meta_file.clear
// census:mcp:action/meta_file.read
// census:mcp:action/meta_file.scan
// census:mcp:action/meta_file.set
// census:mcp:action/meta_file.setAncestor
// census:mcp:action/project_settings.addDependency
// census:mcp:action/project_settings.addPlatform
// census:mcp:action/project_settings.read
// census:mcp:action/project_settings.removeDependency
// census:mcp:action/project_settings.removePlatform
// census:mcp:action/project_settings.set
// census:mcp:action/wb_meta.clear
// census:mcp:action/wb_meta.get
// census:mcp:action/wb_meta.set
// census:mcp:action/wb_meta.setAncestor
// census:mcp:action/wb_meta.vars
// census:mcp:action/wb_resources.addons
// census:mcp:action/wb_resources.create
// census:mcp:action/wb_resources.getInfo
// census:mcp:action/wb_resources.import
// census:mcp:action/wb_resources.newGuid
// census:mcp:action/wb_resources.prefabFromModel
// census:mcp:action/wb_resources.rebuild
// census:mcp:action/wb_resources.register
// census:mcp:action/wb_resources.resolve
// census:mcp:action/wb_resources.wait
// census:mcp:action/wb_validate.fixTexture
// census:mcp:action/wb_validate.material
// census:mcp:action/wb_validate.texture
// census:mcp:handler-action/EMCP_WB_Meta.clear
// census:mcp:handler-action/EMCP_WB_Meta.get
// census:mcp:handler-action/EMCP_WB_Meta.set
// census:mcp:handler-action/EMCP_WB_Meta.setAncestor
// census:mcp:handler-action/EMCP_WB_Meta.vars
// census:mcp:handler-action/EMCP_WB_Resources.addons
// census:mcp:handler-action/EMCP_WB_Resources.create
// census:mcp:handler-action/EMCP_WB_Resources.import
// census:mcp:handler-action/EMCP_WB_Resources.newGuid
// census:mcp:handler-action/EMCP_WB_Resources.prefabFromModel
// census:mcp:handler-action/EMCP_WB_Resources.rebuild
// census:mcp:handler-action/EMCP_WB_Resources.register
// census:mcp:handler-action/EMCP_WB_Resources.resolve
// census:mcp:handler-action/EMCP_WB_Resources.wait
// census:mcp:handler-action/EMCP_WB_Validate.fixTexture
// census:mcp:handler-action/EMCP_WB_Validate.material
// census:mcp:handler-action/EMCP_WB_Validate.texture
