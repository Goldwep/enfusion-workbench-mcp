import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  MAIN_MENU_TITLES,
  MENUS_SCRIPT,
  buildMenuPlan,
  menusArgv,
  titlesFor,
  validateMenuOptions,
  type MenuOptions,
} from "../../tools/uia/menus.js";

// Window classes, titles and trees below are synthetic test data, not Workbench facts.
const PY = process.env.ENFUSION_PYTHON || "python";
const HAS_PYTHON = spawnSync(PY, ["--version"], { encoding: "utf-8" }).status === 0;
const PID = 4242;
const CLASS = "TestMainClass";

type Node = Record<string, unknown>;

function item(name: string, children: Node[] = [], extra: Node = {}): Node {
  return {
    controlType: "MenuItem",
    name,
    patterns: ["Invoke", "ExpandCollapse"],
    state: children.length ? 0 : 3,
    children,
    ...extra,
  };
}

function fixture(over: { foreground?: number; extraWindows?: Node[]; top?: Node[] } = {}): Node {
  const leaf = (n: string): Node => ({
    controlType: "MenuItem",
    name: n,
    patterns: ["Invoke"],
    state: 3,
  });
  const top = over.top ?? [
    item("File", [leaf("New World"), leaf("Exit")], {
      popup: {
        hwnd: 201,
        pid: PID,
        className: "Qt683QWindowPopupDropShadowSaveBits",
        title: "",
        owned: false,
      },
    }),
    item("Utilities", [item("Sub", [leaf("Deep")]), leaf("Qt Introspection Tool")], {
      popup: {
        hwnd: 202,
        pid: PID,
        className: "Qt683QWindowPopupDropShadowSaveBits",
        title: "",
        owned: false,
      },
    }),
    item("Help", [leaf("About")]),
  ];
  return {
    foreground: over.foreground ?? 999,
    windows: [
      {
        hwnd: 100,
        pid: PID,
        className: CLASS,
        title: "Workbench",
        owned: false,
        tree: {
          controlType: "Window",
          name: "Workbench",
          children: [
            { controlType: "MenuBar", name: "", children: [item("System", [leaf("Close")])] },
            { controlType: "MenuBar", name: "", children: top },
          ],
        },
      },
      { hwnd: 999, pid: 1, className: "Other", title: "Other app" },
      ...(over.extraWindows ?? []),
    ],
  };
}

