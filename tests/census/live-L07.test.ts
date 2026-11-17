import { afterAll, describe, expect, it } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import type { PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  EXIT,
  buildWalkerQueue,
  deriveId,
  runWalker,
  runWalkerSteps,
  stateFor,
  validateLine,
  walkerPlan,
  type LiveObservation,
  type WalkerDeps,
  type WalkerOptions,
} from "../../scripts/census/live/common.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  DPI_WINDOWS_SCRIPT,
  MODULE_WINDOWS,
  RECT_CAPTURE_SCRIPT,
  STEP_ID,
  buildSteps,
  def,
  findModuleWindow,
  findRegions,
  makeDef,
  occluders,
  plannedRoles,
  regionRect,
  roleOf,
  spacesAgree,
  uiaRect,
  visibleWindowRect,
  walkChildArgv,
  type L07Kernel,
  type Rect,
  type UiaNode,
} from "../../scripts/census/live/L07-screens.js";

const FIX = join(__dirname, "fixtures", "live");
const slice = JSON.parse(readFileSync(join(FIX, "L07-we-walk-slice.json"), "utf-8")) as {
  tree: UiaNode;
};
const anim = JSON.parse(readFileSync(join(FIX, "L07-synthetic-anim.json"), "utf-8")) as {
  tree: UiaNode;
};
const baseWindows = (
  JSON.parse(readFileSync(join(FIX, "L07-we-windows.json"), "utf-8")) as { windows: WindowInfo[] }
).windows;

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l07-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const STATE = { mode: "edit" as const, selection: "none" as const };
const PID = 4242;

// ── A fake kernel and real-file deps ─────────────────────────────────────────

interface Fake extends L07Kernel {
  log: string[];
  captured: Rect[];
}

function fakeKernel(
  over: {
    windows?: () => WindowInfo[];
    tree?: UiaNode;
    captureOk?: (rect: Rect) => boolean;
    afterWalk?: () => void;
    markerGuard?: () => void;
  } = {},
): Fake {
  const k: Fake = {
    log: [],
    captured: [],
    windows: async () => {
      over.markerGuard?.();
      k.log.push("windows");
      return (over.windows ?? (() => baseWindows))();
    },
    walk: async (a) => {
      over.markerGuard?.();
      k.log.push("walk");
      mkdirSync(dirname(a.outPath), { recursive: true });
      const text = JSON.stringify({ tree: over.tree ?? slice.tree });
      writeFileSync(a.outPath, text, { flag: "wx" });
      over.afterWalk?.();
      return {
        path: a.outPath,
        sha256: createHash("sha256").update(text).digest("hex"),
        tree: over.tree ?? slice.tree,
      };
    },
    captureRect: async ({ rect, outPath }) => {
      k.log.push(`capture ${outPath.split(/[\\/]/).pop()}`);
      k.captured.push(rect);
      if (over.captureOk && !over.captureOk(rect)) return { ok: false, detail: "fake failure" };
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, `PNG:${rect.join(",")}:${outPath}`);
      return { ok: true, detail: "ok" };
    },
    exists: existsSync,
    sha256: (p) => createHash("sha256").update(readFileSync(p)).digest("hex"),
  };
  return k;
}

function realDeps(windows: () => WindowInfo[] = () => baseWindows): WalkerDeps {
  return {
    windows: async () => windows(),
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => PID,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: existsSync,
    writeFile: (p, t, exclusive) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t, { flag: exclusive ? "wx" : "w" });
    },
    appendFile: (p, t) => {
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, t);
    },
    log: () => undefined,
  };
}

const fresh = (name: string): string => mkdtempSync(join(TMP, `${name}-`));

function optsFor(runDir: string, module = "WorldEditor"): WalkerOptions {
  return {
    enumerator: "L07",
    script: def.script,
    session: "P4-2",
    runDir,
    module,
    state: STATE,
    allowOwned: false,
    evidenceDir: null,
    ph: { v2: REPO_ROOT },
    build: "test",
  };
}

const readLines = (file: string): LiveObservation[] =>
  readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LiveObservation);

const obsFile = (runDir: string): string => join(runDir, "L07-WorldEditor-edit-none.obs.jsonl");

// ── The plan ────────────────────────────────────────────────────────────────

