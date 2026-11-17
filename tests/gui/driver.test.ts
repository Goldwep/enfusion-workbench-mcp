import { describe, expect, it } from "vitest";
import {
  ACTION_PATTERN,
  DISMISS_BUTTONS,
  DRIVER_CSHARP,
  DRIVE_ACTIONS,
  buildDriverScript,
  checkDialogs,
  describeDialog,
  openDialogs,
  runDriver,
  type DriverRequest,
} from "../../src/gui/driver.js";
import type { PowerShellRunner } from "../../src/gui/uia.js";
import { fakeRunner, win } from "./fake-runner.js";

const STATE = {
  name: "Log Console",
  controlType: "CheckBox",
  automationId: "dock.log",
  enabled: true,
  value: null,
  readOnly: null,
  toggleState: "Off",
  expandState: null,
  selected: null,
};

function driveRunner(answer: (env: Record<string, string>) => unknown): {
  run: PowerShellRunner;
  calls: Array<Record<string, string>>;
} {
  const calls: Array<Record<string, string>> = [];
  const run: PowerShellRunner = async (script, opts) => {
    if (!script.includes("EmcpGuiDrive]::Run")) {
      return { ok: false, stdout: "", stderr: "", error: "unexpected script" };
    }
    calls.push(opts.env);
    const a = answer(opts.env);
    if (a === "fail")
      return { ok: false, stdout: "", stderr: "x", error: "PowerShell exited with code 1" };
    return {
      ok: true,
      stdout: `noise\n${typeof a === "string" ? a : JSON.stringify(a)}\n`,
      stderr: "",
      error: null,
    };
  };
  return { run, calls };
}

const REQ: DriverRequest = {
  pid: 100,
  hwnd: 11,
  path: "0/2/1",
  expect: { automationId: "dock.log", name: "Log Console", controlType: "CheckBox" },
  op: "toggle",
};

