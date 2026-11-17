/**
 * Session S-A, the headless command-line sitting (plan 8 Phase 2 session table; plan 5.3
 * "Pre-flight variants", Headless CLI; register unknowns U1 and the headless half of U14;
 * live enumerator L13, plan 4.5). No handler is installed, no NET call is made, and no
 * Workbench is open before it. It settles whether `-gproj <sandbox gproj> [-addonsDir <dir>]`
 * plus a module verb runs unattended on the requested project and exits by itself.
 *
 * Steps, in the plan's order (U1), then the headless half of U14. The probe queue
 * `docs/v2/sessions/queues/S-A-queue.json` carries the same ids and the runbook
 * `docs/v2/sessions/queues/S-A.md` says what a pass and a fail look like:
 *
 *   S-A-1  old arguments  -wbProjectPath <gproj> -exitAfterInit                    read-only
 *   S-A-2  new arguments  -gproj <gproj> [-addonsDir <d>] -exitAfterInit          read-only
 *   S-A-3  new arguments  -wbModule=ScriptEditor -validate=<CFG>                  read-only
 *   S-A-4  new arguments  -wbModule=ResourceManager -buildData PC <run>/buildData reversible
 *   S-A-5  new arguments  -wbModule=ResourceManager -plugin=AddonBuildInfoTool
 *                         -addonPath <sandbox> -ciInfoDst <run>/addon.ci-info.json reversible
 *   S-A-6  U14 control: a throwaway copy of the shipped handler folder planted in the
 *          sandbox (`Scripts/WorkbenchGame/EMCP2_U14_Throwaway/`), then S-A-3's verb    reversible
 *   S-A-7  U14: the same copy plus one deliberately broken extra .c file, same verb     reversible
 *   S-A-8  retired: ran once (DEC-037, EV-S-A-006: the 1.x wb_build_data form did not
 *          build); its argv as run is in the queue file, and the step refuses to launch
 *   S-A-9  (--only) S-A-5 with -addonPath as the sandbox's 8.3 short path (run time)  reversible
 *   S-A-10 (--only) S-A-9 with -addonPath=<short path> and -ciInfoDst=<run file> as single
 *                         tokens (no space in either, refused otherwise)        reversible
 *
 * "New arguments" are `-gproj <gproj>` as separate argv elements, plus `-addonsDir <dirs>`
 * only when a dependency of the sandbox resolves outside the base game and the Tools core
 * (DEC-021: `-gproj` opened the base game in the two logged sessions that also log a missing
 * addon dependency). A dependency that is workshop-only or missing refuses every launch.
 *
 * Rules (plan 5.3, "During" and the Headless CLI variant), all enforced here:
 *   - Pre-flight steps 1 to 7 run through `preflight.ts` (variant headless-cli); steps 8 and 9
 *     are replaced by the per-launch loop below. A resumed run folder (it holds `baseline.json`)
 *     skips steps 5 and 6: post-flight always uses the first snapshot and registry export.
 *   - One launch at a time; never two Workbench processes. A Workbench this run did not start,
 *     a running `CrashReporter.exe` or a listener on the NET port stops the session before the
 *     next launch (nothing of theirs is killed).
 *   - S-A-1 opens the launcher's preselected project when `-wbProjectPath` is ignored. It runs
 *     only when the owner opened the 2.0 decoy addon `EMCP2_decoy` last from the launcher
 *     (`--launcher-last-is-decoy`, and the decoy exists), so no owner project can be opened.
 *     Before S-A-1 the script also checks, by file reads only, that the newest retained session
 *     log's opened-project line names the decoy and that every launcher project-list file (one
 *     per Steam app number) is readable and has the decoy first (DEC-030, DEC-031). The sandbox
 *     counts as registered only when EVERY list names it. S-A-1 goes on only when its own
 *     session log was matched. Every step diffs the decoy, the sandbox root's entry list and the
 *     launcher lists (per app number, counts only) before and after.
 *   - After every launch the opened project is asserted from the session log: the line E13
 *     identified (`OPENED_PROJECT_PATTERN`, `Using autosave directory: .../Projects/<name>/
 *     autosaves`). Only that line decides, and only in a session log born after the spawn whose
 *     `CLI Params:` echo carries this launch's own switches; with no such line it has not passed.
 *     A log born after the spawn whose echo does NOT match, but which names a project other than
 *     the sandbox or the decoy, is a wrong project all the same.
 *   - Kill criteria: the `Missing Addon Dependencies` modal; a launcher window with the
 *     watchdog's hold signature (`Workbench Create Engine took`, no `CLI Params:` echo, 10 s
 *     quiet since the marker); a project other than the sandbox in the opened-project line. The
 *     windows of the started pid and of its child Workbench images are read. A kill ends one
 *     process at a time, never with a tree flag (DEC-031, which replaces DEC-030's tree ruling):
 *     the started pid's image is checked, then its descendants created after their parent whose
 *     image is the Workbench executable, CrashReporter.exe or WerFault.exe are ended children
 *     first, each image-checked again just before its own `taskkill /PID <p> /F`, and the
 *     started pid last; any other descendant is reported, left running, and stops the step. The
 *     result is recorded as one of three: launcher held (a hold at the picker: the list this
 *     launch reads does not know the project [inferred], never a U1 "no"), flag ignored (the
 *     decoy opened), wrong project.
 *   - On any timeout nothing is retried and nothing is killed: the desktop is captured
 *     (`capture.ts`), the top-level windows are listed, the step result is written and the
 *     script stops for the main session. Before the project opened, a window probe that fails on
 *     three polls in a row stops the step the same way; after it, probe errors are only counted.
 *     After the opened-project line, a session log that has not grown for `IDLE_QUIET_MS`
 *     (300 s, `--idle-quiet-ms`) while the started pid and its child Workbench images used at
 *     most `IDLE_CPU_PERCENT` of one core over that period (read from the process table, read
 *     only) ends the step as `idle` (DEC-033): the same capture, window list and stop as a
 *     timeout, its own outcome, never retried; `recover` is the checked end afterwards.
 *     A step that has a result in the run folder never runs again in that run;
 *     `<run>/S-A-n.started` is written before the spawn (with the pid and its creation time
 *     after it), and while ANY step of the run folder has a started marker and no result,
 *     no step runs (the script ended mid-step: a harness error) until the owner's
 *     acknowledgement is recorded with the `acknowledge` subcommand.
 *   - Enter, accelerators and the launcher nudge are never used: windows are only read
 *     (`inspectProcessWindows`, which posts no input) and no key is ever sent.
 *   - The old arguments run the read-only verb only. Writing verbs run only with the new
 *     arguments, with their output inside this run's folder (which must lie inside the
 *     artifacts folder and outside every git tree), and only after the opened-project
 *     assertion has passed once in this run (a prior result counts only when its evidence
 *     record hashes it).
 *   - A real run stops before pre-flight when the launcher lists' registration of the sandbox is
 *     unknown (a list cannot be read, or there is none), and, for any `-gproj` step (S-A-2 to
 *     S-A-7), when a readable list's first entry is neither the sandbox nor the decoy: an ignored
 *     `-gproj` would open the launcher's preselection (DEC-034, B-1 and m-4). Every dry run
 *     prints each list's first entry and that gate's verdict.
 *   - A kill re-reads the started pid's creation time just before its end and leaves it running
 *     when it differs from the one recorded at the spawn; a process query that fails mid-kill is
 *     reported and never loses the record of what was already ended (DEC-034, m-1 and m-2).
 *   - Launch switches on a policy deny list (`data/census/policy.json`) refuse the launch.
 *   - Each step writes its result to the run folder (placeholders applied; free text dropped
 *     when the log names a project that is not ours) and one evidence record through
 *     `evidence.ts`, naming the probe ids the step answers.
 *
 * Everything that touches a process, the registry, the desktop or the file system outside the
 * artifacts folder goes through `SessionDeps`, so tests drive the whole control flow with
 * mocks. Everything defaults to a DRY RUN that prints the pre-flight, the launch schedule and
 * the action plan (the format `dry-run.ts` checks) and writes the plan to `--out`. A real run
 * needs `--really`, a win32 host, the lease held by the lane `--id` (take it with `lane.ts
 * start` first) and `--launcher-knows-sandbox` (OA-3); S-A-1 also needs
 * `--launcher-last-is-decoy`, and S-A-6/7 need `--lint passed|triaged` for the shipped set.
 *
 * The action plan holds, per step, one `launch` (the checker refuses a deny-listed switch, a
 * project that is not the 2.0 sandbox, and S-A-1's `-wbProjectPath` without the decoy
 * precondition) and one `screenshot`: the desktop capture taken on a timeout is the only
 * desktop action this session can take. The script checks the deny-listed switches itself as
 * well before each launch (`deniedSwitch`, shared with preflight.ts).
 *
 * The runbook runs one step per invocation (`--only S-A-n`, the same `--run` folder each time);
 * `invocationWorstCaseMs` is the caller's estimate to set its command timeout above (an
 * estimate, not a bound: each process query has its own timeout, and the timeout path makes one
 * per foreign window pid).
 *
 * Usage:
 *   npx tsx scripts/live/s-a-headless.ts [--out <plan.json>] [--id <lane id>] [--really]
 *       [--launcher-knows-sandbox] [--launcher-last-is-decoy] [--lint passed|triaged]
 *       [--from S-A-n | --only S-A-n] [--run <run dir>] [--decoy <dir>] [--validate-config PC]
 *       [--addons-dir <dir>] [--sandbox <dir>] [--queue <file>] [--evidence-dir <dir>]
 *       [--registry-key <key>] [--workbench-path <tools>] [--game-path <game>]
 *       [--logs-path <dir>] [--ledger-meta <path>] [--lease-path <p>] [--marker-path <p>]
 *       [--idle-quiet-ms 300000] [--idle-cpu-percent 5]
 *   npx tsx scripts/live/s-a-headless.ts rollback --run <run dir> --id <lane id> [--really]
 *   npx tsx scripts/live/s-a-headless.ts recover --run <run dir> --id <lane id>
 *       [--owner-go <pid>] [--really]
 *   npx tsx scripts/live/s-a-headless.ts acknowledge --run <run dir> --id <lane id>
 *       --step S-A-n [--owner-ack] [--really]
 *   npx tsx scripts/live/s-a-headless.ts decoy [--decoy <dir>] [--really]
 *
 * `recover` is the recorded recovery (plan 5.3): it reads the Workbench pid from this lane's
 * lease, confirms with the process list that its image is the Workbench executable, and ends
 * it and its qualifying descendants one process at a time, as a kill criterion does, then
 * waits for them to go. The pid is this run's own only when a started marker names it with the
 * creation time the process now has; any other pid (a leftover the main session recorded into
 * the lease) needs `--owner-go <pid>` naming it (plan 5.7) and is ended alone. It refuses in
 * every other case and says what it saw. At most three recoveries per sitting (plan 5.3),
 * counted across every run folder born since the lease was taken. `acknowledge` is the one way
 * to clear a started marker that has no result.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { loadConfig } from "../../src/config.js";
import { generateGproj } from "../../src/templates/gproj.js";
import { extractErrorLines, matchValidationVerdict } from "../../src/tools/wb-validate-scripts.js";
import {
  DEFAULT_NUDGE_AFTER_MS,
  ENGINE_CREATED_MARKER,
} from "../../src/workbench/launch-watchdog.js";
import { inspectProcessWindows } from "../../src/workbench/launcher-nudge.js";
import {
  checkWorkbenchVisibleDeps,
  type WbDepsCheck,
  type WbDepsPaths,
} from "../../src/workbench/wb-deps.js";
import {
  HAZARDS,
  OPENED_PROJECT_PATTERN,
  parseCliEcho,
  parseLogLine,
  projectNameOfGproj,
} from "../census/enumerators/e13-launch-logs.js";
import { captureDesktop, type CaptureResult } from "./capture.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import type { PlanAction } from "./dry-run.js";
import { rewriteStrings, writeEvidence } from "./evidence.js";
import { Lane } from "./lane.js";
import {
  BUNDLED_HANDLER_DIR,
  HANDLER_FOLDER,
  PROBE_PACK_FOLDER,
  WORKBENCH_EXE,
  formatCommandLine,
  resolveWorkbenchExe,
} from "./launch.js";
import {
  DECOY_NAME,
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { loadPolicy, type CensusPolicy } from "./policy.js";
import { leaseStartMs, recordForcedKill, sittingFolders } from "./postflight.js";
import { lastLine, runPowerShell, type PowerShellResult } from "./powershell.js";
import {
  PREFLIGHT_STEPS,
  U14_THROWAWAY_FOLDER,
  deniedSwitch,
  formatStep,
  newestSessionLog,
  recordedBuild,
  runPreflight,
  type PreflightContext,
  type StepResult as PreflightStepResult,
} from "./preflight.js";

import {
  KILL_WAIT_MS,
  MAX_RECOVERIES,
  PROCESS_TREE_SCRIPT,
  acknowledgeMarker,
  acknowledgedMarkerPath,
  descendantPlan,
  killOwnWorkbench,
  listsLine,
  normGproj,
  outsideArtifacts,
  parseProcessTable,
  readProjectLists,
  readStartedMarker,
  registration,
  runRecover as runRecoverCommon,
  spawnWithExit,
  startedMarkerPath,
  summarizeLists,
  type KillResult,
  type ListSummary,
  type ProcRow,
  type ProcessExit,
  type ProjectListFile,
  type RecoverConfig,
  type RecoverDeps,
  type SpawnedProcess,
  type StartedMarker,
} from "./session-common.js";
import { diff, isNetZero, sha256File, takeSnapshot, type Manifest } from "./snapshot.js";
import {
  CRASH_REPORTER_IMAGE,
  defaultExec,
  portListeners,
  processByPid,
  processesByImage,
  type ExecFn,
} from "./win.js";

/** The deny-switch rule and the decoy name are shared (preflight.ts, paths.ts); re-exported here. */
export { DECOY_NAME, deniedSwitch };

/**
 * The process table, the per-process end, started markers, `recover`, the launcher lists and the
 * run-folder rule moved to `session-common.ts` (DEC-032), shared with S-B and S-C; re-exported
 * here under their old names.
 */
export {
  END_IMAGES,
  KILL_WAIT_MS,
  MAX_RECOVERIES,
  PROCESS_TREE_SCRIPT,
  acknowledgedMarkerPath,
  descendantPlan,
  killOwnWorkbench,
  listsLine,
  outsideArtifacts,
  parseProcessTable,
  readProjectLists,
  readStartedMarker,
  recoverRecords,
  registration,
  runOwnPids,
  runStartedPids,
  spawnWithExit,
  startedMarkerPath,
  summarizeLists,
  type KillResult,
  type ListSummary,
  type ProcRow,
  type ProcessExit,
  type ProjectListFile,
  type RecoverRecord,
  type SpawnedProcess,
  type StartedMarker,
} from "./session-common.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Session id, used for the evidence records (`EV-S-A-<seq>`). */
export const SESSION_ID = "S-A";

/** Repo-relative path of this script (the dry-run checker's `--script`). */
export const SCRIPT_PATH = "scripts/live/s-a-headless.ts";

/** Default probe queue. */
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-A-queue.json");

/** Default `-validate=<CFG>` configuration and `-buildData` platform. */
export const DEFAULT_VALIDATE_CONFIG = "PC";
export const BUILD_PLATFORM = "PC";

/** The U14 throwaway folder, planted beside where the shipped handler set would go. */
export const U14_FOLDER = U14_THROWAWAY_FOLDER;
export const U14_BROKEN_FILE = "EMCP2_U14_Broken.c";
/**
 * The deliberately broken extra file: one class using an undefined type and calling an undefined
 * function. An empty initialiser (`int x = ;`) is NOT an error to the Enforce compiler: on
 * 2026-10-06 it drew only the warning "Variable 'x' is not used" and the validation succeeded.
 */
export const U14_BROKEN_SOURCE = [
  "// Deliberately broken for unknown U14 (session S-A). Planted in a throwaway copy of the",
  "// handler folder and removed by the same run; never shipped.",
  "class EMCP2_U14_Broken",
  "{",
  "\tvoid Broken()",
  "\t{",
  "\t\tEMCP2_U14_NoSuchType y = new EMCP2_U14_NoSuchType();",
  "\t\tEMCP2_U14_NoSuchFunction(y);",
  "\t}",
  "}",
  "",
].join("\n");

/** Poll interval for the session log and the started pid's windows. */
export const POLL_MS = 3_000;
/** Lease heartbeat interval (well inside the 15-minute staleness window). */
export const HEARTBEAT_MS = 60_000;
/**
 * Launcher hold, the field-proven watchdog's signature (`launch-watchdog.ts`): a launcher window
 * of the started pid or of its child Workbench images, `Workbench Create Engine took` in the
 * log, no `CLI Params:` echo, and this much quiet since the engine marker was first seen. Like
 * the watchdog, the decision is armed only by the engine marker: a launcher window seen before
 * it (a slow cold start) is never a hold, and a launch that never writes the marker runs to the
 * init timeout (captured, not killed). The earlier 30 s "window persisted" rule, armed on the
 * marker, could never fire before this signature and was removed (DEC-030).
 */
export const LAUNCHER_QUIET_MS = DEFAULT_NUDGE_AFTER_MS;
/** Polls in a row whose window probe failed before the step stops as on a timeout. */
export const WINDOW_PROBE_ERROR_LIMIT = 3;
/**
 * An ESTIMATE of what one invocation adds to a step's own timeouts: pre-flight steps 1 to 7,
 * the pre-launch checks, the process-table reads, the kill wait, the desktop capture and the
 * window list. Not a bound: each process query has its own timeout (tasklist, taskkill and
 * netstat 20 s; the PowerShell process-table read and the window list 30 s; the window probe
 * 20 s), and the timeout path makes one per foreign window pid (DEC-031).
 */
export const INVOCATION_MARGIN_MS = 300_000;

/**
 * The idle end rule (DEC-033: S-A-4 and S-A-6 waited their full exit timeouts with Workbench
 * idle on its main window). After the opened-project line, a step whose session log has not
 * grown for this long, and whose process (the started pid and its child Workbench images) used
 * no measurable CPU over that period, ends as `idle`: the same capture and stop as a timeout,
 * never retried. `--idle-quiet-ms` changes it.
 */
export const IDLE_QUIET_MS = 300_000;
/**
 * "No measurable CPU": at most this share of one core over the quiet period (5 % is 15 s of CPU
 * time over 300 s). An idle Workbench drew about 2 % of one core in a live sitting, so the
 * floor sits above that; every step result records the figure. `--idle-cpu-percent` changes it.
 */
export const IDLE_CPU_PERCENT = 5;

/** How often the idle rule reads the process table (read only): a fifth of the quiet period, at most 60 s. */
export function idleSampleMs(quietMs: number): number {
  return Math.min(60_000, Math.max(POLL_MS, Math.floor(quietMs / 5)));
}

/**
 * The 2.0 decoy addon (`DECOY_NAME`, paths.ts): an empty project the owner opens LAST from the
 * launcher before S-A, so that a launcher which ignores `-wbProjectPath` (S-A-1) or `-gproj`
 * preselects a throwaway project of the 2.0 lane and never one of the owner's. Created by the
 * `decoy` subcommand.
 */
export const DECOY_TITLE = "EMCP2 decoy (2.0 live lane, S-A launcher preselection)";

/** AddonBuildInfoTool's message before its `Workbench.Exit(3)`, which has no `return` after it. */
export const ADDON_NOT_FOUND_MESSAGE = "Could not find addon matching path";

