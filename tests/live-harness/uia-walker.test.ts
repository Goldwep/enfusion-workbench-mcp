import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  BOUND_CAPS,
  DEFAULT_BOUNDS,
  UIA_DIR,
  WALKER_SCRIPT,
  boundSnake,
  buildActionPlan,
  checkUiaReadAction,
  main,
  redactionTable,
  runWalk,
  secondPass,
  validateTarget,
  walkerArgv,
  type WalkBounds,
  type WalkTarget,
} from "../../tools/uia/walk.js";

// Trees, window classes and titles below are synthetic test data, not Workbench
// facts. Planted personal data is assembled at test time (DEC-021 rule 3).
const PY = process.env.ENFUSION_PYTHON || "python";
const HAS_PYTHON = spawnSync(PY, ["--version"], { encoding: "utf-8" }).status === 0;

const PLANTED_USER = ["zz", "planted", "acct"].join("");
const PLANTED_HOST = ["zz", "planted", "host"].join("");
const PLANTED_HOME = ["T:", "Users", PLANTED_USER].join("\\");
const SANDBOX = [PLANTED_HOME, "Documents", "My Games", "addons", "EMCP2_sandbox"].join("\\");
const CLS = "TestQtWindowClass";
const PID = 4242;

/** Environment for the Python child: the planted identity replaces the real one. */
const PLANTED_ENV: Record<string, string> = {
  USERPROFILE: PLANTED_HOME,
  LOCALAPPDATA: `${PLANTED_HOME}\\AppData\\Local`,
  APPDATA: `${PLANTED_HOME}\\AppData\\Roaming`,
  USERNAME: PLANTED_USER,
  COMPUTERNAME: PLANTED_HOST,
  PYTHONDONTWRITEBYTECODE: "1",
};

type Node = Record<string, unknown>;

function workbenchLikeTree(): Node {
  return {
    controlType: "Window",
    name: `Resource Manager - ${SANDBOX}`,
    className: CLS,
    frameworkId: "Qt",
    rect: [0, 0, 1920.4, 1080],
    enabled: true,
    offscreen: false,
    patterns: ["Window", "Transform"],
    children: [
      {
        controlType: "MenuBar",
        name: "",
        children: ["File", "Edit", "Window"].map((n) => ({
          controlType: "MenuItem",
          name: n,
          patterns: ["ExpandCollapse"],
        })),
      },
      {
        controlType: "ToolBar",
        name: "Basic tools",
        automationId: "toolbarBasicTools",
        children: [
          {
            controlType: "Button",
            name: "Refresh",
            automationId: "toolbarBasicTools.refresh",
            helpText: "Refresh the view",
            acceleratorKey: "F5",
            patterns: ["Invoke"],
          },
          { controlType: "Button", name: `Signed in as ${PLANTED_USER}`, patterns: ["Invoke"] },
        ],
      },
      {
        controlType: "Pane",
        name: "Resource Browser",
        automationId: "resourceBrowserDock",
        className: "QDockWidget",
        children: [
          {
            controlType: "List",
            name: "files",
            automationId: "resourceBrowserDock.list",
            generate: { count: 30000, controlType: "ListItem", namePrefix: "row " },
          },
        ],
      },
      {
        controlType: "Table",
        name: "properties",
        patterns: ["Grid", "Table"],
        gridRowCount: 500,
        gridColumnCount: 2,
        generate: { count: 500, controlType: "DataItem", namePrefix: "prop " },
      },
      {
        controlType: "Tree",
        name: "hierarchy",
        children: [0, 1, 2].map((i) => ({
          controlType: "TreeItem",
          name: `layer ${i}`,
          generate: { count: 100, controlType: "TreeItem", namePrefix: `entity ${i}.` },
        })),
      },
    ],
  };
}

function windowList(overrides: Partial<Record<number, Node>> = {}): Node {
  const base: Node[] = [
    {
      hwnd: 101,
      pid: PID,
      className: CLS,
      title: `Resource Manager - ${SANDBOX}`,
      tree: workbenchLikeTree(),
    },
    {
      hwnd: 102,
      pid: PID,
      className: CLS,
      title: "World Editor - EMCP2_sandbox",
      tree: { controlType: "Window", name: "WE" },
    },
    {
      hwnd: 103,
      pid: PID,
      className: "TestLauncherClass",
      title: "Enfusion Workbench Launcher",
      tree: { controlType: "Window", name: "L" },
    },
    {
      hwnd: 104,
      pid: 9001,
      className: CLS,
      title: "Resource Manager - other",
      tree: { controlType: "Window", name: "X" },
    },
    {
      hwnd: 105,
      pid: PID,
      className: CLS,
      title: "Resource Manager - dialog",
      owned: true,
      tree: { controlType: "Window", name: "D" },
    },
  ];
  return { windows: base.map((w) => ({ ...w, ...(overrides[w.hwnd as number] ?? {}) })) };
}

let dir = "";
let seq = 0;

function writeTree(data: Node): string {
  const p = join(dir, `tree-${++seq}.json`);
  writeFileSync(p, JSON.stringify(data), "utf-8");
  return p;
}

interface PyResult {
  status: number | null;
  stdout: string;
  stderr: string;
  doc: Record<string, any> | null;
}

function runPy(args: string[], extraEnv: Record<string, string> = {}): PyResult {
  const r = spawnSync(PY, ["-B", WALKER_SCRIPT, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...PLANTED_ENV, ...extraEnv },
    timeout: 60_000,
  });
  const line = (r.stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
  let doc: Record<string, any> | null = null;
  try {
    doc = line ? JSON.parse(line) : null;
  } catch {
    doc = null;
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", doc };
}

function walkFake(
  data: Node,
  extra: string[] = [],
  titlePattern = "Resource Manager - .*",
): PyResult {
  return runPy([
    "--provider",
    "fake",
    "--fake-tree",
    writeTree(data),
    "--pid",
    String(PID),
    "--class",
    CLS,
    "--title-pattern",
    titlePattern,
    ...extra,
  ]);
}

function chain(depth: number): Node {
  let node: Node = { controlType: "Text", name: "leaf" };
  for (let i = depth; i > 0; i--)
    node = { controlType: "Pane", name: `level ${i}`, children: [node] };
  return node;
}

function findNodes(tree: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (pred(tree)) out.push(tree);
  for (const c of tree.children ?? []) findNodes(c, pred, out);
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "uia-walker-"));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// ── Plan and target (no Python needed) ──────────────────────────────────────

