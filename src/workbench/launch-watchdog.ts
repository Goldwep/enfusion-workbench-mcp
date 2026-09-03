/**
 * Launch watchdog for headless Workbench invocations — detects the two
 * launcher blockers that otherwise end as bare timeouts (field-diagnosed
 * 2026-08-31, EC29 session):
 *
 * 1. Project-picker hold: a project new to the launcher's registry/scan
 *    is preselected but NOT auto-opened; the minimized launcher waits
 *    for a human click on Open. Signature: the session console.log
 *    freezes right after `Workbench Create Engine took` and the
 *    `CLI Params:` echo never appears. Remedy: restore the launcher
 *    window and post Enter (activates the preselected Open).
 * 2. Missing Addon Dependencies modal: popped after Open when a .gproj
 *    dep GUID can't be located in any Workbench-visible folder.
 *
 * The watchdog is a per-run state machine driven from the cli-runner's
 * pollSignal tick. It arms only after the engine-created marker appears
 * in console.log (so slow cold starts never trigger a premature Enter),
 * nudges once, allows a grace period, then reports a stuck signal that
 * the calling tool converts into a diagnosis instead of a timeout.
 * All I/O is injected, so the machine itself is unit-testable.
 */

import type { NudgeOutcome } from "./launcher-nudge.js";

/** Written by the engine just before the launcher decides whether to auto-open. */
export const ENGINE_CREATED_MARKER = "Workbench Create Engine took";
/** Echoed once the engine actually proceeds with the CLI-supplied project. */
export const CLI_PARAMS_MARKER = "CLI Params:";

/** Quiet time after the engine marker before concluding the launcher is holding. */
export const DEFAULT_NUDGE_AFTER_MS = 10_000;
/** Time allowed for the CLI Params echo to appear after the nudge. */
export const DEFAULT_POST_NUDGE_GRACE_MS = 12_000;

export type StuckSignal = "stuck:launcher-picker" | "stuck:missing-deps";

export interface WatchdogHooks {
  /** Current console.log content of the run's log session ("" when absent). */
  readConsoleLog: () => string;
  /** Restore the launcher window (if any) and post Enter. */
  nudge: (pid: number) => Promise<NudgeOutcome>;
  /** Titles-only window probe — no input posted. */
  inspectWindows: (pid: number) => Promise<NudgeOutcome>;
  now?: () => number;
  nudgeAfterMs?: number;
  postNudgeGraceMs?: number;
}

export class LaunchWatchdog {
  /** The CLI Params echo was seen — launch proceeded (possibly thanks to the nudge). */
  cliParamsSeen = false;
  /** Result of the one nudge attempt, if it ran. */
  nudgeOutcome: NudgeOutcome | null = null;
  /** Window evidence gathered when declaring a stuck verdict. */
  finalInspection: NudgeOutcome | null = null;

  private readonly now: () => number;
  private readonly nudgeAfterMs: number;
  private readonly postNudgeGraceMs: number;
  private engineSeenAt: number | null = null;
  private nudgedAt: number | null = null;
  private settled = false;

  constructor(private readonly hooks: WatchdogHooks) {
    this.now = hooks.now ?? Date.now;
    this.nudgeAfterMs = hooks.nudgeAfterMs ?? DEFAULT_NUDGE_AFTER_MS;
    this.postNudgeGraceMs = hooks.postNudgeGraceMs ?? DEFAULT_POST_NUDGE_GRACE_MS;
  }

  /**
   * One poll tick. Returns a stuck signal at most once; null otherwise.
   * After any terminal decision (CLI Params seen, no window to nudge, or
   * a stuck verdict) the watchdog stays inert and the caller's verdict/
   * timeout handling owns the run again.
   */
  async tick(pid: number | undefined): Promise<StuckSignal | null> {
    if (this.settled) return null;

    const consoleLog = this.hooks.readConsoleLog();
    if (consoleLog.includes(CLI_PARAMS_MARKER)) {
      this.cliParamsSeen = true;
      this.settled = true;
      return null;
    }
    const t = this.now();
    if (this.engineSeenAt === null) {
      if (!consoleLog.includes(ENGINE_CREATED_MARKER)) return null; // engine not up yet
      this.engineSeenAt = t;
      return null;
    }
    if (pid === undefined) return null; // no pid — nothing we can target

    if (this.nudgeOutcome === null) {
      if (t - this.engineSeenAt < this.nudgeAfterMs) return null;
      this.nudgeOutcome = await this.hooks.nudge(pid);
      this.nudgedAt = this.now();
      if (this.nudgeOutcome.modalDetected) {
        // The deps modal was already up (auto-open ran into it) — the
        // nudge helper skips the Enter post in that case.
        this.settled = true;
        return "stuck:missing-deps";
      }
      if (!this.nudgeOutcome.windowFound) {
        // No launcher window to click — either the picker isn't the
        // problem or the probe failed. Let verdict/timeout decide.
        this.settled = true;
        return null;
      }
      return null;
    }

    if (this.nudgedAt !== null && t - this.nudgedAt < this.postNudgeGraceMs) return null;

    // Nudged, grace expired, still no CLI Params — gather final evidence.
    this.finalInspection = await this.hooks.inspectWindows(pid);
    this.settled = true;
    if (this.finalInspection.modalDetected) return "stuck:missing-deps";
    return "stuck:launcher-picker";
  }
}
