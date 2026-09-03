/**
 * `server_stop` core — terminate a running ArmaReforgerServer.exe that was
 * launched by this MCP via `server_launch`.
 *
 * Strategy:
 *   1. Read the PID file at the given path. Missing → "not_running".
 *   2. Probe liveness via `process.kill(pid, 0)`. Dead → "not_running"
 *      and clean up the stale PID file.
 *   3. Send SIGTERM. On Windows, Node maps SIGTERM to TerminateProcess
 *      which is roughly equivalent to a forceful close — but the dedicated
 *      server may still take a moment to shut down cleanly, so we poll.
 *   4. Poll up to `timeout_ms` (default 5000) for the process to exit.
 *   5. If still alive after timeout, fall back to a hard kill:
 *        - Windows: `taskkill /F /PID <pid> /T` via execFileSync (no shell).
 *          `/T` also terminates child processes, matching the tree we
 *          spawned (the dedicated server can fork helpers).
 *        - POSIX: `process.kill(pid, "SIGKILL")`.
 *   6. Delete the PID file on a successful stop.
 *
 * Security posture (L8):
 *   - `shell: false` everywhere — argv passed as an array to execFileSync.
 *   - PID is parsed as an integer from a JSON file we wrote ourselves;
 *     never interpolated into a shell string.
 *   - No path inputs from the LLM hit a shell.
 */

import { execFileSync } from "node:child_process";
import {
  deletePidFile,
  isProcessAlive,
  isServerProcessAlive,
  processImageName,
  readPidFile,
  SERVER_IMAGE_NAME,
  type PidFileContents,
} from "./launch.js";

/**
 * Outcome of a stop attempt.
 *
 *   - "not_running"   → no PID file (or PID file points at a dead process).
 *                       In either case, no live process exists; cleanup
 *                       happened if a stale file was present.
 *   - "stopped"       → SIGTERM was sent and the process exited within
 *                       `timeout_ms`.
 *   - "force_killed"  → SIGTERM timed out; SIGKILL (or taskkill /F) was
 *                       used to bring it down.
 *   - "timeout"       → both SIGTERM and the force-kill failed within the
 *                       allotted time. Process may still be alive. Caller
 *                       should surface this loudly.
 */
export type StopStatus =
  | "not_running"
  | "stopped"
  | "force_killed"
  | "timeout";

export interface StopResult {
  status: StopStatus;
  /** PID we attempted to stop, if there was one. */
  pid?: number;
  /** PID-file contents we read (echoed for the caller to format). */
  pidFileContents?: PidFileContents;
  /** Human-readable note — e.g. error text from a failed taskkill. */
  detail?: string;
}

/**
 * Dependency-injection seam for tests. The real implementations live in
 * `defaultStopDeps`; tests pass a stub.
 */
export interface StopDeps {
  /** Liveness probe. Should mirror `process.kill(pid, 0)` semantics. */
  isAlive: (pid: number) => boolean;
  /** SIGTERM-equivalent. Should not throw on ESRCH. */
  sendSigterm: (pid: number) => void;
  /** SIGKILL-equivalent (taskkill /F on Windows). */
  sendSigkill: (pid: number) => void;
  /** Sleep — milliseconds. Tests can replace this with a no-op. */
  sleep: (ms: number) => Promise<void>;
  /** Wall-clock now in ms (for deadline math). */
  now: () => number;
  /**
   * Image-name lookup for process identity (M20). When present, a live PID
   * whose image is not ArmaReforgerServer.exe is treated as a recycled PID:
   * "not_running", PID file removed, NO signal sent. Omit to skip the check
   * (POSIX default — no cheap image lookup there).
   */
  imageName?: (pid: number) => string | null;
}