const TARGET: WalkTarget = { pid: PID, className: CLS, titlePattern: "Resource Manager - .*" };

describe("action plan", () => {
  it("emits the read as one uia-read action, and the checker passes it with the policy caps", () => {
    const plan = buildActionPlan(TARGET, DEFAULT_BOUNDS, "raw");
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      kind: "uia-read",
      readOnly: true,
      target: { pid: PID, window: { className: CLS, titlePattern: "Resource Manager - .*" } },
      bounds: DEFAULT_BOUNDS,
    });
    const r = checkPlan(plan, loadPolicy(), { script: "tools/uia/walk.ts" });
    expect(r.violations).toEqual([]);
    expect(checkUiaReadAction(plan[0])).toEqual([]);
  });

  it("the checker refuses the read when the policy holds no caps", () => {
    const plan = buildActionPlan(TARGET, DEFAULT_BOUNDS, "raw");
    const policy = loadPolicy();
    const r = checkPlan(plan, { ...policy, live_lane: {} });
    expect(r.ok).toBe(false);
    expect(new Set(r.violations.map((v) => v.rule))).toEqual(new Set(["uia-read-unbounded"]));
    expect(r.violations).toHaveLength(9);
  });

  it("the policy caps are the code's caps", () => {
    const caps = { ...(loadPolicy().live_lane?.uia_read ?? {}) } as Record<string, unknown>;
    delete caps.$comment;
    expect(caps).toEqual({ ...BOUND_CAPS });
  });

  it("the uia-read rule refuses an untargeted, unbounded or acting read", () => {
    const [ok] = buildActionPlan(TARGET, DEFAULT_BOUNDS, "raw");
    const rules = (a: Record<string, unknown>) =>
      checkUiaReadAction({ ...ok, ...a } as never).map((v) => v.rule);
    expect(rules({ target: { window: { className: CLS, titlePattern: "x" } } })).toContain(
      "uia-read-untargeted",
    );
    expect(rules({ target: { pid: PID, window: { titlePattern: "x" } } })).toContain(
      "uia-read-untargeted",
    );
    expect(rules({ target: { pid: PID, window: "foreground" } })).toContain("uia-read-untargeted");
    expect(rules({ bounds: { ...DEFAULT_BOUNDS, maxNodes: BOUND_CAPS.maxNodes + 1 } })).toContain(
      "uia-read-unbounded",
    );
    const noBudget: Partial<WalkBounds> = { ...DEFAULT_BOUNDS };
    delete noBudget.budgetMs;
    expect(rules({ bounds: noBudget })).toContain("uia-read-unbounded");
    expect(rules({ readOnly: false })).toContain("uia-read-not-read-only");
    expect(rules({ keys: "Escape" })).toContain("uia-read-not-read-only");
    expect(
      rules({
        target: { pid: PID, path: ["File"], window: { className: CLS, titlePattern: "x" } },
      }),
    ).toContain("uia-read-not-read-only");
  });

  it("the plan shows an owned-window walk and a pinned handle, and the rule checks them", () => {
    const [plain] = buildActionPlan(TARGET, DEFAULT_BOUNDS, "raw");
    expect((plain.target as any).window).toEqual({
      className: CLS,
      titlePattern: "Resource Manager - .*",
      allowOwned: false,
    });
    const [dialog] = buildActionPlan(
      { ...TARGET, allowOwned: true, hwnd: 105 },
      DEFAULT_BOUNDS,
      "raw",
    );
    expect((dialog.target as any).window).toMatchObject({ allowOwned: true, hwnd: 105 });
    expect(checkUiaReadAction(dialog)).toEqual([]);
    const withWindow = (w: Record<string, unknown>) =>
      checkUiaReadAction({
        ...dialog,
        target: { pid: PID, window: { ...(dialog.target as any).window, ...w } },
      } as never).map((v) => v.detail);
    expect(withWindow({ allowOwned: "yes" })).toEqual([
      "target.window.allowOwned is not a boolean",
    ]);
    expect(withWindow({ hwnd: -1 })).toEqual(["target.window.hwnd is not a positive integer"]);
  });

  it("validateTarget wants pid, class and title pattern together", () => {
    expect(validateTarget(TARGET)).toBeNull();
    expect(validateTarget({ ...TARGET, pid: 0 })).toMatch(/pid/);
    expect(validateTarget({ ...TARGET, pid: 1.5 })).toMatch(/pid/);
    expect(validateTarget({ ...TARGET, className: " " })).toMatch(/class/);
    expect(validateTarget({ ...TARGET, titlePattern: "" })).toMatch(/title/);
    expect(validateTarget({ ...TARGET, titlePattern: "(" })).toMatch(/compile/);
  });

  it("walkerArgv passes the target and every bound, and --really only when asked", () => {
    const argv = walkerArgv({
      provider: "uia",
      target: TARGET,
      bounds: DEFAULT_BOUNDS,
      view: "raw",
    });
    expect(argv.slice(0, 2)).toEqual(["-B", WALKER_SCRIPT]);
    expect(argv).toContain("--title-pattern");
    for (const k of Object.keys(DEFAULT_BOUNDS) as Array<keyof WalkBounds>) {
      expect(argv).toContain(`--${boundSnake(k).replace(/_/g, "-")}`);
    }
    expect(argv).not.toContain("--really");
  });
});

