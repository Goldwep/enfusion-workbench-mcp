import { afterAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";
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
import { run as normalise } from "../../scripts/census/live/normalise.js";
import {
  SCRIPT,
  activatable,
  chromeLines,
  currentTool,
  l03Def,
  windowToggles,
  type L03Kernel,
  type MenuDoc,
  type WalkDoc,
  type WalkNode,
} from "../../scripts/census/live/L03-chrome.js";

const FIX = join(REPO_ROOT, "tests", "census", "fixtures", "live");
const WALK_TEXT = readFileSync(join(FIX, "L03-we-walk.json"), "utf-8");
const WALK = JSON.parse(WALK_TEXT) as WalkDoc;
const MENU = JSON.parse(readFileSync(join(FIX, "L03-window-menu.json"), "utf-8")) as MenuDoc;
const TMP = mkdtempSync(join(tmpdir(), "l03-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const SHA = "a".repeat(64);
const STATE = { mode: "edit" as const, selection: "none" as const };
const ids = (ls: LiveObservation[]) => ls.map((l) => deriveId(l));
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** A walk with the current-tool dock showing another tool. */
function withTool(tool: string, panelClass: string): WalkDoc {
  const d = JSON.parse(WALK_TEXT) as WalkDoc;
  const dock = d.tree.children!.find((c) => (c.automationId ?? "").endsWith("currentToolDock"))!;
  dock.name = tool;
  const find = (n: WalkNode): WalkNode | null =>
    /ToolPanel$/.test(n.className ?? "") ? n : ((n.children ?? []).map(find).find(Boolean) ?? null);
  find(dock)!.className = panelClass;
  return d;
}

describe("chromeLines on the P3-3 World Editor slice", () => {
  const r = chromeLines(WALK.tree, {
    module: "WorldEditor",
    state: STATE,
    ref: (p) => `artifact:${SHA}#n/${p}`,
  });
  it("every line is conformant for L03", () => {
    for (const l of r.lines) expect(validateLine(l, "L03")).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });
  it("keys: object names first, label paths, ordinals for unnamed buttons", () => {
    const got = ids(r.lines);
    expect(got).toContain("ui:WorldEditor/window/#worldEditorMain");
    expect(got).toContain("ui:WorldEditor/toolbar/#toolBar");
    expect(got).toContain("ui:WorldEditor/toolbar-button/#play");
    expect(got).toContain("ui:WorldEditor/dock/#createDock");
    expect(got).toContain("ui:WorldEditor/panel/#statusBar"); // L01 records a StatusBar as a panel
    const unnamed = r.lines.filter((l) => l.confidence === "low" && l.kind === "toolbar-button");
    expect(unnamed.length).toBeGreaterThan(0);
    expect(unnamed[0].key).toEqual({ path: ["toolBar", "@QToolButton.1"] });
  });
  it("the current tool is a tool row under its dock; data rows and menus are not L03's", () => {
    const tool = r.lines.find((l) => l.kind === "tool")!;
    expect(tool.key).toEqual({ path: ["currentToolDock", "Move"] });
    expect(tool.parent_key?.kind).toBe("dock");
    expect(r.lines.some((l) => (l.label_raw ?? "") === "AILib")).toBe(false);
    expect(r.lines.some((l) => (l.label_raw ?? "") === "File")).toBe(false);
    expect(r.lines.some((l) => l.locator?.controlType === "TreeItem")).toBe(false);
  });
  it("children_count only where every non-separator child is a row; state per the matrix", () => {
    const tb = r.lines.find((l) => deriveId(l) === "ui:WorldEditor/toolbar/#toolBar")!;
    const buttons = r.lines.filter(
      (l) =>
        l.kind === "toolbar-button" && JSON.stringify(l.parent_key?.key) === JSON.stringify(tb.key),
    );
    // the toolbar carries `mode`, its buttons no axis: the build counts children per state, so a
    // count would claim children the file does not emit in that state (P4-1 G1); no count
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => JSON.stringify(b.observed_state) === "{}")).toBe(true);
    expect(tb.children_count).toBeUndefined();
    expect(tb.observed_state).toEqual({ mode: "edit" });
    expect(r.lines.find((l) => l.kind === "dock")!.observed_state).toEqual({});
    expect(r.lines.every((l) => l.kind !== "dock" || l.children_count === undefined)).toBe(true);
  });
  it("tabs sit under their strip; status items are named labels only", () => {
    const tabs = r.lines.filter((l) => l.kind === "tab");
    expect(tabs.map((t) => t.label_raw)).toContain("Log Console");
    expect(tabs.every((t) => t.parent_key?.kind === "panel")).toBe(true);
    const st = r.lines.filter((l) => l.kind === "status-item");
    expect(st).toHaveLength(1);
    expect(st[0].label_raw).toMatch(/^Version /);
  });
});

describe("helpers", () => {
  it("windowToggles reads nested items; null without a Window title", () => {
    expect(windowToggles(MENU)).toEqual(["Hierarchy", "Log Console", "Layers"]);
    expect(windowToggles({ menus: [] })).toBeNull();
  });
  it("currentTool reads the current-tool dock title", () => {
    expect(currentTool(WALK.tree)).toBe("Move");
    expect(currentTool(withTool("Measure Tool", "MeasureToolPanel").tree)).toBe("Measure Tool");
  });
  it("tool activation is derived from the allow-list and needs the restore path listed", () => {
    expect(activatable(loadPolicy())).toEqual([]);
    const p = toolPolicy();
    expect(activatable(p)).toEqual([["Tools", "Measure Tool"]]);
    const only = structuredClone(p);
    only.execute_action!.allow_list = [["Tools", "Measure Tool"]];
    expect(activatable(only)).toEqual([]);
  });
});

function toolPolicy(): CensusPolicy {
  const p = structuredClone(loadPolicy());
  p.execute_action!.allow_list = [
    ...(p.execute_action!.allow_list ?? []),
    ["Tools", "Move"],
    ["Tools", "Measure Tool"],
  ];
  return p;
}

// ── Plans ────────────────────────────────────────────────────────────────────

const FORBIDDEN_KINDS = new Set(["key", "invoke", "menu-open", "uia-context", "uia-dialog-cancel"]);
const LIST1 = [
  "New World",
  "Create World",
  "Create Terrain",
  "Save World As",
  "Pack Project",
  "Publish",
  "Login",
];

function assertSafe(plan: PlanAction[]): void {
  for (const a of plan) {
    expect(FORBIDDEN_KINDS.has(a.kind)).toBe(false);
    const s = JSON.stringify(a);
    expect(s).not.toMatch(/"(keys|key)"\s*:/);
    expect(s).not.toMatch(/Enter|Invoke|ParticleEditor/);
    if (a.kind === "uia-menu") expect(a.calls).toEqual(["Expand", "Collapse"]);
    if (a.kind === "execute-action") {
      const path = (a.target as { path: string[] }).path;
      for (const l of LIST1) expect(path).not.toContain(l);
      expect(path[0]).toBe("Tools");
      expect(a.opensDialog).toBeUndefined();
    }
  }
}

describe("plan and dry run", () => {
  it("the CLI dry run passes the checker and the queue validates", async () => {
    const out = join(TMP, "plan.json");
    const q = join(TMP, "q.json");
    const said: string[] = [];
    const code = await runWalker(
      l03Def(() => {
        throw new Error("no kernel in a dry run");
      }),
      ["--out", out, "--outline", join(TMP, "o.txt"), "--emit-queue", q],
      { out: (l) => said.push(l) },
    );
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain("PASS");
    const plan = JSON.parse(readFileSync(out, "utf-8")) as PlanAction[];
    expect(plan.map((a) => a.kind)).toEqual(["uia-read", "uia-menu"]);
    assertSafe(plan);
    expect(validateQueue(JSON.parse(readFileSync(q, "utf-8")), false)).toHaveLength(2);
  });
  it("with Tools paths listed: walk, action, walk, restore, walk; checker passes", () => {
    const p = toolPolicy();
    const def = l03Def(
      () => fakeKernel(new Map(), []).k,
      () => p,
    );
    const sel = { module: "WorldEditor", state: STATE, allowOwned: false };
    const steps = def.steps(sel);
    expect(steps.map((s) => s.id)).toEqual([
      "p4-l03-chrome",
      "p4-l03-window-menu",
      "p4-l03-tool-measure-tool",
    ]);
    expect(steps[2].plan(sel).map((a) => a.kind)).toEqual([
      "uia-read",
      "execute-action",
      "uia-read",
      "execute-action",
      "uia-read",
    ]);
    const plan = walkerPlan(steps, sel);
    assertSafe(plan);
    expect(checkPlan(plan, p, { script: SCRIPT }).ok).toBe(true);
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT }).ok).toBe(false);
    const queue = buildWalkerQueue(def, steps);
    expect((queue.probes as Array<{ risk_class: string }>).map((x) => x.risk_class)).toEqual([
      "read-only",
      "reversible",
      "reversible",
    ]);
  });
  it("ParticleEditor and an unlisted module are refused by the checker", () => {
    // P4-2: every MODULE_TITLES module enters (AudioEditor included); ParticleEditor never does.
    for (const module of ["ParticleEditor", "DialogueEditor"]) {
      const sel = { module, state: {}, allowOwned: false };
      const plan = walkerPlan(l03Def().steps(sel), sel);
      expect(checkPlan(plan, loadPolicy(), { script: SCRIPT }).ok).toBe(false);
    }
  });
});

