import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { allowListOf, loadCatalog } from "../../src/tools/wb-plugin.js";
import {
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  EXIT,
  GATE_STEP,
  LAUNCH_ARGS,
  NETZERO_STEP,
  NOISE_REL,
  PLANT_DIRS,
  PLANT_FILE,
  RUNSET_STEP,
  RUN_LIST_KEY,
  SCRIPT_PATH,
  W10_ROOT,
  WORLD,
  WORLD_STEP,
  buildActionPlan,
  buildQueue,
  buildSteps,
  dryRunCheck,
  liveFileOf,
  loadRunSet,
  main,
  pluginStepId,
  recordPath,
  runBattery,
  runPlant,
  runRollback,
  runSetOf,
  selectSteps,
  w10PlanViolations,
  type LogEntry,
  type OfflineIo,
  type RunSet,
  type StepDef,
  type ToolResponse,
  type W10Deps,
  type W10Options,
  type W10Tool,
} from "../live/w10.live.js";

type Raw = Record<string, unknown>;

const TMP = mkdtempSync(join(tmpdir(), "emcp-w10-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 1010;
const norm = (p: string): string => p.replace(/\\/g, "/");

/** The (a) set proposed in the plugin safety review, as main would rule it in. */
const PROPOSED: Array<[string, string]> = [
  ["WorldEditor", "CameraOrientationTool"],
  ["ResourceManager", "SCR_CheckRuinModelsAndUsagePlugin"],
  ["LocalizationEditor", "SCR_LocLengthPlugin"],
  ["LocalizationEditor", "SCR_LocStatusPlugin"],
];
const policyWith = (list: unknown[]): Raw => ({ [RUN_LIST_KEY]: { allow_list: list } });
const catalog = loadCatalog();
const proposedSet = (): RunSet => runSetOf(policyWith(PROPOSED), catalog);

interface Sim {
  /** The confirm's answer per class (default: ok, ran). */
  confirm?: Record<string, ToolResponse>;
  /** The dry run's answer per class (default: ok, not ran). */
  dry?: Record<string, ToolResponse>;
  /** Log lines a confirmed run prints, per class. */
  prints?: Record<string, string[]>;
  /** A confirmed run of this class moves the camera. */
  movesCamera?: Set<string>;
  /** setCamera does not put the camera back. */
  stuckCamera?: boolean;
  /** A confirmed run of this class writes this sandbox file. */
  writes?: Record<string, string>;
}

function fakeDeps(
  o: W10Options,
  sim: Sim = {},
  over: { windows?: WindowInfo[] } = {},
): W10Deps & { files: Map<string, Buffer>; dirs: Set<string>; sent: Array<[string, Raw]> } {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const sent: Array<[string, Raw]> = [];
  const log: LogEntry[] = [{ raw: "boot" }];
  let camera = "0 400 0";
  let selection: string[] = [];
  const tool = (name: W10Tool, args: Raw): ToolResponse => {
    if (name === "wb_plugin") {
      const cls = String(args.className);
      if (!args.confirm) return sim.dry?.[cls] ?? { ok: true, readback: { ran: false } };
      const answer = sim.confirm?.[cls] ?? { ok: true, readback: { ran: true } };
      if (answer.ok) {
        for (const l of sim.prints?.[cls] ?? []) log.push({ raw: l });
        if (sim.movesCamera?.has(cls)) camera = "0 0 0";
        const w = sim.writes?.[cls];
        if (w) files.set(norm(join(o.sandboxDir, w)), Buffer.from("changed"));
      }
      return answer;
    }
    if (name === "wb_view") {
      if (args.action === "selection")
        return { ok: true, readback: { rows: selection.map((id) => ({ id })) } };
      if (args.action === "select") {
        selection = args.mode === "clear" ? [] : (args.entities as string[]).map(String);
        return { ok: true, readback: { selectedCount: selection.length } };
      }
      if (args.action === "camera")
        return { ok: true, readback: { coords: camera, direction: "0 0 1" } };
      if (args.action === "setCamera") {
        if (!sim.stuckCamera) camera = String(args.coords);
        return { ok: true, readback: {} };
      }
    }
    if (name === "wb_world" && args.action === "state")
      return { ok: true, readback: { mode: "edit", worldPath: WORLD } };
    return { ok: true, readback: {} };
  };
  return {
    files,
    dirs,
    sent,
    tool: async (name, args) => {
      sent.push([name, args]);
      return tool(name, args);
    },
    info: async () => ({ projectFound: 1, projectName: SANDBOX_NAME }),
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async () => over.windows ?? [],
    recordedPid: () => PID,
    commandLine: async () => "",
    logLines: () => [...log],
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

function opts(name: string): W10Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W10Options["ph"],
    build: "test",
  };
}

function only(steps: StepDef[], id: string): StepDef[] {
  const s = selectSteps(steps as never, { only: id }) as StepDef[] | string;
  if (typeof s === "string") throw new Error(s);
  return s;
}

function record(o: W10Options, step: string): Raw {
  return JSON.parse(readFileSync(recordPath(o.runDir, step), "utf-8")) as Raw;
}

function liveLines(o: W10Options, step: string): Raw[] {
  const p = join(o.sittingDir, liveFileOf(step));
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Raw);
}

/** A sandbox with one project file and the world on disk. */
function sandbox(o: W10Options, deps: ReturnType<typeof fakeDeps>): void {
  deps.files.set(norm(join(o.sandboxDir, "addon.gproj")), Buffer.from("gproj"));
  deps.files.set(norm(join(o.sandboxDir, ...WORLD.split("/"))), Buffer.from("world"));
}

async function runOne(name: string, cls: string, sim: Sim = {}, w: WindowInfo[] = []) {
  const set = proposedSet();
  const steps = buildSteps(set);
  const i = set.runs.findIndex((r) => r.className === cls);
  const id = pluginStepId(set.runs[i]!, i);
  const o = opts(name);
  const deps = fakeDeps(o, sim, { windows: w });
  sandbox(o, deps);
  const r = await runBattery(only(steps, id), deps, o, steps);
  return { r, o, deps, id, rec: record(o, id), lines: liveLines(o, id) };
}

// ── Offline: run set, plan, queue ────────────────────────────────────────────

describe("W10 run set, plan and queue", () => {
  it("reads its run set from the policy allow-list: exactly the three DEC-103 classes, one step each", () => {
    const DEC103: Array<[string, string]> = [
      ["WorldEditor", "CameraOrientationTool"],
      ["LocalizationEditor", "SCR_LocLengthPlugin"],
      ["ResourceManager", "SCR_CheckRuinModelsAndUsagePlugin"],
    ];
    expect(allowListOf(loadPolicy(), RUN_LIST_KEY)).toEqual(
      DEC103.map(([module, className]) => ({ module, className })),
    );
    const set = loadRunSet();
    expect(set.refused).toEqual([]);
    expect(set.runs.map((r) => [r.module, r.className])).toEqual(DEC103);
    expect(set.runs.map((r) => r.rowId)).toEqual(DEC103.map(([, c]) => `plugin:${c}`));
    const ids = buildSteps().map((s) => s.id);
    expect(ids).toEqual([
      GATE_STEP,
      WORLD_STEP,
      RUNSET_STEP,
      ...set.runs.map(pluginStepId),
      NETZERO_STEP,
      CLOSABLE_STEP,
    ]);
    const runs = buildActionPlan().filter((a) => a.tool === "wb_plugin");
    expect(runs, "two plugin calls per class").toHaveLength(DEC103.length * 2);
    for (const a of runs)
      expect(DEC103.map(([, c]) => c)).toContain(String((a.params as Raw).className));
  });

  it("joins the proposed (a) set to the catalog, one step each, between the run set and net-zero", () => {
    const set = proposedSet();
    expect(set.refused).toEqual([]);
    expect(set.runs.map((r) => r.rowId)).toEqual(PROPOSED.map(([, c]) => `plugin:${c}`));
    const ids = buildSteps(set).map((s) => s.id);
    expect(ids.slice(3, 7)).toEqual(set.runs.map(pluginStepId));
    expect(ids.slice(-2)).toEqual([NETZERO_STEP, CLOSABLE_STEP]);
  });

  it("refuses a modal class, an unknown class and a module mismatch; the plan check fails on them", () => {
    const modal = catalog.find((c) => c.modal === "opens")!;
    const set = runSetOf(
      policyWith([
        [modal.module, modal.className],
        ["WorldEditor", "NoSuchPlugin"],
        ["ScriptEditor", "CameraOrientationTool"],
        ["WorldEditor", "CameraOrientationTool"],
        ["bad"],
      ]),
      catalog,
    );
    expect(set.runs.map((r) => r.className)).toEqual(["CameraOrientationTool"]);
    expect(set.refused.map((r) => r.why)).toEqual([
      "E03 marks the class modal (PLUGIN_MODAL)",
      "no E03 catalog row of that class",
      "the catalog puts the class in WorldEditor",
    ]);
    const v = w10PlanViolations(buildActionPlan(buildSteps(set)), set);
    expect(v).toHaveLength(3);
    expect(dryRunCheck(loadPolicy(), set).ok).toBe(false);
  });

  it("the proposed plan passes checkPlan and the W10 plan check; it never saves, closes or runs off the set", () => {
    const set = proposedSet();
    const plan = buildActionPlan(buildSteps(set));
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT_PATH }).ok).toBe(true);
    expect(w10PlanViolations(plan, set)).toEqual([]);
    expect(dryRunCheck(loadPolicy(), set).ok).toBe(true);
    for (const a of plan)
      expect(String(a.toolAction ?? ""), JSON.stringify(a)).not.toMatch(/save|close/i);
    // every wb_plugin call is a run of a class of the set, never RunCommandline or Configure
    const runs = plan.filter((a) => a.tool === "wb_plugin");
    expect(runs).toHaveLength(set.runs.length * 2);
    const bad = [
      ...plan,
      {
        kind: "net-call",
        tool: "wb_plugin",
        toolAction: "run",
        params: { moduleName: "WorldEditor", className: "SCR_WrapEntitiesPlugin", confirm: true },
      },
      { kind: "net-call", tool: "wb_module", toolAction: "save", params: { action: "save" } },
      { kind: "net-call", tool: "wb_world", toolAction: "new", params: { path: "worlds/x.ent" } },
    ];
    const v = w10PlanViolations(bad as never, set).join("\n");
    expect(v).toMatch(/SCR_WrapEntitiesPlugin is not in the run set/);
    expect(v).toMatch(/not an allowed wb_module action/);
    expect(v).toMatch(/writes outside _throwaway\/W10\//);
  });

  it("the dry run passes and the committed queue is what the step table emits (three-class run set)", async () => {
    expect(dryRunCheck(loadPolicy()).ok).toBe(true);
    const committed = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildQueue())));
    expect(validateQueue(buildQueue(), false)).toHaveLength(buildSteps().length);
    expect((buildQueue() as { launch_args: string[] }).launch_args).toEqual([...LAUNCH_ARGS]);
    const out: string[] = [];
    expect(await main([], { out: (l) => out.push(l) })).toBe(EXIT.done);
    expect(out.join("\n")).toMatch(/W10 plan check: PASS/);
    expect(out.join("\n")).toContain(
      "run set (plugin_run_allow_list): WorldEditor/CameraOrientationTool, LocalizationEditor/SCR_LocLengthPlugin, ResourceManager/SCR_CheckRuinModelsAndUsagePlugin",
    );
    const noise = JSON.parse(readFileSync(join(REPO_ROOT, ...NOISE_REL.split("/")), "utf-8")) as {
      expected_noise: string[];
    };
    expect(noise.expected_noise).toEqual(["resourceDatabase.rdb", `${W10_ROOT}/**`]);
  });

  it("names each proposed class as census:<row> in the battery file", () => {
    const text = readFileSync(join(REPO_ROOT, ...SCRIPT_PATH.split("/")), "utf-8");
    for (const r of proposedSet().runs) expect(text, r.rowId).toContain(`// census:${r.rowId}\n`);
  });
});