// Attack strings for both redaction passes, assembled at run time so the test
// file itself carries no address, id or home path shape.
const OTHER_HOME = ["C:", "Users", "zzotheracct", "x"].join("\\");
const PLANTED_EMAIL = ["zz.someone", "@", "mailhost", ".", "org"].join("");
const DOC_EMAIL = ["doc", "@", "example", ".", "com"].join("");
const PLANTED_STEAM = `7656${"1".repeat(13)}`;
const ATTACK_STRINGS = [
  `C%3A%5CUsers%5C${PLANTED_USER}%5Cx`,
  `C%3A%2FUsers%2F${PLANTED_USER}%2Fx`,
  `addon ${PLANTED_USER}_mods`,
  `${PLANTED_USER}2`,
  `${PLANTED_HOME}_old\\x`,
  `${PLANTED_USER.toUpperCase()}PC`,
  `on ${PLANTED_HOST}-box`,
  OTHER_HOME,
  `mail ${PLANTED_EMAIL}`,
  `steam ${PLANTED_STEAM}`,
  DOC_EMAIL,
];

function assertAttackRedacted(text: string): void {
  const leaks = [PLANTED_USER, PLANTED_HOST, "zzotheracct", PLANTED_EMAIL, PLANTED_STEAM].filter(
    (s) => text.toLowerCase().includes(s.toLowerCase()),
  );
  expect(leaks).toEqual([]);
}

describe("second redaction pass", () => {
  it("catches what the first pass is meant to catch, on its own", () => {
    const ctx = { userProfile: PLANTED_HOME };
    const table = redactionTable(ctx, undefined, {
      USERNAME: PLANTED_USER,
      COMPUTERNAME: PLANTED_HOST,
    });
    const text = JSON.stringify({ names: ATTACK_STRINGS });
    const r = secondPass(text, ctx, table);
    expect(r.changed).toBe(true);
    expect(() => JSON.parse(r.text)).not.toThrow();
    assertAttackRedacted(r.text);
    expect(JSON.parse(r.text).names).toContain(DOC_EMAIL);
  });

  it("replaces roots in JSON-escaped form and the account and machine names", () => {
    const ctx = { userProfile: PLANTED_HOME, localAppData: `${PLANTED_HOME}\\AppData\\Local` };
    const table = redactionTable(ctx, `${PLANTED_HOME}\\Documents\\My Games\\addons`, {
      USERNAME: PLANTED_USER,
      COMPUTERNAME: PLANTED_HOST,
    });
    const text = JSON.stringify({
      a: `${SANDBOX}\\x.gproj`,
      b: `${PLANTED_USER} on ${PLANTED_HOST}`,
      c: "clean",
    });
    const r = secondPass(text, ctx, table);
    expect(r.changed).toBe(true);
    expect(r.text).not.toMatch(new RegExp(PLANTED_USER, "i"));
    expect(r.text).not.toMatch(new RegExp(PLANTED_HOST, "i"));
    expect(JSON.parse(r.text)).toEqual({
      a: "<addons>\\EMCP2_sandbox\\x.gproj",
      b: "<user> on <host>",
      c: "clean",
    });
    expect(secondPass(JSON.stringify({ c: "clean" }), ctx, table).changed).toBe(false);
  });
});

// ── The Python walker on the fake provider ───────────────────────────────────

