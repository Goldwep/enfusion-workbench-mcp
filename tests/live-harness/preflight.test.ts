import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLease } from "../../src/workbench/lease.js";
import { Lane } from "../../scripts/live/lane.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  INSTRUCTION_LEASE,
  SCRIPT_AUTHORIZE_ALL,
  SCRIPT_AUTHORIZE_ALL_NOTE,
  INSTRUCTION_PORT,
  INSTRUCTION_PROBE_MUT,
  INSTRUCTION_RUNNING,
  INSTRUCTION_U3_PLANT,
  U3_PLANT_FOLDER,
  INSTRUCTION_U14_THROWAWAY,
  U14_THROWAWAY_FOLDER,
  capturedProjectName,
  deniedSwitch,
  deniedSwitches,
  leasePurpose,
  main,
  newestSessionLog,
  openedProjectFromLog,
  runPreflight,
  sameProject,
  stepAssertProject,
  stepLaunch,
  stepPortOwner,
  stepProbeQueue,
  stepWorkbenchRunning,
  validateQueue,
  variantLaunch,
  type PreflightContext,
} from "../../scripts/live/preflight.js";
import type { ExecFn } from "../../scripts/live/win.js";

const QUEUE = [
  {
    id: "P1",
    timeout_ms: 10_000,
    expected: "Ok",
    kill_criterion: "no answer in 10 s",
    side_effects: [],
    rollback: "none",
    risk_class: "read-only",
  },
  {
    id: "P2",
    timeout_ms: 10_000,
    expected: "Ok",
    kill_criterion: "no answer in 10 s",
    side_effects: ["Worlds/tiny.layer"],
    rollback: "snapshot restore",
    risk_class: "reversible",
  },
];

/** Never called on this platform; any call is a test failure. */
const NO_EXEC: ExecFn = (file) => {
  throw new Error(`unexpected exec of ${file}`);
};

function setup(): { root: string; ctx: (o?: Partial<PreflightContext>) => PreflightContext } {
  const root = mkdtempSync(join(tmpdir(), "emcp-pre-"));
  const sandbox = join(root, "EMCP2_sandbox");
  mkdirSync(join(sandbox, "Worlds"), { recursive: true });
  writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "GameProject {\n}\n");
  writeFileSync(join(sandbox, "Worlds", "tiny.ent"), "x");
  const queuePath = join(root, "001-queue.json");
  writeFileSync(queuePath, JSON.stringify(QUEUE));
  const ctx = (o: Partial<PreflightContext> = {}): PreflightContext => ({
    variant: "default",
    lane: new Lane({
      id: "pre",
      leasePath: join(root, "lease.json"),
      markerPath: join(root, "marker"),
    }),
    purpose: "test",
    really: false,
    platform: "linux",
    workbenchPath: join(root, "tools"),
    gamePath: join(root, "game"),
    port: 5775,
    sandboxDir: sandbox,
    gproj: join(sandbox, "EMCP2_sandbox.gproj"),
    artifactsDir: join(root, "artifacts"),
    ledgerMetaPath: join(root, "ledger.meta.json"),
    queuePath,
    snapshotPaths: null,
    registryKey: null,
    u12Passed: false,
    lint: "passed",
    probePack: false,
    headlessArgs: [],
    launcherKnowsSandbox: false,
    ownerYesAboveMutating: false,
    openedProjectPattern: null,
    sessionLog: null,
    exec: NO_EXEC,
    powershell: () => Promise.reject(new Error("unexpected PowerShell")),
    now: () => new Date("2026-10-01T10:00:00Z"),
    state: {},
    ...o,
  });
  return { root, ctx };
}

