import { afterAll, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  EXIT,
  buildWalkerQueue,
  deriveId,
  runWalkerSteps,
  validateLine,
  type WalkerDeps,
} from "../../scripts/census/live/common.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  DIAG_READ_HAZARDS,
  E14_PATH,
  PROBE_API,
  e14PathFor,
  buildSteps,
  debugPanelLines,
  indexE14,
  makeDef,
  sha256,
  walkResultFrom,
  type L15Kernel,
  type ProbeAnswer,
  type WalkNode,
} from "../../scripts/census/live/L15-diag.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l15-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = join(__dirname, "fixtures", "live");
const WALK = JSON.parse(readFileSync(join(FIX, "L15-we-walk.json"), "utf-8")) as {
  tree: WalkNode;
};
const READS = JSON.parse(readFileSync(join(FIX, "L15-diag-reads.json"), "utf-8")) as {
  responses: Record<string, unknown>;
};
const E14_TEXT = readFileSync(E14_PATH, "utf-8");
/** The script options of the census build's E14 file (201 at 1.8.0.13, 204 at 1.9.0.37). */
const SCRIPT_N = indexE14(E14_TEXT).script.length;
const E14_IDS = new Set(
  E14_TEXT.split("\n")
    .filter((l) => l.trim() && !l.startsWith('{"$header"'))
    .map((l) => deriveId(JSON.parse(l))),
);

const win = (title: string, hwnd: number, cls = "Qt683QWindowIcon", owner = 0): WindowInfo => ({
  hwnd,
  pid: 4242,
  className: cls,
  title,
  owner,
  enabled: true,
  rect: [0, 0, 1, 1],
  monitor: [0, 0, 1, 1],
  primary: true,
});

interface FakeKernel extends L15Kernel {
  probes: Array<Record<string, string>>;
  walks: number;
  artifacts: Map<string, string>;
}

function fakeKernel(
  over: { tree?: WalkNode; probe?: (enumName: string) => ProbeAnswer | Promise<ProbeAnswer> } = {},
): FakeKernel {
  const k: FakeKernel = {
    probes: [],
    walks: 0,
    artifacts: new Map(),
    e14Text: () => E14_TEXT,
    walk: async (_ctx, outPath) => {
      k.walks++;
      const text = JSON.stringify({ tree: over.tree ?? WALK.tree });
      k.artifacts.set(outPath, text);
      return { doc: { tree: over.tree ?? WALK.tree }, path: outPath, sha256: sha256(text) };
    },
    probe: async (params) => {
      k.probes.push(params);
      if (over.probe) return over.probe(params.diagEnum);
      const r = READS.responses[params.diagEnum];
      return r
        ? { ok: true, response: r }
        : { ok: true, response: { status: "error", message: "not in the fixture" } };
    },
    writeArtifact: (path, text) => {
      k.artifacts.set(path, text);
      return sha256(text);
    },
  };
  return k;
}

function deps(runDir: string, windows: () => WindowInfo[] = () => []): WalkerDeps {
  return {
    windows: async () => windows(),
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => 4242,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: (p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    },
    writeFile: (p, t, exclusive) => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(p, t, { flag: exclusive ? "wx" : "w" });
    },
    appendFile: (p, t) => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(p, t, { flag: "a" });
    },
    log: () => undefined,
  };
}

const opts = (runDir: string, mode: "edit" | "play" = "edit") => ({
  enumerator: "L15",
  script: "scripts/census/live/L15-diag.ts",
  session: "P4-1",
  runDir,
  module: "WorldEditor",
  state: mode === "edit" ? { mode, selection: "none" as const } : { mode },
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});
const SEL = {
  module: "WorldEditor",
  state: { mode: "edit" as const, selection: "none" as const },
  allowOwned: false,
};

