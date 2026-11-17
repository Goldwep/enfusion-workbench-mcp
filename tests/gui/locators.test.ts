import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  carryLocators,
  censusMismatch,
  censusName,
  countFoldedId,
  dockTabStableId,
  ledgerSpec,
  loadLocatorRecords,
  locatorFilePath,
  locatorOrdinals,
  parseCensusRows,
  parseLocatorFile,
  readCurrentBuild,
  resolveLocator,
  resolvePath,
  serializeLocatorFile,
  validateLocatorRecord,
  type CensusRowLite,
  type LocatorRecord,
} from "../../src/gui/locators.js";
import { memoryIo } from "../../scripts/census/cli-common.js";
import { run as carryRun } from "../../scripts/census/locators-carry.js";
import { node } from "./fake-runner.js";

const BUILD = "1.9.0.37";
const REC: LocatorRecord = {
  rowId: "ui:WorldEditor/control/#log",
  build: BUILD,
  module: "WorldEditor",
  window: { className: "Qt683QWindowIcon", titlePattern: "World Editor.*" },
  automationId: "dock.log",
  name: "Log Console",
  controlType: "CheckBox",
  probe: "P-W8-02",
  evidence: "EV-W8-001",
};
const ROW: CensusRowLite = {
  id: REC.rowId,
  module: "WorldEditor",
  kind: "control",
  label: "Log Console",
  risk: "mutating",
  locator: {
    build: "1.8.0.13",
    automationId: "dock.log",
    controlType: "CheckBox",
    windowClass: "Qt683QWindowIcon",
  },
};

const TREE = node({
  controlType: "Window",
  name: "World Editor",
  children: [
    node({
      controlType: "MenuBar",
      name: "Menu",
      children: [
        node({ controlType: "MenuItem", name: "Edit" }),
        node({ controlType: "MenuItem", name: "View" }),
      ],
    }),
    node({
      controlType: "Pane",
      name: "Hierarchy",
      className: "QDockWidget",
      children: [
        node({ controlType: "CheckBox", name: "Log Console", automationId: "dock.log" }),
        node({ controlType: "Button", name: "A", automationId: "dup" }),
        node({ controlType: "Button", name: "B", automationId: "dup" }),
        node({ controlType: "Button", name: "", className: "QPushButton" }),
        node({ controlType: "Button", name: "", className: "QPushButton" }),
      ],
    }),
    node({ controlType: "TabItem", name: "Hierarchy" }),
  ],
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "w8loc-"));
  dirs.push(d);
  return d;
}

describe("the record format", () => {
  it("accepts a well-formed record; refuses each missing or wrong field", () => {
    expect(validateLocatorRecord(REC)).toBeNull();
    expect(validateLocatorRecord({ ...REC, probe: "P-W8-01" })).toMatch(/probe/);
    expect(validateLocatorRecord({ ...REC, evidence: "x" })).toMatch(/EV-/);
    expect(validateLocatorRecord({ ...REC, path: ["A"] })).toMatch(/exactly one/);
    const { automationId: _a, ...noId } = REC;
    void _a;
    expect(validateLocatorRecord(noId)).toMatch(/exactly one/);
    expect(
      validateLocatorRecord({ ...REC, window: { className: "X", titlePattern: "(" } }),
    ).toMatch(/compile/);
    expect(validateLocatorRecord({ ...REC, controlType: "" })).toMatch(/controlType/);
  });
  it("serializes sorted with a fixed key order and parses back", () => {
    const b = { ...REC, rowId: "ui:A", evidence: "EV-W8-002" };
    const text = serializeLocatorFile([REC, b]);
    expect(text.split("\n")[0]).toContain('"rowId":"ui:A"');
    expect(Object.keys(JSON.parse(text.split("\n")[0]))[0]).toBe("rowId");
    const p = parseLocatorFile(text, BUILD);
    expect(p.errors).toEqual([]);
    expect([...p.records.keys()]).toEqual(["ui:A", REC.rowId]);
  });
  it("a hand-edited file is refused: another build, a duplicate, a bad line", () => {
    const line = JSON.stringify(REC);
    const p = parseLocatorFile(
      [line, line, JSON.stringify({ ...REC, rowId: "ui:x", build: "1.8.0.13" }), "{"].join("\n"),
      BUILD,
    );
    expect(p.errors).toEqual([
      "line 2: duplicate row ui:WorldEditor/control/#log",
      "line 3: build 1.8.0.13 in the 1.9.0.37 file",
      "line 4: not JSON",
    ]);
  });
  it("loads the build file from the census folder; absent is empty; malformed throws", () => {
    const root = tmp();
    expect(loadLocatorRecords(root, BUILD).size).toBe(0);
    mkdirSync(join(root, "locators"));
    writeFileSync(locatorFilePath(root, BUILD), serializeLocatorFile([REC]));
    expect(loadLocatorRecords(root, BUILD).get(REC.rowId)?.name).toBe("Log Console");
    writeFileSync(locatorFilePath(root, BUILD), "{bad\n");
    expect(() => loadLocatorRecords(root, BUILD)).toThrow(/malformed/);
  });
  it("reads the current build tag", () => {
    const root = tmp();
    expect(readCurrentBuild(root)).toBeNull();
    writeFileSync(join(root, "current-build.json"), JSON.stringify({ tag: BUILD }));
    expect(readCurrentBuild(root)).toBe(BUILD);
  });
  it("keeps the ui rows of a ledger shard, slimmed", () => {
    const rows = parseCensusRows(
      [
        JSON.stringify({
          id: "ui:a",
          dim: "ui",
          kind: "control",
          label: "A",
          risk: "safe",
          locator: { build: "1.8.0.13" },
          extra: 1,
        }),
        JSON.stringify({ id: "api:b", dim: "api" }),
      ].join("\n"),
    );
    expect([...rows.keys()]).toEqual(["ui:a"]);
    expect(rows.get("ui:a")).toEqual({
      id: "ui:a",
      module: null,
      kind: "control",
      label: "A",
      risk: "safe",
      locator: { build: "1.8.0.13" },
    });
  });
});

