/**
 * Wave W8 (GUI-only residue, settings, links, Diag Menu), the live battery
 * (docs/v2/design/phase5-w8-spec.md section 6, DEC-058, DEC-076). Built in the form of
 * tests/live/w6.live.ts: the same CLI, the same evidence, the same hand mechanism and the same stop
 * rules, with three phases instead of one:
 *
 *   prep       OFFLINE, no Workbench may run (`w8.live.ts prep`): the offline probes first, in the
 *              ruled order (P-W8-21, P-W8-06, P-W8-04: DEC-076 order 1), then the registry export
 *              hashed and the launch profile made by `wb_settings profile` (W8.0). The runbook then
 *              launches on that scratch ini with `-forceSettings`: the argv is the one `wb_launch
 *              forceSettings` builds (client.buildWorkbenchArgs; a test pins the equality).
 *   live       a GUI Workbench on the live lane's test bed (EMCP2_sandbox), `--really`: W8.0 gate and
 *              throwaway world, W8.1 to W8.13 hand-free, then a relaunch boundary, then the hand
 *              block W8.H (computer use, OI-W8-1) and the closable step.
 *   post       OFFLINE again after the post-flight closed Workbench (`w8.live.ts postcheck`): the
 *              registry export hash equals the prep hash, the snapshot diff is clean.
 *
 * The live phase reaches Workbench through the shipped TS tools run IN PROCESS over a
 * `WorkbenchClient` WITHOUT a Config (no lease, no auto-launch): the W8 tools through their register
 * functions on a capturing server (`registerWbSettings`, `registerWbLink`, `registerWbDiag`,
 * `registerWbMenu`, `registerWbGui`, plus `registerWbEditorTools` for wb_play/wb_stop and
 * `registerWbState`), the older ones through their run functions. `ENFUSION_GUI=1` is set for this
 * process only (wb_gui is opt-in).
 *
 * Rulings built in (DEC-076): P-W8-24 before any wb_diag call (no wb_diag step runs before
 * w8-20, and every later one depends on it); P-W8-02 before any drive step (every wb_gui drive step
 * depends on it); P-W8-03 before any dialog step (every dialog step depends on it). Never Save,
 * never a commit button: `dismiss` presses Cancel, Close or No only, and the battery's own plan
 * check refuses any other. OI-W8-5 launches (a debugger target, the Peer Tool) are not run. The
 * owner-hand picks (OI-W8-6) are recorded BLOCKED as blocked:OI-W8-6 unless `--owner-present`.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan, the battery's own W8 plan check (wb_gui rows, dismiss
 * buttons, scratch-only settings writes) and the queue with preflight's validateQueue; `--out`
 * writes the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/
 * W8-queue.json; a test keeps the two equal). The runbook is docs/v2/sessions/queues/W8.md.
 *
 * Stop rules (W6's): a dialog-like window already up refuses the step; the pid's windows are polled
 * while a step runs, except in a dialog step (it opens a dialog on purpose and checks before and
 * after) and a hand step; a LOST, WEDGED or MODAL_OPEN client error stops the battery; three
 * consecutive unexpected FAILs in one unit stop it; a mutating call is never retried; a step never
 * runs twice in one run folder; a probe whose kill criterion is met is recorded KILLED and the steps
 * that depend on it are SKIPPED.
 *
 * Usage:
 *   npx --no tsx tests/live/w8.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w8.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w8.live.ts prep --sitting-dir <dir> --profile <name> [--id <lane> --really]
 *   npx --no tsx tests/live/w8.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--skip-hand] [--owner-present]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--sweep-only <module>[,<module>]] [--sweep-limit <n>] [--sweep-no-tree]  (w8-30 bisect aid)
 *       [--run-dir <dir in the sitting>] [--port 5775] [--evidence-dir <dir>] [--build <tag>]
 *   npx --no tsx tests/live/w8.live.ts postcheck --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w8.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: 0 done (or dry run passed, or the relaunch boundary reached), 1 refused / plan check failed
 *       / a step FAILED, 2 usage, 3 stopped, 4 aborted (not the test bed), 5 handoff.
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
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { ACTIONS as SETTINGS_ACTIONS, registerWbSettings } from "../../src/tools/wb-settings.js";
import { ACTIONS as LINK_ACTIONS, registerWbLink } from "../../src/tools/wb-link.js";
import { registerWbDiag } from "../../src/tools/wb-diag.js";
import {
  MENU_ACTIONS,
  loadAllowListFile,
  loadMenuItems,
  registerWbMenu,
  type AllowListPack,
  type MenuItem,
} from "../../src/tools/wb-menu.js";
import {
  ACTIONS as GUI_ACTIONS,
  DIALOG_COMMIT_BUTTONS,
  WB_GUI_ENV,
  registerWbGui,
} from "../../src/tools/wb-gui.js";
import { registerWbEditorTools } from "../../src/tools/wb-editor.js";
import { registerWbState } from "../../src/tools/wb-state.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runView } from "../../src/tools/wb-view.js";
import { runScripts, type ScriptsArgs } from "../../src/tools/wb-scripts.js";
import { runScriptEditor } from "../../src/tools/wb-script-editor.js";
import { runResources } from "../../src/tools/wb-resources.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runAnimationGraph, type AnimationGraphArgs } from "../../src/tools/animation-graph.js";
import {
  runAnimationWorkspace,
  type WorkspaceRequest,
} from "../../src/tools/animation-workspace.js";
import { registerBehaviorTree } from "../../src/tools/behavior-tree.js";
import { loadConfig, type Config } from "../../src/config.js";
import { DISMISS_BUTTONS } from "../../src/gui/driver.js";
import {
  LOCATOR_PROBE,
  censusMismatch,
  censusName,
  ledgerSpec,
  loadCensusRows,
  loadLocatorRecords,
  readCurrentBuild,
  resolveLocator,
  type CensusRowLite,
  type LocatorProbeResult,
  type LocatorRecord,
  type LocatorSpec,
  type LocatorWindow,
} from "../../src/gui/locators.js";
import { compareBuilds } from "../../src/census/hygiene.js";
import type { UiaNode } from "../../src/gui/uia.js";
import { DEFAULT_CENSUS_ROOT } from "../../src/census/ledger-io.js";
import { ENGINE_ENUM, SCRIPT_ENUM, loadDiagCatalog } from "../../src/census/diag-catalog.js";
import { defaultExec as regExec, exportRegistry } from "../../src/settings/reg-export.js";
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

export const SESSION = "W8";

/**
 * The window watch of every polled step (W8 fix-up 1). Run 1 handed off a play step (w8-82-p07-diag-play) on the
 * play-mode transition: wb_play disables the main windows ("World Editor - ...", "Enfusion
 * Workbench - ...", Qt683QWindowIcon, unowned) and shows a disabled Qt683QWindowToolSaveBits
 * "Arma Reforger Workbench", owner 0; a screenshot afterwards showed no dialog and Workbench back in
 * edit mode. Those are busy windows (isBusyWindow); W5 fix-up 2's grace (busyGraceMs; W5's play steps pass under it)
 * waits them out for at most BUSY_GRACE_MS and is a handoff past it. An owned
 * window, a #32770, a known modal title or an unexpected window beside them is still a verdict at once.
 */
export const WATCH_OPTIONS: VerdictOptions = { popups: false, busyGraceMs: BUSY_GRACE_MS };
export const SCRIPT_PATH = "tests/live/w8.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W8.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W8-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const NOISE_REL = "docs/v2/sessions/queues/w8-noise.json";

export const GATE_STEP = "w8-05-gate";
export const HAND_GATE_STEP = "w8-90-hand-gate";
export const NETZERO_STEP = "w8-89-netzero";
export const CLOSABLE_STEP = "w8-98-closable";
export const POSTCHECK_STEP = "w8-99-postcheck";
/**
 * The last hand step (W8 run 8): the hand reopens the throwaway world and answers the engine's save
 * prompt No, so the world is clean (the hand block's fixture create and delete gone) before
 * CLOSABLE_STEP reopens it; run 8's w8-98 ended HANDOFF on that prompt.
 */
export const RELOAD_NO_STEP = "w8-97-world-reload-no";
/** The engine's save prompt on a world reload or close: its window title and its text. */
export const SAVE_PROMPT_TITLE = "Loading world";
export const SAVE_PROMPT_TEXT = "Do you want to save changes?";

/**
 * The scratch ini the launch names (W8.0): `wb_settings profile <profile>` writes `<profile>.ini`,
 * then `wb_settings set` writes the accept edit (ACCEPT_SETTING flipped) to `<profile>-accept.ini`,
 * the file the engine loads. w8-31 reads the flipped value back from the engine (the offline
 * tool's engine-accept proof). When the set is refused the launch falls back to `<profile>.ini` and
 * the prep record says so.
 */
export const PROFILE_INI = "<artifacts>/settings/scratch/<profile>-accept.ini";
/**
 * The engine-accept edit of wb_settings (the wave's offline writer): the World Editor Log Console's
 * "Show only error messages" filter, registry key `World Editor\LogWidget`, value `errorsOnly`
 * (ledger row setting:World Editor%2FLogWidget/errorsOnly), read back live through the census row
 * of its tool button (ui:WorldEditor/control/Log Console/Show only error messages, wb_gui read,
 * toggleState). View state only: it filters the Log Console's lines, nothing else.
 */
export const ACCEPT_SETTING = {
  section: "World Editor",
  key: "LogWidget/errorsOnly",
  row: "ui:WorldEditor/control/Log Console/Show only error messages",
} as const;
export const ACCEPT_SUFFIX = "-accept";
export const ACCEPT_STEP = "w8-31-settings-accept";
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
/**
 * The launch argv: exactly what `wb_launch forceSettings` builds (client.buildWorkbenchArgs with the
 * project and the scratch ini; -scriptAuthorizeAll is the 2.0 release standard). The runbook's
 * pre-flight passes the same arguments (the lane owns the lease, so wb_launch in process would be
 * refused by it); a test pins the equality with buildWorkbenchArgs.
 */
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  GPROJ,
  "-scriptAuthorizeAll",
  "-forceSettings",
  PROFILE_INI,
];

/** Every project file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W8_ROOT = `${THROWAWAY}/W8`;
export const WORLDS_DIR = `${W8_ROOT}/worlds`;
export const WORLD = `${WORLDS_DIR}/EMCP_W8_Tiny.ent`;
/** The vanilla world the closable step falls back to (never edited, never saved). */
export const VANILLA_WORLD = "worlds/Arland/EmptyArland.ent";

/**
 * The hand block's fixtures (inbox/w8/followups.md item 1): run 7 read 4 of 8 context menus and
 * acted 0 gestures because every surface was empty. Each fixture lies under _throwaway/W8/, is made
 * by a shipped tool, and is removed by the rollback (the files) or deleted live (the entity).
 */
export const ANIM_DIR = `${W8_ROOT}/anim`;
export const AI_DIR = `${W8_ROOT}/ai`;
export const ANIM_AW = `${ANIM_DIR}/EMCP_W8.aw`;
export const ANIM_AGR = `${ANIM_DIR}/EMCP_W8.agr`;
export const ANIM_AST = `${ANIM_DIR}/EMCP_W8.ast`;
export const ANIM_AGF = `${ANIM_DIR}/EMCP_W8.agf`;
export const BT = `${AI_DIR}/EMCP_W8.bt`;
/** The anim and tree files w8-07 makes (the .aw also writes its `_EventTable.ae`). */
export const FIXTURE_FILES: readonly string[] = [ANIM_AGR, ANIM_AST, ANIM_AGF, ANIM_AW, BT];
/**
 * The seed .agf the plant writes: one sheet with an empty Nodes block. No shipped tool writes a
 * new .agf (animation_graph edits an existing one; author writes only the .agr and .ast), so the
 * plant writes this skeleton and w8-07 adds the two nodes with `animation_graph edit addNode`.
 * CRLF, as the vanilla graph files are.
 */
export const AGF_SEED = [
  "AnimSrcGraphFile {",
  " Sheets {",
  "  AnimSrcGraphSheet Master {",
  "   Nodes {",
  "   }",
  "  }",
  " }",
  "}",
  "",
].join("\r\n");
/** The sheet AGF_SEED holds. */
export const AGF_SHEET = "Master";
/** The vanilla prop of W1's entity steps, at a fixed position in the throwaway world. */
export const FIXTURE_ENTITY = {
  prefab: "{3F23DA7ACAC0ED90}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et",
  name: "EMCP_W8_Fixture",
  coords: "4 0 4",
} as const;
/**
 * The x gap between the fixture graph's two nodes (EditorPos 0 0 and GAP 0): close together so the
 * Animation Editor's fit zoom leaves a node large enough to drag (W8 run 8, w8-95's graph canvas:
 * the hand reported the graph fitting at 5 percent zoom). Vanilla neighbours sit about 200 apart.
 */
export const FIXTURE_NODE_GAP = 200;
/**
 * w8-07's animation_graph calls in order (the w4-50 shapes): author writes the .agr and .ast;
 * two addNode edits on the planted .agf (confirm; a dry run first). The .agr addFile names the
 * registered .agf and is sent after the register (fixtureGraph).
 */
export const FIXTURE_GRAPH_CALLS: ReadonlyArray<[string, Raw]> = [
  [
    "author",
    {
      action: "author",
      vehicleName: "EMCP_W8",
      vehicleType: "wheeled",
      wheelCount: 2,
      outputPath: ANIM_DIR,
    },
  ],
  [
    "addNodeDry",
    {
      action: "edit",
      path: ANIM_AGF,
      op: "addNode",
      sheet: AGF_SHEET,
      nodeClass: "AnimSrcNodeBindPose",
      name: "EMCP_W8_Pose",
      editorPos: [0, 0],
    },
  ],
  [
    "addNodePose",
    {
      action: "edit",
      path: ANIM_AGF,
      op: "addNode",
      sheet: AGF_SHEET,
      nodeClass: "AnimSrcNodeBindPose",
      name: "EMCP_W8_Pose",
      editorPos: [0, 0],
      confirm: true,
    },
  ],
  [
    "addNodeQueue",
    {
      action: "edit",
      path: ANIM_AGF,
      op: "addNode",
      sheet: AGF_SHEET,
      nodeClass: "AnimSrcNodeQueue",
      name: "EMCP_W8_Queue",
      editorPos: [FIXTURE_NODE_GAP, 0],
      confirm: true,
    },
  ],
];
/** The tree w8-07 makes (W4's BT_SPEC shape): a Sequence root and one child. */
export const FIXTURE_BT_SPEC = {
  path: BT,
  root: {
    type: "Sequence",
    children: [{ type: "AITaskIdle", name: "EMCP_W8_Hold", props: { Period: 2 } }],
  },
};
/**
 * The curve of followups item 1(b). No shipped op writes one: an .agr curve is a
 * `CurveLibraries` block (AnimSrcGCTCurveLib), and animation_graph edit has no op for it. The
 * fixture record says so, and P-W8-18's curve canvas stays open on it.
 */
export const CURVE_GAP =
  "no shipped tool writes an animation curve: animation_graph edit has no CurveLibraries op and author writes none";

/** `plant` makes these folders (offline, Workbench closed); `rollback` removes _throwaway/W8/. */
export const PLANT_DIRS: readonly string[] = [W8_ROOT, WORLDS_DIR, ANIM_DIR, AI_DIR];
/** `plant` writes these files (offline): the seed graph only. */
export const PLANT_FILES: ReadonlyArray<{ rel: string; text: string }> = [
  { rel: ANIM_AGF, text: AGF_SEED },
];
export const PLANT_FILE = "plant-w8.json";
/** w8-82's screenshot after `wb_diag select`, for the hand block's judgement (followups item 5). */
export const SELECT_SHOT_FILE = "w8-82-select-shot.json";
/** The hand step that judges that screenshot (computer use; never a key sent). */
export const SELECT_SHOT_STEP = "w8-92-diag-select-shot";
/** Where the screenshot is judged: the render viewport, as data/recipes/opaque-regions.md finds it. */
export const VIEWPORT_REGION =
  "the World Editor render viewport (WorldRenderWindowQt / @SceneRenderWindow), located by data/recipes/opaque-regions.md step 3";
export const PREP_FILE = "w8-prep.json";
export const PREP_RUN = "prep";
export const POST_RUN = "post";
export const RESULT_FILE = "w8-result.json";
export const BATTERY_SNAPSHOT_FILE = "w8-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w8-battery-snapshot";
/** P-W8-02's results, one LocatorProbeResult per line: the input of scripts/census/locators-carry.ts. */
export const P02_RESULTS_FILE = "p-w8-02-results.jsonl";
/** Files whose change outside _throwaway/W8/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
export const HAND_WAIT_MS = 900_000;

export const TIMEOUTS = {
  step: 180_000,
  open: 600_000,
  poll: 5_000,
  ping: 10_000,
} as const;

/** w8-30: tries of one module's tree read while it answers INVALID_ARGUMENT (fix-up 1). */
export const TREE_TRIES = 3;

/**
 * Where a census element lives, for P-W8-02's share (fix-up 1). "window": the module's main window,
 * so a tree read of it can resolve the locator. "menu": an item inside a menu-bar popup (a label
 * path of two or more steps, or kind menu-item); "context": a context menu or its items; "dialog":
 * a dialog, or an automation id under another top-level window than the tree's root (FileDlg,
 * createWorldDialog, UserProfileDialog in run 2). None of these is in a window tree read while
 * nothing is open: run 2 counted 330 menu, 41 context and 30 dialog rows as unresolved.
 */
export function sweepSurface(
  row: Pick<CensusRowLite, "kind">,
  spec: { automationId?: string; path?: string[] },
  mainId: string,
): "window" | "menu" | "context" | "dialog" {
  const kind = S(row.kind);
  if (kind === "context-menu" || kind === "context-item") return "context";
  if (kind === "menu-item" || (spec.path && spec.path.length >= 2)) return "menu";
  if (kind === "dialog") return "dialog";
  const id = spec.automationId ?? "";
  if (
    mainId &&
    id.startsWith("Arma4WorkbenchApp.") &&
    id !== mainId &&
    !id.startsWith(`${mainId}.`)
  )
    return "dialog";
  return "window";
}

/** Why a main-window locator failed: none (no element), ambiguous (several share the id), mismatch. */
export function sweepFailure(res: { ok: boolean; count: number }, mismatch: string | null): string {
  if (res.ok) return mismatch ? "mismatch" : "ok";
  return res.count === 0 ? "none" : "ambiguous";
}

/**
 * DEC-078 ruling 3: the title bar's Maximize/Restore and Minimize/Restore buttons name the
 * window's state (run 2 and 3: the live title bar showed Maximize, the census Restore), so their
 * rows are recorded as `volatile`, outside P-W8-02's share.
 */
export const SWEEP_VOLATILE_IDS: readonly string[] = ["Maximize-Restore", "Minimize-Restore"];

/** True when the row's element is window state (DEC-078 ruling 3). */
export function sweepVolatile(spec: { automationId?: string }): boolean {
  return SWEEP_VOLATILE_IDS.includes(spec.automationId ?? "");
}

/**
 * The Object Properties grid items (followups item 4: Flags, General, Transformation, Angles,
 * Coords, Editor, Scale, Script): a TreeItem under `entityPropGrid` exists only while an entity is
 * selected. A row is selection-bound when its locator has an `itemPath` below that grid (DEC-078)
 * or its id names an item below it; the grid itself (`#entityPropGrid`) is not.
 */
export const SELECTION_BOUND_ROW = /\/Object Properties\/entityPropGrid\/[^/]+$/;

export function sweepSelectionBound(
  rowId: string,
  spec: { automationId?: string; itemPath?: string[] },
): boolean {
  if (SELECTION_BOUND_ROW.test(rowId)) return true;
  return (spec.itemPath?.length ?? 0) > 0 && (spec.automationId ?? "").endsWith(".entityPropGrid");
}

/** The locator w8-30 resolves for one row, and the build it was captured on. */
export interface SweepLocator {
  build: string;
  source: "build-file" | "ledger";
  spec: LocatorSpec;
  controlType: string | null;
}

/**
 * The newest locator of a row (fix-up 2): the build file's record (locators-carry.ts output,
 * `data/census/locators/1.9.0.37.jsonl`) or the ledger's (whose build-ledger already keeps the
 * newest observation's), whichever build is newer; a tie goes to the build file (P-W8-02 proved
 * it). So a 1.9.0.37 locator is swept in place of a 1.8.0.13 one for the same row. Null: neither.
 */
export function sweepLocator(row: CensusRowLite, rec?: LocatorRecord | null): SweepLocator | null {
  const ls = ledgerSpec(row);
  const ledger: SweepLocator | null = ls
    ? {
        build: row.locator?.build ?? "unrecorded",
        source: "ledger",
        spec: ls,
        controlType: row.locator?.controlType ?? null,
      }
    : null;
  const file: SweepLocator | null = rec
    ? {
        build: rec.build,
        source: "build-file",
        spec: {
          ...(rec.automationId ? { automationId: rec.automationId } : {}),
          ...(rec.ordinal !== undefined ? { ordinal: rec.ordinal } : {}),
          ...(rec.itemPath ? { itemPath: rec.itemPath } : {}),
          ...(rec.path ? { path: rec.path } : {}),
          ...(row.label ? { name: row.label } : {}),
          controlType: rec.controlType,
        },
        controlType: rec.controlType,
      }
    : null;
  if (!file) return ledger;
  if (!ledger) return file;
  const newer = (a: string, b: string): number => {
    try {
      return compareBuilds(a, b);
    } catch {
      return 0;
    }
  };
  return newer(ledger.build, file.build) > 0 ? ledger : file;
}

/** One build's main-window tally of P-W8-02. */
export interface SweepTally {
  rows: number;
  ok: number;
}

/**
 * P-W8-02's shares (fix-up 2): over every main-window row by its newest locator (the verdict),
 * per build, and on the newest build's locators alone (`newest`, null when none was swept).
 */
export function sweepShares(
  byBuild: Record<string, SweepTally>,
  newestBuild: string,
): { rows: number; ok: number; share: number; newest: (SweepTally & { share: number }) | null } {
  let rows = 0;
  let ok = 0;
  for (const t of Object.values(byBuild)) {
    rows += t.rows;
    ok += t.ok;
  }
  const nb = byBuild[newestBuild];
  return {
    rows,
    ok,
    share: rows ? ok / rows : 0,
    newest: nb && nb.rows ? { ...nb, share: nb.ok / nb.rows } : null,
  };
}

/** "1.8.0.13 220/295, 1.9.0.37 0/0": the per-build tally, oldest first. */
export function sweepByBuildText(byBuild: Record<string, SweepTally>): string {
  return Object.keys(byBuild)
    .sort((a, b) => {
      try {
        return compareBuilds(a, b);
      } catch {
        return a < b ? -1 : 1;
      }
    })
    .map((b) => `${b} ${byBuild[b].ok}/${byBuild[b].rows}`)
    .join(", ");
}

/** P-W8-02's pass mark (DEC-078): at least this share of the main-window locators resolve. */
export const P02_PASS_SHARE = 0.9;
/** P-W8-07: set with restore on at most this many allow-listed bool ids. */
export const P07_SET_MAX = 10;
/** P-W8-14: this many plugin dialogs. */
export const P14_DIALOGS = 5;
/** P-W8-12: at most this many tool buttons. */
export const P12_TOOLS = 10;

/** Blocks whose steps are independent proofs (the FAIL counter is per step there). */
export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set([
  "W8.P",
  "W8.1",
  "W8.2",
  "W8.6",
  "W8.8",
  "W8.9",
  "W8.H",
]);

export function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? `${s.block}/${s.id}` : s.block;
}

/** Client codes that stop the battery. */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/**
 * The answers of an action a ruling or a probe still gates (spec 1.2.7): recorded with the switch
 * behind it, never a FAIL. NO_LOCATOR and LOCATOR_STALE until the carry of P-W8-02 has run;
 * GATED and UNPROVEN until gui.rows_enabled, diag.set_allow_list, SETTINGS_GATES or LINK_GATES
 * open the row or the action; NOT_ALLOWLISTED and MODAL_HAZARD are the refusals the rulings keep.
 */
export const WAIT_CODES: ReadonlySet<string> = new Set([
  "GATED",
  "UNPROVEN",
  "NO_LOCATOR",
  "LOCATOR_STALE",
  "NOT_ALLOWLISTED",
  "MODAL_HAZARD",
]);
/** Domain refusals that prove a handler compiled and answered. */
export const DOMAIN_CODES: ReadonlySet<string> = new Set([
  ...WAIT_CODES,
  "INVALID_ARGUMENT",
  "STALE_CURSOR",
  "DIAG_UNKNOWN",
  "WRONG_MODE",
  "NO_WORLD",
  "MODULE_NOT_OPEN",
  "MODULE_NOT_SUPPORTED",
  "ENGINE_FALSE",
  "RESOURCE_NOT_FOUND",
  "PRECONDITION_UNMET",
]);

/** Where the switch behind each gate lives, named in the records and in the report. */
export const SWITCHES: Readonly<Record<string, string>> = {
  gui: "data/census/policy.json gui.rows_enabled (and data/census/locators/1.9.0.37.jsonl from scripts/census/locators-carry.ts)",
  diag: "data/census/policy.json diag.set_allow_list (seeded empty, OD-6)",
  shortcuts: "src/tools/wb-settings.ts SETTINGS_GATES.shortcuts (P-W8-06)",
  options: "src/tools/wb-settings.ts SETTINGS_GATES.options (P-W8-05)",
  link: "src/tools/wb-link.ts LINK_GATES.open (P-W8-11)",
  menu: "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_ActionAllowList.c (P-W8-22)",
};

/** Titles a step may add: the editors' main windows. */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
export const WORKBENCH_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  /^World Editor$/,
  DEBUG_TITLE,
  /^Script Editor( - .+)?$/,
  /^Enfusion Workbench( - .+)?$/,
  /^Arma Reforger Workbench( - .+)?$/,
  /^String Editor( - .+)?$/,
  /^Localization Editor( - .+)?$/,
  /^Procedural Animation Editor( - .+)?$/,
  /^Behavior Editor( - .+)?$/,
  /^Audio Editor( - .+)?$/,
  /^Animation Editor( - .+)?$/,
];

/** The window each swept module's locators live in (LocatorWindow; the class is the editors'). */
export const EDITOR_CLASS = "Qt683QWindowIcon";
export const MODULE_WINDOWS: Readonly<Record<string, string>> = {
  WorldEditor: "^World Editor( - .+)?$",
  ResourceManager: "^(Enfusion Workbench|Arma Reforger Workbench)( - .+)?$",
  ScriptEditor: "^Script Editor( - .+)?$",
  LocalizationEditor: "^(Localization Editor|String Editor)( - .+)?$",
  ProcAnimEditor: "^Procedural Animation Editor( - .+)?$",
  BehaviorEditor: "^Behavior Editor( - .+)?$",
  AudioEditor: "^Audio Editor( - .+)?$",
  AnimEditor: "^Animation Editor( - .+)?$",
};
/** Modules W8.3 does not open, with the reason (their rows are recorded as not swept). */
export const NOT_SWEPT: Readonly<Record<string, string>> = {
  ParticleEditor: "blocked:DEC-042 (OI-W8-4): the module does not answer GetModule",
  Launcher: "the launcher window is not open while a project is (P-W8-19, W8.12)",
  NavmeshGeneratorMain: "a World Editor tool window with no module of its own; not opened by W8.3",
  "ResourceManager.*":
    "a resource sub-editor not in VIEWER_EXTENSIONS: w8-30 opens only the eight it knows a file type for",
};

/** The resource sub-editors W8.8 opens, with the extension of a vanilla resource to find. */
export const VIEWER_EXTENSIONS: Readonly<Record<string, string>> = {
  "ResourceManager.Config": "conf",
  "ResourceManager.Font": "fnt",
  "ResourceManager.Imageset": "imageset",
  "ResourceManager.Layout": "layout",
  "ResourceManager.Material": "emat",
  "ResourceManager.Model": "xob",
  "ResourceManager.Styles": "styles",
  "ResourceManager.Texture": "edds",
};

/** The eight context-menu surfaces of P-W8-15 (probe file). */
export const CONTEXT_SURFACES: readonly string[] = [
  "World Editor: Hierarchy",
  "Resource Manager: Resource Browser",
  "World Editor: Layers",
  "Script Editor: a file tab",
  "World Editor: Log Console",
  "World Editor: Object Properties",
  "Animation Editor: the graph",
  "Behavior Editor: the tree",
];

/**
 * P-W8-18's three canvases (followups item 1): each needs one gesture acted and undone. The graph
 * and the gizmo have a fixture (w8-07); the curve has none (CURVE_GAP), so it can stay open.
 */
export const GESTURE_CANVASES: readonly string[] = ["graph", "curve", "gizmo"];

/** P-W8-18's verdict: SETTLED with one acted and undone gesture per canvas; KILLED on one not undone. */
export function judgeGestures(a: Raw | null, extra: Raw = {}): ProbeResult {
  const g = Array.isArray(a?.gestures) ? (a!.gestures as Raw[]) : [];
  const observed: Raw = { gestures: g, fixtures: extra.fixtures ?? null, curve: CURVE_GAP };
  if (!a) return partial("P-W8-18", observed, "no hand answer");
  const notUndone = g.filter((x) => truthy(x.acted) && !truthy(x.undone));
  if (notUndone.length)
    return killed("P-W8-18", observed, `${notUndone.length} gesture(s) not undone`);
  const done = GESTURE_CANVASES.filter((c) =>
    g.some((x) => S(x.canvas).toLowerCase() === c && truthy(x.acted) && truthy(x.undone)),
  );
  const missing = GESTURE_CANVASES.filter((c) => !done.includes(c));
  return missing.length === 0
    ? settled(
        "P-W8-18",
        observed,
        "one gesture acted and undone on each canvas (graph, curve, gizmo)",
      )
    : partial(
        "P-W8-18",
        observed,
        `${done.length} of ${GESTURE_CANVASES.length} canvases acted and undone; missing: ${missing.join(", ")}`,
      );
}

/** The probe ids P-W8-01 .. P-W8-24. */
export const PROBE_IDS: readonly string[] = Array.from(
  { length: 24 },
  (_, i) => `P-W8-${String(i + 1).padStart(2, "0")}`,
);

/** Probes no step can settle in this battery (the rest are assigned to steps). */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {};

/** This wave's handler contracts (contracts/<handler>.json) and the tool that sends each. */
export const W8_CONTRACTS: Readonly<Record<string, W8Tool>> = { EMCP_WB_Diag: "wb_diag" };

/**
 * The TS-only actions of the wave's tools (spec 1.1; no contract of their own): the tools' own
 * exported lists, so a new action cannot escape the coverage test. wb_scripts gains only
 * IsWorldEditorRunning in `status` (TS-6).
 */
export const TS_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  wb_settings: [...SETTINGS_ACTIONS],
  wb_link: [...LINK_ACTIONS],
  wb_menu: [...MENU_ACTIONS],
  wb_gui: [...GUI_ACTIONS],
  wb_scripts: ["status"],
};

/** Actions no step exercises, with the reason. */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {
  "wb_gui.setValue":
    "OD-5: Options and field writes go to a scratch ini offline with Workbench closed and are read back live; OK is a commit button and is never pressed, so no field row is driven by setValue in W8 (P-W8-05 reads the fields only)",
};

// ── Types ────────────────────────────────────────────────────────────────────

