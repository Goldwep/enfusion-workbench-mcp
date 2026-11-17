/**
 * Wave W3 (Script Editor, String Editor), the live battery (docs/v2/design/phase5-w3-spec.md
 * section 6, DEC-063). Structure, CLI, evidence, hand steps and stop rules follow the W1 battery
 * (tests/live/w1.live.ts) that passed live in full.
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch profile with `-scriptAuthorizeAll` (DEC-053 ruling 2, the standing go), with the
 * shipped bundle installed and NO probe pack. This script never launches, never takes the lease for
 * itself (the lane given with --id holds it) and reaches Workbench through the shipped TS tools run
 * IN PROCESS (`runScriptEditor`, `runLocalization`, `runModule`, `runWorld`, `runContainer`,
 * `runScripts`) over a `WorkbenchClient` WITHOUT a Config (no lease, no auto-launch, no handler
 * recovery), so each step tests the TS mapping and the handler together. The offline tools
 * (`runStringTable`, `readStIds` of ui_localization_audit) run in process on the sandbox; the
 * language server is reached by `scripts/live/lsp-probe.ts` runLspPlan and by the shipped
 * `ScriptLspHost` with the process environment AS GIVEN: this battery never sets
 * ENFUSION_SCRIPT_LSP, so script_lsp stays GATED unless the main session opened it (P-W3-23).
 * Undo goes through `wb_module action` Edit > Undo of the module (policy execute_action allow-list).
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan and the queue with preflight's validateQueue; `--out` writes
 * the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/W3-queue.json;
 * a test keeps the two equal). The runbook is docs/v2/sessions/queues/W3.md.
 *
 * Blocks (one launch; each block is ordered read-only, reversible, mutating for the queue):
 *   W3.0 setup     the test-bed gate and snapshot; both editors opened; the OD-1 string table made
 *                  BY HAND (File > New in the String Editor, saved under _throwaway/W3/st/); the
 *                  planted scripts written (a .c is never registered); the work copy of the
 *                  table opened and seeded
 *   W3.1 read      section 6 item 1: Script Editor and String Editor reads, string_table reads,
 *                  the 1.x read aliases, the GATED refusals, jump
 *   W3.2 memory    item 2: in-memory edits, each restored by undo or its before snapshot; nothing saved
 *   W3.3 files     item 3: saves of throwaway documents, the offline string_table writes on copies,
 *                  the engine-accept proof of the offline .st and runtime .conf (P-W3-21)
 *   W3.4 lsp       item 4: the language server's own answer (P-W3-23, never un-gating script_lsp),
 *                  a second client (P-W3-25), the script_lsp actions (P-W3-24)
 *   W3.5 last      item 5: wb_scripts validate, the documents settled (saved: all throwaway), reload
 *   W3.6 net-zero  the HANDOFF verdicts, the sandbox outside _throwaway/W3/ hashed against the
 *                  battery's snapshot, and the close-out that leaves Workbench closable by WM_CLOSE
 * Everything under _throwaway/W3/ (the plant, the hand-made table, copies, .meta files, runtime
 * tables) is removed by this script's `rollback` subcommand once Workbench is closed; it also puts
 * back the .gproj from the plant's copy if the hand's File > New changed it.
 *
 * Stop rules (as W1): a dialog-like window already up refuses the step; the pid's windows are polled
 * while a step runs: a new dialog-like or disabled window is a HANDOFF (its exact title and the
 * planned answer are recorded; never Save on a battery document), any other new window a STOP. A
 * hand step (the OD-1 fixture) is not polled while the hand works (the editor's own dialogs are the
 * point); it refuses to start over a dialog and HANDS OFF when one is left after the answer. A LOST,
 * WEDGED or MODAL_OPEN client error stops the battery; three consecutive unexpected FAILs stop it. A
 * stop runs the step's restorers unless a dialog is up or the client is LOST or WEDGED. A mutating
 * call is never retried after an answer it may have acted on (a refusal that sent nothing to the
 * engine may be followed by one other call). A probe whose kill criterion is met is recorded KILLED
 * with the observed value; steps that depend on it are SKIPPED with that reason.
 *
 * Usage:
 *   npx --no tsx tests/live/w3.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w3.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w3.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--lsp-port 5776] [--evidence-dir <dir>] [--build <tag>]
 *       [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w3.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
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
import { loadConfig } from "../../src/config.js";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { runScriptEditor } from "../../src/tools/wb-script-editor.js";
import { runLocalization } from "../../src/tools/wb-localization.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runScripts, type ScriptsArgs } from "../../src/tools/wb-scripts.js";
import { runStringTable, type StringTableArgs } from "../../src/tools/string-table.js";
import {
  GATE_ENV,
  LSP_DEFAULT_PORT,
  PORT_ENV,
  ScriptLspHost,
  gateReason,
} from "../../src/tools/script-lsp.js";
import { readStIds, runLocalizationAudit } from "../../src/tools/ui-localization-audit.js";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { UPDATE_BASELINE_FLAG, applyBaselineGuard } from "./baseline.js";
import { checkPlan, formatResult, type PlanAction } from "../../scripts/live/dry-run.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "../../scripts/live/evidence.js";
import { Lane } from "../../scripts/live/lane.js";
import { runLspPlan, type LspPlan } from "../../scripts/live/lsp-probe.js";
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
  isBusyWindow,
  isDialogWindow,
  watched,
  type VerdictOptions,
} from "../../scripts/census/live/common.js";
import {
  changedFiles,
  exactLineDiff,
  handFiles,
  handLine,
  recordPath,
  snapshotFiles,
  underDeclared,
} from "./w1.live.js";

export { EXIT, StopBattery, handFiles, handLine };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W3";
export const GATE_STEP = "w3-00-gate";
export const HAND_STEP = "w3-02-fixture-hand";
/** The last step; the runner also runs it after a stop (not after a dialog, LOST or WEDGED). */
export const CLOSABLE_STEP = "w3-95-closable";
export const SCRIPT_PATH = "tests/live/w3.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W3.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W3-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));

/** The one switch the launch carries, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<sitting>/w3-scratch.ini",
  SAA,
];

/** Every file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W3_ROOT = `${THROWAWAY}/W3`;
export const SCRIPTS_DIR = `${W3_ROOT}/scripts`;
export const ST_DIR = `${W3_ROOT}/st`;
export const RUNTIME_DIR = `${W3_ROOT}/runtime`;
/** OD-1: the string table the main session's hand makes with File > New in the String Editor. */
export const FIXTURE_NAME = "EMCP_W3_Fixture";
export const FIXTURE_ST = `${ST_DIR}/${FIXTURE_NAME}.st`;
/** A byte copy of the hand-made table: every handler edit and save acts on it, never on the fixture. */
export const WORK_ST = `${ST_DIR}/EMCP_W3_Work.st`;
/** Written by string_table create (offline), opened by the engine (P-W3-21). */
export const OFFLINE_ST = `${ST_DIR}/EMCP_W3_Offline.st`;
/** A byte copy of the work table, edited by string_table upsert/remove (offline). */
export const COPY_ST = `${ST_DIR}/EMCP_W3_Copy.st`;
export const RUNTIME_LANGS = ["en_us", "de_de"] as const;
export function runtimeOf(lang: string): string {
  return `${RUNTIME_DIR}/EMCP_W3_Copy.${lang}.conf`;
}
/** The planted throwaway scripts (plain text, outside every script folder: never compiled). */
export const SCRIPTS = {
  edit: `${SCRIPTS_DIR}/EMCP_W3_Edit.c`,
  saveA: `${SCRIPTS_DIR}/EMCP_W3_SaveA.c`,
  saveB: `${SCRIPTS_DIR}/EMCP_W3_SaveB.c`,
  reload: `${SCRIPTS_DIR}/EMCP_W3_Reload.c`,
  lsp: `${SCRIPTS_DIR}/EMCP_W3_Lsp.c`,
} as const;
export const SCRIPT_LIST: readonly string[] = Object.values(SCRIPTS);
/** The seed items the battery inserts into the work table (and saves there). */
export const SEED_IDS = ["EMCP_W3_SEED_A", "EMCP_W3_SEED_B", "EMCP_W3_SEED_C"] as const;
export const SEED_TEXT: Readonly<Record<string, string>> = {
  EMCP_W3_SEED_A: "Seed alpha",
  EMCP_W3_SEED_B: "Seed beta",
  EMCP_W3_SEED_C: "Seed gamma",
};
/** Every item a step adds in memory carries this prefix; the sweep deletes what is left. */
export const TEMP_PREFIX = "W3_T_";
/** w3-27's decoy row: not matched by the seed filter (fix-up 3). */
export const FILTER_TEMP_ID = `${TEMP_PREFIX}F1`;
/**
 * w3-20: Edit > Undo presses at most (run 2: one press took the setLine text to "", so a
 * SetLineText is more than one undo step); a press is repeated only while it changes line 7.
 */
export const SCRIPT_UNDO_PRESSES_MAX = 3;
export const OFFLINE_ITEMS = [
  { Id: "EMCP_W3_OFF_A", Target_en_us: "Offline alpha" },
  { Id: "EMCP_W3_OFF_B", Target_en_us: "Offline beta" },
] as const;
export const UPSERT_ITEM = { Id: "EMCP_W3_UP_A", Target_en_us: "Upserted alpha" } as const;
/** P-W3-05: the doc example, a project class (an installed handler, never edited), a miss. */
export const VANILLA_SYMBOL = "IEntity.GetID";
export const PROJECT_SYMBOL = "EMCP_WB_Ping";
export const MISSING_SYMBOL = "EMCP_W3_NoSuchClass";
export const PLANT_FILE = "plant-w3.json";
/** The plant's copy of the project file (File > New may register the table in it). */
export const GPROJ_BACKUP = "w3-gproj-before.bin";
export const GPROJ_REL = `${SANDBOX_NAME}.gproj`;
/** The runbook's name for a copy of the pre-flight manifest; the battery never writes it. */
export const SNAPSHOT_FILE = "w3-snapshot-before.json";
export const BATTERY_SNAPSHOT_FILE = "w3-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w3-battery-snapshot";
export const RESULT_FILE = "w3-result.json";
/** How long a hand step waits for the main session's answer file. */
export const HAND_WAIT_MS = 900_000;
/** Files whose change outside _throwaway/W3/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** Item fields that hold the Workbench user name (SCR_LocModifiedPlugin, OD-5): never recorded. */
export const PERSONAL_FIELDS: ReadonlySet<string> = new Set(["Author", "LastChanged"]);

export const TIMEOUTS = {
  step: 180_000,
  open: 120_000,
  poll: 5_000,
  reloadWatch: 6_000,
  lsp: 120_000,
} as const;

/**
 * How long a script reload's progress window may stay before it is a handoff (fix-up 3). W3 run 3:
 * the log timed the reload at 5188 ms ("Reloading game scripts took"), and the progress window came
 * and went inside it; 30 s bounds that about six times over. A dialog outlives it.
 */
export const RELOAD_GRACE_MS = 30_000;

/**
 * The window rule's options for a step: the reload grace (owned progress windows too) where the step
 * reloads (fix-up 3); every other step gets W4's and W8's busy-window grace (W1 cold run fix-up
 * audit: validate compiles and the editor opens can leave the editor windows disabled for a while).
 * An owned window outside a reload step, a #32770 or a known modal title is a verdict at once.
 */
export function watchOptions(s: Pick<StepDef, "reloadGrace">): VerdictOptions {
  return s.reloadGrace
    ? { busyGraceMs: RELOAD_GRACE_MS, progressWindows: true }
    : { busyGraceMs: BUSY_GRACE_MS };
}

/** Client codes that stop the battery (the brief's stop rules). */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/** Refusals that are data, never a failure. */
export const RECORD_ONLY_CODES: ReadonlySet<string> = new Set(["UNPROVEN", "GATED"]);

/** Windows a step may add: the two editors, the main window, the World Editor (as W1). */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
export const W3_WINDOWS: readonly RegExp[] = [
  DEBUG_TITLE,
  /^Script Editor( - .+)?$/,
  /^String Editor( - .+)?$/,
  /^Enfusion Workbench - EMCP2 sandbox \(2\.0 live lane\)$/,
  /^World Editor - .+$/,
];

// ── Coverage tables ──────────────────────────────────────────────────────────

/** The two W3 contracts in contracts/ and the TS tool that drives each. */
export const W3_CONTRACTS = {
  EMCP_WB_ScriptEditor: "wb_script_editor",
  EMCP_WB_Localization: "wb_localization",
} as const;

/** TypeScript-only actions of the wave's tools (no contract), exercised all the same. */
export const TS_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  string_table: ["inspect", "get", "lint", "lookup", "create", "upsert", "remove", "buildRuntime"],
  script_lsp: [
    "status",
    "diagnostics",
    "hover",
    "definition",
    "implementation",
    "completion",
    "signature",
  ],
  wb_script_editor: ["getCurrentFile", "getLine", "getLinesCount", "openFile"],
  wb_localization: ["getTable", "listLanguages", "modify"],
  ui_localization_audit: ["audit"],
};

/**
 * Actions no step exercises, with the reason. Empty: every action of the two contracts and every
 * TS-only action above is sent by at least one step. The GATED ones (both close actions,
 * wb_localization buildRuntime, script_lsp while ENFUSION_SCRIPT_LSP is unset) are sent as their
 * dry-run form and their GATED refusal is the recorded result.
 */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {};

/** Probes no step can settle hand-free, with the reason (the rest are assigned to steps). */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {
  "P-W3-04":
    "the shipped wb_script_editor close is GATED (OD-3) and no shipped handler sends WBModuleDef.Close or Workbench.CloseModule; Close over a dirty tab is the very prompt-or-discard the battery must never meet. w3-14 records the GATED refusal",
  "P-W3-18":
    "wb_localization buildRuntime is GATED in TS and in the handler, and the wb_module allow-list denies the word 'build': no shipped route sends ExecuteAction {Table, Build Runtime Table}; the offline string_table buildRuntime is the shipped route (OD-2, w3-45)",
  "P-W3-19":
    "the shipped wb_localization close is GATED (OD-3) and nothing sends WBModuleDef.Close on the String Editor; a close over unsaved edits is the prompt-or-discard the battery must never meet. w3-14 records the GATED refusal",
  "P-W3-20":
    'no shipped handler calls BaseContainerTools.CreateContainer("StringTable") + SaveContainer for a new file or CreateObjectArrayVariableMember on a table; OD-1 ruled the fixture is made by hand (w3-02) and create is offline (w3-45)',
  "P-W3-22":
    "the CLI build needs a second, headless Workbench process; this battery runs inside the one GUI launch and the -build switch for string tables is unverified",
  "P-W3-26":
    "no shipped handler or module id names DialogueEditor (vocabulary MODULE_IDS and EMCP_WB_Guard.ModuleType list 10 modules without it) and the battery loads no probe pack; OD-8 keeps the rows blocked:P-U23",
};

/** The probe ids P-W3-01 .. P-W3-26. */
export const PROBE_IDS: readonly string[] = Array.from(
  { length: 26 },
  (_, i) => `P-W3-${String(i + 1).padStart(2, "0")}`,
);

/**
 * Steps whose HANDOFF is itself the observation of a probe: w3-85 records the probe KILLED with
 * the dialog's title from the sitting's records (the HANDOFF record carries no probe result).
 */
export const HANDOFF_PROBES: Readonly<Record<string, string>> = {
  "w3-15-jump": "P-W3-05",
  "w3-26-loc-plugins": "P-W3-12",
  "w3-42-script-reload": "P-W3-07",
  "w3-43-loc-save": "P-W3-16",
  "w3-46-st-accept": "P-W3-21",
};

/**
 * What the hand presses on a dialog a step may raise by design, and where main resumes. Every other
 * dialog: the engine's save prompt gets "No"; anything else is recorded and never answered "Save".
 */
export const STEP_DIALOG_ANSWERS: Readonly<
  Record<string, { answer: string; resumeNext: boolean; title?: string }>
> = {
  "w3-42-script-reload": {
    // Run 3 (w3-61, on screen): title "Reload", text "<sandbox>/_throwaway/W3/scripts/
    // EMCP_W3_Reload.c  This file has been modified by another program. Do you want to reload it?",
    // buttons Yes / Yes to All / No. Yes reloads the buffer from the disk and writes nothing.
    answer:
      'Yes on the "Reload" prompt ("... EMCP_W3_Reload.c This file has been modified by another program. Do you want to reload it?"; buttons Yes / Yes to All / No): Yes reloads the buffer from the disk, which holds the planted text again, and writes nothing; never Save',
    resumeNext: true,
  },
  "w3-61-settle": {
    // Cold run 1 fix: the same prompt in w3-61 (run 3, regress2, cold run 1) is a planned hand
    // request answered inline (PLANNED_DIALOGS); this entry is the fallback when the inline answer
    // did not clear it. Only this title gets Yes; any other window in w3-61 has no planned answer.
    title: "Reload",
    answer:
      'Yes on the "Reload" prompt ("... EMCP_W3_Reload.c This file has been modified by another program. Do you want to reload it?"; buttons Yes / Yes to All / No): Yes reloads the buffer from the disk, which holds the planted text again, and writes nothing; never Save',
    resumeNext: false,
  },
  "w3-26-loc-plugins": {
    answer:
      "Cancel / No (keep the old text; the item is the throwaway W3_T_P1, which the next String Editor step deletes); never Save",
    resumeNext: true,
  },
  "w3-15-jump": {
    answer: "OK / Close (an information box about the symbol); never Save",
    resumeNext: true,
  },
  "w3-46-st-accept": {
    answer:
      "OK / Close (a load error is the P-W3-21 kill: record the exact text); then nothing else",
    resumeNext: true,
  },
};

/**
 * A dialog a step meets by design that the hand answers inline: the battery does not hand off; it
 * writes a hand request, waits for the answer, checks no dialog is left and goes on in the same run
 * folder. Matched by exact title and class, owned, and the only non-busy dialog-like window of the
 * pid; any other window is the normal HANDOFF.
 */
export interface PlannedDialog {
  title: string;
  className: string;
  /** hand-<key>.request.json / hand-<key>.json in the run folder. */
  key: string;
  /** The button the hand presses (the answer file names it). */
  button: string;
  instruction: string;
  /**
   * When the dialog cut the step before its body ended, the step runs once more after the answer.
   * Only for a step whose calls are the settle that w3-95 repeats anyway (idempotent saves of
   * _throwaway/W3/ documents); a body that ended before the cut is recorded as it is.
   */
  rerunOnCut: boolean;
}

/**
 * Cold run 1 (Workbench 1.9.0.37): w3-42 recorded the offline write "silent" (P-W3-07 PARTIAL) and
 * the "Reload" prompt came later, in w3-61, when the Script Editor regained focus (as run 3 and
 * regress2). Seen on screen: title "Reload", class Qt683QWindowIcon, owned; text "<sandbox>/
 * _throwaway/W3/scripts/EMCP_W3_Reload.c This file has been modified by another program. Do you
 * want to reload it?"; buttons Yes / Yes to All / No. The disk holds the planted text again (w3-42
 * wrote it back), so Yes reloads the planted text and writes nothing.
 */
export const RELOAD_PROMPT: PlannedDialog = {
  title: "Reload",
  className: "Qt683QWindowIcon",
  key: "w3-61-reload",
  button: "Yes",
  instruction:
    'in Workbench, the window "Reload" ("... _throwaway/W3/scripts/EMCP_W3_Reload.c This file has been modified by another program. Do you want to reload it?", buttons Yes / Yes to All / No): press Yes (never Yes to All, never No, never Save); then write {"done": true, "pressed": "Yes", "title": "Reload", "text": "<the prompt text>"} or {"done": false, "why": "..."}',
  rerunOnCut: true,
};

/** The steps that answer a planned dialog inline (cold run 1 fix). */
export const PLANNED_DIALOGS: Readonly<Record<string, PlannedDialog>> = {
  "w3-61-settle": RELOAD_PROMPT,
};

// ── Types ────────────────────────────────────────────────────────────────────

export type W3Tool =
  | "wb_script_editor"
  | "wb_localization"
  | "wb_module"
  | "wb_world"
  | "wb_container"
  | "wb_scripts"
  | "string_table"
  | "script_lsp"
  | "ui_localization_audit";

/** The NET API function each tool's plan entry names ("offline:" = no NET call at all). */
export const HANDLER_OF: Readonly<Record<W3Tool, string>> = {
  wb_script_editor: "EMCP_WB_ScriptEditor",
  wb_localization: "EMCP_WB_Localization",
  wb_module: "EMCP_WB_Module",
  wb_world: "EMCP_WB_World",
  wb_container: "EMCP_WB_Container",
  wb_scripts: "ValidateScripts",
  string_table: "offline:string_table",
  script_lsp: "offline:script_lsp",
  ui_localization_audit: "offline:ui_localization_audit",
};

export type Block = "W3.0" | "W3.1" | "W3.2" | "W3.3" | "W3.4" | "W3.5" | "W3.6";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "KILLED" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED";