/** Images whose windows a timeout records with their titles (likely blockers after a kill). */
const CRASH_IMAGES = new Set([CRASH_REPORTER_IMAGE.toLowerCase(), "werfault.exe"]);

/** Projects a log may name that are Bohemia's own; any other name not ours is scrubbed. */
const BASE_PROJECT_NAMES = new Set(["armareforger", "core"]);

/**
 * Exit codes of `AddonBuildInfoTool.RunCommandline`, from its source in the game paks
 * (`scripts/WorkbenchCommon/AddonBuildInfoTool.c`, lines 196 to 243 at build 1.8.0.13).
 * Exit 3 is followed by no `return` in that source, so the run continues after it.
 */
export const PLUGIN_EXIT_CODES: Readonly<Record<number, string>> = {
  0: "wrote the ci-info file",
  1: "missing argument -addonPath (GetCmdLine did not read it)",
  2: "-addonPath is not an absolute path",
  3: "no loaded addon matches -addonPath",
  4: "missing argument -ciInfoDst",
  5: "could not open the -ciInfoDst file for writing",
};

// ── Steps ────────────────────────────────────────────────────────────────────

export type StepId =
  | "S-A-1"
  | "S-A-2"
  | "S-A-3"
  | "S-A-4"
  | "S-A-5"
  | "S-A-6"
  | "S-A-7"
  | "S-A-8"
  | "S-A-9"
  | "S-A-10";

/** The three failure results of the Headless CLI variant (plan 5.3). */
export type FailureResult = "launcher-held" | "flag-ignored" | "wrong-project";

export type Outcome =
  | "pass"
  | "launcher-held"
  | "wrong-project"
  | "flag-ignored"
  | "exited-early"
  | "timeout"
  /** DEC-033: the log stopped growing and the process used no measurable CPU (`IDLE_QUIET_MS`). */
  | "idle"
  | "respawned"
  | "kill-failed"
  | "lease-lost"
  | "control-dirty"
  /** A validate step's session log said "Script validation failed." (the step ended on it). */
  | "validation-failed"
  /**
   * U14 (S-A-7): the log says the WorkbenchGame script module did not compile, or an (E) line
   * names the planted file, whatever the validate verdict said. A continue-allowed answer.
   */
  | "workbench-module-failed"
  | "refused"
  | "rollback-incomplete"
  | "harness-error";

/** Inputs a step's verb needs. */
export interface VerbInput {
  validateConfig: string;
  runDir: string;
  sandboxDir: string;
  /**
   * The sandbox folder's Windows 8.3 short path (no space), resolved at run time by
   * `shortPathOf`; null when there is none or it was not resolved. S-A-9 refuses without it.
   */
  sandboxShortDir?: string | null;
}

export interface StepDef {
  id: StepId;
  title: string;
  form: "old" | "new";
  /** Arguments after the project arguments. */
  verb: (v: VerbInput) => string[];
  /** A writing verb: new arguments only, after the assertion has passed once. */
  writes: boolean;
  risk: "read-only" | "reversible";
  /** Probe ids (data/census/probes.jsonl) the step's result feeds. */
  answers: string[];
  /** Spawn to the opened-project line. */
  initTimeoutMs: number;
  /** Opened-project line to the process's own exit. */
  exitTimeoutMs: number;
  /** What the step checks after a self-exit. */
  output: "none" | "build-dir" | "ci-info" | "compile-log";
  /** The output folder (build-dir) or file (ci-info) inside the run folder. */
  outputName?: string;
  /** Run only by `--only <id>` (a follow-up probe), never in a full or `--from` sequence. */
  onlyById?: boolean;
  /**
   * The step's measurement is on record and the step no longer launches: why, with the
   * decision and evidence that hold the result. The argv as run lives in the queue file.
   */
  retired?: string;
  /** The verb needs the sandbox's 8.3 short path (S-A-9). */
  needsShortPath?: boolean;
  /** The verb puts the run folder inside a single `=` token, so the run path must hold no space (S-A-10). */
  runPathInToken?: boolean;
  /** U14 plant, if any. */
  plant?: "control" | "broken";
}

/** Why S-A-8 no longer launches (KD-004 closed with it). */
export const S_A_8_RETIRED =
  "S-A-8 is retired: it ran once (DEC-037, EV-S-A-006) and its form is no longer shipped; the argv as run is in the queue file";

const U1_ALL = ["P-U1", "P-E01-resource-manager-L691", "P-E01-mcp-inventory-L344"];

export const STEPS: readonly StepDef[] = [
  {
    id: "S-A-1",
    title: "old arguments with -exitAfterInit",
    form: "old",
    verb: () => ["-exitAfterInit"],
    writes: false,
    risk: "read-only",
    answers: [
      ...U1_ALL,
      "P-E01-mcp-inventory-L262",
      "P-E01-mcp-inventory-L375",
      "P-E01-mcp-inventory-L341",
    ],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 120_000,
    output: "none",
  },
  {
    id: "S-A-2",
    title: "new arguments with -exitAfterInit",
    form: "new",
    verb: () => ["-exitAfterInit"],
    writes: false,
    risk: "read-only",
    answers: [
      ...U1_ALL,
      "P-E01-mcp-inventory-L376",
      "P-E01-plugins-netapi-cli-L456",
      "P-E01-mcp-inventory-L341",
    ],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 120_000,
    output: "none",
  },
  {
    id: "S-A-3",
    title: "new arguments with -validate=<CFG>",
    form: "new",
    verb: (v) => ["-wbModule=ScriptEditor", `-validate=${v.validateConfig}`],
    writes: false,
    risk: "read-only",
    answers: [
      ...U1_ALL,
      "P-E01-mcp-inventory-L262",
      "P-E01-mcp-inventory-L376",
      "P-E01-plugins-netapi-cli-L456",
    ],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 900_000,
    output: "compile-log",
  },
  {
    id: "S-A-4",
    title: "new arguments with -buildData into the artifacts folder",
    form: "new",
    verb: (v) => [
      "-wbModule=ResourceManager",
      "-buildData",
      BUILD_PLATFORM,
      join(v.runDir, "buildData"),
    ],
    writes: true,
    risk: "reversible",
    answers: [
      ...U1_ALL,
      "P-E01-mcp-inventory-L262",
      "P-E01-mcp-inventory-L342",
      "P-E01-plugins-netapi-cli-L456",
    ],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 1_800_000,
    output: "build-dir",
  },
  {
    id: "S-A-5",
    title: "new arguments with -plugin=AddonBuildInfoTool",
    form: "new",
    verb: (v) => [
      "-wbModule=ResourceManager",
      "-plugin=AddonBuildInfoTool",
      "-addonPath",
      v.sandboxDir,
      "-ciInfoDst",
      join(v.runDir, "addon.ci-info.json"),
    ],
    writes: true,
    risk: "reversible",
    answers: [
      ...U1_ALL,
      "P-E01-mcp-inventory-L275",
      "P-E01-plugins-netapi-cli-L456",
      "P-E01-resource-manager-L684",
    ],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 600_000,
    output: "ci-info",
  },
  {
    id: "S-A-6",
    title: "U14 control: throwaway handler copy, validate",
    form: "new",
    verb: (v) => ["-wbModule=ScriptEditor", `-validate=${v.validateConfig}`],
    writes: false,
    risk: "reversible",
    answers: ["P-U14"],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 900_000,
    output: "compile-log",
    plant: "control",
  },
  {
    id: "S-A-7",
    title: "U14: throwaway handler copy plus one broken file, validate",
    form: "new",
    verb: (v) => ["-wbModule=ScriptEditor", `-validate=${v.validateConfig}`],
    writes: false,
    risk: "reversible",
    answers: ["P-U14"],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 900_000,
    output: "compile-log",
    plant: "broken",
  },
  {
    // P-SA-builddata-form. Retired: S-A-8 ran once (DEC-037, lane sa4, EV-S-A-006). It passed
    // the 1.x wb_build_data argv, the folder as its own entry followed by the legacy pause
    // switch (KD-004), and the folder stayed empty. The tool no longer passes that switch
    // (DEC-048 package B), so the step has nothing left to measure. Its argv as run is recorded
    // in docs/v2/sessions/queues/S-A-queue.json; the code holds no launch argv for it.
    id: "S-A-8",
    title: "new arguments with the shipped wb_build_data -buildData form",
    form: "new",
    verb: () => [],
    writes: true,
    risk: "reversible",
    answers: ["P-SA-builddata-form", "P-U1", "P-E01-mcp-inventory-L342"],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 1_800_000,
    output: "build-dir",
    outputName: "buildData-S-A-8",
    onlyById: true,
    retired: S_A_8_RETIRED,
  },
  {
    // P-SA-addonpath-space. S-A-5's -addonPath value had a space and arrived empty; the 8.3
    // short path has none, so it needs no quotes.
    id: "S-A-9",
    title: "new arguments with -plugin=AddonBuildInfoTool, -addonPath as the 8.3 short path",
    form: "new",
    verb: (v) => {
      if (!v.sandboxShortDir) throw new Error(SHORT_PATH_REFUSAL);
      return [
        "-wbModule=ResourceManager",
        "-plugin=AddonBuildInfoTool",
        "-addonPath",
        v.sandboxShortDir,
        "-ciInfoDst",
        join(v.runDir, "addon.ci-info.S-A-9.json"),
      ];
    },
    writes: true,
    risk: "reversible",
    answers: ["P-SA-addonpath-space", "P-U1", "P-E01-mcp-inventory-L275"],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 600_000,
    output: "ci-info",
    outputName: "addon.ci-info.S-A-9.json",
    needsShortPath: true,
    onlyById: true,
  },
  {
    // P-SA-addonpath-space. S-A-9's live pass: GetCmdLine("-addonPath", ...) returned '' for a
    // value given as the next argument. This gives each value inside its flag's own token
    // (`-flag=value`), the form the -wbModule= and -plugin= flags already use.
    id: "S-A-10",
    title:
      "new arguments with -plugin=AddonBuildInfoTool, -addonPath= and -ciInfoDst= as single tokens",
    form: "new",
    verb: (v) => {
      if (!v.sandboxShortDir) throw new Error(SHORT_PATH_REFUSAL);
      if (/\s/.test(v.runDir)) throw new Error(RUN_PATH_SPACE_REFUSAL);
      return [
        "-wbModule=ResourceManager",
        "-plugin=AddonBuildInfoTool",
        `-addonPath=${v.sandboxShortDir}`,
        `-ciInfoDst=${join(v.runDir, "addon.ci-info.S-A-10.json")}`,
      ];
    },
    writes: true,
    risk: "reversible",
    answers: ["P-SA-addonpath-space", "P-U1", "P-E01-mcp-inventory-L275"],
    initTimeoutMs: 120_000,
    exitTimeoutMs: 600_000,
    output: "ci-info",
    outputName: "addon.ci-info.S-A-10.json",
    needsShortPath: true,
    runPathInToken: true,
    onlyById: true,
  },
];

export const SHORT_PATH_REFUSAL =
  "S-A-9 refused: the sandbox folder has no Windows 8.3 short name without a space (or it could not be read), so -addonPath cannot be given unquoted";

export const RUN_PATH_SPACE_REFUSAL =
  "S-A-10 refused: the run folder path holds a space, so -ciInfoDst=<run file> cannot be given as one unquoted token";

/** The `cmd` line that prints a path's 8.3 short form (`%~sI`); read only. */
export function shortPathCommand(path: string): string {
  return `/d /s /c for %I in ("${path}") do @echo %~sI`;
}

/**
 * A usable 8.3 short path from `cmd`'s output, or null: one line, no space, no quote, not
 * flag-shaped. A folder without a short name prints its long path back (with its space).
 */
export function parseShortPath(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length !== 1) return null;
  const p = lines[0];
  if (/[\s"%]/.test(p) || p.startsWith("-") || !/^[A-Za-z]:\\/.test(p)) return null;
  return p;
}

/** The sandbox's 8.3 short path through `cmd` (execFile, no shell, nothing on stdin), or null. */
export function shortPathOf(path: string): Promise<string | null> {
  if (process.platform !== "win32" || /["%&|<>^]/.test(path)) return Promise.resolve(null);
  return new Promise((done) => {
    execFile(
      process.env.ComSpec ?? "cmd.exe",
      [shortPathCommand(path)],
      { windowsVerbatimArguments: true, windowsHide: true, timeout: 10_000 },
      (err, stdout) => done(err ? null : parseShortPath(String(stdout))),
    ).stdin?.end();
  });
}

export function stepById(id: string): StepDef | undefined {
  return STEPS.find((s) => s.id === id);
}

/**
 * The worst case of one `--only <step>` invocation: the step's two timeouts plus
 * `INVOCATION_MARGIN_MS`. The caller sets its command timeout above it (runbook section 2).
 */
export function invocationWorstCaseMs(step: StepDef): number {
  return step.initTimeoutMs + step.exitTimeoutMs + INVOCATION_MARGIN_MS;
}

// ── Injected operations ──────────────────────────────────────────────────────

export interface PidWindows {
  titles: string[];
  /** A top-level window titled like the Workbench launcher. */
  launcher: boolean;
  /** The launcher's "Missing Addon Dependencies" modal. */
  missingDepsModal: boolean;
  error: string | null;
}

export interface TopWindow {
  pid: number;
  className: string;
  title: string;
}

/** File operations on the sandbox and the repository (everything outside the artifacts folder). */
export interface FileOps {
  exists: (path: string) => boolean;
  isDir: (path: string) => boolean;
  readdir: (path: string) => string[];
  readBytes: (path: string) => Buffer;
  /** Create a new file; never overwrites. */
  writeNew: (path: string, data: Buffer | string) => void;
  /** Create one directory (its parent must exist). */
  mkdir: (path: string) => void;
  unlink: (path: string) => void;
  /** Remove an EMPTY directory. */
  rmdir: (path: string) => void;
  sha256: (path: string) => string;
}

export interface SessionDeps {
  platform: NodeJS.Platform;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  exec: ExecFn;
  powershell: (script: string, env?: Record<string, string>) => Promise<PowerShellResult>;
  spawn: (exe: string, args: string[], cwd: string) => SpawnedProcess;
  windowsOfPid: (pid: number) => Promise<PidWindows>;
  /**
   * Pids of the Workbench images descended from `pid` (a launcher stub's engine), each created
   * after its parent; read only.
   */
  childWorkbenchPids: (pid: number) => Promise<number[]>;
  /** Every process with its parent and creation time (Win32_Process; read only). */
  processTable: () => Promise<ProcRow[]>;
  listTopWindows: () => Promise<TopWindow[]>;
  captureDesktop: (label: string, dir: string) => Promise<CaptureResult>;
  /** The newest session console.log whose folder was BORN at or after `bornAfterMs`, or null. */
  findSessionLog: (bornAfterMs: number) => string | null;
  /** The newest retained session console.log, whatever its birth time, or null. */
  newestSessionLog: () => string | null;
  readLog: (path: string) => string;
  /** Pids of every running Workbench image. */
  workbenchPids: () => number[];
  /** Pids of every running `CrashReporter.exe`. */
  crashReporterPids: () => number[];
  /** Pids listening on a TCP port. */
  portListeners: (port: number) => number[];
  /** Image name of a pid, or null when it is gone. */
  imageOfPid: (pid: number) => string | null;
  /**
   * End `pid` after an image check, one process at a time (`killOwnWorkbench`): with
   * `descendants` (the default) its qualifying descendants first, then `pid`.
   */
  kill: (
    pid: number,
    opts?: { descendants?: boolean; expectCreated?: number | null },
  ) => Promise<KillResult>;
  fs: FileOps;
  checkDeps: (gproj: string) => WbDepsCheck;
  /** Every launcher project-list file, one entry per file (file reads only). */
  projectLists: () => ProjectListFile[];
  snapshot: (root: string, paths: string[]) => Manifest;
  /** Pre-flight steps 1 to 7, minus the step numbers in `skip`. */
  preflight: (
    ctx: PreflightContext,
    skip: ReadonlySet<number>,
  ) => Promise<{ ok: boolean; results: PreflightStepResult[] }>;
  log: (line: string) => void;
  /** The 8.3 short path of a folder (S-A-9), or null; read only. Absent: none is resolved. */
  shortPath?: (path: string) => Promise<string | null>;
}

export const NODE_FILE_OPS: FileOps = {
  exists: (p) => existsSync(p),
  isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
  readdir: (p) => readdirSync(p),
  readBytes: (p) => readFileSync(p),
  writeNew: (p, data) => writeFileSync(p, data, { flag: "wx" }),
  mkdir: (p) => mkdirSync(p),
  unlink: (p) => unlinkSync(p),
  rmdir: (p) => rmdirSync(p),
  sha256: (p) => sha256File(p),
};

/** PowerShell: every visible top-level window as { pid, className, title } (EnumWindows; read only). */
export const TOP_WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;",
  "public static class EmcpTopWindows {",
  "  public delegate bool EnumProc(IntPtr h, IntPtr l);",
  '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);',
  '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  "  public static List<string[]> Run() {",
  "    var rows = new List<string[]>();",
  "    EnumWindows((h, l) => {",
  "      if (!IsWindowVisible(h)) return true;",
  "      var t = new StringBuilder(512); GetWindowText(h, t, 512);",
  "      var c = new StringBuilder(256); GetClassName(h, c, 256);",
  "      uint p; GetWindowThreadProcessId(h, out p);",
  "      rows.Add(new string[] { p.ToString(), c.ToString(), t.ToString() });",
  "      return true;",
  "    }, IntPtr.Zero);",
  "    return rows;",
  "  }",
  "}",
  "'@",
  "$rows = @([EmcpTopWindows]::Run() | ForEach-Object { [pscustomobject]@{ pid = [int]$_[0]; className = $_[1]; title = $_[2] } })",
  "ConvertTo-Json -Compress -InputObject $rows",
].join("\n");

/**
 * The newest `logs_*` folder's console.log whose folder was created at or after `bornAfterMs`.
 * Birth time only: a folder's change time moves when anything is written into it, so an older
 * session's folder touched after the spawn (a crash reporter after a kill) never qualifies.
 * The rule is pre-flight's `newestSessionLog`, shared.
 */
export function sessionLogBornAfter(logsPath: string, bornAfterMs: number): string | null {
  return newestSessionLog(logsPath, bornAfterMs);
}

/** Default dependencies: the real operations, used only after the live gate has passed. */
export function defaultDeps(cfg: { logsPath: string; depsPaths: WbDepsPaths | null }): SessionDeps {
  const powershell = (script: string, env?: Record<string, string>): Promise<PowerShellResult> =>
    runPowerShell(script, { env });
  // The launcher's profile folder, next to the addons folder (read only).
  const profileDir = (): string | null =>
    cfg.depsPaths
      ? (cfg.depsPaths.profileDir ?? join(dirname(resolve(cfg.depsPaths.projectPath)), "profile"))
      : null;
  const processTable = async (): Promise<ProcRow[]> => {
    const r = await powershell(PROCESS_TREE_SCRIPT);
    const line = r.ok ? lastLine(r.stdout) : null;
    if (!line) throw new Error(`could not read the process table: ${r.error ?? r.stderr}`);
    return parseProcessTable(line);
  };
  return {
    platform: process.platform,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    exec: defaultExec,
    powershell,
    spawn: spawnWithExit,
    windowsOfPid: async (pid) => {
      const o = await inspectProcessWindows(pid);
      return {
        titles: o.windowTitles,
        launcher: o.windowFound,
        missingDepsModal: o.modalDetected,
        error: o.error,
      };
    },
    processTable,
    childWorkbenchPids: async (pid) => {
      // Only when another Workbench image runs at all: one tasklist, no PowerShell otherwise.
      const others = processesByImage(defaultExec, WORKBENCH_EXE).filter((r) => r.pid !== pid);
      if (others.length === 0) return [];
      return descendantPlan(await processTable(), pid)
        .end.filter((r) => r.name.toLowerCase() === WORKBENCH_EXE.toLowerCase())
        .map((r) => r.pid);
    },
    listTopWindows: async () => {
      const r = await powershell(TOP_WINDOWS_SCRIPT);
      const line = r.ok ? lastLine(r.stdout) : null;
      if (!line) throw new Error(`could not list top-level windows: ${r.error ?? r.stderr}`);
      const rows = JSON.parse(line) as TopWindow[] | TopWindow;
      return Array.isArray(rows) ? rows : [rows];
    },
    captureDesktop: (label, dir) => captureDesktop({ label, dir, gateReason: null }),
    findSessionLog: (after) => sessionLogBornAfter(cfg.logsPath, after),
    newestSessionLog: () => newestSessionLog(cfg.logsPath),
    readLog: (p) => readFileSync(p, "utf-8"),
    workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid),
    crashReporterPids: () => processesByImage(defaultExec, CRASH_REPORTER_IMAGE).map((r) => r.pid),
    portListeners: (port) => portListeners(defaultExec, port),
    imageOfPid: (pid) => processByPid(defaultExec, pid)?.image ?? null,
    kill: (pid, opts) => killOwnWorkbench({ exec: defaultExec, processTable }, pid, opts),
    fs: NODE_FILE_OPS,
    checkDeps: (gproj) => {
      if (!cfg.depsPaths) throw new Error("no configuration for the dependency check");
      return checkWorkbenchVisibleDeps(gproj, cfg.depsPaths);
    },
    // Read only: the launcher's project lists, from the profile next to the addons folder.
    projectLists: () => {
      const dir = profileDir();
      return dir ? readProjectLists(dir) : [];
    },
    snapshot: (root, paths) => takeSnapshot(root, paths),
    preflight: (ctx, skip) =>
      runPreflight(
        ctx,
        PREFLIGHT_STEPS.slice(0, 7).filter((_, i) => !skip.has(i + 1)),
      ),
    log: (line) => console.log(line),
    shortPath: shortPathOf,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * `-addonsDir` from the sandbox's dependencies: none when every dependency resolves to the
 * base game or the Tools core; the addon roots (comma-joined, the wiki's `<p1,p2>` form) of the
 * others. A workshop-only or missing dependency refuses: the launcher would hold on its
 * Missing Addon Dependencies modal (DEC-021).
 */
export function addonsDirFromDeps(
  check: WbDepsCheck,
  override?: string,
): { args: string[]; refusal: string | null; detail: string } {
  const bad = check.findings.filter((f) => f.status !== "wb-visible");
  if (bad.length > 0) {
    return {
      args: [],
      refusal: `dependencies not visible to Workbench: ${bad.map((f) => `${f.guid} (${f.status})`).join(", ")}`,
      detail: "",
    };
  }
  const dirs = new Set<string>();
  for (const f of check.findings) {
    if (f.locationKind === "base-game" || f.locationKind === "core-tools") continue;
    if (f.gprojPath) dirs.add(dirname(dirname(resolve(f.gprojPath))));
  }
  if (override !== undefined) {
    if (override.startsWith("-")) {
      return { args: [], refusal: `flag-shaped -addonsDir value: ${override}`, detail: "" };
    }
    dirs.add(resolve(override));
  }
  const n = check.findings.length;
  const detail = `${n} dependenc${n === 1 ? "y" : "ies"}, all visible to Workbench; -addonsDir ${
    dirs.size === 0 ? "not needed" : [...dirs].join(",")
  }`;
  return {
    args: dirs.size === 0 ? [] : ["-addonsDir", [...dirs].join(",")],
    refusal: null,
    detail,
  };
}

/** The launch argv of a step (after the executable). */
export function stepArgs(
  step: StepDef,
  gproj: string,
  addonsDirArgs: string[],
  v: VerbInput,
): string[] {
  if (gproj.startsWith("-")) throw new Error(`Refusing flag-shaped project path: ${gproj}`);
  if (!gproj.toLowerCase().endsWith(".gproj"))
    throw new Error(`Project path must be a .gproj file: ${gproj}`);
  if (step.form === "old") {
    if (step.writes) throw new Error(`${step.id}: the old arguments run the read-only verb only`);
    return ["-wbProjectPath", gproj, ...step.verb(v)];
  }
  return ["-gproj", gproj, ...addonsDirArgs, ...step.verb(v)];
}

/** Milliseconds since local midnight (log lines carry local time of day [unverified]). */
export function localMsOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
}

export interface LogFacts {
  initSeen: boolean;
  initMsOfDay: number | null;
  firstMsOfDay: number | null;
  /** Raw capture of the opened-project line (a folder name); never written unless scrubbed. */
  opened: string | null;
  /** The `CLI Params:` message. */
  echo: string | null;
  /** `Workbench Create Engine took` seen (the launcher-hold watchdog's arming marker). */
  engineCreated: boolean;
  /** AddonBuildInfoTool's "Could not find addon matching path" line seen (its exit 3). */
  addonNotFound: boolean;
  hazards: Record<string, number>;
  /** Messages of `SCRIPT (E)` lines. */
  scriptErrors: string[];
  /** Lines that mention compiling, any level. */
  compileLines: string[];
  /**
   * The last project of the last `Loaded addons:` list (E13's cross-check, which agreed with the
   * opened-project line in 10 of 10 sessions). Supporting data only: it never decides.
   */
  lastLoadedAddon: string | null;
}

const OPENED_RE = new RegExp(OPENED_PROJECT_PATTERN);

/** Facts of one session console.log, by E13's line parser and patterns. */
export function readLogFacts(text: string): LogFacts {
  const facts: LogFacts = {
    initSeen: false,
    initMsOfDay: null,
    firstMsOfDay: null,
    opened: null,
    echo: null,
    engineCreated: false,
    addonNotFound: false,
    hazards: {},
    scriptErrors: [],
    compileLines: [],
    lastLoadedAddon: null,
  };
  let inAddonList = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const l = parseLogLine(raw);
    if (l.channel === "ENGINE" && /^Loaded addons:\s*$/.test(l.message)) {
      inAddonList = true;
      continue;
    }
    if (inAddonList) {
      const g = /^gproj: '([^']+)'/.exec(l.message);
      if (g) facts.lastLoadedAddon = projectNameOfGproj(g[1]);
      else inAddonList = false;
    }
    if (facts.firstMsOfDay === null && l.ms !== null) facts.firstMsOfDay = l.ms;
    if (!facts.initSeen && /Workbench Init Engine\s*$/.test(l.message)) {
      facts.initSeen = true;
      facts.initMsOfDay = l.ms;
    }
    const o = OPENED_RE.exec(l.message);
    if (o && facts.opened === null) facts.opened = o[1];
    if (facts.echo === null && l.channel === "ENGINE" && /^CLI Params:/.test(l.message)) {
      facts.echo = l.message;
    }
    if (l.message.includes(ENGINE_CREATED_MARKER)) facts.engineCreated = true;
    if (l.message.includes(ADDON_NOT_FOUND_MESSAGE)) facts.addonNotFound = true;
    if (!/^Module:/.test(l.message) && !/\bdefines:/.test(l.message)) {
      for (const h of HAZARDS)
        if (h.test.test(l.message)) facts.hazards[h.key] = (facts.hazards[h.key] ?? 0) + 1;
    }
    if (l.channel === "SCRIPT" && l.level === "E") facts.scriptErrors.push(l.message);
    if (/compil/i.test(l.message)) facts.compileLines.push(raw.trim());
  }
  return facts;
}

