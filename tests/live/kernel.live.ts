/**
 * Sitting P3-2, part 1: the kernel battery (plan Phase 3 exit gate L1; DEC-048 "Live sittings" item 2).
 *
 * A GUI Workbench on the 2.0 sandbox, launched on the scratch profile after the two-pass pre-flight
 * (as S-F did), with the shipped handler bundle (28 files incl. EMCP_WB_BuildStamp.c) and the
 * read-only probe pack (`mod-dev/probe`, needed only by the modal step) installed, and NO
 * `-scriptAuthorizeAll`. The launch itself is the runbook's (scripts/live/launch.ts); this script
 * never launches, never takes the lease for itself (the lane given with --id holds it) and talks to
 * Workbench through a `WorkbenchClient` WITHOUT a Config, which by construction never auto-launches,
 * never recovers handlers and never touches the lease (src/workbench/client.ts claimLease).
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline and the ACTION PLAN (the JSON array
 * `scripts/live/dry-run.ts` checks), checks the plan against the policy and writes it to --out.
 *
 * Steps (each writes `<run>/<step>.json`; a step is never run twice in a run folder and a stopped
 * step is never retried, plan 5.3):
 *   k-01-readiness        IsWorkbenchRunning through client.probe: ScriptsCompiled. False or absent:
 *                         the first compile of the bundle failed or is running; the compile-log
 *                         excerpt is recorded and the battery STOPS with a handoff (the handlers are
 *                         unproven).
 *   k-02-build-stamp      EMCP_WB_Ping's buildStamp equals scripts/build-stamp.ts's digest
 *                         (client.ts bundleDigest). No Ping: STOP with a handoff.
 *   k-03-sandbox-info     EMCP_WB_Info says projectFound and names the test-bed project (DEC-058:
 *                         the guard follows the open project). The negative (no project carries the
 *                         handlers) is static: recorded as such, with the unit tests that carry it.
 *   k-04-raw-burst        seven raw sockets at once, each never retried (the U30 baseline).
 *   k-05-queue-burst      seven concurrent read calls through ONE client: all answer, in order (U30).
 *   k-06-mutate-no-retry  a harmless Ping marked `access: "mutate"`, sent while six raw sockets fill
 *                         the listener: a refusal must surface at once (no back-off), never retried.
 *   k-07-lease-second     a second tsx process tries to take the lease: the refusal is recorded.
 *   k-08-modal-watchdog   OWNER PRESENT. The probe pack's modalTest opens ONE Workbench.Dialog; the
 *                         modal watchdog reports it and its policy decision. Nothing presses a button:
 *                         the owner closes the dialog by hand (DEC-042 U6).
 *   k-09-u4-plant-reload  the U4 recovery question (DEC-047 L1): a broken copy planted OUTSIDE the
 *                         handler folder (s-c-natives.ts plantedSource), ReloadScripts, then the copy
 *                         removed (always, even on a throw).
 *   k-10-u4-recovery      ReloadScripts again with the copy gone, then Ping. Whether the recovery
 *                         reload still fails is recorded; handlers gone = STOP (relaunch is the owner's).
 *
 * Usage:
 *   npx --no tsx tests/live/kernel.live.ts [--out <plan.json>] [--outline <file>]
 *   npx --no tsx tests/live/kernel.live.ts --really --id <lane id> --sandbox <dir>
 *       [--run-dir <dir>] [--from <step> | --only <step>] [--owner-present] [--port 5775]
 *       [--evidence-dir <dir>]
 *
 * Exit: 0 done (or dry run passed), 1 refused or plan check failed, 2 usage, 3 stopped,
 *       4 aborted (not the sandbox), 5 handoff (owner action needed; resume as printed).
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { ModalWatchdog, type WatchReport } from "../../src/gui/modal-watchdog.js";
import {
  REFUSAL_RETRY_DELAYS_MS,
  WorkbenchClient,
  WorkbenchError,
  bundleDigest,
  checkBuildStamp,
  type WorkbenchCallOptions,
} from "../../src/workbench/client.js";
import { isWorkbenchRunning, reloadScripts } from "../../src/workbench/native.js";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { checkPlan, formatResult, type PlanAction } from "../../scripts/live/dry-run.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "../../scripts/live/evidence.js";
import { Lane } from "../../scripts/live/lane.js";
import { HANDLER_FOLDER, probePackTarget } from "../../scripts/live/launch.js";
import { DEFAULT_PORT, netCall, type NetCallResult } from "../../scripts/live/netcall.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { newestSessionLog } from "../../scripts/live/preflight.js";
import {
  WINDOWS_SCRIPT,
  baselineProblem,
  parseWindows,
  plantedSource,
  type WindowInfo,
} from "../../scripts/live/s-c-natives.js";
import { runPowerShell } from "../../scripts/live/powershell.js";
import {
  acknowledgedMarkerPath,
  outsideArtifacts,
  startedMarkerPath,
  writeStartedMarker,
} from "../../scripts/live/session-common.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P3-2-K";
export const SCRIPT_PATH = "tests/live/kernel.live.ts";
export const EXIT = { done: 0, refused: 1, usage: 2, stopped: 3, aborted: 4, handoff: 5 } as const;

/** The launch the runbook performs before this battery (checked by the dry run, never run here). */
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<run>/p3-2.ini",
];
/** Refused anywhere in this script's argv and in the launch (plan 5.7; P3-2 runs without it). */
export const NEVER_FLAG = "-scriptAuthorizeAll";

