import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleArgs } from "../../src/tools/wb-module.js";
import { MODULE_IDS } from "../../src/manifest/vocabulary.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import {
  EXIT,
  buildWalkerQueue,
  deriveId,
  runWalker,
  runWalkerSteps,
  validateLine,
  walkerPlan,
  type LiveObservation,
  type WalkerDeps,
} from "../../scripts/census/live/common.js";
import {
  LIST_STEP,
  MODULE_MATRIX,
  assertSendable,
  buildL10Steps,
  def,
  makeL10Def,
  moduleStepId,
  type L10Deps,
  type L10Response,
} from "../../scripts/census/live/L10-modules.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l10-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "live", "L10-modules.json"), "utf-8"),
) as {
  list: Record<string, string[]>;
  info: Record<string, Record<string, unknown>>;
  titles: Record<string, string>;
};

const PID = 4242;
const win = (title: string, hwnd: number, cls = "Qt683QWindowIcon", owner = 0): WindowInfo => ({
  hwnd,
  pid: PID,
  className: cls,
  title,
  owner,
  enabled: true,
  rect: [0, 0, 1, 1],
  monitor: [0, 0, 1, 1],
  primary: true,
});

interface Fake {
  deps: L10Deps;
  sent: ModuleArgs[];
  windows: WindowInfo[];
  files: Map<string, string>;
  /** Override one answer: module + action to a response. */
  answers: Map<string, L10Response>;
  /** Extra windows an `open` of this module also adds. */
  stray: Map<string, WindowInfo>;
  /** Modules whose open adds no window. */
  silent: Set<string>;
}

function fake(listOverride?: Record<string, string[]>): Fake {
  const f: Fake = {
    sent: [],
    windows: [win("Enfusion Workbench - EMCP2 sandbox (2.0 live lane)", 1)],
    files: new Map(),
    answers: new Map(),
    stray: new Map(),
    silent: new Set(),
    deps: undefined as unknown as L10Deps,
  };
  let hwnd = 10;
  f.deps = {
    tool: async (args) => {
      f.sent.push(args);
      const key = `${args.module ?? "-"}:${args.action}`;
      const forced = f.answers.get(key);
      if (forced) return forced;
      if (args.action === "list") return { ok: true, readback: listOverride ?? FIX.list };
      const m = args.module as string;
      if (args.action === "open") {
        const t = FIX.titles[m];
        if (!f.silent.has(m) && !f.windows.some((w) => w.title === t))
          f.windows.push(win(t, hwnd++));
        const s = f.stray.get(m);
        if (s) f.windows.push(s);
        return { ok: true, readback: { isOpen: true, called: true, openResult: true } };
      }
      if (args.action === "front") return { ok: true, readback: { isOpen: true } };
      return { ok: true, readback: { module: m, ...(FIX.info[m] ?? FIX.info.default) } };
    },
    windows: async () => f.windows.map((w) => ({ ...w })),
    writeArtifact: (p, t) => void f.files.set(p, t),
  };
  return f;
}

function walkerDeps(f: Fake, files: Map<string, string>): WalkerDeps {
  return {
    windows: async () => f.windows.map((w) => ({ ...w })),
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => PID,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: (p: string) => files.has(p),
    writeFile: (p: string, t: string, exclusive?: boolean) => {
      if (exclusive && files.has(p)) throw new Error("exists");
      files.set(p, t);
    },
    appendFile: (p: string, t: string) => files.set(p, (files.get(p) ?? "") + t),
    log: () => undefined,
  };
}

const opts = (runDir: string) => ({
  enumerator: "L10",
  script: "scripts/census/live/L10-modules.ts",
  session: "P4-1",
  runDir,
  module: "Shared",
  state: { mode: "edit" as const, selection: "none" as const },
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});

const norm = (p: string): string => p.replace(/\\/g, "/");
const obsLines = (files: Map<string, string>): LiveObservation[] =>
  [...files.entries()]
    .filter(([k]) => k.endsWith(".obs.jsonl"))
    .flatMap(([, t]) => t.split("\n").filter(Boolean))
    .map((l) => JSON.parse(l) as LiveObservation);

