/**
 * Wave W4 (Animation, Procedural Animation, Behavior), the live battery
 * (docs/v2/design/phase5-w4-spec.md section 6, DEC-058, DEC-067). Built on the W2 battery
 * (tests/live/w2.live.ts, run live through four fix-up rounds): the same CLI, the same evidence, the
 * same hand mechanism, the same stop rules.
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch profile with `-scriptAuthorizeAll` (DEC-053 ruling 2, the standing go), with the
 * shipped bundle installed and NO probe pack. This script never launches, never takes the lease for
 * itself (the lane given with --id holds it) and reaches Workbench through the shipped TS tools run
 * IN PROCESS (`runAnim`, `runAnimDebug`, `runModule`, `runContainer`, `runResources`, `runWorld`,
 * `runEntity`, `runBi`) over a `WorkbenchClient` WITHOUT a Config (no lease, no auto-launch, no
 * handler recovery), so each step tests the TS mapping and the handler together. The W4 offline
 * tools (`animation_workspace`, `animation_set`, `animation_graph`, `behavior_tree`, `procanim`,
 * `animation_find_unused_clips`, `weapon_pose_lint`) run in process on the test project's folder,
 * passed in as `projectPath`; no handler or tool names it.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan and the queue with preflight's validateQueue; `--out` writes
 * the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/W4-queue.json;
 * a test keeps the two equal). The runbook is docs/v2/sessions/queues/W4.md.
 *
 * Gates (DEC-067; the build this battery targets has every one closed). A GATED action is sent only
 * for its refusal: wb_anim check and a txaEdit confirm (TS ANIM_GATES), wb_anim_debug set, command
 * and btBreakpoint (TS ANIM_DEBUG_GATES), wb_module save on the three editors (Enforce, sent as a dry
 * run), wb_container on open:AnimEditor/BehaviorEditor/ProcAnimEditor (Enforce; reads only). The
 * txa* actions need the owner's .apr profile (OI-W4-1): with none in a loaded addon their steps are
 * recorded NOT-RUN `blocked:OI-W4-1`.
 *
 * Blocks (one launch; each block is ordered read-only, reversible, mutating for the queue):
 *   W4.0 setup     the test-bed gate (EMCP_WB_Info names EMCP2_sandbox, build stamp, the plant), the
 *                  sandbox snapshot, the compile gate (P-W4-01), the offline read of the 1.9
 *                  ExportTXAResource body (P-W4-22), the fixtures: animation_workspace duplicate of the
 *                  tripods set (P-W4-16), behavior_tree create + register (P-W4-17), procanim create,
 *                  the planted .ae/.aex/.asy copies registered
 *   W4.1 txa       txaProfiles, txaChannels (P-W4-02, P-W4-03)
 *   W4.3 txa write txaExport into _throwaway/W4/txa/ (P-W4-04)
 *   W4.4 txa read  txaRead of the export, txaEdit dry runs and its GATED confirm (P-W4-05, P-W4-06)
 *   W4.2 editors   wb_module list/info, then each editor opens its fixture (P-W4-07 to P-W4-10, P-W4-15;
 *                  the ProcAnim Editor last), then the refusals of the gated actions (with front)
 *   W4.5 offline   the two read-only lint tools first, then the engine-accept proofs of the offline
 *                  tools: each edits a throwaway copy that the
 *                  engine has never loaded, then registers it and reads the changed value back with
 *                  wb_container describe on path: (P-W4-24, P-W4-25, P-W4-26, P-W4-28)
 *   W4.6 play      a character and a compass created in the W4 world, play, wb_anim_debug reads,
 *                  stop (always), both creates undone (P-W4-18, P-W4-20)
 *   W4.7 aliases   the 1.x names (animation_graph inspectAction=validate), the 1.9 Bohemia profile
 *                  handlers (P-W4-23, gated in TS), wb_module action on the Resource Manager
 *   W4.8 hand      the ONE hand block (H2, OI-W4-2): the hand presses Save on the edited .pap in the
 *                  ProcAnim Editor (P-W4-12); --skip-hand records it HELD
 *   W4.9 close     the net-zero hash diff and the closable step
 * Everything under _throwaway/W4/ (plant, copies, created files, .bak and .meta files, the world) is
 * removed by this script's `rollback` subcommand once Workbench is closed.
 *
 * Stop rules (W2's): a dialog-like window already up refuses the step; the pid's windows are polled
 * while a step runs (scripts/census/live/common.ts `watched`): a new dialog-like or disabled window
 * is a HANDOFF that names the title and the answer (never Save), any other new window a STOP, and
 * the first verdict cuts the step; busy windows alone (the play-mode transition) are waited out under
 * WATCH_OPTIONS' grace. A LOST, WEDGED or MODAL_OPEN client error stops the battery;
 * three consecutive unexpected FAILs in one unit stop it (failUnitOf: the count resets at a block
 * boundary, and each step of an independent block, W4.5, is its own unit). A mutating call is never
 * retried. A probe whose kill criterion is met is recorded KILLED with the observed value; steps
 * that depend on it are SKIPPED.
 *
 * Usage:
 *   npx --no tsx tests/live/w4.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w4.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w4.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--run-dir <dir in the sitting>] [--skip-hand]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w4.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
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
import { loadConfig, type Config } from "../../src/config.js";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { runResources } from "../../src/tools/wb-resources.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runBi } from "../../src/tools/wb-bi.js";
import { runAnim } from "../../src/tools/wb-anim.js";
import { runAnimDebug } from "../../src/tools/wb-anim-debug.js";
import {
  ACTIONS as WORKSPACE_ACTIONS,
  runAnimationWorkspace,
  type WorkspaceRequest,
} from "../../src/tools/animation-workspace.js";
import { runAnimationSet, type AnimationSetRequest } from "../../src/tools/animation-set.js";
import {
  ANIMATION_GRAPH_ACTIONS,
  runAnimationGraph,
  type AnimationGraphArgs,
} from "../../src/tools/animation-graph.js";
import { BEHAVIOR_TREE_ACTIONS, registerBehaviorTree } from "../../src/tools/behavior-tree.js";
import { runProcAnim, type ProcAnimRequest } from "../../src/tools/procanim.js";
import { registerAnimationFindUnusedClips } from "../../src/tools/animation-find-unused-clips.js";
import { registerWeaponPoseLint } from "../../src/tools/weapon-pose-lint.js";
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

export const SESSION = "W4";
/** The last step; the runner also runs it after a stop (not after a dialog, LOST or WEDGED). */
export const CLOSABLE_STEP = "w4-99-closable";
export const GATE_STEP = "w4-00-gate";

/**
 * The window watch of every polled step (W4 cold run fix-up, W8 fix-up 1's treatment). The cold run
 * (1.9.0.37) handed off w4-60-play on Qt683QWindowToolSaveBits "Arma Reforger Workbench", owner 0,
 * disabled, beside the World Editor window disabled: the play-mode transition. Afterwards no dialog
 * was on screen and Workbench was in play mode. Those are busy windows (isBusyWindow); the grace
 * (busyGraceMs) waits them out for at most BUSY_GRACE_MS, re-checks at the step's end, and is a
 * handoff past it. An owned window, a #32770, a known modal title or an unexpected window beside
 * them is still a verdict at once.
 */
export const WATCH_OPTIONS: VerdictOptions = { popups: false, busyGraceMs: BUSY_GRACE_MS };
export const SCRIPT_PATH = "tests/live/w4.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W4.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W4-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));

/** The one switch the launch carries, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<sitting>/w4-scratch.ini",
  SAA,
];

/** Every file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W4_ROOT = `${THROWAWAY}/W4`;

/** The duplicate of the vanilla tripods set (w4-03, animation_workspace duplicate); opened in the Animation Editor. */
export const ANIM_DIR = `${W4_ROOT}/anim`;
export const ANIM_AW = `${ANIM_DIR}/W4_tripods.aw`;
export const ANIM_SET: readonly string[] = ["aw", "ast", "asi", "agr", "agf"].map(
  (e) => `${ANIM_DIR}/W4_tripods.${e}`,
);
/** The tree behavior_tree create writes (w4-03) and the Behavior Editor opens. */
export const BT_DIR = `${W4_ROOT}/bt`;
export const BT = `${BT_DIR}/W4_probe.bt`;
/** The .pap procanim create copies (w4-03) and the ProcAnim Editor opens. */
export const PAP_DIR = `${W4_ROOT}/pap`;
export const PAP = `${PAP_DIR}/W4_pendulum.pap`;
/** Planted copies of the three types whose owning module P-W4-15 asks for. */
export const TYPES_DIR = `${W4_ROOT}/types`;
export const AE = `${TYPES_DIR}/W4_events.ae`;
export const AEX = `${TYPES_DIR}/W4_physx.aex`;
export const ASY = `${TYPES_DIR}/W4_sync.asy`;
export const TYPE_COPIES: readonly string[] = [AE, AEX, ASY];
/**
 * The offline-tool copies (W4.5): each is edited first and registered and loaded only after, so the
 * engine never holds an older version (W2 fix-up 2: the engine caches a loaded file). The .agr and
 * .agf are planted; the others are created by the tool under test in their own step.
 */
export const OFF_DIR = `${W4_ROOT}/off`;
export const OFF_AGR = `${OFF_DIR}/W4_off.agr`;
export const OFF_AGF = `${OFF_DIR}/W4_off.agf`;
export const OFF_AST = `${OFF_DIR}/W4_off_set.ast`;
export const OFF_ASI = `${OFF_DIR}/W4_off_set.asi`;
export const OFF_AW = `${OFF_DIR}/W4_off_ws.aw`;
export const OFF_BT = `${OFF_DIR}/W4_off.bt`;
export const OFF_PAP = `${OFF_DIR}/W4_off.pap`;
/** The .txa txaExport writes (W4.1, only with the owner's profile). */
export const TXA_DIR = `${W4_ROOT}/txa`;
export const TXA = `${TXA_DIR}/W4_probe.txa`;
/** animation_graph author's output folder. */
export const CREATED_DIR = `${W4_ROOT}/created`;
export const WORLDS_DIR = `${W4_ROOT}/worlds`;
export const WORLD = `${WORLDS_DIR}/EMCP_W4_Tiny.ent`;

export const PLANTED: readonly string[] = [OFF_AGR, OFF_AGF, ...TYPE_COPIES];
/** Folders the plant makes (NewTargetInProject refuses a target whose parent folder is missing). */
export const PLANT_DIRS: readonly string[] = [
  ANIM_DIR,
  BT_DIR,
  PAP_DIR,
  TXA_DIR,
  CREATED_DIR,
  WORLDS_DIR,
];
/** The live fixtures registered by w4-03 (the duplicate registers its own copies). */
export const LIVE_FIXTURES: readonly string[] = [BT, PAP, ...TYPE_COPIES];

/** Vanilla sources (read from the paks by `plant` and the tools, never written). */
export const VANILLA_AW = "anims/workspaces/generic/tripods/tripods.aw";
export const VANILLA_AGR = "anims/workspaces/generic/tripods/tripods.agr";
export const VANILLA_AGF = "anims/workspaces/generic/tripods/tripods.agf";
export const VANILLA_AE = "anims/workspaces/player/player_EventTable.ae";
export const VANILLA_AEX = "anims/workspaces/generic/ammobelt/PhysiX.aex";
export const VANILLA_ASY = "Assets/Items/Fuel/workspaces/Jerrycan_SyncTable.asy";
export const VANILLA_PAP = "anims/proc/clock_pendulum.pap";
export const VANILLA_BT = "AI/BehaviorTrees/Waypoints/WP_Animate.bt";
/** The GUIDs of the vanilla tripods files the duplicate must re-point (the .aw links them). */
export const VANILLA_SET_GUIDS: readonly string[] = [
  "061879731A36032A",
  "F9804AA831FA8537",
  "14EA1F732DF3D7D9",
  "3BE401C9B350BEE9",
];
/** A vanilla .anm by its resource name (anims/anm/NPC/workspaces/AirSupport_NPCs.asi maps it). */
export const VANILLA_ANM =
  "{1A80ACE8DAF9BA77}anims/anm/NPC/male/Loitering/p_loitering_una_var06.anm";
/** The tripods preview model and another, for animation_workspace set. */
export const TRIPODS_MODEL =
  "{9A202788CF67D154}Assets/Vehicles/Helicopters/UH1H/VehParts/Mounts/UH1H_M23_Mount.xob";
export const OTHER_MODEL = "{2120556A9E0BA9D5}Assets/Props/Civilian/GlassBeer_01/GlassBeer_01.xob";
/** The play-mode entities: a character (its graph is player_main.agr) and a compass (a ProcAnim component). */
export const CHARACTER =
  "{26A9756790131354}Prefabs/Characters/Factions/BLUFOR/US_Army/Character_US_Rifleman.et";
export const COMPASS = "{7CEF68E2BC68CE71}Prefabs/Items/Equipment/Compass/Compass_Adrianov.et";
export const CHAR_NAME = "W4_char";
export const COMPASS_NAME = "W4_compass";
/** Variables of anims/workspaces/player/player_main.agr (read offline from the paks) and two tags. */
export const VAR_NAMES: readonly string[] = ["MovementSpeed", "Stance", "ADS"];
export const VAR_TYPES: readonly string[] = ["float", "int", "bool"];
export const TAG_NAMES: readonly string[] = ["WEAPON", "STANCE"];
/** The terrain world W1 reads (vanilla, opened read-only, never saved): the closable fallback. */
export const VANILLA_WORLD = "worlds/Arland/EmptyArland.ent";

/** The tree w4-03 creates (a Sequence with one idle task). */
export const BT_SPEC = {
  path: BT,
  variables: [{ name: "alert", type: "Bool" }],
  root: {
    type: "Sequence",
    children: [{ type: "AITaskIdle", name: "Hold", props: { Period: 2 } }],
  },
};
/** The tree w4-52 creates, edits and loads. */
export const OFF_BT_SPEC = { ...BT_SPEC, path: OFF_BT };

/** The distinct values the W4.5 edits write; the engine read must find each. */
export const NEEDLES = {
  agrVar: "W4_Accept",
  agfExpr: "Yaw > 4.25",
  astGroup: "W4G",
  astColumn: "W4Col",
  astAnimation: "W4Anim",
  asiAnm: "1A80ACE8DAF9BA77",
  btNode: "W4_Hold",
  papTl: "704.25 -401.5",
  awModel: "2120556A9E0BA9D5",
} as const;

export const PLANT_FILE = "plant-w4.json";
export const RESULT_FILE = "w4-result.json";
export const BATTERY_SNAPSHOT_FILE = "w4-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w4-battery-snapshot";
/** Files whose change outside _throwaway/W4/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** How long a hand step waits for the main session's answer file (per request). */
export const HAND_WAIT_MS = 900_000;
/** The answer every TXA step records when no profile is loaded (DEC-067 OI-W4-1). */
export const BLOCKED_OI_W4_1 = "blocked:OI-W4-1";

export const TIMEOUTS = {
  step: 180_000,
  open: 600_000,
  play: 300_000,
  poll: 5_000,
} as const;

/** The describe pages an engine-accept read walks at most (200 rows each). */
export const ACCEPT_PAGES = 5;

/**
 * Blocks whose steps are independent proofs: W4.5's offline accepts each edit their own copy and
 * check it alone, so three failing in a row says nothing about the session (W2 run 3).
 */
export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W4.5"]);

/** The unit the consecutive-FAIL stop counts in: the step itself in an independent block, else its block. */
export function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? `${s.block}/${s.id}` : s.block;
}

/** Client codes that stop the battery (the brief's stop rules). */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/**
 * Refusal codes that prove a handler compiled and answered (P-W4-01): a domain refusal is an
 * answer, the handler wrote it. UNREACHABLE, HANDLER_ERROR or an unknown-handler answer is not.
 */
