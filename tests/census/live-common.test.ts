import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import {
  DISMISS_RULES,
  EXIT,
  LIVE_KINDS,
  MODULE_TITLES,
  ORDINAL_NOTE,
  StopBattery,
  insideRunDir,
  isExpectedDialog,
  isPropertyGrid,
  laneArgv,
  moduleTitle,
  obsFilePath,
  projectState,
  stateAxes,
  stateFor,
  stateTag,
  buildWalkerQueue,
  chooseKey,
  deriveId,
  dismissedLine,
  isPopupPairWindow,
  kindOf,
  objectNameOf,
  moduleWindowObjectName,
  parseState,
  runWalker,
  runWalkerSteps,
  stateKey,
  validateLine,
  windowVerdict,
  baselineRefusal,
  isDialogWindow,
  isTooltipWindow,
  TOOLTIP_WINDOW_CLASSES,
  BUSY_GRACE_MS,
  isBusyOnlyChange,
  isBusyWindow,
  isProgressWindow,
  watched,
  rekeyDockTabs,
  DOCK_TAB_NOTE,
  type LiveObservation,
  type WalkerDef,
  type WalkerDeps,
  type WalkerStep,
} from "../../scripts/census/live/common.js";
import * as train2 from "../live/train2.live.js";
import {
  attributeSharedChrome,
  mergeObservations,
  run as runNormalise,
} from "../../scripts/census/live/normalise.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-common-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const SHA_A = "1e929f2d8f97fc025c023b5575c85feb8dcad73fcedce450c4f9b03f978f8276";
const SHA_B = "467577f5857cba1da425905bc6231a1a0b292ed8c87c070b0eb7d4f48d1ae195";

// The two worked examples of design section 1.4.
const MENU_FILE: LiveObservation = {
  dim: "ui",
  kind: "menu",
  module: "ResourceManager",
  key: { path: ["File"] },
  parent_key: {
    dim: "ui",
    kind: "window",
    module: "ResourceManager",
    key: { object_name: "<from L01>" },
  },
  origin: "vanilla",
  label: "File",
  label_raw: "File",
  locator: { menuPath: ["File"], controlType: "MenuItem", windowClass: "Qt683QWindowIcon" },
  observed_state: { mode: "edit", selection: "none" },
  risk_hint: "safe",
  modal: "none",
  ref: `artifact:${SHA_A}#m/File`,
  confidence: "high",
};
const OPTIONS_SHORTCUTS: LiveObservation = {
  dim: "ui",
  kind: "tab",
  module: "Shared",
  key: { path: ["Options", "Shortcuts"] },
  parent_key: {
    dim: "ui",
    kind: "dialog",
    module: "Shared",
    key: { object_name: "MainOptionsDialog" },
  },
  origin: "vanilla",
  label: "Shortcuts",
  label_raw: "Shortcuts",
  locator: {
    automationId: "Arma4WorkbenchApp.MainOptionsDialog.QListWidget",
    controlType: "ListItem",
    windowClass: "Qt683QWindowIcon",
  },
  observed_state: { mode: "edit", selection: "none" },
  risk_open_hint: "safe",
  modal: "none",
  ref: `artifact:${SHA_B}#n/0/5/6`,
  confidence: "high",
};

describe("observation line", () => {
  it("the two worked examples validate and derive the design's ids", () => {
    expect(validateLine(MENU_FILE, "L02")).toEqual([]);
    expect(deriveId(MENU_FILE)).toBe("ui:ResourceManager/menu/File");
    expect(validateLine(OPTIONS_SHORTCUTS, "L04")).toEqual([]);
    expect(deriveId(OPTIONS_SHORTCUTS)).toBe("ui:Shared/tab/Options/Shortcuts");
    expect(
      deriveId({
        dim: "ui",
        kind: "dialog",
        module: "Shared",
        key: { object_name: "MainOptionsDialog" },
      }),
    ).toBe("ui:Shared/dialog/#MainOptionsDialog");
  });
  it("refuses D5 fields, control_type off L01, a missing state, a bad ref, an unregistered kind", () => {
    expect(validateLine({ ...MENU_FILE, id: "x" }, "L02").join()).toContain('"id"');
    expect(validateLine({ ...MENU_FILE, what: "x" }, "L02").join()).toContain('"what"');
    expect(validateLine({ ...MENU_FILE, control_type: "MenuItem" }, "L02").join()).toContain(
      "only for L01",
    );
    const { observed_state: _s, ...noState } = MENU_FILE;
    expect(validateLine(noState, "L02").join()).toContain("observed_state");
    expect(validateLine({ ...MENU_FILE, ref: "artifact:abc" }, "L02").join()).toContain("ref");
    expect(validateLine(MENU_FILE, "L05").join()).toContain("not registered for L05");
    expect(validateLine({ ...MENU_FILE, label: "Fil" }, "L02").join()).toContain("normalizeLabel");
    expect(
      validateLine({ ...MENU_FILE, key: { path: ["File"], object_name: "x" } }, "L02").join(),
    ).toContain("exactly");
  });
  it("a dismissed line has the L01 shape build.ts and G4 read", () => {
    const { kind: _k, confidence: _c, ...base } = MENU_FILE;
    const d = dismissedLine(
      { ...base, module: "WorldEditor", parent_key: null },
      "ScrollBar",
      "structural-scrollbar",
    );
    expect(validateLine(d, "L01")).toEqual([]);
    expect(d).toMatchObject({
      kind: "region",
      control_type: "ScrollBar",
      dismissed_by: "structural-scrollbar",
    });
  });
  it("stateKey sorts the axes as the build does", () => {
    expect(stateKey({ selection: "none", mode: "edit" })).toBe("mode=edit;selection=none");
    expect(parseState("mode=edit,selection=entity")).toEqual({ mode: "edit", selection: "entity" });
    expect(typeof parseState("mode=fly")).toBe("string");
  });
});

describe("kind table (D6)", () => {
  it("maps the rows of section 1.2 top-down", () => {
    expect(kindOf({ controlType: "Window", isModuleRoot: true })).toEqual({ kind: "window" });
    expect(kindOf({ controlType: "Window", className: "QDockWidget" })).toEqual({ kind: "dock" });
    expect(kindOf({ controlType: "Window", className: "MainOptionsDialog" })).toEqual({
      kind: "dialog",
    });
    expect(kindOf({ controlType: "MenuItem", underAppMenuBar: true })).toEqual({ kind: "menu" });
    expect(kindOf({ controlType: "MenuItem", inMenuPopup: true, hasSubPopup: true })).toEqual({
      kind: "menu",
    });
    expect(kindOf({ controlType: "MenuItem", inMenuPopup: true })).toEqual({ kind: "menu-item" });
    expect(kindOf({ controlType: "MenuBar", name: "System" })).toEqual({
      dismissed: "system-menu",
    });
    expect(kindOf({ controlType: "ToolBar" })).toEqual({ kind: "toolbar" });
    expect(kindOf({ controlType: "Button", className: "QToolButton", underToolBar: true })).toEqual(
      {
        kind: "toolbar-button",
      },
    );
    expect(kindOf({ controlType: "Tab", className: "QTabBar" })).toEqual({ kind: "panel" });
    expect(kindOf({ controlType: "ListItem", pageListItem: true })).toEqual({ kind: "tab" });
    expect(kindOf({ controlType: "Tree", className: "PropertyGrid" })).toEqual({
      kind: "property-group",
    });
    expect(kindOf({ controlType: "TreeItem", inPropertyGrid: true })).toEqual({ kind: "property" });
    expect(kindOf({ controlType: "Text", underStatusBar: true })).toEqual({
      dismissed: "empty-label",
    });
    expect(kindOf({ controlType: "Menu", contextPopup: true })).toEqual({ kind: "context-menu" });
    expect(kindOf({ controlType: "MenuItem", inContextPopup: true })).toEqual({
      kind: "context-item",
    });
    expect(kindOf({ controlType: "Edit" })).toEqual({ kind: "control" });
    expect(kindOf({ controlType: "ScrollBar" })).toEqual({ dismissed: "structural-scrollbar" });
    expect(kindOf({ controlType: "Group", childCount: 1 })).toEqual({
      dismissed: "structural-group",
    });
  });
  it("Text folds into an editable control's label or is dismissed; items outside a dock or dialog defer", () => {
    expect(kindOf({ controlType: "Text", name: "Name", labelsEditable: true })).toEqual({
      foldLabel: true,
    });
    expect(kindOf({ controlType: "Text", name: "Hello" })).toEqual({ dismissed: "text-label" });
    expect(kindOf({ controlType: "ListItem", underDockOrDialog: true })).toEqual({
      kind: "control",
    });
    expect("deferred" in kindOf({ controlType: "TreeItem" })).toBe(true);
  });
  it("respects the kinds universes.json registers per enumerator (L01 never emits property)", () => {
    expect(kindOf({ controlType: "TreeItem", inPropertyGrid: true }, "L01")).toEqual({
      outOfScope: "property",
    });
    expect(kindOf({ controlType: "TreeItem", inPropertyGrid: true }, "L06")).toEqual({
      kind: "property",
    });
    expect(kindOf({ controlType: "ListItem", pageListItem: true }, "L04")).toEqual({ kind: "tab" });
  });
});

