/**
 * Sitting P4-4, the launcher walk (PLAN Phase 4 item 10, walker L14), HAND-FREE, in `p4-3.ts`'s
 * shape. One lane, one launch through pre-flight's `launcher-walk` variant: no `-gproj`, no
 * `-forceSettings` (the variant builds its launch with no project and no settings file, so U12 does
 * not apply and no scratch ini rides), no `-scriptAuthorizeAll` (no project loads, so no script is
 * authorised: the switch is not needed and must not be passed on a launcher launch). No plant, no
 * handler install and no probe pack (pre-flight step 6 declares the handler set "none" for this
 * variant and asks for no lint, so `launch.ts --install-handlers` is not required).
 *
 *   w-00   record the top-level windows of the lane's recorded pid and the foreground window
 *          (one PowerShell read, no input); the walk runs only when the foreground window is the
 *          pid's and carries L14's class and title. Anything else is a HANDOFF (exit 5): the walk
 *          never targets a window it has not seen, and never the main Workbench window.
 *   w-01   L14 `p4-l14-walk`, `--module Launcher --state none` (one passive uia-read).
 *   w-02   L14 `p4-l14-menus`, only while `titles_by_module.Launcher` is non-empty; today it is
 *          empty, so the entry records "no titles" and exits 0 without spawning anything.
 *   t-prop the menu titles the walk read, as a proposal JSON in the sitting folder (offline).
 *   h-close the post-flight's WM_CLOSE to the launcher (owner's standing go, DEC-053); a "Quit?"
 *          prompt is a HANDOFF, recorded, nothing pressed.
 *
 * Usage:
 *   npx --no tsx scripts/live/p4-4.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/live/p4-4.ts --entry <id> [--print] --id <lane> --sandbox <dir>
 *       --sitting-dir <dir> [--really]
 *
 * Exit: the child's exit code for a walker entry; w-00 0 ok, 5 handoff, 1 refused; the dry run
 * 0 passed, 1 failed, 2 usage.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { LAUNCHER_WINDOW_TITLE } from "../../src/workbench/launcher-nudge.js";
import { buildWalkerQueue, walkerPlan, type WalkerStep } from "../census/live/common.js";
import {
  LAUNCHER_CLASS,
  MENUS_STEP,
  MODULE,
  SCRIPT as L14_SCRIPT,
  WALK_FILE,
  WALK_STEP,
  def as l14Def,
  launcherMenuTitles,
  menuTitlesOf,
  type WalkDoc,
} from "../census/live/L14-launcher.js";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import { Lane } from "./lane.js";
import { MAX_RELAUNCHES, PROBE_RANK, SAA, commandLine } from "./p4-1.js";
import { REPO_ROOT, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { deniedSwitch, loadPolicy } from "./policy.js";
import { lastLine, runPowerShell } from "./powershell.js";
import { validateQueue } from "./preflight.js";

export const SESSION = "P4-4";
export const SCRIPT_PATH = "scripts/live/p4-4.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P4-4.md";
export const QUEUE_REL = "docs/v2/sessions/queues/P4-4-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const STATE = "none";
/** The run folder of the Launcher entries inside the sitting folder. */
export const RUN_SUB = MODULE;
export const WINDOWS_FILE = "P4-4-launcher-windows.json";
export const PROPOSAL_FILE = "P4-4-launcher-titles.proposal.json";
/** The launch arguments of pre-flight's launcher-walk variant (variantLaunch): none. */
export const LAUNCH_ARGS: readonly string[] = [];

export type Phase = "offline-0" | "L1" | "offline-1" | "close";

export interface WalkerEntry {
  kind: "walker";
  id: string;
  phase: "L1";
  step: typeof WALK_STEP | typeof MENUS_STEP;
  answers: string;
}
export interface SelfEntry {
  kind: "self";
  id: string;
  phase: Phase;
  sub: "windows" | "propose";
  answers: string;
}
export interface HandEntry {
  kind: "hand";
  id: string;
  phase: Phase;
  launches?: boolean;
  text: string;
  command?: string;
}
export type Entry = WalkerEntry | SelfEntry | HandEntry;
export type RunEntry = WalkerEntry | SelfEntry;