// ── Steps on fakes ───────────────────────────────────────────────────────────

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

function fakeKernel(
  files: Map<string, string>,
  walks: WalkDoc[],
  menu: MenuDoc = MENU,
  actionOk = true,
): { k: L03Kernel; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const k: L03Kernel = {
    walk: async (t) => {
      calls.push("walk");
      const d = walks[Math.min(i++, walks.length - 1)];
      const text = JSON.stringify(d);
      files.set(t.out, text);
      return { doc: d, file: t.out, sha256: sha(text), detail: "fake" };
    },
    menus: async (t) => {
      calls.push("menus");
      const text = JSON.stringify(menu);
      files.set(t.out, text);
      return { doc: menu, file: t.out, sha256: sha(text), detail: "fake" };
    },
    action: async (_m, path) => {
      calls.push(`action ${path.join(">")}`);
      return { ok: actionOk, detail: actionOk ? "ok" : "ENGINE_FALSE" };
    },
    readText: (p) => files.get(p) ?? null,
    writeText: (p, t) => files.set(p, t),
  };
  return { k, calls };
}

const opts = (runDir: string) => ({
  enumerator: "L03",
  script: SCRIPT,
  session: "P4-1",
  runDir,
  module: "WorldEditor",
  state: STATE,
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});

const obsOf = (files: Map<string, string>) =>
  [...files.entries()].find(([k]) => k.endsWith(".obs.jsonl"));