export const DOMAIN_CODES: ReadonlySet<string> = new Set([
  "ENGINE_FALSE",
  "STALE_CURSOR",
  "RESOURCE_NOT_FOUND",
  "PATH_NOT_FOUND",
  "ITEM_NOT_FOUND",
  "ENTITY_NOT_FOUND",
  "INVALID_ARGUMENT",
  "NOT_IN_PROJECT",
  "ABSOLUTE_PATH",
  "WRONG_MODE",
  "NO_WORLD",
  "UNPROVEN",
  "TXA_ERROR",
  "SAVE_FAILED",
  "MODULE_NOT_SUPPORTED",
  "MODULE_NOT_OPEN",
  "MODAL_HAZARD",
  "GATED",
  "NO_DOCUMENT",
  "NO_OPEN_RESOURCE",
]);

/** Titles a step may add: W2's list, with the three W4 editors titled with or without a document. */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
export const WORKBENCH_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  /^World Editor$/,
  DEBUG_TITLE,
  /^Enfusion Workbench( - .+)?$/,
  /^Arma Reforger Workbench$/,
  /^Procedural Animation Editor( - .+)?$/,
  /^String Editor$/,
  /^Behavior Editor( - .+)?$/,
  /^Audio Editor$/,
  /^Animation Editor( - .+)?$/,
];

// ── Coverage tables ──────────────────────────────────────────────────────────

/** The W4 contracts in contracts/ and the TS tool that drives each (Module, Container: changed by W4). */
export const W4_CONTRACTS = {
  EMCP_WB_Anim: "wb_anim",
  EMCP_WB_AnimDebug: "wb_anim_debug",
  EMCP_WB_Module: "wb_module",
  EMCP_WB_Container: "wb_container",
} as const;

/** The TypeScript-only actions of the wave's tools (spec 2.4); the two lint tools take no action. */
export const TS_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  animation_workspace: WORKSPACE_ACTIONS,
  animation_set: [
    "read",
    "validate",
    "addGroup",
    "addColumn",
    "addAnimation",
    "map",
    "unmap",
    "create",
  ],
  animation_graph: ANIMATION_GRAPH_ACTIONS,
  behavior_tree: BEHAVIOR_TREE_ACTIONS,
  procanim: ["inspect", "validate", "nodes", "edit", "create"],
  animation_find_unused_clips: ["run"],
  weapon_pose_lint: ["run"],
};

const EDITOR_WRITE_REASON =
  "a write on open:AnimEditor, open:BehaviorEditor or open:ProcAnimEditor is refused GATED in Enforce only (EMCP_WB_Container EDITOR_OPEN_*, DEC-067 spec 2.3): the battery never sends an in-memory write to an editor document on the strength of an Enforce gate alone (a gate opened by mistake would edit the document and leave it dirty); the reads are sent for their refusal (w4-36), the writes are W1 actions proven live on the World Editor (tests/live/w1.live.ts, the 1.9.0.37 confirmation run), and P-W4-29 is the probe sitting's";

/** Contract actions no step exercises, with the reason. */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {
  "wb_container.set": EDITOR_WRITE_REASON,
  "wb_container.clear": EDITOR_WRITE_REASON,
  "wb_container.arrayAdd": EDITOR_WRITE_REASON,
  "wb_container.arrayRemove": EDITOR_WRITE_REASON,
  "wb_container.arrayMove": EDITOR_WRITE_REASON,
  "wb_container.setClass": EDITOR_WRITE_REASON,
  "wb_container.save": EDITOR_WRITE_REASON,
};

const GATED_PROBE = (gate: string, sent: string): string =>
  `its action is GATED in this build (${gate}): the battery sends it only for the refusal (${sent}); the probe runs in the W4 probe sitting, which opens the gate in a probe build, never in the shipped one`;

/** Probes no step can settle in this battery, with the reason (the rest are assigned to steps). */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {
  "P-W4-11": GATED_PROBE(
    "EMCP_WB_Module SAVE_ANIM, Enforce",
    "w4-36 sends wb_module save AnimEditor as a dry run",
  ),
  "P-W4-13": GATED_PROBE(
    "EMCP_WB_Module SAVE_BEHAVIOR, Enforce",
    "w4-36 sends wb_module save BehaviorEditor as a dry run",
  ),
  "P-W4-14": GATED_PROBE(
    "ANIM_GATES.checkLogMarkers in TS and the check body in EMCP_WB_Anim.c",
    "w4-36 sends wb_anim check; the TS answers GATED and nothing is opened",
  ),
  "P-W4-19": GATED_PROBE(
    "ANIM_DEBUG_GATES.setCommand and EMCP_WB_AnimDebug.SET_COMMAND_PROVEN",
    "w4-60 sends set and command in play mode; the TS answers GATED",
  ),
  "P-W4-21": GATED_PROBE(
    "ANIM_DEBUG_GATES.btBreakpoint and EMCP_WB_AnimDebug.BT_BREAKPOINT_PROVEN",
    "w4-60 sends btBreakpoint in play mode; the TS answers GATED",
  ),
  "P-W4-27":
    "the AnimEditor Tools items (Verify Animations, Reload Animations, Resave Workspaces, Repair Duplicate Channels) are not on EMCP_WB_ActionAllowList and the dry-run policy's execute_action allow-list: a call is refused NOT_ALLOWLISTED before anything runs, and an item that might open a dialog is never invoked from a battery; the probe sitting runs them one at a time with the hand watching (OD-8)",
  "P-W4-29": GATED_PROBE(
    "EMCP_WB_Container EDITOR_OPEN_ANIM/BEHAVIOR/PROCANIM, Enforce",
    "w4-36 sends describe and get on each open:<editor> target",
  ),
};

/** The probe ids P-W4-01 .. P-W4-29. */
export const PROBE_IDS: readonly string[] = Array.from(
  { length: 29 },
  (_, i) => `P-W4-${String(i + 1).padStart(2, "0")}`,
);

// ── Types ────────────────────────────────────────────────────────────────────

export type W4Tool =
  | "wb_anim"
  | "wb_anim_debug"
  | "wb_module"
  | "wb_container"
  | "wb_resources"
  | "wb_world"
  | "wb_entity"
  | "wb_bi";

export type OfflineTool =
  | "animation_workspace"
  | "animation_set"
  | "animation_graph"
  | "behavior_tree"
  | "procanim"
  | "animation_find_unused_clips"
  | "weapon_pose_lint";

export const HANDLER_OF: Readonly<Record<W4Tool, string>> = {
  wb_anim: "EMCP_WB_Anim",
  wb_anim_debug: "EMCP_WB_AnimDebug",
  wb_module: "EMCP_WB_Module",
  wb_container: "EMCP_WB_Container",
  wb_resources: "EMCP_WB_Resources",
  wb_world: "EMCP_WB_World",
  wb_entity: "EMCP_WB_Entity",
  wb_bi: "<bi handler>",
};

export type Block =
  | "W4.0"
  | "W4.1"
  | "W4.2"
  | "W4.3"
  | "W4.4"
  | "W4.5"
  | "W4.6"
  | "W4.7"
  | "W4.8"
  | "W4.9";
export type Risk = "read-only" | "reversible" | "mutating";
/** HELD: a hand step under --skip-hand (not run, not failed). */
export type Verdict = "PASS" | "FAIL" | "KILLED" | "NOT-RUN" | "SKIPPED" | "HELD";
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

/** The game data, read from the paks (P-W4-22). */
export interface VanillaFs {
  paths: () => string[];
  read: (p: string) => Buffer;
}

export interface W4Deps {
  /** One shipped TS tool, run in process against a client WITHOUT a Config. */
  tool: (name: W4Tool, args: Record<string, unknown>) => Promise<ToolResponse>;
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

export interface W4Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** --skip-hand: hand steps are recorded HELD instead of waiting for the hand. */
  skipHand?: boolean;
}

/** What a step left behind: undo points still on the stack and state to restore. */
export interface Debt {
  undos: number;
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W4Deps;
  opts: W4Options;
  prior: (id: string) => StepRecord | null;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  /** Values steps share within one run (fixture resource names, the profile). */
  state: Map<string, string>;
  /** A tool call: guarded by the window poller; a stop code throws unless `tolerate`. */
  tool: (
    name: W4Tool,
    args: Record<string, unknown>,
    o?: { restore?: boolean; tolerate?: boolean },
  ) => Promise<ToolResponse>;
  offline: (name: OfflineTool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** One Edit > Undo; pays one undo point when it answers ok. */
  undo: () => Promise<UndoResult>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

/** One offline tool call a step makes (in the coverage and write checks). */
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
  /** A hand step: the main session's hand answers a request file (W4.8 only). */
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

function readJson<T>(path: string, deps: Pick<W4Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W4Deps, "writeBytes">): void {
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
  tool: W4Tool,
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
  "wb_world.new",
  "wb_world.register",
  "wb_anim.txaExport",
  "wb_anim.txaEdit",
]);

/** The path keys a write names (plan params and offline params; `spec.path` for behavior_tree create). */
export const WRITE_PATH_KEYS: readonly string[] = [
  "path",
  "paths",
  "to",
  "target",
  "outputPath",
  "newPath",
];

const WINDOW_KILL =
  "a new dialog-like window: HANDOFF (nothing sent to it; the record names the title and the answer, never Save); any other new window: STOP; LOST, WEDGED or MODAL_OPEN: STOP";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The GUID of a resource name `{GUID}path`, "" when it has none. */
function guidOf(name: string): string {
  const m = /^\{([0-9A-Fa-f]{16})\}/.exec(name);
  return m ? m[1]!.toUpperCase() : "";
}

function onDisk(ctx: StepContext, rel: string): boolean {
  return ctx.deps.exists(abs(ctx.opts.sandboxDir, rel));
}

/**
 * Why the battery refuses to open `rel`: a file under _throwaway/ must be on disk, and the editor
 * asked must own its type (or the Resource Manager routes it). Null: the open may be sent.
 */
export function openRefusal(
  ctx: { opts: { sandboxDir: string }; deps: { exists(p: string): boolean } },
  module: string,
  rel: string,
): string | null {
  const r = rel.replace(/\\/g, "/");
  if (r.startsWith(`${THROWAWAY}/`) && !ctx.deps.exists(abs(ctx.opts.sandboxDir, r)))
    return `${r} is not on disk under the sandbox: the open is not sent`;
  const owner = ownerOf(r);
  if (module !== owner)
    return `${module} does not own ${r} (its owner is ${owner}): the open is not sent`;
  return null;
}

/** The module that owns a file type (src/manifest/vocabulary.ts owningModule, for the W4 types). */
export function ownerOf(rel: string): string {
  const lower = rel.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  if (ext === ".ent" || ext === ".et") return "WorldEditor";
  if (ext === ".bt") return "BehaviorEditor";
  if ([".aw", ".agr", ".agf", ".ast", ".asi"].includes(ext)) return "AnimEditor";
  if ([".pap", ".siga"].includes(ext)) return "ProcAnimEditor";
  return "ResourceManager";
}

/** The planted files on disk (offline steps need no registration first). */
async function ensureFixturesOnDisk(ctx: StepContext): Promise<void> {
  const missing = PLANTED.filter((rel) => !onDisk(ctx, rel));
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `planted file(s) absent: ${missing.join(", ")}: run \`w4.live.ts plant\` first (nothing is sent for a file that is not on disk)`,
    );
}

/** The duplicate of the tripods set: answers the duplicate's own response (dry run, then confirm). */
async function duplicateSet(ctx: StepContext): Promise<{ dry: ToolResponse; made: ToolResponse }> {
  const dry = await ctx.offline("animation_workspace", {
    action: "duplicate",
    path: VANILLA_AW,
    target: ANIM_AW,
  });
  const made = await ctx.offline("animation_workspace", {
    action: "duplicate",
    path: VANILLA_AW,
    target: ANIM_AW,
    confirm: true,
  });
  return { dry, made };
}

/**
 * The fixtures of W4.0 on disk and registered, with their resource names (cached for the run): the
 * duplicate set, the tree and the .pap are made when absent (a resumed run that did not pass
 * w4-03), and a fixture without a .meta is registered. A set that is only partly on disk stops the
 * battery (roll back and plant again): nothing is ever opened that is not on disk.
 */
