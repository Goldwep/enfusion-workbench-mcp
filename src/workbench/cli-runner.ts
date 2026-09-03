/**
 * Workbench CLI runner — shared spawn-and-capture helper for L3-7 wb-*
 * tools (wb_validate_scripts / wb_cli_run / wb_build_data).
 *
 * Spawns ArmaReforgerWorkbenchSteamDiag.exe with curated args; never
 * uses `shell:true`. Per security audit (SEC-004), path-style args are
 * rejected when they start with `-` so an LLM can't smuggle flags.
 *
 * Enfusion arg gotcha: the engine re-tokenizes the raw Windows command
 * line itself and only honors quotes around a standalone value token.
 * Pass path values as their own argv entry (`"-flag", path` — Node then
 * quotes just the value) — never as a single `-flag=<path>` token, which
 * Node must whole-token-quote and the engine truncates at the first
 * space (live-verified 2026-08-20: `-wbProjectPath=C:\...\My Games\...`
 * arrived as `C:\Users\<you>\Documents\My`).
 *
 * Timeouts (review 2026-09 H11): the default wall-clock budget is 100 s
 * so a call fits inside a typical MCP client window; tools expose
 * `timeout_seconds` for genuinely long builds, and `wb_build_data` also
 * offers `action:"start"` / `"poll"` (JobStore-backed) for runs that
 * should outlive one call. On timeout the WHOLE process tree is killed
 * (taskkill /T /F on win32) before the runner resolves, so no invisible
 * second Workbench outlives the call.
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findGameAcrossSteamLibraries, steamRootOf } from "../utils/steam.js";
import { logger } from "../utils/logger.js";

const WORKBENCH_EXE = "ArmaReforgerWorkbenchSteamDiag.exe";

/** Default wall-clock budget — fits a typical MCP client window (H11). */
export const DEFAULT_TIMEOUT_MS = 100 * 1000;
/** Grace period after a kill before we stop waiting for `close`. */
const KILL_GRACE_MS = 10 * 1000;

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True if the wall-clock timeout fired and we killed the process. */
  timedOut: boolean;
  /**
   * Non-null when `pollSignal.check` reported completion and we killed the
   * process early — holds whatever string `check` returned.
   */
  earlySignal: string | null;
}

export interface RunOptions {
  /**
   * Workbench install root. Used to resolve `ArmaReforgerWorkbenchSteamDiag.exe`
   * if `exePath` isn't set explicitly.
   */
  workbenchPath: string;
  /** Override the resolved exe path. Rarely needed. */
  exePath?: string;
  /** Curated argv. Each entry is passed as-is to spawn (no shell). */
  args: string[];
  /**
   * Working directory. Defaults to {@link resolveHeadlessCwd}: the GAME
   * install dir when it can be found (so `./addons/data` — the base-game
   * addon 58D0FB3206B6F859 — resolves), else workbenchPath/Workbench.
   */
  cwd?: string;
  /** Game install dir hint for the default cwd (config.gamePath). */
  gamePath?: string;
  /** Wall-clock timeout in ms. Default {@link DEFAULT_TIMEOUT_MS} (100 s). */
  timeoutMs?: number;
  /**
   * Process-tree killer used on timeout / early-signal. Defaults to
   * {@link killProcessTree}; injectable for tests.
   */
  killTree?: (pid: number) => Promise<void>;
  /** Cap stdout/stderr each at this many bytes. Default 1 MB. */
  maxOutputBytes?: number;
  /**
   * Optional early-completion probe for Workbench invocations that do their
   * work at startup and then idle in the GUI instead of exiting (e.g.
   * `-validate`, which never terminates on its own). `check` runs every
   * `intervalMs` (default 2000 ms) and receives the spawned pid; the first
   * non-null return kills the child and resolves the run with `earlySignal`
   * set to that value. `check` may be async (e.g. to probe the process's
   * windows) — ticks never overlap: while one invocation is in flight,
   * subsequent ticks are skipped.
   */
  pollSignal?: {
    intervalMs?: number;
    check: (ctx: { pid?: number }) => string | null | Promise<string | null>;
  };
}

const DEFAULT_MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