describe("runWalkerSteps with the L03 steps", () => {
  it("chrome then window menu: lines conformant, normalise accepts them, report written", async () => {
    const files = new Map<string, string>();
    const { k, calls } = fakeKernel(files, [WALK]);
    const steps = l03Def(() => k).steps({ module: "WorldEditor", state: STATE, allowOwned: false });
    const r = await runWalkerSteps(steps, fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(calls).toEqual(["walk", "menus"]);
    const [obsName, obs] = obsOf(files)!;
    expect(obsName.replace(/\\/g, "/")).toBe("/run/L03-WorldEditor-edit-none.obs.jsonl");
    const lines = obs
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const l of lines) expect(validateLine(l, "L03")).toEqual([]);
    expect(
      new Set(lines.map((l) => `${deriveId(l)}|${JSON.stringify(l.observed_state)}`)).size,
    ).toBe(lines.length);
    const report = JSON.parse(
      [...files.entries()].find(([kk]) => kk.endsWith("window-docks.json"))![1],
    );
    expect(report.matched).toEqual(["Hierarchy", "Log Console"]);
    expect(report.noOpenDock).toEqual(["Layers"]);
    // normalise.ts: a fresh merge of the raw file, then --check finds it current
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    copyFileSync(join(REPO_ROOT, "data", "census", "universes.json"), join(data, "universes.json"));
    const raw = join(TMP, "L03-WorldEditor-edit-none.obs.jsonl");
    writeFileSync(raw, obs);
    const say: string[] = [];
    const io = { out: (l: string) => say.push(l), err: (l: string) => say.push(l) };
    expect(
      normalise(["--enumerator", "L03", "--build", "t", "--data", data, "--fresh", raw], io),
    ).toBe(0);
    expect(
      normalise(
        ["--enumerator", "L03", "--build", "t", "--data", data, "--fresh", "--check", raw],
        io,
      ),
    ).toBe(0);
    expect(say.join("\n")).not.toMatch(/FAIL|rejected/);
  });
  it("L01's walk file in the run folder is read instead of walking", async () => {
    const files = new Map<string, string>([
      [join("/run", "L01-WorldEditor-edit-none-walk.json"), WALK_TEXT],
    ]);
    const { k, calls } = fakeKernel(files, [WALK]);
    const steps = l03Def(() => k).steps({ module: "WorldEditor", state: STATE, allowOwned: false });
    const r = await runWalkerSteps([steps[0]], fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(calls).toEqual([]);
    expect(obsOf(files)![1]).toContain(`artifact:${sha(WALK_TEXT)}#n/0`);
  });
  it("a popup left open is a handoff; a step is never run twice", async () => {
    const files = new Map<string, string>();
    const { k } = fakeKernel(files, [WALK], { ...MENU, leftOpen: [["Window"]] });
    const steps = l03Def(() => k).steps({ module: "WorldEditor", state: STATE, allowOwned: false });
    const r = await runWalkerSteps([steps[1]], fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.message).toMatch(/Esc once/);
    const again = await runWalkerSteps([steps[1]], fakeDeps(files), opts("/run"));
    expect(again.exit).toBe(EXIT.refused);
  });
  it("a new window stops the step; a dialog-like window is a handoff", async () => {
    for (const [w, exit] of [
      [win("Stray", 9), EXIT.stopped],
      [win("Some Dialog", 9, "#32770"), EXIT.handoff],
    ] as const) {
      const files = new Map<string, string>();
      const { k } = fakeKernel(files, [WALK]);
      let n = 0;
      const steps = l03Def(() => k).steps({
        module: "WorldEditor",
        state: STATE,
        allowOwned: false,
      });
      const r = await runWalkerSteps(
        steps,
        fakeDeps(files, () => (n++ > 0 ? [w] : [])),
        opts("/run"),
      );
      expect(r.exit).toBe(exit);
      expect(r.stoppedAt).toBe("p4-l03-chrome");
      // common.ts gap (hand-off): lines emitted before the final window check stay in the obs file
      const rec = JSON.parse(
        [...files.entries()].find(([kk]) => kk.endsWith("p4-l03-chrome.json"))![1],
      );
      expect(rec.status).toBe(exit === EXIT.handoff ? "handoff" : "stopped");
    }
  });
  it("tool step: activate, read, restore, read back; new rows only", async () => {
    const files = new Map<string, string>();
    const active = withTool("Measure Tool", "MeasureToolPanel");
    const { k, calls } = fakeKernel(files, [WALK, active, WALK]);
    const steps = l03Def(() => k, toolPolicy).steps({
      module: "WorldEditor",
      state: STATE,
      allowOwned: false,
    });
    const r = await runWalkerSteps([steps[2]], fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(calls).toEqual([
      "walk",
      "action Tools>Measure Tool",
      "walk",
      "action Tools>Move",
      "walk",
    ]);
    const lines = obsOf(files)![1]
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(
      lines.some((l) => JSON.stringify(l.key) === '{"path":["currentToolDock","Measure Tool"]}'),
    ).toBe(true);
    for (const l of lines) expect(validateLine(l, "L03")).toEqual([]);
  });
  it("tool step: not restored is a stop; no visible effect sends no restore", async () => {
    const active = withTool("Measure Tool", "MeasureToolPanel");
    let files = new Map<string, string>();
    let f = fakeKernel(files, [WALK, active, active]);
    let steps = l03Def(() => f.k, toolPolicy).steps({
      module: "WorldEditor",
      state: STATE,
      allowOwned: false,
    });
    let r = await runWalkerSteps([steps[2]], fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/owner hand/);
    files = new Map();
    f = fakeKernel(files, [WALK, WALK]);
    steps = l03Def(() => f.k, toolPolicy).steps({
      module: "WorldEditor",
      state: STATE,
      allowOwned: false,
    });
    r = await runWalkerSteps([steps[2]], fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(f.calls).toEqual(["walk", "action Tools>Measure Tool", "walk"]);
    const rec = JSON.parse(
      [...files.entries()].find(([kk]) => kk.endsWith("measure-tool.json"))![1],
    );
    expect(rec.status).toBe("observed");
  });
});
