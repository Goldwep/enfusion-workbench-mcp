import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkbenchLaunchTracker,
  findNewSessionDir,
  snapshotSessionDirs,
} from "../../src/workbench/launch-tracker.js";
import type { LaunchWatchdog } from "../../src/workbench/launch-watchdog.js";

let logsRoot: string;

beforeAll(() => {
  logsRoot = mkdtempSync(join(tmpdir(), "wb-launch-tracker-"));
});

afterAll(() => {
  rmSync(logsRoot, { recursive: true, force: true });
});

function newSession(name: string, consoleContent?: string): string {
  const dir = join(logsRoot, name);
  mkdirSync(dir);
  if (consoleContent !== undefined) {
    writeFileSync(join(dir, "console.log"), consoleContent);
  }
  return dir;
}

describe("workbench launch-tracker (generic)", () => {
  it("check is inert without a verdict probe or watchdog", async () => {
    const prior = snapshotSessionDirs(logsRoot);
    newSession("logs_2026-08-31_17-00-00", "ENGINE : hello\n");
    const tracker = new WorkbenchLaunchTracker(logsRoot, prior);
    expect(await tracker.check({ pid: 1 })).toBeNull();
    expect(tracker.sessionDir).toBe(join(logsRoot, "logs_2026-08-31_17-00-00"));
    expect(tracker.readConsoleLog()).toContain("hello");
  });

  it("the injected verdict probe wins the tick over the watchdog", async () => {
    const prior = snapshotSessionDirs(logsRoot);
    newSession("logs_2026-08-31_17-01-00");
    const tracker = new WorkbenchLaunchTracker(logsRoot, prior, () => "done");
    tracker.watchdog = {
      tick: async () => {
        throw new Error("watchdog must not be consulted when the probe fires");
      },
    } as unknown as LaunchWatchdog;
    expect(await tracker.check({ pid: 1 })).toBe("done");
  });

  it("falls through to the watchdog while the probe reports nothing", async () => {
    const prior = snapshotSessionDirs(logsRoot);
    newSession("logs_2026-08-31_17-02-00");
    const tracker = new WorkbenchLaunchTracker(logsRoot, prior, () => null);
    let ticks = 0;
    tracker.watchdog = {
      tick: async () => {
        ticks += 1;
        return ticks >= 2 ? "stuck:launcher-picker" : null;
      },
    } as unknown as LaunchWatchdog;
    expect(await tracker.check({ pid: 1 })).toBeNull();
    expect(await tracker.check({ pid: 1 })).toBe("stuck:launcher-picker");
  });

  it("readConsoleLog is empty before session discovery and tolerates a missing file", async () => {
    const tracker = new WorkbenchLaunchTracker(logsRoot, snapshotSessionDirs(logsRoot));
    expect(tracker.readConsoleLog()).toBe("");
    newSession("logs_2026-08-31_17-03-00"); // no console.log inside
    await tracker.check({ pid: 1 });
    expect(tracker.readConsoleLog()).toBe("");
  });

  it("findNewSessionDir keeps working through the re-export surface", () => {
    const prior = snapshotSessionDirs(logsRoot);
    expect(findNewSessionDir(logsRoot, prior)).toBeNull();
    const dir = newSession("logs_2026-08-31_17-04-00");
    expect(findNewSessionDir(logsRoot, prior)).toBe(dir);
  });
});
