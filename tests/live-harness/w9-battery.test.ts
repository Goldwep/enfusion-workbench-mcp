import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { isAllowListed, loadAllowListFile } from "../../src/tools/wb-menu.js";
import {
  BATTERY_SNAPSHOT_FILE,
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  EXIT,
  GATE_STEP,
  LAUNCH_ARGS,
  MODULES,
  NETZERO_STEP,
  PLANT_DIRS,
  PLANT_FILE,
  ROUTE_FALSE_PROBE,
  SCRATCH_INI,
  SHOW_PAIRS,
  SCRIPT_PATH,
  VIEW_HELD,
  VIEW_ROWS,
  VIEW_SE_STEP,
  VIEW_UNREAD_STEP,
  VIEW_WE_STEP,
  W9_ROOT,
  WORLD,
  buildActionPlan,
  buildQueue,
  buildSteps,
  classifyToggles,
  dockStateOf,
  dryRunCheck,
  isCandidatePath,
  liveFileOf,
  loadToggleRows,
  main,
  moduleStepId,
  moduleTally,
  planToggleLines,
  recordPath,
  runBattery,
  runPlant,
  runRollback,
  selectSteps,
  w9PlanViolations,
  type OfflineIo,
  type ToggleRow,
  type ToolResponse,
  type W9Deps,
  type W9Options,
  type W9Tool,
} from "../live/w9.live.js";

type Raw = Record<string, unknown>;

const TMP = mkdtempSync(join(tmpdir(), "emcp-w9-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 4949;
const norm = (p: string): string => p.replace(/\\/g, "/");

/** A synthetic toggle row of the Script Editor whose dock is read by its title. */
function row(id: string, label: string, module: ToggleRow["module"] = "ScriptEditor"): ToggleRow {
  return {
    id,
    module,
    path: `Window > ${label}`,
    segments: ["Window", label],
    route: module === "WorldEditor" ? "wb_menu.run" : "wb_module.action",
    read: {
      rowId: `dock:${label}`,
      kind: "dock",
      objectName: `${label.replace(/\s/g, "")}Dock`,
      title: label,
      automationId: null,
      inferred: false,
    },
    notRead: null,
  };
}

interface Sim {
  /** Open state per dock title. */
  open: Map<string, boolean>;
  /** Titles whose run never changes the dock. */
  noFlip?: Set<string>;
  /** Titles whose SECOND run does not change the dock (the third does). */
  stuckOnce?: Set<string>;
  /** The run answers false and changes nothing. */
  dead?: Set<string>;
  /** Titles whose FIRST run changes nothing (the item's checked state out of step with the dock). */
  absorbFirst?: Set<string>;
  /** Titles cycling three states, two of them open (open A, open B, closed). */
  threeState?: Set<string>;
  /** Titles whose runs after the first never change the dock. */
  stuckAfterFirst?: Set<string>;
  /** Per title, the run numbers (1-based, counted per title) that change nothing (a swallowed run). */
  swallow?: Map<string, Set<number>>;
  /** Titles whose run lands only after this many reads of the dock (a late show or hide). */
  lag?: Map<string, number>;
  /** A tool call answered with this failure. */
  fail?: (name: W9Tool, args: Raw) => ToolResponse | null;
}

type DockStateLike = { open: boolean };

function simTool(sim: Sim): (name: W9Tool, args: Raw) => ToolResponse {
  const runs = new Map<string, number>();
  const pending = new Map<string, number[]>();
  const cycle = new Map<string, number>();
  const flip = (t: string): void => {
    if (sim.threeState?.has(t)) {
      const c = ((cycle.get(t) ?? 0) + 1) % 3;
      cycle.set(t, c);
      sim.open.set(t, c !== 2);
    } else sim.open.set(t, !(sim.open.get(t) === true));
  };
  return (name, args) => {
    const f = sim.fail?.(name, args);
    if (f) return f;
    if (name === "wb_gui") {
      const q = String(args.query);
      const p = (pending.get(q) ?? []).map((n) => n - 1);
      for (const n of p) if (n <= 0) flip(q);
      pending.set(
        q,
        p.filter((n) => n > 0),
      );
      const open = sim.open.get(q) === true;
      return {
        ok: true,
        readback: {
          hits: open
            ? [
                {
                  path: "0/1/2",
                  names: ["Script Editor", q],
                  node: {
                    controlType: "Window",
                    name: q,
                    automationId: `MainWindow.${q.replace(/\s/g, "")}Dock`,
                    offscreen: false,
                  },
                },
              ]
            : [],
        },
      };
    }
    if (
      (name === "wb_module" && args.action === "action") ||
      (name === "wb_menu" && args.action === "run")
    ) {
      const segs = name === "wb_menu" ? String(args.path).split(",") : (args.menuPath as string[]);
      const t = segs[segs.length - 1]!;
      const n = (runs.get(t) ?? 0) + 1;
      runs.set(t, n);
      if (sim.dead?.has(t))
        return { ok: true, readback: name === "wb_menu" ? { ran: false } : { result: false } };
      const flips =
        !sim.noFlip?.has(t) &&
        !(sim.stuckOnce?.has(t) && n === 2) &&
        !(sim.absorbFirst?.has(t) && n === 1) &&
        !(sim.stuckAfterFirst?.has(t) && n > 1) &&
        !sim.swallow?.get(t)?.has(n);
      const lag = sim.lag?.get(t);
      if (flips && lag) pending.set(t, [...(pending.get(t) ?? []), lag]);
      else if (flips) flip(t);
      return { ok: true, readback: name === "wb_menu" ? { ran: true } : { result: true } };
    }
    if (name === "wb_world" && args.action === "state")
      return { ok: true, readback: { mode: "edit", worldPath: WORLD } };
    return { ok: true, readback: {} };
  };
}

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W9Tool, args: Raw) => ToolResponse;
  rows?: ToggleRow[];
  commandLine?: string | null;
  windows?: WindowInfo[];
  /** The probe pack's info answer (default: ok on the sandbox). */
  probeInfo?: ToolResponse;
}): W9Deps & { files: Map<string, Buffer>; dirs: Set<string>; sent: Array<[string, Raw]> } {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const sent: Array<[string, Raw]> = [];
  return {
    files,
    dirs,
    sent,
    tool: async (name, args) => {
      sent.push([name, args]);
      if (name === "probe") {
        // DEC-100: the probe pack's candidate route, played on the same sim as the shipped routes
        if (args.action === "info")
          return over.probeInfo === undefined
            ? { ok: true, readback: { isSandbox: "true" } }
            : over.probeInfo;
        if (args.action === "executeAction" && over.tool) {
          const segs = args.menuPath as string[];
          const we = args.moduleName === "WorldEditor";
          const r = we
            ? over.tool("wb_menu", { action: "run", module: "WorldEditor", path: segs.join(",") })
            : over.tool("wb_module", { action: "action", module: args.moduleName, menuPath: segs });
          if (!r.ok) return r;
          const rbk = (r.readback ?? {}) as Raw;
          return { ok: true, readback: { result: we ? rbk.ran : rbk.result } };
        }
      }
      return over.tool ? over.tool(name, args) : { ok: true, readback: {} };
    },
    info: async () =>
      over.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : over.info,
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async () => over.windows ?? [],
    recordedPid: () => PID,
    commandLine: async () => (over.commandLine === undefined ? "" : over.commandLine),
    toggleRows: () => over.rows ?? [],
    readBytes: (p) => {
      const b = files.get(norm(p));
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    writeBytes: (p, b) => {
      files.set(norm(p), b);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    exists: (p) => files.has(norm(p)) || dirs.has(norm(p)),
    listTree: (dir) => {
      const d = norm(dir).replace(/\/$/, "") + "/";
      return [...files.keys()].filter((k) => k.startsWith(d)).map((k) => k.slice(d.length));
    },
    now: () => Date.now(),
    sleep: async () => undefined,
    log: () => undefined,
  };
}

function opts(name: string, extra: Partial<W9Options> = {}): W9Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W9Options["ph"],
    build: "test",
    ...extra,
  };
}