describe("resolution over a snapshot", () => {
  it("by automation id: one element, its index path", () => {
    const r = resolveLocator(TREE, { automationId: "dock.log" });
    expect(r).toMatchObject({ ok: true, count: 1 });
    expect(r.hit?.path).toBe("0/1/0");
  });
  it("by automation id: none, or several without a unique census name, is refused", () => {
    expect(resolveLocator(TREE, { automationId: "nope" })).toMatchObject({ ok: false, count: 0 });
    expect(resolveLocator(TREE, { automationId: "dup" })).toMatchObject({ ok: false, count: 2 });
    const n = resolveLocator(TREE, { automationId: "dup", name: "B", controlType: "Button" });
    expect(n).toMatchObject({ ok: true, count: 2, narrowed: true });
    expect(n.hit?.node.name).toBe("B");
  });
  it("by label path (context.py rule): a non-final label takes the first container", () => {
    const r = resolvePath(TREE, ["Hierarchy", "Log Console"]);
    expect(r.ok).toBe(true);
    expect(r.hit?.path).toBe("0/1/0");
    expect(resolvePath(TREE, ["Menu", "Edit"]).hit?.path).toBe("0/0/0");
  });
  it("by label path: the final label must be unique; @Class.n picks the n-th", () => {
    expect(resolvePath(TREE, ["Hierarchy"])).toMatchObject({ ok: false, count: 2 });
    expect(resolvePath(TREE, ["Hierarchy", "@QPushButton.2"]).hit?.path).toBe("0/1/4");
    expect(resolvePath(TREE, ["Hierarchy", "@QPushButton.3"]).ok).toBe(false);
    expect(resolvePath(TREE, ["Missing"])).toMatchObject({ ok: false, count: 0 });
  });
  it("census name and type: mnemonics and case ignored; any difference named", () => {
    expect(
      censusMismatch(
        { name: "&Log console", controlType: "CheckBox" },
        { name: "Log Console", controlType: "CheckBox" },
      ),
    ).toBeNull();
    expect(
      censusMismatch(
        { name: "Log", controlType: "Button" },
        { name: "Log Console", controlType: "CheckBox" },
      ),
    ).toMatch(/control type Button, census CheckBox; name "Log", census "Log Console"/);
    expect(censusMismatch({ name: "x", controlType: "Pane" }, { name: null })).toBeNull();
  });
  it("the ledger's locator: id with label, or the menu path as a label path", () => {
    expect(ledgerSpec(ROW)).toEqual({
      automationId: "dock.log",
      controlType: "CheckBox",
      name: "Log Console",
    });
    expect(
      ledgerSpec({
        ...ROW,
        label: null,
        locator: { menuPath: ["Edit", "Copy"], controlType: "MenuItem", windowClass: "W" },
      }),
    ).toEqual({ path: ["Edit", "Copy"], controlType: "MenuItem" });
    expect(ledgerSpec({ ...ROW, locator: { windowClass: "W" } })).toBeNull();
  });
});

