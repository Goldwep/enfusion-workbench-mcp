import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLease } from "../../src/workbench/lease.js";
import { Lane } from "../../scripts/live/lane.js";
import {
  INSTRUCTION_LEASE,
  INSTRUCTION_PORT,
  INSTRUCTION_RUNNING,
  openedProjectFromLog,
  runPreflight,
  stepPortOwner,
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
