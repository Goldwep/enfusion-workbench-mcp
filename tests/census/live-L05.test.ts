import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import {
  EXIT,
  POPUP_SHADOW_CLASS,
  POPUP_WINDOW_CLASS,
  deriveId,
  runWalkerSteps,
  validateLine,
  type WalkerDeps,
  type WalkerOptions,
} from "../../scripts/census/live/common.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  HAND_PREFIX,
  OPENED_BY_HAND,
  PASSIVE_TIMEOUT_MS,
  makeRealKernel,
  menuParent,
  PROBE_ID,
  deriveTargets,
  e09Extensions,
  l05Steps,
  liveNameNote,
  main,
  realEnv,
  runWalkPath,
  targetInWalk,
  targetsFor,
  type ContextKernel,
  type L05Env,
  type WalkNode,
} from "../../scripts/census/live/L05-context.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l05-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = join(REPO_ROOT, "tests", "census", "fixtures", "live");
const fixture = (name: string): { tree: WalkNode } =>
  JSON.parse(readFileSync(join(FIX, name), "utf-8")) as { tree: WalkNode };
const POPUP_TEXT = readFileSync(join(FIX, "L05-popup-sf15.json"), "utf-8");
const POPUP_SHA = createHash("sha256").update(POPUP_TEXT).digest("hex");
const POPUP = (JSON.parse(POPUP_TEXT) as { tree: WalkNode }).tree;
const EXTS = e09Extensions();

const WE_TARGETS = deriveTargets(
  fixture("L05-we-walk-slice.json").tree,
  "WorldEditor",
  EXTS,
).targets.map((t) => ({ module: t.module, path: t.path }));
const RM_TARGETS = deriveTargets(
  fixture("L05-rm-walk-synthetic.json").tree,
  "ResourceManager",
  EXTS,
).targets.map((t) => ({ module: t.module, path: t.path }));

/** The real policy with the derived targets entered, as main would. */
function policyWith(targets: Array<{ module?: string; path: string[] }>): CensusPolicy {
  const p = JSON.parse(JSON.stringify(loadPolicy())) as CensusPolicy;
  (p.live_lane as Record<string, unknown>).uia_context = {
    ...(p.live_lane?.uia_context as Record<string, unknown>),
    targets,
  };
  return p;
}
const POLICY = policyWith([...WE_TARGETS, ...RM_TARGETS]);
const WE = {
  module: "WorldEditor",
  state: { mode: "edit", selection: "none" },
  allowOwned: false,
} as const;

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

interface Fake {
  env: L05Env;
  calls: string[];
  markersAtShow: boolean[];
}
function fakeEnv(
  files: Map<string, string>,
  o: {
    answered?: boolean;
    leftOpen?: boolean;
    popup?: WalkNode | null;
    hand?: WalkNode | null;
    liveNames?: Array<{ step: number; census: string; live: string }>;
  } = {},
): Fake {
  const f: Fake = { env: undefined as unknown as L05Env, calls: [], markersAtShow: [] };
  const kernel: ContextKernel = {
    show: async (_pid, window, path) => {
      f.calls.push(`show ${path.join(">")} ${window.className}`);
      f.markersAtShow.push([...files.keys()].some((k) => k.endsWith(".started")));
      return {
        answered: o.answered ?? true,
        detail: "fake",
        ...(o.liveNames ? { liveNames: o.liveNames } : {}),
      };
    },
    readPopup: async () => {
      f.calls.push("read");
      const tree = o.popup === undefined ? POPUP : o.popup;
      return {
        tree,
        artifact: tree ? { path: "<artifacts>/popup.json", sha256: POPUP_SHA } : null,
      };
    },
    collapse: async () => {
      f.calls.push("collapse");
      return { leftOpen: o.leftOpen ?? false, detail: "fake" };
    },
    readPassive: async (_pid, _window, path, timeoutMs) => {
      f.calls.push(`passive ${path.join(">")} ${timeoutMs}`);
      const tree = o.hand === undefined ? POPUP : o.hand;
      return {
        tree,
        artifact: tree ? { path: "<artifacts>/popup.json", sha256: POPUP_SHA } : null,
        detail: tree ? "read" : "no popup window of the pid appeared (nothing was sent)",
      };
    },
  };
  f.env = { kernel, readText: (p) => files.get(p) ?? null };
  return f;
}