/** The gate's world: planted folders, a sandbox file, -forceSettings on the scratch ini. */
function gateReady(o: W9Options, deps: ReturnType<typeof fakeDeps>): void {
  for (const d of PLANT_DIRS) deps.dirs.add(norm(join(o.sandboxDir, ...d.split("/"))));
  deps.files.set(norm(join(o.sandboxDir, "addon.gproj")), Buffer.from("gproj"));
  deps.commandLine = async () =>
    `"ArmaReforgerWorkbenchSteamDiag.exe" -gproj x -forceSettings "${join(o.sittingDir, SCRATCH_INI)}" -scriptAuthorizeAll`;
}

function only(id: string) {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

function record(o: W9Options, step: string): Raw {
  return JSON.parse(readFileSync(recordPath(o.runDir, step), "utf-8")) as Raw;
}

const SE = moduleStepId("ScriptEditor");

// ── Offline: rows, plan, queue ───────────────────────────────────────────────

describe("W9 rows and plan", () => {
  const rows = loadToggleRows();

  it("covers the 113 safe-toggle rows: 63 driven, 50 NOT-READ (7 answered false by the menu-run route), none in the Localization Editor", () => {
    expect(rows).toHaveLength(113);
    const t = moduleTally(rows);
    const driven = Object.values(t).reduce((a, b) => a + b.driven, 0);
    expect(driven).toBe(63);
    expect(rows.filter((r) => !r.read)).toHaveLength(50);
    // DEC-097: the Anim Editor Go to pairs answered false (P-W9-01) and left the run set
    expect(rows.filter((r) => r.hideWith)).toEqual([]);
    const fell = rows.filter((r) => r.routeFalse);
    expect(fell.map((r) => r.path).sort()).toEqual(
      [
        "Anim Sets",
        "Controls",
        "Debug Controls",
        "Errors",
        "Graph Window",
        "Properties",
        "Workspace",
      ].map((x) => `Window > Go to... > Show ${x}`),
    );
    for (const r of fell) {
      expect(r.module).toBe("AnimEditor");
      expect(r.read).toBeNull();
      expect(r.routeFalse).toBe(ROUTE_FALSE_PROBE);
      expect(r.notRead).toMatch(/menu-run route/);
      expect(r.notRead).toMatch(/wb_gui invoke/);
      expect(r.notRead).toMatch(/EV-W9-044/);
    }
    // every Go to pair is still named in SHOW_PAIRS (the wb_gui route reads the same dock)
    for (const r of fell) expect(SHOW_PAIRS.AnimEditor![r.segments[2]!], r.id).toBeTruthy();
    expect(t.AnimEditor!.driven).toBe(13);
    expect(t.LocalizationEditor).toEqual({ driven: 0, notRead: 2 });
    for (const r of rows.filter((x) => !x.read)) expect(r.notRead, r.id).toBeTruthy();
  });

  it("sends a run only for driven rows, and every run is on the compiled allow-list", () => {
    const plan = buildActionPlan();
    const pack = loadAllowListFile();
    const view = new Set([VIEW_UNREAD_STEP, VIEW_WE_STEP, VIEW_SE_STEP]);
    const runs = plan.filter(
      (a) =>
        !view.has(String(a.step)) &&
        ((a.tool === "wb_menu" && a.toolAction === "run") ||
          (a.tool === "wb_module" && a.toolAction === "action")),
    );
    const drivenPaths = new Set(rows.filter((r) => r.read).map((r) => `${r.module}|${r.path}`));
    const notRead = new Set(rows.filter((r) => !r.read).map((r) => `${r.module}|${r.path}`));
    for (const a of runs) {
      const p = a.params as Raw;
      const segs = p.menuPath as string[];
      const key = `${String(p.module)}|${segs.join(" > ")}`;
      expect(drivenPaths.has(key), key).toBe(true);
      expect(notRead.has(key) && !drivenPaths.has(key), key).toBe(false);
      expect(isAllowListed(pack, segs), key).toBe(true);
    }
    expect(runs).toHaveLength(63 * 2);
  });

  it("the plan passes checkPlan and the W9 plan check; nothing saves or closes", () => {
    const plan = buildActionPlan();
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT_PATH }).ok).toBe(true);
    expect(w9PlanViolations(plan, rows)).toEqual([]);
    for (const a of plan) {
      expect(String(a.toolAction ?? ""), JSON.stringify(a)).not.toMatch(/save|close/i);
      expect(JSON.stringify(a.params ?? {})).not.toMatch(/"action":"save"/);
    }
    const bad = [
      ...plan,
      { kind: "net-call", tool: "wb_module", toolAction: "save", params: { action: "save" } },
    ];
    expect(w9PlanViolations(bad as never, rows).length).toBeGreaterThan(0);
    const foreign = [
      ...plan,
      {
        kind: "net-call",
        tool: "wb_module",
        toolAction: "action",
        params: { module: "ScriptEditor", menuPath: ["Edit", "Undo"] },
      },
    ];
    expect(w9PlanViolations(foreign as never, rows).join()).toMatch(/not a safe-toggle row/);
  });

  it("the dry run passes and the committed queue is what the step table emits", async () => {
    expect(dryRunCheck(loadPolicy()).ok).toBe(true);
    const committed = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildQueue())));
    expect(validateQueue(buildQueue(), false)).toHaveLength(buildSteps().length);
    expect((buildQueue() as { launch_args: string[] }).launch_args).toEqual([...LAUNCH_ARGS]);
    const out: string[] = [];
    expect(await main([], { out: (l) => out.push(l) })).toBe(EXIT.done);
    expect(out.join("\n")).toMatch(/W9 plan check: PASS/);
  });

  it("one step per module in the ruled order, between the world and net-zero", () => {
    const ids = buildSteps().map((s) => s.id);
    expect(ids.slice(2, 2 + MODULES.length)).toEqual(MODULES.map(moduleStepId));
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids.slice(-2)).toEqual([NETZERO_STEP, CLOSABLE_STEP]);
    expect(
      buildSteps()
        .find((s) => s.id === moduleStepId("LocalizationEditor"))!
        .plan(),
    ).toEqual([]);
  });

  it("names every driven row as census:<id> in the battery file", () => {
    const text = readFileSync(join(REPO_ROOT, ...SCRIPT_PATH.split("/")), "utf-8");
    for (const r of rows.filter((x) => x.read)) expect(text, r.id).toContain(`// census:${r.id}\n`);
  });

  it("classifies: a rule first, then a hint by object name, then a label, else NOT-READ", () => {
    const lines = planToggleLines(
      [
        {
          id: "a",
          module: "ScriptEditor",
          path: "Window > Go to... > Show Errors",
          cls: "safe-toggle",
          route: null,
        },
        {
          id: "b",
          module: "AudioEditor",
          path: "Window > Playlist",
          cls: "safe-toggle",
          route: null,
        },
        {
          id: "c",
          module: "ScriptEditor",
          path: "Window > Output",
          cls: "safe-toggle",
          route: null,
        },
        {
          id: "d",
          module: "ScriptEditor",
          path: "Window > Nowhere",
          cls: "safe-toggle",
          route: null,
        },
        {
          id: "e",
          module: "ScriptEditor",
          path: "Window > Output",
          cls: "safe-state",
          route: null,
        },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );
    expect(lines).toHaveLength(4);
    const out = classifyToggles(lines, [
      {
        id: "dock:pl",
        kind: "dock",
        module: "AudioEditor",
        status: "active",
        object_name: "playlistDockWidget",
      },
      {
        id: "dock:out",
        kind: "dock",
        module: "ScriptEditor",
        status: "active",
        label: "Output",
        object_name: "outputDock",
      },
    ] as never);
    expect(out.map((r) => (r.read ? r.read.rowId : "NOT-READ"))).toEqual([
      "NOT-READ",
      "dock:pl",
      "dock:out",
      "NOT-READ",
    ]);
    expect(out[0]!.notRead).toMatch(/second run does not hide/);
    expect(out[1]!.read!.inferred).toBe(true);
    expect(out[3]!.notRead).toMatch(/no active census dock/);
  });

  it("reads a dock open when shown or tabified, closed when offscreen or absent", () => {
    const t = row("x", "Output").read!;
    const hit = (node: Raw, names = ["Script Editor", "Output"]): ToolResponse => ({
      ok: true,
      readback: { hits: [{ path: "0", names, node }] },
    });
    expect(
      dockStateOf(hit({ controlType: "Window", name: "Output", offscreen: false }), t).open,
    ).toBe(true);
    expect(
      dockStateOf(hit({ controlType: "Window", name: "Output", offscreen: true }), t).open,
    ).toBe(false);
    expect(
      dockStateOf(
        hit({ controlType: "Pane", automationId: "Main.OutputDock", offscreen: false }),
        t,
      ).open,
    ).toBe(true);
    expect(
      dockStateOf(
        hit({ controlType: "TabItem", name: "Output" }, ["x", "qt_tabwidget_tabbar", "Output"]),
        t,
      ).open,
    ).toBe(true);
    expect(
      dockStateOf(hit({ controlType: "TabItem", name: "Output" }, ["x", "list", "Output"]), t).open,
    ).toBe(false);
    expect(dockStateOf({ ok: true, readback: { hits: [] } }, t).open).toBe(false);
    expect(dockStateOf({ ok: false, code: "GATED", message: "m" }, t).ok).toBe(false);
  });
});

