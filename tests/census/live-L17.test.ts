import { afterAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
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
  GATE_STEP,
  HANDOFF_STEP,
  QT_PATH,
  SCRIPT,
  WALK_STEP,
  buildL17Steps,
  def as realDef,
  findQtLabel,
  makeL17Def,
  policyListsQt,
  readsQtLabel,
  treeToLines,
  type L17Kernel,
  type WalkNode,
} from "../../scripts/census/live/L17-qt.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l17-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = join(__dirname, "fixtures", "live");
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(FIX, name), "utf-8")) as T;
const walkFix = fixture<{ tree: WalkNode }>("L17-walk-fake.json");
const PRESENT = fixture<{ lines: unknown[] }>("L17-l02-present.json").lines;
const ABSENT = fixture<{ lines: unknown[] }>("L17-l02-absent.json").lines;
const SHA = "a".repeat(64);

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

interface Fake {
  kernel: L17Kernel;
  calls: string[];
  /** Files the fake "disk" holds (the run folder's step records are read back from it). */
  files: Map<string, string>;
}

function fakeKernel(
  over: {
    lines?: unknown[];
    listed?: boolean;
    executed?: boolean;
    walkOk?: boolean;
    files?: Map<string, string>;
  } = {},
): Fake {
  const calls: string[] = [];
  const files = over.files ?? new Map<string, string>();
  const lines = over.lines ?? PRESENT;
  const kernel: L17Kernel = {
    findLabel: (runDir) => {
      calls.push("findLabel");
      return findQtLabel(runDir, {
        listDir: (d) => (d === runDir ? ["L02-ResourceManager-nostate.obs.jsonl"] : []),
        isDir: () => false,
        read: () => lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      });
    },
    policyLists: () => over.listed ?? true,
    openTool: async () => {
      calls.push("open");
      return over.executed === false
        ? { executed: false, detail: "ExecuteAction result false" }
        : { executed: true, detail: "ok" };
    },
    walk: async () => {
      calls.push("walk");
      return over.walkOk === false
        ? {
            ok: false,
            tree: null,
            sha256: null,
            windowClass: "Qt683QWindowIcon",
            completed: null,
            nodes: null,
            detail: "no window matched",
          }
        : {
            ok: true,
            tree: structuredClone(walkFix.tree),
            sha256: SHA,
            windowClass: "Qt683QWindowIcon",
            completed: true,
            nodes: 23,
            detail: "walk.ts exit 0",
          };
    },
    readText: (p) => files.get(p) ?? null,
  };
  return { kernel, calls, files };
}

function fakeDeps(
  files: Map<string, string>,
  windows: () => WindowInfo[] = () => [],
): WalkerDeps & { lines: string[] } {
  const d = {
    lines: [] as string[],
    windows: async () => windows(),
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => 4242,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: (p: string) => files.has(p),
    writeFile: (p: string, t: string, exclusive?: boolean) => {
      if (exclusive && files.has(p)) throw new Error("exists");
      files.set(p, t);
    },
    appendFile: (p: string, t: string) => files.set(p, (files.get(p) ?? "") + t),
    log: (l: string) => d.lines.push(l),
  };
  return d;
}

const RUN = join(TMP, "sessions", "P4-8", "d1", "run1");
const baseOpts = (runDir = RUN) => ({
  enumerator: "L17",
  script: SCRIPT,
  session: "P4-8",
  runDir,
  module: "ResourceManager",
  state: { mode: "edit" as const, selection: "none" as const },
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});
const sel = { module: "ResourceManager", state: {}, allowOwned: false };

/** Run all three steps on a fake kernel; the step records feed the handoff step through the disk. */
async function runAll(f: Fake, windows?: () => WindowInfo[]) {
  const deps = fakeDeps(f.files, windows);
  // the handoff step reads the open-walk record back through the kernel's disk
  const orig = f.kernel.readText;
  f.kernel.readText = (p) => f.files.get(p) ?? orig(p);
  const r = await runWalkerSteps(buildL17Steps(f.kernel, "ResourceManager"), deps, baseOpts());
  const obsKey = [...f.files.keys()].find((k) => k.endsWith(".obs.jsonl"));
  return { r, obs: obsKey ? f.files.get(obsKey)! : null, obsKey };
}