/** The sandbox's project name as the opened-project line names it (E13: the .gproj stem). */
export function sandboxProjectName(gproj: string): string {
  return projectNameOfGproj(gproj) ?? SANDBOX_NAME;
}

/** A project name the 2.0 lane may write: the sandbox, the decoy, or Bohemia's own. */
export function isKnownProject(name: string, gproj: string): boolean {
  const n = name.toLowerCase();
  return (
    n === sandboxProjectName(gproj).toLowerCase() ||
    n === DECOY_NAME.toLowerCase() ||
    BASE_PROJECT_NAMES.has(n)
  );
}

/** The opened project as it may be written: a known name, else a token. */
export function scrubProjectName(opened: string, gproj: string): string {
  return isKnownProject(opened, gproj) ? opened : "<other-project>";
}

/** The decoy's `.gproj` (its stem is the name the opened-project line gives). */
export function decoyGproj(decoyDir: string): string {
  return join(decoyDir, `${DECOY_NAME}.gproj`);
}

/** Switch names of a launch's argv, lowercased (`-validate=PC` gives `validate`). */
export function switchNames(args: string[]): string[] {
  return args
    .filter((a) => /^-{1,2}[A-Za-z]/.test(a))
    .map((a) => a.replace(/^-+/, "").split("=")[0].toLowerCase());
}

/** True when a `CLI Params:` echo carries every switch this launch passed (E13's echo parser). */
export function echoMatches(echo: string, args: string[]): boolean {
  const have = new Set(
    parseCliEcho(echo.replace(/^CLI Params:\s*/, "")).map((t) => t.switch.toLowerCase()),
  );
  const want = switchNames(args);
  return want.length > 0 && want.every((w) => have.has(w));
}

// ── Action plan (dry-run gate) ───────────────────────────────────────────────

export interface ScheduledStep {
  step: StepDef;
  args: string[];
  commandLine: string;
}

/**
 * The session's action plan in the format `dry-run.ts` checks: per step, the `launch` (its
 * switches against the deny lists, its project against the 2.0 sandbox) and the desktop capture
 * taken only on a timeout. No key, invoke, menu, execute-action or NET call exists in this
 * session. S-A-1's launch names its project with the old `-wbProjectPath`, which may be ignored;
 * it carries the decoy precondition (`launcherLast: "EMCP2_decoy"`) only when the owner's
 * confirmation was given (`--launcher-last-is-decoy`), so a plan without it fails the checker.
 */
export function buildActionPlan(
  schedule: ScheduledStep[],
  ph: PlaceholderContext,
  opts: { gproj: string; launcherLastIsDecoy: boolean },
): PlanAction[] {
  const out: PlanAction[] = [];
  for (const s of schedule) {
    out.push({
      kind: "launch",
      step: s.step.id,
      target: { gproj: toPlaceholders(opts.gproj, ph) } as unknown as PlanAction["target"],
      args: s.args.map((a) => toPlaceholders(a, ph)),
      ...(s.step.form === "old" && opts.launcherLastIsDecoy
        ? { precondition: { launcherLast: DECOY_NAME } }
        : {}),
      answers: s.step.answers,
    });
    out.push({
      kind: "screenshot",
      step: s.step.id,
      when: "only after a timeout or an idle end, before the script stops for the main session (plan 5.3)",
      answers: s.step.answers,
      launch: toPlaceholders(s.commandLine, ph),
    });
  }
  return out;
}

// ── U14 plant and rollback ───────────────────────────────────────────────────

export interface PlantManifest {
  step: StepId;
  kind: "control" | "broken";
  /** Sandbox-relative paths (forward slashes); no absolute path is stored. */
  folder: string;
  created_dirs: string[];
  files: Array<{ path: string; sha256: string }>;
  /** Hash manifest of `Scripts/` before planting. */
  before_scripts: Record<string, string>;
  planted_at: string;
}

export interface RollbackResult {
  ok: boolean;
  removed: string[];
  /** Planted files whose hash changed: left in place. */
  changed: string[];
  /** Files in the planted folder this run did not plant: left in place. */
  extra: string[];
  dirs_removed: string[];
  net_zero: boolean;
  detail: string;
}

function rel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

/** A failed plant: whatever was written has been rolled back (`rollback` says how well). */
export class PlantError extends Error {
  constructor(
    message: string,
    readonly rollback: RollbackResult | null,
  ) {
    super(message);
  }
}

/**
 * Plant the U14 throwaway copy: every `.c` of the shipped handler set copied into
 * `<sandbox>/Scripts/WorkbenchGame/EMCP2_U14_Throwaway/`, plus the broken file for `broken`.
 * Kill criteria checked first: a handler set or probe pack installed in the sandbox, or the
 * throwaway folder already present. `persist` receives the manifest before the first write and
 * after every directory and file, so a crash mid-plant leaves a manifest the rollback command
 * can use; a write that fails rolls back what was written and throws a `PlantError`.
 */
export function plantU14(
  step: StepDef,
  sandboxDir: string,
  bundledDir: string,
  deps: Pick<SessionDeps, "fs" | "snapshot" | "now">,
  persist: (m: PlantManifest) => void = () => {},
): PlantManifest {
  const kind = step.plant;
  if (!kind) throw new Error(`${step.id} plants nothing`);
  const fs = deps.fs;
  const wbGame = join(sandboxDir, "Scripts", "WorkbenchGame");
  for (const f of [HANDLER_FOLDER, PROBE_PACK_FOLDER]) {
    if (fs.exists(join(wbGame, f))) {
      throw new Error(
        `kill criterion: Scripts/WorkbenchGame/${f} exists in the sandbox; S-A installs no handler and the copy would duplicate its classes`,
      );
    }
  }
  const target = join(wbGame, U14_FOLDER);
  if (fs.exists(target)) {
    throw new Error(
      `kill criterion: ${rel(sandboxDir, target)} already exists (an earlier plant was not rolled back)`,
    );
  }
  const sources = fs
    .readdir(bundledDir)
    .filter((f) => f.endsWith(".c"))
    .sort();
  if (sources.length === 0) throw new Error(`shipped handler set is empty: ${bundledDir}`);
  const m: PlantManifest = {
    step: step.id,
    kind,
    folder: rel(sandboxDir, target),
    created_dirs: [],
    files: [],
    before_scripts: deps.snapshot(sandboxDir, ["Scripts"]).files,
    planted_at: new Date(deps.now()).toISOString(),
  };
  persist(m);
  try {
    for (const d of [join(sandboxDir, "Scripts"), wbGame, target]) {
      if (!fs.exists(d)) {
        fs.mkdir(d);
        m.created_dirs.push(rel(sandboxDir, d));
        persist(m);
      }
    }
    const put = (name: string, data: Buffer | string): void => {
      const p = join(target, name);
      fs.writeNew(p, data);
      m.files.push({ path: rel(sandboxDir, p), sha256: fs.sha256(p) });
      persist(m);
    };
    for (const f of sources) put(f, fs.readBytes(join(bundledDir, f)));
    if (kind === "broken") put(U14_BROKEN_FILE, U14_BROKEN_SOURCE);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    let rb: RollbackResult | null = null;
    try {
      rb = rollbackU14(m, sandboxDir, deps);
    } catch (e2) {
      throw new PlantError(
        `plant failed: ${why}; rollback failed too: ${e2 instanceof Error ? e2.message : String(e2)}`,
        null,
      );
    }
    throw new PlantError(
      `plant failed: ${why}; rolled back: ${rb.ok ? "net-zero" : `INCOMPLETE: ${rb.detail}`}`,
      rb,
    );
  }
  return m;
}

/** The plant folder every manifest must name, relative to the sandbox. */
export const U14_MANIFEST_FOLDER = `Scripts/WorkbenchGame/${U14_FOLDER}`;

/**
 * Why a plant manifest may not steer a rollback, or null (DEC-034, m-3): its folder must be
 * exactly `Scripts/WorkbenchGame/EMCP2_U14_Throwaway`; every file path must start with that
 * folder and a slash, hold no `..`, no backslash and no drive colon, and resolve inside the
 * folder; every created directory must be that folder or one of its two parents.
 */
export function plantManifestRefusal(m: PlantManifest, sandboxDir: string): string | null {
  if (!m || typeof m !== "object") return "the manifest is not an object";
  if (m.folder !== U14_MANIFEST_FOLDER) {
    return `its folder is ${JSON.stringify(m.folder)}, not ${U14_MANIFEST_FOLDER}`;
  }
  if (!Array.isArray(m.files) || !Array.isArray(m.created_dirs)) {
    return "its files or created_dirs is not a list";
  }
  const folderAbs = resolve(sandboxDir, ...U14_MANIFEST_FOLDER.split("/"));
  for (const f of m.files) {
    const p = f && typeof f.path === "string" ? f.path : null;
    if (
      p === null ||
      !p.startsWith(`${U14_MANIFEST_FOLDER}/`) ||
      p.includes("..") ||
      p.includes("\\") ||
      p.includes(":")
    ) {
      return `the file path ${JSON.stringify(p)} does not lie inside ${U14_MANIFEST_FOLDER}`;
    }
    const abs = resolve(sandboxDir, ...p.split("/"));
    if (!abs.startsWith(folderAbs + sep)) {
      return `the file path ${JSON.stringify(p)} resolves outside ${U14_MANIFEST_FOLDER}`;
    }
  }
  const allowedDirs = new Set(["Scripts", "Scripts/WorkbenchGame", U14_MANIFEST_FOLDER]);
  for (const d of m.created_dirs) {
    if (typeof d !== "string" || !allowedDirs.has(d)) {
      return `the created directory ${JSON.stringify(d)} is not ${U14_MANIFEST_FOLDER} or one of its parents`;
    }
  }
  return null;
}

/**
 * Remove what `plantU14` planted: each file only when its hash is unchanged, then the
 * directories the plant created, only when empty. Anything else in the folder is reported and
 * left in place. Then `Scripts/` is hashed again and compared with the hash taken before the
 * plant: net-zero is the rollback's pass. A manifest whose paths leave the throwaway folder
 * (`plantManifestRefusal`) throws before anything is touched.
 */