describe("carryLocators: P-W8-02 results only (DEC-076)", () => {
  const rows = new Map([[ROW.id, ROW]]);
  const ok = {
    probe: "P-W8-02",
    evidence: "EV-W8-010",
    build: BUILD,
    rowId: ROW.id,
    window: REC.window,
    automationId: "dock.log",
    resolved: 1,
    name: "Log Console",
    controlType: "CheckBox",
  };
  it("a passing result becomes a canonical record", () => {
    const c = carryLocators([ok], rows, BUILD);
    expect(c.rejected).toEqual([]);
    expect(c.records).toEqual([{ ...REC, evidence: "EV-W8-010" }]);
  });
  it.each([
    [{ ...ok, probe: "P-W8-01" }, /not a P-W8-02 result/],
    [{ ...ok, evidence: "" }, /evidence/],
    [{ ...ok, build: "1.8.0.13" }, /ran on build 1.8.0.13/],
    [{ ...ok, rowId: "ui:none" }, /no ui row/],
    [{ ...ok, resolved: 2 }, /resolved to 2/],
    [{ ...ok, resolved: 0 }, /resolved to 0/],
    [{ ...ok, name: "Console" }, /differs from the census/],
    [{ ...ok, controlType: "Button" }, /differs from the census/],
    [{ ...ok, window: { className: "W" } }, /titlePattern/],
  ])("refuses %#", (bad, why) => {
    const c = carryLocators([bad], rows, BUILD);
    expect(c.records).toEqual([]);
    expect(c.rejected[0].reason).toMatch(why);
  });
  it("a later passing result for the same row supersedes the earlier one", () => {
    const c = carryLocators([ok, { ...ok, evidence: "EV-W8-011" }], rows, BUILD);
    expect(c.records.map((r) => r.evidence)).toEqual(["EV-W8-011"]);
    expect(c.superseded).toEqual([ROW.id]);
  });
  it("fix-up 3: an unresolved off-window row is counted under elsewhere, not rejected", () => {
    const menuRow = { ...ROW, id: "ui:ResourceManager/menu-item/File/Open", kind: "menu-item" };
    const ctxRow = { ...ROW, id: "ui:WorldEditor/context-item/x/y", kind: "context-item" };
    const dlgRow = { ...ROW, id: "ui:WorldEditor/control/#FileDlg.ok", kind: "control" };
    const rs = new Map([
      [ROW.id, ROW],
      [menuRow.id, menuRow],
      [ctxRow.id, ctxRow],
      [dlgRow.id, dlgRow],
    ]);
    const c = carryLocators(
      [
        // run 4's shape: a menu-item row, no surface recorded, resolved 0
        { ...ok, rowId: menuRow.id, resolved: 0, name: "", controlType: "" },
        { ...ok, rowId: ctxRow.id, resolved: 0, name: "", controlType: "" },
        // the sweep's surface field (fix-up 3) names a dialog the kind cannot
        { ...ok, rowId: dlgRow.id, resolved: 0, name: "", controlType: "", surface: "dialog" },
        // a main-window row that resolved to nothing is still rejected
        { ...ok, resolved: 0, name: "", controlType: "", surface: "window" },
        // DEC-088: an off-window row that resolved to two is elsewhere too (run 8's Imageset
        // menu items: the closed ImageSet menu's title and the ImageSet tab)
        { ...ok, rowId: menuRow.id, resolved: 2, name: "", controlType: "", surface: "menu" },
        // a main-window row that resolved to two is still rejected
        { ...ok, resolved: 2, surface: "window" },
      ],
      rs,
      BUILD,
    );
    expect(c.elsewhere).toEqual({ menu: 2, context: 1, dialog: 1 });
    expect(c.rejected.map((r) => r.reason)).toEqual([
      "resolved to 0 elements, not one",
      "resolved to 2 elements, not one",
    ]);
  });
  it("DEC-084 option B: a folded-label row is judged against the walked UIA name (run 4 and run 8 rows)", () => {
    // Run 4 / run 8: ui:WorldEditor/control/#snapToGridXEdit, label "X", the live name the group box's.
    const snap: CensusRowLite = {
      id: "ui:WorldEditor/control/#snapToGridXEdit",
      module: "WorldEditor",
      kind: "control",
      label: "X",
      risk: "mutating",
      locator: {
        build: BUILD,
        automationId: "A.snapToGridGroupBox.snapToGridXEdit",
        controlType: "Edit",
        uiaName: "Snap to grid",
      },
    };
    // Run 8: ui:ResourceManager.Font/control/@QToolBar.1/Size:, the "Bold" check box.
    const size: CensusRowLite = {
      id: "ui:ResourceManager.Font/control/@QToolBar.1/Size:",
      module: "ResourceManager.Font",
      kind: "control",
      label: "Size:",
      risk: "mutating",
      locator: { build: BUILD, automationId: "A.QToolBar.QCheckBox", controlType: "CheckBox", uiaName: "Bold" },
    };
    // Run 8: the template library's Library list, which the walk saw unnamed.
    const lib: CensusRowLite = {
      ...snap,
      id: "ui:WorldEditor/control/templateLibraryDock/templateLibraryDockContents/Library",
      label: "Library",
      locator: { build: BUILD, automationId: "A.templateLibrary", controlType: "List", uiaName: "" },
    };
    const res = (row: CensusRowLite, name: string) => ({
      ...ok,
      rowId: row.id,
      automationId: row.locator!.automationId,
      name,
      controlType: row.locator!.controlType!,
    });
    const rs = new Map([snap, size, lib].map((r) => [r.id, r]));
    const c = carryLocators(
      [res(snap, "Snap to grid"), res(size, "Bold"), res(lib, ""), res(snap, "X")],
      rs,
      BUILD,
    );
    expect(c.records.map((r) => r.rowId).sort()).toEqual([lib.id, size.id, snap.id].sort());
    // The folded label itself is now the mismatch: the element never shows it.
    expect(c.rejected.map((r) => r.reason)).toEqual([
      'differs from the census: name "X", census "Snap to grid"',
    ]);
    expect(censusName(snap)).toBe("Snap to grid");
    expect(censusName(ROW)).toBe("Log Console");
    expect(ledgerSpec(size)?.name).toBe("Bold");
  });
  it("DEC-088: a result naming a pre-fold id carries under the row's count-folded id", () => {
    expect(countFoldedId("ui:ResourceManager.Model/control/BSP (0) %2F Portals (0)")).toBe(
      "ui:ResourceManager.Model/control/BSP %2F Portals",
    );
    expect(countFoldedId("ui:ResourceManager.Model/control/Bones (0 + 0)")).toBe(
      "ui:ResourceManager.Model/control/Bones",
    );
    expect(countFoldedId("ui:WorldEditor/control/#log")).toBe("ui:WorldEditor/control/#log");
    const colliders: CensusRowLite = {
      ...ROW,
      id: "ui:ResourceManager.Model/control/Colliders",
      label: "Colliders (2)",
      locator: { build: BUILD, automationId: "A.qt_toolbox_toolboxbutton", controlType: "Button", ordinal: 4 },
    };
    const c = carryLocators(
      [
        {
          ...ok,
          rowId: "ui:ResourceManager.Model/control/Colliders (2)",
          automationId: "A.qt_toolbox_toolboxbutton",
          ordinal: 4,
          name: "Colliders (2)",
          controlType: "Button",
        },
      ],
      new Map([[colliders.id, colliders]]),
      BUILD,
    );
    expect(c.rejected).toEqual([]);
    expect(c.records.map((r) => r.rowId)).toEqual([colliders.id]);
  });
  it("DEC-090: a result naming a strip-ordinal dock tab id carries under the tab's name-keyed id", () => {
    expect(dockTabStableId("ui:WorldEditor/tab/@QMainWindowTabBar.3/Create")).toBe(
      "ui:WorldEditor/tab/@QMainWindowTabBar/Create",
    );
    // Only a dock tab id: a QTabBar tab, a strip panel and other kinds are unchanged.
    for (const id of [
      "ui:ResourceManager.Layout/tab/@QTabBar.1/Create",
      "ui:WorldEditor/panel/@QMainWindowTabBar.1",
      "ui:WorldEditor/control/@QMainWindowTabBar.1/Create",
      "ui:WorldEditor/tab/@QMainWindowTabBar/Create",
    ])
      expect(dockTabStableId(id)).toBe(id);
    const create: CensusRowLite = {
      ...ROW,
      id: "ui:WorldEditor/tab/@QMainWindowTabBar/Create",
      kind: "tab",
      label: "Create",
      locator: {
        build: BUILD,
        automationId: "A.QMainWindowTabBar",
        controlType: "TabItem",
        ordinal: 2,
      },
    };
    const result = {
      ...ok,
      automationId: "A.QMainWindowTabBar",
      ordinal: 2,
      name: "Create",
      controlType: "TabItem",
    };
    const c = carryLocators(
      [
        { ...result, rowId: "ui:WorldEditor/tab/@QMainWindowTabBar.1/Create" },
        { ...result, rowId: "ui:WorldEditor/tab/@QMainWindowTabBar.3/Create" },
      ],
      new Map([[create.id, create]]),
      BUILD,
    );
    expect(c.rejected).toEqual([]);
    expect(c.records.map((r) => r.rowId)).toEqual([create.id]);
    // Two old ids of one tab: the later result is kept.
    expect(c.superseded).toEqual([create.id]);
  });
  it("DEC-088: a menu path settles on the menu title when a tab shares its label", () => {
    const tree = node({
      controlType: "Window",
      name: "Resource Manager",
      children: [
        node({
          controlType: "MenuBar",
          name: "Menu",
          children: [node({ controlType: "MenuItem", name: "ImageSet" })],
        }),
        node({
          controlType: "Tab",
          name: "",
          children: [node({ controlType: "TabItem", name: "ImageSet" })],
        }),
      ],
    });
    // The menu is closed: the item is not on the tree, so nothing resolves (elsewhere: menu).
    expect(resolvePath(tree, ["ImageSet", "Add 3x3"])).toMatchObject({ ok: false, count: 0 });
    // Open, the item resolves under the menu title, not the tab.
    const open = node({
      controlType: "Window",
      name: "Resource Manager",
      children: [
        node({
          controlType: "MenuBar",
          name: "Menu",
          children: [
            node({
              controlType: "MenuItem",
              name: "ImageSet",
              children: [node({ controlType: "MenuItem", name: "Add 3x3" })],
            }),
          ],
        }),
        node({ controlType: "TabItem", name: "ImageSet" }),
      ],
    });
    expect(resolvePath(open, ["ImageSet", "Add 3x3"])).toMatchObject({ ok: true, count: 1 });
  });
});

