import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PID_FILE_NAME,
  writePidFile,
  type PidFileContents,
} from "../../src/server-mgmt/launch.js";
import { stopServer, type StopDeps } from "../../src/server-mgmt/stop.js";

const TEST_DIR = resolve(import.meta.dirname, "../../tmp-test-stop");

function setupDir(): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  return TEST_DIR;
}

afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

const SAMPLE: PidFileContents = {
  pid: 12345,
  started_at: "2026-05-21T10:00:00.000Z",
  server_config_path: "C:\\Servers\\HostHavoc\\server.json",
  scenario_id: "{ABCD1234DEAD5678}Missions/M.conf",
  argv: ["-config", "server.json", "-scenarioId", "{ABCD}M.conf"],
};

interface RecordedCalls {
  sigterm: number[];
  sigkill: number[];
  alive: number[];
  sleeps: number[];
}

/**
 * Build a programmable StopDeps stub. `aliveSequence` is consumed in order
 * by repeated `isAlive` calls — when exhausted, the last value sticks.
 * `now` is a logical clock that advances by `sleepAdvanceMs` per `sleep`.
 */
function makeDeps(opts: {
  aliveSequence: boolean[];
  sleepAdvanceMs?: number;
}): { deps: StopDeps; calls: RecordedCalls } {
  const calls: RecordedCalls = {
    sigterm: [],
    sigkill: [],
    alive: [],
    sleeps: [],
  };
  let logicalNow = 0;
  let aliveIdx = 0;
  const lastAlive = () =>
    opts.aliveSequence[Math.min(aliveIdx, opts.aliveSequence.length - 1)] ??
    false;
  const deps: StopDeps = {
    isAlive: (pid: number) => {
      calls.alive.push(pid);
      const result = lastAlive();
      aliveIdx++;
      return result;
    },
    sendSigterm: (pid: number) => {
      calls.sigterm.push(pid);
    },
    sendSigkill: (pid: number) => {
      calls.sigkill.push(pid);
    },
    sleep: async (ms: number) => {
      calls.sleeps.push(ms);
      logicalNow += opts.sleepAdvanceMs ?? ms;
    },
    now: () => logicalNow,
  };
  return { deps, calls };
}

