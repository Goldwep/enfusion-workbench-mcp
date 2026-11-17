import { describe, expect, it } from "vitest";
import {
  AUTH_WINDOW_TITLE,
  DEFAULT_POLICY,
  ModalWatchdog,
  decide,
  detectModals,
  loadModalPolicy,
  modalPolicyFrom,
  type ModalReport,
} from "../../src/gui/modal-watchdog.js";
import { fakeRunner, node, win } from "./fake-runner.js";

const MAIN = win({ hwnd: 11, title: "World Editor" });
const dialogTree = node({
  controlType: "Window",
  name: "Save changes?",
  children: [
    node({ controlType: "Button", name: "Save" }),
    node({ controlType: "Button", name: "Cancel" }),
  ],
});

function report(p: Partial<ModalReport>): ModalReport {
  return {
    hwnd: 1,
    title: "X",
    className: "C",
    owned: false,
    buttons: ["Cancel"],
    basis: "baseline",
    authorization: false,
    ...p,
  };
}

describe("policy", () => {
  it("today's policy.json lists no watchdog answers: report and wait", () => {
    // policy.json carries live_lane.modal_watchdog.answers = [] (the written-down default).
    expect(loadModalPolicy().answers).toEqual([]);
    expect(decide(report({}), DEFAULT_POLICY).decision).toBe("report-and-wait");
  });
  it("answers only on exact title, class and a button the tree showed", () => {
    const p = modalPolicyFrom({
      live_lane: {
        modal_watchdog: { answers: [{ titleMatches: "X", classMatches: "C", button: "Cancel" }] },
      },
    });
    expect(decide(report({}), p).decision).toBe("answer");
    expect(decide(report({ title: "x" }), p).decision).toBe("report-and-wait");
    expect(decide(report({ className: "D" }), p).decision).toBe("report-and-wait");
    expect(decide(report({ buttons: ["OK"] }), p).decision).toBe("report-and-wait");
  });
  it("NEVER answers the authorization prompt, even with a rule naming it", () => {
    const p = modalPolicyFrom({
      dry_run: {
        modal_watchdog: { answers: [{ titleMatches: AUTH_WINDOW_TITLE, button: "Yes" }] },
      },
    });
    const d = decide(
      report({ title: AUTH_WINDOW_TITLE, buttons: ["Yes", "No"], authorization: true }),
      p,
    );
    expect(d.decision).toBe("report-and-wait");
    const d2 = decide(report({ title: AUTH_WINDOW_TITLE, buttons: ["Yes"] }), p);
    expect(d2.decision).toBe("report-and-wait");
  });
});

describe("detection (DEC-042 U6: a new unowned window of the pid)", () => {
  it("reports new windows, skips menu popups and the baseline", () => {
    const now = [
      MAIN,
      win({ hwnd: 20, title: "Save changes?", owned: true }),
      win({ hwnd: 21, title: "Crash", owned: false }),
      win({ hwnd: 22, className: "Qt683QWindowPopupDropShadowSaveBits" }),
      win({ hwnd: 23, className: "SysShadow" }),
      win({ hwnd: 24, title: "Elsewhere", pid: 5 }),
    ];
    expect(detectModals([MAIN], now, 100).map((m) => [m.window.hwnd, m.basis])).toEqual([
      [20, "baseline"],
      [21, "new-window"],
    ]);
  });
  it("takes the Win32 dialog class and an owned window for a prompt, not a Qt tool window", () => {
    const now = [
      MAIN,
      win({ hwnd: 40, title: "Engine hazard", className: "#32770" }),
      win({ hwnd: 41, title: "Dock", owned: true, className: "Qt683QWindowToolSaveBits" }),
      win({ hwnd: 42, title: "Script Editor" }),
    ];
    expect(detectModals([MAIN], now, 100).map((m) => [m.window.hwnd, m.basis])).toEqual([
      [40, "baseline"],
      [41, "new-window"],
      [42, "new-window"],
    ]);
  });
  it("without a baseline reports only known modal titles", () => {
    const now = [MAIN, win({ hwnd: 30, title: AUTH_WINDOW_TITLE, owned: true })];
    expect(detectModals(null, now, 100).map((m) => [m.window.hwnd, m.basis])).toEqual([
      [30, "known-title"],
    ]);
  });
});

describe("ModalWatchdog.watch", () => {
  it("takes a baseline, then reports a new dialog with its buttons and waits", async () => {
    let windows = [MAIN];
    const f = fakeRunner({ windows: () => windows, trees: { 20: dialogTree } });
    const wd = new ModalWatchdog({ run: f.run }, () => DEFAULT_POLICY);
    const first = await wd.watch(100);
    expect(first.baselineTaken).toBe(true);
    expect(first.modals).toEqual([]);
    windows = [MAIN, win({ hwnd: 20, title: "Save changes?", owned: true })];
    const second = await wd.watch(100);
    expect(second.modals).toHaveLength(1);
    expect(second.modals[0]).toMatchObject({
      title: "Save changes?",
      owned: true,
      buttons: ["Save", "Cancel"],
    });
    expect(second.modals[0].decision.decision).toBe("report-and-wait");
    // Read-only: only the list and walk scripts ran.
    expect(f.calls.every((c) => c.kind === "list" || c.kind === "walk")).toBe(true);
  });
  it("lists a module window apart from the modals until a rebaseline takes it in", async () => {
    let windows = [MAIN];
    const f = fakeRunner({ windows: () => windows, trees: { 20: dialogTree } });
    const wd = new ModalWatchdog({ run: f.run }, () => DEFAULT_POLICY);
    await wd.watch(100);
    windows = [MAIN, win({ hwnd: 42, title: "Script Editor" })];
    const second = await wd.watch(100);
    expect(second.modals).toEqual([]);
    expect(second.newWindows).toEqual([
      { hwnd: 42, title: "Script Editor", className: "QtWindow", owned: false },
    ]);
    const again = await wd.watch(100, { rebaseline: true });
    expect(again.baselineTaken).toBe(true);
    expect(again.newWindows).toEqual([]);
    // A dialog opened after the rebaseline is still a modal.
    windows = [...windows, win({ hwnd: 20, title: "Save changes?", owned: true })];
    const third = await wd.watch(100);
    expect(third.newWindows).toEqual([]);
    expect(third.modals.map((m) => m.hwnd)).toEqual([20]);
  });
  it("reports an authorization prompt open at the first look and waits", async () => {
    const f = fakeRunner({ windows: () => [MAIN, win({ hwnd: 30, title: AUTH_WINDOW_TITLE })] });
    const r = await new ModalWatchdog({ run: f.run }, () => DEFAULT_POLICY).watch(100);
    expect(r.modals[0]).toMatchObject({ authorization: true, basis: "known-title" });
    expect(r.modals[0].decision.decision).toBe("report-and-wait");
  });
});
