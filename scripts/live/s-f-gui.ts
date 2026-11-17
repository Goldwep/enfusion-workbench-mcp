/**
 * Session S-F (plan 8 Phase 2 table), GUI interaction on the scratch profile: a GUI Workbench on
 * the 2.0 sandbox with the shipped handler set and the read-only probe pack only (`mod-dev/probe`,
 * `ECEN_Probe`, with its `authProbe` action in ECEN_ProbeAuth.c). No mutating pack. It carries
 * U27 (the per-method "Script Authorization Required" prompt, launched WITHOUT
 * `-scriptAuthorizeAll`), U21 (menus), U31 (Qt Introspection), U23 (the Dialogue Editor), U22
 * (settings honoured at the next start), U20 (the LSP) and U36 (PropertyGrid\unnamed), over two
 * launches and three offline phases in one sitting.
 *
 * DRY RUN BY DEFAULT. Without --really the script touches nothing: it prints the session outline
 * and the ACTION PLAN (the JSON array `scripts/live/dry-run.ts` checks), checks the plan against
 * the policy, and writes the plan to --out. A real run needs --really, a win32 host and the lease
 * held by the lane given with --id. The runbook is docs/v2/sessions/queues/S-F.md; the queue is
 * docs/v2/sessions/queues/S-F-queue.json (`--emit-queue` rewrites it from the step table below,
 * and a test keeps the two equal).
 *
 * The model is scripts/live/s-e-train1b.ts (S-E) with S-D's authorization handoff. Built in from
 * DEC-040 to DEC-045 and the owner's rulings for S-F (sf-team PLAN.md sections 1, 2 and 7):
 *
 * 1. The launch has no `-scriptAuthorizeAll`: every prompt is expected. The CLI refuses
 *    `--script-authorize-all` and any `-scriptAuthorizeAll` token (exit 2); the queue's
 *    `launch_args` holds no such flag.
 * 2. Every prompt is a HANDOFF (exit 5): nothing is sent to the prompt window. The owner presses
 *    the step's ruled button: Yes everywhere, No on sf-04 (FileExists), Yes to All on sf-09
 *    (OpenFile). The resume names the button (`--owner-clicked`); a button other than the ruled
 *    one is refused unless `--owner-clicked-deviation` is given (both are recorded). The resume
 *    records the detached child's late answer (what a refused or allowed call returned) and the
 *    prompt's text from the passive walker's file. sf-21 and sf-21b, after the restart, show
 *    whether Yes and Yes to All survive it.
 *    `--ruled-buttons step=Button,...` replaces the ruling for one invocation (P3-1); the deviation
 *    flag then means a press other than that ruling, and the U27 verdicts read the recorded presses.
 * 3. One NET call at a time; every dialog-capable call runs in a detached child while the parent
 *    polls the window list. The LSP socket is not a NET call; lsp-probe never gets the NET port.
 * 4. The Particle Editor is never addressed; moduleMatrix is never sent. No world is opened:
 *    every `.ent` is refused; MainMenuWorld.ent is never named; EMCP_WB_EditorControl is never
 *    sent. The native OpenResource only in sf-17, only for a `.st` (`--st-path`).
 * 5. The probe pack's executeAction only in sf-14, only `ResourceManager` > Utilities > Qt
 *    Introspection Tool, and only when sf-12 read that exact label under "Utilities".
 * 6. Launch 1 is closed by the owner's hand (no WM_CLOSE in launch 1). In launch 2 sf-27 sends one
 *    WM_CLOSE only when the main window is the pid's only top-level window (DEC-044, DEC-045);
 *    otherwise the close is the owner's hand.
 * 7. Owner-hand steps (sf-13, sf-15, sf-26, and sf-27 when the close is the owner's) end the
 *    invocation with exit 5 and the kind `owner-hand`; the resume is `--only <step> --owner-done`.
 *    `--owner-clicked` is refused for them and `--owner-done` for an authorization handoff.
 * 8. While "Script Authorization Required" is up nothing is sent: no NET call, no menus tool, no
 *    LSP (every tool step checks the window list first). No NET call at all in sf-26.
 *
 * Offline phases (no Workbench may run, `--offline`): sf-p2 and sf-p1 before launch 1, sf-p3 and
 * sf-p4 between the launches (after the owner's close and `postflight.ts --partial 1,2,3`), sf-p5
 * after launch 2. The scratch-ini edits go through `scripts/live/ini-edit.ts`, the LSP through
 * `scripts/live/lsp-probe.ts`, the menus through `tools/uia/menus.ts` (sf-coder-harness); each is a
 * child process through `SfDeps.runTool`.
 *
 * Usage:
 *   npx --no tsx scripts/live/s-f-gui.ts [--out <plan.json>] [--outline <file>] [--sandbox <dir>]
 *       [--emit-queue <file>] [--st-path <vanilla .st>] [--conf <vanilla .conf>]
 *   npx --no tsx scripts/live/s-f-gui.ts --really --id <lane id>
 *       --registry-export <pre-flight .reg> --force-settings <scratch.ini under the artifacts folder>
 *       (--from <step id> --until <step id> | --only <step id>) [--offline]
 *       [--run-dir <dir>] [--owner-clicked <button>[,<button>...] [--owner-clicked-deviation]]
 *       [--ruled-buttons <step>=<button>,...]
 *       [--owner-done] [--st-path <vanilla .st>] [--conf <vanilla .conf>] [--ini-in <ini>]
 *       [--debug-mode-unset-ok] [--sandbox <dir>] [--opened-project-pattern <regex>]
 *       [--allowed-addons a,b] [--owned-module-classes a,b] [--build <tag>] [--port 5775]
 *       [--lease-path p] [--marker-path p] [--nonce <hex>]
 *   npx --no tsx scripts/live/s-f-gui.ts recover --run-dir <dir> --id <lane id> [--owner-go <pid>] [--really]
 *   npx --no tsx scripts/live/s-f-gui.ts acknowledge --run-dir <dir> --id <lane id> --step <id> [--owner-ack] [--really]
 *
 * Exit: 0 done (or dry run passed), 1 refused or plan check failed, 2 usage, 3 stopped for the
 *       main session, 4 aborted (not the sandbox), 5 handoff (an authorization prompt or an
 *       owner-hand step; resume as the message says).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config.js";
import { API_FILES } from "../census/enumerators/e12-api-index.js";
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
import { CLOSE_SCRIPT, readRegFile, writeGracefulExit } from "./postflight.js";
import { newestSessionLog, openedProjectFromLog, recordedBuild } from "./preflight.js";
import { lastLine, runPowerShell } from "./powershell.js";
import {
  HELPER,
  INVOCATION_MARGIN_MS,
  StopSession,
  TIMEOUTS as SC_TIMEOUTS,
  WINDOWS_SCRIPT,
  acceptedWindow,
  baselineProblem,
  blockArgs,
  childRequest,
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
  VANILLA as SD_VANILLA,
  EVAL_OK,
  authLogEntries,
  authWindow,
  mainWindowOf,
  nonceProblem,
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

export const SESSION = "S-F";
export const SCRIPT_PATH = "scripts/live/s-f-gui.ts";
const SCRIPT_ABS = fileURLToPath(import.meta.url);
const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-F-queue.json");

export const EXIT = { done: 0, refused: 1, usage: 2, stopped: 3, aborted: 4, handoff: 5 } as const;

/** The NET function of the read-only probe pack (mod-dev/probe/ECEN_Probe.c). */
export const PROBE_API = "ECEN_Probe";
/** The mutating pack's NET function: never sent in S-F (the pack is not installed). */
export const MUT_API = "ECEN_ProbeMut";
/** The LSP port S-F enables in the launch-2 ini (sf-p4) and probes (U20, U22). */
export const LSP_PORT = 5776;

/** The flag S-F never launches with, in any spelling. */
export const NEVER_FLAG = "-scriptAuthorizeAll";
export const NEVER_CLI_FLAG = "--script-authorize-all";
/** The launch arguments the queue records (pre-flight builds the real ones): no -scriptAuthorizeAll. */
export const LAUNCH_ARGS: readonly string[] = ["-gproj", "<sandbox>/EMCP2_sandbox.gproj"];

/** authProbe's compiled list (ECEN_ProbeAuth.c, sf-coder-pack): authMethod, authRoot, authVariant. */
export const AUTH_METHODS = ["FileExists", "OpenFile", "FindFiles", "SearchResources"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];
/** The one root authProbe accepts (PLAN section 7: sandbox only, no $profile:). */
export const AUTH_ROOT = `$${SANDBOX_NAME}:`;
/** The two FindFiles call sites (b for FindFiles only). */
export const AUTH_VARIANTS = ["a", "b"] as const;
export type AuthVariant = (typeof AUTH_VARIANTS)[number];
/** The fixed sandbox file FileExists and OpenFile name in the pack. */
export const AUTH_FILE = `${SANDBOX_NAME}.gproj`;

/** The one executeAction path S-F may send (U31; policy execute_action.allow_list). */
export const QT_INTROSPECTION_PATH = ["Utilities", "Qt Introspection Tool"] as const;
export const QT_MODULE = "ResourceManager";
export const NEVER_MODULE = "ParticleEditor";

/** The menu titles sf-12 and sf-13 expand (depth 1), [unverified] labels of the Resource Manager. */
export const MENU_TITLES: readonly string[] = [
  "File",
  "Edit",
  "View",
  "Editors",
  "Utilities",
  "Plugins",
  "Window",
  "Help",
];

/** The ini section prefix sf-p1 drops (U36). */
export const PROPERTY_GRID_PREFIX = "PropertyGrid\\unnamed\\";
/** The three launch-2 ini edits (sf-p4, U22 inputs). */
// The preset is not a plain key: the scrubbed ini holds ONE struct-valued line,
// `ScriptTools\SCR_ImageSetGenerator=SCR_ImageSetGenerator {, " m_iImageWidth 512", " m_iImageHeight 512", }`,
// in [Resource%20Manager] (sf-launch1.ini of run 2026-10-09T04-09-47-166Z, line 213); the edit
// rewrites its m_iImageWidth token 512 -> 384 (ini-edit set --token --old).
export const LAUNCH2_EDITS: ReadonlyArray<{
  section: string;
  key: string;
  value: string;
  create?: boolean;
  token?: string;
  old?: string;
}> = [
  { section: "Workbench", key: "LSP_Enabled", value: "1", create: true },
  { section: "Workbench", key: "LSP_Port", value: String(LSP_PORT), create: true },
  {
    section: "Resource%20Manager",
    key: "ScriptTools\\SCR_ImageSetGenerator",
    token: "m_iImageWidth",
    old: "512",
    value: "384",
  },
];
export const PRESET_CLASS = "SCR_ImageSetGenerator";

/** One launch-2 edit as the step title states it. */
export function launch2EditText(e: (typeof LAUNCH2_EDITS)[number]): string {
  return e.token !== undefined
    ? `[${e.section}] ${e.key} token ${e.token} ${e.old} -> ${e.value}`
    : `[${e.section}] ${e.key}=${e.value}${e.create ? " (created if absent)" : ""}`;
}
export const PRESET_VALUE = "384";

/** Run-folder names of the scratch inis (the artifacts folder only). */
export const INI_LAUNCH1 = "sf-launch1.ini";
export const INI_LAUNCH2 = "sf-launch2.ini";

/** The owner's ruled button per step (Q1, PLAN section 7): Yes unless named here. */
export const RULED_BUTTON: Readonly<Record<string, AuthButton>> = {
  "sf-04-u27-fileexists": "No",
  "sf-09-u27-openfile-yes-to-all": "YesToAll",
};
export function ruledButton(step: string): AuthButton {
  return RULED_BUTTON[step] ?? "Yes";
}
/**
 * The ruling in force for one invocation: a button given on the command line (`--ruled-buttons
 * step=Button,...`, P3-1's rulings) wins over S-F's own. `--owner-clicked-deviation` means a press
 * that differs from THIS ruling.
 */
export function ruledFor(
  step: string,
  over?: Readonly<Record<string, AuthButton>> | null,
): AuthButton {
  return over?.[step] ?? ruledButton(step);
}
/** Parse `--ruled-buttons step=Button[,step=Button...]`; throws on an unknown button or a bad pair. */
export function parseRuledButtons(text: string): Record<string, AuthButton> {
  const out: Record<string, AuthButton> = {};
  for (const part of text
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^([a-z0-9-]+)=([A-Za-z]+)$/.exec(part);
    if (!m || !(AUTH_BUTTONS as readonly string[]).includes(m[2]))
      throw new Error(`--ruled-buttons: "${part}" is not <step>=<${AUTH_BUTTONS.join("|")}>`);
    out[m[1]] = m[2] as AuthButton;
  }
  return out;
}
/** The owner's recorded presses of one step (authorization-log.jsonl), or null when it never prompted. */
export function pressesOf(
  presses: ReadonlyArray<{ step: string; buttons: string[] }>,
  step: string,
): string[] | null {
  const e = presses.filter((x) => x.step === step);
  return e.length ? e.flatMap((x) => x.buttons) : null;
}

export const TIMEOUTS = {
  cheap: 10_000,
  probe: 30_000,
  bohemia: 30_000,
  gui: 60_000,
  tool: 60_000,
  menus: 300_000,
  lsp: 120_000,
  /** How long a detached child keeps waiting beyond its call's timeout (the owner's click). */
  authClick: 900_000,
  ready: SC_TIMEOUTS.ready,
  poll: SC_TIMEOUTS.poll,
  detachedGrace: SC_TIMEOUTS.detachedGrace,
  close: SC_TIMEOUTS.close,
} as const;

export const detachedMs = (timeoutMs: number): number =>
  detachedBudgetMs(timeoutMs) + HELPER.windows;
const plainMs = (timeoutMs: number): number => timeoutMs + HELPER.windows;

/** The phases of the sitting (queue `launch`), in order; contiguous in the queue. */
export type Phase = "offline-0" | 1 | "offline-1" | 2 | "offline-2";
export const OFFLINE_PHASES: readonly Phase[] = ["offline-0", "offline-1", "offline-2"];
export const isOffline = (p: Phase): boolean => (OFFLINE_PHASES as readonly Phase[]).includes(p);

/** The declared blocks, one per invocation (PLAN section 3). */
export const BLOCKS: ReadonlyArray<{ from: string; until: string }> = [
  { from: "sf-p2-dlg-consumers-static", until: "sf-p1-ini-launch1" },
  { from: "sf-01-port-5776-closed", until: "sf-01-port-5776-closed" },
  { from: "sf-02-u27-findfiles", until: "sf-02-u27-findfiles" },
  { from: "sf-03-u27-findfiles-again", until: "sf-03-u27-findfiles-again" },
  { from: "sf-04-u27-fileexists", until: "sf-04-u27-fileexists" },
  { from: "sf-05-u27-findfiles-line-b", until: "sf-05-u27-findfiles-line-b" },
  { from: "sf-07-u27-loadcontainer", until: "sf-07-u27-loadcontainer" },
  { from: "sf-08-u27-compilescript", until: "sf-08-u27-compilescript" },
  { from: "sf-09-u27-openfile-yes-to-all", until: "sf-09-u27-openfile-yes-to-all" },
  { from: "sf-10-u27-searchresources-after-yta", until: "sf-10-u27-searchresources-after-yta" },
  { from: "sf-12-u21-menus-background", until: "sf-14-u31-qt-introspection" },
  { from: "sf-15-u21-context-menu-owner", until: "sf-15-u21-context-menu-owner" },
  { from: "sf-16-l421-editor-windows", until: "sf-17-l410-open-st" },
  { from: "sf-p3-ini-after-launch1", until: "sf-p4-ini-launch2" },
  { from: "sf-20-gate", until: "sf-20-gate" },
  { from: "sf-21-u27-restart", until: "sf-21-u27-restart" },
  { from: "sf-21b-u27-restart-yta", until: "sf-21b-u27-restart-yta" },
  { from: "sf-22-u22-lsp-port", until: "sf-23-u22-plugin-preset" },
  { from: "sf-24-u20-lsp-session", until: "sf-25-u20-coexistence" },
  { from: "sf-26-u36-shortcuts-page-owner", until: "sf-27-close-test" },
  { from: "sf-p5-ini-after-launch2", until: "sf-p5-ini-after-launch2" },
];