export function rollbackU14(
  m: PlantManifest,
  sandboxDir: string,
  deps: Pick<SessionDeps, "fs" | "snapshot" | "now">,
): RollbackResult {
  const refused = plantManifestRefusal(m, sandboxDir);
  if (refused) throw new Error(`plant manifest refused: ${refused}; nothing removed`);
  const fs = deps.fs;
  const out: RollbackResult = {
    ok: false,
    removed: [],
    changed: [],
    extra: [],
    dirs_removed: [],
    net_zero: false,
    detail: "",
  };
  for (const f of m.files) {
    const p = join(sandboxDir, ...f.path.split("/"));
    if (!fs.exists(p)) continue;
    if (fs.sha256(p) !== f.sha256) {
      out.changed.push(f.path);
      continue;
    }
    fs.unlink(p);
    out.removed.push(f.path);
  }
  const folder = join(sandboxDir, ...m.folder.split("/"));
  if (fs.exists(folder)) out.extra = fs.readdir(folder).map((n) => `${m.folder}/${n}`);
  if (out.changed.length === 0 && out.extra.length === 0) {
    for (const d of [...m.created_dirs].reverse()) {
      const p = join(sandboxDir, ...d.split("/"));
      if (fs.exists(p) && fs.readdir(p).length === 0) {
        fs.rmdir(p);
        out.dirs_removed.push(d);
      }
    }
  }
  const after = deps.snapshot(sandboxDir, ["Scripts"]);
  const before: Manifest = {
    root: after.root,
    declared: ["Scripts"],
    taken_at: m.planted_at,
    files: m.before_scripts,
  };
  const d = diff(before, after, []);
  out.net_zero = isNetZero(d);
  out.ok = out.net_zero && out.changed.length === 0 && out.extra.length === 0;
  out.detail = out.ok
    ? `removed ${out.removed.length} planted files and ${out.dirs_removed.length} directories; Scripts/ is net-zero`
    : [
        out.changed.length
          ? `changed since planting, left in place: ${out.changed.join(", ")}`
          : "",
        out.extra.length ? `not planted by this run, left in place: ${out.extra.join(", ")}` : "",
        !out.net_zero
          ? `Scripts/ differs from before the plant: added ${d.added.join(", ") || "none"}; removed ${d.removed.join(", ") || "none"}; changed ${d.changed.join(", ") || "none"}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
  return out;
}

// ── Session ──────────────────────────────────────────────────────────────────

export interface SessionConfig {
  lane: Lane;
  really: boolean;
  workbenchPath: string;
  gamePath: string;
  sandboxDir: string;
  gproj: string;
  logsPath: string;
  /** The artifacts folder (`paths.ts artifactsDir()`): run and evidence folders must lie inside. */
  artifactsRoot: string;
  runDir: string;
  evidenceDir: string;
  /** The 2.0 decoy addon folder (`EMCP2_decoy`), beside the sandbox by default. */
  decoyDir: string;
  /** The main session confirms the owner opened the decoy last from the launcher (S-A-1). */
  launcherLastIsDecoy: boolean;
  /** Plan 5.3 step 6 for the shipped set S-A-6/7 copy: the Enforce lint passed or is triaged. */
  lint: "passed" | "triaged" | null;
  queuePath: string;
  ledgerMetaPath: string;
  registryKey: string | null;
  validateConfig: string;
  bundledHandlerDir: string;
  launcherKnowsSandbox: boolean;
  addonsDirOverride?: string;
  /** Run from this step on (a later step than any with a result in the run folder). */
  from?: StepId;
  /** Run this step only. */
  only?: StepId;
  port: number;
  build: string;
  policy: CensusPolicy;
  /** Placeholder context for everything written or printed. */
  ph: PlaceholderContext;
  outPlan?: string;
  /** The idle rule's quiet period (`IDLE_QUIET_MS` when absent; `--idle-quiet-ms`). */
  idleQuietMs?: number;
  /** The idle rule's CPU floor in percent of one core (`IDLE_CPU_PERCENT`; `--idle-cpu-percent`). */
  idleCpuPercent?: number;
}

export interface StepRecord {
  step: StepId;
  title: string;
  answers: string[];
  form: "old" | "new";
  risk: string;
  command_line: string;
  outcome: Outcome;
  /** The Headless CLI variant's three results, when the step failed in one of them. */
  failure_result: FailureResult | null;
  continue_session: boolean;
  assertion: "pass" | "fail" | "none";
  opened_project: string | null;
  /** Supporting data: the last addon of the log's `Loaded addons:` list (never decides). */
  last_loaded_addon: string | null;
  init: {
    seen: boolean;
    spawn_to_init_seen_ms: number | null;
    log_spawn_to_init_ms: number | null;
    log_create_to_init_ms: number | null;
  };
  exit: {
    by_itself: boolean;
    code: number | null;
    code_int32: number | null;
    signal: string | null;
    killed_by_run: boolean;
    after_ms: number | null;
  };
  pid: number | null;
  /** The session console.log this step read (placeholders applied when written). */
  session_log: string | null;
  /**
   * How the log was chosen: `matched` (born after the spawn, its echo carries this launch's
   * switches; the only state in which the opened-project line counts), `echo-mismatch`,
   * `no-echo` (a log with no `CLI Params:` line yet, the launcher-hold signature), `no-log`.
   */
  session_log_match: "matched" | "echo-mismatch" | "no-echo" | "no-log";
  cli_echo: string | null;
  /** What the launcher-hold decision saw, when a launcher window appeared. */
  launcher: {
    window_polls: number;
    engine_marker_seen: boolean;
    cli_echo_seen: boolean;
    quiet_ms_at_decision: number | null;
    registration: "registered" | "not-registered" | "unknown";
  } | null;
  /** The decoy addon before and after the step (relative paths inside the decoy). */
  decoy: { net_zero: boolean; added: string[]; removed: string[]; changed: string[] } | null;
  /**
   * The sandbox root's top-level entries just before the spawn and after the launch (a
   * directory ends in `/`): a new file or folder at the root, such as `resourceDatabase.rdb`.
   */
  sandbox_root: { added: string[]; removed: string[] } | null;
  /**
   * The window probes of the poll loop (the started pid and its child Workbench images):
   * how many failed, the last error, and the child pids seen.
   */
  window_probe: { errors: number; last_error: string | null; child_pids: number[] };
  /**
   * The launcher's project lists just before the spawn and after the launch, per Steam app
   * number: whether each names the sandbox and the decoy, what is first, when it was written
   * (which list a launch reads and writes is a question of the sitting, DEC-031).
   */
  launcher_lists: { before: ListSummary[]; after: ListSummary[] } | null;
  /** What a kill of this step did, process by process (DEC-031), or null when none ran. */
  kill: KillResult | null;
  /** Workbench pids still running after the started pid exited (not started by this run). */
  leftover_pids: number[];
  /** Set when free text was dropped because the log named a project that is not ours. */
  redacted: string | null;
  windows_seen: string[];
  hazards: Record<string, number>;
  script_errors: {
    count: number;
    naming_broken_file: number;
    naming_other_planted: number;
    lines: string[];
  };
  compile_lines: string[];
  /** S-A-7: the WorkbenchGame module did not compile, or an (E) line names the planted file. */
  workbench_module_failed: boolean;
  output: Record<string, unknown> | null;
  plant: { folder: string; files: number } | null;
  rollback: RollbackResult | { pending: string } | null;
  /**
   * The idle rule after the opened-project line (DEC-033), or null when the project never
   * opened: its settings, how many table reads it made and how many failed, the last window it
   * measured (the CPU time the process used over a span with no log growth) and whether it ended
   * the step.
   */
  idle: {
    quiet_ms: number;
    cpu_percent: number;
    samples: number;
    table_errors: number;
    window_ms: number | null;
    cpu_ms: number | null;
    decided: boolean;
  } | null;
  /**
   * What ended the step when the harness ended it on evidence: `verdict` for a validate step
   * (S-A-3, S-A-6, S-A-7) whose matched session's log gave the validation verdict, after which
   * the started process was ended through the checked end. Null otherwise.
   */
  ended_on: "verdict" | null;
  /** The validation verdict a validate step ended on, or null when it ended otherwise. */
  verdict: {
    verdict: "successful" | "failed";
    spawn_to_verdict_ms: number;
    error_lines: string[];
    /** File names (`.c`) the error lines name. */
    files_named: string[];
  } | null;
  timeout: {
    /**
     * `window-probe`: the window probe failed on consecutive polls (stopped as a timeout).
     * `idle`: the idle rule ended the step (outcome `idle`), with the same capture and stop.
     */
    phase: "init" | "exit" | "window-probe" | "idle";
    capture: string;
    windows: string[];
    log_tail: string[];
  } | null;
  detail: string;
  started_at: string;
}

export interface RunState {
  assertionPassed: boolean;
  validateSelfExit: boolean;
  /** `SCRIPT (E)` lines of S-A-3's clean validate: the baseline U14 compares against. */
  validateErrorBaseline: number;
  controlClean: boolean;
  lastHeartbeat: number;
  /**
   * Whether every launcher project list names the sandbox. Recorded with a hold as evidence
   * only: a hold at the picker is "launcher held" whatever this says, never "flag ignored"
   * (DEC-031).
   */
  sandboxRegistration: "registered" | "not-registered" | "unknown";
  /** Session logs an earlier step of this invocation read: never read again. */
  usedLogs: Set<string>;
  /** The sandbox's 8.3 short path (S-A-9), resolved at run time; null or absent when none. */
  sandboxShortDir?: string | null;
}

export interface SessionSummary {
  mode: "dry-run" | "refused" | "real";
  ok: boolean;
  plan: PlanAction[];
  schedule: ScheduledStep[];
  preflight: PreflightStepResult[];
  records: StepRecord[];
  stopped: string | null;
  exitCode: number;
}

function preflightContext(
  cfg: SessionConfig,
  deps: SessionDeps,
  snapshotPaths: string[],
): PreflightContext {
  return {
    variant: "headless-cli",
    lane: cfg.lane,
    purpose: "S-A headless CLI sitting (U1, U14 headless half, L13)",
    really: cfg.really,
    platform: deps.platform,
    workbenchPath: cfg.workbenchPath,
    gamePath: cfg.gamePath,
    port: cfg.port,
    sandboxDir: cfg.sandboxDir,
    gproj: cfg.gproj,
    artifactsDir: cfg.runDir,
    ledgerMetaPath: cfg.ledgerMetaPath,
    queuePath: cfg.queuePath,
    snapshotPaths,
    registryKey: cfg.registryKey,
    u12Passed: false,
    lint: cfg.lint,
    probePack: false,
    headlessArgs: [],
    launcherKnowsSandbox: cfg.launcherKnowsSandbox,
    ownerYesAboveMutating: false,
    openedProjectPattern: OPENED_PROJECT_PATTERN,
    sessionLog: null,
    exec: deps.exec,
    powershell: deps.powershell,
    now: () => new Date(deps.now()),
    state: {},
  };
}

/** Steps this invocation runs, in order. */
export function selectSteps(cfg: Pick<SessionConfig, "from" | "only">): StepDef[] {
  if (cfg.only) return STEPS.filter((s) => s.id === cfg.only);
  // S-A-8 (retired) and S-A-9 are follow-up probes (P-SA-builddata-form, P-SA-addonpath-space): one
  // launch each, by --only only, never part of a full or --from sequence.
  const seq = STEPS.filter((s) => !s.onlyById);
  if (cfg.from) {
    const i = seq.findIndex((s) => s.id === cfg.from);
    return i < 0 ? [] : seq.slice(i);
  }
  return seq;
}

function resultPath(runDir: string, id: StepId): string {
  return join(runDir, `${id}.json`);
}

/**
 * Step results already in the run folder (a resumed run). `present` lists every step that has a
 * result file (it never runs again in this run). `verified` holds only the results an evidence
 * record in `evidenceDir` hashes (same file name, same sha256): only those open the gates of
 * later steps, so a hand-written or stale result never stands in for a passed assertion.
 */
export function priorRecords(
  runDir: string,
  evidenceDir: string,
): { present: StepId[]; verified: StepRecord[]; unverified: StepId[] } {
  const out = { present: [] as StepId[], verified: [] as StepRecord[], unverified: [] as StepId[] };
  if (!existsSync(runDir)) return out;
  const cited = new Set<string>();
  if (existsSync(evidenceDir)) {
    for (const f of readdirSync(evidenceDir).filter((n) => /^EV-S-A-\d+\.json$/.test(n))) {
      try {
        const ev = JSON.parse(readFileSync(join(evidenceDir, f), "utf-8")) as {
          artifacts?: Array<{ path?: string; sha256?: string }>;
        };
        for (const a of ev.artifacts ?? []) {
          const base = (a.path ?? "").split(/[\\/]/).pop() ?? "";
          if (/^S-A-\d\.json$/.test(base) && a.sha256) cited.add(`${base}|${a.sha256}`);
        }
      } catch {
        // An unreadable evidence record vouches for nothing.
      }
    }
  }
  for (const s of STEPS) {
    const p = resultPath(runDir, s.id);
    if (!existsSync(p)) continue;
    out.present.push(s.id);
    if (cited.has(`${s.id}.json|${sha256File(p)}`)) {
      out.verified.push(JSON.parse(readFileSync(p, "utf-8")) as StepRecord);
    } else {
      out.unverified.push(s.id);
    }
  }
  return out;
}

/** First-run baseline of a run folder: post-flight's inputs, as file names in the run folder. */
export interface Baseline {
  snapshot_file: string | null;
  registry_export: string | null;
  written_at: string;
}

export const BASELINE_FILE = "baseline.json";

function emptyRecord(step: StepDef, commandLine: string, startedAt: number): StepRecord {
  return {
    step: step.id,
    title: step.title,
    answers: step.answers,
    form: step.form,
    risk: step.risk,
    command_line: commandLine,
    outcome: "refused",
    failure_result: null,
    continue_session: false,
    assertion: "none",
    opened_project: null,
    last_loaded_addon: null,
    init: {
      seen: false,
      spawn_to_init_seen_ms: null,
      log_spawn_to_init_ms: null,
      log_create_to_init_ms: null,
    },
    exit: {
      by_itself: false,
      code: null,
      code_int32: null,
      signal: null,
      killed_by_run: false,
      after_ms: null,
    },
    pid: null,
    session_log: null,
    session_log_match: "no-log",
    cli_echo: null,
    launcher: null,
    decoy: null,
    sandbox_root: null,
    window_probe: { errors: 0, last_error: null, child_pids: [] },
    launcher_lists: null,
    kill: null,
    leftover_pids: [],
    redacted: null,
    windows_seen: [],
    hazards: {},
    script_errors: { count: 0, naming_broken_file: 0, naming_other_planted: 0, lines: [] },
    compile_lines: [],
    workbench_module_failed: false,
    output: null,
    plant: null,
    rollback: null,
    idle: null,
    ended_on: null,
    verdict: null,
    timeout: null,
    detail: "",
    started_at: new Date(startedAt).toISOString(),
  };
}

/** Write one step's result into the run folder and its evidence record. */
export function writeRecord(cfg: SessionConfig, deps: SessionDeps, r: StepRecord): string {
  mkdirSync(cfg.runDir, { recursive: true });
  const path = resultPath(cfg.runDir, r.step);
  writeFileSync(path, JSON.stringify(rewriteStrings(r, cfg.ph), null, 2) + "\n", {
    encoding: "utf-8",
    flag: "wx",
  });
  const artifacts = [{ path, sha256: sha256File(path) }];
  const logs = r.session_log ? [r.session_log, join(dirname(r.session_log), "script.log")] : [];
  if (r.timeout && r.timeout.capture && existsSync(r.timeout.capture)) logs.push(r.timeout.capture);
  for (const a of logs) {
    try {
      if (deps.fs.exists(a)) artifacts.push({ path: a, sha256: deps.fs.sha256(a) });
    } catch {
      // A log that vanished is not evidence; the step result names what was read.
    }
  }
  const summary =
    `${r.step} (answers ${r.answers.join(", ")}): ${r.outcome}` +
    (r.failure_result ? ` [${r.failure_result}]` : "") +
    `; opened ${r.opened_project ?? "none named"}; assertion ${r.assertion}; ` +
    `exit ${r.exit.by_itself ? `by itself, code ${r.exit.code}` : r.exit.killed_by_run ? "killed by this run" : "not observed"}` +
    (r.detail ? `; ${r.detail}` : "");
  const ev = writeEvidence(
    cfg.evidenceDir,
    SESSION_ID,
    { ran: r.command_line, build: cfg.build, result_summary: summary, artifacts },
    cfg.ph,
    new Date(deps.now()),
  );
  return ev.record.id;
}

function scrubLines(lines: string[], ph: PlaceholderContext, max: number): string[] {
  return lines.slice(0, max).map((l) => toPlaceholders(l, ph).slice(0, 300));
}

/** Count files under `dir` modified at or after `sinceMs` (the artifacts folder only). */
function countOutput(dir: string, sinceMs: number): { files: number; fresh: number } {
  let files = 0;
  let fresh = 0;
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      if (files > 20_000) return;
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) {
        files++;
        if (st.mtimeMs >= sinceMs) fresh++;
      }
    }
  };
  walk(dir);
  return { files, fresh };
}

/** The decoy's snapshot paths: every top-level entry but .git. */
function decoyPaths(decoyDir: string, fs: FileOps): string[] {
  return fs.exists(decoyDir)
    ? fs
        .readdir(decoyDir)
        .filter((n) => n !== ".git")
        .sort()
    : [];
}

/** The sandbox root's top-level entries but .git, sorted; a directory ends in `/`. */
function sandboxRootEntries(sandboxDir: string, fs: FileOps): string[] {
  if (!fs.exists(sandboxDir)) return [];
  return fs
    .readdir(sandboxDir)
    .filter((n) => n !== ".git")
    .map((n) => (fs.isDir(join(sandboxDir, n)) ? `${n}/` : n))
    .sort();
}

/**
 * Why S-A-1 may not run, read from files only (DEC-030 M1, DEC-031 M-1), or null: every
 * launcher project-list file must be readable and have the decoy as its FIRST entry, and the
 * newest retained session log's opened-project line must name the decoy (the owner opened it
 * last, in both ways, after the lane started). Owner project names are never printed; Steam app
 * numbers are.
 */
export function decoyPreselectionRefusal(
  cfg: Pick<SessionConfig, "decoyDir" | "gproj">,
  deps: Pick<SessionDeps, "projectLists" | "newestSessionLog" | "readLog">,
): string | null {
  const decoy = normGproj(decoyGproj(cfg.decoyDir));
  let lists: ProjectListFile[];
  try {
    lists = deps.projectLists();
  } catch {
    lists = [];
  }
  if (lists.length === 0) {
    return "the launcher's project lists could not be read: registration unknown, so the decoy's place in them cannot be checked";
  }
  const unreadable = lists.filter((l) => !l.readable);
  if (unreadable.length > 0) {
    return (
      `the launcher's project list of app ${unreadable.map((l) => l.app).join(", ")} could not be read ` +
      "(missing, another encoding or another format), so the decoy's place in it cannot be checked"
    );
  }
  const notDecoy = lists.filter((l) => l.entries.length === 0 || normGproj(l.entries[0]) !== decoy);
  if (notDecoy.length > 0) {
    return (
      `the decoy ${DECOY_NAME} is not the first entry of the launcher's project list of app ` +
      `${notDecoy.map((l) => l.app).join(", ")} (${notDecoy.length} of ${lists.length} lists); the owner opens ` +
      "the decoy last in both ways, from Steam's Tools launcher and from the direct start (runbook section 2)"
    );
  }
  let newest: string | null;
  try {
    newest = deps.newestSessionLog();
  } catch {
    newest = null;
  }
  if (newest === null) {
    return `no retained session log to confirm that ${DECOY_NAME} was the last project opened`;
  }
  let opened: string | null;
  try {
    opened = readLogFacts(deps.readLog(newest)).opened;
  } catch {
    opened = null;
  }
  if (opened === null || opened.toLowerCase() !== DECOY_NAME.toLowerCase()) {
    return (
      `the newest session log's opened-project line names ${opened === null ? "no project" : scrubProjectName(opened, cfg.gproj)}, ` +
      `not ${DECOY_NAME}: the owner opens the decoy from the launcher last, after the lane started`
    );
  }
  return null;
}

/**
 * Drop the free-text fields of a record (window titles, log lines): the log named a project that
 * is not ours, and plan 5.2 treats owner project names as personal data. Engine-relative script
 * paths (`scripts/Game/<project>/...`) are not absolute, so placeholders cannot catch them.
 */
function redactFreeText(r: StepRecord, why: string): void {
  const n =
    r.windows_seen.length +
    r.script_errors.lines.length +
    r.compile_lines.length +
    (r.timeout ? r.timeout.log_tail.length + r.timeout.windows.length : 0);
  r.windows_seen = [];
  r.script_errors.lines = [];
  r.compile_lines = [];
  if (r.timeout) {
    r.timeout.log_tail = [];
    r.timeout.windows = [`${r.timeout.windows.length} window lines (not recorded)`];
  }
  r.redacted = `${n} free-text lines dropped: ${why}`;
}

