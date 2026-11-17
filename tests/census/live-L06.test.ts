import { afterAll, describe, expect, it } from "vitest";
import { ledgerSpec, resolveLocator } from "../../src/gui/locators.js";
import type { UiaNode } from "../../src/gui/uia.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  EXIT,
  deriveId,
  runWalker,
  runWalkerSteps,
  validateLine,
  walkerPlan,
  type LiveObservation,
  type WalkerDeps,
} from "../../scripts/census/live/common.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  DEFERRED_POPUP,
  DEFERRED_SAMPLED,
  NO_E15_MATCH,
  crossCheck,
  editorLines,
  gridLines,
  makeDef,
  matchName,
  type L06Kernels,
  type WalkDoc,
} from "../../scripts/census/live/L06-grids.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l06-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = join(__dirname, "fixtures", "live");
const fixture = <T>(f: string): T => JSON.parse(readFileSync(join(FIX, f), "utf-8")) as T;
const NONE = fixture<WalkDoc>("L06-we-none.json");
const ENTITY = fixture<WalkDoc>("L06-we-entity.json");
const DESCRIBE = fixture<{ readback: { rows: Array<{ name: string }> } }>("L06-describe.json");
const SHA = "be77b85736fd5dc88bf9d645bd1f88015fa81d7c0c845744c5eb162023c32ae3";
const E16_SHA = "0".repeat(63) + "1";
const E16 = readFileSync(
  join(__dirname, "..", "..", "data", "census", "observations", "E16", "1.8.0.13.jsonl"),
  "utf-8",
)
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, unknown>)
  .filter((l) => l.$header === undefined);
const ATTRS = ["m_sName", "coords", "m_fScale"];

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

function fakeDeps(files: Map<string, string>, windows: () => WindowInfo[] = () => []): WalkerDeps {
  return {
    windows: async () => windows(),
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => 4242,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: (p) => files.has(p),
    writeFile: (p, t, exclusive) => {
      if (exclusive && files.has(p)) throw new Error("exists");
      files.set(p, t);
    },
    appendFile: (p, t) => files.set(p, (files.get(p) ?? "") + t),
    log: () => undefined,
  };
}

function fakeKernels(files: Map<string, string>, doc: WalkDoc, order: string[]): L06Kernels {
  return {
    walk: async (ctx) => {
      order.push(`walk started=${files.has(join(ctx.opts.runDir, "p4-l06-grids-walk.started"))}`);
      return { path: "<artifacts>/walk.json", sha256: SHA, doc };
    },
    describe: async (ctx) => {
      order.push(
        `describe started=${files.has(join(ctx.opts.runDir, "p4-l06-container-check.started"))}`,
      );
      return {
        path: "<artifacts>/describe.json",
        sha256: SHA,
        ok: true,
        rows: DESCRIBE.readback.rows,
      };
    },
    readText: (p) => files.get(p) ?? null,
    writeArtifact: (p, t) => {
      files.set(p, t);
      return SHA;
    },
    e15Attrs: () => ATTRS,
    e16: () => {
      order.push("e16");
      return { lines: E16, sha256: E16_SHA };
    },
  };
}

const opts = (runDir: string, selection: "none" | "entity") => ({
  enumerator: "L06",
  script: "scripts/census/live/L06-grids.ts",
  session: "P4-1",
  runDir,
  module: "WorldEditor",
  state: { mode: "edit" as const, selection },
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});

const linesOf = (text: string | undefined): LiveObservation[] =>
  (text ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LiveObservation);

describe("L06 plan", () => {
  const def = makeDef(fakeKernels(new Map(), NONE, []));
  const sel = {
    module: "WorldEditor",
    state: { mode: "edit" as const, selection: "entity" as const },
    allowOwned: false,
  };
  const plan = walkerPlan(def.steps(sel), sel);
  it("passes checkPlan with no exception", () => {
    const r = checkPlan(plan, loadPolicy(), { script: def.script });
    expect(r.ok).toBe(true);
    expect(plan.some((a) => a.exception)).toBe(false);
  });
  it("holds only a passive read and one describe: no invoke, key, Enter, typing, opener or popup", () => {
    expect(plan.map((a) => a.kind)).toEqual(["uia-read", "net-call"]);
    const text = JSON.stringify(plan);
    for (const bad of [
      /invoke/i,
      /"keys?"/,
      /Enter/,
      /execute-action/,
      /uia-dialog-cancel/,
      /uia-context/,
      /uia-menu/,
      /menu-open/,
      /SetValue/,
      /"text"/,
    ])
      expect(text).not.toMatch(bad);
    expect(plan[0].readOnly).toBe(true);
    expect((plan[0].bounds as { rowSample: number }).rowSample).toBe(40);
    expect((plan[1].params as { action: string }).action).toBe("describe");
    const labels = (loadPolicy().deny_lists as Record<string, { labels?: string[] }>)
      .openers_main_never_invokes.labels!;
    for (const l of labels) expect(text).not.toContain(l);
  });
  it("the dry-run CLI prints the outline and PASS", async () => {
    const out: string[] = [];
    const code = await runWalker(def, [], { out: (l) => out.push(l) });
    expect(code).toBe(EXIT.done);
    expect(out.at(-1)).toMatch(/PASS/);
    expect(out.filter((l) => l.includes("p4-l06-")).length).toBe(3);
  });
});

