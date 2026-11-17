import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import {
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  DENY_FILE,
  DENY_STEP,
  EXCLUDED,
  EXIT,
  GATE_STEP,
  LOCLENGTH_STEP,
  LOC_ROW,
  LOC_ST,
  NETZERO_STEP,
  PLANT_DIRS,
  PLANT_FILE,
  RM_MENUS_STEP,
  SCRIPT_PATH,
  STYLES_COPY,
  STYLES_STEP,
  W12_ROOT,
  WE_MENUS_STEP,
  WORLD,
  buildActionPlan,
  buildQueue,
  buildSteps,
  denyObservations,
  dryRunCheck,
  liveFileOf,
  main,
  matchLabel,
  plantSources,
  recordPath,
  runBattery,
  runPlant,
  runRollback,
  selectSteps,
  w12PlanViolations,
  walkArgv,
  type OfflineIo,
  type OfflineTool,
  type StepDef,
  type ToolResponse,
  type W12Deps,
  type W12Options,
  type W12Tool,
} from "../live/w12.live.js";

type Raw = Record<string, unknown>;

const TMP = mkdtempSync(join(tmpdir(), "emcp-w12-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 1111;
const norm = (p: string): string => p.replace(/\\/g, "/");

interface Sim {
  info?: Raw | null;
  stamp?: string;
  /** The answer of the wb_plugin confirm (default: GATED, the RunProven line is false). */
  confirm?: ToolResponse;
  /** The answer of the wb_plugin dry run (default: ok). */
  dry?: ToolResponse;
  /** wb_localization open answers opened false. */
  noOpen?: boolean;
  /** Walk exit code per module (default 0). */
  walkExit?: Record<string, number>;
  /** Observation lines a walk writes, per module (default: one menu line; [] writes no obs file). */
  walkLines?: Record<string, Raw[]>;
  /** The walker's `*-menus.json` and its step record, per module (default: none written). */
  walkMenus?: Record<string, { menus: Raw; record?: Raw }>;
}

type Fake = W12Deps & {
  files: Map<string, Buffer>;
  dirs: Set<string>;
  sent: Array<[string, Raw]>;
  offlineSent: Array<[OfflineTool, Raw]>;
  walks: Array<{ script: string; argv: string[] }>;
};

function arg(argv: string[], k: string): string {
  return argv[argv.indexOf(k) + 1] ?? "";
}

function fakeDeps(o: W12Options, sim: Sim = {}): Fake {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const sent: Array<[string, Raw]> = [];
  const offlineSent: Array<[OfflineTool, Raw]> = [];
  const walks: Array<{ script: string; argv: string[] }> = [];
  const at = (rel: string): string => norm(join(o.sandboxDir, ...rel.split("/")));
  let worldPath = "";
  let table = "";
  const put = (p: string, b: Buffer): void => {
    files.set(norm(p), b);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, b);
  };
  const tool = (name: W12Tool, args: Raw): ToolResponse => {
    if (name === "wb_world" && args.action === "state") return { ok: true, readback: { mode: "edit", worldPath } };
    if (name === "wb_world" && args.action === "new") {
      put(at(String(args.path)), Buffer.from("world"));
      return { ok: true, readback: {} };
    }
    if (name === "wb_module" && args.action === "setResource" && args.module === "WorldEditor") {
      worldPath = String(args.target).replace(/^path:/, "");
      return { ok: true, readback: {} };
    }
    if (name === "wb_localization" && args.action === "open") {
      if (sim.noOpen) return { ok: true, readback: { opened: false } };
      table = String(args.path);
      return { ok: true, readback: { opened: true, table, total: 1 } };
    }
    if (name === "wb_localization" && args.action === "status")
      return { ok: true, readback: table ? { table, total: 1 } : { table: "" } };
    if (name === "wb_plugin")
      return args.confirm
        ? (sim.confirm ?? { ok: false, code: "GATED", message: "the class has no proven Run" })
        : (sim.dry ?? { ok: true, readback: { ran: false, note: "preconditions met" } });
    return { ok: true, readback: {} };
  };
  return {
    files,
    dirs,
    sent,
    offlineSent,
    walks,
    tool: async (name, args) => {
      sent.push([name, args]);
      return tool(name, args);
    },
    offline: async (name, args) => {
      offlineSent.push([name, args]);
      if (name === "string_table" && args.action === "create") put(at(String(args.path)), Buffer.from("StringTable {}"));
      return { ok: true, readback: {} };
    },
    walk: async (script, argv) => {
      walks.push({ script, argv });
      const module = arg(argv, "--module");
      const lines = sim.walkLines?.[module] ?? [
        { dim: "ui", kind: "menu", module, key: { path: [module === "ResourceManager.Styles" ? "WidgetStyle" : "File"] }, label_raw: "File" },
      ];
      if (lines.length)
        put(
          join(arg(argv, "--run-dir"), `L02-${module}-none.obs.jsonl`),
          Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"),
        );
      const m = sim.walkMenus?.[module];
      if (m) {
        put(join(arg(argv, "--run-dir"), "p4-l02-step-none-menus.json"), Buffer.from(JSON.stringify(m.menus)));
        if (m.record) put(join(arg(argv, "--run-dir"), "p4-l02-step-none.json"), Buffer.from(JSON.stringify(m.record)));
      }
      return sim.walkExit?.[module] ?? 0;
    },
    info: async () => (sim.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : sim.info),
    ping: async () => ({ buildStamp: sim.stamp ?? "abc" }),
    bundleDigest: () => "abc",
    windows: async () => [],
    recordedPid: () => PID,
    commandLine: async () => `ArmaReforgerWorkbenchSteamDiag.exe -forceSettings ${join(o.sittingDir, "scratch.ini")}`,
    logLines: () => [],
    readBytes: (p) => {
      const b = files.get(norm(p));
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    writeBytes: put,
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

function opts(name: string): W12Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W12Options["ph"],
    build: "test",
    lane: { id: "lane-test" },
    port: 5775,
  };
}

function only(steps: StepDef[], id: string): StepDef[] {
  const s = selectSteps(steps as never, { only: id }) as StepDef[] | string;
  if (typeof s === "string") throw new Error(s);
  return s;
}

function record(o: W12Options, step: string): Raw {
  return JSON.parse(readFileSync(recordPath(o.runDir, step), "utf-8")) as Raw;
}

function liveLines(o: W12Options, step: string): Raw[] {
  const p = join(o.sittingDir, liveFileOf(step));
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Raw);
}

/** The test bed, the planted folders, the Styles copy and the battery snapshot (taken by the gate). */
function sandbox(o: W12Options, deps: Fake, styles = true): void {
  deps.files.set(norm(join(o.sandboxDir, `${SANDBOX_NAME}.gproj`)), Buffer.from('GameProject {\n ID "EMCP2_sandbox"\n}\n'));
  for (const d of PLANT_DIRS) deps.dirs.add(norm(join(o.sandboxDir, ...d.split("/"))));
  if (styles) deps.files.set(norm(join(o.sandboxDir, ...STYLES_COPY.split("/"))), Buffer.from("WidgetStyles {}"));
}

// ── Offline: plan, queue, census tags ────────────────────────────────────────

describe("W12 plan and queue", () => {
  it("the plan passes checkPlan and the W12 plan check, never saves or closes, and the queue validates", () => {
    const plan = buildActionPlan();
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT_PATH }).ok).toBe(true);
    expect(w12PlanViolations(buildSteps())).toEqual([]);
    expect(dryRunCheck(loadPolicy()).ok).toBe(true);
    for (const a of plan) expect(String(a.toolAction ?? ""), JSON.stringify(a)).not.toMatch(/save|close|set$|buildRuntime/i);
    expect(plan.some((a) => a.kind === "uia-menu")).toBe(true);
    expect(validateQueue(buildQueue(), false).length).toBe(buildSteps().length);
  });

  it("the committed queue equals the emitted one", () => {
    expect(JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8"))).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });

  it("starts with the gate, the world before the World Editor walk, the summary after every walk, ends with net-zero and closable", () => {
    const ids = buildSteps().map((s) => s.id);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids.indexOf("w12-01-world")).toBeLessThan(ids.indexOf(WE_MENUS_STEP));
    for (const w of [WE_MENUS_STEP, RM_MENUS_STEP, STYLES_STEP]) expect(ids.indexOf(w)).toBeLessThan(ids.indexOf(DENY_STEP));
    expect(ids.slice(-2)).toEqual([NETZERO_STEP, CLOSABLE_STEP]);
  });

  it("the W12 plan check refuses a save, a path outside the throwaway folder, another plugin class, another walk and an overwrite", () => {
    const base = buildSteps()[1]!;
    const bad: StepDef = {
      ...base,
      id: "w12-bad",
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_World", tool: "wb_world", toolAction: "save", params: { action: "save" } } as never,
        { kind: "net-call", target: "EMCP_WB_Localization", tool: "wb_localization", toolAction: "open", params: { action: "open", path: "Language/x.st" } } as never,
        { kind: "net-call", target: "EMCP_WB_Plugin", tool: "wb_plugin", toolAction: "run", params: { action: "run", moduleName: "WorldEditor", className: "X" } } as never,
        { kind: "uia-menu", module: "ScriptEditor", calls: ["Expand", "Invoke"] } as never,
      ],
      offlineCalls: () => [{ tool: "string_table", params: { action: "create", path: "Language/x.st", overwrite: true } }],
      walks: () => [{ walker: "L02", module: "ScriptEditor", state: "none" }],
    };
    const v = w12PlanViolations([bad]).join("\n");
    expect(v).toMatch(/not an allowed wb_world action/);
    expect(v).toMatch(/path Language\/x\.st is outside/);
    expect(v).toMatch(/is not the W12 class/);
    expect(v).toMatch(/uia-menu on ScriptEditor/);
    expect(v).toMatch(/more than Expand and Collapse/);
    expect(v).toMatch(/overwrite/);
    expect(dryRunCheck(loadPolicy(), [...buildSteps(), bad]).ok).toBe(false);
  });

  it("names the LocLength row in a census: comment and lists the hand blocks", () => {
    const text = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    for (const r of new Set(buildSteps().flatMap((s) => s.rows))) expect(text).toContain(`census:${r}`);
    const ex = EXCLUDED.map((e) => e.what).join(" ");
    expect(ex).toMatch(/:confirm/);
    expect(ex).toMatch(/L05/);
    expect(ex).toMatch(/L04/);
  });

  it("the walk argv keeps the lane, the run folder and the state, and starts at the walker's first step", () => {
    const a = walkArgv(
      { walker: "L02", module: "ResourceManager", state: "mode=edit,selection=none" },
      { lane: { id: "L1" }, sandbox: "S", runDir: "R", build: "b", port: 5775, evidenceDir: null },
    );
    if ("refusal" in a) throw new Error(a.refusal);
    expect(a.script).toMatch(/L02-menus\.ts$/);
    expect(a.argv).toEqual(expect.arrayContaining(["--really", "--id", "L1", "--run-dir", "R", "--session", "W12", "--from"]));
    expect(arg(a.argv, "--state")).toBe("mode=edit,selection=none");
    const none = walkArgv(
      { walker: "L02", module: "ResourceManager.Texture", state: "none" },
      { lane: { id: "L1" }, sandbox: "S", runDir: "R", build: "b", port: 5775, evidenceDir: null },
    );
    expect("refusal" in none).toBe(true);
  });
});