// ── The runner ───────────────────────────────────────────────────────────────

describe("W9 runner", () => {
  it("a toggled and restored row PASSes and writes its live result and test link", async () => {
    const o = opts("pass", { evidenceDir: join(TMP, "pass-ev") });
    const sim: Sim = {
      open: new Map([
        ["Output", true],
        ["Watch", true],
      ]),
    };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output"), row("r2", "Watch")] });
    const r = await runBattery(only(SE), deps, o);
    expect(r.exit).toBe(EXIT.done);
    expect(record(o, SE).status).toBe("PASS");
    const lines = readFileSync(join(o.sittingDir, liveFileOf(SE)), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Raw);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({ id: "r1", tests: [{ id: SE, file: SCRIPT_PATH, kind: "live" }] });
    const lr = lines[1]!.live_result as Raw;
    expect(lr).toMatchObject({ test: SE, rows: ["r1"], verdict: "pass", oracle: "state-readback" });
    expect(String(lr.evidence)).toMatch(/^EV-/);
    expect(sim.open.get("Output")).toBe(true);
    const actions = deps.sent.filter(([n, a]) => n === "wb_module" && a.action === "action");
    expect(actions).toHaveLength(4);
  });

  it("the World Editor's rows go through wb_menu run with confirm", async () => {
    const o = opts("we");
    const sim: Sim = { open: new Map([["Main Toolbar", true]]) };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("w1", "Main Toolbar", "WorldEditor")] });
    deps.dirs.add(norm(join(o.sandboxDir, ...WORLD.split("/"))));
    const r = await runBattery(only(moduleStepId("WorldEditor")), deps, o);
    expect(r.exit).toBe(EXIT.done);
    const runs = deps.sent.filter(([n]) => n === "wb_menu");
    expect(runs).toHaveLength(2);
    expect(runs[0]![1]).toMatchObject({
      action: "run",
      module: "WorldEditor",
      path: "Window,Main Toolbar",
      confirm: true,
    });
  });

  it("a row not back after the toggle back is restored by one more run, FAILs, and the module goes on", async () => {
    const o = opts("stuck");
    const sim: Sim = {
      open: new Map([
        ["Output", true],
        ["Watch", true],
      ]),
      stuckOnce: new Set(["Output"]),
    };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output"), row("r2", "Watch")] });
    const r = await runBattery(only(SE), deps, o);
    expect(r.exit).toBe(EXIT.refused);
    const rec = record(o, SE);
    expect(rec.status).toBe("FAIL");
    const results = (rec.evidence as Raw).results as Array<Raw>;
    expect(results[0]).toMatchObject({ verdict: "FAIL" });
    expect(results[0]!.stopModule).toBeUndefined();
    expect(results[0]!.runs).toHaveLength(3);
    expect(String(results[0]!.why)).toMatch(/restore run 1 brought it back/);
    expect(results[1]).toMatchObject({ verdict: "PASS" });
    expect(sim.open.get("Output")).toBe(true);
    // only the PASS row writes a live result
    const lines = readFileSync(join(o.sittingDir, liveFileOf(SE)), "utf-8")
      .trim()
      .split("\n");
    expect(lines.map((l) => JSON.parse(l) as Raw).filter((l) => l.live_result)).toHaveLength(1);
  });

  it("the module stops only when two restore runs leave a row away from its first state", async () => {
    const o = opts("stuck2");
    const sim: Sim = {
      open: new Map([
        ["Output", true],
        ["Watch", true],
      ]),
      stuckAfterFirst: new Set(["Output"]),
    };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output"), row("r2", "Watch")] });
    await runBattery(only(SE), deps, o);
    const results = (record(o, SE).evidence as Raw).results as Array<Raw>;
    expect(results[0]).toMatchObject({ verdict: "FAIL", stopModule: true });
    expect(results[0]!.runs).toHaveLength(4);
    expect(String(results[0]!.why)).toMatch(/2 restore runs left it closed; the module stops/);
    expect(results[1]).toMatchObject({ verdict: "NOT-RUN" });
    expect(
      deps.sent.filter(([, a]) => (a.menuPath as string[] | undefined)?.includes("Watch")),
    ).toEqual([]);
  });

  // W9 run 1 (EV-W9-006 AnimEditor Window > Animation Sets, EV-W9-008 BehaviorEditor Window >
  // Breakpoints) read open, open, closed, closed, open over: read, run, read, run, read, reread,
  // run, read. Two of the three runs changed the dock. Two models give that sequence; the polled
  // round tells them apart.
  const RECORDED = [true, true, false, false, true];
  function oldRound(sim: Sim, title: string): boolean[] {
    const t = simTool(sim);
    const read = (): boolean =>
      ((t("wb_gui", { query: title }).readback as Raw).hits as unknown[]).length > 0;
    const run = (): void => void t("wb_module", { action: "action", menuPath: ["Window", title] });
    const out = [read()];
    run();
    out.push(read());
    run();
    out.push(read(), read());
    run();
    out.push(read());
    return out;
  }

  it("run 1's recorded sequence: an absorbed first run and a three-state cycle both give it", () => {
    const one = (extra: Partial<Sim>): boolean[] =>
      oldRound({ open: new Map([["A", true]]), ...extra }, "A");
    expect(one({ absorbFirst: new Set(["A"]) })).toEqual(RECORDED);
    expect(one({ threeState: new Set(["A"]) })).toEqual(RECORDED);
    // a uniformly late show or hide does not (and three runs that all land settle closed)
    for (const n of [1, 2, 3]) expect(one({ lag: new Map([["A", n]]) })).not.toEqual(RECORDED);
    // nor a dock tabbed behind another: the recorded closed reads had present 0 and tabs 0
  });

  it("an absorbed first run: one more run toggles, the restore and a clean confirm round PASS", async () => {
    const o = opts("absorbed");
    const sim: Sim = {
      open: new Map([
        ["Animation Sets", true],
        ["Graph", true],
      ]),
      absorbFirst: new Set(["Animation Sets"]),
    };
    const deps = fakeDeps({
      tool: simTool(sim),
      rows: [row("a1", "Animation Sets", "AnimEditor"), row("a2", "Graph", "AnimEditor")],
    });
    const AE = moduleStepId("AnimEditor");
    const r = await runBattery(only(AE), deps, o);
    expect(r.exit).toBe(EXIT.done);
    const results = (record(o, AE).evidence as Raw).results as Array<Raw>;
    expect(results[0]).toMatchObject({ verdict: "PASS", absorbed: 1 });
    expect(results[0]!.runs).toHaveLength(5);
    expect(String(results[0]!.why)).toMatch(/confirm round; the first run changed nothing/);
    expect(results[1]).toMatchObject({ verdict: "PASS" });
    expect(sim.open.get("Animation Sets")).toBe(true);
  });

  it("a three-state cycle FAILs on its confirm run, at its first read state, and the module goes on", async () => {
    const o = opts("three");
    const sim: Sim = {
      open: new Map([
        ["Breakpoints", true],
        ["Debug", true],
      ]),
      threeState: new Set(["Breakpoints"]),
    };
    const deps = fakeDeps({
      tool: simTool(sim),
      rows: [row("b1", "Breakpoints", "BehaviorEditor"), row("b2", "Debug", "BehaviorEditor")],
    });
    const BE = moduleStepId("BehaviorEditor");
    await runBattery(only(BE), deps, o);
    const results = (record(o, BE).evidence as Raw).results as Array<Raw>;
    expect(results[0]).toMatchObject({ verdict: "FAIL", absorbed: 1 });
    expect(results[0]!.stopModule).toBeUndefined();
    expect(String(results[0]!.why)).toMatch(/not a two-state toggle/);
    expect(results[1]).toMatchObject({ verdict: "PASS" });
    expect(sim.open.get("Breakpoints")).toBe(true);
  });

  it("a late show or hide is read by the polled read: PASS, no extra run", async () => {
    const o = opts("lag");
    const sim: Sim = { open: new Map([["Output", true]]), lag: new Map([["Output", 3]]) };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output")] });
    await runBattery(only(SE), deps, o);
    const results = (record(o, SE).evidence as Raw).results as Array<Raw>;
    expect(results[0]).toMatchObject({ verdict: "PASS", runs: ["ran", "ran"] });
    expect((results[0]!.reads as Raw[]).map((x) => x.polls ?? 0)).toEqual([0, 3, 3]);
  });

  /** A Go to show row on the Graph dock, hidden by its toggle row g1. */
  function showPair(): [ToggleRow, ToggleRow] {
    const toggle = row("g1", "Graph", "AnimEditor");
    const show: ToggleRow = {
      ...toggle,
      id: "g2",
      path: "Window > Go to... > Show Graph Window",
      segments: ["Window", "Go to...", "Show Graph Window"],
      read: { ...toggle.read!, inferred: true },
      hideWith: { id: "g1", path: toggle.path, segments: toggle.segments },
    };
    return [toggle, show];
  }

  it("a Go to show row: hidden by its dock's toggle, shown by the item, PASS", async () => {
    const o = opts("show", { candidates: true });
    const sim: Sim = { open: new Map([["Graph", true]]) };
    const [toggle, show] = showPair();
    const base = simTool(sim);
    // the sim's Go to item shows the dock, never hides it
    const tool = (name: W9Tool, args: Raw): ToolResponse => {
      const segs = args.menuPath as string[] | undefined;
      if (name === "wb_module" && args.action === "action" && segs?.[1] === "Go to...") {
        sim.open.set("Graph", true);
        return { ok: true, readback: { result: true } };
      }
      return base(name, args);
    };
    const deps = fakeDeps({ tool, rows: [show, toggle] });
    const AE = moduleStepId("AnimEditor");
    await runBattery(only(AE), deps, o);
    const results = (record(o, AE).evidence as Raw).results as Array<Raw>;
    // the toggle row runs first, the show row after it
    expect(results.map((x) => x.id)).toEqual(["g1", "g2"]);
    expect(results[1]).toMatchObject({ verdict: "PASS", hideWith: "Window > Graph" });
    expect(sim.open.get("Graph")).toBe(true);
    const lines = readFileSync(join(o.sittingDir, liveFileOf(AE)), "utf-8")
      .trim()
      .split("\n");
    expect(lines.map((l) => JSON.parse(l) as Raw).filter((l) => l.live_result)).toHaveLength(2);
  });

  it("a show row whose hide row did not PASS is NOT-RUN", async () => {
    const o = opts("show-skip", { candidates: true });
    const sim: Sim = { open: new Map([["Graph", true]]), noFlip: new Set(["Graph"]) };
    const [toggle, show] = showPair();
    const deps = fakeDeps({ tool: simTool(sim), rows: [toggle, show] });
    const AE = moduleStepId("AnimEditor");
    await runBattery(only(AE), deps, o);
    const results = (record(o, AE).evidence as Raw).results as Array<Raw>;
    expect(results[1]).toMatchObject({ verdict: "NOT-RUN" });
    expect(String(results[1]!.why)).toMatch(/hide row Window > Graph did not PASS/);
  });

  it("a row the menu-run route answered false (P-W9-01) is recorded, never sent, and the step PASSes", async () => {
    const o = opts("route-false");
    const sim: Sim = { open: new Map([["Graph", true]]) };
    const toggle = row("g1", "Graph", "AnimEditor");
    const fell = classifyToggles(
      planToggleLines(
        JSON.stringify({
          id: "g2",
          module: "AnimEditor",
          path: "Window > Go to... > Show Graph Window",
          cls: "safe-toggle",
          route: null,
        }),
      ),
      [],
    )[0]!;
    expect(fell).toMatchObject({ read: null, routeFalse: ROUTE_FALSE_PROBE });
    const deps = fakeDeps({ tool: simTool(sim), rows: [toggle, fell] });
    const AE = moduleStepId("AnimEditor");
    const r = await runBattery(only(AE), deps, o);
    expect(r.exit).toBe(EXIT.done);
    const rec = record(o, AE);
    expect(rec.status).toBe("PASS");
    expect(String(rec.detail)).toMatch(/1 of them answered false by the menu-run route, P-W9-01/);
    const ev = rec.evidence as Raw;
    expect(ev.answeredFalse).toEqual([
      { id: "g2", path: "Window > Go to... > Show Graph Window", probe: ROUTE_FALSE_PROBE },
    ]);
    expect(
      deps.sent.filter(([, a]) => (a.menuPath as string[] | undefined)?.includes("Go to...")),
    ).toEqual([]);
  });

  // W9 run 2 (EV-W9-019, fix-up 2): AnimEditor Window > Animation Sets read open, open, closed,
  // open, closed, open on its toggle row (first run swallowed, then a clean confirm round), and
  // Window > Go to... > Show Anim Sets read open, open, closed, open over: read, hide, read, restore
  // run 1, read, restore run 2, read. The dock was still open (its first state) after the swallowed
  // hide, so the two restore runs closed it and opened it again. Same on all six open pairs.
  const RUN2_TOGGLE = [true, true, false, true, false, true];
  const RUN2_SHOW = [true, true, false, true];
  /** The run-2 show row step logic, replayed on a sim: read, then (hide, read) three times. */
  function run2ShowRound(sim: Sim, title: string): boolean[] {
    const t = simTool(sim);
    const read = (): boolean =>
      ((t("wb_gui", { query: title }).readback as Raw).hits as unknown[]).length > 0;
    const hide = (): void => void t("wb_module", { action: "action", menuPath: ["Window", title] });
    const out = [read()];
    for (let i = 0; i < 3; i++) {
      hide();
      out.push(read());
    }
    return out;
  }
  /** The Go to item of showPair(): shows the Graph dock, except the runs listed in `swallow`. */
  function goToTool(sim: Sim, swallow: Set<number> = new Set()) {
    const base = simTool(sim);
    let n = 0;
    return (name: W9Tool, args: Raw): ToolResponse => {
      const segs = args.menuPath as string[] | undefined;
      if (name === "wb_module" && args.action === "action" && segs?.[1] === "Go to...") {
        if (!swallow.has(++n)) sim.open.set("Graph", true);
        return { ok: true, readback: { result: true } };
      }
      return base(name, args);
    };
  }

  it("run 2's recorded show-row sequence is a swallowed hide on a dock left open, not a tabbed group", () => {
    // the toggle row: run 1 swallowed; the pair's hide is the title's run 6, swallowed again
    const sim: Sim = {
      open: new Map([["A", true]]),
      swallow: new Map([["A", new Set([1])]]),
    };
    expect(run2ShowRound(sim, "A")).toEqual(RUN2_SHOW);
    // a hide that landed but read late gives open, closed, ... instead
    const late: Sim = { open: new Map([["A", true]]), lag: new Map([["A", 1]]) };
    expect(run2ShowRound(late, "A")).not.toEqual(RUN2_SHOW);
    // the closed read of restore run 1 had present 0 and tabs 0: the dock itself left the tree, so
    // the read did not match another element and the dock was not left in a tab group
  });

  it("fix-up 2: run 2's swallowed toggle run and swallowed hide, replayed, PASS both rows", async () => {
    const o = opts("run2-pair", { candidates: true });
    const sim: Sim = {
      open: new Map([["Graph", true]]),
      // the toggle row's run 1, and its run 6 (the pair's first hide), change nothing
      swallow: new Map([["Graph", new Set([1, 6])]]),
    };
    const [toggle, show] = showPair();
    const deps = fakeDeps({ tool: goToTool(sim), rows: [toggle, show] });
    const AE = moduleStepId("AnimEditor");
    await runBattery(only(AE), deps, o);
    const results = (record(o, AE).evidence as Raw).results as Array<Raw>;
    expect((results[0]!.reads as DockStateLike[]).map((x) => x.open)).toEqual(RUN2_TOGGLE);
    expect(results[0]).toMatchObject({ verdict: "PASS", absorbed: 1 });
    expect((results[1]!.reads as DockStateLike[]).map((x) => x.open)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(results[1]).toMatchObject({ verdict: "PASS", absorbed: 1, runs: ["ran", "ran", "ran"] });
    expect(String(results[1]!.why)).toMatch(/the first hide changed nothing/);
    expect(sim.open.get("Graph")).toBe(true);
  });

  it("fix-up 2: a hide that never reads closed FAILs with no restore run, and the module goes on", async () => {
    const o = opts("hide-never", { candidates: true });
    const sim: Sim = {
      open: new Map([
        ["Graph", true],
        ["Preview", true],
      ]),
      // the toggle row runs 1 and 2 clean; the pair's two hides (runs 3 and 4) change nothing
      swallow: new Map([["Graph", new Set([3, 4])]]),
    };
    const [toggle, show] = showPair();
    const after = row("p1", "Preview", "AnimEditor");
    const deps = fakeDeps({ tool: goToTool(sim), rows: [toggle, show, after] });
    const AE = moduleStepId("AnimEditor");
    await runBattery(only(AE), deps, o);
    const results = (record(o, AE).evidence as Raw).results as Array<Raw>;
    const pair = results.find((x) => x.id === "g2")!;
    expect(pair).toMatchObject({ verdict: "FAIL", absorbed: 2, runs: ["ran", "ran"] });
    expect(pair.stopModule).toBeUndefined();
    expect(String(pair.why)).toMatch(/the first state stands, nothing to restore/);
    expect(results.find((x) => x.id === "p1")).toMatchObject({ verdict: "PASS" });
    expect(sim.open.get("Graph")).toBe(true);
  });

  it("fix-up 2: a swallowed first show gets one more run and PASSes", async () => {
    const o = opts("show-swallow", { candidates: true });
    const sim: Sim = { open: new Map([["Graph", true]]) };
    const [toggle, show] = showPair();
    const deps = fakeDeps({ tool: goToTool(sim, new Set([1])), rows: [toggle, show] });
    const AE = moduleStepId("AnimEditor");
    await runBattery(only(AE), deps, o);
    const results = (record(o, AE).evidence as Raw).results as Array<Raw>;
    expect(results[1]).toMatchObject({ verdict: "PASS", absorbed: 1, runs: ["ran", "ran", "ran"] });
    expect(String(results[1]!.why)).toMatch(/the first show changed nothing/);
    expect(sim.open.get("Graph")).toBe(true);
  });

  it("a run that changes nothing FAILs without stopping the module", async () => {
    const o = opts("noflip");
    const sim: Sim = {
      open: new Map([
        ["Output", true],
        ["Watch", true],
      ]),
      noFlip: new Set(["Output"]),
    };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output"), row("r2", "Watch")] });
    await runBattery(only(SE), deps, o);
    const results = (record(o, SE).evidence as Raw).results as Array<Raw>;
    expect(results[0]).toMatchObject({ verdict: "FAIL", runs: ["ran", "ran"] });
    expect(String(results[0]!.why)).toMatch(/no change read after two runs/);
    expect(results[1]).toMatchObject({ verdict: "PASS" });
  });

  it("a run answered false with no change is sent once and FAILs", async () => {
    const o = opts("dead");
    const sim: Sim = { open: new Map([["Output", true]]), dead: new Set(["Output"]) };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output")] });
    await runBattery(only(SE), deps, o);
    const results = (record(o, SE).evidence as Raw).results as Array<Raw>;
    expect(results[0]).toMatchObject({ verdict: "FAIL", runs: ["returned false"] });
  });

  it("a dock closed at the first read is not run unless --show-closed", async () => {
    const sim: Sim = { open: new Map([["Output", false]]) };
    const o = opts("closed");
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output")] });
    await runBattery(only(SE), deps, o);
    expect(((record(o, SE).evidence as Raw).results as Raw[])[0]).toMatchObject({
      verdict: "NOT-RUN",
    });
    expect(deps.sent.filter(([, a]) => a.action === "action")).toEqual([]);
    const o2 = opts("closed-show", { showClosed: true });
    const deps2 = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output")] });
    await runBattery(only(SE), deps2, o2);
    expect(((record(o2, SE).evidence as Raw).results as Raw[])[0]).toMatchObject({
      verdict: "PASS",
    });
  });

  it("a NOT-READ row sends nothing; a module with no read sends nothing at all", async () => {
    const o = opts("notread");
    const nr: ToggleRow = { ...row("n1", "Go"), read: null, notRead: "why" };
    const deps = fakeDeps({ tool: simTool({ open: new Map() }), rows: [nr] });
    const r = await runBattery(only(SE), deps, o);
    expect(r.exit).toBe(EXIT.done);
    expect(deps.sent).toEqual([]);
    expect(record(o, SE).detail).toMatch(/1 recorded NOT-READ, nothing sent/);
  });

  it("a dialog (MODAL_OPEN) is a handoff that answers No on a save prompt, never Save", async () => {
    const o = opts("modal");
    const sim: Sim = {
      open: new Map([["Output", true]]),
      fail: (n, a) =>
        n === "wb_module" && a.action === "action"
          ? { ok: false, code: "MODAL_OPEN", message: 'a modal "Loading world" is up' }
          : null,
    };
    const deps = fakeDeps({ tool: simTool(sim), rows: [row("r1", "Output")] });
    const r = await runBattery(only(SE), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    const rec = record(o, SE);
    expect(rec.status).toBe("HANDOFF");
    expect(String(rec.detail)).toMatch(/press No/);
    expect(String(rec.detail)).not.toMatch(/press Save/);
  });

  it("the gate aborts off the test bed and stops without -forceSettings", async () => {
    const o = opts("gate-abort");
    const deps = fakeDeps({ info: { projectFound: 1, projectName: "SomeMod" } });
    gateReady(o, deps);
    const r = await runBattery(buildSteps(), deps, o);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.records.map((x) => x.step)).toEqual([GATE_STEP]);
    expect(deps.sent).toEqual([]);

    const o2 = opts("gate-ini");
    const deps2 = fakeDeps({ tool: simTool({ open: new Map() }) });
    gateReady(o2, deps2);
    deps2.commandLine = async () => "Workbench.exe -gproj x";
    const r2 = await runBattery(only(GATE_STEP), deps2, o2);
    expect(r2.exit).toBe(EXIT.stopped);
    expect(r2.records[0]!.detail).toMatch(/-forceSettings/);

    const o3 = opts("gate-ok");
    const deps3 = fakeDeps({ tool: simTool({ open: new Map() }) });
    gateReady(o3, deps3);
    const r3 = await runBattery(only(GATE_STEP), deps3, o3);
    expect(r3.exit).toBe(EXIT.done);
    expect(deps3.files.has(norm(join(o3.sittingDir, BATTERY_SNAPSHOT_FILE)))).toBe(true);
  });

  it("closable reads the state only: the world is never saved, reopened or closed", async () => {
    const o = opts("closable");
    const deps = fakeDeps({ tool: simTool({ open: new Map() }) });
    const r = await runBattery(only(CLOSABLE_STEP), deps, o);
    expect(r.exit).toBe(EXIT.done);
    expect(deps.sent).toEqual([["wb_world", { action: "state" }]]);
    expect(record(o, CLOSABLE_STEP).detail).toMatch(/untouched/);
  });

  it("net-zero fails a change outside _throwaway/W9/, tolerates one inside and the rdb", async () => {
    const o = opts("netzero");
    const deps = fakeDeps({ tool: simTool({ open: new Map() }) });
    const f = (rel: string): string => norm(join(o.sandboxDir, ...rel.split("/")));
    deps.files.set(f("Worlds/a.ent"), Buffer.from("a"));
    deps.files.set(f("resourceDatabase.rdb"), Buffer.from("r"));
    gateReady(o, deps);
    await runBattery(only(GATE_STEP), deps, o);
    deps.files.set(f(`${W9_ROOT}/worlds/x.ent`), Buffer.from("x"));
    deps.files.set(f("resourceDatabase.rdb"), Buffer.from("r2"));
    const ok = await runBattery(
      only(NETZERO_STEP),
      deps,
      opts("netzero", { runDir: join(TMP, "netzero", "run-2") }),
    );
    expect(ok.records[0]!.status).toBe("PASS");
    deps.files.set(f("Worlds/a.ent"), Buffer.from("changed"));
    const bad = await runBattery(
      only(NETZERO_STEP),
      deps,
      opts("netzero", { runDir: join(TMP, "netzero", "run-3") }),
    );
    expect(bad.records[0]!.status).toBe("FAIL");
    expect(bad.records[0]!.detail).toMatch(/Worlds\/a\.ent/);
  });

  it("a step never runs twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps({ tool: simTool({ open: new Map() }) });
    await runBattery(only(CLOSABLE_STEP), deps, o);
    const r = await runBattery(only(CLOSABLE_STEP), deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });
});

