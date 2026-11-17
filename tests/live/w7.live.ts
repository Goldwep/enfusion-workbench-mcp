/**
 * Wave W7 (Terrain editing, shapes, generators), the live battery (docs/v2/design/phase5-w7-spec.md
 * sections 3.1 and 6, DEC-058, DEC-075). Built on the W6 battery (tests/live/w6.live.ts): the same
 * CLI, the same evidence, the same hand mechanism, the same stop rules and the lessons of its
 * fix-ups (packed files named by {GUID}path, absent files named as absent, a verdict per item, the
 * FAIL counter kept per independent step).
 *
 * A GUI Workbench on the live lane's test bed, launched by the two-pass pre-flight on the scratch
 * profile with `-scriptAuthorizeAll` (DEC-053 ruling 2), the shipped bundle installed and NO probe
 * pack. This script never launches, never takes the lease for itself (the lane given with --id holds
 * it) and reaches Workbench through the shipped TS tools run IN PROCESS over a `WorkbenchClient`
 * WITHOUT a Config: `runTerrainEdit` (the sandbox as projectPath, the backups in the artifacts
 * folder, one NO_BACKUP record per process; w7-23 a fresh one), `runGenerator`, `runShape` and the
 * W1 to W6 tools. Policy, tile order and gate switches stay the shipped ones (a probe build flips
 * them in the shipped files, never the battery).
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan and the queue with preflight's validateQueue; `--out` writes
 * the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/W7-queue.json;
 * a test keeps the two equal). The runbook is docs/v2/sessions/queues/W7.md.
 *
 * The owner's items (DEC-075). OI-W7-1: the throwaway terrain world, made by hand under
 * `_throwaway/W7/` and named with --terrain-world. OI-W7-2: the terrain go, one line in the session
 * log (--session-log) that names "OI-W7-2", the word "go" and that world. A step that needs an item
 * that is not there records BLOCKED with `blocked:OI-W7-1` or `blocked:OI-W7-2` and sends nothing.
 * The terrain steps (W7.0 terrain set-up, the confirmed writes of W7.2, W7.4 to W7.7, the hand steps)
 * need both. The reads may use vanilla EmptyArland opened read-only (never saved); the entity probes
 * P-W7-10 to -14 run on a throwaway world `wb_world new` writes under `_throwaway/W7/worlds/`.
 *
 * THE HARNESS GUARD. Before any confirmed `wb_terrain_edit` write (tileWrite, brush, flatter, maps,
 * exportMasks, restore) and any `wb_module save`, the context reads `wb_world state` (GetWorldPath)
 * and refuses, before sending, when the open world is not under `_throwaway/W7/`: the battery
 * stops (exit 3). A test pins it.
 *
 * Blocks (one launch; each ordered read-only, reversible, mutating for the queue):
 *   W7.0 setup      test-bed gate, stamp, plant record, snapshot; the three W7 handlers answer; the
 *                   entity world (wb_world new); the terrain world opened, hasTerrain, its file set
 *                   (P-W7-03), wb_terrain_edit backup and the battery's own sha256 manifest
 *   W7.1 reads      vanilla: tileRead of two neighbouring tiles against wb_terrain tile, the three
 *                   Bohemia reads (P-W7-05); the same on the throwaway terrain world (kept for W7.7);
 *                   wb_shape points tesselated, wb_generator list on the entity world
 *   W7.2 refusals   the dry-run estimate leaves the tile unchanged; NOT_IN_PROJECT on vanilla (dry
 *                   runs only); WRONG_MODE in play; NO_BACKUP in a fresh tool session; GATED for every
 *                   action whose flag is false (terrain on the throwaway world, entity on the entity
 *                   world)
 *   W7.3 entities   wb_shape edit, six ops, one undo each, area with target (P-W7-14); generator
 *                   attach and detach (P-W7-10), regenerate (P-W7-11), pointData (P-W7-13), events
 *                   (P-W7-12); every edit undone
 *   W7.4 terrain    tile markers: effect, undo, array order (P-W7-01); seams (P-W7-02); the patch
 *                   ceiling (P-W7-04); brush in each mode against its own estimate (P-W7-16);
 *                   flatter (P-W7-06); exportMasks (P-W7-08); persistence after save and reopen
 *                   (P-W7-01)
 *   W7.5 maps       shore, then flow (P-W7-07): files overwritten, no undo (restore puts them back)
 *   W7.6 cli        the variant-replacement plugin prepared for the CLI lane (its run is the
 *                   runbook's, Workbench closed: P-W7-15)
 *   W7.7 restore    the terrain world closed, restore with confirm, the manifest checked, reopened,
 *                   the W7.1 rows read back equal
 *   W7.8 hand       H1 (K2 only): the owner imports the .asc through Terrain Tool, Manage
 *   W7.9 close      H3 (optional, waivable in the go): the owner looks at the world; net-zero
 *                   outside _throwaway/W7/ and the terrain manifest; the closable step
 * H2 (contingency) is the HANDOFF of the stop rules: a dialog the watchdog cannot clear is the
 * owner's to close (never Save, never OK); the record names the title and the resume.
 *
 * Usage:
 *   npx --no tsx tests/live/w7.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w7.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w7.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--terrain-world _throwaway/W7/<name>.ent] [--session-log <file>]
 *       [--from <step>] [--until <step>] [--only <step>] [--skip-hand] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w7.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
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
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { runShape } from "../../src/tools/wb-shape.js";
import {
  TerrainBackupRecord,
  runTerrainEdit,
  type BackupManifest,
  type TerrainEditOptions,
} from "../../src/tools/wb-terrain-edit.js";
import { runGenerator } from "../../src/tools/wb-generator.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runTerrain } from "../../src/tools/wb-terrain.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runBi } from "../../src/tools/wb-bi.js";
import {
  CONFIRM_PLUGINS,
  TERRAIN_VARIANT_PLUGIN,
  isThrowawayWorld,
  pluginGate,
} from "../../src/tools/wb-cli-run.js";
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
  baselineRefusal,
  watched,
  type VerdictOptions,
} from "../../scripts/census/live/common.js";
import { changedFiles, handFiles, handLine, recordPath } from "./w2.live.js";

export { EXIT, StopBattery, handFiles, handLine, recordPath };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W7";

/**
 * The window watch of every polled step (W7 fix-up 1). Run 1 handed off a play step (w7-22-wrong-mode) on the
 * play-mode transition: wb_play disables the main windows ("World Editor - ...", "Enfusion
 * Workbench - ...", Qt683QWindowIcon, unowned) and shows a disabled Qt683QWindowToolSaveBits
 * "Arma Reforger Workbench", owner 0; a screenshot afterwards showed no dialog and Workbench back in
 * edit mode. Those are busy windows (isBusyWindow); W5 fix-up 2's grace (busyGraceMs; W5's play steps pass under it)
 * waits them out for at most BUSY_GRACE_MS and is a handoff past it. An owned
 * window, a #32770, a known modal title or an unexpected window beside them is still a verdict at once.
 */
export const WATCH_OPTIONS: VerdictOptions = { popups: false, busyGraceMs: BUSY_GRACE_MS };
/** The last step; the runner also runs it after a stop (not after a dialog, LOST or WEDGED). */
export const CLOSABLE_STEP = "w7-99-closable";
export const GATE_STEP = "w7-00-gate";
export const NETZERO_STEP = "w7-95-netzero";
export const H1_STEP = "w7-80-h1-asc-import";
export const H3_STEP = "w7-90-h3-look";
export const RESTORE_STEP = "w7-70-restore";
export const SCRIPT_PATH = "tests/live/w7.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W7.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W7-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));

/** The one switch the launch carries, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<sitting>/w7-scratch.ini",
  SAA,
];

export const THROWAWAY = "_throwaway";
/** Every file the battery or the owner's terrain world touches lies under this folder. */
export const W7_ROOT = `${THROWAWAY}/W7`;
/** What the battery itself creates (rollback removes these, never the owner's terrain world). */
export const WORLDS_DIR = `${W7_ROOT}/worlds`;
export const MASKS_DIR = `${W7_ROOT}/masks`;
export const BATTERY_DIRS: readonly string[] = [WORLDS_DIR, MASKS_DIR];
/** The entity world of P-W7-10 to -14 (wb_world new, DEC-068 OD-4, DEC-075). */
export const ENTITY_WORLD = `${WORLDS_DIR}/EMCP_W7_Entities.ent`;
/** The placeholder the plan uses for the owner's terrain world (OI-W7-1). */
export const TERRAIN_WORLD_PH = `${W7_ROOT}/<terrain world>.ent`;
/** The vanilla terrain world of the read probes: opened read-only, never saved (DEC-061 OD-5). */
export const VANILLA_WORLD = "worlds/Arland/EmptyArland.ent";

/** Vanilla prefabs by {GUID}path (packed files resolve by GUID, W2 fix-up 2). */
export const PROP = "{3F23DA7ACAC0ED90}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et";
/** A forest generator prefab (E10 1.9.0.37 observation): attach's subject (P-W7-10). */
export const FOREST_PREFAB = "{C110BC1515DDFD3F}Prefabs/WEGenerators/Forest/FG_Forest_Spruce1.et";
/** The point data class of P-W7-13 (spec 2.2). */
export const POINT_DATA_CLASS = "ForestGeneratorPointData";
export const NAME_PREFIX = "W7_";

export const PLANT_FILE = "plant-w7.json";
export const RESULT_FILE = "w7-result.json";
export const BATTERY_SNAPSHOT_FILE = "w7-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w7-battery-snapshot";
/** The sitting's first backup and the battery's own sha256 manifest of its files. */
export const BACKUP_FILE = "w7-backup.json";
/** The throwaway terrain rows W7.1 read, the reference W7.7 reads back. */
export const BEFORE_FILE = "w7-terrain-before.json";
/** The K2 branch's .asc path (a GATED brush answer names it) and the heights before it. */
export const K2_FILE = "w7-k2.json";
/** Files whose change outside _throwaway/W7/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
export const HAND_WAIT_MS = 900_000;

export const TIMEOUTS = {
  step: 180_000,
  open: 600_000,
  write: 300_000,
  poll: 5_000,
  windowPoll: 1_000,
} as const;

/** P-W7-16 and the read-backs: 1 mm. */
export const HEIGHT_TOL = 0.001;
/** A sample counts as changed above this (float text round trip). */
export const CHANGE_EPS = 0.0001;
/** Rows a tileRead page may carry (contract: max 64). */
export const TILE_PAGE = 64;
/** Pages any one tile read may take (a runaway cursor stops). */
export const MAX_PAGES = 64;

/**
 * Blocks whose steps are independent proofs: each sets up its own fixtures and undoes them, so
 * three failing in a row says nothing about the session (W2 fix-up 3).
 */
export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W7.2", "W7.3", "W7.4", "W7.5"]);

export function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? `${s.block}/${s.id}` : s.block;
}

export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/** Refusal codes that prove a handler compiled and answered (a domain refusal is an answer). */
export const DOMAIN_CODES: ReadonlySet<string> = new Set([
  "ENGINE_FALSE",
  "STALE_CURSOR",
  "RESOURCE_NOT_FOUND",
  "ENTITY_NOT_FOUND",
  "NOT_A_SHAPE",
  "NOT_A_GENERATOR",
  "INVALID_ARGUMENT",
  "NOT_IN_PROJECT",
  "NO_WORLD",
  "WRONG_MODE",
  "NO_TERRAIN",
  "GATED",
  "NO_BACKUP",
  "ENGINE_BUSY",
  "TERRAIN_ACTION_REFUSED",
  "WORLD_OPEN",
  "PATH_NOT_FOUND",
  "UNPROVEN",
  "MODULE_NOT_OPEN",
  "NOT_ALLOWLISTED",
]);

/** Titles a step may add: the editors' main windows. */
export const WORKBENCH_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  /^World Editor$/,
  /^Enfusion Workbench( - .+)?$/,
  /^Arma Reforger Workbench$/,
];

// ── Coverage tables ──────────────────────────────────────────────────────────

/** The W7 contracts in contracts/ and the TS tool that drives each. */
export const W7_CONTRACTS = {
  EMCP_WB_TerrainEdit: "wb_terrain_edit",
  EMCP_WB_Generator: "wb_generator",
  EMCP_WB_Shape: "wb_shape",
} as const;

/** The TypeScript-served actions of the wave's tools (spec 2.1 brush, backup, restore; 2.3 area, import). */
export const TS_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  wb_terrain_edit: ["brush", "backup", "restore"],
  wb_shape: ["area", "import"],
};

/** Actions no step exercises, with the reason. */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {
  "wb_shape.import":
    "unchanged by W7 (spec 2.3: create, import and parallel are unchanged); W6's w6-26 is its engine accept and no W7 row names it",
};

/** Probes no step can settle in this battery, with the reason. */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {
  "P-W7-09":
    "the K1 route runs only when P-W7-01 kills and the integrator sets policy terrain_write_route exportTerrain (spec 3.2, DEC-075); the TS tool then sends ExportTerrain itself, so the W7.4 steps of a later sitting exercise it through the same calls (W7.md, branch K1)",
  "P-W7-15":
    "a headless wb_cli_run is its own Workbench process on the same profile and world; it cannot run beside the GUI Workbench this battery drives, so the runbook runs it on the CLI lane after the post-flight closed the GUI (W7.md step 9); w7-60 prepares and checks its arguments",
};

/**
 * The engine-accept proof of each offline tool of the wave (spec section 4): the step whose small
 * edit on the throwaway terrain world (or the entity world) the engine loads and whose changed value
 * the battery reads back, or null with the reason no step of this battery can prove it.
 */
export const ENGINE_ACCEPT: Readonly<
  Record<string, { step: string | null; proof: string; probe?: string }>
> = {
  "terrain-brush.patch-codec": {
    step: "w7-40-tile-markers",
    proof:
      "formatPatches writes four corner markers; the engine's tile holds them (tileRead and wb_terrain heights read the offsets back); w7-46 saves, reopens and reads them again",
    probe: "P-W7-01",
  },
  "terrain-brush.brush-maths": {
    step: "w7-43-brush",
    proof:
      "each mode's TS estimate (samples, min, max, mean delta) against the heights the engine holds after the write, to 1 mm",
    probe: "P-W7-16",
  },
  "wb-terrain-edit.backup-manifest": {
    step: "w7-70-restore",
    proof:
      "restore copies the backup over the files the session wrote; every file hashes as the battery's own manifest; the engine reopens the world and its rows read back equal the W7.1 read",
  },
  "wb-shape.edit-planner": {
    step: "w7-30-shape-edit",
    proof:
      "each op's planned point list against the points the engine holds after the edit (wb_shape points), one undo each",
    probe: "P-W7-14",
  },
  "terrain-export.asc-writer": {
    step: "w7-80-h1-asc-import",
    proof:
      "K2 only: the owner imports the TS-written .asc through Terrain Tool, Manage; the battery reads the heights back at the brush centre",
  },
  "terrain-export.k1-binary": {
    step: null,
    proof:
      "K1 only: ExportTerrain reads the TS binary when policy terrain_write_route is exportTerrain, after P-W7-01 kills; the W7.4 steps of that sitting send it through the same calls (NOT_TESTABLE P-W7-09)",
    probe: "P-W7-09",
  },
};

export const PROBE_IDS: readonly string[] = Array.from(
  { length: 16 },
  (_, i) => `P-W7-${String(i + 1).padStart(2, "0")}`,
);

// ── Types ────────────────────────────────────────────────────────────────────

export type W7Tool =
  | "wb_terrain_edit"
  | "wb_generator"
  | "wb_shape"
  | "wb_terrain"
  | "wb_world"
  | "wb_module"
  | "wb_entity"
  | "wb_bi";

/** Offline work of a step (no NET call; in the coverage and write checks). */
export type OfflineTool = "fs" | "cli_run";

export const HANDLER_OF: Readonly<Record<W7Tool, string>> = {
  wb_terrain_edit: "EMCP_WB_TerrainEdit",
  wb_generator: "EMCP_WB_Generator",
  wb_shape: "EMCP_WB_Shape",
  wb_terrain: "EMCP_WB_Terrain",
  wb_world: "EMCP_WB_World",
  wb_module: "EMCP_WB_Module",
  wb_entity: "EMCP_WB_Entity",
  wb_bi: "<bi handler>",
};

export type Block =
  | "W7.0"
  | "W7.1"
  | "W7.2"
  | "W7.3"
  | "W7.4"
  | "W7.5"
  | "W7.6"
  | "W7.7"
  | "W7.8"
  | "W7.9";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "KILLED" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED" | "HELD" | "BLOCKED";
export type OwnerItem = "OI-W7-1" | "OI-W7-2";
/** Both owner items: the terrain steps (DEC-075). */
export const TERRAIN_GO: readonly OwnerItem[] = ["OI-W7-1", "OI-W7-2"];