export interface ProbeResult {
  id: string;
  /** SETTLED: answered as the probe asks; KILLED: its kill criterion is met; PARTIAL: part answered. */
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

export interface W3Deps {
  /** One shipped TS tool, run in process (the NET tools against a client WITHOUT a Config). */
  tool: (name: W3Tool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** One run of scripts/live/lsp-probe.ts runLspPlan (shapes only, never server strings). */
  lsp: (plan: LspPlan) => Promise<Record<string, unknown>>;
  info: () => Promise<Record<string, unknown> | null>;
  ping: () => Promise<Record<string, unknown> | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  makeDir: (path: string) => void;
  exists: (path: string) => boolean;
  /** Relative paths of every file under `dir` (forward slashes), [] when absent. */
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W3Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

/** What a step left behind that a stop must put back (run in reverse order). */
export interface Debt {
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W3Deps;
  opts: W3Options;
  prior: (id: string) => StepRecord | null;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  /** A tool call: guarded by the window poller; a stop code throws. */
  tool: (
    name: W3Tool,
    args: Record<string, unknown>,
    o?: { restore?: boolean },
  ) => Promise<ToolResponse>;
  /** A battery file write: only under _throwaway/W3/, recorded, guarded like a call. */
  write: (rel: string, data: Buffer) => void;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  /** The id of the step this context runs (for resume hints). */
  currentStep: string;
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
  /** The hand works in Workbench during this step: no window poll, no Workbench call. */
  handDriven?: boolean;
  /** The step needs the hand-made table: a resumed run makes it first (W3.0 prelude). */
  needsFixture?: boolean;
  /**
   * Fix-up 3: the step reloads the scripts; the reload's progress window (owned, titled like the
   * app) and busy windows are graced for RELOAD_GRACE_MS (`STEP_WATCH_OPTIONS`).
   */
  reloadGrace?: boolean;
  plan: () => PlanAction[];
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

function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(sandboxDir: string, rel: string): string {
  return join(sandboxDir, ...rel.split("/"));
}

function recordOnly(r: ToolResponse): boolean {
  return !r.ok && RECORD_ONLY_CODES.has(S(r.code));
}

function readJson<T>(path: string, deps: Pick<W3Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W3Deps, "writeBytes">): void {
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

/** Lines of a text, without the empty line after a final line break. */
export function linesOf(text: string): string[] {
  const l = text.split(/\r?\n/);
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
}

/** Equal line lists, a single trailing empty line on either side ignored. */
export function sameLines(a: readonly string[], b: readonly string[]): boolean {
  const t = (x: readonly string[]): string[] =>
    x.length && x[x.length - 1] === "" ? x.slice(0, -1) : [...x];
  const x = t(a);
  const y = t(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** A project-relative path with the "$<addon>:" prefix, a {GUID} and backslashes taken off. */
export function relOf(path: unknown): string {
  return S(path)
    .replace(/\\/g, "/")
    .replace(/^\$[^:]*:/, "")
    .replace(/^\{[0-9A-Fa-f]{16}\}/, "");
}

export function namesRel(path: unknown, rel: string): boolean {
  const p = relOf(path).toLowerCase();
  return p !== "" && p.endsWith(rel.toLowerCase());
}

export function underW3(path: unknown): boolean {
  const p = relOf(path);
  return p.startsWith(`${W3_ROOT}/`) || p.includes(`/${W3_ROOT}/`);
}

/** The class name a planted script declares (its file name without .c). */
export function classOf(rel: string): string {
  return basename(rel).replace(/\.c$/i, "");
}

/** The planted text of a throwaway script: 10 lines, line 7 a Print, CRLF line ends. */
export function plantedLines(rel: string): string[] {
  return [
    "// EMCP W3 throwaway script (tests/live/w3.live.ts); lies under _throwaway/W3/, never compiled",
    `class ${classOf(rel)}`,
    "{",
    "\tint m_iValue = 1;",
    "",
    "\tvoid Run()",
    "\t{",
    '\t\tPrint("EMCP W3 line 7");',
    "\t}",
    "}",
  ];
}

export function plantedText(rel: string): Buffer {
  return Buffer.from(plantedLines(rel).join("\r\n") + "\r\n", "utf-8");
}

/** The {GUID} of a registered resource from its .meta text ("Name "{GUID}path""), or "". */
export function guidOfMeta(text: string): string {
  const m = /\{([0-9A-Fa-f]{16})\}/.exec(text);
  return m ? `{${m[1]!.toUpperCase()}}` : "";
}

/** "NAME=n" pairs of an enum column to the number of NAME, or null. */
export function enumNumber(columns: unknown, column: string, name: string): string | null {
  if (!Array.isArray(columns)) return null;
  const c = (columns as Raw[]).find((x) => S(x.name) === column);
  const enums = Array.isArray(c?.enums) ? (c!.enums as unknown[]).map(S) : [];
  for (const e of enums) {
    const [k, v] = e.split("=");
    if (k === name && v !== undefined && /^-?\d+$/.test(v)) return v;
  }
  return null;
}

export function columnNames(columns: unknown): string[] {
  return Array.isArray(columns) ? (columns as Raw[]).map((x) => S(x.name)) : [];
}

/** A get readback's field value, or null when the field is absent. */
function fieldValue(r: ToolResponse | null, name: string): string | null {
  const f = Array.isArray(rb(r).fields) ? (rb(r).fields as Raw[]) : [];
  const hit = f.find((x) => S(x.name) === name);
  return hit ? S(hit.value) : null;
}

/** A set/insert readback's after value of a field, or null. */
function afterValue(r: ToolResponse | null, name: string): string | null {
  const a = Array.isArray(rb(r).after) ? (rb(r).after as Raw[]) : [];
  const hit = a.find((x) => S(x.name) === name);
  return hit ? S(hit.value) : null;
}

const PERSONAL_TEXT = /\b(Author|LastChanged)(\s*[:=]?\s*)"[^"]*"/g;

/**
 * The record with every value that can hold the Workbench user name replaced (OD-5): item fields
 * Author and LastChanged in any shape the tools answer, and the same keys inside file text.
 */
export function redactPersonal<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(PERSONAL_TEXT, '$1$2"<redacted>"');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v as Raw;
      const out: Raw = {};
      const named = typeof o.name === "string" && PERSONAL_FIELDS.has(o.name);
      for (const [k, x] of Object.entries(o)) {
        if (PERSONAL_FIELDS.has(k) && (typeof x === "string" || typeof x === "number"))
          out[k] = `<redacted: ${S(x).length} chars>`;
        else if (named && k === "value") out[k] = `<redacted: ${S(x).length} chars>`;
        else out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The plan entry of one tool call: the handler it sends to, the wire action, tool and action. */
export function tc(
  tool: W3Tool,
  action: string,
  params: Raw = {},
  extra: { toolAction?: string; note?: string; target?: string; document?: string } = {},
): PlanAction {
  return {
    kind: "net-call",
    target: extra.target ?? HANDLER_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: extra.toolAction ?? action,
    ...(extra.document ? { document: extra.document } : {}),
    note:
      extra.note ??
      (HANDLER_OF[tool].startsWith("offline:")
        ? "offline TS tool in process: no NET call"
        : "through the shipped TS tool, in process"),
  } as PlanAction;
}

/** A file the battery writes itself (copies, the plant on a resumed run, P-W3-07's disk change). */
export function fileWritePlan(rel: string, note: string): PlanAction {
  return {
    kind: "net-call",
    target: "offline:battery",
    params: { action: "writeFile", path: rel },
    tool: "battery",
    toolAction: "writeFile",
    note: `no NET call: ${note}`,
  } as PlanAction;
}

/** Edit > Undo of one module through wb_module action, and the ExecuteAction it runs. */
export function undoPlan(
  module: "ScriptEditor" | "LocalizationEditor",
  when?: string,
): PlanAction[] {
  const note = `Edit > Undo of the ${module} through the shipped wb_module action`;
  return [
    tc(
      "wb_module",
      "action",
      { module: module, menuPath: ["Edit", "Undo"], confirm: true },
      { note: when ? `${note}; ${when}` : note },
    ),
    {
      kind: "execute-action",
      target: { path: ["Edit", "Undo"], module },
      via: "EMCP_WB_Module {action: action}",
    } as PlanAction,
  ];
}

const openScriptPlan = (rel: string): PlanAction[] => [
  tc("wb_script_editor", "open", { path: rel }),
  tc("wb_script_editor", "state"),
];

const readAllPlan = (): PlanAction[] => [
  tc("wb_script_editor", "getLines", { start: 0, limit: 200 }),
];

/** Before a table switch: the temp sweep, the save of a throwaway table the open refused over. */
const openTablePlan = (rel: string): PlanAction[] => [
  tc("wb_localization", "status"),
  tc("wb_localization", "list", { prefix: TEMP_PREFIX }),
  tc("wb_localization", "delete", { id: `${TEMP_PREFIX}*` }, { note: "temp leftovers, if any" }),
  tc("wb_localization", "open", { path: rel }),
  tc(
    "wb_localization",
    "save",
    { confirm: true },
    {
      document: WORK_ST,
      note: "only when the open refused MODAL_HAZARD over handler edits of a _throwaway/W3/ table",
    },
  ),
  tc("wb_localization", "open", { path: rel }, { note: "only after that save" }),
];

const ensureWorkPlan = (): PlanAction[] => [
  fileWritePlan(WORK_ST, "byte copy of the hand-made table, only when absent"),
  tc("wb_world", "register", { path: WORK_ST, confirm: true }),
  ...openTablePlan(WORK_ST),
  tc("wb_localization", "list", { fields: ["Id"], limit: 200 }),
  ...SEED_IDS.map((id) =>
    tc(
      "wb_localization",
      "insert",
      { id, fields: ["Target_en_us"], values: [SEED_TEXT[id]] },
      { note: "only when the seed is missing" },
    ),
  ),
  tc("wb_localization", "save", { confirm: true }, { document: WORK_ST, note: "after seeding" }),
];

const scriptCurrentPlan = (rel: string): PlanAction[] => [
  fileWritePlan(rel, "the planted text, only when the script is absent"),
  tc("wb_script_editor", "state"),
  ...openScriptPlan(rel),
  ...readAllPlan(),
  tc(
    "wb_script_editor",
    "replaceRange",
    { start: 0 },
    { note: "only when the buffer differs from the planted text (a stop's leftover)" },
  ),
];

/** Tool actions that write a file (the harness test checks their paths). */
export const FILE_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  "wb_script_editor.save",
  "wb_localization.save",
  "string_table.create",
  "string_table.upsert",
  "string_table.remove",
  "string_table.buildRuntime",
  "wb_world.register",
  "wb_container.save",
  "battery.writeFile",
]);

const WINDOW_KILL =
  "a new dialog-like window: HANDOFF (nothing sent to it); any other new window: STOP; LOST, WEDGED or MODAL_OPEN: STOP";

// ── Shared step bodies: scripts ──────────────────────────────────────────────

/** The Script Editor's state; `rel` names the current file when given. */
async function seState(ctx: StepContext): Promise<ToolResponse> {
  return ctx.tool("wb_script_editor", { action: "state" });
}

function stateNames(st: ToolResponse, rel: string): boolean {
  const b = rb(st);
  return st.ok && b.opened === true && (namesRel(b.relPath, rel) || namesRel(b.file, rel));
}

/** Every line of the current file (files here are 10 lines; one page of 200). */
async function editorRows(ctx: StepContext): Promise<{ rows: string[]; resp: ToolResponse }> {
  const r = await ctx.tool("wb_script_editor", { action: "getLines", start: 0, limit: 200 });
  const rows = Array.isArray(rb(r).rows) ? (rb(r).rows as unknown[]).map(S) : [];
  return { rows, resp: r };
}

function diskLines(ctx: StepContext, rel: string): string[] {
  return linesOf(ctx.deps.readBytes(abs(ctx.opts.sandboxDir, rel)).toString("utf-8"));
}

/**
 * Writes the planted text of a missing script (a missing file cannot be open). Never registered:
 * a script .c is not a resource the database registers (W6 fix-up 1, W3 run 1 w3-03:
 * RegisterResourceFile returned false, no .meta) and the Script Editor opens it by its plain path.
 */
async function plantScript(ctx: StepContext, rel: string): Promise<Raw | null> {
  if (ctx.deps.exists(abs(ctx.opts.sandboxDir, rel))) return null;
  ctx.write(rel, plantedText(rel));
  return { planted: rel };
}

/**
 * Why the battery refuses to open `rel`, or null: a file under _throwaway/ must exist on disk in
 * the sandbox (the W1 rule: a load of a missing file is never sent).
 */
export function missingFileRefusal(
  ctx: { opts: { sandboxDir: string }; deps: { exists(p: string): boolean } },
  rel: string,
): string | null {
  const r = rel.replace(/\\/g, "/");
  if (!r.startsWith(`${THROWAWAY}/`)) return null;
  if (ctx.deps.exists(abs(ctx.opts.sandboxDir, r))) return null;
  return `the file ${r} is not on disk under the sandbox: the open is not sent`;
}

async function openScript(ctx: StepContext, rel: string): Promise<{ ok: boolean; ev: Raw }> {
  const refusal = missingFileRefusal(ctx, rel);
  if (refusal) return { ok: false, ev: { refused: refusal } };
  const o = await ctx.tool("wb_script_editor", { action: "open", path: rel });
  const st = await seState(ctx);
  return { ok: o.ok && stateNames(st, rel), ev: { open: brief(o), state: brief(st) } };
}

/**
 * The planted script `rel` is the current file and its buffer holds the planted text: planted and
 * registered when absent, opened when not current, put back by replaceRange when a stop left an
 * edit in it. The one code path every script step starts with (a --from/--only run on a fresh
 * launch has the file and the text it expects).
 */
async function ensureScriptCurrent(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; ev: Raw; rows: string[] }> {
  const ev: Raw = {};
  const planted = await plantScript(ctx, rel);
  if (planted) ev.planted = planted;
  const st = await seState(ctx);
  if (!stateNames(st, rel)) {
    const o = await openScript(ctx, rel);
    ev.open = o.ev;
    if (!o.ok) return { ok: false, ev, rows: [] };
  }
  const { rows, resp } = await editorRows(ctx);
  if (!resp.ok) return { ok: false, ev: { ...ev, getLines: brief(resp) }, rows };
  const want = plantedLines(rel);
  if (!sameLines(rows, want)) {
    const count = rows.length && rows[rows.length - 1] === "" ? rows.length - 1 : rows.length;
    const fix = await ctx.tool(
      "wb_script_editor",
      { action: "replaceRange", start: 0, count, lines: want, expected: rows.slice(0, count) },
      { restore: true },
    );
    ev.restoredLeftover = brief(fix);
    const again = await editorRows(ctx);
    return { ok: fix.ok && sameLines(again.rows, want), ev, rows: again.rows };
  }
  return { ok: true, ev, rows };
}

/** A restorer that puts one line of `rel` back (registered before the edit is sent). */
function lineRestorer(ctx: StepContext, rel: string, line: number, text: string): void {
  ctx.debt.restorers.push({
    label: `${rel}:${line} back to its planted text`,
    fn: async () => {
      const st = await ctx.deps.tool("wb_script_editor", { action: "state" });
      if (!stateNames(st, rel)) return st;
      return ctx.deps.tool("wb_script_editor", { action: "setLine", line, text });
    },
  });
}

/** One Edit > Undo of a module through wb_module action; ok when ExecuteAction answered true. */
async function undoIn(
  ctx: StepContext,
  module: "ScriptEditor" | "LocalizationEditor",
): Promise<{ ok: boolean; resp: Raw | null }> {
  const r = await ctx.tool("wb_module", {
    action: "action",
    module,
    menuPath: ["Edit", "Undo"],
    // The ledger calls Edit > Undo mutating, so wb_module action dry-runs it without confirm
    // (menuRunGate, live-tools-b-1).
    confirm: true,
  });
  return { ok: r.ok && rb(r).result === true, resp: brief(r) };
}

/** Save of the current script when it lies under _throwaway/W3/ (else refused here, never sent). */
async function saveThrowawayScript(ctx: StepContext, rel: string): Promise<ToolResponse | null> {
  const st = await seState(ctx);
  if (!stateNames(st, rel) || !underW3(rb(st).relPath || rb(st).file)) return null;
  return ctx.tool("wb_script_editor", { action: "save", confirm: true });
}

// ── Shared step bodies: the string table ─────────────────────────────────────

async function locStatus(ctx: StepContext): Promise<ToolResponse> {
  return ctx.tool("wb_localization", { action: "status" });
}

function tableIs(st: ToolResponse, rel: string): boolean {
  return st.ok && namesRel(rb(st).table, rel);
}

/** Every Id of the open table (one page of 200; the tables here hold a handful). */
async function tableIds(ctx: StepContext): Promise<{ ids: string[]; resp: ToolResponse }> {
  const r = await ctx.tool("wb_localization", { action: "list", fields: ["Id"], limit: 200 });
  const rows = Array.isArray(rb(r).rows) ? (rb(r).rows as Raw[]) : [];
  return { ids: rows.map((x) => S(x.Id)), resp: r };
}

/** Deletes every W3_T_ item of the open table (a restore: each delete is a handler edit). */
async function sweepTemps(ctx: StepContext): Promise<{ found: string[]; deleted: string[] }> {
  const l = await ctx.tool("wb_localization", {
    action: "list",
    prefix: TEMP_PREFIX,
    fields: ["Id"],
    limit: 200,
  });
  const found = (Array.isArray(rb(l).rows) ? (rb(l).rows as Raw[]) : [])
    .map((x) => S(x.Id))
    .filter((id) => id.startsWith(TEMP_PREFIX));
  const deleted: string[] = [];
  for (const id of found) {
    const d = await ctx.tool("wb_localization", { action: "delete", id }, { restore: true });
    if (d.ok) deleted.push(id);
  }
  return { found, deleted };
}

/** Save of the open table when the handler knows it and it lies under _throwaway/W3/. */
async function saveThrowawayTable(ctx: StepContext): Promise<Raw | null> {
  const st = await locStatus(ctx);
  const table = S(rb(st).table);
  if (!st.ok || !table || !underW3(table)) return null;
  const sv = await ctx.tool("wb_localization", { action: "save", confirm: true });
  return { table: relOf(table), save: brief(sv), ok: sv.ok };
}

/**
 * The table `rel` opened in the String Editor (plain path, or `{GUID}path` with `guid`): refused
 * when the file is absent; the temp items of the open table swept first; when the handler refuses
 * MODAL_HAZARD over its own unsaved edits (nothing was sent to the engine), the open throwaway
 * table is saved and the open is sent once more. A table opened by hand is the hand's to close.
 */
async function openTable(
  ctx: StepContext,
  rel: string,
  guid = "",
): Promise<{ ok: boolean; byHand: boolean; ev: Raw; resp: ToolResponse | null }> {
  const refusal = missingFileRefusal(ctx, rel);
  if (refusal) return { ok: false, byHand: false, ev: { refused: refusal }, resp: null };
  const ev: Raw = {};
  const st = await locStatus(ctx);
  ev.statusBefore = brief(st);
  if (!guid && tableIs(st, rel)) return { ok: true, byHand: false, ev, resp: st };
  if (st.ok && S(rb(st).table)) ev.sweep = await sweepTemps(ctx);
  let o = await ctx.tool("wb_localization", { action: "open", path: `${guid}${rel}` });
  ev.open = brief(o);
  if (!o.ok && o.code === "MODAL_HAZARD" && /not saved/.test(S(o.message))) {
    ev.saveFirst = await saveThrowawayTable(ctx);
    if (field(ev.saveFirst, "ok") === true) {
      o = await ctx.tool("wb_localization", { action: "open", path: `${guid}${rel}` });
      ev.openAgain = brief(o);
    }
  }
  const byHand = !o.ok && o.code === "MODAL_HAZARD" && /not opened through open/.test(S(o.message));
  return { ok: o.ok && rb(o).opened === true, byHand, ev, resp: o };
}

/** The instruction when the String Editor holds a table the hand opened (the handler refuses it). */
export const HAND_CLOSE_INSTRUCTION =
  "the String Editor holds a table that was not opened through wb_localization open (the hand's File > New): the hand presses File > Save (Ctrl+S) in the String Editor, then closes the String Editor window with its title-bar X (never File > Exit); a save prompt is answered No / Don't Save (it is saved). Then resume";

/**
 * The work table (a byte copy of the hand-made fixture) is the open table and holds the seeds: the
 * copy written and registered when absent, opened when not open, the seeds inserted and saved when
 * missing. Stops when the fixture is absent (the prelude runs the hand step first) or when the
 * String Editor holds a table opened by hand.
 */
async function ensureWork(ctx: StepContext): Promise<Raw> {
  const sb = ctx.opts.sandboxDir;
  if (!ctx.deps.exists(abs(sb, FIXTURE_ST)))
    throw new StopBattery(
      "stopped",
      `${FIXTURE_ST} is absent: the hand makes it in ${HAND_STEP} (OD-1); resume --from w3-01-editors`,
    );
  const ev: Raw = {};
  if (!ctx.deps.exists(abs(sb, WORK_ST))) {
    ctx.write(WORK_ST, ctx.deps.readBytes(abs(sb, FIXTURE_ST)));
    ev.copied = true;
    const reg = await ctx.tool("wb_world", { action: "register", path: WORK_ST, confirm: true });
    ev.register = brief(reg);
  }
  const o = await openTable(ctx, WORK_ST);
  ev.open = o.ev;
  if (o.byHand)
    throw new StopBattery("stopped", `${HAND_CLOSE_INSTRUCTION} --from ${ctx.currentStep}`, ev);
  if (!o.ok)
    throw new StopBattery(
      "stopped",
      `the work table ${WORK_ST} did not open (${S(o.resp?.code)} ${S(o.resp?.message)}): no String Editor edit is sent`,
      ev,
    );
  const { ids } = await tableIds(ctx);
  const missing = SEED_IDS.filter((id) => !ids.includes(id));
  if (missing.length) {
    const ins: Raw = {};
    for (const id of missing)
      ins[id] = brief(
        await ctx.tool("wb_localization", {
          action: "insert",
          id,
          fields: ["Target_en_us"],
          values: [SEED_TEXT[id]],
        }),
      );
    ev.seeded = ins;
    ev.seedSave = await saveThrowawayTable(ctx);
  }
  return ev;
}

/** A restorer that deletes a temp item (registered before the insert is sent). */
function tempRestorer(ctx: StepContext, id: string): void {
  ctx.debt.restorers.push({
    label: `delete ${id}`,
    fn: async () => {
      const g = await ctx.deps.tool("wb_localization", { action: "get", id });
      return g.ok ? ctx.deps.tool("wb_localization", { action: "delete", id }) : g;
    },
  });
}

async function getItem(ctx: StepContext, id: string): Promise<ToolResponse> {
  return ctx.tool("wb_localization", { action: "get", id });
}

/** The columns of the open table (for the enum numbers and the field list). */
async function tableColumns(ctx: StepContext): Promise<{ columns: unknown; resp: ToolResponse }> {
  const c = await ctx.tool("wb_localization", { action: "columns" });
  return { columns: rb(c).columns, resp: c };
}

// ── Snapshot and net-zero ────────────────────────────────────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  root: string;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W3/ (.git included: compared like any path). */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W3Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W3_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

/** Writes the battery's before-snapshot into the sitting folder once; true when it did. */
export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W3Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
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

/**
 * The battery's own snapshot (else the runbook's copy of the pre-flight manifest, compared on its
 * declared paths only) against the sandbox now, outside _throwaway/W3/. Null: no snapshot.
 */
export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W3Deps, "exists" | "readBytes" | "listTree">,
): { source: string; declared: string[] | null; changed: string[] } | null {
  for (const name of [BATTERY_SNAPSHOT_FILE, SNAPSHOT_FILE]) {
    const snap = snapshotFiles(readJson<unknown>(join(sittingDir, name), deps));
    if (!snap) continue;
    const before = Object.fromEntries(
      Object.entries(snap.files).filter(([f]) => !f.startsWith(`${W3_ROOT}/`)),
    );
    let now = sandboxHashes(sandboxDir, deps);
    if (snap.declared) {
      const declared = snap.declared;
      now = Object.fromEntries(Object.entries(now).filter(([f]) => underDeclared(f, declared)));
    }
    return { source: name, declared: snap.declared, changed: changedFiles(before, now) };
  }
  return null;
}

/** The latest record of a step across every run folder of the sitting (a HANDOFF ends a run). */
export function sittingRecord(
  sittingDir: string,
  id: string,
  deps: Pick<W3Deps, "exists" | "readBytes" | "listTree">,
): (StepRecord & { runDir: string }) | null {
  const runs = [
    ...new Set(
      deps
        .listTree(sittingDir)
        .filter((f) => f.includes("/"))
        .map((f) => f.split("/")[0]!),
    ),
  ].sort();
  let out: (StepRecord & { runDir: string }) | null = null;
  for (const run of runs) {
    const r = readJson<StepRecord>(recordPath(join(sittingDir, run), id), deps);
    if (r) out = { ...r, runDir: run };
  }
  return out;
}

/**
 * The hand's latest answer file for `key` in any run folder of the sitting, or null. A resume
 * from the hand step (W3 fix-up 1: run 1 crashed after the hand answered) reuses it instead of
 * asking the hand again, when the fixture it made is on disk.
 */
export function priorHandAnswer(
  sittingDir: string,
  key: string,
  deps: Pick<W3Deps, "exists" | "readBytes" | "listTree">,
): { runDir: string; answer: Raw } | null {
  const name = basename(handFiles(sittingDir, key).answer);
  const runs = [
    ...new Set(
      deps
        .listTree(sittingDir)
        .filter((f) => f.endsWith(`/${name}`) && f.split("/").length === 2)
        .map((f) => f.split("/")[0]!),
    ),
  ].sort();
  let out: { runDir: string; answer: Raw } | null = null;
  for (const run of runs) {
    const a = readJson<Raw>(join(sittingDir, run, name), deps);
    if (a) out = { runDir: run, answer: a };
  }
  return out;
}

// ── Steps ────────────────────────────────────────────────────────────────────

const MEM_ROLLBACK =
  "each edit restored by Edit > Undo or by its before snapshot (setLine/replaceRange of the planted text, delete of the W3_T_ item); nothing is saved";

/** The hand's instruction for the OD-1 fixture (the full folder path is printed on the line). */
export function fixtureInstruction(sandboxDir: string): string {
  const folder = abs(sandboxDir, ST_DIR);
  return [
    `OD-1 fixture, by hand in the String Editor window (title "String Editor"; the battery opened it):`,
    `(1) File > New (Ctrl+N).`,
    `(2) In the "Create string table" dialog: the folder ${folder} (in the project EMCP2_sandbox: _throwaway/W3/st/), the name ${FIXTURE_NAME}; confirm with the dialog's Save / OK / Create button.`,
    `(3) In "Choose String Table Item class" (it has no OK button): double-click CustomStringTableItem (if it is not listed, the first class listed, and write its name as itemClass).`,
    `(3a) The info dialog "Create string table" ("StringTable successfully created. Don't forget to add it to project config in Workbench->Options.") follows: OK (it writes nothing; do not add the table to the project config).`,
    `(4) Any other dialog: record its exact title and text; answer it with the button that writes only under _throwaway/W3/ (Cancel / No when it would register the table in the project settings or write elsewhere); never Publish.`,
    `(5) File > Save (Ctrl+S) once (a "String table saved" toast shows).`,
    `(6) Close the String Editor window with its title-bar X (not File > Exit); run 1 raised no prompt; a save prompt, if one shows, is answered No / Don't Save (the table is saved) and recorded.`,
    `(7) Check both monitors: no dialog is left.`,
    `Then write {"done": true, "file": "<the path the dialog showed>", "itemClass": "CustomStringTableItem", "dialogs": [{"title": "...", "text": "...", "pressed": "..."}], "filesMade": ["<every file the editor said it made>"], "closed": true}; on a problem {"done": false, "why": "..."}`,
  ].join(" ");
}

export function buildSteps(): StepDef[] {
  return [
    // ── W3.0 setup ──
    {
      id: GATE_STEP,
      block: "W3.0",
      title: "the test-bed gate: EMCP_WB_Info names EMCP2_sandbox, build stamp, plant, snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; the plant record is in the sitting`,
      kill_criterion:
        "not the test bed: ABORTED, nothing else runs; a stamp mismatch or no plant: STOPPED",
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
        // The kernel's k-03 assertion (DEC-058: no shipped handler names the test bed; this does).
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
        if (!ctx.deps.exists(join(ctx.opts.sittingDir, PLANT_FILE)))
          throw new StopBattery(
            "stopped",
            `the sitting holds no ${PLANT_FILE}: run \`w3.live.ts plant\` first`,
            evidence,
          );
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        evidence.snapshot = BATTERY_SNAPSHOT_FILE;
        return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
      },
    },
    {
      id: "w3-01-editors",
      block: "W3.0",
      title:
        "open the Script Editor and the String Editor modules; the String Editor's status before any table",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "both modules open (wb_module open ok); status answers (NO_DOCUMENT or the table left open)",
      kill_criterion: `a module does not open: FAIL; ${WINDOW_KILL}`,
      side_effects: ["the Script Editor and String Editor windows open"],
      rollback: "none: opening a module edits nothing",
      probes: [],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        tc("wb_module", "open", { module: "ScriptEditor" }),
        tc("wb_module", "open", { module: "LocalizationEditor" }),
        tc("wb_localization", "status"),
      ],
      run: async (ctx) => {
        const se = await ctx.tool("wb_module", { action: "open", module: "ScriptEditor" });
        const le = await ctx.tool("wb_module", { action: "open", module: "LocalizationEditor" });
        const st = await locStatus(ctx);
        const evidence = { scriptEditor: brief(se), stringEditor: brief(le), status: brief(st) };
        const fails: string[] = [];
        if (!se.ok) fails.push(`ScriptEditor: ${se.code} ${se.message}`);
        if (!le.ok) fails.push(`LocalizationEditor: ${le.code} ${le.message}`);
        if (!st.ok && st.code !== "NO_DOCUMENT") fails.push(`status: ${st.code} ${st.message}`);
        return { ...verdictOf(fails, [], "both editors open"), evidence };
      },
    },
    {
      id: HAND_STEP,
      block: "W3.0",
      title: `OD-1: the hand makes ${FIXTURE_ST} with File > New in the String Editor, saves it and closes the window`,
      risk: "mutating",
      timeout_ms: HAND_WAIT_MS + 60_000,
      expected: `${FIXTURE_ST} on disk; no dialog left; nothing changed outside ${W3_ROOT}/ (the snapshot diff right after the hand)`,
      kill_criterion:
        "no hand answer, or the file absent: FAIL (every String Editor step then stops); a change outside the throwaway folder: FAIL (rollback puts the .gproj back from the plant's copy); a dialog left after the answer: HANDOFF",
      side_effects: [
        `${FIXTURE_ST} and whatever File > New makes beside it (its .meta, runtime tables)`,
      ],
      rollback:
        "`w3.live.ts rollback` removes _throwaway/W3/ after Workbench is closed and restores the .gproj when it changed",
      probes: [],
      writes: [`${ST_DIR}/`],
      handDriven: true,
      plan: () => [],
      run: async (ctx) => {
        const sb = ctx.opts.sandboxDir;
        const evidence: Raw = {};
        if (ctx.deps.exists(abs(sb, FIXTURE_ST))) {
          // A resume: the fixture the hand made is on disk; its earlier answer (if any) is the record.
          evidence.alreadyPresent = true;
          const prior = priorHandAnswer(ctx.opts.sittingDir, "w3-02-fixture", ctx.deps);
          if (prior) evidence.priorHand = { run: prior.runDir, ...prior.answer };
          return { status: "PASS", detail: `${FIXTURE_ST} is present: no hand step`, evidence };
        }
        ctx.deps.makeDir(abs(sb, ST_DIR));
        const answer = await awaitHand(ctx, "w3-02-fixture", fixtureInstruction(sb));
        evidence.hand = answer;
        const fails: string[] = [];
        if (!answer) fails.push("no hand answer within the wait");
        else if (answer.done !== true) fails.push(`the hand answered not done: ${S(answer.why)}`);
        const present = ctx.deps.exists(abs(sb, FIXTURE_ST));
        evidence.present = present;
        if (!present) fails.push(`${FIXTURE_ST} is not on disk`);
        evidence.stFolder = ctx.deps.listTree(abs(sb, ST_DIR));
        if (present) {
          const text = ctx.deps.readBytes(abs(sb, FIXTURE_ST)).toString("utf-8");
          evidence.fixtureHead = text.split(/\r?\n/).slice(0, 12);
        }
        const nz = netZeroDiff(ctx.opts.sittingDir, sb, ctx.deps);
        const outside = (nz?.changed ?? []).filter((f) => !NETZERO_TOLERATED.includes(f));
        evidence.changedOutside = outside;
        if (outside.length)
          fails.push(
            `File > New changed files outside ${W3_ROOT}/: ${outside.join(", ")} (rollback restores ${GPROJ_REL} from the plant's copy; anything else the main session restores)`,
          );
        return { ...verdictOf(fails, [], `the hand made ${FIXTURE_ST}`), evidence };
      },
    },
    {
      id: "w3-03-fixture-check",
      block: "W3.0",
      title: `the planted scripts written (plain files, never registered); the fixture's grammar read offline; the work copy ${WORK_ST} opened by its plain path and seeded; ${SCRIPTS.edit} opened (P-W3-08 plain half)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "every planted script on disk (no register: a .c is not a registrable resource, W6 fix-up 1); string_table inspect reads a StringTable root; open of the plain path answers opened true; three seeds inserted and saved; the edit script is the current file",
      kill_criterion: `the plain path does not open: P-W3-08 KILLED and every String Editor step stops; ${WINDOW_KILL}`,
      side_effects: [
        `${WORK_ST} (a byte copy of the fixture) with its .meta, seeded and saved`,
        `the planted scripts under ${SCRIPTS_DIR}/ (no .meta: a .c is not registered)`,
      ],
      rollback: "`w3.live.ts rollback` removes _throwaway/W3/",
      probes: ["P-W3-08"],
      writes: [`${SCRIPTS_DIR}/`, WORK_ST, `${ST_DIR}/`],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...SCRIPT_LIST.map((rel) => fileWritePlan(rel, "the planted text, only when absent")),
        tc("wb_world", "register", { path: FIXTURE_ST, confirm: true }),
        tc("string_table", "inspect", { path: FIXTURE_ST }),
        ...ensureWorkPlan(),
        ...openScriptPlan(SCRIPTS.edit),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        // A script .c is not registered: RegisterResourceFile answers false with no .meta (W3 run 1
        // w3-03, W6 fix-up 1); the Script Editor opens it by its plain path (w3-10 PASS, same run).
        const planted: string[] = [];
        for (const rel of SCRIPT_LIST) {
          if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, rel))) {
            ctx.write(rel, plantedText(rel));
            planted.push(rel);
          }
        }
        evidence.plantedScripts = planted;
        const regFix = await ctx.tool("wb_world", {
          action: "register",
          path: FIXTURE_ST,
          confirm: true,
        });
        evidence.registerFixture = brief(regFix);
        const insp = await ctx.tool("string_table", { action: "inspect", path: FIXTURE_ST });
        evidence.fixtureGrammar = brief(insp);
        if (!insp.ok)
          fails.push(`string_table inspect of the fixture: ${insp.code} ${insp.message}`);
        let opened = false;
        try {
          evidence.work = await ensureWork(ctx);
          opened = true;
        } catch (e) {
          if (!(e instanceof StopBattery)) throw e;
          evidence.work = { stop: e.message, ...e.evidence };
          const p = killed(
            "P-W3-08",
            { work: evidence.work },
            `the plain path ${WORK_ST} did not open: ${e.message}`,
          );
          throw new StopBattery(e.kind, e.message, { ...evidence, probe: p });
        }
        const o = await openScript(ctx, SCRIPTS.edit);
        evidence.openEdit = o.ev;
        if (!o.ok) fails.push(`${SCRIPTS.edit} did not become the current file`);
        const p = partial(
          "P-W3-08",
          { plainPathOpened: opened, open: field(evidence.work, "open") ?? null },
          "the plain path opens the table made by the editor; the {GUID} form in w3-44; the XML fixture of the 1.x template is not opened (OD-10 replaced the template, DEC-063, and an unparsable file may raise an engine dialog)",
        );
        return {
          ...verdictOf(fails, [p], "fixture, work table and scripts ready"),
          evidence,
          probes: [p],
        };
      },
    },

    // ── W3.1 reads ──
    {
      id: "w3-10-script-state",
      block: "W3.1",
      title:
        "wb_script_editor state and getLines (paged) on the planted edit script (P-W3-01, project half)",
      risk: "read-only",
      timeout_ms: TIMEOUTS.step,
      expected:
        "state: opened, relPath naming the script, inProject true, linesCount 10 or 11; getLines pages of 3 with a cursor read the planted text",
      kill_criterion:
        "inProject false for a project script (the path form cannot be classified): P-W3-01 KILLED, every line edit and save SKIPPED",
      side_effects: ["the edit script opened when it is not the current file"],
      rollback: "none",
      probes: ["P-W3-01"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.edit),
        tc("wb_script_editor", "state"),
        tc("wb_script_editor", "getLines", { start: 0, limit: 3 }),
        tc("wb_script_editor", "getLines", { cursor: "3:10", limit: 3 }),
      ],
      run: async (ctx) => {
        const cur = await ensureScriptCurrent(ctx, SCRIPTS.edit);
        const st = await seState(ctx);
        const p1 = await ctx.tool("wb_script_editor", { action: "getLines", start: 0, limit: 3 });
        const cursor = S(rb(p1).nextCursor);
        const p2 = cursor
          ? await ctx.tool("wb_script_editor", { action: "getLines", cursor, limit: 3 })
          : null;
        const b = rb(st);
        const evidence: Raw = {
          ensure: cur.ev,
          state: brief(st),
          page1: brief(p1),
          page2: brief(p2),
        };
        const fails: string[] = [];
        if (!cur.ok) fails.push("the planted script is not the current file with its planted text");
        const want = plantedLines(SCRIPTS.edit);
        const rows1 = Array.isArray(rb(p1).rows) ? (rb(p1).rows as unknown[]).map(S) : [];
        const rows2 = p2 && Array.isArray(rb(p2).rows) ? (rb(p2).rows as unknown[]).map(S) : [];
        if (!sameLines(rows1, want.slice(0, 3)))
          fails.push("page 1 is not lines 0..2 of the planted text");
        if (!cursor) fails.push("page 1 answered no nextCursor for a 10-line file");
        else if (!sameLines(rows2, want.slice(3, 6))) fails.push("page 2 is not lines 3..5");
        const observed = {
          relPath: b.relPath ?? null,
          file: b.file ?? null,
          inProject: b.inProject ?? null,
          linesCount: b.linesCount ?? null,
          link: b.link ?? null,
        };
        const p =
          b.inProject === true && namesRel(b.relPath || b.file, SCRIPTS.edit)
            ? partial(
                "P-W3-01",
                observed,
                "project half: the path names the script and classifies in the project; vanilla half in w3-15",
              )
            : killed(
                "P-W3-01",
                observed,
                `a project script reads inProject ${S(b.inProject)} with path '${S(b.relPath || b.file)}'`,
              );
        return {
          ...verdictOf(fails, [p], `state and paging read ${SCRIPTS.edit}`),
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w3-11-loc-reads",
      block: "W3.1",
      title:
        "wb_localization status, columns, list (paged), get by id and by index, selection on the work table (P-W3-09, P-W3-17, P-W3-15)",
      risk: "read-only",
      timeout_ms: TIMEOUTS.step,
      expected:
        "status names the work table, itemClass CustomStringTableItem (or the class the hand chose), total >= 3; columns hold Id and Target_en_us; list pages of 2; get by id and index agree; selection answers two int lists",
      kill_criterion:
        "Items empty while the table holds the seeds: P-W3-09 KILLED (list falls back to GetFilteredRows)",
      side_effects: ["the work table opened when it is not the open one"],
      rollback: "none",
      probes: ["P-W3-09", "P-W3-17", "P-W3-15"],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "status"),
        tc("wb_localization", "columns"),
        tc("wb_localization", "list", { limit: 2 }),
        tc("wb_localization", "list", { cursor: "2:3", limit: 2 }),
        tc("wb_localization", "get", { id: SEED_IDS[0] }),
        tc("wb_localization", "get", { index: 0 }),
        tc("wb_localization", "selection"),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        const st = await locStatus(ctx);
        const cols = await tableColumns(ctx);
        const l1 = await ctx.tool("wb_localization", { action: "list", limit: 2 });
        const cursor = S(rb(l1).nextCursor);
        const l2 = cursor
          ? await ctx.tool("wb_localization", { action: "list", cursor, limit: 2 })
          : null;
        const g1 = await getItem(ctx, SEED_IDS[0]);
        const g2 = await ctx.tool("wb_localization", {
          action: "get",
          index: Number(rb(g1).index ?? 0),
        });
        const sel = await ctx.tool("wb_localization", { action: "selection" });
        Object.assign(evidence, {
          status: brief(st),
          columns: brief(cols.resp),
          list1: brief(l1),
          list2: brief(l2),
          getById: brief(g1),
          getByIndex: brief(g2),
          selection: brief(sel),
        });
        const fails: string[] = [];
        const total = Number(rb(st).total);
        const names = columnNames(cols.columns);
        if (!tableIs(st, WORK_ST)) fails.push(`status names '${S(rb(st).table)}', not ${WORK_ST}`);
        if (!names.includes("Id") || !names.some((n) => n.startsWith("Target_")))
          fails.push(`columns lack Id or Target_*: ${names.join(", ")}`);
        if (!l1.ok || Number(rb(l1).total) !== total)
          fails.push("list total differs from status total");
        if (total > 2 && !cursor) fails.push("list of 2 answered no nextCursor");
        if (!g1.ok || fieldValue(g1, "Target_en_us") !== SEED_TEXT[SEED_IDS[0]])
          fails.push(`get ${SEED_IDS[0]} does not read its seed text`);
        if (!g2.ok || fieldValue(g2, "Id") !== SEED_IDS[0])
          fails.push("get by index names another item");
        if (!sel.ok) fails.push(`selection: ${sel.code} ${sel.message}`);
        const probes: ProbeResult[] = [];
        const itemClass = S(rb(st).itemClass);
        probes.push(
          total >= SEED_IDS.length && names.includes("Id")
            ? settled(
                "P-W3-09",
                { itemClass, total, columns: names },
                "GetTable is a StringTable whose Items list reads as the plugins read it",
              )
            : killed(
                "P-W3-09",
                { itemClass, total, columns: names },
                `Items reads ${total} items with the seeds in the table`,
              ),
        );
        probes.push(
          tableIs(st, WORK_ST)
            ? partial(
                "P-W3-17",
                { table: rb(st).table ?? null, message: rb(st).message ?? null },
                "the path is known for a table opened through open; a hand-opened table answers no path (the handler refuses its save NO_DOCUMENT)",
              )
            : killed(
                "P-W3-17",
                { table: rb(st).table ?? null },
                "status names no table after open",
              ),
        );
        probes.push(
          partial(
            "P-W3-15",
            { selected: rb(sel).selected ?? null, filtered: rb(sel).filtered ?? null },
            "selection read without a click; the filter half in w3-27",
          ),
        );
        return {
          ...verdictOf(fails, probes, `work table read: ${total} items, class ${itemClass}`),
          evidence,
          probes,
        };
      },
    },
    {
      id: "w3-12-st-reads",
      block: "W3.1",
      title:
        "string_table inspect, get, lint on the work and fixture tables, get/inspect/lookup on the base game's runtime table; ui_localization_audit's .st reader against the handler's Ids",
      risk: "read-only",
      timeout_ms: TIMEOUTS.step,
      expected:
        "inspect reads a byte-exact round trip; get lists the seeds; lint answers; the base game's en_us runtime table reads; lookup finds its first Id; readStIds equals the handler's Id list",
      kill_criterion: "an offline read refuses a table the engine wrote: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        tc("string_table", "inspect", { path: WORK_ST }),
        tc("string_table", "get", { path: WORK_ST, fields: "*" }),
        tc("string_table", "lint", { path: WORK_ST }),
        tc("string_table", "inspect", { path: FIXTURE_ST }),
        tc("string_table", "inspect", { path: "Language/localization.en_us.conf" }),
        tc("string_table", "get", { path: "Language/localization.en_us.conf", limit: 2 }),
        tc("string_table", "lookup", { ids: ["<first id>"] }),
        tc("ui_localization_audit", "audit", { tables: [WORK_ST] }),
        tc("wb_localization", "list", { fields: ["Id"], limit: 200 }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const call = async (k: string, args: Raw): Promise<ToolResponse> => {
          const r = await ctx.tool("string_table", args);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${r.code} ${r.message}`);
          return r;
        };
        const insp = await call("inspectWork", { action: "inspect", path: WORK_ST });
        if (insp.ok && rb(insp).byteExactRoundTrip !== true)
          fails.push("the work table does not round-trip byte-exact");
        const get = await call("getWork", { action: "get", path: WORK_ST, fields: "*" });
        const rows = Array.isArray(rb(get).rows) ? (rb(get).rows as Raw[]) : [];
        const offIds = rows.map((r) => S(r.Id));
        for (const id of SEED_IDS)
          if (!offIds.includes(id)) fails.push(`string_table get lacks ${id}`);
        await call("lintWork", { action: "lint", path: WORK_ST });
        await call("inspectFixture", { action: "inspect", path: FIXTURE_ST });
        await call("inspectGame", { action: "inspect", path: "Language/localization.en_us.conf" });
        const gg = await call("getGame", {
          action: "get",
          path: "Language/localization.en_us.conf",
          limit: 2,
        });
        const firstId = S(
          field((Array.isArray(rb(gg).rows) ? (rb(gg).rows as Raw[]) : [])[0], "Id"),
        );
        if (firstId) {
          const lk = await call("lookup", {
            action: "lookup",
            ids: [firstId],
            languages: ["en_us"],
          });
          evidence.lookupId = firstId;
          if (lk.ok && JSON.stringify(lk.readback ?? null).indexOf(firstId) < 0)
            fails.push(`lookup does not name ${firstId}`);
        } else fails.push("the base game's runtime table gave no first Id");
        const audit = await ctx.tool("ui_localization_audit", {
          action: "audit",
          tables: [WORK_ST],
        });
        evidence.audit = brief(audit);
        const { ids } = await tableIds(ctx);
        const stIds =
          (field(field(rb(audit), "stIds"), WORK_ST) as unknown[] | undefined)?.map(S) ?? [];
        evidence.handlerIds = ids;
        evidence.readStIds = stIds;
        if (!audit.ok) fails.push(`ui_localization_audit: ${audit.code} ${audit.message}`);
        else if (JSON.stringify([...stIds].sort()) !== JSON.stringify([...ids].sort()))
          fails.push("readStIds of the saved work table differs from the handler's Id list");
        return {
          ...verdictOf(fails, [], `offline reads agree with the editor (${ids.length} Ids)`),
          evidence,
        };
      },
    },
    {
      id: "w3-13-aliases-read",
      block: "W3.1",
      title:
        "the 1.x read names: getCurrentFile, getLine (1-based), getLinesCount, getTable, listLanguages",
      risk: "read-only",
      timeout_ms: TIMEOUTS.step,
      expected:
        "each answers with a DEC-061 mapped-name warning; getLine 1 is the planted line 0; getLinesCount equals state's count; getTable lists the seeds; listLanguages names en_us",
      kill_criterion: "an alias refuses: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.edit),
        tc("wb_script_editor", "state", {}, { toolAction: "getCurrentFile" }),
        tc("wb_script_editor", "getLines", { start: 0, limit: 1 }, { toolAction: "getLine" }),
        tc("wb_script_editor", "state", {}, { toolAction: "getLinesCount" }),
        ...ensureWorkPlan(),
        tc("wb_localization", "list", {}, { toolAction: "getTable" }),
        tc("wb_localization", "columns", {}, { toolAction: "listLanguages" }),
      ],
      run: async (ctx) => {
        const evidence: Raw = { ensure: (await ensureScriptCurrent(ctx, SCRIPTS.edit)).ev };
        const fails: string[] = [];
        const gcf = await ctx.tool("wb_script_editor", { action: "getCurrentFile" });
        const gl = await ctx.tool("wb_script_editor", { action: "getLine", line: 1 });
        const glc = await ctx.tool("wb_script_editor", { action: "getLinesCount" });
        evidence.work = await ensureWork(ctx);
        const gt = await ctx.tool("wb_localization", { action: "getTable" });
        const ll = await ctx.tool("wb_localization", { action: "listLanguages" });
        Object.assign(evidence, {
          getCurrentFile: brief(gcf),
          getLine: brief(gl),
          getLinesCount: brief(glc),
          getTable: brief(gt),
          listLanguages: brief(ll),
        });
        for (const [k, r] of Object.entries({ gcf, gl, glc, gt, ll }))
          if (!r.ok) fails.push(`${k}: ${r.code} ${r.message}`);
        if (gl.ok && S(rb(gl).lineText) !== plantedLines(SCRIPTS.edit)[0])
          fails.push("getLine 1 is not the planted first line");
        const langs = Array.isArray(rb(ll).languages) ? (rb(ll).languages as unknown[]).map(S) : [];
        if (ll.ok && !langs.includes("en_us")) fails.push(`listLanguages: ${langs.join(", ")}`);
        const rowIds = (Array.isArray(rb(gt).rows) ? (rb(gt).rows as Raw[]) : []).map((r) =>
          S(r.Id),
        );
        if (gt.ok && !SEED_IDS.every((id) => rowIds.includes(id)))
          fails.push("getTable lacks a seed");
        return { ...verdictOf(fails, [], "five 1.x read names answer"), evidence };
      },
    },
    {
      id: "w3-14-gated",
      block: "W3.1",
      title:
        "the GATED actions in their dry-run form: wb_script_editor close, wb_localization close and buildRuntime (no confirm)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: "each refuses GATED (recorded, not a failure); nothing reaches the engine",
      kill_criterion:
        "one answers ok as more than a dry run: FAIL (an un-gated close or build without its probe)",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        tc("wb_script_editor", "close", { confirm: false }),
        tc("wb_localization", "close", {}, { note: "refused GATED in TS: nothing is sent" }),
        tc("wb_localization", "buildRuntime", {}, { note: "refused GATED in TS: nothing is sent" }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        for (const [k, tool, args] of [
          ["scriptClose", "wb_script_editor", { action: "close" }],
          ["tableClose", "wb_localization", { action: "close" }],
          ["buildRuntime", "wb_localization", { action: "buildRuntime" }],
        ] as Array<[string, W3Tool, Raw]>) {
          const r = await ctx.tool(tool, args);
          evidence[k] = brief(r);
          if (r.ok && rb(r).dryRun !== true) fails.push(`${k} answered ok without a dry run`);
          else if (!r.ok && !recordOnly(r)) fails.push(`${k}: ${r.code} ${r.message}`);
        }
        return { ...verdictOf(fails, [], "close, close and buildRuntime GATED"), evidence };
      },
    },
    {
      id: "w3-15-jump",
      block: "W3.1",
      title: `jump to ${VANILLA_SYMBOL} (vanilla), ${PROJECT_SYMBOL} (project), ${MISSING_SYMBOL} (a miss); state after each (P-W3-05, P-W3-01 vanilla half); then the edit script again`,
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the two hits answer result true, a file and a line >= 0; the vanilla file reads inProject false, the project file inProject true; the miss answers false (or ITEM_NOT_FOUND) with no dialog",
      kill_criterion:
        "a dialog on the miss: HANDOFF, recorded as P-W3-05 KILLED by w3-85; a hit with no line: P-W3-05 KILLED (jump answers the file only)",
      side_effects: [
        "the Script Editor shows the vanilla and the handler file (read only, never edited)",
      ],
      rollback: "the edit script opened again",
      probes: ["P-W3-05", "P-W3-01"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        tc("wb_script_editor", "jump", { symbol: VANILLA_SYMBOL }),
        tc("wb_script_editor", "state"),
        tc("wb_script_editor", "jump", { symbol: PROJECT_SYMBOL }),
        tc("wb_script_editor", "state"),
        tc("wb_script_editor", "jump", { symbol: MISSING_SYMBOL }),
        tc("wb_script_editor", "state"),
        ...openScriptPlan(SCRIPTS.edit),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const one = async (symbol: string): Promise<Raw> => {
          const j = await ctx.tool("wb_script_editor", { action: "jump", symbol });
          const st = await seState(ctx);
          return {
            ok: j.ok,
            code: j.code ?? null,
            result: rb(j).result ?? null,
            relPath: rb(j).relPath ?? rb(st).relPath ?? null,
            line: rb(j).line ?? null,
            stateInProject: rb(st).inProject ?? null,
            stateRelPath: rb(st).relPath ?? null,
            stateFile: rb(st).file ?? null,
          };
        };
        const vanilla = await one(VANILLA_SYMBOL);
        const project = await one(PROJECT_SYMBOL);
        const miss = await one(MISSING_SYMBOL);
        Object.assign(evidence, { vanilla, project, miss });
        const back = await openScript(ctx, SCRIPTS.edit);
        evidence.back = back.ev;
        const fails: string[] = [];
        if (!back.ok) fails.push(`${SCRIPTS.edit} did not become current again`);
        const hit = (x: Raw): boolean => x.ok === true && x.result === true;
        const lined = (x: Raw): boolean => typeof x.line === "number" && (x.line as number) >= 0;
        const missOk =
          (miss.ok === true && miss.result === false) || miss.code === "ITEM_NOT_FOUND";
        const p5 =
          !hit(vanilla) || !hit(project)
            ? killed("P-W3-05", evidence, "a symbol that exists did not jump")
            : !lined(vanilla) || !lined(project)
              ? killed("P-W3-05", evidence, "a hit answers no line: jump answers the file only")
              : !missOk
                ? killed("P-W3-05", evidence, "the miss did not answer false")
                : settled(
                    "P-W3-05",
                    evidence,
                    "hits land on a file and line; the miss answers false, no dialog",
                  );
        const p1 =
          vanilla.stateInProject === false && S(vanilla.stateRelPath || vanilla.stateFile) !== ""
            ? partial(
                "P-W3-01",
                { vanilla, project },
                "vanilla half: the path form classifies outside the project",
              )
            : partial(
                "P-W3-01",
                { vanilla, project },
                "the vanilla file's state did not read inProject false with a path",
              );
        return { ...verdictOf(fails, [p5], "jump hits and miss"), evidence, probes: [p5, p1] };
      },
    },

    // ── W3.2 in-memory ──
    {
      id: "w3-20-script-undo",
      block: "W3.2",
      title:
        "setLine 7 of the edit script, read back, the disk unchanged, Edit > Undo of the Script Editor restores it (P-W3-06)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "setLine answers before/after; getLines 7 reads the new text; the file on disk is the planted text; one undo reads the planted line again (run 2: one undo read an empty line, so Undo is pressed again while it changes line 7, at most 3 presses; restored in more than one: PARTIAL)",
      kill_criterion:
        "the undo does not restore the line within 3 presses, or a press changes another line: P-W3-06 KILLED (the line is put back by setLine with its before text, the buffer by replaceRange; Script Editor edits then need confirm, OD-4)",
      side_effects: ["one line of the edit script changed in memory, then undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W3-06"],
      dependsOn: ["P-W3-01"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.edit),
        tc("wb_script_editor", "setLine", { line: 7, text: '\t\tPrint("EMCP W3 setLine");' }),
        tc("wb_script_editor", "getLines", { start: 7, limit: 1 }),
        ...undoPlan("ScriptEditor"),
        tc("wb_script_editor", "getLines", { start: 7, limit: 1 }),
        ...undoPlan(
          "ScriptEditor",
          "presses 2 and 3: only while the last press changed line 7 and it is not planted yet",
        ),
        tc(
          "wb_script_editor",
          "getLines",
          { start: 7, limit: 1 },
          { note: "after each further press" },
        ),
        tc(
          "wb_script_editor",
          "setLine",
          { line: 7 },
          { note: "only when the undo did not restore it" },
        ),
        ...readAllPlan(),
        tc(
          "wb_script_editor",
          "replaceRange",
          { start: 0 },
          { note: "only when a press changed another line: the planted text back" },
        ),
      ],
      run: async (ctx) => {
        const rel = SCRIPTS.edit;
        const cur = await ensureScriptCurrent(ctx, rel);
        const evidence: Raw = { ensure: cur.ev };
        if (!cur.ok) return { status: "FAIL", detail: "the edit script is not ready", evidence };
        const planted = plantedLines(rel)[7]!;
        const text = '\t\tPrint("EMCP W3 setLine");';
        lineRestorer(ctx, rel, 7, planted);
        const set = await ctx.tool("wb_script_editor", { action: "setLine", line: 7, text });
        const read = await ctx.tool("wb_script_editor", { action: "getLines", start: 7, limit: 1 });
        const disk = diskLines(ctx, rel);
        // Run 2: one Edit > Undo took the line from the new text to "" (neither the new nor the
        // planted text), so the edit is on the undo stack in more than one step. Undo is pressed
        // again only while the last press changed line 7 and it is not the planted text yet.
        const presses: { undo: { ok: boolean; resp: Raw | null }; line7: string }[] = [];
        let u: { ok: boolean; resp: Raw | null } | null = null;
        let after: ToolResponse | null = null;
        let afterText = text;
        for (let i = 0; set.ok && i < SCRIPT_UNDO_PRESSES_MAX; i++) {
          const prev = afterText;
          u = await undoIn(ctx, "ScriptEditor");
          after = await ctx.tool("wb_script_editor", { action: "getLines", start: 7, limit: 1 });
          afterText = S((rb(after).rows as unknown[] | undefined)?.[0]);
          presses.push({ undo: u, line7: afterText });
          if (!u.ok || afterText === planted || afterText === prev) break;
        }
        Object.assign(evidence, {
          set: brief(set),
          read: brief(read),
          diskLine7: disk[7],
          undo: u,
          presses,
          after: brief(after),
        });
        const fails: string[] = [];
        if (!set.ok) fails.push(`setLine: ${set.code} ${set.message}`);
        if (S(rb(set).before) !== planted) fails.push("setLine's before is not the planted line");
        if (S((rb(read).rows as unknown[] | undefined)?.[0]) !== text)
          fails.push("getLines 7 does not read the new text");
        if (!sameLines(disk, plantedLines(rel)))
          fails.push("the file on disk changed without a save");
        const restored = afterText === planted;
        let fix: ToolResponse | null = null;
        if (set.ok && !restored) {
          fix = await ctx.tool(
            "wb_script_editor",
            { action: "setLine", line: 7, text: planted },
            { restore: true },
          );
          evidence.restoreByBefore = brief(fix);
          if (!fix.ok) fails.push("the line could not be put back");
        }
        ctx.debt.restorers = [];
        // A press past the setLine would undo an earlier step's edit elsewhere in the buffer: the
        // whole buffer is read, and put back to the planted text when it differs.
        const whole = set.ok ? await editorRows(ctx) : null;
        const wholePlanted = whole ? sameLines(whole.rows, plantedLines(rel)) : true;
        if (whole && !wholePlanted) {
          const again = await ensureScriptCurrent(ctx, rel);
          evidence.restoreWhole = again.ev;
          if (!again.ok) fails.push("the edit script could not be put back to its planted text");
        }
        const pressText = presses.map((x) => JSON.stringify(x.line7)).join(" -> ");
        const observed = {
          undo: u,
          presses: presses.length,
          line7AfterEachPress: presses.map((x) => x.line7),
          afterText: restored ? "planted" : "not planted",
          wholeBufferPlanted: wholePlanted,
        };
        const p = !set.ok
          ? partial("P-W3-06", observed, "setLine failed: no undo was tried")
          : restored && presses.length === 1 && wholePlanted
            ? settled("P-W3-06", observed, "one Edit > Undo undoes one SetLineText")
            : restored && wholePlanted
              ? partial(
                  "P-W3-06",
                  observed,
                  `Edit > Undo restores a SetLineText in ${presses.length} steps, not one (line 7: ${pressText}): the tool does not offer undo as the restore`,
                )
              : killed(
                  "P-W3-06",
                  observed,
                  `Edit > Undo did not restore the line in ${presses.length} press(es) (ExecuteAction ${S(field(u?.resp, "readback") && field(field(u?.resp, "readback"), "result"))}; line 7: ${pressText}); restored from before`,
                );
        return { ...verdictOf(fails, [p], "setLine undone"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-21-script-lines",
      block: "W3.2",
      title:
        "insertLine 4 then removeLine 4 on the edit script: 0-based insert-before and remove-at, the disk unchanged (P-W3-02)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "after insert: line 4 is the new text, line 5 the old line 4, count + 1; after remove: count back, line 4 the old text; the disk never changes",
      kill_criterion:
        "off by one: P-W3-02 KILLED (the handler adjusts and documents it); a silent no-op: KILLED (insertLine/removeLine dropped)",
      side_effects: ["one line inserted in memory, then removed"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W3-02"],
      dependsOn: ["P-W3-01"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.edit),
        tc("wb_script_editor", "insertLine", { line: 4, text: "\t// EMCP W3 inserted" }),
        ...readAllPlan(),
        tc("wb_script_editor", "removeLine", { line: 4 }),
        ...readAllPlan(),
      ],
      run: async (ctx) => {
        const rel = SCRIPTS.edit;
        const cur = await ensureScriptCurrent(ctx, rel);
        const evidence: Raw = { ensure: cur.ev };
        if (!cur.ok) return { status: "FAIL", detail: "the edit script is not ready", evidence };
        const want = plantedLines(rel);
        const n0 = cur.rows.length;
        const text = "\t// EMCP W3 inserted";
        ctx.debt.restorers.push({
          label: `${rel}: the planted text back`,
          fn: async () => ctx.deps.tool("wb_script_editor", { action: "removeLine", line: 4 }),
        });
        const ins = await ctx.tool("wb_script_editor", { action: "insertLine", line: 4, text });
        const mid = await editorRows(ctx);
        const diskMid = diskLines(ctx, rel);
        const rem = ins.ok
          ? await ctx.tool("wb_script_editor", { action: "removeLine", line: 4 })
          : null;
        const end = await editorRows(ctx);
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          insert: brief(ins),
          mid: mid.rows,
          remove: brief(rem),
          end: end.rows,
        });
        const fails: string[] = [];
        const insertOk =
          ins.ok && mid.rows[4] === text && mid.rows[5] === want[4] && mid.rows.length === n0 + 1;
        const removeOk = !!rem?.ok && end.rows.length === n0 && sameLines(end.rows, want);
        if (!sameLines(diskMid, want)) fails.push("the file on disk changed without a save");
        if (!sameLines(end.rows, want)) {
          const fix = await ensureScriptCurrent(ctx, rel);
          evidence.repair = fix.ev;
          if (!fix.ok) fails.push("the planted text could not be put back");
        }
        const observed = {
          countBefore: n0,
          countAfterInsert: mid.rows.length,
          line4: mid.rows[4] ?? null,
          line5: mid.rows[5] ?? null,
          countAfterRemove: end.rows.length,
        };
        const p =
          insertOk && removeOk
            ? settled(
                "P-W3-02",
                observed,
                "InsertLine(n) inserts before n; RemoveLine(n) removes n; 0-based; disk unchanged",
              )
            : killed(
                "P-W3-02",
                observed,
                !ins.ok
                  ? `insertLine: ${ins.code} ${ins.message}`
                  : !insertOk
                    ? "insertLine is off by one or a no-op"
                    : "removeLine is off by one or a no-op",
              );
        return { ...verdictOf(fails, [p], "insert and remove round trip"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-22-script-replace",
      block: "W3.2",
      title:
        "replaceRange with a wrong expected (TEXT_CHANGED, nothing changed), then with the right one, then back from removed",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the wrong expected refuses TEXT_CHANGED and the text is unchanged; the right one answers removed and rows; the restore leaves the planted text",
      kill_criterion: "a wrong expected is not refused: FAIL",
      side_effects: ["line 3 replaced by two lines in memory, then put back"],
      rollback: MEM_ROLLBACK,
      probes: [],
      dependsOn: ["P-W3-01"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.edit),
        tc("wb_script_editor", "replaceRange", {
          start: 3,
          count: 1,
          lines: ["<2 lines>"],
          expected: ["<wrong>"],
        }),
        ...readAllPlan(),
        tc("wb_script_editor", "replaceRange", {
          start: 3,
          count: 1,
          lines: ["<2 lines>"],
          expected: ["<planted line 3>"],
        }),
        tc("wb_script_editor", "replaceRange", {
          start: 3,
          count: 2,
          lines: ["<removed>"],
          expected: ["<rows>"],
        }),
        ...readAllPlan(),
      ],
      run: async (ctx) => {
        const rel = SCRIPTS.edit;
        const cur = await ensureScriptCurrent(ctx, rel);
        const evidence: Raw = { ensure: cur.ev };
        if (!cur.ok) return { status: "FAIL", detail: "the edit script is not ready", evidence };
        const want = plantedLines(rel);
        const lines = ["\tint m_iValue = 2;", "\tint m_iOther = 3;"];
        const wrong = await ctx.tool("wb_script_editor", {
          action: "replaceRange",
          start: 3,
          count: 1,
          lines,
          expected: ["\tint m_iValue = 99;"],
        });
        const afterWrong = await editorRows(ctx);
        ctx.debt.restorers.push({
          label: `${rel}: lines 3..4 back to line 3`,
          fn: async () =>
            ctx.deps.tool("wb_script_editor", {
              action: "replaceRange",
              start: 3,
              count: 2,
              lines: [want[3]!],
              expected: lines,
            }),
        });
        const right = await ctx.tool("wb_script_editor", {
          action: "replaceRange",
          start: 3,
          count: 1,
          lines,
          expected: [want[3]!],
        });
        const removed = Array.isArray(rb(right).removed)
          ? (rb(right).removed as unknown[]).map(S)
          : [];
        const back = right.ok
          ? await ctx.tool(
              "wb_script_editor",
              {
                action: "replaceRange",
                start: 3,
                count: lines.length,
                lines: removed.length ? removed : [want[3]!],
                expected: lines,
              },
              { restore: true },
            )
          : null;
        const end = await editorRows(ctx);
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          wrong: brief(wrong),
          afterWrong: afterWrong.rows,
          right: brief(right),
          back: brief(back),
          end: end.rows,
        });
        const fails: string[] = [];
        if (wrong.ok || wrong.code !== "TEXT_CHANGED")
          fails.push(`a wrong expected answered ${wrong.ok ? "ok" : wrong.code}`);
        if (!sameLines(afterWrong.rows, want))
          fails.push("the refused replaceRange changed the text");
        if (!right.ok) fails.push(`replaceRange: ${right.code} ${right.message}`);
        else if (removed[0] !== want[3]) fails.push("removed is not the planted line 3");
        if (!sameLines(end.rows, want)) {
          const fix = await ensureScriptCurrent(ctx, rel);
          evidence.repair = fix.ev;
          fails.push("the restore from removed did not give the planted text back");
        }
        return { ...verdictOf(fails, [], "TEXT_CHANGED refused; replace and restore"), evidence };
      },
    },
    {
      id: "w3-23-loc-insert-undo",
      block: "W3.2",
      title: "insert W3_T_U1, read back, Edit > Undo of the String Editor removes it (P-W3-10)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "insert answers the Id at the end, total + 1; one undo: total back and get answers ITEM_NOT_FOUND",
      kill_criterion:
        "no undo: P-W3-10 KILLED (delete is the restore); the item at another place or Id: KILLED",
      side_effects: ["one item inserted in memory, then undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W3-10"],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "status"),
        tc("wb_localization", "insert", {
          id: `${TEMP_PREFIX}U1`,
          fields: ["Target_en_us"],
          values: ["Undo me"],
        }),
        tc("wb_localization", "get", { id: `${TEMP_PREFIX}U1` }),
        ...undoPlan("LocalizationEditor"),
        tc("wb_localization", "status"),
        tc("wb_localization", "get", { id: `${TEMP_PREFIX}U1` }),
        tc(
          "wb_localization",
          "delete",
          { id: `${TEMP_PREFIX}U1` },
          { note: "only when the undo left it" },
        ),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        evidence.sweep = await sweepTemps(ctx);
        const id = `${TEMP_PREFIX}U1`;
        const st0 = await locStatus(ctx);
        const n0 = Number(rb(st0).total);
        tempRestorer(ctx, id);
        const ins = await ctx.tool("wb_localization", {
          action: "insert",
          id,
          fields: ["Target_en_us"],
          values: ["Undo me"],
        });
        const g = await getItem(ctx, id);
        const u = ins.ok ? await undoIn(ctx, "LocalizationEditor") : null;
        const st1 = await locStatus(ctx);
        const g2 = await getItem(ctx, id);
        let del: ToolResponse | null = null;
        if (g2.ok)
          del = await ctx.tool("wb_localization", { action: "delete", id }, { restore: true });
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          insert: brief(ins),
          get: brief(g),
          undo: u,
          statusAfter: brief(st1),
          getAfter: brief(g2),
          restoreDelete: brief(del),
        });
        const fails: string[] = [];
        if (!ins.ok) fails.push(`insert: ${ins.code} ${ins.message}`);
        if (del && !del.ok) fails.push("the item could not be deleted again");
        const observed = {
          totalBefore: n0,
          insertIndex: rb(ins).index ?? null,
          insertTotal: rb(ins).total ?? null,
          totalAfterUndo: rb(st1).total ?? null,
          getAfterUndo: g2.ok ? "found" : S(g2.code),
          undo: u,
        };
        const atEnd =
          Number(rb(ins).total) === n0 + 1 &&
          Number(rb(ins).index) === n0 &&
          fieldValue(g, "Id") === id;
        const undone = !g2.ok && g2.code === "ITEM_NOT_FOUND" && Number(rb(st1).total) === n0;
        const p = !ins.ok
          ? killed("P-W3-10", observed, `InsertItem refused: ${ins.code}`)
          : !atEnd
            ? killed("P-W3-10", observed, "the item is not at the end with its Id")
            : undone
              ? settled(
                  "P-W3-10",
                  observed,
                  "InsertItem adds at the end inside BeginModify/EndModify; one undo removes it",
                )
              : killed(
                  "P-W3-10",
                  observed,
                  "Edit > Undo did not remove the item (deleted as the restore)",
                );
        return { ...verdictOf(fails, [p], "insert undone"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-24-loc-set-undo",
      block: "W3.2",
      title: `set Comment of ${SEED_IDS[0]}, read back, Edit > Undo restores it (P-W3-14)`,
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected: "set answers before and after; one undo: get reads the before value",
      kill_criterion: "no undo: P-W3-14 KILLED (set/insert/delete restore from before; OD-4)",
      side_effects: ["one field of a seed changed in memory, then undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W3-14"],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "get", { id: SEED_IDS[0] }),
        tc("wb_localization", "set", {
          id: SEED_IDS[0],
          fields: ["Comment"],
          values: ["EMCP W3 undo"],
        }),
        ...undoPlan("LocalizationEditor"),
        tc("wb_localization", "get", { id: SEED_IDS[0] }),
        tc(
          "wb_localization",
          "set",
          { id: SEED_IDS[0], fields: ["Comment"] },
          { note: "only when the undo did not restore it" },
        ),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        const id = SEED_IDS[0];
        const g0 = await getItem(ctx, id);
        const before = fieldValue(g0, "Comment");
        if (before === null)
          return {
            status: "NOT-RUN",
            detail: "the item has no Comment field",
            evidence: { ...evidence, get: brief(g0) },
            probes: [partial("P-W3-14", { columns: "no Comment" }, "no Comment field to edit")],
          };
        ctx.debt.restorers.push({
          label: `${id}.Comment back`,
          fn: async () =>
            ctx.deps.tool("wb_localization", {
              action: "set",
              id,
              fields: ["Comment"],
              values: [before],
            }),
        });
        const set = await ctx.tool("wb_localization", {
          action: "set",
          id,
          fields: ["Comment"],
          values: ["EMCP W3 undo"],
        });
        const u = set.ok ? await undoIn(ctx, "LocalizationEditor") : null;
        const g1 = await getItem(ctx, id);
        const now = fieldValue(g1, "Comment");
        let fix: ToolResponse | null = null;
        if (set.ok && now !== before)
          fix = await ctx.tool(
            "wb_localization",
            { action: "set", id, fields: ["Comment"], values: [before] },
            { restore: true },
          );
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          set: brief(set),
          undo: u,
          getAfter: brief(g1),
          restoreByBefore: brief(fix),
        });
        const fails: string[] = [];
        if (!set.ok) fails.push(`set: ${set.code} ${set.message}`);
        if (fix && !fix.ok) fails.push("Comment could not be put back");
        const observed = {
          setAfter: afterValue(set, "Comment"),
          afterUndoIsBefore: now === before,
          undo: u,
        };
        const p = !set.ok
          ? partial("P-W3-14", observed, "set failed: no undo was tried")
          : now === before
            ? settled("P-W3-14", observed, "Edit > Undo undoes a ModifyProperty")
            : killed(
                "P-W3-14",
                observed,
                "Edit > Undo did not restore the field (restored from before)",
              );
        return { ...verdictOf(fails, [p], "set undone"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-25-loc-encodings",
      block: "W3.2",
      title:
        "value encodings per field type on a temp item: string, int, bool (1 and true), enum number, array (P-W3-11)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "every set of a field the table has answers ok and reads back (the handler checks the readback: ENGINE_FALSE otherwise)",
      kill_criterion:
        "an encoding refused: P-W3-11 KILLED for that type (set refuses INVALID_ARGUMENT for it)",
      side_effects: ["the temp item W3_T_E1 inserted, set, then deleted"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W3-11"],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "columns"),
        tc("wb_localization", "insert", {
          id: `${TEMP_PREFIX}E1`,
          fields: ["Target_en_us"],
          values: ["Encodings"],
        }),
        tc("wb_localization", "set", {
          id: `${TEMP_PREFIX}E1`,
          fields: ["Comment"],
          values: ["EMCP W3 comment"],
        }),
        tc("wb_localization", "set", {
          id: `${TEMP_PREFIX}E1`,
          fields: ["MaxLength"],
          values: ["12"],
        }),
        tc("wb_localization", "set", {
          id: `${TEMP_PREFIX}E1`,
          fields: ["NonTranslatable"],
          values: ["1"],
        }),
        tc("wb_localization", "set", {
          id: `${TEMP_PREFIX}E1`,
          fields: ["NonTranslatable"],
          values: ["true"],
        }),
        tc("wb_localization", "set", {
          id: `${TEMP_PREFIX}E1`,
          fields: ["Status"],
          values: ["<DEVELOPMENT_PENDING>"],
        }),
        tc("wb_localization", "set", {
          id: `${TEMP_PREFIX}E1`,
          fields: ["Labels"],
          values: ["1,2"],
        }),
        tc("wb_localization", "get", { id: `${TEMP_PREFIX}E1` }),
        tc("wb_localization", "delete", { id: `${TEMP_PREFIX}E1` }),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        evidence.sweep = await sweepTemps(ctx);
        const id = `${TEMP_PREFIX}E1`;
        const { columns, resp: cr } = await tableColumns(ctx);
        evidence.columns = brief(cr);
        const names = columnNames(columns);
        const dev = enumNumber(columns, "Status", "DEVELOPMENT_PENDING");
        tempRestorer(ctx, id);
        const ins = await ctx.tool("wb_localization", {
          action: "insert",
          id,
          fields: ["Target_en_us"],
          values: ["Encodings"],
        });
        evidence.insert = brief(ins);
        const plan: Array<[string, string, string]> = [
          ["Comment", "string", "EMCP W3 comment"],
          ["MaxLength", "int", "12"],
          ["NonTranslatable", "bool", "1"],
          ["NonTranslatable", "bool", "true"],
          ["Status", "enum", dev ?? ""],
          ["Labels", "array", "1,2"],
        ];
        const per: Raw[] = [];
        for (const [f, kind, value] of plan) {
          if (!names.includes(f) || value === "") {
            per.push({ field: f, kind, sent: value, absent: true });
            continue;
          }
          const r = ins.ok
            ? await ctx.tool("wb_localization", { action: "set", id, fields: [f], values: [value] })
            : null;
          per.push({
            field: f,
            kind,
            sent: value,
            ok: r?.ok ?? null,
            code: r?.code ?? null,
            after: afterValue(r, f),
          });
        }
        const g = await getItem(ctx, id);
        const del = await ctx.tool("wb_localization", { action: "delete", id }, { restore: true });
        ctx.debt.restorers = [];
        Object.assign(evidence, { perField: per, get: brief(g), delete: brief(del) });
        const fails: string[] = [];
        if (!ins.ok) fails.push(`insert: ${ins.code} ${ins.message}`);
        if (!del.ok) fails.push(`the temp item was not deleted: ${del.code}`);
        const refused = per.filter((x) => x.ok === false);
        const absent = per.filter((x) => x.absent === true);
        const observed = { perField: per, statusEnum: { DEVELOPMENT_PENDING: dev } };
        const p = refused.length
          ? killed(
              "P-W3-11",
              observed,
              `refused: ${refused.map((x) => `${S(x.field)}=${S(x.sent)} (${S(x.code)})`).join(", ")}`,
            )
          : absent.length
            ? partial(
                "P-W3-11",
                observed,
                `not in the table: ${absent.map((x) => S(x.field)).join(", ")}`,
              )
            : settled(
                "P-W3-11",
                observed,
                "string as is, int ToString, bool 1/true, enum number, array comma-joined",
              );
        return { ...verdictOf(fails, [p], "encodings sent"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-26-loc-plugins",
      block: "W3.2",
      title:
        "the OnChange plugins on handler edits: Author/LastChanged/Modified after an insert at DEVELOPMENT_PENDING; Target_en_us at TRANSLATION_PENDING refused MODAL_HAZARD (P-W3-12)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "after the insert the item's Author and LastChanged are stamped (recorded as set or empty, never the value); Status set to TRANSLATION_PENDING answers ok; Target_en_us then refuses MODAL_HAZARD and is unchanged; no dialog",
      kill_criterion:
        "the plugins do not fire (Author and LastChanged empty): P-W3-12 KILLED (the MODAL_HAZARD precheck is dropped); a dialog: HANDOFF, recorded KILLED by w3-85; the precheck missing (set answers ok): FAIL",
      side_effects: ["the temp item W3_T_P1 inserted, set, then deleted"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W3-12"],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "columns"),
        tc("wb_localization", "insert", {
          id: `${TEMP_PREFIX}P1`,
          fields: ["Target_en_us"],
          values: ["Plugin alpha"],
        }),
        tc("wb_localization", "get", { id: `${TEMP_PREFIX}P1` }),
        tc("wb_localization", "set", {
          id: `${TEMP_PREFIX}P1`,
          fields: ["Status"],
          values: ["<TRANSLATION_PENDING>"],
        }),
        tc(
          "wb_localization",
          "set",
          { id: `${TEMP_PREFIX}P1`, fields: ["Target_en_us"], values: ["Plugin beta"] },
          { note: "must refuse MODAL_HAZARD before any engine call" },
        ),
        tc("wb_localization", "get", { id: `${TEMP_PREFIX}P1` }),
        tc("wb_localization", "delete", { id: `${TEMP_PREFIX}P1` }),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        evidence.sweep = await sweepTemps(ctx);
        const id = `${TEMP_PREFIX}P1`;
        const { columns, resp: cr } = await tableColumns(ctx);
        evidence.columns = brief(cr);
        const tp = enumNumber(columns, "Status", "TRANSLATION_PENDING");
        tempRestorer(ctx, id);
        const ins = await ctx.tool("wb_localization", {
          action: "insert",
          id,
          fields: ["Target_en_us"],
          values: ["Plugin alpha"],
        });
        const g1 = await getItem(ctx, id);
        const author = fieldValue(g1, "Author");
        const changed = fieldValue(g1, "LastChanged");
        const modified = fieldValue(g1, "Modified");
        const st =
          ins.ok && tp
            ? await ctx.tool("wb_localization", {
                action: "set",
                id,
                fields: ["Status"],
                values: [tp],
              })
            : null;
        const hz = st?.ok
          ? await ctx.tool("wb_localization", {
              action: "set",
              id,
              fields: ["Target_en_us"],
              values: ["Plugin beta"],
            })
          : null;
        const g2 = await getItem(ctx, id);
        const del = await ctx.tool("wb_localization", { action: "delete", id }, { restore: true });
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          insert: brief(ins),
          get: brief(g1),
          setStatus: brief(st),
          setTarget: brief(hz),
          getAfter: brief(g2),
          delete: brief(del),
        });
        const fails: string[] = [];
        if (!ins.ok) fails.push(`insert: ${ins.code} ${ins.message}`);
        if (!del.ok) fails.push(`the temp item was not deleted: ${del.code}`);
        if (hz && hz.ok)
          fails.push(
            "Target_en_us at TRANSLATION_PENDING answered ok: the MODAL_HAZARD precheck is missing",
          );
        if (hz && !hz.ok && hz.code !== "MODAL_HAZARD")
          fails.push(`Target_en_us at TRANSLATION_PENDING: ${hz.code}`);
        if (hz && fieldValue(g2, "Target_en_us") !== "Plugin alpha")
          fails.push("the refused edit changed Target_en_us");
        const observed = {
          authorSet: author !== null && author !== "",
          authorLength: author === null ? null : author.length,
          lastChangedSet: changed !== null && changed !== "",
          modified,
          translationPending: tp,
          targetAtTranslationPending: hz ? (hz.ok ? "ok" : S(hz.code)) : "not sent",
        };
        const fired = observed.authorSet || observed.lastChangedSet;
        const p = !ins.ok
          ? partial("P-W3-12", observed, "the insert failed: nothing observed")
          : fired
            ? hz
              ? settled(
                  "P-W3-12",
                  observed,
                  "SCR_LocModifiedPlugin stamps Author/LastChanged on handler edits (OD-5 warning kept); the status precheck refuses the dialog case",
                )
              : partial(
                  "P-W3-12",
                  observed,
                  "the plugins fire; the TRANSLATION_PENDING half was not sent (no enum number or the Status set failed)",
                )
            : killed(
                "P-W3-12",
                observed,
                "Author and LastChanged are empty after a handler edit: the plugins do not fire on ModifyProperty",
              );
        return { ...verdictOf(fails, [p], "plugins observed"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-27-loc-filter",
      block: "W3.2",
      title:
        "a temp row that does not match, then filter Id on the seed prefix without a click, then selection; a second filter widens the view again (P-W3-15)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        'with the temp row W3_T_F1 the table holds 4 rows; filtered holds exactly the three seed rows; selection\'s filtered equals it; the second filter ("_") answers all 4; the temp row deleted',
      kill_criterion:
        "the filter has no effect without a click: P-W3-15 KILLED (filter dropped, selection read-only)",
      side_effects: [
        "the temp item W3_T_F1 inserted, then deleted",
        "a user filter on the String Editor's view (no data change)",
      ],
      rollback:
        'a second, wider filter on Id ("_"); the filter is view state, never saved; the temp item deleted (a stop: its restorer, then the sweep)',
      probes: ["P-W3-15"],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "insert", {
          id: FILTER_TEMP_ID,
          fields: ["Target_en_us"],
          values: ["Filter decoy"],
        }),
        tc("wb_localization", "status"),
        tc("wb_localization", "filter", { column: "Id", filter: "EMCP_W3_SEED" }),
        tc("wb_localization", "selection"),
        tc("wb_localization", "filter", { column: "Id", filter: "_" }),
        tc("wb_localization", "delete", { id: FILTER_TEMP_ID }),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        // Fix-up 3: run 3's table held only the three seeds, so a filter on the seed prefix could
        // only answer 3 of 3 and the probe could not tell a filter from none (KILLED on a wrong
        // drive). A temp row that does not match makes the narrowing observable.
        tempRestorer(ctx, FILTER_TEMP_ID);
        const ins = await ctx.tool("wb_localization", {
          action: "insert",
          id: FILTER_TEMP_ID,
          fields: ["Target_en_us"],
          values: ["Filter decoy"],
        });
        evidence.insert = brief(ins);
        const st = await locStatus(ctx);
        const total = Number(rb(st).total);
        const f = await ctx.tool("wb_localization", {
          action: "filter",
          column: "Id",
          filter: "EMCP_W3_SEED",
        });
        const sel = await ctx.tool("wb_localization", { action: "selection" });
        const wide = await ctx.tool(
          "wb_localization",
          { action: "filter", column: "Id", filter: "_" },
          { restore: true },
        );
        const del = await ctx.tool(
          "wb_localization",
          { action: "delete", id: FILTER_TEMP_ID },
          { restore: true },
        );
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          status: brief(st),
          filter: brief(f),
          selection: brief(sel),
          widen: brief(wide),
          delete: brief(del),
        });
        const filtered = Array.isArray(rb(f).filtered) ? (rb(f).filtered as unknown[]) : [];
        const selFiltered = Array.isArray(rb(sel).filtered) ? (rb(sel).filtered as unknown[]) : [];
        const widened = Array.isArray(rb(wide).filtered) ? (rb(wide).filtered as unknown[]) : [];
        const fails: string[] = [];
        if (!ins.ok) fails.push(`insert of ${FILTER_TEMP_ID}: ${ins.code} ${ins.message}`);
        if (!f.ok) fails.push(`filter: ${f.code} ${f.message}`);
        if (!wide.ok) fails.push(`the widening filter: ${wide.code}`);
        if (!del.ok) fails.push(`the temp item was not deleted: ${del.code}`);
        const observed = {
          total,
          filtered: filtered.length,
          selectionFiltered: selFiltered.length,
          selected: rb(sel).selected ?? null,
          widened: widened.length,
        };
        const p = !ins.ok
          ? partial(
              "P-W3-15",
              observed,
              `no decoy row (${S(ins.code)}): the narrowing is not observable`,
            )
          : f.ok &&
              filtered.length === SEED_IDS.length &&
              filtered.length < total &&
              selFiltered.length === filtered.length
            ? settled(
                "P-W3-15",
                observed,
                "AddUserFilter + RefreshUI filter without a click; GetFilteredRows reads it",
              )
            : killed(
                "P-W3-15",
                observed,
                `the filter answered ${filtered.length} rows of ${total} for the ${SEED_IDS.length} seeds`,
              );
        return { ...verdictOf(fails, [p], "filter and selection"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-28-loc-delete-undo",
      block: "W3.2",
      title: `delete ${SEED_IDS[2]}, read back, Edit > Undo restores it (P-W3-13, P-W3-14)`,
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "delete answers the snapshot and total - 1; get answers ITEM_NOT_FOUND; one undo: the item is back with its text",
      kill_criterion:
        "the wrong item removed: P-W3-13 KILLED; no undo: P-W3-14 KILLED (the item is put back by insert of its snapshot)",
      side_effects: ["a seed deleted in memory, then undone"],
      rollback: MEM_ROLLBACK,
      probes: ["P-W3-13", "P-W3-14"],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "status"),
        tc("wb_localization", "delete", { id: SEED_IDS[2] }),
        tc("wb_localization", "get", { id: SEED_IDS[2] }),
        ...undoPlan("LocalizationEditor"),
        tc("wb_localization", "get", { id: SEED_IDS[2] }),
        tc(
          "wb_localization",
          "insert",
          { id: SEED_IDS[2] },
          { note: "only when the undo did not restore it (the delete's restore form)" },
        ),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        const id = SEED_IDS[2];
        const st0 = await locStatus(ctx);
        const n0 = Number(rb(st0).total);
        const del = await ctx.tool("wb_localization", { action: "delete", id });
        const restore = rb(del).restore as Raw | undefined;
        if (del.ok && restore)
          ctx.debt.restorers.push({
            label: `${id} back by insert`,
            fn: async () => ctx.deps.tool("wb_localization", restore),
          });
        const g1 = await getItem(ctx, id);
        const u = del.ok ? await undoIn(ctx, "LocalizationEditor") : null;
        const g2 = await getItem(ctx, id);
        let back: ToolResponse | null = null;
        if (del.ok && !g2.ok && restore)
          back = await ctx.tool("wb_localization", restore, { restore: true });
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          delete: brief(del),
          getAfterDelete: brief(g1),
          undo: u,
          getAfterUndo: brief(g2),
          restoreByInsert: brief(back),
        });
        const fails: string[] = [];
        if (!del.ok) fails.push(`delete: ${del.code} ${del.message}`);
        if (back && !back.ok) fails.push(`${id} could not be put back`);
        const removedRight =
          del.ok && rb(del).id === id && Number(rb(del).total) === n0 - 1 && !g1.ok;
        const undone = g2.ok && fieldValue(g2, "Target_en_us") === SEED_TEXT[id];
        const observed = {
          totalBefore: n0,
          deleteTotal: rb(del).total ?? null,
          deletedId: rb(del).id ?? null,
          getAfterDelete: g1.ok ? "found" : S(g1.code),
          afterUndo: g2.ok ? "found" : S(g2.code),
          undo: u,
        };
        const p13 = removedRight
          ? settled("P-W3-13", observed, "DeleteItem takes the Id and removes that item")
          : killed("P-W3-13", observed, "the delete did not remove exactly that item");
        const p14 = !del.ok
          ? partial("P-W3-14", observed, "the delete failed: no undo was tried")
          : undone
            ? settled("P-W3-14", observed, "Edit > Undo undoes a DeleteItem")
            : killed(
                "P-W3-14",
                observed,
                "Edit > Undo did not bring the item back (restored by insert)",
              );
        return { ...verdictOf(fails, [p13, p14], "delete undone"), evidence, probes: [p13, p14] };
      },
    },
    {
      id: "w3-29-aliases-mut",
      block: "W3.2",
      title:
        "the 1.x write names: openFile (the edit script), modify (en_us of a temp item), then the temp item deleted",
      risk: "reversible",
      timeout_ms: TIMEOUTS.step,
      expected:
        "openFile answers like open with the DEC-061 warning; modify sets Target_en_us (property en_us) and reads back",
      kill_criterion: "an alias refuses: FAIL",
      side_effects: ["the temp item W3_T_M1 inserted, modified, then deleted"],
      rollback: MEM_ROLLBACK,
      probes: [],
      writes: [],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        tc("wb_script_editor", "open", { path: SCRIPTS.edit }, { toolAction: "openFile" }),
        ...ensureWorkPlan(),
        tc("wb_localization", "insert", {
          id: `${TEMP_PREFIX}M1`,
          fields: ["Target_en_us"],
          values: ["Modify alpha"],
        }),
        tc(
          "wb_localization",
          "set",
          { id: `${TEMP_PREFIX}M1`, fields: ["Target_en_us"], values: ["Modify beta"] },
          { toolAction: "modify" },
        ),
        tc("wb_localization", "delete", { id: `${TEMP_PREFIX}M1` }),
      ],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const of = missingFileRefusal(ctx, SCRIPTS.edit)
          ? null
          : await ctx.tool("wb_script_editor", { action: "openFile", path: SCRIPTS.edit });
        evidence.openFile = brief(of);
        if (!of?.ok) fails.push(`openFile: ${S(of?.code)} ${S(of?.message)}`);
        evidence.work = await ensureWork(ctx);
        evidence.sweep = await sweepTemps(ctx);
        const id = `${TEMP_PREFIX}M1`;
        tempRestorer(ctx, id);
        const ins = await ctx.tool("wb_localization", {
          action: "insert",
          id,
          fields: ["Target_en_us"],
          values: ["Modify alpha"],
        });
        const mod = ins.ok
          ? await ctx.tool("wb_localization", {
              action: "modify",
              itemId: id,
              property: "en_us",
              value: "Modify beta",
            })
          : null;
        const g = await getItem(ctx, id);
        const del = await ctx.tool("wb_localization", { action: "delete", id }, { restore: true });
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          insert: brief(ins),
          modify: brief(mod),
          get: brief(g),
          delete: brief(del),
        });
        if (!ins.ok) fails.push(`insert: ${ins.code}`);
        if (!mod?.ok) fails.push(`modify: ${S(mod?.code)} ${S(mod?.message)}`);
        else if (fieldValue(g, "Target_en_us") !== "Modify beta")
          fails.push("modify did not read back");
        if (!del.ok) fails.push(`the temp item was not deleted: ${del.code}`);
        return { ...verdictOf(fails, [], "openFile and modify answer"), evidence };
      },
    },

    // ── W3.3 files ──
    {
      id: "w3-40-script-save",
      block: "W3.3",
      title: `save of ${SCRIPTS.saveA}: dry run writes nothing, confirm writes the edited line; the planted line saved back`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the dry run leaves the disk as planted; confirm either writes line 3 as edited (then the restore and a second save give the planted lines on disk) or answers ENGINE_FALSE and writes nothing (run 3: Save returned false for every script under _throwaway/W3/, the stated limit); the planted text on disk at the end",
      kill_criterion: `a save that answers ok and writes nothing or another text, or answers false and writes: FAIL; ${WINDOW_KILL}`,
      side_effects: [`${SCRIPTS.saveA} saved twice (throwaway)`],
      rollback: "the planted line saved back; `w3.live.ts rollback` removes the file",
      probes: [],
      dependsOn: ["P-W3-01"],
      writes: [SCRIPTS.saveA],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.saveA),
        tc("wb_script_editor", "setLine", { line: 3, text: "\tint m_iValue = 5;" }),
        tc("wb_script_editor", "save", {}, { document: SCRIPTS.saveA, note: "dry run" }),
        tc("wb_script_editor", "save", { confirm: true }, { document: SCRIPTS.saveA }),
        tc("wb_script_editor", "setLine", { line: 3, text: "\tint m_iValue = 1;" }),
        tc("wb_script_editor", "save", { confirm: true }, { document: SCRIPTS.saveA }),
      ],
      run: async (ctx) => {
        const rel = SCRIPTS.saveA;
        const cur = await ensureScriptCurrent(ctx, rel);
        const evidence: Raw = { ensure: cur.ev };
        if (!cur.ok) return { status: "FAIL", detail: `${rel} is not ready`, evidence };
        const planted = plantedLines(rel);
        lineRestorer(ctx, rel, 3, planted[3]!);
        const set = await ctx.tool("wb_script_editor", {
          action: "setLine",
          line: 3,
          text: "\tint m_iValue = 5;",
        });
        const dry = await ctx.tool("wb_script_editor", { action: "save" });
        const diskDry = diskLines(ctx, rel);
        const save = await saveThrowawayScript(ctx, rel);
        const diskSaved = diskLines(ctx, rel);
        const back = await ctx.tool(
          "wb_script_editor",
          { action: "setLine", line: 3, text: planted[3]! },
          { restore: true },
        );
        const save2 = await saveThrowawayScript(ctx, rel);
        const diskEnd = diskLines(ctx, rel);
        ctx.debt.restorers = [];
        Object.assign(evidence, {
          set: brief(set),
          dry: brief(dry),
          save: brief(save),
          back: brief(back),
          save2: brief(save2),
          diskLine3: { dry: diskDry[3], saved: diskSaved[3], end: diskEnd[3] },
        });
        const fails: string[] = [];
        if (!set.ok) fails.push(`setLine: ${set.code}`);
        if (!dry.ok || rb(dry).dryRun !== true)
          fails.push(`the dry run answered ${dry.ok ? "no dryRun" : dry.code}`);
        if (!sameLines(diskDry, planted)) fails.push("the dry run wrote the file");
        // Fix-up 3: run 3 answered ENGINE_FALSE for every planted script (edited or not, the tab
        // current), and the disk kept its text. A false save that wrote nothing is the limit the
        // tool states (ENGINE_FALSE, "nothing was written"), not a failure of the handler; a save
        // that answers one thing and does another is.
        const refusedHonestly =
          save !== null &&
          !save.ok &&
          save.code === "ENGINE_FALSE" &&
          sameLines(diskSaved, planted);
        evidence.saveLimit = refusedHonestly
          ? "Save returned false and wrote nothing (the stated limit)"
          : null;
        if (save === null)
          fails.push("save: not sent (the current file is not the planted script)");
        else if (save.ok && diskSaved[3] !== "\tint m_iValue = 5;")
          fails.push("save answered ok but the file does not hold the edited line");
        else if (!save.ok && !refusedHonestly)
          fails.push(
            `save: ${S(save.code)} ${S(save.message)} (the disk changed or the code is not ENGINE_FALSE)`,
          );
        if (!sameLines(diskEnd, planted)) fails.push("the planted text is not on disk at the end");
        return {
          ...verdictOf(
            fails,
            [],
            refusedHonestly
              ? "save refused ENGINE_FALSE, nothing written (the stated limit); the dry run wrote nothing"
              : "dry run, save and save back",
          ),
          evidence,
        };
      },
    },
    {
      id: "w3-41-script-save-scope",
      block: "W3.3",
      title: `two dirty tabs (${SCRIPTS.saveA}, ${SCRIPTS.saveB}), ${SCRIPTS.saveA} active, one save: which files are written (P-W3-03)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "only the active tab is written: A holds its edit on disk, B its planted text; both edits saved back to planted. When Save answers ENGINE_FALSE and writes nothing (run 3), P-W3-03 stays PARTIAL and the edits are put back in the buffers",
      kill_criterion:
        "both written: P-W3-03 KILLED (Save is editor-wide; save must refuse VALIDATION_FAILED over another dirty tab)",
      side_effects: [`${SCRIPTS.saveA} and ${SCRIPTS.saveB} saved (throwaway)`],
      rollback: "both put back to the planted text and saved; `w3.live.ts rollback` removes them",
      probes: ["P-W3-03"],
      dependsOn: ["P-W3-01"],
      writes: [SCRIPTS.saveA, SCRIPTS.saveB],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.saveA),
        tc("wb_script_editor", "setLine", { line: 3, text: "\tint m_iValue = 6;" }),
        ...scriptCurrentPlan(SCRIPTS.saveB),
        tc("wb_script_editor", "setLine", { line: 3, text: "\tint m_iValue = 7;" }),
        ...openScriptPlan(SCRIPTS.saveA),
        tc("wb_script_editor", "save", { confirm: true }, { document: SCRIPTS.saveA }),
        tc("wb_script_editor", "setLine", { line: 3 }),
        tc("wb_script_editor", "save", { confirm: true }, { document: SCRIPTS.saveA }),
        ...openScriptPlan(SCRIPTS.saveB),
        tc("wb_script_editor", "setLine", { line: 3 }),
        tc("wb_script_editor", "save", { confirm: true }, { document: SCRIPTS.saveB }),
      ],
      run: async (ctx) => {
        const A = SCRIPTS.saveA;
        const B = SCRIPTS.saveB;
        const evidence: Raw = {};
        const fails: string[] = [];
        const a0 = await ensureScriptCurrent(ctx, A);
        lineRestorer(ctx, A, 3, plantedLines(A)[3]!);
        const setA = a0.ok
          ? await ctx.tool("wb_script_editor", {
              action: "setLine",
              line: 3,
              text: "\tint m_iValue = 6;",
            })
          : null;
        const b0 = await ensureScriptCurrent(ctx, B);
        lineRestorer(ctx, B, 3, plantedLines(B)[3]!);
        const setB = b0.ok
          ? await ctx.tool("wb_script_editor", {
              action: "setLine",
              line: 3,
              text: "\tint m_iValue = 7;",
            })
          : null;
        const actA = await openScript(ctx, A);
        const save = actA.ok ? await saveThrowawayScript(ctx, A) : null;
        const diskA = diskLines(ctx, A);
        const diskB = diskLines(ctx, B);
        // Back to planted, both saved (the active tab first, then B).
        const backA = await ctx.tool(
          "wb_script_editor",
          { action: "setLine", line: 3, text: plantedLines(A)[3]! },
          { restore: true },
        );
        const saveA2 = await saveThrowawayScript(ctx, A);
        const actB = await openScript(ctx, B);
        const backB = actB.ok
          ? await ctx.tool(
              "wb_script_editor",
              { action: "setLine", line: 3, text: plantedLines(B)[3]! },
              { restore: true },
            )
          : null;
        const saveB2 = actB.ok ? await saveThrowawayScript(ctx, B) : null;
        ctx.debt.restorers = [];
        const endA = diskLines(ctx, A);
        const endB = diskLines(ctx, B);
        Object.assign(evidence, {
          ensureA: a0.ev,
          setA: brief(setA),
          ensureB: b0.ev,
          setB: brief(setB),
          activateA: actA.ev,
          save: brief(save),
          diskA3: diskA[3],
          diskB3: diskB[3],
          backA: brief(backA),
          saveA2: brief(saveA2),
          backB: brief(backB),
          saveB2: brief(saveB2),
        });
        if (!setA?.ok || !setB?.ok) fails.push("a setLine failed");
        // Fix-up 3: a false save that wrote neither file is the stated limit (w3-40) and leaves
        // P-W3-03 PARTIAL; a false save that wrote is a failure.
        const unchanged = diskA[3] === plantedLines(A)[3] && diskB[3] === plantedLines(B)[3];
        if (save === null) fails.push("save: not sent (the active file is not the planted script)");
        else if (!save.ok && !unchanged)
          fails.push(`save answered ${S(save.code)} but a file changed on disk`);
        else if (!save.ok && save.code !== "ENGINE_FALSE")
          fails.push(`save: ${S(save.code)} ${S(save.message)}`);
        if (!sameLines(endA, plantedLines(A)) || !sameLines(endB, plantedLines(B)))
          fails.push("a file is not planted again at the end");
        const observed = {
          activeWritten: diskA[3] === "\tint m_iValue = 6;",
          otherWritten: diskB[3] === "\tint m_iValue = 7;",
          saveWarnings: save?.warnings ?? [],
        };
        const p = !save?.ok
          ? partial("P-W3-03", observed, "the save failed: scope not observed")
          : observed.otherWritten
            ? killed("P-W3-03", observed, "Save wrote the other dirty tab too: Save is editor-wide")
            : observed.activeWritten
              ? settled("P-W3-03", observed, "only the active tab is written")
              : killed("P-W3-03", observed, "Save answered ok and wrote neither tab");
        return { ...verdictOf(fails, [p], "save scope observed"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-42-script-reload",
      block: "W3.3",
      title: `an offline write to ${SCRIPTS.reload} while it is the open tab, the Script Editor brought to the front: silent reload or a prompt (P-W3-07); then the tab activated again (and saved) to raise the "Reload" prompt here; when it comes later (cold run 1: in w3-61), w3-61 answers it as a planned hand request`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        'run 3: no reload within 6 s of the front; the planted text written back; then, on the tab\'s next activation (or its save), the "Reload" prompt (HANDOFF; w3-85 records P-W3-07 KILLED with its title); the hand presses Yes, which reloads the planted disk text and writes nothing',
      kill_criterion:
        "a modal prompt: HANDOFF, P-W3-07 KILLED (offline writers refuse MODAL_HAZARD on a file open in the Script Editor); the hand presses Yes and main resumes --from the next step",
      side_effects: [`${SCRIPTS.reload} written on disk twice by the battery (throwaway)`],
      rollback: "the planted text written back on disk; `w3.live.ts rollback` removes the file",
      probes: ["P-W3-07"],
      writes: [SCRIPTS.reload],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...scriptCurrentPlan(SCRIPTS.reload),
        fileWritePlan(SCRIPTS.reload, "line 3 changed on disk while the file is open"),
        tc(
          "wb_module",
          "front",
          { module: "ScriptEditor" },
          { target: "BringModuleWindowToFront", note: "the NET native, then EMCP_WB_Module info" },
        ),
        tc("wb_script_editor", "getLines", { start: 3, limit: 1 }),
        fileWritePlan(SCRIPTS.reload, "the planted text written back"),
        tc("wb_script_editor", "getLines", { start: 3, limit: 1 }),
        ...openScriptPlan(SCRIPTS.edit),
        ...openScriptPlan(SCRIPTS.reload),
        tc(
          "wb_script_editor",
          "save",
          { confirm: true },
          {
            document: SCRIPTS.reload,
            note: "only when no prompt came on the activation (run 3: the prompt came in w3-61 after this tab was opened and saved); the buffer is the planted text",
          },
        ),
      ],
      run: async (ctx) => {
        const rel = SCRIPTS.reload;
        const cur = await ensureScriptCurrent(ctx, rel);
        const evidence: Raw = { ensure: cur.ev };
        if (!cur.ok) return { status: "FAIL", detail: `${rel} is not ready`, evidence };
        const planted = plantedLines(rel);
        const changed = [...planted];
        changed[3] = "\tint m_iValue = 9; // changed on disk";
        ctx.debt.restorers.push({
          label: `${rel} planted on disk`,
          fn: async () => {
            ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, rel), plantedText(rel));
            return { ok: true };
          },
        });
        ctx.write(rel, Buffer.from(changed.join("\r\n") + "\r\n", "utf-8"));
        const front = await ctx.tool("wb_module", { action: "front", module: "ScriptEditor" });
        await ctx.sleep(TIMEOUTS.reloadWatch);
        const read = await ctx.tool("wb_script_editor", { action: "getLines", start: 3, limit: 1 });
        const line3 = S((rb(read).rows as unknown[] | undefined)?.[0]);
        ctx.write(rel, plantedText(rel));
        await ctx.sleep(TIMEOUTS.reloadWatch);
        const read2 = await ctx.tool("wb_script_editor", {
          action: "getLines",
          start: 3,
          limit: 1,
        });
        ctx.debt.restorers = [];
        const after = await editorRows(ctx);
        Object.assign(evidence, {
          front: brief(front),
          read: brief(read),
          read2: brief(read2),
          endRows: after.rows,
        });
        // Fix-up 3: run 3 raised the "Reload" prompt ("This file has been modified by another
        // program. Do you want to reload it?") only in w3-61, after this tab was opened again and
        // saved; nothing in this step raised it. So the prompt is raised here, where the hand's
        // answer (Yes) is planned: another tab, this tab again, a wait; then a save of it (its
        // buffer is the planted text, and so is the disk). The window poller cuts the step at the
        // prompt; the record's calls name the last call sent before it.
        const away = await openScript(ctx, SCRIPTS.edit);
        const back = await openScript(ctx, rel);
        await ctx.sleep(TIMEOUTS.reloadWatch);
        evidence.activate = { away: away.ev, back: back.ev, promptOnActivation: false };
        const sv = back.ok ? await saveThrowawayScript(ctx, rel) : null;
        await ctx.sleep(TIMEOUTS.reloadWatch);
        evidence.saveAfter = { save: brief(sv), promptOnSave: false };
        const fails: string[] = [];
        if (!read.ok) fails.push(`getLines: ${read.code}`);
        const reloaded = line3 === changed[3];
        const observed = {
          bufferAfterDiskWrite: reloaded
            ? "disk text (reloaded)"
            : line3 === planted[3]
              ? "old text (no reload)"
              : "other",
          bufferAfterWriteBack:
            S((rb(read2).rows as unknown[] | undefined)?.[0]) === planted[3] ? "planted" : "other",
          dialog: false,
          promptOnActivation: false,
          promptOnSave: false,
        };
        if (!sameLines(after.rows, planted) && reloaded)
          fails.push("the buffer did not follow the write-back");
        const p = reloaded
          ? settled("P-W3-07", observed, "a silent reload: no prompt; the buffer follows the disk")
          : partial(
              "P-W3-07",
              observed,
              "no prompt and no reload within 6 s of the front, of the tab's activation or of its save: the buffer kept its text (the disk is planted again, so buffer and disk agree); run 3's \"Reload\" prompt in w3-61 is not reproduced",
            );
        return { ...verdictOf(fails, [p], "offline write while open"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-43-loc-save",
      block: "W3.3",
      title: `save of the work table after an insert: dry run writes nothing, confirm writes the StringTable/Items text; the temp item deleted and saved again (P-W3-16)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the dry run warns OD-5 and leaves the file; confirm answers saved with no dialog; the file names W3_T_S1 inside StringTable { Items { ... } } (the exact diff, user name redacted); after the delete and save the Ids are those before",
      kill_criterion:
        "a dialog on save: HANDOFF (w3-85: P-W3-16 KILLED; save keeps its confirm, the dialog listed in warnings); another grammar: P-W3-16 KILLED (the offline writer follows the observed one)",
      side_effects: [`${WORK_ST} saved twice (throwaway)`],
      rollback:
        "the temp item deleted and the table saved again; `w3.live.ts rollback` removes the file",
      probes: ["P-W3-16"],
      writes: [WORK_ST],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_localization", "insert", {
          id: `${TEMP_PREFIX}S1`,
          fields: ["Target_en_us"],
          values: ["Saved alpha"],
        }),
        tc("wb_localization", "save", {}, { document: WORK_ST, note: "dry run" }),
        tc("wb_localization", "save", { confirm: true }, { document: WORK_ST }),
        tc("wb_localization", "delete", { id: `${TEMP_PREFIX}S1` }),
        tc("wb_localization", "save", { confirm: true }, { document: WORK_ST }),
        tc("string_table", "get", { path: WORK_ST }),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        evidence.sweep = await sweepTemps(ctx);
        evidence.saveFirst = await saveThrowawayTable(ctx);
        const file = abs(ctx.opts.sandboxDir, WORK_ST);
        const before = ctx.deps.readBytes(file).toString("utf-8");
        const id = `${TEMP_PREFIX}S1`;
        tempRestorer(ctx, id);
        const ins = await ctx.tool("wb_localization", {
          action: "insert",
          id,
          fields: ["Target_en_us"],
          values: ["Saved alpha"],
        });
        const dry = await ctx.tool("wb_localization", { action: "save" });
        const afterDry = ctx.deps.readBytes(file).toString("utf-8");
        const save = await saveThrowawayTable(ctx);
        const saved = ctx.deps.readBytes(file).toString("utf-8");
        const del = await ctx.tool("wb_localization", { action: "delete", id }, { restore: true });
        const save2 = await saveThrowawayTable(ctx);
        ctx.debt.restorers = [];
        const end = await ctx.tool("string_table", { action: "get", path: WORK_ST });
        const endIds = (Array.isArray(rb(end).rows) ? (rb(end).rows as Raw[]) : [])
          .map((r) => S(r.Id))
          .sort();
        const diff = exactLineDiff(before, saved);
        Object.assign(evidence, {
          insert: brief(ins),
          dry: brief(dry),
          save,
          delete: brief(del),
          save2,
          endIds,
          diff: {
            removed: diff.removed.length,
            added: diff.added.length,
            addedLines: diff.added.slice(0, 40),
          },
        });
        const fails: string[] = [];
        if (!ins.ok) fails.push(`insert: ${ins.code}`);
        if (!dry.ok || rb(dry).dryRun !== true)
          fails.push(`the dry run answered ${dry.ok ? "no dryRun" : dry.code}`);
        if (afterDry !== before) fails.push("the dry run wrote the file");
        if (!(dry.warnings ?? []).some((w) => /Author/.test(w)))
          fails.push("the dry run does not carry the OD-5 warning");
        if (field(save, "ok") !== true)
          fails.push(`save: ${JSON.stringify(field(save, "save") ?? null)}`);
        if (!del.ok) fails.push(`delete: ${del.code}`);
        const wantIds = [...SEED_IDS].sort();
        if (JSON.stringify(endIds) !== JSON.stringify(wantIds))
          fails.push(`the file's Ids at the end: ${endIds.join(", ")}`);
        const grammar =
          /^\s*StringTable\s*\{/m.test(saved) && /\bItems\s*\{/.test(saved) && saved.includes(id);
        const observed = {
          grammarStringTableItems: grammar,
          itemClassLine: (saved.match(/^\s*([A-Za-z_]+StringTableItem)\b/m) ?? [])[1] ?? null,
          addedLines: diff.added.length,
          removedLines: diff.removed.length,
          saveWarnings: field(field(save, "save"), "readback") ? (save as Raw) : null,
        };
        const p =
          field(save, "ok") !== true
            ? partial("P-W3-16", observed, "the save failed: no file text observed")
            : grammar
              ? settled(
                  "P-W3-16",
                  observed,
                  "Save writes StringTable { Items { <ItemClass> { Id ... } } }; the OnSave plugins ran with no dialog",
                )
              : killed(
                  "P-W3-16",
                  observed,
                  "the saved text is not the StringTable/Items grammar the offline writer uses",
                );
        return { ...verdictOf(fails, [p], "saved, diffed, saved back"), evidence, probes: [p] };
      },
    },
    {
      id: "w3-44-loc-paths",
      block: "W3.3",
      title: `the fixture opened by its {GUID}path form, status names it; the work table opened again by its plain path (P-W3-08 GUID half, P-W3-17)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "the GUID read from the fixture's .meta (or register); open answers opened; status names the fixture; the work table opens again",
      kill_criterion:
        "the GUID form does not open: P-W3-08 KILLED for that form; status names no path: P-W3-17 KILLED",
      side_effects: [
        "the work table saved before the switch (throwaway); the fixture opened, never edited",
      ],
      rollback: "none beyond the switch back",
      probes: ["P-W3-08", "P-W3-17"],
      writes: [WORK_ST],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc(
          "wb_world",
          "register",
          { path: FIXTURE_ST },
          { note: "dry run: the resource name when the .meta is not readable" },
        ),
        ...openTablePlan(FIXTURE_ST),
        tc("wb_localization", "status"),
        ...openTablePlan(WORK_ST),
        tc("wb_localization", "status"),
      ],
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        const meta = abs(ctx.opts.sandboxDir, `${FIXTURE_ST}.meta`);
        let guid = ctx.deps.exists(meta)
          ? guidOfMeta(ctx.deps.readBytes(meta).toString("utf-8"))
          : "";
        if (!guid) {
          const reg = await ctx.tool("wb_world", { action: "register", path: FIXTURE_ST });
          evidence.register = brief(reg);
          guid = guidOfMeta(S(rb(reg).resourceName));
        }
        evidence.guid = guid || null;
        const fails: string[] = [];
        const probes: ProbeResult[] = [];
        if (!guid) {
          probes.push(
            partial("P-W3-08", { guid: null }, "no GUID for the fixture: the {GUID} form not sent"),
          );
        } else {
          const o = await openTable(ctx, FIXTURE_ST, guid);
          const st = await locStatus(ctx);
          evidence.openGuid = o.ev;
          evidence.statusFixture = brief(st);
          probes.push(
            o.ok && tableIs(st, FIXTURE_ST)
              ? settled(
                  "P-W3-08",
                  { form: "{GUID}path", table: rb(st).table ?? null },
                  "both the plain and the {GUID} form open the editor-made table (XML half moot: OD-10)",
                )
              : killed(
                  "P-W3-08",
                  { form: "{GUID}path", open: brief(o.resp) },
                  "the {GUID}path form did not open the table",
                ),
          );
          probes.push(
            tableIs(st, FIXTURE_ST)
              ? settled(
                  "P-W3-17",
                  { table: rb(st).table ?? null, after: "{GUID} open" },
                  "the handler names the table it opened, in both path forms",
                )
              : killed(
                  "P-W3-17",
                  { table: rb(st).table ?? null },
                  "status names no path after the {GUID} open",
                ),
          );
        }
        const back = await openTable(ctx, WORK_ST);
        evidence.back = back.ev;
        if (!back.ok) fails.push("the work table did not open again");
        return { ...verdictOf(fails, probes, "path forms"), evidence, probes };
      },
    },
    {
      id: "w3-45-st-offline",
      block: "W3.3",
      title: `string_table create ${OFFLINE_ST}, upsert and remove on ${COPY_ST} (a byte copy of the work table), buildRuntime into ${RUNTIME_DIR}/; each a dry run first`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "every dry run writes nothing; create writes 2 items; the copy ends with SEED_A, SEED_B and UP_A; buildRuntime writes en_us and de_de tables that inspect reads",
      kill_criterion: "a dry run writes, or a write lands outside _throwaway/W3/: FAIL",
      side_effects: [`${OFFLINE_ST}, ${COPY_ST}, ${RUNTIME_LANGS.map(runtimeOf).join(", ")}`],
      rollback: "`w3.live.ts rollback` removes them",
      probes: [],
      writes: [OFFLINE_ST, COPY_ST, `${RUNTIME_DIR}/`],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("string_table", "inspect", { path: WORK_ST }),
        tc("string_table", "create", { path: OFFLINE_ST, overwrite: true }),
        tc("string_table", "create", { path: OFFLINE_ST, overwrite: true, confirm: true }),
        fileWritePlan(COPY_ST, "byte copy of the saved work table"),
        tc("string_table", "upsert", { path: COPY_ST }),
        tc("string_table", "upsert", { path: COPY_ST, confirm: true }),
        tc("string_table", "remove", { path: COPY_ST, ids: [SEED_IDS[2]] }),
        tc("string_table", "remove", { path: COPY_ST, ids: [SEED_IDS[2]], confirm: true }),
        tc("string_table", "buildRuntime", { path: COPY_ST, outDir: RUNTIME_DIR, overwrite: true }),
        tc("string_table", "buildRuntime", {
          path: COPY_ST,
          outDir: RUNTIME_DIR,
          overwrite: true,
          confirm: true,
        }),
        tc("string_table", "get", { path: COPY_ST }),
        ...RUNTIME_LANGS.map((l) => tc("string_table", "inspect", { path: runtimeOf(l) })),
        tc("string_table", "lint", { path: COPY_ST }),
      ],
      run: async (ctx) => {
        const sb = ctx.opts.sandboxDir;
        const evidence: Raw = { work: await ensureWork(ctx) };
        evidence.saveWork = await saveThrowawayTable(ctx);
        const fails: string[] = [];
        const st = async (k: string, args: Raw): Promise<ToolResponse> => {
          const r = await ctx.tool("string_table", args);
          evidence[k] = brief(r);
          if (!r.ok) fails.push(`${k}: ${r.code} ${r.message}`);
          return r;
        };
        const wi = await st("inspectWork", { action: "inspect", path: WORK_ST });
        const classes = Object.keys((rb(wi).itemClasses as Raw | undefined) ?? {});
        const itemClass = classes[0] || "CustomStringTableItem";
        evidence.itemClass = itemClass;
        const sha = (rel: string): string | null =>
          ctx.deps.exists(abs(sb, rel)) ? sha256(ctx.deps.readBytes(abs(sb, rel))) : null;
        const createArgs = {
          action: "create",
          path: OFFLINE_ST,
          items: OFFLINE_ITEMS.map((x) => ({ ...x })),
          itemClass,
          overwrite: true,
        };
        const o0 = sha(OFFLINE_ST);
        await st("createDry", createArgs);
        if (sha(OFFLINE_ST) !== o0) fails.push("create's dry run wrote");
        await st("create", { ...createArgs, confirm: true });
        ctx.write(COPY_ST, ctx.deps.readBytes(abs(sb, WORK_ST)));
        const c0 = sha(COPY_ST);
        const upArgs = { action: "upsert", path: COPY_ST, items: [{ ...UPSERT_ITEM }] };
        await st("upsertDry", upArgs);
        if (sha(COPY_ST) !== c0) fails.push("upsert's dry run wrote");
        await st("upsert", { ...upArgs, confirm: true });
        const c1 = sha(COPY_ST);
        const rmArgs = { action: "remove", path: COPY_ST, ids: [SEED_IDS[2]] };
        await st("removeDry", rmArgs);
        if (sha(COPY_ST) !== c1) fails.push("remove's dry run wrote");
        await st("remove", { ...rmArgs, confirm: true });
        const rtArgs = {
          action: "buildRuntime",
          path: COPY_ST,
          outDir: RUNTIME_DIR,
          languages: [...RUNTIME_LANGS],
          overwrite: true,
        };
        const r0 = RUNTIME_LANGS.map((l) => sha(runtimeOf(l)));
        await st("buildRuntimeDry", rtArgs);
        if (JSON.stringify(RUNTIME_LANGS.map((l) => sha(runtimeOf(l)))) !== JSON.stringify(r0))
          fails.push("buildRuntime's dry run wrote");
        await st("buildRuntime", { ...rtArgs, confirm: true });
        const g = await st("getCopy", { action: "get", path: COPY_ST });
        const ids = (Array.isArray(rb(g).rows) ? (rb(g).rows as Raw[]) : [])
          .map((r) => S(r.Id))
          .sort();
        const want = [SEED_IDS[0], SEED_IDS[1], UPSERT_ITEM.Id].sort();
        if (JSON.stringify(ids) !== JSON.stringify(want))
          fails.push(`the copy holds ${ids.join(", ")}`);
        for (const l of RUNTIME_LANGS) {
          const i = await st(`inspect_${l}`, { action: "inspect", path: runtimeOf(l) });
          if (i.ok && Number(rb(i).ids) !== want.length)
            fails.push(`${runtimeOf(l)} holds ${S(rb(i).ids)} ids`);
        }
        await st("lintCopy", { action: "lint", path: COPY_ST });
        const outside = ctx.deps
          .listTree(abs(sb, W3_ROOT))
          .map((f) => `${W3_ROOT}/${f}`)
          .filter((f) => !underW3(f));
        if (outside.length) fails.push(`written outside: ${outside.join(", ")}`);
        return {
          ...verdictOf(fails, [], "offline create, upsert, remove, buildRuntime"),
          evidence,
        };
      },
    },
    {
      id: "w3-46-st-accept",
      block: "W3.3",
      title: `the engine accepts the offline writes: ${OFFLINE_ST} and ${COPY_ST} registered and opened in the String Editor with the items written; the en_us runtime table registered and read by the container loader (P-W3-21)`,
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "register ok; both tables open and list exactly the written Ids and texts; wb_container describe of the runtime table answers rows; the work table opens again",
      kill_criterion:
        "a table rejected (open false, a load dialog, other Ids): P-W3-21 KILLED (offline writes refuse until the grammar is fixed, PLAN 11); the container read failing: PARTIAL (a proxy, not the game load)",
      side_effects: [".meta files of the offline writes; the tables opened, never edited"],
      rollback: "`w3.live.ts rollback` removes them",
      probes: ["P-W3-21"],
      writes: [`${ST_DIR}/`, `${RUNTIME_DIR}/`],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => [
        ...ensureWorkPlan(),
        tc("wb_world", "register", { path: OFFLINE_ST, confirm: true }),
        tc("wb_world", "register", { path: COPY_ST, confirm: true }),
        ...RUNTIME_LANGS.map((l) =>
          tc("wb_world", "register", { path: runtimeOf(l), confirm: true }),
        ),
        ...openTablePlan(OFFLINE_ST),
        tc("wb_localization", "list", { fields: ["Id", "Target_en_us"], limit: 200 }),
        ...openTablePlan(COPY_ST),
        tc("wb_localization", "list", { fields: ["Id", "Target_en_us"], limit: 200 }),
        tc("wb_container", "describe", { target: `path:${runtimeOf("en_us")}`, limit: 50 }),
        tc("string_table", "lookup", { path: runtimeOf("en_us"), ids: [SEED_IDS[0]] }),
        ...openTablePlan(WORK_ST),
      ],
      run: async (ctx) => {
        const sb = ctx.opts.sandboxDir;
        const evidence: Raw = { work: await ensureWork(ctx) };
        const fails: string[] = [];
        for (const rel of [OFFLINE_ST, COPY_ST, ...RUNTIME_LANGS.map(runtimeOf)])
          if (!ctx.deps.exists(abs(sb, rel)))
            return {
              status: "NOT-RUN",
              detail: `${rel} is absent: run w3-45 first`,
              evidence,
              probes: [partial("P-W3-21", { absent: rel }, "the offline writes are absent")],
            };
        const regs: Raw = {};
        for (const rel of [OFFLINE_ST, COPY_ST, ...RUNTIME_LANGS.map(runtimeOf)]) {
          const r = await ctx.tool("wb_world", { action: "register", path: rel, confirm: true });
          regs[rel] = brief(r);
          if (!r.ok) fails.push(`register ${rel}: ${r.code}`);
        }
        evidence.register = regs;
        const readTable = async (rel: string): Promise<{ ok: boolean; rows: Raw[]; ev: Raw }> => {
          const o = await openTable(ctx, rel);
          const l = o.ok
            ? await ctx.tool("wb_localization", {
                action: "list",
                fields: ["Id", "Target_en_us"],
                limit: 200,
              })
            : null;
          return {
            ok: o.ok && !!l?.ok,
            rows: Array.isArray(rb(l).rows) ? (rb(l).rows as Raw[]) : [],
            ev: { open: o.ev, list: brief(l) },
          };
        };
        const off = await readTable(OFFLINE_ST);
        const copy = await readTable(COPY_ST);
        evidence.offline = off.ev;
        evidence.copy = copy.ev;
        const offPairs = off.rows.map((r) => `${S(r.Id)}=${S(r.Target_en_us)}`).sort();
        const wantOff = OFFLINE_ITEMS.map((x) => `${x.Id}=${x.Target_en_us}`).sort();
        const copyIds = copy.rows.map((r) => S(r.Id)).sort();
        const wantCopy = [SEED_IDS[0], SEED_IDS[1], UPSERT_ITEM.Id].sort();
        const desc = await ctx.tool("wb_container", {
          action: "describe",
          target: `path:${runtimeOf("en_us")}`,
          limit: 50,
        });
        const lk = await ctx.tool("string_table", {
          action: "lookup",
          path: runtimeOf("en_us"),
          ids: [SEED_IDS[0]],
          languages: ["en_us"],
        });
        evidence.describe = brief(desc);
        evidence.lookup = brief(lk);
        const back = await openTable(ctx, WORK_ST);
        evidence.back = back.ev;
        if (!back.ok) fails.push("the work table did not open again");
        const observed = {
          offlineOpened: off.ok,
          offlineItems: offPairs,
          copyOpened: copy.ok,
          copyIds,
          runtimeDescribe: desc.ok ? "rows" : S(desc.code),
          runtimeLookup: lk.ok,
        };
        const stOk =
          off.ok &&
          copy.ok &&
          JSON.stringify(offPairs) === JSON.stringify(wantOff) &&
          JSON.stringify(copyIds) === JSON.stringify(wantCopy);
        const p = !stOk
          ? killed(
              "P-W3-21",
              observed,
              "the engine did not load an offline .st with the items written",
            )
          : desc.ok
            ? settled(
                "P-W3-21",
                observed,
                "the String Editor loads both offline tables with their items; the container loader reads the runtime table (a game-run Translate check is not hand-free)",
              )
            : partial(
                "P-W3-21",
                observed,
                `the .st half holds; the runtime table's container read answered ${S(desc.code)}`,
              );
        return { ...verdictOf(fails, [p], "offline writes accepted"), evidence, probes: [p] };
      },
    },

    // ── W3.4 language server ──
    {
      id: "w3-50-lsp-init",
      block: "W3.4",
      title:
        "the Workbench language server's answer to initialize, diagnostics, hover, completion (lsp-probe session plan); reported, never un-gating script_lsp (P-W3-23)",
      risk: "read-only",
      timeout_ms: TIMEOUTS.lsp,
      expected:
        "result ok with an InitializeResult whose capabilities name hover, definition, completion, signatureHelp; the shapes recorded (never server strings)",
      kill_criterion:
        "no answer or a null result, or no connection while the launch's ini sets LSP_Enabled=1: P-W3-23 KILLED (script_lsp stays GATED, its rows blocked:P-W3-23, U20 reopened). No connection without the owner's keys in the ini (run 3): NOT-RUN, P-W3-23 PARTIAL with preconditionAbsent, w3-51/52 SKIPPED",
      side_effects: [
        "one TCP session on 127.0.0.1:<LSP port>; an in-memory document under <sandbox>/Scripts/ that is never written",
      ],
      rollback: "none: the socket is closed; no file is written",
      probes: ["P-W3-23"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        {
          kind: "lsp",
          host: "127.0.0.1",
          port: LSP_DEFAULT_PORT,
          netPort: DEFAULT_PORT,
          plan: "session",
          methods: [
            "initialize",
            "initialized",
            "textDocument/didOpen",
            "textDocument/diagnostic",
            "textDocument/hover",
            "textDocument/completion",
          ],
          note: "scripts/live/lsp-probe.ts runLspPlan; the port is --lsp-port (default 5776)",
        } as unknown as PlanAction,
      ],
      run: async (ctx) => {
        const report = await ctx.deps.lsp("session");
        const msgs = Array.isArray(report.messages) ? (report.messages as Raw[]) : [];
        const init = msgs.find((m) => m.method === "initialize");
        const caps = field(init?.shape, "capabilities");
        const capKeys = Array.isArray(field(caps, "keys"))
          ? (field(caps, "keys") as unknown[]).map(S)
          : [];
        const gate = gateReason(process.env) ? "closed" : "open (set by the main session)";
        const evidence = { report, scriptLspGate: gate };
        const observed = {
          result: report.result ?? null,
          detail: report.detail ?? null,
          initializeAnswered: init?.answered ?? null,
          capabilityKeys: capKeys,
          diagnostics: report.diagnostics ?? null,
        };
        const ok = report.result === "ok" && init?.answered === true && capKeys.length > 0;
        // Fix-up 3: run 3 answered connect-failed (ECONNREFUSED: nothing listened on the port), and
        // that launch's ini (the sitting's scratch.ini) had no LSP_Enabled in [Workbench]: the
        // probe asks what the server answers WITH the keys set, so no listener without them is
        // not its kill. Recorded PARTIAL with preconditionAbsent, which skips w3-51/52 like a kill.
        const keys = lspKeysInIni(ctx);
        Object.assign(observed, { lspKeys: keys });
        const notRun = !ok && report.result === "connect-failed" && keys.enabled !== true;
        if (notRun) Object.assign(observed, { preconditionAbsent: true });
        const p = notRun
          ? partial(
              "P-W3-23",
              observed,
              `not run: no listener on the LSP port (${S(report.detail)}) and the launch's ini ${keys.ini ?? "(none found in the sitting)"} does not set LSP_Enabled=1 in [Workbench] (the owner's keys, runbook step 4): the probe's precondition is absent; script_lsp stays GATED`,
            )
          : ok
            ? settled(
                "P-W3-23",
                observed,
                `initialize answers capabilities (${capKeys.join(", ")}); script_lsp stays GATED until the main session sets ${GATE_ENV}=1`,
              )
            : killed(
                "P-W3-23",
                observed,
                `initialize answered ${S(report.result)}${report.detail ? ` (${S(report.detail)})` : ""}${keys.enabled === true ? ` with LSP_Enabled=1 in ${S(keys.ini)}` : ""}: script_lsp stays GATED`,
              );
        return {
          status: ok ? "PASS" : notRun ? "NOT-RUN" : "KILLED",
          detail: p.note,
          evidence,
          probes: [p],
        };
      },
    },
    {
      id: "w3-51-lsp-second",
      block: "W3.4",
      title:
        "a second LSP client while the first is held (lsp-probe second-client plan); NET still answers after (P-W3-25)",
      risk: "read-only",
      timeout_ms: TIMEOUTS.lsp,
      expected:
        "both clients answered initialize; wb_scripts status answers after the sockets close",
      kill_criterion:
        "the second client refused, or NET hurt: P-W3-25 KILLED (script_lsp single-use, BUSY when connected elsewhere). The shutdown/exit half is never sent (dry-run rule: shutdown and exit are refused on the live lane, Q8): PARTIAL at best",
      side_effects: ["two TCP sessions on 127.0.0.1:<LSP port>"],
      rollback: "none: both sockets closed",
      probes: ["P-W3-25"],
      dependsOn: ["P-W3-23"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        {
          kind: "lsp",
          host: "127.0.0.1",
          port: LSP_DEFAULT_PORT,
          netPort: DEFAULT_PORT,
          plan: "second-client",
          methods: ["initialize"],
          note: "scripts/live/lsp-probe.ts runLspPlan second-client",
        } as unknown as PlanAction,
        tc("wb_scripts", "status", {}, { target: "IsWorkbenchRunning" }),
      ],
      run: async (ctx) => {
        const report = await ctx.deps.lsp("second-client");
        const st = await ctx.tool("wb_scripts", { action: "status" });
        const evidence = { report, netAfter: brief(st) };
        const observed = {
          result: report.result ?? null,
          detail: report.detail ?? null,
          netAnswersAfter: st.ok,
        };
        const p =
          report.result === "ok" && st.ok
            ? partial(
                "P-W3-25",
                observed,
                "a second client is served and NET answers after; our shutdown/exit is not sent on the live lane",
              )
            : killed(
                "P-W3-25",
                observed,
                `second client: ${S(report.result)}; NET after: ${st.ok ? "ok" : S(st.code)}`,
              );
        const fails = st.ok ? [] : [`wb_scripts status after the LSP: ${st.code}`];
        return { ...verdictOf(fails, [p], p.note), evidence, probes: [p] };
      },
    },
    {
      id: "w3-52-lsp-tool",
      block: "W3.4",
      title: `script_lsp status, diagnostics, hover, definition, implementation, completion, signature on ${SCRIPTS.lsp} (P-W3-24); GATED answers recorded`,
      risk: "read-only",
      timeout_ms: TIMEOUTS.lsp,
      expected:
        "with the gate closed (the default): every action answers GATED and nothing connects; with the gate open: diagnostics within the wait, hover and definition non-null",
      kill_criterion:
        "diagnostics only on save: P-W3-24 KILLED (diagnostics falls back to wb_scripts validate); a null hover or definition: KILLED for that method",
      side_effects: [
        "with the gate open: one session kept until the process exits (never shutdown/exit, never didSave)",
      ],
      rollback: "none",
      probes: ["P-W3-24"],
      dependsOn: ["P-W3-23"],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () =>
        (
          [
            "status",
            "diagnostics",
            "hover",
            "definition",
            "implementation",
            "completion",
            "signature",
          ] as const
        ).map(
          (a) =>
            ({
              kind: "lsp",
              host: "127.0.0.1",
              port: LSP_DEFAULT_PORT,
              netPort: DEFAULT_PORT,
              plan: "session",
              hoverUri: `<sandbox>/${SCRIPTS.lsp}`,
              methods:
                a === "status"
                  ? ["initialize", "initialized"]
                  : a === "diagnostics"
                    ? ["textDocument/didOpen", "textDocument/diagnostic"]
                    : [
                        "textDocument/didOpen",
                        `textDocument/${a === "signature" ? "signatureHelp" : a}`,
                      ],
              tool: "script_lsp",
              toolAction: a,
              note: "the shipped ScriptLspHost; GATED (nothing sent) unless the main session set ENFUSION_SCRIPT_LSP=1",
            }) as unknown as PlanAction,
        ),
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        const planted = await plantScript(ctx, SCRIPTS.lsp);
        if (planted) evidence.planted = planted;
        const pos = { line: 7, character: 4 };
        const out: Raw = {};
        for (const a of [
          "status",
          "diagnostics",
          "hover",
          "definition",
          "implementation",
          "completion",
          "signature",
        ]) {
          const args: Raw =
            a === "status"
              ? { action: a }
              : a === "diagnostics"
                ? { action: a, path: SCRIPTS.lsp }
                : { action: a, path: SCRIPTS.lsp, ...pos };
          const r = await ctx.tool("script_lsp", args);
          out[a] = brief(r);
          if (!r.ok && !recordOnly(r) && r.code !== "LSP_OFF")
            fails.push(`${a}: ${r.code} ${r.message}`);
        }
        evidence.calls = out;
        const gated = Object.values(out).every((x) => field(x, "code") === "GATED");
        const init = ctx.prior("w3-50-lsp-init");
        const probeDiag = field(field(init?.evidence, "report"), "diagnostics") ?? null;
        const observed = { gated, fromLspProbe: { diagnostics: probeDiag } };
        let p: ProbeResult;
        if (gated)
          p = partial(
            "P-W3-24",
            observed,
            `script_lsp is GATED (the battery never opens it); the lsp-probe session saw diagnostics '${S(probeDiag)}'`,
          );
        else {
          const ok = (k: string): boolean => field(out[k], "ok") === true;
          const diagRows = field(field(out.diagnostics, "readback"), "rows");
          const nonNull = (k: string): boolean =>
            ok(k) && JSON.stringify(field(out[k], "readback") ?? null) !== "null";
          p = !ok("diagnostics")
            ? killed(
                "P-W3-24",
                { ...observed, diagnostics: field(out.diagnostics, "code") },
                "no diagnostics without a save",
              )
            : !nonNull("hover") || !nonNull("definition")
              ? killed(
                  "P-W3-24",
                  {
                    ...observed,
                    hover: field(out.hover, "code") ?? "ok",
                    definition: field(out.definition, "code") ?? "ok",
                  },
                  "hover or definition answered null",
                )
              : settled(
                  "P-W3-24",
                  {
                    ...observed,
                    diagnosticsRows: Array.isArray(diagRows) ? diagRows.length : null,
                  },
                  "diagnostics on didOpen; hover and definition answer",
                );
        }
        return {
          ...verdictOf(fails, [p], gated ? "script_lsp GATED (recorded)" : "script_lsp answered"),
          evidence,
          probes: [p],
        };
      },
    },

    // ── W3.5 last ──
    {
      id: "w3-60-validate",
      block: "W3.5",
      title: "wb_scripts status and validate WORKBENCH",
      risk: "read-only",
      timeout_ms: TIMEOUTS.step,
      expected: "status: running, handlers answer; validate answers its Success/Errors/Warnings",
      kill_criterion: "validate refuses: FAIL",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: W3_WINDOWS,
      plan: () => [
        tc("wb_scripts", "status", {}, { target: "IsWorkbenchRunning" }),
        tc("wb_scripts", "validate", { configuration: "WORKBENCH" }, { target: "ValidateScripts" }),
      ],
      run: async (ctx) => {
        const st = await ctx.tool("wb_scripts", { action: "status" });
        const v = await ctx.tool("wb_scripts", { action: "validate", configuration: "WORKBENCH" });
        const fails: string[] = [];
        if (!st.ok) fails.push(`status: ${st.code}`);
        if (!v.ok && v.code !== "VALIDATION_FAILED") fails.push(`validate: ${v.code} ${v.message}`);
        return {
          ...verdictOf(fails, [], `validate WORKBENCH: ${v.ok ? "ok" : S(v.code)}`),
          evidence: { status: brief(st), validate: brief(v) },
        };
      },
    },
    {
      id: "w3-61-settle",
      block: "W3.5",
      title:
        "settle the documents before the reload: temp items swept and the work table saved; every planted script saved, an edit put back still leaves its tab modified (all under _throwaway/W3/)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        'no W3_T_ item; the work table saved; each planted script saved (its buffer equals its disk text). The "Reload" prompt on EMCP_W3_Reload.c (run 3, regress2, cold run 1) is a planned hand request (hand-w3-61-reload): the hand presses Yes, the battery checks no dialog is left and goes on in this run folder (the step runs once more when the prompt cut it)',
      kill_criterion:
        'a document cannot be settled: FAIL (the close-out and the runbook\'s hand take over); a window other than "Reload", or "Reload" not cleared by the answer: HANDOFF',
      side_effects: [`${WORK_ST} and the planted scripts saved (throwaway)`],
      rollback: "`w3.live.ts rollback` removes them",
      probes: [],
      writes: [WORK_ST, `${SCRIPTS_DIR}/`],
      needsFixture: true,
      expectsWindows: W3_WINDOWS,
      plan: () => settlePlan(),
      run: async (ctx) => {
        const evidence: Raw = { work: await ensureWork(ctx) };
        const s = await settleDocuments(ctx);
        Object.assign(evidence, s.evidence);
        return { ...verdictOf(s.fails, [], "documents settled"), evidence };
      },
    },
    {
      id: "w3-62-reload",
      block: "W3.5",
      title: "wb_scripts reload, then status, wb_script_editor state and wb_localization status",
      risk: "mutating",
      timeout_ms: TIMEOUTS.step,
      expected:
        "reload ok; the handlers answer again (the String Editor handler forgets its open table: status answers it unknown)",
      kill_criterion:
        'the reload fails or the handlers do not answer: FAIL (DEC-044: the loaded handlers stay); the reload\'s progress window (owned, titled "Arma Reforger Workbench") is waited out up to 30 s, any other owned window or one that outlives that is a HANDOFF',
      side_effects: ["the Workbench scripts reloaded; the handlers' memory (the open table) reset"],
      rollback: "none: a reload changes no file",
      probes: [],
      writes: [],
      expectsWindows: W3_WINDOWS,
      // Run 3: the reload's progress window (Qt683QWindowIcon "Arma Reforger Workbench", owned)
      // handed off w3-62 mid-reload; it is graced for RELOAD_GRACE_MS, a dialog is not.
      reloadGrace: true,
      plan: () => [
        tc("wb_scripts", "reload", {}, { target: "ReloadScripts" }),
        tc("wb_scripts", "status", {}, { target: "IsWorkbenchRunning" }),
        tc("wb_script_editor", "state"),
        tc("wb_localization", "status"),
      ],
      run: async (ctx) => {
        const r = await ctx.tool("wb_scripts", { action: "reload" });
        const st = await ctx.tool("wb_scripts", { action: "status" });
        const se = await seState(ctx);
        const lo = await locStatus(ctx);
        const fails: string[] = [];
        if (!r.ok) fails.push(`reload: ${r.code} ${r.message}`);
        if (!st.ok) fails.push(`status: ${st.code}`);
        if (!se.ok) fails.push(`wb_script_editor state after the reload: ${se.code}`);
        if (!lo.ok && lo.code !== "NO_DOCUMENT")
          fails.push(`wb_localization status after the reload: ${lo.code}`);
        return {
          ...verdictOf(fails, [], "reloaded; handlers answer"),
          evidence: {
            reload: brief(r),
            status: brief(st),
            scriptState: brief(se),
            tableStatus: brief(lo),
          },
        };
      },
    },

    // ── W3.6 net-zero ──
    {
      id: "w3-85-handoffs",
      block: "W3.6",
      title:
        "the probes whose step ended in a HANDOFF this sitting: the dialog is the observation (P-W3-05, -07, -12, -16, -21)",
      risk: "read-only",
      timeout_ms: 30_000,
      expected:
        "for each such step: its latest record; a HANDOFF there records its probe KILLED with the dialog's title",
      kill_criterion: "none: a summary of the sitting's records",
      side_effects: [],
      rollback: "none",
      probes: Object.values(HANDOFF_PROBES),
      writes: [],
      plan: () => [],
      run: async (ctx) => {
        const probes: ProbeResult[] = [];
        const seen: Raw = {};
        for (const [step, probe] of Object.entries(HANDOFF_PROBES)) {
          const r = sittingRecord(ctx.opts.sittingDir, step, ctx.deps);
          seen[step] = r ? { status: r.status, run: r.runDir } : null;
          if (r?.status === "HANDOFF") {
            const title =
              S(field(field(r.evidence, "handAnswer"), "title")) ||
              (/"([^"]*)"/.exec(r.detail)?.[1] ?? "");
            probes.push(
              killed(probe, { step, title, run: r.runDir }, `a dialog "${title}" in ${step}`),
            );
          }
        }
        // Cold run 1 fix: the "Reload" prompt answered inline in w3-61 is the P-W3-07 observation
        // w3-42 did not make (a prompt, not a silent reload), unless w3-42 handed off on it itself.
        const settle = sittingRecord(ctx.opts.sittingDir, "w3-61-settle", ctx.deps);
        const pd = field(settle?.evidence, "plannedDialog");
        seen["w3-61-settle"] = settle ? { status: settle.status, run: settle.runDir } : null;
        if (pd && !probes.some((p) => p.id === "P-W3-07")) {
          const title = S(field(pd, "title"));
          probes.push(
            killed(
              "P-W3-07",
              { step: "w3-61-settle", title, run: settle!.runDir, answeredInline: true },
              `a dialog "${title}" in w3-61-settle, after w3-42's offline write (answered ${RELOAD_PROMPT.button} by the hand)`,
            ),
          );
        }
        return {
          status: probes.length ? "KILLED" : "PASS",
          detail: probes.length
            ? probes.map((p) => `${p.id}: ${p.note}`).join("; ")
            : "no HANDOFF in the sitting",
          evidence: { seen },
          probes,
        };
      },
    },
    {
      id: "w3-90-netzero",
      block: "W3.6",
      title: "the sandbox outside _throwaway/W3/ against the battery's snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `no file outside ${W3_ROOT}/ changed (a change of ${NETZERO_TOLERATED.join(", ")} is recorded)`,
      kill_criterion: "a file outside the throwaway folder changed: FAIL",
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
            detail: `${BATTERY_SNAPSHOT_FILE} is absent or unreadable (the gate takes it; check the sitting folder)`,
            evidence: {},
          };
        const bad = nz.changed.filter((f) => !NETZERO_TOLERATED.includes(f));
        const snapRaw = readJson<Raw>(join(ctx.opts.sittingDir, nz.source), ctx.deps);
        const evidence = {
          snapshot: nz.source,
          snapshotTakenBy: S(snapRaw?.taken_by) || null,
          snapshotTakenAt: S(snapRaw?.taken_at) || null,
          comparedOnlyDeclared: nz.declared,
          changed: nz.changed,
          outsideThrowaway: bad,
          tolerated: nz.changed.filter((f) => NETZERO_TOLERATED.includes(f)),
          gprojChanged: nz.changed.includes(GPROJ_REL),
        };
        const fails = bad.length
          ? [
              `changed outside ${W3_ROOT}/: ${bad.join(", ")}${evidence.gprojChanged ? ` (rollback restores ${GPROJ_REL} from the plant's copy)` : ""}`,
            ]
          : [];
        return {
          ...verdictOf(
            fails,
            [],
            `net-zero outside ${W3_ROOT}/ (${nz.changed.length} tolerated change(s))`,
          ),
          evidence,
        };
      },
    },
    closableStep(),
  ];
}

