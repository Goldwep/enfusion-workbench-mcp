/**
 * Session S-D (plan 8 Phase 2 table), train #1: a GUI Workbench on the 2.0 sandbox with the
 * shipped handler set AND the read-only probe pack (`mod-dev/probe`, one NET function
 * `ECEN_Probe` dispatching on `action`) installed. It carries the 48 entries of
 * `data/census/probes.jsonl` whose `scheduled_session` names S-D (10 register unknowns, 35 recon
 * probes, the two S-C probes, and P-U30: the U30 re-run DEC-040 asked for, scheduled to S-D by
 * seq 600, behind `--u30-rerun`).
 *
 * DRY RUN BY DEFAULT. Without --really the script touches nothing: it prints the session
 * outline and the ACTION PLAN (the JSON array `scripts/live/dry-run.ts` checks), checks the plan
 * against the policy, and writes the plan to --out. A real run needs --really, a win32 host and
 * the lease already held by the lane given with --id (the one gate of `cli.ts`). It is run only by
 * the main session, with the owner present for the whole sitting, after the owner's go for S-D,
 * AFTER `launch.ts --install-handlers <sandbox> --probe-pack mod-dev/probe` and `preflight.ts`
 * (default variant, scratch profile) have launched the sandbox. The runbook is
 * docs/v2/sessions/queues/S-D.md; the queue is docs/v2/sessions/queues/S-D-queue.json
 * (`--emit-queue` rewrites it from the step table below, and a test keeps the two equal).
 *
 * The model is scripts/live/s-c-natives.ts (S-C): the same gate, one declared block or one step
 * per invocation, started markers, no retry after a timeout, the modal check after every call
 * that can open a window, `recover` and `acknowledge` from session-common.ts, `rollback` for the
 * one file this sitting writes, evidence records through evidence.ts. What S-D adds (the
 * main-session rulings of 2026-10-06, after DEC-040):
 *
 * 1. THE AUTHORIZATION PROMPT, STOP MODEL. Every step whose call can raise "Script Authorization
 *    Required" (sd-01 the deliberate Bohemia trigger, sd-02, the eval steps sd-07 to sd-09, the
 *    loadContainer steps sd-10a and sd-10b, the screenshot steps sd-20a and sd-20b) is its own
 *    block. Its calls run in a detached child of this script (the call can hold the socket until
 *    a human answers) while the parent polls the window list. The modal check recognises the
 *    window titled exactly "Script Authorization Required", whatever its owner field (S-C saw it
 *    unowned, class Qt683QWindowIcon, the main window disabled) and stops with a HANDOFF (exit 5):
 *    it writes `auth-<step>.json`, tells the main session to read the dialog with the passive walker and the
 *    owner to click it by hand. The harness never clicks, never posts a key or a message to it;
 *    the child is left running so the answer the owner unblocks lands in the run folder. The
 *    sitting resumes with `--only <next step>` and `--owner-clicked Yes|YesToAll|No|NoToAll`, which
 *    writes the owner's button (and the child's late answer) into `authorization-log.jsonl`; a
 *    real run refuses while an authorization handoff has no such entry. A second prompt the same
 *    call raises after the owner's click is found by the next invocation's pre-check while the
 *    child still waits: it writes `auth-<step>-<n>.json` (n = 2, 3, ...) and hands off again; the
 *    owner then reports every button in order, `--owner-clicked Yes,No` (`buttons[]` in the log).
 *    No -scriptAuthorizeAll.
 * 2. U6 WITHOUT INPUT. sd-21 sends `modalTest` from a detached child, waits for the dialog, then
 *    measures the queue with ONE EMCP_WB_Ping on a second socket (a second detached child: the
 *    second planned exception to one call at a time, after U30), lists windows (class, title,
 *    owner, enabled), IsHungAppWindow and WM_NULL, writes `u6-waiting.json` and hands off: the
 *    owner closes the dialog with its own button on the main session's word. Nothing is sent to
 *    the dialog; its "dismissed from outside" half is not tried. sd-22 reads both children's
 *    answers afterwards.
 * 3. The packed vanilla world `worlds/MainMenuWorld/MainMenuWorld.ent` is opened read-only with
 *    the native OpenResource (sd-15) for the world steps; never saved. A save prompt at the
 *    post-flight close is a hazard, never answered.
 * 4. U28: the target is `<label>-<nonce>.bmp` under `<sandbox>/_throwaway/`; the step records the
 *    plant first, copies the BMP into the run folder, deletes that one file by its hash and the
 *    folder if the step created it, and writes the rollback record (S-C sc-15's pattern). After a
 *    handoff the BMP can land after the owner's click: the next screenshot step, sd-21, and the
 *    `rollback` subcommand settle it.
 * 5. Post-flight removes the whole probe pack: `postflight.ts --remove-probe`.
 * 6. U30 re-run (sd-11, only with `--u30-rerun`): all seven sockets opened and written within the
 *    same tick, no stagger. The draft names no slower heavy call, so the heavy call stays
 *    GetGameMaterials (DEC-040: 27 and 16 ms warm).
 * 7. Edit > Undo is never called in S-D, though it is on the allow-list (DEC-029 scoped it to S-C).
 * 8. One declared block or one step per invocation; every block under the 2-hour background cap
 *    with margin; the gate on every invocation; `--force-settings` and `--registry-export` on a
 *    real run; `--run-dir` on every block after the first.
 *
 * Every operation that touches a process, a socket, the desktop or the file system outside the
 * artifacts folder goes through `SdDeps`, so the whole control flow runs against mocks in
 * tests/live-harness/s-d-train1.test.ts. The only sandbox writes are under `<sandbox>/_throwaway/`.
 *
 * Usage:
 *   npx --no tsx scripts/live/s-d-train1.ts [--out <plan.json>] [--outline <file>]
 *       [--sandbox <dir>] [--u30-rerun] [--walker-cmd '<json argv>'] [--emit-queue <file>]
 *   npx --no tsx scripts/live/s-d-train1.ts --really --id <lane id>
 *       --registry-export <pre-flight .reg> --force-settings <scratch.ini under the artifacts folder>
 *       (--from <step id> --until <step id> | --only <step id>)   one declared block or step
 *       [--run-dir <dir>] [--owner-clicked <button>[,<button>...]] [--u30-rerun]
 *       [--debug-mode-unset-ok] [--sandbox <dir>] [--walker-cmd '<json argv>']
 *       [--opened-project-pattern <regex>] [--allowed-addons a,b] [--owned-module-classes a,b]
 *       [--build <tag>] [--port 5775] [--lease-path p] [--marker-path p] [--nonce <hex>]
 *   npx --no tsx scripts/live/s-d-train1.ts recover --run-dir <dir> --id <lane id> [--owner-go <pid>] [--really]
 *   npx --no tsx scripts/live/s-d-train1.ts rollback --run-dir <dir> --id <lane id> [--sandbox <dir>] [--really]
 *   npx --no tsx scripts/live/s-d-train1.ts acknowledge --run-dir <dir> --id <lane id> --step <id> [--owner-ack] [--really]
 *
 * Exit: 0 done (or dry run passed), 1 refused or plan check failed, 2 usage, 3 stopped for the
 *       main session, 4 aborted (not the sandbox), 5 handoff (an authorization prompt or the U6
 *       dialog is up for the owner, or a walk to run by hand; resume with --only the next step).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config.js";
import { OPENED_PROJECT_PATTERN } from "../census/enumerators/e13-launch-logs.js";
import { DEFAULT_BOUNDS as WALK_DEFAULT_BOUNDS } from "../../tools/uia/walk.js";
import { captureDesktop } from "./capture.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { LANE_RECORDED_PID, checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import { rewriteStrings, writeEvidence } from "./evidence.js";
import { Lane } from "./lane.js";
import { WORKBENCH_EXE, isProbePackFile, probePackTarget } from "./launch.js";
import { DEFAULT_PORT } from "./netcall.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { deniedApi, deniedApiNames, loadPolicy, type CensusPolicy } from "./policy.js";
import { CLOSE_SCRIPT, readRegFile } from "./postflight.js";
import { newestSessionLog, openedProjectFromLog, recordedBuild } from "./preflight.js";
import { lastLine, runPowerShell } from "./powershell.js";
import {
  HELPER,
  INVOCATION_MARGIN_MS,
  STALL_SCRIPT,
  StopSession,
  TIMEOUTS as SC_TIMEOUTS,
  WINDOWS_SCRIPT,
  acceptedWindow,
  allowListed,
  baselineProblem,
  blockArgs,
  childRequest,
  detachedBudgetMs,
  forceSettingsRefusal,
  iniScriptDebugMode,
  insideDir,
  isDialogLike,
  latencyStats,
  loadedProjectsOf,
  loadedProjectsProblem,
  namesSandbox,
  parseWindows,
  rawNetCall,
  runChildCall,
  scriptDebugMode,
  sha256Hex,
  stallMs,
  titleNames,
  walkerArgv,
  walkerCmdRefusal,
  windowChanges,
  windowsForEvidence,
  worldEditorWindow,
  type CallRecord,
  type CallSpec,
  type DetachedSpec,
  type RawCallResult,
  type RiskClass,
  type StepOutcome,
  type StepStatus,
  type StopKind,
  type WalkerResult,
  type WindowInfo,
} from "./s-c-natives.js";
import {
  BACKGROUND_CAP_MS,
  acknowledgeMarker,
  creationTimeOf,
  defaultRecoverDeps,
  outsideArtifacts,
  readProcessTable,
  runRecover,
  type RecoverDeps,
  type StartedMarker,
} from "./session-common.js";
import {
  CRASH_REPORTER_IMAGE,
  defaultExec,
  portListeners,
  processByPid,
  processesByImage,
} from "./win.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "S-D";

/** Repo-relative id of this script, as dry-run exceptions name scripts. */
export const SCRIPT_PATH = "scripts/live/s-d-train1.ts";

const SCRIPT_ABS = fileURLToPath(import.meta.url);

/** `node --import <this>` runs a .ts file (node_modules/.bin/tsx cannot be spawned without a shell on Windows). */
const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/** The queue file this script's step table produces (`--emit-queue`). */
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-D-queue.json");

export const EXIT = {
  done: 0,
  refused: 1,
  usage: 2,
  stopped: 3,
  aborted: 4,
  handoff: 5,
} as const;

/** The NET function of the read-only probe pack (mod-dev/probe/ECEN_Probe.c). */
export const PROBE_API = "ECEN_Probe";

/** The exact title of Workbench's script-authorization dialog (DEC-040, S-C sc-02). */
export const AUTH_TITLE = "Script Authorization Required";
/** The Win32 class S-C recorded for it (u27-auth-dialog.json); recorded, not required. */
export const AUTH_CLASS = "Qt683QWindowIcon";
/** The buttons it offers (DEC-040); the owner reports one with --owner-clicked. */
export const AUTH_BUTTONS = ["Yes", "YesToAll", "No", "NoToAll"] as const;
export type AuthButton = (typeof AUTH_BUTTONS)[number];
/** The run-folder file the owner's buttons are written to, one JSON line per prompt. */
export const AUTH_LOG = "authorization-log.jsonl";

/** The caption of the one dialog the probe pack opens (ECEN_ProbeSystem.ModalTest). */
export const MODAL_CAPTION = "ECEN probe modal";

/** The sandbox folder the probe pack's screenshot action writes into (ECEN_ProbeUtil.THROWAWAY). */
export const THROWAWAY = "_throwaway";

/**
 * Vanilla resources the steps open or load, read from the game paks of build 1.8.0.13 while this
 * file was written (read-only, src/pak/vfs.ts; the byte size is the pak entry's). None is saved.
 */
export const VANILLA = {
  /** 8,353 bytes; S-C's VANILLA.packedWorld (never opened there). */
  world: "worlds/MainMenuWorld/MainMenuWorld.ent",
  /** 15,099 bytes; S-C opened it (sc-08). */
  conf: "configs/inputCommon.conf",
  /** 8,289 bytes; S-C opened it (sc-08). */
  script: "scripts/WorkbenchGameCommon/NetApiDocs.c",
  emat: "system/materials/lightSourceDefault.emat",
  layout: "UI/layouts/Camera/ManualCameraCrosshair.layout",
  /** 306 bytes, the smallest .agr in the paks. */
  agr: "Assets/Props/Fabric/Workspace/flag.agr",
  /** 2,661 bytes. */
  acp: "Sounds/UI/UI_Respawn.acp",
  /** 261 bytes. */
  bt: "AI/BehaviorTrees/Waypoints/WP_Blank.bt",
  /** 470 bytes. */
  ptc: "Particles/Enviroment/Flies.ptc",
  /** 1,555 bytes, the smallest .pap in the paks. */
  pap: "anims/proc/clock_pendulum.pap",
} as const;

/**
 * The eleven modules of the probe pack (ECEN_ProbeUtil.ModuleType), in step order, each with
 * the vanilla document sd-12 opens in it with the native OpenResource (null: none in scope).
 */
export const MODULES: ReadonlyArray<{ name: string; doc: string | null }> = [
  { name: "AnimEditor", doc: VANILLA.agr },
  { name: "AudioEditor", doc: VANILLA.acp },
  { name: "BehaviorEditor", doc: VANILLA.bt },
  { name: "DialogueEditor", doc: null },
  { name: "LocalizationEditor", doc: null },
  { name: "NavmeshGeneratorMain", doc: null },
  { name: "ParticleEditor", doc: VANILLA.ptc },
  { name: "ProcAnimEditor", doc: VANILLA.pap },
  { name: "ResourceManager", doc: VANILLA.conf },
  { name: "ScriptEditor", doc: VANILLA.script },
  { name: "WorldEditor", doc: null },
];

/**
 * The plugins sd-14 reads (U10), each in the module E06 and E01 record for it at 1.8.0.13
 * (the draft had SCR_DebugLinePlugin in the World Editor; E06 says ScriptEditor).
 */
export const PLUGINS: ReadonlyArray<{ className: string; module: string }> = [
  { className: "SCR_SnapAndOrientToTerrainPlugin", module: "WorldEditor" },
  { className: "SCR_CopyClassAndMethodPlugin", module: "ScriptEditor" },
  { className: "SCR_DebugLinePlugin", module: "ScriptEditor" },
];

/** The World Editor tool sd-17 asks GetPlugin for (E06: module WorldEditor). */
export const TOOL_CLASS = "SCR_CoordsTool";

/**
 * Script diag options sd-05, sd-13 and sd-18 read, by SCR_DebugMenuID name (E14 rows; registered
 * in SCR_AIWorld.c, [unverified] that they are registered in edit mode).
 */
export const DIAG_ENUMS = [
  "DEBUGUI_AI_PRINT_DEBUG",
  "DEBUGUI_AI_PRINT_GROUP_INFO",
  "DEBUGUI_AI_DEBUG_COVERS",
] as const;
/** The menu sd-13 selects with SelectMenuByName: E14's top-level "AI" menu [unverified as a name it takes]. */
export const DIAG_MENU = "AI";

/**
 * World Editor dock paths sd-19a tries, in order, each only when it is on
 * `execute_action.allow_list` (a path not listed is skipped, never sent). The first two are the
 * entries the main session adds for S-D; the mnemonic and case variants answer L674 only if the
 * main session lists them too. Labels [unverified].
 */
export const WINDOW_PATHS: ReadonlyArray<readonly string[]> = [
  ["Window", "Hierarchy"],
  ["Window", "Log Console"],
  ["&Window", "Hierarchy"],
  ["&Window", "Log Console"],
  ["window", "hierarchy"],
  ["window", "log console"],
];
/** The path sd-19b runs on the Resource Manager module (open versus focused, L676) [unverified there]. */
export const RM_DOCK_PATH = ["Window", "Log Console"] as const;
/** Never called in S-D (ruling 7), though DEC-029 put it on the allow-list for S-C. */
export const NEVER_PATH = ["Edit", "Undo"] as const;

/** U5 texts. Every one is a text of the screen model's tests in probe-pack.test.ts. */
export const EVAL_OK = 'string ECEN_Eval() { return "ok"; }';
/**
 * sd-08: texts the allow screen must refuse WITHOUT compiling. Unlike the draft (a Workbench.Exit
 * call, a loop), each is harmless if the screen were to pass it: a loop that never runs, a second
 * function, an allocator of a class that does not exist.
 */
export const EVAL_REFUSED: readonly string[] = [
  'string ECEN_Eval() { while (false) {} return ""; }',
  'string ECEN_Eval() { return helper(); } string helper() { return ""; }',
  'string ECEN_Eval() { Foo f = new Foo(); return ""; }',
];
/** sd-09: reach through the screen, then one deliberate syntax error (a missing semicolon). */
export const EVAL_REACH: readonly string[] = [
  "string ECEN_Eval() { return Workbench.GetCurrentGameProjectFile(); }",
  "string ECEN_Eval() { array<string> addons = {}; GameProject.GetLoadedAddons(addons); int c = addons.Count(); return c.ToString(); }",
  'string ECEN_Eval() { WorldEditor we = Workbench.GetModule(WorldEditor); if (!we) return "none"; WorldEditorAPI api = we.GetApi(); int n = api.GetNumSubScenes(); return n.ToString(); }',
  'string ECEN_Eval() { return "ok" }',
];

/** sd-10b: one vanilla resource per type for loadContainer (depth 2, page 0). */
export const LOAD_REST: readonly string[] = [
  VANILLA.emat,
  VANILLA.layout,
  VANILLA.agr,
  VANILLA.bt,
  VANILLA.ptc,
  VANILLA.acp,
];

export const TIMEOUTS = {
  cheap: 10_000,
  probe: 30_000,
  bohemia: 30_000,
  /** moduleMatrix with openModules (opens one module window). */
  moduleOpen: 120_000,
  /** containerDump, loadContainer. */
  container: 120_000,
  /** The native OpenResource on a document. */
  openDoc: 60_000,
  /** The native OpenResource on the packed world. */
  openWorld: 300_000,
  /** GetGameMaterials (U30's heavy call). */
  heavy: 300_000,
  burstFloor: 120_000,
  /**
   * How long a prompt-capable call's child keeps waiting beyond the call's own timeout, so the
   * answer the owner's click unblocks still lands in the run folder.
   */
  authClick: 900_000,
  /** The U6 children (modalTest and the second-socket Ping) wait this long. */
  modalChild: 1_500_000,
  /** How long sd-21 waits for the probe dialog to appear. */
  u6DialogWait: 60_000,
  /** How long sd-21 watches the second-socket Ping before the handoff. */
  u6PingWatch: 30_000,
  ready: SC_TIMEOUTS.ready,
  poll: SC_TIMEOUTS.poll,
  detachedGrace: SC_TIMEOUTS.detachedGrace,
  close: SC_TIMEOUTS.close,
  walker: SC_TIMEOUTS.walker,
  /**
   * sd-19's optional walk of the dock's window: the walker's default budget (60 s) plus its kill
   * grace (15 s) and the start; S-C's 114-node walk took 0.6 s (DEC-040).
   */
  dockWalk: 120_000,
} as const;

/** Pages of a paged probe table read at most (moduleMatrix, layerRead, pluginAttrs, info). */
export const MAX_PAGES = 3;

/** One helper run of IsHungAppWindow (the PowerShell runner's 30 s). */
export const HUNG_HELPER_MS = 30_000;

/**
 * The declared blocks, one per invocation (DEC-032). Every prompt-capable step is a block of its
 * own (ruling 1), so a stop on the prompt loses nothing but that step. Only the first block may
 * start a new run folder.
 */
export const BLOCKS: ReadonlyArray<{ from: string; until: string }> = [
  { from: "sd-01-auth-restart", until: "sd-01-auth-restart" },
  { from: "sd-02-auth-again", until: "sd-02-auth-again" },
  { from: "sd-03-crash-reporter", until: "sd-06-u17-layer-noworld" },
  { from: "sd-07-u5-eval-ok", until: "sd-07-u5-eval-ok" },
  { from: "sd-08-u5-screen", until: "sd-08-u5-screen" },
  { from: "sd-09-u5-reach", until: "sd-09-u5-reach" },
  { from: "sd-10a-u16-load-first", until: "sd-10a-u16-load-first" },
  { from: "sd-10b-u16-load-rest", until: "sd-10b-u16-load-rest" },
  { from: "sd-11-u30-rerun", until: "sd-11-u30-rerun" },
  { from: "sd-12-u8-AnimEditor", until: "sd-12-u8-DialogueEditor" },
  { from: "sd-12-u8-LocalizationEditor", until: "sd-12-u8-ProcAnimEditor" },
  { from: "sd-12-u8-ResourceManager", until: "sd-12-u8-WorldEditor" },
  { from: "sd-13-u34-diag-select", until: "sd-14-u10-SCR_DebugLinePlugin" },
  { from: "sd-15-world-open", until: "sd-15-world-open" },
  { from: "sd-16-u17-layer-world", until: "sd-18-u34-diag-viewport" },
  { from: "sd-19a-u9-worldeditor", until: "sd-19b-u9-resourcemanager" },
  { from: "sd-20a-u28-screenshot", until: "sd-20a-u28-screenshot" },
  { from: "sd-20b-u28-screenshot", until: "sd-20b-u28-screenshot" },
  { from: "sd-21-u6-modal", until: "sd-21-u6-modal" },
  { from: "sd-22-u6-after", until: "sd-22-u6-after" },
];

// ── Probe ids ────────────────────────────────────────────────────────────────

const E = (s: string): string => `P-E01-${s}`;

export const SD_PROBES = {
  authPersistence: "P-SC-script-authorization-persistence",
  crashReporter: "P-SC-crash-reporter-after-hang",
} as const;

/**
 * Probes answered beyond the ones probes.jsonl schedules to S-D: none since seq 600 scheduled
 * P-U30 (sd-11) to S-D.
 */
export const EXTRA_ANSWERED: readonly string[] = [];

export interface NotAnswered {
  id: string;
  part: "all" | "part";
  answered_by?: string[];
  missing: string;
  reason: string;
  carried_to: string;
  condition?: string;
}