function runPy(
  tree: Node,
  args: string[],
): { code: number | null; doc: Record<string, unknown> | null; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "emcp-menus-"));
  try {
    const f = join(dir, "tree.json");
    writeFileSync(f, JSON.stringify(tree));
    const r = spawnSync(
      PY,
      [
        "-B",
        MENUS_SCRIPT,
        "--provider",
        "fake",
        "--fake-tree",
        f,
        "--pid",
        String(PID),
        "--class",
        CLASS,
        "--title",
        "Workbench",
        ...args,
      ],
      { encoding: "utf-8", timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    const line = (r.stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
    let doc: Record<string, unknown> | null = null;
    try {
      doc = line ? (JSON.parse(line) as Record<string, unknown>) : null;
    } catch {
      doc = null;
    }
    return { code: r.status, doc, stderr: r.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Call = { call: string; path: string[] };

// ── Source scan: menus.py calls only Expand and Collapse ─────────────────────

/** menus.py source with comments and string literals removed, through Python's own tokenizer. */
function pythonCodeOf(src: string): string {
  const script = [
    "import io, sys, tokenize",
    "src = sys.stdin.read()",
    "out = []",
    "for t in tokenize.generate_tokens(io.StringIO(src).readline):",
    "    if t.type == tokenize.COMMENT: continue",
    "    if t.type == tokenize.STRING: out.append('\"\"'); continue",
    "    if t.type in (tokenize.NEWLINE, tokenize.NL): out.append('\\n'); continue",
    "    out.append(t.string + ' ')",
    "sys.stdout.write(''.join(out))",
  ].join("\n");
  const r = spawnSync(PY, ["-B", "-c", script], { input: src, encoding: "utf-8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

const BANNED_NAMES =
  /\b(Invoke|Toggle|Select|AddToSelection|RemoveFromSelection|SetValue|SetFocus|SendInput|SendKeys|keybd_event|mouse_event|SetCursorPos|PostMessageW?|SendMessageW?|SendMessageTimeoutW|SetForegroundWindow|BringWindowToTop|ShowWindow|SetWindowPos|SetActiveWindow|DoDefaultAction|ScrollIntoView|GetCachedPattern|GetCachedPatternAs|GetCurrentPattern|pywinauto|pyautogui|uiautomation)\b|\b[Cc]lick\s*\(|\bRightClick\b/;
/** Method calls on a pattern-like object: `.Name(`. Only these may appear among UIA verbs. */
const VERB_CALL =
  /\.\s*(Expand|Collapse|Invoke|Toggle|Select|SetValue|SetFocus|Close|Move|Resize|Scroll|Realize)\s*\(/g;

function scanMenus(code: string): { banned: string[]; verbs: string[] } {
  const banned: string[] = [];
  const verbs: string[] = [];
  code.split("\n").forEach((line, n) => {
    const b = BANNED_NAMES.exec(line);
    if (b) banned.push(`${n + 1}: ${b[0]}`);
    for (const m of line.matchAll(VERB_CALL)) verbs.push(m[1]);
  });
  return { banned, verbs };
}

describe.skipIf(!HAS_PYTHON)("menus.py source scan", () => {
  it("the only UIA verbs it calls are Expand and Collapse, and nothing banned appears", () => {
    const code = pythonCodeOf(readFileSync(MENUS_SCRIPT, "utf-8"));
    const s = scanMenus(code);
    expect(s.banned).toEqual([]);
    expect(new Set(s.verbs)).toEqual(new Set(["Expand", "Collapse"]));
    // The one pattern fetch is the ExpandCollapse pattern, by its id.
    const fetches = code.split("\n").filter((l) => /GetCurrentPatternAs/.test(l));
    expect(fetches.length).toBe(1);
    expect(fetches[0]).toMatch(/UIA_ExpandCollapsePatternId/);
  });

  it("each forbidden name, planted, fails the scan; words in comments and strings do not", () => {
    const planted = [
      "el.Invoke()",
      "p.Toggle()",
      "p.Select()",
      "p.SetValue(1)",
      "el.SetFocus()",
      "user32.SendInput(1)",
      "user32.keybd_event(1)",
      "user32.mouse_event(1)",
      "user32.PostMessageW(h)",
      "user32.SendMessageW(h)",
      "user32.SetForegroundWindow(h)",
      "el.GetCurrentPattern(1)",
      "x.click()",
      "x.RightClick",
    ];
    for (const p of planted) {
      const s = scanMenus(pythonCodeOf(p + "\n"));
      expect({
        p,
        hit: s.banned.length > 0 || s.verbs.some((v) => v !== "Expand" && v !== "Collapse"),
      }).toEqual({
        p,
        hit: true,
      });
    }
    expect(scanMenus(pythonCodeOf("# el.Invoke()\nx = 'el.Invoke()'\n")).banned).toEqual([]);
  });
});

// ── menus.py on the fake provider ────────────────────────────────────────────

describe.skipIf(!HAS_PYTHON)("menus.py on a fake tree", () => {
  it("dry run by default: prints the plan, attaches nothing", () => {
    const r = runPy(fixture(), ["--menus", "File"]);
    expect(r.code).toBe(0);
    expect(r.doc).toMatchObject({ dry_run: true });
    expect(JSON.stringify(r.doc)).not.toContain("New World");
  });

  it("expands, reads, collapses each title; the System menu is never addressed", () => {
    const r = runPy(fixture(), ["--menus", "File,Help", "--really"]);
    expect(r.code).toBe(0);
    expect(r.doc!.result).toBe("ok");
    const menus = r.doc!.menus as Array<{
      title: string;
      opened: boolean;
      collapsed: boolean;
      items: Node[];
    }>;
    expect(menus.map((m) => [m.title, m.opened, m.collapsed])).toEqual([
      ["File", true, true],
      ["Help", true, true],
    ]);
    expect(menus[0].items.map((t) => t.name)).toEqual(["New World", "Exit"]);
    expect(r.doc!.leftOpen).toEqual([]);
    const calls = r.doc!.calls as Call[];
    expect(calls).toEqual([
      { call: "Expand", path: ["File"] },
      { call: "Collapse", path: ["File"] },
      { call: "Expand", path: ["Help"] },
      { call: "Collapse", path: ["Help"] },
    ]);
    expect(r.doc!.menu_bar_titles).toEqual(["File", "Utilities", "Help"]);
  });

  it("--depth 1 expands and collapses each sub-menu once, and no deeper", () => {
    const r = runPy(fixture(), ["--menus", "Utilities", "--depth", "1", "--really"]);
    expect(r.code).toBe(0);
    const calls = (r.doc!.calls as Call[]).map((c) => `${c.call} ${c.path.join(">")}`);
    expect(calls).toEqual([
      "Expand Utilities",
      "Expand Utilities>Sub",
      "Collapse Utilities>Sub",
      "Collapse Utilities",
    ]);
  });

  it("refuses with refused-foreground when a window of the pid is in front", () => {
    const r = runPy(fixture({ foreground: 100 }), ["--menus", "File", "--really"]);
    expect(r.code).toBe(3);
    expect(r.doc!.result).toBe("refused-foreground");
    expect(r.doc!.calls).toBeUndefined();
  });

  it("--allow-foreground lifts that refusal (sf-13, after the owner's hand)", () => {
    const r = runPy(fixture({ foreground: 100 }), [
      "--menus",
      "File",
      "--allow-foreground",
      "--really",
    ]);
    expect(r.code).toBe(0);
    expect(r.doc!.result).toBe("ok");
  });

  it("refuses to start while a Script Authorization Required window of the pid exists", () => {
    const r = runPy(
      fixture({
        extraWindows: [
          {
            hwnd: 300,
            pid: PID,
            className: "TestDialog",
            title: "Script Authorization Required",
            owned: true,
          },
        ],
      }),
      ["--menus", "File", "--really"],
    );
    expect(r.code).toBe(3);
    expect(r.doc!.result).toBe("refused-auth-window");
  });

  it("a popup still open after Collapse is reported in leftOpen and stops the run", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).stuck = true;
    const r = runPy(t, ["--menus", "File,Help", "--really"]);
    expect(r.code).toBe(6);
    expect(r.doc!.result).toBe("stopped");
    expect(r.doc!.leftOpen).toEqual([["File"]]);
    expect(String(r.doc!.handoff)).toContain("Esc");
    expect((r.doc!.calls as Call[]).some((c) => c.path[0] === "Help")).toBe(false);
  });

  it("a popup that reads open after Collapse and closes by itself is closedLate, not a stop (P4-1 2026-10-12)", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).closesLate = true;
    const r = runPy(t, ["--menus", "File,Help", "--really"]);
    expect(r.code).toBe(0);
    expect(r.doc!.leftOpen).toEqual([]);
    const file = (r.doc!.menus as Array<Record<string, unknown>>).find((m) => m.title === "File")!;
    expect(file.collapsed).toBe(true);
    expect(file.closedLate).toBe(true);
    // nothing sent between the two reads: one Collapse for File, then Help goes on
    const calls = r.doc!.calls as Call[];
    expect(calls.filter((c) => c.call === "Collapse" && c.path.join() === "File").length).toBe(1);
    expect(calls.some((c) => c.path[0] === "Help")).toBe(true);
  });

  it("a new window that is not a popup after Expand stops the run and collapses", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).opensWindow = {
      hwnd: 400,
      pid: PID,
      className: "TestMainClass2",
      title: "Something",
      owned: false,
    };
    const r = runPy(t, ["--menus", "File", "--really"]);
    expect(r.code).toBe(6);
    expect(r.doc!.leftOpen).toEqual([]);
    expect((r.doc!.calls as Call[]).at(-1)).toEqual({ call: "Collapse", path: ["File"] });
  });

  it("the stop names every new window it counted (className, title, owned)", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).opensWindow = {
      hwnd: 401,
      pid: PID,
      className: "TestMainClass2",
      title: "Something",
      owned: false,
    };
    const r = runPy(t, ["--menus", "File", "--really"]);
    expect(r.code).toBe(6);
    expect(r.doc!.newWindows).toEqual([
      { className: "TestMainClass2", title: "Something", owned: false },
    ]);
    expect(String(r.doc!.reason)).toContain("className='TestMainClass2'");
    expect(String(r.doc!.reason)).toContain("owned=False");
  });

  it("an unowned untitled SysShadow helper with an unowned Qt popup is part of the popup", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    const file = (bar[1].children as Node[])[0] as Node;
    file.popup = {
      hwnd: 501,
      pid: PID,
      className: "Qt683QWindowPopupDropShadowSaveBits",
      title: "Workbench",
      owned: false,
    };
    file.opensWindow = { hwnd: 502, pid: PID, className: "SysShadow", title: "", owned: false };
    const r = runPy(t, ["--menus", "File", "--really"]);
    expect(r.doc!.newWindows).toBeUndefined();
    expect(String(r.doc!.reason ?? "")).not.toContain("not a popup");
    expect((r.doc!.menus as Node[])[0].opened).toBe(true);
  });

  it("a titled SysShadow-class window is still a new window", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).opensWindow = {
      hwnd: 503,
      pid: PID,
      className: "SysShadow",
      title: "Titled",
      owned: false,
    };
    const r = runPy(t, ["--menus", "File", "--really"]);
    expect(r.code).toBe(6);
    expect(r.doc!.newWindows).toEqual([{ className: "SysShadow", title: "Titled", owned: false }]);
  });

  it("a title that is not allow-listed is refused before anything runs", () => {
    const r = runPy(fixture(), ["--menus", "System", "--really"]);
    expect(r.code).toBe(2);
    expect(r.doc).toBeNull();
    expect(r.stderr).toContain("not among");
  });

  it("an allow-listed name on an element that is not a MenuItem is refused without a call", () => {
    const top = [
      { controlType: "Button", name: "File", patterns: ["Invoke", "ExpandCollapse"], children: [] },
    ];
    const r = runPy(fixture({ top }), ["--menus", "File", "--really"]);
    expect(r.code).toBe(3);
    expect(r.doc!.result).toBe("refused");
    expect(r.doc!.calls).toEqual([]);
  });
});