describe("the L02 gate", () => {
  it("reads only the exact label, kind and path", () => {
    expect(PRESENT.some(readsQtLabel)).toBe(true);
    expect(ABSENT.some(readsQtLabel)).toBe(false);
    const item = PRESENT[PRESENT.length - 1] as Record<string, unknown>;
    expect(readsQtLabel({ ...item, label_raw: "&Qt Introspection Tool" })).toBe(false);
    expect(readsQtLabel({ ...item, module: "WorldEditor" })).toBe(false);
    expect(readsQtLabel({ ...item, kind: "menu" })).toBe(false);
    expect(
      readsQtLabel({ ...item, key: { path: ["Tools", "Qt Introspection Tool"] }, locator: {} }),
    ).toBe(false);
    expect(readsQtLabel(null)).toBe(false);
  });
  it("searches the run folder and its sibling run folders for L02 ResourceManager files only", () => {
    const sitting = join(TMP, "sit");
    for (const [dir, file, lines] of [
      ["run-a", "L02-ResourceManager-nostate.obs.jsonl", ABSENT],
      ["run-b", "L02-ResourceManager-nostate.obs.jsonl", PRESENT],
      ["run-c", "L02-WorldEditor-edit-none.obs.jsonl", PRESENT],
    ] as const) {
      mkdirSync(join(sitting, dir), { recursive: true });
      writeFileSync(
        join(sitting, dir, file),
        lines.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n",
      );
    }
    const io = {
      listDir: (d: string) => (existsSync(d) ? readdirSync(d) : []),
      isDir: (p: string) => statSync(p).isDirectory(),
      read: (p: string) => readFileSync(p, "utf-8"),
    };
    const fromA = findQtLabel(join(sitting, "run-a"), io);
    expect(fromA).toMatchObject({ present: true, filesRead: 2 });
    expect(fromA.source).toBe("run-b/L02-ResourceManager-nostate.obs.jsonl");
    expect(fromA.ref).toContain("#m/Utilities/Qt Introspection Tool");
    // a sitting that holds only the WorldEditor file and the absent one reads nothing
    const lone = join(TMP, "sit2");
    mkdirSync(join(lone, "run-x"), { recursive: true });
    writeFileSync(
      join(lone, "run-x", "L02-ResourceManager-nostate.obs.jsonl"),
      ABSENT.map((l) => JSON.stringify(l)).join("\n"),
    );
    expect(findQtLabel(join(lone, "run-x"), io)).toMatchObject({ present: false, filesRead: 1 });
    expect(findQtLabel(join(lone, "missing"), io)).toMatchObject({ present: false, filesRead: 1 });
  });
  it("the policy must list the path segment for segment", () => {
    expect(policyListsQt(loadPolicy())).toBe(true);
    expect(
      policyListsQt({ execute_action: { allow_list: [["utilities", "qt introspection tool"]] } }),
    ).toBe(false);
    expect(policyListsQt({})).toBe(false);
  });
});