describe("E14 index", () => {
  const E14_DIR = join(__dirname, "..", "..", "data", "census", "observations", "E14");
  it("names the 201 SCR_DebugMenuID options of 1.8.0.13 (7 more ids are menus), the fixture's three among them", () => {
    const ix = indexE14(readFileSync(join(E14_DIR, "1.8.0.13.jsonl"), "utf-8"));
    expect(ix.script.length).toBe(201);
    expect(ix.menus).toBe(154);
    for (const e of Object.keys(READS.responses))
      expect(ix.script.map((o) => o.enumName)).toContain(e);
  });
  it("names 204 at 1.9.0.37, the three new options among them (P4-5: the walk had read 1.8.0.13)", () => {
    const ix = indexE14(readFileSync(join(E14_DIR, "1.9.0.37.jsonl"), "utf-8"));
    expect(ix.script.length).toBe(204);
    const names = ix.script.map((o) => o.enumName);
    for (const e of [
      "DEBUGUI_CHARACTER_HYDRATION_STAMINA_BOOST",
      "DEBUGUI_VEHICLES_SOUNDIMPACT_DIAG",
      "DEBUGUI_AMBIENT_VEHICLE_SPAWNER",
    ])
      expect(names).toContain(e);
  });
  it("reads the census build's E14 file, not a pinned build", () => {
    const data = join(TMP, "e14-build");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "current-build.json"), JSON.stringify({ tag: "9.9.9.9" }));
    expect(e14PathFor(data)).toBe(join(data, "observations", "E14", "9.9.9.9.jsonl"));
    const tag = (
      JSON.parse(
        readFileSync(join(__dirname, "..", "..", "data", "census", "current-build.json"), "utf-8"),
      ) as { tag: string }
    ).tag;
    expect(E14_PATH).toBe(join(E14_DIR, `${tag}.jsonl`));
  });
});

describe("plan (plan 5.3)", () => {
  const steps = buildSteps(SEL, fakeKernel());
  const plan = steps.flatMap((s) => s.plan(SEL));
  it("passes checkPlan and holds only a passive read and diagRead net-calls", () => {
    expect(checkPlan(plan, loadPolicy(), { script: "scripts/census/live/L15-diag.ts" }).ok).toBe(
      true,
    );
    expect(steps.map((s) => s.id)).toEqual(["p4-l15-edit-walk", "p4-l15-edit-diag"]);
    expect(new Set(plan.map((a) => a.kind))).toEqual(new Set(["uia-read", "net-call"]));
    for (const a of plan) {
      expect([
        "key",
        "invoke",
        "menu-open",
        "execute-action",
        "uia-menu",
        "uia-context",
        "uia-dialog-cancel",
      ]).not.toContain(a.kind);
      if (a.kind === "uia-read") expect(a.readOnly).toBe(true);
      if (a.kind === "net-call") {
        expect(a.target).toBe(PROBE_API);
        expect(Object.keys(a.params as object).sort()).toEqual(["action", "diagEnum"]);
        expect((a.params as Record<string, string>).action).toBe("diagRead");
      }
    }
    const text = JSON.stringify(plan);
    for (const bad of [
      "diagSet",
      "diagMenu",
      "engine",
      "Enter",
      "ParticleEditor",
      'allowOwned":true',
    ])
      expect(text).not.toContain(bad);
  });
  it("keeps play mode out of the default queue; mode=play is its own block", () => {
    const def = makeDef(fakeKernel());
    const q = buildWalkerQueue(def, def.steps(SEL)) as {
      probes: Array<{ id: string; risk_class: string; side_effects: string[] }>;
    };
    expect(q.probes.map((p) => p.id)).toEqual(["p4-l15-edit-walk", "p4-l15-edit-diag"]);
    expect(q.probes.every((p) => p.risk_class === "read-only" && p.side_effects.length === 0)).toBe(
      true,
    );
    const play = def.steps({ ...SEL, state: { mode: "play" } });
    expect(play.map((s) => s.id)).toEqual(["p4-l15-play-walk", "p4-l15-play-diag"]);
  });
});

