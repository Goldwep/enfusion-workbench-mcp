import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DRIVE_ACTIONS } from "../../src/gui/driver.js";
import type { CensusRowLite, LocatorRecord } from "../../src/gui/locators.js";
import { ModalWatchdog } from "../../src/gui/modal-watchdog.js";
import {
  nodeAtPath,
  type PowerShellRunner,
  type UiaNode,
  type WindowInfo,
} from "../../src/gui/uia.js";
import {
  ACTIONS,
  MUTATING_ACTIONS,
  DIALOG_COMMIT_BUTTONS,
  WB_GUI_ANNOTATIONS,
  WB_GUI_DESCRIPTION,
  WB_GUI_INPUT,
  WINDOW_CAPTURE_SCRIPT,
  denyLabels,
  gateRefusal,
  registerWbGui,
  runGui,
  type GuiDeps,
} from "../../src/tools/wb-gui.js";
import { fakeRunner, node, win } from "../gui/fake-runner.js";
import { captureTool, textOf } from "./_tool-harness.js";

const BUILD = "1.9.0.37";
const CLS = "Qt683QWindowIcon";
const MAIN = win({ hwnd: 11, title: "World Editor", className: CLS });
const TREE = node({
  controlType: "Window",
  name: "World Editor",
  children: [
    node({
      controlType: "MenuItem",
      name: "File",
      automationId: "file",
      patterns: ["ExpandCollapse"],
    }),
    node({
      controlType: "CheckBox",
      name: "Log Console",
      automationId: "dock.log",
      patterns: ["Toggle"],
    }),
    node({
      controlType: "Button",
      name: "Hierarchy",
      automationId: "dock.hier",
      patterns: ["Invoke", "ExpandCollapse", "SelectionItem"],
    }),
    node({ controlType: "Edit", name: "Grid size", automationId: "grid", patterns: ["Value"] }),
    node({ controlType: "Button", name: "Import...", automationId: "imp", patterns: ["Invoke"] }),
    node({ controlType: "Button", name: "OK", automationId: "ok", patterns: ["Invoke"] }),
    node({ controlType: "Button", name: "Exit", automationId: "exit", patterns: ["Invoke"] }),
    node({
      controlType: "Button",
      name: "Pack Project",
      automationId: "pack",
      patterns: ["Invoke"],
    }),
    node({ controlType: "Button", name: "Renamed", automationId: "moved", patterns: ["Invoke"] }),
  ],
});
const DLG = win({ hwnd: 40, title: "Open", className: CLS, owned: true });
const DLG_TREE = node({
  controlType: "Window",
  name: "Open",
  children: [
    node({ controlType: "Button", name: "OK", automationId: "dlg.ok", patterns: ["Invoke"] }),
    node({
      controlType: "TitleBar",
      children: [node({ controlType: "Button", name: "Close", patterns: ["Invoke"] })],
    }),
    node({
      controlType: "Button",
      name: "&Cancel",
      automationId: "dlg.cancel",
      patterns: ["Invoke"],
    }),
  ],
});
const YESNO = win({ hwnd: 41, title: "Confirm", className: CLS, owned: true });
const YESNO_TREE = node({
  controlType: "Window",
  name: "Confirm",
  children: [
    node({ controlType: "Button", name: "Yes", patterns: ["Invoke"] }),
    node({ controlType: "Button", name: "No", patterns: ["Invoke"] }),
  ],
});
const OKONLY = win({ hwnd: 42, title: "Saved", className: CLS, owned: true });
const OKONLY_TREE = node({
  controlType: "Window",
  name: "Saved",
  children: [node({ controlType: "Button", name: "OK", patterns: ["Invoke"] })],
});
const AUTH = win({ hwnd: 43, title: "Script Authorization Required", className: CLS, owned: true });

function row(
  id: string,
  label: string | null,
  controlType: string,
  extra: Partial<CensusRowLite> = {},
): CensusRowLite {
  return {
    id,
    module: "WorldEditor",
    kind: "control",
    label,
    risk: "mutating",
    locator: { build: "1.8.0.13", automationId: id.split("#")[1], controlType, windowClass: CLS },
    ...extra,
  };
}
function rec(r: CensusRowLite, extra: Partial<LocatorRecord> = {}): LocatorRecord {
  return {
    rowId: r.id,
    build: BUILD,
    module: r.module,
    window: { className: CLS, titlePattern: "World Editor" },
    automationId: r.locator!.automationId!,
    name: r.label ?? "",
    controlType: r.locator!.controlType!,
    probe: "P-W8-02",
    evidence: "EV-W8-100",
    ...extra,
  };
}

