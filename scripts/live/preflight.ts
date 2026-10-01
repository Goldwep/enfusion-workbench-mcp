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
 *                    assert the opened project from the session log
 *   headless-cli     S-A: no handler, no NET call; the sandbox must already be
 *                    known to the launcher (OA-3); the launch arguments are the
 *                    ones under test; the Enter nudge is never used; assert the
 *                    project named in the session log
 *   scratch-profile  S-B: -forceSettings although U12 has not passed (it is the
 *                    thing under test); nothing else rides on the launch
 *   launcher-walk    L14: no -gproj; assert the launcher window is the
 *                    foreground window and no project is open; Enter is never
 *                    pressed
 *
 * Steps 3 and 4 never terminate anything. Every step that touches Workbench,
 * the registry, the desktop or a process runs only with --really, on win32,
 * with the lease held by this lane; otherwise it reports what it would do
 * (dry run) or `skipped` (not win32).
 *
 * [unverified] items, none of which this repository records: the Workbench
 * registry key name (passed in with --registry-key), the source of the UI
 * language, the field names of ledger.meta.json (written by the ledger
 * skeleton), the session-log line that names the opened project (E13; passed
 * in with --opened-project-pattern), and whether the launcher and Workbench
 * share one process image.
 *
 * Usage:
 *   npx tsx scripts/live/preflight.ts --variant <default|headless-cli|scratch-profile|launcher-walk>
 *       --purpose <text> --queue <NNN-queue.json> [--id <lane id>] [--sandbox <dir>]
 *       [--lint passed|triaged] [--probe-pack] [--snapshot-paths a,b] [--registry-key <key>]
 *       [--force-settings <ini>] [--u12-passed] [--headless-args <json array>]
 *       [--launcher-knows-sandbox] [--owner-yes-above-mutating]
 *       [--opened-project-pattern <regex>] [--session-log <console.log>]
 *       [--ledger-meta <path>] [--workbench-path <tools>] [--game-path <game>] [--really]
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { LAUNCHER_WINDOW_TITLE } from "../../src/workbench/launcher-nudge.js";
import { LeaseError } from "../../src/workbench/lease.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane, laneRefusal } from "./lane.js";
import {
  BUNDLED_HANDLER_DIR,
  WORKBENCH_EXE,
  buildLaunch,
  defaultSandboxGproj,
  formatCommandLine,
  handlerFiles,
  resolveWorkbenchExe,
  spawnWorkbench,
  type LaunchPlan,
} from "./launch.js";
import { REPO_ROOT, SANDBOX_NAME, artifactsDir } from "./paths.js";
import { loadPolicy } from "./policy.js";
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
  /** headless-cli entry condition: the owner opened the sandbox once (OA-3). */
  launcherKnowsSandbox: boolean;
  /** The owner said yes in chat to probes above `mutating` for this session. */
  ownerYesAboveMutating: boolean;
  /** Regex whose first capture group is the opened project (from DECISIONS.md, E13). */
  openedProjectPattern: string | null;
  /** Session console.log to read the opened project from. */
  sessionLog: string | null;
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
    queue?: QueuedProbe[];
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
      detail: `lease is available; would acquire it as ${ctx.lane.session} for "${ctx.purpose}"`,
    };
  }
  try {
    const lease = ctx.lane.start(ctx.purpose);
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
  return list.map((p, i) => {
    const q = p as Partial<QueuedProbe>;
    const where = `probe ${i}${q?.id ? ` (${q.id})` : ""}`;
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
    const queue = validateQueue(
      JSON.parse(readFileSync(ctx.queuePath, "utf-8")),
      ctx.ownerYesAboveMutating,
    );
    ctx.state.queue = queue;
    const counts = PROBE_ORDER.map((r) => `${queue.filter((q) => q.risk_class === r).length} ${r}`);
    return { step: 7, name, ok: true, detail: `${queue.length} probes: ${counts.join(", ")}` };
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

/** CLI switches on any policy deny list. */
function deniedSwitches(): string[] {
  const out: string[] = [];
  for (const list of Object.values(loadPolicy().deny_lists ?? {})) {
    if (list && Array.isArray(list.cli_switches)) out.push(...list.cli_switches);
  }
  return out.map((s) => s.toLowerCase());
}

/** The launch plan for this variant, or an error text. */
export function variantLaunch(ctx: PreflightContext): LaunchPlan | string {
  switch (ctx.variant) {
    case "default":
      if (ctx.forceSettings !== undefined && !ctx.u12Passed) {
        return "-forceSettings is used only once U12 has passed (use the scratch-profile variant for S-B)";
      }
      return buildLaunch({
        workbenchPath: ctx.workbenchPath,
        gamePath: ctx.gamePath,
        gproj: ctx.gproj,
        forceSettings: ctx.forceSettings,
      });
    case "scratch-profile":
      if (ctx.forceSettings === undefined)
        return "the scratch-profile variant needs --force-settings <ini>";
      return buildLaunch({
        workbenchPath: ctx.workbenchPath,
        gamePath: ctx.gamePath,
        gproj: ctx.gproj,
        forceSettings: ctx.forceSettings,
      });
    case "headless-cli": {
      if (!ctx.launcherKnowsSandbox) {
        return (
          "entry condition not met: the sandbox must already be known to the launcher (the owner " +
          "opened it once, OA-3); confirm with --launcher-knows-sandbox"
        );
      }
      const denied = deniedSwitches();
      const bad = ctx.headlessArgs.find((a) => denied.includes(a.split("=")[0].toLowerCase()));
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
  const plan = variantLaunch(ctx);
  if (typeof plan === "string")
    return { step: 8, name, ok: false, detail: plan, instruction: INSTRUCTION_LAUNCH };
  ctx.state.launch = plan;
  const reason = gate(ctx);
  const noNudge = ctx.variant === "headless-cli" ? "; the Enter nudge is not used" : "";
  if (reason) return notRun(8, name, reason, `start ${plan.commandLine} in ${plan.cwd}${noNudge}`);
  const gproj = ctx.variant === "launcher-walk" ? null : ctx.gproj;
  const pid = spawnWorkbench(plan, ctx.lane, gproj);
  ctx.state.startedPid = pid;
  return { step: 8, name, ok: true, detail: `started pid ${pid}: ${plan.commandLine}${noNudge}` };
}

// ── Step 9: opened-project assertion ─────────────────────────────────────────

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

function normPath(p: string): string {
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}

/**
 * The opened project named in a session log, by the recorded pattern (its
 * first capture group). Null when no line matches.
 */
export function openedProjectFromLog(logText: string, pattern: string): string | null {
  const re = new RegExp(pattern, "m");
  const m = re.exec(logText);
  return m ? (m[1] ?? m[0]).trim() : null;
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
  if (reason) {
    return notRun(
      9,
      name,
      reason,
      `assert from the session log that the opened project is ${ctx.gproj}`,
    );
  }
  if (!ctx.openedProjectPattern || !ctx.sessionLog) {
    return {
      step: 9,
      name,
      ok: false,
      detail:
        "no opened-project pattern or session log: the log line that names the opened project is " +
        "identified by the launch-log miner (E13) and recorded in DECISIONS.md [unverified]",
      instruction,
    };
  }
  const text = existsSync(ctx.sessionLog) ? readFileSync(ctx.sessionLog, "utf-8") : "";
  const opened = openedProjectFromLog(text, ctx.openedProjectPattern);
  const ok = opened !== null && normPath(opened) === normPath(ctx.gproj);
  return {
    step: 9,
    name,
    ok,
    detail: opened
      ? `session log names ${opened}`
      : "no line in the session log names an opened project",
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
    if (!r.ok) return { ok: false, results };
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

/** Newest `logs_*` directory's console.log under `logsPath`, or null. */
export function newestSessionLog(logsPath: string): string | null {
  if (!existsSync(logsPath)) return null;
  const dirs = readdirSync(logsPath)
    .filter((d) => d.startsWith("logs_"))
    .sort();
  for (let i = dirs.length - 1; i >= 0; i--) {
    const f = join(logsPath, dirs[i], "console.log");
    if (existsSync(f)) return f;
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
      "opened-project-pattern",
      "session-log",
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
  try {
    const needConfig = !o["workbench-path"] || !o["game-path"] || !o.sandbox || !o["session-log"];
    const config = needConfig ? loadConfig() : null;
    const sandboxDir = o.sandbox ?? join(config!.projectPath, SANDBOX_NAME);
    const headlessArgs = o["headless-args"] ? (JSON.parse(o["headless-args"]) as unknown) : [];
    if (!Array.isArray(headlessArgs) || !headlessArgs.every((a) => typeof a === "string")) {
      throw new Error("--headless-args must be a JSON array of strings");
    }
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
      headlessArgs: headlessArgs as string[],
      launcherKnowsSandbox: args.flags.has("launcher-knows-sandbox"),
      ownerYesAboveMutating: args.flags.has("owner-yes-above-mutating"),
      openedProjectPattern: o["opened-project-pattern"] ?? null,
      sessionLog: o["session-log"] ?? (config ? newestSessionLog(config.logsPath) : null),
      exec: defaultExec,
      powershell: (script, env) => runPowerShell(script, { env }),
      now: () => new Date(),
      state: {},
    };
    console.log(
      `pre-flight (${variant}) for lane ${lane.session}${ctx.really ? "" : " [dry run]"}`,
    );
    const r = await runPreflight(ctx);
    for (const s of r.results) console.log(formatStep(s));
    console.log(
      !r.ok
        ? "pre-flight STOPPED"
        : ctx.really
          ? "pre-flight passed"
          : "pre-flight dry run passed (nothing was acquired, exported or launched)",
    );
    if (ctx.state.snapshotFile) console.log(`snapshot manifest: ${ctx.state.snapshotFile}`);
    if (ctx.state.registryExport) console.log(`registry export: ${ctx.state.registryExport}`);
    return r.ok ? 0 : 1;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
