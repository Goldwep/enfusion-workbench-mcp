import { describe, it, expect, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lane } from "../../scripts/live/lane.js";
import {
  DEFAULT_NOISE_LIST,
  CLOSE_ALL_SCRIPT,
  closeStep,
  nameCloseWindow,
  compareReg,
  danglingStartedMarkers,
  leaseStartMs,
  main,
  nextSessionNumber,
  parsePartialSteps,
  probePackStep,
  readRegFile,
  recordForcedKill,
  releaseStep,
  resolveNoiseList,
  runPostflight,
  sessionLogSkeleton,
  sittingFolders,
  W1_NOISE_LIST,
  w1NoiseHint,
  writeGracefulExit,
  type PostflightContext,
} from "../../scripts/live/postflight.js";
import { takeSnapshot } from "../../scripts/live/snapshot.js";

function setup(): { root: string; ctx: (o?: Partial<PostflightContext>) => PostflightContext } {
  const root = mkdtempSync(join(tmpdir(), "emcp-post-"));
  const sandbox = join(root, "sandbox");
  mkdirSync(sandbox);
  writeFileSync(join(sandbox, "a.txt"), "a");
  const before = join(root, "before.json");
  writeFileSync(before, JSON.stringify(takeSnapshot(sandbox, ["a.txt", "Backup"])));
  const ctx = (o: Partial<PostflightContext> = {}): PostflightContext => ({
    lane: new Lane({
      id: "post",
      leasePath: join(root, "lease.json"),
      markerPath: join(root, "marker"),
    }),
    really: false,
    platform: "linux",
    beforeManifest: before,
    noise: ["Backup/"],
    registryBefore: null,
    registryKey: null,
    closeTimeoutMs: 1_000,
    artifactsDir: join(root, "artifacts"),
    exec: (file) => {
      throw new Error(`unexpected exec of ${file}`);
    },
    powershell: () => Promise.reject(new Error("unexpected PowerShell")),
    windowTitles: () => Promise.reject(new Error("unexpected window probe")),
    now: () => new Date("2026-10-01T12:00:00Z"),
    ...o,
  });
  return { root, ctx };
}