const TIMEOUT_RECOVERY =
  "look at the capture, the window list and the log tail, then decide (plan 5.3); heartbeat the " +
  "lease while deciding (lane.ts heartbeat). The recorded recovery is the recover subcommand " +
  "(s-a-headless.ts recover --run <run dir> --id <lane id> --really: it ends the lease's pid " +
  "and its qualifying descendants one process at a time, each image-checked; three per sitting); " +
  "it keeps the lease, so the sitting can resume with the next step. Post-flight ends the " +
  "sitting: it releases the lease";

/** One launch: spawn, observe, assert, and decide; never retries. */
/** The steps whose verb is `-validate`: they end on the verdict line (see runStep). */
/** The log line of a WorkbenchGame script module that did not compile (S-A repeat, DEC-035). */
export const WORKBENCH_MODULE_FAILED_LINE = `Can't compile "WorkbenchGame" script module!`;

/**
 * True when a session log says the WorkbenchGame module did not compile, or has an (E) line
 * naming the planted broken file.
 */
export function workbenchModuleFailed(log: string): boolean {
  if (log.includes(WORKBENCH_MODULE_FAILED_LINE)) return true;
  return log
    .split(/\r?\n/)
    .some(
      (l) => /\(E\)/.test(l) && (l.includes(U14_BROKEN_FILE) || l.includes("EMCP2_U14_Broken")),
    );
}

/** `workbenchModuleFailed` over a session's console.log and the script.log beside it. */
export function workbenchModuleFailedIn(
  consoleLog: string,
  deps: Pick<SessionDeps, "readLog" | "fs">,
): boolean {
  const scriptLog = join(dirname(consoleLog), "script.log");
  const script = deps.fs.exists(scriptLog) ? deps.readLog(scriptLog) : "";
  return workbenchModuleFailed(script) || workbenchModuleFailed(deps.readLog(consoleLog));
}

export const VALIDATE_STEPS: ReadonlySet<StepId> = new Set<StepId>(["S-A-3", "S-A-6", "S-A-7"]);

/**
 * The validation verdict of a matched session: its script.log (beside the console log) and the
 * console log, read with wb_validate_scripts's own matcher; the error lines come from script.log
 * when it has text, as in that tool.
 */
export function validationVerdictOf(
  consoleLog: string,
  deps: Pick<SessionDeps, "readLog" | "fs">,
): { verdict: "successful" | "failed"; errorLines: string[] } | null {
  const scriptLog = join(dirname(consoleLog), "script.log");
  const script = deps.fs.exists(scriptLog) ? deps.readLog(scriptLog) : "";
  const verdict =
    matchValidationVerdict(script) ?? matchValidationVerdict(deps.readLog(consoleLog));
  if (verdict === null) return null;
  return {
    verdict,
    errorLines: extractErrorLines(script || deps.readLog(consoleLog)),
  };
}