/** Probes, or parts of probes, this sitting does not answer (also in the runbook). */
export const NOT_ANSWERED: readonly NotAnswered[] = [
  {
    id: E("plugins-netapi-cli-L469"),
    part: "all",
    missing: "scripted context menus (_WB_GetContextMenuItems / _WB_OnContextMenu)",
    reason: "an action outside Appendix A (DEC-029)",
    carried_to: "S-E after the second authoring pass",
  },
  {
    id: E("resource-manager-L663"),
    part: "all",
    missing: "the MetaFile schema of each resource class",
    reason: "an action outside Appendix A (DEC-029)",
    carried_to: "S-E after the second authoring pass, or the Phase 3.3 L08 battery",
  },
  {
    id: E("gui-census-feasibility-L675"),
    part: "all",
    missing:
      "the three-segment path Plugins > Settings > Reload WB Scripts; categories holding '/'",
    reason: "'reload' is a refused menu word (gen-probe-allowlist.ts MENU_DENY_WORDS)",
    carried_to: "the Phase 4 L09 battery with a ruled exception",
  },
  {
    id: E("script-string-dialogue-L406"),
    part: "all",
    missing: "Reload WB Scripts through ExecuteAction; which EMCP_WB_Reload path works",
    reason: "as L675: 'reload' is a refused menu word",
    carried_to: "the Phase 4 L09 battery",
  },
  {
    id: E("gui-census-feasibility-L677"),
    part: "all",
    missing: "toolbar-only and context-menu-only actions",
    reason: "no such path is allow-listed; the probe is P4-census as well",
    carried_to: "P4-census",
  },
  {
    id: E("world-editor-L490"),
    part: "all",
    missing: "enfusion:// registration; a link opened in a running Workbench",
    reason:
      "the forwarded U29 case is the owner's call (OA-13) and no registry query is ruled; S-D launches nothing",
    carried_to: "a later sitting, if the owner allows it",
  },
  {
    id: E("world-editor-L487"),
    part: "part",
    answered_by: ["sd-20a-u28-screenshot", "sd-20b-u28-screenshot"],
    missing: "SetCamera(pos, lookVec) from a handler",
    reason: "an action outside Appendix A (DEC-029)",
    carried_to: "S-E after the second authoring pass",
  },
  {
    id: E("gui-census-feasibility-L676"),
    part: "part",
    answered_by: ["sd-19b-u9-resourcemanager"],
    missing: "Build > Validate Scripts and Utilities > File System Dump",
    reason: "'build' is a refused menu word; File System Dump writes a dump [unverified]",
    carried_to: "the Phase 4 L09 battery",
  },
  {
    id: E("gui-census-feasibility-L678"),
    part: "part",
    answered_by: ["sd-19a-u9-worldeditor"],
    missing: "the return of a valid but disabled action",
    reason: "Edit > Undo, the only disabled-action sample, is never called in S-D (ruling 7)",
    carried_to: "the Phase 4 L09 battery",
  },
  {
    id: "P-U9",
    part: "part",
    answered_by: ["sd-19a-u9-worldeditor", "sd-19b-u9-resourcemanager"],
    missing:
      "three-segment paths, plugin entries, toolbar-only and context-only actions, disabled actions",
    reason: "only Window dock toggles are allow-listed; Edit > Undo is never called (ruling 7)",
    carried_to: "the Phase 4 L09 battery",
  },
  {
    id: E("resource-manager-L648"),
    part: "part",
    answered_by: ["sd-21-u6-modal", "sd-22-u6-after"],
    missing: "the plugin-menu-entry route to a modal",
    reason: "no plugin entry is allow-listed; sd-21 gives the general modal-versus-queue answer",
    carried_to: "Phase 4 (L04, L09) with the owner",
  },
  {
    id: E("audio-particle-navmesh-L516"),
    part: "part",
    answered_by: ["sd-21-u6-modal", "sd-22-u6-after"],
    missing: "the navmesh dialogs themselves (Recast params, Generator area)",
    reason: "no handler opens them here; sd-21 answers the general question with Workbench.Dialog",
    carried_to: "Phase 4 L04",
  },
  {
    id: E("script-string-dialogue-L414"),
    part: "part",
    answered_by: ["sd-21-u6-modal", "sd-22-u6-after"],
    missing: "the Workbench.ScriptDialog half",
    reason: "the pack opens Workbench.Dialog only; BakeInfo and EBTInfo stay excluded (DEC-029)",
    carried_to: "the Phase 3 plugin-runner battery",
  },
  {
    id: E("plugins-netapi-cli-L468"),
    part: "part",
    answered_by: ["sd-01-auth-restart", "sd-21-u6-modal"],
    missing: "the window classes and titles of ScriptDialog and WBProgressDialog",
    reason: "neither is opened in S-D; Dialog (sd-21) and the authorization prompt are",
    carried_to: "Phase 4 L16",
  },
  {
    id: E("plugins-netapi-cli-L464"),
    part: "part",
    answered_by: ["sd-01-auth-restart"],
    missing: "whether the MCP's own FileIO calls (EMCP_WB_Prefabs.c, EMCP_WB_Resources.c) prompt",
    reason:
      "both sit in write actions (createTemplate, rebuild), never called in a read-only sitting",
    carried_to: "S-E or the Phase 3 battery",
  },
  {
    id: E("plugins-netapi-cli-L462"),
    part: "part",
    answered_by: [
      "sd-14-u10-SCR_SnapAndOrientToTerrainPlugin",
      "sd-14-u10-SCR_CopyClassAndMethodPlugin",
      "sd-14-u10-SCR_DebugLinePlugin",
    ],
    missing: "Run(), attribute writes, dialog plugins",
    reason: "pluginRunDialogFree is in the mutating pack, its allow-list empty",
    carried_to: "S-E",
  },
  {
    id: E("world-editor-L482"),
    part: "part",
    answered_by: ["sd-14-u10-SCR_SnapAndOrientToTerrainPlugin"],
    missing: "GetPlugin(T).Run()",
    reason: "as L462",
    carried_to: "S-E",
  },
  {
    id: E("resource-manager-L682"),
    part: "part",
    answered_by: [
      "sd-14-u10-SCR_SnapAndOrientToTerrainPlugin",
      "sd-14-u10-SCR_CopyClassAndMethodPlugin",
      "sd-14-u10-SCR_DebugLinePlugin",
    ],
    missing: "attribute writes and public worker methods",
    reason: "writes",
    carried_to: "S-E",
  },
  {
    id: E("world-editor-L481"),
    part: "part",
    answered_by: ["sd-17-u10-tool"],
    missing: "[ButtonAttribute] methods; activation without the GUI",
    reason: "no such action in either pack",
    carried_to: "the second authoring pass",
  },
  {
    id: "P-U10",
    part: "part",
    answered_by: [
      "sd-14-u10-SCR_SnapAndOrientToTerrainPlugin",
      "sd-14-u10-SCR_CopyClassAndMethodPlugin",
      "sd-14-u10-SCR_DebugLinePlugin",
      "sd-17-u10-tool",
    ],
    missing: "attribute write, dialog-free Run(), tool button methods",
    reason: "writes and runs are S-E's",
    carried_to: "S-E",
  },
  {
    id: "P-U8",
    part: "part",
    answered_by: ["sd-04-u8-matrix-closed", "sd-12-u8-*"],
    missing: "Set plus Save",
    reason: "plan 7: the write half is S-E",
    carried_to: "S-E",
  },
  {
    id: E("anim-procanim-behavior-L407"),
    part: "part",
    answered_by: ["sd-12-u8-AnimEditor", "sd-12-u8-BehaviorEditor", "sd-12-u8-ProcAnimEditor"],
    missing: "BaseContainer Set and module Save",
    reason: "the write half is S-E's",
    carried_to: "S-E",
  },
  {
    id: E("anim-procanim-behavior-L408"),
    part: "part",
    answered_by: ["sd-12-u8-AnimEditor", "sd-12-u8-BehaviorEditor", "sd-12-u8-ProcAnimEditor"],
    missing: "SetOpenedResource, and .aw, .anm, .txa, .siga",
    reason: "S-D opens one .agr, .bt and .pap through the native OpenResource only",
    carried_to: "S-E",
  },
  {
    id: E("audio-particle-navmesh-L487"),
    part: "part",
    answered_by: ["sd-12-u8-AudioEditor"],
    missing: "Set plus Save",
    reason: "the write half is S-E's",
    carried_to: "S-E",
  },
  {
    id: E("audio-particle-navmesh-L488"),
    part: "part",
    answered_by: ["sd-12-u8-AudioEditor"],
    missing: "SetOpenedResource; .sig and .afm",
    reason: "S-D opens one .acp through the native OpenResource only",
    carried_to: "S-E",
  },
  {
    id: E("audio-particle-navmesh-L501"),
    part: "part",
    answered_by: ["sd-12-u8-ParticleEditor"],
    missing: "SetOpenedResource and Save()",
    reason: "the write half is S-E's",
    carried_to: "S-E",
  },
  {
    id: E("resource-manager-L671"),
    part: "part",
    answered_by: ["sd-12-u8-ResourceManager"],
    missing: "GetContainer for an open .emat, .imageset, .et, .edds, .xob",
    reason: "sd-12 opens one .conf in the Resource Manager",
    carried_to: "the Phase 3.3 L08 battery",
  },
  {
    id: E("plugins-netapi-cli-L461"),
    part: "part",
    answered_by: ["sd-04-u8-matrix-closed", "sd-12-u8-*"],
    missing: "writable containers and Save()",
    reason: "the write half is S-E's",
    carried_to: "S-E",
  },
  {
    id: "P-U16",
    part: "part",
    answered_by: ["sd-10a-u16-load-first", "sd-10b-u16-load-rest"],
    missing: "the SaveContainer round trip",
    reason: "plan 7: the write half is S-E",
    carried_to: "S-E",
  },
  {
    id: E("anim-procanim-behavior-L417"),
    part: "part",
    answered_by: ["sd-10b-u16-load-rest"],
    missing: "SaveContainer; .agf, .asi, .pap",
    reason: "the write half is S-E's; sd-10b loads one .agr and one .bt",
    carried_to: "S-E",
  },
  {
    id: "P-U17",
    part: "part",
    answered_by: ["sd-06-u17-layer-noworld", "sd-16-u17-layer-world"],
    missing: "create, rename, persistence",
    reason: "plan 7: the write half is S-E",
    carried_to: "S-E",
  },
  {
    id: E("world-editor-L479"),
    part: "part",
    answered_by: ["sd-06-u17-layer-noworld", "sd-16-u17-layer-world"],
    missing: "create and persist",
    reason: "the write half is S-E's",
    carried_to: "S-E",
  },
  {
    id: E("mcp-inventory-L352"),
    part: "part",
    answered_by: ["sd-06-u17-layer-noworld", "sd-16-u17-layer-world"],
    missing: "create, delete, rename, setActive, visibility",
    reason: "the write half is S-E's",
    carried_to: "S-E",
  },
  {
    id: "P-U34",
    part: "part",
    answered_by: ["sd-05-u34-diag-get", "sd-13-u34-diag-select", "sd-18-u34-diag-viewport"],
    missing: "SetValue; play mode; the -diagMenu state file",
    reason:
      "diagSet is in the mutating pack (allow-list empty); play mode is train #2 or later; a -diagMenu launch needs an extra launch argument the default pre-flight variant refuses (DEC-039) and a second launch",
    carried_to: "S-E (set), the U32 sitting (play), S-F or a dedicated launch (state file)",
  },
  {
    id: "P-U6",
    part: "part",
    answered_by: ["sd-21-u6-modal", "sd-22-u6-after"],
    missing: "whether the dialog can be dismissed from outside",
    reason:
      "the harness posts no input and sends no message to a dialog (DEC-030, ruling 2); the owner closes it",
    carried_to:
      "open: fallback 'modal plugins are never run from handlers' unless the owner rules otherwise",
  },
  {
    id: "P-U27",
    part: "part",
    answered_by: [
      "sd-01-auth-restart",
      "sd-07-u5-eval-ok",
      "sd-10a-u16-load-first",
      "sd-20a-u28-screenshot",
    ],
    missing: "the methods S-D does not call",
    reason: "plan 7: observe during U6 and U16; U16's write half is S-E",
    carried_to: "S-E",
  },
  {
    id: "P-U5",
    part: "part",
    answered_by: ["sd-07-u5-eval-ok", "sd-08-u5-screen", "sd-09-u5-reach"],
    missing: "SCR_ class reach and the 2,000-character limit",
    reason: "the allow screen lists no SCR_ class; size is not probed in the first snippets",
    carried_to: "a later eval session under D3",
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

/** Everything that would touch a process, a socket, the desktop or a file outside the artifacts folder. */
export interface SdDeps {
  net(apiFunc: string, params: Record<string, unknown>, timeoutMs: number): Promise<RawCallResult>;
  /** Visible top-level windows (EnumWindows, z-order: the frontmost first); every pid. */
  listWindows(): Promise<WindowInfo[]>;
  capture(label: string): Promise<{ ok: boolean; path: string; detail: string }>;
  /**
   * WM_NULL round trips in ms (null when it did not answer). With `hwnd`, to that window only (S-D
   * passes the main window recorded at the gate, so nothing is sent to a dialog); without it, the
   * pid's .NET MainWindowHandle (S-C's behaviour).
   */
  guiStall(pid: number, samples: number, hwnd?: number | null): Promise<Array<number | null>>;
  /** IsHungAppWindow on `hwnd` (or the pid's main window), or null when it could not be read. */
  hungApp(pid: number, hwnd?: number | null): Promise<boolean | null>;
  processImage(pid: number): string | null;
  processCreated(pid: number): Promise<number | null>;
  listRunFiles(): string[];
  /** Entry names of a sandbox folder (empty when it does not exist). */
  listDir(path: string): string[];
  /** Pids listening on the NET port. */
  portOwners(): number[];
  crashReporters(): number[];
  /** Every TCP port the given pids listen on (netstat). */
  listenersOf(pids: number[]): Array<{ pid: number; port: number }>;
  /** CloseMainWindow (WM_CLOSE) on pid and wait; never a kill (the abort path only). */
  closeGracefully(pid: number, timeoutMs: number): Promise<{ exited: boolean; detail: string }>;
  recordedPid(): number | null;
  heartbeat(): void;
  sessionLogAfter(after: number | null): string | null;
  readText(path: string): string;
  readRegLines(path: string): string[];
  fileExists(path: string): boolean;
  /** Bytes of a file under `<sandbox>/_throwaway/` (the only sandbox file the run reads). */
  readBytes(path: string): Buffer;
  /** Remove a file under `<sandbox>/_throwaway/`. */
  removeFile(path: string): void;
  /** Create `<sandbox>/_throwaway/`. */
  makeDir(path: string): void;
  /** Remove a folder under the sandbox only when it is empty. */
  removeEmptyDir(path: string): void;
  startDetached(spec: DetachedSpec): number;
  readRunFile(name: string): string | null;
  /** A run-folder file's bytes, or null. */
  readRunBytes(name: string): Buffer | null;
  /** Create a binary file in the run folder (never overwrites); returns its path. */
  writeRunBytes(name: string, data: Buffer): string;
  /** Append one line to a run-folder file. */
  appendRunLine(name: string, line: string): void;
  runWalker(argv: string[], budgetMs: number): Promise<WalkerResult>;
  writeArtifact(name: string, value: unknown): string;
  writeEvidence(summary: string, artifactPath: string): string;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export interface SdOptions {
  sandboxDir: string;
  gproj: string;
  from: string | null;
  until: string | null;
  only?: string | null;
  openedProjectPattern: string;
  allowedAddons: string[];
  nonce: string;
  runDir: string;
  laneId: string;
  policy: CensusPolicy;
  registryExport: string | null;
  debugModeUnsetOk: boolean;
  forceSettings: string | null;
  /** --u30-rerun: sd-11 runs. */
  u30Rerun: boolean;
  /**
   * --owner-clicked: the button(s) the owner reports for the pending authorization handoff, in
   * order: one per prompt (`auth-<step>.json`, then `auth-<step>-2.json`, ...).
   */
  ownerClicked?: AuthButton | readonly AuthButton[] | null;
  /** --walker-cmd: sd-19's optional passive walks of the dock's window. */
  walkerCmd?: string[] | null;
  ownedModuleClasses?: string[];
}

interface SdState {
  wbPid: number | null;
  startedPids: Set<number>;
  baselineWindows: WindowInfo[];
  /** The owner clicked Yes to All on an earlier prompt: a later "no prompt" says nothing for U27. */
  yesToAll: boolean;
  /**
   * The main window recorded at the gate baseline (unowned, title "Enfusion Workbench..."): the
   * only window WM_NULL and IsHungAppWindow go to (M2); null when none was found (no sample sent).
   */
  mainHwnd: number | null;
  /** The gate's session-log scan position (M1), kept for the gate's result even when it stops. */
  logScan: LogScan | null;
}

/** Where the gate's compile-error scan of the session log ended (M1). */
export interface LogScan {
  log: string;
  /** Complete lines scanned (a partial last line is not counted, so it is scanned again). */
  lines: number;
  /** The first line this gate scanned (0 for a full scan). */
  from: number;
  resumed: boolean;
  /** The scan found errors: the next gate does not resume from it. */
  stopped: boolean;
}

export interface SdContext {
  opts: SdOptions;
  deps: SdDeps;
  state: SdState;
  calls: CallRecord[];
  /** The running step's id. */
  step: string;
  call(spec: CallSpec): Promise<RawCallResult>;
  /**
   * A call that can raise the authorization prompt: run in a detached child while the window list
   * is polled; the prompt is a handoff, any other dialog or a disabled window a stop.
   */
  promptable(spec: CallSpec, label: string): Promise<RawCallResult>;
  /** U30: every call started within the same tick, each on its own socket. */
  burst(specs: CallSpec[]): Promise<RawCallResult[]>;
  /** The pid's windows; a failed window list is a stop (m6), never "no dialog". */
  ourWindows(): Promise<WindowInfo[]>;
  /** WM_NULL to the main window recorded at the gate only (M2); nulls, nothing sent, without one. */
  stall(samples: number): Promise<Array<number | null>>;
  /** IsHungAppWindow on the main window recorded at the gate only (M2); null without one. */
  hung(): Promise<boolean | null>;
  modalCheck(label: string, expected?: (w: WindowInfo) => boolean): Promise<WindowInfo[]>;
  setBaseline(label: string): Promise<WindowInfo[]>;
}

export interface PlanInput {
  sandbox: string;
  /** Allow-listed World Editor dock paths sd-19a runs (WINDOW_PATHS filtered by the policy). */
  windowPaths: string[][];
  /** RM_DOCK_PATH is allow-listed: sd-19b runs. */
  rmDockAllowed: boolean;
  u30Rerun: boolean;
  /** --walker-cmd given: sd-19 walks before and after each pair. */
  walker: boolean;
  nonce: string;
}

export interface StepDef {
  id: string;
  title: string;
  risk: RiskClass;
  answers: string[];
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  outline: string[];
  /** The step's calls can raise the authorization prompt: it is a block of its own (ruling 1). */
  canPrompt?: boolean;
  skipWhen?: { condition: string; carried_to: string };
  skip?(ctx: SdContext): string | null;
  plan(p: PlanInput): PlanAction[];
  run(ctx: SdContext): Promise<StepOutcome>;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** True for Edit > Undo in any spelling (mnemonic, case): never sent in S-D (ruling 7). */
export function isNeverPath(path: readonly string[]): boolean {
  return (
    path.map((s) => s.replace(/&/g, "").trim().toLowerCase()).join("/") ===
    NEVER_PATH.join("/").toLowerCase()
  );
}

/** The probe pack's fact list (factKeys, factValues) as a record. */
export function probeFacts(response: unknown): Record<string, string> {
  const r = response as { factKeys?: unknown; factValues?: unknown } | undefined;
  const keys = Array.isArray(r?.factKeys) ? (r!.factKeys as unknown[]) : [];
  const values = Array.isArray(r?.factValues) ? (r!.factValues as unknown[]) : [];
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    out[String(k)] = String(values[i] ?? "");
  });
  return out;
}

/** The probe pack's status ("ok", "error", "refused"), or null for another shape. */
export function probeStatus(response: unknown): string | null {
  const s = (response as { status?: unknown } | undefined)?.status;
  return typeof s === "string" ? s : null;
}

/** pageCount of a paged probe answer (1 when absent). */
export function pageCountOf(response: unknown): number {
  const n = Number((response as { pageCount?: unknown } | undefined)?.pageCount);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * The authorization dialog among a pid's windows: the window titled exactly "Script Authorization
 * Required" (DEC-040), whatever its owner field (S-C saw it unowned; an owned one is the same
 * prompt), or null. Its class and owner are recorded, not required.
 */
export function authWindow(windows: readonly WindowInfo[], pid: number | null): WindowInfo | null {
  return windows.find((w) => (pid === null || w.pid === pid) && w.title === AUTH_TITLE) ?? null;
}

/** The title prefix of the Workbench main window (M2). */
export const MAIN_TITLE_PREFIX = "Enfusion Workbench";

/**
 * The Workbench main window among a pid's windows: unowned, titled "Enfusion Workbench..." (not the
 * launcher), or null. WM_NULL and IsHungAppWindow go to this window only, never to a dialog.
 */
export function mainWindowOf(windows: readonly WindowInfo[], pid: number): WindowInfo | null {
  return (
    windows.find(
      (w) =>
        w.pid === pid &&
        w.owner === 0 &&
        w.title.startsWith(MAIN_TITLE_PREFIX) &&
        !/launcher/i.test(w.title),
    ) ?? null
  );
}

/**
 * sd-21's dialog (m2): by its exact caption first; else a window added since `baseline` that is
 * dialog-like (class #32770, or owned and not a Qt tool window); else a new unowned window of the
 * pid while the main window turned disabled. Returns the window and the rule that matched.
 */
export function u6Dialog(
  baseline: readonly WindowInfo[],
  windows: readonly WindowInfo[],
  pid: number,
  mainHwnd: number | null,
): { window: WindowInfo; rule: string } | null {
  const byTitle = modalWindow(windows, pid);
  if (byTitle) return { window: byTitle, rule: `title "${MODAL_CAPTION}"` };
  const ch = windowChanges(baseline, windows, pid);
  const added = ch.added.filter((w) => w.title !== AUTH_TITLE);
  const win32 = added.find((w) => w.className === "#32770");
  if (win32) return { window: win32, rule: "new window of class #32770" };
  const owned = added.find((w) => isDialogLike(w));
  if (owned) return { window: owned, rule: "new owned window (not a Qt tool window)" };
  const mainDisabled =
    mainHwnd !== null
      ? windows.some((w) => w.hwnd === mainHwnd && !w.enabled)
      : ch.disabled.some((w) => w.owner === 0);
  const unowned = added.find((w) => w.owner === 0);
  if (unowned && mainDisabled)
    return { window: unowned, rule: "new unowned window while the main window is disabled" };
  return null;
}

/** A session-log line naming an `ECEN_Probe*.c` file with a compile error (M1). */
export function isProbeCompileError(line: string): boolean {
  return (
    /ECEN_Probe\w*\.c\b/i.test(line) &&
    (/\berror\b/i.test(line) || /\(E\)/.test(line)) &&
    !/exception/i.test(line)
  );
}

/**
 * The gate's compile-error scan (M1). A first, non-resumed gate scans the whole log as before (any
 * line naming ECEN_ with "error"). A resumed gate scans only the lines after the last gate's
 * recorded position in the same log and stops only on an `ECEN_Probe*.c` compile error, so sd-09's
 * deliberate syntax error, or a VM exception naming an ECEN_ file, does not stop every later gate.
 */
export function scanSessionLog(
  log: string,
  text: string,
  previous: LogScan | null,
): { errors: string[]; scan: LogScan } {
  const all = text.split(/\r?\n/);
  // Complete lines only: a partial last line is scanned now and again next time.
  const complete = all.length - 1;
  const resumed =
    previous !== null && !previous.stopped && previous.log === log && previous.lines <= complete;
  const from = resumed ? previous.lines : 0;
  const lines = all.slice(from);
  const errors = (
    resumed
      ? lines.filter((l) => isProbeCompileError(l))
      : lines.filter((l) => /ECEN_/.test(l) && /error/i.test(l))
  ).slice(0, 10);
  // A scan that found errors is not resumed from: the next gate scans the whole log again.
  return { errors, scan: { log, lines: complete, from, resumed, stopped: errors.length > 0 } };
}

/** The probe dialog of sd-21 among a pid's windows (title "ECEN probe modal"), or null. */
export function modalWindow(windows: readonly WindowInfo[], pid: number): WindowInfo | null {
  return windows.find((w) => w.pid === pid && w.title === MODAL_CAPTION) ?? null;
}

/** The frontmost window of a pid in an EnumWindows list (z-order), or null. */
export function frontmost(windows: readonly WindowInfo[], pid: number): WindowInfo | null {
  return windows.find((w) => w.pid === pid) ?? null;
}

/** A nonce the screenshot rule accepts: lower-case hex, 6 to 32 characters. */
export function nonceProblem(nonce: string): string | null {
  return /^[0-9a-f]{6,32}$/.test(nonce)
    ? null
    : `--nonce ${nonce} must be 6 to 32 lower-case hex characters`;
}

/** The U28 target file name, `<label>-<nonce>.bmp` (ruling 4). */
export function screenshotName(label: string, nonce: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(label))
    throw new Error(`screenshot label ${label} is not [A-Za-z0-9_]+`);
  const bad = nonceProblem(nonce);
  if (bad) throw new Error(bad);
  return `${label}-${nonce}.bmp`;
}

/** Listening TCP ports of `pids` in `netstat -ano -p TCP` output. */
export function listenersInNetstat(
  output: string,
  pids: readonly number[],
): Array<{ pid: number; port: number }> {
  const want = new Set(pids);
  const out: Array<{ pid: number; port: number }> = [];
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    if (cols[3].toUpperCase() !== "LISTENING") continue;
    const pid = Number(cols[4]);
    const port = Number(cols[1].slice(cols[1].lastIndexOf(":") + 1));
    if (want.has(pid) && Number.isInteger(port)) out.push({ pid, port });
  }
  return out;
}

/**
 * The authorization-log entries of a run folder (unreadable lines are skipped). `button` is the
 * first prompt's button; `buttons` every prompt's, in order (`[button]` for an older line).
 */
export function authLogEntries(
  text: string | null,
): Array<{ step: string; button: string; buttons: string[] }> {
  if (!text) return [];
  const out: Array<{ step: string; button: string; buttons: string[] }> = [];
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const e = JSON.parse(l) as { step?: unknown; button?: unknown; buttons?: unknown };
      if (typeof e.step === "string" && typeof e.button === "string") {
        const buttons =
          Array.isArray(e.buttons) && e.buttons.every((b) => typeof b === "string")
            ? (e.buttons as string[])
            : [e.button];
        out.push({ step: e.step, button: e.button, buttons });
      }
    } catch {
      // A line that does not parse names no step.
    }
  }
  return out;
}

/** U30's per-call budget: max(120 s, 4 x the single GetGameMaterials time), at most 1200 s. */
export function burstPerCallMs(heavyMs: number | null): number {
  return Math.min(4 * TIMEOUTS.heavy, Math.max(TIMEOUTS.burstFloor, 4 * (heavyMs ?? 0)));
}