/** Lines of a step that ended in fail: common.ts keeps them out of the obs file (P4-FIX-A). */
const rejectedLines = (files: Map<string, string>): LiveObservation[] =>
  [...files.entries()]
    .filter(([k]) => k.endsWith(".rejected.jsonl"))
    .flatMap(([, t]) => t.split("\n").filter(Boolean))
    .map((l) => JSON.parse(l) as LiveObservation & { $rejected?: string })
    .filter((l) => l.$rejected === undefined);

describe("L10 plan", () => {
  const steps = buildL10Steps(fake().deps);
  const sel = { module: "Shared", state: {}, allowOwned: false };
  const plan = walkerPlan(steps, sel);

  it("is list first (read-only), then one mutating step per readable module in matrix order", () => {
    expect(steps.map((s) => s.id)).toEqual([
      LIST_STEP,
      ...MODULE_MATRIX.map((m, i) => moduleStepId(i + 1, m.id)),
    ]);
    expect(steps.map((s) => s.risk)).toEqual(["read-only", ...MODULE_MATRIX.map(() => "mutating")]);
    // NavmeshGeneratorMain left MODULE_IDS with 1.9.0.37 (W5 OD-5); the P4-1 matrix keeps its row.
    expect(MODULE_MATRIX.map((m) => m.id).sort()).toEqual(
      [...MODULE_IDS.filter((m) => m !== "ParticleEditor"), "NavmeshGeneratorMain"].sort(),
    );
  });
  it("passes checkPlan and holds only net-call entries", () => {
    expect(checkPlan(plan, loadPolicy(), { script: def.script }).ok).toBe(true);
    expect(new Set(plan.map((a) => a.kind))).toEqual(new Set(["net-call"]));
  });
  it("holds no key, invoke, menu, Enter, typing, close, save, action, RunCommandline or Particle Editor", () => {
    const text = JSON.stringify(plan);
    for (const bad of [
      "ParticleEditor",
      "DialogueEditor",
      "RunCommandline",
      "Enter",
      '"key"',
      '"keys"',
      '"invoke"',
      '"menu-open"',
      '"close"',
      '"save"',
      '"action":"action"',
      '"action":"setResource"',
    ])
      expect(text).not.toContain(bad);
    for (const a of plan) {
      const p = (a as { params?: Record<string, unknown> }).params ?? {};
      expect(["list", "open", "info", undefined]).toContain(p.action as string | undefined);
    }
    const apis = plan.map((a) => String(a.target));
    expect(new Set(apis)).toEqual(new Set(["EMCP_WB_Module", "BringModuleWindowToFront"]));
  });
  it("each module step expects that module's window title, and nothing but editor titles", () => {
    for (const row of MODULE_MATRIX) {
      const step = steps.find((s) => s.id.endsWith(`-${row.id}`));
      const t = FIX.titles[row.id];
      expect(step?.expectsWindows?.some((re) => re.test(t))).toBe(true);
      expect(step?.expectsWindows?.some((re) => re.test("Stray"))).toBe(false);
      expect(step?.expectsDialogs).toBeUndefined();
      expect(step?.popups).toBeUndefined();
    }
  });
  it("the queue is valid and equals the emitted one", () => {
    const q = buildWalkerQueue(def, def.steps(sel));
    expect(validateQueue(q as never, false)).toHaveLength(steps.length);
  });
  it("refuses ParticleEditor, close, save and action before any call", () => {
    for (const a of ["open", "front", "info", "close", "setResource"] as const)
      expect(() => assertSendable({ action: a, module: "ParticleEditor" })).toThrow();
    for (const a of ["close", "save", "action"] as const)
      expect(() => assertSendable({ action: a, module: "WorldEditor" })).toThrow();
    expect(() => assertSendable({ action: "info", module: "WorldEditor" })).not.toThrow();
    expect(() => assertSendable({ action: "list" })).not.toThrow();
  });
});