describe.skipIf(!HAS_PYTHON)("menus.py stop rules (review F-H2, F-H3)", () => {
  it("F-H2: an Expand that fronts the Workbench stops before any read and collapses", () => {
    const t = fixture();
    t.foregroundAfterExpand = 100;
    const r = runPy(t, ["--menus", "File,Help", "--really"]);
    expect(r.code).toBe(3);
    expect(r.doc!.result).toBe("refused-foreground");
    expect((r.doc!.menus as Array<{ items: Node[] }>)[0].items).toEqual([]);
    expect(r.doc!.calls).toEqual([
      { call: "Expand", path: ["File"] },
      { call: "Collapse", path: ["File"] },
    ]);
    expect(r.doc!.leftOpen).toEqual([]);
  });

  it("F-H3: an unowned popup of the Qt popup class titled like the main window is expected", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).popup = {
      hwnd: 210,
      pid: PID,
      className: "Qt683QWindowPopupDropShadowSaveBits",
      title: "Workbench",
      owned: false,
    };
    const r = runPy(t, ["--menus", "File", "--really"]);
    expect(r.code).toBe(0);
    expect(r.doc!.result).toBe("ok");
  });

  it("F18: an owned titled dialog after an Expand is a new window: stop and collapse", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).opensWindow = {
      hwnd: 600,
      pid: PID,
      className: "Qt683QWindowIcon",
      title: "Some Dialog",
      owned: true,
      ownerHwnd: 100,
    };
    const r = runPy(t, ["--menus", "File,Help", "--really"]);
    expect(r.code).toBe(6);
    expect(r.doc!.result).toBe("stopped");
    expect(r.doc!.newWindows).toEqual([
      { className: "Qt683QWindowIcon", title: "Some Dialog", owned: true },
    ]);
    expect((r.doc!.calls as Call[]).at(-1)).toEqual({ call: "Collapse", path: ["File"] });
    expect((r.doc!.calls as Call[]).some((c) => c.path[0] === "Help")).toBe(false);
  });

  it("F18: an owned #32770 or a disabled popup-class window is a stop too", () => {
    for (const w of [
      { hwnd: 601, pid: PID, className: "#32770", title: "", owned: true, ownerHwnd: 100 },
      {
        hwnd: 602,
        pid: PID,
        className: "Qt683QWindowPopupDropShadowSaveBits",
        title: "",
        owned: false,
        enabled: false,
      },
      {
        hwnd: 603,
        pid: PID,
        className: "Qt683QWindowPopupDropShadowSaveBits",
        title: "",
        owned: true,
        ownerHwnd: 777,
      },
    ]) {
      const t = fixture();
      const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
      ((bar[1].children as Node[])[0] as Node).opensWindow = w;
      const r = runPy(t, ["--menus", "File", "--really"]);
      expect(r.code, w.className).toBe(6);
    }
  });

  it("F18: a popup-class window owned by the main window and untitled is a popup", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).popup = {
      hwnd: 604,
      pid: PID,
      className: "Qt683QWindowPopupDropShadowSaveBits",
      title: "",
      owned: true,
      ownerHwnd: 100,
    };
    const r = runPy(t, ["--menus", "File", "--really"]);
    expect(r.code).toBe(0);
    expect(r.doc!.result).toBe("ok");
  });

  it("F-H3: a disabled main window after an Expand stops the run and collapses", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).disablesMain = 100;
    const r = runPy(t, ["--menus", "File", "--really"]);
    expect(r.code).toBe(6);
    expect(String(r.doc!.reason)).toContain("disabled");
    expect((r.doc!.calls as Call[]).at(-1)).toEqual({ call: "Collapse", path: ["File"] });
  });

  // Session 017 (DEC-057): b-075 and six Plugins sub-menus stopped on a COMError from Expand,
  // and menus.py let the traceback out without a Collapse.
  it("a sub-menu whose Expand raises is collapsed, reported failed, and the walk goes on", () => {
    const leaf = (n: string): Node => ({
      controlType: "MenuItem",
      name: n,
      patterns: [],
      state: 3,
    });
    const t = fixture({
      top: [
        item("Utilities", [
          item("Bad", [leaf("x")], { expandRaises: "COMError -2147220991" }),
          item("Good", [leaf("y")]),
        ]),
      ],
    });
    const r = runPy(t, ["--menus", "Utilities", "--depth", "1", "--really"]);
    expect(r.code).toBe(0);
    expect(r.doc!.result).toBe("ok");
    const calls = (r.doc!.calls as Call[]).map((c) => `${c.call} ${c.path.join(">")}`);
    expect(calls).toEqual([
      "Expand Utilities",
      "Expand Utilities>Bad",
      "Collapse Utilities>Bad",
      "Expand Utilities>Good",
      "Collapse Utilities>Good",
      "Collapse Utilities",
    ]);
    const items = (r.doc!.menus as Array<{ items: Node[] }>)[0].items;
    expect(items[0]).toMatchObject({
      name: "Bad",
      opened: false,
      collapsed: true,
      failed: "FakeProviderError: COMError -2147220991",
    });
    expect(items[0].children).toBeUndefined();
    expect(items[1]).toMatchObject({ name: "Good", opened: true, collapsed: true });
    expect(r.doc!.failedItems).toEqual([["Utilities", "Bad"]]);
    expect(r.doc!.leftOpen).toEqual([]);
  });

  it("a top-level title whose Expand raises is collapsed and the next title still runs", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    ((bar[1].children as Node[])[0] as Node).expandRaises = "COMError";
    const r = runPy(t, ["--menus", "File,Help", "--really"]);
    expect(r.code).toBe(0);
    const menus = r.doc!.menus as Array<{ title: string; opened: boolean; failed?: string }>;
    expect(menus.map((m) => [m.title, m.opened, m.failed ?? null])).toEqual([
      ["File", false, "FakeProviderError: COMError"],
      ["Help", true, null],
    ]);
    expect(r.doc!.failedItems).toEqual([["File"]]);
    expect((r.doc!.calls as Call[]).slice(0, 2)).toEqual([
      { call: "Expand", path: ["File"] },
      { call: "Collapse", path: ["File"] },
    ]);
    expect(r.doc!.leftOpen).toEqual([]);
  });

  it("when the Collapse after a failed Expand raises too and the item reads open, it stops with leftOpen", () => {
    const t = fixture();
    const bar = ((t.windows as Node[])[0].tree as Node).children as Node[];
    Object.assign((bar[1].children as Node[])[0] as Node, {
      expandRaises: "COMError",
      collapseRaises: true,
    });
    const r = runPy(t, ["--menus", "File,Help", "--really"]);
    expect(r.code).toBe(6);
    expect(r.doc!.result).toBe("stopped");
    expect(String(r.doc!.reason)).toContain("the Collapse after it failed too");
    expect(r.doc!.leftOpen).toEqual([["File"]]);
    expect((r.doc!.calls as Call[]).some((c) => c.path[0] === "Help")).toBe(false);
  });
});

