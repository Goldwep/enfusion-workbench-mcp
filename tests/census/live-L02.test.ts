import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  EXIT,
  deriveId,
  projectState,
  runWalker,
  validateLine,
  type LiveObservation,
  type WalkerDeps,
  chooseKey,
} from "../../scripts/census/live/common.js";
import {
  CHECKED_NOTE,
  DISABLED_NOTE,
  l02Def,
  l02Steps,
  main as l02Main,
  menuLines,
  menusWindowLine,
  windowObjectName,
  menusToolReader,
  stepId,
  stopFor,
  type MenuReader,
  type MenusDoc,
} from "../../scripts/census/live/L02-menus.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";

const PY = process.env.ENFUSION_PYTHON || "python";
const HAS_PYTHON = spawnSync(PY, ["--version"], { encoding: "utf-8" }).status === 0;
const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l02-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const FIXTURE = join(__dirname, "fixtures", "live", "L02-rm-menus-fake.json");
const SHA = "a".repeat(64);
const RM_TITLES = ["File", "Editors", "View", "Edit", "Window", "Utilities", "Plugins", "Help"];
const WE_TITLES = [
  "File",
  "Edit",
  "View",
  "Game",
  "Tools",
  "Window",
  "Plugins",
  "Entities",
  "Help",
];