const E = (s: string): string => `P-E01-${s}`;

/** Probes, or parts, S-F does not answer (PLAN section 2, "Not answered"). */
export const NOT_ANSWERED: readonly NotAnswered[] = [
  {
    id: "P-SD-openmodule-particleeditor-crash",
    part: "all",
    missing: "whether OpenModule(ParticleEditor) crashes again",
    reason: "Q12: the Particle Editor is never addressed (DEC-042); deferred indefinitely",
    carried_to: "none (deferred indefinitely)",
  },
  {
    id: E("world-editor-L490"),
    part: "all",
    missing: "the whole probe",
    reason: "S-F opens no world (DEC-045)",
    carried_to: "Phase 3",
  },
  {
    id: E("script-string-dialogue-L438"),
    part: "part",
    missing: "whether the game runtime plays a .dlg",
    reason: "S-F runs no game; sf-p2 reads the static consumers only",
    carried_to: "Phase 3",
  },
  {
    id: "P-U27",
    part: "part",
    missing: "a FindFiles on $profile:",
    reason: "authProbe is sandbox-only (PLAN section 7); the old sf-06 is dropped",
    carried_to: "none",
  },
];

/** Reasons of the conditional skips. */
export const SKIP_REASON = {
  st: "no vanilla .st path named (--st-path not given)",
  menusOpened: "sf-12 opened a menu in the background: the foreground pass is not needed",
  noQtLabel:
    'sf-12 did not read the exact label "Qt Introspection Tool" under "Utilities": executeAction is not sent',
  lspNotListening: `sf-22 did not see port ${LSP_PORT} listening: the LSP setting was not honoured, no LSP session`,
  rowsPresent:
    "sf-p3 found PropertyGrid\\unnamed rows written back at launch 1: the Shortcuts page is not needed for U36",
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolResult {
  code: number;
  /** ini-edit: its --record; lsp-probe: its --out; menus: its last stdout line over its --out. */
  json: unknown;
  /** The tool's stdout (ini-edit read-keys prints its key list there). */
  stdout?: string;
  detail: string;
}

/** Everything that would touch a process, a socket, the desktop or a file outside the artifacts folder. */
export interface SfDeps {
  net(apiFunc: string, params: Record<string, unknown>, timeoutMs: number): Promise<RawCallResult>;
  listWindows(): Promise<WindowInfo[]>;
  capture(label: string): Promise<{ ok: boolean; path: string; detail: string }>;
  processImage(pid: number): string | null;
  processCreated(pid: number): Promise<number | null>;
  workbenchPids(): number[];
  listRunFiles(): string[];
  listDir(path: string): string[];
  /** Listener pids of a TCP port. */
  portOwners(port: number): number[];
  crashReporters(): number[];
  closeGracefully(pid: number, timeoutMs: number): Promise<{ exited: boolean; detail: string }>;
  recordedPid(): number | null;
  heartbeat(): void;
  sessionLogAfter(after: number | null): string | null;
  readText(path: string): string;
  readRegLines(path: string): string[];
  fileExists(path: string): boolean;
  startDetached(spec: DetachedSpec): number;
  /**
   * A harness tool as a child process: ini-edit (scripts/live/ini-edit.ts), lsp-probe
   * (scripts/live/lsp-probe.ts) or menus (tools/uia/menus.ts). The result file is read back.
   */
  runTool(
    tool: "ini-edit" | "lsp-probe" | "menus",
    args: string[],
    timeoutMs: number,
  ): Promise<ToolResult>;
  /** The static .dlg consumer scan (sf-p2): class names only, from the repo's scraped index. */
  dlgConsumers(): { classes: string[]; files: number };
  readRunFile(name: string): string | null;
  appendRunLine(name: string, line: string): void;
  writeArtifact(name: string, value: unknown): string;
  writeEvidence(summary: string, artifactPath: string): string;
  writeGracefulExit(pid: number, how: string): string;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export interface SfOptions {
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
  offline: boolean;
  ownerClicked?: AuthButton | readonly AuthButton[] | null;
  ownerClickedDeviation?: boolean;
  /** --ruled-buttons: rulings that replace S-F's own for this invocation (P3-1). */
  ruledButtons?: Readonly<Record<string, AuthButton>> | null;
  ownerDone?: boolean;
  ownedModuleClasses?: string[];
  /** --st-path: the vanilla .st sf-17 opens (null: sf-17 skips). */
  stPath?: string | null;
  /** --conf: the vanilla .conf sf-07 loads. */
  conf?: string;
  /** --ini-in: the freshly scrubbed scratch-ini export sf-p1 starts from. */
  iniIn?: string | null;
  netPort?: number;
  /** The artifacts folder (ini-edit --artifacts). */
  artifactsRoot?: string;
}

interface SfState {
  wbPid: number | null;
  startedPids: Set<number>;
  baselineWindows: WindowInfo[];
  yesToAll: boolean;
  /** Every recorded press of the run folder (authorization-log.jsonl), in order. */
  presses: Array<{ step: string; buttons: string[] }>;
  mainHwnd: number | null;
  logScan: LogScan | null;
}

export interface DetachedOpts {
  expected?: (w: WindowInfo) => boolean;
}

export interface SfContext {
  opts: SfOptions;
  deps: SfDeps;
  state: SfState;
  calls: CallRecord[];
  step: string;
  call(spec: CallSpec): Promise<RawCallResult>;
  detached(spec: CallSpec, label: string, o?: DetachedOpts): Promise<RawCallResult>;
  ourWindows(): Promise<WindowInfo[]>;
  modalCheck(label: string, expected?: (w: WindowInfo) => boolean): Promise<WindowInfo[]>;
  setBaseline(label: string): Promise<WindowInfo[]>;
  /** Before a tool or an owner-hand step: stops while the authorization window is up. */
  noAuthWindow(label: string): Promise<WindowInfo[]>;
  tool(
    tool: "ini-edit" | "lsp-probe" | "menus",
    args: string[],
    timeoutMs: number,
  ): Promise<ToolResult>;
}

export interface PlanInput {
  sandbox: string;
  conf: string;
  stPath: string | null;
}

export interface StepDef {
  id: string;
  title: string;
  risk: RiskClass;
  launch: Phase;
  answers: string[];
  touches?: string[];
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  outline: string[];
  /** An authorization-capable step: the owner's ruled button. */
  ruled?: AuthButton;
  /** An owner-hand step: the owner's instruction (exit 5, `owner-hand`). */
  ownerHand?: string;
  skipWhen?: { condition: string; carried_to: string };
  preSkip?(o: SfOptions, deps: SfDeps): string | null;
  skip?(ctx: SfContext): string | null;
  plan(p: PlanInput): PlanAction[];
  run(ctx: SfContext): Promise<StepOutcome>;
}

/** Thrown by an owner-hand step before it acts: exit 5, kind `owner-hand`. */
export class OwnerHand extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerHand";
  }
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

/** One authProbe call (fields as ECEN_ProbeAuth.c reads them: authMethod, authRoot, authVariant). */
export function authProbe(method: AuthMethod, variant: AuthVariant = "a"): CallSpec {
  return probe(
    "authProbe",
    { authMethod: method, authRoot: AUTH_ROOT, authVariant: variant },
    TIMEOUTS.probe,
    `authProbe ${method} ${variant}`,
  );
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

/** A passive walker read (tools/uia/walk.ts), as S-D plans it. */
function walkRead(step: string, probes: string[], label: string, allowOwned = false): PlanAction {
  return {
    kind: "uia-read",
    step,
    probes,
    target: {
      pid: LANE_RECORDED_PID,
      window: {
        className: `<Win32 class of the ${label} window, read from the window list at run time>`,
        titlePattern: `<exact title of the ${label} window, escaped>`,
        allowOwned,
      },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: { ...WALK_DEFAULT_BOUNDS },
    note: "tools/uia/walk.ts, run by the main session; passive",
  };
}

function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsOf(x, out));
  return out;
}

/**
 * Why the script refuses to send a call, or null. Pure; the engine checks every call with it.
 * `qtLabelRead`: sf-12 read the exact Qt Introspection label under "Utilities".
 */
export function sendRefusal(
  step: string,
  apiFunc: string,
  params: Record<string, unknown>,
  policy: CensusPolicy,
  qtLabelRead = false,
): string | null {
  const hit = deniedApi(apiFunc, deniedApiNames(policy));
  if (hit) return `${apiFunc} is on the policy deny list (${hit})`;
  const strings = stringsOf(params);
  const action = S(params.action);
  if (strings.some((s) => s.trim().toLowerCase() === NEVER_MODULE.toLowerCase()))
    return "the Particle Editor is never addressed in S-F (DEC-042)";
  if (strings.some((s) => /MainMenuWorld/i.test(s)))
    return "MainMenuWorld.ent is never named in S-F (DEC-042)";
  if (strings.some((s) => /\.ent\s*$/i.test(s)))
    return "no world is opened or loaded in S-F: a .ent is refused in every request";
  if (strings.some((s) => s.includes(NEVER_FLAG))) return `${NEVER_FLAG} is never sent in S-F`;
  if (apiFunc === MUT_API)
    return "the mutating pack is not part of S-F: ECEN_ProbeMut is never sent";
  if (
    /^(SaveContainer|CreateWorld|TextureValidator)$/i.test(apiFunc) ||
    /^(saveContainer|createSandboxWorlds)$/.test(action)
  )
    return `${apiFunc} ${action} writes: S-F sends no write`;
  if (apiFunc === "EMCP_WB_EditorControl")
    return "EMCP_WB_EditorControl is not used in S-F (no world opens)";
  if (/executeaction/i.test(apiFunc)) return `${apiFunc} is never sent in S-F`;
  if (apiFunc === "OpenResource") {
    if (step !== "sf-17-l410-open-st")
      return `OpenResource is refused in ${step}: only sf-17 sends it`;
    if (!/\.st$/i.test(S(params.ResourceName))) return "OpenResource in sf-17 opens a .st only";
  }
  if (apiFunc === PROBE_API) {
    if (action === "moduleMatrix") return "moduleMatrix is never sent in S-F";
    if (action === "executeAction") {
      if (step !== "sf-14-u31-qt-introspection")
        return `executeAction is refused in ${step}: only sf-14 sends it`;
      const path = Array.isArray(params.menuPath) ? (params.menuPath as unknown[]) : [];
      if (
        params.moduleName !== QT_MODULE ||
        path.length !== QT_INTROSPECTION_PATH.length ||
        path.some((p, i) => p !== QT_INTROSPECTION_PATH[i])
      )
        return `executeAction sends only ${QT_MODULE} ${QT_INTROSPECTION_PATH.join(" > ")}`;
      if (!qtLabelRead)
        return `executeAction is refused until sf-12 has read "${QT_INTROSPECTION_PATH[1]}" under "${QT_INTROSPECTION_PATH[0]}"`;
    }
    if (action === "authProbe") {
      const m = S(params.authMethod);
      if (!(AUTH_METHODS as readonly string[]).includes(m))
        return `authProbe authMethod ${m || "(none)"} is not on the list: ${AUTH_METHODS.join(", ")}`;
      if (params.authRoot !== AUTH_ROOT)
        return `authProbe authRoot ${JSON.stringify(params.authRoot)} is refused: ${AUTH_ROOT} only`;
      const v = S(params.authVariant);
      if (!(AUTH_VARIANTS as readonly string[]).includes(v) || (v === "b" && m !== "FindFiles"))
        return `authProbe authVariant ${JSON.stringify(params.authVariant)} is refused for ${m} (a, or b for FindFiles only)`;
      const extra = Object.keys(params).filter(
        (k) => !["action", "authMethod", "authRoot", "authVariant"].includes(k),
      );
      if (extra.length)
        return `authProbe takes authMethod, authRoot and authVariant only (${extra.join(", ")} refused)`;
    }
    if (action === "loadContainer" && !/\.conf$/i.test(S(params.path)))
      return "loadContainer loads the vanilla .conf only in S-F";
  }
  if (step === "sf-26-u36-shortcuts-page-owner")
    return "no NET call in sf-26 while the Options dialog may be open";
  return null;
}

/** Why an lsp-probe invocation is refused, or null. */
export function lspRefusal(port: number, netPort: number): string | null {
  if (port === netPort) return `lsp-probe refused: port ${port} is the NET API port`;
  return null;
}

/** Why a WM_CLOSE is refused, or null (DEC-044, DEC-045). */
export function closeRefusal(launch: Phase, topLevel: readonly WindowInfo[]): string | null {
  if (launch !== 2) return "launch 1 is closed by the owner's hand: no WM_CLOSE";
  if (topLevel.length !== 1)
    return `the pid has ${topLevel.length} top-level windows: one WM_CLOSE only when the main window is the only one (DEC-045)`;
  return null;
}

/** Top-level (unowned) windows of the pid. */
export function topLevelOf(windows: readonly WindowInfo[], pid: number | null): WindowInfo[] {
  return windows.filter((w) => (pid === null || w.pid === pid) && w.owner === 0);
}

/** Why a run-folder ini path is refused (the artifacts folder only), or null. */
export function iniPathRefusal(path: string, artifactsRoot: string): string | null {
  return outsideArtifacts(resolve(path), artifactsRoot);
}

/** The prompt text a walker file holds: every name/text/value string, deduplicated. */
export function promptText(walkJson: string | null): string | null {
  if (walkJson === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(walkJson);
  } catch {
    return null;
  }
  const out: string[] = [];
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object") {
      for (const [k, val] of Object.entries(x)) {
        if (["name", "text", "value"].includes(k) && typeof val === "string" && val.trim()) {
          if (!out.includes(val.trim())) out.push(val.trim());
        } else visit(val);
      }
    }
  };
  visit(v);
  return out.length ? out.join(" | ") : null;
}

/** Whether a menus result holds the exact label under the title (sf-14's condition). */
export function menuHasLabel(json: unknown, title: string, label: string): boolean {
  const menus = field(json, "menus");
  if (!Array.isArray(menus)) return false;
  return menus.some(
    (m) =>
      field(m, "title") === title &&
      Array.isArray(field(m, "items")) &&
      (field(m, "items") as unknown[]).some((i) => field(i, "name") === label),
  );
}

/** Key names from ini-edit read-keys stdout (`[section] key=value`), as `section\key`. */
export function keyNamesOf(stdout: string): string[] {
  const out: string[] = [];
  for (const l of stdout.split(/\r?\n/)) {
    const m = /^\[(.*)\] ([^=\s]+)/.exec(l);
    if (m) out.push(`${m[1]}\\${m[2]}`);
  }
  return out;
}