describe("server-mgmt/stop — stopServer", () => {
  it("returns not_running when no PID file exists", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    const { deps } = makeDeps({ aliveSequence: [true] });
    const out = await stopServer({ pidFilePath, deps });
    expect(out.status).toBe("not_running");
    expect(out.pid).toBeUndefined();
  });

  it("returns not_running and cleans up a stale PID file", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const { deps, calls } = makeDeps({ aliveSequence: [false] });
    const out = await stopServer({ pidFilePath, deps });
    expect(out.status).toBe("not_running");
    expect(out.pid).toBe(SAMPLE.pid);
    expect(out.detail).toMatch(/cleaned up/);
    // No SIGTERM sent against a dead PID.
    expect(calls.sigterm).toHaveLength(0);
    // Stale file was removed.
    expect(existsSync(pidFilePath)).toBe(false);
  });

  it("sends SIGTERM and reports stopped when the process exits within the timeout", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    // First isAlive (pre-SIGTERM) → true; second (after one sleep) → false.
    const { deps, calls } = makeDeps({
      aliveSequence: [true, false],
      sleepAdvanceMs: 250,
    });
    const out = await stopServer({
      pidFilePath,
      deps,
      timeout_ms: 5000,
    });
    expect(out.status).toBe("stopped");
    expect(out.pid).toBe(SAMPLE.pid);
    expect(calls.sigterm).toEqual([SAMPLE.pid]);
    expect(calls.sigkill).toHaveLength(0);
    // PID file deleted on success.
    expect(existsSync(pidFilePath)).toBe(false);
  });

  it("falls back to SIGKILL when SIGTERM times out, returns force_killed", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    // Sequence: pre-SIGTERM=alive, then alive for ALL polling sleeps until
    // timeout, then dead after SIGKILL's confirmation sleep.
    // The polling loop sleeps ~20 times (5000ms / 250ms), then 1 more after
    // SIGKILL. We'll keep `alive` true throughout polling then false on the
    // final probe.
    // Using a clock that advances the timeout in 2 sleeps to keep the
    // sequence short.
    const aliveSequence = [
      true, // pre-SIGTERM liveness check
      true, // first poll after sleep
      true, // second poll — but `now` will have crossed the deadline
      false, // final probe after SIGKILL
    ];
    const { deps, calls } = makeDeps({
      aliveSequence,
      sleepAdvanceMs: 3000, // each sleep advances logical clock by 3s
    });
    const out = await stopServer({
      pidFilePath,
      deps,
      timeout_ms: 5000,
    });
    expect(out.status).toBe("force_killed");
    expect(out.pid).toBe(SAMPLE.pid);
    expect(calls.sigterm).toEqual([SAMPLE.pid]);
    expect(calls.sigkill).toEqual([SAMPLE.pid]);
    // PID file deleted on success.
    expect(existsSync(pidFilePath)).toBe(false);
  });

  it("returns timeout when even SIGKILL doesn't reap the process", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    // Always alive — even after SIGKILL.
    const { deps, calls } = makeDeps({
      aliveSequence: [true],
      sleepAdvanceMs: 3000,
    });
    const out = await stopServer({
      pidFilePath,
      deps,
      timeout_ms: 5000,
    });
    expect(out.status).toBe("timeout");
    expect(out.pid).toBe(SAMPLE.pid);
    expect(calls.sigterm).toEqual([SAMPLE.pid]);
    expect(calls.sigkill).toEqual([SAMPLE.pid]);
    // PID file preserved so the user can retry.
    expect(existsSync(pidFilePath)).toBe(true);
    expect(out.detail).toMatch(/still alive/i);
  });

  it("propagates a sendSigkill error into result.detail", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    // Forced timeout sequence (alive throughout) so we hit the SIGKILL branch.
    const { deps } = makeDeps({
      aliveSequence: [true],
      sleepAdvanceMs: 3000,
    });
    // Override sendSigkill to throw — process should be reported as still alive.
    const wrapped: StopDeps = {
      ...deps,
      sendSigkill: () => {
        throw new Error("taskkill exited with code 128");
      },
    };
    const out = await stopServer({
      pidFilePath,
      deps: wrapped,
      timeout_ms: 5000,
    });
    expect(out.status).toBe("timeout");
    expect(out.detail).toMatch(/taskkill exited/);
  });
});

describe("server-mgmt/stop — process identity (M20)", () => {
  it("refuses to signal a live PID whose image is not ArmaReforgerServer.exe and removes the PID file", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const { deps, calls } = makeDeps({ aliveSequence: [true] });
    const withIdentity: StopDeps = { ...deps, imageName: () => "notepad.exe" };
    const out = await stopServer({ pidFilePath, deps: withIdentity });
    expect(out.status).toBe("not_running");
    expect(out.pid).toBe(SAMPLE.pid);
    expect(out.detail).toMatch(/notepad\.exe/);
    expect(out.detail).toMatch(/ArmaReforgerServer\.exe/);
    expect(calls.sigterm).toHaveLength(0);
    expect(calls.sigkill).toHaveLength(0);
    expect(existsSync(pidFilePath)).toBe(false);
  });

  it("treats an unresolvable image (tasklist failed) as foreign — never signals", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const { deps, calls } = makeDeps({ aliveSequence: [true] });
    const out = await stopServer({ pidFilePath, deps: { ...deps, imageName: () => null } });
    expect(out.status).toBe("not_running");
    expect(calls.sigterm).toHaveLength(0);
    expect(existsSync(pidFilePath)).toBe(false);
  });

  it("proceeds to SIGTERM when the image matches (case-insensitive)", async () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const { deps, calls } = makeDeps({ aliveSequence: [true, false], sleepAdvanceMs: 250 });
    const out = await stopServer({
      pidFilePath,
      deps: { ...deps, imageName: () => "armareforgerserver.EXE" },
    });
    expect(out.status).toBe("stopped");
    expect(calls.sigterm).toEqual([SAMPLE.pid]);
  });
});
