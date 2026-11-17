/**
 * Live-lane pre-flight (plan 5.3), steps 1 to 9 as named functions, each
 * returning `{ step, name, ok, skipped?, detail, instruction? }`. The runner
 * stops at the first failed step and prints the plan's instruction for it.
 *
 *   1 lease           acquire the lease; someone else holds it -> stop, tell the owner
 *   2 tools build     Tools build id (file metadata) and UI language vs ledger.meta.json
 *   3 workbench       is Workbench running, and did this session start it?
 *   4 port            is port 5775 held by an orphaned CrashReporter.exe?
 *   5 registry        export the Workbench registry key to the artifacts folder
 *   6 snapshot        sandbox snapshot; which handler set; Enforce lint passed or triaged
 *   7 probe queue     load docs/v2/sessions/NNN-queue.json; order and risk ceiling
 *   8 launch          the proven launch form (variant-specific)
 *   9 assert project  the opened project is the sandbox (variant-specific)
 *
 * Variants change steps 8 and 9 only (plan 5.3 "Pre-flight variants"):
 *   default          -gproj <sandbox>, -forceSettings only once U12 has passed;
 *                    assert the opened project from the session log.
 *                    --script-authorize-all appends -scriptAuthorizeAll (plan 5.7,
 *                    sitting S-D, DEC-041) only with --owner-go-script-authorize-all,
 *                    --u12-passed and --force-settings (the scratch profile); the
 *                    deny lists are lifted for that one token, and step 8 and the
 *                    lease purpose record the owner's go. It never comes through
 *                    --extra-args, the environment or the config.
 *   headless-cli     S-A: no handler, no NET call; the sandbox must already be
 *                    known to the launcher (OA-3); the launch arguments are the
 *                    ones under test; the Enter nudge is never used; assert the
 *                    project named in the session log
 *   scratch-profile  S-B: -forceSettings although U12 has not passed (it is the
 *                    thing under test); nothing else rides on the launch except
 *                    the extra arguments the session names (--extra-args, the
 *                    crash-report flags), each checked against the deny lists
 *   launcher-walk    L14: no -gproj; assert the launcher window is the
 *                    foreground window and no project is open; Enter is never
 *                    pressed
 *
 * `--until <n>` runs steps 1 to n only. `--until 7` stops before the launch and
 * prints the registry export and the snapshot manifest, so a session script
 * that launches by itself (S-A, S-B) can take the step-5 export as a file.
 *
 * Step 7 also refuses the session when the mutating probe pack
 * (`<sandbox>/Scripts/WorkbenchGame/EnfusionCensus/ECEN_ProbeMut*.c`) is in the
 * sandbox and the queue is not S-E's (`"session": "S-E"`): plan 5.4 item 7
 * installs that pack only for the session that needs it, and S-E's post-flight
 * removes it (postflight.ts --remove-probe-mut). Step 8 checks it again.
 *
 * Steps 7 and 8 also refuse every session while S-A's U14 throwaway copy
 * (`<sandbox>/Scripts/WorkbenchGame/EMCP2_U14_Throwaway/`) is in the sandbox: a
 * step ended before its rollback (DEC-030). The one exception is S-A itself
 * resuming its own run, whose open plant manifest names that copy
 * (`ownU14Plant`); the S-A step then refuses on that manifest and names the
 * rollback command.
 *
 * Step 9 reads the opened project from the session log by E13's pattern
 * (`OPENED_PROJECT_PATTERN`: the autosave directory names the project's folder
 * under Projects/) unless --opened-project-pattern overrides it. The captured
 * value is a project NAME (a path is reduced to its project name); it must equal
 * the name of the sandbox project, case ignored. The log folder is accepted by
 * its birth time only (a folder's change time moves when anything writes into
 * an older session's folder), and the log is read again until the line appears
 * or the deadline (--assert-wait-ms, default 180 s) passes.
 *
 * Steps 3 and 4 never terminate anything. Every step that touches Workbench,
 * the registry, the desktop or a process runs only with --really, on win32,
 * with the lease held by this lane; otherwise it reports what it would do
 * (dry run) or `skipped` (not win32).
 *
 * [unverified] items: the Workbench registry key name (passed in with
 * --registry-key; DEC-029 records the name the S-B and S-C authors use), the
 * source of the UI language, that E13's autosave line names the opened project
 * by the name of its .gproj (DEC-029), and whether the launcher and Workbench
 * share one process image.
 *
 * Usage:
 *   npx tsx scripts/live/preflight.ts --variant <default|headless-cli|scratch-profile|launcher-walk>
 *       --purpose <text> --queue <NNN-queue.json> [--id <lane id>] [--sandbox <dir>]
 *       [--until <1-9>] [--lint passed|triaged] [--probe-pack] [--snapshot-paths a,b]
 *       [--registry-key <key>] [--force-settings <ini>] [--u12-passed]
 *       [--headless-args <json array>] [--extra-args <json array>]
 *       [--launcher-knows-sandbox] [--owner-yes-above-mutating]
 *       [--script-authorize-all --owner-go-script-authorize-all]
 *       [--opened-project-pattern <regex>] [--session-log <console.log>]
 *       [--assert-wait-ms <ms>] [--ledger-meta <path>] [--workbench-path <tools>]
 *       [--game-path <game>] [--really]
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadConfig } from "../../src/config.js";
import { LAUNCHER_WINDOW_TITLE } from "../../src/workbench/launcher-nudge.js";
import { LeaseError } from "../../src/workbench/lease.js";
import {
  OPENED_PROJECT_PATTERN,
  projectNameOfGproj,
} from "../census/enumerators/e13-launch-logs.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane, laneRefusal } from "./lane.js";
import {
  BUNDLED_HANDLER_DIR,
  U14_THROWAWAY_FOLDER,
  U3_PLANT_FOLDER,
  WORKBENCH_EXE,
  buildLaunch,
  defaultSandboxGproj,
  formatCommandLine,
  handlerFiles,
  probeMutFiles,
  resolveWorkbenchExe,
  spawnWorkbench,
  type LaunchPlan,
} from "./launch.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  insideGitWorkTree,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { deniedSwitch, deniedSwitchNames, loadPolicy, type CensusPolicy } from "./policy.js";

export { deniedSwitch };
import { lastLine, runPowerShell, type PowerShellResult } from "./powershell.js";
import { takeSnapshot, type Manifest } from "./snapshot.js";
import {
  CRASH_REPORTER_IMAGE,
  defaultExec,
  portListeners,
  processByPid,
  processesByImage,
  type ExecFn,
} from "./win.js";

// ── Types ────────────────────────────────────────────────────────────────────

export const PREFLIGHT_VARIANTS = [
  "default",
  "headless-cli",
  "scratch-profile",
  "launcher-walk",
] as const;

export type PreflightVariant = (typeof PREFLIGHT_VARIANTS)[number];

export interface StepResult {
  step: number;
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
  /** The plan's instruction, printed when the step fails. */
  instruction?: string;
}

/** Risk classes in probe-queue order (policy.live_lane.probe_order). */
export const PROBE_ORDER = ["read-only", "reversible", "mutating"] as const;