describe("identity (D7)", () => {
  it("object name only when not a Qt class, not the className, not chrome, and unique", () => {
    expect(objectNameOf("App.worldEditorMain.createDock", "QDockWidget")).toBe("createDock");
    expect(
      objectNameOf("Arma4WorkbenchApp.MainOptionsDialog.QPushButton", "QPushButton"),
    ).toBeNull();
    expect(objectNameOf("X.TitleBar", "Y")).toBeNull();
    expect(objectNameOf("X.PropertyGrid", "PropertyGrid")).toBeNull();
    expect(
      chooseKey({ automationId: "A.createDock", ancestorLabels: [], name: "Create" }, () => true)
        .key,
    ).toEqual({
      object_name: "createDock",
    });
    expect(
      chooseKey(
        { automationId: "A.createDock", ancestorLabels: ["W"], name: "Create" },
        () => false,
      ).key,
    ).toEqual({ path: ["W", "Create"] });
    expect(
      chooseKey(
        {
          automationId: "A.MainOptionsDialog.QPushButton",
          className: "QPushButton",
          ancestorLabels: ["Options"],
          name: "OK",
        },
        () => true,
      ).key,
    ).toEqual({ path: ["Options", "OK"] });
  });
  it("an empty name gets @class.n, low confidence and the ordinal note", () => {
    const id = chooseKey(
      { className: "QToolButton", ancestorLabels: ["Main"], name: "", unnamedOrdinal: 2 },
      () => true,
    );
    expect(id).toEqual({
      key: { path: ["Main", "@QToolButton.2"] },
      confidence: "low",
      unverified: [ORDINAL_NOTE],
    });
  });
});

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

describe("window rule parity with train2", () => {
  it("train2 re-exports the same functions", () => {
    expect(train2.windowVerdict).toBe(windowVerdict);
    expect(train2.EXIT).toBe(EXIT);
  });
  it("without options it is train2's rule exactly", () => {
    expect(windowVerdict({ added: [win("x", 1, "#32770", 2)], disabled: [] }, [/x/])?.kind).toBe(
      "handoff",
    );
    expect(windowVerdict({ added: [win("Other", 1)], disabled: [] }, [/World Editor/])?.kind).toBe(
      "stopped",
    );
    expect(
      windowVerdict({ added: [win("World Editor - x", 1)], disabled: [] }, [/^World Editor - .+$/]),
    ).toBeNull();
    expect(
      windowVerdict({ added: [win("Arma Reforger Workbench", 1)], disabled: [] }, undefined),
    ).toBeNull();
    // the popup pair is a stop for a step that does not admit it
    expect(
      windowVerdict(
        { added: [win("", 2, "Qt683QWindowPopupDropShadowSaveBits")], disabled: [] },
        undefined,
      )?.kind,
    ).toBe("stopped");
  });
  it("the popup pair is benign for a menu walk; an owned popup stays a handoff", () => {
    const pair = [win("", 2, "Qt683QWindowPopupDropShadowSaveBits"), win("", 3, "SysShadow")];
    expect(pair.every(isPopupPairWindow)).toBe(true);
    expect(windowVerdict({ added: pair, disabled: [] }, undefined, { popups: true })).toBeNull();
    expect(
      windowVerdict({ added: [win("Shadow", 3, "SysShadow")], disabled: [] }, undefined, {
        popups: true,
      })?.kind,
    ).toBe("stopped");
    expect(
      windowVerdict(
        { added: [win("", 2, "Qt683QWindowPopupDropShadowSaveBits", 9)], disabled: [] },
        undefined,
        {
          popups: true,
        },
      )?.kind,
    ).toBe("handoff");
  });
  it("L04's own dialog is expected by title and owned flag; any other dialog is a handoff", () => {
    const dialogs = [{ title: "Options", owned: true }];
    expect(
      windowVerdict(
        { added: [win("Options", 5, "Qt683QWindowIcon", 7)], disabled: [] },
        undefined,
        { dialogs },
      ),
    ).toBeNull();
    expect(
      windowVerdict(
        { added: [win("Save World As", 5, "Qt683QWindowIcon", 7)], disabled: [] },
        undefined,
        { dialogs },
      )?.kind,
    ).toBe("handoff");
    expect(
      windowVerdict({ added: [win("Options", 5, "#32770", 7)], disabled: [] }, undefined, {
        dialogs,
      })?.kind,
    ).toBe("handoff");
  });
  it("b-060 (DEC-057): the expected dialog in added explains its disabled owner; nothing else does", () => {
    const dialogs = [{ title: "Options", owned: true }];
    const off = (w: WindowInfo): WindowInfo => ({ ...w, enabled: false });
    const main = off(win("World Editor - x", 7));
    const dialog = win("Options", 5, "Qt683QWindowIcon", 7);
    // the owner the dialog disables, and another unowned top-level window (Qt application modal)
    expect(windowVerdict({ added: [dialog], disabled: [main] }, undefined, { dialogs })).toBeNull();
    expect(
      windowVerdict(
        { added: [dialog], disabled: [main, off(win("Arma Reforger Workbench", 8))] },
        undefined,
        { dialogs },
      ),
    ).toBeNull();
    // an owned disabled window is another dialog: still a handoff, and it is named
    const other = off(win("Save changes", 9, "Qt683QWindowIcon", 8));
    const v = windowVerdict({ added: [dialog], disabled: [main, other] }, undefined, { dialogs });
    expect(v?.kind).toBe("handoff");
    expect(v?.message).toContain('"Save changes"');
    expect(v?.message).not.toContain('"World Editor - x"');
    // no expected dialog up: a disabled window is a handoff as before
    expect(windowVerdict({ added: [], disabled: [main] }, undefined, { dialogs })?.kind).toBe(
      "handoff",
    );
    // a dialog the step did not list does not explain anything
    expect(
      windowVerdict(
        { added: [win("Save World As", 5, "Qt683QWindowIcon", 7)], disabled: [main] },
        undefined,
        { dialogs },
      )?.kind,
    ).toBe("handoff");
    // without options (train2) the rule is unchanged
    expect(windowVerdict({ added: [dialog], disabled: [main] }, undefined)?.kind).toBe("handoff");
  });
});

// ── Tooltips (W3 fix-up 1) ──────────────────────────────────────────────────

describe("tooltips (W3 fix-up 1: run 1 cut w3-03 and w3-11 on MicrosoftWindowsTooltip)", () => {
  it("an untitled enabled tooltip-class window is neither a stop nor a handoff, owned or not", () => {
    for (const cls of TOOLTIP_WINDOW_CLASSES) {
      for (const owner of [0, 7]) {
        const tip = win("", 11, cls, owner);
        expect(isTooltipWindow(tip)).toBe(true);
        expect(isDialogWindow(tip)).toBe(false);
        expect(windowVerdict({ added: [tip], disabled: [] }, [/^String Editor/])).toBeNull();
      }
    }
    // the run 1 window exactly, beside the run's benign tool window and expected editors
    expect(
      windowVerdict(
        {
          added: [
            win("", 1, "MicrosoftWindowsTooltip"),
            win("Arma Reforger Workbench", 2, "Qt683QWindowToolSaveBits"),
            win("String Editor - x", 3),
          ],
          disabled: [],
        },
        [/^String Editor - .+$/],
      ),
    ).toBeNull();
    expect(baselineRefusal([win("", 1, "tooltips_class32", 9)], 4242)).toBeNull();
  });

  it("a real dialog beside a tooltip still hands off; a titled, disabled or other-class window is not a tooltip", () => {
    const tip = win("", 1, "MicrosoftWindowsTooltip");
    expect(
      windowVerdict({ added: [tip, win("Save changes?", 2, "#32770", 5)], disabled: [] }, [])?.kind,
    ).toBe("handoff");
    expect(
      windowVerdict({ added: [tip, win("Other", 3)], disabled: [] }, [/^String Editor/])?.kind,
    ).toBe("stopped");
    expect(isTooltipWindow(win("Tip", 1, "tooltips_class32"))).toBe(false);
    expect(isTooltipWindow({ ...tip, enabled: false })).toBe(false);
    expect(isDialogWindow({ ...tip, enabled: false })).toBe(true);
    expect(isTooltipWindow(win("", 1, "Qt683QWindowIcon", 7))).toBe(false);
    expect(isTooltipWindow(win("", 1, "#32770"))).toBe(false);
    expect(
      windowVerdict({ added: [win("Tip", 1, "MicrosoftWindowsTooltip")], disabled: [] }, [])?.kind,
    ).toBe("stopped");
  });
});