describe.skipIf(!HAS_PYTHON)("walker.py on a fake tree", () => {
  it("mirrors the bounds defaults and caps of walk.ts", () => {
    const r = runPy(["--print-defaults"]);
    expect(r.status).toBe(0);
    const snake = (b: WalkBounds) =>
      Object.fromEntries(
        (Object.keys(b) as Array<keyof WalkBounds>).map((k) => [boundSnake(k), b[k]]),
      );
    expect(r.doc).toEqual({ defaults: snake(DEFAULT_BOUNDS), caps: snake(BOUND_CAPS) });
  });

  it("chooses the one window that matches pid, class and title, and refuses the others", () => {
    const r = walkFake(windowList());
    expect(r.status).toBe(0);
    const t = r.doc!.target;
    expect(t.hwnd).toBe(101);
    const reasons = Object.fromEntries(t.selection.refused.map((x: any) => [x.hwnd, x.reason]));
    expect(reasons).toEqual({
      102: "title does not match the pattern",
      103: "window class differs",
      104: "other process",
      105: "owned window (a dialog or popup)",
    });
    // A window of another process is reported by handle only: its class and title are not read.
    expect(t.selection.refused.find((x: any) => x.hwnd === 104)).toEqual({
      hwnd: 104,
      reason: "other process",
    });
  });

  it("refuses when two Workbench-like windows match", () => {
    const r = walkFake(windowList(), [], ".*");
    expect(r.status).toBe(3);
    expect(r.doc!.refused).toBe(true);
    expect(r.doc!.reason).toMatch(/2 windows match/);
    expect(r.doc!.tree).toBeUndefined();
  });

  it("refuses a launcher-only process, a hung window and an attached element that is not the window", () => {
    const launcher = runPy([
      "--provider",
      "fake",
      "--fake-tree",
      writeTree(windowList()),
      "--pid",
      String(PID),
      "--class",
      "TestLauncherClass",
      "--title-pattern",
      "Resource Manager.*",
    ]);
    expect(launcher.status).toBe(3);
    expect(launcher.doc!.reason).toMatch(/no top-level window/);

    const hung = walkFake(windowList({ 101: { hung: true } }));
    expect(hung.status).toBe(3);
    expect(hung.doc!.reason).toMatch(/not responding/);

    const other = walkFake(windowList({ 101: { identity: { pid: 9001 } } }));
    expect(other.status).toBe(3);
    expect(other.doc!.reason).toMatch(/not the chosen window \(pid differ\)/);
  });

  it("refuses to run without pid, class or title pattern", () => {
    const tree = writeTree(windowList());
    expect(
      runPy([
        "--provider",
        "fake",
        "--fake-tree",
        tree,
        "--pid",
        String(PID),
        "--title-pattern",
        ".*",
      ]).status,
    ).toBe(2);
    expect(
      runPy(["--provider", "fake", "--fake-tree", tree, "--pid", String(PID), "--class", CLS])
        .status,
    ).toBe(2);
    expect(
      runPy(["--provider", "fake", "--fake-tree", tree, "--class", CLS, "--title-pattern", ".*"])
        .status,
    ).toBe(2);
    expect(
      runPy([
        "--provider",
        "fake",
        "--fake-tree",
        tree,
        "--pid",
        "0",
        "--class",
        CLS,
        "--title-pattern",
        ".*",
      ]).status,
    ).toBe(2);
  });

  it("walks the tree with counts per control type, ids and names", () => {
    const r = walkFake(windowList());
    const d = r.doc!;
    expect(d.completed).toBe(true);
    expect(d.stop_reason).toBeNull();
    expect(d.counts.by_control_type).toEqual({
      Button: 2,
      DataItem: 40,
      List: 1,
      ListItem: 40,
      MenuBar: 1,
      MenuItem: 3,
      Pane: 1,
      Table: 1,
      ToolBar: 1,
      Tree: 1,
      TreeItem: 123,
      Window: 1,
    });
    expect(d.counts.nodes).toBe(215);
    expect(d.counts.with_automation_id).toBe(4);
    expect(d.counts.with_name).toBe(214);
    expect(d.patterns).toMatchObject({
      ExpandCollapse: 3,
      Invoke: 2,
      Grid: 1,
      Table: 1,
      Window: 1,
    });
    expect(d.tree.rect).toEqual([0, 0, 1920, 1080]);
    expect(d.u7).toMatchObject({
      framework_ids: { Qt: 1 },
      menu_bars: 1,
      menu_items_under_menu_bar: 3,
      menu_item_names: ["File", "Edit", "Window"],
      tool_bars: 1,
      toolbar_buttons: 2,
      with_accelerator_key: 1,
      with_help_text: 1,
    });
    expect(d.u7.automation_ids).toMatchObject({ non_empty: 4, dotted: 2 });
    expect(typeof d.elapsed_ms).toBe("number");
    expect(typeof d.attach_ms).toBe("number");
    expect(d.uia_calls.count).toBeGreaterThan(0);
  });

  it("samples data containers and records the real or the lower-bound child count", () => {
    const d = walkFake(windowList()).doc!;
    const byName = (n: string) => findNodes(d.tree, (x) => x.name === n)[0];
    const list = byName("files");
    expect(list.children).toHaveLength(40);
    expect(list.childCountAtLeast).toBe(2000);
    expect(list.sampled).toEqual({ kept: 40, rule: "data-container" });
    const table = byName("properties");
    expect(table.children).toHaveLength(40);
    expect(table.childCount).toBe(500);
    expect(table.gridRowCount).toBe(500);
    expect(byName("layer 0").childCount).toBe(100);
    expect(d.sampling.containers_sampled).toBe(5);
    const listEntry = d.sampling.applied.find((e: any) => e.controlType === "List");
    expect(listEntry).toMatchObject({ kept: 40, childCountAtLeast: 2000, countStopped: "cap" });
    // The 30,000-row list cost at most count_cap navigations, never 30,000.
    expect(d.provider_info.calls.next_sibling_bare).toBeLessThan(2000 + 500 + 300);
    expect(d.provider_info.calls.read).toBe(215);

    const exact = walkFake(windowList(), ["--count-cap", "50000"]).doc!;
    expect(findNodes(exact.tree, (x) => x.name === "files")[0].childCount).toBe(30000);
    const wide = walkFake(windowList(), ["--row-sample", "5"]).doc!;
    expect(findNodes(wide.tree, (x) => x.name === "files")[0].children).toHaveLength(5);
  });

  it("stops at the node limit and marks what it did not read", () => {
    const d = walkFake(windowList(), ["--max-nodes", "50"]).doc!;
    expect(d.counts.nodes).toBe(50);
    expect(d.completed).toBe(false);
    expect(d.stop_reason).toBe("max-nodes");
    expect(findNodes(d.tree, (x) => x.truncated === "max-nodes").length).toBeGreaterThan(0);
  });

  it("stops at the depth limit", () => {
    const data = windowList({ 101: { tree: { ...chain(6), className: CLS } } });
    const d = walkFake(data, ["--max-depth", "2"]).doc!;
    expect(d.counts.max_depth_seen).toBe(2);
    expect(d.counts.depth_truncated).toBe(1);
    expect(d.completed).toBe(true);
    expect(findNodes(d.tree, (x) => x.truncated === "depth")).toHaveLength(1);
  });

  it("stops at the wall-clock budget", () => {
    const slow = {
      controlType: "Window",
      name: "slow",
      children: Array.from({ length: 60 }, (_, i) => ({
        controlType: "Button",
        name: `b${i}`,
        delayMs: 20,
      })),
    };
    const d = walkFake(windowList({ 101: { tree: slow } }), ["--budget-ms", "300"]).doc!;
    expect(d.stop_reason).toBe("budget");
    expect(d.counts.nodes).toBeLessThan(61);
    expect(d.walk_ms).toBeLessThan(300 + 500);
    expect(d.uia_calls.slow_calls).toBe(0);
  });

  const buttons = (n: number, error: (i: number) => string | undefined): Node => ({
    controlType: "Window",
    name: "w",
    children: Array.from({ length: n }, (_, i) => ({
      controlType: "Button",
      name: `b${i}`,
      ...(error(i) ? { error: error(i) } : {}),
    })),
  });

  it("stops at the first timed-out call and makes no further call (plan 5.3: no retry)", () => {
    const d = walkFake(windowList({ 101: { tree: buttons(10, () => "timeout") } })).doc!;
    expect(d.stop_reason).toBe("timeout");
    expect(d.completed).toBe(false);
    expect(d.partial).toBe(true);
    expect(d.uia_calls.timeouts).toBe(1);
    expect(d.counts.read_errors).toBe(1);
    // root read, root first_child, the failed read: nothing after the stop.
    expect(d.provider_info.calls.read).toBe(2);
    expect(d.provider_info.calls.first_child).toBe(1);
    expect(d.provider_info.calls.next_sibling).toBeUndefined();
    expect(d.tree.truncated).toBe("timeout");
    expect(d.tree.childCountAtLeast).toBe(1);
  });

  it("stops on a timeout that is not consecutive (every other read times out)", () => {
    const d = walkFake(
      windowList({ 101: { tree: buttons(200, (i) => (i % 2 === 1 ? "timeout" : undefined)) } }),
    ).doc!;
    expect(d.stop_reason).toBe("timeout");
    expect(d.uia_calls.timeouts).toBe(1);
    expect(d.counts.nodes).toBe(3);
    expect(d.completed).toBe(false);
  });

  it("stops after consecutive failed calls of other kinds, and not on scattered ones", () => {
    const stuck = walkFake(windowList({ 101: { tree: buttons(10, () => "unavailable") } })).doc!;
    expect(stuck.stop_reason).toBe("unresponsive");
    expect(stuck.uia_calls.timeouts).toBe(0);
    expect(stuck.uia_calls.error_kinds).toEqual({ "element-not-available": 3 });
    expect(stuck.counts.read_errors).toBe(3);
    // Two sibling steps between the three failed reads, none after the stop.
    expect(stuck.provider_info.calls.next_sibling).toBe(2);

    const scattered = walkFake(
      windowList({
        101: { tree: buttons(20, (i) => (i % 3 === 0 ? "unavailable" : undefined)) },
      }),
    ).doc!;
    expect(scattered.stop_reason).toBeNull();
    expect(scattered.counts.read_errors).toBe(7);
    expect(scattered.completed).toBe(false);
    expect(scattered.partial).toBe(true);
  });

  it("a child list that cannot be read makes the walk partial, not completed", () => {
    const tree = { controlType: "Window", name: "w", childError: "unavailable", children: [] };
    const d = walkFake(windowList({ 101: { tree } })).doc!;
    expect(d.stop_reason).toBeNull();
    expect(d.completed).toBe(false);
    expect(d.partial).toBe(true);
    expect(d.counts.child_errors).toBe(1);
    expect(d.counts.nodes).toBe(1);
    expect(d.tree.childError).toBe("element-not-available");

    const timedOut = walkFake(
      windowList({ 101: { tree: { ...tree, childError: "timeout" } } }),
    ).doc!;
    expect(timedOut.stop_reason).toBe("timeout");
    expect(timedOut.completed).toBe(false);
    expect(timedOut.partial).toBe(true);
  });

  it("samples IsHungAppWindow during the walk and stops when the window is hung", () => {
    const ok = walkFake(windowList()).doc!;
    expect(ok.hung.samples).toBeGreaterThan(1);
    expect(ok.hung.true).toBe(0);

    const hung = walkFake(windowList({ 101: { hungAfterReads: 30 } })).doc!;
    expect(hung.stop_reason).toBe("hung");
    expect(hung.completed).toBe(false);
    expect(hung.hung.true).toBeGreaterThan(0);
    expect(hung.counts.nodes).toBeLessThan(30 + 25 + 1);
  });

  it("checks identity on pid and window handle; the UIA ClassName may differ from the Win32 class", () => {
    const d = walkFake(windowList({ 101: { uiaClassName: "QMainWindow" } })).doc!;
    expect(d.refused).toBeUndefined();
    expect(d.target.className).toBe(CLS);
    expect(d.target.uiaClassName).toBe("QMainWindow");
    expect(d.completed).toBe(true);

    const otherHandle = walkFake(windowList({ 101: { identity: { hwnd: 999 } } }));
    expect(otherHandle.status).toBe(3);
    expect(otherHandle.doc!.reason).toMatch(/not the chosen window \(hwnd differ\)/);
  });

  it("exits 4 when the provider cannot set its client timeouts", () => {
    const r = walkFake(windowList({ 101: { attachUnavailable: "timeouts not set" } }));
    expect(r.status).toBe(4);
    expect(r.doc!.refused).toBe(true);
    expect(r.doc!.reason).toMatch(/^provider unavailable/);
    expect(r.doc!.tree).toBeUndefined();
  });

  it("redacts every string and reports how many were redacted", () => {
    const r = walkFake(windowList());
    expect(r.stdout).not.toMatch(new RegExp(PLANTED_USER, "i"));
    expect(r.stdout).not.toMatch(new RegExp(PLANTED_HOST, "i"));
    const d = r.doc!;
    expect(d.target.title).toBe(
      "Resource Manager - %USERPROFILE%\\Documents\\My Games\\addons\\EMCP2_sandbox",
    );
    expect(findNodes(d.tree, (x) => x.name === "Signed in as <user>")).toHaveLength(1);
    expect(d.redaction.strings_redacted).toBe(3);
    expect(d.redaction.placeholders_used).toEqual(["%USERPROFILE%", "<user>"]);

    // A table from walk.ts names more specific roots; the longest match wins.
    const table = { paths: [[SANDBOX, "<sandbox>"]], tokens: [] };
    const withTable = runPy(
      [
        "--provider",
        "fake",
        "--fake-tree",
        writeTree(windowList()),
        "--pid",
        String(PID),
        "--class",
        CLS,
        "--title-pattern",
        "Resource Manager - .*",
      ],
      { ENFUSION_UIA_REDACT: JSON.stringify(table) },
    ).doc!;
    expect(withTable.tree.name).toBe("Resource Manager - <sandbox>");
  });

  it("redacts the account glued to other text, URL-encoded paths and generic shapes", () => {
    const names = ATTACK_STRINGS.map((s) => ({ controlType: "Text", name: s }));
    const tree = { controlType: "Window", name: "attack", children: names };
    const r = runPy(
      [
        "--provider",
        "fake",
        "--fake-tree",
        writeTree(windowList({ 101: { tree } })),
        "--pid",
        String(PID),
        "--class",
        CLS,
        "--title-pattern",
        "Resource Manager - .*",
      ],
      {
        ENFUSION_UIA_REDACT: JSON.stringify({ paths: [], tokens: [] }),
      },
    );
    expect(r.status).toBe(0);
    assertAttackRedacted(r.stdout);
    const out = r.doc!.tree.children.map((c: any) => c.name);
    expect(out).toContain(DOC_EMAIL);
    expect(r.doc!.redaction.placeholders_used).toEqual(
      expect.arrayContaining(["<user>", "<host>", "<email>", "<steam-id>", "<home-path>"]),
    );
  });

  it("lists only the given pid's windows", () => {
    const r = runPy([
      "--provider",
      "fake",
      "--fake-tree",
      writeTree(windowList()),
      "--pid",
      String(PID),
      "--list-windows",
    ]);
    expect(r.status).toBe(0);
    expect(r.doc!.windows.map((w: any) => w.hwnd)).toEqual([101, 102, 103, 105]);
    expect(r.stdout).not.toMatch(new RegExp(PLANTED_USER, "i"));
  });

  it("the real provider refuses without --really, before importing UI Automation", () => {
    const r = runPy(["--provider", "uia", "--pid", "1", "--class", "X", "--title-pattern", "Y"]);
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/needs --really|Windows-only/);
    expect(r.stdout).toBe("");
  });

  it("writes no bytecode next to the sources", () => {
    expect(existsSync(join(UIA_DIR, "__pycache__"))).toBe(false);
  });
});