describe("run on fakes", () => {
  it("walks then reads, in order; lines validate, key onto E14 rows, and normalise", async () => {
    const runDir = join(TMP, "ok");
    const k = fakeKernel();
    const r = await runWalkerSteps(buildSteps(SEL, k), deps(runDir), opts(runDir));
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => [x.step, x.status])).toEqual([
      ["p4-l15-edit-walk", "observed"],
      ["p4-l15-edit-diag", "observed"],
    ]);
    expect(r.records[0].summary).toMatch(/0 diag\/debug node\(s\).*WorldRenderWindowQt.*0 child/);
    expect(r.records[1].summary).toMatch(new RegExp(`^3 of ${SCRIPT_N} `));
    expect(k.walks).toBe(1);
    expect(k.probes.length).toBe(SCRIPT_N - DIAG_READ_HAZARDS.length);
    expect(k.probes.some((p) => DIAG_READ_HAZARDS.includes(p.diagEnum))).toBe(false);
    expect(k.probes.every((p) => p.action === "diagRead" && Object.keys(p).length === 2)).toBe(
      true,
    );
    const files = readdirSync(runDir);
    expect(files).toContain("p4-l15-edit-walk.started");
    expect(files).toContain("p4-l15-edit-diag.started");
    const obs = join(runDir, "L15-WorldEditor-edit-none.obs.jsonl");
    const lines = readFileSync(obs, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.length).toBe(3);
    for (const l of lines) {
      expect(validateLine(l, "L15")).toEqual([]);
      expect(E14_IDS.has(deriveId(l))).toBe(true);
      expect(l.observed_state).toEqual({ mode: "edit" });
    }
    const rec = JSON.parse([...k.artifacts.entries()].find(([p]) => p.includes("reconcile"))![1]);
    expect(rec.read_ok).toBe(3);
    expect(rec.not_answered.length).toBe(SCRIPT_N - 3 - DIAG_READ_HAZARDS.length);
    expect(rec.hazard_not_read).toEqual([...DIAG_READ_HAZARDS]);
    // normalise: merge into a scratch data dir, then --check finds it current
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    copyFileSync(
      join(__dirname, "..", "..", "data", "census", "universes.json"),
      join(data, "universes.json"),
    );
    const io = { out: () => undefined, err: () => undefined };
    expect(
      runNormalise(
        ["--enumerator", "L15", "--build", "1.8.0.13", "--data", data, "--fresh", obs],
        io,
      ),
    ).toBe(0);
    expect(
      runNormalise(
        ["--enumerator", "L15", "--build", "1.8.0.13", "--data", data, "--fresh", "--check", obs],
        io,
      ),
    ).toBe(0);
  });
  it("a step never runs twice in a run folder", async () => {
    const runDir = join(TMP, "twice");
    const k = fakeKernel();
    await runWalkerSteps(buildSteps(SEL, k).slice(0, 1), deps(runDir), opts(runDir));
    const r = await runWalkerSteps(buildSteps(SEL, k).slice(0, 1), deps(runDir), opts(runDir));
    expect(r.exit).toBe(EXIT.refused);
    expect(k.walks).toBe(1);
  });
  it("a new window stops; a dialog-like window hands off; nothing is emitted", async () => {
    for (const [w, exit] of [
      [win("Stray", 9), EXIT.stopped],
      [win("Script Authorization Required", 10, "#32770"), EXIT.handoff],
    ] as const) {
      const runDir = join(TMP, `win-${exit}`);
      let n = 0;
      const r = await runWalkerSteps(
        buildSteps(SEL, fakeKernel()),
        deps(runDir, () => (n++ > 0 ? [w] : [])),
        opts(runDir),
      );
      expect(r.exit).toBe(exit);
      expect(r.stoppedAt).toBe("p4-l15-edit-walk");
      expect(readdirSync(runDir).some((f) => f.endsWith(".obs.jsonl"))).toBe(false);
    }
  });
  it("a probe timeout stops the step with no retry", async () => {
    const runDir = join(TMP, "timeout");
    const k = fakeKernel({ probe: () => ({ ok: false, timedOut: true, error: "timeout" }) });
    const r = await runWalkerSteps(buildSteps(SEL, k).slice(1), deps(runDir), opts(runDir));
    expect(r.exit).toBe(EXIT.stopped);
    expect(k.probes.length).toBe(1);
  });
  it("a message box after a read stops the diag step: no further read, the read named (P4-1 2026-10-12)", async () => {
    const runDir = join(TMP, "modal");
    const k = fakeKernel();
    const box = win("Enfusion engine", 77, "#32770");
    // the box shows after the 3rd read; the 2 s poller never fires (sleep never resolves)
    const d = deps(runDir, () => (k.probes.length >= 3 ? [box] : []));
    d.sleep = () => new Promise(() => undefined);
    const r = await runWalkerSteps(buildSteps(SEL, k).slice(1), d, opts(runDir));
    expect(r.exit).toBe(EXIT.handoff);
    expect(k.probes.length).toBe(3);
    const third = k.probes[2].diagEnum;
    expect(r.records[0].summary).toContain(`after diagRead ${third}`);
    expect(r.records[0].summary).toContain('#32770 "Enfusion engine"');
    expect(r.records[0].calls.at(-2)).toMatchObject({ call: `diagRead ${third}`, ok: true });
  });
  it("a step stopped while a call is out records that call as inFlight", async () => {
    const runDir = join(TMP, "inflight");
    const k = fakeKernel({ probe: () => new Promise<ProbeAnswer>(() => undefined) });
    const d = deps(runDir, () =>
      k.probes.length > 0 ? [win("Enfusion engine", 78, "#32770")] : [],
    );
    const r = await runWalkerSteps(buildSteps(SEL, k).slice(1), d, opts(runDir));
    expect(r.exit).toBe(EXIT.handoff);
    expect(k.probes.length).toBe(1);
    expect(r.records[0].inFlight).toBe(`diagRead ${k.probes[0].diagEnum}`);
  });
  it("play mode writes mode=play lines to its own obs file", async () => {
    const runDir = join(TMP, "play");
    const sel = { ...SEL, state: { mode: "play" as const } };
    const r = await runWalkerSteps(
      buildSteps(sel, fakeKernel()),
      deps(runDir),
      opts(runDir, "play"),
    );
    expect(r.exit).toBe(EXIT.done);
    const lines = readFileSync(join(runDir, "L15-WorldEditor-play.obs.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines.every((l) => JSON.parse(l).observed_state.mode === "play")).toBe(true);
  });
});