describe("L07 plan", () => {
  const sel = { module: "WorldEditor", state: STATE, allowOwned: false };
  const steps = def.steps(sel);
  const plan = walkerPlan(steps, sel);

  it("is one read-only step: one uia-read and screenshots, checked clean", () => {
    expect(steps.map((s) => s.id)).toEqual([STEP_ID]);
    expect(steps[0].risk).toBe("read-only");
    expect(steps[0].side_effects).toEqual([]);
    expect(plan[0].kind).toBe("uia-read");
    expect(new Set(plan.slice(1).map((a) => a.kind))).toEqual(new Set(["screenshot"]));
    const check = checkPlan(plan, loadPolicy(), { script: def.script });
    expect(check.ok).toBe(true);
  });

  it("holds no forbidden action: no key, no invoke, no menu, no Enter, no typing, no answer", () => {
    for (const a of plan as PlanAction[]) {
      expect(["uia-read", "screenshot"]).toContain(a.kind);
      for (const f of ["keys", "key", "dialog", "role", "params", "calls", "exception"])
        expect((a as Record<string, unknown>)[f]).toBeUndefined();
    }
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(
      /"(invoke|key|uia-menu|uia-context|uia-dialog-cancel|execute-action|net-call)"/,
    );
    expect(text).not.toMatch(/Enter|Save World|Create World|Publish|Login|Pack Project/);
    const uia = plan[0] as unknown as { readOnly: boolean; target: { pid: string } };
    expect(uia.readOnly).toBe(true);
    expect(uia.target.pid).toBe("lane-recorded");
  });

  it("the capture scripts send nothing to Workbench", () => {
    for (const s of [RECT_CAPTURE_SCRIPT, DPI_WINDOWS_SCRIPT])
      expect(s).not.toMatch(
        /SendKeys|SendMessage|PostMessage|mouse_event|keybd_event|SetForegroundWindow|ShowWindow|PrintWindow|SetCursorPos|Invoke-/,
      );
    expect(RECT_CAPTURE_SCRIPT).toMatch(/CopyFromScreen/);
    expect(RECT_CAPTURE_SCRIPT).toMatch(/SetProcessDPIAware/);
  });

  it("ParticleEditor is never read (DEC-042): no step, no plan; nor are modules without a window", () => {
    expect(MODULE_WINDOWS.ParticleEditor).toBeUndefined();
    for (const m of ["ParticleEditor", "Launcher", "DialogueEditor", "Shared"])
      expect(def.steps({ module: m, state: STATE, allowOwned: false })).toEqual([]);
    // P4-9: a sub-editor is shot in the RM window with its tab active ([unverified] title)
    expect(
      def.steps({ module: "ResourceManager.Config", state: STATE, allowOwned: false }),
    ).toHaveLength(1);
  });

  it("plans the roles the module is known to show first", () => {
    expect(plannedRoles("WorldEditor").slice(0, 2)).toEqual(["viewport", "terrain-minimap"]);
    expect(plannedRoles("WorldEditor")).toEqual(
      expect.arrayContaining(["timeline", "curve-editor", "node-graph"]),
    );
  });

  it("emits a queue the pre-flight accepts", () => {
    const q = buildWalkerQueue(def, steps);
    expect(q.session).toBe("P4-2");
    expect(validateQueue(q, false)).toHaveLength(1);
  });

  it("the CLI prints the outline and a clean PASS, and writes the plan", async () => {
    const out = fresh("cli");
    const said: string[] = [];
    const code = await runWalker(
      def,
      ["--out", join(out, "plan.json"), "--outline", join(out, "outline.txt")],
      { out: (l) => said.push(l) },
    );
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain("PASS");
    expect(readFileSync(join(out, "outline.txt"), "utf-8")).toContain(STEP_ID);
    expect(JSON.parse(readFileSync(join(out, "plan.json"), "utf-8"))).toEqual(
      JSON.parse(JSON.stringify(plan)),
    );
  });
});

// ── Region finding and geometry ─────────────────────────────────────────────