// ── The busy window (W5 fix-up 2) ───────────────────────────────────────────

describe("busy windows (W5 fix-up 2: run 2, GM_Arland load)", () => {
  const off = (w: WindowInfo): WindowInfo => ({ ...w, enabled: false });
  const splash = off(win("Arma Reforger Workbench", 9, "Qt683QWindowToolSaveBits"));
  const editor = win("World Editor - x", 1);

  it("a disabled unowned tool or editor window is busy; owned, #32770, a modal title or another class is not", () => {
    expect(isBusyWindow(splash)).toBe(true);
    expect(isBusyWindow(off(editor))).toBe(true);
    expect(isBusyWindow(win("Arma Reforger Workbench", 9, "Qt683QWindowToolSaveBits"))).toBe(false);
    expect(isBusyWindow(off(win("x", 2, "Qt683QWindowIcon", 7)))).toBe(false);
    expect(isBusyWindow(off(win("x", 2, "#32770")))).toBe(false);
    expect(isBusyWindow(off(win("Script Authorization Required", 2)))).toBe(false);
    expect(isBusyWindow(off(win("x", 2, "OtherClass")))).toBe(false);
  });

  it("the run 2 change is busy only; anything beside it that would stop or hand off is not", () => {
    // Without the grace the rule is unchanged: the run 2 window is a handoff.
    expect(windowVerdict({ added: [splash], disabled: [] }, [/^World Editor - .+$/])?.kind).toBe(
      "handoff",
    );
    expect(isBusyOnlyChange({ added: [splash], disabled: [off(editor)] }, [/^World Editor/])).toBe(
      true,
    );
    expect(
      isBusyOnlyChange({ added: [splash, win("x", 3, "Qt683QWindowIcon", 1)], disabled: [] }, []),
    ).toBe(false);
    expect(isBusyOnlyChange({ added: [splash, win("Other", 3)], disabled: [] }, [])).toBe(false);
    expect(isBusyOnlyChange({ added: [off(win("Unexpected", 3))], disabled: [] }, [])).toBe(false);
    expect(isBusyOnlyChange({ added: [], disabled: [off(win("x", 4, "OtherClass"))] }, [])).toBe(
      false,
    );
    expect(isBusyOnlyChange({ added: [], disabled: [] }, [])).toBe(false);
  });

  const run = async (
    lists: WindowInfo[][],
    grace: number | undefined,
  ): Promise<{ result?: unknown; error?: StopBattery; polls: number }> => {
    let i = 0;
    let polls = 0;
    const deps = {
      windows: async () => {
        polls++;
        return lists[Math.min(i++, lists.length - 1)]!;
      },
      sleep: async () => undefined,
    };
    const abort = new AbortController();
    try {
      const r = await watched(deps, 4242, [/^World Editor - .+$/], abort, async () => "done", {
        busyGraceMs: grace,
      });
      return { result: r.value, polls };
    } catch (e) {
      return { error: e as StopBattery, polls };
    }
  };

  it("watched: a busy window that clears inside the grace is waited out, not a handoff", async () => {
    const base = [editor];
    const r = await run([base, [off(editor), splash], [off(editor), splash], base], BUSY_GRACE_MS);
    expect(r.error).toBeUndefined();
    expect(r.result).toBe("done");
  });

  it("watched: a busy window past the grace is a handoff that says so; without the grace, at once", async () => {
    const base = [editor];
    const stuck = [off(editor), splash];
    const r = await run([base, stuck], 4_000);
    expect(r.error?.kind).toBe("handoff");
    expect(r.error?.message).toMatch(/past the 4000 ms grace/);
    const now = await run([base, stuck], undefined);
    expect(now.error?.kind).toBe("handoff");
    expect(now.error?.message).not.toMatch(/grace/);
  });

  it("watched: an owned window beside a busy one is a handoff at once, grace or not", async () => {
    const base = [editor];
    const r = await run(
      [base, [off(editor), splash, win("Save?", 5, "Qt683QWindowIcon", 1)]],
      BUSY_GRACE_MS,
    );
    expect(r.error?.kind).toBe("handoff");
    // At once: no grace wording (held in the grace, it would only hand off after 30 checks, saying so).
    expect(r.error?.message).not.toMatch(/grace/);
    expect(r.polls).toBeLessThan(5);
  });
});

describe("reload progress windows (W3 fix-up 3: run 3, w3-61 and w3-62)", () => {
  const off = (w: WindowInfo): WindowInfo => ({ ...w, enabled: false });
  const main = win("Enfusion Workbench - EMCP2 sandbox (2.0 live lane)", 1);
  // Run 3 w3-62: the reload's progress window, owned and enabled.
  const progress = win("Arma Reforger Workbench", 8, "Qt683QWindowIcon", 9636142);
  // Run 3 w3-61: the real "Reload" prompt beside the disabled tool window.
  const reload = win("Reload", 6, "Qt683QWindowIcon", 7669974);
  const toolOff = off(win("Arma Reforger Workbench", 9, "Qt683QWindowToolSaveBits"));

  it("an owned editor-class window titled like the app is a progress window; another title, class or #32770 is not", () => {
    expect(isProgressWindow(progress)).toBe(true);
    expect(isProgressWindow(reload)).toBe(false);
    expect(isProgressWindow(win("Arma Reforger Workbench", 8))).toBe(false);
    expect(isProgressWindow(win("Arma Reforger Workbench", 8, "#32770", 5))).toBe(false);
    expect(isProgressWindow(win("Arma Reforger Workbench", 8, "Qt683QWindowToolSaveBits", 5))).toBe(
      false,
    );
  });

  it("graced only with progressWindows; the Reload prompt never is", () => {
    expect(windowVerdict({ added: [progress], disabled: [] }, [])?.kind).toBe("handoff");
    expect(isBusyOnlyChange({ added: [progress], disabled: [] }, [])).toBe(false);
    expect(
      isBusyOnlyChange({ added: [progress], disabled: [] }, [], { progressWindows: true }),
    ).toBe(true);
    expect(
      isBusyOnlyChange({ added: [progress, toolOff], disabled: [off(main)] }, [], {
        progressWindows: true,
      }),
    ).toBe(true);
    expect(
      isBusyOnlyChange({ added: [toolOff, reload], disabled: [] }, [], { progressWindows: true }),
    ).toBe(false);
    expect(
      isBusyOnlyChange({ added: [progress, reload], disabled: [] }, [], { progressWindows: true }),
    ).toBe(false);
  });

  it("the handoff names the Reload prompt, not the disabled tool window beside it", () => {
    const v = windowVerdict({ added: [toolOff, reload], disabled: [] }, []);
    expect(v?.kind).toBe("handoff");
    expect(v?.message).toContain('"Reload"');
  });

  const run = async (lists: WindowInfo[][]): Promise<{ error?: StopBattery; polls: number }> => {
    let i = 0;
    let polls = 0;
    const deps = {
      windows: async () => {
        polls++;
        return lists[Math.min(i++, lists.length - 1)]!;
      },
      sleep: async () => undefined,
    };
    try {
      await watched(deps, 4242, [], new AbortController(), async () => "done", {
        busyGraceMs: 30_000,
        progressWindows: true,
      });
      return { polls };
    } catch (e) {
      return { error: e as StopBattery, polls };
    }
  };

  it("watched: a progress window that goes inside the grace is waited out; one that stays is a handoff; the prompt at once", async () => {
    const base = [main];
    expect((await run([base, [main, progress], [main, progress], base])).error).toBeUndefined();
    const stuck = await run([base, [main, progress]]);
    expect(stuck.error?.kind).toBe("handoff");
    expect(stuck.error?.message).toMatch(/past the 30000 ms grace/);
    const prompt = await run([base, [main, toolOff, reload]]);
    expect(prompt.error?.kind).toBe("handoff");
    expect(prompt.error?.message).not.toMatch(/grace/);
    expect(prompt.error?.message).toContain('"Reload"');
  });
});

