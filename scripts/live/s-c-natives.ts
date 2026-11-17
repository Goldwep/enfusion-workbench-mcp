/**
 * Session S-C (plan 8 Phase 2 table): a GUI Workbench with only the SHIPPED
 * handler set installed in the 2.0 sandbox, raw TCP for the native NET
 * functions, no new handler code. The largest sitting: 49 recon probes and the
 * register unknowns P-U2, P-U3, P-U4, P-U7, P-U13, P-U19, P-U26 (read half),
 * P-U29 and P-U30 (docs/v2/sessions/probe-schedule.md, data/census/probes.jsonl).
 *
 * DRY RUN BY DEFAULT. Without --really the script touches nothing: it prints
 * the session outline and the ACTION PLAN (the JSON array
 * `scripts/live/dry-run.ts` checks), checks the plan against the policy, and
 * writes the plan to --out. A real run needs --really, a win32 host and the
 * lease already held by the lane given with --id (the one gate of `cli.ts`).
 * It is run only by the main session, with the owner present, after the
 * owner's go for S-C, AFTER `preflight.ts` (default variant) has launched the
 * sandbox and asserted it. The runbook is docs/v2/sessions/queues/S-C.md; the
 * queue is docs/v2/sessions/queues/S-C-queue.json (`--emit-queue` rewrites it
 * from the step table below, and a test keeps the two equal).
 *
 * Steps, in queue order (risk classes read-only, then reversible, then
 * mutating; plan 5.3 step 7). The plan fixes the S-C order; two deviations,
 * both forced by that risk order, are stated in the queue's `order_note`:
 * BringModuleWindowToFront, OpenResource and OpenXOB open module windows, so
 * they run in the reversible block just before U29 (whose graceful close ends
 * the process and its windows) instead of with the read-only natives, which
 * also keeps U7's Resource Manager window free of editors a probe opened; the
 * clean U3 call is classed reversible (its own effect is a read) because it
 * follows the world edits of U19 and U13. The World Editor walk (sc-11b) is
 * classed reversible for the same reason: it follows the opening of the world.
 *
 * The action plan carries the launches (sc-09, sc-10) as `launch` actions and
 * the walks (sc-06, sc-11b) as `uia-read` actions, written before the launch
 * with the pid "lane-recorded" and the window chosen at run time by its title;
 * walk.ts checks the same read again with the real pid, class and title.
 *
 *   sc-00-gate               Script Debug Mode off in the pre-flight registry
 *                            export; the recorded Workbench pid is ours and
 *                            listens; scripts compiled; GetLoadedProjects names
 *                            the sandbox (and the session log, E13's pattern);
 *                            no modal or dialog in the window baseline
 *   sc-01-natives-read       IsWorkbenchRunning, IsWorldEditorRunning (raw wire)
 *   sc-02-bi-<Handler>       the 15 Bohemia handlers whose source shows no write,
 *                            no dialog, and no unguarded dereference on the
 *                            inputs given here (BI_INCLUDED; the other 19 of E04's
 *                            34 are classified in BI_REVERSIBLE and BI_EXCLUDED)
 *   sc-03-u30-burst          U30: the ONE planned exception to "one call at a
 *                            time": two heavy and five cheap calls at once
 *   sc-04-u2-evaluate        U2: one EvaluateScript call with a trivial snippet
 *   sc-05-u7-before          no world open; the Resource Manager window chosen by
 *                            title; NET latency and GUI stall before the walk
 *   sc-06-u7-walk            the accessibility walker (tools/uia/walk.ts, not
 *                            this file's) by the command line given with
 *                            --walker-cmd; without it the run hands off
 *   sc-07-u7-after           the same measurements after the walk
 *   sc-07b-u7-later          and again five minutes later (does the cost last)
 *   sc-08-natives-gui       BringModuleWindowToFront and OpenResource
 *   sc-08b-bi-OpenXOB        Bohemia's OpenXOB (opens a model)
 *   sc-09-u29-cold           U29 cold start: graceful close, then -gproj
 *                            <sandbox> -uri=<vanilla Resource Manager link to a
 *                            config no earlier step opened>
 *   sc-10-u29-forward        U29 forwarded: a second process with the same
 *                            -gproj and a Script Editor link. Only with
 *                            --u29-forward (the owner's call): a forwarded spawn
 *                            was recorded dropping the NET session and reopening
 *                            the launcher picker on another project
 *                            (docs/TEST-RESULTS.md, 2026-09-03 wb_build_data row)
 *   sc-11-open-tiny-world    OpenResource on the tiny world (OA-3)
 *   sc-11b-u7-walk-world     the walker on the World Editor window with the tiny
 *                            world open (walker.md step G; world-editor-L484),
 *                            only after a clean sc-06 walk; then one Ping
 *   sc-12-u19-undo           U19: create, undo, check (shipped handlers)
 *   sc-13-u13-component      U13: one component property write (propertyPath
 *                            "components[i]") on an entity this step creates
 *   sc-14-u3-clean           U3: ValidateScripts, detached, poll loop
 *   sc-15-u3-planted         U3 with a syntax error planted in a COPY of a
 *                            handler outside the installed handler folder
 *   sc-16-u4-reload          U4 LAST: one handler string edited, ReloadScripts
 *                            detached with a long timeout, re-ping, restore
 *
 * Without the tiny world (OA-3 not done) sc-11 to sc-13 are skipped and U13
 * and U19 move to S-E (plan Phase 0 item 7). Without `["Edit","Undo"]` on
 * `execute_action.allow_list` sc-12 is skipped: the shipped undo action runs
 * WorldEditor.ExecuteAction(Edit, Undo), and plan 5.3 allows ExecuteAction only
 * on allow-listed paths (DEC-029 put the entry there for U19 in S-C). No walk
 * runs while a NET call is in flight: gui-census-feasibility-L699 is a Phase 4
 * census probe (DEC-029); U30 is the one planned exception to "one call at a
 * time".
 *
 * Plan 5.3 "During", to the letter: one call at a time (U30 excepted, in its own
 * step); on ANY timeout no retry: capture the desktop (capture.ts), list the
 * top-level windows (EnumWindows: class, title, owner, pid), write both, and
 * stop for the main session with the lease kept. After every call that can
 * open a window, a Workbench window that turned disabled, or a new owned or
 * dialog-class window, stops the run before the next NET call; a window
 * baseline that already holds one is refused. The opened project is
 * asserted after every launch (U29) and the run aborts, closing that
 * Workbench, when it is not the sandbox. No key is ever pressed: nothing here
 * sends a keystroke, Enter or an accelerator. The window messages sent are
 * the post-flight's CloseMainWindow (U29, and the abort path) and WM_NULL
 * through SendMessageTimeout (the U7 GUI-stall sample). Nothing is ever
 * terminated by the session run: a process that will not close stops the run for the main
 * session, whose recorded recovery is the separate `recover` subcommand. Probes that can block
 * (ValidateScripts, ReloadScripts) run as a
 * detached child of this script with an explicit long timeout and a poll loop
 * that lists the Workbench windows. Each step writes one result file to the
 * run folder in the artifacts folder and one evidence record through the
 * evidence writer, both with placeholders, naming the probe ids it answers.
 *
 * Every operation that touches a process, a socket, the desktop or the file
 * system outside the artifacts folder goes through `SessionDeps`, so the
 * whole control flow runs against mocks in tests/live-harness/s-c-natives.test.ts.
 *
 * Usage:
 *   npx --no tsx scripts/live/s-c-natives.ts [--out <plan.json>] [--outline <file>]
 *       [--sandbox <dir>] [--tiny-world <path under the sandbox>] [--u29-forward]
 *       [--emit-queue <file>] [--force-settings <scratch.ini>]
 *   npx --no tsx scripts/live/s-c-natives.ts --really --id <lane id> --tiny-world <rel>
 *       --registry-export <pre-flight .reg> --force-settings <scratch.ini under the artifacts folder>
 *       [--debug-mode-unset-ok] [--u29-forward]
 *       [--sandbox <dir>] [--walker-cmd '<json argv>']
 *       (--from <step id> --until <step id> | --only <step id>)   one declared block or step
 *       [--run-dir <dir>] [--opened-project-pattern <regex>] [--allowed-addons a,b]
 *       [--owned-module-classes a,b] [--world-title-unchecked]
 *       [--build <tag>] [--port 5775] [--lease-path p] [--marker-path p]
 *   npx --no tsx scripts/live/s-c-natives.ts recover --run-dir <dir> --id <lane id>
 *       [--owner-go <pid>] [--really]
 *   npx --no tsx scripts/live/s-c-natives.ts rollback --run-dir <dir> --id <lane id>
 *       [--sandbox <dir>] [--really]
 *   npx --no tsx scripts/live/s-c-natives.ts acknowledge --run-dir <dir> --id <lane id>
 *       --step <step id> [--owner-ack] [--really]
 *
 * Since the pre-sitting read (DEC-032): a real run is ONE declared block (`BLOCKS`) or one step
 * per invocation, run in the background with a timeout above `invocationWorstCaseMs` (an
 * estimate); the gate runs first in each. `<run>/<step>.started` is written before a step's first
 * side effect, with the Workbench pid and its creation time; a marker with no result, a selected
 * step that already has a result, or a detached child with no result that still runs refuses the
 * invocation before any NET call. The U3 plant and the U4 edit are recorded before they are made
 * (`plant-sc-15.json`, `plant-sc-16.json`), and `rollback` undoes them when a run was cut off.
 * `recover` and `acknowledge` are the shared ones of `session-common.ts`. The last line of a real
 * invocation is `S-C block done: ...` or starts `STOPPED`.
 * Exit: 0 done (or dry run passed), 1 refused or plan check failed, 2 usage,
 *       3 stopped for the main session, 4 aborted (not the sandbox), 5 handoff
 *       (run the walker, then resume with --from sc-07-u7-after --run-dir <dir>,
 *       or after sc-11b with --from sc-12-u19-undo).
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config.js";
import { LAUNCHER_WINDOW_TITLE } from "../../src/workbench/launcher-nudge.js";
import { decodePascalString, encodeRequest } from "../../src/workbench/protocol.js";
import { OPENED_PROJECT_PATTERN } from "../census/enumerators/e13-launch-logs.js";
import { captureDesktop } from "./capture.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { DEFAULT_BOUNDS as WALK_DEFAULT_BOUNDS } from "../../tools/uia/walk.js";
import { LANE_RECORDED_PID, checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import { rewriteStrings, writeEvidence } from "./evidence.js";
import { Lane } from "./lane.js";
import {
  BUNDLED_HANDLER_DIR,
  HANDLER_FOLDER,
  U3_PLANT_FOLDER,
  WORKBENCH_EXE,
  buildLaunch,
  defaultSandboxGproj,
  formatCommandLine,
  spawnWorkbench,
  type LaunchPlan,
} from "./launch.js";
import { normalizeLabel } from "./mock/uia.js";
import { DEFAULT_PORT, HARNESS_CLIENT_ID } from "./netcall.js";
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
import {
  ASSERT_WAIT_MS,
  newestSessionLog,
  openedProjectFromLog,
  recordedBuild,
} from "./preflight.js";
import { lastLine, runPowerShell } from "./powershell.js";
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

export const SESSION = "S-C";
/** The scratch ini a dry run without --force-settings names (as s-b-scratch-profile.ts's plan does). */
export const SCRATCH_INI_PLACEHOLDER = `<artifacts>\\sessions\\${SESSION}\\<stamp>\\scratch.ini`;

/** Repo-relative id of this script, as dry-run exceptions name scripts. */
export const SCRIPT_PATH = "scripts/live/s-c-natives.ts";

const SCRIPT_ABS = fileURLToPath(import.meta.url);

/** `node --import <this>` runs a .ts file (node_modules/.bin/tsx cannot be spawned without a shell on Windows). */
const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/** The walker command line the runbook documents for --walker-cmd (placeholders filled at run time). */
export const DOCUMENTED_WALKER_CMD = [
  "{node}",
  "--import",
  "{tsx}",
  "tools/uia/walk.ts",
  "--pid",
  "{pid}",
  "--class",
  "{class}",
  "--title-pattern",
  "{title}",
  "--label",
  "{label}",
  "--out",
  "{out}",
  "--id",
  "<lane id>",
  "--really",
];

/** The queue file this script's step table produces (`--emit-queue`). */
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-C-queue.json");

export const EXIT = {
  done: 0,
  refused: 1,
  usage: 2,
  stopped: 3,
  aborted: 4,
  handoff: 5,
} as const;

/**
 * Vanilla resources the probes read. Every path and GUID was read from the
 * game paks of build 1.8.0.13 while this file was written (read-only,
 * src/pak/vfs.ts): the GUIDs are the ones other vanilla prefabs reference.
 */
export const VANILLA = {
  /** Base character prefab; declares SCR_CharacterStaminaComponent with StaminaDrainRun -0.008. */
  characterGuid: "37578B1666981FCE",
  characterPath: "Prefabs/Characters/Core/Character_Base.et",
  characterRef: "{37578B1666981FCE}Prefabs/Characters/Core/Character_Base.et",
  /** A 119-byte static prop prefab (GenericEntity); it sets nothing itself, its base does. */
  propGuid: "3F23DA7ACAC0ED90",
  propPath: "Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et",
  propRef: "{3F23DA7ACAC0ED90}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et",
  /**
   * The prop's parent (438 bytes): sets its components locally (MeshObject,
   * RigidBody, SCR_DestructionMultiPhaseComponent) and has no child entity.
   */
  propBasePath: "Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01_base.et",
  propBaseRef: "{D1B29F6467927156}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01_base.et",
  textureRef:
    "{F3FCC3B9732551D9}UI/Textures/Editor/EditableEntities/Characters/EditableEntity_Character_Medic.edds",
  /** A packed world: GetResourceInfo on .ent (mcp-inventory-L349); never opened. */
  packedWorld: "worlds/MainMenuWorld/MainMenuWorld.ent",
  emat: "system/materials/lightSourceDefault.emat",
  xob: "system/wbdata/CompassGizmo/NESW.xob",
  conf: "configs/inputCommon.conf",
  /** A 24-byte config no step before U29 opens: the U29 cold link's target. */
  coldConf: "Configs/Core/ChatPanelManagerCore.conf",
  layout: "UI/layouts/Camera/ManualCameraCrosshair.layout",
  script: "scripts/WorkbenchGameCommon/NetApiDocs.c",
} as const;

/**
 * U29 links: vanilla, read-only targets; neither names a project or a world.
 * The cold link names a config sc-08 never opens, so a window for it after the
 * relaunch is the link's doing, not Workbench reopening its last resource.
 */
export const U29_COLD_LINK = `enfusion://ResourceManager/~ArmaReforger:${VANILLA.coldConf}`;
export const U29_FORWARD_LINK = `enfusion://ScriptEditor/${VANILLA.script};56`;

/** The handler string U4 edits in the INSTALLED copy of EMCP_WB_Ping.c. */
export const PING_FILE = "EMCP_WB_Ping.c";
export const PING_MARKER_TEXT = "EnfusionMCP Workbench bridge active";

/**
 * U3: the planted copy lives outside the installed handler folder. The folder name is launch.ts's,
 * so the installer and every pre-flight refuse while it is in the sandbox (DEC-032).
 */
export { U3_PLANT_FOLDER };
export const U3_PLANT_FILE = "ECEN_SC_U3_Planted.c";

/** U13 defaults: the component and key are in Character_Base.et as read from the pak. */
export interface U13Knobs {
  prefab: string;
  component: string;
  key: string;
  value: string;
}

export const U13_DEFAULTS: U13Knobs = {
  prefab: VANILLA.characterRef,
  component: "SCR_CharacterStaminaComponent",
  key: "StaminaDrainRun",
  value: "-0.009",
};

/** The ExecuteAction path the shipped undo action runs (EMCP_WB_EditorControl.c). */
export const UNDO_PATH = ["Edit", "Undo"] as const;

export const TIMEOUTS = {
  cheap: 10_000,
  bohemia: 30_000,
  heavy: 300_000,
  gui: 60_000,
  openWorld: 120_000,
  evaluate: 30_000,
  burstFloor: 120_000,
  validate: 600_000,
  reload: 900_000,
  detachedGrace: 30_000,
  ready: 300_000,
  /** Pre-flight step 9's wait for the opened-project line, shared (DEC-032, S-C read m5). */
  sessionLog: ASSERT_WAIT_MS,
  close: 120_000,
  forwardExit: 60_000,
  walker: 600_000,
  poll: 5_000,
  /** SendMessageTimeout per WM_NULL sample, plus the 200 ms pause between samples. */
  stallSample: 5_200,
  /** Gap between the starts of two burst calls. */
  burstStagger: 50,
} as const;

/**
 * The helpers' own timeouts, which each step's `timeout_ms` counts since DEC-032 (S-C read m2):
 * one window list (the PowerShell runner's 30 s), a GUI-stall run (30 s plus 6 s a sample), a
 * tasklist or netstat (20 s), a process-table read (30 s). A detached call's poll can overrun
 * its deadline by one iteration: a window list, a one-sample stall and the 5 s sleep.
 */
export const HELPER = {
  windows: 30_000,
  stallBase: 30_000,
  stallPerSample: 6_000,
  process: 20_000,
  table: 30_000,
} as const;

/** One GUI-stall run of `samples` WM_NULL round trips, as its PowerShell runner allows it. */
export function stallMs(samples: number): number {
  return HELPER.stallBase + samples * HELPER.stallPerSample;
}

/** What one detached call can take: its timeout, the grace, one poll overrun, the modal check. */
export function detachedBudgetMs(timeoutMs: number): number {
  return (
    timeoutMs +
    TIMEOUTS.detachedGrace +
    HELPER.windows +
    stallMs(1) +
    TIMEOUTS.poll +
    HELPER.windows
  );
}

/**
 * What every invocation adds to its steps: the started marker's process-table read per step is
 * in each step; this is the pre-checks (run files, detached children), the stop path (a capture,
 * the window list, the CrashReporter list) and margin. An ESTIMATE, not a bound (DEC-032).
 */
export const INVOCATION_MARGIN_MS = 180_000;

/**
 * The declared blocks the runbook runs, one per invocation (DEC-032, S-C read B1). A real run
 * selects one of these (`--from X --until Y`) or a single step (`--only X`); the gate runs first
 * in every invocation. Only the first block may start a new run folder.
 */
export const BLOCKS: ReadonlyArray<{ from: string; until: string }> = [
  { from: "sc-01-natives-read", until: "sc-02-bi-GetGameMaterials" },
  { from: "sc-03-u30-burst", until: "sc-03-u30-burst" },
  { from: "sc-04-u2-evaluate", until: "sc-05-u7-before" },
  { from: "sc-06-u7-walk", until: "sc-06-u7-walk" },
  { from: "sc-07-u7-after", until: "sc-07b-u7-later" },
  { from: "sc-08-natives-gui", until: "sc-08b-bi-OpenXOB" },
  { from: "sc-09-u29-cold", until: "sc-09-u29-cold" },
  { from: "sc-10-u29-forward", until: "sc-10-u29-forward" },
  { from: "sc-11-open-tiny-world", until: "sc-11b-u7-walk-world" },
  { from: "sc-12-u19-undo", until: "sc-13-u13-component" },
  { from: "sc-14-u3-clean", until: "sc-14-u3-clean" },
  { from: "sc-15-u3-planted", until: "sc-15-u3-planted" },
  { from: "sc-16-u4-reload", until: "sc-16-u4-reload" },
];

/** Where the U29 forwarded case was recorded going wrong (cited in sc-10 and the runbook). */
export const FORWARD_HAZARD_REF =
  "docs/TEST-RESULTS.md, 'Closing the pending live items (2026-09-03, later)', H9/H11 wb_build_data row";

/** sc-07b re-measures this long after sc-07 (walker.md step F). */
export const U7_LATER_MS = 300_000;

/** Above this many entities the "tiny" world is not the fixture OA-3 describes. */
export const TINY_WORLD_MAX_ENTITIES = 500;

// ── Probe ids ────────────────────────────────────────────────────────────────

const E = (s: string): string => `P-E01-${s}`;

/** Every probe this sitting carries (probes.jsonl, folded, scheduled_session holds S-C). */
export const SC_PROBES = {
  u2: [
    "P-U2",
    E("anim-procanim-behavior-L410"),
    E("anim-procanim-behavior-L481"),
    E("gui-census-feasibility-L683"),
    E("mcp-inventory-L265"),
    E("mcp-inventory-L377"),
    E("plugins-netapi-cli-L457"),
    E("resource-manager-L680"),
    E("script-string-dialogue-L409"),
    E("world-editor-L474"),
  ],
  u3: [
    "P-U3",
    E("plugins-netapi-cli-L458"),
    E("resource-manager-L681"),
    E("script-string-dialogue-L407"),
  ],
  u4: [
    "P-U4",
    E("mcp-inventory-L264"),
    E("mcp-inventory-L379"),
    E("mcp-inventory-L385"),
    E("mcp-inventory-L359"),
    E("script-string-dialogue-L406"),
    E("script-string-dialogue-L408"),
    E("world-editor-L475"),
  ],
  u7: [
    "P-U7",
    E("gui-census-feasibility-L661"),
    E("gui-census-feasibility-L662"),
    E("gui-census-feasibility-L663"),
    E("gui-census-feasibility-L667"),
    E("mcp-inventory-L268"),
    E("mcp-inventory-L380"),
    E("script-string-dialogue-L421"),
    E("world-editor-L484"),
  ],
  u13: [
    "P-U13",
    E("mcp-inventory-L271"),
    E("mcp-inventory-L347"),
    E("mcp-inventory-L348"),
    E("world-editor-L478"),
  ],
  u19: ["P-U19", E("world-editor-L477")],
  u26: [
    "P-U26",
    E("mcp-inventory-L272"),
    E("mcp-inventory-L381"),
    E("mcp-inventory-L349"),
    E("resource-manager-L683"),
  ],
  u29: ["P-U29", E("plugins-netapi-cli-L465"), E("world-editor-L490")],
  u30: [
    "P-U30",
    E("mcp-inventory-L270"),
    E("mcp-inventory-L382"),
    E("mcp-inventory-L346"),
    E("mcp-inventory-L356"),
  ],
  natives: [
    E("gui-census-feasibility-L684"),
    E("mcp-inventory-L263"),
    E("mcp-inventory-L378"),
    E("plugins-netapi-cli-L459"),
    E("script-string-dialogue-L410"),
  ],
  display: [E("gui-census-feasibility-L698")],
} as const;

/**
 * DEC-019's owed live checks, opened as probes by DEC-029: the slash style and
 * the GetPrefabGUID path forms scheduled to S-C, the TextureValidator check to
 * S-E (it needs a loose texture with its meta, and the handler dereferences a
 * missing meta).
 */
export const DEC019_CHECKS = {
  textureValidator: "P-DEC019-TextureValidator-path-and-empty-reports",
  slashStyle: "P-DEC019-LocateProject-LocatePrefabsFromPath-slash-style",
  prefabGuidForms: "P-DEC019-GetPrefabGUID-path-forms",
} as const;

export interface NotAnswered {
  id: string;
  part: "all" | "part";
  /** For part: what this sitting does answer, and in which steps. */
  answered_by?: string[];
  missing: string;
  reason: string;
  carried_to: string;
  /**
   * Set when the probe is answered unless a step is skipped at run time (the
   * reason names the condition); the step's skipped result names it again.
   */
  condition?: string;
}