// ── The view and selection items (DEC-095) ───────────────────────────────────

interface ViewSim {
  /** An entity at index:0 in the throwaway world. */
  entity: boolean;
  sel: string[];
  cam: string;
  /** null: no script tab open. */
  caret: { file: string; line: number } | null;
  /** The Script Editor's Navigate Forward brings the caret back after a Navigate Back. */
  forwardRestores?: boolean;
  /** setCamera moves the camera (false: it answers ok and leaves it). */
  setCameraWorks?: boolean;
}

function viewTool(v: ViewSim): (name: W9Tool, args: Raw) => ToolResponse {
  let backFrom: number | null = null;
  return (name, args) => {
    const a = String(args.action);
    if (name === "wb_world" && a === "state")
      return { ok: true, readback: { mode: "edit", worldPath: WORLD } };
    if (name === "wb_view") {
      if (a === "selection") return { ok: true, readback: { rows: v.sel.map((id) => ({ id })) } };
      if (a === "select") {
        if (args.mode === "clear") v.sel = [];
        else {
          const refs = (args.entities as string[]).map((e) => e.replace(/^id:/, ""));
          if (refs[0] === "index:0") {
            if (!v.entity)
              return { ok: true, readback: { selectedCount: 0, missing: ["index:0"] } };
            v.sel = ["e0"];
          } else v.sel = refs;
        }
        return { ok: true, readback: { selectedCount: v.sel.length } };
      }
      if (a === "camera") return { ok: true, readback: { coords: v.cam, direction: "0 0 1" } };
      if (a === "setCamera") {
        if (v.setCameraWorks !== false) v.cam = String(args.coords);
        return { ok: true, readback: {} };
      }
    }
    if (name === "wb_script_editor" && a === "state")
      return {
        ok: true,
        readback: v.caret ? { opened: true, ...v.caret } : { opened: false },
      };
    if (name === "wb_menu" && a === "run") {
      const p = String(args.path);
      if (p === "Entities,Select Children") v.sel = ["e1", "e2"];
      if (p === "Entities,Focus Selection") v.cam = "10 20 30";
      return { ok: true, readback: { ran: true } };
    }
    if (name === "wb_module" && a === "action") {
      const p = (args.menuPath as string[]).join(" > ");
      if (v.caret && p === "Edit > Navigate Back") {
        backFrom = v.caret.line;
        v.caret = { ...v.caret, line: 5 };
      }
      if (v.caret && p === "Edit > Navigate Forward" && backFrom !== null) {
        if (v.forwardRestores !== false) v.caret = { ...v.caret, line: backFrom };
        backFrom = null;
      }
      return { ok: true, readback: { result: true } };
    }
    return { ok: true, readback: {} };
  };
}

