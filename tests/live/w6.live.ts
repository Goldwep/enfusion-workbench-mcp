/**
 * Wave W6 (Plugins and tools), the live battery (docs/v2/design/phase5-w6-spec.md section 6,
 * DEC-058, DEC-069). Built on the battery that ran live through four fix-up rounds,
 * tests/live/w2.live.ts: the same CLI, the same evidence, the same hand mechanism, the same stop
 * rules, and the lessons of its fix-ups (packed files named by {GUID}path, no relative roots,
 * absent files named as absent and never read as a change, a verdict per item, the FAIL counter
 * kept per independent step).
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch profile with `-scriptAuthorizeAll` (DEC-053 ruling 2, the standing go), with the
 * shipped bundle installed and NO probe pack. This script never launches, never takes the lease for
 * itself (the lane given with --id holds it) and reaches Workbench through the shipped TS tools run
 * IN PROCESS (`runPlugin`, `runWorldTools`, `runShape`, `runEntity`, `runView`, `runTerrain`,
 * `runWorld`, `runModule`, `runContainer`, `runScriptEditor`, `runLocalization`, `runBi`) over a
 * `WorkbenchClient` WITHOUT a Config (no lease, no auto-launch, no handler recovery), so each step
 * tests the TS mapping and the handler together. The wave's offline code (the Object Import CSV
 * codec, the coords parser, the shape-area maths, the shapefile reader and writer, the plugin
 * template of script_create) runs in process; each has an engine-accept step: a fixture the
 * offline code wrote under _throwaway/W6/ is given to Workbench and the value it holds is read back.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan and the queue with preflight's validateQueue; `--out` writes
 * the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/W6-queue.json;
 * a test keeps the two equal). The runbook is docs/v2/sessions/queues/W6.md.
 *
 * Blocks (one launch; each block is ordered read-only, reversible, mutating for the queue):
 *   W6.0 setup     the test-bed gate (EMCP_WB_Info names EMCP2_sandbox, build stamp, the plant), the
 *                  sandbox snapshot, the handlers answer, the offline proofs and the read-only
 *                  registry query (P-W6-04), the W6 world written by wb_world new and opened
 *   W6.1 read      wb_plugin list, describe and getSettings (P-W6-01, P-W6-02), the plugin refusals
 *                  (PLUGIN_MODAL, NOT_ALLOWLISTED, the entry points, setSettings dry run and its
 *                  NO_SETTER refusal, P-W6-03 in part), wb_world_tools stats (P-W6-18)
 *   W6.2 edits     world edits in the W6 world, each undone: export/import round trip (P-W6-07), the
 *                  CSV import (engine accept of the codec), resetFlags (P-W6-15), replaceEntities
 *                  (P-W6-17), wb_shape create/points and the GATED parallel (P-W6-16), area (engine
 *                  accept of the area maths), import (engine accept of the shapefile reader)
 *   W6.3 runs      wb_plugin run of the 13 listed classes: the precondition miss, the dry run and the
 *                  confirmed run (GATED until P-W6-05 opens a class Workbench-side; a class that runs
 *                  has its oracle read and its effect undone) (P-W6-05); the planted plugin template
 *                  opened in the Script Editor (engine accept of the template)
 *   W6.4 terrain   the vanilla terrain world opened, edited in memory only and never saved:
 *                  snapToTerrain (P-W6-13), floaters (P-W6-14), goToCoords (engine accept of the
 *                  coords parser), area snapped to the ground
 *   W6.5 bi        the two Bohemia layer handlers (P-W6-11)
 *   W6.8 hand      the one hand step, last: the modal watchdog on a plugin dialog (P-W6-06)
 *   W6.9 close     the net-zero hash diff and the closable step
 * Everything under _throwaway/W6/ (plant, world, .meta files) is removed by this script's
 * `rollback` subcommand once Workbench is closed. Nothing is written anywhere else.
 *
 * Stop rules (W2's): a dialog-like window already up refuses the step; the pid's windows are polled
 * while a step runs (scripts/census/live/common.ts `watched`): a new dialog-like or disabled window
 * is a HANDOFF that names the title and the answer (never Save), any other new window a STOP, and
 * the first verdict cuts the step; busy windows alone (a world load) are waited out under W2's
 * WATCH_OPTIONS grace. A LOST, WEDGED or MODAL_OPEN client error stops the battery;
 * three consecutive unexpected FAILs in one unit stop it (failUnitOf: the count resets at a block
 * boundary, and each step of an independent block is its own unit). A mutating call is never
 * retried. A probe whose kill criterion is met is recorded KILLED with the observed value; steps
 * that depend on it are SKIPPED. A GATED action is sent only for its refusal. The hand step is not
 * polled while the hand works (the dialog is the point); `--skip-hand` records it HELD.
 *
 * Usage:
 *   npx --no tsx tests/live/w6.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w6.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w6.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--skip-hand] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w6.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
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
import {
  loadAllowList,
  loadCatalog,
  loadRunAllowList,
  runPlugin,
} from "../../src/tools/wb-plugin.js";
import {
  TS_ACTIONS as WORLD_TOOLS_TS_ACTIONS,
  parseCoordsText,
  runWorldTools,
} from "../../src/tools/wb-world-tools.js";
import { runShape } from "../../src/tools/wb-shape.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runView } from "../../src/tools/wb-view.js";
import { runTerrain } from "../../src/tools/wb-terrain.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runScriptEditor } from "../../src/tools/wb-script-editor.js";
import { runLocalization } from "../../src/tools/wb-localization.js";
import { runBi } from "../../src/tools/wb-bi.js";
import { generateScript, PLUGIN_PARENTS } from "../../src/templates/script.js";
import {
  formatCsv,
  fromHandlerRow,
  parse as parseCsv,
  rowsOf as csvRowsOf,
  serialize as serializeCsv,
  type ObjectRow,
} from "../../src/formats/object-import-csv.js";
import {
  areaPointCount,
  areaPoints,
  toWorld,
  type AreaSpec,
  type Vec3,
} from "../../src/formats/shape-area.js";
import {
  boxOf,
  compareShx,
  readShp,
  readShx,
  recordParts,
  writeShp,
  writeShx,
  type ShpFile,
  type ShpPoint,
  type ShpRecord,
} from "../../src/formats/shapefile.js";
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
  isDialogWindow,
  watched,
} from "../../scripts/census/live/common.js";
import {
  WATCH_OPTIONS,
  changedFiles,
  exactLineDiff,
  handFiles,
  handLine,
  recordPath,
} from "./w2.live.js";

export { EXIT, StopBattery, handFiles, handLine, recordPath, exactLineDiff };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W6";
/** The last step; the runner also runs it after a stop (not after a dialog, LOST or WEDGED). */
export const CLOSABLE_STEP = "w6-99-closable";
export const GATE_STEP = "w6-00-gate";
export const NETZERO_STEP = "w6-95-netzero";
export const HAND_STEP = "w6-80-modal-watchdog";
export const SCRIPT_PATH = "tests/live/w6.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W6.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W6-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));

/** The one switch the launch carries, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<sitting>/w6-scratch.ini",
  SAA,
];

/** Every file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W6_ROOT = `${THROWAWAY}/W6`;
export const WORLDS_DIR = `${W6_ROOT}/worlds`;
export const WORLD = `${WORLDS_DIR}/EMCP_W6_Tiny.ent`;
/** The Object Import CSV the plant writes with the wave's codec (formatCsv). */
export const CSV_DIR = `${W6_ROOT}/csv`;
export const CSV_REL = `${CSV_DIR}/W6_objects.csv`;
/** The shapefiles the plant writes with the wave's writer (writeShp, writeShx). */
export const SHP_DIR = `${W6_ROOT}/shp`;
export const SHP_LINES = `${SHP_DIR}/W6_lines.shp`;
export const SHX_LINES = `${SHP_DIR}/W6_lines.shx`;
export const SHP_POINTS = `${SHP_DIR}/W6_points.shp`;
export const SHX_POINTS = `${SHP_DIR}/W6_points.shx`;
/** The plugin templates of script_create (scriptType plugin), one per base, never compiled here. */
export const SCRIPTS_DIR = `${W6_ROOT}/scripts`;
export const TEMPLATE_BASES = Object.keys(PLUGIN_PARENTS) as Array<keyof typeof PLUGIN_PARENTS>;
export function templateClass(base: string): string {
  return `EMCP_W6_Tpl${base}`;
}
export function templateRel(base: string): string {
  return `${SCRIPTS_DIR}/${templateClass(base)}.c`;
}
/** The template opened in the Script Editor (the Script Editor plugins' precondition). */
export const TEMPLATE_OPEN = templateRel("WorkbenchPlugin");
export const PLANTED: readonly string[] = [
  CSV_REL,
  SHP_LINES,
  SHX_LINES,
  SHP_POINTS,
  SHX_POINTS,
  ...TEMPLATE_BASES.map(templateRel),
];
export const PLANT_DIRS: readonly string[] = [WORLDS_DIR];

/** Vanilla prefabs, by {GUID}path (packed files resolve by GUID, W2 fix-up 2). */
export const PROP = "{3F23DA7ACAC0ED90}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et";
/** PROP's own ancestor (GlassBeer_01.et inherits it, read from the paks): the replacement. */
export const ALT_PREFAB =
  "{D1B29F6467927156}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01_base.et";
/** The terrain world W1 read (vanilla): edited here in memory only, every edit undone, never saved. */
export const VANILLA_WORLD = "worlds/Arland/EmptyArland.ent";
/** Names of every entity the battery creates. */
export const NAME_PREFIX = "W6_";
/** The E03 modal class P-W6-06 opens by hand and the PLUGIN_MODAL refusal names. */
export const MODAL_CLASS = { module: "ResourceManager", className: "SCR_FindResourcesPlugin" };
/** A dialog-free class that is not on the run allow-list (its Run reaches FileIO, spec 2.1.1). */
export const UNLISTED_CLASS = { module: "ScriptEditor", className: "SCR_DoxygenFillerPlugin" };

/** The run allow-list of spec 2.1.1 (13 classes) with the module E03 gives each. */
export const RUN_CLASSES: ReadonlyArray<{ module: string; className: string }> = [
  { module: "WorldEditor", className: "SCR_SnapAndOrientToTerrainPlugin" },
  { module: "WorldEditor", className: "SCR_WrapEntitiesPlugin" },
  { module: "WorldEditor", className: "SCR_AddPrefabToSelectedEntitiesPlugin" },
  { module: "WorldEditor", className: "EntityOrientationTool" },
  { module: "WorldEditor", className: "CameraOrientationTool" },
  { module: "ScriptEditor", className: "SCR_CopyClassAndMethodPlugin" },
  { module: "ScriptEditor", className: "SCR_DebugLinePlugin" },
  { module: "LocalizationEditor", className: "SCR_LocEditedTextPlugin" },
  { module: "LocalizationEditor", className: "SCR_LocStatusPlugin" },
  { module: "LocalizationEditor", className: "SCR_LocLengthPlugin" },
  { module: "ResourceManager", className: "SCR_CheckRuinModelsAndUsagePlugin" },
  { module: "ResourceManager", className: "SCR_ReforgerEngineSettingsPlugin" },
  { module: "ResourceManager", className: "SCR_ReforgerGameSettingsPlugin" },
];
const classesOf = (module: string) => RUN_CLASSES.filter((c) => c.module === module);

export const PLANT_FILE = "plant-w6.json";
export const RESULT_FILE = "w6-result.json";
export const BATTERY_SNAPSHOT_FILE = "w6-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w6-battery-snapshot";
/** Files whose change outside _throwaway/W6/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** How long a hand step waits for the main session's answer file (per request). */
export const HAND_WAIT_MS = 900_000;
/** P-W6-06: the watchdog must see the dialog this soon after the hand's click. */
export const MODAL_DETECT_MS = 5_000;

export const TIMEOUTS = {
  step: 180_000,
  open: 600_000,
  poll: 5_000,
  windowPoll: 1_000,
} as const;

/** Tolerances of the read-backs (P-W6-07: 0.001 m, 0.01 degrees). */
export const POS_TOL = 0.001;
export const ANGLE_TOL = 0.01;
/** A snapped or ground point against the terrain height. */
export const GROUND_TOL = 0.05;

/**
 * Blocks whose steps are independent proofs: each world edit, plugin run or terrain edit sets up
 * its own fixtures and undoes them, so three failing in a row says nothing about the session (W2
 * fix-up 3).
 */
export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W6.2", "W6.3", "W6.4"]);

/** The unit the consecutive-FAIL stop counts in: the step itself in an independent block, else its block. */
export function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? `${s.block}/${s.id}` : s.block;
}

/** Client codes that stop the battery (the brief's stop rules). */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/**
 * Refusal codes that prove a handler compiled and answered: a domain refusal is an answer.
 * UNREACHABLE, HANDLER_ERROR or an unknown-handler answer is not.
 */
export const DOMAIN_CODES: ReadonlySet<string> = new Set([
  "ENGINE_FALSE",
  "STALE_CURSOR",
  "RESOURCE_NOT_FOUND",
  "ENTITY_NOT_FOUND",
  "NOT_A_SHAPE",
  "INVALID_ARGUMENT",
  "NOT_IN_PROJECT",
  "NOT_ALLOWLISTED",
  "PRECONDITION_UNMET",
  "MODULE_NOT_OPEN",
  "NO_WORLD",
  "WRONG_MODE",
  "NO_TERRAIN",
  "GATED",
]);
/** The run refusals a class's dry run or confirm may answer, each recorded per class. */
export const RUN_ANSWERS: ReadonlySet<string> = new Set([
  "PRECONDITION_UNMET",
  "MODULE_NOT_OPEN",
  "NOT_ALLOWLISTED",
  "GATED",
  "NO_WORLD",
  "WRONG_MODE",
]);

/** Titles a step may add: the editors' main windows. */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
export const WORKBENCH_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  /^World Editor$/,
  DEBUG_TITLE,
  /^Script Editor( - .+)?$/,
  /^Enfusion Workbench( - .+)?$/,
  /^Arma Reforger Workbench$/,
  /^String Editor( - .+)?$/,
  /^Localization Editor( - .+)?$/,
  /^Procedural Animation Editor$/,
  /^Behavior Editor - EMCP2_sandbox$/,
  /^Audio Editor$/,
  /^Animation Editor$/,
];

// ── Coverage tables ──────────────────────────────────────────────────────────

/** The W6 contracts in contracts/ and the TS tool that drives each. */
export const W6_CONTRACTS = {
  EMCP_WB_Plugin: "wb_plugin",
  EMCP_WB_WorldTools: "wb_world_tools",
  EMCP_WB_Shape: "wb_shape",
} as const;

/**
 * The TypeScript-only actions of the wave's tools (spec 2.1 list, 2.2 goToCoords, 2.3 area and
 * import, 2.4 script_create's scriptType plugin, 2.5 wb_cli_run's plugin verb, wb_bi call).
 */
export const TS_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  wb_plugin: ["list"],
  wb_world_tools: WORLD_TOOLS_TS_ACTIONS,
  wb_shape: ["area", "import"],
  script_create: ["plugin"],
  wb_cli_run: ["plugin"],
  wb_bi: ["call"],
};

/** Actions no step exercises, with the reason. */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {
  "wb_cli_run.plugin":
    "a headless CLI run is its own Workbench process on the same profile and project (P-W6-08, snapshot-hashed, one class at a time); it cannot run beside the GUI Workbench this battery drives, so the runbook runs it on the CLI lane before the GUI launch (W6.md step 3), as the spec's run order 2 says",
  "wb_shape.edit":
    "added to EMCP_WB_Shape by wave W7 (DEC-075) after this battery ran; it is gated by EDIT_OPEN until probe P-W7-14, and the W7 battery (tests/live/w7.live.ts) exercises it",
};

/** Probes no step can settle in this battery, with the reason (the rest are assigned to steps). */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {
  "P-W6-08":
    "headless RunCommandline plugins through wb_cli_run: a separate Workbench process (DEC-053 L7 stalls under -forceSettings), never beside the GUI launch; the runbook runs it on the CLI lane before the GUI launch, snapshot-hashed (W6.md step 3, spec run order 2)",
  "P-W6-09":
    "server_launch and wb_launch switch pass-through: argv of a dedicated-server process and one live server run killed by server_stop; neither is a Workbench call and the server cannot share this lane's launch; the runbook runs it on the CLI lane before the GUI launch (W6.md step 3, spec run order 2)",
  "P-W6-10":
    "script_create writes plugins under <project>/Scripts/WorkbenchGame/ and the compile check needs them there (wb_scripts validate compiles the module's folders only); this battery writes nothing outside _throwaway/W6/ and a broken file there stops the WorkbenchGame module (DEC-035); the main session runs it after the launch and before the battery, files deleted right after, no train (W6.md step 6, spec run order 1), and w6-31 opens the planted template in the Script Editor (the engine reads it back)",
  "P-W6-12":
    "GeoShapeLoader.LoadShapeFile is reached only by a probe handler that is not shipped (no probe pack in this launch); the TS reader is the import path either way (OD-7) and w6-26 is its engine accept",
};

/** The probe ids P-W6-01 .. P-W6-18. */
export const PROBE_IDS: readonly string[] = Array.from(
  { length: 18 },
  (_, i) => `P-W6-${String(i + 1).padStart(2, "0")}`,
);

// ── Types ────────────────────────────────────────────────────────────────────

export type W6Tool =
  | "wb_plugin"
  | "wb_world_tools"
  | "wb_shape"
  | "wb_entity"
  | "wb_view"
  | "wb_terrain"
  | "wb_world"
  | "wb_module"
  | "wb_container"
  | "wb_script_editor"
  | "wb_localization"
  | "wb_bi";

/** The wave's offline code, run in process (no NET call; in the coverage and write checks). */
export type OfflineTool =
  | "object_csv"
  | "coords"
  | "shape_area"
  | "shapefile"
  | "script_create"
  | "registry";

export const HANDLER_OF: Readonly<Record<W6Tool, string>> = {
  wb_plugin: "EMCP_WB_Plugin",
  wb_world_tools: "EMCP_WB_WorldTools",
  wb_shape: "EMCP_WB_Shape",
  wb_entity: "EMCP_WB_Entity",
  wb_view: "EMCP_WB_View",
  wb_terrain: "EMCP_WB_Terrain",
  wb_world: "EMCP_WB_World",
  wb_module: "EMCP_WB_Module",
  wb_container: "EMCP_WB_Container",
  wb_script_editor: "EMCP_WB_ScriptEditor",
  wb_localization: "EMCP_WB_Localization",
  wb_bi: "<bi handler>",
};