describe("regions and geometry", () => {
  it("finds the World Editor viewport and terrain minimap from the P3-3 walk slice", () => {
    const { hits, skipped } = findRegions(slice.tree);
    expect(skipped).toEqual([]);
    expect(hits.map((h) => [h.role, h.node.className, h.path, h.observed, h.dock?.path])).toEqual([
      ["terrain-minimap", "TerrainMinimapViewport", "0/3/0/0", true, "0/3"],
      ["viewport", "WorldRenderWindowQt", "0/5/0/0/0", true, undefined],
    ]);
    expect(uiaRect(hits[1].node)).toEqual([665, 244, 1864, 902]);
    expect(uiaRect(hits[0].node)).toEqual([1873, 990, 2235, 1190]);
  });

  it("the floating Create dock (negative rect) and the tab strips are not regions", () => {
    const { hits } = findRegions(slice.tree);
    expect(hits.some((h) => h.path.startsWith("0/1") || h.path.startsWith("0/2"))).toBe(false);
  });

  it("the outermost match wins; an offscreen region is listed as skipped", () => {
    const { hits, skipped } = findRegions(anim.tree);
    expect(hits.map((h) => [h.role, h.node.className])).toEqual([
      ["node-graph", "NodeGraphView"],
      ["timeline", "TimelineWidget"],
    ]);
    expect(skipped).toEqual([
      { id: "curve-editor CurveEditorView.1", reason: "the walk marks it offscreen" },
    ]);
  });

  it("the minimap class is not taken for a viewport, the table order decides", () => {
    expect(roleOf("TerrainMinimapViewport")?.role).toBe("terrain-minimap");
    expect(roleOf("WorldRenderWindowQt")?.role).toBe("viewport");
    expect(roleOf("QToolButton")).toBeNull();
    expect(roleOf(undefined)).toBeNull();
  });

  it("regionRect keeps a region 90% inside the window, drops a hidden or tiny one", () => {
    const win: Rect = [311, 147, 2247, 1243];
    const { hits } = findRegions(slice.tree);
    const viewport = hits.find((h) => h.role === "viewport")!;
    expect(regionRect(viewport.node, win)).toEqual({ rect: [665, 244, 1864, 902] });
    expect(regionRect(viewport.node, [0, 0, 900, 900])).toMatchObject({
      reason: expect.any(String),
    });
    const tiny: UiaNode = { controlType: "Group", rect: [400, 400, 8, 8] };
    expect(regionRect(tiny, win)).toMatchObject({ reason: expect.stringContaining("16 px") });
  });

  it("visibleWindowRect clips to the monitor and refuses a minimised window", () => {
    const we = baseWindows[0];
    expect(visibleWindowRect(we)).toEqual([311, 147, 2247, 1243]);
    expect(visibleWindowRect({ ...we, rect: [-32000, -32000, -31840, -31960] })).toBeNull();
    expect(
      visibleWindowRect({ ...we, rect: [-8, 0, 2600, 1400], monitor: [0, 0, 2560, 1440] }),
    ).toEqual([0, 0, 2560, 1400]);
  });

  it("the walk and the window list agree within the resize frame, not under a DPI scale", () => {
    expect(spacesAgree([319, 155, 2239, 1235], [311, 147, 2247, 1243])).toBe(true);
    expect(spacesAgree([319, 155, 2239, 1235], [255, 124, 1791, 988])).toBe(false);
    // P4-1 2026-10-12: deltas 8/31/8/8, the frame and the title bar, not a DPI difference
    expect(spacesAgree([319, 155, 2239, 1235], [311, 124, 2247, 1243])).toBe(true);
    // hard caps: a top inset past the title bar, a side past the frame
    expect(spacesAgree([319, 200, 2239, 1235], [311, 124, 2247, 1243])).toBe(false);
    expect(spacesAgree([340, 155, 2239, 1235], [311, 124, 2247, 1243])).toBe(false);
    expect(spacesAgree([319, 155, 2239, 1235], [311, 124, 2247, 1280])).toBe(false);
  });

  it("occluders: only windows above the module window that overlap the rectangle", () => {
    const rect: Rect = [1873, 990, 2235, 1190];
    expect(occluders(baseWindows, 6884278, rect)).toEqual([]);
    const above: WindowInfo = {
      ...baseWindows[2],
      hwnd: 9,
      title: "<popup>",
      rect: [2000, 1000, 2100, 1100],
    };
    expect(occluders([above, ...baseWindows], 6884278, rect)).toEqual([
      'ApplicationFrameWindow "<popup>"',
    ]);
    expect(
      occluders([{ ...above, rect: [0, 0, 100, 100] }, ...baseWindows], 6884278, rect),
    ).toEqual([]);
    expect(
      occluders([{ ...above, className: "SysShadow" }, ...baseWindows], 6884278, rect),
    ).toEqual([]);
    expect(occluders(baseWindows, 1, rect)[0]).toMatch(/no longer/);
  });

  it("finds the module window of the pid by class, title and unowned+enabled", () => {
    const set = (over: Partial<WindowInfo>): WindowInfo[] => [
      { ...baseWindows[0], pid: PID, ...over },
    ];
    const pat = MODULE_WINDOWS.WorldEditor.titlePattern;
    expect(findModuleWindow(set({}), PID, pat)?.hwnd).toBe(6884278);
    expect(findModuleWindow(set({ owner: 5 }), PID, pat)).toBeNull();
    expect(findModuleWindow(set({ enabled: false }), PID, pat)).toBeNull();
    expect(findModuleWindow(set({ title: "Other" }), PID, pat)).toBeNull();
    expect(findModuleWindow(set({}), PID + 1, pat)).toBeNull();
  });

  it("stateFor writes only the axes the matrix declares for the kind (D8)", () => {
    expect(stateFor("WorldEditor", "region", { mode: "edit", selection: "none" })).toEqual({});
    expect(stateFor("WorldEditor", "window", { mode: "edit" })).toEqual({});
    expect(stateFor("WorldEditor", "panel", { mode: "edit", world_type: "with-terrain" })).toEqual({
      world_type: "with-terrain",
    });
    expect(stateFor("WorldEditor", "menu", { mode: "play", selection: "none" })).toEqual({
      mode: "play",
    });
  });

  it("the walk child argv is gated and bounded, and the lane is the step's (ctx.lane)", () => {
    const argv = walkChildArgv(
      {
        pid: PID,
        hwnd: 6884278,
        className: "Qt683QWindowIcon",
        titlePattern: "^World Editor",
        outPath: "<run>/w.json",
      },
      { id: "lane-1", leasePath: "<l>" },
    );
    expect(argv).toEqual(
      expect.arrayContaining([
        "--really",
        "--id",
        "lane-1",
        "--lease-path",
        "<l>",
        "--view",
        "raw",
        "--hwnd",
        "6884278",
      ]),
    );
    expect(argv).not.toContain("--run-dir");
    expect(argv).not.toContain("--allow-owned");
    expect(argv.join(" ")).toMatch(/--max-depth 16/);
  });
});

