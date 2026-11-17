import { afterAll, describe, expect, it } from "vitest";
import { ledgerSpec, resolveLocator } from "../../src/gui/locators.js";
import type { UiaNode } from "../../src/gui/uia.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  DISMISS_RULES,
  EXIT,
  buildWalkerQueue,
  deriveId,
  runWalker,
  runWalkerSteps,
  stateKey,
  validateLine,
  walkerPlan,
  type LiveObservation,
  type WalkerDeps,
} from "../../scripts/census/live/common.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  L01_BOUNDS,
  MODULE_WINDOWS,
  SCRIPT,
  def,
  foldLiveCounts,
  makeL01Def,
  moduleWindow,
  snapshotLines,
  stepId,
  type WalkDoc,
  type WalkKernel,
  type WalkNode,
} from "../../scripts/census/live/L01-snapshot.js";
import {
  DEFAULT_BOUNDS,
  REDACT_ENV,
  redactionTable,
  runWalk,
  walkerArgv,
} from "../../tools/uia/walk.js";

// Fixtures are redacted slices of two real walks (P3-3 gate 2 World Editor, S-F sf-26 Options);
// everything else here is synthetic. Planted personal data is assembled at test time.
const FIX = join(__dirname, "fixtures", "live");
const WE = JSON.parse(readFileSync(join(FIX, "L01-we-tree.json"), "utf-8")) as WalkDoc;
const OPTIONS = JSON.parse(readFileSync(join(FIX, "L01-options-tree.json"), "utf-8")) as WalkDoc;
const SHA = "c".repeat(64);
const EDIT_NONE = { mode: "edit" as const, selection: "none" as const };

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l01-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const snap = (doc: WalkDoc = WE, over: Partial<Parameters<typeof snapshotLines>[1]> = {}) =>
  snapshotLines(doc, { module: "WorldEditor", state: EDIT_NONE, sha256: SHA, ...over });

const byId = (lines: LiveObservation[]): Map<string, LiveObservation> =>
  new Map(lines.map((l) => [deriveId(l), l]));

const nodeAt = (doc: WalkDoc, path: string): WalkNode => {
  let n = doc.tree!;
  for (const i of path.split("/").slice(1)) n = n.children![Number(i)];
  return n;
};

// ── The plan ─────────────────────────────────────────────────────────────────

describe("L01 plan", () => {
  const sel = { module: "WorldEditor", state: EDIT_NONE, allowOwned: false };
  const steps = def.steps(sel);
  const plan = walkerPlan(steps, sel);

  it("is one read-only step holding one uia-read, checked against policy.json", () => {
    expect(steps.map((s) => s.id)).toEqual([stepId("WorldEditor", EDIT_NONE)]);
    expect(steps[0].id).toBe("p4-l01-snapshot-WorldEditor-edit-none");
    expect(steps[0].risk).toBe("read-only");
    expect(steps[0].side_effects).toEqual([]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      kind: "uia-read",
      readOnly: true,
      target: {
        pid: "lane-recorded",
        window: { className: "Qt683QWindowIcon", allowOwned: false },
      },
    });
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT })).toMatchObject({ ok: true });
  });

  it("holds no key, invoke, menu, execute-action, net-call, dialog or typed text", () => {
    const text = JSON.stringify(plan);
    for (const banned of [
      '"key"',
      '"keys"',
      "invoke",
      "menu-open",
      "uia-menu",
      "execute-action",
      "net-call",
      "Enter",
      '"dialog"',
      "screenshot",
    ])
      expect(text).not.toContain(banned);
    expect(new Set(plan.map((a) => a.kind))).toEqual(new Set(["uia-read"]));
  });

  it("keeps all nine bounds inside the policy caps and names the window by class and title", () => {
    const caps = loadPolicy().live_lane?.uia_read as Record<string, number>;
    const b = (plan[0] as unknown as { bounds: Record<string, number> }).bounds;
    expect(Object.keys(b).sort()).toEqual(Object.keys(caps).sort());
    for (const k of Object.keys(caps)) expect(b[k]).toBeLessThanOrEqual(caps[k]);
    expect(L01_BOUNDS.rowSample).toBe(DEFAULT_BOUNDS.rowSample);
    const win = (plan[0].target as unknown as { window: Record<string, unknown> }).window;
    expect(win.titlePattern).toBe("^World Editor( - .+)?$");
  });

  it("--allow-owned reaches the plan; the queue passes pre-flight and matches --emit-queue", async () => {
    const owned = def.steps({ ...sel, allowOwned: true });
    expect(JSON.stringify(walkerPlan(owned, { ...sel, allowOwned: true }))).toContain(
      '"allowOwned":true',
    );
    const q = join(TMP, "queue.json");
    const said: string[] = [];
    const code = await runWalker(def, ["--out", join(TMP, "plan.json"), "--emit-queue", q], {
      out: (l) => said.push(l),
    });
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain("PASS");
    const queue = JSON.parse(readFileSync(q, "utf-8"));
    expect(queue.session).toBe("P4-1");
    expect(validateQueue(queue, false)).toHaveLength(1);
    expect(buildWalkerQueue(def, steps)).toEqual(queue);
  });

  it("every module with a recorded window plans a passing read; Particle and unnamed modules refuse", () => {
    for (const module of Object.keys(MODULE_WINDOWS)) {
      const s = { module, state: {}, allowOwned: false };
      expect(checkPlan(walkerPlan(def.steps(s), s), loadPolicy(), { script: SCRIPT }).ok).toBe(
        true,
      );
    }
    expect(() => moduleWindow("ParticleEditor")).toThrow(/never read/);
    expect(() => def.steps({ module: "ParticleEditor", state: {}, allowOwned: false })).toThrow(
      /DEC-042/,
    );
    expect(() => moduleWindow("DialogueEditor")).toThrow(/no window title/);
    // P4-9: the sub-editors are read in the RM window with their tab active ([unverified] titles)
    expect(moduleWindow("ResourceManager.Config").unverified).toMatch(/not been seen live/);
    expect(Object.keys(MODULE_WINDOWS)).not.toContain("ParticleEditor");
  });

  it("the shipped script ids match universes.json", () => {
    expect(SCRIPT).toBe("scripts/census/live/L01-snapshot.ts");
    expect(def.enumerator).toBe("L01");
  });
});

