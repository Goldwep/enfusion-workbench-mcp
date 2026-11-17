import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { defaultPlaceholderContext } from "../../scripts/live/paths.js";
import {
  CONTEXT_SCRIPT,
  buildContextPlan,
  buildPassivePlan,
  contextArgv,
  runContext,
  validateContextOptions,
  type ContextOptions,
} from "../../tools/uia/context.js";
import { redactionTable } from "../../tools/uia/walk.js";

// Window classes, titles and trees below are synthetic test data, not Workbench facts.
const PY = process.env.ENFUSION_PYTHON || "python";
const HAS_PYTHON = spawnSync(PY, ["--version"], { encoding: "utf-8" }).status === 0;
const PID = 4242;
const CLASS = "TestMainClass";
const TMP = mkdtempSync(join(tmpdir(), "emcp-ctx-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

type Node = Record<string, unknown>;

function popupWindow(over: Node = {}, rootPatterns: string[] = ["ExpandCollapse"]): Node {
  return {
    hwnd: 300,
    pid: PID,
    className: "TestQWindowPopupClass",
    title: "Workbench",
    owned: false,
    tree: {
      controlType: "Window",
      name: "Workbench",
      className: "QMenu",
      automationId: "App.QMenu",
      patterns: rootPatterns,
      children: [
        { controlType: "MenuItem", name: "Show in Explorer", className: "QAction", enabled: false },
        { controlType: "Separator", className: "QAction" },
        {
          controlType: "MenuItem",
          name: "Delete\tDel",
          className: "QAction",
          patterns: ["Invoke"],
        },
      ],
    },
    ...over,
  };
}

function fixture(target: Node = {}, extraWindows: Node[] = []): Node {
  return {
    foreground: 999,
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
            {
              controlType: "Window",
              name: "Hierarchy",
              className: "QDockWidget",
              children: [
                { controlType: "TreeItem", name: "other", selected: true },
                {
                  controlType: "TreeItem",
                  name: "default",
                  contextPopup: popupWindow(),
                  ...target,
                },
              ],
            },
          ],
        },
      },
      { hwnd: 999, pid: 1, className: "Other", title: "Other app" },
      ...extraWindows,
    ],
  };
}