export type Block = "W6.0" | "W6.1" | "W6.2" | "W6.3" | "W6.4" | "W6.5" | "W6.8" | "W6.9";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "KILLED" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED" | "HELD";

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

/** One registry key the read-only query found (P-W6-04): names and kinds only, never values. */
export interface RegistryKey {
  path: string;
  values: Array<{ name: string; kind: string }>;
}

/**
 * The system clipboard as the step saves it (fix-up 2). `text`: plain text only (the text formats
 * Windows derives from it and nothing else), held in `text`; `empty`: no format at all; `other`:
 * anything else (an image, files, HTML or RTF beside the text), which the step cannot save
 * faithfully, so the class that writes the clipboard is not confirmed; `error`: the read failed.
 */
export interface ClipboardSnap {
  state: "text" | "empty" | "other" | "error";
  text: string;
  formats: string[];
  error: string | null;
}

/** The formats a plain-text copy carries on Windows (the ones synthesized from CF_UNICODETEXT). */
const PLAIN_TEXT_FORMATS = new Set(["System.String", "UnicodeText", "Text", "OEMText", "Locale"]);

/** Classifies a clipboard read: the formats it lists and the text it held (null for none). */
export function clipboardSnapOf(formats: string[], text: string | null): ClipboardSnap {
  if (formats.length === 0) return { state: "empty", text: "", formats, error: null };
  if (text !== null && formats.every((f) => PLAIN_TEXT_FORMATS.has(f)))
    return { state: "text", text, formats, error: null };
  return { state: "other", text: "", formats, error: null };
}

/** True when two snapshots hold the same thing (the same text, or both empty). */
export function sameClipboard(a: ClipboardSnap, b: ClipboardSnap): boolean {
  if (a.state !== b.state) return false;
  if (a.state === "text") return a.text === b.text;
  return a.state === "empty";
}

/**
 * Puts the saved clipboard back: nothing when it already holds the saved snapshot (the plugin did
 * not run, or wrote nothing), else the write, then a read-back. Answers `ok: false` with a code
 * and a message naming what failed; never leaves the plugin's text when the write fails silently.
 */
export async function restoreClipboard(
  deps: Pick<W6Deps, "clipboardRead" | "clipboardWrite">,
  saved: ClipboardSnap,
): Promise<{ ok: boolean; action: string; code?: string; message?: string; readback?: Raw }> {
  const now = await deps.clipboardRead();
  if (sameClipboard(now, saved))
    return { ok: true, action: "clipboard", readback: { restored: "unchanged", state: now.state } };
  const w = await deps.clipboardWrite(saved);
  if (!w.ok)
    return {
      ok: false,
      action: "clipboard",
      code: "RESTORE_FAILED",
      message: `writing the saved ${saved.state} clipboard failed: ${w.error ?? "the write gave no error text"}`,
    };
  const back = await deps.clipboardRead();
  if (!sameClipboard(back, saved))
    return {
      ok: false,
      action: "clipboard",
      code: "RESTORE_MISMATCH",
      message: `the clipboard reads ${back.state} [${back.formats.join(", ")}]${back.error ? ` (${back.error})` : ""} after the restore; ${saved.state} was saved`,
    };
  return { ok: true, action: "clipboard", readback: { restored: "written", state: back.state } };
}

/**
 * One wb_container get of an entity's Flags (fix-up 2). `int` is the value when it reads as an
 * integer, else, for a FLAGS variable, the first word of defaultValue ("0x403 0": hex, then a
 * second word) when nothing overrides it: the prefab's value.
 */
export interface FlagsRead {
  value: string;
  varType: string;
  isSetDirectly: boolean | null;
  defaultValue: string;
  int: number | null;
}

export function flagsReadOf(r: Raw): FlagsRead {
  const value = S(r.value);
  const varType = S(r.varType);
  const isSetDirectly =
    r.isSetDirectly === undefined || r.isSetDirectly === null ? null : truthy(r.isSetDirectly);
  const defaultValue = S(r.defaultValue);
  const word = (t: string): number | null => {
    const w = t.trim().split(/\s+/)[0] ?? "";
    if (/^0x[0-9a-f]+$/i.test(w)) return parseInt(w.slice(2), 16);
    if (/^-?\d+$/.test(w)) return Number(w);
    return null;
  };
  let int = value !== "" ? word(value) : null;
  if (int === null && value === "" && isSetDirectly !== true) int = word(defaultValue);
  return { value, varType, isSetDirectly, defaultValue, int };
}

/**
 * P-W6-15 from the reads (fix-up 2). With the values readable it compares values; while
 * wb_container get renders no FLAGS value it follows the override (isSetDirectly): cleared by
 * the reset, back after one undo. That is PARTIAL, not SETTLED: the restored value is unread.
 */
export function flagsVerdict(x: {
  setOk: boolean;
  resetOk: boolean;
  changed: number;
  prefab: string;
  setTo: string;
  reads: [FlagsRead, FlagsRead, FlagsRead];
  observed: Raw;
}): ProbeResult {
  const [set, reset, undo] = x.reads;
  const o = x.observed;
  if (!x.setOk || !x.resetOk) return partial("P-W6-15", o, "the set or the reset was refused");
  if (set.isSetDirectly !== true)
    return partial("P-W6-15", o, "the set did not read back as an override (isSetDirectly)");
  if (x.changed < 1)
    return partial(
      "P-W6-15",
      o,
      "resetFlags changed nothing: bit 64 may lie outside its reset mask (the EntityFlags values are not in the API index)",
    );
  const readable = [set, reset, undo].every((r) => r.value !== "" && r.int !== null);
  if (readable) {
    if (reset.int !== Number(x.prefab))
      return killed("P-W6-15", o, `after reset Flags ${reset.value}, the prefab's ${x.prefab}`);
    if (undo.int !== Number(x.setTo))
      return killed("P-W6-15", o, `one undo gave ${undo.value}, the set value was ${x.setTo}`);
    return settled("P-W6-15", o, "reset to the prefab's; one undo restored");
  }
  if (reset.isSetDirectly !== false)
    return killed("P-W6-15", o, "after reset the Flags override is still set");
  if (undo.isSetDirectly !== true)
    return killed("P-W6-15", o, "one undo did not bring the Flags override back");
  return partial(
    "P-W6-15",
    o,
    "the reset cleared the override and one undo brought it back (isSetDirectly); the value is unread: wb_container get renders no FLAGS value",
  );
}