// ── Deny-label matching ──────────────────────────────────────────────────────

describe("W12.1 deny labels", () => {
  it("matches exact, loose, variant and alias spellings", () => {
    expect(matchLabel("Pack Project", "Pack Project")).toBe("exact");
    expect(matchLabel("Pack Project", "&Pack Project...")).toBe("loose");
    expect(matchLabel("Login", "Login/Logout")).toBe("variant");
    expect(matchLabel("Create Terrain", "New Terrain...")).toBe("alias");
    expect(matchLabel("Login", "Log Viewer")).toBeNull();
  });

  it("records :confirm labels not observable and an exact hit as counting for --strict-labels", () => {
    const lines = [
      { file: "f", line: { dim: "ui", kind: "menu-item", module: "ResourceManager", key: { path: ["File", "Pack Project"] }, label_raw: "Pack Project" } },
    ];
    const obs = denyObservations(loadPolicy(), lines, ["ResourceManager menubar"]);
    const pack = obs.find((x) => x.label === "Pack Project")!;
    expect(pack.status).toBe("present");
    expect(pack.countsForStrictLabels).toBe(true);
    expect(pack.hits[0]!.path).toEqual(["File", "Pack Project"]);
    for (const c of obs.filter((x) => x.label.endsWith(":confirm"))) {
      expect(c.status).toBe("not-observable-without-invoking");
      expect(c.hits).toEqual([]);
    }
    expect(obs.find((x) => x.label === "Publish Project")!.status).toBe("absent-in-menus-read");
  });
});