export const LAUNCH_COMMAND =
  `npx --no tsx scripts/live/preflight.ts --variant launcher-walk --purpose "P4-4" --id <lane> --queue ${QUEUE_REL} ` +
  "(pass 1 --until 7: keep the step-5 registry export for the post-flight; pass 2 --really). " +
  `No launch.ts --install-handlers (step 6 declares the handler set none), no --probe-pack, no --force-settings (the variant drops it: no scratch ini rides, U12 does not apply), no -gproj, no ${SAA} (no project loads: not needed and never passed on a launcher launch). Step 9 asserts the launcher is the foreground window of the started pid; Enter is never pressed.`;

export const CLOSE_COMMAND =
  "npx --no tsx scripts/live/postflight.ts --id <lane> --before <snapshot-before.json> --registry-before <reg> --sandbox <sandbox> --session-number <NNN> --really " +
  "(no --remove-probe and no --remove-probe-mut: no pack was installed; step 2 sends one WM_CLOSE to the recorded pid's main window, the launcher; a window left open after the timeout, such as a quit prompt, is a HANDOFF recorded and never answered; the lease ends in step 5)";

export function buildSequence(): Entry[] {
  return [
    {
      kind: "hand",
      id: "h-lease",
      phase: "offline-0",
      text: "the lease for the one lane (kept to the post-flight); no owner hand",
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P4-4" --id <lane>',
    },
    {
      kind: "hand",
      id: "h-launch",
      phase: "L1",
      launches: true,
      text: "the launcher-walk pre-flight: two passes on the P4-4 queue, the launch with no argument (no -gproj, no -forceSettings, no -scriptAuthorizeAll), the launcher asserted as the foreground window",
      command: LAUNCH_COMMAND,
    },
    {
      kind: "self",
      id: "w-00",
      phase: "L1",
      sub: "windows",
      answers:
        "the pid's top-level windows and the foreground window, recorded before any walk; the walk targets the window seen, never the main Workbench window",
    },
    {
      kind: "walker",
      id: "w-01",
      phase: "L1",
      step: WALK_STEP,
      answers: "L14 walk of the launcher window: window, control, dialog and menu-title lines",
    },
    {
      kind: "walker",
      id: "w-02",
      phase: "L1",
      step: MENUS_STEP,
      answers: `L14 menus, only while titles_by_module.${MODULE} is non-empty (today empty: "no titles", exit 0)`,
    },
    {
      kind: "self",
      id: "t-propose",
      phase: "offline-1",
      sub: "propose",
      answers: `the launcher's menu titles from the w-01 walk, as ${PROPOSAL_FILE} in the sitting folder for main to add to titles_by_module.${MODULE}`,
    },
    {
      kind: "hand",
      id: "h-close",
      phase: "close",
      text: "the full post-flight: one WM_CLOSE to the launcher (the owner's standing go covers autonomous closes), net-zero diff, registry comparison, no pack to remove, lease ended",
      command: CLOSE_COMMAND,
    },
  ];
}

export const runEntries = (seq: Entry[] = buildSequence()): RunEntry[] =>
  seq.filter((e): e is RunEntry => e.kind !== "hand");
export const launchCount = (seq: Entry[] = buildSequence()): number =>
  seq.filter((e) => e.kind === "hand" && e.launches).length;

const SEL = { module: MODULE, state: {}, allowOwned: false };

export function entrySteps(e: WalkerEntry): WalkerStep[] {
  return l14Def.steps(SEL).filter((s) => s.id === e.step);
}

/** w-02 runs only while the policy lists Launcher titles. */
export function menusBlocked(policy = loadPolicy()): string | null {
  return launcherMenuTitles(policy)
    ? null
    : `no titles: policy titles_by_module.${MODULE} is empty, so L14 plans no uia-menu (t-propose proposes the titles)`;
}

export function entryWorstCaseMs(e: RunEntry): number {
  if (e.kind === "self") return 30_000;
  return entrySteps(e).reduce((n, s) => n + s.timeout_ms, 0);
}

export interface ComposeInput {
  laneId: string;
  really: boolean;
  sandbox?: string | null;
  sittingDir?: string | null;
}