/**
 * Is a `section\key` name from keyNamesOf a shortcut row? The rows live under `[Workbench]` as
 * `PropertyGrid\unnamed\<Module>%3E<Action>`, so the name is `Workbench\PropertyGrid\unnamed\...`;
 * sitting S-F's sf-p3 and sf-p5 compared the whole name with the bare prefix and counted 0 rows
 * while the launch-2 ini held 373 (found at the Phase 2 exit gate, DEC-047).
 */
export function isPropertyGridRow(name: string): boolean {
  return name.startsWith(PROPERTY_GRID_PREFIX) || name.includes(`\\${PROPERTY_GRID_PREFIX}`);
}

/** The menus tool's --title: a regex matching exactly this title. */
export function exactTitleRegex(title: string): string {
  return `^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

/**
 * The repo's scraped API index (e12-api-index.ts: `<repo>/data/api/<API_FILES>`). sf-p2 read
 * `<repo>/data` before and found "0 index files" (S-F run 2026-10-09T04-09-47-166Z).
 */
export const API_INDEX_DIR = join(REPO_ROOT, "data", "api");

/**
 * The static .dlg consumer scan (sf-p2): the classes of the index files whose entry mentions
 * DialogueResource anywhere (a parent, a method signature, a member type). `files` counts the
 * index files read.
 */
export function dlgConsumersIn(dir: string): { classes: string[]; files: number } {
  const classes = new Set<string>();
  let files = 0;
  for (const f of API_FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf-8");
    files++;
    if (!text.includes("DialogueResource")) continue;
    const entries = JSON.parse(text) as unknown;
    for (const e of Array.isArray(entries) ? entries : []) {
      const name = field(e, "name");
      if (typeof name === "string" && JSON.stringify(e).includes("DialogueResource"))
        classes.add(name);
    }
  }
  return { classes: [...classes].sort(), files };
}

/**
 * A window that belongs to a menu popup: the Qt popup class, or the untitled Windows drop-shadow
 * helper (class SysShadow) that comes with it (S-F run 2026-10-09T04-09-47-166Z).
 */
export function isMenuPopupPart(w: { className: string; title?: string }): boolean {
  if (/menu|popup/i.test(w.className)) return true;
  return w.className === "SysShadow" && !w.title;
}

/** The STOP text for a menus tool exit: its reason and the new windows it counted, by name. */
export function menusStopText(code: number | null, json: unknown, detail: string): string {
  const reason = field(json, "reason");
  const nw = field(json, "newWindows");
  const named = Array.isArray(nw)
    ? nw
        .map(
          (w) =>
            `className=${String(field(w, "className"))} title="${String(field(w, "title") ?? "")}" owned=${String(field(w, "owned"))}`,
        )
        .join(" | ")
    : "";
  return `menus tool exit ${code}: ${typeof reason === "string" ? reason : detail}${named ? ` [new windows: ${named}]` : ""}`;
}

/** How many menus a menus result opened (`opened` a count or a list; else the menus marked opened). */
export function menusOpened(json: unknown): number {
  const o = field(json, "opened");
  if (typeof o === "number") return o;
  if (Array.isArray(o)) return o.length;
  const menus = field(json, "menus");
  return Array.isArray(menus) ? menus.filter((m) => field(m, "opened") === true).length : 0;
}

function runJson<T>(deps: Pick<SfDeps, "readRunFile">, name: string): T | null {
  const text = deps.readRunFile(name);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function priorData(ctx: Pick<SfContext, "deps">, id: string): Record<string, unknown> | null {
  return runJson<{ data?: Record<string, unknown> }>(ctx.deps, `${id}.json`)?.data ?? null;
}

function priorStatus(ctx: Pick<SfContext, "deps">, id: string): string | null {
  return runJson<{ status?: string }>(ctx.deps, `${id}.json`)?.status ?? null;
}

function nextStep(steps: StepDef[], id: string): string | null {
  const i = steps.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < steps.length ? steps[i + 1].id : null;
}

/** What this run folder knows of `pid` (S-E's knownPid with S-F's gate files). */
export function knownPid(
  deps: Pick<SfDeps, "listRunFiles" | "readRunFile">,
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
    "sf-00-gate.json",
  );
  if (gate?.status === "pass" && gate.data?.pid === pid && gate.data.created === created)
    known = true;
  return known ? "known" : "new";
}

// ── Steps ────────────────────────────────────────────────────────────────────

const AUTH_KILL = `a window titled "${AUTH_TITLE}": HANDOFF (exit 5), nothing sent to it; auth-<step>.json written; the main session reads it with the passive walker into auth-<step>-walk.json; the owner presses the step's ruled button by hand and says which; resume with --only <next step> --owner-clicked <button>. Any other dialog or a disabled window: STOP. No answer within the call's timeout: STOP (the child is left running)`;

const u27 = [
  "P-U27",
  "P-SC-script-authorization-persistence",
  E("plugins-netapi-cli-L464"),
  E("plugins-netapi-cli-L468"),
];

/** An authorization step: one detached authProbe (or other probe) call; a prompt is the handoff. */
function authStep(o: {
  id: string;
  launch: Phase;
  title: string;
  spec: CallSpec;
  answers: string[];
  expected: string;
  outline?: string[];
  verdict(r: RawCallResult, ctx: SfContext): string;
}): StepDef {
  return {
    id: o.id,
    launch: o.launch,
    title: `${o.title} (detached; ruled button ${ruledButton(o.id)})`,
    risk: "read-only",
    answers: o.answers,
    timeout_ms: detachedMs(o.spec.timeoutMs),
    expected: o.expected,
    kill_criterion: AUTH_KILL,
    side_effects: [],
    rollback: "none needed",
    outline: [
      `a prompt: the owner presses ${ruledButton(o.id)}; the resume records the button, the prompt text and the late answer`,
      ...(o.outline ?? []),
    ],
    ruled: ruledButton(o.id),
    plan: () => [net(o.id, o.answers, o.spec, { detached: true })],
    run: async (ctx) => {
      const r = await ctx.detached(o.spec, o.id);
      const st = probeStatus(r.response);
      const f = probeFacts(r.response);
      return {
        status: "observed",
        summary: `answered with no prompt: ${st ?? r.error} returned ${f.returned ?? "?"} count ${f.count ?? "?"}; ${o.verdict(r, ctx)}${ctx.state.yesToAll ? " (Yes to All was clicked earlier in this run)" : ""}`,
        data: {
          prompted: false,
          facts: f,
          call: summarizeCall(r),
          yesToAllEarlier: ctx.state.yesToAll,
        },
      };
    },
  };
}

function gateStep(id: string, launch: Phase): StepDef {
  return {
    id,
    launch,
    title:
      "Gate: Script Debug Mode off in the forced ini; the lease's pid is the Workbench and holds the port; ScriptsCompiled; GetLoadedProjects the sandbox only; the read-only pack (ECEN_ProbeAuth.c included) present and no mutating pack; ECEN_Probe info isSandbox true",
    risk: "read-only",
    answers: [],
    timeout_ms:
      2 * TIMEOUTS.ready +
      TIMEOUTS.cheap +
      TIMEOUTS.bohemia +
      TIMEOUTS.probe +
      3 * HELPER.process +
      3 * HELPER.windows,
    expected: "as S-E se-00 with the read-only pack only",
    kill_criterion: `"Undefined API func" from ECEN_Probe: STOP; ECEN_ProbeMut files present: STOP; isSandbox false or another addon: ABORT; ${AUTH_KILL}`,
    side_effects: [],
    rollback: "none needed",
    outline: ["the window baseline; the main window recorded"],
    plan: () => [
      net(id, [], {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
        note: "repeated every 5 s until ScriptsCompiled",
      }),
      net(id, [], { apiFunc: "GetLoadedProjects", params: {}, timeoutMs: TIMEOUTS.bohemia }),
      net(id, [], probe("info", { page: 0 }, TIMEOUTS.probe, "read-only pack compile gate")),
    ],
    run: async (ctx) => {
      const out = await runGate(ctx);
      if (id === "sf-00-gate") recordLaunch1(ctx, out);
      return out;
    },
  };
}

/**
 * The launch-1 pid record: written by the first passing sf-00-gate of the run folder and never
 * again. sf-00-gate.json is rewritten by every invocation's gate (the engine's step 0), so it
 * holds the CURRENT launch's pid; sf-20's "new process" check reads this file instead.
 */
export const GATE_LAUNCH1 = "gate-launch1.json";

function recordLaunch1(ctx: SfContext, out: StepOutcome): void {
  if (ctx.deps.readRunFile(GATE_LAUNCH1) !== null) return;
  // A launch-2 gate already ran in this run folder: the current pid is not launch 1's.
  if (ctx.deps.readRunFile("sf-20-gate.json") !== null) return;
  const d = (out.data ?? {}) as { pid?: number; created?: number | null };
  if (out.status !== "pass" || typeof d.pid !== "number") return;
  ctx.deps.writeArtifact(GATE_LAUNCH1, {
    session: SESSION,
    step: "sf-00-gate",
    pid: d.pid,
    created: d.created ?? null,
    at: new Date(ctx.deps.now()).toISOString(),
  });
}

const iniRecord = (n: string): string => `${n}.record.json`;

/** The run folder in a plan written before the sitting (inside the artifacts folder). */
const PLAN_RUN = "<artifacts>/sessions/S-F/<run>";

/** An ini-edit plan action (scripts/live/ini-edit.ts; the dry-run kind of sf-coder-harness). */
function iniAction(
  step: string,
  command: "drop-section" | "set" | "read-keys",
  inFile: string,
  outFile?: string,
  keys?: string[],
): PlanAction {
  return {
    kind: "ini-edit",
    step,
    command,
    in:
      inFile === "<ini-in>" ? "<artifacts>/<scrubbed scratch-ini export>" : `${PLAN_RUN}/${inFile}`,
    ...(outFile ? { out: `${PLAN_RUN}/${outFile}` } : {}),
    artifacts: "<artifacts>",
    ...(keys ? { setKeys: keys } : {}),
    workbenchRunning: false,
  };
}

/** A uia-menu plan action (tools/uia/menus.ts; the dry-run kind of sf-coder-harness). */
function menuAction(step: string, allowForeground: boolean): PlanAction {
  return {
    kind: "uia-menu",
    step,
    target: {
      window: {
        className: "<main window class, read at run time>",
        title: "<exact main window title, escaped>",
      },
    } as unknown as PlanAction["target"],
    pid: LANE_RECORDED_PID,
    menus: [...MENU_TITLES],
    depth: 1,
    calls: ["Expand", "Collapse"],
    allowForeground,
    timeoutMs: TIMEOUTS.menus,
  };
}

/** The LSP methods lsp-probe.ts sends per plan (its header). */
export const LSP_METHODS: Readonly<Record<"session" | "second-client", string[]>> = {
  session: [
    "initialize",
    "initialized",
    "textDocument/didOpen",
    "textDocument/diagnostic",
    "textDocument/hover",
    "textDocument/completion",
  ],
  "second-client": ["initialize"],
};

/** An lsp plan action (scripts/live/lsp-probe.ts; the dry-run kind of sf-coder-harness). */
function lspAction(step: string, plan: "session" | "second-client"): PlanAction {
  return {
    kind: "lsp",
    step,
    host: "127.0.0.1",
    port: LSP_PORT,
    netPort: DEFAULT_PORT,
    plan,
    methods: LSP_METHODS[plan],
  };
}

export function buildSteps(): StepDef[] {
  const steps: StepDef[] = [];
  steps.push(gateStep("sf-00-gate", 1));

  // ── Offline 0 (before launch 1) ──────────────────────────────────────────
  steps.push({
    id: "sf-p2-dlg-consumers-static",
    launch: "offline-0",
    title:
      "Static .dlg consumer scan: class names that name DialogueResource in the repo's scraped API index (no paths)",
    risk: "read-only",
    answers: [],
    touches: ["P-U23", E("script-string-dialogue-L438")],
    timeout_ms: 60_000,
    expected: "a count and a class list",
    kill_criterion: "none (a read of the repo)",
    side_effects: [],
    rollback: "none needed",
    outline: ["offline; no Workbench may run"],
    plan: () => [],
    run: async (ctx) => {
      const r = ctx.deps.dlgConsumers();
      return {
        status: "observed",
        summary: `${r.classes.length} class(es) name DialogueResource in ${r.files} index file(s): ${r.classes.join(", ") || "none"}`,
        data: r,
      };
    },
  });
  steps.push({
    id: "sf-p1-ini-launch1",
    launch: "offline-0",
    title: `Launch-1 scratch ini: ini-edit drop-section --prefix "${PROPERTY_GRID_PREFIX}" on the freshly scrubbed export (--ini-in) into the run folder's ${INI_LAUNCH1}`,
    risk: "mutating",
    answers: [],
    touches: ["P-U36", "P-U22"],
    timeout_ms: TIMEOUTS.tool,
    expected: "the removed count recorded (about 361 rows); the record written",
    kill_criterion: "an ini path outside the artifacts folder: STOP; the tool failing: STOP",
    side_effects: [`${INI_LAUNCH1} and its record in the run folder (the artifacts folder only)`],
    rollback: "none needed (artifacts only)",
    outline: [
      `ini-edit drop-section --prefix "${PROPERTY_GRID_PREFIX}" --in <ini-in> --out <run>/${INI_LAUNCH1} --record <run>/${iniRecord(INI_LAUNCH1)}`,
    ],
    plan: () => [iniAction("sf-p1-ini-launch1", "drop-section", "<ini-in>", INI_LAUNCH1)],
    run: async (ctx) => {
      if (!ctx.opts.iniIn)
        throw new StopSession(
          "kill",
          "sf-p1 needs --ini-in <the freshly scrubbed scratch-ini export>",
        );
      const out = join(ctx.opts.runDir, INI_LAUNCH1);
      const r = await ctx.tool(
        "ini-edit",
        [
          "drop-section",
          "--really",
          "--prefix",
          PROPERTY_GRID_PREFIX,
          "--in",
          ctx.opts.iniIn,
          "--out",
          out,
          "--artifacts",
          ctx.opts.artifactsRoot ?? ctx.opts.runDir,
          "--record",
          join(ctx.opts.runDir, iniRecord(INI_LAUNCH1)),
        ],
        TIMEOUTS.tool,
      );
      if (r.code !== 0) throw new StopSession("kill", `ini-edit drop-section failed: ${r.detail}`);
      const removed = field(field(r.json, "drop"), "count");
      return {
        status: "pass",
        summary: `${INI_LAUNCH1} written; ${String(removed ?? "?")} row(s) removed`,
        data: { ini: INI_LAUNCH1, result: r.json },
      };
    },
  });

  // ── Launch 1: read-only ──────────────────────────────────────────────────
  steps.push({
    id: "sf-01-port-5776-closed",
    launch: 1,
    title: `Control: port ${LSP_PORT} has no listener (the listener list only, no connect)`,
    risk: "read-only",
    answers: [],
    touches: ["P-U22"],
    timeout_ms: HELPER.process,
    expected: `${LSP_PORT} not listening`,
    kill_criterion: "none (a listener read)",
    side_effects: [],
    rollback: "none needed",
    outline: [`the listener list of port ${LSP_PORT}`],
    plan: () => [],
    run: async (ctx) => {
      const owners = ctx.deps.portOwners(LSP_PORT);
      return {
        status: owners.length ? "fail" : "pass",
        summary: owners.length
          ? `port ${LSP_PORT} is held by pid ${owners.join(", ")}`
          : `port ${LSP_PORT} has no listener`,
        data: { owners },
      };
    },
  });
  steps.push(
    authStep({
      id: "sf-02-u27-findfiles",
      launch: 1,
      title: "First FindFiles: authProbe FindFiles variant a on the sandbox",
      spec: authProbe("FindFiles", "a"),
      answers: u27,
      expected: "a prompt naming FileIO.FindFiles (HANDOFF, Yes), or none (a finding)",
      verdict: () => "FindFiles raised no prompt on its first call",
    }),
  );
  steps.push(
    authStep({
      id: "sf-03-u27-findfiles-again",
      launch: 1,
      title: "The same FindFiles (variant a) again",
      spec: authProbe("FindFiles", "a"),
      answers: ["P-U27"],
      expected: "no prompt (the Yes holds for the process); a prompt is the HANDOFF (Yes)",
      verdict: (_r, ctx) => {
        const p = pressesOf(ctx.state.presses, "sf-02-u27-findfiles");
        if (!p) return "no prompt now, and sf-02 recorded no prompt";
        const last = p[p.length - 1];
        return last === "No" || last === "NoToAll"
          ? `no second prompt after ${last} on sf-02: the refusal held within the process (see returned and count)`
          : `the ${last} of sf-02 held within the process`;
      },
    }),
  );
  steps.push(
    authStep({
      id: "sf-04-u27-fileexists",
      launch: 1,
      title: `FileExists: authProbe FileExists on ${AUTH_FILE}; the owner's one deliberate No`,
      spec: authProbe("FileExists"),
      answers: ["P-U27"],
      expected:
        "a prompt naming FileIO.FileExists: the owner presses No; the late answer records what a refused call returns",
      verdict: (_r, ctx) =>
        ctx.state.presses.length
          ? "FileExists raised no prompt (after earlier presses in this process: not a fresh-process answer)"
          : "FileExists raised no prompt in a process with no earlier press",
    }),
  );
  steps.push(
    authStep({
      id: "sf-05-u27-findfiles-line-b",
      launch: 1,
      title: "FindFiles from a second script line: authProbe FindFiles variant b",
      spec: authProbe("FindFiles", "b"),
      answers: ["P-U27"],
      expected: "no prompt (the Yes is per method) or a prompt (per script line: HANDOFF, Yes)",
      verdict: (_r, ctx) => {
        const p = [
          ...(pressesOf(ctx.state.presses, "sf-02-u27-findfiles") ?? []),
          ...(pressesOf(ctx.state.presses, "sf-03-u27-findfiles-again") ?? []),
        ];
        if (!p.length)
          return "the second FindFiles call site raised no prompt; no FindFiles press recorded before it";
        const last = p[p.length - 1];
        return last === "YesToAll"
          ? "the second FindFiles call site raised no prompt after Yes to All: its scope covers another call site"
          : last === "Yes"
            ? "the second FindFiles call site raised no prompt after Yes: the Yes is per method, not per line"
            : `the second FindFiles call site raised no prompt after ${last}: see returned and count`;
      },
    }),
  );
  steps.push(
    authStep({
      id: "sf-07-u27-loadcontainer",
      launch: 1,
      title: "LoadContainer: ECEN_Probe loadContainer on the vanilla .conf",
      spec: probe("loadContainer", { path: SD_VANILLA.conf, depth: 1, page: 0 }, TIMEOUTS.probe),
      answers: ["P-U27"],
      expected: "a prompt (HANDOFF, Yes) or none",
      verdict: () => "LoadContainer raised no prompt",
    }),
  );
  steps.push(
    authStep({
      id: "sf-08-u27-compilescript",
      launch: 1,
      title: 'CompileScript: ECEN_Probe evalCompile on the trivial text (returns "ok")',
      spec: probe("evalCompile", { text: EVAL_OK }, TIMEOUTS.probe),
      answers: ["P-U27"],
      expected: "a prompt (HANDOFF, Yes) or none",
      verdict: () => "the compile raised no prompt",
    }),
  );
  steps.push(
    authStep({
      id: "sf-09-u27-openfile-yes-to-all",
      launch: 1,
      title: `OpenFile READ then Close: authProbe OpenFile on ${AUTH_FILE} (FileExists runs first); the owner's Yes to All`,
      spec: authProbe("OpenFile"),
      answers: ["P-U27"],
      expected:
        "a prompt naming FileIO.OpenFile: the owner presses Yes to All (every prompt of the call recorded as a list; a FileExists prompt first shows the No of sf-04 was not remembered); returned false with no OpenFile prompt shows what the No did to a later call",
      verdict: (r, ctx) => {
        const fe = pressesOf(ctx.state.presses, "sf-04-u27-fileexists");
        const granted = ctx.state.presses.some((e) =>
          e.buttons.some((b) => b === "Yes" || b === "YesToAll"),
        );
        if (probeFacts(r.response).returned === "false")
          return fe && fe.includes("No")
            ? "returned false with no prompt: FileExists answered false (the No of sf-04 carried to a later call?); OpenFile unobserved"
            : `returned false with no prompt${fe ? ` after ${fe.join(",")} on sf-04` : ""}; OpenFile unobserved`;
        return granted
          ? "OpenFile raised no prompt, but a Yes was given earlier in this process: VOID as a per-method answer"
          : "OpenFile raised no prompt with no earlier grant in this process";
      },
    }),
  );
  steps.push(
    authStep({
      id: "sf-10-u27-searchresources-after-yta",
      launch: 1,
      title: "Scope of Yes to All: authProbe SearchResources (never called before)",
      spec: authProbe("SearchResources"),
      answers: ["P-U27"],
      expected: "no prompt: Yes to All covers other methods; a prompt: it does not (HANDOFF, Yes)",
      verdict: (_r, ctx) =>
        ctx.state.yesToAll
          ? "no prompt after Yes to All: it covers other methods"
          : "no prompt (Yes to All not recorded in this run)",
    }),
  );

  // ── Launch 1: reversible ─────────────────────────────────────────────────
  const menusArgs = (ctx: SfContext, out: string, foreground: boolean): string[] => [
    "--pid",
    String(ctx.state.wbPid),
    "--class",
    "<main window class>",
    "--title",
    "<main window title>",
    "--menus",
    MENU_TITLES.join(","),
    "--depth",
    "1",
    ...(foreground ? ["--allow-foreground"] : []),
    "--out",
    out,
    "--label",
    foreground ? "sf-13" : "sf-12",
    "--id",
    ctx.opts.laneId,
    "--really",
  ];
  const runMenus = async (
    ctx: SfContext,
    label: string,
    foreground: boolean,
  ): Promise<StepOutcome> => {
    const before = await ctx.noAuthWindow(`before menus (${label})`);
    const main =
      before.find((w) => w.hwnd === ctx.state.mainHwnd) ?? mainWindowOf(before, ctx.state.wbPid!);
    if (!main)
      throw new StopSession("kill", "no main window recorded: the menus tool has no target");
    const out = join(ctx.opts.runDir, `menus-${label}.json`);
    const args = menusArgs(ctx, out, foreground).map((a) =>
      a === "<main window class>"
        ? main.className
        : a === "<main window title>"
          ? exactTitleRegex(main.title)
          : a,
    );
    const r = await ctx.tool("menus", args, TIMEOUTS.menus);
    const after = await ctx.ourWindows();
    const ch = windowChanges(ctx.state.baselineWindows, after, ctx.state.wbPid!);
    const left = ch.added.filter((w) => !isMenuPopupPart(w));
    if (left.length || ch.disabled.length)
      throw new StopSession(
        "kill",
        `after the menus tool: ${[...left, ...ch.disabled].map((w) => `${w.className} "${w.title}"`).join(" | ")}: not a popup; nothing is clicked`,
      );
    const popups = ch.added.filter((w) => /menu|popup/i.test(w.className));
    if (popups.length)
      throw new OwnerHand(
        `a menu popup is left open after the menus tool (${popups.map((w) => w.className).join(", ")}): owner, press Esc, then resume with --only ${ctx.step} --owner-done`,
      );
    const leftOpen = field(r.json, "leftOpen");
    // Exit 6 with a popup left open is the owner's Esc; exit 6 without one (a disabled main
    // window after an Expand) and exit 3 (refused-foreground) are STOPs below.
    if (Array.isArray(leftOpen) && leftOpen.length)
      throw new OwnerHand(
        `the menus tool left a popup open: owner, press Esc, then resume with --only ${ctx.step} --owner-done`,
      );
    if (r.code !== 0) throw new StopSession("kill", menusStopText(r.code, r.json, r.detail));
    const opened = menusOpened(r.json);
    return {
      status: "observed",
      summary: `${opened} of ${MENU_TITLES.length} menus opened${foreground ? " (foreground)" : " (background)"}; Qt Introspection label ${menuHasLabel(r.json, QT_INTROSPECTION_PATH[0], QT_INTROSPECTION_PATH[1]) ? "read" : "not read"}; Dialogue Editor ${menuHasLabel(r.json, "Editors", "Dialogue Editor") ? "listed" : "not listed"}`,
      data: {
        menus: r.json,
        opened,
        qtLabel: menuHasLabel(r.json, QT_INTROSPECTION_PATH[0], QT_INTROSPECTION_PATH[1]),
        dialogueEditor: menuHasLabel(r.json, "Editors", "Dialogue Editor"),
      },
    };
  };
  const menuAnswers = ["P-U21", E("gui-census-feasibility-L668"), E("gui-census-feasibility-L669")];
  const menuTouches = [
    E("resource-manager-L663"),
    E("gui-census-feasibility-L685"),
    E("gui-census-feasibility-L686"),
    E("script-string-dialogue-L433"),
    "P-U23",
    "P-U31",
  ];
  steps.push({
    id: "sf-12-u21-menus-background",
    launch: 1,
    title: `Menus in the background: tools/uia/menus.ts --menus ${MENU_TITLES.join(",")} --depth 1 (expand and collapse only; Workbench not in front)`,
    risk: "reversible",
    answers: menuAnswers,
    touches: menuTouches,
    timeout_ms: TIMEOUTS.menus + 2 * HELPER.windows,
    expected: "per title: opened or not, its tree (enabled flags), collapsed after",
    kill_criterion: `any non-popup window after the tool: STOP; a popup left open: OWNER HAND (Esc); ${AUTH_KILL}`,
    side_effects: ["menus expanded and collapsed"],
    rollback: "collapsed by the tool",
    outline: [
      "tools/uia/menus.ts --pid --class --title <regex> --menus --depth 1 --out <run>/menus-sf-12.json --label sf-12 --id <lane> --really",
      "no menus tool while the authorization window is up",
    ],
    plan: () => [menuAction("sf-12-u21-menus-background", false)],
    run: (ctx) => runMenus(ctx, "sf-12", false),
  });
  steps.push({
    id: "sf-13-u21-menus-foreground",
    launch: 1,
    title:
      "Menus in the foreground: the owner brings the Workbench to the front (OWNER HAND), then the menus tool with --allow-foreground",
    risk: "reversible",
    answers: menuAnswers,
    touches: menuTouches,
    timeout_ms: TIMEOUTS.menus + 2 * HELPER.windows,
    expected: "per title: opened or not with Workbench in front",
    kill_criterion: `as sf-12; ${AUTH_KILL}`,
    side_effects: ["menus expanded and collapsed"],
    rollback: "collapsed by the tool",
    outline: ["runs only when sf-12 opened no menu"],
    ownerHand: "bring the Workbench main window to the front by hand, touch nothing else",
    skipWhen: { condition: "sf-12 opened a menu", carried_to: "nothing: sf-12 answered" },
    skip: (ctx) => {
      const d = priorData(ctx, "sf-12-u21-menus-background");
      return d && Number(d.opened) > 0 ? SKIP_REASON.menusOpened : null;
    },
    plan: () => [menuAction("sf-13-u21-menus-foreground", true)],
    run: (ctx) => runMenus(ctx, "sf-13", true),
  });
  const qtSpec = probe(
    "executeAction",
    { moduleName: QT_MODULE, menuPath: [...QT_INTROSPECTION_PATH] },
    TIMEOUTS.gui,
    "U31: open the Qt Introspection Tool",
  );
  const qtLabelRead = (ctx: Pick<SfContext, "deps">): boolean =>
    ["sf-12-u21-menus-background", "sf-13-u21-menus-foreground"].some(
      (id) => priorData(ctx, id)?.qtLabel === true,
    );
  steps.push({
    id: "sf-14-u31-qt-introspection",
    launch: 1,
    title: `Qt Introspection: ECEN_Probe executeAction ${QT_MODULE} ${QT_INTROSPECTION_PATH.join(" > ")} (detached), then a passive walk of the new window`,
    risk: "reversible",
    answers: ["P-U31", E("gui-census-feasibility-L685")],
    touches: [E("script-string-dialogue-L421")],
    timeout_ms: detachedMs(TIMEOUTS.gui),
    expected: "executed true and a new tool window (walked by the main session)",
    kill_criterion: `a modal: STOP; ${AUTH_KILL}`,
    side_effects: ["the Qt Introspection window open"],
    rollback: "the owner's close at the end of launch 1",
    outline: ["runs only when sf-12 (or sf-13) read the exact label under Utilities"],
    skipWhen: { condition: "sf-12 did not read the exact label", carried_to: "Phase 4" },
    skip: (ctx) => (qtLabelRead(ctx) ? null : SKIP_REASON.noQtLabel),
    plan: () => [
      net("sf-14-u31-qt-introspection", ["P-U31"], qtSpec, { detached: true }),
      {
        kind: "execute-action",
        target: { path: [...QT_INTROSPECTION_PATH], module: QT_MODULE },
        step: "sf-14-u31-qt-introspection",
        probes: ["P-U31"],
        via: "ECEN_Probe executeAction",
      },
      walkRead("sf-14-u31-qt-introspection", ["P-U31"], "Qt Introspection"),
    ],
    run: async (ctx) => {
      const r = await ctx.detached(qtSpec, "sf-14", {
        expected: (w) => titleNames(w, "Introspection") || titleNames(w, "Qt"),
      });
      const f = probeFacts(r.response);
      const wins = await ctx.ourWindows();
      return {
        status: "observed",
        summary: `executeAction ${probeStatus(r.response) ?? r.error}, executed ${f.executed ?? f.result ?? "?"}; ${wins.length} window(s); the main session walks the new window`,
        data: { facts: f, call: summarizeCall(r), windows: wins },
      };
    },
  });
  steps.push({
    id: "sf-15-u21-context-menu-owner",
    launch: 1,
    title:
      "The owner's context menu: OWNER HAND (right-click in the Resource Browser, then the main session walks it with --allow-owned; the owner presses Esc, nothing chosen)",
    risk: "reversible",
    answers: [E("script-string-dialogue-L434")],
    touches: ["P-U21"],
    timeout_ms: 2 * HELPER.windows,
    expected: "the walk file holds the context menu's tree (new-file list)",
    kill_criterion: `the menu still open on resume: STOP; ${AUTH_KILL}`,
    side_effects: ["a context menu opened and closed by the owner"],
    rollback: "the owner's Esc",
    outline: ["phase 1: exit 5 owner-hand; phase 2 (--owner-done): the window list shows no popup"],
    ownerHand:
      "right-click in the Resource Browser's file pane; the main session walks the context menu (walk.ts --allow-owned, label sf-15-context); then press Esc; choose nothing",
    plan: () => [
      walkRead(
        "sf-15-u21-context-menu-owner",
        [E("script-string-dialogue-L434")],
        "context menu",
        true,
      ),
    ],
    run: async (ctx) => {
      const wins = await ctx.noAuthWindow("sf-15 resume");
      const popups = windowChanges(ctx.state.baselineWindows, wins, ctx.state.wbPid!).added.filter(
        (w) => /menu|popup/i.test(w.className),
      );
      if (popups.length)
        throw new StopSession(
          "kill",
          "the context menu is still open: the owner presses Esc first",
        );
      const walk = ctx.deps.readRunFile("sf-15-context-walk.json");
      return {
        status: "observed",
        summary: walk
          ? "the context menu was walked (sf-15-context-walk.json)"
          : "no walk file sf-15-context-walk.json in the run folder",
        data: { walked: walk !== null },
      };
    },
  });
  const editorAccept = (w: WindowInfo): boolean =>
    titleNames(w, "Script Editor") ||
    titleNames(w, "String Editor") ||
    titleNames(w, "Localization");
  const bring = (m: string): CallSpec => ({
    apiFunc: "BringModuleWindowToFront",
    params: { ModuleName: m },
    timeoutMs: TIMEOUTS.gui,
    note: `ModuleName ${m}`,
  });
  steps.push({
    id: "sf-16-l421-editor-windows",
    launch: 1,
    title:
      "Script and String editor windows: native BringModuleWindowToFront ScriptEditor, LocalizationEditor (detached), a walk after each",
    risk: "reversible",
    answers: [E("script-string-dialogue-L421")],
    touches: [E("resource-manager-L663")],
    timeout_ms: 2 * detachedMs(TIMEOUTS.gui),
    expected: "each window raised; the main session walks it",
    kill_criterion: `a modal: STOP; ${AUTH_KILL}`,
    side_effects: ["two editor windows raised"],
    rollback: "the owner's close at the end of launch 1",
    outline: [
      "the main session walks each new window (labels sf-16-ScriptEditor, sf-16-LocalizationEditor)",
    ],
    plan: () => [
      net("sf-16-l421-editor-windows", [], bring("ScriptEditor"), { detached: true }),
      walkRead("sf-16-l421-editor-windows", [], "Script Editor"),
      net("sf-16-l421-editor-windows", [], bring("LocalizationEditor"), { detached: true }),
      walkRead("sf-16-l421-editor-windows", [], "String Editor"),
    ],
    run: async (ctx) => {
      const rows: Array<Record<string, unknown>> = [];
      for (const m of ["ScriptEditor", "LocalizationEditor"]) {
        const r = await ctx.detached(bring(m), `sf-16-${m}`, { expected: editorAccept });
        rows.push({
          module: m,
          ...summarizeCall(r),
          windows: (await ctx.ourWindows()).map((w) => w.title),
        });
      }
      return {
        status: "observed",
        summary: rows
          .map((x) => `${String(x.module)} ${x.ok ? "answered" : String(x.error)}`)
          .join("; "),
        data: { rows },
      };
    },
  });
  steps.push({
    id: "sf-17-l410-open-st",
    launch: 1,
    title: "Open a vanilla .st: native OpenResource on --st-path (detached; never a .ent)",
    risk: "reversible",
    answers: [E("script-string-dialogue-L410")],
    timeout_ms: detachedMs(TIMEOUTS.gui),
    expected: "the String Editor opens the table, or the answer says why not",
    kill_criterion: `a modal: STOP; ${AUTH_KILL}`,
    side_effects: ["the .st open in the String Editor (nothing saved)"],
    rollback: "the owner's close at the end of launch 1 (Don't Save)",
    outline: ["runs only with --st-path"],
    skipWhen: { condition: "--st-path not given", carried_to: "a later sitting with a named .st" },
    preSkip: (o) => (o.stPath ? null : SKIP_REASON.st),
    plan: (p) =>
      p.stPath
        ? [
            net(
              "sf-17-l410-open-st",
              [],
              {
                apiFunc: "OpenResource",
                params: { ResourceName: p.stPath },
                timeoutMs: TIMEOUTS.gui,
              },
              { detached: true },
            ),
          ]
        : [],
    run: async (ctx) => {
      const r = await ctx.detached(
        {
          apiFunc: "OpenResource",
          params: { ResourceName: ctx.opts.stPath! },
          timeoutMs: TIMEOUTS.gui,
        },
        "sf-17",
        { expected: editorAccept },
      );
      return {
        status: "observed",
        summary: `OpenResource ${JSON.stringify(r.ok ? r.response : r.error)}`,
        data: { call: summarizeCall(r) },
      };
    },
  });

  // ── Offline 1 (after the owner closed launch 1) ──────────────────────────
  steps.push({
    id: "sf-p3-ini-after-launch1",
    launch: "offline-1",
    title: `Read the write-back: ini-edit read-keys on ${INI_LAUNCH1} (key names; values only of non-path keys)`,
    risk: "read-only",
    answers: [E("gui-census-feasibility-L692")],
    touches: ["P-U36", "P-SC-script-authorization-persistence"],
    timeout_ms: TIMEOUTS.tool,
    expected: "whether PropertyGrid\\unnamed rows are back; any authorization keys",
    kill_criterion: "the tool failing: STOP",
    side_effects: [],
    rollback: "none needed",
    outline: [
      `ini-edit read-keys --in <run>/${INI_LAUNCH1} --artifacts <run> --record <run>/sf-p3-keys.json`,
    ],
    plan: () => [iniAction("sf-p3-ini-after-launch1", "read-keys", INI_LAUNCH1)],
    run: async (ctx) => {
      const r = await ctx.tool(
        "ini-edit",
        [
          "read-keys",
          "--in",
          join(ctx.opts.runDir, INI_LAUNCH1),
          "--artifacts",
          ctx.opts.artifactsRoot ?? ctx.opts.runDir,
          "--record",
          join(ctx.opts.runDir, "sf-p3-keys.json"),
        ],
        TIMEOUTS.tool,
      );
      if (r.code !== 0) throw new StopSession("kill", `ini-edit read-keys failed: ${r.detail}`);
      const keys = keyNamesOf(r.stdout ?? "");
      const rows = keys.filter(isPropertyGridRow).length;
      const authKeys = keys.filter((k) => /authori[sz]/i.test(k));
      return {
        status: "observed",
        summary: `${rows} PropertyGrid\\unnamed row(s) after launch 1; ${authKeys.length} authorization key(s)${authKeys.length ? `: ${authKeys.join(", ")}` : ""}`,
        data: { propertyGridRows: rows, authKeys, keyCount: keys.length },
      };
    },
  });
  steps.push({
    id: "sf-p4-ini-launch2",
    launch: "offline-1",
    title: `Launch-2 scratch ini: ini-edit set x3 (${LAUNCH2_EDITS.map(launch2EditText).join("; ")}) into ${INI_LAUNCH2}`,
    risk: "mutating",
    answers: [],
    touches: ["P-U22", "P-U20"],
    timeout_ms: TIMEOUTS.tool,
    expected:
      "exactly 3 lines differ: LSP_Enabled=1 and LSP_Port=5776 created in [Workbench]; the struct line ScriptTools\\SCR_ImageSetGenerator in [Resource%20Manager] with its m_iImageWidth token 512 -> 384",
    kill_criterion:
      "any other number of differing lines: STOP; the struct line absent, its token absent, twice, or not 512: STOP; a path outside the artifacts folder: STOP",
    side_effects: [`${INI_LAUNCH2} and its record in the run folder`],
    rollback: "none needed (artifacts only)",
    outline: [
      `ini-edit set --section --key --value --create (x2, LSP_*) and --section --key --token m_iImageWidth --old 512 --value 384 (the preset struct line) --in <run>/${INI_LAUNCH1} --out <run>/${INI_LAUNCH2}`,
    ],
    plan: () => [
      iniAction(
        "sf-p4-ini-launch2",
        "set",
        INI_LAUNCH1,
        INI_LAUNCH2,
        LAUNCH2_EDITS.map((e) => e.key),
      ),
    ],
    run: async (ctx) => {
      const args = [
        "set",
        "--really",
        "--in",
        join(ctx.opts.runDir, INI_LAUNCH1),
        "--out",
        join(ctx.opts.runDir, INI_LAUNCH2),
        "--artifacts",
        ctx.opts.artifactsRoot ?? ctx.opts.runDir,
        "--record",
        join(ctx.opts.runDir, iniRecord(INI_LAUNCH2)),
      ];
      for (const e of LAUNCH2_EDITS)
        args.push(
          "--section",
          e.section,
          "--key",
          e.key,
          "--value",
          e.value,
          ...(e.token !== undefined ? ["--token", e.token, "--old", e.old ?? ""] : []),
          ...(e.create ? ["--create"] : []),
        );
      const r = await ctx.tool("ini-edit", args, TIMEOUTS.tool);
      if (r.code !== 0) throw new StopSession("kill", `ini-edit set failed: ${r.detail}`);
      const sets = field(r.json, "sets");
      const changed = Array.isArray(sets) ? sets.length : -1;
      if (changed !== 3) throw new StopSession("kill", `${changed} line(s) differ, not exactly 3`);
      return {
        status: "pass",
        summary: `${INI_LAUNCH2} written; 3 lines differ`,
        data: { result: r.json },
      };
    },
  });

  // ── Launch 2: read-only ──────────────────────────────────────────────────
  steps.push({
    ...gateStep("sf-20-gate", 2),
    title: "Launch 2: the gate again, and the process is new (not launch 1's pid)",
    run: async (ctx) => {
      const g = runJson<{ pid?: number }>(ctx.deps, GATE_LAUNCH1);
      const out = await runGate(ctx);
      if (typeof g?.pid !== "number")
        throw new StopSession(
          "kill",
          `no launch-1 pid record (${GATE_LAUNCH1}) in the run folder: launch 2 cannot be shown to be a new process`,
        );
      if (g.pid === ctx.state.wbPid)
        throw new StopSession(
          "kill",
          `launch 2 runs under launch 1's pid ${g.pid}: not a new process`,
        );
      return { ...out, summary: `${out.summary}; launch 1 pid ${g.pid}, a new process` };
    },
  });
  steps.push(
    authStep({
      id: "sf-21-u27-restart",
      launch: 2,
      title: "Persistence of Yes: authProbe FindFiles variant a (answered Yes in launch 1)",
      spec: authProbe("FindFiles", "a"),
      answers: ["P-U27", "P-SC-script-authorization-persistence"],
      expected:
        "no prompt: the Yes persisted across the restart; a prompt: nothing persisted (HANDOFF, Yes)",
      verdict: () => "no prompt after the restart: the Yes of launch 1 persisted",
    }),
  );
  steps.push(
    authStep({
      id: "sf-21b-u27-restart-yta",
      launch: 2,
      title: `Persistence of Yes to All: authProbe OpenFile on ${AUTH_FILE} (answered Yes to All in launch 1)`,
      spec: authProbe("OpenFile"),
      answers: ["P-U27", "P-SC-script-authorization-persistence"],
      expected: "no prompt: Yes to All survived the restart; a prompt: it did not (HANDOFF, Yes)",
      outline: ["added to the plan: sf-21 alone cannot tell Yes from Yes to All"],
      verdict: () => "no prompt after the restart: Yes to All survived it",
    }),
  );
  steps.push({
    id: "sf-22-u22-lsp-port",
    launch: 2,
    title: `Is the LSP listening: the listener list of port ${LSP_PORT}`,
    risk: "read-only",
    answers: ["P-U22", E("mcp-inventory-L269")],
    timeout_ms: HELPER.process,
    expected: `${LSP_PORT} listening by the Workbench pid = the ini setting honoured`,
    kill_criterion: "none",
    side_effects: [],
    rollback: "none needed",
    outline: ["no connect"],
    plan: () => [],
    run: async (ctx) => {
      const owners = ctx.deps.portOwners(LSP_PORT);
      const listening = owners.includes(ctx.state.wbPid!);
      return {
        status: "observed",
        summary: listening
          ? `port ${LSP_PORT} listening (pid ${ctx.state.wbPid}): the setting was honoured`
          : `port ${LSP_PORT} ${owners.length ? `held by ${owners.join(", ")}` : "not listening"}: not honoured`,
        data: { owners, listening },
      };
    },
  });
  const presetSpec = probe(
    "pluginAttrs",
    { moduleName: QT_MODULE, className: PRESET_CLASS, page: 0 },
    TIMEOUTS.probe,
  );
  steps.push({
    id: "sf-23-u22-plugin-preset",
    launch: 2,
    title: `Preset honoured: ECEN_Probe pluginAttrs ${QT_MODULE} ${PRESET_CLASS} (detached)`,
    risk: "read-only",
    answers: ["P-U22", E("world-editor-L483"), E("plugins-netapi-cli-L466")],
    timeout_ms: detachedMs(TIMEOUTS.probe),
    expected: `m_iImageWidth ${PRESET_VALUE} = honoured`,
    kill_criterion: AUTH_KILL,
    side_effects: [],
    rollback: "none needed",
    outline: ["pluginAttrs reads; GetPlugin may focus the module window"],
    ruled: "Yes",
    plan: () => [net("sf-23-u22-plugin-preset", ["P-U22"], presetSpec, { detached: true })],
    run: async (ctx) => {
      const r = await ctx.detached(presetSpec, "sf-23");
      const text = JSON.stringify(r.response ?? r.error ?? "");
      const honoured = new RegExp(`m_iImageWidth[^0-9]{0,40}${PRESET_VALUE}\\b`).test(text);
      return {
        status: "observed",
        summary: `m_iImageWidth ${honoured ? PRESET_VALUE : "not 384"}: the preset ${honoured ? "was" : "was not"} honoured`,
        data: { honoured, call: summarizeCall(r) },
      };
    },
  });

  // ── Launch 2: reversible ─────────────────────────────────────────────────
  const lspGate = {
    skipWhen: {
      condition: `sf-22 did not see ${LSP_PORT} listening`,
      carried_to: "Phase 3 (the LSP lane)",
    },
    skip: (ctx: SfContext) =>
      priorData(ctx, "sf-22-u22-lsp-port")?.listening === true ? null : SKIP_REASON.lspNotListening,
  };
  const lsp = async (ctx: SfContext, plan: "session" | "second-client"): Promise<ToolResult> => {
    await ctx.noAuthWindow(`before lsp-probe ${plan}`);
    const netPort = ctx.opts.netPort ?? DEFAULT_PORT;
    const why = lspRefusal(LSP_PORT, netPort);
    if (why) throw new Error(`refused: ${why}`);
    const r = await ctx.tool(
      "lsp-probe",
      [
        "--port",
        String(LSP_PORT),
        "--net-port",
        String(netPort),
        "--plan",
        plan,
        "--timeout-ms",
        "30000",
        // lsp-probe refuses without the 2.0 sandbox folder; the child's env names none
        // (S-F 2026-10-09: exit 2 on sf-24 and sf-25).
        "--sandbox",
        ctx.opts.sandboxDir,
        "--out",
        join(ctx.opts.runDir, `lsp-${plan}.json`),
      ],
      TIMEOUTS.lsp,
    );
    await ctx.modalCheck(`lsp-probe ${plan}`);
    return r;
  };
  steps.push({
    id: "sf-24-u20-lsp-session",
    launch: 2,
    title: `LSP session: scripts/live/lsp-probe.ts --port ${LSP_PORT} --plan session`,
    risk: "reversible",
    answers: ["P-U20", E("script-string-dialogue-L419"), E("mcp-inventory-L378")],
    touches: [E("mcp-inventory-L269")],
    timeout_ms: TIMEOUTS.lsp + 2 * HELPER.windows,
    expected: "initialize answered within 30 s; no new window",
    kill_criterion: `a new window: STOP; ${AUTH_KILL}`,
    side_effects: ["one LSP client session, closed"],
    rollback: "the client disconnects",
    outline: [
      "lsp-probe.ts --port 5776 --net-port <NET port> --plan session --sandbox <sandbox> --out <run>/lsp-session.json; never the NET port",
    ],
    ...lspGate,
    plan: () => [lspAction("sf-24-u20-lsp-session", "session")],
    run: async (ctx) => {
      const r = await lsp(ctx, "session");
      return {
        status: r.code === 0 ? "observed" : "fail",
        summary: `lsp-probe session exit ${r.code}: ${r.detail}`,
        data: { result: r.json },
      };
    },
  });
  steps.push({
    id: "sf-25-u20-coexistence",
    launch: 2,
    title: "Second client, then one NET IsWorkbenchRunning: lsp-probe --plan second-client",
    risk: "reversible",
    answers: ["P-U20"],
    touches: [E("script-string-dialogue-L419")],
    timeout_ms: TIMEOUTS.lsp + plainMs(TIMEOUTS.cheap) + 2 * HELPER.windows,
    expected: "both clients idle at the NET call; the NET call answers",
    kill_criterion: `the NET call unanswered: STOP; ${AUTH_KILL}`,
    side_effects: ["two LSP clients, closed"],
    rollback: "the clients disconnect",
    outline: [
      "--plan second-client; the NET call runs only after the tool returned (one at a time)",
    ],
    ...lspGate,
    plan: () => [
      lspAction("sf-25-u20-coexistence", "second-client"),
      net("sf-25-u20-coexistence", ["P-U20"], {
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      }),
    ],
    run: async (ctx) => {
      const r = await lsp(ctx, "second-client");
      const p = await ctx.call({
        apiFunc: "IsWorkbenchRunning",
        params: {},
        timeoutMs: TIMEOUTS.cheap,
      });
      await ctx.modalCheck("IsWorkbenchRunning");
      return {
        status: "observed",
        summary: `lsp-probe second-client exit ${r.code}; NET ${p.ok ? "answered" : p.error}`,
        data: { lsp: r.json, net: summarizeCall(p) },
      };
    },
  });
  steps.push({
    id: "sf-26-u36-shortcuts-page-owner",
    launch: 2,
    title:
      "Options > Shortcuts: OWNER HAND (the owner opens the page, the main session walks it, the owner presses Cancel); no NET call in this step",
    risk: "reversible",
    answers: ["P-U36"],
    timeout_ms: 2 * HELPER.windows,
    expected: "on resume the Options dialog is closed",
    kill_criterion: `the dialog still up on resume: STOP; any NET call: refused; ${AUTH_KILL}`,
    side_effects: ["the Options dialog opened and cancelled by the owner"],
    rollback: "the owner's Cancel",
    outline: ["runs only when sf-p3 found no PropertyGrid\\unnamed rows"],
    ownerHand:
      "open Options > Shortcuts by hand; the main session walks it (label sf-26-options); then press Cancel",
    skipWhen: {
      condition: "sf-p3 found PropertyGrid\\unnamed rows",
      carried_to: "nothing: launch 1 wrote them",
    },
    skip: (ctx) => {
      const d = priorData(ctx, "sf-p3-ini-after-launch1");
      return d && Number(d.propertyGridRows) > 0 ? SKIP_REASON.rowsPresent : null;
    },
    plan: () => [walkRead("sf-26-u36-shortcuts-page-owner", ["P-U36"], "Options", true)],
    run: async (ctx) => {
      const wins = await ctx.noAuthWindow("sf-26 resume");
      const ch = windowChanges(ctx.state.baselineWindows, wins, ctx.state.wbPid!);
      if (ch.added.some((w) => isDialogLike(w)) || ch.disabled.length)
        throw new StopSession(
          "kill",
          "the Options dialog is still up: the owner presses Cancel first",
        );
      return {
        status: "observed",
        summary: `Options closed; walk file ${ctx.deps.readRunFile("sf-26-options-walk.json") ? "present" : "absent"}`,
        data: {},
      };
    },
  });
  steps.push({
    id: "sf-27-close-test",
    launch: 2,
    title:
      "Close rule: one WM_CLOSE only when the main window is the pid's only top-level window; otherwise OWNER HAND (File > Exit, Don't Save)",
    risk: "reversible",
    answers: [],
    touches: ["P-SD-wmclose-reads-as-crash"],
    timeout_ms: 2 * HELPER.windows + TIMEOUTS.close + 2 * HELPER.process,
    expected: "a graceful exit with no CrashReporter.exe, or the owner's close recorded",
    kill_criterion: "a dialog after the close: HANDOFF, never answered",
    side_effects: ["Workbench ends"],
    rollback: "none; graceful-exit record on a clean WM_CLOSE exit",
    outline: ["WM_CLOSE is not a plan action kind: outlined here only"],
    plan: () => [],
    run: async (ctx) => {
      const pid = ctx.state.wbPid!;
      if (ctx.opts.ownerDone) {
        const gone = ctx.deps.processImage(pid) === null;
        return {
          status: gone ? "observed" : "fail",
          summary: gone
            ? "closed by the owner's hand"
            : `pid ${pid} still runs after the owner's close`,
          data: { by: "owner", crashReporters: ctx.deps.crashReporters() },
        };
      }
      const before = await ctx.ourWindows();
      const top = topLevelOf(before, pid);
      const why = closeRefusal(2, top);
      if (why)
        throw new OwnerHand(
          `${why}. Owner: close the Workbench by hand (File > Exit, Don't Save; never Save), then resume with --only sf-27-close-test --owner-done`,
        );
      const crashBefore = ctx.deps.crashReporters();
      const c = await ctx.deps.closeGracefully(pid, TIMEOUTS.close);
      const newCrash = ctx.deps.crashReporters().filter((x) => !crashBefore.includes(x));
      if (!c.exited)
        throw new StopSession(
          "handoff",
          `Workbench did not exit within ${TIMEOUTS.close} ms of one WM_CLOSE (${c.detail}). Owner: close it by hand (File > Exit, Don't Save)`,
        );
      const file =
        newCrash.length === 0
          ? ctx.deps.writeGracefulExit(
              pid,
              `CloseMainWindow, exit seen within ${TIMEOUTS.close} ms`,
            )
          : null;
      return {
        status: "observed",
        summary: newCrash.length
          ? `exited, a Crash Reporter started (${newCrash.join(", ")})`
          : "exited cleanly on one WM_CLOSE",
        data: { windowsBefore: before, close: c, newCrashReporters: newCrash, gracefulExit: file },
      };
    },
  });

  // ── Offline 2 (after launch 2) ───────────────────────────────────────────
  steps.push({
    id: "sf-p5-ini-after-launch2",
    launch: "offline-2",
    title: `Read the write-back: ini-edit read-keys on ${INI_LAUNCH2}`,
    risk: "read-only",
    answers: [],
    touches: ["P-U36", "P-U22"],
    timeout_ms: TIMEOUTS.tool,
    expected: "the three edits still there or rewritten; PropertyGrid\\unnamed rows",
    kill_criterion: "the tool failing: STOP",
    side_effects: [],
    rollback: "none needed",
    outline: [`ini-edit read-keys --in <run>/${INI_LAUNCH2}`],
    plan: () => [iniAction("sf-p5-ini-after-launch2", "read-keys", INI_LAUNCH2)],
    run: async (ctx) => {
      const r = await ctx.tool(
        "ini-edit",
        [
          "read-keys",
          "--in",
          join(ctx.opts.runDir, INI_LAUNCH2),
          "--artifacts",
          ctx.opts.artifactsRoot ?? ctx.opts.runDir,
          "--record",
          join(ctx.opts.runDir, "sf-p5-keys.json"),
        ],
        TIMEOUTS.tool,
      );
      if (r.code !== 0) throw new StopSession("kill", `ini-edit read-keys failed: ${r.detail}`);
      const keys = keyNamesOf(r.stdout ?? "");
      return {
        status: "observed",
        summary: `${keys.filter(isPropertyGridRow).length} PropertyGrid\\unnamed row(s); LSP keys ${keys.filter((k) => /LSP_/.test(k)).length}`,
        data: { keyCount: keys.length },
      };
    },
  });
  return steps;
}