// ── Runner and CLI on fakes ─────────────────────────────────────────────────

function fakeDeps(
  files: Map<string, string>,
  windows: () => WindowInfo[] = () => [],
): WalkerDeps & { lines: string[]; beats: number } {
  const d = {
    lines: [] as string[],
    beats: 0,
    windows: async () => windows(),
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => 4242,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => {
      d.beats++;
    },
    exists: (p: string) => files.has(p),
    writeFile: (p: string, t: string, exclusive?: boolean) => {
      if (exclusive && files.has(p)) throw new Error("exists");
      files.set(p, t);
    },
    appendFile: (p: string, t: string) => files.set(p, (files.get(p) ?? "") + t),
    log: (l: string) => d.lines.push(l),
  };
  return d;
}

function step(id: string, over: Partial<WalkerStep> = {}): WalkerStep {
  return {
    id,
    title: `fake ${id}`,
    risk: "read-only",
    timeout_ms: 1000,
    expected: "lines",
    kill_criterion: "any new window",
    side_effects: [],
    rollback: "none",
    plan: () => [
      {
        kind: "uia-read",
        target: {
          pid: "lane-recorded",
          window: { className: "Qt683QWindowIcon", titlePattern: "^World Editor - .+$" },
        },
        readOnly: true,
        view: "control",
        bounds: {
          maxDepth: 60,
          maxNodes: 5000,
          budgetMs: 60000,
          rowSample: 40,
          maxChildren: 500,
          countCap: 5000,
          callTimeoutMs: 5000,
          slowCallMs: 10000,
          maxConsecutiveErrors: 5,
        },
      },
    ],
    run: async (ctx) => {
      await ctx.call("uia-read", async () => 1);
      ctx.emit([
        { ...MENU_FILE, module: "WorldEditor", parent_key: null, observed_state: ctx.opts.state },
      ]);
      return { status: "pass", summary: "1 line" };
    },
    ...over,
  };
}

const opts = (runDir: string) => ({
  enumerator: "L02",
  script: "scripts/census/live/L02-menus.ts",
  session: "P4-1",
  runDir,
  module: "WorldEditor",
  state: { mode: "edit" as const, selection: "none" as const },
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});