export function composeArgs(
  entryId: string,
  input: ComposeInput,
  seq: Entry[] = buildSequence(),
): { argv: string[]; script: string } | { refusal: string } {
  const e = seq.find((x) => x.id === entryId);
  if (!e) return { refusal: `unknown entry ${entryId}` };
  if (e.kind === "hand")
    return { refusal: `${entryId} is the main session's hand step: ${e.command ?? e.text}` };
  if (!input.sittingDir) return { refusal: "pass --sitting-dir <dir>" };
  if (!input.laneId) return { refusal: "--id <lane id> is required" };
  if (!input.sandbox) return { refusal: "--sandbox <the 2.0 sandbox folder> is required" };
  if (e.kind === "self") {
    const argv = [e.sub, "--sitting-dir", input.sittingDir, "--id", input.laneId];
    if (input.really) argv.push("--really");
    return { argv, script: SCRIPT_PATH };
  }
  const argv: string[] = [];
  if (input.really) argv.push("--really");
  argv.push(
    "--id",
    input.laneId,
    "--sandbox",
    input.sandbox,
    "--run-dir",
    join(input.sittingDir, RUN_SUB),
    "--module",
    MODULE,
    "--state",
    STATE,
    "--session",
    SESSION,
    "--only",
    e.step,
  );
  return { argv, script: L14_SCRIPT };
}

// ── w-00: the pid's windows ──────────────────────────────────────────────────

/** PowerShell: the visible top-level windows of one pid and the foreground window, as JSON. */
export function windowsScript(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`bad pid ${pid}`);
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    "using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;",
    "public static class EmcpP44Windows {",
    "  public delegate bool EnumProc(IntPtr h, IntPtr l);",
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    "  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }",
    "  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }",
    "  public static List<IntPtr> Of(uint want) { var o = new List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == want && IsWindowVisible(h)) o.Add(h); return true; }, IntPtr.Zero); return o; }",
    "}",
    "'@",
    `$want = [uint32]${pid}`,
    "$fg = [EmcpP44Windows]::GetForegroundWindow()",
    "$fpid = [uint32]0",
    "[void][EmcpP44Windows]::GetWindowThreadProcessId($fg, [ref]$fpid)",
    "$wins = @([EmcpP44Windows]::Of($want) | ForEach-Object { [pscustomobject]@{ title = [EmcpP44Windows]::Text($_); className = [EmcpP44Windows]::Cls($_); foreground = ($_ -eq $fg) } })",
    "[pscustomobject]@{ pid = $want; foreground = [pscustomobject]@{ pid = $fpid; title = [EmcpP44Windows]::Text($fg); className = [EmcpP44Windows]::Cls($fg) }; windows = $wins } | ConvertTo-Json -Compress -Depth 4",
  ].join("\n");
}

export interface WinRow {
  title: string;
  className: string;
  foreground?: boolean;
}
export interface WindowsDoc {
  pid: number;
  foreground: { pid: number; title: string; className: string };
  windows: WinRow[];
}
export interface WindowsVerdict {
  ok: boolean;
  /** 0 the walk may run; 5 a HANDOFF (main reads the record, updates L14's target if need be). */
  exit: 0 | 5;
  reason: string;
}

/** Whether the walk may target what the pid shows. Pure. */
export function judgeWindows(doc: WindowsDoc): WindowsVerdict {
  const fg = doc.foreground;
  const launcherTitle = (t: string) => t.startsWith(LAUNCHER_WINDOW_TITLE);
  const other = doc.windows.filter((w) => w.title.trim() && !launcherTitle(w.title));
  if (other.length)
    return {
      ok: false,
      exit: 5,
      reason: `the pid shows a window that is not the launcher (${other.map((w) => `"${w.title}" ${w.className}`).join("; ")}): a project or a prompt; nothing is walked`,
    };
  if (fg.pid !== doc.pid)
    return {
      ok: false,
      exit: 5,
      reason: `the foreground window belongs to pid ${fg.pid}, not ${doc.pid}; nothing is walked`,
    };
  if (!launcherTitle(fg.title))
    return {
      ok: false,
      exit: 5,
      reason: `the foreground window "${fg.title}" is not titled ${LAUNCHER_WINDOW_TITLE}; nothing is walked`,
    };
  if (fg.className !== LAUNCHER_CLASS)
    return {
      ok: false,
      exit: 5,
      reason: `the launcher's class is ${fg.className}, not L14's ${LAUNCHER_CLASS}: main updates L14's LAUNCHER_CLASS from this record before w-01`,
    };
  return {
    ok: true,
    exit: 0,
    reason: `foreground "${fg.title}" ${fg.className} of pid ${doc.pid}; ${doc.windows.length} visible windows`,
  };
}