const R = {
  log: row("ui:WE/control/#dock.log", "Log Console", "CheckBox"),
  hier: row("ui:WE/control/#dock.hier", "Hierarchy", "Button"),
  grid: row("ui:WE/control/#grid", "Grid size", "Edit"),
  imp: row("ui:WE/control/#imp", "Import...", "Button"),
  ok: row("ui:WE/control/#ok", "OK", "Button"),
  exit: row("ui:WE/control/#exit", "Exit", "Button"),
  pack: row("ui:WE/control/#pack", "Pack Project", "Button"),
  risky: row("ui:WE/control/#hidden", "Harmless", "Button", { risk: "destructive" }),
  old: row("ui:WE/menu/#file", "File", "MenuItem"),
  moved: row("ui:WE/control/#moved", "Import", "Button"),
  none: row("ui:WE/control/#none", "Nothing", "Button", { locator: null }),
};
const ROWS = new Map(Object.values(R).map((r) => [r.id, r]));
const RECORDS = new Map(
  [R.log, R.hier, R.grid, R.imp, R.ok, R.exit, R.pack, R.risky, R.moved].map((r) => [r.id, rec(r)]),
);
const POLICY_FILE = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "data", "census", "policy.json"), "utf-8"),
);
const ALL_ACTIONS = ["invoke", "expand", "toggle", "select", "setValue", "dismiss"];
function policy(
  gui: unknown = {
    actions_enabled: ALL_ACTIONS,
    rows_enabled: [{ id: "ui:WE/*", build: BUILD, evidence: "EV-W8-200" }],
  },
) {
  return { ...POLICY_FILE, gui };
}

interface Call {
  kind: string;
  env: Record<string, string>;
}

