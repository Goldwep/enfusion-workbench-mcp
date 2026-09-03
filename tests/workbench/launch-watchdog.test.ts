import { describe, it, expect } from "vitest";
import {
  CLI_PARAMS_MARKER,
  ENGINE_CREATED_MARKER,
  LaunchWatchdog,
} from "../../src/workbench/launch-watchdog.js";
import type { NudgeOutcome } from "../../src/workbench/launcher-nudge.js";

function outcome(partial: Partial<NudgeOutcome>): NudgeOutcome {
  return {
    windowFound: false,
    windowTitle: null,
    wasMinimized: false,
    restored: false,
    enterPosted: false,
    modalDetected: false,
    windowTitles: [],
    error: null,
    ...partial,
  };
}

const LAUNCHER_FOUND = outcome({
  windowFound: true,
  windowTitle: "Enfusion Workbench Launcher",
  wasMinimized: true,
  restored: true,
  enterPosted: true,
  windowTitles: ["Enfusion Workbench Launcher"],
});

interface Harness {
  watchdog: LaunchWatchdog;
  setConsole: (s: string) => void;
  advance: (ms: number) => void;
  nudgeCalls: () => number;
  inspectCalls: () => number;
}

function makeHarness(opts?: {
  nudgeResult?: NudgeOutcome;
  inspectResult?: NudgeOutcome;
}): Harness {
  let consoleContent = "";
  let t = 0;
  let nudges = 0;
  let inspects = 0;
  const watchdog = new LaunchWatchdog({
    readConsoleLog: () => consoleContent,
    nudge: async () => {
      nudges += 1;
      return opts?.nudgeResult ?? LAUNCHER_FOUND;
    },
    inspectWindows: async () => {
      inspects += 1;
      return opts?.inspectResult ?? LAUNCHER_FOUND;
    },
    now: () => t,
    nudgeAfterMs: 10_000,
    postNudgeGraceMs: 12_000,
  });
  return {
    watchdog,
    setConsole: (s) => (consoleContent = s),
    advance: (ms) => (t += ms),
    nudgeCalls: () => nudges,
    inspectCalls: () => inspects,
  };
}

const ENGINE_UP = `FileSystem: ...\n${ENGINE_CREATED_MARKER}: 32.6 ms\n`;
const PROCEEDED = `${ENGINE_UP}ENGINE : ${CLI_PARAMS_MARKER} -wbModule ScriptEditor ...\n`;

describe("launch-watchdog", () => {
  it("stays inert while the engine marker has not appeared", async () => {
    const h = makeHarness();
    h.advance(60_000);
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.nudgeCalls()).toBe(0);
  });

  it("never nudges when CLI Params appears in time", async () => {
    const h = makeHarness();
    h.setConsole(ENGINE_UP);
    expect(await h.watchdog.tick(1234)).toBeNull(); // arms the engine timer
    h.advance(5_000);
    h.setConsole(PROCEEDED);
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.watchdog.cliParamsSeen).toBe(true);
    h.advance(600_000);
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.nudgeCalls()).toBe(0);
  });

  it("nudges once after the quiet threshold, then reports stuck after the grace", async () => {
    const h = makeHarness();
    h.setConsole(ENGINE_UP);
    await h.watchdog.tick(1234);
    h.advance(9_999);
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.nudgeCalls()).toBe(0);
    h.advance(1);
    expect(await h.watchdog.tick(1234)).toBeNull(); // nudge fires, no verdict yet
    expect(h.nudgeCalls()).toBe(1);
    h.advance(11_999);
    expect(await h.watchdog.tick(1234)).toBeNull(); // grace running
    h.advance(1);
    expect(await h.watchdog.tick(1234)).toBe("stuck:launcher-picker");
    expect(h.inspectCalls()).toBe(1);
    expect(h.watchdog.finalInspection).not.toBeNull();
    // Terminal: later ticks are inert.
    h.advance(60_000);
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.nudgeCalls()).toBe(1);
  });

  it("recovers when CLI Params appears within the post-nudge grace", async () => {
    const h = makeHarness();
    h.setConsole(ENGINE_UP);
    await h.watchdog.tick(1234);
    h.advance(10_000);
    await h.watchdog.tick(1234); // nudge
    h.advance(3_000);
    h.setConsole(PROCEEDED); // the Enter click worked
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.watchdog.cliParamsSeen).toBe(true);
    h.advance(60_000);
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.inspectCalls()).toBe(0);
  });

  it("reports missing-deps immediately when the modal is up at nudge time", async () => {
    const h = makeHarness({
      nudgeResult: outcome({
        modalDetected: true,
        windowTitles: ["Missing Addon Dependencies"],
      }),
    });
    h.setConsole(ENGINE_UP);
    await h.watchdog.tick(1234);
    h.advance(10_000);
    expect(await h.watchdog.tick(1234)).toBe("stuck:missing-deps");
    expect(h.inspectCalls()).toBe(0);
  });

  it("reports missing-deps when the modal appears after the nudge", async () => {
    const h = makeHarness({
      inspectResult: outcome({
        modalDetected: true,
        windowTitles: ["Missing Addon Dependencies"],
      }),
    });
    h.setConsole(ENGINE_UP);
    await h.watchdog.tick(1234);
    h.advance(10_000);
    await h.watchdog.tick(1234); // nudge clicked Open → modal popped
    h.advance(12_000);
    expect(await h.watchdog.tick(1234)).toBe("stuck:missing-deps");
  });

  it("goes inert without a stuck verdict when no launcher window exists", async () => {
    const h = makeHarness({ nudgeResult: outcome({ windowFound: false }) });
    h.setConsole(ENGINE_UP);
    await h.watchdog.tick(1234);
    h.advance(10_000);
    expect(await h.watchdog.tick(1234)).toBeNull();
    h.advance(600_000);
    expect(await h.watchdog.tick(1234)).toBeNull(); // verdict/timeout owns the run
    expect(h.nudgeCalls()).toBe(1);
    expect(h.inspectCalls()).toBe(0);
  });

  it("waits for a pid before nudging", async () => {
    const h = makeHarness();
    h.setConsole(ENGINE_UP);
    await h.watchdog.tick(undefined);
    h.advance(60_000);
    expect(await h.watchdog.tick(undefined)).toBeNull();
    expect(h.nudgeCalls()).toBe(0);
    // pid shows up → nudge proceeds
    expect(await h.watchdog.tick(1234)).toBeNull();
    expect(h.nudgeCalls()).toBe(1);
  });
});