// ── menus.ts ─────────────────────────────────────────────────────────────────

describe("menus.ts", () => {
  const opts: MenuOptions = {
    pid: PID,
    className: CLASS,
    title: "Workbench",
    menus: ["File"],
    depth: 0,
  };

  it.skipIf(!HAS_PYTHON)("MAIN_MENU_TITLES mirrors menus.py", () => {
    const r = spawnSync(
      PY,
      [
        "-B",
        "-c",
        "import sys; sys.path.insert(0, sys.argv[1]); import menus, json; print(json.dumps(menus.MAIN_MENU_TITLES))",
        join(MENUS_SCRIPT, ".."),
      ],
      {
        encoding: "utf-8",
      },
    );
    expect(JSON.parse(r.stdout)).toEqual([...MAIN_MENU_TITLES]);
  });

  it("validates the options", () => {
    expect(validateMenuOptions(opts)).toBeNull();
    expect(validateMenuOptions({ ...opts, menus: ["System"] })).toMatch(/not among/);
    expect(validateMenuOptions({ ...opts, depth: 2 as 0 })).toMatch(/depth/);
    expect(validateMenuOptions({ ...opts, className: "" })).toMatch(/class/);
    expect(validateMenuOptions({ ...opts, menus: ["File", "File"] })).toMatch(/twice/);
  });

  it("passes --really only when asked", () => {
    expect(menusArgv(opts, "uia")).not.toContain("--really");
    expect(menusArgv({ ...opts, really: true }, "uia")).toContain("--really");
  });

  it("the plan passes the checker against the repo policy (live_lane.uia_menu)", () => {
    const check = checkPlan(buildMenuPlan(opts), loadPolicy(), { script: "tools/uia/menus.ts" });
    expect(check.ok).toBe(true);
    const deep = checkPlan(
      buildMenuPlan({ ...opts, menus: [...MAIN_MENU_TITLES], depth: 1 }),
      loadPolicy(),
      {
        script: "tools/uia/menus.ts",
      },
    );
    expect(deep.ok).toBe(true);
  });
});