describe("runPreflight on a non-Windows host", () => {
  it("runs all nine steps as a dry run with the Windows steps skipped", async () => {
    const { root, ctx } = setup();
    try {
      const c = ctx();
      const r = await runPreflight(c);
      expect(r.ok).toBe(true);
      expect(r.results.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const s of r.results.filter((x) => [2, 3, 4, 5, 8, 9].includes(x.step))) {
        expect(s.skipped).toBe(true);
      }
      expect(r.results[3].detail).toContain("dry run");
      expect(r.results[5].detail).toContain("shipped handler set");
      expect(r.results[7].detail).toContain(" -gproj ");
      // A dry run acquires nothing and writes nothing.
      expect(c.lane.status().lease.state).toBe("free");
      expect(c.state.snapshotFile).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports skipped (not dry run) for Windows steps when --really is given", async () => {
    const { root, ctx } = setup();
    try {
      const r = await runPreflight(ctx({ really: true }));
      expect(r.ok).toBe(true);
      expect(r.results[2].detail).toContain("skipped: real operation is Windows-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at step 1 when another session holds the lease", async () => {
    const { root, ctx } = setup();
    try {
      acquireLease(join(root, "lease.json"), {
        session: "registered:7",
        purpose: "registered-server",
      });
      const r = await runPreflight(ctx());
      expect(r.ok).toBe(false);
      expect(r.results).toHaveLength(1);
      expect(r.results[0].instruction).toBe(INSTRUCTION_LEASE);
      expect(r.results[0].detail).toContain("registered:7");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at step 6 when the Enforce lint result is not confirmed", async () => {
    const { root, ctx } = setup();
    try {
      const r = await runPreflight(ctx({ lint: null }));
      expect(r.results.map((s) => s.ok)).toEqual([true, true, true, true, true, false]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at step 7 without a probe queue", async () => {
    const { root, ctx } = setup();
    try {
      const r = await runPreflight(ctx({ queuePath: null }));
      expect(r.results.at(-1)).toMatchObject({ step: 7, ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("declares no handler set for the headless variant and needs the launcher entry condition", async () => {
    const { root, ctx } = setup();
    try {
      const r = await runPreflight(ctx({ variant: "headless-cli", lint: null }));
      expect(r.results[5].detail).toContain("handler set: none (headless CLI");
      expect(r.results.at(-1)).toMatchObject({ step: 8, ok: false });
      expect(r.results.at(-1)!.detail).toContain("OA-3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("variantLaunch", () => {
  it("passes no project for the launcher walk", () => {
    const { root, ctx } = setup();
    try {
      const plan = variantLaunch(ctx({ variant: "launcher-walk" }));
      expect(typeof plan).not.toBe("string");
      expect((plan as { args: string[] }).args).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses -forceSettings in the default variant before U12 has passed", () => {
    const { root, ctx } = setup();
    try {
      expect(variantLaunch(ctx({ forceSettings: "s.ini" }))).toContain("U12");
      const plan = variantLaunch(ctx({ forceSettings: "s.ini", u12Passed: true }));
      expect((plan as { args: string[] }).args.slice(2)).toEqual(["-forceSettings", "s.ini"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses -forceSettings in the scratch-profile variant and requires it", () => {
    const { root, ctx } = setup();
    try {
      expect(variantLaunch(ctx({ variant: "scratch-profile" }))).toContain("--force-settings");
      const plan = variantLaunch(ctx({ variant: "scratch-profile", forceSettings: "s.ini" }));
      expect((plan as { args: string[] }).args).toContain("-forceSettings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("on a real run refuses a --force-settings file that is missing or outside the artifacts folder (m-4)", () => {
    const { root, ctx } = setup();
    try {
      const artifacts = join(root, "artifacts");
      mkdirSync(artifacts, { recursive: true });
      const inside = join(artifacts, "scratch.ini");
      writeFileSync(inside, "[World%20Editor]\nScriptDebugMode=false\n");
      const outside = join(root, "outside.ini");
      writeFileSync(outside, "x");
      const real = { u12Passed: true, really: true };
      expect(
        variantLaunch(ctx({ ...real, forceSettings: join(artifacts, "missing.ini") })),
      ).toMatch(/does not exist/);
      expect(variantLaunch(ctx({ ...real, forceSettings: outside }))).toMatch(
        /not inside the artifacts folder/,
      );
      expect(
        variantLaunch(ctx({ ...real, variant: "scratch-profile", forceSettings: outside })),
      ).toMatch(/not inside the artifacts folder/);
      const plan = variantLaunch(ctx({ ...real, forceSettings: inside }));
      expect((plan as { args: string[] }).args.slice(2)).toEqual(["-forceSettings", inside]);
      // A dry run builds the plan without looking at the file.
      expect(typeof variantLaunch(ctx({ u12Passed: true, forceSettings: outside }))).not.toBe(
        "string",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends the headless arguments under test and refuses deny-listed switches", () => {
    const { root, ctx } = setup();
    try {
      const plan = variantLaunch(
        ctx({
          variant: "headless-cli",
          launcherKnowsSandbox: true,
          headlessArgs: ["-exitAfterInit"],
        }),
      );
      expect((plan as { args: string[] }).args.at(-1)).toBe("-exitAfterInit");
      expect(
        variantLaunch(
          ctx({
            variant: "headless-cli",
            launcherKnowsSandbox: true,
            headlessArgs: ["-clearSettings"],
          }),
        ),
      ).toContain("deny list");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Windows step logic with scripted command output", () => {
  function liveCtx(
    ctx: (o?: Partial<PreflightContext>) => PreflightContext,
    exec: ExecFn,
  ): PreflightContext {
    const c = ctx({ really: true, platform: "win32", exec });
    c.lane.start("test");
    return c;
  }

  it("stops at step 3 on a Workbench this session did not start, terminating nothing", () => {
    const { root, ctx } = setup();
    try {
      const calls: string[][] = [];
      const c = liveCtx(ctx, (file, args) => {
        calls.push([file, ...args]);
        return '"ArmaReforgerWorkbenchSteamDiag.exe","5150","Console","1","900,000 K"\r\n';
      });
      const r = stepWorkbenchRunning(c);
      expect(r).toMatchObject({ step: 3, ok: false, instruction: INSTRUCTION_RUNNING });
      expect(calls.every((c2) => c2[0] === "tasklist")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts the Workbench this lane started", () => {
    const { root, ctx } = setup();
    try {
      const c = liveCtx(
        ctx,
        () => '"ArmaReforgerWorkbenchSteamDiag.exe","5150","Console","1","9 K"',
      );
      c.lane.record(5150, c.gproj);
      expect(stepWorkbenchRunning(c).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at step 4 on an orphaned CrashReporter holding the port", () => {
    const { root, ctx } = setup();
    try {
      const c = liveCtx(ctx, (file) =>
        file === "netstat"
          ? "  TCP    0.0.0.0:5775    0.0.0.0:0    LISTENING    3141\r\n  TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    4\r\n"
          : '"CrashReporter.exe","3141","Console","1","9 K"',
      );
      const r = stepPortOwner(c);
      expect(r).toMatchObject({ step: 4, ok: false, instruction: INSTRUCTION_PORT });
      expect(r.detail).toContain("CrashReporter.exe");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes step 4 when nothing listens on the port", () => {
    const { root, ctx } = setup();
    try {
      const c = liveCtx(ctx, () => "  TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    4\r\n");
      expect(stepPortOwner(c).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("validateQueue", () => {
  it("accepts read-only, reversible, mutating in order", () => {
    expect(validateQueue(QUEUE, false).map((q) => q.id)).toEqual(["P1", "P2"]);
  });

  it("rejects an out-of-order queue", () => {
    expect(() => validateQueue([QUEUE[1], QUEUE[0]], false)).toThrow("out of order");
  });

  it("rejects a risk class above mutating without the owner's yes", () => {
    const above = [{ ...QUEUE[0], id: "P9", risk_class: "destructive" }];
    expect(() => validateQueue(above, false)).toThrow("above mutating");
    expect(validateQueue(above, true)).toHaveLength(1);
  });
});

describe("openedProjectFromLog", () => {
  it("returns the first capture group of the recorded pattern", () => {
    const log = "x\nOpening project: C:/a/EMCP2_sandbox.gproj\ny";
    expect(openedProjectFromLog(log, "^Opening project: (.+)$")).toBe("C:/a/EMCP2_sandbox.gproj");
    expect(openedProjectFromLog(log, "^Nope (.+)$")).toBeNull();
  });
});

describe("opened-project name", () => {
  it("compares a captured name or path with the sandbox project's name, case ignored", () => {
    const gproj = join("T:", "addons", "EMCP2_sandbox", "EMCP2_sandbox.gproj");
    expect(capturedProjectName("emcp2_SANDBOX")).toBe("emcp2_SANDBOX");
    expect(capturedProjectName("C:/a/EMCP2_sandbox/EMCP2_sandbox.gproj")).toBe("EMCP2_sandbox");
    expect(capturedProjectName("C:\\a\\Projects\\EMCP2_sandbox")).toBe("EMCP2_sandbox");
    expect(sameProject("emcp2_SANDBOX", gproj)).toBe(true);
    expect(sameProject("C:/a/EMCP2_sandbox/EMCP2_sandbox.gproj", gproj)).toBe(true);
    expect(sameProject("OwnerMod", gproj)).toBe(false);
    expect(sameProject("EMCP2_sandbox_old", gproj)).toBe(false);
  });
});

describe("step 9 against the session log", () => {
  /** Real-mode context (win32, lease held) with a logs folder; the spawn happened at `launchedAt`. */
  function assertCtx(o: Partial<PreflightContext> = {}) {
    const { root, ctx } = setup();
    const logs = join(root, "logs");
    mkdirSync(logs);
    const c = ctx({
      really: true,
      platform: "win32",
      exec: NO_EXEC,
      logsPath: logs,
      sessionLog: null,
      sessionLogAuto: true,
      pollMs: 1,
      ...o,
    });
    c.lane.start("test");
    c.state.launchedAt = Date.now() - 1_000;
    return { root, logs, c };
  }
  const line = (name: string) =>
    `12:00:00.000 ENGINE : Using autosave directory: C:/U/x/Documents/My Games/ArmaReforgerWorkbench/profile/Projects/${name}/autosaves\n`;

  it("polls until a log born after the spawn names the project, with E13's pattern by default", async () => {
    const { root, logs, c } = assertCtx();
    try {
      let polls = 0;
      c.sleep = async () => {
        polls++;
        if (polls === 2) {
          mkdirSync(join(logs, "logs_2026-10-02_12-00-00"));
          writeFileSync(join(logs, "logs_2026-10-02_12-00-00", "console.log"), "starting\n");
        }
        if (polls === 4) {
          writeFileSync(
            join(logs, "logs_2026-10-02_12-00-00", "console.log"),
            `starting\n${line("emcp2_SANDBOX")}`,
          );
        }
      };
      const r = await stepAssertProject(c);
      expect(r).toMatchObject({ step: 9, ok: true });
      expect(r.detail).toContain("the sandbox project EMCP2_sandbox");
      expect(polls).toBe(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails at once on another project, and at the deadline when no line appears", async () => {
    const { root, logs, c } = assertCtx();
    try {
      mkdirSync(join(logs, "logs_2026-10-02_12-00-00"));
      writeFileSync(join(logs, "logs_2026-10-02_12-00-00", "console.log"), line("OwnerMod"));
      const sleep = vi.fn(async () => {});
      const wrong = await stepAssertProject({ ...c, sleep });
      expect(wrong.ok).toBe(false);
      expect(wrong.detail).toContain("names OwnerMod, not the sandbox project EMCP2_sandbox");
      expect(sleep).not.toHaveBeenCalled();

      writeFileSync(join(logs, "logs_2026-10-02_12-00-00", "console.log"), "no project line\n");
      let t = 0;
      const timed = await stepAssertProject({
        ...c,
        assertWaitMs: 5_000,
        clock: () => t,
        sleep: async () => {
          t += 1_000;
        },
      });
      expect(timed.ok).toBe(false);
      expect(timed.detail).toContain("before the deadline");
      expect(t).toBe(5_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never reads a log folder born before the spawn", async () => {
    const { root, logs, c } = assertCtx();
    try {
      mkdirSync(join(logs, "logs_2026-10-02_11-00-00"));
      writeFileSync(join(logs, "logs_2026-10-02_11-00-00", "console.log"), line("EMCP2_sandbox"));
      c.state.launchedAt = Date.now() + 60_000;
      let t = 0;
      const r = await stepAssertProject({
        ...c,
        assertWaitMs: 3_000,
        clock: () => t,
        sleep: async () => {
          t += 1_000;
        },
      });
      expect(r.ok).toBe(false);
      expect(r.detail).toContain("no session log born after this launch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("newestSessionLog", () => {
  it("accepts a log folder by birth time only, not by change time", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-logs-"));
    try {
      const old = join(root, "logs_2020-01-01_08-00-00");
      mkdirSync(old);
      writeFileSync(join(old, "console.log"), "old\n");
      await new Promise((r) => setTimeout(r, 50));
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      // A crash reporter writes into the old folder after the spawn: its change time moves.
      writeFileSync(join(old, "crash.dmp"), "x");
      expect(newestSessionLog(root, t0)).toBeNull();
      expect(newestSessionLog(root)).toBe(join(old, "console.log"));
      const fresh = join(root, "logs_2020-01-01_08-00-09");
      mkdirSync(fresh);
      writeFileSync(join(fresh, "console.log"), "new\n");
      expect(newestSessionLog(root, t0)).toBe(join(fresh, "console.log"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("deny-listed switches", () => {
  it("are one shared rule: the policy's cli_switches, by switch name, case ignored", () => {
    const policy = loadPolicy();
    expect(deniedSwitches(policy)).toEqual(
      expect.arrayContaining(["-clearsettings", "-wbbackendlogin", "-scriptauthorizeall"]),
    );
    expect(deniedSwitch(["-gproj", "x", "-CLEARSETTINGS=1"], policy)).toBe("-CLEARSETTINGS=1");
    expect(deniedSwitch(["-gproj", "-clearSettings.gproj"], policy)).toBeNull();
    expect(deniedSwitch(["-gproj", "x", "-exitAfterInit"], policy)).toBeNull();
  });
});

describe("scratch-profile extra arguments", () => {
  it("appends checked extra arguments after -forceSettings and refuses denied or project switches", () => {
    const { root, ctx } = setup();
    try {
      const base = { variant: "scratch-profile" as const, forceSettings: "s.ini" };
      const plan = variantLaunch(ctx({ ...base, extraArgs: ["-disableCrashReport", "-noThrow"] }));
      expect((plan as { args: string[] }).args.slice(2)).toEqual([
        "-forceSettings",
        "s.ini",
        "-disableCrashReport",
        "-noThrow",
      ]);
      expect((plan as { commandLine: string }).commandLine).toContain("-noThrow");
      expect(variantLaunch(ctx({ ...base, extraArgs: ["-scriptAuthorizeAll"] }))).toContain(
        "deny list",
      );
      expect(variantLaunch(ctx({ ...base, extraArgs: ["-gproj", "other.gproj"] }))).toContain(
        "would change the project",
      );
      expect(variantLaunch(ctx({ ...base, extraArgs: ["-forceSettings=x.ini"] }))).toContain(
        "would change the project",
      );
      expect(variantLaunch(ctx({ extraArgs: ["-noThrow"] }))).toContain(
        "only for the scratch-profile",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the mutating probe pack in the sandbox", () => {
  function withPack(sessionName: string | null) {
    const { root, ctx } = setup();
    const c = ctx();
    const dir = join(c.sandboxDir, "Scripts", "WorkbenchGame", "EnfusionCensus");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ECEN_ProbeMut.c"), "// mut");
    const q = join(root, "q.json");
    writeFileSync(
      q,
      JSON.stringify(sessionName === null ? QUEUE : { session: sessionName, probes: QUEUE }),
    );
    c.queuePath = q;
    return { root, c };
  }

  it("refuses the session at step 7 unless the queue is S-E's, P3-3's or P4-1's", () => {
    for (const s of ["S-C", "P4-2", null]) {
      const { root, c } = withPack(s);
      try {
        const r = stepProbeQueue(c);
        expect(r).toMatchObject({ step: 7, ok: false, instruction: INSTRUCTION_PROBE_MUT });
        expect(r.detail).toContain("ECEN_ProbeMut.c");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    // S-E (train #1b), P3-3 (train #2, DEC-051) and P4-1 (Phase 4's first sitting) carry the pack.
    for (const allowed of ["S-E", "P3-3", "P4-1"]) {
      const { root, c } = withPack(allowed);
      try {
        const r = stepProbeQueue(c);
        expect(r.ok).toBe(true);
        expect(r.detail).toContain(`(session ${allowed})`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("refuses the launch at step 8 too, before anything is spawned", () => {
    const { root, c } = withPack("S-C");
    try {
      c.state.queueSession = "S-C";
      const r = stepLaunch({ ...c, really: true, platform: "win32" });
      expect(r).toMatchObject({ step: 8, ok: false, instruction: INSTRUCTION_PROBE_MUT });
      expect(c.state.startedPid).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("S-A's U14 throwaway folder in the sandbox (B2)", () => {
  function withThrowaway(sessionName: string) {
    const { root, ctx } = setup();
    const c = ctx();
    mkdirSync(join(c.sandboxDir, "Scripts", "WorkbenchGame", U14_THROWAWAY_FOLDER), {
      recursive: true,
    });
    const q = join(root, "q.json");
    writeFileSync(q, JSON.stringify({ session: sessionName, probes: QUEUE }));
    c.queuePath = q;
    return { root, c };
  }

  it("refuses every other session at step 7 and step 8, before anything is spawned", () => {
    const { root, c } = withThrowaway("S-C");
    try {
      const r = stepProbeQueue(c);
      expect(r).toMatchObject({ step: 7, ok: false, instruction: INSTRUCTION_U14_THROWAWAY });
      expect(r.detail).toContain(U14_THROWAWAY_FOLDER);
      c.state.queueSession = "S-C";
      const l = stepLaunch({ ...c, really: true, platform: "win32" });
      expect(l).toMatchObject({ step: 8, ok: false, instruction: INSTRUCTION_U14_THROWAWAY });
      expect(c.state.startedPid).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets S-A pass only when the folder is its own open plant", () => {
    const { root, c } = withThrowaway("S-A");
    try {
      expect(stepProbeQueue(c).ok).toBe(false);
      expect(stepProbeQueue({ ...c, ownU14Plant: true }).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    const other = withThrowaway("S-B");
    try {
      expect(stepProbeQueue({ ...other.c, ownU14Plant: true }).ok).toBe(false);
    } finally {
      rmSync(other.root, { recursive: true, force: true });
    }
  });
});

describe("preflight.ts --until", () => {
  it("runs steps 1 to 7 only, launches nothing and says so", async () => {
    const { root, ctx } = setup();
    const lines: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((m: unknown) => void lines.push(String(m)));
    try {
      const c = ctx();
      const code = await main([
        "--variant",
        "scratch-profile",
        "--purpose",
        "test",
        "--queue",
        c.queuePath!,
        "--sandbox",
        c.sandboxDir,
        "--workbench-path",
        c.workbenchPath,
        "--game-path",
        c.gamePath,
        "--session-log",
        join(root, "none.log"),
        "--ledger-meta",
        c.ledgerMetaPath,
        "--lease-path",
        join(root, "lease.json"),
        "--marker-path",
        join(root, "marker"),
        "--until",
        "7",
      ]);
      expect(code).toBe(0);
      const out = lines.join("\n");
      expect(out).toContain("scratch-profile, steps 1 to 7");
      expect(out).toMatch(/\] 7 probe queue: /);
      expect(out).not.toMatch(/\] 8 launch/);
      expect(await main(["--purpose", "x", "--until", "10"])).toBe(2);
    } finally {
      log.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("S-C's U3 plant folder in the sandbox (DEC-032, S-C read B1)", () => {
  it("refuses every session at step 7 and step 8, before anything is spawned", () => {
    for (const session of ["S-A", "S-B", "S-C"]) {
      const { root, ctx } = setup();
      try {
        const c = ctx();
        mkdirSync(join(c.sandboxDir, "Scripts", "WorkbenchGame", U3_PLANT_FOLDER), {
          recursive: true,
        });
        const q = join(root, "q.json");
        writeFileSync(q, JSON.stringify({ session, probes: QUEUE }));
        c.queuePath = q;
        const r = stepProbeQueue({ ...c, ownU14Plant: true });
        expect(r).toMatchObject({ step: 7, ok: false, instruction: INSTRUCTION_U3_PLANT });
        expect(r.detail).toContain(U3_PLANT_FOLDER);
        const l = stepLaunch({ ...c, really: true, platform: "win32" });
        expect(l).toMatchObject({ step: 8, ok: false, instruction: INSTRUCTION_U3_PLANT });
        expect(c.state.startedPid).toBeUndefined();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});

describe("-scriptAuthorizeAll on the owner's go (plan 5.7, DEC-041)", () => {
  const go = {
    scriptAuthorizeAll: true,
    ownerGoScriptAuthorizeAll: true,
    u12Passed: true,
    forceSettings: "s.ini",
  };

  it("is refused without the owner-go switch, naming plan 5.7 and the owner's go", () => {
    const { root, ctx } = setup();
    try {
      const r = variantLaunch(ctx({ ...go, ownerGoScriptAuthorizeAll: false }));
      expect(typeof r).toBe("string");
      expect(r).toContain("plan 5.7");
      expect(r).toContain("owner's go");
      expect(r).toContain("--owner-go-script-authorize-all");
      const s = stepLaunch(ctx({ ...go, ownerGoScriptAuthorizeAll: false }));
      expect(s).toMatchObject({ step: 8, ok: false });
      expect(leasePurpose(ctx({ ...go, ownerGoScriptAuthorizeAll: false }))).toBe("test");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is refused without --force-settings or without --u12-passed (never the owner's profile)", () => {
    const { root, ctx } = setup();
    try {
      for (const o of [{ forceSettings: undefined }, { u12Passed: false }]) {
        const r = variantLaunch(ctx({ ...go, ...o }));
        expect(r).toContain("plan 5.7");
        expect(r).toContain("--u12-passed with --force-settings");
      }
      // Only the default variant carries it.
      expect(variantLaunch(ctx({ ...go, variant: "scratch-profile" }))).toContain(
        "only in the default variant",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never comes through --extra-args, even with the owner's go", () => {
    const { root, ctx } = setup();
    try {
      const extra = { extraArgs: ["-scriptAuthorizeAll"] };
      expect(variantLaunch(ctx({ ...go, scriptAuthorizeAll: false, ...extra }))).toContain(
        "only for the scratch-profile",
      );
      expect(variantLaunch(ctx({ ...go, ...extra }))).toContain("only for the scratch-profile");
      expect(
        variantLaunch(
          ctx({
            variant: "scratch-profile",
            forceSettings: "s.ini",
            ownerGoScriptAuthorizeAll: true,
            ...extra,
          }),
        ),
      ).toContain("deny list");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is appended to the default launch with all three, and step 8 and the lease purpose say so", async () => {
    const { root, ctx } = setup();
    try {
      const plan = variantLaunch(ctx(go));
      expect(typeof plan).not.toBe("string");
      const p = plan as { args: string[]; commandLine: string };
      expect(p.args.slice(2)).toEqual(["-forceSettings", "s.ini", SCRIPT_AUTHORIZE_ALL]);
      expect(p.commandLine).toContain("-scriptAuthorizeAll");
      const s = stepLaunch(ctx(go));
      expect(s.ok).toBe(true);
      expect(s.detail).toContain("`-scriptAuthorizeAll` on the owner's go (DEC-041)");
      const c = ctx(go);
      expect(leasePurpose(c)).toBe(`test [${SCRIPT_AUTHORIZE_ALL_NOTE}]`);
      const r = await runPreflight(c);
      expect(r.ok).toBe(true);
      expect(r.results[0].detail).toContain(SCRIPT_AUTHORIZE_ALL_NOTE);
      expect(r.results[7].detail).toContain(SCRIPT_AUTHORIZE_ALL_NOTE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the deny list refusing it everywhere else", () => {
    const { root, ctx } = setup();
    try {
      expect(deniedSwitch(["-gproj", "x", "-scriptAuthorizeAll"], loadPolicy())).toBe(
        "-scriptAuthorizeAll",
      );
      expect(
        variantLaunch(
          ctx({
            ownerGoScriptAuthorizeAll: true,
            variant: "headless-cli",
            launcherKnowsSandbox: true,
            headlessArgs: ["-scriptAuthorizeAll"],
          }),
        ),
      ).toContain("deny list");
      // Without --script-authorize-all the default launch carries no such token.
      const plan = variantLaunch(ctx({ ...go, scriptAuthorizeAll: false }));
      expect((plan as { args: string[] }).args).not.toContain(SCRIPT_AUTHORIZE_ALL);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is read from its CLI switches only: refused without the go, accepted with all three", async () => {
    const { root, ctx } = setup();
    const lines: string[] = [];
    const errs: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((m: unknown) => void lines.push(String(m)));
    const err = vi
      .spyOn(console, "error")
      .mockImplementation((m: unknown) => void errs.push(String(m)));
    try {
      const c = ctx();
      const base = [
        "--purpose",
        "test",
        "--queue",
        c.queuePath!,
        "--sandbox",
        c.sandboxDir,
        "--workbench-path",
        c.workbenchPath,
        "--game-path",
        c.gamePath,
        "--session-log",
        join(root, "none.log"),
        "--ledger-meta",
        c.ledgerMetaPath,
        "--lease-path",
        join(root, "lease.json"),
        "--marker-path",
        join(root, "marker"),
        "--until",
        "8",
        "--force-settings",
        "s.ini",
        "--u12-passed",
        "--lint",
        "passed",
      ];
      expect(await main([...base, "--script-authorize-all"])).toBe(2);
      expect(errs.join("\n")).toContain("plan 5.7");
      expect(await main([...base, "--extra-args", '["-scriptAuthorizeAll"]'])).toBe(1);
      expect(lines.join("\n")).toContain("only for the scratch-profile");
      lines.length = 0;
      expect(
        await main([...base, "--script-authorize-all", "--owner-go-script-authorize-all"]),
      ).toBe(0);
      const out = lines.join("\n");
      expect(out).toMatch(/\] 8 launch: .*-scriptAuthorizeAll/);
      expect(out).toContain("on the owner's go (DEC-041)");
    } finally {
      log.mockRestore();
      err.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