// ── The step on a fake tree and fake windows ────────────────────────────────

describe("the step", () => {
  it("runs in order, marks start first, writes files only under the run folder, emits conformant lines", async () => {
    const runDir = fresh("ok");
    const marker = join(runDir, `${STEP_ID}.started`);
    let markedBeforeFirstCall = false;
    const k = fakeKernel({
      markerGuard: () => {
        if (k.log.length === 0) markedBeforeFirstCall = existsSync(marker);
      },
    });
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r.exit).toBe(EXIT.done);
    expect(markedBeforeFirstCall).toBe(true);
    expect(k.log.map((l) => l.replace(/\.png$/, ""))).toEqual([
      "windows",
      "walk",
      "windows",
      "capture L07-WorldEditor-edit-none-window",
      "capture L07-WorldEditor-edit-none-region-terrain-minimap-1",
      "capture L07-WorldEditor-edit-none-region-viewport-1",
    ]);
    expect(r.records[0].calls.map((c) => c.call)).toEqual([
      "windows",
      "uia-read",
      "windows",
      "capture window",
      "capture region-terrain-minimap-1",
      "capture region-viewport-1",
    ]);
    expect(r.records[0].status).toBe("pass");
    expect(k.captured[0]).toEqual([311, 147, 2247, 1243]);
    expect(k.captured[1]).toEqual([1873, 990, 2235, 1190]);
    expect(k.captured[2]).toEqual([665, 244, 1864, 902]);

    // Every file is under the run folder; PNGs under L07-shots.
    const shots = readdirSync(join(runDir, "L07-shots"));
    expect(shots).toHaveLength(3);
    expect(r.records[0].artifacts.map((a) => a.path.replace(/\\/g, "/"))).toEqual(
      expect.arrayContaining([expect.stringContaining("L07-WorldEditor-edit-none-walk.json")]),
    );
    expect(r.records[0].artifacts).toHaveLength(4);

    // Lines.
    const lines = readLines(obsFile(runDir));
    expect(lines.map((l) => l.kind)).toEqual(["window", "dock", "region", "region"]);
    for (const l of lines) {
      expect(validateLine(l, "L07")).toEqual([]);
      expect(l.observed_state).toEqual({});
      expect(l.origin).toBe("vanilla");
    }
    const ids = lines.map((l) => deriveId(l));
    expect(ids).toEqual([
      "ui:WorldEditor/window/#worldEditorMain",
      "ui:WorldEditor/dock/#minimapDock",
      "ui:WorldEditor/region/@TerrainMinimapViewport.1",
      "ui:WorldEditor/region/@WorldRenderWindowQt.1",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    // Parents resolve inside the file; the minimap hangs on its dock, the viewport on the window.
    const known = new Set(ids);
    for (const l of lines.slice(1))
      expect(known.has(deriveId(l.parent_key as Parameters<typeof deriveId>[0]))).toBe(true);
    expect(lines[0].parent_key).toBeNull();
    expect(deriveId(lines[2].parent_key as never)).toBe("ui:WorldEditor/dock/#minimapDock");
    expect(deriveId(lines[3].parent_key as never)).toBe("ui:WorldEditor/window/#worldEditorMain");
    // Region refs are the sha256 of the PNG on disk; low confidence with the ordinal note.
    for (const l of lines.filter((x) => x.kind === "region")) {
      const m = /^artifact:([0-9a-f]{64})#region\/(.+)$/.exec(l.ref);
      expect(m).not.toBeNull();
      const file = readdirSync(join(runDir, "L07-shots"))
        .map((f) => join(runDir, "L07-shots", f))
        .find((f) => createHash("sha256").update(readFileSync(f)).digest("hex") === m![1]);
      expect(file).toBeDefined();
      expect(l.confidence).toBe("low");
      expect(l.unverified?.join(" ")).toMatch(/ordinal identity/);
      expect(l.unverified?.join(" ")).toMatch(/role (viewport|terrain-minimap)/);
    }
    // No forbidden fields, no canvas-gesture.
    for (const l of lines) {
      for (const f of [
        "id",
        "what",
        "sources",
        "children_enumerated",
        "tier",
        "disposition",
        "paths",
        "children_count",
      ])
        expect((l as unknown as Record<string, unknown>)[f]).toBeUndefined();
      expect(l.kind).not.toBe("canvas-gesture");
    }
  });

  it("the emitted obs file merges and re-checks through normalise.ts", async () => {
    const runDir = fresh("norm");
    const k = fakeKernel();
    await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    const data = fresh("data");
    writeFileSync(
      join(data, "universes.json"),
      readFileSync(join(REPO_ROOT, "data", "census", "universes.json")),
    );
    const err: string[] = [];
    const io = { out: () => undefined, err: (l: string) => err.push(l) };
    const base = ["--enumerator", "L07", "--build", "1.8.0.13", "--data", data];
    expect(runNormalise([...base, "--fresh", obsFile(runDir)], io)).toBe(0);
    expect(runNormalise([...base, "--check", "--fresh", obsFile(runDir)], io)).toBe(0);
    expect(err).toEqual([]);
    const merged = readLines(join(data, "observations", "L07", "1.8.0.13.jsonl")).filter(
      (l) => !("$header" in l),
    );
    expect(merged).toHaveLength(4);
  });

  it("a window covering the whole module window leaves nothing to capture: fail, no lines", async () => {
    const runDir = fresh("covered");
    const above: WindowInfo = {
      ...baseWindows[2],
      hwnd: 9,
      title: "<popup>",
      rect: [0, 0, 2560, 1440],
    };
    const k = fakeKernel({ windows: () => [above, ...baseWindows] });
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r.records[0].status).toBe("fail");
    expect(r.records[0].summary).toMatch(/nothing was captured/);
    expect(k.captured).toEqual([]);
    expect(existsSync(obsFile(runDir))).toBe(false);
  });

  it("a small window over the minimap: that region and the window shot are skipped and listed, the viewport is kept", async () => {
    const runDir = fresh("minimap-covered");
    const above: WindowInfo = {
      ...baseWindows[2],
      hwnd: 9,
      title: "<popup>",
      rect: [2000, 1000, 2100, 1100],
    };
    const k = fakeKernel({ windows: () => [above, ...baseWindows] });
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r.records[0].status).toBe("observed");
    expect(r.records[0].summary).toMatch(/window: covered by ApplicationFrameWindow "<popup>"/);
    expect(r.records[0].summary).toMatch(/terrain-minimap TerrainMinimapViewport\.1: covered by/);
    expect(r.records[0].summary).toMatch(/expected but absent: terrain-minimap/);
    expect(k.captured).toEqual([[665, 244, 1864, 902]]);
    const lines = readLines(obsFile(runDir));
    expect(lines.map((l) => l.kind)).toEqual(["window", "region"]);
    for (const l of lines) expect(validateLine(l, "L07")).toEqual([]);
    // The window line cites the walk, not a PNG, and says why.
    expect(lines[0].ref).toMatch(/^artifact:[0-9a-f]{64}#n\/0$/);
    expect(lines[0].unverified?.join(" ")).toMatch(/no window PNG/);
  });

  it("a failed capture is skipped and listed, the step is observed", async () => {
    const runDir = fresh("capfail");
    const k = fakeKernel({ captureOk: (rect) => rect[0] !== 1873 });
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r.records[0].status).toBe("observed");
    expect(r.records[0].summary).toMatch(
      /skipped 1: terrain-minimap TerrainMinimapViewport\.1: capture failed/,
    );
    expect(readLines(obsFile(runDir)).map((l) => l.kind)).toEqual(["window", "region"]);
  });

  it("fails without capturing when the walk and the window list disagree (DPI)", async () => {
    const runDir = fresh("dpi");
    const k = fakeKernel({
      windows: () => [
        { ...baseWindows[0], rect: [255, 124, 1791, 988], monitor: [0, 0, 2048, 1152] },
      ],
    });
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r.records[0].status).toBe("fail");
    expect(r.records[0].summary).toMatch(/DPI/);
    expect(k.captured).toEqual([]);
  });

  it("fails when the window moved during the walk", async () => {
    const runDir = fresh("moved");
    let n = 0;
    const k = fakeKernel({
      windows: () => [
        { ...baseWindows[0], rect: n++ === 0 ? baseWindows[0].rect : [312, 147, 2248, 1243] },
      ],
    });
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r.records[0].status).toBe("fail");
    expect(r.records[0].summary).toMatch(/moved/);
  });

  it("fails when no module window of the pid matches", async () => {
    const runDir = fresh("nowin");
    const k = fakeKernel({ windows: () => [{ ...baseWindows[0], pid: 1 }] });
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r.records[0].status).toBe("fail");
    expect(k.log).toEqual(["windows"]);
  });

  it("another module: Animation Editor regions from the synthetic tree, window as a path key", async () => {
    const runDir = fresh("anim");
    const win: WindowInfo = {
      ...baseWindows[0],
      title: "Animation Editor",
      rect: [92, 92, 1708, 1008],
    };
    const k = fakeKernel({ windows: () => [win], tree: anim.tree });
    const o = optsFor(runDir, "AnimEditor");
    const r = await runWalkerSteps(buildSteps(k, "AnimEditor"), realDeps(), o);
    // The offscreen curve editor is skipped, so the step is observed.
    expect(r.records[0].status).toBe("observed");
    const lines = readLines(join(runDir, "L07-AnimEditor-edit-none.obs.jsonl"));
    expect(lines.map((l) => deriveId(l))).toEqual([
      "ui:AnimEditor/window/#animEditorMain",
      "ui:AnimEditor/region/#graphHost",
      "ui:AnimEditor/region/#timeline",
    ]);
    for (const l of lines) expect(validateLine(l, "L07")).toEqual([]);
  });

  it("a stopped step is never retried: a stray window stops it, the rerun is refused", async () => {
    const runDir = fresh("stray");
    let calls = 0;
    const stray: WindowInfo = {
      ...baseWindows[0],
      hwnd: 77,
      className: "SomeNewClass",
      title: "Stray",
      pid: PID,
    };
    const deps = realDeps(() => (calls++ > 0 ? [...baseWindows, stray] : baseWindows));
    const k = fakeKernel();
    const first = await runWalkerSteps(buildSteps(k, "WorldEditor"), deps, optsFor(runDir));
    expect(first.exit).toBe(EXIT.stopped);
    const again = await runWalkerSteps(buildSteps(k, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(again.exit).toBe(EXIT.refused);
    expect(again.message).toMatch(/never run twice/);
  });

  it("a dialog-like window is a handoff", async () => {
    const runDir = fresh("dialog");
    let calls = 0;
    const dlg: WindowInfo = {
      ...baseWindows[0],
      hwnd: 78,
      title: "Options",
      owner: 6884278,
      pid: PID,
    };
    const deps = realDeps(() => (calls++ > 0 ? [...baseWindows, dlg] : baseWindows));
    const r = await runWalkerSteps(buildSteps(fakeKernel(), "WorldEditor"), deps, optsFor(runDir));
    expect(r.exit).toBe(EXIT.handoff);
  });

  it("refuses to write a screenshot inside a git tree, and never overwrites a file", async () => {
    const inside = join(REPO_ROOT, "tmp-l07-never-written");
    const files = new Map<string, string>();
    const deps: WalkerDeps = {
      ...realDeps(),
      exists: (p) => files.has(p),
      writeFile: (p, t) => void files.set(p, t),
      appendFile: (p, t) => void files.set(p, (files.get(p) ?? "") + t),
    };
    const k = fakeKernel();
    const r = await runWalkerSteps(buildSteps(k, "WorldEditor"), deps, optsFor(inside));
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/git working tree/);
    expect(k.log).toEqual([]);
    expect(existsSync(inside)).toBe(false);

    const runDir = fresh("exists");
    mkdirSync(join(runDir, "L07-shots"), { recursive: true });
    writeFileSync(join(runDir, "L07-shots", "L07-WorldEditor-edit-none-window.png"), "old");
    const k2 = fakeKernel();
    const r2 = await runWalkerSteps(buildSteps(k2, "WorldEditor"), realDeps(), optsFor(runDir));
    expect(r2.exit).toBe(EXIT.stopped);
    expect(r2.message).toMatch(/never overwritten/);
    expect(
      readFileSync(join(runDir, "L07-shots", "L07-WorldEditor-edit-none-window.png"), "utf-8"),
    ).toBe("old");
  });

  it("makeDef follows the CLI module and an unknown module has no step", () => {
    const d = makeDef(fakeKernel());
    expect(d.steps({ module: "WorldEditor", state: STATE, allowOwned: false })).toHaveLength(1);
    expect(d.steps({ module: "ParticleEditor", state: STATE, allowOwned: false })).toHaveLength(0);
  });
});