function stateOf(n: UiaNode, over: Record<string, unknown> = {}) {
  return {
    name: n.name,
    controlType: n.controlType,
    automationId: n.automationId,
    enabled: n.enabled,
    value: n.patterns.includes("Value") ? "8" : null,
    readOnly: n.patterns.includes("Value") ? false : null,
    toggleState: n.patterns.includes("Toggle") ? "Off" : null,
    expandState: n.patterns.includes("ExpandCollapse") ? "Collapsed" : null,
    selected: n.patterns.includes("SelectionItem") ? false : null,
    ...over,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(
  o: {
    windows?: WindowInfo[];
    gui?: unknown;
    records?: Map<string, LocatorRecord>;
    drive?: (req: Record<string, unknown>, env: Record<string, string>) => unknown;
    onAct?: (op: string) => void;
    extra?: Partial<GuiDeps>;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "wbgui-"));
  dirs.push(dir);
  const state = { windows: o.windows ?? [MAIN] };
  const trees: Record<number, UiaNode> = {
    11: TREE,
    40: DLG_TREE,
    41: YESNO_TREE,
    42: OKONLY_TREE,
  };
  const base = fakeRunner({ windows: () => state.windows, trees });
  const calls: Call[] = [];
  const run: PowerShellRunner = async (script, opts) => {
    if (!script.includes("EmcpGuiDrive]::Run")) {
      const before = base.calls.length;
      const r = await base.run(script, opts);
      calls.push(...base.calls.slice(before).map((c) => ({ kind: c.kind, env: c.env })));
      return r;
    }
    calls.push({ kind: "drive", env: opts.env });
    const req = JSON.parse(opts.env.EMCP_GUI_DRIVE) as Record<string, unknown>;
    const custom = o.drive?.(req, opts.env);
    if (custom !== undefined) {
      return custom === "fail"
        ? { ok: false, stdout: "", stderr: "", error: "PowerShell was killed (timeout)" }
        : { ok: true, stdout: JSON.stringify(custom), stderr: "", error: null };
    }
    const n = nodeAtPath(trees[Number(opts.env.EMCP_GUI_HWND)], String(req.path))!;
    const before = stateOf(n);
    if (req.op === "read") {
      return {
        ok: true,
        stdout: JSON.stringify({ ok: true, acted: false, before, after: null }),
        stderr: "",
        error: null,
      };
    }
    o.onAct?.(String(req.op));
    const after = stateOf(n, {
      ...(req.op === "toggle" ? { toggleState: "On" } : {}),
      ...(req.op === "expand" ? { expandState: "Expanded" } : {}),
      ...(req.op === "select" ? { selected: true } : {}),
      ...(req.op === "setValue" ? { value: opts.env.EMCP_GUI_VALUE } : {}),
    });
    return {
      ok: true,
      stdout: JSON.stringify({ ok: true, acted: true, before, after }),
      stderr: "",
      error: null,
    };
  };
  const d: GuiDeps = {
    run,
    env: { ENFUSION_GUI: "1" },
    platform: "win32",
    artifactsDir: () => dir,
    policy: () => policy(o.gui),
    now: () => new Date("2026-10-10T00:00:00Z"),
    watchdog: new ModalWatchdog({ run }, () => ({ source: "default", answers: [] })),
    build: () => BUILD,
    rows: () => ROWS,
    locators: () => o.records ?? RECORDS,
    settleMs: 0,
    ...o.extra,
  };
  return { d, calls, state, dir };
}
const drives = (calls: Call[]) =>
  calls.filter((c) => c.kind === "drive").map((c) => JSON.parse(c.env.EMCP_GUI_DRIVE));

describe("wb_gui surface", () => {
  it("description at most 387 chars; mutating actions turn the read-only hint off", () => {
    expect(WB_GUI_DESCRIPTION.length).toBeLessThanOrEqual(387);
    expect(WB_GUI_DESCRIPTION).not.toMatch(/sandbox|EMCP2_|29thID/i);
    expect(WB_GUI_ANNOTATIONS.readOnlyHint).toBe(false);
    expect(ACTIONS).toEqual([
      "tree",
      "find",
      "screenshot",
      "modals",
      "read",
      "context",
      "invoke",
      "expand",
      "toggle",
      "select",
      "setValue",
      "dismiss",
    ]);
    expect(Object.keys(WB_GUI_INPUT)).not.toContain("path");
    expect(MUTATING_ACTIONS.slice(0, -1)).toEqual([...DRIVE_ACTIONS]);
  });
  it("registers as wb_gui and answers in the section 4 shape", async () => {
    const { d } = setup();
    const h = captureTool((s) => registerWbGui(s, d));
    const body = JSON.parse(
      textOf(await h({ action: "tree", pid: 100, windowTitle: "World Editor" })),
    );
    expect(Object.keys(body).sort()).toEqual(
      ["action", "changed", "ok", "readback", "target", "warnings"].sort(),
    );
    const err = JSON.parse(textOf(await h({ action: "toggle", pid: 100, rowId: R.old.id })));
    expect(err).toMatchObject({ ok: false, code: "NO_LOCATOR" });
    expect(err.next).toMatch(/No locator for this row on this build/);
  });
});

describe("opt-in and platform", () => {
  it("refuses without ENFUSION_GUI=1, next names the switch, nothing runs", async () => {
    const { d, calls } = setup({ extra: { env: {} } });
    const r = await runGui({ action: "toggle", pid: 100, rowId: R.log.id, confirm: true }, d);
    expect(r).toMatchObject({ ok: false, code: "GATED" });
    expect(!r.ok && r.next).toMatch(/set ENFUSION_GUI=1/);
    expect(calls).toHaveLength(0);
  });
  it("refuses off Windows", async () => {
    const { d, calls } = setup({ extra: { platform: "linux" } });
    expect(await runGui({ action: "modals", pid: 100 }, d)).toMatchObject({
      ok: false,
      code: "GATED",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("free-form reads", () => {
  it("tree needs a pid; returns the walker-shaped tree inline", async () => {
    const { d } = setup();
    expect(await runGui({ action: "tree", windowTitle: "World Editor" }, d)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    const r = await runGui({ action: "tree", pid: 100, windowTitle: "World Editor" }, d);
    expect(r.ok && (r.readback as { tree: { name: string } }).tree.name).toBe("World Editor");
  });
  it("find returns hits with paths; without a query it is INVALID_ARGUMENT", async () => {
    const { d } = setup();
    const r = await runGui(
      { action: "find", pid: 100, windowTitle: "World Editor", query: "grid" },
      d,
    );
    expect(r.ok && (r.readback as { hits: Array<{ path: string }> }).hits[0].path).toBe("0/3");
    expect(
      await runGui({ action: "find", pid: 100, windowTitle: "World Editor" }, d),
    ).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
  it("screenshot answers a path relative to the artifacts folder, no home path", async () => {
    const { d, calls, dir } = setup();
    const r = await runGui({ action: "screenshot", label: "x y" }, d);
    expect(r.ok && (r.readback as { file: string }).file).toBe(
      "gui/desktop-x_y-2026-10-10T00-00-00-000Z.png",
    );
    expect(JSON.stringify(r)).not.toContain(dir);
    expect(calls[0].kind).toBe("capture");
  });
  it("screenshot with pid + windowTitle captures that window's rectangle only (W8 run 8)", async () => {
    const { d, calls } = setup();
    const r = await runGui(
      { action: "screenshot", pid: 100, windowTitle: "^World Editor( - .+)?$", label: "sel" },
      d,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const rb = (r as { readback: { file: string; window: { hwnd: number } } }).readback;
    expect(rb.file).toMatch(/^gui\/window-sel-/);
    expect(rb.window.hwnd).toBe(11);
    const cap = calls.find((c) => c.kind === "capture")!;
    expect(cap.env.EMCP_CAPTURE_HWND).toBe("11");
    expect(WINDOW_CAPTURE_SCRIPT).toContain("GetWindowRect");
    expect(WINDOW_CAPTURE_SCRIPT).not.toContain("VirtualScreen");
    const none = await runGui({ action: "screenshot", pid: 100, windowTitle: "^Nope$" }, d);
    expect(none).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    const bare = await runGui({ action: "screenshot", pid: 100 }, d);
    expect(bare).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
  it("modals: baseline first, then the new dialog, report and wait", async () => {
    const { d, state } = setup();
    const first = await runGui({ action: "modals", pid: 100 }, d);
    expect(first.ok && first.warnings.join(" ")).toMatch(/baseline/);
    state.windows = [MAIN, DLG];
    const second = await runGui({ action: "modals", pid: 100 }, d);
    expect(second.ok && second.next).toMatch(/nothing is sent/);
  });
  it("GUI-05: a failing runner yields no argv or script in the answer", async () => {
    const f = fakeRunner({ windows: () => [], fail: true });
    const { d } = setup({ extra: { run: f.run } });
    const r = await runGui({ action: "tree", pid: 100, windowTitle: "X" }, d);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/EncodedCommand|Add-Type/);
  });
});

describe("context: a menu already open, nothing sent", () => {
  const POPUP = win({
    hwnd: 50,
    title: "Arma Reforger Workbench",
    className: "Qt683QWindowPopupDropShadowSaveBits",
  });
  it("no menu open is INVALID_ARGUMENT", async () => {
    const { d, calls } = setup();
    const r = await runGui({ action: "context", pid: 100 }, d);
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(!r.ok && r.message).toMatch(/no context menu/);
    expect(calls.every((c) => c.kind === "list")).toBe(true);
  });
  it("reads the items of the one open popup and leaves it open", async () => {
    const { d, calls } = setup({ windows: [MAIN, POPUP] });
    (d as { run: PowerShellRunner }).run = (() => {
      const f = fakeRunner({
        windows: () => [MAIN, POPUP],
        trees: {
          50: node({
            controlType: "Window",
            children: [
              node({
                controlType: "Menu",
                children: [node({ controlType: "MenuItem", name: "Copy" })],
              }),
            ],
          }),
        },
      });
      return f.run;
    })();
    const r = await runGui({ action: "context", pid: 100 }, d);
    expect(
      r.ok && (r.readback as { items: Array<{ name: string }> }).items.map((i) => i.name),
    ).toEqual(["Copy"]);
    expect(r.ok && r.next).toMatch(/Esc/);
    expect(calls.some((c) => c.kind === "drive")).toBe(false);
  });
  it("two popups is INVALID_ARGUMENT; the authorization window is MODAL_OPEN", async () => {
    expect(
      await runGui(
        { action: "context", pid: 100 },
        setup({ windows: [MAIN, POPUP, { ...POPUP, hwnd: 60 }] }).d,
      ),
    ).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(
      await runGui({ action: "context", pid: 100 }, setup({ windows: [MAIN, POPUP, AUTH] }).d),
    ).toMatchObject({
      code: "MODAL_OPEN",
    });
  });
});

describe("read: a census row by id", () => {
  it("resolves the build file's record and reads the state", async () => {
    const { d, calls } = setup();
    const r = await runGui({ action: "read", pid: 100, rowId: R.grid.id }, d);
    expect(r).toMatchObject({ ok: true, changed: null });
    expect(r.ok && r.readback).toMatchObject({
      rowId: R.grid.id,
      build: BUILD,
      current: true,
      resolved: 1,
      name: "Grid size",
      controlType: "Edit",
      value: "8",
      enabled: true,
      locator: { source: "build-file", evidence: "EV-W8-100" },
    });
    expect(drives(calls).map((x) => x.op)).toEqual(["read"]);
  });
  it("a row with only a 1.8 locator is read through it, marked not current, with a capture for P-W8-02", async () => {
    const { d } = setup();
    const r = await runGui(
      { action: "read", pid: 100, rowId: R.old.id, windowTitle: "World Editor" },
      d,
    );
    expect(r.ok && r.readback).toMatchObject({
      build: "1.8.0.13",
      current: false,
      locator: { source: "ledger" },
      capture: {
        rowId: R.old.id,
        window: { className: CLS, titlePattern: "World Editor" },
        automationId: "file",
        resolved: 1,
        name: "File",
        controlType: "MenuItem",
      },
    });
    expect(r.ok && r.next).toMatch(/drive actions need a 1\.9\.0\.37 locator/);
  });
  it("a 1.8 locator names no title: windowTitle or hwnd is required", async () => {
    const { d } = setup();
    expect(await runGui({ action: "read", pid: 100, rowId: R.old.id }, d)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
  it("no locator at all is NO_LOCATOR; an unknown row is INVALID_ARGUMENT", async () => {
    const { d } = setup();
    expect(
      await runGui({ action: "read", pid: 100, rowId: R.none.id, windowTitle: "W" }, d),
    ).toMatchObject({
      code: "NO_LOCATOR",
    });
    expect(await runGui({ action: "read", pid: 100, rowId: "ui:nope" }, d)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
  it("the element no longer carries the census name: LOCATOR_STALE", async () => {
    const { d, calls } = setup();
    const r = await runGui({ action: "read", pid: 100, rowId: R.moved.id }, d);
    expect(r).toMatchObject({ ok: false, code: "LOCATOR_STALE" });
    expect(!r.ok && r.message).toMatch(/name "Renamed", census "Import"/);
    expect(!r.ok && r.next).toMatch(/no longer matches the census name and type/);
    expect(drives(calls)).toEqual([]);
  });
  it("a label-folded row is judged on its uiaName, not the folded label (review W8-GUI-01)", async () => {
    const folded = row("ui:WE/control/#pack", "Pack Project variants (1)", "Button");
    folded.locator = { ...folded.locator!, uiaName: "Pack Project" };
    const rows = new Map(ROWS);
    rows.set(folded.id, folded);
    const records = new Map(RECORDS);
    records.set(folded.id, rec(folded, { name: "Pack Project" }));
    const r = await runGui(
      { action: "read", pid: 100, rowId: folded.id },
      setup({ records, extra: { rows: () => rows } }).d,
    );
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.readback).toMatchObject({ name: "Pack Project", resolved: 1 });
  });
  it("no element, or two, for the locator: LOCATOR_STALE", async () => {
    const gone = new Map(RECORDS);
    gone.set(R.log.id, rec(R.log, { automationId: "absent" }));
    const r = await runGui(
      { action: "read", pid: 100, rowId: R.log.id },
      setup({ records: gone }).d,
    );
    expect(r).toMatchObject({ code: "LOCATOR_STALE" });
    expect(!r.ok && r.message).toMatch(/resolves to 0 elements/);
  });
  it("the record's window is not open: MODULE_NOT_OPEN", async () => {
    const { d } = setup({
      windows: [win({ hwnd: 12, title: "Resource Manager", className: CLS })],
    });
    expect(await runGui({ action: "read", pid: 100, rowId: R.log.id }, d)).toMatchObject({
      code: "MODULE_NOT_OPEN",
    });
  });
});

describe("drive actions: refusals before anything is sent", () => {
  it("a row with only a 1.8 locator is refused NO_LOCATOR (OD-3)", async () => {
    const { d, calls } = setup();
    const r = await runGui(
      { action: "invoke", pid: 100, rowId: R.old.id, confirm: true, windowTitle: "World Editor" },
      d,
    );
    expect(r).toMatchObject({ ok: false, code: "NO_LOCATOR" });
    expect(!r.ok && r.message).toMatch(/captured at 1\.8\.0\.13, which P-W8-02 re-resolves/);
    expect(calls).toHaveLength(0);
  });
  it("a free name or path is refused: a row id only", async () => {
    const { d, calls } = setup();
    const r = await runGui({ action: "invoke", pid: 100, name: "Log Console", confirm: true }, d);
    expect(r).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(!r.ok && r.message).toMatch(/census row id/);
    expect(calls).toHaveLength(0);
  });
  it.each([
    ["the ledger's risk rows", R.risky.id, /risk "destructive"/],
    ["a dialog commit button", R.ok.id, /dialog commit button/],
    ["a deny-listed label (Exit)", R.exit.id, /deny list/],
    ["a deny-listed label (Pack Project)", R.pack.id, /deny list/],
  ])("the deny list refuses %s, whatever is enabled", async (_what, rowId, why) => {
    const { d, calls } = setup();
    const r = await runGui({ action: "invoke", pid: 100, rowId, confirm: true }, d);
    expect(r).toMatchObject({ ok: false, code: "NOT_ALLOWLISTED" });
    expect(!r.ok && r.message).toMatch(why);
    expect(calls).toHaveLength(0);
  });
  it("the deny list runs before the locator check", async () => {
    const noRecs = new Map<string, LocatorRecord>();
    const r = await runGui(
      { action: "invoke", pid: 100, rowId: R.exit.id },
      setup({ records: noRecs }).d,
    );
    expect(r).toMatchObject({ code: "NOT_ALLOWLISTED" });
  });
  it("the resolved element's own name is deny-checked too", async () => {
    const odd = new Map(RECORDS);
    const r0 = row("ui:WE/control/#ok2", null, "Button");
    odd.set(r0.id, rec(r0, { automationId: "ok", name: "OK" }));
    const rows = new Map(ROWS);
    rows.set(r0.id, { ...r0, label: null });
    const { d, calls } = setup({ records: odd, extra: { rows: () => rows } });
    // rec.name "OK" is caught before the snapshot.
    expect(
      await runGui({ action: "invoke", pid: 100, rowId: r0.id, confirm: true }, d),
    ).toMatchObject({
      code: "NOT_ALLOWLISTED",
    });
    expect(drives(calls)).toEqual([]);
  });
  it("GATED when the action is not in gui.actions_enabled", async () => {
    const { d, calls } = setup({ gui: { rows_enabled: [R.log.id] } });
    const r = await runGui({ action: "toggle", pid: 100, rowId: R.log.id, confirm: true }, d);
    expect(r).toMatchObject({ code: "GATED" });
    expect(!r.ok && r.message).toMatch(/gui\.actions_enabled/);
    expect(calls).toHaveLength(0);
  });
  it("GATED when the row is not in gui.rows_enabled; no gui block at all is GATED", async () => {
    const r = await runGui(
      { action: "toggle", pid: 100, rowId: R.log.id, confirm: true },
      setup({ gui: { actions_enabled: ALL_ACTIONS, rows_enabled: [] } }).d,
    );
    expect(r).toMatchObject({ code: "GATED" });
    expect(!r.ok && r.message).toMatch(/gui\.rows_enabled/);
    expect(
      await runGui(
        { action: "toggle", pid: 100, rowId: R.log.id },
        setup({ gui: undefined, extra: { policy: () => POLICY_FILE } }).d,
      ),
    ).toMatchObject({ code: "GATED" });
  });
  it.each([
    ["a bare row id", R.log.id],
    ["an entry of another build", { id: R.log.id, build: "1.8.0.13", evidence: "EV-1" }],
    ["an entry without evidence", { id: R.log.id, build: BUILD }],
  ])("UNPROVEN for %s", async (_what, entry) => {
    const { d, calls } = setup({ gui: { actions_enabled: ALL_ACTIONS, rows_enabled: [entry] } });
    expect(
      await runGui({ action: "toggle", pid: 100, rowId: R.log.id, confirm: true }, d),
    ).toMatchObject({
      code: "UNPROVEN",
    });
    expect(calls).toHaveLength(0);
  });
  it("gateRefusal: a prefix entry enables the rows under it", () => {
    const p = {
      gui: {
        actions_enabled: ["toggle"],
        rows_enabled: [{ id: "ui:WE/*", build: BUILD, evidence: "EV-9" }],
      },
    };
    expect(gateRefusal(p, "toggle", "ui:WE/control/#x", BUILD)).toBeNull();
    expect(gateRefusal(p, "toggle", "ui:RM/control/#x", BUILD)?.code).toBe("GATED");
  });
  it("MODAL_HAZARD: a row that opens a dialog with no proven Cancel", async () => {
    const { d, calls } = setup();
    const r = await runGui({ action: "invoke", pid: 100, rowId: R.imp.id, confirm: true }, d);
    expect(r).toMatchObject({ code: "MODAL_HAZARD" });
    expect(calls).toHaveLength(0);
    const recorded = new Map(RECORDS);
    recorded.set(R.hier.id, rec(R.hier, { opensDialog: true }));
    expect(
      await runGui(
        { action: "invoke", pid: 100, rowId: R.hier.id, confirm: true },
        setup({ records: recorded }).d,
      ),
    ).toMatchObject({ code: "MODAL_HAZARD" });
  });
  it("a proven Cancel lifts MODAL_HAZARD", async () => {
    const proven = new Map(RECORDS);
    proven.set(R.imp.id, rec(R.imp, { opensDialog: true, cancelProven: true }));
    const r = await runGui(
      { action: "invoke", pid: 100, rowId: R.imp.id },
      setup({ records: proven }).d,
    );
    expect(r.ok).toBe(true);
  });
  it("MODAL_OPEN when a dialog is already open (no baseline needed); nothing is driven", async () => {
    const { d, calls } = setup({ windows: [MAIN, DLG] });
    const r = await runGui({ action: "toggle", pid: 100, rowId: R.log.id, confirm: true }, d);
    expect(r).toMatchObject({ code: "MODAL_OPEN" });
    expect(!r.ok && r.message).toMatch(/"Open"/);
    expect(drives(calls)).toEqual([]);
  });
  it("setValue needs a value; a field without the Value pattern is INVALID_ARGUMENT", async () => {
    const { d, calls } = setup();
    expect(
      await runGui({ action: "setValue", pid: 100, rowId: R.grid.id, confirm: true }, d),
    ).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    const r = await runGui(
      { action: "setValue", pid: 100, rowId: R.log.id, value: "1", confirm: true },
      d,
    );
    expect(r).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(!r.ok && r.message).toMatch(/no Value pattern/);
    expect(drives(calls)).toEqual([]);
  });
  it("a pid is required", async () => {
    expect(await runGui({ action: "toggle", rowId: R.log.id }, setup().d)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});

describe("drive actions: dry run and act", () => {
  it("without confirm: a dry run that reads, never acts", async () => {
    const { d, calls } = setup();
    const r = await runGui({ action: "toggle", pid: 100, rowId: R.log.id }, d);
    expect(r).toMatchObject({ ok: true, changed: null });
    expect(r.ok && r.readback).toMatchObject({
      dryRun: true,
      acted: false,
      before: { toggleState: "Off" },
    });
    expect(r.ok && r.next).toMatch(/confirm: true/);
    expect(drives(calls).map((x) => x.op)).toEqual(["read"]);
  });
  it.each([
    ["invoke", R.hier.id, null],
    ["expand", R.hier.id, "expandState"],
    ["toggle", R.log.id, "toggleState"],
    ["select", R.hier.id, "selected"],
  ])(
    "%s with confirm acts through its pattern on the resolved path",
    async (action, rowId, field) => {
      const { d, calls } = setup();
      const r = await runGui({ action, pid: 100, rowId, confirm: true }, d);
      expect(r.ok).toBe(true);
      const sent = drives(calls);
      expect(sent.map((x) => x.op)).toEqual([action]);
      expect(sent[0]).toMatchObject({
        path: rowId === R.log.id ? "0/1" : "0/2",
        controlType: rowId === R.log.id ? "CheckBox" : "Button",
      });
      expect(r.ok && r.readback).toMatchObject({ acted: true, modals: [] });
      const changed = r.ok ? (r.changed ?? []) : [];
      expect(changed.map((c) => c.path)).toEqual(field ? [`${rowId}#${field}`] : []);
    },
  );
  it("setValue answers previous and readback; the value travels as text", async () => {
    const { d, calls } = setup();
    const r = await runGui(
      { action: "setValue", pid: 100, rowId: R.grid.id, value: "12.5", confirm: true },
      d,
    );
    expect(r.ok && r.readback).toMatchObject({ previous: "8", readback: "12.5" });
    expect(calls.find((c) => c.kind === "drive")!.env.EMCP_GUI_VALUE).toBe("12.5");
  });
  it("a dialog raised by the act is reported, with next naming dismiss", async () => {
    const { d, state } = setup({ onAct: () => void (state.windows = [MAIN, DLG]) });
    const r = await runGui({ action: "invoke", pid: 100, rowId: R.hier.id, confirm: true }, d);
    expect(
      r.ok && (r.readback as { modals: Array<{ title: string }> }).modals.map((m) => m.title),
    ).toEqual(["Open"]);
    expect(r.ok && r.next).toMatch(/dismiss/);
    expect(r.ok && r.warnings.join(" ")).toMatch(/a dialog opened/);
  });
  it.each([
    [{ ok: false, code: "mismatch", reason: "moved", acted: false }, "LOCATOR_STALE"],
    [{ ok: false, code: "gone", reason: "gone", acted: false }, "LOCATOR_STALE"],
    [
      { ok: false, code: "disabled", reason: "the element is disabled", acted: false },
      "INVALID_ARGUMENT",
    ],
    [{ ok: false, code: "read-only", reason: "ro", acted: false }, "INVALID_ARGUMENT"],
    ["fail", "HANDLER_ERROR"],
  ])("a driver answer %j maps to %s", async (answer, code) => {
    const { d } = setup({ drive: (req) => (req.op === "read" ? undefined : answer) });
    const r = await runGui({ action: "toggle", pid: 100, rowId: R.log.id, confirm: true }, d);
    expect(r).toMatchObject({ ok: false, code });
    if (code === "HANDLER_ERROR") expect(!r.ok && r.next).toMatch(/may have happened/);
  });
});

describe("dismiss: Cancel, Close or No only (OD-4)", () => {
  it("GATED until gui.actions_enabled lists dismiss", async () => {
    const { d, calls } = setup({ windows: [MAIN, DLG], gui: { actions_enabled: ["invoke"] } });
    expect(await runGui({ action: "dismiss", pid: 100 }, d)).toMatchObject({ code: "GATED" });
    expect(calls).toHaveLength(0);
  });
  it("presses Cancel (mnemonic ignored), never OK, and reports the dialog closed", async () => {
    const { d, calls, state } = setup({
      windows: [MAIN, DLG],
      onAct: () => void (state.windows = [MAIN]),
    });
    const r = await runGui({ action: "dismiss", pid: 100, dialog: "Open" }, d);
    expect(r.ok && r.readback).toMatchObject({
      dialog: "Open",
      pressed: "Cancel",
      dismissed: true,
    });
    const sent = drives(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ op: "invoke", name: "&Cancel", path: "0/2" });
    expect(calls.find((c) => c.kind === "drive")!.env.EMCP_GUI_HWND).toBe("40");
  });
  it("No when there is no Cancel or Close; never Yes", async () => {
    const { d, calls } = setup({ windows: [MAIN, YESNO] });
    const r = await runGui({ action: "dismiss", pid: 100 }, d);
    expect(r.ok && r.readback).toMatchObject({ pressed: "No", dismissed: false });
    expect(r.ok && r.next).toMatch(/still open/);
    expect(drives(calls)[0].name).toBe("No");
  });
  it("a dialog with only commit buttons is NOT_ALLOWLISTED; nothing is pressed", async () => {
    const { d, calls } = setup({ windows: [MAIN, OKONLY] });
    const r = await runGui({ action: "dismiss", pid: 100 }, d);
    expect(r).toMatchObject({ code: "NOT_ALLOWLISTED" });
    expect(!r.ok && r.message).toMatch(/no Cancel, Close or No button \(it shows: "OK"\)/);
    expect(drives(calls)).toEqual([]);
  });
  it("the authorization window is never answered", async () => {
    const { d, calls } = setup({ windows: [MAIN, AUTH] });
    expect(await runGui({ action: "dismiss", pid: 100 }, d)).toMatchObject({
      code: "NOT_ALLOWLISTED",
    });
    expect(drives(calls)).toEqual([]);
  });
  it("no dialog, an unknown title, or two dialogs without a title: INVALID_ARGUMENT", async () => {
    expect(await runGui({ action: "dismiss", pid: 100 }, setup().d)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(
      await runGui(
        { action: "dismiss", pid: 100, dialog: "Nope" },
        setup({ windows: [MAIN, DLG] }).d,
      ),
    ).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    const r = await runGui(
      { action: "dismiss", pid: 100 },
      setup({ windows: [MAIN, DLG, YESNO] }).d,
    );
    expect(r).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(!r.ok && r.message).toMatch(/2 dialogs are open/);
  });
  it("no button it presses is a commit button", () => {
    const commit = DIALOG_COMMIT_BUTTONS.map((b) => b.toLowerCase());
    for (const b of ["Cancel", "Close", "No"]) expect(commit).not.toContain(b.toLowerCase());
  });
});

describe("the deny list source", () => {
  it("comes from execute_action.deny_list_seed and deny_lists labels", () => {
    expect(denyLabels(POLICY_FILE)).toEqual(
      expect.arrayContaining(["Exit", "Pack Project", "Publish", "Login"]),
    );
  });
});