export type W8Tool =
  | "wb_settings"
  | "wb_link"
  | "wb_diag"
  | "wb_menu"
  | "wb_gui"
  | "wb_module"
  | "wb_world"
  | "wb_view"
  | "wb_scripts"
  | "wb_script_editor"
  | "wb_resources"
  | "wb_play"
  | "wb_stop"
  | "wb_state"
  | "wb_entity"
  | "wb_undo_redo"
  | "animation_graph"
  | "animation_workspace"
  | "behavior_tree";

/** The wave's offline proofs, run in process (no NET call). */
export type OfflineTool =
  | "scan"
  | "registry"
  | "census"
  | "snapshot"
  | "animation_graph"
  | "animation_workspace"
  | "behavior_tree";

/** The route each tool's plan entry names: a handler, or what the TS tool does instead. */
export const ROUTE_OF: Readonly<Record<W8Tool, string>> = {
  wb_settings: "TS wb_settings (registry read by reg export; scratch ini files only)",
  wb_link:
    "TS wb_link (open dispatches through EMCP_WB_Module, EMCP_WB_View, EMCP_WB_ScriptEditor)",
  wb_diag: "EMCP_WB_Diag",
  wb_menu: "TS wb_menu (list and describe read the ledger; nothing is sent)",
  wb_gui: "UIA wb_gui (in process; no NET call)",
  wb_module: "EMCP_WB_Module",
  wb_world: "EMCP_WB_World",
  wb_view: "EMCP_WB_View",
  wb_scripts: "EMCP_WB_Scripts",
  wb_script_editor: "EMCP_WB_ScriptEditor",
  wb_resources: "EMCP_WB_Resources",
  wb_play: "EMCP_WB_EditorControl",
  wb_stop: "EMCP_WB_EditorControl",
  wb_state: "EMCP_WB_GetState",
  wb_entity: "EMCP_WB_Entity",
  wb_undo_redo: "EMCP_WB_EditorControl",
  animation_graph: "offline file tool animation_graph (in process; no NET call)",
  animation_workspace:
    "offline file tool animation_workspace (in process; create registers the .aw through EMCP_WB_Resources)",
  behavior_tree: "offline file tool behavior_tree (in process; no NET call)",
};

/** The handler wb_menu run reaches (the dry-run gate checks its path against the allow-list). */
export const EXECUTE_ACTION_ROUTE = "EMCP_WB_ExecuteAction";
/** A refusal the TS tool raises before anything is sent: no NET call. */
export const REFUSED_IN_TS = "TS refusal (nothing sent)";

export type Block =
  | "W8.P"
  | "W8.0"
  | "W8.1"
  | "W8.2"
  | "W8.3"
  | "W8.4"
  | "W8.5"
  | "W8.6"
  | "W8.7"
  | "W8.8"
  | "W8.9"
  | "W8.10"
  | "W8.11"
  | "W8.12"
  | "W8.13"
  | "W8.F"
  | "W8.H"
  | "W8.X"
  | "W8.Z";
export type Phase = "prep" | "live" | "post";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "KILLED" | "NOT-RUN" | "SKIPPED" | "BLOCKED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED" | "HELD";

export interface ProbeResult {
  id: string;
  /** SETTLED: answered as the probe asks; KILLED: its kill criterion met; PARTIAL: part answered. */
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

export interface StepOutcome {
  status: Verdict;
  detail: string;
  evidence: Record<string, unknown>;
  probes?: ProbeResult[];
  /** Lines the runner writes to a sitting file once the step's evidence id is known. */
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
  probes: ProbeResult[];
  evidence: Record<string, unknown>;
  evidenceId?: string | null;
  stop?: string;
}

/** The P-W8-23 two-client probe: a long call on one client, a ping on a second. */
export interface BacklogResult {
  firstOk: boolean;
  firstMs: number;
  firstCode: string | null;
  secondOk: boolean;
  secondMs: number;
  secondCode: string | null;
  /** The second connection was refused (not merely queued). */
  secondRefused: boolean;
}

export interface RegistryHash {
  ok: boolean;
  sha256: string;
  /** The export file, in placeholder form when written to a record. */
  path: string;
  /** The export's text (UTF-16 decoded by the caller when needed), for the offline searches. */
  text: string;
  error?: string;
}

export interface W8Deps {
  /** One shipped TS tool, run in process against a client WITHOUT a Config. */
  tool: (name: W8Tool, args: Raw) => Promise<ToolResponse>;
  info: () => Promise<Raw | null>;
  ping: () => Promise<Raw | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  /** The command line of a process (the launch's -forceSettings check). */
  commandLine: (pid: number) => Promise<string | null>;
  workbenchPids: () => number[];
  /** A read-only `reg export` of the Workbench key into the artifacts folder, hashed. */
  registryExport: () => Promise<RegistryHash>;
  backlog: () => Promise<BacklogResult>;
  /** The ledger's ui rows (core shard). */
  censusRows: () => Map<string, CensusRowLite>;
  /** data/census/locators/<build>.jsonl: the 1.9 locators the carry wrote. */
  locators: () => Map<string, LocatorRecord>;
  menuItems: () => MenuItem[];
  menuAllowList: () => AllowListPack;
  /** The diag catalog's names: SCR_DebugMenuID, EDiagMenu, and menu paths; null when absent. */
  diagNames: () => { script: string[]; engine: string[]; menus: string[] } | null;
  /** policy.json diag.set_allow_list (seeded empty). */
  setAllowList: () => string[];
  /** policy.json gui.rows_enabled (absent: empty). */
  rowsEnabled: () => string[];
  /** The E02 source index of the build (P-W8-21), null when absent. */
  sourceIndexPath: () => string | null;
  /** Names and sizes under the Workbench profile folder (P-W8-09's state-file listing). */
  profileListing: () => string[];
  /** The OS user name (the redaction check of wb_diag info). */
  userName: () => string;
  artifactsRoot: () => string;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W8Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** The scratch profile name (prep: made; live: read from the prep record). */
  profile?: string;
  skipHand?: boolean;
  /** The owner is at the screen: the OI-W8-6 picks may run. */
  ownerPresent?: boolean;
  /** Exit-crash bisect aid (w8-exit-crash.md): narrows w8-30's GUI work. Absent: the full sweep. */
  sweep?: SweepFilter;
}

/**
 * The w8-30 bisect filter (w8-exit-crash.md). `only`: the census modules swept (WorldEditor,
 * ResourceManager, ResourceManager.Material, ...), in the sweep's own order. `limit`: the first n
 * modules of that order, after `only`; each module is one open (or, for a sub-editor, one
 * setResource) plus its tree read(s), so this is the unit of GUI work a bisect halves. `noTree`:
 * every open/setResource runs, no wb_gui tree read (nor the fixture selection) is sent.
 */
export interface SweepFilter {
  only?: string[];
  limit?: number;
  noTree?: boolean;
}

/** --sweep-only / --sweep-limit / --sweep-no-tree to a SweepFilter (null: none given), or a usage error. */
export function parseSweepFilter(
  only: string | undefined,
  limit: string | undefined,
  noTree: boolean,
): SweepFilter | null | string {
  if (only === undefined && limit === undefined && !noTree) return null;
  const f: SweepFilter = {};
  if (only !== undefined) {
    const list = only
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return "--sweep-only names no module";
    f.only = list;
  }
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1)
      return `--sweep-limit takes a whole number of 1 or more, not ${limit}`;
    f.limit = n;
  }
  if (noTree) f.noTree = true;
  return f;
}

/**
 * The exit-crash mitigation (w8-exit-crash.md, bis5 to bis14): no existing action closes a Resource
 * Manager sub-editor tab (wb_module close is refused, Window > Close Tab is not on the ExecuteAction
 * allow-list, wb_gui invoke is GATED), and five tabs read in one launch crashed Workbench's exit
 * (bis8) while three never did (bis6, bis11). So one launch opens at most these three; w8-30 and
 * w8-75 record the other five as not swept, to be read in launches of their own (at most three
 * each, `--only w8-30-p02-locator-sweep --sweep-only ...`). bis6 read exactly these three cleanly.
 */
export const SUB_EDITOR_CAP = 3;
export const LAUNCH1_SUB_EDITORS: readonly string[] = [
  "ResourceManager.Material",
  "ResourceManager.Model",
  "ResourceManager.Texture",
];
export const SUB_EDITOR_CAP_WHY = `sub-editor cap: at most ${SUB_EDITOR_CAP} Resource Manager sub-editors per launch, and no tool can close one (w8-exit-crash.md); sweep it in its own launch: --only w8-30-p02-locator-sweep --sweep-only <at most ${SUB_EDITOR_CAP}>`;

/**
 * The modules w8-30 sweeps, in order, and the ones left out. Without `only`, the sub-editors outside
 * LAUNCH1_SUB_EDITORS are left out (`capped`, the exit-crash cap); an explicit `only` (a bisect or a
 * follow-up launch) is taken as given. An `only` name that is not a census module of the sweep is
 * reported in `unknown` (the step FAILs on it).
 */
export function applySweepFilter(
  order: readonly string[],
  filter: SweepFilter | undefined,
): { kept: string[]; dropped: string[]; capped: string[]; unknown: string[] } {
  const capped = filter?.only
    ? []
    : order.filter((m) => m in VIEWER_EXTENSIONS && !LAUNCH1_SUB_EDITORS.includes(m));
  let kept = filter?.only
    ? order.filter((m) => filter.only!.includes(m))
    : order.filter((m) => !capped.includes(m));
  const unknown = (filter?.only ?? []).filter((m) => !order.includes(m));
  if (filter?.limit !== undefined) kept = kept.slice(0, filter.limit);
  return {
    kept,
    dropped: order.filter((m) => !kept.includes(m) && !capped.includes(m)),
    capped,
    unknown,
  };
}

export interface Debt {
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W8Deps;
  opts: W8Options;
  prior: (id: string) => StepRecord | null;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  state: Map<string, unknown>;
  tool: (name: W8Tool, args: Raw, o?: { tolerate?: boolean }) => Promise<ToolResponse>;
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
  phase: Phase;
  title: string;
  risk: Risk;
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  probes: string[];
  /** Probes whose KILLED result skips this step. */
  dependsOn?: string[];
  /** Project-relative files or folders this step may create or change. */
  writes: string[];
  expectsWindows?: readonly RegExp[];
  /** Opens a dialog on purpose: no window poll; refused over a dialog before, HANDOFF over one after. */
  dialog?: boolean;
  hand?: boolean;
  /** The run ends after this step: the runbook closes and relaunches before the next. */
  boundary?: string;
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

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => S(x)) : [];
}

function readJson<T>(path: string, deps: Pick<W8Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W8Deps, "writeBytes">): void {
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
export function verdictOf(
  fails: string[],
  probes: ProbeResult[],
  passDetail: string,
): Pick<StepOutcome, "status" | "detail"> {
  if (fails.length) return { status: "FAIL", detail: fails.join("; ") };
  const k = probes.filter((p) => p.result === "KILLED");
  if (k.length) return { status: "KILLED", detail: k.map((p) => `${p.id}: ${p.note}`).join("; ") };
  return { status: "PASS", detail: passDetail };
}

/** "acted" / "ok" for an answer, else its refusal code. */
export function answerOf(r: ToolResponse | null): string {
  if (!r) return "not sent";
  return r.ok ? "ok" : S(r.code) || "error";
}

/** True when the answer is ok or one of the gated refusals (recorded, never a FAIL). */
export function okOrWaiting(r: ToolResponse): boolean {
  return r.ok || WAIT_CODES.has(S(r.code));
}

/** The switch named for a waiting answer of a tool. */
export function switchFor(tool: W8Tool, code: string): string {
  if (code === "NO_LOCATOR" || code === "LOCATOR_STALE") return SWITCHES.gui!;
  if (tool === "wb_gui") return SWITCHES.gui!;
  if (tool === "wb_diag") return SWITCHES.diag!;
  if (tool === "wb_link") return SWITCHES.link!;
  if (tool === "wb_menu") return SWITCHES.menu!;
  return "the ruling named in the refusal";
}

/** A user name redacted out of a text (wb_diag info, spec 7: the TS side redacts it). */
export function leaksUser(text: string, user: string): boolean {
  if (!user || user.length < 3) return false;
  return text.toLowerCase().includes(user.toLowerCase());
}

/** The values of a wb_diag get answer as name to value ("name=value", "name;value" or pairs). */
export function diagValues(r: ToolResponse): Map<string, string> {
  const out = new Map<string, string>();
  const v = rb(r).values;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Raw)) out.set(k, S(x));
    return out;
  }
  const list = strs(v);
  const paired = list.every((x) => /[=;]/.test(x));
  if (paired) {
    for (const x of list) {
      const m = /^([^=;]+)[=;](.*)$/.exec(x);
      if (m) out.set(m[1]!.trim(), m[2]!.trim());
    }
    return out;
  }
  for (let i = 0; i + 1 < list.length; i += 2) out.set(list[i]!, list[i + 1]!);
  return out;
}

/**
 * A UIA tree out of a wb_gui tree answer: the node inline (`tree`), or the JSON file it names.
 * Fix-up 1: a tree over wb_gui's inline limit answers `file` relative to the artifacts folder
 * (`relativeTo: "artifacts"`) and an `outline` of only OUTLINE_DEPTH (2) levels. Run 2's w8-30
 * resolved the World Editor's locators against that outline (the `file` was looked up relative to
 * the working folder and not found), so every element deeper than two levels "did not resolve":
 * 90 of the 1.8 locators that resolve against the saved tree. The outline is never a tree here.
 */
export function treeOf(
  r: ToolResponse,
  deps: Pick<W8Deps, "exists" | "readBytes" | "artifactsRoot">,
): UiaNode | null {
  const x = rb(r);
  const isNode = (v: unknown): v is UiaNode =>
    !!v && typeof v === "object" && "controlType" in (v as Raw);
  for (const k of ["tree", "root"]) if (isNode(x[k])) return x[k] as UiaNode;
  if (isNode(x) && !("outline" in x)) return x as unknown as UiaNode;
  for (const k of ["file", "path", "treeFile"]) {
    const named = S(x[k]);
    if (!named || !named.toLowerCase().endsWith(".json")) continue;
    const inArtifacts = join(deps.artifactsRoot(), ...named.split("/"));
    const candidates = S(x.relativeTo) === "artifacts" ? [inArtifacts] : [named, inArtifacts];
    for (const p of candidates) {
      if (!deps.exists(p)) continue;
      const v = readJson<unknown>(p, deps);
      if (isNode(v)) return v;
      if (v && typeof v === "object" && isNode((v as Raw).tree)) return (v as Raw).tree as UiaNode;
    }
  }
  return null;
}

/**
 * The first registered hit of a wb_resources search as a plain project path: the `{GUID}` prefix
 * dropped, the empty names of unregistered files skipped (W2 fix-up 1, causes 3), never a path
 * under _throwaway/ (a fixture of another wave is not this battery's to open). "" when none.
 */
export function firstResourcePath(r: ToolResponse | null): string {
  const x = rb(r);
  const list = Array.isArray(x.items) ? x.items : Array.isArray(x.results) ? x.results : [];
  for (const it of list as unknown[]) {
    const raw = it && typeof it === "object" ? S((it as Raw).name ?? (it as Raw).path) : S(it);
    const path = raw.replace(/^\{[0-9A-Fa-f]{16}\}/, "").trim();
    // W8 run 8: the first .conf hit was `$profile:...`, which setResource refuses (ABSOLUTE_PATH);
    // a `$name:` filesystem-prefixed hit is not a project path and is skipped.
    if (path && !path.startsWith(`${THROWAWAY}/`) && !/^\$[A-Za-z0-9_]+:/.test(path)) return path;
  }
  return "";
}

/** Locator records (1.9) whose row id matches, in file order, at most `limit`. */
export function pickRows(
  records: Map<string, LocatorRecord>,
  pattern: RegExp,
  limit = Infinity,
): LocatorRecord[] {
  const out: LocatorRecord[] = [];
  for (const r of records.values()) {
    if (pattern.test(r.rowId)) out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** What the viewer helpers need from a step: a tool call, a wait and the lane's recorded pid. */
export interface ViewerCalls {
  tool: (name: "wb_resources" | "wb_module" | "wb_gui", args: Raw) => Promise<ToolResponse>;
  sleep: (ms: number) => Promise<void>;
  pid: () => number | null;
}

/** A sub-editor's vanilla file opened (or not): the search, the path picked, the setResource. */
export interface ViewerOpen {
  resource: string;
  search: ToolResponse;
  /** Null when the search found no registered vanilla file. */
  set: ToolResponse | null;
}

/**
 * One vanilla resource opened in a sub-editor, the P4-9 route (w8-30, w8-75, and
 * scripts/census/live/rewalk-subeditors.ts): the first registered hit of a `wb_resources search`
 * for the sub-editor's VIEWER_EXTENSIONS type, opened with `wb_module setResource` on the Resource
 * Manager (a tab of the RM window). Read-only: the file is packed vanilla data and is never saved.
 */
export async function openViewerResource(c: ViewerCalls, module: string): Promise<ViewerOpen> {
  const ext = VIEWER_EXTENSIONS[module];
  if (!ext) throw new Error(`${module} is not a sub-editor of VIEWER_EXTENSIONS`);
  const search = await c.tool("wb_resources", {
    action: "search",
    extensions: [ext],
    recursive: true,
    limit: 20,
  });
  // W2 run 1: items are `{GUID}path` strings and an unregistered hit comes back "";
  // setResource takes the plain path, so the GUID is dropped and empties are skipped.
  const resource = firstResourcePath(search);
  if (!resource) return { resource, search, set: null };
  const set = await c.tool("wb_module", {
    action: "setResource",
    module: "ResourceManager",
    target: `path:${resource}`,
  });
  return { resource, search, set };
}

/** The sub-editor's `File > Close` row in the carried 1.9 locators, if any (w8-75). */
export function viewerCloseRow(
  records: Map<string, LocatorRecord>,
  module: string,
): LocatorRecord | undefined {
  const esc = module.replace(/\./g, "\\.");
  return pickRows(records, new RegExp(`^ui:${esc}/menu-item/(&)?File/Close$`, "i"), 1)[0];
}

/**
 * `File > Close` on the unmodified document (w8-75's clean close): invoke the row by its id, wait a
 * second, read the modal list. A prompt is returned by title and never answered here: the caller
 * stops or hands off (never Save).
 */
export async function closeViewerDocument(
  c: ViewerCalls,
  rowId: string,
): Promise<{ close: ToolResponse; prompt: string[] }> {
  const close = await c.tool("wb_gui", {
    action: "invoke",
    rowId,
    confirm: true,
    pid: c.pid() ?? undefined,
  });
  await c.sleep(1_000);
  const after = await c.tool("wb_gui", { action: "modals", pid: c.pid() ?? undefined });
  return { close, prompt: modalTitles(after) };
}

/** True when a label is a commit button or a policy deny label (the battery's own deny check). */
export function deniedLabel(label: string, denyLabels: readonly string[]): string | null {
  const n = label
    .replace(/&/g, "")
    .replace(/(\.\.\.|…)$/, "")
    .trim()
    .toLowerCase();
  for (const b of DIALOG_COMMIT_BUTTONS) if (n === b.toLowerCase()) return b;
  for (const d of denyLabels) if (!d.includes(":") && n === d.toLowerCase()) return d;
  return null;
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The plan entry of one tool call: the route it takes, the action, the tool and the tool action. */
export function tc(
  tool: W8Tool,
  action: string,
  params: Raw = {},
  extra: { toolAction?: string; note?: string; target?: string } = {},
): PlanAction {
  return {
    kind: "net-call",
    target: extra.target ?? ROUTE_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: extra.toolAction ?? action,
    note: extra.note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

/** One wb_menu run that reaches ExecuteAction: its path as segments, which checkPlan checks. */
export function menuRunPlan(module: string, segments: string[], confirm: boolean): PlanAction {
  return {
    kind: "net-call",
    target: EXECUTE_ACTION_ROUTE,
    params: { action: "run", module, menuPath: [...segments], ...(confirm ? { confirm } : {}) },
    tool: "wb_menu",
    toolAction: "run",
    note: confirm
      ? "confirmed: the item is on the allow-list, opens no dialog and is not a risk item"
      : "no confirm: a dry run for a mutating item; a safe item runs",
  } as PlanAction;
}

/** A wb_gui drive call by census row id (a free name is never planned, spec 1.2.1). */
export function guiDrive(action: string, rowId: string, note: string): PlanAction {
  return tc("wb_gui", action, { rowId, confirm: true }, { note });
}

export function oc(tool: OfflineTool, action: string, params: Raw = {}): OfflineCall {
  return { tool, action, params: { action, ...params } };
}

/** Tool actions that write a file (the plan scan of the harness test checks their paths). */
export const FILE_WRITE_ACTIONS: ReadonlySet<string> = new Set(["wb_world.new"]);

/** The wb_gui actions that act on an element. */
export const GUI_DRIVE_ACTIONS: ReadonlySet<string> = new Set([
  "invoke",
  "expand",
  "toggle",
  "select",
  "setValue",
]);

/**
 * The battery's own gate over the plan, beside checkPlan (which has no kind for wb_gui): every
 * wb_gui drive call names a census row id and no free name, path or automation id; no wb_gui call
 * names a commit button or a deny label; dismiss presses Cancel, Close or No only; wb_settings
 * writes name a scratch ini, never the registry; nothing saves.
 */
export function w8PlanViolations(plan: PlanAction[], policy: CensusPolicy): string[] {
  const deny: string[] = [];
  const lists = (policy as unknown as { deny_lists?: Record<string, { labels?: unknown }> })
    .deny_lists;
  for (const l of Object.values(lists ?? {}))
    if (l && Array.isArray(l.labels)) deny.push(...l.labels.map(String));
  const out: string[] = [];
  plan.forEach((a, i) => {
    const p = (a.params ?? {}) as Raw;
    const where = `action ${i} (${String(a.step ?? "")} ${String(a.tool ?? a.kind)}.${String(a.toolAction ?? "")})`;
    if (a.kind === "net-call" && (p.action === "save" || /save/i.test(S(a.toolAction))))
      out.push(`${where}: a save is never planned`);
    if (a.tool === "wb_gui") {
      const act = S(a.toolAction);
      if (GUI_DRIVE_ACTIONS.has(act)) {
        if (typeof p.rowId !== "string" || !p.rowId)
          out.push(`${where}: a drive call needs a census row id`);
        for (const k of ["name", "path", "automationId"])
          if (p[k] !== undefined) out.push(`${where}: a drive call names ${k}, not a row id`);
        const last = S(p.rowId).split("/").pop() ?? "";
        const hit = deniedLabel(last, deny);
        if (hit) out.push(`${where}: row ${S(p.rowId)} is the denied label "${hit}"`);
      }
      if (act === "dismiss") {
        const b = p.button === undefined ? null : S(p.button);
        if (b !== null && !(DISMISS_BUTTONS as readonly string[]).includes(b))
          out.push(`${where}: dismiss presses "${b}"; only ${DISMISS_BUTTONS.join(", ")}`);
      }
    }
    if (a.tool === "wb_settings" && ["set", "unset", "profile"].includes(S(a.toolAction))) {
      if (S(p.store).toLowerCase() === "registry" || /^hk/i.test(S(p.path)))
        out.push(`${where}: a settings write names the registry`);
    }
    if (a.tool === "wb_menu" && a.toolAction === "run" && a.target === EXECUTE_ACTION_ROUTE) {
      const segs = strs(p.menuPath);
      for (const s of segs) {
        const hit = deniedLabel(s, deny);
        if (hit) out.push(`${where}: menu path segment "${s}" is the denied label "${hit}"`);
      }
    }
  });
  return out;
}

// ── Row and menu picks (offline, deterministic over the repo's data) ─────────

/**
 * The P-W8-22 picks (DEC-100): World Editor Window-menu items with a passing live result. Each is on
 * the compiled pack and the policy allow-list (both hold only proven paths since DEC-100), its own
 * World Editor ledger row has the execute-action path verified (a live run toggled and restored it
 * in that module, not only in another), it opens no dialog by its label, it is not on
 * `execute_action.dialog_openers` (Window > Manage Layouts, W8 regress1, EV-W8-277) and it carries
 * no refused risk. No fallback: an item the ledger does not show proven is never drawn.
 */
export function menuRunPicks(
  items: MenuItem[],
  pack: AllowListPack,
  policyAllow: ReadonlyArray<string | string[]>,
  dialogOpeners: ReadonlyArray<string | string[]> = [],
): MenuItem[] {
  const key = (segs: readonly string[]): string => segs.join("\u0000");
  const keysOf = (l: ReadonlyArray<string | string[]>): Set<string> =>
    new Set(l.map((e) => key(Array.isArray(e) ? e : String(e).split(/\s*>\s*/))));
  const policyKeys = keysOf(policyAllow);
  const openers = keysOf(dialogOpeners);
  const listed = (segs: readonly string[]): boolean =>
    pack.paths.some((p) => p.length === segs.length && p.every((s, i) => s === segs[i]));
  return items.filter(
    (i) =>
      i.module === "WorldEditor" &&
      i.segments[0] === "Window" &&
      i.verified &&
      !i.opensDialog &&
      !openers.has(key(i.segments)) &&
      !["destructive", "external", "credential"].includes(i.risk) &&
      listed(i.segments) &&
      policyKeys.has(key(i.segments)),
  );
}

/** P-W8-22's refusal probes: a dialog item on the allow-list, and a deny-listed risk item. */
export const MENU_DIALOG_ITEM = { module: "WorldEditor", path: "File,Options..." };
export const MENU_RISK_ITEM = { module: "WorldEditor", path: "File,Exit" };

/** Row-id patterns of the drive and dialog steps (picked at run time from the 1.9 locator file). */
export const ROWS = {
  dockToggles:
    /^ui:WorldEditor\/menu-item\/(&)?Window\/(Log Console|Properties|Object Properties|Hierarchy)$/i,
  treeItem: /^ui:WorldEditor\/property\//,
  tabs: /^ui:WorldEditor\/tab\//,
  fileOpen: /^ui:WorldEditor\/menu-item\/(&)?File\/(&)?Open( World)?(\.\.\.|…)?$/i,
  options: /^ui:WorldEditor\/menu-item\/(&)?File\/Options(\.\.\.|…)$/i,
  pluginDialogs: /^ui:[A-Za-z.]+\/menu-item\/(&)?Plugins\/.+(\.\.\.|…)$/i,
  qtIntrospection: /^ui:[A-Za-z.]+\/menu-item\/.*Qt Introspection Tool/i,
  peerTool: /^ui:[A-Za-z.]+\/menu-item\/.*Peer Tool/i,
  tools: /^ui:WorldEditor\/toolbar-button\//,
  selectTool: /^ui:WorldEditor\/toolbar-button\/.*\/Select/i,
  debugDocks: /^ui:ScriptEditor\/(dock|panel)\/.*(Debug|Breakpoint|Target|Call ?Stack|Watch)/i,
} as const;

// ── World and mode helpers ───────────────────────────────────────────────────

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

function openPlan(rel: string): PlanAction[] {
  return [
    tc("wb_module", "open", { module: "WorldEditor" }),
    tc("wb_module", "setResource", { module: "WorldEditor", target: `path:${rel}` }),
    tc("wb_world", "state", {}, { note: "polled until worldPath names the world" }),
  ];
}

/** The W8 world on disk and registered (`wb_world new` when absent), then open. */
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
  if (!o.ok) fails.push(`the W8 world did not open ('${o.worldPath}')`);
  return o.ok;
}

function worldPlan(): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc("wb_world", "new", { path: WORLD }, { note: "offline writer (dry run), when absent" }),
    tc("wb_world", "new", { path: WORLD, confirm: true }, { note: "writes the throwaway world" }),
    tc("wb_world", "register", { path: WORLD }),
    ...openPlan(WORLD),
  ];
}

// ── Fixtures (inbox/w8/followups.md item 1) ──────────────────────────────────

/** One live record of the fixture entity in plant-w8.json (created, then deleted). */
export interface FixtureEntityRecord {
  step: string;
  runDir: string;
  at: string;
  ref: string;
  id: string;
  deleted?: boolean;
  deletedBy?: string;
}

/** plant-w8.json as the plant writes it and the live fixture steps extend it. */
export interface PlantRecord {
  kind: "w8-plant";
  dirs: string[];
  files: string[];
  throwawayExistedBefore: boolean;
  fixtures: Raw[];
  entities: FixtureEntityRecord[];
}

/** The fixtures the plant records before anything live runs (each with its maker and rollback). */
export function plannedFixtures(): Raw[] {
  return [
    {
      kind: "entity",
      world: WORLD,
      prefab: FIXTURE_ENTITY.prefab,
      name: FIXTURE_ENTITY.name,
      coords: FIXTURE_ENTITY.coords,
      madeBy: "wb_entity create (w8-07 in launch 1; w8-94 and w8-95 when absent in launch 2)",
      rollback:
        "wb_entity delete (w8-88 in launch 1, w8-98 in launch 2); the world is never saved, so no file holds it",
    },
    {
      kind: "animation",
      path: ANIM_AW,
      files: [ANIM_AGR, ANIM_AST, ANIM_AGF, ANIM_AW],
      graph: { sheet: AGF_SHEET, nodes: ["EMCP_W8_Pose", "EMCP_W8_Queue"], curve: CURVE_GAP },
      madeBy:
        "plant (the seed .agf), then w8-07: animation_graph author and edit addNode, wb_resources register, animation_graph edit addFile, animation_workspace create",
      rollback: `\`w8.live.ts rollback\` removes ${W8_ROOT}/`,
    },
    {
      kind: "behavior-tree",
      path: BT,
      root: "Sequence",
      children: ["EMCP_W8_Hold"],
      madeBy: "w8-07: behavior_tree create, wb_resources register",
      rollback: `\`w8.live.ts rollback\` removes ${W8_ROOT}/`,
    },
  ];
}

function plantPath(opts: Pick<W8Options, "sittingDir">): string {
  return join(opts.sittingDir, PLANT_FILE);
}

/** plant-w8.json, or a bare record when the sitting has none (a run past a plant of an older battery). */
export function readPlant(
  opts: Pick<W8Options, "sittingDir">,
  deps: Pick<W8Deps, "exists" | "readBytes">,
): PlantRecord {
  const r = readJson<Partial<PlantRecord>>(plantPath(opts), deps) ?? {};
  return {
    kind: "w8-plant",
    dirs: r.dirs ?? [],
    files: r.files ?? [],
    throwawayExistedBefore: r.throwawayExistedBefore ?? true,
    fixtures: r.fixtures ?? [],
    entities: Array.isArray(r.entities) ? r.entities : [],
  };
}

/** The live fixture entity: the newest record not deleted, else null. */
export function liveFixture(
  opts: Pick<W8Options, "sittingDir">,
  deps: Pick<W8Deps, "exists" | "readBytes">,
): FixtureEntityRecord | null {
  const list = readPlant(opts, deps).entities.filter((e) => !e.deleted);
  return list.length ? list[list.length - 1]! : null;
}

/** An entity ref out of a wb_entity answer: `id:<hex>` when the answer carries an id. */
export function fixtureRefOf(r: ToolResponse | null): { ref: string; id: string } {
  const b = rb(r);
  const id = S(b.id ?? b.entityId).replace(/^id:/, "");
  return id ? { ref: `id:${id}`, id } : { ref: "", id: "" };
}

/** The rows of a wb_entity list answer named exactly FIXTURE_ENTITY.name. */
function fixtureRows(r: ToolResponse): Raw[] {
  const x = rb(r);
  const rows = Array.isArray(x.rows) ? x.rows : Array.isArray(x.entities) ? x.entities : [];
  return (rows as Raw[]).filter((e) => S(e.name) === FIXTURE_ENTITY.name);
}

/**
 * The fixture entity in the open world: listed by its name first (a resumed run reuses it), else
 * created at FIXTURE_ENTITY.coords; each creation is appended to plant-w8.json with its id.
 * Refused when the throwaway world is not the open world (the entity goes only into it).
 */
export async function ensureFixtureEntity(
  ctx: StepContext,
  evidence: Raw,
  step: string,
): Promise<string> {
  const st = await ctx.tool("wb_world", { action: "state" });
  const worldPath = S(rb(st).worldPath);
  if (!worldPath.toLowerCase().endsWith(WORLD.toLowerCase())) {
    evidence.entity = { refused: `the open world is '${worldPath}', not ${WORLD}` };
    return "";
  }
  const l = await ctx.tool("wb_entity", { action: "list", name: FIXTURE_ENTITY.name, limit: 10 });
  const found = l.ok ? fixtureRows(l) : [];
  if (found.length) {
    const id = S(found[0]!.id).replace(/^id:/, "");
    const ref = id ? `id:${id}` : `name:${FIXTURE_ENTITY.name}`;
    evidence.entity = { reused: ref, listed: found.length };
    return ref;
  }
  const c = await ctx.tool("wb_entity", {
    action: "create",
    prefab: FIXTURE_ENTITY.prefab,
    name: FIXTURE_ENTITY.name,
    coords: FIXTURE_ENTITY.coords,
  });
  const { ref, id } = fixtureRefOf(c);
  evidence.entity = { create: brief(c), ref: ref || null };
  if (!c.ok) return "";
  const finalRef = ref || `name:${FIXTURE_ENTITY.name}`;
  const rec = readPlant(ctx.opts, ctx.deps);
  rec.entities.push({
    step,
    runDir: toPlaceholders(ctx.opts.runDir, ctx.opts.ph),
    at: new Date(ctx.deps.now()).toISOString(),
    ref: finalRef,
    id,
  });
  writeJson(plantPath(ctx.opts), rec, ctx.deps);
  return finalRef;
}

/** wb_entity delete of every entity named FIXTURE_ENTITY.name; the plant record marks them deleted. */
export async function deleteFixtureEntity(
  ctx: StepContext,
  evidence: Raw,
  step: string,
): Promise<boolean> {
  const l = await ctx.tool("wb_entity", { action: "list", name: FIXTURE_ENTITY.name, limit: 10 });
  const found = l.ok ? fixtureRows(l) : [];
  const refs = found.map((e) => {
    const id = S(e.id).replace(/^id:/, "");
    return id ? `id:${id}` : `name:${FIXTURE_ENTITY.name}`;
  });
  evidence.fixtureList = { answer: answerOf(l), found: refs };
  if (!refs.length) return true;
  const d = await ctx.tool("wb_entity", { action: "delete", entities: [...new Set(refs)] });
  evidence.fixtureDelete = brief(d);
  if (!d.ok) return false;
  const rec = readPlant(ctx.opts, ctx.deps);
  for (const e of rec.entities)
    if (!e.deleted) {
      e.deleted = true;
      e.deletedBy = step;
    }
  writeJson(plantPath(ctx.opts), rec, ctx.deps);
  return true;
}

/** At most this many Edit > Undo presses in w8-88 (W1 fix-up 2's MAX_EXTRA_UNDOS). */
export const FIXTURE_UNDO_MAX = 6;

/** The Edit > Undo that wb_undo_redo undo runs (the dry run checks the path, as W1's undoPlan). */
export function undoActionPlan(): PlanAction {
  return {
    kind: "execute-action",
    target: { path: ["Edit", "Undo"], module: "WorldEditor" },
    via: "EMCP_WB_EditorControl {action: undo} (wb_undo_redo)",
  } as unknown as PlanAction;
}

/** wb_undo_redo undo answered ok with the handler's "Undo executed" (W1 realDeps' test). */
export function undoExecuted(r: ToolResponse): boolean {
  return r.ok && /Undo executed/.test(S(r.message));
}

/**
 * Launch 1's closable (cold run 1 fix, w8-exit-crash.md): the w8-07 fixture taken by Edit > Undo
 * instead of a delete, so the throwaway world returns to its opened state and the post-flight
 * close meets no save prompt (a delete is itself an edit and leaves the world dirty; W1 fix-up 2,
 * where world switches after undone edits met no prompt in W1 2026-11-11h). Undo is pressed while
 * the fixture is listed, at most FIXTURE_UNDO_MAX, stopping at one that is not executed. When the
 * fixture is still listed the delete takes it (the old path), the world stays dirty and the step
 * FAILs: the close then meets "World editor - closing" (the hand answers No). Never saves.
 */
export async function undoFixtureToClean(ctx: StepContext, step: string): Promise<StepOutcome> {
  const evidence: Raw = {};
  const list = async (): Promise<number | null> => {
    const l = await ctx.tool("wb_entity", { action: "list", name: FIXTURE_ENTITY.name, limit: 10 });
    return l.ok ? fixtureRows(l).length : null;
  };
  let left = await list();
  evidence.listedBefore = left;
  if (left === 0) {
    evidence.clean = null;
    return {
      status: "PASS",
      detail: `no ${FIXTURE_ENTITY.name} in the open world: nothing to undo`,
      evidence,
    };
  }
  const undos: Raw[] = [];
  while (left !== null && left > 0 && undos.length < FIXTURE_UNDO_MAX) {
    const u = await ctx.tool("wb_undo_redo", { action: "undo" });
    const done = undoExecuted(u);
    left = await list();
    undos.push({ executed: done, message: S(u.message).slice(0, 300), code: u.code ?? null, left });
    if (!done) break;
  }
  evidence.undos = undos;
  if (left === 0) {
    evidence.clean = true;
    if (ctx.deps.exists(plantPath(ctx.opts))) {
      const rec = readPlant(ctx.opts, ctx.deps);
      let marked = 0;
      for (const e of rec.entities)
        if (!e.deleted) {
          e.deleted = true;
          e.deletedBy = `${step} (undo)`;
          marked++;
        }
      if (marked) writeJson(plantPath(ctx.opts), rec, ctx.deps);
      evidence.plantMarked = marked;
    }
    return {
      status: "PASS",
      detail: `the fixture entity undone in ${undos.length} undo(s): the world holds no unsaved edit`,
      evidence,
    };
  }
  // The fallback: the old delete. The world stays dirty, so the close meets the save prompt.
  evidence.clean = false;
  const ok = await deleteFixtureEntity(ctx, evidence, step);
  return {
    status: "FAIL",
    detail: `the undo did not take the fixture (${undos.length} undo(s), ${S(left)} left)${ok ? "; deleted instead" : "; the delete failed too"}: the world is dirty, the post-flight close meets "World editor - closing" (hand: No; never Save)`,
    evidence,
  };
}

/** wb_view select set on the fixture (a selection is view state; cleared by selectNone). */
export async function selectFixture(ctx: StepContext, ref: string): Promise<ToolResponse> {
  return ctx.tool("wb_view", { action: "select", mode: "set", entities: [ref] });
}

export async function selectNone(ctx: StepContext): Promise<ToolResponse> {
  return ctx.tool("wb_view", { action: "select", mode: "clear" });
}

/** The resource name of a fixture file: resolve, else register (W4's ensureFixtures route). */
async function fixtureName(ctx: StepContext, rel: string, evidence: Raw): Promise<string> {
  const r = await ctx.tool("wb_resources", { action: "resolve", path: rel });
  let name = r.ok && rb(r).hasMeta === true ? S(rb(r).resourceName) : "";
  if (!name) {
    const reg = await ctx.tool("wb_resources", { action: "register", path: rel, confirm: true });
    name = reg.ok ? S(rb(reg).resourceName) : "";
    evidence[`register ${rel}`] = brief(reg);
  }
  return name;
}

/**
 * The anim and tree fixtures on disk and registered (w8-07). Each call is made only when its file
 * is absent, so a resumed run never writes twice; nothing is written outside ANIM_DIR and AI_DIR.
 */
export async function ensureFileFixtures(
  ctx: StepContext,
  evidence: Raw,
  fails: string[],
): Promise<void> {
  const on = (rel: string): boolean => ctx.deps.exists(abs(ctx.opts.sandboxDir, rel));
  if (!on(ANIM_AGF)) {
    fails.push(`the seed ${ANIM_AGF} is absent: run \`w8.live.ts plant\` (nothing is sent)`);
    return;
  }
  const anim: Raw = {};
  if (!on(ANIM_AGR)) {
    for (const [k, a] of FIXTURE_GRAPH_CALLS) {
      const r = await ctx.tool("animation_graph", a);
      anim[k] = brief(r);
      if (!r.ok) fails.push(`animation_graph ${k}: ${why(r)}`);
    }
  } else anim.graph = "already on disk (a resumed run)";
  if (!on(ANIM_AW)) {
    const agf = await fixtureName(ctx, ANIM_AGF, anim);
    if (agf) {
      const add = await ctx.tool("animation_graph", {
        action: "edit",
        path: ANIM_AGR,
        op: "addFile",
        file: agf,
        confirm: true,
      });
      anim.addFile = brief(add);
      if (!add.ok) fails.push(`animation_graph addFile: ${why(add)}`);
    } else fails.push(`${ANIM_AGF} has no resource name`);
    const agr = await fixtureName(ctx, ANIM_AGR, anim);
    const ast = await fixtureName(ctx, ANIM_AST, anim);
    if (!agr || !ast) fails.push(`the .agr or .ast has no resource name ('${agr}', '${ast}')`);
    else {
      const c = await ctx.tool("animation_workspace", {
        action: "create",
        target: ANIM_AW,
        animSetTemplate: ast,
        animGraph: agr,
        confirm: true,
      });
      anim.create = brief(c);
      if (!c.ok) fails.push(`animation_workspace create: ${why(c)}`);
    }
  } else anim.workspace = "already on disk (a resumed run)";
  anim.curve = CURVE_GAP;
  evidence.anim = anim;
  const bt: Raw = {};
  if (!on(BT)) {
    const r = await ctx.tool("behavior_tree", { action: "create", spec: FIXTURE_BT_SPEC });
    bt.create = brief(r);
    if (!r.ok) fails.push(`behavior_tree create: ${why(r)}`);
  } else bt.tree = "already on disk (a resumed run)";
  if (on(BT) && !(await fixtureName(ctx, BT, bt))) fails.push(`${BT} has no resource name`);
  evidence.bt = bt;
}

/** The anim workspace and the tree opened in their editors (the W4 openInEditor route). */
export async function openFileFixtures(ctx: StepContext, evidence: Raw): Promise<number> {
  let opened = 0;
  for (const [module, rel] of [
    ["AnimEditor", ANIM_AW],
    ["BehaviorEditor", BT],
  ] as const) {
    if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, rel))) {
      evidence[module] = { refused: `${rel} is not on disk: the open is not sent` };
      continue;
    }
    const open = await ctx.tool("wb_module", { action: "open", module });
    const set = await ctx.tool("wb_module", {
      action: "setResource",
      module,
      target: `path:${rel}`,
    });
    evidence[module] = { open: answerOf(open), setResource: answerOf(set) };
    if (set.ok) opened++;
  }
  return opened;
}