// ── The plugin step against a simulated Workbench ────────────────────────────

describe("W10 plugin step", () => {
  it("a log report that ran with new lines, no dialog and the sandbox unchanged writes a log-line result", async () => {
    const { r, rec, lines, id } = await runOne("ruin", "SCR_CheckRuinModelsAndUsagePlugin", {
      prints: { SCR_CheckRuinModelsAndUsagePlugin: ["Total _Ruin Prefabs: 3"] },
    });
    expect(r.exit).toBe(EXIT.done);
    expect(rec.status).toBe("PASS");
    const ev = rec.evidence as Raw;
    expect((ev.result as Raw).logNew).toBe(1);
    expect(ev.logLines).toEqual(["Total _Ruin Prefabs: 3"]);
    expect(lines).toEqual([
      {
        id: "plugin:SCR_CheckRuinModelsAndUsagePlugin",
        tests: [{ id, file: SCRIPT_PATH, kind: "live" }],
      },
      expect.objectContaining({
        live_result: expect.objectContaining({
          test: id,
          rows: ["plugin:SCR_CheckRuinModelsAndUsagePlugin"],
          oracle: "log-line",
          verdict: "pass",
        }),
      }),
    ]);
  });

  it("a log report that printed nothing is NO-EFFECT: recorded, no live result", async () => {
    const { rec, lines } = await runOne("ruin0", "SCR_CheckRuinModelsAndUsagePlugin");
    expect(rec.status).toBe("PASS");
    expect(((rec.evidence as Raw).result as Raw).verdict).toBe("NO-EFFECT");
    expect(lines).toEqual([]);
  });

  it("GATED (RunProven off) and PRECONDITION_UNMET are NOT-RUN with no live result", async () => {
    const g = await runOne("gated", "SCR_LocLengthPlugin", {
      confirm: { SCR_LocLengthPlugin: { ok: false, code: "GATED", message: "P-W6-05" } },
    });
    expect(g.rec.status).toBe("NOT-RUN");
    expect(g.rec.detail).toMatch(/confirm answered GATED/);
    expect(g.lines).toEqual([]);
    const p = await runOne("unmet", "SCR_LocStatusPlugin", {
      dry: { SCR_LocStatusPlugin: { ok: false, code: "PRECONDITION_UNMET", message: "no table" } },
    });
    expect(p.rec.status).toBe("NOT-RUN");
    expect(p.deps.sent.filter(([n, a]) => n === "wb_plugin" && a.confirm)).toEqual([]);
  });

  it("PLUGIN_MODAL or a dry run that ran is a FAIL", async () => {
    const m = await runOne("modal", "SCR_LocLengthPlugin", {
      dry: { SCR_LocLengthPlugin: { ok: false, code: "PLUGIN_MODAL", message: "opens a dialog" } },
    });
    expect(m.rec.status).toBe("FAIL");
    expect(m.lines).toEqual([]);
    const d = await runOne("dryran", "SCR_LocLengthPlugin", {
      dry: { SCR_LocLengthPlugin: { ok: true, readback: { ran: true } } },
    });
    expect(d.rec.status).toBe("FAIL");
    expect(d.rec.detail).toMatch(/dry run ran/);
  });

  it("a run that changes a sandbox file is a FAIL with no live result", async () => {
    const { rec, lines } = await runOne("write", "SCR_LocStatusPlugin", {
      writes: { SCR_LocStatusPlugin: "Language/strings.st" },
    });
    expect(rec.status).toBe("FAIL");
    expect(rec.detail).toMatch(
      /changed outside _throwaway\/W10\/ after the run: Language\/strings\.st/,
    );
    expect(lines).toEqual([]);
  });

  it("an answer-only class that ran cleanly writes a returned-true-only result", async () => {
    const { rec, lines } = await runOne("status", "SCR_LocStatusPlugin");
    expect(rec.status).toBe("PASS");
    expect((lines[1]!.live_result as Raw).oracle).toBe("returned-true-only");
  });

  it("the camera class: one entity selected, the camera move read and put back, the selection restored", async () => {
    const { rec, lines, deps } = await runOne("cam", "CameraOrientationTool", {
      movesCamera: new Set(["CameraOrientationTool"]),
    });
    expect(rec.status).toBe("PASS");
    expect((lines[1]!.live_result as Raw).oracle).toBe("state-readback");
    const views = deps.sent.filter(([n]) => n === "wb_view").map(([, a]) => String(a.action));
    expect(views).toContain("setCamera");
    const sel = deps.sent.filter(([n, a]) => n === "wb_view" && a.action === "select");
    expect(sel[0]![1]).toEqual({ action: "select", mode: "set", entities: ["index:0"] });
    expect(sel[sel.length - 1]![1]).toEqual({ action: "select", mode: "clear" });
    const stuck = await runOne("camstuck", "CameraOrientationTool", {
      movesCamera: new Set(["CameraOrientationTool"]),
      stuckCamera: true,
    });
    expect(stuck.rec.status).toBe("FAIL");
    expect(stuck.lines).toEqual([]);
    const still = await runOne("camstill", "CameraOrientationTool");
    expect(((still.rec.evidence as Raw).result as Raw).verdict).toBe("NO-EFFECT");
    expect(still.lines).toEqual([]);
  });

  it("a dialog after the run is a HANDOFF with no live result", async () => {
    const dialog: WindowInfo = {
      hwnd: 7,
      pid: PID,
      className: "#32770",
      title: "Error",
      owner: 1,
      enabled: true,
      rect: [0, 0, 10, 10],
      monitor: [0, 0, 100, 100],
      primary: true,
    };
    const { r, rec, lines } = await runOne("dlg", "SCR_LocStatusPlugin", {}, [dialog]);
    expect(r.exit).toBe(EXIT.handoff);
    expect(rec.status).toBe("HANDOFF");
    expect(lines).toEqual([]);
  });

  it("the run-set step records an empty list as a PASS that drives nothing", async () => {
    const o = opts("runset");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    const steps = buildSteps({ runs: [], refused: [] });
    const r = await runBattery(only(steps, RUNSET_STEP), deps, o, steps);
    expect(r.exit).toBe(EXIT.done);
    expect(record(o, RUNSET_STEP).detail).toMatch(/is empty: no plugin is driven/);
    expect(deps.sent).toEqual([]);
  });
});

// ── Offline subcommands ──────────────────────────────────────────────────────

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
    listTree: () => ["worlds/EMCP_W10_Tiny.ent"],
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

describe("W10 plant and rollback", () => {
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

  it("rollback removes _throwaway/W10/ only, offline only", () => {
    const io = fakeIo();
    io.present.add(norm(join(sb, ...W10_ROOT.split("/"))));
    expect(runRollback(sb, sit, true, { ...io, workbenchPids: () => [7] })).toBe(EXIT.refused);
    expect(runRollback(sb, sit, true, io)).toBe(EXIT.done);
    expect(io.removed[0]).toBe(norm(join(sb, ...W10_ROOT.split("/"))));
  });
});