describe("runWalkerSteps", () => {
  it("writes the started marker, record and obs file; heartbeat first; never runs a step twice", async () => {
    const files = new Map<string, string>();
    const d = fakeDeps(files);
    const r = await runWalkerSteps([step("s1")], d, opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(d.beats).toBe(1);
    const keys = [...files.keys()].map((k) => k.replace(/\\/g, "/"));
    expect(keys).toContain("/run/s1.started");
    expect(keys).toContain("/run/s1.json");
    expect(keys).toContain("/run/L02-WorldEditor-edit-none.obs.jsonl");
    const rec = JSON.parse([...files.entries()].find(([k]) => k.endsWith("s1.json"))![1]);
    expect(rec).toMatchObject({ step: "s1", status: "pass", cut: false, module: "WorldEditor" });
    const again = await runWalkerSteps([step("s1")], d, opts("/run"));
    expect(again.exit).toBe(EXIT.refused);
  });
  it("a new window stops the step; a dialog hands off; a bad line stops it", async () => {
    let n = 0;
    const stopped = await runWalkerSteps(
      [
        step("s2", {
          run: async (ctx) => {
            await ctx.sleep(1);
            await ctx.sleep(1);
            return { status: "pass", summary: "" };
          },
        }),
      ],
      fakeDeps(new Map(), () => (n++ > 0 ? [win("Stray", 9)] : [])),
      opts("/r2"),
    );
    expect(stopped.exit).toBe(EXIT.stopped);
    n = 0;
    const handoff = await runWalkerSteps(
      [
        step("s3", {
          run: async (ctx) => {
            await ctx.sleep(1);
            return { status: "pass", summary: "" };
          },
        }),
      ],
      fakeDeps(new Map(), () => (n++ > 0 ? [win("Options", 9, "Qt683QWindowIcon", 3)] : [])),
      opts("/r3"),
    );
    expect(handoff.exit).toBe(EXIT.handoff);
    const bad = await runWalkerSteps(
      [
        step("s4", {
          run: async (ctx) => {
            ctx.emit([{ ...MENU_FILE, kind: "property" }]);
            return { status: "pass", summary: "" };
          },
        }),
      ],
      fakeDeps(new Map()),
      opts("/r4"),
    );
    expect(bad.exit).toBe(EXIT.stopped);
  });
  it("P4 F1: an emit file outside the run folder stops the step and writes nothing", async () => {
    expect(insideRunDir("/run", join("/run", "L11-x.obs.jsonl"))).toBe(true);
    expect(insideRunDir("/run", "/elsewhere/x.jsonl")).toBe(false);
    expect(insideRunDir("/run", "../x.jsonl")).toBe(false);
    expect(insideRunDir("/run", "/run")).toBe(false);
    const files = new Map<string, string>();
    const r = await runWalkerSteps(
      [
        step("s6", {
          run: async (ctx) => {
            ctx.emit(
              [{ ...MENU_FILE, module: "WorldEditor", parent_key: null }],
              "/elsewhere/x.jsonl",
            );
            return { status: "pass", summary: "" };
          },
        }),
      ],
      fakeDeps(files),
      opts("/r6"),
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect([...files.keys()].some((k) => k.includes("elsewhere"))).toBe(false);
  });
  it("P4 F6: an acknowledged started marker also refuses the step in that run folder", async () => {
    const files = new Map<string, string>([[join("/r7", "s7.started.acknowledged"), "{}"]]);
    const r = await runWalkerSteps([step("s7")], fakeDeps(files), opts("/r7"));
    expect(r.exit).toBe(EXIT.refused);
    expect(r.message).toMatch(/never run twice/);
  });
  it("P4 F7: a known modal title is never an expected dialog, even when a step lists it", () => {
    const auth = win("Script Authorization Required", 5, "Qt683QWindowIcon", 7);
    expect(isExpectedDialog(auth, [{ title: auth.title, owned: true }])).toBe(false);
    expect(
      windowVerdict({ added: [auth], disabled: [] }, undefined, {
        dialogs: [{ title: auth.title, owned: true }],
      }),
    ).not.toBeNull();
  });
  it("refuses a recorded pid that is not a Workbench image", async () => {
    const d = { ...fakeDeps(new Map()), processImage: () => "notepad.exe" };
    expect((await runWalkerSteps([step("s5")], d, opts("/r5"))).exit).toBe(EXIT.stopped);
  });
});

const DEF: WalkerDef = {
  enumerator: "L02",
  script: "scripts/census/live/L02-menus.ts",
  session: "P4-1",
  defaultModule: "WorldEditor",
  steps: () => [step("p4-l02-a"), step("p4-l02-b")],
};

describe("runWalker CLI", () => {
  it("a dry run checks the plan and writes --out, --outline and --emit-queue", async () => {
    const out = join(TMP, "plan.json");
    const q = join(TMP, "q.json");
    const said: string[] = [];
    const code = await runWalker(
      DEF,
      ["--out", out, "--outline", join(TMP, "o.txt"), "--emit-queue", q],
      {
        out: (l) => said.push(l),
      },
    );
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain("PASS");
    const plan = JSON.parse(readFileSync(out, "utf-8"));
    expect(checkPlan(plan, loadPolicy(), { script: DEF.script }).ok).toBe(true);
    const queue = JSON.parse(readFileSync(q, "utf-8"));
    expect(queue.session).toBe("P4-1");
    expect(validateQueue(queue, false)).toHaveLength(2);
    expect(
      buildWalkerQueue(DEF, DEF.steps({ module: "WorldEditor", state: {}, allowOwned: false })),
    ).toEqual(queue);
  });
  it("usage, live gate and sandbox refusals", async () => {
    const say = () => undefined;
    expect(await runWalker(DEF, ["--bogus"], { out: say })).toBe(EXIT.usage);
    expect(await runWalker(DEF, ["--state", "mode=fly"], { out: say })).toBe(EXIT.usage);
    expect(await runWalker(DEF, ["--module", "Nope"], { out: say })).toBe(EXIT.usage);
    const live = [
      "--really",
      "--id",
      "lane",
      "--module",
      "WorldEditor",
      "--only",
      "p4-l02-a",
      "--run-dir",
      join(TMP, "art", "run"),
    ];
    expect(await runWalker(DEF, [...live, "--sandbox", join(TMP, "other")], { out: say })).toBe(
      EXIT.aborted,
    );
    const sb = ["--sandbox", join(TMP, "EMCP2_sandbox")];
    expect(
      await runWalker(DEF, [...live, ...sb], { out: say, platform: "linux", leaseHeld: true }),
    ).toBe(EXIT.refused);
    expect(
      await runWalker(DEF, [...live, ...sb], { out: say, platform: "win32", leaseHeld: false }),
    ).toBe(EXIT.refused);
  });
  it("a real run on fake deps writes into the run folder inside the artifacts root", async () => {
    const files = new Map<string, string>();
    const runDir = join(TMP, "art", "run2");
    const code = await runWalker(
      DEF,
      [
        "--really",
        "--id",
        "lane",
        "--module",
        "WorldEditor",
        "--only",
        "p4-l02-a",
        "--run-dir",
        runDir,
        "--sandbox",
        join(TMP, "EMCP2_sandbox"),
      ],
      {
        out: () => undefined,
        platform: "win32",
        leaseHeld: true,
        artifactsRoot: join(TMP, "art"),
        deps: fakeDeps(files),
        evidenceDir: null,
      },
    );
    expect(code).toBe(EXIT.done);
    expect([...files.keys()].some((k) => k.endsWith("p4-l02-a.json"))).toBe(true);
    expect(existsSync(runDir)).toBe(true);
  });
});

describe("normalise --shared-chrome (P4-9 attribution)", () => {
  const SUB = "ResourceManager.Config";
  const WIN = {
    dim: "ui",
    kind: "window",
    module: SUB,
    key: { object_name: "ResourceManagerMain" },
  } as const;
  const obs = (
    kind: LiveObservation["kind"],
    key: LiveObservation["key"],
    parent: LiveObservation["parent_key"],
    label?: string,
  ): LiveObservation => ({
    ...MENU_FILE,
    kind,
    module: SUB,
    key,
    parent_key: parent,
    label,
    label_raw: label,
    locator: { windowClass: "Qt683QWindowIcon" },
    observed_state: {},
  });
  const pk = (kind: LiveObservation["kind"], key: LiveObservation["key"]) =>
    ({ dim: "ui", kind, module: SUB, key }) as NonNullable<LiveObservation["parent_key"]>;
  const walk = (): LiveObservation[] => [
    obs("window", WIN.key, null, "Enfusion Workbench"),
    obs("menu", { path: ["File"] }, pk("window", WIN.key), "File"),
    obs("menu", { path: ["WidgetStyle"] }, pk("window", WIN.key), "WidgetStyle"),
    obs("dock", { object_name: "resourceBrowserDock" }, pk("window", WIN.key), "Resource Browser"),
    obs(
      "control",
      { path: ["resourceBrowserDock", "Float"] },
      pk("dock", { object_name: "resourceBrowserDock" }),
      "Float",
    ),
    obs("panel", { object_name: "statusbar" }, pk("window", WIN.key)),
    obs(
      "status-item",
      { path: ["statusbar", "Version 9"] },
      pk("panel", { object_name: "statusbar" }),
      "Version 9",
    ),
    obs("region", { path: ["@QWidget.1"] }, pk("window", WIN.key)),
    obs("property-group", { path: ["@PropertyGridBC.1"] }, pk("region", { path: ["@QWidget.1"] })),
  ];
  // What earlier walks of the Resource Manager itself produced: window, menu, dock, status bar.
  const ids = new Set([
    "ui:ResourceManager/window/#ResourceManagerMain",
    "ui:ResourceManager/menu/File",
    "ui:ResourceManager/dock/#resourceBrowserDock",
    "ui:ResourceManager/panel/#statusbar",
    // a positional id the default state also has is not chrome by itself under the window
  ]);

  it("files the window chrome under the base module and keeps the tab's own rows", () => {
    const lines = walk();
    attributeSharedChrome(lines, { base: "ResourceManager", ids });
    const byId = new Map(lines.map((l) => [deriveId(l), l]));
    expect([...byId.keys()].sort()).toEqual(
      [
        "ui:ResourceManager.Config/menu/WidgetStyle",
        "ui:ResourceManager.Config/property-group/@PropertyGridBC.1",
        "ui:ResourceManager.Config/region/@QWidget.1",
        "ui:ResourceManager/control/resourceBrowserDock/Float",
        "ui:ResourceManager/dock/#resourceBrowserDock",
        "ui:ResourceManager/menu/File",
        "ui:ResourceManager/panel/#statusbar",
        "ui:ResourceManager/status-item/statusbar/Version 9",
        "ui:ResourceManager/window/#ResourceManagerMain",
      ].sort(),
    );
    // A kept row under the window points at the base module's window; under its own region it stays.
    expect(byId.get("ui:ResourceManager.Config/menu/WidgetStyle")?.parent_key?.module).toBe(
      "ResourceManager",
    );
    expect(
      byId.get("ui:ResourceManager.Config/property-group/@PropertyGridBC.1")?.parent_key?.module,
    ).toBe(SUB);
    expect(
      byId.get("ui:ResourceManager/control/resourceBrowserDock/Float")?.parent_key?.module,
    ).toBe("ResourceManager");
  });

  it("merges the chrome of two sub-editors into one row and is idempotent", () => {
    const header = {
      enumerator: "L01",
      build: "1.9.0.37",
      def: { generator: "scripts/census/live/L01-snapshot.ts" },
    };
    const font = walk().map((l) =>
      JSON.parse(JSON.stringify(l).replaceAll(SUB, "ResourceManager.Font")),
    ) as LiveObservation[];
    const text = (ls: LiveObservation[]) => ls.map((l) => JSON.stringify(l)).join("\n");
    const r = mergeObservations(
      [
        { source: "config", text: text(walk()) },
        { source: "font", text: text(font) },
      ],
      header,
      { sharedChrome: { base: "ResourceManager", ids } },
    );
    expect(r.rejected).toEqual([]);
    // 6 chrome rows once, 3 own rows per sub-editor
    expect(r.rows).toBe(6 + 3 + 3);
    expect(r.replaced).toBe(6);
    const again = mergeObservations([{ source: "c", text: r.text }], header, {
      sharedChrome: { base: "ResourceManager", ids },
    });
    expect(again.text).toBe(r.text);
    // without the option nothing moves
    expect(mergeObservations([{ source: "config", text: text(walk()) }], header).rows).toBe(9);
  });

  it("fix-up 3: a later whole-window walk drops the earlier sitting's re-keyed rows of its scope (W8 run 4)", () => {
    const header = {
      enumerator: "L01",
      build: "1.9.0.37",
      def: { generator: "scripts/census/live/L01-snapshot.ts" },
    };
    const rm = (l: LiveObservation): LiveObservation =>
      JSON.parse(JSON.stringify(l).replaceAll(SUB, "ResourceManager")) as LiveObservation;
    const text = (ls: LiveObservation[]) => ls.map((l) => JSON.stringify(l)).join("\n");
    const cdc = { object_name: "consoleDockContents" };
    const win = obs("window", WIN.key, null, "Enfusion Workbench");
    const panel = obs("panel", cdc, pk("window", WIN.key));
    // Run 4's two keys of the same two elements (978873aa against bafd1a2d).
    const early = [
      win,
      panel,
      obs("region", { object_name: "qt_scrollarea_hcontainer" }, pk("panel", cdc)),
      obs(
        "region",
        { path: ["consoleDock", "consoleDockContents", "@QSplitterHandle.1"] },
        pk("panel", cdc),
      ),
      {
        ...obs("control", { path: ["Play only"] }, pk("window", WIN.key)),
        observed_state: { mode: "play" as const },
      },
    ].map(rm);
    const later = [
      win,
      panel,
      obs(
        "region",
        { path: ["consoleDock", "consoleDockContents", "@QWidget.2"] },
        pk("panel", cdc),
      ),
      obs("region", { object_name: "qt_splithandle_" }, pk("panel", cdc)),
    ].map(rm);
    const r = mergeObservations(
      [
        { source: "committed", text: text(early) },
        { source: "rewalk", text: text(later) },
      ],
      header,
    );
    expect(r.rejected).toEqual([]);
    expect(r.superseded).toBe(2);
    const merged = r.text
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l) as LiveObservation);
    const out = merged.map((l) => deriveId(l));
    expect(out).not.toContain("ui:ResourceManager/region/#qt_scrollarea_hcontainer");
    expect(out).toContain("ui:ResourceManager/region/#qt_splithandle_");
    // Another state of the module, which the later walk does not carry, stays.
    expect(out).toContain("ui:ResourceManager/control/Play only");
    expect(r.rows).toBe(5);
    // The panel's children are the later walk's two.
    const kids = merged.filter(
      (l) =>
        l.parent_key?.kind === "panel" && JSON.stringify(l.parent_key.key) === JSON.stringify(cdc),
    );
    expect(kids).toHaveLength(2);
    // A sub-editor walk after it claims only its own module: no ResourceManager row is dropped.
    const sub = mergeObservations(
      [
        { source: "merged", text: r.text },
        { source: "config", text: text(walk()) },
      ],
      header,
      { sharedChrome: { base: "ResourceManager", ids } },
    );
    expect(sub.superseded).toBe(0);
    // Idempotent: the rewalk merged again changes nothing.
    expect(
      mergeObservations(
        [
          { source: "merged", text: r.text },
          { source: "rewalk", text: text(later) },
        ],
        header,
      ).text,
    ).toBe(r.text);
  });

  it("DEC-088: a sub-editor walk re-emitting a chrome parent with children_count drops its unseen earlier children (W8 run 8)", () => {
    const header = {
      enumerator: "L01",
      build: "1.9.0.37",
      def: { generator: "scripts/census/live/L01-snapshot.ts" },
    };
    const text = (ls: LiveObservation[]) => ls.map((l) => JSON.stringify(l)).join("\n");
    const cdc = { object_name: "consoleDockContents" };
    const rm = (l: LiveObservation): LiveObservation =>
      JSON.parse(JSON.stringify(l).replaceAll(SUB, "ResourceManager")) as LiveObservation;
    const handleOld = { object_name: "qt_splithandle_" };
    const handleNew = { path: ["consoleDock", "consoleDockContents", "@QSplitterHandle.1"] };
    const edit = { object_name: "ScriptConsole" };
    // The committed file: run 4's key of the splitter handle under the RM console dock.
    const committed = [
      obs("window", WIN.key, null, "Enfusion Workbench"),
      { ...obs("panel", cdc, pk("window", WIN.key)), children_count: 2 },
      obs("region", handleOld, pk("panel", cdc)),
      obs("control", edit, pk("panel", cdc)),
    ].map(rm);
    // Run 8's Texture walk sees the same dock (chrome) and keys the handle positionally.
    const tex = (l: LiveObservation): LiveObservation =>
      JSON.parse(
        JSON.stringify(l).replaceAll(SUB, "ResourceManager.Texture"),
      ) as LiveObservation;
    const subWalk = [
      obs("window", WIN.key, null, "Enfusion Workbench"),
      { ...obs("panel", cdc, pk("window", WIN.key)), children_count: 2 },
      obs("region", handleNew, pk("panel", cdc)),
      obs("control", edit, pk("panel", cdc)),
      obs("region", { path: ["@QWidget.1"] }, pk("window", WIN.key)),
    ].map(tex);
    const chrome = new Set([
      "ui:ResourceManager/window/#ResourceManagerMain",
      "ui:ResourceManager/panel/#consoleDockContents",
    ]);
    const r = mergeObservations(
      [
        { source: "committed", text: text(committed) },
        { source: "texture", text: text(subWalk) },
      ],
      header,
      { sharedChrome: { base: "ResourceManager", ids: chrome } },
    );
    expect(r.rejected).toEqual([]);
    expect(r.superseded).toBe(1);
    const merged = r.text
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l) as LiveObservation);
    const ids = merged.map((l) => deriveId(l));
    expect(ids).not.toContain("ui:ResourceManager/region/#qt_splithandle_");
    expect(ids).toContain("ui:ResourceManager/region/consoleDock/consoleDockContents/@QSplitterHandle.1");
    expect(ids).toContain("ui:ResourceManager.Texture/region/@QWidget.1");
    // The panel's stated count equals the children the file now emits.
    const kids = merged.filter(
      (l) =>
        l.parent_key?.module === "ResourceManager" &&
        JSON.stringify(l.parent_key.key) === JSON.stringify(cdc),
    );
    expect(kids).toHaveLength(2);
    // Without a stated count the earlier child stays (no scope claims the base module).
    const uncounted = subWalk.map((l) => {
      const { children_count: _drop, ...rest } = l;
      return rest as LiveObservation;
    });
    const r2 = mergeObservations(
      [
        { source: "committed", text: text(committed) },
        { source: "texture", text: text(uncounted) },
      ],
      header,
      { sharedChrome: { base: "ResourceManager", ids: chrome } },
    );
    expect(r2.superseded).toBe(0);
  });
});