import { spawnSync as fixhSpawn } from "node:child_process";
import { powershellErrorText } from "../../scripts/census/live/L07-screens.js";
import { powershellArgs } from "../../scripts/live/powershell.js";

describe("P4-FIX-H: the capture script and its failure text", () => {
  const P42_STDERR =
    '#< CLIXML\r\n<Objs Version="1.1.0.1"><Obj S="progress" RefId="0"></Obj><S S="Error">Exception calling "Save" with "2" argument(s): "A generic error occurred in GDI+."_x000D__x000A_</S><S S="Error">At line:15 char:3_x000D__x000A_</S></Objs>';

  it("the failure detail is the decoded PowerShell error, never the encoded command", () => {
    const err = `Command failed: powershell.exe -NoProfile -NonInteractive -EncodedCommand ${powershellArgs(RECT_CAPTURE_SCRIPT)[3]}\n${P42_STDERR}`;
    const t = powershellErrorText(P42_STDERR, err);
    expect(t).toContain(
      'Exception calling "Save" with "2" argument(s): "A generic error occurred in GDI+."',
    );
    expect(t).toContain("At line:15 char:3");
    expect(t).not.toMatch(/EncodedCommand|_x000|<S /);
    expect(powershellErrorText("", err)).not.toMatch(/Command failed|EncodedCommand/);
    expect(powershellErrorText("plain error", null)).toBe("plain error");
  });

  it("the capture script round-trips through -EncodedCommand", () => {
    const enc = powershellArgs(RECT_CAPTURE_SCRIPT)[3];
    expect(Buffer.from(enc, "base64").toString("utf16le")).toBe(RECT_CAPTURE_SCRIPT);
  });

  it.runIf(process.platform === "win32")(
    "its Add-Type block compiles in Windows PowerShell",
    () => {
      const block = RECT_CAPTURE_SCRIPT.split("\n")
        .filter(
          (l) => !/^\$r |^\$w |^if |^\$bmp|^\$g |^try|^  \$|^\} finally|^Write-Output/.test(l),
        )
        .join("\n");
      expect(block).toMatch(/Add-Type -TypeDefinition/);
      const r = fixhSpawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          powershellArgs(`${block}\nWrite-Output 'compiled'`)[3],
        ],
        { encoding: "utf8", timeout: 60_000, windowsHide: true },
      );
      expect(r.stdout).toContain("compiled");
      expect(r.status).toBe(0);
    },
    90_000,
  );
});