export interface W6Deps {
  /** One shipped TS tool, run in process against a client WITHOUT a Config. */
  tool: (name: W6Tool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** EMCP_WB_EditorControl {action: "undo"} (World Editor Edit > Undo), never retried. */
  undo: () => Promise<UndoResult>;
  /** EMCP_WB_Info and EMCP_WB_Ping through client.probe (reads). */
  info: () => Promise<Record<string, unknown> | null>;
  ping: () => Promise<Record<string, unknown> | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  /** P-W6-04: a read-only query of the ScriptTools keys under HKCU\Software\Bohemia Interactive. */
  registry: () => Promise<{ ok: boolean; keys: RegistryKey[]; error?: string }>;
  /** The system clipboard (SCR_CopyClassAndMethodPlugin's oracle; saved and put back). */
  clipboardRead: () => Promise<ClipboardSnap>;
  /** Puts a saved snapshot back: its text, or an empty clipboard. Never a non-text snapshot. */
  clipboardWrite: (snap: ClipboardSnap) => Promise<{ ok: boolean; error: string | null }>;
  /** The E03 catalog's tool classes (P-W6-04 matches registry subkeys against them). */
  toolClasses: () => string[];
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  /** Relative paths of every file under `dir` (forward slashes), [] when absent. */
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W6Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** Record the hand steps HELD instead of waiting for the hand. */
  skipHand?: boolean;
}

/** What a step left behind: undo points still on the stack and state to restore. */
export interface Debt {
  undos: number;
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W6Deps;
  opts: W6Options;
  prior: (id: string) => StepRecord | null;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  /** Values steps share within one run (the terrain spot, script resource names). */
  state: Map<string, string>;
  /** A tool call: guarded by the window poller; a stop code throws unless `tolerate`. */
  tool: (
    name: W6Tool,
    args: Record<string, unknown>,
    o?: { restore?: boolean; tolerate?: boolean },
  ) => Promise<ToolResponse>;
  /** One Edit > Undo; pays one undo point when it answers ok. */
  undo: () => Promise<UndoResult>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

/** One offline call of a step (no NET call; in the coverage and write checks). */
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
  /** A hand step: the main session's hand answers a request file; no window poll. */
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

function sha256(b: Buffer | Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(sandboxDir: string, rel: string): string {
  return join(sandboxDir, ...rel.split("/"));
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => S(x)) : [];
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function readJson<T>(path: string, deps: Pick<W6Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W6Deps, "writeBytes">): void {
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

/** "x y z" (or "x,y,z") as three numbers, null when it is not. */
export function vec3(text: unknown): [number, number, number] | null {
  const p = S(text)
    .replace(/,/g, " ")
    .trim()
    .split(/\s+/)
    .filter((x) => x !== "")
    .map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return null;
  return [p[0]!, p[1]!, p[2]!];
}

/** True when both vectors parse and each component differs by at most `tol`. */
export function near(a: unknown, b: unknown, tol: number): boolean {
  const x = Array.isArray(a) ? (a as number[]) : vec3(a);
  const y = Array.isArray(b) ? (b as number[]) : vec3(b);
  if (!x || !y || x.length !== y.length) return false;
  return x.every((v, i) => Math.abs(v - y[i]!) <= tol);
}

/** An angle difference folded into -180..180 degrees. */
function angleDiff(a: number, b: number): number {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function anglesNear(a: unknown, b: unknown, tol: number): boolean {
  const x = vec3(a);
  const y = vec3(b);
  if (!x || !y) return false;
  return x.every((v, i) => Math.abs(angleDiff(v, y[i]!)) <= tol);
}

/** Two Object Import rows equal after the float formatting step (P-W6-07). */
export function sameImportRow(a: string, b: string): { same: boolean; why: string } {
  const pa = fromHandlerRow(a);
  const pb = fromHandlerRow(b);
  if (!("row" in pa) || !("row" in pb)) return { same: false, why: "a row does not parse" };
  const x = pa.row;
  const y = pb.row;
  if (guidOf(x.prefab) !== guidOf(y.prefab)) return { same: false, why: "prefab differs" };
  if (!near(x.position.map(Number), y.position.map(Number), POS_TOL))
    return { same: false, why: `position ${x.position.join(" ")} vs ${y.position.join(" ")}` };
  const qa = x.quaternion.map(Number);
  const qb = y.quaternion.map(Number);
  // q and -q are one rotation.
  const flip = qa.reduce((s, v, i) => s + v * qb[i]!, 0) < 0 ? -1 : 1;
  if (!qa.every((v, i) => Math.abs(v - flip * qb[i]!) <= 1e-4))
    return {
      same: false,
      why: `quaternion ${x.quaternion.join(" ")} vs ${y.quaternion.join(" ")}`,
    };
  if (Math.abs(Number(x.scale) - Number(y.scale)) > 1e-4)
    return { same: false, why: `scale ${x.scale} vs ${y.scale}` };
  return { same: true, why: "" };
}

/** The GUID of a resource name `{GUID}path`, "" when it has none. */
export function guidOf(name: string): string {
  const m = /^\{([0-9A-Fa-f]{16})\}/.exec(name);
  return m ? m[1]!.toUpperCase() : "";
}

/** An entity reference normalised for comparison ("id:0x00ab..." lower case). */
export function refKey(ref: string): string {
  return ref.trim().toLowerCase();
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The plan entry of one tool call: the handler it sends to, the wire action, tool and action. */
export function tc(
  tool: W6Tool,
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
  "wb_world.new",
  "wb_world.register",
  "wb_container.save",
  "wb_script_editor.save",
  "wb_localization.save",
  "wb_module.save",
]);

/**
 * World edits whose ok answer is one undo point even when the readback names none: counted by
 * the context (an over-count only meets "nothing to undo"; an under-count would leave an edit).
 */
export const UNDO_EDITS: ReadonlySet<string> = new Set([
  "wb_entity.create",
  "wb_entity.delete",
  "wb_entity.transform",
  "wb_shape.create",
  "wb_shape.area",
  "wb_world_tools.importObjects",
  "wb_world_tools.replaceEntities",
]);

const WINDOW_KILL =
  "a new dialog-like window: HANDOFF (nothing sent to it; the record names the title and the answer, never Save); any other new window: STOP; LOST, WEDGED or MODAL_OPEN: STOP";

// ── Fixtures (planted offline) ───────────────────────────────────────────────

/** The rows of the planted CSV: three PROP instances with a turn and a scale each. */
export const CSV_ROWS: readonly ObjectRow[] = [
  {
    prefab: PROP,
    position: ["70", "0", "70"],
    quaternion: ["0", "0", "0", "1"],
    scale: "1",
  },
  {
    prefab: PROP,
    position: ["72", "0", "70"],
    quaternion: ["0", "0.382683", "0", "0.92388"],
    scale: "1.5",
  },
  {
    prefab: PROP,
    position: ["74", "0.5", "70"],
    quaternion: ["0", "0.707107", "0", "0.707107"],
    scale: "0.75",
  },
];

/** The CSV text the plant writes (the codec's canonical form with a header). */
export function csvText(): string {
  return formatCsv([...CSV_ROWS], { header: true });
}

function shpFile(
  shapeType: number,
  records: Array<{ parts?: number[]; points: ShpPoint[] }>,
): ShpFile {
  const all = records.flatMap((r) => r.points);
  const box = boxOf(all);
  const recs: ShpRecord[] = records.map((r, i) =>
    shapeType === 1
      ? { number: i + 1, type: shapeType, points: r.points }
      : {
          number: i + 1,
          type: shapeType,
          box: boxOf(r.points),
          parts: r.parts ?? [0],
          points: r.points,
        },
  );
  return {
    header: {
      unused: [0, 0, 0, 0, 0],
      fileLengthWords: 0,
      version: 1000,
      shapeType,
      bbox: [box[0] ?? 0, box[1] ?? 0, box[2] ?? 0, box[3] ?? 0, 0, 0, 0, 0],
    },
    records: recs,
    trailing: new Uint8Array(0),
  };
}

/** The polyline fixture: one single-part line of 3 points, one line of two parts (2 + 3 points). */
export function linesShp(): ShpFile {
  return shpFile(3, [
    {
      parts: [0],
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
    {
      parts: [0, 2],
      points: [
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        { x: 20, y: 10 },
        { x: 25, y: 15 },
        { x: 30, y: 10 },
      ],
    },
  ]);
}

/** The point fixture: two point records (reported by import, never placed). */
export function pointsShp(): ShpFile {
  return shpFile(1, [{ points: [{ x: 1, y: 2 }] }, { points: [{ x: 3, y: 4 }] }]);
}

/** The parts import creates from the polyline fixture: their point counts, in order. */
export const LINE_PARTS: readonly number[] = [3, 2, 3];

/** The template text of one plugin base (script_create's generator, scriptType plugin). */
export function templateText(base: string): string {
  return generateScript({
    className: templateClass(base),
    scriptType: "plugin",
    parentClass: base,
    description: "EMCP W6 battery: plugin template fixture (never compiled; _throwaway/W6/)",
    ...(base === "WorkbenchPlugin" ? { module: "ScriptEditor" } : {}),
  });
}

/** Every planted file: project-relative path to its bytes. */
export function plantBytes(): Record<string, Buffer> {
  const lines = linesShp();
  const points = pointsShp();
  const out: Record<string, Buffer> = {
    [CSV_REL]: Buffer.from(csvText(), "utf-8"),
    [SHP_LINES]: Buffer.from(writeShp(lines)),
    [SHX_LINES]: Buffer.from(writeShx(lines)),
    [SHP_POINTS]: Buffer.from(writeShp(points)),
    [SHX_POINTS]: Buffer.from(writeShx(points)),
  };
  for (const b of TEMPLATE_BASES) out[templateRel(b)] = Buffer.from(templateText(b), "utf-8");
  return out;
}

/** The planted files on disk; a missing one stops the battery (nothing absent is ever sent). */
function ensurePlanted(ctx: StepContext): void {
  const missing = PLANTED.filter((rel) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)));
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `planted file(s) absent: ${missing.join(", ")}: run \`w6.live.ts plant\` first (nothing is sent for a file that is not on disk)`,
    );
}

// ── Offline proofs (no Workbench call) ───────────────────────────────────────

/** The coords parser cases of SCR_CoordsTool (spec 4) with the vanilla rule's answer. */
export const COORDS_CASES: ReadonlyArray<{ text: string; form: string; position: number[] }> = [
  { text: "100,20,300;-30,45,0", form: "coords", position: [100, 20, 300] },
  {
    text: "enfusion://WorldEditor/worlds/Arland/EmptyArland.ent;100,20,300;-30,45,0",
    form: "link",
    position: [100, 20, 300],
  },
  {
    text: "https://enfusionengine.com/api/redirect?to=enfusion://WorldEditor/worlds/Arland/EmptyArland.ent;1,2,3",
    form: "link",
    position: [1, 2, 3],
  },
  { text: "0102", form: "map", position: [1 * 1000 + 500, 0, 2 * 1000] },
  { text: "012 034", form: "map", position: [12 * 100 + 50, 0, 34 * 100] },
  { text: "01230456", form: "map", position: [123 * 10 + 5, 0, 456 * 10] },
  { text: "0012300456", form: "map", position: [123 + 0.5, 0, 456] },
];

/** The offline proofs: CSV, shapefile, coords, area, template; each a list of failures. */
export function offlineProofs(read: (rel: string) => Buffer | null): Record<string, Raw> {
  const out: Record<string, Raw> = {};
  const csv = read(CSV_REL);
  if (!csv) out.csv = { ok: false, why: "absent" };
  else {
    const text = csv.toString("utf-8");
    const doc = parseCsv(text);
    const rows = csvRowsOf(doc);
    out.csv = {
      ok: serializeCsv(doc) === text && rows.length === CSV_ROWS.length && doc.header,
      rows: rows.length,
      header: doc.header,
      roundTrip: serializeCsv(doc) === text,
    };
  }
  const shp: Raw = {};
  for (const [s, x] of [
    [SHP_LINES, SHX_LINES],
    [SHP_POINTS, SHX_POINTS],
  ] as const) {
    const b = read(s);
    const bx = read(x);
    if (!b || !bx) {
      shp[s] = { ok: false, why: "absent" };
      continue;
    }
    const f = readShp(b);
    const back = Buffer.from(writeShp(f));
    const shxBad = compareShx(f, readShx(bx));
    shp[s] = {
      ok: back.equals(b) && shxBad.length === 0,
      records: f.records.length,
      byteExact: back.equals(b),
      shx: shxBad,
      parts: f.records.map((r) => recordParts(r).map((p) => p.length)),
    };
  }
  out.shapefile = { ok: Object.values(shp).every((v) => (v as Raw).ok === true), files: shp };
  const coords = COORDS_CASES.map((c) => {
    try {
      const p = parseCoordsText(c.text);
      return {
        text: c.text,
        ok: p.form === c.form && near(p.position, c.position, 1e-9),
        form: p.form,
        position: p.position,
      };
    } catch (e) {
      return { text: c.text, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  out.coords = { ok: coords.every((c) => c.ok), cases: coords };
  const specs: AreaSpec[] = [
    { shape: "circle", width: 20, segments: 12 },
    { shape: "rectangle", width: 20, length: 10, segments: 3 },
    { shape: "star", width: 20, branches: 5, innerRatio: 0.5 },
  ];
  const area = specs.map((s) => ({
    spec: s,
    count: areaPointCount(s),
    points: areaPoints(s).length,
    ok: areaPointCount(s) === areaPoints(s).length,
  }));
  out.area = { ok: area.every((a) => a.ok), specs: area };
  const tpl = TEMPLATE_BASES.map((b) => {
    const t = read(templateRel(b));
    const text = t ? t.toString("utf-8") : "";
    const attr = b === "WorldEditorTool" ? "WorkbenchToolAttribute" : "WorkbenchPluginAttribute";
    return {
      base: b,
      ok:
        text === templateText(b) &&
        text.includes("#ifdef WORKBENCH") &&
        text.includes(`[${attr}(`) &&
        text.includes(`class ${templateClass(b)}`),
    };
  });
  out.template = { ok: tpl.every((t) => t.ok), bases: tpl };
  return out;
}

// ── World helpers ────────────────────────────────────────────────────────────

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
  if (ctx.debt.undos > 0 || ctx.debt.restorers.length > 0)
    return {
      ok: false,
      worldPath: "",
      evidence: { refused: "the step still owes undo points: no world switch over an edit" },
    };
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

/** The W6 world on disk and registered (`wb_world new` when absent), then open. */
async function ensureWorld(ctx: StepContext, evidence: Raw, fails: string[]): Promise<boolean> {
  ensurePlanted(ctx);
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
  if (!o.ok) fails.push(`the W6 world did not open ('${o.worldPath}')`);
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

/** The terrain spot (the terrain's centre) of the vanilla world, cached for the run. */
export interface Spot {
  x: number;
  z: number;
}

/** The vanilla terrain world open (W6.4) and the spot every terrain step builds around. */
async function ensureTerrain(
  ctx: StepContext,
  evidence: Raw,
  fails: string[],
): Promise<Spot | null> {
  const st = await ctx.tool("wb_world", { action: "state" });
  if (!(st.ok && S(rb(st).worldPath).toLowerCase().endsWith(VANILLA_WORLD.toLowerCase()))) {
    const o = await openWorld(ctx, VANILLA_WORLD);
    evidence.open = o.evidence;
    if (!o.ok) {
      fails.push(`${VANILLA_WORLD} did not open ('${o.worldPath}')`);
      return null;
    }
  }
  const cached = ctx.state.get("w6.spot");
  if (cached) return JSON.parse(cached) as Spot;
  const info = await ctx.tool("wb_terrain", { action: "info" });
  evidence.terrainInfo = brief(info);
  const b = field(rb(info), "bounds") as Raw | undefined;
  const min = vec3(field(b, "min"));
  const max = vec3(field(b, "max"));
  if (!info.ok || !truthy(rb(info).hasTerrain) || !min || !max) {
    fails.push(`no terrain in ${VANILLA_WORLD}: ${why(info)}`);
    return null;
  }
  const spot: Spot = {
    x: Math.round((min[0] + max[0]) / 2),
    z: Math.round((min[2] + max[2]) / 2),
  };
  ctx.state.set("w6.spot", JSON.stringify(spot));
  return spot;
}

function terrainPlan(): PlanAction[] {
  return [tc("wb_world", "state"), ...openPlan(VANILLA_WORLD), tc("wb_terrain", "info")];
}

/** Terrain heights at "x z" points; null per point off the terrain. */
async function heights(
  ctx: StepContext,
  pts: Array<[number, number]>,
): Promise<Array<number | null>> {
  const r = await ctx.tool("wb_terrain", {
    action: "heights",
    points: pts.map(([x, z]) => `${x} ${z}`),
  });
  const rows = Array.isArray(rb(r).points) ? (rb(r).points as Raw[]) : [];
  return pts.map((_, i) => {
    const row = rows[i];
    return row && row.onTerrain === true && typeof row.y === "number" ? row.y : null;
  });
}

/** One entity of `prefab` named W6_<name>; its reference ("id:0x...") or "" on a refusal. */
async function create(
  ctx: StepContext,
  name: string,
  coords: string,
  o: { prefab?: string; angles?: string; parent?: string } = {},
): Promise<{ r: ToolResponse; ref: string }> {
  const r = await ctx.tool("wb_entity", {
    action: "create",
    prefab: o.prefab ?? PROP,
    name: `${NAME_PREFIX}${name}`,
    coords,
    ...(o.angles ? { angles: o.angles } : {}),
    ...(o.parent ? { parent: o.parent } : {}),
  });
  return { r, ref: r.ok ? S(rb(r).id) : "" };
}

function createPlan(n: number, extra: Raw = {}): PlanAction[] {
  return Array.from({ length: n }, (_, i) =>
    tc("wb_entity", "create", {
      prefab: PROP,
      name: `${NAME_PREFIX}<${i}>`,
      coords: "<x y z>",
      ...extra,
    }),
  );
}

async function get(ctx: StepContext, ref: string): Promise<ToolResponse> {
  return ctx.tool("wb_entity", { action: "get", entity: ref });
}

/** The entity count of the open world (wb_entity list total). */
async function entityTotal(ctx: StepContext): Promise<number | null> {
  const r = await ctx.tool("wb_entity", { action: "list", limit: 1 });
  const t = rb(r).total;
  return r.ok && typeof t === "number" ? t : null;
}

/**
 * Pays every undo point the step owes, runs its restorers, then checks the world holds as many
 * entities as before the step (an edit left behind is a FAIL, never silent).
 */
async function settle(
  ctx: StepContext,
  evidence: Raw,
  fails: string[],
  totalBefore: number | null,
): Promise<void> {
  const undos: UndoResult[] = [];
  while (ctx.debt.undos > 0) {
    const u = await ctx.undo();
    undos.push(u);
    if (!u.ok) {
      fails.push(`undo answered ${u.code ?? ""} ${u.message}: ${ctx.debt.undos} point(s) unpaid`);
      break;
    }
  }
  evidence.undos = undos.length;
  for (const r of [...ctx.debt.restorers].reverse()) {
    try {
      const v = (await r.fn()) as ToolResponse | undefined;
      if (v && v.ok === false) fails.push(`restore ${r.label}: ${why(v)}`);
    } catch (e) {
      fails.push(`restore ${r.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  ctx.debt.restorers = [];
  const after = await entityTotal(ctx);
  evidence.entityTotal = { before: totalBefore, after };
  if (totalBefore !== null && after !== totalBefore)
    fails.push(`the world holds ${String(after)} entities after the undo, ${totalBefore} before`);
}

/** The selection emptied (view state; no undo point). */
async function clearSelection(ctx: StepContext): Promise<ToolResponse> {
  return ctx.tool("wb_view", { action: "select", mode: "clear" });
}

// ── Hand requests (W1's mechanism) ───────────────────────────────────────────

/**
 * Asks the main session's hand for one observation or action: writes the request file, logs one
 * HAND REQUEST line and polls for the answer file (JSON) up to HAND_WAIT_MS, calling `tick` on
 * every poll (the watchdog). Null when none came.
 */
async function awaitHand(
  ctx: StepContext,
  key: string,
  instruction: string,
  tick: () => Promise<void> = async () => undefined,
): Promise<Raw | null> {
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
    await tick();
    const a = readJson<Raw>(f.answer, ctx.deps);
    if (a) return a;
    if (ctx.deps.now() - started + TIMEOUTS.windowPoll > HAND_WAIT_MS) return null;
    await ctx.deps.sleep(TIMEOUTS.windowPoll);
  }
}

// ── Net-zero (the battery's own snapshot, outside _throwaway/W6/) ────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  root: string;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W6/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W6Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W6_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

/**
 * Writes the battery's before-snapshot into the sitting folder when none is there, and answers
 * whether it did. runBattery calls it before the first step of every run that does not begin at
 * the gate (--from, --only), so the net-zero step always has a baseline.
 */
export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W6Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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

/** The net-zero comparison: the battery's snapshot against the sandbox now, outside _throwaway/W6/. */
export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W6Deps, "exists" | "readBytes" | "listTree">,
): { takenBy: string; takenAt: string; changed: string[] } | null {
  const snap = readJson<BatterySnapshot>(join(sittingDir, BATTERY_SNAPSHOT_FILE), deps);
  if (!snap || snap.kind !== BATTERY_SNAPSHOT_KIND || typeof snap.files !== "object") return null;
  const before = Object.fromEntries(
    Object.entries(snap.files).filter(([f]) => !f.startsWith(`${W6_ROOT}/`)),
  );
  return {
    takenBy: S(snap.taken_by),
    takenAt: S(snap.taken_at),
    changed: changedFiles(before, sandboxHashes(sandboxDir, deps)),
  };
}

// ── Plugin runs ──────────────────────────────────────────────────────────────

/** One class's run record: the dry run, the confirm and what happened after. */
export interface RunVerdict {
  className: string;
  dry: string;
  confirm: string;
  ran: boolean;
  oracle?: Raw;
}

/** The answer code of a run call: "ok" or the refusal code. */
function answerOf(r: ToolResponse | null): string {
  if (!r) return "not sent";
  return r.ok ? (truthy(rb(r).ran) ? "ran" : "ok") : S(r.code);
}

/**
 * P-W6-05 for the classes of one step: SETTLED when every class ran with its oracle read back,
 * KILLED when a class ran with no read-back (a window is a STOP before this), else PARTIAL with
 * each class's answers (GATED until the main session turns RunProven; NOT_ALLOWLISTED until the
 * policy's plugin_run_allow_list names the class; PRECONDITION_UNMET when its set-up is absent).
 */
export function runProbe(verdicts: RunVerdict[]): ProbeResult {
  const observed = Object.fromEntries(
    verdicts.map((v) => [
      v.className,
      { dry: v.dry, confirm: v.confirm, ran: v.ran, oracle: v.oracle ?? null },
    ]),
  );
  const bad = verdicts.filter((v) => v.ran && v.oracle?.ok !== true);
  if (bad.length)
    return killed(
      "P-W6-05",
      observed,
      `${bad.map((v) => v.className).join(", ")} ran with no read-back: the class leaves the allow-list`,
    );
  if (verdicts.length && verdicts.every((v) => v.ran))
    return settled("P-W6-05", observed, "every class ran and its effect read back");
  return partial(
    "P-W6-05",
    observed,
    `ran: ${
      verdicts
        .filter((v) => v.ran)
        .map((v) => v.className)
        .join(", ") || "none"
    }; the rest answered ${[...new Set(verdicts.filter((v) => !v.ran).map((v) => v.confirm))].join(", ")} (GATED until RunProven, NOT_ALLOWLISTED until policy plugin_run_allow_list, PRECONDITION_UNMET when the set-up is absent)`,
  );
}

/**
 * The dry run, then the confirm only when the dry run answered ok (the preconditions are met) and
 * no `hold` names a reason not to confirm (the clipboard the step cannot save, fix-up 2).
 */
async function runClass(
  ctx: StepContext,
  c: { module: string; className: string },
  oracle: (dry: ToolResponse) => Promise<Raw>,
  hold: string | null = null,
): Promise<{ verdict: RunVerdict; evidence: Raw; fails: string[] }> {
  const fails: string[] = [];
  const base = { action: "run", moduleName: c.module, className: c.className };
  const dry = await ctx.tool("wb_plugin", base);
  const evidence: Raw = { dry: brief(dry) };
  if (dry.ok && truthy(rb(dry).ran)) fails.push(`${c.className}: the dry run ran the plugin`);
  if (!dry.ok && !RUN_ANSWERS.has(S(dry.code))) fails.push(`${c.className} dry: ${why(dry)}`);
  let conf: ToolResponse | null = null;
  let ran = false;
  let read: Raw | undefined;
  if (dry.ok && hold) evidence.held = hold;
  if (dry.ok && !hold) {
    conf = await ctx.tool("wb_plugin", { ...base, confirm: true });
    evidence.confirm = brief(conf);
    ran = conf.ok && truthy(rb(conf).ran);
    if (!conf.ok && !RUN_ANSWERS.has(S(conf.code)))
      fails.push(`${c.className} confirm: ${why(conf)}`);
    if (ran) {
      read = await oracle(conf);
      evidence.oracle = read;
    }
  }
  return {
    verdict: {
      className: c.className,
      dry: answerOf(dry),
      confirm: conf
        ? answerOf(conf)
        : dry.ok && hold
          ? `not sent (${hold})`
          : "not sent (the dry run refused)",
      ran,
      ...(read ? { oracle: read } : {}),
    },
    evidence,
    fails,
  };
}

function runPlan(classes: ReadonlyArray<{ module: string; className: string }>): PlanAction[] {
  return classes.flatMap((c) => [
    tc(
      "wb_plugin",
      "run",
      { moduleName: c.module, className: c.className },
      { note: "dry run: preconditions only" },
    ),
    tc(
      "wb_plugin",
      "run",
      { moduleName: c.module, className: c.className, confirm: true },
      {
        note: "only when the dry run answered ok; GATED until P-W6-05 opens the class Workbench-side",
      },
    ),
  ]);
}

// ── Steps ────────────────────────────────────────────────────────────────────

export function buildSteps(): StepDef[] {
  return [
    // ── W6.0 setup ──
    {
      id: GATE_STEP,
      block: "W6.0",
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
        const found = truthy(projectFound);
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
            `planted file(s) absent: ${missing.join(", ")}: run \`w6.live.ts plant\` first`,
            evidence,
          );
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        evidence.snapshot = BATTERY_SNAPSHOT_FILE;
        return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
      },
    },
    {
      id: "w6-01-handlers",
      block: "W6.0",
      title:
        "the three W6 handlers answer: Plugin, WorldTools, Shape (a read or a domain refusal each)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "wb_plugin describe of a read-listed class answers; wb_world_tools stats and wb_shape points of a missing entity answer ok or a domain refusal (NO_WORLD, ENTITY_NOT_FOUND, ...), never an unknown handler",
      kill_criterion:
        "a handler does not answer (UNREACHABLE, HANDLER_ERROR, an unknown-handler error): FAIL; the WorkbenchGame module did not compile it (DEC-035) and its steps cannot pass",
      side_effects: [
        "describe may open the World Editor module and bring it to the front (DEC-042 U10)",
      ],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_plugin", "describe", {
          moduleName: "WorldEditor",
          className: "SCR_SnapAndOrientToTerrainPlugin",
        }),
        tc("wb_world_tools", "stats", { limit: 1 }),
        tc("wb_shape", "points", { entity: "name:W6_missing" }),
      ],
      run: async (ctx) => {
        const calls: Array<[string, ToolResponse]> = [
          [
            "wb_plugin.describe",
            await ctx.tool("wb_plugin", {
              action: "describe",
              moduleName: "WorldEditor",
              className: "SCR_SnapAndOrientToTerrainPlugin",
            }),
          ],
          ["wb_world_tools.stats", await ctx.tool("wb_world_tools", { action: "stats", limit: 1 })],
          [
            "wb_shape.points",
            await ctx.tool("wb_shape", { action: "points", entity: "name:W6_missing" }),
          ],
        ];
        const evidence: Raw = Object.fromEntries(calls.map(([k, r]) => [k, brief(r)]));
        const dead = calls.filter(([, r]) => !r.ok && !DOMAIN_CODES.has(S(r.code)));
        return {
          ...verdictOf(
            dead.map(([k, r]) => `${k} gave no handler answer (${S(r.code)} ${S(r.message)})`),
            [],
            "Plugin, WorldTools and Shape answer",
          ),
          evidence,
        };
      },
    },
    {
      id: "w6-02-offline",
      block: "W6.0",
      title:
        "offline (no Workbench call): the planted CSV, shapefiles and templates re-read by the wave's code; coords and area maths; the read-only registry query (P-W6-04)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "CSV serialize(parse) byte-exact with 3 rows and a header; each shapefile write(read) byte-exact with its .shx agreeing; the coords cases equal the vanilla rules; area counts equal the outline lengths; every template is the generator's text with its attribute; the registry query lists the ScriptTools keys (names and kinds only, never values)",
      kill_criterion:
        "an offline proof fails: FAIL (its engine accept later would test a wrong fixture); P-W6-04: no ScriptTools subkey or binary values: KILLED (115 tool-setting rows re-point W8)",
      side_effects: [],
      rollback: "none (reads files in this process and the registry read-only)",
      probes: ["P-W6-04"],
      writes: [],
      plan: () => [],
      offlineCalls: () => [
        oc("object_csv", "roundTrip", { path: CSV_REL }),
        oc("shapefile", "roundTrip", { path: SHP_LINES }),
        oc("shapefile", "roundTrip", { path: SHP_POINTS }),
        oc("coords", "parse", { cases: COORDS_CASES.length }),
        oc("shape_area", "count", {}),
        ...TEMPLATE_BASES.map((b) =>
          oc("script_create", "plugin", { parentClass: b, path: templateRel(b), readOnly: true }),
        ),
        oc("registry", "query", { key: "HKCU\\Software\\Bohemia Interactive", readOnly: true }),
      ],
      run: async (ctx) => {
        ensurePlanted(ctx);
        const read = (rel: string): Buffer | null => {
          const p = abs(ctx.opts.sandboxDir, rel);
          return ctx.deps.exists(p) ? ctx.deps.readBytes(p) : null;
        };
        const proofs = offlineProofs(read);
        const fails = Object.entries(proofs)
          .filter(([, v]) => v.ok !== true)
          .map(([k]) => `offline proof ${k} failed`);
        const reg = await ctx.deps.registry();
        const tools = ctx.deps.toolClasses();
        const leaf = (p: string) => p.split("\\").pop() ?? p;
        const matched = reg.keys.filter((k) => tools.includes(leaf(k.path)));
        const binary = reg.keys.flatMap((k) =>
          k.values.filter((v) => /binary/i.test(v.kind)).map((v) => `${leaf(k.path)}.${v.name}`),
        );
        const observed = {
          ok: reg.ok,
          error: reg.error ?? null,
          keys: reg.keys.length,
          toolSubkeys: matched.map((k) => ({ key: leaf(k.path), values: k.values.length })),
          toolClasses: tools.length,
          binaryValues: binary,
        };
        const p4 = !reg.ok
          ? partial("P-W6-04", observed, `the registry query did not run: ${S(reg.error)}`)
          : matched.length === 0
            ? killed("P-W6-04", observed, "no ScriptTools subkey names an E03 tool class")
            : binary.length
              ? killed("P-W6-04", observed, `binary values: ${binary.slice(0, 5).join(", ")}`)
              : settled(
                  "P-W6-04",
                  observed,
                  `${matched.length} of ${tools.length} tool classes have a subkey, values as text`,
                );
        return {
          ...verdictOf(fails, [p4], "offline proofs pass; registry read"),
          evidence: { proofs, registry: observed },
          probes: [p4],
        };
      },
    },
    {
      id: "w6-03-world",
      block: "W6.0",
      title:
        "the W6 world: wb_world new (dry run, then confirm) under _throwaway/W6/worlds/, register, open",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected:
        "the dry run writes nothing; new writes the .ent and its layer; register answers; the World Editor opens it in edit mode",
      kill_criterion: `the world does not open: FAIL, and every W6.1/W6.2 world step stops on its own ensureWorld; ${WINDOW_KILL}`,
      side_effects: [`${WORLD} and its layers folder written`],
      rollback: "`w6.live.ts rollback` removes _throwaway/W6/ after Workbench is closed",
      probes: [],
      writes: [WORLDS_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => worldPlan(),
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const ok = await ensureWorld(ctx, evidence, fails);
        const st = await ctx.tool("wb_world", { action: "state" });
        evidence.state = brief(st);
        if (ok && S(rb(st).mode) && S(rb(st).mode) !== "edit") fails.push(`mode ${S(rb(st).mode)}`);
        return { ...verdictOf(fails, [], `${WORLD} open`), evidence };
      },
    },

    // ── W6.1 reads ──
    {
      id: "w6-10-plugin-list",
      block: "W6.1",
      title: "wb_plugin list (TS, ledger E03): pages, a module filter, a bad cursor",
      risk: "read-only",
      timeout_ms: 30_000,
      expected:
        "143 E03 classes (122 plugins, 21 tools) over pages; the ScriptEditor filter lists only ScriptEditor rows; cursor 'x' answers INVALID_ARGUMENT; nothing is sent to Workbench",
      kill_criterion: "the catalog is empty or the pages do not add up: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      plan: () => [
        tc(
          "wb_plugin",
          "list",
          { limit: 100 },
          { target: "<ts: census ledger>", note: "TS only: no NET call" },
        ),
        tc(
          "wb_plugin",
          "list",
          { limit: 100, cursor: "100" },
          { target: "<ts: census ledger>", note: "TS only" },
        ),
        tc(
          "wb_plugin",
          "list",
          { moduleName: "ScriptEditor" },
          { target: "<ts: census ledger>", note: "TS only" },
        ),
        tc(
          "wb_plugin",
          "list",
          { cursor: "x" },
          { target: "<ts: census ledger>", note: "TS only" },
        ),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const p1 = await ctx.tool("wb_plugin", { action: "list", limit: 100 });
        const total = Number(rb(p1).total ?? 0);
        const rows1 = Array.isArray(rb(p1).rows) ? (rb(p1).rows as Raw[]) : [];
        const p2 = await ctx.tool("wb_plugin", {
          action: "list",
          limit: 100,
          cursor: S(rb(p1).nextCursor) || "100",
        });
        const rows2 = Array.isArray(rb(p2).rows) ? (rb(p2).rows as Raw[]) : [];
        const se = await ctx.tool("wb_plugin", { action: "list", moduleName: "ScriptEditor" });
        const seRows = Array.isArray(rb(se).rows) ? (rb(se).rows as Raw[]) : [];
        const bad = await ctx.tool("wb_plugin", { action: "list", cursor: "x" });
        if (!p1.ok || total === 0) fails.push(`list: ${why(p1)} total ${total}`);
        if (total > 0 && rows1.length + rows2.length !== Math.min(total, 200))
          fails.push(`pages hold ${rows1.length}+${rows2.length} of ${total}`);
        if (seRows.some((r) => r.module !== "ScriptEditor")) fails.push("the module filter leaked");
        if (bad.ok || bad.code !== "INVALID_ARGUMENT") fails.push(`bad cursor: ${why(bad)}`);
        return {
          ...verdictOf(fails, [], `${total} classes; modal ${JSON.stringify(rb(p1).modal ?? {})}`),
          evidence: {
            total,
            modal: rb(p1).modal ?? null,
            page1: rows1.length,
            page2: rows2.length,
            scriptEditor: seRows.length,
            badCursor: brief(bad),
          },
        };
      },
    },
    {
      id: "w6-11-plugin-read",
      block: "W6.1",
      title:
        "wb_plugin describe and getSettings of every class on the read allow-list, module opened first (P-W6-01, P-W6-02)",
      risk: "read-only",
      timeout_ms: 300_000,
      expected:
        "each class: present, an instance, verdict/runnable/focusWarning from the TS side, settings rows {name,type,attribute,value}; scalars, ResourceName and vector render a value, arrays and objects the type only; no new unowned window",
      kill_criterion: `P-W6-01: a class raises a window, a modal or a crash: it stays off the read list (the window poller STOPs or HANDS OFF, the record names the class); P-W6-02: a type blocks the queue (WEDGED: STOP); ${WINDOW_KILL}`,
      side_effects: [
        "GetPlugin may bring a module window to the front (DEC-042 U10); the battery puts the World Editor back in front",
      ],
      rollback: "wb_module front WorldEditor",
      probes: ["P-W6-01", "P-W6-02"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...["WorldEditor", "ScriptEditor"].map((m) => tc("wb_module", "open", { moduleName: m })),
        tc("wb_plugin", "describe", {
          moduleName: "<module>",
          className: "<each read-listed class>",
        }),
        tc("wb_plugin", "getSettings", {
          moduleName: "<module>",
          className: "<each read-listed class>",
          limit: 200,
        }),
        tc("wb_module", "front", { moduleName: "WorldEditor" }),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const list = loadAllowList();
        const per: Raw = {};
        const types: Record<string, { rows: number; withValue: number }> = {};
        const modules = [...new Set(list.map((e) => e.module))];
        for (const m of modules) await ctx.tool("wb_module", { action: "open", module: m });
        let instances = 0;
        for (const e of list) {
          const d = await ctx.tool("wb_plugin", {
            action: "describe",
            moduleName: e.module,
            className: e.className,
          });
          const g = await ctx.tool("wb_plugin", {
            action: "getSettings",
            moduleName: e.module,
            className: e.className,
            limit: 200,
          });
          const settings = Array.isArray(rb(g).settings) ? (rb(g).settings as Raw[]) : [];
          for (const s of settings) {
            const t = S(s.type).replace(/<.*$/, "<>") || "?";
            types[t] ??= { rows: 0, withValue: 0 };
            types[t].rows++;
            if (S(s.value) !== "") types[t].withValue++;
          }
          if (truthy(rb(d).instance)) instances++;
          per[e.className] = {
            module: e.module,
            describe: brief(d),
            getSettings: g.ok
              ? { total: rb(g).total ?? null, rows: settings.length, sample: settings.slice(0, 5) }
              : brief(g),
          };
          if (!d.ok) fails.push(`${e.className} describe: ${why(d)}`);
          if (!g.ok) fails.push(`${e.className} getSettings: ${why(g)}`);
          if (d.ok && (rb(d).focusWarning === undefined || rb(d).runnable === undefined))
            fails.push(`${e.className}: describe lacks the TS enrichment (runnable, focusWarning)`);
        }
        const front = await ctx.tool("wb_module", { action: "front", module: "WorldEditor" });
        const o1 = { classes: list.length, instances, catalogPlugins: 124, per };
        const p1 =
          instances < list.length
            ? killed(
                "P-W6-01",
                o1,
                `${list.length - instances} read-listed class(es) gave no instance`,
              )
            : list.length >= 124
              ? settled("P-W6-01", o1, "every E03 WorkbenchPlugin class answered an instance")
              : partial(
                  "P-W6-01",
                  o1,
                  `${instances} of the ${list.length} read-listed classes answered an instance with no window; the widening to 124 classes is the integrator's probe build (policy plugin_read_allow_list)`,
                );
        const scalar = ["bool", "int", "float", "string", "ResourceName", "vector"];
        const silent = scalar.filter((t) => types[t] && types[t].withValue < types[t].rows);
        const p2 =
          Object.keys(types).length === 0
            ? partial("P-W6-02", { types }, "no settings row was read")
            : silent.length
              ? partial(
                  "P-W6-02",
                  { types },
                  `scalar types with an empty value: ${silent.join(", ")}`,
                )
              : settled("P-W6-02", { types }, "every scalar type read renders a value");
        return {
          ...verdictOf(fails, [p1, p2], `${list.length} classes read`),
          evidence: { per, types, front: brief(front) },
          probes: [p1, p2],
        };
      },
    },
    {
      id: "w6-12-plugin-refusals",
      block: "W6.1",
      title:
        "wb_plugin refusals: run of an E03 modal class (PLUGIN_MODAL), of an unlisted class (NOT_ALLOWLISTED), of the entry points; setSettings dry run and confirm (NO_SETTER) (P-W6-03 in part)",
      risk: "reversible",
      timeout_ms: 90_000,
      expected:
        "PLUGIN_MODAL and NOT_ALLOWLISTED raised before anything is sent; RunCommandline and Configure INVALID_ARGUMENT; a method key INVALID_ARGUMENT; setSettings without confirm answers the previous value and changed false; with confirm (the value read, so a no-op) NO_SETTER",
      kill_criterion:
        "a refusal does not come, or setSettings with confirm answers ok (a setter exists: OI-W6-1, the owner rules): FAIL; P-W6-03 is PARTIAL by design (its compile half is the main session's before the battery, W6.md step 6; its live half is the owner's OI-W6-1)",
      side_effects: [
        "none: every write is refused or a dry run; the confirm sends the value the variable holds",
      ],
      rollback: "none",
      probes: ["P-W6-03"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc(
          "wb_plugin",
          "run",
          { moduleName: MODAL_CLASS.module, className: MODAL_CLASS.className, confirm: true },
          { note: "PLUGIN_MODAL in TS: nothing sent" },
        ),
        tc(
          "wb_plugin",
          "run",
          { moduleName: UNLISTED_CLASS.module, className: UNLISTED_CLASS.className },
          { note: "NOT_ALLOWLISTED in TS: nothing sent" },
        ),
        tc(
          "wb_plugin",
          "run",
          { moduleName: "ScriptEditor", className: "RunCommandline" },
          { note: "INVALID_ARGUMENT: nothing sent" },
        ),
        tc(
          "wb_plugin",
          "describe",
          { moduleName: "ScriptEditor", className: "Configure" },
          { note: "INVALID_ARGUMENT: nothing sent" },
        ),
        tc("wb_plugin", "getSettings", {
          moduleName: "ScriptEditor",
          className: "SCR_DebugLinePlugin",
          limit: 200,
        }),
        tc("wb_plugin", "setSettings", {
          moduleName: "ScriptEditor",
          className: "SCR_DebugLinePlugin",
          name: "<a string [Attribute]>",
          value: "EMCP_W6_DRY",
        }),
        tc(
          "wb_plugin",
          "setSettings",
          {
            moduleName: "ScriptEditor",
            className: "SCR_DebugLinePlugin",
            name: "<the same>",
            value: "<the value it holds>",
            confirm: true,
          },
          {
            note: "NO_SETTER (DEC-069 OD-4); the value sent is the one read: a no-op if a setter existed",
          },
        ),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const ev: Raw = {};
        const modal = await ctx.tool("wb_plugin", {
          action: "run",
          moduleName: MODAL_CLASS.module,
          className: MODAL_CLASS.className,
          confirm: true,
        });
        const unlisted = await ctx.tool("wb_plugin", {
          action: "run",
          moduleName: UNLISTED_CLASS.module,
          className: UNLISTED_CLASS.className,
        });
        const rc = await ctx.tool("wb_plugin", {
          action: "run",
          moduleName: "ScriptEditor",
          className: "RunCommandline",
        });
        const cf = await ctx.tool("wb_plugin", {
          action: "describe",
          moduleName: "ScriptEditor",
          className: "Configure",
        });
        const method = await ctx.tool("wb_plugin", {
          action: "run",
          moduleName: "ScriptEditor",
          className: "SCR_DebugLinePlugin",
          method: "Run",
        });
        Object.assign(ev, {
          modal: brief(modal),
          unlisted: brief(unlisted),
          runCommandline: brief(rc),
          configure: brief(cf),
          methodKey: brief(method),
        });
        if (modal.code !== "PLUGIN_MODAL") fails.push(`modal class: ${why(modal)}`);
        if (unlisted.code !== "NOT_ALLOWLISTED") fails.push(`unlisted class: ${why(unlisted)}`);
        if (rc.code !== "INVALID_ARGUMENT") fails.push(`RunCommandline: ${why(rc)}`);
        if (cf.code !== "INVALID_ARGUMENT") fails.push(`Configure: ${why(cf)}`);
        if (method.code !== "INVALID_ARGUMENT") fails.push(`a method key: ${why(method)}`);
        const g = await ctx.tool("wb_plugin", {
          action: "getSettings",
          moduleName: "ScriptEditor",
          className: "SCR_DebugLinePlugin",
          limit: 200,
        });
        const rows = Array.isArray(rb(g).settings) ? (rb(g).settings as Raw[]) : [];
        const pick =
          rows.find((r) => S(r.type) === "string" && truthy(r.attribute)) ??
          rows.find((r) => S(r.type) === "string") ??
          null;
        ev.pick = pick;
        let o3: Raw = { getSettings: g.ok ? rows.length : S(g.code) };
        if (!pick) {
          o3 = { ...o3, note: "no string setting to write" };
        } else {
          const dry = await ctx.tool("wb_plugin", {
            action: "setSettings",
            moduleName: "ScriptEditor",
            className: "SCR_DebugLinePlugin",
            name: S(pick.name),
            value: "EMCP_W6_DRY",
          });
          const conf = await ctx.tool("wb_plugin", {
            action: "setSettings",
            moduleName: "ScriptEditor",
            className: "SCR_DebugLinePlugin",
            name: S(pick.name),
            value: S(pick.value),
            confirm: true,
          });
          ev.setDry = brief(dry);
          ev.setConfirm = brief(conf);
          o3 = {
            ...o3,
            dry: dry.ok ? { changed: rb(dry).changed, previous: rb(dry).previous } : S(dry.code),
            confirm: conf.ok ? "ok" : S(conf.code),
          };
          if (!dry.ok) fails.push(`setSettings dry run: ${why(dry)}`);
          else if (truthy(rb(dry).changed)) fails.push("the setSettings dry run answered changed");
          if (conf.ok)
            fails.push(
              "setSettings with confirm answered ok: a setter exists; OI-W6-1 (the owner) rules before any further write",
            );
          else if (conf.code !== "NO_SETTER") fails.push(`setSettings confirm: ${why(conf)}`);
        }
        const p3 = partial(
          "P-W6-03",
          o3,
          "the shipped handler refuses NO_SETTER; the compile half is the main session's, before the battery (W6.md step 6), and the live half is the owner's OI-W6-1",
        );
        return { ...verdictOf(fails, [p3], "every refusal came"), evidence: ev, probes: [p3] };
      },
    },
    {
      id: "w6-13-stats",
      block: "W6.1",
      title:
        "wb_world_tools stats on the W6 world against a wb_entity list walk, with three planted entities (P-W6-18)",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "stats counts the three PROP instances under PROP; scanned equals the list total; a grid of gridSize 4 answers a 4x4 grid; each create undone",
      kill_criterion: `P-W6-18: the counts differ: KILLED (stats is fixed before promotion); ${WINDOW_KILL}`,
      side_effects: ["three entities created in memory, then undone"],
      rollback: "Edit > Undo once per create",
      probes: ["P-W6-18"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        ...createPlan(3),
        tc("wb_world_tools", "stats", { limit: 200 }),
        tc("wb_world_tools", "stats", { gridSize: 4, limit: 200 }),
        tc("wb_entity", "list", { limit: 200 }),
        ...undoPlan(3),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        for (let i = 0; i < 3; i++) {
          const c = await create(ctx, `S${i}`, `${50 + 2 * i} 0 50`);
          if (!c.ref) fails.push(`create: ${why(c.r)}`);
        }
        const st = await ctx.tool("wb_world_tools", { action: "stats", limit: 200 });
        const grid = await ctx.tool("wb_world_tools", { action: "stats", gridSize: 4, limit: 200 });
        const list = await ctx.tool("wb_entity", { action: "list", limit: 200 });
        const prefabs = Array.isArray(rb(st).prefabs) ? (rb(st).prefabs as Raw[]) : [];
        const propCount = prefabs
          .filter((p) => guidOf(S(p.prefab)) === guidOf(PROP))
          .reduce((s, p) => s + Number(p.count ?? 0), 0);
        const g = Array.isArray(rb(grid).grid) ? (rb(grid).grid as unknown[][]) : [];
        const observed = {
          scanned: rb(st).scanned ?? null,
          total: rb(st).total ?? null,
          propCount,
          listTotal: rb(list).total ?? null,
          layers: rb(st).layers ?? null,
          grid: g.length ? `${g.length}x${(g[0] ?? []).length}` : "none",
        };
        Object.assign(ev, { stats: brief(st), grid: brief(grid), observed });
        if (!st.ok) fails.push(`stats: ${why(st)}`);
        const p18 = !st.ok
          ? partial("P-W6-18", observed, "stats did not answer")
          : propCount !== 3
            ? killed(
                "P-W6-18",
                observed,
                `stats counts ${propCount} PROP instances, 3 were created`,
              )
            : Number(rb(st).scanned) !== Number(rb(list).total)
              ? partial(
                  "P-W6-18",
                  observed,
                  "PROP counted right; scanned and the list total differ (the world entity or children)",
                )
              : settled("P-W6-18", observed, "per-prefab count and total agree with the list walk");
        await settle(ctx, ev, fails, before);
        return {
          ...verdictOf(fails, [p18], `PROP ${propCount}, scanned ${S(rb(st).scanned)}`),
          evidence: ev,
          probes: [p18],
        };
      },
    },

    // ── W6.2 world edits ──
    {
      id: "w6-20-export-import",
      block: "W6.2",
      title:
        "exportObjects of five planted entities, delete them, importObjects of the rows, exportObjects again (P-W6-07)",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "the second export's rows equal the first's after the float step (position 0.001 m, quaternion up to sign 1e-4, scale); wb_entity get coords within 0.001 m and angles within 0.01 degrees; every edit undone",
      kill_criterion: `P-W6-07: angles or positions differ beyond tolerance: KILLED (exportObjects is withdrawn; w6-21 is SKIPPED); ${WINDOW_KILL}`,
      side_effects: [
        "five entities created, one scaled, deleted and imported in memory; all undone",
      ],
      rollback: "Edit > Undo for import, delete, transform and each create",
      probes: ["P-W6-07"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        ...createPlan(5, { angles: "<p y r>" }),
        tc("wb_entity", "transform", { entity: "<ref>", scale: 1.5 }),
        tc("wb_entity", "get", { entity: "<ref>" }),
        tc("wb_world_tools", "exportObjects", { entities: ["<5 refs>"] }),
        tc("wb_entity", "delete", { entities: ["<5 refs>"] }),
        tc("wb_world_tools", "importObjects", { rows: ["<the exported rows>"] }),
        tc("wb_world_tools", "exportObjects", { entities: ["<5 new refs>"] }),
        ...undoPlan(8),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const angles = ["0 0 0", "0 30 0", "0 90 0", "10 45 0", "0 -120 5"];
        const refs: string[] = [];
        for (let i = 0; i < 5; i++) {
          const c = await create(ctx, `E${i}`, `${10 + 3 * i} 0 10`, { angles: angles[i] });
          if (c.ref) refs.push(c.ref);
          else fails.push(`create: ${why(c.r)}`);
        }
        let p7: ProbeResult;
        if (refs.length === 5) {
          const tr = await ctx.tool("wb_entity", {
            action: "transform",
            entity: refs[1],
            scale: 1.5,
          });
          ev.transform = brief(tr);
          const gets0: Raw[] = [];
          for (const r of refs) gets0.push(rb(await get(ctx, r)));
          const ex1 = await ctx.tool("wb_world_tools", { action: "exportObjects", entities: refs });
          const rows1 = strs(rb(ex1).rows);
          const del = await ctx.tool("wb_entity", { action: "delete", entities: refs });
          const imp = await ctx.tool("wb_world_tools", { action: "importObjects", rows: rows1 });
          const ids = strs(rb(imp).ids);
          const ex2 = ids.length
            ? await ctx.tool("wb_world_tools", { action: "exportObjects", entities: ids })
            : null;
          const rows2 = strs(rb(ex2).rows);
          const gets1: Raw[] = [];
          for (const r of ids) gets1.push(rb(await get(ctx, r)));
          Object.assign(ev, {
            export1: brief(ex1),
            delete: brief(del),
            import: brief(imp),
            export2: brief(ex2),
          });
          if (!ex1.ok || rows1.length !== 5)
            fails.push(`export: ${why(ex1)} (${rows1.length} rows)`);
          if (!imp.ok) fails.push(`import: ${why(imp)}`);
          const rowDiffs = rows1.map((r, i) =>
            rows2[i] ? sameImportRow(r, rows2[i]!) : { same: false, why: "missing" },
          );
          const posOk = gets0.every((g, i) => near(g.coords, gets1[i]?.coords, POS_TOL));
          const angOk = gets0.every((g, i) => anglesNear(g.angles, gets1[i]?.angles, ANGLE_TOL));
          const observed = {
            rows1,
            rows2,
            rowDiffs,
            coords: gets0.map((g, i) => [g.coords, gets1[i]?.coords ?? null]),
            angles: gets0.map((g, i) => [g.angles, gets1[i]?.angles ?? null]),
          };
          p7 =
            !imp.ok || ids.length !== 5
              ? partial("P-W6-07", observed, `import answered ${ids.length} ids`)
              : rowDiffs.every((d) => d.same) && posOk && angOk
                ? settled("P-W6-07", observed, "rows, coords and angles round-trip")
                : killed(
                    "P-W6-07",
                    observed,
                    `${
                      rowDiffs
                        .filter((d) => !d.same)
                        .map((d) => d.why)
                        .join("; ") || "rows equal"
                    }; coords ${posOk ? "ok" : "differ"}; angles ${angOk ? "ok" : "differ"}`,
                  );
        } else
          p7 = partial(
            "P-W6-07",
            { created: refs.length },
            "the five entities were not all created",
          );
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [p7], "round trip ok"), evidence: ev, probes: [p7] };
      },
    },
    {
      id: "w6-21-import-csv",
      block: "W6.2",
      title:
        "engine accept of the Object Import CSV codec: importObjects path = the planted CSV, exportObjects of the created ids against the CSV rows",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "three entities created from the CSV (the TS reads the file, the handler reads none); their exported rows equal the planted rows after the float step; undone",
      kill_criterion: `a created row differs or the import fails: FAIL; ${WINDOW_KILL}`,
      side_effects: ["three entities created in memory, undone"],
      rollback: "Edit > Undo (one per import call)",
      probes: [],
      dependsOn: ["P-W6-07"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc(
          "wb_world_tools",
          "importObjects",
          { path: CSV_REL },
          { note: "the TS reads the CSV and sends rows" },
        ),
        tc("wb_world_tools", "exportObjects", { entities: ["<the created ids>"] }),
        ...undoPlan(1),
      ],
      offlineCalls: () => [oc("object_csv", "read", { path: CSV_REL })],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const imp = await ctx.tool("wb_world_tools", { action: "importObjects", path: CSV_REL });
        const ids = strs(rb(imp).ids);
        ev.import = brief(imp);
        if (!imp.ok) fails.push(`import: ${why(imp)}`);
        else if (ids.length !== CSV_ROWS.length)
          fails.push(`${ids.length} created of ${CSV_ROWS.length}`);
        if (ids.length) {
          const ex = await ctx.tool("wb_world_tools", { action: "exportObjects", entities: ids });
          const rows = strs(rb(ex).rows);
          const want = csvRowsOf(parseCsv(textOrEmpty(ctx, CSV_REL)));
          const diffs = rows.map((r, i) => {
            const w = want[i];
            if (!w) return { same: false, why: "extra row" };
            return sameImportRow(
              r,
              `${w.prefab};${w.position.join(" ")};${w.quaternion.join(" ")};${w.scale}`,
            );
          });
          ev.export = brief(ex);
          ev.diffs = diffs;
          for (const d of diffs) if (!d.same) fails.push(`row: ${d.why}`);
        }
        await settle(ctx, ev, fails, before);
        return {
          ...verdictOf(fails, [], `${ids.length} entities from the CSV read back`),
          evidence: ev,
        };
      },
    },
    {
      id: "w6-22-reset-flags",
      block: "W6.2",
      title:
        "resetFlags: an entity's Flags set off the prefab's, reset, one undo restores (P-W6-15); the OD-6 refusal; allWorld on the tiny world",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "resetFlags (categories any: the GlassBeer prop is under no category base, fix-up 2) changes the entity; after reset Flags reads the prefab's value again and one undo brings back the set value (while wb_container get renders no FLAGS value, fix-up 2: the override isSetDirectly is cleared by the reset and back after the undo, PARTIAL); no refs, no selection and no allWorld answers INVALID_ARGUMENT; allWorld true answers walked >= 1 (scanned counts only prefab entities under a categories base; the tiny world holds none, so scanned 0 is right, fix-up 1); every edit undone",
      kill_criterion: `P-W6-15: one undo does not restore the set value: KILLED (resetFlags gains confirm and a before list); ${WINDOW_KILL}`,
      side_effects: ["one entity created, its Flags set, reset, all undone"],
      rollback: "Edit > Undo for each edit",
      probes: ["P-W6-15"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        ...createPlan(1),
        tc("wb_container", "get", { target: "entity:<ref>", path: "Flags" }),
        tc("wb_container", "set", {
          target: "entity:<ref>",
          path: "Flags",
          value: "<flags with one more bit>",
        }),
        tc("wb_world_tools", "resetFlags", { entities: ["<ref>"], categories: ["any"] }),
        tc("wb_container", "get", { target: "entity:<ref>", path: "Flags" }),
        ...undoPlan(1),
        tc("wb_container", "get", { target: "entity:<ref>", path: "Flags" }),
        tc("wb_view", "select", { mode: "clear" }),
        tc("wb_world_tools", "resetFlags", {}, { note: "INVALID_ARGUMENT (OD-6)" }),
        tc("wb_world_tools", "resetFlags", { allWorld: true }),
        ...undoPlan(2),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const c = await create(ctx, "F0", "40 0 40");
        let p15: ProbeResult = partial("P-W6-15", {}, "not reached");
        if (c.ref) {
          const target = `entity:${c.ref}`;
          // Fix-up 2: Flags is DataVarType FLAGS, which wb_container get does not render: its value
          // is "" while isSetDirectly and defaultValue are read (EMCP_WB_Container.c get sets value
          // only for IsScalar types; container artifact 2026-10-12T22-10-14-640Z: Flags type FLAGS,
          // value "", default "0x3 0"). Run 2's "" was that, not an instance without Flags. So the
          // prefab's value comes from defaultValue, and the override is followed by isSetDirectly.
          const flagsOf = async (): Promise<FlagsRead> =>
            flagsReadOf(
              rb(await ctx.tool("wb_container", { action: "get", target, path: "Flags" })),
            );
          const r0 = await flagsOf();
          const f0 = r0.value;
          const n0 = r0.int;
          if (n0 === null) {
            p15 = partial(
              "P-W6-15",
              { flags: r0 },
              "Flags reads neither as an integer nor from a hex defaultValue: no bit set",
            );
          } else {
            const setTo = String(n0 ^ 64);
            const s = await ctx.tool("wb_container", {
              action: "set",
              target,
              path: "Flags",
              value: setTo,
            });
            if (s.ok && !S(rb(s).undoName)) ctx.debt.undos++;
            const r1 = await flagsOf();
            // categories any (fix-up 2): the GlassBeer prop's top-most ancestor is no category
            // base, so the default filter would skip it (EMCP_WB_WorldTools.c ResetFlags); OD-6
            // refuses any only with allWorld, and this call names one entity.
            const rs = await ctx.tool("wb_world_tools", {
              action: "resetFlags",
              entities: [c.ref],
              categories: ["any"],
            });
            const r2 = await flagsOf();
            const u = rs.ok && S(rb(rs).undoName) ? await ctx.undo() : null;
            const r3 = await flagsOf();
            const observed = {
              prefab: r0,
              setTo,
              set: r1,
              afterReset: r2,
              afterUndo: r3,
              reset: rb(rs),
              undo: u,
            };
            ev.flags = observed;
            if (!s.ok) fails.push(`set Flags: ${why(s)}`);
            if (!rs.ok) fails.push(`resetFlags: ${why(rs)}`);
            p15 = flagsVerdict({
              setOk: s.ok,
              resetOk: rs.ok,
              changed: Number(rb(rs).changed ?? 0),
              prefab: f0,
              setTo,
              reads: [r1, r2, r3],
              observed,
            });
          }
        } else fails.push(`create: ${why(c.r)}`);
        await clearSelection(ctx);
        const none = await ctx.tool("wb_world_tools", { action: "resetFlags" });
        ev.noTarget = brief(none);
        if (none.code !== "INVALID_ARGUMENT") fails.push(`resetFlags with no target: ${why(none)}`);
        const all = await ctx.tool("wb_world_tools", { action: "resetFlags", allWorld: true });
        ev.allWorld = brief(all);
        if (!all.ok) fails.push(`allWorld: ${why(all)}`);
        // Fix-up 1: run 1 failed on scanned 0, but the tiny world holds a GlassBeer prop (top-most
        // ancestor Prefabs/Props/Core/DestructibleMultiPhase_Props_Base.et) and a GenericWorldEntity,
        // which no default category base names; walked is the proof the whole world was iterated.
        else if (Number(rb(all).walked ?? 0) < 1) fails.push("allWorld walked nothing");
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [p15], "resetFlags ok"), evidence: ev, probes: [p15] };
      },
    },
    {
      id: "w6-23-replace",
      block: "W6.2",
      title: "replaceEntities of a parent with two children, keepChildren; one undo (P-W6-17)",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "the new entity sits at the old transform with both children; one undo brings back the original parent with its two children; every edit undone",
      kill_criterion: `P-W6-17: children lost or the undo partial: KILLED (keepChildren is refused); ${WINDOW_KILL}`,
      side_effects: ["three entities created and one replaced in memory; undone"],
      rollback: "Edit > Undo for the replace and each create",
      probes: ["P-W6-17"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        ...createPlan(1),
        ...createPlan(2, { parent: "<parent ref>" }),
        tc("wb_world_tools", "replaceEntities", {
          pairs: [`<parent ref>=${ALT_PREFAB}`],
          keepChildren: true,
        }),
        tc("wb_entity", "children", { entity: "<new ref>" }),
        tc("wb_entity", "get", { entity: "<new ref>" }),
        ...undoPlan(1),
        tc("wb_entity", "children", { entity: "<parent ref>" }),
        ...undoPlan(3),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const p = await create(ctx, "P", "20 0 20");
        const kids = p.ref
          ? [
              await create(ctx, "C0", "21 0 20", { parent: p.ref }),
              await create(ctx, "C1", "22 0 20", { parent: p.ref }),
            ]
          : [];
        let p17: ProbeResult = partial("P-W6-17", {}, "the fixture was not created");
        if (p.ref && kids.every((k) => k.ref)) {
          const g0 = rb(await get(ctx, p.ref));
          const rep = await ctx.tool("wb_world_tools", {
            action: "replaceEntities",
            pairs: [`${p.ref}=${ALT_PREFAB}`],
            keepChildren: true,
          });
          const nid = strs(rb(rep).ids)[0] ?? "";
          const ch = nid ? await ctx.tool("wb_entity", { action: "children", entity: nid }) : null;
          const g1 = nid ? rb(await get(ctx, nid)) : {};
          let undo: UndoResult | null = null;
          if (rep.ok) {
            undo = await ctx.undo();
          }
          const back = await ctx.tool("wb_entity", { action: "children", entity: p.ref });
          const observed = {
            replace: rb(rep),
            newChildren: rb(ch).total ?? null,
            coords: [g0.coords ?? null, g1.coords ?? null],
            ancestor: g1.ancestor ?? null,
            undo,
            originalChildrenAfterUndo: back.ok ? (rb(back).total ?? null) : S(back.code),
          };
          ev.replace = observed;
          if (!rep.ok) fails.push(`replaceEntities: ${why(rep)}`);
          p17 = !rep.ok
            ? partial("P-W6-17", observed, "replaceEntities was refused")
            : Number(rb(ch).total ?? 0) !== 2 || !near(g0.coords, g1.coords, POS_TOL)
              ? killed(
                  "P-W6-17",
                  observed,
                  "the new entity lacks its two children or the transform",
                )
              : !back.ok || Number(rb(back).total ?? 0) !== 2
                ? killed(
                    "P-W6-17",
                    observed,
                    "one undo did not bring the parent and its children back",
                  )
                : settled("P-W6-17", observed, "children kept; one undo restored");
        } else fails.push("the parent or a child was not created");
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [p17], "replace ok"), evidence: ev, probes: [p17] };
      },
    },
    {
      id: "w6-24-shape-create",
      block: "W6.2",
      title:
        "wb_shape create of a two-point polyline, points read back; parallel answers GATED; points of a prop answers NOT_A_SHAPE (P-W6-16)",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "create answers an id and total 2; points reads the two positions back; parallel is GATED before sending (P-W6-16's own switch); NOT_A_SHAPE on a non-shape; undone",
      kill_criterion: `create does not write the points: P-W6-16 KILLED (parallel stays withdrawn); ${WINDOW_KILL}`,
      side_effects: ["one polyline and one prop created in memory, undone"],
      rollback: "Edit > Undo for each create",
      probes: ["P-W6-16"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_shape", "create", { points: ["30 0 30", "40 0 30"], name: `${NAME_PREFIX}Line` }),
        tc("wb_shape", "points", { entity: "<line ref>" }),
        tc(
          "wb_shape",
          "parallel",
          { entity: "<line ref>", offsets: ["5"] },
          { note: "GATED in TS: nothing sent" },
        ),
        ...createPlan(1),
        tc("wb_shape", "points", { entity: "<prop ref>" }),
        ...undoPlan(2),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const want = ["30 0 30", "40 0 30"];
        const cr = await ctx.tool("wb_shape", {
          action: "create",
          points: want,
          name: `${NAME_PREFIX}Line`,
        });
        const id = S(rb(cr).id);
        const pts = id ? await ctx.tool("wb_shape", { action: "points", entity: id }) : null;
        const got = strs(rb(pts).points);
        const par = await ctx.tool("wb_shape", {
          action: "parallel",
          entity: id || "name:W6_Line",
          offsets: ["5"],
        });
        const prop = await create(ctx, "NotShape", "45 0 30");
        const ns = prop.ref
          ? await ctx.tool("wb_shape", { action: "points", entity: prop.ref })
          : null;
        Object.assign(ev, {
          create: brief(cr),
          points: brief(pts),
          parallel: brief(par),
          notShape: brief(ns),
        });
        if (!cr.ok) fails.push(`create: ${why(cr)}`);
        if (par.code !== "GATED")
          fails.push(
            `parallel: ${why(par)} (GATED expected: a GATED action is sent only for its refusal)`,
          );
        if (ns && ns.code !== "NOT_A_SHAPE") fails.push(`points of a prop: ${why(ns)}`);
        const same = got.length === 2 && got.every((g, i) => near(g, want[i], 0.01));
        const observed = {
          created: id,
          total: rb(cr).total ?? null,
          points: got,
          parallel: S(par.code),
        };
        const p16 = !cr.ok
          ? partial("P-W6-16", observed, "create was refused")
          : !same
            ? killed("P-W6-16", observed, "the points read back differ from the points sent")
            : partial(
                "P-W6-16",
                observed,
                "create writes the points (read back equal); parallel is GATED until the main session opens it",
              );
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [p16], "create and points ok"), evidence: ev, probes: [p16] };
      },
    },
    {
      id: "w6-25-shape-area",
      block: "W6.2",
      title:
        "engine accept of the shape-area maths: wb_shape area circle and star at a given centre, points read back",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "each area answers one shape whose point count equals areaPointCount and whose x/z equal toWorld(areaPoints, centre) within 0.01 m; undone",
      kill_criterion: `a count or a point differs: FAIL; ${WINDOW_KILL}`,
      side_effects: ["two shapes created in memory, undone"],
      rollback: "Edit > Undo for each shape",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc(
          "wb_shape",
          "create",
          { points: ["<area outline>"] },
          { toolAction: "area", note: "TS area maths, then one create" },
        ),
        tc("wb_shape", "points", { entity: "<ref>", limit: 200 }),
        tc(
          "wb_shape",
          "create",
          { points: ["<star outline>"] },
          { toolAction: "area", note: "TS area maths, then one create" },
        ),
        tc("wb_shape", "points", { entity: "<ref>", limit: 200 }),
        ...undoPlan(2),
      ],
      offlineCalls: () => [oc("shape_area", "points", { shapes: ["circle", "star"] })],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const centre: Vec3 = [60, 0, 60];
        const specs: AreaSpec[] = [
          { shape: "circle", width: 20, segments: 12 },
          { shape: "star", width: 20, branches: 5, innerRatio: 0.5 },
        ];
        for (const spec of specs) {
          const a = await ctx.tool("wb_shape", {
            action: "area",
            ...spec,
            centre: centre.join(" "),
            snapToGround: false,
            closed: true,
          });
          const id = S(rb(a).id);
          const pts = id
            ? await ctx.tool("wb_shape", { action: "points", entity: id, limit: 200 })
            : null;
          const got = strs(rb(pts).points);
          const want = toWorld(areaPoints(spec), centre);
          const bad = want.filter((w, i) => {
            const g = vec3(got[i]);
            return !g || Math.abs(g[0] - w[0]) > 0.01 || Math.abs(g[2] - w[2]) > 0.01;
          }).length;
          ev[spec.shape] = { area: brief(a), points: got.slice(0, 40), want: want.length, bad };
          if (!a.ok) fails.push(`${spec.shape}: ${why(a)}`);
          else if (got.length !== areaPointCount(spec))
            fails.push(`${spec.shape}: ${got.length} points, ${areaPointCount(spec)} expected`);
          else if (bad) fails.push(`${spec.shape}: ${bad} point(s) off the outline`);
        }
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [], "area outlines read back"), evidence: ev };
      },
    },
    {
      id: "w6-26-shape-import",
      block: "W6.2",
      title:
        "engine accept of the shapefile reader: wb_shape import of the planted polyline and point shapefiles, each created part's points read back",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "the polyline file creates three shapes of 3, 2 and 3 points (read back with wb_shape points); the point file creates none and reports two points; every create undone",
      kill_criterion: `a part is missing or its point count differs: FAIL; ${WINDOW_KILL}`,
      side_effects: ["three shapes created in memory, undone"],
      rollback: "Edit > Undo once per created shape",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc(
          "wb_shape",
          "create",
          { points: ["<part>"] },
          { toolAction: "import", note: `TS reads ${SHP_LINES}; one create per part` },
        ),
        tc("wb_shape", "points", { entity: "<each created id>" }),
        tc(
          "wb_shape",
          "create",
          { points: [] },
          {
            toolAction: "import",
            note: `TS reads ${SHP_POINTS}; points are reported, none placed`,
          },
        ),
        ...undoPlan(3),
      ],
      offlineCalls: () => [
        oc("shapefile", "read", { path: SHP_LINES }),
        oc("shapefile", "read", { path: SHP_POINTS }),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const imp = await ctx.tool("wb_shape", {
          action: "import",
          path: SHP_LINES,
          offset: "100 0 100",
        });
        const created = Array.isArray(rb(imp).created) ? (rb(imp).created as Raw[]) : [];
        // Each part is its own create, one undo point each; the readback names no undoName.
        ctx.debt.undos += created.length;
        const parts: Raw[] = [];
        for (const c of created) {
          const p = await ctx.tool("wb_shape", { action: "points", entity: S(c.id) });
          parts.push({ id: c.id, points: strs(rb(p).points).length, said: c.points });
        }
        const pt = await ctx.tool("wb_shape", { action: "import", path: SHP_POINTS });
        const ptCreated = Array.isArray(rb(pt).created) ? (rb(pt).created as Raw[]) : [];
        ctx.debt.undos += ptCreated.length;
        Object.assign(ev, { lines: brief(imp), parts, points: brief(pt) });
        if (!imp.ok) fails.push(`import lines: ${why(imp)}`);
        const counts = parts.map((p) => Number(p.points));
        if (JSON.stringify(counts) !== JSON.stringify(LINE_PARTS))
          fails.push(
            `parts read back ${JSON.stringify(counts)}, planted ${JSON.stringify(LINE_PARTS)}`,
          );
        if (!pt.ok) fails.push(`import points: ${why(pt)}`);
        else if (ptCreated.length)
          fails.push(`the point file created ${ptCreated.length} shape(s)`);
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [], `${parts.length} parts read back`), evidence: ev };
      },
    },

    // ── W6.3 plugin runs ──
    {
      id: "w6-30-run-world",
      block: "W6.3",
      title:
        "wb_plugin run of the five World Editor classes: the precondition miss with nothing selected, then one entity selected: dry run, confirm (P-W6-05)",
      risk: "reversible",
      timeout_ms: 300_000,
      expected:
        "with nothing selected each answers PRECONDITION_UNMET (or NOT_ALLOWLISTED while the policy run list is empty: nothing sent); with one selected the dry run answers ok, ran false (AddPrefab: PRECONDITION_UNMET, no browser selection); the confirm answers GATED until the main session turns RunProven; a class that runs has its oracle read and is undone",
      kill_criterion: `P-W6-05: a run raises a window (STOP/HANDOFF with the class in the record) or has no read-back: KILLED for that class; ${WINDOW_KILL}`,
      side_effects: ["one entity created and selected; a class that runs edits in memory, undone"],
      rollback: "Edit > Undo for every edit; the selection cleared; the camera put back",
      probes: ["P-W6-05"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_view", "select", { mode: "clear" }),
        ...classesOf("WorldEditor").map((c) =>
          tc(
            "wb_plugin",
            "run",
            { moduleName: c.module, className: c.className },
            { note: "precondition miss" },
          ),
        ),
        ...createPlan(1),
        tc("wb_view", "select", { mode: "set", entities: ["<ref>"] }),
        tc("wb_view", "camera"),
        ...runPlan(classesOf("WorldEditor")),
        tc("wb_entity", "get", { entity: "<ref>" }),
        tc("wb_entity", "children", { entity: "<ref>" }),
        tc("wb_view", "setCamera", { coords: "<before>", look: "<before>" }),
        tc("wb_view", "select", { mode: "clear" }),
        ...undoPlan(1),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, ev, fails)))
          return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        await clearSelection(ctx);
        const miss: Raw = {};
        for (const c of classesOf("WorldEditor")) {
          const r = await ctx.tool("wb_plugin", {
            action: "run",
            moduleName: c.module,
            className: c.className,
          });
          miss[c.className] = answerOf(r);
          if (r.ok) fails.push(`${c.className}: preconditions met with nothing selected`);
          else if (!RUN_ANSWERS.has(S(r.code))) fails.push(`${c.className} miss: ${why(r)}`);
        }
        ev.preconditionMiss = miss;
        const e = await create(ctx, "Run0", "80 0 80");
        const verdicts: RunVerdict[] = [];
        if (e.ref) {
          await ctx.tool("wb_view", { action: "select", mode: "set", entities: [e.ref] });
          const cam = rb(await ctx.tool("wb_view", { action: "camera" }));
          ctx.debt.restorers.push({
            label: "camera",
            fn: () =>
              ctx.tool(
                "wb_view",
                { action: "setCamera", coords: S(cam.coords), look: S(cam.direction) || "0 0 1" },
                { restore: true },
              ),
          });
          const g0 = rb(await get(ctx, e.ref));
          for (const c of classesOf("WorldEditor")) {
            const out = await runClass(ctx, c, async () => {
              if (c.className === "CameraOrientationTool") {
                const cm = rb(await ctx.tool("wb_view", { action: "camera" }));
                return { ok: S(cm.coords) !== S(cam.coords), camera: cm.coords };
              }
              if (
                c.className === "SCR_WrapEntitiesPlugin" ||
                c.className === "SCR_AddPrefabToSelectedEntitiesPlugin"
              ) {
                // The run created entities: one undo point the readback does not name.
                ctx.debt.undos++;
                const total = await entityTotal(ctx);
                return {
                  ok: total !== null && before !== null && total > before + 1,
                  entities: total,
                };
              }
              ctx.debt.undos++;
              const g1 = rb(await get(ctx, e.ref));
              return {
                ok:
                  !near(g0.coords, g1.coords, POS_TOL) ||
                  !anglesNear(g0.angles, g1.angles, ANGLE_TOL),
                before: [g0.coords, g0.angles],
                after: [g1.coords, g1.angles],
              };
            });
            verdicts.push(out.verdict);
            ev[c.className] = out.evidence;
            fails.push(...out.fails);
            // Each class runs on the untouched entity: its effect is undone before the next.
            while (ctx.debt.undos > 1) {
              const u = await ctx.undo();
              if (!u.ok) {
                fails.push(`undo after ${c.className}: ${u.message}`);
                break;
              }
            }
          }
        } else fails.push(`create: ${why(e.r)}`);
        await clearSelection(ctx);
        const p5 = runProbe(verdicts);
        await settle(ctx, ev, fails, before);
        return {
          ...verdictOf(fails, [p5], `${verdicts.length} classes asked`),
          evidence: ev,
          probes: [p5],
        };
      },
    },
    {
      id: "w6-31-run-script",
      block: "W6.3",
      title:
        "engine accept of the plugin template (the planted WorkbenchPlugin template opened in the Script Editor, its attribute line read back); the two Script Editor classes: dry run, confirm (P-W6-05)",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "the template (never registered: a script .c is no registrable resource, fix-up 1) opens in the Script Editor and getLines shows its #ifdef WORKBENCH and [WorkbenchPluginAttribute( lines; each class's dry run answers ok; the confirm GATED; CopyClassAndMethod that runs leaves Class.Method() on the clipboard (saved as text or empty and put back, untouched when unchanged; a clipboard holding anything but plain text holds the confirm, fix-up 2); DebugLine that runs inserts one line, removed again, never saved",
      kill_criterion: `the template does not open or its lines differ from the file: FAIL; P-W6-05: a run with no read-back: KILLED; ${WINDOW_KILL}`,
      side_effects: [
        "the system clipboard, saved and put back when CopyClassAndMethod runs (only plain text or an empty clipboard; anything else holds the confirm)",
      ],
      rollback:
        "removeLine of an inserted line; the clipboard put back (its text, or emptied) and read back; nothing saved",
      probes: ["P-W6-05"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        // No register (fix-up 1): run 1 answered RegisterResourceFile false for this .c, and the
        // sandbox's 42 compiled Scripts/*.c carry no .meta; the Script Editor opens it by path.
        tc("wb_script_editor", "open", { path: TEMPLATE_OPEN }),
        tc("wb_script_editor", "getLines", { start: 0, limit: 200 }),
        ...runPlan(classesOf("ScriptEditor")),
        tc(
          "wb_script_editor",
          "removeLine",
          { line: "<the inserted line>" },
          { note: "only when DebugLine ran" },
        ),
      ],
      offlineCalls: () => [
        oc("script_create", "plugin", {
          parentClass: "WorkbenchPlugin",
          path: TEMPLATE_OPEN,
          readOnly: true,
        }),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        ensurePlanted(ctx);
        const o = await ctx.tool("wb_script_editor", { action: "open", path: TEMPLATE_OPEN });
        const lines = async () => {
          const r = await ctx.tool("wb_script_editor", {
            action: "getLines",
            start: 0,
            limit: 200,
          });
          return Array.isArray(rb(r).rows) ? (rb(r).rows as unknown[]).map(S) : [];
        };
        const rows0 = await lines();
        const disk = textOrEmpty(ctx, TEMPLATE_OPEN).split(/\r?\n/);
        ev.open = brief(o);
        ev.lines = rows0.length;
        if (!o.ok) fails.push(`open: ${why(o)}`);
        else {
          if (
            !rows0.some((l) => l.includes("#ifdef WORKBENCH")) ||
            !rows0.some((l) => l.includes("[WorkbenchPluginAttribute("))
          )
            fails.push("the opened template lacks its #ifdef or attribute line");
          const d = exactLineDiff(disk.join("\n"), rows0.join("\n"));
          if (d.removed.filter((l) => l.trim()).length || d.added.filter((l) => l.trim()).length)
            fails.push(
              `the editor's text differs from the file (${d.removed.length} removed, ${d.added.length} added)`,
            );
        }
        const verdicts: RunVerdict[] = [];
        if (o.ok) {
          for (const c of classesOf("ScriptEditor")) {
            let hold: string | null = null;
            if (c.className === "SCR_CopyClassAndMethodPlugin") {
              // Fix-up 2: run 2 restored "" with Set-Clipboard, which calls Clipboard.SetText("")
              // and throws (SetText checks String.IsNullOrEmpty first; IL read this session). The
              // snapshot keeps empty apart from text and from data that is not plain text.
              const saved = await ctx.deps.clipboardRead();
              // The owner's text is never recorded: its state, formats and length only.
              ev.clipboardSaved = {
                state: saved.state,
                formats: saved.formats,
                chars: saved.text.length,
                error: saved.error,
              };
              if (saved.state === "text" || saved.state === "empty")
                ctx.debt.restorers.push({
                  label: "clipboard",
                  fn: () => restoreClipboard(ctx.deps, saved),
                });
              else
                hold =
                  saved.state === "other"
                    ? `the clipboard holds ${saved.formats.join(", ")}, which the step cannot save and put back; empty it or copy plain text to run this class`
                    : `the clipboard read failed (${saved.error ?? "no error text"}), so it cannot be put back`;
            }
            const out = await runClass(
              ctx,
              c,
              async () => {
                if (c.className === "SCR_CopyClassAndMethodPlugin") {
                  const clip = (await ctx.deps.clipboardRead()).text;
                  return {
                    ok: /^\w+\.\w+\(\)$/.test(clip.trim()),
                    clipboard: clip.trim().slice(0, 120),
                  };
                }
                const now = await lines();
                const d = exactLineDiff(rows0.join("\n"), now.join("\n"));
                const at = now.findIndex((l, i) => l !== rows0[i]);
                if (d.added.length === 1 && at >= 0) {
                  const rm = await ctx.tool(
                    "wb_script_editor",
                    { action: "removeLine", line: at },
                    { restore: true },
                  );
                  return { ok: rm.ok, inserted: d.added[0], removed: rm.ok };
                }
                return { ok: false, diff: d };
              },
              hold,
            );
            verdicts.push(out.verdict);
            ev[c.className] = out.evidence;
            fails.push(...out.fails);
          }
        }
        const p5 = runProbe(verdicts);
        await settle(ctx, ev, fails, null);
        return {
          ...verdictOf(fails, [p5], "template opened; Script Editor classes asked"),
          evidence: ev,
          probes: [p5],
        };
      },
    },
    {
      id: "w6-32-run-loc",
      block: "W6.3",
      title:
        "wb_plugin run of the three Localization Editor classes: dry run, confirm only when met (P-W6-05)",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "W6 opens no string table (a table is made by hand, W3 OD-1): each dry run answers PRECONDITION_UNMET or NOT_ALLOWLISTED; a dry run that is met is confirmed and answers GATED",
      kill_criterion: `P-W6-05: a run with no read-back: KILLED; ${WINDOW_KILL}`,
      side_effects: ["the Localization Editor may open (GetModule opens a closed module)"],
      rollback: "none (nothing runs; a table edit would need wb_localization get and undo)",
      probes: ["P-W6-05"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [tc("wb_localization", "status"), ...runPlan(classesOf("LocalizationEditor"))],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        const st = await ctx.tool("wb_localization", { action: "status" });
        ev.status = brief(st);
        const verdicts: RunVerdict[] = [];
        for (const c of classesOf("LocalizationEditor")) {
          // A table opened before W6 is not W6's: a class whose dry run is met is confirmed only
          // into its GATED refusal; one that would run is never confirmed over a foreign table.
          const out = await runClass(ctx, c, async () => ({
            ok: false,
            note: "a Localization Editor run on a table W6 did not open has no W6 oracle",
          }));
          verdicts.push(out.verdict);
          ev[c.className] = out.evidence;
          fails.push(...out.fails);
        }
        const p5 = runProbe(verdicts);
        return {
          ...verdictOf(fails, [p5], "Localization classes asked"),
          evidence: ev,
          probes: [p5],
        };
      },
    },
    {
      id: "w6-33-run-rm",
      block: "W6.3",
      title:
        "wb_plugin run of the three Resource Manager classes: dry run, confirm only when met (P-W6-05)",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "CheckRuinModelsAndUsage's dry run answers ok (the module answers) and its confirm GATED; the two Reforger settings classes answer PRECONDITION_UNMET (an unsaved-document check is unproven), never a document switch",
      kill_criterion: `P-W6-05: a run with no read-back: KILLED; ${WINDOW_KILL}`,
      side_effects: ["the Resource Manager may open; a CheckRuin run prints log lines only"],
      rollback: "none",
      probes: ["P-W6-05"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => runPlan(classesOf("ResourceManager")),
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        const verdicts: RunVerdict[] = [];
        for (const c of classesOf("ResourceManager")) {
          const out = await runClass(ctx, c, async () => ({
            ok: c.className === "SCR_CheckRuinModelsAndUsagePlugin",
            note: "log lines (logs_tail after the sitting)",
          }));
          verdicts.push(out.verdict);
          ev[c.className] = out.evidence;
          fails.push(...out.fails);
          if (c.className !== "SCR_CheckRuinModelsAndUsagePlugin" && out.verdict.dry === "ok")
            fails.push(`${c.className}: the dry run met preconditions the handler always refuses`);
        }
        const p5 = runProbe(verdicts);
        return {
          ...verdictOf(fails, [p5], "Resource Manager classes asked"),
          evidence: ev,
          probes: [p5],
        };
      },
    },

    // ── W6.4 terrain (vanilla world, in memory, never saved) ──
    {
      id: "w6-40-terrain-open",
      block: "W6.4",
      title: `open ${VANILLA_WORLD} (vanilla, never saved) and read its terrain bounds: the spot every terrain step builds around`,
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected:
        "the world opens in edit mode with terrain; the spot (bounds centre) is on the terrain",
      kill_criterion: `no terrain or the spot is off it: FAIL (the terrain steps then FAIL on their own ensureTerrain); ${WINDOW_KILL}`,
      side_effects: [
        "the World Editor loads another world (the W6 world holds no edit: every W6.2 edit was undone)",
      ],
      rollback: "none (opening writes nothing)",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [...terrainPlan(), tc("wb_terrain", "heights", { points: ["<spot>"] })],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        const spot = await ensureTerrain(ctx, ev, fails);
        if (spot) {
          const [y] = await heights(ctx, [[spot.x, spot.z]]);
          ev.spot = { ...spot, y };
          if (y === null || y === undefined)
            fails.push(`the spot ${spot.x} ${spot.z} is off the terrain`);
        }
        return {
          ...verdictOf(fails, [], `terrain spot ${JSON.stringify(ev.spot ?? null)}`),
          evidence: ev,
        };
      },
    },
    {
      id: "w6-41-snap",
      block: "W6.4",
      title:
        "snapToTerrain against the vanilla SCR_SnapAndOrientToTerrainPlugin: two entities 3 m above the terrain (P-W6-13)",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "snapToTerrain moves B to the terrain (y within 0.05 m of the height); the vanilla plugin on A answers GATED until RunProven, else both transforms agree within 0.001",
      kill_criterion: `P-W6-13: A and B differ after both ran: KILLED (snapToTerrain withdrawn); ${WINDOW_KILL}`,
      side_effects: [
        "two entities created on the vanilla world in memory, moved, all undone; never saved",
      ],
      rollback: "Edit > Undo for each edit; the selection cleared",
      probes: ["P-W6-13"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_terrain", "heights", { points: ["<spot>"] }),
        ...createPlan(2, { angles: "0 30 0" }),
        tc("wb_view", "select", { mode: "set", entities: ["<A>"] }),
        ...runPlan([RUN_CLASSES[0]!]),
        tc("wb_world_tools", "snapToTerrain", { entities: ["<B>"] }),
        tc("wb_entity", "get", { entity: "<A>" }),
        tc("wb_entity", "get", { entity: "<B>" }),
        tc("wb_view", "select", { mode: "clear" }),
        ...undoPlan(4),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        const spot = await ensureTerrain(ctx, ev, fails);
        if (!spot) return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const [y] = await heights(ctx, [[spot.x, spot.z]]);
        let p13: ProbeResult = partial("P-W6-13", { y }, "the spot is off the terrain");
        if (typeof y === "number") {
          const at = `${spot.x} ${y + 3} ${spot.z}`;
          const a = await create(ctx, "SnapA", at, { angles: "0 30 0" });
          const b = await create(ctx, "SnapB", at, { angles: "0 30 0" });
          if (a.ref && b.ref) {
            await ctx.tool("wb_view", { action: "select", mode: "set", entities: [a.ref] });
            const out = await runClass(ctx, RUN_CLASSES[0]!, async () => {
              ctx.debt.undos++;
              return { ok: true };
            });
            await clearSelection(ctx);
            const s = await ctx.tool("wb_world_tools", {
              action: "snapToTerrain",
              entities: [b.ref],
            });
            const ga = rb(await get(ctx, a.ref));
            const gb = rb(await get(ctx, b.ref));
            const yb = vec3(gb.coords)?.[1] ?? null;
            const observed = {
              terrainY: y,
              snap: rb(s),
              A: [ga.coords, ga.angles],
              B: [gb.coords, gb.angles],
              vanilla: out.verdict,
            };
            Object.assign(ev, { plugin: out.evidence, snap: brief(s), observed });
            fails.push(...out.fails);
            if (!s.ok) fails.push(`snapToTerrain: ${why(s)}`);
            else if (yb === null || Math.abs(yb - y) > GROUND_TOL)
              fails.push(`B at y ${String(yb)}, terrain ${y}`);
            p13 = !s.ok
              ? partial("P-W6-13", observed, "snapToTerrain was refused")
              : !out.verdict.ran
                ? partial(
                    "P-W6-13",
                    observed,
                    `B sits on the terrain; the vanilla plugin answered ${out.verdict.confirm} (no comparison)`,
                  )
                : near(ga.coords, gb.coords, POS_TOL) && anglesNear(ga.angles, gb.angles, ANGLE_TOL)
                  ? settled("P-W6-13", observed, "snapToTerrain equals the vanilla plugin")
                  : killed("P-W6-13", observed, "the two transforms differ");
          } else fails.push("an entity was not created");
        }
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [p13], "snap ok"), evidence: ev, probes: [p13] };
      },
    },
    {
      id: "w6-42-floaters",
      block: "W6.4",
      title:
        "floaters on eight planted entities: three 2 m up, two 1 m down, three on the ground (P-W6-14)",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "five hits, positive gaps for the three up and negative for the two down; the three grounded absent; undone",
      kill_criterion: `P-W6-14: a miss or a false hit: KILLED (the Floaters rows re-point W8); ${WINDOW_KILL}`,
      side_effects: ["eight entities created on the vanilla world in memory, undone; never saved"],
      rollback: "Edit > Undo for each create",
      probes: ["P-W6-14"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_terrain", "heights", { points: ["<8 points>"] }),
        ...createPlan(8),
        tc("wb_world_tools", "floaters", { entities: ["<8 refs>"], belowTerrain: true }),
        ...undoPlan(8),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        const spot = await ensureTerrain(ctx, ev, fails);
        if (!spot) return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const pts: Array<[number, number]> = Array.from({ length: 8 }, (_, i) => [
          spot.x + 4 * i,
          spot.z + 6,
        ]);
        const ys = await heights(ctx, pts);
        const lift = [2, 2, 2, -1, -1, 0, 0, 0];
        const refs: string[] = [];
        if (ys.every((y) => typeof y === "number")) {
          for (let i = 0; i < 8; i++) {
            const c = await create(
              ctx,
              `Fl${i}`,
              `${pts[i]![0]} ${(ys[i] as number) + lift[i]!} ${pts[i]![1]}`,
            );
            if (c.ref) refs.push(c.ref);
            else fails.push(`create: ${why(c.r)}`);
          }
        } else fails.push("a planted point is off the terrain");
        let p14: ProbeResult = partial(
          "P-W6-14",
          { heights: ys },
          "the eight entities were not planted",
        );
        if (refs.length === 8) {
          const f = await ctx.tool("wb_world_tools", {
            action: "floaters",
            entities: refs,
            belowTerrain: true,
          });
          const hits = Array.isArray(rb(f).hits) ? (rb(f).hits as Raw[]) : [];
          const byRef = new Map(hits.map((h) => [refKey(S(h.id)), Number(h.gap)]));
          const want = refs.map((r, i) => ({ r, sign: Math.sign(lift[i]!) }));
          const wrong = want.filter(({ r, sign }) => {
            const g = byRef.get(refKey(r));
            return sign === 0 ? g !== undefined : g === undefined || Math.sign(g) !== sign;
          });
          const observed = { hits, planted: want.map((w) => ({ ref: w.r, sign: w.sign })) };
          ev.floaters = brief(f);
          if (!f.ok) fails.push(`floaters: ${why(f)}`);
          p14 = !f.ok
            ? partial("P-W6-14", observed, "floaters was refused")
            : wrong.length
              ? killed("P-W6-14", observed, `${wrong.length} planted entit(ies) misjudged`)
              : settled(
                  "P-W6-14",
                  observed,
                  "five hits with the right signs, the grounded three absent",
                );
        }
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [p14], "floaters ok"), evidence: ev, probes: [p14] };
      },
    },
    {
      id: "w6-43-goto",
      block: "W6.4",
      title:
        "engine accept of the coords parser: wb_world_tools goToCoords with the coords, link, web-link and map-digit forms, the camera read back, then put back",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "after each text wb_view camera reads the parsed position (map digits: x and z as the vanilla rule, y the terrain plus the lift); the camera is put back at the end",
      kill_criterion: `a position read back differs by more than 0.01 m: FAIL; ${WINDOW_KILL}`,
      side_effects: ["the camera moves (view state, no undo point)"],
      rollback: "wb_view setCamera to the position and direction read first",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc("wb_view", "camera"),
        tc(
          "wb_world_tools",
          "setCamera",
          { coords: "<parsed>", look: "<parsed>" },
          {
            toolAction: "goToCoords",
            target: "EMCP_WB_View",
            note: "TS parse of each form; the camera set through wb_view",
          },
        ),
        tc(
          "wb_world_tools",
          "heights",
          { points: ["<map digits x z>"] },
          {
            toolAction: "goToCoords",
            target: "EMCP_WB_Terrain",
            note: "map digits only: the terrain height under the point",
          },
        ),
        tc("wb_view", "camera"),
        tc("wb_view", "setCamera", { coords: "<before>", look: "<before>" }),
      ],
      offlineCalls: () => [oc("coords", "parse", { forms: ["coords", "link", "map"] })],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        const spot = await ensureTerrain(ctx, ev, fails);
        if (!spot) return { ...verdictOf(fails, [], ""), evidence: ev };
        const cam0 = rb(await ctx.tool("wb_view", { action: "camera" }));
        ctx.debt.restorers.push({
          label: "camera",
          fn: () =>
            ctx.tool(
              "wb_view",
              { action: "setCamera", coords: S(cam0.coords), look: S(cam0.direction) || "0 0 1" },
              { restore: true },
            ),
        });
        const pos = `${spot.x},120,${spot.z}`;
        const half = (n: number) => String(Math.floor(n / 100)).padStart(3, "0");
        const texts = [
          `${pos};-30,45,0`,
          `enfusion://WorldEditor/${VANILLA_WORLD};${pos};-30,45,0`,
          `https://enfusionengine.com/api/redirect?to=enfusion://WorldEditor/${VANILLA_WORLD};${pos}`,
          `${half(spot.x)} ${half(spot.z)}`,
        ];
        const out: Raw[] = [];
        for (const t of texts) {
          const parsed = parseCoordsText(t);
          const g = await ctx.tool("wb_world_tools", { action: "goToCoords", text: t });
          const cam = rb(await ctx.tool("wb_view", { action: "camera" }));
          const at = vec3(cam.coords);
          let ok =
            g.ok &&
            !!at &&
            Math.abs(at[0] - parsed.position[0]) <= 0.01 &&
            Math.abs(at[2] - parsed.position[2]) <= 0.01;
          if (ok && parsed.form !== "map") ok = Math.abs(at![1] - parsed.position[1]) <= 0.01;
          out.push({
            text: t,
            form: parsed.form,
            want: parsed.position,
            camera: cam.coords,
            ok,
            answer: brief(g),
          });
          if (!ok)
            fails.push(
              `${parsed.form} '${t}': camera ${S(cam.coords)}, parsed ${parsed.position.join(" ")} (${g.ok ? "ok" : why(g)})`,
            );
        }
        ev.forms = out;
        await settle(ctx, ev, fails, null);
        return { ...verdictOf(fails, [], `${out.length} forms read back`), evidence: ev };
      },
    },
    {
      id: "w6-44-area-ground",
      block: "W6.4",
      title:
        "wb_shape area with snapToGround on the terrain: the outline's y read back against wb_terrain heights",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "a circle of 12 points whose y each equals the terrain height within 0.05 m; undone",
      kill_criterion: `a point off the ground: FAIL; ${WINDOW_KILL}`,
      side_effects: ["one shape created on the vanilla world in memory, undone; never saved"],
      rollback: "Edit > Undo",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_terrain", "heights", { points: ["<outline>"] }, { toolAction: "area" }),
        tc("wb_shape", "create", { points: ["<outline on the ground>"] }, { toolAction: "area" }),
        tc("wb_shape", "points", { entity: "<ref>", limit: 200 }),
        tc("wb_terrain", "heights", { points: ["<the points read>"] }),
        ...undoPlan(1),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const fails: string[] = [];
        const spot = await ensureTerrain(ctx, ev, fails);
        if (!spot) return { ...verdictOf(fails, [], ""), evidence: ev };
        const before = await entityTotal(ctx);
        const a = await ctx.tool("wb_shape", {
          action: "area",
          shape: "circle",
          width: 10,
          segments: 12,
          centre: `${spot.x} 0 ${spot.z + 20}`,
          snapToGround: true,
          closed: true,
        });
        const id = S(rb(a).id);
        const pts = id
          ? strs(
              rb(await ctx.tool("wb_shape", { action: "points", entity: id, limit: 200 })).points,
            )
          : [];
        const vs = pts.map(vec3).filter((v): v is [number, number, number] => v !== null);
        const hs = vs.length
          ? await heights(
              ctx,
              vs.map((v) => [v[0], v[2]]),
            )
          : [];
        const off = vs.filter(
          (v, i) => typeof hs[i] !== "number" || Math.abs(v[1] - (hs[i] as number)) > GROUND_TOL,
        );
        Object.assign(ev, { area: brief(a), points: pts, heights: hs, off: off.length });
        if (!a.ok) fails.push(`area: ${why(a)}`);
        else if (vs.length !== 12) fails.push(`${vs.length} points, 12 expected`);
        else if (off.length) fails.push(`${off.length} point(s) off the ground`);
        await settle(ctx, ev, fails, before);
        return { ...verdictOf(fails, [], "outline on the ground"), evidence: ev };
      },
    },

    // ── W6.5 Bohemia handlers ──
    {
      id: "w6-50-bi-layers",
      block: "W6.5",
      title:
        "wb_bi call LayerPresets, then GetLayerInteraction of its first preset, timed (P-W6-11)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "NOT_ALLOWLISTED with nothing sent while VERIFIED_READ lacks them (the integrator's probe build adds them); once listed: answers under 5 s with preset names",
      kill_criterion:
        "over 30 s, an error or a modal: KILLED (both stay out of VERIFIED_READ; 2 rows not-automatable)",
      side_effects: [],
      rollback: "none",
      probes: ["P-W6-11"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_bi", "call", { handler: "LayerPresets", request: { Input: "" } }),
        tc("wb_bi", "call", {
          handler: "GetLayerInteraction",
          request: { layer: "<first preset>" },
        }),
      ],
      run: async (ctx) => {
        const ev: Raw = {};
        const t0 = ctx.deps.now();
        const lp = await ctx.tool("wb_bi", {
          action: "call",
          handler: "LayerPresets",
          request: { Input: "" },
        });
        const ms1 = ctx.deps.now() - t0;
        ev.layerPresets = { ...brief(lp), ms: ms1 };
        let ms2: number | null = null;
        let gi: ToolResponse | null = null;
        if (lp.ok) {
          const r = rb(lp);
          const first = strs(r.presets)[0] ?? strs(r.Output)[0] ?? strs(r.layers)[0] ?? "";
          const t1 = ctx.deps.now();
          gi = await ctx.tool("wb_bi", {
            action: "call",
            handler: "GetLayerInteraction",
            request: { layer: first },
          });
          ms2 = ctx.deps.now() - t1;
          ev.getLayerInteraction = { ...brief(gi), ms: ms2, layer: first };
        }
        const observed = {
          layerPresets: lp.ok ? "ok" : S(lp.code),
          ms1,
          getLayerInteraction: gi ? (gi.ok ? "ok" : S(gi.code)) : null,
          ms2,
        };
        const p11 =
          lp.code === "NOT_ALLOWLISTED"
            ? partial(
                "P-W6-11",
                observed,
                "not in VERIFIED_READ: nothing sent (the integrator's probe build adds both)",
              )
            : !lp.ok || ms1 > 30_000 || (gi && (!gi.ok || (ms2 ?? 0) > 30_000))
              ? killed("P-W6-11", observed, "an error or over 30 s")
              : ms1 <= 5_000 && (ms2 ?? 0) <= 5_000
                ? settled("P-W6-11", observed, "both answer under 5 s")
                : partial("P-W6-11", observed, "answers between 5 and 30 s");
        return {
          ...verdictOf([], [p11], `LayerPresets ${observed.layerPresets} in ${ms1} ms`),
          evidence: ev,
          probes: [p11],
        };
      },
    },

    // ── W6.8 hand (one block, last) ──
    {
      id: HAND_STEP,
      block: "W6.8",
      title:
        "P-W6-06 by hand: the hand opens Plugins > Find Linked Resources (SCR_FindResourcesPlugin, E03 modal) in the Resource Manager; the battery's watchdog sees the dialog; the hand presses Cancel; wb_ping answers",
      risk: "reversible",
      timeout_ms: 2 * HAND_WAIT_MS + 60_000,
      expected:
        "a new dialog-like window of the Workbench pid within 5 s of the hand's click; gone after the hand's Cancel; Ping answers (no NET call lost, the U6 reset at about 120 s not reached)",
      kill_criterion:
        "the dialog not seen or Cancel does not close it: KILLED (the owner closes it, OI-W6-3; the W8 GUI path for the modal classes stays blocked); a dialog left after the answer: HANDOFF",
      side_effects: ["the hand opens and cancels one plugin dialog; nothing is chosen in it"],
      rollback: "the hand presses Cancel (never OK, never a commit button)",
      probes: ["P-W6-06"],
      writes: [],
      hand: true,
      plan: () => [{ kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction],
      run: async (ctx) => {
        const ev: Raw = {};
        const pid = ctx.deps.recordedPid() ?? 0;
        const baseline = new Set((await ctx.deps.windows()).map((w) => w.hwnd));
        let seen: WindowInfo | null = null;
        let seenAt: number | null = null;
        const watch = async () => {
          if (seen) return;
          const ws = await ctx.deps.windows();
          const d = ws.find((w) => w.pid === pid && !baseline.has(w.hwnd) && isDialogWindow(w));
          if (d) {
            seen = d;
            seenAt = ctx.deps.now();
          }
        };
        const opened = await awaitHand(
          ctx,
          `${HAND_STEP}-open`,
          `In the Workbench main window (Resource Manager, title "Enfusion Workbench"), open the menu Plugins and choose "Find Linked Resources" ONCE. A dialog opens: choose nothing in it, leave it open. Then write {"opened": true, "clickedAt": "<ISO time of your click>"} (or {"opened": false, "why": "<what you saw>"})`,
          watch,
        );
        ev.openAnswer = opened;
        if (!opened || opened.opened !== true) {
          ev.dialogSeen = seen ? { title: (seen as WindowInfo).title } : null;
          if (seen)
            throw new StopBattery(
              "handoff",
              `a dialog "${(seen as WindowInfo).title}" is up and the hand gave no answer: the hand presses Cancel`,
              ev,
            );
          return {
            status: "NOT-RUN",
            detail: opened
              ? `the hand did not open it: ${S(opened.why)}`
              : "no hand answer within the wait",
            evidence: ev,
          };
        }
        for (let i = 0; i < 10 && !seen; i++) {
          await watch();
          if (!seen) await ctx.deps.sleep(TIMEOUTS.windowPoll);
        }
        const clicked = Date.parse(S(opened.clickedAt));
        const latency =
          seenAt !== null && Number.isFinite(clicked) ? (seenAt as number) - clicked : null;
        ev.dialog = seen
          ? {
              title: (seen as WindowInfo).title,
              className: (seen as WindowInfo).className,
              latencyMs: latency,
            }
          : null;
        const cancelled = await awaitHand(
          ctx,
          `${HAND_STEP}-cancel`,
          `Press Cancel in the "Find Linked Resources" dialog (never OK, never any other button). Then write {"cancelled": true}`,
        );
        ev.cancelAnswer = cancelled;
        const left = (await ctx.deps.windows()).filter(
          (w) => w.pid === pid && !baseline.has(w.hwnd) && isDialogWindow(w),
        );
        if (left.length)
          throw new StopBattery(
            "handoff",
            `the dialog "${left[0]!.title}" is still open after the Cancel request: the hand presses Cancel`,
            ev,
          );
        const t0 = ctx.deps.now();
        const ping = await ctx.deps.ping();
        const pingMs = ctx.deps.now() - t0;
        const observed = { dialog: ev.dialog, pingMs, ping: !!ping, closed: left.length === 0 };
        const p6 = !seen
          ? killed("P-W6-06", observed, "the watchdog did not see the dialog")
          : !ping
            ? killed("P-W6-06", observed, "Ping did not answer after the Cancel")
            : latency !== null && latency > MODAL_DETECT_MS
              ? partial(
                  "P-W6-06",
                  observed,
                  `seen ${latency} ms after the click (over ${MODAL_DETECT_MS} ms)`,
                )
              : settled("P-W6-06", observed, "seen, cancelled by hand, the queue answers");
        return {
          ...verdictOf([], [p6], `dialog ${seen ? "seen" : "not seen"}; ping ${pingMs} ms`),
          evidence: ev,
          probes: [p6],
        };
      },
    },

    // ── W6.9 close ──
    {
      id: NETZERO_STEP,
      block: "W6.9",
      title: "net-zero: the sandbox outside _throwaway/W6/ hashed against the battery's snapshot",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "no file outside _throwaway/W6/ changed (resourceDatabase.rdb recorded, not failed)",
      kill_criterion: "a file outside _throwaway/W6/ changed or the snapshot is missing: FAIL",
      side_effects: [],
      rollback: "none (reads)",
      probes: [],
      writes: [],
      plan: () => [],
      run: async (ctx) => {
        const d = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
        if (!d)
          return {
            status: "FAIL",
            detail: `no ${BATTERY_SNAPSHOT_FILE} in the sitting`,
            evidence: {},
          };
        const real = d.changed.filter((f) => !NETZERO_TOLERATED.includes(f));
        const evidence = {
          snapshot: { takenBy: d.takenBy, takenAt: d.takenAt },
          changed: d.changed,
        };
        return real.length
          ? { status: "FAIL", detail: `changed outside ${W6_ROOT}/: ${real.join(", ")}`, evidence }
          : {
              status: "PASS",
              detail: `net-zero outside ${W6_ROOT}/ (${d.changed.length} tolerated)`,
              evidence,
            };
      },
    },
    closableStep(),
  ];
}