function fakeDeps(files: Map<string, string>): WalkerDeps {
  return {
    windows: async () => [],
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
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

/** A fake tree from the fixture, changed by `mutate`, written to a temp file. */
function tree(mutate: (doc: Record<string, unknown>) => void = () => undefined): string {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf-8")) as Record<string, unknown>;
  mutate(doc);
  const f = join(TMP, `tree-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(doc));
  return f;
}

function barOf(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const w = (doc.windows as Array<Record<string, unknown>>)[0];
  const kids = (w.tree as { children: Array<Record<string, unknown>> }).children;
  return kids[1].children as Array<Record<string, unknown>>;
}

let runN = 0;
async function realRun(
  reader: MenuReader,
  extra: string[],
  files = new Map<string, string>(),
  runDir = join(TMP, "art", `run${++runN}`),
): Promise<{ code: number; files: Map<string, string>; runDir: string; said: string[] }> {
  mkdirSync(runDir, { recursive: true });
  const said: string[] = [];
  const code = await runWalker(
    l02Def({ reader }),
    [
      "--really",
      "--id",
      "lane",
      "--module",
      "ResourceManager",
      "--run-dir",
      runDir,
      "--sandbox",
      join(TMP, "EMCP2_sandbox"),
      ...extra,
    ],
    {
      out: (l) => said.push(l),
      platform: "win32",
      leaseHeld: true,
      artifactsRoot: join(TMP, "art"),
      deps: fakeDeps(files),
      evidenceDir: null,
    },
  );
  return { code, files, runDir, said };
}

function obsLines(files: Map<string, string>): LiveObservation[] {
  const k = [...files.keys()].find((p) => p.endsWith(".obs.jsonl"));
  if (!k) return [];
  return files
    .get(k)!
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as LiveObservation);
}

const RM = {
  module: "ResourceManager",
  state: { mode: "edit" as const, selection: "none" as const },
};

describe("L02 plan (dry run)", () => {
  it("one uia-menu step per policy title, in policy order, and the plan passes the checker", async () => {
    const out = join(TMP, "plan.json");
    const said: string[] = [];
    expect(await runWalker(l02Def(), ["--out", out], { out: (l) => said.push(l) })).toBe(EXIT.done);
    expect(said.at(-1)).toBe("PASS");
    const plan = JSON.parse(readFileSync(out, "utf-8")) as PlanAction[];
    expect(plan.map((a) => (a.menus as string[])[0])).toEqual(WE_TITLES);
    expect(checkPlan(plan, loadPolicy(), { script: "scripts/census/live/L02-menus.ts" }).ok).toBe(
      true,
    );
    const rm = l02Steps(RM).flatMap((s) => s.plan(RM as never));
    expect(rm.map((a) => (a.menus as string[])[0])).toEqual(RM_TITLES);
  });

  it("the plan holds no invoke, no key, no Enter, no typing and no Appendix B list 1 label", () => {
    const policy = loadPolicy();
    for (const module of ["WorldEditor", "ResourceManager"]) {
      const plan = l02Steps({ module, state: { mode: "edit" } }).flatMap((s) =>
        s.plan({ module, state: {}, allowOwned: false }),
      );
      for (const a of plan) {
        expect(a.kind).toBe("uia-menu");
        expect(a.calls).toEqual(["Expand", "Collapse"]);
        expect(a.module).toBe(module);
        expect(a.depth).toBe(1);
      }
      const text = JSON.stringify(plan);
      expect(text).not.toMatch(/invoke|"key"|enter|"type"|sendkeys|toggle/i);
      const list1 = Object.values(policy.deny_lists ?? {}).flatMap((d) => d.labels ?? []);
      for (const a of plan) for (const m of a.menus as string[]) expect(list1).not.toContain(m);
    }
  });

  it("ParticleEditor is never read; a module with no titles or window is refused", async () => {
    expect(l02Steps({ module: "ParticleEditor", state: {} })).toEqual([]);
    expect(l02Steps({ module: "DialogueEditor", state: {} })).toEqual([]);
    expect(await l02Main(["--module", "ParticleEditor"])).toBe(2);
    expect(await l02Main(["--module", "DialogueEditor"])).toBe(2);
  });

  it("World Editor menus carry only the mode axis (state-matrix); the Resource Manager none", () => {
    expect(projectState({ mode: "edit", selection: "entity" }, ["mode"])).toEqual({ mode: "edit" });
    expect(projectState({ mode: "edit", selection: "entity" }, [])).toEqual({});
  });
});

describe("L02 lines from a menus document", () => {
  const doc: MenusDoc = {
    result: "ok",
    target: { className: "Qt683QWindowIcon" },
    leftOpen: [],
    menus: [
      {
        title: "File",
        opened: true,
        collapsed: true,
        popup: {
          count: 1,
          automationIds: ["Arma4WorkbenchApp.ResourceManagerMain.menubar.QAction.QMenu"],
          classNames: ["QMenu"],
          truncated: false,
        },
        items: [
          { controlType: "MenuItem", name: "Save", accessKey: "Ctrl+S", enabled: true },
          { controlType: "Separator", name: "" },
          { controlType: "MenuItem", name: "", className: "QWidgetAction" },
          { controlType: "MenuItem", name: "Options...", enabled: true },
          { controlType: "MenuItem", name: "Publish to Workshop", enabled: false },
          { controlType: "MenuItem", name: "Save", enabled: true },
        ],
      },
    ],
  };
  it("maps titles and items to conformant menu and menu-item lines", () => {
    const { lines, notes } = menuLines(doc, { module: "ResourceManager", state: {}, sha: SHA });
    for (const l of lines) expect(validateLine(l, "L02")).toEqual([]);
    expect(lines.map(deriveId)).toEqual([
      "ui:ResourceManager/menu/File",
      "ui:ResourceManager/menu-item/File/Save",
      "ui:ResourceManager/menu-item/File/@QWidgetAction.1",
      `ui:ResourceManager/menu-item/${deriveId(lines[3]).split("menu-item/")[1]}`,
      "ui:ResourceManager/menu-item/File/Publish to Workshop",
    ]);
    expect(lines[0].parent_key?.key).toEqual({ object_name: "ResourceManagerMain" });
    expect(lines[0].ref).toBe(`artifact:${SHA}#m/File`);
    // a same-named sibling is not a row, so the title is not complete
    expect(lines[0].children_count).toBeUndefined();
    expect(notes.join()).toContain("appears twice");
    expect(lines[1].shortcut_default).toBe("Ctrl+S");
    expect(lines[2].confidence).toBe("low");
    expect(lines[3].modal).toBe("opens");
    expect(lines[4].unverified).toContain(DISABLED_NOTE);
  });
  it("a title whose popup was not descended into gives no item and no children_count", () => {
    const flat: MenusDoc = {
      ...doc,
      menus: [
        {
          title: "File",
          opened: true,
          collapsed: true,
          items: [{ controlType: "Menu", name: "" }],
        },
      ],
    };
    const { lines, notes } = menuLines(flat, { module: "ResourceManager", state: {}, sha: SHA });
    expect(lines).toHaveLength(1);
    expect(lines[0].children_count).toBeUndefined();
    expect(notes[0]).toContain("Menu node");
  });
});