/** The w-00 record in the run folder, or null; w-01 refuses without an ok one. */
export function readWindowsVerdict(sittingDir: string): WindowsVerdict | null {
  const p = join(sittingDir, RUN_SUB, WINDOWS_FILE);
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf-8")) as { verdict: WindowsVerdict }).verdict;
}

// ── t-propose ────────────────────────────────────────────────────────────────

export function proposal(walk: WalkDoc | null): Record<string, unknown> {
  const titles = walk ? menuTitlesOf(walk) : [];
  return {
    $comment: `Proposal from sitting ${SESSION} (t-propose): the application menu-bar titles the L14 walk read, for main to add to data/census/policy.json live_lane.uia_menu.titles_by_module.${MODULE}. Not applied by this script.`,
    session: SESSION,
    module: MODULE,
    source: `${RUN_SUB}/${WALK_FILE}`,
    walk_found: walk !== null,
    titles,
    ...(walk && !titles.length ? { note: "the walk shows no application menu bar" } : {}),
  };
}

// ── Plan and queue ───────────────────────────────────────────────────────────

export function entryPlan(e: RunEntry): { script: string; plan: PlanAction[] } {
  if (e.kind === "self") return { script: SCRIPT_PATH, plan: [] };
  return { script: L14_SCRIPT, plan: walkerPlan(entrySteps(e), SEL) };
}

/**
 * The plan dry-run.ts checks: the walker entries only. The launch is not in it: dry-run's
 * `launch` kind refuses a launch that names no project (`launch-not-sandbox`), and the launcher
 * walk names none by design, so `checkEntries` checks its (empty) arguments against the deny lists
 * and pre-flight's variantLaunch builds the real one.
 */
export function buildPlan(seq: Entry[] = buildSequence()): PlanAction[] {
  return runEntries(seq).flatMap((e) => entryPlan(e).plan);
}

export function checkEntries(seq: Entry[] = buildSequence()): { ok: boolean; lines: string[] } {
  const policy = loadPolicy();
  const lines: string[] = [];
  let ok = true;
  const denied = deniedSwitch(LAUNCH_ARGS, policy);
  if (denied) ok = false;
  lines.push(
    `h-launch: ${denied ? `FAIL (${denied} denied)` : "PASS"} (launcher-walk variant, no argument; outside dry-run's launch kind)`,
  );
  for (const e of runEntries(seq)) {
    const { script, plan } = entryPlan(e);
    const r = checkPlan(plan, policy, { script });
    if (!r.ok) ok = false;
    lines.push(`${e.id}: ${r.ok ? "PASS" : formatResult(r)} (${plan.length} actions)`);
  }
  return { ok, lines };
}

const W00_PROBE = {
  id: "p4-4-w-00-windows",
  title: "Record the launcher pid's visible top-level windows and the foreground window",
  timeout_ms: 30_000,
  expected: `one visible window titled ${LAUNCHER_WINDOW_TITLE}, class ${LAUNCHER_CLASS}, the foreground window`,
  kill_criterion:
    "any other titled window of the pid (a project or prompt): HANDOFF, nothing walked",
  side_effects: [],
  rollback: "none: a read of window titles and classes, no input sent",
  risk_class: "read-only",
};
const PROPOSE_PROBE = {
  id: "p4-4-t-propose",
  title: "Propose the launcher's menu titles from the walk (offline)",
  timeout_ms: 30_000,
  expected: `${PROPOSAL_FILE} in the sitting folder`,
  kill_criterion: "none (offline)",
  side_effects: [`<sitting>/${PROPOSAL_FILE}`],
  rollback: "delete the proposal file",
  risk_class: "read-only",
};