describe("L10 run on a fake kernel", () => {
  it("runs the matrix in order, never names ParticleEditor, and writes conformant lines", async () => {
    const f = fake();
    const files = new Map<string, string>();
    const r = await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, files), opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => x.status)).toEqual(Array(10).fill("pass"));
    // Order: list, then open/front/info per module in matrix order.
    const expected: string[] = ["-:list"];
    for (const m of MODULE_MATRIX) expected.push(`${m.id}:open`, `${m.id}:front`, `${m.id}:info`);
    expect(f.sent.map((a) => `${a.module ?? "-"}:${a.action}`)).toEqual(expected);
    expect(JSON.stringify(f.sent)).not.toContain("ParticleEditor");
    expect(JSON.stringify(f.sent)).not.toContain("DialogueEditor");
    expect(f.sent.every((a) => ["list", "open", "front", "info"].includes(a.action))).toBe(true);
    // Markers and records for every step, started first.
    const keys = [...files.keys()].map(norm);
    for (const s of buildL10Steps(f.deps)) {
      expect(keys).toContain(`/run/${s.id}.started`);
      expect(keys).toContain(`/run/${s.id}.json`);
    }
    // Lines: 9 modules + the Particle Editor row from the list alone.
    const lines = obsLines(files);
    expect(lines).toHaveLength(10);
    for (const l of lines) {
      expect(validateLine(l, "L10")).toEqual([]);
      expect(l.kind).toBe("module");
      expect(l.observed_state).toEqual({});
      expect(l.parent_key).toBeNull();
      expect(deriveId(l)).toBe(`ui:${l.module}/module/${l.module}`);
    }
    const particle = lines.find((l) => l.module === "ParticleEditor");
    expect(particle?.confidence).toBe("medium");
    expect(particle?.unverified?.[0]).toContain("DEC-042");
    expect(
      lines.filter((l) => l.module !== "ParticleEditor").every((l) => l.confidence === "high"),
    ).toBe(true);
    // Order of the rows: list step first, then matrix order.
    expect(lines.map((l) => l.module)).toEqual([
      "ParticleEditor",
      ...MODULE_MATRIX.map((m) => m.id),
    ]);
  });

  it("each line cites the sha256 of an artifact that holds the title and the container count", async () => {
    const f = fake();
    const files = new Map<string, string>();
    await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, files), opts("/run2"));
    const world = obsLines(files).find((l) => l.module === "WorldEditor")!;
    const sha = /^artifact:([0-9a-f]{64})#module\/WorldEditor$/.exec(world.ref)?.[1];
    expect(sha).toBeTruthy();
    const art = [...f.files.entries()].find(([k]) =>
      norm(k).endsWith("/L10-WorldEditor-module.json"),
    )!;
    expect(createHash("sha256").update(art[1], "utf-8").digest("hex")).toBe(sha);
    const body = JSON.parse(art[1]);
    expect(body).toMatchObject({
      module: "WorldEditor",
      isOpen: true,
      containerCount: 2,
      windowTitle: "World Editor - <world>",
      titleUnverified: false,
    });
    const rm = JSON.parse(
      [...f.files.entries()].find(([k]) =>
        norm(k).endsWith("/L10-ResourceManager-module.json"),
      )![1],
    );
    expect(rm.titleUnverified).toBe(true);
    expect(rm.windowTitle).toContain("Enfusion Workbench");
    const rmLine = obsLines(files).find((l) => l.module === "ResourceManager")!;
    expect(rmLine.unverified?.join(" ")).toContain("recorded live");
    // The step record lists the artifact.
    const rec = JSON.parse(
      [...files.entries()].find(([k]) => norm(k).endsWith("/p4-l10-07-WorldEditor.json"))![1],
    );
    expect(rec.artifacts).toHaveLength(1);
    expect(rec.summary).toContain("containers 2");
    expect(rec.windowsAdded.map((w: { title: string }) => w.title)).toContain(
      "World Editor - <world>",
    );
  });

  it("a window the step does not expect stops the run: no later step starts, nothing retried", async () => {
    const f = fake();
    f.stray.set("AudioEditor", win("Mystery Tool", 99));
    const files = new Map<string, string>();
    const r = await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, files), opts("/run3"));
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe(moduleStepId(3, "AudioEditor"));
    expect(f.sent.some((a) => a.module === "AnimEditor")).toBe(false);
    expect(f.sent.filter((a) => a.module === "AudioEditor" && a.action === "open")).toHaveLength(1);
    // A rerun of the stopped step in the same run folder is refused.
    const again = await runWalkerSteps(
      buildL10Steps(fake().deps).slice(3, 4),
      walkerDeps(f, files),
      opts("/run3"),
    );
    expect(again.exit).toBe(EXIT.refused);
  });

  it("a dialog-like window is a handoff", async () => {
    const f = fake();
    f.stray.set("BehaviorEditor", win("Script Authorization Required", 98, "Qt683QWindowIcon", 7));
    const r = await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, new Map()), opts("/run4"));
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stoppedAt).toBe(moduleStepId(2, "BehaviorEditor"));
  });

  it("MODAL_OPEN hands off, LOST and WEDGED stop; none is retried", async () => {
    for (const [code, exit] of [
      ["MODAL_OPEN", EXIT.handoff],
      ["LOST", EXIT.stopped],
      ["WEDGED", EXIT.stopped],
    ] as const) {
      const f = fake();
      f.answers.set("AudioEditor:info", { ok: false, code, message: "x" });
      const r = await runWalkerSteps(
        buildL10Steps(f.deps),
        walkerDeps(f, new Map()),
        opts(`/r-${code}`),
      );
      expect(r.exit).toBe(exit);
      expect(f.sent.filter((a) => a.module === "AudioEditor" && a.action === "info")).toHaveLength(
        1,
      );
      expect(f.sent.some((a) => a.module === "AnimEditor")).toBe(false);
    }
  });

  it("a refusal other than those is recorded as fail with a low-confidence line (rejected file), and the run goes on", async () => {
    const f = fake();
    f.answers.set("AudioEditor:open", { ok: false, code: "UNREACHABLE", message: "x" });
    const files = new Map<string, string>();
    const r = await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, files), opts("/run5"));
    expect(r.exit).toBe(EXIT.done);
    const rec = r.records.find((x) => x.step === moduleStepId(3, "AudioEditor"))!;
    expect(rec.status).toBe("fail");
    // After a refused open, front and info are not sent.
    expect(f.sent.filter((a) => a.module === "AudioEditor").map((a) => a.action)).toEqual(["open"]);
    expect(obsLines(files).find((x) => x.module === "AudioEditor")).toBeUndefined();
    const l = rejectedLines(files).find((x) => x.module === "AudioEditor")!;
    expect(l.confidence).toBe("low");
    expect(validateLine(l, "L10")).toEqual([]);
  });

  it("a module whose window never shows its title is a fail, not a high-confidence line", async () => {
    const f = fake();
    f.silent.add("NavmeshGeneratorMain");
    const files = new Map<string, string>();
    const r = await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, files), opts("/run6"));
    const rec = r.records.find((x) => x.step.endsWith("NavmeshGeneratorMain"))!;
    expect(rec.status).toBe("fail");
    expect(rec.summary).toContain("title not found");
    expect(obsLines(files).find((x) => x.module === "NavmeshGeneratorMain")).toBeUndefined();
    const l = rejectedLines(files).find((x) => x.module === "NavmeshGeneratorMain")!;
    expect(l.confidence).toBe("medium");
    expect(l.unverified?.join(" ")).toContain("no window with the expected title");
  });

  it("a list that misses a module or names DialogueEditor fails the list step; a missed module is not sent", async () => {
    const f = fake({
      modules: FIX.list.modules.filter((m) => m !== "AudioEditor").concat("DialogueEditor"),
      open: [],
      unread: ["ParticleEditor"],
    });
    const files = new Map<string, string>();
    const r = await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, files), opts("/run7"));
    expect(r.records[0].status).toBe("fail");
    expect(r.records[0].summary).toContain("missing [AudioEditor]");
    expect(r.records[0].summary).toContain("DialogueEditor LISTED");
    expect(f.sent.some((a) => a.module === "AudioEditor")).toBe(false);
    expect(f.sent.some((a) => (a.module as string) === "DialogueEditor")).toBe(false);
  });

  it("a baseline dialog refuses the step before any call", async () => {
    const f = fake();
    f.windows.push(win("Options", 77, "Qt683QWindowIcon", 5));
    const r = await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, new Map()), opts("/run8"));
    expect(r.exit).toBe(EXIT.handoff);
    expect(f.sent).toHaveLength(0);
  });
});