describe("L02 stop rules (D13)", () => {
  const out = "<run>/x-menus.json";
  it("no document: STOP; a popup left open: HANDOFF; an auth window: HANDOFF", () => {
    expect(stopFor({ code: 1, doc: null, text: null }, out)?.kind).toBe("stopped");
    expect(
      stopFor({ code: 6, doc: { result: "stopped", leftOpen: [["File"]] }, text: "" }, out)?.kind,
    ).toBe("handoff");
    expect(
      stopFor({ code: 3, doc: { result: "refused-auth-window", leftOpen: [] }, text: "" }, out)
        ?.kind,
    ).toBe("handoff");
  });
  it("a new owned window or a disabled main window: HANDOFF; another new window: STOP", () => {
    const owned = { className: "Qt683QWindowIcon", title: "Options", owned: true };
    const other = { className: "Other", title: "x", owned: false };
    expect(
      stopFor(
        { code: 6, doc: { result: "stopped", newWindows: [owned], reason: "new" }, text: "" },
        out,
      )?.kind,
    ).toBe("handoff");
    expect(
      stopFor(
        { code: 6, doc: { result: "stopped", reason: "the main window is disabled" }, text: "" },
        out,
      )?.kind,
    ).toBe("handoff");
    expect(
      stopFor(
        { code: 6, doc: { result: "stopped", newWindows: [other], reason: "new" }, text: "" },
        out,
      )?.kind,
    ).toBe("stopped");
    expect(stopFor({ code: 0, doc: { result: "ok", leftOpen: [] }, text: "" }, out)).toBeNull();
  });
});