describe("L06 line building", () => {
  it("edit/none: both empty grids as property-group lines with children_count 0", () => {
    const l = gridLines(NONE, SHA, "WorldEditor", { mode: "edit", selection: "none" }, new Set());
    expect(l.map((x) => x.key)).toEqual([
      { path: ["Prefab Library", "@PropertyGridBC.1"] },
      { object_name: "entityPropGrid" },
    ]);
    expect(l.every((x) => x.children_count === 0)).toBe(true);
    expect(l[1].parent_key).toEqual({
      dim: "ui",
      kind: "dock",
      module: "WorldEditor",
      key: { object_name: "entityPropDock" },
    });
    for (const x of l) expect(validateLine(x, "L06")).toEqual([]);
  });
  it("edit/entity: categories, leaves, the unnamed row, the sampled grid deferred, E15 cross-check", () => {
    const l = gridLines(
      ENTITY,
      SHA,
      "WorldEditor",
      { mode: "edit", selection: "entity" },
      new Set(ATTRS.map(matchName)),
    );
    for (const x of l) expect(validateLine(x, "L06")).toEqual([]);
    const bc = l[0];
    expect(bc.children_count).toBeUndefined();
    expect(bc.unverified?.some((u) => u.startsWith(DEFERRED_SAMPLED))).toBe(true);
    const grid = l.find((x) => deriveId(x) === "ui:WorldEditor/property-group/#entityPropGrid")!;
    expect(grid.children_count).toBe(4);
    const obj = l.find((x) => x.label_raw === "Object")!;
    expect(obj.kind).toBe("property-group");
    expect(obj.children_count).toBe(5);
    const flags = l.find((x) => x.label_raw === "Flags")!;
    expect(flags.kind).toBe("property-group");
    expect(flags.children_count).toBeUndefined();
    const coords = l.find((x) => x.label_raw === "coords")!;
    expect(coords.kind).toBe("property");
    expect(coords.unverified).toBeUndefined();
    expect(l.find((x) => x.label_raw === "angleX")!.unverified).toEqual([NO_E15_MATCH]);
    expect(l.find((x) => x.label_raw === "m_sName")!.unverified).toBeUndefined();
    const unnamed = l.find((x) => x.confidence === "low")!;
    expect("path" in unnamed.key && unnamed.key.path.at(-1)).toMatch(/^@/);
    // every child count equals the child lines emitted
    for (const x of l.filter((y) => y.children_count !== undefined)) {
      const id = deriveId(x);
      const kids = l.filter((y) => y.parent_key && deriveId(y.parent_key as never) === id);
      expect(kids.length).toBe(x.children_count);
    }
  });
  it("E16 popups become deferred property-editor lines; nothing else", () => {
    const l = editorLines(E16, E16_SHA);
    expect(l.length).toBe(6);
    for (const x of l) {
      expect(validateLine(x, "L06")).toEqual([]);
      expect(x.children_count).toBeUndefined();
      expect(x.unverified).toEqual([DEFERRED_POPUP]);
    }
    expect(l.map((x) => deriveId(x))).toContain("ui:Shared/property-editor/UIWidgets/ColorPicker");
  });
  it("cross-check splits names into both, grid only and describe only", () => {
    const l = gridLines(ENTITY, SHA, "WorldEditor", {}, new Set());
    const c = crossCheck(l, DESCRIBE.readback.rows);
    expect(c.both).toContain("coords");
    expect(c.gridOnly).toContain("m_sName");
    expect(c.describeOnly).toEqual(["Flags"]);
  });
});

