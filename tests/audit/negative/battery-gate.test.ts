/**
 * Live-safety audit (PLAN section 11 criterion 8), negative tests: the test-bed gate of the W9
 * and W10 batteries refuses. The per-battery suites (tests/live-harness/w9-battery.test.ts,
 * w10-battery.test.ts) carry the wrong-project abort for W9 only and no build-stamp mismatch for
 * either; these cases close that gap offline with an in-memory fake (no Workbench, no NET call).
 *
 * Each case runs the gate step alone and checks three things: the exit code, the record's
 * status, and that nothing but the read-only close-out was sent. After a STOP (not an abort) the
 * runner reads `wb_world state` once to leave Workbench closable (closeOutAfterStop); an abort
 * sends nothing at all.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO_ROOT, SANDBOX_NAME } from "../../../scripts/live/paths.js";
import * as W9 from "../../live/w9.live.js";
import * as W10 from "../../live/w10.live.js";

type Raw = Record<string, unknown>;

const TMP = mkdtempSync(join(tmpdir(), "emcp-audit-gate-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const norm = (p: string): string => p.replace(/\\/g, "/");

interface GateWorld {
  info: Raw | null;
  stamp: string | null;
  digest: string | null;
}

/** The deps both batteries share for the gate: every tool call is recorded and answered ok. */
function fakeDeps(w: GateWorld) {
  const files = new Map<string, Buffer>();
  const sent: Array<[string, Raw]> = [];
  return {
    files,
    sent,
    tool: async (name: string, args: Raw) => {
      sent.push([name, args]);
      return { ok: true, readback: {} };
    },
    info: async () => w.info,
    ping: async () => (w.stamp === null ? {} : { buildStamp: w.stamp }),
    bundleDigest: () => w.digest,
    windows: async () => [],
    recordedPid: () => 4242,
    commandLine: async () => "",
    toggleRows: () => [],
    logLines: () => [],
    readBytes: (p: string) => {
      const b = files.get(norm(p));
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    writeBytes: (p: string, b: Buffer) => {
      files.set(norm(p), b);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    exists: (p: string) => files.has(norm(p)),
    listTree: (dir: string) => {
      const d = norm(dir).replace(/\/$/, "") + "/";
      return [...files.keys()].filter((k) => k.startsWith(d)).map((k) => k.slice(d.length));
    },
    now: () => Date.now(),
    sleep: async () => undefined,
    log: () => undefined,
  };
}

function opts(name: string) {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(sitting, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as never,
    build: "test",
  };
}

const isCloseOut = ([name, args]: [string, Raw]): boolean =>
  name === "wb_world" && args.action === "state" && Object.keys(args).length === 1;
const counts = (sent: Array<[string, Raw]>) => ({
  sent: sent.length,
  other: sent.filter((c) => !isCloseOut(c)).length,
});

const ON_BED: Raw = { projectFound: 1, projectName: SANDBOX_NAME };

interface Battery {
  name: string;
  run: (w: GateWorld, o: ReturnType<typeof opts>) => Promise<{
    exit: number;
    status: unknown;
    detail: string;
    sent: number;
    /** Calls other than the read-only close-out `wb_world state`. */
    other: number;
  }>;
  exit: { aborted: number; stopped: number };
}

/**
 * W9's steps come from its menu plan in the 2.0 programme record (docs/v2), which the public
 * export leaves out; there only W10 is checked.
 */
const HAS_W9_PLAN = existsSync(join(REPO_ROOT, ...W9.PLAN_REL.split("/")));

const BATTERIES: Battery[] = [
  {
    name: "W9",
    exit: W9.EXIT,
    run: async (w, o) => {
      const deps = fakeDeps(w);
      const steps = W9.selectSteps(W9.buildSteps(), { only: W9.GATE_STEP });
      if (typeof steps === "string") throw new Error(steps);
      const r = await W9.runBattery(steps, deps as never, o as never);
      const rec = r.records[0] as unknown as Raw | undefined;
      return { exit: r.exit, status: rec?.status, detail: String(rec?.detail), ...counts(deps.sent) };
    },
  },
  {
    name: "W10",
    exit: W10.EXIT,
    run: async (w, o) => {
      const deps = fakeDeps(w);
      const all = W10.buildSteps(W10.runSetOf({}, []));
      const steps = W10.selectSteps(all as never, { only: W10.GATE_STEP }) as unknown;
      if (typeof steps === "string") throw new Error(steps);
      const r = await W10.runBattery(steps as W10.StepDef[], deps as never, o as never, all);
      const rec = r.records[0] as unknown as Raw | undefined;
      return { exit: r.exit, status: rec?.status, detail: String(rec?.detail), ...counts(deps.sent) };
    },
  },
];

describe.each(BATTERIES.filter((b) => b.name !== "W9" || HAS_W9_PLAN))("$name test-bed gate refuses (criterion 8)", (b) => {
  it("a project other than the test bed aborts, and nothing is sent", async () => {
    const r = await b.run(
      { info: { projectFound: 1, projectName: "SomeUserMod" }, stamp: "abc", digest: "abc" },
      opts(`${b.name}-wrong-project`),
    );
    expect(r.exit).toBe(b.exit.aborted);
    expect(r.status).toBe("ABORTED");
    expect(r.detail).toMatch(/not the live lane's test bed/);
    expect(r.sent).toBe(0);
  });

  it("no project found (Info null or projectFound 0) aborts, and nothing is sent", async () => {
    for (const info of [null, { projectFound: 0, projectName: SANDBOX_NAME }]) {
      const r = await b.run(
        { info, stamp: "abc", digest: "abc" },
        opts(`${b.name}-no-project-${info ? "0" : "null"}`),
      );
      expect(r.exit, JSON.stringify(info)).toBe(b.exit.aborted);
      expect(r.sent).toBe(0);
    }
  });

  it("a stale build stamp stops, and nothing but the read-only close-out is sent", async () => {
    const r = await b.run(
      { info: ON_BED, stamp: "0ld5ta4p", digest: "769d1731" },
      opts(`${b.name}-stale-stamp`),
    );
    expect(r.exit).toBe(b.exit.stopped);
    expect(r.status).toBe("STOPPED");
    expect(r.detail).toMatch(/build stamp does not match/);
    expect(r.other).toBe(0);
  });

  it("an absent stamp or an absent bundle digest stops as well", async () => {
    for (const [stamp, digest] of [
      [null, "769d1731"],
      ["769d1731", null],
    ] as const) {
      const r = await b.run(
        { info: ON_BED, stamp, digest },
        opts(`${b.name}-absent-${stamp ? "digest" : "stamp"}`),
      );
      expect(r.exit, `${stamp}/${digest}`).toBe(b.exit.stopped);
      expect(r.detail).toMatch(/build stamp does not match/);
      expect(r.other).toBe(0);
    }
  });
});