function summarizeCall(r: RawCallResult): Record<string, unknown> {
  return {
    ok: r.ok,
    durationMs: r.durationMs,
    bytesReceived: r.bytesReceived,
    wire: r.wire,
    ...(r.ok ? { response: r.response } : { error: r.error }),
  };
}

function field(response: unknown, name: string): unknown {
  return response && typeof response === "object"
    ? (response as Record<string, unknown>)[name]
    : undefined;
}

/** A call spec of the probe pack's one NET function. */
export function probe(
  action: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  note?: string,
): CallSpec {
  return {
    apiFunc: PROBE_API,
    params: { action, ...params },
    timeoutMs,
    ...(note ? { note } : {}),
  };
}

function net(
  step: string,
  probes: string[],
  spec: CallSpec,
  extra: Record<string, unknown> = {},
): PlanAction {
  return {
    kind: "net-call",
    target: spec.apiFunc,
    params: spec.params,
    step,
    probes,
    timeout_ms: spec.timeoutMs,
    ...(spec.note ? { note: spec.note } : {}),
    ...extra,
  };
}

/** The `execute-action` a probe-pack executeAction call is, as the checker reads it. */
function execAction(
  step: string,
  probes: string[],
  path: readonly string[],
  module: string,
): PlanAction {
  return {
    kind: "execute-action",
    target: { path: [...path], module },
    step,
    probes,
    via: `${PROBE_API} {action: executeAction}`,
  };
}

/** The passive walk sd-19 runs with --walker-cmd (the pid is the lane's, the window chosen at run time). */
function walkAction(step: string, probes: string[], label: string): PlanAction {
  return {
    kind: "uia-read",
    step,
    probes,
    target: {
      pid: LANE_RECORDED_PID,
      window: {
        className: `<Win32 class of the ${label} window, read from the window list at run time>`,
        titlePattern: `<exact title of the unowned ${label} window, escaped>`,
        allowOwned: false,
      },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: { ...WALK_DEFAULT_BOUNDS },
    note: "tools/uia/walk.ts by the --walker-cmd command line; it checks this read again with the real pid, class and title",
  };
}

/** A run-folder JSON file's content, or null. */
function runJson<T>(ctx: Pick<SdContext, "deps">, name: string): T | null {
  const text = ctx.deps.readRunFile(name);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** The status of an earlier step's result in the run folder, or null. */
function priorStatus(ctx: Pick<SdContext, "deps">, id: string): string | null {
  return runJson<{ status?: string }>(ctx, `${id}.json`)?.status ?? null;
}

/** What this run folder knows of `pid` (DEC-032), as S-C's knownPid with S-D's gate. */
export function knownPid(
  ctx: Pick<SdContext, "deps">,
  pid: number,
  created: number | null,
): "reused" | "known" | "new" {
  if (created === null) return "new";
  const files = ctx.deps.listRunFiles();
  let known = false;
  for (const f of files) {
    const m = /^(.+)\.started(\.acknowledged)?$/.exec(f);
    if (!m) continue;
    const marker = runJson<StartedMarker>(ctx, f);
    if (!marker || marker.pid !== pid || marker.created === null) continue;
    if (marker.created !== created) return "reused";
    if (files.includes(`${m[1]}.json`)) known = true;
  }
  const gate = runJson<{ status?: string; data?: { pid?: number; created?: number | null } }>(
    ctx,
    "sd-00-gate.json",
  );
  if (gate?.status === "pass" && gate.data?.pid === pid && gate.data.created === created) {
    known = true;
  }
  return known ? "known" : "new";
}

// ── Shared step parts ────────────────────────────────────────────────────────

async function waitPort(ctx: SdContext, pid: number, budgetMs: number): Promise<void> {
  const deadline = ctx.deps.now() + budgetMs;
  for (;;) {
    ctx.deps.heartbeat();
    const owners = ctx.deps.portOwners();
    if (owners.includes(pid)) return;
    const foreign = owners.filter((o) => o !== pid);
    if (foreign.length) {
      throw new StopSession(
        "kill",
        `the NET port is held by pid ${foreign.join(", ")}, not by ${pid}`,
      );
    }
    if (ctx.deps.processImage(pid) === null) {
      throw new StopSession("kill", `Workbench pid ${pid} exited before listening on the NET port`);
    }
    if (ctx.deps.now() >= deadline) {
      throw new StopSession(
        "timeout",
        `pid ${pid} did not listen on the NET port within ${budgetMs} ms`,
      );
    }
    await ctx.deps.sleep(TIMEOUTS.poll);
  }
}

async function waitScriptsCompiled(ctx: SdContext, budgetMs: number): Promise<RawCallResult> {
  const deadline = ctx.deps.now() + budgetMs;
  for (;;) {
    const r = await ctx.call({
      apiFunc: "IsWorkbenchRunning",
      params: {},
      timeoutMs: TIMEOUTS.cheap,
    });
    if (r.ok && field(r.response, "ScriptsCompiled") === true) return r;
    if (ctx.deps.now() >= deadline) {
      throw new StopSession(
        "kill",
        `scripts not compiled after ${budgetMs} ms (IsWorkbenchRunning: ${JSON.stringify(r.response ?? r.error)}); the compile gate failed (plan 5.4)`,
      );
    }
    await ctx.deps.sleep(TIMEOUTS.poll);
  }
}

/** Script Debug Mode off, from the forced ini (DEC-038) or the pre-flight export; as S-C's gate. */
function debugModeGate(ctx: SdContext): { state: string; line: string | null; source: string } {
  if (ctx.opts.forceSettings) {
    const r = iniScriptDebugMode(ctx.deps.readText(ctx.opts.forceSettings));
    if (r.state === "on") {
      throw new StopSession(
        "kill",
        `Script Debug Mode is on in the forced settings ini (${r.line}): a VM exception would raise the VME dialog; rebuild the ini with ScriptDebugMode=false`,
      );
    }
    if (r.state === "absent" && !ctx.opts.debugModeUnsetOk) {
      throw new StopSession(
        "kill",
        "the forced settings ini holds no ScriptDebugMode in [World%20Editor]: the owner confirms it is unchecked, then repeat with --debug-mode-unset-ok",
      );
    }
    return { ...r, source: "force-settings-ini" };
  }
  if (!ctx.opts.registryExport) {
    throw new StopSession("kill", "no pre-flight registry export given (--registry-export)");
  }
  const r = scriptDebugMode(ctx.deps.readRegLines(ctx.opts.registryExport));
  if (r.state === "on") {
    throw new StopSession(
      "kill",
      `Script Debug Mode is on in the pre-flight registry export (${r.line})`,
    );
  }
  if (r.state === "absent" && !ctx.opts.debugModeUnsetOk) {
    throw new StopSession(
      "kill",
      "the pre-flight registry export holds no ScriptDebugMode value: confirm by looking, then repeat with --debug-mode-unset-ok",
    );
  }
  return { ...r, source: "registry-export" };
}

/** Read a paged probe table: page 0, then further pages while pageCount says so (at most MAX_PAGES). */
async function paged(
  ctx: SdContext,
  spec: CallSpec,
  label: string,
  expected?: (w: WindowInfo) => boolean,
  firstOnly?: Record<string, unknown>,
): Promise<RawCallResult[]> {
  const out: RawCallResult[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { ...spec.params, page, ...(page === 0 ? (firstOnly ?? {}) : {}) };
    const r = await ctx.call({ ...spec, params, note: `${spec.note ?? label} page ${page}` });
    out.push(r);
    await ctx.modalCheck(`${label} page ${page}`, expected);
    if (!r.ok || page + 1 >= pageCountOf(r.response)) break;
  }
  return out;
}

/** The plan entries of a paged read: every page it may ask for. */
function pagedPlan(
  step: string,
  answers: string[],
  spec: CallSpec,
  firstOnly: Record<string, unknown> = {},
): PlanAction[] {
  return Array.from({ length: MAX_PAGES }, (_, page) =>
    net(step, answers, {
      ...spec,
      params: { ...spec.params, page, ...(page === 0 ? firstOnly : {}) },
      note: `${spec.note ?? spec.params.action} page ${page}${page ? " (only while page < pageCount)" : ""}`,
    }),
  );
}

/** Worst case of a paged read: every page and its modal check. */
const pagedMs = (timeoutMs: number): number => MAX_PAGES * (timeoutMs + HELPER.windows);

/** A promptable call's worst case: the detached budget (its timeout, grace, a poll overrun) and the modal check. */
const promptMs = (timeoutMs: number): number => detachedBudgetMs(timeoutMs) + HELPER.windows;

/** The next step after `id` in the table, for a handoff's resume line. */
function nextStep(steps: StepDef[], id: string): string | null {
  const i = steps.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < steps.length ? steps[i + 1].id : null;
}

// ── U28: the screenshot plant ────────────────────────────────────────────────

/** A screenshot plant record (`plant-<step>.json`). */
export interface ShotPlant {
  step: string;
  folder: string;
  file: string;
  /** `<sandbox>/_throwaway/` existed before the step. */
  folderExisted: boolean;
  /** The detached child whose call may still write the file. */
  resultName: string;
}

/** Plant ids of the two screenshot steps (`plant-sd-20a.json`, `plant-sd-20b.json`). */
export const SHOT_PLANTS = ["sd-20a", "sd-20b"] as const;

/** Open plants: a plant record and no rollback record. */
function openPlants(ctx: Pick<SdContext, "deps">): Array<{ id: string; plant: ShotPlant }> {
  const out: Array<{ id: string; plant: ShotPlant }> = [];
  for (const id of SHOT_PLANTS) {
    const p = runJson<ShotPlant>(ctx, `plant-${id}.json`);
    if (p && ctx.deps.readRunFile(`rollback-${id}.json`) === null) out.push({ id, plant: p });
  }
  return out;
}

/**
 * Settle a screenshot plant: read the BMP once and hash it, copy those bytes into the run folder
 * (create-only), read the copy back and check its hash against the source's hash read before the
 * copy, delete that one file only when they match (otherwise stop and leave it), remove
 * `_throwaway/` when the step created it and it is empty, and write the rollback record. Anything
 * else in the folder is named and left; the step then stops. Returns what was found.
 */
function settleShot(
  ctx: Pick<SdContext, "deps" | "opts">,
  id: string,
  plant: ShotPlant,
): { landed: boolean; sha256: string | null; bytes: number; copy: string | null } {
  const dir = join(ctx.opts.sandboxDir, THROWAWAY);
  const file = join(dir, plant.file);
  if (!insideDir(join(ctx.opts.sandboxDir, THROWAWAY), file)) {
    throw new StopSession(
      "kill",
      `the screenshot target ${plant.file} is not inside ${THROWAWAY}/`,
    );
  }
  let landed = false;
  let hash: string | null = null;
  let bytes = 0;
  let copy: string | null = null;
  if (ctx.deps.fileExists(file)) {
    const data = ctx.deps.readBytes(file);
    hash = sha256Hex(data);
    bytes = data.length;
    copy = ctx.deps.writeRunBytes(`u28-${plant.file}`, data);
    const copied = ctx.deps.readRunBytes(`u28-${plant.file}`);
    if (copied === null) {
      throw new StopSession(
        "kill",
        `the copy of ${plant.file} is not in the run folder; the BMP is left`,
      );
    }
    if (sha256Hex(copied) !== hash) {
      throw new StopSession(
        "kill",
        `the copy of ${plant.file} does not hash to the source's ${hash.slice(0, 12)}...; the BMP is left`,
      );
    }
    ctx.deps.removeFile(file);
    landed = true;
  }
  if (ctx.deps.fileExists(file)) {
    throw new StopSession(
      "kill",
      `${plant.file} is still in <sandbox>/${THROWAWAY}/ after its removal`,
    );
  }
  const left = ctx.deps.fileExists(dir) ? ctx.deps.listDir(dir) : [];
  if (ctx.deps.fileExists(dir) && left.length === 0 && !plant.folderExisted)
    ctx.deps.removeEmptyDir(dir);
  if (left.length > 0) {
    throw new StopSession(
      "kill",
      `<sandbox>/${THROWAWAY}/ holds ${left.join(", ")} (not this run's): named, never deleted; the main session removes it with the owner`,
    );
  }
  ctx.deps.writeArtifact(`rollback-${id}.json`, {
    ok: true,
    by: "step",
    landed,
    sha256: hash,
    bytes,
  });
  return { landed, sha256: hash, bytes, copy };
}

/**
 * A child result that settles a screenshot plant (M4): the call answered (ok, not timed out). A
 * timeout or a failed call says nothing about whether Workbench still writes the BMP.
 */
export function settlesPlant(r: RawCallResult | null): boolean {
  return r !== null && r.ok === true && !r.timedOut;
}

/** The note a step result carries for a plant left open (M4). */
const plantLeftOpen = (id: string, why: string): string =>
  `plant-${id}.json left open (${why}): the rollback subcommand settles it once no Workbench runs (it needs none running)`;

/**
 * Before a later step: settle every open screenshot plant whose child has answered ok (the owner's
 * click let the call finish, so nothing more is written). A plant whose child has no answer yet, or
 * answered with a timeout or an error, is left open for the `rollback` subcommand, and the entry
 * says so (the pre-check refuses while that child still runs).
 */
function settleLateShots(ctx: SdContext): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const { id, plant } of openPlants(ctx)) {
    if (ctx.deps.readRunFile(plant.resultName) === null) continue;
    const r = runJson<RawCallResult>(ctx, plant.resultName);
    if (!settlesPlant(r)) {
      out.push({
        plant: id,
        settled: false,
        note: plantLeftOpen(
          id,
          r === null
            ? "its child's result does not parse"
            : r.timedOut
              ? "its child timed out"
              : `its child answered ${r.error ?? "not ok"}`,
        ),
      });
      continue;
    }
    out.push({ plant: id, settled: true, ...settleShot(ctx, id, plant) });
  }
  return out;
}

/** The late-settle entries as a summary clause (empty when there were none). */
const lateClause = (late: Array<Record<string, unknown>>): string =>
  late
    .map((l) =>
      l.settled ? `; plant-${String(l.plant)}.json settled late` : `; ${String(l.note)}`,
    )
    .join("");

// ── The step table ───────────────────────────────────────────────────────────

const AUTH_KILL = `a window titled "${AUTH_TITLE}" (whatever its owner field, recorded; S-C saw it unowned, class ${AUTH_CLASS}, the main window disabled): HANDOFF (exit 5), no retry, nothing clicked or keyed; auth-<step>.json written; the main session reads the dialog with the passive walker and quotes it, the owner clicks by hand and says which button, the sitting resumes with --only the next step and --owner-clicked <button>. Any other dialog or a disabled window: stop. No answer within the call's timeout: stop (the child is left running)`;