describe("runPostflight", () => {
  it("reports net-zero with expected noise and changes nothing on a dry run", async () => {
    const { root, ctx } = setup();
    try {
      mkdirSync(join(root, "sandbox", "Backup"));
      writeFileSync(join(root, "sandbox", "Backup", "w.bak"), "noise");
      const c = ctx();
      c.lane.start("S-C");
      const r = await runPostflight(c);
      expect(r.steps.map((s) => [s.step, s.ok])).toEqual([
        [1, true],
        [2, true],
        [3, true],
        [4, true],
        [5, true],
      ]);
      expect(r.steps[0].detail).toContain("explained 1 difference");
      expect(r.steps[3]).toMatchObject({ name: "probe pack", ok: true });
      expect(r.steps[3].detail).toContain("no ECEN_ProbeMut*.c file");
      expect(r.steps[4].skipped).toBe(true);
      expect(c.lane.holdsLease()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails net-zero on an unexpected change and still releases with really", async () => {
    const { root, ctx } = setup();
    try {
      writeFileSync(join(root, "sandbox", "a.txt"), "changed");
      const c = ctx({ really: true });
      c.lane.start("S-C");
      const r = await runPostflight(c);
      expect(r.steps[0].ok).toBe(false);
      expect(r.steps[0].detail).toContain("a.txt");
      expect(r.released).toBe(true);
      expect(existsSync(join(root, "lease.json"))).toBe(false);
      expect(existsSync(join(root, "marker"))).toBe(true); // marker persists for the programme (plan 5.1)
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("extra snapshot roots", () => {
  it("diffs every extra manifest like the first and names the root that changed", async () => {
    const { root, ctx } = setup();
    try {
      const decoy = join(root, "EMCP2_decoy");
      mkdirSync(decoy);
      writeFileSync(join(decoy, "EMCP2_decoy.gproj"), "GameProject {\n}\n");
      const extra = join(root, "decoy-before.json");
      writeFileSync(extra, JSON.stringify(takeSnapshot(decoy, ["EMCP2_decoy.gproj"])));
      const clean = await runPostflight(ctx({ extraManifests: [extra] }));
      expect(clean.steps[0].ok).toBe(true);
      writeFileSync(join(decoy, "EMCP2_decoy.gproj"), 'GameProject {\n ID "changed"\n}\n');
      const r = await runPostflight(ctx({ extraManifests: [extra] }));
      expect(r.steps[0].ok).toBe(false);
      expect(r.steps[0].detail).toContain(`[${decoy}]`);
      expect(r.steps[0].detail).toContain("EMCP2_decoy.gproj");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("graceful-exit evidence", () => {
  /** A win32 lane holding the lease with pid 4242 recorded; tasklist finds nothing (the pid is gone). */
  function gone(root: string, ctx: (o?: Partial<PostflightContext>) => PostflightContext) {
    const calls: string[][] = [];
    const c = ctx({
      really: true,
      platform: "win32",
      exec: (file, args) => {
        calls.push([file, ...args]);
        if (file !== "tasklist") throw new Error(`unexpected exec of ${file}`);
        return "INFO: No tasks are running which match the specified criteria.\r\n";
      },
    });
    c.lane.start("S-B");
    c.lane.record(4242, join(root, "sandbox", "x.gproj"));
    return { c, calls };
  }

  it("makes the exit graceful when the session script saw the close of the recorded pid", async () => {
    const { root, ctx } = setup();
    try {
      const { c, calls } = gone(root, ctx);
      const file = join(root, "graceful.json");
      writeGracefulExit(file, {
        lane: c.lane.session,
        pid: 4242,
        closedAt: new Date(Date.now() + 1_000),
        how: "CloseMainWindow, exit seen",
      });
      const r = await runPostflight({ ...c, gracefulExitEvidence: file, now: () => new Date() });
      expect(r.graceful).toBe(true);
      expect(r.steps[1].detail).toContain("pid 4242 is no longer running");
      expect(r.steps[1].detail).toContain("graceful exit of pid 4242 seen by the session script");
      // Nothing but process listings ran: no close was sent, nothing was killed.
      expect(calls.every((x) => x[0] === "tasklist")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a record of another pid, another lane, or a close older than the lease", async () => {
    const { root, ctx } = setup();
    try {
      const { c } = gone(root, ctx);
      const write = (
        name: string,
        over: { lane?: string; pid?: number; closedAt?: Date },
      ): string => {
        const f = join(root, name);
        writeGracefulExit(f, {
          lane: over.lane ?? c.lane.session,
          pid: over.pid ?? 4242,
          closedAt: over.closedAt ?? new Date(Date.now() + 1_000),
          how: "test",
        });
        return f;
      };
      const cases: Array<[string, string]> = [
        [write("other-pid.json", { pid: 5151 }), "not the pid this lane recorded"],
        [write("other-lane.json", { lane: "v2-harness:other" }), "is not v2-harness:post"],
        [
          write("old.json", { closedAt: new Date("2020-01-01T00:00:00Z") }),
          "older than this lane's lease",
        ],
      ];
      // A real post-flight releases the lease at its end: take it again for the next case.
      const again = (): void => {
        if (!c.lane.holdsLease()) {
          c.lane.start("S-B");
          c.lane.record(4242, null);
        }
      };
      for (const [file, why] of cases) {
        again();
        const r = await runPostflight({ ...c, gracefulExitEvidence: file, now: () => new Date() });
        expect(r.graceful).toBe(false);
        expect(r.steps[1].detail).toContain(why);
      }
      const bad = join(root, "bad.json");
      writeFileSync(bad, '{"kind":"something-else"}');
      again();
      const r = await runPostflight({ ...c, gracefulExitEvidence: bad, now: () => new Date() });
      expect(r.graceful).toBe(false);
      expect(r.steps[1].detail).toContain('kind is not "graceful-exit"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is not read on a dry run's close, and the registry comparison stays not valid", async () => {
    const { root, ctx } = setup();
    try {
      const c = ctx();
      c.lane.start("S-B");
      c.lane.record(4242, null);
      const file = join(root, "graceful.json");
      writeGracefulExit(file, { lane: c.lane.session, pid: 4242, closedAt: new Date(), how: "t" });
      const r = await runPostflight({ ...c, gracefulExitEvidence: file });
      expect(r.graceful).toBe(false);
      expect(r.steps[1].detail).toContain("would read the graceful-exit record");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never replaces an existing record", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-ge-"));
    try {
      const f = join(dir, "g.json");
      writeGracefulExit(f, { lane: "v2-harness:a", pid: 1, closedAt: new Date(), how: "t" });
      expect(() =>
        writeGracefulExit(f, { lane: "v2-harness:a", pid: 2, closedAt: new Date(), how: "t" }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("probe pack step", () => {
  function sandboxWithMut(root: string, name = "EMCP2_sandbox"): string {
    const sandbox = join(root, name);
    const dir = join(sandbox, "Scripts", "WorkbenchGame", "EnfusionCensus");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ECEN_ProbeMut.c"), "// mut");
    writeFileSync(join(dir, "ECEN_ProbeMutGuard.c"), "// mut");
    writeFileSync(join(dir, "ECEN_Probe.c"), "// read-only");
    writeFileSync(join(dir, "notes.txt"), "kept");
    return sandbox;
  }

  it("reports an installed mutating pack as a failure when no removal was asked", () => {
    const { root, ctx } = setup();
    try {
      const sandbox = sandboxWithMut(root);
      const s = probePackStep(ctx({ sandboxDir: sandbox }), false);
      expect(s.ok).toBe(false);
      expect(s.detail).toContain("ECEN_ProbeMut.c, ECEN_ProbeMutGuard.c");
      expect(
        existsSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionCensus", "ECEN_ProbeMut.c")),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("S-E's post-flight deletes only ECEN_ProbeMut*.c and checks they are gone", async () => {
    const { root, ctx } = setup();
    try {
      const sandbox = sandboxWithMut(root);
      const dir = join(sandbox, "Scripts", "WorkbenchGame", "EnfusionCensus");
      // Dry run: says what it would delete, deletes nothing.
      const dry = probePackStep(ctx({ sandboxDir: sandbox, removeProbeMut: true }), false);
      expect(dry).toMatchObject({ ok: true, skipped: true });
      expect(existsSync(join(dir, "ECEN_ProbeMut.c"))).toBe(true);
      // Real run, lease held, Workbench gone.
      const c = ctx({ sandboxDir: sandbox, removeProbeMut: true, really: true, platform: "win32" });
      c.lane.start("S-E");
      const r = await runPostflight(c);
      const step = r.steps.find((s) => s.name === "probe pack")!;
      expect(step).toMatchObject({ step: 4, ok: true });
      expect(step.detail).toContain("none is left");
      expect(readdirSync(dir).sort()).toEqual(["ECEN_Probe.c", "notes.txt"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to delete outside the 2.0 sandbox or while Workbench still runs", () => {
    const { root, ctx } = setup();
    try {
      const other = sandboxWithMut(root, "Test1_sandbox");
      const c = ctx({ sandboxDir: other, removeProbeMut: true, really: true, platform: "win32" });
      c.lane.start("S-E");
      const s = probePackStep(c, false);
      expect(s.ok).toBe(false);
      expect(s.detail).toContain("not the 2.0 sandbox");
      const mine = sandboxWithMut(root);
      const running = probePackStep({ ...c, sandboxDir: mine }, true);
      expect(running.ok).toBe(false);
      expect(running.detail).toContain("still running");
      for (const sb of [other, mine]) {
        const dir = join(sb, "Scripts", "WorkbenchGame", "EnfusionCensus");
        expect(readdirSync(dir)).toContain("ECEN_ProbeMut.c");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("probe pack step with --remove-probe (S-D)", () => {
  const NONE = "INFO: No tasks are running which match the specified criteria.\r\n";
  const WB_ROW = '"ArmaReforgerWorkbenchSteamDiag.exe","4343","Console","1","100 K"\r\n';
  function sandboxWithPack(root: string, name = "EMCP2_sandbox"): { sandbox: string; dir: string } {
    const sandbox = join(root, name);
    const dir = join(sandbox, "Scripts", "WorkbenchGame", "EnfusionCensus");
    mkdirSync(dir, { recursive: true });
    for (const f of ["ECEN_Probe.c", "ECEN_ProbeEval.c", "ECEN_ProbeMut.c"]) {
      writeFileSync(join(dir, f), `// ${f}`);
    }
    writeFileSync(join(dir, "ECEN_Other.c"), "// not a probe script");
    writeFileSync(join(dir, "notes.txt"), "kept");
    return { sandbox, dir };
  }

  it("deletes every ECEN_Probe*.c once no Workbench image runs, checks them gone and records them", () => {
    const { root, ctx } = setup();
    try {
      const { sandbox, dir } = sandboxWithPack(root);
      // Dry run: says what it would delete, deletes nothing.
      const dry = probePackStep(ctx({ sandboxDir: sandbox, removeProbe: true }), false);
      expect(dry).toMatchObject({ ok: true, skipped: true });
      expect(dry.detail).toContain("ECEN_Probe.c, ECEN_ProbeEval.c, ECEN_ProbeMut.c");
      expect(readdirSync(dir)).toContain("ECEN_Probe.c");
      const c = ctx({
        sandboxDir: sandbox,
        removeProbe: true,
        really: true,
        platform: "win32",
        exec: () => NONE,
      });
      c.lane.start("S-D");
      const s = probePackStep(c, false);
      expect(s).toMatchObject({ step: 4, ok: true });
      expect(s.detail).toContain("none is left");
      expect(s.detail).not.toContain(root);
      expect(readdirSync(dir).sort()).toEqual(["ECEN_Other.c", "notes.txt"]);
      const records = readdirSync(join(root, "artifacts")).filter((f) =>
        f.startsWith("removed-probe-"),
      );
      expect(records.length).toBe(1);
      const rec = JSON.parse(readFileSync(join(root, "artifacts", records[0]), "utf-8")) as {
        removed: Array<{ file: string; sha256: string }>;
        left: string[];
        folder: string;
      };
      expect(rec.removed.map((r) => r.file)).toEqual([
        "ECEN_Probe.c",
        "ECEN_ProbeEval.c",
        "ECEN_ProbeMut.c",
      ]);
      expect(rec.removed.every((r) => /^[0-9a-f]{64}$/.test(r.sha256))).toBe(true);
      expect(rec.left).toEqual([]);
      expect(rec.folder).toContain("<sandbox>");
      // m7: the record names the intent (every file and its hash) and ends "done".
      expect(rec).toMatchObject({ status: "done", intent: rec.removed });
      // Nothing left: a second run removes nothing.
      expect(probePackStep(c, false).detail).toContain("nothing to remove");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("m7: writes the record with the intent and hashes before deleting, and updates it file by file", () => {
    const { root, ctx } = setup();
    const { sandbox, dir } = sandboxWithPack(root);
    const stuck = join(dir, "ECEN_ProbeEval.c");
    const records = (): string[] =>
      existsSync(join(root, "artifacts"))
        ? readdirSync(join(root, "artifacts")).filter((f) => f.startsWith("removed-probe-"))
        : [];
    const seen: Array<{ file: string; recordBefore: boolean }> = [];
    try {
      const c = ctx({
        sandboxDir: sandbox,
        removeProbe: true,
        really: true,
        platform: "win32",
        exec: () => NONE,
        // The second file cannot be deleted; every delete checks the record exists first.
        unlink: (p) => {
          seen.push({ file: p, recordBefore: records().length === 1 });
          if (p === stuck) throw new Error("EPERM (test)");
          unlinkSync(p);
        },
      });
      c.lane.start("S-D");
      const s = probePackStep(c, false);
      expect(s.ok).toBe(false);
      expect(s.detail).toContain("ECEN_ProbeEval.c");
      expect(seen.length).toBe(2);
      expect(seen.every((x) => x.recordBefore)).toBe(true);
      expect(records().length).toBe(1);
      const rec = JSON.parse(readFileSync(join(root, "artifacts", records()[0]), "utf-8")) as {
        status: string;
        intent: Array<{ file: string; sha256: string }>;
        removed: Array<{ file: string }>;
        failed: { file: string };
        left: string[];
      };
      expect(rec.status).toBe("incomplete");
      expect(rec.intent.map((r) => r.file)).toEqual([
        "ECEN_Probe.c",
        "ECEN_ProbeEval.c",
        "ECEN_ProbeMut.c",
      ]);
      expect(rec.intent.every((r) => /^[0-9a-f]{64}$/.test(r.sha256))).toBe(true);
      expect(rec.failed.file).toBe("ECEN_ProbeEval.c");
      expect(rec.removed.map((r) => r.file)).toEqual(["ECEN_Probe.c"]);
      expect(rec.left).toContain("ECEN_ProbeEval.c");
      expect(rec.left).toContain("ECEN_ProbeMut.c");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses outside the 2.0 sandbox, while its Workbench or any Workbench image runs, or when the list fails", () => {
    const { root, ctx } = setup();
    try {
      const other = sandboxWithPack(root, "Test1_sandbox");
      const mine = sandboxWithPack(root);
      const base = { removeProbe: true, really: true, platform: "win32" as const };
      const c = ctx({ ...base, sandboxDir: other.sandbox, exec: () => NONE });
      c.lane.start("S-D");
      const notSandbox = probePackStep(c, false);
      expect(notSandbox.ok).toBe(false);
      expect(notSandbox.detail).toContain("not the 2.0 sandbox");
      const started = probePackStep({ ...c, sandboxDir: mine.sandbox }, true);
      expect(started.ok).toBe(false);
      expect(started.detail).toContain("still running");
      const image = probePackStep({ ...c, sandboxDir: mine.sandbox, exec: () => WB_ROW }, false);
      expect(image.ok).toBe(false);
      expect(image.detail).toContain("pid 4343");
      const unreadable = probePackStep(
        {
          ...c,
          sandboxDir: mine.sandbox,
          exec: () => {
            throw new Error("tasklist failed (test)");
          },
        },
        false,
      );
      expect(unreadable.ok).toBe(false);
      expect(unreadable.detail).toContain("could not list");
      const noSandbox = probePackStep({ ...c, sandboxDir: null, beforeManifest: null }, false);
      expect(noSandbox.ok).toBe(false);
      for (const d of [other.dir, mine.dir]) expect(readdirSync(d)).toContain("ECEN_Probe.c");
      expect(existsSync(join(root, "artifacts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the CLI takes --remove-probe as a switch", async () => {
    const { root } = setup();
    try {
      const errors: string[] = [];
      const saved = console.error;
      console.error = (m: string) => errors.push(String(m));
      const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        const { sandbox } = sandboxWithPack(root);
        await main([
          "--id",
          "post-cli",
          "--lease-path",
          join(root, "lease.json"),
          "--marker-path",
          join(root, "marker"),
          "--sandbox",
          sandbox,
          "--remove-probe",
        ]);
      } finally {
        console.error = saved;
        out.mockRestore();
      }
      const line = errors.find((e) => / 4 probe pack: /.test(e)) ?? "";
      expect(line).toContain("would delete ECEN_Probe.c, ECEN_ProbeEval.c, ECEN_ProbeMut.c");
      expect(line).toContain("<sandbox>");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("releaseStep", () => {
  it("keeps the lease while the started Workbench is still running", () => {
    const { root, ctx } = setup();
    try {
      const c = ctx({ really: true });
      c.lane.start("S-C");
      const r = releaseStep(c, true);
      expect(r.released).toBe(false);
      expect(r.step.ok).toBe(false);
      expect(c.lane.holdsLease()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("releaseStep while a Workbench image runs (M2)", () => {
  const WB_ROW = '"ArmaReforgerWorkbenchSteamDiag.exe","4343","Console","1","100 K"\r\n';
  const NONE = "INFO: No tasks are running which match the specified criteria.\r\n";

  it("keeps the lease while any Workbench image runs, whatever pid the lease holds", () => {
    const { root, ctx } = setup();
    try {
      const c = ctx({ really: true, platform: "win32", exec: () => WB_ROW });
      c.lane.start("S-A");
      c.lane.record(1001, null); // the started pid, already gone; the respawn is not recorded
      const r = releaseStep(c, false);
      expect(r.released).toBe(false);
      expect(r.step.ok).toBe(false);
      expect(r.step.detail).toContain("pid 4343");
      expect(r.step.detail).toContain("the lease records 1001");
      expect(r.step.detail).toContain("owner's word");
      expect(c.lane.holdsLease()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the lease when the process list cannot be read, and releases when no image runs", () => {
    const { root, ctx } = setup();
    try {
      const failing = ctx({
        really: true,
        platform: "win32",
        exec: () => {
          throw new Error("tasklist failed (test)");
        },
      });
      failing.lane.start("S-A");
      expect(releaseStep(failing, false)).toMatchObject({ released: false });
      expect(failing.lane.holdsLease()).toBe(true);
      const clean = ctx({ really: true, platform: "win32", exec: () => NONE });
      expect(releaseStep(clean, false).released).toBe(true);
      expect(clean.lane.holdsLease()).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the expected-noise list by default (DEC-033)", () => {
  it("reads the default list when --noise is not given and the file exists; --noise wins", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-post-noise-"));
    try {
      const planted = join(root, "expected-noise.json");
      expect(resolveNoiseList(undefined, planted)).toEqual({ noise: [], source: null });
      writeFileSync(planted, JSON.stringify({ expected_noise: ["resourceDatabase.rdb"] }));
      expect(resolveNoiseList(undefined, planted)).toEqual({
        noise: ["resourceDatabase.rdb"],
        source: planted,
      });
      const own = join(root, "own.json");
      writeFileSync(own, JSON.stringify(["Backup/"]));
      expect(resolveNoiseList(own, planted)).toEqual({ noise: ["Backup/"], source: own });
      expect(DEFAULT_NOISE_LIST.replace(/\\/g, "/")).toMatch(
        /docs\/v2\/sessions\/queues\/expected-noise\.json$/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names on the net-zero line how many differences the list explained", async () => {
    const { root, ctx } = setup();
    try {
      mkdirSync(join(root, "sandbox", "Backup"));
      writeFileSync(join(root, "sandbox", "Backup", "w.bak"), "noise");
      writeFileSync(join(root, "sandbox", "resourceDatabase.rdb"), "x");
      const r = await runPostflight(
        ctx({ noise: ["Backup/", "resourceDatabase.rdb"], noiseSource: "noise-list.json" }),
      );
      expect(r.steps[0].ok).toBe(true);
      expect(r.steps[0].detail.split("\n")[0]).toBe(
        "net-zero: yes (expected-noise list noise-list.json explained 2 differences)",
      );
      writeFileSync(join(root, "sandbox", "a.txt"), "changed");
      const bad = await runPostflight(ctx({ noise: [], noiseSource: null }));
      expect(bad.steps[0].detail.split("\n")[0]).toBe(
        "net-zero: NO (no expected-noise list given; 0 differences explained)",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a W1 sitting's net-zero (run 7, 2026-11-11g)", () => {
  // Every W1 post-flight read the default list: the battery's files under _throwaway/W1/ (removed
  // only by the rollback after the post-flight) made net-zero NO on a test bed that was git-clean.
  function w1Sandbox(root: string): { sandbox: string; before: string } {
    const sandbox = join(root, "EMCP2_sandbox");
    mkdirSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP"), { recursive: true });
    mkdirSync(join(sandbox, "_throwaway", "W1", "conf"), { recursive: true });
    writeFileSync(join(sandbox, ".gitignore"), "resourceDatabase.rdb\n");
    writeFileSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP", "EMCP_WB_A.c"), "a");
    // The plant and the handler install come before the pre-flight snapshot (W1.md steps 2 to 4).
    writeFileSync(join(sandbox, "_throwaway", "W1", "conf", "inputCommon.conf"), "planted");
    writeFileSync(join(sandbox, "resourceDatabase.rdb"), "r0");
    const before = join(root, "snapshot-before.json");
    writeFileSync(
      before,
      JSON.stringify(
        takeSnapshot(sandbox, [".gitignore", "Scripts", "_throwaway", "resourceDatabase.rdb"]),
      ),
    );
    // What the battery leaves until the rollback: new worlds, the edited conf, the rdb.
    mkdirSync(join(sandbox, "_throwaway", "W1", "worlds"), { recursive: true });
    writeFileSync(join(sandbox, "_throwaway", "W1", "worlds", "EMCP_W1_Tiny.ent"), "w");
    writeFileSync(join(sandbox, "_throwaway", "W1", "conf", "inputCommon.conf"), "edited");
    writeFileSync(join(sandbox, "resourceDatabase.rdb"), "r1");
    return { sandbox, before };
  }

  it("reads YES with the W1 list, NO with a hint on the default list", async () => {
    const { root, ctx } = setup();
    try {
      const { before } = w1Sandbox(root);
      const w1 = resolveNoiseList(W1_NOISE_LIST);
      const yes = await runPostflight(
        ctx({ beforeManifest: before, noise: w1.noise, noiseSource: w1.source }),
      );
      expect(yes.steps[0].ok).toBe(true);
      expect(yes.steps[0].detail.split("\n")[0]).toMatch(
        /^net-zero: yes \(expected-noise list docs\/v2\/sessions\/queues\/w1-noise\.json explained 3 differences\)$/,
      );
      expect(yes.steps[0].detail).not.toContain("hint:");
      const dflt = resolveNoiseList(undefined);
      const no = await runPostflight(
        ctx({ beforeManifest: before, noise: dflt.noise, noiseSource: dflt.source }),
      );
      expect(no.steps[0].ok).toBe(false);
      expect(no.steps[0].detail).toContain(
        "hint: 2 difference(s) lie under _throwaway/W1/, the W1 battery's folder",
      );
      expect(no.steps[0].detail).toContain("--noise docs/v2/sessions/queues/w1-noise.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not hide a real difference outside _throwaway/W1/ with the W1 list", async () => {
    const { root, ctx } = setup();
    try {
      const { sandbox, before } = w1Sandbox(root);
      writeFileSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP", "EMCP_WB_A.c"), "b");
      const w1 = resolveNoiseList(W1_NOISE_LIST);
      const r = await runPostflight(
        ctx({ beforeManifest: before, noise: w1.noise, noiseSource: w1.source }),
      );
      expect(r.steps[0].ok).toBe(false);
      expect(r.steps[0].detail).toContain("Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_A.c");
      expect(
        w1NoiseHint({ added: [], removed: [], changed: ["Scripts/x.c"], noise: [] }, null),
      ).toBe(null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("net-zero sees the sandbox root's entry list (M3)", () => {
  it("fails on a new top-level file no declared path covers; the noise list can cover it", async () => {
    const { root, ctx } = setup();
    try {
      writeFileSync(join(root, "sandbox", "resourceDatabase.rdb"), "x");
      const r = await runPostflight(ctx());
      expect(r.steps[0].ok).toBe(false);
      expect(r.steps[0].detail).toContain("top-level entries added: resourceDatabase.rdb");
      const noisy = await runPostflight(ctx({ noise: ["Backup/", "resourceDatabase.rdb"] }));
      expect(noisy.steps[0].ok).toBe(true);
      expect(noisy.steps[0].detail).toContain("on the expected-noise list: resourceDatabase.rdb");
      // A new folder is seen too, with its slash.
      mkdirSync(join(root, "sandbox", "Prefabs"));
      const dir = await runPostflight(ctx({ noise: ["Backup/", "resourceDatabase.rdb"] }));
      expect(dir.steps[0].detail).toContain("top-level entries added: Prefabs/");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not compare the listing of a manifest written before it was recorded", async () => {
    const { root, ctx } = setup();
    try {
      const old = join(root, "old.json");
      const m = takeSnapshot(join(root, "sandbox"), ["a.txt"]);
      delete m.top_level;
      writeFileSync(old, JSON.stringify(m));
      writeFileSync(join(root, "sandbox", "resourceDatabase.rdb"), "x");
      const r = await runPostflight(ctx({ beforeManifest: old }));
      expect(r.steps[0].ok).toBe(true);
      expect(r.steps[0].detail).toContain("not compared");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("registry comparison after a forced kill", () => {
  it("is not valid when the run folder of the --before manifest records a forced kill", async () => {
    const { root, ctx } = setup();
    try {
      const regBefore = join(root, "registry-before.reg");
      writeFileSync(
        regBefore,
        'Windows Registry Editor Version 5.00\r\n\r\n"k"=dword:00000001\r\n',
      );
      const exec = (file: string, args: string[]): string => {
        if (file === "tasklist") return "INFO: No tasks are running.\r\n";
        if (file === "reg") {
          writeFileSync(
            args[2],
            'Windows Registry Editor Version 5.00\r\n\r\n"k"=dword:00000001\r\n',
          );
          return "";
        }
        throw new Error(`unexpected exec of ${file}`);
      };
      const c = ctx({
        really: true,
        platform: "win32",
        exec,
        registryBefore: regBefore,
        registryKey: "HKCU\\Software\\Test",
      });
      c.lane.start("S-A");
      const clean = await runPostflight(c);
      expect(clean.steps[2].detail).not.toContain("NOT VALID");
      expect(clean.graceful).toBe(true);
      c.lane.start("S-A");
      recordForcedKill(root, { pid: 1001, by: "S-A-1", at: "t", how: "taskkill /PID 1001 /T /F" });
      const r = await runPostflight(c);
      expect(r.graceful).toBe(false);
      expect(r.steps[2].detail).toContain("NOT VALID: the sitting ended 1 process by force");
      expect(r.steps[2].detail).toContain("pid 1001 by S-A-1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the sitting's run folders (minors 3 and 4)", () => {
  const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it("reads forced kills and unfinished steps from every run folder born since the lease was taken", async () => {
    const { root, ctx } = setup();
    try {
      const sessions = join(root, "sessions", "S-A");
      const old = join(sessions, "run0");
      mkdirSync(old, { recursive: true });
      recordForcedKill(old, { pid: 1, by: "an earlier sitting", at: "t", how: "x" });
      await pause(50);
      const run1 = join(sessions, "run1");
      const c0 = ctx();
      c0.lane.start("S-A");
      await pause(50);
      mkdirSync(run1);
      const before = join(run1, "snapshot-before.json");
      writeFileSync(before, JSON.stringify(takeSnapshot(join(root, "sandbox"), ["a.txt"])));
      const c = ctx({ beforeManifest: before });
      expect(leaseStartMs(c.lane)).not.toBeNull();
      // The earlier sitting's folder does not count; this sitting's folders do.
      expect(sittingFolders(run1, leaseStartMs(c.lane))).toEqual([run1]);
      expect((await runPostflight(c)).graceful).toBe(true);
      // A second run folder of this sitting with a forced kill makes the comparison not valid.
      const run2 = join(sessions, "run2");
      mkdirSync(run2);
      expect(sittingFolders(run1, leaseStartMs(c.lane)).sort()).toEqual([run1, run2].sort());
      recordForcedKill(run2, { pid: 1001, by: "S-A-1", at: "t", how: "taskkill /PID 1001 /F" });
      expect((await runPostflight(c)).graceful).toBe(false);
      rmSync(join(run2, "forced-kills.jsonl"));
      expect((await runPostflight(c)).graceful).toBe(true);
      // A started marker with no result: the step's Workbench exit is unknown.
      writeFileSync(join(run1, "S-A-3.started"), "{}");
      writeFileSync(join(run1, "S-A-2.started"), "{}");
      writeFileSync(join(run1, "S-A-2.json"), "{}");
      writeFileSync(join(run2, "S-A-4.started.acknowledged"), "{}");
      expect(danglingStartedMarkers(run1)).toEqual(["S-A-3.started"]);
      expect(danglingStartedMarkers(run2)).toEqual(["S-A-4.started.acknowledged"]);
      expect((await runPostflight(c)).graceful).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says why the registry comparison is not valid when a step never finished", async () => {
    const { root, ctx } = setup();
    try {
      const regBefore = join(root, "registry-before.reg");
      writeFileSync(
        regBefore,
        'Windows Registry Editor Version 5.00\r\n\r\n"k"=dword:00000001\r\n',
      );
      const exec = (file: string, args: string[]): string => {
        if (file === "tasklist") return "INFO: No tasks are running.\r\n";
        if (file === "reg") {
          writeFileSync(
            args[2],
            'Windows Registry Editor Version 5.00\r\n\r\n"k"=dword:00000001\r\n',
          );
          return "";
        }
        throw new Error(`unexpected exec of ${file}`);
      };
      writeFileSync(join(root, "S-A-5.started"), "{}");
      const c = ctx({
        really: true,
        platform: "win32",
        exec,
        registryBefore: regBefore,
        registryKey: "HKCU\\Software\\Test",
      });
      c.lane.start("S-A");
      const r = await runPostflight(c);
      expect(r.steps[2].detail).toContain("NOT VALID: 1 step started and never finished");
      expect(r.steps[2].detail).toContain("S-A-5.started");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("postflight.ts output", () => {
  it("prints its step lines in placeholder form", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-post-main-"));
    const errors: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((m: unknown) => {
      errors.push(String(m));
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const sandbox = join(root, "EMCP2_sandbox");
      mkdirSync(sandbox);
      writeFileSync(join(sandbox, "a.txt"), "a");
      const before = join(root, "before.json");
      writeFileSync(before, JSON.stringify(takeSnapshot(sandbox, ["a.txt"])));
      const decoy = join(root, "EMCP2_decoy");
      mkdirSync(decoy);
      writeFileSync(join(decoy, "d.gproj"), "d");
      const extra = join(root, "decoy.json");
      writeFileSync(extra, JSON.stringify(takeSnapshot(decoy, ["d.gproj"])));
      const code = await main([
        "--id",
        "post",
        "--before",
        before,
        "--extra-before",
        extra,
        "--sandbox",
        sandbox,
        "--lease-path",
        join(root, "lease.json"),
        "--marker-path",
        join(root, "marker"),
        "--out",
        join(root, "log.md"),
      ]);
      expect(code).toBe(0);
      const text = errors.join("\n");
      expect(text).toContain("[<sandbox>]");
      expect(text).not.toContain(sandbox);
    } finally {
      err.mockRestore();
      log.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("releaseStep with a foreign lease", () => {
  it("reports the refusal and leaves the other session's lease alone", () => {
    const { root, ctx } = setup();
    try {
      new Lane({
        id: "other",
        leasePath: join(root, "lease.json"),
        markerPath: join(root, "marker"),
      }).start("x");
      const r = releaseStep(ctx({ really: true }), false);
      expect(r.step.ok).toBe(false);
      expect(r.step.detail).toContain("v2-harness:other");
      expect(existsSync(join(root, "lease.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("registry helpers", () => {
  it("reads a UTF-16LE export and reports added and removed lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-reg-"));
    try {
      const a = join(dir, "a.reg");
      const text =
        'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Test]\r\n"k"=dword:00000001\r\n';
      writeFileSync(a, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
      const before = readRegFile(a);
      expect(before[2]).toBe('"k"=dword:00000001');
      expect(compareReg(before, [...before.slice(0, 2), '"k"=dword:00000002'])).toEqual({
        removed: ['"k"=dword:00000001'],
        added: ['"k"=dword:00000002'],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("session log", () => {
  it("numbers sessions after the existing logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-sess-"));
    try {
      writeFileSync(join(dir, "002-2026-09-30.md"), "");
      writeFileSync(join(dir, "002-queue.json"), "[]");
      expect(nextSessionNumber(dir)).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the skeleton with the post-flight results", () => {
    const text = sessionLogSkeleton({
      number: 3,
      date: "2026-10-01",
      laneSession: "v2-harness:abc",
      report: {
        steps: [{ step: 1, name: "net-zero", ok: true, detail: "net-zero: yes" }],
        hazards: [],
        graceful: true,
        released: true,
      },
    });
    expect(text.split("\n")[0]).toBe("# Session 003, 2026-10-01");
    expect(text).toContain("docs/v2/sessions/003-queue.json");
    expect(text).toContain("- 1 net-zero (ok): net-zero: yes");
    expect(text).toContain("Hazard dialogs (never answered): none");
  });
});

describe("closeStep when the close script reports no exit (DEC-032, S-B read m4)", () => {
  const WB = "ArmaReforgerWorkbenchSteamDiag.exe";
  function world(root: string, ctx: (o?: Partial<PostflightContext>) => PostflightContext) {
    let alive = true;
    const c = ctx({
      really: true,
      platform: "win32",
      exec: (file, args) => {
        if (file !== "tasklist") throw new Error(`unexpected exec of ${file}`);
        if (args[1] === "PID eq 4242" && alive) return `"${WB}","4242","Console","1","10,000 K"`;
        return "INFO: No tasks are running which match the specified criteria.\r\n";
      },
      windowTitles: async () => ["EMCP2_sandbox - Workbench"],
    });
    c.lane.start("S-B");
    c.lane.record(4242, join(root, "sandbox", "x.gproj"));
    return {
      c,
      exitDuringScript: () => {
        alive = false;
      },
    };
  }

  it("a pid gone after a failed close script counts as exited, not graceful, not still running", async () => {
    const { root, ctx } = setup();
    try {
      const w = world(root, ctx);
      // Get-Process throws: Workbench exited between the image check and the script.
      const r = await closeStep({
        ...w.c,
        powershell: async () => {
          w.exitDuringScript();
          return { ok: false, stdout: "", stderr: "Cannot find a process", error: "exit 1" };
        },
      });
      expect(r.stillRunning).toBe(false);
      expect(r.graceful).toBe(false);
      expect(r.step.detail).toContain("is gone");
      expect(r.step.detail).not.toContain("recorded recovery path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a pid still running after the timeout is still running, and the stop names the recover subcommands", async () => {
    const { root, ctx } = setup();
    try {
      const w = world(root, ctx);
      const r = await closeStep({
        ...w.c,
        powershell: async () => ({
          ok: true,
          stdout: '{"closeSent":true,"exited":false}',
          stderr: "",
          error: null,
        }),
      });
      expect(r.stillRunning).toBe(true);
      expect(r.step.detail).toContain("s-b-scratch-profile.ts recover");
      expect(r.step.detail).not.toMatch(/\/T/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("closeStep closes every main window in turn (DEC-064)", () => {
  const WB = "ArmaReforgerWorkbenchSteamDiag.exe";
  function running(root: string, ctx: (o?: Partial<PostflightContext>) => PostflightContext) {
    let alive = true;
    const c = ctx({
      really: true,
      platform: "win32",
      exec: (file, args) => {
        if (file !== "tasklist") throw new Error(`unexpected exec of ${file}`);
        if (args[1] === "PID eq 4242" && alive) return `"${WB}","4242","Console","1","10,000 K"`;
        return "INFO: No tasks are running which match the specified criteria.\r\n";
      },
      windowTitles: async () => [],
    });
    c.lane.start("W1");
    c.lane.record(4242, join(root, "sandbox", "x.gproj"));
    return {
      c,
      exit: () => {
        alive = false;
      },
    };
  }

  it("the script posts WM_CLOSE to each main window, Resource Manager last, and never kills", () => {
    expect(CLOSE_ALL_SCRIPT).toContain("PostMessage(new IntPtr(h), 0x0010");
    expect(CLOSE_ALL_SCRIPT).toContain("$_.T -notlike 'Enfusion Workbench*'");
    expect(CLOSE_ALL_SCRIPT).toContain("Find-Dialog");
    expect(CLOSE_ALL_SCRIPT).not.toMatch(/Stop-Process|taskkill|\.Kill\(/i);
  });

  it("an exit after two windows counts as graceful and names both windows", async () => {
    const { root, ctx } = setup();
    try {
      const w = running(root, ctx);
      let env: Record<string, string> | undefined;
      const r = await closeStep({
        ...w.c,
        powershell: async (script, e) => {
          expect(script).toBe(CLOSE_ALL_SCRIPT);
          env = e;
          w.exit();
          return {
            ok: true,
            stdout: JSON.stringify({
              closeSent: true,
              exited: true,
              sent: ["World Editor - EMCP_W1_Tiny", "Enfusion Workbench - EMCP2 sandbox"],
              dialog: null,
              remaining: [],
            }),
            stderr: "",
            error: null,
          };
        },
      });
      expect(env?.EMCP_PID).toBe("4242");
      expect(env?.EMCP_MODAL_TITLES).toBeTruthy();
      expect(r.graceful).toBe(true);
      expect(r.step.detail).toContain("2 window(s) in turn");
      expect(r.step.detail).toContain("Enfusion Workbench - EMCP2 sandbox");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a dialog stops the close: reported as a hazard, never answered, still running", async () => {
    const { root, ctx } = setup();
    try {
      const w = running(root, ctx);
      const r = await closeStep({
        ...w.c,
        powershell: async () => ({
          ok: true,
          stdout: JSON.stringify({
            closeSent: true,
            exited: false,
            sent: ["World Editor - EMCP_W1_Dup"],
            dialog: "Loading world [Qt683QWindowIcon]",
            remaining: ["Loading world [Qt683QWindowIcon]"],
          }),
          stderr: "",
          error: null,
        }),
      });
      expect(r.stillRunning).toBe(true);
      expect(r.graceful).toBe(false);
      expect(r.hazards[0]).toBe("Loading world [Qt683QWindowIcon]");
      expect(r.step.detail).toContain("stopped at a dialog-like window");
      // W8 run 8: "Loading world" is named as the save prompt, with No as the answer
      expect(r.step.detail).toContain(`the engine's save prompt "Do you want to save changes?"`);
      expect(r.step.detail).toContain("No is the answer that leaves the files unchanged");
      expect(r.step.detail).not.toMatch(/loading window|unknown dialog/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("nameCloseWindow names only the save prompt (W8 run 8)", () => {
    expect(nameCloseWindow("Loading world [Qt683QWindowIcon]")).toMatch(
      /save prompt "Do you want to save changes\?".*No is the answer that leaves the files unchanged/,
    );
    expect(
      nameCloseWindow("Loading world [Qt683QWindowIcon] (disabled, unowned, for 5000 ms)"),
    ).toContain("save prompt");
    expect(nameCloseWindow("Open [#32770]")).toBe("Open [#32770]");
  });
});

describe("partial post-flight (--partial, S-F between launches)", () => {
  it("parsePartialSteps takes only 1, 2 and 3", () => {
    expect(parsePartialSteps("3,1,2,1")).toEqual([1, 2, 3]);
    expect(() => parsePartialSteps("4")).toThrow(/--partial 4 refused/);
    expect(() => parsePartialSteps("1,5")).toThrow(/--partial 5 refused/);
    expect(() => parsePartialSteps("")).toThrow();
  });

  it("partial 1,2,3 with really keeps the lease, never releases and never touches the probe pack", async () => {
    const { root, ctx } = setup();
    try {
      const unlink = vi.fn();
      const c = ctx({ really: true, partial: [1, 2, 3], removeProbe: true, unlink });
      c.lane.start("S-F");
      const end = vi.spyOn(c.lane, "end");
      const r = await runPostflight(c);
      expect(r.partial).toBe(true);
      expect(r.stepsRun).toEqual([1, 2, 3]);
      expect(r.released).toBe(false);
      expect(end).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      expect(c.lane.holdsLease()).toBe(true);
      expect(r.steps.map((s) => [s.step, s.ok, Boolean(s.skipped)])).toEqual([
        [1, true, false],
        [2, true, false],
        [3, true, true], // the registry step's own platform gate (linux in this test)
        [4, true, true],
        [5, true, true],
      ]);
      expect(r.steps[4].detail).toContain("lease");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("steps not listed are reported skipped", async () => {
    const { root, ctx } = setup();
    try {
      const c = ctx({ partial: [1] });
      c.lane.start("S-F");
      const r = await runPostflight(c);
      expect(r.steps[1]).toMatchObject({ step: 2, skipped: true });
      expect(r.steps[2]).toMatchObject({ step: 3, skipped: true });
      expect(r.stepsRun).toEqual([1]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("step 2 in partial mode sends no close to a running Workbench", async () => {
    const { root, ctx } = setup();
    try {
      const powershell = vi.fn(() => Promise.reject(new Error("no close may be sent")));
      const c = ctx({
        really: true,
        platform: "win32",
        partial: [2],
        powershell,
        windowTitles: async () => ["Workbench"],
        exec: () => '"ArmaReforgerWorkbenchSteamDiag.exe","4242","Console","1","1,000 K"\r\n',
      });
      c.lane.start("S-F");
      c.lane.record(4242, null);
      const r = await closeStep(c);
      expect(powershell).not.toHaveBeenCalled();
      expect(r.step.ok).toBe(false);
      expect(r.stillRunning).toBe(true);
      expect(r.step.detail).toContain("sends no close");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("main refuses --partial with 4 or 5, --remove-probe or --out, and prints the partial line", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-post-partial-"));
    const logs: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation((m: unknown) => {
      logs.push(String(m));
    });
    try {
      const base = [
        "--id",
        "post",
        "--lease-path",
        join(root, "lease.json"),
        "--marker-path",
        join(root, "marker"),
      ];
      expect(await main([...base, "--partial", "4"])).toBe(2);
      expect(await main([...base, "--partial", "1,5"])).toBe(2);
      expect(await main([...base, "--partial", "1,2,3", "--remove-probe"])).toBe(2);
      expect(await main([...base, "--partial", "1,2,3", "--remove-probe-mut"])).toBe(2);
      expect(await main([...base, "--partial", "1", "--out", join(root, "x.md")])).toBe(2);
      const code = await main([...base, "--partial", "1,2,3"]);
      expect([0, 1]).toContain(code);
      expect(logs.join("\n")).toContain("partial post-flight, lease kept");
      expect(existsSync(join(root, "x.md"))).toBe(false);
    } finally {
      err.mockRestore();
      log.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