export interface ProbeResult {
  id: string;
  result: "SETTLED" | "KILLED" | "PARTIAL";
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

export interface W7Deps {
  /**
   * One shipped TS tool, run in process against a client WITHOUT a Config. `freshSession` runs
   * wb_terrain_edit with a new tool session (no backup recorded: the NO_BACKUP check).
   */
  tool: (
    name: W7Tool,
    args: Record<string, unknown>,
    o?: { freshSession?: boolean },
  ) => Promise<ToolResponse>;
  /** EMCP_WB_EditorControl {action: "undo"} (World Editor Edit > Undo), never retried. */
  undo: () => Promise<UndoResult>;
  info: () => Promise<Record<string, unknown> | null>;
  ping: () => Promise<Record<string, unknown> | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  /** The installed handler's source (the repo copy the bundle digest stands for), null if absent. */
  handlerSource: (handler: string) => string | null;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  /** Relative paths of every file under `dir` (forward slashes), [] when absent. */
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W7Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** OI-W7-1: the owner's terrain world, project-relative (null: not given). */
  terrainWorld: string | null;
  /** OI-W7-2: the session log that holds the owner's go (null: not given). */
  sessionLog: string | null;
  skipHand?: boolean;
}

export interface Debt {
  undos: number;
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W7Deps;
  opts: W7Options;
  prior: (id: string) => StepRecord | null;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  state: Map<string, string>;
  tool: (
    name: W7Tool,
    args: Record<string, unknown>,
    o?: { restore?: boolean; tolerate?: boolean; freshSession?: boolean },
  ) => Promise<ToolResponse>;
  undo: () => Promise<UndoResult>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

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
  probes: string[];
  dependsOn?: string[];
  /** The owner items this step needs; missing ones record BLOCKED and nothing is sent. */
  owner?: readonly OwnerItem[];
  writes: string[];
  expectsWindows?: readonly RegExp[];
  hand?: boolean;
  plan: () => PlanAction[];
  offlineCalls?: () => OfflineCall[];
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

// ── Small helpers ────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

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
    : {
        ok: false,
        code: r.code ?? null,
        message: r.message ?? null,
        next: r.next ?? null,
        readback: r.readback ?? null,
      };
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

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function readJson<T>(path: string, deps: Pick<W7Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W7Deps, "writeBytes">): void {
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
  return [p[0], p[1], p[2]];
}

/** A float as the text the wire carries (spec 1.2.4: floats travel as text; 1 mm round trip). */
export function ftext(n: number): string {
  return n.toFixed(4);
}

/** The answer of a gated write: "ok", "gated" or the refusal code. */
export function gateAnswer(r: ToolResponse | null): string {
  if (!r) return "not sent";
  if (r.ok) return "ok";
  return r.code === "GATED" ? "gated" : S(r.code) || "error";
}

// ── Owner items (DEC-075) and the harness guard ──────────────────────────────

/** The open world's path as the project-relative form (`$<id>:` and the sandbox prefix removed). */
export function worldRelOf(worldPath: string, sandboxDir: string): string {
  let p = worldPath.replace(/\\/g, "/").replace(/^\$[^:]*:/, "");
  const root = sandboxDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) p = p.slice(root.length + 1);
  return p.replace(/^\/+/, "");
}

/** True for a clean relative path under `_throwaway/W7/` (no `..`, no drive, no empty segment). */
export function underW7(rel: string): boolean {
  const r = rel.replace(/\\/g, "/");
  if (r === "" || r.startsWith("/") || /^[A-Za-z]:/.test(r)) return false;
  const parts = r.split("/");
  if (parts.some((x) => x === "" || x === "." || x === "..")) return false;
  return (
    parts.length > 2 &&
    parts[0].toLowerCase() === THROWAWAY.toLowerCase() &&
    parts[1].toLowerCase() === "w7"
  );
}

/** OI-W7-1's form: an .ent under _throwaway/W7/, outside the battery's own worlds/ folder. */
export function isTerrainWorldRel(rel: string): boolean {
  const r = rel.replace(/\\/g, "/");
  return (
    underW7(r) &&
    r.toLowerCase().endsWith(".ent") &&
    !r.toLowerCase().startsWith(`${WORLDS_DIR.toLowerCase()}/`)
  );
}

/**
 * The harness guard: null when the open world (GetWorldPath, as wb_world state answers it) lies
 * under _throwaway/W7/, else why the call is refused before it is sent.
 */
export function throwawayRefusal(worldPath: string, sandboxDir: string): string | null {
  if (!worldPath.trim()) return "no world is open (GetWorldPath is empty)";
  const rel = worldRelOf(worldPath, sandboxDir);
  if (underW7(rel)) return null;
  return `the open world '${rel}' is not under ${W7_ROOT}/`;
}

/** Confirmed terrain writes and saves: the calls the harness guard checks before sending. */
export const TERRAIN_WRITES: ReadonlySet<string> = new Set([
  "tileWrite",
  "brush",
  "flatter",
  "maps",
  "exportMasks",
  "restore",
]);

export function isGuardedCall(name: string, args: Raw): boolean {
  if (name === "wb_module" && S(args.action) === "save") return true;
  return name === "wb_terrain_edit" && TERRAIN_WRITES.has(S(args.action)) && args.confirm === true;
}

/**
 * The owner's go in the session log: a line naming "OI-W7-2", the word "go" and the terrain world
 * (case and slashes folded). `waivesH3` when that line also says "waive H3".
 */
export function ownerGoOf(
  logText: string | null,
  world: string | null,
): { go: boolean; waivesH3: boolean; line: string | null } {
  if (!logText || !world) return { go: false, waivesH3: false, line: null };
  const w = world.replace(/\\/g, "/").toLowerCase();
  for (const raw of logText.split(/\r?\n/)) {
    const l = raw.replace(/\\/g, "/");
    if (/\bOI-W7-2\b/i.test(l) && /\bgo\b/i.test(l) && l.toLowerCase().includes(w))
      return { go: true, waivesH3: /\bwaive[sd]?\s+H3\b/i.test(l), line: raw.trim() };
  }
  return { go: false, waivesH3: false, line: null };
}

/** Why a step that needs `need` cannot run: `blocked:OI-W7-n (...)`, or null. */
export function ownerBlock(
  need: readonly OwnerItem[],
  x: { terrainWorld: string | null; worldPresent: boolean; logText: string | null },
): string | null {
  if (need.includes("OI-W7-1")) {
    if (!x.terrainWorld)
      return "blocked:OI-W7-1 (no --terrain-world: the owner makes the throwaway terrain world by hand)";
    if (!isTerrainWorldRel(x.terrainWorld))
      return `blocked:OI-W7-1 (${x.terrainWorld} is not an .ent under ${W7_ROOT}/ outside ${WORLDS_DIR}/)`;
    if (!x.worldPresent) return `blocked:OI-W7-1 (${x.terrainWorld} is not on disk)`;
  }
  if (need.includes("OI-W7-2")) {
    if (x.logText === null)
      return "blocked:OI-W7-2 (no session log given or found: the go is one line in it)";
    if (!ownerGoOf(x.logText, x.terrainWorld).go)
      return `blocked:OI-W7-2 (the session log holds no line naming OI-W7-2, go and ${x.terrainWorld ?? "the world"})`;
  }
  return null;
}

function ownerInput(
  opts: W7Options,
  deps: Pick<W7Deps, "exists" | "readBytes">,
): { terrainWorld: string | null; worldPresent: boolean; logText: string | null } {
  const tw = opts.terrainWorld ? opts.terrainWorld.replace(/\\/g, "/") : null;
  let logText: string | null = null;
  if (opts.sessionLog && deps.exists(opts.sessionLog)) {
    try {
      logText = deps.readBytes(opts.sessionLog).toString("utf-8");
    } catch {
      logText = null;
    }
  }
  return {
    terrainWorld: tw,
    worldPresent: !!tw && underW7(tw) && deps.exists(abs(opts.sandboxDir, tw)),
    logText,
  };
}

// ── Gate flags (the handlers' static const bool, spec 1.2.9) ─────────────────

/** Each gate flag, its handler and the probe that opens it. */
export const GATE_FLAGS = {
  TERRAIN_WRITE_OPEN: { handler: "EMCP_WB_TerrainEdit", probe: "P-W7-01" },
  FLATTER_OPEN: { handler: "EMCP_WB_TerrainEdit", probe: "P-W7-06" },
  MAPS_OPEN: { handler: "EMCP_WB_TerrainEdit", probe: "P-W7-07" },
  MASKS_OPEN: { handler: "EMCP_WB_TerrainEdit", probe: "P-W7-08" },
  ANY_WORLD_OPEN: { handler: "EMCP_WB_TerrainEdit", probe: "OI-W7-6" },
  ATTACH_OPEN: { handler: "EMCP_WB_Generator", probe: "P-W7-10" },
  REGENERATE_OPEN: { handler: "EMCP_WB_Generator", probe: "P-W7-11" },
  EVENTS_OPEN: { handler: "EMCP_WB_Generator", probe: "P-W7-12" },
  POINTDATA_OPEN: { handler: "EMCP_WB_Generator", probe: "P-W7-13" },
  EDIT_OPEN: { handler: "EMCP_WB_Shape", probe: "P-W7-14" },
  PARALLEL_OPEN: { handler: "EMCP_WB_Shape", probe: "P-W6-16" },
} as const;
export type GateFlag = keyof typeof GATE_FLAGS;

/** Each flag's value in the handler sources: true, false, or null when it is not found. */
export function gateFlagsOf(
  source: (handler: string) => string | null,
): Record<GateFlag, boolean | null> {
  const out = {} as Record<GateFlag, boolean | null>;
  for (const [flag, g] of Object.entries(GATE_FLAGS) as Array<[GateFlag, { handler: string }]>) {
    const text = source(g.handler);
    const m = text
      ? new RegExp(`static\\s+const\\s+bool\\s+${flag}\\s*=\\s*(true|false)\\s*;`).exec(text)
      : null;
    out[flag] = m ? m[1] === "true" : null;
  }
  return out;
}

/**
 * w7-22's verdict on the calls sent in play (fix-up 2). Every W7 handler checks its gate flag before
 * EditApi's mode check, so a closed gate answers GATED with nothing engine-side touched: accepted,
 * and WRONG_MODE is recorded as not yet proven for that action. An open gate must answer WRONG_MODE.
 * A flag not found in the handler source is a failure (the battery cannot tell which applies).
 */
export function wrongModeCheck(
  calls: ReadonlyArray<{ key: string; flag: GateFlag; r: ToolResponse }>,
  flags: Record<GateFlag, boolean | null>,
): { fails: string[]; unproven: string[] } {
  const fails: string[] = [];
  const unproven: string[] = [];
  for (const { key, flag, r } of calls) {
    const open = flags[flag];
    if (r.ok) fails.push(`${key} in play: ok`);
    else if (open === null) fails.push(`${key} in play: ${flag} not found in the handler source`);
    else if (open === false && r.code === "GATED") unproven.push(key);
    else if (r.code !== "WRONG_MODE")
      fails.push(`${key} in play (${flag} ${String(open)}): ${why(r)}`);
  }
  return { fails, unproven };
}

/** The gated actions of the wave: the flag that holds each (spec 1.2.9). */
export const GATED_TERRAIN: ReadonlyArray<{ action: string; flag: GateFlag }> = [
  { action: "tileWrite", flag: "TERRAIN_WRITE_OPEN" },
  { action: "brush", flag: "TERRAIN_WRITE_OPEN" },
  { action: "flatter", flag: "FLATTER_OPEN" },
  { action: "maps", flag: "MAPS_OPEN" },
  { action: "exportMasks", flag: "MASKS_OPEN" },
];
export const GATED_ENTITY: ReadonlyArray<{ tool: W7Tool; action: string; flag: GateFlag }> = [
  { tool: "wb_generator", action: "attach", flag: "ATTACH_OPEN" },
  { tool: "wb_generator", action: "detach", flag: "ATTACH_OPEN" },
  { tool: "wb_generator", action: "regenerate", flag: "REGENERATE_OPEN" },
  { tool: "wb_generator", action: "pointData", flag: "POINTDATA_OPEN" },
  { tool: "wb_generator", action: "events", flag: "EVENTS_OPEN" },
  { tool: "wb_shape", action: "edit", flag: "EDIT_OPEN" },
  { tool: "wb_shape", action: "parallel", flag: "PARALLEL_OPEN" },
];

// ── Tiles and terrain maths (pure) ───────────────────────────────────────────

/** The terrain grid as wb_terrain info and one tileRead answer it. */
export interface Grid {
  side: number;
  tilesX: number;
  tilesY: number;
  resX: number;
  resY: number;
  unitScale: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** True when neighbouring tiles share their edge samples (resolution = tiles × (side - 1) + 1). */
export function sharedEdges(g: Grid): boolean {
  return g.resX === g.tilesX * (g.side - 1) + 1;
}

/** A hypothesis of the tile array order (spec 2.1: the order P-W7-01 records). */
export interface Order {
  order: "xMajor" | "zMajor";
  flipZ: boolean;
}
export const ORDERS: readonly Order[] = [
  { order: "xMajor", flipZ: false },
  { order: "xMajor", flipZ: true },
  { order: "zMajor", flipZ: false },
  { order: "zMajor", flipZ: true },
];
export function orderKey(o: Order): string {
  return `${o.order}${o.flipZ ? "+flipZ" : ""}`;
}

/** The world x, z of array cell (row, col) of tile (tx, ty) under one order hypothesis. */
export function sampleWorld(
  g: Grid,
  tx: number,
  ty: number,
  row: number,
  col: number,
  o: Order,
): [number, number] {
  const step = sharedEdges(g) ? g.side - 1 : g.side;
  const [a, b] = o.order === "xMajor" ? [row, col] : [col, row];
  const gx = tx * step + a;
  const gz = ty * step + b;
  const x = g.minX + gx * g.unitScale;
  const z = o.flipZ ? g.maxZ - gz * g.unitScale : g.minZ + gz * g.unitScale;
  return [x, z];
}

/** P-W7-01's corner markers: one cell in from each corner, offsets 1..4 m (never an edge sample). */
export function markerCells(side: number): Array<{ row: number; col: number; offset: number }> {
  const far = side - 2;
  return [
    { row: 1, col: 1, offset: 1 },
    { row: 1, col: far, offset: 2 },
    { row: far, col: 1, offset: 3 },
    { row: far, col: far, offset: 4 },
  ];
}

/** The order hypotheses whose four marker positions moved by exactly the markers' offsets. */
export function orderMatches(
  deltas: Record<string, Array<number | null>>,
  offsets: readonly number[],
  tol = 0.01,
): string[] {
  return Object.entries(deltas)
    .filter(
      ([, d]) =>
        d.length === offsets.length &&
        d.every((v, i) => v !== null && Math.abs(v - offsets[i]) <= tol),
    )
    .map(([k]) => k);
}

/** "r|v v v" rows of a tileRead answer: row index to heights. */
export function parseTileRows(rows: unknown): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const m = /^\s*(\d+)\s*\|(.*)$/.exec(S(r));
    if (!m) continue;
    const v = m[2]
      .trim()
      .split(/\s+/)
      .filter((x) => x !== "")
      .map(Number);
    out.set(Number(m[1]), v);
  }
  return out;
}

/** One tileWrite patch: "tx ty row col|v v ..." (values as text). */
export function patchText(
  tx: number,
  ty: number,
  row: number,
  col: number,
  values: number[],
): string {
  return `${tx} ${ty} ${row} ${col}|${values.map(ftext).join(" ")}`;
}

/** Cells that differ between two tile reads, with their deltas. */
export function tileDiff(
  before: Map<number, number[]>,
  after: Map<number, number[]>,
): Array<{ row: number; col: number; delta: number }> {
  const out: Array<{ row: number; col: number; delta: number }> = [];
  for (const [row, b] of before) {
    const a = after.get(row);
    if (!a) continue;
    for (let col = 0; col < Math.min(a.length, b.length); col++) {
      const d = a[col] - b[col];
      if (Math.abs(d) > CHANGE_EPS) out.push({ row, col, delta: d });
    }
  }
  return out;
}

/** The estimate a write answers, read as numbers (spec 2.1 dry-run estimate). */
export interface Estimate {
  tiles: number | null;
  samples: number | null;
  minDelta: number | null;
  maxDelta: number | null;
  meanDelta: number | null;
}
export function estimateOf(r: Raw): Estimate {
  return {
    tiles: num(r.tiles),
    samples: num(r.samples),
    minDelta: num(r.minDelta),
    maxDelta: num(r.maxDelta),
    meanDelta: num(r.meanDelta),
  };
}

/** The observed change as an estimate: samples changed and their min, max and mean delta. */
export function observedStats(deltas: number[]): Estimate {
  if (!deltas.length)
    return { tiles: null, samples: 0, minDelta: null, maxDelta: null, meanDelta: null };
  const sum = deltas.reduce((s, d) => s + d, 0);
  return {
    tiles: null,
    samples: deltas.length,
    minDelta: Math.min(...deltas),
    maxDelta: Math.max(...deltas),
    meanDelta: sum / deltas.length,
  };
}

/** P-W7-16: the estimate equals the live change (samples exactly, deltas to 1 mm); the misses. */
export function estimateMisses(est: Estimate, seen: Estimate, tol = HEIGHT_TOL): string[] {
  const out: string[] = [];
  if (est.samples !== seen.samples)
    out.push(`samples ${String(est.samples)} vs ${String(seen.samples)}`);
  for (const k of ["minDelta", "maxDelta", "meanDelta"] as const) {
    const a = est[k];
    const b = seen[k];
    if (a === null && b === null) continue;
    if (a === null || b === null || Math.abs(a - b) > tol)
      out.push(`${k} ${String(a)} vs ${String(b)}`);
  }
  return out;
}

/** The tiles a disc of radius r at (x, z) touches, both z orders (order-agnostic). */
export function tilesUnder(g: Grid, x: number, z: number, r: number): Array<[number, number]> {
  const step = (sharedEdges(g) ? g.side - 1 : g.side) * g.unitScale;
  const span = (lo: number, hi: number, n: number): number[] => {
    const a = Math.max(0, Math.floor(lo / step));
    const b = Math.min(n - 1, Math.floor(hi / step));
    const out: number[] = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  };
  const xs = span(x - r - g.minX, x + r - g.minX, g.tilesX);
  const zs = new Set([
    ...span(z - r - g.minZ, z + r - g.minZ, g.tilesY),
    ...span(g.maxZ - (z + r), g.maxZ - (z - r), g.tilesY),
  ]);
  return xs.flatMap((tx) =>
    [...zs].sort((a, b) => a - b).map((ty) => [tx, ty] as [number, number]),
  );
}

