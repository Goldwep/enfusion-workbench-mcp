import { describe, expect, it } from "vitest";
import { isContextPopup, readMenuItems, readOpenContextMenu } from "../../src/gui/context.js";
import { fakeRunner, node, win } from "./fake-runner.js";

const MAIN = win({ hwnd: 11, title: "Arma Reforger Workbench", className: "Qt683QWindowIcon" });
const POPUP = win({
  hwnd: 50,
  title: "Arma Reforger Workbench",
  className: "Qt683QWindowPopupDropShadowSaveBits",
});
const SHADOW = win({ hwnd: 51, title: "", className: "SysShadow" });
const MENU = node({
  controlType: "Window",
  name: "",
  className: "QMenu",
  children: [
    node({
      controlType: "Menu",
      children: [
        node({
          controlType: "MenuItem",
          name: "Copy",
          acceleratorKey: "Ctrl+C",
          patterns: ["Invoke"],
        }),
        node({ controlType: "MenuItem", name: "Paste", enabled: false, patterns: ["Invoke"] }),
        node({ controlType: "Separator" }),
        node({ controlType: "MenuItem", name: "Create", patterns: ["ExpandCollapse"] }),
      ],
    }),
  ],
});

describe("isContextPopup (context.py is_popup_window)", () => {
  it("is the unowned, visible Qt popup only", () => {
    expect(isContextPopup(POPUP)).toBe(true);
    expect(isContextPopup({ ...POPUP, owned: true })).toBe(false);
    expect(isContextPopup({ ...POPUP, visible: false })).toBe(false);
    expect(isContextPopup(SHADOW)).toBe(false);
    expect(isContextPopup(MAIN)).toBe(false);
  });
});

describe("readMenuItems (menus.py popup_children + read_items)", () => {
  it("descends one level into each Menu child and flags sub-menus", () => {
    const r = readMenuItems(MENU);
    expect(r.menus).toBe(1);
    expect(r.truncated).toBe(false);
    expect(r.items.map((i) => [i.name, i.enabled, i.submenu])).toEqual([
      ["Copy", true, false],
      ["Paste", false, false],
      ["", true, false],
      ["Create", true, true],
    ]);
    expect(r.items[0].acceleratorKey).toBe("Ctrl+C");
  });
  it("takes a non-Menu child as an item and truncates at maxItems", () => {
    const flat = node({
      children: [node({ name: "A" }), node({ name: "B" }), node({ name: "C" })],
    });
    const r = readMenuItems(flat, 2);
    expect(r.items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(r.truncated).toBe(true);
  });
});

describe("readOpenContextMenu (passive: sends nothing)", () => {
  it("reads the one open popup in the raw view, by hwnd", async () => {
    const f = fakeRunner({ windows: () => [MAIN, POPUP, SHADOW], trees: { 50: MENU } });
    const r = await readOpenContextMenu(100, { run: f.run });
    expect(r.ok).toBe(true);
    expect(r.popup).toMatchObject({ hwnd: 50, controlType: "Window" });
    expect(r.items).toHaveLength(4);
    expect(f.calls.map((c) => c.kind)).toEqual(["list", "list", "walk"]);
    const walk = f.calls.find((c) => c.kind === "walk")!;
    expect(walk.env.EMCP_GUI_HWND).toBe("50");
    expect(JSON.parse(walk.env.EMCP_GUI_BOUNDS)).toMatchObject({ raw: true, maxDepth: 4 });
  });
  it("no popup open: refusal none, nothing walked", async () => {
    const f = fakeRunner({ windows: () => [MAIN] });
    const r = await readOpenContextMenu(100, { run: f.run });
    expect(r).toMatchObject({ ok: false, refusal: "none" });
    expect(f.calls.map((c) => c.kind)).toEqual(["list"]);
  });
  it("several popups (a sub-menu open): refuses to choose", async () => {
    const f = fakeRunner({ windows: () => [MAIN, POPUP, { ...POPUP, hwnd: 60 }] });
    expect(await readOpenContextMenu(100, { run: f.run })).toMatchObject({
      ok: false,
      refusal: "several",
    });
  });
  it("the authorization window open: nothing is read", async () => {
    const f = fakeRunner({
      windows: () => [
        MAIN,
        POPUP,
        win({ hwnd: 70, title: "Script Authorization Required", owned: true }),
      ],
    });
    expect(await readOpenContextMenu(100, { run: f.run })).toMatchObject({
      ok: false,
      refusal: "auth",
    });
    expect(f.calls.some((c) => c.kind === "walk")).toBe(false);
  });
  it("a failed list or read is reported", async () => {
    const f = fakeRunner({ windows: () => [], fail: true });
    expect(await readOpenContextMenu(100, { run: f.run })).toMatchObject({
      ok: false,
      refusal: "list",
    });
  });
});