describe.skipIf(!HAS_PYTHON)(
  "L02 against the fake menus tree (menus.ts and menus.py, real code)",
  () => {
    it("File: items read inside the popup; lines conformant; the run folder holds started marker, record, document", async () => {
      const r = await realRun(menusToolReader({}, tree()), [
        "--only",
        stepId("ResourceManager", "File", RM.state),
      ]);
      expect(r.code).toBe(EXIT.done);
      const all = obsLines(r.files);
      for (const l of all) expect(validateLine(l, "L02")).toEqual([]);
      // the module window row comes first: the title rows' parent (common.ts windowParentKey)
      expect(deriveId(all[0])).toBe("ui:ResourceManager/window/#ResourceManagerMain");
      expect(all[0].parent_key).toBeNull();
      const lines = all.slice(1);
      const title = lines[0];
      expect(title.parent_key).toEqual({
        dim: "ui",
        kind: "window",
        module: "ResourceManager",
        key: all[0].key,
      });
      expect(deriveId(title)).toBe("ui:ResourceManager/menu/File");
      expect(title.observed_state).toEqual({});
      expect(title.children_count).toBe(10);
      expect(lines).toHaveLength(11);
      const save = lines.find((l) => l.label_raw === "Save")!;
      expect(save.kind).toBe("menu-item");
      expect(save.shortcut_default).toBe("Ctrl+S");
      expect(lines.some((l) => l.kind === "menu-item" && l.confidence === "low")).toBe(true);
      const id = stepId("ResourceManager", "File", RM.state);
      const keys = [...r.files.keys()];
      expect(keys.some((k) => k.endsWith(`${id}.started`))).toBe(true);
      const rec = JSON.parse(r.files.get(keys.find((k) => k.endsWith(`${id}.json`))!)!);
      expect(rec.status).toBe("pass");
      expect(rec.artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(title.ref).toBe(`artifact:${rec.artifacts[0].sha256}#m/File`);
      const doc = JSON.parse(readFileSync(join(r.runDir, `${id}-menus.json`), "utf-8"));
      expect(doc.calls).toEqual([
        { call: "Expand", path: ["File"] },
        { call: "Collapse", path: ["File"] },
      ]);
      expect(doc.leftOpen).toEqual([]);
    });

    it("Window at depth 1: the sub-menu is expanded, read and collapsed; shortcut after a tab; checked and disabled noted", async () => {
      const r = await realRun(menusToolReader({}, tree()), [
        "--only",
        stepId("ResourceManager", "Window", RM.state),
      ]);
      expect(r.code).toBe(EXIT.done);
      const lines = obsLines(r.files).slice(1); // the window row first (see the File case)
      const ids = lines.map(deriveId);
      expect(ids).toEqual([
        "ui:ResourceManager/menu/Window",
        ids[1],
        "ui:ResourceManager/menu/Window/Recent",
        "ui:ResourceManager/menu-item/Window/Recent/Layout A",
        "ui:ResourceManager/menu-item/Window/Recent/Layout B",
        ids[5],
      ]);
      expect(lines[0].children_count).toBe(3);
      expect(lines[1].shortcut_default).toBe("Ctrl+L");
      expect(lines[1].label_raw).toBe("Log Console");
      expect(lines[2].children_count).toBe(2);
      expect(lines[4].unverified).toContain(CHECKED_NOTE);
      expect(lines[5].unverified).toContain(DISABLED_NOTE);
      const id = stepId("ResourceManager", "Window", RM.state);
      const doc = JSON.parse(readFileSync(join(r.runDir, `${id}-menus.json`), "utf-8"));
      expect(
        doc.calls.map((c: { call: string; path: string[] }) => `${c.call} ${c.path.join(">")}`),
      ).toEqual([
        "Expand Window",
        "Expand Window>Recent",
        "Collapse Window>Recent",
        "Collapse Window",
      ]);
    });

    it("every title runs in policy order; the obs file passes normalise and its --check", async () => {
      const r = await realRun(menusToolReader({}, tree()), [
        "--from",
        stepId("ResourceManager", "File", RM.state),
      ]);
      expect(r.code).toBe(EXIT.done);
      expect(r.said.slice(0, 8).map((l) => l.split(":")[0])).toEqual(
        RM_TITLES.map((t) => stepId("ResourceManager", t, RM.state)),
      );
      const lines = obsLines(r.files);
      expect(lines.filter((l) => l.parent_key?.kind === "window").map((l) => l.label_raw)).toEqual(
        RM_TITLES,
      );
      const raw = join(TMP, "raw");
      mkdirSync(raw, { recursive: true });
      writeFileSync(
        join(raw, "L02-ResourceManager-edit-none.obs.jsonl"),
        [...r.files.entries()].find(([k]) => k.endsWith(".obs.jsonl"))![1],
      );
      const data = join(TMP, "data");
      mkdirSync(data, { recursive: true });
      writeFileSync(join(data, "current-build.json"), JSON.stringify({ tag: "1.8.0.13" }));
      writeFileSync(
        join(data, "universes.json"),
        JSON.stringify({ enumerators: { L02: { generator: "scripts/census/live/L02-menus.ts" } } }),
      );
      const errs: string[] = [];
      const io = { out: () => undefined, err: (l: string) => errs.push(l) };
      expect(runNormalise(["--enumerator", "L02", "--data", data, raw], io)).toBe(0);
      expect(runNormalise(["--enumerator", "L02", "--data", data, "--check"], io)).toBe(0);
      expect(errs).toEqual([]);
    });

    it("a popup left open after Collapse: HANDOFF, nothing emitted, and the step is never run again", async () => {
      const stuck = tree((d) => {
        barOf(d)[0].stuck = true;
      });
      const files = new Map<string, string>();
      const runDir = join(TMP, "art", "stuck");
      const only = ["--only", stepId("ResourceManager", "File", RM.state)];
      const r = await realRun(menusToolReader({}, stuck), only, files, runDir);
      expect(r.code).toBe(EXIT.handoff);
      expect(obsLines(r.files)).toEqual([]);
      expect(r.said.join("\n")).toContain("Esc");
      const again = await realRun(menusToolReader({}, tree()), only, files, runDir);
      expect(again.code).toBe(EXIT.refused);
      expect(again.said.join("\n")).toContain("never run twice");
    });

    it("a new window that is not a popup: STOP, collapsed, nothing emitted", async () => {
      const opens = tree((d) => {
        barOf(d)[0].opensWindow = {
          hwnd: 777,
          pid: 4242,
          className: "SomethingElse",
          title: "Unexpected",
          owned: false,
        };
      });
      const r = await realRun(menusToolReader({}, opens), [
        "--only",
        stepId("ResourceManager", "File", RM.state),
      ]);
      expect(r.code).toBe(EXIT.stopped);
      expect(obsLines(r.files)).toEqual([]);
    });
  },
);

import { MODULE_TITLES as FIXH_TITLES } from "../../scripts/census/live/common.js";
import { MODULE_WINDOWS as FIXH_L02_WINDOWS } from "../../scripts/census/live/L02-menus.js";

describe("P4-FIX-H: L02 reads the one MODULE_TITLES table", () => {
  it("every titled module but ParticleEditor has a window with MODULE_TITLES' pattern", () => {
    for (const [m, t] of Object.entries(FIXH_TITLES)) {
      if (m === "ParticleEditor" || !FIXH_TITLES[m]) continue; // Launcher: L14, no module window
      expect(FIXH_L02_WINDOWS[m]?.title).toBe(t.pattern);
    }
    expect(FIXH_L02_WINDOWS.ParticleEditor).toBeUndefined();
  });

  it("every module the policy titles plans passing steps (ScriptEditor among them)", () => {
    const policy = loadPolicy() as unknown as {
      live_lane?: { uia_menu?: { titles_by_module?: Record<string, string[]> } };
    };
    const byModule = policy.live_lane?.uia_menu?.titles_by_module ?? {};
    expect(Object.keys(byModule)).toContain("ScriptEditor");
    for (const m of Object.keys(byModule)) {
      if (m === "ParticleEditor" || !FIXH_TITLES[m]) continue; // Launcher: L14, no module window
      const steps = l02Steps({ module: m, state: {} });
      expect(steps.length, m).toBeGreaterThan(0);
    }
  });
});

describe("P4-FIX-I: the AnimEditor menu rows name L01's window row", () => {
  it("parent object_name AnimEditor, the same key L01 gives Arma4WorkbenchApp.AnimEditor", () => {
    const doc = {
      target: { className: "Qt683QWindowIcon", title: "Animation Editor" },
      menus: [
        {
          title: "Edit",
          opened: true,
          collapsed: true,
          popup: {
            count: 1,
            automationIds: ["Arma4WorkbenchApp.AnimEditor.QMenuBar.QAction.QMenu"],
          },
          items: [{ name: "Undo\tCtrl+Z" }],
        },
      ],
    } as unknown as MenusDoc;
    const l01 = chooseKey(
      {
        automationId: "Arma4WorkbenchApp.AnimEditor",
        className: "AnimEditor",
        ancestorLabels: [],
        name: "Animation Editor",
        moduleWindow: true,
      },
      () => true,
    ).key;
    expect(l01).toEqual({ object_name: "AnimEditor" });
    const { lines } = menuLines(doc, { module: "AnimEditor", state: {}, sha: "0".repeat(64) });
    expect(lines[0].parent_key).toEqual({
      dim: "ui",
      kind: "window",
      module: "AnimEditor",
      key: l01,
    });
    expect(
      menusWindowLine(doc, { module: "AnimEditor", state: {}, sha: "0".repeat(64) })?.key,
    ).toEqual({ object_name: "AnimEditor" });
    expect(windowObjectName("AnimEditor", undefined)).toBe("AnimEditor");
  });
});