export function queueProbes(seq: Entry[] = buildSequence()): Array<Record<string, unknown>> {
  const raw: Array<Record<string, unknown> & { phase: Phase }> = [];
  for (const e of runEntries(seq)) {
    if (e.kind === "self") {
      raw.push({
        ...(e.sub === "windows" ? W00_PROBE : PROPOSE_PROBE),
        phase: e.phase,
        entry: e.id,
        script: SCRIPT_PATH,
        module: MODULE,
        state: STATE,
      });
      continue;
    }
    const q = buildWalkerQueue(l14Def, entrySteps(e), SESSION).probes as Array<
      Record<string, unknown>
    >;
    for (const p of q)
      raw.push({
        ...p,
        phase: e.phase,
        entry: e.id,
        script: L14_SCRIPT,
        module: MODULE,
        state: STATE,
      });
  }
  let block = 0;
  let lastRank = -1;
  let lastPhase: Phase | null = null;
  return raw.map(({ phase, ...p }) => {
    const rank = (PROBE_RANK as readonly string[]).indexOf(String(p.risk_class));
    if (phase !== lastPhase || rank < lastRank) {
      block = phase === lastPhase ? block + 1 : 1;
      lastPhase = phase;
    }
    lastRank = rank;
    return { ...p, step: String(p.id), launch: phase === "L1" ? `L1.${block}` : phase };
  });
}

export function buildQueue(seq: Entry[] = buildSequence()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `scripts/live/p4-4.ts --emit-queue` in P4-4 run order; tests/live-harness/p4-4.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. One launch through pre-flight's launcher-walk variant (no -gproj, no -forceSettings, no -scriptAuthorizeAll), no plant, no pack. The menus probe runs only while titles_by_module.Launcher is non-empty.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "PLAN Phase 4 item 10",
      "docs/v2/design/phase4-live-census.md 2, 3, 4",
      "DEC-053",
      "DEC-054",
    ],
    launches: launchCount(seq),
    max_relaunches: MAX_RELAUNCHES,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "pre-flight --variant launcher-walk builds the launch with no project and no settings file",
    invocations: runEntries(seq).map((e) => ({
      id: e.id,
      script: entryPlan(e).script,
      worst_case_ms: entryWorstCaseMs(e),
    })),
    probes: queueProbes(seq),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = ["out", "outline", "emit-queue", "entry", "id", "sandbox", "sitting-dir"];

export function outline(seq: Entry[] = buildSequence()): string[] {
  const total = runEntries(seq).reduce((n, e) => n + entryWorstCaseMs(e), 0);
  const lines = [
    `P4-4: ${launchCount(seq)} launch (launcher-walk, up to ${MAX_RELAUNCHES} relaunches); one lane; hand-free; no pack, no plant, no ${SAA}; worst case ${Math.round(total / 60_000)} min`,
  ];
  for (const e of seq) {
    if (e.kind === "hand") {
      lines.push(`  ${e.id} [${e.phase}] HAND${e.launches ? " (LAUNCH)" : ""}: ${e.text}`);
      continue;
    }
    const r = composeArgs(e.id, {
      laneId: "<lane>",
      really: true,
      sandbox: "<sandbox>",
      sittingDir: "<sitting>",
    });
    const cmd = "refusal" in r ? `BLOCKED: ${r.refusal}` : commandLine(r.script, r.argv);
    lines.push(
      `  ${e.id} [${e.phase}] worst case ${Math.round(entryWorstCaseMs(e) / 1000)} s`,
      `      ${cmd}`,
      `      answers: ${e.answers}`,
    );
  }
  return lines;
}

export interface MainOverrides {
  spawnChild?: (script: string, argv: string[]) => Promise<number>;
  log?: (line: string) => void;
  /** The w-00 read (the lane's recorded pid in, the windows document out). */
  readWindows?: (pid: number) => Promise<WindowsDoc | null>;
  recordedPid?: (laneId: string) => number | null;
  policy?: ReturnType<typeof loadPolicy>;
}

const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function defaultSpawn(script: string, argv: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(
      process.execPath,
      ["--import", TSX_IMPORT, join(REPO_ROOT, script), ...argv],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    child.on("exit", (code) => res(code ?? 1));
    child.on("error", () => res(1));
  });
}

async function defaultReadWindows(pid: number): Promise<WindowsDoc | null> {
  const r = await runPowerShell(windowsScript(pid));
  const line = r.ok ? lastLine(r.stdout) : null;
  if (!line) return null;
  const doc = JSON.parse(line) as WindowsDoc;
  // ConvertTo-Json gives a lone window as an object.
  doc.windows = Array.isArray(doc.windows) ? doc.windows : doc.windows ? [doc.windows] : [];
  return doc;
}

const writeFile = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf-8");
};