/** The .asc path a GATED brush answer names in `next` (branch K2), "" when none. */
export function ascPathOf(r: ToolResponse | null): string {
  const text = `${S(r?.next)} ${S(r?.message)} ${S(rb(r).asc)}`;
  const m = /(\S+\.asc)\b/i.exec(text);
  return m ? m[1].replace(/^['"(]+/, "") : "";
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The plan entry of one tool call: the handler it sends to, the wire action, tool and action. */
export function tc(
  tool: W7Tool,
  action: string,
  params: Raw = {},
  extra: { toolAction?: string; note?: string; target?: string } = {},
): PlanAction {
  const tsOnly = (TS_ONLY_ACTIONS[tool] ?? []).includes(extra.toolAction ?? action);
  return {
    kind: "net-call",
    target:
      extra.target ?? (tsOnly && !extra.toolAction ? `<ts: ${tool} ${action}>` : HANDLER_OF[tool]),
    params: { action, ...params },
    tool,
    toolAction: extra.toolAction ?? action,
    note: extra.note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

export function oc(tool: OfflineTool, action: string, params: Raw = {}): OfflineCall {
  return { tool, action, params: { action, ...params } };
}

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
  "wb_module.save",
  "wb_terrain_edit.exportMasks",
  "wb_terrain_edit.maps",
  "wb_terrain_edit.restore",
]);

/** Edits whose ok answer is one undo point even when the readback names none. */
export const UNDO_EDITS: ReadonlySet<string> = new Set([
  "wb_entity.create",
  "wb_entity.delete",
  "wb_shape.create",
  "wb_shape.area",
]);

const WINDOW_KILL =
  "a new dialog-like window: HANDOFF (H2: the owner closes it, never Save, never OK; the record names the title and the resume); any other new window: STOP; LOST, WEDGED or MODAL_OPEN: STOP";

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

function isOpen(st: ToolResponse, rel: string, sandboxDir: string): boolean {
  return st.ok && worldRelOf(S(rb(st).worldPath), sandboxDir).toLowerCase() === rel.toLowerCase();
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
    const ready = isOpen(st, rel, ctx.opts.sandboxDir);
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

/** Opens `rel` unless it is the open world already. */
async function ensureOpen(
  ctx: StepContext,
  rel: string,
  evidence: Raw,
  fails: string[],
): Promise<boolean> {
  const st = await ctx.tool("wb_world", { action: "state" });
  if (isOpen(st, rel, ctx.opts.sandboxDir)) return true;
  const o = await openWorld(ctx, rel);
  evidence[`open ${rel}`] = o.evidence;
  if (!o.ok) fails.push(`${rel} did not open ('${o.worldPath}')`);
  return o.ok;
}

/** The entity world on disk and registered (`wb_world new` when absent), then open. */
async function ensureEntityWorld(
  ctx: StepContext,
  evidence: Raw,
  fails: string[],
): Promise<boolean> {
  const st = await ctx.tool("wb_world", { action: "state" });
  if (isOpen(st, ENTITY_WORLD, ctx.opts.sandboxDir)) return true;
  const present = ctx.deps.exists(abs(ctx.opts.sandboxDir, ENTITY_WORLD));
  evidence.entityWorldPresent = present;
  if (!present) {
    const dry = await ctx.tool("wb_world", { action: "new", path: ENTITY_WORLD });
    evidence.newDry = brief(dry);
    if (ctx.deps.exists(abs(ctx.opts.sandboxDir, ENTITY_WORLD)))
      fails.push("the world dry run wrote it");
    const made = await ctx.tool("wb_world", { action: "new", path: ENTITY_WORLD, confirm: true });
    evidence.newConfirm = brief(made);
    if (!made.ok) {
      fails.push(`new: ${why(made)}`);
      return false;
    }
  }
  const reg = await ctx.tool("wb_world", { action: "register", path: ENTITY_WORLD });
  evidence.register = brief(reg);
  if (!reg.ok) {
    fails.push(`register: ${why(reg)}`);
    return false;
  }
  return ensureOpen(ctx, ENTITY_WORLD, evidence, fails);
}

function entityWorldPlan(): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc(
      "wb_world",
      "register",
      { path: ENTITY_WORLD },
      { toolAction: "new", note: "offline writer (dry run)" },
    ),
    tc(
      "wb_world",
      "register",
      { path: ENTITY_WORLD, confirm: true },
      { toolAction: "new", note: "offline writer in TS, then register (when absent)" },
    ),
    tc("wb_world", "register", { path: ENTITY_WORLD }),
    ...openPlan(ENTITY_WORLD),
  ];
}

/** The open world's grid: wb_terrain info, then one tileRead row for the tile side. */
async function gridOf(ctx: StepContext, evidence: Raw, fails: string[]): Promise<Grid | null> {
  const info = await ctx.tool("wb_terrain", { action: "info" });
  evidence.terrainInfo = brief(info);
  const r = rb(info);
  const ig = infoGrid(r);
  if (!info.ok || !truthy(r.hasTerrain) || !ig) {
    fails.push(`no terrain: ${info.ok ? "hasTerrain false or no bounds" : why(info)}`);
    return null;
  }
  const t = await ctx.tool("wb_terrain_edit", { action: "tileRead", tileX: 0, tileY: 0, limit: 1 });
  evidence.tileReadSide = brief(t);
  const side = num(rb(t).side);
  const g: Grid = { side: side ?? 0, ...ig };
  if (!t.ok || !side || side < 4 || !g.tilesX || !g.tilesY || !g.unitScale) {
    fails.push(`the grid does not read: ${t.ok ? JSON.stringify(g) : why(t)}`);
    return null;
  }
  // Fix-up 1: the handler names the layout its tile's sample count confirmed; it must agree with
  // the resolution (sharedEdge: res = tiles * (side - 1) + 1; disjoint: res = tiles * side).
  const layout = S(rb(t).layout);
  evidence.tileLayout = layout || null;
  const mismatch = layoutMismatch(g, layout);
  if (mismatch) {
    fails.push(mismatch);
    return null;
  }
  return g;
}

/**
 * The grid fields of a wb_terrain info readback (fix-up 2). The tool reshapes the handler's flat
 * resolutionX/tilesX/boundsMin keys into `resolution: {x, y}`, `tiles: {x, y}` and
 * `bounds: {min, max}` (wb-terrain.ts infoReadback); run 2 read the flat keys and got 0.
 * null when the bounds do not read.
 */
export function infoGrid(r: Raw): Omit<Grid, "side"> | null {
  const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
  const res = obj(r.resolution);
  const tiles = obj(r.tiles);
  const bounds = obj(r.bounds);
  const min = vec3(bounds.min);
  const max = vec3(bounds.max);
  if (!min || !max) return null;
  return {
    tilesX: num(tiles.x) ?? 0,
    tilesY: num(tiles.y) ?? 0,
    resX: num(res.x) ?? 0,
    resY: num(res.y) ?? 0,
    unitScale: num(r.unitScale) ?? 0,
    minX: min[0],
    minZ: min[2],
    maxX: max[0],
    maxZ: max[2],
  };
}

/** "" when the handler's layout agrees with the grid's resolution, else why (fix-up 1). */
export function layoutMismatch(g: Grid, layout: string): string {
  const shared = g.resX === g.tilesX * (g.side - 1) + 1 && g.resY === g.tilesY * (g.side - 1) + 1;
  const disjoint = g.resX === g.tilesX * g.side && g.resY === g.tilesY * g.side;
  const want = shared && disjoint ? "single" : shared ? "sharedEdge" : disjoint ? "disjoint" : "";
  if (!want)
    return `side ${g.side} fits neither layout of ${g.resX}x${g.resY} in ${g.tilesX}x${g.tilesY} tiles`;
  if (layout !== want)
    return `tileRead answered layout '${layout}', ${want} expected from the resolution`;
  return "";
}

function gridPlan(): PlanAction[] {
  return [
    tc("wb_terrain", "info"),
    tc("wb_terrain_edit", "tileRead", { tileX: 0, tileY: 0, limit: 1 }),
  ];
}

/** The rows of one tile (all of them when `want` is null), paged by TILE_PAGE. */
async function readTile(
  ctx: StepContext,
  tx: number,
  ty: number,
  want: ReadonlySet<number> | null = null,
): Promise<{ rows: Map<number, number[]>; error: string | null }> {
  const rows = new Map<number, number[]>();
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await ctx.tool("wb_terrain_edit", {
      action: "tileRead",
      tileX: tx,
      tileY: ty,
      limit: TILE_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    if (!r.ok) return { rows, error: why(r) };
    for (const [k, v] of parseTileRows(rb(r).rows)) rows.set(k, v);
    cursor = S(rb(r).nextCursor);
    if (!cursor) return { rows, error: null };
    if (want && [...want].every((w) => rows.has(w))) return { rows, error: null };
  }
  return { rows, error: `more than ${MAX_PAGES} pages` };
}

function tilePlan(tx: number | string, ty: number | string): PlanAction {
  return tc(
    "wb_terrain_edit",
    "tileRead",
    { tileX: tx, tileY: ty, limit: TILE_PAGE, cursor: "<nextCursor>" },
    { note: "paged until the rows the step needs are read" },
  );
}

/** Heights at "x z" points (wb_terrain heights, max 200); null per point off the terrain. */
async function heights(
  ctx: StepContext,
  pts: Array<[number, number]>,
): Promise<Array<number | null>> {
  const out: Array<number | null> = [];
  for (let i = 0; i < pts.length; i += 200) {
    const chunk = pts.slice(i, i + 200);
    const r = await ctx.tool("wb_terrain", {
      action: "heights",
      points: chunk.map(([x, z]) => `${ftext(x)} ${ftext(z)}`),
    });
    const objs = Array.isArray(rb(r).points) ? (rb(r).points as Raw[]) : null;
    const rows = Array.isArray(rb(r).rows) ? (rb(r).rows as unknown[]) : [];
    chunk.forEach((_, k) => {
      if (objs) {
        const o = objs[k];
        out.push(o && o.onTerrain === true && typeof o.y === "number" ? o.y : null);
        return;
      }
      const parts = S(rows[k]).split("|");
      out.push(parts.length >= 4 && truthy(parts[2]) ? num(parts[3]) : null);
    });
  }
  return out;
}

/**
 * The terrain world open, its grid, and a backup taken in THIS tool session (a resumed run is a new
 * process: the TS tool's NO_BACKUP record is per session, OD-4). Null with the failure written.
 */
async function terrainReady(
  ctx: StepContext,
  evidence: Raw,
  fails: string[],
): Promise<Grid | null> {
  const world = ctx.opts.terrainWorld;
  if (!world || !isTerrainWorldRel(world)) {
    fails.push("no terrain world (OI-W7-1)");
    return null;
  }
  if (!(await ensureOpen(ctx, world, evidence, fails))) return null;
  const cached = ctx.state.get("w7.grid");
  const g = cached ? (JSON.parse(cached) as Grid) : await gridOf(ctx, evidence, fails);
  if (!g) return null;
  ctx.state.set("w7.grid", JSON.stringify(g));
  if (!ctx.state.get("w7.sessionBackup")) {
    const sit = readJson<SittingBackup>(join(ctx.opts.sittingDir, BACKUP_FILE), ctx.deps);
    if (!sit) {
      fails.push(`no ${BACKUP_FILE} in the sitting: run ${"w7-03-terrain-setup"} first`);
      return null;
    }
    const b = await ctx.tool("wb_terrain_edit", { action: "backup", label: "w7-session" });
    evidence.sessionBackup = brief(b);
    if (!b.ok) {
      fails.push(`backup for this tool session: ${why(b)}`);
      return null;
    }
    ctx.state.set("w7.sessionBackup", S(rb(b).backupId) || "taken");
  }
  return g;
}

function terrainPlan(): PlanAction[] {
  return [
    tc("wb_world", "state"),
    ...openPlan(TERRAIN_WORLD_PH),
    ...gridPlan(),
    tc(
      "wb_terrain_edit",
      "backup",
      { label: "w7-session" },
      { note: "TS: once per tool session (OD-4)" },
    ),
  ];
}

/** One entity of `prefab` named W7_<name>; its reference or "" on a refusal. */
async function create(
  ctx: StepContext,
  name: string,
  coords: string,
  prefab = PROP,
): Promise<{ r: ToolResponse; ref: string }> {
  const r = await ctx.tool("wb_entity", {
    action: "create",
    prefab,
    name: `${NAME_PREFIX}${name}`,
    coords,
  });
  return { r, ref: r.ok ? S(rb(r).id) : "" };
}

/** One shape in the open world; its reference or "" on a refusal. */
async function shape(
  ctx: StepContext,
  name: string,
  points: string[],
  o: { closed?: boolean; spline?: boolean } = {},
): Promise<{ r: ToolResponse; ref: string }> {
  const r = await ctx.tool("wb_shape", {
    action: "create",
    points,
    name: `${NAME_PREFIX}${name}`,
    ...(o.closed ? { closed: true } : {}),
    ...(o.spline ? { spline: true } : {}),
  });
  return { r, ref: r.ok ? S(rb(r).id) : "" };
}

/** A 20 m square of four points around (x, z) at height y. */
export function square(x: number, z: number, y = 0, half = 10): string[] {
  return [
    `${x - half} ${y} ${z - half}`,
    `${x + half} ${y} ${z - half}`,
    `${x + half} ${y} ${z + half}`,
    `${x - half} ${y} ${z + half}`,
  ];
}

async function pointsOf(ctx: StepContext, ref: string, extra: Raw = {}): Promise<ToolResponse> {
  return ctx.tool("wb_shape", { action: "points", entity: ref, limit: 200, ...extra });
}

async function entityTotal(ctx: StepContext): Promise<number | null> {
  const r = await ctx.tool("wb_entity", { action: "list", limit: 1 });
  const t = rb(r).total;
  return r.ok && typeof t === "number" ? t : null;
}

/** Pays every undo point the step owes, runs its restorers, checks the entity count. */
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
  if (totalBefore === null) return;
  const after = await entityTotal(ctx);
  evidence.entityTotal = { before: totalBefore, after };
  if (after !== totalBefore)
    fails.push(`the world holds ${String(after)} entities after the undo, ${totalBefore} before`);
}

/** One undo, then the rows read back equal `before` (true) or the cells still changed. */
async function undoAndCompare(
  ctx: StepContext,
  tx: number,
  ty: number,
  before: Map<number, number[]>,
): Promise<{ ok: boolean; undo: UndoResult; left: number }> {
  const u = await ctx.undo();
  const back = await readTile(ctx, tx, ty, new Set(before.keys()));
  const left = tileDiff(before, back.rows).length;
  return { ok: u.ok && !back.error && left === 0, undo: u, left };
}

/** The battery's saved state shared across runs of the sitting. */
export interface SittingBackup {
  backupId: string;
  world: string;
  takenAt: string;
  /** Project-relative (or absolute) path to sha256, hashed by the battery itself. */
  manifest: Record<string, string>;
  files: unknown;
}

/** The files a backup answer names, as absolute paths. */
export function backupPaths(files: unknown, sandboxDir: string): string[] {
  if (!Array.isArray(files)) return [];
  return files
    .map((f) =>
      typeof f === "string"
        ? f
        : f && typeof f === "object"
          ? S((f as Raw).path ?? (f as Raw).file)
          : "",
    )
    .filter((p) => p !== "")
    .map((p) => (isAbsolute(p) ? p : abs(sandboxDir, p.replace(/\\/g, "/"))));
}

/**
 * The files a backup answer covers, as absolute paths, with the tool's own sha256 per path: from
 * the manifest.json the answer names (`readback.manifest`, the shipped form: `files` is a count),
 * else from a `files` list. An unreadable manifest gives no paths (the step fails on it).
 */
export function backupFilesOf(
  readback: Raw,
  sandboxDir: string,
  deps: Pick<W7Deps, "exists" | "readBytes">,
): { paths: string[]; toolHashes: Record<string, string> } {
  if (Array.isArray(readback.files))
    return { paths: backupPaths(readback.files, sandboxDir), toolHashes: {} };
  const mf = S(readback.manifest);
  const m = mf ? readJson<BackupManifest>(mf, deps) : null;
  if (!m || !Array.isArray(m.files)) return { paths: [], toolHashes: {} };
  const toolHashes: Record<string, string> = {};
  for (const f of m.files) toolHashes[abs(sandboxDir, f.rel)] = f.sha256;
  return { paths: Object.keys(toolHashes), toolHashes };
}

/** sha256 of each path; "absent" for a path not on disk. */
export function hashFiles(
  paths: string[],
  deps: Pick<W7Deps, "exists" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    paths.map((p) => [p, deps.exists(p) ? sha256(deps.readBytes(p)) : "absent"]),
  );
}

// ── Hand requests (W1's mechanism) ───────────────────────────────────────────

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
    if (ctx.deps.now() - started + TIMEOUTS.windowPoll > HAND_WAIT_MS) return null;
    await ctx.deps.sleep(TIMEOUTS.windowPoll);
  }
}

// ── Net-zero (the battery's own snapshot, outside _throwaway/W7/) ────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  root: string;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W7Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W7_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W7Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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

export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W7Deps, "exists" | "readBytes" | "listTree">,
): { takenBy: string; takenAt: string; changed: string[] } | null {
  const snap = readJson<BatterySnapshot>(join(sittingDir, BATTERY_SNAPSHOT_FILE), deps);
  if (!snap || snap.kind !== BATTERY_SNAPSHOT_KIND || typeof snap.files !== "object") return null;
  const before = Object.fromEntries(
    Object.entries(snap.files).filter(([f]) => !f.startsWith(`${W7_ROOT}/`)),
  );
  return {
    takenBy: S(snap.taken_by),
    takenAt: S(snap.taken_at),
    changed: changedFiles(before, sandboxHashes(sandboxDir, deps)),
  };
}

/** The terrain files now against the battery's manifest: the paths that differ. */
export function manifestMismatch(
  backup: SittingBackup,
  deps: Pick<W7Deps, "exists" | "readBytes">,
): string[] {
  const now = hashFiles(Object.keys(backup.manifest), deps);
  return changedFiles(backup.manifest, now);
}

// ── Step bodies shared by several steps ──────────────────────────────────────

/** A write call: the dry run, then (unless it refused) the confirm; with the tile check around both. */
async function dryThenConfirm(
  ctx: StepContext,
  args: Raw,
  evidence: Raw,
  key: string,
): Promise<{ dry: ToolResponse; conf: ToolResponse | null }> {
  const dry = await ctx.tool("wb_terrain_edit", args);
  evidence[`${key}Dry`] = brief(dry);
  if (!dry.ok && dry.code !== "GATED") return { dry, conf: null };
  const conf = await ctx.tool("wb_terrain_edit", { ...args, confirm: true });
  evidence[`${key}Confirm`] = brief(conf);
  return { dry, conf };
}

/** Choose a tile one in from the corner when the terrain has one. */
function interiorTile(g: Grid): [number, number] {
  return [Math.min(1, g.tilesX - 1), Math.min(1, g.tilesY - 1)];
}

/** P-W7-01's marker write: before rows, patches, candidate points. */
function markerPatches(
  g: Grid,
  tx: number,
  ty: number,
  before: Map<number, number[]>,
): { patches: string[]; cells: ReturnType<typeof markerCells> } | null {
  const cells = markerCells(g.side);
  const patches: string[] = [];
  for (const c of cells) {
    const row = before.get(c.row);
    if (!row || row.length <= c.col) return null;
    patches.push(patchText(tx, ty, c.row, c.col, [row[c.col] + c.offset]));
  }
  return { patches, cells };
}

/** The write landed: every marker cell holds before + offset, nothing else in those rows moved. */
function markersLanded(
  cells: ReturnType<typeof markerCells>,
  before: Map<number, number[]>,
  after: Map<number, number[]>,
): { ok: boolean; why: string } {
  const diff = tileDiff(before, after);
  const want = new Map(cells.map((c) => [`${c.row},${c.col}`, c.offset]));
  for (const d of diff) {
    const off = want.get(`${d.row},${d.col}`);
    if (off === undefined)
      return { ok: false, why: `cell ${d.row},${d.col} moved by ${ftext(d.delta)}` };
    if (Math.abs(d.delta - off) > HEIGHT_TOL)
      return { ok: false, why: `marker ${d.row},${d.col} moved ${ftext(d.delta)}, ${off} written` };
  }
  if (diff.length !== cells.length)
    return { ok: false, why: `${diff.length} of ${cells.length} markers moved` };
  return { ok: true, why: "" };
}

// ── Steps ────────────────────────────────────────────────────────────────────

