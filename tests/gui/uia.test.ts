import { describe, expect, it } from "vitest";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  DEFAULT_SNAPSHOT_BOUNDS,
  SNAPSHOT_BOUND_CAPS,
  buildListWindowsScript,
  buildSnapshotScript,
  find,
  isPopup,
  nodeAtPath,
  ENV_DRIVE,
  ENV_VALUE,
  listWindows,
  powershellArgs,
  selectWindow,
  snapshot,
  snapshotPlanAction,
  validateSnapshotBounds,
  validateSnapshotTarget,
  processError,
  redactText,
  redactTree,
  WALK_CSHARP,
} from "../../src/gui/uia.js";
import { BOUND_CAPS, DEFAULT_BOUNDS } from "../../tools/uia/walk.js";
import { fakeRunner, node, win } from "./fake-runner.js";

const MAIN = win({ hwnd: 11, title: "Resource Manager", className: "Qt683QWindowIcon" });
const POPUP = win({ hwnd: 12, title: "", className: "Qt683QWindowPopupDropShadowSaveBits" });
const SHADOW = win({ hwnd: 13, title: "", className: "SysShadow" });
const T = { pid: 100, className: "Qt683QWindowIcon", titlePattern: "Resource Manager" };
const OPTIONS = win({ hwnd: 14, title: "Options", className: "Qt683QWindowIcon", owned: true });