// ── The wrapper end to end on the fake provider ──────────────────────────────

describe.skipIf(!HAS_PYTHON)("walk.ts", () => {
  it("runs the fake walk, redacts twice and writes the artifact outside the tree", async () => {
    const out = join(dir, "walk-out.json");
    const ctx = { userProfile: PLANTED_HOME };
    const table = redactionTable(ctx, undefined, {
      USERNAME: PLANTED_USER,
      COMPUTERNAME: PLANTED_HOST,
    });
    const r = await runWalk({
      argv: walkerArgv({
        provider: "fake",
        fakeTree: writeTree(windowList()),
        target: TARGET,
        bounds: DEFAULT_BOUNDS,
        view: "raw",
      }),
      env: { ...PLANTED_ENV, ENFUSION_UIA_REDACT: JSON.stringify(table) },
      timeoutMs: 60_000,
      outPath: out,
      ctx,
      table,
      python: PY,
    });
    expect(r.summary).toMatchObject({
      exit_code: 0,
      refused: false,
      nodes: 215,
      completed: true,
      partial: false,
      errors: 0,
      child_errors: 0,
      client_timeouts_set: null,
      hung_true: 0,
      post_pass_changed: false,
    });
    expect(r.summary.hung_samples).toBeGreaterThan(0);
    expect(r.summary.sha256).toMatch(/^[0-9a-f]{64}$/);
    const text = readFileSync(out, "utf-8");
    expect(text).not.toMatch(new RegExp(PLANTED_USER, "i"));
    expect(JSON.parse(text).redaction.post_pass_changed).toBe(false);
  });

  it("kills a walker that does not finish and writes nothing", async () => {
    const out = join(dir, "hung-out.json");
    const t0 = Date.now();
    const r = await runWalk({
      argv: ["-B", "-c", "import time; time.sleep(60)"],
      env: {},
      timeoutMs: 1500,
      outPath: out,
      ctx: {},
      table: { paths: [], tokens: [] },
      python: PY,
    });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.summary.reason).toBe("walker timed out and was killed");
    expect(r.text).toBeNull();
    expect(existsSync(out)).toBe(false);
  });

  it("heartbeats the lease before, during and after the walk, and kills the walker when it fails", async () => {
    const sleepThenPrint = [
      "-B",
      "-c",
      'import time; time.sleep(0.8); print(\'{"schema": "x", "completed": true}\')',
    ];
    let beats = 0;
    const ok = await runWalk({
      argv: sleepThenPrint,
      env: {},
      timeoutMs: 20_000,
      outPath: join(dir, "beat-out.json"),
      ctx: {},
      table: { paths: [], tokens: [] },
      python: PY,
      heartbeat: () => void beats++,
      heartbeatMs: 100,
    });
    expect(ok.summary.completed).toBe(true);
    expect(beats).toBeGreaterThanOrEqual(4);

    let calls = 0;
    const lost = await runWalk({
      argv: ["-B", "-c", "import time; time.sleep(60)"],
      env: {},
      timeoutMs: 30_000,
      outPath: join(dir, "lost-out.json"),
      ctx: {},
      table: { paths: [], tokens: [] },
      python: PY,
      heartbeat: () => {
        if (++calls > 1) throw new Error("LEASE_NOT_OWNER");
      },
      heartbeatMs: 100,
    });
    expect(lost.summary.reason).toMatch(/^lease heartbeat failed, walker killed: LEASE_NOT_OWNER/);
    expect(lost.text).toBeNull();

    await expect(
      runWalk({
        argv: sleepThenPrint,
        env: {},
        timeoutMs: 20_000,
        outPath: join(dir, "never-out.json"),
        ctx: {},
        table: { paths: [], tokens: [] },
        python: PY,
        heartbeat: () => {
          throw new Error("LEASE_NOT_OWNER");
        },
      }),
    ).rejects.toThrow(/LEASE_NOT_OWNER/);
    expect(existsSync(join(dir, "never-out.json"))).toBe(false);
  });

  it("refuses to write inside a git working tree", async () => {
    await expect(
      runWalk({
        argv: ["-B", WALKER_SCRIPT, "--print-defaults"],
        env: {},
        timeoutMs: 10_000,
        outPath: join(REPO_ROOT, "uia-walk.json"),
        ctx: {},
        table: { paths: [], tokens: [] },
        python: PY,
      }),
    ).rejects.toThrow(/inside a git working tree/);
  });

  it("main prints the plan and its verdict first, and the summary as its last line", async () => {
    const lines: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((m: unknown) => void lines.push(String(m)));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const code = await main([
        "--fake-tree",
        writeTree(windowList()),
        "--pid",
        String(PID),
        "--class",
        CLS,
        "--title-pattern",
        "Resource Manager - .*",
        "--out",
        join(dir, "main-out.json"),
      ]);
      expect(code).toBe(0);
    } finally {
      log.mockRestore();
      err.mockRestore();
      vi.unstubAllEnvs();
    }
    expect(lines[0]).toMatch(
      /^ACTION PLAN \(scripts\/live\/dry-run\.ts format\): \[\{"kind":"uia-read"/,
    );
    expect(lines[0]).toMatch(/"allowOwned":false/);
    expect(lines[1]).toBe("dry-run check: PASS");
    const summary = JSON.parse(lines[lines.length - 1]);
    expect(summary).toMatchObject({
      exit_code: 0,
      nodes: 215,
      completed: true,
      partial: false,
      errors: 0,
      child_errors: 0,
    });
    const written = JSON.parse(readFileSync(join(dir, "main-out.json"), "utf-8"));
    expect(written.redaction).not.toHaveProperty("owner_patterns");
  });

  it("main without --really is a dry run that names the command and starts nothing", async () => {
    const lines: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((m: unknown) => void lines.push(String(m)));
    try {
      const code = await main([
        "--pid",
        String(PID),
        "--class",
        CLS,
        "--title-pattern",
        "Resource Manager - .*",
      ]);
      expect(code).toBe(0);
    } finally {
      log.mockRestore();
    }
    const last = lines[lines.length - 1];
    expect(last).toMatch(/^dry run/);
    expect(last).toMatch(/walker\.py --provider uia/);
  });
});

