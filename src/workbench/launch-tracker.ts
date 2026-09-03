/**
 * Per-run launch tracking shared by every tool that spawns the Workbench
 * exe (wb_validate_scripts / wb_cli_run / wb_build_data / wb_launch).
 *
 * A spawned Workbench writes a fresh `logs_<timestamp>` session under the
 * logs root; discovering that session gives us console.log — the ground
 * truth for whether the launcher actually proceeded (`CLI Params:` echo)
 * or is holding at its Projects picker (see workbench/launch-watchdog.ts).
 *
 * The tracker owns session discovery + console access and drives an
 * optional LaunchWatchdog from the cli-runner's pollSignal tick. Tools
 * with a completion marker in a session log (wb_validate_scripts'
 * script.log verdict) inject a `verdictProbe`; the probe always wins the
 * tick — a run that reaches its verdict was never stuck.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LaunchWatchdog } from "./launch-watchdog.js";

/** Session dir name pattern, mirrors src/logs/parser.ts. */
const SESSION_DIR_RE = /^logs_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

/** Snapshot the names of existing `logs_*` session dirs under logsRoot. */
export function snapshotSessionDirs(logsRoot: string): Set<string> {
  try {
    return new Set(readdirSync(logsRoot).filter((n) => SESSION_DIR_RE.test(n)));
  } catch {
    return new Set();
  }
}

/**
 * Find a session dir that appeared after `before` was snapshotted.
 * Returns the newest one (name sort = chronological) or null.
 */
export function findNewSessionDir(logsRoot: string, before: Set<string>): string | null {
  try {
    const fresh = readdirSync(logsRoot)
      .filter((n) => SESSION_DIR_RE.test(n) && !before.has(n))
      .sort();
    return fresh.length > 0 ? join(logsRoot, fresh[fresh.length - 1]) : null;
  } catch {
    return null;
  }
}

export class WorkbenchLaunchTracker {
  sessionDir: string | null = null;
  watchdog: LaunchWatchdog | null = null;

  constructor(
    private readonly logsRoot: string,
    private readonly priorSessions: Set<string>,
    /**
     * Optional completion probe over the discovered session dir. A
     * non-null return becomes the run's earlySignal (and wins over any
     * watchdog verdict for that tick).
     */
    private readonly verdictProbe?: (sessionDir: string) => string | null,
  ) {}

  readConsoleLog = (): string => {
    if (!this.sessionDir) return "";
    try {
      return readFileSync(join(this.sessionDir, "console.log"), "utf-8");
    } catch {
      return "";
    }
  };

  check = async (ctx: { pid?: number }): Promise<string | null> => {
    this.sessionDir ??= findNewSessionDir(this.logsRoot, this.priorSessions);
    if (this.sessionDir && this.verdictProbe) {
      const verdict = this.verdictProbe(this.sessionDir);
      if (verdict) return verdict;
    }
    if (this.watchdog) return this.watchdog.tick(ctx.pid);
    return null;
  };
}