describe("DEC-090: dock tabs keyed by name", () => {
  const strip = (n: number) => ({ path: [`@QMainWindowTabBar.${n}`] });
  const tab = (n: number, name: string, sha = SHA_A, state = {}): LiveObservation => ({
    ...MENU_FILE,
    kind: "tab",
    module: "WorldEditor",
    key: { path: [`@QMainWindowTabBar.${n}`, name] },
    parent_key: { dim: "ui", kind: "panel", module: "WorldEditor", key: strip(n) },
    label: name,
    label_raw: name,
    locator: { controlType: "TabItem", windowClass: "Qt683QWindowIcon" },
    observed_state: state,
    ref: `artifact:${sha}#n/0/${n}`,
  });
  const ids = (ls: LiveObservation[]) => ls.map((l) => deriveId(l));

  it("a tab whose name sits on one strip of its walk drops the strip ordinal; the parent stays", () => {
    const ls = rekeyDockTabs([tab(3, "Create"), tab(3, "Hierarchy"), tab(1, "Move")]);
    expect(ids(ls)).toEqual([
      "ui:WorldEditor/tab/@QMainWindowTabBar/Create",
      "ui:WorldEditor/tab/@QMainWindowTabBar/Hierarchy",
      "ui:WorldEditor/tab/@QMainWindowTabBar/Move",
    ]);
    expect(ls[0].parent_key?.key).toEqual(strip(3));
    expect(ls[0].unverified).toEqual([DOCK_TAB_NOTE]);
    // Idempotent: a re-keyed line is not a strip-ordinal tab any more.
    expect(ids(rekeyDockTabs(ls))).toEqual(ids(ls));
  });

  it("the same tab under another strip ordinal in a later launch gets the same id (P4-5 runs 1 and 2)", () => {
    const run1 = rekeyDockTabs([tab(3, "Create", SHA_A)]);
    const run2 = rekeyDockTabs([tab(2, "Create", SHA_B)]);
    expect(ids(run1)).toEqual(ids(run2));
  });

  it("a name on two strips of one walk keeps its ordinal keys; a child of a re-keyed tab follows it", () => {
    const child: LiveObservation = {
      ...tab(1, "Log Console"),
      kind: "control",
      key: { path: ["@QMainWindowTabBar.1", "Log Console", "Clear"] },
      parent_key: {
        dim: "ui",
        kind: "tab",
        module: "WorldEditor",
        key: { path: ["@QMainWindowTabBar.1", "Log Console"] },
      },
    };
    const ls = rekeyDockTabs([tab(1, "Errors"), tab(2, "Errors"), tab(1, "Log Console"), child]);
    expect(ids(ls)).toEqual([
      "ui:WorldEditor/tab/@QMainWindowTabBar.1/Errors",
      "ui:WorldEditor/tab/@QMainWindowTabBar.2/Errors",
      "ui:WorldEditor/tab/@QMainWindowTabBar/Log Console",
      "ui:WorldEditor/control/@QMainWindowTabBar.1/Log Console/Clear",
    ]);
    expect(ls[0].unverified).toBeUndefined();
    expect(ls[3].parent_key?.key).toEqual({ path: ["@QMainWindowTabBar", "Log Console"] });
  });

  it("two walks in one committed file are not duplicates of each other; the merge keeps one line per tab", () => {
    const header = {
      enumerator: "L01",
      build: "1.9.0.37",
      def: { generator: "scripts/census/live/L01-snapshot.ts" },
    };
    const text = (ls: LiveObservation[]) => ls.map((l) => JSON.stringify(l)).join("\n");
    // The committed file of two sittings: the same tabs under two orders of the strips.
    const committed = [tab(1, "Create", SHA_A), tab(2, "Create", SHA_B), tab(3, "Move", SHA_A)];
    const r = mergeObservations([{ source: "committed", text: text(committed) }], header);
    expect(r.rejected).toEqual([]);
    const merged = r.text
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l) as LiveObservation);
    expect(ids(merged)).toEqual([
      "ui:WorldEditor/tab/@QMainWindowTabBar/Create",
      "ui:WorldEditor/tab/@QMainWindowTabBar/Move",
    ]);
    // The later line of the two wins (file order), as for any key the merge sees twice.
    expect(merged[0].ref).toBe(`artifact:${SHA_B}#n/0/2`);
    // Another enumerator's tabs are not touched.
    const l03 = mergeObservations([{ source: "c", text: text([tab(1, "Create")]) }], {
      ...header,
      enumerator: "L03",
      def: { generator: "scripts/census/live/L03-chrome.ts" },
    });
    expect(l03.text).toContain('"@QMainWindowTabBar.1","Create"');
  });
});

