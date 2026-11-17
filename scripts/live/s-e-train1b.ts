/**
 * Session S-E (plan 8 Phase 2 table), train #1b: a GUI Workbench on the 2.0 sandbox with the
 * shipped handler set, the read-only probe pack (`mod-dev/probe`, `ECEN_Probe`) AND the mutating
 * probe pack (`mod-dev/probe-mut`, one NET function `ECEN_ProbeMut` dispatching on `action`). It
 * carries the 46 entries of `data/census/probes.jsonl` whose `scheduled_session` names S-E, over
 * three launches in one sitting (launch 1, an offline step, launch 2, and launch 3 only on the
 * owner's ruling of Q3).
 *
 * DRY RUN BY DEFAULT. Without --really the script touches nothing: it prints the session outline
 * and the ACTION PLAN (the JSON array `scripts/live/dry-run.ts` checks), checks the plan against
 * the policy, and writes the plan to --out. A real run needs --really, a win32 host and the lease
 * held by the lane given with --id (the one gate of `cli.ts`). The runbook is
 * docs/v2/sessions/queues/S-E.md; the queue is docs/v2/sessions/queues/S-E-queue.json
 * (`--emit-queue` rewrites it from the step table below, and a test keeps the two equal).
 *
 * The model is scripts/live/s-d-train1.ts (S-D): the same gate, one declared block or one step per
 * invocation, started markers, no retry after a timeout, the modal check after every call, the
 * authorization handoff kept as the safety net (`--owner-clicked`), `recover`, `acknowledge` and
 * `rollback`, evidence records through evidence.ts. Built in from DEC-042 and the main session's
 * rulings for S-E:
 *
 * 1. One NET call at a time; no second socket anywhere in S-E.
 * 2. Every call that can open a dialog runs in a detached child while the parent polls the window
 *    list: OpenResource, SetOpenedResource (containerWriteTest, pluginRunDialogFree), Run
 *    (pluginRunDialogFree), ReloadScripts, and the file writes that can raise "Script
 *    Authorization Required" when the flag is absent (createSandboxWorlds, saveContainer, the
 *    layer save). A new dialog-like window, or a disabled main window, while it waits is a stop;
 *    in se-16 it is a handoff (Q6).
 * 3. The Particle Editor is never addressed: no call names the module, and a `.ptc` goes only
 *    through loadContainer and saveContainer. The script refuses any other call at the send.
 * 4. `MainMenuWorld.ent` is never named in any call.
 * 5. Edit > Undo goes only through the shipped `EMCP_WB_EditorControl {action: "undo"}`, only in
 *    se-09 and se-14, and only after the step has read (ECEN_Probe layerRead) that the open world
 *    is the throwaway world under `_throwaway/` with one sub-scene. Refused in every other place
 *    and spelling, as S-D refuses it.
 * 6. Every mutating-pack target lies under `_throwaway/`; createSandboxWorlds' target is
 *    `$EMCP2_sandbox:_throwaway/...`; `save: true` is never sent to terrainWriteThrowaway (review
 *    H2); `moduleSave` is never sent.
 * 7. Launch 1 ends by the owner's hand (File > Exit, Don't Save); launch 2's se-24 is the close
 *    test (one WM_CLOSE). se-19 runs between them with `--offline`, which refuses while any
 *    Workbench process exists. Launch 3 (se-30, se-31) runs only with `--u15-launch3` and
 *    `--owner-go-u15-launch3` (Q3 is the owner's and deferred).
 * 8. Conditional steps record their skip and its reason: se-03 (the tiny world exists), se-04
 *    (`probe_mut.diag_set_allow_list` empty, Q8), se-12 to se-15 (no terrain copy under
 *    `_throwaway/SE/terrain/`: Q1 held by the owner), se-15 (`plugin_run_allow_list` empty, Q8),
 *    se-30 and se-31 (Q3). A block whose every step is skipped before any NET call runs no gate.
 * 9. The repeat sitting (DEC-044): `--repeat` runs the gate, se-03, se-08 to se-11 and the close
 *    test se-24 in one launch. se-03 passes only when createSandboxWorlds reports both worlds
 *    registered with {GUID}-prefixed names and writes them to the run file worlds.json; se-08 and
 *    se-23 open the tiny world by that name (else by its path, recording which). The steps session
 *    007 answered are refused in a real run unless `--repeat-all` is given.
 *
 * Every operation that touches a process, a socket, the desktop or the file system outside the
 * artifacts folder goes through `SeDeps`, so the control flow runs against mocks in
 * tests/live-harness/s-e-train1b.test.ts. Sandbox writes only under `<sandbox>/_throwaway/` and the
 * U14 folder `Scripts/WorkbenchGame/EMCP2_U14_Throwaway/`.
 *
 * Usage:
 *   npx --no tsx scripts/live/s-e-train1b.ts [--out <plan.json>] [--outline <file>]
 *       [--sandbox <dir>] [--emit-queue <file>] [--u15-launch3]
 *   npx --no tsx scripts/live/s-e-train1b.ts plant --run-dir <dir> --id <lane id> [--sandbox <dir>] [--really]
 *   npx --no tsx scripts/live/s-e-train1b.ts --really --id <lane id>
 *       --registry-export <pre-flight .reg> --force-settings <scratch.ini under the artifacts folder>
 *       (--from <step id> --until <step id> | --only <step id>)   one declared block or step
 *       | --repeat                                                   the repeat sitting (DEC-044)
 *       [--repeat-all] [--run-dir <dir>] [--owner-clicked <button>[,<button>...]] [--offline]
 *       [--u15-launch3 --owner-go-u15-launch3] [--debug-mode-unset-ok] [--sandbox <dir>]
 *       [--opened-project-pattern <regex>] [--allowed-addons a,b] [--owned-module-classes a,b]
 *       [--build <tag>] [--port 5775] [--lease-path p] [--marker-path p] [--nonce <hex>]
 *   npx --no tsx scripts/live/s-e-train1b.ts recover --run-dir <dir> --id <lane id> [--owner-go <pid>] [--really]
 *   npx --no tsx scripts/live/s-e-train1b.ts rollback --run-dir <dir> --id <lane id> [--sandbox <dir>] [--remove-throwaway] [--really]
 *   npx --no tsx scripts/live/s-e-train1b.ts acknowledge --run-dir <dir> --id <lane id> --step <id> [--owner-ack] [--really]
 *
 * Exit: 0 done (or dry run passed), 1 refused or plan check failed, 2 usage, 3 stopped for the
 *       main session, 4 aborted (not the sandbox), 5 handoff (a dialog for the owner; resume with
 *       --only the next step).
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config.js";
import { OPENED_PROJECT_PATTERN } from "../census/enumerators/e13-launch-logs.js";
import { captureDesktop } from "./capture.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import { rewriteStrings, writeEvidence } from "./evidence.js";
import { Lane } from "./lane.js";
import { U14_THROWAWAY_FOLDER, WORKBENCH_EXE, isProbePackFile, probePackTarget } from "./launch.js";
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
import { CLOSE_SCRIPT, readRegFile, writeGracefulExit } from "./postflight.js";
import { newestSessionLog, openedProjectFromLog, recordedBuild } from "./preflight.js";
import { lastLine, runPowerShell } from "./powershell.js";
import {
  HELPER,
  INVOCATION_MARGIN_MS,
  STALL_SCRIPT,
  StopSession,
  TIMEOUTS as SC_TIMEOUTS,
  U13_DEFAULTS,
  VANILLA as SC_VANILLA,
  WINDOWS_SCRIPT,
  acceptedWindow,
  baselineProblem,
  blockArgs,
  childRequest,
  componentIndex,
  detachedBudgetMs,
  forceSettingsRefusal,
  iniScriptDebugMode,
  insideDir,
  isDialogLike,
  loadedProjectsOf,
  loadedProjectsProblem,
  namesSandbox,
  parseWindows,
  rawNetCall,
  runChildCall,
  scriptDebugMode,
  sha256Hex,
  titleNames,
  windowChanges,
  windowsForEvidence,
  type CallRecord,
  type CallSpec,
  type DetachedSpec,
  type RawCallResult,
  type RiskClass,
  type StepOutcome,
  type StepStatus,
  type StopKind,
  type WindowInfo,
} from "./s-c-natives.js";
import {
  AUTH_BUTTONS,
  AUTH_CLASS,
  AUTH_LOG,
  AUTH_TITLE,
  HUNG_HELPER_MS,
  HUNG_SCRIPT,
  MAIN_TITLE_PREFIX,
  VANILLA as SD_VANILLA,
  authLogEntries,
  authWindow,
  isNeverPath,
  mainWindowOf,
  nonceProblem,
  pageCountOf,
  probeFacts,
  probeStatus,
  scanSessionLog,
  type AuthButton,
  type LogScan,
  type NotAnswered,
} from "./s-d-train1.js";
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

export const SESSION = "S-E";

/** Repo-relative id of this script, as dry-run exceptions name scripts. */
export const SCRIPT_PATH = "scripts/live/s-e-train1b.ts";

const SCRIPT_ABS = fileURLToPath(import.meta.url);

/** `node --import <this>` runs a .ts file (node_modules/.bin/tsx cannot be spawned without a shell). */
const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/** The queue file this script's step table produces (`--emit-queue`). */
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-E-queue.json");

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
/** The NET function of the mutating probe pack (mod-dev/probe-mut/ECEN_ProbeMut.c). */
export const MUT_API = "ECEN_ProbeMut";
/** The host addon's NET function of launch 3 (Q3; the addon is not authored yet). */
export const HOST_PING_API = "ECEN_HostPing";
export const HOST_ADDON = "ECEN_HostAddon";

/** The sandbox folder every write lies in (ECEN_ProbeMutGuard.THROWAWAY). */
export const THROWAWAY = "_throwaway";
/** S-E's own subfolder of it; everything the sitting writes there lies under it. */
export const SE_ROOT = `${THROWAWAY}/SE`;
export const WORLDS_DIR = `${SE_ROOT}/worlds`;
export const TINY_NAME = "ECEN_SE_Tiny";
export const FLAT_NAME = "ECEN_SE_Flat";
/** The tiny throwaway world (project-relative, forward slashes). */
export const TINY_WORLD = `${WORLDS_DIR}/${TINY_NAME}.ent`;
/** Where the harness copies the owner's terrain world (Q1, held: absent). */
export const TERRAIN_DIR = `${SE_ROOT}/terrain`;
export const U16_DIR = `${SE_ROOT}/u16`;
export const U11_DIR = `${SE_ROOT}/u11`;
export const U11_RESAVED = `${U11_DIR}/resaved`;
export const U25_DIR = `${SE_ROOT}/u25`;
export const U25_MOVED = `${U25_DIR}/moved`;
/** The layer se-11 creates and se-23 looks for. */
export const LAYER_NAME = "ECEN_SE_L1";
/** se-16's broken file (S-A's undefined type and call), in S-A's U14 folder. */
export const U14_FOLDER_REL = `Scripts/WorkbenchGame/${U14_THROWAWAY_FOLDER}`;
export const U14_FILE = "ECEN_U14_Broken.c";
export const U14_SOURCE = [
  "// Deliberately broken for unknown U14 (session S-E, se-16). Planted after the gate in a",
  "// throwaway script folder and removed by the same step; never shipped.",
  "class ECEN_U14_Broken",
  "{",
  "\tvoid Broken()",
  "\t{",
  "\t\tECEN_U14_NoSuchType y = new ECEN_U14_NoSuchType();",
  "\t\tECEN_U14_NoSuchFunction(y);",
  "\t}",
  "}",
  "",
].join("\n");

/** Steps where Edit > Undo may be sent (ruling Q4), and only after the throwaway-world check. */
export const UNDO_STEPS = ["se-09-u19-undo", "se-14-u18-modify"] as const;
/** The steps that open the tiny world through the shipped openResource. */
const OPEN_STEPS = ["se-08-world-open-tiny", "se-23-world-reopen-tiny"] as const;
/**
 * The shipped openResource answers status ok with "Opened resource: <path>" when
 * SetOpenedResource returned true, and (historically, src/tools/wb-editor.ts) status ok with
 * "SetOpenedResource returned false for: <path>" when it did not: the message decides.
 */
export function shippedOpened(o: { response?: unknown }): boolean {
  const status = field(o.response, "status");
  const message = String(field(o.response, "message") ?? "");
  return status === "ok" && /^Opened resource/.test(message);
}
/** The menu path the shipped undo runs (EMCP_WB_EditorControl.c:102). */
export const UNDO_PATH = ["Edit", "Undo"] as const;

/** The modules se-07 writes in (the Particle Editor is never addressed, DEC-042). */
export const U8_MODULES: ReadonlyArray<{ name: string; target: string }> = [
  { name: "AnimEditor", target: `${U16_DIR}/flag.agr` },
  { name: "AudioEditor", target: `${U16_DIR}/UI_Respawn.acp` },
  { name: "BehaviorEditor", target: `${U16_DIR}/WP_Blank.bt` },
  { name: "ProcAnimEditor", target: `${U11_DIR}/ECEN_SE_U11_stripped.pap` },
  { name: "ResourceManager", target: `${U16_DIR}/inputCommon.conf` },
];

/** The module the script never names in any call (DEC-042). */
export const NEVER_MODULE = "ParticleEditor";

/**
 * se-05's vanilla sources (read from the 1.8.0.13 paks while this file was written, through
 * src/pak/vfs.ts): S-D's seven, plus the smallest .agf with nodes, .asi and .pap.
 */
export const U16_SOURCES: readonly string[] = [
  SD_VANILLA.conf,
  SD_VANILLA.emat,
  SD_VANILLA.layout,
  SD_VANILLA.agr,
  SD_VANILLA.bt,
  SD_VANILLA.ptc,
  SD_VANILLA.acp,
  /** 465 bytes, one state machine and one source node. */
  "Assets/Props/Fabric/Workspace/flag.agf",
  /** 98 bytes, the smallest .asi. */
  "Assets/Weapons/Mortars/workspaces/2B14.asi",
  SD_VANILLA.pap,
];

/** Target of a se-05 copy: `_throwaway/SE/u16/<file name>`. */
export function u16Target(source: string): string {
  return `${U16_DIR}/${source.slice(source.lastIndexOf("/") + 1)}`;
}

export const TIMEOUTS = {
  cheap: 10_000,
  probe: 30_000,
  bohemia: 30_000,
  container: 120_000,
  save: 120_000,
  moduleOpen: 120_000,
  containerWrite: 300_000,
  openTiny: 600_000,
  openTerrain: 900_000,
  plugin: 300_000,
  reload: 900_000,
  /** How long a detached child keeps waiting beyond its call's own timeout (S-D's authClick). */
  authClick: 900_000,
  ready: SC_TIMEOUTS.ready,
  poll: SC_TIMEOUTS.poll,
  detachedGrace: SC_TIMEOUTS.detachedGrace,
  close: SC_TIMEOUTS.close,
} as const;

/** Pages of a paged probe table read at most. */
export const MAX_PAGES = 3;

/** Worst case of a detached call: S-C's detached budget plus the modal check after it. */
export const detachedMs = (timeoutMs: number): number =>
  detachedBudgetMs(timeoutMs) + HELPER.windows;
/** Worst case of a plain call and its modal check. */
const plainMs = (timeoutMs: number): number => timeoutMs + HELPER.windows;

/**
 * The declared blocks, one per invocation (DEC-032). Only the first may start a run folder; se-19
 * runs only with --offline; launch 3 only with --u15-launch3 (else its steps record the skip).
 */
export const BLOCKS: ReadonlyArray<{ from: string; until: string }> = [
  { from: "se-01-u25-first-start", until: "se-02-u11-load-handedits" },
  { from: "se-03-worlds-create", until: "se-03-worlds-create" },
  { from: "se-04-u34-diag-set", until: "se-04-u34-diag-set" },
  { from: "se-05-u16-save", until: "se-05-u16-save" },
  { from: "se-06-u11-resave", until: "se-06-u11-resave" },
  { from: "se-07-u8-AnimEditor", until: "se-07-u8-ResourceManager" },
  { from: "se-08-world-open-tiny", until: "se-11-u17-layer-create" },
  { from: "se-12-world-open-terrain", until: "se-15-u10-run" },
  { from: "se-16-u14-reload-broken", until: "se-16-u14-reload-broken" },
  { from: "se-19-offline-moves", until: "se-19-offline-moves" },
  { from: "se-20-gate", until: "se-24-close-test" },
  { from: "se-30-u15-gate", until: "se-31-u15-host-ping" },
];

/** The offline step: no gate, no NET call, only with --offline. */
export const OFFLINE_STEP = "se-19-offline-moves";

/**
 * The repeat sitting (DEC-044, `--repeat`): only the steps that did not answer in session 007, in
 * one launch after the gate: se-03 (the worlds, now registered; its skip rule unchanged), se-08 to
 * se-11 (the tiny world, U19, U13, U17) and the close test se-24, which closes that same launch.
 */
export const REPEAT_STEPS = [
  "se-03-worlds-create",
  "se-08-world-open-tiny",
  "se-09-u19-undo",
  "se-10-u13-component",
  "se-11-u17-layer-create",
  "se-24-close-test",
] as const;
/** The steps session 007 answered: refused in a real run unless `--repeat-all` is given. */
export const ANSWERED_IN_007: readonly string[] = [
  "se-01-u25-first-start",
  "se-02-u11-load-handedits",
  "se-04-u34-diag-set",
  "se-05-u16-save",
  "se-06-u11-resave",
  ...U8_MODULES.map((m) => `se-07-u8-${m.name}`),
  "se-16-u14-reload-broken",
  OFFLINE_STEP,
  "se-20-gate",
  "se-21-u25-second-start",
  "se-22-texture-validator",
];
export const ANSWERED_NOTE = "answered in session 007, not run in the repeat";
/** The run file se-03 writes with the registered world names (se-08 and se-23 read it). */
export const WORLDS_FILE = "worlds.json";
/** A GUID-prefixed resource name (MetaFile.GetResourceID through ShowPath). */
export const RESOURCE_NAME_RE = /^\{[0-9A-F]{16}\}/;

/** The rulings the owner has not given (Q1 held, Q3 deferred, Q8 not ruled) and what they gate. */
export const RULINGS_PENDING = [
  {
    id: "Q1",
    owner: true,
    state: "held by the owner (no terrain world for S-E)",
    gates: ["se-12-world-open-terrain", "se-13-u18-tile", "se-14-u18-modify", "se-15-u10-run"],
    effect:
      "skipped with the recorded reason 'Q1 held by the owner; U18 and the U10 Run half carried to an S-E repeat'",
  },
  {
    id: "Q3",
    owner: true,
    state: "deferred by the owner",
    gates: ["se-30-u15-gate", "se-31-u15-host-ping"],
    effect:
      "launch 3 runs only with --u15-launch3 --owner-go-u15-launch3, a pre-flight -addonsDir option (not written: a separate owner-ruled change) and the authored host addon; otherwise both steps record a skip and U15 is 'not settled: needs -addonsDir'",
  },
] as const;

/** Owner rulings given since the design (applied; recorded in the queue). */
export const RULINGS_GIVEN = [
  {
    id: "Q8",
    state:
      "ruled by the owner 2026-10-08 (923416c): diag_set_allow_list script:DEBUGUI_AI_PRINT_DEBUG; plugin_run_allow_list WorldEditor SCR_SnapAndOrientToTerrainPlugin; on the condition that everything is set back to normal in the same step",
    steps: ["se-04-u34-diag-set", "se-15-u10-run"],
    effect:
      "se-04 runs and restores the option; se-15 is no longer list-gated but stays gated on the terrain world (Q1 held), so it skips this sitting; its restore is authored",
  },
] as const;

/** Reason texts of the conditional skips (recorded in the step's result). */
export const SKIP_REASON = {
  q1: "Q1 held by the owner; U18 and the U10 Run half carried to an S-E repeat (no terrain world copied into _throwaway/SE/terrain/)",
  q3: "Q3 deferred by the owner: launch 3 runs only with --u15-launch3 and --owner-go-u15-launch3; U15 not settled: needs -addonsDir",
  q8diag:
    "probe_mut.diag_set_allow_list is empty, so diagSet refuses every option (U34's set half carried)",
  q8plugin:
    "probe_mut.plugin_run_allow_list holds no World Editor entry, so pluginRunDialogFree refuses (U10's Run half carried)",
} as const;

// ── Probe ids ────────────────────────────────────────────────────────────────

const E = (s: string): string => `P-E01-${s}`;

/** Probes, or parts of probes, this sitting does not answer (also in the runbook). */
export const NOT_ANSWERED: readonly NotAnswered[] = [
  {
    id: E("plugins-netapi-cli-L469"),
    part: "all",
    missing: "scripted context menus (_WB_GetContextMenuItems / _WB_OnContextMenu)",
    reason:
      "an action outside Appendix A; the second authoring pass (DEC-029) has not extended the pack",
    carried_to: "the Phase 3 L3 battery, or S-E after a pack extension",
  },
  {
    id: E("resource-manager-L663"),
    part: "all",
    missing: "the MetaFile schema of each resource class",
    reason: "an action outside Appendix A",
    carried_to: "the Phase 3.3 L08 battery",
  },
  {
    id: E("script-string-dialogue-L413"),
    part: "all",
    missing: "RunForced on SCR_BasicCodeFormatterPlugin; Run on SCR_AutocompletePlugin",
    reason:
      "RunForced is outside Appendix A; neither is a World Editor plugin for pluginRunDialogFree's one entry",
    carried_to: "the Phase 3 L3 battery",
  },
  {
    id: E("mcp-inventory-L348"),
    part: "all",
    missing: "enum-valued property writes (name, integer or neither)",
    reason: "U13 is one write on a float key (ruling Q5)",
    carried_to: "the Phase 3 component battery",
  },
  {
    id: E("anim-procanim-behavior-L414"),
    part: "part",
    answered_by: ["se-02-u11-load-handedits", "se-06-u11-resave"],
    missing: "Animation Editor 'Save Workspace' on a hand-edited .agf",
    reason:
      "WBModuleDef.Save() is compiled off (moduleSave refused) and 'save' is a refused menu word (Q10); only the SaveContainer re-save runs",
    carried_to: "Phase 3 with a ruled exception",
  },
  {
    id: E("anim-procanim-behavior-L484"),
    part: "part",
    answered_by: ["se-06-u11-resave"],
    missing: "whether the editor's own save wipes text-edited .agf nodes",
    reason: "as L414",
    carried_to: "Phase 3 with a ruled exception",
  },
  {
    id: E("anim-procanim-behavior-L416"),
    part: "part",
    answered_by: ["se-02-u11-load-handedits", "se-06-u11-resave"],
    missing:
      "whether the game loads a .pap / .siga without its compiled block; determinism of the block",
    reason: "no play mode or game launch in S-E",
    carried_to: "the U32 sitting",
  },
  {
    id: E("anim-procanim-behavior-L489"),
    part: "part",
    answered_by: ["se-02-u11-load-handedits", "se-06-u11-resave"],
    missing: "whether the runtime needs the compiled blocks",
    reason: "as L416",
    carried_to: "the U32 sitting",
  },
  {
    id: E("audio-particle-navmesh-L491"),
    part: "part",
    answered_by: ["se-02-u11-load-handedits", "se-06-u11-resave"],
    missing:
      "whether the game plays a reordered .acp; whether an open tab notices an external change",
    reason: "no game launch; no offline write while Workbench runs",
    carried_to: "the Phase 5 audio wave",
  },
  {
    id: E("audio-particle-navmesh-L493"),
    part: "part",
    answered_by: ["se-02-u11-load-handedits", "se-06-u11-resave"],
    missing: "whether the data build recompiles a stale .sig block; whether the game refuses one",
    reason: "no -buildData in S-E",
    carried_to: "the P-SA-builddata-form sitting",
  },
  {
    id: E("audio-particle-navmesh-L503"),
    part: "part",
    answered_by: ["se-02-u11-load-handedits", "se-06-u11-resave"],
    missing: "what the editor writes for a fresh emitter",
    reason: "the Particle Editor is out of S-E entirely (DEC-042 crash)",
    carried_to: "after the Particle Editor crash is understood",
  },
  {
    id: E("world-editor-L477"),
    part: "part",
    answered_by: ["se-09-u19-undo"],
    missing: "whether the history name appears in the undo history",
    reason: "no script reads the history list",
    carried_to: "P4-census (GUI)",
  },
  {
    id: E("world-editor-L479"),
    part: "part",
    answered_by: ["se-11-u17-layer-create", "se-23-world-reopen-tiny"],
    missing: "folders, SetEntitySubsceneLayer, the nested path format",
    reason: "one layer action only",
    carried_to: "the Phase 3 layers battery",
  },
  {
    id: E("mcp-inventory-L352"),
    part: "part",
    answered_by: ["se-11-u17-layer-create"],
    missing: "delete, rename, visibility",
    reason: "no pack action for them",
    carried_to: "the Phase 3 layers battery",
  },
  {
    id: E("world-editor-L480"),
    part: "part",
    answered_by: ["se-13-u18-tile", "se-14-u18-modify"],
    missing:
      "ModifyLayers' Material; the hole tools; terrain persistence (no terrain save, review H2)",
    reason: "not in terrainWriteThrowaway; save:true is never sent",
    carried_to: "Phase 5 W7",
  },
  {
    id: E("plugins-netapi-cli-L462"),
    part: "part",
    answered_by: ["se-15-u10-run"],
    missing: "attribute writes; a dialog plugin's Run",
    reason: "no attribute-write action; dialog plugins are never Run from handlers (U6, DEC-042)",
    carried_to: "the Phase 3 L3 battery",
  },
  {
    id: E("resource-manager-L682"),
    part: "part",
    answered_by: ["se-15-u10-run"],
    missing: "attribute writes; Execute, Resave, Find",
    reason: "no such action",
    carried_to: "the Phase 3 L3 battery",
  },
  {
    id: E("world-editor-L482"),
    part: "part",
    answered_by: ["se-15-u10-run"],
    missing: "Build shore map, Set camera orientation; a Run that opens ScriptDialog",
    reason: "one listed plugin at most",
    carried_to: "the Phase 3 L3 battery",
  },
  {
    id: E("anim-procanim-behavior-L407"),
    part: "part",
    answered_by: ["se-07-u8-AnimEditor", "se-07-u8-BehaviorEditor", "se-07-u8-ProcAnimEditor"],
    missing: "module Save() persistence",
    reason: "moduleSave compiled off",
    carried_to: "Phase 3 with a ruled exception (Q10)",
  },
  {
    id: E("audio-particle-navmesh-L487"),
    part: "part",
    answered_by: ["se-07-u8-AudioEditor"],
    missing: "module Save(); one container per tab",
    reason: "as L407",
    carried_to: "Phase 3 with a ruled exception (Q10)",
  },
  {
    id: E("resource-manager-L672"),
    part: "part",
    answered_by: ["se-07-u8-ResourceManager"],
    missing: "ResourceManager.Save(); whether a write marks the tab dirty",
    reason: "as L407; no getter reports a dirty tab",
    carried_to: "Phase 3 with a ruled exception (Q10)",
  },
  {
    id: "P-U8",
    part: "part",
    answered_by: ["se-07-u8-AnimEditor", "se-07-u8-ResourceManager"],
    missing: "set plus module Save persistence; the Particle Editor",
    reason:
      "as L407; persistence of plain files is U16's (SaveContainer); the Particle Editor is never addressed (DEC-042)",
    carried_to: "Phase 3 with a ruled exception (Q10)",
  },
  {
    id: E("mcp-inventory-L271"),
    part: "part",
    answered_by: ["se-10-u13-component"],
    missing: "ModifyComponentKey, edit sequences, enums",
    reason: "one shipped write only (Q5); the pack fallback was never authored (DEC-029)",
    carried_to: "the Phase 3 component battery",
  },
  {
    id: "P-U14",
    part: "part",
    answered_by: ["se-16-u14-reload-broken"],
    missing: "whether a broken file at launch also disables Bohemia's NET handlers",
    reason: "no broken-file relaunch in S-E; only the reload case runs (Q6)",
    carried_to: "the Phase 3 compile train",
  },
  {
    id: "P-U18",
    part: "part",
    answered_by: ["se-13-u18-tile", "se-14-u18-modify"],
    missing: "terrain persistence after a save",
    reason: "save:true is never sent to terrainWriteThrowaway (review H2)",
    carried_to: "an S-E repeat with a ruled save",
  },
];