describe("debug-panel lines", () => {
  it("a node naming debug becomes a valid debug-panel line under worldEditorMain", () => {
    const tree: WalkNode = {
      ...WALK.tree,
      children: [
        ...(WALK.tree.children ?? []),
        {
          controlType: "Window",
          name: "Debug Panel",
          automationId: "Arma4WorkbenchApp.worldEditorMain.debugDock",
          className: "QDockWidget",
          children: [],
        },
      ],
    };
    const r = debugPanelLines(
      { doc: { tree }, path: "x", sha256: "a".repeat(64) },
      { mode: "edit" },
    );
    expect(r.lines.length).toBe(1);
    expect(validateLine(r.lines[0], "L15")).toEqual([]);
    expect(deriveId(r.lines[0])).toBe("ui:WorldEditor/debug-panel/#debugDock");
  });
});

describe("walk read-back (P4-1 2026-10-12 crash)", () => {
  const last = JSON.stringify({ out: "%LOCALAPPDATA%/x/L15-we-walk.json", sha256: "a".repeat(64) });
  it("reads the step's own outPath, never the placeholdered summary.out", () => {
    const seen: string[] = [];
    const r = walkResultFrom(
      0,
      ["log", last, ""].join(String.fromCharCode(10)),
      "C:/real/L15-we-walk.json",
      (p) => {
        seen.push(p);
        return JSON.stringify({ tree: WALK.tree });
      },
    );
    expect(seen).toEqual(["C:/real/L15-we-walk.json"]);
    expect(r.path).toBe("C:/real/L15-we-walk.json");
  });
  it("a file that does not read back throws (the caller rejects), never escapes", () => {
    expect(() =>
      walkResultFrom(0, last, "C:/real/x.json", () => {
        throw new Error("ENOENT");
      }),
    ).toThrow(/does not read back/);
  });
});