describe("scripts/census/locators-carry.ts", () => {
  function census(): string {
    const root = tmp();
    writeFileSync(join(root, "current-build.json"), JSON.stringify({ tag: BUILD }));
    writeFileSync(
      join(root, "ledger.jsonl"),
      JSON.stringify({
        id: ROW.id,
        dim: "ui",
        kind: "control",
        module: "WorldEditor",
        label: ROW.label,
        risk: ROW.risk,
        locator: ROW.locator,
      }) + "\n",
    );
    return root;
  }
  const result = {
    probe: "P-W8-02",
    evidence: "EV-W8-010",
    build: BUILD,
    rowId: ROW.id,
    window: REC.window,
    automationId: "dock.log",
    resolved: 1,
    name: "Log Console",
    controlType: "CheckBox",
  };
  it("dry run by default: summary, nothing written", () => {
    const root = census();
    const res = join(root, "r.jsonl");
    writeFileSync(
      res,
      JSON.stringify(result) + "\n" + JSON.stringify({ ...result, resolved: 0 }) + "\n",
    );
    const io = memoryIo();
    expect(carryRun(["--results", res, "--data", root], io)).toBe(0);
    const summary = JSON.parse(io.stdout().split("\n")[0]);
    expect(summary).toMatchObject({
      build: BUILD,
      results: 2,
      carried: 1,
      rejected: 1,
      written: false,
    });
    expect(existsSync(locatorFilePath(root, BUILD))).toBe(false);
  });
  it("--write writes the build's file from the carried records only", () => {
    const root = census();
    const res = join(root, "r.jsonl");
    writeFileSync(res, JSON.stringify(result) + "\n");
    expect(carryRun(["--results", res, "--data", root, "--write"], memoryIo())).toBe(0);
    const text = readFileSync(locatorFilePath(root, BUILD), "utf-8");
    expect(parseLocatorFile(text, BUILD).records.get(ROW.id)?.evidence).toBe("EV-W8-010");
  });
  it("nothing carried is exit 1; a bad line exit 3; no --results exit 2", () => {
    const root = census();
    const res = join(root, "r.jsonl");
    writeFileSync(res, JSON.stringify({ ...result, build: "1.8.0.13" }) + "\n");
    expect(carryRun(["--results", res, "--data", root, "--write"], memoryIo())).toBe(1);
    expect(existsSync(locatorFilePath(root, BUILD))).toBe(false);
    writeFileSync(res, "{\n");
    expect(carryRun(["--results", res, "--data", root], memoryIo())).toBe(3);
    expect(carryRun(["--data", root], memoryIo())).toBe(2);
  });
});