/** The text of a sandbox file, "" when absent. */
function textOrEmpty(ctx: StepContext, rel: string): string {
  const p = abs(ctx.opts.sandboxDir, rel);
  return ctx.deps.exists(p) ? ctx.deps.readBytes(p).toString("utf-8") : "";
}

/**
 * The last step, also run after a stop: leave Workbench closable by WM_CLOSE. The open world (if
 * any) is replaced by a fresh load of a world that is not open now (the W6 world, else vanilla
 * EmptyArland), so no in-memory edit remains. Nothing is saved.
 */
export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W6.9",
    title:
      "leave Workbench closable: the open world replaced by a fresh load (the W6 world, else vanilla EmptyArland); never save",
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
    plan: () => [tc("wb_world", "state"), ...openPlan(WORLD)],
    run: async (ctx) => leaveClosable(ctx),
  };
}

export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateBefore = brief(st0);
  const open = S(rb(st0).worldPath).toLowerCase();
  if (!st0.ok || open === "")
    return {
      status: "PASS",
      detail: "no world is open: nothing in the World Editor to leave",
      evidence,
    };
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
    `${SESSION}: Plugins and tools battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
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
      "Generated by `tests/live/w6.live.ts --emit-queue` from its step table; tests/live-harness/w6-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W6 is not in PROBE_MUT_SESSIONS and sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w6-spec.md 2, 3, 6",
      "DEC-053",
      "DEC-058",
      "DEC-061",
      "DEC-069",
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
  deps: Pick<W6Deps, "exists" | "readBytes">,
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
async function cleanupAfterStop(ctx: StepContext, deps: W6Deps): Promise<Raw> {
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
 * ("No" / "Don't Save" on a save prompt; "Cancel" on a plugin dialog: never Save, never OK) and
 * the resume.
 */
export function handAnswer(
  message: string,
  stepId: string,
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1]! : "";
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt
    ? "No"
    : stepId === HAND_STEP
      ? "Cancel"
      : "none planned: record the title and text; never Save";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `hand: the engine's save prompt "${title}" ("Do you want to save changes?"): press No / Don't Save (never Save, never Yes, never Cancel), then resume ${resume}`
    : `hand: window "${title}": ${answer}; then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
}