/** One probe in a session queue. Field names are this harness's; [proposed] until Phase 2. */
export interface QueuedProbe {
  id: string;
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  risk_class: string;
}

export interface PreflightContext {
  variant: PreflightVariant;
  lane: Lane;
  purpose: string;
  really: boolean;
  platform: NodeJS.Platform;
  workbenchPath: string;
  gamePath: string;
  /** NET API port (config.workbenchPort). */
  port: number;
  sandboxDir: string;
  /** Sandbox .gproj; ignored by the launcher-walk variant. */
  gproj: string;
  artifactsDir: string;
  ledgerMetaPath: string;
  queuePath: string | null;
  /** Declared snapshot paths, relative to the sandbox. Null: every top-level entry but .git. */
  snapshotPaths: string[] | null;
  /** [unverified] Workbench registry key, e.g. under HKCU; not recorded in this repository. */
  registryKey: string | null;
  forceSettings?: string;
  u12Passed: boolean;
  /** Operator's confirmation for step 6: the Enforce lint passed, or every finding is triaged. */
  lint: "passed" | "triaged" | null;
  /** The development probe pack rides along with the shipped set. */
  probePack: boolean;
  /** headless-cli: the launch arguments under test, appended after -gproj. */
  headlessArgs: string[];
  /**
   * scratch-profile: extra launch arguments appended after -forceSettings (the
   * crash-report flags of S-B). Each is checked against the deny lists; a
   * project or settings switch is refused. Other variants refuse any.
   */
  extraArgs?: string[];
  /**
   * default variant, sitting S-D only (plan 5.7, DEC-041): append `-scriptAuthorizeAll` to the
   * launch. Accepted only with `ownerGoScriptAuthorizeAll`, `u12Passed` and `forceSettings` (the
   * scratch profile, never the owner's registry profile); the deny-list check is lifted for that
   * one token only. Set only from `--script-authorize-all`, never from --extra-args, the
   * environment or the config.
   */
  scriptAuthorizeAll?: boolean;
  /** `--owner-go-script-authorize-all`: the owner gave his go in chat for this launch (plan 5.7). */
  ownerGoScriptAuthorizeAll?: boolean;
  /** headless-cli entry condition: the owner opened the sandbox once (OA-3). */
  launcherKnowsSandbox: boolean;
  /** The owner said yes in chat to probes above `mutating` for this session. */
  ownerYesAboveMutating: boolean;
  /**
   * S-A only: the U14 throwaway folder in the sandbox is this run's own open plant
   * (a plant manifest in the run folder with no rollback record) and this
   * invocation runs that U14 step. Steps 7 and 8 then let the folder pass.
   */
  ownU14Plant?: boolean;
  /**
   * Regex whose first capture group names the opened project. Null: E13's
   * OPENED_PROJECT_PATTERN (DEC-029), which captures the project's folder name
   * under Projects/.
   */
  openedProjectPattern: string | null;
  /** Session console.log to read the opened project from. */
  sessionLog: string | null;
  /** True when sessionLog was chosen automatically (newest); step 9 then requires one born after the spawn. */
  sessionLogAuto?: boolean;
  /** Workbench logs root, for the post-launch session-log search. */
  logsPath?: string | null;
  /**
   * How long step 9 waits, from its start, for a session log born after the
   * spawn AND a line in it that names the opened project (default 180 s).
   * `logWaitMs`, the older name, is read when this is unset.
   */
  assertWaitMs?: number;
  logWaitMs?: number;
  /** Pause between two reads of the session log in step 9 (default 1 s). */
  pollMs?: number;
  /** Injectable for tests: the wall clock in ms and a sleep. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called when step 9 fails after step 8 started a Workbench: close it (plan 5.3 step 9). */
  onAbort?: (ctx: PreflightContext) => Promise<string>;
  exec: ExecFn;
  powershell: (script: string, env?: Record<string, string>) => Promise<PowerShellResult>;
  now: () => Date;
  /** Filled in by the steps for later steps and for post-flight. */
  state: {
    snapshot?: Manifest;
    snapshotFile?: string;
    registryExport?: string;
    launch?: LaunchPlan;
    startedPid?: number;
    /** Wall-clock time of the spawn in step 8; step 9 only trusts a session log born after this. */
    launchedAt?: number;
    queue?: QueuedProbe[];
    /** The queue's `session` field (S-A ... S-F), or null when it names none. */
    queueSession?: string | null;
  };
}

export type PreflightStep = (ctx: PreflightContext) => StepResult | Promise<StepResult>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function gate(ctx: PreflightContext): string | null {
  return liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
}