describe("DEC-078: the locator ordinal and the property-grid item path", () => {
  const STATUS = "app.main.statusBar.QLabel";
  const GRID = "app.main.propDock.entityPropGrid";
  const T = node({
    controlType: "Window",
    automationId: "app.main",
    children: [
      node({
        controlType: "StatusBar",
        children: [
          node({ controlType: "Text", name: "Version 1.9.0.37", automationId: STATUS }),
          node({ controlType: "Text", name: "", automationId: STATUS }),
          node({ controlType: "Button", name: "", automationId: STATUS }),
          node({ controlType: "Text", name: "Material: none", automationId: STATUS }),
        ],
      }),
      node({
        controlType: "Tree",
        automationId: GRID,
        className: "EntityPropertyGrid",
        children: [
          node({
            controlType: "TreeItem",
            name: "Transformation",
            automationId: GRID,
            children: [
              node({ controlType: "TreeItem", name: "Coords", automationId: GRID }),
              node({ controlType: "TreeItem", name: "Angles", automationId: GRID }),
            ],
          }),
          node({ controlType: "TreeItem", name: "Angles", automationId: GRID }),
        ],
      }),
    ],
  });

  it("locatorOrdinals: document order among the same id and control type; unique elements get none", () => {
    const o = locatorOrdinals(T);
    expect(o.get("0/0/0")).toEqual({ ordinal: 0, matches: 3 });
    expect(o.get("0/0/1")).toEqual({ ordinal: 1, matches: 3 });
    expect(o.get("0/0/3")).toEqual({ ordinal: 2, matches: 3 });
    // The Button shares the id but not the type: alone in its group, so no ordinal.
    expect(o.has("0/0/2")).toBe(false);
    expect(o.has("0")).toBe(false);
    expect(o.has("0/1")).toBe(false); // the grid is the only Tree with its id
    expect(o.get("0/1/0")).toEqual({ ordinal: 0, matches: 4 }); // TreeItems: pre-order
    expect(o.get("0/1/0/1")).toEqual({ ordinal: 2, matches: 4 });
    expect(o.get("0/1/1")).toEqual({ ordinal: 3, matches: 4 });
  });

  it("every ordinal the walker emits resolves back to its own element", () => {
    for (const [path, { ordinal }] of locatorOrdinals(T)) {
      let n = T;
      for (const i of path.split("/").slice(1)) n = n.children![Number(i)];
      const r = resolveLocator(T, {
        automationId: n.automationId,
        controlType: n.controlType,
        ordinal,
      });
      expect(r, path).toMatchObject({ ok: true, ordinal: true });
      expect(r.hit?.path).toBe(path);
    }
  });

  it("resolveLocator: the control type narrows; without an ordinal several matches stay ambiguous", () => {
    expect(resolveLocator(T, { automationId: STATUS, controlType: "Button" })).toMatchObject({
      ok: true,
      count: 1,
    });
    expect(resolveLocator(T, { automationId: STATUS, controlType: "Text" })).toMatchObject({
      ok: false,
      count: 3,
    });
    // The old name narrowing still applies to a locator with no ordinal.
    expect(
      resolveLocator(T, { automationId: STATUS, controlType: "Text", name: "Material: none" }),
    ).toMatchObject({ ok: true, narrowed: true });
  });

  it("resolveLocator: an ordinal out of range, or on a type no element has, is refused", () => {
    expect(
      resolveLocator(T, { automationId: STATUS, controlType: "Text", ordinal: 3 }),
    ).toMatchObject({ ok: false, count: 3 });
    expect(
      resolveLocator(T, { automationId: STATUS, controlType: "CheckBox", ordinal: 0 }),
    ).toMatchObject({ ok: false });
    // The ordinal decides even when a name would pick another element.
    const r = resolveLocator(T, {
      automationId: STATUS,
      controlType: "Text",
      ordinal: 1,
      name: "Material: none",
    });
    expect(r.hit?.path).toBe("0/0/1");
  });

  it("itemPath: the TreeItem below the grid, not the grid; one container must carry the id", () => {
    const r = resolveLocator(T, {
      automationId: GRID,
      controlType: "TreeItem",
      itemPath: ["Transformation", "Angles"],
    });
    expect(r.ok).toBe(true);
    expect(r.hit?.path).toBe("0/1/0/1");
    expect(r.hit?.node.controlType).toBe("TreeItem");
    expect(
      resolveLocator(T, { automationId: GRID, itemPath: ["Transformation", "Coords"] }).hit?.path,
    ).toBe("0/1/0/0");
    expect(resolveLocator(T, { automationId: GRID, itemPath: ["Scale"] })).toMatchObject({
      ok: false,
      count: 0,
    });
    // A grid with nothing selected has no items: nothing resolves (run 3's grid had 0 children).
    const empty = node({
      controlType: "Window",
      children: [node({ controlType: "Tree", automationId: GRID })],
    });
    expect(resolveLocator(empty, { automationId: GRID, itemPath: ["Angles"] }).ok).toBe(false);
  });

  it("ledgerSpec, the record, its validation and the carry keep ordinal and itemPath", () => {
    const row: CensusRowLite = {
      ...ROW,
      label: "Material: none",
      locator: { build: BUILD, automationId: STATUS, controlType: "Text", ordinal: 2 },
    };
    expect(ledgerSpec(row)).toEqual({
      automationId: STATUS,
      ordinal: 2,
      controlType: "Text",
      name: "Material: none",
    });
    const grid: CensusRowLite = {
      ...ROW,
      id: "ui:WorldEditor/property/x/Angles",
      label: "Angles",
      locator: { build: BUILD, automationId: GRID, controlType: "TreeItem", itemPath: ["Angles"] },
    };
    expect(ledgerSpec(grid)).toMatchObject({ itemPath: ["Angles"] });
    expect(validateLocatorRecord({ ...REC, ordinal: 1 })).toBeNull();
    expect(validateLocatorRecord({ ...REC, ordinal: -1 })).toMatch(/non-negative/);
    expect(validateLocatorRecord({ ...REC, ordinal: 1.5 })).toMatch(/non-negative/);
    expect(validateLocatorRecord({ ...REC, itemPath: [] })).toMatch(/itemPath/);
    const { automationId: _x, ...noId } = REC;
    void _x;
    expect(validateLocatorRecord({ ...noId, path: ["A"], ordinal: 0 })).toMatch(
      /needs an automationId/,
    );
    const rows = new Map([
      [row.id, row],
      [grid.id, grid],
    ]);
    const base = {
      probe: "P-W8-02",
      evidence: "EV-W8-050",
      build: BUILD,
      window: REC.window,
      resolved: 1,
    };
    const c = carryLocators(
      [
        {
          ...base,
          rowId: row.id,
          automationId: STATUS,
          ordinal: 2,
          name: "Material: none",
          controlType: "Text",
        },
        {
          ...base,
          rowId: grid.id,
          automationId: GRID,
          itemPath: ["Angles"],
          name: "Angles",
          controlType: "TreeItem",
        },
      ],
      rows,
      BUILD,
    );
    expect(c.rejected).toEqual([]);
    const byRow = new Map(c.records.map((r) => [r.rowId, r]));
    expect(byRow.get(row.id)?.ordinal).toBe(2);
    expect(byRow.get(grid.id)?.itemPath).toEqual(["Angles"]);
    // The file round-trips with both fields, in the canonical key order.
    const text = serializeLocatorFile(c.records);
    expect(parseLocatorFile(text, BUILD).errors).toEqual([]);
    expect(text).toContain('"automationId":"app.main.statusBar.QLabel","ordinal":2,"name"');
  });
});
