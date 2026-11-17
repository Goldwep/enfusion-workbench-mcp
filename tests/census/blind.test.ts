import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXIT,
  deriveId,
  runWalker,
  type WalkerDeps,
} from "../../scripts/census/live/common.js";
import type { MenuReader, MenusDoc } from "../../scripts/census/live/L02-menus.js";
import {
  DEFAULT_THRESHOLD,
  FLOOR,
  allocate,
  blindDef,
  buildDrawPlan,
  buildFrame,
  checkDraws,
  countsInState,
  drawFrom,
  findReadDoc,
  frameSizes,
  ledgerOf,
  liveItems,
  main,
  mulberry32,
  reusingMenuReader,
  runSubOf,
  type ContextReader,
  type Draw,
  type FrameElement,
  type LedgerRow,
  type ReadDoc,
} from "../../scripts/census/blind.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { PASSIVE_TIMEOUT_MS } from "../../scripts/census/live/L05-context.js";
import type { ContextDoc } from "../../tools/uia/context.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-blind-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const live = [{ enumerator: "L02" }];
const id = (kind: string, module: string, path: string[]): string =>
  deriveId({ dim: "ui", kind: kind as "menu", module, key: { path } });

/** A policy copy with a small menu and context table (the rest is the real policy). */
function fakePolicy(): CensusPolicy {
  const p = JSON.parse(JSON.stringify(loadPolicy())) as CensusPolicy & {
    live_lane: Record<string, Record<string, unknown>>;
  };
  p.live_lane.uia_menu.titles_by_module = {
    WorldEditor: ["File", "Edit"],
    ResourceManager: ["File"],
    Launcher: [],
    ParticleEditor: ["File"],
  };
  p.live_lane.uia_context.targets = [{ module: "WorldEditor", path: ["Hierarchy", "default"] }];
  return p;
}

const WE_FILE = id("menu", "WorldEditor", ["File"]);
const WE_RECENT = id("menu", "WorldEditor", ["File", "Recent"]);
const CTX = id("context-menu", "WorldEditor", ["Hierarchy", "default"]);

function fakeRows(): LedgerRow[] {
  return [
    { id: WE_FILE, kind: "menu", module: "WorldEditor", label: "File", sources: live },
    {
      id: WE_RECENT,
      kind: "menu",
      module: "WorldEditor",
      parent: WE_FILE,
      label: "Recent",
      label_raw: "Recent",
      sources: live,
    },
    {
      id: id("menu", "WorldEditor", ["File", "Wiki only"]),
      kind: "menu",
      module: "WorldEditor",
      parent: WE_FILE,
      label: "Wiki only",
      sources: [{ enumerator: "E07" }],
    },
    {
      id: `${WE_FILE}/Open`,
      kind: "menu-item",
      module: "WorldEditor",
      parent: WE_FILE,
      label: "Open",
      observed_states: [{ mode: "edit" }],
      sources: live,
    },
    {
      id: `${WE_FILE}/Close`,
      kind: "menu-item",
      module: "WorldEditor",
      parent: WE_FILE,
      label: "Close",
      observed_states: [{ mode: "edit" }],
      sources: live,
    },
    {
      id: `${WE_RECENT}/a.ent`,
      kind: "menu-item",
      module: "WorldEditor",
      parent: WE_RECENT,
      label: "a.ent",
      sources: live,
    },
    {
      id: CTX,
      kind: "context-menu",
      module: "WorldEditor",
      observed_states: [{ mode: "edit", selection: "layer" }],
      sources: [{ enumerator: "L05" }],
    },
    {
      id: `${CTX}/Delete`,
      kind: "context-item",
      module: "WorldEditor",
      parent: CTX,
      label: "Delete",
      observed_states: [{ mode: "edit", selection: "layer" }],
      sources: [{ enumerator: "L05" }],
    },
    {
      id: "ui:WorldEditor/dialog/#createWorldDialog",
      kind: "dialog",
      module: "WorldEditor",
      label: "Create world",
      label_raw: "Create world",
      sources: [{ enumerator: "L04" }],
    },
    {
      id: "ui:WorldEditor/control/Create world/OK",
      kind: "control",
      module: "WorldEditor",
      parent: "ui:WorldEditor/dialog/#createWorldDialog",
      label: "OK",
      sources: [{ enumerator: "L04" }],
    },
    {
      id: "ui:WorldEditor/control/Create world/Cancel",
      kind: "control",
      module: "WorldEditor",
      parent: "ui:WorldEditor/dialog/#createWorldDialog",
      label: "Cancel",
      sources: [{ enumerator: "L04" }],
    },
    {
      id: "ui:WorldEditor/dialog/Wiki dialog",
      kind: "dialog",
      module: "WorldEditor",
      label: "Wiki dialog",
      sources: [{ enumerator: "E07" }],
    },
  ];
}