async function ensureFixtures(ctx: StepContext): Promise<Record<string, string>> {
  await ensureFixturesOnDisk(ctx);
  const present = ANIM_SET.filter((rel) => onDisk(ctx, rel));
  if (present.length > 0 && present.length < ANIM_SET.length)
    throw new StopBattery(
      "stopped",
      `the duplicate set is only partly on disk (${present.join(", ")}): roll the sitting back and plant again`,
    );
  if (present.length === 0) {
    const d = await duplicateSet(ctx);
    if (!d.made.ok)
      throw new StopBattery("stopped", `the tripods duplicate failed: ${why(d.made)}`, {
        duplicate: brief(d.made),
      });
  }
  if (!onDisk(ctx, BT)) {
    const r = await ctx.offline("behavior_tree", { action: "create", spec: BT_SPEC });
    if (!r.ok) throw new StopBattery("stopped", `behavior_tree create failed: ${why(r)}`);
  }
  if (!onDisk(ctx, PAP)) {
    const r = await ctx.offline("procanim", {
      action: "create",
      path: PAP,
      source: VANILLA_PAP,
      confirm: true,
    });
    if (!r.ok) throw new StopBattery("stopped", `procanim create failed: ${why(r)}`);
  }
  const out: Record<string, string> = {};
  for (const rel of [...ANIM_SET, ...LIVE_FIXTURES]) {
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
  return [
    ...[...ANIM_SET, ...LIVE_FIXTURES].flatMap((rel) => [
      tc("wb_resources", "resolve", { path: rel }, { note: "the fixture's resource name" }),
      tc(
        "wb_resources",
        "register",
        { path: rel, confirm: true },
        { note: "only when resolve finds no .meta (a resumed run that did not pass w4-03)" },
      ),
    ]),
    ...ANIM_SET.map((rel) => registerByTool(rel, "animation_workspace duplicate (when absent)")),
  ];
}

/** The register a TS tool sends through registerProjectFile (not a call of the tool under test). */
function registerByTool(rel: string, via: string): PlanAction {
  return {
    kind: "net-call",
    target: "EMCP_WB_Resources",
    params: { action: "register", path: rel, buildRuntime: false, confirm: true },
    note: `registerProjectFile inside ${via}`,
  } as PlanAction;
}

function fixtureOfflineCalls(): OfflineCall[] {
  return [
    oc("animation_workspace", "duplicate", { path: VANILLA_AW, target: ANIM_AW }),
    oc("animation_workspace", "duplicate", { path: VANILLA_AW, target: ANIM_AW, confirm: true }),
    oc("behavior_tree", "create", { spec: BT_SPEC }),
    oc("procanim", "create", { path: PAP, source: VANILLA_PAP, confirm: true }),
  ];
}

// ── Engine reads of a written file (the W4.5 accept proofs) ──────────────────

export interface EngineRead {
  /** The engine loaded the file (a describe answered ok). */
  loaded: boolean;
  /** Each needle: found in the summary or the page rows. */
  found: Record<string, boolean>;
  name: string;
  evidence: Raw;
}

/** Rows (or summary children) that hold a needle, capped, for the record. */
function hits(text: unknown[], needle: string): unknown[] {
  return text.filter((x) => JSON.stringify(x).includes(needle)).slice(0, 6);
}

/**
 * Registers `rel` (an engine first load happens here, after every offline edit) and reads it with
 * wb_container describe on `path:` (summary, then up to ACCEPT_PAGES pages of 200 rows), looking for
 * each needle in what the engine answered.
 */
async function engineRead(
  ctx: StepContext,
  rel: string,
  needles: readonly string[],
): Promise<EngineRead> {
  const reg = await ctx.tool("wb_resources", { action: "register", path: rel, confirm: true });
  const name = S(rb(reg).resourceName);
  if (name) ctx.state.set(rel, name);
  const sum = await ctx.tool("wb_container", { action: "describe", target: `path:${rel}` });
  const pages: ToolResponse[] = [];
  let cursor = "";
  for (let i = 0; i < ACCEPT_PAGES; i++) {
    const p = await ctx.tool("wb_container", {
      action: "describe",
      target: `path:${rel}`,
      mode: "page",
      fields: PAGE_FIELDS,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    pages.push(p);
    cursor = S(rb(p).nextCursor);
    if (!p.ok || !cursor) break;
  }
  const children = strs(rb(sum).children);
  const rows = pages.flatMap((p) => rowsOf(p));
  const all: unknown[] = [rb(sum), ...children, ...rows];
  const found = Object.fromEntries(
    needles.map((n) => [n, all.some((x) => JSON.stringify(x).includes(n))]),
  );
  return {
    loaded: sum.ok || pages.some((p) => p.ok),
    found,
    name,
    evidence: {
      register: brief(reg),
      summary: sum.ok
        ? { rootClass: rb(sum).rootClass ?? null, total: rb(sum).total ?? null, children }
        : brief(sum),
      pages: pages.length,
      rows: rows.length,
      pageErrors: pages.filter((p) => !p.ok).map(brief),
      hits: Object.fromEntries(needles.map((n) => [n, hits([...children, ...rows], n)])),
    },
  };
}

function engineReadPlan(rel: string): PlanAction[] {
  return [
    tc("wb_resources", "register", { path: rel, confirm: true }),
    tc("wb_container", "describe", { target: `path:${rel}` }),
    tc(
      "wb_container",
      "describe",
      { target: `path:${rel}`, mode: "page", fields: PAGE_FIELDS, limit: 200 },
      { note: `paged by nextCursor, at most ${ACCEPT_PAGES} pages` },
    ),
  ];
}

const PAGE_FIELDS = "path,name,type,value";

/** The engine-accept verdict of one file (W2 fix-up 1: judged per item). */
function acceptProbe(id: string, what: string, r: EngineRead): ProbeResult {
  const observed = { loaded: r.loaded, found: r.found, resourceName: r.name || null };
  if (!r.loaded)
    return killed(id, observed, `the engine did not load ${what} (describe on path: refused)`);
  const missing = Object.entries(r.found)
    .filter(([, f]) => !f)
    .map(([n]) => n);
  return missing.length
    ? partial(
        id,
        observed,
        `${what} loads; the written value(s) ${missing.join(", ")} are not in the describe rows (the row may sit deeper than the pages read)`,
      )
    : settled(id, observed, `${what} loads and the engine reads the written values back`);
}

/** The text and the parsed JSON of an offline tool answer (animation_graph and behavior_tree answer text). */
function textOfResp(r: ToolResponse): string {
  return S(rb(r).text);
}

// ── TXA (W4.1) ───────────────────────────────────────────────────────────────

/**
 * The first animation export profile a loaded addon holds (txaProfiles, cached), or null when there
 * is none: then the step is recorded NOT-RUN `blocked:OI-W4-1` (DEC-067).
 */
async function profileOf(
  ctx: StepContext,
): Promise<{ profile: string | null; evidence: Raw; resp: ToolResponse | null }> {
  const cached = ctx.state.get("w4.profile");
  if (cached) return { profile: cached, evidence: { profile: cached, cached: true }, resp: null };
  const r = await ctx.tool("wb_anim", { action: "txaProfiles" });
  const profiles = Array.isArray(rb(r).profiles) ? (rb(r).profiles as Raw[]) : [];
  const first = profiles[0];
  const profile = first ? S(first.path) || S(first.name) : "";
  if (profile) ctx.state.set("w4.profile", profile);
  return { profile: profile || null, evidence: { txaProfiles: brief(r) }, resp: r };
}

function blocked(evidence: Raw): StepOutcome {
  return {
    status: "NOT-RUN",
    detail: `${BLOCKED_OI_W4_1}: no animation export profile (.apr) in a loaded addon; the owner's step OI-W4-1 (H1) comes first`,
    evidence,
  };
}

/** The keyData of a track: `frames * channels` values (P-W4-04 asks the real layout; the ErrMsg names it). */
export function keyDataOf(frames: number, channels: number): string[] {
  return Array.from({ length: frames * channels }, () => "0");
}

/** The txaEdit dry runs of every op, then one confirm that the TS answers GATED (P-W4-06). */
export const TXA_EDIT_OPS: ReadonlyArray<[string, Raw]> = [
  ["add", { op: "add", eventType: "generic" }],
  ["edit", { op: "edit", index: 0, fields: ["Frame"], values: ["1"] }],
  ["erase", { op: "erase", index: 0 }],
  ["setProp", { op: "setProp", propName: "W4Prop", propValue: "1" }],
  ["clearProps", { op: "clearProps" }],
];

// ── Editors (W4.2) ───────────────────────────────────────────────────────────

/**
 * wb_module open, setResource of a fixture and info, in one editor. The open is refused before it
 * is sent when the file is not on disk or the module does not own its type.
 */
async function openInEditor(
  ctx: StepContext,
  module: string,
  rel: string,
): Promise<{ set: ToolResponse | null; info: ToolResponse | null; evidence: Raw }> {
  const refusal = openRefusal(ctx, module, rel);
  if (refusal) return { set: null, info: null, evidence: { refused: refusal } };
  const open =
    module === "ResourceManager" ? null : await ctx.tool("wb_module", { action: "open", module });
  const set = await ctx.tool("wb_module", {
    action: "setResource",
    module,
    target: `path:${rel}`,
  });
  // The editors open a document behind the call; the info read waits one poll.
  await ctx.sleep(TIMEOUTS.poll);
  const infoModule = module === "ResourceManager" ? "AnimEditor" : module;
  const info = await ctx.tool("wb_module", { action: "info", module: infoModule });
  return {
    set,
    info,
    evidence: {
      open: open ? brief(open) : null,
      setResource: brief(set),
      info: { module: infoModule, ...(brief(info) ?? {}) },
    },
  };
}

function openEditorPlan(module: string, rel: string): PlanAction[] {
  return [
    ...(module === "ResourceManager" ? [] : [tc("wb_module", "open", { moduleName: module })]),
    tc("wb_module", "setResource", { moduleName: module, path: rel }),
    tc("wb_module", "info", {
      moduleName: module === "ResourceManager" ? "AnimEditor" : module,
    }),
  ];
}

/** P-W4-10's reading of one editor's info: containers, their classes and the document path. */
function containerProbe(module: string, rel: string, info: ToolResponse | null): ProbeResult {
  const r = rb(info);
  const count = Number(r.containerCount ?? 0);
  const observed = {
    module,
    file: rel,
    isOpen: r.isOpen ?? null,
    containerCount: r.containerCount ?? null,
    containerClasses: r.containerClasses ?? null,
    docPath: r.docPath ?? null,
  };
  if (!info || !info.ok)
    return partial(
      "P-W4-10",
      { ...observed, info: info ? S(info.code) : "not sent" },
      `${module}: info did not answer`,
    );
  if (count === 0)
    return killed(
      "P-W4-10",
      observed,
      `${module} reports 0 containers with ${basename(rel)} open: docPath stays empty and save refuses NO_DOCUMENT for it`,
    );
  return partial(
    "P-W4-10",
    observed,
    `${module}: ${count} container(s) ${strs(r.containerClasses).join(", ")}; docPath ${S(r.docPath) || "not answered (DOC_READ gate shut in Enforce)"}`,
  );
}

/** P-W4-07 / P-W4-08 / P-W4-09: the route setResource took and what it answered. */
function routeProbe(
  id: string,
  module: string,
  rel: string,
  set: ToolResponse | null,
): ProbeResult {
  const r = rb(set);
  const observed = {
    module,
    file: rel,
    ok: set?.ok ?? null,
    code: set && !set.ok ? S(set.code) : null,
    result: r.result ?? null,
    openedIn: r.openedIn ?? null,
    message: set ? S(set.message) || null : null,
    warnings: set?.warnings ?? [],
  };
  if (!set) return partial(id, observed, `${module}: the open was refused before sending`);
  if (!set.ok) return killed(id, observed, `${module} did not open ${basename(rel)}: ${why(set)}`);
  const route = /OpenResource/.test(JSON.stringify(set))
    ? "Workbench.OpenResource"
    : "SetOpenedResource";
  return id === "P-W4-09"
    ? settled(
        id,
        { ...observed, route },
        `the .bt opened through ${route} in ${S(r.openedIn) || module}`,
      )
    : partial(
        id,
        { ...observed, route },
        route === "Workbench.OpenResource"
          ? `${module} opened ${basename(rel)} through the 1.x Workbench.OpenResource route (RELATIVE_OPEN gate shut): SetOpenedResource with a relative path is the probe sitting's`
          : `${module} took the relative path through SetOpenedResource`,
      );
}

// ── Offline reads of the paks (P-W4-22) ──────────────────────────────────────

/** The engine calls of a Bohemia handler class (its body in the paks): P-W4-22 reads ExportTXAResource. */
export function handlerCalls(fs: VanillaFs, className: string): Raw {
  const files = fs.paths().filter((p) => /^scripts\/Workbench/i.test(p) && p.endsWith(".c"));
  for (const p of files) {
    const text = fs.read(p).toString("utf-8");
    const at = text.search(new RegExp(`class\\s+${className}\\b`));
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
    const request = [
      ...body.matchAll(
        /\b(sourceFile|targetFile|profile|numberOfChannels|numberOfKeyframes|fps|keyData|diffData)\b/g,
      ),
    ].map((m) => m[1]);
    return {
      file: p,
      bodyLines: body.split("\n").length,
      calls,
      fileIo,
      requestFields: [...new Set(request)].sort(),
    };
  }
  return { file: null, calls: [], fileIo: [], note: `class ${className} not found` };
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** The `ok` of an offline answer, with the failure named for the record. */
function offlineFails(pairs: Array<[string, ToolResponse]>): string[] {
  return pairs.filter(([, r]) => !r.ok).map(([k, r]) => `${k}: ${why(r)}`);
}

export function buildSteps(): StepDef[] {
  return [
    // ── W4.0 setup ──
    {
      id: GATE_STEP,
      block: "W4.0",
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
        const missing = PLANTED.filter((rel) => !onDisk(ctx, rel));
        if (missing.length)
          throw new StopBattery(
            "stopped",
            `planted file(s) absent: ${missing.join(", ")}: run \`w4.live.ts plant\` first`,
            evidence,
          );
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        evidence.snapshot = BATTERY_SNAPSHOT_FILE;
        return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
      },
    },
    {
      id: "w4-01-handlers",
      block: "W4.0",
      title:
        "compile gate (P-W4-01): EMCP_WB_Anim (txaProfiles) and EMCP_WB_AnimDebug (vars outside play) answer",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "txaProfiles answers ok (or RESOURCE_NOT_FOUND naming OI-W4-1); vars on an entity that does not exist, in edit mode, answers a domain refusal (ENTITY_NOT_FOUND, WRONG_MODE, NO_WORLD); never an unknown handler",
      kill_criterion:
        "a handler does not answer (UNREACHABLE, HANDLER_ERROR, an unknown-handler error): KILLED; wb_anim_debug is dropped (its rows re-point W8) and the steps that need it are SKIPPED",
      side_effects: [],
      rollback: "none",
      probes: ["P-W4-01"],
      writes: [],
      plan: () => [
        tc("wb_anim", "txaProfiles"),
        tc("wb_anim_debug", "vars", {
          target: "name:W4_none",
          names: ["MovementSpeed"],
          varTypes: ["float"],
        }),
      ],
      run: async (ctx) => {
        const calls: Array<[string, ToolResponse]> = [
          ["wb_anim.txaProfiles", await ctx.tool("wb_anim", { action: "txaProfiles" })],
          [
            "wb_anim_debug.vars",
            await ctx.tool("wb_anim_debug", {
              action: "vars",
              target: "entity:name:W4_none",
              names: ["MovementSpeed"],
              varTypes: ["float"],
            }),
          ],
        ];
        const evidence: Raw = Object.fromEntries(calls.map(([k, r]) => [k, brief(r)]));
        const dead = calls.filter(([, r]) => !r.ok && !DOMAIN_CODES.has(S(r.code)));
        const observed = Object.fromEntries(calls.map(([k, r]) => [k, r.ok ? "ok" : S(r.code)]));
        const p = dead.length
          ? killed(
              "P-W4-01",
              observed,
              `no answer from ${dead.map(([k, r]) => `${k} (${S(r.code)} ${S(r.message)})`).join(", ")}`,
            )
          : settled("P-W4-01", observed, "both new handlers compiled and answer on 1.9.0.37");
        return {
          ...verdictOf([], [p], "EMCP_WB_Anim and EMCP_WB_AnimDebug answer"),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w4-02-offline-paks",
      block: "W4.0",
      title:
        "offline (no Workbench call): the 1.9 ExportTXAResource handler body read from the paks (P-W4-22)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "the class body is found; its engine calls are listed; it calls no FileIO (wb_anim txaExport subsumes it)",
      kill_criterion:
        "no FileIO call in the 1.9 body: P-W4-22 KILLED as the probe words it (the handler joins the wb_bi allow-list; its row is covered by wb_bi.call instead of subsumed-by)",
      side_effects: [],
      rollback: "none (reads from the game paks in this process)",
      probes: ["P-W4-22"],
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
        const calls = handlerCalls(fs, "ExportTXAResource");
        const fileIo = strs(calls.fileIo);
        // The probe's own wording: its kill is the ABSENCE of a FileIO call (the handler is then a
        // plain read-and-write route the wb_bi allow-list can take).
        const p = !calls.file
          ? partial("P-W4-22", calls, "the handler class was not found in the paks")
          : fileIo.length
            ? settled(
                "P-W4-22",
                calls,
                `it calls ${fileIo.join(", ")}: the FileIO prompt hazard holds; wb_anim txaExport subsumes it`,
              )
            : killed(
                "P-W4-22",
                calls,
                "no FileIO call in the 1.9 body: the handler joins the wb_bi allow-list",
              );
        return {
          ...verdictOf([], [p], `handler ${S(calls.file)}: ${strs(calls.calls).length} call(s)`),
          evidence: { exportTxa: calls },
          probes: [p],
        };
      },
    },
    {
      id: "w4-03-fixtures",
      block: "W4.0",
      title:
        "fixtures: animation_workspace duplicate of the tripods set (P-W4-16), behavior_tree create + register (P-W4-17), procanim create, the .ae/.aex/.asy copies registered",
      risk: "mutating",
      timeout_ms: 240_000,
      expected:
        "the duplicate dry run writes nothing and the confirm writes 5 copies, each registered with a new GUID; files lists no vanilla tripods file; the engine loads the copied .aw and reads the copy's GUIDs, none of the vanilla ones; the created .bt registers with a .meta and a {GUID}; the .pap copy and the planted copies register",
      kill_criterion: `P-W4-16: the loaded .aw still names a vanilla tripods GUID (KILLED); P-W4-17: the .bt registers with no .meta (KILLED); a fixture not made or not registered: STOP; ${WINDOW_KILL}`,
      side_effects: [
        `${ANIM_DIR}/ (5 copies + .meta)`,
        `${BT} (+ .meta)`,
        `${PAP} (+ .meta)`,
        `${TYPES_DIR}/ .meta files`,
      ],
      rollback:
        "`w4.live.ts rollback` removes _throwaway/W4/ (copies, .meta files) after Workbench is closed",
      probes: ["P-W4-16", "P-W4-17"],
      writes: [ANIM_DIR, BT, PAP, ...TYPE_COPIES.map((r) => `${r}.meta`)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...ANIM_SET.map((rel) => registerByTool(rel, "animation_workspace duplicate")),
        tc("wb_resources", "register", { path: BT }, { note: "dry run" }),
        tc("wb_resources", "register", { path: BT, confirm: true }),
        ...[PAP, ...TYPE_COPIES].map((rel) =>
          tc("wb_resources", "register", { path: rel, confirm: true }),
        ),
        tc("wb_container", "describe", { target: `path:${ANIM_AW}` }),
        tc(
          "wb_container",
          "describe",
          { target: `path:${ANIM_AW}`, mode: "page", fields: PAGE_FIELDS, limit: 200 },
          { note: `paged by nextCursor, at most ${ACCEPT_PAGES} pages` },
        ),
        ...fixturePlan(),
      ],
      offlineCalls: () => [
        ...fixtureOfflineCalls(),
        oc("animation_workspace", "files", { path: ANIM_AW }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const probes: ProbeResult[] = [];
        // The duplicate (P-W4-16), only when no copy is on disk (a resumed run keeps the first).
        const present = ANIM_SET.filter((rel) => onDisk(ctx, rel));
        let copyGuids: string[] = [];
        if (present.length === 0) {
          const d = await duplicateSet(ctx);
          evidence.duplicateDry = brief(d.dry);
          evidence.duplicate = brief(d.made);
          if (ANIM_SET.some((rel) => onDisk(ctx, rel)) && !d.made.ok)
            fails.push("the duplicate left copies after a failed confirm");
          if (!d.made.ok) fails.push(`duplicate: ${why(d.made)}`);
          const changed = Array.isArray(d.made.changed) ? (d.made.changed as Raw[]) : [];
          copyGuids = changed.map((c) => S(field(c.after, "guid"))).filter((g) => g !== "");
        } else evidence.duplicate = `already on disk: ${present.join(", ")}`;
        const files = await ctx.offline("animation_workspace", { action: "files", path: ANIM_AW });
        const rows = Array.isArray(rb(files).files) ? (rb(files).files as Raw[]) : [];
        const vanillaLeft = rows.filter(
          (f) => ["ast", "asi", "agr", "agf"].includes(S(f.ext)) && S(f.status) !== "project",
        );
        evidence.files = {
          ok: files.ok,
          total: rb(files).total ?? null,
          unresolved: rb(files).unresolved ?? null,
          vanillaLeft,
        };
        // The engine's reading of the copied .aw: the copies' GUIDs, none of the vanilla ones.
        const aw = await engineRead(ctx, ANIM_AW, [...copyGuids, ...VANILLA_SET_GUIDS]);
        evidence.awRead = aw.evidence;
        const vanillaSeen = VANILLA_SET_GUIDS.filter((g) => aw.found[g]);
        const copySeen = copyGuids.filter((g) => aw.found[g]);
        const o16 = {
          copies: copyGuids,
          vanillaLeftInFiles: vanillaLeft.map((f) => `${S(f.ext)} ${S(f.path)}`),
          loaded: aw.loaded,
          copyGuidsRead: copySeen,
          vanillaGuidsRead: vanillaSeen,
        };
        probes.push(
          !aw.loaded
            ? killed("P-W4-16", o16, "the engine did not load the copied .aw")
            : vanillaLeft.length || vanillaSeen.length
              ? killed(
                  "P-W4-16",
                  o16,
                  `a reference still names the vanilla tripods set (${[...vanillaSeen, ...vanillaLeft.map((f) => S(f.path))].join(", ")})`,
                )
              : copySeen.length
                ? partial(
                    "P-W4-16",
                    o16,
                    `the engine loads the copied .aw and reads ${copySeen.length} copy GUID(s), no vanilla one; the Animation Editor open (w4-31) completes the answer`,
                  )
                : partial(
                    "P-W4-16",
                    o16,
                    "the engine loads the copied .aw and no vanilla GUID is read; the copy GUIDs were not located in the rows (a resumed run, or rows deeper than read)",
                  ),
        );
        // The tree (P-W4-17): created offline, then registered.
        if (!onDisk(ctx, BT)) {
          const c = await ctx.offline("behavior_tree", { action: "create", spec: BT_SPEC });
          evidence.btCreate = brief(c);
          if (!c.ok) fails.push(`behavior_tree create: ${why(c)}`);
        } else evidence.btCreate = "already on disk";
        if (onDisk(ctx, BT)) {
          const btMeta = `${BT}.meta`;
          const metaBefore = onDisk(ctx, btMeta);
          const dry = await ctx.tool("wb_resources", { action: "register", path: BT });
          if (!metaBefore && onDisk(ctx, btMeta))
            fails.push("the .bt register dry run wrote its .meta");
          const reg = await ctx.tool("wb_resources", {
            action: "register",
            path: BT,
            confirm: true,
          });
          const name = S(rb(reg).resourceName);
          const metaAfter = onDisk(ctx, btMeta);
          evidence.btRegister = { dry: brief(dry), confirm: brief(reg), metaBefore, metaAfter };
          const o17 = {
            resourceName: name || null,
            meta: metaAfter,
            code: reg.ok ? null : S(reg.code),
          };
          probes.push(
            reg.ok && guidOf(name) && metaAfter
              ? settled("P-W4-17", o17, `the copied .bt registers as ${name} with its .meta`)
              : killed(
                  "P-W4-17",
                  o17,
                  `the .bt did not register with a .meta and a GUID (${reg.ok ? `meta ${metaAfter}, name '${name}'` : why(reg)})`,
                ),
          );
          if (guidOf(name)) ctx.state.set(BT, name);
        }
        // The .pap copy and the planted copies, registered.
        if (!onDisk(ctx, PAP)) {
          const c = await ctx.offline("procanim", {
            action: "create",
            path: PAP,
            source: VANILLA_PAP,
            confirm: true,
          });
          evidence.papCreate = brief(c);
          if (!c.ok) fails.push(`procanim create: ${why(c)}`);
        }
        for (const rel of [PAP, ...TYPE_COPIES]) {
          if (!onDisk(ctx, rel)) continue;
          const reg = await ctx.tool("wb_resources", {
            action: "register",
            path: rel,
            confirm: true,
          });
          evidence[`register ${rel}`] = brief(reg);
          if (!reg.ok) fails.push(`register ${rel}: ${why(reg)}`);
          else if (guidOf(S(rb(reg).resourceName))) ctx.state.set(rel, S(rb(reg).resourceName));
        }
        // Whatever is still missing (a resumed run) is made and registered by ensureFixtures.
        const fx = await ensureFixtures(ctx);
        evidence.fixtures = fx;
        return {
          ...verdictOf(fails, probes, `${Object.keys(fx).length} fixtures on disk and registered`),
          evidence,
          probes,
        };
      },
    },

    // ── W4.1 TXA (OI-W4-1: blocked until the owner's profile is in a loaded addon) ──
    {
      id: "w4-20-txa-profiles",
      block: "W4.1",
      title:
        "wb_anim txaProfiles: the TxaExporter answers and lists the loaded profiles (P-W4-02, P-W4-03)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "ok with total and the profile rows (name, channels, path); with no .apr loaded: total 0, next names OI-W4-1, the step NOT-RUN blocked:OI-W4-1",
      kill_criterion:
        "P-W4-02: UNPROVEN, HANDLER_ERROR or no answer (no TxaExporter): KILLED; P-W4-03: a profile is loaded and still none is listed: KILLED",
      side_effects: [],
      rollback: "none",
      probes: ["P-W4-02", "P-W4-03"],
      dependsOn: ["P-W4-01"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [tc("wb_anim", "txaProfiles")],
      run: async (ctx) => {
        const r = await ctx.tool("wb_anim", { action: "txaProfiles" });
        const profiles = Array.isArray(rb(r).profiles) ? (rb(r).profiles as Raw[]) : [];
        const evidence: Raw = { txaProfiles: brief(r) };
        const o = {
          ok: r.ok,
          code: r.ok ? null : S(r.code),
          total: rb(r).total ?? null,
          profiles,
          next: r.next ?? null,
        };
        if (!r.ok && !DOMAIN_CODES.has(S(r.code)))
          return {
            status: "KILLED",
            detail: `P-W4-02: ${why(r)}`,
            evidence,
            probes: [killed("P-W4-02", o, `txaProfiles did not answer: ${why(r)}`)],
          };
        if (!r.ok && S(r.code) === "UNPROVEN")
          return {
            status: "KILLED",
            detail: `P-W4-02: ${why(r)}`,
            evidence,
            probes: [killed("P-W4-02", o, "the handler refuses UNPROVEN: no TxaExporter")],
          };
        const p2 = partial(
          "P-W4-02",
          o,
          "the handler constructed a TxaExporter and answered GetNumProfiles; ErrCode/ErrMsg before a load are read in w4-21",
        );
        if (!profiles.length) return { ...blocked(evidence), probes: [p2] };
        const first = profiles[0]!;
        ctx.state.set("w4.profile", S(first.path) || S(first.name));
        const p3 = settled(
          "P-W4-03",
          o,
          `LoadProfiles read ${profiles.length} profile(s) without a dialog; the form that loads: ${S(first.path) || S(first.name)}`,
        );
        return {
          ...verdictOf([], [p2, p3], `${profiles.length} profile(s)`),
          evidence,
          probes: [p2, p3],
        };
      },
    },
    {
      id: "w4-21-txa-channels",
      block: "W4.1",
      title:
        "wb_anim txaChannels on the first profile; wb_bi AnimExportProfileChannels beside it (P-W4-02, P-W4-03)",
      risk: "read-only",
      timeout_ms: 90_000,
      expected:
        "the channel rows of the profile with ErrCode 0; the Bohemia read lists the same channels",
      kill_criterion:
        "the profile loads no channel (TXA_ERROR, ErrMsg recorded): P-W4-03 KILLED; with no profile: NOT-RUN blocked:OI-W4-1",
      side_effects: [],
      rollback: "none",
      probes: ["P-W4-02", "P-W4-03"],
      dependsOn: ["P-W4-01", "P-W4-02"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_anim", "txaProfiles", {}, { note: "the profile, when this run has none cached" }),
        tc("wb_anim", "txaChannels", { profile: "<the first profile>" }),
        tc(
          "wb_bi",
          "call",
          { handler: "AnimExportProfileChannels", request: { ProfileName: "<the profile>" } },
          { target: "AnimExportProfileChannels" },
        ),
      ],
      run: async (ctx) => {
        const pr = await profileOf(ctx);
        if (!pr.profile) return blocked(pr.evidence);
        const c = await ctx.tool("wb_anim", { action: "txaChannels", profile: pr.profile });
        const bi = await ctx.tool("wb_bi", {
          action: "call",
          handler: "AnimExportProfileChannels",
          request: { ProfileName: basename(pr.profile).replace(/\.apr$/i, "") },
        });
        const channels = Array.isArray(rb(c).channels) ? (rb(c).channels as Raw[]) : [];
        if (channels.length) ctx.state.set("w4.channels", String(channels.length));
        const o = {
          profile: pr.profile,
          total: rb(c).total ?? null,
          channels: channels.slice(0, 20),
          errCode: rb(c).errCode ?? null,
          errMsg: rb(c).errMsg ?? null,
          bi: bi.ok ? rb(bi) : S(bi.code),
        };
        const p3 = channels.length
          ? settled(
              "P-W4-03",
              o,
              `${channels.length} channel(s), ErrCode ${S(rb(c).errCode) || "0"}`,
            )
          : killed(
              "P-W4-03",
              o,
              `the profile answered no channel: ${c.ok ? S(rb(c).errMsg) : why(c)}`,
            );
        const p2 = partial(
          "P-W4-02",
          o,
          `ErrCode ${S(rb(c).errCode)}, ErrMsg '${S(rb(c).errMsg)}' after LoadProfiles`,
        );
        return {
          ...verdictOf(
            c.ok ? [] : [`txaChannels: ${why(c)}`],
            [p2, p3],
            `${channels.length} channel(s)`,
          ),
          evidence: { ...pr.evidence, txaChannels: brief(c), biChannels: brief(bi) },
          probes: [p2, p3],
        };
      },
    },
    {
      id: "w4-22-txa-export",
      block: "W4.3",
      title:
        "wb_anim txaExport a 2-frame track into _throwaway/W4/txa/ (dry run, then confirm) (P-W4-04)",
      risk: "mutating",
      timeout_ms: 240_000,
      expected:
        "the dry run writes nothing; the confirm answers written, registered and rebuilt with ErrCode 0; the .txa is on disk at the target",
      kill_criterion:
        "a wrong keyData size: TXA_ERROR whose ErrMsg names the expected size (recorded, P-W4-04 PARTIAL); written elsewhere or an absolute target only: KILLED; no profile: NOT-RUN blocked:OI-W4-1",
      side_effects: [`${TXA} and what register/rebuild write beside it (.meta, .anm)`],
      rollback: "`w4.live.ts rollback` removes _throwaway/W4/txa/",
      probes: ["P-W4-04"],
      dependsOn: ["P-W4-01", "P-W4-02", "P-W4-03"],
      writes: [TXA_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_anim", "txaProfiles", {}, { note: "the profile, when this run has none cached" }),
        tc(
          "wb_anim",
          "txaChannels",
          { profile: "<the profile>" },
          { note: "the channel count, when not cached" },
        ),
        tc(
          "wb_anim",
          "txaExport",
          {
            profile: "<the profile>",
            target: TXA,
            frames: 2,
            fps: 30,
            channelCount: "<channels>",
            keyData: "<frames x channels values>",
          },
          { note: "dry run" },
        ),
        tc("wb_anim", "txaExport", {
          profile: "<the profile>",
          target: TXA,
          frames: 2,
          fps: 30,
          channelCount: "<channels>",
          keyData: "<frames x channels values>",
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        const pr = await profileOf(ctx);
        if (!pr.profile) return blocked(pr.evidence);
        let channels = Number(ctx.state.get("w4.channels") ?? 0);
        const evidence: Raw = { ...pr.evidence };
        if (!channels) {
          const c = await ctx.tool("wb_anim", { action: "txaChannels", profile: pr.profile });
          evidence.txaChannels = brief(c);
          channels = Array.isArray(rb(c).channels) ? (rb(c).channels as unknown[]).length : 0;
        }
        if (!channels)
          return { status: "NOT-RUN", detail: "the profile answers no channel (w4-21)", evidence };
        const args = {
          action: "txaExport",
          profile: pr.profile,
          target: TXA,
          frames: 2,
          fps: 30,
          channelCount: channels,
          keyData: keyDataOf(2, channels),
        };
        const before = onDisk(ctx, TXA);
        const dry = await ctx.tool("wb_anim", args);
        const dryWrote = !before && onDisk(ctx, TXA);
        const made = await ctx.tool("wb_anim", { ...args, confirm: true });
        const after = onDisk(ctx, TXA);
        Object.assign(evidence, { dry: brief(dry), confirm: brief(made), onDisk: after });
        const fails = dryWrote ? ["the dry run wrote the .txa"] : [];
        const o = {
          channels,
          keys: 2 * channels,
          written: rb(made).written ?? null,
          registered: rb(made).registered ?? null,
          rebuilt: rb(made).rebuilt ?? null,
          errCode: rb(made).errCode ?? field(made.txa, "errCode") ?? null,
          errMsg: rb(made).errMsg ?? field(made.txa, "errMsg") ?? null,
          onDiskAtTarget: after,
        };
        const p =
          made.ok && after
            ? settled(
                "P-W4-04",
                o,
                `TrackExport wrote ${TXA}; register ${S(rb(made).registered)}, rebuild ${S(rb(made).rebuilt)}`,
              )
            : !made.ok && S(made.code) === "TXA_ERROR"
              ? partial(
                  "P-W4-04",
                  o,
                  `TXA_ERROR: ${S(o.errMsg)} (the keyData layout the contract note records)`,
                )
              : made.ok
                ? killed("P-W4-04", o, "the export answered ok and no .txa is at the target")
                : killed("P-W4-04", o, `the export failed: ${why(made)}`);
        if (after) ctx.state.set("w4.txa", TXA);
        return {
          ...verdictOf(fails, [p], `txaExport: ${after ? "written" : "not written"}`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w4-23-txa-read",
      block: "W4.4",
      title: "wb_anim txaRead of the exported .txa (P-W4-05)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: "TrackLoad reads the .txa back: eventCount, events and props, ErrCode 0",
      kill_criterion:
        "TrackLoad fails on its own output: KILLED (txaRead and txaEdit refuse UNPROVEN); no .txa: NOT-RUN",
      side_effects: [],
      rollback: "none",
      probes: ["P-W4-05"],
      dependsOn: ["P-W4-01", "P-W4-04"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [tc("wb_anim", "txaRead", { path: TXA, limit: 50 })],
      run: async (ctx) => {
        const pr = await profileOf(ctx);
        if (!pr.profile) return blocked(pr.evidence);
        if (!onDisk(ctx, TXA))
          return {
            status: "NOT-RUN",
            detail: `${TXA} is not on disk (w4-22 did not write it)`,
            evidence: pr.evidence,
          };
        const r = await ctx.tool("wb_anim", { action: "txaRead", path: TXA, limit: 50 });
        const o = {
          ok: r.ok,
          code: r.ok ? null : S(r.code),
          eventCount: rb(r).eventCount ?? null,
          props: rb(r).props ?? null,
          errCode: rb(r).errCode ?? null,
          errMsg: rb(r).errMsg ?? null,
        };
        const p = r.ok
          ? settled("P-W4-05", o, `TrackLoad reads its own output: ${S(rb(r).eventCount)} event(s)`)
          : killed("P-W4-05", o, `TrackLoad fails on its own output: ${why(r)}`);
        return {
          ...verdictOf([], [p], "txaRead"),
          evidence: { ...pr.evidence, txaRead: brief(r) },
          probes: [p],
        };
      },
    },
    {
      id: "w4-24-txa-edit",
      block: "W4.4",
      title:
        "wb_anim txaEdit: a dry run of each op (add, edit, erase, setProp, clearProps); the confirm answers GATED (P-W4-06)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "each dry run answers dryRun with the before/after it would write and leaves the .txa unchanged; the confirm is refused GATED by the TS (nothing sent, TXA_EDIT_PROVEN shut)",
      kill_criterion:
        "a dry run changes the .txa: FAIL; the confirm is sent or answers anything but GATED: FAIL; no .txa: NOT-RUN",
      side_effects: [],
      rollback: "none (dry runs; the confirm is refused before sending)",
      probes: ["P-W4-06"],
      dependsOn: ["P-W4-01", "P-W4-05"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...TXA_EDIT_OPS.map(([k, a]) =>
          tc("wb_anim", "txaEdit", { path: TXA, ...a }, { note: `dry run of ${k}` }),
        ),
        tc(
          "wb_anim",
          "txaEdit",
          { path: TXA, op: "add", eventType: "generic", confirm: true },
          { note: "refused GATED by the TS before sending" },
        ),
      ],
      run: async (ctx) => {
        const pr = await profileOf(ctx);
        if (!pr.profile) return blocked(pr.evidence);
        if (!onDisk(ctx, TXA))
          return { status: "NOT-RUN", detail: `${TXA} is not on disk`, evidence: pr.evidence };
        const start = bytesOf(ctx, TXA);
        const evidence: Raw = { ...pr.evidence };
        const fails: string[] = [];
        const dryRuns: Raw = {};
        for (const [k, a] of TXA_EDIT_OPS) {
          const r = await ctx.tool("wb_anim", { action: "txaEdit", path: TXA, ...a });
          dryRuns[k] = {
            ok: r.ok,
            code: r.ok ? null : S(r.code),
            dryRun: rb(r).dryRun ?? null,
            before: rb(r).before ?? null,
            after: rb(r).after ?? null,
          };
          evidence[`dry ${k}`] = brief(r);
          if (!same(start, bytesOf(ctx, TXA))) fails.push(`the ${k} dry run changed the .txa`);
        }
        const conf = await ctx.tool("wb_anim", {
          action: "txaEdit",
          path: TXA,
          op: "add",
          eventType: "generic",
          confirm: true,
        });
        evidence.confirm = brief(conf);
        if (conf.ok || conf.code !== "GATED")
          fails.push(`the txaEdit confirm answered ${conf.ok ? "ok" : S(conf.code)}, not GATED`);
        if (!same(start, bytesOf(ctx, TXA))) fails.push("the .txa changed");
        const p = partial(
          "P-W4-06",
          { dryRuns, confirm: conf.ok ? "ok" : S(conf.code) },
          "the dry runs show what each op would write after TrackLoad; where TrackExport writes after TrackLoad waits for the write gate (TXA_EDIT_PROVEN, probe sitting)",
        );
        return {
          ...verdictOf(fails, [p], "txaEdit dry runs; confirm GATED"),
          evidence,
          probes: [p],
        };
      },
    },

    // ── W4.2 editors (one document per editor, unedited; the ProcAnim Editor last) ──
    {
      id: "w4-30-module-info",
      block: "W4.2",
      title: "wb_module list, then info on the three W4 editors before any open (P-W4-10 baseline)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "list answers the modules; info answers isOpen, containerCount and containerClasses for each editor (0 containers when nothing is open)",
      kill_criterion: `info fails on an editor: FAIL; ${WINDOW_KILL}`,
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_module", "list"),
        ...["AnimEditor", "BehaviorEditor", "ProcAnimEditor"].map((m) =>
          tc("wb_module", "info", { moduleName: m }),
        ),
      ],
      run: async (ctx) => {
        const list = await ctx.tool("wb_module", { action: "list" });
        const evidence: Raw = { list: brief(list) };
        const fails = list.ok ? [] : [`list: ${why(list)}`];
        for (const m of ["AnimEditor", "BehaviorEditor", "ProcAnimEditor"]) {
          const i = await ctx.tool("wb_module", { action: "info", module: m });
          evidence[m] = brief(i);
          if (!i.ok) fails.push(`info ${m}: ${why(i)}`);
        }
        return { ...verdictOf(fails, [], "list and info answer"), evidence };
      },
    },
    {
      id: "w4-31-anim-open",
      block: "W4.2",
      title:
        "Animation Editor: wb_module open, setResource of the duplicated workspace, info (P-W4-07, P-W4-10, P-W4-16)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open,
      expected:
        "setResource answers result true through the route the build has (Workbench.OpenResource while RELATIVE_OPEN_ANIM is shut); info answers at least one container with the copy open",
      kill_criterion: `the open answers false or ENGINE_FALSE: P-W4-07 KILLED (OpenResource route only); 0 containers: P-W4-10 KILLED for AnimEditor; ${WINDOW_KILL}`,
      side_effects: ["the Animation Editor opens the duplicated workspace (unedited)"],
      rollback: "none: nothing is edited; the editor is left open (close stays refused, DEC-045)",
      probes: ["P-W4-07", "P-W4-10", "P-W4-16"],
      dependsOn: ["P-W4-01"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [...fixturePlan(), ...openEditorPlan("AnimEditor", ANIM_AW)],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const o = await openInEditor(ctx, "AnimEditor", ANIM_AW);
        const p7 = routeProbe("P-W4-07", "AnimEditor", ANIM_AW, o.set);
        const p10 = containerProbe("AnimEditor", ANIM_AW, o.info);
        const count = Number(rb(o.info).containerCount ?? 0);
        const p16 =
          count > 0 && o.set?.ok
            ? partial(
                "P-W4-16",
                { containerCount: count, containerClasses: rb(o.info).containerClasses ?? null },
                "the Animation Editor opens the copy and holds it as a container",
              )
            : partial(
                "P-W4-16",
                {
                  containerCount: count,
                  open: o.set ? (o.set.ok ? "ok" : S(o.set.code)) : "not sent",
                },
                "the Animation Editor did not report the copy as a container",
              );
        const fails = o.set ? [] : [S(o.evidence.refused)];
        return {
          ...verdictOf(fails, [p7, p10, p16], `AnimEditor: ${count} container(s)`),
          evidence: o.evidence,
          probes: [p7, p10, p16],
        };
      },
    },
    {
      id: "w4-32-bt-open",
      block: "W4.2",
      title:
        "Behavior Editor: wb_module open, setResource of the created .bt (the Resource Manager route), info (P-W4-09, P-W4-10)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open,
      expected: "the .bt opens in the Behavior Editor; info answers a container",
      kill_criterion: `the tree does not open: P-W4-09 KILLED (behavior_tree stays offline-only); 0 containers: P-W4-10 KILLED for BehaviorEditor; ${WINDOW_KILL}`,
      side_effects: ["the Behavior Editor opens the created tree (unedited)"],
      rollback: "none: nothing is edited",
      probes: ["P-W4-09", "P-W4-10"],
      dependsOn: ["P-W4-01"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [...fixturePlan(), ...openEditorPlan("BehaviorEditor", BT)],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const o = await openInEditor(ctx, "BehaviorEditor", BT);
        const p9 = routeProbe("P-W4-09", "BehaviorEditor", BT, o.set);
        const p10 = containerProbe("BehaviorEditor", BT, o.info);
        const fails = o.set ? [] : [S(o.evidence.refused)];
        return {
          ...verdictOf(
            fails,
            [p9, p10],
            `BehaviorEditor: ${S(rb(o.info).containerCount)} container(s)`,
          ),
          evidence: o.evidence,
          probes: [p9, p10],
        };
      },
    },
    {
      id: "w4-33-types-open",
      block: "W4.2",
      title:
        "the .ae, .aex and .asy copies opened through the Resource Manager route: which module takes each, and no dialog (P-W4-15)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open,
      expected:
        "each setResource ResourceManager answers the module that opened it (openedIn); no dialog-like window appears; info AnimEditor after each",
      kill_criterion: `another module or a dialog: P-W4-15 KILLED (OwnerOf leaves them on ResourceManager, offline-read only); ${WINDOW_KILL}`,
      side_effects: [
        "the Animation Editor (or the module the engine picks) opens each copy (unedited)",
      ],
      rollback: "none: nothing is edited",
      probes: ["P-W4-15"],
      dependsOn: ["P-W4-01"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...TYPE_COPIES.flatMap((rel) => openEditorPlan("ResourceManager", rel)),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const observed: Raw = {};
        const fails: string[] = [];
        for (const rel of TYPE_COPIES) {
          const o = await openInEditor(ctx, "ResourceManager", rel);
          evidence[rel] = o.evidence;
          if (!o.set) fails.push(S(o.evidence.refused));
          observed[extOfRel(rel)] = {
            ok: o.set?.ok ?? null,
            code: o.set && !o.set.ok ? S(o.set.code) : null,
            openedIn: rb(o.set).openedIn ?? null,
            animEditorContainers: rb(o.info).containerCount ?? null,
            animEditorClasses: rb(o.info).containerClasses ?? null,
          };
        }
        const notAnim = Object.entries(observed).filter(
          ([, v]) => S(field(v, "openedIn")) !== "AnimEditor",
        );
        const p =
          notAnim.length === 0
            ? settled(
                "P-W4-15",
                observed,
                "the Animation Editor opens .ae, .aex and .asy with no dialog",
              )
            : partial(
                "P-W4-15",
                observed,
                `${notAnim.map(([e, v]) => `${e} opened in '${S(field(v, "openedIn")) || S(field(v, "code"))}'`).join(", ")}; windowsAdded in the record names any window`,
              );
        return { ...verdictOf(fails, [p], "three types routed"), evidence, probes: [p] };
      },
    },
    {
      id: "w4-34-procanim-open",
      block: "W4.2",
      title:
        "ProcAnim Editor (last): wb_module open, setResource of the .pap copy, info (P-W4-08, P-W4-10)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open,
      expected:
        "the .pap opens in the ProcAnim Editor through the build's route; info answers a container",
      kill_criterion: `false: P-W4-08 KILLED (OpenResource route only); a crash: LOST, the battery stops (ProcAnimEditor joins ParticleEditor as never-read); 0 containers: P-W4-10 KILLED for ProcAnimEditor; ${WINDOW_KILL}`,
      side_effects: ["the ProcAnim Editor opens the .pap copy (unedited)"],
      rollback: "none: nothing is edited",
      probes: ["P-W4-08", "P-W4-10"],
      dependsOn: ["P-W4-01"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [...fixturePlan(), ...openEditorPlan("ProcAnimEditor", PAP)],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const o = await openInEditor(ctx, "ProcAnimEditor", PAP);
        const p8 = routeProbe("P-W4-08", "ProcAnimEditor", PAP, o.set);
        const p10 = containerProbe("ProcAnimEditor", PAP, o.info);
        const fails = o.set ? [] : [S(o.evidence.refused)];
        return {
          ...verdictOf(
            fails,
            [p8, p10],
            `ProcAnimEditor: ${S(rb(o.info).containerCount)} container(s)`,
          ),
          evidence: o.evidence,
          probes: [p8, p10],
        };
      },
    },
    {
      id: "w4-36-refusals",
      block: "W4.2",
      title:
        "the gated and refused actions, each for its refusal: wb_anim check, wb_module save (dry run) and close on the three editors, wb_container describe/get on open:<editor>; wb_module front",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "check answers GATED (TS, nothing opened); save is refused NO_DOCUMENT in Enforce (P-W4-10 killed in run 1; a dry run besides); close is refused MODULE_NOT_SUPPORTED by the TS; describe and get on open:<editor> are refused (GATED, MODULE_NOT_SUPPORTED or NO_OPEN_RESOURCE); front answers ok",
      kill_criterion: `any of these answers ok (a gate is open in this build): FAIL with the answer; ${WINDOW_KILL}`,
      side_effects: ["the front call raises each editor window"],
      rollback: "none: nothing is written or edited",
      probes: [],
      dependsOn: ["P-W4-01"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc(
          "wb_anim",
          "check",
          { path: ANIM_AW },
          { note: "refused GATED by the TS before sending" },
        ),
        ...EDITORS.flatMap((m) => [
          tc("wb_module", "front", { moduleName: m }),
          tc(
            "wb_module",
            "save",
            { moduleName: m, target: `open:${m}` },
            {
              note: "a dry run (no confirm), refused NO_DOCUMENT in Enforce (P-W4-10 killed, run 1)",
            },
          ),
          tc(
            "wb_module",
            "close",
            { moduleName: m },
            { note: "refused MODULE_NOT_SUPPORTED by the TS before sending" },
          ),
          tc("wb_container", "describe", { target: `open:${m}` }),
          tc("wb_container", "get", { target: `open:${m}`, path: "#0" }),
        ]),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const ck = await ctx.tool("wb_anim", { action: "check", path: ANIM_AW });
        evidence.check = brief(ck);
        if (ck.ok || ck.code !== "GATED")
          fails.push(`check answered ${ck.ok ? "ok" : S(ck.code)}, not GATED`);
        for (const m of EDITORS) {
          const fr = await ctx.tool("wb_module", { action: "front", module: m });
          const sv = await ctx.tool("wb_module", {
            action: "save",
            module: m,
            target: `open:${m}`,
          });
          const cl = await ctx.tool("wb_module", { action: "close", module: m });
          const d = await ctx.tool("wb_container", { action: "describe", target: `open:${m}` });
          const g = await ctx.tool("wb_container", {
            action: "get",
            target: `open:${m}`,
            path: "#0",
          });
          evidence[m] = {
            front: brief(fr),
            save: brief(sv),
            close: brief(cl),
            describe: brief(d),
            get: brief(g),
          };
          if (!fr.ok) fails.push(`front ${m}: ${why(fr)}`);
          if (sv.ok || sv.code !== "NO_DOCUMENT")
            fails.push(
              `save ${m} answered ${sv.ok ? "ok" : S(sv.code)}, not NO_DOCUMENT (P-W4-10 killed)`,
            );
          if (cl.ok || cl.code !== "MODULE_NOT_SUPPORTED")
            fails.push(`close ${m} answered ${cl.ok ? "ok" : S(cl.code)}`);
          if (d.ok) fails.push(`describe open:${m} answered ok (EDITOR_OPEN gate open?)`);
          if (g.ok) fails.push(`get open:${m} answered ok (EDITOR_OPEN gate open?)`);
        }
        return {
          ...verdictOf(fails, [], "every gated or refused action answered its refusal"),
          evidence,
        };
      },
    },

    // ── W4.5 offline tools: engine accepts (each step its own unit) ──
    {
      id: "w4-49-lint-tools",
      block: "W4.5",
      title:
        "animation_find_unused_clips on the test project and weapon_pose_lint on the planted .agr (read-only)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "both answer without an error (a JSON report; the lint lists missing tags of a non-character graph)",
      kill_criterion: "an error answer: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      plan: () => [],
      offlineCalls: () => [
        oc("animation_find_unused_clips", "run", { include_workshop: false, format: "json" }),
        oc("weapon_pose_lint", "run", { agr_path: OFF_AGR }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const a = await ctx.offline("animation_find_unused_clips", {
          action: "run",
          include_workshop: false,
          format: "json",
        });
        const b = await ctx.offline("weapon_pose_lint", { action: "run", agr_path: OFF_AGR });
        const evidence = {
          unusedClips: { ok: a.ok, text: textOfResp(a).slice(0, 800) },
          poseLint: { ok: b.ok, text: textOfResp(b).slice(0, 800) },
        };
        return {
          ...verdictOf(
            offlineFails([
              ["animation_find_unused_clips", a],
              ["weapon_pose_lint", b],
            ]),
            [],
            "both lint tools answer",
          ),
          evidence,
        };
      },
    },
    {
      id: "w4-50-graph-accept",
      block: "W4.5",
      title:
        "animation_graph on the planted .agr/.agf copies (nodes, setup, inspect, validate, edit addVariable and setProp, author into created/), then the engine loads both and reads the edits (P-W4-24)",
      risk: "mutating",
      timeout_ms: 180_000,
      expected: `the dry run leaves the .agr unchanged; the edits write W4_Accept and AwakeExpr "${NEEDLES.agfExpr}"; register and describe on path: read both back`,
      kill_criterion: `the engine rejects the file: P-W4-24 KILLED (edit ships dry-run only); ${WINDOW_KILL}`,
      side_effects: [
        `${OFF_AGR}, ${OFF_AGF} edited (+ .bak, .meta)`,
        `${CREATED_DIR}/W4_author.agr/.ast`,
      ],
      rollback:
        "`w4.live.ts rollback` removes the copies; nothing outside _throwaway/W4/ is written",
      probes: ["P-W4-24"],
      writes: [OFF_AGR, OFF_AGF, CREATED_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [...engineReadPlan(OFF_AGR), ...engineReadPlan(OFF_AGF)],
      offlineCalls: () => GRAPH_CALLS.map(([, a]) => oc("animation_graph", S(a.action), a)),
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const start = bytesOf(ctx, OFF_AGR);
        const pairs: Array<[string, ToolResponse]> = [];
        for (const [k, a] of GRAPH_CALLS) {
          const r = await ctx.offline("animation_graph", a);
          pairs.push([k, r]);
          evidence[k] =
            k === "inspect" || k === "nodes" ? { ok: r.ok, code: r.code ?? null } : brief(r);
          if (k === "editDry" && !same(start, bytesOf(ctx, OFF_AGR)))
            pairs.push([k, { ok: false, code: "WROTE", message: "the dry run changed the .agr" }]);
        }
        const fails = offlineFails(pairs);
        const agr = await engineRead(ctx, OFF_AGR, [NEEDLES.agrVar]);
        const agf = await engineRead(ctx, OFF_AGF, [NEEDLES.agfExpr]);
        evidence.agrRead = agr.evidence;
        evidence.agfRead = agf.evidence;
        const pa = acceptProbe("P-W4-24", ".agr", agr);
        const pf = acceptProbe("P-W4-24", ".agf", agf);
        const p = [pa, pf].some((x) => x.result === "KILLED")
          ? killed(
              "P-W4-24",
              { agr: pa.observed, agf: pf.observed },
              [pa, pf]
                .filter((x) => x.result === "KILLED")
                .map((x) => x.note)
                .join("; "),
            )
          : [pa, pf].every((x) => x.result === "SETTLED")
            ? settled(
                "P-W4-24",
                { agr: pa.observed, agf: pf.observed },
                "the engine loads the edited .agr and .agf and reads both edits",
              )
            : partial("P-W4-24", { agr: pa.observed, agf: pf.observed }, `${pa.note}; ${pf.note}`);
        return { ...verdictOf(fails, [p], "graph edits read back"), evidence, probes: [p] };
      },
    },
    {
      id: "w4-51-set-accept",
      block: "W4.5",
      title:
        "animation_set: create an .ast, addGroup/addColumn/addAnimation, read, validate; register it; create an .asi on it, map a vanilla .anm, unmap after the read; the engine reads both (P-W4-25)",
      risk: "mutating",
      timeout_ms: 180_000,
      expected: `the .ast holds group ${NEEDLES.astGroup} with ${NEEDLES.astColumn} and ${NEEDLES.astAnimation}; the .asi maps ${NEEDLES.asiAnm}; describe on path: reads them back`,
      kill_criterion: `the engine rejects a file: P-W4-25 KILLED (that op is dry-run only); ${WINDOW_KILL}`,
      side_effects: [`${OFF_AST}, ${OFF_ASI} (+ .bak, .meta)`],
      rollback: "`w4.live.ts rollback` removes them",
      probes: ["P-W4-25"],
      writes: [OFF_AST, OFF_ASI],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [...engineReadPlan(OFF_AST), ...engineReadPlan(OFF_ASI)],
      offlineCalls: () => [
        ...SET_AST_CALLS.map(([, a]) => oc("animation_set", S(a.action), a)),
        ...setAsiCalls("<the .ast resource name>").map(([, a]) =>
          oc("animation_set", S(a.action), a),
        ),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const pairs: Array<[string, ToolResponse]> = [];
        if (!onDisk(ctx, OFF_AST))
          for (const [k, a] of SET_AST_CALLS) {
            const r = await ctx.offline("animation_set", a);
            pairs.push([k, r]);
            evidence[k] = brief(r);
          }
        else evidence.ast = "already on disk (a resumed run)";
        const ast = await engineRead(ctx, OFF_AST, [
          NEEDLES.astGroup,
          NEEDLES.astColumn,
          NEEDLES.astAnimation,
        ]);
        evidence.astRead = ast.evidence;
        let asi: EngineRead | null = null;
        if (guidOf(ast.name)) {
          const calls = setAsiCalls(ast.name);
          if (!onDisk(ctx, OFF_ASI))
            for (const [k, a] of calls.filter(([k]) => k !== "unmap")) {
              const r = await ctx.offline("animation_set", a);
              pairs.push([k, r]);
              evidence[k] = brief(r);
            }
          asi = await engineRead(ctx, OFF_ASI, [NEEDLES.asiAnm]);
          evidence.asiRead = asi.evidence;
          const un = await ctx.offline("animation_set", calls.find(([k]) => k === "unmap")![1]);
          pairs.push(["unmap", un]);
          evidence.unmap = brief(un);
        } else
          pairs.push([
            "register .ast",
            { ok: false, code: "NO_GUID", message: `the .ast registered as '${ast.name}'` },
          ]);
        const fails = offlineFails(pairs);
        const pt = acceptProbe("P-W4-25", ".ast", ast);
        const pi = asi
          ? acceptProbe("P-W4-25", ".asi", asi)
          : partial("P-W4-25", {}, "no .asi: the .ast did not register");
        const both = [pt, pi];
        const p = both.some((x) => x.result === "KILLED")
          ? killed(
              "P-W4-25",
              { ast: pt.observed, asi: pi.observed },
              both
                .filter((x) => x.result === "KILLED")
                .map((x) => x.note)
                .join("; "),
            )
          : both.every((x) => x.result === "SETTLED")
            ? settled(
                "P-W4-25",
                { ast: pt.observed, asi: pi.observed },
                "the engine loads the written .ast and .asi with their edits",
              )
            : partial("P-W4-25", { ast: pt.observed, asi: pi.observed }, `${pt.note}; ${pi.note}`);
        return { ...verdictOf(fails, [p], "set edits read back"), evidence, probes: [p] };
      },
    },
    {
      id: "w4-52-bt-accept",
      block: "W4.5",
      title:
        "behavior_tree: nodes, create (dry run, then written), edit (rename + set_property), inspect, validate, diff against a vanilla tree; the engine reads the edited tree (P-W4-26)",
      risk: "mutating",
      timeout_ms: 150_000,
      expected: `the dry run writes nothing; the edit renames the idle task ${NEEDLES.btNode}; register and describe on path: read the name back`,
      kill_criterion: `the engine rejects the tree: P-W4-26 KILLED (the failing edit op is dry-run only); ${WINDOW_KILL}`,
      side_effects: [`${OFF_BT} (+ .meta)`],
      rollback: "`w4.live.ts rollback` removes it",
      probes: ["P-W4-26"],
      writes: [OFF_BT],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => engineReadPlan(OFF_BT),
      offlineCalls: () => BT_CALLS.map(([, a]) => oc("behavior_tree", S(a.action), a)),
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const pairs: Array<[string, ToolResponse]> = [];
        if (!onDisk(ctx, OFF_BT))
          for (const [k, a] of BT_CALLS) {
            const r = await ctx.offline("behavior_tree", a);
            pairs.push([k, r]);
            evidence[k] = {
              ok: r.ok,
              code: r.code ?? null,
              text: textOfResp(r).slice(0, 600) || null,
            };
            if (k === "createDry" && onDisk(ctx, OFF_BT))
              pairs.push([
                k,
                { ok: false, code: "WROTE", message: "the create dry run wrote the tree" },
              ]);
          }
        else evidence.bt = "already on disk (a resumed run)";
        const fails = offlineFails(pairs);
        const r = await engineRead(ctx, OFF_BT, [NEEDLES.btNode]);
        evidence.btRead = r.evidence;
        const p = acceptProbe("P-W4-26", ".bt", r);
        return { ...verdictOf(fails, [p], "tree edits read back"), evidence, probes: [p] };
      },
    },
    {
      id: "w4-53-pap-accept",
      block: "W4.5",
      title:
        "procanim: nodes, create (a vanilla .pap copy), inspect, edit a node position, validate (stale compiled blocks); the engine loads the edited .pap (P-W4-28)",
      risk: "mutating",
      timeout_ms: 150_000,
      expected: `validate names the stale compiled block; register and describe on path: load the .pap and read tl ${NEEDLES.papTl}`,
      kill_criterion: `the load fails: P-W4-28 KILLED (validate marks stale compiled blocks as an error; edit requires the recompile step); ${WINDOW_KILL}`,
      side_effects: [`${OFF_PAP} (+ .bak, .meta)`],
      rollback: "`w4.live.ts rollback` removes it",
      probes: ["P-W4-28"],
      writes: [OFF_PAP],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => engineReadPlan(OFF_PAP),
      offlineCalls: () => PAP_CALLS.map(([, a]) => oc("procanim", S(a.action), a)),
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const pairs: Array<[string, ToolResponse]> = [];
        if (!onDisk(ctx, OFF_PAP))
          for (const [k, a] of PAP_CALLS) {
            const r = await ctx.offline("procanim", a);
            pairs.push([k, r]);
            evidence[k] =
              k === "nodes" || k === "inspect" ? { ok: r.ok, code: r.code ?? null } : brief(r);
          }
        else evidence.pap = "already on disk (a resumed run)";
        const fails = offlineFails(pairs);
        const stale = JSON.stringify(evidence.validate ?? "").includes("compiled-stale");
        const r = await engineRead(ctx, OFF_PAP, [NEEDLES.papTl]);
        evidence.papRead = r.evidence;
        const a = acceptProbe("P-W4-28", ".pap", r);
        const p =
          a.result === "KILLED"
            ? a
            : partial(
                "P-W4-28",
                { ...a.observed, staleBeforeLoad: stale },
                `${a.note}; which half (nodes or compiled ops) drives the runtime is not read here (the hand step w4-90 and the probe sitting)`,
              );
        return {
          ...verdictOf(fails, [p], "the .pap with stale compiled blocks loads"),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w4-54-workspace-accept",
      block: "W4.5",
      title:
        "animation_workspace: read, files and validate on the duplicate; create a new .aw on the registered .ast, set its Model; the engine reads the new .aw (P-W4-16)",
      risk: "mutating",
      timeout_ms: 150_000,
      expected: `the reads answer the duplicate's set with 0 unresolved; create writes and registers the .aw; set changes its Model to ${NEEDLES.awModel}; describe on path: reads the Model and the template GUID`,
      kill_criterion: `the engine rejects the created .aw: FAIL; ${WINDOW_KILL}`,
      side_effects: [`${OFF_AW} (+ .ae event table, .bak, .meta)`],
      rollback: "`w4.live.ts rollback` removes them",
      probes: ["P-W4-16"],
      writes: [OFF_AW, OFF_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_resources", "resolve", { path: OFF_AST }, { note: "the .ast's resource name" }),
        tc(
          "wb_resources",
          "register",
          { path: OFF_AST, confirm: true },
          { note: "only when w4-51 did not register it" },
        ),
        registerByTool(OFF_AW, "animation_workspace create"),
        ...engineReadPlan(OFF_AW),
      ],
      offlineCalls: () => [
        oc("animation_workspace", "read", { path: ANIM_AW }),
        oc("animation_workspace", "files", { path: ANIM_AW }),
        oc("animation_workspace", "validate", { path: ANIM_AW }),
        oc("animation_set", "create", { path: OFF_AST, confirm: true }),
        oc("animation_workspace", "create", {
          target: OFF_AW,
          animSetTemplate: "<the .ast resource name>",
          confirm: true,
        }),
        oc("animation_workspace", "set", {
          path: OFF_AW,
          field: "Model",
          value: OTHER_MODEL,
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const pairs: Array<[string, ToolResponse]> = [];
        for (const k of ["read", "files", "validate"]) {
          const r = await ctx.offline("animation_workspace", { action: k, path: ANIM_AW });
          pairs.push([k, r]);
          evidence[k] =
            k === "validate"
              ? brief(r)
              : { ok: r.ok, total: rb(r).total ?? null, unresolved: rb(r).unresolved ?? null };
        }
        if (!onDisk(ctx, OFF_AST)) {
          const c = await ctx.offline("animation_set", {
            action: "create",
            path: OFF_AST,
            confirm: true,
          });
          pairs.push(["ast create", c]);
        }
        let astName = ctx.state.get(OFF_AST) ?? "";
        if (!guidOf(astName)) {
          const res = await ctx.tool("wb_resources", { action: "resolve", path: OFF_AST });
          astName = res.ok && rb(res).hasMeta === true ? S(rb(res).resourceName) : "";
          if (!guidOf(astName)) {
            const reg = await ctx.tool("wb_resources", {
              action: "register",
              path: OFF_AST,
              confirm: true,
            });
            astName = S(rb(reg).resourceName);
          }
        }
        evidence.ast = astName;
        if (!guidOf(astName))
          return {
            status: "FAIL",
            detail: `the .ast has no resource name ('${astName}')`,
            evidence,
          };
        if (!onDisk(ctx, OFF_AW)) {
          const c = await ctx.offline("animation_workspace", {
            action: "create",
            target: OFF_AW,
            animSetTemplate: astName,
            confirm: true,
          });
          pairs.push(["create", c]);
          evidence.create = brief(c);
          const s = await ctx.offline("animation_workspace", {
            action: "set",
            path: OFF_AW,
            field: "Model",
            value: OTHER_MODEL,
            confirm: true,
          });
          pairs.push(["set", s]);
          evidence.set = brief(s);
        } else evidence.aw = "already on disk (a resumed run)";
        const fails = offlineFails(pairs);
        const r = await engineRead(ctx, OFF_AW, [NEEDLES.awModel, guidOf(astName)]);
        evidence.awRead = r.evidence;
        if (!r.loaded) fails.push("the engine did not load the created .aw");
        const p = partial(
          "P-W4-16",
          { created: r.found, loaded: r.loaded },
          r.loaded
            ? "a created and set .aw on the copied tooling loads in the engine"
            : "the created .aw did not load",
        );
        return {
          ...verdictOf(fails, [p], "workspace create and set read back"),
          evidence,
          probes: [p],
        };
      },
    },
    // ── W4.6 play ──
    {
      id: "w4-60-play",
      block: "W4.6",
      title:
        "the W4 world: a character and a compass created, play, wb_anim_debug vars/tags/procAnim (set, command, btBreakpoint for their refusal), stop (always), both creates undone (P-W4-18, P-W4-20)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + TIMEOUTS.play,
      expected:
        "vars answers the character's player_main.agr variables (id >= 0 for at least one); tags answers; procAnim answers the compass's controllers, signals and bones; set, command and btBreakpoint answer GATED from the TS; stop settles in edit; both entities are gone after two undos",
      kill_criterion: `no runtime entity or no component: P-W4-18 KILLED (wb_anim_debug refuses ENTITY_NOT_FOUND, rows stay W8); no ProcAnim component on the compass: P-W4-20 KILLED; a crash: LOST, the battery stops; ${WINDOW_KILL}`,
      side_effects: [
        "two entities created in memory in the W4 world and undone; play entered and left; nothing saved",
      ],
      rollback:
        "wb_world stop in a finally path (a restorer even after a cut); Edit > Undo for each create (the runner pays any undo the step still owes)",
      probes: ["P-W4-18", "P-W4-20"],
      dependsOn: ["P-W4-01"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_entity", "create", { prefab: CHARACTER, name: CHAR_NAME }),
        tc("wb_entity", "create", { prefab: COMPASS, name: COMPASS_NAME, coords: "2 0 2" }),
        tc("wb_world", "play", { debugMode: false, fullScreen: false }),
        tc("wb_world", "state"),
        tc("wb_anim_debug", "vars", {
          target: `name:${CHAR_NAME}`,
          names: [...VAR_NAMES],
          varTypes: [...VAR_TYPES],
        }),
        tc("wb_anim_debug", "tags", {
          target: `name:${CHAR_NAME}`,
          names: [...TAG_NAMES],
          kind: "tag",
        }),
        tc("wb_anim_debug", "tags", {
          target: `name:${CHAR_NAME}`,
          names: ["W4_none"],
          kind: "event",
        }),
        tc("wb_anim_debug", "procAnim", { target: `name:${COMPASS_NAME}`, ctrl: 0 }),
        tc(
          "wb_anim_debug",
          "set",
          { target: `name:${CHAR_NAME}`, name: "ADS", varType: "bool", value: "false" },
          { note: "refused GATED by the TS before sending" },
        ),
        tc(
          "wb_anim_debug",
          "command",
          { target: `name:${CHAR_NAME}`, name: "W4_none" },
          { note: "refused GATED by the TS before sending" },
        ),
        tc(
          "wb_anim_debug",
          "btBreakpoint",
          { target: `name:${CHAR_NAME}`, enable: false },
          { note: "refused GATED by the TS before sending" },
        ),
        tc("wb_world", "stop"),
        tc("wb_world", "state"),
        ...undoPlan(2),
        tc("wb_entity", "get", { entity: `name:${CHAR_NAME}` }),
        tc("wb_entity", "get", { entity: `name:${COMPASS_NAME}` }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!(await ensureWorld(ctx, evidence, fails)))
          return {
            status: "FAIL",
            detail: fails.join("; ") || "the W4 world did not open",
            evidence,
          };
        const c1 = await ctx.tool("wb_entity", {
          action: "create",
          prefab: CHARACTER,
          name: CHAR_NAME,
        });
        const c2 = await ctx.tool("wb_entity", {
          action: "create",
          prefab: COMPASS,
          name: COMPASS_NAME,
          coords: "2 0 2",
        });
        evidence.createCharacter = brief(c1);
        evidence.createCompass = brief(c2);
        if (!c1.ok) fails.push(`create ${CHAR_NAME}: ${why(c1)}`);
        if (!c2.ok) fails.push(`create ${COMPASS_NAME}: ${why(c2)}`);
        let play: ToolResponse | null = null;
        let during: ToolResponse | null = null;
        let stop: ToolResponse | null = null;
        const reads: Record<string, ToolResponse> = {};
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
          if (c1.ok || c2.ok) {
            play = await ctx.tool("wb_world", {
              action: "play",
              debugMode: false,
              fullScreen: false,
            });
            during = await ctx.tool("wb_world", { action: "state" });
            const t = (n: string) => `entity:name:${n}`;
            reads.vars = await ctx.tool("wb_anim_debug", {
              action: "vars",
              target: t(CHAR_NAME),
              names: [...VAR_NAMES],
              varTypes: [...VAR_TYPES],
            });
            reads.tags = await ctx.tool("wb_anim_debug", {
              action: "tags",
              target: t(CHAR_NAME),
              names: [...TAG_NAMES],
              kind: "tag",
            });
            reads.events = await ctx.tool("wb_anim_debug", {
              action: "tags",
              target: t(CHAR_NAME),
              names: ["W4_none"],
              kind: "event",
            });
            reads.procAnim = await ctx.tool("wb_anim_debug", {
              action: "procAnim",
              target: t(COMPASS_NAME),
              ctrl: 0,
            });
            reads.set = await ctx.tool("wb_anim_debug", {
              action: "set",
              target: t(CHAR_NAME),
              name: "ADS",
              varType: "bool",
              value: "false",
            });
            reads.command = await ctx.tool("wb_anim_debug", {
              action: "command",
              target: t(CHAR_NAME),
              name: "W4_none",
            });
            reads.btBreakpoint = await ctx.tool("wb_anim_debug", {
              action: "btBreakpoint",
              target: t(CHAR_NAME),
              enable: false,
            });
          }
        } finally {
          if (!ctx.signal.aborted && play) {
            stop = await ctx.tool("wb_world", { action: "stop" }, { restore: true });
            // Play is left before the step ends: the next steps and the closable step meet edit mode.
            if (!ctx.signal.aborted) evidence.editPolls = (await waitMode(ctx, "edit")).polls;
          }
          if (!ctx.signal.aborted) ctx.debt.restorers.pop();
        }
        const after = await ctx.tool("wb_world", { action: "state" });
        const undos: UndoResult[] = [];
        while (ctx.debt.undos > 0) {
          const u = await ctx.undo();
          undos.push(u);
          if (!u.ok) break;
        }
        const g1 = await ctx.tool("wb_entity", { action: "get", entity: `name:${CHAR_NAME}` });
        const g2 = await ctx.tool("wb_entity", { action: "get", entity: `name:${COMPASS_NAME}` });
        Object.assign(evidence, {
          play: play ? brief(play) : null,
          stateDuringPlay: during ? brief(during) : null,
          reads: Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, brief(r)])),
          stop: stop ? brief(stop) : null,
          stateAfter: brief(after),
          undos,
          goneCharacter: !g1.ok && g1.code === "ENTITY_NOT_FOUND",
          goneCompass: !g2.ok && g2.code === "ENTITY_NOT_FOUND",
        });
        if (play && !play.ok) fails.push(`play: ${why(play)}`);
        if (play && (!stop || !stop.ok)) fails.push(`stop: ${stop ? why(stop) : "not sent"}`);
        if (S(rb(after).mode) && S(rb(after).mode) !== "edit")
          fails.push(`mode ${S(rb(after).mode)} after stop`);
        if (g1.ok || g2.ok)
          fails.push("an entity created by this step is still in the world after the undos");
        for (const k of ["set", "command", "btBreakpoint"]) {
          const r = reads[k];
          if (r && (r.ok || r.code !== "GATED"))
            fails.push(`${k} answered ${r.ok ? "ok" : S(r.code)}, not GATED`);
        }
        const v = reads.vars;
        const rows = Array.isArray(rb(v).values) ? (rb(v).values as Raw[]) : [];
        const known = rows.filter((x) => x.known === true || Number(x.id ?? -1) >= 0);
        const o18 = {
          vars: v ? (v.ok ? rows : S(v.code)) : "not sent",
          tags: reads.tags
            ? reads.tags.ok
              ? rb(reads.tags).values
              : S(reads.tags.code)
            : "not sent",
        };
        const p18 = !v
          ? partial("P-W4-18", o18, "play did not start: nothing read")
          : !v.ok
            ? killed("P-W4-18", o18, `vars in play mode: ${why(v)}`)
            : known.length
              ? settled(
                  "P-W4-18",
                  o18,
                  `SourceToEntity gives the runtime character; ${known.length} of ${rows.length} variable(s) bind and read`,
                )
              : partial(
                  "P-W4-18",
                  o18,
                  "the runtime character answers; none of the named variables is known to its graph",
                );
        const pa = reads.procAnim;
        const o20 = pa ? (pa.ok ? rb(pa) : { code: S(pa.code) }) : { sent: false };
        const p20 = !pa
          ? partial("P-W4-20", o20, "play did not start: nothing read")
          : !pa.ok
            ? killed("P-W4-20", o20, `procAnim on the compass: ${why(pa)}`)
            : Number(rb(pa).controllers ?? 0) > 0
              ? settled(
                  "P-W4-20",
                  o20,
                  `${S(rb(pa).controllers)} controller(s), ${strs(rb(pa).signals).length} signal(s), ${strs(rb(pa).bones).length} bone(s)`,
                )
              : killed("P-W4-20", o20, "the compass reports no ProcAnim controller in play mode");
        return {
          ...verdictOf(fails, [p18, p20], "play-mode reads, stop and undo"),
          evidence,
          probes: [p18, p20],
        };
      },
    },

    // ── W4.7 aliases and equivalents ──
    {
      id: "w4-70-aliases",
      block: "W4.7",
      title:
        "1.x names and equivalents: animation_graph inspect with inspectAction=validate; the two 1.9 Bohemia profile handlers (gated in TS, P-W4-23); wb_module action Window > Log Console on the Resource Manager (toggled back)",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "the alias answers the validate report; wb_bi call of GetAnimationExportProfileInfosInProject and GetAnimationExporProfileChannelsInfo is refused by the TS before sending; the Log Console toggles twice",
      kill_criterion: `a 1.9 profile handler is sent: FAIL; the toggle fails: FAIL; ${WINDOW_KILL}`,
      side_effects: ["the Log Console dock toggled twice (back to its state)"],
      rollback: "the second toggle",
      probes: ["P-W4-23"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc(
          "wb_bi",
          "call",
          { handler: "GetAnimationExportProfileInfosInProject", request: {} },
          {
            target: "GetAnimationExportProfileInfosInProject",
            note: "refused by the TS before sending (not verified live)",
          },
        ),
        tc(
          "wb_bi",
          "call",
          {
            handler: "GetAnimationExporProfileChannelsInfo",
            request: { animationExportProfile: "x" },
          },
          {
            target: "GetAnimationExporProfileChannelsInfo",
            note: "refused by the TS before sending (not verified live)",
          },
        ),
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
      ],
      offlineCalls: () => [
        oc("animation_graph", "inspect", { path: OFF_AGR, inspectAction: "validate" }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const al = await ctx.offline("animation_graph", {
          action: "inspect",
          path: OFF_AGR,
          inspectAction: "validate",
        });
        const b1 = await ctx.tool("wb_bi", {
          action: "call",
          handler: "GetAnimationExportProfileInfosInProject",
          request: {},
        });
        const b2 = await ctx.tool("wb_bi", {
          action: "call",
          handler: "GetAnimationExporProfileChannelsInfo",
          request: { animationExportProfile: "x" },
        });
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
        const evidence: Raw = {
          alias: { ok: al.ok, text: textOfResp(al).slice(0, 400) },
          profileInfos: brief(b1),
          profileChannels: brief(b2),
          action1: brief(a1),
          action2: brief(a2),
        };
        const fails = offlineFails([
          ["inspectAction=validate", al],
          ["action", a1],
          ["action back", a2],
        ]);
        for (const [k, b] of [
          ["GetAnimationExportProfileInfosInProject", b1],
          ["GetAnimationExporProfileChannelsInfo", b2],
        ] as const)
          if (b.ok) fails.push(`${k} answered ok: it was sent (it must stay gated until P-W4-23)`);
        const p = partial(
          "P-W4-23",
          {
            GetAnimationExportProfileInfosInProject: b1.ok ? "ok" : S(b1.code),
            GetAnimationExporProfileChannelsInfo: b2.ok ? "ok" : S(b2.code),
          },
          "both are gated in the TS (bi-handlers.ts) and were not called; their dialog question is the probe sitting's; wb_anim txaProfiles answers the same data (w4-20)",
        );
        return {
          ...verdictOf(fails, [p], "1.x names and equivalents answer"),
          evidence,
          probes: [p],
        };
      },
    },

    // ── W4.8 hand (the ONE hand block; --skip-hand records it HELD) ──
    {
      id: "w4-90-pap-save-hand",
      block: "W4.8",
      title:
        "hand step H2 (OI-W4-2): the edited .pap copy opened in the ProcAnim Editor, the hand presses Save once; procanim validate before and after (P-W4-12)",
      risk: "mutating",
      timeout_ms: HAND_WAIT_MS + TIMEOUTS.open,
      expected:
        "before: validate names the stale compiled block (0 ops for the nodes); after the editor's own save: the compiled block holds ops for the nodes and the stale finding is gone",
      kill_criterion: `the blocks unchanged after the save: P-W4-12 KILLED (procanim edit and create refuse unless the owner recompiles in the editor, OD-11 names it the remainder); no hand answer: NOT-RUN; ${WINDOW_KILL}`,
      side_effects: [
        `${OFF_PAP} saved by the ProcAnim Editor (a hand action, inside _throwaway/W4/)`,
      ],
      rollback: "`w4.live.ts rollback` removes the copy",
      probes: ["P-W4-12"],
      dependsOn: ["P-W4-01", "P-W4-08", "P-W4-28"],
      writes: [OFF_PAP],
      expectsWindows: WORKBENCH_WINDOWS,
      hand: true,
      plan: () => openEditorPlan("ProcAnimEditor", OFF_PAP),
      offlineCalls: () => [
        oc("procanim", "validate", { path: OFF_PAP }),
        oc("procanim", "inspect", { path: OFF_PAP }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        if (!onDisk(ctx, OFF_PAP))
          return {
            status: "NOT-RUN",
            detail: `${OFF_PAP} is not on disk (w4-53 did not run)`,
            evidence: {},
          };
        const v0 = await ctx.offline("procanim", { action: "validate", path: OFF_PAP });
        const i0 = await ctx.offline("procanim", { action: "inspect", path: OFF_PAP });
        const b0 = bytesOf(ctx, OFF_PAP);
        const o = await openInEditor(ctx, "ProcAnimEditor", OFF_PAP);
        const evidence: Raw = {
          validateBefore: brief(v0),
          compiledBefore: rb(i0).compiled ?? null,
          open: o.evidence,
        };
        if (!o.set || !o.set.ok)
          return {
            status: "FAIL",
            detail: `the ProcAnim Editor did not open ${OFF_PAP}: ${o.set ? why(o.set) : S(o.evidence.refused)}`,
            evidence,
          };
        const a = await awaitHand(
          ctx,
          "w4-90-pap-save",
          `The ProcAnim Editor has ${OFF_PAP} open (the battery opened it). In that editor press Save ONCE (File > Save). Change nothing else. If any dialog appears, do not answer it: write {"saved": false, "dialog": "<its title and text>"}. Otherwise write {"saved": true}`,
        );
        evidence.hand = a;
        if (!a) return { status: "NOT-RUN", detail: "no hand answer within the wait", evidence };
        if (a.saved !== true && a.dialog)
          throw new StopBattery(
            "handoff",
            `a dialog after the hand's Save: "${S(a.dialog)}"`,
            evidence,
          );
        if (a.saved !== true)
          return { status: "NOT-RUN", detail: `the hand did not save: ${S(a.why)}`, evidence };
        const v1 = await ctx.offline("procanim", { action: "validate", path: OFF_PAP });
        const i1 = await ctx.offline("procanim", { action: "inspect", path: OFF_PAP });
        const b1 = bytesOf(ctx, OFF_PAP);
        Object.assign(evidence, {
          validateAfter: brief(v1),
          compiledAfter: rb(i1).compiled ?? null,
          changed: !same(b0, b1),
        });
        const staleAfter = JSON.stringify(rb(v1)).includes("compiled-stale");
        const ops = Number(field(rb(i1).compiled, "ops") ?? 0);
        const obs = {
          before: rb(i0).compiled ?? null,
          after: rb(i1).compiled ?? null,
          fileChanged: !same(b0, b1),
          staleAfter,
        };
        const p = same(b0, b1)
          ? killed("P-W4-12", obs, "the editor's save left the file unchanged")
          : !staleAfter && ops > 0
            ? settled(
                "P-W4-12",
                obs,
                `the editor's save regenerates the compiled blocks (${ops} op(s))`,
              )
            : killed("P-W4-12", obs, "the file changed but the compiled blocks are still stale");
        return { ...verdictOf([], [p], "editor save observed"), evidence, probes: [p] };
      },
    },

    // ── W4.9 net-zero and close-out ──
    {
      id: "w4-95-netzero",
      block: "W4.9",
      title: "net-zero: the sandbox outside _throwaway/W4/ hashed against the battery's snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "no file outside _throwaway/W4/ changed (resourceDatabase.rdb recorded, not failed)",
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
            bad.length ? [`changed outside ${W4_ROOT}/: ${bad.join(", ")}`] : [],
            [],
            `net-zero outside ${W4_ROOT}/${tolerated.length ? ` (${tolerated.join(", ")} recorded)` : ""}${nz.takenBy === "run start" ? `; the snapshot was taken at the start of a resumed run (${nz.takenAt})` : ""}`,
          ),
          evidence,
        };
      },
    },
    closableStep(),
  ];
}

const EDITORS = ["AnimEditor", "BehaviorEditor", "ProcAnimEditor"] as const;

function extOfRel(rel: string): string {
  return rel.slice(rel.lastIndexOf("."));
}

/** w4-50's animation_graph calls in order (nodes, setup and author write nothing outside created/). */
export const GRAPH_CALLS: ReadonlyArray<[string, Raw]> = [
  ["nodes", { action: "nodes", query: "Sleep", limit: 5, format: "json" }],
  ["setup", { action: "setup", setupSubAction: "guide", agrPath: OFF_AGR, agfPath: OFF_AGF }],
  ["inspect", { action: "inspect", path: OFF_AGF, format: "json" }],
  ["validate", { action: "validate", path: OFF_AGR, format: "json" }],
  [
    "editDry",
    {
      action: "edit",
      path: OFF_AGR,
      op: "addVariable",
      name: NEEDLES.agrVar,
      varType: "Float",
      min: 0,
      max: 1,
      defaultValue: 0.25,
    },
  ],
  [
    "addVariable",
    {
      action: "edit",
      path: OFF_AGR,
      op: "addVariable",
      name: NEEDLES.agrVar,
      varType: "Float",
      min: 0,
      max: 1,
      defaultValue: 0.25,
      confirm: true,
    },
  ],
  [
    "setProp",
    {
      action: "edit",
      path: OFF_AGF,
      op: "setProp",
      sheet: "Master",
      node: "aim_sleep_out",
      prop: "AwakeExpr",
      value: NEEDLES.agfExpr,
      quoted: true,
      confirm: true,
    },
  ],
  [
    "author",
    {
      action: "author",
      vehicleName: "W4_author",
      vehicleType: "wheeled",
      wheelCount: 4,
      outputPath: CREATED_DIR,
    },
  ],
];

/** w4-51's .ast calls (create, the three adds, read, validate). */
export const SET_AST_CALLS: ReadonlyArray<[string, Raw]> = [
  ["create ast", { action: "create", path: OFF_AST, confirm: true }],
  [
    "addGroup",
    {
      action: "addGroup",
      path: OFF_AST,
      group: NEEDLES.astGroup,
      columns: ["Default"],
      animations: ["Idle"],
      confirm: true,
    },
  ],
  [
    "addColumn",
    {
      action: "addColumn",
      path: OFF_AST,
      group: NEEDLES.astGroup,
      column: NEEDLES.astColumn,
      confirm: true,
    },
  ],
  [
    "addAnimation",
    {
      action: "addAnimation",
      path: OFF_AST,
      group: NEEDLES.astGroup,
      animation: NEEDLES.astAnimation,
      confirm: true,
    },
  ],
  ["read ast", { action: "read", path: OFF_AST }],
  ["validate ast", { action: "validate", path: OFF_AST }],
];

/** w4-51's .asi calls on the registered .ast (unmap runs after the engine read). */
export function setAsiCalls(template: string): Array<[string, Raw]> {
  return [
    ["create asi", { action: "create", path: OFF_ASI, template, confirm: true }],
    [
      "map",
      {
        action: "map",
        path: OFF_ASI,
        slot: `${NEEDLES.astGroup}.Default.Idle`,
        resource: VANILLA_ANM,
        confirm: true,
      },
    ],
    ["read asi", { action: "read", path: OFF_ASI }],
    ["validate asi", { action: "validate", path: OFF_ASI }],
    [
      "unmap",
      { action: "unmap", path: OFF_ASI, slot: `${NEEDLES.astGroup}.Default.Idle`, confirm: true },
    ],
  ];
}

/** w4-52's behavior_tree calls (create writes unless dry_run; edit writes unless dry_run). */
export const BT_CALLS: ReadonlyArray<[string, Raw]> = [
  ["nodes", { action: "nodes", query: "AITaskIdle" }],
  ["createDry", { action: "create", spec: OFF_BT_SPEC, dry_run: true }],
  ["create", { action: "create", spec: OFF_BT_SPEC }],
  [
    "edit",
    {
      action: "edit",
      path: OFF_BT,
      ops: [
        { op: "rename_node", node: "Hold", name: NEEDLES.btNode },
        { op: "set_property", node: NEEDLES.btNode, key: "Period", value: 3 },
      ],
    },
  ],
  ["inspect", { action: "inspect", path: OFF_BT }],
  ["validate", { action: "validate", path: OFF_BT }],
  ["diff", { action: "diff", path: OFF_BT, other: VANILLA_BT }],
];

/** w4-53's procanim calls (create a vanilla copy, edit the RotationSet node's canvas position). */
export const PAP_CALLS: ReadonlyArray<[string, Raw]> = [
  ["nodes", { action: "nodes", query: "Rotation", limit: 5 }],
  ["create", { action: "create", path: OFF_PAP, source: VANILLA_PAP, confirm: true }],
  ["inspect", { action: "inspect", path: OFF_PAP }],
  [
    "edit",
    {
      action: "edit",
      path: OFF_PAP,
      ops: [{ op: "set_property", node: "3078", key: "tl", value: NEEDLES.papTl }],
      confirm: true,
    },
  ],
  ["validate", { action: "validate", path: OFF_PAP }],
];

/**
 * The last step, also run after a stop: leave Workbench closable by WM_CLOSE. The three editors hold
 * unedited documents (the one hand Save in w4-90 leaves its document saved); the World Editor world
 * (if any) is replaced by a fresh load of a world that is not open now, so no in-memory edit
 * remains. Nothing is saved.
 */
export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W4.9",
    title:
      "leave Workbench closable: the open world replaced by a fresh load (the W4 world, else vanilla EmptyArland); the editors hold unedited documents; never save",
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
    plan: () => [
      tc("wb_world", "state"),
      tc(
        "wb_world",
        "stop",
        {},
        { note: "only when the mode reads play; state then polled until edit" },
      ),
      ...openPlan(VANILLA_WORLD),
    ],
    run: async (ctx) => leaveClosable(ctx),
  };
}

/** The most wb_world state polls a wait for a mode sends: TIMEOUTS.open at TIMEOUTS.poll apart. */
export const MODE_POLLS = Math.ceil(TIMEOUTS.open / TIMEOUTS.poll);

/** Polls wb_world state until the mode is `mode` (W8's waitMode), at most MODE_POLLS times. */
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
async function settleEdit(deps: W4Deps): Promise<void> {
  for (let polls = 1; ; polls++) {
    const st = await deps.tool("wb_world", { action: "state" });
    if (!st.ok || S(rb(st).mode) !== "play" || polls >= MODE_POLLS) return;
    await deps.sleep(TIMEOUTS.poll);
  }
}

export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateBefore = brief(st0);
  if (S(rb(st0).mode) === "play") {
    const stop = await ctx.tool("wb_world", { action: "stop" }, { restore: true });
    evidence.stop = brief(stop);
    if (!stop.ok) fails.push(`stop: ${why(stop)}`);
    const w = await waitMode(ctx, "edit");
    evidence.editPolls = w.polls;
    if (!w.ok) fails.push(`play was not left: no edit mode after ${w.polls} poll(s)`);
  }
  const open = S(rb(st0).worldPath).toLowerCase();
  if (!st0.ok || open === "") {
    return {
      ...verdictOf(fails, [], "no world is open: nothing in the World Editor to leave"),
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

/** The W4 world on disk and registered (`wb_world new` when absent), then open. */
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
  if (!o.ok) fails.push(`the W4 world did not open ('${o.worldPath}')`);
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

// ── Net-zero (W1's snapshot, rooted at _throwaway/W4/) ───────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  root: string;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W4/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W4Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W4_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

/**
 * Writes the battery's before-snapshot into the sitting folder when none is there, and answers
 * whether it did. runBattery calls it before the first step of every run that does not begin at
 * the gate (--from, --only), so w4-95 always has a baseline (W1 run 7).
 */
export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W4Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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

/** w4-95's comparison: the battery's snapshot against the sandbox now, outside _throwaway/W4/. */
export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W4Deps, "exists" | "readBytes" | "listTree">,
): { takenBy: string; takenAt: string; changed: string[] } | null {
  const snap = readJson<BatterySnapshot>(join(sittingDir, BATTERY_SNAPSHOT_FILE), deps);
  if (!snap || snap.kind !== BATTERY_SNAPSHOT_KIND || typeof snap.files !== "object") return null;
  const before = Object.fromEntries(
    Object.entries(snap.files).filter(([f]) => !f.startsWith(`${W4_ROOT}/`)),
  );
  return {
    takenBy: S(snap.taken_by),
    takenAt: S(snap.taken_at),
    changed: changedFiles(before, sandboxHashes(sandboxDir, deps)),
  };
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
    `${SESSION}: Animation, Procedural Animation and Behavior battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
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
      "Generated by `tests/live/w4.live.ts --emit-queue` from its step table; tests/live-harness/w4-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W4 is not in PROBE_MUT_SESSIONS and sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w4-spec.md 2, 3, 6",
      "DEC-053",
      "DEC-058",
      "DEC-067",
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
  deps: Pick<W4Deps, "exists" | "readBytes">,
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
async function cleanupAfterStop(ctx: StepContext, deps: W4Deps): Promise<Raw> {
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
  deps: W4Deps,
  opts: W4Options,
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
  deps: W4Deps,
  opts: W4Options,
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
  deps: W4Deps,
  opts: W4Options,
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
  // sitting has none, so w4-95 always has a baseline (W1 run 7).
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
    if (opts.skipHand && s.hand) {
      write({
        ...base,
        status: "HELD",
        detail:
          "--skip-hand: the hand step is held (not run, not failed); run it later with --only in a new run folder, without --skip-hand",
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

/** `<sitting>/w4-result.json`: every step's latest record across the sitting's run folders, and each probe's result. */
export function writeResult(
  opts: W4Options,
  deps: Pick<W4Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
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

/** What `plant` writes: project-relative path to its source. */
export function plantSources(): Array<{ rel: string; from: string }> {
  return [
    { rel: OFF_AGR, from: `paks:${VANILLA_AGR}` },
    { rel: OFF_AGF, from: `paks:${VANILLA_AGF}` },
    { rel: AE, from: `paks:${VANILLA_AE}` },
    { rel: AEX, from: `paks:${VANILLA_AEX}` },
    { rel: ASY, from: `paks:${VANILLA_ASY}` },
  ];
}

/** `plant`: the five copies and the folders under _throwaway/W4/ (no Workbench running). */
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
  if (io.exists(abs(sandboxDir, W4_ROOT))) {
    io.log(`refused: <sandbox>/${W4_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const throwawayExistedBefore = io.exists(abs(sandboxDir, THROWAWAY));
  const bytes: Record<string, Buffer> = {};
  for (const s of plantSources()) bytes[s.rel] = await io.readVanilla(s.from.slice("paks:".length));
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

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W4/; `_throwaway/` only when empty and absent before. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W4_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W4_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W4_ROOT}/ (${files.length} files)`);
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
    join(sittingDir, "throwaway-w4-listing.json"),
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
  io.log(`removed <sandbox>/${W4_ROOT}/ (listing in throwaway-w4-listing.json)`);
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

type McpHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;

/** The handler a register function gives its server (behavior_tree and the two lint tools have no run function). */
function captureHandler(register: (server: never) => void): McpHandler {
  let fn: McpHandler | null = null;
  register({
    registerTool: (_n: string, _d: unknown, h: McpHandler) => {
      fn = h;
    },
  } as never);
  if (!fn) throw new Error("the tool did not register a handler");
  return fn;
}

/**
 * An offline tool's text as a ToolResponse: the JSON envelope when the text is one (`ok` boolean),
 * else `{ok: !isError, readback: {text}}`.
 */
export function textResponse(
  text: string,
  isError: boolean | undefined,
  action: string,
): ToolResponse {
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && typeof (v as Raw).ok === "boolean") return v as ToolResponse;
    if (v && typeof v === "object")
      return { ok: !isError, action, readback: { ...(v as Raw), text } };
  } catch {
    // not JSON: the text itself is the answer
  }
  return isError
    ? { ok: false, action, code: "TOOL_ERROR", message: text.slice(0, 600), readback: { text } }
    : { ok: true, action, readback: { text } };
}

export function realDeps(input: {
  port: number;
  lane: Lane;
  sandboxDir: string;
  vfs: VanillaFs | null;
}): W4Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const worldDeps = { projectRoot: input.sandboxDir, artifactsRoot: artifactsDir() };
  const config: Config = { ...loadConfig(), projectPath: input.sandboxDir };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  let bt: McpHandler | null = null;
  let unused: McpHandler | null = null;
  let poseLint: McpHandler | null = null;
  const viaHandler = async (h: McpHandler, a: Raw, action: string): Promise<ToolResponse> => {
    const r = await h(a);
    return textResponse(r.content.map((c) => S(c.text)).join("\n"), r.isError, action);
  };
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_anim":
          return asResp(await runAnim(client, args));
        case "wb_anim_debug":
          return asResp(await runAnimDebug(client, args));
        case "wb_resources":
          return asResp(await runResources(client, args));
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
      const a: Raw = { ...args, projectPath: input.sandboxDir };
      const action = S(args.action);
      switch (name) {
        case "animation_workspace":
          // The copies it writes are registered through the live client (registerProjectFile).
          return asResp(
            await runAnimationWorkspace(a as unknown as WorkspaceRequest, config, {
              client,
            } as never),
          );
        case "animation_set":
          return asResp(runAnimationSet(a as unknown as AnimationSetRequest, config));
        case "animation_graph": {
          const t = runAnimationGraph(a as unknown as AnimationGraphArgs, config) as unknown as {
            text: string;
            isError?: boolean;
          };
          return textResponse(t.text, t.isError, action);
        }
        case "procanim":
          return asResp(runProcAnim(a as unknown as ProcAnimRequest, config));
        case "behavior_tree":
          bt ??= captureHandler((s) => registerBehaviorTree(s, config));
          return viaHandler(bt, a, action);
        case "animation_find_unused_clips": {
          unused ??= captureHandler((s) => registerAnimationFindUnusedClips(s, config));
          const { action: _a, projectPath: _p, ...rest } = a;
          return viaHandler(unused, { ...rest, project_path: input.sandboxDir }, action);
        }
        case "weapon_pose_lint": {
          poseLint ??= captureHandler((s) => registerWeaponPoseLint(s));
          const { action: _a, projectPath: _p, ...rest } = a;
          return viaHandler(
            poseLint,
            { ...rest, agr_path: abs(input.sandboxDir, S(args.agr_path)) },
            action,
          );
        }
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
const FLAGS = ["really", "skip-hand", "update-baseline"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: W4Deps;
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
        `refused: ${sittingDir} holds no ${PLANT_FILE}: run \`w4.live.ts plant\` first`,
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
      skipHand: args.flags.has("skip-hand"),
    });
    for (const l of resultTable(r.records)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w4",
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

// Census rows this file tests (W4 close-out, EV-W4-053).
// census:mcp:action/animation_graph.nodes
// census:mcp:action/animation_graph.validate
// census:mcp:action/animation_set.create
// census:mcp:action/animation_set.map
// census:mcp:action/animation_set.read
// census:mcp:action/animation_set.validate
// census:mcp:action/animation_workspace.create
// census:mcp:action/animation_workspace.files
// census:mcp:action/animation_workspace.read
// census:mcp:action/animation_workspace.set
// census:mcp:action/animation_workspace.validate
// census:mcp:action/procanim.create
// census:mcp:action/procanim.inspect
// census:mcp:action/procanim.nodes
// census:mcp:action/procanim.validate