// ── Settling and the close-out ───────────────────────────────────────────────

function settlePlan(): PlanAction[] {
  return [
    tc("wb_localization", "status"),
    tc("wb_localization", "list", { prefix: TEMP_PREFIX }),
    tc("wb_localization", "delete", { id: `${TEMP_PREFIX}*` }, { note: "temp leftovers, if any" }),
    tc(
      "wb_localization",
      "save",
      { confirm: true },
      { document: WORK_ST, note: "only a table under _throwaway/W3/ the handler knows" },
    ),
    ...SCRIPT_LIST.flatMap((rel) => [
      ...openScriptPlan(rel),
      ...readAllPlan(),
      tc(
        "wb_script_editor",
        "save",
        { confirm: true },
        {
          document: rel,
          note: "every planted script on disk: a line put back still leaves its tab modified (run 2 close prompt)",
        },
      ),
    ]),
  ];
}

/**
 * Every battery document left with no unsaved edit: the temp items of the open table swept and the
 * table saved when it is a _throwaway/W3/ table the handler knows; each planted script on disk
 * opened and saved (an edit put back leaves the tab modified; run 2). Never throws for a refused call.
 */
async function settleDocuments(ctx: StepContext): Promise<{ fails: string[]; evidence: Raw }> {
  const fails: string[] = [];
  const evidence: Raw = {};
  const st = await locStatus(ctx);
  evidence.tableStatus = brief(st);
  const table = S(rb(st).table);
  if (st.ok && table) {
    evidence.sweep = await sweepTemps(ctx);
    if (underW3(table)) {
      const sv = await saveThrowawayTable(ctx);
      evidence.tableSave = sv;
      if (field(sv, "ok") !== true) fails.push(`the table ${relOf(table)} was not saved`);
    } else fails.push(`the open table '${table}' is not a battery table: not saved`);
  } else
    evidence.table = "no table the handler knows (opened by hand, or after a reload): nothing sent";
  const scripts: Raw = {};
  let allEqual = true;
  for (const rel of SCRIPT_LIST) {
    if (!ctx.deps.exists(abs(ctx.opts.sandboxDir, rel))) continue;
    const o = await openScript(ctx, rel);
    if (!o.ok) {
      scripts[rel] = { open: o.ev };
      continue;
    }
    const { rows } = await editorRows(ctx);
    const disk = diskLines(ctx, rel);
    // Run 2: every buffer read "buffer equals disk" here, yet closing Workbench raised "Script
    // editor - closing: Do you want to save changes?" for EMCP_W3_Edit.c: an edit put back by
    // setLine/replaceRange leaves the tab modified. No call reads that flag, so every throwaway
    // script is saved (its text is the disk text, or the buffer the battery left; both lie under
    // _throwaway/W3/). A refused or false save of an equal buffer is recorded, not a failure.
    // Fix-up 3: run 3's save answered ENGINE_FALSE for all five (equal buffers, the tab current),
    // so the save does not clear the modified flag, and wb_module action refuses File > Save All
    // (the refused word "save"). The close prompt is then expected and answered No by the hand;
    // that is safe only when every buffer equals its disk, recorded as closePromptNoIsSafe.
    const equal = sameLines(rows, disk);
    const sv = await saveThrowawayScript(ctx, rel);
    scripts[rel] = { bufferEqualsDisk: equal, saved: brief(sv) };
    if (!equal) allEqual = false;
    if (!sv?.ok && !equal) fails.push(`${rel} differs from its disk text and was not saved`);
  }
  evidence.scripts = scripts;
  evidence.closePromptNoIsSafe = allEqual;
  return { fails, evidence };
}