const POPUP = { count: 1, automationIds: [], classNames: [], truncated: false };
function fileMenusDoc(extra: Array<Record<string, unknown>> = []): MenusDoc {
  return {
    result: "ok",
    leftOpen: [],
    menus: [
      {
        title: "File",
        opened: true,
        collapsed: true,
        popup: POPUP,
        items: [
          { controlType: "MenuItem", name: "Open\tCtrl+O" },
          { controlType: "Separator", name: "" },
          { controlType: "MenuItem", name: "" },
          {
            controlType: "MenuItem",
            name: "Recent",
            submenu: true,
            opened: true,
            collapsed: true,
            popup: POPUP,
            children: [
              { controlType: "MenuItem", name: "a.ent" },
              { controlType: "MenuItem", name: "b.ent" },
            ],
          },
          ...(extra as never[]),
        ],
      },
    ],
  } as MenusDoc;
}

describe("blind draw", () => {
  const policy = fakePolicy();
  const ledger = ledgerOf(fakeRows(), "1.8.0.13");

  it("builds the frame blind of item rows: titles, live sub-menus, policy targets, live dialogs, per live state", () => {
    const frame = buildFrame(policy, ledger);
    const we = frame.filter((e) => e.module === "WorldEditor");
    // 3 states x (2 titles + 1 live sub-menu + 1 live dialog + 1 target)
    expect(we).toHaveLength(15);
    expect(frameSizes(frame).WorldEditor).toEqual({
      menu: 6,
      submenu: 3,
      dialog: 3,
      "context-menu": 3,
    });
    expect(frame.some((e) => e.open.menuPath?.includes("Wiki only"))).toBe(false);
    expect(frame.some((e) => e.open.dialog === "Wiki dialog")).toBe(false);
    expect(frame.some((e) => e.module === "ParticleEditor" || e.module === "Launcher")).toBe(false);
    expect([...new Set(we.map((e) => e.state))]).toEqual([
      "mode=edit,selection=none",
      "mode=edit,selection=layer",
      "mode=edit,selection=entity",
    ]);
    expect(frame.filter((e) => e.module === "ResourceManager").map((e) => e.state)).toEqual([
      "none",
    ]);
    // A title the ledger does not hold maps to null (a finding, not an error).
    expect(we.find((e) => e.open.menuPath?.[0] === "Edit")?.container_id).toBeNull();
    expect(we.find((e) => e.kind === "submenu")?.container_id).toBe(WE_RECENT);
    expect(we.find((e) => e.kind === "context-menu")?.container_id).toBe(CTX);
    expect(we.find((e) => e.kind === "dialog")?.open.opener_hint).toBe("New World");
  });

  it("is deterministic for a seed and changes with the seed", () => {
    const frame: FrameElement[] = Array.from({ length: 120 }, (_, i) => ({
      module: "WorldEditor",
      state: "mode=edit,selection=none",
      kind: "menu" as const,
      open: { menuPath: [`T${String(i).padStart(3, "0")}`] },
      container_id: null,
    }));
    const a = drawFrom(frame, 30, 7);
    expect(drawFrom(frame, 30, 7)).toEqual(a);
    expect(drawFrom(frame, 30, 8).map((d) => d.open.menuPath![0])).not.toEqual(
      a.map((d) => d.open.menuPath![0]),
    );
    expect(a.map((d) => d.id)).toEqual(Array.from({ length: 30 }, (_, i) => `b-${String(i + 1).padStart(3, "0")}`));
    const r = mulberry32(1);
    const x = [r(), r(), r()];
    const r2 = mulberry32(1);
    expect([r2(), r2(), r2()]).toEqual(x);
  });

  it("stratifies by module with a floor of 10, proportional above it, never above a stratum", () => {
    expect(FLOOR).toBe(10);
    const al = allocate([200, 5, 50], 60, FLOOR);
    expect(al.reduce((a, b) => a + b, 0)).toBe(60);
    expect(al[1]).toBe(5);
    expect(al[2]).toBeGreaterThanOrEqual(10);
    expect(al[0]).toBeGreaterThan(al[2]);
    expect(allocate([3, 4], 300, FLOOR)).toEqual([3, 4]);
    const mk = (module: string, n: number, kind: "menu" | "submenu" = "menu"): FrameElement[] =>
      Array.from({ length: n }, (_, i) => ({
        module,
        state: "none",
        kind,
        open: { menuPath: [`${module}${kind}${i}`] },
        container_id: null,
      }));
    const frame = [
      ...mk("ResourceManager", 150),
      ...mk("ResourceManager", 50, "submenu"),
      ...mk("AnimEditor", 12),
      ...mk("AudioEditor", 40),
    ];
    const draws = drawFrom(frame, 60, 42);
    const by = frameSizes(draws);
    expect(draws).toHaveLength(60);
    expect(by.AnimEditor.menu).toBe(10);
    expect(by.AudioEditor.menu).toBeGreaterThanOrEqual(10);
    // then by kind, proportional inside the module (150:50)
    expect(by.ResourceManager.menu).toBeGreaterThan(by.ResourceManager.submenu);
    expect(new Set(draws.map((d) => d.open.menuPath![0])).size).toBe(60);
  });

  it("draws the whole frame when --n exceeds it and records the shortfall", () => {
    const p = buildDrawPlan(policy, ledger, 300, 48);
    expect(p.n_requested).toBe(300);
    expect(p.n_drawn).toBe(p.frame_size);
    expect(p.draws[0].module).toBe("WorldEditor");
    expect(runSubOf(p.draws[0])).toBe("WorldEditor-edit-none");
    expect(JSON.stringify(p)).not.toMatch(/[A-Za-z]:\\\\|\/Users\//);
  });
});

describe("blind check", () => {
  const ledger = ledgerOf(fakeRows(), "1.8.0.13");
  const S = "mode=edit,selection=entity";
  const draws: Draw[] = [
    { id: "b-001", module: "WorldEditor", state: S, kind: "menu", open: { menuPath: ["File"] }, container_id: WE_FILE },
    {
      id: "b-002",
      module: "WorldEditor",
      state: S,
      kind: "submenu",
      open: { menuPath: ["File", "Recent"] },
      container_id: WE_RECENT,
    },
    {
      id: "b-003",
      module: "WorldEditor",
      state: S,
      kind: "context-menu",
      open: { target: ["Hierarchy", "default"] },
      container_id: CTX,
    },
    {
      id: "b-004",
      module: "WorldEditor",
      state: S,
      kind: "context-menu",
      open: { target: ["Hierarchy", "unnamed"] },
      container_id: null,
    },
    {
      id: "b-005",
      module: "WorldEditor",
      state: S,
      kind: "dialog",
      open: { dialog: "Create world" },
      container_id: "ui:WorldEditor/dialog/#createWorldDialog",
    },
    { id: "b-006", module: "WorldEditor", state: S, kind: "menu", open: { menuPath: ["Edit"] }, container_id: null },
  ];
  const ctxDoc = (names: string[]): ReadDoc =>
    ({
      result: "ok",
      supported: true,
      popup: { controlType: "Menu", name: "" },
      items: [...names.map((n) => ({ controlType: "MenuItem", name: n })), { controlType: "Separator" }],
    }) as ReadDoc;
  const docs: Record<string, ReadDoc> = {
    "b-001": fileMenusDoc(),
    "b-002": fileMenusDoc(),
    "b-003": ctxDoc(["Delete", "Rename"]),
    "b-004": ctxDoc(["Collapse all"]),
    "b-005": {
      completed: true,
      tree: {
        controlType: "Window",
        name: "Create world",
        children: [
          { controlType: "Button", name: "OK" },
          { controlType: "Button", name: "Cancel" },
        ],
      },
    } as ReadDoc,
  };
  const plan = { draws, seed: 1, n_drawn: draws.length, ledger_build: "1.8.0.13" };
  const report = checkDraws(plan, ledger, (d) => docs[d.id] ?? null);

  it("reads live items by the walkers' rules: separators and unnamed items are not items", () => {
    expect(liveItems(draws[0], docs["b-001"]).labels).toEqual(["Open", "Recent"]);
    expect(liveItems(draws[1], docs["b-002"]).labels).toEqual(["a.ent", "b.ent"]);
    expect(liveItems(draws[2], docs["b-003"]).labels).toEqual(["Delete", "Rename"]);
    expect(liveItems(draws[4], docs["b-005"]).labels).toEqual(["OK", "Cancel"]);
    const gone = liveItems(
      { ...draws[1], open: { menuPath: ["File", "Nope"] } },
      docs["b-002"],
    );
    expect(gone.seen).toBe(false);
  });

  it("books an item live but absent as an ESCAPE and a ledger child not seen live as a NOTE", () => {
    // b-002: b.ent is live, the ledger has only a.ent under Recent.
    const e = report.escapes.find((x) => x.draw === "b-002");
    expect(e).toMatchObject({ label: "b.ent", root_cause: null, candidates: ["L02"], container_id: WE_RECENT });
    // b-001: Open and Recent are both in the ledger (Recent as the sub-menu row); Close is a note.
    expect(report.escapes.some((x) => x.draw === "b-001")).toBe(false);
    expect(report.notes).toContainEqual(
      expect.objectContaining({ draw: "b-001", label: "Close", row: `${WE_FILE}/Close` }),
    );
    // b-005: the dialog's controls are in the ledger.
    expect(report.escapes.some((x) => x.draw === "b-005")).toBe(false);
  });

  it("matches a live label against label_raw too: a row merged with a wiki row keeps the wiki casing in label", () => {
    const rows = fakeRows().map((r) =>
      r.id === `${WE_FILE}/Open` ? { ...r, label: "Open file", label_raw: "Open" } : r,
    );
    const rep = checkDraws({ ...plan, draws: [draws[0]] }, ledgerOf(rows, "1.8.0.13"), (d) => docs[d.id] ?? null);
    expect(rep.escapes).toEqual([]);
    expect(rep.notes.some((n) => n.row === `${WE_FILE}/Open`)).toBe(false);
    // without the live text in label_raw the same row is an escape and a note
    const bare = fakeRows().map((r) => (r.id === `${WE_FILE}/Open` ? { ...r, label: "Open file" } : r));
    const rep2 = checkDraws({ ...plan, draws: [draws[0]] }, ledgerOf(bare, "1.8.0.13"), (d) => docs[d.id] ?? null);
    expect(rep2.escapes.map((e) => e.label)).toEqual(["Open"]);
    expect(rep2.notes).toContainEqual(expect.objectContaining({ label: "Open file", row: `${WE_FILE}/Open` }));
  });

  it("counts a context item only in the state its axes name; another state's row is an escape with its states", () => {
    // context-item carries mode and selection in the World Editor: Delete was seen with a layer
    // selected, the draw is in edit/entity.
    const del = report.escapes.find((x) => x.draw === "b-003" && x.label === "Delete");
    expect(del?.ledger_states).toEqual([{ mode: "edit", selection: "layer" }]);
    expect(report.escapes.find((x) => x.draw === "b-003" && x.label === "Rename")?.candidates).toEqual([
      "L05",
    ]);
    const row = fakeRows().find((r) => r.label === "Delete")!;
    expect(countsInState(row, { mode: "edit", selection: "layer" })).toBe(true);
    expect(countsInState(row, { mode: "edit", selection: "entity" })).toBe(false);
    // menu-item has no declared axis: any observation counts.
    const open = fakeRows().find((r) => r.label === "Open")!;
    expect(countsInState(open, { mode: "play" })).toBe(true);
  });

  it("reports a container unknown to the ledger as a finding; its live items are escapes", () => {
    expect(report.container_unknown.map((c) => c.draw)).toEqual(["b-004"]);
    expect(report.escapes.find((x) => x.draw === "b-004")).toMatchObject({
      label: "Collapse all",
      container_unknown: true,
      container_id: null,
    });
    expect(report.not_read).toEqual(["b-006"]);
  });

  it("gates on the pooled draw rate against the threshold (D5 pending) and reports item rates", () => {
    expect(report.header.threshold).toBe(DEFAULT_THRESHOLD);
    expect(report.header.threshold_note).toMatch(/D5/);
    expect(report.pooled).toMatchObject({ draws: 6, checked: 5, not_read: 1, draws_with_escape: 3 });
    expect(report.pooled.draw_rate).toBeCloseTo(3 / 5);
    expect(report.pooled.items_live).toBe(2 + 2 + 2 + 1 + 2);
    expect(report.pooled.items_escaped).toBe(1 + 2 + 1);
    expect(report.pooled.verdict).toBe("over");
    expect(report.modules.WorldEditor.verdict).toBe("over");
    const clean = checkDraws({ ...plan, draws: [draws[0], draws[4]] }, ledger, (d) => docs[d.id]);
    expect(clean.pooled.verdict).toBe("under");
  });

  it("check CLI: exit 0 under, 1 over, 2 usage; reads <reads>/<module>-<state>/<id>-<suffix>.json", async () => {
    const reads = join(TMP, "reads");
    const put = (d: Draw): void => {
      const dir = join(reads, runSubOf(d));
      mkdirSync(dir, { recursive: true });
      const suffix = d.kind === "dialog" ? "walk" : d.kind === "context-menu" ? "context" : "menus";
      writeFileSync(join(dir, `${d.id}-${suffix}.json`), JSON.stringify(docs[d.id]));
    };
    put(draws[0]);
    put(draws[4]);
    expect(findReadDoc(reads, draws[0])).toBe(join(reads, "WorldEditor-edit-entity", "b-001-menus.json"));
    const under = join(TMP, "under.json");
    writeFileSync(
      under,
      JSON.stringify({ ...plan, schema: "emcp-blind-draws/1", draws: [draws[0], draws[4]] }),
    );
    const out = join(TMP, "report.json");
    const logs: string[] = [];
    const o = { ledger, log: (l: string) => logs.push(l) };
    expect(await main(["check", "--draws", under, "--reads", reads, "--out", out], o)).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf-8")).pooled.verdict).toBe("under");
    put(draws[1]);
    const over = join(TMP, "over.json");
    writeFileSync(over, JSON.stringify({ ...plan, schema: "emcp-blind-draws/1", draws: draws.slice(0, 2) }));
    expect(await main(["check", "--draws", over, "--reads", reads, "--out", out], o)).toBe(1);
    expect(await main(["check", "--draws", over, "--out", out], o)).toBe(2);
    expect(await main(["bogus"], o)).toBe(2);
  });
});

describe("blind walk (one step per draw, no observation line)", () => {
  const policy = fakePolicy();
  const draw: Draw = {
    id: "b-007",
    module: "WorldEditor",
    state: "mode=edit,selection=layer",
    kind: "submenu",
    open: { menuPath: ["File", "Recent"] },
    container_id: WE_RECENT,
  };

  function fakeDeps(files: Map<string, string>): WalkerDeps {
    return {
      windows: async () => [],
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

  async function run(reader: MenuReader, runDir: string): Promise<{ code: number; files: Map<string, string> }> {
    mkdirSync(runDir, { recursive: true });
    const files = new Map<string, string>();
    const code = await runWalker(
      blindDef([draw], { menuReader: reader, policy }),
      [
        "--really",
        "--id",
        "lane",
        "--module",
        "WorldEditor",
        "--state",
        draw.state,
        "--run-dir",
        runDir,
        "--sandbox",
        join(TMP, "EMCP2_sandbox"),
        "--only",
        draw.id,
      ],
      {
        out: () => undefined,
        platform: "win32",
        leaseHeld: true,
        artifactsRoot: join(TMP, "art"),
        deps: fakeDeps(files),
        evidenceDir: null,
        policy,
      },
    );
    return { code, files };
  }

  it("reads the drawn title at depth 1 into <run>/b-NNN-menus.json and emits nothing", async () => {
    const runDir = join(TMP, "art", "WorldEditor-edit-layer");
    let asked: { menu: string; depth: number; out: string } | null = null;
    const reader: MenuReader = async (r) => {
      asked = r;
      const doc = fileMenusDoc();
      writeFileSync(r.out, JSON.stringify(doc));
      return { code: 0, doc, text: JSON.stringify(doc) };
    };
    const { code, files } = await run(reader, runDir);
    expect(code).toBe(EXIT.done);
    expect(asked).toMatchObject({ menu: "File", depth: 1, out: join(runDir, "b-007-menus.json") });
    expect(existsSync(join(runDir, "b-007-menus.json"))).toBe(true);
    const rec = JSON.parse(files.get(join(runDir, "b-007.json"))!) as { status: string; summary: string };
    expect(rec.status).toBe("pass");
    expect(rec.summary).toMatch(/2 named item/);
    expect([...files.keys()].some((k) => k.endsWith(".obs.jsonl"))).toBe(false);
  });

  it("reusingMenuReader: one live read per title; a later request gets a byte copy and a reuse line", async () => {
    const dir = join(TMP, "reuse");
    mkdirSync(dir, { recursive: true });
    let calls = 0;
    let fail = true;
    const real: MenuReader = async (r) => {
      calls++;
      if (r.menu === "Edit" && fail) return { code: 1, doc: null, text: null };
      const doc = fileMenusDoc();
      const text = JSON.stringify({ ...doc, call: calls });
      writeFileSync(r.out, text);
      return { code: 0, doc, text };
    };
    const reused: Array<{ out: string; reused_read: string; menu: string }> = [];
    const reader = reusingMenuReader(real, (r) => reused.push(r));
    const req = (menu: string, n: string, pid = 1) => ({
      pid,
      module: "WorldEditor",
      className: "c",
      title: "t",
      menu,
      allowed: ["File", "Edit"],
      depth: 1 as const,
      out: join(dir, `${n}-menus.json`),
    });
    await reader(req("File", "b-001"));
    const again = await reader(req("File", "b-002"));
    expect(calls).toBe(1);
    expect(again.code).toBe(0);
    expect(readFileSync(join(dir, "b-002-menus.json"), "utf-8")).toBe(
      readFileSync(join(dir, "b-001-menus.json"), "utf-8"),
    );
    expect(reused).toEqual([{ out: "b-002-menus.json", reused_read: "b-001-menus.json", menu: "File" }]);
    // another Workbench process is another read; a failed read is not kept
    await reader(req("File", "b-003", 2));
    expect(calls).toBe(2);
    expect((await reader(req("Edit", "b-004"))).code).toBe(1);
    fail = false;
    expect((await reader(req("Edit", "b-005"))).code).toBe(0);
    expect(calls).toBe(4);
    expect(reused).toHaveLength(1);
  });

  it("walk --kinds and --reuse-reads: usage errors before any step; --kinds drops the other draws", async () => {
    const planPath = join(TMP, "walk-plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        schema: "emcp-blind-draws/1",
        seed: 1,
        n_requested: 1,
        n_drawn: 1,
        frame_size: 1,
        ledger_build: null,
        draws: [draw],
      }),
    );
    const logs: string[] = [];
    const o = { log: (l: string) => logs.push(l), out: (l: string) => logs.push(l), policy };
    expect(await main(["walk", "--draws", planPath, "--kinds", "menu,bogus"], o)).toBe(EXIT.usage);
    expect(logs.at(-1)).toMatch(/not bogus/);
    expect(await main(["walk", "--draws", planPath, "--reuse-reads"], o)).toBe(EXIT.usage);
    expect(logs.at(-1)).toMatch(/--run-dir/);
    const dry = ["--module", "WorldEditor", "--state", draw.state];
    logs.length = 0;
    await main(["walk", "--draws", planPath, "--kinds", "menu", ...dry], o);
    expect(logs.join("\n")).not.toMatch(/b-007/);
    logs.length = 0;
    await main(["walk", "--draws", planPath, "--kinds", "submenu", ...dry], o);
    expect(logs.join("\n")).toMatch(/b-007/);
  });

  it("hands off on a popup left open (D13 rule 4) and plans only Expand and Collapse", async () => {
    const runDir = join(TMP, "art", "left-open");
    const reader: MenuReader = async (r) => {
      const doc = { ...fileMenusDoc(), leftOpen: [["File"]] } as MenusDoc;
      writeFileSync(r.out, JSON.stringify(doc));
      return { code: 0, doc, text: JSON.stringify(doc) };
    };
    const { code } = await run(reader, runDir);
    expect(code).toBe(EXIT.handoff);
    const steps = blindDef([draw], { policy }).steps({
      module: "WorldEditor",
      state: { mode: "edit", selection: "layer" },
      allowOwned: false,
    });
    expect(steps.map((s) => s.id)).toEqual(["b-007"]);
    const plan = steps[0].plan({ module: "WorldEditor", state: {}, allowOwned: false });
    expect(plan).toEqual([expect.objectContaining({ kind: "uia-menu", menus: ["File"], depth: 1, calls: ["Expand", "Collapse"] })]);
    // another state plans nothing for this draw
    expect(
      blindDef([draw], { policy }).steps({ module: "WorldEditor", state: { mode: "edit", selection: "none" }, allowOwned: false }),
    ).toEqual([]);
  });

  // ── walk --passive: a context draw read from the owner's right-click (sf-15 route) ──
  const ctxDraw: Draw = {
    id: "b-063",
    module: "WorldEditor",
    state: "mode=edit,selection=none",
    kind: "context-menu",
    open: { target: ["Hierarchy", "default"] },
    container_id: CTX,
  };
  const handDoc = (over: Partial<ContextDoc> = {}): ContextDoc => ({
    result: "ok",
    passive: true,
    openedBy: "hand",
    supported: null,
    popup: {
      className: "Qt683QWindowPopupDropShadowSaveBits",
      controlType: "Window",
      uiaClassName: "QMenu",
    },
    items: [
      { controlType: "MenuItem", name: "Show in Explorer", className: "QAction" },
      { controlType: "Separator", className: "QAction" },
      { controlType: "MenuItem", name: "Delete\tDel", className: "QAction" },
    ],
    collapsed: null,
    leftOpen: true,
    calls: [],
    ...over,
  });
  async function walkPassive(
    reader: ContextReader,
    runDir: string,
    extra: string[] = ["--passive"],
  ): Promise<{ code: number; files: Map<string, string>; logs: string[] }> {
    const planPath = join(TMP, `ctx-plan-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(
      planPath,
      JSON.stringify({
        schema: "emcp-blind-draws/1",
        seed: 1,
        n_requested: 1,
        n_drawn: 1,
        frame_size: 1,
        ledger_build: null,
        draws: [ctxDraw],
      }),
    );
    mkdirSync(runDir, { recursive: true });
    const files = new Map<string, string>();
    const logs: string[] = [];
    const deps = { ...fakeDeps(files), log: (l: string) => logs.push(l) };
    const code = await main(
      [
        "walk",
        "--draws",
        planPath,
        ...extra,
        "--really",
        "--id",
        "lane",
        "--module",
        "WorldEditor",
        "--state",
        ctxDraw.state,
        "--run-dir",
        runDir,
        "--sandbox",
        join(TMP, "EMCP2_sandbox"),
        "--only",
        ctxDraw.id,
      ],
      {
        log: (l) => logs.push(l),
        out: (l) => logs.push(l),
        platform: "win32",
        leaseHeld: true,
        artifactsRoot: join(TMP, "art"),
        deps,
        evidenceDir: null,
        policy,
        kernels: { context: reader, policy },
      },
    );
    return { code, files, logs };
  }

  it("walk --passive: a context draw is read from the owner's right-click; nothing is sent; same document file", async () => {
    const runDir = join(TMP, "art", "ctx-passive");
    const asked: Array<Parameters<ContextReader>[0]> = [];
    const reader: ContextReader = async (r) => {
      asked.push(r);
      const text = JSON.stringify(handDoc());
      writeFileSync(r.out, text);
      return { doc: handDoc(), sha256: "a".repeat(64), stderr: "" };
    };
    const { code, files, logs } = await walkPassive(reader, runDir);
    expect(code).toBe(EXIT.done);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      passive: true,
      path: ["Hierarchy", "default"],
      timeoutMs: PASSIVE_TIMEOUT_MS,
      out: join(runDir, "b-063-context.json"),
    });
    expect(logs.some((l) => /OWNER: right-click "Hierarchy > default" now/.test(l))).toBe(true);
    expect(logs.some((l) => /OWNER: press Esc once now/.test(l))).toBe(true);
    const rec = JSON.parse(files.get(join(runDir, "b-063.json"))!) as {
      status: string;
      summary: string;
      calls: Array<{ call?: string }>;
    };
    expect(rec.status).toBe("pass");
    expect(rec.summary).toMatch(/opened_by hand: 2 named item/);
    expect(rec.calls.map((c) => c.call)).not.toContain("ShowContextMenu");
    expect([...files.keys()].some((k) => k.endsWith(".obs.jsonl"))).toBe(false);
    // check reads the passive document like an active one
    const doc = JSON.parse(readFileSync(join(runDir, "b-063-context.json"), "utf-8")) as ReadDoc;
    expect(liveItems(ctxDraw, doc).labels).toEqual(["Show in Explorer", "Delete"]);
  });

  it("walk --passive: no popup in time stops the draw (nothing sent); without --passive the draw still plans ShowContextMenu", async () => {
    const reader: ContextReader = async (r) => {
      const d = handDoc({
        result: "no-popup",
        popup: null,
        items: [],
        leftOpen: false,
        reason: "no popup window of the pid appeared within 20000 ms (nothing was sent)",
      });
      writeFileSync(r.out, JSON.stringify(d));
      return { doc: d, sha256: null, stderr: "" };
    };
    const { code, logs } = await walkPassive(reader, join(TMP, "art", "ctx-none"));
    expect(code).toBe(EXIT.stopped);
    expect(logs.join("\n")).toMatch(/nothing was sent/);
    const sel = {
      module: "WorldEditor",
      state: { mode: "edit", selection: "none" },
      allowOwned: false,
    } as const;
    const passive = blindDef([ctxDraw], { policy, passiveContext: true }).steps(sel);
    const active = blindDef([ctxDraw], { policy }).steps(sel);
    expect(passive.map((s) => s.id)).toEqual(active.map((s) => s.id));
    expect(passive[0].plan(sel).map((a) => a.kind)).toEqual(["uia-read"]);
    expect(JSON.stringify(passive[0].plan(sel))).not.toMatch(/ShowContextMenu|Collapse/);
    expect(active[0].plan(sel).map((a) => a.kind)).toContain("uia-context");
  });
});