function makeCtx(
  deps: W6Deps,
  opts: W6Options,
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
      if (r.ok && !o.restore && (S(rb(r).undoName) || UNDO_EDITS.has(`${name}.${S(args.action)}`)))
        debt.undos++;
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
  deps: W6Deps,
  opts: W6Options,
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

/**
 * A hand step: refused over a dialog already up, then run with no window poll (the dialog is
 * what the hand works in and what the step's own watchdog looks for), then a HANDOFF when a
 * dialog-like window is left.
 */
async function handWatched<T>(deps: W6Deps, pid: number, fn: () => Promise<T>): Promise<T> {
  const before = baselineRefusal(await deps.windows(), pid);
  if (before) throw new StopBattery("handoff", before);
  const value = await fn();
  const after = baselineRefusal(await deps.windows(), pid);
  if (after) throw new StopBattery("handoff", `after the hand step: ${after}`);
  return value;
}

export async function runBattery(
  steps: StepDef[],
  deps: W6Deps,
  opts: W6Options,
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
  // sitting has none, so the net-zero step always has a baseline.
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
    if (s.hand && opts.skipHand) {
      write({
        ...base,
        status: "HELD",
        detail: "--skip-hand: held for a sitting with the hand (nothing sent)",
        endedAt: startedAt,
        probes: [],
        evidence: {},
      });
      continue;
    }
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
      let out: StepOutcome;
      if (s.hand) out = await handWatched(deps, pid, () => s.run(ctx));
      else {
        // W1 cold run fix-up audit: world opens (w6-03, w6-40, the closable step) and the plugin
        // runs can leave the editor windows disabled for a while; W2's WATCH_OPTIONS graces that.
        const w = await watched(
          deps,
          pid,
          s.expectsWindows,
          abort,
          () => s.run(ctx),
          WATCH_OPTIONS,
        );
        out = w.value;
        if (w.added.length)
          out.evidence.windowsAdded = w.added.map((x) => ({
            className: x.className,
            title: x.title,
          }));
      }
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

/** `<sitting>/w6-result.json`: every step's latest record across the sitting's run folders, and each probe's result. */
export function writeResult(
  opts: W6Options,
  deps: Pick<W6Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
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
  log: (l: string) => void;
}

/** What `plant` writes: project-relative path to its source. */
export function plantSources(): Array<{ rel: string; from: string }> {
  return [
    { rel: CSV_REL, from: "generated: Object Import CSV (formatCsv), 3 rows of PROP" },
    { rel: SHP_LINES, from: "generated: polyline shapefile (writeShp), 2 records, 3 parts" },
    { rel: SHX_LINES, from: "generated: its index (writeShx)" },
    { rel: SHP_POINTS, from: "generated: point shapefile (writeShp), 2 records" },
    { rel: SHX_POINTS, from: "generated: its index (writeShx)" },
    ...TEMPLATE_BASES.map((b) => ({
      rel: templateRel(b),
      from: `generated: script_create plugin template, parentClass ${b}`,
    })),
  ];
}

/** `plant`: the generated fixtures and the worlds folder under _throwaway/W6/ (no Workbench running). */
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
  if (io.exists(abs(sandboxDir, W6_ROOT))) {
    io.log(`refused: <sandbox>/${W6_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const throwawayExistedBefore = io.exists(abs(sandboxDir, THROWAWAY));
  const bytes = plantBytes();
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

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W6/; `_throwaway/` only when empty and absent before. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W6_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W6_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W6_ROOT}/ (${files.length} files)`);
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
    join(sittingDir, "throwaway-w6-listing.json"),
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
  io.log(`removed <sandbox>/${W6_ROOT}/ (listing in throwaway-w6-listing.json)`);
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

/**
 * P-W6-04's read-only query: every key under HKCU\Software\Bohemia Interactive whose path names
 * ScriptTools, with its value names and kinds (never the values: they may hold user paths).
 */
export const REGISTRY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$keys = Get-ChildItem -Path 'HKCU:\\Software\\Bohemia Interactive' -Recurse | Where-Object { $_.Name -match 'ScriptTools' }",
  "$out = foreach ($k in $keys) { [pscustomobject]@{ path = [string]$k.Name; values = @($k.GetValueNames() | ForEach-Object { [pscustomobject]@{ name = [string]$_; kind = [string]$k.GetValueKind($_) } }) } }",
  "ConvertTo-Json -InputObject @($out) -Depth 5 -Compress",
].join("\n");

/**
 * The clipboard read (fix-up 2): its format names and, when it holds Unicode text, that text as
 * base64 UTF-8. Windows Forms Clipboard, not Get-Clipboard: Get-Clipboard -Raw answers nothing
 * alike for an empty clipboard and for an image, and the step must tell them apart. One JSON line;
 * a failure prints {error} (GetDataObject needs an STA thread; Windows PowerShell 5.1 is STA).
 */
export const CLIPBOARD_READ_SCRIPT = [
  "try {",
  "  Add-Type -AssemblyName System.Windows.Forms",
  "  $o = [System.Windows.Forms.Clipboard]::GetDataObject()",
  "  $f = @(); if ($o) { $f = @($o.GetFormats() | ForEach-Object { [string]$_ }) }",
  "  $t = $null",
  "  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::UnicodeText)) { $t = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText))) }",
  "  ConvertTo-Json -InputObject ([pscustomobject]@{ formats = $f; text = $t }) -Compress",
  "} catch { ConvertTo-Json -InputObject ([pscustomobject]@{ error = [string]$_.Exception.Message }) -Compress }",
].join("\n");

/**
 * The clipboard write (fix-up 2): EMCP_CLIP_MODE `text` puts EMCP_CLIP_B64 back as Unicode text,
 * `empty` empties it with Clipboard.Clear(). Never Set-Clipboard -Value '': it reaches
 * Clipboard.SetText(""), which throws ArgumentNullException (String.IsNullOrEmpty check, IL read
 * of SetText(String, TextDataFormat) this session): run 2's "restore clipboard: :". One JSON line.
 */
export const CLIPBOARD_WRITE_SCRIPT = [
  "try {",
  "  Add-Type -AssemblyName System.Windows.Forms",
  "  if ($env:EMCP_CLIP_MODE -eq 'empty') { [System.Windows.Forms.Clipboard]::Clear() }",
  "  elseif ($env:EMCP_CLIP_MODE -eq 'text') {",
  "    $t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$env:EMCP_CLIP_B64))",
  "    if ($t.Length -eq 0) { [System.Windows.Forms.Clipboard]::Clear() } else { [System.Windows.Forms.Clipboard]::SetText($t, [System.Windows.Forms.TextDataFormat]::UnicodeText) }",
  "  } else { throw ('unknown mode ' + $env:EMCP_CLIP_MODE) }",
  "  ConvertTo-Json -InputObject ([pscustomobject]@{ ok = $true }) -Compress",
  "} catch { ConvertTo-Json -InputObject ([pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message }) -Compress }",
].join("\n");

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W6Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const worldDeps = { projectRoot: input.sandboxDir, artifactsRoot: artifactsDir() };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  const pluginDeps = {
    client,
    catalog: () => loadCatalog(),
    allowList: () => loadAllowList(),
    runAllowList: () => loadRunAllowList(),
  };
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_plugin":
          return asResp(await runPlugin(args, pluginDeps));
        case "wb_world_tools":
          return asResp(await runWorldTools(client, args, { projectPath: input.sandboxDir }));
        case "wb_shape":
          // No parallelOpen override: a GATED action is sent only for its refusal.
          return asResp(await runShape(client, args, { projectPath: input.sandboxDir }));
        case "wb_entity":
          return asResp(await runEntity(client, args));
        case "wb_view":
          return asResp(await runView(client, args));
        case "wb_terrain":
          return asResp(await runTerrain(client, args));
        case "wb_world":
          return asResp(await runWorld(client, args, worldDeps));
        case "wb_module":
          return asResp(await runModule(client, args as unknown as ModuleArgs));
        case "wb_container":
          return asResp(await runContainer(client, args, { artifactsRoot: artifactsDir() }));
        case "wb_script_editor":
          return asResp(await runScriptEditor(client, args));
        case "wb_localization":
          return asResp(await runLocalization(client, args));
        case "wb_bi":
          return asResp(await runBi(args, { client }));
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
    registry: async () => {
      const r = await runPowerShell(REGISTRY_SCRIPT, { timeoutMs: 60_000 });
      if (!r.ok) return { ok: false, keys: [], error: S(r.error) };
      try {
        const text = r.stdout.trim();
        const parsed = text ? (JSON.parse(text) as unknown) : [];
        const list = (Array.isArray(parsed) ? parsed : [parsed]) as Raw[];
        return {
          ok: true,
          keys: list.map((k) => ({
            path: S(k.path).replace(/^HKEY_CURRENT_USER/, "HKCU"),
            values: (Array.isArray(k.values) ? (k.values as Raw[]) : []).map((v) => ({
              name: S(v.name),
              kind: S(v.kind),
            })),
          })),
        };
      } catch (e) {
        return { ok: false, keys: [], error: e instanceof Error ? e.message : String(e) };
      }
    },
    clipboardRead: async () => {
      const r = await runPowerShell(CLIPBOARD_READ_SCRIPT, { timeoutMs: 15_000 });
      try {
        const o = JSON.parse(lastLine(r.stdout) ?? "") as Raw;
        if (typeof o.error === "string" && o.error)
          return { state: "error", text: "", formats: [], error: o.error };
        const formats = (Array.isArray(o.formats) ? o.formats : o.formats ? [o.formats] : []).map(
          S,
        );
        const text =
          typeof o.text === "string" ? Buffer.from(o.text, "base64").toString("utf-8") : null;
        return clipboardSnapOf(formats, text);
      } catch {
        const error = (r.error ?? r.stderr.trim()) || "the read printed no JSON";
        return { state: "error", text: "", formats: [], error };
      }
    },
    clipboardWrite: async (snap) => {
      if (snap.state !== "text" && snap.state !== "empty")
        return { ok: false, error: `a ${snap.state} clipboard is never written back` };
      const r = await runPowerShell(CLIPBOARD_WRITE_SCRIPT, {
        timeoutMs: 15_000,
        env: {
          EMCP_CLIP_MODE: snap.state,
          EMCP_CLIP_B64: Buffer.from(snap.text, "utf-8").toString("base64"),
        },
      });
      try {
        const o = JSON.parse(lastLine(r.stdout) ?? "") as Raw;
        return { ok: o.ok === true, error: o.ok === true ? null : S(o.error) || "no error text" };
      } catch {
        return { ok: false, error: (r.error ?? r.stderr.trim()) || "the write printed no JSON" };
      }
    },
    toolClasses: () =>
      loadCatalog()
        .filter((r) => r.kind === "tool")
        .map((r) => r.className),
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
const FLAGS = ["really", "skip-hand", "update-baseline"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: W6Deps;
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
        `refused: ${sittingDir} holds no ${PLANT_FILE}: run \`w6.live.ts plant\` first`,
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
    deps = realDeps({ port, lane, sandboxDir: resolve(o.sandbox) });
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
      skipHand: args.flags.has("skip-hand"),
    });
    for (const l of resultTable(r.records)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w6",
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

// Census rows this file tests (W6 close-out, EV-W6-113).
// census:mcp:action/wb_shape.area
// census:mcp:action/wb_shape.create
// census:mcp:action/wb_shape.import
// census:mcp:action/wb_shape.points
// census:mcp:action/wb_world_tools.exportObjects
// census:mcp:action/wb_world_tools.floaters
// census:mcp:action/wb_world_tools.goToCoords
// census:mcp:action/wb_world_tools.importObjects
// census:mcp:action/wb_world_tools.replaceEntities
// census:mcp:action/wb_world_tools.stats
// census:mcp:handler-action/EMCP_WB_Shape.area
// census:mcp:handler-action/EMCP_WB_Shape.create
// census:mcp:handler-action/EMCP_WB_Shape.import
// census:mcp:handler-action/EMCP_WB_Shape.points
// census:mcp:handler-action/EMCP_WB_WorldTools.exportObjects
// census:mcp:handler-action/EMCP_WB_WorldTools.floaters
// census:mcp:handler-action/EMCP_WB_WorldTools.goToCoords
// census:mcp:handler-action/EMCP_WB_WorldTools.importObjects
// census:mcp:handler-action/EMCP_WB_WorldTools.replaceEntities
// census:mcp:handler-action/EMCP_WB_WorldTools.stats