/** The conditional steps' "not answered when skipped" entries, derived from the step table. */
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

export function notAnswered(steps: StepDef[] = buildSteps()): NotAnswered[] {
  return [...NOT_ANSWERED, ...conditionalNotAnswered(steps)];
}

// ── Types ────────────────────────────────────────────────────────────────────

/** Everything that would touch a process, a socket, the desktop or a file outside the artifacts folder. */
export interface SeDeps {
  net(apiFunc: string, params: Record<string, unknown>, timeoutMs: number): Promise<RawCallResult>;
  listWindows(): Promise<WindowInfo[]>;
  capture(label: string): Promise<{ ok: boolean; path: string; detail: string }>;
  guiStall(pid: number, samples: number, hwnd?: number | null): Promise<Array<number | null>>;
  hungApp(pid: number, hwnd?: number | null): Promise<boolean | null>;
  processImage(pid: number): string | null;
  processCreated(pid: number): Promise<number | null>;
  /** Pids of every running Workbench image (the offline step refuses while one runs). */
  workbenchPids(): number[];
  listRunFiles(): string[];
  /** Entry names of a sandbox folder (empty when it does not exist). */
  listDir(path: string): string[];
  /** Every file under a sandbox folder, relative with forward slashes (empty when absent). */
  listTree(path: string): string[];
  portOwners(): number[];
  crashReporters(): number[];
  /** WM_CLOSE (CloseMainWindow) and wait; se-24 and the abort path only. */
  closeGracefully(pid: number, timeoutMs: number): Promise<{ exited: boolean; detail: string }>;
  recordedPid(): number | null;
  heartbeat(): void;
  sessionLogAfter(after: number | null): string | null;
  readText(path: string): string;
  readRegLines(path: string): string[];
  fileExists(path: string): boolean;
  /** Bytes of a sandbox file under `_throwaway/` or the U14 folder. */
  readBytes(path: string): Buffer;
  /** Create a file under `_throwaway/` or the U14 folder (never overwrites; makes the folders). */
  writeFile(path: string, data: Buffer): void;
  /** Move a file inside `_throwaway/` (never overwrites). */
  moveFile(from: string, to: string): void;
  /** Remove a file under `_throwaway/` or the U14 folder. */
  removeFile(path: string): void;
  /** Remove a folder under `_throwaway/` or the U14 folder only when it is empty. */
  removeEmptyDir(path: string): void;
  startDetached(spec: DetachedSpec): number;
  readRunFile(name: string): string | null;
  appendRunLine(name: string, line: string): void;
  writeArtifact(name: string, value: unknown): string;
  writeEvidence(summary: string, artifactPath: string): string;
  /** Write the graceful-exit record post-flight reads (se-24). */
  writeGracefulExit(pid: number, how: string): string;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export interface SeOptions {
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
  /** --offline: se-19 only, no gate, refused while any Workbench runs. */
  offline: boolean;
  /** --u15-launch3 (with --owner-go-u15-launch3): se-30 and se-31 run. */
  u15Launch3: boolean;
  /** --repeat: the repeat sitting (REPEAT_STEPS after the gate, one launch). */
  repeat?: boolean;
  ownerClicked?: AuthButton | readonly AuthButton[] | null;
  ownedModuleClasses?: string[];
}

interface SeState {
  wbPid: number | null;
  startedPids: Set<number>;
  baselineWindows: WindowInfo[];
  yesToAll: boolean;
  mainHwnd: number | null;
  logScan: LogScan | null;
  /** The step whose throwaway-world check passed (Edit > Undo may be sent in it only). */
  throwawayConfirmed: string | null;
}

export interface DetachedOpts {
  /** Windows the call is expected to open (accepted by title; see acceptedWindow). */
  expected?: (w: WindowInfo) => boolean;
  /** A dialog during the call: "stop" (default) or "handoff" (se-16, Q6). */
  onDialog?: "stop" | "handoff";
}

export interface SeContext {
  opts: SeOptions;
  deps: SeDeps;
  state: SeState;
  calls: CallRecord[];
  step: string;
  call(spec: CallSpec): Promise<RawCallResult>;
  /** A call that can open a dialog: a detached child while the window list is polled. */
  detached(spec: CallSpec, label: string, o?: DetachedOpts): Promise<RawCallResult>;
  ourWindows(): Promise<WindowInfo[]>;
  modalCheck(label: string, expected?: (w: WindowInfo) => boolean): Promise<WindowInfo[]>;
  setBaseline(label: string): Promise<WindowInfo[]>;
}

export interface PlanInput {
  sandbox: string;
  nonce: string;
  /** The listed diag option (null: the list is empty, se-04 skips). */
  diag: DiagEntry | null;
  /** The listed World Editor plugin (null: the list is empty, se-15 skips). */
  plugin: { module: string; className: string } | null;
  /** The terrain copy's world (null: Q1 held, se-12 to se-15 skip). */
  terrainWorld: string | null;
  u15Launch3: boolean;
}

export interface DiagEntry {
  key: string;
  engine: boolean;
  diagEnum: string | null;
  diagId: number | null;
}

export interface StepDef {
  id: string;
  title: string;
  risk: RiskClass;
  /** 1, 2, 3 for the launches; 0 for the offline step between launch 1 and 2. */
  launch: 0 | 1 | 2 | 3;
  answers: string[];
  /** Probes whose S-C or S-D outcome says "rest to S-E" that the step also informs (not counted). */
  touches?: string[];
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  outline: string[];
  /** How the step sets everything back to normal (the owner's Q8 condition), when it changes state. */
  restore?: string;
  /** The owner ruling the step waits on (queue `waits_on`). */
  waitsOn?: "Q1" | "Q3" | "Q8";
  skipWhen?: { condition: string; carried_to: string };
  /** A skip decided without a NET call (no gate is needed for it). */
  preSkip?(o: SeOptions, deps: SeDeps): string | null;
  /** A skip decided after the gate (an earlier step's result). */
  skip?(ctx: SeContext): string | null;
  plan(p: PlanInput): PlanAction[];
  run(ctx: SeContext): Promise<StepOutcome>;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const S = (v: unknown): string => (typeof v === "string" ? v : "");

function field(response: unknown, name: string): unknown {
  return response && typeof response === "object"
    ? (response as Record<string, unknown>)[name]
    : undefined;
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

/** A call of the read-only pack. */
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

/** A call of the mutating pack. */
export function mut(
  action: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  note?: string,
): CallSpec {
  return { apiFunc: MUT_API, params: { action, ...params }, timeoutMs, ...(note ? { note } : {}) };
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

/** The ExecuteAction the shipped undo runs, beside its net-call (the checker reads the path). */
function undoAction(step: string, probes: string[]): PlanAction {
  return {
    kind: "execute-action",
    target: { path: [...UNDO_PATH], module: "WorldEditor" },
    step,
    probes,
    via: "EMCP_WB_EditorControl {action: undo}",
  };
}

/** Every string in a params object, nested values included. */
function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsOf(x, out));
  return out;
}

/** A project-relative write target the script may send: under `_throwaway/`, clean. */
export function throwawayTarget(t: unknown): boolean {
  if (typeof t !== "string") return false;
  const s = t.replace(/\\/g, "/");
  if (!s.startsWith(`${THROWAWAY}/`) || s.includes(":")) return false;
  return s.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/**
 * Why the script refuses to send a call, or null. Pure; the engine checks every call with it
 * (plain and detached). `confirmed` is the step whose throwaway-world check passed.
 */
export function sendRefusal(
  step: string,
  apiFunc: string,
  params: Record<string, unknown>,
  policy: CensusPolicy,
  confirmed: string | null,
): string | null {
  const hit = deniedApi(apiFunc, deniedApiNames(policy));
  if (hit) return `${apiFunc} is on the policy deny list (${hit})`;
  const strings = stringsOf(params);
  // DEC-042: the Particle Editor is never addressed; a .ptc only through load and save.
  if (strings.some((s) => s.trim().toLowerCase() === NEVER_MODULE.toLowerCase()))
    return "the Particle Editor is never addressed in S-E (DEC-042)";
  const action = S(params.action);
  if (
    /\.ptc$/i.test(S(params.ResourceName)) ||
    /\.ptc$/i.test(S(params.path) && apiFunc !== PROBE_API ? S(params.path) : "")
  )
    return "a .ptc is never opened in S-E (DEC-042): loadContainer and saveContainer only";
  if (
    apiFunc === MUT_API &&
    ["containerWriteTest", "pluginRunDialogFree"].includes(action) &&
    /\.ptc$/i.test(S(params.target))
  )
    return "a .ptc is never opened in a module in S-E (DEC-042)";
  // MainMenuWorld.ent is never named.
  if (strings.some((s) => /MainMenuWorld/i.test(s)))
    return "MainMenuWorld.ent is never named in S-E (DEC-042)";
  // Edit > Undo: the shipped EditorControl undo only, in se-09 and se-14, after the world check.
  if (apiFunc === PROBE_API && action === "executeAction")
    return "the probe pack's executeAction is never sent in S-E (Edit > Undo goes through EMCP_WB_EditorControl only)";
  if (/executeaction/i.test(apiFunc)) return `${apiFunc} is never sent in S-E`;
  if (apiFunc === "EMCP_WB_EditorControl") {
    // The shipped openResource (WorldEditor.SetOpenedResource, the 1.x tool's route) opens the
    // tiny throwaway world only, in the two open steps; the native OpenResource answered true
    // without loading anything (the S-E repeat of 2026-10-08/09).
    if (action.trim().toLowerCase() === "openresource") {
      if (!(OPEN_STEPS as readonly string[]).includes(step))
        return `EMCP_WB_EditorControl openResource is refused in ${step}: only se-08 and se-23 send it`;
      if (S(params.path).replace(/\\/g, "/") !== TINY_WORLD)
        return `EMCP_WB_EditorControl openResource opens only ${TINY_WORLD} in S-E`;
      return null;
    }
    if (action.trim().toLowerCase() !== "undo")
      return `EMCP_WB_EditorControl ${action || "(no action)"} is not used in S-E`;
    if (!(UNDO_STEPS as readonly string[]).includes(step))
      return `Edit > Undo is refused in ${step}: only se-09 and se-14 send it`;
    if (confirmed !== step)
      return `Edit > Undo is refused in ${step} until the open world is shown to be the throwaway world under ${THROWAWAY}/`;
  }
  if (apiFunc === "EMCP_WB_Terrain" && !["getHeight", "getBounds"].includes(action))
    return `EMCP_WB_Terrain ${action} is never sent in S-E (getHeight and getBounds only)`;
  if (apiFunc === MUT_API) {
    if (params.moduleSave === true) return "moduleSave is never sent";
    if (action === "createSandboxWorlds") {
      const t = S(params.target).replace(/\\/g, "/");
      const prefix = `$${SANDBOX_NAME}:`;
      if (!t.startsWith(prefix) || !throwawayTarget(t.slice(prefix.length)))
        return `createSandboxWorlds target ${t} is not $${SANDBOX_NAME}:${THROWAWAY}/...`;
    } else if (
      [
        "containerWriteTest",
        "saveContainer",
        "pluginRunDialogFree",
        "layerCreateThrowaway",
        "terrainWriteThrowaway",
      ].includes(action)
    ) {
      if (!throwawayTarget(params.target))
        return `${action} target ${S(params.target) || "(none)"} is not under ${THROWAWAY}/: writes outside it are refused`;
    }
    if (action === "terrainWriteThrowaway" && params.save === true)
      return "save:true is never sent to terrainWriteThrowaway (review H2)";
  }
  return null;
}

/**
 * The first scalar property of a container text (`key <number>`), preferring a line of the top
 * level of the root object (one level of indentation), then any depth; null when there is none
 * (review mut-containers F2: the variable must be one of GetContainer(0); a nested line may not be).
 */
export function firstScalar(
  text: string,
): { varName: string; value: string; next: string; topLevel: boolean } | null {
  const lines = text.split(/\r?\n/);
  const pick = (
    top: boolean,
  ): { varName: string; value: string; next: string; topLevel: boolean } | null => {
    for (const line of lines) {
      const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s+(-?\d+(?:\.\d+)?)\s*$/.exec(line);
      if (!m) continue;
      if (top && m[1].replace(/\t/g, " ").length !== 1) continue;
      const n = Number(m[3]);
      const next = m[3].includes(".") ? String(n + 1) : String(Math.trunc(n) + 1);
      return { varName: m[2], value: m[3], next, topLevel: top };
    }
    return null;
  };
  return pick(true) ?? pick(false);
}

/** The world path a layerRead answer names (ShowPath form), with forward slashes. */
export function worldPathOf(facts: Record<string, string>): string {
  return (facts.worldPath ?? "").replace(/\\/g, "/");
}

/**
 * Whether a layerRead answer shows the throwaway world `rel` open, with one sub-scene. The path
 * form GetWorldPath returns is [unverified] (review ro-pack F3): a leading `{GUID}` resource-name
 * prefix is stripped, and the project-relative form (`_throwaway/...`), the `<sandbox>/...` form
 * and an absolute path ending in `/<rel>` are all accepted, each only under `_throwaway/`.
 */
export function isThrowawayWorld(facts: Record<string, string>, rel: string): boolean {
  const p = worldPathOf(facts)
    .replace(/^\{[0-9A-Fa-f]{16}\}/, "")
    .replace(/^\$[^:]+:/, "")
    .toLowerCase();
  const r = rel.toLowerCase();
  const under = p === r || p.endsWith(`/${r}`);
  return under && r.startsWith(`${THROWAWAY}/`.toLowerCase()) && facts.subScenes === "1";
}

/** The path part of a resource name: a `{GUID}` prefix and a `$fs:` prefix stripped. */
export function resourcePathOf(name: string): string {
  return name
    .replace(/\\/g, "/")
    .replace(/^\{[0-9A-Fa-f]{16}\}/, "")
    .replace(/^\$[^:]+:/, "");
}

/** se-03's registration facts (DEC-044 fix, 9eed30b), as se-03 records them and worlds.json holds them. */
export interface WorldsRegistration {
  tinyRegistered: string | null;
  tinyResourceName: string | null;
  terrainRegistered: string | null;
  terrainResourceName: string | null;
}

/**
 * Why createSandboxWorlds' registration facts do not pass se-03, or null: both `<x>Registered`
 * "true" and both resource names GUID-prefixed (`{GUID}_throwaway/SE/worlds/<name>.ent`).
 */
export function registrationProblem(f: Record<string, string>): string | null {
  const why: string[] = [];
  for (const k of ["tiny", "terrain"] as const) {
    const reg = f[`${k}Registered`];
    const name = f[`${k}ResourceName`];
    if (reg !== "true")
      why.push(`${k}Registered ${reg === undefined ? "absent" : JSON.stringify(reg)}`);
    else if (!RESOURCE_NAME_RE.test(name ?? ""))
      why.push(
        `${k}ResourceName ${name === undefined ? "absent" : JSON.stringify(name)} is not {GUID}-prefixed`,
      );
  }
  return why.length ? `registration: ${why.join("; ")}` : null;
}

/**
 * What se-08 and se-23 send to OpenResource for the tiny world: the registered resource name from
 * worlds.json when it is there, registered, GUID-prefixed and names the tiny world; otherwise the
 * project-relative path session 007 sent, with the reason recorded.
 */
export function tinyOpenTarget(worldsJson: string | null): {
  resourceName: string;
  form: "resourceName" | "path";
  reason: string;
} {
  const fallback = (reason: string) => ({
    resourceName: TINY_WORLD,
    form: "path" as const,
    reason,
  });
  if (worldsJson === null) return fallback(`${WORLDS_FILE} absent (se-03 did not run or skipped)`);
  let w: Partial<WorldsRegistration>;
  try {
    w = JSON.parse(worldsJson) as Partial<WorldsRegistration>;
  } catch {
    return fallback(`${WORLDS_FILE} does not parse`);
  }
  const name = typeof w.tinyResourceName === "string" ? w.tinyResourceName : "";
  if (w.tinyRegistered !== "true")
    return fallback(`${WORLDS_FILE}: tinyRegistered ${String(w.tinyRegistered)}`);
  if (!RESOURCE_NAME_RE.test(name))
    return fallback(
      `${WORLDS_FILE}: tinyResourceName ${JSON.stringify(name)} is not {GUID}-prefixed`,
    );
  if (resourcePathOf(name).toLowerCase() !== TINY_WORLD.toLowerCase())
    return fallback(
      `${WORLDS_FILE}: tinyResourceName ${JSON.stringify(name)} does not name ${TINY_WORLD}`,
    );
  return {
    resourceName: name,
    form: "resourceName",
    reason: `the registered name from ${WORLDS_FILE}`,
  };
}

/** Whether a moduleMatrix answer shows `module` present after the open (review ro-pack F2). */
export function moduleOpened(response: unknown, module: string): boolean {
  const cols = field(response, "columns");
  const cells = field(response, "cells");
  if (!Array.isArray(cols) || !Array.isArray(cells) || !cols.length) return false;
  const w = cols.length;
  const iName = cols.indexOf("module");
  const iPresent = cols.indexOf("present");
  if (iName < 0 || iPresent < 0) return false;
  for (let i = 0; i + w <= cells.length; i += w)
    if (String(cells[i + iName]) === module && String(cells[i + iPresent]) === "true") return true;
  return false;
}

/** The ids of an ECEN_Probe info addon table (columns guid,id,title,vanilla). */
export function infoAddonIds(response: unknown): string[] {
  const cols = field(response, "columns");
  const cells = field(response, "cells");
  if (!Array.isArray(cols) || !Array.isArray(cells) || !cols.length) return [];
  const iId = cols.indexOf("id");
  if (iId < 0) return [];
  const out: string[] = [];
  for (let i = 0; i + cols.length <= cells.length; i += cols.length)
    out.push(String(cells[i + iId]));
  return out;
}

/** A policy diag entry ({key: "script:<SCR_DebugMenuID>" | "engine:<id>"}) parsed, or null. */
export function diagEntryOf(policy: CensusPolicy): DiagEntry | null {
  const list = (policy as { probe_mut?: { diag_set_allow_list?: Array<{ key?: string }> } })
    .probe_mut?.diag_set_allow_list;
  const key = Array.isArray(list) && list.length ? S(list[0]?.key) : "";
  const m = /^(script|engine):(.+)$/.exec(key);
  if (!m) return null;
  if (m[1] === "engine") {
    const id = Number(m[2]);
    return Number.isInteger(id) ? { key, engine: true, diagEnum: null, diagId: id } : null;
  }
  return { key, engine: false, diagEnum: m[2], diagId: null };
}

/** The first World Editor entry of `probe_mut.plugin_run_allow_list`, or null. */
export function pluginEntryOf(policy: CensusPolicy): { module: string; className: string } | null {
  const list = (
    policy as { probe_mut?: { plugin_run_allow_list?: Array<{ module?: string; class?: string }> } }
  ).probe_mut?.plugin_run_allow_list;
  const e = Array.isArray(list) ? list.find((x) => x?.module === "WorldEditor") : undefined;
  return e && S(e.class) ? { module: "WorldEditor", className: S(e.class) } : null;
}

/** The terrain copy's world: the first .ent directly in `_throwaway/SE/terrain/`, or null. */
export function terrainWorldOf(sandboxDir: string, deps: Pick<SeDeps, "listDir">): string | null {
  const ent = deps
    .listDir(join(sandboxDir, ...TERRAIN_DIR.split("/")))
    .filter((f) => /\.ent$/i.test(f))
    .sort()[0];
  return ent ? `${TERRAIN_DIR}/${ent}` : null;
}

/** The absolute path of a project-relative sandbox path. */
export function abs(sandboxDir: string, rel: string): string {
  return join(sandboxDir, ...rel.split("/"));
}

function runJson<T>(deps: Pick<SeDeps, "readRunFile">, name: string): T | null {
  const text = deps.readRunFile(name);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function priorStatus(ctx: Pick<SeContext, "deps">, id: string): string | null {
  return runJson<{ status?: string }>(ctx.deps, `${id}.json`)?.status ?? null;
}

function nextStep(steps: StepDef[], id: string): string | null {
  const i = steps.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < steps.length ? steps[i + 1].id : null;
}

/** What this run folder knows of `pid` (as S-D's knownPid, with S-E's gate file). */
export function knownPid(
  deps: Pick<SeDeps, "listRunFiles" | "readRunFile">,
  pid: number,
  created: number | null,
): "reused" | "known" | "new" {
  if (created === null) return "new";
  const files = deps.listRunFiles();
  let known = false;
  for (const f of files) {
    const m = /^(.+)\.started(\.acknowledged)?$/.exec(f);
    if (!m) continue;
    const marker = runJson<StartedMarker>(deps, f);
    if (!marker || marker.pid !== pid || marker.created === null) continue;
    if (marker.created !== created) return "reused";
    if (files.includes(`${m[1]}.json`)) known = true;
  }
  const gate = runJson<{ status?: string; data?: { pid?: number; created?: number | null } }>(
    deps,
    "se-00-gate.json",
  );
  if (gate?.status === "pass" && gate.data?.pid === pid && gate.data.created === created)
    known = true;
  return known ? "known" : "new";
}

// ── The plants (offline, before launch 1) ────────────────────────────────────

/** One file the `plant` subcommand writes, with its record. */
export interface Plant {
  rel: string;
  data: Buffer;
  source: string | null;
  sourceSha256: string | null;
  edit: string;
}

/**
 * Meta class lines of the hand-written .meta files [unverified: no vanilla .meta is in the paks
 * (S-C), so these follow the MetaFileClass form the MCP writes; se-01 reads what Workbench makes
 * of them, which is U25's question].
 */
export const META_CLASS: Readonly<Record<string, string>> = {
  conf: "CONFResourceClass",
  et: "ETResourceClass",
  png: "PNGResourceClass",
};

/** A 1x1 opaque PNG (the smallest loose texture), base64. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A hand-written .meta for `rel` with `guid` (16 upper-case hex). */
export function metaText(rel: string, guid: string): string {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  const cls = META_CLASS[ext];
  if (!cls) throw new Error(`no meta class for .${ext}`);
  return `MetaFileClass {\n Name "{${guid}}${rel}"\n Configurations {\n  ${cls} PC {\n  }\n }\n}\n`;
}

/** Swap the first two scalar property lines (`key value`, no brace) at the same indentation. */
export function swapFirstScalars(text: string): string | null {
  const lines = text.split("\n");
  const scalar = (l: string): boolean => /^\s+[A-Za-z_]\w*\s+[^{}]+$/.test(l.replace(/\r$/, ""));
  for (let i = 0; i + 1 < lines.length; i++) {
    if (scalar(lines[i]) && scalar(lines[i + 1])) {
      const ind = (l: string): number => /^\s*/.exec(l)![0].length;
      if (ind(lines[i]) !== ind(lines[i + 1]) || lines[i] === lines[i + 1]) continue;
      [lines[i], lines[i + 1]] = [lines[i + 1], lines[i]];
      return lines.join("\n");
    }
  }
  return null;
}

/** Drop the quotes of every `key "Identifier"` value (the re-quoted plant). */
export function requote(text: string): string | null {
  let n = 0;
  const out = text.replace(
    /^(\s+[A-Za-z_]\w*\s+)"([A-Za-z_][A-Za-z0-9_]*)"(\r?)$/gm,
    (_m, a, v, cr) => {
      n++;
      return `${a}${v}${cr}`;
    },
  );
  return n ? out : null;
}

/** Remove the first line `key ...` (a scalar line) whose key matches `key`. */
export function dropLine(text: string, key: RegExp): string | null {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => key.test(l));
  if (i < 0) return null;
  lines.splice(i, 1);
  return lines.join("\n");
}

/** The last scalar property line (deepest body) removed: the "omitted key" edit. */
export function dropLastScalar(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].replace(/\r$/, "");
    if (/^\s{2,}[A-Za-z_]\w*\s+[^{}]+$/.test(l) && !/^\s*Version\b/.test(l)) {
      lines.splice(i, 1);
      return lines.join("\n");
    }
  }
  return null;
}

/** Add 10 to the first number of the first `EditorPos x y` line (one .agf node edited). */
export function editFirstNode(text: string): string | null {
  let done = false;
  const out = text.replace(/^(\s*EditorPos\s+)(-?\d+(?:\.\d+)?)/m, (_m, a, n) => {
    done = true;
    return `${a}${Math.round((Number(n) + 10) * 1000) / 1000}`;
  });
  return done ? out : null;
}

/** Strip the `compiled <Class> { ... }` block (by its indentation) of a .pap or .siga. */
export function stripCompiled(text: string): string | null {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^\s*compiled\s+\w+\s*\{\s*\r?$/.test(l));
  if (i < 0) return null;
  const ind = /^\s*/.exec(lines[i])![0];
  let j = i + 1;
  while (j < lines.length && lines[j].replace(/\r$/, "") !== `${ind}}`) j++;
  if (j >= lines.length) return null;
  lines.splice(i, j - i + 1);
  return lines.join("\n");
}

/** The u11 plants: hand-edited copies of vanilla files (se-02 loads them, se-06 re-saves them). */
export const U11_PLANTS: ReadonlyArray<{
  name: string;
  source: string;
  edit: string;
  apply: (t: string) => string | null;
}> = [
  {
    name: "ECEN_SE_U11_reordered.conf",
    source: SD_VANILLA.conf,
    edit: "two adjacent properties swapped",
    apply: swapFirstScalars,
  },
  {
    name: "ECEN_SE_U11_requoted.acp",
    source: SD_VANILLA.acp,
    edit: "quotes dropped from identifier values",
    apply: requote,
  },
  {
    name: "ECEN_SE_U11_reordered.ptc",
    source: SD_VANILLA.ptc,
    edit: "two adjacent properties swapped and the last scalar property omitted",
    apply: (t) => {
      const a = swapFirstScalars(t);
      return a === null ? null : dropLastScalar(a);
    },
  },
  {
    name: "ECEN_SE_U11_noversion.ptc",
    source: SD_VANILLA.ptc,
    edit: "the Version line removed",
    apply: (t) => dropLine(t, /^\s*Version\s/),
  },
  {
    name: "ECEN_SE_U11_edited.agf",
    source: "Assets/Props/Fabric/Workspace/flag.agf",
    edit: "the first node's EditorPos x + 10",
    apply: editFirstNode,
  },
  {
    name: "ECEN_SE_U11_stripped.pap",
    source: SD_VANILLA.pap,
    edit: "the compiled block removed",
    apply: stripCompiled,
  },
  {
    name: "ECEN_SE_U11_stripped.siga",
    source: "anims/proc/wheel_rot.siga",
    edit: "the compiled block removed",
    apply: stripCompiled,
  },
];

/** The u25 plants: name, vanilla source (null: generated), and whether a hand-written .meta goes beside. */
export const U25_PLANTS: ReadonlyArray<{
  name: string;
  source: string | null;
  meta: boolean;
  role: string;
}> = [
  {
    name: "ECEN_SE_U25_Control.conf",
    source: "Configs/Core/AIDebugCore.conf",
    meta: false,
    role: "control: no meta; se-19 moves it with the meta Workbench made",
  },
  {
    name: "ECEN_SE_U25_Rename.conf",
    source: "Configs/Core/AIDebugCore.conf",
    meta: false,
    role: "se-19 renames it without its meta",
  },
  {
    name: "ECEN_SE_U25_Meta.conf",
    source: "Configs/Core/AIDebugCore.conf",
    meta: true,
    role: "hand-written meta",
  },
  {
    name: "ECEN_SE_U25_Prefab.et",
    source: SC_VANILLA.propPath,
    meta: true,
    role: "hand-written meta",
  },
  {
    name: "ECEN_SE_U25_Texture.png",
    source: null,
    meta: true,
    role: "hand-written meta; se-22's TextureValidator input",
  },
];
export const U25_TEXTURE = `${U25_DIR}/ECEN_SE_U25_Texture.png`;

/** Build every plant from vanilla bytes (`read`) and fresh GUIDs (`guid`). Throws when an edit does not apply. */
export function buildPlants(
  read: (vpath: string) => Buffer,
  guid: () => string,
): { u25: Plant[]; u11: Plant[] } {
  const u25: Plant[] = [];
  for (const p of U25_PLANTS) {
    const data = p.source ? read(p.source) : TINY_PNG;
    const rel = `${U25_DIR}/${p.name}`;
    u25.push({
      rel,
      data,
      source: p.source,
      sourceSha256: p.source ? sha256Hex(data) : null,
      edit: p.role,
    });
    if (p.meta)
      u25.push({
        rel: `${rel}.meta`,
        data: Buffer.from(metaText(rel, guid()), "utf-8"),
        source: null,
        sourceSha256: null,
        edit: "hand-written .meta",
      });
  }
  const u11: Plant[] = [];
  for (const p of U11_PLANTS) {
    const src = read(p.source);
    const out = p.apply(src.toString("utf-8"));
    if (out === null)
      throw new Error(`${p.name}: the edit "${p.edit}" does not apply to ${p.source}`);
    u11.push({
      rel: `${U11_DIR}/${p.name}`,
      data: Buffer.from(out, "utf-8"),
      source: p.source,
      sourceSha256: sha256Hex(src),
      edit: p.edit,
    });
  }
  return { u25, u11 };
}

/** The plant records' shape (`plant-se-u25.json`, `plant-se-u11.json`). */
export interface PlantRecord {
  rel: string;
  sha256: string;
  source: string | null;
  sourceSha256: string | null;
  edit: string;
}

const recordOf = (p: Plant): PlantRecord => ({
  rel: p.rel,
  sha256: sha256Hex(p.data),
  source: p.source,
  sourceSha256: p.sourceSha256,
  edit: p.edit,
});

/** Rewrite the Name line of a .meta for a moved resource (as refactor_move_resource_path does). */
export function rewriteMetaName(text: string, fromRel: string, toRel: string): string {
  return text.replace(/^(\s*Name\s+"\{[0-9A-Fa-f]{16}\})([^"]*)(")/m, (m, a, p, z) =>
    p.toLowerCase() === fromRel.toLowerCase() ? `${a}${toRel}${z}` : m,
  );
}

// ── The step table ───────────────────────────────────────────────────────────

const DIALOG_KILL =
  'a new unowned or #32770 window of the pid, or a disabled main window, while a call is pending: STOP (the queue is blocked; pending calls reset after about 120 s, DEC-042); the owner closes the dialog by hand, or the main session by computer use on the owner\'s word after a heads-up; a window titled "Script Authorization Required" (not expected under -scriptAuthorizeAll): HANDOFF (exit 5), nothing clicked or keyed, the owner presses the button and says which; no answer within the call timeout: STOP, no retry, the child left running';

const u25Answers = ["P-U25", E("resource-manager-L664")];
const u11Load = [
  "P-U11",
  E("anim-procanim-behavior-L414"),
  E("anim-procanim-behavior-L415"),
  E("anim-procanim-behavior-L416"),
  E("anim-procanim-behavior-L488"),
  E("anim-procanim-behavior-L489"),
  E("audio-particle-navmesh-L491"),
  E("audio-particle-navmesh-L493"),
  E("audio-particle-navmesh-L503"),
  E("audio-particle-navmesh-L504"),
];

/** The u25 reads of se-01 and se-21 on a list of files. */
function resourceReads(id: string, answers: string[], files: string[]): PlanAction[] {
  return files.flatMap((rel) => [
    net(id, answers, {
      apiFunc: "GetResourceInfo",
      params: { path: rel, expandResource: false },
      timeoutMs: TIMEOUTS.bohemia,
    }),
    net(id, answers, {
      apiFunc: "GetPrefabGUID",
      params: { prefabPath: rel },
      timeoutMs: TIMEOUTS.bohemia,
    }),
  ]);
}

async function readResources(
  ctx: SeContext,
  files: string[],
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const rel of files) {
    const info = await ctx.call({
      apiFunc: "GetResourceInfo",
      params: { path: rel, expandResource: false },
      timeoutMs: TIMEOUTS.bohemia,
    });
    await ctx.modalCheck(`GetResourceInfo ${rel}`);
    const guid = await ctx.call({
      apiFunc: "GetPrefabGUID",
      params: { prefabPath: rel },
      timeoutMs: TIMEOUTS.bohemia,
    });
    await ctx.modalCheck(`GetPrefabGUID ${rel}`);
    const meta = abs(ctx.opts.sandboxDir, `${rel}.meta`);
    const metaOnDisk = ctx.deps.fileExists(meta);
    out.push({
      rel,
      resourceInfo: summarizeCall(info),
      prefabGuid: summarizeCall(guid),
      metaOnDisk,
      metaSha256: metaOnDisk ? sha256Hex(ctx.deps.readBytes(meta)) : null,
    });
  }
  return out;
}