function fixtureFilePlan(): PlanAction[] {
  return [
    tc(
      "wb_resources",
      "resolve",
      { path: ANIM_AGF },
      { note: "each fixture file's resource name" },
    ),
    tc(
      "wb_resources",
      "register",
      { path: ANIM_AGF, confirm: true },
      { note: "the .agf, .agr, .ast and .bt, each only when resolve finds no .meta" },
    ),
    tc("wb_resources", "register", { path: ANIM_AGR, confirm: true }),
    tc("wb_resources", "register", { path: ANIM_AST, confirm: true }),
    tc("wb_resources", "register", { path: BT, confirm: true }),
  ];
}

function fixtureFileCalls(): OfflineCall[] {
  return [
    ...FIXTURE_GRAPH_CALLS.map(([, a]) => oc("animation_graph", S(a.action), a)),
    oc("animation_graph", "edit", {
      path: ANIM_AGR,
      op: "addFile",
      file: "<the .agf resource name>",
      confirm: true,
    }),
    oc("animation_workspace", "create", {
      target: ANIM_AW,
      animSetTemplate: "<the .ast resource name>",
      animGraph: "<the .agr resource name>",
      confirm: true,
    }),
    oc("behavior_tree", "create", { spec: FIXTURE_BT_SPEC }),
  ];
}

function fixtureEntityPlan(): PlanAction[] {
  return [
    tc("wb_world", "state", {}, { note: "the throwaway world must be the open one" }),
    tc("wb_entity", "list", { name: FIXTURE_ENTITY.name, limit: 10 }),
    tc(
      "wb_entity",
      "create",
      { prefab: FIXTURE_ENTITY.prefab, name: FIXTURE_ENTITY.name, coords: FIXTURE_ENTITY.coords },
      { note: "only when the list finds none; the id goes to plant-w8.json" },
    ),
  ];
}

function fixtureDeletePlan(): PlanAction[] {
  return [
    tc("wb_entity", "list", { name: FIXTURE_ENTITY.name, limit: 10 }),
    tc("wb_entity", "delete", { entities: ["<each listed fixture ref>"] }),
  ];
}

function openFixturePlan(): PlanAction[] {
  return [
    tc("wb_module", "open", { module: "AnimEditor" }),
    tc("wb_module", "setResource", { module: "AnimEditor", target: `path:${ANIM_AW}` }),
    tc("wb_module", "open", { module: "BehaviorEditor" }),
    tc("wb_module", "setResource", { module: "BehaviorEditor", target: `path:${BT}` }),
  ];
}

/** Polls wb_world state until the mode is `mode` (edit or play). */
async function waitMode(
  ctx: StepContext,
  mode: "edit" | "play",
): Promise<{ ok: boolean; polls: number }> {
  const started = ctx.deps.now();
  let polls = 0;
  for (;;) {
    polls++;
    const st = await ctx.tool("wb_world", { action: "state" });
    if (st.ok && S(rb(st).mode) === mode) return { ok: true, polls };
    if (ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open) return { ok: false, polls };
    await ctx.sleep(TIMEOUTS.poll);
  }
}

/**
 * wb_world state, wb_play and the wait; the restorer stops play if the step ends early.
 *
 * Fix-up 3 (run 4, battery2): wb_play refuses on the client's cached mode, and a fresh battery
 * process (`--from w8-31`) had made no call that answers a mode, so wb_play answered "Workbench
 * mode is unknown. Call `wb_state` first" one second in. wb_world state answers `mode`, which the
 * client caches (client.ts extractMode), so it is read first. The refusal's text goes to
 * `evidence.playWhy` and the step's detail.
 */
async function enterPlay(ctx: StepContext, evidence: Raw): Promise<boolean> {
  const st = await ctx.tool("wb_world", { action: "state" });
  evidence.modeBefore = st.ok ? S(rb(st).mode) || null : why(st);
  const p = await ctx.tool("wb_play", {});
  evidence.play = brief(p);
  if (!p.ok) {
    evidence.playWhy = why(p).split("\n")[0] ?? "";
    return false;
  }
  ctx.debt.restorers.push({
    label: "wb_stop",
    fn: async () => {
      const s = await ctx.tool("wb_stop", {}, { tolerate: true });
      await waitMode(ctx, "edit");
      return s;
    },
  });
  const w = await waitMode(ctx, "play");
  evidence.playPolls = w.polls;
  return w.ok;
}

/** The FAIL text of a play that did not land: wb_play's own answer, or the polls it waited. */
export function playFailText(evidence: Raw): string {
  const w = S(evidence.playWhy);
  if (w) return `play mode was not reached: wb_play answered ${w}`;
  const polls = typeof evidence.playPolls === "number" ? String(evidence.playPolls) : "?";
  return `play mode was not reached: wb_world state did not read play after ${polls} poll(s) (${TIMEOUTS.open} ms)`;
}

async function leavePlay(ctx: StepContext, evidence: Raw): Promise<boolean> {
  const s = await ctx.tool("wb_stop", {});
  evidence.stop = brief(s);
  const w = await waitMode(ctx, "edit");
  evidence.editPolls = w.polls;
  ctx.debt.restorers = ctx.debt.restorers.filter((r) => r.label !== "wb_stop");
  return s.ok && w.ok;
}

const playPlan = (): PlanAction[] => [
  tc("wb_world", "state", {}, { note: "the mode read first: wb_play refuses on an unknown mode" }),
  tc("wb_play", "play", {}, { toolAction: "play" }),
  tc("wb_world", "state", {}, { note: "polled until mode is play" }),
];
const stopPlan = (): PlanAction[] => [
  tc("wb_stop", "stop", {}, { toolAction: "stop" }),
  tc("wb_world", "state", {}, { note: "polled until mode is edit" }),
];

// ── wb_gui helpers ───────────────────────────────────────────────────────────

/** The modal list now (wb_gui modals); the windows named. */
async function modals(ctx: StepContext, rebaseline = false): Promise<ToolResponse> {
  return ctx.tool("wb_gui", {
    action: "modals",
    pid: ctx.deps.recordedPid() ?? undefined,
    ...(rebaseline ? { rebaseline: true } : {}),
  });
}

function modalTitles(r: ToolResponse): string[] {
  const x = rb(r);
  const list = Array.isArray(x.modals) ? x.modals : Array.isArray(x.dialogs) ? x.dialogs : [];
  return (list as unknown[]).map((m) => (m && typeof m === "object" ? S((m as Raw).title) : S(m)));
}

/** One drive call by row id (spec 1.2.1). */
async function drive(ctx: StepContext, action: string, rowId: string): Promise<ToolResponse> {
  return ctx.tool("wb_gui", {
    action,
    rowId,
    confirm: true,
    pid: ctx.deps.recordedPid() ?? undefined,
  });
}

async function readRow(ctx: StepContext, rowId: string): Promise<ToolResponse> {
  return ctx.tool("wb_gui", { action: "read", rowId, pid: ctx.deps.recordedPid() ?? undefined });
}

/**
 * Open a dialog by its row, read the modal list, ping through it, dismiss with Cancel (or Close),
 * read the modal list again. Never presses anything else.
 */
async function dialogRound(
  ctx: StepContext,
  rowId: string,
  opts: { ping?: boolean; button?: "Cancel" | "Close" } = {},
): Promise<{
  opened: boolean;
  waiting: string | null;
  title: string;
  pinged: boolean | null;
  dismissed: boolean;
  evidence: Raw;
}> {
  const evidence: Raw = { rowId };
  const before = await modals(ctx, true);
  evidence.modalsBefore = brief(before);
  const inv = await drive(ctx, "invoke", rowId);
  evidence.invoke = brief(inv);
  if (!inv.ok)
    return {
      opened: false,
      waiting: WAIT_CODES.has(S(inv.code)) ? S(inv.code) : null,
      title: "",
      pinged: null,
      dismissed: false,
      evidence,
    };
  await ctx.sleep(2_000);
  const open = await modals(ctx);
  evidence.modalsOpen = brief(open);
  const title = modalTitles(open)[0] ?? "";
  let pinged: boolean | null = null;
  if (opts.ping) {
    const started = ctx.deps.now();
    const p = await ctx.deps.ping();
    pinged = p !== null;
    evidence.pingDuringDialog = { answered: pinged, ms: ctx.deps.now() - started };
  }
  let dismissed = false;
  if (title) {
    const d = await ctx.tool("wb_gui", {
      action: "dismiss",
      dialog: title,
      button: opts.button ?? "Cancel",
      pid: ctx.deps.recordedPid() ?? undefined,
    });
    evidence.dismiss = brief(d);
    await ctx.sleep(1_000);
    const after = await modals(ctx);
    evidence.modalsAfter = brief(after);
    dismissed = d.ok && !modalTitles(after).includes(title);
  }
  return { opened: title !== "", waiting: null, title, pinged, dismissed, evidence };
}

function dialogPlan(rowPattern: string, button: "Cancel" | "Close" = "Cancel"): PlanAction[] {
  return [
    tc("wb_gui", "modals", { rebaseline: true }),
    guiDrive("invoke", rowPattern, "opens the dialog; nothing in it is pressed but the dismiss"),
    tc("wb_gui", "modals"),
    tc("wb_gui", "dismiss", { button }, { note: "Cancel, Close or No only (OD-4)" }),
    tc("wb_gui", "modals"),
  ];
}

// ── Hand ─────────────────────────────────────────────────────────────────────

/**
 * Asks the main session's hand (computer use on "Arma Reforger Tools", OI-W8-1) for one action or
 * observation: writes the request file, logs one HAND REQUEST line and polls for the answer file.
 */