describe("the driver script (rule 1.2.8, OD-2)", () => {
  it("synthesises no input: no SendInput, key or mouse event, window message, focus or foreground", () => {
    const s = buildDriverScript();
    expect(s).not.toMatch(
      /SendInput|keybd_event|mouse_event|SetCursorPos|PostMessage|SendMessage|SetForegroundWindow|SetFocus|SendKeys|user32/i,
    );
  });
  it("acts only through the five patterns, each named by the action table", () => {
    expect(Object.keys(ACTION_PATTERN).sort()).toEqual([...DRIVE_ACTIONS].sort());
    for (const call of [".Invoke()", ".Expand()", ".Toggle()", ".Select()", ".SetValue("]) {
      expect(DRIVER_CSHARP).toContain(call);
    }
    expect(DRIVER_CSHARP).not.toMatch(/\.Collapse\(|\.Close\(|AddToSelection|RemoveFromSelection/);
  });
  it("carries every caller value in the environment, never in the script text", () => {
    const s = buildDriverScript();
    expect(s).toContain("$env:EMCP_GUI_DRIVE");
    expect(s).toContain("$env:EMCP_GUI_VALUE");
    expect(s).not.toContain("Log Console");
  });
  it("re-checks the element's id, name and type before anything is done", () => {
    expect(DRIVER_CSHARP).toMatch(/"mismatch", "the element at the path is not the resolved one"/);
    expect(DRIVER_CSHARP.indexOf('"mismatch"')).toBeLessThan(DRIVER_CSHARP.indexOf(".Invoke()"));
    expect(DRIVER_CSHARP).toContain('Fail("disabled"');
  });
  it("dismiss presses Cancel, Close or No only (OD-4)", () => {
    expect([...DISMISS_BUTTONS]).toEqual(["Cancel", "Close", "No"]);
  });
});

describe("runDriver", () => {
  it("sends the path, expected identity, op and settle in EMCP_GUI_DRIVE; the value apart", async () => {
    const d = driveRunner(() => ({
      ok: true,
      acted: true,
      before: STATE,
      after: { ...STATE, toggleState: "On" },
    }));
    const r = await runDriver(
      { ...REQ, op: "setValue", value: "1.5", settleMs: 10 },
      { run: d.run },
    );
    expect(r).toMatchObject({ ok: true, acted: true, code: null });
    expect(r.after?.toggleState).toBe("On");
    const env = d.calls[0];
    expect(env.EMCP_GUI_PID).toBe("100");
    expect(env.EMCP_GUI_HWND).toBe("11");
    expect(env.EMCP_GUI_VALUE).toBe("1.5");
    expect(JSON.parse(env.EMCP_GUI_DRIVE)).toEqual({
      path: "0/2/1",
      automationId: "dock.log",
      name: "Log Console",
      controlType: "CheckBox",
      op: "setValue",
      settleMs: 10,
    });
  });
  it("maps a refusal of the script", async () => {
    const d = driveRunner(() => ({
      ok: false,
      code: "mismatch",
      reason: "moved",
      acted: false,
      before: null,
      after: null,
    }));
    expect(await runDriver(REQ, { run: d.run })).toMatchObject({
      ok: false,
      code: "mismatch",
      reason: "moved",
    });
  });
  it("maps a runner failure and unparseable output to code runner", async () => {
    expect(await runDriver(REQ, { run: driveRunner(() => "fail").run })).toMatchObject({
      ok: false,
      code: "runner",
    });
    expect(await runDriver(REQ, { run: driveRunner(() => "{not json").run })).toMatchObject({
      ok: false,
      code: "runner",
    });
  });
  it("redacts the strings it answers", async () => {
    const mail = ["a", "b.com"].join("@");
    const d = driveRunner(() => ({
      ok: true,
      acted: false,
      before: { ...STATE, value: mail },
      after: null,
    }));
    const r = await runDriver({ ...REQ, op: "read" }, { run: d.run });
    expect(r.before?.value).toBe("<email>");
  });
});

describe("the modal check (rule 1.2.5)", () => {
  const MAIN = win({ hwnd: 11, title: "Arma Reforger Workbench", className: "Qt683QWindowIcon" });
  it("lists owned dialogs, #32770 boxes and known titles; not popups, tool windows or modules", () => {
    const all = [
      MAIN,
      win({ hwnd: 20, title: "Open", owned: true, className: "Qt683QWindowIcon" }),
      win({ hwnd: 21, title: "Box", className: "#32770" }),
      win({ hwnd: 22, title: "Missing Addon Dependencies", className: "Qt683QWindowIcon" }),
      win({ hwnd: 23, title: "", owned: true, className: "Qt683QWindowPopupDropShadowSaveBits" }),
      win({ hwnd: 24, title: "Hierarchy", owned: true, className: "Qt683QWindowToolSaveBits" }),
      win({ hwnd: 25, title: "World Editor", className: "Qt683QWindowIcon" }),
      win({ hwnd: 26, title: "Hidden", owned: true, visible: false }),
      win({ hwnd: 27, pid: 7, title: "Other", owned: true }),
    ];
    expect(openDialogs(all, 100).map((w) => w.hwnd)).toEqual([20, 21, 22]);
  });
  it("needs no baseline: a dialog open before the first look is seen", async () => {
    const f = fakeRunner({ windows: () => [MAIN, win({ hwnd: 20, title: "Open", owned: true })] });
    const r = await checkDialogs(100, { run: f.run });
    expect(r.ok).toBe(true);
    expect(r.dialogs.map(describeDialog)).toEqual([
      { hwnd: 20, title: "Open", className: "QtWindow", owned: true },
    ]);
  });
  it("reports a failed window list", async () => {
    const f = fakeRunner({ windows: () => [], fail: true });
    expect((await checkDialogs(100, { run: f.run })).ok).toBe(false);
  });
});