describe("L06 run on fakes", () => {
  it("steps in order, started marker before each kernel call, lines conformant, normalise --check passes", async () => {
    const files = new Map<string, string>();
    const order: string[] = [];
    const def = makeDef(fakeKernels(files, ENTITY, order));
    const o = opts("/run1", "entity");
    const r = await runWalkerSteps(def.steps(o), fakeDeps(files), o);
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => x.step)).toEqual([
      "p4-l06-grids-walk",
      "p4-l06-container-check",
      "p4-l06-editors-deferred",
    ]);
    expect(order).toEqual(["walk started=true", "describe started=true", "e16"]);
    const obsKey = [...files.keys()].find((k) => k.endsWith(".obs.jsonl"))!;
    const lines = linesOf(files.get(obsKey));
    for (const x of lines) expect(validateLine(x, "L06")).toEqual([]);
    expect(lines.filter((x) => x.kind === "property-editor").length).toBe(6);
    expect(r.records[1].summary).toMatch(/^both \d+/);

    const runDir = join(TMP, "rawrun");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, obsKey.split(/[\\/]/).pop()!), files.get(obsKey)!);
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "current-build.json"), JSON.stringify({ tag: "1.8.0.13" }));
    writeFileSync(
      join(data, "universes.json"),
      JSON.stringify({ enumerators: { L06: { generator: "scripts/census/live/L06-grids.ts" } } }),
    );
    const io = { out: () => undefined, err: (l: string) => order.push(l) };
    expect(runNormalise(["--enumerator", "L06", "--data", data, runDir], io)).toBe(0);
    expect(runNormalise(["--enumerator", "L06", "--data", data, "--check"], io)).toBe(0);
  });
  it("a step never runs twice in a run folder", async () => {
    const files = new Map<string, string>();
    const def = makeDef(fakeKernels(files, NONE, []));
    const o = opts("/run2", "none");
    expect((await runWalkerSteps(def.steps(o), fakeDeps(files), o)).exit).toBe(EXIT.done);
    const again = await runWalkerSteps(def.steps(o), fakeDeps(files), o);
    expect(again.exit).toBe(EXIT.refused);
    expect(again.stoppedAt).toBe("p4-l06-grids-walk");
  });
  it("a new window stops the walk; a dialog-like window hands off; nothing after is run", async () => {
    for (const [w, exit] of [
      [win("Stray", 9), EXIT.stopped],
      [win("Options", 9, "Qt683QWindowIcon", 3), EXIT.handoff],
    ] as const) {
      const files = new Map<string, string>();
      const order: string[] = [];
      let n = 0;
      const def = makeDef(fakeKernels(files, NONE, order));
      const o = opts(`/run-${exit}`, "none");
      const r = await runWalkerSteps(
        def.steps(o),
        fakeDeps(files, () => (n++ > 0 ? [w] : [])),
        o,
      );
      expect(r.exit).toBe(exit);
      expect(r.stoppedAt).toBe("p4-l06-grids-walk");
      expect(order.some((x) => x.startsWith("describe"))).toBe(false);
    }
  });
});

describe("DEC-078: a property-grid item's locator names the TreeItem, not the grid", () => {
  const l = gridLines(ENTITY, SHA, "WorldEditor", { mode: "edit", selection: "entity" }, new Set());
  const GRID = "entityPropGrid";

  it("named items carry the grid's id and their labels below it; the grid itself has none", () => {
    const grid = l.find((x) => deriveId(x) === "ui:WorldEditor/property-group/#entityPropGrid")!;
    expect(grid.locator?.itemPath).toBeUndefined();
    const coords = l.find((x) => x.label_raw === "coords")!;
    expect(coords.locator?.automationId).toBe(grid.locator?.automationId);
    expect(coords.locator?.automationId?.endsWith(GRID)).toBe(true);
    expect(coords.locator?.controlType).toBe("TreeItem");
    expect(coords.locator?.itemPath?.at(-1)).toBe("coords");
    expect(coords.locator?.itemPath!.length).toBeGreaterThan(1);
    // Below an unnamed item there is no label path: no itemPath.
    const unnamed = l.find((x) => x.confidence === "low")!;
    expect(unnamed.locator?.itemPath).toBeUndefined();
    for (const x of l) expect(validateLine(x, "L06")).toEqual([]);
  });

  it("each itemPath resolves, in the walked tree, to the item its ref names", () => {
    const tree = ENTITY.tree as unknown as UiaNode;
    let n = 0;
    for (const x of l) {
      if (!x.locator?.itemPath) continue;
      const spec = ledgerSpec({
        id: deriveId(x),
        module: x.module,
        kind: x.kind,
        label: x.label ?? null,
        risk: null,
        locator: { build: "1.9.0.37", ...x.locator },
      })!;
      const r = resolveLocator(tree, spec);
      expect(r.ok, `${deriveId(x)}: ${r.reason}`).toBe(true);
      expect(r.hit?.path).toBe(x.ref.split("#n/")[1]);
      expect(r.hit?.node.controlType).toBe("TreeItem");
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });
});