const opts = (runDir: string, over: Partial<WalkerOptions> = {}): WalkerOptions => ({
  enumerator: "L05",
  script: "scripts/census/live/L05-context.ts",
  session: "P4-1",
  runDir,
  module: "WorldEditor",
  state: { mode: "edit", selection: "none" },
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
  ...over,
});

const LIST1 = [
  "Create World",
  "Create Terrain",
  "Save World As",
  "Pack Project",
  "Publish",
  "Login",
];

describe("L05 targets (derived, never hand-written)", () => {
  it("entity targets come from the Hierarchy's named rows, one per distinct name", () => {
    const p = deriveTargets(fixture("L05-we-walk-slice.json").tree, "WorldEditor", EXTS);
    expect(p.targets).toEqual([
      { module: "WorldEditor", path: ["Hierarchy", "unnamed"], source: "entity" },
      { module: "WorldEditor", path: ["Hierarchy", "default"], source: "entity" },
    ]);
    expect(p.unnamed_entities).toBe(6);
    expect(p.missing_file_types).toContain("conf");
  });
  it("file-type targets: first visible item per E09 extension of a real module; module none is never a target", () => {
    const p = deriveTargets(fixture("L05-rm-walk-synthetic.json").tree, "ResourceManager", EXTS);
    expect(p.targets.map((t) => [t.path[1], t.resource_type])).toEqual([
      ["u16_sample.conf", "conf"],
      ["u16_sample.emat", "emat"],
      ["u16_sample.layout", "layout"],
    ]);
    expect(EXTS.has("txt")).toBe(false);
    expect(p.missing_file_types).not.toContain("conf");
    expect(p.missing_file_types).toContain("ptc");
  });
  it("a run takes only the policy's targets of its module, and of its resource_type", () => {
    expect(targetsFor(POLICY, "WorldEditor", WE.state)).toEqual(WE_TARGETS);
    expect(targetsFor(POLICY, "ResourceManager", { resource_type: "emat" })).toEqual([
      { module: "ResourceManager", path: ["Resource Browser", "u16_sample.emat"] },
    ]);
    // P4-5 (main, 2026-11-13): the rock entity and the viewport added; "unnamed" kept, because the
    // P4-8 draws b-032/064/096 target it (the L05 probe now picks a target present in the walk).
    expect(targetsFor(loadPolicy(), "WorldEditor", WE.state)).toEqual([
      { module: "WorldEditor", path: ["Hierarchy", "unnamed"] },
      { module: "WorldEditor", path: ["Hierarchy", "default"] },
      { module: "WorldEditor", path: ["Hierarchy", "EMCP_P4_Rock"] },
      { module: "WorldEditor", path: ["Viewport"] },
    ]);
    expect(targetsFor(loadPolicy(), "ParticleEditor", {})).toEqual([]);
    expect(targetsFor(policyWith([]), "WorldEditor", WE.state)).toEqual([]);
    expect(targetsFor(POLICY, "ParticleEditor", {})).toEqual([]);
    expect(l05Steps({ module: "ParticleEditor", state: {}, allowOwned: false }, POLICY)).toEqual(
      [],
    );
  });
});

