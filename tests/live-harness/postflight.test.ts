import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lane } from "../../scripts/live/lane.js";
import {
  compareReg,
  nextSessionNumber,
  readRegFile,
  releaseStep,
  runPostflight,
  sessionLogSkeleton,
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
      ]);
      expect(r.steps[0].detail).toContain("1 expected-noise");
      expect(r.steps[3].skipped).toBe(true);
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