async function awaitHand(ctx: StepContext, key: string, instruction: string): Promise<Raw | null> {
  const f = handFiles(ctx.opts.runDir, key);
  writeJson(
    f.request,
    { key, instruction, requestedAt: new Date(ctx.deps.now()).toISOString() },
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

// ── Net-zero (the battery's own snapshot, outside _throwaway/W8/) ────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W8Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W8_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W8Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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
  deps: Pick<W8Deps, "exists" | "readBytes" | "listTree">,
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

/** The prep record: the launch profile and the registry hash before anything ran. */
export interface PrepRecord {
  kind: "w8-prep";
  profile: string;
  /** The scratch ini, absolute (placeholder form in printed copies). */
  forceSettings: string;
  registrySha256: string;
  registryExport: string;
  at: string;
  /**
   * The engine-accept edit of wb_settings: the value in `<profile>.ini` (before) and the one the
   * set wrote to `<profile>-accept.ini` (after), the launch's ini. Null when the set was refused
   * (the launch then takes `<profile>.ini` and w8-31 records NOT-RUN with the reason).
   */
  accept?: {
    section: string;
    key: string;
    from: string;
    ini: string;
    before: string | null;
    after: string;
  } | null;
  acceptWhy?: string;
}

/** The flip of a bool setting text (true/false, 1/0); an absent or other value becomes "true". */
export function flipSetting(v: string | null | undefined): string {
  const t = S(v).trim().toLowerCase();
  if (t === "true") return "false";
  if (t === "1") return "0";
  if (t === "0") return "1";
  return "true";
}

/** A UIA toggle state as the bool setting text it shows ("On" true, "Off" false), else null. */
export function toggleAsSetting(state: unknown): string | null {
  const t = S(state).trim().toLowerCase();
  if (t === "on" || t === "1" || t === "true") return "true";
  if (t === "off" || t === "0" || t === "false") return "false";
  return null;
}

/** A bool setting text normalised to "true"/"false", else null. */
export function settingBool(v: unknown): string | null {
  const t = S(v).trim().toLowerCase();
  if (t === "true" || t === "1") return "true";
  if (t === "false" || t === "0") return "false";
  return null;
}

function prepRecord(
  opts: W8Options,
  deps: Pick<W8Deps, "exists" | "readBytes">,
): PrepRecord | null {
  const r = readJson<PrepRecord>(join(opts.sittingDir, PREP_FILE), deps);
  return r && r.kind === "w8-prep" ? r : null;
}

/** True when a command line carries `-forceSettings <ini>` naming `ini` (quotes and case aside). */
export function carriesForceSettings(cmdLine: string, ini: string): boolean {
  const norm = (s: string): string => s.replace(/["']/g, "").replace(/\\/g, "/").toLowerCase();
  const c = norm(cmdLine);
  const at = c.indexOf("-forcesettings");
  if (at < 0) return false;
  return c
    .slice(at + "-forcesettings".length)
    .trimStart()
    .startsWith(norm(ini));
}

// ── Offline proofs ───────────────────────────────────────────────────────────

/** P-W8-21: the tokens the probe searches for. */
export const P21_TOKENS: readonly string[] = ["SavePixelRawData", "TexTools"];

/** Files under mod/ whose text names a token (handlers and their packs). */
export function modCallers(
  repoRoot: string,
  deps: Pick<W8Deps, "listTree" | "readBytes">,
): Array<{ file: string; token: string }> {
  const out: Array<{ file: string; token: string }> = [];
  for (const f of deps.listTree(join(repoRoot, "mod"))) {
    if (!/\.(c|et|conf)$/i.test(f)) continue;
    const text = deps.readBytes(join(repoRoot, "mod", ...f.split("/"))).toString("utf-8");
    for (const t of P21_TOKENS) if (text.includes(t)) out.push({ file: `mod/${f}`, token: t });
  }
  return out;
}

/** Lines of the E02 source index that name a token, as their `file` (or the line head). */
export function indexCallers(text: string): Array<{ where: string; token: string }> {
  const out: Array<{ where: string; token: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    for (const t of P21_TOKENS) {
      if (!line.includes(t)) continue;
      let where = line.slice(0, 120);
      try {
        const o = JSON.parse(line) as Raw;
        where = S(o.file ?? o.path ?? o.source ?? o.id) || where;
      } catch {
        // not JSON: keep the head of the line
      }
      out.push({ where, token: t });
    }
  }
  return out;
}

/** P-W8-06: values of the export that read as a key chord, as `key\name` (values never printed). */
export function chordValues(regText: string): string[] {
  const out: string[] = [];
  let key = "";
  const chord = /^(Ctrl|Alt|Shift|Meta|Win)\+\S/i;
  for (const raw of regText.split(/\r?\n/)) {
    const line = raw.trim();
    const k = /^\[(.+)\]$/.exec(line);
    if (k) {
      key = k[1]!;
      continue;
    }
    const v = /^"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"$/.exec(line);
    if (v && chord.test(v[2]!)) out.push(`${key}\\${v[1]}`);
  }
  return out;
}

// ── Steps ────────────────────────────────────────────────────────────────────

function liveStep(
  base: Omit<StepDef, "phase" | "expectsWindows"> & { expectsWindows?: readonly RegExp[] },
): StepDef {
  return { ...base, phase: "live", expectsWindows: base.expectsWindows ?? WORKBENCH_WINDOWS };
}

export function buildSteps(): StepDef[] {
  return [...prepSteps(), ...liveSteps(), ...postSteps()];
}

// ── W8.P: the offline probes and the launch profile (no Workbench may run) ──

function prepSteps(): StepDef[] {
  return [
    {
      id: "w8-01-p21-callers",
      block: "W8.P",
      phase: "prep",
      title:
        "P-W8-21: callers of Workbench.SavePixelRawData and the TexTools helpers in mod/ and the E02 index",
      risk: "read-only",
      timeout_ms: 120_000,
      expected: "no caller in mod/; the vanilla callers named from the E02 source index",
      kill_criterion:
        "none (an offline fact): a caller in mod/ is a FAIL (a shipped handler must not call it); an absent index leaves it PARTIAL",
      side_effects: [],
      rollback: "none (reads files)",
      probes: ["P-W8-21"],
      writes: [],
      plan: () => [],
      offlineCalls: () => [oc("scan", "callers", { tokens: [...P21_TOKENS] })],
      run: async (ctx) => {
        const fails: string[] = [];
        const mod = modCallers(REPO_ROOT, ctx.deps);
        if (mod.length)
          fails.push(`mod/ calls ${mod.map((m) => `${m.token} in ${m.file}`).join(", ")}`);
        const index = ctx.deps.sourceIndexPath();
        const vanilla = index ? indexCallers(ctx.deps.readBytes(index).toString("utf-8")) : null;
        const observed: Raw = {
          mod,
          index: index ? toPlaceholders(index, ctx.opts.ph) : null,
          vanilla: vanilla ? vanilla.slice(0, 50) : null,
          vanillaCount: vanilla ? vanilla.length : null,
        };
        const probe = vanilla
          ? settled("P-W8-21", observed, `${vanilla.length} vanilla mention(s); none in mod/`)
          : partial("P-W8-21", observed, "the E02 source index is absent: mod/ checked only");
        return {
          ...verdictOf(fails, [probe], "P-W8-21 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    },
    {
      id: "w8-02-p06-shortcuts",
      block: "W8.P",
      phase: "prep",
      title:
        "P-W8-06: wb_settings shortcuts (GATED until the probe), then the read-only registry export searched for key chords",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "wb_settings shortcuts answers GATED (SETTINGS_GATES.shortcuts); the export holds values that read as key chords (Ctrl+.., Alt+..): shortcuts parse to action and chord pairs",
      kill_criterion:
        "no chord value in the export: the store is not in the registry; shortcut rows stay T2 documented (KILLED)",
      side_effects: [
        "a reg export file in <artifacts>/settings/exports/ (read-only on the registry)",
      ],
      rollback: "none (the registry is only read)",
      probes: ["P-W8-06"],
      writes: [],
      plan: () => [tc("wb_settings", "shortcuts", {}, { note: "expected GATED until P-W8-06" })],
      offlineCalls: () => [oc("registry", "export"), oc("registry", "chords")],
      run: async (ctx) => {
        const fails: string[] = [];
        const s = await ctx.tool("wb_settings", { action: "shortcuts" });
        const evidence: Raw = { shortcuts: brief(s) };
        if (!okOrWaiting(s)) fails.push(`shortcuts: ${why(s)}`);
        const reg = await ctx.deps.registryExport();
        evidence.export = reg.ok ? toPlaceholders(reg.path, ctx.opts.ph) : reg.error;
        if (!reg.ok) {
          fails.push(`the registry export failed: ${S(reg.error)}`);
          return { ...verdictOf(fails, [], ""), evidence };
        }
        const chords = chordValues(reg.text);
        const observed: Raw = {
          shortcuts: answerOf(s),
          switch: SWITCHES.shortcuts,
          chordValues: chords.length,
          sample: chords.slice(0, 20),
        };
        const probe = chords.length
          ? settled("P-W8-06", observed, `${chords.length} value(s) read as key chords`)
          : killed(
              "P-W8-06",
              observed,
              "no chord value in the registry export: shortcut rows stay T2 documented",
            );
        return { ...verdictOf(fails, [probe], "P-W8-06 answered"), evidence, probes: [probe] };
      },
    },
    {
      id: "w8-03-p04-roundtrip",
      block: "W8.P",
      phase: "prep",
      title:
        "P-W8-04: scratch-ini round trip (profile, set, unset on a benign key), the registry export hashed before and after",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "profile writes a new scratch ini; set writes a new file holding the key; unset writes one without it; each dry run writes nothing; the registry export hash is identical before and after",
      kill_criterion:
        "the registry hash moves: wb_settings writes are withdrawn and the family stays T3 read-only (KILLED)",
      side_effects: [
        "three new scratch ini files and their records in <artifacts>/settings/scratch/",
      ],
      rollback: "none needed: scratch files in the artifacts folder, never the registry",
      probes: ["P-W8-04"],
      writes: [],
      plan: () => [
        tc("wb_settings", "profile", { name: "<profile>-p04" }, { note: "dry run" }),
        tc("wb_settings", "profile", { name: "<profile>-p04", confirm: true }),
        tc(
          "wb_settings",
          "set",
          {
            path: "<profile>-p04",
            section: "EMCP_W8",
            key: "P04Probe",
            value: "1",
            name: "<profile>-p04-set",
          },
          { note: "dry run" },
        ),
        tc("wb_settings", "set", {
          path: "<profile>-p04",
          section: "EMCP_W8",
          key: "P04Probe",
          value: "1",
          name: "<profile>-p04-set",
          confirm: true,
        }),
        tc("wb_settings", "get", {
          store: "<profile>-p04-set",
          section: "EMCP_W8",
          key: "P04Probe",
        }),
        tc("wb_settings", "unset", {
          path: "<profile>-p04-set",
          section: "EMCP_W8",
          key: "P04Probe",
          name: "<profile>-p04-unset",
          confirm: true,
        }),
        tc("wb_settings", "get", {
          store: "<profile>-p04-unset",
          section: "EMCP_W8",
          key: "P04Probe",
        }),
      ],
      offlineCalls: () => [oc("registry", "hash"), oc("registry", "hash")],
      run: async (ctx) => {
        const fails: string[] = [];
        const name = `${ctx.opts.profile ?? "w8"}-p04`;
        const evidence: Raw = { name };
        const before = await ctx.deps.registryExport();
        evidence.before = before.ok ? before.sha256 : before.error;
        if (!before.ok) {
          fails.push(`registry export: ${S(before.error)}`);
          return { ...verdictOf(fails, [], ""), evidence };
        }
        const dry = await ctx.tool("wb_settings", { action: "profile", name });
        evidence.profileDry = brief(dry);
        const made = await ctx.tool("wb_settings", { action: "profile", name, confirm: true });
        evidence.profile = brief(made);
        if (!made.ok) fails.push(`profile: ${why(made)}`);
        const setArgs = {
          path: name,
          section: "EMCP_W8",
          key: "P04Probe",
          value: "1",
          name: `${name}-set`,
        };
        const setDry = await ctx.tool("wb_settings", { action: "set", ...setArgs });
        evidence.setDry = brief(setDry);
        const set = await ctx.tool("wb_settings", { action: "set", ...setArgs, confirm: true });
        evidence.set = brief(set);
        if (!set.ok) fails.push(`set: ${why(set)}`);
        const g1 = await ctx.tool("wb_settings", {
          action: "get",
          store: `${name}-set`,
          section: "EMCP_W8",
          key: "P04Probe",
        });
        evidence.getSet = brief(g1);
        const un = await ctx.tool("wb_settings", {
          action: "unset",
          path: `${name}-set`,
          section: "EMCP_W8",
          key: "P04Probe",
          name: `${name}-unset`,
          confirm: true,
        });
        evidence.unset = brief(un);
        if (!un.ok) fails.push(`unset: ${why(un)}`);
        const g2 = await ctx.tool("wb_settings", {
          action: "get",
          store: `${name}-unset`,
          section: "EMCP_W8",
          key: "P04Probe",
        });
        evidence.getUnset = brief(g2);
        if (g1.ok && S(rb(g1).value) !== "1")
          fails.push(`after set the key reads '${S(rb(g1).value)}', not 1`);
        if (g2.ok && rb(g2).value !== undefined && rb(g2).value !== null)
          fails.push(`after unset the key still reads '${S(rb(g2).value)}'`);
        const after = await ctx.deps.registryExport();
        evidence.after = after.ok ? after.sha256 : after.error;
        const observed: Raw = {
          before: before.sha256,
          after: after.sha256,
          wrote: [made.ok, set.ok, un.ok],
        };
        const probe = !after.ok
          ? partial("P-W8-04", observed, `the second export failed: ${S(after.error)}`)
          : after.sha256 === before.sha256
            ? settled(
                "P-W8-04",
                observed,
                "the registry export hash is unchanged by the round trip",
              )
            : killed(
                "P-W8-04",
                observed,
                "the registry export hash moved: wb_settings writes are withdrawn",
              );
        return { ...verdictOf(fails, [probe], "P-W8-04 answered"), evidence, probes: [probe] };
      },
    },
    {
      id: "w8-04-profile",
      block: "W8.P",
      phase: "prep",
      title:
        "W8.0: the registry export hashed (the post-check's baseline), the launch profile made by wb_settings profile, then the engine-accept edit written by wb_settings set into a new ini (the launch's)",
      risk: "reversible",
      timeout_ms: 120_000,
      expected: `the export hashed; wb_settings profile <profile> answers forceSettings, a new scratch ini; wb_settings set flips [${ACCEPT_SETTING.section}] ${ACCEPT_SETTING.key} into <profile>${ACCEPT_SUFFIX}.ini (dry run first, then confirm; the source ini unchanged); <sitting>/${PREP_FILE} names that ini, the edit and the hash`,
      kill_criterion:
        "the export or the profile fails: FAIL (the launch has no scratch ini; nothing launches). A refused set is no FAIL: the launch takes <profile>.ini and w8-31 records NOT-RUN",
      side_effects: [
        `<sitting>/${PREP_FILE}`,
        "two scratch ini files and their records in <artifacts>/settings/scratch/",
      ],
      rollback: "none needed (artifacts folder only)",
      probes: [],
      writes: [],
      plan: () => [
        tc("wb_settings", "profile", { name: "<profile>" }, { note: "dry run" }),
        tc("wb_settings", "profile", { name: "<profile>", confirm: true }),
        tc("wb_settings", "get", {
          store: "<profile>",
          section: ACCEPT_SETTING.section,
          key: ACCEPT_SETTING.key,
        }),
        tc(
          "wb_settings",
          "set",
          {
            path: "<profile>",
            section: ACCEPT_SETTING.section,
            key: ACCEPT_SETTING.key,
            value: "<flipped>",
            name: `<profile>${ACCEPT_SUFFIX}`,
          },
          { note: "dry run" },
        ),
        tc(
          "wb_settings",
          "set",
          {
            path: "<profile>",
            section: ACCEPT_SETTING.section,
            key: ACCEPT_SETTING.key,
            value: "<flipped>",
            name: `<profile>${ACCEPT_SUFFIX}`,
            confirm: true,
          },
          { note: "the launch's scratch ini: the engine-accept edit" },
        ),
        tc("wb_settings", "get", {
          store: `<profile>${ACCEPT_SUFFIX}`,
          section: ACCEPT_SETTING.section,
          key: ACCEPT_SETTING.key,
        }),
      ],
      offlineCalls: () => [oc("registry", "hash")],
      run: async (ctx) => {
        const fails: string[] = [];
        const profile = ctx.opts.profile ?? "";
        const evidence: Raw = { profile };
        if (!profile) {
          fails.push("no --profile name");
          return { ...verdictOf(fails, [], ""), evidence };
        }
        const reg = await ctx.deps.registryExport();
        evidence.registry = reg.ok ? reg.sha256 : reg.error;
        if (!reg.ok) {
          fails.push(`registry export: ${S(reg.error)}`);
          return { ...verdictOf(fails, [], ""), evidence };
        }
        const dry = await ctx.tool("wb_settings", { action: "profile", name: profile });
        evidence.dry = brief(dry);
        const made = await ctx.tool("wb_settings", {
          action: "profile",
          name: profile,
          confirm: true,
        });
        evidence.made = brief(made);
        const ini = S(rb(made).forceSettings);
        if (!made.ok || !ini) {
          fails.push(`profile: ${made.ok ? "no forceSettings in the answer" : why(made)}`);
          return { ...verdictOf(fails, [], ""), evidence };
        }
        if (!ctx.deps.exists(ini)) fails.push("the scratch ini is not on disk after the profile");
        // The engine-accept edit (the offline writer's proof): one bool flipped into a NEW ini
        // that becomes the launch's; the profile's own ini is never overwritten. Not written when
        // P-W8-04 was KILLED in this prep run (wb_settings writes are then withdrawn).
        let launchIni = ini;
        let accept: PrepRecord["accept"] = null;
        let acceptWhy = "";
        const p04 = ctx.prior("w8-03-p04-roundtrip");
        if (p04?.probes?.some((p) => p.id === "P-W8-04" && p.result === "KILLED"))
          acceptWhy =
            "P-W8-04 was KILLED: wb_settings set is withdrawn; the launch takes the profile";
        else {
          const g0 = await ctx.tool("wb_settings", {
            action: "get",
            store: profile,
            section: ACCEPT_SETTING.section,
            key: ACCEPT_SETTING.key,
          });
          evidence.acceptBefore = brief(g0);
          const before = g0.ok ? S(rb(g0).value) || null : null;
          const after = flipSetting(before);
          const setArgs: Raw = {
            action: "set",
            path: profile,
            section: ACCEPT_SETTING.section,
            key: ACCEPT_SETTING.key,
            value: after,
            name: `${profile}${ACCEPT_SUFFIX}`,
          };
          const sd = await ctx.tool("wb_settings", setArgs);
          evidence.acceptDry = brief(sd);
          const sc = sd.ok ? await ctx.tool("wb_settings", { ...setArgs, confirm: true }) : null;
          evidence.acceptSet = brief(sc);
          const out = sc && sc.ok ? S(rb(sc).forceSettings) : "";
          const g1 = out
            ? await ctx.tool("wb_settings", {
                action: "get",
                store: `${profile}${ACCEPT_SUFFIX}`,
                section: ACCEPT_SETTING.section,
                key: ACCEPT_SETTING.key,
              })
            : null;
          evidence.acceptAfter = brief(g1);
          if (!sd.ok) acceptWhy = `the set dry run refused: ${why(sd)}`;
          else if (!sc || !sc.ok) acceptWhy = `the set refused: ${sc ? why(sc) : "not sent"}`;
          else if (!out || !ctx.deps.exists(out)) acceptWhy = "the set named no ini on disk";
          else if (!g1 || !g1.ok || settingBool(rb(g1).value) !== settingBool(after))
            acceptWhy = `the accept ini reads '${S(rb(g1).value)}', not '${after}'`;
          else {
            launchIni = out;
            accept = {
              section: ACCEPT_SETTING.section,
              key: ACCEPT_SETTING.key,
              from: `${profile}.ini`,
              ini: `${profile}${ACCEPT_SUFFIX}.ini`,
              before,
              after,
            };
          }
          // A refused set is recorded, never a FAIL: the launch still has the profile's ini.
          if (sc && sc.ok && !accept) fails.push(`accept edit: ${acceptWhy}`);
        }
        const rec: PrepRecord = {
          kind: "w8-prep",
          profile,
          forceSettings: launchIni,
          registrySha256: reg.sha256,
          registryExport: reg.path,
          at: new Date(ctx.deps.now()).toISOString(),
          accept,
          ...(acceptWhy ? { acceptWhy } : {}),
        };
        writeJson(join(ctx.opts.sittingDir, PREP_FILE), rec, ctx.deps);
        evidence.prep = PREP_FILE;
        evidence.accept = accept ?? { notWritten: acceptWhy };
        evidence.launch = LAUNCH_ARGS.map((a) =>
          a === PROFILE_INI ? toPlaceholders(launchIni, ctx.opts.ph) : a,
        );
        return {
          ...verdictOf(
            fails,
            [],
            `profile ${profile} made; launch ini ${basename(launchIni)}; registry ${reg.sha256.slice(0, 12)}`,
          ),
          evidence,
        };
      },
    },
  ];
}

// ── The live phase ───────────────────────────────────────────────────────────

function liveSteps(): StepDef[] {
  return [
    // ── W8.0 gate and world ──
    liveStep({
      id: GATE_STEP,
      block: "W8.0",
      title:
        "the test-bed gate: EMCP_WB_Info names EMCP2_sandbox, build stamp, launched on the prep scratch ini, sandbox snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; the planted folders under ${W8_ROOT}/ exist; the lane's Workbench pid carries -forceSettings with the ini of ${PREP_FILE}`,
      kill_criterion:
        "not the test bed: ABORTED; a stamp mismatch, no prep record, the planted folders absent or no -forceSettings on the scratch ini: STOPPED",
      side_effects: [`<sitting>/${BATTERY_SNAPSHOT_FILE} (first run of the sitting only)`],
      rollback: "none (reads)",
      probes: [],
      writes: [],
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_Info" } as PlanAction,
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
      ],
      run: async (ctx) => {
        const evidence = await testBedGate(ctx);
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        return {
          status: "PASS",
          detail: `test bed ${SANDBOX_NAME}, scratch profile, stamp ${S(evidence.stamp)}`,
          evidence,
        };
      },
    }),
    liveStep({
      id: "w8-06-world",
      block: "W8.0",
      title: `the throwaway world ${WORLD}: wb_world new (when absent), register, open`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected: "the world on disk under _throwaway/W8/, registered and open in edit mode",
      kill_criterion: "it does not open: FAIL (W8.7 and W8.10 then find no throwaway world)",
      side_effects: [`${WORLD} and its layers and .meta under _throwaway/W8/`],
      rollback: "`w8.live.ts rollback` removes _throwaway/W8/ once Workbench is closed",
      probes: [],
      writes: [W8_ROOT],
      plan: worldPlan,
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        return { ...verdictOf(fails, [], "the throwaway world is open"), evidence };
      },
    }),
    liveStep({
      id: "w8-07-fixtures",
      block: "W8.0",
      title: `the hand block's fixtures (followups item 1): ${FIXTURE_ENTITY.name} in ${WORLD} by wb_entity create; ${ANIM_AW} (a graph of two nodes) by animation_graph and animation_workspace create; ${BT} (a root and one child) by behavior_tree create`,
      risk: "mutating",
      timeout_ms: 300_000,
      expected: `the entity is created at ${FIXTURE_ENTITY.coords} and its id is appended to <sitting>/${PLANT_FILE}; the .agr, .ast, .agf (two nodes), .aw and .bt are on disk under ${W8_ROOT}/ and registered`,
      kill_criterion:
        "a fixture call refuses: FAIL (the hand block then reads the surface empty, as in run 7); the throwaway world not open: FAIL, nothing created",
      side_effects: [
        `${FIXTURE_ENTITY.name} in the open throwaway world (memory only; never saved)`,
        `${ANIM_DIR}/ (EMCP_W8.agr, .ast, .agf, .aw, EMCP_W8_EventTable.ae, their .meta)`,
        `${BT} and its .meta`,
      ],
      rollback:
        "the entity: wb_entity delete in w8-88 (launch 1) and w8-98 (launch 2); the files: `w8.live.ts rollback` removes _throwaway/W8/",
      probes: [],
      writes: [ANIM_DIR, AI_DIR],
      plan: () => [...fixtureEntityPlan(), ...fixtureFilePlan()],
      offlineCalls: fixtureFileCalls,
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const ref = await ensureFixtureEntity(ctx, evidence, "w8-07-fixtures");
        if (!ref)
          fails.push(`the fixture entity was not created: ${JSON.stringify(evidence.entity)}`);
        await ensureFileFixtures(ctx, evidence, fails);
        evidence.curve = CURVE_GAP;
        return {
          ...verdictOf(fails, [], `fixtures made (entity ${ref}); the curve is not: ${CURVE_GAP}`),
          evidence,
        };
      },
    }),

    // ── W8.1 offline in process ──
    liveStep({
      id: "w8-10-settings-read",
      block: "W8.1",
      title: "wb_settings stores, list (paged), get (registry and the scratch profile), diff",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "each answers ok; list pages with nextCursor; ScriptDebugMode reads false in the scratch profile; diff answers added, removed, changed",
      kill_criterion: "an action refuses with anything but a gated code: FAIL",
      side_effects: [
        "a reg export file in <artifacts>/settings/exports/ (stores; read-only on the registry)",
      ],
      rollback: "none (reads)",
      probes: [],
      writes: [],
      plan: () => [
        tc("wb_settings", "stores"),
        tc("wb_settings", "list", { limit: 5 }),
        tc("wb_settings", "list", { limit: 5, cursor: "<nextCursor>" }),
        tc("wb_settings", "get", { section: "World%20Editor", key: "ScriptDebugMode" }),
        tc("wb_settings", "get", {
          store: "<profile>",
          section: "World%20Editor",
          key: "ScriptDebugMode",
        }),
        tc("wb_settings", "diff", { a: "registry", b: "<profile>" }),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const evidence: Raw = {};
        const profile = prepRecord(ctx.opts, ctx.deps)?.profile ?? ctx.opts.profile ?? "";
        const calls: Array<[string, Raw]> = [
          ["stores", { action: "stores" }],
          ["list", { action: "list", limit: 5 }],
        ];
        for (const [k, a] of calls) {
          const r = await ctx.tool("wb_settings", a);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
          if (k === "list" && r.ok && S(rb(r).nextCursor)) {
            const p2 = await ctx.tool("wb_settings", {
              action: "list",
              limit: 5,
              cursor: S(rb(r).nextCursor),
            });
            evidence.list2 = brief(p2);
            if (!p2.ok) fails.push(`list page 2: ${why(p2)}`);
          }
        }
        const g = await ctx.tool("wb_settings", {
          action: "get",
          section: "World%20Editor",
          key: "ScriptDebugMode",
        });
        evidence.getRegistry = brief(g);
        if (!g.ok && S(g.code) !== "INVALID_ARGUMENT") fails.push(`get registry: ${why(g)}`);
        if (profile) {
          const gs = await ctx.tool("wb_settings", {
            action: "get",
            store: profile,
            section: "World%20Editor",
            key: "ScriptDebugMode",
          });
          evidence.getScratch = brief(gs);
          if (!gs.ok) fails.push(`get scratch: ${why(gs)}`);
          else if (S(rb(gs).value).toLowerCase() !== "false")
            fails.push(
              `ScriptDebugMode reads '${S(rb(gs).value)}' in the scratch profile, not false`,
            );
          const d = await ctx.tool("wb_settings", { action: "diff", a: "registry", b: profile });
          evidence.diff = brief(d);
          if (!d.ok) fails.push(`diff: ${why(d)}`);
        } else fails.push(`no profile name (${PREP_FILE} absent)`);
        return { ...verdictOf(fails, [], "wb_settings reads answer"), evidence };
      },
    }),
    liveStep({
      id: "w8-11-link-offline",
      block: "W8.1",
      title:
        "wb_link build then parse of each link kind (world, resource, script, editor), the web prefix answered",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "each built link parses back to its kind and fields; the web-prefix form parses to the same kind",
      kill_criterion: "a built link does not parse back to its kind: FAIL",
      side_effects: [],
      rollback: "none (TS only)",
      probes: [],
      writes: [],
      plan: () => [
        ...LINK_BUILDS.map((b) => tc("wb_link", "build", b)),
        ...LINK_BUILDS.map(() => tc("wb_link", "parse", { link: "<the built link>" })),
        tc("wb_link", "build", { ...LINK_BUILDS[0], webPrefix: true }),
        tc("wb_link", "parse", { link: "<the web-prefixed link>" }),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const evidence: Raw = {};
        const links: Raw = {};
        for (const b of [...LINK_BUILDS, { ...LINK_BUILDS[0], webPrefix: true }]) {
          const label = `${S(b.kind)}${b.webPrefix ? "+web" : ""}`;
          const built = await ctx.tool("wb_link", { action: "build", ...b });
          const link = S(rb(built).link);
          const parsed = link ? await ctx.tool("wb_link", { action: "parse", link }) : null;
          evidence[label] = { build: brief(built), parse: brief(parsed) };
          if (!built.ok || !link) {
            fails.push(`build ${label}: ${built.ok ? "no link" : why(built)}`);
            continue;
          }
          links[label] = link;
          if (!parsed || !parsed.ok)
            fails.push(`parse ${label}: ${parsed ? why(parsed) : "not sent"}`);
          else if (S(rb(parsed).kind) && S(rb(parsed).kind) !== S(b.kind))
            fails.push(`${label} parsed as ${S(rb(parsed).kind)}`);
        }
        ctx.state.set("links", links);
        return { ...verdictOf(fails, [], "every link kind round-trips"), evidence };
      },
    }),
    liveStep({
      id: "w8-12-menu-offline",
      block: "W8.1",
      title:
        "wb_menu list (paged, and of the World Editor), describe of an allow-listed, a dialog and a risk item",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "list answers total and nextCursor; describe answers path, risk, verified, allowListed, opensDialog; the dialog item opensDialog; the risk item is not allow-listed or is denied",
      kill_criterion: "list or describe refuses (other than an unknown item): FAIL",
      side_effects: [],
      rollback: "none (the ledger is read)",
      probes: [],
      writes: [],
      plan: () => [
        tc("wb_menu", "list", { limit: 50 }),
        tc("wb_menu", "list", { limit: 50, cursor: "<nextCursor>" }),
        tc("wb_menu", "list", { module: "WorldEditor", limit: 100 }),
        tc("wb_menu", "describe", { module: "WorldEditor", path: "Window,Log Console" }),
        tc("wb_menu", "describe", MENU_DIALOG_ITEM),
        tc("wb_menu", "describe", MENU_RISK_ITEM),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const evidence: Raw = {};
        const l1 = await ctx.tool("wb_menu", { action: "list", limit: 50 });
        evidence.list = {
          ok: l1.ok,
          total: rb(l1).total ?? null,
          nextCursor: rb(l1).nextCursor ?? null,
        };
        if (!l1.ok) fails.push(`list: ${why(l1)}`);
        if (l1.ok && S(rb(l1).nextCursor)) {
          const l2 = await ctx.tool("wb_menu", {
            action: "list",
            limit: 50,
            cursor: S(rb(l1).nextCursor),
          });
          evidence.list2 = { ok: l2.ok, code: l2.code ?? null };
          if (!l2.ok) fails.push(`list page 2: ${why(l2)}`);
        }
        const we = await ctx.tool("wb_menu", { action: "list", module: "WorldEditor", limit: 100 });
        evidence.listWorldEditor = { ok: we.ok, total: rb(we).total ?? null };
        if (!we.ok) fails.push(`list WorldEditor: ${why(we)}`);
        for (const [k, a] of [
          ["allowListed", { module: "WorldEditor", path: "Window,Log Console" }],
          ["dialog", MENU_DIALOG_ITEM],
          ["risk", MENU_RISK_ITEM],
        ] as const) {
          const d = await ctx.tool("wb_menu", { action: "describe", ...a });
          evidence[k] = brief(d);
          if (!d.ok && S(d.code) !== "INVALID_ARGUMENT") fails.push(`describe ${k}: ${why(d)}`);
          if (k === "dialog" && d.ok && rb(d).opensDialog !== true)
            fails.push("File,Options... does not read opensDialog");
          if (k === "risk" && d.ok && rb(d).allowListed === true && !rb(d).deniedBy)
            fails.push("File,Exit reads allow-listed and not denied");
        }
        return { ...verdictOf(fails, [], "wb_menu list and describe answer"), evidence };
      },
    }),

    // ── W8.2 kernel and natives (P-W8-24 first: the first wb_diag call) ──
    liveStep({
      id: "w8-20-p24-diag-compile",
      block: "W8.2",
      title:
        "P-W8-24: wb_scripts validate, then wb_diag info with no arguments and with module ResourceManager (the first wb_diag call)",
      risk: "read-only",
      timeout_ms: 180_000,
      expected:
        "validate answers; info answers cwd, executable, projectFile and utcTime; the OS user name never appears in the answer (TS redaction)",
      kill_criterion:
        "info gives no handler answer (EMCP_WB_Diag did not compile): KILLED, every wb_diag step SKIPPED; a field missing: that field drops (PARTIAL)",
      side_effects: ["info with module may open the Resource Manager module (DEC-042 U10)"],
      rollback: "none (reads)",
      probes: ["P-W8-24"],
      writes: [],
      plan: () => [
        tc("wb_scripts", "validate", { configuration: "WORKBENCH" }),
        tc("wb_diag", "info"),
        tc("wb_diag", "info", { module: "ResourceManager" }),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const evidence: Raw = {};
        const v = await ctx.tool("wb_scripts", { action: "validate", configuration: "WORKBENCH" });
        evidence.validate = brief(v);
        const i1 = await ctx.tool("wb_diag", { action: "info" });
        const i2 = await ctx.tool("wb_diag", { action: "info", module: "ResourceManager" });
        evidence.info = brief(i1);
        evidence.infoModule = brief(i2);
        const user = ctx.deps.userName();
        for (const [k, r] of [
          ["info", i1],
          ["info module", i2],
        ] as const)
          if (leaksUser(JSON.stringify(r), user))
            fails.push(`${k}: the OS user name appears in the answer (not redacted)`);
        const want = ["cwd", "executable", "projectFile", "utcTime"];
        const missing = i1.ok ? want.filter((f) => S(rb(i1)[f]) === "") : want;
        const observed: Raw = {
          validate: answerOf(v),
          info: answerOf(i1),
          infoModule: answerOf(i2),
          missing,
        };
        const probe =
          !i1.ok && !DOMAIN_CODES.has(S(i1.code))
            ? killed(
                "P-W8-24",
                observed,
                `info gave no handler answer (${S(i1.code)}): EMCP_WB_Diag did not compile or is not installed`,
              )
            : !i1.ok
              ? partial("P-W8-24", observed, `info refused ${S(i1.code)}`)
              : missing.length
                ? partial(
                    "P-W8-24",
                    observed,
                    `fields absent: ${missing.join(", ")} (those calls drop)`,
                  )
                : settled(
                    "P-W8-24",
                    observed,
                    "compiled; info answers every field; the user name is redacted",
                  );
        return {
          ...verdictOf(fails, [probe], "EMCP_WB_Diag answers info"),
          evidence,
          probes: [probe],
        };
      },
    }),
    liveStep({
      id: "w8-21-diag-catalog",
      block: "W8.2",
      title:
        "wb_diag catalog (paged, and one menu): the generated catalog of SCR_DebugMenuID and EDiagMenu",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "catalog answers total (about 268 + 7) and nextCursor; rows read path;enumName;kind;values",
      kill_criterion: "catalog refuses with anything but the catalog-not-generated refusal: FAIL",
      side_effects: [],
      rollback: "none (TS)",
      probes: [],
      dependsOn: ["P-W8-24"],
      writes: [],
      plan: () => [
        tc("wb_diag", "catalog", { limit: 50 }, { target: "TS wb_diag catalog (no NET call)" }),
        tc(
          "wb_diag",
          "catalog",
          { limit: 50, cursor: "<nextCursor>" },
          { target: "TS wb_diag catalog (no NET call)" },
        ),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const c1 = await ctx.tool("wb_diag", { action: "catalog", limit: 50 });
        const evidence: Raw = {
          catalog: {
            ok: c1.ok,
            code: c1.code ?? null,
            total: rb(c1).total ?? null,
            nextCursor: rb(c1).nextCursor ?? null,
          },
        };
        if (!c1.ok && !DOMAIN_CODES.has(S(c1.code))) fails.push(`catalog: ${why(c1)}`);
        if (c1.ok && S(rb(c1).nextCursor)) {
          const c2 = await ctx.tool("wb_diag", {
            action: "catalog",
            limit: 50,
            cursor: S(rb(c1).nextCursor),
          });
          evidence.catalog2 = { ok: c2.ok, code: c2.code ?? null };
          if (!c2.ok) fails.push(`catalog page 2: ${why(c2)}`);
        }
        return { ...verdictOf(fails, [], `catalog total ${S(rb(c1).total) || "n/a"}`), evidence };
      },
    }),
    liveStep({
      id: "w8-22-p23-backlog",
      block: "W8.2",
      title:
        "P-W8-23: a long wb_resources search on one client, a ping on a second (P-SD-net-listener-backlog-two)",
      risk: "read-only",
      timeout_ms: 180_000,
      expected: "the ping answers while the search runs, or queues and answers after",
      kill_criterion:
        "the second connection is refused: the kernel is single-client (KILLED; the deferred probe closes with that)",
      side_effects: [],
      rollback: "none (reads)",
      probes: ["P-W8-23"],
      writes: [],
      plan: () => [
        tc(
          "wb_resources",
          "search",
          { searchStr: ["a"], recursive: true, limit: 500 },
          { note: "client A, long" },
        ),
        {
          kind: "net-call",
          target: "EMCP_WB_Ping",
          note: "client B, during A's search",
        } as PlanAction,
      ],
      run: async (ctx) => {
        const b = await ctx.deps.backlog();
        const observed: Raw = { ...b };
        const probe = b.secondRefused
          ? killed(
              "P-W8-23",
              observed,
              "the second connection was refused while a call was in flight",
            )
          : b.secondOk
            ? settled(
                "P-W8-23",
                observed,
                b.secondMs < b.firstMs
                  ? "the ping answered during the search"
                  : "the ping queued and answered after the search",
              )
            : partial(
                "P-W8-23",
                observed,
                `the ping failed (${S(b.secondCode)}) without a refusal`,
              );
        const fails =
          b.firstOk || DOMAIN_CODES.has(S(b.firstCode))
            ? []
            : [`the search failed: ${S(b.firstCode)}`];
        return {
          ...verdictOf(fails, [probe], "P-W8-23 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),
    liveStep({
      id: "w8-23-scripts-status",
      block: "W8.2",
      title: "wb_scripts status with IsWorldEditorRunning (TS-6)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: "status answers; worldEditorRunning reads true (the World Editor is up)",
      kill_criterion: "status refuses: FAIL",
      side_effects: [],
      rollback: "none (reads)",
      probes: [],
      writes: [],
      plan: () => [tc("wb_scripts", "status")],
      run: async (ctx) => {
        const s = await ctx.tool("wb_scripts", { action: "status" });
        const r = rb(s);
        const running = r.worldEditorRunning ?? (r.worldEditor as Raw | undefined)?.running ?? null;
        const fails: string[] = [];
        if (!s.ok) fails.push(`status: ${why(s)}`);
        else if (running !== true && running !== null && running !== undefined)
          fails.push(`worldEditorRunning reads ${S(running)} with the World Editor up`);
        return {
          ...verdictOf(fails, [], `worldEditorRunning ${S(running) || "unknown"}`),
          evidence: { status: brief(s), running },
        };
      },
    }),

    // ── W8.3 locator sweep (P-W8-02, before any drive step) ──
    liveStep({
      id: "w8-30-p02-locator-sweep",
      block: "W8.3",
      title:
        "P-W8-02: every module opened in turn, its window's UIA tree read, each census locator resolved against it",
      risk: "reversible",
      timeout_ms: 1_800_000,
      expected: `at least ${P02_PASS_SHARE * 100} percent of the main-window locators (each row's newest: a 1.9.0.37 locator before a 1.8.0.13 one; DEC-078) resolve to one element with the census name and type; menu, context-menu and dialog rows are recorded elsewhere and the Maximize/Minimize-Restore rows volatile, both outside the share; the Object Properties grid items resolve against a second World Editor tree read with the w8-07 fixture selected (the other rows against the selection-none read); the Resource Manager sub-editors in LAUNCH1_SUB_EDITORS (${LAUNCH1_SUB_EDITORS.length} of ${Object.keys(VIEWER_EXTENSIONS).length}: the exit-crash cap, w8-exit-crash.md) are read with one vanilla file each open and tallied apart (subEditors), outside the share, the others recorded in notSwept with the cap's reason; <sitting>/${P02_RESULTS_FILE} holds every result for scripts/census/locators-carry.ts`,
      kill_criterion:
        "under the pass share: KILLED (OD-13: re-walk the affected modules with L01 before W8.4)",
      side_effects: [
        "each editor module opens (and may come to the front, DEC-042 U10); nothing is driven",
        `the World Editor selection set to ${FIXTURE_ENTITY.name} for one tree read, then cleared`,
        `one vanilla resource in each of ${SUB_EDITOR_CAP} Resource Manager sub-editors opened read-only (its tab stays open, unmodified; no tool can close it, hence the cap)`,
      ],
      rollback:
        "the selection cleared (wb_view select clear); modules and sub-editor tabs stay open, unmodified; the closable step leaves the World Editor fresh",
      probes: ["P-W8-02"],
      writes: [],
      plan: () => {
        const tree = (pattern: string, note?: string): PlanAction =>
          tc(
            "wb_gui",
            "tree",
            { className: EDITOR_CLASS, windowTitle: pattern, depth: 60, rowSampling: 200 },
            note ? { note } : {},
          );
        return [
          ...Object.keys(MODULE_WINDOWS).flatMap((m) => [
            tc("wb_module", "open", { module: m }),
            ...(m === "WorldEditor"
              ? [tc("wb_view", "select", { mode: "clear" }, { note: "selection none first" })]
              : []),
            tree(MODULE_WINDOWS[m]!),
            ...(m === "WorldEditor"
              ? [
                  tc(
                    "wb_view",
                    "select",
                    { mode: "set", entities: ["<the w8-07 fixture ref>"] },
                    { note: "followups item 4: the grid items need an entity selected" },
                  ),
                  tree(MODULE_WINDOWS[m]!, "the selected read: the property-grid rows only"),
                  tc(
                    "wb_view",
                    "select",
                    { mode: "clear" },
                    { note: "the selection back to none" },
                  ),
                ]
              : []),
          ]),
          ...Object.entries(VIEWER_EXTENSIONS)
            .filter(([m]) => LAUNCH1_SUB_EDITORS.includes(m))
            .flatMap(([m, ext]) => [
              tc("wb_resources", "search", { extensions: [ext], recursive: true, limit: 20 }),
              tc(
                "wb_module",
                "setResource",
                { module: "ResourceManager", target: "path:<the hit>" },
                {
                  note: `followups item 2: ${m}'s tab, a vanilla file read-only (exit-crash cap: ${SUB_EDITOR_CAP} per launch)`,
                },
              ),
              tree(MODULE_WINDOWS.ResourceManager!, `${m} with its tab active`),
            ]),
        ];
      },
      offlineCalls: () => [oc("census", "resolveLocators")],
      run: async (ctx) => {
        const fails: string[] = [];
        const rows = [...ctx.deps.censusRows().values()].filter((r) => r.locator);
        // Fix-up 2: each row is swept by its newest locator (the carried build file's record or
        // the ledger's); the share is reported per build and on the newest build's alone.
        let fileRecords: Map<string, LocatorRecord> = new Map();
        try {
          fileRecords = ctx.deps.locators();
        } catch (e) {
          fails.push(
            `the locator file does not read: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        const byModule = new Map<string, CensusRowLite[]>();
        for (const r of rows) {
          const m = S(r.module);
          byModule.set(m, [...(byModule.get(m) ?? []), r]);
        }
        const results: Raw[] = [];
        const evidence: Raw = {};
        const notSwept: Raw = {};
        // Fix-up 1: the results are locators-carry.ts's input, which refuses a build other than the
        // locator file's; "unrecorded" (no --build, no current-build.json) carries nothing.
        if (ctx.opts.build === "unrecorded")
          fails.push("no build recorded (--build): locators-carry.ts would refuse every result");
        // The share counts only locators whose element lives in the module's main window
        // (sweepSurface "window"; DEC-078 ruling 1); menu popups, context menus and dialogs are
        // counted apart, and the title bar's window-state buttons are volatile (ruling 3).
        const byBuild: Record<string, SweepTally> = {};
        const volatile: string[] = [];
        const elsewhere: Record<string, number> = {};
        const failures: Record<string, number> = {};
        let notRead18 = 0;
        // Followups item 2: the eight Resource Manager sub-editors are swept too, each in the RM
        // window with one vanilla file of its kind open (the P4-9 route), after every main
        // window, so the main-window reads are those of run 7. Their rows are tallied apart
        // (`subEditors`), outside P-W8-02's main-window share, and their results go to the carry.
        const subTally: Record<string, SweepTally & { elsewhere: number; resource: string }> = {};
        // Followups item 4: the property-grid rows resolve only with an entity selected; they are
        // resolved against a second World Editor tree read with the w8-07 fixture selected.
        const bound: SweepTally & { read: boolean; ref: string | null } = {
          rows: 0,
          ok: 0,
          read: false,
          ref: null,
        };
        const fullOrder = [...byModule.keys()].sort(
          (a, b) => Number(a in VIEWER_EXTENSIONS) - Number(b in VIEWER_EXTENSIONS),
        );
        // Exit-crash bisect aid (w8-exit-crash.md): --sweep-only / --sweep-limit / --sweep-no-tree.
        const filter = ctx.opts.sweep;
        const picked = applySweepFilter(fullOrder, filter);
        const order = picked.kept;
        for (const m of picked.capped)
          notSwept[m] = { rows: byModule.get(m)!.length, why: SUB_EDITOR_CAP_WHY };
        for (const m of picked.dropped)
          notSwept[m] = {
            rows: byModule.get(m)!.length,
            why: "bisect: left out by the sweep filter",
          };
        if (picked.unknown.length)
          fails.push(`--sweep-only names no swept module: ${picked.unknown.join(", ")}`);
        for (const module of order) {
          const list = byModule.get(module)!;
          const isSub = module in VIEWER_EXTENSIONS;
          const pattern = isSub ? MODULE_WINDOWS.ResourceManager : MODULE_WINDOWS[module];
          if (!pattern) {
            const why2 =
              NOT_SWEPT[module] ??
              (module.startsWith("ResourceManager.")
                ? NOT_SWEPT["ResourceManager.*"]
                : "no window pattern");
            notSwept[module] = { rows: list.length, why: why2 };
            continue;
          }
          let open: ToolResponse;
          let resource = "";
          if (isSub) {
            const hit = await ctx.tool("wb_resources", {
              action: "search",
              extensions: [VIEWER_EXTENSIONS[module]],
              recursive: true,
              limit: 20,
            });
            resource = firstResourcePath(hit);
            if (!resource) {
              notSwept[module] = {
                rows: list.length,
                why: `no vanilla .${VIEWER_EXTENSIONS[module]} found (${answerOf(hit)})`,
              };
              continue;
            }
            open = await ctx.tool("wb_module", {
              action: "setResource",
              module: "ResourceManager",
              target: `path:${resource}`,
            });
            if (!open.ok) {
              notSwept[module] = {
                rows: list.length,
                why: `setResource of ${resource}: ${why(open)}`,
              };
              continue;
            }
            await ctx.sleep(TIMEOUTS.poll);
          } else open = await ctx.tool("wb_module", { action: "open", module });
          if (module === "WorldEditor") await selectNone(ctx);
          if (filter?.noTree) {
            evidence[module] = {
              open: answerOf(open),
              rows: list.length,
              ...(isSub ? { resource } : {}),
            };
            notSwept[module] = {
              rows: list.length,
              why: "bisect: --sweep-no-tree (opened, not read)",
            };
            continue;
          }
          // Fix-up 1: six of eight trees answered INVALID_ARGUMENT in run 2 with no message kept.
          // The read is retried while it answers INVALID_ARGUMENT (the window may not be listed
          // yet after open), and every answer's message is recorded.
          const treeArgs = {
            action: "tree",
            pid: ctx.deps.recordedPid() ?? undefined,
            className: EDITOR_CLASS,
            windowTitle: pattern,
            depth: 60,
            rowSampling: 200,
          };
          const attempts: string[] = [];
          let tree = await ctx.tool("wb_gui", treeArgs);
          for (let t = 1; t < TREE_TRIES && !tree.ok && tree.code === "INVALID_ARGUMENT"; t++) {
            attempts.push(why(tree));
            await ctx.deps.sleep(TIMEOUTS.poll);
            tree = await ctx.tool("wb_gui", treeArgs);
          }
          const root = tree.ok ? treeOf(tree, ctx.deps) : null;
          evidence[module] = {
            open: answerOf(open),
            tree: answerOf(tree),
            rows: list.length,
            ...(attempts.length ? { treeRetries: attempts } : {}),
          };
          if (!root) {
            if (!tree.ok && !DOMAIN_CODES.has(S(tree.code)))
              fails.push(`${module} tree: ${why(tree)}`);
            if (tree.ok) fails.push(`${module} tree: the answer holds no readable tree`);
            const n18 = list.filter(
              (r) => sweepLocator(r, fileRecords.get(r.id))?.build === "1.8.0.13",
            ).length;
            notRead18 += n18;
            const treeWhy = tree.ok ? "no readable tree in the answer" : why(tree);
            Object.assign(evidence[module] as Raw, { treeRead: false, treeWhy });
            notSwept[module] = { rows: list.length, rows18: n18, why: `tree not read: ${treeWhy}` };
            continue;
          }
          const window: LocatorWindow = { className: EDITOR_CLASS, titlePattern: pattern };
          const mainId = S(root.automationId);
          let selRoot: UiaNode | null = null;
          if (module === "WorldEditor") {
            const fx = liveFixture(ctx.opts, ctx.deps);
            const selection: Raw = { ref: fx?.ref ?? null };
            if (fx) {
              bound.ref = fx.ref;
              const sel = await selectFixture(ctx, fx.ref);
              selection.select = answerOf(sel);
              if (sel.ok) {
                const t2 = await ctx.tool("wb_gui", { ...treeArgs, label: "w8-30-selected" });
                selection.tree = answerOf(t2);
                selRoot = t2.ok ? treeOf(t2, ctx.deps) : null;
                bound.read = selRoot !== null;
              }
              const clear = await selectNone(ctx);
              selection.clear = answerOf(clear);
            } else selection.note = `no live fixture entity in ${PLANT_FILE} (w8-07)`;
            (evidence[module] as Raw).selection = selection;
          }
          if (isSub) (evidence[module] as Raw).resource = resource;
          let ok = 0;
          for (const row of list) {
            const loc = sweepLocator(row, fileRecords.get(row.id));
            if (!loc) continue;
            const spec = loc.spec;
            const needsSel = sweepSelectionBound(row.id, spec);
            const res = resolveLocator(needsSel && selRoot ? selRoot : root, spec);
            const node = res.hit?.node ?? null;
            const mismatch = node
              ? censusMismatch(node, { name: censusName(row), controlType: loc.controlType })
              : "unresolved";
            const passed = res.ok && !mismatch;
            if (passed) ok++;
            const surface = sweepSurface(row, spec, mainId);
            if (needsSel && surface === "window") {
              bound.rows++;
              if (passed) bound.ok++;
            }
            if (isSub) {
              const t = (subTally[module] ??= { rows: 0, ok: 0, elsewhere: 0, resource });
              if (surface !== "window") t.elsewhere++;
              else {
                t.rows++;
                if (passed) t.ok++;
              }
            } else if (surface !== "window") elsewhere[surface] = (elsewhere[surface] ?? 0) + 1;
            else if (sweepVolatile(spec)) volatile.push(row.id);
            else {
              const t = (byBuild[loc.build] ??= { rows: 0, ok: 0 });
              t.rows++;
              if (passed) t.ok++;
              else {
                const k = `${loc.build} ${sweepFailure(res, mismatch)}`;
                failures[k] = (failures[k] ?? 0) + 1;
              }
            }
            const line: Partial<LocatorProbeResult> & Raw = {
              probe: LOCATOR_PROBE,
              build: ctx.opts.build,
              rowId: row.id,
              window,
              ...(spec.automationId ? { automationId: spec.automationId } : {}),
              ...(spec.ordinal !== undefined ? { ordinal: spec.ordinal } : {}),
              ...(spec.itemPath ? { itemPath: spec.itemPath } : {}),
              ...(spec.path ? { path: spec.path } : {}),
              locatorBuild: loc.build,
              locatorSource: loc.source,
              resolved: res.ok ? 1 : res.count,
              name: node?.name ?? "",
              controlType: node?.controlType ?? "",
              // Fix-up 3: the carry skips an unresolved off-window row by this, quietly.
              surface,
              ...(row.label && /(\.\.\.|…)$/.test(row.label) ? { opensDialog: true } : {}),
            };
            results.push(line);
          }
          (evidence[module] as Raw).resolved = ok;
        }
        const shares = sweepShares(byBuild, ctx.opts.build);
        const carried = shares.rows;
        const carriedOk = shares.ok;
        // DEC-079: once the current build holds most of the swept rows (the module was re-walked at
        // it), the verdict is the share of that build's locators; a row known only by an older build's
        // locator is a census difference (kept in byBuild and failures), not a locator failure.
        const onNewest = !!shares.newest && shares.newest.rows * 2 >= shares.rows;
        const share = onNewest && shares.newest ? shares.newest.share : shares.share;
        const observed: Raw = {
          carried,
          carriedOk,
          share,
          verdictOn: onNewest ? ctx.opts.build : "all builds",
          byBuild,
          newest: shares.newest ? { build: ctx.opts.build, ...shares.newest } : null,
          failures,
          elsewhere,
          volatile,
          notRead18,
          results: results.length,
          notSwept,
          subEditors: subTally,
          selectionBound: bound,
          ...(filter ? { bisect: { ...filter, swept: order } } : {}),
          ...(picked.capped.length
            ? { subEditorCap: { cap: SUB_EDITOR_CAP, notSwept: picked.capped } }
            : {}),
        };
        // A filtered sweep is a bisect run, never P-W8-02's verdict: PARTIAL, so nothing is KILLED.
        const probe = filter
          ? partial(
              "P-W8-02",
              observed,
              `bisect run (${order.join(", ") || "no module"}${filter.noTree ? ", no tree read" : ""}): not the P-W8-02 verdict`,
            )
          : carried === 0
            ? partial("P-W8-02", observed, "no main-window locator was swept")
            : share >= P02_PASS_SHARE
              ? settled(
                  "P-W8-02",
                  observed,
                  `${carriedOk}/${carried} main-window locators resolve (${(share * 100).toFixed(1)} percent; ${sweepByBuildText(byBuild)})`,
                )
              : killed(
                  "P-W8-02",
                  observed,
                  `${carriedOk}/${carried} main-window locators resolve (${sweepByBuildText(byBuild)}): under ${P02_PASS_SHARE * 100} percent; OD-13 re-walk with L01`,
                );
        return {
          ...verdictOf(fails, [probe], "P-W8-02 swept"),
          evidence: { ...evidence, notSwept },
          probes: [probe],
          results: { file: P02_RESULTS_FILE, lines: results },
        };
      },
    }),

    liveStep({
      id: ACCEPT_STEP,
      block: "W8.3",
      title: `engine-accept proof of wb_settings (the wave's offline writer): the value wb_settings set flipped in the launch ini ([${ACCEPT_SETTING.section}] ${ACCEPT_SETTING.key}) read back from the engine through its Log Console button (wb_gui read, toggleState)`,
      // reversible, not read-only: it switches to the World Editor module, and W8.3's order is
      // read-only, then reversible (w8-30 is reversible)
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "the launch ini and the registry read through wb_settings get; the engine's button reads the ini's value (On for true, Off for false), which differs from the registry's",
      kill_criterion:
        "the engine shows the other value: FAIL (Workbench did not take the edited ini). The read answering NO_LOCATOR or LOCATOR_STALE (no 1.9 locator before the carry) or the edit not written in prep: NOT-RUN with the switch",
      side_effects: ["the World Editor module opened (it is the gate's)"],
      rollback: "none: the World Editor is the module the gate leaves open; the rest are reads",
      probes: [],
      dependsOn: ["P-W8-02", "P-W8-04"],
      writes: [],
      plan: () => [
        tc("wb_settings", "get", { section: ACCEPT_SETTING.section, key: ACCEPT_SETTING.key }),
        tc("wb_settings", "get", {
          store: `<profile>${ACCEPT_SUFFIX}`,
          section: ACCEPT_SETTING.section,
          key: ACCEPT_SETTING.key,
        }),
        tc("wb_module", "open", { module: "WorldEditor" }),
        tc("wb_gui", "read", { rowId: ACCEPT_SETTING.row }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const prep = prepRecord(ctx.opts, ctx.deps);
        const accept = prep?.accept ?? null;
        evidence.prep = accept ?? { notWritten: prep?.acceptWhy ?? `no ${PREP_FILE}` };
        if (!accept)
          return {
            status: "NOT-RUN",
            detail: `the accept edit was not written in prep: ${prep?.acceptWhy ?? `no ${PREP_FILE}`}`,
            evidence,
          };
        const reg = await ctx.tool("wb_settings", {
          action: "get",
          section: accept.section,
          key: accept.key,
        });
        const ini = await ctx.tool("wb_settings", {
          action: "get",
          store: `${prep!.profile}${ACCEPT_SUFFIX}`,
          section: accept.section,
          key: accept.key,
        });
        evidence.registry = brief(reg);
        evidence.ini = brief(ini);
        const open = await ctx.tool("wb_module", { action: "open", module: "WorldEditor" });
        evidence.open = answerOf(open);
        const r = await readRow(ctx, ACCEPT_SETTING.row);
        evidence.read = brief(r);
        const iniValue = ini.ok ? settingBool(rb(ini).value) : settingBool(accept.after);
        const regValue = reg.ok ? settingBool(rb(reg).value) : null;
        const engine = r.ok ? toggleAsSetting(rb(r).toggleState) : null;
        const observed: Raw = {
          iniValue,
          registryValue: regValue,
          engineValue: engine,
          toggleState: rb(r).toggleState ?? null,
          discriminating: iniValue !== null && regValue !== null && iniValue !== regValue,
        };
        evidence.observed = observed;
        if (!r.ok)
          return WAIT_CODES.has(S(r.code))
            ? {
                status: "NOT-RUN",
                detail: `the read answered ${S(r.code)}: ${SWITCHES.gui}`,
                evidence,
              }
            : { status: "FAIL", detail: `the read: ${why(r)}`, evidence };
        if (engine === null)
          return {
            status: "FAIL",
            detail: `the button's toggleState '${S(rb(r).toggleState)}' reads as no bool`,
            evidence,
          };
        if (engine !== iniValue)
          return {
            status: "FAIL",
            detail: `the engine shows ${engine}, the launch ini holds ${S(iniValue)}: the edited ini was not taken`,
            evidence,
          };
        return {
          status: "PASS",
          detail: `the engine shows the edited value ${engine}${observed.discriminating ? ` (the registry holds ${S(regValue)})` : " (the registry holds the same value: the read does not tell the two stores apart)"}`,
          evidence,
        };
      },
    }),

    // ── W8.4 driver (after P-W8-02 and the carry) ──
    liveStep({
      id: "w8-40-p01-dock-toggles",
      block: "W8.4",
      title:
        "P-W8-01: wb_gui read, invoke and invoke back on the three dock toggles (Log Console, Properties, Hierarchy); expand on a tree item; select on two tabs and back",
      risk: "reversible",
      timeout_ms: 300_000,
      expected:
        "each pattern acts with Workbench not foreground; each dock flips and flips back; focus is not stolen",
      kill_criterion:
        "a pattern needs the foreground: that pattern's rows ride the hand block as pixel recipes (KILLED for that pattern)",
      side_effects: [
        "three docks hidden and shown again; one tree item expanded (wb_gui has no collapse: view state only); a tab selected and the first selected again",
      ],
      rollback: "each toggle is invoked a second time; the first tab is selected again",
      probes: ["P-W8-01"],
      dependsOn: ["P-W8-02"],
      writes: [],
      plan: () => [
        tc("wb_gui", "read", { rowId: String(ROWS.dockToggles) }),
        guiDrive("invoke", String(ROWS.dockToggles), "hide the dock"),
        guiDrive("invoke", String(ROWS.dockToggles), "show it again"),
        guiDrive("expand", String(ROWS.treeItem), "a tree item (view state)"),
        guiDrive("select", String(ROWS.tabs), "the second tab, then the first again"),
      ],
      run: async (ctx) => {
        const recs = ctx.deps.locators();
        const docks = pickRows(recs, ROWS.dockToggles, 3);
        const evidence: Raw = { rows: docks.map((d) => d.rowId) };
        const answers: Raw = {};
        const fails: string[] = [];
        for (const d of docks) {
          const r0 = await readRow(ctx, d.rowId);
          const a = await drive(ctx, "invoke", d.rowId);
          const b = a.ok ? await drive(ctx, "invoke", d.rowId) : null;
          const r1 = await readRow(ctx, d.rowId);
          answers[d.rowId] = {
            read: answerOf(r0),
            invoke: answerOf(a),
            back: answerOf(b),
            readAfter: answerOf(r1),
          };
          if (!okOrWaiting(a)) fails.push(`${d.rowId}: ${why(a)}`);
          if (a.ok && b && !b.ok) fails.push(`${d.rowId}: the toggle back failed (${why(b)})`);
        }
        const tree = pickRows(recs, ROWS.treeItem, 1)[0];
        if (tree) {
          const e = await drive(ctx, "expand", tree.rowId);
          answers[tree.rowId] = { expand: answerOf(e) };
          if (!okOrWaiting(e)) fails.push(`expand: ${why(e)}`);
        }
        const tabs = pickRows(recs, ROWS.tabs, 2);
        if (tabs.length === 2) {
          const s1 = await drive(ctx, "select", tabs[1]!.rowId);
          const s0 = s1.ok ? await drive(ctx, "select", tabs[0]!.rowId) : null;
          answers.tabs = { select: answerOf(s1), back: answerOf(s0) };
          if (!okOrWaiting(s1)) fails.push(`select: ${why(s1)}`);
        }
        evidence.answers = answers;
        const codes = Object.values(answers).flatMap((x) => Object.values(x as Raw).map(S));
        const acted = codes.filter((c) => c === "ok").length;
        const observed: Raw = { answers, switch: SWITCHES.gui };
        const probe =
          docks.length === 0
            ? partial(
                "P-W8-01",
                observed,
                "no 1.9 locator for the dock toggles: run scripts/census/locators-carry.ts after W8.3",
              )
            : acted === 0
              ? partial(
                  "P-W8-01",
                  observed,
                  `every drive answered a gate (${[...new Set(codes)].join(", ")}): ${SWITCHES.gui}`,
                )
              : settled(
                  "P-W8-01",
                  observed,
                  `${acted} pattern call(s) acted with Workbench behind this terminal`,
                );
        return { ...verdictOf(fails, [probe], "P-W8-01 answered"), evidence, probes: [probe] };
      },
    }),
    liveStep({
      id: "w8-41-drive-enabled",
      block: "W8.4",
      title:
        "the rows of gui.rows_enabled: toggle and invoke rows driven twice (back to their state), expand rows once (view state)",
      risk: "reversible",
      timeout_ms: 600_000,
      expected: "each enabled row acts and reads back its first state after the second drive",
      kill_criterion:
        "a row does not come back to its first state: FAIL and the row leaves gui.rows_enabled",
      side_effects: ["each enabled row acted on twice"],
      rollback: "the second drive",
      probes: [],
      dependsOn: ["P-W8-02", "P-W8-01"],
      writes: [],
      plan: () => [
        tc("wb_gui", "read", { rowId: "<each gui.rows_enabled row>" }),
        guiDrive("toggle", "<each gui.rows_enabled toggle row>", "twice"),
        guiDrive("invoke", "<each gui.rows_enabled dock row>", "twice"),
      ],
      run: async (ctx) => {
        const enabled = ctx.deps.rowsEnabled();
        const recs = ctx.deps.locators();
        const evidence: Raw = { enabled: enabled.length };
        const fails: string[] = [];
        const done: Raw = {};
        for (const rowId of enabled) {
          const rec = recs.get(rowId);
          if (!rec) {
            done[rowId] = "no 1.9 locator";
            continue;
          }
          if (rec.opensDialog) {
            done[rowId] = "opens a dialog: driven in W8.6 only";
            continue;
          }
          const act =
            rec.controlType === "TreeItem"
              ? "expand"
              : rec.controlType === "CheckBox"
                ? "toggle"
                : "invoke";
          const r0 = await readRow(ctx, rowId);
          const a = await drive(ctx, act, rowId);
          const b = a.ok && act !== "expand" ? await drive(ctx, act, rowId) : null;
          const r1 = await readRow(ctx, rowId);
          const same =
            JSON.stringify(rb(r0).toggleState ?? null) ===
            JSON.stringify(rb(r1).toggleState ?? null);
          done[rowId] = {
            act,
            a: answerOf(a),
            b: answerOf(b),
            restored: act === "expand" ? "view state" : same,
          };
          if (!okOrWaiting(a)) fails.push(`${rowId}: ${why(a)}`);
          if (a.ok && act !== "expand" && !same)
            fails.push(`${rowId}: not back to its first state`);
        }
        evidence.rows = done;
        return {
          ...verdictOf(
            fails,
            [],
            enabled.length
              ? `${enabled.length} enabled row(s)`
              : "gui.rows_enabled is empty: nothing to drive",
          ),
          evidence,
        };
      },
    }),

    // ── W8.5 menus (P-W8-22) ──
    liveStep({
      id: "w8-50-p22-menu-runs",
      block: "W8.5",
      title:
        "P-W8-22: wb_menu run of the World Editor Window items with a passing live result (DEC-100: on the proven allow-list, the row verified, not a dialog opener; dry run, confirm, confirm back); the dialog item and a risk item refused",
      risk: "reversible",
      timeout_ms: 300_000,
      expected:
        "each run answers ran (the dock flips) and the second run flips it back; File,Options... refuses MODAL_HAZARD or NOT_ALLOWLISTED (DEC-107); File,Exit refuses NOT_ALLOWLISTED; nothing is sent for either",
      kill_criterion:
        "an item opens a dialog or blocks: it leaves the allow-list and refuses MODAL_HAZARD (KILLED for that item)",
      side_effects: ["docks hidden and shown again through ExecuteAction"],
      rollback: "each item is run a second time",
      probes: ["P-W8-22"],
      // Fix-up 1: wb_menu runs through ExecuteAction by the census menu path, never a locator, so a
      // KILLED P-W8-02 does not skip it (run 2 skipped it).
      writes: [],
      plan: () => {
        const p = loadPolicy();
        const c = menuRunPicks(
          loadMenuItems(),
          loadAllowListFile(),
          p.execute_action?.allow_list ?? [],
          p.execute_action?.dialog_openers ?? [],
        );
        return [
          tc("wb_module", "open", { module: "WorldEditor" }),
          ...c.flatMap((i) => [
            tc("wb_menu", "describe", { module: i.module, path: i.path }),
            menuRunPlan(i.module, i.segments, false),
            menuRunPlan(i.module, i.segments, true),
            menuRunPlan(i.module, i.segments, true),
          ]),
          tc(
            "wb_menu",
            "run",
            { ...MENU_DIALOG_ITEM, confirm: true },
            { target: REFUSED_IN_TS, note: "MODAL_HAZARD expected" },
          ),
          tc(
            "wb_menu",
            "run",
            { ...MENU_RISK_ITEM, confirm: true },
            { target: REFUSED_IN_TS, note: "NOT_ALLOWLISTED expected" },
          ),
        ];
      },
      run: async (ctx) => {
        const fails: string[] = [];
        const evidence: Raw = {};
        const policy = loadPolicy();
        const cands = menuRunPicks(
          ctx.deps.menuItems(),
          ctx.deps.menuAllowList(),
          policy.execute_action?.allow_list ?? [],
          policy.execute_action?.dialog_openers ?? [],
        );
        evidence.picks = cands.map((c) => c.path);
        const open = await ctx.tool("wb_module", { action: "open", module: "WorldEditor" });
        evidence.open = answerOf(open);
        const per: Raw = {};
        const ran: string[] = [];
        const bad: string[] = [];
        for (const c of cands) {
          const d = await ctx.tool("wb_menu", {
            action: "describe",
            module: c.module,
            path: c.path,
          });
          const first = await ctx.tool("wb_menu", {
            action: "run",
            module: c.module,
            path: c.path,
          });
          const dry = first.ok && rb(first).dryRun === true;
          const conf = dry
            ? await ctx.tool("wb_menu", {
                action: "run",
                module: c.module,
                path: c.path,
                confirm: true,
              })
            : first;
          const back =
            conf.ok && truthy(rb(conf).ran)
              ? await ctx.tool("wb_menu", {
                  action: "run",
                  module: c.module,
                  path: c.path,
                  confirm: true,
                })
              : null;
          per[c.path] = {
            describe: answerOf(d),
            first: dry ? "dry run" : answerOf(first),
            confirm: answerOf(conf),
            back: answerOf(back),
          };
          if (conf.ok && truthy(rb(conf).ran)) ran.push(c.path);
          if (
            S(conf.code) === "MODAL_HAZARD" ||
            (back && !back.ok && !DOMAIN_CODES.has(S(back.code)))
          )
            bad.push(c.path);
          if (!conf.ok && !DOMAIN_CODES.has(S(conf.code))) fails.push(`${c.path}: ${why(conf)}`);
          if (back && !back.ok) fails.push(`${c.path}: the run back failed (${why(back)})`);
        }
        const dlg = await ctx.tool("wb_menu", {
          action: "run",
          ...MENU_DIALOG_ITEM,
          confirm: true,
        });
        const risk = await ctx.tool("wb_menu", { action: "run", ...MENU_RISK_ITEM, confirm: true });
        per[MENU_DIALOG_ITEM.path] = answerOf(dlg);
        per[MENU_RISK_ITEM.path] = answerOf(risk);
        // DEC-107: the dialog opener left the compiled allow-list, so either refusal is the proof.
        if (S(dlg.code) !== "MODAL_HAZARD" && S(dlg.code) !== "NOT_ALLOWLISTED")
          fails.push(`File,Options... answered ${answerOf(dlg)}, not MODAL_HAZARD or NOT_ALLOWLISTED`);
        if (S(risk.code) !== "NOT_ALLOWLISTED")
          fails.push(`File,Exit answered ${answerOf(risk)}, not NOT_ALLOWLISTED`);
        evidence.runs = per;
        const observed: Raw = { runs: per, ran, switch: SWITCHES.menu };
        const probe = bad.length
          ? killed(
              "P-W8-22",
              observed,
              `${bad.join(", ")} opened a dialog or blocked: off the allow-list`,
            )
          : cands.length && ran.length === cands.length
            ? settled("P-W8-22", observed, `${ran.length} item(s) ran and ran back`)
            : partial(
                "P-W8-22",
                observed,
                `ran ${ran.length} of ${cands.length} proven pick(s); the path table grows only from items that ran`,
              );
        return { ...verdictOf(fails, [probe], "P-W8-22 answered"), evidence, probes: [probe] };
      },
    }),

    // ── W8.6 dialogs (P-W8-03 first) ──
    liveStep({
      id: "w8-60-p03-dialog",
      block: "W8.6",
      title:
        "P-W8-03: World Editor File > Open... by row id, the modal read, a ping while it is open, Cancel",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "modals lists the dialog; the ping answers; Cancel closes it; no file opened (the world path unchanged)",
      kill_criterion:
        "the ping blocks (DEC-042 U6) or Cancel is not found: KILLED; dialog rows stay T3 and the open refuses MODAL_HAZARD",
      side_effects: ["the File Open dialog opens and is cancelled"],
      rollback: "Cancel",
      probes: ["P-W8-03"],
      dependsOn: ["P-W8-02"],
      dialog: true,
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        ...dialogPlan(String(ROWS.fileOpen)),
        {
          kind: "net-call",
          target: "EMCP_WB_Ping",
          note: "while the dialog is open",
        } as PlanAction,
        tc("wb_world", "state"),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const row = pickRows(ctx.deps.locators(), ROWS.fileOpen, 1)[0];
        const st0 = await ctx.tool("wb_world", { action: "state" });
        if (!row) {
          const p = partial(
            "P-W8-03",
            {},
            "no 1.9 locator for File > Open: run the carry after W8.3",
          );
          return { ...verdictOf([], [p], ""), evidence: {}, probes: [p] };
        }
        const d = await dialogRound(ctx, row.rowId, { ping: true });
        const st1 = await ctx.tool("wb_world", { action: "state" });
        const same = S(rb(st0).worldPath) === S(rb(st1).worldPath);
        if (!same) fails.push("the world path changed: a file was opened");
        const observed: Raw = { ...d.evidence, sameWorld: same };
        const probe = d.waiting
          ? partial("P-W8-03", observed, `the invoke answered ${d.waiting}: ${SWITCHES.gui}`)
          : !d.opened
            ? partial("P-W8-03", observed, "no dialog appeared in the modal list")
            : d.pinged === false || !d.dismissed
              ? killed(
                  "P-W8-03",
                  observed,
                  d.pinged === false
                    ? "the ping blocked while the dialog was open"
                    : "Cancel did not close the dialog",
                )
              : settled(
                  "P-W8-03",
                  observed,
                  `"${d.title}" read, the ping answered, Cancel closed it`,
                );
        return {
          ...verdictOf(fails, [probe], "P-W8-03 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),
    liveStep({
      id: "w8-61-p14-plugin-dialogs",
      block: "W8.6",
      title: `P-W8-14: ${P14_DIALOGS} plugin menu items that open a dialog, each read and cancelled`,
      risk: "reversible",
      timeout_ms: 600_000,
      expected: "each dialog reads and closes on Cancel; Run or OK is never pressed",
      kill_criterion:
        "a dialog has no Cancel or Close: that plugin stays T3 (KILLED for it; the hand closes it)",
      side_effects: ["plugin dialogs open and are cancelled"],
      rollback: "Cancel",
      probes: ["P-W8-14"],
      dependsOn: ["P-W8-02", "P-W8-03"],
      dialog: true,
      writes: [],
      plan: () => dialogPlan(String(ROWS.pluginDialogs)),
      run: async (ctx) => {
        const rows = pickRows(ctx.deps.locators(), ROWS.pluginDialogs, P14_DIALOGS);
        const per: Raw = {};
        const stuck: string[] = [];
        let read = 0;
        for (const r of rows) {
          const d = await dialogRound(ctx, r.rowId);
          per[r.rowId] = d.evidence;
          if (d.opened && d.dismissed) read++;
          if (d.opened && !d.dismissed) {
            stuck.push(r.rowId);
            break;
          }
        }
        const observed: Raw = { rows: rows.map((r) => r.rowId), read };
        const probe = stuck.length
          ? killed("P-W8-14", observed, `${stuck.join(", ")} did not close on Cancel`)
          : rows.length && read === rows.length
            ? settled("P-W8-14", observed, `${read} plugin dialog(s) read and cancelled`)
            : partial(
                "P-W8-14",
                observed,
                rows.length
                  ? `${read} of ${rows.length} read (the rest answered a gate: ${SWITCHES.gui})`
                  : "no 1.9 locator for a plugin dialog item",
              );
        return { ...verdictOf([], [probe], "P-W8-14 answered"), evidence: per, probes: [probe] };
      },
    }),
    liveStep({
      id: "w8-62-p05-options",
      block: "W8.6",
      title:
        "P-W8-05: wb_settings options (GATED until the probe), File > Options... opened by row id, its fields read, Cancel (never OK)",
      risk: "reversible",
      timeout_ms: 180_000,
      expected:
        "options answers GATED; the dialog reads its fields; Cancel closes it; the field-to-key map needs the changed-field ini (runbook) for each page",
      kill_criterion: "a field does not follow the ini: that field is T3 by UIA read only",
      side_effects: ["the Options dialog opens and is cancelled"],
      rollback: "Cancel",
      probes: ["P-W8-05"],
      dependsOn: ["P-W8-02", "P-W8-03"],
      dialog: true,
      writes: [],
      plan: () => [
        tc("wb_settings", "options", { page: "General" }),
        ...dialogPlan(String(ROWS.options)),
      ],
      run: async (ctx) => {
        const o = await ctx.tool("wb_settings", { action: "options", page: "General" });
        const fails = okOrWaiting(o) ? [] : [`options: ${why(o)}`];
        const row = pickRows(ctx.deps.locators(), ROWS.options, 1)[0];
        const d = row ? await dialogRound(ctx, row.rowId) : null;
        const observed: Raw = {
          options: answerOf(o),
          switch: SWITCHES.options,
          dialog: d?.evidence ?? null,
        };
        const probe =
          d && d.opened && !d.dismissed
            ? killed("P-W8-05", observed, "Options did not close on Cancel")
            : partial(
                "P-W8-05",
                observed,
                d?.opened
                  ? "fields read and cancelled; the field-to-key map waits for a launch on an ini with one changed field per page (W8.md)"
                  : "the dialog was not opened (no locator or a gate)",
              );
        return {
          ...verdictOf(fails, [probe], "P-W8-05 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),
    liveStep({
      id: "w8-63-p20-qt-introspection",
      block: "W8.6",
      title:
        "P-W8-20: the Qt Introspection Tool opened by row id, its window read, closed with Close",
      risk: "reversible",
      timeout_ms: 180_000,
      expected: "the tool window reads through UIA; Close closes it",
      kill_criterion:
        "it opens nothing, or a modal without Cancel or Close: the row is documented-only (KILLED)",
      side_effects: ["the Qt Introspection Tool window opens and is closed"],
      rollback: "Close",
      probes: ["P-W8-20"],
      dependsOn: ["P-W8-02", "P-W8-03"],
      dialog: true,
      writes: [],
      plan: () => dialogPlan(String(ROWS.qtIntrospection), "Close"),
      run: async (ctx) => {
        const row = pickRows(ctx.deps.locators(), ROWS.qtIntrospection, 1)[0];
        if (!row) {
          const p = partial("P-W8-20", {}, "no 1.9 locator for the Qt Introspection Tool item");
          return { ...verdictOf([], [p], ""), evidence: {}, probes: [p] };
        }
        const d = await dialogRound(ctx, row.rowId, { button: "Close" });
        const probe = d.waiting
          ? partial("P-W8-20", d.evidence, `the invoke answered ${d.waiting}`)
          : !d.opened
            ? killed("P-W8-20", d.evidence, "it opened nothing in the modal list")
            : d.dismissed
              ? settled("P-W8-20", d.evidence, `"${d.title}" read and closed`)
              : killed("P-W8-20", d.evidence, "no Close or Cancel closed it");
        return {
          ...verdictOf([], [probe], "P-W8-20 answered"),
          evidence: d.evidence,
          probes: [probe],
        };
      },
    }),

    // ── W8.7 tool panels (P-W8-12) ──
    liveStep({
      id: "w8-70-p12-tool-panels",
      block: "W8.7",
      title: `P-W8-12: up to ${P12_TOOLS} World Editor tool buttons on the throwaway world, each panel read, back to the select tool`,
      risk: "reversible",
      timeout_ms: 600_000,
      expected:
        "each panel shows its controls in the tree (wb_gui find currentToolPanel); no modal; the select tool is active again",
      kill_criterion:
        "a panel is drawn in the render window: its rows go to pixel recipes (KILLED for that tool)",
      side_effects: ["the active World Editor tool changes and is set back to Select"],
      rollback: "the select tool button",
      probes: ["P-W8-12"],
      dependsOn: ["P-W8-02"],
      writes: [],
      plan: () => [
        ...worldPlan(),
        guiDrive("invoke", String(ROWS.tools), "one tool"),
        tc("wb_gui", "find", { query: "currentToolPanel" }),
        guiDrive("invoke", String(ROWS.selectTool), "back to select"),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        // A resumed run (--from/--only on a fresh launch) ensures the world itself.
        const worldEvidence: Raw = {};
        if (!(await ensureWorld(ctx, worldEvidence, fails)))
          return { ...verdictOf(fails, [], ""), evidence: { world: worldEvidence } };
        const recs = ctx.deps.locators();
        const select = pickRows(recs, ROWS.selectTool, 1)[0];
        const tools = pickRows(recs, ROWS.tools, P12_TOOLS + 1)
          .filter((r) => r.rowId !== select?.rowId)
          .slice(0, P12_TOOLS);
        const per: Raw = {};
        const drawn: string[] = [];
        let read = 0;
        for (const t of tools) {
          const a = await drive(ctx, "invoke", t.rowId);
          const f = a.ok
            ? await ctx.tool("wb_gui", {
                action: "find",
                query: "currentToolPanel",
                pid: ctx.deps.recordedPid() ?? undefined,
              })
            : null;
          const count = f
            ? Number(
                rb(f).total ??
                  (Array.isArray(rb(f).matches) ? (rb(f).matches as unknown[]).length : 0),
              )
            : 0;
          const back = select && a.ok ? await drive(ctx, "invoke", select.rowId) : null;
          per[t.rowId] = { invoke: answerOf(a), panel: count, back: answerOf(back) };
          if (a.ok && count > 0) read++;
          if (a.ok && count === 0) drawn.push(t.rowId);
          if (!okOrWaiting(a)) fails.push(`${t.rowId}: ${why(a)}`);
        }
        const observed: Raw = { tools: per };
        const probe = drawn.length
          ? killed("P-W8-12", observed, `${drawn.length} panel(s) not in the tree: pixel recipes`)
          : tools.length && read === tools.length
            ? settled("P-W8-12", observed, `${read} tool panel(s) read`)
            : partial(
                "P-W8-12",
                observed,
                tools.length
                  ? `${read} of ${tools.length}; the rest answered a gate`
                  : "no 1.9 locator for a tool button",
              );
        return {
          ...verdictOf(fails, [probe], "P-W8-12 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),

    // ── W8.8 viewers (P-W8-16) ──
    liveStep({
      id: "w8-75-p16-viewers",
      block: "W8.8",
      title:
        "P-W8-16: one vanilla resource per sub-editor, a viewer toggle flipped and back, File > Close on the clean document",
      risk: "reversible",
      timeout_ms: 1_200_000,
      expected: "each toggle flips and restores; Close closes with no prompt",
      kill_criterion:
        "Close prompts: the close row refuses MODAL_HAZARD unless the document is proven clean (KILLED for that viewer; the hand answers the prompt No / Don't Save)",
      side_effects: ["vanilla resources opened read-only in their sub-editors and closed"],
      rollback: "the toggle a second time; File > Close on the unmodified document",
      probes: ["P-W8-16"],
      dependsOn: ["P-W8-02"],
      writes: [],
      plan: () =>
        Object.entries(VIEWER_EXTENSIONS)
          .filter(([m]) => LAUNCH1_SUB_EDITORS.includes(m))
          .flatMap(([m, ext]) => [
            tc("wb_resources", "search", { extensions: [ext], recursive: true, limit: 20 }),
            tc("wb_module", "setResource", { module: "ResourceManager", target: "path:<the hit>" }),
            guiDrive("toggle", `ui:${m}/toolbar-button/<first>`, "flip"),
            guiDrive("toggle", `ui:${m}/toolbar-button/<first>`, "flip back"),
            guiDrive("invoke", `ui:${m}/menu-item/File/Close`, "on the unmodified document only"),
          ]),
      run: async (ctx) => {
        const recs = ctx.deps.locators();
        const per: Raw = {};
        const fails: string[] = [];
        let flipped = 0;
        let closed = 0;
        let tried = 0;
        const vc: ViewerCalls = {
          tool: (n, a) => ctx.tool(n, a),
          sleep: (ms) => ctx.sleep(ms),
          pid: () => ctx.deps.recordedPid(),
        };
        for (const m of Object.keys(VIEWER_EXTENSIONS)) {
          // The exit-crash cap (w8-exit-crash.md): only the sub-editors w8-30 opened this launch.
          if (!LAUNCH1_SUB_EDITORS.includes(m)) {
            per[m] = "not opened: the sub-editor cap (w8-exit-crash.md)";
            continue;
          }
          const esc = m.replace(/\./g, "\\.");
          const toggle = pickRows(recs, new RegExp(`^ui:${esc}/toolbar-button/`), 1)[0];
          const close = viewerCloseRow(recs, m);
          if (!toggle && !close) {
            per[m] = "no 1.9 locator";
            continue;
          }
          tried++;
          const opened = await openViewerResource(vc, m);
          const name = opened.resource;
          const set = opened.set;
          if (!set) {
            per[m] = { search: answerOf(opened.search), hit: null };
            continue;
          }
          const out: Raw = { resource: name, open: answerOf(set) };
          if (toggle && set.ok) {
            const a = await drive(ctx, "toggle", toggle.rowId);
            const b = a.ok ? await drive(ctx, "toggle", toggle.rowId) : null;
            out.toggle = answerOf(a);
            out.back = answerOf(b);
            if (a.ok && b?.ok) flipped++;
            if (!okOrWaiting(a)) fails.push(`${m} toggle: ${why(a)}`);
          }
          if (close && set.ok) {
            const { close: c, prompt } = await closeViewerDocument(vc, close.rowId);
            out.close = answerOf(c);
            out.prompt = prompt;
            if (c.ok && prompt.length === 0) closed++;
            if (c.ok && prompt.length)
              throw new StopBattery(
                "handoff",
                `Close on ${m} raised "${prompt[0]}": answer No / Don't Save`,
              );
          }
          per[m] = out;
        }
        const observed: Raw = { viewers: per };
        const probe =
          tried === 0
            ? partial("P-W8-16", observed, "no 1.9 locator in any sub-editor")
            : partial(
                "P-W8-16",
                observed,
                `${flipped} toggle(s) flipped and back, ${closed} clean close(s) of ${tried}; the pixel rows ride the hand block (w8-97)`,
              );
        return {
          ...verdictOf(fails, [probe], "P-W8-16 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),

    // ── W8.9 diag ──
    liveStep({
      id: "w8-80-p07-diag-edit",
      block: "W8.9",
      title: "P-W8-07 (edit half): wb_diag get on every SCR_DebugMenuID name in edit mode",
      risk: "read-only",
      timeout_ms: 180_000,
      expected:
        "get answers values for the registered names and lists the rest as missing; gameMode false",
      kill_criterion: "get blocks or crashes: wb_diag refuses UNPROVEN in edit mode (KILLED)",
      side_effects: [],
      rollback: "none (reads)",
      probes: ["P-W8-07"],
      dependsOn: ["P-W8-24"],
      writes: [],
      plan: () => [tc("wb_diag", "get", { names: ["<every SCR_DebugMenuID name>"] })],
      run: async (ctx) => {
        const names = ctx.deps.diagNames();
        if (!names) {
          const p = partial(
            "P-W8-07",
            {},
            "the diag catalog is absent (scripts/census/gen-diag-catalog.ts)",
          );
          return { ...verdictOf([], [p], ""), evidence: {}, probes: [p] };
        }
        const g = await ctx.tool("wb_diag", { action: "get", names: names.script });
        const values = diagValues(g);
        const observed: Raw = {
          asked: names.script.length,
          answered: values.size,
          missing: strs(rb(g).missing).length,
          gameMode: rb(g).gameMode ?? null,
          code: g.code ?? null,
        };
        ctx.state.set("diagEdit", Object.fromEntries(values));
        const probe =
          !g.ok && !DOMAIN_CODES.has(S(g.code))
            ? killed("P-W8-07", observed, `get in edit mode gave no answer (${S(g.code)})`)
            : !g.ok
              ? partial("P-W8-07", observed, `get refused ${S(g.code)}`)
              : partial(
                  "P-W8-07",
                  observed,
                  `edit mode: ${values.size} value(s); the play half is w8-82`,
                );
        return {
          ...verdictOf([], [probe], "edit-mode get answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),
    liveStep({
      id: "w8-81-p08-diag-engine",
      block: "W8.9",
      title:
        "P-W8-08: wb_diag get with kinds engine and engineRange on the seven EDiagMenu names; the catalog's script menus",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "the engine ids answer a value; the L15 walk (runbook, scripts/census/live/L15-diag.ts) agrees with the catalog's menus",
      kill_criterion:
        "L15 returns empty again: the native options stay documented (OD-10); engine kinds refuse UNPROVEN until the probe",
      side_effects: [],
      rollback: "none (reads)",
      probes: ["P-W8-08"],
      dependsOn: ["P-W8-24"],
      writes: [],
      plan: () => [
        tc("wb_diag", "get", { names: ["<the seven EDiagMenu names>"], kinds: ["engine"] }),
        tc("wb_diag", "get", { names: ["<the seven EDiagMenu names>"], kinds: ["engineRange"] }),
      ],
      run: async (ctx) => {
        const names = ctx.deps.diagNames();
        if (!names) {
          const p = partial("P-W8-08", {}, "the diag catalog is absent");
          return { ...verdictOf([], [p], ""), evidence: {}, probes: [p] };
        }
        const e = await ctx.tool("wb_diag", {
          action: "get",
          names: names.engine,
          kinds: names.engine.map(() => "engine"),
        });
        const r = await ctx.tool("wb_diag", {
          action: "get",
          names: names.engine,
          kinds: names.engine.map(() => "engineRange"),
        });
        const observed: Raw = {
          engine: answerOf(e),
          engineValues: diagValues(e).size,
          engineRange: answerOf(r),
          rangeValues: diagValues(r).size,
          menus: names.menus.length,
        };
        const fails = [e, r]
          .filter((x) => !x.ok && !DOMAIN_CODES.has(S(x.code)))
          .map((x) => why(x));
        const probe = partial(
          "P-W8-08",
          observed,
          e.ok
            ? `${diagValues(e).size} engine value(s); the L15 walk is the runbook's (W8.md)`
            : `engine kinds answered ${S(e.code)} (UNPROVEN until P-W8-08)`,
        );
        return {
          ...verdictOf(fails, [probe], "P-W8-08 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),
    liveStep({
      id: "w8-82-p07-diag-play",
      block: "W8.9",
      title:
        "P-W8-07 (play half): wb_play; get every name; set with restore on up to ten allow-listed bool ids; select one menu; wb_stop",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open * 2,
      expected:
        "get answers in play; each set reads back and is restored to its previous value before the stop; select answers and the game view is captured right after it (the World Editor fronted, then its window rectangle only; the render-viewport region judged in the hand block); back in edit mode",
      kill_criterion:
        "get blocks or crashes in play: wb_diag refuses UNPROVEN in play mode (KILLED)",
      side_effects: [
        "play mode entered and left; allow-listed diag values set and restored (memory only)",
        "the World Editor fronted (wb_module front)",
        `a World Editor window screenshot in <artifacts>/gui/ and <sitting>/${SELECT_SHOT_FILE}`,
      ],
      rollback: "every set restored to its previous value; wb_stop (also by the stop cleanup)",
      probes: ["P-W8-07"],
      dependsOn: ["P-W8-24"],
      writes: [],
      plan: () => [
        ...playPlan(),
        tc("wb_diag", "get", { names: ["<every SCR_DebugMenuID name>"] }),
        tc("wb_diag", "set", {
          name: "<an allow-listed bool id>",
          kind: "bool",
          value: "<flipped>",
        }),
        tc(
          "wb_diag",
          "set",
          { name: "<the same id>", kind: "bool", value: "<previous>" },
          { note: "restore" },
        ),
        tc("wb_diag", "select", { menu: "<one catalog menu>" }),
        tc(
          "wb_module",
          "front",
          { module: "WorldEditor" },
          {
            note: "W8 run 8: the Resource Manager and another application were in front of the shot",
          },
        ),
        tc(
          "wb_gui",
          "screenshot",
          {
            label: "w8-82-diag-select",
            pid: "<recorded pid>",
            windowTitle: MODULE_WINDOWS.WorldEditor,
          },
          {
            note: `followups item 5: the World Editor window only after select, judged in ${SELECT_SHOT_STEP}`,
          },
        ),
        ...stopPlan(),
      ],
      run: async (ctx) => {
        const names = ctx.deps.diagNames();
        const evidence: Raw = {};
        const fails: string[] = [];
        if (!names) {
          const p = partial("P-W8-07", {}, "the diag catalog is absent");
          return { ...verdictOf([], [p], ""), evidence, probes: [p] };
        }
        if (!(await enterPlay(ctx, evidence))) {
          fails.push(playFailText(evidence));
          return { ...verdictOf(fails, [], ""), evidence };
        }
        const g = await ctx.tool("wb_diag", { action: "get", names: names.script });
        const values = diagValues(g);
        evidence.get = {
          ok: g.ok,
          code: g.code ?? null,
          answered: values.size,
          gameMode: rb(g).gameMode ?? null,
        };
        const allow = ctx.deps.setAllowList().slice(0, P07_SET_MAX);
        const sets: Raw = {};
        if (allow.length === 0) {
          const name = names.script[0] ?? "";
          const s = await ctx.tool("wb_diag", { action: "set", name, kind: "bool", value: "1" });
          sets[name] = { refused: answerOf(s) };
          if (s.ok) fails.push(`set of ${name} acted with an empty allow-list`);
        }
        for (const name of allow) {
          const prev = values.get(name) ?? "0";
          const flip = prev === "1" || prev.toLowerCase() === "true" ? "0" : "1";
          const s = await ctx.tool("wb_diag", { action: "set", name, kind: "bool", value: flip });
          const back = s.ok
            ? await ctx.tool("wb_diag", { action: "set", name, kind: "bool", value: prev })
            : null;
          sets[name] = {
            set: answerOf(s),
            readback: rb(s).readback ?? null,
            restore: answerOf(back),
            restored: rb(back).readback ?? null,
          };
          if (s.ok && (!back || !back.ok)) fails.push(`${name}: the restore failed`);
        }
        evidence.sets = sets;
        const menu = names.menus[0];
        if (menu) {
          const sel = await ctx.tool("wb_diag", { action: "select", menu });
          evidence.select = brief(sel);
          if (!okOrWaiting(sel) && !DOMAIN_CODES.has(S(sel.code)))
            fails.push(`select: ${why(sel)}`);
          // Followups item 5: the engine gives no result for a select, so the game view is
          // captured right after it, for the hand block's judgement (SELECT_SHOT_STEP). No key
          // is sent: the Diag Menu shortcut (Win+Alt) is not automatable (P-W8-09 killed).
          if (sel.ok) {
            // W8 run 8: the desktop shot had the Resource Manager and another application in
            // front, so the World Editor is fronted and its window rectangle alone is captured.
            const front = await ctx.tool("wb_module", { action: "front", module: "WorldEditor" });
            const shot = await ctx.tool("wb_gui", {
              action: "screenshot",
              label: "w8-82-diag-select",
              pid: ctx.deps.recordedPid() ?? undefined,
              windowTitle: MODULE_WINDOWS.WorldEditor,
            });
            const record = {
              step: "w8-82-p07-diag-play",
              menu,
              front: brief(front),
              shot: brief(shot),
              file: S(rb(shot).file) || null,
              relativeTo: S(rb(shot).relativeTo) || null,
              region: VIEWPORT_REGION,
              judgeIn: SELECT_SHOT_STEP,
              judged: false,
            };
            evidence.selectShot = record;
            writeJson(join(ctx.opts.sittingDir, SELECT_SHOT_FILE), record, ctx.deps);
          }
        }
        if (!(await leavePlay(ctx, evidence)))
          fails.push("edit mode was not reached after wb_stop");
        const observed: Raw = { get: evidence.get, sets, switch: SWITCHES.diag };
        const probe =
          !g.ok && !DOMAIN_CODES.has(S(g.code))
            ? killed("P-W8-07", observed, `get in play gave no answer (${S(g.code)})`)
            : allow.length
              ? settled(
                  "P-W8-07",
                  observed,
                  `play: ${values.size} value(s); ${allow.length} set(s) restored`,
                )
              : partial(
                  "P-W8-07",
                  observed,
                  `play: ${values.size} value(s); set refused while ${SWITCHES.diag} is empty (the answering ids form its proposal)`,
                );
        return {
          ...verdictOf(fails, [probe], "P-W8-07 play half answered"),
          evidence,
          probes: [probe],
        };
      },
    }),

    // ── W8.10 links (P-W8-11) ──
    liveStep({
      id: "w8-85-p11-link-open",
      block: "W8.10",
      title:
        "P-W8-11: wb_link fromView on the throwaway world, then open (dry run, then confirm) of a world, a resource and a script link; a web link answered, never opened",
      risk: "reversible",
      timeout_ms: 600_000,
      expected:
        "dry runs name the route; confirm answers GATED while LINK_GATES.open is closed, else the camera moves, the resource is selected and the script opens at the line; the web link refuses NOT_ALLOWLISTED",
      kill_criterion:
        "a kind misroutes or opens a dialog: that kind answers parse only (KILLED for it)",
      side_effects: ["the camera, the selection and the Script Editor document may change"],
      rollback: "the fromView link opened again (the camera back); nothing is saved",
      probes: ["P-W8-11"],
      writes: [],
      plan: () => [
        ...worldPlan(),
        tc("wb_link", "fromView"),
        ...OPEN_LINKS.flatMap((l) => [
          tc("wb_link", "open", { link: l }),
          tc("wb_link", "open", { link: l, confirm: true }),
        ]),
        tc(
          "wb_link",
          "open",
          { link: WEB_LINK, confirm: true },
          { target: REFUSED_IN_TS, note: "a web link is never opened" },
        ),
        tc(
          "wb_link",
          "open",
          { link: "<the fromView link>", confirm: true },
          { note: "the camera back" },
        ),
      ],
      run: async (ctx) => {
        const fails: string[] = [];
        const evidence: Raw = {};
        // The throwaway world is the one the links come back to (a resumed run ensures it).
        const world: Raw = {};
        const worldOk = await ensureWorld(ctx, world, fails);
        evidence.world = world;
        if (!worldOk) return { ...verdictOf(fails, [], ""), evidence };
        const v = await ctx.tool("wb_link", { action: "fromView" });
        const home = S(rb(v).link);
        evidence.fromView = brief(v);
        if (!v.ok && !DOMAIN_CODES.has(S(v.code))) fails.push(`fromView: ${why(v)}`);
        const per: Raw = {};
        let dispatched = 0;
        let gated = 0;
        const misrouted: string[] = [];
        for (const link of OPEN_LINKS) {
          const dry = await ctx.tool("wb_link", { action: "open", link });
          const conf = await ctx.tool("wb_link", { action: "open", link, confirm: true });
          per[link] = {
            dry: answerOf(dry),
            route: rb(dry).via ?? rb(dry).route ?? null,
            confirm: answerOf(conf),
          };
          if (conf.ok) dispatched++;
          else if (WAIT_CODES.has(S(conf.code))) gated++;
          else if (!DOMAIN_CODES.has(S(conf.code))) misrouted.push(link);
          if (!dry.ok && !DOMAIN_CODES.has(S(dry.code))) fails.push(`dry ${link}: ${why(dry)}`);
        }
        const web = await ctx.tool("wb_link", { action: "open", link: WEB_LINK, confirm: true });
        per[WEB_LINK] = answerOf(web);
        if (web.ok) fails.push("the web link was dispatched");
        if (home && dispatched) {
          const back = await ctx.tool("wb_link", { action: "open", link: home, confirm: true });
          evidence.cameraBack = brief(back);
        }
        evidence.opens = per;
        const observed: Raw = { opens: per, switch: SWITCHES.link };
        const probe = misrouted.length
          ? killed("P-W8-11", observed, `${misrouted.join(", ")} misrouted`)
          : dispatched === OPEN_LINKS.length
            ? settled("P-W8-11", observed, "every kind dispatched through its owning tool")
            : partial(
                "P-W8-11",
                observed,
                `${dispatched} dispatched, ${gated} gated (${SWITCHES.link})`,
              );
        return { ...verdictOf(fails, [probe], "P-W8-11 answered"), evidence, probes: [probe] };
      },
    }),

    // ── W8.11 debugger and peer (P-W8-13, read-only walk; no launch, OI-W8-5) ──
    liveStep({
      id: "w8-86-p13-debugger-peer",
      block: "W8.11",
      title:
        "P-W8-13: the Script Editor debug docks read (wb_gui tree); the Peer Tool dialog opened, read and cancelled; no target launched (OI-W8-5)",
      risk: "reversible",
      timeout_ms: 300_000,
      expected: "the target list and the peer settings read; nothing launched",
      kill_criterion:
        "reading needs a launch: rows stay T3 by census and the launch is OI-W8-5 (KILLED)",
      side_effects: ["the Script Editor opens; the Peer Tool dialog opens and is cancelled"],
      rollback: "Cancel",
      probes: ["P-W8-13"],
      dependsOn: ["P-W8-02", "P-W8-03"],
      dialog: true,
      writes: [],
      plan: () => [
        tc("wb_module", "open", { module: "ScriptEditor" }),
        tc("wb_gui", "tree", {
          className: EDITOR_CLASS,
          windowTitle: MODULE_WINDOWS.ScriptEditor,
          depth: 60,
        }),
        ...dialogPlan(String(ROWS.peerTool)),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const open = await ctx.tool("wb_module", { action: "open", module: "ScriptEditor" });
        const tree = await ctx.tool("wb_gui", {
          action: "tree",
          pid: ctx.deps.recordedPid() ?? undefined,
          className: EDITOR_CLASS,
          windowTitle: MODULE_WINDOWS.ScriptEditor,
          depth: 60,
        });
        evidence.open = answerOf(open);
        evidence.tree = answerOf(tree);
        const docks = pickRows(ctx.deps.locators(), ROWS.debugDocks, 20);
        const reads: Raw = {};
        for (const d of docks) reads[d.rowId] = answerOf(await readRow(ctx, d.rowId));
        evidence.docks = reads;
        const peer = pickRows(ctx.deps.locators(), ROWS.peerTool, 1)[0];
        const d = peer ? await dialogRound(ctx, peer.rowId) : null;
        evidence.peer = d?.evidence ?? "no 1.9 locator for the Peer Tool item";
        const observed: Raw = {
          docks: reads,
          peer: d ? { opened: d.opened, dismissed: d.dismissed } : null,
          launched: false,
        };
        const probe =
          d && d.opened && !d.dismissed
            ? killed("P-W8-13", observed, "the Peer Tool dialog did not close on Cancel")
            : Object.values(reads).some((x) => x === "ok") && d?.dismissed
              ? settled(
                  "P-W8-13",
                  observed,
                  "debug docks and the Peer Tool read with nothing launched",
                )
              : partial(
                  "P-W8-13",
                  observed,
                  "read in part (locators or gates); a launch stays OI-W8-5",
                );
        return { ...verdictOf([], [probe], "P-W8-13 answered"), evidence, probes: [probe] };
      },
    }),

    // ── W8.12 launcher (P-W8-19) ──
    liveStep({
      id: "w8-87-p19-launcher",
      block: "W8.12",
      title:
        "P-W8-19: the launcher window looked for among the Workbench windows (read only; the L14 pass is the runbook's)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "no launcher picker held open (the P-E01-mcp-inventory-L341 hold does not occur); the L14 read pass runs from the runbook with the launcher open",
      kill_criterion: "the picker holds: launcher rows stay subsumed by wb_launch (KILLED)",
      side_effects: [],
      rollback: "none (reads)",
      probes: ["P-W8-19"],
      writes: [],
      plan: () => [],
      offlineCalls: () => [oc("snapshot", "windows")],
      run: async (ctx) => {
        const ws = await ctx.deps.windows();
        const launcher = ws.filter(
          (w) => /launcher/i.test(w.title) || /^Enfusion Workbench$/i.test(w.title),
        );
        const observed: Raw = {
          launcherWindows: launcher.map((w) => ({ title: w.title, enabled: w.enabled })),
        };
        const held = launcher.some((w) => w.enabled === false);
        const probe = held
          ? killed("P-W8-19", observed, "a launcher window is held (disabled)")
          : partial(
              "P-W8-19",
              observed,
              "no picker held after the launch; the L14 read pass is the runbook's",
            );
        return {
          ...verdictOf([], [probe], "P-W8-19 answered"),
          evidence: observed,
          probes: [probe],
        };
      },
    }),

    // ── W8.F launch 1's closable: the fixture entity undone, the world clean (the files stay) ──
    liveStep({
      id: "w8-88-fixture-delete",
      block: "W8.F",
      title: `launch 1's closable: the w8-07 fixture entity undone (Edit > Undo while ${FIXTURE_ENTITY.name} is listed, at most ${FIXTURE_UNDO_MAX}), so the throwaway world holds no unsaved edit and the post-flight close meets no "World editor - closing" prompt; never save. The anim and tree files stay for the hand block`,
      risk: "reversible",
      timeout_ms: 120_000,
      expected: `no entity named ${FIXTURE_ENTITY.name} is left, taken by undo (the create was the world's one edit since w8-06 opened it); evidence.clean true; <sitting>/${PLANT_FILE} marks each record deleted`,
      kill_criterion: `an undo answers false or ${FIXTURE_UNDO_MAX} undos leave the fixture: the fallback wb_entity delete takes it, the world stays dirty and the step FAILs (the close then meets "World editor - closing" and the runbook's hand answers No; cold run 1 crashed on exit after that path, w8-exit-crash.md); the world is never saved`,
      side_effects: [
        `${FIXTURE_ENTITY.name} undone in the open throwaway world (memory only; any later edit on the undo stack is undone first)`,
      ],
      rollback: "none: this is the rollback of w8-07's entity",
      probes: [],
      writes: [],
      plan: () => [
        tc("wb_entity", "list", { name: FIXTURE_ENTITY.name, limit: 10 }),
        tc(
          "wb_undo_redo",
          "undo",
          {},
          {
            note: `Edit > Undo, repeated while the fixture is listed, at most ${FIXTURE_UNDO_MAX}`,
          },
        ),
        undoActionPlan(),
        tc("wb_entity", "list", { name: FIXTURE_ENTITY.name, limit: 10 }),
        tc(
          "wb_entity",
          "delete",
          { entities: ["<each listed fixture ref>"] },
          { note: "only when the undo did not take it (the world then stays dirty: FAIL)" },
        ),
      ],
      run: async (ctx) => undoFixtureToClean(ctx, "w8-88-fixture-delete"),
    }),

    // ── W8.13 net-zero, then the relaunch boundary ──
    liveStep({
      id: NETZERO_STEP,
      block: "W8.13",
      title:
        "net-zero: edit mode, no modal, the snapshot diff outside _throwaway/W8/, the registry hash read (final after the close)",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "mode edit; no modal; no file changed outside _throwaway/W8/ (resourceDatabase.rdb recorded); the registry export equals the prep hash",
      kill_criterion: "a file changed outside _throwaway/W8/ or a modal is left: FAIL",
      side_effects: ["a reg export file in <artifacts>/settings/exports/"],
      rollback: "none (reads)",
      probes: [],
      writes: [],
      boundary:
        "close Workbench (post-flight close), relaunch on the SAME scratch ini (pre-flight pass 2 with the same --force-settings), then run --from w8-90-hand-gate in a new run folder",
      plan: () => [tc("wb_world", "state"), tc("wb_gui", "modals")],
      offlineCalls: () => [oc("snapshot", "diff"), oc("registry", "hash")],
      run: async (ctx) => netZero(ctx, "before the hand block"),
    }),

    // ── W8.H hand block (one sitting, after the relaunch) ──
    liveStep({
      id: HAND_GATE_STEP,
      block: "W8.H",
      title:
        "the hand block's gate after the relaunch: test bed, stamp, the same scratch ini, the throwaway world open",
      risk: "read-only",
      timeout_ms: TIMEOUTS.open + 60_000,
      expected: "as the W8.0 gate, on the new Workbench pid; the throwaway world open",
      kill_criterion: "not the test bed: ABORTED; not on the prep scratch ini: STOPPED",
      side_effects: [],
      rollback: "none (reads, and an open of the throwaway world)",
      probes: [],
      writes: [],
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_Info" } as PlanAction,
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
        ...worldPlan(),
      ],
      run: async (ctx) => {
        const evidence = await testBedGate(ctx);
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        const fails: string[] = [];
        const world: Raw = {};
        await ensureWorld(ctx, world, fails);
        evidence.world = world;
        return { ...verdictOf(fails, [], "hand block gate passed"), evidence };
      },
    }),
    liveStep({
      id: "w8-91-picks",
      block: "W8.H",
      title:
        "OI-W8-6: the owner's ten picks on screen (the P4-8 picks), each resolved by the main session through the census query",
      risk: "read-only",
      timeout_ms: HAND_WAIT_MS + 60_000,
      expected:
        "with the owner present: ten picks recorded; without him: BLOCKED as blocked:OI-W8-6 (DEC-076)",
      kill_criterion: "none: the picks are the owner's",
      side_effects: [],
      rollback: "none",
      probes: [],
      hand: true,
      writes: [],
      plan: () => [],
      run: async (ctx) => {
        if (!ctx.opts.ownerPresent)
          return {
            status: "BLOCKED",
            detail:
              "blocked:OI-W8-6: the ten picks are the owner's own hand (DEC-076); pass --owner-present when he is at the screen",
            evidence: { blockedBy: "OI-W8-6" },
          };
        const a = await awaitHand(
          ctx,
          "w8-91-picks",
          'The owner picks ten things on screen (about five minutes). Answer {"picks": [{"label": "...", "where": "<module and region>"}, ...]}',
        );
        const picks = Array.isArray(a?.picks) ? (a!.picks as Raw[]) : [];
        return {
          status: a ? "PASS" : "NOT-RUN",
          detail: a
            ? `${picks.length} pick(s) recorded; each is resolved through the census query by the main session`
            : "no hand answer",
          evidence: { picks },
        };
      },
    }),
    handStep({
      id: "w8-92-p09-diag-overlay",
      title:
        "P-W8-09: in play, the hand opens the Diag Menu, screenshots it, walks three menus, closes it; the profile folder listed before and after",
      expected:
        "the overlay is captured and the three menus match the catalog; any state file is named",
      kill: "the overlay does not open under computer use: the native diag rows stay documented-only (KILLED)",
      probe: "P-W8-09",
      play: true,
      requests: [
        {
          key: "w8-92-overlay",
          instruction:
            'In the game view (play mode), open the Diag Menu (the engine shortcut), screenshot it, open three menus in turn and screenshot each, then close the Diag Menu. Answer {"captured": true, "menus": ["<menu 1>", "<menu 2>", "<menu 3>"], "screenshots": ["<path>", ...]} or {"captured": false, "why": "..."}',
        },
      ],
      judge: (answers, extra) => {
        const a = answers["w8-92-overlay"];
        const changed = extra.profileChanged as string[];
        const observed: Raw = { answer: a ?? null, profileChanged: changed };
        if (!a) return partial("P-W8-09", observed, "no hand answer");
        return truthy(a.captured)
          ? settled(
              "P-W8-09",
              observed,
              `captured; ${strs(a.menus).length} menu(s); state file(s): ${changed.join(", ") || "none"}`,
            )
          : killed("P-W8-09", observed, `the overlay did not open: ${S(a.why)}`);
      },
    }),
    handStep({
      id: SELECT_SHOT_STEP,
      title: `wb_diag select's effect (followups item 5): the hand judges w8-82's screenshot after the select, in the render-viewport region; no key is sent (Win+Alt is not automatable, P-W8-09 killed)`,
      expected:
        "the judgement names whether the selected diag menu drew in the render viewport; recorded as evidence for the select row, which stays below target until it is read",
      kill: "none: a judgement only (a missing screenshot or answer is PARTIAL)",
      probe: "P-W8-07",
      selectShot: true,
      requests: [
        {
          key: "w8-92-select-shot",
          instruction: `Open the screenshot named by "file" in <sitting>/${SELECT_SHOT_FILE} (under the artifacts folder). In ${VIEWPORT_REGION}, judge whether the diag menu named by "menu" drew. Send no key. Answer {"drawn": true | false, "region": "<x,y,w,h>", "note": "..."}`,
        },
      ],
      judge: (answers, extra) => {
        const a = answers["w8-92-select-shot"];
        const observed: Raw = { answer: a ?? null, selectShot: extra.selectShot ?? null };
        if (extra.skipped) return partial("P-W8-07", observed, S(extra.skipped));
        if (!a) return partial("P-W8-07", observed, "no hand answer");
        return partial(
          "P-W8-07",
          observed,
          `select screenshot judged: the menu ${truthy(a.drawn) ? "drew" : "did not draw"} in the render viewport (evidence for the select row; get and set stay as w8-82 left them)`,
        );
      },
    }),
    handStep({
      id: "w8-93-p10-debug-panel",
      title:
        "P-W8-10: in play, one debug panel enabled through wb_diag set (an allow-listed id), the hand screenshots its region, the set restored",
      expected: "the panel is visible and matches its title",
      kill: "no panel shows: in-play debug panel rows stay documented-only (KILLED)",
      probe: "P-W8-10",
      play: true,
      diagPanel: true,
      requests: [
        {
          key: "w8-93-panel",
          instruction:
            'In the game view, screenshot the debug panel the battery just enabled. Answer {"visible": true, "title": "<panel title>", "screenshot": "<path>"} or {"visible": false}',
        },
      ],
      judge: (answers, extra) => {
        const a = answers["w8-93-panel"];
        const observed: Raw = { answer: a ?? null, set: extra.set ?? null };
        if (extra.skipped) return partial("P-W8-10", observed, S(extra.skipped));
        if (!a) return partial("P-W8-10", observed, "no hand answer");
        return truthy(a.visible)
          ? settled("P-W8-10", observed, `panel "${S(a.title)}" visible`)
          : killed("P-W8-10", observed, "no panel showed");
      },
    }),
    handStep({
      id: "w8-94-p15-context-menus",
      title: `P-W8-15: the fixtures first (${FIXTURE_ENTITY.name} selected, ${ANIM_AW} and ${BT} open; followups item 1), then the hand right-clicks eight surfaces in turn; each open menu read by wb_gui context; the hand presses Escape`,
      expected: `8 of 8 menus read (name, enabled, submenu) and they match the census; Object Properties with ${FIXTURE_ENTITY.name} selected, the Animation graph and the Behavior tree with their fixture open`,
      kill: "a surface opens no UIA menu: its rows go to pixel recipes (KILLED for it)",
      probe: "P-W8-15",
      contextSurfaces: true,
      fixtures: true,
      requests: [],
      judge: (_answers, extra) => {
        const per = extra.context as Raw;
        const read = Object.values(per).filter(
          (x) => (x as Raw).items !== undefined && Number((x as Raw).items) > 0,
        ).length;
        const none = Object.entries(per)
          .filter(([, x]) => (x as Raw).opened === true && Number((x as Raw).items) === 0)
          .map(([k]) => k);
        const observed: Raw = { surfaces: per };
        if (none.length)
          return killed("P-W8-15", observed, `no UIA menu read on: ${none.join(", ")}`);
        return read === CONTEXT_SURFACES.length
          ? settled("P-W8-15", observed, "eight context menus read")
          : partial("P-W8-15", observed, `${read} of ${CONTEXT_SURFACES.length} read`);
      },
    }),
    handStep({
      id: "w8-95-p18-canvas-gestures",
      title: `P-W8-18: the fixtures first (${FIXTURE_ENTITY.name} selected, ${ANIM_AW} open), then the hand makes one gesture on each of three canvases (graph node drag, curve point move, gizmo drag), Ctrl+Z after each; never Save`,
      expected: `one acted and undone gesture per canvas (${GESTURE_CANVASES.join(", ")}); the curve canvas has no fixture (${CURVE_GAP})`,
      kill: "a gesture cannot be undone: stop; the family is documented-only (KILLED)",
      probe: "P-W8-18",
      fixtures: true,
      requests: [
        {
          key: "w8-95-gestures",
          instruction: `On each of the three canvases (graph: drag one node of the EMCP_W8 graph in the Animation Editor; curve: move one curve point; gizmo: drag the selected ${FIXTURE_ENTITY.name} by its gizmo in the World Editor), make one gesture and press Ctrl+Z after it; never Save. Answer {"gestures": [{"canvas": "graph" | "curve" | "gizmo", "acted": true, "undone": true}, ...]}`,
        },
      ],
      judge: (answers, extra) => judgeGestures(answers["w8-95-gestures"] ?? null, extra),
    }),
    handStep({
      id: "w8-96-p17-region-captures",
      title:
        "P-W8-17: the hand captures each opaque region at its recipe anchor (data/recipes/) and drives one mouse tool and a drag in the World Editor, undone; the battery screenshots the desktop",
      expected:
        "each region is found at its recipe anchor; the drag is undone (the entity count unchanged)",
      kill: "a region moves with the layout: its rows are documented-only with the layout note (KILLED for it)",
      probe: "P-W8-17",
      screenshot: true,
      requests: [
        {
          key: "w8-96-regions",
          instruction:
            'For each recipe in data/recipes/, screenshot its region at its anchor; then in the World Editor use one mouse tool and one drag on the throwaway world and press Ctrl+Z after each; never Save. Answer {"regions": [{"recipe": "...", "found": true}, ...], "undone": true}',
        },
      ],
      judge: (answers, extra) => {
        const a = answers["w8-96-regions"];
        const regions = Array.isArray(a?.regions) ? (a!.regions as Raw[]) : [];
        const observed: Raw = {
          regions,
          undone: a?.undone ?? null,
          entityCount: extra.entityCount ?? null,
        };
        if (!a) return partial("P-W8-17", observed, "no hand answer");
        const moved = regions.filter((r) => !truthy(r.found));
        if (moved.length)
          return killed("P-W8-17", observed, `${moved.length} region(s) not at their anchor`);
        return regions.length && truthy(a.undone)
          ? settled("P-W8-17", observed, `${regions.length} region(s) at their anchors`)
          : partial("P-W8-17", observed, "regions or the undo unanswered");
      },
    }),
    handStep({
      id: "w8-97-p16-viewer-shots",
      title:
        "P-W8-16 (pixel rows): the hand screenshots the viewer viewports the census marks as pixel rows",
      expected: "each viewport captured at its recipe anchor",
      kill: "a viewport cannot be captured: its rows stay documented-only",
      probe: "P-W8-16",
      requests: [
        {
          key: "w8-97-viewers",
          instruction:
            'Open each resource sub-editor W8.8 opened (read-only, vanilla), screenshot its viewport, close it with no change (answer any save prompt No / Don\'t Save). Answer {"viewers": [{"editor": "...", "captured": true}, ...]}',
        },
      ],
      judge: (answers) => {
        const a = answers["w8-97-viewers"];
        const v = Array.isArray(a?.viewers) ? (a!.viewers as Raw[]) : [];
        const observed: Raw = { viewers: v };
        if (!a) return partial("P-W8-16", observed, "no hand answer");
        return v.length && v.every((x) => truthy(x.captured))
          ? settled("P-W8-16", observed, `${v.length} viewport(s) captured`)
          : partial(
              "P-W8-16",
              observed,
              `${v.filter((x) => truthy(x.captured)).length} of ${v.length} captured`,
            );
      },
    }),

    liveStep({
      id: RELOAD_NO_STEP,
      block: "W8.H",
      title: `the world left clean before ${CLOSABLE_STEP}: the hand reopens ${WORLD} and answers the save prompt ("${SAVE_PROMPT_TITLE}", "${SAVE_PROMPT_TEXT}") No; nothing is saved`,
      risk: "reversible",
      timeout_ms: HAND_WAIT_MS + TIMEOUTS.open,
      expected: `${WORLD} open again with no unsaved change: the hand block's ${FIXTURE_ENTITY.name} gone with the discarded edits; ${CLOSABLE_STEP} then reopens it without a prompt`,
      kill_criterion:
        "the world is not open after the reload, or the fixture is still listed: FAIL (never Yes or Save; the owner answers any prompt No)",
      side_effects: [
        "computer use on Arma Reforger Tools (OI-W8-1): the World Editor reopens the world and the save prompt is answered No",
        `the unsaved edits of the world discarded (the hand block's ${FIXTURE_ENTITY.name}); no file is written`,
      ],
      rollback: "none needed: No discards the in-memory edits and writes nothing",
      probes: [],
      hand: true,
      writes: [],
      plan: () => [
        tc("wb_world", "state", {}, { note: "the world before the hand's reload" }),
        tc("wb_world", "state", {}, { note: "the world after the hand's reload" }),
        tc(
          "wb_entity",
          "list",
          { name: FIXTURE_ENTITY.name, limit: 10 },
          { note: "the fixture is gone" },
        ),
      ],
      run: async (ctx) => reloadWithNo(ctx),
    }),

    // ── W8.X leave Workbench closable ──
    liveStep({
      id: CLOSABLE_STEP,
      block: "W8.X",
      title:
        "leave Workbench closable: play stopped, no modal, the throwaway world freshly opened (else vanilla EmptyArland); never save",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected: `edit mode; no modal; a freshly opened world (clean after ${RELOAD_NO_STEP}, so the reopen raises no save prompt); the post-flight close exits without a prompt`,
      kill_criterion:
        "the world does not open: FAIL (the runbook's hand answers any save prompt No / Don't Save)",
      side_effects: [
        `the hand block's ${FIXTURE_ENTITY.name} deleted (memory only)`,
        "the World Editor opens another world; nothing is saved",
      ],
      rollback: `the fixture entity: wb_entity delete (its plant-w8.json record marked deleted); nothing else is edited`,
      probes: [],
      writes: [],
      plan: () => [
        tc("wb_world", "state"),
        ...stopPlan(),
        ...fixtureDeletePlan(),
        ...openPlan(WORLD),
      ],
      run: async (ctx) => leaveClosable(ctx),
    }),
  ];
}

// ── W8.Z: the post-check after the post-flight closed Workbench ──

function postSteps(): StepDef[] {
  return [
    {
      id: POSTCHECK_STEP,
      block: "W8.Z",
      phase: "post",
      title:
        "post-check with Workbench closed: the registry export hash equals the prep hash; the snapshot diff is clean outside _throwaway/W8/",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "no Workbench process; the export hash equals the prep hash; no file changed outside _throwaway/W8/ (resourceDatabase.rdb recorded)",
      kill_criterion:
        "the hash moved or a file changed: FAIL (the registry or the project was touched)",
      side_effects: ["a reg export file in <artifacts>/settings/exports/"],
      rollback: "none (reads)",
      probes: [],
      writes: [],
      plan: () => [],
      offlineCalls: () => [oc("registry", "hash"), oc("snapshot", "diff")],
      run: async (ctx) => {
        const fails: string[] = [];
        const evidence: Raw = {};
        const prep = prepRecord(ctx.opts, ctx.deps);
        const reg = await ctx.deps.registryExport();
        evidence.registry = {
          prep: prep?.registrySha256 ?? null,
          now: reg.ok ? reg.sha256 : reg.error,
        };
        if (!prep) fails.push(`no ${PREP_FILE}`);
        else if (!reg.ok) fails.push(`registry export: ${S(reg.error)}`);
        else if (reg.sha256 !== prep.registrySha256)
          fails.push("the registry export hash moved since the prep");
        const diff = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
        evidence.diff = diff;
        if (!diff) fails.push(`no ${BATTERY_SNAPSHOT_FILE}`);
        else if (diff.changed.length)
          fails.push(`changed outside ${W8_ROOT}/: ${diff.changed.join(", ")}`);
        return { ...verdictOf(fails, [], "registry unchanged; snapshot diff clean"), evidence };
      },
    },
  ];
}

// ── Link fixtures ────────────────────────────────────────────────────────────

/** The builds of W8.1 (one per kind; the web-prefixed form of the first). */
export const LINK_BUILDS: ReadonlyArray<Raw> = [
  {
    kind: "world",
    world: "~ArmaReforger:worlds/Arland/EmptyArland.ent",
    pos: [100, 20, 100],
    angles: [0, 90, 0],
  },
  { kind: "resource", addon: "ArmaReforger", path: "Configs/Hints/GeneralHints.conf" },
  { kind: "script", addon: "ArmaReforger", path: "scripts/Game/Utilities/DebugMenuID.c", line: 10 },
  { kind: "editor", module: "ScriptEditor" },
];
/**
 * The links W8.10 opens: a vanilla resource and a vanilla script (the world link is fromView's).
 * The resource is a `.conf`, which the Resource Manager owns: a `.et` would open in the World
 * Editor as a prefab edit and switch its document away from the throwaway world (W2 fix-up 2:
 * a file only in the module that owns its type). The W2 sittings opened this `.conf` in the
 * Resource Manager with no dialog (W2 run 3).
 */
export const OPEN_LINKS: readonly string[] = [
  "enfusion://ResourceManager/~ArmaReforger:Configs/Hints/GeneralHints.conf",
  "enfusion://ScriptEditor/~ArmaReforger:scripts/Game/Utilities/DebugMenuID.c;10",
];
export const WEB_LINK = "https://reforger.armaplatform.com/";

// ── Shared step bodies ───────────────────────────────────────────────────────

/** The test-bed gate (W8.0 and the hand block's): throws StopBattery on any miss. */
async function testBedGate(ctx: StepContext): Promise<Raw> {
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
  const prep = prepRecord(ctx.opts, ctx.deps);
  if (!prep)
    throw new StopBattery(
      "stopped",
      `no ${PREP_FILE} in the sitting: run \`w8.live.ts prep\` first`,
      evidence,
    );
  // The planted folders: every file the battery creates goes under them (nothing is opened or
  // written elsewhere). Absent: STOP before anything is sent (run `w8.live.ts plant`).
  const missing = PLANT_DIRS.filter((d) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, d)));
  evidence.planted = missing.length === 0;
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `the planted folder(s) ${missing.map((d) => `<sandbox>/${d}/`).join(", ")} are absent: run \`w8.live.ts plant\` first`,
      evidence,
    );
  const pid = ctx.deps.recordedPid();
  const cmd = pid === null ? null : await ctx.deps.commandLine(pid);
  evidence.forceSettings = cmd === null ? "unread" : carriesForceSettings(cmd, prep.forceSettings);
  if (cmd === null || !carriesForceSettings(cmd, prep.forceSettings))
    throw new StopBattery(
      "stopped",
      "the Workbench process does not carry -forceSettings with the prep scratch ini: the registry would take its settings at exit",
      evidence,
    );
  return evidence;
}

async function netZero(ctx: StepContext, when: string): Promise<StepOutcome> {
  const fails: string[] = [];
  const evidence: Raw = { when };
  const st = await ctx.tool("wb_world", { action: "state" });
  evidence.mode = rb(st).mode ?? null;
  if (st.ok && S(rb(st).mode) && S(rb(st).mode) !== "edit")
    fails.push(`mode ${S(rb(st).mode)}, not edit`);
  const m = await modals(ctx);
  evidence.modals = modalTitles(m);
  if (modalTitles(m).length) fails.push(`a modal is left: ${modalTitles(m).join(", ")}`);
  const diff = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
  evidence.diff = diff;
  if (!diff) fails.push(`no ${BATTERY_SNAPSHOT_FILE}`);
  else if (diff.changed.length)
    fails.push(`changed outside ${W8_ROOT}/: ${diff.changed.join(", ")}`);
  const prep = prepRecord(ctx.opts, ctx.deps);
  const reg = await ctx.deps.registryExport();
  evidence.registry = {
    prep: prep?.registrySha256 ?? null,
    now: reg.ok ? reg.sha256 : reg.error,
    note: "final check after the close: postcheck",
  };
  return { ...verdictOf(fails, [], `net-zero ${when}`), evidence };
}

/** The HAND REQUEST of RELOAD_NO_STEP: names the prompt's title, its text and the No button. */
export const RELOAD_NO_KEY = "w8-97-reload-no";
export const RELOAD_NO_INSTRUCTION =
  `In the World Editor, reopen the open world ${WORLD} (File menu: open it again, or pick it from the recent worlds). ` +
  `The engine raises its save prompt: window "${SAVE_PROMPT_TITLE}", text "${SAVE_PROMPT_TEXT}", buttons Yes / No / Cancel. ` +
  `Press No (never Yes, never Cancel, never Save): No discards the hand block's unsaved edits and writes no file. ` +
  `Wait until the world has loaded. Answer {"prompt": true | false, "pressed": "No", "reloaded": true} or {"reloaded": false, "why": "..."}`;

/**
 * RELOAD_NO_STEP: the hand reopens the throwaway world and answers the save prompt No, so the
 * world holds no unsaved edit when CLOSABLE_STEP reopens it (W8 run 8: w8-98 ended HANDOFF on
 * "Loading world"). The battery then reads the world and the fixture list; the plant record marks
 * the fixture deleted (the discarded edits took it).
 */
export async function reloadWithNo(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" }, { tolerate: true });
  evidence.stateBefore = brief(st0);
  const open0 = S(rb(st0).worldPath);
  if (!st0.ok || !open0.toLowerCase().endsWith(WORLD.toLowerCase()))
    return {
      status: "PASS",
      detail: `the throwaway world is not open ('${open0}'): nothing to reload`,
      evidence,
    };
  const a = await awaitHand(ctx, RELOAD_NO_KEY, RELOAD_NO_INSTRUCTION);
  evidence.answer = a;
  if (!a) fails.push("no hand answer");
  else if (!truthy(a.reloaded)) fails.push(`the hand did not reload: ${S(a.why) || "no reason"}`);
  else if (truthy(a.prompt) && S(a.pressed) !== "No")
    fails.push(`the save prompt was answered '${S(a.pressed)}', not No`);
  const st1 = await ctx.tool("wb_world", { action: "state" }, { tolerate: true });
  evidence.stateAfter = brief(st1);
  if (!S(rb(st1).worldPath).toLowerCase().endsWith(WORLD.toLowerCase()))
    fails.push(`${WORLD} is not open after the reload ('${S(rb(st1).worldPath)}')`);
  const l = await ctx.tool("wb_entity", { action: "list", name: FIXTURE_ENTITY.name, limit: 10 });
  const left = l.ok ? fixtureRows(l).length : null;
  evidence.fixtureList = { answer: answerOf(l), found: left };
  if (left === null) fails.push(`the fixture list failed: ${why(l)}`);
  else if (left > 0)
    fails.push(`${left} ${FIXTURE_ENTITY.name} still listed: the edits were not discarded`);
  else if (ctx.deps.exists(plantPath(ctx.opts))) {
    const rec = readPlant(ctx.opts, ctx.deps);
    let marked = 0;
    for (const e of rec.entities)
      if (!e.deleted) {
        e.deleted = true;
        e.deletedBy = RELOAD_NO_STEP;
        marked++;
      }
    if (marked) writeJson(plantPath(ctx.opts), rec, ctx.deps);
    evidence.plantMarked = marked;
  }
  return {
    ...verdictOf(fails, [], `${WORLD} reopened with the save prompt answered No: no unsaved edit`),
    evidence,
  };
}

export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" }, { tolerate: true });
  evidence.stateBefore = brief(st0);
  if (S(rb(st0).mode) === "play") {
    const s = await ctx.tool("wb_stop", {}, { tolerate: true });
    evidence.stop = brief(s);
    await waitMode(ctx, "edit");
  }
  const open = S(rb(st0).worldPath);
  if (!st0.ok || open === "")
    return { status: "PASS", detail: "no world is open: nothing to leave", evidence };
  // Followups item 1: the fixture entity of the hand block is deleted before the reopen.
  if (open.toLowerCase().endsWith(WORLD.toLowerCase()) && ctx.deps.exists(plantPath(ctx.opts))) {
    const fx: Raw = {};
    if (!(await deleteFixtureEntity(ctx, fx, CLOSABLE_STEP)))
      fails.push(`the fixture delete: ${JSON.stringify(fx.fixtureDelete)}`);
    evidence.fixture = fx;
  }
  const target = ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD)) ? WORLD : VANILLA_WORLD;
  evidence.target = target;
  const o = await openWorld(ctx, target);
  evidence.open = o.evidence;
  if (!o.ok) fails.push(`${target} did not open ('${o.worldPath}')`);
  return { ...verdictOf(fails, [], `closable: ${target} freshly open`), evidence };
}

/** A hand step of W8.H: optional play, optional diag panel set, the requests, the judge. */
function handStep(x: {
  id: string;
  title: string;
  expected: string;
  kill: string;
  probe: string;
  play?: boolean;
  diagPanel?: boolean;
  contextSurfaces?: boolean;
  screenshot?: boolean;
  /** Followups item 1: the fixture entity made (when absent) and selected, the .aw and .bt opened, before the hand acts. */
  fixtures?: boolean;
  /** Followups item 5: the step reads w8-82's screenshot record and the hand judges it. */
  selectShot?: boolean;
  requests: Array<{ key: string; instruction: string }>;
  judge: (answers: Record<string, Raw | null>, extra: Raw) => ProbeResult;
}): StepDef {
  return liveStep({
    id: x.id,
    block: "W8.H",
    title: x.title,
    risk: "reversible",
    timeout_ms:
      HAND_WAIT_MS *
        Math.max(1, x.requests.length + (x.contextSurfaces ? CONTEXT_SURFACES.length * 2 : 0)) +
      TIMEOUTS.open,
    expected: x.expected,
    kill_criterion: x.kill,
    side_effects: [
      "computer use on Arma Reforger Tools (OI-W8-1); every gesture undone, never Save",
      ...(x.play ? ["play mode entered and left"] : []),
    ],
    rollback: x.play ? "wb_stop; every set restored" : "the hand's undo (Ctrl+Z) and Escape",
    probes: [x.probe],
    hand: true,
    // Fix-up 1: the context-menu read (wb_gui context) reads the open popup, never a locator, so a
    // KILLED P-W8-02 does not hold P-W8-15.
    dependsOn: x.diagPanel ? ["P-W8-24"] : undefined,
    writes: [],
    plan: () => [
      ...(x.fixtures
        ? [
            ...fixtureEntityPlan(),
            tc(
              "wb_view",
              "select",
              { mode: "set", entities: ["<the fixture ref>"] },
              { note: "the fixture selected before the hand acts" },
            ),
            ...openFixturePlan(),
          ]
        : []),
      ...(x.play ? playPlan() : []),
      ...(x.diagPanel
        ? [
            tc("wb_diag", "set", {
              name: "<the first diag.set_allow_list id>",
              kind: "bool",
              value: "1",
            }),
            tc(
              "wb_diag",
              "set",
              { name: "<the same id>", kind: "bool", value: "<previous>" },
              { note: "restore" },
            ),
          ]
        : []),
      ...(x.contextSurfaces
        ? [tc("wb_gui", "context", {}, { note: "reads a menu the hand opened; presses nothing" })]
        : []),
      ...(x.screenshot ? [tc("wb_gui", "screenshot", { label: "w8-regions" })] : []),
      ...(x.screenshot
        ? [tc("wb_world", "state", {}, { note: "entity count before and after" })]
        : []),
      ...(x.play ? stopPlan() : []),
    ],
    run: async (ctx) => {
      const evidence: Raw = {};
      const extra: Raw = {};
      const fails: string[] = [];
      const answers: Record<string, Raw | null> = {};
      const listing0 = x.probe === "P-W8-09" ? ctx.deps.profileListing() : [];
      let count0: unknown = null;
      if (x.screenshot)
        count0 = rb(await ctx.tool("wb_world", { action: "state" })).entityCount ?? null;
      if (x.play && !(await enterPlay(ctx, evidence))) {
        fails.push(playFailText(evidence));
        return { ...verdictOf(fails, [], ""), evidence };
      }
      if (x.fixtures) {
        const fx: Raw = {};
        const ref = await ensureFixtureEntity(ctx, fx, x.id);
        if (ref) fx.select = answerOf(await selectFixture(ctx, ref));
        fx.opened = await openFileFixtures(ctx, fx);
        extra.fixtures = fx;
      }
      if (x.selectShot) {
        const shot = readJson<Raw>(join(ctx.opts.sittingDir, SELECT_SHOT_FILE), ctx.deps);
        extra.selectShot = shot;
        if (!shot || !S(shot.file))
          extra.skipped = `no screenshot after wb_diag select in <sitting>/${SELECT_SHOT_FILE} (w8-82 did not take one)`;
      }
      let restore: (() => Promise<ToolResponse>) | null = null;
      if (x.diagPanel) {
        const id = ctx.deps.setAllowList()[0];
        if (!id)
          extra.skipped = `${SWITCHES.diag} is empty: no panel id may be set (P-W8-07 fills it)`;
        else {
          const g = await ctx.tool("wb_diag", { action: "get", names: [id] });
          const prev = diagValues(g).get(id) ?? "0";
          const s = await ctx.tool("wb_diag", {
            action: "set",
            name: id,
            kind: "bool",
            value: "1",
          });
          extra.set = { id, previous: prev, set: answerOf(s) };
          if (s.ok)
            restore = () =>
              ctx.tool("wb_diag", { action: "set", name: id, kind: "bool", value: prev });
          else extra.skipped = `set answered ${answerOf(s)}`;
        }
      }
      if (!extra.skipped)
        for (const r of x.requests) answers[r.key] = await awaitHand(ctx, r.key, r.instruction);
      if (x.contextSurfaces) {
        const per: Raw = {};
        for (const surface of CONTEXT_SURFACES) {
          const key = `${x.id}-${surface.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
          const a = await awaitHand(
            ctx,
            `${key}-open`,
            `Right-click on ${surface} and leave the context menu open. Answer {"opened": true} or {"opened": false, "why": "..."}`,
          );
          const c =
            a && truthy(a.opened)
              ? await ctx.tool("wb_gui", {
                  action: "context",
                  pid: ctx.deps.recordedPid() ?? undefined,
                })
              : null;
          const items =
            c && c.ok ? (Array.isArray(rb(c).items) ? (rb(c).items as unknown[]).length : 0) : 0;
          await awaitHand(
            ctx,
            `${key}-close`,
            'Press Escape to close the context menu (never choose an item). Answer {"closed": true}',
          );
          per[surface] = { opened: a ? truthy(a.opened) : null, context: answerOf(c), items };
        }
        extra.context = per;
      }
      if (x.screenshot) {
        const shot = await ctx.tool("wb_gui", { action: "screenshot", label: "w8-regions" });
        evidence.screenshot = brief(shot);
        const count1 = rb(await ctx.tool("wb_world", { action: "state" })).entityCount ?? null;
        extra.entityCount = { before: count0, after: count1 };
        if (count0 !== null && count1 !== null && count0 !== count1)
          fails.push(
            `the entity count moved ${S(count0)} -> ${S(count1)}: a gesture was not undone`,
          );
      }
      if (restore) {
        const back = await restore();
        evidence.restore = brief(back);
        if (!back.ok) fails.push(`the diag set was not restored: ${why(back)}`);
      }
      if (x.play && !(await leavePlay(ctx, evidence)))
        fails.push("edit mode was not reached after wb_stop");
      if (x.probe === "P-W8-09") {
        const listing1 = ctx.deps.profileListing();
        extra.profileChanged = listing1.filter((f) => !listing0.includes(f));
      }
      const probe = x.judge(answers, extra);
      return {
        ...verdictOf(fails, [probe], `${x.probe} answered`),
        evidence: { ...evidence, ...extra, answers },
        probes: [probe],
      };
    },
  });
}

// ── Plan, outline, queue ─────────────────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: [...LAUNCH_ARGS],
    note: "performed by scripts/live/preflight.ts per the runbook (twice: W8.0 and the hand block's relaunch), on the scratch ini wb_settings profile made",
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
    `${SESSION}: GUI residue, settings, links and Diag Menu battery (${SCRIPT_PATH}), ${steps.length} steps: prep offline, two launches on ${SANDBOX_NAME} (the hand block after a relaunch), post-check offline`,
    ...steps.map(
      (s) =>
        `  [${s.block}] ${s.id} (${s.phase}, ${s.risk}${s.hand ? ", hand" : ""}${s.dialog ? ", dialog" : ""})${s.probes.length ? ` {${s.probes.join(", ")}}` : ""}${s.dependsOn?.length ? ` after ${s.dependsOn.join(", ")}` : ""}: ${s.title}`,
    ),
    `  not testable in this battery: ${Object.keys(NOT_TESTABLE).join(", ") || "none"}`,
    `  not exercised: ${Object.keys(NOT_EXERCISED).join(", ") || "none"}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w8.live.ts --emit-queue` from its step table; tests/live-harness/w8-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block: W8.P runs offline before the first launch (`w8.live.ts prep`), W8.0 to W8.13 in launch 1, W8.H and W8.X in launch 2 (the relaunch on the same scratch ini), W8.Z offline after the post-flight (`w8.live.ts postcheck`). No probe pack: session W8 sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w8-spec.md 1, 2, 3, 6",
      "DEC-058",
      "DEC-076",
      "PLAN 5.3",
      "PLAN 5.4",
      "PLAN 5.7",
    ],
    launches: 2,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "the argv wb_launch forceSettings builds (client.buildWorkbenchArgs); the pre-flight passes it with --force-settings set to the ini `w8.live.ts prep` made with wb_settings profile; -scriptAuthorizeAll is the 2.0 release standard",
    noise: NOISE_REL,
    not_testable: { ...NOT_TESTABLE },
    not_exercised: { ...NOT_EXERCISED },
    probes: steps.map((s) => ({
      id: s.id,
      launch: s.block,
      title: s.title,
      settles: s.probes,
      ...(s.dependsOn?.length ? { after: s.dependsOn } : {}),
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
      ...(s.phase !== "live" ? { offline: s.phase } : {}),
      ...(s.hand ? { hand: true } : {}),
      ...(s.dialog ? { dialog: true } : {}),
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
    return i === -1 ? `${sel.only} is not a step id of this phase` : [steps[i]!];
  }
  const a = sel.from ? idx(sel.from) : 0;
  const b = sel.until ? idx(sel.until) : steps.length - 1;
  if (a === -1) return `${sel.from} is not a step id of this phase`;
  if (b === -1) return `${sel.until} is not a step id of this phase`;
  if (b < a) return "--until comes before --from";
  return steps.slice(a, b + 1);
}

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

/** True when rank a ([run folder index, startedAt]) is newer than b. */
function newerRank(a: [number, string], b: [number, string]): boolean {
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[0] > b[0];
}

/**
 * The probes KILLED in the sitting, keyed by probe id with the skip reason.
 *
 * Fix-up 3 (run 4): only each step's NEWEST verdict on a probe counts. Run 4's first pass KILLED
 * P-W8-02 in w8-30; after the L01 re-walk, `--only w8-30` in a new run folder SETTLED it, yet the
 * `--from w8-31` run still skipped ten steps on the old kill because every KILLED record of every
 * run folder was taken. Now a later verdict of the same step on the same probe supersedes an
 * earlier one, either way (a later KILL blocks again). Newer = the later `startedAt` (ISO time,
 * so a `--run-dir` of any name orders right); the run folder's sorted place breaks a tie. A probe
 * stays killed while any step's newest verdict on it is KILLED.
 */
export function killedProbes(
  runDirs: string[],
  deps: Pick<W8Deps, "exists" | "readBytes">,
  steps: StepDef[],
): Map<string, string> {
  const newest = new Map<string, { rank: [number, string]; result: string; note: string }>();
  runDirs.forEach((dir, d) => {
    for (const s of steps) {
      const r = readJson<StepRecord>(recordPath(dir, s.id), deps);
      if (!r) continue;
      const rank: [number, string] = [d, S(r.startedAt)];
      for (const p of r.probes ?? []) {
        const k = `${p.id}\u0000${s.id}`;
        const prev = newest.get(k);
        if (prev && newerRank(prev.rank, rank)) continue;
        newest.set(k, { rank, result: p.result, note: S(p.note) });
      }
    }
  });
  const out = new Map<string, string>();
  for (const [k, v] of newest) {
    if (v.result !== "KILLED") continue;
    const [id, step] = k.split("\u0000") as [string, string];
    out.set(id, `${id} KILLED in ${step}: ${v.note}`);
  }
  return out;
}

/** Every run folder of the sitting (a kill in an earlier run skips the dependents of a later one). */
function runDirsOf(opts: W8Options, deps: Pick<W8Deps, "listTree">): string[] {
  const runs = new Set(
    deps
      .listTree(opts.sittingDir)
      .filter((f) => f.includes("/"))
      .map((f) => f.split("/")[0]!),
  );
  const dirs = [...runs].sort().map((r) => join(opts.sittingDir, r));
  return dirs.includes(opts.runDir) ? dirs : [...dirs, opts.runDir];
}

async function cleanupAfterStop(ctx: StepContext): Promise<Raw> {
  const out: Raw[] = [];
  for (const r of [...ctx.debt.restorers].reverse()) {
    try {
      const v = (await r.fn()) as ToolResponse | undefined;
      out.push({ label: r.label, ok: v?.ok ?? null, code: v?.code ?? null });
    } catch (e) {
      out.push({ label: r.label, error: e instanceof Error ? e.message : String(e) });
    }
  }
  ctx.debt.restorers = [];
  return { restorers: out };
}

/** The engine's save prompt: W1 run 2 saw it titled "Loading world" (Yes / No / Cancel). */
export const SAVE_PROMPT_TITLES: readonly string[] = [SAVE_PROMPT_TITLE];

/** The hand's answer to a HANDOFF window: No / Don't Save on a save prompt, Cancel on a dialog. */
export function handAnswer(
  message: string,
  stepId: string,
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1]! : "";
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt ? "No" : "Cancel (or Close); never OK, Apply, Save or Run";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `hand: the save prompt "${title}": press No / Don't Save (never Save, never Yes), then resume ${resume}`
    : `hand: window "${title}": ${answer}; then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
}

function makeCtx(
  deps: W8Deps,
  opts: W8Options,
  prior: (id: string) => StepRecord | null,
  state: Map<string, unknown>,
  calls: Array<Record<string, unknown>>,
  abort: AbortController,
  onStop: (code: string) => void,
  guardOn: boolean,
): StepContext {
  const debt: Debt = { restorers: [] };
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

/** A dialog or hand step: refused over a dialog already up; HANDOFF over one left after it. */
async function unpolled<T>(deps: W8Deps, pid: number, fn: () => Promise<T>): Promise<T> {
  const before = baselineRefusal(await deps.windows(), pid);
  if (before) throw new StopBattery("handoff", before);
  const value = await fn();
  const after = baselineRefusal(await deps.windows(), pid);
  if (after) throw new StopBattery("handoff", `after the step: ${after}`);
  return value;
}

export async function runBattery(
  steps: StepDef[],
  deps: W8Deps,
  opts: W8Options,
): Promise<BatteryReport> {
  const all = buildSteps();
  const records: StepRecord[] = [];
  const state = new Map<string, unknown>();
  const write = (r: StepRecord, results?: StepOutcome["results"]): void => {
    const path = recordPath(opts.runDir, r.step);
    let evidenceId: string | null = null;
    if (opts.evidenceDir) {
      const probes = r.probes.map((p) => `${p.id} ${p.result}`).join(", ");
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
          result_summary:
            `${r.step}: ${r.status}${probes ? ` [${probes}]` : ""} - ${r.detail}`.slice(0, 2000),
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
      const lines = results.lines.map((l) => JSON.stringify({ ...l, evidence: evidenceId }));
      deps.writeBytes(
        join(opts.sittingDir, results.file),
        Buffer.from(lines.join("\n") + (lines.length ? "\n" : ""), "utf-8"),
      );
    }
    records.push(clean);
    writeResult(opts, deps, all);
  };
  const prior = (id: string): StepRecord | null =>
    readJson<StepRecord>(recordPath(opts.runDir, id), deps);
  const live = steps.some((s) => s.phase === "live");
  if (live && steps[0]!.id !== GATE_STEP && steps[0]!.id !== HAND_GATE_STEP)
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
        detail: "--skip-hand: held for the hand block (nothing sent)",
        endedAt: startedAt,
        probes: [],
        evidence: {},
      });
      continue;
    }
    const killedNow = killedProbes(runDirsOf(opts, deps), deps, all);
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
    const ctx = makeCtx(
      deps,
      opts,
      prior,
      state,
      calls,
      abort,
      (c) => (clientStop = c),
      s.phase === "live",
    );
    try {
      let out: StepOutcome;
      if (s.phase !== "live") {
        const pids = deps.workbenchPids();
        if (pids.length)
          throw new StopBattery(
            "stopped",
            `a Workbench image runs (pid ${pids.join(", ")}): the ${s.phase} steps run with Workbench closed`,
          );
        out = await s.run(ctx);
      } else {
        const pid = deps.recordedPid();
        if (pid === null)
          throw new StopBattery(
            "stopped",
            "the lane recorded no Workbench pid: run the pre-flight first",
          );
        if (s.hand || s.dialog) out = await unpolled(deps, pid, () => s.run(ctx));
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
      }
      write(
        {
          ...base,
          status: out.status,
          detail: out.detail,
          endedAt: new Date(deps.now()).toISOString(),
          probes: out.probes ?? [],
          evidence: { ...out.evidence, calls },
        },
        out.results,
      );
      consecutiveFails = out.status === "FAIL" ? consecutiveFails + 1 : 0;
      if (consecutiveFails >= 3) {
        if (s.phase === "live" && s.id !== CLOSABLE_STEP)
          await closeOutAfterStop(deps, opts, prior, write);
        return {
          exit: EXIT.stopped,
          records,
          stoppedAt: s.id,
          message: "three consecutive unexpected failures: the battery stops",
        };
      }
      if (s.boundary && s !== steps[steps.length - 1]) {
        const failed = records.some((r) => r.status === "FAIL");
        return {
          exit: failed ? EXIT.refused : EXIT.done,
          records,
          stoppedAt: s.id,
          message: `boundary after ${s.id}: ${s.boundary}`,
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
          cleanup = await cleanupAfterStop(ctx);
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
          pendingRestorers: cleanup ? null : ctx.debt.restorers.map((r) => r.label),
        },
        stop: message,
      });
      if (
        s.phase === "live" &&
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

async function closeOutAfterStop(
  deps: W8Deps,
  opts: W8Options,
  prior: (id: string) => StepRecord | null,
  write: (r: StepRecord) => void,
): Promise<void> {
  const def = buildSteps().find((s) => s.id === CLOSABLE_STEP)!;
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

/** `<sitting>/w8-result.json`: every step's latest record across the sitting's run folders, each probe's result. */
export function writeResult(
  opts: W8Options,
  deps: Pick<W8Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  for (const dir of runDirsOf(opts, deps)) {
    for (const s of steps) {
      const r = readJson<StepRecord>(recordPath(dir, s.id), deps);
      if (r) latest.set(s.id, { ...r, runDir: basename(dir) });
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
            evidenceId: r.evidenceId ?? null,
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
    switches: SWITCHES,
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

// ── Offline subcommand: rollback ─────────────────────────────────────────────

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

/**
 * `plant`: the folders every file of the battery lies under (<sandbox>/_throwaway/W8/ and its
 * worlds/, anim/ and ai/) and the seed graph AGF_SEED, made offline with no Workbench running;
 * `<sitting>/plant-w8.json` records whether `_throwaway/` existed before (rollback removes it only
 * when it did not), the files written, and the hand block's fixtures with their maker and rollback
 * (followups item 1). Refuses when _throwaway/W8/ exists (roll the last sitting back first). The
 * world is written live by `wb_world new` (w8-06), the fixtures by w8-07; the live steps append
 * each fixture entity's id to the record's `entities`.
 */
export function runPlant(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  for (const d of PLANT_DIRS) io.log(`plant: folder <sandbox>/${d}/`);
  for (const f of PLANT_FILES) io.log(`plant: file <sandbox>/${f.rel} (${f.text.length} bytes)`);
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
  if (io.exists(abs(sandboxDir, W8_ROOT))) {
    io.log(`refused: <sandbox>/${W8_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const record: PlantRecord = {
    kind: "w8-plant",
    dirs: [...PLANT_DIRS],
    files: PLANT_FILES.map((f) => f.rel),
    throwawayExistedBefore: io.exists(abs(sandboxDir, THROWAWAY)),
    fixtures: plannedFixtures(),
    entities: [],
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  for (const d of PLANT_DIRS) {
    io.makeDir(abs(sandboxDir, d));
    io.log(`made <sandbox>/${d}/`);
  }
  for (const f of PLANT_FILES) {
    io.writeBytes(abs(sandboxDir, f.rel), Buffer.from(f.text, "utf-8"));
    io.log(`wrote <sandbox>/${f.rel}`);
  }
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W8/; `_throwaway/` only when empty and absent before the plant. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W8_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W8_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W8_ROOT}/ (${files.length} files)`);
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
    join(sittingDir, "throwaway-w8-listing.json"),
    Buffer.from(JSON.stringify(listing, null, 2) + "\n"),
  );
  io.removeTree(dir);
  let plant: { throwawayExistedBefore?: boolean; entities?: FixtureEntityRecord[] } | null = null;
  try {
    plant = JSON.parse(io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8")) as {
      throwawayExistedBefore?: boolean;
      entities?: FixtureEntityRecord[];
    };
  } catch {
    plant = null;
  }
  // The fixture entity lives only in the open world's memory (never saved): a record with no
  // delete is named, so the post-flight's close is read for a save prompt.
  for (const e of Array.isArray(plant?.entities) ? plant!.entities : [])
    if (!e.deleted)
      io.log(
        `fixture entity ${e.ref} (${e.step}) has no recorded delete: the world was never saved, so no file holds it`,
      );
  const top = abs(sandboxDir, THROWAWAY);
  if (plant?.throwawayExistedBefore === false && io.exists(top) && io.listDir(top).length === 0)
    io.removeTree(top);
  io.log(`removed <sandbox>/${W8_ROOT}/ (listing in throwaway-w8-listing.json)`);
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

type Handler = (
  args: Raw,
  extra?: unknown,
) => Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;

/** A server that only captures registered tool handlers, so a register function can run in process. */
export function captureServer(): { server: McpServer; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
    tool: (name: string, ...rest: unknown[]) => {
      handlers.set(name, rest[rest.length - 1] as Handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

/** A tool's MCP answer as a ToolResponse: its JSON text, else the text with ok from isError. */
export function responseOf(res: {
  content?: Array<{ text?: string }>;
  isError?: boolean;
}): ToolResponse {
  const text = res.content?.map((c) => c.text ?? "").join("\n") ?? "";
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && "ok" in (v as Raw)) return v as ToolResponse;
  } catch {
    // a text tool (wb_play, wb_stop, wb_state)
  }
  return { ok: res.isError !== true, message: text.slice(0, 2000) };
}

/** The one handler a register function gives its server (behavior_tree has no run function). */
function captureFileHandler(register: (server: McpServer) => void): Handler {
  const { server, handlers } = captureServer();
  register(server);
  const h = [...handlers.values()][0];
  if (!h) throw new Error("the tool did not register a handler");
  return h;
}

/**
 * A file tool's text as a ToolResponse (W4's textResponse): its JSON envelope when the text is
 * one, else `{ok: !isError, readback: {text}}`.
 */
export function fileToolResponse(
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

const PROFILE_DIR_ENV = "ENFUSION_PROFILE_DIR";
const COMMAND_LINE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$env:EMCP_PID)',
  "if ($p) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$p.CommandLine)) }",
].join("\n");

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W8Deps {
  process.env[WB_GUI_ENV] = "1";
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const root = artifactsDir();
  const { server, handlers } = captureServer();
  registerWbSettings(server, { artifactsDir: () => root });
  registerWbLink(server, client);
  registerWbDiag(server, client);
  registerWbMenu(server, client);
  registerWbGui(server, {});
  registerWbEditorTools(server, client);
  registerWbState(server, client);
  const viaHandler = async (name: string, args: Raw): Promise<ToolResponse> => {
    const h = handlers.get(name);
    if (!h)
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        message: `${name} is not registered in process`,
      };
    const { action: _a, ...rest } = args;
    const pass = name === "wb_play" || name === "wb_stop" || name === "wb_state" ? rest : args;
    return responseOf(await h(pass));
  };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  let config: Config | null = null;
  const fileConfig = (): Config => (config ??= { ...loadConfig(), projectPath: input.sandboxDir });
  let bt: Handler | null = null;
  const census = DEFAULT_CENSUS_ROOT;
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
          case "wb_scripts":
            return asResp(await runScripts(client, args as unknown as ScriptsArgs));
          case "wb_script_editor":
            return asResp(await runScriptEditor(client, args));
          case "wb_resources":
            return asResp(await runResources(client, args));
          case "wb_entity":
            return asResp(await runEntity(client, args));
          // The fixture file tools (w8-07): the test project's folder is passed here; no tool
          // or handler names it.
          case "animation_graph": {
            const t = runAnimationGraph(
              { ...args, projectPath: input.sandboxDir } as unknown as AnimationGraphArgs,
              fileConfig(),
            );
            return fileToolResponse(t.text, t.isError, S(args.action));
          }
          case "animation_workspace":
            return asResp(
              await runAnimationWorkspace(
                { ...args, projectPath: input.sandboxDir } as unknown as WorkspaceRequest,
                fileConfig(),
                { client } as never,
              ),
            );
          case "behavior_tree": {
            bt ??= captureFileHandler((s) => registerBehaviorTree(s, fileConfig()));
            const r = await bt({ ...args, projectPath: input.sandboxDir });
            return fileToolResponse(
              (r.content ?? []).map((c) => S(c.text)).join("\n"),
              r.isError,
              S(args.action),
            );
          }
          default:
            return await viaHandler(name, args);
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
    workbenchPids: workbenchPidsReal,
    registryExport: async () => {
      try {
        const file = exportRegistry({
          artifactsRoot: root,
          exec: regExec,
          platform: process.platform,
          now: () => new Date(),
        });
        const bytes = readFileSync(file);
        const text =
          bytes[0] === 0xff && bytes[1] === 0xfe
            ? bytes.subarray(2).toString("utf16le")
            : bytes.toString("utf-8");
        return { ok: true, sha256: sha256(bytes), path: file, text };
      } catch (e) {
        return {
          ok: false,
          sha256: "",
          path: "",
          text: "",
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    backlog: async () => {
      const a = new WorkbenchClient("127.0.0.1", input.port);
      const b = new WorkbenchClient("127.0.0.1", input.port);
      const t0 = Date.now();
      let firstCode: string | null = null;
      const first = runResources(a, {
        action: "search",
        searchStr: ["a"],
        recursive: true,
        limit: 500,
      })
        .then((r) => {
          firstCode = (r as ToolResponse).ok ? null : S((r as ToolResponse).code);
          return (r as ToolResponse).ok;
        })
        .catch((e: unknown) => {
          firstCode = e instanceof WorkbenchError ? e.code : "ERROR";
          return false;
        })
        .then((ok) => ({ ok, ms: Date.now() - t0 }));
      await new Promise((r) => setTimeout(r, 200));
      let secondCode: string | null = null;
      let refused = false;
      const t1 = Date.now();
      let secondOk = false;
      try {
        secondOk = (await b.probe("EMCP_WB_Ping", {}, { timeout: 120_000 })) !== null;
      } catch (e) {
        secondCode =
          e instanceof WorkbenchError ? e.code : e instanceof Error ? e.message : String(e);
        refused = /ECONNREFUSED|refused/i.test(e instanceof Error ? e.message : String(e));
      }
      const secondMs = Date.now() - t1 + 200;
      const f = await first;
      return {
        firstOk: f.ok,
        firstMs: f.ms,
        firstCode,
        secondOk,
        secondMs,
        secondCode,
        secondRefused: refused,
      };
    },
    censusRows: () => loadCensusRows(census),
    locators: () => loadLocatorRecords(census, "1.9.0.37"),
    menuItems: () => loadMenuItems(),
    menuAllowList: () => loadAllowListFile(),
    diagNames: () => {
      const c = loadDiagCatalog();
      if (!c) return null;
      const entries =
        (
          c as unknown as {
            entries?: Array<{ enumName: string; enum: string; kind: string; path: string }>;
          }
        ).entries ?? [];
      return {
        script: entries.filter((e) => e.enum === SCRIPT_ENUM).map((e) => e.enumName),
        engine: entries.filter((e) => e.enum === ENGINE_ENUM).map((e) => e.enumName),
        menus: [
          ...new Set(
            entries
              .filter((e) => e.kind === "menu" && e.enum === SCRIPT_ENUM)
              .map((e) => e.enumName),
          ),
        ],
      };
    },
    setAllowList: () => {
      const p = loadPolicy() as unknown as { diag?: { set_allow_list?: unknown } };
      return Array.isArray(p.diag?.set_allow_list) ? p.diag!.set_allow_list.map(String) : [];
    },
    rowsEnabled: () => {
      const p = loadPolicy() as unknown as { gui?: { rows_enabled?: unknown } };
      return Array.isArray(p.gui?.rows_enabled) ? p.gui!.rows_enabled.map(String) : [];
    },
    sourceIndexPath: () => {
      const f = join(root, "census", "1.9.0.37", "E02", "source-index.jsonl");
      return existsSync(f) ? f : null;
    },
    profileListing: () => {
      const dir =
        process.env[PROFILE_DIR_ENV] ??
        join(process.env.USERPROFILE ?? "", "Documents", "My Games", "ArmaReforgerWorkbench");
      return listTreeOf(dir).map((f) => {
        try {
          return `${f} ${statSync(join(dir, ...f.split("/"))).size}`;
        } catch {
          return f;
        }
      });
    },
    userName: () => {
      try {
        return userInfo().username;
      } catch {
        return process.env.USERNAME ?? "";
      }
    },
    artifactsRoot: () => root,
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
  "profile",
  "sweep-only",
  "sweep-limit",
] as const;
const FLAGS = ["really", "skip-hand", "owner-present", "sweep-no-tree", "update-baseline"] as const;
const SUBCOMMANDS = ["plant", "prep", "postcheck", "rollback"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: W8Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
}

/** The dry-run gate: the plan against the policy, the W8 plan check and the queue. */
export function dryRunCheck(policy: CensusPolicy): { ok: boolean; lines: string[] } {
  const steps = buildSteps();
  const plan = buildActionPlan(steps);
  const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
  const lines = [formatResult(check)];
  const own = w8PlanViolations(plan, policy);
  lines.push(
    own.length
      ? `W8 plan check: FAIL\n${own.map((v) => `  ${v}`).join("\n")}`
      : "W8 plan check: PASS",
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
  const sweep = parseSweepFilter(
    o["sweep-only"],
    o["sweep-limit"],
    args.flags.has("sweep-no-tree"),
  );
  if (typeof sweep === "string") {
    say(sweep);
    return EXIT.usage;
  }
  const steps = buildSteps();

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

  if (sub === "rollback" || sub === "plant") {
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

  if (sub === "prep" || sub === "postcheck") {
    const phase: Phase = sub === "prep" ? "prep" : "post";
    const mine = steps.filter((s) => s.phase === phase);
    for (const s of mine) say(`${sub}: ${s.id}: ${s.title}`);
    if (
      !o["sitting-dir"] ||
      (sub === "prep" && !o.profile) ||
      (sub === "postcheck" && !o.sandbox)
    ) {
      say(
        sub === "prep"
          ? "prep needs --sitting-dir <dir> and --profile <new scratch ini name>"
          : "postcheck needs --sandbox <dir> and --sitting-dir <dir>",
      );
      return EXIT.usage;
    }
    if (!really) {
      say("dry run: nothing written (add --really with --id; no Workbench may run)");
      return EXIT.done;
    }
    const g = laneGate();
    if (g.refusal) {
      say(g.refusal);
      return g.code;
    }
    const sittingDir = resolve(o["sitting-dir"]);
    const runDir = join(
      sittingDir,
      phase === "prep" ? PREP_RUN : `${POST_RUN}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    mkdirSync(runDir, { recursive: true });
    const sandboxDir = o.sandbox ? resolve(o.sandbox) : "";
    const deps = over.deps ?? realDeps({ port: DEFAULT_PORT, lane: g.lane!, sandboxDir });
    const r = await runBattery(mine, deps, {
      runDir,
      sittingDir,
      sandboxDir,
      evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
      ph: { ...ph, ...(sandboxDir ? { sandbox: sandboxDir } : {}) },
      build: o.build ?? readCurrentBuild(DEFAULT_CENSUS_ROOT) ?? "unrecorded",
      profile: o.profile,
    });
    for (const l of resultTable(r.records)) say(l);
    if (r.message) say(toPlaceholders(r.message, ph));
    return r.exit;
  }

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
  const liveOnly = steps.filter((s) => s.phase === "live");
  const selected = selectSteps(liveOnly, { from: o.from, only: o.only, until: o.until });
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
  if (!existsSync(join(sittingDir, PREP_FILE))) {
    say(
      toPlaceholders(
        `refused: ${sittingDir} holds no ${PREP_FILE}: run \`w8.live.ts prep\` first`,
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
      skipHand: args.flags.has("skip-hand"),
      ownerPresent: args.flags.has("owner-present"),
      ...(sweep ? { sweep } : {}),
    });
    for (const l of resultTable(r.records)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w8",
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

// Census rows this file tests (W8 close-out, after the sitting).
// census:mcp:action/wb_diag.catalog
// census:mcp:action/wb_diag.get
// census:mcp:action/wb_diag.info
// census:mcp:action/wb_diag.set
// census:mcp:action/wb_diag.select
// census:mcp:handler-action/EMCP_WB_Diag.catalog
// census:mcp:handler-action/EMCP_WB_Diag.get
// census:mcp:handler-action/EMCP_WB_Diag.info
// census:mcp:handler-action/EMCP_WB_Diag.set
// census:mcp:handler-action/EMCP_WB_Diag.select
// census:mcp:action/wb_settings.diff
// census:mcp:action/wb_settings.get
// census:mcp:action/wb_settings.list
// census:mcp:action/wb_settings.stores
// W8 run 8 (DEC-088): the context menus w8-94 opened by hand and read through wb_gui context.
// census:ui:WorldEditor/context-menu/Hierarchy/entity
// census:ui:WorldEditor/context-menu/Hierarchy/default
// census:ui:none/context-menu/World Editor Hierarchy context menu (Entities)
// census:ui:none/context-menu/Script Editor tab context menu
// census:ui:none/context-menu/Property grid context menu %2F options