/**
 * Build the win32 `taskkill` argv for a process tree. Pure — exported for
 * tests. The pid is validated as a positive safe integer so nothing
 * flag-shaped can ride in; the argv is passed to spawn without a shell.
 */
/**
 * Image name of the Workbench executable, used to detect an already-running
 * instance before a headless spawn.
 */
export const WORKBENCH_IMAGE = "ArmaReforgerWorkbenchSteamDiag.exe";

/**
 * PIDs of running Workbench instances (win32 via `tasklist`, argv array, no
 * shell). Empty elsewhere or on error. Injectable for tests.
 */
export function runningWorkbenchPids(
  exec: (file: string, args: string[]) => string = (f, a) =>
    execFileSync(f, a, { encoding: "utf-8", windowsHide: true }),
): number[] {
  if (process.platform !== "win32") return [];
  try {
    const out = exec("tasklist", ["/FI", `IMAGENAME eq ${WORKBENCH_IMAGE}`, "/FO", "CSV", "/NH"]);
    const pids: number[] = [];
    for (const line of out.split(/\r?\n/)) {
      const m = /^"[^"]+","(\d+)"/.exec(line.trim());
      if (m) pids.push(Number(m[1]));
    }
    return pids;
  } catch {
    return [];
  }
}

/**
 * Headless Workbench runs (buildData / validate / cli) MUST NOT start while a
 * Workbench instance is already running: the Steam launcher stub forwards the
 * new arguments to the existing instance, which drops the live NET API
 * session and re-opens the launcher picker (live-observed 2026-09-03 — the
 * open editor session was lost and a different recent project was opened).
 * Returns a user-facing refusal message, or null when it is safe to spawn.
 */
export function headlessSpawnBlocker(pids: number[] = runningWorkbenchPids()): string | null {
  if (pids.length === 0) return null;
  return (
    `Refusing to start a headless Workbench run: ${WORKBENCH_IMAGE} is already running ` +
    `(pid ${pids.join(", ")}). Steam's single-instance launcher would forward the arguments ` +
    "to the open Workbench, dropping the live session and re-opening the project picker. " +
    "Close Workbench (or wb_stop your session) first, then retry."
  );
}

/**
 * Working directory for a headless Workbench spawn. Same rule as the GUI
 * launch in client.ts: the engine resolves the base-game data addon
 * (58D0FB3206B6F859) via `./addons` relative to CWD, so a mod that depends on
 * the base game only loads when CWD is the GAME install — not the Tools.
 * Live 2026-09-03: a build spawned from the Workbench dir stalled at engine
 * creation on the Missing Addon modal. Order: gamePath (if it has addons/)
 * → Steam-library scan → the historical Workbench dir.
 */
export function resolveHeadlessCwd(workbenchPath: string, gamePath?: string): string {
  if (gamePath && existsSync(join(gamePath, "addons"))) return gamePath;
  const scanned = findGameAcrossSteamLibraries("Arma Reforger", [steamRootOf(workbenchPath)]);
  if (scanned) return scanned;
  return join(workbenchPath, "Workbench");
}