describe("the plan", () => {
  const plan = walkerPlan(buildL17Steps(fakeKernel().kernel, "ResourceManager"), sel);
  it("is one allow-listed open and one passive read: no key, no invoke, no typing, no list 1 opener", () => {
    expect(plan.map((a) => a.kind)).toEqual(["execute-action", "uia-read"]);
    expect(
      plan.some((a) =>
        ["key", "invoke", "menu-open", "uia-menu", "uia-dialog-cancel"].includes(a.kind),
      ),
    ).toBe(false);
    const open = plan[0].target as { path: string[]; module: string };
    expect(open.path).toEqual([...QT_PATH]);
    expect(open.module).toBe("ResourceManager");
    expect((plan[0] as Record<string, unknown>).opensDialog).toBeUndefined();
    const text = JSON.stringify(plan);
    for (const never of [
      "Create World",
      "Create Terrain",
      "Save World As",
      "Pack Project",
      "Publish",
      "Login",
      "Particle",
    ])
      expect(text).not.toContain(never);
    const read = plan[1] as Record<string, unknown>;
    expect(read.readOnly).toBe(true);
    expect((read.target as { pid: unknown }).pid).toBe("lane-recorded");
  });
  it("passes checkPlan with no violation and no exception", () => {
    const r = checkPlan(plan as PlanAction[], loadPolicy(), { script: SCRIPT });
    expect(r.violations ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("is empty when the policy does not list the path or the module is not the Resource Manager", () => {
    expect(
      walkerPlan(buildL17Steps(fakeKernel({ listed: false }).kernel, "ResourceManager"), sel),
    ).toEqual([]);
    expect(walkerPlan(buildL17Steps(fakeKernel().kernel, "WorldEditor"), sel)).toEqual([]);
  });
  it("queue steps run read-only, reversible, reversible and validate", () => {
    const d = makeL17Def(() => fakeKernel().kernel);
    const steps = d.steps(sel);
    expect(steps.map((s) => s.id)).toEqual([GATE_STEP, WALK_STEP, HANDOFF_STEP]);
    expect(steps.map((s) => s.risk)).toEqual(["read-only", "reversible", "reversible"]);
    const out = join(TMP, "queue.json");
    return runWalker(d, ["--emit-queue", out, "--out", join(TMP, "p.json")], {
      out: () => undefined,
    }).then((code) => {
      expect(code).toBe(EXIT.done);
      expect(validateQueue(JSON.parse(readFileSync(out, "utf-8")), false)).toHaveLength(3);
    });
  });
  it("the real definition prints its outline and passes the policy check (CLI without --really)", async () => {
    const said: string[] = [];
    const out = join(TMP, "real-plan.json");
    const code = await runWalker(
      realDef,
      ["--out", out, "--outline", join(TMP, "real-outline.txt")],
      {
        out: (l) => said.push(l),
      },
    );
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain("PASS");
    expect(said.join("\n")).toContain(WALK_STEP);
    expect(JSON.parse(readFileSync(out, "utf-8"))).toHaveLength(2);
  });
});

describe("tree to lines", () => {
  const conv = treeToLines({
    tree: walkFix.tree,
    sha256: SHA,
    module: "ResourceManager",
    windowClass: "Qt683QWindowIcon",
  });
  it("every line is conformant, in L17's registered kinds, with a unique id and a ref into the walk", () => {
    expect(conv.lines.length).toBeGreaterThan(5);
    const ids = new Set<string>();
    for (const l of conv.lines) {
      expect(validateLine(l, "L17")).toEqual([]);
      expect(["window", "panel", "control", "dock", "region"]).toContain(l.kind);
      expect(l.ref).toMatch(new RegExp(`^artifact:${SHA}#n/0(/\\d+)*$`));
      expect(l.observed_state).toEqual({});
      ids.add(deriveId(l));
    }
    expect(ids.size).toBe(conv.lines.length);
    expect(conv.lines[0]).toMatchObject({
      kind: "window",
      parent_key: null,
      ref: `artifact:${SHA}#n/0`,
    });
  });
  it("gives data rows, menus and chrome no line and says so", () => {
    expect(conv.skipped["data row of the tool's lists (the inspected app's widgets)"]).toBe(6);
    expect(Object.keys(conv.skipped).some((r) => r.includes("not registered for L17"))).toBe(true);
    expect(conv.lines.some((l) => l.locator?.controlType === "TreeItem")).toBe(false);
    expect(conv.lines.some((l) => l.locator?.controlType === "TitleBar")).toBe(false);
    expect(conv.lines[0].unverified?.join(" ")).toContain("no row for");
  });
  it("children_count only where every child node became a line and the read was whole", () => {
    const byType = (t: string) => conv.lines.filter((l) => l.locator?.controlType === t);
    expect(conv.lines[0].children_count).toBeUndefined();
    for (const l of byType("Button")) expect(l.children_count).toBe(0);
    for (const l of byType("List").concat(byType("Tree"))) expect(l.children_count).toBeUndefined();
  });
  it("a duplicate name takes an ordinal identity; a labelled Edit takes the Text beside it", () => {
    const tree: WalkNode = {
      controlType: "Window",
      name: "Qt Introspection Tool",
      className: "Qt",
      childCount: 4,
      children: [
        {
          controlType: "Button",
          name: "Refresh",
          className: "QPushButton",
          childCount: 0,
          children: [],
        },
        {
          controlType: "Button",
          name: "Refresh",
          className: "QPushButton",
          childCount: 0,
          children: [],
        },
        { controlType: "Text", name: "Filter", className: "QLabel", childCount: 0, children: [] },
        { controlType: "Edit", name: "", className: "QLineEdit", childCount: 0, children: [] },
      ],
    };
    const c = treeToLines({
      tree,
      sha256: SHA,
      module: "ResourceManager",
      windowClass: "Qt683QWindowIcon",
    });
    const paths = c.lines.map((l) => ("path" in l.key ? l.key.path.join("/") : l.key.object_name));
    expect(paths).toEqual([
      "Qt Introspection Tool",
      "Qt Introspection Tool/Refresh",
      "Qt Introspection Tool/@QPushButton.1",
      "Qt Introspection Tool/Filter",
    ]);
    expect(c.lines[2].confidence).toBe("low");
    expect(c.lines[2].unverified?.[0]).toContain("ordinal");
    expect(c.lines[3].label_raw).toBe("Filter");
    expect(c.lines.every((l) => validateLine(l, "L17").length === 0)).toBe(true);
  });
  it("refuses a root that is not a Window", () => {
    expect(() =>
      treeToLines({
        tree: { controlType: "Pane", children: [] },
        sha256: SHA,
        module: "ResourceManager",
        windowClass: "x",
      }),
    ).toThrow(/not a Window/);
  });
});

describe("the steps on a fake kernel", () => {
  it("present: gate, open, then the read, in that order; lines pass validateLine and the normaliser; the block ends in a handoff", async () => {
    const f = fakeKernel();
    let opened = false;
    const origOpen = f.kernel.openTool;
    f.kernel.openTool = async () => {
      opened = true;
      return origOpen();
    };
    const { r, obs, obsKey } = await runAll(f, () =>
      opened ? [win("Qt Introspection Tool", 9, "Qt683QWindowIcon", 0)] : [],
    );
    // the handoff step is refused only by the window rule or by its own throw: exit 5 either way
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records.map((x) => x.step)).toEqual([GATE_STEP, WALK_STEP, HANDOFF_STEP]);
    expect(f.calls.filter((c) => c !== "findLabel")).toEqual(["open", "walk"]);
    expect(r.records[0].summary).toMatch(/^present:/);
    expect(r.records[1]).toMatchObject({ status: "pass" });
    expect(r.records[1].summary).toMatch(/^opened:/);
    expect(r.records[1].calls.map((c) => c.call)).toEqual(["wb_module action", "uia-read"]);
    expect(r.records[1].windowsAdded).toEqual([
      { className: "Qt683QWindowIcon", title: "Qt Introspection Tool", owner: 0 },
    ]);
    expect(r.records[2].status).toBe("handoff");
    expect(r.message).toContain("closes it by hand");
    // started markers before the records, one each
    for (const id of [GATE_STEP, WALK_STEP, HANDOFF_STEP])
      expect([...f.files.keys()].some((k) => k.endsWith(`${id}.started`))).toBe(true);
    // obs lines
    expect(obsKey).toContain("L17-ResourceManager-");
    const lines = obs!
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as LiveObservation);
    expect(lines.length).toBe(
      treeToLines({
        tree: walkFix.tree,
        sha256: SHA,
        module: "ResourceManager",
        windowClass: "Qt683QWindowIcon",
      }).lines.length,
    );
    for (const l of lines) expect(validateLine(l, "L17")).toEqual([]);
    // the normaliser accepts them and --check is current after the write
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "current-build.json"), JSON.stringify({ tag: "1.8.0.13" }));
    writeFileSync(
      join(data, "universes.json"),
      JSON.stringify({ enumerators: { L17: { generator: SCRIPT } } }),
    );
    const raw = join(TMP, "raw");
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(raw, "L17-ResourceManager-edit-none.obs.jsonl"), obs!);
    const io = { out: () => undefined, err: () => undefined };
    expect(runNormalise(["--enumerator", "L17", "--data", data, raw], io)).toBe(0);
    expect(runNormalise(["--enumerator", "L17", "--data", data, "--check", raw], io)).toBe(0);
  });

  it("absent: the block records it and ends with exit 0; nothing is opened, read or written", async () => {
    const f = fakeKernel({ lines: ABSENT });
    const { r, obs } = await runAll(f);
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => x.status)).toEqual(["observed", "observed", "observed"]);
    expect(r.records[0].summary).toMatch(
      /^absent: no L02 line reads the exact label "Qt Introspection Tool"/,
    );
    expect(f.calls).not.toContain("open");
    expect(f.calls).not.toContain("walk");
    expect(obs).toBeNull();
    expect(r.records[2].summary).toContain("no handoff");
  });

  it("not on the policy allow list: absent with that reason, exit 0, nothing sent", async () => {
    const f = fakeKernel({ listed: false });
    const { r } = await runAll(f);
    expect(r.exit).toBe(EXIT.done);
    expect(r.records[0].summary).toContain("not on policy execute_action.allow_list");
    expect(f.calls).toEqual([]);
  });

  it("the handler answering false: no read, no retry, the step fails, no handoff", async () => {
    const f = fakeKernel({ executed: false });
    const { r } = await runAll(f);
    expect(r.exit).toBe(EXIT.done);
    expect(r.records[1].status).toBe("fail");
    expect(f.calls.filter((c) => c === "open")).toHaveLength(1);
    expect(f.calls).not.toContain("walk");
    expect(r.records[2].summary).toContain("no handoff");
  });

  it("a failed read leaves the window up and still ends in the owner's close", async () => {
    const f = fakeKernel({ walkOk: false });
    const { r } = await runAll(f);
    expect(r.records[1].status).toBe("fail");
    expect(r.records[1].summary).toMatch(/^opened:/);
    expect(r.exit).toBe(EXIT.handoff);
  });

  it("any other new window stops the open step before the read", async () => {
    const f = fakeKernel();
    let n = 0;
    const deps = fakeDeps(f.files, () => (n++ > 0 ? [win("Stray Tool", 9)] : []));
    const steps = buildL17Steps(f.kernel, "ResourceManager").slice(1, 2);
    // give the poller a window to run in: the open sleeps through ctx.sleep
    const r = await runWalkerSteps(steps, deps, baseOpts(join(TMP, "stray")));
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0].windowsAdded[0]).toMatchObject({ title: "Stray Tool" });
  });

  it("an owned window of another title is a handoff; the tool's own title is expected", async () => {
    const f = fakeKernel();
    let n = 0;
    const other = await runWalkerSteps(
      buildL17Steps(f.kernel, "ResourceManager").slice(1, 2),
      fakeDeps(f.files, () => (n++ > 0 ? [win("Options", 9, "Qt683QWindowIcon", 3)] : [])),
      baseOpts(join(TMP, "owned1")),
    );
    expect(other.exit).toBe(EXIT.handoff);
    const f2 = fakeKernel();
    n = 0;
    const own = await runWalkerSteps(
      buildL17Steps(f2.kernel, "ResourceManager").slice(1, 2),
      fakeDeps(f2.files, () =>
        n++ > 0 ? [win("Qt Introspection Tool", 9, "Qt683QWindowIcon", 3)] : [],
      ),
      baseOpts(join(TMP, "owned2")),
    );
    expect(own.exit).toBe(EXIT.done);
  });

  it("a step is never run twice in a run folder", async () => {
    const f = fakeKernel({ lines: ABSENT });
    const steps = buildL17Steps(f.kernel, "ResourceManager");
    const deps = fakeDeps(f.files);
    expect((await runWalkerSteps(steps.slice(0, 1), deps, baseOpts(join(TMP, "twice")))).exit).toBe(
      EXIT.done,
    );
    expect((await runWalkerSteps(steps.slice(0, 1), deps, baseOpts(join(TMP, "twice")))).exit).toBe(
      EXIT.refused,
    );
  });

  it("a real run through runWalker (fake deps, fake kernel) writes its records into the run folder", async () => {
    const files = new Map<string, string>();
    const f = fakeKernel({ lines: ABSENT, files });
    const runDir = join(TMP, "art", "run9");
    const code = await runWalker(
      makeL17Def(() => f.kernel),
      [
        "--really",
        "--id",
        "lane",
        "--module",
        "ResourceManager",
        "--from",
        GATE_STEP,
        "--run-dir",
        runDir,
        "--sandbox",
        join(TMP, "EMCP2_sandbox"),
      ],
      {
        out: () => undefined,
        platform: "win32",
        leaseHeld: true,
        artifactsRoot: join(TMP, "art"),
        deps: fakeDeps(files),
        evidenceDir: null,
      },
    );
    expect(code).toBe(EXIT.done);
    expect([...files.keys()].filter((k) => k.endsWith(".json")).length).toBe(3);
  });
});