describe("L05 plan", () => {
  const steps = l05Steps(WE, POLICY);
  const plan: PlanAction[] = steps.flatMap((s) => s.plan(WE));
  it("the probe comes first, on one target; then one step per further target", () => {
    expect(steps.map((s) => s.id)).toEqual([PROBE_ID, "p4-l05-t01-hierarchy-default"]);
    expect(steps.every((s) => s.popups === true && s.risk === "reversible")).toBe(true);
  });
  it("passes checkPlan with the listed targets and fails without them", () => {
    expect(checkPlan(plan, POLICY, { script: "scripts/census/live/L05-context.ts" }).ok).toBe(true);
    const bare = checkPlan(plan, policyWith([]), { script: "scripts/census/live/L05-context.ts" });
    expect(bare.ok).toBe(false);
    expect(bare.violations.map((v) => v.rule)).toContain("uia-context-not-allow-listed");
  });
  it("holds no invoke, no key, no Enter, no typing and no list 1 opener", () => {
    expect(new Set(plan.map((a) => a.kind))).toEqual(new Set(["uia-context", "uia-read"]));
    for (const a of plan) {
      if (a.kind === "uia-context") expect(a.calls).toEqual(["ShowContextMenu", "Collapse"]);
      if (a.kind === "uia-read") expect(a.readOnly).toBe(true);
      for (const k of ["keys", "key", "text", "type", "params", "button", "opensDialog"])
        expect((a as Record<string, unknown>)[k]).toBeUndefined();
    }
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/Invoke|"Enter"|Return|VK_RETURN|SendKeys|ExecuteAction/);
    for (const l of LIST1) expect(text).not.toContain(l);
  });
  it("the CLI dry run prints the outline and PASS against a policy listing the targets", async () => {
    const said: string[] = [];
    const out = join(TMP, "plan.json");
    const code = await main(["--out", out], { out: (l) => said.push(l), policy: POLICY });
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain(PROBE_ID);
    expect(said[said.length - 1]).toBe("PASS");
    expect(JSON.parse(readFileSync(out, "utf-8"))).toEqual(plan);
    // the committed policy lists the two derived WorldEditor targets
    const saidReal: string[] = [];
    expect(await main([], { out: (l) => saidReal.push(l) })).toBe(EXIT.done);
    expect(saidReal[saidReal.length - 1]).toBe("PASS");
    expect(saidReal.join("\n")).toContain("default");
    expect(saidReal.join("\n")).toContain("EMCP_P4_Rock");
    // a policy with no target: an empty plan, PASS, and a note
    const said2: string[] = [];
    expect(await main([], { out: (l) => said2.push(l), policy: policyWith([]) })).toBe(EXIT.done);
    expect(said2.join("\n")).toContain("no live_lane.uia_context target");
  });
  it("--propose writes the mechanical proposal", async () => {
    const out = join(TMP, "proposal.json");
    const code = await main(
      [
        "--propose",
        join(FIX, "L05-we-walk-slice.json"),
        "--module",
        "WorldEditor",
        "--propose-out",
        out,
      ],
      { out: () => undefined },
    );
    expect(code).toBe(EXIT.done);
    const p = JSON.parse(readFileSync(out, "utf-8"));
    expect(p.targets.map((t: { path: string[] }) => t.path)).toEqual(WE_TARGETS.map((t) => t.path));
  });
});