export function buildSteps(): StepDef[] {
  return [
    // ── W7.0 setup ──
    {
      id: GATE_STEP,
      block: "W7.0",
      title:
        "the test-bed gate: EMCP_WB_Info names the test bed, build stamp, plant record, snapshot; the owner items read",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; ${PLANT_FILE} is in the sitting; the evidence names which owner items are present`,
      kill_criterion:
        "not the test bed: ABORTED, nothing else runs; a stamp mismatch or no plant record: STOPPED",
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
        const projectName = info ? info.projectName : undefined;
        const found = truthy(info ? info.projectFound : undefined);
        const evidence: Raw = { info, projectName };
        // The test-bed check lives here, in the battery, never in a shipped handler (DEC-058).
        if (!found || projectName !== SANDBOX_NAME)
          throw new StopBattery(
            "aborted",
            `EMCP_WB_Info does not say projectFound with projectName ${SANDBOX_NAME}: not the live lane's test bed`,
            evidence,
          );
        const ping = await ctx.deps.ping();
        const stamp = S(ping ? ping.buildStamp : "");
        const digest = ctx.deps.bundleDigest();
        evidence.stamp = stamp || null;
        evidence.digest = digest;
        if (!stamp || !digest || stamp !== digest)
          throw new StopBattery(
            "stopped",
            "the build stamp does not match the bundle digest",
            evidence,
          );
        if (!ctx.deps.exists(join(ctx.opts.sittingDir, PLANT_FILE)))
          throw new StopBattery(
            "stopped",
            `no ${PLANT_FILE} in the sitting: run \`w7.live.ts plant\` first`,
            evidence,
          );
        const oi = ownerInput(ctx.opts, ctx.deps);
        evidence.owner = {
          terrainWorld: oi.terrainWorld,
          "OI-W7-1": ownerBlock(["OI-W7-1"], oi) ?? "present",
          "OI-W7-2": ownerBlock(TERRAIN_GO, oi) ?? "present",
          goLine: ownerGoOf(oi.logText, oi.terrainWorld).line,
        };
        evidence.gates = gateFlagsOf(ctx.deps.handlerSource);
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
      },
    },
    {
      id: "w7-01-handlers",
      block: "W7.0",
      title:
        "the three W7 handlers answer: TerrainEdit, Generator, Shape (a read or a domain refusal each)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "tileRead of tile 0,0, generator list and shape points of a missing entity answer ok or a domain refusal (NO_WORLD, NO_TERRAIN, ENTITY_NOT_FOUND ...), never an unknown handler",
      kill_criterion:
        "a handler does not answer (UNREACHABLE, HANDLER_ERROR, an unknown handler) or a TS tool module is missing: FAIL; the WorkbenchGame module did not compile it (DEC-035) and its steps cannot pass",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_terrain_edit", "tileRead", { tileX: 0, tileY: 0, limit: 1 }),
        tc("wb_generator", "list", { limit: 1 }),
        tc("wb_shape", "points", { entity: "name:W7_missing" }),
      ],
      run: async (ctx) => {
        const calls: Array<[string, ToolResponse]> = [
          [
            "wb_terrain_edit.tileRead",
            await ctx.tool("wb_terrain_edit", { action: "tileRead", tileX: 0, tileY: 0, limit: 1 }),
          ],
          ["wb_generator.list", await ctx.tool("wb_generator", { action: "list", limit: 1 })],
          [
            "wb_shape.points",
            await ctx.tool("wb_shape", { action: "points", entity: "name:W7_missing" }),
          ],
        ];
        const evidence: Raw = Object.fromEntries(calls.map(([k, r]) => [k, brief(r)]));
        const dead = calls.filter(([, r]) => !r.ok && !DOMAIN_CODES.has(S(r.code)));
        return {
          ...verdictOf(
            dead.map(([k, r]) => `${k} gave no handler answer (${S(r.code)} ${S(r.message)})`),
            [],
            "TerrainEdit, Generator and Shape answer",
          ),
          evidence,
        };
      },
    },
    {
      id: "w7-02-entity-world",
      block: "W7.0",
      title:
        "the entity world: wb_world new (dry run, then confirm) under _throwaway/W7/worlds/, register, open",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected:
        "the dry run writes nothing; new writes the .ent; register answers; the World Editor opens it in edit mode",
      kill_criterion: `the world does not open: FAIL, and every entity step stops on its own ensureEntityWorld; ${WINDOW_KILL}`,
      side_effects: [`${ENTITY_WORLD} and its layers written`],
      rollback: "`w7.live.ts rollback` removes _throwaway/W7/worlds/ after Workbench is closed",
      probes: [],
      writes: [WORLDS_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => entityWorldPlan(),
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const ok = await ensureEntityWorld(ctx, evidence, fails);
        const st = await ctx.tool("wb_world", { action: "state" });
        evidence.state = brief(st);
        if (ok && S(rb(st).mode) && S(rb(st).mode) !== "edit") fails.push(`mode ${S(rb(st).mode)}`);
        return { ...verdictOf(fails, [], `${ENTITY_WORLD} open`), evidence };
      },
    },
    {
      id: "w7-03-terrain-setup",
      block: "W7.0",
      title:
        "the terrain world (OI-W7-1): open, hasTerrain, its file set (P-W7-03), wb_terrain_edit backup and the battery's sha256 manifest",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected:
        "the world opens with hasTerrain; backup answers a backupId and its files; every file of the world's folder is in the backup (P-W7-03); the battery hashes each backed-up file into <sitting>/w7-backup.json (kept until restore passes)",
      kill_criterion: `no terrain or the backup refuses: FAIL (no terrain write runs: each needs the sitting backup); P-W7-03: a world file the backup leaves out: KILLED (the 8 backup rows re-point W8); ${WINDOW_KILL}`,
      side_effects: [
        "a backup copy in the artifacts folder (TS: terrain-backup/<world>/<backupId>/)",
        `<sitting>/${BACKUP_FILE}`,
      ],
      rollback: "none in the project (a copy out); the backup is kept until W7.7 restore passes",
      probes: ["P-W7-03"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_world", "state"),
        ...openPlan(TERRAIN_WORLD_PH),
        ...gridPlan(),
        tc(
          "wb_terrain_edit",
          "backup",
          { label: "w7-sitting" },
          { note: "TS: copies the terrain file set out, no handler call" },
        ),
      ],
      offlineCalls: () => [
        oc("fs", "list", { path: `${W7_ROOT}/<terrain world folder>`, readOnly: true }),
        oc("fs", "hash", { path: "<backup files>", readOnly: true }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const world = ctx.opts.terrainWorld!;
        if (!(await ensureOpen(ctx, world, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const g = await gridOf(ctx, evidence, fails);
        if (!g) return { ...verdictOf(fails, [], ""), evidence };
        ctx.state.set("w7.grid", JSON.stringify(g));
        const existing = readJson<SittingBackup>(join(ctx.opts.sittingDir, BACKUP_FILE), ctx.deps);
        const b = await ctx.tool("wb_terrain_edit", {
          action: "backup",
          label: existing ? "w7-session" : "w7-sitting",
        });
        evidence.backup = brief(b);
        if (!b.ok) {
          fails.push(`backup: ${why(b)}`);
          return { ...verdictOf(fails, [], ""), evidence };
        }
        ctx.state.set("w7.sessionBackup", S(rb(b).backupId) || "taken");
        const { paths, toolHashes } = backupFilesOf(rb(b), ctx.opts.sandboxDir, ctx.deps);
        if (!S(rb(b).backupId) || paths.length === 0)
          fails.push("backup named no backupId or no files (its manifest.json read)");
        // The tool's manifest against the battery's own hash of the same files on disk.
        const own = hashFiles(paths, ctx.deps);
        const offManifest = Object.keys(toolHashes).filter((p) => toolHashes[p] !== own[p]);
        if (offManifest.length)
          fails.push(
            `the backup's manifest disagrees with the files on disk: ${offManifest.length}`,
          );
        // P-W7-03: the files of the world's folder against what the backup copied.
        const folderRel = world.split("/").slice(0, -1).join("/");
        const listing = ctx.deps
          .listTree(abs(ctx.opts.sandboxDir, folderRel))
          .filter((f) => !f.toLowerCase().endsWith(".meta"))
          .map((f) => abs(ctx.opts.sandboxDir, `${folderRel}/${f}`));
        const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
        const covered = new Set(paths.map(norm));
        const left = listing.filter((p) => !covered.has(norm(p)));
        const observed = {
          folder: folderRel,
          onDisk: listing.map((p) => toPlaceholders(p, ctx.opts.ph)),
          backedUp: paths.map((p) => toPlaceholders(p, ctx.opts.ph)),
          leftOut: left.map((p) => toPlaceholders(p, ctx.opts.ph)),
        };
        const p3 = left.length
          ? killed(
              "P-W7-03",
              observed,
              `the backup leaves out ${left.length} file(s) of the world's folder`,
            )
          : settled(
              "P-W7-03",
              observed,
              `${paths.length} file(s) backed up; the folder holds nothing else`,
            );
        if (!existing) {
          const rec: SittingBackup = {
            backupId: S(rb(b).backupId),
            world,
            takenAt: new Date(ctx.deps.now()).toISOString(),
            manifest: own,
            files: rb(b).files ?? null,
          };
          writeJson(join(ctx.opts.sittingDir, BACKUP_FILE), rec, ctx.deps);
          evidence.manifest = Object.keys(rec.manifest).length;
        } else evidence.sittingBackup = existing.backupId;
        return {
          ...verdictOf(fails, [p3], `backup ${S(rb(b).backupId)}: ${paths.length} file(s)`),
          evidence,
          probes: [p3],
        };
      },
    },

    // ── W7.1 reads ──
    {
      id: "w7-10-vanilla-reads",
      block: "W7.1",
      title:
        "vanilla EmptyArland opened read-only (never saved): tileRead of two neighbouring tiles against wb_terrain tile; the Bohemia reads (P-W7-05)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected:
        "tileRead answers side, rows and the layout its sample count confirms (sharedEdge or disjoint, agreeing with the resolution); the first two rows of tiles 0,0 and 1,0 equal wb_terrain tile's first samples to 1 mm; GetTerrainInfo, GetTileHeightmap and GetSurfaceMaterials agree with wb_terrain (or answer NOT_ALLOWLISTED with nothing sent while VERIFIED_READ lacks them)",
      kill_criterion: `tileRead differs from wb_terrain tile: FAIL (the read half of P-W7-01); P-W7-05: a Bohemia read disagrees: KILLED (stays T2); ${WINDOW_KILL}`,
      side_effects: ["the World Editor loads EmptyArland (read only, never saved)"],
      rollback: "none: nothing is edited",
      probes: ["P-W7-05"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_world", "state"),
        ...openPlan(VANILLA_WORLD),
        ...gridPlan(),
        tilePlan(0, 0),
        tilePlan(1, 0),
        tc("wb_terrain", "tile", { tileX: 0, tileY: 0, limit: 200, cursor: "<nextCursor>" }),
        tc("wb_terrain", "tile", { tileX: 1, tileY: 0, limit: 200, cursor: "<nextCursor>" }),
        ...biPlan(),
      ],
      run: async (ctx) => readsBody(ctx, VANILLA_WORLD, false),
    },
    {
      id: "w7-11-throwaway-reads",
      block: "W7.1",
      title:
        "the same reads on the throwaway terrain world (OI-W7-1); its rows kept for the W7.7 read-back",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected: `as w7-10 on the terrain world; the first rows of tiles 0,0 and 1,0 written to <sitting>/${BEFORE_FILE}`,
      kill_criterion: `as w7-10; ${WINDOW_KILL}`,
      side_effects: [`<sitting>/${BEFORE_FILE} (first run of the sitting only)`],
      rollback: "none: nothing is edited",
      probes: ["P-W7-05"],
      owner: ["OI-W7-1"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_world", "state"),
        ...openPlan(TERRAIN_WORLD_PH),
        ...gridPlan(),
        tilePlan(0, 0),
        tilePlan(1, 0),
        tc("wb_terrain", "tile", { tileX: 0, tileY: 0, limit: 200, cursor: "<nextCursor>" }),
        tc("wb_terrain", "tile", { tileX: 1, tileY: 0, limit: 200, cursor: "<nextCursor>" }),
        ...biPlan(),
      ],
      run: async (ctx) => readsBody(ctx, ctx.opts.terrainWorld!, true),
    },
    {
      id: "w7-12-entity-reads",
      block: "W7.1",
      title:
        "the entity world: a closed polyline and a spline made, wb_shape points with tesselated and tangents, wb_generator list; both shapes undone",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "points answers the points; tesselated answers at least as many points; the spline answers tangents 'in|out' per point; generator list answers rows, total and eventsEnabled; the entity count is back after the undo",
      kill_criterion: `a read refuses: FAIL; ${WINDOW_KILL}`,
      side_effects: ["two shapes in memory, undone"],
      rollback: "Edit > Undo per create; the entity count is checked",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_shape", "create", {
          points: "<4 points>",
          closed: true,
          name: `${NAME_PREFIX}Poly`,
        }),
        tc("wb_shape", "create", {
          points: "<4 points>",
          spline: true,
          name: `${NAME_PREFIX}Spline`,
        }),
        tc("wb_shape", "points", { entity: "<poly>", limit: 200 }),
        tc("wb_shape", "points", { entity: "<poly>", limit: 200, tesselated: true }),
        tc("wb_shape", "points", { entity: "<spline>", limit: 200 }),
        tc("wb_shape", "points", { entity: "<spline>", limit: 200, tesselated: true }),
        tc("wb_generator", "list", { limit: 50 }),
        tc("wb_generator", "list", { shape: "<poly>", limit: 50 }),
        ...undoPlan(2),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureEntityWorld(ctx, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const before = await entityTotal(ctx);
        const poly = await shape(ctx, "Poly", square(0, 0), { closed: true });
        const spl = await shape(ctx, "Spline", square(40, 0), { spline: true });
        evidence.create = { poly: brief(poly.r), spline: brief(spl.r) };
        if (!poly.ref || !spl.ref) fails.push("a shape create refused");
        else {
          const p = await pointsOf(ctx, poly.ref);
          const pt = await pointsOf(ctx, poly.ref, { tesselated: true });
          const s = await pointsOf(ctx, spl.ref);
          const st = await pointsOf(ctx, spl.ref, { tesselated: true });
          evidence.points = {
            poly: brief(p),
            polyTess: brief(pt),
            spline: brief(s),
            splineTess: brief(st),
          };
          const count = (r: ToolResponse) =>
            Array.isArray(rb(r).points) ? (rb(r).points as unknown[]).length : -1;
          if (!p.ok || count(p) !== 4) fails.push(`poly points: ${p.ok ? count(p) : why(p)}`);
          if (!pt.ok || count(pt) < 4)
            fails.push(`poly tesselated: ${pt.ok ? count(pt) : why(pt)}`);
          const tangents = Array.isArray(rb(s).tangents) ? (rb(s).tangents as unknown[]) : [];
          if (!s.ok || tangents.length !== 4 || !tangents.every((t) => S(t).includes("|")))
            fails.push(`spline tangents: ${s.ok ? JSON.stringify(tangents) : why(s)}`);
          if (!st.ok || count(st) < 4)
            fails.push(`spline tesselated: ${st.ok ? count(st) : why(st)}`);
          const all = await ctx.tool("wb_generator", { action: "list", limit: 50 });
          const one = await ctx.tool("wb_generator", {
            action: "list",
            shape: poly.ref,
            limit: 50,
          });
          evidence.generators = { all: brief(all), shape: brief(one) };
          if (!all.ok || typeof rb(all).total !== "number")
            fails.push(`generator list: ${why(all)}`);
          if (all.ok && rb(all).eventsEnabled === undefined)
            fails.push("generator list answers no eventsEnabled");
          if (!one.ok) fails.push(`generator list of a shape: ${why(one)}`);
        }
        await settle(ctx, evidence, fails, before);
        return {
          ...verdictOf(fails, [], "points, tesselated, tangents and generator list read"),
          evidence,
        };
      },
    },

    // ── W7.2 refusals (no write happens) ──
    {
      id: "w7-20-estimate",
      block: "W7.2",
      title:
        "tileWrite without confirm on the terrain world (OI-W7-1): an estimate, and the tile unchanged",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected:
        "dryRun true; tiles 1, samples 4, minDelta 1, maxDelta 4, meanDelta 2.5 (as text); the rows read back equal before; no undo point",
      kill_criterion: `the dry run changes a sample or answers other numbers: FAIL; ${WINDOW_KILL}`,
      side_effects: [],
      rollback: "none: the dry run writes nothing",
      probes: [],
      owner: ["OI-W7-1"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_world", "state"),
        ...openPlan(TERRAIN_WORLD_PH),
        ...gridPlan(),
        tilePlan("<tx>", "<ty>"),
        tc(
          "wb_terrain_edit",
          "tileWrite",
          { patches: "<4 markers>", undoLabel: "estimate" },
          { note: "dry run: no confirm" },
        ),
        tilePlan("<tx>", "<ty>"),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureOpen(ctx, ctx.opts.terrainWorld!, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const g = await gridOf(ctx, evidence, fails);
        if (!g) return { ...verdictOf(fails, [], ""), evidence };
        const [tx, ty] = interiorTile(g);
        const want = new Set([1, g.side - 2]);
        const before = await readTile(ctx, tx, ty, want);
        const mk = before.error ? null : markerPatches(g, tx, ty, before.rows);
        if (!mk) {
          fails.push(`the marker rows do not read: ${S(before.error)}`);
          return { ...verdictOf(fails, [], ""), evidence };
        }
        const dry = await ctx.tool("wb_terrain_edit", {
          action: "tileWrite",
          patches: mk.patches,
          undoLabel: "estimate",
        });
        evidence.dry = brief(dry);
        const after = await readTile(ctx, tx, ty, want);
        const moved = tileDiff(before.rows, after.rows);
        if (moved.length) fails.push(`the dry run changed ${moved.length} sample(s)`);
        if (!dry.ok) fails.push(`dry run: ${why(dry)}`);
        else {
          const e = estimateOf(rb(dry));
          if (!truthy(rb(dry).dryRun)) fails.push("dryRun is not true");
          const misses = estimateMisses(e, {
            tiles: null,
            samples: 4,
            minDelta: 1,
            maxDelta: 4,
            meanDelta: 2.5,
          });
          if (misses.length) fails.push(`estimate: ${misses.join(", ")}`);
          if (e.tiles !== 1) fails.push(`tiles ${String(e.tiles)}`);
          if (S(rb(dry).undoName)) fails.push("the dry run answered an undoName");
        }
        return { ...verdictOf(fails, [], "estimate right, tile unchanged"), evidence };
      },
    },
    {
      id: "w7-21-not-in-project",
      block: "W7.2",
      title:
        "vanilla EmptyArland opened read only: the dry runs of tileWrite, flatter, maps and exportMasks answer NOT_IN_PROJECT (no confirm is ever sent there)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected:
        "each dry run answers NOT_IN_PROJECT; nothing is written; no confirmed call is sent (the harness guard would stop the battery)",
      kill_criterion: `a dry run answers ok on a vanilla world: FAIL (the world-in-project check is missing); ${WINDOW_KILL}`,
      side_effects: ["the World Editor loads EmptyArland (read only, never saved)"],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_world", "state"),
        ...openPlan(VANILLA_WORLD),
        tc("wb_terrain_edit", "tileWrite", { patches: ["0 0 1 1|0.0000"] }, { note: "dry run" }),
        tc(
          "wb_terrain_edit",
          "flatter",
          { op: "remove", entity: "name:W7_none" },
          { note: "dry run" },
        ),
        tc("wb_terrain_edit", "maps", { kind: "shore" }, { note: "dry run" }),
        tc(
          "wb_terrain_edit",
          "exportMasks",
          { directory: `${MASKS_DIR}/vanilla` },
          { note: "dry run" },
        ),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureOpen(ctx, VANILLA_WORLD, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const calls: Array<[string, Raw]> = [
          ["tileWrite", { action: "tileWrite", patches: ["0 0 1 1|0.0000"] }],
          ["flatter", { action: "flatter", op: "remove", entity: "name:W7_none" }],
          ["maps", { action: "maps", kind: "shore" }],
          ["exportMasks", { action: "exportMasks", directory: `${MASKS_DIR}/vanilla` }],
        ];
        for (const [k, a] of calls) {
          const r = await ctx.tool("wb_terrain_edit", a);
          evidence[k] = brief(r);
          if (r.ok || r.code !== "NOT_IN_PROJECT") {
            // exportMasks takes a project folder, not the open world: its dry run may answer ok.
            if (!(k === "exportMasks" && r.ok)) fails.push(`${k}: ${r.ok ? "ok" : why(r)}`);
          }
        }
        if (ctx.deps.exists(abs(ctx.opts.sandboxDir, `${MASKS_DIR}/vanilla`)))
          fails.push("the exportMasks dry run wrote");
        return { ...verdictOf(fails, [], "NOT_IN_PROJECT on the vanilla world"), evidence };
      },
    },
    {
      id: "w7-22-wrong-mode",
      block: "W7.2",
      title:
        "play mode on the entity world: wb_generator events and wb_shape edit answer WRONG_MODE (GATED while the gate is closed); stop",
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the entity world saved (only it), play answers, each call answers WRONG_MODE with nothing changed (GATED while its gate flag is false: the gate is checked first, WRONG_MODE recorded as not yet proven for it), stop returns to edit mode",
      kill_criterion: `a call answers ok in play, or anything but WRONG_MODE with its gate open: FAIL; play or stop refuses: FAIL; ${WINDOW_KILL}`,
      side_effects: [`${ENTITY_WORLD} saved before play (only that world)`],
      rollback: "wb_world stop (a restorer owed from before play)",
      probes: [],
      writes: [WORLDS_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_world", "state"),
        tc(
          "wb_module",
          "save",
          { moduleName: "WorldEditor", confirm: true, path: ENTITY_WORLD },
          { note: `sent only while ${ENTITY_WORLD} is open` },
        ),
        tc("wb_world", "play", { debugMode: false, fullScreen: false }),
        tc("wb_world", "state"),
        tc("wb_generator", "events", { enabled: false }),
        tc("wb_shape", "edit", { entity: "name:W7_none", op: "close" }),
        tc("wb_world", "stop"),
        tc("wb_world", "state"),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const unproven: string[] = [];
        if (!(await ensureEntityWorld(ctx, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const st = await ctx.tool("wb_world", { action: "state" });
        if (isOpen(st, ENTITY_WORLD, ctx.opts.sandboxDir)) {
          const sv = await ctx.tool("wb_module", {
            action: "save",
            module: "WorldEditor",
            confirm: true,
          });
          evidence.save = brief(sv);
          ctx.debt.undos = 0;
        }
        const owed = {
          label: "wb_world stop",
          fn: () => ctx.deps.tool("wb_world", { action: "stop" }),
        };
        ctx.debt.restorers.push(owed);
        let stop: ToolResponse | null = null;
        try {
          const play = await ctx.tool("wb_world", {
            action: "play",
            debugMode: false,
            fullScreen: false,
          });
          evidence.play = brief(play);
          if (!play.ok) fails.push(`play: ${why(play)}`);
          else {
            evidence.during = brief(await ctx.tool("wb_world", { action: "state" }));
            const ev = await ctx.tool("wb_generator", { action: "events", enabled: false });
            const ed = await ctx.tool("wb_shape", {
              action: "edit",
              entity: "name:W7_none",
              op: "close",
            });
            evidence.events = brief(ev);
            evidence.edit = brief(ed);
            // Fix-up 2: a closed gate answers GATED before the mode check (every W7 handler checks
            // its flag first; nothing engine-side is touched), so GATED is accepted while the flag
            // is false and WRONG_MODE stays unproven for that action. An open flag needs WRONG_MODE.
            const flags = gateFlagsOf(ctx.deps.handlerSource);
            evidence.flags = { EVENTS_OPEN: flags.EVENTS_OPEN, EDIT_OPEN: flags.EDIT_OPEN };
            const wm = wrongModeCheck(
              [
                { key: "events", flag: "EVENTS_OPEN", r: ev },
                { key: "edit", flag: "EDIT_OPEN", r: ed },
              ],
              flags,
            );
            fails.push(...wm.fails);
            unproven.push(...wm.unproven);
            evidence.wrongModeUnproven = wm.unproven;
          }
        } finally {
          if (!ctx.signal.aborted) {
            stop = await ctx.tool("wb_world", { action: "stop" }, { restore: true });
            const i = ctx.debt.restorers.indexOf(owed);
            if (i >= 0) ctx.debt.restorers.splice(i, 1);
          }
        }
        evidence.stop = brief(stop);
        const after = await ctx.tool("wb_world", { action: "state" });
        evidence.after = brief(after);
        if (S(rb(after).mode) && S(rb(after).mode) !== "edit")
          fails.push(`mode ${S(rb(after).mode)} after stop`);
        return {
          ...verdictOf(
            fails,
            [],
            unproven.length
              ? `GATED in play while the gate is closed; WRONG_MODE not yet proven for ${unproven.join(", ")}`
              : "WRONG_MODE in play",
          ),
          evidence,
        };
      },
    },
    {
      id: "w7-23-no-backup",
      block: "W7.2",
      title:
        "a confirmed tileWrite in a FRESH tool session before any backup answers NO_BACKUP (GATED while the route is closed)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected:
        "NO_BACKUP (or GATED while TERRAIN_WRITE_OPEN is false or terrain_write_route is absent: recorded); the tile unchanged",
      kill_criterion: `the fresh session writes: FAIL (undone at once); ${WINDOW_KILL}`,
      side_effects: [],
      rollback: "Edit > Undo if anything was written (it must not be)",
      probes: [],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tilePlan("<tx>", "<ty>"),
        tc(
          "wb_terrain_edit",
          "tileWrite",
          { patches: "<4 markers>", confirm: true },
          { note: "a fresh TS tool session: no backup recorded" },
        ),
        tilePlan("<tx>", "<ty>"),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const g = await terrainReady(ctx, evidence, fails);
        if (!g) return { ...verdictOf(fails, [], ""), evidence };
        const [tx, ty] = interiorTile(g);
        const want = new Set([1, g.side - 2]);
        const before = await readTile(ctx, tx, ty, want);
        const mk = before.error ? null : markerPatches(g, tx, ty, before.rows);
        if (!mk)
          return {
            status: "FAIL",
            detail: `the marker rows do not read: ${S(before.error)}`,
            evidence,
          };
        const r = await ctx.tool(
          "wb_terrain_edit",
          { action: "tileWrite", patches: mk.patches, undoLabel: "no-backup", confirm: true },
          { freshSession: true },
        );
        evidence.write = brief(r);
        const after = await readTile(ctx, tx, ty, want);
        const moved = tileDiff(before.rows, after.rows).length;
        if (r.ok || moved) {
          fails.push(`the fresh session wrote (${moved} sample(s) moved)`);
          await settle(ctx, evidence, fails, null);
        } else if (r.code !== "NO_BACKUP" && r.code !== "GATED") fails.push(`answered ${why(r)}`);
        return {
          ...verdictOf(
            fails,
            [],
            r.code === "NO_BACKUP" ? "NO_BACKUP" : `GATED before the backup check: ${S(r.message)}`,
          ),
          evidence,
        };
      },
    },
    {
      id: "w7-24-gated-terrain",
      block: "W7.2",
      title:
        "each terrain write whose flag is false answers GATED on confirm (the throwaway terrain world)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 180_000,
      expected:
        "for each of tileWrite, brush, flatter, maps, exportMasks whose handler flag reads false: the confirm answers GATED with nothing written; open flags are left to their probe step",
      kill_criterion: `a closed flag's confirm answers ok: FAIL (undone where it can be); ${WINDOW_KILL}`,
      side_effects: ["one box prop in memory for flatter, undone"],
      rollback: "Edit > Undo per create; the entity count is checked",
      probes: [],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_entity", "create", { prefab: PROP, name: `${NAME_PREFIX}Gate`, coords: "<x y z>" }),
        tilePlan("<tx>", "<ty>"),
        tc(
          "wb_terrain_edit",
          "tileWrite",
          { patches: "<1 cell>", confirm: true },
          { note: "only while TERRAIN_WRITE_OPEN is false" },
        ),
        tc(
          "wb_terrain_edit",
          "tileWrite",
          { patches: "<brush tiles>", confirm: true },
          { toolAction: "brush", note: "only while TERRAIN_WRITE_OPEN is false" },
        ),
        tc(
          "wb_terrain_edit",
          "flatter",
          { op: "add", entity: "<box>", confirm: true },
          { note: "only while FLATTER_OPEN is false" },
        ),
        tc(
          "wb_terrain_edit",
          "maps",
          { kind: "shore", confirm: true },
          { note: "only while MAPS_OPEN is false" },
        ),
        tc(
          "wb_terrain_edit",
          "exportMasks",
          { directory: `${MASKS_DIR}/gated`, confirm: true },
          { note: "only while MASKS_OPEN is false" },
        ),
        ...undoPlan(1),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const g = await terrainReady(ctx, evidence, fails);
        if (!g) return { ...verdictOf(fails, [], ""), evidence };
        const flags = gateFlagsOf(ctx.deps.handlerSource);
        evidence.flags = flags;
        const totalBefore = await entityTotal(ctx);
        const cx = (g.minX + g.maxX) / 2;
        const cz = (g.minZ + g.maxZ) / 2;
        const [h] = await heights(ctx, [[cx, cz]]);
        const box = await create(ctx, "Gate", `${ftext(cx)} ${ftext(h ?? 0)} ${ftext(cz)}`);
        const [tx, ty] = interiorTile(g);
        const before = await readTile(ctx, tx, ty, new Set([1]));
        const v = before.rows.get(1);
        const answers: Raw = {};
        for (const ga of GATED_TERRAIN) {
          if (flags[ga.flag] !== false) {
            answers[ga.action] = `not sent: ${ga.flag} is ${String(flags[ga.flag])}`;
            continue;
          }
          const args: Raw =
            ga.action === "tileWrite"
              ? {
                  action: "tileWrite",
                  patches: [patchText(tx, ty, 1, 1, [(v ? v[1] : 0) + 0.5])],
                  confirm: true,
                }
              : ga.action === "brush"
                ? {
                    action: "brush",
                    mode: "sculpt",
                    centre: `${ftext(cx)} ${ftext(cz)}`,
                    radius: "4",
                    delta: "0.5",
                    confirm: true,
                  }
                : ga.action === "flatter"
                  ? {
                      action: "flatter",
                      op: "add",
                      entity: box.ref || "name:W7_Gate",
                      mins: "-1 -1 -1",
                      maxs: "1 1 1",
                      confirm: true,
                    }
                  : ga.action === "maps"
                    ? { action: "maps", kind: "shore", confirm: true }
                    : { action: "exportMasks", directory: `${MASKS_DIR}/gated`, confirm: true };
          const r = await ctx.tool("wb_terrain_edit", args);
          answers[ga.action] = brief(r);
          if (r.ok) fails.push(`${ga.action}: ok with ${ga.flag} false`);
          else if (r.code !== "GATED") fails.push(`${ga.action}: ${why(r)}`);
        }
        evidence.answers = answers;
        const after = await readTile(ctx, tx, ty, new Set([1]));
        const moved = tileDiff(before.rows, after.rows).length;
        if (moved) fails.push(`${moved} sample(s) moved`);
        await settle(ctx, evidence, fails, totalBefore);
        return { ...verdictOf(fails, [], "every closed terrain gate answers GATED"), evidence };
      },
    },
    {
      id: "w7-25-gated-entity",
      block: "W7.2",
      title: "each generator and shape action whose flag is false answers GATED (the entity world)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "attach, detach, regenerate, pointData, events, wb_shape edit and parallel: GATED for each closed flag, nothing changed; open flags left to their probe steps",
      kill_criterion: `a closed flag's call answers ok: FAIL (undone); ${WINDOW_KILL}`,
      side_effects: ["one closed polyline in memory, undone"],
      rollback: "Edit > Undo per create; the entity count is checked",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_shape", "create", {
          points: "<4 points>",
          closed: true,
          name: `${NAME_PREFIX}Gated`,
        }),
        tc("wb_generator", "attach", { shape: "<shape>", prefab: FOREST_PREFAB }),
        tc("wb_generator", "detach", { entity: "<shape>" }),
        tc("wb_generator", "regenerate", { shape: "<shape>" }),
        tc("wb_generator", "pointData", {
          shape: "<shape>",
          op: "add",
          index: 0,
          dataClass: POINT_DATA_CLASS,
        }),
        tc("wb_generator", "events", { enabled: true }),
        tc("wb_shape", "edit", { entity: "<shape>", op: "close" }),
        tc("wb_shape", "parallel", { entity: "<shape>", offsets: ["5"] }),
        ...undoPlan(1),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureEntityWorld(ctx, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const flags = gateFlagsOf(ctx.deps.handlerSource);
        evidence.flags = flags;
        const before = await entityTotal(ctx);
        const s = await shape(ctx, "Gated", square(0, 0), { closed: true });
        if (!s.ref) fails.push(`create: ${why(s.r)}`);
        const ref = s.ref || "name:W7_Gated";
        const argsOf: Record<string, Raw> = {
          attach: { shape: ref, prefab: FOREST_PREFAB },
          detach: { entity: ref },
          regenerate: { shape: ref },
          pointData: { shape: ref, op: "add", index: 0, dataClass: POINT_DATA_CLASS },
          // The events toggle is editor-wide: sent as the value it holds (a no-op if it opened).
          events: { enabled: true },
          edit: { entity: ref, op: "close" },
          parallel: { entity: ref, offsets: ["5"] },
        };
        const answers: Raw = {};
        for (const ga of GATED_ENTITY) {
          if (flags[ga.flag] !== false) {
            answers[`${ga.tool}.${ga.action}`] =
              `not sent: ${ga.flag} is ${String(flags[ga.flag])}`;
            continue;
          }
          const r = await ctx.tool(ga.tool, { action: ga.action, ...argsOf[ga.action] });
          answers[`${ga.tool}.${ga.action}`] = brief(r);
          if (r.ok) fails.push(`${ga.tool}.${ga.action}: ok with ${ga.flag} false`);
          else if (r.code !== "GATED") fails.push(`${ga.tool}.${ga.action}: ${why(r)}`);
        }
        evidence.answers = answers;
        await settle(ctx, evidence, fails, before);
        return { ...verdictOf(fails, [], "every closed entity gate answers GATED"), evidence };
      },
    },

    // ── W7.3 shape and generator edits (entity world; one undo each) ──
    {
      id: "w7-30-shape-edit",
      block: "W7.3",
      title:
        "wb_shape edit: set, insert, remove, move, close, open, one undo each; area with target (P-W7-14)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "each op answers undoName and total; the points read back as the op says; one undo restores the points read before; area with target replaces the target's points (through edit set)",
      kill_criterion: `an op writes other points or one undo does not restore: KILLED (the row stays T2); GATED while EDIT_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["one polyline in memory, undone"],
      rollback: "Edit > Undo per op and per create; the entity count is checked",
      probes: ["P-W7-14"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_shape", "create", { points: "<3 points>", name: `${NAME_PREFIX}Edit` }),
        tc("wb_shape", "points", { entity: "<shape>", limit: 200 }),
        ...["set", "insert", "remove", "move", "close", "open"].flatMap((op) => [
          tc("wb_shape", "edit", { entity: "<shape>", op, index: 1, points: "<points>" }),
          tc("wb_shape", "points", { entity: "<shape>", limit: 200 }),
        ]),
        ...undoPlan(6),
        tc("wb_shape", "area", {
          shape: "circle",
          centre: "0 0 0",
          width: 8,
          segments: 6,
          target: "<shape>",
        }),
        tc("wb_shape", "points", { entity: "<shape>", limit: 200 }),
        ...undoPlan(2),
      ],
      run: async (ctx) => shapeEditBody(ctx),
    },
    {
      id: "w7-31-generator-attach",
      block: "W7.3",
      title:
        "wb_generator attach a forest generator as the shape's child, list, detach, undo each (P-W7-10)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "attach answers id, className inheriting GeneratorBaseEntity and undoName; list of the shape names it; detach removes it; one undo brings it back; one undo removes it",
      kill_criterion: `the generator is not the shape's child, or undo does not restore: KILLED (attach and detach re-point W8); GATED while ATTACH_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["one closed polyline and its generator in memory, undone"],
      rollback: "Edit > Undo per call; the entity count is checked",
      probes: ["P-W7-10"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_shape", "create", {
          points: "<4 points>",
          closed: true,
          name: `${NAME_PREFIX}Forest`,
        }),
        tc("wb_generator", "attach", {
          shape: "<shape>",
          prefab: FOREST_PREFAB,
          name: `${NAME_PREFIX}ForestGen`,
        }),
        tc("wb_generator", "list", { shape: "<shape>", limit: 50 }),
        tc("wb_generator", "detach", { entity: "<generator>" }),
        tc("wb_generator", "list", { shape: "<shape>", limit: 50 }),
        ...undoPlan(1),
        tc("wb_generator", "list", { shape: "<shape>", limit: 50 }),
        ...undoPlan(2),
      ],
      run: async (ctx) => generatorAttachBody(ctx),
    },
    {
      id: "w7-32-generator-regenerate",
      block: "W7.3",
      title:
        "wb_generator regenerate of a shape with a generator child, one undo (P-W7-11, the route REGENERATE_ROUTE names)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "regenerate answers generators >= 1 and undoName; the entity count is back after the undo",
      kill_criterion: `regenerate answers ENGINE_FALSE or 0 generators: KILLED (regenerate re-points W8); GATED while REGENERATE_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["one closed polyline and its generator in memory, undone"],
      rollback: "Edit > Undo per call; the entity count is checked",
      probes: ["P-W7-11"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_shape", "create", {
          points: "<4 points>",
          closed: true,
          name: `${NAME_PREFIX}Regen`,
        }),
        tc("wb_generator", "attach", { shape: "<shape>", prefab: FOREST_PREFAB }),
        tc("wb_generator", "regenerate", { shape: "<shape>" }),
        ...undoPlan(3),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureEntityWorld(ctx, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const before = await entityTotal(ctx);
        const s = await shape(ctx, "Regen", square(0, 0), { closed: true });
        let p11: ProbeResult;
        if (!s.ref) {
          fails.push(`create: ${why(s.r)}`);
          p11 = partial("P-W7-11", {}, "no shape");
        } else {
          const at = await ctx.tool("wb_generator", {
            action: "attach",
            shape: s.ref,
            prefab: FOREST_PREFAB,
          });
          const rg = await ctx.tool("wb_generator", { action: "regenerate", shape: s.ref });
          evidence.attach = brief(at);
          evidence.regenerate = brief(rg);
          const n = num(rb(rg).generators);
          const observed = { attach: gateAnswer(at), regenerate: gateAnswer(rg), generators: n };
          if (!rg.ok && rg.code === "GATED")
            p11 = partial("P-W7-11", observed, "GATED: REGENERATE_OPEN is false");
          else if (!rg.ok && rg.code !== "ENGINE_FALSE") {
            fails.push(`regenerate: ${why(rg)}`);
            p11 = partial("P-W7-11", observed, why(rg));
          } else if (!rg.ok || !n)
            p11 = killed("P-W7-11", observed, rg.ok ? "0 generators regenerated" : "ENGINE_FALSE");
          else p11 = settled("P-W7-11", observed, `${n} generator(s) regenerated, one undo point`);
        }
        await settle(ctx, evidence, fails, before);
        return { ...verdictOf(fails, [p11], p11.note), evidence, probes: [p11] };
      },
    },
    {
      id: "w7-33-point-data",
      block: "W7.3",
      title: "wb_generator pointData add and remove on point 0 of a shape, one undo each (P-W7-13)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected: `add (${POINT_DATA_CLASS}) answers count 1; remove answers count 0; each answers undoName`,
      kill_criterion: `the counts are not 1 then 0: KILLED (pointData re-points W8); GATED while POINTDATA_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["one polyline in memory, undone"],
      rollback: "Edit > Undo per call; the entity count is checked",
      probes: ["P-W7-13"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_shape", "create", { points: "<4 points>", name: `${NAME_PREFIX}Data` }),
        tc("wb_generator", "pointData", {
          shape: "<shape>",
          op: "add",
          index: 0,
          dataClass: POINT_DATA_CLASS,
        }),
        tc("wb_generator", "pointData", { shape: "<shape>", op: "remove", index: 0, dataIndex: 0 }),
        ...undoPlan(3),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureEntityWorld(ctx, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const before = await entityTotal(ctx);
        const s = await shape(ctx, "Data", square(0, 0));
        let p13: ProbeResult = partial("P-W7-13", {}, "no shape");
        if (!s.ref) fails.push(`create: ${why(s.r)}`);
        else {
          const add = await ctx.tool("wb_generator", {
            action: "pointData",
            shape: s.ref,
            op: "add",
            index: 0,
            dataClass: POINT_DATA_CLASS,
          });
          evidence.add = brief(add);
          if (!add.ok && add.code === "GATED")
            p13 = partial("P-W7-13", { add: "gated" }, "GATED: POINTDATA_OPEN is false");
          else if (!add.ok) {
            fails.push(`add: ${why(add)}`);
          } else {
            const rem = await ctx.tool("wb_generator", {
              action: "pointData",
              shape: s.ref,
              op: "remove",
              index: 0,
              dataIndex: 0,
            });
            evidence.remove = brief(rem);
            const observed = {
              addCount: num(rb(add).count),
              removeCount: rem.ok ? num(rb(rem).count) : null,
            };
            p13 =
              observed.addCount === 1 && observed.removeCount === 0
                ? settled("P-W7-13", observed, "count 1 after add, 0 after remove")
                : killed(
                    "P-W7-13",
                    observed,
                    `counts ${String(observed.addCount)} then ${String(observed.removeCount)}`,
                  );
          }
        }
        await settle(ctx, evidence, fails, before);
        return { ...verdictOf(fails, [p13], p13.note), evidence, probes: [p13] };
      },
    },
    {
      id: "w7-34-events",
      block: "W7.3",
      title:
        "wb_generator events off and on; list reports each; the value it held put back (P-W7-12)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "events {enabled: false} answers was and eventsEnabled false; list reports false; events {enabled: true} answers true; the original value restored",
      kill_criterion: `list does not follow the toggle: KILLED (the row stays T2); GATED while EVENTS_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["the editor-wide generator events toggle, restored to the value it held"],
      rollback: "events {enabled: <was>} (a restorer)",
      probes: ["P-W7-12"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_generator", "list", { limit: 1 }),
        tc("wb_generator", "events", { enabled: false }),
        tc("wb_generator", "list", { limit: 1 }),
        tc("wb_generator", "events", { enabled: true }),
        tc("wb_generator", "list", { limit: 1 }),
        tc("wb_generator", "events", { enabled: "<was>" }, { note: "restorer: the value it held" }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureEntityWorld(ctx, evidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence };
        const l0 = await ctx.tool("wb_generator", { action: "list", limit: 1 });
        const was = truthy(rb(l0).eventsEnabled);
        const off = await ctx.tool("wb_generator", { action: "events", enabled: false });
        evidence.off = brief(off);
        let p12: ProbeResult;
        if (!off.ok && off.code === "GATED")
          p12 = partial("P-W7-12", { off: "gated" }, "GATED: EVENTS_OPEN is false");
        else if (!off.ok) {
          fails.push(`events off: ${why(off)}`);
          p12 = partial("P-W7-12", {}, why(off));
        } else {
          ctx.debt.restorers.push({
            label: "events back",
            fn: () => ctx.deps.tool("wb_generator", { action: "events", enabled: was }),
          });
          const l1 = await ctx.tool("wb_generator", { action: "list", limit: 1 });
          const on = await ctx.tool("wb_generator", { action: "events", enabled: true });
          const l2 = await ctx.tool("wb_generator", { action: "list", limit: 1 });
          const observed = {
            was,
            offWas: rb(off).was ?? null,
            afterOff: rb(l1).eventsEnabled ?? null,
            onAnswer: rb(on).eventsEnabled ?? null,
            afterOn: rb(l2).eventsEnabled ?? null,
          };
          p12 =
            truthy(observed.offWas) === was &&
            !truthy(observed.afterOff) &&
            truthy(observed.afterOn)
              ? settled("P-W7-12", observed, "the toggle reads back both ways; was answered")
              : killed("P-W7-12", observed, "list does not follow the toggle");
        }
        await settle(ctx, evidence, fails, null);
        return { ...verdictOf(fails, [p12], p12.note), evidence, probes: [p12] };
      },
    },

    // ── W7.4 terrain writes (confirmed, one undo each, then undone) ──
    {
      id: "w7-40-tile-markers",
      block: "W7.4",
      title:
        "U18: tileWrite of four corner markers, the effect, the array order and one undo (P-W7-01)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.write,
      expected:
        "the confirm answers undoName; the four marker cells read +1..+4 m and nothing else moved; exactly one order hypothesis puts the markers where wb_terrain heights sees them; one undo restores every sample",
      kill_criterion: `the write does not land or one undo does not restore: KILLED (K1 then P-W7-09, K2 then H1); GATED while TERRAIN_WRITE_OPEN is false or the route is absent: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["four terrain samples in memory, undone"],
      rollback: "Edit > Undo; the rows read back equal",
      probes: ["P-W7-01"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tilePlan("<tx>", "<ty>"),
        tc("wb_terrain", "heights", { points: "<16 candidate points>" }),
        tc("wb_terrain_edit", "tileWrite", {
          patches: "<4 markers>",
          undoLabel: "P-W7-01 markers",
        }),
        tc("wb_terrain_edit", "tileWrite", {
          patches: "<4 markers>",
          undoLabel: "P-W7-01 markers",
          confirm: true,
        }),
        tilePlan("<tx>", "<ty>"),
        tc("wb_terrain", "heights", { points: "<16 candidate points>" }),
        ...undoPlan(1),
        tilePlan("<tx>", "<ty>"),
      ],
      run: async (ctx) => markersBody(ctx),
    },
    {
      id: "w7-41-seams",
      block: "W7.4",
      title:
        "tile seams: a write on tile A's last column read on tile B's first column (P-W7-02), one undo",
      risk: "mutating",
      timeout_ms: TIMEOUTS.write,
      expected:
        "the write lands on A; B's shared sample is recorded as followed or not (the brush limit documents it); one undo restores both",
      kill_criterion: `none (the observation is the answer); GATED: PARTIAL; one undo leaves a sample: FAIL; ${WINDOW_KILL}`,
      side_effects: ["one terrain sample in memory, undone"],
      rollback: "Edit > Undo; both rows read back equal",
      probes: ["P-W7-02"],
      dependsOn: ["P-W7-01"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tilePlan(0, 0),
        tilePlan(1, 0),
        tc("wb_terrain_edit", "tileWrite", {
          patches: "<A row 2, last col>",
          undoLabel: "P-W7-02",
          confirm: true,
        }),
        tilePlan(0, 0),
        tilePlan(1, 0),
        ...undoPlan(1),
        tilePlan(0, 0),
        tilePlan(1, 0),
      ],
      run: async (ctx) => seamsBody(ctx),
    },
    {
      id: "w7-42-ceiling",
      block: "W7.4",
      title:
        "the patch ceiling per NET call: 1, 16 and 64 full-row patches, timed, one undo each (P-W7-04)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.write * 2,
      expected:
        "each size answers ok and lands; its time is recorded; the largest size that passed is the patch limit",
      kill_criterion: `none (the largest passing size is the answer); a refusal other than GATED or a size that does not undo: FAIL; ${WINDOW_KILL}`,
      side_effects: ["up to 64 terrain rows in memory, undone after each size"],
      rollback: "Edit > Undo after each size; the rows read back equal",
      probes: ["P-W7-04"],
      dependsOn: ["P-W7-01"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tilePlan("<tx>", "<ty>"),
        ...[1, 16, 64].flatMap((n) => [
          tc("wb_terrain_edit", "tileWrite", {
            patches: `<${n} rows>`,
            undoLabel: `P-W7-04 ${n}`,
            confirm: true,
          }),
          tilePlan("<tx>", "<ty>"),
          ...undoPlan(1),
          tilePlan("<tx>", "<ty>"),
        ]),
      ],
      run: async (ctx) => ceilingBody(ctx),
    },
    {
      id: "w7-43-brush",
      block: "W7.4",
      title:
        "brush in each mode on its own area: the estimate against the live change to 1 mm (P-W7-16), one undo each",
      risk: "mutating",
      timeout_ms: TIMEOUTS.write * 2,
      expected:
        "for sculpt, flatten, smooth and noise: the dry run's estimate, then the confirm; the samples that changed and their min, max and mean delta equal the estimate to 1 mm; one undo restores the tiles",
      kill_criterion: `a mode's live change differs from its estimate: KILLED (a TA-1 bug); GATED: PARTIAL, and a .asc named in next is recorded for H1 (K2); ${WINDOW_KILL}`,
      side_effects: ["terrain under four discs of 6 m in memory, undone"],
      rollback: "Edit > Undo per mode; the tiles read back equal",
      probes: ["P-W7-16"],
      dependsOn: ["P-W7-01"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        ...["sculpt", "flatten", "smooth", "noise"].flatMap((mode) => [
          tilePlan("<tiles under the disc>", "<ty>"),
          tc(
            "wb_terrain_edit",
            "tileWrite",
            { mode, centre: "<x z>", radius: "6" },
            { toolAction: "brush", note: "dry run: the estimate" },
          ),
          tc(
            "wb_terrain_edit",
            "tileWrite",
            { mode, centre: "<x z>", radius: "6", confirm: true },
            { toolAction: "brush", note: "TS: tileRead, brush maths, then tileWrite" },
          ),
          tilePlan("<tiles under the disc>", "<ty>"),
          ...undoPlan(1),
          tilePlan("<tiles under the disc>", "<ty>"),
        ]),
      ],
      run: async (ctx) => brushBody(ctx),
    },
    {
      id: "w7-44-flatter",
      block: "W7.4",
      title: "flatter add and remove under a box prop on a slope, one undo each (P-W7-06)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.write,
      expected:
        "add answers id and undoName and the heights under the box change; remove answers and they change again; the undos restore the heights and the entity count",
      kill_criterion: `add changes nothing, or the undos do not restore: KILLED (2 rows re-point W8); GATED while FLATTER_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["one prop and its flattener in memory, undone"],
      rollback: "Edit > Undo per call; heights and entity count checked",
      probes: ["P-W7-06"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc("wb_terrain", "heights", { points: "<slope candidates>" }),
        tc("wb_entity", "list", { limit: 1 }),
        tc("wb_entity", "create", { prefab: PROP, name: `${NAME_PREFIX}Flat`, coords: "<x y z>" }),
        tc(
          "wb_terrain_edit",
          "flatter",
          { op: "add", entity: "<box>", mins: "-2 -1 -2", maxs: "2 1 2" },
          { note: "dry run" },
        ),
        tc("wb_terrain_edit", "flatter", {
          op: "add",
          entity: "<box>",
          mins: "-2 -1 -2",
          maxs: "2 1 2",
          confirm: true,
        }),
        tc("wb_terrain", "heights", { points: "<9 under the box>" }),
        tc("wb_terrain_edit", "flatter", { op: "remove", entity: "<box>", confirm: true }),
        tc("wb_terrain", "heights", { points: "<9 under the box>" }),
        ...undoPlan(3),
        tc("wb_terrain", "heights", { points: "<9 under the box>" }),
      ],
      run: async (ctx) => flatterBody(ctx),
    },
    {
      id: "w7-45-masks",
      block: "W7.4",
      title: `exportMasks to ${MASKS_DIR} (P-W7-08); a folder outside the project refused`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.write,
      expected: `the dry run writes nothing; '../outside' refuses NOT_IN_PROJECT or INVALID_ARGUMENT; the confirm answers exported and the files lie under ${MASKS_DIR}/ only`,
      kill_criterion: `no file written, or a file outside ${MASKS_DIR}/: KILLED (2 rows re-point W8); GATED while MASKS_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: [`mask images under ${MASKS_DIR}/ (rollback removes them)`],
      rollback: "`w7.live.ts rollback` removes the masks folder after Workbench is closed",
      probes: ["P-W7-08"],
      owner: TERRAIN_GO,
      writes: [MASKS_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc(
          "wb_terrain_edit",
          "exportMasks",
          { directory: "../outside" },
          { note: "dry run: refused" },
        ),
        tc("wb_terrain_edit", "exportMasks", { directory: MASKS_DIR }, { note: "dry run" }),
        tc("wb_terrain_edit", "exportMasks", { directory: MASKS_DIR, confirm: true }),
      ],
      offlineCalls: () => [oc("fs", "list", { path: MASKS_DIR, readOnly: true })],
      run: async (ctx) => masksBody(ctx),
    },
    {
      id: "w7-46-persist",
      block: "W7.4",
      title:
        "U18 persistence: the markers written, the terrain world saved, reopened and read back (P-W7-01)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open * 2 + TIMEOUTS.write,
      expected:
        "after the save, the entity world opened and the terrain world reopened, the four markers read +1..+4 m (left on disk: W7.7 restore removes them)",
      kill_criterion: `the markers are gone after reopen: KILLED; GATED: PARTIAL; ${WINDOW_KILL}`,
      side_effects: [
        "the terrain world saved with four markers (restore puts the backup back in W7.7)",
      ],
      rollback: "W7.7 restore from the sitting backup",
      probes: ["P-W7-01"],
      dependsOn: ["P-W7-01"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tilePlan("<tx>", "<ty>"),
        tc("wb_terrain_edit", "tileWrite", {
          patches: "<4 markers>",
          undoLabel: "P-W7-01 persist",
          confirm: true,
        }),
        tc("wb_world", "state"),
        tc(
          "wb_module",
          "save",
          { moduleName: "WorldEditor", confirm: true, path: TERRAIN_WORLD_PH },
          { note: "guarded: the open world must be under _throwaway/W7/" },
        ),
        ...openPlan(ENTITY_WORLD),
        ...openPlan(TERRAIN_WORLD_PH),
        tilePlan("<tx>", "<ty>"),
      ],
      run: async (ctx) => persistBody(ctx),
    },

    // ── W7.5 maps (no undo) ──
    {
      id: "w7-50-maps",
      block: "W7.5",
      title:
        "maps shore, then flow (P-W7-07): files overwritten with no undo; the backup is the way back",
      risk: "mutating",
      timeout_ms: TIMEOUTS.write * 2,
      expected:
        "each dry run writes nothing; each confirm answers built and changes files of the world's folder; no dialog (the watchdog)",
      kill_criterion: `built false, no file changed, or a dialog: KILLED (6 rows re-point W8; a dialog is H2); GATED while MAPS_OPEN is false: PARTIAL; ${WINDOW_KILL}`,
      side_effects: ["shore and flow map files of the terrain world overwritten (W7.7 restore)"],
      rollback: "W7.7 restore from the sitting backup",
      probes: ["P-W7-07"],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...terrainPlan(),
        tc("wb_terrain_edit", "maps", { kind: "shore" }, { note: "dry run" }),
        tc("wb_terrain_edit", "maps", { kind: "shore", confirm: true }),
        tc("wb_terrain_edit", "maps", { kind: "flow", preview: false }, { note: "dry run" }),
        tc("wb_terrain_edit", "maps", { kind: "flow", preview: false, confirm: true }),
      ],
      offlineCalls: () => [
        oc("fs", "hash", { path: `${W7_ROOT}/<terrain world folder>`, readOnly: true }),
      ],
      run: async (ctx) => mapsBody(ctx),
    },

    // ── W7.6 CLI (prepared; the run is the runbook's, Workbench closed) ──
    {
      id: "w7-60-cli-variant",
      block: "W7.6",
      title: `${TERRAIN_VARIANT_PLUGIN} prepared for the CLI lane: the world is throwaway, the plugin is gated on P-W7-15 and needs confirm`,
      risk: "read-only",
      timeout_ms: 30_000,
      expected:
        "isThrowawayWorld true for the terrain world; pluginGate names P-W7-15; the plugin is in CONFIRM_PLUGINS; the runbook's command printed (nothing spawned here)",
      kill_criterion:
        "the world is not throwaway or the gate is missing: FAIL (the CLI run would not be held)",
      side_effects: [],
      rollback: "none (offline)",
      probes: [],
      owner: TERRAIN_GO,
      writes: [],
      plan: () => [],
      offlineCalls: () => [
        oc("cli_run", "plan", {
          plugin: TERRAIN_VARIANT_PLUGIN,
          world: TERRAIN_WORLD_PH,
          readOnly: true,
        }),
      ],
      run: async (ctx) => {
        const world = ctx.opts.terrainWorld!;
        const fails: string[] = [];
        const throwaway = isThrowawayWorld(abs(ctx.opts.sandboxDir, world), ctx.opts.sandboxDir);
        const gate = pluginGate(TERRAIN_VARIANT_PLUGIN);
        if (!throwaway) fails.push("isThrowawayWorld is false for the terrain world");
        if (!gate || gate.probe !== "P-W7-15")
          fails.push(`pluginGate: ${JSON.stringify(gate ?? null)}`);
        if (!CONFIRM_PLUGINS.has(TERRAIN_VARIANT_PLUGIN))
          fails.push("the plugin does not need confirm");
        const evidence = {
          throwaway,
          gate: gate ?? null,
          runbook: `wb_cli_run verb plugin, plugin {name: ${TERRAIN_VARIANT_PLUGIN}}, world ${world}: dry run, then confirm once P-W7-15's entry is listed; GUI Workbench closed, the sandbox hashed before and after (W7.md step 9)`,
        };
        return { ...verdictOf(fails, [], "prepared for the CLI lane"), evidence };
      },
    },

    // ── W7.7 restore and net zero ──
    {
      id: RESTORE_STEP,
      block: "W7.7",
      title:
        "the terrain world closed, restore with confirm, the battery's sha256 manifest checked, reopened, the W7.1 rows read back",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open * 3,
      expected:
        "restore's dry run lists the files; the confirm answers files; every file hashes as the manifest of w7-03; the reopened world's first rows of tiles 0,0 and 1,0 equal the W7.1 read",
      kill_criterion: `WORLD_OPEN with the world closed, a manifest mismatch, or rows that differ: FAIL and the abort rule (stop, report; restore again by hand); ${WINDOW_KILL}`,
      side_effects: ["the terrain world's files put back from the sitting backup"],
      rollback: "none: this is the rollback of W7.4 to W7.6",
      probes: [],
      owner: TERRAIN_GO,
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...entityWorldPlan(),
        tc("wb_terrain_edit", "restore", { backupId: "<sitting backupId>" }, { note: "dry run" }),
        tc("wb_world", "state"),
        tc(
          "wb_terrain_edit",
          "restore",
          { backupId: "<sitting backupId>", confirm: true },
          { note: "guarded: the open world is the entity world" },
        ),
        ...openPlan(TERRAIN_WORLD_PH),
        tilePlan(0, 0),
        tilePlan(1, 0),
      ],
      offlineCalls: () => [oc("fs", "hash", { path: "<manifest files>", readOnly: true })],
      run: async (ctx) => restoreBody(ctx),
    },

    // ── W7.8 hand: H1 (K2 only) ──
    {
      id: H1_STEP,
      block: "W7.8",
      title:
        "H1 (K2 only, OI-W7-4): the owner imports the TS-written .asc through Terrain Tool, Manage; the battery reads the heights back",
      risk: "mutating",
      timeout_ms: HAND_WAIT_MS + TIMEOUTS.step,
      expected: `runs only when P-W7-01 is KILLED in the sitting and ${K2_FILE} names an .asc; the hand answers imported; the height at the brush centre moved; then ${RESTORE_STEP} again in a new run folder`,
      kill_criterion:
        "the import changes nothing: FAIL (the K2 branch has no proof; its 8 rows go to W8)",
      side_effects: [
        "the terrain world's heights replaced by the .asc import (in memory; restore after)",
      ],
      rollback: `--only ${RESTORE_STEP} in a new run folder`,
      probes: [],
      owner: TERRAIN_GO,
      hand: true,
      writes: [],
      plan: () => [...terrainPlan(), tc("wb_terrain", "heights", { points: "<brush centre>" })],
      run: async (ctx) => h1Body(ctx),
    },

    // ── W7.9 close ──
    {
      id: H3_STEP,
      block: "W7.9",
      title:
        "H3 (optional; waived when the go says 'waive H3'): the owner looks at the throwaway world after W7.7",
      risk: "read-only",
      timeout_ms: HAND_WAIT_MS,
      expected: "the hand answers matches: true (a visual check of what the manifest proved)",
      kill_criterion: "the hand answers matches: false: FAIL (the abort rule: report)",
      side_effects: [],
      rollback: "none",
      probes: [],
      owner: TERRAIN_GO,
      hand: true,
      writes: [],
      plan: () => [],
      run: async (ctx) => {
        const oi = ownerInput(ctx.opts, ctx.deps);
        const go = ownerGoOf(oi.logText, oi.terrainWorld);
        if (go.waivesH3)
          return {
            status: "NOT-RUN",
            detail: "waived in the OI-W7-2 go",
            evidence: { goLine: go.line },
          };
        const a = await awaitHand(
          ctx,
          H3_STEP,
          `Look at ${ctx.opts.terrainWorld ?? "the throwaway world"} in the World Editor after the restore: does it match the state before the battery (no markers, no brushed discs, no flatteners)? Write {"matches": true} or {"matches": false, "why": "<what you saw>"}`,
        );
        if (!a)
          return { status: "NOT-RUN", detail: "no hand answer within the wait", evidence: {} };
        return a.matches === true
          ? {
              status: "PASS",
              detail: "the owner confirms the world matches",
              evidence: { answer: a },
            }
          : { status: "FAIL", detail: `the owner: ${S(a.why)}`, evidence: { answer: a } };
      },
    },
    {
      id: NETZERO_STEP,
      block: "W7.9",
      title:
        "net-zero: the sandbox outside _throwaway/W7/ against the battery's snapshot; the terrain files against the backup manifest",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "no file outside _throwaway/W7/ changed (resourceDatabase.rdb recorded, not failed); when a sitting backup exists, every terrain file hashes as its manifest",
      kill_criterion:
        "a file outside _throwaway/W7/ changed, the snapshot is missing, or a terrain file differs from the manifest: FAIL",
      side_effects: [],
      rollback: "none (reads)",
      probes: [],
      writes: [],
      plan: () => [],
      offlineCalls: () => [
        oc("fs", "hash", { path: "<sandbox outside _throwaway/W7/>", readOnly: true }),
      ],
      run: async (ctx) => {
        const d = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
        if (!d)
          return {
            status: "FAIL",
            detail: `no ${BATTERY_SNAPSHOT_FILE} in the sitting`,
            evidence: {},
          };
        const real = d.changed.filter((f) => !NETZERO_TOLERATED.includes(f));
        const backup = readJson<SittingBackup>(join(ctx.opts.sittingDir, BACKUP_FILE), ctx.deps);
        const mismatch = backup ? manifestMismatch(backup, ctx.deps) : [];
        const evidence = {
          snapshot: { takenBy: d.takenBy, takenAt: d.takenAt },
          changed: d.changed,
          manifest: backup
            ? {
                files: Object.keys(backup.manifest).length,
                mismatch: mismatch.map((p) => toPlaceholders(p, ctx.opts.ph)),
              }
            : null,
        };
        const fails = [
          ...(real.length ? [`changed outside ${W7_ROOT}/: ${real.join(", ")}`] : []),
          ...(mismatch.length
            ? [`terrain files differ from the backup manifest: ${mismatch.length}`]
            : []),
        ];
        return {
          ...verdictOf(
            fails,
            [],
            `net-zero outside ${W7_ROOT}/ (${d.changed.length} tolerated)${backup ? "; terrain files match the manifest" : ""}`,
          ),
          evidence,
        };
      },
    },
    closableStep(),
  ];
}