// ── Phase 4: the popup descent and the per-module allow-list (L02) ───────────

describe.skipIf(!HAS_PYTHON)("menus.py reads items inside the Menu popup (P4 L02)", () => {
  const popupTree = (): Node => {
    const leaf = (n: string, extra: Node = {}): Node => ({
      controlType: "MenuItem",
      name: n,
      className: "QAction",
      patterns: ["Invoke"],
      state: 3,
      ...extra,
    });
    const menu = (kids: Node[]): Node => ({
      controlType: "Menu",
      name: "",
      className: "QMenu",
      children: kids,
    });
    return fixture({
      top: [
        item("File", [
          menu([
            leaf("Save", { accessKey: "Ctrl+S" }),
            { controlType: "Separator", name: "" },
            leaf("Exit"),
          ]),
        ]),
        item("Tools", [
          menu([
            item("Sub", [menu([leaf("Deep", { checked: true })])]),
            leaf("Run", { enabled: false }),
          ]),
        ]),
      ],
    });
  };
  it("descends into the unnamed Menu child and reads its items (sf-13 stopped there)", () => {
    const r = runPy(popupTree(), ["--menus", "File", "--allowed", "File,Tools", "--really"]);
    expect(r.code).toBe(0);
    const m = (r.doc!.menus as Array<{ items: Node[]; popup: Node }>)[0];
    expect(m.items.map((i) => i.name)).toEqual(["Save", "", "Exit"]);
    expect(m.items[0].accessKey).toBe("Ctrl+S");
    expect(m.popup).toMatchObject({ count: 1, truncated: false });
  });
  it("--depth 1 expands the sub-menu inside the popup and reads its own popup", () => {
    const r = runPy(popupTree(), [
      "--menus",
      "Tools",
      "--allowed",
      "File,Tools",
      "--depth",
      "1",
      "--really",
    ]);
    expect(r.code).toBe(0);
    const m = (r.doc!.menus as Array<{ items: Array<Node & { children?: Node[] }> }>)[0];
    expect(m.items[0].children!.map((c) => [c.name, c.checked])).toEqual([["Deep", true]]);
    expect(m.items[1].enabled).toBe(false);
    expect((r.doc!.calls as Call[]).map((c) => `${c.call} ${c.path.join(">")}`)).toEqual([
      "Expand Tools",
      "Expand Tools>Sub",
      "Collapse Tools>Sub",
      "Collapse Tools",
    ]);
  });
  it("--allowed replaces the S-F list; a title off it, or System on it, is refused", () => {
    expect(runPy(popupTree(), ["--menus", "Tools", "--really"]).code).toBe(2);
    expect(
      runPy(popupTree(), ["--menus", "File", "--allowed", "File,System", "--really"]).code,
    ).toBe(2);
  });
});