// ── Source scan: no mutating UI Automation call in tools/uia ─────────────────

/** Python source with comments and string literals removed. */
function pythonCode(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const three = src.slice(i, i + 3);
    if (three === '"""' || three === "'''") {
      const end = src.indexOf(three, i + 3);
      i = end === -1 ? src.length : end + 3;
      out += '""';
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      out += '""';
    } else if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** TypeScript source with comments and string text removed (template expressions kept). */
function tsCode(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      out += '""';
    } else if (c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") j += 2;
        else if (src.slice(j, j + 2) === "${") {
          let depth = 1;
          j += 2;
          const start = j;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          out += ` ${src.slice(start, j - 1)} `;
        } else j++;
      }
      i = j + 1;
      out += '""';
    } else if (c === "/" && /[=(,:;!&|?{}[\n]\s*$/.test(out)) {
      // a regular expression literal
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "[") {
          inClass = true;
          j++;
        } else if (src[j] === "]") {
          inClass = false;
          j++;
        } else if (src[j] === "/" && !inClass) break;
        else j++;
      }
      i = j + 1;
      out += "/x/";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const FORBIDDEN_ANYWHERE = [
  "GetCurrentPattern",
  "GetCachedPattern",
  "GetCurrentPatternAs",
  "GetCachedPatternAs",
  "SendKeys",
  "SendInput",
  "keybd_event",
  "mouse_event",
  "SetCursorPos",
  "PostMessage",
  "PostMessageW",
  "SendMessage",
  "SendMessageW",
  "SendMessageTimeoutW",
  "SetForegroundWindow",
  "BringWindowToTop",
  "ShowWindow",
  "SetWindowPos",
  "SetActiveWindow",
  "SetFocus",
  "DoDefaultAction",
  "ScrollIntoView",
  "SetScrollPercent",
  "AddToSelection",
  "RemoveFromSelection",
  "SetValue",
  "uiautomation",
  "pywinauto",
  "pyautogui",
];
const FORBIDDEN_CALLS = [
  "Invoke",
  "Expand",
  "Collapse",
  "Toggle",
  "Select",
  "Scroll",
  "Click",
  "click",
  "DoubleClick",
  "RightClick",
  "Close",
  "Move",
  "Resize",
  "Rotate",
  "Zoom",
  "Realize",
  "SetWindowVisualState",
  "WaitForInputIdle",
];
const ANYWHERE_RE = new RegExp(`\\b(${FORBIDDEN_ANYWHERE.join("|")})\\b`);
const CALL_RE = new RegExp(`(?:^|[^\\w])(${FORBIDDEN_CALLS.join("|")})\\s*\\(`);

function scan(code: string): string[] {
  const hits: string[] = [];
  code.split("\n").forEach((line, n) => {
    const a = ANYWHERE_RE.exec(line);
    if (a) hits.push(`${n + 1}: ${a[1]}`);
    const c = CALL_RE.exec(line);
    if (c) hits.push(`${n + 1}: ${c[1]}(`);
  });
  return hits;
}

describe("tools/uia source scan", () => {
  const files = readdirSync(UIA_DIR).filter((f) => f.endsWith(".py") || f.endsWith(".ts"));

  it("covers the walker, both providers and the wrapper", () => {
    expect(files.sort()).toEqual([
      "context.py",
      "context.ts",
      "fake_provider.py",
      "menus.py",
      "menus.ts",
      "uia_com.py",
      "walk.ts",
      "walker.py",
    ]);
  });

  // Owner ruling Q4 of the S-F design (main's ruling on this test): the active menu tool
  // tools/uia/menus.py may expand and collapse menus only, never invoke, with the Workbench not
  // in front. Its only scan hits may be the ExpandCollapse calls and the one pattern fetch that
  // yields that pattern object; every other file keeps the strict scan.
  const PER_FILE_ALLOW: Record<string, ReadonlySet<string>> = {
    "menus.py": new Set(["Expand(", "Collapse(", "GetCurrentPatternAs"]),
    // Phase 4 L05 (design D11 `uia-context`): the context-menu kernel may call ShowContextMenu on
    // ONE target and Collapse on the popup it opened; nothing else (P4-FIX-B hand-off, 2026-10-10).
    "context.py": new Set(["ShowContextMenu(", "Collapse(", "GetCurrentPatternAs"]),
  };
  const hitName = (h: string) => h.replace(/^\d+: /, "");

  it("finds no mutating UI Automation, window or input call", () => {
    for (const f of files) {
      const src = readFileSync(join(UIA_DIR, f), "utf-8");
      const code = f.endsWith(".py") ? pythonCode(src) : tsCode(src);
      const allow = PER_FILE_ALLOW[f] ?? new Set<string>();
      const hits = scan(code).filter((h) => !allow.has(hitName(h)));
      expect({ file: f, hits }).toEqual({ file: f, hits: [] });
    }
  });

  it("menus.py: its scan hits are a subset of the allow-list, with no invoke, input or window call", () => {
    const code = pythonCode(readFileSync(join(UIA_DIR, "menus.py"), "utf-8"));
    const names = scan(code).map(hitName);
    for (const n of names) expect(PER_FILE_ALLOW["menus.py"].has(n)).toBe(true);
    expect(names).toContain("Expand(");
    expect(names).toContain("Collapse(");
    const banned =
      /\b(Invoke|SetValue|Toggle|Select|SetFocus|SendInput|keybd_event|mouse_event|SetCursorPos|SetForegroundWindow|BringWindowToTop|ShowWindow|SetWindowPos|PostMessageW?|SendMessageW?|DoDefaultAction)\b|\b[Cc]lick\s*\(/;
    for (const line of code.split("\n")) expect(banned.test(line) ? line : null).toBeNull();
  });

  it("the real provider calls only these Get and Set functions", () => {
    const code = pythonCode(readFileSync(join(UIA_DIR, "uia_com.py"), "utf-8"));
    const used = new Set(code.match(/\b(?:Get|Set)[A-Z]\w*/g) ?? []);
    expect([...used].sort()).toEqual([
      "GetCachedPropertyValue",
      "GetClassNameW",
      "GetFirstChildElementBuildCache",
      // comtypes.client.GetModule: only under `--check-wrapper --regenerate` (DEC-057, DEC-082);
      // it generates the UIAutomationCore wrapper and touches no window.
      "GetModule",
      "GetNextSiblingElement",
      "GetNextSiblingElementBuildCache",
      "GetWindow",
      "GetWindowTextW",
      "GetWindowThreadProcessId",
      "SetProcessDpiAwarenessContext",
    ]);
  });

  it("the real provider creates CUIAutomation8 as IUIAutomation2 and only ever switches AutoSetFocus off", () => {
    const code = pythonCode(readFileSync(join(UIA_DIR, "uia_com.py"), "utf-8"));
    expect(code).toMatch(/CreateObject\(_UIA\.CUIAutomation8, interface=_UIA\.IUIAutomation2\)/);
    expect(code).not.toMatch(/_UIA\.CUIAutomation\b(?!8)/);
    expect(code).not.toMatch(/QueryInterface/);
    expect(code.match(/AutoSetFocus\s*=\s*\w+/g)).toEqual(["AutoSetFocus = False"]);
  });

  it.skipIf(!HAS_PYTHON)(
    "the real provider refuses when its client timeouts cannot be set (comtypes stubbed: no automation object)",
    () => {
      // CreateObject is replaced before attach() runs, so no UI Automation
      // object is created; the stub records what it was asked for.
      const script = [
        "import sys, json",
        `sys.path.insert(0, ${JSON.stringify(UIA_DIR)})`,
        "import comtypes.client, uia_com",
        "asked = []",
        "class Rejects:",
        "    def __setattr__(self, k, v): raise OSError('not supported')",
        "class Ignores:",
        "    ConnectionTimeout = 20000",
        "    TransactionTimeout = 20000",
        "    def __setattr__(self, k, v): pass",
        "def make(stub):",
        "    def create(cls, interface=None):",
        "        asked.append([cls.__name__, interface.__name__])",
        "        return stub()",
        "    return create",
        "out = []",
        "for stub in (Rejects, Ignores):",
        "    comtypes.client.CreateObject = make(stub)",
        "    p = uia_com.ComUiaProvider(('Invoke',), call_timeout_ms=1500)",
        "    try:",
        "        p.attach({'hwnd': 0})",
        "        out.append('attached')",
        "    except uia_com.ProviderUnavailable as e:",
        "        out.append([e.provider_unavailable, p.timeouts_set])",
        "print(json.dumps({'asked': asked, 'out': out}))",
      ].join("\n");
      const r = spawnSync(PY, ["-B", "-c", script], { encoding: "utf-8", timeout: 60_000 });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!)).toEqual({
        asked: [
          ["CUIAutomation8", "IUIAutomation2"],
          ["CUIAutomation8", "IUIAutomation2"],
        ],
        out: [
          [true, false],
          [true, false],
        ],
      });
    },
  );

  it("the scan is not vacuous: it flags planted calls and ignores words in comments and strings", () => {
    const planted = [
      ["el.In", "voke()"].join(""),
      ["pat.Ex", "pand()"].join(""),
      ["auto.Send", "Keys('x')"].join(""),
      ["el.Get", "CurrentPattern(1)"].join(""),
      ["w.Set", "Focus()"].join(""),
      ["btn.cl", "ick()"].join(""),
    ];
    for (const p of planted) expect(scan(pythonCode(p))).not.toEqual([]);
    expect(scan(pythonCode(["# el.In", "voke()"].join("")))).toEqual([]);
    expect(scan(pythonCode(['x = "el.In', 'voke()"'].join("")))).toEqual([]);
    expect(scan(tsCode(["// el.In", "voke()"].join("")))).toEqual([]);
    expect(scan(tsCode(["const s = `${a.In", "voke()}`;"].join("")))).not.toEqual([]);
  });
});