/**
 * The last step, also run after a stop: leave Workbench closable by one WM_CLOSE per window. A
 * document with unsaved edits does not exit on WM_CLOSE (DEC-045, W1 fix-up 1), so every battery
 * document is settled (all lie under _throwaway/W3/; nothing else is ever saved). Nothing is
 * closed: both close actions are GATED.
 */
export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W3.6",
    title:
      "leave Workbench closable: every battery document settled (saved only under _throwaway/W3/); no close is sent",
    risk: "reversible",
    timeout_ms: TIMEOUTS.step,
    expected:
      "no W3_T_ item, the open battery table saved, every planted script opened and its save sent; every buffer equals its disk text (closePromptNoIsSafe). Run 3: the save answers ENGINE_FALSE, so the Script Editor's close prompt is expected and the hand answers No (it discards nothing)",
    kill_criterion:
      "a document cannot be settled: FAIL (the runbook's hand answers any prompt with No / Don't Save)",
    side_effects: ["battery documents saved under _throwaway/W3/"],
    rollback: "none: only throwaway documents are saved",
    probes: [],
    writes: [WORK_ST, `${SCRIPTS_DIR}/`, `${ST_DIR}/`],
    expectsWindows: W3_WINDOWS,
    plan: () => settlePlan(),
    run: async (ctx) => {
      const s = await settleDocuments(ctx);
      return {
        ...verdictOf(s.fails, [], "closable: every battery document settled"),
        evidence: s.evidence,
      };
    },
  };
}