// ── The gate ─────────────────────────────────────────────────────────────────

async function waitPort(ctx: SfContext, pid: number, budgetMs: number): Promise<void> {
  const port = ctx.opts.netPort ?? DEFAULT_PORT;
  const deadline = ctx.deps.now() + budgetMs;
  for (;;) {
    ctx.deps.heartbeat();
    const owners = ctx.deps.portOwners(port);
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

async function runGate(ctx: SfContext): Promise<StepOutcome> {
  let debug: { state: string; line: string | null; source: string };
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
    debug = { ...r, source: "force-settings-ini" };
  } else {
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
    debug = { ...r, source: "registry-export" };
  }
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
  const deadline = ctx.deps.now() + budget;
  let compiled: RawCallResult;
  for (;;) {
    compiled = await ctx.call({
      apiFunc: "IsWorkbenchRunning",
      params: {},
      timeoutMs: TIMEOUTS.cheap,
    });
    if (compiled.ok && field(compiled.response, "ScriptsCompiled") === true) break;
    if (ctx.deps.now() >= deadline)
      throw new StopSession("kill", `scripts not compiled after ${budget} ms`);
    await ctx.deps.sleep(TIMEOUTS.poll);
  }
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
        ? (runJson<{ data?: { logScan?: LogScan } }>(ctx.deps, `${ctx.step}.json`)?.data?.logScan ??
          null)
        : null;
    const scanned = scanSessionLog(log, text, prev);
    ctx.state.logScan = scanned.scan;
    if (scanned.errors.length)
      throw new StopSession(
        "kill",
        `the session log holds probe-pack compile errors: ${scanned.errors.join(" | ")}`,
      );
  }
  const pack = ctx.deps
    .listDir(probePackTarget(ctx.opts.sandboxDir))
    .filter((f) => isProbePackFile(f));
  if (pack.some((f) => /^ECEN_ProbeMut/i.test(f)))
    throw new StopSession(
      "kill",
      "the mutating pack is installed: S-F runs with the read-only pack only (postflight.ts --remove-probe-mut)",
    );
  if (!pack.some((f) => /^ECEN_ProbeAuth\.c$/i.test(f)))
    throw new StopSession(
      "kill",
      "ECEN_ProbeAuth.c is not installed (launch.ts --install-handlers --probe-pack mod-dev/probe)",
    );
  const baseline = await ctx.setBaseline("the gate");
  ctx.state.mainHwnd = mainWindowOf(baseline, pid)?.hwnd ?? null;
  const info = await ctx.call(probe("info", { page: 0 }, TIMEOUTS.probe));
  await ctx.modalCheck("info");
  if (!info.ok)
    throw new StopSession(
      "kill",
      /Undefined API func/i.test(info.error ?? "")
        ? `ECEN_Probe answers "${info.error}": the pack did not compile`
        : `ECEN_Probe info failed: ${info.error}`,
    );
  const f = probeFacts(info.response);
  if (f.isSandbox !== "true")
    throw new StopSession(
      "abort",
      `not the sandbox: ECEN_Probe info says isSandbox ${f.isSandbox ?? "absent"}`,
    );
  return {
    status: "pass",
    summary: `Script Debug Mode ${debug.state} (${debug.source}); pid ${pid}; loaded ${(ids ?? []).join(", ")}; ${pack.length} pack files; info isSandbox true`,
    data: {
      scriptDebugMode: debug,
      pid,
      created,
      resumed: known === "known",
      logScan: ctx.state.logScan,
      mainHwnd: ctx.state.mainHwnd,
      loaded: ids,
      sessionLogProject: fromLog,
      packFiles: pack,
      info: summarizeCall(info),
      windows: ctx.state.baselineWindows,
    },
  };
}