export function buildTaskkillArgv(pid: number): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Refusing to taskkill invalid pid ${String(pid)}`);
  }
  return ["/PID", String(pid), "/T", "/F"];
}

/**
 * Kill `pid` and every descendant. On win32 this runs
 * `taskkill /PID <pid> /T /F` (argv array, no shell) — `child.kill()`
 * alone only signals the launcher stub and leaves the real Workbench
 * process running. Elsewhere it falls back to SIGKILL on the pid.
 * Never throws; failures are logged at debug.
 */
export function killProcessTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let argv: string[];
    try {
      argv = buildTaskkillArgv(pid);
    } catch (e) {
      logger.debug(`[wb-cli] ${e instanceof Error ? e.message : String(e)}`);
      resolve();
      return;
    }
    if (process.platform !== "win32") {
      try {
        process.kill(pid, "SIGKILL");
      } catch (e) {
        logger.debug(`[wb-cli] kill ${pid} failed: ${e}`);
      }
      resolve();
      return;
    }
    try {
      const tk = spawn("taskkill", argv, { shell: false, stdio: "ignore", windowsHide: true });
      tk.on("error", (e) => {
        logger.debug(`[wb-cli] taskkill spawn failed: ${e.message}`);
        resolve();
      });
      tk.on("close", () => resolve());
    } catch (e) {
      logger.debug(`[wb-cli] taskkill threw: ${e}`);
      resolve();
    }
  });
}

/**
 * Validate that no positional argument looks like a smuggled flag.
 * Args starting with `-` are only allowed when explicitly listed in
 * `knownFlagPrefixes` (curated allow-list per tool).
 *
 * Each tool calls this with its own allow-list; the runner doesn't
 * know what flags are valid for which command.
 */
export function validateArgs(args: string[], knownFlagPrefixes: string[]): void {
  for (const a of args) {
    if (!a.startsWith("-")) continue;
    const allowed = knownFlagPrefixes.some((prefix) => a === prefix || a.startsWith(`${prefix}=`));
    if (!allowed) {
      throw new Error(
        `Refusing to pass unknown flag-shaped arg '${a}' to Workbench — only curated flags allowed`,
      );
    }
  }
}

/**
 * Run the Workbench binary with the supplied args. Captures stdout +
 * stderr (bounded), reports exit code, and applies a wall-clock timeout.
 */
export function runWorkbench(opts: RunOptions): Promise<RunResult> {
  const exePath = opts.exePath ?? join(opts.workbenchPath, "Workbench", WORKBENCH_EXE);
  if (!existsSync(exePath)) {
    return Promise.reject(
      new Error(
        `Workbench exe not found at ${exePath}. Set ENFUSION_WORKBENCH_PATH or install Arma Reforger Tools.`,
      ),
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const cwd = opts.cwd ?? resolveHeadlessCwd(opts.workbenchPath, opts.gamePath);
  const killTree = opts.killTree ?? killProcessTree;
  const startedAt = Date.now();

  return new Promise<RunResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let timedOut = false;
    let earlySignal: string | null = null;
    let settled = false;
    let closed = false;
    let closeInfo: { code: number | null; signal: NodeJS.Signals | null } = {
      code: null,
      signal: null,
    };
    let signalTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    logger.debug(`[wb-cli] spawn ${exePath} ${opts.args.join(" ")}`);
    const child = spawn(exePath, opts.args, { cwd, shell: false });

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (signalTimer) clearInterval(signalTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (stdoutOverflow) stdout += `\n[truncated — exceeded ${maxOutputBytes} bytes]`;
      if (stderrOverflow) stderr += `\n[truncated — exceeded ${maxOutputBytes} bytes]`;
      resolve({
        exitCode: closeInfo.code,
        signal: closeInfo.signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        earlySignal,
      });
    };

    /**
     * Kill the whole tree, then wait for `close` (bounded by the grace
     * period) so the caller never resolves while a Workbench survives.
     */
    const killAndFinish = (why: string): void => {
      if (signalTimer) clearInterval(signalTimer);
      const pid = child.pid;
      const treeKill = typeof pid === "number" ? killTree(pid) : Promise.resolve();
      treeKill
        .catch((e) => logger.debug(`[wb-cli] ${why} tree-kill failed: ${e}`))
        .then(() => {
          try {
            child.kill("SIGKILL");
          } catch (e) {
            logger.debug(`[wb-cli] ${why} kill failed: ${e}`);
          }
          if (closed) {
            finish();
            return;
          }
          graceTimer = setTimeout(() => {
            logger.debug(`[wb-cli] ${why}: no close within ${KILL_GRACE_MS} ms after kill`);
            finish();
          }, KILL_GRACE_MS);
        });
    };

    const killTimer = setTimeout(() => {
      timedOut = true;
      killAndFinish("timeout");
    }, timeoutMs);

    if (opts.pollSignal) {
      const { check, intervalMs } = opts.pollSignal;
      let checking = false;
      signalTimer = setInterval(() => {
        if (checking || earlySignal !== null) return;
        checking = true;
        Promise.resolve()
          .then(() => check({ pid: child.pid }))
          .catch((e) => {
            logger.debug(`[wb-cli] pollSignal check threw: ${e}`);
            return null;
          })
          .then((verdict) => {
            checking = false;
            if (verdict === null || verdict === undefined || earlySignal !== null) return;
            earlySignal = verdict;
            killAndFinish("early-signal");
          });
      }, intervalMs ?? 2000);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxOutputBytes) {
        const remaining = maxOutputBytes - stdout.length;
        stdout +=
          chunk.length <= remaining
            ? chunk.toString("utf-8")
            : chunk.subarray(0, remaining).toString("utf-8");
        if (chunk.length > remaining) stdoutOverflow = true;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxOutputBytes) {
        const remaining = maxOutputBytes - stderr.length;
        stderr +=
          chunk.length <= remaining
            ? chunk.toString("utf-8")
            : chunk.subarray(0, remaining).toString("utf-8");
        if (chunk.length > remaining) stderrOverflow = true;
      }
    });

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (signalTimer) clearInterval(signalTimer);
      if (graceTimer) clearTimeout(graceTimer);
      reject(err);
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      closed = true;
      closeInfo = { code, signal };
      // A kill is in flight (timeout / early signal): killAndFinish
      // resolves once the tree-kill has completed — unless it already
      // reached its grace wait, in which case finish now.
      if (timedOut || earlySignal !== null) {
        if (graceTimer) {
          clearTimeout(graceTimer);
          finish();
        }
        return;
      }
      finish();
    });
  });
}

// ── Outcome derivation (review 2026-09 H10) ─────────────────────────────────

export type RunOutcomeStatus =
  | "ok"
  | "timeout"
  | "stuck"
  | "failed-verdict"
  | "nonzero-exit"
  | "no-artefacts";

export interface RunOutcome {
  /** True only when the run succeeded AND the artefact check passed. */
  ok: boolean;
  status: RunOutcomeStatus;
  /** Human-readable reason when `ok` is false; null otherwise. */
  reason: string | null;
}

export interface ArtefactCheckResult {
  ok: boolean;
  /** Short note surfaced in the report either way (e.g. file counts). */
  detail?: string;
}

/**
 * Derive success from the run's evidence rather than from process state.
 * Order of precedence: launcher-stuck signal → timeout → failed verdict →
 * non-zero / signal exit (only when no verdict was reached — a verdict
 * run is killed on purpose) → artefact check. `artefactCheck` runs only
 * when the process side looks fine; it should be cheap and must not throw
 * (a throw is reported as a failed check).
 */
export function finishRun(
  result: RunResult,
  artefactCheck?: () => ArtefactCheckResult,
): RunOutcome {
  const secs = (result.durationMs / 1000).toFixed(1);
  if (result.earlySignal !== null && result.earlySignal.startsWith("stuck:")) {
    return { ok: false, status: "stuck", reason: `launch blocked (${result.earlySignal})` };
  }
  if (result.timedOut && result.earlySignal === null) {
    return { ok: false, status: "timeout", reason: `TIMEOUT after ${secs}s — process tree killed` };
  }
  if (result.earlySignal === "failed") {
    return { ok: false, status: "failed-verdict", reason: "verdict: failed" };
  }
  if (result.earlySignal === null && result.exitCode !== 0) {
    const how =
      result.exitCode === null
        ? `killed by signal ${result.signal ?? "(unknown)"}`
        : `exit code ${result.exitCode}`;
    return { ok: false, status: "nonzero-exit", reason: how };
  }
  if (artefactCheck) {
    let check: ArtefactCheckResult;
    try {
      check = artefactCheck();
    } catch (e) {
      check = {
        ok: false,
        detail: `artefact check threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (!check.ok) {
      const exitNote = result.earlySignal
        ? `signal ${result.earlySignal}`
        : `exit ${result.exitCode ?? 0}`;
      return {
        ok: false,
        status: "no-artefacts",
        reason: `${exitNote} but no output produced${check.detail ? ` (${check.detail})` : ""}`,
      };
    }
  }
  return { ok: true, status: "ok", reason: null };
}

/**
 * Helper: extract the last N lines from a captured output buffer for
 * concise tool output. Trims trailing whitespace.
 */
export function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(-n);
  return tail.join("\n").trimEnd();
}