/** One se-21 row from the payloads: GetResourceInfo status and resourceName, GetPrefabGUID status and guid. */
export function resourceLine(r: Record<string, unknown>): string {
  const part = (call: unknown, keys: string[]): string => {
    const c = call as
      | { ok?: boolean; response?: Record<string, unknown>; error?: string }
      | undefined;
    if (!c?.ok) return `call failed (${c?.error ?? "?"})`;
    return keys.map((k) => `${k} ${JSON.stringify(c.response?.[k] ?? null)}`).join(" ");
  };
  return `info ${part(r.resourceInfo, ["status", "resourceName"])}; guid ${part(r.prefabGuid, ["status", "guid"])}`;
}

/** Height tolerance: float32 storage and float.ToString both round (review round 2). */
export const HEIGHT_EPS = 0.01;

/** A getHeight answer's numeric height, or null. */
export function heightOf(r: RawCallResult): number | null {
  const h = field(r.response, "height");
  return r.ok && field(r.response, "status") === "ok" && typeof h === "number" ? h : null;
}

/** se-14's verdict from the heights before, after the stroke and after the undo (shipped-world R2-1, R2-2). */
export function undoVerdict(
  h0: number | null,
  h1: number | null,
  h2: number | null,
  undoOk: boolean,
  undoMessage: string,
): { status: StepStatus; verdict: string; restored: boolean | null; changed: boolean | null } {
  if (!undoOk)
    return {
      status: "fail",
      verdict: `undo not executed: ${undoMessage}; U19 not answered`,
      restored: null,
      changed: null,
    };
  if (h0 === null || h1 === null || h2 === null)
    return {
      status: "fail",
      verdict: "a height is unavailable: undetermined, U19 not answered",
      restored: null,
      changed: null,
    };
  const changed = Math.abs(h1 - h0) >= HEIGHT_EPS;
  const restored = Math.abs(h2 - h0) < HEIGHT_EPS;
  if (changed && restored)
    return { status: "observed", verdict: "restored (U19 yes for terrain)", restored, changed };
  if (Math.abs(h2 - h1) < HEIGHT_EPS)
    return {
      status: "observed",
      verdict: "undo ran, height unchanged (target unconfirmed; possibly se-13's tile write)",
      restored,
      changed,
    };
  return {
    status: "fail",
    verdict: "undetermined: the heights do not show what the undo reverted",
    restored,
    changed,
  };
}

/** The u25 files se-01 reads: every plant but the metas. */
export const U25_READS: string[] = U25_PLANTS.map((p) => `${U25_DIR}/${p.name}`);
/** The files se-21 reads after se-19's moves. */
export const U25_SECOND: string[] = [
  `${U25_MOVED}/ECEN_SE_U25_Control.conf`,
  `${U25_DIR}/ECEN_SE_U25_Renamed.conf`,
  `${U25_DIR}/ECEN_SE_U25_Meta.conf`,
  `${U25_DIR}/ECEN_SE_U25_Prefab.et`,
  U25_TEXTURE,
];

/** List the sandbox before or after a write (files outside the step's folder new: stop). */
function newOutside(before: string[], after: string[], allowed: string): string[] {
  const was = new Set(before);
  return after.filter(
    (f) => !was.has(f) && !f.toLowerCase().startsWith(`${allowed.toLowerCase()}/`),
  );
}

/** The sandbox listing a write step compares (the probe pack folder and the .rdb are noise). */
function sandboxListing(ctx: SeContext): string[] {
  return ctx.deps
    .listTree(ctx.opts.sandboxDir)
    .filter(
      (f) =>
        !/^Scripts\/WorkbenchGame\/EnfusionCensus\//i.test(f) && !/resourceDatabase\.rdb$/i.test(f),
    );
}

/** The throwaway-world check of the undo steps: layerRead shows `rel` open with one sub-scene. */
async function confirmThrowaway(ctx: SeContext, rel: string): Promise<Record<string, string>> {
  const r = await ctx.call(
    probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe, "throwaway-world check"),
  );
  await ctx.modalCheck("layerRead");
  const f = probeFacts(r.response);
  if (!isThrowawayWorld(f, rel))
    throw new StopSession(
      "kill",
      `the open world is not the throwaway world ${rel} with one sub-scene (layerRead worldPath ${f.worldPath ?? "absent"}, subScenes ${f.subScenes ?? "?"}): no edit and no undo`,
    );
  ctx.state.throwawayConfirmed = ctx.step;
  return f;
}

/**
 * An EMCP_WB_GetEntity answer read three ways (review shipped-world F2): present (status ok),
 * absent (status error "Entity not found with name: ...", EMCP_WB_GetEntity.c:120), or unknown
 * (any other answer: a failed call, no World Editor, no API).
 */
export function entityState(r: RawCallResult): "present" | "absent" | "unknown" {
  if (!r.ok) return "unknown";
  if (field(r.response, "status") === "ok") return "present";
  if (
    field(r.response, "status") === "error" &&
    /^Entity not found/.test(S(field(r.response, "message")))
  )
    return "absent";
  return "unknown";
}

async function entityExists(
  ctx: SeContext,
  name: string,
): Promise<"present" | "absent" | "unknown"> {
  const r = await ctx.call({
    apiFunc: "EMCP_WB_GetEntity",
    params: { name },
    timeoutMs: TIMEOUTS.bohemia,
  });
  return entityState(r);
}

async function removeEntity(ctx: SeContext, name: string): Promise<void> {
  await ctx.call({
    apiFunc: "EMCP_WB_DeleteEntity",
    params: { name },
    timeoutMs: TIMEOUTS.bohemia,
    note: "rollback",
  });
  const after = await entityExists(ctx, name);
  if (after !== "absent")
    throw new StopSession(
      "kill",
      `rollback ${after === "present" ? "failed: entity" : "unconfirmed: whether entity"} ${name} is still in the world ${after === "present" ? "" : "is unknown "}; the main session checks and deletes it`,
    );
}

/**
 * After a create: the name the entity actually got. CreateEntity answers status error with the
 * entity created under its auto-generated name when RenameEntity fails (EMCP_WB_CreateEntity.c,
 * `entityName`; review shipped-world F4). Returns that name when it differs from `wanted`.
 */
export function strayName(created: RawCallResult, wanted: string): string | null {
  const n = S(field(created.response, "entityName"));
  return n && n !== wanted ? n : null;
}