describe("normalise (D1, D3)", () => {
  const header = {
    enumerator: "L02",
    build: "1.8.0.13",
    def: { generator: "scripts/census/live/L02-menus.ts" },
  };
  const line = (o: Partial<LiveObservation>) => JSON.stringify({ ...MENU_FILE, ...o });
  it("merges, sorts, dedupes with the later sitting winning and notes a differing label", () => {
    const early =
      line({ key: { path: ["Help"] }, label: "Help", label_raw: "Help" }) +
      "\n" +
      line({ label: "File", label_raw: "File" });
    const later =
      line({ label: "File", label_raw: "&File", ref: `artifact:${SHA_B}#m/File` }) + "\n";
    const r = mergeObservations(
      [
        { source: "a", text: early },
        { source: "b", text: later },
      ],
      header,
    );
    expect(r.rejected).toEqual([]);
    expect(r.rows).toBe(2);
    const lines = r.text.trimEnd().split("\n");
    expect(JSON.parse(lines[0])).toEqual({
      $header: 1,
      build: "1.8.0.13",
      enumerator: "L02",
      generator: "scripts/census/live/L02-menus.ts",
      provisional: false,
      row_count: 2,
    });
    expect(lines[0].startsWith('{"$header":1')).toBe(true);
    const file = JSON.parse(lines[1]);
    expect(deriveId(file)).toBe("ui:ResourceManager/menu/File");
    expect(file.ref).toContain(SHA_B);
    // "&File" normalises to "File": same label, no note
    expect(file.unverified).toBeUndefined();
    const relabelled = mergeObservations(
      [
        { source: "a", text: line({}) },
        {
          source: "b",
          text: line({ label: "Datei", label_raw: "Datei", ref: `artifact:${SHA_B}#m/File` }),
        },
      ],
      header,
    );
    expect(JSON.parse(relabelled.text.split("\n")[1]).unverified).toEqual([
      `also seen: artifact:${SHA_A}#m/File`,
    ]);
    // round trip: merging the output again changes nothing
    expect(mergeObservations([{ source: "c", text: r.text }], header).text).toBe(r.text);
  });
  it("different states are different rows; a bad line is rejected", () => {
    const r = mergeObservations(
      [
        {
          source: "a",
          text:
            line({}) +
            "\n" +
            line({ observed_state: { mode: "play" } }) +
            "\n" +
            line({ id: "x" } as never),
        },
      ],
      header,
    );
    expect(r.rows).toBe(2);
    expect(r.rejected).toHaveLength(1);
  });
  it("the CLI writes the committed file under --data, passes --check, and fails it after a change", () => {
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "current-build.json"), JSON.stringify({ tag: "1.8.0.13" }));
    writeFileSync(
      join(data, "universes.json"),
      JSON.stringify({ enumerators: { L02: { generator: "scripts/census/live/L02-menus.ts" } } }),
    );
    const runDir = join(TMP, "rawrun");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "L02-ResourceManager-edit-none.obs.jsonl"), line({}) + "\n");
    writeFileSync(join(runDir, "L01-ResourceManager-edit-none.obs.jsonl"), "not read\n");
    const io = { out: () => undefined, err: () => undefined };
    expect(runNormalise(["--enumerator", "L02", "--data", data, runDir], io)).toBe(0);
    const committed = join(data, "observations", "L02", "1.8.0.13.jsonl");
    expect(readFileSync(committed, "utf-8").split("\n")).toHaveLength(3);
    expect(runNormalise(["--enumerator", "L02", "--data", data, "--check"], io)).toBe(0);
    writeFileSync(
      join(runDir, "L02-ResourceManager-play.obs.jsonl"),
      line({ observed_state: { mode: "play" } }) + "\n",
    );
    expect(runNormalise(["--enumerator", "L02", "--data", data, "--check", runDir], io)).toBe(1);
    expect(runNormalise(["--enumerator", "X1", "--data", data], io)).toBe(2);
  });
});