export const PING = "EMCP_WB_Ping";
export const INFO = "EMCP_WB_Info";
export const PROBE_API = "ECEN_Probe";
export const MODAL_ACTION = "modalTest";
export const BURST = 7;
/** Raw sockets that fill the listener around the mutate-marked Ping (U30: it holds two). */
export const FILLERS = 6;

/** The U4 plant: a folder of its own under Scripts/WorkbenchGame, never the handler folder. */
export const PLANT_FOLDER = "EMCP2_P32Plant";
export const PLANT_FILE = "ECEN_P32_U4Broken.c";

export const TIMEOUTS = {
  cheap: 3_000,
  /** modalTest: past the about-120 s engine reset (U6) so MODAL_OPEN can be observed, below WEDGED. */
  modal: 140_000,
  modalAppearMs: 30_000,
  watchEveryMs: 2_000,
  secondLeaseMs: 60_000,
} as const;

/** The unit tests that carry the static wrong-project negative (no live non-sandbox launch, ever). */
export const STATIC_NEGATIVE_TESTS = [
  "tests/live-harness/shipped-info.test.ts",
  "tests/live-harness/shipped-guard.test.ts",
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export type StepStatus = "pass" | "fail" | "observed" | "stopped" | "aborted" | "handoff";

export interface StepRecord {
  step: string;
  title: string;
  proves: string;
  status: StepStatus;
  startedAt: string;
  endedAt: string;
  evidence: Record<string, unknown>;
  stop?: string;
}

/** What a step returns; the runner stamps times and writes the record. */
export interface StepOutcome {
  status: StepStatus;
  evidence: Record<string, unknown>;
  stop?: string;
}

export type KernelClient = Pick<WorkbenchClient, "probe" | "call">;

export interface KernelDeps {
  /** A client WITHOUT a Config: no lease, no auto-launch, no handler recovery. */
  client: KernelClient;
  /** One fresh socket, never retried (scripts/live/netcall.ts). */
  rawPing: () => Promise<NetCallResult>;
  bundleDigest: () => string | null;
  /** The Workbench pid the lane recorded at the launch. */
  workbenchPid: () => number | null;
  /** Spawn a second tsx that tries to take the lease. */
  secondLease: () => Promise<{ code: number | null; output: string }>;
  watchdog: { watch(pid: number): Promise<WatchReport> };
  /** Every top-level window (s-c-natives.ts WINDOWS_SCRIPT); filtered by pid in the steps. */
  listWindows: () => Promise<WindowInfo[]>;
  /** The newest session log's tail (the compile errors), or null. */
  compileLogExcerpt: () => string | null;
  readText: (path: string) => string;
  writeText: (path: string, text: string) => void;
  removeFile: (path: string) => void;
  exists: (path: string) => boolean;
  makeDir: (path: string) => void;
  /** Remove a folder only when empty; false when it is not. */
  removeDirIfEmpty: (path: string) => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface KernelOptions {
  runDir: string;
  sandboxDir: string;
  ownerPresent: boolean;
  /** Write one evidence record per step here (null: none, the unit tests). */
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

export interface StepContext {
  deps: KernelDeps;
  opts: KernelOptions;
  /** Records of earlier steps in this run folder. */
  prior: (id: string) => StepRecord | null;
}

export interface StepDef {
  id: string;
  title: string;
  /** The decision or plan row this step proves. */
  proves: string;
  /** The owner must be at the machine (the only dialog of the battery). */
  ownerPresent?: boolean;
  plan: () => PlanAction[];
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

export class StopBattery extends Error {
  constructor(
    readonly kind: "stopped" | "aborted" | "handoff",
    message: string,
    readonly evidence: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StopBattery";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function net(apiFunc: string, params?: Record<string, unknown>, note?: string): PlanAction {
  const a: PlanAction & { note?: string } = { kind: "net-call", target: apiFunc };
  if (params) (a as Record<string, unknown>).params = params;
  if (note) a.note = note;
  return a;
}

function errorOf(e: unknown): { code: string | null; message: string } {
  if (e instanceof WorkbenchError) return { code: e.code, message: e.message };
  return { code: null, message: e instanceof Error ? e.message : String(e) };
}

function field(o: unknown, name: string): unknown {
  return o && typeof o === "object" ? (o as Record<string, unknown>)[name] : undefined;
}

/** True when `file` lies inside `dir` (resolved, case-folded on win32). */
export function insideDir(dir: string, file: string): boolean {
  const rel = relative(resolve(dir), resolve(file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Where the plant goes, or the reason it must not: inside the sandbox, outside both script folders. */
export function plantTarget(sandboxDir: string): { dir: string; file: string } | string {
  const dir = join(sandboxDir, "Scripts", "WorkbenchGame", PLANT_FOLDER);
  const file = join(dir, PLANT_FILE);
  if (basename(resolve(sandboxDir)) !== SANDBOX_NAME) return "the sandbox is not the 2.0 sandbox";
  if (!insideDir(sandboxDir, file)) return "the plant would land outside the sandbox";
  const handlerDir = join(sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
  if (insideDir(handlerDir, file))
    return "the plant would land inside the installed handler folder";
  if (insideDir(probePackTarget(sandboxDir), file)) {
    return "the plant would land inside the probe pack folder";
  }
  return { dir, file };
}

/** The fixed caption of the probe pack's one dialog (mod-dev/probe/ECEN_ProbeSystem.c ModalTest). */
export const PROBE_MODAL_TITLE = "ECEN probe modal";

/** The probe modal and nothing else: the fixed caption, not the authorization prompt. */
export function isProbeModal(m: { title: string; authorization: boolean }): boolean {
  return m.title === PROBE_MODAL_TITLE && m.authorization === false;
}

function recordedPid(ctx: StepContext): number {
  const pid = ctx.deps.workbenchPid();
  if (pid === null) throw new StopBattery("stopped", "the lane recorded no Workbench pid");
  return pid;
}

async function windowsOf(ctx: StepContext, pid: number): Promise<WindowInfo[]> {
  try {
    return (await ctx.deps.listWindows()).filter((w) => w.pid === pid);
  } catch (e) {
    throw new StopBattery("stopped", "the window list could not be read", { error: errorOf(e) });
  }
}

/**
 * S-C's setBaseline rule (s-c-natives.ts baselineProblem): any owned, dialog-class or disabled
 * window of the pid stops the step before (or reports after) a NET call.
 */
async function windowGate(
  ctx: StepContext,
  pid: number,
  when: string,
  kind: "stopped" | "handoff",
  evidence: Record<string, unknown> = {},
): Promise<void> {
  const ws = await windowsOf(ctx, pid);
  const problem = baselineProblem(ws);
  if (problem) {
    throw new StopBattery(kind, `a dialog-like or disabled window is open ${when}: ${problem}`, {
      ...evidence,
      windows: ws,
    });
  }
}

async function readinessGate(ctx: StepContext): Promise<void> {
  const r = await isWorkbenchRunning(ctx.deps.client);
  if (r.scriptsCompiled !== true) {
    throw new StopBattery("handoff", "ScriptsCompiled is not true: the handlers are unproven", {
      scriptsCompiled: r.scriptsCompiled,
      compileLog: ctx.deps.compileLogExcerpt(),
    });
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

export function buildSteps(): StepDef[] {
  return [
    {
      id: "k-01-readiness",
      title: "native readiness through client.probe (never auto-launch)",
      proves: "DEC-047 L1 (native layer), DEC-049 A (probe never launches)",
      plan: () => [net("IsWorkbenchRunning")],
      run: async (ctx) => {
        let r;
        try {
          r = await isWorkbenchRunning(ctx.deps.client);
        } catch (e) {
          throw new StopBattery("stopped", "IsWorkbenchRunning did not answer", {
            error: errorOf(e),
          });
        }
        const evidence = { scriptsCompiled: r.scriptsCompiled, raw: r.raw };
        if (r.scriptsCompiled !== true) {
          // The first compile of the bundle happens at this launch: a failure leaves the handlers unproven.
          throw new StopBattery(
            "handoff",
            "ScriptsCompiled is not true after the launch: the first compile of the shipped bundle " +
              "failed or is still running. The compile-log excerpt is recorded; the handlers are " +
              "unproven, so the battery stops (fix offline, relaunch is the owner's).",
            { ...evidence, compileLog: ctx.deps.compileLogExcerpt() },
          );
        }
        return { status: "pass", evidence };
      },
    },
    {
      id: "k-02-build-stamp",
      title: "Ping's buildStamp equals scripts/build-stamp.ts's digest",
      proves: "DEC-048 package A / 3.3 (handler build stamp), DEC-050",
      plan: () => [net(PING)],
      run: async (ctx) => {
        let resp: unknown;
        try {
          resp = await ctx.deps.client.probe(PING, {}, { timeout: TIMEOUTS.cheap });
        } catch (e) {
          throw new StopBattery(
            "handoff",
            "EMCP_WB_Ping did not answer: the handlers are unproven",
            {
              error: errorOf(e),
              compileLog: ctx.deps.compileLogExcerpt(),
            },
          );
        }
        const check = checkBuildStamp(resp, ctx.deps.bundleDigest());
        const evidence = { check, ping: resp };
        if (check.status !== "match") {
          throw new StopBattery(
            "stopped",
            `build stamp ${check.status}: the loaded handlers are not this bundle`,
            evidence,
          );
        }
        return { status: "pass", evidence };
      },
    },
    {
      id: "k-03-sandbox-info",
      title: "the wrong-project assertion: EMCP_WB_Info says projectFound on the test bed",
      proves: "DEC-048 design section 6 (the shared guard), plan L1 exit gate (wrong-project)",
      plan: () => [net(INFO)],
      run: async (ctx) => {
        let resp: unknown;
        try {
          resp = await ctx.deps.client.probe(INFO, {}, { timeout: TIMEOUTS.cheap });
        } catch (e) {
          throw new StopBattery("stopped", "EMCP_WB_Info did not answer", { error: errorOf(e) });
        }
        // DEC-058: Info answers projectFound and projectName (the addon id) instead of isSandbox.
        const projectFound = field(resp, "projectFound");
        const projectName = field(resp, "projectName");
        const evidence = {
          info: resp,
          projectFound,
          projectName,
          negative: {
            kind: "static",
            why: "no live launch of a project other than the test bed, ever (plan 5.1); the guard's refusal when no project carries the handlers is asserted offline",
            tests: [...STATIC_NEGATIVE_TESTS],
          },
        };
        // Enforce JSON writes booleans as 1/0 (P3-3 gate 1 and P3-2 k-03, 2026-10-10).
        const found =
          projectFound === true ||
          projectFound === "true" ||
          projectFound === 1 ||
          projectFound === "1";
        if (!found || projectName !== SANDBOX_NAME) {
          throw new StopBattery(
            "aborted",
            `EMCP_WB_Info does not say projectFound with projectName ${SANDBOX_NAME}: not the test bed`,
            evidence,
          );
        }
        return { status: "pass", evidence };
      },
    },
    {
      id: "k-04-raw-burst",
      title: "seven raw sockets at once, never retried (the U30 baseline)",
      proves: "U30 (DEC-042 sd-11: the listener holds two pending connections)",
      plan: () => Array.from({ length: BURST }, () => net(PING, undefined, "raw socket")),
      run: async (ctx) => {
        await readinessGate(ctx);
        const rs = await Promise.all(Array.from({ length: BURST }, () => ctx.deps.rawPing()));
        const answered = rs.filter((r) => r.ok).length;
        return {
          status: "observed",
          evidence: {
            answered,
            refused: rs.length - answered,
            calls: rs.map((r) => ({ ok: r.ok, error: r.error ?? null, durationMs: r.durationMs })),
          },
        };
      },
    },
    {
      id: "k-05-queue-burst",
      title: "seven concurrent read calls through one client answer in order",
      proves: "U30 and DEC-047 L1 (serial client queue, refusal retry for reads), DEC-049 A",
      plan: () => Array.from({ length: BURST }, () => net(PING, undefined, "client.probe")),
      run: async (ctx) => {
        await readinessGate(ctx);
        const order: number[] = [];
        const t0 = ctx.deps.now();
        const results = await Promise.all(
          Array.from({ length: BURST }, (_, i) =>
            ctx.deps.client
              .probe(PING, {}, { timeout: TIMEOUTS.cheap })
              .then(() => {
                order.push(i);
                return { i, ok: true, error: null as unknown, ms: ctx.deps.now() - t0 };
              })
              .catch((e: unknown) => {
                order.push(i);
                return { i, ok: false, error: errorOf(e) as unknown, ms: ctx.deps.now() - t0 };
              }),
          ),
        );
        const allOk = results.every((r) => r.ok);
        const inOrder = order.every((v, idx) => v === idx);
        return {
          status: allOk && inOrder ? "pass" : "fail",
          evidence: { completionOrder: order, allAnswered: allOk, inOrder, results },
        };
      },
    },
    {
      id: "k-06-mutate-no-retry",
      title: "a Ping marked mutate is never retried on refusal",
      proves: "U6 and U30 (DEC-042; DEC-049 A: mutating calls never retried)",
      plan: () => [
        ...Array.from({ length: FILLERS }, () => net(PING, undefined, "raw socket (filler)")),
        net(PING, undefined, "client.call access mutate (harmless Ping, classification only)"),
      ],
      run: async (ctx) => {
        await readinessGate(ctx);
        const opts: WorkbenchCallOptions = {
          access: "mutate",
          skipAutoLaunch: true,
          timeout: TIMEOUTS.cheap,
        };
        const t0 = ctx.deps.now();
        const fillers = Array.from({ length: FILLERS }, () => ctx.deps.rawPing());
        const marked = ctx.deps.client.call(PING, {}, opts).then(
          (r) => ({ ok: true as const, response: r, ms: ctx.deps.now() - t0 }),
          (e: unknown) => ({ ok: false as const, error: errorOf(e), ms: ctx.deps.now() - t0 }),
        );
        const [m, f] = await Promise.all([marked, Promise.all(fillers)]);
        const firstBackoff = REFUSAL_RETRY_DELAYS_MS[0];
        let outcome: string;
        let status: StepStatus = "observed";
        if (m.ok) {
          outcome =
            "answered: the listener took the marked call; the no-retry rule was not exercised";
        } else if (m.error.code === "CONNECTION_REFUSED") {
          // A retried call would have waited at least the first back-off before failing.
          outcome =
            m.ms < firstBackoff
              ? "refused and surfaced before the first back-off: not retried"
              : `refused after ${m.ms} ms (>= ${firstBackoff} ms back-off): retry not excluded`;
          status = m.ms < firstBackoff ? "pass" : "fail";
        } else {
          outcome = `failed with ${m.error.code ?? "an unclassified error"}`;
        }
        return {
          status,
          evidence: {
            outcome,
            marked: m,
            fillersAnswered: f.filter((r) => r.ok).length,
            fillersRefused: f.filter((r) => !r.ok).length,
            firstBackoffMs: firstBackoff,
          },
        };
      },
    },
    {
      id: "k-07-lease-second",
      title: "the lease refuses a second process",
      proves: "plan 5.1 guard 3 and DEC-048 A (cross-session lease)",
      plan: () => [],
      run: async (ctx) => {
        const r = await ctx.deps.secondLease();
        const refused = r.code !== 0 && /lease|held/i.test(r.output);
        const evidence = { exitCode: r.code, output: r.output.slice(0, 2000), refused };
        if (!refused) {
          // The second lane may now hold the lease: nothing else runs until the owner ends it.
          throw new StopBattery(
            "stopped",
            "the second process was NOT refused and may hold the lease: end it with " +
              "`lane.ts end --id <lane id>-second`, then check `lane.ts status`",
            evidence,
          );
        }
        return { status: "pass", evidence };
      },
    },
    {
      id: "k-08-modal-watchdog",
      title: "the watchdog reports the probe modal; the owner closes it by hand",
      proves:
        "U6 (DEC-042 sd-21/22), DEC-051 (modal watchdog), DEC-048 (watchdog on the probe modal)",
      ownerPresent: true,
      plan: () => [
        net(PROBE_API, { action: MODAL_ACTION }, "the ONLY dialog of the battery; owner closes it"),
      ],
      run: async (ctx) => {
        await readinessGate(ctx);
        const pid = recordedPid(ctx);
        // S-C's setBaseline rule: an owned, dialog-class or disabled window already open stops.
        await windowGate(ctx, pid, "before the modal probe", "stopped");
        const baseline = await ctx.deps.watchdog.watch(pid);
        if (!baseline.ok) {
          throw new StopBattery("stopped", "the watchdog could not list the windows", { baseline });
        }
        if (baseline.modals.length > 0) {
          throw new StopBattery("stopped", "a modal is already open before the probe", {
            baseline,
          });
        }
        const t0 = ctx.deps.now();
        type Ended = { ok: boolean; ms: number; response?: unknown; error?: unknown };
        let ended: Ended | null = null;
        const call: Promise<Ended> = ctx.deps.client
          .probe(PROBE_API, { action: MODAL_ACTION }, { timeout: TIMEOUTS.modal })
          .then(
            (r): Ended => ({ ok: true, response: r, ms: ctx.deps.now() - t0 }),
            (e: unknown): Ended => ({ ok: false, error: errorOf(e), ms: ctx.deps.now() - t0 }),
          )
          .then((x) => (ended = x));
        // Poll until the call ends (the owner's close, or the engine's about-120 s reset).
        const seen = new Map<number, WatchReport["modals"][number]>();
        let polls = 0;
        let told = false;
        const cap = TIMEOUTS.modal + TIMEOUTS.watchEveryMs * 5;
        while (ended === null && ctx.deps.now() - t0 < cap) {
          await ctx.deps.sleep(TIMEOUTS.watchEveryMs);
          const w = await ctx.deps.watchdog.watch(pid);
          polls++;
          if (!w.ok) continue;
          for (const m of w.modals) seen.set(m.hwnd, m);
          if (!told && w.modals.some(isProbeModal)) {
            told = true;
            ctx.deps.log(
              `OWNER: the "${PROBE_MODAL_TITLE}" dialog is up. Close it by hand; the battery presses nothing.`,
            );
          }
        }
        const callEnded = await call;
        const modals = [...seen.values()];
        const others = modals.filter((m) => !isProbeModal(m));
        const evidence: Record<string, unknown> = {
          modals,
          decisions: modals.map((m) => m.decision),
          policyWouldAnswer: modals.some((m) => m.decision.decision === "answer"),
          pressed: false,
          call: callEnded,
          polls,
        };
        if (others.length > 0) {
          throw new StopBattery(
            "stopped",
            "a window other than the probe modal appeared (S-F rule: a new window = stop)",
            evidence,
          );
        }
        const after = await windowsOf(ctx, pid);
        evidence.modalGoneAfter = baselineProblem(after) === null;
        if (evidence.modalGoneAfter !== true) {
          throw new StopBattery(
            "handoff",
            "a dialog is still open after the modal call ended: the owner closes it before any further call",
            { ...evidence, windows: after },
          );
        }
        return { status: modals.length === 1 ? "pass" : "fail", evidence };
      },
    },
    {
      id: "k-09-u4-plant-reload",
      title: "U4: a broken copy outside the handler folder, ReloadScripts, then removed",
      proves:
        "DEC-047 L1 (U4 recovery question), DEC-040, DEC-044 (a failed reload keeps the handlers)",
      plan: () => [net("ReloadScripts", undefined, "with the planted copy")],
      run: async (ctx) => {
        await readinessGate(ctx);
        const pid = recordedPid(ctx);
        const t = plantTarget(ctx.opts.sandboxDir);
        if (typeof t === "string") throw new StopBattery("stopped", t);
        if (ctx.deps.exists(t.file)) throw new StopBattery("stopped", "a plant is already there");
        await windowGate(ctx, pid, "before the reload with the plant", "handoff");
        const source = plantedSource(
          ctx.deps.readText(
            join(REPO_ROOT, "mod", "Scripts", "WorkbenchGame", HANDLER_FOLDER, `${PING}.c`),
          ),
        );
        const folderExisted = ctx.deps.exists(t.dir);
        // The plant record, before anything is written (DEC-032): what to remove if cut off.
        ctx.deps.writeText(
          join(ctx.opts.runDir, "plant-k-09.json"),
          JSON.stringify(
            { folder: `Scripts/WorkbenchGame/${PLANT_FOLDER}`, file: PLANT_FILE, folderExisted },
            null,
            2,
          ),
        );
        let reload: unknown = null;
        let writeError: unknown = null;
        let removeError: unknown = null;
        try {
          ctx.deps.makeDir(t.dir);
          ctx.deps.writeText(t.file, source);
          try {
            reload = { ok: true, response: await reloadScripts(ctx.deps.client) };
          } catch (e) {
            reload = { ok: false, error: errorOf(e) };
          }
        } catch (e) {
          writeError = errorOf(e);
        } finally {
          try {
            if (ctx.deps.exists(t.file)) ctx.deps.removeFile(t.file);
          } catch (e) {
            removeError = errorOf(e);
          }
          try {
            if (!folderExisted) ctx.deps.removeDirIfEmpty(t.dir);
          } catch (e) {
            removeError = removeError ?? errorOf(e);
          }
        }
        const removed = !ctx.deps.exists(t.file);
        const evidence = { reload, writeError, removeError, removed };
        if (!removed) {
          throw new StopBattery(
            "stopped",
            "the planted copy could not be removed: remove it by hand per plant-k-09.json",
            evidence,
          );
        }
        if (writeError)
          throw new StopBattery("stopped", "the plant could not be written", evidence);
        await windowGate(ctx, pid, "after the reload with the plant", "handoff", evidence);
        return {
          status: "observed",
          evidence: { ...evidence, compileLog: ctx.deps.compileLogExcerpt() },
        };
      },
    },
    {
      id: "k-10-u4-recovery",
      title: "U4: the recovery reload with the copy gone, then Ping",
      proves: "DEC-047 L1 (U4: why the recovery reload also answered 'Compilation failed')",
      plan: () => [net("ReloadScripts", undefined, "recovery"), net(PING)],
      run: async (ctx) => {
        if (ctx.prior("k-09-u4-plant-reload")?.status !== "observed") {
          throw new StopBattery("stopped", "k-09 did not complete in this run folder");
        }
        const pid = recordedPid(ctx);
        await windowGate(ctx, pid, "before the recovery reload", "handoff");
        let reload: { ok: boolean; response?: unknown; error?: unknown };
        try {
          reload = { ok: true, response: await reloadScripts(ctx.deps.client) };
        } catch (e) {
          reload = { ok: false, error: errorOf(e) };
        }
        const text = JSON.stringify(reload);
        const stillFails = !reload.ok || /compilation failed/i.test(text);
        await windowGate(ctx, pid, "after the recovery reload", "handoff", { reload });
        let ping: unknown;
        try {
          ping = {
            ok: true,
            response: await ctx.deps.client.probe(PING, {}, { timeout: TIMEOUTS.cheap }),
          };
        } catch (e) {
          ping = { ok: false, error: errorOf(e) };
        }
        const evidence = {
          reload,
          recoveryReloadStillFails: stillFails,
          ping,
          compileLog: ctx.deps.compileLogExcerpt(),
        };
        if (!(ping as { ok: boolean }).ok) {
          throw new StopBattery(
            "stopped",
            "the handlers no longer answer after the recovery reload; relaunch is the owner's",
            evidence,
          );
        }
        return { status: "observed", evidence };
      },
    },
  ];
}

// ── Plan, outline ────────────────────────────────────────────────────────────

/** The launch the runbook performs before the battery: in the plan so the dry run checks it. */
export function launchAction(): PlanAction {
  return {
    kind: "launch",
    target: { gproj: `<sandbox>/${SANDBOX_NAME}.gproj` } as unknown as PlanAction["target"],
    args: [...LAUNCH_ARGS],
    note: "performed by scripts/live/launch.ts per the runbook, not by this script",
  } as PlanAction;
}

export function buildActionPlan(steps: StepDef[] = buildSteps()): PlanAction[] {
  const out: PlanAction[] = [launchAction()];
  for (const s of steps) {
    for (const a of s.plan()) out.push({ ...a, step: s.id } as PlanAction);
  }
  return out;
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: kernel battery (${SCRIPT_PATH}), ${steps.length} steps, Workbench open on the sandbox`,
    ...steps.map(
      (s) =>
        `  ${s.id}${s.ownerPresent ? " [OWNER PRESENT]" : ""}: ${s.title} (proves ${s.proves})`,
    ),
  ];
}

// ── Runner ───────────────────────────────────────────────────────────────────

export function recordPath(runDir: string, id: string): string {
  return join(runDir, `${id}.json`);
}

export function readRecord(runDir: string, id: string): StepRecord | null {
  const p = recordPath(runDir, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as StepRecord;
  } catch {
    return null;
  }
}

export function selectSteps(
  steps: StepDef[],
  sel: { from?: string; only?: string },
): StepDef[] | string {
  if (sel.only && sel.from) return "--only excludes --from";
  const id = sel.only ?? sel.from;
  if (!id) return steps;
  const at = steps.findIndex((s) => s.id === id);
  if (at === -1) return `${id} is not a step id`;
  return sel.only ? [steps[at]] : steps.slice(at);
}

/** Steps with a `.started` marker, no record and no owner acknowledgement. */
export function danglingMarkers(runDir: string): string[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .filter((f) => f.endsWith(".started"))
    .map((f) => f.slice(0, -".started".length))
    .filter(
      (id) =>
        !existsSync(recordPath(runDir, id)) && !existsSync(acknowledgedMarkerPath(runDir, id)),
    )
    .sort();
}

/** The owner's acknowledgement of a dangling marker: the step is never re-run, the rest may go on. */
export function acknowledge(runDir: string, id: string, now: Date = new Date()): string {
  const marker = startedMarkerPath(runDir, id);
  if (!existsSync(marker)) return `no started marker for ${id}`;
  if (existsSync(recordPath(runDir, id))) return `${id} has a record; nothing to acknowledge`;
  writeFileSync(
    acknowledgedMarkerPath(runDir, id),
    JSON.stringify({ step: id, acknowledged_at: now.toISOString(), by: "owner" }, null, 2) + "\n",
    { encoding: "utf-8", flag: "wx" },
  );
  return `acknowledged ${id}`;
}

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

export async function runBattery(
  steps: StepDef[],
  deps: KernelDeps,
  opts: KernelOptions,
): Promise<BatteryReport> {
  mkdirSync(opts.runDir, { recursive: true });
  const records: StepRecord[] = [];
  const write = (r: StepRecord): void => {
    const clean = JSON.parse(toPlaceholders(JSON.stringify(r), opts.ph)) as StepRecord;
    writeFileSync(recordPath(opts.runDir, r.step), JSON.stringify(clean, null, 2) + "\n", {
      encoding: "utf-8",
      flag: "wx",
    });
    records.push(clean);
    if (opts.evidenceDir) {
      writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${r.step}`,
          build: opts.build,
          result_summary: `${r.step}: ${r.status}${r.stop ? ` (${r.stop})` : ""}`,
          artifacts: [recordPath(opts.runDir, r.step)],
        },
        opts.ph,
      );
    }
  };
  const ctx: StepContext = { deps, opts, prior: (id) => readRecord(opts.runDir, id) };
  const dangling = danglingMarkers(opts.runDir);
  if (dangling.length) {
    return {
      exit: EXIT.refused,
      records,
      stoppedAt: dangling[0],
      message:
        `${dangling.join(", ")} started and never recorded: the step may have had its side effect. ` +
        "Look at Workbench and the sandbox, then the owner acknowledges with " +
        "`kernel.live.ts acknowledge --run-dir <run> --step <id> --owner-ack`; it is never re-run (plan 5.3)",
    };
  }
  for (const s of steps) {
    if (
      existsSync(recordPath(opts.runDir, s.id)) ||
      existsSync(startedMarkerPath(opts.runDir, s.id))
    ) {
      return {
        exit: EXIT.refused,
        records,
        stoppedAt: s.id,
        message: `${s.id} already has a record in this run folder: a step is never run twice (plan 5.3)`,
      };
    }
    if (s.ownerPresent && !opts.ownerPresent) {
      return {
        exit: EXIT.handoff,
        records,
        stoppedAt: s.id,
        message: `${s.id} needs the owner at the machine: resume with kernel.live.ts --really --id <lane id> --sandbox <sandbox> --run-dir <run> --only ${s.id} --owner-present once the owner is there`,
      };
    }
    deps.log(`step ${s.id}: ${s.title}`);
    const startedAt = new Date(deps.now()).toISOString();
    // Before the step's first side effect (session-common.ts pattern): a cut-off step stays visible.
    writeStartedMarker(
      startedMarkerPath(opts.runDir, s.id),
      { step: s.id, started_at: startedAt, pid: deps.workbenchPid(), created: null },
      true,
    );
    let out: StepOutcome;
    try {
      out = await s.run(ctx);
    } catch (e) {
      const stop = e instanceof StopBattery ? e : null;
      const kind = stop?.kind ?? "stopped";
      const message = e instanceof Error ? e.message : String(e);
      write({
        step: s.id,
        title: s.title,
        proves: s.proves,
        status: kind,
        startedAt,
        endedAt: new Date(deps.now()).toISOString(),
        evidence: stop?.evidence ?? {},
        stop: message,
      });
      return {
        exit: kind === "aborted" ? EXIT.aborted : kind === "handoff" ? EXIT.handoff : EXIT.stopped,
        records,
        stoppedAt: s.id,
        message,
      };
    }
    write({
      step: s.id,
      title: s.title,
      proves: s.proves,
      status: out.status,
      startedAt,
      endedAt: new Date(deps.now()).toISOString(),
      evidence: out.evidence,
      ...(out.stop ? { stop: out.stop } : {}),
    });
  }
  return { exit: EXIT.done, records, stoppedAt: null, message: null };
}

// ── Real dependencies ────────────────────────────────────────────────────────

export function realDeps(input: { port: number; lane: Lane; leasePath?: string }): KernelDeps {
  const config = loadConfig();
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const watchdog = new ModalWatchdog();
  return {
    client,
    rawPing: () => netCall(PING, {}, { port: input.port, timeoutMs: TIMEOUTS.cheap }),
    bundleDigest: () => bundleDigest(),
    workbenchPid: () => input.lane.recordedPid(),
    secondLease: () =>
      new Promise((done) => {
        const args = [
          "--import",
          "tsx",
          join(REPO_ROOT, "scripts", "live", "lane.ts"),
          "start",
          "--purpose",
          "P3-2 k-07 second process (must be refused)",
          "--id",
          `${input.lane.id}-second`.slice(0, 64),
          ...(input.leasePath ? ["--lease-path", input.leasePath] : []),
        ];
        const child = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true });
        let output = "";
        child.stdout.on("data", (b: Buffer) => (output += b.toString()));
        child.stderr.on("data", (b: Buffer) => (output += b.toString()));
        const timer = setTimeout(() => child.kill(), TIMEOUTS.secondLeaseMs);
        child.on("close", (code) => {
          clearTimeout(timer);
          done({ code, output });
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          done({ code: null, output: String(e) });
        });
      }),
    watchdog,
    listWindows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list failed: ${r.error ?? "unknown"}`);
      return parseWindows(r.stdout);
    },
    compileLogExcerpt: () => {
      const log = newestSessionLog(config.logsPath);
      if (!log) return null;
      const lines = readFileSync(log, "utf-8").split(/\r?\n/);
      const hits = lines.filter((l) => /error|compil|script/i.test(l));
      return (hits.length ? hits : lines).slice(-40).join("\n");
    },
    readText: (p) => readFileSync(p, "utf-8"),
    writeText: (p, t) => writeFileSync(p, t, "utf-8"),
    removeFile: (p) => unlinkSync(p),
    exists: (p) => existsSync(p),
    makeDir: (p) => mkdirSync(p, { recursive: true }),
    removeDirIfEmpty: (p) => {
      if (!existsSync(p) || readdirSync(p).length > 0) return false;
      rmdirSync(p);
      return true;
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "out",
  "outline",
  "id",
  "sandbox",
  "run-dir",
  "from",
  "only",
  "port",
  "evidence-dir",
  "lease-path",
  "marker-path",
  "build",
  "step",
] as const;
const FLAGS = ["really", "owner-present", "owner-ack"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: KernelDeps;
  leaseHeld?: boolean;
  artifactsRoot?: string;
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  if (argv.some((a) => a.toLowerCase() === NEVER_FLAG.toLowerCase())) {
    say(`refused: ${NEVER_FLAG} is never part of sitting P3-2`);
    return EXIT.usage;
  }
  let args;
  try {
    args = parseArgs(argv, VALUED);
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
  const steps = buildSteps();
  if (args.positional[0] === "acknowledge") {
    if (!o["run-dir"] || !o.step || !args.flags.has("owner-ack")) {
      say("acknowledge needs --run-dir <run> --step <id> --owner-ack (the owner's word)");
      return EXIT.usage;
    }
    say(acknowledge(resolve(o["run-dir"]), o.step));
    return EXIT.done;
  }
  const selected = selectSteps(steps, { from: o.from, only: o.only });
  if (typeof selected === "string") {
    say(selected);
    return EXIT.usage;
  }
  const plan = buildActionPlan(steps);
  const policy = over.policy ?? loadPolicy();
  const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps).join("\n") + "\n", "utf-8");
  const really = args.flags.has("really");
  if (!really) {
    for (const l of sessionOutline(steps)) say(l);
    say(formatResult(check));
    return check.ok ? EXIT.done : EXIT.refused;
  }
  if (!check.ok) {
    say(formatResult(check));
    return EXIT.refused;
  }
  if (!o.id || !o.sandbox) {
    say("--really needs --id <lane id> and --sandbox <the 2.0 sandbox folder>");
    return EXIT.usage;
  }
  if (basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    say(`refused: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}`);
    return EXIT.refused;
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
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  const runDir = resolve(
    o["run-dir"] ??
      join(
        artifactsDir(),
        "sessions",
        "P3-2",
        `kernel-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      ),
  );
  const outside = outsideArtifacts(runDir, over.artifactsRoot ?? artifactsDir());
  if (outside) {
    say(toPlaceholders(`refused: --run-dir ${outside} (plan 5.3)`, ph));
    return EXIT.refused;
  }
  const deps = over.deps ?? realDeps({ port, lane, leasePath: o["lease-path"] });
  if (!over.deps) lane.startHeartbeat();
  try {
    const r = await runBattery(selected, deps, {
      runDir,
      sandboxDir: resolve(o.sandbox),
      ownerPresent: args.flags.has("owner-present"),
      evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
      ph: { ...ph, sandbox: resolve(o.sandbox) },
      build: o.build ?? "unrecorded",
    });
    for (const rec of r.records) say(`${rec.step}: ${rec.status}`);
    if (r.message)
      say(toPlaceholders(`${r.exit === EXIT.handoff ? "HANDOFF" : "STOPPED"}: ${r.message}`, ph));
    say(toPlaceholders(`run folder: ${runDir}`, ph));
    return r.exit;
  } finally {
    lane.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}