/** The step table, in queue order. */
export function buildSteps(): StepDef[] {
  const steps: StepDef[] = [];

  // ── Launch 1: the gate ────────────────────────────────────────────────────
  steps.push({
    id: "se-00-gate",
    launch: 1,
    title:
      "Gate: S-D's gate plus both packs: ECEN_Probe*.c and ECEN_ProbeMut*.c present, ECEN_Probe info isSandbox true, ECEN_ProbeMut {action:'none'} answers status error 'Unknown action' (compiled; its sandbox check passed)",
    risk: "read-only",
    answers: [],
    timeout_ms:
      2 * TIMEOUTS.ready +
      TIMEOUTS.cheap +
      TIMEOUTS.bohemia +
      2 * TIMEOUTS.probe +
      HELPER.process +
      HELPER.table +
      2 * HELPER.process +
      3 * HELPER.windows,
    expected:
      "as S-D sd-00 (Script Debug Mode off in the forced ini; the lease's pid is the Workbench and holds the port; ScriptsCompiled; GetLoadedProjects the sandbox and the allowed addons only; the session log names the sandbox and holds no ECEN_ compile error); both packs' files; info isSandbox true; ECEN_ProbeMut reachable and not refusing on its sandbox check",
    kill_criterion: `"Undefined API func" from either pack: STOP (train #1b failed, plan 5.4 step 5, three relaunches); ECEN_ProbeMut answering status refused: STOP (blocker B1, the pack's SandboxDir); isSandbox false or another addon: ABORT; ${DIALOG_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: [
      "read ScriptDebugMode from the forced ini; the recorded pid, its image, creation time, the NET port",
      "the session log: the opened project and no ECEN_ compile error (a resumed gate: new ECEN_Probe*.c errors only)",
      "EnfusionCensus/: ECEN_Probe*.c and ECEN_ProbeMut*.c present",
      "the window baseline; the main window recorded",
    ],
    plan: () => [
      net("se-00-gate", [], {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "repeated every 5 s until ScriptsCompiled",
      }),
      net("se-00-gate", [], {
        apiFunc: "GetLoadedProjects",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      }),
      net(
        "se-00-gate",
        [],
        probe("info", { page: 0 }, TIMEOUTS.probe, "read-only pack compile gate"),
      ),
      net(
        "se-00-gate",
        [],
        mut("none", {}, TIMEOUTS.probe, "mutating pack compile and sandbox-check gate"),
      ),
    ],
    run: (ctx) => runGate(ctx),
  });

  // ── Launch 1: read-only ───────────────────────────────────────────────────
  steps.push({
    id: "se-01-u25-first-start",
    launch: 1,
    title:
      "U25 first start: GetResourceInfo and GetPrefabGUID (forward slashes) on the u25 plants (a .conf without meta; a .conf, an .et and a texture each with a hand-written .meta); .meta hashes against the plant record",
    risk: "read-only",
    answers: u25Answers,
    touches: ["P-DEC019-GetPrefabGUID-path-forms"],
    timeout_ms: U25_READS.length * 2 * plainMs(TIMEOUTS.bohemia),
    expected:
      "per plant: GUID as written (accepted), a new GUID or a rewritten meta (regenerated), or an error; the control .conf gets a Workbench-made meta or none",
    kill_criterion: `a plant record missing (run the plant subcommand first): STOP; ${DIALOG_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: ["reads plant-se-u25.json; a regenerated meta is U25 'no', not a stop"],
    plan: () => resourceReads("se-01-u25-first-start", u25Answers, U25_READS),
    run: async (ctx) => {
      const plants = runJson<PlantRecord[]>(ctx.deps, "plant-se-u25.json");
      if (!plants)
        throw new StopSession(
          "kill",
          "plant-se-u25.json is not in the run folder: run the plant subcommand first",
        );
      const reads = await readResources(ctx, U25_READS);
      const rows = reads.map((r) => {
        const plant = plants.find((p) => p.rel === `${String(r.rel)}.meta`);
        return { ...r, metaAsPlanted: plant ? plant.sha256 === r.metaSha256 : null } as Record<
          string,
          unknown
        >;
      });
      return {
        status: "observed",
        summary: rows
          .map(
            (r) =>
              `${basename(String(r.rel))}: meta ${r.metaOnDisk ? (r.metaAsPlanted === false ? "rewritten" : r.metaAsPlanted ? "as planted" : "made by Workbench") : "none"}`,
          )
          .join("; "),
        data: { rows },
      };
    },
  });

  steps.push({
    id: "se-02-u11-load-handedits",
    launch: 1,
    title:
      "U11 load half: ECEN_Probe loadContainer (depth 2) on each hand-edited u11 plant (.conf reordered, .acp re-quoted, .ptc reordered and omitted keys, .ptc without Version, .agf one node edited, .pap and .siga without compiled block)",
    risk: "read-only",
    answers: u11Load,
    timeout_ms: U11_PLANTS.length * plainMs(TIMEOUTS.container),
    expected: "valid true or false, class name, variable count per file; a load failure is data",
    kill_criterion: `a plant record missing: STOP; ${DIALOG_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: ["reads plant-se-u11.json; a .ptc is loaded, never opened in a module"],
    plan: () =>
      U11_PLANTS.map((p) =>
        net(
          "se-02-u11-load-handedits",
          u11Load,
          probe(
            "loadContainer",
            { path: `${U11_DIR}/${p.name}`, depth: 2, page: 0 },
            TIMEOUTS.container,
            p.edit,
          ),
        ),
      ),
    run: async (ctx) => {
      if (!runJson(ctx.deps, "plant-se-u11.json"))
        throw new StopSession(
          "kill",
          "plant-se-u11.json is not in the run folder: run the plant subcommand first",
        );
      const per: Array<Record<string, unknown>> = [];
      for (const p of U11_PLANTS) {
        const rel = `${U11_DIR}/${p.name}`;
        const r = await ctx.call(
          probe("loadContainer", { path: rel, depth: 2, page: 0 }, TIMEOUTS.container),
        );
        await ctx.modalCheck(`loadContainer ${rel}`);
        per.push({
          rel,
          edit: p.edit,
          status: probeStatus(r.response),
          facts: probeFacts(r.response),
          ...summarizeCall(r),
        });
      }
      // Review ro-pack F5: the per-file facts and message; a null LoadContainer says the path form
      // was not accepted, nothing about the plant.
      const line = (x: Record<string, unknown>): string => {
        const f = x.facts as Record<string, string>;
        const msg = S((x.response as Record<string, unknown> | undefined)?.message);
        if (/LoadContainer returned null/i.test(msg))
          return `${basename(String(x.rel))} path form not accepted`;
        return `${basename(String(x.rel))} ${String(x.status ?? x.error)} valid ${f.valid ?? "?"} class ${f.className ?? "?"} variables ${f.variables ?? "?"}${msg ? ` (${msg})` : ""}`;
      };
      return {
        status: "observed",
        summary: per.map(line).join(", "),
        data: { loads: per },
      };
    },
  });

  // ── Launch 1: the first write (se-03 first, plan 8: "createSandboxWorlds first") ──
  const worldsParams = {
    target: `$${SANDBOX_NAME}:${WORLDS_DIR}`,
    tinyName: TINY_NAME,
    terrainName: FLAT_NAME,
    terrainEntities: [] as string[],
  };
  steps.push({
    id: "se-03-worlds-create",
    launch: 1,
    title: `createSandboxWorlds target $${SANDBOX_NAME}:${WORLDS_DIR}, tinyName ${TINY_NAME}, terrainName ${FLAT_NAME}, terrainEntities [] (CreateWorld writes no terrain, DEC-029); detached`,
    risk: "mutating",
    answers: [],
    timeout_ms: 2 * HELPER.process + detachedMs(TIMEOUTS.save),
    expected:
      "status ok with tinyExistedBefore false and terrainExistedBefore false, tinyRegistered and terrainRegistered 'true', tinyResourceName and terrainResourceName {GUID}-prefixed ({GUID}_throwaway/SE/worlds/<name>.ent through ShowPath; both written to the run file worlds.json for se-08 and se-23), and the new files hold both .ent under <sandbox>/_throwaway/SE/worlds/; nothing new elsewhere (whether the worlds folder existed before is recorded: GetAbsolutePath's resolution of a missing folder is [unverified])",
    kill_criterion: `status refused or error, an empty path, or a file new in the sandbox listing outside ${WORLDS_DIR}/: STOP; tinyExistedBefore or terrainExistedBefore true: FAIL (a world existed before; nothing was written for it); a Registered fact not 'true' or a resource name not {GUID}-prefixed: FAIL with the reason (DEC-044); ${DIALOG_KILL}`,
    side_effects: [
      `new world files (.ent, layer folder) and the .meta RegisterResourceFile writes for each .ent, under ${WORLDS_DIR}/`,
    ],
    rollback:
      "listing before and after in plant-se-03.json; removed with _throwaway/ after the last launch",
    outline: [
      "skipped when the tiny world exists (Q1 recommended: made here every sitting)",
      "the sandbox listed before and after",
      `the registration facts recorded and written to the run file ${WORLDS_FILE}`,
    ],
    skipWhen: {
      condition: `<sandbox>/${TINY_WORLD} exists`,
      carried_to: "nothing: the tiny world is there",
    },
    preSkip: (o, deps) =>
      deps.fileExists(abs(o.sandboxDir, TINY_WORLD)) ? `${TINY_WORLD} exists already` : null,
    plan: () => [
      net("se-03-worlds-create", [], mut("createSandboxWorlds", worldsParams, TIMEOUTS.save), {
        detached: true,
      }),
    ],
    run: async (ctx) => {
      const before = sandboxListing(ctx);
      const folderExisted = ctx.deps.fileExists(abs(ctx.opts.sandboxDir, WORLDS_DIR));
      const r = await ctx.detached(
        mut("createSandboxWorlds", worldsParams, TIMEOUTS.save),
        "se-03-worlds",
      );
      const after = sandboxListing(ctx);
      const created = after.filter((f) => !before.includes(f));
      const stray = newOutside(before, after, WORLDS_DIR);
      ctx.deps.writeArtifact("plant-se-03.json", {
        step: "se-03-worlds-create",
        created: created.map((rel) => ({
          rel,
          sha256: sha256Hex(ctx.deps.readBytes(abs(ctx.opts.sandboxDir, rel))),
        })),
        stray,
      });
      if (stray.length)
        throw new StopSession("kill", `files new outside ${WORLDS_DIR}/: ${stray.join(", ")}`);
      const st = probeStatus(r.response);
      const f = probeFacts(r.response);
      if (!r.ok || st !== "ok")
        throw new StopSession(
          "kill",
          `createSandboxWorlds answered ${st ?? r.error}: ${S(field(r.response, "message"))}`,
        );
      if (!f.tinyWorld || !f.terrainWorld)
        throw new StopSession("kill", "createSandboxWorlds returned an empty path");
      const existed = f.tinyExistedBefore === "true" || f.terrainExistedBefore === "true";
      const both = [TINY_WORLD, `${WORLDS_DIR}/${FLAT_NAME}.ent`].every((w) =>
        created.some((c) => c.toLowerCase() === w.toLowerCase()),
      );
      const registration: WorldsRegistration = {
        tinyRegistered: f.tinyRegistered ?? null,
        tinyResourceName: f.tinyResourceName ?? null,
        terrainRegistered: f.terrainRegistered ?? null,
        terrainResourceName: f.terrainResourceName ?? null,
      };
      const regProblem = registrationProblem(f);
      ctx.deps.writeArtifact(WORLDS_FILE, {
        step: "se-03-worlds-create",
        ...registration,
        registrationProblem: regProblem,
      });
      return {
        status: !existed && both && !regProblem ? "pass" : "fail",
        summary: existed
          ? `a world existed before (tinyExistedBefore ${f.tinyExistedBefore}, terrainExistedBefore ${f.terrainExistedBefore}): CreateWorld skipped it`
          : !both
            ? `status ok but the new files do not hold both ${TINY_NAME}.ent and ${FLAT_NAME}.ent (${created.join(", ") || "none"})`
            : regProblem
              ? `worlds created (${created.length} new file(s) under ${WORLDS_DIR}/) but not registered as required: ${regProblem}`
              : `worlds created and registered: ${created.length} new file(s) under ${WORLDS_DIR}/; ${registration.tinyResourceName}, ${registration.terrainResourceName}`,
        data: {
          facts: f,
          call: summarizeCall(r),
          created,
          worldsFolderExistedBefore: folderExisted,
          registration,
          registrationProblem: regProblem,
        },
      };
    },
  });

  // se-04: reversible, but placed with the writes (it reads the U34 list); skipped while Q8 is open.
  steps.push({
    id: "se-04-u34-diag-set",
    launch: 1,
    title:
      "U34 set half: diagSet on the one listed option to 1, read back, then back to its value before",
    risk: "mutating",
    answers: [],
    touches: ["P-U34"],
    timeout_ms: 3 * plainMs(TIMEOUTS.probe) + 2 * plainMs(TIMEOUTS.probe),
    expected: "before v, after the other value (1, or 0 when v is 1), restored v",
    kill_criterion: `the value not restored: STOP; a diagSet refused or errored, or the value after the set not 1: STOP (after the restore); ${DIALOG_KILL}`,
    side_effects: ["one diag option changed in memory and restored"],
    rollback: "set back in the step; in memory only",
    outline: ["diagRead, diagSet 1, diagRead, diagSet <before>, diagRead"],
    restore:
      "diagSet back to the value diagRead returned before the set, then diagRead again: a restore read that differs from the value before is a STOP (owner's Q8 condition)",
    skipWhen: {
      condition: "probe_mut.diag_set_allow_list is empty (Q8 ruled 923416c: one entry)",
      carried_to: "an S-E repeat",
    },
    preSkip: (o) => (diagEntryOf(o.policy) ? null : SKIP_REASON.q8diag),
    plan: (p) => {
      const d = p.diag ?? {
        key: "script:<the listed option>",
        engine: false,
        diagEnum: "<the listed option>",
        diagId: null,
      };
      const sel = d.engine
        ? { engine: true, diagId: d.diagId }
        : { engine: false, diagEnum: d.diagEnum };
      const read = d.engine ? { engine: true, diagId: d.diagId } : { diagEnum: d.diagEnum };
      const id = "se-04-u34-diag-set";
      return [
        net(id, [], probe("diagRead", read, TIMEOUTS.probe, "before")),
        net(
          id,
          [],
          mut(
            "diagSet",
            { ...sel, diagValue: 1 },
            TIMEOUTS.probe,
            "1, or 0 when the value before is 1",
          ),
        ),
        net(id, [], probe("diagRead", read, TIMEOUTS.probe, "after")),
        net(
          id,
          [],
          mut(
            "diagSet",
            { ...sel, diagValue: 0 },
            TIMEOUTS.probe,
            "restore: the value read before",
          ),
        ),
        net(id, [], probe("diagRead", read, TIMEOUTS.probe, "restored")),
      ];
    },
    run: async (ctx) => {
      const d = diagEntryOf(ctx.opts.policy)!;
      const sel = d.engine
        ? { engine: true, diagId: d.diagId }
        : { engine: false, diagEnum: d.diagEnum };
      const read = d.engine ? { engine: true, diagId: d.diagId } : { diagEnum: d.diagEnum };
      const r0 = await ctx.call(probe("diagRead", read, TIMEOUTS.probe));
      await ctx.modalCheck("diagRead before");
      const before = Number(probeFacts(r0.response).value);
      if (!Number.isInteger(before))
        throw new StopSession(
          "kill",
          `the option's value before could not be read (${JSON.stringify(probeFacts(r0.response))}); nothing set`,
        );
      const target = before === 1 ? 0 : 1;
      const s1 = await ctx.call(mut("diagSet", { ...sel, diagValue: target }, TIMEOUTS.probe));
      await ctx.modalCheck("diagSet 1");
      const r1 = await ctx.call(probe("diagRead", read, TIMEOUTS.probe));
      await ctx.modalCheck("diagRead after");
      const s2 = await ctx.call(
        mut("diagSet", { ...sel, diagValue: before }, TIMEOUTS.probe, "restore"),
      );
      await ctx.modalCheck("diagSet restore");
      const r2 = await ctx.call(probe("diagRead", read, TIMEOUTS.probe));
      await ctx.modalCheck("diagRead restored");
      const restored = Number(probeFacts(r2.response).value);
      if (restored !== before)
        throw new StopSession(
          "kill",
          `the option ${d.key} is ${restored}, not its value before ${before}: not restored`,
        );
      // Review mut-plugin-diag-worlds F1: both sets answered ok and the set took (after == 1);
      // the restore above ran in any case.
      const after = Number(probeFacts(r1.response).value);
      if (
        probeStatus(s1.response) !== "ok" ||
        probeStatus(s2.response) !== "ok" ||
        after !== target
      )
        throw new StopSession(
          "kill",
          `diagSet did not take: set ${probeStatus(s1.response) ?? s1.error} "${S(field(s1.response, "message"))}", after ${after}, restore ${probeStatus(s2.response) ?? s2.error} (the option reads its value before again)`,
        );
      return {
        status: "observed",
        summary: `${d.key}: before ${before}, set ${target} ${probeStatus(s1.response)}, after ${probeFacts(r1.response).value ?? "?"}, restored ${restored}`,
        data: {
          entry: d,
          before: summarizeCall(r0),
          set: summarizeCall(s1),
          after: summarizeCall(r1),
          restore: summarizeCall(s2),
          restored: summarizeCall(r2),
        },
      };
    },
  });

  const u16Answers = ["P-U16", E("anim-procanim-behavior-L417"), E("anim-procanim-behavior-L488")];
  steps.push({
    id: "se-05-u16-save",
    launch: 1,
    title:
      "U16 write half: saveContainer (detached) of S-D's seven vanilla inputs plus one .agf, .asi and .pap to _throwaway/SE/u16/<name>; loadContainer on each saved copy; hashes recorded for the offline diff against the pak text",
    risk: "mutating",
    answers: u16Answers,
    timeout_ms:
      2 * HELPER.process +
      U16_SOURCES.length * (detachedMs(TIMEOUTS.save) + plainMs(TIMEOUTS.container)),
    expected:
      "saved true and loads back with the same class and variable count (U16 yes for that type), or saved false",
    kill_criterion: `a file new outside ${U16_DIR}/: STOP; status refused: STOP; ${DIALOG_KILL}`,
    side_effects: [`one file per source under ${U16_DIR}/`],
    rollback: "plant-se-05.json; removed with _throwaway/ after the last launch",
    outline: [
      "each saveContainer in a detached child (a file write can raise the authorization prompt without the flag, review M2)",
    ],
    plan: () =>
      U16_SOURCES.flatMap((src) => [
        net(
          "se-05-u16-save",
          u16Answers,
          mut("saveContainer", { source: src, target: u16Target(src) }, TIMEOUTS.save),
          { detached: true },
        ),
        net(
          "se-05-u16-save",
          u16Answers,
          probe(
            "loadContainer",
            { path: u16Target(src), depth: 2, page: 0 },
            TIMEOUTS.container,
            "the saved copy",
          ),
        ),
      ]),
    run: async (ctx) => {
      const before = sandboxListing(ctx);
      const per: Array<Record<string, unknown>> = [];
      for (const src of U16_SOURCES) {
        const target = u16Target(src);
        const s = await ctx.detached(
          mut("saveContainer", { source: src, target }, TIMEOUTS.save),
          `se-05-${basename(target)}`,
        );
        if (probeStatus(s.response) === "refused")
          throw new StopSession(
            "kill",
            `saveContainer ${target} refused: ${S(field(s.response, "message"))}`,
          );
        const l = await ctx.call(
          probe("loadContainer", { path: target, depth: 2, page: 0 }, TIMEOUTS.container),
        );
        await ctx.modalCheck(`loadContainer ${target}`);
        const file = abs(ctx.opts.sandboxDir, target);
        const onDisk = ctx.deps.fileExists(file);
        const sst = probeStatus(s.response);
        per.push({
          source: src,
          target,
          status: sst ?? s.error ?? null,
          message: S(field(s.response, "message")),
          inconclusive:
            !onDisk && sst !== "ok"
              ? `INCONCLUSIVE: saveContainer ${sst ?? s.error} "${S(field(s.response, "message"))}" and no file`
              : null,
          saved: probeFacts(s.response).saved ?? null,
          save: summarizeCall(s),
          load: { facts: probeFacts(l.response), ...summarizeCall(l) },
          sha256: onDisk ? sha256Hex(ctx.deps.readBytes(file)) : null,
        });
      }
      const after = sandboxListing(ctx);
      const stray = newOutside(before, after, U16_DIR);
      ctx.deps.writeArtifact("plant-se-05.json", {
        step: "se-05-u16-save",
        files: per.map((x) => ({ rel: x.target, sha256: x.sha256, source: x.source })),
        stray,
      });
      if (stray.length)
        throw new StopSession("kill", `files new outside ${U16_DIR}/: ${stray.join(", ")}`);
      return {
        status: "observed",
        summary: per
          .map(
            (x) =>
              `${basename(String(x.target))} ${x.inconclusive ? String(x.inconclusive) : `${String(x.status)} saved ${x.saved ?? "?"}`}`,
          )
          .join(", "),
        data: { saves: per },
      };
    },
  });

  const u11Resave = [
    ...u11Load.filter((x) => x !== E("anim-procanim-behavior-L414")),
    E("anim-procanim-behavior-L414"),
    E("anim-procanim-behavior-L484"),
  ];
  steps.push({
    id: "se-06-u11-resave",
    launch: 1,
    title:
      "U11 re-save half: saveContainer (detached) of each u11 plant to _throwaway/SE/u11/resaved/; the bytes compared with the plant",
    risk: "mutating",
    answers: u11Resave,
    timeout_ms: 2 * HELPER.process + U11_PLANTS.length * detachedMs(TIMEOUTS.save),
    expected: "per file: re-saved canonical (open-then-save canonicalises), unchanged, or refused",
    kill_criterion: `a file new outside ${U11_RESAVED}/: STOP; status refused: STOP; ${DIALOG_KILL}`,
    side_effects: [`one file per plant under ${U11_RESAVED}/`],
    rollback: "plant-se-06.json; removed with _throwaway/",
    outline: ["each saveContainer in a detached child; the diff (identical, line counts) recorded"],
    plan: () =>
      U11_PLANTS.map((p) =>
        net(
          "se-06-u11-resave",
          u11Resave,
          mut(
            "saveContainer",
            { source: `${U11_DIR}/${p.name}`, target: `${U11_RESAVED}/${p.name}` },
            TIMEOUTS.save,
          ),
          { detached: true },
        ),
      ),
    run: async (ctx) => {
      const before = sandboxListing(ctx);
      const per: Array<Record<string, unknown>> = [];
      for (const p of U11_PLANTS) {
        const source = `${U11_DIR}/${p.name}`;
        const target = `${U11_RESAVED}/${p.name}`;
        const s = await ctx.detached(
          mut("saveContainer", { source, target }, TIMEOUTS.save),
          `se-06-${p.name}`,
        );
        if (probeStatus(s.response) === "refused")
          throw new StopSession(
            "kill",
            `saveContainer ${target} refused: ${S(field(s.response, "message"))}`,
          );
        const a = abs(ctx.opts.sandboxDir, source);
        const b = abs(ctx.opts.sandboxDir, target);
        const plant = ctx.deps.fileExists(a) ? ctx.deps.readBytes(a) : null;
        const saved = ctx.deps.fileExists(b) ? ctx.deps.readBytes(b) : null;
        const sst = probeStatus(s.response);
        per.push({
          source,
          target,
          edit: p.edit,
          inconclusive:
            !saved && sst !== "ok"
              ? `INCONCLUSIVE: saveContainer ${sst ?? s.error} "${S(field(s.response, "message"))}" and no file (the source path form may not resolve)`
              : null,
          saved: probeFacts(s.response).saved ?? null,
          call: summarizeCall(s),
          identical: plant && saved ? plant.equals(saved) : null,
          lines: {
            plant: plant ? plant.toString("utf-8").split("\n").length : null,
            resaved: saved ? saved.toString("utf-8").split("\n").length : null,
          },
          compiledBlock: saved ? /^\s*compiled\s/m.test(saved.toString("utf-8")) : null,
          sha256: saved ? sha256Hex(saved) : null,
        });
      }
      const after = sandboxListing(ctx);
      const stray = newOutside(before, after, U11_RESAVED);
      ctx.deps.writeArtifact("plant-se-06.json", {
        step: "se-06-u11-resave",
        files: per.map((x) => ({ rel: x.target, sha256: x.sha256 })),
        stray,
      });
      if (stray.length)
        throw new StopSession("kill", `files new outside ${U11_RESAVED}/: ${stray.join(", ")}`);
      return {
        status: "observed",
        summary: per
          .map(
            (x) =>
              `${basename(String(x.target))} ${x.inconclusive ? String(x.inconclusive) : x.identical === null ? "not saved" : x.identical ? "unchanged" : "re-saved differently"}`,
          )
          .join(", "),
        data: { resaves: per },
      };
    },
  });

  // se-07: U8 write half, one module each (never the Particle Editor).
  const u8Base = ["P-U8", "P-SD-container-api-empty-editors", E("plugins-netapi-cli-L461")];
  const u8Extra: Record<string, string[]> = {
    AnimEditor: [E("anim-procanim-behavior-L407")],
    AudioEditor: [E("audio-particle-navmesh-L487")],
    BehaviorEditor: [E("anim-procanim-behavior-L407")],
    ProcAnimEditor: [E("anim-procanim-behavior-L407")],
    ResourceManager: [E("resource-manager-L672")],
  };
  const u8Touch: Record<string, string[]> = {
    AnimEditor: [
      E("mcp-inventory-L267"),
      E("script-string-dialogue-L411"),
      E("anim-procanim-behavior-L408"),
      E("anim-procanim-behavior-L479"),
    ],
    AudioEditor: [
      E("mcp-inventory-L267"),
      E("script-string-dialogue-L411"),
      E("audio-particle-navmesh-L486"),
      E("audio-particle-navmesh-L488"),
    ],
    BehaviorEditor: [
      E("mcp-inventory-L267"),
      E("script-string-dialogue-L411"),
      E("anim-procanim-behavior-L408"),
      E("anim-procanim-behavior-L479"),
    ],
    ProcAnimEditor: [
      E("mcp-inventory-L267"),
      E("script-string-dialogue-L411"),
      E("anim-procanim-behavior-L408"),
      E("anim-procanim-behavior-L479"),
    ],
    ResourceManager: [
      E("mcp-inventory-L267"),
      E("script-string-dialogue-L411"),
      E("resource-manager-L671"),
    ],
  };
  for (const m of U8_MODULES) {
    const id = `se-07-u8-${m.name}`;
    const answers = [...u8Base, ...(u8Extra[m.name] ?? [])];
    const openSpec = probe(
      "moduleMatrix",
      { openModules: true, moduleName: m.name, page: 0 },
      TIMEOUTS.moduleOpen,
      `open ${m.name}`,
    );
    const accept = (w: WindowInfo): boolean =>
      titleNames(w, m.name) || titleNames(w, basename(m.target));
    steps.push({
      id,
      launch: 1,
      title: `U8 write half: open ${m.name}, then containerWriteTest target ${m.target}, index 0, one scalar variable, never saved (detached child; windows polled every 5 s)`,
      risk: "mutating",
      answers,
      touches: u8Touch[m.name],
      timeout_ms: plainMs(TIMEOUTS.moduleOpen) + detachedMs(TIMEOUTS.containerWrite),
      expected:
        "'index out of range: the module holds 0 containers' (U8 write no for this editor); refused 'does not come from the 2.0 sandbox alone' (INCONCLUSIVE: GetSourceAddons' return form is unverified, review M3); SetOpenedResource false ('no handle or wrong path form', review M4); a variable the container does not take, the module not open, the target absent or no scalar in it (INCONCLUSIVE, nothing or no useful write sent); or written true with the read-back equal (U8 write yes)",
      kill_criterion: DIALOG_KILL,
      side_effects: [
        `opens the ${m.name} window; SetOpenedResource switches its document to the throwaway copy; one variable set in memory`,
      ],
      rollback:
        "never saved; Don't Save at the owner's close; the file is removed with _throwaway/",
      outline: [
        "the variable is the first scalar of the target's text (read from disk), set to its value + 1",
      ],
      plan: () => [
        net(id, answers, openSpec),
        net(
          id,
          answers,
          mut(
            "containerWriteTest",
            {
              moduleName: m.name,
              target: m.target,
              index: 0,
              varName: "<first scalar of the target>",
              value: "<its value + 1>",
            },
            TIMEOUTS.containerWrite,
          ),
          { detached: true },
        ),
      ],
      run: async (ctx) => {
        const o = await ctx.call(openSpec);
        await ctx.modalCheck(`open ${m.name}`, accept);
        const file = abs(ctx.opts.sandboxDir, m.target);
        const present = ctx.deps.fileExists(file);
        const scalar = present ? firstScalar(ctx.deps.readBytes(file).toString("utf-8")) : null;
        // Preconditions the handler enforces: the module open (moduleMatrix row present true),
        // the target on disk, a scalar to write. Without one nothing is sent.
        const pre =
          !o.ok || !moduleOpened(o.response, m.name)
            ? `INCONCLUSIVE: ${m.name} did not open (moduleMatrix ${o.ok ? probeStatus(o.response) : o.error}); containerWriteTest not sent`
            : !present
              ? `INCONCLUSIVE: ${m.target} is not on disk (se-05 or the plant did not write it); containerWriteTest not sent`
              : !scalar
                ? `INCONCLUSIVE: no scalar variable in ${m.target}; containerWriteTest not sent (never an empty varName)`
                : null;
        if (pre)
          return {
            status: "observed",
            summary: pre,
            data: {
              module: m.name,
              target: m.target,
              open: summarizeCall(o),
              scalar,
              verdict: pre,
            },
          };
        const w = await ctx.detached(
          mut(
            "containerWriteTest",
            {
              moduleName: m.name,
              target: m.target,
              index: 0,
              varName: scalar!.varName,
              value: scalar!.next,
            },
            TIMEOUTS.containerWrite,
          ),
          id,
          { expected: accept },
        );
        const st = probeStatus(w.response);
        const f = probeFacts(w.response);
        const msg = S(field(w.response, "message"));
        const verdict = !w.ok
          ? `no answer: ${w.error}`
          : st === "refused" && /sandbox alone|GetSourceAddons/i.test(msg)
            ? "INCONCLUSIVE: refused as not the sandbox's container (GetSourceAddons' return form is unverified, review M3)"
            : st === "refused"
              ? `refused: ${msg}`
              : /SetOpenedResource returned false/i.test(msg)
                ? "no handle or wrong path form (SetOpenedResource returned false; the accepted path form is unverified, review M4)"
                : /index out of range/i.test(msg)
                  ? `U8 write no for ${m.name}: ${msg}`
                  : /is not open/i.test(msg)
                    ? `INCONCLUSIVE: ${msg}`
                    : /no variable named|not a number|not an integer|must be true or false|writes scalar, integer, boolean|; nothing saved$/i.test(
                          msg,
                        )
                      ? `INCONCLUSIVE: bad variable pick (${scalar!.varName}): ${msg}`
                      : f.written === "true" && Number(f.after) === Number(scalar!.next)
                        ? `U8 write yes for ${m.name}: ${f.varName} ${f.before} -> ${f.after}`
                        : `${st}: ${msg}`;
        return {
          status: "observed",
          summary: verdict,
          data: {
            module: m.name,
            target: m.target,
            open: summarizeCall(o),
            scalar,
            write: { facts: f, ...summarizeCall(w) },
            verdict,
          },
        };
      },
    });
  }

  // ── Launch 1: the tiny world (open, U19, U13, U17) ─────────────────────────
  const tinyAbsent = (o: SeOptions, deps: SeDeps): string | null =>
    deps.fileExists(abs(o.sandboxDir, TINY_WORLD))
      ? null
      : `${TINY_WORLD} is absent (se-03 did not create it)`;
  const tinyAccept = (w: WindowInfo): boolean =>
    titleNames(w, TINY_NAME) || titleNames(w, "World Editor") || titleNames(w, "WorldEditor");
  // The native OpenResource answered Opened true without loading the world in four launches
  // (session 007 launch 2 and the three repeat attempts). The shipped EMCP_WB_EditorControl
  // openResource is WorldEditor.SetOpenedResource(path), the route the 1.x wb_open_resource tool
  // takes with a project-relative path: that is what the open steps send now. The registered name
  // from worlds.json is still recorded (openedBy) but the path form is what is sent.
  const openTinySpec: CallSpec = {
    apiFunc: "EMCP_WB_EditorControl",
    params: { action: "openResource", path: TINY_WORLD },
    timeoutMs: TIMEOUTS.openTiny,
  };
  const openTinyFor = (_t: { resourceName: string }): CallSpec => openTinySpec;
  // OpenResource answers Opened true but opens no module: the World Editor must already run
  // (the S-E repeat of 2026-10-08, attempt 2: 99 polls, never running; session 007's se-08 passed
  // because se-07's moduleMatrix openModules had opened modules). So when IsWorldEditorRunning is
  // false the World Editor module is opened first through the read-only pack (OpenModule;
  // dialog-capable, detached), then the world is opened into it.
  const openWorldEditorSpec = probe(
    "moduleMatrix",
    { openModules: true, moduleName: "WorldEditor", page: 0 },
    TIMEOUTS.moduleOpen,
    "open WorldEditor",
  );
  const openWorldEditorIfNeeded = async (
    ctx: SeContext,
    accept: (w: WindowInfo) => boolean,
    label: string,
  ): Promise<{ wasRunning: boolean; moduleOpen: RawCallResult | null }> => {
    const we0 = await ctx.call({
      apiFunc: "IsWorldEditorRunning",
      params: {},
      timeoutMs: TIMEOUTS.cheap,
    });
    await ctx.modalCheck("IsWorldEditorRunning", accept);
    if (field(we0.response, "IsRunning") === true) return { wasRunning: true, moduleOpen: null };
    const m = await ctx.detached(openWorldEditorSpec, label, { expected: accept });
    return { wasRunning: false, moduleOpen: m };
  };
  const openNote = `ResourceName: the registered {GUID} name from the run file ${WORLDS_FILE} when se-03 wrote one, else ${TINY_WORLD} (the form sent is recorded)`;
  // OpenResource answers Opened true at once while the world loads on (the S-E repeat of
  // 2026-10-08: 150 ms, then IsWorldEditorRunning false and GetState in game mode). Session 007's
  // se-08 passed only because earlier steps had the World Editor running. So after the open, the
  // World Editor is polled (IsWorldEditorRunning, then GetState) until it runs in edit mode or the
  // open timeout is spent; one call at a time, the modal check after each.
  const waitForWorldEditor = async (
    ctx: SeContext,
    accept: (w: WindowInfo) => boolean,
  ): Promise<{
    we: RawCallResult;
    st: RawCallResult;
    l: RawCallResult;
    polls: number;
    elapsedMs: number;
    ready: boolean;
  }> => {
    const started = Date.now();
    let polls = 0;
    for (;;) {
      polls++;
      const we = await ctx.call({
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      await ctx.modalCheck("IsWorldEditorRunning", accept);
      const st = await ctx.call({
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("GetState", accept);
      // The third repeat of 2026-10-08: the module open alone gives edit mode on an untitled world
      // within a second, while the requested world preloads about ten seconds later. Ready means
      // the World Editor runs in edit mode AND layerRead names the tiny world.
      const l = await ctx.call(probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe));
      await ctx.modalCheck("layerRead", accept);
      const ready =
        field(we.response, "IsRunning") === true &&
        field(st.response, "mode") === "edit" &&
        probeStatus(l.response) === "ok" &&
        isThrowawayWorld(probeFacts(l.response), TINY_WORLD);
      const elapsedMs = Date.now() - started;
      // Bounded by time and by poll count (a mocked sleep spends no time).
      const budgetSpent =
        elapsedMs + TIMEOUTS.poll > TIMEOUTS.openTiny || polls * TIMEOUTS.poll >= TIMEOUTS.openTiny;
      if (ready || budgetSpent) return { we, st, l, polls, elapsedMs, ready };
      await ctx.deps.sleep(TIMEOUTS.poll);
    }
  };
  steps.push({
    id: "se-08-world-open-tiny",
    launch: 1,
    title: `Native OpenResource on ${TINY_WORLD} (600 s, detached), modal check, IsWorldEditorRunning, EMCP_WB_GetState, ECEN_Probe layerRead`,
    risk: "mutating",
    answers: [],
    timeout_ms:
      detachedMs(TIMEOUTS.openTiny) +
      plainMs(TIMEOUTS.cheap) +
      plainMs(TIMEOUTS.bohemia) +
      plainMs(TIMEOUTS.probe),
    expected:
      "Opened true, mode edit, 0 or 1 entities (the world entity), one sub-scene, layerRead's worldPath the tiny world",
    kill_criterion: `Opened false or another mode: FAIL, se-09 to se-11 skipped; ${DIALOG_KILL}`,
    side_effects: ["the tiny throwaway world loaded in the World Editor"],
    rollback: "the owner's close",
    outline: [openNote],
    skipWhen: { condition: "the tiny world is absent", carried_to: "an S-E repeat" },
    preSkip: tinyAbsent,
    plan: () => [
      net("se-08-world-open-tiny", [], {
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
      net("se-08-world-open-tiny", [], openWorldEditorSpec, { detached: true }),
      net("se-08-world-open-tiny", [], openTinySpec, { detached: true }),
      net("se-08-world-open-tiny", [], {
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
      net("se-08-world-open-tiny", [], {
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      }),
      net(
        "se-08-world-open-tiny",
        [],
        probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe),
      ),
    ],
    run: async (ctx) => {
      const target = tinyOpenTarget(ctx.deps.readRunFile(WORLDS_FILE));
      const moduleOpen = await openWorldEditorIfNeeded(ctx, tinyAccept, "se-08-open-we");
      const o = await ctx.detached(openTinyFor(target), "se-08-open", { expected: tinyAccept });
      const waited = await waitForWorldEditor(ctx, tinyAccept);
      const we = waited.we;
      const st = waited.st;
      const l = waited.l;
      const f = probeFacts(l.response);
      const ok =
        shippedOpened(o) &&
        field(we.response, "IsRunning") === true &&
        field(st.response, "mode") === "edit" &&
        // A new world carries its world entity (session 007 counted 1; S-D read the World Editor's one
        // container as the GenericWorldEntity): 0 or 1 passes, more is a stop-worthy surprise.
        (field(st.response, "entityCount") === 0 || field(st.response, "entityCount") === 1) &&
        isThrowawayWorld(f, TINY_WORLD);
      return {
        status: ok ? "pass" : "fail",
        summary: `openResource ${JSON.stringify(field(o.response, "message") ?? o.error)}; mode ${JSON.stringify(field(st.response, "mode") ?? st.error)}; ${field(st.response, "entityCount") ?? "?"} entities; layerRead world ${f.worldPath ?? "?"}, ${f.subScenes ?? "?"} sub-scene(s)`,
        data: {
          openResource: summarizeCall(o),
          isWorldEditorRunning: summarizeCall(we),
          worldEditorModuleOpen: {
            wasRunning: moduleOpen.wasRunning,
            call: moduleOpen.moduleOpen ? summarizeCall(moduleOpen.moduleOpen) : null,
          },
          worldEditorWait: {
            polls: waited.polls,
            elapsedMs: waited.elapsedMs,
            ready: waited.ready,
          },
          state: summarizeCall(st),
          layerRead: { facts: f, ...summarizeCall(l) },
          openedBy: target,
          rawWorldPath: f.worldPath ?? null,
          rawWorldPathGuidPrefixed: RESOURCE_NAME_RE.test(f.worldPath ?? ""),
          worldPathForm:
            "[unverified] until a live pass records GetWorldPath's form (review ro-pack F3)",
        },
      };
    },
  });

  const needTiny = {
    skipWhen: {
      condition: "se-08 did not open the tiny world (skipped, failed or stopped)",
      carried_to: "an S-E repeat",
    },
    skip: (ctx: SeContext) =>
      priorStatus(ctx, "se-08-world-open-tiny") === "pass"
        ? null
        : "se-08 did not pass: the tiny world is not open",
  };
  const u19 = ["P-U19", E("world-editor-L477")];
  steps.push({
    id: "se-09-u19-undo",
    launch: 1,
    title:
      "U19 (S-C sc-12): the throwaway-world check, EMCP_WB_CreateEntity a vanilla prop as ECEN_SE_U19_<nonce>; shipped EMCP_WB_EditorControl undo (Edit > Undo; allowed here and in se-14 only); check",
    risk: "mutating",
    answers: u19,
    timeout_ms: plainMs(TIMEOUTS.probe) + 6 * plainMs(TIMEOUTS.bohemia),
    expected:
      "gone after the undo (U19 yes) or still there (U19 no; EMCP_WB_DeleteEntity removes it)",
    kill_criterion: `the open world not the throwaway world: STOP before any edit; the entity still there after the rollback delete: STOP; ${DIALOG_KILL}`,
    side_effects: ["one entity in the throwaway world, in memory"],
    rollback: "undone or deleted in the step; after a stop the main session deletes it",
    outline: [
      "layerRead first: the undo is sent only once the open world is the tiny throwaway world",
    ],
    ...needTiny,
    plan: (p) => {
      const name = `ECEN_SE_U19_${p.nonce}`;
      const id = "se-09-u19-undo";
      return [
        net(
          id,
          u19,
          probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe, "throwaway-world check"),
        ),
        net(id, u19, {
          apiFunc: "EMCP_WB_CreateEntity",
          params: { prefab: SC_VANILLA.propRef, name, position: "0 0 0" },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        net(id, u19, {
          apiFunc: "EMCP_WB_GetEntity",
          params: { name },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        net(id, u19, {
          apiFunc: "EMCP_WB_EditorControl",
          params: { action: "undo" },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        undoAction(id, u19),
        net(id, u19, {
          apiFunc: "EMCP_WB_GetEntity",
          params: { name },
          timeoutMs: TIMEOUTS.bohemia,
          note: "after undo",
        }),
        net(id, u19, {
          apiFunc: "EMCP_WB_DeleteEntity",
          params: { name },
          timeoutMs: TIMEOUTS.bohemia,
          note: "rollback, only when still there",
        }),
      ];
    },
    run: async (ctx) => {
      await confirmThrowaway(ctx, TINY_WORLD);
      const name = `ECEN_SE_U19_${ctx.opts.nonce}`;
      const created = await ctx.call({
        apiFunc: "EMCP_WB_CreateEntity",
        params: { prefab: SC_VANILLA.propRef, name, position: "0 0 0" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("CreateEntity");
      const exists = await entityExists(ctx, name);
      const stray = strayName(created, name);
      if (exists !== "present") {
        if (stray) await removeEntity(ctx, stray);
        if (exists === "unknown") await removeEntity(ctx, name);
        return {
          status: "fail",
          summary: `create failed (${S(field(created.response, "status")) || created.error}: ${S(field(created.response, "message"))})${stray ? `; the auto-named ${stray} removed` : ""}; U19 not answered`,
          data: { name, created: summarizeCall(created), existedAfterCreate: exists, stray },
        };
      }
      const undo = await ctx.call({
        apiFunc: "EMCP_WB_EditorControl",
        params: { action: "undo" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("undo");
      const undoOk = undo.ok && field(undo.response, "status") === "ok";
      const afterUndo = await entityExists(ctx, name);
      if (afterUndo !== "absent") await removeEntity(ctx, name);
      const verdict = !undoOk
        ? `undo not executed: ${S(field(undo.response, "message")) || undo.error}; U19 not answered (entity deleted)`
        : afterUndo === "absent"
          ? "undo removed the entity (U19 yes)"
          : afterUndo === "present"
            ? "the entity survived the undo (U19 no; deleted)"
            : "undetermined: the entity's state after the undo is unknown (U19 not answered; deleted)";
      return {
        status: undoOk && afterUndo !== "unknown" ? "observed" : "fail",
        summary: verdict,
        data: {
          name,
          created: summarizeCall(created),
          existedAfterCreate: exists,
          undo: summarizeCall(undo),
          existsAfterUndo: afterUndo,
        },
      };
    },
  });

  const u13 = ["P-U13", E("mcp-inventory-L271"), E("mcp-inventory-L347"), E("world-editor-L478")];
  steps.push({
    id: "se-10-u13-component",
    launch: 1,
    title: `U13 (S-C sc-13): the base character as ECEN_SE_U13_<nonce>; ONE write EMCP_WB_ModifyEntity setProperty propertyPath components[<i>] of ${U13_DEFAULTS.component}, key ${U13_DEFAULTS.key}, value ${U13_DEFAULTS.value}; read back; delete`,
    risk: "mutating",
    answers: u13,
    timeout_ms: plainMs(TIMEOUTS.probe) + 7 * plainMs(TIMEOUTS.bohemia),
    expected:
      "status ok and read-back -0.009 (U13 yes: only the class-to-index mapping to fix) or SetVariableValue false (U13 no: the ModifyComponentKey route in Phase 3)",
    kill_criterion: `the open world not the throwaway world: STOP; the entity still there after the delete: STOP; ${DIALOG_KILL}`,
    side_effects: ["one entity in the throwaway world, in memory"],
    rollback: "deleted in the step",
    outline: ["the write is ONE setProperty call (Q5)"],
    ...needTiny,
    plan: (p) => {
      const name = `ECEN_SE_U13_${p.nonce}`;
      const u = U13_DEFAULTS;
      const s = (apiFunc: string, params: Record<string, unknown>, note?: string): PlanAction =>
        net("se-10-u13-component", u13, { apiFunc, params, timeoutMs: TIMEOUTS.bohemia, note });
      return [
        net(
          "se-10-u13-component",
          u13,
          probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe, "throwaway-world check"),
        ),
        s("EMCP_WB_CreateEntity", { prefab: u.prefab, name, position: "2 0 2" }),
        s("EMCP_WB_Components", { entityName: name, action: "list" }),
        s(
          "EMCP_WB_ModifyEntity",
          {
            name,
            action: "setProperty",
            propertyPath: "components[<index from the list>]",
            propertyKey: u.key,
            value: u.value,
          },
          "THE U13 write",
        ),
        s(
          "EMCP_WB_ModifyEntity",
          { name, action: "getProperty", propertyPath: u.component, propertyKey: u.key },
          "read-back",
        ),
        s("EMCP_WB_DeleteEntity", { name }, "rollback"),
        s("EMCP_WB_GetEntity", { name }, "confirm gone"),
      ];
    },
    run: async (ctx) => {
      await confirmThrowaway(ctx, TINY_WORLD);
      const u = U13_DEFAULTS;
      const name = `ECEN_SE_U13_${ctx.opts.nonce}`;
      const created = await ctx.call({
        apiFunc: "EMCP_WB_CreateEntity",
        params: { prefab: u.prefab, name, position: "2 0 2" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("CreateEntity");
      const there = await entityExists(ctx, name);
      if (there !== "present") {
        const stray = strayName(created, name);
        if (stray) await removeEntity(ctx, stray);
        if (there === "unknown") await removeEntity(ctx, name);
        return {
          status: "fail",
          summary: `could not create the entity${stray ? `; the auto-named ${stray} removed` : ""}`,
          data: { created: summarizeCall(created), existedAfterCreate: there, stray },
        };
      }
      const list = await ctx.call({
        apiFunc: "EMCP_WB_Components",
        params: { entityName: name, action: "list" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      const index = componentIndex(list.response, u.component);
      if (index < 0) {
        await removeEntity(ctx, name);
        return {
          status: "fail",
          summary: `${u.component} not on the entity`,
          data: { components: summarizeCall(list) },
        };
      }
      const set = await ctx.call({
        apiFunc: "EMCP_WB_ModifyEntity",
        params: {
          name,
          action: "setProperty",
          propertyPath: `components[${index}]`,
          propertyKey: u.key,
          value: u.value,
        },
        timeoutMs: TIMEOUTS.bohemia,
        note: "THE U13 write",
      });
      await ctx.modalCheck("setProperty");
      const back = await ctx.call({
        apiFunc: "EMCP_WB_ModifyEntity",
        params: { name, action: "getProperty", propertyPath: u.component, propertyKey: u.key },
        timeoutMs: TIMEOUTS.bohemia,
        note: "read-back",
      });
      await removeEntity(ctx, name);
      const wrote = field(set.response, "status") === "ok";
      const readOk = back.ok && field(back.response, "status") === "ok";
      const matches = readOk && Number(field(back.response, "message")) === Number(u.value);
      const verdict = !wrote
        ? "U13 no"
        : !readOk
          ? `read-back errored (${S(field(back.response, "message")) || back.error}): U13 undetermined`
          : matches
            ? "U13 yes"
            : "status ok but the read-back differs";
      return {
        status: "observed",
        summary: verdict,
        data: { name, index, write: summarizeCall(set), readBack: summarizeCall(back), verdict },
      };
    },
  });

  const u17 = ["P-U17", E("world-editor-L479"), E("mcp-inventory-L352")];
  const layerSpec = mut(
    "layerCreateThrowaway",
    {
      target: TINY_WORLD,
      name: LAYER_NAME,
      subScene: -1,
      parentPath: "",
      setActive: true,
      save: true,
    },
    TIMEOUTS.save,
  );
  steps.push({
    id: "se-11-u17-layer-create",
    launch: 1,
    title: `U17 write half: layerCreateThrowaway target ${TINY_WORLD}, name ${LAYER_NAME}, setActive true, save true (detached); ECEN_Probe layerRead after`,
    risk: "mutating",
    answers: u17,
    timeout_ms: detachedMs(TIMEOUTS.save) + plainMs(TIMEOUTS.probe),
    expected:
      "createdIsNewItem true, activeLayer the new item, saved true; a new layer file under the world's folder after the close",
    kill_criterion: `status refused: STOP; ${DIALOG_KILL}`,
    side_effects: ["WorldEditor.Save() of the throwaway world; a new layer file"],
    rollback: "inside _throwaway/; removed after the last launch",
    outline: [],
    ...needTiny,
    plan: () => [
      net("se-11-u17-layer-create", u17, layerSpec, { detached: true }),
      net(
        "se-11-u17-layer-create",
        u17,
        probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe),
      ),
    ],
    run: async (ctx) => {
      const r = await ctx.detached(layerSpec, "se-11-layer", { expected: tinyAccept });
      if (probeStatus(r.response) === "refused")
        throw new StopSession(
          "kill",
          `layerCreateThrowaway refused: ${S(field(r.response, "message"))}`,
        );
      const l = await ctx.call(probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe));
      await ctx.modalCheck("layerRead", tinyAccept);
      const f = probeFacts(r.response);
      const ok =
        probeStatus(r.response) === "ok" && f.createdIsNewItem === "true" && f.saved === "true";
      return {
        status: ok ? "pass" : "fail",
        summary: `${probeStatus(r.response) ?? r.error}: ${S(field(r.response, "message"))}; created ${f.created ?? "?"}, new item ${f.createdIsNewItem ?? "?"}, active ${f.activeLayer ?? "?"}, saved ${f.saved ?? "?"}`,
        data: { create: { facts: f, ...summarizeCall(r) }, layerRead: summarizeCall(l) },
      };
    },
  });

  // ── Launch 1: the terrain copy (Q1 held: skipped) ─────────────────────────
  const terrainSkip = (o: SeOptions, deps: SeDeps): string | null =>
    terrainWorldOf(o.sandboxDir, deps) ? null : SKIP_REASON.q1;
  const terrainTarget = (ctx: SeContext): string => terrainWorldOf(ctx.opts.sandboxDir, ctx.deps)!;
  const tPlan = (p: PlanInput): string => p.terrainWorld ?? `${TERRAIN_DIR}/<the terrain copy>.ent`;
  const u18 = ["P-U18", E("world-editor-L480")];
  steps.push({
    id: "se-12-world-open-terrain",
    launch: 1,
    title:
      "Native OpenResource on the terrain copy (900 s, detached), modal check, ECEN_Probe terrainFacts, shipped EMCP_WB_Terrain getHeight at the centre",
    risk: "mutating",
    answers: [],
    timeout_ms:
      HELPER.process +
      detachedMs(TIMEOUTS.openTerrain) +
      plainMs(TIMEOUTS.probe) +
      plainMs(TIMEOUTS.bohemia),
    expected: "Opened true, hasBounds true, getHeight status ok with a numeric height",
    kill_criterion: `the copy's .ent naming the master world: STOP before the open; hasBounds false: FAIL, se-13 to se-15 skipped; ${DIALOG_KILL}`,
    side_effects: ["the terrain copy loaded"],
    rollback: "the owner's close",
    outline: [],
    waitsOn: "Q1",
    skipWhen: {
      condition: "no terrain world copied into _throwaway/SE/terrain/ (Q1 held by the owner)",
      carried_to: "an S-E repeat after the owner's terrain world (Q1)",
    },
    preSkip: terrainSkip,
    plan: (p) => [
      net(
        "se-12-world-open-terrain",
        [],
        {
          apiFunc: "OpenResource",
          params: { ResourceName: tPlan(p) },
          timeoutMs: TIMEOUTS.openTerrain,
        },
        { detached: true },
      ),
      net(
        "se-12-world-open-terrain",
        [],
        probe("terrainFacts", { terrainIndex: 0 }, TIMEOUTS.probe),
      ),
      net("se-12-world-open-terrain", [], {
        apiFunc: "EMCP_WB_Terrain",
        params: { action: "getHeight", x: "<centre x>", z: "<centre z>" },
        timeoutMs: TIMEOUTS.bohemia,
      }),
    ],
    run: async (ctx) => {
      const t = terrainTarget(ctx);
      const text = ctx.deps.readBytes(abs(ctx.opts.sandboxDir, t)).toString("utf-8");
      if (/Worlds\/ECEN_Terrain|MainMenuWorld/i.test(text))
        throw new StopSession(
          "kill",
          `${t} names the master world: the copy would write outside ${THROWAWAY}/`,
        );
      const accept = (w: WindowInfo): boolean =>
        titleNames(w, basename(t, ".ent")) || titleNames(w, "World Editor");
      const o = await ctx.detached(
        { apiFunc: "OpenResource", params: { ResourceName: t }, timeoutMs: TIMEOUTS.openTerrain },
        "se-12-open",
        { expected: accept },
      );
      const tf = await ctx.call(probe("terrainFacts", { terrainIndex: 0 }, TIMEOUTS.probe));
      await ctx.modalCheck("terrainFacts", accept);
      const f = probeFacts(tf.response);
      const nums = (s: string | undefined): number[] =>
        (s ?? "").replace(/[<>,]/g, " ").trim().split(/\s+/).map(Number);
      const [x0, , z0] = nums(f.boundsMin);
      const [x1, , z1] = nums(f.boundsMax);
      const x = (x0 + x1) / 2;
      const z = (z0 + z1) / 2;
      if (f.hasBounds !== "true" || !Number.isFinite(x) || !Number.isFinite(z))
        return {
          status: "fail",
          summary: `Opened ${JSON.stringify(field(o.response, "Opened") ?? o.error)}; hasBounds ${f.hasBounds ?? "?"}: no centre, no getHeight`,
          data: { world: t, open: summarizeCall(o), terrain: f },
        };
      const h = await ctx.call({
        apiFunc: "EMCP_WB_Terrain",
        params: { action: "getHeight", x: String(x), z: String(z) },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("getHeight", accept);
      const ok =
        field(o.response, "Opened") === true &&
        f.hasBounds === "true" &&
        field(h.response, "status") === "ok" &&
        typeof field(h.response, "height") === "number";
      ctx.deps.writeArtifact("terrain-centre.json", { world: t, x, z });
      return {
        status: ok ? "pass" : "fail",
        summary: `Opened ${JSON.stringify(field(o.response, "Opened") ?? o.error)}; hasBounds ${f.hasBounds ?? "?"}; height ${JSON.stringify(field(h.response, "height") ?? h.error)}`,
        data: {
          world: t,
          open: summarizeCall(o),
          terrain: f,
          centre: { x, z },
          height: summarizeCall(h),
        },
      };
    },
  });

  const needTerrain = {
    waitsOn: "Q1" as const,
    skipWhen: {
      condition: "se-12 did not open the terrain copy (Q1 held by the owner)",
      carried_to: "an S-E repeat after the owner's terrain world (Q1)",
    },
    preSkip: terrainSkip,
    skip: (ctx: SeContext) =>
      priorStatus(ctx, "se-12-world-open-terrain") === "pass"
        ? null
        : "se-12 did not pass: the terrain copy is not open",
  };
  steps.push({
    id: "se-13-u18-tile",
    launch: 1,
    title:
      "U18: terrainWriteThrowaway mode tile, terrainIndex 0, tile 0,0, sample 0, delta 1.0, save false",
    risk: "mutating",
    answers: u18,
    timeout_ms: 2 * plainMs(TIMEOUTS.probe),
    expected:
      "began true, wrote true, after = before + 1; the first four samples show the array order",
    kill_criterion: `the open world not the terrain copy (checked before the write): STOP; status refused or error: STOP; after - before not 1: FAIL; ${DIALOG_KILL}`,
    side_effects: ["one height sample changed in memory inside a terrain action"],
    rollback:
      "in memory; never saved (save:true is never sent, review H2); the copy is removed with _throwaway/",
    outline: [],
    ...needTerrain,
    plan: (p) => [
      net(
        "se-13-u18-tile",
        u18,
        probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe, "throwaway-world check"),
      ),
      net(
        "se-13-u18-tile",
        u18,
        mut(
          "terrainWriteThrowaway",
          {
            target: tPlan(p),
            mode: "tile",
            terrainIndex: 0,
            tileX: 0,
            tileY: 0,
            sample: 0,
            delta: 1.0,
            save: false,
          },
          TIMEOUTS.probe,
        ),
      ),
    ],
    run: async (ctx) => {
      await confirmThrowaway(ctx, terrainTarget(ctx));
      const r = await ctx.call(
        mut(
          "terrainWriteThrowaway",
          {
            target: terrainTarget(ctx),
            mode: "tile",
            terrainIndex: 0,
            tileX: 0,
            tileY: 0,
            sample: 0,
            delta: 1.0,
            save: false,
          },
          TIMEOUTS.probe,
        ),
      );
      await ctx.modalCheck("terrainWriteThrowaway tile");
      if (probeStatus(r.response) !== "ok")
        throw new StopSession(
          "kill",
          `terrainWriteThrowaway ${probeStatus(r.response) ?? r.error}: ${S(field(r.response, "message"))}`,
        );
      const f = probeFacts(r.response);
      // float32 storage and float.ToString both round: compare with a tolerance.
      const b = Number(f.before);
      const a = Number(f.after);
      const rose = Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b - 1) < HEIGHT_EPS;
      return {
        status: rose && f.wrote === "true" ? "observed" : "fail",
        summary: `began ${f.began ?? "?"}, wrote ${f.wrote ?? "?"}, ${f.before ?? "?"} -> ${f.after ?? "?"}`,
        data: { facts: f, ...summarizeCall(r) },
      };
    },
  });

  steps.push({
    id: "se-14-u18-modify",
    launch: 1,
    title:
      "U18 undo: modify at the centre, size 10, inner 50, save false; getHeight; the throwaway-world check; Edit > Undo (shipped); getHeight. No saved stroke (review H2)",
    risk: "mutating",
    answers: [...u18, "P-U19"],
    timeout_ms: plainMs(TIMEOUTS.probe) * 3 + 4 * plainMs(TIMEOUTS.bohemia),
    expected:
      "heights before, after the stroke and after the undo all numeric: restored (U19 yes for terrain) only when the after-undo height is within 0.01 of the height before and the stroke changed it; equal after and after-undo heights read 'undo ran, height unchanged (target unconfirmed; possibly se-13's tile write)'; status ok alone never counts; a missing height or an undo not executed answers nothing",
    kill_criterion: `no terrain-centre.json (se-12's centre): STOP, nothing written; the open world not the terrain copy (checked before the write and before the undo): STOP; status refused: STOP; a modify that answers error or began false: FAIL, no read and no undo; ${DIALOG_KILL}`,
    side_effects: ["one brush stroke in memory"],
    rollback: "Edit > Undo in the step; never saved; the copy is removed with _throwaway/",
    outline: [
      "save:true is never sent to terrainWriteThrowaway (review H2): persistence is not read in S-E",
    ],
    ...needTerrain,
    plan: (p) => {
      const id = "se-14-u18-modify";
      const a = [...u18, "P-U19"];
      return [
        net(
          id,
          a,
          probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe, "throwaway-world check"),
        ),
        net(id, a, {
          apiFunc: "EMCP_WB_Terrain",
          params: { action: "getHeight", x: "<centre x>", z: "<centre z>" },
          timeoutMs: TIMEOUTS.bohemia,
          note: "before the modify",
        }),
        net(
          id,
          a,
          mut(
            "terrainWriteThrowaway",
            {
              target: tPlan(p),
              mode: "modify",
              x: "<centre x>",
              z: "<centre z>",
              size: 10,
              inner: 50,
              save: false,
            },
            TIMEOUTS.probe,
          ),
        ),
        net(id, a, {
          apiFunc: "EMCP_WB_Terrain",
          params: { action: "getHeight", x: "<centre x>", z: "<centre z>" },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        net(
          id,
          a,
          probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe, "throwaway-world check"),
        ),
        net(id, a, {
          apiFunc: "EMCP_WB_EditorControl",
          params: { action: "undo" },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        undoAction(id, a),
        net(id, a, {
          apiFunc: "EMCP_WB_Terrain",
          params: { action: "getHeight", x: "<centre x>", z: "<centre z>" },
          timeoutMs: TIMEOUTS.bohemia,
          note: "after undo",
        }),
      ];
    },
    run: async (ctx) => {
      const t = terrainTarget(ctx);
      const c = runJson<{ x: number; z: number }>(ctx.deps, "terrain-centre.json");
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z))
        throw new StopSession(
          "kill",
          "terrain-centre.json (se-12's centre) is absent: nothing is written at a guessed point",
        );
      await confirmThrowaway(ctx, t);
      const xs = String(c.x);
      const zs = String(c.z);
      const h0 = await ctx.call({
        apiFunc: "EMCP_WB_Terrain",
        params: { action: "getHeight", x: xs, z: zs },
        timeoutMs: TIMEOUTS.bohemia,
        note: "before the modify",
      });
      const m = await ctx.call(
        mut(
          "terrainWriteThrowaway",
          { target: t, mode: "modify", x: c.x, z: c.z, size: 10, inner: 50, save: false },
          TIMEOUTS.probe,
        ),
      );
      await ctx.modalCheck("terrainWriteThrowaway modify");
      if (probeStatus(m.response) === "refused")
        throw new StopSession(
          "kill",
          `terrainWriteThrowaway refused: ${S(field(m.response, "message"))}`,
        );
      const f = probeFacts(m.response);
      if (probeStatus(m.response) !== "ok" || f.began !== "true")
        return {
          status: "fail",
          summary: `the modify wrote nothing (${probeStatus(m.response) ?? m.error}: ${S(field(m.response, "message"))}); no read and no undo`,
          data: { modify: { facts: f, ...summarizeCall(m) } },
        };
      const h1 = await ctx.call({
        apiFunc: "EMCP_WB_Terrain",
        params: { action: "getHeight", x: xs, z: zs },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await confirmThrowaway(ctx, t);
      const u = await ctx.call({
        apiFunc: "EMCP_WB_EditorControl",
        params: { action: "undo" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("undo");
      const h2 = await ctx.call({
        apiFunc: "EMCP_WB_Terrain",
        params: { action: "getHeight", x: xs, z: zs },
        timeoutMs: TIMEOUTS.bohemia,
        note: "after undo",
      });
      const undoOk = u.ok && field(u.response, "status") === "ok";
      const v = undoVerdict(
        heightOf(h0),
        heightOf(h1),
        heightOf(h2),
        undoOk,
        S(field(u.response, "message")) || u.error || "",
      );
      return {
        status: v.status,
        summary: `modify ${f.before ?? "?"} -> ${f.after ?? "?"}; heights ${heightOf(h0) ?? "?"} / ${heightOf(h1) ?? "?"} / ${heightOf(h2) ?? "?"}; ${v.verdict}`,
        data: {
          heightBefore: summarizeCall(h0),
          restored: v.restored,
          changed: v.changed,
          verdict: v.verdict,
          modify: { facts: f, ...summarizeCall(m) },
          heightAfter: summarizeCall(h1),
          undo: summarizeCall(u),
          heightAfterUndo: summarizeCall(h2),
        },
      };
    },
  });

  const u10 = [E("plugins-netapi-cli-L462"), E("world-editor-L482"), E("resource-manager-L682")];
  steps.push({
    id: "se-15-u10-run",
    launch: 1,
    title:
      "U10 Run: pluginRunDialogFree on the one listed World Editor plugin with the terrain copy as target and nothing selected; detached",
    risk: "mutating",
    answers: u10,
    touches: ["P-U10"],
    timeout_ms: plainMs(TIMEOUTS.bohemia) + plainMs(TIMEOUTS.probe) + detachedMs(TIMEOUTS.plugin),
    expected:
      "status ok, message 'Run() returned', className the listed plugin, no window (dialog-free Run works: pass); refused or error: fail, nothing answered; a dialog: STOP (data for the watchdog)",
    kill_criterion: `GetState mode not edit, or a selection not empty, or the open world not the terrain copy with one sub-scene: STOP before Run; ${DIALOG_KILL}`,
    side_effects: ["whatever Run() does to an empty selection in the terrain copy [unverified]"],
    rollback: "inside _throwaway/; Don't Save at the close",
    outline: [],
    waitsOn: "Q1",
    restore:
      "the World Editor selection is read empty (EMCP_WB_GetState selectedCount 0) before the call, else STOP and nothing is run; Run() then writes nothing (an empty entity action); the terrain copy is never saved and the owner closes with Don't Save (owner's Q8 condition)",
    skipWhen: {
      condition:
        "se-12 did not open the terrain copy (Q1 held), or probe_mut.plugin_run_allow_list holds no World Editor entry",
      carried_to: "an S-E repeat after the owner's terrain world (Q1)",
    },
    preSkip: (o, deps) =>
      terrainSkip(o, deps) ?? (pluginEntryOf(o.policy) ? null : SKIP_REASON.q8plugin),
    skip: needTerrain.skip,
    plan: (p) => {
      const pl = p.plugin ?? { module: "WorldEditor", className: "<the listed plugin>" };
      return [
        net("se-15-u10-run", u10, {
          apiFunc: "EMCP_WB_GetState",
          params: {},
          timeoutMs: TIMEOUTS.bohemia,
          note: "mode edit and the selection empty",
        }),
        net(
          "se-15-u10-run",
          u10,
          probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe, "throwaway-world check"),
        ),
        net(
          "se-15-u10-run",
          u10,
          mut(
            "pluginRunDialogFree",
            { moduleName: pl.module, className: pl.className, target: tPlan(p) },
            TIMEOUTS.plugin,
          ),
          { detached: true },
        ),
      ];
    },
    run: async (ctx) => {
      const pl = pluginEntryOf(ctx.opts.policy)!;
      const st = await ctx.call({
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("GetState");
      if (field(st.response, "mode") !== "edit")
        throw new StopSession(
          "kill",
          `the World Editor is not in edit mode (mode ${JSON.stringify(field(st.response, "mode") ?? st.error)}): ${pl.className} is not run`,
        );
      if (Number(field(st.response, "selectedCount") ?? -1) !== 0)
        throw new StopSession(
          "kill",
          `the World Editor selection is not empty (selectedCount ${JSON.stringify(field(st.response, "selectedCount"))}): ${pl.className} is not run`,
        );
      await confirmThrowaway(ctx, terrainTarget(ctx));
      const r = await ctx.detached(
        mut(
          "pluginRunDialogFree",
          { moduleName: pl.module, className: pl.className, target: terrainTarget(ctx) },
          TIMEOUTS.plugin,
        ),
        "se-15-run",
      );
      const ran =
        r.ok &&
        probeStatus(r.response) === "ok" &&
        S(field(r.response, "message")) === "Run() returned" &&
        probeFacts(r.response).className === pl.className;
      return {
        status: ran ? "pass" : "fail",
        summary: `${ran ? "dialog-free Run() returned" : "not answered"}: ${probeStatus(r.response) ?? r.error}: ${S(field(r.response, "message"))}`,
        data: { plugin: pl, call: summarizeCall(r), facts: probeFacts(r.response) },
      };
    },
  });

  // ── Launch 1, last: U14 GUI half ──────────────────────────────────────────
  const locate = (sandbox: string): Record<string, unknown> => ({
    selectedProject: SANDBOX_NAME,
    projectPath: sandbox.replace(/\//g, "\\"),
    selectedFolder: sandbox.replace(/\//g, "\\"),
  });
  const reloadSpec: CallSpec = { apiFunc: "ReloadScripts", params: {}, timeoutMs: TIMEOUTS.reload };
  steps.push({
    id: "se-16-u14-reload-broken",
    launch: 1,
    title: `U14 GUI half, LAST of launch 1: plant ${U14_FOLDER_REL}/${U14_FILE} (S-A's undefined type and call) after the gate; native ReloadScripts (detached, 900 s); EMCP_WB_Ping, Bohemia LocatePrefabsFromPath, ECEN_Probe info, each answered or 'Undefined API func'; the WorkbenchGame log lines; delete the file by hash; ReloadScripts; Ping`,
    risk: "mutating",
    answers: ["P-U14"],
    timeout_ms:
      2 * detachedMs(TIMEOUTS.reload) +
      2 * plainMs(TIMEOUTS.cheap) +
      plainMs(TIMEOUTS.bohemia) +
      plainMs(TIMEOUTS.probe),
    expected:
      "which handlers survive a failed reload in a running Workbench (shipped, Bohemia's, the pack's), and whether the recovery reload brings them back",
    kill_criterion: `a dialog after a reload: HANDOFF (exit 5), the owner closes it (Q6); the file changed on disk before its removal: STOP; ${DIALOG_KILL}`,
    side_effects: [
      "one broken .c in a throwaway script folder; handlers possibly dead until the recovery reload",
    ],
    rollback:
      "plant-se-16.json; the file deleted by hash in the step, else by the rollback subcommand once no Workbench runs; the folder removed",
    outline: [
      "pre-flight refuses the U14 folder, so it is planted after the gate and removed in the step",
    ],
    plan: (p) => [
      net("se-16-u14-reload-broken", ["P-U14"], reloadSpec, {
        detached: true,
        note: "with the broken file",
      }),
      net("se-16-u14-reload-broken", ["P-U14"], {
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
      net("se-16-u14-reload-broken", ["P-U14"], {
        apiFunc: "LocatePrefabsFromPath",
        params: locate(p.sandbox),
        timeoutMs: TIMEOUTS.bohemia,
      }),
      net("se-16-u14-reload-broken", ["P-U14"], probe("info", { page: 0 }, TIMEOUTS.probe)),
      net("se-16-u14-reload-broken", ["P-U14"], reloadSpec, {
        detached: true,
        note: "recovery, the file removed",
      }),
      net("se-16-u14-reload-broken", ["P-U14"], {
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "after recovery",
      }),
    ],
    run: async (ctx) => {
      const folder = abs(ctx.opts.sandboxDir, U14_FOLDER_REL);
      const file = join(folder, U14_FILE);
      if (ctx.deps.fileExists(folder))
        throw new StopSession(
          "kill",
          `${U14_FOLDER_REL} exists already: not this run's; nothing planted`,
        );
      const data = Buffer.from(U14_SOURCE, "utf-8");
      ctx.deps.writeArtifact("plant-se-16.json", {
        step: "se-16-u14-reload-broken",
        rel: `${U14_FOLDER_REL}/${U14_FILE}`,
        sha256: sha256Hex(data),
      });
      ctx.deps.writeFile(file, data);
      const logBefore = ctx.deps.sessionLogAfter(null);
      const linesBefore = logBefore ? ctx.deps.readText(logBefore).split(/\r?\n/).length : 0;
      const r1 = await ctx.detached(reloadSpec, "se-16-reload", { onDialog: "handoff" });
      const ping = await ctx.call({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      await ctx.modalCheck("Ping");
      const bi = await ctx.call({
        apiFunc: "LocatePrefabsFromPath",
        params: locate(ctx.opts.sandboxDir),
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("LocatePrefabsFromPath");
      const info = await ctx.call(probe("info", { page: 0 }, TIMEOUTS.probe));
      await ctx.modalCheck("info");
      const log = ctx.deps.sessionLogAfter(null);
      const lines = log
        ? ctx.deps
            .readText(log)
            .split(/\r?\n/)
            .slice(log === logBefore ? linesBefore : 0)
            .filter((l) => /WorkbenchGame|ECEN_U14/i.test(l))
            .slice(0, 40)
        : [];
      // The removal, by hash.
      const now = ctx.deps.readBytes(file);
      if (sha256Hex(now) !== sha256Hex(data))
        throw new StopSession("kill", `${U14_FILE} changed on disk; left for the main session`);
      ctx.deps.removeFile(file);
      const left = ctx.deps.listDir(folder);
      if (left.length)
        throw new StopSession(
          "kill",
          `${U14_FOLDER_REL} holds ${left.join(", ")} (not this run's): named, never deleted`,
        );
      ctx.deps.removeEmptyDir(folder);
      ctx.deps.writeArtifact("rollback-se-16.json", { ok: true, by: "step" });
      const r2 = await ctx.detached(reloadSpec, "se-16-recover", { onDialog: "handoff" });
      const ping2 = await ctx.call({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      await ctx.modalCheck("Ping after recovery");
      const ans = (r: RawCallResult): string =>
        r.ok
          ? "answered"
          : /Undefined API func/i.test(r.error ?? "")
            ? "Undefined API func"
            : String(r.error);
      return {
        status: "observed",
        summary: `reload with the broken file ${ans(r1)} (status ${JSON.stringify(field(r1.response, "status") ?? null)}); then Ping ${ans(ping)}, LocatePrefabsFromPath ${ans(bi)}, ECEN_Probe ${ans(info)}; recovery reload ${ans(r2)} (status ${JSON.stringify(field(r2.response, "status") ?? null)}), Ping ${ans(ping2)}`,
        data: {
          reload: summarizeCall(r1),
          ping: summarizeCall(ping),
          bohemia: summarizeCall(bi),
          probeInfo: summarizeCall(info),
          logLines: lines,
          recovery: summarizeCall(r2),
          pingAfter: summarizeCall(ping2),
        },
      };
    },
  });

  // ── Offline, between launch 1 and 2 ───────────────────────────────────────
  steps.push({
    id: OFFLINE_STEP,
    launch: 0,
    title:
      "Offline, no Workbench (checked, --offline): move the se-01 control .conf with its Workbench-made .meta as refactor_move_resource_path does (Name line rewritten) to _throwaway/SE/u25/moved/; rename a second copy without its meta",
    risk: "mutating",
    answers: [],
    timeout_ms: 60_000,
    expected: `plant-se-19.json written; nothing outside ${U25_DIR}/ touched`,
    kill_criterion:
      "a Workbench image running: REFUSE (no step runs); a target existing already: STOP",
    side_effects: [`files moved inside ${U25_DIR}/`],
    rollback: "plant-se-19.json; removed with _throwaway/",
    outline: ["no gate and no NET call; run with --offline only"],
    plan: () => [],
    run: async (ctx) => {
      const dir = abs(ctx.opts.sandboxDir, U25_DIR);
      const moves: Array<Record<string, unknown>> = [];
      const move = (fromRel: string, toRel: string): void => {
        const from = abs(ctx.opts.sandboxDir, fromRel);
        const to = abs(ctx.opts.sandboxDir, toRel);
        if (ctx.deps.fileExists(to)) throw new StopSession("kill", `${toRel} exists already`);
        const sha = sha256Hex(ctx.deps.readBytes(from));
        ctx.deps.moveFile(from, to);
        moves.push({ from: fromRel, to: toRel, sha256: sha });
      };
      const control = `${U25_DIR}/ECEN_SE_U25_Control.conf`;
      const movedRel = `${U25_MOVED}/ECEN_SE_U25_Control.conf`;
      if (!ctx.deps.fileExists(abs(ctx.opts.sandboxDir, control)))
        throw new StopSession("kill", `${control} is absent: the plants are not there`);
      move(control, movedRel);
      const meta = abs(ctx.opts.sandboxDir, `${control}.meta`);
      let metaMoved = false;
      if (ctx.deps.fileExists(meta)) {
        const text = ctx.deps.readBytes(meta).toString("utf-8");
        const rewritten = Buffer.from(rewriteMetaName(text, control, movedRel), "utf-8");
        ctx.deps.writeFile(abs(ctx.opts.sandboxDir, `${movedRel}.meta`), rewritten);
        ctx.deps.removeFile(meta);
        moves.push({
          from: `${control}.meta`,
          to: `${movedRel}.meta`,
          sha256Before: sha256Hex(Buffer.from(text, "utf-8")),
          sha256After: sha256Hex(rewritten),
          nameRewritten: !rewritten.equals(Buffer.from(text, "utf-8")),
        });
        metaMoved = true;
      }
      move(`${U25_DIR}/ECEN_SE_U25_Rename.conf`, `${U25_DIR}/ECEN_SE_U25_Renamed.conf`);
      ctx.deps.writeArtifact("plant-se-19.json", {
        step: OFFLINE_STEP,
        moves,
        metaMoved,
        leftBehind: ctx.deps.listDir(dir),
      });
      return {
        status: "pass",
        summary: `control .conf moved ${metaMoved ? "with its Workbench-made .meta (Name rewritten)" : "without a meta (Workbench made none)"}; the second copy renamed, its meta left behind`,
        data: { moves, metaMoved },
      };
    },
  });

  // ── Launch 2 ──────────────────────────────────────────────────────────────
  steps.push({
    id: "se-20-gate",
    launch: 2,
    title:
      "Gate of launch 2 (as se-00, run first on every invocation), plus: the Workbench is a new process, not launch 1's",
    risk: "read-only",
    answers: [],
    timeout_ms: HELPER.process,
    expected: "the gate passed on a pid that no launch-1 step's started marker names",
    kill_criterion: `as se-00; the pid the launch-1 steps ran against: STOP (launch 1 was not closed); ${DIALOG_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: [],
    plan: () => [],
    run: async (ctx) => {
      const pid = ctx.state.wbPid;
      const launch1 = ctx.deps
        .listRunFiles()
        .filter((f) => /^se-(0[1-9]|1[0-6])-.*\.started$/.test(f))
        .map((f) => runJson<StartedMarker>(ctx.deps, f)?.pid)
        .filter((x): x is number => typeof x === "number");
      if (pid === null)
        throw new StopSession(
          "kill",
          "the gate recorded no Workbench pid: launch 2 cannot be told from launch 1",
        );
      if (launch1.includes(pid))
        throw new StopSession(
          "kill",
          `pid ${pid} is launch 1's: close it by hand (File > Exit, Don't Save) and launch again`,
        );
      return {
        status: "pass",
        summary: `launch 2 pid ${pid}; launch 1 ran on ${[...new Set(launch1)].join(", ") || "no recorded pid"}`,
        data: { pid, launch1Pids: [...new Set(launch1)] },
      };
    },
  });

  steps.push({
    id: "se-21-u25-second-start",
    launch: 2,
    title:
      "U25 second start: se-01's reads on the moved (with sidecar), renamed (without meta) and hand-meta files; their .meta hashes",
    risk: "read-only",
    answers: [...u25Answers, E("resource-manager-L667"), "P-DEC019-offline-move-sidecar"],
    timeout_ms: U25_SECOND.length * 2 * plainMs(TIMEOUTS.bohemia),
    expected:
      "the moved resource keeps its GUID and resolves; the renamed one gets a new GUID, an orphan meta or an error; hand-written metas kept or regenerated",
    kill_criterion: DIALOG_KILL,
    side_effects: [],
    rollback: "none needed",
    outline: [],
    plan: () =>
      resourceReads(
        "se-21-u25-second-start",
        [...u25Answers, E("resource-manager-L667"), "P-DEC019-offline-move-sidecar"],
        U25_SECOND,
      ),
    run: async (ctx) => {
      const rows = await readResources(ctx, U25_SECOND);
      return {
        status: "observed",
        summary: rows
          .map(
            (r) =>
              `${basename(String(r.rel))}: ${resourceLine(r)}, meta ${r.metaOnDisk ? "on disk" : "none"}`,
          )
          .join("; "),
        data: { rows, se19: runJson(ctx.deps, "plant-se-19.json") },
      };
    },
  });

  steps.push({
    id: "se-22-texture-validator",
    launch: 2,
    title:
      "Bohemia TextureValidator with an absolute texture_path on the texture plant (only when its meta is on disk)",
    risk: "read-only",
    answers: ["P-DEC019-TextureValidator-path-and-empty-reports"],
    touches: [E("mcp-inventory-L381"), "P-U26"],
    timeout_ms: plainMs(TIMEOUTS.bohemia),
    expected: "accepted or not; reports [] serialised or absent",
    kill_criterion: DIALOG_KILL,
    side_effects: [],
    rollback: "none needed",
    outline: ["a null meta crashes the handler's dereference (DEC-019): skipped without the .meta"],
    skipWhen: { condition: "the texture plant's .meta is not on disk", carried_to: "Phase 3.3" },
    preSkip: (o, deps) =>
      deps.fileExists(abs(o.sandboxDir, `${U25_TEXTURE}.meta`))
        ? null
        : `${U25_TEXTURE}.meta is not on disk (a null meta crashes the handler, DEC-019)`,
    plan: (p) => [
      net("se-22-texture-validator", ["P-DEC019-TextureValidator-path-and-empty-reports"], {
        apiFunc: "TextureValidator",
        params: { texture_path: abs(p.sandbox, U25_TEXTURE) },
        timeoutMs: TIMEOUTS.bohemia,
      }),
    ],
    run: async (ctx) => {
      const r = await ctx.call({
        apiFunc: "TextureValidator",
        params: { texture_path: abs(ctx.opts.sandboxDir, U25_TEXTURE) },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("TextureValidator");
      const reports = field(r.response, "reports");
      const severity = field(r.response, "severity");
      return {
        status: "observed",
        summary: `${r.ok ? "answered" : r.error}; reports ${reports === undefined ? "absent" : JSON.stringify(reports)}; severity ${severity === undefined ? "absent" : JSON.stringify(severity)}`,
        data: summarizeCall(r),
      };
    },
  });

  steps.push({
    id: "se-23-world-reopen-tiny",
    launch: 2,
    title: `U17 persistence: OpenResource on the tiny world (detached); ECEN_Probe layerRead; GetResourceInfo on the .ent`,
    risk: "reversible",
    answers: ["P-U17", E("world-editor-L479")],
    touches: [E("mcp-inventory-L349")],
    timeout_ms: detachedMs(TIMEOUTS.openTiny) + plainMs(TIMEOUTS.probe) + plainMs(TIMEOUTS.bohemia),
    expected: `${LAYER_NAME} listed after the restart (persisted) or not`,
    kill_criterion: DIALOG_KILL,
    side_effects: ["the tiny world loaded"],
    rollback: "se-24's close",
    outline: [openNote],
    skipWhen: { condition: "the tiny world is absent", carried_to: "an S-E repeat" },
    preSkip: tinyAbsent,
    plan: () => [
      net("se-23-world-reopen-tiny", ["P-U17", E("world-editor-L479")], {
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
      net("se-23-world-reopen-tiny", ["P-U17", E("world-editor-L479")], openWorldEditorSpec, {
        detached: true,
      }),
      net("se-23-world-reopen-tiny", ["P-U17", E("world-editor-L479")], openTinySpec, {
        detached: true,
      }),
      net(
        "se-23-world-reopen-tiny",
        ["P-U17", E("world-editor-L479")],
        probe("layerRead", { subScene: -1, page: 0 }, TIMEOUTS.probe),
      ),
      net("se-23-world-reopen-tiny", ["P-U17", E("world-editor-L479")], {
        apiFunc: "GetResourceInfo",
        params: { path: TINY_WORLD, expandResource: false },
        timeoutMs: TIMEOUTS.bohemia,
      }),
    ],
    run: async (ctx) => {
      const target = tinyOpenTarget(ctx.deps.readRunFile(WORLDS_FILE));
      const moduleOpen = await openWorldEditorIfNeeded(ctx, tinyAccept, "se-23-open-we");
      const o = await ctx.detached(openTinyFor(target), "se-23-open", { expected: tinyAccept });
      const waited = await waitForWorldEditor(ctx, tinyAccept);
      const l = waited.l;
      const info = await ctx.call({
        apiFunc: "GetResourceInfo",
        params: { path: TINY_WORLD, expandResource: false },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("GetResourceInfo", tinyAccept);
      const cells = field(l.response, "cells");
      const lf = probeFacts(l.response);
      const gate = !shippedOpened(o)
        ? `open failed (${field(o.response, "message") ?? o.error})`
        : !l.ok || probeStatus(l.response) !== "ok"
          ? `layerRead ${probeStatus(l.response) ?? l.error}`
          : !isThrowawayWorld(lf, TINY_WORLD)
            ? `not the tiny world (${lf.worldPath ?? "?"})`
            : null;
      const listed = gate
        ? null
        : Array.isArray(cells) && cells.some((c) => String(c).includes(LAYER_NAME));
      return {
        status: gate ? "fail" : "observed",
        summary: gate
          ? `INCONCLUSIVE: ${gate}; persistence of ${LAYER_NAME} not read`
          : `Opened true; ${LAYER_NAME} ${listed ? "listed (persisted)" : "not listed"}`,
        data: {
          open: summarizeCall(o),
          openedBy: target,
          worldEditorModuleOpen: {
            wasRunning: moduleOpen.wasRunning,
            call: moduleOpen.moduleOpen ? summarizeCall(moduleOpen.moduleOpen) : null,
          },
          worldEditorWait: {
            polls: waited.polls,
            elapsedMs: waited.elapsedMs,
            ready: waited.ready,
            isRunning: summarizeCall(waited.we),
            state: summarizeCall(waited.st),
          },
          layerRead: summarizeCall(l),
          rawWorldPath: lf.worldPath ?? null,
          rawWorldPathGuidPrefixed: RESOURCE_NAME_RE.test(lf.worldPath ?? ""),
          resourceInfo: summarizeCall(info),
          layerListed: listed,
        },
      };
    },
  });

  steps.push({
    id: "se-24-close-test",
    launch: 2,
    title:
      "Close path: with only the main window and the World Editor open and nothing changed, one WM_CLOSE to the recorded main window; wait 120 s; CrashReporter.exe and the port listed",
    risk: "reversible",
    answers: ["P-SD-wmclose-reads-as-crash"],
    timeout_ms: 2 * HELPER.windows + TIMEOUTS.close + 30_000 + 2 * HELPER.process,
    expected:
      "exits cleanly with no new Crash Reporter (graceful-exit record written) or reports a crash or does not exit (WM_CLOSE is never the close path)",
    kill_criterion:
      "a save prompt or any dialog after the close: HANDOFF, never answered; the owner closes by hand (File > Exit, Don't Save)",
    side_effects: ["Workbench ends"],
    rollback: "none; graceful-exit record on a clean exit",
    outline: [
      "WM_CLOSE (CloseMainWindow) is not a plan action kind: the close is outlined here only",
    ],
    plan: () => [],
    run: async (ctx) => {
      const pid = ctx.state.wbPid!;
      const before = await ctx.ourWindows();
      const crashBefore = ctx.deps.crashReporters();
      const c = await ctx.deps.closeGracefully(pid, TIMEOUTS.close);
      const crashAfter = ctx.deps.crashReporters();
      const newCrash = crashAfter.filter((x) => !crashBefore.includes(x));
      const port = ctx.deps.portOwners();
      if (!c.exited) {
        const left = await ctx.ourWindows();
        ctx.deps.writeArtifact("se-24-observed.json", { before, left, close: c, newCrash, port });
        throw new StopSession(
          "handoff",
          `Workbench did not exit within ${TIMEOUTS.close} ms of one WM_CLOSE (${c.detail}); windows: ${left.map((w) => `${w.className} "${w.title}"`).join(" | ")}. Owner: close it by hand (File > Exit, Don't Save; never Save). Nothing is answered by the harness`,
        );
      }
      const graceful = newCrash.length === 0;
      const file = graceful
        ? ctx.deps.writeGracefulExit(pid, `CloseMainWindow, exit seen within ${TIMEOUTS.close} ms`)
        : null;
      return {
        status: "observed",
        summary: graceful
          ? "exited cleanly on one WM_CLOSE; no new Crash Reporter (graceful-exit record written)"
          : `exited, but a Crash Reporter started (pid ${newCrash.join(", ")}): WM_CLOSE reads as a crash`,
        data: {
          windowsBefore: before,
          close: c,
          newCrashReporters: newCrash,
          portOwners: port,
          gracefulExit: file,
        },
      };
    },
  });

  // ── Launch 3 (Q3, the owner's; deferred) ──────────────────────────────────
  const u15 = ["P-U15", E("mcp-inventory-L276")];
  const q3 = {
    waitsOn: "Q3" as const,
    skipWhen: {
      condition: "--u15-launch3 (with --owner-go-u15-launch3) not given: Q3 deferred by the owner",
      carried_to:
        "S-F or a dedicated launch (U15 not settled: needs -addonsDir; fallback: injection and the publish guard)",
    },
    preSkip: (o: SeOptions) => (o.u15Launch3 ? null : SKIP_REASON.q3),
  };
  steps.push({
    id: "se-30-u15-gate",
    launch: 3,
    title: `Gate of launch 3 (as se-00) plus: is ${HOST_ADDON} among the loaded addons (GetLoadedProjects, ECEN_Probe info)`,
    risk: "read-only",
    answers: u15,
    timeout_ms: plainMs(TIMEOUTS.bohemia) + plainMs(TIMEOUTS.probe),
    expected: "the sandbox opened; the host addon loaded or not",
    kill_criterion: `as se-00; the sandbox not opened: ABORT; ${DIALOG_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: [
      "launch 3 needs a pre-flight -addonsDir option that is not written (a separate owner-ruled change)",
    ],
    ...q3,
    plan: () => [
      net("se-30-u15-gate", u15, {
        apiFunc: "GetLoadedProjects",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      }),
      net("se-30-u15-gate", u15, probe("info", { page: 0 }, TIMEOUTS.probe)),
    ],
    run: async (ctx) => {
      const lp = await ctx.call({
        apiFunc: "GetLoadedProjects",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("GetLoadedProjects");
      const info = await ctx.call(probe("info", { page: 0 }, TIMEOUTS.probe));
      await ctx.modalCheck("info");
      const ids = lp.ok ? loadedProjectsOf(lp.response) : null;
      const loaded =
        ids === null ? null : ids.some((x) => x.toLowerCase() === HOST_ADDON.toLowerCase());
      const infoIds = infoAddonIds(info.response);
      const inInfo = infoIds.some((x) => x.toLowerCase() === HOST_ADDON.toLowerCase());
      return {
        status: "observed",
        summary: `${HOST_ADDON} ${ids === null ? `unknown by GetLoadedProjects (${lp.ok ? "no Loaded Projects list" : `failed: ${lp.error}`})` : `${loaded ? "loaded" : "not loaded"} by GetLoadedProjects (${ids.join(", ")})`}, ${inInfo ? "listed" : "not listed"} by ECEN_Probe info (${infoIds.join(", ") || "no table"})`,
        data: {
          loaded: ids,
          hostLoaded: loaded,
          infoAddons: infoIds,
          hostInInfo: inInfo,
          lp: summarizeCall(lp),
          info: summarizeCall(info),
        },
      };
    },
  });
  steps.push({
    id: "se-31-u15-host-ping",
    launch: 3,
    title: `U15: the host addon's NET function ${HOST_PING_API}`,
    risk: "read-only",
    answers: u15,
    timeout_ms: plainMs(TIMEOUTS.cheap),
    expected:
      "answers (U15 yes: change the install model) or 'Undefined API func' (U15 no: keep injection and the publish guard)",
    kill_criterion: DIALOG_KILL,
    side_effects: [],
    rollback: "none needed",
    outline: [],
    ...q3,
    plan: () => [
      net("se-31-u15-host-ping", u15, {
        apiFunc: HOST_PING_API,
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
    ],
    run: async (ctx) => {
      const r = await ctx.call({ apiFunc: HOST_PING_API, params: {}, timeoutMs: TIMEOUTS.cheap });
      await ctx.modalCheck(HOST_PING_API);
      return {
        status: "observed",
        summary: r.ok
          ? "answered: U15 yes"
          : /Undefined API func/i.test(r.error ?? "")
            ? "Undefined API func: U15 no"
            : String(r.error),
        data: summarizeCall(r),
      };
    },
  });

  // Every step but the gate and the offline step reads the process table once for its marker.
  return steps.map((s) =>
    s.id === "se-00-gate" || s.id === OFFLINE_STEP
      ? s
      : Object.assign(s, { timeout_ms: s.timeout_ms + HELPER.table }),
  );
}

// ── The gate ─────────────────────────────────────────────────────────────────

async function waitPort(ctx: SeContext, pid: number, budgetMs: number): Promise<void> {
  const deadline = ctx.deps.now() + budgetMs;
  for (;;) {
    ctx.deps.heartbeat();
    const owners = ctx.deps.portOwners();
    if (owners.includes(pid)) return;
    const foreign = owners.filter((o) => o !== pid);
    if (foreign.length)
      throw new StopSession(
        "kill",
        `the NET port is held by pid ${foreign.join(", ")}, not by ${pid}`,
      );
    if (ctx.deps.processImage(pid) === null)
      throw new StopSession("kill", `Workbench pid ${pid} exited before listening`);
    if (ctx.deps.now() >= deadline)
      throw new StopSession("timeout", `pid ${pid} did not listen within ${budgetMs} ms`);
    await ctx.deps.sleep(TIMEOUTS.poll);
  }
}

async function waitScriptsCompiled(ctx: SeContext, budgetMs: number): Promise<RawCallResult> {
  const deadline = ctx.deps.now() + budgetMs;
  for (;;) {
    const r = await ctx.call({
      apiFunc: "IsWorkbenchRunning",
      params: {},
      timeoutMs: TIMEOUTS.cheap,
    });
    if (r.ok && field(r.response, "ScriptsCompiled") === true) return r;
    if (ctx.deps.now() >= deadline)
      throw new StopSession(
        "kill",
        `scripts not compiled after ${budgetMs} ms; the compile gate failed (plan 5.4)`,
      );
    await ctx.deps.sleep(TIMEOUTS.poll);
  }
}

function debugModeGate(ctx: SeContext): { state: string; line: string | null; source: string } {
  if (ctx.opts.forceSettings) {
    const r = iniScriptDebugMode(ctx.deps.readText(ctx.opts.forceSettings));
    if (r.state === "on")
      throw new StopSession(
        "kill",
        `Script Debug Mode is on in the forced settings ini (${r.line})`,
      );
    if (r.state === "absent" && !ctx.opts.debugModeUnsetOk)
      throw new StopSession(
        "kill",
        "the forced settings ini holds no ScriptDebugMode: confirm, then repeat with --debug-mode-unset-ok",
      );
    return { ...r, source: "force-settings-ini" };
  }
  if (!ctx.opts.registryExport)
    throw new StopSession("kill", "no pre-flight registry export given (--registry-export)");
  const r = scriptDebugMode(ctx.deps.readRegLines(ctx.opts.registryExport));
  if (r.state === "on")
    throw new StopSession(
      "kill",
      `Script Debug Mode is on in the pre-flight registry export (${r.line})`,
    );
  if (r.state === "absent" && !ctx.opts.debugModeUnsetOk)
    throw new StopSession(
      "kill",
      "the registry export holds no ScriptDebugMode value: confirm, then repeat with --debug-mode-unset-ok",
    );
  return { ...r, source: "registry-export" };
}

async function runGate(ctx: SeContext): Promise<StepOutcome> {
  const debug = debugModeGate(ctx);
  const pid = ctx.deps.recordedPid();
  if (pid === null)
    throw new StopSession(
      "kill",
      "this lane's lease records no Workbench pid: run preflight.ts first",
    );
  const image = ctx.deps.processImage(pid);
  if (image === null || image.toLowerCase() !== WORKBENCH_EXE.toLowerCase())
    throw new StopSession(
      "kill",
      `recorded pid ${pid} is ${image ?? "not running"}, not ${WORKBENCH_EXE}`,
    );
  const created = await ctx.deps.processCreated(pid);
  const known = knownPid(ctx.deps, pid, created);
  if (known === "reused")
    throw new StopSession("kill", `recorded pid ${pid} is a reused pid, never adopted`);
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
  if (log) {
    const text = ctx.deps.readText(log);
    fromLog = openedProjectFromLog(text, ctx.opts.openedProjectPattern);
    if (fromLog !== null && !namesSandbox(fromLog, ctx.opts.gproj))
      throw new StopSession("abort", `not the sandbox: the session log names ${fromLog}`);
    const prev =
      known === "known"
        ? (runJson<{ data?: { logScan?: LogScan } }>(ctx.deps, "se-00-gate.json")?.data?.logScan ??
          null)
        : null;
    const scanned = scanSessionLog(log, text, prev);
    ctx.state.logScan = scanned.scan;
    if (scanned.errors.length)
      throw new StopSession(
        "kill",
        `the session log holds probe-pack compile errors (train #1b failed, plan 5.4 step 5): ${scanned.errors.join(" | ")}`,
      );
  }
  const pack = ctx.deps
    .listDir(probePackTarget(ctx.opts.sandboxDir))
    .filter((f) => isProbePackFile(f));
  const mutFiles = pack.filter((f) => /^ECEN_ProbeMut/i.test(f));
  const roFiles = pack.filter((f) => !/^ECEN_ProbeMut/i.test(f));
  if (!roFiles.length || !mutFiles.length)
    throw new StopSession(
      "kill",
      `both packs must be installed (launch.ts --install-handlers --probe-pack mod-dev/probe --probe-pack mod-dev/probe-mut): ${roFiles.length} read-only and ${mutFiles.length} mutating files`,
    );
  const baseline = await ctx.setBaseline("the gate");
  ctx.state.mainHwnd = mainWindowOf(baseline, pid)?.hwnd ?? null;
  const info = await ctx.call(probe("info", { page: 0 }, TIMEOUTS.probe));
  await ctx.modalCheck("info");
  if (!info.ok)
    throw new StopSession(
      "kill",
      /Undefined API func/i.test(info.error ?? "")
        ? `ECEN_Probe answers "${info.error}": the read-only pack did not compile`
        : `ECEN_Probe info failed: ${info.error}`,
    );
  const f = probeFacts(info.response);
  if (f.isSandbox !== "true")
    throw new StopSession(
      "abort",
      `not the sandbox: ECEN_Probe info says isSandbox ${f.isSandbox ?? "absent"} (${f.why ?? ""})`,
    );
  const m = await ctx.call(mut("none", {}, TIMEOUTS.probe));
  await ctx.modalCheck("ECEN_ProbeMut none");
  if (!m.ok)
    throw new StopSession(
      "kill",
      /Undefined API func/i.test(m.error ?? "")
        ? `ECEN_ProbeMut answers "${m.error}": the mutating pack did not compile (train #1b failed)`
        : `ECEN_ProbeMut failed: ${m.error}`,
    );
  const ms = probeStatus(m.response);
  const msg = S(field(m.response, "message"));
  if (ms === "refused")
    throw new StopSession(
      "kill",
      `ECEN_ProbeMut refused on its sandbox check (blocker B1): ${msg}`,
    );
  if (!(ms === "error" && /Unknown action/i.test(msg)))
    throw new StopSession(
      "kill",
      `ECEN_ProbeMut answered ${ms ?? "?"} "${msg}", not error "Unknown action"`,
    );
  return {
    status: "pass",
    summary: `Script Debug Mode ${debug.state} (${debug.source}); pid ${pid}; loaded ${(ids ?? []).join(", ")}; packs ${roFiles.length} + ${mutFiles.length} files; info isSandbox true; ECEN_ProbeMut answers "Unknown action" (compiled, sandbox check passed)`,
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
      packFiles: pack,
      info: summarizeCall(info),
      mutGate: summarizeCall(m),
      windows: ctx.state.baselineWindows,
    },
  };
}

// ── Queue ────────────────────────────────────────────────────────────────────

export const RISK_DEFINITIONS: Record<RiskClass, string> = {
  "read-only": "changes no state in Workbench or on disk",
  reversible:
    "changes in-memory editor, world or window state only (a loaded throwaway world, entities created and removed in the step, the close test); nothing on disk outside the run's records",
  mutating:
    "writes a file under <sandbox>/_throwaway/ or Scripts/WorkbenchGame/EMCP2_U14_Throwaway/ (worlds, saved containers, a layer, a broken script, offline moves), switches an editor's document and sets a value in memory (containerWriteTest), changes a diag option, writes terrain in memory, or runs a plugin",
};

export const ORDER_NOTE =
  "Read-only, then reversible, then mutating WITHIN each launch (plan 5.3 step 7; each probe carries its `launch`, and pre-flight step 7 checks the order per launch). Three launches in one sitting: launch 1 (closed by the owner's hand), the offline step (launch 0, between 1 and 2), launch 2 (second-start reads and the close test), launch 3 (U15, only on the owner's Q3). Deviations for the main session to ratify: se-03 (createSandboxWorlds) is the first write (plan 8: 'createSandboxWorlds first'); se-04 (a reversible diag set) is classed mutating so it sits with the writes; the world steps are grouped by world (tiny: open, U19, U13, U17; terrain: open, U18, U10 Run), and so the world opens (se-08, se-12) and the in-memory entity steps (se-09, se-10) are classed mutating like the writes they sit among (a more cautious class never weakens a gate, as S-D classed U6); U14's failed reload is last in launch 1. The Particle Editor is never addressed (DEC-042).";

export function worstCaseTotalMs(steps: StepDef[] = buildSteps()): number {
  return steps.reduce((sum, s) => sum + s.timeout_ms, 0);
}

export function selectedIds(
  sel: { from: string | null; until: string | null; only?: string | null; repeat?: boolean },
  steps: StepDef[] = buildSteps(),
): string[] {
  const ids = steps.map((s) => s.id);
  if (sel.repeat) return ids.filter((id) => (REPEAT_STEPS as readonly string[]).includes(id));
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
  const gate = ids.length === 1 && ids[0] === OFFLINE_STEP ? 0 : steps[0].timeout_ms;
  return (
    gate +
    steps.filter((s) => ids.includes(s.id)).reduce((sum, s) => sum + s.timeout_ms, 0) +
    INVOCATION_MARGIN_MS
  );
}

/** Why a real run's selection is refused, or null. */
export function selectionRefusal(
  sel: {
    from: string | null;
    until: string | null;
    only: string | null;
    runDir: boolean;
    offline?: boolean;
    /** --repeat: the repeat sitting's steps (REPEAT_STEPS) in one launch. */
    repeat?: boolean;
    /** --repeat-all: a step session 007 answered may run again. */
    repeatAll?: boolean;
  },
  steps: StepDef[] = buildSteps(),
): string | null {
  if (sel.repeat) {
    if (sel.only || sel.from || sel.until) return "--repeat excludes --only, --from and --until";
    if (sel.offline) return `--offline runs ${OFFLINE_STEP} only`;
    if (sel.repeatAll) return "--repeat excludes --repeat-all";
    const ids = selectedIds(sel, steps);
    if (ids.length !== REPEAT_STEPS.length)
      return "the repeat sitting's steps are not all in the step table";
    const worst = invocationWorstCaseMs(ids, steps);
    if (worst > BACKGROUND_CAP_MS)
      return `the repeat's worst case (${worst} ms) is above the caller's ${BACKGROUND_CAP_MS} ms background limit`;
    return null;
  }
  const isBlock = BLOCKS.some((b) => b.from === sel.from && b.until === sel.until);
  if (!sel.only && !isBlock)
    return "a real run is one declared block (--from X --until Y, runbook section E) or one step (--only X), never the whole sitting in one invocation";
  const answered = selectedIds(sel, steps).filter((id) => ANSWERED_IN_007.includes(id));
  if (answered.length && !sel.repeatAll)
    return `${answered.join(", ")}: ${ANSWERED_NOTE} (pass --repeat for the repeat sitting, or --repeat-all to run an answered step again)`;
  const ids = selectedIds(sel, steps);
  if (ids.length === 0) return "the selection names no step after the gate";
  const offlineSel = ids.includes(OFFLINE_STEP);
  if (offlineSel && ids.length > 1) return `${OFFLINE_STEP} runs alone`;
  if (offlineSel && !sel.offline)
    return `${OFFLINE_STEP} runs only with --offline (no Workbench, no gate)`;
  if (!offlineSel && sel.offline) return `--offline runs ${OFFLINE_STEP} only`;
  const launches = new Set(steps.filter((s) => ids.includes(s.id)).map((s) => s.launch));
  if (launches.size > 1) return "a selection spans two launches";
  if (ids[0] !== BLOCKS[0].from && !sel.runDir)
    return `a selection that starts at ${ids[0]} resumes a run folder: pass --run-dir <the sitting's run folder>`;
  const worst = invocationWorstCaseMs(ids, steps);
  if (worst > BACKGROUND_CAP_MS)
    return `the selection's worst case (${worst} ms) is above the caller's ${BACKGROUND_CAP_MS} ms background limit`;
  return null;
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  const by = (r: RiskClass): number => steps.filter((s) => s.risk === r).length;
  return {
    $comment:
      "Generated by `scripts/live/s-e-train1b.ts --emit-queue` from its step table; tests/live-harness/s-e-train1b.test.ts keeps this file equal to the table. Validated by scripts/live/preflight.ts validateQueue (step 7), per launch.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: "docs/v2/sessions/queues/S-E.md",
    plan_refs: [
      "PLAN 8 Phase 2 table, S-E",
      "PLAN 5.1",
      "PLAN 5.3",
      "PLAN 5.4",
      "PLAN 5.7",
      "PLAN 7",
      "PLAN Appendix A",
    ],
    order_note: ORDER_NOTE,
    risk_classes: RISK_DEFINITIONS,
    counts: {
      steps: steps.length,
      by_risk: {
        "read-only": by("read-only"),
        reversible: by("reversible"),
        mutating: by("mutating"),
      },
      detached_calls:
        "OpenResource, containerWriteTest, pluginRunDialogFree, ReloadScripts, createSandboxWorlds, saveContainer, layerCreateThrowaway",
    },
    rulings_pending: RULINGS_PENDING,
    rulings_given: RULINGS_GIVEN,
    rulings_applied: {
      main_session:
        "Q2, Q4, Q5, Q6, Q9, Q10 as recommended in S-E-open-questions.md; Q7 done (fdc4139)",
      review:
        "3d0aa89: no ParticleEditor module name; createSandboxWorlds guarded to _throwaway with tinyExistedBefore/terrainExistedBefore; H2 save:false on every terrain write; M2 file writes detached; M3 a 'not the sandbox's container' refusal is inconclusive; M4 SetOpenedResource false is 'no handle or wrong path form'",
    },
    timeout_note:
      "timeout_ms is an ESTIMATE of each step's worst case, not a bound; worst_case_total_ms is their sum. One block per invocation (invocation_blocks); each adds the gate (none for the offline step) and a margin and runs as a background command with a timeout above it (DEC-032).",
    worst_case_total_ms: worstCaseTotalMs(steps),
    invocation_blocks: BLOCKS.map((b) => ({
      from: b.from,
      until: b.until,
      worst_case_ms: invocationWorstCaseMs(
        selectedIds({ from: b.from, until: b.until }, steps),
        steps,
      ),
    })),
    repeat_sitting: {
      flag: "--repeat",
      why: "DEC-044: se-08 failed in session 007 (the world createSandboxWorlds made was not registered, GetWorldPath empty), so U19, U13 and U17 (se-09 to se-11) did not run; 9eed30b registers each .ent",
      steps: [steps[0].id, ...REPEAT_STEPS],
      launch:
        "one launch: the gate, se-03, se-08 to se-11, then the close test se-24 ends that same launch",
      not_run: ANSWERED_IN_007,
      not_run_note: `${ANSWERED_NOTE}; a real run refuses them unless --repeat-all is given`,
      gates_kept:
        "se-12 to se-15 keep their Q1 gate; se-30 and se-31 keep their Q3 gate; se-23 (U17 persistence) needs a second launch and is not in the repeat",
      requires:
        "the same flags as any real run (--really, --id, --registry-export, --force-settings, the lease held) and the owner's go in chat",
      worst_case_ms: invocationWorstCaseMs(
        selectedIds({ from: null, until: null, repeat: true }, steps),
        steps,
      ),
    },
    probes: steps.map((s) => ({
      id: s.id,
      launch: s.launch,
      title: s.title,
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
      answers: s.answers,
      ...(s.touches ? { touches: s.touches } : {}),
      ...(s.skipWhen ? { skipped_when: s.skipWhen.condition } : {}),
      ...(s.waitsOn ? { waits_on: s.waitsOn } : {}),
      ...(s.restore ? { restore: s.restore } : {}),
      ...(ANSWERED_IN_007.includes(s.id) ? { repeat: ANSWERED_NOTE } : {}),
    })),
    inputs: {
      tiny_world: TINY_WORLD,
      terrain_world_copy: `${TERRAIN_DIR}/ (Q1 held: absent)`,
      u16_sources: U16_SOURCES,
      u11_plants: U11_PLANTS.map((p) => ({
        rel: `${U11_DIR}/${p.name}`,
        source: p.source,
        edit: p.edit,
      })),
      u25_plants: U25_PLANTS.map((p) => ({
        rel: `${U25_DIR}/${p.name}`,
        source: p.source,
        meta: p.meta,
        role: p.role,
      })),
      u14_plant: `${U14_FOLDER_REL}/${U14_FILE}`,
      u15_host: `${THROWAWAY}/addons/${HOST_ADDON}/ (Q3; not authored)`,
    },
    not_answered: notAnswered(steps),
  };
}

// ── Action plan and outline ──────────────────────────────────────────────────

export function planInput(o: {
  sandboxDir: string | null;
  policy: CensusPolicy;
  nonce: string;
  terrainWorld?: string | null;
  u15Launch3?: boolean;
}): PlanInput {
  return {
    sandbox: o.sandboxDir ?? "<sandbox>",
    nonce: o.nonce,
    diag: diagEntryOf(o.policy),
    plugin: pluginEntryOf(o.policy),
    terrainWorld: o.terrainWorld ?? null,
    u15Launch3: o.u15Launch3 ?? false,
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
    const cond = s.waitsOn ? ` [waits on ${s.waitsOn}]` : s.skipWhen ? " [conditional]" : "";
    lines.push(`${s.id} (launch ${s.launch}, ${s.risk})${cond}: ${s.title}`);
    for (const a of s.plan(p)) {
      const t = typeof a.target === "string" ? a.target : JSON.stringify(a.target);
      lines.push(
        `    ${a.kind} ${t}${a.params ? ` ${JSON.stringify(a.params)}` : ""}${a.detached ? " (detached)" : ""}`,
      );
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
  return `${reason}. Not answered in S-E: ${lost.map((n) => n.id).join(", ")} (carried to ${s.skipWhen?.carried_to ?? lost[0].carried_to})`;
}

/** Run the selected steps against `deps`. Never retries after a timeout; never answers a dialog. */
export async function runSession(
  opts: SeOptions,
  deps: SeDeps,
  steps: StepDef[] = buildSteps(),
): Promise<SessionReport> {
  const state: SeState = {
    wbPid: null,
    startedPids: new Set(),
    baselineWindows: [],
    yesToAll: false,
    mainHwnd: null,
    logScan: null,
    throwawayConfirmed: null,
  };
  const calls: CallRecord[] = [];
  let inFlight = false;
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
  const guard = (spec: CallSpec): void => {
    const why = sendRefusal(
      ctx.step,
      spec.apiFunc,
      spec.params,
      opts.policy,
      state.throwawayConfirmed,
    );
    if (why) throw new Error(`refused: ${why}`);
  };
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
  const authHandoff = (
    step: string,
    auth: WindowInfo,
    wins: WindowInfo[],
    child?: { pid: number; resultName: string },
  ): never => {
    deps.writeArtifact(`auth-${step}.json`, authRecord(step, auth, wins, child));
    const next = nextStep(steps, step);
    throw new StopSession(
      "handoff",
      `"${AUTH_TITLE}" is up (class ${auth.className}, hwnd ${auth.hwnd}, ${auth.owner === 0 ? "unowned" : `owned by ${auth.owner}`}); auth-${step}.json written; nothing was clicked or keyed. ` +
        `Main session: read it with the passive walker (tools/uia/walk.ts --pid ${state.wbPid} --class ${auth.className} --title-pattern "${AUTH_TITLE}"${auth.owner !== 0 ? " --allow-owned" : ""} --label auth-${step} --out <run>/auth-${step}-walk.json --id ${opts.laneId} --really) and quote it. ` +
        `Owner: click the ruled button by hand (Yes) and say which. Then resume with --only ${next ?? "<next step>"} --run-dir ${opts.runDir} --owner-clicked <Yes|YesToAll|No|NoToAll>; ${step} is not run again`,
    );
  };

  const ctx: SeContext = {
    opts,
    deps,
    state,
    calls,
    step: steps[0].id,
    async call(spec) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      guard(spec);
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
        const wins = await ctx.ourWindows();
        const auth = authWindow(wins, state.wbPid);
        if (auth) authHandoff(ctx.step, auth, wins);
        throw new StopSession(
          "timeout",
          `${spec.apiFunc} timed out after ${spec.timeoutMs} ms (not retried)`,
        );
      }
      if (!r.ok && /^connection refused/.test(r.error ?? ""))
        throw new StopSession("kill", `${spec.apiFunc}: ${r.error}; Workbench is not listening`);
      return r;
    },
    async detached(spec, label, o = {}) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      guard(spec);
      deps.heartbeat();
      inFlight = true;
      const startedAt = deps.now();
      const resultName = `child-${label}-${opts.nonce}.json`;
      const samples: Array<Record<string, unknown>> = [];
      try {
        if (deps.readRunFile(resultName) !== null)
          throw new Error(`${resultName} already exists in the run folder; use a new --nonce`);
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
            inFlight = false;
            await ctx.modalCheck(`${spec.apiFunc} (detached)`, o.expected);
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
          samples.push({
            t: deps.now() - startedAt,
            windows: wins.map((w) => ({
              className: w.className,
              title: w.title,
              enabled: w.enabled,
              owner: w.owner,
            })),
          });
          const auth = authWindow(wins, state.wbPid);
          if (auth) {
            deps.writeArtifact(`poll-${label}.json`, samples);
            authHandoff(ctx.step, auth, wins, { pid: childPid, resultName });
          }
          const ch = windowChanges(state.baselineWindows, wins, state.wbPid!);
          const mainDisabled =
            state.mainHwnd !== null && wins.some((w) => w.hwnd === state.mainHwnd && !w.enabled);
          const bad = ch.added.filter(
            (w) =>
              !acceptedWindow(w, o.expected, opts.ownedModuleClasses ?? []) &&
              (isDialogLike(w) || (w.owner === 0 && mainDisabled)),
          );
          if (ch.disabled.length || bad.length) {
            deps.writeArtifact(`poll-${label}.json`, samples);
            const what = [...ch.disabled, ...bad]
              .map((w) => `${w.className} "${w.title}"${w.enabled ? "" : " disabled"}`)
              .join(" | ");
            if (o.onDialog === "handoff") {
              deps.writeArtifact(`dialog-${ctx.step}.json`, {
                step: ctx.step,
                windows: wins,
                childPid,
                resultName,
              });
              throw new StopSession(
                "handoff",
                `${spec.apiFunc} (detached child pid ${childPid}): ${what} appeared: a dialog is up (Q6). Owner: close it by hand (never Save), then resume with --only ${nextStep(steps, ctx.step) ?? "<next step>"} --run-dir ${opts.runDir}; the step is not run again and its plant is settled by the rollback subcommand`,
              );
            }
            throw new StopSession(
              "kill",
              `${spec.apiFunc} (detached child pid ${childPid}): ${what} appeared during the call: a modal is up and the queue is blocked; nothing is clicked, no NET call follows, the child is left running`,
            );
          }
        }
      } finally {
        inFlight = false;
      }
    },
    async ourWindows() {
      let all: WindowInfo[];
      try {
        all = await deps.listWindows();
      } catch (e) {
        throw new StopSession(
          "kill",
          `the window list failed (${e instanceof Error ? e.message : String(e)}): whether a dialog is up is unknown; nothing more is sent`,
        );
      }
      return all.filter((w) => w.pid === state.wbPid);
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
          `after ${label}: ${list([...ch.disabled, ...dialogs])}: a modal or a prompt is up; nothing is clicked`,
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
      if (problem)
        throw new StopSession(
          "kill",
          `${label}: refusing the window baseline, a modal or a dialog is already up (${problem}); nothing is clicked`,
        );
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
  const selected = opts.repeat
    ? steps.filter((s, i) => i > 0 && (REPEAT_STEPS as readonly string[]).includes(s.id))
    : steps.filter((s, i) => i > 0 && i >= fromIdx && i <= untilIdx);
  if (selected.some((s) => s.id === OFFLINE_STEP) !== opts.offline)
    return refuse(
      opts.offline
        ? `--offline runs ${OFFLINE_STEP} only`
        : `${OFFLINE_STEP} runs only with --offline`,
    );
  const runFiles = deps.listRunFiles();
  const dangling = runFiles.filter(
    (f) => /\.started$/.test(f) && !runFiles.includes(f.replace(/\.started$/, ".json")),
  );
  if (dangling.length) {
    const id = dangling[0].replace(/\.started$/, "");
    return refuse(
      `${id} has a started marker and no result in this run folder: the script ended during that step. A harness error: heartbeat the lane; recover if a Workbench runs; the rollback subcommand; git -C <sandbox> status --short; stop and ask the owner. No step runs until acknowledge --step ${id} is recorded`,
    );
  }
  const again = selected.find(
    (s) => runFiles.includes(`${s.id}.json`) || runFiles.includes(`${s.id}.started.acknowledged`),
  );
  if (again)
    return refuse(
      `${again.id} already has a result in this run folder (or an acknowledged marker): a step is never run twice, and a stopped step is never retried (plan 5.3)`,
    );
  for (const f of runFiles) {
    const m = /^(child-.+\.json)\.request\.json$/.exec(f);
    if (!m || runFiles.includes(m[1])) continue;
    const pidText = deps.readRunFile(`${m[1]}.pid.json`);
    if (pidText === null)
      return refuse(
        `the detached call ${m[1]} has no result and no recorded child pid: it may still hold a NET socket; check by hand, then stop and ask the owner`,
      );
    const child = JSON.parse(pidText) as { pid: number; created: number | null };
    if (deps.processImage(child.pid) === null) continue;
    const nowCreated = await deps.processCreated(child.pid);
    if (child.created === null || nowCreated === null || nowCreated === child.created)
      return refuse(
        `the detached call ${m[1]} has no result and its child pid ${child.pid} still runs: its call is still waiting (a dialog not yet closed by the owner?); wait for the owner, or stop and ask`,
      );
  }
  const entries = authLogEntries(deps.readRunFile(AUTH_LOG));
  const pending = steps
    .map((s) => s.id)
    .filter((id) => runFiles.includes(`auth-${id}.json`) && !entries.some((e) => e.step === id));
  const clicked =
    opts.ownerClicked === null || opts.ownerClicked === undefined
      ? []
      : typeof opts.ownerClicked === "string"
        ? [opts.ownerClicked]
        : [...opts.ownerClicked];
  if (pending.length && !clicked.length)
    return refuse(
      `${pending[0]} stopped on "${AUTH_TITLE}" and the owner's button is not recorded: pass --owner-clicked <Yes|YesToAll|No|NoToAll> (the button the owner reports)`,
    );
  if (clicked.length) {
    if (!pending.length)
      return refuse(
        "--owner-clicked was given but no authorization handoff waits for the owner's button",
      );
    const id = pending[0];
    const auth = runJson<{ resultName?: string }>(deps, `auth-${id}.json`);
    const late = auth?.resultName ? runJson<RawCallResult>(deps, auth.resultName) : null;
    deps.appendRunLine(
      AUTH_LOG,
      JSON.stringify({
        step: id,
        button: clicked[0],
        buttons: clicked,
        prompts: 1,
        recorded_at: new Date(deps.now()).toISOString(),
        late_answer: late ? summarizeCall(late) : null,
        late_answer_file: auth?.resultName ?? null,
      }),
    );
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
    const artifact = deps.writeArtifact(`${s.id}.json`, {
      session: SESSION,
      step: s.id,
      launch: s.launch,
      risk: s.risk,
      answers: s.answers,
      status,
      summary,
      data,
      calls: calls.slice(mark).map((c) => ({
        apiFunc: c.apiFunc,
        params: c.params,
        timeoutMs: c.timeoutMs,
        note: c.note,
        ...summarizeCall(c.result),
        timedOut: c.result.timedOut,
      })),
    });
    const ev = deps.writeEvidence(
      `${SESSION} ${s.id} ${status}: ${summary}. Answers: ${s.answers.join(", ") || "none"}`,
      artifact,
    );
    report.steps.push({ id: s.id, status, summary, answers: s.answers, evidence: ev });
    deps.log(`[${status}] ${s.id}: ${summary}`);
  };
  const evidenceWindows = async (): Promise<unknown> => {
    try {
      return windowsForEvidence(await deps.listWindows(), state.startedPids);
    } catch (err) {
      return { windowListFailed: err instanceof Error ? err.message : String(err) };
    }
  };

  // The offline step: no Workbench may run; no gate.
  if (opts.offline) {
    let running: number[];
    try {
      running = deps.workbenchPids();
    } catch (e) {
      return refuse(
        `the Workbench processes could not be listed (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    if (running.length)
      return refuse(
        `--offline: a Workbench image runs (pid ${running.join(", ")}); ${OFFLINE_STEP} runs only with none`,
      );
  }
  // Steps whose skip needs no NET call: when every selected step skips so, no gate runs.
  const pre = new Map(selected.map((s) => [s.id, s.preSkip?.(opts, deps) ?? null]));
  const gateNeeded = !opts.offline && selected.some((s) => pre.get(s.id) === null);

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isGate = i === 0;
    if (isGate ? !gateNeeded : !selected.includes(s)) {
      report.steps.push({
        id: s.id,
        status: "not-run",
        summary: isGate ? "no gate: no selected step needs Workbench" : "outside --from/--until",
        answers: s.answers,
        evidence: null,
      });
      continue;
    }
    ctx.step = s.id;
    state.throwawayConfirmed = null;
    const mark = calls.length;
    try {
      // Read again at the step's turn: an earlier step of the same invocation may have made the
      // file a later step's skip looks for (the repeat runs se-03 and se-08 in one invocation).
      const preSkip = pre.get(s.id) === null ? null : (s.preSkip?.(opts, deps) ?? null);
      const skipReason = preSkip ?? s.skip?.(ctx) ?? null;
      if (skipReason !== null) {
        finish(s, "skipped", skippedSummary(s, skipReason, steps), {}, mark);
        continue;
      }
      if (!isGate) {
        const pid = state.wbPid;
        deps.writeArtifact(`${s.id}.started`, {
          step: s.id,
          started_at: new Date(deps.now()).toISOString(),
          pid,
          created: pid === null ? null : await deps.processCreated(pid),
        } satisfies StartedMarker);
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
      if (isGate && state.logScan) data.logScan = state.logScan;
      if (e.kind === "handoff") {
        const auth = runJson<Record<string, unknown>>(deps, `auth-${s.id}.json`);
        if (auth) data.authorization = auth;
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

/** The sandbox folders the run may write into: `_throwaway/` and the U14 folder. */
export function writableRoots(sandboxDir: string): string[] {
  return [join(sandboxDir, THROWAWAY), abs(sandboxDir, U14_FOLDER_REL)];
}

function listTreeOf(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > 12 || out.length > 20_000) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else out.push(relative(root, p).replace(/\\/g, "/"));
    }
  };
  if (existsSync(root)) walk(root, 0);
  return out;
}

export function realDeps(input: RealDepsInput): SeDeps {
  const roots = writableRoots(input.sandboxDir);
  const writable = (p: string): string => {
    if (!roots.some((r) => insideDir(r, p)))
      throw new Error(`refusing a write outside <sandbox>/${THROWAWAY}/ and the U14 folder: ${p}`);
    return p;
  };
  const inSandbox = (p: string): string => {
    if (!insideDir(input.sandboxDir, p) && resolve(p) !== resolve(input.sandboxDir))
      throw new Error(`refusing file access outside the sandbox: ${p}`);
    return p;
  };
  return {
    net: (apiFunc, params, timeoutMs) =>
      rawNetCall(apiFunc, params, { port: input.port, timeoutMs }),
    listWindows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    capture: async (label) => {
      const r = await captureDesktop({
        label: `S-E-${label}`,
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
    workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((p) => p.pid),
    listRunFiles: () => (existsSync(input.runDir) ? readdirSync(input.runDir) : []),
    listDir: (p) => (existsSync(inSandbox(p)) ? readdirSync(p) : []),
    listTree: (p) => listTreeOf(inSandbox(p)),
    portOwners: () => portListeners(defaultExec, input.port),
    crashReporters: () => processesByImage(defaultExec, CRASH_REPORTER_IMAGE).map((p) => p.pid),
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
    readBytes: (p) => readFileSync(inSandbox(p)),
    writeFile: (p, data) => {
      mkdirSync(dirname(writable(p)), { recursive: true });
      writeFileSync(p, data, { flag: "wx" });
    },
    moveFile: (from, to) => {
      if (
        !insideDir(join(input.sandboxDir, THROWAWAY), from) ||
        !insideDir(join(input.sandboxDir, THROWAWAY), to)
      )
        throw new Error(`refusing a move outside <sandbox>/${THROWAWAY}/`);
      if (existsSync(to)) throw new Error(`refusing to overwrite ${to}`);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    },
    removeFile: (p) => rmSync(writable(p)),
    removeEmptyDir: (p) => {
      writable(join(p, "x"));
      if (existsSync(p) && readdirSync(p).length === 0) rmdirSync(p);
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
      child.on("error", () => {});
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
    appendRunLine: (name, line) => {
      mkdirSync(input.runDir, { recursive: true });
      appendFileSync(join(input.runDir, name), line + "\n", "utf-8");
    },
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
    writeGracefulExit: (pid, how) => {
      const file = join(input.runDir, "graceful-exit.json");
      writeGracefulExit(file, { lane: input.lane.session, pid, closedAt: new Date(), how });
      return file;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (line) => console.log(toPlaceholders(line, input.placeholders)),
  };
}

// ── plant and rollback (no Workbench running) ────────────────────────────────

export interface OfflineIo {
  workbenchPids: () => number[];
  fileExists: (p: string) => boolean;
  readBytes: (p: string) => Buffer;
  writeFile: (p: string, data: Buffer) => void;
  removeFile: (p: string) => void;
  removeEmptyDir: (p: string) => void;
  listTree: (p: string) => string[];
  /** Remove `<sandbox>/_throwaway/` and everything in it (the rollback after the last launch). */
  removeThrowaway: (p: string) => void;
  readRunFile: (name: string) => string | null;
  writeRunFile: (name: string, data: string) => void;
  log: (line: string) => void;
}

/**
 * `plant`: before launch 1, with no Workbench running, write the u25 and u11 plants under
 * `<sandbox>/_throwaway/SE/` and their records (`plant-se-u25.json`, `plant-se-u11.json`,
 * `plant-offline.json` with whether `_throwaway/` existed). A dry run unless `gate` is null.
 */
export function runPlant(
  cfg: {
    sandboxDir: string;
    gate: string | null;
    really: boolean;
    plants: () => { u25: Plant[]; u11: Plant[] };
  },
  io: OfflineIo,
): number {
  let built: { u25: Plant[]; u11: Plant[] };
  try {
    built = cfg.plants();
  } catch (e) {
    io.log(
      `refused: the plants could not be built (${e instanceof Error ? e.message : String(e)})`,
    );
    return 1;
  }
  const all = [...built.u25, ...built.u11];
  for (const p of all)
    io.log(`${cfg.gate ? "would plant" : "planting"} ${p.rel} (${p.data.length} bytes; ${p.edit})`);
  if (cfg.gate) {
    io.log(cfg.gate);
    return cfg.really ? 1 : 0;
  }
  if (io.workbenchPids().length) {
    io.log(
      "refused: a Workbench image runs; the plants are written before launch 1 with none running",
    );
    return 1;
  }
  const se = abs(cfg.sandboxDir, SE_ROOT);
  if (io.fileExists(se)) {
    io.log(
      `refused: <sandbox>/${SE_ROOT}/ exists already (not this sitting's); remove it with the owner first`,
    );
    return 1;
  }
  const throwawayExisted = io.fileExists(join(cfg.sandboxDir, THROWAWAY));
  io.writeRunFile(
    "plant-offline.json",
    JSON.stringify({ throwawayExistedBefore: throwawayExisted, at: new Date().toISOString() }) +
      "\n",
  );
  io.writeRunFile("plant-se-u25.json", JSON.stringify(built.u25.map(recordOf), null, 2) + "\n");
  io.writeRunFile("plant-se-u11.json", JSON.stringify(built.u11.map(recordOf), null, 2) + "\n");
  for (const p of all) io.writeFile(abs(cfg.sandboxDir, p.rel), p.data);
  io.log(`planted ${all.length} files under <sandbox>/${SE_ROOT}/`);
  return 0;
}

/**
 * `rollback`: with no Workbench running, (1) remove an open se-16 plant (the U14 file, by its hash,
 * and its folder when empty); (2) with `removeThrowaway`, keep the `_throwaway/` listing with hashes
 * in the run folder (`throwaway-listing.json`) and remove `_throwaway/` whole, only when
 * `plant-offline.json` says it was absent before the sitting.
 */
export function runRollback(
  cfg: {
    runDir: string;
    sandboxDir: string;
    gate: string | null;
    really: boolean;
    removeThrowaway: boolean;
  },
  io: OfflineIo,
): number {
  const u14Open =
    io.readRunFile("plant-se-16.json") !== null && io.readRunFile("rollback-se-16.json") === null;
  const offline = (() => {
    try {
      return JSON.parse(io.readRunFile("plant-offline.json") ?? "null") as {
        throwawayExistedBefore?: boolean;
      } | null;
    } catch {
      return null;
    }
  })();
  if (!u14Open && !cfg.removeThrowaway) {
    io.log("nothing to roll back: no open se-16 plant, and --remove-throwaway not given");
    return 0;
  }
  if (cfg.gate) {
    if (u14Open) io.log("would remove the se-16 plant by its hash");
    if (cfg.removeThrowaway) {
      // The same rule the real path applies: _throwaway/ is removed whole only when
      // plant-offline.json shows it absent before the sitting.
      if (offline?.throwawayExistedBefore !== false) {
        io.log(
          `would refuse: plant-offline.json does not show ${THROWAWAY}/ absent before the sitting; it would not be removed whole`,
        );
        io.log(cfg.gate);
        return 1;
      }
      io.log(`would keep the ${THROWAWAY}/ listing and remove ${THROWAWAY}/ whole`);
    }
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
  if (running.length) {
    io.log(`refused: Workbench is running (pid ${running.join(", ")}); end it first`);
    return 1;
  }
  let ok = true;
  if (u14Open) {
    const plant = JSON.parse(io.readRunFile("plant-se-16.json")!) as {
      rel: string;
      sha256: string;
    };
    const file = abs(cfg.sandboxDir, `${U14_FOLDER_REL}/${U14_FILE}`);
    if (plant.rel !== `${U14_FOLDER_REL}/${U14_FILE}`) {
      io.log(`plant-se-16.json names ${plant.rel}, not this script's file; nothing removed`);
      ok = false;
    } else {
      if (io.fileExists(file)) {
        if (sha256Hex(io.readBytes(file)) === plant.sha256) io.removeFile(file);
        else {
          io.log(`${U14_FILE} changed since the plant; left for the owner`);
          ok = false;
        }
      }
      const folder = abs(cfg.sandboxDir, U14_FOLDER_REL);
      if (ok && io.fileExists(folder)) io.removeEmptyDir(folder);
      if (ok && !io.fileExists(folder)) {
        io.writeRunFile("rollback-se-16.json", JSON.stringify({ ok: true, by: "rollback" }) + "\n");
        io.log(`se-16: the broken file and ${U14_FOLDER_REL} removed`);
      } else if (ok) {
        io.log(`${U14_FOLDER_REL} still holds files not this run's: remove them with the owner`);
        ok = false;
      }
    }
  }
  if (cfg.removeThrowaway) {
    const dir = join(cfg.sandboxDir, THROWAWAY);
    if (offline?.throwawayExistedBefore !== false) {
      io.log(
        `refused: plant-offline.json does not show ${THROWAWAY}/ absent before the sitting; it is not removed whole`,
      );
      return 1;
    }
    const listing = io
      .listTree(dir)
      .map((rel) => ({ rel, sha256: sha256Hex(io.readBytes(join(dir, ...rel.split("/")))) }));
    io.writeRunFile("throwaway-listing.json", JSON.stringify(listing, null, 2) + "\n");
    io.removeThrowaway(dir);
    io.log(`${THROWAWAY}/ listed (${listing.length} files, throwaway-listing.json) and removed`);
  }
  return ok ? 0 : 1;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface MainOverrides {
  platform?: NodeJS.Platform;
  deps?: (input: RealDepsInput) => SeDeps;
  policy?: CensusPolicy;
  out?: (line: string) => void;
  exists?: (path: string) => boolean;
  artifactsRoot?: string;
  recoverDeps?: Partial<RecoverDeps>;
  offlineIo?: Partial<OfflineIo>;
  plants?: () => { u25: Plant[]; u11: Plant[] };
}

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "sandbox",
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

/** The vanilla reader of the real `plant`: the game paks through src/pak/vfs.ts (read-only). */
async function pakReader(): Promise<(vpath: string) => Buffer> {
  const { PakVirtualFS } = await import("../../src/pak/vfs.js");
  const vfs = PakVirtualFS.get(loadConfig().gamePath);
  if (!vfs) throw new Error("the game paks could not be opened (ENFUSION_GAME_PATH)");
  return (p) => vfs.readFile(p);
}

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
  if (!["run", "recover", "rollback", "acknowledge", "plant"].includes(cmd)) {
    err(
      "Usage: s-e-train1b.ts [run] [options] | plant | recover | rollback | acknowledge (see the header)",
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
    const rec = {
      ...defaultRecoverDeps(say),
      ...over.recoverDeps,
      ...(over.platform ? { platform } : {}),
    };
    if (cmd === "recover") {
      let ownerGo: number | null = null;
      if (o["owner-go"] !== undefined) {
        ownerGo = Number(o["owner-go"]);
        if (!Number.isInteger(ownerGo) || ownerGo <= 0) {
          err("--owner-go takes the pid the owner's word names");
          return EXIT.usage;
        }
      }
      return runRecover({ lane, really, runDir, artifactsRoot, ph }, rec, {
        ownerGo,
        next: "the rollback subcommand (se-16's plant; --remove-throwaway after the last launch), then git -C <sandbox> status --short; a stopped step is never retried",
      });
    }
    if (cmd === "acknowledge") {
      if (!o.step || !steps.some((s) => s.id === o.step)) {
        err("acknowledge needs --step <step id>");
        return EXIT.usage;
      }
      return acknowledgeMarker({ lane, really, runDir, artifactsRoot, ph }, rec, {
        step: o.step,
        ownerAck: args.flags.has("owner-ack"),
        resultFile: join(runDir, `${o.step}.json`),
        would: "no Workbench image runs and no se-16 plant is open",
        extraRefusal: () =>
          o.step === "se-16-u14-reload-broken" &&
          existsSync(join(runDir, "plant-se-16.json")) &&
          !existsSync(join(runDir, "rollback-se-16.json"))
            ? "the se-16 plant has no rollback record; run the rollback subcommand first"
            : null,
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
    const outside = outsideArtifacts(runDir, artifactsRoot);
    if (outside) {
      err(`refused: ${outside}`);
      return EXIT.refused;
    }
    const io: OfflineIo = {
      workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid),
      fileExists: (p) => existsSync(p),
      readBytes: (p) => readFileSync(p),
      writeFile: (p, d) => {
        if (!insideDir(join(sandboxDir, THROWAWAY), p))
          throw new Error(`refusing ${p}: only <sandbox>/${THROWAWAY}/`);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, d, { flag: "wx" });
      },
      removeFile: (p) => {
        if (!writableRoots(sandboxDir).some((r) => insideDir(r, p)))
          throw new Error(`refusing ${p}`);
        rmSync(p);
      },
      removeEmptyDir: (p) => {
        if (resolve(p) !== resolve(abs(sandboxDir, U14_FOLDER_REL)))
          throw new Error(`refusing ${p}`);
        if (readdirSync(p).length === 0) rmdirSync(p);
      },
      listTree: (p) => listTreeOf(p),
      removeThrowaway: (p) => {
        if (
          resolve(p) !== resolve(join(sandboxDir, THROWAWAY)) ||
          basename(dirname(resolve(p))) !== SANDBOX_NAME
        )
          throw new Error(`refusing to remove ${p}`);
        if (statSync(p).isDirectory()) rmSync(p, { recursive: true });
      },
      readRunFile: (n) =>
        existsSync(join(runDir, n)) ? readFileSync(join(runDir, n), "utf-8") : null,
      writeRunFile: (n, t) => {
        mkdirSync(runDir, { recursive: true });
        writeFileSync(join(runDir, n), t, { flag: "wx" });
      },
      log: (l) => say(toPlaceholders(l, ph)),
      ...over.offlineIo,
    };
    if (cmd === "plant") {
      let reader: ((vpath: string) => Buffer) | null = null;
      if (!over.plants) {
        try {
          reader = await pakReader();
        } catch (e) {
          err(`configuration: ${e instanceof Error ? e.message : String(e)}`);
          return EXIT.usage;
        }
      }
      const guid = (): string => randomBytes(8).toString("hex").toUpperCase();
      return runPlant(
        { sandboxDir, gate, really, plants: over.plants ?? (() => buildPlants(reader!, guid)) },
        io,
      );
    }
    return runRollback(
      { runDir, sandboxDir, gate, really, removeThrowaway: args.flags.has("remove-throwaway") },
      io,
    );
  }

  if (o["emit-queue"]) {
    mkdirSync(dirname(o["emit-queue"]), { recursive: true });
    writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
    say(`queue written: ${toPlaceholders(o["emit-queue"], ph)}`);
    return EXIT.done;
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
  const u15Launch3 = args.flags.has("u15-launch3");
  if (u15Launch3 && !args.flags.has("owner-go-u15-launch3")) {
    err(
      "refused: --u15-launch3 needs --owner-go-u15-launch3 (Q3 is the owner's ruling, given in chat)",
    );
    if (really) stopped("refused: launch 3 without the owner's go");
    return EXIT.usage;
  }
  let ownerClicked: AuthButton[] | null = null;
  if (o["owner-clicked"] !== undefined) {
    const list = o["owner-clicked"].split(",").map((x) => x.trim());
    if (!list.length || !list.every((b) => (AUTH_BUTTONS as readonly string[]).includes(b))) {
      err(`--owner-clicked takes one of ${AUTH_BUTTONS.join(", ")}, or several comma-separated`);
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
  const offline = args.flags.has("offline");
  const repeat = args.flags.has("repeat");
  const repeatAll = args.flags.has("repeat-all");
  if (repeat && (o.only || o.from || o.until)) {
    err("--repeat excludes --only, --from and --until");
    return EXIT.usage;
  }

  if (!really) {
    const sandbox = o.sandbox ?? null;
    const p = planInput({ sandboxDir: sandbox, policy, nonce, u15Launch3 });
    const selecting = Boolean(o.only || o.from || o.until || repeat);
    const ids = selectedIds(
      { from: o.from ?? null, until: o.until ?? null, only: o.only ?? null, repeat },
      steps,
    );
    const planSteps = selecting ? steps.filter((s, i) => i === 0 || ids.includes(s.id)) : steps;
    const plan = buildActionPlan(p, planSteps);
    ph = defaultPlaceholderContext(sandbox ? { sandbox, v2: REPO_ROOT } : { v2: REPO_ROOT });
    say(
      `S-E session outline [dry run] (${steps.length} steps; diag list ${p.diag ? p.diag.key : "empty (se-04 skips, Q8)"}; plugin list ${p.plugin ? p.plugin.className : "empty (se-15 skips, Q8)"}; terrain copy: decided at run time (Q1 held: se-12 to se-15 skip); launch 3 ${u15Launch3 ? "on" : "off (Q3)"}; worst case ${Math.round(worstCaseTotalMs(steps) / 60_000)} min, an estimate)`,
    );
    if (selecting) {
      const refusal = selectionRefusal(
        {
          from: o.from ?? null,
          until: o.until ?? null,
          only: o.only ?? null,
          runDir: o["run-dir"] !== undefined,
          offline,
          repeat,
          repeatAll,
        },
        steps,
      );
      say(
        refusal
          ? `the real run would refuse this selection: ${refusal}`
          : `this invocation: ${ids.join(", ")}; worst case (an estimate) ${invocationWorstCaseMs(ids, steps)} ms`,
      );
    }
    for (const l of sessionOutline(p, planSteps)) say(toPlaceholders(l, ph));
    say(
      "invocations, one block each (worst case an estimate; run each in the background with a timeout above it):",
    );
    for (const b of BLOCKS)
      say(
        `    ${blockArgs(b)}${b.from === OFFLINE_STEP ? " --offline" : ""}: ${invocationWorstCaseMs(selectedIds({ from: b.from, until: b.until }, steps), steps)} ms${selectedIds({ from: b.from, until: b.until }, steps).some((id) => ANSWERED_IN_007.includes(id)) ? " (holds a step " + ANSWERED_NOTE + ": needs --repeat-all)" : ""}`,
      );
    say(
      `    --repeat (the repeat sitting, one launch: ${REPEAT_STEPS.join(", ")}): ${invocationWorstCaseMs(selectedIds({ from: null, until: null, repeat: true }, steps), steps)} ms`,
    );
    const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
    say(
      toPlaceholders(
        `action plan: ${plan.length} actions; dry-run check: ${formatResult(check)}`,
        ph,
      ),
    );
    // Create-only: the dry run never overwrites a file the caller points at.
    if (o.out)
      writeFileSync(o.out, toPlaceholders(JSON.stringify(plan, null, 2), ph) + "\n", {
        encoding: "utf-8",
        flag: "wx",
      });
    if (o.outline)
      writeFileSync(o.outline, toPlaceholders(sessionOutline(p, planSteps).join("\n"), ph) + "\n", {
        encoding: "utf-8",
        flag: "wx",
      });
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
      offline,
      repeat,
      repeatAll,
    },
    steps,
  );
  if (selRefusal) {
    err(`refused: ${selRefusal}`);
    stopped(`refused: ${selRefusal}`);
    return EXIT.usage;
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
    say(toPlaceholders(reason, ph));
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
    !offline &&
    (leaseProject === null ||
      resolve(dirname(leaseProject)).toLowerCase() !== sandboxDir.toLowerCase())
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
  const ids = selectedIds(
    { from: o.from ?? null, until: o.until ?? null, only: o.only ?? null, repeat },
    steps,
  );
  const launch3 = steps.some((s) => s.launch === 3 && ids.includes(s.id));
  const addons = (o["allowed-addons"] ?? "ArmaReforger")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const opts: SeOptions = {
    sandboxDir,
    gproj,
    from: o.from ?? null,
    until: o.until ?? null,
    only: o.only ?? null,
    openedProjectPattern: o["opened-project-pattern"] ?? OPENED_PROJECT_PATTERN,
    allowedAddons: launch3 && u15Launch3 ? [...addons, HOST_ADDON] : addons,
    nonce,
    runDir,
    laneId: lane.id,
    policy,
    registryExport: o["registry-export"],
    debugModeUnsetOk: args.flags.has("debug-mode-unset-ok"),
    forceSettings,
    offline,
    u15Launch3,
    repeat,
    ownerClicked,
    ownedModuleClasses: (o["owned-module-classes"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  deps.log(
    `S-E real run, lane ${lane.session}, run folder ${runDir}, nonce ${nonce}; steps ${ids.join(", ")}; worst case (an estimate) ${invocationWorstCaseMs(ids, steps)} ms`,
  );
  // The repeat sitting has no plant step, but `rollback --remove-throwaway` removes `_throwaway/`
  // whole only when `plant-offline.json` shows it absent before the sitting: record that here,
  // once, before the first step of a repeat run (never overwriting a plant's own record).
  if (repeat && !existsSync(join(runDir, "plant-offline.json"))) {
    mkdirSync(runDir, { recursive: true });
    const throwawayExisted = existsSync(join(sandboxDir, THROWAWAY));
    writeFileSync(
      join(runDir, "plant-offline.json"),
      JSON.stringify({
        throwawayExistedBefore: throwawayExisted,
        at: new Date().toISOString(),
        by: "repeat",
      }) + "\n",
      { encoding: "utf-8", flag: "wx" },
    );
    deps.log(
      `repeat: plant-offline.json written (${THROWAWAY}/ existed before: ${throwawayExisted})`,
    );
  }
  lane.startHeartbeat(60_000);
  try {
    const report = await runSession(opts, deps, steps);
    deps.writeArtifact(`summary-${nonce}.json`, report);
    if (report.stop)
      deps.log(`STOPPED at ${report.stop.step} (${report.stop.kind}): ${report.stop.reason}`);
    else deps.log(`S-E block done: ${ids[0]} to ${ids[ids.length - 1]}`);
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

/** sha256 of a text (exported for the tests' plant checks). */
export const shaOf = (t: string): string => createHash("sha256").update(t).digest("hex");

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