/** Probes, or parts of probes, this sitting cannot answer (also in the runbook). */
export const NOT_ANSWERED: readonly NotAnswered[] = [
  {
    id: E("mcp-inventory-L348"),
    part: "all",
    missing: "whether enum-valued properties accept the name, the integer or neither",
    reason: "U13 in S-C is one write on one float key with the existing handler",
    carried_to: "S-E (mutating probe pack, ModifyComponentKey and edit sequences)",
  },
  {
    id: E("script-string-dialogue-L406"),
    part: "all",
    missing:
      "whether Plugins > Settings > Reload WB Scripts works through ExecuteAction, and on which module",
    reason:
      "an ExecuteAction path that is not on execute_action.allow_list (empty today); the shipped EMCP_WB_Reload guesses menu labels and is never called",
    carried_to: "S-D (U9 rules on allow-listed paths) or the Phase 4 L09 battery",
  },
  {
    id: E("mcp-inventory-L268"),
    part: "part",
    answered_by: ["sc-05-u7-before", "sc-06-u7-walk", "sc-07-u7-after"],
    missing: "the World Editor property grid and the Options dialog",
    reason: "no world is open during the S-C walk and no dialog is opened",
    carried_to: "P4-census",
  },
  {
    id: E("script-string-dialogue-L421"),
    part: "part",
    answered_by: ["sc-06-u7-walk"],
    missing: "the Script Editor docks and the Qt Introspection Tool",
    reason: "the S-C walk covers the Resource Manager window only",
    carried_to: "S-F (U31) and P4-census",
  },
  {
    id: E("mcp-inventory-L271"),
    part: "part",
    answered_by: ["sc-13-u13-component"],
    missing: "ModifyComponentKey, edit sequences, enum values",
    reason: "S-C runs the existing propertyPath form only",
    carried_to: "S-E",
  },
  {
    id: E("world-editor-L478"),
    part: "part",
    answered_by: ["sc-13-u13-component"],
    missing:
      "the key m_fStaminaDrainMultiplier of the 1.8 retest: Character_Base.et holds no such key; S-C writes StaminaDrainRun",
    reason: "only keys present in the vanilla prefab are written",
    carried_to: "S-E if the retest key is still wanted",
  },
  {
    id: E("world-editor-L477"),
    part: "part",
    answered_by: ["sc-12-u19-undo"],
    missing: "whether the history name appears in the undo history panel",
    reason: "reading the history panel needs the accessibility tree of the World Editor",
    carried_to: "P4-census",
  },
  {
    id: E("plugins-netapi-cli-L457"),
    part: "part",
    answered_by: ["sc-04-u2-evaluate"],
    missing: "module context, size limit and FileIO authorisation, if EvaluateScript answers",
    reason: "U2 is one trivial snippet (plan 7); follow-ups run through the eval channel",
    carried_to: "S-D",
  },
  {
    id: E("resource-manager-L680"),
    part: "part",
    answered_by: ["sc-04-u2-evaluate"],
    missing: "module context, prompt and -scriptAuthorizeAll, if EvaluateScript answers",
    reason: "one trivial snippet only; -scriptAuthorizeAll is development-only (Appendix B)",
    carried_to: "S-D",
  },
  {
    id: E("world-editor-L474"),
    part: "part",
    answered_by: ["sc-04-u2-evaluate"],
    missing: "module context, return types, size limit, compile-error health, setting gate",
    reason: "one trivial snippet only",
    carried_to: "S-D",
  },
  {
    id: E("mcp-inventory-L377"),
    part: "part",
    answered_by: ["sc-04-u2-evaluate"],
    missing: "other installed builds",
    reason: "only build 1.8.0.13 is installed and probed",
    carried_to: "the next Tools build (re-run sc-04)",
  },
  {
    id: E("plugins-netapi-cli-L465"),
    part: "part",
    answered_by: ["sc-09-u29-cold", "sc-10-u29-forward"],
    missing: "the World Editor camera form of the link, and -link, -wbrun, -noOpenLastResource",
    reason:
      "U29 runs before the tiny world is open (plan order) and uses Resource Manager and Script Editor links; the other switches are not U29",
    carried_to: "P3-cli",
  },
  {
    id: E("world-editor-L490"),
    part: "part",
    answered_by: ["sc-10-u29-forward"],
    missing:
      "whether the protocol is registered on this machine; camera move without a world reload",
    reason:
      "this script never reads the registry and never opens a link through the shell (the registered template carries its own -gproj); no world is open during U29",
    carried_to: "main session (read-only reg query, owner's call) and P3-cli",
  },
  {
    id: E("mcp-inventory-L272"),
    part: "part",
    answered_by: [
      "sc-02-bi-CheckGUID",
      "sc-02-bi-GetGameMaterials",
      "sc-02-bi-GetPrefabChildInfo",
      "sc-02-bi-GetPathToAssetsFromGuids",
    ],
    missing:
      "ExportTerrain and RegisterResource (they write); LayerPresets and GetLayerInteraction (an unguarded walk of the project settings the sandbox .gproj does not hold)",
    reason:
      "U26's read half only, and only handlers that cannot raise a VM exception on S-C's inputs",
    carried_to: "P3-bi",
  },
  {
    id: E("mcp-inventory-L381"),
    part: "part",
    answered_by: ["sc-02-bi-*", "sc-08b-bi-OpenXOB"],
    missing: "the handlers BI_EXCLUDED lists",
    reason:
      "they write, open a modal, touch the clipboard, need Blender state, have unbounded cost, or dereference a value that is null or unverified on the inputs S-C can give",
    carried_to: "P3-bi or S-E (each entry of bohemia_handlers.excluded names its own)",
  },
  {
    id: E("resource-manager-L683"),
    part: "part",
    answered_by: ["sc-02-bi-GetResourceInfo"],
    missing: "the exact response size limit, and the expanded base character",
    reason:
      "S-C expands only the small prop's parent; an expanded character recurses through every referenced resource and could hold the queue past its timeout, which would end the sitting before U30, U2, U7, U29, U19, U13, U3 and U4",
    carried_to: "P3-bi (size sweep)",
  },
  {
    id: E("mcp-inventory-L356"),
    part: "part",
    answered_by: ["sc-03-u30-burst", "sc-02-bi-LocatePrefabsFromPath"],
    missing: "stall on very large worlds",
    reason: "DEC-026 R3: the S-C half is the queue behaviour; the verdict needs a large world",
    carried_to: "P4-census",
  },
  {
    id: E("mcp-inventory-L378"),
    part: "part",
    answered_by: ["sc-01-natives-read", "sc-08-natives-gui", "sc-14-u3-clean", "sc-16-u4-reload"],
    missing: "the LSP server",
    reason: "LSP on 5776 is U20",
    carried_to: "S-F",
  },
  {
    id: E("plugins-netapi-cli-L459"),
    part: "part",
    answered_by: ["sc-08-natives-gui"],
    missing: "OpenResource on .agr, .acp, .ptc, .bt",
    reason:
      "those open the Animation, Audio, Particle and Behavior editors, whose documents can mark themselves changed and turn the U29 close into a save prompt",
    carried_to: "S-D (moduleMatrix opens those modules)",
  },
  {
    id: E("mcp-inventory-L359"),
    part: "part",
    answered_by: ["sc-16-u4-reload"],
    missing: "the wb_reload menu paths",
    reason: "ExecuteAction paths not on the allow-list",
    carried_to: "S-D / P4-census",
  },
  {
    id: E("mcp-inventory-L385"),
    part: "part",
    answered_by: ["sc-16-u4-reload"],
    missing: "the dual-registration drift",
    reason: "a client configuration fact, not a Workbench behaviour",
    carried_to: "main session (configuration check, no Workbench)",
  },
  {
    id: E("resource-manager-L681"),
    part: "part",
    answered_by: ["sc-14-u3-clean", "sc-15-u3-planted", "sc-16-u4-reload"],
    missing: "whether the NET queue is blocked while ValidateScripts or ReloadScripts compiles",
    reason:
      "answering needs a second NET call while one is in flight; S-C allows that only in U30. The GUI stall is sampled instead",
    carried_to: "P3-kernel (queue design), with U30's result",
  },
  {
    id: DEC019_CHECKS.textureValidator,
    part: "all",
    missing: "TextureValidator's path forms and empty reports",
    reason:
      "TextureValidator dereferences GetMetaFile's result without a null check (ValidateMaterialPlugin.c TextureImportSettings), so any path without a meta raises a VM exception (and the VME dialog under Script Debug Mode); the sandbox holds no texture and vanilla textures are packed with no .meta",
    carried_to: "S-E (a throwaway loose texture with its meta gives a valid absolute path)",
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskClass = "read-only" | "reversible" | "mutating";

export interface WindowInfo {
  hwnd: number;
  pid: number;
  className: string;
  title: string;
  owner: number;
  enabled: boolean;
  rect: number[];
  monitor: number[];
  primary: boolean;
}

export interface RawCallResult {
  ok: boolean;
  response?: unknown;
  error?: string;
  timedOut: boolean;
  durationMs: number;
  bytesSent: number;
  bytesReceived: number;
  /** The wire shape of the answer: status string, and whether a payload string followed. */
  wire?: { status: string | null; payload: "absent" | "empty" | "present" };
}

export interface CallRecord {
  apiFunc: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  startedAt: number;
  result: RawCallResult;
  note?: string;
}

export interface CallSpec {
  apiFunc: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  note?: string;
}

export type StopKind = "timeout" | "kill" | "abort" | "handoff" | "refused";

/** Thrown by a step to end the run; the engine handles each kind (no retry anywhere). */
export class StopSession extends Error {
  /**
   * For an abort: the Workbench pid to close (default: the current one);
   * null when the offending process is already closed.
   */
  closePid?: number | null;

  constructor(
    readonly kind: StopKind,
    message: string,
    closePid?: number | null,
  ) {
    super(message);
    this.name = "StopSession";
    if (closePid !== undefined) this.closePid = closePid;
  }
}

export type StepStatus = "pass" | "fail" | "observed" | "skipped" | "not-run";

export interface StepOutcome {
  status: StepStatus;
  summary: string;
  data?: Record<string, unknown>;
}

export interface DetachedSpec {
  apiFunc: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  /** File name in the run folder the child writes its result to. */
  resultName: string;
}

export interface WalkerResult {
  exitCode: number | null;
  timedOut: boolean;
  lastLine: string | null;
}

/** Everything that would touch a process, a socket, the desktop or a file outside the artifacts folder. */
export interface SessionDeps {
  net(apiFunc: string, params: Record<string, unknown>, timeoutMs: number): Promise<RawCallResult>;
  /** Visible top-level windows (EnumWindows); every pid. */
  listWindows(): Promise<WindowInfo[]>;
  capture(label: string): Promise<{ ok: boolean; path: string; detail: string }>;
  /** WM_NULL round trips to the pid's main window, in ms (null when it did not answer). */
  guiStall(pid: number, samples: number): Promise<Array<number | null>>;
  /** Image name of a pid, or null when it is not running. */
  processImage(pid: number): string | null;
  /** A process's creation time from the process table (epoch ms), or null (DEC-032). */
  processCreated(pid: number): Promise<number | null>;
  /** File names in the run folder (started markers, results, child requests). */
  listRunFiles(): string[];
  /** Entry names of a sandbox folder (empty when it does not exist). */
  listDir(path: string): string[];
  /** Pids listening on the NET port. */
  portOwners(): number[];
  crashReporters(): number[];
  /** CloseMainWindow (WM_CLOSE) on pid and wait; never a kill. */
  closeGracefully(pid: number, timeoutMs: number): Promise<{ exited: boolean; detail: string }>;
  /** Spawn Workbench with the sandbox launch form plus `extraArgs`; recorded in the lease. */
  launchRecorded(extraArgs: string[]): number;
  /** Spawn a second Workbench process (the U29 forward); not recorded in the lease. */
  launchUnrecorded(extraArgs: string[]): number;
  /** The Workbench pid this lane's lease records. */
  recordedPid(): number | null;
  heartbeat(): void;
  /** Newest session log created after `after` (ms since epoch), or null. */
  sessionLogAfter(after: number | null): string | null;
  readText(path: string): string;
  /** A `reg export` file as text lines (UTF-16LE or UTF-8); a file read, no registry access. */
  readRegLines(path: string): string[];
  fileExists(path: string): boolean;
  readBytes(path: string): Buffer;
  writeBytes(path: string, data: Buffer, exclusive: boolean): void;
  removeFile(path: string): void;
  makeDir(path: string): void;
  /** Remove a directory only when it is empty. */
  removeEmptyDir(path: string): void;
  startDetached(spec: DetachedSpec): number;
  readRunFile(name: string): string | null;
  runWalker(argv: string[], budgetMs: number): Promise<WalkerResult>;
  /** Write a JSON artifact (placeholders applied) into the run folder; returns its path. */
  writeArtifact(name: string, value: unknown): string;
  /** Write one evidence record citing `artifactPath`; returns its id. */
  writeEvidence(summary: string, artifactPath: string): string;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export interface SessionOptions {
  sandboxDir: string;
  gproj: string;
  /** Tiny world path relative to the sandbox (OA-3), or null. */
  tinyWorld: string | null;
  walkerCmd: string[] | null;
  from: string | null;
  until: string | null;
  openedProjectPattern: string;
  /** Loaded addon ids besides the sandbox that GetLoadedProjects may list. */
  allowedAddons: string[];
  nonce: string;
  runDir: string;
  laneId: string;
  policy: CensusPolicy;
  /** U13 knobs (defaults U13_DEFAULTS). */
  u13: U13Knobs;
  /** Run sc-10 (the U29 forwarded case): the owner's call, off by default. */
  u29Forward: boolean;
  /** The pre-flight `reg export` file the gate reads ScriptDebugMode from. */
  registryExport: string | null;
  /** The owner confirmed by looking that Script Debug Mode is off when the export holds no value for it. */
  debugModeUnsetOk: boolean;
  /**
   * The scratch settings file every relaunch passes as `-forceSettings` (U12, DEC-038). When given,
   * the gate reads ScriptDebugMode from its `[World%20Editor]` section instead of the export.
   */
  forceSettings?: string | null;
  /** `--only <id>`: one step after the gate (DEC-032). */
  only?: string | null;
  /**
   * Win32 classes of OWNED windows the sitting has shown to be module windows (walker.md section 7):
   * an owned window is accepted by its title only when its class is listed (DEC-032, S-C read m3).
   */
  ownedModuleClasses?: string[];
  /**
   * Run sc-12 and sc-13 although sc-11 did not see the tiny world's name in the World Editor title
   * (the main session's call once the sitting shows titles never carry it; DEC-032, m11).
   */
  worldTitleUnchecked?: boolean;
}

interface SessionState {
  wbPid: number | null;
  /** Every pid this run started (closable by this run). */
  startedPids: Set<number>;
  tinyWorldPresent: boolean;
  baselineWindows: WindowInfo[];
  heavyBaselineMs: number | null;
  u7Before: Record<string, unknown> | null;
  rmWindow: WindowInfo | null;
  /**
   * NET rollbacks owed when a step stops: after a timeout or a kill no further
   * NET call is made (plan 5.3), so the stop record names them for the main session.
   */
  pendingRollback: string[];
  /** When sc-07 measured, for sc-07b's wait. */
  u7AfterAt: number | null;
  /** Why U7 is not run in this sitting (a world was open at sc-05), or null. */
  u7Skip: string | null;
}

export interface RunContext {
  opts: SessionOptions;
  deps: SessionDeps;
  state: SessionState;
  calls: CallRecord[];
  call(spec: CallSpec): Promise<RawCallResult>;
  burst(specs: CallSpec[]): Promise<RawCallResult[]>;
  detached(spec: CallSpec, label: string): Promise<RawCallResult>;
  ourWindows(): Promise<WindowInfo[]>;
  /**
   * Stop when a Workbench window turned disabled, or a new owned or
   * dialog-class window appeared, since the baseline; `expected` accepts a
   * new window a step opens on purpose. Becomes the new baseline.
   */
  modalCheck(label: string, expected?: (w: WindowInfo) => boolean): Promise<WindowInfo[]>;
  /**
   * Take a new window baseline; refused (stop) when it already holds a
   * disabled window, or an owned or dialog-class one `expected` does not accept.
   */
  setBaseline(label: string, expected?: (w: WindowInfo) => boolean): Promise<WindowInfo[]>;
  /** Rewrite the running step's started marker with a pid it started (sc-09's relaunch). */
  updateMarker(pid: number): Promise<void>;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** SHA-256 of a text or bytes, hex. */
export function sha256Hex(x: string | Buffer): string {
  return createHash("sha256").update(x).digest("hex");
}

/** True when `p` resolves inside `dir` (never `dir` itself). */
export function insideDir(dir: string, p: string): boolean {
  const rel = relative(resolve(dir), resolve(p));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** The forward-slash spelling of a path (DEC-019 slash-style checks). */
export function forwardSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** The backslash spelling of a path. */
export function backSlashes(p: string): string {
  return p.replace(/\//g, "\\");
}

/** True when a captured opened-project value names the sandbox (a name or a .gproj path). */
export function namesSandbox(opened: string, gproj: string): boolean {
  const o = opened.trim();
  if (/\.gproj$/i.test(o)) {
    return (
      resolve(o).replace(/\\/g, "/").toLowerCase() ===
      resolve(gproj).replace(/\\/g, "/").toLowerCase()
    );
  }
  const stem = gproj.replace(/^.*[\\/]/, "").replace(/\.gproj$/i, "");
  return [SANDBOX_NAME, stem].some((n) => n.toLowerCase() === o.toLowerCase());
}

/** The addon ids GetLoadedProjects returned, or null when the payload is not that shape. */
export function loadedProjectsOf(response: unknown): string[] | null {
  if (!response || typeof response !== "object") return null;
  const list = (response as Record<string, unknown>)["Loaded Projects"];
  if (!Array.isArray(list)) return null;
  return list.map((x) => String(x));
}

/** Null when the loaded addons are the sandbox plus allowed ones; otherwise why not. */
export function loadedProjectsProblem(ids: string[] | null, allowed: string[]): string | null {
  if (ids === null) return 'GetLoadedProjects did not return a "Loaded Projects" list';
  const lower = ids.map((i) => i.toLowerCase());
  if (!lower.includes(SANDBOX_NAME.toLowerCase())) {
    return `the loaded addons (${ids.join(", ") || "none"}) do not include ${SANDBOX_NAME}`;
  }
  const ok = new Set([SANDBOX_NAME, ...allowed].map((a) => a.toLowerCase()));
  const foreign = ids.filter((i) => !ok.has(i.toLowerCase()));
  return foreign.length ? `unexpected loaded addon(s): ${foreign.join(", ")}` : null;
}

/** Index of the first component of class `cls` in an EMCP_WB_Components list answer, or -1. */
export function componentIndex(response: unknown, cls: string): number {
  const list = (response as { components?: Array<{ className?: string; index?: number }> })
    ?.components;
  if (!Array.isArray(list)) return -1;
  const hit = list.find((c) => c.className === cls);
  return hit && typeof hit.index === "number" ? hit.index : -1;
}

/** Field `name` of an object answer, or undefined. */
function field(response: unknown, name: string): unknown {
  return response && typeof response === "object"
    ? (response as Record<string, unknown>)[name]
    : undefined;
}

/** Declared response fields absent from the answer, and answer fields not declared. */
export function fieldDiff(
  response: unknown,
  declared: readonly string[],
): { missing: string[]; extra: string[] } {
  const keys =
    response && typeof response === "object" && !Array.isArray(response)
      ? Object.keys(response as Record<string, unknown>)
      : [];
  return {
    missing: declared.filter((d) => !keys.includes(d)),
    extra: keys.filter((k) => !declared.includes(k)),
  };
}

/** Median and maximum of a list of numbers (nulls dropped), or nulls. */
export function latencyStats(values: Array<number | null>): {
  n: number;
  unanswered: number;
  p50: number | null;
  max: number | null;
} {
  const v = values.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  return {
    n: values.length,
    unanswered: values.length - v.length,
    p50: v.length ? v[Math.floor((v.length - 1) / 2)] : null,
    max: v.length ? v[v.length - 1] : null,
  };
}

/**
 * Windows of `pid` that became disabled since `before` (a modal is up: Windows
 * disables a modal dialog's owner) and windows of `pid` that are new.
 */
export function windowChanges(
  before: readonly WindowInfo[],
  after: readonly WindowInfo[],
  pid: number,
): { disabled: WindowInfo[]; added: WindowInfo[] } {
  const was = new Map(before.filter((w) => w.pid === pid).map((w) => [w.hwnd, w]));
  const now = after.filter((w) => w.pid === pid);
  return {
    disabled: now.filter((w) => !w.enabled && was.get(w.hwnd)?.enabled === true),
    added: now.filter((w) => !was.has(w.hwnd)),
  };
}

/**
 * A window that can be a prompt: the Win32 dialog class, or any owned window
 * that is not a Qt tool window or tooltip. Qt gives a QDialog with a parent an
 * owner and the same window class as a main window, and gives floating docks
 * and tooltips a class with "QWindowTool" in it [unverified: Qt's Windows
 * class naming, from memory of qwindowscontext.cpp, not read here]. Qt is not
 * known to disable a modal's owner, so the owner test is what catches a Qt
 * modal. Over-reporting stops the sitting; under-reporting would not.
 */
export function isDialogLike(w: WindowInfo): boolean {
  if (w.className === "#32770") return true;
  if (w.owner === 0) return false;
  return !/QWindowTool/i.test(w.className);
}

/**
 * Whether a dialog-like window a step opens on purpose is accepted (DEC-032, S-C read m3): by its
 * title (`expected`) only when it is unowned, or owned and of a Win32 class the sitting has shown to
 * be a module window (`ownedClasses`, walker.md section 7). A Qt prompt is owned, carries the main
 * window's class and may be titled with the module's name [unverified]; by default it stops the run.
 */
export function acceptedWindow(
  w: WindowInfo,
  expected: ((w: WindowInfo) => boolean) | undefined,
  ownedClasses: readonly string[] = [],
): boolean {
  if (!(expected?.(w) ?? false)) return false;
  return w.owner === 0 || ownedClasses.includes(w.className);
}

/**
 * Why a window list cannot be a baseline (a disabled window, or a dialog-like
 * one not accepted by `acceptedWindow`), or null.
 */
export function baselineProblem(
  windows: readonly WindowInfo[],
  expected?: (w: WindowInfo) => boolean,
  ownedClasses: readonly string[] = [],
): string | null {
  const bad = windows.filter(
    (w) => !w.enabled || (isDialogLike(w) && !acceptedWindow(w, expected, ownedClasses)),
  );
  return bad.length
    ? bad
        .map(
          (w) =>
            `${w.className} "${w.title}"${w.enabled ? "" : " disabled"}${w.owner ? ` owned by ${w.owner}` : ""}`,
        )
        .join(" | ")
    : null;
}

/**
 * The Resource Manager window of a pid: an unowned window whose title names it.
 * The World Editor and the Resource Manager are likely windows of one process
 * with one class (walker.md), so the title, not the size, tells them apart.
 */
export function resourceManagerWindow(
  windows: readonly WindowInfo[],
  pid: number,
): WindowInfo | null {
  return (
    windows.find((w) => w.pid === pid && w.owner === 0 && /resource manager/i.test(w.title)) ?? null
  );
}

/**
 * Script Debug Mode as a `reg export` holds it: a VM exception raises the VME
 * dialog when it is on (recon gui-census-feasibility, "Dialog: Virtual Machine
 * Exception"). The value name ScriptDebugMode is the recon's [unverified].
 */
export function scriptDebugMode(lines: readonly string[]): {
  state: "off" | "on" | "absent";
  line: string | null;
} {
  const line = lines.find((l) => /^\s*"ScriptDebugMode"\s*=/i.test(l)) ?? null;
  if (line === null) return { state: "absent", line: null };
  const v = line
    .replace(/^[^=]*=\s*/, "")
    .trim()
    .toLowerCase();
  const off =
    /^dword:0+$/.test(v) ||
    v === '"false"' ||
    v === '"0"' ||
    v === "hex(b):00,00,00,00,00,00,00,00";
  return { state: off ? "off" : "on", line: line.trim() };
}

/**
 * Script Debug Mode as the scratch ini (`-forceSettings`, DEC-038) holds it: the line
 * `ScriptDebugMode=<value>` in the `[World%20Editor]` section (buildScratchIni's format, section
 * names percent-encoded). "true"/"1" is on, "false"/"0" off, any other value counts as on (the safe
 * side), no line is absent.
 */
export function iniScriptDebugMode(text: string): {
  state: "off" | "on" | "absent";
  line: string | null;
} {
  let inSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    const header = /^\[(.*)\]$/.exec(l);
    if (header) {
      inSection = header[1].trim().toLowerCase() === "world%20editor";
      continue;
    }
    if (!inSection || !/^ScriptDebugMode\s*=/i.test(l)) continue;
    const v = l
      .replace(/^[^=]*=\s*/, "")
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .toLowerCase();
    return { state: v === "false" || v === "0" ? "off" : "on", line: l };
  }
  return { state: "absent", line: null };
}

/** Why a --tiny-world value is refused (it must name a .ent inside the sandbox), or null. */
export function tinyWorldProblem(rel: string, sandboxDir: string | null): string | null {
  if (!rel.trim()) return "--tiny-world is empty";
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || /^[\\/]/.test(rel)) {
    return `--tiny-world ${rel} must be relative to the sandbox`;
  }
  if (rel.split(/[\\/]+/).includes("..")) return `--tiny-world ${rel} must not contain ".."`;
  if (!/\.ent$/i.test(rel)) return `--tiny-world ${rel} must name a .ent world file`;
  const base = sandboxDir ?? resolve("sandbox-placeholder");
  if (!insideDir(base, join(base, rel))) return `--tiny-world ${rel} is not inside the sandbox`;
  return null;
}

/**
 * Run `body`, then `restore`, always. When both fail, one stop keeps the
 * body's kind (a timeout stays a timeout) and names the failed restore too.
 */
export async function withRestore<T>(body: () => Promise<T>, restore: () => void): Promise<T> {
  let result: T;
  try {
    result = await body();
  } catch (primary) {
    try {
      restore();
    } catch (failed) {
      throw combineStops(primary, failed);
    }
    throw primary;
  }
  restore();
  return result;
}

function combineStops(primary: unknown, failed: unknown): StopSession {
  const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const p =
    primary instanceof StopSession
      ? primary
      : new StopSession("kill", `internal error: ${msg(primary)}`);
  return new StopSession(
    p.kind,
    `${p.message}; and the restore after it failed: ${msg(failed)}`,
    p.closePid,
  );
}

/**
 * True when a window's title names `target`: a resource path (its file name
 * without extension) or a module name. Used to accept the module or resource
 * window a step opens on purpose; a non-dialog class is still required.
 */
export function titleNames(w: WindowInfo, target: string): boolean {
  if (w.className === "#32770") return false;
  const words = (s: string): string =>
    s
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .toLowerCase();
  const stem = words(target.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""));
  return stem.length > 0 && ` ${words(w.title)} `.includes(` ${stem} `);
}

/** The window list as evidence: titles of processes this run does not own are withheld. */
export function windowsForEvidence(
  rows: readonly WindowInfo[],
  ours: Iterable<number>,
): WindowInfo[] {
  const set = new Set(ours);
  return rows.map((r) => (set.has(r.pid) ? r : { ...r, title: "<other process: withheld>" }));
}

/** A U29 link is accepted only in the two vanilla, project-free forms this file uses. */
export function validateU29Link(link: string): string {
  if (
    !/^enfusion:\/\/(ResourceManager\/~ArmaReforger:|ScriptEditor\/)[A-Za-z0-9_/.;:-]+$/.test(link)
  ) {
    throw new Error(
      `Refusing U29 link ${link}: only vanilla Resource Manager or Script Editor links`,
    );
  }
  return link;
}

/** The U4 edit: the Ping message gains a marker. Throws when the text is not the shipped one. */
export function editPingSource(text: string, marker: string): string {
  if (!text.includes(PING_MARKER_TEXT)) {
    throw new Error(`${PING_FILE} does not hold "${PING_MARKER_TEXT}"; not the shipped handler`);
  }
  return text.split(PING_MARKER_TEXT).join(`${PING_MARKER_TEXT} ${marker}`);
}

/**
 * The U3 planted copy: the shipped Ping handler with its classes renamed (so
 * the copy declares nothing the installed set declares) and one syntax error
 * (an unclosed parameter list) appended.
 */
export function plantedSource(pingText: string): string {
  const renamed = pingText.replace(/\bEMCP_WB_Ping/g, "ECEN_SC_U3Ping");
  // The copy may REFERENCE installed classes (Ping reads EMCP_WB_BuildStamp.VALUE since DEC-048);
  // it must DECLARE none of them, or the installed set compiles twice.
  if (/\bclass\s+EMCP_WB_/.test(renamed)) {
    throw new Error("planted copy still declares an EMCP_WB_ class");
  }
  return (
    `${renamed.replace(/\s+$/, "")}\n\n` +
    "// S-C U3: deliberate syntax error (unclosed parameter list). This file is removed by the run.\n" +
    "class ECEN_SC_U3Broken\n{\n\tvoid Broken(\n}\n"
  );
}

/**
 * Substitute {node} {tsx} {pid} {out} {class} {title} {label} in the walker
 * command line. {title} becomes a regular expression matching exactly that
 * title (walk.ts --title-pattern matches the whole title); {label} names the
 * walk (`rm-noworld` for sc-06, `we-tinyworld` for sc-11b).
 */
export function walkerArgv(
  template: readonly string[],
  values: {
    pid: number;
    out: string;
    className: string;
    title: string;
    label?: string;
    node?: string;
    tsx?: string;
  },
): string[] {
  const esc = values.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return template.map((a) =>
    a
      .replace(/\{node\}/g, values.node ?? process.execPath)
      .replace(/\{tsx\}/g, values.tsx ?? "tsx")
      .replace(/\{pid\}/g, String(values.pid))
      .replace(/\{out\}/g, values.out)
      .replace(/\{class\}/g, values.className)
      .replace(/\{title\}/g, esc)
      .replace(/\{label\}/g, values.label ?? "walk"),
  );
}

/**
 * The World Editor window of a pid for step sc-11b: the one unowned window
 * whose title names the World Editor and not the Resource Manager. Null when
 * there is none or more than one (the run then hands off; walker.md step G1).
 */
export function worldEditorWindow(windows: readonly WindowInfo[], pid: number): WindowInfo | null {
  const found = windows.filter(
    (w) =>
      w.pid === pid &&
      w.owner === 0 &&
      /world editor/i.test(w.title) &&
      !/resource manager/i.test(w.title),
  );
  return found.length === 1 ? found[0] : null;
}

/**
 * The `uia-read` action of a walk, as the S-C plan carries it before the
 * launch: the pid is the one the lane records ("lane-recorded"; walk.ts refuses
 * any other), the window is chosen at run time from the Win32 window list by
 * its title, and the bounds are the walker's defaults. walk.ts builds and
 * checks the same action again with the real pid, class and title.
 */
export function walkReadAction(step: string, probes: string[], window: string): PlanAction {
  return {
    kind: "uia-read",
    step,
    probes,
    target: {
      pid: LANE_RECORDED_PID,
      window: {
        className: `<Win32 class of the ${window} window, read from the window list at run time>`,
        titlePattern: `<exact title of the unowned ${window} window, escaped>`,
        allowOwned: false,
      },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: { ...WALK_DEFAULT_BOUNDS },
    note: "tools/uia/walk.ts by the --walker-cmd command line; it checks this read again with the real pid, class and title",
  };
}

/** True when `path` is on the policy's ExecuteAction allow-list. */
export function allowListed(policy: CensusPolicy, path: readonly string[]): boolean {
  const key = path.map(normalizeLabel).join("/");
  return (policy.execute_action?.allow_list ?? []).some((entry) => {
    const parts = Array.isArray(entry) ? entry : entry.split(/\s*>\s*|\//);
    return parts.map(normalizeLabel).join("/") === key;
  });
}

// ── Bohemia handler classification (E04's 34 rows) ───────────────────────────

/** Path inputs the Bohemia calls need; `<sandbox>` stands in for a dry run without --sandbox. */
export interface PathInput {
  sandbox: string;
  gproj: string;
  tinyWorldAbs: string | null;
}

export interface BiHandler {
  name: string;
  /** E04 row id and source location (pak). */
  row: string;
  ref: string;
  /** Response fields E04 declares (OnPack / RegV / RegAll). */
  response: readonly string[];
  why: string;
  calls(p: PathInput): Array<{ params: Record<string, unknown>; note: string; timeoutMs?: number }>;
}

const BI = (
  name: string,
  file: string,
  line: number,
): { name: string; row: string; ref: string } => ({
  name,
  row: `net:handler/${name}`,
  ref: `pak:scripts/WorkbenchGameCommon/${file}#L${line}`,
});

/**
 * The 15 handlers whose source (read from the paks through E04's table and the
 * files themselves) shows no write, no dialog, no window, and no unguarded
 * dereference of a value the inputs below can make null: L12 and the read half
 * of U26. Every GetMetaFile result they use is null-checked (or the input
 * takes the null branch), so a path without a meta answers an error instead
 * of raising a VM exception. `why` carries the audit per handler. In call
 * order: cheap first, the heavy two last.
 */
export const BI_INCLUDED: readonly BiHandler[] = [
  {
    ...BI("GetLoadedProjects", "EnfusionBlenderTools/AssetLibraryUtils.c", 43),
    response: ["Loaded Projects"],
    why: "GameProject.GetLoadedAddons, GetAddonID, Workbench.GetAbsolutePath: reads only; no object dereferenced",
    calls: () => [{ params: {}, note: "no request" }],
  },
  {
    ...BI("LocateProject", "EnfusionBlenderTools/AssetLibraryUtils.c", 80),
    response: ["status", "message", "projectName", "projectPath"],
    why: "GetLoadedAddons and string compare: reads only; no object dereferenced",
    calls: (p) => [
      { params: { path: backSlashes(p.gproj) }, note: "backslash path (DEC-019 slash style)" },
      {
        params: { path: forwardSlashes(p.gproj) },
        note: "forward-slash path (DEC-019 slash style)",
      },
    ],
  },
  {
    ...BI("LocatePrefabsFromPath", "EnfusionBlenderTools/AssetLibraryUtils.c", 144),
    response: ["status", "message", "prefabsPaths"],
    why: "FileIO.FindFiles under the given folder: reads only; the empty sandbox takes Bohemia's own 'no prefabs' branch, which answers with a null prefabsPaths list (packing a null list is native code, not a script dereference [unverified that it packs cleanly])",
    calls: (p) => [
      {
        params: {
          selectedProject: SANDBOX_NAME,
          projectPath: backSlashes(p.sandbox),
          selectedFolder: backSlashes(p.sandbox),
        },
        note: "backslash paths (DEC-019 slash style); the sandbox holds no prefab",
      },
      {
        params: {
          selectedProject: SANDBOX_NAME,
          projectPath: forwardSlashes(p.sandbox),
          selectedFolder: forwardSlashes(p.sandbox),
        },
        note: "forward-slash paths (DEC-019 slash style)",
      },
    ],
  },
  {
    ...BI("LoadedProjects", "EnfusionBlenderTools/LoadedProjects.c", 22),
    response: ["resourceInProject"],
    why: "GetLoadedAddons and string compare (Substring only on a non-empty path): reads only",
    calls: (p) => [
      { params: { path: p.gproj }, note: "a path inside the sandbox" },
      { params: { path: "Z:/ECEN_SC_absent/x.fbx" }, note: "a path inside no project" },
    ],
  },
  {
    ...BI("CheckGUID", "EnfusionBlenderTools/CheckGUID.c", 21),
    response: ["exists"],
    why: "Workbench.GetResourceName and a string compare: reads only; no object dereferenced",
    calls: () => [
      { params: { matName: VANILLA.characterGuid }, note: "a vanilla GUID" },
      { params: { matName: "0000000000000000" }, note: "a GUID nothing has" },
    ],
  },
  {
    ...BI("GetPathToAssetsFromGuids", "EnfusionBlenderTools/AssetLibraryUtils.c", 279),
    response: ["prefabsPaths", "invalidGuids"],
    why: "Workbench.GetAbsolutePath per GUID: reads only; the guids list is always given",
    calls: () => [
      {
        params: { guids: [VANILLA.characterGuid, VANILLA.propGuid, "0000000000000000"] },
        note: "two packed vanilla prefabs and an unknown GUID",
      },
    ],
  },
  {
    ...BI("GetPrefabGUID", "EnfusionBlenderTools/AssetLibraryUtils.c", 224),
    response: ["status", "message", "guid"],
    why: "ResourceManager.GetMetaFile, null-checked ('Meta file not found!'), then MetaFile.GetResourceID: reads only",
    calls: (p) => [
      { params: { prefabPath: VANILLA.characterRef }, note: "{GUID}path form (DEC-019)" },
      { params: { prefabPath: VANILLA.characterPath }, note: "relative path form (DEC-019)" },
      {
        params: { prefabPath: `$ArmaReforger:${VANILLA.characterPath}` },
        note: "$addon: form (DEC-019)",
      },
      ...(p.tinyWorldAbs
        ? [
            {
              params: { prefabPath: p.tinyWorldAbs },
              note: "absolute path form, a sandbox file (DEC-019)",
            },
          ]
        : []),
    ],
  },
  {
    ...BI("GetRelativePath", "EnfusionBlenderTools/EBTEmatUtils.c", 56),
    response: ["relPath", "errorString"],
    why: "a {GUID} path is returned before any call; otherwise GetMetaFile, null-checked, then GetResourceID: reads only",
    calls: (p) => [
      { params: { absPath: VANILLA.characterRef }, note: "a {GUID} path is returned as is" },
      { params: { absPath: p.gproj }, note: "a sandbox file without a meta" },
      ...(p.tinyWorldAbs
        ? [{ params: { absPath: p.tinyWorldAbs }, note: "a sandbox resource" }]
        : []),
    ],
  },
  {
    ...BI("AnimExportProfiles", "EnfusionBlenderTools/AnimExportProfiles.c", 29),
    response: ["ProfileNames"],
    why: "a new TxaExporter (never null), LoadProfiles reads a profile file: reads only",
    calls: () => [
      { params: { ExportProfileAbsPath: "" }, note: "no profile file: the empty shape" },
    ],
  },
  {
    ...BI("AnimExportProfileChannels", "EnfusionBlenderTools/AnimExportProfiles.c", 90),
    response: ["Channels"],
    why: "a new TxaExporter, GetProfileIndex; OnPack reads channels only when the index is not -1: reads only",
    calls: () => [{ params: { ProfileName: "ECEN_SC_NoSuchProfile" }, note: "unknown profile" }],
  },
  {
    ...BI("TextureValidation", "EnfusionBlenderTools/TextureValidation.c", 93),
    response: ["invalidTextures", "xob", "xobMats"],
    why: "EBTEmatUtils.GetMaterials null-checks GetMetaFile and the handler then answers xob false. The input is a relative path to no file, so GetMetaFile has nothing to return (a relative path straight to GetMetaFile is Bohemia's own pattern: GetMetaFileFromString, GetPrefabChildInfo); the unguarded Configurations walk after a found meta, and Resource.Load, are never reached",
    calls: () => [
      {
        params: { mats: [], fbxPath: "ECEN_SC_absent/ECEN_SC_absent.fbx" },
        note: "a model that does not exist: the null-meta branch (xob false); the shape is the point",
      },
    ],
  },
  {
    ...BI("GetPrefabChildInfo", "ResourceInfo.c", 675),
    response: ["status", "message", "resourceName", "absolutePath", "data"],
    why: "GetMetaFile, null-checked, then Resource.Load (reached only when the meta exists) and container reads; the child is null-checked; one child index only",
    calls: () => [
      {
        params: { resourceName: VANILLA.propBaseRef, childIdx: [], expandResource: false },
        note: "the prop's parent, root (components set locally)",
      },
      {
        params: { resourceName: VANILLA.characterRef, childIdx: [0], expandResource: false },
        note: "child 0 of the base character: the pak copy has no child entity at top level, so this takes the no-child branch (GetChild out of range, then the null check; [unverified] that GetChild returns null there rather than raising)",
      },
    ],
  },
  {
    ...BI("PrefabImporter", "EnfusionBlenderTools/PrefabImporter.c", 336),
    response: [
      "status",
      "message",
      "fbx",
      "coords",
      "angles",
      "scales",
      "pivots",
      "ids",
      "sourceMat",
      "ematPath",
      "stopped",
      "size",
      "parents",
    ],
    why: "GetMetaFile, null-checked ('Prefab Resource ... is missing!'). On a found meta the walk reads the prop's parent, which sets its own components (MeshObject at index 0, no Hierarchy, no Materials override, no child entity); a packed model has no .fbx on disk, so the ancestor walk after it is never entered: reads only",
    calls: () => [
      {
        params: { absPath: VANILLA.propBasePath, start: 0 },
        note: "the prop's parent (components set locally)",
      },
    ],
  },
  {
    ...BI("GetResourceInfo", "ResourceInfo.c", 640),
    response: ["status", "message", "resourceName", "absolutePath", "data"],
    why: "GetMetaFileFromString (null answers an error), the configuration container null-checked, Resource.Load checked with IsValid (LoadContainer null-checked) before any GetResource: reads only",
    calls: () => [
      { params: { path: VANILLA.characterRef, expandResource: false }, note: "status enum form" },
      {
        params: { path: VANILLA.packedWorld, expandResource: false },
        note: ".ent (mcp-inventory-L349)",
      },
      { params: { path: VANILLA.emat, expandResource: false }, note: "packed material" },
      { params: { path: VANILLA.textureRef, expandResource: false }, note: "packed texture" },
      {
        params: { path: VANILLA.propBaseRef, expandResource: true },
        note: "expanded small prop: the expanded shape and its size (resource-manager-L683); the character sweep is P3-bi",
        timeoutMs: TIMEOUTS.openWorld,
      },
    ],
  },
  {
    ...BI("GetGameMaterials", "ResourceInfo.c", 768),
    response: ["data"],
    why: "ResourceDatabase.SearchResources over every .gamemat: reads only; the heavy baseline for U30",
    calls: () => [
      { params: {}, note: "heavy: whole resource database", timeoutMs: TIMEOUTS.heavy },
    ],
  },
];

/** Bohemia handlers that only open a window: run in the reversible block. */
export const BI_REVERSIBLE: readonly BiHandler[] = [
  {
    ...BI("OpenXOB", "EnfusionBlenderTools/OpenXOB.c", 21),
    response: ["Output"],
    why: "ResourceManager.SetOpenedResource: opens a model window, writes nothing; no object dereferenced",
    calls: () => [{ params: { path: VANILLA.xob }, note: "packed model", timeoutMs: TIMEOUTS.gui }],
  },
];

/** The other 18 of E04's 34 rows, never called in S-C, each with the reason read from source. */
export const BI_EXCLUDED: ReadonlyArray<{ name: string; reason: string; carried_to: string }> = [
  {
    name: "TextureValidator",
    reason:
      "dereferences GetMetaFile's result with no null check (ValidateMaterialPlugin.c TextureImportSettings: meta.GetObjectArray right after GetMetaFile); a path without a meta, which is every path S-C can give (no texture in the sandbox, no .meta in the paks), raises a VM exception, and the VME dialog under Script Debug Mode (docs/TEST-RESULTS.md, the wb_validate row, records a TextureValidator.TextureImportSettings null-meta VM exception)",
    carried_to:
      "S-E with a throwaway loose texture and its meta (the whole DEC-019 TextureValidator check)",
  },
  {
    name: "PrefabImporterBake",
    reason:
      "dereferences GetMetaFile's result with no null check (PrefabImporterBake.c GetResponse: Resource.Load(meta.GetResourceID()) right after GetMetaFile), unlike PrefabImporter; a packed relative path very likely gives a null meta",
    carried_to: "S-E with a loose sandbox prefab and its meta, or P3-bi",
  },
  {
    name: "LayerPresets",
    reason:
      "walks GetGameProjectSettings > Configurations[0] > PhysicsSettings > Interactions > LayerPresets with no null check (LayerPresets.c#L35-41); the sandbox .gproj's PC configuration is empty (src/templates/gproj.ts) and PhysicsSettings lives in the base game's .gproj, so the walk is safe only if the settings container merges the dependency's configuration [unverified]",
    carried_to: "P3-bi, or S-E once the project-settings merge is known",
  },
  {
    name: "GetLayerInteraction",
    reason: "the same unguarded project-settings walk as LayerPresets (LayerPresets.c#L105-111)",
    carried_to: "P3-bi, or S-E once the project-settings merge is known",
  },
  {
    name: "AnimExportTrackExport",
    reason: "writes a .txa (TxaExporter.TrackExport, AnimExport.c#L80)",
    carried_to: "P3-bi",
  },
  {
    name: "BakeInfo",
    reason: "opens Workbench.ScriptDialog, a modal (BakeMLOD.c#L388)",
    carried_to: "never from a handler before the U6 watchdog",
  },
  {
    name: "EBTInfo",
    reason: "opens Workbench.ScriptDialog, a modal (EBTResponse.c#L49)",
    carried_to: "never from a handler before the U6 watchdog",
  },
  {
    name: "ExampleCall",
    reason: "declared only under #ifdef DOXYGEN (NetApiDocs.c#L228): not compiled",
    carried_to: "none",
  },
  {
    name: "ExportFBXResource",
    reason: "RegisterResourceFile, MetaFile.Save, RebuildResourceFile (ResourceInfo.c#L1027-1081)",
    carried_to: "P3-bi",
  },
  {
    name: "ExportMaterialResource",
    reason: "BaseContainerTools.SaveContainer and RegisterResourceFile (ResourceInfo.c#L957-960)",
    carried_to: "P3-bi",
  },
  {
    name: "ExportTXAResource",
    reason: "writes a .txa, registers and rebuilds it (ResourceInfo.c#L1224-1240)",
    carried_to: "P3-bi",
  },
  {
    name: "ExportTerrain",
    reason: "opens a world and writes terrain tiles (SetTerrainSurfaceTile, ExportTerrain.c#L70)",
    carried_to: "W7 / P3-bi on a throwaway terrain",
  },
  {
    name: "ExportTextureResource",
    reason: "FileIO.CopyFile, register, MetaFile.Save, rebuild (ResourceInfo.c#L1123-1145)",
    carried_to: "P3-bi",
  },
  {
    name: "FBXReportToolMessage",
    reason:
      "writes the system clipboard (System.ExportToClipboard, ValidateFBXPlugin.c#L318) and dereferences a file handle that is null for a wrong path",
    carried_to: "P3-bi with a Blender log fixture",
  },
  {
    name: "GetPortalMat",
    reason:
      "read-only by source, but Resource.Load on every .emat under $ArmaReforger:Assets in one call (GetPortalMat.c#L44-48): unbounded queue time",
    carried_to: "P3-bi",
  },
  {
    name: "MaterialValidator",
    reason:
      "indexes ValidateMaterialPlugin.materials, a static list only the FBX validation plugin fills (it starts Blender); called cold it reads past an empty array (ValidateMaterialPlugin.c#L343)",
    carried_to: "P3-bi after the plugin run",
  },
  {
    name: "OverrideMeshObjectMaterial",
    reason:
      "SaveContainer, SetVariableValue and SaveEntityTemplate on prefabs (BakeMLOD.c#L448-598)",
    carried_to: "P3-bi",
  },
  {
    name: "RegisterResource",
    reason: "RegisterResourceFile, RebuildResourceFile, MetaFile.Save (ResourceInfo.c#L1287-1307)",
    carried_to: "P3-bi",
  },
];

// ── Step table ───────────────────────────────────────────────────────────────

export interface PlanInput {
  paths: PathInput;
  tinyWorldResource: string | null;
  tinyWorldPresent: boolean;
  undoAllowed: boolean;
  /** --u29-forward given: sc-10 runs (the owner's call). */
  u29Forward: boolean;
  nonce: string;
  u13: U13Knobs;
  /** The scratch ini every launch passes as `-forceSettings` (a placeholder in a dry run without it). */
  forceSettings: string;
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
  /** The outline line for operations the action-plan format has no kind for. */
  outline: string[];
  needsTinyWorld?: boolean;
  /**
   * When the step can be skipped at run time: the condition in words and where
   * its probes go. The queue's not_answered lists each probe only such steps
   * answer, with this condition (conditionalNotAnswered).
   */
  skipWhen?: { condition: string; carried_to: string };
  /** Run-time skip check (besides needsTinyWorld): the reason, or null to run. */
  skip?(ctx: RunContext): string | null;
  /** Checkable actions (net-call, execute-action, launch, uia-read, screenshot) this step issues. */
  plan(p: PlanInput): PlanAction[];
  run(ctx: RunContext): Promise<StepOutcome>;
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

/**
 * A Workbench start as the dry-run checker's `launch` kind: the proven form
 * `-gproj <sandbox gproj> -forceSettings <scratch.ini>` plus one U29 link
 * (sandboxLaunch builds the same arguments at run time and refuses any other
 * extra argument).
 */
function launchAction(
  step: string,
  probes: string[],
  gproj: string,
  forceSettings: string,
  uri: string,
  recorded: boolean,
): PlanAction {
  return {
    kind: "launch",
    step,
    probes,
    target: { gproj } as unknown as PlanAction["target"],
    args: ["-gproj", gproj, "-forceSettings", forceSettings, uri],
    note: recorded
      ? "the relaunch; its pid is recorded in the lease"
      : "a second process while Workbench runs; not recorded in the lease",
  };
}

const NO_TINY_WORLD =
  "no tiny world (OA-3 not done, --tiny-world not given, or its file absent): U13 and U19 move to S-E (plan Phase 0 item 7)";

const READY_NOTE =
  "wait for the recorded pid to listen on the NET port (listener table, no NET call)";

/** IsWorkbenchRunning until ScriptsCompiled is true; every call can stop the run on its own timeout. */
async function waitScriptsCompiled(ctx: RunContext, budgetMs: number): Promise<RawCallResult> {
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
        `scripts not compiled after ${budgetMs} ms (IsWorkbenchRunning: ${JSON.stringify(r.response ?? r.error)}); the handler compile gate failed (plan 5.4)`,
      );
    }
    await ctx.deps.sleep(TIMEOUTS.poll);
  }
}

/** A run-folder JSON file's content, or null when it is missing or unreadable. */
function runJson<T>(ctx: RunContext, name: string): T | null {
  const text = ctx.deps.readRunFile(name);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * What this run folder knows of `pid` (DEC-032): "reused" when a started marker names it with
 * another creation time; "known" when a finished step's marker, or a passed gate, names it with
 * this creation time; "new" otherwise (and whenever the creation time cannot be read).
 */
export function knownPid(
  ctx: Pick<RunContext, "deps">,
  pid: number,
  created: number | null,
): "reused" | "known" | "new" {
  if (created === null) return "new";
  const files = ctx.deps.listRunFiles();
  let known = false;
  for (const f of files) {
    const m = /^(.+)\.started(\.acknowledged)?$/.exec(f);
    if (!m) continue;
    const marker = runJson<StartedMarker>(ctx as RunContext, f);
    if (!marker || marker.pid !== pid || marker.created === null) continue;
    if (marker.created !== created) return "reused";
    if (files.includes(`${m[1]}.json`)) known = true;
  }
  const gate = runJson<{ status?: string; data?: { pid?: number; created?: number | null } }>(
    ctx as RunContext,
    "sc-00-gate.json",
  );
  if (gate?.status === "pass" && gate.data?.pid === pid && gate.data.created === created) {
    known = true;
  }
  return known ? "known" : "new";
}

/** sc-02's GetGameMaterials time, from memory or from its result in the run folder (a resume). */
export function heavyBaselineOf(ctx: Pick<RunContext, "deps" | "state">): number | null {
  if (ctx.state.heavyBaselineMs !== null) return ctx.state.heavyBaselineMs;
  const r = runJson<{ data?: { calls?: Array<{ ok?: boolean; durationMs?: number }> } }>(
    ctx as RunContext,
    "sc-02-bi-GetGameMaterials.json",
  );
  const c = r?.data?.calls?.find((x) => x.ok === true && typeof x.durationMs === "number");
  return c ? c.durationMs! : null;
}

/** sc-05's Resource Manager window, from memory or from its result (a resume), for this pid only. */
export function rmWindowOf(ctx: Pick<RunContext, "deps" | "state">): WindowInfo | null {
  if (ctx.state.rmWindow) return ctx.state.rmWindow;
  const r = runJson<{ data?: { resourceManagerWindow?: WindowInfo | null } }>(
    ctx as RunContext,
    "sc-05-u7-before.json",
  );
  const w = r?.data?.resourceManagerWindow ?? null;
  return w && w.pid === ctx.state.wbPid ? w : null;
}

/** Wait until `pid` holds the NET port; another owner or the deadline stops the run. */
async function waitPort(ctx: RunContext, pid: number, budgetMs: number): Promise<void> {
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

/** Assert the loaded addons through Bohemia's GetLoadedProjects (pak handler, no EMCP code). */
async function assertLoadedProjects(ctx: RunContext): Promise<string[]> {
  const r = await ctx.call({
    apiFunc: "GetLoadedProjects",
    params: {},
    timeoutMs: TIMEOUTS.bohemia,
  });
  const ids = r.ok ? loadedProjectsOf(r.response) : null;
  const problem = r.ok
    ? loadedProjectsProblem(ids, ctx.opts.allowedAddons)
    : `GetLoadedProjects failed: ${r.error}`;
  if (problem) throw new StopSession("abort", `not the sandbox: ${problem}`);
  return ids ?? [];
}

/**
 * Assert the session log written after `after` names the sandbox. No line in
 * time: stop. When `pid` is given, the launcher window for it is the abort case.
 */
async function assertSessionLog(
  ctx: RunContext,
  after: number | null,
  budgetMs: number,
  pid: number | null = null,
): Promise<string> {
  const deadline = ctx.deps.now() + budgetMs;
  for (;;) {
    ctx.deps.heartbeat();
    if (pid !== null) {
      const launcher = await launcherWindow(ctx, pid);
      if (launcher)
        throw new StopSession(
          "abort",
          `the launcher window is up for pid ${pid}: "${launcher.title}"`,
        );
    }
    const log = ctx.deps.sessionLogAfter(after);
    if (log) {
      const opened = openedProjectFromLog(ctx.deps.readText(log), ctx.opts.openedProjectPattern);
      if (opened !== null) {
        if (!namesSandbox(opened, ctx.opts.gproj)) {
          throw new StopSession("abort", `not the sandbox: the session log names ${opened}`);
        }
        return opened;
      }
    }
    if (ctx.deps.now() >= deadline) {
      throw new StopSession(
        "timeout",
        `no session log line naming the opened project within ${budgetMs} ms (pattern ${ctx.opts.openedProjectPattern})`,
      );
    }
    await ctx.deps.sleep(TIMEOUTS.poll);
  }
}

/**
 * Script Debug Mode must be off: with it on, a VM exception in any handler
 * raises the modal VME dialog. Under the scratch profile (--force-settings,
 * DEC-038) the forced ini is the setting that counts, so it is read from there;
 * otherwise from the pre-flight `reg export` file (no registry access). On:
 * stop. No value: stop unless the owner confirmed by looking
 * (--debug-mode-unset-ok).
 */
function debugModeGate(ctx: RunContext): {
  state: string;
  line: string | null;
  source: "force-settings-ini" | "registry-export";
} {
  if (ctx.opts.forceSettings) {
    const r = iniScriptDebugMode(ctx.deps.readText(ctx.opts.forceSettings));
    if (r.state === "on") {
      throw new StopSession(
        "kill",
        `Script Debug Mode is on in the forced settings ini (${r.line}): a VM exception would raise the VME dialog; the main session rebuilds the ini with ScriptDebugMode=false before S-C`,
      );
    }
    if (r.state === "absent" && !ctx.opts.debugModeUnsetOk) {
      throw new StopSession(
        "kill",
        "the forced settings ini holds no ScriptDebugMode in [World%20Editor]: the owner confirms in the World Editor that Script Debug Mode is unchecked, then the run is repeated with --debug-mode-unset-ok",
      );
    }
    return { ...r, source: "force-settings-ini" };
  }
  if (!ctx.opts.registryExport) {
    throw new StopSession(
      "kill",
      "no pre-flight registry export given (--registry-export): Script Debug Mode cannot be checked",
    );
  }
  const r = scriptDebugMode(ctx.deps.readRegLines(ctx.opts.registryExport));
  if (r.state === "on") {
    throw new StopSession(
      "kill",
      `Script Debug Mode is on in the pre-flight registry export (${r.line}): a VM exception would raise the VME dialog; the owner turns it off before S-C`,
    );
  }
  if (r.state === "absent" && !ctx.opts.debugModeUnsetOk) {
    throw new StopSession(
      "kill",
      "the pre-flight registry export holds no ScriptDebugMode value: the owner confirms in the World Editor that Script Debug Mode is unchecked, then the run is repeated with --debug-mode-unset-ok",
    );
  }
  return { ...r, source: "registry-export" };
}

/** Launcher windows on any process whose image is the Workbench executable. */
async function workbenchLaunchers(ctx: RunContext): Promise<WindowInfo[]> {
  const all = await ctx.deps.listWindows();
  const isWb = new Map<number, boolean>();
  return all.filter((w) => {
    if (!w.title.toLowerCase().includes(LAUNCHER_WINDOW_TITLE.toLowerCase())) return false;
    if (!isWb.has(w.pid)) {
      isWb.set(w.pid, ctx.deps.processImage(w.pid)?.toLowerCase() === WORKBENCH_EXE.toLowerCase());
    }
    return isWb.get(w.pid) === true;
  });
}

/**
 * U30's per-call budget: max(120 s, 4 x the single GetGameMaterials time),
 * never more than 4 x that call's own 300 s timeout (the queue's worst case).
 */
export function burstPerCallMs(heavyBaselineMs: number | null): number {
  return Math.min(4 * TIMEOUTS.heavy, Math.max(TIMEOUTS.burstFloor, 4 * (heavyBaselineMs ?? 0)));
}

/** One Bohemia handler, each call followed by the modal check. */
function biStep(h: BiHandler, risk: RiskClass, answers: string[]): StepDef {
  const id = risk === "read-only" ? `sc-02-bi-${h.name}` : `sc-08b-bi-${h.name}`;
  const specs = (p: PathInput): CallSpec[] =>
    h.calls(p).map((c) => ({
      apiFunc: h.name,
      params: c.params,
      timeoutMs: c.timeoutMs ?? TIMEOUTS.bohemia,
      note: c.note,
    }));
  // Worst case: every call runs to its timeout, each followed by its modal check (with the tiny
  // world, GetPrefabGUID and GetRelativePath make one call more each).
  const worst = h
    .calls({ sandbox: "", gproj: "", tinyWorldAbs: "<tiny>" })
    .reduce((sum, c) => sum + (c.timeoutMs ?? TIMEOUTS.bohemia) + HELPER.windows, 0);
  return {
    id,
    title: `Bohemia handler ${h.name} (${h.row}, ${h.ref})`,
    risk,
    answers,
    timeout_ms: worst,
    expected:
      `status Ok; the answer's keys equal the fields E04 declares (${h.response.join(", ") || "none"}); ` +
      "differences are recorded per call as the live contract (U26 read half)",
    kill_criterion:
      "a call unanswered within its own timeout (no retry: capture, windows, stop); after a call, a Workbench window turned disabled or a new owned or dialog-class window (a modal or a prompt is up): stop, nothing clicked; connection refused: stop",
    side_effects:
      risk === "read-only"
        ? []
        : [
            "a model window opens in the Resource Manager (it ends with the process at the U29 graceful close)",
          ],
    rollback:
      risk === "read-only"
        ? "none needed (read-only by source)"
        : "none needed; the U29 graceful close ends the process and every module window with it (Workbench may reopen its last resource at the relaunch; sc-09 records which windows came back)",
    outline: ["after each call: list the Workbench windows (modal check)"],
    plan: (p) => specs(p.paths).map((s) => net(id, answers, s)),
    run: async (ctx) => {
      const per: Array<Record<string, unknown>> = [];
      for (const s of specs(pathInput(ctx))) {
        const r = await ctx.call(s);
        per.push({
          params: s.params,
          note: s.note,
          ...summarizeCall(r),
          ...fieldDiff(r.response, h.response),
        });
        // OpenXOB opens a model window on purpose: a new window whose title names
        // the model is expected even if owned; any other owned or dialog-class
        // window still stops the run.
        const opened = risk === "reversible" ? String(s.params.path ?? "") : "";
        await ctx.modalCheck(`${h.name} ${s.note ?? ""}`, (w) =>
          opened ? titleNames(w, opened) : false,
        );
        if (h.name === "GetGameMaterials" && r.ok) ctx.state.heavyBaselineMs = r.durationMs;
      }
      const okCount = per.filter((x) => x.ok).length;
      return {
        status: "observed",
        summary: `${okCount} of ${per.length} calls answered Ok`,
        data: { handler: h.name, row: h.row, ref: h.ref, why: h.why, calls: per },
      };
    },
  };
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

function pathInput(ctx: RunContext): PathInput {
  return {
    sandbox: ctx.opts.sandboxDir,
    gproj: ctx.opts.gproj,
    tinyWorldAbs:
      ctx.state.tinyWorldPresent && ctx.opts.tinyWorld
        ? join(ctx.opts.sandboxDir, ctx.opts.tinyWorld)
        : null,
  };
}

/** The step table, in queue order. */
export function buildSteps(): StepDef[] {
  const P = SC_PROBES;
  const steps: StepDef[] = [];

  // ── read-only ─────────────────────────────────────────────────────────────
  steps.push({
    id: "sc-00-gate",
    title:
      "Gate: the recorded Workbench is ours, listens, has compiled scripts and opened the sandbox",
    risk: "read-only",
    answers: [],
    // listen 300 s + compile 300 s (+ the last 10 s call) + GetLoadedProjects 30 s; helpers: the
    // image check, the creation time, the listener poll's last tasklist and netstat, the baseline
    timeout_ms:
      2 * TIMEOUTS.ready +
      TIMEOUTS.cheap +
      TIMEOUTS.bohemia +
      HELPER.process +
      HELPER.table +
      2 * HELPER.process +
      HELPER.windows,
    expected:
      "the forced settings ini (--force-settings; without it, the pre-flight registry export) says Script Debug Mode is off; the lease records a Workbench pid whose image is the Workbench executable and which holds the NET port; IsWorkbenchRunning says ScriptsCompiled; GetLoadedProjects lists the sandbox and nothing but the allowed addons; the newest session log names the sandbox; no Workbench window is disabled, owned or of a dialog class",
    kill_criterion:
      "Script Debug Mode on in the forced settings ini, or in the export without --force-settings (or no value there without --debug-mode-unset-ok): stop before any NET call; no recorded pid, another image, another port owner or no listener within 300 s: stop; ScriptsCompiled still false after 300 s: stop (compile gate, plan 5.4); a call timeout: stop; a disabled, owned or dialog-class Workbench window in the baseline: stop; GetLoadedProjects or the log naming another project: abort and close that Workbench",
    side_effects: [],
    rollback: "none needed",
    outline: [
      "read ScriptDebugMode from the pre-flight registry export (--registry-export, a file; no registry access)",
      READY_NOTE,
      "read the newest session log (E13 pattern)",
      "list the Workbench windows (baseline; refused when it holds a disabled, owned or dialog-class window)",
    ],
    plan: () => [
      net("sc-00-gate", [], {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "repeated every 5 s until ScriptsCompiled",
      }),
      net("sc-00-gate", [], {
        apiFunc: "GetLoadedProjects",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
        note: "opened-project assertion",
      }),
    ],
    run: async (ctx) => {
      const debug = debugModeGate(ctx);
      const pid = ctx.deps.recordedPid();
      if (pid === null) {
        throw new StopSession(
          "kill",
          "this lane's lease records no Workbench pid: run preflight.ts (default variant) first",
        );
      }
      const image = ctx.deps.processImage(pid);
      if (image === null || image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
        throw new StopSession(
          "kill",
          `recorded pid ${pid} is ${image ?? "not running"}, not ${WORKBENCH_EXE}`,
        );
      }
      // DEC-032 (S-C read i6, M4): the pid's creation time against this run folder's markers. A
      // marker naming the pid with another creation time is a reused pid; a finished step or a
      // passed gate naming the same process makes this a resume, whose waits are one check each.
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
      const loaded = await assertLoadedProjects(ctx);
      const log = ctx.deps.sessionLogAfter(null);
      let fromLog: string | null = null;
      if (log) {
        fromLog = openedProjectFromLog(ctx.deps.readText(log), ctx.opts.openedProjectPattern);
        if (fromLog !== null && !namesSandbox(fromLog, ctx.opts.gproj)) {
          throw new StopSession("abort", `not the sandbox: the session log names ${fromLog}`);
        }
      }
      await ctx.setBaseline("the gate");
      ctx.state.tinyWorldPresent =
        ctx.opts.tinyWorld !== null &&
        tinyWorldProblem(ctx.opts.tinyWorld, ctx.opts.sandboxDir) === null &&
        ctx.deps.fileExists(join(ctx.opts.sandboxDir, ctx.opts.tinyWorld));
      return {
        status: "pass",
        summary: `Script Debug Mode ${debug.state} (read from the ${debug.source}); pid ${pid}; loaded ${loaded.join(", ")}; log ${fromLog ?? "names no project (pre-flight step 9 asserted it)"}; tiny world ${ctx.state.tinyWorldPresent ? "present" : "absent"}`,
        data: {
          scriptDebugMode: debug,
          pid,
          created,
          resumed: known === "known",
          isWorkbenchRunning: compiled.response,
          loaded,
          sessionLogProject: fromLog,
          tinyWorldPresent: ctx.state.tinyWorldPresent,
          windows: ctx.state.baselineWindows,
        },
      };
    },
  });

  const nativesRead = [
    ...P.natives.filter(
      (x) => x !== E("plugins-netapi-cli-L459") && x !== E("gui-census-feasibility-L684"),
    ),
    E("plugins-netapi-cli-L458"),
  ];
  steps.push({
    id: "sc-01-natives-read",
    title:
      "Native NET functions that only read: IsWorkbenchRunning, IsWorldEditorRunning (raw wire)",
    risk: "read-only",
    answers: nativesRead,
    timeout_ms: 2 * TIMEOUTS.cheap,
    expected:
      "status Ok and {IsRunning, ScriptsCompiled} for both (E04 NetApiDocs.c#L84 and #L98; E05 names both); the wire record says whether a payload string follows the status",
    kill_criterion: "a call unanswered in 10 s: stop (no retry); connection refused: stop",
    side_effects: [],
    rollback: "none needed",
    outline: [],
    plan: () => [
      net("sc-01-natives-read", nativesRead, {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
      net("sc-01-natives-read", nativesRead, {
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
    ],
    run: async (ctx) => {
      const a = await ctx.call({
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      const b = await ctx.call({
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      return {
        status: "observed",
        summary: `IsWorkbenchRunning ${a.ok ? "Ok" : a.error}; IsWorldEditorRunning ${b.ok ? "Ok" : b.error}`,
        data: {
          IsWorkbenchRunning: {
            ...summarizeCall(a),
            ...fieldDiff(a.response, ["IsRunning", "ScriptsCompiled"]),
          },
          IsWorldEditorRunning: {
            ...summarizeCall(b),
            ...fieldDiff(b.response, ["IsRunning", "ScriptsCompiled"]),
          },
        },
      };
    },
  });

  const biAnswers = (name: string): string[] => {
    const out: string[] = [...P.u26];
    if (name === "GetResourceInfo") out.push(E("mcp-inventory-L349"));
    if (name === "LocateProject" || name === "LocatePrefabsFromPath")
      out.push(DEC019_CHECKS.slashStyle);
    if (name === "LocatePrefabsFromPath") out.push(E("mcp-inventory-L356"));
    if (name === "GetPrefabGUID") out.push(DEC019_CHECKS.prefabGuidForms);
    return [...new Set(out)];
  };
  for (const h of BI_INCLUDED) steps.push(biStep(h, "read-only", biAnswers(h.name)));

  const u30 = [...P.u30];
  steps.push({
    id: "sc-03-u30-burst",
    title: "U30: the NET queue under concurrency (the ONE planned exception to one call at a time)",
    risk: "read-only",
    answers: u30,
    // baseline ping + the stagger + the longest per-call budget (4 x a GetGameMaterials
    // that may itself take up to 300 s) + the closing IsWorkbenchRunning
    timeout_ms: 2 * TIMEOUTS.cheap + 6 * TIMEOUTS.burstStagger + 4 * TIMEOUTS.heavy,
    expected:
      "[unverified] the calls are served strictly one after another (completion order and gaps show it); none is dropped; the cheap calls wait behind the heavy ones",
    kill_criterion:
      "own criterion: every call of the burst has max(120 s, 4 x the single GetGameMaterials time of sc-02) to answer, at most 1200 s; any call unanswered then, or the IsWorkbenchRunning after the burst unanswered in 10 s: capture, windows, stop (no retry). A connection closed without an answer is a drop: recorded, not a stop",
    side_effects: ["the NET queue is busy for the duration of the two heavy calls"],
    rollback: "none needed; nothing is written",
    outline: [
      "one EMCP_WB_Ping first (baseline)",
      `then fire 2 x GetGameMaterials and 5 x EMCP_WB_Ping at once, ${TIMEOUTS.burstStagger} ms apart, each on its own socket`,
      "then one IsWorkbenchRunning",
    ],
    plan: () => [
      net("sc-03-u30-burst", u30, {
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "baseline, before the burst",
      }),
      ...[0, 1].map((i) =>
        net(
          "sc-03-u30-burst",
          u30,
          {
            apiFunc: "GetGameMaterials",
            params: {},
            timeoutMs: 4 * TIMEOUTS.heavy,
            note: `heavy ${i + 1} of 2; timeout max(120 s, 4 x the sc-02 time), at most this`,
          },
          { concurrent: true },
        ),
      ),
      ...[0, 1, 2, 3, 4].map((i) =>
        net(
          "sc-03-u30-burst",
          u30,
          {
            apiFunc: "EMCP_WB_Ping",
            params: {},
            timeoutMs: 4 * TIMEOUTS.heavy,
            note: `cheap ${i + 1} of 5; the same per-call budget as the heavy calls`,
          },
          { concurrent: true },
        ),
      ),
      net("sc-03-u30-burst", u30, {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "queue alive after the burst",
      }),
    ],
    run: async (ctx) => {
      const base = await ctx.call({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      // On a resume (one block per invocation) the baseline comes from sc-02's result (DEC-032 M4).
      const perCall = burstPerCallMs(heavyBaselineOf(ctx));
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
      }));
      const drops = results.filter(
        (r) => !r.ok && /closed without a response/.test(r.error ?? ""),
      ).length;
      return {
        status: "observed",
        summary: `${results.filter((r) => r.ok).length} of ${results.length} answered, ${drops} dropped; queue alive after: ${after.ok}`,
        data: {
          baselinePing: summarizeCall(base),
          perCallTimeoutMs: perCall,
          burst: rows,
          completionOrder: [...rows].sort((a, b) => a.endedAt - b.endedAt).map((r) => r.note),
          after: summarizeCall(after),
        },
      };
    },
  });

  const u2 = [...P.u2];
  const SNIPPET = 'string Main() { return "ok"; }';
  steps.push({
    id: "sc-04-u2-evaluate",
    title: "U2: native EvaluateScript, one trivial snippet",
    risk: "read-only",
    answers: u2,
    timeout_ms: TIMEOUTS.evaluate + HELPER.windows,
    expected:
      '[unverified] an error status such as "Undefined API func": the name is documented (NetApiDocs.c#L159, E08) and absent from the executable (E05, DEC-024). A ReturnValue of "ok" means it answers',
    kill_criterion:
      "no answer in 30 s: stop (no retry); a Workbench window disabled after the call (an authorisation prompt or other modal, U27): stop",
    side_effects: [],
    rollback: "none needed; the snippet only returns a string",
    outline: ["after the call: list the Workbench windows (modal check)"],
    plan: () => [
      net("sc-04-u2-evaluate", u2, {
        apiFunc: "EvaluateScript",
        params: { Script: SNIPPET },
        timeoutMs: TIMEOUTS.evaluate,
      }),
    ],
    run: async (ctx) => {
      const r = await ctx.call({
        apiFunc: "EvaluateScript",
        params: { Script: SNIPPET },
        timeoutMs: TIMEOUTS.evaluate,
      });
      await ctx.modalCheck("EvaluateScript");
      const answers = r.ok && field(r.response, "ReturnValue") !== undefined;
      return {
        status: "observed",
        summary: answers
          ? `EvaluateScript answers: ReturnValue ${JSON.stringify(field(r.response, "ReturnValue"))}`
          : `EvaluateScript does not answer: ${r.error ?? JSON.stringify(r.response)}`,
        data: { snippet: SNIPPET, answers, ...summarizeCall(r) },
      };
    },
  });

  // world-editor-L484 needs the World Editor window with a world open: sc-11b only.
  const u7 = [...P.u7.filter((x) => x !== E("world-editor-L484")), ...P.display];
  const measure = async (ctx: RunContext): Promise<Record<string, unknown>> => {
    const latencies: Array<number | null> = [];
    for (let i = 0; i < 10; i++) {
      const r = await ctx.call({ apiFunc: "EMCP_WB_Ping", params: {}, timeoutMs: TIMEOUTS.cheap });
      latencies.push(r.ok ? r.durationMs : null);
    }
    const stall = await ctx.deps.guiStall(ctx.state.wbPid!, 10);
    if (stall.some((s) => s === null)) {
      throw new StopSession(
        "kill",
        "the Workbench main window did not answer WM_NULL within 5 s (GUI hung)",
      );
    }
    const windows = await ctx.ourWindows();
    return {
      net: latencyStats(latencies),
      netSamples: latencies,
      gui: latencyStats(stall),
      guiSamples: stall,
      windows,
    };
  };
  const compareWithBefore = async (ctx: RunContext): Promise<StepOutcome> => {
    const m = await measure(ctx);
    let before = ctx.state.u7Before;
    if (!before) {
      const text = ctx.deps.readRunFile("sc-05-u7-before.json");
      before = text
        ? ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? null)
        : null;
    }
    const p50 = (x: unknown): number | null =>
      (x as { p50?: number | null } | undefined)?.p50 ?? null;
    const ratio = (a: number | null, b: number | null): number | null =>
      a !== null && b !== null && b > 0 ? a / b : null;
    const netRatio = ratio(p50(m.net), p50(before?.net));
    const guiRatio = ratio(p50(m.gui), p50(before?.gui));
    return {
      status: "observed",
      summary: `net p50 ratio ${netRatio}, gui p50 ratio ${guiRatio}`,
      data: { after: m, before, netRatio, guiRatio },
    };
  };
  const measurePlan = (id: string): PlanAction[] =>
    Array.from({ length: 10 }, (_, i) =>
      net(id, u7, {
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: `latency sample ${i + 1} of 10`,
      }),
    );
  // Ten pings, one ten-sample stall run as its PowerShell runner allows it, the window list.
  const measureBudget = 10 * TIMEOUTS.cheap + stallMs(10) + HELPER.windows;
  const u7SkipWhen = {
    condition:
      "a world is open when U7 starts (EMCP_WB_GetState shows entities): plan 7 wants the Resource Manager window with no world",
    carried_to: "the next GUI sitting on the sandbox with no world (S-D)",
  };
  /** sc-07 and sc-07b follow sc-05: skipped with it, also when resumed with --from. */
  const u7Skipped = (ctx: RunContext): string | null => {
    if (ctx.state.u7Skip) return ctx.state.u7Skip;
    const text = ctx.deps.readRunFile("sc-05-u7-before.json");
    if (!text) return null;
    const prior = JSON.parse(text) as { status?: string };
    return prior.status === "skipped" ? "skipped with sc-05-u7-before (a world was open)" : null;
  };
  steps.push({
    id: "sc-05-u7-before",
    title:
      "U7 before the walk: no world open, the Resource Manager window by title, NET latency and GUI stall",
    risk: "read-only",
    answers: u7,
    timeout_ms: TIMEOUTS.bohemia + measureBudget,
    expected:
      "EMCP_WB_GetState shows no world (no entities); ten EMCP_WB_Ping round trips (docs/v2/sessions/queues/walker.md step A) and ten WM_NULL round trips to the main window, all answered; an unowned Workbench window whose title names the Resource Manager is the one the walker is given; the window list (class, title, rect, monitor) is recorded",
    kill_criterion:
      "a NET call unanswered in its timeout: stop; a WM_NULL unanswered in 5 s (GUI hung): stop. A world open: U7 (sc-05 to sc-07b) is skipped with the reason, not stopped",
    side_effects: [],
    rollback: "none needed",
    skipWhen: u7SkipWhen,
    outline: [
      "EMCP_WB_GetState: a world with entities open means U7 is skipped (Workbench may reopen its last world at start)",
      "10 x SendMessageTimeout(WM_NULL, 5 s) to the main window (GUI stall)",
      "list the Workbench windows: class, title, rect, monitor (gui-census-feasibility-L698); the walker's window is the unowned one whose title names the Resource Manager, never the largest",
    ],
    plan: () => [
      net("sc-05-u7-before", u7, {
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
        note: "no world open (plan 7: the Resource Manager window with no world)",
      }),
      ...measurePlan("sc-05-u7-before"),
    ],
    run: async (ctx) => {
      const st = await ctx.call({
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      });
      const entities = Number(field(st.response, "entityCount") ?? 0);
      if (st.ok && field(st.response, "mode") === "edit" && entities > 0) {
        ctx.state.u7Skip = `a world is open (EMCP_WB_GetState: ${entities} entities): U7 needs the Resource Manager window with no world; carried to ${u7SkipWhen.carried_to}`;
        return {
          status: "skipped",
          summary: ctx.state.u7Skip,
          data: { state: summarizeCall(st) },
        };
      }
      const m = await measure(ctx);
      ctx.state.u7Before = m;
      ctx.state.rmWindow = resourceManagerWindow(m.windows as WindowInfo[], ctx.state.wbPid!);
      return {
        status: "observed",
        summary: `net p50 ${(m.net as { p50: number | null }).p50} ms, gui p50 ${(m.gui as { p50: number | null }).p50} ms; Resource Manager window ${ctx.state.rmWindow ? `class ${ctx.state.rmWindow.className}` : "not found by title"}`,
        data: { state: summarizeCall(st), ...m, resourceManagerWindow: ctx.state.rmWindow },
      };
    },
  });
  steps.push({
    id: "sc-06-u7-walk",
    title:
      "U7 walk: the passive accessibility walker (tools/uia/walk.ts, another author's) on the Resource Manager window",
    risk: "read-only",
    answers: u7,
    timeout_ms: TIMEOUTS.walker,
    expected:
      "[unverified] the walker exits 0 and its last line is its one-line JSON summary; its tree file lands in the artifacts folder",
    kill_criterion:
      "the walker exceeds 600 s: stop (no retry); without --walker-cmd, or when no window title names the Resource Manager, the run hands off (exit 5) for the main session to pick the window (walker.md step B) and run the walker by hand",
    side_effects: [
      "a UI Automation client attaches to Workbench (its cost is what sc-07 measures)",
    ],
    rollback: "none needed; the walk is passive (no invoke, no key)",
    skipWhen: u7SkipWhen,
    // Read from sc-05's result too: sc-06 runs in its own invocation (DEC-032 M4).
    skip: (ctx) => u7Skipped(ctx),
    outline: [
      "run the walker command line given with --walker-cmd ({pid} {out} {class} {title} {label} substituted, label rm-noworld); the walker checks its own action plan and gate",
      "without --walker-cmd, or without a window whose title names the Resource Manager: hand off (exit 5)",
    ],
    plan: () => [walkReadAction("sc-06-u7-walk", u7, "Resource Manager")],
    run: async (ctx) => {
      const pid = ctx.state.wbPid!;
      const win = rmWindowOf(ctx);
      const out = join(ctx.opts.runDir, "u7-walk.json");
      if (!win) {
        throw new StopSession(
          "handoff",
          `no unowned window of pid ${pid} has a title naming the Resource Manager: choose it with walk.ts --list-windows (walker.md step B), run step C by hand with output ${out}, then resume with --from sc-07-u7-after --run-dir ${ctx.opts.runDir}`,
        );
      }
      if (!ctx.opts.walkerCmd) {
        throw new StopSession(
          "handoff",
          `run the walker on pid ${pid} (window class ${win.className}, title "${win.title}"), output ${out}, then resume with --from sc-07-u7-after --run-dir ${ctx.opts.runDir}`,
        );
      }
      const argv = walkerArgv(ctx.opts.walkerCmd, {
        pid,
        out,
        className: win.className,
        title: win.title,
        label: "rm-noworld",
        tsx: TSX_IMPORT,
      });
      const r = await ctx.deps.runWalker(argv, TIMEOUTS.walker);
      if (r.timedOut)
        throw new StopSession("timeout", `the walker ran past ${TIMEOUTS.walker} ms (not retried)`);
      let summary: unknown = null;
      try {
        summary = r.lastLine ? JSON.parse(r.lastLine) : null;
      } catch {
        summary = r.lastLine;
      }
      return {
        status: r.exitCode === 0 ? "observed" : "fail",
        summary: `walker exit ${r.exitCode}`,
        data: { argv, exitCode: r.exitCode, walkerSummary: summary },
      };
    },
  });
  steps.push({
    id: "sc-07-u7-after",
    title: "U7 after the walk: the same measurements; the difference is the attach cost",
    risk: "read-only",
    answers: u7,
    timeout_ms: measureBudget,
    expected: "[unverified] latency and stall p50 within twice the sc-05 values",
    kill_criterion: "a NET call unanswered in 10 s: stop; a WM_NULL unanswered in 5 s: stop",
    side_effects: [],
    rollback: "none needed",
    skipWhen: u7SkipWhen,
    skip: u7Skipped,
    outline: ["read sc-05's measurements from the run folder when resumed with --from"],
    plan: () => measurePlan("sc-07-u7-after"),
    run: async (ctx) => {
      const out = await compareWithBefore(ctx);
      ctx.state.u7AfterAt = ctx.deps.now();
      return out;
    },
  });
  steps.push({
    id: "sc-07b-u7-later",
    title:
      "U7 later: the same measurements five minutes after the walk (does the attach cost last the session, L667)",
    risk: "read-only",
    answers: u7,
    timeout_ms: U7_LATER_MS + measureBudget,
    expected: "[unverified] latency and stall back within the sc-05 spread",
    kill_criterion: "a NET call unanswered in 10 s: stop; a WM_NULL unanswered in 5 s: stop",
    side_effects: [],
    rollback: "none needed",
    skipWhen: u7SkipWhen,
    skip: u7Skipped,
    outline: ["wait until five minutes after sc-07 (heartbeat every 5 s, no NET call meanwhile)"],
    plan: () => measurePlan("sc-07b-u7-later"),
    run: async (ctx) => {
      const until = (ctx.state.u7AfterAt ?? ctx.deps.now()) + U7_LATER_MS;
      while (ctx.deps.now() < until) {
        ctx.deps.heartbeat();
        await ctx.deps.sleep(TIMEOUTS.poll);
      }
      return compareWithBefore(ctx);
    },
  });

  // ── reversible ────────────────────────────────────────────────────────────
  const gui = [
    E("gui-census-feasibility-L684"),
    E("plugins-netapi-cli-L459"),
    E("script-string-dialogue-L410"),
    E("mcp-inventory-L263"),
    E("mcp-inventory-L378"),
    E("anim-procanim-behavior-L410"),
    ...P.display,
  ];
  const guiSpecs: CallSpec[] = [
    ...[
      "ResourceManager",
      "ScriptEditor",
      "Script Editor",
      "LocalizationEditor",
      "DialogueEditor",
      "ECEN_NoSuchModule",
    ].map((m) => ({
      apiFunc: "BringModuleWindowToFront",
      params: { ModuleName: m },
      timeoutMs: TIMEOUTS.gui,
      note: `ModuleName ${m}`,
    })),
    ...[
      VANILLA.script,
      VANILLA.conf,
      VANILLA.layout,
      VANILLA.emat,
      VANILLA.xob,
      "UI/ECEN_SC_absent.st",
      "UI/ECEN_SC_absent.dlg",
    ].map((f) => ({
      apiFunc: "OpenResource",
      params: { ResourceName: f },
      timeoutMs: TIMEOUTS.gui,
      note: f,
    })),
  ];
  steps.push({
    id: "sc-08-natives-gui",
    title:
      "Native NET functions that open or raise windows: BringModuleWindowToFront, OpenResource",
    risk: "reversible",
    answers: gui,
    // each call, with the window list before it and the modal check after it
    timeout_ms: guiSpecs.length * (TIMEOUTS.gui + 2 * HELPER.windows),
    expected:
      "[unverified] class names (ScriptEditor) accepted, display names refused or accepted (recorded); OpenResource answers {Opened} and the new window title names the editor each file type opens in; absent files answer Opened false",
    kill_criterion:
      "a call unanswered in 60 s: stop; after a call, a Workbench window turned disabled, or a new owned or dialog-class window whose title does not name the module or file asked for (an error box or a prompt): stop, nothing is clicked",
    side_effects: [
      "module windows open or come to the front (Script Editor, Localization Editor, config, layout, material and model views)",
    ],
    rollback:
      "none needed: nothing is edited; the U29 graceful close ends the process and every module window with it. Workbench may reopen its last resource at the relaunch (the exe has -noOpenLastResource); sc-09 records which of these windows came back",
    outline: [
      "after each call: list the Workbench windows (which editor opened, modal check, monitor placement)",
    ],
    plan: () => guiSpecs.map((s) => net("sc-08-natives-gui", gui, s)),
    run: async (ctx) => {
      const per: Array<Record<string, unknown>> = [];
      for (const s of guiSpecs) {
        const before = await ctx.ourWindows();
        const r = await ctx.call(s);
        const asked = String(s.params.ModuleName ?? s.params.ResourceName ?? "");
        const after = await ctx.modalCheck(s.note ?? s.apiFunc, (w) => titleNames(w, asked));
        const added = windowChanges(before, after, ctx.state.wbPid!).added;
        per.push({ params: s.params, ...summarizeCall(r), newWindows: added });
      }
      return {
        status: "observed",
        summary: `${per.filter((x) => x.ok).length} of ${per.length} calls answered Ok`,
        data: { calls: per },
      };
    },
  });
  for (const h of BI_REVERSIBLE) steps.push(biStep(h, "reversible", [...P.u26]));

  const u29 = [...P.u29];
  // world-editor-L490 asks about a link opened in a RUNNING Workbench: sc-10 only.
  const u29Cold = u29.filter((x) => x !== E("world-editor-L490"));
  steps.push({
    id: "sc-09-u29-cold",
    title:
      "U29 cold start: close Workbench, relaunch with -gproj <sandbox> -uri=<vanilla Resource Manager link>",
    risk: "reversible",
    answers: u29Cold,
    // close 120 s + port free 60 s + session log 120 s + listen 300 s
    // + compile 300 s (+ the last 10 s call) + GetLoadedProjects 30 s
    timeout_ms:
      TIMEOUTS.close +
      TIMEOUTS.gui +
      TIMEOUTS.sessionLog +
      2 * TIMEOUTS.ready +
      TIMEOUTS.cheap +
      TIMEOUTS.bohemia +
      // helpers: the close's image check, PowerShell slack and hazard list; the CrashReporter list;
      // the port poll, the log poll's window list and the listener poll overrunning once; the
      // baseline; the relaunched pid's creation time for the started marker
      (HELPER.process + 30_000 + HELPER.windows) +
      HELPER.process +
      HELPER.process +
      HELPER.windows +
      2 * HELPER.process +
      HELPER.windows +
      HELPER.table,
    expected: `[unverified] Workbench opens the sandbox (asserted from the new session log and GetLoadedProjects) and a window for the linked vanilla config (${VANILLA.coldConf}, which no earlier step opened, so its window is the link's doing and not a reopened last resource); the window list also shows which sc-08 windows Workbench reopened by itself`,
    kill_criterion:
      "Workbench does not exit within 120 s of CloseMainWindow (a hazard dialog: reported, never answered): stop; the NET port still held 60 s after the exit (an orphaned CrashReporter.exe is reported, never killed): stop; no session log names a project within 180 s: stop; another project (log or GetLoadedProjects) or the launcher window: abort and close the new Workbench; not listening within 300 s or scripts not compiled: stop; a disabled, owned or dialog-class window in the new window baseline: stop",
    side_effects: [
      "Workbench restarts (new pid recorded in the lease, new session log)",
      "Workbench writes its settings at the graceful exit (the post-flight registry compare sees it)",
    ],
    rollback: "none needed when the sandbox opened; otherwise the abort closes the new Workbench",
    outline: [
      "CloseMainWindow on the recorded pid, wait 120 s; never a kill",
      "wait up to 60 s for the NET port to be free; report an orphaned CrashReporter.exe (never killed)",
      `launch: -gproj <sandbox gproj> -forceSettings <scratch.ini> -uri=${U29_COLD_LINK} (working directory <game>); the pid is recorded in the lease`,
      "assert the new session log names the sandbox; wait for the port; ScriptsCompiled; GetLoadedProjects names the sandbox",
      "list the new Workbench windows (new baseline, refused when it holds a modal or a dialog): a window naming the linked config, and any sc-08 window Workbench reopened",
    ],
    plan: (p) => [
      launchAction(
        "sc-09-u29-cold",
        u29Cold,
        p.paths.gproj,
        p.forceSettings,
        `-uri=${U29_COLD_LINK}`,
        true,
      ),
      net("sc-09-u29-cold", u29Cold, {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "after relaunch, until ScriptsCompiled",
      }),
      net("sc-09-u29-cold", u29Cold, {
        apiFunc: "GetLoadedProjects",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
        note: "opened-project assertion",
      }),
    ],
    run: async (ctx) => {
      const old = ctx.state.wbPid!;
      const closed = await closeOurs(ctx, old);
      if (!closed.exited)
        throw new StopSession(
          "kill",
          `Workbench pid ${old} did not exit after CloseMainWindow: ${closed.detail}`,
        );
      const crash = ctx.deps.crashReporters();
      const freeBy = ctx.deps.now() + TIMEOUTS.gui;
      while (ctx.deps.portOwners().length > 0) {
        if (ctx.deps.now() >= freeBy) {
          throw new StopSession(
            "kill",
            `the NET port is still held by pid ${ctx.deps.portOwners().join(", ")} after the close (orphaned ${CRASH_REPORTER_IMAGE}? pids ${crash.join(", ") || "none"}); not killed`,
          );
        }
        await ctx.deps.sleep(TIMEOUTS.poll);
      }
      const link = validateU29Link(U29_COLD_LINK);
      const launchedAt = ctx.deps.now();
      const pid = ctx.deps.launchRecorded([`-uri=${link}`]);
      ctx.state.startedPids.add(pid);
      ctx.state.wbPid = pid;
      // The marker now names the relaunched pid and its creation time (DEC-032 B1).
      await ctx.updateMarker(pid);
      const opened = await assertSessionLog(ctx, launchedAt, TIMEOUTS.sessionLog, pid);
      await waitPort(ctx, pid, TIMEOUTS.ready);
      await waitScriptsCompiled(ctx, TIMEOUTS.ready);
      const loaded = await assertLoadedProjects(ctx);
      // The link's window can be told from a reopened last resource only by its
      // target, which no earlier step opened; titles are matched by file name [unverified].
      const sc08Files = [
        ...guiSpecs
          .filter((s) => s.apiFunc === "OpenResource")
          .map((s) => String(s.params.ResourceName)),
        VANILLA.xob,
      ];
      const windows = await ctx.setBaseline("the U29 relaunch", (w) =>
        [VANILLA.coldConf, ...sc08Files].some((f) => titleNames(w, f)),
      );
      const linkedWindows = windows.filter((w) => titleNames(w, VANILLA.coldConf));
      const reopened = sc08Files.filter((f) => windows.some((w) => titleNames(w, f)));
      return {
        status: "observed",
        summary: `relaunched pid ${pid}, log names ${opened}; ${windows.length} windows; linked config ${linkedWindows.length ? "open" : "not seen"}; reopened from sc-08: ${reopened.join(", ") || "none"}`,
        data: {
          closedPid: old,
          crashReporters: crash,
          link,
          pid,
          sessionLogProject: opened,
          loaded,
          windows,
          linkedConfigWindows: linkedWindows,
          reopenedFromSc08: reopened,
        },
      };
    },
  });
  steps.push({
    id: "sc-10-u29-forward",
    title:
      "U29 forwarded: a second process with -gproj <sandbox> -uri=<vanilla Script Editor link> while Workbench runs (only with --u29-forward)",
    risk: "reversible",
    answers: u29,
    // the second process's exit 60 s + its graceful close 120 s + IsWorkbenchRunning 10 s
    // helpers: the windows before, the exit poll overrunning, the full window list, the launcher
    // check (a list and two image checks), the close (image, slack, hazard list), the modal check,
    // the baseline, the port owners
    timeout_ms:
      TIMEOUTS.forwardExit +
      TIMEOUTS.close +
      TIMEOUTS.cheap +
      HELPER.windows +
      HELPER.process +
      HELPER.windows +
      (HELPER.windows + 2 * HELPER.process) +
      (HELPER.process + 30_000 + HELPER.windows) +
      HELPER.windows +
      HELPER.windows +
      HELPER.process,
    expected: `[unverified] the second process hands the link to the running Workbench and exits by itself; the running Workbench keeps its NET port and answers; the Script Editor shows the linked vanilla script. RECORDED HAZARD (${FORWARD_HAZARD_REF}): a second spawn of the same Steam launcher stub was forwarded to the running instance, which dropped its NET session (ECONNRESET) and reopened the launcher picker with a DIFFERENT recent project preselected; the old launcher nudge then confirmed it. This script never confirms, clicks or sends a key; nobody confirms that picker`,
    kill_criterion:
      "a launcher window on ANY Workbench process (the first included) after the spawn: abort, nothing sent to the first Workbench, the owner must not confirm or click the picker (the second process is closed when the launcher is its own); the second process still running after 60 s with a dialog-class or owned window other than the launcher: stop, nothing sent; otherwise it is closed with CloseMainWindow (never killed), and not exiting within 120 s: stop; its session log naming another project: abort; a new modal or dialog on the first Workbench: stop before the next NET call; the first Workbench not answering in 10 s or not holding the port: stop",
    side_effects: [
      "a second Workbench process starts (not recorded in the lease); the Script Editor opens a vanilla script",
    ],
    rollback:
      "the second process is closed gracefully when it does not exit by itself and shows only its main window or the launcher; a dialog is never answered",
    skipWhen: {
      condition: `--u29-forward not given: the owner decides whether the forwarded case runs at all (${FORWARD_HAZARD_REF})`,
      carried_to: "a later sitting, if the owner allows the forwarded case",
    },
    skip: (ctx) =>
      ctx.opts.u29Forward
        ? null
        : `--u29-forward not given: the owner has not allowed the forwarded case (${FORWARD_HAZARD_REF})`,
    outline: [
      "skipped unless --u29-forward is given (the owner's call; the recorded hazard is in this step's expected)",
      `start a second process: -gproj <sandbox gproj> -forceSettings <scratch.ini> -uri=${U29_FORWARD_LINK} (not recorded in the lease)`,
      "wait up to 60 s for it to exit; list the windows of every Workbench process: a launcher anywhere is the abort case",
      "if it stays: its windows and a newer session log are recorded; a dialog stops the run with nothing sent; otherwise CloseMainWindow on it (it is ours)",
      "modal check on the first Workbench, then one IsWorkbenchRunning and the port owner; new window baseline",
    ],
    plan: (p) =>
      p.u29Forward
        ? [
            launchAction(
              "sc-10-u29-forward",
              u29,
              p.paths.gproj,
              p.forceSettings,
              `-uri=${U29_FORWARD_LINK}`,
              false,
            ),
            net("sc-10-u29-forward", u29, {
              apiFunc: "IsWorkbenchRunning",
              params: {},
              timeoutMs: TIMEOUTS.cheap,
              note: "the running Workbench still answers",
            }),
          ]
        : [],
    run: async (ctx) => {
      const first = ctx.state.wbPid!;
      const link = validateU29Link(U29_FORWARD_LINK);
      const before = await ctx.ourWindows();
      const spawnedAt = ctx.deps.now();
      const second = ctx.deps.launchUnrecorded([`-uri=${link}`]);
      ctx.state.startedPids.add(second);
      const exited = await waitGone(ctx, second, TIMEOUTS.forwardExit);
      const all = await ctx.deps.listWindows();
      const secondWindows = all.filter((w) => w.pid === second);
      const launchers = await workbenchLaunchers(ctx);
      const isLauncher = (w: WindowInfo): boolean =>
        w.title.toLowerCase().includes(LAUNCHER_WINDOW_TITLE.toLowerCase());
      const secondDialogs = secondWindows.filter((w) => !isLauncher(w) && isDialogLike(w));
      if (launchers.length) {
        // The launcher is the one window the plan allows to be closed, and only
        // the second process's own: WM_CLOSE cancels a picker, it never confirms.
        let closedSecond: { exited: boolean; detail: string } | null = null;
        if (!exited && launchers.some((w) => w.pid === second) && !secondDialogs.length) {
          closedSecond = await closeOurs(ctx, second);
        }
        const where = [...new Set(launchers.map((w) => w.pid))]
          .map((p) => (p === first ? `the first Workbench ${p}` : `pid ${p}`))
          .join(", ");
        throw new StopSession(
          "abort",
          `the launcher picker is up on ${where} after the forwarded spawn (the recorded hazard: ${FORWARD_HAZARD_REF}); nothing was confirmed or clicked and nothing is sent to the first Workbench; the owner must NOT confirm the picker (its preselected project may be another one)${closedSecond ? `; the second process was closed (${closedSecond.detail})` : ""}`,
          null,
        );
      }
      let secondLog: string | null = null;
      let closedSecond: { exited: boolean; detail: string } | null = null;
      if (!exited) {
        if (secondDialogs.length) {
          throw new StopSession(
            "kill",
            `the second process ${second} shows a dialog (${secondDialogs.map((w) => `${w.className} "${w.title}"`).join(" | ")}); reported, never answered, nothing sent`,
          );
        }
        const log = ctx.deps.sessionLogAfter(spawnedAt);
        secondLog = log
          ? openedProjectFromLog(ctx.deps.readText(log), ctx.opts.openedProjectPattern)
          : null;
        closedSecond = await closeOurs(ctx, second);
        if (!closedSecond.exited)
          throw new StopSession(
            "kill",
            `the second process ${second} did not close: ${closedSecond.detail}`,
          );
        if (secondLog !== null && !namesSandbox(secondLog, ctx.opts.gproj)) {
          throw new StopSession("abort", `the second process opened ${secondLog} (closed)`, null);
        }
      }
      // The forwarded link may open a Script Editor window on the first
      // Workbench on purpose; anything else owned or dialog-class stops here.
      const after = await ctx.modalCheck("the forwarded link", (w) =>
        titleNames(w, VANILLA.script),
      );
      const alive = await ctx.call({
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      const owners = ctx.deps.portOwners();
      if (!alive.ok || !owners.includes(first)) {
        throw new StopSession(
          "kill",
          `the running Workbench ${first} no longer answers or holds the port (${alive.ok ? "answers" : alive.error}; owners ${owners.join(", ") || "none"})`,
        );
      }
      await ctx.setBaseline("after the U29 forward", (w) => titleNames(w, VANILLA.script));
      return {
        status: "observed",
        summary: exited
          ? "the second process exited by itself (forwarded or refused)"
          : "the second process stayed and was closed",
        data: {
          link,
          firstPid: first,
          secondPid: second,
          secondExitedBySelf: exited,
          secondWindows,
          secondLogProject: secondLog,
          closedSecond,
          newWindowsOfFirst: windowChanges(before, after, first).added,
          isWorkbenchRunning: summarizeCall(alive),
          portOwners: owners,
        },
      };
    },
  });

  steps.push({
    id: "sc-11-open-tiny-world",
    title: "Open the tiny world (OA-3) with the native OpenResource",
    risk: "reversible",
    answers: [...P.natives.filter((x) => x === E("mcp-inventory-L263"))],
    // the modal check and the World Editor title check are window lists
    timeout_ms: TIMEOUTS.openWorld + 2 * TIMEOUTS.cheap + TIMEOUTS.bohemia + 2 * HELPER.windows,
    needsTinyWorld: true,
    skipWhen: { condition: NO_TINY_WORLD, carried_to: "S-E" },
    expected:
      "Opened true; IsWorldEditorRunning IsRunning true; EMCP_WB_Ping mode edit; EMCP_WB_GetState entityCount at most 500",
    kill_criterion:
      "no answer in 120 s: stop; Opened false, mode not edit or more than 500 entities: stop; a Workbench window disabled: stop",
    side_effects: [
      "the World Editor opens the tiny world (unsaved edits follow in sc-12 and sc-13)",
    ],
    rollback: "none needed; the world is never saved",
    outline: [
      "skipped when --tiny-world is missing or its file is absent: U13 and U19 move to S-E",
    ],
    plan: (p) =>
      p.tinyWorldPresent && p.tinyWorldResource
        ? [
            net("sc-11-open-tiny-world", [], {
              apiFunc: "OpenResource",
              params: { ResourceName: p.tinyWorldResource },
              timeoutMs: TIMEOUTS.openWorld,
            }),
            net("sc-11-open-tiny-world", [], {
              apiFunc: "IsWorldEditorRunning",
              params: {},
              timeoutMs: TIMEOUTS.cheap,
            }),
            net("sc-11-open-tiny-world", [], {
              apiFunc: "EMCP_WB_Ping",
              params: {},
              timeoutMs: TIMEOUTS.cheap,
            }),
            net("sc-11-open-tiny-world", [], {
              apiFunc: "EMCP_WB_GetState",
              params: {},
              timeoutMs: TIMEOUTS.bohemia,
            }),
          ]
        : [],
    run: async (ctx) => {
      const res = tinyWorldResource(ctx.opts.tinyWorld!);
      const o = await ctx.call({
        apiFunc: "OpenResource",
        params: { ResourceName: res },
        timeoutMs: TIMEOUTS.openWorld,
      });
      // The World Editor window that shows the world is expected, owned or not.
      await ctx.modalCheck(
        "OpenResource tiny world",
        (w) => titleNames(w, res) || titleNames(w, "WorldEditor"),
      );
      // DEC-032 (S-C read m11): does the World Editor show the sandbox's world? Only its title can
      // say (EMCP_WB_GetState names no world); sc-12 and sc-13 edit only a world confirmed so.
      const weWin = worldEditorWindow(await ctx.ourWindows(), ctx.state.wbPid!);
      const worldTitleNamesTiny = weWin !== null && titleNames(weWin, res);
      const we = await ctx.call({
        apiFunc: "IsWorldEditorRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      const ping = await ctx.call({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      const st = await ctx.call({
        apiFunc: "EMCP_WB_GetState",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
      });
      const count = Number(field(st.response, "entityCount"));
      const problems = [
        field(o.response, "Opened") !== true
          ? `Opened ${JSON.stringify(field(o.response, "Opened") ?? o.error)}`
          : null,
        field(ping.response, "mode") !== "edit"
          ? `mode ${JSON.stringify(field(ping.response, "mode") ?? ping.error)}`
          : null,
        !(count <= TINY_WORLD_MAX_ENTITIES)
          ? `entityCount ${field(st.response, "entityCount")}`
          : null,
      ].filter(Boolean);
      if (problems.length)
        throw new StopSession(
          "kill",
          `the tiny world is not open as expected: ${problems.join("; ")}`,
        );
      return {
        status: "pass",
        summary: `tiny world open, ${count} entities; the World Editor title ${worldTitleNamesTiny ? "names it" : "does NOT name it (sc-12 and sc-13 then edit nothing without --world-title-unchecked)"}`,
        data: {
          resource: res,
          worldTitleNamesTiny,
          worldEditorTitle: weWin?.title ?? null,
          openResource: summarizeCall(o),
          isWorldEditorRunning: summarizeCall(we),
          ping: summarizeCall(ping),
          state: summarizeCall(st),
        },
      };
    },
  });

  // walker.md step G: the World Editor window, right after the tiny world is open.
  const weWalk = ["P-U7", E("world-editor-L484")];
  const weWalkSkipWhen = {
    condition: `${NO_TINY_WORLD}; or the Resource Manager walk (sc-06) did not end observed and clean (skipped, handed off, failed, or stopped on a timeout, a hung window or an unresponsive provider)`,
    carried_to: "P4-census (L06), or by hand in the sitting (walker.md step G)",
  };
  steps.push({
    id: "sc-11b-u7-walk-world",
    title:
      "U7 on the World Editor window: the passive walker on the tiny world's World Editor window (walker.md step G; world-editor-L484)",
    // Its own effect is a read; classed reversible because it follows sc-11 (plan 5.3 step 7 order).
    risk: "reversible",
    answers: weWalk,
    timeout_ms: TIMEOUTS.walker + TIMEOUTS.cheap + HELPER.windows,
    needsTinyWorld: true,
    skipWhen: weWalkSkipWhen,
    expected:
      "[unverified] the walker exits 0 on the one unowned window of the lane's pid whose title names the World Editor (not the Resource Manager); its summary shows completed true, or stop_reason max-nodes or budget with partial false, hung_true 0; one EMCP_WB_Ping answers after the walk",
    kill_criterion:
      "the walker exceeds 600 s: stop (no retry); no single unowned World Editor window by title, or no --walker-cmd: hand off (exit 5) for the main session (walker.md step G); EMCP_WB_Ping unanswered in 10 s: stop",
    side_effects: [
      "a UI Automation client reads the World Editor window (Qt accessibility is already active since sc-06)",
    ],
    rollback: "none needed; the walk is passive (no invoke, no key)",
    skip: (ctx) => {
      const text = ctx.deps.readRunFile("sc-06-u7-walk.json");
      if (!text) return "no result of the Resource Manager walk (sc-06) in the run folder";
      const prior = JSON.parse(text) as {
        status?: string;
        data?: { walkerSummary?: { stop_reason?: string | null } | null };
      };
      const stop = prior.data?.walkerSummary?.stop_reason ?? null;
      if (prior.status !== "observed") return `sc-06 ended ${prior.status ?? "without a status"}`;
      if (stop === "timeout" || stop === "hung" || stop === "unresponsive") {
        return `sc-06's walk stopped on ${stop} (walker.md: step G runs only after a clean walk)`;
      }
      return null;
    },
    outline: [
      "list the Workbench windows (Win32 only); the walker's window is the one unowned window of the lane's pid whose title names the World Editor and not the Resource Manager (walker.md step G1)",
      "run the walker command line given with --walker-cmd ({pid} {out} {class} {title} {label} substituted, label we-tinyworld); the walker checks its own action plan and gate (step G2)",
      "one EMCP_WB_Ping after the walk (step G3)",
      "without --walker-cmd, or without exactly one such window: hand off (exit 5)",
    ],
    plan: (p) =>
      p.tinyWorldPresent
        ? [
            walkReadAction("sc-11b-u7-walk-world", weWalk, "World Editor"),
            net("sc-11b-u7-walk-world", weWalk, {
              apiFunc: "EMCP_WB_Ping",
              params: {},
              timeoutMs: TIMEOUTS.cheap,
              note: "latency after the second attach (walker.md step G3)",
            }),
          ]
        : [],
    run: async (ctx) => {
      const pid = ctx.state.wbPid!;
      const out = join(ctx.opts.runDir, "u7-walk-world.json");
      const windows = await ctx.ourWindows();
      const win = worldEditorWindow(windows, pid);
      const resume = `then resume with --from sc-12-u19-undo --run-dir ${ctx.opts.runDir}`;
      if (!win) {
        throw new StopSession(
          "handoff",
          `not exactly one unowned window of pid ${pid} has a title naming the World Editor: choose it with walk.ts --list-windows (walker.md step G1), run step G2 by hand with output ${out}, ${resume}`,
        );
      }
      if (!ctx.opts.walkerCmd) {
        throw new StopSession(
          "handoff",
          `run the walker on pid ${pid} (window class ${win.className}, title "${win.title}", label we-tinyworld), output ${out}, ${resume}`,
        );
      }
      const argv = walkerArgv(ctx.opts.walkerCmd, {
        pid,
        out,
        className: win.className,
        title: win.title,
        label: "we-tinyworld",
        tsx: TSX_IMPORT,
      });
      const r = await ctx.deps.runWalker(argv, TIMEOUTS.walker);
      if (r.timedOut)
        throw new StopSession("timeout", `the walker ran past ${TIMEOUTS.walker} ms (not retried)`);
      let summary: unknown = null;
      try {
        summary = r.lastLine ? JSON.parse(r.lastLine) : null;
      } catch {
        summary = r.lastLine;
      }
      const ping = await ctx.call({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "latency after the second attach (walker.md step G3)",
      });
      return {
        status: r.exitCode === 0 ? "observed" : "fail",
        summary: `walker exit ${r.exitCode} on the World Editor window; EMCP_WB_Ping ${ping.ok ? `${ping.durationMs} ms` : "failed"}`,
        data: {
          argv,
          window: win,
          exitCode: r.exitCode,
          walkerSummary: summary,
          ping: summarizeCall(ping),
        },
      };
    },
  });

  /** sc-12 and sc-13 edit only a world sc-11 saw by title (DEC-032, S-C read m11). */
  const worldUnconfirmed = (ctx: RunContext): string | null => {
    if (ctx.opts.worldTitleUnchecked) return null;
    const r = runJson<{ data?: { worldTitleNamesTiny?: boolean } }>(
      ctx,
      "sc-11-open-tiny-world.json",
    );
    if (r?.data?.worldTitleNamesTiny === true) return null;
    return (
      "the World Editor title did not name the tiny world at sc-11 (or sc-11 has no result): nothing is " +
      "edited in a world not shown to be the sandbox's; running anyway (--world-title-unchecked) is the main session's call"
    );
  };
  const u19 = [...P.u19];
  steps.push({
    id: "sc-12-u19-undo",
    title: "U19: do handler edits land on the undo stack? Create, undo, check (shipped handlers)",
    risk: "reversible",
    answers: u19,
    // create, read, undo, read, delete, read; two modal checks
    timeout_ms: 6 * TIMEOUTS.bohemia + 2 * HELPER.windows,
    needsTinyWorld: true,
    skipWhen: {
      condition: `${NO_TINY_WORLD}, or ["Edit","Undo"] is not on execute_action.allow_list (the shipped undo runs WorldEditor.ExecuteAction), or the World Editor title did not name the tiny world at sc-11 (without --world-title-unchecked)`,
      carried_to: "S-E",
    },
    skip: (ctx) =>
      allowListed(ctx.opts.policy, UNDO_PATH)
        ? worldUnconfirmed(ctx)
        : '["Edit","Undo"] is not on execute_action.allow_list; the undo runs WorldEditor.ExecuteAction (plan 5.3)',
    expected:
      "[unverified] EMCP_WB_CreateEntity (BeginEntityAction/EndEntityAction) creates the prop; EMCP_WB_EditorControl undo (WorldEditor.ExecuteAction Edit > Undo) answers ok and the entity is gone (U19 yes); still present means U19 no",
    kill_criterion:
      "a call unanswered in 30 s: stop; the entity still present after the rollback delete: stop; a Workbench window disabled: stop",
    side_effects: [
      "one prop entity (vanilla GlassBeer_01) exists in the unsaved tiny world until undone or deleted",
    ],
    rollback:
      "EMCP_WB_DeleteEntity on the entity when the undo left it; the world is never saved (the owner answers the save prompt at the post-flight close with Don't Save)",
    outline: [
      'skipped without the tiny world, or while ["Edit","Undo"] is not on execute_action.allow_list (the undo runs WorldEditor.ExecuteAction)',
    ],
    plan: (p) => {
      if (!p.tinyWorldPresent || !p.undoAllowed) return [];
      const name = `ECEN_SC_U19_${p.nonce}`;
      return [
        net("sc-12-u19-undo", u19, {
          apiFunc: "EMCP_WB_CreateEntity",
          params: { prefab: VANILLA.propRef, name, position: "0 0 0" },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        net("sc-12-u19-undo", u19, {
          apiFunc: "EMCP_WB_GetEntity",
          params: { name },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        net("sc-12-u19-undo", u19, {
          apiFunc: "EMCP_WB_EditorControl",
          params: { action: "undo" },
          timeoutMs: TIMEOUTS.bohemia,
        }),
        {
          kind: "execute-action",
          target: { path: [...UNDO_PATH], module: "WorldEditor" },
          step: "sc-12-u19-undo",
          probes: u19,
          via: "EMCP_WB_EditorControl {action: undo}",
        },
        net("sc-12-u19-undo", u19, {
          apiFunc: "EMCP_WB_GetEntity",
          params: { name },
          timeoutMs: TIMEOUTS.bohemia,
          note: "after undo",
        }),
        net("sc-12-u19-undo", u19, {
          apiFunc: "EMCP_WB_DeleteEntity",
          params: { name },
          timeoutMs: TIMEOUTS.bohemia,
          note: "rollback, only when the entity is still there",
        }),
      ];
    },
    run: async (ctx) => {
      // The engine skips this step first (skip above); this guard only keeps
      // the run from ever sending an ExecuteAction the policy does not allow.
      if (!allowListed(ctx.opts.policy, UNDO_PATH)) {
        throw new Error("sc-12 reached without Edit > Undo on the allow-list");
      }
      const name = `ECEN_SC_U19_${ctx.opts.nonce}`;
      const owed = `EMCP_WB_DeleteEntity {"name":"${name}"} (U19 entity in the unsaved tiny world)`;
      ctx.state.pendingRollback.push(owed);
      const created = await ctx.call({
        apiFunc: "EMCP_WB_CreateEntity",
        params: { prefab: VANILLA.propRef, name, position: "0 0 0" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("CreateEntity");
      const exists = await entityExists(ctx, name);
      let undo: RawCallResult | null = null;
      let afterUndo: boolean | null = null;
      if (exists) {
        undo = await ctx.call({
          apiFunc: "EMCP_WB_EditorControl",
          params: { action: "undo" },
          timeoutMs: TIMEOUTS.bohemia,
        });
        await ctx.modalCheck("undo");
        afterUndo = await entityExists(ctx, name);
        if (afterUndo) await removeEntity(ctx, name);
      }
      settleRollback(ctx, owed);
      const verdict = !exists
        ? "create failed"
        : afterUndo === false
          ? "undo removed the entity (U19 yes)"
          : "the entity survived the undo (U19 no)";
      return {
        status: "observed",
        summary: verdict,
        data: {
          name,
          created: summarizeCall(created),
          existedAfterCreate: exists,
          undo: undo && summarizeCall(undo),
          existsAfterUndo: afterUndo,
        },
      };
    },
  });

  const u13 = [...P.u13.filter((x) => x !== E("mcp-inventory-L348"))];
  steps.push({
    id: "sc-13-u13-component",
    title: 'U13: one component property write with the existing propertyPath "components[i]"',
    risk: "reversible",
    answers: u13,
    // create, list, read, write, read, delete, read; two modal checks
    timeout_ms: 7 * TIMEOUTS.bohemia + 2 * HELPER.windows,
    needsTinyWorld: true,
    skipWhen: {
      condition: `${NO_TINY_WORLD}, or the World Editor title did not name the tiny world at sc-11 (without --world-title-unchecked)`,
      carried_to: "S-E",
    },
    skip: (ctx) => worldUnconfirmed(ctx),
    expected:
      '[unverified] either status ok and the read-back equals the written value (U13 yes: fix only the class-to-index mapping), or "SetVariableValue returned false" (U13 no: S-E tries ModifyComponentKey)',
    kill_criterion:
      "a call unanswered in 30 s: stop; the component class absent from the created entity: fail, rollback; the entity still present after the rollback delete: stop",
    side_effects: [
      "one base-character entity exists in the unsaved tiny world until the rollback deletes it",
    ],
    rollback: "EMCP_WB_DeleteEntity on the created entity, always; the world is never saved",
    outline: [
      "the write is ONE EMCP_WB_ModifyEntity setProperty call; create, list, read and delete surround it",
    ],
    plan: (p) => {
      if (!p.tinyWorldPresent) return [];
      const name = `ECEN_SC_U13_${p.nonce}`;
      const s = (apiFunc: string, params: Record<string, unknown>, note?: string): PlanAction =>
        net("sc-13-u13-component", u13, { apiFunc, params, timeoutMs: TIMEOUTS.bohemia, note });
      return [
        s("EMCP_WB_CreateEntity", { prefab: p.u13.prefab, name, position: "2 0 2" }),
        s("EMCP_WB_Components", { entityName: name, action: "list" }),
        s(
          "EMCP_WB_ModifyEntity",
          { name, action: "getProperty", propertyPath: p.u13.component, propertyKey: p.u13.key },
          "original value",
        ),
        s(
          "EMCP_WB_ModifyEntity",
          {
            name,
            action: "setProperty",
            propertyPath: "components[<index from the list>]",
            propertyKey: p.u13.key,
            value: p.u13.value,
          },
          "THE U13 write",
        ),
        s(
          "EMCP_WB_ModifyEntity",
          { name, action: "getProperty", propertyPath: p.u13.component, propertyKey: p.u13.key },
          "read-back",
        ),
        s("EMCP_WB_DeleteEntity", { name }, "rollback"),
        s("EMCP_WB_GetEntity", { name }, "confirm gone"),
      ];
    },
    run: async (ctx) => {
      const u = ctx.opts.u13;
      const name = `ECEN_SC_U13_${ctx.opts.nonce}`;
      const owed = `EMCP_WB_DeleteEntity {"name":"${name}"} (U13 entity in the unsaved tiny world)`;
      ctx.state.pendingRollback.push(owed);
      const created = await ctx.call({
        apiFunc: "EMCP_WB_CreateEntity",
        params: { prefab: u.prefab, name, position: "2 0 2" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      await ctx.modalCheck("CreateEntity");
      if (!created.ok || field(created.response, "status") !== "ok") {
        if (!(await entityExists(ctx, name))) settleRollback(ctx, owed);
        else await removeEntityOwed(ctx, name, owed);
        return {
          status: "fail",
          summary: `could not create the entity: ${created.error ?? JSON.stringify(created.response)}`,
          data: { created: summarizeCall(created) },
        };
      }
      const data: Record<string, unknown> = { name, created: summarizeCall(created) };
      const list = await ctx.call({
        apiFunc: "EMCP_WB_Components",
        params: { entityName: name, action: "list" },
        timeoutMs: TIMEOUTS.bohemia,
      });
      const index = componentIndex(list.response, u.component);
      data.components = summarizeCall(list);
      data.index = index;
      if (index < 0) {
        await removeEntityOwed(ctx, name, owed);
        return { status: "fail", summary: `${u.component} not on the entity`, data };
      }
      const get = (note: string): Promise<RawCallResult> =>
        ctx.call({
          apiFunc: "EMCP_WB_ModifyEntity",
          params: { name, action: "getProperty", propertyPath: u.component, propertyKey: u.key },
          timeoutMs: TIMEOUTS.bohemia,
          note,
        });
      data.original = summarizeCall(await get("original value"));
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
      data.write = summarizeCall(set);
      const back = await get("read-back");
      data.readBack = summarizeCall(back);
      await removeEntityOwed(ctx, name, owed);
      const wrote = field(set.response, "status") === "ok";
      const matches = Number(field(back.response, "message")) === Number(u.value);
      data.verdict =
        wrote && matches ? "U13 yes" : wrote ? "status ok but the read-back differs" : "U13 no";
      return { status: "observed", summary: String(data.verdict), data };
    },
  });

  const u3 = [...P.u3, E("world-editor-L475")];
  const configs = ["WORKBENCH", "PC", "HEADLESS"];
  steps.push({
    id: "sc-14-u3-clean",
    title:
      "U3 clean: native ValidateScripts for WORKBENCH, PC and HEADLESS, detached with a poll loop",
    risk: "reversible",
    answers: u3,
    timeout_ms: configs.length * detachedBudgetMs(TIMEOUTS.validate),
    expected:
      "[unverified] status Ok and {Errors: [], Warnings: [...], Success: true} per configuration (NetApiDocs.c#L112); the duration is recorded and the 10 s client default is judged against it",
    kill_criterion:
      "a call without a result after 600 s (plus 30 s grace): stop, no retry, the child left running and its pid reported",
    side_effects: [
      "Workbench compiles scripts in memory (expected to write nothing; classed reversible only because the plan places it after the world edits)",
    ],
    rollback: "none needed",
    outline: [
      "each call runs in a detached child of this script; the parent polls every 5 s, heartbeats the lease, samples the GUI stall and lists the Workbench windows",
    ],
    plan: () =>
      configs.map((c) =>
        net(
          "sc-14-u3-clean",
          u3,
          {
            apiFunc: "ValidateScripts",
            params: { Configuration: c },
            timeoutMs: TIMEOUTS.validate,
          },
          { detached: true },
        ),
      ),
    run: async (ctx) => {
      const per: Record<string, unknown> = {};
      for (const c of configs) {
        const r = await ctx.detached(
          {
            apiFunc: "ValidateScripts",
            params: { Configuration: c },
            timeoutMs: TIMEOUTS.validate,
          },
          `u3-clean-${c}`,
        );
        // A compile-error box or a VM exception dialog stops before the next NET call (DEC-032 m4).
        await ctx.modalCheck(`ValidateScripts ${c}`);
        per[c] = {
          ...summarizeCall(r),
          ...fieldDiff(r.response, ["Errors", "Warnings", "Success"]),
        };
      }
      return {
        status: "observed",
        summary: configs
          .map((c) => `${c} ${(per[c] as { ok: boolean }).ok ? "Ok" : "error"}`)
          .join(", "),
        data: per,
      };
    },
  });

  steps.push({
    id: "sc-15-u3-planted",
    title: "U3 planted: a syntax error in a COPY of a handler outside the installed handler folder",
    risk: "mutating",
    answers: u3,
    timeout_ms: detachedBudgetMs(TIMEOUTS.validate),
    expected:
      "[unverified] Success false and an Errors entry whose file names ECEN_SC_U3_Planted.c (ValidateScripts compile-checks on-disk files: U3 yes); Success true means it does not see the file",
    kill_criterion:
      "no result after 600 s: stop (the planted file is removed first); the planted file still on disk after its removal: stop (it must never reach U4 or a relaunch)",
    side_effects: [
      `<sandbox>/Scripts/WorkbenchGame/${U3_PLANT_FOLDER}/${U3_PLANT_FILE} exists during the call`,
    ],
    rollback:
      "the file and its folder are removed in a finally block, then checked gone; the post-flight snapshot diff confirms",
    outline: [
      `write <sandbox>/Scripts/WorkbenchGame/${U3_PLANT_FOLDER}/${U3_PLANT_FILE} (create-only): the shipped ${PING_FILE} with its classes renamed ECEN_SC_U3Ping* and an unclosed parameter list appended`,
      "ValidateScripts WORKBENCH (detached, poll loop)",
      "remove the file and the folder; check both are gone",
    ],
    plan: () => [
      net(
        "sc-15-u3-planted",
        u3,
        {
          apiFunc: "ValidateScripts",
          params: { Configuration: "WORKBENCH" },
          timeoutMs: TIMEOUTS.validate,
        },
        { detached: true },
      ),
    ],
    run: async (ctx) => {
      const dir = join(ctx.opts.sandboxDir, "Scripts", "WorkbenchGame", U3_PLANT_FOLDER);
      const file = join(dir, U3_PLANT_FILE);
      if (
        !insideDir(ctx.opts.sandboxDir, file) ||
        insideDir(join(ctx.opts.sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER), file)
      ) {
        throw new StopSession(
          "kill",
          "the planted copy would land outside the sandbox or inside the installed handler folder",
        );
      }
      const source = plantedSource(
        ctx.deps.readBytes(join(BUNDLED_HANDLER_DIR, PING_FILE)).toString("utf-8"),
      );
      // The plant record, before anything is written (DEC-032, S-C read B1): the rollback subcommand
      // removes what it names when the script is cut off before its own removal.
      ctx.deps.writeArtifact("plant-sc-15.json", {
        step: "sc-15-u3-planted",
        folder: `Scripts/WorkbenchGame/${U3_PLANT_FOLDER}`,
        file: U3_PLANT_FILE,
        sha256: sha256Hex(source),
        folderExisted: ctx.deps.fileExists(dir),
      });
      ctx.deps.makeDir(dir);
      // The file is removed whatever happens; a failed removal after a timeout
      // keeps the timeout as the stop's kind and names the file too.
      const r = await withRestore(
        async () => {
          ctx.deps.writeBytes(file, Buffer.from(source, "utf-8"), true);
          return ctx.detached(
            {
              apiFunc: "ValidateScripts",
              params: { Configuration: "WORKBENCH" },
              timeoutMs: TIMEOUTS.validate,
            },
            "u3-planted",
          );
        },
        () => {
          removePlanted(ctx, dir, file);
          ctx.deps.writeArtifact("rollback-sc-15.json", { ok: true, by: "sc-15-u3-planted" });
        },
      );
      await ctx.modalCheck("ValidateScripts with the planted file");
      const errors = field(r.response, "Errors");
      const seen =
        Array.isArray(errors) && errors.some((e) => JSON.stringify(e).includes(U3_PLANT_FILE));
      return {
        status: "observed",
        summary: seen
          ? "the planted error is reported (U3: on-disk files are checked)"
          : "the planted error is not reported",
        data: { file, call: summarizeCall(r), plantedErrorReported: seen },
      };
    },
  });

  const u4 = [...P.u4.filter((x) => x !== E("script-string-dialogue-L406"))];
  steps.push({
    id: "sc-16-u4-reload",
    title:
      "U4 LAST: native ReloadScripts after one handler string edit, detached with a long timeout",
    risk: "mutating",
    answers: u4,
    timeout_ms: TIMEOUTS.cheap + detachedBudgetMs(TIMEOUTS.reload) + 2 * TIMEOUTS.bohemia,
    expected:
      '[unverified] status Ok or "Compilation failed" (NetApiDocs.c#L146); afterwards EMCP_WB_Ping answers with the marker (edited handlers came alive: U4 yes), without it (handlers kept, not recompiled), or not at all (handlers lost). One reload was recorded at over seven minutes with the socket held',
    kill_criterion:
      "no result after 900 s (plus 30 s grace): stop, no retry; the installed EMCP_WB_Ping.c differs from the bundle before the edit: stop before editing",
    side_effects: [
      `the installed <sandbox>/Scripts/WorkbenchGame/${HANDLER_FOLDER}/${PING_FILE} carries a marker during the call`,
      "Workbench may be left without handlers (this is why it runs last)",
    ],
    rollback: `the installed ${PING_FILE} is restored from the bundle in a finally block and checked byte-equal; the next pre-flight --install-handlers reinstalls the set`,
    outline: [
      `check the installed ${PING_FILE} equals the bundle; write it with "${PING_MARKER_TEXT} [S-C U4 <nonce>]"`,
      "ReloadScripts (detached child, 900 s, poll every 5 s with the window list and GUI stall)",
      "IsWorkbenchRunning and EMCP_WB_Ping (one each), then restore the file",
    ],
    plan: () => [
      net("sc-16-u4-reload", u4, {
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "before",
      }),
      net(
        "sc-16-u4-reload",
        u4,
        { apiFunc: "ReloadScripts", params: {}, timeoutMs: TIMEOUTS.reload },
        { detached: true },
      ),
      net("sc-16-u4-reload", u4, {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
        note: "after",
      }),
      net("sc-16-u4-reload", u4, {
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.bohemia,
        note: "after: marker?",
      }),
    ],
    run: async (ctx) => {
      const installed = join(
        ctx.opts.sandboxDir,
        "Scripts",
        "WorkbenchGame",
        HANDLER_FOLDER,
        PING_FILE,
      );
      const bundle = ctx.deps.readBytes(join(BUNDLED_HANDLER_DIR, PING_FILE));
      const original = ctx.deps.readBytes(installed);
      if (!original.equals(bundle))
        throw new StopSession(
          "kill",
          `the installed ${PING_FILE} differs from the bundle; nothing edited`,
        );
      const marker = `[S-C U4 ${ctx.opts.nonce}]`;
      const edited = Buffer.from(editPingSource(original.toString("utf-8"), marker), "utf-8");
      // The edit record, before the file is changed (DEC-032, S-C read B1).
      ctx.deps.writeArtifact("plant-sc-16.json", {
        step: "sc-16-u4-reload",
        file: `Scripts/WorkbenchGame/${HANDLER_FOLDER}/${PING_FILE}`,
        bundleSha256: sha256Hex(bundle),
        editedSha256: sha256Hex(edited),
      });
      const before = await ctx.call({
        apiFunc: "EMCP_WB_Ping",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      // The file is restored whatever happens; a failed restore after a
      // timeout keeps the timeout as the stop's kind and names the file too.
      const { reload, after, ping } = await withRestore(
        async () => {
          ctx.deps.writeBytes(installed, edited, false);
          const reload = await ctx.detached(
            { apiFunc: "ReloadScripts", params: {}, timeoutMs: TIMEOUTS.reload },
            "u4-reload",
          );
          // A compile-error box or a VM exception dialog stops before the next NET call (m4).
          await ctx.modalCheck("ReloadScripts");
          const after = await ctx.call({
            apiFunc: "IsWorkbenchRunning",
            params: {},
            timeoutMs: TIMEOUTS.bohemia,
          });
          const ping = await ctx.call({
            apiFunc: "EMCP_WB_Ping",
            params: {},
            timeoutMs: TIMEOUTS.bohemia,
          });
          return { reload, after, ping };
        },
        () => {
          restorePing(ctx, installed, original);
          ctx.deps.writeArtifact("rollback-sc-16.json", { ok: true, by: "sc-16-u4-reload" });
        },
      );
      const msg = String(field(ping.response, "message") ?? "");
      const verdict = !ping.ok
        ? "handlers lost after the reload"
        : msg.includes(marker)
          ? "edited handler came alive (U4 yes)"
          : "handlers kept, edit not compiled (U4 no)";
      return {
        status: "observed",
        summary: verdict,
        data: {
          marker,
          pingBefore: summarizeCall(before),
          reload: summarizeCall(reload),
          isWorkbenchRunning: summarizeCall(after),
          pingAfter: summarizeCall(ping),
          verdict,
        },
      };
    },
  });

  // Every step but the gate reads the process table once for its started marker (DEC-032).
  return steps.map((s) =>
    s.id === "sc-00-gate" ? s : Object.assign(s, { timeout_ms: s.timeout_ms + HELPER.table }),
  );
}

/** OpenResource name of the tiny world: the sandbox-relative path with forward slashes. */
export function tinyWorldResource(rel: string): string {
  return forwardSlashes(rel).replace(/^\.?\//, "");
}

async function entityExists(ctx: RunContext, name: string): Promise<boolean> {
  const r = await ctx.call({
    apiFunc: "EMCP_WB_GetEntity",
    params: { name },
    timeoutMs: TIMEOUTS.bohemia,
  });
  return r.ok && field(r.response, "status") === "ok";
}

/**
 * Delete an entity this run created; still present afterwards: stop. Only ever
 * reached on a step's normal path: after a timeout or a kill no NET rollback is
 * attempted (the stop record carries `pendingRollback` instead).
 */
async function removeEntity(ctx: RunContext, name: string): Promise<void> {
  await ctx.call({
    apiFunc: "EMCP_WB_DeleteEntity",
    params: { name },
    timeoutMs: TIMEOUTS.bohemia,
    note: "rollback",
  });
  if (await entityExists(ctx, name)) {
    throw new StopSession("kill", `rollback failed: entity ${name} is still in the world`);
  }
}

async function removeEntityOwed(ctx: RunContext, name: string, owed: string): Promise<void> {
  await removeEntity(ctx, name);
  settleRollback(ctx, owed);
}

function settleRollback(ctx: RunContext, owed: string): void {
  const i = ctx.state.pendingRollback.indexOf(owed);
  if (i >= 0) ctx.state.pendingRollback.splice(i, 1);
}

function removePlanted(ctx: RunContext, dir: string, file: string): void {
  if (ctx.deps.fileExists(file)) ctx.deps.removeFile(file);
  // Anything else in the folder (a .meta or cache file Workbench added) is never deleted by the
  // run: it is named, and the step stops (DEC-032, S-C read m7).
  const left = ctx.deps.fileExists(dir)
    ? ctx.deps.listDir(dir).filter((n) => n !== U3_PLANT_FILE)
    : [];
  if (ctx.deps.fileExists(dir) && left.length === 0) ctx.deps.removeEmptyDir(dir);
  if (ctx.deps.fileExists(file)) {
    throw new StopSession(
      "kill",
      `the planted file ${file} is still on disk; remove it before any relaunch or U4`,
    );
  }
  if (left.length > 0) {
    throw new StopSession(
      "kill",
      `the plant folder ${dir} still holds ${left.join(", ")} (not created by this run, so not deleted): ` +
        "the main session removes it with the owner before any relaunch",
    );
  }
}

function restorePing(ctx: RunContext, installed: string, original: Buffer): void {
  ctx.deps.writeBytes(installed, original, false);
  if (!ctx.deps.readBytes(installed).equals(original)) {
    throw new StopSession(
      "kill",
      `${installed} could not be restored; reinstall the handler set before the next launch`,
    );
  }
}

/** CloseMainWindow on a pid this run started; never a kill. */
async function closeOurs(
  ctx: RunContext,
  pid: number,
): Promise<{ exited: boolean; detail: string }> {
  if (!ctx.state.startedPids.has(pid))
    throw new Error(`refusing to close pid ${pid}: not started by this lane`);
  const image = ctx.deps.processImage(pid);
  if (image === null) return { exited: true, detail: "already gone" };
  if (image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
    throw new StopSession("kill", `pid ${pid} is ${image}, not ${WORKBENCH_EXE}; nothing sent`);
  }
  const r = await ctx.deps.closeGracefully(pid, TIMEOUTS.close);
  if (!r.exited) {
    const hazards = (await ctx.deps.listWindows())
      .filter((w) => w.pid === pid)
      .map((w) => `${w.className} "${w.title}"`);
    return {
      exited: false,
      detail: `${r.detail}; windows still open (hazard, not answered): ${hazards.join(" | ") || "none"}`,
    };
  }
  return r;
}

async function waitGone(ctx: RunContext, pid: number, budgetMs: number): Promise<boolean> {
  const deadline = ctx.deps.now() + budgetMs;
  for (;;) {
    if (ctx.deps.processImage(pid) === null) return true;
    if (ctx.deps.now() >= deadline) return false;
    ctx.deps.heartbeat();
    await ctx.deps.sleep(1_000);
  }
}

async function launcherWindow(ctx: RunContext, pid: number): Promise<WindowInfo | null> {
  const ws = (await ctx.deps.listWindows()).filter((w) => w.pid === pid);
  return (
    ws.find((w) => w.title.toLowerCase().includes(LAUNCHER_WINDOW_TITLE.toLowerCase())) ?? null
  );
}

// ── Queue ────────────────────────────────────────────────────────────────────

export const RISK_DEFINITIONS: Record<RiskClass, string> = {
  "read-only": "changes no state in Workbench or on disk",
  reversible:
    "changes in-memory editor or window state only (windows, an unsaved world, a restart); the step's rollback or the end of the sitting restores it; nothing on disk",
  mutating: "writes a file in the sandbox, or can leave Workbench without handlers",
};

export const ORDER_NOTE =
  "Plan 8 fixes the S-C order: native payloads; read-only Bohemia handlers and U30; U2; U7; U29; open the tiny world; U19; U13; U3 clean; U3 planted; U4 last. " +
  "Plan 5.3 step 7 requires read-only, then reversible, then mutating. Two deviations follow from that rule and are for the main session to ratify: " +
  "(1) BringModuleWindowToFront and OpenResource (natives) and OpenXOB (Bohemia) open module windows, so they run as sc-08 just before U29, whose graceful close ends the process and those windows with it (Workbench may reopen its last resource at the relaunch; sc-09 records which came back, and its link names a config no earlier step opened); this also keeps the U7 walk on a Resource Manager window with no editor a probe opened. " +
  "(2) The clean U3 call (sc-14) is classed reversible although its own effect is a read, because it follows the world edits of U19 and U13; a more cautious class never weakens a gate. " +
  "The World Editor walk (sc-11b, walker.md step G, DEC-029) is classed reversible for the same reason: its own effect is a read, and it follows the opening of the tiny world (sc-11).";

/**
 * Probes answered only by steps that can be skipped at run time, each with the
 * skip condition: they are not answered in S-C when that condition holds.
 */
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

/** Every not-answered entry: the fixed ones, then the conditional ones. */
export function notAnswered(steps: StepDef[] = buildSteps()): NotAnswered[] {
  return [...NOT_ANSWERED, ...conditionalNotAnswered(steps)];
}

/** The sum of every step's worst-case timeout, the gate once: an estimate of the sitting's budget. */
export function worstCaseTotalMs(steps: StepDef[] = buildSteps()): number {
  return steps.reduce((sum, s) => sum + s.timeout_ms, 0);
}

/** The step ids `--from`/`--until` or `--only` select (the gate excluded; it always runs). */
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

/**
 * One invocation's worst case (an ESTIMATE, not a bound; DEC-032, S-C read m2): the gate's full
 * form (it runs first in every invocation), the selected steps, and `INVOCATION_MARGIN_MS`.
 */
export function invocationWorstCaseMs(
  ids: readonly string[],
  steps: StepDef[] = buildSteps(),
): number {
  const gate = steps.find((s) => s.id === "sc-00-gate")!.timeout_ms;
  return (
    gate +
    steps.filter((s) => ids.includes(s.id)).reduce((sum, s) => sum + s.timeout_ms, 0) +
    INVOCATION_MARGIN_MS
  );
}

/**
 * Why a real run's selection is refused, or null: it must be one declared block or one step
 * (`--only`), its worst case must fit the caller's background cap, and every selection but the
 * first block resumes a run folder (`--run-dir`; DEC-032, S-C read B1 and M1).
 */
export function selectionRefusal(
  sel: { from: string | null; until: string | null; only: string | null; runDir: boolean },
  steps: StepDef[] = buildSteps(),
): string | null {
  const isBlock = BLOCKS.some((b) => b.from === sel.from && b.until === sel.until);
  if (!sel.only && !isBlock) {
    return (
      "a real run is one declared block (--from X --until Y, runbook section E) or one step (--only X), " +
      "never the whole sitting in one invocation"
    );
  }
  const ids = selectedIds(sel, steps);
  if (ids.length === 0) return "the selection names no step after the gate";
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
  return {
    $comment:
      "Generated by `scripts/live/s-c-natives.ts --emit-queue` from its step table; tests/live-harness/s-c-natives.test.ts keeps this file equal to the table. Validated by scripts/live/preflight.ts validateQueue (step 7).",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: "docs/v2/sessions/queues/S-C.md",
    plan_refs: ["PLAN 8 Phase 2 table, S-C", "PLAN 5.3", "PLAN 7"],
    order_note: ORDER_NOTE,
    risk_classes: RISK_DEFINITIONS,
    timeout_note:
      "timeout_ms is an ESTIMATE of each step's worst case, not a bound: every call, wait and poll it makes, and the helpers' own timeouts (window lists, GUI-stall runs, process reads, the started marker's process-table read), run to their limits. worst_case_total_ms is their sum. The sitting runs one block per invocation (invocation_blocks); each invocation adds the gate and a margin, and runs as a background command with a timeout above its worst case (DEC-032).",
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
      ...(s.needsTinyWorld ? { needs_tiny_world: true } : {}),
      ...(s.skipWhen ? { skipped_when: s.skipWhen.condition } : {}),
    })),
    bohemia_handlers: {
      included_read_only: BI_INCLUDED.map((h) => ({
        name: h.name,
        row: h.row,
        ref: h.ref,
        why: h.why,
      })),
      included_reversible: BI_REVERSIBLE.map((h) => ({
        name: h.name,
        row: h.row,
        ref: h.ref,
        why: h.why,
      })),
      excluded: BI_EXCLUDED,
    },
    not_answered: notAnswered(steps),
  };
}

// ── Action plan and outline ──────────────────────────────────────────────────

export function planInput(o: {
  sandboxDir: string | null;
  tinyWorld: string | null;
  tinyWorldPresent: boolean;
  policy: CensusPolicy;
  nonce: string;
  u13?: U13Knobs;
  u29Forward?: boolean;
  /** --force-settings; null or absent: SCRATCH_INI_PLACEHOLDER. */
  forceSettings?: string | null;
}): PlanInput {
  const sandbox = o.sandboxDir ?? "<sandbox>";
  const gproj = o.sandboxDir
    ? join(o.sandboxDir, `${SANDBOX_NAME}.gproj`)
    : `<sandbox>\\${SANDBOX_NAME}.gproj`;
  const present = o.tinyWorld !== null && o.tinyWorldPresent;
  return {
    paths: {
      sandbox,
      gproj,
      tinyWorldAbs: present
        ? o.sandboxDir
          ? join(o.sandboxDir, o.tinyWorld!)
          : `<sandbox>\\${backSlashes(o.tinyWorld!)}`
        : null,
    },
    tinyWorldResource: present ? tinyWorldResource(o.tinyWorld!) : null,
    tinyWorldPresent: present,
    undoAllowed: allowListed(o.policy, UNDO_PATH),
    u29Forward: o.u29Forward ?? false,
    nonce: o.nonce,
    u13: o.u13 ?? U13_DEFAULTS,
    forceSettings: o.forceSettings ?? SCRATCH_INI_PLACEHOLDER,
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
      s.needsTinyWorld && !p.tinyWorldPresent
        ? " [SKIPPED: no tiny world; U13 and U19 move to S-E]"
        : s.id === "sc-12-u19-undo" && !p.undoAllowed
          ? " [SKIPPED: Edit > Undo is not on execute_action.allow_list]"
          : s.id === "sc-10-u29-forward" && !p.u29Forward
            ? " [SKIPPED: --u29-forward not given (the owner's call)]"
            : "";
    lines.push(`${s.id} (${s.risk})${skipped}: ${s.title}`);
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

/** A skipped step's summary: the reason, and the probes S-C then does not answer. */
function skippedSummary(s: StepDef, reason: string, steps: StepDef[]): string {
  const lost = conditionalNotAnswered(steps).filter((n) => n.answered_by?.includes(s.id));
  if (!lost.length) return reason;
  return `${reason}. Not answered in S-C: ${lost.map((n) => n.id).join(", ")} (carried to ${s.skipWhen?.carried_to ?? lost[0].carried_to})`;
}

/** Run the session against `deps`. Never retries after a timeout. */
export async function runSession(
  opts: SessionOptions,
  deps: SessionDeps,
  steps: StepDef[] = buildSteps(),
): Promise<SessionReport> {
  const state: SessionState = {
    wbPid: null,
    startedPids: new Set(),
    tinyWorldPresent: false,
    baselineWindows: [],
    heavyBaselineMs: null,
    u7Before: null,
    rmWindow: null,
    pendingRollback: [],
    u7AfterAt: null,
    u7Skip: null,
  };
  const calls: CallRecord[] = [];
  let inFlight = false;
  /** The running step's started marker (DEC-032, S-C read B1). */
  let currentMarker: StartedMarker | null = null;
  const denied = deniedApiNames(opts.policy);

  const guard = (apiFunc: string): void => {
    const hit = deniedApi(apiFunc, denied);
    if (hit) throw new Error(`refused: ${apiFunc} is on the policy deny list (${hit})`);
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

  const ctx: RunContext = {
    opts,
    deps,
    state,
    calls,
    async call(spec) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      guard(spec.apiFunc);
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
      if (r.timedOut)
        throw new StopSession(
          "timeout",
          `${spec.apiFunc} timed out after ${spec.timeoutMs} ms (not retried)`,
        );
      if (!r.ok && /^connection refused/.test(r.error ?? "")) {
        throw new StopSession("kill", `${spec.apiFunc}: ${r.error}; Workbench is not listening`);
      }
      return r;
    },
    async burst(specs) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      specs.forEach((s) => guard(s.apiFunc));
      deps.heartbeat();
      inFlight = true;
      let results: RawCallResult[];
      const starts: number[] = [];
      try {
        const pending: Array<Promise<RawCallResult>> = [];
        for (let i = 0; i < specs.length; i++) {
          if (i > 0) await deps.sleep(TIMEOUTS.burstStagger);
          starts.push(deps.now());
          pending.push(deps.net(specs[i].apiFunc, specs[i].params, specs[i].timeoutMs));
        }
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
    async detached(spec, label) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      guard(spec.apiFunc);
      deps.heartbeat();
      inFlight = true;
      const startedAt = deps.now();
      const resultName = `child-${label}-${opts.nonce}.json`;
      const samples: Array<Record<string, unknown>> = [];
      try {
        if (deps.readRunFile(resultName) !== null) {
          throw new Error(`${resultName} already exists in the run folder; use a new --nonce`);
        }
        const childPid = deps.startDetached({
          apiFunc: spec.apiFunc,
          params: spec.params,
          timeoutMs: spec.timeoutMs,
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
                `${spec.apiFunc} (detached) timed out after ${spec.timeoutMs} ms (not retried)`,
              );
            return r;
          }
          if (deps.now() >= deadline) {
            deps.writeArtifact(`poll-${label}.json`, samples);
            throw new StopSession(
              "timeout",
              `${spec.apiFunc} (detached child pid ${childPid}) wrote no result within ${spec.timeoutMs + TIMEOUTS.detachedGrace} ms; not retried, the child is left running`,
            );
          }
          await deps.sleep(TIMEOUTS.poll);
          deps.heartbeat();
          const wins = (await deps.listWindows()).filter((w) => w.pid === state.wbPid);
          const stall = await deps.guiStall(state.wbPid!, 1);
          samples.push({
            t: deps.now() - startedAt,
            windows: wins.map((w) => ({
              className: w.className,
              title: w.title,
              enabled: w.enabled,
              owner: w.owner,
            })),
            guiMs: stall[0],
          });
          // A dialog or a disabled Workbench window during the call ends the wait as a stop
          // (DEC-032, S-C read m4): nothing is answered, and no NET call follows.
          const ch = windowChanges(state.baselineWindows, wins, state.wbPid!);
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
    async ourWindows() {
      const pid = state.wbPid;
      return (await deps.listWindows()).filter((w) => w.pid === pid);
    },
    async modalCheck(label, expected) {
      const after = await ctx.ourWindows();
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
    async setBaseline(label, expected) {
      const ws = await ctx.ourWindows();
      const problem = baselineProblem(ws, expected, opts.ownedModuleClasses ?? []);
      if (problem) {
        throw new StopSession(
          "kill",
          `${label}: refusing the window baseline, a modal or a dialog is already up (${problem}); nothing is clicked`,
        );
      }
      state.baselineWindows = ws;
      return ws;
    },
    async updateMarker(pid) {
      if (!currentMarker) return;
      currentMarker = {
        ...currentMarker,
        pid,
        created: await deps.processCreated(pid),
      };
      deps.writeArtifact(`${currentMarker.step}.started`, currentMarker);
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

  // DEC-032 (S-C read B1, M1): before the gate's first NET call, refuse a run folder that holds a
  // step the script never finished (a started marker with no result: the script was cut off), a
  // selected step that already has a result (never run twice, never retried), or a detached child
  // of an earlier step that may still hold the socket.
  const refuse = (reason: string): SessionReport => {
    report.stop = { kind: "refused", reason, step: steps[0].id };
    report.exit = EXIT.refused;
    deps.log(`refused: ${reason}`);
    return report;
  };
  const runFiles = deps.listRunFiles();
  const dangling = runFiles.filter(
    (f) => /\.started$/.test(f) && !runFiles.includes(f.replace(/\.started$/, ".json")),
  );
  if (dangling.length) {
    const id = dangling[0].replace(/\.started$/, "");
    return refuse(
      `${id} has a started marker and no result in this run folder: the script ended during that step. Treat ` +
        "it as a harness error: heartbeat the lane; if a Workbench runs, the recover subcommand; if " +
        `${id} is sc-15 or sc-16, the rollback subcommand; git -C <sandbox> status --short; stop and ask the owner. ` +
        `No step runs in this run folder until the owner's acknowledgement is recorded (acknowledge --step ${id}); ` +
        `${id} is not run again in this run`,
    );
  }
  const selected = steps.filter((s, i) => i > 0 && i >= fromIdx && i <= untilIdx);
  const again = selected.find(
    (s) => runFiles.includes(`${s.id}.json`) || runFiles.includes(`${s.id}.started.acknowledged`),
  );
  if (again) {
    return refuse(
      `${again.id} already has a result in this run folder (or an acknowledged marker): a step is never run ` +
        "twice in one run, and a stopped step is never retried (plan 5.3)",
    );
  }
  for (const f of runFiles) {
    const m = /^(child-.+\.json)\.request\.json$/.exec(f);
    if (!m || runFiles.includes(m[1])) continue;
    const pidText = deps.readRunFile(`${m[1]}.pid.json`);
    if (pidText === null) {
      return refuse(
        `the detached call ${m[1]} has no result and no recorded child pid: it may still hold the NET socket; ` +
          "check the process list by hand, then stop and ask the owner",
      );
    }
    const child = JSON.parse(pidText) as { pid: number; created: number | null };
    if (deps.processImage(child.pid) === null) continue;
    const nowCreated = await deps.processCreated(child.pid);
    if (child.created === null || nowCreated === null || nowCreated === child.created) {
      return refuse(
        `the detached call ${m[1]} has no result and its child pid ${child.pid} still runs: it holds the NET ` +
          "socket, and a NET call now would be a second call in flight; wait for it, or stop and ask the owner",
      );
    }
  }

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
    const mark = calls.length;
    try {
      const skipReason =
        s.needsTinyWorld && !state.tinyWorldPresent ? NO_TINY_WORLD : (s.skip?.(ctx) ?? null);
      if (skipReason !== null) {
        finish(s, "skipped", skippedSummary(s, skipReason, steps), {}, mark);
        continue;
      }
      if (!isGate) {
        // The started marker, before the step's first side effect (DEC-032, S-C read B1): the
        // Workbench pid and its creation time, so `recover` can show the pid is this run's own.
        const pid = state.wbPid;
        currentMarker = {
          step: s.id,
          started_at: new Date(deps.now()).toISOString(),
          pid,
          created: pid === null ? null : await deps.processCreated(pid),
        };
        deps.writeArtifact(`${s.id}.started`, currentMarker);
      }
      const out = await s.run(ctx);
      const summary =
        out.status === "skipped" ? skippedSummary(s, out.summary, steps) : out.summary;
      finish(s, out.status, summary, out.data ?? {}, mark);
    } catch (caught) {
      // Anything unexpected stops the run like a kill criterion: nothing is retried.
      const e =
        caught instanceof StopSession
          ? caught
          : new StopSession(
              "kill",
              `internal error: ${caught instanceof Error ? caught.message : String(caught)}`,
            );
      const data: Record<string, unknown> = { pendingRollback: [...state.pendingRollback] };
      if (e.kind === "handoff") {
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
            closed = await closeOurs(ctx, pid);
          } catch (err) {
            closed = { exited: false, detail: err instanceof Error ? err.message : String(err) };
          }
        }
        data.close = closed;
        data.capture = await deps.capture(`${s.id}-abort`);
        data.windows = windowsForEvidence(await deps.listWindows(), state.startedPids);
        finish(s, "aborted", e.message, data, mark);
        report.stop = { kind: e.kind, reason: e.message, step: s.id };
        report.exit = EXIT.aborted;
        return report;
      }
      // timeout or kill: no retry; capture the desktop, list the windows, stop.
      const shot = await deps.capture(`${s.id}-${e.kind}`);
      const windows = await deps.listWindows();
      data.capture = shot;
      data.windows = windowsForEvidence(windows, state.startedPids);
      data.crashReporters = deps.crashReporters();
      finish(s, "stopped", `${e.kind}: ${e.message}`, data, mark);
      report.stop = { kind: e.kind, reason: e.message, step: s.id };
      report.exit = EXIT.stopped;
      return report;
    }
  }
  return report;
}

// ── Raw NET call (keeps the wire shape) ──────────────────────────────────────

/** Parse a response frame without throwing: status, payload presence, JSON. */
export function parseResponseFrame(
  buf: Buffer,
): Pick<RawCallResult, "ok" | "response" | "error" | "wire"> {
  if (buf.length === 0)
    return {
      ok: false,
      error: "connection closed without a response",
      wire: { status: null, payload: "absent" },
    };
  let status: string;
  let used: number;
  try {
    const s = decodePascalString(buf, 0);
    status = s.value;
    used = s.bytesRead;
  } catch (e) {
    return {
      ok: false,
      error: `unreadable status: ${e instanceof Error ? e.message : String(e)}`,
      wire: { status: null, payload: "absent" },
    };
  }
  if (buf.length <= used) {
    return status === "Ok"
      ? { ok: true, wire: { status, payload: "absent" } }
      : { ok: false, error: `Workbench error: ${status}`, wire: { status, payload: "absent" } };
  }
  let payload: string;
  try {
    payload = decodePascalString(buf, used).value;
  } catch (e) {
    return {
      ok: false,
      error: `unreadable payload: ${e instanceof Error ? e.message : String(e)}`,
      wire: { status, payload: "present" },
    };
  }
  const wire = { status, payload: payload.length ? ("present" as const) : ("empty" as const) };
  if (status !== "Ok") return { ok: false, error: `Workbench error: ${status}`, wire };
  if (!payload.length) return { ok: true, wire };
  try {
    return { ok: true, response: JSON.parse(payload) as unknown, wire };
  } catch {
    return { ok: false, error: `unparseable payload: ${payload.slice(0, 200)}`, wire };
  }
}

/**
 * One request over a fresh socket, read until the peer closes. Never retries.
 * Unlike netcall.ts it keeps the wire shape (a status with no payload string,
 * or an empty one), which the native functions with no response fields need.
 */
export function rawNetCall(
  apiFunc: string,
  params: Record<string, unknown>,
  opts: { host?: string; port?: number; timeoutMs: number },
): Promise<RawCallResult> {
  const request = encodeRequest(HARNESS_CLIENT_ID, apiFunc, params);
  const started = Date.now();
  const max = 10 * 1024 * 1024;
  return new Promise((done) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const finish = (r: Omit<RawCallResult, "bytesSent" | "bytesReceived" | "durationMs">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.destroy();
      done({
        ...r,
        bytesSent: request.length,
        bytesReceived: received,
        durationMs: Date.now() - started,
      });
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          timedOut: true,
          error: `timed out after ${opts.timeoutMs} ms (not retried)`,
        }),
      opts.timeoutMs,
    );
    socket.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      finish({
        ok: false,
        timedOut: false,
        error:
          code === "ECONNREFUSED"
            ? `connection refused at ${opts.host ?? "127.0.0.1"}:${opts.port ?? DEFAULT_PORT}`
            : err.message,
      });
    });
    socket.on("data", (c) => {
      received += c.length;
      if (received > max)
        return finish({ ok: false, timedOut: false, error: `response exceeded ${max} bytes` });
      chunks.push(c);
    });
    const end = (): void =>
      finish({ ...parseResponseFrame(Buffer.concat(chunks)), timedOut: false });
    socket.on("end", end);
    socket.on("close", end);
    socket.connect(opts.port ?? DEFAULT_PORT, opts.host ?? "127.0.0.1", () => socket.end(request));
  });
}

// ── Windows (PowerShell; reads only, plus WM_NULL for the stall sample) ──────

/** PowerShell: every visible top-level window: hwnd, pid, class, title, owner, enabled, rect, monitor. */
export const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Text; using System.Runtime.InteropServices;",
  "public static class EmcpScWindows {",
  "  private delegate bool EnumProc(IntPtr h, IntPtr l);",
  "  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }",
  "  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }",
  '  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);',
  '  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr h);',
  '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);',
  '  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);',
  '  [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);',
  '  [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);',
  "  private static string J(string s) { var b = new StringBuilder(); foreach (char c in s) { if (c == '\\\\') b.Append(\"\\\\\\\\\"); else if (c == '\"') b.Append(\"\\\\\\\"\"); else if (c < ' ') b.Append(' '); else b.Append(c); } return b.ToString(); }",
  "  public static string Run() {",
  '    var o = new StringBuilder("["); bool first = true;',
  "    EnumWindows(delegate(IntPtr h, IntPtr l) {",
  "      if (!IsWindowVisible(h)) return true;",
  "      uint pid; GetWindowThreadProcessId(h, out pid);",
  "      var t = new StringBuilder(512); GetWindowText(h, t, 512);",
  "      var c = new StringBuilder(256); GetClassName(h, c, 256);",
  "      RECT r; GetWindowRect(h, out r);",
  "      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));",
  "      GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);",
  "      if (!first) o.Append(','); first = false;",
  '      o.Append("{\\"hwnd\\":").Append(h.ToInt64()).Append(",\\"pid\\":").Append(pid);',
  '      o.Append(",\\"className\\":\\"").Append(J(c.ToString())).Append("\\",\\"title\\":\\"").Append(J(t.ToString())).Append(\'"\');',
  '      o.Append(",\\"owner\\":").Append(GetWindow(h, 4).ToInt64()).Append(",\\"enabled\\":").Append(IsWindowEnabled(h) ? "true" : "false");',
  "      o.Append(\",\\\"rect\\\":[\").Append(r.L).Append(',').Append(r.T).Append(',').Append(r.R).Append(',').Append(r.B).Append(']');",
  "      o.Append(\",\\\"monitor\\\":[\").Append(mi.rcMonitor.L).Append(',').Append(mi.rcMonitor.T).Append(',').Append(mi.rcMonitor.R).Append(',').Append(mi.rcMonitor.B).Append(']');",
  '      o.Append(",\\"primary\\":").Append((mi.dwFlags & 1) == 1 ? "true" : "false").Append(\'}\');',
  "      return true;",
  "    }, IntPtr.Zero);",
  "    return o.Append(']').ToString();",
  "  }",
  "}",
  "'@",
  "[EmcpScWindows]::Run()",
].join("\n");

/** Parse WINDOWS_SCRIPT output (its last line). */
export function parseWindows(stdout: string): WindowInfo[] {
  const line = lastLine(stdout);
  if (!line) return [];
  const raw = JSON.parse(line) as unknown;
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      hwnd: Number(r.hwnd),
      pid: Number(r.pid),
      className: String(r.className ?? ""),
      title: String(r.title ?? ""),
      owner: Number(r.owner ?? 0),
      enabled: r.enabled !== false,
      rect: Array.isArray(r.rect) ? r.rect.map(Number) : [],
      monitor: Array.isArray(r.monitor) ? r.monitor.map(Number) : [],
      primary: r.primary === true,
    }));
}

/**
 * PowerShell: WM_NULL round trips (SendMessageTimeout, abort if hung) to the pid's main window.
 * With EMCP_HWND set (a window the caller recorded), that window instead, and only while it still
 * belongs to the pid (otherwise every sample is null); without it, .NET MainWindowHandle (S-C).
 */
export const STALL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Text; using System.Runtime.InteropServices;",
  "public static class EmcpScStall {",
  '  [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);',
  '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  "  public static string Run(int pid, int samples, int timeoutMs, long hwnd) {",
  "    IntPtr h = System.Diagnostics.Process.GetProcessById(pid).MainWindowHandle;",
  "    if (hwnd != 0) { h = new IntPtr(hwnd); uint owner; GetWindowThreadProcessId(h, out owner); if (owner != (uint)pid) h = IntPtr.Zero; }",
  '    var o = new StringBuilder("[");',
  "    for (int i = 0; i < samples; i++) {",
  "      if (i > 0) { o.Append(','); System.Threading.Thread.Sleep(200); }",
  '      if (h == IntPtr.Zero) { o.Append("null"); continue; }',
  "      var sw = System.Diagnostics.Stopwatch.StartNew(); IntPtr res;",
  "      IntPtr ok = SendMessageTimeout(h, 0, IntPtr.Zero, IntPtr.Zero, 2, (uint)timeoutMs, out res);",
  "      sw.Stop();",
  '      if (ok == IntPtr.Zero) o.Append("null"); else o.Append(sw.Elapsed.TotalMilliseconds.ToString(System.Globalization.CultureInfo.InvariantCulture));',
  "    }",
  "    return o.Append(']').ToString();",
  "  }",
  "}",
  "'@",
  "[EmcpScStall]::Run([int]$env:EMCP_PID, [int]$env:EMCP_SAMPLES, 5000, [long]$env:EMCP_HWND)",
].join("\n");

// ── Real dependencies ────────────────────────────────────────────────────────

export interface RealDepsInput {
  lane: Lane;
  port: number;
  workbenchPath: string;
  gamePath: string;
  gproj: string;
  sandboxDir: string;
  logsPath: string | null;
  runDir: string;
  evidenceDir: string;
  evidenceSession: string;
  build: string;
  placeholders: PlaceholderContext;
  /** The scratch ini every launch passes as `-forceSettings` (U12, DEC-038). */
  forceSettings: string;
}

/** Spawn form shared by the recorded and unrecorded launches: the sandbox only. */
function sandboxLaunch(input: RealDepsInput, extraArgs: string[]): LaunchPlan {
  if (dirname(input.gproj).replace(/^.*[\\/]/, "") !== SANDBOX_NAME) {
    throw new Error(`refusing to launch ${input.gproj}: S-C drives only the ${SANDBOX_NAME} addon`);
  }
  for (const a of extraArgs) {
    if (!/^-uri=/.test(a)) throw new Error(`refusing launch argument ${a}`);
    validateU29Link(a.slice("-uri=".length));
  }
  const plan = buildLaunch({
    workbenchPath: input.workbenchPath,
    gamePath: input.gamePath,
    gproj: input.gproj,
    forceSettings: input.forceSettings,
  });
  const args = [...plan.args, ...extraArgs];
  return { ...plan, args, commandLine: formatCommandLine(plan.exe, args) };
}

export function realDeps(input: RealDepsInput): SessionDeps {
  // Writes, removals and folders only inside the sandbox; the bundled Ping file may be READ too,
  // never written (DEC-032, S-C read i1).
  const inSandbox = (p: string): string => {
    if (!insideDir(input.sandboxDir, p)) {
      throw new Error(`refusing file access outside the sandbox: ${p}`);
    }
    return p;
  };
  const readable = (p: string): string =>
    resolve(p) === resolve(join(BUNDLED_HANDLER_DIR, PING_FILE)) ? p : inSandbox(p);
  return {
    net: (apiFunc, params, timeoutMs) =>
      rawNetCall(apiFunc, params, { port: input.port, timeoutMs }),
    listWindows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      return r.ok ? parseWindows(r.stdout) : [];
    },
    capture: async (label) => {
      const r = await captureDesktop({
        label: `S-C-${label}`,
        dir: input.runDir,
        gateReason: null,
      });
      return { ok: r.ok, path: r.path, detail: r.detail };
    },
    guiStall: async (pid, samples) => {
      const r = await runPowerShell(STALL_SCRIPT, {
        timeoutMs: 30_000 + samples * 6_000,
        env: { EMCP_PID: String(pid), EMCP_SAMPLES: String(samples) },
      });
      const line = r.ok ? lastLine(r.stdout) : null;
      return line
        ? (JSON.parse(line) as Array<number | null>)
        : Array.from({ length: samples }, () => null);
    },
    processImage: (pid) => processByPid(defaultExec, pid)?.image ?? null,
    processCreated: (pid) => creationTimeOf(pid, () => readProcessTable()),
    listRunFiles: () => (existsSync(input.runDir) ? readdirSync(input.runDir) : []),
    listDir: (p) => (existsSync(inSandbox(p)) ? readdirSync(p) : []),
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
    launchRecorded: (extraArgs) =>
      spawnWorkbench(sandboxLaunch(input, extraArgs), input.lane, input.gproj),
    launchUnrecorded: (extraArgs) => {
      const plan = sandboxLaunch(input, extraArgs);
      const child = spawn(plan.exe, plan.args, {
        cwd: plan.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      if (child.pid === undefined)
        throw new Error(`second process did not start: ${plan.commandLine}`);
      return child.pid;
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
    readBytes: (p) => readFileSync(readable(p)),
    writeBytes: (p, data, exclusive) =>
      writeFileSync(inSandbox(p), data, { flag: exclusive ? "wx" : "w" }),
    removeFile: (p) => rmSync(inSandbox(p)),
    makeDir: (p) => mkdirSync(inSandbox(p), { recursive: true }),
    removeEmptyDir: (p) => {
      if (readdirSync(inSandbox(p)).length === 0) rmdirSync(p);
    },
    startDetached: (spec) => {
      const req = childRequest(spec, input.port, input.lane);
      const specPath = join(input.runDir, `${spec.resultName}.request.json`);
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
      // The child's pid and creation time beside its request (DEC-032, S-C read M1): a later
      // invocation refuses while a child without a result still runs.
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
    runWalker: (argv, budgetMs) =>
      new Promise((done) => {
        // The walker's stderr is piped and printed in placeholder form (DEC-032, S-C read m6).
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
        input.evidenceSession,
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

// ── Detached child ───────────────────────────────────────────────────────────

/** Environment names that carry the lane's lease and marker paths to the child. */
export const CHILD_ENV = {
  leasePath: "EMCP_SC_LEASE_PATH",
  markerPath: "EMCP_SC_MARKER_PATH",
} as const;

/**
 * The detached child's request: the request file (in the run folder, so it
 * holds no path at all: the child writes its result beside it) and the
 * environment that carries the lease and marker paths, which are under
 * %USERPROFILE% and so never written to the artifacts folder.
 */
export function childRequest(
  spec: DetachedSpec,
  port: number,
  lane: { id: string; leasePath: string; markerPath: string },
): { file: string; env: Record<string, string> } {
  return {
    file: JSON.stringify({ ...spec, port, laneId: lane.id }) + "\n",
    env: { [CHILD_ENV.leasePath]: lane.leasePath, [CHILD_ENV.markerPath]: lane.markerPath },
  };
}

/** `--child-call <spec.json>`: ONE call, result to the run folder. Gated like the parent. */
export async function runChildCall(
  specPath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const spec = JSON.parse(readFileSync(specPath, "utf-8")) as DetachedSpec & {
    port: number;
    laneId: string;
  };
  if (!/^[A-Za-z0-9_.-]+\.json$/.test(spec.resultName)) {
    throw new Error(`refusing result name ${spec.resultName}`);
  }
  const resultPath = join(dirname(specPath), spec.resultName);
  const lane = new Lane({
    id: spec.laneId,
    leasePath: env[CHILD_ENV.leasePath] || undefined,
    markerPath: env[CHILD_ENV.markerPath] || undefined,
  });
  const reason = liveGateReason({ really: true, platform, leaseHeld: lane.holdsLease() });
  const denied = deniedApi(spec.apiFunc, deniedApiNames(loadPolicy()));
  // The lease stays alive while the call runs (a reload was recorded at over seven minutes;
  // DEC-032, S-C read m10).
  if (!reason && !denied) lane.startHeartbeat(60_000);
  const result: RawCallResult =
    reason || denied
      ? {
          ok: false,
          timedOut: false,
          durationMs: 0,
          bytesSent: 0,
          bytesReceived: 0,
          error: reason ?? `refused: ${spec.apiFunc} is denied`,
        }
      : await rawNetCall(spec.apiFunc, spec.params, { port: spec.port, timeoutMs: spec.timeoutMs });
  lane.stopHeartbeat();
  writeFileSync(
    resultPath,
    JSON.stringify(rewriteStrings(result, defaultPlaceholderContext())) + "\n",
    { flag: "wx" },
  );
  return result.ok ? 0 : 1;
}

// ── Rollback of the U3 plant and the U4 edit (DEC-032, S-C read B1) ─────────

/** File operations the rollback needs (the sandbox and the run folder); injected for tests. */
export interface RollbackIo {
  workbenchPids: () => number[];
  fileExists: (p: string) => boolean;
  readBytes: (p: string) => Buffer;
  writeBytes: (p: string, data: Buffer) => void;
  removeFile: (p: string) => void;
  removeEmptyDir: (p: string) => void;
  listDir: (p: string) => string[];
  readRunFile: (name: string) => string | null;
  /** Create a run-folder file; never overwrites. */
  writeRunFile: (name: string, text: string) => void;
  log: (line: string) => void;
}

/**
 * `rollback`: undo the sc-15 plant and the sc-16 edit of a run that was cut off before its own
 * restore. Only what a plant record (`plant-sc-15.json`, `plant-sc-16.json`) without its
 * rollback record names, only while no Workbench image runs, and only when the file on disk is
 * the one the run wrote (by its hash): the planted file is removed and its folder too when it is
 * empty (anything else in it is named and left); the installed Ping is written back from the
 * bundle and checked byte-equal. A dry run unless `gate` is null.
 */
export function runRollback(
  cfg: { runDir: string; sandboxDir: string; gate: string | null; really: boolean },
  io: RollbackIo,
): number {
  const open = (["sc-15", "sc-16"] as const).filter(
    (id) =>
      io.readRunFile(`plant-${id}.json`) !== null && io.readRunFile(`rollback-${id}.json`) === null,
  );
  if (open.length === 0) {
    io.log("no U3 plant or U4 edit without a rollback in this run folder");
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
    io.log(`refused: Workbench is running (pid ${running.join(", ")}); end it with recover first`);
    return 1;
  }
  let ok = true;
  const wb = join(cfg.sandboxDir, "Scripts", "WorkbenchGame");
  for (const id of open) {
    let detail: string;
    let done = false;
    if (id === "sc-15") {
      const m = JSON.parse(io.readRunFile("plant-sc-15.json")!) as {
        sha256: string;
        folderExisted?: boolean;
      };
      const dir = join(wb, U3_PLANT_FOLDER);
      const file = join(dir, U3_PLANT_FILE);
      if (io.fileExists(file) && sha256Hex(io.readBytes(file)) !== m.sha256) {
        detail = `${U3_PLANT_FILE} is not the file the run planted (another hash); nothing removed`;
      } else {
        if (io.fileExists(file)) io.removeFile(file);
        const left = io.fileExists(dir) ? io.listDir(dir) : [];
        if (io.fileExists(dir) && left.length === 0 && m.folderExisted !== true)
          io.removeEmptyDir(dir);
        done = !io.fileExists(file) && left.length === 0;
        detail = done
          ? `the planted file and its folder are gone`
          : `the plant folder still holds ${left.join(", ")} (not created by the run, so not deleted): remove it with the owner`;
      }
    } else {
      const m = JSON.parse(io.readRunFile("plant-sc-16.json")!) as {
        bundleSha256: string;
        editedSha256: string;
      };
      const installed = join(wb, HANDLER_FOLDER, PING_FILE);
      const bundle = io.readBytes(join(BUNDLED_HANDLER_DIR, PING_FILE));
      const now = io.fileExists(installed) ? sha256Hex(io.readBytes(installed)) : null;
      if (now === m.bundleSha256) {
        done = true;
        detail = `the installed ${PING_FILE} already equals the bundle`;
      } else if (now === m.editedSha256) {
        io.writeBytes(installed, bundle);
        done = io.readBytes(installed).equals(bundle);
        detail = done
          ? `the installed ${PING_FILE} is restored from the bundle and byte-equal`
          : `the installed ${PING_FILE} could not be restored`;
      } else {
        detail = `the installed ${PING_FILE} is neither the bundle nor the run's edit; nothing written (reinstall the handler set with the owner)`;
      }
    }
    if (done)
      io.writeRunFile(
        `rollback-${id}.json`,
        JSON.stringify({ ok: true, by: "rollback", detail }) + "\n",
      );
    io.log(`${id}: ${done ? "rolled back" : "INCOMPLETE"}: ${detail}`);
    ok &&= done;
  }
  return ok ? 0 : 1;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface MainOverrides {
  platform?: NodeJS.Platform;
  deps?: (input: RealDepsInput) => SessionDeps;
  policy?: CensusPolicy;
  out?: (line: string) => void;
  /** Dry run: whether the tiny world file exists under --sandbox (read only). */
  exists?: (path: string) => boolean;
  /** The artifacts folder a run folder must lie in (tests). */
  artifactsRoot?: string;
  /** `recover`'s process operations (tests). */
  recoverDeps?: Partial<RecoverDeps>;
  /** `rollback`'s file operations (tests). */
  rollbackIo?: Partial<RollbackIo>;
}

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "sandbox",
  "tiny-world",
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
  "workbench-path",
  "game-path",
  "logs-path",
  "u13-prefab",
  "u13-component",
  "u13-key",
  "u13-value",
  "registry-export",
  "force-settings",
  "owned-module-classes",
  "owner-go",
  "step",
] as const;

/**
 * Why a real run's `--force-settings` is refused, or null (DEC-038: every later launch reads the
 * scratch profile, never the owner's registry): it is required, must not look like a switch, its
 * resolved path must lie inside the artifacts folder, and the file must exist.
 */
export function forceSettingsRefusal(
  value: string | undefined,
  artifactsRoot: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  if (value === undefined || !value.trim()) {
    return "a real run needs --force-settings <scratch.ini>: the relaunches read the scratch profile, never the owner's registry (DEC-038)";
  }
  if (value.startsWith("-")) return `--force-settings ${value} looks like a switch`;
  const abs = resolve(value);
  if (outsideArtifacts(abs, artifactsRoot) !== null) {
    return `--force-settings ${abs} is not inside the artifacts folder ${artifactsRoot}`;
  }
  if (!exists(abs)) return `--force-settings ${abs} does not exist`;
  return null;
}

/**
 * Why a `--walker-cmd` is refused for a real run, or null (DEC-032, S-C read i2): it must run
 * `tools/uia/walk.ts` with `--really`, `--id` naming this lane, and the placeholders {pid},
 * {class}, {title} and {out}.
 */
export function walkerCmdRefusal(argv: readonly string[], laneId: string): string | null {
  if (!argv.some((a) => a.replace(/\\/g, "/").endsWith("tools/uia/walk.ts"))) {
    return "--walker-cmd must run tools/uia/walk.ts";
  }
  if (!argv.includes("--really")) return "--walker-cmd must carry --really";
  const i = argv.indexOf("--id");
  if (i < 0 || argv[i + 1] !== laneId) return `--walker-cmd must carry --id ${laneId} (this lane)`;
  for (const p of ["{pid}", "{class}", "{title}", "{out}"]) {
    if (!argv.includes(p)) return `--walker-cmd must carry the placeholder ${p}`;
  }
  return null;
}

/** The runbook's line for one block (`--from X --until Y`, or `--only X`). */
export function blockArgs(b: { from: string; until: string }): string {
  return b.from === b.until ? `--only ${b.from}` : `--from ${b.from} --until ${b.until}`;
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  // Every printed path in placeholder form (plan 5.2; DEC-032, S-C read m6), errors included.
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
      "Usage: s-c-natives.ts [run] [options] | recover --run-dir <dir> --id <id> [--owner-go <pid>] [--really] | " +
        "rollback --run-dir <dir> --id <id> [--sandbox <dir>] [--really] | " +
        "acknowledge --run-dir <dir> --id <id> --step <id> [--owner-ack] [--really]",
    );
    return EXIT.usage;
  }
  const policy = over.policy ?? loadPolicy();
  const steps = buildSteps();
  const platform = over.platform ?? process.platform;
  const really = args.flags.has("really");
  const artifactsRoot = over.artifactsRoot ?? artifactsDir();
  /** A real run's last line: `S-C ... done` or `STOPPED ...` (DEC-032, as S-A's and S-B's). */
  const stopped = (reason: string): void => say(toPlaceholders(`STOPPED: ${reason}`, ph));

  if (o.sandbox !== undefined && basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    // The plan checker sees only <sandbox>: the folder itself must be the 2.0 sandbox (DEC-032 M3).
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
          next:
            "the rollback subcommand if sc-15 or sc-16 was running, then git -C <sandbox> status --short; " +
            "a stopped step is never retried",
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
        would: "no Workbench image runs and no plant of the step is open",
        extraRefusal: () => {
          const id = o.step!.slice(0, 5);
          return (id === "sc-15" || id === "sc-16") &&
            existsSync(join(runDir, `plant-${id}.json`)) &&
            !existsSync(join(runDir, `rollback-${id}.json`))
            ? `the plant of ${o.step} has no rollback record; run the rollback subcommand first`
            : null;
        },
      });
    }
    // rollback
    let sandboxDir: string;
    try {
      sandboxDir = resolve(o.sandbox ?? join(loadConfig().projectPath, SANDBOX_NAME));
    } catch (e) {
      err(`configuration: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT.usage;
    }
    ph = defaultPlaceholderContext({ v2: REPO_ROOT, sandbox: sandboxDir });
    const gate = liveGateReason({ really, platform, leaseHeld: lane.holdsLease() });
    // As S-A's rollback: a dry run says what it would do; a real one refuses outside the artifacts folder.
    const outside = gate ? null : outsideArtifacts(runDir, artifactsRoot);
    if (outside) {
      err(`refused: ${outside}`);
      return EXIT.refused;
    }
    const io: RollbackIo = {
      workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid),
      fileExists: (p) => existsSync(p),
      readBytes: (p) => readFileSync(p),
      writeBytes: (p, d) => writeFileSync(p, d),
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
  const nonce = o.nonce ?? randomBytes(3).toString("hex");
  const u13 = {
    prefab: o["u13-prefab"] ?? U13_DEFAULTS.prefab,
    component: o["u13-component"] ?? U13_DEFAULTS.component,
    key: o["u13-key"] ?? U13_DEFAULTS.key,
    value: o["u13-value"] ?? U13_DEFAULTS.value,
  };
  const u29Forward = args.flags.has("u29-forward");
  if (o["tiny-world"] !== undefined) {
    const problem = tinyWorldProblem(o["tiny-world"], o.sandbox ?? null);
    if (problem) {
      err(problem);
      return EXIT.usage;
    }
  }

  if (!really) {
    // Dry run: the sandbox is read only to see whether the tiny world exists.
    const sandbox = o.sandbox ?? null;
    const tiny = o["tiny-world"] ?? null;
    const present =
      tiny !== null && (sandbox === null || (over.exists ?? existsSync)(join(sandbox, tiny)));
    const p = planInput({
      sandboxDir: sandbox,
      tinyWorld: tiny,
      tinyWorldPresent: present,
      policy,
      nonce,
      u13,
      u29Forward,
      forceSettings: o["force-settings"] ?? null,
    });
    // With a selection, the plan and the outline are that invocation's: the gate and the block.
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
      `S-C session outline [dry run] (tiny world ${p.tinyWorldPresent ? "present" : "absent"}; undo ${p.undoAllowed ? "allow-listed" : "not allow-listed"}; U29 forward ${p.u29Forward ? "on" : "off"}; worst case ${Math.round(worstCaseTotalMs(steps) / 60_000)} min, an estimate)`,
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
      const ms = invocationWorstCaseMs(selectedIds({ from: b.from, until: b.until }, steps), steps);
      say(`    ${blockArgs(b)}: ${ms} ms`);
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
    err(
      "a real run needs --registry-export <the pre-flight reg export>: the gate reads Script Debug Mode from it",
    );
    stopped("usage: no --registry-export");
    return EXIT.usage;
  }
  // DEC-038: every relaunch reads the scratch profile (-forceSettings), never the owner's registry.
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
  if (!o["tiny-world"])
    say("no --tiny-world given: sc-11 to sc-13 are skipped and U13, U19 move to S-E");

  const needConfig = !o.sandbox || !o["workbench-path"] || !o["game-path"] || !o["logs-path"];
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
  const workbenchPath = o["workbench-path"] ?? config!.workbenchPath;
  const gamePath = o["game-path"] ?? config!.gamePath;
  ph = defaultPlaceholderContext({
    sandbox: sandboxDir,
    game: gamePath,
    tools: workbenchPath,
    v2: REPO_ROOT,
  });
  // DEC-032 (S-C read M3): writes go only to the sandbox of the Workbench the lease records.
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
  // DEC-032 (S-C read m8): the run folder lies inside the artifacts folder, outside every git tree.
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
    workbenchPath,
    gamePath,
    gproj,
    sandboxDir,
    logsPath: o["logs-path"] ?? config?.logsPath ?? null,
    runDir,
    evidenceDir: join(runDir, "evidence"),
    evidenceSession: SESSION,
    build,
    placeholders: ph,
    forceSettings,
  };
  const deps = (over.deps ?? realDeps)(input);
  const opts: SessionOptions = {
    sandboxDir,
    gproj,
    tinyWorld: o["tiny-world"] ?? null,
    walkerCmd,
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
    u13,
    u29Forward,
    registryExport: o["registry-export"],
    debugModeUnsetOk: args.flags.has("debug-mode-unset-ok"),
    forceSettings,
    ownedModuleClasses: (o["owned-module-classes"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    worldTitleUnchecked: args.flags.has("world-title-unchecked"),
  };
  const ids = selectedIds({ from: opts.from, until: opts.until, only: opts.only }, steps);
  deps.log(
    `S-C real run, lane ${lane.session}, run folder ${runDir}, nonce ${nonce}; steps ${ids.join(", ")}; ` +
      `this invocation's worst case (an estimate): ${invocationWorstCaseMs(ids, steps)} ms`,
  );
  // The lease stays alive for the whole invocation, burst and walks included (DEC-032 m10).
  lane.startHeartbeat(60_000);
  try {
    const report = await runSession(opts, deps, steps);
    deps.writeArtifact(`summary-${nonce}.json`, report);
    if (report.stop) {
      deps.log(`STOPPED at ${report.stop.step} (${report.stop.kind}): ${report.stop.reason}`);
    } else {
      deps.log(`S-C block done: ${ids[0]} to ${ids[ids.length - 1]}`);
    }
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