/** The step table, in queue order. */
export function buildSteps(): StepDef[] {
  const steps: StepDef[] = [];
  const P = SD_PROBES;

  // ── read-only ─────────────────────────────────────────────────────────────
  steps.push({
    id: "sd-00-gate",
    title:
      "Gate: the recorded Workbench is ours, listens, compiled the shipped set and the read-only pack, and opened the sandbox",
    risk: "read-only",
    answers: [],
    timeout_ms:
      2 * TIMEOUTS.ready +
      TIMEOUTS.cheap +
      TIMEOUTS.bohemia +
      TIMEOUTS.probe +
      HELPER.process +
      HELPER.table +
      2 * HELPER.process +
      2 * HELPER.windows,
    expected:
      "as S-C's gate (Script Debug Mode off in the forced ini; the lease's pid is the Workbench executable and holds the NET port; ScriptsCompiled; GetLoadedProjects lists the sandbox and nothing but the allowed addons; the session log names the sandbox and holds no ECEN_ compile error; no disabled, owned or dialog-class window), plus the pack's files in EnfusionCensus/ (ECEN_*.c, no ECEN_ProbeMut) and ECEN_Probe info: isSandbox true and only the allowed addons loaded",
    kill_criterion: `as S-C sc-00; info answering "Undefined API func" means the pack did not compile: stop (train #1 failed, plan 5.4 step 5); isSandbox false or another addon: abort; ${AUTH_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: [
      "read ScriptDebugMode from the forced ini (--force-settings; without it the pre-flight registry export)",
      "wait for the recorded pid to listen on the NET port (listener table, no NET call)",
      "read the newest session log: the opened project (E13 pattern) and no ECEN_ compile error",
      "list <sandbox>/Scripts/WorkbenchGame/EnfusionCensus: ECEN_*.c present, no ECEN_ProbeMut*.c",
      "list the Workbench windows (baseline; refused when it holds a disabled, owned or dialog-class window)",
    ],
    plan: () => [
      net("sd-00-gate", [], {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "repeated every 5 s until ScriptsCompiled",
      }),
      net("sd-00-gate", [], {
        apiFunc: "GetLoadedProjects",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
        note: "opened-project assertion",
      }),
      net("sd-00-gate", [], probe("info", { page: 0 }, TIMEOUTS.probe, "train #1 compile gate")),
    ],
    run: async (ctx) => {
      const debug = debugModeGate(ctx);
      const pid = ctx.deps.recordedPid();
      if (pid === null) {
        throw new StopSession(
          "kill",
          "this lane's lease records no Workbench pid: run preflight.ts first",
        );
      }
      const image = ctx.deps.processImage(pid);
      if (image === null || image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
        throw new StopSession(
          "kill",
          `recorded pid ${pid} is ${image ?? "not running"}, not ${WORKBENCH_EXE}`,
        );
      }
      const created = await ctx.deps.processCreated(pid);
      const known = knownPid(ctx, pid, created);
      if (known === "reused") {
        throw new StopSession(
          "kill",
          `recorded pid ${pid} was created at another time than the Workbench this run folder recorded: a reused pid, never adopted`,
        );
      }
      ctx.state.wbPid = pid;
      ctx.state.startedPids.add(pid);
      const budget = known === "known" ? 0 : TIMEOUTS.ready;
      await waitPort(ctx, pid, budget);
      const compiled = await waitScriptsCompiled(ctx, budget);
      const lp = await ctx.call({
        apiFunc: "GetLoadedProjects",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      });
      const ids = lp.ok ? loadedProjectsOf(lp.response) : null;
      const problem = lp.ok
        ? loadedProjectsProblem(ids, ctx.opts.allowedAddons)
        : `GetLoadedProjects failed: ${lp.error}`;
      if (problem) throw new StopSession("abort", `not the sandbox: ${problem}`);
      const log = ctx.deps.sessionLogAfter(null);
      let fromLog: string | null = null;
      let compileErrors: string[] = [];
      if (log) {
        const text = ctx.deps.readText(log);
        fromLog = openedProjectFromLog(text, ctx.opts.openedProjectPattern);
        if (fromLog !== null && !namesSandbox(fromLog, ctx.opts.gproj)) {
          throw new StopSession("abort", `not the sandbox: the session log names ${fromLog}`);
        }
        // M1: a resumed gate (same process) scans only the lines after the last gate's position.
        const prev =
          known === "known"
            ? (runJson<{ data?: { logScan?: LogScan } }>(ctx, "sd-00-gate.json")?.data?.logScan ??
              null)
            : null;
        const scanned = scanSessionLog(log, text, prev);
        compileErrors = scanned.errors;
        ctx.state.logScan = scanned.scan;
      }
      if (compileErrors.length) {
        throw new StopSession(
          "kill",
          ctx.state.logScan?.resumed
            ? `the session log holds new ECEN_Probe compile errors after line ${ctx.state.logScan.from} (the last gate's position): ${compileErrors.join(" | ")}`
            : `the session log holds probe-pack compile errors (train #1 failed, plan 5.4 step 5): ${compileErrors.join(" | ")}`,
        );
      }
      const pack = ctx.deps.listDir(probePackTarget(ctx.opts.sandboxDir));
      const scripts = pack.filter((f) => isProbePackFile(f));
      const mut = scripts.filter((f) => /^ECEN_ProbeMut/i.test(f));
      if (scripts.length === 0 || mut.length > 0) {
        throw new StopSession(
          "kill",
          scripts.length === 0
            ? "no ECEN_*.c file in <sandbox>/Scripts/WorkbenchGame/EnfusionCensus: install the read-only pack (launch.ts --install-handlers --probe-pack mod-dev/probe)"
            : `the mutating pack is installed (${mut.join(", ")}): S-D runs the read-only pack only`,
        );
      }
      const baseline = await ctx.setBaseline("the gate");
      // M2: the one window WM_NULL and IsHungAppWindow may go to, recorded with the baseline.
      ctx.state.mainHwnd = mainWindowOf(baseline, pid)?.hwnd ?? null;
      const info = await ctx.call(probe("info", { page: 0 }, TIMEOUTS.probe));
      await ctx.modalCheck("info");
      if (!info.ok) {
        throw new StopSession(
          "kill",
          /Undefined API func/i.test(info.error ?? "")
            ? `ECEN_Probe answers "${info.error}": the read-only pack did not compile (train #1 failed, plan 5.4 step 5)`
            : `ECEN_Probe info failed: ${info.error}`,
        );
      }
      const f = probeFacts(info.response);
      if (f.isSandbox !== "true") {
        throw new StopSession(
          "abort",
          `not the sandbox: ECEN_Probe info says isSandbox ${f.isSandbox ?? "absent"} (projectFile ${f.projectFile ?? "absent"}; sandboxDir ${f.sandboxDir ?? "absent"}; why ${f.why ?? "absent"})`,
        );
      }
      return {
        status: "pass",
        summary: `Script Debug Mode ${debug.state} (read from the ${debug.source}); pid ${pid}; loaded ${(ids ?? []).join(", ")}; pack ${scripts.length} files; info isSandbox true, ${f.loadedAddons ?? "?"} addons; session log scanned ${ctx.state.logScan ? `from line ${ctx.state.logScan.from} to ${ctx.state.logScan.lines}${ctx.state.logScan.resumed ? " (resumed: new ECEN_Probe compile errors only)" : ""}` : "(no log)"}; WM_NULL target ${ctx.state.mainHwnd === null ? `none (no unowned "${MAIN_TITLE_PREFIX}..." window: no stall sample is sent)` : `hwnd ${ctx.state.mainHwnd}`}`,
        data: {
          scriptDebugMode: debug,
          pid,
          created,
          resumed: known === "known",
          logScan: ctx.state.logScan,
          mainHwnd: ctx.state.mainHwnd,
          isWorkbenchRunning: compiled.response,
          loaded: ids,
          sessionLogProject: fromLog,
          packFiles: scripts,
          info: summarizeCall(info),
          windows: ctx.state.baselineWindows,
        },
      };
    },
  });

  // The S-C trigger, first call after the gate (ruling 1).
  const locateParams = (sandbox: string): Record<string, unknown> => ({
    selectedProject: SANDBOX_NAME,
    projectPath: sandbox.replace(/\//g, "\\"),
    selectedFolder: sandbox.replace(/\//g, "\\"),
  });
  const authAnswers = [
    P.authPersistence,
    "P-U27",
    E("plugins-netapi-cli-L464"),
    E("plugins-netapi-cli-L468"),
  ];
  const authStep = (id: string, title: string, answers: string[], second: boolean): StepDef => ({
    id,
    title,
    risk: "read-only",
    answers,
    canPrompt: true,
    timeout_ms: promptMs(TIMEOUTS.bohemia),
    expected: second
      ? "an answer (a single Yes holds for the process) or a second prompt (Yes is one-shot): both are verdicts"
      : "an answer with no prompt (S-C's answer persisted across the restart, outside both inis and the registry: the post-flight looks for where) or a prompt (it did not persist on a fresh scratch profile): both are verdicts",
    kill_criterion: AUTH_KILL,
    side_effects: [],
    rollback:
      "none needed; the authorization answer cannot be undone: where it persists is recorded",
    outline: [
      "Bohemia LocatePrefabsFromPath with S-C's sc-02 input (backslash paths), in a detached child; the parent polls the window list every 5 s",
    ],
    ...(second
      ? {
          skipWhen: {
            condition:
              "sd-01 answered with no prompt, or the owner did not report Yes for sd-01's prompt",
            carried_to: "the in-session half of P-SC-script-authorization-persistence stays open",
          },
          skip: (ctx: SdContext) => {
            const s = priorStatus(ctx, "sd-01-auth-restart");
            if (s !== "handoff")
              return `sd-01 ended ${s ?? "without a result"}, not on a prompt: nothing to repeat`;
            const e = authLogEntries(ctx.deps.readRunFile(AUTH_LOG))
              .filter((x) => x.step === "sd-01-auth-restart")
              .pop();
            return e?.button === "Yes"
              ? null
              : `the owner reported ${e?.button ?? "no button"} for sd-01, not Yes`;
          },
        }
      : {}),
    plan: (p) => [
      net(
        id,
        answers,
        {
          apiFunc: "LocatePrefabsFromPath",
          params: locateParams(p.sandbox),
          timeoutMs: TIMEOUTS.bohemia,
          note: "the known FileIO.FindFiles trigger (AssetLibraryUtils.c:164)",
        },
        { detached: true },
      ),
    ],
    run: async (ctx) => {
      const r = await ctx.promptable(
        {
          apiFunc: "LocatePrefabsFromPath",
          params: locateParams(ctx.opts.sandboxDir),
          timeoutMs: TIMEOUTS.bohemia,
        },
        id,
      );
      await ctx.modalCheck("LocatePrefabsFromPath");
      // M5: sd-03 reads CrashReporter later; the processes present now are recorded here too.
      const crash = ctx.deps.crashReporters();
      return {
        status: "observed",
        summary: `answered with no prompt (${r.ok ? "Ok" : r.error})${second ? ": a single Yes holds for the process" : ": the S-C answer persisted across the restart"}${ctx.state.yesToAll ? "; void for U27 (Yes to All was clicked earlier)" : ""}; CrashReporter.exe ${crash.length ? `pid ${crash.join(", ")} present` : "not running"}`,
        data: {
          prompted: false,
          u27Void: ctx.state.yesToAll,
          call: summarizeCall(r),
          crashReporters: crash,
        },
      };
    },
  });
  steps.push(
    authStep(
      "sd-01-auth-restart",
      "Authorization persistence across a restart: Bohemia's LocatePrefabsFromPath, S-C's trigger, first call after the gate",
      authAnswers,
      false,
    ),
  );
  steps.push(
    authStep(
      "sd-02-auth-again",
      "Authorization in the same process: the same call again after the owner answered sd-01's prompt with Yes",
      [P.authPersistence, "P-U27"],
      true,
    ),
  );

  steps.push({
    id: "sd-03-crash-reporter",
    title: "S-C's CrashReporter: the process and listener tables only",
    risk: "read-only",
    answers: [P.crashReporter],
    timeout_ms: 3 * HELPER.process,
    expected:
      "a record: whether CrashReporter.exe still runs, the ports it listens on, and that the gate passed beside it; it is never ended (plan 5.7)",
    kill_criterion: "none (observation only)",
    side_effects: [],
    rollback: "none needed",
    outline: ["tasklist for CrashReporter.exe; netstat for its listeners; the NET port's owner"],
    plan: () => [],
    run: async (ctx) => {
      const pids = ctx.deps.crashReporters();
      const ports = pids.length ? ctx.deps.listenersOf(pids) : [];
      const owners = ctx.deps.portOwners();
      return {
        status: "observed",
        summary: pids.length
          ? `CrashReporter.exe pid ${pids.join(", ")} runs; listens on ${ports.map((p) => p.port).join(", ") || "no port"}; the gate passed beside it`
          : "no CrashReporter.exe runs: the probe is answered only as 'not observed'",
        data: {
          crashReporters: pids,
          listeners: ports,
          netPortOwners: owners,
          wbPid: ctx.state.wbPid,
        },
      };
    },
  });

  const u8Base = ["P-U8", E("mcp-inventory-L267"), E("plugins-netapi-cli-L461")];
  const matrixAnswers = [
    ...u8Base,
    E("anim-procanim-behavior-L406"),
    E("anim-procanim-behavior-L479"),
    E("audio-particle-navmesh-L486"),
    E("script-string-dialogue-L411"),
  ];
  const matrixSpec = probe("moduleMatrix", {}, TIMEOUTS.probe, "moduleMatrix, no openModules");
  steps.push({
    id: "sd-04-u8-matrix-closed",
    title: "U8 before any module is opened: moduleMatrix without openModules",
    risk: "read-only",
    answers: matrixAnswers,
    timeout_ms: pagedMs(TIMEOUTS.probe),
    expected:
      "a table: GetModule non-null or null for the 11 modules before any was opened by the sitting, GetNumContainers, class and variable names",
    kill_criterion: `a call unanswered within its timeout: stop; the modal check; ${AUTH_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: [],
    plan: () => pagedPlan("sd-04-u8-matrix-closed", matrixAnswers, matrixSpec),
    run: async (ctx) => {
      const pages = await paged(ctx, matrixSpec, "moduleMatrix");
      return {
        status: "observed",
        summary: `${pages.length} page(s); status ${probeStatus(pages[0].response) ?? pages[0].error}`,
        data: { pages: pages.map(summarizeCall) },
      };
    },
  });

  const diagReads = (ctx: SdContext, label: string): Promise<Array<Record<string, unknown>>> =>
    (async () => {
      const per: Array<Record<string, unknown>> = [];
      for (const d of DIAG_ENUMS) {
        const r = await ctx.call(probe("diagRead", { diagEnum: d }, TIMEOUTS.probe, d));
        await ctx.modalCheck(`${label} ${d}`);
        per.push({ diagEnum: d, facts: probeFacts(r.response), ...summarizeCall(r) });
      }
      return per;
    })();
  const diagPlan = (id: string): PlanAction[] =>
    DIAG_ENUMS.map((d) =>
      net(id, ["P-U34"], probe("diagRead", { diagEnum: d }, TIMEOUTS.probe, d)),
    );
  steps.push({
    id: "sd-05-u34-diag-get",
    title: "U34 get, no viewport: diagRead by SCR_DebugMenuID name",
    risk: "read-only",
    answers: ["P-U34"],
    timeout_ms: DIAG_ENUMS.length * (TIMEOUTS.probe + HELPER.windows),
    expected: "values, or the engine's answer for an id not registered in edit mode [unverified]",
    kill_criterion: `a call unanswered within its timeout: stop; the modal check; ${AUTH_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: [],
    plan: () => diagPlan("sd-05-u34-diag-get"),
    run: async (ctx) => {
      const per = await diagReads(ctx, "diagRead");
      return {
        status: "observed",
        summary: `${per.filter((x) => x.ok).length} of ${per.length} answered`,
        data: { reads: per },
      };
    },
  });

  const layerAnswers = ["P-U17", E("world-editor-L479"), E("mcp-inventory-L352")];
  const layerSpec = probe(
    "layerRead",
    { subScene: -1 },
    TIMEOUTS.probe,
    "layerRead, current sub-scene",
  );
  const terrainSpec = probe(
    "terrainFacts",
    { terrainIndex: 0 },
    TIMEOUTS.probe,
    "terrainFacts, terrain 0",
  );
  const layerStep = (id: string, title: string, risk: RiskClass, world: boolean): StepDef => ({
    id,
    title,
    risk,
    answers: layerAnswers,
    timeout_ms: pagedMs(TIMEOUTS.probe) + TIMEOUTS.probe + HELPER.windows,
    expected: world
      ? "folders, layer ids and visibility of the open world; terrain facts or 'no terrain'"
      : "the no-world branch of each: a Fail message or empty facts (recorded)",
    kill_criterion: `a call unanswered within its timeout: stop; the modal check; ${AUTH_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: [],
    ...(world
      ? {
          skipWhen: {
            condition: "sd-15 did not open the packed world (skipped, failed or stopped)",
            carried_to: "S-E (createSandboxWorlds)",
          },
          skip: (ctx: SdContext) =>
            priorStatus(ctx, "sd-15-world-open") === "pass"
              ? null
              : "sd-15 did not pass: no world is open",
        }
      : {}),
    plan: () => [...pagedPlan(id, layerAnswers, layerSpec), net(id, layerAnswers, terrainSpec)],
    run: async (ctx) => {
      const layers = await paged(ctx, layerSpec, "layerRead");
      const t = await ctx.call(terrainSpec);
      await ctx.modalCheck("terrainFacts");
      return {
        status: "observed",
        summary: `layerRead ${probeStatus(layers[0].response) ?? layers[0].error}; terrainFacts ${probeStatus(t.response) ?? t.error}`,
        data: {
          layers: layers.map(summarizeCall),
          terrain: { facts: probeFacts(t.response), ...summarizeCall(t) },
        },
      };
    },
  });
  steps.push(
    layerStep(
      "sd-06-u17-layer-noworld",
      "U17 read half with no world: layerRead and terrainFacts",
      "read-only",
      false,
    ),
  );

  // U5: every eval call is promptable, every eval step a block of its own.
  const evalStep = (
    id: string,
    title: string,
    answers: string[],
    texts: readonly string[],
    expected: string,
    verdict: (
      rows: Array<{ text: string; facts: Record<string, string>; status: string | null }>,
    ) => {
      status: StepStatus;
      summary: string;
    },
  ): StepDef => ({
    id,
    title,
    risk: "read-only",
    answers,
    canPrompt: true,
    timeout_ms: texts.length * promptMs(TIMEOUTS.probe),
    expected,
    kill_criterion: `${AUTH_KILL}; a VME or error dialog after a call: stop`,
    side_effects: [],
    rollback: "none needed; a compiled snippet only returns a string",
    outline: ["each evalCompile in a detached child; the parent polls the window list every 5 s"],
    plan: () =>
      texts.map((t, i) =>
        net(
          id,
          answers,
          probe("evalCompile", { text: t }, TIMEOUTS.probe, `text ${i + 1} of ${texts.length}`),
          {
            detached: true,
          },
        ),
      ),
    run: async (ctx) => {
      const rows: Array<{
        text: string;
        facts: Record<string, string>;
        status: string | null;
        call: unknown;
      }> = [];
      for (let i = 0; i < texts.length; i++) {
        const r = await ctx.promptable(
          probe("evalCompile", { text: texts[i] }, TIMEOUTS.probe),
          `${id}-${i + 1}`,
        );
        await ctx.modalCheck(`evalCompile ${i + 1}`);
        rows.push({
          text: texts[i],
          facts: probeFacts(r.response),
          status: probeStatus(r.response),
          call: summarizeCall(r),
        });
      }
      const v = verdict(rows);
      return {
        status: v.status,
        summary: `${v.summary}${ctx.state.yesToAll ? "; no-prompt results void for U27 (Yes to All was clicked earlier)" : ""}`,
        data: { rows, u27Void: ctx.state.yesToAll },
      };
    },
  });
  steps.push(
    evalStep(
      "sd-07-u5-eval-ok",
      "U5 first eval: evalCompile on the trivial text (may be the call that prompts)",
      ["P-U5", "P-U27"],
      [EVAL_OK],
      'compiled true, called true, result "ok" (U5 yes); compiled false with errorText (U5 no, the reason recorded)',
      (rows) => {
        const f = rows[0].facts;
        return f.compiled === "true" && f.called === "true" && f.result === "ok"
          ? { status: "observed", summary: "U5 yes: compiled, called, ok" }
          : { status: "observed", summary: `U5 no: ${rows[0].status} ${f.errorText ?? ""}`.trim() };
      },
    ),
  );
  steps.push(
    evalStep(
      "sd-08-u5-screen",
      "U5 screen: three texts the Enforce allow screen must refuse without compiling",
      ["P-U5"],
      EVAL_REFUSED,
      "status refused for all three (the Enforce screen agrees with its TypeScript model in probe-pack.test.ts)",
      (rows) => {
        const compiled = rows.filter((r) => r.status !== "refused");
        if (compiled.length) {
          throw new StopSession(
            "kill",
            `the allow screen did not refuse ${compiled.length} text(s) its model refuses: the Enforce screen is not its model; no more eval in S-D`,
          );
        }
        return { status: "pass", summary: "all three refused without compiling" };
      },
    ),
  );
  steps.push(
    evalStep(
      "sd-09-u5-reach",
      "U5 reach: the project file, the loaded addon count, the World Editor sub-scene count, one syntax error",
      ["P-U5", "P-U27"],
      EVAL_REACH,
      "answers for the three; the syntax error returns compiled false with errorText and errorLine and no dialog",
      (rows) => {
        const last = rows[rows.length - 1].facts;
        return {
          status: "observed",
          summary: `${rows.slice(0, -1).filter((r) => r.facts.called === "true").length} of ${rows.length - 1} called; syntax error compiled ${last.compiled ?? "?"}, line ${last.errorLine ?? "?"}`,
        };
      },
    ),
  );

  const loadStep = (
    id: string,
    title: string,
    answers: string[],
    paths: readonly string[],
    expected: string,
  ): StepDef => ({
    id,
    title,
    risk: "read-only",
    answers,
    canPrompt: true,
    timeout_ms: paths.length * promptMs(TIMEOUTS.container),
    expected,
    kill_criterion: AUTH_KILL,
    side_effects: [],
    rollback: "none needed; nothing is saved",
    outline: ["each loadContainer in a detached child; the parent polls the window list every 5 s"],
    plan: () =>
      paths.map((p) =>
        net(
          id,
          answers,
          probe("loadContainer", { path: p, depth: 2, page: 0 }, TIMEOUTS.container, p),
          { detached: true },
        ),
      ),
    run: async (ctx) => {
      const per: Array<Record<string, unknown>> = [];
      for (let i = 0; i < paths.length; i++) {
        const r = await ctx.promptable(
          probe("loadContainer", { path: paths[i], depth: 2, page: 0 }, TIMEOUTS.container),
          `${id}-${i + 1}`,
        );
        await ctx.modalCheck(`loadContainer ${paths[i]}`);
        per.push({
          path: paths[i],
          status: probeStatus(r.response),
          facts: probeFacts(r.response),
          ...summarizeCall(r),
        });
      }
      return {
        status: "observed",
        summary: per
          .map((x) => `${String(x.path).replace(/^.*\./, ".")} ${x.status ?? x.error}`)
          .join(", "),
        data: { loads: per, u27Void: ctx.state.yesToAll },
      };
    },
  });
  steps.push(
    loadStep(
      "sd-10a-u16-load-first",
      "U16 read, first loadContainer (may be the call that prompts): configs/inputCommon.conf",
      ["P-U16", "P-U27"],
      [VANILLA.conf],
      "a container dump, never saved",
    ),
  );
  steps.push(
    loadStep(
      "sd-10b-u16-load-rest",
      "U16 read: loadContainer on one .emat, .layout, .agr, .bt, .ptc and .acp",
      ["P-U16", E("anim-procanim-behavior-L417"), "P-U27"],
      LOAD_REST,
      "per type: a container class and variables, or null (recorded)",
    ),
  );

  const u30 = ["P-U30"];
  steps.push({
    id: "sd-11-u30-rerun",
    title:
      "U30 re-run (DEC-040): seven sockets opened and written within the same tick, no stagger",
    risk: "read-only",
    answers: u30,
    timeout_ms: TIMEOUTS.cheap + TIMEOUTS.heavy + 4 * TIMEOUTS.heavy + TIMEOUTS.cheap,
    expected:
      "[unverified] start and end per call and the completion order show whether two calls were in flight together and whether the queue serves them serially",
    kill_criterion:
      "every burst call has max(120 s, 4 x the single GetGameMaterials time) to answer, at most 1200 s; any unanswered then, or the IsWorkbenchRunning after it unanswered in 10 s: stop (no retry). A connection closed without an answer is a drop: recorded",
    side_effects: ["the NET queue is busy for the two heavy calls"],
    rollback: "none needed; nothing is written",
    skipWhen: {
      condition:
        "--u30-rerun not given (P-U30 is scheduled to S-D, seq 600; the re-run needs the flag)",
      carried_to: "S-D with the flag, or Phase 3",
    },
    skip: (ctx) => (ctx.opts.u30Rerun ? null : "--u30-rerun not given"),
    outline: [
      "one EMCP_WB_Ping, one GetGameMaterials (the heavy baseline of this process)",
      "then 2 x GetGameMaterials and 5 x EMCP_WB_Ping, all seven sockets opened and written within the same tick (no stagger)",
      "then one IsWorkbenchRunning",
    ],
    plan: (p) =>
      p.u30Rerun
        ? [
            net("sd-11-u30-rerun", u30, {
              apiFunc: "EMCP_WB_Ping",
              params: {},
              timeoutMs: TIMEOUTS.cheap,
              note: "baseline",
            }),
            net("sd-11-u30-rerun", u30, {
              apiFunc: "GetGameMaterials",
              params: {},
              timeoutMs: TIMEOUTS.heavy,
              note: "heavy baseline",
            }),
            ...[0, 1].map((i) =>
              net(
                "sd-11-u30-rerun",
                u30,
                {
                  apiFunc: "GetGameMaterials",
                  params: {},
                  timeoutMs: 4 * TIMEOUTS.heavy,
                  note: `heavy ${i + 1}`,
                },
                { concurrent: true },
              ),
            ),
            ...[0, 1, 2, 3, 4].map((i) =>
              net(
                "sd-11-u30-rerun",
                u30,
                {
                  apiFunc: "EMCP_WB_Ping",
                  params: {},
                  timeoutMs: 4 * TIMEOUTS.heavy,
                  note: `cheap ${i + 1}`,
                },
                { concurrent: true },
              ),
            ),
            net("sd-11-u30-rerun", u30, {
              apiFunc: "IsWorkbenchRunning",
              params: {},
              timeoutMs: TIMEOUTS.cheap,
              note: "queue alive after",
            }),
          ]
        : [],
    run: async (ctx) => {
      const base = await ctx.call({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      const heavy = await ctx.call({
        apiFunc: "GetGameMaterials",
        params: {},
        timeoutMs: TIMEOUTS.heavy,
      });
      const perCall = burstPerCallMs(heavy.ok ? heavy.durationMs : null);
      const specs: CallSpec[] = [
        ...[0, 1].map((i) => ({
          apiFunc: "GetGameMaterials",
          params: {},
          timeoutMs: perCall,
          note: `heavy ${i + 1}`,
        })),
        ...[0, 1, 2, 3, 4].map((i) => ({
          apiFunc: "EMCP_WB_Ping",
          params: {},
          timeoutMs: perCall,
          note: `cheap ${i + 1}`,
        })),
      ];
      const results = await ctx.burst(specs);
      const after = await ctx.call({
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      const rows = ctx.calls.slice(-1 - specs.length, -1).map((c) => ({
        apiFunc: c.apiFunc,
        note: c.note,
        startedAt: c.startedAt,
        endedAt: c.startedAt + c.result.durationMs,
        ...summarizeCall(c.result),
        ok: c.result.ok,
      }));
      // The signal (m5): every burst call starts in the same tick, so time overlap on the client
      // says nothing. What says something about the queue: a cheap call that ENDED before a heavy
      // call that started in the same tick (the heavy call did not hold the queue the whole time).
      const heavyRows = rows.filter((r) => r.apiFunc === "GetGameMaterials" && r.ok);
      const cheapRows = rows.filter((r) => r.apiFunc === "EMCP_WB_Ping" && r.ok);
      const startSpreadMs = rows.length
        ? Math.max(...rows.map((r) => r.startedAt)) - Math.min(...rows.map((r) => r.startedAt))
        : 0;
      const cheapBeforeHeavy = cheapRows
        .filter((c) => heavyRows.some((h) => c.endedAt < h.endedAt))
        .map((c) => c.note);
      const drops = results.filter(
        (r) => !r.ok && /closed without a response/.test(r.error ?? ""),
      ).length;
      const signal = cheapBeforeHeavy.length
        ? `a cheap call ended before a heavy call that started in the same tick: yes (${cheapBeforeHeavy.join(", ")}; start spread ${startSpreadMs} ms)`
        : `a cheap call ended before a heavy call that started in the same tick: no (start spread ${startSpreadMs} ms)`;
      return {
        status: "observed",
        summary: `${results.filter((r) => r.ok).length} of ${results.length} answered, ${drops} dropped; ${signal}; queue alive after: ${after.ok}`,
        data: {
          baselinePing: summarizeCall(base),
          heavyBaseline: summarizeCall(heavy),
          perCallTimeoutMs: perCall,
          stagger: 0,
          burst: rows,
          completionOrder: [...rows].sort((a, b) => a.endedAt - b.endedAt).map((r) => r.note),
          startSpreadMs,
          cheapEndedBeforeHeavy: cheapBeforeHeavy,
          signal,
          after: summarizeCall(after),
        },
      };
    },
  });

  // ── reversible ────────────────────────────────────────────────────────────
  const moduleAnswers = (name: string): string[] => {
    const out = [...u8Base];
    if (["AnimEditor", "BehaviorEditor", "ProcAnimEditor"].includes(name)) {
      out.push(
        E("anim-procanim-behavior-L406"),
        E("anim-procanim-behavior-L407"),
        E("anim-procanim-behavior-L408"),
        E("anim-procanim-behavior-L479"),
      );
    }
    if (name === "AudioEditor") {
      out.push(
        E("audio-particle-navmesh-L486"),
        E("audio-particle-navmesh-L487"),
        E("audio-particle-navmesh-L488"),
      );
    }
    if (name === "ParticleEditor") out.push(E("audio-particle-navmesh-L501"));
    if (name === "ResourceManager") out.push(E("resource-manager-L671"));
    if (name === "ScriptEditor") out.push(E("script-string-dialogue-L411"));
    return out;
  };
  for (const m of MODULES) {
    const id = `sd-12-u8-${m.name}`;
    const answers = moduleAnswers(m.name);
    const openSpec = probe(
      "moduleMatrix",
      { openModules: true, moduleName: m.name },
      TIMEOUTS.moduleOpen,
      `open ${m.name}`,
    );
    const dumpSpec = probe(
      "containerDump",
      { moduleName: m.name, index: 0, depth: 2, page: 0 },
      TIMEOUTS.container,
      "container 0",
    );
    const expectedWin = (w: WindowInfo): boolean =>
      titleNames(w, m.name) || (m.doc !== null && titleNames(w, m.doc));
    steps.push({
      id,
      title: `U8 ${m.name}: open the module${m.doc ? `, open ${m.doc}` : ""}, read its containers`,
      risk: "reversible",
      answers,
      timeout_ms:
        TIMEOUTS.moduleOpen +
        HELPER.windows +
        (m.doc ? TIMEOUTS.openDoc + HELPER.windows : 0) +
        pagedMs(TIMEOUTS.probe) +
        TIMEOUTS.container +
        HELPER.windows,
      expected: `the module's open result (GetModule before and after OpenModule), GetNumContainers and class names${m.doc ? " with the document open" : ""}`,
      kill_criterion: `a call unanswered within its timeout: stop; the modal check (any dialog, e.g. a first-run dialog of the module): stop; ${AUTH_KILL}`,
      side_effects: [
        `opens the ${m.name} module window${m.doc ? ` and the vanilla ${m.doc}, never saved` : ""}`,
      ],
      rollback:
        "none needed: nothing is edited or saved; the post-flight graceful close ends the windows (a save prompt there is a hazard, never answered; the owner clicks Don't Save)",
      outline: [
        `after each call: list the Workbench windows (modal check; a new window naming ${m.name}${m.doc ? " or the document" : ""} is expected)`,
      ],
      plan: () => [
        net(id, answers, { ...openSpec, params: { ...openSpec.params, page: 0 } }),
        ...(m.doc
          ? [
              net(id, answers, {
                apiFunc: "OpenResource",
                params: { ResourceName: m.doc },
                timeoutMs: TIMEOUTS.openDoc,
              }),
            ]
          : []),
        ...pagedPlan(id, answers, probe("moduleMatrix", {}, TIMEOUTS.probe, "moduleMatrix again")),
        net(id, answers, dumpSpec),
      ],
      run: async (ctx) => {
        const opened = await ctx.call({ ...openSpec, params: { ...openSpec.params, page: 0 } });
        await ctx.modalCheck(`open ${m.name}`, expectedWin);
        let doc: RawCallResult | null = null;
        if (m.doc) {
          doc = await ctx.call({
            apiFunc: "OpenResource",
            params: { ResourceName: m.doc },
            timeoutMs: TIMEOUTS.openDoc,
          });
          await ctx.modalCheck(`OpenResource ${m.doc}`, expectedWin);
        }
        const again = await paged(
          ctx,
          probe("moduleMatrix", {}, TIMEOUTS.probe),
          "moduleMatrix again",
          expectedWin,
        );
        const dump = await ctx.call(dumpSpec);
        await ctx.modalCheck("containerDump", expectedWin);
        return {
          status: "observed",
          summary: `open ${probeStatus(opened.response) ?? opened.error}${doc ? `; OpenResource ${JSON.stringify(field(doc.response, "Opened") ?? doc.error)}` : ""}; containerDump ${probeStatus(dump.response) ?? dump.error}`,
          data: {
            module: m.name,
            document: m.doc,
            open: { facts: probeFacts(opened.response), ...summarizeCall(opened) },
            openResource: doc ? summarizeCall(doc) : null,
            matrix: again.map(summarizeCall),
            containerDump: { facts: probeFacts(dump.response), ...summarizeCall(dump) },
          },
        };
      },
    });
  }

  steps.push({
    id: "sd-13-u34-diag-select",
    title: `U34 select: diagRead with diagMenu "${DIAG_MENU}" (SelectMenuByName), then sd-05's reads again`,
    risk: "reversible",
    answers: ["P-U34"],
    timeout_ms: (1 + DIAG_ENUMS.length) * (TIMEOUTS.probe + HELPER.windows),
    expected: "the selection answered; the values recorded; the selection changed in memory only",
    kill_criterion: `a call unanswered within its timeout: stop; the modal check; ${AUTH_KILL}`,
    side_effects: ["changes the diag menu selection (in memory)"],
    rollback: "none needed; the process's end resets it",
    outline: [],
    plan: () => [
      net(
        "sd-13-u34-diag-select",
        ["P-U34"],
        probe("diagRead", { diagMenu: DIAG_MENU }, TIMEOUTS.probe, "select"),
      ),
      ...diagPlan("sd-13-u34-diag-select"),
    ],
    run: async (ctx) => {
      const sel = await ctx.call(probe("diagRead", { diagMenu: DIAG_MENU }, TIMEOUTS.probe));
      await ctx.modalCheck("SelectMenuByName");
      const per = await diagReads(ctx, "diagRead after select");
      return {
        status: "observed",
        summary: `select ${probeStatus(sel.response) ?? sel.error}; ${per.filter((x) => x.ok).length} of ${per.length} reads answered`,
        data: { select: { facts: probeFacts(sel.response), ...summarizeCall(sel) }, reads: per },
      };
    },
  });

  const u10 = ["P-U10", E("plugins-netapi-cli-L462"), E("resource-manager-L682")];
  for (const pl of PLUGINS) {
    const id = `sd-14-u10-${pl.className}`;
    // world-editor-L482 asks about the Snap and Orient plugin's Run(): its read half is that step's.
    const answers =
      pl.className === "SCR_SnapAndOrientToTerrainPlugin"
        ? [...u10, E("world-editor-L482")]
        : [...u10];
    const getSpec = probe(
      "getPlugin",
      { moduleName: pl.module, className: pl.className },
      TIMEOUTS.probe,
      "getPlugin",
    );
    const attrSpec = probe(
      "pluginAttrs",
      { moduleName: pl.module, className: pl.className },
      TIMEOUTS.probe,
      "pluginAttrs",
    );
    steps.push({
      id,
      title: `U10: getPlugin and pluginAttrs on ${pl.className} in ${pl.module}; never Run()`,
      risk: "reversible",
      answers,
      timeout_ms:
        HELPER.windows + TIMEOUTS.probe + HELPER.windows + pagedMs(TIMEOUTS.probe) + HELPER.windows,
      expected:
        "an instance or null; attribute names, types and values; which window came to the front (EnumWindows z-order)",
      kill_criterion: `a call unanswered within its timeout: stop; the modal check; ${AUTH_KILL}`,
      side_effects: ["GetPlugin may focus the module window"],
      rollback: "none needed; focus only",
      outline: [
        "list the Workbench windows before and after (the frontmost window of the pid, z-order)",
      ],
      plan: () => [net(id, answers, getSpec), ...pagedPlan(id, answers, attrSpec)],
      run: async (ctx) => {
        const before = frontmost(await ctx.ourWindows(), ctx.state.wbPid!);
        const g = await ctx.call(getSpec);
        await ctx.modalCheck("getPlugin");
        const attrs = await paged(ctx, attrSpec, "pluginAttrs");
        const after = frontmost(await ctx.ourWindows(), ctx.state.wbPid!);
        return {
          status: "observed",
          summary: `getPlugin ${probeStatus(g.response) ?? g.error}; pluginAttrs ${probeStatus(attrs[0].response) ?? attrs[0].error}; front ${before?.title ?? "?"} -> ${after?.title ?? "?"}`,
          data: {
            plugin: pl,
            getPlugin: { facts: probeFacts(g.response), ...summarizeCall(g) },
            attrs: attrs.map(summarizeCall),
            frontBefore: before,
            frontAfter: after,
          },
        };
      },
    });
  }

  steps.push({
    id: "sd-15-world-open",
    title: `Open the packed vanilla world ${VANILLA.world} read-only with the native OpenResource (ruling 3)`,
    risk: "reversible",
    answers: [],
    timeout_ms: TIMEOUTS.openWorld + HELPER.windows + TIMEOUTS.cheap + TIMEOUTS.bohemia,
    expected:
      "Opened true; IsWorldEditorRunning IsRunning true; EMCP_WB_GetState mode edit with entities; the world is never edited or saved",
    kill_criterion: `no answer in 300 s: stop; the modal check (a window naming the world or the World Editor is expected): stop; ${AUTH_KILL}. Opened not true or no world in edit mode: a fail, and sd-16 and sd-18 are skipped`,
    side_effects: ["the World Editor loads a vanilla world into memory (never saved)"],
    rollback:
      "none needed: nothing edits it; the post-flight close may show a save prompt only if something edited it (nothing should): a hazard, never answered",
    outline: [],
    plan: () => [
      net("sd-15-world-open", [], {
        apiFunc: "OpenResource",
        params: { ResourceName: VANILLA.world },
        timeoutMs: TIMEOUTS.openWorld,
      }),
      net("sd-15-world-open", [], {
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
      net("sd-15-world-open", [], {
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      }),
    ],
    run: async (ctx) => {
      const o = await ctx.call({
        apiFunc: "OpenResource",
        params: { ResourceName: VANILLA.world },
        timeoutMs: TIMEOUTS.openWorld,
      });
      await ctx.modalCheck(
        "OpenResource world",
        (w) => titleNames(w, VANILLA.world) || titleNames(w, "WorldEditor"),
      );
      const we = await ctx.call({
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      const st = await ctx.call({
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      });
      const opened = field(o.response, "Opened") === true;
      const inEdit =
        field(st.response, "mode") === "edit" && Number(field(st.response, "entityCount") ?? 0) > 0;
      return {
        status: opened && inEdit ? "pass" : "fail",
        summary: `Opened ${JSON.stringify(field(o.response, "Opened") ?? o.error)}; mode ${JSON.stringify(field(st.response, "mode") ?? st.error)}, ${field(st.response, "entityCount") ?? "?"} entities`,
        data: {
          openResource: summarizeCall(o),
          isWorldEditorRunning: summarizeCall(we),
          state: summarizeCall(st),
        },
      };
    },
  });
  steps.push(
    layerStep(
      "sd-16-u17-layer-world",
      "U17 read half on the open world: layerRead and terrainFacts",
      "reversible",
      true,
    ),
  );

  const toolSpec = probe("toolInstance", { className: TOOL_CLASS }, TIMEOUTS.probe, "toolInstance");
  steps.push({
    id: "sd-17-u10-tool",
    title: `U10 tool: toolInstance ${TOOL_CLASS} twice (the current tool name before and after)`,
    risk: "reversible",
    answers: ["P-U10", E("world-editor-L481")],
    timeout_ms: 2 * (TIMEOUTS.probe + HELPER.windows),
    expected:
      "what GetPlugin returns for a tool type; whether the current tool changed between the two calls",
    kill_criterion: `a call unanswered within its timeout: stop; the modal check; ${AUTH_KILL}`,
    side_effects: ["may focus the World Editor or activate the tool [unverified]"],
    rollback: "none needed; in memory only",
    outline: [],
    plan: () => [
      net("sd-17-u10-tool", ["P-U10", E("world-editor-L481")], toolSpec),
      net("sd-17-u10-tool", ["P-U10", E("world-editor-L481")], toolSpec),
    ],
    run: async (ctx) => {
      const a = await ctx.call(toolSpec);
      await ctx.modalCheck("toolInstance 1");
      const b = await ctx.call(toolSpec);
      await ctx.modalCheck("toolInstance 2");
      const fa = probeFacts(a.response);
      const fb = probeFacts(b.response);
      return {
        status: "observed",
        summary: `returned ${fa.returned ?? a.error}; current tool ${fa.currentToolName ?? "?"} -> ${fb.currentToolName ?? "?"}`,
        data: {
          first: { facts: fa, ...summarizeCall(a) },
          second: { facts: fb, ...summarizeCall(b) },
        },
      };
    },
  });

  steps.push({
    id: "sd-18-u34-diag-viewport",
    title: "U34 with a viewport: sd-05's reads again with the world open",
    risk: "reversible",
    answers: ["P-U34"],
    timeout_ms: DIAG_ENUMS.length * (TIMEOUTS.probe + HELPER.windows),
    expected: "values recorded (the wiki puts the Diag Menu in a viewport)",
    kill_criterion: `a call unanswered within its timeout: stop; the modal check; ${AUTH_KILL}`,
    side_effects: [],
    rollback: "none needed",
    skipWhen: {
      condition: "sd-15 did not open the packed world",
      carried_to: "S-E (createSandboxWorlds)",
    },
    skip: (ctx) =>
      priorStatus(ctx, "sd-15-world-open") === "pass" ? null : "sd-15 did not pass: no viewport",
    outline: [],
    plan: () => diagPlan("sd-18-u34-diag-viewport"),
    run: async (ctx) => {
      const per = await diagReads(ctx, "diagRead viewport");
      return {
        status: "observed",
        summary: `${per.filter((x) => x.ok).length} of ${per.length} answered`,
        data: { reads: per },
      };
    },
  });

  // U9: allow-listed dock toggles only, each path twice (toggle, toggle back), checked restored.
  const u9a = [
    "P-U9",
    E("gui-census-feasibility-L673"),
    E("gui-census-feasibility-L674"),
    E("gui-census-feasibility-L678"),
  ];
  const u9b = ["P-U9", E("gui-census-feasibility-L676")];
  const execSpec = (module: string, path: readonly string[], keepFocus: boolean): CallSpec =>
    probe(
      "executeAction",
      { moduleName: module, menuPath: [...path], keepFocus },
      TIMEOUTS.probe,
      `${path.join(" > ")} keepFocus ${keepFocus}`,
    );
  const pairPlan = (
    id: string,
    answers: string[],
    module: string,
    path: readonly string[],
    keepFocus: boolean,
    walker: boolean,
  ): PlanAction[] => [
    ...(walker ? [walkAction(id, answers, module)] : []),
    execAction(id, answers, path, module),
    net(id, answers, execSpec(module, path, keepFocus)),
    execAction(id, answers, path, module),
    net(id, answers, { ...execSpec(module, path, keepFocus), note: "toggle back" }),
    ...(walker ? [walkAction(id, answers, module)] : []),
  ];
  // Two calls with their modal checks, two window lists, two walks of the window, their window lists.
  const pairMs =
    2 * (TIMEOUTS.probe + HELPER.windows) +
    2 * HELPER.windows +
    2 * (TIMEOUTS.dockWalk + HELPER.windows);
  /** One toggle and its toggle back; the dock is checked restored by the window list (and the walker). */
  const togglePair = async (
    ctx: SdContext,
    module: string,
    path: readonly string[],
    keepFocus: boolean,
    label: string,
  ): Promise<Record<string, unknown>> => {
    if (!allowListed(ctx.opts.policy, path) || isNeverPath(path)) {
      return {
        path: path.join(" > "),
        skipped: "not on execute_action.allow_list (or Edit > Undo, never called)",
      };
    }
    const sig = (ws: WindowInfo[]): string =>
      ws
        .map((w) => `${w.hwnd}:${w.enabled}:${w.title}`)
        .sort()
        .join("|");
    const walk = async (tag: string): Promise<number | null> => {
      if (!ctx.opts.walkerCmd) return null;
      const ws = await ctx.ourWindows();
      const win =
        module === "WorldEditor"
          ? worldEditorWindow(ws, ctx.state.wbPid!)
          : (ws.find((w) => w.owner === 0) ?? null);
      if (!win) return null;
      const out = join(ctx.opts.runDir, `u9-${label}-${tag}-${ctx.opts.nonce}.json`);
      const argv = walkerArgv(ctx.opts.walkerCmd, {
        pid: ctx.state.wbPid!,
        out,
        className: win.className,
        title: win.title,
        label: `u9-${label}-${tag}`,
        tsx: TSX_IMPORT,
      });
      const r = await ctx.deps.runWalker(argv, TIMEOUTS.dockWalk);
      if (r.timedOut)
        throw new StopSession(
          "timeout",
          `the walker ran past ${TIMEOUTS.dockWalk} ms (not retried)`,
        );
      try {
        const s = r.lastLine ? (JSON.parse(r.lastLine) as { nodes?: unknown }) : null;
        return typeof s?.nodes === "number" ? s.nodes : null;
      } catch {
        return null;
      }
    };
    const dockName = path[path.length - 1];
    const accept = (w: WindowInfo): boolean => titleNames(w, dockName);
    const nodesBefore = await walk("before");
    const before = await ctx.ourWindows();
    const first = await ctx.call(execSpec(module, path, keepFocus));
    await ctx.modalCheck(`${path.join(" > ")} toggle`, accept);
    const toggled = probeFacts(first.response).result === "true";
    let back: RawCallResult | null = null;
    if (toggled) {
      back = await ctx.call({ ...execSpec(module, path, keepFocus), note: "toggle back" });
      await ctx.modalCheck(`${path.join(" > ")} toggle back`, accept);
    }
    const after = await ctx.ourWindows();
    const nodesAfter = await walk("after");
    const restoredWin32 = sig(before) === sig(after);
    const restoredUia =
      nodesBefore === null || nodesAfter === null ? null : nodesBefore === nodesAfter;
    if (!restoredWin32 || restoredUia === false) {
      throw new StopSession(
        "kill",
        `the dock ${path.join(" > ")} is not restored after its pair (window list ${restoredWin32 ? "same" : "changed"}${restoredUia === false ? `, walk nodes ${nodesBefore} -> ${nodesAfter}` : ""}): nothing more is toggled`,
      );
    }
    return {
      path: path.join(" > "),
      keepFocus,
      first: { facts: probeFacts(first.response), ...summarizeCall(first) },
      back: back ? { facts: probeFacts(back.response), ...summarizeCall(back) } : null,
      restoredWin32,
      restoredUia,
      nodesBefore,
      nodesAfter,
    };
  };
  const windowPathsOf = (policy: CensusPolicy): string[][] =>
    WINDOW_PATHS.filter((p) => allowListed(policy, p)).map((p) => [...p]);
  steps.push({
    id: "sd-19a-u9-worldeditor",
    title:
      "U9 World Editor: each allow-listed Window dock path twice (toggle, toggle back), keepFocus true, and false for the first",
    risk: "reversible",
    answers: u9a,
    timeout_ms: (WINDOW_PATHS.length + 1) * pairMs,
    expected:
      "return values per path and spelling (mnemonic and case variants only where listed); the dock restored after each pair (Win32 window list equal, and the walk's node count equal with --walker-cmd)",
    kill_criterion: `a call unanswered within its timeout: stop; the modal check; a dock not restored after its pair: stop; ${AUTH_KILL}`,
    side_effects: ["toggles a dock twice per pair; the layout lands in the scratch ini only"],
    rollback:
      "each pair toggles back and is checked; a dock left changed is a stop for the main session",
    skipWhen: {
      condition: "no World Editor Window path of WINDOW_PATHS is on execute_action.allow_list",
      carried_to: "the next sitting after the main session lists the dock paths",
    },
    skip: (ctx) =>
      windowPathsOf(ctx.opts.policy).length
        ? null
        : "no Window dock path is on execute_action.allow_list",
    outline: [
      "only paths on execute_action.allow_list are sent; Edit > Undo is never sent (ruling 7)",
      "the second call of a pair runs only when the first returned result true",
      "with --walker-cmd: a passive walk of the World Editor window before and after each pair",
    ],
    plan: (p) =>
      p.windowPaths.flatMap((path, i) => [
        ...pairPlan("sd-19a-u9-worldeditor", u9a, "WorldEditor", path, true, p.walker),
        ...(i === 0
          ? pairPlan("sd-19a-u9-worldeditor", u9a, "WorldEditor", path, false, p.walker)
          : []),
      ]),
    run: async (ctx) => {
      const pairs: Array<Record<string, unknown>> = [];
      const paths = windowPathsOf(ctx.opts.policy);
      for (let i = 0; i < paths.length; i++) {
        pairs.push(await togglePair(ctx, "WorldEditor", paths[i], true, `we${i}t`));
        if (i === 0) pairs.push(await togglePair(ctx, "WorldEditor", paths[i], false, `we${i}f`));
      }
      return {
        status: "observed",
        summary: `${pairs.length} pair(s); every dock restored`,
        data: { pairs },
      };
    },
  });
  steps.push({
    id: "sd-19b-u9-resourcemanager",
    title: `U9 open versus focused: ${RM_DOCK_PATH.join(" > ")} on the Resource Manager module while the World Editor is in front, then while the Resource Manager is`,
    risk: "reversible",
    answers: u9b,
    timeout_ms: 2 * (TIMEOUTS.cheap + HELPER.windows) + 2 * pairMs,
    expected:
      "return values and the frontmost window for each pair (L676: open, focused or just instantiated)",
    kill_criterion: `as sd-19a; ${AUTH_KILL}`,
    side_effects: ["BringModuleWindowToFront twice; toggles a dock twice per pair"],
    rollback: "each pair toggles back and is checked",
    skipWhen: {
      condition: `${RM_DOCK_PATH.join(" > ")} is not on execute_action.allow_list`,
      carried_to: "the Phase 4 L09 battery",
    },
    skip: (ctx) =>
      allowListed(ctx.opts.policy, RM_DOCK_PATH)
        ? null
        : `${RM_DOCK_PATH.join(" > ")} is not on execute_action.allow_list`,
    outline: [
      "BringModuleWindowToFront (native) names the module to put in front before each pair",
    ],
    plan: (p) =>
      p.rmDockAllowed
        ? ["WorldEditor", "ResourceManager"].flatMap((front) => [
            net("sd-19b-u9-resourcemanager", u9b, {
              apiFunc: "BringModuleWindowToFront",
              params: { ModuleName: front },
              timeoutMs: TIMEOUTS.cheap,
            }),
            ...pairPlan(
              "sd-19b-u9-resourcemanager",
              u9b,
              "ResourceManager",
              RM_DOCK_PATH,
              true,
              p.walker,
            ),
          ])
        : [],
    run: async (ctx) => {
      const pairs: Array<Record<string, unknown>> = [];
      for (const front of ["WorldEditor", "ResourceManager"]) {
        const b = await ctx.call({
          apiFunc: "BringModuleWindowToFront",
          params: { ModuleName: front },
          timeoutMs: TIMEOUTS.cheap,
        });
        await ctx.modalCheck(`BringModuleWindowToFront ${front}`, (w) => titleNames(w, front));
        const f = frontmost(await ctx.ourWindows(), ctx.state.wbPid!);
        pairs.push({
          front,
          bring: summarizeCall(b),
          frontmost: f,
          ...(await togglePair(ctx, "ResourceManager", RM_DOCK_PATH, true, `rm-${front}`)),
        });
      }
      return {
        status: "observed",
        summary: `${pairs.length} pairs; every dock restored`,
        data: { pairs },
      };
    },
  });

  // ── mutating ──────────────────────────────────────────────────────────────
  const shotStep = (
    id: string,
    plantId: (typeof SHOT_PLANTS)[number],
    label: string,
    answers: string[],
    second: boolean,
  ): StepDef => ({
    id,
    title: `U28 screenshot ${second ? "(second call, after a prompt on the first)" : "(may be the call that prompts)"}: System.MakeScreenshot into <sandbox>/${THROWAWAY}/${label}-<nonce>.bmp`,
    risk: "mutating",
    answers,
    canPrompt: true,
    timeout_ms: HELPER.windows + promptMs(TIMEOUTS.probe) + 2 * HELPER.process,
    expected:
      "written true and a BMP of the viewport (U28 yes), or false or a blank image (U28 no: PrintWindow or computer-use)",
    kill_criterion: `${AUTH_KILL}. After such a handoff the BMP can still land once the owner clicks: the next screenshot step, sd-21 and the rollback subcommand settle it. The BMP still in ${THROWAWAY}/ after its removal, or a file in ${THROWAWAY}/ the run did not write: stop`,
    side_effects: [
      `one BMP under <sandbox>/${THROWAWAY}/ (and the folder, when the step creates it), removed by the step`,
    ],
    rollback: `plant-${plantId}.json first; the BMP copied into the run folder (u28-<file>), deleted by its hash, ${THROWAWAY}/ removed when the step created it and it is empty; rollback-${plantId}.json written. After a handoff or a stop (the child may still write it): settled at the next step whose child answered, or by the rollback subcommand once no Workbench runs`,
    ...(second
      ? {
          skipWhen: {
            condition: "sd-20a answered without a prompt (sd-20b would repeat nothing)",
            carried_to: "nothing: sd-20a answered U28",
          },
          skip: (ctx: SdContext) =>
            priorStatus(ctx, "sd-20a-u28-screenshot") === "handoff"
              ? null
              : "sd-20a did not stop on a prompt: nothing to repeat",
        }
      : {}),
    outline: [
      `write plant-${plantId}.json (folder, file, whether ${THROWAWAY}/ existed); create ${THROWAWAY}/ when absent`,
      "screenshot in a detached child; the parent polls the window list every 5 s",
      "copy the BMP into the run folder, delete it by its hash, remove the folder the step created, write the rollback record",
    ],
    plan: (p) => [
      net(
        id,
        answers,
        probe(
          "screenshot",
          { folder: THROWAWAY, path: screenshotName(label, p.nonce) },
          TIMEOUTS.probe,
        ),
        { detached: true },
      ),
    ],
    run: async (ctx) => {
      const late = settleLateShots(ctx);
      const dir = join(ctx.opts.sandboxDir, THROWAWAY);
      const file = screenshotName(label, ctx.opts.nonce);
      if (!insideDir(ctx.opts.sandboxDir, join(dir, file))) {
        throw new StopSession("kill", "the screenshot target would land outside the sandbox");
      }
      if (ctx.deps.fileExists(join(dir, file))) {
        throw new StopSession(
          "kill",
          `${file} exists already in ${THROWAWAY}/: a new --nonce is needed`,
        );
      }
      const resultName = `child-${id}-${ctx.opts.nonce}.json`;
      const plant: ShotPlant = {
        step: id,
        folder: THROWAWAY,
        file,
        folderExisted: ctx.deps.fileExists(dir),
        resultName,
      };
      ctx.deps.writeArtifact(`plant-${plantId}.json`, plant);
      if (!plant.folderExisted) ctx.deps.makeDir(dir);
      // The plant is settled only once the call has returned. After a handoff, a timeout or a
      // dialog the child still runs and can write the BMP later: the plant stays open for the next
      // step whose child has answered, or for the rollback subcommand once no Workbench runs.
      const r = await ctx.promptable(
        probe("screenshot", { folder: THROWAWAY, path: file }, TIMEOUTS.probe),
        id,
      );
      // M4: settled only on an ok answer; a failed call leaves the plant open for `rollback`.
      const leftOpen = settlesPlant(r)
        ? null
        : plantLeftOpen(plantId, `the call answered ${r.error ?? "not ok"}`);
      if (!leftOpen) settleShot(ctx, plantId, plant);
      await ctx.modalCheck("screenshot");
      const settled = runJson<{ landed?: boolean; sha256?: string | null; bytes?: number }>(
        ctx,
        `rollback-${plantId}.json`,
      );
      const f = probeFacts(r.response);
      return {
        status: "observed",
        summary: `screenshot ${probeStatus(r.response) ?? r.error}, written ${f.written ?? "?"}; BMP ${leftOpen ?? (settled?.landed ? `${settled.bytes} bytes copied and removed` : "not found")}${lateClause(late)}${ctx.state.yesToAll ? "; void for U27 (Yes to All earlier)" : ""}`,
        data: {
          file,
          facts: f,
          call: summarizeCall(r),
          bmp: settled,
          plantLeftOpen: leftOpen,
          lateSettled: late,
          u27Void: ctx.state.yesToAll,
        },
      };
    },
  });
  steps.push(
    shotStep(
      "sd-20a-u28-screenshot",
      "sd-20a",
      "ECEN_SD_U28a",
      ["P-U28", "P-U27", E("world-editor-L487")],
      false,
    ),
  );
  steps.push(shotStep("sd-20b-u28-screenshot", "sd-20b", "ECEN_SD_U28b", ["P-U28", "P-U27"], true));

  // U6, last: the one step that can wedge the lane (classed mutating for the order rule).
  const u6 = [
    "P-U6",
    "P-U27",
    E("plugins-netapi-cli-L468"),
    E("script-string-dialogue-L414"),
    E("audio-particle-navmesh-L516"),
    E("resource-manager-L648"),
  ];
  const u6After = [
    "P-U6",
    E("script-string-dialogue-L414"),
    E("audio-particle-navmesh-L516"),
    E("resource-manager-L648"),
  ];
  const tenPings = (id: string, probes: string[], note: string): PlanAction[] =>
    Array.from({ length: 10 }, (_, i) =>
      net(id, probes, {
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: `${note} ${i + 1} of 10`,
      }),
    );
  const pings = async (ctx: SdContext): Promise<Array<number | null>> => {
    const out: Array<number | null> = [];
    for (let i = 0; i < 10; i++) {
      const r = await ctx.call({ apiFunc: "EMCP_WB_Ping", params: {}, timeoutMs: TIMEOUTS.cheap });
      out.push(r.ok ? r.durationMs : null);
    }
    return out;
  };
  steps.push({
    id: "sd-21-u6-modal",
    title: `U6 without input: modalTest opens "${MODAL_CAPTION}"; one Ping on a second socket while it is up; handoff for the owner to close it`,
    // Its own effect is a dialog (reversible); classed mutating so it can run after sd-20 (plan 7 puts U4 last).
    risk: "mutating",
    answers: u6,
    timeout_ms:
      10 * TIMEOUTS.cheap +
      stallMs(10) +
      TIMEOUTS.u6DialogWait +
      TIMEOUTS.poll +
      HELPER.windows +
      stallMs(1) +
      HELPER.windows +
      TIMEOUTS.u6PingWatch +
      TIMEOUTS.poll +
      HELPER.windows +
      stallMs(3) +
      HUNG_HELPER_MS +
      2 * HELPER.windows +
      2 * HELPER.process,
    expected:
      "before: 10 Pings and 10 WM_NULL answered; during: the dialog's window (class, title, owner, enabled), the main window disabled or not, IsHungAppWindow, WM_NULL, and whether the second-socket Ping answers while the dialog is up (queue blocked or not); then a handoff",
    kill_criterion: `before: a Ping unanswered in 10 s or WM_NULL unanswered: stop. The dialog not seen within 60 s while modalTest has not answered: stop. ${AUTH_KILL}. Up: HANDOFF (exit 5) with u6-waiting.json; the owner closes the dialog with its own button on the main session's word (the main session's limit: 900 s after u6-waiting.json). The harness never clicks, keys or sends a message to it`,
    side_effects: [
      `one modal dialog "${MODAL_CAPTION}", closed by the owner`,
      "two detached children wait for their answers (modalTest and the second-socket Ping)",
    ],
    rollback:
      "the owner closes the dialog; sd-22 reads the children's answers and checks the queue",
    outline: [
      "10 x EMCP_WB_Ping and 10 x WM_NULL (before)",
      `a detached child sends ${PROBE_API} modalTest (${TIMEOUTS.modalChild} ms); the parent polls the windows until the dialog is up`,
      "a second detached child sends ONE EMCP_WB_Ping on its own socket (the second planned exception to one call at a time); watched 30 s",
      "the window list (class, title, owner, enabled), IsHungAppWindow and 3 x WM_NULL while the dialog is up",
      "u6-waiting.json, then the handoff; nothing is sent to the dialog",
    ],
    plan: () => [
      ...tenPings("sd-21-u6-modal", u6, "before"),
      net(
        "sd-21-u6-modal",
        u6,
        probe("modalTest", {}, TIMEOUTS.modalChild, "opens the probe dialog"),
        { detached: true },
      ),
      net(
        "sd-21-u6-modal",
        u6,
        {
          apiFunc: "EMCP_WB_Ping",
          params: {},
          timeoutMs: TIMEOUTS.modalChild,
          note: "second socket, while the dialog is up",
        },
        { detached: true, concurrent: true },
      ),
    ],
    run: async (ctx) => {
      const late = settleLateShots(ctx);
      const pid = ctx.state.wbPid!;
      if (ctx.state.mainHwnd === null) {
        throw new StopSession(
          "kill",
          `the gate recorded no main window (unowned, "${MAIN_TITLE_PREFIX}..."): U6 has no WM_NULL target, and nothing is sent to another window`,
        );
      }
      const before = await pings(ctx);
      const stallBefore = await ctx.stall(10);
      if (before.some((x) => x === null) || stallBefore.some((x) => x === null)) {
        throw new StopSession("kill", "before the modal: a Ping or a WM_NULL went unanswered");
      }
      const base = ctx.state.baselineWindows;
      const modalName = `child-u6-modal-${ctx.opts.nonce}.json`;
      const pingName = `child-u6-ping-${ctx.opts.nonce}.json`;
      for (const n of [modalName, pingName]) {
        if (ctx.deps.readRunFile(n) !== null)
          throw new Error(`${n} already exists in the run folder; use a new --nonce`);
      }
      const startedAt = ctx.deps.now();
      const modalPid = ctx.deps.startDetached({
        apiFunc: PROBE_API,
        params: { action: "modalTest" },
        timeoutMs: TIMEOUTS.modalChild,
        resultName: modalName,
      });
      let dialog: WindowInfo | null = null;
      let rule: string | null = null;
      let wins: WindowInfo[] = [];
      for (;;) {
        await ctx.deps.sleep(TIMEOUTS.poll);
        ctx.deps.heartbeat();
        wins = await ctx.ourWindows();
        const auth = authWindow(wins, pid);
        if (auth) {
          ctx.deps.writeArtifact(`auth-${ctx.step}.json`, {
            step: ctx.step,
            window: auth,
            classMatches: auth.className === AUTH_CLASS,
            windows: wins,
            owner: auth.owner,
            childPid: modalPid,
            resultName: modalName,
            nonce: ctx.opts.nonce,
          });
          throw new StopSession(
            "handoff",
            `"${AUTH_TITLE}" is up during modalTest (the U6 probe dialog is not): read it with the passive walker; the owner clicks by hand and reports it with --owner-clicked. After the click modalTest goes on and the U6 dialog "${MODAL_CAPTION}" opens UNWATCHED (no u6-waiting.json, nothing measured): the owner closes it with its own button on the main session's word before --only sd-22-u6-after --run-dir ${ctx.opts.runDir} (the gate refuses while it is up)`,
          );
        }
        const found = u6Dialog(base, wins, pid, ctx.state.mainHwnd);
        if (found) {
          dialog = found.window;
          rule = found.rule;
          break;
        }
        if (ctx.deps.readRunFile(modalName) !== null) break;
        if (ctx.deps.now() - startedAt >= TIMEOUTS.u6DialogWait) {
          throw new StopSession(
            "kill",
            `modalTest: no window titled "${MODAL_CAPTION}", no new dialog-like window and no new unowned window beside a disabled main window within ${TIMEOUTS.u6DialogWait} ms, and no answer; the child pid ${modalPid} is left running`,
          );
        }
      }
      if (!dialog) {
        const r = runJson<RawCallResult>(ctx, modalName);
        return {
          status: "observed",
          summary: `modalTest answered (${r?.ok ? "Ok" : r?.error}) before any dialog was seen: Workbench.Dialog did not block the call${lateClause(late)}`,
          data: { before, stallBefore, modalResult: r, lateSettled: late },
        };
      }
      // The second planned exception to one call at a time (after U30): ONE Ping on its own socket.
      const pingStarted = ctx.deps.now();
      const pingPid = ctx.deps.startDetached({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.modalChild,
        resultName: pingName,
      });
      let pingDuring: RawCallResult | null = null;
      while (ctx.deps.now() - pingStarted < TIMEOUTS.u6PingWatch) {
        await ctx.deps.sleep(TIMEOUTS.poll);
        ctx.deps.heartbeat();
        pingDuring = runJson<RawCallResult>(ctx, pingName);
        if (pingDuring) break;
      }
      const during = await ctx.ourWindows();
      // M2: IsHungAppWindow and WM_NULL go to the main window recorded at the gate only.
      const hung = await ctx.hung();
      const stallDuring = await ctx.stall(3);
      const main = during.filter((w) => w.owner === 0 && w.hwnd !== dialog.hwnd);
      const waiting = {
        step: ctx.step,
        dialog,
        dialogRule: rule,
        mainHwnd: ctx.state.mainHwnd,
        mainWindowsDisabled: main
          .filter((w) => !w.enabled)
          .map((w) => ({ hwnd: w.hwnd, title: w.title })),
        windows: during,
        isHungAppWindow: hung,
        wmNullMs: stallDuring,
        secondSocketPing: pingDuring
          ? { answeredDuringModal: true, ...summarizeCall(pingDuring) }
          : { answeredDuringModal: false, watchedMs: TIMEOUTS.u6PingWatch },
        children: {
          modal: { pid: modalPid, resultName: modalName, startedAt },
          ping: { pid: pingPid, resultName: pingName, startedAt: pingStarted },
        },
        at: new Date(ctx.deps.now()).toISOString(),
      };
      ctx.deps.writeArtifact("u6-waiting.json", waiting);
      ctx.deps.writeArtifact(`${ctx.step}-observed.json`, {
        before,
        stallBefore,
        lateSettled: late,
        ...waiting,
      });
      throw new StopSession(
        "handoff",
        `the U6 dialog is up: ${dialog.className} "${dialog.title}" hwnd ${dialog.hwnd}, owner ${dialog.owner}, matched by ${rule}; the second-socket Ping ${pingDuring ? "answered during the modal (queue not blocked)" : `did not answer in ${TIMEOUTS.u6PingWatch} ms (queue blocked)`}; u6-waiting.json written. Owner: close the dialog with its own button on the main session's word (nothing is sent to it by the harness; the main session's limit is 900 s). Then resume with --only sd-22-u6-after --run-dir ${ctx.opts.runDir}`,
      );
    },
  });
  steps.push({
    id: "sd-22-u6-after",
    title:
      "U6 after the owner closed the dialog: the children's answer times, 10 Pings, IsWorkbenchRunning",
    risk: "mutating",
    answers: u6After,
    timeout_ms: HELPER.windows + 10 * TIMEOUTS.cheap + TIMEOUTS.cheap,
    expected:
      "the modalTest child answered after the close, the second-socket Ping answered (when, relative to the close), 10 Pings answered, IsWorkbenchRunning answered",
    kill_criterion: `the dialog still up, or a disabled window: stop (the owner has not closed it); a Ping unanswered in 10 s: stop; ${AUTH_KILL}`,
    side_effects: [],
    rollback: "none needed",
    skipWhen: {
      condition: "sd-21 saw no dialog (modalTest answered at once) or has no u6-waiting.json",
      carried_to: "nothing: sd-21 recorded the answer",
    },
    skip: (ctx) =>
      ctx.deps.readRunFile("u6-waiting.json") === null
        ? "no u6-waiting.json: sd-21 handed nothing off"
        : null,
    outline: [
      "read u6-waiting.json and both children's result files from the run folder",
      "list the windows: the dialog must be gone",
    ],
    plan: () => [
      ...tenPings("sd-22-u6-after", u6After, "after"),
      net("sd-22-u6-after", u6After, {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
    ],
    run: async (ctx) => {
      const pid = ctx.state.wbPid!;
      const w = runJson<{
        dialog?: { hwnd?: number };
        children?: {
          modal?: { resultName?: string; startedAt?: number };
          ping?: { resultName?: string; startedAt?: number };
        };
      }>(ctx, "u6-waiting.json");
      const wins = await ctx.ourWindows();
      const sawHwnd = w?.dialog?.hwnd;
      if (
        modalWindow(wins, pid) ||
        wins.some((x) => x.hwnd === sawHwnd) ||
        wins.some((x) => !x.enabled)
      ) {
        throw new StopSession(
          "kill",
          `the probe dialog or a disabled window is still up: the owner closes "${MODAL_CAPTION}" with its own button first`,
        );
      }
      const modal = w?.children?.modal?.resultName
        ? runJson<RawCallResult>(ctx, w.children.modal.resultName)
        : null;
      const ping = w?.children?.ping?.resultName
        ? runJson<RawCallResult>(ctx, w.children.ping.resultName)
        : null;
      const after = await pings(ctx);
      const alive = await ctx.call({
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      return {
        status: "observed",
        summary: `modalTest ${modal ? (modal.ok ? `answered after ${modal.durationMs} ms` : modal.error) : "no result"}; second-socket Ping ${ping ? (ping.ok ? `answered after ${ping.durationMs} ms` : ping.error) : "no result"}; after: ${latencyStats(after).unanswered} of 10 unanswered; alive ${alive.ok}`,
        data: {
          modalResult: modal,
          pingResult: ping,
          after: latencyStats(after),
          afterSamples: after,
          alive: summarizeCall(alive),
        },
      };
    },
  });

  // Every step but the gate reads the process table once for its started marker (DEC-032).
  return steps.map((s) =>
    s.id === "sd-00-gate" ? s : Object.assign(s, { timeout_ms: s.timeout_ms + HELPER.table }),
  );
}

// ── Queue ────────────────────────────────────────────────────────────────────

export const RISK_DEFINITIONS: Record<RiskClass, string> = {
  "read-only": "changes no state in Workbench or on disk",
  reversible:
    "changes in-memory editor or window state only (module windows, vanilla documents, a loaded vanilla world, dock toggles, the diag selection, focus); nothing on disk",
  mutating:
    "writes a file in the sandbox (the U28 BMP, removed by the step), or opens a modal that can wedge the lane until the owner closes it (U6, placed last)",
};

export const ORDER_NOTE =
  "Read-only, then reversible, then mutating (plan 5.3 step 7). The read-only probes come first: the authorization trigger (sd-01, sd-02) right after the gate, the eval and loadContainer steps, the U30 re-run. Then the reversible module, plugin, world and dock steps; the packed world opens (sd-15) after every step that wants no world. One deviation for the main session to ratify: sd-21 and sd-22 (U6) are classed mutating although their own effect is a dialog, so they run after the mutating U28 steps; U6 is the one probe that can wedge the lane, as plan 7 puts U4 last in its sitting. Every step that can raise the script-authorization prompt is a block of its own (ruling 1).";

export function conditionalNotAnswered(steps: StepDef[] = buildSteps()): NotAnswered[] {
  const always = new Set(steps.filter((s) => !s.skipWhen).flatMap((s) => s.answers));
  const out = new Map<string, NotAnswered>();
  for (const s of steps) {
    if (!s.skipWhen) continue;
    for (const id of s.answers) {
      if (always.has(id)) continue;
      const prior = out.get(id);
      if (prior) {
        if (!prior.answered_by!.includes(s.id)) prior.answered_by!.push(s.id);
        continue;
      }
      out.set(id, {
        id,
        part: "all",
        answered_by: [s.id],
        missing: "the whole probe, when the step is skipped",
        reason: `answered only by steps that are skipped when: ${s.skipWhen.condition}`,
        carried_to: s.skipWhen.carried_to,
        condition: s.skipWhen.condition,
      });
    }
  }
  return [...out.values()];
}

/** L674 is answered only when the mnemonic and case variants are allow-listed too. */
export const VARIANT_CONDITION: NotAnswered = {
  id: E("gui-census-feasibility-L674"),
  part: "all",
  answered_by: ["sd-19a-u9-worldeditor"],
  missing: "mnemonic and case matching of the first segment",
  reason: "sd-19a sends a spelling only when it is its own execute_action.allow_list entry",
  carried_to: "the next sitting after the main session lists the &Window and lower-case entries",
  condition: "neither variant of WINDOW_PATHS is on execute_action.allow_list",
};

export function notAnswered(steps: StepDef[] = buildSteps()): NotAnswered[] {
  return [...NOT_ANSWERED, ...conditionalNotAnswered(steps), VARIANT_CONDITION];
}

export function worstCaseTotalMs(steps: StepDef[] = buildSteps()): number {
  return steps.reduce((sum, s) => sum + s.timeout_ms, 0);
}

export function selectedIds(
  sel: { from: string | null; until: string | null; only?: string | null },
  steps: StepDef[] = buildSteps(),
): string[] {
  const ids = steps.map((s) => s.id);
  if (sel.only) return ids.includes(sel.only) ? [sel.only] : [];
  const from = sel.from ? ids.indexOf(sel.from) : 1;
  const until = sel.until ? ids.indexOf(sel.until) : ids.length - 1;
  if (from < 0 || until < 0) return [];
  return ids.slice(Math.max(1, from), until + 1);
}

export function invocationWorstCaseMs(
  ids: readonly string[],
  steps: StepDef[] = buildSteps(),
): number {
  const gate = steps.find((s) => s.id === "sd-00-gate")!.timeout_ms;
  return (
    gate +
    steps.filter((s) => ids.includes(s.id)).reduce((sum, s) => sum + s.timeout_ms, 0) +
    INVOCATION_MARGIN_MS
  );
}

/**
 * Why a real run's selection is refused, or null: one declared block or one step; a prompt-capable
 * step only alone; the worst case under the background cap; `--run-dir` after the first block.
 */
export function selectionRefusal(
  sel: { from: string | null; until: string | null; only: string | null; runDir: boolean },
  steps: StepDef[] = buildSteps(),
): string | null {
  const isBlock = BLOCKS.some((b) => b.from === sel.from && b.until === sel.until);
  if (!sel.only && !isBlock) {
    return "a real run is one declared block (--from X --until Y, runbook section E) or one step (--only X), never the whole sitting in one invocation";
  }
  const ids = selectedIds(sel, steps);
  if (ids.length === 0) return "the selection names no step after the gate";
  const prompting = steps.filter((s) => s.canPrompt && ids.includes(s.id));
  if (ids.length > 1 && prompting.length) {
    return `${prompting.map((s) => s.id).join(", ")} can raise the authorization prompt and runs only alone (--only)`;
  }
  if (ids[0] !== BLOCKS[0].from && !sel.runDir) {
    return `a selection that starts at ${ids[0]} resumes a run folder: pass --run-dir <the sitting's run folder>`;
  }
  const worst = invocationWorstCaseMs(ids, steps);
  if (worst > BACKGROUND_CAP_MS) {
    return `the selection's worst case (${worst} ms) is above the caller's ${BACKGROUND_CAP_MS} ms background limit`;
  }
  return null;
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  const by = (r: RiskClass): number => steps.filter((s) => s.risk === r).length;
  return {
    $comment:
      "Generated by `scripts/live/s-d-train1.ts --emit-queue` from its step table; tests/live-harness/s-d-train1.test.ts keeps this file equal to the table. Validated by scripts/live/preflight.ts validateQueue (step 7).",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: "docs/v2/sessions/queues/S-D.md",
    plan_refs: ["PLAN 8 Phase 2 table, S-D", "PLAN 5.3", "PLAN 5.4", "PLAN 7", "PLAN Appendix A"],
    order_note: ORDER_NOTE,
    risk_classes: RISK_DEFINITIONS,
    counts: {
      steps: steps.length,
      by_risk: {
        "read-only": by("read-only"),
        reversible: by("reversible"),
        mutating: by("mutating"),
      },
      prompt_capable: steps.filter((s) => s.canPrompt).map((s) => s.id),
    },
    timeout_note:
      "timeout_ms is an ESTIMATE of each step's worst case, not a bound: every call, wait and poll it makes, and the helpers' own timeouts (window lists, GUI-stall runs, process reads, the started marker's process-table read), run to their limits. worst_case_total_ms is their sum. The sitting runs one block per invocation (invocation_blocks); each invocation adds the gate and a margin and runs as a background command with a timeout above its worst case (DEC-032).",
    worst_case_total_ms: worstCaseTotalMs(steps),
    invocation_blocks: BLOCKS.map((b) => ({
      from: b.from,
      until: b.until,
      worst_case_ms: invocationWorstCaseMs(
        selectedIds({ from: b.from, until: b.until }, steps),
        steps,
      ),
    })),
    probes: steps.map((s) => ({
      id: s.id,
      title: s.title,
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
      answers: s.answers,
      ...(s.canPrompt ? { can_raise_authorization_prompt: true, alone: true } : {}),
      ...(s.skipWhen ? { skipped_when: s.skipWhen.condition } : {}),
    })),
    vanilla_inputs: VANILLA,
    not_answered: notAnswered(steps),
  };
}

// ── Action plan and outline ──────────────────────────────────────────────────

export function planInput(o: {
  sandboxDir: string | null;
  policy: CensusPolicy;
  nonce: string;
  u30Rerun?: boolean;
  walker?: boolean;
}): PlanInput {
  return {
    sandbox: o.sandboxDir ?? "<sandbox>",
    windowPaths: WINDOW_PATHS.filter((p) => allowListed(o.policy, p)).map((p) => [...p]),
    rmDockAllowed: allowListed(o.policy, RM_DOCK_PATH),
    u30Rerun: o.u30Rerun ?? false,
    walker: o.walker ?? false,
    nonce: o.nonce,
  };
}

export function buildActionPlan(p: PlanInput, steps: StepDef[] = buildSteps()): PlanAction[] {
  const actions: PlanAction[] = [];
  for (const s of steps) actions.push(...s.plan(p));
  actions.push({
    kind: "screenshot",
    target: "desktop",
    step: "any",
    when: "only on a timeout or a kill criterion: capture.ts, then the window list, then stop",
  });
  return actions;
}

export function sessionOutline(p: PlanInput, steps: StepDef[] = buildSteps()): string[] {
  const lines: string[] = [];
  for (const s of steps) {
    const skipped =
      s.id === "sd-11-u30-rerun" && !p.u30Rerun
        ? " [SKIPPED: --u30-rerun not given]"
        : s.id === "sd-19a-u9-worldeditor" && p.windowPaths.length === 0
          ? " [SKIPPED: no Window dock path is allow-listed]"
          : s.id === "sd-19b-u9-resourcemanager" && !p.rmDockAllowed
            ? ` [SKIPPED: ${RM_DOCK_PATH.join(" > ")} is not allow-listed]`
            : "";
    lines.push(
      `${s.id} (${s.risk}${s.canPrompt ? ", can prompt: alone" : ""})${skipped}: ${s.title}`,
    );
    for (const a of s.plan(p)) {
      const t = typeof a.target === "string" ? a.target : JSON.stringify(a.target);
      lines.push(`    ${a.kind} ${t}${a.params ? ` ${JSON.stringify(a.params)}` : ""}`);
    }
    for (const o of s.outline) lines.push(`    - ${o}`);
  }
  return lines;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface StepReport {
  id: string;
  status: StepStatus | "stopped" | "aborted" | "handoff";
  summary: string;
  answers: string[];
  evidence: string | null;
}

export interface SessionReport {
  exit: number;
  steps: StepReport[];
  stop: { kind: StopKind; reason: string; step: string } | null;
}

function skippedSummary(s: StepDef, reason: string, steps: StepDef[]): string {
  const lost = conditionalNotAnswered(steps).filter((n) => n.answered_by?.includes(s.id));
  if (!lost.length) return reason;
  return `${reason}. Not answered in S-D: ${lost.map((n) => n.id).join(", ")} (carried to ${s.skipWhen?.carried_to ?? lost[0].carried_to})`;
}

/** Run the selected steps against `deps`. Never retries after a timeout; never answers a dialog. */
export async function runSession(
  opts: SdOptions,
  deps: SdDeps,
  steps: StepDef[] = buildSteps(),
): Promise<SessionReport> {
  const state: SdState = {
    wbPid: null,
    startedPids: new Set(),
    baselineWindows: [],
    yesToAll: false,
    mainHwnd: null,
    logScan: null,
  };
  const calls: CallRecord[] = [];
  let inFlight = false;
  const denied = deniedApiNames(opts.policy);
  const guard = (apiFunc: string, params: Record<string, unknown>): void => {
    const hit = deniedApi(apiFunc, denied);
    if (hit) throw new Error(`refused: ${apiFunc} is on the policy deny list (${hit})`);
    // Ruling 7: Edit > Undo is never sent in S-D.
    if (apiFunc === PROBE_API && params.action === "executeAction") {
      const path = Array.isArray(params.menuPath) ? params.menuPath.map(String) : [];
      if (isNeverPath(path)) {
        throw new Error("refused: Edit > Undo is never called in S-D");
      }
    }
  };
  const record = (spec: CallSpec, startedAt: number, result: RawCallResult): void => {
    calls.push({
      apiFunc: spec.apiFunc,
      params: spec.params,
      timeoutMs: spec.timeoutMs,
      startedAt,
      result,
      note: spec.note,
    });
  };

  /** An authorization handoff record (m1: the owner field recorded; m4: the run nonce). */
  const authRecord = (
    step: string,
    auth: WindowInfo,
    wins: WindowInfo[],
    child?: { pid: number; resultName: string },
  ): Record<string, unknown> => ({
    step,
    window: auth,
    owner: auth.owner,
    classMatches: auth.className === AUTH_CLASS,
    mainWindowDisabled: wins.some((w) => w.owner === 0 && w.hwnd !== auth.hwnd && !w.enabled),
    windows: wins,
    ...(child ? { childPid: child.pid, resultName: child.resultName } : {}),
    nonce: opts.nonce,
    at: new Date(deps.now()).toISOString(),
  });
  /** The passive walker command for an authorization window (`--allow-owned` when it is owned). */
  const walkerLine = (pid: number | null, auth: WindowInfo, label: string): string =>
    `tools/uia/walk.ts --pid ${pid} --class ${auth.className} --title-pattern "${AUTH_TITLE}"${auth.owner !== 0 ? " --allow-owned" : ""} --label ${label} --out <run>/${label}-walk.json --id ${opts.laneId} --really`;

  const authHandoff = (
    ctxStep: string,
    auth: WindowInfo,
    wins: WindowInfo[],
    child?: { pid: number; resultName: string },
  ): never => {
    deps.writeArtifact(`auth-${ctxStep}.json`, authRecord(ctxStep, auth, wins, child));
    const next = nextStep(steps, ctxStep);
    throw new StopSession(
      "handoff",
      `"${AUTH_TITLE}" is up (class ${auth.className}${auth.className === AUTH_CLASS ? "" : `, not ${AUTH_CLASS}`}, hwnd ${auth.hwnd}, ${auth.owner === 0 ? "unowned" : `owned by ${auth.owner}`}); auth-${ctxStep}.json written; nothing was clicked or keyed. ` +
        `Main session: read the dialog with the passive walker (${walkerLine(state.wbPid, auth, `auth-${ctxStep}`)}) and quote it in chat. ` +
        `Owner: click the ruled button by hand (Yes) and say which. ` +
        `Then resume with --only ${next ?? "<next step>"} --run-dir ${opts.runDir} --owner-clicked <Yes|YesToAll|No|NoToAll>; ${ctxStep} is not run again`,
    );
  };

  const ctx: SdContext = {
    opts,
    deps,
    state,
    calls,
    step: steps[0].id,
    async call(spec) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      guard(spec.apiFunc, spec.params);
      deps.heartbeat();
      inFlight = true;
      const startedAt = deps.now();
      let r: RawCallResult;
      try {
        r = await deps.net(spec.apiFunc, spec.params, spec.timeoutMs);
      } finally {
        inFlight = false;
      }
      record(spec, startedAt, r);
      if (r.timedOut) {
        // A call held by the authorization prompt is that prompt's handoff, not a plain timeout.
        const wins = await ctx.ourWindows();
        const auth = authWindow(wins, state.wbPid);
        if (auth) authHandoff(ctx.step, auth, wins);
        throw new StopSession(
          "timeout",
          `${spec.apiFunc} timed out after ${spec.timeoutMs} ms (not retried)`,
        );
      }
      if (!r.ok && /^connection refused/.test(r.error ?? "")) {
        throw new StopSession("kill", `${spec.apiFunc}: ${r.error}; Workbench is not listening`);
      }
      return r;
    },
    async promptable(spec, label) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      guard(spec.apiFunc, spec.params);
      deps.heartbeat();
      inFlight = true;
      const startedAt = deps.now();
      const resultName = `child-${label}-${opts.nonce}.json`;
      const samples: Array<Record<string, unknown>> = [];
      try {
        if (deps.readRunFile(resultName) !== null) {
          throw new Error(`${resultName} already exists in the run folder; use a new --nonce`);
        }
        // The child waits past the call's own timeout so an answer the owner's click unblocks lands.
        const childPid = deps.startDetached({
          apiFunc: spec.apiFunc,
          params: spec.params,
          timeoutMs: spec.timeoutMs + TIMEOUTS.authClick,
          resultName,
        });
        const deadline = startedAt + spec.timeoutMs + TIMEOUTS.detachedGrace;
        for (;;) {
          const text = deps.readRunFile(resultName);
          if (text !== null) {
            const r = JSON.parse(text) as RawCallResult;
            record(
              { ...spec, note: `${spec.note ?? ""} detached; ${samples.length} polls`.trim() },
              startedAt,
              r,
            );
            deps.writeArtifact(`poll-${label}.json`, samples);
            if (r.timedOut)
              throw new StopSession(
                "timeout",
                `${spec.apiFunc} (detached) timed out (not retried)`,
              );
            return r;
          }
          if (deps.now() >= deadline) {
            deps.writeArtifact(`poll-${label}.json`, samples);
            throw new StopSession(
              "timeout",
              `${spec.apiFunc} (detached child pid ${childPid}) wrote no result within ${spec.timeoutMs + TIMEOUTS.detachedGrace} ms and no dialog is up; not retried, the child is left running`,
            );
          }
          await deps.sleep(TIMEOUTS.poll);
          deps.heartbeat();
          const wins = await ctx.ourWindows();
          const sample = (guiMs: number | null, guiSkipped?: string): Record<string, unknown> => ({
            t: deps.now() - startedAt,
            windows: wins.map((w) => ({
              className: w.className,
              title: w.title,
              enabled: w.enabled,
              owner: w.owner,
            })),
            guiMs,
            ...(guiSkipped ? { guiSkipped } : {}),
          });
          // M2: the authorization check comes BEFORE any WM_NULL, and no WM_NULL is sent once a
          // window was added since the baseline; it goes to the recorded main window only.
          const auth = authWindow(wins, state.wbPid);
          if (auth) {
            samples.push(sample(null, "the authorization window is up"));
            deps.writeArtifact(`poll-${label}.json`, samples);
            authHandoff(ctx.step, auth, wins, { pid: childPid, resultName });
          }
          const ch = windowChanges(state.baselineWindows, wins, state.wbPid!);
          if (ch.added.length) {
            samples.push(sample(null, `${ch.added.length} window(s) added since the baseline`));
          } else if (state.mainHwnd === null) {
            samples.push(sample(null, "no main window recorded at the gate"));
          } else {
            samples.push(sample((await ctx.stall(1))[0]));
          }
          const dialogs = ch.added.filter((w) => isDialogLike(w));
          if (ch.disabled.length || dialogs.length) {
            deps.writeArtifact(`poll-${label}.json`, samples);
            throw new StopSession(
              "kill",
              `${spec.apiFunc} (detached child pid ${childPid}): ${[...ch.disabled, ...dialogs].map((w) => `${w.className} "${w.title}"${w.enabled ? "" : " disabled"}`).join(" | ")} appeared during the call: a modal or a prompt is up; nothing is clicked, no NET call follows, the child is left running`,
            );
          }
        }
      } finally {
        inFlight = false;
      }
    },
    async burst(specs) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      specs.forEach((s) => guard(s.apiFunc, s.params));
      deps.heartbeat();
      inFlight = true;
      let results: RawCallResult[];
      const starts: number[] = [];
      try {
        // No stagger (ruling 6): every socket is opened and written within the same tick.
        const pending = specs.map((s) => {
          starts.push(deps.now());
          return deps.net(s.apiFunc, s.params, s.timeoutMs);
        });
        results = await Promise.all(pending);
      } finally {
        inFlight = false;
      }
      results.forEach((r, i) => record(specs[i], starts[i], r));
      const timedOut = results.filter((r) => r.timedOut).length;
      if (timedOut)
        throw new StopSession(
          "timeout",
          `${timedOut} burst call(s) unanswered within their timeout (not retried)`,
        );
      return results;
    },
    async ourWindows() {
      const pid = state.wbPid;
      let all: WindowInfo[];
      try {
        all = await deps.listWindows();
      } catch (e) {
        // m6: a failed window list says nothing about a dialog: a stop, never "no dialog".
        throw new StopSession(
          "kill",
          `the window list failed (${e instanceof Error ? e.message : String(e)}): whether a dialog is up is unknown; nothing more is sent`,
        );
      }
      return all.filter((w) => w.pid === pid);
    },
    async stall(samples) {
      if (state.wbPid === null || state.mainHwnd === null)
        return Array.from({ length: samples }, () => null);
      return deps.guiStall(state.wbPid, samples, state.mainHwnd);
    },
    async hung() {
      if (state.wbPid === null || state.mainHwnd === null) return null;
      return deps.hungApp(state.wbPid, state.mainHwnd);
    },
    async modalCheck(label, expected) {
      const after = await ctx.ourWindows();
      const auth = authWindow(after, state.wbPid);
      if (auth) authHandoff(ctx.step, auth, after);
      const ch = windowChanges(state.baselineWindows, after, state.wbPid!);
      const dialogs = ch.added.filter(
        (w) => isDialogLike(w) && !acceptedWindow(w, expected, opts.ownedModuleClasses ?? []),
      );
      if (ch.disabled.length || dialogs.length) {
        const list = (ws: WindowInfo[]): string =>
          ws.map((w) => `${w.className} "${w.title}" owner ${w.owner}`).join(" | ");
        throw new StopSession(
          "kill",
          `after ${label}: ${ch.disabled.length ? `Workbench window(s) disabled (${list(ch.disabled)})` : ""}${ch.disabled.length && dialogs.length ? "; " : ""}${dialogs.length ? `new owned or dialog-class window(s) (${list(dialogs)})` : ""}: a modal or a prompt is up; nothing is clicked`,
        );
      }
      state.baselineWindows = after;
      return after;
    },
    async setBaseline(label) {
      const ws = await ctx.ourWindows();
      const auth = authWindow(ws, state.wbPid);
      if (auth) authHandoff(ctx.step, auth, ws);
      const problem = baselineProblem(ws, undefined, opts.ownedModuleClasses ?? []);
      if (problem) {
        throw new StopSession(
          "kill",
          `${label}: refusing the window baseline, a modal or a dialog is already up (${problem}); nothing is clicked`,
        );
      }
      state.baselineWindows = ws;
      return ws;
    },
  };

  const report: SessionReport = { exit: EXIT.done, steps: [], stop: null };
  const onlyIdx = opts.only ? steps.findIndex((s) => s.id === opts.only) : -1;
  if (opts.only && onlyIdx < 0) throw new Error("unknown step id in --only");
  const fromIdx = opts.only ? onlyIdx : opts.from ? steps.findIndex((s) => s.id === opts.from) : 0;
  const untilIdx = opts.only
    ? onlyIdx
    : opts.until
      ? steps.findIndex((s) => s.id === opts.until)
      : steps.length - 1;
  if (fromIdx < 0 || untilIdx < 0) throw new Error("unknown step id in --from/--until");

  const refuse = (reason: string): SessionReport => {
    report.stop = { kind: "refused", reason, step: steps[0].id };
    report.exit = EXIT.refused;
    deps.log(`refused: ${reason}`);
    return report;
  };
  const runFiles = deps.listRunFiles();
  /** Prompts one call raised: `auth-<id>.json` and every `auth-<id>-<n>.json` (M3). */
  const promptsOf = (id: string): number =>
    1 +
    runFiles.filter(
      (f) => f.startsWith(`auth-${id}-`) && /^\d+\.json$/.test(f.slice(`auth-${id}-`.length)),
    ).length;
  /**
   * M3: a child still waiting with "Script Authorization Required" up is a further prompt of the
   * same call after the owner's click: `auth-<step>-<n>.json`, the walker command and the resume
   * line, a handoff. Null when no such window is up (or the call is not a step's).
   */
  const promptAgain = async (
    resultName: string,
    childPid: number,
  ): Promise<SessionReport | null> => {
    let wins: WindowInfo[];
    try {
      wins = await deps.listWindows();
    } catch (e) {
      return refuse(
        `the detached call ${resultName} still waits and the window list failed (${e instanceof Error ? e.message : String(e)}): whether a prompt is up is unknown; stop and ask`,
      );
    }
    const wbPid = deps.recordedPid();
    const auth = authWindow(wins, wbPid);
    if (!auth) return null;
    const step = steps
      .map((s) => s.id)
      .find(
        (id) =>
          runFiles.includes(`auth-${id}.json`) &&
          runJson<{ resultName?: string }>({ deps }, `auth-${id}.json`)?.resultName === resultName,
      );
    if (!step) return null;
    const n = promptsOf(step) + 1;
    deps.writeArtifact(`auth-${step}-${n}.json`, {
      ...authRecord(step, auth, wins, { pid: childPid, resultName }),
      prompt: n,
    });
    const next = nextStep(steps, step);
    const reason =
      `the detached call ${resultName} of ${step} still waits and "${AUTH_TITLE}" is up again: prompt ${n} of the same call, after the owner's click (class ${auth.className}, hwnd ${auth.hwnd}, ${auth.owner === 0 ? "unowned" : `owned by ${auth.owner}`}); auth-${step}-${n}.json written; nothing was clicked or keyed. ` +
      `Main session: read the dialog with the passive walker (${walkerLine(wbPid, auth, `auth-${step}-${n}`)}) and quote it in chat. ` +
      `Owner: click the ruled button by hand and say which. ` +
      `Then resume with --only ${next ?? "<next step>"} --run-dir ${opts.runDir} --owner-clicked <button 1>,...,<button ${n}> (every prompt's button in order); ${step} is not run again`;
    report.stop = { kind: "handoff", reason, step };
    report.exit = EXIT.handoff;
    deps.log(`handoff: ${reason}`);
    return report;
  };
  const dangling = runFiles.filter(
    (f) => /\.started$/.test(f) && !runFiles.includes(f.replace(/\.started$/, ".json")),
  );
  if (dangling.length) {
    const id = dangling[0].replace(/\.started$/, "");
    return refuse(
      `${id} has a started marker and no result in this run folder: the script ended during that step. Treat it as a harness error: heartbeat the lane; if a Workbench runs, the recover subcommand; if ${id} is sd-20a or sd-20b, the rollback subcommand; git -C <sandbox> status --short; stop and ask the owner. No step runs here until acknowledge --step ${id} is recorded; ${id} is not run again`,
    );
  }
  const selected = steps.filter((s, i) => i > 0 && i >= fromIdx && i <= untilIdx);
  const again = selected.find(
    (s) => runFiles.includes(`${s.id}.json`) || runFiles.includes(`${s.id}.started.acknowledged`),
  );
  if (again) {
    return refuse(
      `${again.id} already has a result in this run folder (or an acknowledged marker): a step is never run twice, and a stopped step is never retried (plan 5.3)`,
    );
  }
  for (const f of runFiles) {
    const m = /^(child-.+\.json)\.request\.json$/.exec(f);
    if (!m || runFiles.includes(m[1])) continue;
    const pidText = deps.readRunFile(`${m[1]}.pid.json`);
    if (pidText === null) {
      return refuse(
        `the detached call ${m[1]} has no result and no recorded child pid: it may still hold a NET socket; check the process list by hand, then stop and ask the owner`,
      );
    }
    const child = JSON.parse(pidText) as { pid: number; created: number | null };
    if (deps.processImage(child.pid) === null) continue;
    const nowCreated = await deps.processCreated(child.pid);
    if (child.created === null || nowCreated === null || nowCreated === child.created) {
      const again = await promptAgain(m[1], child.pid);
      if (again) return again;
      return refuse(
        `the detached call ${m[1]} has no result and its child pid ${child.pid} still runs: its call is still waiting (the U6 dialog not yet closed by the owner?; no "${AUTH_TITLE}" window is up); wait for the owner, or stop and ask`,
      );
    }
  }
  // Ruling 1: the owner's button for every authorization prompt, written before the next step runs.
  const entries = authLogEntries(deps.readRunFile(AUTH_LOG));
  const pending = steps
    .map((s) => s.id)
    .filter((id) => {
      if (!runFiles.includes(`auth-${id}.json`)) return false;
      const last = entries.filter((e) => e.step === id).pop();
      return !last || last.buttons.length < promptsOf(id);
    });
  const clicked =
    opts.ownerClicked === null || opts.ownerClicked === undefined
      ? []
      : typeof opts.ownerClicked === "string"
        ? [opts.ownerClicked]
        : [...opts.ownerClicked];
  if (pending.length && !clicked.length) {
    const n = promptsOf(pending[0]);
    return refuse(
      `${pending[0]} stopped on "${AUTH_TITLE}" and the owner's button is not recorded: pass --owner-clicked <Yes|YesToAll|No|NoToAll>${n > 1 ? ` with ${n} buttons in order, comma-separated (the call raised ${n} prompts)` : ""} (the button the owner reports)`,
    );
  }
  if (clicked.length) {
    if (!pending.length)
      return refuse(
        "--owner-clicked was given but no authorization handoff waits for the owner's button",
      );
    const id = pending[0];
    const n = promptsOf(id);
    if (clicked.length !== n) {
      return refuse(
        `${id} raised ${n} prompt(s) (auth-${id}.json${n > 1 ? ` to auth-${id}-${n}.json` : ""}): --owner-clicked takes ${n} button(s) in order, comma-separated; ${clicked.length} given`,
      );
    }
    const auth = runJson<{ resultName?: string }>({ deps }, `auth-${id}.json`);
    const late = auth?.resultName ? runJson<RawCallResult>({ deps }, auth.resultName) : null;
    deps.appendRunLine(
      AUTH_LOG,
      JSON.stringify({
        step: id,
        button: clicked[0],
        buttons: clicked,
        prompts: n,
        recorded_at: new Date(deps.now()).toISOString(),
        late_answer: late ? summarizeCall(late) : null,
        late_answer_file: auth?.resultName ?? null,
      }),
    );
    deps.log(`authorization log: ${id} answered ${clicked.join(", ")} by the owner`);
  }
  state.yesToAll = authLogEntries(deps.readRunFile(AUTH_LOG)).some((e) =>
    e.buttons.includes("YesToAll"),
  );

  const finish = (
    s: StepDef,
    status: StepReport["status"],
    summary: string,
    data: Record<string, unknown>,
    mark: number,
  ): void => {
    const stepCalls = calls.slice(mark);
    const artifact = deps.writeArtifact(`${s.id}.json`, {
      session: SESSION,
      step: s.id,
      risk: s.risk,
      answers: s.answers,
      status,
      summary,
      data,
      calls: stepCalls.map((c) => ({
        apiFunc: c.apiFunc,
        params: c.params,
        timeoutMs: c.timeoutMs,
        note: c.note,
        ...summarizeCall(c.result),
        timedOut: c.result.timedOut,
      })),
    });
    const ev = deps.writeEvidence(
      `${SESSION} ${s.id} ${status}: ${summary}. Answers: ${s.answers.join(", ") || "none (gate)"}`,
      artifact,
    );
    report.steps.push({ id: s.id, status, summary, answers: s.answers, evidence: ev });
    deps.log(`[${status}] ${s.id}: ${summary}`);
  };

  /** The window list for a stop's evidence; a failed list is recorded as such (m6). */
  const evidenceWindows = async (): Promise<unknown> => {
    try {
      return windowsForEvidence(await deps.listWindows(), state.startedPids);
    } catch (err) {
      return { windowListFailed: err instanceof Error ? err.message : String(err) };
    }
  };

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isGate = i === 0;
    if (!isGate && (i < fromIdx || i > untilIdx)) {
      report.steps.push({
        id: s.id,
        status: "not-run",
        summary: "outside --from/--until",
        answers: s.answers,
        evidence: null,
      });
      continue;
    }
    ctx.step = s.id;
    const mark = calls.length;
    try {
      const skipReason = s.skip?.(ctx) ?? null;
      if (skipReason !== null) {
        finish(s, "skipped", skippedSummary(s, skipReason, steps), {}, mark);
        continue;
      }
      if (!isGate) {
        const pid = state.wbPid;
        const marker: StartedMarker = {
          step: s.id,
          started_at: new Date(deps.now()).toISOString(),
          pid,
          created: pid === null ? null : await deps.processCreated(pid),
        };
        deps.writeArtifact(`${s.id}.started`, marker);
      }
      const out = await s.run(ctx);
      finish(
        s,
        out.status,
        out.status === "skipped" ? skippedSummary(s, out.summary, steps) : out.summary,
        out.data ?? {},
        mark,
      );
    } catch (caught) {
      const e =
        caught instanceof StopSession
          ? caught
          : new StopSession(
              "kill",
              `internal error: ${caught instanceof Error ? caught.message : String(caught)}`,
            );
      const data: Record<string, unknown> = {};
      // M1: a gate that stops after its log scan still records the scan position.
      if (isGate && state.logScan) data.logScan = state.logScan;
      if (e.kind === "handoff") {
        const auth = runJson<Record<string, unknown>>({ deps }, `auth-${s.id}.json`);
        if (auth) data.authorization = auth;
        // M5: the CrashReporter processes present at a handoff (sd-01, sd-02 run before sd-03).
        data.crashReporters = deps.crashReporters();
        data.windows = await evidenceWindows();
        finish(s, "handoff", e.message, data, mark);
        report.stop = { kind: e.kind, reason: e.message, step: s.id };
        report.exit = EXIT.handoff;
        return report;
      }
      if (e.kind === "abort") {
        const pid = e.closePid === undefined ? state.wbPid : e.closePid;
        let closed: { exited: boolean; detail: string } | null = null;
        if (pid !== null && state.startedPids.has(pid)) {
          try {
            const image = deps.processImage(pid);
            closed =
              image !== null && image.toLowerCase() === WORKBENCH_EXE.toLowerCase()
                ? await deps.closeGracefully(pid, TIMEOUTS.close)
                : {
                    exited: image === null,
                    detail: `pid ${pid} is ${image ?? "gone"}; nothing sent`,
                  };
          } catch (err) {
            closed = { exited: false, detail: err instanceof Error ? err.message : String(err) };
          }
        }
        data.close = closed;
        data.capture = await deps.capture(`${s.id}-abort`);
        data.windows = await evidenceWindows();
        finish(s, "aborted", e.message, data, mark);
        report.stop = { kind: e.kind, reason: e.message, step: s.id };
        report.exit = EXIT.aborted;
        return report;
      }
      data.capture = await deps.capture(`${s.id}-${e.kind}`);
      data.windows = await evidenceWindows();
      data.crashReporters = deps.crashReporters();
      finish(s, "stopped", `${e.kind}: ${e.message}`, data, mark);
      report.stop = { kind: e.kind, reason: e.message, step: s.id };
      report.exit = EXIT.stopped;
      return report;
    }
  }
  return report;
}

// ── Real dependencies ────────────────────────────────────────────────────────

/**
 * PowerShell: IsHungAppWindow on the pid's main window, or on EMCP_HWND when set (and only while it
 * belongs to the pid). Prints true, false or null.
 */
export const HUNG_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Runtime.InteropServices;",
  "public static class EmcpSdHung {",
  '  [DllImport("user32.dll")] private static extern bool IsHungAppWindow(IntPtr h);',
  '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  "  public static string Run(int pid, long hwnd) {",
  "    IntPtr h = System.Diagnostics.Process.GetProcessById(pid).MainWindowHandle;",
  "    if (hwnd != 0) { h = new IntPtr(hwnd); uint owner; GetWindowThreadProcessId(h, out owner); if (owner != (uint)pid) h = IntPtr.Zero; }",
  '    if (h == IntPtr.Zero) return "null";',
  '    return IsHungAppWindow(h) ? "true" : "false";',
  "  }",
  "}",
  "'@",
  "[EmcpSdHung]::Run([int]$env:EMCP_PID, [long]$env:EMCP_HWND)",
].join("\n");

export interface RealDepsInput {
  lane: Lane;
  port: number;
  sandboxDir: string;
  logsPath: string | null;
  runDir: string;
  evidenceDir: string;
  build: string;
  placeholders: PlaceholderContext;
}

export function realDeps(input: RealDepsInput): SdDeps {
  // Sandbox writes, removals and reads only under <sandbox>/_throwaway/ (the U28 BMP); folder
  // listings anywhere in the sandbox (the gate lists EnfusionCensus/).
  const throwaway = join(input.sandboxDir, THROWAWAY);
  const inThrowaway = (p: string): string => {
    if (!insideDir(throwaway, p))
      throw new Error(`refusing file access outside <sandbox>/${THROWAWAY}/: ${p}`);
    return p;
  };
  const inSandbox = (p: string): string => {
    if (!insideDir(input.sandboxDir, p) && resolve(p) !== resolve(throwaway)) {
      throw new Error(`refusing file access outside the sandbox: ${p}`);
    }
    return p;
  };
  return {
    net: (apiFunc, params, timeoutMs) =>
      rawNetCall(apiFunc, params, { port: input.port, timeoutMs }),
    listWindows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      // m6: a failed list is an error (a stop), never an empty list ("no dialog").
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    capture: async (label) => {
      const r = await captureDesktop({
        label: `S-D-${label}`,
        dir: input.runDir,
        gateReason: null,
      });
      return { ok: r.ok, path: r.path, detail: r.detail };
    },
    guiStall: async (pid, samples, hwnd) => {
      const r = await runPowerShell(STALL_SCRIPT, {
        timeoutMs: 30_000 + samples * 6_000,
        env: {
          EMCP_PID: String(pid),
          EMCP_SAMPLES: String(samples),
          ...(hwnd ? { EMCP_HWND: String(hwnd) } : {}),
        },
      });
      const line = r.ok ? lastLine(r.stdout) : null;
      return line
        ? (JSON.parse(line) as Array<number | null>)
        : Array.from({ length: samples }, () => null);
    },
    hungApp: async (pid, hwnd) => {
      const r = await runPowerShell(HUNG_SCRIPT, {
        timeoutMs: HUNG_HELPER_MS,
        env: { EMCP_PID: String(pid), ...(hwnd ? { EMCP_HWND: String(hwnd) } : {}) },
      });
      const line = r.ok ? lastLine(r.stdout) : null;
      return line === "true" ? true : line === "false" ? false : null;
    },
    processImage: (pid) => processByPid(defaultExec, pid)?.image ?? null,
    processCreated: (pid) => creationTimeOf(pid, () => readProcessTable()),
    listRunFiles: () => (existsSync(input.runDir) ? readdirSync(input.runDir) : []),
    listDir: (p) => (existsSync(inSandbox(p)) ? readdirSync(p) : []),
    portOwners: () => portListeners(defaultExec, input.port),
    crashReporters: () => processesByImage(defaultExec, CRASH_REPORTER_IMAGE).map((p) => p.pid),
    listenersOf: (pids) => listenersInNetstat(defaultExec("netstat", ["-ano", "-p", "TCP"]), pids),
    closeGracefully: async (pid, timeoutMs) => {
      const r = await runPowerShell(CLOSE_SCRIPT, {
        timeoutMs: timeoutMs + 30_000,
        env: { EMCP_PID: String(pid), EMCP_TIMEOUT_MS: String(timeoutMs) },
      });
      const line = r.ok ? lastLine(r.stdout) : null;
      const res = line ? (JSON.parse(line) as { closeSent: boolean; exited: boolean }) : null;
      return {
        exited: res?.exited === true,
        detail: res
          ? `closeSent ${res.closeSent}, exited ${res.exited}`
          : `close script failed: ${r.error}`,
      };
    },
    recordedPid: () => input.lane.recordedPid(),
    heartbeat: () => {
      input.lane.heartbeat();
    },
    sessionLogAfter: (after) =>
      input.logsPath ? newestSessionLog(input.logsPath, after ?? undefined) : null,
    readText: (p) => readFileSync(p, "utf-8"),
    readRegLines: (p) => readRegFile(p),
    fileExists: (p) => existsSync(p),
    readBytes: (p) => readFileSync(inThrowaway(p)),
    removeFile: (p) => rmSync(inThrowaway(p)),
    makeDir: (p) => {
      if (resolve(p) !== resolve(throwaway))
        throw new Error(`refusing to create ${p}: only <sandbox>/${THROWAWAY}/`);
      mkdirSync(p);
    },
    removeEmptyDir: (p) => {
      if (resolve(p) !== resolve(throwaway))
        throw new Error(`refusing to remove ${p}: only <sandbox>/${THROWAWAY}/`);
      if (readdirSync(p).length === 0) rmdirSync(p);
    },
    startDetached: (spec) => {
      const req = childRequest(spec, input.port, input.lane);
      const specPath = join(input.runDir, `${spec.resultName}.request.json`);
      mkdirSync(input.runDir, { recursive: true });
      writeFileSync(specPath, req.file, { flag: "wx" });
      const child = spawn(
        process.execPath,
        ["--import", TSX_IMPORT, SCRIPT_ABS, "--child-call", specPath],
        {
          cwd: REPO_ROOT,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: { ...process.env, ...req.env },
        },
      );
      child.on("error", () => {
        // A failed start is the throw below; the event never goes unhandled.
      });
      child.unref();
      if (child.pid === undefined) throw new Error("the detached child did not start");
      const childPid = child.pid;
      void creationTimeOf(childPid, () => readProcessTable()).then((created) => {
        try {
          writeFileSync(
            join(input.runDir, `${spec.resultName}.pid.json`),
            JSON.stringify({ pid: childPid, created }) + "\n",
            { flag: "wx" },
          );
        } catch {
          // Without the file a later invocation refuses: the safe side.
        }
      });
      return childPid;
    },
    readRunFile: (name) => {
      const p = join(input.runDir, name);
      return existsSync(p) ? readFileSync(p, "utf-8") : null;
    },
    readRunBytes: (name) => {
      const p = join(input.runDir, name);
      return existsSync(p) ? readFileSync(p) : null;
    },
    writeRunBytes: (name, data) => {
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`refusing run-folder name ${name}`);
      mkdirSync(input.runDir, { recursive: true });
      const p = join(input.runDir, name);
      writeFileSync(p, data, { flag: "wx" });
      return p;
    },
    appendRunLine: (name, line) => {
      mkdirSync(input.runDir, { recursive: true });
      appendFileSync(join(input.runDir, name), line + "\n", "utf-8");
    },
    runWalker: (argv, budgetMs) =>
      new Promise((done) => {
        const child = spawn(argv[0], argv.slice(1), {
          cwd: REPO_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let out = "";
        child.stdout.on("data", (c: Buffer) => {
          out += c.toString("utf-8");
        });
        child.stderr.on("data", (c: Buffer) => {
          process.stderr.write(toPlaceholders(c.toString("utf-8"), input.placeholders));
        });
        child.on("error", (e) => {
          process.stderr.write(
            toPlaceholders(`walker did not start: ${e.message}\n`, input.placeholders),
          );
        });
        const timer = setTimeout(
          () => done({ exitCode: null, timedOut: true, lastLine: lastLine(out) }),
          budgetMs,
        );
        child.on("close", (code) => {
          clearTimeout(timer);
          done({ exitCode: code, timedOut: false, lastLine: lastLine(out) });
        });
      }),
    writeArtifact: (name, value) => {
      mkdirSync(input.runDir, { recursive: true });
      const p = join(input.runDir, name);
      writeFileSync(
        p,
        JSON.stringify(rewriteStrings(value, input.placeholders), null, 2) + "\n",
        "utf-8",
      );
      return p;
    },
    writeEvidence: (summary, artifactPath) =>
      writeEvidence(
        input.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} (session ${SESSION})`,
          build: input.build,
          result_summary: summary,
          artifacts: [artifactPath],
        },
        input.placeholders,
      ).record.id,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (line) => console.log(toPlaceholders(line, input.placeholders)),
  };
}

// ── Rollback of the U28 plants ───────────────────────────────────────────────

export interface RollbackIo {
  workbenchPids: () => number[];
  fileExists: (p: string) => boolean;
  readBytes: (p: string) => Buffer;
  removeFile: (p: string) => void;
  removeEmptyDir: (p: string) => void;
  listDir: (p: string) => string[];
  readRunFile: (name: string) => string | null;
  /** Create a run-folder file; never overwrites. */
  writeRunFile: (name: string, data: string | Buffer) => void;
  log: (line: string) => void;
}

/**
 * `rollback`: settle the screenshot plants (`plant-sd-20a.json`, `plant-sd-20b.json`) that have no
 * rollback record, only while no Workbench image runs (so nothing more can land): a BMP is copied
 * into the run folder and deleted by its hash; `_throwaway/` is removed when the step created it
 * and it is empty; anything else in it is named and left. A dry run unless `gate` is null.
 */
export function runRollback(
  cfg: { runDir: string; sandboxDir: string; gate: string | null; really: boolean },
  io: RollbackIo,
): number {
  const open = SHOT_PLANTS.filter(
    (id) =>
      io.readRunFile(`plant-${id}.json`) !== null && io.readRunFile(`rollback-${id}.json`) === null,
  );
  if (open.length === 0) {
    io.log("no U28 plant without a rollback in this run folder");
    return 0;
  }
  for (const id of open)
    io.log(`${cfg.gate ? "would roll back" : "rolling back"} plant-${id}.json`);
  if (cfg.gate) {
    io.log(cfg.gate);
    return cfg.really ? 1 : 0;
  }
  let running: number[];
  try {
    running = io.workbenchPids();
  } catch (e) {
    io.log(
      `refused: the Workbench processes could not be listed (${e instanceof Error ? e.message : String(e)})`,
    );
    return 1;
  }
  if (running.length > 0) {
    io.log(
      `refused: Workbench is running (pid ${running.join(", ")}); a BMP can still land; end it first (post-flight or recover)`,
    );
    return 1;
  }
  let ok = true;
  const dir = join(cfg.sandboxDir, THROWAWAY);
  for (const id of open) {
    const plant = JSON.parse(io.readRunFile(`plant-${id}.json`)!) as ShotPlant;
    const file = join(dir, plant.file);
    let detail: string;
    let done = false;
    if (!insideDir(dir, file) || !/^[A-Za-z0-9_]+-[0-9a-f]{6,32}\.bmp$/.test(plant.file)) {
      detail = `plant-${id}.json names ${plant.file}, not a screenshot name of this run; nothing removed`;
    } else {
      let hash: string | null = null;
      if (io.fileExists(file)) {
        const data = io.readBytes(file);
        hash = sha256Hex(data);
        io.writeRunFile(`u28-${plant.file}`, data);
        if (sha256Hex(io.readBytes(file)) === hash) io.removeFile(file);
      }
      const left = io.fileExists(dir) ? io.listDir(dir) : [];
      if (io.fileExists(dir) && left.length === 0 && !plant.folderExisted) io.removeEmptyDir(dir);
      done = !io.fileExists(file) && left.length === 0;
      detail = done
        ? hash
          ? `the BMP (${hash.slice(0, 12)}...) is copied into the run folder and removed; ${THROWAWAY}/ ${plant.folderExisted ? "kept (it existed)" : "removed"}`
          : `no BMP landed; ${THROWAWAY}/ ${plant.folderExisted ? "kept (it existed)" : "removed"}`
        : `${THROWAWAY}/ still holds ${left.join(", ")} (not this run's, so not deleted): remove it with the owner`;
      if (done)
        io.writeRunFile(
          `rollback-${id}.json`,
          JSON.stringify({ ok: true, by: "rollback", landed: hash !== null, sha256: hash }) + "\n",
        );
    }
    io.log(`${id}: ${done ? "rolled back" : "INCOMPLETE"}: ${detail}`);
    ok &&= done;
  }
  return ok ? 0 : 1;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface MainOverrides {
  platform?: NodeJS.Platform;
  deps?: (input: RealDepsInput) => SdDeps;
  policy?: CensusPolicy;
  out?: (line: string) => void;
  exists?: (path: string) => boolean;
  artifactsRoot?: string;
  recoverDeps?: Partial<RecoverDeps>;
  rollbackIo?: Partial<RollbackIo>;
}

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "sandbox",
  "walker-cmd",
  "from",
  "until",
  "only",
  "run-dir",
  "opened-project-pattern",
  "allowed-addons",
  "build",
  "port",
  "id",
  "lease-path",
  "marker-path",
  "nonce",
  "child-call",
  "logs-path",
  "registry-export",
  "force-settings",
  "owned-module-classes",
  "owner-go",
  "owner-clicked",
  "step",
] as const;

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  let ph: PlaceholderContext = defaultPlaceholderContext({ v2: REPO_ROOT });
  const err = (s: string): void => console.error(toPlaceholders(s, ph));
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const o = args.options;
  if (o["child-call"]) return runChildCall(o["child-call"], over.platform);
  const cmd = args.positional[0] ?? "run";
  if (!["run", "recover", "rollback", "acknowledge"].includes(cmd)) {
    err(
      "Usage: s-d-train1.ts [run] [options] | recover --run-dir <dir> --id <id> [--owner-go <pid>] [--really] | " +
        "rollback --run-dir <dir> --id <id> [--sandbox <dir>] [--really] | acknowledge --run-dir <dir> --id <id> --step <id> [--owner-ack] [--really]",
    );
    return EXIT.usage;
  }
  const policy = over.policy ?? loadPolicy();
  const steps = buildSteps();
  const platform = over.platform ?? process.platform;
  const really = args.flags.has("really");
  const artifactsRoot = over.artifactsRoot ?? artifactsDir();
  const stopped = (reason: string): void => say(toPlaceholders(`STOPPED: ${reason}`, ph));

  if (o.sandbox !== undefined && basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    err(`refused: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}`);
    if (really) stopped("refused: --sandbox is not the 2.0 sandbox");
    return EXIT.refused;
  }

  if (cmd !== "run") {
    if (!o["run-dir"] || !o.id) {
      err(`${cmd} needs --run-dir <run folder> and --id <lane id>`);
      return EXIT.usage;
    }
    const runDir = resolve(o["run-dir"]);
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    if (cmd === "recover") {
      let ownerGo: number | null = null;
      if (o["owner-go"] !== undefined) {
        ownerGo = Number(o["owner-go"]);
        if (!Number.isInteger(ownerGo) || ownerGo <= 0) {
          err("--owner-go takes the pid the owner's word names");
          return EXIT.usage;
        }
      }
      return runRecover(
        { lane, really, runDir, artifactsRoot, ph },
        { ...defaultRecoverDeps(say), ...over.recoverDeps, ...(over.platform ? { platform } : {}) },
        {
          ownerGo,
          next: "the rollback subcommand if sd-20a or sd-20b has an open plant, then git -C <sandbox> status --short; a stopped step is never retried",
        },
      );
    }
    if (cmd === "acknowledge") {
      if (!o.step || !steps.some((s) => s.id === o.step)) {
        err("acknowledge needs --step <step id>");
        return EXIT.usage;
      }
      const rec = {
        ...defaultRecoverDeps(say),
        ...over.recoverDeps,
        ...(over.platform ? { platform } : {}),
      };
      return acknowledgeMarker({ lane, really, runDir, artifactsRoot, ph }, rec, {
        step: o.step,
        ownerAck: args.flags.has("owner-ack"),
        resultFile: join(runDir, `${o.step}.json`),
        would: "no Workbench image runs and no screenshot plant of the step is open",
        extraRefusal: () => {
          const id = o.step!.slice(0, 6);
          return (id === "sd-20a" || id === "sd-20b") &&
            existsSync(join(runDir, `plant-${id}.json`)) &&
            !existsSync(join(runDir, `rollback-${id}.json`))
            ? `the plant of ${o.step} has no rollback record; run the rollback subcommand first`
            : null;
        },
      });
    }
    let sandboxDir: string;
    try {
      sandboxDir = resolve(o.sandbox ?? join(loadConfig().projectPath, SANDBOX_NAME));
    } catch (e) {
      err(`configuration: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT.usage;
    }
    ph = defaultPlaceholderContext({ v2: REPO_ROOT, sandbox: sandboxDir });
    const gate = liveGateReason({ really, platform, leaseHeld: lane.holdsLease() });
    const outside = gate ? null : outsideArtifacts(runDir, artifactsRoot);
    if (outside) {
      err(`refused: ${outside}`);
      return EXIT.refused;
    }
    const io: RollbackIo = {
      workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid),
      fileExists: (p) => existsSync(p),
      readBytes: (p) => readFileSync(p),
      removeFile: (p) => rmSync(p),
      removeEmptyDir: (p) => rmdirSync(p),
      listDir: (p) => readdirSync(p),
      readRunFile: (n) =>
        existsSync(join(runDir, n)) ? readFileSync(join(runDir, n), "utf-8") : null,
      writeRunFile: (n, t) => writeFileSync(join(runDir, n), t, { flag: "wx" }),
      log: (l) => say(toPlaceholders(l, ph)),
      ...over.rollbackIo,
    };
    return runRollback({ runDir, sandboxDir, gate, really }, io);
  }

  if (o["emit-queue"]) {
    mkdirSync(dirname(o["emit-queue"]), { recursive: true });
    writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
    say(`queue written: ${toPlaceholders(o["emit-queue"], ph)}`);
    return EXIT.done;
  }

  let walkerCmd: string[] | null = null;
  if (o["walker-cmd"]) {
    try {
      const v = JSON.parse(o["walker-cmd"]) as unknown;
      if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === "string"))
        throw new Error();
      walkerCmd = v as string[];
    } catch {
      err(
        "--walker-cmd must be a JSON array of strings (in Git Bash, put the array in single quotes)",
      );
      return EXIT.usage;
    }
  }
  for (const k of ["from", "until", "only"] as const) {
    if (o[k] && !steps.some((s) => s.id === o[k])) {
      err(`--${k} ${o[k]} is not a step id`);
      return EXIT.usage;
    }
  }
  if (o.only && (o.from || o.until)) {
    err("--only excludes --from and --until");
    return EXIT.usage;
  }
  let ownerClicked: AuthButton[] | null = null;
  if (o["owner-clicked"] !== undefined) {
    // M3: one button per prompt of the call, in order, comma-separated.
    const list = o["owner-clicked"].split(",").map((x) => x.trim());
    if (!list.length || !list.every((b) => (AUTH_BUTTONS as readonly string[]).includes(b))) {
      err(
        `--owner-clicked takes one of ${AUTH_BUTTONS.join(", ")}, or several comma-separated (one per prompt, in order)`,
      );
      return EXIT.usage;
    }
    ownerClicked = list as AuthButton[];
  }
  const nonce = o.nonce ?? randomBytes(3).toString("hex");
  const nonceBad = nonceProblem(nonce);
  if (nonceBad) {
    err(nonceBad);
    return EXIT.usage;
  }
  const u30Rerun = args.flags.has("u30-rerun");

  if (!really) {
    const sandbox = o.sandbox ?? null;
    const p = planInput({
      sandboxDir: sandbox,
      policy,
      nonce,
      u30Rerun,
      walker: walkerCmd !== null,
    });
    const selecting = Boolean(o.only || o.from || o.until);
    const ids = selectedIds(
      { from: o.from ?? null, until: o.until ?? null, only: o.only ?? null },
      steps,
    );
    const planSteps = selecting ? steps.filter((s, i) => i === 0 || ids.includes(s.id)) : steps;
    const plan = buildActionPlan(p, planSteps);
    ph = defaultPlaceholderContext(sandbox ? { sandbox, v2: REPO_ROOT } : { v2: REPO_ROOT });
    const outline = sessionOutline(p, planSteps);
    say(
      `S-D session outline [dry run] (${steps.length} steps; Window dock paths allow-listed: ${p.windowPaths.map((x) => x.join(" > ")).join(", ") || "none"}; U30 re-run ${p.u30Rerun ? "on" : "off"}; worst case ${Math.round(worstCaseTotalMs(steps) / 60_000)} min, an estimate)`,
    );
    if (selecting) {
      const refusal = selectionRefusal(
        {
          from: o.from ?? null,
          until: o.until ?? null,
          only: o.only ?? null,
          runDir: o["run-dir"] !== undefined,
        },
        steps,
      );
      say(
        refusal
          ? `the real run would refuse this selection: ${refusal}`
          : `this invocation: ${ids.join(", ")}; worst case (an estimate) ${invocationWorstCaseMs(ids, steps)} ms`,
      );
    }
    for (const l of outline) say(toPlaceholders(l, ph));
    say(
      "invocations, one block each (worst case an estimate; run each in the background with a timeout above it):",
    );
    for (const b of BLOCKS) {
      say(
        `    ${blockArgs(b)}: ${invocationWorstCaseMs(selectedIds({ from: b.from, until: b.until }, steps), steps)} ms`,
      );
    }
    const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
    say(`action plan: ${plan.length} actions; dry-run check: ${formatResult(check)}`);
    if (o.out)
      writeFileSync(o.out, toPlaceholders(JSON.stringify(plan, null, 2), ph) + "\n", "utf-8");
    if (o.outline) writeFileSync(o.outline, toPlaceholders(outline.join("\n"), ph) + "\n", "utf-8");
    return check.ok ? EXIT.done : EXIT.refused;
  }

  if (!o.id) {
    err("a real run needs --id <lane id> (the lane that holds the lease)");
    stopped("usage: no --id");
    return EXIT.usage;
  }
  if (!o["registry-export"]) {
    err("a real run needs --registry-export <the pre-flight reg export>");
    stopped("usage: no --registry-export");
    return EXIT.usage;
  }
  const iniRefusal = forceSettingsRefusal(o["force-settings"], artifactsRoot, over.exists);
  if (iniRefusal) {
    err(`refused: ${toPlaceholders(iniRefusal, ph)}`);
    stopped("refused: --force-settings");
    return EXIT.refused;
  }
  const forceSettings = resolve(o["force-settings"]!);
  const selRefusal = selectionRefusal(
    {
      from: o.from ?? null,
      until: o.until ?? null,
      only: o.only ?? null,
      runDir: o["run-dir"] !== undefined,
    },
    steps,
  );
  if (selRefusal) {
    err(`refused: ${selRefusal}`);
    stopped(`refused: ${selRefusal}`);
    return EXIT.usage;
  }
  if (walkerCmd) {
    const bad = walkerCmdRefusal(walkerCmd, o.id);
    if (bad) {
      err(`refused: ${bad}`);
      stopped(`refused: ${bad}`);
      return EXIT.usage;
    }
  }
  let lane: Lane;
  try {
    lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    stopped("usage: lane");
    return EXIT.usage;
  }
  const reason = liveGateReason({ really, platform, leaseHeld: lane.holdsLease() });
  if (reason) {
    say(reason);
    stopped(`refused: ${reason}`);
    return EXIT.refused;
  }
  const needConfig = !o.sandbox || !o["logs-path"];
  let config: ReturnType<typeof loadConfig> | null = null;
  try {
    config = needConfig ? loadConfig() : null;
  } catch (e) {
    err(`configuration: ${e instanceof Error ? e.message : String(e)}`);
    stopped("usage: configuration");
    return EXIT.usage;
  }
  const sandboxDir = resolve(o.sandbox ?? join(config!.projectPath, SANDBOX_NAME));
  const gproj = join(sandboxDir, `${SANDBOX_NAME}.gproj`);
  ph = defaultPlaceholderContext({ sandbox: sandboxDir, v2: REPO_ROOT });
  const leaseProject = lane.recordedProject();
  if (
    basename(sandboxDir) !== SANDBOX_NAME ||
    leaseProject === null ||
    resolve(dirname(leaseProject)).toLowerCase() !== sandboxDir.toLowerCase()
  ) {
    const why =
      leaseProject === null
        ? "the lease records no project: run preflight.ts (default variant) first"
        : `the lease records the project ${toPlaceholders(leaseProject, ph)}, not ${toPlaceholders(gproj, ph)}`;
    err(`refused: ${why}`);
    stopped(`refused: ${why}`);
    return EXIT.refused;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(o["run-dir"] ?? join(artifactsRoot, "sessions", SESSION, stamp));
  const outside = outsideArtifacts(runDir, artifactsRoot);
  if (outside) {
    err(`refused: ${outside}`);
    stopped("refused: the run folder is not inside the artifacts folder");
    return EXIT.refused;
  }
  const build =
    o.build ??
    recordedBuild(join(REPO_ROOT, "data", "census", "ledger.meta.json"))?.build ??
    "unknown";
  const input: RealDepsInput = {
    lane,
    port: o.port ? Number(o.port) : (config?.workbenchPort ?? DEFAULT_PORT),
    sandboxDir,
    logsPath: o["logs-path"] ?? config?.logsPath ?? null,
    runDir,
    evidenceDir: join(runDir, "evidence"),
    build,
    placeholders: ph,
  };
  const deps = (over.deps ?? realDeps)(input);
  const opts: SdOptions = {
    sandboxDir,
    gproj,
    from: o.from ?? null,
    until: o.until ?? null,
    only: o.only ?? null,
    openedProjectPattern: o["opened-project-pattern"] ?? OPENED_PROJECT_PATTERN,
    allowedAddons: (o["allowed-addons"] ?? "ArmaReforger")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    nonce,
    runDir,
    laneId: lane.id,
    policy,
    registryExport: o["registry-export"],
    debugModeUnsetOk: args.flags.has("debug-mode-unset-ok"),
    forceSettings,
    u30Rerun,
    ownerClicked,
    walkerCmd,
    ownedModuleClasses: (o["owned-module-classes"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const ids = selectedIds({ from: opts.from, until: opts.until, only: opts.only }, steps);
  deps.log(
    `S-D real run, lane ${lane.session}, run folder ${runDir}, nonce ${nonce}; steps ${ids.join(", ")}; this invocation's worst case (an estimate): ${invocationWorstCaseMs(ids, steps)} ms`,
  );
  lane.startHeartbeat(60_000);
  try {
    const report = await runSession(opts, deps, steps);
    deps.writeArtifact(`summary-${nonce}.json`, report);
    if (report.stop)
      deps.log(`STOPPED at ${report.stop.step} (${report.stop.kind}): ${report.stop.reason}`);
    else deps.log(`S-D block done: ${ids[0]} to ${ids[ids.length - 1]}`);
    return report.exit;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    err(m);
    stopped(`exception: ${m}`);
    return EXIT.refused;
  } finally {
    lane.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