async function runSelf(
  sub: string,
  o: Record<string, string>,
  really: boolean,
  over: MainOverrides,
  log: (l: string) => void,
): Promise<number> {
  const sitting = o["sitting-dir"];
  if (!sitting || !o.id) {
    log("refused: pass --sitting-dir <dir> and --id <lane>");
    return 1;
  }
  if (sub === "propose") {
    const walkPath = join(sitting, RUN_SUB, WALK_FILE);
    const walk = existsSync(walkPath)
      ? (JSON.parse(readFileSync(walkPath, "utf-8")) as WalkDoc)
      : null;
    const doc = proposal(walk);
    log(
      `t-propose: ${walk ? `${(doc.titles as string[]).length} titles: ${(doc.titles as string[]).join(", ") || "none"}` : "no walk in the run folder"}`,
    );
    if (!really) return 0;
    writeFile(join(sitting, PROPOSAL_FILE), JSON.stringify(doc, null, 2) + "\n");
    return 0;
  }
  // windows
  const pid = (over.recordedPid ?? ((id) => new Lane({ id }).recordedPid()))(o.id);
  if (pid === null) {
    log("refused: the lane records no pid (run h-launch first)");
    return 1;
  }
  if (!really) {
    log(`w-00 would read the visible top-level windows of pid ${pid} and the foreground window`);
    return 0;
  }
  const doc = await (over.readWindows ?? defaultReadWindows)(pid);
  if (!doc) {
    log("refused: the window read gave no document");
    return 1;
  }
  const verdict = judgeWindows(doc);
  writeFile(
    join(sitting, RUN_SUB, WINDOWS_FILE),
    JSON.stringify({ session: SESSION, ...doc, verdict }, null, 2) + "\n",
  );
  log(`w-00: ${verdict.ok ? "ok" : "HANDOFF"}: ${verdict.reason}`);
  return verdict.exit;
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const log = over.log ?? ((l: string) => console.log(l));
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  if (argv.some((a) => /scriptauthorizeall|script-authorize-all|gproj|forcesettings/i.test(a))) {
    log(`refused: a launcher launch takes no ${SAA}, -gproj or -forceSettings`);
    return 2;
  }
  const really = args.flags.has("really");
  const sub = args.positional[0];
  if (sub) {
    if (sub !== "windows" && sub !== "propose") {
      log(`unknown subcommand ${sub}`);
      return 2;
    }
    return runSelf(sub, o, really, over, log);
  }
  if (!o.entry) {
    for (const l of outline()) log(l);
    const checks = checkEntries();
    for (const l of checks.lines) log(l);
    log(checks.ok ? "PASS (every entry under its own script)" : "FAIL");
    let queueOk = true;
    const queue = buildQueue();
    try {
      log(`queue: ${validateQueue(queue, false).length} probes, valid (validateQueue)`);
    } catch (e) {
      queueOk = false;
      log(`queue refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (o.out) writeFile(o.out, JSON.stringify(buildPlan(), null, 2) + "\n");
    if (o.outline) writeFile(o.outline, outline().join("\n") + "\n");
    if (o["emit-queue"]) writeFile(o["emit-queue"], JSON.stringify(queue, null, 2) + "\n");
    return checks.ok && queueOk ? 0 : 1;
  }
  if (o.entry === "w-02") {
    const blocked = menusBlocked(over.policy ?? loadPolicy());
    if (blocked) {
      log(`P4-4 w-02: ${blocked}; nothing spawned`);
      return 0;
    }
  }
  if (o.entry === "w-01" && really) {
    const v = o["sitting-dir"] ? readWindowsVerdict(o["sitting-dir"]) : null;
    if (!v?.ok) {
      log(`refused: w-01 needs an ok w-00 record (${v ? v.reason : "none in the run folder"})`);
      return 1;
    }
  }
  const r = composeArgs(o.entry, {
    laneId: o.id ?? "",
    really,
    sandbox: o.sandbox ?? null,
    sittingDir: o["sitting-dir"] ?? null,
  });
  if ("refusal" in r) {
    log(`refused: ${r.refusal}`);
    return 1;
  }
  const ph = defaultPlaceholderContext({
    v2: REPO_ROOT,
    ...(o.sandbox ? { sandbox: o.sandbox } : {}),
  });
  log(toPlaceholders(`P4-4 ${o.entry}: ${commandLine(r.script, r.argv)}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