// ── Step bodies ──────────────────────────────────────────────────────────────

/** The Bohemia reads of P-W7-05 (wb_bi call), compared with wb_terrain. */
function biPlan(): PlanAction[] {
  return [
    tc(
      "wb_bi",
      "call",
      { handler: "GetTerrainInfo", request: { terrainIndex: 0 } },
      { target: "GetTerrainInfo" },
    ),
    tc(
      "wb_bi",
      "call",
      { handler: "GetTileHeightmap", request: { terrainIndex: 0, tileX: 0, tileY: 0 } },
      { target: "GetTileHeightmap" },
    ),
    tc(
      "wb_bi",
      "call",
      { handler: "GetSurfaceMaterials", request: { terrainIndex: 0 } },
      { target: "GetSurfaceMaterials" },
    ),
  ];
}

/** wb_terrain tile's first `n` samples of a tile (row-major), paged by 200. */
async function oracleSamples(
  ctx: StepContext,
  tx: number,
  ty: number,
  n: number,
): Promise<number[] | string> {
  const out: number[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES && out.length < n; page++) {
    const r = await ctx.tool("wb_terrain", {
      action: "tile",
      tileX: tx,
      tileY: ty,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    if (!r.ok) return why(r);
    const page1 = tileSamplesOf(rb(r));
    if (!page1.length) return "the answer carries no samples";
    out.push(...page1);
    cursor = S(rb(r).nextCursor);
    if (!cursor) break;
  }
  return out.slice(0, n);
}

/**
 * The samples of one wb_terrain tile page (fix-up 3). The tool reshapes the handler's `rows`
 * (one sample text each) into `samples: number[]` beside `first`, `total` and `nextCursor`
 * (wb-terrain.ts shapeOk, the tile branch). Run 3 read `rows`, got nothing and compared against
 * undefined.
 */
export function tileSamplesOf(r: Raw): number[] {
  return Array.isArray(r.samples) ? (r.samples as unknown[]).map(Number) : [];
}

async function readsBody(ctx: StepContext, world: string, keep: boolean): Promise<StepOutcome> {
  const evidence: Raw = { world };
  const fails: string[] = [];
  if (!(await ensureOpen(ctx, world, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  const g = await gridOf(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const tiles: Array<[number, number]> = [
    [0, 0],
    [Math.min(1, g.tilesX - 1), 0],
  ];
  const kept: Record<string, Record<string, number[]>> = {};
  for (const [tx, ty] of tiles) {
    const t = await readTile(ctx, tx, ty, new Set([0, 1]));
    const r0 = t.rows.get(0);
    const r1 = t.rows.get(1);
    if (t.error || !r0 || !r1) {
      fails.push(`tileRead ${tx},${ty}: ${S(t.error) || "rows 0 and 1 missing"}`);
      continue;
    }
    const mine = [...r0, ...r1];
    const theirs = await oracleSamples(ctx, tx, ty, mine.length);
    if (typeof theirs === "string") fails.push(`wb_terrain tile ${tx},${ty}: ${theirs}`);
    else {
      const bad = mine.findIndex((v, i) => !(Math.abs(v - theirs[i]) <= HEIGHT_TOL));
      if (theirs.length !== mine.length)
        fails.push(
          `tile ${tx},${ty}: wb_terrain tile gave ${theirs.length} samples, tileRead ${mine.length}`,
        );
      else if (bad >= 0)
        fails.push(
          `tile ${tx},${ty}: tileRead and wb_terrain tile differ at sample ${bad} (${mine[bad]} vs ${theirs[bad]})`,
        );
    }
    kept[`${tx},${ty}`] = { "0": r0, "1": r1 };
  }
  evidence.side = g.side;
  evidence.tilesRead = Object.keys(kept);
  // P-W7-05: the three Bohemia reads against wb_terrain.
  const info = await ctx.tool("wb_bi", {
    action: "call",
    handler: "GetTerrainInfo",
    request: { terrainIndex: 0 },
  });
  const hm = await ctx.tool("wb_bi", {
    action: "call",
    handler: "GetTileHeightmap",
    request: { terrainIndex: 0, tileX: 0, tileY: 0 },
  });
  const sm = await ctx.tool("wb_bi", {
    action: "call",
    handler: "GetSurfaceMaterials",
    request: { terrainIndex: 0 },
  });
  const ti = await ctx.tool("wb_terrain", { action: "info" });
  const observed: Raw = {
    GetTerrainInfo: brief(info),
    GetTileHeightmap: gateAnswer(hm),
    GetSurfaceMaterials: brief(sm),
  };
  const gated = [info, hm, sm].filter(
    (r) => !r.ok && (r.code === "NOT_ALLOWLISTED" || r.code === "GATED"),
  );
  let p5: ProbeResult;
  if (gated.length === 3)
    p5 = partial(
      "P-W7-05",
      observed,
      "NOT_ALLOWLISTED with nothing sent: VERIFIED_READ lacks the three (the integrator's probe build adds them)",
    );
  else {
    const misses: string[] = [];
    const a = rb(info);
    const b = rb(ti);
    // wb_terrain info answers the nested shape (fix-up 2): compare it as the handler's flat keys.
    const bg = infoGrid(b);
    const flatB: Raw = {
      resolutionX: bg?.resX,
      resolutionY: bg?.resY,
      tilesX: bg?.tilesX,
      tilesY: bg?.tilesY,
      unitScale: bg?.unitScale,
    };
    if (info.ok)
      for (const k of ["resolutionX", "resolutionY", "tilesX", "tilesY", "unitScale"])
        if (num(a[k]) === null || num(a[k]) !== num(flatB[k]))
          misses.push(`GetTerrainInfo.${k} ${S(a[k])} vs ${S(flatB[k])}`);
    if (hm.ok) {
      const flat = (Array.isArray(rb(hm).heightMap) ? (rb(hm).heightMap as unknown[]) : []).map(
        Number,
      );
      const want = kept["0,0"] ? [...kept["0,0"]["0"], ...kept["0,0"]["1"]] : [];
      const bad = want.findIndex((v, i) => !(Math.abs(v - flat[i]) <= HEIGHT_TOL));
      if (bad >= 0) misses.push(`GetTileHeightmap differs at sample ${bad}`);
      observed.heightMapLength = flat.length;
    }
    if (sm.ok) {
      const mats = Array.isArray(rb(sm).materials) ? (rb(sm).materials as unknown[]).map(S) : [];
      const surf = Array.isArray(b.surfaces) ? (b.surfaces as unknown[]).map(S) : [];
      if (mats.length !== surf.length || mats.some((m) => !surf.includes(m)))
        misses.push("GetSurfaceMaterials differs from wb_terrain info surfaces");
    }
    const refused = [info, hm, sm].filter((r) => !r.ok && !gated.includes(r));
    p5 = misses.length
      ? killed("P-W7-05", { ...observed, misses }, misses.join("; "))
      : refused.length || gated.length
        ? partial("P-W7-05", observed, `answered ${[info, hm, sm].map(gateAnswer).join(", ")}`)
        : settled("P-W7-05", observed, "the three Bohemia reads agree with wb_terrain");
  }
  if (keep && !fails.length && !ctx.deps.exists(join(ctx.opts.sittingDir, BEFORE_FILE)))
    writeJson(join(ctx.opts.sittingDir, BEFORE_FILE), { world, rows: kept }, ctx.deps);
  return {
    ...verdictOf(
      fails,
      [p5],
      `tileRead equals wb_terrain tile on ${Object.keys(kept).length} tile(s)`,
    ),
    evidence,
    probes: [p5],
  };
}

async function shapeEditBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  if (!(await ensureEntityWorld(ctx, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  const before = await entityTotal(ctx);
  const base = ["0 0 0", "10 0 0", "20 0 0"];
  const s = await shape(ctx, "Edit", base);
  if (!s.ref) {
    fails.push(`create: ${why(s.r)}`);
    await settle(ctx, evidence, fails, before);
    return { ...verdictOf(fails, [], ""), evidence };
  }
  const read = async (): Promise<{ pts: string[]; closed: boolean }> => {
    const r = await pointsOf(ctx, s.ref);
    return {
      pts: (Array.isArray(rb(r).points) ? (rb(r).points as unknown[]) : []).map((p) => {
        const v = vec3(p);
        return v ? v.map((n) => Math.round(n * 1000) / 1000).join(" ") : S(p);
      }),
      closed: truthy(rb(r).closed),
    };
  };
  const start = await read();
  const ops: Array<{
    op: string;
    args: Raw;
    expect: (p: { pts: string[]; closed: boolean }) => boolean;
  }> = [
    {
      op: "set",
      args: { points: ["0 0 5", "5 0 5"] },
      expect: (p) => p.pts.join(";") === "0 0 5;5 0 5",
    },
    {
      op: "insert",
      args: { index: 1, points: ["5 0 0"] },
      expect: (p) => p.pts.length === 4 && p.pts[1] === "5 0 0",
    },
    { op: "remove", args: { index: 1 }, expect: (p) => p.pts.join(";") === "0 0 0;20 0 0" },
    {
      op: "move",
      args: { index: 0, points: ["0 0 3"] },
      expect: (p) => p.pts[0] === "0 0 3" && p.pts.length === 3,
    },
    { op: "close", args: {}, expect: (p) => p.closed && p.pts.length === 3 },
  ];
  const observed: Raw = { start };
  let gated = false;
  let bad = "";
  for (const o of ops) {
    const r = await ctx.tool("wb_shape", { action: "edit", entity: s.ref, op: o.op, ...o.args });
    if (!r.ok && r.code === "GATED") {
      gated = true;
      observed[o.op] = "gated";
      break;
    }
    if (!r.ok) {
      fails.push(`${o.op}: ${why(r)}`);
      break;
    }
    const after = await read();
    observed[o.op] = { answer: brief(r), after };
    if (!o.expect(after)) bad ||= `${o.op} reads ${after.pts.join(";")} closed ${after.closed}`;
    if (o.op === "close") {
      const open = await ctx.tool("wb_shape", { action: "edit", entity: s.ref, op: "open" });
      const afterOpen = await read();
      observed.open = { answer: brief(open), after: afterOpen };
      if (!open.ok || afterOpen.closed) bad ||= "open left the shape closed";
      if (open.ok) {
        const u = await ctx.undo();
        if (!u.ok || !(await read()).closed) bad ||= "one undo of open did not close it again";
      }
    }
    const u = await ctx.undo();
    const back = await read();
    if (!u.ok || back.pts.join(";") !== start.pts.join(";") || back.closed !== start.closed)
      bad ||= `one undo of ${o.op} left ${back.pts.join(";")} closed ${back.closed}`;
  }
  // area with target: the TS tool replaces the target's points through edit set.
  const area = await ctx.tool("wb_shape", {
    action: "area",
    shape: "circle",
    centre: "0 0 0",
    width: 8,
    segments: 6,
    target: s.ref,
  });
  evidence.areaTarget = brief(area);
  if (area.ok) {
    const after = await read();
    observed.areaTarget = after.pts.length;
    if (after.pts.length < 6) bad ||= `area target left ${after.pts.length} points`;
  } else if (area.code !== "GATED") fails.push(`area target: ${why(area)}`);
  evidence.observed = observed;
  const p14 = gated
    ? partial("P-W7-14", observed, "GATED: EDIT_OPEN is false")
    : bad
      ? killed("P-W7-14", observed, bad)
      : settled("P-W7-14", observed, "six ops read back; one undo each restores");
  await settle(ctx, evidence, fails, before);
  return { ...verdictOf(fails, [p14], p14.note), evidence, probes: [p14] };
}

async function generatorAttachBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  if (!(await ensureEntityWorld(ctx, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  const before = await entityTotal(ctx);
  const s = await shape(ctx, "Forest", square(0, 0), { closed: true });
  let p10: ProbeResult = partial("P-W7-10", {}, "no shape");
  if (!s.ref) fails.push(`create: ${why(s.r)}`);
  else {
    const at = await ctx.tool("wb_generator", {
      action: "attach",
      shape: s.ref,
      prefab: FOREST_PREFAB,
      name: `${NAME_PREFIX}ForestGen`,
    });
    evidence.attach = brief(at);
    const ids = async (): Promise<string[]> => {
      const l = await ctx.tool("wb_generator", { action: "list", shape: s.ref, limit: 50 });
      return (Array.isArray(rb(l).rows) ? (rb(l).rows as unknown[]) : []).map((r) =>
        S(r).split("|")[0].toLowerCase(),
      );
    };
    if (!at.ok && at.code === "GATED")
      p10 = partial("P-W7-10", { attach: "gated" }, "GATED: ATTACH_OPEN is false");
    else if (!at.ok) fails.push(`attach: ${why(at)}`);
    else {
      const gid = S(rb(at).id).toLowerCase();
      const listed = await ids();
      const de = await ctx.tool("wb_generator", { action: "detach", entity: S(rb(at).id) });
      const afterDetach = await ids();
      const u1 = await ctx.undo();
      const afterUndo = await ids();
      const observed = {
        id: gid,
        className: rb(at).className ?? null,
        listed,
        detach: gateAnswer(de),
        afterDetach,
        afterUndo,
      };
      p10 =
        listed.includes(gid) &&
        de.ok &&
        !afterDetach.includes(gid) &&
        u1.ok &&
        afterUndo.includes(gid)
          ? settled(
              "P-W7-10",
              observed,
              "attached as the shape's child; detach and its undo read back",
            )
          : killed(
              "P-W7-10",
              observed,
              "the generator is not listed under the shape, or detach / undo did not read back",
            );
    }
  }
  await settle(ctx, evidence, fails, before);
  return { ...verdictOf(fails, [p10], p10.note), evidence, probes: [p10] };
}

/** The terrain step's dry run and confirm of one patch set; GATED or the write answer. */
async function writePatches(
  ctx: StepContext,
  patches: string[],
  label: string,
  evidence: Raw,
): Promise<ToolResponse> {
  const { dry, conf } = await dryThenConfirm(
    ctx,
    { action: "tileWrite", patches, undoLabel: label },
    evidence,
    label,
  );
  return conf ?? dry;
}

async function markersBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const [tx, ty] = interiorTile(g);
  const want = new Set([1, g.side - 2]);
  const before = await readTile(ctx, tx, ty, want);
  const mk = before.error ? null : markerPatches(g, tx, ty, before.rows);
  if (!mk)
    return { status: "FAIL", detail: `the marker rows do not read: ${S(before.error)}`, evidence };
  const cand: Array<[number, number]> = [];
  for (const o of ORDERS)
    for (const c of mk.cells) cand.push(sampleWorld(g, tx, ty, c.row, c.col, o));
  const hBefore = await heights(ctx, cand);
  const w = await writePatches(ctx, mk.patches, "P-W7-01 markers", evidence);
  const after = await readTile(ctx, tx, ty, want);
  if (!w.ok) {
    const moved = tileDiff(before.rows, after.rows).length;
    if (moved) fails.push(`a refused write moved ${moved} sample(s)`);
    if (w.code !== "GATED") fails.push(`tileWrite: ${why(w)}`);
    const p1 = partial(
      "P-W7-01",
      { write: gateAnswer(w) },
      `not written: ${S(w.code)} ${S(w.message)}`,
    );
    return { ...verdictOf(fails, [p1], p1.note), evidence, probes: [p1] };
  }
  const landed = markersLanded(mk.cells, before.rows, after.rows);
  const hAfter = await heights(ctx, cand);
  const deltas: Record<string, Array<number | null>> = {};
  ORDERS.forEach((o, i) => {
    deltas[orderKey(o)] = mk.cells.map((_, k) => {
      const a = hAfter[i * 4 + k];
      const b = hBefore[i * 4 + k];
      return a === null || b === null ? null : a - b;
    });
  });
  const matches = orderMatches(
    deltas,
    mk.cells.map((c) => c.offset),
  );
  const un = await undoAndCompare(ctx, tx, ty, before.rows);
  const observed = {
    tile: [tx, ty],
    side: g.side,
    sharedEdges: sharedEdges(g),
    undoName: rb(w).undoName ?? null,
    landed: landed.ok ? true : landed.why,
    deltas,
    matches,
    undone: un.ok ? true : `${un.left} sample(s) left; ${un.undo.message}`,
  };
  if (matches.length === 1) ctx.state.set("w7.order", matches[0]);
  const p1 = !landed.ok
    ? killed("P-W7-01", observed, `the write did not land as sent: ${landed.why}`)
    : !un.ok
      ? killed("P-W7-01", observed, "one undo did not restore the samples")
      : matches.length !== 1
        ? partial(
            "P-W7-01",
            observed,
            `effect and undo pass; the order is ${matches.length ? `ambiguous (${matches.join(", ")})` : "unmatched"}: the owner reads the deltas`,
          )
        : settled("P-W7-01", observed, `effect, one undo and order ${matches[0]}`);
  return { ...verdictOf(fails, [p1], p1.note), evidence, probes: [p1] };
}

async function seamsBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  if (g.tilesX < 2) {
    const p2 = partial("P-W7-02", { tilesX: g.tilesX }, "one tile column: no seam to read");
    return { ...verdictOf(fails, [p2], p2.note), evidence, probes: [p2] };
  }
  const rows = new Set([2]);
  const a0 = await readTile(ctx, 0, 0, rows);
  const b0 = await readTile(ctx, 1, 0, rows);
  const ra = a0.rows.get(2);
  if (!ra)
    return { status: "FAIL", detail: `tile 0,0 row 2 does not read: ${S(a0.error)}`, evidence };
  const last = g.side - 1;
  const w = await writePatches(
    ctx,
    [patchText(0, 0, 2, last, [ra[last] + 0.5])],
    "P-W7-02",
    evidence,
  );
  if (!w.ok) {
    if (w.code !== "GATED") fails.push(`tileWrite: ${why(w)}`);
    const p2 = partial("P-W7-02", { write: gateAnswer(w) }, `not written: ${S(w.code)}`);
    return { ...verdictOf(fails, [p2], p2.note), evidence, probes: [p2] };
  }
  const a1 = await readTile(ctx, 0, 0, rows);
  const b1 = await readTile(ctx, 1, 0, rows);
  const da = tileDiff(a0.rows, a1.rows);
  const db = tileDiff(b0.rows, b1.rows);
  const u = await ctx.undo();
  const a2 = await readTile(ctx, 0, 0, rows);
  const b2 = await readTile(ctx, 1, 0, rows);
  const left = tileDiff(a0.rows, a2.rows).length + tileDiff(b0.rows, b2.rows).length;
  if (!u.ok || left) fails.push(`one undo left ${left} sample(s)`);
  const observed = { sharedEdges: sharedEdges(g), onA: da, onB: db };
  const p2 =
    da.length === 1
      ? settled(
          "P-W7-02",
          observed,
          db.length
            ? "the neighbour's shared sample followed the write"
            : "the neighbour's copy did not follow: the TS patcher writes both copies of a shared edge",
        )
      : killed("P-W7-02", observed, `the edge write moved ${da.length} sample(s) on tile A`);
  return { ...verdictOf(fails, [p2], p2.note), evidence, probes: [p2] };
}

async function ceilingBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const [tx, ty] = interiorTile(g);
  const before = await readTile(ctx, tx, ty);
  if (before.error)
    return { status: "FAIL", detail: `tile ${tx},${ty}: ${before.error}`, evidence };
  const sizes: Raw[] = [];
  let maxPassed = 0;
  let gated = false;
  for (const n of [1, 16, 64]) {
    const rowsIdx = [...before.rows.keys()].sort((a, b) => a - b).slice(0, n);
    if (rowsIdx.length < n) break;
    const patches = rowsIdx.map((r) =>
      patchText(
        tx,
        ty,
        r,
        0,
        before.rows.get(r)!.map((v) => v + 0.01),
      ),
    );
    const t0 = ctx.deps.now();
    const r = await ctx.tool("wb_terrain_edit", {
      action: "tileWrite",
      patches,
      undoLabel: `P-W7-04 ${n}`,
      confirm: true,
    });
    const ms = ctx.deps.now() - t0;
    if (!r.ok && r.code === "GATED") {
      gated = true;
      sizes.push({ n, answer: "gated" });
      break;
    }
    if (!r.ok) {
      sizes.push({ n, answer: why(r), ms });
      break;
    }
    const un = await undoAndCompare(ctx, tx, ty, before.rows);
    sizes.push({ n, samples: num(rb(r).samples), ms, undone: un.ok });
    if (!un.ok) {
      fails.push(`size ${n}: one undo left ${un.left} sample(s)`);
      break;
    }
    maxPassed = n;
  }
  const observed = { side: g.side, sizes, maxPassed };
  const p4 = gated
    ? partial("P-W7-04", observed, "GATED: TERRAIN_WRITE_OPEN is false or the route is absent")
    : maxPassed > 0
      ? settled(
          "P-W7-04",
          observed,
          `${maxPassed} patch(es) of ${g.side} samples passed in one call`,
        )
      : partial("P-W7-04", observed, "no size passed");
  return { ...verdictOf(fails, [p4], p4.note), evidence, probes: [p4] };
}

async function brushBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const radius = 6;
  const modes: Array<{ mode: string; extra: Raw }> = [
    { mode: "sculpt", extra: { delta: "1", strength: "0.5", falloff: "smooth" } },
    { mode: "flatten", extra: { strength: "0.5", falloff: "smooth" } },
    { mode: "smooth", extra: { passes: 2, strength: "0.5", falloff: "smooth" } },
    { mode: "noise", extra: { delta: "0.5", scale: "4", seed: 7, falloff: "smooth" } },
  ];
  const per: Raw = {};
  const misses: string[] = [];
  let gated = false;
  const cz = (g.minZ + g.maxZ) / 2;
  for (const [i, m] of modes.entries()) {
    const cx = g.minX + (g.maxX - g.minX) * (0.3 + 0.1 * i);
    const tiles = tilesUnder(g, cx, cz, radius);
    const before = new Map<string, Map<number, number[]>>();
    for (const [tx, ty] of tiles) before.set(`${tx},${ty}`, (await readTile(ctx, tx, ty)).rows);
    const args = {
      action: "brush",
      mode: m.mode,
      centre: `${ftext(cx)} ${ftext(cz)}`,
      radius: String(radius),
      ...m.extra,
    };
    const dry = await ctx.tool("wb_terrain_edit", args);
    const asc = ascPathOf(dry);
    let conf: ToolResponse | null = null;
    if (dry.ok || dry.code === "GATED")
      conf = await ctx.tool("wb_terrain_edit", { ...args, confirm: true });
    const k2 = asc || ascPathOf(conf);
    if (k2 && !ctx.deps.exists(join(ctx.opts.sittingDir, K2_FILE))) {
      const [h] = await heights(ctx, [[cx, cz]]);
      writeJson(
        join(ctx.opts.sittingDir, K2_FILE),
        { asc: k2, centre: [cx, cz], heightBefore: h },
        ctx.deps,
      );
    }
    if (!conf || !conf.ok) {
      if (conf?.code === "GATED" || dry.code === "GATED") gated = true;
      else fails.push(`${m.mode}: ${why(conf ?? dry)}`);
      per[m.mode] = { dry: brief(dry), confirm: brief(conf), asc: k2 || null };
      continue;
    }
    const deltas: number[] = [];
    for (const [tx, ty] of tiles) {
      const a = (await readTile(ctx, tx, ty)).rows;
      for (const d of tileDiff(before.get(`${tx},${ty}`)!, a)) deltas.push(d.delta);
    }
    const est = estimateOf(rb(dry).samples !== undefined ? rb(dry) : rb(conf));
    const seen = observedStats(deltas);
    const miss = estimateMisses(est, seen);
    // The undo points this brush left (it may split into several calls, P-W7-04).
    const left: number[] = [];
    while (ctx.debt.undos > 0) {
      const u = await ctx.undo();
      if (!u.ok) break;
    }
    for (const [tx, ty] of tiles)
      left.push(tileDiff(before.get(`${tx},${ty}`)!, (await readTile(ctx, tx, ty)).rows).length);
    if (left.some((n) => n > 0))
      fails.push(`${m.mode}: the undo left ${left.reduce((s, n) => s + n, 0)} sample(s)`);
    per[m.mode] = { estimate: est, seen, miss, tiles };
    if (miss.length) misses.push(`${m.mode}: ${miss.join(", ")}`);
  }
  const observed = { modes: per };
  const p16 = misses.length
    ? killed("P-W7-16", observed, misses.join("; "))
    : gated
      ? partial(
          "P-W7-16",
          observed,
          "GATED: the brush writes wait for P-W7-01 (a .asc in next is kept for H1)",
        )
      : settled("P-W7-16", observed, "every mode's live change equals its estimate to 1 mm");
  return { ...verdictOf(fails, [p16], p16.note), evidence, probes: [p16] };
}

async function flatterBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const cx = (g.minX + g.maxX) / 2;
  const cz = (g.minZ + g.maxZ) / 2;
  // The steepest of five candidate spots (a box "on a slope", spec 6).
  const cands: Array<[number, number]> = [
    [cx, cz],
    [cx + 30, cz],
    [cx - 30, cz],
    [cx, cz + 30],
    [cx, cz - 30],
  ];
  const probe = cands.flatMap(
    ([x, z]) =>
      [
        [x - 3, z],
        [x + 3, z],
        [x, z - 3],
        [x, z + 3],
      ] as Array<[number, number]>,
  );
  const hs = await heights(ctx, probe);
  let best = 0;
  let slope = -1;
  cands.forEach((_, i) => {
    const q = hs.slice(i * 4, i * 4 + 4);
    if (q.some((v) => v === null)) return;
    const s = Math.abs(q[1]! - q[0]!) + Math.abs(q[3]! - q[2]!);
    if (s > slope) {
      slope = s;
      best = i;
    }
  });
  const [bx, bz] = cands[best];
  const grid: Array<[number, number]> = [];
  for (const dx of [-1.5, 0, 1.5]) for (const dz of [-1.5, 0, 1.5]) grid.push([bx + dx, bz + dz]);
  const h0 = await heights(ctx, grid);
  const totalBefore = await entityTotal(ctx);
  const box = await create(ctx, "Flat", `${ftext(bx)} ${ftext(h0[4] ?? 0)} ${ftext(bz)}`);
  evidence.box = brief(box.r);
  let p6: ProbeResult = partial("P-W7-06", {}, "no box");
  if (!box.ref) fails.push(`create: ${why(box.r)}`);
  else {
    const base = { action: "flatter", entity: box.ref };
    const { dry, conf } = await dryThenConfirm(
      ctx,
      {
        ...base,
        op: "add",
        mins: "-2 -1 -2",
        maxs: "2 1 2",
        priority: 0,
        falloffStart: "1",
        falloff: "3",
      },
      evidence,
      "add",
    );
    const add = conf ?? dry;
    if (!add.ok && add.code === "GATED")
      p6 = partial("P-W7-06", { add: "gated" }, "GATED: FLATTER_OPEN is false");
    else if (!add.ok) fails.push(`flatter add: ${why(add)}`);
    else {
      const h1 = await heights(ctx, grid);
      const rem = await ctx.tool("wb_terrain_edit", { ...base, op: "remove", confirm: true });
      evidence.remove = brief(rem);
      const h2 = await heights(ctx, grid);
      const moved = (a: Array<number | null>, b: Array<number | null>) =>
        a.filter((v, i) => v !== null && b[i] !== null && Math.abs(v - b[i]!) > CHANGE_EPS).length;
      // The box's create plus the flatter add and remove: three undo points, paid by settle.
      await settle(ctx, evidence, fails, totalBefore);
      const h3 = await heights(ctx, grid);
      const observed = {
        spot: [bx, bz],
        slope,
        addMoved: moved(h0, h1),
        removeMoved: moved(h1, h2),
        leftAfterUndo: moved(h0, h3),
      };
      p6 =
        observed.addMoved === 0
          ? killed("P-W7-06", observed, "flatter add changed no height under the box")
          : observed.leftAfterUndo > 0
            ? killed("P-W7-06", observed, "the undos left heights changed")
            : settled(
                "P-W7-06",
                observed,
                `add moved ${observed.addMoved} of 9 points; remove ${observed.removeMoved}; undone`,
              );
      return { ...verdictOf(fails, [p6], p6.note), evidence, probes: [p6] };
    }
  }
  await settle(ctx, evidence, fails, totalBefore);
  return { ...verdictOf(fails, [p6], p6.note), evidence, probes: [p6] };
}

async function masksBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const out = await ctx.tool("wb_terrain_edit", { action: "exportMasks", directory: "../outside" });
  evidence.outside = brief(out);
  if (out.ok || !["NOT_IN_PROJECT", "INVALID_ARGUMENT"].includes(S(out.code)))
    fails.push(`../outside: ${out.ok ? "ok" : why(out)}`);
  const dir = abs(ctx.opts.sandboxDir, MASKS_DIR);
  const pre = ctx.deps.listTree(dir);
  const { dry, conf } = await dryThenConfirm(
    ctx,
    { action: "exportMasks", directory: MASKS_DIR },
    evidence,
    "masks",
  );
  const afterDry = conf ? pre : ctx.deps.listTree(dir);
  if (!conf && afterDry.length !== pre.length) fails.push("the dry run wrote files");
  const r = conf ?? dry;
  let p8: ProbeResult;
  if (!r.ok && r.code === "GATED")
    p8 = partial("P-W7-08", { exportMasks: "gated" }, "GATED: MASKS_OPEN is false");
  else if (!r.ok) {
    fails.push(`exportMasks: ${why(r)}`);
    p8 = partial("P-W7-08", {}, why(r));
  } else {
    const files = ctx.deps.listTree(dir).filter((f) => !pre.includes(f));
    const observed = { exported: rb(r).exported ?? null, files };
    p8 = files.length
      ? settled("P-W7-08", observed, `${files.length} mask file(s) under ${MASKS_DIR}/`)
      : killed("P-W7-08", observed, `no file under ${MASKS_DIR}/`);
  }
  return { ...verdictOf(fails, [p8], p8.note), evidence, probes: [p8] };
}

async function persistBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const [tx, ty] = interiorTile(g);
  const want = new Set([1, g.side - 2]);
  const before = await readTile(ctx, tx, ty, want);
  const mk = before.error ? null : markerPatches(g, tx, ty, before.rows);
  if (!mk)
    return { status: "FAIL", detail: `the marker rows do not read: ${S(before.error)}`, evidence };
  const w = await ctx.tool("wb_terrain_edit", {
    action: "tileWrite",
    patches: mk.patches,
    undoLabel: "P-W7-01 persist",
    confirm: true,
  });
  evidence.write = brief(w);
  if (!w.ok) {
    if (w.code !== "GATED") fails.push(`tileWrite: ${why(w)}`);
    const p1 = partial("P-W7-01", { persist: gateAnswer(w) }, `not written: ${S(w.code)}`);
    return { ...verdictOf(fails, [p1], p1.note), evidence, probes: [p1] };
  }
  const sv = await ctx.tool("wb_module", { action: "save", module: "WorldEditor", confirm: true });
  evidence.save = brief(sv);
  // Saved: the write is on disk now; undoing it would make the world dirty again.
  ctx.debt.undos = 0;
  if (!sv.ok) {
    fails.push(`save: ${why(sv)}`);
    return { ...verdictOf(fails, [], ""), evidence };
  }
  if (!(await ensureOpen(ctx, ENTITY_WORLD, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  if (!(await ensureOpen(ctx, ctx.opts.terrainWorld!, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  const back = await readTile(ctx, tx, ty, want);
  const landed = markersLanded(mk.cells, before.rows, back.rows);
  const observed = { tile: [tx, ty], persisted: landed.ok ? true : landed.why };
  const p1 = landed.ok
    ? settled(
        "P-W7-01",
        observed,
        "the markers persist after save and reopen (restore removes them)",
      )
    : killed("P-W7-01", observed, `after reopen: ${landed.why}`);
  return { ...verdictOf(fails, [p1], p1.note), evidence, probes: [p1] };
}

async function mapsBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const g = await terrainReady(ctx, evidence, fails);
  if (!g) return { ...verdictOf(fails, [], ""), evidence };
  const folderRel = ctx.opts.terrainWorld!.split("/").slice(0, -1).join("/");
  const folder = abs(ctx.opts.sandboxDir, folderRel);
  const hashDir = (): Record<string, string> =>
    Object.fromEntries(
      ctx.deps
        .listTree(folder)
        .map((f) => [f, sha256(ctx.deps.readBytes(join(folder, ...f.split("/"))))]),
    );
  const per: Raw = {};
  let gated = false;
  let bad = "";
  for (const kind of ["shore", "flow"] as const) {
    const h0 = hashDir();
    const args = { action: "maps", kind, ...(kind === "flow" ? { preview: false } : {}) };
    const dry = await ctx.tool("wb_terrain_edit", args);
    const h1 = hashDir();
    if (changedFiles(h0, h1).length) fails.push(`${kind}: the dry run changed files`);
    if (!dry.ok && dry.code !== "GATED") {
      fails.push(`${kind} dry: ${why(dry)}`);
      continue;
    }
    const conf = await ctx.tool("wb_terrain_edit", { ...args, confirm: true });
    const changed = changedFiles(h1, hashDir());
    per[kind] = { dry: brief(dry), confirm: brief(conf), changed };
    if (!conf.ok && conf.code === "GATED") {
      gated = true;
      continue;
    }
    if (!conf.ok) {
      fails.push(`${kind}: ${why(conf)}`);
      continue;
    }
    if (!truthy(rb(conf).built)) bad ||= `${kind}: built is not true`;
    else if (!changed.length) bad ||= `${kind}: no file of the world's folder changed`;
  }
  const observed = { kinds: per };
  const p7 = bad
    ? killed("P-W7-07", observed, bad)
    : gated
      ? partial("P-W7-07", observed, "GATED: MAPS_OPEN is false")
      : settled(
          "P-W7-07",
          observed,
          "shore and flow built from the handler, files written, no dialog",
        );
  return { ...verdictOf(fails, [p7], p7.note), evidence, probes: [p7] };
}

async function restoreBody(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const backup = readJson<SittingBackup>(join(ctx.opts.sittingDir, BACKUP_FILE), ctx.deps);
  if (!backup || !backup.backupId)
    return {
      status: "FAIL",
      detail: `no ${BACKUP_FILE} in the sitting: nothing to restore from`,
      evidence,
    };
  if (!isTerrainWorldRel(backup.world))
    throw new StopBattery(
      "stopped",
      `the sitting backup's world ${backup.world} is not under ${W7_ROOT}/: restore refused`,
    );
  // Close the terrain world: the entity world takes its place in the World Editor.
  if (!(await ensureEntityWorld(ctx, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  const dry = await ctx.tool("wb_terrain_edit", { action: "restore", backupId: backup.backupId });
  evidence.dry = brief(dry);
  if (!dry.ok) {
    fails.push(`restore dry run: ${why(dry)}`);
    return { ...verdictOf(fails, [], ""), evidence };
  }
  const conf = await ctx.tool("wb_terrain_edit", {
    action: "restore",
    backupId: backup.backupId,
    confirm: true,
  });
  evidence.confirm = brief(conf);
  if (!conf.ok) {
    fails.push(`restore: ${why(conf)}`);
    return { ...verdictOf(fails, [], ""), evidence };
  }
  const mismatch = manifestMismatch(backup, ctx.deps);
  evidence.manifest = {
    files: Object.keys(backup.manifest).length,
    mismatch: mismatch.map((p) => toPlaceholders(p, ctx.opts.ph)),
    // Files of the set the backup does not hold (maps or masks the session made): restore leaves
    // them; they lie under _throwaway/W7/ and are recorded, not failed.
    extra: rb(conf).extra ?? [],
    safetyBackup: rb(conf).safetyBackup ?? null,
  };
  if (mismatch.length)
    fails.push(`${mismatch.length} file(s) differ from the manifest after restore`);
  if (!(await ensureOpen(ctx, backup.world, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  const ref = readJson<{ rows: Record<string, Record<string, number[]>> }>(
    join(ctx.opts.sittingDir, BEFORE_FILE),
    ctx.deps,
  );
  if (!ref)
    fails.push(`no ${BEFORE_FILE}: the W7.1 rows were not kept (run w7-11 before the writes)`);
  else
    for (const [key, rows] of Object.entries(ref.rows)) {
      const [tx, ty] = key.split(",").map(Number);
      const now = await readTile(ctx, tx, ty, new Set([0, 1]));
      const was = new Map(Object.entries(rows).map(([r, v]) => [Number(r), v]));
      const d = tileDiff(was, now.rows).length;
      if (now.error || d)
        fails.push(`tile ${key}: ${now.error ?? `${d} sample(s) differ from the W7.1 read`}`);
    }
  return {
    ...verdictOf(
      fails,
      [],
      `restored ${Object.keys(backup.manifest).length} file(s); manifest and rows match`,
    ),
    evidence,
  };
}

async function h1Body(ctx: StepContext): Promise<StepOutcome> {
  const result = readJson<{ probes?: Record<string, { result?: string }> }>(
    join(ctx.opts.sittingDir, RESULT_FILE),
    ctx.deps,
  );
  const p1 = result?.probes?.["P-W7-01"]?.result ?? "NOT-RUN";
  const k2 = readJson<{ asc?: string; centre?: [number, number]; heightBefore?: number | null }>(
    join(ctx.opts.sittingDir, K2_FILE),
    ctx.deps,
  );
  if (p1 !== "KILLED" || !k2?.asc)
    return {
      status: "NOT-RUN",
      detail: `K2 only: P-W7-01 is ${p1} and ${k2?.asc ? `the .asc is ${k2.asc}` : `${K2_FILE} names no .asc`}`,
      evidence: { p1, k2 },
    };
  const evidence: Raw = { asc: k2.asc };
  const fails: string[] = [];
  if (!(await ensureOpen(ctx, ctx.opts.terrainWorld!, evidence, fails)))
    return { ...verdictOf(fails, [], ""), evidence };
  const a = await awaitHand(
    ctx,
    H1_STEP,
    `In the World Editor (world ${ctx.opts.terrainWorld}), open Terrain Tool, Manage, and import the height map ${k2.asc} (the TS-written ESRI ASCII grid) on terrain 0; confirm the import dialog only; never save. Then write {"imported": true} or {"imported": false, "why": "<what you saw>"}`,
  );
  evidence.answer = a;
  if (!a || a.imported !== true)
    return {
      status: "NOT-RUN",
      detail: a ? `not imported: ${S(a.why)}` : "no hand answer within the wait",
      evidence,
    };
  const centre = k2.centre ?? [0, 0];
  const [h] = await heights(ctx, [centre]);
  evidence.height = { before: k2.heightBefore ?? null, after: h };
  if (
    h === null ||
    k2.heightBefore === null ||
    k2.heightBefore === undefined ||
    Math.abs(h - k2.heightBefore) <= CHANGE_EPS
  )
    fails.push("the height at the brush centre did not move after the import");
  return {
    ...verdictOf(fails, [], `K2 import landed; now --only ${RESTORE_STEP} in a new run folder`),
    evidence,
  };
}

/**
 * The last step, also run after a stop: leave Workbench closable by WM_CLOSE. The open world (if
 * any) is replaced by a fresh load of the entity world (else vanilla EmptyArland). Nothing is saved.
 */
export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W7.9",
    title:
      "leave Workbench closable: the open world replaced by a fresh load (the entity world, else vanilla EmptyArland); never save",
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
    plan: () => [tc("wb_world", "state"), ...openPlan(ENTITY_WORLD)],
    run: async (ctx) => leaveClosable(ctx),
  };
}

export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateBefore = brief(st0);
  const open = worldRelOf(S(rb(st0).worldPath), ctx.opts.sandboxDir).toLowerCase();
  if (!st0.ok || open === "")
    return {
      status: "PASS",
      detail: "no world is open: nothing in the World Editor to leave",
      evidence,
    };
  const target =
    open !== ENTITY_WORLD.toLowerCase() && ctx.deps.exists(abs(ctx.opts.sandboxDir, ENTITY_WORLD))
      ? ENTITY_WORLD
      : VANILLA_WORLD;
  evidence.target = target;
  const o = await openWorld(ctx, target);
  evidence.open = o.evidence;
  if (!o.ok) fails.push(`${target} did not open ('${o.worldPath}')`);
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

export function offlinePlan(
  steps: StepDef[] = buildSteps(),
): Array<OfflineCall & { step: string }> {
  return steps.flatMap((s) => (s.offlineCalls?.() ?? []).map((c) => ({ ...c, step: s.id })));
}

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
    `${SESSION}: Terrain editing, shapes, generators battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map(
      (s) =>
        `  [${s.block}] ${s.id} (${s.risk}${s.hand ? ", hand" : ""}${s.owner?.length ? `, needs ${s.owner.join("+")}` : ""})${s.probes.length ? ` {${s.probes.join(", ")}}` : ""}: ${s.title}`,
    ),
    `  not testable in this battery: ${Object.keys(NOT_TESTABLE).join(", ") || "none"}`,
    `  not exercised: ${Object.keys(NOT_EXERCISED).join(", ") || "none"}`,
    `  engine accept: ${Object.entries(ENGINE_ACCEPT)
      .map(([tool, e]) => `${tool} ${e.step ?? `not testable (${e.probe ?? "see reason"})`}`)
      .join("; ")}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w7.live.ts --emit-queue` from its step table; tests/live-harness/w7-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W7 is not in PROBE_MUT_SESSIONS and sends no ECEN_Probe call. `owner` names the owner items a step needs (DEC-075): without them the step records BLOCKED and sends nothing.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w7-spec.md 3.1, 3.2, 6, 7",
      "DEC-053",
      "DEC-058",
      "DEC-061",
      "DEC-075",
      "PLAN 5.3",
      "PLAN 5.4",
      "PLAN 5.7",
    ],
    launches: 1,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "pre-flight builds the real arguments; -scriptAuthorizeAll on the owner's standing go (DEC-053)",
    owner_items: {
      "OI-W7-1": "the throwaway terrain world under _throwaway/W7/ (--terrain-world), made by hand",
      "OI-W7-2":
        "the terrain go: one line in the session log (--session-log) naming OI-W7-2, go and the world",
    },
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
      ...(s.owner?.length ? { owner: [...s.owner] } : {}),
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

function killedProbes(
  runDir: string,
  deps: Pick<W7Deps, "exists" | "readBytes">,
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

async function cleanupAfterStop(ctx: StepContext, deps: W7Deps): Promise<Raw> {
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

export const SAVE_PROMPT_TITLES: readonly string[] = ["Loading world"];

/**
 * What the owner's hand does with a HANDOFF window (H2): the dialog's exact title, the button ("No"
 * / "Don't Save" on a save prompt; "Cancel" or the window's close on any other dialog: never Save,
 * never OK) and the resume.
 */
export function handAnswer(
  message: string,
  stepId: string,
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1] : "";
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt ? "No" : "Cancel (or the window's close button); never Save, never OK";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `H2: the engine's save prompt "${title}": press No / Don't Save (never Save, never Yes, never Cancel), then resume ${resume}`
    : `H2: window "${title}": ${answer}; the NET queue is blocked until it goes (DEC-042 U6); then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
}

function makeCtx(
  deps: W7Deps,
  opts: W7Options,
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
      // The harness guard (spec 6): a confirmed terrain write or a save only on a world under
      // _throwaway/W7/, read from GetWorldPath before sending. Always on, also after a stop.
      if (isGuardedCall(name, args)) {
        const st = await deps.tool("wb_world", { action: "state" });
        const refusal = throwawayRefusal(S(rb(st).worldPath), opts.sandboxDir);
        calls.push({ guard: `${name} ${S(args.action)}`, worldPath: S(rb(st).worldPath), refusal });
        if (refusal) {
          calls.push({ notSent: `${name} ${S(args.action)}` });
          throw new StopBattery(
            "stopped",
            `harness guard: ${name} ${S(args.action)} refused before sending: ${refusal}`,
          );
        }
      }
      const r = await deps.tool(name, args, o.freshSession ? { freshSession: true } : undefined);
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
      if (r.ok && !o.restore && !truthy(rb(r).dryRun)) {
        const names = rb(r).undoNames;
        if (Array.isArray(names) && names.length) debt.undos += names.length;
        else if (S(rb(r).undoName) || UNDO_EDITS.has(`${name}.${S(args.action)}`)) debt.undos++;
      }
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

async function closeOutAfterStop(
  deps: W7Deps,
  opts: W7Options,
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

async function handWatched<T>(deps: W7Deps, pid: number, fn: () => Promise<T>): Promise<T> {
  const before = baselineRefusal(await deps.windows(), pid);
  if (before) throw new StopBattery("handoff", before);
  const value = await fn();
  const after = baselineRefusal(await deps.windows(), pid);
  if (after) throw new StopBattery("handoff", `after the hand step: ${after}`);
  return value;
}

export async function runBattery(
  steps: StepDef[],
  deps: W7Deps,
  opts: W7Options,
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
  if (steps.length && steps[0].id !== GATE_STEP)
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
    const blocked = s.owner?.length ? ownerBlock(s.owner, ownerInput(opts, deps)) : null;
    if (blocked) {
      write({
        ...base,
        status: "BLOCKED",
        detail: blocked,
        endedAt: startedAt,
        probes: [],
        evidence: {},
      });
      continue;
    }
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

/** `<sitting>/w7-result.json`: every step's latest record across the sitting's run folders, and each probe's result. */
export function writeResult(
  opts: W7Options,
  deps: Pick<W7Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
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
    const blocked = steps
      .filter((s) => s.probes.includes(id) && latest.get(s.id)?.status === "BLOCKED")
      .map((s) => latest.get(s.id)!.detail.split(" ")[0]);
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
        : blocked.length
          ? {
              result: [...new Set(blocked)].join(", "),
              steps: steps.filter((s) => s.probes.includes(id)).map((s) => s.id),
            }
          : {
              result: "NOT-RUN",
              steps: steps.filter((s) => s.probes.includes(id)).map((s) => s.id),
            };
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

/**
 * `plant`: the battery's worlds folder under _throwaway/W7/ and the plant record (no Workbench
 * running). The owner's terrain world (OI-W7-1) is never written here.
 */
export async function runPlant(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): Promise<number> {
  io.log(
    `plant: folder <sandbox>/${WORLDS_DIR}/ (the entity world is written there by wb_world new)`,
  );
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the plant is offline`);
    return EXIT.refused;
  }
  for (const d of BATTERY_DIRS)
    if (io.exists(abs(sandboxDir, d))) {
      io.log(`refused: <sandbox>/${d}/ exists: roll the last sitting back first`);
      return EXIT.refused;
    }
  const record = {
    dirs: [WORLDS_DIR],
    throwawayExistedBefore: io.exists(abs(sandboxDir, THROWAWAY)),
    w7ExistedBefore: io.exists(abs(sandboxDir, W7_ROOT)),
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  io.makeDir(abs(sandboxDir, WORLDS_DIR));
  io.log(`made <sandbox>/${WORLDS_DIR}/`);
  return EXIT.done;
}

/**
 * `rollback`: list (with hashes) and remove what the battery created (_throwaway/W7/worlds/ and
 * masks/), never the owner's terrain world; _throwaway/W7/ and _throwaway/ only when empty and
 * absent before the plant.
 */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const present = BATTERY_DIRS.filter((d) => io.exists(abs(sandboxDir, d)));
  if (!present.length) {
    io.log(
      `nothing to roll back: ${BATTERY_DIRS.map((d) => `<sandbox>/${d}/`).join(" and ")} absent`,
    );
    return EXIT.done;
  }
  const files = present.flatMap((d) => io.listTree(abs(sandboxDir, d)).map((f) => `${d}/${f}`));
  io.log(
    `rollback: list and remove ${present.map((d) => `<sandbox>/${d}/`).join(", ")} (${files.length} files)`,
  );
  if (!really) {
    io.log("dry run: nothing removed");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return EXIT.refused;
  }
  const listing = files.map((rel) => ({ rel, sha256: sha256(io.readBytes(abs(sandboxDir, rel))) }));
  io.writeBytes(
    join(sittingDir, "throwaway-w7-listing.json"),
    Buffer.from(JSON.stringify(listing, null, 2) + "\n"),
  );
  for (const d of present) io.removeTree(abs(sandboxDir, d));
  type PlantRecord = { throwawayExistedBefore?: boolean; w7ExistedBefore?: boolean };
  const plant = ((): PlantRecord | null => {
    try {
      return JSON.parse(
        io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8"),
      ) as PlantRecord;
    } catch {
      return null;
    }
  })();
  const w7 = abs(sandboxDir, W7_ROOT);
  if (plant?.w7ExistedBefore === false && io.exists(w7) && io.listDir(w7).length === 0)
    io.removeTree(w7);
  const top = abs(sandboxDir, THROWAWAY);
  if (plant?.throwawayExistedBefore === false && io.exists(top) && io.listDir(top).length === 0)
    io.removeTree(top);
  io.log(
    "removed the battery's folders (listing in throwaway-w7-listing.json); the terrain world is untouched",
  );
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

/**
 * The options the battery gives wb_terrain_edit: the sandbox as the project, the backups in the
 * artifacts folder (outside the project), the NO_BACKUP record of THIS process (one tool session;
 * a resumed run is a new one, OD-4). Policy, tile order and gates stay the shipped defaults: a probe
 * build flips them in the shipped files, never here.
 */
export function terrainEditOptions(
  sandboxDir: string,
  session: TerrainBackupRecord,
): TerrainEditOptions {
  return { projectPath: sandboxDir, artifactsDir: artifactsDir(), session };
}

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W7Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const worldDeps = { projectRoot: input.sandboxDir, artifactsRoot: artifactsDir() };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  // One tool session per battery process; `freshSession` runs with a new, empty record (NO_BACKUP).
  const session = new TerrainBackupRecord();
  return {
    tool: async (name, args, o) => {
      switch (name) {
        case "wb_terrain_edit":
          return asResp(
            await runTerrainEdit(
              client,
              args,
              terrainEditOptions(
                input.sandboxDir,
                o?.freshSession === true ? new TerrainBackupRecord() : session,
              ),
            ),
          );
        case "wb_generator":
          return asResp(await runGenerator(client, args));
        case "wb_shape":
          return asResp(await runShape(client, args, { projectPath: input.sandboxDir }));
        case "wb_entity":
          return asResp(await runEntity(client, args));
        case "wb_terrain":
          return asResp(await runTerrain(client, args));
        case "wb_world":
          return asResp(await runWorld(client, args, worldDeps));
        case "wb_module":
          return asResp(await runModule(client, args as unknown as ModuleArgs));
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
    handlerSource: (h) => {
      const p = join(REPO_ROOT, "mod", "Scripts", "WorkbenchGame", "EnfusionMCP", `${h}.c`);
      return existsSync(p) ? readFileSync(p, "utf-8") : null;
    },
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
  "terrain-world",
  "session-log",
] as const;
const FLAGS = ["really", "skip-hand", "update-baseline"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: W7Deps;
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
  const terrainWorld = o["terrain-world"] ? o["terrain-world"].replace(/\\/g, "/") : null;
  if (terrainWorld && !isTerrainWorldRel(terrainWorld)) {
    say(
      `--terrain-world must be a project-relative .ent under ${W7_ROOT}/ (outside ${WORLDS_DIR}/)`,
    );
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
  const sittingDir = resolve(o["sitting-dir"]);
  if (!existsSync(join(sittingDir, PLANT_FILE))) {
    say(
      toPlaceholders(
        `refused: ${sittingDir} holds no ${PLANT_FILE}: run \`w7.live.ts plant\` first`,
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
      terrainWorld,
      sessionLog: o["session-log"] ? resolve(o["session-log"]) : null,
      skipHand: args.flags.has("skip-hand"),
    });
    for (const l of resultTable(r.records)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w7",
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

// Census rows this file tests (W7 close-out, EV-W7-107).
// census:mcp:action/wb_terrain_edit.tileRead
// census:mcp:handler-action/EMCP_WB_TerrainEdit.tileRead