// ── Queue ────────────────────────────────────────────────────────────────────

export const RISK_DEFINITIONS: Record<RiskClass, string> = {
  "read-only":
    "changes no state in Workbench or on disk (a prompt answered by the owner is the owner's act, recorded)",
  reversible:
    "changes in-memory window or menu state only (menus expanded and collapsed, editor windows raised, an LSP session, the close)",
  mutating:
    "writes a scratch ini in the run folder (the artifacts folder only); nothing in the sandbox",
};

export const ORDER_NOTE =
  "Read-only, then reversible, then mutating WITHIN each phase (pre-flight step 7 checks the order per `launch`). Five phases: offline-0 (sf-p2, sf-p1), launch 1 (closed by the owner's hand, then postflight.ts --partial 1,2,3), offline-1 (sf-p3, sf-p4), launch 2, offline-2 (sf-p5). The launches carry no -scriptAuthorizeAll.";

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
  const offline = steps.filter((s) => ids.includes(s.id)).every((s) => isOffline(s.launch));
  return (
    (offline ? 0 : steps[0].timeout_ms) +
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
  },
  steps: StepDef[] = buildSteps(),
): string | null {
  const isBlock = BLOCKS.some((b) => b.from === sel.from && b.until === sel.until);
  if (!sel.only && !isBlock)
    return "a real run is one declared block (--from X --until Y) or one step (--only X), never the whole sitting in one invocation";
  const ids = selectedIds(sel, steps);
  if (ids.length === 0) return "the selection names no step after the gate";
  const picked = steps.filter((s) => ids.includes(s.id));
  const phases = new Set(picked.map((s) => s.launch));
  if (phases.size > 1) return "a selection spans two phases";
  const offlineSel = isOffline(picked[0].launch);
  if (offlineSel && !sel.offline)
    return `${ids.join(", ")} run only with --offline (no Workbench, no gate)`;
  if (!offlineSel && sel.offline) return "--offline runs the offline steps only";
  if (ids[0] !== BLOCKS[0].from && !sel.runDir)
    return `a selection that starts at ${ids[0]} resumes a run folder: pass --run-dir <the sitting's run folder>`;
  const worst = invocationWorstCaseMs(ids, steps);
  if (worst > BACKGROUND_CAP_MS)
    return `the selection's worst case (${worst} ms) is above the ${BACKGROUND_CAP_MS} ms background limit`;
  return null;
}

