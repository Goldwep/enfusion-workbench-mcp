import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  DEFAULT_TIMEOUT_MS,
  buildTaskkillArgv,
  finishRun,
  killProcessTree,
  runWorkbench,
  type RunResult,
} from "../../src/workbench/cli-runner.js";

const IDLE_SCRIPT = "setInterval(() => {}, 1000)";

function result(over: Partial<RunResult>): RunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 1234,
    timedOut: false,
    earlySignal: null,
    ...over,
  };
}

describe("cli-runner: defaults (H11)", () => {
  it("default timeout fits inside a typical MCP client window", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(110_000);
  });
});

describe("cli-runner: buildTaskkillArgv", () => {
  it("builds the /T /F tree-kill argv as an array (no shell string)", () => {
    expect(buildTaskkillArgv(4242)).toEqual(["/PID", "4242", "/T", "/F"]);
  });

  it("rejects anything that is not a positive safe integer", () => {
    expect(() => buildTaskkillArgv(0)).toThrow(/invalid pid/);
    expect(() => buildTaskkillArgv(-5)).toThrow(/invalid pid/);
    expect(() => buildTaskkillArgv(1.5)).toThrow(/invalid pid/);
    expect(() => buildTaskkillArgv(Number.NaN)).toThrow(/invalid pid/);
    expect(() => buildTaskkillArgv("12 /IM x" as unknown as number)).toThrow(/invalid pid/);
  });
});

describe("cli-runner: finishRun (H10)", () => {
  it("is ok on exit 0 with no artefact check", () => {
    expect(finishRun(result({}))).toEqual({ ok: true, status: "ok", reason: null });
  });

  it("flags a timeout without a verdict", () => {
    const o = finishRun(result({ timedOut: true, exitCode: null, signal: "SIGKILL" }));
    expect(o.ok).toBe(false);
    expect(o.status).toBe("timeout");
    expect(o.reason).toMatch(/TIMEOUT/);
  });

  it("flags a failed verdict even though the kill left exitCode null", () => {
    const o = finishRun(result({ earlySignal: "failed", exitCode: null, signal: "SIGKILL" }));
    expect(o.ok).toBe(false);
    expect(o.status).toBe("failed-verdict");
  });

  it("a successful verdict is ok despite the deliberate kill", () => {
    const o = finishRun(result({ earlySignal: "successful", exitCode: null, signal: "SIGKILL" }));
    expect(o.ok).toBe(true);
  });

  it("flags a non-zero exit", () => {
    const o = finishRun(result({ exitCode: 3 }));
    expect(o.status).toBe("nonzero-exit");
    expect(o.reason).toContain("exit code 3");
  });

  it("flags a signal death without timeout as non-zero exit", () => {
    const o = finishRun(result({ exitCode: null, signal: "SIGSEGV" }));
    expect(o.status).toBe("nonzero-exit");
    expect(o.reason).toContain("SIGSEGV");
  });

  it("flags launcher-stuck signals", () => {
    expect(finishRun(result({ earlySignal: "stuck:launcher-picker", exitCode: null })).status).toBe("stuck");
  });

  it("exit 0 but a failing artefact check is an error with the detail", () => {
    const o = finishRun(result({}), () => ({ ok: false, detail: "0 files written" }));
    expect(o.ok).toBe(false);
    expect(o.status).toBe("no-artefacts");
    expect(o.reason).toContain("exit 0 but no output produced");
    expect(o.reason).toContain("0 files written");
  });

  it("artefact check only runs when the process side looks fine", () => {
    let ran = false;
    const o = finishRun(result({ exitCode: 1 }), () => {
      ran = true;
      return { ok: true };
    });
    expect(ran).toBe(false);
    expect(o.status).toBe("nonzero-exit");
  });

  it("a throwing artefact check is reported, not propagated", () => {
    const o = finishRun(result({}), () => {
      throw new Error("EACCES");
    });
    expect(o.status).toBe("no-artefacts");
    expect(o.reason).toContain("EACCES");
  });
});

describe("cli-runner: timeout kills the process tree before resolving (H11)", () => {
  it("calls killTree with the integer pid, and resolves only after it completes", async () => {
    const killedPids: number[] = [];
    let killResolvedAt = 0;
    const res = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", IDLE_SCRIPT],
      timeoutMs: 500,
      killTree: async (pid) => {
        killedPids.push(pid);
        await new Promise((r) => setTimeout(r, 150));
        killResolvedAt = Date.now();
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      },
    });
    const resolvedAt = Date.now();
    expect(res.timedOut).toBe(true);
    expect(killedPids).toHaveLength(1);
    expect(Number.isSafeInteger(killedPids[0])).toBe(true);
    expect(killedPids[0]).toBeGreaterThan(0);
    expect(killResolvedAt).toBeGreaterThan(0);
    expect(resolvedAt).toBeGreaterThanOrEqual(killResolvedAt);
  }, 15_000);

  it("early-signal path also goes through killTree", async () => {
    const killedPids: number[] = [];
    const res = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", IDLE_SCRIPT],
      timeoutMs: 15_000,
      pollSignal: { intervalMs: 50, check: () => "successful" },
      killTree: async (pid) => {
        killedPids.push(pid);
      },
    });
    expect(res.earlySignal).toBe("successful");
    expect(res.timedOut).toBe(false);
    expect(killedPids).toHaveLength(1);
  }, 15_000);

  it("a normal exit never invokes killTree", async () => {
    let calls = 0;
    const res = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", "process.exit(0)"],
      timeoutMs: 15_000,
      killTree: async () => {
        calls += 1;
      },
    });
    expect(res.exitCode).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("cli-runner: killProcessTree (real taskkill on win32)", () => {
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("kills a node parent AND its grandchild — the Workbench-behind-launcher shape", async () => {
    const parent = spawn(
      process.execPath,
      [
        "-e",
        'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"]);process.stdout.write(String(c.pid));setInterval(()=>{},1000)',
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const grand = await new Promise<number>((res, rej) => {
      const t = setTimeout(() => rej(new Error("no grandchild pid")), 10_000);
      parent.stdout.once("data", (d: Buffer) => {
        clearTimeout(t);
        res(parseInt(String(d).trim(), 10));
      });
    });
    expect(alive(parent.pid!)).toBe(true);
    expect(alive(grand)).toBe(true);
    await killProcessTree(parent.pid!);
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(parent.pid!)).toBe(false);
    expect(alive(grand)).toBe(false);
  }, 20_000);
});