// ── Node to row ──────────────────────────────────────────────────────────────

describe("L01 mapping: the World Editor slice", () => {
  const { lines, stats } = snap();
  const ids = byId(lines);

  it("every line is conformant for L01 and carries no walker-forbidden field", () => {
    for (const l of lines) expect(validateLine(l, "L01"), JSON.stringify(l.key)).toEqual([]);
    expect(stats.rows).toBe(lines.length);
    expect(lines.length).toBeGreaterThan(150);
  });

  it("ids are unique per state and every parent_key resolves to a line of the file", () => {
    const seen = new Set<string>();
    for (const l of lines) {
      const k = `${deriveId(l)}|${stateKey(l.observed_state)}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
    for (const l of lines) {
      if (l.parent_key === null) {
        expect(l.kind).toBe("window");
        continue;
      }
      const pid = deriveId({ ...l.parent_key, dim: "ui" } as LiveObservation);
      expect(ids.has(pid), pid).toBe(true);
    }
  });

  it("emits only L01's registered kinds, never property or menu-item", () => {
    const kinds = new Set(lines.map((l) => l.kind));
    expect(kinds).toEqual(
      new Set([
        "window",
        "menu",
        "toolbar",
        "toolbar-button",
        "dock",
        "panel",
        "tab",
        "control",
        "property-group",
        "region",
        "status-item",
      ]),
    );
  });

  it("names the module window, docks, strips, tabs, menus and toolbar buttons as D7 says", () => {
    expect(ids.has("ui:WorldEditor/window/#worldEditorMain")).toBe(true);
    expect(ids.get("ui:WorldEditor/window/#worldEditorMain")!.parent_key).toBeNull();
    for (const d of ["createDock", "currentToolDock", "entityTreeDock", "entityPropDock"])
      expect(ids.get(`ui:WorldEditor/dock/#${d}`)?.kind, d).toBe("dock");
    for (const m of [
      "File",
      "Edit",
      "View",
      "Game",
      "Tools",
      "Window",
      "Plugins",
      "Entities",
      "Help",
    ]) {
      const l = ids.get(`ui:WorldEditor/menu/${m}`)!;
      expect(l.locator?.menuPath, m).toEqual([m]);
      expect(l.children_count).toBeUndefined();
    }
    expect(ids.has("ui:WorldEditor/toolbar-button/toolBar/Undo")).toBe(true);
    expect(ids.has("ui:WorldEditor/toolbar-button/#play")).toBe(true);
    expect(ids.has("ui:WorldEditor/control/createDock/Close")).toBe(true);
    // The tab strip's name is the selected tab's: identity is the ordinal, the tabs hang under it.
    const strip = ids.get("ui:WorldEditor/panel/@QMainWindowTabBar.1")!;
    expect(strip.confidence).toBe("medium");
    expect(strip.label_raw).toBe("Object Properties");
    expect(strip.unverified).toEqual(["the strip name follows the selected tab; ordinal identity"]);
    // DEC-090: the tab is keyed by its name (the strip ordinal changes between launches); its
    // parent stays the strip of this walk.
    expect(ids.has("ui:WorldEditor/tab/@QMainWindowTabBar.1/Object Properties")).toBe(false);
    const tab = ids.get("ui:WorldEditor/tab/@QMainWindowTabBar/Object Properties")!;
    expect(tab.parent_key?.key).toEqual({ path: ["@QMainWindowTabBar.1"] });
    expect(tab.unverified).toContain(
      "dock tab keyed by its name: the strip ordinal changes between launches (DEC-090)",
    );
    // P4-FIX-J: tab strips are state-variable content: the tabs stay as rows, no count is claimed.
    expect(strip.children_count).toBeUndefined();
  });

  it("the status bar claims no children_count (state-variable items); its child rows stay (P4-FIX-J)", () => {
    const m = byId(snap().lines);
    const panel = m.get("ui:WorldEditor/panel/#statusBar")!;
    expect(panel).toBeDefined();
    expect(panel.children_count).toBeUndefined();
    const kids = [...m.values()].filter(
      (l) =>
        l.parent_key?.kind === "panel" && JSON.stringify(l.parent_key.key).includes("statusBar"),
    );
    expect(kids.length).toBeGreaterThan(0);
  });

  it("an unnamed node gets an ordinal key, low confidence and the note; a live counter is not an identity", () => {
    const l = ids.get(
      "ui:WorldEditor/control/createDock/createDockContents/createDockFilter/@QLineEditIconButton.1",
    )!;
    expect(l.confidence).toBe("low");
    expect(l.unverified).toEqual(["no accessible name; ordinal identity"]);
    expect(l.label).toBeUndefined();
    const counters = lines.filter((x) => x.label_raw && /^\d+$/.test(x.label_raw));
    expect(counters.length).toBeGreaterThan(0);
    for (const c of counters) {
      expect("path" in c.key && c.key.path.at(-1)!.startsWith("@")).toBe(true);
      expect(c.confidence).toBe("medium");
    }
  });

  it("a sampled data container emits its row only: no children_count, no items, a note", () => {
    const tree = ids.get("ui:WorldEditor/control/#createTree")!;
    expect(tree.children_count).toBeUndefined();
    expect(tree.unverified?.[0]).toMatch(/^sampled: 40 of 388 rows read/);
    expect(lines.some((l) => l.label_raw === "AILib" || l.label_raw === "SCR_Bird")).toBe(false);
    expect(stats.sampledContainers).toEqual(["0/4/0/0"]);
    // Rows of the project-data views are not interface either.
    const hier = ids.get("ui:WorldEditor/control/#entityTree")!;
    expect(hier.children_count).toBeUndefined();
    expect(hier.unverified?.[0]).toMatch(/project data/);
    expect(lines.some((l) => l.label_raw === "unnamed" || l.label_raw === "default")).toBe(false);
    expect(stats.dataItemsSkipped).toBeGreaterThan(20);
  });

  it("a Text beside an editable folds into that control's label_raw and is no row", () => {
    const x = ids.get("ui:WorldEditor/control/#snapToGridXEdit")!;
    expect(x.label_raw).toBe("X");
    expect(x.label).toBe("X");
    expect(lines.some((l) => l.locator?.automationId?.endsWith("snapToGridXLabel"))).toBe(false);
    expect(stats.folded).toBeGreaterThan(5);
    // A Text with nothing to label is a dismissed text-label line, with no label at all.
    const lone = ids.get("ui:WorldEditor/region/#PointSnappingText")!;
    expect(lone).toMatchObject({
      control_type: "Text",
      dismissed_by: "text-label",
      kind: "region",
    });
    expect(lone.label_raw).toBeUndefined();
  });

  it("dismissed nodes carry control_type and a rule common.ts names; the System menu is never walked", () => {
    const dismissed = lines.filter((l) => l.dismissed_by !== undefined);
    expect(dismissed.length).toBe(stats.dismissed);
    const rules = new Map(DISMISS_RULES.map((r) => [r.id, r.controlType]));
    for (const l of dismissed) {
      expect(l.kind).toBe("region");
      expect(rules.has(l.dismissed_by!), l.dismissed_by).toBe(true);
      expect(l.control_type).toBeTruthy();
      expect(l.label_raw).toBeUndefined();
    }
    const sys = ids.get("ui:WorldEditor/region/#SystemMenuBar")!;
    expect(sys.dismissed_by).toBe("system-menu");
    expect(
      lines.some((l) => l.locator?.controlType === "MenuItem" && l.label_raw === "System"),
    ).toBe(false);
    // Chrome buttons of the title bar are controls, parented on the dismissed TitleBar line.
    expect(ids.get("ui:WorldEditor/control/Close")!.parent_key).toMatchObject({ kind: "region" });
  });

  it("state axes follow state-matrix.json: mode on menus and toolbars, nothing on docks and buttons", () => {
    expect(ids.get("ui:WorldEditor/menu/File")!.observed_state).toEqual({ mode: "edit" });
    expect(ids.get("ui:WorldEditor/toolbar/#toolBar")!.observed_state).toEqual({ mode: "edit" });
    expect(ids.get("ui:WorldEditor/dock/#createDock")!.observed_state).toEqual({});
    expect(ids.get("ui:WorldEditor/toolbar-button/#play")!.observed_state).toEqual({});
    expect(
      snap(WE, { state: {} }).lines.every((l) => Object.keys(l.observed_state).length === 0),
    ).toBe(true);
    const withTerrain = snap(WE, { state: { mode: "edit", world_type: "with-terrain" } }).lines;
    expect(withTerrain.find((l) => l.kind === "panel")!.observed_state).toEqual({
      world_type: "with-terrain",
    });
  });

  it("children_count is claimed only where the file emits exactly that many child rows in that state", () => {
    const claimed = lines.filter((l) => l.children_count !== undefined);
    expect(claimed.length).toBe(stats.childrenCounted);
    expect(claimed.length).toBeGreaterThan(10);
    for (const l of claimed) {
      const id = deriveId(l);
      const kids = lines.filter(
        (k) =>
          k.parent_key &&
          deriveId({ ...k.parent_key, dim: "ui" } as LiveObservation) === id &&
          stateKey(k.observed_state) === stateKey(l.observed_state),
      );
      expect(kids.length, id).toBe(l.children_count);
    }
    // Leaf kinds never claim one, nor does a row whose child state differs (toolbar: mode vs none).
    expect(
      claimed.some((l) => ["control", "region", "menu-item", "toolbar-button"].includes(l.kind)),
    ).toBe(false);
    expect(ids.get("ui:WorldEditor/toolbar/#toolBar")!.children_count).toBeUndefined();
    expect(ids.get("ui:WorldEditor/dock/#createDock")!.children_count).toBe(3);
    // With no mode axis in play the toolbar counts all its children.
    const flat = byId(snap(WE, { state: {} }).lines);
    expect(flat.get("ui:WorldEditor/toolbar/#toolBar")!.children_count).toBe(
      nodeAt(WE, "0/7").children!.length,
    );
  });

  it("every ref cites the walk's sha and a tree path that is the node the line describes", () => {
    for (const l of lines) {
      const m = /^artifact:([0-9a-f]{64})#n\/(0(?:\/\d+)*)$/.exec(l.ref);
      expect(m, l.ref).not.toBeNull();
      expect(m![1]).toBe(SHA);
      const n = nodeAt(WE, m![2]);
      expect(n.controlType, l.ref).toBe(l.locator!.controlType);
      expect(n.automationId || undefined, l.ref).toBe(l.locator!.automationId);
    }
  });

  it("raises no credential flag on the World Editor", () => {
    expect(lines.some((l) => l.risk_hint !== undefined)).toBe(false);
  });
});

describe("L01 mapping: the Options dialog (owned window)", () => {
  const { lines, stats } = snapshotLines(OPTIONS, {
    module: "Shared",
    state: {},
    sha256: SHA,
    allowOwned: true,
  });
  const ids = byId(lines);

  it("reproduces the design's worked ids: dialog Options, tab Options/Shortcuts, button Options/OK", () => {
    for (const l of lines) expect(validateLine(l, "L01"), JSON.stringify(l.key)).toEqual([]);
    expect(ids.get("ui:Shared/dialog/Options")).toMatchObject({ kind: "dialog", parent_key: null });
    const tab = ids.get("ui:Shared/tab/Options/Shortcuts")!;
    expect(tab.parent_key).toMatchObject({ kind: "dialog", key: { path: ["Options"] } });
    expect(tab.ref).toBe(`artifact:${SHA}#n/0/1/6`);
    expect(tab.locator?.controlType).toBe("ListItem");
    expect(ids.get("ui:Shared/control/Options/OK")!.parent_key).toMatchObject({ kind: "dialog" });
    expect(lines.filter((l) => l.kind === "tab")).toHaveLength(7);
  });

  it("the page list is no row; the Shortcuts grid is a property-group with category rows only", () => {
    expect(lines.some((l) => l.locator?.controlType === "List")).toBe(false);
    const grid = lines.find((l) => l.locator?.controlType === "Tree")!;
    expect(grid.kind).toBe("property-group");
    expect(grid.children_count).toBeUndefined();
    expect(grid.unverified?.join(" ")).toMatch(/sampled: 19 of 392/);
    expect(lines.filter((l) => l.kind === "property-group").map((l) => l.label_raw)).toEqual([
      undefined,
      "Camera",
      "Common",
    ]);
    expect(stats.outOfScope).toBeGreaterThan(10);
    expect(lines.some((l) => l.label_raw === "Move Forward")).toBe(false);
  });
});

describe("L01 mapping: edges", () => {
  const node = (over: Partial<WalkNode>): WalkNode => ({ controlType: "Group", ...over });
  const win = (...children: WalkNode[]): WalkDoc => ({
    tree: node({
      controlType: "Window",
      name: "World Editor - x",
      automationId: "A.worldEditorMain",
      className: "WorldEditorQt",
      children,
    }),
  });

  it("a truncated or failed child list suppresses children_count and is noted", () => {
    const doc = win(
      node({
        controlType: "Window",
        className: "QDockWidget",
        name: "Dock",
        automationId: "A.worldEditorMain.aDock",
        truncated: "budget",
        children: [
          node({ controlType: "Button", name: "Go", automationId: "A.worldEditorMain.aDock.go" }),
        ],
      }),
    );
    const { lines } = snapshotLines(doc, { module: "WorldEditor", state: {}, sha256: SHA });
    const dock = lines.find((l) => l.kind === "dock")!;
    expect(dock.children_count).toBeUndefined();
    expect(dock.unverified?.[0]).toMatch(/incomplete/);
  });

  it("DEC-088: a parenthesised count is folded out of the key, the label keeps it (run 8 Model toolbox)", () => {
    const tb = (name: string): WalkNode => ({
      controlType: "Button",
      name,
      automationId: "A.worldEditorMain.MeshDetailsWidget.qt_toolbox_toolboxbutton",
      className: "QToolBoxButton",
    });
    const { lines } = snapshotLines(
      win(tb("Colliders (2)"), tb("LODs (6)"), tb("BSP (0) / Portals (0)"), tb("Bones (0 + 0)")),
      { module: "WorldEditor", state: {}, sha256: SHA },
    );
    const ids = lines.filter((l) => l.kind === "control").map((l) => deriveId(l));
    expect(ids).toEqual([
      "ui:WorldEditor/control/Colliders",
      "ui:WorldEditor/control/LODs",
      "ui:WorldEditor/control/BSP %2F Portals",
      "ui:WorldEditor/control/Bones",
    ]);
    const colliders = lines.find((l) => l.label_raw === "Colliders (2)")!;
    expect(colliders.label).toBe("Colliders (2)");
    expect(colliders.unverified).toContain(
      "the parenthesised count in the name is live data; the key omits it",
    );
    // The P4-9 walk of another .xob gives the same ids.
    const other = snapshotLines(win(tb("Colliders (0)"), tb("LODs (1)")), {
      module: "WorldEditor",
      state: {},
      sha256: SHA,
    }).lines.map((l) => deriveId(l));
    expect(other).toContain("ui:WorldEditor/control/Colliders");
    expect(other).toContain("ui:WorldEditor/control/LODs");
    // A name that is only a count is still a live counter (ordinal identity), not folded to "".
    expect(foldLiveCounts("(3)")).toBe("(3)");
  });

  it("DEC-084 option B: a folded label keeps the element's own UIA name on the locator (run 4 and run 8 rows)", () => {
    // Run 4 (World Editor, 1ebba286 n/0/6/0/0/0/0): the snap edits carry the group box's name.
    const group: WalkNode = {
      controlType: "CheckBox",
      className: "QGroupBox",
      name: "Snap to grid",
      automationId: "A.worldEditorMain.EntityMoveToolPanel.snapToGridGroupBox",
      children: [
        {
          controlType: "Text",
          className: "QLabel",
          name: "X",
          automationId: "A.worldEditorMain.EntityMoveToolPanel.snapToGridGroupBox.snapToGridXLabel",
        },
        {
          controlType: "Edit",
          className: "QLineEdit",
          name: "Snap to grid",
          automationId: "A.worldEditorMain.EntityMoveToolPanel.snapToGridGroupBox.snapToGridXEdit",
        },
      ],
    };
    // Run 8 (Font tab, 3d654a72 n/0/5/0/0/0/0/1/0/0): "Size:" folds onto the "Bold" check box,
    // "Offset:" onto an unnamed edit.
    const toolbar: WalkNode = {
      controlType: "ToolBar",
      className: "QToolBar",
      name: "",
      automationId: "A.worldEditorMain.FontPreviewWidget.QToolBar",
      children: [
        { controlType: "Text", className: "QLabel", name: "Size: ", automationId: "A.worldEditorMain.FontPreviewWidget.QToolBar.QLabel" },
        { controlType: "CheckBox", className: "QCheckBox", name: "Bold", automationId: "A.worldEditorMain.FontPreviewWidget.QToolBar.QCheckBox" },
        { controlType: "Text", className: "QLabel", name: "Offset: ", automationId: "A.worldEditorMain.FontPreviewWidget.QToolBar.QLabel" },
        { controlType: "Edit", className: "QLineEdit", name: "", automationId: "A.worldEditorMain.FontPreviewWidget.QToolBar.QLineEdit" },
      ],
    };
    const { lines } = snapshotLines(win(group, toolbar), {
      module: "WorldEditor",
      state: {},
      sha256: SHA,
    });
    const x = lines.find((l) => l.label === "X")!;
    expect(x.locator?.uiaName).toBe("Snap to grid");
    expect(lines.find((l) => l.label === "Size:")!.locator?.uiaName).toBe("Bold");
    expect(lines.find((l) => l.label === "Offset:")!.locator?.uiaName).toBe("");
    // A row with its own name keeps no uiaName.
    expect(lines.find((l) => l.label === "Snap to grid")!.locator?.uiaName).toBeUndefined();
    for (const l of lines) expect(validateLine(l, "L01")).toEqual([]);
  });

  it("two siblings with one label stay unique, the later one noted", () => {
    const btn = (): WalkNode => ({
      controlType: "Button",
      name: "Same",
      automationId: "A.worldEditorMain.QPushButton",
      className: "QPushButton",
    });
    const { lines } = snapshotLines(win(btn(), btn()), {
      module: "WorldEditor",
      state: {},
      sha256: SHA,
    });
    const same = lines.filter((l) => l.label_raw === "Same");
    expect(same).toHaveLength(2);
    expect(new Set(same.map((l) => deriveId(l))).size).toBe(2);
    expect(same.find((l) => l.confidence === "low")!.unverified).toContain(
      "a sibling shares this label; ordinal disambiguated",
    );
  });

  it("a credential-looking control is flagged from the walk, never touched", () => {
    const { lines } = snapshotLines(
      win({
        controlType: "Edit",
        name: "Password",
        automationId: "A.worldEditorMain.loginPassword",
        className: "QLineEdit",
      }),
      { module: "WorldEditor", state: {}, sha256: SHA },
    );
    expect(lines.find((l) => l.kind === "control")!.risk_hint).toBe("credential");
  });

  it("a document with no tree is an error, not an empty file", () => {
    expect(() => snapshotLines({}, { module: "WorldEditor", state: {}, sha256: SHA })).toThrow(
      /no tree/,
    );
  });
});

// ── The step on a fake kernel and fake windows ──────────────────────────────

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

interface Fx {
  files: Map<string, string>;
  order: string[];
  deps: WalkerDeps;
}

function fx(windows: () => WindowInfo[] = () => []): Fx {
  const files = new Map<string, string>();
  const order: string[] = [];
  const deps: WalkerDeps = {
    windows: async () => windows(),
    // A real macrotask turn: the window poller must not starve the fake kernel's timers and the
    // python child's I/O (a microtask-only sleep spins forever).
    sleep: () => new Promise((r) => setTimeout(r, 2)),
    now: () => 1_760_000_000_000,
    recordedPid: () => 4242,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => order.push("heartbeat"),
    exists: (p) => files.has(p),
    writeFile: (p, t, exclusive) => {
      if (exclusive && files.has(p)) throw new Error("exists");
      files.set(p, t);
      order.push(`write ${p.replace(/\\/g, "/").split("/").pop()}`);
    },
    appendFile: (p, t) => {
      files.set(p, (files.get(p) ?? "") + t);
      order.push(`append ${p.replace(/\\/g, "/").split("/").pop()}`);
    },
    log: () => undefined,
  };
  return { files, order, deps };
}

const stepOpts = (runDir: string, over: Record<string, unknown> = {}) => ({
  enumerator: "L01",
  script: SCRIPT,
  session: "P4-1",
  runDir,
  module: "WorldEditor",
  state: EDIT_NONE,
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
  ...over,
});

function fakeKernel(doc: unknown, log: string[] = []): WalkKernel {
  return async (req) => {
    log.push(`kernel pid=${req.pid} class=${req.className} owned=${req.allowOwned}`);
    const text = JSON.stringify(doc);
    return {
      summary: { sha256: createHash("sha256").update(text).digest("hex"), reason: null } as never,
      text,
      stderr: "",
    };
  };
}

const sel = { module: "WorldEditor", state: EDIT_NONE, allowOwned: false };

describe("L01 step on fakes", () => {
  it("writes the started marker before the walk, then the obs lines, then the record", async () => {
    const f = fx();
    const calls: string[] = [];
    const d = makeL01Def(fakeKernel(WE, calls));
    const r = await runWalkerSteps(d.steps(sel), f.deps, stepOpts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(calls).toEqual(["kernel pid=4242 class=Qt683QWindowIcon owned=false"]);
    const id = stepId("WorldEditor", EDIT_NONE);
    const w = f.order.filter((x) => x.startsWith("write") || x.startsWith("append"));
    expect(w[0]).toBe(`write ${id}.started`);
    expect(w.indexOf(`write ${id}.started`)).toBeLessThan(
      w.findIndex((x) => x.startsWith("append")),
    );
    expect(w.at(-1)).toBe(`write ${id}.json`);
    expect(f.order[0]).toBe("heartbeat");
    const rec = JSON.parse([...f.files].find(([k]) => k.endsWith(`${id}.json`))![1]);
    expect(rec).toMatchObject({ status: "pass", cut: false, windowsAdded: [] });
    expect(rec.summary).toMatch(/\d+ nodes -> \d+ rows/);
    expect(rec.artifacts).toHaveLength(1);
    expect(rec.artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.artifacts[0].path.replace(/\\/g, "/")).toMatch(
      /\/run\/L01-WorldEditor-edit-none-walk\.json$/,
    );
  });

  it("the raw obs file passes validateLine line by line and the NORMALISER's merge and --check", () => {
    const f = fx();
    const d = makeL01Def(fakeKernel(WE));
    return runWalkerSteps(d.steps(sel), f.deps, stepOpts(join(TMP, "run1"))).then(() => {
      const [obsPath, text] = [...f.files].find(([k]) => k.endsWith(".obs.jsonl"))!;
      expect(obsPath.replace(/\\/g, "/")).toMatch(/L01-WorldEditor-edit-none\.obs\.jsonl$/);
      const rows = text
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(rows.length).toBe(snap().lines.length);
      for (const row of rows) expect(validateLine(row, "L01")).toEqual([]);
      const data = join(TMP, "data");
      mkdirSync(join(TMP, "run1"), { recursive: true });
      mkdirSync(data, { recursive: true });
      writeFileSync(join(data, "current-build.json"), JSON.stringify({ tag: "1.8.0.13" }));
      writeFileSync(
        join(data, "universes.json"),
        JSON.stringify({ enumerators: { L01: { generator: SCRIPT } } }),
      );
      writeFileSync(join(TMP, "run1", "L01-WorldEditor-edit-none.obs.jsonl"), text);
      const io = { out: () => undefined, err: () => undefined };
      expect(runNormalise(["--enumerator", "L01", "--data", data, join(TMP, "run1")], io)).toBe(0);
      expect(runNormalise(["--enumerator", "L01", "--data", data, "--check"], io)).toBe(0);
      expect(
        runNormalise(["--enumerator", "L01", "--data", data, "--check", join(TMP, "run1")], io),
      ).toBe(0);
    });
  });

  it("redacts a planted home path from a name before it reaches the obs file", async () => {
    const home = ["T:", "Users", ["zz", "planted"].join("")].join("\\");
    const doc: WalkDoc = JSON.parse(JSON.stringify(WE));
    nodeAt(doc, "0/7/0").name = `Open ${home}\\worlds\\a.ent`;
    const f = fx();
    const d = makeL01Def(fakeKernel(doc));
    await runWalkerSteps(d.steps(sel), f.deps, stepOpts("/run", { ph: { userProfile: home } }));
    const text = [...f.files].find(([k]) => k.endsWith(".obs.jsonl"))![1];
    expect(text).not.toContain("planted");
    expect(text).toContain("%USERPROFILE%");
  });

  it("a stray window during the walk is a STOP: no line written, the step is never run again", async () => {
    let n = 0;
    const slow: WalkKernel = async (req) => {
      await new Promise((r) => setTimeout(r, 5));
      return fakeKernel(WE)(req);
    };
    const f = fx(() => (n++ > 0 ? [win("Mystery", 9)] : []));
    const d = makeL01Def(slow);
    const r = await runWalkerSteps(d.steps(sel), f.deps, stepOpts("/run"));
    expect(r.exit).toBe(EXIT.stopped);
    expect([...f.files.keys()].some((k) => k.endsWith(".obs.jsonl"))).toBe(false);
    const again = await runWalkerSteps(d.steps(sel), f.deps, stepOpts("/run"));
    expect(again.exit).toBe(EXIT.refused);
  });

  it("a dialog-like window up before or during the step is a HANDOFF and nothing is walked", async () => {
    const calls: string[] = [];
    const before = fx(() => [win("Options", 9, "Qt683QWindowIcon", 3)]);
    const d = makeL01Def(fakeKernel(WE, calls));
    expect((await runWalkerSteps(d.steps(sel), before.deps, stepOpts("/a"))).exit).toBe(
      EXIT.handoff,
    );
    expect(calls).toEqual([]);
    let n = 0;
    const during = fx(() =>
      n++ > 0 ? [win("Script Authorization Required", 9, "#32770", 3)] : [],
    );
    const slow: WalkKernel = async (req) => {
      await new Promise((r) => setTimeout(r, 5));
      return fakeKernel(WE)(req);
    };
    const r = await runWalkerSteps(makeL01Def(slow).steps(sel), during.deps, stepOpts("/b"));
    expect(r.exit).toBe(EXIT.handoff);
  });

  it("a refused target, a missing document or a non-Workbench pid stops the run", async () => {
    const refused = await runWalkerSteps(
      makeL01Def(fakeKernel({ refused: true, reason: "2 windows match" })).steps(sel),
      fx().deps,
      stepOpts("/r1"),
    );
    expect(refused.exit).toBe(EXIT.stopped);
    expect(refused.message).toMatch(/2 windows match/);
    const none: WalkKernel = async () => ({
      summary: { reason: "walker timed out and was killed" } as never,
      text: null,
      stderr: "",
    });
    const timeout = await runWalkerSteps(makeL01Def(none).steps(sel), fx().deps, stepOpts("/r2"));
    expect(timeout.exit).toBe(EXIT.stopped);
    expect(timeout.message).toMatch(/timed out/);
    const f = fx();
    f.deps.processImage = () => "notepad.exe";
    expect(
      (await runWalkerSteps(makeL01Def(fakeKernel(WE)).steps(sel), f.deps, stepOpts("/r3"))).exit,
    ).toBe(EXIT.stopped);
  });

  it("a partial walk is recorded as observed, not pass, and its lines still validate", async () => {
    const f = fx();
    const partial: WalkDoc = { ...WE, completed: false, partial: true, stop_reason: "budget" };
    const r = await runWalkerSteps(
      makeL01Def(fakeKernel(partial)).steps(sel),
      f.deps,
      stepOpts("/p"),
    );
    expect(r.records[0].status).toBe("observed");
    expect(r.records[0].summary).toMatch(/INCOMPLETE walk \(budget\)/);
  });

  it("--allow-owned reaches the kernel", async () => {
    const calls: string[] = [];
    const s = { ...sel, allowOwned: true };
    await runWalkerSteps(
      makeL01Def(fakeKernel(WE, calls)).steps(s),
      fx().deps,
      stepOpts("/o", { allowOwned: true }),
    );
    expect(calls[0]).toContain("owned=true");
  });
});

// ── The real walker.py on a fake tree (golden run) ──────────────────────────

const PY = process.env.ENFUSION_PYTHON || "python";
const HAS_PYTHON = spawnSync(PY, ["--version"], { encoding: "utf-8" }).status === 0;

/** The fixture as tools/uia/fake_provider.py reads it; the sampled container becomes `generate`. */
function fakeTreeOf(doc: WalkDoc): unknown {
  const conv = (n: WalkNode): Record<string, unknown> => {
    const { children, childCount, childCountAtLeast, sampled, ...rest } = n;
    void childCount;
    void childCountAtLeast;
    if (sampled)
      return {
        ...rest,
        generate: {
          count: childCount ?? 48,
          controlType: "TreeItem",
          namePrefix: "Row ",
          patterns: ["Invoke", "Value", "SelectionItem"],
        },
      };
    return { ...rest, children: (children ?? []).map(conv) };
  };
  return {
    windows: [
      {
        hwnd: 101,
        pid: 4242,
        className: "Qt683QWindowIcon",
        title: "World Editor - Unnamed empty world",
        visible: true,
        owned: false,
        tree: conv(doc.tree!),
      },
    ],
  };
}

describe.skipIf(!HAS_PYTHON)("L01 golden: walker.py on a fake tree", () => {
  it("the step reads the walk file walker.py wrote and emits conformant lines", async () => {
    const treePath = join(TMP, "fake-tree.json");
    writeFileSync(treePath, JSON.stringify(fakeTreeOf(WE)));
    const kernel: WalkKernel = async (req) => {
      const ph = { ...req.ph };
      return runWalk({
        argv: walkerArgv({
          provider: "fake",
          fakeTree: treePath,
          target: {
            pid: req.pid,
            className: req.className,
            titlePattern: req.titlePattern,
            allowOwned: req.allowOwned,
          },
          bounds: req.bounds,
          view: "raw",
        }),
        env: { [REDACT_ENV]: JSON.stringify(redactionTable(ph, undefined, process.env)) },
        timeoutMs: 60_000,
        outPath: req.outPath,
        ctx: ph,
        table: redactionTable(ph, undefined, process.env),
      });
    };
    const f = fx();
    const run = join(TMP, "golden-run");
    const r = await runWalkerSteps(makeL01Def(kernel).steps(sel), f.deps, stepOpts(run));
    expect(r.records[0].summary).toBeTruthy();
    expect(r.exit, r.message ?? "").toBe(EXIT.done);
    expect(r.records[0].status).toBe("pass");
    const walkFile = join(run, "L01-WorldEditor-edit-none-walk.json");
    const raw = readFileSync(walkFile, "utf-8");
    const sha = createHash("sha256").update(raw, "utf-8").digest("hex");
    expect(r.records[0].artifacts[0].sha256).toBe(sha);
    const text = [...f.files].find(([k]) => k.endsWith(".obs.jsonl"))![1];
    const rows = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as LiveObservation);
    for (const row of rows) {
      expect(validateLine(row, "L01")).toEqual([]);
      expect(row.ref).toContain(sha);
    }
    const ids = byId(rows);
    // The walker sampled the generated tree: 40 of 48 read, rows of it are not lines.
    expect(ids.get("ui:WorldEditor/control/#createTree")!.unverified?.[0]).toMatch(
      /^sampled: 40 of 388/,
    );
    expect(rows.some((l) => /^Row \d+$/.test(l.label_raw ?? ""))).toBe(false);
    expect(ids.has("ui:WorldEditor/menu/File")).toBe(true);
    expect(ids.get("ui:WorldEditor/dock/#createDock")!.children_count).toBe(3);
    // The same document through the pure mapper gives the same ids as the fixture itself.
    const direct = byId(
      snapshotLines(JSON.parse(raw), { module: "WorldEditor", state: EDIT_NONE, sha256: sha })
        .lines,
    );
    expect([...direct.keys()].sort()).toEqual([...ids.keys()].sort());
  });
});

import { MODULE_TITLES as FIXH_TITLES } from "../../scripts/census/live/common.js";
import { MODULE_WINDOWS as FIXH_L01_WINDOWS } from "../../scripts/census/live/L01-snapshot.js";

describe("P4-FIX-H: L01 reads the one MODULE_TITLES table", () => {
  it("every module window's title is MODULE_TITLES' pattern, Navmesh included", () => {
    const expected = Object.keys(FIXH_TITLES).filter((m) => m !== "ParticleEditor");
    expect(Object.keys(FIXH_L01_WINDOWS).sort()).toEqual(expected.sort());
    for (const m of expected) expect(FIXH_L01_WINDOWS[m].titlePattern).toBe(FIXH_TITLES[m].pattern);
    expect(FIXH_L01_WINDOWS.NavmeshGeneratorMain.titlePattern).toBe("^Arma Reforger Workbench$");
    expect(
      new RegExp(FIXH_L01_WINDOWS.NavmeshGeneratorMain.titlePattern).test(
        "Arma Reforger Workbench",
      ),
    ).toBe(true);
  });
});

describe("DEC-078: L01 emits the locator ordinal from the walk", () => {
  const { lines } = snap();
  const STATUS = "Arma4WorkbenchApp.worldEditorMain.statusBar.QLabel";

  it("a locator whose id and type several elements share carries its document-order index; unique ones carry none", () => {
    const shared = lines.filter((l) => l.locator?.automationId === STATUS);
    expect(shared.length).toBeGreaterThan(1);
    const ords = shared.map((l) => l.locator?.ordinal);
    expect(ords.every((o) => typeof o === "number")).toBe(true);
    expect(new Set(ords).size).toBe(ords.length);
    const unique = lines.find(
      (l) => l.locator?.automationId === "Arma4WorkbenchApp.worldEditorMain.entityTreeDock",
    );
    expect(unique?.locator).toBeDefined();
    expect(unique?.locator?.ordinal).toBeUndefined();
    for (const l of lines) expect(validateLine(l, "L01"), JSON.stringify(l.key)).toEqual([]);
  });

  it("every emitted locator with an id resolves to the very element its ref names (the ordinal is the walk's, not the key's @Class.n)", () => {
    const tree = WE.tree as unknown as UiaNode;
    let checked = 0;
    let withOrdinal = 0;
    for (const l of lines) {
      if (!l.locator?.automationId || l.locator.menuPath) continue;
      const spec = ledgerSpec({
        id: deriveId(l),
        module: l.module,
        kind: l.kind,
        label: l.label ?? null,
        risk: null,
        locator: { build: "1.9.0.37", ...l.locator },
      });
      const r = resolveLocator(tree, spec!);
      const at = l.ref.split("#n/")[1];
      if (l.locator.ordinal !== undefined) withOrdinal++;
      // Without an ordinal a unique id resolves; with one, it picks the walked element.
      if (r.ok) {
        expect(r.hit?.path, JSON.stringify(l.key)).toBe(at);
        checked++;
      } else {
        // only ambiguity the census name used to settle may remain (no ordinal, several names)
        expect(l.locator.ordinal, JSON.stringify(l.key)).toBeUndefined();
      }
    }
    expect(withOrdinal).toBeGreaterThan(5);
    expect(checked).toBeGreaterThan(50);
    // A key's @Class.n suffix is 1-based among rows only; the ordinal counts every element of the
    // walk with the id and type, so the two need not agree.
    const sep = lines.filter((l) => l.locator?.automationId?.endsWith("toolBar.QToolBarSeparator"));
    for (const l of sep) expect(l.locator?.ordinal).toBeDefined();
  });
});