describe("menus.ts module allow-list (P4 L02)", () => {
  const opts: MenuOptions = {
    pid: PID,
    className: CLASS,
    title: "Workbench",
    menus: ["Game"],
    depth: 1,
  };
  it("titlesFor reads titles_by_module from the policy", () => {
    expect(titlesFor(loadPolicy(), "WorldEditor")).toContain("Game");
    expect(titlesFor(loadPolicy(), "ParticleEditor")).toBeNull();
  });
  it("validates against the module list and passes it to menus.py; the plan names the module", () => {
    const allowed = titlesFor(loadPolicy(), "WorldEditor")!;
    expect(validateMenuOptions(opts)).toMatch(/not among/);
    expect(validateMenuOptions({ ...opts, module: "WorldEditor", allowed })).toBeNull();
    expect(validateMenuOptions({ ...opts, module: "Nope" })).toMatch(/titles_by_module/);
    const o = { ...opts, module: "WorldEditor", allowed };
    expect(menusArgv(o, "uia")).toContain("--allowed");
    const plan = buildMenuPlan(o);
    expect(plan[0].module).toBe("WorldEditor");
    expect(checkPlan(plan, loadPolicy(), { script: "tools/uia/menus.ts" }).ok).toBe(true);
  });
});

// ── uia_com.py: the generated UIAutomationCore wrapper (session 017, DEC-057) ─