describe("shared runtime (P4-FIX-A)", () => {
  it("module and plugin are live kinds; a plugin row takes the { class } key, nothing else does", () => {
    expect(LIVE_KINDS).toContain("module");
    expect(LIVE_KINDS).toContain("plugin");
    const plugin = {
      dim: "plugin",
      kind: "plugin",
      module: "WorldEditor",
      key: { class: "SCR_SnapAndOrientToTerrainPlugin" },
      parent_key: null,
      origin: "vanilla",
      observed_state: {},
      ref: `artifact:${SHA_A}#plugin/WorldEditor/SCR_SnapAndOrientToTerrainPlugin`,
      confidence: "high",
    };
    expect(validateLine(plugin, "L11")).toEqual([]);
    expect(validateLine({ ...plugin, key: { path: ["x"] } }, "L11").join()).toContain("{ class }");
    expect(validateLine({ ...MENU_FILE, key: { class: "X" } }, "L02").join()).toContain(
      "{ object_name } or { path }",
    );
    const mod = {
      ...plugin,
      dim: "ui",
      kind: "module",
      key: { path: ["ScriptEditor"] },
      module: "ScriptEditor",
    };
    expect(validateLine(mod, "L10")).toEqual([]);
  });

  it("D8: stateAxes, projectState and stateFor follow state-matrix.json", () => {
    expect(stateAxes("WorldEditor", "menu")).toEqual(["mode"]);
    expect(stateAxes("ResourceManager", "menu")).toEqual([]);
    expect(stateAxes("WorldEditor", "property")).toEqual(["mode", "selection"]);
    expect(stateAxes("Shared", "diag-option")).toEqual(["mode"]);
    expect(projectState({ mode: "play", selection: "entity" }, ["mode"])).toEqual({ mode: "play" });
    expect(
      stateFor("WorldEditor", "property-group", { mode: "edit", selection: "entity" }),
    ).toEqual({ mode: "edit", selection: "entity" });
    expect(stateFor("WorldEditor", "region", { mode: "edit", selection: "none" })).toEqual({});
  });

  it("MODULE_TITLES match the titles the walks read and refuse others", () => {
    const t = (m: string, title: string): boolean => moduleTitle(m)!.test(title);
    expect(t("WorldEditor", "World Editor - Unnamed empty world")).toBe(true);
    expect(t("WorldEditor", "World Editor")).toBe(true);
    expect(t("ScriptEditor", "Script Editor")).toBe(true);
    expect(t("ScriptEditor", "Script Editor - Configuration: WORKBENCH")).toBe(true);
    expect(
      t(
        "ScriptEditor",
        "Script Editor - Debugging: ArmaReforgerWorkbenchSteamDiag.exe on port: 1000 - Configuration: WORKBENCH",
      ),
    ).toBe(true);
    expect(t("BehaviorEditor", "Behavior Editor - EMCP2_sandbox")).toBe(true);
    expect(t("LocalizationEditor", "String Editor")).toBe(true);
    expect(t("AudioEditor", "Audio Editor - x")).toBe(false);
    expect(MODULE_TITLES.ResourceManager.unverified).toBe(true);
    // P4-1 2026-10-12: the Navmesh window's title as read live
    expect(MODULE_TITLES.NavmeshGeneratorMain.unverified).toBe(false);
    expect(t("NavmeshGeneratorMain", "Arma Reforger Workbench")).toBe(true);
    expect(t("NavmeshGeneratorMain", "Navmesh Generator")).toBe(false);
    expect(moduleTitle("ParticleEditor")).toBeNull();
  });

  it("kindOf: the live property-grid classes, a QMenu popup window, both separator shapes", () => {
    for (const className of ["PropertyGrid", "EntityPropertyGrid", "PropertyGridBC"])
      expect(kindOf({ controlType: "Tree", className })).toEqual({ kind: "property-group" });
    expect(kindOf({ controlType: "Table", className: "MyPropertyGridView" })).toEqual({
      kind: "property-group",
      confidence: "medium",
    });
    expect(isPropertyGrid({ controlType: "Tree", className: "EntityPropertyGrid" })).toBe(true);
    expect(isPropertyGrid({ controlType: "Tree", className: "ComponentTreeWidget" })).toBe(false);
    expect(kindOf({ controlType: "Window", className: "QMenu", owned: true })).toEqual({
      kind: "context-menu",
    });
    expect(kindOf({ controlType: "Separator" })).toEqual({ dismissed: "structural-separator" });
    expect(kindOf({ controlType: "Group", name: "", childCount: 0 })).toEqual({
      dismissed: "structural-separator-group",
    });
    expect(kindOf({ controlType: "Group", className: "QToolBarSeparator" })).toEqual({
      dismissed: "structural-separator-group",
    });
    expect(kindOf({ controlType: "Group", name: "Box", childCount: 0 })).not.toEqual({
      dismissed: "structural-separator-group",
    });
  });

  it("every DISMISS_RULES id is in g4-rules.json with the same control type", () => {
    const g4 = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "data", "census", "g4-rules.json"), "utf-8"),
    ) as { rules: Array<{ id: string; controlType: string }> };
    const by = new Map(g4.rules.map((r) => [r.id, r.controlType]));
    for (const r of DISMISS_RULES) expect(by.get(r.id), r.id).toBe(r.controlType);
    expect(g4.rules).toHaveLength(DISMISS_RULES.length);
  });

  it("--state none is the empty state and names the obs file none", () => {
    expect(parseState("none")).toEqual({});
    expect(stateTag({})).toBe("none");
    expect(obsFilePath("/r", "L14", "Launcher", {}).replace(/\\/g, "/")).toBe(
      "/r/L14-Launcher-none.obs.jsonl",
    );
  });

  it("the step context carries the lane, port, window list and the tool client", async () => {
    const seen: Record<string, unknown> = {};
    const d = {
      ...fakeDeps(new Map()),
      client: {
        tool: async (name: string, args: Record<string, unknown>) => {
          seen.tool = { name, args };
          return { ok: true };
        },
        net: async () => ({ ok: true }) as never,
      },
    };
    const r = await runWalkerSteps(
      [
        step("c1", {
          run: async (ctx) => {
            seen.lane = ctx.lane;
            seen.laneId = ctx.laneId;
            seen.port = ctx.port;
            seen.pid = ctx.pid;
            seen.windows = (await ctx.windows()).length;
            await ctx.tool("wb_module", { action: "list" });
            return { status: "pass", summary: "" };
          },
        }),
      ],
      d,
      { ...opts("/rc"), lane: { id: "lane-7", leasePath: "<l>" }, port: 5999 },
    );
    expect(r.exit).toBe(EXIT.done);
    expect(seen).toMatchObject({
      lane: { id: "lane-7", leasePath: "<l>" },
      laneId: "lane-7",
      port: 5999,
      pid: 4242,
      windows: 0,
      tool: { name: "wb_module", args: { action: "list" } },
    });
    expect(laneArgv({ id: "lane-7", leasePath: "<l>" })).toEqual([
      "--id",
      "lane-7",
      "--lease-path",
      "<l>",
    ]);
    expect(r.records[0].calls.map((c) => c.call)).toEqual(["windows", "tool:wb_module"]);
  });

  it("lines are written only when the step passes or observes; else to <step>.rejected.jsonl", async () => {
    const files = new Map<string, string>();
    const emitThen = (status: "pass" | "fail" | "handoff"): WalkerStep =>
      step(`e-${status}`, {
        run: async (ctx) => {
          ctx.emit([
            {
              ...MENU_FILE,
              module: "WorldEditor",
              parent_key: null,
              observed_state: ctx.opts.state,
            },
          ]);
          if (status === "handoff") throw new StopBattery("handoff", "a popup was left open");
          return { status, summary: status };
        },
      });
    const find = (suffix: string): string | undefined =>
      [...files.entries()].find(([k]) => k.replace(/\\/g, "/").endsWith(suffix))?.[1];
    await runWalkerSteps([emitThen("pass")], fakeDeps(files), opts("/rb"));
    expect(find("/rb/L02-WorldEditor-edit-none.obs.jsonl")?.trim().split("\n")).toHaveLength(1);
    await runWalkerSteps([emitThen("fail")], fakeDeps(files), opts("/rf"));
    expect(find("/rf/L02-WorldEditor-edit-none.obs.jsonl")).toBeUndefined();
    expect(JSON.parse(find("/rf/e-fail.rejected.jsonl")!.split("\n")[0])).toMatchObject({
      $rejected: "e-fail",
    });
    const h = await runWalkerSteps([emitThen("handoff")], fakeDeps(files), opts("/rh"));
    expect(h.exit).toBe(EXIT.handoff);
    expect(find("/rh/L02-WorldEditor-edit-none.obs.jsonl")).toBeUndefined();
    const rejected = find("/rh/e-handoff.rejected.jsonl")!.trim().split("\n");
    expect(rejected).toHaveLength(2);
    expect(JSON.parse(rejected[0]).reason).toContain("HANDOFF: a popup was left open");
  });
});

describe("P4-FIX-I: one window-key rule for every walker (AnimEditor)", () => {
  it("the module window's object name is read off its automationId even when it equals the class", () => {
    // P4-2 L01 walk: the window node is Arma4WorkbenchApp.AnimEditor, UIA className AnimEditor.
    expect(moduleWindowObjectName("Arma4WorkbenchApp.AnimEditor")).toBe("AnimEditor");
    // The general rule still refuses it (an owned dialog keeps its title, design 1.3).
    expect(objectNameOf("Arma4WorkbenchApp.AnimEditor", "AnimEditor")).toBeNull();
    expect(
      chooseKey(
        {
          automationId: "Arma4WorkbenchApp.AnimEditor",
          className: "AnimEditor",
          ancestorLabels: [],
          name: "Animation Editor",
          moduleWindow: true,
        },
        () => true,
      ).key,
    ).toEqual({ object_name: "AnimEditor" });
  });
  it("a popup id names the same window; a non-identifier segment falls back to the title", () => {
    const popup = "Arma4WorkbenchApp.AnimEditor.QMenuBar.QAction.QMenu";
    expect(moduleWindowObjectName(popup)).toBeNull();
    expect(moduleWindowObjectName(popup, false)).toBe("AnimEditor");
    expect(moduleWindowObjectName("Arma4WorkbenchApp.nm::NavmeshGeneratorMain")).toBeNull();
    expect(moduleWindowObjectName("Arma4WorkbenchApp.QWidget")).toBeNull();
    expect(moduleWindowObjectName("Other.AnimEditor")).toBeNull();
    expect(
      chooseKey(
        {
          automationId: "Arma4WorkbenchApp.nm::NavmeshGeneratorMain",
          className: "nm::NavmeshGeneratorMain",
          ancestorLabels: [],
          name: "Arma Reforger Workbench",
          moduleWindow: true,
        },
        () => true,
      ).key,
    ).toEqual({ path: ["Arma Reforger Workbench"] });
  });
});