describe("scripts as data", () => {
  it("carries no caller value in the script text", () => {
    for (const s of [buildListWindowsScript(), buildSnapshotScript()]) {
      expect(s).toContain("$env:EMCP_GUI_");
    }
  });
  it("never retrieves a pattern object or sends input", () => {
    const s = buildSnapshotScript();
    expect(s).not.toMatch(
      /GetCurrentPattern|\.Invoke\(|SetValue|Expand\(|PostMessage|SendMessage|SetFocus/,
    );
    expect(s).toContain("IsInvokePatternAvailableProperty");
  });
  it("encodes as -EncodedCommand UTF-16LE (launcher-nudge.ts route)", () => {
    const a = powershellArgs("Write-Output 1");
    expect(a.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(Buffer.from(a[3], "base64").toString("utf16le")).toBe("Write-Output 1");
  });
  it("mirrors walk.ts defaults and caps for the five bounds it enforces", () => {
    for (const k of Object.keys(DEFAULT_SNAPSHOT_BOUNDS) as Array<
      keyof typeof DEFAULT_SNAPSHOT_BOUNDS
    >) {
      expect(DEFAULT_SNAPSHOT_BOUNDS[k]).toBe(DEFAULT_BOUNDS[k]);
      expect(SNAPSHOT_BOUND_CAPS[k]).toBe(BOUND_CAPS[k]);
    }
    expect(validateSnapshotBounds({ ...DEFAULT_SNAPSHOT_BOUNDS, maxDepth: 201 })).toMatch(
      /maxDepth/,
    );
  });
  it("its plan action passes the dry-run checker as a uia-read", () => {
    const action = snapshotPlanAction({ pid: 100 }, DEFAULT_SNAPSHOT_BOUNDS, MAIN);
    const r = checkPlan([action as never], loadPolicy());
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("window selection (walker.py select_window)", () => {
  it("menus.py is_popup: Qt popup class, owned, untitled SysShadow", () => {
    expect(isPopup(POPUP)).toBe(true);
    expect(isPopup(SHADOW)).toBe(true);
    expect(isPopup(OPTIONS)).toBe(true);
    expect(isPopup(MAIN)).toBe(false);
  });
  it("picks by class and full title, refuses owned without allowOwned", () => {
    const all = [MAIN, POPUP, SHADOW, OPTIONS, win({ hwnd: 99, pid: 7, title: "Other" })];
    expect(
      selectWindow(all, {
        pid: 100,
        className: "Qt683QWindowIcon",
        titlePattern: "Resource Manager",
      }).window?.hwnd,
    ).toBe(11);
    expect(selectWindow(all, { pid: 100, titlePattern: "Options" }).window).toBeNull();
    expect(
      selectWindow(all, { pid: 100, titlePattern: "Options", allowOwned: true }).window?.hwnd,
    ).toBe(14);
  });
  it("title is a full match, not a substring", () => {
    expect(selectWindow([MAIN], { pid: 100, titlePattern: "Resource" }).window).toBeNull();
    expect(selectWindow([MAIN], { pid: 100, titlePattern: "Resource.*" }).window?.hwnd).toBe(11);
  });
  it("refuses ambiguity and hung windows", () => {
    const two = [MAIN, win({ hwnd: 15, title: "World Editor" })];
    expect(selectWindow(two, { pid: 100 }).reason).toMatch(/2 windows match/);
    expect(selectWindow([{ ...MAIN, hung: true }], { pid: 100 }).reason).toMatch(/not responding/);
  });
});

describe("listWindows / snapshot through a mocked runner", () => {
  it("lists windows with the pid in the environment", async () => {
    const f = fakeRunner({ windows: () => [MAIN, POPUP] });
    const r = await listWindows(100, { run: f.run });
    expect(r.ok).toBe(true);
    expect(r.windows.map((w) => w.className)).toEqual([
      "Qt683QWindowIcon",
      "Qt683QWindowPopupDropShadowSaveBits",
    ]);
    expect(f.calls[0].env).toEqual({ EMCP_GUI_PID: "100" });
  });
  it("refuses a bad pid without running anything", async () => {
    const f = fakeRunner({ windows: () => [] });
    expect((await snapshot({ pid: 0 }, {}, { run: f.run })).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
  it("walks the chosen window and returns the walker's record shape", async () => {
    const tree = node({
      controlType: "Window",
      name: "Resource Manager",
      children: [node({ controlType: "MenuBar", name: "File" })],
      childCount: 1,
    });
    const f = fakeRunner({ windows: () => [MAIN], trees: { 11: tree } });
    const r = await snapshot(T, { bounds: { maxDepth: 3 } }, { run: f.run });
    expect(r.ok).toBe(true);
    expect(r.tree?.children?.[0].controlType).toBe("MenuBar");
    const walk = f.calls.find((c) => c.kind === "walk")!;
    expect(walk.env.EMCP_GUI_HWND).toBe("11");
    expect(JSON.parse(walk.env.EMCP_GUI_BOUNDS).maxDepth).toBe(3);
  });
  it("refuses when the attached element is not the chosen window", async () => {
    const f = fakeRunner({ windows: () => [MAIN], identity: () => ({ pid: 100, hwnd: 999 }) });
    const r = await snapshot(T, {}, { run: f.run });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/hwnd differ/);
  });
  it("reports a runner failure", async () => {
    const f = fakeRunner({ windows: () => [], fail: true });
    expect((await listWindows(100, { run: f.run })).ok).toBe(false);
  });
});

describe("review fixes", () => {
  // Planted values are assembled at test time so the file text holds no home-path or e-mail
  // shape.
  const BS = "\\";
  const HOME_C = ["C:", "Users", "someone"].join(BS);
  const HOME_D = ["D:", "Users", "other"].join(BS);
  const MAIL = ["a", "b.com"].join("@");
  it("GUI-01: each Add-Type block is self-contained (no class of another block referenced)", () => {
    const s = buildSnapshotScript();
    const blocks = [...s.matchAll(/-TypeDefinition @'\n([\s\S]*?)\n'@/g)].map((m) => m[1]);
    expect(blocks.length).toBe(2);
    const declared = blocks.map((b) => [...b.matchAll(/\bclass\s+(\w+)/g)].map((m) => m[1]));
    blocks.forEach((b, i) => {
      for (const [j, names] of declared.entries()) {
        if (j === i) continue;
        for (const n of names) expect(b).not.toMatch(new RegExp(`\\b${n}\\b`));
      }
    });
    expect(WALK_CSHARP).not.toContain("EmcpGuiWindows");
  });
  it("GUI-02: a target needs class and title together, or an hwnd", () => {
    expect(validateSnapshotTarget({ pid: 100 })).toMatch(/className and titlePattern/);
    expect(validateSnapshotTarget({ pid: 100, titlePattern: "X" })).toMatch(/className/);
    expect(validateSnapshotTarget({ pid: 100, hwnd: 5 })).toBeNull();
    expect(validateSnapshotTarget(T)).toBeNull();
  });
  it("GUI-05: a process error carries code or kill and redacted stderr, never the argv", () => {
    const env = { USERPROFILE: HOME_C, USERNAME: "someone" };
    void env;
    const e = processError(
      { code: 1 },
      "at " + HOME_C + BS + "AppData" + BS + "x.cs " + "y".repeat(1000),
    );
    expect(e).toMatch(/^PowerShell exited with code 1: /);
    expect(e).not.toContain("someone");
    expect(e).not.toContain("-EncodedCommand");
    expect(e.length).toBeLessThan(400);
    expect(processError({ killed: true }, "")).toBe("PowerShell was killed (timeout)");
  });
  it("GUI-04: titles and node strings are redacted with the walker's placeholders", async () => {
    const env = { USERPROFILE: HOME_C, USERNAME: "someone", COMPUTERNAME: "BOXHOST" };
    expect(redactText(HOME_C + BS + "Documents" + BS + "x on BOXHOST", env)).toBe(
      "%USERPROFILE%" + BS + "Documents" + BS + "x on <host>",
    );
    expect(redactText(HOME_D + BS + "a", env)).toBe("<home-path>" + BS + "a");
    const t = redactTree(node({ name: MAIL, children: [node({ helpText: "someone" })] }), env);
    expect(t.name).toBe("<email>");
    expect(t.children?.[0].helpText).toBe("<user>");
    const home = win({
      hwnd: 11,
      title: "Resource Manager - " + HOME_D + BS + "proj",
      className: "Qt683QWindowIcon",
    });
    const f = fakeRunner({
      windows: () => [home],
      trees: { 11: node({ name: HOME_D + BS + "f" }) },
    });
    const r = await snapshot(
      { pid: 100, className: "Qt683QWindowIcon", titlePattern: "Resource Manager.*" },
      {},
      { run: f.run },
    );
    expect(r.window?.title).toBe("Resource Manager - <home-path>\\proj");
    expect(r.tree?.name).toBe("<home-path>\\f");
  });
  it("GUI-06/07: guarded reads emit a path; the node cap is max-nodes", () => {
    expect(WALK_CSHARP).toContain('"{\\"controlType\\":\\"\\",\\"path\\":\\""');
    expect(WALK_CSHARP).toContain('stop = "max-nodes"');
    expect(WALK_CSHARP).not.toMatch(/stop = "nodes"/);
  });
});

describe("find", () => {
  const tree = node({
    controlType: "Window",
    name: "Main",
    children: [
      node({
        controlType: "MenuBar",
        name: "Menu",
        children: [node({ controlType: "MenuItem", name: "File", automationId: "menu.file" })],
      }),
      node({ controlType: "Button", name: "OK" }),
    ],
  });
  it("matches text, control type and exact id, with paths", () => {
    expect(find(tree, { text: "file" }).hits[0].path).toBe("0/0/0");
    expect(find(tree, { controlType: "button" }).hits[0].names).toEqual(["Main", "OK"]);
    expect(find(tree, { automationId: "menu.file" }).total).toBe(1);
    expect(find(tree, {}).total).toBe(0);
  });
  it("nodeAtPath follows a hit's path; a bad or absent path is null", () => {
    const hit = find(tree, { text: "file" }).hits[0];
    expect(nodeAtPath(tree, hit.path)?.automationId).toBe("menu.file");
    expect(nodeAtPath(tree, "0")?.name).toBe("Main");
    expect(nodeAtPath(tree, "0/9")).toBeNull();
    expect(nodeAtPath(tree, "1/0")).toBeNull();
    expect(nodeAtPath(tree, "0/x")).toBeNull();
    expect([ENV_DRIVE, ENV_VALUE]).toEqual(["EMCP_GUI_DRIVE", "EMCP_GUI_VALUE"]);
  });
  it("hits carry no children and respect the limit", () => {
    const r = find(tree, { text: "m", limit: 1 });
    expect(r.hits).toHaveLength(1);
    expect(r.total).toBeGreaterThan(1);
    expect("children" in r.hits[0].node).toBe(false);
  });
});