function runPy(
  tree: Node,
  args: string[] = [],
  path = '["Hierarchy","default"]',
): { code: number | null; doc: Record<string, unknown> | null; stdout: string } {
  const f = join(TMP, `tree-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(tree));
  const r = spawnSync(
    PY,
    [
      "-B",
      CONTEXT_SCRIPT,
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
      "--path",
      path,
      "--timeout-ms",
      "1000",
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
  return { code: r.status, doc, stdout: r.stdout ?? "" };
}

const callsOf = (doc: Record<string, unknown> | null): string[] =>
  ((doc?.calls as Array<{ call: string }>) ?? []).map((c) => c.call);

// ── Source scan: the only verbs are ShowContextMenu and Collapse ─────────────

function pythonCode(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*$/, ""))
    .join("\n")
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}
const BANNED =
  /\b(Invoke|Toggle|Select|AddToSelection|RemoveFromSelection|SetValue|SetFocus|SendInput|SendKeys|keybd_event|mouse_event|SetCursorPos|PostMessageW?|SendMessageW?|SetForegroundWindow|BringWindowToTop|ShowWindow|SetWindowPos|SetActiveWindow|DoDefaultAction|Expand|VK_ESCAPE|pywinauto|pyautogui)\s*\(/;
const VERB = /\.\s*(ShowContextMenu|Collapse|Expand|Invoke|Toggle|Select|SetValue|SetFocus)\s*\(/g;

describe.skipIf(!HAS_PYTHON)("context.py source scan", () => {
  it("calls only ShowContextMenu and Collapse; no key, no invoke, no click", () => {
    const code = pythonCode(readFileSync(CONTEXT_SCRIPT, "utf-8"));
    const verbs = new Set<string>();
    code.split("\n").forEach((l) => {
      for (const m of l.matchAll(VERB)) verbs.add(m[1]);
      expect(BANNED.exec(l)).toBeNull();
    });
    // Collapse goes through menus.ComMenuProvider.collapse (ExpandCollapse, scanned by uia-menus).
    expect(verbs).toEqual(new Set(["ShowContextMenu"]));
    expect(code).toMatch(/self\._m\.collapse\(el\)/);
    expect(code).not.toMatch(/GetCurrentPattern/);
  });
});

// ── context.py on the fake provider ──────────────────────────────────────────

describe.skipIf(!HAS_PYTHON)("context.py on the fake provider", () => {
  it("dry run by default: prints the plan, attaches nothing", () => {
    const r = runPy(fixture());
    expect(r.code).toBe(0);
    expect(r.doc?.dry_run).toBe(true);
    expect(JSON.stringify(r.doc)).not.toMatch(/"Invoke"/);
  });

  it("supported: shows, reads the popup passively, collapses it", () => {
    const r = runPy(fixture(), ["--really"]);
    expect(r.code).toBe(0);
    expect(r.doc?.result).toBe("ok");
    expect(r.doc?.supported).toBe(true);
    expect(r.doc?.collapsed).toBe(true);
    expect(r.doc?.leftOpen).toBe(false);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu", "Collapse"]);
    const items = r.doc?.items as Array<{ name: string; controlType: string }>;
    expect(items.map((i) => i.controlType)).toEqual(["MenuItem", "Separator", "MenuItem"]);
    expect(items[2].name).toBe("Delete\tDel");
    expect((r.doc?.popup as { uiaClassName: string }).uiaClassName).toBe("QMenu");
    expect(r.doc?.selectionChanged).toBe(false);
  });

  it("records a selection change caused by ShowContextMenu as a fact", () => {
    const r = runPy(fixture({ selectOnShow: true }), ["--really"]);
    expect(r.doc?.result).toBe("ok");
    expect(r.doc?.selectionChanged).toBe(true);
    expect(r.doc?.selection).toMatchObject({ before: ["other"], after: ["default"] });
  });

  it("unsupported: supported false, nothing else touched, exit 0", () => {
    const r = runPy(fixture({ showUnsupported: true }), ["--really"]);
    expect(r.code).toBe(0);
    expect(r.doc?.result).toBe("unsupported");
    expect(r.doc?.supported).toBe(false);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu"]);
    expect(r.doc?.popup).toBeNull();
  });

  it("left open: no ExpandCollapse on the popup means no Collapse call, leftOpen, exit 5", () => {
    const r = runPy(fixture({ contextPopup: popupWindow({}, []) }), ["--really"]);
    expect(r.code).toBe(5);
    expect(r.doc?.result).toBe("left-open");
    expect(r.doc?.leftOpen).toBe(true);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu"]);
    expect(String(r.doc?.handoff)).toMatch(/Esc/);
  });

  it("left open: a Collapse that does not close the popup is leftOpen, exit 5", () => {
    const r = runPy(fixture({ contextPopup: popupWindow({ stuck: true }) }), ["--really"]);
    expect(r.code).toBe(5);
    expect(r.doc?.leftOpen).toBe(true);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu", "Collapse"]);
  });

  it("timeout: no popup within timeoutMs stops (exit 6), nothing collapsed", () => {
    const r = runPy(fixture({ contextPopup: undefined }), ["--really"]);
    expect(r.code).toBe(6);
    expect(r.doc?.result).toBe("timeout");
    expect(r.doc?.supported).toBe(true);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu"]);
  });

  it("a popup that comes after a few polls is still read", () => {
    const r = runPy(fixture({ contextPopup: popupWindow({ popupDelayPolls: 3 }) }), ["--really"]);
    expect(r.doc?.result).toBe("ok");
  });

  it("a new window that is not the popup pair stops (exit 6) after collapsing the popup", () => {
    const r = runPy(
      fixture({
        opensWindow: { hwnd: 400, pid: PID, className: "#32770", title: "Dialog", owned: true },
      }),
      ["--really"],
    );
    expect(r.code).toBe(6);
    expect(r.doc?.result).toBe("stopped");
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu", "Collapse"]);
  });

  it("an unknown or ambiguous target is refused with no call", () => {
    let r = runPy(fixture(), ["--really"], '["Hierarchy","missing"]');
    expect(r.code).toBe(3);
    expect(callsOf(r.doc)).toEqual([]);
    const t = fixture();
    const dock = ((t.windows as Node[])[0].tree as { children: Node[] }).children[0] as {
      children: Node[];
    };
    dock.children.push({ controlType: "TreeItem", name: "default" });
    r = runPy(t, ["--really"]);
    expect(r.code).toBe(3);
    expect(callsOf(r.doc)).toEqual([]);
  });

  it("a non-final step named twice takes the container; an @Class.n step picks by class ordinal", () => {
    const t = fixture();
    const top = (t.windows as Node[])[0].tree as { children: Node[] };
    // A dock tab shares the dock's title (P4-FIX-K: "2 elements named 'Hierarchy'").
    top.children.unshift({ controlType: "TabItem", name: "Hierarchy" });
    let r = runPy(t, ["--really"]);
    expect(r.code).toBe(0);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu", "Collapse"]);
    const dock = top.children[1] as { className?: string };
    expect(dock.className).toBe("QDockWidget");
    r = runPy(t, ["--really"], '["@QDockWidget.1","default"]');
    expect(r.code).toBe(0);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu", "Collapse"]);
    r = runPy(t, ["--really"], '["@QDockWidget.2","default"]');
    expect(r.code).toBe(3);
    expect(callsOf(r.doc)).toEqual([]);
    // Two containers of one name: still the first, but a leaf named twice is refused.
    top.children.unshift({ controlType: "TabItem", name: "default" });
    r = runPy(t, ["--really"], '["default"]');
    expect(r.code).toBe(3);
    expect(callsOf(r.doc)).toEqual([]);
  });

  it("an unsaved world's Hierarchy row `default*` matches the census name `default`, recorded (P4-5)", () => {
    let r = runPy(fixture({ name: "default*" }), ["--really"]);
    expect(r.code).toBe(0);
    expect(callsOf(r.doc)).toEqual(["ShowContextMenu", "Collapse"]);
    expect((r.doc?.target as { liveNames?: unknown }).liveNames).toEqual([
      { step: 2, census: "default", live: "default*" },
    ]);
    // An exact match wins and records nothing.
    r = runPy(fixture(), ["--really"]);
    expect((r.doc?.target as { liveNames?: unknown }).liveNames).toBeUndefined();
    // Only one trailing marker, only under the Hierarchy dock, uniqueness still required.
    r = runPy(fixture({ name: "default**" }), ["--really"]);
    expect(r.code).toBe(3);
    expect(callsOf(r.doc)).toEqual([]);
    const other = fixture({ name: "default*" });
    ((other.windows as Node[])[0].tree as { children: Array<{ name: string }> }).children[0].name =
      "Layers";
    r = runPy(other, ["--really"], '["Layers","default"]');
    expect(r.code).toBe(3);
    expect(String(r.doc?.reason)).toMatch(/0 elements named 'default'/);
    const twice = fixture({ name: "default*" });
    (
      ((twice.windows as Node[])[0].tree as { children: Node[] }).children[0] as {
        children: Node[];
      }
    ).children.push({ controlType: "TreeItem", name: "default*" });
    r = runPy(twice, ["--really"]);
    expect(r.code).toBe(3);
    expect(callsOf(r.doc)).toEqual([]);
  });

  it("refuses while a Script Authorization Required window or a popup of the pid is up", () => {
    let r = runPy(
      fixture({}, [
        { hwnd: 500, pid: PID, className: "#32770", title: "Script Authorization Required" },
      ]),
      ["--really"],
    );
    expect(r.doc?.result).toBe("refused-auth-window");
    r = runPy(fixture({}, [{ ...popupWindow(), hwnd: 501 }]), ["--really"]);
    expect(r.code).toBe(3);
    expect(callsOf(r.doc)).toEqual([]);
  });
});

// ── context.py --passive (the sf-15 route) ───────────────────────────────────

/** A fixture whose target never answers ShowContextMenu; the hand's popup comes by itself. */
function handFixture(hand: Node | null, extraWindows: Node[] = []): Node {
  const t = fixture({ contextPopup: undefined }, extraWindows);
  if (hand) t.handPopup = hand;
  return t;
}
const fakeCallsOf = (doc: Record<string, unknown> | null): unknown[] =>
  (doc?.fakeCalls as unknown[]) ?? ["missing"];

describe.skipIf(!HAS_PYTHON)("context.py --passive on the fake provider", () => {
  it("dry run: the plan names no ShowContextMenu step and lists it under never", () => {
    const r = runPy(handFixture(popupWindow()), ["--passive"]);
    expect(r.code).toBe(0);
    const plan = r.doc?.plan as { mode: string; steps: Array<{ call: string }>; never: string[] };
    expect(plan.mode).toBe("passive");
    expect(plan.steps.map((s) => s.call).join(" ")).not.toMatch(/ShowContextMenu|Collapse/);
    expect(plan.never).toEqual(expect.arrayContaining(["ShowContextMenu", "Collapse", "expand"]));
  });

  it("a popup the hand opened: read as the active path reads it, nothing sent, left open", () => {
    const r = runPy(handFixture(popupWindow({ popupDelayPolls: 3 })), ["--really", "--passive"]);
    expect(r.code).toBe(0);
    expect(r.doc?.result).toBe("ok");
    expect(r.doc).toMatchObject({ passive: true, openedBy: "hand", leftOpen: true });
    expect(r.doc?.popupPresentAtStart).toBe(false);
    expect(r.doc?.collapsed).toBeNull();
    expect(callsOf(r.doc)).toEqual([]);
    expect(fakeCallsOf(r.doc)).toEqual([]);
    const items = r.doc?.items as Array<{ name: string; controlType: string; enabled: boolean }>;
    expect(items.map((i) => i.controlType)).toEqual(["MenuItem", "Separator", "MenuItem"]);
    expect(items[0].enabled).toBe(false);
    expect(items[2].name).toBe("Delete\tDel");
    expect((r.doc?.popup as { uiaClassName: string }).uiaClassName).toBe("QMenu");
    expect(String(r.doc?.handoff)).toMatch(/Esc/);
  });

  it("the same items as the active path's read of the same popup", () => {
    const active = runPy(fixture(), ["--really"]);
    const passive = runPy(handFixture(popupWindow()), ["--really", "--passive"]);
    expect(passive.doc?.items).toEqual(active.doc?.items);
    expect(passive.doc?.popupPresentAtStart).toBe(true);
  });

  it("no popup in time: a clean no-popup result, exit 0, nothing sent", () => {
    const r = runPy(handFixture(null), ["--really", "--passive"]);
    expect(r.code).toBe(0);
    expect(r.doc?.result).toBe("no-popup");
    expect(r.doc?.popup).toBeNull();
    expect(String(r.doc?.reason)).toMatch(/no popup.*nothing was sent/);
    expect(callsOf(r.doc)).toEqual([]);
    expect(fakeCallsOf(r.doc)).toEqual([]);
  });

  it("a sub-menu item is flagged, never expanded: its own items are not read", () => {
    const pw = popupWindow();
    const tree = pw.tree as { children: Node[] };
    tree.children.push({
      controlType: "MenuItem",
      name: "Create",
      className: "QAction",
      patterns: ["ExpandCollapse"],
      children: [{ controlType: "MenuItem", name: "Hidden child", className: "QAction" }],
    });
    const r = runPy(handFixture(pw), ["--really", "--passive"]);
    expect(r.doc?.result).toBe("ok");
    const items = r.doc?.items as Array<{ name: string; submenu: boolean }>;
    expect(items.map((i) => i.name)).toEqual(["Show in Explorer", "", "Delete\tDel", "Create"]);
    expect(items[3].submenu).toBe(true);
    expect(JSON.stringify(r.doc)).not.toContain("Hidden child");
    expect(fakeCallsOf(r.doc)).toEqual([]);
  });

  it("two popups at once, or a stray new window: stopped, nothing read, nothing sent", () => {
    let r = runPy(handFixture(popupWindow(), [{ ...popupWindow(), hwnd: 600 }]), [
      "--really",
      "--passive",
    ]);
    expect(r.code).toBe(6);
    expect(r.doc?.result).toBe("stopped");
    expect(r.doc?.items).toEqual([]);
    expect(fakeCallsOf(r.doc)).toEqual([]);
    r = runPy(
      handFixture({
        hwnd: 700,
        pid: PID,
        className: "#32770",
        title: "Dialog",
        owned: true,
        popupDelayPolls: 2,
        tree: {},
      }),
      ["--really", "--passive"],
    );
    expect(r.code).toBe(6);
    expect(r.doc?.result).toBe("stopped");
    expect(fakeCallsOf(r.doc)).toEqual([]);
  });

  it("refuses while a Script Authorization Required window is up", () => {
    const r = runPy(
      handFixture(popupWindow(), [
        { hwnd: 500, pid: PID, className: "#32770", title: "Script Authorization Required" },
      ]),
      ["--really", "--passive"],
    );
    expect(r.doc?.result).toBe("refused-auth-window");
    expect(r.doc?.items).toEqual([]);
  });

  it("run_passive never reaches show_context_menu or collapse (source)", () => {
    const src = readFileSync(CONTEXT_SCRIPT, "utf-8");
    const body = /def run_passive\([\s\S]*?\n(?=def )/.exec(src)?.[0] ?? "";
    expect(body).toMatch(/provider\.windows/);
    const code = pythonCode(body);
    expect(code).not.toMatch(/show_context_menu|collapse|resolve_target|ShowContextMenu/);
  });
});

// ── context.ts ───────────────────────────────────────────────────────────────

function policyWith(targets: Array<{ module?: string; path: string[] }>): CensusPolicy {
  const p = JSON.parse(JSON.stringify(loadPolicy())) as CensusPolicy;
  (p.live_lane as Record<string, unknown>).uia_context = {
    ...(p.live_lane?.uia_context as Record<string, unknown>),
    targets,
  };
  return p;
}

const OPTS: ContextOptions = {
  pid: PID,
  className: CLASS,
  title: "Workbench",
  path: ["Hierarchy", "default"],
  module: "WorldEditor",
  timeoutMs: 1000,
};

describe("context.ts", () => {
  it("validates the options", () => {
    expect(validateContextOptions(OPTS)).toBeNull();
    expect(validateContextOptions({ ...OPTS, path: [] })).toMatch(/--path/);
    expect(validateContextOptions({ ...OPTS, className: "" })).toMatch(/--class/);
    expect(validateContextOptions({ ...OPTS, timeoutMs: 0 })).toMatch(/--timeout-ms/);
  });

  it("the plan passes the checker with the target listed, and holds no key and no invoke", () => {
    const plan = buildContextPlan(OPTS);
    const policy = policyWith([{ module: "WorldEditor", path: ["Hierarchy", "default"] }]);
    const r = checkPlan(plan, policy, { script: "tools/uia/context.ts" });
    expect(r.ok).toBe(true);
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/Invoke|"keys?"|Escape|"Esc"|click/i);
    expect(plan[0].calls).toEqual(["ShowContextMenu", "Collapse"]);
  });

  it("an unlisted target or an over-long timeout fails the checker", () => {
    const policy = policyWith([{ module: "WorldEditor", path: ["Hierarchy", "other"] }]);
    expect(checkPlan(buildContextPlan(OPTS), policy, { script: "x" }).ok).toBe(false);
    const listed = policyWith([{ path: ["Hierarchy", "default"] }]);
    expect(
      checkPlan(buildContextPlan({ ...OPTS, timeoutMs: 999_999 }), listed, { script: "x" }).ok,
    ).toBe(false);
  });

  it("passes --really only when asked", () => {
    expect(contextArgv(OPTS, "uia")).not.toContain("--really");
    expect(contextArgv({ ...OPTS, really: true }, "uia")).toContain("--really");
  });

  it("--passive: the argv carries it; the plan is one popup uia-read, no uia-context, and passes", () => {
    expect(contextArgv(OPTS, "uia")).not.toContain("--passive");
    expect(contextArgv({ ...OPTS, passive: true }, "uia")).toContain("--passive");
    const plan = buildPassivePlan({ pid: PID });
    expect(plan.map((a) => a.kind)).toEqual(["uia-read"]);
    expect(plan[0].readOnly).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/ShowContextMenu|Collapse|Invoke|"keys?"/);
    expect(checkPlan(plan, loadPolicy(), { script: "tools/uia/context.ts" }).ok).toBe(true);
  });

  it.skipIf(!HAS_PYTHON)(
    "runContext --passive on the fake provider: summary passive, popup read, nothing collapsed",
    async () => {
      const f = join(TMP, "ts-hand-tree.json");
      writeFileSync(f, JSON.stringify(handFixture(popupWindow())));
      const ctx = defaultPlaceholderContext();
      const r = await runContext({
        options: { ...OPTS, fakeTree: f, really: true, passive: true },
        provider: "fake",
        env: {},
        outPath: join(TMP, "out", "ctx-hand.json"),
        ctx,
        table: redactionTable(ctx, undefined, process.env),
      });
      expect(r.summary).toMatchObject({
        result: "ok",
        exit_code: 0,
        passive: true,
        popup: true,
        items: 3,
        collapsed: null,
        leftOpen: true,
      });
      expect(r.doc?.fakeCalls).toEqual([]);
    },
  );

  it.skipIf(!HAS_PYTHON)(
    "runContext on the fake provider writes the redacted artifact with its sha256",
    async () => {
      const f = join(TMP, "ts-tree.json");
      writeFileSync(f, JSON.stringify(fixture()));
      const ctx = defaultPlaceholderContext();
      const out = join(TMP, "out", "ctx.json");
      const r = await runContext({
        options: { ...OPTS, fakeTree: f, really: true },
        provider: "fake",
        env: {},
        outPath: out,
        ctx,
        table: redactionTable(ctx, undefined, process.env),
      });
      expect(r.summary).toMatchObject({
        result: "ok",
        exit_code: 0,
        supported: true,
        popup: true,
        items: 3,
        collapsed: true,
        leftOpen: false,
        selectionChanged: false,
      });
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(readFileSync(out, "utf-8")).toBe(r.text);
    },
  );
});