// ── Hand steps ───────────────────────────────────────────────────────────────

/**
 * Asks the main session's hand: writes the request file, logs one HAND REQUEST line with the full
 * answer path and polls for the answer file (JSON) up to HAND_WAIT_MS. Null when none came.
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

/** The engine's save prompt titles seen in W1 ("Loading world"); any title naming save counts. */
export const SAVE_PROMPT_TITLES: readonly string[] = ["Loading world"];

/**
 * What the main session's hand does with a HANDOFF window: the dialog's exact title, the button and
 * where main resumes. A dialog a W3 step may raise by design (STEP_DIALOG_ANSWERS) has its planned
 * answer and resumes at the next step (the dialog was the observation); the engine's save prompt
 * gets No (never Yes, never Cancel); anything else is recorded and never answered Save.
 */
export function handAnswer(
  message: string,
  stepId: string,
  steps: StepDef[] = buildSteps(),
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1]! : "";
  const entry = STEP_DIALOG_ANSWERS[stepId];
  // An entry that names a title answers only that window; any other window in the step falls
  // through to the default (cold run 1 fix: w3-61 plans "Reload" only).
  const planned = entry && (entry.title === undefined || entry.title === title) ? entry : undefined;
  const ids = steps.map((s) => s.id);
  const next = ids[ids.indexOf(stepId) + 1] ?? stepId;
  if (planned) {
    const resumeFrom = planned.resumeNext ? next : stepId;
    return {
      title,
      answer: planned.answer,
      resumeFrom,
      instruction: `hand: window "${title}": press ${planned.answer}; record the title and text; then resume --from ${resumeFrom} in a new run folder`,
    };
  }
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt ? "No" : "none planned: record the title and text; never Save";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `hand: the engine's save prompt "${title}": press No / Don't Save (never Yes, never Cancel), then resume ${resume}`
    : `hand: window "${title}": ${answer}; then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
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

/** `tool.action` names a step sends, from its plan (toolAction is the tool-level name). */
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

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: Script Editor and String Editor battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map(
      (s) =>
        `  [${s.block}] ${s.id} (${s.risk}${s.handDriven ? ", hand" : ""})${s.probes.length ? ` {${s.probes.join(", ")}}` : ""}: ${s.title}`,
    ),
    `  not testable hand-free: ${Object.keys(NOT_TESTABLE).join(", ") || "none"}`,
    `  not exercised: ${Object.keys(NOT_EXERCISED).join(", ") || "none"}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w3.live.ts --emit-queue` from its step table; tests/live-harness/w3-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W3 is not in PROBE_MUT_SESSIONS and sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w3-spec.md 2, 3, 6",
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

/**
 * The steps a run actually sends: the gate first whenever it is not selected (the test-bed check
 * and the snapshot run on every --from/--only), and the W3.0 fixture steps (both editors, the
 * hand-made table, the work copy) when a selected step needs the table and it is not on disk.
 */
export function withPrelude(
  selected: StepDef[],
  all: StepDef[],
  fixturePresent: boolean,
): StepDef[] {
  const want = new Set(selected.map((s) => s.id));
  want.add(GATE_STEP);
  if (!fixturePresent && selected.some((s) => s.needsFixture))
    for (const id of ["w3-01-editors", HAND_STEP, "w3-03-fixture-check"]) want.add(id);
  // The selected definitions win (a caller may pass its own); the prelude comes from the table.
  return all.filter((s) => want.has(s.id)).map((s) => selected.find((x) => x.id === s.id) ?? s);
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
  deps: Pick<W3Deps, "exists" | "readBytes">,
  steps: StepDef[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of steps) {
    const r = readJson<StepRecord>(recordPath(runDir, s.id), deps);
    for (const p of r?.probes ?? []) {
      if (p.result === "KILLED") out.set(p.id, `${p.id} KILLED in ${s.id}: ${p.note}`);
      // Fix-up 3: a probe whose precondition was absent (w3-50 with no LSP keys) blocks its
      // dependants like a kill: they would only meet the same absence.
      else if (p.observed?.preconditionAbsent === true)
        out.set(p.id, `${p.id} not run in ${s.id}: ${p.note}`);
    }
  }
  return out;
}

/** The launch ini names the runbook and run 3 used in the sitting folder, in order. */
export const LAUNCH_INI_NAMES: readonly string[] = ["w3-scratch.ini", "scratch.ini"];

/**
 * Whether the launch's ini sets `LSP_Enabled=1` in `[Workbench]` (the owner's keys, runbook step 4):
 * the first of LAUNCH_INI_NAMES in the sitting folder. `enabled` null when no ini is found.
 */
export function lspKeysInIni(ctx: {
  opts: { sittingDir: string };
  deps: Pick<W3Deps, "exists" | "readBytes">;
}): { ini: string | null; enabled: boolean | null; port: string | null } {
  for (const name of LAUNCH_INI_NAMES) {
    const path = join(ctx.opts.sittingDir, name);
    if (!ctx.deps.exists(path)) continue;
    let section = "";
    let enabled = false;
    let port: string | null = null;
    for (const raw of ctx.deps.readBytes(path).toString("utf-8").split(/\r?\n/)) {
      const line = raw.trim();
      const sec = /^\[(.*)\]$/.exec(line);
      if (sec) {
        section = sec[1]!;
        continue;
      }
      if (section !== "Workbench") continue;
      const kv = /^([^=]+)=(.*)$/.exec(line);
      if (!kv) continue;
      if (kv[1]!.trim() === "LSP_Enabled") enabled = ["1", "true"].includes(kv[2]!.trim());
      if (kv[1]!.trim() === "LSP_Port") port = kv[2]!.trim();
    }
    return { ini: name, enabled, port };
  }
  return { ini: null, enabled: null, port: null };
}

/** Runs a stopped step's restorers (in reverse) and sweeps the temp items. Never on a dialog or WEDGED. */
async function cleanupAfterStop(ctx: StepContext, deps: W3Deps): Promise<Raw> {
  const out: Raw = { restorers: [] as Raw[] };
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
  try {
    const st = await deps.tool("wb_localization", { action: "status" });
    if (st.ok && underW3(rb(st).table)) {
      const l = await deps.tool("wb_localization", {
        action: "list",
        prefix: TEMP_PREFIX,
        fields: ["Id"],
        limit: 200,
      });
      const ids = (Array.isArray(rb(l).rows) ? (rb(l).rows as Raw[]) : [])
        .map((x) => S(x.Id))
        .filter((id) => id.startsWith(TEMP_PREFIX));
      out.sweepFound = ids;
      for (const id of ids) await deps.tool("wb_localization", { action: "delete", id });
    }
  } catch (e) {
    out.sweepError = e instanceof Error ? e.message : String(e);
  }
  return out;
}

function makeContext(
  deps: W3Deps,
  opts: W3Options,
  prior: (id: string) => StepRecord | null,
  stepId: string,
  calls: Array<Record<string, unknown>>,
  debt: Debt,
  signal: AbortSignal,
  guard: (what: string) => void,
  onStop: (code: string) => void,
): StepContext {
  return {
    deps,
    opts,
    prior,
    calls,
    debt,
    signal,
    currentStep: stepId,
    sleep: async (ms) => {
      guard("sleep");
      await deps.sleep(ms);
      guard("sleep");
    },
    write: (rel, data) => {
      guard(`write ${rel}`);
      const r = rel.replace(/\\/g, "/");
      if (!r.startsWith(`${W3_ROOT}/`) || r.split("/").includes(".."))
        throw new StopBattery(
          "stopped",
          `refused: the battery writes only under ${W3_ROOT}/ (${rel})`,
        );
      deps.writeBytes(abs(opts.sandboxDir, r), data);
      calls.push({ write: r, bytes: data.length, sha256: sha256(data) });
    },
    tool: async (name, args) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.tool(name, args);
      calls.push({ tool: name, args, ok: r.ok, code: r.code ?? null });
      if (!r.ok && STOP_CODES.has(S(r.code))) {
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

/** The closable step after a stop: no window poll, no stop codes thrown; its record is written. */
async function closeOutAfterStop(
  deps: W3Deps,
  opts: W3Options,
  prior: (id: string) => StepRecord | null,
  write: (r: StepRecord) => void,
): Promise<void> {
  const def = closableStep();
  const startedAt = new Date(deps.now()).toISOString();
  const calls: Array<Record<string, unknown>> = [];
  const ctx = makeContext(
    deps,
    opts,
    prior,
    def.id,
    calls,
    { restorers: [] },
    new AbortController().signal,
    () => undefined,
    () => undefined,
  );
  ctx.tool = async (name, args) => {
    const r = await deps.tool(name, args);
    calls.push({ tool: name, args, ok: r.ok, code: r.code ?? null });
    return r;
  };
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
 * A hand step: refused over a dialog already up, then run with no window poll (the editor's own
 * dialogs are what the hand works in), then a HANDOFF when a dialog-like window is left.
 */
async function handWatched<T>(deps: W3Deps, pid: number, fn: () => Promise<T>): Promise<T> {
  const before = baselineRefusal(await deps.windows(), pid);
  if (before) throw new StopBattery("handoff", before);
  const value = await fn();
  const after = baselineRefusal(await deps.windows(), pid);
  if (after) throw new StopBattery("handoff", `after the hand step: ${after}`);
  return value;
}

/**
 * The step's planned dialog when it is the only non-busy dialog-like window of the pid now up:
 * exact title and class, owned, enabled. A busy window beside it (cold run 1: the disabled tool
 * window "Arma Reforger Workbench") is the modal's doing. Null: any other window, or none.
 */
export function plannedDialogUp(
  windows: readonly WindowInfo[],
  pid: number,
  p: PlannedDialog,
): WindowInfo | null {
  const dialogs = windows.filter((w) => w.pid === pid && isDialogWindow(w) && !isBusyWindow(w));
  if (dialogs.length !== 1) return null;
  const w = dialogs[0]!;
  return w.title === p.title && w.className === p.className && w.owner !== 0 && w.enabled !== false
    ? w
    : null;
}

/** How many window checks (TIMEOUTS.poll apart) the dialog may take to go after the answer. */
export const PLANNED_CLEAR_CHECKS = 6;

/**
 * Asks the hand to answer a planned dialog: the request file and one HAND REQUEST line, then the
 * answer file polled up to HAND_WAIT_MS. ok only when the answer says done with the planned button
 * and no dialog-like window of the pid is left within PLANNED_CLEAR_CHECKS checks.
 */
export async function answerPlannedDialog(
  deps: W3Deps,
  opts: W3Options,
  pid: number,
  p: PlannedDialog,
): Promise<{ ok: boolean; answer: Raw | null; why: string }> {
  const f = handFiles(opts.runDir, p.key);
  writeJson(
    f.request,
    {
      key: p.key,
      planned: true,
      title: p.title,
      button: p.button,
      instruction: p.instruction,
      answer: basename(f.answer),
      answerPath: f.answer,
      runDir: opts.runDir,
      askedAt: new Date(deps.now()).toISOString(),
    },
    deps,
  );
  deps.log(handLine(opts.runDir, p.key, p.instruction));
  const started = deps.now();
  let answer: Raw | null = null;
  for (;;) {
    answer = readJson<Raw>(f.answer, deps);
    if (answer) break;
    if (deps.now() - started + TIMEOUTS.poll > HAND_WAIT_MS)
      return { ok: false, answer: null, why: "no hand answer within the hand wait" };
    await deps.sleep(TIMEOUTS.poll);
  }
  if (answer.done !== true || S(answer.pressed) !== p.button)
    return {
      ok: false,
      answer,
      why: `the hand answered ${JSON.stringify({ done: answer.done ?? null, pressed: answer.pressed ?? null, why: answer.why ?? null })}`,
    };
  let left: string | null = null;
  for (let i = 0; i < PLANNED_CLEAR_CHECKS; i++) {
    left = baselineRefusal(await deps.windows(), pid);
    if (!left) return { ok: true, answer, why: `${p.button} pressed; no dialog left` };
    await deps.sleep(TIMEOUTS.poll);
  }
  return { ok: false, answer, why: `after the answer: ${left}` };
}

export async function runBattery(
  stepsIn: StepDef[],
  deps: W3Deps,
  opts: W3Options,
): Promise<BatteryReport> {
  const all = buildSteps();
  const steps = withPrelude(stepsIn, all, deps.exists(abs(opts.sandboxDir, FIXTURE_ST)));
  const records: StepRecord[] = [];
  const write = (r: StepRecord): void => {
    const clean = JSON.parse(
      toPlaceholders(JSON.stringify(redactPersonal(r)), opts.ph),
    ) as StepRecord;
    const path = recordPath(opts.runDir, r.step);
    deps.writeBytes(path, Buffer.from(JSON.stringify(clean, null, 2) + "\n", "utf-8"));
    records.push(clean);
    if (opts.evidenceDir) {
      const probes = clean.probes.map((p) => `${p.id} ${p.result}`).join(", ");
      writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${clean.step}`,
          build: opts.build,
          result_summary:
            `${clean.step}: ${clean.status}${probes ? ` [${probes}]` : ""} - ${clean.detail}`.slice(
              0,
              2000,
            ),
          artifacts: [path],
        },
        opts.ph,
      );
    }
    writeResult(opts, deps, all);
  };
  const prior = (id: string): StepRecord | null =>
    readJson<StepRecord>(recordPath(opts.runDir, id), deps);
  if (steps.length && steps[0]!.id !== GATE_STEP)
    ensureBatterySnapshot(opts.sittingDir, opts.sandboxDir, deps, "run start");
  let consecutiveFails = 0;
  for (const s of steps) {
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
    // `let`: a step that answers a planned dialog inline and was cut by it runs once more with a
    // fresh abort and context (PLANNED_DIALOGS); the guard reads the current abort.
    let abort = new AbortController();
    const guard = (what: string): void => {
      if (abort.signal.aborted) {
        calls.push({ notSent: what });
        throw new StepCut();
      }
    };
    const debt: Debt = { restorers: [] };
    let clientStop: string | null = null;
    const newContext = (): StepContext =>
      makeContext(deps, opts, prior, s.id, calls, debt, abort.signal, guard, (c) => {
        clientStop = c;
      });
    let ctx = newContext();
    try {
      const pid = deps.recordedPid();
      if (pid === null)
        throw new StopBattery(
          "stopped",
          "the lane recorded no Workbench pid: run the pre-flight first",
        );
      let out: StepOutcome;
      if (s.handDriven) out = await handWatched(deps, pid, () => s.run(ctx));
      else {
        const planned = PLANNED_DIALOGS[s.id];
        let body: Promise<StepOutcome> | null = null;
        let plannedEv: Raw | null = null;
        let w: { value: StepOutcome; added: WindowInfo[] };
        try {
          w = await watched(
            deps,
            pid,
            s.expectsWindows,
            abort,
            () => (body = s.run(ctx)),
            watchOptions(s),
          );
        } catch (e) {
          if (!planned || !(e instanceof StopBattery) || e.kind !== "handoff") throw e;
          const up = plannedDialogUp(await deps.windows(), pid, planned);
          if (!up) throw e;
          const ans = await answerPlannedDialog(deps, opts, pid, planned);
          plannedEv = {
            title: up.title,
            className: up.className,
            owned: up.owner !== 0,
            key: planned.key,
            handoffMessage: e.message,
            callsBeforeAnswer: calls.length,
            answer: ans.answer,
            cleared: ans.ok,
            why: ans.why,
          };
          if (!ans.ok)
            throw new StopBattery(
              "handoff",
              `${e.message}; the planned answer (${planned.button}) did not clear it: ${ans.why}`,
              { ...e.evidence, plannedDialog: plannedEv },
            );
          const pending = body as Promise<StepOutcome> | null;
          const settled: { v: StepOutcome } | { err: unknown } = pending
            ? await pending.then(
                (v) => ({ v }),
                (err: unknown) => ({ err }),
              )
            : { err: new StepCut() };
          if ("v" in settled) {
            plannedEv.bodyEnded = true;
            w = { value: settled.v, added: [] };
          } else {
            const cut = settled.err instanceof StepCut || settled.err === e;
            if (!cut || !planned.rerunOnCut) throw settled.err;
            // The dialog cut the body: run it once more (the settle w3-95 repeats anyway).
            plannedEv.bodyEnded = false;
            plannedEv.rerun = true;
            calls.push({ plannedDialog: planned.title, pressed: planned.button, rerun: true });
            abort = new AbortController();
            clientStop = null;
            ctx = newContext();
            w = await watched(
              deps,
              pid,
              s.expectsWindows,
              abort,
              () => s.run(ctx),
              watchOptions(s),
            );
          }
        }
        out = w.value;
        if (plannedEv) out.evidence.plannedDialog = plannedEv;
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
      const hand = kind === "handoff" ? handAnswer(message, s.id, all) : null;
      const probe = field(stop?.evidence, "probe") as ProbeResult | undefined;
      write({
        ...base,
        status: kind === "aborted" ? "ABORTED" : kind === "handoff" ? "HANDOFF" : "STOPPED",
        detail: hand ? `${message}; ${hand.instruction}` : message,
        endedAt: new Date(deps.now()).toISOString(),
        probes: probe && typeof probe.id === "string" ? [probe] : [],
        evidence: {
          ...(stop?.evidence ?? {}),
          ...(hand ? { handAnswer: hand } : {}),
          cut: abort.signal.aborted,
          calls,
          cleanup,
          pendingDebt: cleanup ? null : { restorers: debt.restorers.map((r) => r.label) },
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
  // A proven step ending KILLED is caught by the baseline guard in main (tests/live/baseline.ts).
  return {
    exit: failed ? EXIT.refused : EXIT.done,
    records,
    stoppedAt: null,
    message: failed ? "a step FAILED (see the table)" : null,
  };
}

/** `<sitting>/w3-result.json`: every step's latest record across the sitting's run folders, and each probe's result. */
export function writeResult(
  opts: W3Options,
  deps: Pick<W3Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  for (const s of steps) {
    const r = sittingRecord(opts.sittingDir, s.id, deps);
    if (r) latest.set(s.id, r);
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
  const clean = JSON.parse(
    toPlaceholders(JSON.stringify(redactPersonal(value)), opts.ph),
  ) as unknown;
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

/**
 * `plant` (no Workbench running): the five throwaway scripts under _throwaway/W3/scripts/, the empty
 * st/ (the hand's File > New target) and runtime/ folders, a copy of the .gproj in the sitting (the
 * rollback puts it back when File > New changed it) and the plant record.
 */
export function runPlant(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  io.log(
    `plant: ${SCRIPT_LIST.length} scripts -> <sandbox>/${SCRIPTS_DIR}/; folders <sandbox>/${ST_DIR}/ and <sandbox>/${RUNTIME_DIR}/; ${GPROJ_REL} copied to the sitting`,
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
  if (io.exists(abs(sandboxDir, W3_ROOT))) {
    io.log(`refused: <sandbox>/${W3_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const throwawayExistedBefore = io.exists(abs(sandboxDir, THROWAWAY));
  const gproj = abs(sandboxDir, GPROJ_REL);
  const gprojBytes = io.exists(gproj) ? io.readBytes(gproj) : null;
  if (gprojBytes) io.writeBytes(join(sittingDir, GPROJ_BACKUP), gprojBytes);
  const scripts: Record<string, string> = {};
  for (const rel of SCRIPT_LIST) {
    const b = plantedText(rel);
    io.writeBytes(abs(sandboxDir, rel), b);
    scripts[rel] = sha256(b);
  }
  io.makeDir(abs(sandboxDir, ST_DIR));
  io.makeDir(abs(sandboxDir, RUNTIME_DIR));
  io.writeBytes(
    join(sittingDir, PLANT_FILE),
    Buffer.from(
      JSON.stringify(
        {
          root: W3_ROOT,
          scripts,
          gproj: gprojBytes
            ? { rel: GPROJ_REL, sha256: sha256(gprojBytes), copy: GPROJ_BACKUP }
            : null,
          throwawayExistedBefore,
        },
        null,
        2,
      ) + "\n",
    ),
  );
  io.log(
    `planted ${SCRIPT_LIST.length} scripts; made st/ and runtime/; ${GPROJ_REL} ${gprojBytes ? `copied (sha256 ${sha256(gprojBytes)})` : "absent"}`,
  );
  return EXIT.done;
}

/**
 * `rollback` (no Workbench running): lists (with hashes) and removes <sandbox>/_throwaway/W3/;
 * `_throwaway/` only when empty and absent before; the .gproj put back from the plant's copy when
 * it differs (the hand's File > New may have registered the table in it).
 */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W3_ROOT);
  const gproj = abs(sandboxDir, GPROJ_REL);
  const backup = join(sittingDir, GPROJ_BACKUP);
  const gprojDiffers =
    io.exists(backup) &&
    (!io.exists(gproj) || sha256(io.readBytes(gproj)) !== sha256(io.readBytes(backup)));
  const files = io.exists(dir) ? io.listTree(dir) : [];
  io.log(
    `rollback: list and remove <sandbox>/${W3_ROOT}/ (${files.length} files); ${GPROJ_REL} ${gprojDiffers ? "differs from the plant's copy: it is put back" : "unchanged"}`,
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
  if (io.exists(dir)) {
    const listing = files.map((rel) => ({
      rel,
      sha256: sha256(io.readBytes(join(dir, ...rel.split("/")))),
    }));
    io.writeBytes(
      join(sittingDir, "throwaway-w3-listing.json"),
      Buffer.from(JSON.stringify(listing, null, 2) + "\n"),
    );
    io.removeTree(dir);
  }
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
  if (gprojDiffers) {
    io.writeBytes(gproj, io.readBytes(backup));
    io.log(`restored <sandbox>/${GPROJ_REL} from ${GPROJ_BACKUP}`);
  }
  io.log(`removed <sandbox>/${W3_ROOT}/ (listing in throwaway-w3-listing.json)`);
  return EXIT.done;
}

// ── Real dependencies ────────────────────────────────────────────────────────

/** The file-system calls listTreeOf makes (a test passes a racing one). */
export interface TreeFs {
  exists(p: string): boolean;
  readdir(p: string): string[];
  isDir(p: string): boolean;
}

const REAL_TREE_FS: TreeFs = {
  exists: existsSync,
  readdir: (p) => readdirSync(p),
  isDir: (p) => statSync(p).isDirectory(),
};

/**
 * Every file under `dir` ("/"-joined, sorted). W3 run 1 crashed on `stat '...\scratch.ini.jOXMLh'`:
 * Workbench writes its settings through a temp file beside the scratch ini and removes it, so an
 * entry can vanish between the listing and the stat. A vanished entry (or folder) is not listed.
 */
export function listTreeOf(dir: string, fs: TreeFs = REAL_TREE_FS): string[] {
  if (!fs.exists(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    let names: string[];
    try {
      names = fs.readdir(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      let isDir: boolean;
      try {
        isDir = fs.isDir(p);
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

/** ui_localization_audit in process: the project audit and readStIds of the given .st files. */
function runAudit(sandboxDir: string, args: Raw): ToolResponse {
  try {
    const report = runLocalizationAudit(abs(sandboxDir, GPROJ_REL));
    const stIds: Record<string, string[]> = {};
    for (const t of Array.isArray(args.tables) ? (args.tables as unknown[]).map(S) : [])
      stIds[t] = readStIds(readFileSync(abs(sandboxDir, t)));
    return { ok: true, action: "audit", readback: { tables: report.tables.length, stIds } };
  } catch (e) {
    return {
      ok: false,
      action: "audit",
      code: "TOOL_ERROR",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export function realDeps(input: {
  port: number;
  lspPort: number;
  lane: Lane;
  sandboxDir: string;
}): W3Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const config = { ...loadConfig(), projectPath: input.sandboxDir };
  const worldDeps = { projectRoot: input.sandboxDir, artifactsRoot: artifactsDir() };
  // The environment AS GIVEN, with the LSP port: ENFUSION_SCRIPT_LSP is never set here (P-W3-23).
  const env: NodeJS.ProcessEnv = { ...process.env, [PORT_ENV]: String(input.lspPort) };
  const lspHost = new ScriptLspHost({
    projectPath: input.sandboxDir,
    netPort: input.port,
    env,
    // No idle close: the session ends with the process (never shutdown/exit on the live lane).
    timeouts: { idle: 24 * 3_600_000 },
  });
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_script_editor":
          return asResp(await runScriptEditor(client, args));
        case "wb_localization":
          return asResp(await runLocalization(client, args));
        case "wb_module":
          return asResp(await runModule(client, args as unknown as ModuleArgs));
        case "wb_world":
          return asResp(await runWorld(client, args, worldDeps));
        case "wb_container":
          return asResp(await runContainer(client, args, { artifactsRoot: artifactsDir() }));
        case "wb_scripts":
          return asResp(await runScripts(client, args as unknown as ScriptsArgs));
        case "string_table":
          return asResp(
            runStringTable(config, {
              ...args,
              projectPath: input.sandboxDir,
            } as unknown as StringTableArgs),
          );
        case "script_lsp":
          return asResp(await lspHost.run(args));
        case "ui_localization_audit":
          return runAudit(input.sandboxDir, args);
      }
    },
    lsp: async (plan) =>
      (await runLspPlan({
        port: input.lspPort,
        netPort: input.port,
        plan,
        sandboxDir: input.sandboxDir,
      })) as unknown as Raw,
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
      } catch (e) {
        return e instanceof WorkbenchError ? null : null;
      }
    },
    bundleDigest: () => bundleDigest(),
    windows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    recordedPid: () => input.lane.recordedPid(),
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    makeDir: (p) => {
      mkdirSync(p, { recursive: true });
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
  "lsp-port",
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
  deps?: W3Deps;
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
        `refused: ${sittingDir} holds no ${PLANT_FILE}: run \`w3.live.ts plant\` first`,
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
  const lspPort = o["lsp-port"]
    ? Number(o["lsp-port"])
    : Number(process.env[PORT_ENV] || LSP_DEFAULT_PORT);
  const deps = over.deps ?? realDeps({ port, lspPort, lane, sandboxDir: resolve(o.sandbox) });
  if (!over.deps) lane.startHeartbeat();
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
      wave: "w3",
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
  // An explicit exit: a step cut by the window poller may leave a call in flight, and an open LSP
  // session is dropped with the process (never shutdown/exit).
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}

// Census rows this file tests (W3 close-out, EV-W3-099).
// census:api:LocalizationEditor.BeginModify/1
// census:api:LocalizationEditor.DeleteItem/1
// census:api:LocalizationEditor.EndModify/0
// census:api:LocalizationEditor.GetTable/0
// census:api:LocalizationEditor.InsertItem/3
// census:api:LocalizationEditor.ModifyProperty/3
// census:api:ScriptEditor.GetCurrentFile/1
// census:api:ScriptEditor.GetCurrentLine/0
// census:api:ScriptEditor.GetLineText/2
// census:api:ScriptEditor.GetLinesCount/0
// census:api:ScriptEditor.InsertLine/2
// census:api:ScriptEditor.RemoveLine/1
// census:api:ScriptEditor.SetLineText/2
// census:mcp:action/string_table.buildRuntime
// census:mcp:action/string_table.create
// census:mcp:action/string_table.get
// census:mcp:action/string_table.inspect
// census:mcp:action/string_table.lint
// census:mcp:action/string_table.lookup
// census:mcp:action/string_table.remove
// census:mcp:action/string_table.upsert
// census:mcp:action/wb_localization.columns
// census:mcp:action/wb_localization.delete
// census:mcp:action/wb_localization.filter
// census:mcp:action/wb_localization.get
// census:mcp:action/wb_localization.getTable
// census:mcp:action/wb_localization.insert
// census:mcp:action/wb_localization.list
// census:mcp:action/wb_localization.listLanguages
// census:mcp:action/wb_localization.modify
// census:mcp:action/wb_localization.open
// census:mcp:action/wb_localization.save
// census:mcp:action/wb_localization.selection
// census:mcp:action/wb_localization.set
// census:mcp:action/wb_localization.status
// census:mcp:action/wb_script_editor.getCurrentFile
// census:mcp:action/wb_script_editor.getLine
// census:mcp:action/wb_script_editor.getLines
// census:mcp:action/wb_script_editor.getLinesCount
// census:mcp:action/wb_script_editor.insertLine
// census:mcp:action/wb_script_editor.jump
// census:mcp:action/wb_script_editor.open
// census:mcp:action/wb_script_editor.openFile
// census:mcp:action/wb_script_editor.removeLine
// census:mcp:action/wb_script_editor.replaceRange
// census:mcp:action/wb_script_editor.setLine
// census:mcp:action/wb_script_editor.state
// census:mcp:handler-action/EMCP_WB_Localization.columns
// census:mcp:handler-action/EMCP_WB_Localization.filter
// census:mcp:handler-action/EMCP_WB_Localization.get
// census:mcp:handler-action/EMCP_WB_Localization.list
// census:mcp:handler-action/EMCP_WB_Localization.open
// census:mcp:handler-action/EMCP_WB_Localization.save
// census:mcp:handler-action/EMCP_WB_Localization.selection
// census:mcp:handler-action/EMCP_WB_Localization.set
// census:mcp:handler-action/EMCP_WB_Localization.status
// census:mcp:handler-action/EMCP_WB_ScriptEditor.getLines
// census:mcp:handler-action/EMCP_WB_ScriptEditor.jump
// census:mcp:handler-action/EMCP_WB_ScriptEditor.open
// census:mcp:handler-action/EMCP_WB_ScriptEditor.replaceRange
// census:mcp:handler-action/EMCP_WB_ScriptEditor.state