// ── Runs on the fake ─────────────────────────────────────────────────────────

describe("W12 runs on a fake Workbench", () => {
  it("not the test bed: ABORTED at the gate, nothing sent", async () => {
    const o = opts("abort");
    const deps = fakeDeps(o, { info: { projectFound: 1, projectName: "Other" } });
    sandbox(o, deps);
    const r = await runBattery(buildSteps(), deps, o);
    expect(r.exit).toBe(EXIT.aborted);
    expect(record(o, GATE_STEP).status).toBe("ABORTED");
    expect(deps.sent).toEqual([]);
    expect(deps.walks).toEqual([]);
  });

  it("the full battery: walks inside the sitting, LocLength GATED is NOT-RUN with no live line, deny file written, net-zero", async () => {
    const o = opts("full");
    const deps = fakeDeps(o, {
      walkLines: {
        ResourceManager: [
          { dim: "ui", kind: "menu", module: "ResourceManager", key: { path: ["File"] }, label_raw: "File" },
          { dim: "ui", kind: "menu-item", module: "ResourceManager", key: { path: ["File", "Publish to Workshop"] }, label_raw: "Publish to Workshop..." },
        ],
      },
    });
    sandbox(o, deps);
    const r = await runBattery(buildSteps(), deps, o);
    expect(r.message).toBeNull();
    expect(r.exit).toBe(EXIT.done);
    for (const w of deps.walks) expect(norm(arg(w.argv, "--run-dir")).startsWith(norm(o.runDir) + "/walks/")).toBe(true);
    expect(deps.walks.map((w) => arg(w.argv, "--module"))).toEqual(["WorldEditor", "ResourceManager", "ResourceManager.Styles"]);
    const loc = record(o, LOCLENGTH_STEP);
    expect(loc.status).toBe("NOT-RUN");
    expect(String(loc.detail)).toMatch(/GATED/);
    expect(liveLines(o, LOCLENGTH_STEP)).toEqual([]);
    expect(deps.offlineSent.map(([t, a]) => [t, a.action, a.path])).toEqual([["string_table", "create", LOC_ST]]);
    expect(deps.sent.filter(([t]) => t === "wb_plugin").length).toBe(2);
    expect(deps.sent.some(([t, a]) => t === "wb_world" && a.action === "new" && a.path === WORLD)).toBe(true);
    const deny = JSON.parse(readFileSync(join(o.sittingDir, DENY_FILE), "utf-8")) as { labels: Array<{ label: string; status: string }> };
    expect(deny.labels.find((l) => l.label === "Publish to Workshop")!.status).toBe("present-other-spelling");
    expect(deny.labels.find((l) => l.label === "Login:confirm")!.status).toBe("not-observable-without-invoking");
    expect(record(o, NETZERO_STEP).status).toBe("PASS");
    expect(record(o, STYLES_STEP).status).toBe("PASS");
  });

  it("LocLength: a confirm that runs is a PASS with the live line naming the row", async () => {
    const o = opts("ran");
    const deps = fakeDeps(o, { confirm: { ok: true, readback: { ran: true } } });
    sandbox(o, deps);
    const r = await runBattery([buildSteps()[0]!, ...only(buildSteps(), LOCLENGTH_STEP)], deps, o);
    expect(r.exit).toBe(EXIT.done);
    expect(record(o, LOCLENGTH_STEP).status).toBe("PASS");
    const lines = liveLines(o, LOCLENGTH_STEP);
    expect(lines[0]).toMatchObject({ id: LOC_ROW, tests: [{ id: LOCLENGTH_STEP, file: SCRIPT_PATH, kind: "live" }] });
    expect(lines[1]).toMatchObject({ live_result: { test: LOCLENGTH_STEP, rows: [LOC_ROW], verdict: "pass", oracle: "returned-true-only" } });
  });

  it("LocLength: a table that does not open is a FAIL and no plugin call is sent", async () => {
    const o = opts("noopen");
    const deps = fakeDeps(o, { noOpen: true });
    sandbox(o, deps);
    await runBattery([buildSteps()[0]!, ...only(buildSteps(), LOCLENGTH_STEP)], deps, o);
    expect(record(o, LOCLENGTH_STEP).status).toBe("FAIL");
    expect(deps.sent.some(([t]) => t === "wb_plugin")).toBe(false);
  });

  it("LocLength: a dry run answering PRECONDITION_UNMET is NOT-RUN and the confirm is not sent", async () => {
    const o = opts("unmet");
    const deps = fakeDeps(o, { dry: { ok: false, code: "PRECONDITION_UNMET", message: "no string table" } });
    sandbox(o, deps);
    await runBattery([buildSteps()[0]!, ...only(buildSteps(), LOCLENGTH_STEP)], deps, o);
    expect(record(o, LOCLENGTH_STEP).status).toBe("NOT-RUN");
    expect(deps.sent.filter(([t, a]) => t === "wb_plugin" && a.confirm).length).toBe(0);
  });

  it("a walk that hands off stops the battery with exit 5", async () => {
    const o = opts("handoff");
    const deps = fakeDeps(o, { walkExit: { "ResourceManager.Styles": EXIT.handoff } });
    sandbox(o, deps);
    const r = await runBattery([buildSteps()[0]!, ...only(buildSteps(), STYLES_STEP)], deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(record(o, STYLES_STEP).status).toBe("HANDOFF");
  });

  // W12 run 1 (1.9.0.37): the WidgetStyle title was on the menubar, Expand opened no popup, the walker exited 0
  // with no obs file. That is the menu unread (NOT-RUN), not a walker failure.
  const W12_RUN1_MENUS = (titles: string[]): Raw => ({
    schema: "emcp-uia-menus/1",
    menus: [{ title: "WidgetStyle", opened: false, collapsed: true, items: [], popup: { count: 0 } }],
    menu_bar_titles: titles,
    result: "ok",
  });
  const RM_TITLES = ["File", "Editors", "View", "Edit", "Window", "Utilities", "Plugins", "Help"];

  it("Styles: the WidgetStyle title present but its popup not opening is NOT-RUN, with the walker's reading", async () => {
    const o = opts("stylesnopopup");
    const deps = fakeDeps(o, {
      walkLines: { "ResourceManager.Styles": [] },
      walkMenus: {
        "ResourceManager.Styles": {
          menus: W12_RUN1_MENUS([...RM_TITLES, "WidgetStyle"]),
          record: { status: "fail", summary: "WidgetStyle: no item read inside the popup (popups 0);" },
        },
      },
    });
    sandbox(o, deps);
    const r = await runBattery([buildSteps()[0]!, ...only(buildSteps(), STYLES_STEP)], deps, o);
    expect(r.exit).toBe(EXIT.done);
    const rec = record(o, STYLES_STEP);
    expect(rec.status).toBe("NOT-RUN");
    expect(String(rec.detail)).toMatch(/title is on the Resource Manager menubar.*popups 0/);
    expect((rec.evidence as Raw).menuRead).toMatchObject({
      titleOnMenubar: true,
      opened: false,
      popups: 0,
      walkerSummary: "WidgetStyle: no item read inside the popup (popups 0);",
    });
  });

  it("Styles: no WidgetStyle title on the menubar the walker read is a FAIL naming setResource", async () => {
    const o = opts("stylesnotitle");
    const deps = fakeDeps(o, {
      walkLines: { "ResourceManager.Styles": [] },
      walkMenus: { "ResourceManager.Styles": { menus: { ...W12_RUN1_MENUS(RM_TITLES), menus: [] } } },
    });
    sandbox(o, deps);
    await runBattery([buildSteps()[0]!, ...only(buildSteps(), STYLES_STEP)], deps, o);
    const rec = record(o, STYLES_STEP);
    expect(rec.status).toBe("FAIL");
    expect(String(rec.detail)).toMatch(/no WidgetStyle title on the menubar.*setResource/);
  });

  it("Styles: a walk with no obs file and no menus file stays a FAIL", async () => {
    const o = opts("stylesnothing");
    const deps = fakeDeps(o, { walkLines: { "ResourceManager.Styles": [] } });
    sandbox(o, deps);
    await runBattery([buildSteps()[0]!, ...only(buildSteps(), STYLES_STEP)], deps, o);
    const rec = record(o, STYLES_STEP);
    expect(rec.status).toBe("FAIL");
    expect(String(rec.detail)).toMatch(/wrote no observation line/);
  });

  it("the Styles step without the planted copy is NOT-RUN and walks nothing", async () => {
    const o = opts("nostyles");
    const deps = fakeDeps(o);
    sandbox(o, deps, false);
    await runBattery([buildSteps()[0]!, ...only(buildSteps(), STYLES_STEP)], deps, o);
    expect(record(o, STYLES_STEP).status).toBe("NOT-RUN");
    expect(deps.walks).toEqual([]);
  });

  it("a step never runs twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    const steps = [buildSteps()[0]!];
    await runBattery(steps, deps, o);
    const r = await runBattery(steps, deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });

  it("main without --really is the dry run and exits 0", async () => {
    const out: string[] = [];
    expect(await main([], { out: (l) => out.push(l) })).toBe(EXIT.done);
    expect(out.join("\n")).toMatch(/W12 plan check: PASS/);
  });
});

// ── Plant and rollback ───────────────────────────────────────────────────────

function fakeIo(pids: number[] = []): OfflineIo & { files: Map<string, Buffer>; removed: string[] } {
  const files = new Map<string, Buffer>();
  const removed: string[] = [];
  return {
    files,
    removed,
    workbenchPids: () => pids,
    exists: (p) => [...files.keys()].some((k) => k === norm(p) || k.startsWith(norm(p) + "/")),
    listDir: (p) => [...files.keys()].filter((k) => k.startsWith(norm(p) + "/")).map((k) => k.slice(norm(p).length + 1).split("/")[0]!),
    listTree: (p) => [...files.keys()].filter((k) => k.startsWith(norm(p) + "/")).map((k) => k.slice(norm(p).length + 1)),
    readBytes: (p) => files.get(norm(p)) ?? Buffer.alloc(0),
    writeBytes: (p, b) => files.set(norm(p), b),
    removeTree: (p) => {
      removed.push(norm(p));
      for (const k of [...files.keys()]) if (k === norm(p) || k.startsWith(norm(p) + "/")) files.delete(k);
    },
    makeDir: (p) => files.set(norm(p) + "/.dir", Buffer.alloc(0)),
    readVanilla: async () => Buffer.from("WidgetStyles {}"),
    log: () => undefined,
  };
}

describe("W12 plant and rollback", () => {
  it("plants the folders and the Styles copy, refuses while Workbench runs, and rolls back with a listing", async () => {
    const sb = join(TMP, "plant", SANDBOX_NAME);
    const sit = join(TMP, "plant", "sitting");
    expect(await runPlant(sb, sit, true, fakeIo([42]))).toBe(EXIT.refused);
    const io = fakeIo();
    expect(await runPlant(sb, sit, true, io)).toBe(EXIT.done);
    for (const s of plantSources()) expect(io.files.has(norm(join(sb, ...s.rel.split("/"))))).toBe(true);
    expect(io.files.has(norm(join(sit, PLANT_FILE)))).toBe(true);
    expect(await runPlant(sb, sit, true, io)).toBe(EXIT.refused);
    expect(runRollback(sb, sit, true, io)).toBe(EXIT.done);
    expect(io.removed[0]).toBe(norm(join(sb, ...W12_ROOT.split("/"))));
    expect(io.files.has(norm(join(sit, "throwaway-w12-listing.json")))).toBe(true);
  });
});