/** A step that could not run for real: dry run (ok, skipped) or refused (not ok). */
function notRun(step: number, name: string, reason: string, wouldDo: string): StepResult {
  const refused = reason.startsWith("refused");
  return {
    step,
    name,
    ok: !refused,
    skipped: true,
    detail: `${reason}; would ${wouldDo}`,
    instruction: refused ? "Acquire the lease first (step 1)." : undefined,
  };
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

// ── Step 1: lease ────────────────────────────────────────────────────────────

export const INSTRUCTION_LEASE =
  "Acquire the lease. If someone else holds it, stop and tell the owner.";

export function stepLease(ctx: PreflightContext): StepResult {
  const base = { step: 1, name: "lease" };
  if (!ctx.really || ctx.platform !== "win32") {
    const refusal = laneRefusal(ctx.lane.status().lease, ctx.lane.session);
    if (refusal) return { ...base, ok: false, detail: refusal, instruction: INSTRUCTION_LEASE };
    return {
      ...base,
      ok: true,
      skipped: true,
      detail: `lease is available; would acquire it as ${ctx.lane.session} for "${leasePurpose(ctx)}"`,
    };
  }
  try {
    const lease = ctx.lane.start(leasePurpose(ctx));
    return {
      ...base,
      ok: true,
      detail: `lease held by ${lease.session} since ${lease.started_at}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      ok: false,
      detail: msg,
      instruction: e instanceof LeaseError ? INSTRUCTION_LEASE : undefined,
    };
  }
}

// ── Step 2: Tools build and UI language ──────────────────────────────────────

export const INSTRUCTION_BUILD =
  "Steam can update the Tools between sessions. Stop: record the new build in DECISIONS.md and " +
  "refresh ledger.meta.json before any live step.";

/** Build recorded in ledger.meta.json; [unverified] field names until the ledger schema lands. */
export function recordedBuild(
  metaPath: string,
): { build: string | null; uiLanguage: string | null } | null {
  if (!existsSync(metaPath)) return null;
  const raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) if (typeof raw[k] === "string") return raw[k] as string;
    return null;
  };
  // ledger.meta.json (src/census) stores build as { tag, branch, ui_language }.
  const build = raw.build;
  if (build && typeof build === "object") {
    const b = build as Record<string, unknown>;
    const tag = typeof b.tag === "string" && b.tag !== "unknown" ? b.tag : null;
    const lang =
      typeof b.ui_language === "string" && b.ui_language !== "unknown" ? b.ui_language : null;
    return { build: tag, uiLanguage: lang };
  }
  return { build: pick("build", "build_tag"), uiLanguage: pick("ui_language", "uiLanguage") };
}

/** PowerShell: FileVersion/ProductVersion of the exe whose path is in $env:EMCP_EXE. */
export const FILE_VERSION_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:EMCP_EXE)",
  "[pscustomobject]@{ file = $v.FileVersion; product = $v.ProductVersion } | ConvertTo-Json -Compress",
].join("\n");

export async function stepToolsBuild(ctx: PreflightContext): Promise<StepResult> {
  const exe = resolveWorkbenchExe(ctx.workbenchPath);
  const reason = gate(ctx);
  if (reason) return notRun(2, "tools build", reason, `read the file version of ${exe}`);
  const r = await ctx.powershell(FILE_VERSION_SCRIPT, { EMCP_EXE: exe });
  const line = r.ok ? lastLine(r.stdout) : null;
  if (!line) {
    return {
      step: 2,
      name: "tools build",
      ok: false,
      detail: `could not read the build: ${r.error ?? r.stderr}`,
    };
  }
  const v = JSON.parse(line) as { file?: string; product?: string };
  const build = v.product || v.file || "unknown";
  const recorded = recordedBuild(ctx.ledgerMetaPath);
  const lang = "UI language: not compared (its source is [unverified])";
  if (!recorded || !recorded.build) {
    return {
      step: 2,
      name: "tools build",
      ok: true,
      detail: `build ${build}; no recorded build in ledger.meta.json yet; ${lang}`,
    };
  }
  if (recorded.build !== build) {
    return {
      step: 2,
      name: "tools build",
      ok: false,
      detail: `installed build ${build} differs from ledger.meta.json ${recorded.build}`,
      instruction: INSTRUCTION_BUILD,
    };
  }
  return { step: 2, name: "tools build", ok: true, detail: `build ${build} matches; ${lang}` };
}

// ── Step 3: is Workbench running? ────────────────────────────────────────────

export const INSTRUCTION_RUNNING =
  "Workbench is running and this session did not start it: stop and ask. Never adopt someone " +
  "else's Workbench.";

/** Never terminates anything: it only lists processes. */
export function stepWorkbenchRunning(ctx: PreflightContext): StepResult {
  const reason = gate(ctx);
  if (reason) return notRun(3, "workbench running", reason, `list ${WORKBENCH_EXE} processes`);
  const pids = processesByImage(ctx.exec, WORKBENCH_EXE).map((r) => r.pid);
  const ours = ctx.lane.recordedPid();
  const foreign = pids.filter((p) => p !== ours);
  if (foreign.length > 0) {
    return {
      step: 3,
      name: "workbench running",
      ok: false,
      detail: `running pid${foreign.length > 1 ? "s" : ""} ${foreign.join(", ")} not started by this session`,
      instruction: INSTRUCTION_RUNNING,
    };
  }
  return {
    step: 3,
    name: "workbench running",
    ok: true,
    detail:
      pids.length === 0
        ? "no Workbench running"
        : `running pid ${ours} was started by this session`,
  };
}

// ── Step 4: port owner ───────────────────────────────────────────────────────

export const INSTRUCTION_PORT =
  "Report it; do not kill processes this session did not start without the owner's word.";

/** Never terminates anything: it only reads the listener table. */
export function stepPortOwner(ctx: PreflightContext): StepResult {
  const reason = gate(ctx);
  if (reason) return notRun(4, "port owner", reason, `check who listens on TCP ${ctx.port}`);
  const pids = portListeners(ctx.exec, ctx.port);
  if (pids.length === 0)
    return { step: 4, name: "port owner", ok: true, detail: `port ${ctx.port} is free` };
  const ours = ctx.lane.recordedPid();
  const owners = pids.map((pid) => ({
    pid,
    image: processByPid(ctx.exec, pid)?.image ?? "unknown",
  }));
  const described = owners.map((o) => `${o.image} pid ${o.pid}`).join(", ");
  const crash = owners.find((o) => o.image.toLowerCase() === CRASH_REPORTER_IMAGE.toLowerCase());
  if (crash) {
    return {
      step: 4,
      name: "port owner",
      ok: false,
      detail: `port ${ctx.port} is held by an orphaned ${CRASH_REPORTER_IMAGE} (pid ${crash.pid})`,
      instruction: INSTRUCTION_PORT,
    };
  }
  if (owners.every((o) => o.pid === ours)) {
    return {
      step: 4,
      name: "port owner",
      ok: true,
      detail: `port held by our Workbench (${described})`,
    };
  }
  return {
    step: 4,
    name: "port owner",
    ok: false,
    detail: `port ${ctx.port} is held by ${described}`,
    instruction: INSTRUCTION_PORT,
  };
}

// ── Step 5: registry export ──────────────────────────────────────────────────

export const INSTRUCTION_REGISTRY =
  "Export the Workbench registry key to the artifacts folder (outside the repo) before any launch: " +
  "it is the restore point. Pass --registry-key <key>; the key name is not recorded in this " +
  "repository [unverified].";

/** Only per-user keys are exported. */
export function validateRegistryKey(key: string): string {
  if (!/^(HKCU|HKEY_CURRENT_USER)\\[^\0"]+$/i.test(key)) {
    throw new Error(`Refusing registry key outside HKCU: ${key}`);
  }
  return key;
}

export function stepRegistryExport(ctx: PreflightContext): StepResult {
  const name = "registry export";
  const key = ctx.registryKey;
  const target = join(ctx.artifactsDir, `registry-before-${stamp(ctx.now())}.reg`);
  const reason = gate(ctx);
  if (reason) {
    return notRun(
      5,
      name,
      reason,
      `run reg export ${key ?? "<registry key [unverified]>"} ${target}`,
    );
  }
  if (!key)
    return {
      step: 5,
      name,
      ok: false,
      detail: "no registry key given",
      instruction: INSTRUCTION_REGISTRY,
    };
  try {
    validateRegistryKey(key);
    mkdirSync(ctx.artifactsDir, { recursive: true });
    // Read-only on the registry; writes only the new export file (no /y: never overwrite).
    ctx.exec("reg", ["export", key, target]);
  } catch (e) {
    return {
      step: 5,
      name,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      instruction: INSTRUCTION_REGISTRY,
    };
  }
  ctx.state.registryExport = target;
  return { step: 5, name, ok: true, detail: `exported ${key} to ${target}` };
}

// ── Step 6: snapshot and handler set ─────────────────────────────────────────

export const INSTRUCTION_SNAPSHOT =
  "Take the sandbox snapshot. Confirm which handler set is about to be installed and that the " +
  "Enforce lint passed on it, or that every finding on that set is in the triage list recorded in " +
  "DECISIONS.md.";

/** Which handler set this variant would install. */
export function declaredHandlerSet(ctx: PreflightContext): string {
  if (ctx.variant === "headless-cli") return "none (headless CLI: no handler and no NET call)";
  if (ctx.variant === "launcher-walk") return "none (launcher walk: no project is opened)";
  if (ctx.variant === "scratch-profile")
    return "none (scratch-profile bootstrap: nothing else rides on the launch)";
  const n = existsSync(BUNDLED_HANDLER_DIR) ? handlerFiles(BUNDLED_HANDLER_DIR).length : 0;
  const shipped = `shipped handler set (mod/Scripts/WorkbenchGame/EnfusionMCP, ${n} files)`;
  return ctx.probePack ? `${shipped} plus the development probe pack from mod-dev/` : shipped;
}

function defaultSnapshotPaths(sandboxDir: string): string[] {
  return readdirSync(sandboxDir)
    .filter((n) => n !== ".git")
    .sort();
}

export function stepSnapshot(ctx: PreflightContext): StepResult {
  const name = "snapshot";
  if (!existsSync(ctx.sandboxDir) || !statSync(ctx.sandboxDir).isDirectory()) {
    return {
      step: 6,
      name,
      ok: false,
      detail: `sandbox ${ctx.sandboxDir} not found (create it with scripts/live/create-sandbox.ts)`,
      instruction: INSTRUCTION_SNAPSHOT,
    };
  }
  const declared = ctx.snapshotPaths ?? defaultSnapshotPaths(ctx.sandboxDir);
  const snap = takeSnapshot(ctx.sandboxDir, declared, ctx.now());
  ctx.state.snapshot = snap;
  const handlerSet = declaredHandlerSet(ctx);
  const needsLint = handlerSet.startsWith("shipped");
  if (needsLint && ctx.lint === null) {
    return {
      step: 6,
      name,
      ok: false,
      detail: `handler set: ${handlerSet}; Enforce lint result not confirmed (--lint passed|triaged)`,
      instruction: INSTRUCTION_SNAPSHOT,
    };
  }
  let written = "";
  if (ctx.really && ctx.lane.holdsLease()) {
    mkdirSync(ctx.artifactsDir, { recursive: true });
    const file = join(ctx.artifactsDir, `snapshot-before-${stamp(ctx.now())}.json`);
    writeFileSync(file, JSON.stringify(snap, null, 2) + "\n", { encoding: "utf-8", flag: "wx" });
    ctx.state.snapshotFile = file;
    written = `; manifest ${file}`;
  }
  const lint = needsLint ? `; Enforce lint ${ctx.lint}` : "";
  return {
    step: 6,
    name,
    ok: true,
    detail: `${Object.keys(snap.files).length} files under ${declared.length} declared paths; handler set: ${handlerSet}${lint}${written}`,
  };
}

// ── Step 7: probe queue ──────────────────────────────────────────────────────

export const INSTRUCTION_QUEUE =
  "Load the session's probe queue (docs/v2/sessions/NNN-queue.json): ordered probes, each with a " +
  "timeout, expected result, kill criterion, expected side effects, rollback and risk class. Order " +
  "within a session: read-only, then reversible, then mutating. Anything above mutating needs the " +
  "owner's explicit yes in chat for that session.";

/** Validate a probe queue. Returns the probes or throws with the first problem. */
export function validateQueue(raw: unknown, ownerYesAboveMutating: boolean): QueuedProbe[] {
  const list = Array.isArray(raw) ? raw : (raw as { probes?: unknown })?.probes;
  if (!Array.isArray(list) || list.length === 0) throw new Error("queue holds no probes");
  let lastRank = 0;
  const seen = new Set<string>();
  // A queue over several launches (S-E) gives each probe a `launch`: the order is checked within
  // each launch, and each launch's probes must be contiguous. Either every probe carries one or
  // none does: a partly tagged queue would let an untagged probe slip past the per-launch order.
  const tagged = list.filter((p) => p && (p as { launch?: unknown }).launch !== undefined).length;
  if (tagged !== 0 && tagged !== list.length)
    throw new Error(`queue: ${tagged} of ${list.length} probes carry a launch; all or none must`);
  let lastLaunch: unknown = undefined;
  const launchesSeen = new Set<unknown>();
  return list.map((p, i) => {
    const q = p as Partial<QueuedProbe> & { launch?: unknown };
    const where = `probe ${i}${q?.id ? ` (${q.id})` : ""}`;
    if (q && q.launch !== undefined && q.launch !== lastLaunch) {
      if (launchesSeen.has(q.launch))
        throw new Error(`${where}: launch ${String(q.launch)} is not contiguous`);
      launchesSeen.add(q.launch);
      lastLaunch = q.launch;
      lastRank = 0;
    }
    if (!q || typeof q.id !== "string" || !q.id) throw new Error(`${where}: missing id`);
    if (seen.has(q.id)) throw new Error(`${where}: duplicate id`);
    seen.add(q.id);
    if (typeof q.timeout_ms !== "number" || !(q.timeout_ms > 0))
      throw new Error(`${where}: missing timeout_ms`);
    for (const k of ["expected", "kill_criterion", "rollback", "risk_class"] as const) {
      if (typeof q[k] !== "string" || !q[k]) throw new Error(`${where}: missing ${k}`);
    }
    if (!Array.isArray(q.side_effects)) throw new Error(`${where}: side_effects must be a list`);
    const idx = (PROBE_ORDER as readonly string[]).indexOf(q.risk_class!);
    const rank = idx === -1 ? PROBE_ORDER.length : idx;
    if (idx === -1 && !ownerYesAboveMutating) {
      throw new Error(
        `${where}: risk class ${q.risk_class} is above mutating and has no owner yes`,
      );
    }
    if (rank < lastRank)
      throw new Error(`${where}: out of order (read-only, reversible, mutating)`);
    lastRank = rank;
    return q as QueuedProbe;
  });
}

/**
 * The sessions whose queue may run with the mutating probe pack installed (plan 5.4 item 7):
 * S-E (train #1b) and P3-3 (train #2, DEC-051: the tiny world is created by the pack's
 * createSandboxWorlds as in S-E) and P4-1 (the first Phase 4 sitting creates the tiny world on
 * its first launch with the same pack). Kept as a list so the message can name them.
 */
export const PROBE_MUT_SESSIONS: readonly string[] = ["S-E", "P3-3", "P4-1", "P4-5", "P4-8"];
/** @deprecated the first entry, for callers that read one name. */
export const PROBE_MUT_SESSION = PROBE_MUT_SESSIONS[0];

export const INSTRUCTION_PROBE_MUT =
  "The mutating probe pack is installed only for the session that needs it (plan 5.4 item 7): " +
  "remove <sandbox>/Scripts/WorkbenchGame/EnfusionCensus/ECEN_ProbeMut*.c (S-E's post-flight, " +
  "postflight.ts --remove-probe-mut) before any other session launches.";

/**
 * Why a launch is refused because the mutating probe pack is in the sandbox,
 * or null. Allowed only when the loaded queue names session S-E or P3-3.
 */
export function probeMutRefusal(ctx: PreflightContext): string | null {
  const files = probeMutFiles(ctx.sandboxDir);
  if (files.length === 0) return null;
  const session = ctx.state.queueSession ?? null;
  if (session !== null && PROBE_MUT_SESSIONS.includes(session)) return null;
  return (
    `the mutating probe pack is installed in the sandbox (${files.join(", ")}) and the queue is ` +
    `${session ? `session ${session}'s` : "no session's"}, not ${PROBE_MUT_SESSIONS.join(" or ")}'s; a launch is refused`
  );
}

/** S-A's U14 throwaway folder (defined in launch.ts, whose installer refuses it too). */
export { U14_THROWAWAY_FOLDER, U3_PLANT_FOLDER };

export const INSTRUCTION_U14_THROWAWAY =
  "S-A's U14 throwaway copy is still in the sandbox: a step ended before its rollback. Treat it as " +
  "a harness error: with no Workbench running, run `s-a-headless.ts rollback --run <the run that " +
  "planted it> --id <lane id> --really`, check `git -C <sandbox> status --short`, and launch " +
  "nothing until the folder is gone.";

/**
 * Why a session is refused because S-A's U14 throwaway folder is in the sandbox, or
 * null. Allowed only for S-A resuming its own open plant (`ownU14Plant`).
 */
export function u14ThrowawayRefusal(ctx: PreflightContext): string | null {
  const folder = join(ctx.sandboxDir, "Scripts", "WorkbenchGame", U14_THROWAWAY_FOLDER);
  if (!existsSync(folder)) return null;
  if (ctx.state.queueSession === "S-A" && ctx.ownU14Plant === true) return null;
  return (
    `the sandbox holds Scripts/WorkbenchGame/${U14_THROWAWAY_FOLDER} (S-A's U14 throwaway copy, ` +
    "not rolled back); a launch is refused"
  );
}

export const INSTRUCTION_U3_PLANT =
  "S-C's U3 plant is still in the sandbox: step sc-15 ended before its removal. Treat it as a " +
  "harness error: with no Workbench running, run `s-c-natives.ts rollback --run-dir <the run that " +
  "planted it> --id <lane id> --really`, check `git -C <sandbox> status --short`, and launch " +
  "nothing until the folder is gone (the next launch would compile the planted syntax error).";

/**
 * Why a session is refused because S-C's U3 plant folder (`Scripts/WorkbenchGame/EnfusionCensusU3`)
 * is in the sandbox, or null (DEC-032, S-C read B1). No exception: S-C plants it mid-step, after
 * its pre-flight, and removes it in the same step.
 */
export function u3PlantRefusal(ctx: PreflightContext): string | null {
  const folder = join(ctx.sandboxDir, "Scripts", "WorkbenchGame", U3_PLANT_FOLDER);
  if (!existsSync(folder)) return null;
  return (
    `the sandbox holds Scripts/WorkbenchGame/${U3_PLANT_FOLDER} (S-C's U3 plant, not removed); ` +
    "a launch is refused"
  );
}

export function stepProbeQueue(ctx: PreflightContext): StepResult {
  const name = "probe queue";
  if (!ctx.queuePath) {
    return {
      step: 7,
      name,
      ok: false,
      detail: "no probe queue given (--queue)",
      instruction: INSTRUCTION_QUEUE,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(ctx.queuePath, "utf-8")) as unknown;
    const queue = validateQueue(raw, ctx.ownerYesAboveMutating);
    ctx.state.queue = queue;
    const session =
      raw && !Array.isArray(raw) && typeof (raw as { session?: unknown }).session === "string"
        ? (raw as { session: string }).session
        : null;
    ctx.state.queueSession = session;
    const counts = PROBE_ORDER.map((r) => `${queue.filter((q) => q.risk_class === r).length} ${r}`);
    const detail = `${queue.length} probes: ${counts.join(", ")}${session ? ` (session ${session})` : ""}`;
    const refusal = probeMutRefusal(ctx);
    if (refusal) {
      return {
        step: 7,
        name,
        ok: false,
        detail: `${detail}; ${refusal}`,
        instruction: INSTRUCTION_PROBE_MUT,
      };
    }
    const u14 = u14ThrowawayRefusal(ctx);
    if (u14) {
      return {
        step: 7,
        name,
        ok: false,
        detail: `${detail}; ${u14}`,
        instruction: INSTRUCTION_U14_THROWAWAY,
      };
    }
    const u3 = u3PlantRefusal(ctx);
    if (u3) {
      return {
        step: 7,
        name,
        ok: false,
        detail: `${detail}; ${u3}`,
        instruction: INSTRUCTION_U3_PLANT,
      };
    }
    return { step: 7, name, ok: true, detail };
  } catch (e) {
    return {
      step: 7,
      name,
      ok: false,
      detail: `${ctx.queuePath}: ${e instanceof Error ? e.message : String(e)}`,
      instruction: INSTRUCTION_QUEUE,
    };
  }
}

// ── Step 8: launch ───────────────────────────────────────────────────────────

export const INSTRUCTION_LAUNCH =
  'Launch with the proven form: -gproj "<sandbox gproj>" as separate arguments, working directory ' +
  "<game>, plus -forceSettings <scratch.ini> once U12 has passed.";

/** CLI switches on any policy deny list, lower case (the shared rule of policy.ts). */
export function deniedSwitches(policy: CensusPolicy = loadPolicy()): string[] {
  return deniedSwitchNames(policy);
}

/**
 * Names (lower case, without the dash) of the switches an extra launch argument
 * may not carry: they change the project or the settings file. A matcher, never
 * an argv; written without the dash so the flag test counts only passed switches.
 */
export const EXTRA_ARG_REFUSED = ["gproj", "wbprojectpath", "forcesettings", "addonsdir"];

/** Why the extra launch arguments are refused, or null. */
export function extraArgsRefusal(args: readonly string[], policy?: CensusPolicy): string | null {
  for (const a of args) {
    if (typeof a !== "string" || a.length === 0) return "an extra launch argument is empty";
    const name = a.split("=")[0].replace(/^-+/, "").toLowerCase();
    if (a.startsWith("-") && EXTRA_ARG_REFUSED.includes(name)) {
      return `extra launch argument ${a} would change the project or the settings file`;
    }
  }
  const bad = deniedSwitch(args, policy ?? loadPolicy());
  return bad ? `launch argument ${bad} is on a policy deny list` : null;
}

/**
 * Why a real run's `--force-settings` file is refused, or null (DEC-038, S-C read m-4): it must
 * exist and its resolved path must lie inside the artifacts folder, never in a git tree.
 */
export function forceSettingsFileRefusal(path: string, artifactsRoot: string): string | null {
  const abs = resolve(path);
  const rel = relative(resolve(artifactsRoot), abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return `--force-settings ${abs} is not inside the artifacts folder ${artifactsRoot}`;
  }
  if (insideGitWorkTree(abs)) return `--force-settings ${abs} lies inside a git working tree`;
  if (!existsSync(abs)) return `--force-settings ${abs} does not exist`;
  return null;
}

/** The one development-only switch an owner's go may put on a launch (plan 5.7, DEC-041). */
export const SCRIPT_AUTHORIZE_ALL = "-scriptAuthorizeAll";

/** What step 8 and the lease purpose record when that switch rides on the launch. */
export const SCRIPT_AUTHORIZE_ALL_NOTE = "`-scriptAuthorizeAll` on the owner's go (DEC-041)";

/**
 * Why `--script-authorize-all` is refused, or null when it is not asked for or is accepted. It is
 * accepted only in the default variant, with --owner-go-script-authorize-all, --u12-passed and
 * --force-settings (the scratch profile; never the owner's registry profile).
 */
export function scriptAuthorizeAllRefusal(ctx: PreflightContext): string | null {
  if (ctx.scriptAuthorizeAll !== true) return null;
  const why =
    "-scriptAuthorizeAll is development-only and rides on a launch only on the owner's go " +
    "(plan 5.7, sitting S-D)";
  if (ctx.variant !== "default") return `${why}: only in the default variant, not ${ctx.variant}`;
  if (ctx.ownerGoScriptAuthorizeAll !== true) {
    return `${why}: --script-authorize-all needs --owner-go-script-authorize-all`;
  }
  if (!ctx.u12Passed || ctx.forceSettings === undefined) {
    return (
      `${why}: it needs --u12-passed with --force-settings <ini> (the scratch profile, never ` +
      "the owner's registry profile)"
    );
  }
  return null;
}

/** True when `-scriptAuthorizeAll` was asked for and is accepted. */
export function scriptAuthorizeAllAccepted(ctx: PreflightContext): boolean {
  return ctx.scriptAuthorizeAll === true && scriptAuthorizeAllRefusal(ctx) === null;
}

/** The lease purpose: the session's, plus the owner's-go note when the switch is accepted. */
export function leasePurpose(ctx: PreflightContext): string {
  return scriptAuthorizeAllAccepted(ctx)
    ? `${ctx.purpose} [${SCRIPT_AUTHORIZE_ALL_NOTE}]`
    : ctx.purpose;
}

/** The launch plan for this variant, or an error text. */
export function variantLaunch(ctx: PreflightContext): LaunchPlan | string {
  const extra = ctx.extraArgs ?? [];
  const saa = scriptAuthorizeAllRefusal(ctx);
  if (saa) return saa;
  if (extra.length > 0 && ctx.variant !== "scratch-profile") {
    return "extra launch arguments (--extra-args) are only for the scratch-profile variant";
  }
  if (ctx.really && ctx.forceSettings !== undefined) {
    const refused = forceSettingsFileRefusal(ctx.forceSettings, ctx.artifactsDir);
    if (refused) return refused;
  }
  switch (ctx.variant) {
    case "default": {
      if (ctx.forceSettings !== undefined && !ctx.u12Passed) {
        return "-forceSettings is used only once U12 has passed (use the scratch-profile variant for S-B)";
      }
      const plan = buildLaunch({
        workbenchPath: ctx.workbenchPath,
        gamePath: ctx.gamePath,
        gproj: ctx.gproj,
        forceSettings: ctx.forceSettings,
      });
      const args = scriptAuthorizeAllAccepted(ctx)
        ? [...plan.args, SCRIPT_AUTHORIZE_ALL]
        : plan.args;
      // The deny lists still hold for every other token; the owner's go lifts this one only.
      const checked = scriptAuthorizeAllAccepted(ctx)
        ? args.filter((a) => a !== SCRIPT_AUTHORIZE_ALL)
        : args;
      const bad = deniedSwitch(checked, loadPolicy());
      if (bad) return `launch argument ${bad} is on a policy deny list`;
      if (args === plan.args) return plan;
      return { ...plan, args, commandLine: formatCommandLine(plan.exe, args) };
    }
    case "scratch-profile": {
      if (ctx.forceSettings === undefined)
        return "the scratch-profile variant needs --force-settings <ini>";
      const refused = extraArgsRefusal(extra);
      if (refused) return refused;
      const plan = buildLaunch({
        workbenchPath: ctx.workbenchPath,
        gamePath: ctx.gamePath,
        gproj: ctx.gproj,
        forceSettings: ctx.forceSettings,
      });
      if (extra.length === 0) return plan;
      const args = [...plan.args, ...extra];
      return { ...plan, args, commandLine: formatCommandLine(plan.exe, args) };
    }
    case "headless-cli": {
      if (!ctx.launcherKnowsSandbox) {
        return (
          "entry condition not met: the sandbox must already be known to the launcher (the owner " +
          "opened it once, OA-3); confirm with --launcher-knows-sandbox"
        );
      }
      const bad = deniedSwitch(ctx.headlessArgs, loadPolicy());
      if (bad) return `launch argument ${bad} is on a policy deny list`;
      const plan = buildLaunch({
        workbenchPath: ctx.workbenchPath,
        gamePath: ctx.gamePath,
        gproj: ctx.gproj,
      });
      const args = [...plan.args, ...ctx.headlessArgs];
      return { ...plan, args, commandLine: formatCommandLine(plan.exe, args) };
    }
    case "launcher-walk":
      return buildLaunch({ workbenchPath: ctx.workbenchPath, gamePath: ctx.gamePath, gproj: null });
  }
}

export function stepLaunch(ctx: PreflightContext): StepResult {
  const name = "launch";
  const mut = probeMutRefusal(ctx);
  if (mut) return { step: 8, name, ok: false, detail: mut, instruction: INSTRUCTION_PROBE_MUT };
  const u14 = u14ThrowawayRefusal(ctx);
  if (u14) return { step: 8, name, ok: false, detail: u14, instruction: INSTRUCTION_U14_THROWAWAY };
  const u3 = u3PlantRefusal(ctx);
  if (u3) return { step: 8, name, ok: false, detail: u3, instruction: INSTRUCTION_U3_PLANT };
  const plan = variantLaunch(ctx);
  if (typeof plan === "string")
    return { step: 8, name, ok: false, detail: plan, instruction: INSTRUCTION_LAUNCH };
  ctx.state.launch = plan;
  const reason = gate(ctx);
  const notes =
    (ctx.variant === "headless-cli" ? "; the Enter nudge is not used" : "") +
    (scriptAuthorizeAllAccepted(ctx) ? `; ${SCRIPT_AUTHORIZE_ALL_NOTE}` : "");
  if (reason) return notRun(8, name, reason, `start ${plan.commandLine} in ${plan.cwd}${notes}`);
  const gproj = ctx.variant === "launcher-walk" ? null : ctx.gproj;
  const pid = spawnWorkbench(plan, ctx.lane, gproj);
  ctx.state.startedPid = pid;
  ctx.state.launchedAt = Date.now();
  return { step: 8, name, ok: true, detail: `started pid ${pid}: ${plan.commandLine}${notes}` };
}

// ── Step 9: opened-project assertion ─────────────────────────────────────────

/**
 * How long step 9 waits for the session log to name the opened project (DEC-029). Shared: S-C's
 * relaunch (sc-09) waits as long (DEC-032, S-C read m5).
 */
export const ASSERT_WAIT_MS = 180_000;

export const INSTRUCTION_ASSERT =
  "Assert that the opened project is the sandbox. Abort and close Workbench if it is not the " +
  "sandbox. Re-check after any relaunch or launcher nudge.";

export const INSTRUCTION_ASSERT_HEADLESS =
  "If a launcher window appears or a project other than the sandbox opens, kill the process this " +
  "session started and record which of three results it was: launcher held on an unregistered " +
  "project, flag ignored, or wrong project opened.";

export const INSTRUCTION_ASSERT_WALK =
  "The launcher window must be the foreground window and no project open. Enter is never pressed. " +
  "The session ends by closing the launcher.";

/**
 * The opened project named in a session log, by the recorded pattern (its
 * first capture group). Null when no line matches.
 */
export function openedProjectFromLog(logText: string, pattern: string): string | null {
  const re = new RegExp(pattern, "m");
  const m = re.exec(logText);
  return m ? (m[1] ?? m[0]).trim() : null;
}

/**
 * A captured project as a project NAME: E13's capture is already one (the
 * folder under Projects/); a `.gproj` path becomes its project name
 * (`projectNameOfGproj`), any other path its last segment.
 */
export function capturedProjectName(captured: string): string {
  const fromGproj = projectNameOfGproj(captured);
  if (fromGproj) return fromGproj;
  const segs = captured
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .split(/[\\/]+/)
    .filter(Boolean);
  return segs.length ? segs[segs.length - 1] : captured.trim();
}

/** True when the captured project is the project of `gproj`, case ignored. */
export function sameProject(captured: string, gproj: string): boolean {
  const want = projectNameOfGproj(gproj);
  return want !== null && capturedProjectName(captured).toLowerCase() === want.toLowerCase();
}

/** PowerShell: foreground window title and owning pid, as JSON. */
export const FOREGROUND_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Text; using System.Runtime.InteropServices;",
  "public static class EmcpForeground {",
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  "}",
  "'@",
  "$h = [EmcpForeground]::GetForegroundWindow()",
  "$sb = New-Object System.Text.StringBuilder 512",
  "[void][EmcpForeground]::GetWindowText($h, $sb, 512)",
  "$fpid = [uint32]0",
  "[void][EmcpForeground]::GetWindowThreadProcessId($h, [ref]$fpid)",
  "[pscustomobject]@{ title = $sb.ToString(); pid = $fpid } | ConvertTo-Json -Compress",
].join("\n");

export async function stepAssertProject(ctx: PreflightContext): Promise<StepResult> {
  const name = "assert project";
  const instruction =
    ctx.variant === "headless-cli"
      ? INSTRUCTION_ASSERT_HEADLESS
      : ctx.variant === "launcher-walk"
        ? INSTRUCTION_ASSERT_WALK
        : INSTRUCTION_ASSERT;
  const reason = gate(ctx);
  if (ctx.variant === "launcher-walk") {
    if (reason) {
      return notRun(
        9,
        name,
        reason,
        `assert the foreground window is "${LAUNCHER_WINDOW_TITLE}" and no project is open`,
      );
    }
    const r = await ctx.powershell(FOREGROUND_SCRIPT);
    const line = r.ok ? lastLine(r.stdout) : null;
    const fg = line ? (JSON.parse(line) as { title: string; pid: number }) : null;
    const ok =
      fg !== null &&
      fg.pid === ctx.state.startedPid &&
      fg.title.toLowerCase().includes(LAUNCHER_WINDOW_TITLE.toLowerCase());
    return {
      step: 9,
      name,
      ok,
      detail: fg
        ? `foreground: "${fg.title}" (pid ${fg.pid})`
        : `could not read the foreground window: ${r.error}`,
      instruction: ok ? undefined : instruction,
    };
  }
  const want = projectNameOfGproj(ctx.gproj) ?? ctx.gproj;
  if (reason) {
    return notRun(
      9,
      name,
      reason,
      `assert from the session log that the opened project is ${want} (${ctx.gproj})`,
    );
  }
  const pattern = ctx.openedProjectPattern ?? OPENED_PROJECT_PATTERN;
  const auto = ctx.sessionLogAuto === true && ctx.state.launchedAt !== undefined;
  if (!auto && !ctx.sessionLog) {
    return {
      step: 9,
      name,
      ok: false,
      detail: "no session log to read (--session-log, or a logs folder to search after the launch)",
      instruction,
    };
  }
  // Read until the line appears or the deadline passes. An automatic log must
  // be born after this lane's spawn, or the assertion would read the PREVIOUS
  // session's log; a log named on the command line is read as given.
  const clock = ctx.clock ?? Date.now;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = clock() + (ctx.assertWaitMs ?? ctx.logWaitMs ?? ASSERT_WAIT_MS);
  const pollMs = ctx.pollMs ?? 1_000;
  let logPath: string | null = auto ? null : ctx.sessionLog;
  let opened: string | null = null;
  for (;;) {
    if (auto) logPath = newestSessionLog(ctx.logsPath ?? "", ctx.state.launchedAt) ?? logPath;
    if (logPath && existsSync(logPath)) {
      opened = openedProjectFromLog(readFileSync(logPath, "utf-8"), pattern);
      if (opened !== null) break;
    }
    if (clock() >= deadline) break;
    await sleep(pollMs);
  }
  if (opened === null) {
    return {
      step: 9,
      name,
      ok: false,
      detail: !logPath
        ? "no session log born after this launch appeared before the deadline; refusing to read an older one"
        : "no line in the session log named an opened project before the deadline",
      instruction,
    };
  }
  const ok = sameProject(opened, ctx.gproj);
  return {
    step: 9,
    name,
    ok,
    detail: ok
      ? `session log names ${opened}, the sandbox project ${want}`
      : `session log names ${opened}, not the sandbox project ${want}`,
    instruction: ok ? undefined : instruction,
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export const PREFLIGHT_STEPS: readonly PreflightStep[] = [
  stepLease,
  stepToolsBuild,
  stepWorkbenchRunning,
  stepPortOwner,
  stepRegistryExport,
  stepSnapshot,
  stepProbeQueue,
  stepLaunch,
  stepAssertProject,
];

/** Run the steps in order; stop at the first failure. */
export async function runPreflight(
  ctx: PreflightContext,
  steps: readonly PreflightStep[] = PREFLIGHT_STEPS,
): Promise<{ ok: boolean; results: StepResult[] }> {
  const results: StepResult[] = [];
  for (const step of steps) {
    let r: StepResult;
    try {
      r = await step(ctx);
    } catch (e) {
      r = {
        step: results.length + 1,
        name: "error",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
    results.push(r);
    if (!r.ok) {
      // Plan 5.3 step 9: abort AND close the Workbench this lane started.
      if (ctx.state.startedPid !== undefined && ctx.onAbort) {
        try {
          r.detail += `; abort: ${await ctx.onAbort(ctx)}`;
        } catch (e) {
          r.detail += `; abort failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      return { ok: false, results };
    }
  }
  return { ok: true, results };
}

export function formatStep(r: StepResult): string {
  const status = !r.ok ? "FAIL" : r.skipped ? "skip" : "ok  ";
  const lines = [`[${status}] ${r.step} ${r.name}: ${r.detail}`];
  if (!r.ok && r.instruction) lines.push(`       plan: ${r.instruction}`);
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/**
 * The newest `logs_*` directory's console.log under `logsPath`, or null. With
 * `createdAfter`, only a folder BORN at or after that time counts: a folder's
 * change time moves when anything writes into it (a crash reporter writing
 * into an older session's folder after a kill), so it never qualifies a
 * folder. A folder whose birth time cannot be read does not qualify either.
 */
export function newestSessionLog(logsPath: string, createdAfter?: number): string | null {
  if (!logsPath || !existsSync(logsPath)) return null;
  const dirs = readdirSync(logsPath)
    .filter((d) => d.startsWith("logs_"))
    .sort();
  for (let i = dirs.length - 1; i >= 0; i--) {
    const f = join(logsPath, dirs[i], "console.log");
    if (!existsSync(f)) continue;
    if (createdAfter !== undefined) {
      let born: number;
      try {
        born = statSync(join(logsPath, dirs[i])).birthtimeMs;
      } catch {
        continue;
      }
      if (!(born >= createdAfter)) continue;
    }
    return f;
  }
  return null;
}

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, [
      "variant",
      "purpose",
      "id",
      "sandbox",
      "gproj",
      "queue",
      "lint",
      "snapshot-paths",
      "registry-key",
      "force-settings",
      "headless-args",
      "extra-args",
      "until",
      "opened-project-pattern",
      "session-log",
      "assert-wait-ms",
      "log-wait-ms",
      "ledger-meta",
      "workbench-path",
      "game-path",
      "lease-path",
      "marker-path",
    ]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  const variant = (o.variant ?? "default") as PreflightVariant;
  if (!PREFLIGHT_VARIANTS.includes(variant)) {
    console.error(`Unknown variant ${o.variant}; one of ${PREFLIGHT_VARIANTS.join(", ")}`);
    return 2;
  }
  if (!o.purpose) {
    console.error("preflight needs --purpose <text>");
    return 2;
  }
  if (o.lint !== undefined && o.lint !== "passed" && o.lint !== "triaged") {
    console.error("--lint must be passed or triaged");
    return 2;
  }
  const until = o.until === undefined ? PREFLIGHT_STEPS.length : Number(o.until);
  if (!Number.isInteger(until) || until < 1 || until > PREFLIGHT_STEPS.length) {
    console.error(`--until must be a step number from 1 to ${PREFLIGHT_STEPS.length}`);
    return 2;
  }
  for (const k of ["assert-wait-ms", "log-wait-ms"]) {
    if (o[k] !== undefined && !(Number.isInteger(Number(o[k])) && Number(o[k]) > 0)) {
      console.error(`--${k} must be a positive integer`);
      return 2;
    }
  }
  // Every printed path in placeholder form (plan 5.2; DEC-032, S-C read m6), the catch included.
  let ph: PlaceholderContext = defaultPlaceholderContext({ v2: REPO_ROOT });
  const say = (s: string): void => console.log(toPlaceholders(s, ph));
  try {
    const needConfig = !o["workbench-path"] || !o["game-path"] || !o.sandbox || !o["session-log"];
    const config = needConfig ? loadConfig() : null;
    const sandboxDir = o.sandbox ?? join(config!.projectPath, SANDBOX_NAME);
    ph = defaultPlaceholderContext({
      v2: REPO_ROOT,
      sandbox: resolve(sandboxDir),
      tools: o["workbench-path"] ?? config!.workbenchPath,
      game: o["game-path"] ?? config!.gamePath,
    });
    const jsonList = (flag: string): string[] => {
      const v = o[flag] ? (JSON.parse(o[flag]) as unknown) : [];
      if (!Array.isArray(v) || !v.every((a) => typeof a === "string")) {
        throw new Error(`--${flag} must be a JSON array of strings`);
      }
      return v as string[];
    };
    const headlessArgs = jsonList("headless-args");
    const extraArgs = jsonList("extra-args");
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    const ctx: PreflightContext = {
      variant,
      lane,
      purpose: o.purpose,
      really: args.flags.has("really"),
      platform: process.platform,
      workbenchPath: o["workbench-path"] ?? config!.workbenchPath,
      gamePath: o["game-path"] ?? config!.gamePath,
      port: config?.workbenchPort ?? 5775,
      sandboxDir,
      gproj:
        o.gproj ??
        (o.sandbox
          ? join(o.sandbox, `${SANDBOX_NAME}.gproj`)
          : defaultSandboxGproj(config!.projectPath)),
      artifactsDir: artifactsDir(),
      ledgerMetaPath: o["ledger-meta"] ?? join(REPO_ROOT, "data", "census", "ledger.meta.json"),
      queuePath: o.queue ?? null,
      snapshotPaths: o["snapshot-paths"]
        ? o["snapshot-paths"]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null,
      registryKey: o["registry-key"] ?? process.env.ENFUSION_WB_REGISTRY_KEY ?? null,
      forceSettings: o["force-settings"],
      u12Passed: args.flags.has("u12-passed"),
      lint: (o.lint as "passed" | "triaged" | undefined) ?? null,
      probePack: args.flags.has("probe-pack"),
      headlessArgs,
      extraArgs,
      launcherKnowsSandbox: args.flags.has("launcher-knows-sandbox"),
      ownerYesAboveMutating: args.flags.has("owner-yes-above-mutating"),
      // Only these two switches: never --extra-args, the environment or the config (plan 5.7).
      scriptAuthorizeAll: args.flags.has("script-authorize-all"),
      ownerGoScriptAuthorizeAll: args.flags.has("owner-go-script-authorize-all"),
      openedProjectPattern: o["opened-project-pattern"] ?? null,
      sessionLog: o["session-log"] ?? (config ? newestSessionLog(config.logsPath) : null),
      sessionLogAuto: o["session-log"] === undefined,
      logsPath: config?.logsPath ?? null,
      assertWaitMs: o["assert-wait-ms"] ? Number(o["assert-wait-ms"]) : undefined,
      logWaitMs: o["log-wait-ms"] ? Number(o["log-wait-ms"]) : undefined,
      exec: defaultExec,
      powershell: (script, env) => runPowerShell(script, { env }),
      now: () => new Date(),
      state: {},
    };
    const saa = scriptAuthorizeAllRefusal(ctx);
    if (saa) {
      console.error(toPlaceholders(saa, ph));
      return 2;
    }
    const partial = until < PREFLIGHT_STEPS.length ? `, steps 1 to ${until}` : "";
    say(
      `pre-flight (${variant}${partial}) for lane ${lane.session}${ctx.really ? "" : " [dry run]"}`,
    );
    const r = await runPreflight(ctx, PREFLIGHT_STEPS.slice(0, until));
    for (const s of r.results) say(formatStep(s));
    say(
      !r.ok
        ? "pre-flight STOPPED"
        : ctx.really
          ? `pre-flight passed${partial ? ` (steps 1 to ${until}; nothing was launched)` : ""}`
          : "pre-flight dry run passed (nothing was acquired, exported or launched)",
    );
    if (ctx.state.snapshotFile) say(`snapshot manifest: ${ctx.state.snapshotFile}`);
    if (ctx.state.registryExport) say(`registry export: ${ctx.state.registryExport}`);
    return r.ok ? 0 : 1;
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