/**
 * The queue's order: the gate (the engine's step 0, launch 1) is listed after the offline-0 steps,
 * so each phase is contiguous for pre-flight step 7.
 */
export function queueOrder(steps: StepDef[]): StepDef[] {
  const rest = steps.slice(1);
  return [
    ...rest.filter((s) => s.launch === "offline-0"),
    steps[0],
    ...rest.filter((s) => s.launch !== "offline-0"),
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  const by = (r: RiskClass): number => steps.filter((s) => s.risk === r).length;
  return {
    $comment:
      "Generated by `scripts/live/s-f-gui.ts --emit-queue` from its step table; tests/live-harness/s-f-gui.test.ts keeps this file equal to the table. Validated by scripts/live/preflight.ts validateQueue (step 7), per launch.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: "docs/v2/sessions/queues/S-F.md",
    plan_refs: [
      "PLAN 8 Phase 2 table, S-F",
      "PLAN 5.1",
      "PLAN 5.3",
      "PLAN 5.4",
      "PLAN 5.7",
      "PLAN 7",
      "PLAN Appendix A",
    ],
    order_note: ORDER_NOTE,
    risk_classes: RISK_DEFINITIONS,
    launch_args: LAUNCH_ARGS,
    launch_args_note: `pre-flight builds the real arguments; S-F never passes ${NEVER_FLAG} (every authorization prompt is expected and handed to the owner)`,
    ruled_buttons: { default: "Yes", ...RULED_BUTTON },
    counts: {
      steps: steps.length,
      by_risk: {
        "read-only": by("read-only"),
        reversible: by("reversible"),
        mutating: by("mutating"),
      },
      detached_calls:
        "authProbe, loadContainer, evalCompile, executeAction, pluginAttrs, BringModuleWindowToFront, OpenResource",
    },
    timeout_note:
      "timeout_ms is an ESTIMATE of each step's worst case; one block per invocation, each adding the gate (none offline) and a margin, run in the background with a timeout above it (DEC-032).",
    worst_case_total_ms: worstCaseTotalMs(steps),
    invocation_blocks: BLOCKS.map((b) => ({
      from: b.from,
      until: b.until,
      worst_case_ms: invocationWorstCaseMs(
        selectedIds({ from: b.from, until: b.until }, steps),
        steps,
      ),
    })),
    probes: queueOrder(steps).map((s) => ({
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
      ...(s.ruled ? { ruled_button: s.ruled } : {}),
      ...(s.ownerHand ? { owner_hand: s.ownerHand } : {}),
      ...(s.skipWhen ? { skipped_when: s.skipWhen.condition } : {}),
    })),
    not_answered: NOT_ANSWERED,
  };
}

// ── Action plan and outline ──────────────────────────────────────────────────

export function planInput(o: {
  sandboxDir: string | null;
  conf?: string;
  stPath?: string | null;
}): PlanInput {
  return {
    sandbox: o.sandboxDir ?? "<sandbox>",
    conf: o.conf ?? SD_VANILLA.conf,
    stPath: o.stPath ?? null,
  };
}

export function buildActionPlan(p: PlanInput, steps: StepDef[] = buildSteps()): PlanAction[] {
  const actions: PlanAction[] = [];
  for (const s of steps) actions.push(...s.plan(p));
  actions.push({
    kind: "screenshot",
    target: "desktop",
    step: "any",
    when: "only on a timeout or a kill criterion",
  });
  return actions;
}

export function sessionOutline(p: PlanInput, steps: StepDef[] = buildSteps()): string[] {
  const lines: string[] = [];
  for (const s of steps) {
    const tags = [
      s.ruled ? `ruled ${s.ruled}` : "",
      s.ownerHand ? "owner hand" : "",
      s.skipWhen ? "conditional" : "",
    ].filter(Boolean);
    lines.push(
      `${s.id} (${typeof s.launch === "number" ? `launch ${s.launch}` : s.launch}, ${s.risk})${tags.length ? ` [${tags.join(", ")}]` : ""}: ${s.title}`,
    );
    for (const a of s.plan(p)) {
      const t = typeof a.target === "string" ? a.target : JSON.stringify(a.target);
      lines.push(
        `    ${a.kind} ${t}${a.params ? ` ${JSON.stringify(a.params)}` : ""}${a.detached ? " (detached)" : ""}`,
      );
    }
    for (const o of s.outline) lines.push(`    - ${o}`);
    if (s.ownerHand) lines.push(`    - owner: ${s.ownerHand}`);
  }
  return lines;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export type ReportStopKind = StopKind | "owner-hand";

export interface StepReport {
  id: string;
  status: StepStatus | "stopped" | "aborted" | "handoff" | "owner-hand";
  summary: string;
  answers: string[];
  evidence: string | null;
}

export interface SessionReport {
  exit: number;
  steps: StepReport[];
  stop: { kind: ReportStopKind; reason: string; step: string } | null;
}

/** Run the selected steps against `deps`. Never retries after a timeout; never answers a dialog. */
export async function runSession(
  opts: SfOptions,
  deps: SfDeps,
  steps: StepDef[] = buildSteps(),
): Promise<SessionReport> {
  const state: SfState = {
    wbPid: null,
    startedPids: new Set(),
    baselineWindows: [],
    yesToAll: false,
    presses: [],
    mainHwnd: null,
    logScan: null,
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
    const why = sendRefusal(ctx.step, spec.apiFunc, spec.params, opts.policy, qtRead());
    if (why) throw new Error(`refused: ${why}`);
  };
  const qtRead = (): boolean =>
    ["sf-12-u21-menus-background", "sf-13-u21-menus-foreground"].some(
      (id) => runJson<{ data?: { qtLabel?: boolean } }>(deps, `${id}.json`)?.data?.qtLabel === true,
    );
  const authRecord = (
    step: string,
    auth: WindowInfo,
    wins: WindowInfo[],
    child?: { pid: number; resultName: string },
  ): Record<string, unknown> => ({
    step,
    ruledButton: ruledFor(step, opts.ruledButtons),
    window: auth,
    owner: auth.owner,
    classMatches: auth.className === AUTH_CLASS,
    mainWindowDisabled: wins.some((w) => w.owner === 0 && w.hwnd !== auth.hwnd && !w.enabled),
    windows: wins,
    ...(child ? { childPid: child.pid, resultName: child.resultName } : {}),
    nonce: opts.nonce,
    at: new Date(deps.now()).toISOString(),
  });
  const walkerLine = (pid: number | null, auth: WindowInfo, label: string): string =>
    `tools/uia/walk.ts --pid ${pid} --class ${auth.className} --title-pattern "${AUTH_TITLE}"${auth.owner !== 0 ? " --allow-owned" : ""} --label ${label} --out <run>/${label}-walk.json --id ${opts.laneId} --really`;
  const authHandoff = (
    step: string,
    auth: WindowInfo,
    wins: WindowInfo[],
    child?: { pid: number; resultName: string },
  ): never => {
    deps.writeArtifact(`auth-${step}.json`, authRecord(step, auth, wins, child));
    const next = nextStep(steps, step);
    const b = ruledFor(step, opts.ruledButtons);
    throw new StopSession(
      "handoff",
      `"${AUTH_TITLE}" is up (class ${auth.className}, hwnd ${auth.hwnd}, ${auth.owner === 0 ? "unowned" : `owned by ${auth.owner}`}); auth-${step}.json written; nothing was clicked or keyed. ` +
        `Main session: read it with the passive walker (${walkerLine(state.wbPid, auth, `auth-${step}`)}) and quote it. ` +
        `Owner: press ${b} (ruled for ${step}) and say which. Then resume with --only ${next ?? "<next step>"} --run-dir ${opts.runDir} --owner-clicked ${b}; ${step} is not run again`,
    );
  };

  const ctx: SfContext = {
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
            throw new StopSession(
              "kill",
              `${spec.apiFunc} (detached child pid ${childPid}): ${[...ch.disabled, ...bad].map((w) => `${w.className} "${w.title}"`).join(" | ")} appeared during the call: a modal is up; nothing is clicked, the child is left running`,
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
      if (ch.disabled.length || dialogs.length)
        throw new StopSession(
          "kill",
          `after ${label}: ${[...ch.disabled, ...dialogs].map((w) => `${w.className} "${w.title}" owner ${w.owner}`).join(" | ")}: a modal or a prompt is up; nothing is clicked`,
        );
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
    async noAuthWindow(label) {
      const ws = await ctx.ourWindows();
      if (authWindow(ws, state.wbPid))
        throw new StopSession(
          "kill",
          `${label}: "${AUTH_TITLE}" is up: nothing is sent while it exists (no menus tool, no NET call, no LSP)`,
        );
      return ws;
    },
    async tool(tool, args, timeoutMs) {
      if (inFlight) throw new Error("one call at a time: a call is already in flight");
      deps.heartbeat();
      return deps.runTool(tool, args, timeoutMs);
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
  const selected = steps.filter((s, i) => i > 0 && i >= fromIdx && i <= untilIdx);
  const offlineSel = selected.length > 0 && selected.every((s) => isOffline(s.launch));
  if (selected.some((s) => isOffline(s.launch)) && !offlineSel)
    return refuse("a selection mixes offline and launch steps");
  if (offlineSel !== opts.offline)
    return refuse(
      opts.offline
        ? "--offline runs the offline steps only"
        : `${selected.map((s) => s.id).join(", ")} run only with --offline`,
    );

  const runFiles = deps.listRunFiles();
  const promptsOf = (id: string): number =>
    1 +
    runFiles.filter(
      (f) => f.startsWith(`auth-${id}-`) && /^\d+\.json$/.test(f.slice(`auth-${id}-`.length)),
    ).length;
  const dangling = runFiles.filter(
    (f) => /\.started$/.test(f) && !runFiles.includes(f.replace(/\.started$/, ".json")),
  );
  if (dangling.length) {
    const id = dangling[0].replace(/\.started$/, "");
    return refuse(
      `${id} has a started marker and no result in this run folder: the script ended during that step. Heartbeat the lane; recover if a Workbench runs; stop and ask the owner. No step runs until acknowledge --step ${id} is recorded`,
    );
  }
  // Owner-hand: a step whose result says owner-hand waits for --owner-done (and runs again once).
  const ownerPending = steps
    .map((s) => s.id)
    .filter(
      (id) =>
        runJson<{ status?: string }>(deps, `${id}.json`)?.status === "owner-hand" &&
        runFiles.includes(`owner-${id}.json`),
    );
  const authEntries = authLogEntries(deps.readRunFile(AUTH_LOG));
  const authPending = steps
    .map((s) => s.id)
    .filter((id) => {
      if (!runFiles.includes(`auth-${id}.json`)) return false;
      const last = authEntries.filter((e) => e.step === id).pop();
      return !last || last.buttons.length < promptsOf(id);
    });
  if (ownerPending.length && opts.ownerClicked && !authPending.length)
    return refuse(
      `--owner-clicked is refused for the owner-hand step ${ownerPending[0]}: no authorization handoff waits; resume with --owner-done`,
    );
  if (opts.ownerDone) {
    if (authPending.length)
      return refuse(
        `--owner-done is refused: ${authPending[0]} waits on "${AUTH_TITLE}": pass --owner-clicked <button>`,
      );
    if (!ownerPending.length) return refuse("--owner-done was given but no owner-hand step waits");
    if (opts.only !== ownerPending[0])
      return refuse(`--owner-done resumes ${ownerPending[0]} only: pass --only ${ownerPending[0]}`);
  } else if (ownerPending.length) {
    return refuse(
      `${ownerPending[0]} waits on the owner's hand: when it is done, resume with --only ${ownerPending[0]} --owner-done`,
    );
  }
  const again = selected.find(
    (s) =>
      (runFiles.includes(`${s.id}.json`) && !ownerPending.includes(s.id)) ||
      runFiles.includes(`${s.id}.started.acknowledged`),
  );
  if (again)
    return refuse(
      `${again.id} already has a result in this run folder (or an acknowledged marker): a step is never run twice (plan 5.3)`,
    );
  for (const f of runFiles) {
    const m = /^(child-.+\.json)\.request\.json$/.exec(f);
    if (!m || runFiles.includes(m[1])) continue;
    const pidText = deps.readRunFile(`${m[1]}.pid.json`);
    if (pidText === null)
      return refuse(
        `the detached call ${m[1]} has no result and no recorded child pid: check by hand, then stop and ask the owner`,
      );
    const child = JSON.parse(pidText) as { pid: number; created: number | null };
    if (deps.processImage(child.pid) === null) continue;
    const nowCreated = await deps.processCreated(child.pid);
    if (child.created === null || nowCreated === null || nowCreated === child.created) {
      // A further prompt of the same call after the owner's click (S-D M3).
      let wins: WindowInfo[] = [];
      try {
        wins = await deps.listWindows();
      } catch {
        return refuse(
          `the detached call ${m[1]} still waits and the window list failed: stop and ask`,
        );
      }
      const auth = authWindow(wins, deps.recordedPid());
      const step = steps
        .map((s) => s.id)
        .find(
          (id) =>
            runFiles.includes(`auth-${id}.json`) &&
            runJson<{ resultName?: string }>(deps, `auth-${id}.json`)?.resultName === m[1],
        );
      if (auth && step) {
        const n = promptsOf(step) + 1;
        deps.writeArtifact(`auth-${step}-${n}.json`, {
          ...authRecord(step, auth, wins, { pid: child.pid, resultName: m[1] }),
          prompt: n,
        });
        const reason = `the detached call ${m[1]} of ${step} still waits and "${AUTH_TITLE}" is up again: prompt ${n} of the same call; auth-${step}-${n}.json written; nothing was clicked. Main session: walk it (${walkerLine(deps.recordedPid(), auth, `auth-${step}-${n}`)}). Owner: press ${ruledFor(step, opts.ruledButtons)} (ruled for ${step}) and say which. Then resume with --only ${nextStep(steps, step) ?? "<next step>"} --run-dir ${opts.runDir} --owner-clicked <button 1>,...,<button ${n}>`;
        report.stop = { kind: "handoff", reason, step };
        report.exit = EXIT.handoff;
        deps.log(`handoff: ${reason}`);
        return report;
      }
      return refuse(
        `the detached call ${m[1]} has no result and its child pid ${child.pid} still runs: wait for the owner, or stop and ask`,
      );
    }
  }
  const clicked =
    opts.ownerClicked === null || opts.ownerClicked === undefined
      ? []
      : typeof opts.ownerClicked === "string"
        ? [opts.ownerClicked]
        : [...opts.ownerClicked];
  if (authPending.length && !clicked.length) {
    const n = promptsOf(authPending[0]);
    return refuse(
      `${authPending[0]} stopped on "${AUTH_TITLE}" and the owner's button is not recorded: pass --owner-clicked ${ruledFor(authPending[0], opts.ruledButtons)}${n > 1 ? ` (${n} buttons in order, comma-separated)` : ""}`,
    );
  }
  if (clicked.length) {
    if (!authPending.length)
      return refuse(
        "--owner-clicked was given but no authorization handoff waits for the owner's button",
      );
    const id = authPending[0];
    const n = promptsOf(id);
    if (clicked.length !== n)
      return refuse(
        `${id} raised ${n} prompt(s): --owner-clicked takes ${n} button(s) in order; ${clicked.length} given`,
      );
    const ruled = ruledFor(id, opts.ruledButtons);
    const deviation = clicked.some((b) => b !== ruled);
    if (deviation && !opts.ownerClickedDeviation)
      return refuse(
        `${id}'s ruled button is ${ruled}; --owner-clicked ${clicked.join(",")} differs: pass --owner-clicked-deviation to record the owner's real press`,
      );
    const auth = runJson<{ resultName?: string }>(deps, `auth-${id}.json`);
    const late = auth?.resultName ? runJson<RawCallResult>(deps, auth.resultName) : null;
    const texts = Array.from({ length: n }, (_, i) =>
      promptText(
        deps.readRunFile(i === 0 ? `auth-${id}-walk.json` : `auth-${id}-${i + 1}-walk.json`),
      ),
    );
    const entry = {
      step: id,
      button: clicked[0],
      buttons: clicked,
      ruled,
      ruled_by: opts.ruledButtons?.[id] ? "command line" : "S-F",
      deviation,
      prompts: n,
      prompt_texts: texts,
      recorded_at: new Date(deps.now()).toISOString(),
      late_answer: late ? summarizeCall(late) : null,
      late_answer_facts: late ? probeFacts(late.response) : null,
      late_answer_file: auth?.resultName ?? null,
    };
    deps.appendRunLine(AUTH_LOG, JSON.stringify(entry));
    const prior = runJson<Record<string, unknown>>(deps, `${id}.json`);
    if (prior) deps.writeArtifact(`${id}.json`, { ...prior, ownerAnswer: entry });
    deps.log(
      `authorization log: ${id} answered ${clicked.join(", ")} by the owner (ruled ${ruled})`,
    );
  }
  state.presses = authLogEntries(deps.readRunFile(AUTH_LOG)).map((e) => ({
    step: e.step,
    buttons: e.buttons,
  }));
  state.yesToAll = state.presses.some((e) => e.buttons.includes("YesToAll"));

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
        `--offline: a Workbench image runs (pid ${running.join(", ")}); the offline steps run only with none`,
      );
  }
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
    const mark = calls.length;
    try {
      const skipReason = pre.get(s.id) ?? s.skip?.(ctx) ?? null;
      if (skipReason !== null) {
        finish(s, "skipped", skipReason, {}, mark);
        continue;
      }
      if (s.ownerHand && !opts.ownerDone) {
        await ctx.noAuthWindow(`${s.id} owner hand`);
        throw new OwnerHand(
          `Owner: ${s.ownerHand}. Then resume with --only ${s.id} --run-dir ${opts.runDir} --owner-done`,
        );
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
      finish(s, out.status, out.summary, out.data ?? {}, mark);
    } catch (caught) {
      if (caught instanceof OwnerHand) {
        deps.writeArtifact(`owner-${s.id}.json`, {
          step: s.id,
          instruction: caught.message,
          at: new Date(deps.now()).toISOString(),
        });
        finish(s, "owner-hand", caught.message, { windows: await evidenceWindows() }, mark);
        report.stop = { kind: "owner-hand", reason: caught.message, step: s.id };
        report.exit = EXIT.handoff;
        return report;
      }
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
  artifactsRoot: string;
}

/** The harness tools' entry points (sf-coder-harness's CLI surface) */
export const TOOL_PATHS: Readonly<Record<"ini-edit" | "lsp-probe" | "menus", string>> = {
  "ini-edit": "scripts/live/ini-edit.ts",
  "lsp-probe": "scripts/live/lsp-probe.ts",
  menus: "tools/uia/menus.ts",
};

export function realDeps(input: RealDepsInput): SfDeps {
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
        label: `S-F-${label}`,
        dir: input.runDir,
        gateReason: null,
      });
      return { ok: r.ok, path: r.path, detail: r.detail };
    },
    processImage: (pid) => processByPid(defaultExec, pid)?.image ?? null,
    processCreated: (pid) => creationTimeOf(pid, () => readProcessTable()),
    workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((p) => p.pid),
    listRunFiles: () => (existsSync(input.runDir) ? readdirSync(input.runDir) : []),
    listDir: (p) => (existsSync(inSandbox(p)) ? readdirSync(p) : []),
    portOwners: (port) => portListeners(defaultExec, port),
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
    runTool: (tool, args, timeoutMs) =>
      new Promise((done) => {
        const val = (flag: string): string | null => {
          const i = args.indexOf(flag);
          return i >= 0 ? args[i + 1] : null;
        };
        // ini-edit and lsp-probe read and write only inside the artifacts folder.
        if (tool !== "menus")
          for (const flag of ["--out", "--record", "--in"]) {
            const p = val(flag);
            if (p !== null && iniPathRefusal(p, input.artifactsRoot)) {
              done({
                code: 1,
                json: null,
                detail: `refused: ${flag} outside the artifacts folder`,
              });
              return;
            }
          }
        const child = spawn(
          process.execPath,
          ["--import", TSX_IMPORT, join(REPO_ROOT, TOOL_PATHS[tool]), ...args],
          { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
        );
        let out = "";
        let err = "";
        child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
        const timer = setTimeout(() => child.kill(), timeoutMs);
        const readJson = (p: string | null): unknown => {
          try {
            return p && existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
          } catch {
            return null;
          }
        };
        child.on("close", (code) => {
          clearTimeout(timer);
          let json: unknown = null;
          if (tool === "ini-edit") json = readJson(val("--record"));
          else if (tool === "lsp-probe") json = readJson(val("--out"));
          else {
            let last: unknown = null;
            try {
              last = JSON.parse(lastLine(out) ?? "null");
            } catch {
              last = null;
            }
            const doc = readJson(val("--out"));
            json = {
              ...(doc && typeof doc === "object" ? doc : {}),
              ...(last && typeof last === "object" ? last : {}),
            };
          }
          done({
            code: code ?? 1,
            json,
            stdout: toPlaceholders(out, input.placeholders),
            detail: toPlaceholders(err.trim().slice(0, 500), input.placeholders),
          });
        });
      }),
    dlgConsumers: () => dlgConsumersIn(API_INDEX_DIR),
    readRunFile: (name) => {
      const p = join(input.runDir, name);
      return existsSync(p) ? readFileSync(p, "utf-8") : null;
    },
    appendRunLine: (name, line) => {
      mkdirSync(input.runDir, { recursive: true });
      appendFileSync(
        join(input.runDir, name),
        toPlaceholders(line, input.placeholders) + "\n",
        "utf-8",
      );
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

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface MainOverrides {
  platform?: NodeJS.Platform;
  deps?: (input: RealDepsInput) => SfDeps;
  policy?: CensusPolicy;
  out?: (line: string) => void;
  exists?: (path: string) => boolean;
  artifactsRoot?: string;
  recoverDeps?: Partial<RecoverDeps>;
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
  "st-path",
  "conf",
  "ini-in",
  "ruled-buttons",
] as const;

const FLAGS = [
  "really",
  "offline",
  "owner-done",
  "owner-clicked-deviation",
  "debug-mode-unset-ok",
  "owner-ack",
] as const;

/** Why the argv is refused before parsing (the never flag), or null. */
export function argvRefusal(argv: readonly string[]): string | null {
  for (const a of argv) {
    const name = a.split("=")[0];
    if (name.toLowerCase() === NEVER_CLI_FLAG)
      return `${NEVER_CLI_FLAG} is not an option of S-F: the launch carries no ${NEVER_FLAG}`;
    if (a.toLowerCase().includes(NEVER_FLAG.toLowerCase()))
      return `${NEVER_FLAG} is never passed in S-F`;
  }
  return null;
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  let ph: PlaceholderContext = defaultPlaceholderContext({ v2: REPO_ROOT });
  const err = (s: string): void => console.error(toPlaceholders(s, ph));
  const never = argvRefusal(argv);
  if (never) {
    err(`refused: ${never}`);
    return EXIT.usage;
  }
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const o = args.options;
  if (o["child-call"]) return runChildCall(o["child-call"], over.platform);
  const unknown = [...args.flags].filter((f) => !(FLAGS as readonly string[]).includes(f));
  if (unknown.length) {
    err(`unknown option(s): ${unknown.map((f) => `--${f}`).join(", ")}`);
    return EXIT.usage;
  }
  const cmd = args.positional[0] ?? "run";
  if (!["run", "recover", "acknowledge"].includes(cmd)) {
    err("Usage: s-f-gui.ts [run] [options] | recover | acknowledge (see the header)");
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
    return EXIT.refused;
  }
  if (o["st-path"] !== undefined && !/\.st$/i.test(o["st-path"])) {
    err("refused: --st-path names a vanilla .st");
    return EXIT.usage;
  }
  if (o.conf !== undefined && !/\.conf$/i.test(o.conf)) {
    err("refused: --conf names a vanilla .conf");
    return EXIT.usage;
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
        next: "git -C <sandbox> status --short; a stopped step is never retried",
      });
    }
    if (!o.step || !steps.some((s) => s.id === o.step)) {
      err("acknowledge needs --step <step id>");
      return EXIT.usage;
    }
    return acknowledgeMarker({ lane, really, runDir, artifactsRoot, ph }, rec, {
      step: o.step,
      ownerAck: args.flags.has("owner-ack"),
      resultFile: join(runDir, `${o.step}.json`),
      would: "no Workbench image runs",
    });
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
  let ownerClicked: AuthButton[] | null = null;
  if (o["owner-clicked"] !== undefined) {
    const list = o["owner-clicked"].split(",").map((x) => x.trim());
    if (!list.length || !list.every((b) => (AUTH_BUTTONS as readonly string[]).includes(b))) {
      err(`--owner-clicked takes one of ${AUTH_BUTTONS.join(", ")}, or several comma-separated`);
      return EXIT.usage;
    }
    ownerClicked = list as AuthButton[];
  }
  let ruledButtons: Record<string, AuthButton> | null = null;
  if (o["ruled-buttons"] !== undefined) {
    try {
      ruledButtons = parseRuledButtons(o["ruled-buttons"]);
    } catch (e) {
      err(e instanceof Error ? e.message : String(e));
      return EXIT.usage;
    }
    const authIds = steps.filter((s) => s.ruled).map((s) => s.id);
    const bad = Object.keys(ruledButtons).filter((id) => !authIds.includes(id));
    if (bad.length) {
      err(`--ruled-buttons names no authorization step: ${bad.join(", ")}`);
      return EXIT.usage;
    }
  }
  if (args.flags.has("owner-clicked-deviation") && !ownerClicked) {
    err("--owner-clicked-deviation needs --owner-clicked");
    return EXIT.usage;
  }
  if (ownerClicked && args.flags.has("owner-done")) {
    err("--owner-clicked and --owner-done exclude each other");
    return EXIT.usage;
  }
  const nonce = o.nonce ?? randomBytes(3).toString("hex");
  const nonceBad = nonceProblem(nonce);
  if (nonceBad) {
    err(nonceBad);
    return EXIT.usage;
  }
  const offline = args.flags.has("offline");

  if (!really) {
    const sandbox = o.sandbox ?? null;
    const p = planInput({ sandboxDir: sandbox, conf: o.conf, stPath: o["st-path"] ?? null });
    const selecting = Boolean(o.only || o.from || o.until);
    const ids = selectedIds(
      { from: o.from ?? null, until: o.until ?? null, only: o.only ?? null },
      steps,
    );
    const planSteps = selecting ? steps.filter((s, i) => i === 0 || ids.includes(s.id)) : steps;
    const plan = buildActionPlan(p, planSteps);
    ph = defaultPlaceholderContext(sandbox ? { sandbox, v2: REPO_ROOT } : { v2: REPO_ROOT });
    say(
      `S-F session outline [dry run] (${steps.length} steps; no ${NEVER_FLAG}; ruled buttons: Yes, ${Object.entries(
        RULED_BUTTON,
      )
        .map(([k, v]) => `${v} on ${k}`)
        .join(
          ", ",
        )}; .st ${p.stPath ?? "not named (sf-17 skips)"}; worst case ${Math.round(worstCaseTotalMs(steps) / 60_000)} min, an estimate)`,
    );
    if (selecting) {
      const refusal = selectionRefusal(
        {
          from: o.from ?? null,
          until: o.until ?? null,
          only: o.only ?? null,
          runDir: o["run-dir"] !== undefined,
          offline,
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
    for (const b of BLOCKS) {
      const ids2 = selectedIds({ from: b.from, until: b.until }, steps);
      const off = steps.filter((s) => ids2.includes(s.id)).every((s) => isOffline(s.launch));
      say(
        `    ${blockArgs(b)}${off ? " --offline" : ""}: ${invocationWorstCaseMs(ids2, steps)} ms`,
      );
    }
    const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
    say(
      toPlaceholders(
        `action plan: ${plan.length} actions; dry-run check: ${formatResult(check)}`,
        ph,
      ),
    );
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
  const selRefusal = selectionRefusal(
    {
      from: o.from ?? null,
      until: o.until ?? null,
      only: o.only ?? null,
      runDir: o["run-dir"] !== undefined,
      offline,
    },
    steps,
  );
  if (selRefusal) {
    err(`refused: ${selRefusal}`);
    stopped(`refused: ${selRefusal}`);
    return EXIT.usage;
  }
  let forceSettings: string | null = null;
  if (!offline) {
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
    forceSettings = resolve(o["force-settings"]!);
  }
  if (o["ini-in"] !== undefined && iniPathRefusal(o["ini-in"], artifactsRoot)) {
    err("refused: --ini-in must lie in the artifacts folder");
    return EXIT.refused;
  }
  let lane: Lane;
  try {
    lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const reason = liveGateReason({ really, platform, leaseHeld: lane.holdsLease() });
  if (reason) {
    say(toPlaceholders(reason, ph));
    stopped(`refused: ${reason}`);
    return EXIT.refused;
  }
  let config: ReturnType<typeof loadConfig> | null = null;
  try {
    config = !o.sandbox || !o["logs-path"] ? loadConfig() : null;
  } catch (e) {
    err(`configuration: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.usage;
  }
  const sandboxDir = resolve(o.sandbox ?? join(config!.projectPath, SANDBOX_NAME));
  const gproj = join(sandboxDir, `${SANDBOX_NAME}.gproj`);
  ph = defaultPlaceholderContext({ sandbox: sandboxDir, v2: REPO_ROOT });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(o["run-dir"] ?? join(artifactsRoot, "sessions", SESSION, stamp));
  const outside = outsideArtifacts(runDir, artifactsRoot);
  if (outside) {
    err(`refused: ${outside}`);
    return EXIT.refused;
  }
  const build =
    o.build ??
    recordedBuild(join(REPO_ROOT, "data", "census", "ledger.meta.json"))?.build ??
    "unknown";
  const port = o.port ? Number(o.port) : (config?.workbenchPort ?? DEFAULT_PORT);
  const input: RealDepsInput = {
    lane,
    port,
    sandboxDir,
    logsPath: o["logs-path"] ?? config?.logsPath ?? null,
    runDir,
    evidenceDir: join(runDir, "evidence"),
    build,
    placeholders: ph,
    artifactsRoot,
  };
  const deps = (over.deps ?? realDeps)(input);
  const ids = selectedIds(
    { from: o.from ?? null, until: o.until ?? null, only: o.only ?? null },
    steps,
  );
  const opts: SfOptions = {
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
    registryExport: o["registry-export"] ?? null,
    debugModeUnsetOk: args.flags.has("debug-mode-unset-ok"),
    forceSettings,
    offline,
    ownerClicked,
    ownerClickedDeviation: args.flags.has("owner-clicked-deviation"),
    ruledButtons,
    ownerDone: args.flags.has("owner-done"),
    ownedModuleClasses: (o["owned-module-classes"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    stPath: o["st-path"] ?? null,
    conf: o.conf ?? SD_VANILLA.conf,
    iniIn: o["ini-in"] ? resolve(o["ini-in"]) : null,
    netPort: port,
    artifactsRoot,
  };
  deps.log(
    `S-F real run, lane ${lane.session}, run folder ${runDir}, nonce ${nonce}; steps ${ids.join(", ")}; worst case (an estimate) ${invocationWorstCaseMs(ids, steps)} ms`,
  );
  lane.startHeartbeat(60_000);
  try {
    const report = await runSession(opts, deps, steps);
    deps.writeArtifact(`summary-${nonce}.json`, report);
    if (report.stop)
      deps.log(`STOPPED at ${report.stop.step} (${report.stop.kind}): ${report.stop.reason}`);
    else deps.log(`S-F block done: ${ids[0]} to ${ids[ids.length - 1]}`);
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