describe("L10 files and CLI", () => {
  it("the raw obs file merges with normalise.ts and --check passes", async () => {
    const f = fake();
    const runDir = join(TMP, "raw");
    mkdirSync(runDir, { recursive: true });
    const files = new Map<string, string>();
    await runWalkerSteps(buildL10Steps(f.deps), walkerDeps(f, files), opts(runDir));
    const raw = [...files.entries()].find(([k]) => k.endsWith(".obs.jsonl"))!;
    writeFileSync(join(runDir, "L10-Shared-edit-none.obs.jsonl"), raw[1]);
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "current-build.json"), JSON.stringify({ tag: "1.8.0.13" }));
    writeFileSync(
      join(data, "universes.json"),
      JSON.stringify({
        enumerators: { L10: { generator: "scripts/census/live/L10-modules.ts" } },
      }),
    );
    const err: string[] = [];
    const io = { out: () => undefined, err: (l: string) => void err.push(l) };
    expect(runNormalise(["--enumerator", "L10", "--data", data, runDir], io)).toBe(0);
    expect(err).toEqual([]);
    const committed = readFileSync(join(data, "observations", "L10", "1.8.0.13.jsonl"), "utf-8");
    expect(committed.trim().split("\n")).toHaveLength(11); // header + 10 rows
    expect(runNormalise(["--enumerator", "L10", "--data", data, "--check"], io)).toBe(0);
    expect(readdirSync(runDir).some((n) => n.endsWith(".obs.jsonl"))).toBe(true);
  });

  it("the CLI without --really prints the outline, passes the dry run and writes plan, outline and queue", async () => {
    const out = join(TMP, "plan.json");
    const outline = join(TMP, "outline.txt");
    const q = join(TMP, "queue.json");
    const said: string[] = [];
    const code = await runWalker(
      makeL10Def(() => fake().deps),
      ["--out", out, "--outline", outline, "--emit-queue", q],
      { out: (l) => void said.push(l) },
    );
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain("PASS");
    expect(readFileSync(outline, "utf-8")).toContain(moduleStepId(1, "LocalizationEditor"));
    const plan = JSON.parse(readFileSync(out, "utf-8"));
    expect(checkPlan(plan, loadPolicy(), { script: def.script }).ok).toBe(true);
    const queue = JSON.parse(readFileSync(q, "utf-8"));
    expect(queue).toMatchObject({ session: "P4-1", enumerator: "L10" });
    expect(queue.probes.map((p: { risk_class: string }) => p.risk_class)).toEqual([
      "read-only",
      ...Array(9).fill("mutating"),
    ]);
    expect(
      queue.probes.every((p: { expected: string; kill_criterion: string; rollback: string }) =>
        Boolean(p.expected && p.kill_criterion && p.rollback),
      ),
    ).toBe(true);
  });

  it("a real run without the lease is refused", async () => {
    const code = await runWalker(
      makeL10Def(() => fake().deps),
      ["--really", "--only", LIST_STEP, "--module", "Shared"],
      { out: () => undefined },
    );
    expect(code).not.toBe(EXIT.done);
  });
});