export const defaultStopDeps: StopDeps = {
  isAlive: isProcessAlive,
  imageName: process.platform === "win32" ? processImageName : undefined,
  sendSigterm: (pid: number) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // ESRCH = process already gone; that's fine.
      if (code !== "ESRCH") throw e;
    }
  },
  sendSigkill: (pid: number) => {
    if (process.platform === "win32") {
      // /F = force, /T = tree (terminate children too). No shell — pid
      // is stringified from a parsed integer, never an LLM string.
      execFileSync("taskkill", ["/F", "/PID", String(pid), "/T"], {
        stdio: "ignore",
        shell: false,
      });
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") throw e;
      }
    }
  },
  sleep: (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Poll interval between liveness checks while waiting on a SIGTERM. */
const POLL_INTERVAL_MS = 250;

/**
 * Stop the server identified by the PID file at `pidFilePath`.
 *
 * Returns a structured result (never throws on the happy paths). Throws
 * only on a corrupted PID file (caller can decide whether to recover by
 * deleting it).
 *
 * @param opts.pidFilePath  absolute path to `.arma-reforger-server.pid`
 * @param opts.timeout_ms   total time budget (default 5000) — split
 *                          between waiting on SIGTERM and the force-kill
 *                          confirmation poll.
 * @param opts.deps         dependency-injection seam (default: real OS)
 */
export async function stopServer(opts: {
  pidFilePath: string;
  timeout_ms?: number;
  deps?: StopDeps;
}): Promise<StopResult> {
  const deps = opts.deps ?? defaultStopDeps;
  const timeoutMs = opts.timeout_ms ?? 5000;

  // 1. Read the PID file. Missing → not_running.
  const contents = readPidFile(opts.pidFilePath);
  if (contents === null) {
    return { status: "not_running" };
  }

  // 2. Probe liveness. Stale → clean up and report not_running.
  if (!deps.isAlive(contents.pid)) {
    deletePidFile(opts.pidFilePath);
    return {
      status: "not_running",
      pid: contents.pid,
      pidFileContents: contents,
      detail: "PID file pointed at a dead process; cleaned up",
    };
  }

  // 2b. Identity. A live PID is not proof it is OUR server — PIDs recycle.
  // Refuse to signal anything that isn't ArmaReforgerServer.exe; treat the
  // PID file as stale and remove it.
  if (deps.imageName) {
    const ours = isServerProcessAlive(contents.pid, {
      isAlive: () => true,
      imageName: deps.imageName,
    });
    if (!ours) {
      const image = deps.imageName(contents.pid) ?? "unknown image";
      deletePidFile(opts.pidFilePath);
      return {
        status: "not_running",
        pid: contents.pid,
        pidFileContents: contents,
        detail:
          `PID ${contents.pid} is alive but belongs to "${image}", not ${SERVER_IMAGE_NAME} ` +
          "(recycled PID). Refused to signal it; stale PID file cleaned up",
      };
    }
  }

  // 3. SIGTERM.
  deps.sendSigterm(contents.pid);

  // 4. Poll until the process exits or we hit the timeout.
  const deadline = deps.now() + timeoutMs;
  let stillAlive = true;
  while (deps.now() < deadline) {
    await deps.sleep(POLL_INTERVAL_MS);
    if (!deps.isAlive(contents.pid)) {
      stillAlive = false;
      break;
    }
  }

  if (!stillAlive) {
    deletePidFile(opts.pidFilePath);
    return {
      status: "stopped",
      pid: contents.pid,
      pidFileContents: contents,
    };
  }

  // 5. Force-kill fallback.
  let forceErr: string | undefined;
  try {
    deps.sendSigkill(contents.pid);
  } catch (e) {
    forceErr = e instanceof Error ? e.message : String(e);
  }

  // Give the OS a beat to actually reap the process before declaring
  // success.
  await deps.sleep(POLL_INTERVAL_MS);
  if (!deps.isAlive(contents.pid)) {
    deletePidFile(opts.pidFilePath);
    return {
      status: "force_killed",
      pid: contents.pid,
      pidFileContents: contents,
      detail: forceErr,
    };
  }

  // Even SIGKILL didn't bring it down within the polling window. Leave
  // the PID file in place so a follow-up `server_stop` can retry.
  return {
    status: "timeout",
    pid: contents.pid,
    pidFileContents: contents,
    detail:
      forceErr ??
      `Process ${contents.pid} still alive after SIGTERM + SIGKILL within ${timeoutMs}ms`,
  };
}