const runsOf = (deps: ReturnType<typeof fakeDeps>): string[] =>
  deps.sent
    .filter(
      ([n, a]) =>
        (n === "wb_menu" && a.action === "run") ||
        (n === "wb_module" && a.action === "action") ||
        (n === "probe" && a.action === "executeAction"),
    )
    .map(([n, a]) => (n === "wb_menu" ? String(a.path) : (a.menuPath as string[]).join(",")));

describe("W9 candidate override (DEC-100)", () => {
  const goTo = "Window > Go to... > Show Graph Window";
  const showRow = (): ToggleRow => ({
    ...row("g2", "Graph Window", "AnimEditor"),
    path: goTo,
    segments: goTo.split(" > "),
  });

  it("a candidate row is NOT-RUN and never sent without --candidates; with it, only the probe pack sends it", async () => {
    expect(isCandidatePath(goTo.split(" > "))).toBe(true);
    const o = opts("cand-held");
    const deps = fakeDeps({
      tool: simTool({ open: new Map([["Graph Window", true]]) }),
      rows: [showRow()],
    });
    const AE = moduleStepId("AnimEditor");
    await runBattery(only(AE), deps, o);
    const res = (record(o, AE).evidence as Raw).results as Array<Raw>;
    expect(res[0]).toMatchObject({ verdict: "NOT-RUN" });
    expect(String(res[0]!.why)).toMatch(/DEC-100 candidate/);
    expect(runsOf(deps)).toEqual([]);

    const o2 = opts("cand-run", { candidates: true });
    const deps2 = fakeDeps({
      tool: simTool({ open: new Map([["Graph Window", true]]) }),
      rows: [showRow()],
    });
    await runBattery(only(AE), deps2, o2);
    const sentRuns = deps2.sent.filter(([, a]) => Array.isArray(a.menuPath));
    expect(sentRuns.length).toBeGreaterThan(0);
    for (const [n, a] of sentRuns) expect([n, a.candidate]).toEqual(["probe", true]);
  });

  it("the regression plan sends no probe call; the candidate plan sends them and passes both checks", () => {
    const rows = loadToggleRows();
    const plain = buildActionPlan();
    expect(plain.some((a) => a.tool === "probe")).toBe(false);
    const cand = buildActionPlan(buildSteps({ candidates: true }));
    const probes = cand.filter((a) => a.tool === "probe");
    expect(probes.length).toBeGreaterThan(0);
    expect(checkPlan(cand, loadPolicy(), { script: SCRIPT_PATH }).ok).toBe(true);
    expect(w9PlanViolations(cand, rows, { candidates: true })).toEqual([]);
    // the same plan without the override, or a candidate sent by a shipped tool, is refused
    expect(w9PlanViolations(cand, rows).join()).toMatch(/only under --candidates/);
    const shipped = [
      {
        kind: "net-call",
        tool: "wb_module",
        toolAction: "action",
        params: { module: "AnimEditor", menuPath: goTo.split(" > ") },
      },
    ];
    expect(w9PlanViolations(shipped as never, rows).join()).toMatch(/DEC-100 candidate/);
  });

  it("under --candidates the gate stops when the probe pack does not answer on the sandbox", async () => {
    const o = opts("cand-gate", { candidates: true });
    const deps = fakeDeps({
      tool: simTool({ open: new Map() }),
      probeInfo: { ok: false, code: "UNKNOWN_API", message: "no ECEN_Probe" },
    });
    gateReady(o, deps);
    const r = await runBattery(only(GATE_STEP), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(String(r.records[0]!.detail)).toMatch(/--probe-pack mod-dev\/probe/);
    const o2 = opts("cand-gate-ok", { candidates: true });
    const deps2 = fakeDeps({ tool: simTool({ open: new Map() }) });
    gateReady(o2, deps2);
    expect((await runBattery(only(GATE_STEP), deps2, o2)).exit).toBe(EXIT.done);
  });
});

describe("W9 view and selection items (DEC-095)", () => {
  it("19 rows: 11 driven, 8 NOT-READ, 9 held off the list; 2 proven (DEC-100), the rest candidates", () => {
    expect(VIEW_ROWS).toHaveLength(19);
    expect(VIEW_ROWS.filter((r) => r.read)).toHaveLength(11);
    expect(VIEW_ROWS.filter((r) => !r.read)).toHaveLength(8);
    expect(VIEW_HELD).toHaveLength(9);
    const pack = loadAllowListFile();
    // DEC-100: only the two items whose effect W9 run 3 read and restored are on the shipped list
    const proven = VIEW_ROWS.filter((r) => isAllowListed(pack, r.segments)).map((r) => r.path);
    expect(proven.sort()).toEqual(["Entities > Focus Selection", "Entities > Select Layer"]);
    for (const r of VIEW_ROWS)
      expect(isAllowListed(pack, r.segments) !== isCandidatePath(r.segments), r.id).toBe(true);
    for (const r of VIEW_ROWS.filter((x) => x.counterpart))
      expect(VIEW_ROWS.some((x) => x.segments.join() === r.counterpart!.join())).toBe(true);
    for (const h of VIEW_HELD) expect(isAllowListed(pack, h.path.split(" > ")), h.id).toBe(false);
    const ids = buildSteps().map((s) => s.id);
    expect(ids.slice(-5)).toEqual([
      VIEW_UNREAD_STEP,
      VIEW_WE_STEP,
      VIEW_SE_STEP,
      NETZERO_STEP,
      CLOSABLE_STEP,
    ]);
  });

  it("names every driven view row as census:<id> in the battery file, and the plan sends only view reads", () => {
    const text = readFileSync(join(REPO_ROOT, ...SCRIPT_PATH.split("/")), "utf-8");
    for (const r of VIEW_ROWS.filter((x) => x.read))
      expect(text, r.id).toContain(`// census:${r.id}\n`);
    const plan = buildActionPlan().filter((a) =>
      [VIEW_WE_STEP, VIEW_SE_STEP, VIEW_UNREAD_STEP].includes(String(a.step)),
    );
    for (const a of plan) {
      if (a.tool === "wb_view")
        expect(["selection", "select", "camera", "setCamera"]).toContain(a.toolAction);
      if (a.tool === "wb_script_editor") expect(a.toolAction).toBe("state");
      expect(a.tool).not.toBe("wb_gui");
    }
    const bad = [
      { kind: "net-call", tool: "wb_view", toolAction: "setVisible", params: {} },
      { kind: "net-call", tool: "wb_view", toolAction: "select", params: { mode: "add" } },
      { kind: "net-call", tool: "wb_script_editor", toolAction: "setLine", params: {} },
    ];
    expect(w9PlanViolations(bad as never, loadToggleRows())).toHaveLength(3);
  });

  it("World Editor: an effect read writes a live result, no effect writes none; camera and selection put back", async () => {
    const o = opts("view-we", { candidates: true });
    const v: ViewSim = { entity: true, sel: [], cam: "1 2 3", caret: null };
    const deps = fakeDeps({ tool: viewTool(v) });
    const r = await runBattery(only(VIEW_WE_STEP), deps, o);
    expect(r.exit).toBe(EXIT.done);
    const ev = record(o, VIEW_WE_STEP).evidence as Raw;
    const results = ev.results as Array<Raw>;
    const by = (p: string): Raw => results.find((x) => x.path === p)!;
    expect(by("Entities > Select Children")).toMatchObject({ verdict: "PASS" });
    expect(by("Entities > Select Parent")).toMatchObject({ verdict: "NO-EFFECT" });
    expect(by("Entities > Focus Selection")).toMatchObject({ verdict: "PASS" });
    expect(by("Entities > Locate Prefab")).toMatchObject({ verdict: "NOT-READ", runs: [] });
    expect(v.cam).toBe("1 2 3");
    expect(v.sel).toEqual([]);
    expect(runsOf(deps).some((p) => p.includes("Locate"))).toBe(false);
    const lines = readFileSync(join(o.sittingDir, liveFileOf(VIEW_WE_STEP)), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Raw);
    const named = lines.filter((l) => l.live_result).map((l) => (l.live_result as Raw).rows);
    expect(named).toEqual([
      ["ui:WorldEditor/menu-item/Entities/Select Children"],
      ["ui:WorldEditor/menu-item/Entities/Focus Selection"],
    ]);
    // every row started from the world's first entity selected
    const seeds = deps.sent.filter(
      ([n, a]) => n === "wb_view" && a.action === "select" && a.mode === "set",
    );
    expect(seeds).toHaveLength(7);
  });

  it("World Editor: a selection found is set back; a camera not put back FAILs", async () => {
    const o = opts("view-we-back", { candidates: true });
    const v: ViewSim = {
      entity: true,
      sel: ["x9"],
      cam: "1 2 3",
      caret: null,
      setCameraWorks: false,
    };
    const deps = fakeDeps({ tool: viewTool(v) });
    await runBattery(only(VIEW_WE_STEP), deps, o);
    const rec = record(o, VIEW_WE_STEP);
    expect(rec.status).toBe("FAIL");
    expect(String(rec.detail)).toMatch(
      /Focus Selection: the camera moved; wb_view setCamera did not put it back/,
    );
    expect(v.sel).toEqual(["x9"]);
    const last = deps.sent.filter(([n, a]) => n === "wb_view" && a.action === "select").pop()!;
    expect(last[1]).toMatchObject({ mode: "set", entities: ["id:x9"] });
  });

  it("World Editor: an empty world runs no item and puts the selection back", async () => {
    const o = opts("view-we-empty", { candidates: true });
    const v: ViewSim = { entity: false, sel: [], cam: "1 2 3", caret: null };
    const deps = fakeDeps({ tool: viewTool(v) });
    await runBattery(only(VIEW_WE_STEP), deps, o);
    const results = (record(o, VIEW_WE_STEP).evidence as Raw).results as Array<Raw>;
    expect(results.filter((x) => x.verdict === "NOT-RUN")).toHaveLength(7);
    expect(String(results[0]!.why)).toMatch(/no entity at index:0/);
    expect(runsOf(deps)).toEqual([]);
    expect(v.sel).toEqual([]);
  });

  it("Script Editor: a caret move put back by the counterpart PASSes; no move writes nothing", async () => {
    const o = opts("view-se", { candidates: true });
    const v: ViewSim = {
      entity: false,
      sel: [],
      cam: "",
      caret: { file: "scripts/A.c", line: 10 },
    };
    const deps = fakeDeps({ tool: viewTool(v) });
    const r = await runBattery(only(VIEW_SE_STEP), deps, o);
    expect(r.exit).toBe(EXIT.done);
    const results = (record(o, VIEW_SE_STEP).evidence as Raw).results as Array<Raw>;
    expect(results.map((x) => x.verdict)).toEqual(["PASS", "NO-EFFECT", "NO-EFFECT", "NO-EFFECT"]);
    expect(results[0]!.runs).toEqual(["ran", "ran"]);
    expect(v.caret!.line).toBe(10);
    expect(runsOf(deps)[1]).toBe("Edit,Navigate Forward");
  });

  it("Script Editor: a caret not brought back FAILs; no tab open runs nothing", async () => {
    const o = opts("view-se-stuck", { candidates: true });
    const v: ViewSim = {
      entity: false,
      sel: [],
      cam: "",
      caret: { file: "scripts/A.c", line: 10 },
      forwardRestores: false,
    };
    await runBattery(only(VIEW_SE_STEP), fakeDeps({ tool: viewTool(v) }), o);
    expect(record(o, VIEW_SE_STEP).status).toBe("FAIL");
    const o2 = opts("view-se-none", { candidates: true });
    const deps = fakeDeps({ tool: viewTool({ entity: false, sel: [], cam: "", caret: null }) });
    await runBattery(only(VIEW_SE_STEP), deps, o2);
    const results = (record(o2, VIEW_SE_STEP).evidence as Raw).results as Array<Raw>;
    expect(results.every((x) => x.verdict === "NOT-RUN")).toBe(true);
    expect(runsOf(deps)).toEqual([]);
  });

  it("DEC-100: without --candidates the World Editor step runs only the proven items, by wb_menu", async () => {
    const o = opts("view-we-regress");
    const v: ViewSim = { entity: true, sel: [], cam: "1 2 3", caret: null };
    const deps = fakeDeps({ tool: viewTool(v) });
    await runBattery(only(VIEW_WE_STEP), deps, o);
    expect(deps.sent.some(([n]) => n === "probe")).toBe(false);
    expect(runsOf(deps).sort()).toEqual(["Entities,Focus Selection", "Entities,Select Layer"]);
    const results = (record(o, VIEW_WE_STEP).evidence as Raw).results as Array<Raw>;
    const held = results.filter((x) => /DEC-100 candidate/.test(String(x.why)));
    expect(held.map((x) => x.path).sort()).toEqual(
      [
        "Select Children",
        "Select Parent",
        "Select Prefab Instance Members",
        "Select Prefab Instance Root",
        "Select Siblings",
      ].map((x) => `Entities > ${x}`),
    );
    for (const h of held) expect(h.verdict).toBe("NOT-RUN");
    expect(v.cam).toBe("1 2 3");
  });

  it("DEC-100: without --candidates the Script Editor step sends nothing (its four rows are candidates)", async () => {
    const o = opts("view-se-regress");
    const v: ViewSim = {
      entity: false,
      sel: [],
      cam: "",
      caret: { file: "scripts/A.c", line: 10 },
    };
    const deps = fakeDeps({ tool: viewTool(v) });
    const r = await runBattery(only(VIEW_SE_STEP), deps, o);
    expect(r.exit).toBe(EXIT.done);
    expect(deps.sent).toEqual([]);
    expect(
      buildSteps()
        .find((s) => s.id === VIEW_SE_STEP)!
        .plan(),
    ).toEqual([]);
    expect(
      buildSteps({ candidates: true })
        .find((s) => s.id === VIEW_SE_STEP)!
        .plan().length,
    ).toBeGreaterThan(0);
  });

  it("the unread step sends nothing and records the 5 NOT-READ rows and the 9 held", async () => {
    const o = opts("view-unread");
    const deps = fakeDeps({ tool: viewTool({ entity: true, sel: [], cam: "", caret: null }) });
    await runBattery(only(VIEW_UNREAD_STEP), deps, o);
    const rec = record(o, VIEW_UNREAD_STEP);
    expect(rec.status).toBe("PASS");
    expect(((rec.evidence as Raw).notRead as unknown[]).length).toBe(5);
    expect(((rec.evidence as Raw).held as unknown[]).length).toBe(9);
    expect(deps.sent).toEqual([]);
  });
});

// ── Plant and rollback ───────────────────────────────────────────────────────

function fakeIo(pids: number[] = []): OfflineIo & {
  made: string[];
  removed: string[];
  written: Map<string, Buffer>;
  present: Set<string>;
} {
  const made: string[] = [];
  const removed: string[] = [];
  const written = new Map<string, Buffer>();
  const present = new Set<string>();
  return {
    made,
    removed,
    written,
    present,
    workbenchPids: () => pids,
    exists: (p) => present.has(norm(p)) || written.has(norm(p)),
    listDir: () => [],
    listTree: () => ["worlds/EMCP_W9_Tiny.ent"],
    readBytes: (p) => written.get(norm(p)) ?? Buffer.from("x"),
    writeBytes: (p, b) => void written.set(norm(p), b),
    removeTree: (p) => void removed.push(norm(p)),
    makeDir: (p) => {
      made.push(norm(p));
      present.add(norm(p));
    },
    log: () => undefined,
  };
}

describe("W9 plant and rollback", () => {
  const sb = join(TMP, "pr", SANDBOX_NAME);
  const sit = join(TMP, "pr");

  it("plant makes the folders and its record, offline only", () => {
    expect(runPlant(sb, sit, true, fakeIo([1]))).toBe(EXIT.refused);
    const dry = fakeIo();
    expect(runPlant(sb, sit, false, dry)).toBe(EXIT.done);
    expect(dry.made).toEqual([]);
    const io = fakeIo();
    expect(runPlant(sb, sit, true, io)).toBe(EXIT.done);
    expect(io.made).toEqual(PLANT_DIRS.map((d) => norm(join(sb, ...d.split("/")))));
    expect(io.written.has(norm(join(sit, PLANT_FILE)))).toBe(true);
  });

  it("rollback removes _throwaway/W9/ only, offline only", () => {
    const io = fakeIo();
    io.present.add(norm(join(sb, ...W9_ROOT.split("/"))));
    expect(runRollback(sb, sit, true, { ...io, workbenchPids: () => [7] })).toBe(EXIT.refused);
    expect(runRollback(sb, sit, true, io)).toBe(EXIT.done);
    expect(io.removed[0]).toBe(norm(join(sb, ...W9_ROOT.split("/"))));
  });
});