describe("L05 targets from the run's walk (P4-5)", () => {
  // The P4-5 world, unsaved: the layer row reads "default*"; no "unnamed" row, no "Viewport" name.
  const WALK: WalkNode = {
    controlType: "Window",
    name: "World Editor - EMCP_P4_Tiny.ent*",
    children: [
      { controlType: "TabItem", name: "Hierarchy" },
      {
        controlType: "Window",
        name: "Hierarchy",
        className: "QDockWidget",
        children: [
          {
            controlType: "Tree",
            children: [
              { controlType: "TreeItem", name: "default*" },
              { controlType: "TreeItem", name: "EMCP_P4_Rock" },
            ],
          },
        ],
      },
      { controlType: "Group", className: "WorldRenderWindowQt" },
      { controlType: "Window", name: "Layers", children: [{ controlType: "TreeItem", name: "x*" }] },
    ],
  };
  const P45 = policyWith([
    { module: "WorldEditor", path: ["Hierarchy", "unnamed"] },
    { module: "WorldEditor", path: ["Hierarchy", "default"] },
    { module: "WorldEditor", path: ["Hierarchy", "EMCP_P4_Rock"] },
    { module: "WorldEditor", path: ["Viewport"] },
  ]);
  it("a target exists when each step matches; the dirty marker only under the Hierarchy dock", () => {
    expect(targetInWalk(WALK, ["Hierarchy", "default"])).toBe(true);
    expect(targetInWalk(WALK, ["Hierarchy", "default*"])).toBe(true);
    expect(targetInWalk(WALK, ["Hierarchy", "EMCP_P4_Rock"])).toBe(true);
    expect(targetInWalk(WALK, ["Hierarchy", "unnamed"])).toBe(false);
    expect(targetInWalk(WALK, ["Viewport"])).toBe(false);
    expect(targetInWalk(WALK, ["@WorldRenderWindowQt.1"])).toBe(true);
    expect(targetInWalk(WALK, ["@WorldRenderWindowQt.2"])).toBe(false);
    expect(targetInWalk(WALK, ["Layers", "x"])).toBe(false);
    expect(targetInWalk(WALK, ["Hierarchy", "default**"])).toBe(false);
  });
  it("the probe takes the first policy target the walk shows; absent targets are not walked", () => {
    const steps = l05Steps(WE, P45, realEnv, { walk: WALK });
    expect(steps.map((s) => [s.id, s.title])).toEqual([
      [PROBE_ID, "probe: does Qt answer ShowContextMenu? one target, Hierarchy > default"],
      ["p4-l05-t01-hierarchy-emcp-p4-rock", "context menu of Hierarchy > EMCP_P4_Rock"],
    ]);
    // without a walk: the policy order, as before
    expect(l05Steps(WE, P45).map((s) => s.title)[0]).toMatch(/Hierarchy > unnamed$/);
  });
  it("the live name the kernel matched is recorded on the context-menu line; the key is the census name", async () => {
    const files = new Map<string, string>();
    const live = { step: 2, census: "default", live: "default*" };
    const f = fakeEnv(files, { liveNames: [live] });
    const [probe] = l05Steps(WE, P45, f.env, { walk: WALK });
    const r = await runWalkerSteps([probe], fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(f.calls[0]).toBe("show Hierarchy>default Qt683QWindowIcon");
    const obs = [...files.entries()].find(([k]) => k.endsWith(".obs.jsonl"))![1];
    const lines = obs
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
    const menu = lines.find((l) => l.kind === "context-menu");
    expect(deriveId(menu)).toBe("ui:WorldEditor/context-menu/Hierarchy/default");
    expect(menu.unverified).toContain(liveNameNote(live));
    expect(liveNameNote(live)).toMatch(/"default\*".*census name "default"/);
    for (const l of lines) expect(validateLine(l, "L05")).toEqual([]);
  });
  it("the CLI reads the run folder's L01 walk and names the targets it leaves out", async () => {
    const runDir = join(TMP, "walk-run");
    mkdirSync(runDir, { recursive: true });
    const state = { mode: "edit", selection: "entity" } as const;
    const wp = runWalkPath(runDir, "WorldEditor", state);
    expect(wp.endsWith("L01-WorldEditor-edit-entity-walk.json")).toBe(true);
    writeFileSync(wp, JSON.stringify({ tree: WALK }));
    const said: string[] = [];
    const code = await main(
      ["--run-dir", runDir, "--module", "WorldEditor", "--state", "mode=edit,selection=entity"],
      { out: (l) => said.push(l), policy: P45 },
    );
    expect(code).toBe(EXIT.done);
    const text = said.join("\n");
    expect(text).toContain("not walked: Hierarchy > unnamed; Viewport");
    expect(text).toContain("Hierarchy > default");
    expect(text).not.toMatch(/one target, Hierarchy > unnamed/);
    const missing: string[] = [];
    expect(
      await main(["--targets-walk", join(runDir, "nope.json")], {
        out: (l) => missing.push(l),
        policy: P45,
      }),
    ).toBe(EXIT.usage);
  });
});

describe("L05 steps on a fake tree", () => {
  it("probe then target: ShowContextMenu, read, Collapse; started marker first; lines conform and normalise", async () => {
    const files = new Map<string, string>();
    const f = fakeEnv(files);
    const r = await runWalkerSteps(l05Steps(WE, POLICY, f.env), fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(f.calls).toEqual([
      `show Hierarchy>unnamed Qt683QWindowIcon`,
      "read",
      "collapse",
      `show Hierarchy>default Qt683QWindowIcon`,
      "read",
      "collapse",
    ]);
    expect(f.markersAtShow).toEqual([true, true]);
    const obsKey = [...files.keys()].find((k) =>
      k.endsWith("L05-WorldEditor-edit-none.obs.jsonl"),
    )!;
    const lines = files
      .get(obsKey)!
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const l of lines) expect(validateLine(l, "L05")).toEqual([]);
    const menus = lines.filter((l) => l.kind === "context-menu");
    expect(menus).toHaveLength(2);
    const items = lines.filter((l) => l.kind === "context-item");
    // sf-15: 13 MenuItems (9 named, 4 unnamed QWidgetAction), 5 separators
    expect(items).toHaveLength(26);
    expect(menus[0].children_count).toBe(13);
    expect(deriveId(menus[0])).toBe("ui:WorldEditor/context-menu/Hierarchy/unnamed");
    const ids = items.map((l) => deriveId(l));
    expect(ids).toContain("ui:WorldEditor/context-item/Hierarchy/unnamed/Show in Explorer");
    expect(ids).toContain("ui:WorldEditor/context-item/Hierarchy/default/@QWidgetAction.4");
    expect(new Set(ids).size).toBe(26);
    expect(lines.every((l) => l.ref.includes(POPUP_SHA))).toBe(true);
    // D8: context-menu and context-item both carry the matrix axes (mode, selection; P4-FIX-K)
    expect(menus.every((l) => l.observed_state.mode === "edit" && l.ref.endsWith("#popup"))).toBe(
      true,
    );
    expect(items.every((l) => l.observed_state.mode === "edit")).toBe(true);
    expect(
      items.every(
        (l) => JSON.stringify(l.observed_state) === JSON.stringify(menus[0].observed_state),
      ),
    ).toBe(true);
    // P4-FIX-K: a Hierarchy menu hangs under L01's Hierarchy tree; the target label goes to unverified
    expect(menus[0].parent_key).toEqual({
      dim: "ui",
      kind: "control",
      module: "WorldEditor",
      key: { object_name: "entityTree" },
    });
    expect(menus[0].unverified.some((u: string) => u.startsWith("target "))).toBe(true);
    expect(items.every((l) => /#items\/\d+$/.test(l.ref))).toBe(true);
    const del = items.find((l) => l.label === "Delete");
    expect(del.unverified).toContain("disabled when read");
    // the raw file merges with normalise.ts and --check finds it current
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    for (const n of ["universes.json", "current-build.json"])
      copyFileSync(join(REPO_ROOT, "data", "census", n), join(data, n));
    const raw = join(TMP, "L05-WorldEditor-edit-none.obs.jsonl");
    writeFileSync(raw, files.get(obsKey)!);
    const io = { out: () => undefined, err: (l: string) => errs.push(l) };
    const errs: string[] = [];
    expect(runNormalise(["--enumerator", "L05", "--data", data, "--fresh", raw], io)).toBe(0);
    expect(
      runNormalise(["--enumerator", "L05", "--data", data, "--check", "--fresh", raw], io),
    ).toBe(0);
    expect(errs).toEqual([]);
    // a step is never run twice in a run folder
    const again = await runWalkerSteps(l05Steps(WE, POLICY, f.env), fakeDeps(files), opts("/run"));
    expect(again.exit).toBe(EXIT.refused);
    expect(f.calls).toHaveLength(6);
  });
  it("no menu on the probe stops the block cleanly; nothing further is shown", async () => {
    const files = new Map<string, string>();
    const f = fakeEnv(files, { answered: false });
    const r = await runWalkerSteps(l05Steps(WE, POLICY, f.env), fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe(PROBE_ID);
    expect(r.message).toMatch(/not answered.*sf-15/);
    expect(f.calls).toEqual(["show Hierarchy>unnamed Qt683QWindowIcon"]);
    const rec = JSON.parse([...files.entries()].find(([k]) => k.endsWith(`${PROBE_ID}.json`))![1]);
    expect(rec.status).toBe("stopped");
    expect([...files.keys()].some((k) => k.endsWith(".obs.jsonl"))).toBe(false);
  });
  it("a target step refuses without the probe's pass record (an --only run)", async () => {
    const files = new Map<string, string>();
    const f = fakeEnv(files);
    const [, second] = l05Steps(WE, POLICY, f.env);
    const r = await runWalkerSteps([second], fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/no pass record/);
    expect(f.calls).toEqual([]);
  });
  it("a popup left open after Collapse is a handoff", async () => {
    const files = new Map<string, string>();
    const f = fakeEnv(files, { leftOpen: true });
    const r = await runWalkerSteps(l05Steps(WE, POLICY, f.env), fakeDeps(files), opts("/run"));
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.message).toMatch(/Esc once, by hand/);
  });
  it("the popup pair is benign; any other new window stops; a dialog-like window hands off", async () => {
    const popupPair = (n: number) =>
      n > 0
        ? [win("Arma Reforger Workbench", 7, POPUP_WINDOW_CLASS), win("", 8, POPUP_SHADOW_CLASS)]
        : [];
    let n = 0;
    let files = new Map<string, string>();
    let r = await runWalkerSteps(
      l05Steps(WE, POLICY, fakeEnv(files).env).slice(0, 1),
      fakeDeps(files, () => popupPair(n++)),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.done);
    n = 0;
    files = new Map();
    r = await runWalkerSteps(
      l05Steps(WE, POLICY, fakeEnv(files).env).slice(0, 1),
      fakeDeps(files, () => (n++ > 0 ? [win("Stray", 9)] : [])),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.stopped);
    n = 0;
    files = new Map();
    r = await runWalkerSteps(
      l05Steps(WE, POLICY, fakeEnv(files).env).slice(0, 1),
      fakeDeps(files, () => (n++ > 0 ? [win("Script Authorization Required", 9, "#32770")] : [])),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.handoff);
  });
  const kernelTree = (target: Record<string, unknown>): string => {
    const f = join(TMP, `kernel-${Math.random().toString(36).slice(2)}.json`);
    const popup = {
      hwnd: 300,
      pid: 4242,
      className: POPUP_WINDOW_CLASS,
      title: "Arma Reforger Workbench",
      owned: false,
      tree: { ...POPUP, patterns: ["ExpandCollapse"] },
    };
    writeFileSync(
      f,
      JSON.stringify({
        foreground: 999,
        windows: [
          {
            hwnd: 100,
            pid: 4242,
            className: "Qt683QWindowIcon",
            title: "World Editor - test",
            tree: {
              controlType: "Window",
              name: "World Editor - test",
              children: [
                {
                  controlType: "Window",
                  name: "Hierarchy",
                  className: "QDockWidget",
                  children: [
                    { controlType: "TreeItem", name: "unnamed", contextPopup: popup, ...target },
                  ],
                },
              ],
            },
          },
        ],
      }),
    );
    return f;
  };
  /** A real child process: the window watcher must yield to the event loop between polls. */
  const slowDeps = (files: Map<string, string>): WalkerDeps => ({
    ...fakeDeps(files),
    sleep: () => new Promise((r) => setTimeout(r, 5)),
  });
  it("the real kernel (context.py, fake provider): the probe shows, reads, collapses and emits", async () => {
    const files = new Map<string, string>();
    const kernel = makeRealKernel({
      provider: "fake",
      fakeTree: kernelTree({}),
      outDir: join(TMP, "kernel-out"),
    });
    const r = await runWalkerSteps(
      l05Steps(WE, POLICY, { kernel, readText: (p) => files.get(p) ?? null }).slice(0, 1),
      slowDeps(files),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.done);
    const rec = JSON.parse(
      files.get(`/run/${PROBE_ID}.json`) ??
        [...files.entries()].find(([k]) => k.endsWith(`${PROBE_ID}.json`))![1],
    ) as {
      status: string;
      artifacts: Array<{ sha256: string }>;
    };
    expect(rec.status).toBe("pass");
    expect(rec.artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the real kernel: ShowContextMenu unsupported stops the probe (supported:false), no further step", async () => {
    const files = new Map<string, string>();
    const kernel = makeRealKernel({
      provider: "fake",
      fakeTree: kernelTree({ showUnsupported: true }),
      outDir: join(TMP, "kernel-out"),
    });
    const r = await runWalkerSteps(
      l05Steps(WE, POLICY, { kernel, readText: (p) => files.get(p) ?? null }),
      slowDeps(files),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/supported:false/);
  });
  it("the real kernel: a popup left open after Collapse is a handoff", async () => {
    const files = new Map<string, string>();
    const kernel = makeRealKernel({
      provider: "fake",
      fakeTree: kernelTree({
        contextPopup: {
          hwnd: 300,
          pid: 4242,
          className: POPUP_WINDOW_CLASS,
          title: "Arma Reforger Workbench",
          owned: false,
          tree: POPUP,
        },
      }),
      outDir: join(TMP, "kernel-out"),
    });
    const r = await runWalkerSteps(
      l05Steps(WE, POLICY, { kernel, readText: (p) => files.get(p) ?? null }).slice(0, 1),
      slowDeps(files),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.handoff);
  });
  it("a real run outside the artifacts folder is refused before any step", async () => {
    const files = new Map<string, string>();
    const code = await main(
      [
        "--really",
        "--id",
        "lane",
        "--module",
        "WorldEditor",
        "--from",
        PROBE_ID,
        "--run-dir",
        join(TMP, "elsewhere", "run"),
        "--sandbox",
        join(TMP, "EMCP2_sandbox"),
      ],
      {
        out: () => undefined,
        policy: POLICY,
        platform: "win32",
        leaseHeld: true,
        artifactsRoot: join(TMP, "art"),
        deps: fakeDeps(files),
        env: fakeEnv(files).env,
        evidenceDir: null,
      },
    );
    expect(code).toBe(EXIT.refused);
    expect(files.size).toBe(0);
  });
});

describe("L05 --passive (the sf-15 route: the hand right-clicks, the tool reads)", () => {
  const PASSIVE = { passive: true };
  const popupUp = (): WindowInfo[] => [
    win("Arma Reforger Workbench", 7, POPUP_WINDOW_CLASS),
    win("", 8, POPUP_SHADOW_CLASS),
  ];
  const linesOf = (files: Map<string, string>): Array<Record<string, unknown>> => {
    const k = [...files.keys()].find((x) => x.endsWith("L05-WorldEditor-edit-none.obs.jsonl"));
    return k
      ? files
          .get(k)!
          .trimEnd()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  };

  it("one hand step per target, no probe; the plan is one popup uia-read and passes checkPlan", () => {
    const steps = l05Steps(WE, POLICY, realEnv, PASSIVE);
    expect(steps.map((s) => s.id)).toEqual([
      `${HAND_PREFIX}-00-hierarchy-unnamed`,
      `${HAND_PREFIX}-01-hierarchy-default`,
    ]);
    const plan = steps.flatMap((s) => s.plan(WE));
    expect(plan.map((a) => a.kind)).toEqual(["uia-read", "uia-read"]);
    expect(JSON.stringify(plan)).not.toMatch(/ShowContextMenu|Collapse|Invoke|"keys?"/);
    expect(checkPlan(plan, POLICY, { script: "scripts/census/live/L05-context.ts" }).ok).toBe(true);
    expect(steps.every((s) => s.popups === true)).toBe(true);
  });

  it("reads the hand's popup: no ShowContextMenu, no Collapse; lines carry opened_by hand; never twice", async () => {
    const files = new Map<string, string>();
    const f = fakeEnv(files);
    const logs: string[] = [];
    let n = 0;
    const deps = {
      ...fakeDeps(files, () => (n++ < 2 ? popupUp() : [])),
      log: (l: string) => logs.push(l),
    };
    const [only] = l05Steps(WE, POLICY, f.env, PASSIVE).slice(1);
    const r = await runWalkerSteps([only], deps, opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(f.calls).toEqual([`passive Hierarchy>default ${PASSIVE_TIMEOUT_MS}`]);
    expect(f.calls.some((c) => /show|collapse/.test(c))).toBe(false);
    expect(logs.some((l) => /OWNER: right-click "Hierarchy > default" now/.test(l))).toBe(true);
    expect(logs.some((l) => /OWNER: press Esc once now/.test(l))).toBe(true);
    const lines = linesOf(files);
    for (const l of lines) expect(validateLine(l, "L05")).toEqual([]);
    expect(lines.filter((l) => l.kind === "context-menu")).toHaveLength(1);
    expect(lines.filter((l) => l.kind === "context-item")).toHaveLength(13);
    expect(lines.every((l) => (l.unverified as string[]).includes(OPENED_BY_HAND))).toBe(true);
    expect(OPENED_BY_HAND).toMatch(/^opened_by: hand/);
    const rec = JSON.parse([...files.entries()].find(([k]) => k.endsWith(`${only.id}.json`))![1]);
    expect(rec.status).toBe("pass");
    expect(rec.summary).toMatch(/opened_by hand/);
    expect(rec.calls.map((c: { call?: string }) => c.call)).not.toContain("ShowContextMenu");
    const again = await runWalkerSteps([only], deps, opts("/run"));
    expect(again.exit).toBe(EXIT.refused);
    expect(again.message).toMatch(/never run twice/);
    expect(f.calls).toHaveLength(1);
  });

  it("no popup in time stops the step cleanly: nothing sent, no line", async () => {
    const files = new Map<string, string>();
    const f = fakeEnv(files, { hand: null });
    const r = await runWalkerSteps(
      l05Steps(WE, POLICY, f.env, PASSIVE).slice(0, 1),
      fakeDeps(files),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/nothing was sent/);
    expect(linesOf(files)).toEqual([]);
  });

  it("the popup still open after the Esc wait is a handoff; the good read's lines are kept", async () => {
    const files = new Map<string, string>();
    const f = fakeEnv(files);
    const r = await runWalkerSteps(
      l05Steps(WE, POLICY, f.env, PASSIVE).slice(0, 1),
      fakeDeps(files, popupUp),
      opts("/run"),
    );
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.message).toMatch(/Esc once, by hand/);
    expect(linesOf(files).length).toBe(14);
  });

  it("the real kernel (context.py --passive, fake provider): reads the hand's popup, sends nothing", async () => {
    const tree = join(TMP, "hand-tree.json");
    writeFileSync(
      tree,
      JSON.stringify({
        foreground: 999,
        handPopup: {
          hwnd: 300,
          pid: 4242,
          className: POPUP_WINDOW_CLASS,
          title: "Arma Reforger Workbench",
          owned: false,
          popupDelayPolls: 2,
          tree: POPUP,
        },
        windows: [
          {
            hwnd: 100,
            pid: 4242,
            className: "Qt683QWindowIcon",
            title: "World Editor - test",
            tree: { controlType: "Window", name: "World Editor - test", children: [] },
          },
        ],
      }),
    );
    const kernel = makeRealKernel({
      provider: "fake",
      fakeTree: tree,
      outDir: join(TMP, "hand-out"),
    });
    const r = await kernel.readPassive!(
      4242,
      { className: "Qt683QWindowIcon", titlePattern: "^World Editor.*$" },
      ["Hierarchy", "default"],
      2000,
    );
    expect(r.tree?.children?.length).toBeGreaterThan(0);
    expect(r.artifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const out = readdirSync(join(TMP, "hand-out"));
    expect(out).toHaveLength(1);
    const doc = JSON.parse(readFileSync(join(TMP, "hand-out", out[0]), "utf-8"));
    expect(doc).toMatchObject({ result: "ok", passive: true, openedBy: "hand", calls: [] });
    expect(doc.fakeCalls).toEqual([]);
  });

  it("the CLI: --passive dry run prints the hand steps and PASS", async () => {
    const said: string[] = [];
    expect(await main(["--passive"], { out: (l) => said.push(l), policy: POLICY })).toBe(EXIT.done);
    expect(said.join("\n")).toContain(`${HAND_PREFIX}-00-hierarchy-unnamed`);
    expect(said.join("\n")).not.toContain(PROBE_ID);
    expect(said[said.length - 1]).toBe("PASS");
  });
});

describe("L05 menu parents (P4-FIX-K)", () => {
  it("parents each World Editor target under the L01 row of its container", () => {
    const l01 = readFileSync(
      join(REPO_ROOT, "data", "census", "observations", "L01", "1.8.0.13.jsonl"),
      "utf-8",
    )
      .trimEnd()
      .split(/\r?\n/)
      .slice(1)
      .map((l) => JSON.parse(l))
      .filter((o) => o.module === "WorldEditor")
      .map((o) => deriveId(o));
    for (const path of [["Hierarchy", "default"], ["Resource Browser", "folder"], ["Viewport"]]) {
      const p = menuParent({ path }, "WorldEditor");
      expect(l01).toContain(deriveId({ ...p.parent_key!, observed_state: {} } as never));
    }
    expect(menuParent({ path: ["Viewport"] }, "WorldEditor").parent_key?.kind).toBe("region");
    // an unmapped module keeps the target's own control key
    expect(menuParent({ path: ["Dock", "x"] }, "ScriptEditor").parent_key?.key).toEqual({
      path: ["Dock", "x"],
    });
  });
});