const UIA_COM_SCRIPT = join(dirname(MENUS_SCRIPT), "uia_com.py");

/**
 * Runs uia_com.main with stand-in import and GetModule functions, so no real wrapper is read or
 * written. `state` is "present", "missing" or "regenerates" (missing until GetModule runs).
 */
function runWrapperCheck(
  state: "present" | "missing" | "regenerates",
  args: string[],
): { code: number | null; doc: Record<string, unknown> | null; generated: string[] } {
  const script = [
    "import io, json, sys",
    `sys.path.insert(0, ${JSON.stringify(dirname(UIA_COM_SCRIPT))})`,
    "import uia_com",
    `state = {"s": ${JSON.stringify(state)}, "generated": []}`,
    "class M: __file__ = 'gen/UIAutomationClient.py'",
    "def imp(name):",
    "    assert name == 'comtypes.gen.UIAutomationClient', name",
    "    if state['s'] == 'present': return M",
    "    raise ImportError('cannot import name UIAutomationClient from comtypes.gen')",
    "def gm(lib):",
    "    state['generated'].append(lib)",
    "    if state['s'] == 'regenerates': state['s'] = 'present'",
    "buf = io.StringIO()",
    `code = uia_com.main(${JSON.stringify(args)}, import_module=imp, get_module=gm, out=buf)`,
    "sys.stdout.write(json.dumps({'code': code, 'out': buf.getvalue(), 'generated': state['generated']}))",
  ].join("\n");
  const r = spawnSync(PY, ["-B", "-c", script], { encoding: "utf-8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(r.stderr);
  const res = JSON.parse(r.stdout) as { code: number; out: string; generated: string[] };
  return {
    code: res.code,
    doc: res.out.trim() ? (JSON.parse(res.out) as Record<string, unknown>) : null,
    generated: res.generated,
  };
}

describe.skipIf(!HAS_PYTHON || process.platform !== "win32")(
  "uia_com.py --check-wrapper (the comtypes.gen wrapper a Python or comtypes update removes)",
  () => {
    it("a present wrapper reads ok, exit 0, and nothing is generated", () => {
      const r = runWrapperCheck("present", ["--check-wrapper"]);
      expect(r.code).toBe(0);
      expect(r.doc!.wrapper_status).toMatchObject({ ok: true, error: null });
      expect(r.generated).toEqual([]);
    });

    it("a missing wrapper is reported, exit 4, and the check alone writes nothing", () => {
      const r = runWrapperCheck("missing", ["--check-wrapper"]);
      expect(r.code).toBe(4);
      expect(r.doc!.wrapper_status).toMatchObject({ ok: false });
      expect(String((r.doc!.wrapper_status as { error: string }).error)).toMatch(/^ImportError:/);
      expect(r.doc!.regenerated).toBeUndefined();
      expect(r.generated).toEqual([]);
    });

    it("--regenerate calls GetModule('UIAutomationCore.dll') once and checks again", () => {
      const r = runWrapperCheck("regenerates", ["--check-wrapper", "--regenerate"]);
      expect(r.code).toBe(0);
      expect(r.generated).toEqual(["UIAutomationCore.dll"]);
      expect(r.doc!.regenerated).toMatchObject({ ok: true, typelib: "UIAutomationCore.dll" });
      expect(r.doc!.wrapper_status).toMatchObject({ ok: true });
    });

    it("--regenerate on a present wrapper writes nothing; a GetModule that does not help exits 4", () => {
      expect(runWrapperCheck("present", ["--check-wrapper", "--regenerate"]).generated).toEqual([]);
      const r = runWrapperCheck("missing", ["--check-wrapper", "--regenerate"]);
      expect(r.code).toBe(4);
      expect(r.generated).toEqual(["UIAutomationCore.dll"]);
    });

    it("any other argument is a usage error", () => {
      expect(runWrapperCheck("present", ["--check-wrapper", "--bogus"]).code).toBe(2);
      expect(runWrapperCheck("present", []).code).toBe(2);
    });
  },
);