/** The `.c` file names the error lines name, in order, once each. */
export function filesNamedIn(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const m of l.matchAll(/([^\s\\/:'"()]+\.c)\b/g)) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}

export async function runStep(
  step: StepDef,
  cfg: SessionConfig,
  deps: SessionDeps,
  state: RunState,
  addonsDirArgs: string[],
): Promise<StepRecord> {
  const v: VerbInput = {
    validateConfig: cfg.validateConfig,
    runDir: cfg.runDir,
    sandboxDir: cfg.sandboxDir,
    sandboxShortDir: state.sandboxShortDir ?? null,
  };
  if (step.retired) {
    const refused = emptyRecord(step, "", deps.now());
    refused.outcome = "refused";
    refused.detail = step.retired;
    return refused;
  }
  const exe = resolveWorkbenchExe(cfg.workbenchPath, deps.fs.exists);
  if (step.needsShortPath && !v.sandboxShortDir) {
    const refused = emptyRecord(step, "", deps.now());
    refused.outcome = "refused";
    refused.detail = SHORT_PATH_REFUSAL;
    return refused;
  }
  if (step.runPathInToken && /\s/.test(v.runDir)) {
    const refused = emptyRecord(step, "", deps.now());
    refused.outcome = "refused";
    refused.detail = RUN_PATH_SPACE_REFUSAL;
    return refused;
  }
  const args = stepArgs(step, cfg.gproj, addonsDirArgs, v);
  const commandLine = formatCommandLine(exe, args);
  const startedAt = deps.now();
  const r = emptyRecord(step, commandLine, startedAt);
  const refuse = (detail: string): StepRecord => {
    r.outcome = "refused";
    r.detail = detail;
    return r;
  };
  const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const manifestPath = join(cfg.runDir, `u14-plant-${step.id}.json`);
  const rollbackPath = join(cfg.runDir, `u14-rollback-${step.id}.json`);
  const writeRollback = (rb: RollbackResult): void => {
    mkdirSync(cfg.runDir, { recursive: true });
    writeFileSync(rollbackPath, JSON.stringify(rb, null, 2) + "\n", {
      encoding: "utf-8",
      flag: "wx",
    });
  };

  // Gates that need nothing started.
  const denied = deniedSwitch(args, cfg.policy);
  if (denied) return refuse(`launch argument ${denied} is on a policy deny list`);
  if (step.writes && (step.form !== "new" || !state.assertionPassed)) {
    return refuse(
      "writing verbs run only with the new arguments after the opened-project assertion has passed once",
    );
  }
  if (step.form === "old") {
    if (!cfg.launcherLastIsDecoy) {
      return refuse(
        "the old arguments open the launcher's preselected project when the switch is ignored: S-A-1 runs only " +
          `when the owner opened the decoy ${DECOY_NAME} last from the launcher (confirm with --launcher-last-is-decoy)`,
      );
    }
    if (!deps.fs.exists(decoyGproj(cfg.decoyDir))) {
      return refuse(
        `the decoy ${DECOY_NAME}.gproj is missing (create it with the decoy subcommand, then have the owner open it last)`,
      );
    }
    const pre = decoyPreselectionRefusal(cfg, deps);
    if (pre) return refuse(`S-A-1 refused: ${pre}`);
  }
  const startedPath = startedMarkerPath(cfg.runDir, step.id);
  if (existsSync(startedPath) || existsSync(acknowledgedMarkerPath(cfg.runDir, step.id))) {
    return refuse(
      `${step.id}.started is already in this run folder: the step was started once (no retry; a started ` +
        "step with no result is a harness error, see the runbook)",
    );
  }
  if (step.plant && !state.validateSelfExit) {
    return refuse(
      "U14 needs S-A-3 to have passed (a validate that opens the sandbox and exits by itself or " +
        "gives the success verdict)",
    );
  }
  if (step.plant === "broken" && !state.controlClean) {
    return refuse(
      "U14 needs a clean S-A-6 control first: errors in the copy itself make the broken run unreadable",
    );
  }
  if (step.plant && cfg.lint === null) {
    return refuse(
      "plan 5.3 pre-flight step 6: S-A-6 and S-A-7 copy the shipped handler set into the sandbox; " +
        "confirm its Enforce lint with --lint passed|triaged",
    );
  }
  if (step.plant && existsSync(manifestPath)) {
    return refuse(
      `u14-plant-${step.id}.json already exists in this run folder (an earlier plant attempt): run the ` +
        "rollback command if it has no rollback record, then stop and ask the owner",
    );
  }
  try {
    const running = deps.workbenchPids();
    if (running.length > 0) {
      return refuse(
        `Workbench is already running (pid ${running.join(", ")}), not started by this step; never adopted`,
      );
    }
    const crash = deps.crashReporterPids();
    if (crash.length > 0) {
      return refuse(
        `${CRASH_REPORTER_IMAGE} is running (pid ${crash.join(", ")}): a crash report or recovery prompt is ` +
          "pending (U35); not killed; stop for the main session",
      );
    }
    const port = deps.portListeners(cfg.port);
    if (port.length > 0) {
      return refuse(
        `TCP ${cfg.port} is held by pid ${port.join(", ")}; not killed; stop for the main session`,
      );
    }
  } catch (e) {
    return refuse(`process check before the launch failed: ${errText(e)}`);
  }

  // Decoy baseline: a launcher that ignores the project switch opens it.
  let decoyBefore: Manifest | null = null;
  try {
    if (deps.fs.exists(cfg.decoyDir)) {
      decoyBefore = deps.snapshot(cfg.decoyDir, decoyPaths(cfg.decoyDir, deps.fs));
    }
  } catch (e) {
    return refuse(`decoy snapshot failed: ${errText(e)}`);
  }

  // U14 plant: the manifest is on disk before the first write and after every file.
  let manifest: PlantManifest | null = null;
  if (step.plant) {
    mkdirSync(cfg.runDir, { recursive: true });
    try {
      manifest = plantU14(step, cfg.sandboxDir, cfg.bundledHandlerDir, deps, (m) =>
        writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n", "utf-8"),
      );
    } catch (e) {
      if (e instanceof PlantError && e.rollback) {
        r.rollback = e.rollback;
        try {
          writeRollback(e.rollback);
        } catch {
          // The refusal below carries the rollback's verdict.
        }
      }
      return refuse(errText(e));
    }
    r.plant = { folder: manifest.folder, files: manifest.files.length };
  }
  // The run folder holds the writing verbs' output (-ciInfoDst is a file inside it).
  mkdirSync(cfg.runDir, { recursive: true });
  if (step.output === "build-dir")
    mkdirSync(join(cfg.runDir, step.outputName ?? "buildData"), { recursive: true });

  /** Roll back the plant of a step that never started a process. */
  const undoPlant = (): string => {
    if (!manifest) return "";
    try {
      const rb = rollbackU14(manifest, cfg.sandboxDir, deps);
      r.rollback = rb;
      writeRollback(rb);
      return rb.ok
        ? "; the U14 plant was rolled back (net-zero)"
        : `; U14 rollback INCOMPLETE: ${rb.detail}`;
    } catch (e2) {
      return `; U14 rollback failed: ${errText(e2)} (run the rollback command)`;
    }
  };

  // The sandbox root's entries just before the spawn (the plant is already in place).
  let rootBefore: string[] | null = null;
  try {
    rootBefore = sandboxRootEntries(cfg.sandboxDir, deps.fs);
  } catch {
    rootBefore = null;
  }

  // The launcher's project lists just before the spawn (which list a launch writes is a
  // question of the sitting; DEC-031).
  const readLists = (): ListSummary[] => {
    try {
      return summarizeLists(deps.projectLists(), cfg.gproj, decoyGproj(cfg.decoyDir));
    } catch {
      return [];
    }
  };
  const listsBefore = readLists();

  // The started marker, before the spawn: a script that dies mid-step leaves it with no result.
  const marker = (pid: number | null, created: number | null): string =>
    JSON.stringify(
      {
        step: step.id,
        started_at: new Date(startedAt).toISOString(),
        pid,
        created,
      } satisfies StartedMarker,
      null,
      2,
    ) + "\n";
  try {
    writeFileSync(startedPath, marker(null, null), { encoding: "utf-8", flag: "wx" });
  } catch (e) {
    return refuse(
      `could not write ${step.id}.started before the spawn: ${errText(e)}${undoPlant()}`,
    );
  }

  // Launch.
  const spawnAt = deps.now();
  let proc: SpawnedProcess;
  try {
    proc = deps.spawn(exe, args, cfg.gamePath);
  } catch (e) {
    // Nothing started: the marker goes, so the step may be run again once the cause is fixed.
    try {
      unlinkSync(startedPath);
    } catch {
      // A marker left behind refuses the step; the refusal below says why.
    }
    let note = undoPlant();
    // A plant rolled back to net-zero after a failed spawn is set aside under another name, so
    // the U14 step may run again in this run folder once the cause is fixed.
    if (manifest && r.rollback && "ok" in r.rollback && r.rollback.ok) {
      try {
        let n = 1;
        while (existsSync(join(cfg.runDir, `u14-plant-${step.id}.spawn-failed-${n}.json`))) n++;
        renameSync(manifestPath, join(cfg.runDir, `u14-plant-${step.id}.spawn-failed-${n}.json`));
        renameSync(
          rollbackPath,
          join(cfg.runDir, `u14-rollback-${step.id}.spawn-failed-${n}.json`),
        );
        note += `; the plant manifest and its rollback record are kept as spawn-failed-${n}`;
      } catch (e2) {
        note += `; the plant records could not be set aside (${errText(e2)}): the step will refuse`;
      }
    }
    return refuse(`spawn failed: ${errText(e)}${note}`);
  }
  const t0 = deps.now();
  r.pid = proc.pid;
  // The started process's creation time: `recover` treats a pid as this run's own only when the
  // process now under that pid has the same creation time (DEC-031, a reused pid is not ours).
  let created: number | null = null;
  try {
    created = (await deps.processTable()).find((p) => p.pid === proc.pid)?.created ?? null;
  } catch {
    created = null;
  }
  try {
    writeFileSync(startedPath, marker(proc.pid, created), "utf-8");
  } catch {
    // The lease records the pid as well (below); the step result names it.
  }

  // Everything the observation loop learns; an object, so later reads are never narrowed away.
  const obs: {
    exit: ProcessExit | null;
    exitedAt: number | null;
    /** The matched log (born after the spawn, echo carries this launch's switches). */
    logPath: string | null;
    /** The newest log born after the spawn, while none matched yet. */
    candidate: string | null;
    match: StepRecord["session_log_match"];
    facts: LogFacts;
    initSeenAt: number | null;
    openedAt: number | null;
    engineSeenAt: number | null;
    launcherPolls: number;
    /** The Missing Addon Dependencies modal was seen (S-A-1 never goes on after it). */
    modalSeen: boolean;
    /** Consecutive polls whose window probe failed. */
    probeErrorsInRow: number;
    stopForMain: boolean;
  } = {
    exit: null,
    exitedAt: null,
    logPath: null,
    candidate: null,
    match: "no-log",
    facts: readLogFacts(""),
    initSeenAt: null,
    openedAt: null,
    engineSeenAt: null,
    launcherPolls: 0,
    modalSeen: false,
    probeErrorsInRow: 0,
    stopForMain: false,
  };
  void proc.exited.then((e) => {
    obs.exit = e;
    obs.exitedAt = deps.now();
  });
  const exited = (): boolean => obs.exit !== null;
  const harnessError = (e: unknown, where: string): void => {
    r.outcome = "harness-error";
    obs.stopForMain = true;
    r.detail =
      `${r.detail ? `${r.detail}; ` : ""}harness error ${where}: ${errText(e)}; pid ${proc.pid} is recorded ` +
      "in the lease; stop for the main session";
  };

  const sandboxName = sandboxProjectName(cfg.gproj);
  const windowsSeen = new Set<string>();

  // The idle rule (DEC-033): after the opened-project line, the matched log's length and the
  // CPU time of the started pid and its child Workbench images, read through the process table
  // (read only) every `idleSampleMs`. Samples taken before the log last grew are dropped.
  const idleQuietMs = cfg.idleQuietMs ?? IDLE_QUIET_MS;
  const idleCpuPercent = cfg.idleCpuPercent ?? IDLE_CPU_PERCENT;
  const sampleEvery = idleSampleMs(idleQuietMs);
  const idle: {
    logLength: number | null;
    /** Length the rule last saw, and when it last changed. */
    seenLength: number | null;
    changedAt: number | null;
    lastSampleAt: number | null;
    samples: Array<{ at: number; cpu: number; pids: string }>;
  } = { logLength: null, seenLength: null, changedAt: null, lastSampleAt: null, samples: [] };
  /** CPU time of the started pid plus its child Workbench images, or null when not known. */
  const cpuOfTree = (rows: readonly ProcRow[]): { cpu: number; pids: string } | null => {
    const plan = descendantPlan(rows, proc.pid);
    if (plan.rootRow === null) return null;
    const tree = [
      plan.rootRow,
      ...plan.end.filter((x) => x.name.toLowerCase() === WORKBENCH_EXE.toLowerCase()),
    ];
    let cpu = 0;
    for (const x of tree) {
      if (typeof x.cpu_ms !== "number") return null;
      cpu += x.cpu_ms;
    }
    return {
      cpu,
      pids: tree
        .map((x) => x.pid)
        .sort((a, b) => a - b)
        .join(","),
    };
  };
  /** One idle check per poll after the opened-project line; true when the step is idle. */
  const idleNow = async (): Promise<boolean> => {
    if (obs.openedAt === null || obs.match !== "matched" || idle.logLength === null) return false;
    if (r.idle === null) {
      r.idle = {
        quiet_ms: idleQuietMs,
        cpu_percent: idleCpuPercent,
        samples: 0,
        table_errors: 0,
        window_ms: null,
        cpu_ms: null,
        decided: false,
      };
    }
    const now = deps.now();
    if (idle.seenLength !== idle.logLength) {
      idle.seenLength = idle.logLength;
      idle.changedAt = now;
      idle.samples = [];
    }
    if (idle.lastSampleAt !== null && now - idle.lastSampleAt < sampleEvery) return false;
    idle.lastSampleAt = now;
    let s: { cpu: number; pids: string } | null = null;
    try {
      s = cpuOfTree(await deps.processTable());
    } catch {
      r.idle.table_errors++;
      return false;
    }
    r.idle.samples++;
    if (s === null) return false;
    // A different set of processes restarts the measurement.
    if (idle.samples.length > 0 && idle.samples[0].pids !== s.pids) idle.samples = [];
    idle.samples.push({ at: now, cpu: s.cpu, pids: s.pids });
    // The most recent sample at least the quiet period before this one, after the last growth.
    const base = [...idle.samples].reverse().find((x) => now - x.at >= idleQuietMs);
    if (!base || idle.changedAt === null || base.at < idle.changedAt) return false;
    const windowMs = now - base.at;
    const cpuMs = s.cpu - base.cpu;
    r.idle.window_ms = windowMs;
    r.idle.cpu_ms = cpuMs;
    if (cpuMs <= (windowMs * idleCpuPercent) / 100) {
      r.idle.decided = true;
      return true;
    }
    return false;
  };

  const readLogNow = (): void => {
    if (obs.logPath !== null) {
      const text = deps.readLog(obs.logPath);
      idle.logLength = text.length;
      obs.facts = readLogFacts(text);
    } else {
      const c = deps.findSessionLog(spawnAt);
      if (c === null || state.usedLogs.has(c)) {
        obs.candidate = null;
        obs.match = "no-log";
        obs.facts = readLogFacts("");
      } else {
        const text = deps.readLog(c);
        const f = readLogFacts(text);
        obs.candidate = c;
        obs.facts = f;
        if (f.echo === null) obs.match = "no-echo";
        else if (echoMatches(f.echo, args)) {
          obs.logPath = c;
          obs.match = "matched";
          idle.logLength = text.length;
          state.usedLogs.add(c);
        } else obs.match = "echo-mismatch";
      }
    }
    if (obs.match === "echo-mismatch") return;
    const now = deps.now();
    if (obs.facts.engineCreated && obs.engineSeenAt === null) obs.engineSeenAt = now;
    if (obs.facts.initSeen && obs.initSeenAt === null) obs.initSeenAt = now;
    if (obs.match === "matched" && obs.facts.opened !== null && obs.openedAt === null) {
      obs.openedAt = now;
    }
  };
  /** The opened-project line counts only in the matched log. */
  const openedNow = (): string | null => (obs.match === "matched" ? obs.facts.opened : null);
  /**
   * M1 (DEC-030): a log born after the spawn whose echo is another launch's, but which names a
   * project that is neither the sandbox nor the decoy. Only one Workbench runs (checked before
   * the spawn), so the kill criterion applies to it all the same.
   */
  const foreignInCandidate = (): string | null => {
    if (obs.match !== "echo-mismatch" || obs.facts.opened === null) return null;
    const n = obs.facts.opened.toLowerCase();
    return n === sandboxName.toLowerCase() || n === DECOY_NAME.toLowerCase()
      ? null
      : obs.facts.opened;
  };

  // Plan 5.3 Headless CLI: end what this run started, one process at a time (DEC-031, M-2).
  const killOwn = async (result: FailureResult, why: string): Promise<void> => {
    r.failure_result = result;
    r.outcome = result;
    await endChecked(why);
  };
  /**
   * The checked end: image and creation-time checks per process, each ended pid recorded in
   * forced-kills.jsonl. The caller sets the outcome first; a failed end overrides it.
   */
  const endChecked = async (why: string): Promise<void> => {
    let res: KillResult;
    try {
      // m-2 (DEC-034): the kill checks the spawn's creation time again just before the end.
      res = await deps.kill(proc.pid, { descendants: true, expectCreated: created });
    } catch (e) {
      r.outcome = "kill-failed";
      r.detail = `${why}; kill refused: ${errText(e)}`;
      obs.stopForMain = true;
      return;
    }
    r.kill = res;
    let note = "";
    // Post-flight reads these: a forced kill makes the registry comparison not valid.
    for (const p of res.ended_pids) {
      try {
        recordForcedKill(cfg.runDir, {
          pid: p,
          by: step.id,
          at: new Date(deps.now()).toISOString(),
          how: `taskkill /PID ${p} /F`,
        });
      } catch (e) {
        note = `; a forced kill could not be recorded for post-flight: ${errText(e)}`;
      }
    }
    // A descendant left running, or descendants that could not be listed, stop the step for
    // the main session and the owner (nothing of theirs is ended).
    if (res.left.length > 0 || res.descendants_unknown) {
      obs.stopForMain = true;
      note +=
        "; stop for the main session and the owner: " +
        (res.left.length > 0
          ? `pid ${res.left.map((l) => `${l.pid} (${l.image})`).join(", ")} below the started pid was not ended`
          : "the started pid's descendants could not be listed");
    }
    const deadline = deps.now() + KILL_WAIT_MS;
    while (!exited() && deps.now() < deadline) await deps.sleep(1_000);
    if (!exited()) {
      r.outcome = "kill-failed";
      r.detail = `${why}; ${res.detail}; pid ${proc.pid} still running after ${KILL_WAIT_MS} ms${note}`;
      obs.stopForMain = true;
      return;
    }
    // True only when this run's kill ended the started process (not when it was already gone).
    r.exit.killed_by_run = res.ended_pids.includes(proc.pid);
    r.detail = `${why}; ${res.detail}${note}`;
  };

  // Plan 5.3 During: on a timeout, no retry and no kill; capture, list windows, stop. The idle
  // end (DEC-033) takes the same path under its own outcome.
  const onTimeout = async (phase: "init" | "exit" | "window-probe" | "idle"): Promise<void> => {
    r.outcome = phase === "idle" ? "idle" : "timeout";
    obs.stopForMain = true;
    let capture = "";
    try {
      const label = phase === "idle" ? `${step.id}-idle` : `${step.id}-${phase}-timeout`;
      capture = (await deps.captureDesktop(label, cfg.runDir)).path;
    } catch (e) {
      capture = `capture failed: ${errText(e)}`;
    }
    const windows: string[] = [];
    try {
      const all = await deps.listTopWindows();
      let wb: number[] = [];
      try {
        wb = deps.workbenchPids();
      } catch {
        // The started pid is still known.
      }
      const ours = new Set<number>([proc.pid, ...wb]);
      const images = new Map<number, string | null>();
      const imageOf = (pid: number): string | null => {
        if (!images.has(pid)) {
          let img: string | null = null;
          try {
            img = deps.imageOfPid(pid);
          } catch {
            img = null;
          }
          images.set(pid, img);
        }
        return images.get(pid) ?? null;
      };
      let others = 0;
      for (const w of all) {
        if (ours.has(w.pid)) {
          windows.push(`pid ${w.pid} [${w.className}] ${w.title}`);
          continue;
        }
        // Crash reporters and dialogs are the likeliest blockers; other titles can name the
        // owner's files and are only counted.
        const img = imageOf(w.pid);
        if (img && CRASH_IMAGES.has(img.toLowerCase())) {
          windows.push(`pid ${w.pid} ${img} [${w.className}] ${w.title}`);
        } else if (w.className === "#32770") {
          windows.push(
            `pid ${w.pid} ${img ?? "unknown image"} [#32770] dialog (title not recorded)`,
          );
        } else {
          others++;
        }
      }
      windows.push(`${others} other top-level windows (not recorded)`);
    } catch (e) {
      windows.push(`window list failed: ${errText(e)}`);
    }
    let text = "";
    try {
      const p = obs.logPath ?? obs.candidate;
      text = p ? deps.readLog(p) : "";
    } catch {
      text = "";
    }
    const tail = text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(-20);
    r.timeout = { phase, capture, windows, log_tail: scrubLines(tail, cfg.ph, 20) };
    r.detail =
      (phase === "init"
        ? `timeout: no opened-project line within ${step.initTimeoutMs} ms`
        : phase === "exit"
          ? `timeout: the sandbox opened but the process did not exit by itself within ${step.exitTimeoutMs} ms ` +
            "(if Workbench idles on the sandbox, the main session records the result as flag ignored)"
          : phase === "idle"
            ? `idle: the sandbox opened, then the session log did not grow for ${r.idle?.window_ms ?? idleQuietMs} ms ` +
              `and the process used ${r.idle?.cpu_ms ?? "?"} ms of CPU time over it (floor ${idleCpuPercent} % of one core ` +
              `over the ${idleQuietMs} ms quiet period); the step ended before its ${step.exitTimeoutMs} ms exit timeout`
            : `the window probe failed on ${obs.probeErrorsInRow} polls in a row (last: ${r.window_probe.last_error ?? "unknown"}): ` +
              "the launcher and modal checks are blind, so the step stops as on a timeout") +
      `; not retried, not killed. pid ${proc.pid} is still running and recorded in the lease: ${TIMEOUT_RECOVERY}`;
  };

  /** Count one failed window probe (the started pid, a child, or the child query). */
  const probeError = (where: string, e: unknown): void => {
    r.window_probe.errors++;
    r.window_probe.last_error = `${where}: ${errText(e)}`.slice(0, 300);
  };

  try {
    cfg.lane.record(proc.pid, cfg.gproj);
    for (;;) {
      await deps.sleep(POLL_MS);
      const now = deps.now();
      if (now - state.lastHeartbeat >= HEARTBEAT_MS) {
        try {
          cfg.lane.heartbeat();
          state.lastHeartbeat = now;
        } catch (e) {
          r.outcome = "lease-lost";
          r.detail = `lease heartbeat failed: ${errText(e)}; stop and ask the owner`;
          obs.stopForMain = true;
          break;
        }
      }
      const exitedBeforeRead = exited();
      readLogNow();
      const opened = openedNow();
      const foreign = foreignInCandidate();
      if ((opened !== null && opened.toLowerCase() !== sandboxName.toLowerCase()) || foreign) {
        r.assertion = "fail";
        const decoy = opened !== null && opened.toLowerCase() === DECOY_NAME.toLowerCase();
        const result: FailureResult = decoy ? "flag-ignored" : "wrong-project";
        const why = decoy
          ? `the session log names the decoy ${DECOY_NAME}: the launcher opened its preselected project, so the project switch was ignored`
          : opened !== null
            ? "the session log names another project"
            : "a session log born after the spawn names a project that is neither the sandbox nor the decoy " +
              "(its CLI Params echo is not this launch's, but only one Workbench runs)";
        if (exitedBeforeRead) {
          r.outcome = result;
          r.failure_result = result;
          r.detail = `${why}; the process had already exited`;
        } else {
          await killOwn(result, why);
        }
        break;
      }
      if (opened !== null) r.assertion = "pass";
      if (exitedBeforeRead) break;
      // A validate step ends on its verdict, as wb_validate_scripts does: Workbench does not
      // exit by itself after "Script validation successful." (S-A, 2026-10-06).
      if (VALIDATE_STEPS.has(step.id) && opened !== null && obs.logPath !== null) {
        const v = validationVerdictOf(obs.logPath, deps);
        if (v !== null) {
          const lines = scrubLines(v.errorLines, cfg.ph, 40);
          r.verdict = {
            verdict: v.verdict,
            spawn_to_verdict_ms: deps.now() - t0,
            error_lines: lines,
            files_named: filesNamedIn(lines),
          };
          r.ended_on = "verdict";
          r.outcome = v.verdict === "successful" ? "pass" : "validation-failed";
          // U14 (DEC-035): the broken plant stops the WorkbenchGame module, which -validate=PC
          // does not see. The log's compile line decides, not the verdict.
          if (step.plant === "broken" && workbenchModuleFailedIn(obs.logPath, deps)) {
            r.workbench_module_failed = true;
            r.outcome = "workbench-module-failed";
          }
          await endChecked(
            `the session log gave the verdict "Script validation ${v.verdict}." after ` +
              `${r.verdict.spawn_to_verdict_ms} ms; the step ends on it (Workbench does not exit by itself after a validate)`,
          );
          break;
        }
      }
      // The windows of the started pid and of its child Workbench images (a launcher stub's
      // engine). Read only; a probe that fails is counted, never taken as "no window".
      let probeFailed = false;
      let children: number[] = [];
      try {
        children = await deps.childWorkbenchPids(proc.pid);
      } catch (e) {
        probeFailed = true;
        probeError("child process query", e);
      }
      for (const c of children) {
        if (!r.window_probe.child_pids.includes(c)) r.window_probe.child_pids.push(c);
      }
      let launcher = false;
      let modal = false;
      for (const pid of [proc.pid, ...children]) {
        let w: PidWindows | null = null;
        try {
          w = await deps.windowsOfPid(pid);
        } catch (e) {
          probeFailed = true;
          probeError(`pid ${pid}`, e);
        }
        if (w === null) continue;
        if (w.error) {
          probeFailed = true;
          probeError(`pid ${pid}`, w.error);
        }
        for (const t of w.titles) windowsSeen.add(t);
        launcher ||= w.launcher;
        modal ||= w.missingDepsModal;
      }
      obs.probeErrorsInRow = probeFailed ? obs.probeErrorsInRow + 1 : 0;
      if (modal && !exited()) {
        obs.modalSeen = true;
        await killOwn("launcher-held", "the Missing Addon Dependencies modal appeared");
        break;
      }
      if (launcher) obs.launcherPolls++;
      // A launcher window on the way to an open is normal (the watchdog's design): only its
      // hold signature is a hold, armed by the engine marker like the watchdog.
      if (launcher && obs.facts.echo === null && obs.engineSeenAt !== null && !exited()) {
        const quiet = now - obs.engineSeenAt;
        if (quiet >= LAUNCHER_QUIET_MS) {
          r.launcher = {
            window_polls: obs.launcherPolls,
            engine_marker_seen: true,
            cli_echo_seen: false,
            quiet_ms_at_decision: quiet,
            registration: state.sandboxRegistration,
          };
          // DEC-031 (M-1): a hold at the picker is "launcher held on an unregistered project":
          // the project list this launch reads does not know the project [inferred]. It is
          // never "flag ignored", so it never reads as a U1 "no".
          await killOwn(
            "launcher-held",
            `the launcher held at its picker: ${ENGINE_CREATED_MARKER} ${quiet} ms earlier and no CLI Params ` +
              "echo; read as a launcher held on an unregistered project (the list this launch reads " +
              `does not know it [inferred]; across the project lists the sandbox is ${state.sandboxRegistration})`,
          );
          break;
        }
      }
      // Before the project opened, a blind probe could miss a hold; after it, the poll only
      // waits for the self-exit, so errors are counted and never stop a healthy step.
      if (obs.probeErrorsInRow >= WINDOW_PROBE_ERROR_LIMIT && obs.openedAt === null && !exited()) {
        await onTimeout("window-probe");
        break;
      }
      if (obs.openedAt === null && now - t0 >= step.initTimeoutMs) {
        await onTimeout("init");
        break;
      }
      // DEC-033: a quiet log and no measurable CPU after the open end the step as idle.
      if (!exited() && (await idleNow())) {
        await onTimeout("idle");
        break;
      }
      if (obs.openedAt !== null && now - obs.openedAt >= step.exitTimeoutMs) {
        await onTimeout("exit");
        break;
      }
    }
  } catch (e) {
    harnessError(e, "while observing the launch");
  }

  // Facts, whatever happened.
  let addonNotFound = false;
  let foreignNamed = false;
  try {
    readLogNow();
    const facts = obs.facts;
    const matched = obs.match === "matched";
    r.session_log = obs.logPath ?? obs.candidate;
    r.session_log_match = obs.match;
    r.windows_seen = [...windowsSeen].map((t) => toPlaceholders(t, cfg.ph));
    const opened = matched ? facts.opened : null;
    const lastAddon = matched ? facts.lastLoadedAddon : null;
    r.opened_project = opened === null ? null : scrubProjectName(opened, cfg.gproj);
    r.last_loaded_addon = lastAddon === null ? null : scrubProjectName(lastAddon, cfg.gproj);
    foreignNamed =
      obs.match === "echo-mismatch" ||
      [opened, lastAddon].some((n) => n !== null && !isKnownProject(n, cfg.gproj));
    r.cli_echo = matched && facts.echo ? toPlaceholders(facts.echo, cfg.ph) : null;
    r.hazards = facts.hazards;
    r.init.seen = facts.initSeen;
    r.init.spawn_to_init_seen_ms = obs.initSeenAt === null ? null : obs.initSeenAt - t0;
    if (facts.initMsOfDay !== null) {
      let g = facts.initMsOfDay - localMsOfDay(t0);
      if (g < -12 * 3_600_000) g += 24 * 3_600_000;
      r.init.log_spawn_to_init_ms = g;
      if (facts.firstMsOfDay !== null) {
        let c = facts.initMsOfDay - facts.firstMsOfDay;
        if (c < 0) c += 24 * 3_600_000;
        r.init.log_create_to_init_ms = c;
      }
    }
    if (obs.launcherPolls > 0 && r.launcher === null) {
      r.launcher = {
        window_polls: obs.launcherPolls,
        engine_marker_seen: obs.engineSeenAt !== null,
        cli_echo_seen: facts.echo !== null,
        quiet_ms_at_decision: null,
        registration: state.sandboxRegistration,
      };
    }
    const logPath = obs.logPath ?? obs.candidate;
    const scriptLog = logPath ? join(dirname(logPath), "script.log") : null;
    const scriptFacts = readLogFacts(
      scriptLog && deps.fs.exists(scriptLog) ? deps.readLog(scriptLog) : "",
    );
    addonNotFound = matched && (facts.addonNotFound || scriptFacts.addonNotFound);
    const errors = [...facts.scriptErrors, ...scriptFacts.scriptErrors];
    const plantedNames = manifest
      ? manifest.files
          .map((f) => f.path.split("/").pop() ?? "")
          .filter((n) => n !== U14_BROKEN_FILE)
      : [];
    const namesBroken = (e: string): boolean =>
      e.includes(U14_BROKEN_FILE) || e.includes("EMCP2_U14_Broken");
    const namesOther = (e: string): boolean =>
      !namesBroken(e) && (e.includes(U14_FOLDER) || plantedNames.some((n) => e.includes(n)));
    r.script_errors = {
      count: errors.length,
      naming_broken_file: errors.filter(namesBroken).length,
      naming_other_planted: errors.filter(namesOther).length,
      lines: scrubLines(errors, cfg.ph, 40),
    };
    r.compile_lines = scrubLines([...facts.compileLines, ...scriptFacts.compileLines], cfg.ph, 40);
    if (decoyBefore) {
      const after = deps.snapshot(cfg.decoyDir, decoyPaths(cfg.decoyDir, deps.fs));
      const d = diff(decoyBefore, after, []);
      r.decoy = { net_zero: isNetZero(d), added: d.added, removed: d.removed, changed: d.changed };
    }
    // M3 (DEC-030): a new file or folder at the sandbox root (the plant's own folders were in
    // place before the spawn, so they are not counted).
    const before0 = rootBefore;
    if (before0 !== null) {
      const after0 = sandboxRootEntries(cfg.sandboxDir, deps.fs);
      r.sandbox_root = {
        added: after0.filter((e) => !before0.includes(e)),
        removed: before0.filter((e) => !after0.includes(e)),
      };
    }
  } catch (e) {
    harnessError(e, "while reading the results");
  }
  r.launcher_lists = { before: listsBefore, after: readLists() };
  if (obs.exit !== null) {
    r.exit.code = obs.exit.code;
    r.exit.code_int32 = obs.exit.code === null ? null : obs.exit.code | 0;
    r.exit.signal = obs.exit.signal;
    r.exit.after_ms = obs.exitedAt === null ? null : obs.exitedAt - t0;
    // A step ended on its verdict was ended by this run, whatever the kill found.
    r.exit.by_itself = r.ended_on !== "verdict" && !r.exit.killed_by_run;
  }

  // After ANY exit: a Workbench this run did not start directly may still run (a respawn).
  let leftovers: number[] | null = null;
  if (obs.exit !== null) {
    // Child images this step saw, or ended, may still be terminating: give them the kill wait
    // to go before anything still running is called a leftover (DEC-031).
    const known = [
      ...new Set([...r.window_probe.child_pids, ...(r.kill?.ended_pids ?? [])]),
    ].filter((p) => p !== proc.pid);
    if (known.length > 0) {
      const deadline = deps.now() + KILL_WAIT_MS;
      const alive = (): boolean =>
        known.some((p) => {
          try {
            return deps.imageOfPid(p) !== null;
          } catch {
            return true;
          }
        });
      while (alive() && deps.now() < deadline) await deps.sleep(1_000);
    }
    try {
      leftovers = deps.workbenchPids();
    } catch (e) {
      harnessError(e, "listing Workbench processes after the exit");
    }
    if (leftovers !== null && leftovers.length > 0) {
      r.leftover_pids = leftovers;
      obs.stopForMain = true;
      const note =
        `Workbench pid ${leftovers.join(", ")} is still running and was not started by this run directly: ` +
        "not killed; stop for the main session";
      if (r.outcome === "refused") {
        r.outcome = "respawned";
        r.detail = `pid ${proc.pid} exited but ${note}`;
      } else {
        r.detail = `${r.detail ? `${r.detail}; ` : ""}${note}`;
      }
    }
  }

  // A success verdict is a pass on the same output checks as a self-exit (the S-A-6 control).
  if (r.ended_on === "verdict" && r.outcome === "pass") {
    try {
      evaluateOutput(step, cfg, r, t0, state.validateErrorBaseline, addonNotFound);
    } catch (e) {
      harnessError(e, "while checking the step's output");
    }
  }
  // Decide the outcome of a run that ended by the process's own exit.
  if (r.outcome === "refused" && obs.exit !== null) {
    if (r.assertion !== "pass") {
      r.outcome = "exited-early";
      r.detail =
        "the process exited before the session log named an opened project; the assertion has not passed";
    } else {
      r.outcome = "pass";
      try {
        evaluateOutput(step, cfg, r, t0, state.validateErrorBaseline, addonNotFound);
      } catch (e) {
        harnessError(e, "while checking the step's output");
      }
    }
  }
  if (foreignNamed) {
    redactFreeText(
      r,
      obs.match === "echo-mismatch"
        ? "the session log read is not this launch's (its CLI Params echo differs)"
        : `the session log names a project that is not the sandbox, the decoy ${DECOY_NAME} or Bohemia's`,
    );
  }
  if (obs.exit === null) proc.release();
  if (obs.exit !== null && leftovers !== null && leftovers.length === 0) {
    try {
      cfg.lane.record(null, null);
    } catch (e) {
      harnessError(e, "clearing the lease's Workbench pid");
    }
  }

  // U14 rollback, only once the process is gone and nothing else of Workbench runs.
  if (manifest) {
    const pending = {
      pending:
        `Workbench is still running or its state is unknown; close it, then run: npx tsx ${SCRIPT_PATH} rollback ` +
        "--run <run dir> --id <lane id> --really",
    };
    if (obs.exit === null || leftovers === null || leftovers.length > 0) {
      r.rollback = pending;
    } else {
      try {
        const rb = rollbackU14(manifest, cfg.sandboxDir, deps);
        r.rollback = rb;
        writeRollback(rb);
        if (!rb.ok) {
          r.outcome = "rollback-incomplete";
          r.detail = `${r.detail ? `${r.detail}; ` : ""}rollback incomplete: ${rb.detail}`;
        }
      } catch (e) {
        if (r.rollback === null) r.rollback = pending;
        harnessError(e, "while rolling back the U14 plant");
      }
    }
  }

  // Continue or stop.
  const selfExitOnSandbox = r.assertion === "pass" && r.exit.by_itself;
  const stopping = new Set<Outcome>([
    "rollback-incomplete",
    "harness-error",
    "kill-failed",
    "lease-lost",
    "timeout",
    "idle",
    "respawned",
  ]);
  if (obs.stopForMain || stopping.has(r.outcome)) {
    r.continue_session = false;
  } else if (step.form === "old") {
    // The old arguments are the baseline: a held launcher, an exit before the project line, or
    // the decoy (the launcher's preselection) are expected. Any other project stops the sitting:
    // the decoy precondition did not hold. S-A-1 goes on only when its own session log was
    // matched (DEC-030, M1): otherwise nothing of this launch says what was open. The Missing
    // Addon Dependencies modal stops it too: the decoy and the sandbox depend on the base game
    // only, so another project was being opened.
    const expected = ["pass", "launcher-held", "flag-ignored", "exited-early"].includes(r.outcome);
    const why: string[] = [];
    if (r.session_log_match !== "matched") {
      why.push(
        `its session log was not matched (${r.session_log_match}), so this launch's own log does not say what was open`,
      );
    }
    if (obs.modalSeen) {
      why.push(
        "the Missing Addon Dependencies modal appeared, and neither the decoy nor the sandbox has a dependency beyond the base game",
      );
    }
    if (foreignNamed) why.push("its session log names a project that is not ours");
    r.continue_session = expected && why.length === 0;
    if (expected && why.length > 0) {
      r.detail = `${r.detail ? `${r.detail}; ` : ""}S-A-1 stops the sitting: ${why.join("; ")}`;
    }
  } else if (step.plant === "control") {
    r.continue_session = r.outcome === "pass";
  } else {
    r.continue_session =
      (selfExitOnSandbox && (r.outcome === "pass" || r.outcome === "flag-ignored")) ||
      (r.ended_on === "verdict" && r.assertion === "pass" && r.outcome === "pass") ||
      // U14: the broken plant's failed verdict is the expected answer (its files are recorded).
      (step.plant === "broken" &&
        r.ended_on === "verdict" &&
        r.assertion === "pass" &&
        (r.outcome === "validation-failed" || r.outcome === "workbench-module-failed"));
  }

  if (step.form === "new" && r.assertion === "pass") state.assertionPassed = true;
  if (step.id === "S-A-3" && r.outcome === "pass") {
    state.validateSelfExit = true;
    state.validateErrorBaseline = r.script_errors.count;
  }
  if (step.plant === "control") state.controlClean = r.outcome === "pass";
  return r;
}

/** Output checks of a self-exited step on the sandbox; may turn a pass into flag-ignored. */
function evaluateOutput(
  step: StepDef,
  cfg: SessionConfig,
  r: StepRecord,
  t0: number,
  baseline: number,
  addonNotFound: boolean,
): void {
  switch (step.output) {
    case "build-dir": {
      const dir = step.outputName ?? "buildData";
      const c = countOutput(join(cfg.runDir, dir), t0);
      r.output = { dir, files: c.files, written_after_launch: c.fresh };
      if (c.fresh === 0) {
        r.outcome = "flag-ignored";
        r.failure_result = "flag-ignored";
        r.detail =
          "exited by itself on the sandbox but -buildData wrote nothing into the output folder";
      }
      return;
    }
    case "ci-info": {
      const file = step.outputName ?? "addon.ci-info.json";
      const p = join(cfg.runDir, file);
      const exists = existsSync(p);
      let json = false;
      if (exists) {
        try {
          JSON.parse(readFileSync(p, "utf-8"));
          json = true;
        } catch {
          json = false;
        }
      }
      // Exit 3 has no `return` after it in the plugin: the run goes on, writes the file and
      // exits 0. The log line, not the exit code, says the addon was not found.
      const meaning = addonNotFound
        ? PLUGIN_EXIT_CODES[3]
        : r.exit.code === null
          ? null
          : (PLUGIN_EXIT_CODES[r.exit.code] ?? null);
      r.output = {
        file,
        exists,
        bytes: exists ? statSync(p).size : 0,
        parses_as_json: json,
        addon_not_found_line: addonNotFound,
        exit_meaning: meaning,
      };
      if (addonNotFound) {
        r.outcome = "flag-ignored";
        r.failure_result = "flag-ignored";
        r.detail =
          `the log has "${ADDON_NOT_FOUND_MESSAGE}": -addonPath was read but no loaded addon matches it ` +
          `(exit meaning 3 whatever the exit code, here ${r.exit.code}; the plugin goes on after Workbench.Exit(3))`;
      } else if (r.exit.code !== 0 || !exists || !json) {
        r.outcome = "flag-ignored";
        r.failure_result = "flag-ignored";
        r.detail =
          meaning && r.exit.code !== 0
            ? `the plugin ran and exited ${r.exit.code}: ${meaning}`
            : !exists
              ? "exited by itself on the sandbox but no ci-info file was written (the plugin did not run)"
              : "the ci-info file was written but does not parse as JSON";
      }
      return;
    }
    case "compile-log": {
      const e = r.script_errors;
      r.output = {
        baseline_errors: step.id === "S-A-3" ? null : baseline,
        errors: e.count,
        errors_over_baseline: step.id === "S-A-3" ? null : e.count - baseline,
        naming_broken_file: e.naming_broken_file,
        naming_other_planted: e.naming_other_planted,
      };
      if (step.plant === "control" && (e.naming_other_planted > 0 || e.count > baseline)) {
        r.outcome = "control-dirty";
        r.detail =
          `the clean copy logged ${e.count} script errors (${e.naming_other_planted} naming a planted file; ` +
          `baseline ${baseline}): the control is not clean, so S-A-7 is not run`;
      }
      return;
    }
    case "none":
      return;
  }
}

/** Snapshot paths for pre-flight step 6: every top-level entry but .git, plus Scripts (U14). */
export function sessionSnapshotPaths(sandboxDir: string, fs: FileOps): string[] {
  const top = fs.exists(sandboxDir) ? fs.readdir(sandboxDir).filter((n) => n !== ".git") : [];
  return [...new Set([...top, "Scripts"])].sort();
}

/** The launcher's project lists, or none when they cannot be read. */
function readListsSafe(deps: SessionDeps): ProjectListFile[] {
  try {
    return deps.projectLists();
  } catch {
    return [];
  }
}

/** The handler-set line plan 5.3 step 6 asks for, for the U14 steps of this invocation. */
function handlerSetLine(cfg: SessionConfig, deps: SessionDeps, steps: StepDef[]): string | null {
  if (!steps.some((s) => s.plant)) return null;
  let n = 0;
  try {
    n = deps.fs.readdir(cfg.bundledHandlerDir).filter((f) => f.endsWith(".c")).length;
  } catch {
    n = 0;
  }
  return (
    `handler set for S-A-6/7: shipped set (${n} files) copied to Scripts/WorkbenchGame/${U14_FOLDER} ` +
    `and removed by the same step; Enforce lint ${cfg.lint ?? "NOT confirmed (--lint passed|triaged)"}`
  );
}

/** The whole sitting. Dry run unless the live gate passes. */
export async function runSession(cfg: SessionConfig, deps: SessionDeps): Promise<SessionSummary> {
  const steps = selectSteps(cfg);
  const v: VerbInput = {
    validateConfig: cfg.validateConfig,
    runDir: cfg.runDir,
    sandboxDir: cfg.sandboxDir,
  };
  const summary: SessionSummary = {
    mode: "dry-run",
    ok: false,
    plan: [],
    schedule: [],
    preflight: [],
    records: [],
    stopped: null,
    exitCode: 1,
  };
  const stop = (why: string): SessionSummary => {
    summary.stopped = why;
    summary.ok = false;
    summary.exitCode = 1;
    deps.log(`STOPPED: ${toPlaceholders(why, cfg.ph)}`);
    return summary;
  };
  if (steps.length === 0) return stop(`unknown step ${cfg.only ?? cfg.from}`);
  const retired = steps.find((s) => s.retired);
  if (retired) return stop(retired.retired!);
  if (!/^[A-Za-z0-9_]+$/.test(cfg.validateConfig))
    return stop(`invalid -validate configuration ${cfg.validateConfig}`);

  // Dependencies decide -addonsDir. A read-only check of files; it runs in a dry run too.
  let addons: ReturnType<typeof addonsDirFromDeps>;
  try {
    addons = addonsDirFromDeps(deps.checkDeps(cfg.gproj), cfg.addonsDirOverride);
  } catch (e) {
    addons = {
      args: [],
      refusal: `dependency check failed: ${e instanceof Error ? e.message : String(e)}`,
      detail: "",
    };
  }
  // S-A-9: the sandbox's 8.3 short path, read at run time (a dry run too); never hard-coded.
  if (steps.some((s) => s.needsShortPath)) {
    v.sandboxShortDir = deps.shortPath ? await deps.shortPath(cfg.sandboxDir) : null;
    if (!v.sandboxShortDir) return stop(SHORT_PATH_REFUSAL);
  }
  // S-A-10: the run folder rides inside a single -ciInfoDst= token, so it may hold no space.
  if (steps.some((s) => s.runPathInToken) && /\s/.test(cfg.runDir)) {
    return stop(RUN_PATH_SPACE_REFUSAL);
  }
  const exe = resolveWorkbenchExe(cfg.workbenchPath, deps.fs.exists);
  summary.schedule = steps.map((s) => {
    const args = stepArgs(s, cfg.gproj, addons.args, v);
    return { step: s, args, commandLine: formatCommandLine(exe, args) };
  });
  summary.plan = buildActionPlan(summary.schedule, cfg.ph, {
    gproj: cfg.gproj,
    launcherLastIsDecoy: cfg.launcherLastIsDecoy,
  });

  // The launcher's project lists, read only: does EVERY list name the sandbox and the decoy?
  const lists = readListsSafe(deps);
  const sandboxReg = registration(lists, cfg.gproj);
  const decoyReg = registration(lists, decoyGproj(cfg.decoyDir));
  const decoyExists = deps.fs.exists(decoyGproj(cfg.decoyDir));
  const needsDecoy = steps.some((s) => s.form === "old");
  const setLine = handlerSetLine(cfg, deps, steps);

  const gate = liveGateReason({
    really: cfg.really,
    platform: deps.platform,
    leaseHeld: cfg.lane.holdsLease(),
  });
  const snapshotPaths = sessionSnapshotPaths(cfg.sandboxDir, deps.fs);
  const ctx = preflightContext(cfg, deps, snapshotPaths);
  // Pre-flight lets the U14 throwaway folder pass only for this run's own open plant of a U14
  // step this invocation runs; that step then refuses on its manifest and names the rollback.
  ctx.ownU14Plant = steps.some(
    (s) =>
      s.plant !== undefined &&
      existsSync(join(cfg.runDir, `u14-plant-${s.id}.json`)) &&
      !existsSync(join(cfg.runDir, `u14-rollback-${s.id}.json`)),
  );
  const registrationLine =
    "the launcher's project lists " +
    (sandboxReg === "unknown"
      ? "could not be read: registration unknown"
      : sandboxReg === "registered"
        ? "all name the sandbox"
        : "do NOT all name the sandbox") +
    ` (${listsLine(lists, cfg.gproj)})`;
  const preselection = needsDecoy ? decoyPreselectionRefusal(cfg, deps) : null;
  // B-1 (DEC-034): every -gproj step needs each readable list's first entry to be the sandbox or
  // the decoy, so that an ignored -gproj opens nothing of the owner's. Not the S-A-1 check: from
  // S-A-3 on, the newest session log is the run's own.
  const summaries = summarizeLists(lists, cfg.gproj, decoyGproj(cfg.decoyDir));
  const gprojSteps = steps.some((s) => s.form === "new");
  const firstOther = summaries.filter((l) => l.readable && l.first === "other");
  const firstLine =
    "launcher lists, first entry: " +
    (summaries.length === 0
      ? "no project-list file could be read"
      : summaries.map((l) => `app ${l.app} ${l.readable ? l.first : "unreadable"}`).join("; "));
  const preselectionRefusal =
    firstOther.length > 0
      ? `the launcher's project list of app ${firstOther.map((l) => l.app).join(", ")} has another project ` +
        "first (neither the sandbox nor the decoy): an ignored -gproj would open it [inferred]; do OA-12 first; " +
        "stop and ask the owner"
      : null;

  if (gate !== null) {
    summary.mode = cfg.really ? "refused" : "dry-run";
    deps.log(`S-A headless CLI sitting [${gate}]`);
    deps.log(`lane ${cfg.lane.session}; sandbox ${toPlaceholders(cfg.gproj, cfg.ph)}`);
    deps.log(`dependencies: ${toPlaceholders(addons.refusal ?? addons.detail, cfg.ph)}`);
    deps.log(
      `entry condition OA-3 (sandbox known to the launcher): ${cfg.launcherKnowsSandbox ? "confirmed" : "NOT confirmed (--launcher-knows-sandbox)"}; ` +
        registrationLine,
    );
    deps.log(
      `${firstLine}; -gproj preselection gate: ` +
        (!gprojSteps
          ? "not applied (no -gproj step selected)"
          : preselectionRefusal === null
            ? sandboxReg === "unknown"
              ? "passes on the readable lists, but registration is unknown, so a real run would REFUSE"
              : "passes"
            : `a real run would REFUSE: ${preselectionRefusal}`),
    );
    if (needsDecoy) {
      deps.log(
        `S-A-1 decoy ${DECOY_NAME}: ${decoyExists ? "present" : "MISSING (decoy subcommand)"}; ` +
          `${decoyReg === "unknown" ? "registration unknown" : decoyReg === "registered" ? "named by every launcher list" : "NOT named by every launcher list"} ` +
          `(${listsLine(lists, decoyGproj(cfg.decoyDir))}); ` +
          `opened last: ${cfg.launcherLastIsDecoy ? "confirmed" : "NOT confirmed (--launcher-last-is-decoy)"}; ` +
          `preselection: ${preselection === null ? "first project-list entry and newest session log both name the decoy" : `NOT shown: ${preselection}`}`,
      );
    }
    if (setLine) deps.log(setLine);
    if (!cfg.really) {
      const pre = await deps.preflight(ctx, new Set());
      summary.preflight = pre.results;
      deps.log("pre-flight steps 1 to 7 (dry run):");
      for (const s of pre.results) deps.log(toPlaceholders(formatStep(s), cfg.ph));
    }
    deps.log("launch schedule (one at a time; no retry; no Enter; no nudge):");
    for (const s of summary.schedule) {
      deps.log(
        `  ${s.step.id} ${s.step.risk.padEnd(10)} ${s.step.title}; answers ${s.step.answers.join(", ")}; ` +
          `timeouts ${s.step.initTimeoutMs / 1000} s to the opened-project line, ${s.step.exitTimeoutMs / 1000} s to self-exit; ` +
          `worst case of its --only invocation ${invocationWorstCaseMs(s.step) / 1000} s`,
      );
      deps.log(`    ${toPlaceholders(s.commandLine, cfg.ph)}`);
    }
    deps.log(
      `idle end rule: after the opened-project line, a session log that does not grow for ` +
        `${(cfg.idleQuietMs ?? IDLE_QUIET_MS) / 1000} s while the process uses at most ` +
        `${cfg.idleCpuPercent ?? IDLE_CPU_PERCENT} % of one core ends the step as idle (capture, stop, no retry)`,
    );
    deps.log(
      `action plan: ${summary.plan.length} actions, per step one "launch" and one "screenshot" on a timeout or an idle end`,
    );
    if (cfg.outPlan) {
      writeFileSync(cfg.outPlan, JSON.stringify(summary.plan, null, 2) + "\n", "utf-8");
      deps.log(`action plan written to ${toPlaceholders(cfg.outPlan, cfg.ph)}`);
    }
    if (cfg.really) return stop(gate);
    summary.ok = true;
    summary.exitCode = 0;
    return summary;
  }

  // Real run.
  summary.mode = "real";
  if (!cfg.launcherKnowsSandbox) {
    return stop(
      "entry condition not met: the sandbox must already be known to the launcher (OA-3); confirm with --launcher-knows-sandbox",
    );
  }
  for (const [what, dir] of [
    ["run folder", cfg.runDir],
    ["evidence folder", cfg.evidenceDir],
  ] as const) {
    const why = outsideArtifacts(dir, cfg.artifactsRoot);
    if (why)
      return stop(
        `the ${what} must lie inside the artifacts folder, outside every git tree: ${why}`,
      );
  }
  deps.log(`run folder: ${toPlaceholders(cfg.runDir, cfg.ph)}`);
  deps.log(registrationLine);
  deps.log(firstLine);
  const prior = priorRecords(cfg.runDir, cfg.evidenceDir);
  const again = steps.find((s) => prior.present.includes(s.id));
  if (again) {
    return stop(
      `${again.id} already has a result in this run folder; a step is never run twice in one run (no retry)`,
    );
  }
  // B2 (DEC-030, DEC-031): ANY step of this run folder that was started and has no result
  // blocks every step: the script ended during it. Only an owner-acknowledged rename
  // (the acknowledge subcommand) clears it.
  const died = STEPS.find(
    (s) => existsSync(startedMarkerPath(cfg.runDir, s.id)) && !prior.present.includes(s.id),
  );
  if (died) {
    return stop(
      `${died.id} has a started marker and no result in this run folder: the script ended during that step. ` +
        "Treat it as a harness error: if a Workbench still runs, end it with the recover subcommand; run the " +
        "rollback command; check the sandbox with git -C <sandbox> status --short; stop and ask the owner. " +
        `No step runs in this run folder until the owner's acknowledgement is recorded (acknowledge --step ${died.id}); ` +
        `${died.id} is not run again in this run`,
    );
  }
  if (sandboxReg === "not-registered") {
    return stop(
      "the launcher's project lists (.projectList_*.conf, read only) do not all name the sandbox " +
        `(${listsLine(lists, cfg.gproj)}): OA-3 is not done in both ways (the owner opens the sandbox once from ` +
        "Steam's Tools launcher and once from the direct start, runbook section 2)",
    );
  }
  // m-4 (DEC-034): a list that cannot be read, or no list at all, stops a real run too.
  if (sandboxReg === "unknown") {
    return stop(
      `the launcher's project lists could not all be read: registration unknown (${listsLine(lists, cfg.gproj)}); ` +
        "no step runs until every list can be read and names the sandbox; stop and ask the owner",
    );
  }
  if (gprojSteps && preselectionRefusal !== null) return stop(preselectionRefusal);
  if (needsDecoy) {
    if (!cfg.launcherLastIsDecoy) {
      return stop(
        `S-A-1 needs the decoy ${DECOY_NAME} as the launcher's last project, so that an ignored -wbProjectPath opens ` +
          "a throwaway and never an owner project; the owner opens it last, then confirm with --launcher-last-is-decoy",
      );
    }
    if (!decoyExists) {
      return stop(`the decoy ${DECOY_NAME}.gproj is missing: create it with the decoy subcommand`);
    }
    if (decoyReg === "unknown") {
      return stop(
        `the launcher's project lists could not be read: registration unknown, so S-A-1 cannot show that the decoy ${DECOY_NAME} is registered`,
      );
    }
    if (decoyReg === "not-registered") {
      return stop(
        `the launcher's project lists do not all name the decoy ${DECOY_NAME} (${listsLine(lists, decoyGproj(cfg.decoyDir))}): ` +
          "the owner has not opened it in both ways",
      );
    }
    if (preselection !== null) return stop(`S-A-1 refused: ${preselection}`);
  }
  if (addons.refusal) return stop(addons.refusal);
  const baselinePath = join(cfg.runDir, BASELINE_FILE);
  const resumed = existsSync(baselinePath);
  if (prior.present.length > 0 && !resumed) {
    return stop(
      `this run folder holds step results but no ${BASELINE_FILE}: post-flight's baseline is unknown; stop and ask the owner`,
    );
  }
  if (prior.unverified.length > 0) {
    deps.log(
      `prior results with no evidence record hashing them (they open no gate): ${prior.unverified.join(", ")}`,
    );
  }
  const validated = prior.verified.find((p) => p.step === "S-A-3" && p.outcome === "pass");
  const state: RunState = {
    assertionPassed: prior.verified.some((p) => p.form === "new" && p.assertion === "pass"),
    validateSelfExit: validated !== undefined,
    validateErrorBaseline: validated?.script_errors.count ?? 0,
    controlClean: prior.verified.some((p) => p.step === "S-A-6" && p.outcome === "pass"),
    lastHeartbeat: deps.now(),
    sandboxRegistration: sandboxReg,
    usedLogs: new Set(),
    sandboxShortDir: v.sandboxShortDir ?? null,
  };
  mkdirSync(cfg.runDir, { recursive: true });
  // A resumed run keeps its first snapshot and registry export: steps 5 and 6 are skipped.
  const pre = await deps.preflight(ctx, resumed ? new Set([5, 6]) : new Set());
  summary.preflight = pre.results;
  for (const s of pre.results) deps.log(toPlaceholders(formatStep(s), cfg.ph));
  if (!pre.ok) return stop("pre-flight stopped (steps 1 to 7)");
  let baseline: Baseline;
  if (resumed) {
    baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as Baseline;
    deps.log(`resumed run folder: post-flight uses the first run's baseline (${BASELINE_FILE})`);
  } else {
    const inRun = (p: string | undefined): string | null =>
      p ? relative(cfg.runDir, p).split(sep).join("/") : null;
    baseline = {
      snapshot_file: inRun(ctx.state.snapshotFile),
      registry_export: inRun(ctx.state.registryExport),
      written_at: new Date(deps.now()).toISOString(),
    };
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n", {
      encoding: "utf-8",
      flag: "wx",
    });
  }
  const fromRun = (p: string | null): string =>
    p ? toPlaceholders(join(cfg.runDir, ...p.split("/")), cfg.ph) : "none recorded";
  deps.log(`snapshot manifest (postflight --before): ${fromRun(baseline.snapshot_file)}`);
  deps.log(`registry export (postflight --registry-before): ${fromRun(baseline.registry_export)}`);
  if (setLine) deps.log(setLine);

  for (const step of steps) {
    deps.log(`${step.id} ${step.title}`);
    const r = await runStep(step, cfg, deps, state, addons.args);
    summary.records.push(r);
    if (r.pid === null) {
      // Refused before anything started: nothing ran, so no result and no evidence.
      return stop(`${step.id} refused before launch: ${r.detail}`);
    }
    const evId = writeRecord(cfg, deps, r);
    deps.log(
      `  ${r.outcome}${r.failure_result ? ` [${r.failure_result}]` : ""}; opened ${r.opened_project ?? "none named"}; ` +
        `exit ${r.exit.by_itself ? `by itself, code ${r.exit.code}` : r.exit.killed_by_run ? "killed by this run" : "not observed"}; ${evId}`,
    );
    if (r.detail) deps.log(`  ${toPlaceholders(r.detail, cfg.ph)}`);
    if (r.sandbox_root && (r.sandbox_root.added.length > 0 || r.sandbox_root.removed.length > 0)) {
      deps.log(
        `  sandbox root entries added: ${r.sandbox_root.added.join(", ") || "none"}; removed: ${r.sandbox_root.removed.join(", ") || "none"}`,
      );
    }
    if (r.window_probe.errors > 0) {
      deps.log(
        `  window probe errors: ${r.window_probe.errors} (last: ${toPlaceholders(r.window_probe.last_error ?? "", cfg.ph)})`,
      );
    }
    if (!r.continue_session)
      return stop(`${step.id}: ${r.outcome}${r.detail ? `: ${r.detail}` : ""}`);
  }
  summary.ok = true;
  summary.exitCode = 0;
  const last = steps[steps.length - 1];
  deps.log(
    `S-A steps done (${steps.map((s) => s.id).join(", ")}). Next: ` +
      (last.id === "S-A-7"
        ? "postflight.ts --id <lane id> with the snapshot manifest and registry export printed above"
        : "the next step's --only invocation in the same --run folder (runbook section 2), or post-flight if the sitting ends here"),
  );
  return summary;
}

/** `rollback`: undo U14 plants whose step stopped with Workbench still running. */
export function runRollback(cfg: SessionConfig, deps: SessionDeps): number {
  const gate = liveGateReason({
    really: cfg.really,
    platform: deps.platform,
    leaseHeld: cfg.lane.holdsLease(),
  });
  const plants = existsSync(cfg.runDir)
    ? readdirSync(cfg.runDir).filter((f) => /^u14-plant-S-A-\d\.json$/.test(f))
    : [];
  const open = plants.filter(
    (f) => !existsSync(join(cfg.runDir, f.replace("u14-plant-", "u14-rollback-"))),
  );
  if (open.length === 0) {
    deps.log("no U14 plant without a rollback in this run folder");
    return 0;
  }
  for (const f of open) deps.log(`${gate ? "would roll back" : "rolling back"} ${f}`);
  if (gate) {
    deps.log(gate);
    return cfg.really ? 1 : 0;
  }
  const outside = outsideArtifacts(cfg.runDir, cfg.artifactsRoot);
  if (outside) {
    deps.log(`refused: ${toPlaceholders(outside, cfg.ph)}`);
    return 1;
  }
  let running: number[];
  try {
    running = deps.workbenchPids();
  } catch (e) {
    deps.log(`could not list Workbench processes: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (running.length > 0) {
    deps.log(`Workbench is running (pid ${running.join(", ")}); close it first`);
    return 1;
  }
  let ok = true;
  for (const f of open) {
    let m: PlantManifest;
    let rb: RollbackResult;
    try {
      m = JSON.parse(readFileSync(join(cfg.runDir, f), "utf-8")) as PlantManifest;
      rb = rollbackU14(m, cfg.sandboxDir, deps);
    } catch (e) {
      // m-3 (DEC-034): no rollback record, so the plant stays open for the owner to look at.
      deps.log(
        `${f}: ${toPlaceholders(e instanceof Error ? e.message : String(e), cfg.ph)}; no rollback record ` +
          "written; stop and ask the owner",
      );
      ok = false;
      continue;
    }
    writeFileSync(
      join(cfg.runDir, f.replace("u14-plant-", "u14-rollback-")),
      JSON.stringify(rb, null, 2) + "\n",
      {
        encoding: "utf-8",
        flag: "wx",
      },
    );
    deps.log(`${m.step}: ${rb.ok ? "rolled back" : "INCOMPLETE"}: ${rb.detail}`);
    ok &&= rb.ok;
  }
  return ok ? 0 : 1;
}

/**
 * `recover`, the recorded recovery (B1 of DEC-030; per process since DEC-031). The logic is
 * `session-common.ts`'s `runRecover`, shared with S-B and S-C (DEC-032); S-A names its own next
 * step after a recovery (the U14 rollback).
 */
export function runRecover(
  cfg: RecoverConfig,
  deps: RecoverDeps,
  opts: { ownerGo: number | null } = { ownerGo: null },
): Promise<number> {
  return runRecoverCommon(cfg, deps, {
    ownerGo: opts.ownerGo,
    next: "the rollback command if a U14 plant is open, then git -C <sandbox> status --short",
  });
}

/**
 * `acknowledge` (DEC-031): the one way to clear a started marker that has no result. With the
 * owner's acknowledgement for this sitting (`--owner-ack`) it renames `<run>/S-A-n.started` to
 * `S-A-n.started.acknowledged`, so the other steps of the run folder may run again; S-A-n itself
 * never runs again in this run, and post-flight still counts it as a step whose Workbench exit is
 * unknown. It refuses while any Workbench image runs (recover first), while the step's U14 plant
 * has no rollback record (rollback first), when the step has a result or no marker, and outside
 * the artifacts folder. A dry run unless the live gate passes. The logic is
 * `session-common.ts`'s `acknowledgeMarker` (DEC-032).
 */
export function runAcknowledge(
  cfg: SessionConfig,
  deps: Pick<SessionDeps, "platform" | "workbenchPids" | "log">,
  opts: { step: StepId; ownerAck: boolean },
): number {
  return acknowledgeMarker(cfg, deps, {
    step: opts.step,
    ownerAck: opts.ownerAck,
    resultFile: resultPath(cfg.runDir, opts.step),
    would: "no Workbench image runs and no U14 plant of the step is open",
    extraRefusal: () =>
      existsSync(join(cfg.runDir, `u14-plant-${opts.step}.json`)) &&
      !existsSync(join(cfg.runDir, `u14-rollback-${opts.step}.json`))
        ? `the U14 plant of ${opts.step} has no rollback record; run the rollback command first`
        : null,
  });
}

/**
 * `decoy`: create the 2.0 decoy addon `<addons>/EMCP2_decoy/EMCP2_decoy.gproj` (base game only,
 * from the repository's project template). A dry run unless `--really`; a real run is
 * Windows-only like every other real operation (it creates one folder and one file in the
 * Workbench addons folder); refuses a folder that exists and is not empty, and the sandbox
 * folder. No Workbench is involved; the owner then opens it from the launcher.
 */
export function runDecoy(
  cfg: Pick<SessionConfig, "decoyDir" | "sandboxDir" | "really" | "ph">,
  deps: Pick<SessionDeps, "fs" | "log" | "platform">,
): number {
  const gproj = decoyGproj(cfg.decoyDir);
  const shown = toPlaceholders(gproj, cfg.ph);
  if (resolve(cfg.decoyDir).toLowerCase() === resolve(cfg.sandboxDir).toLowerCase()) {
    deps.log("refused: the decoy folder is the sandbox");
    return 1;
  }
  if (!cfg.really) {
    deps.log(`dry run (pass --really to create it): would create ${shown}`);
    return 0;
  }
  if (deps.platform !== "win32") {
    deps.log(
      `refused: real operation is Windows-only (platform ${deps.platform}); would create ${shown}`,
    );
    return 1;
  }
  if (deps.fs.exists(cfg.decoyDir) && deps.fs.readdir(cfg.decoyDir).length > 0) {
    deps.log(`refused: ${toPlaceholders(cfg.decoyDir, cfg.ph)} exists and is not empty`);
    return 1;
  }
  if (!deps.fs.exists(cfg.decoyDir)) deps.fs.mkdir(cfg.decoyDir);
  deps.fs.writeNew(gproj, generateGproj({ name: DECOY_NAME, title: DECOY_TITLE }));
  deps.log(`created ${shown}`);
  deps.log(
    "Next step (owner): after OA-3, open this .gproj from the Enfusion Workbench launcher, close Workbench, " +
      "and open no other project before session S-A, so the decoy is the launcher's last project.",
  );
  return 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export async function main(argv: string[], override: Partial<SessionDeps> = {}): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, [
      "out",
      "id",
      "from",
      "only",
      "run",
      "validate-config",
      "addons-dir",
      "sandbox",
      "queue",
      "registry-key",
      "workbench-path",
      "game-path",
      "logs-path",
      "ledger-meta",
      "lease-path",
      "marker-path",
      "evidence-dir",
      "decoy",
      "lint",
      "owner-go",
      "step",
      "idle-quiet-ms",
      "idle-cpu-percent",
    ]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  const cmd = args.positional[0] ?? "run";
  if (!["run", "rollback", "recover", "acknowledge", "decoy"].includes(cmd)) {
    console.error(
      "Usage: s-a-headless.ts [run] [options] | rollback --run <dir> --id <id> [--really] | " +
        "recover --run <dir> --id <id> [--owner-go <pid>] [--really] | " +
        "acknowledge --run <dir> --id <id> --step S-A-n [--owner-ack] [--really] | decoy [--really]",
    );
    return 2;
  }
  let ownerGo: number | null = null;
  if (o["owner-go"] !== undefined) {
    ownerGo = Number(o["owner-go"]);
    if (!Number.isInteger(ownerGo) || ownerGo <= 0) {
      console.error("--owner-go takes the pid the owner's word names");
      return 2;
    }
  }
  if (cmd === "acknowledge" && (!o.step || !stepById(o.step))) {
    console.error(`acknowledge needs --step, one of ${STEPS.map((s) => s.id).join(", ")}`);
    return 2;
  }
  if (o.lint !== undefined && o.lint !== "passed" && o.lint !== "triaged") {
    console.error("--lint must be passed or triaged");
    return 2;
  }
  const idleQuietMs = o["idle-quiet-ms"] === undefined ? IDLE_QUIET_MS : Number(o["idle-quiet-ms"]);
  if (!Number.isInteger(idleQuietMs) || idleQuietMs <= 0) {
    console.error("--idle-quiet-ms takes a positive whole number of milliseconds");
    return 2;
  }
  const idleCpuPercent =
    o["idle-cpu-percent"] === undefined ? IDLE_CPU_PERCENT : Number(o["idle-cpu-percent"]);
  if (!Number.isFinite(idleCpuPercent) || idleCpuPercent < 0 || idleCpuPercent > 100) {
    console.error("--idle-cpu-percent takes a number from 0 to 100");
    return 2;
  }
  for (const k of ["from", "only"] as const) {
    if (o[k] !== undefined && !stepById(o[k])) {
      console.error(`--${k} must be one of ${STEPS.map((s) => s.id).join(", ")}`);
      return 2;
    }
  }
  if (o.from && o.only) {
    console.error("--from and --only exclude each other");
    return 2;
  }
  if ((cmd === "rollback" || cmd === "recover" || cmd === "acknowledge") && !o.run) {
    console.error(`${cmd} needs --run <run dir>`);
    return 2;
  }
  if ((cmd === "recover" || cmd === "acknowledge") && !o.id) {
    console.error(`${cmd} needs --id <lane id> (the lane that holds the lease)`);
    return 2;
  }
  // Every printed path in placeholder form (plan 5.2), the catch below included.
  let ph: PlaceholderContext = defaultPlaceholderContext({ v2: REPO_ROOT });
  try {
    const needConfig = !o["workbench-path"] || !o["game-path"] || !o.sandbox || !o["logs-path"];
    const config = needConfig ? loadConfig() : null;
    const sandboxDir = resolve(o.sandbox ?? join(config!.projectPath, SANDBOX_NAME));
    // The action-plan checker sees only `<sandbox>`: the folder itself must be the 2.0 sandbox.
    if (basename(sandboxDir) !== SANDBOX_NAME) {
      console.error(
        `refused: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}, not ${toPlaceholders(sandboxDir, ph)}`,
      );
      return 2;
    }
    const gproj = join(sandboxDir, `${SANDBOX_NAME}.gproj`);
    const workbenchPath = o["workbench-path"] ?? config!.workbenchPath;
    const gamePath = o["game-path"] ?? config!.gamePath;
    const logsPath = o["logs-path"] ?? config!.logsPath;
    const artifactsRoot = artifactsDir();
    const runDir = resolve(
      o.run ??
        join(artifactsRoot, "sessions", SESSION_ID, new Date().toISOString().replace(/[:.]/g, "-")),
    );
    const decoyDir = resolve(o.decoy ?? join(dirname(sandboxDir), DECOY_NAME));
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    const ledgerMetaPath =
      o["ledger-meta"] ?? join(REPO_ROOT, "data", "census", "ledger.meta.json");
    ph = defaultPlaceholderContext({
      sandbox: sandboxDir,
      game: gamePath,
      tools: workbenchPath,
      v2: REPO_ROOT,
    });
    const cfg: SessionConfig = {
      lane,
      really: args.flags.has("really"),
      workbenchPath,
      gamePath,
      sandboxDir,
      gproj,
      logsPath,
      artifactsRoot,
      runDir,
      evidenceDir: resolve(o["evidence-dir"] ?? join(runDir, "evidence")),
      decoyDir,
      launcherLastIsDecoy: args.flags.has("launcher-last-is-decoy"),
      lint: (o.lint as "passed" | "triaged" | undefined) ?? null,
      queuePath: o.queue ?? DEFAULT_QUEUE,
      ledgerMetaPath,
      registryKey: o["registry-key"] ?? process.env.ENFUSION_WB_REGISTRY_KEY ?? null,
      validateConfig: o["validate-config"] ?? DEFAULT_VALIDATE_CONFIG,
      bundledHandlerDir: BUNDLED_HANDLER_DIR,
      launcherKnowsSandbox: args.flags.has("launcher-knows-sandbox"),
      addonsDirOverride: o["addons-dir"],
      from: o.from as StepId | undefined,
      only: o.only as StepId | undefined,
      port: config?.workbenchPort ?? 5775,
      build:
        (existsSync(ledgerMetaPath) ? recordedBuild(ledgerMetaPath)?.build : null) ?? "unknown",
      policy: loadPolicy(),
      ph,
      outPlan: o.out,
      idleQuietMs,
      idleCpuPercent,
    };
    const deps: SessionDeps = {
      ...defaultDeps({
        logsPath,
        depsPaths: config
          ? {
              projectPath: config.projectPath,
              corePath: config.corePath,
              gamePath,
              workshopPath: config.workshopPath,
            }
          : null,
      }),
      ...override,
    };
    if (cmd === "rollback") return runRollback(cfg, deps);
    if (cmd === "recover") {
      return await runRecover(cfg, deps, { ownerGo });
    }
    if (cmd === "acknowledge") {
      return runAcknowledge(cfg, deps, {
        step: o.step as StepId,
        ownerAck: args.flags.has("owner-ack"),
      });
    }
    if (cmd === "decoy") return runDecoy(cfg, deps);
    const summary = await runSession(cfg, deps);
    return summary.exitCode;
  } catch (e) {
    console.error(toPlaceholders(e instanceof Error ? e.message : String(e), ph));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
