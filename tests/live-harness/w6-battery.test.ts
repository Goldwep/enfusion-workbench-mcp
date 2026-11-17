import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { BUSY_GRACE_MS } from "../../scripts/census/live/common.js";
import { WATCH_OPTIONS as W2_WATCH_OPTIONS } from "../live/w2.live.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  loadAllowList,
  loadCatalog,
  loadRunAllowList,
  runPlugin,
} from "../../src/tools/wb-plugin.js";
import { runShape } from "../../src/tools/wb-shape.js";
import { TS_ACTIONS as WORLD_TOOLS_TS_ACTIONS } from "../../src/tools/wb-world-tools.js";
import {
  BATTERY_SNAPSHOT_FILE,
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  EXIT,
  FILE_WRITE_ACTIONS,
  GATE_STEP,
  HAND_STEP,
  INDEPENDENT_BLOCKS,
  LAUNCH_ARGS,
  MODAL_CLASS,
  NETZERO_STEP,
  NOT_EXERCISED,
  NOT_TESTABLE,
  PLANTED,
  PLANT_DIRS,
  PLANT_FILE,
  PROBE_IDS,
  RUN_CLASSES,
  SCRIPT_PATH,
  TS_ONLY_ACTIONS,
  UNLISTED_CLASS,
  W6_CONTRACTS,
  W6_ROOT,
  buildActionPlan,
  buildQueue,
  buildSteps,
  clipboardSnapOf,
  flagsReadOf,
  flagsVerdict,
  restoreClipboard,
  sameClipboard,
  type ClipboardSnap,
  dryRunCheck,
  exercisedBy,
  failUnitOf,
  handAnswer,
  handFiles,
  main,
  missingWorldRefusal,
  netZeroDiff,
  offlinePlan,
  offlineProofs,
  plantBytes,
  runBattery,
  runPlant,
  runProbe,
  runRollback,
  sameImportRow,
  selectSteps,
  type OfflineIo,
  type ToolResponse,
  type W6Deps,
  type W6Options,
  type W6Tool,
} from "../live/w6.live.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-w6-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 4242;

type Raw = Record<string, unknown>;

function contractActions(handler: string): string[] {
  const c = JSON.parse(readFileSync(join(REPO_ROOT, "contracts", `${handler}.json`), "utf-8")) as {
    actions: Array<{ name?: string; action?: string }>;
  };
  return c.actions.map((a) => String(a.name ?? a.action));
}

const under = (p: string): boolean => p.replace(/\\/g, "/").startsWith(`${W6_ROOT}/`);

describe("W6 battery: the dry-run gate", () => {
  it("the action plan passes checkPlan and the queue validates", () => {
    const r = checkPlan(buildActionPlan(), policy, { script: SCRIPT_PATH });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(dryRunCheck(policy).ok).toBe(true);
    expect(() => validateQueue(buildQueue(), false)).not.toThrow();
  });

  it("the default (no --really) is a dry run that exits 0", async () => {
    const lines: string[] = [];
    const code = await main([], { out: (l) => lines.push(l), policy });
    expect(code).toBe(EXIT.done);
    expect(lines.join("\n")).toMatch(/PASS/);
  });

  it("the queue file equals the generated queue", () => {
    expect(existsSync(DEFAULT_QUEUE)).toBe(true);
    const onDisk = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });

  it("the launch carries the sandbox, the scratch profile and -scriptAuthorizeAll, no probe pack", () => {
    expect(LAUNCH_ARGS).toContain("-scriptAuthorizeAll");
    expect(LAUNCH_ARGS.join(" ")).toContain(`${SANDBOX_NAME}.gproj`);
    expect(LAUNCH_ARGS.join(" ")).toContain("w6-scratch.ini");
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("step ids are unique, w6-NN-..., the gate first and the closable step last", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w6-\d\d-[a-z0-9-]+$/);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids[ids.length - 1]).toBe(CLOSABLE_STEP);
    for (const s of steps) {
      expect(s.expected.length, s.id).toBeGreaterThan(10);
      expect(s.kill_criterion.length, s.id).toBeGreaterThan(5);
    }
  });

  it("the hand steps are one block at the end, before only the net-zero and closable steps", () => {
    const steps = buildSteps();
    const hand = steps.map((s, i) => (s.hand ? i : -1)).filter((i) => i >= 0);
    expect(hand.length).toBeGreaterThan(0);
    expect(steps[hand[0]!]!.id).toBe(HAND_STEP);
    for (let k = 1; k < hand.length; k++) expect(hand[k]).toBe(hand[k - 1]! + 1);
    expect(steps.slice(hand[hand.length - 1]! + 1).map((s) => s.id)).toEqual([
      NETZERO_STEP,
      CLOSABLE_STEP,
    ]);
    for (const i of hand) expect(steps[i]!.block).toBe("W6.8");
  });

  it("the test-bed check lives in the battery, never in a shipped handler or tool", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    expect(src).toContain('"aborted"');
    expect(src).toContain("projectName !== SANDBOX_NAME");
    for (const dir of ["src/tools", "mod/Scripts/WorkbenchGame/EnfusionMCP"]) {
      const walk = (d: string): string[] =>
        readdirSync(join(REPO_ROOT, d), { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
        );
      for (const f of walk(dir))
        expect(readFileSync(join(REPO_ROOT, f), "utf-8"), f).not.toContain("EMCP2_sandbox");
    }
  });
});

describe("W6 battery: coverage", () => {
  const steps = buildSteps();
  const exercised = new Set(steps.flatMap(exercisedBy));

  it("every action of the three W6 contracts is exercised or in NOT_EXERCISED with a reason", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W6_CONTRACTS)) {
      const actions = contractActions(handler);
      expect(actions.length, handler).toBeGreaterThan(0);
      for (const a of actions) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
    for (const reason of Object.values(NOT_EXERCISED)) expect(reason.length).toBeGreaterThan(10);
    for (const key of Object.keys(NOT_EXERCISED)) expect(exercised.has(key), key).toBe(false);
  });

  it("every TS-only action of the wave's tools is exercised or in NOT_EXERCISED", () => {
    const missing: string[] = [];
    for (const [tool, actions] of Object.entries(TS_ONLY_ACTIONS))
      for (const a of actions) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    expect(missing).toEqual([]);
  });

  it("the TS-only lists match the tools' own action lists", () => {
    expect([...TS_ONLY_ACTIONS.wb_world_tools!]).toEqual([...WORLD_TOOLS_TS_ACTIONS]);
    const plugin = readFileSync(join(REPO_ROOT, "src/tools/wb-plugin.ts"), "utf-8");
    expect(plugin).toContain('"list"');
    const shape = readFileSync(join(REPO_ROOT, "src/tools/wb-shape.ts"), "utf-8");
    for (const a of TS_ONLY_ACTIONS.wb_shape!) expect(shape, a).toContain(`"${a}"`);
    const sc = readFileSync(join(REPO_ROOT, "src/tools/script-create.ts"), "utf-8");
    expect(sc).toContain('"plugin"');
    const cli = readFileSync(join(REPO_ROOT, "src/tools/wb-cli-run.ts"), "utf-8");
    expect(cli).toContain('"plugin"');
  });

  it("the 13 run classes are the plugin_run classes of spec 2.1.1, each driven by a W6.3 or W6.4 step", () => {
    expect(RUN_CLASSES).toHaveLength(13);
    const catalog = loadCatalog();
    for (const c of RUN_CLASSES) {
      const row = catalog.find((r) => r.className === c.className);
      expect(row, c.className).toBeDefined();
      expect(row!.module, c.className).toBe(c.module);
      expect(row!.modal, c.className).not.toBe("opens");
    }
    const runs = buildActionPlan()
      .filter((a) => (a as Raw).tool === "wb_plugin" && (a as Raw).toolAction === "run")
      .map((a) => String(((a as Raw).params as Raw).className));
    for (const c of RUN_CLASSES) expect(runs, c.className).toContain(c.className);
  });

  it("every probe P-W6-01..18 is assigned to a step or listed as not testable with a reason", () => {
    expect(PROBE_IDS).toHaveLength(18);
    const assigned = new Set(steps.flatMap((s) => s.probes));
    for (const id of PROBE_IDS) {
      const ok = assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10;
      expect(ok, id).toBe(true);
    }
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of steps) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
  });

  it("every probe of the inbox file is one of P-W6-01..18", () => {
    const lines = readFileSync(join(REPO_ROOT, "docs/v2/inbox/w6/probes.jsonl"), "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    const ids = lines.map((l) => String((JSON.parse(l) as Raw).id));
    expect([...ids].sort()).toEqual([...PROBE_IDS].sort());
  });

  it("each offline tool of the wave has an engine-accept step that hands Workbench its fixture", () => {
    const plan = buildActionPlan() as Array<Raw & { params?: Raw }>;
    const has = (step: string, tool: string, action: string): boolean =>
      plan.some((a) => a.step === step && a.tool === tool && a.toolAction === action);
    // The CSV codec: importObjects of the planted CSV, then exportObjects of what it made.
    expect(has("w6-21-import-csv", "wb_world_tools", "importObjects")).toBe(true);
    expect(has("w6-21-import-csv", "wb_world_tools", "exportObjects")).toBe(true);
    // The area maths and the shapefile reader: shapes made, their points read back.
    expect(has("w6-25-shape-area", "wb_shape", "area")).toBe(true);
    expect(has("w6-25-shape-area", "wb_shape", "points")).toBe(true);
    expect(has("w6-26-shape-import", "wb_shape", "import")).toBe(true);
    expect(has("w6-26-shape-import", "wb_shape", "points")).toBe(true);
    // The coords parser: goToCoords, the camera read back.
    expect(has("w6-43-goto", "wb_world_tools", "goToCoords")).toBe(true);
    expect(has("w6-43-goto", "wb_view", "camera")).toBe(true);
    // The plugin template: opened in the Script Editor (its owner module) and read back.
    expect(has("w6-31-run-script", "wb_script_editor", "open")).toBe(true);
    expect(has("w6-31-run-script", "wb_script_editor", "getLines")).toBe(true);
  });
});

describe("W6 battery: writes stay under _throwaway/W6/", () => {
  const steps = buildSteps();

  it("every declared write lies under _throwaway/W6/", () => {
    for (const s of steps) for (const w of s.writes) expect(under(w), `${s.id} ${w}`).toBe(true);
  });

  it("every file-writing tool call in the plan names a file under _throwaway/W6/", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (!FILE_WRITE_ACTIONS.has(key)) continue;
      const p = a.params ?? {};
      const files = ["path", "paths", "to"]
        .flatMap((k) => (Array.isArray(p[k]) ? (p[k] as unknown[]) : [p[k]]))
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.replace(/^path:/, ""));
      expect(files.length, `${String(a.step)} ${key}`).toBeGreaterThan(0);
      for (const v of files) expect(under(v), `${String(a.step)} ${key} ${v}`).toBe(true);
    }
  });

  it("no plan entry saves, calls a denied API or sends a confirmed setSettings other than the no-op", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      if (a.kind !== "net-call") continue;
      expect(String(a.target)).not.toMatch(/RunCommandline|Workbench\.(Exit|RunCmd|RunProcess)/);
      expect(String(a.target)).not.toBe("EMCP_WB_Save");
      expect(a.params?.action, String(a.step)).not.toBe("save");
      if (a.toolAction === "setSettings" && a.params?.confirm === true)
        expect(String(a.params.value)).toContain("the value it holds");
    }
  });

  it("offline calls only read (nothing they name is written)", () => {
    for (const c of offlinePlan(steps)) {
      expect(c.params.confirm, `${c.step} ${c.tool}.${c.action}`).not.toBe(true);
      const p = c.params.path;
      if (typeof p === "string") expect(under(p), `${c.step} ${p}`).toBe(true);
    }
  });

  it("the plant writes only under _throwaway/W6/ and its bytes are the fixtures", () => {
    for (const p of [...PLANTED, ...PLANT_DIRS]) expect(under(p), p).toBe(true);
    expect(Object.keys(plantBytes()).sort()).toEqual([...PLANTED].sort());
  });

  it("wb_shape parallel is GATED before sending (no parallelOpen override is ever passed)", async () => {
    const sent: unknown[] = [];
    const client = {
      call: async (...a: unknown[]) => {
        sent.push(a);
        throw new Error("nothing may be sent");
      },
    };
    const r = (await runShape(
      client as never,
      { action: "parallel", entity: "name:W6_Line", offsets: ["5"] },
      { projectPath: TMP },
    )) as unknown as ToolResponse;
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GATED");
    expect(sent).toEqual([]);
    expect(readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8")).not.toMatch(/parallelOpen:\s*true/);
  });

  it("the wb_plugin refusals w6-12 expects are raised before anything is sent", async () => {
    const sent: unknown[] = [];
    const client = {
      call: async (...a: unknown[]) => {
        sent.push(a);
        throw new Error("nothing may be sent");
      },
    };
    const deps = {
      client: client as never,
      catalog: () => loadCatalog(),
      allowList: () => loadAllowList(),
      runAllowList: () => loadRunAllowList(),
    };
    const run = async (args: Raw) => (await runPlugin(args, deps)) as unknown as ToolResponse;
    expect(
      (
        await run({
          action: "run",
          moduleName: MODAL_CLASS.module,
          className: MODAL_CLASS.className,
          confirm: true,
        })
      ).code,
    ).toBe("PLUGIN_MODAL");
    expect(
      (
        await run({
          action: "run",
          moduleName: UNLISTED_CLASS.module,
          className: UNLISTED_CLASS.className,
        })
      ).code,
    ).toBe("NOT_ALLOWLISTED");
    expect(
      (await run({ action: "run", moduleName: "ScriptEditor", className: "RunCommandline" })).code,
    ).toBe("INVALID_ARGUMENT");
    expect(
      (await run({ action: "describe", moduleName: "ScriptEditor", className: "Configure" })).code,
    ).toBe("INVALID_ARGUMENT");
    expect(
      (
        await run({
          action: "run",
          moduleName: "ScriptEditor",
          className: "SCR_DebugLinePlugin",
          method: "Run",
        })
      ).code,
    ).toBe("INVALID_ARGUMENT");
    expect(sent).toEqual([]);
  });
});

describe("W6 battery: helpers and selection", () => {
  it("the offline proofs pass on the planted bytes and fail on a wrong fixture", () => {
    const b = plantBytes();
    const p = offlineProofs((rel) => b[rel] ?? null);
    for (const [k, v] of Object.entries(p)) expect(v.ok, `${k} ${JSON.stringify(v)}`).toBe(true);
    const bad = offlineProofs((rel) =>
      rel.endsWith(".csv") ? Buffer.from("x") : (b[rel] ?? null),
    );
    expect(bad.csv!.ok).not.toBe(true);
    expect(offlineProofs(() => null).shapefile!.ok).toBe(false);
  });

  it("sameImportRow takes q and -q as one rotation and holds positions to 0.001 m", () => {
    const p = "{3F23DA7ACAC0ED90}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et";
    expect(
      sameImportRow(`${p};1 2 3;0 0.7071 0 0.7071;1`, `${p};1.0004 2 3;0 -0.7071 0 -0.7071;1`).same,
    ).toBe(true);
    expect(sameImportRow(`${p};1 2 3;0 0 0 1;1`, `${p};1.01 2 3;0 0 0 1;1`).same).toBe(false);
    expect(sameImportRow(`${p};1 2 3;0 0 0 1;1`, `${p};1 2 3;0 0 0 1;1.5`).same).toBe(false);
  });

  it("runProbe: PARTIAL while gated, KILLED on a run with no read-back, SETTLED when all read back", () => {
    expect(runProbe([{ className: "A", dry: "ok", confirm: "GATED", ran: false }]).result).toBe(
      "PARTIAL",
    );
    expect(
      runProbe([{ className: "A", dry: "ok", confirm: "ran", ran: true, oracle: { ok: false } }])
        .result,
    ).toBe("KILLED");
    expect(
      runProbe([{ className: "A", dry: "ok", confirm: "ran", ran: true, oracle: { ok: true } }])
        .result,
    ).toBe("SETTLED");
  });

  it("an open of a _throwaway world that is not on disk is refused before it is sent", () => {
    const ctx = (present: boolean) => ({
      opts: { sandboxDir: join("sb") },
      deps: { exists: () => present },
    });
    expect(missingWorldRefusal(ctx(false), `${W6_ROOT}/worlds/Gone.ent`)).toMatch(/not on disk/);
    expect(missingWorldRefusal(ctx(true), `${W6_ROOT}/worlds/Here.ent`)).toBeNull();
    expect(missingWorldRefusal(ctx(false), "worlds/Arland/EmptyArland.ent")).toBeNull();
  });

  it("a HANDOFF names the title and the answer: No on a save prompt, Cancel in the hand step, never Save", () => {
    const save = handAnswer(
      'a dialog-like window appeared (Qt "Loading world")',
      "w6-40-terrain-open",
    );
    expect(save.answer).toBe("No");
    expect(save.instruction).toContain("--from w6-40-terrain-open");
    const plug = handAnswer('the dialog "Find Linked Resources" is still open', HAND_STEP);
    expect(plug.title).toBe("Find Linked Resources");
    expect(plug.answer).toBe("Cancel");
    for (const h of [save, plug]) expect(h.answer).not.toMatch(/^Save$/);
  });

  it("selectSteps honours --only, --from, --until", () => {
    const steps = buildSteps();
    expect(selectSteps(steps, { only: "w6-13-stats" })).toHaveLength(1);
    expect(typeof selectSteps(steps, { only: "nope" })).toBe("string");
    expect(typeof selectSteps(steps, { from: "w6-40-terrain-open", until: "w6-13-stats" })).toBe(
      "string",
    );
    expect(
      selectSteps(steps, { from: "w6-40-terrain-open", until: "w6-44-area-ground" }),
    ).toHaveLength(5);
  });

  it("the World Editor, Plugin-run and terrain steps are independent units for the FAIL count", () => {
    for (const b of ["W6.2", "W6.3", "W6.4"]) expect(INDEPENDENT_BLOCKS.has(b)).toBe(true);
    expect(failUnitOf({ id: "w6-20-export-import", block: "W6.2" })).not.toBe(
      failUnitOf({ id: "w6-21-import-csv", block: "W6.2" }),
    );
    expect(failUnitOf({ id: "w6-10-plugin-list", block: "W6.1" })).toBe(
      failUnitOf({ id: "w6-11-plugin-read", block: "W6.1" }),
    );
  });

  it("every step that edits a world or reads a fixture ensures its world or plant itself (a resumed run)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    const editing = new Set(["wb_entity", "wb_shape", "wb_world_tools", "wb_terrain"]);
    for (const s of buildSteps()) {
      const touches =
        s.plan().some((a) => editing.has(String((a as Raw).tool))) ||
        (s.offlineCalls?.() ?? []).length > 0;
      if (!touches || s.id === "w6-01-handlers") continue;
      const at = src.indexOf(`id: "${s.id}"`);
      expect(at, s.id).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("run: async", at) + 700);
      expect(/ensureWorld\(ctx|ensureTerrain\(ctx|ensurePlanted\(ctx/.test(body), s.id).toBe(true);
    }
    const at = src.indexOf("async function openWorld(");
    const fn = src.slice(at, src.indexOf("\n}\n", at));
    expect(fn).toContain("missingWorldRefusal(ctx, rel)");
    // No document switch over an unpaid edit.
    expect(fn).toContain("ctx.debt.undos > 0");
  });
});

// ── Fake deps for runBattery ──

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W6Tool, args: Raw) => ToolResponse;
  files?: Map<string, Buffer>;
}): W6Deps & { files: Map<string, Buffer>; sent: Array<[string, Raw]> } {
  const files = over.files ?? new Map<string, Buffer>();
  const sent: Array<[string, Raw]> = [];
  const norm = (p: string): string => p.replace(/\\/g, "/");
  return {
    files,
    sent,
    tool: async (name, args) => {
      sent.push([name, args]);
      return over.tool ? over.tool(name, args) : { ok: true, readback: {} };
    },
    undo: async () => ({ ok: true, message: "Undo executed" }),
    info: async () =>
      over.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : over.info,
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async (): Promise<WindowInfo[]> => [],
    recordedPid: () => PID,
    registry: async () => ({
      ok: true,
      keys: [
        {
          path: "HKCU\\Software\\Bohemia Interactive\\Workbench\\ScriptTools\\SCR_CoordsTool",
          values: [{ name: "m_fX", kind: "String" }],
        },
      ],
    }),
    clipboardRead: async () => ({ state: "empty", text: "", formats: [], error: null }),
    clipboardWrite: async () => ({ ok: true, error: null }),
    toolClasses: () => ["SCR_CoordsTool", "SCR_ShapeAreaTool"],
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
    exists: (p) => files.has(norm(p)),
    listTree: (dir) => {
      const d = norm(dir).replace(/\/$/, "") + "/";
      return [...files.keys()].filter((k) => k.startsWith(d)).map((k) => k.slice(d.length));
    },
    now: () => Date.now(),
    sleep: async () => undefined,
    log: () => undefined,
  };
}

function opts(name: string, extra: Partial<W6Options> = {}): W6Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W6Options["ph"],
    build: "test",
    ...extra,
  };
}

/** The planted fixtures (their real bytes) in the fake file map. */
function plantFake(o: W6Options, deps: { files: Map<string, Buffer> }): void {
  for (const [rel, b] of Object.entries(plantBytes()))
    deps.files.set(join(o.sandboxDir, ...rel.split("/")).replace(/\\/g, "/"), b);
}

function only(id: string) {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

function win(over: Partial<WindowInfo>): WindowInfo {
  return {
    hwnd: 1,
    pid: PID,
    className: "Qt683QWindowIcon",
    title: "Enfusion Workbench",
    owner: 0,
    enabled: true,
    rect: [0, 0, 10, 10],
    monitor: [0, 0, 10, 10],
    primary: true,
    ...over,
  };
}

describe("W6 battery: runner stop rules", () => {
  it("refuses to start unless the open project is the test bed", async () => {
    const o = opts("notbed");
    const deps = fakeDeps({ info: { projectFound: 1, projectName: "SomeOtherMod" } });
    plantFake(o, deps);
    const r = await runBattery(buildSteps().slice(0, 1), deps, o);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.records[0]!.status).toBe("ABORTED");
    expect(deps.sent).toEqual([]);
  });

  it("the gate stops when a planted file is absent", async () => {
    const o = opts("noplant");
    const deps = fakeDeps({});
    const r = await runBattery(buildSteps().slice(0, 1), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.detail).toMatch(/plant/);
  });

  it("the gate passes on the test bed and takes the battery snapshot", async () => {
    const o = opts("gate");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const r = await runBattery(buildSteps().slice(0, 1), deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    expect(deps.exists(join(o.sittingDir, BATTERY_SNAPSHOT_FILE))).toBe(true);
  });

  it("the offline step passes on the planted bytes and settles P-W6-04 from the registry names", async () => {
    const o = opts("offline");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const r = (await runBattery(only("w6-02-offline"), deps, o)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
    expect(r.probes.find((p) => p.id === "P-W6-04")!.result).toBe("SETTLED");
    expect(deps.sent).toEqual([]);
  });

  it("a LOST client code stops the battery and is not retried", async () => {
    const o = opts("lost");
    const deps = fakeDeps({
      tool: () => ({ ok: false, code: "LOST", message: "connection lost" }),
    });
    plantFake(o, deps);
    const r = await runBattery(only("w6-10-plugin-list"), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.status).toBe("STOPPED");
    expect(deps.sent).toHaveLength(1);
  });

  it("MODAL_OPEN is a HANDOFF and the closable step is not run over it", async () => {
    const o = opts("modal");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "MODAL_OPEN", message: "a modal" }) });
    plantFake(o, deps);
    const r = await runBattery(only("w6-10-plugin-list"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records.map((x) => x.status)).toEqual(["HANDOFF"]);
  });

  it("a dialog-like window already up refuses the step as a HANDOFF that never answers Save", async () => {
    const o = opts("dialogup");
    const deps = fakeDeps({});
    plantFake(o, deps);
    deps.windows = async () => [win({ hwnd: 9, className: "#32770", title: "Loading world" })];
    const r = await runBattery(only("w6-10-plugin-list"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.message).toContain("Loading world");
    expect(r.message).not.toMatch(/press Save/);
    expect(deps.sent).toEqual([]);
  });

  it("three consecutive FAILs in one block stop the battery, and the closable step still runs", async () => {
    const o = opts("threefails");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = ["w6-10-plugin-list", "w6-11-plugin-read", "w6-12-plugin-refusals", "w6-13-stats"];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => ({ ...s, run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual([...ids.slice(0, 3), CLOSABLE_STEP]);
  });

  it("FAILs in the independent blocks never add up", async () => {
    const o = opts("unitfails");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = ["w6-20-export-import", "w6-21-import-csv", "w6-22-reset-flags", "w6-23-replace"];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => ({ ...s, run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.message ?? "").not.toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual(ids);
  });

  it("a step that depends on a killed probe is SKIPPED with the reason", async () => {
    const o = opts("skip");
    const deps = fakeDeps({});
    const kill = {
      step: "w6-20-export-import",
      block: "W6.2",
      title: "x",
      status: "KILLED",
      detail: "x",
      startedAt: "",
      endedAt: "",
      probes: [
        {
          id: "P-W6-07",
          result: "KILLED",
          observed: { angles: "0 30 0 vs 0 31 0" },
          note: "angles differ",
        },
      ],
      evidence: {},
    };
    deps.files.set(
      join(o.runDir, "w6-20-export-import.json").replace(/\\/g, "/"),
      Buffer.from(JSON.stringify(kill)),
    );
    const r = await runBattery(only("w6-21-import-csv"), deps, o);
    expect(r.records[0]!.status).toBe("SKIPPED");
    expect(r.records[0]!.detail).toContain("P-W6-07");
    expect(deps.sent).toEqual([]);
  });

  it("a step is never run twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps({});
    deps.files.set(join(o.runDir, "w6-10-plugin-list.json").replace(/\\/g, "/"), Buffer.from("{}"));
    const r = await runBattery(only("w6-10-plugin-list"), deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });

  it("a resumed world step writes, registers and opens the W6 world when it is absent", async () => {
    const o = opts("resume");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const worldRel = `${W6_ROOT}/worlds/EMCP_W6_Tiny.ent`;
    let open = "";
    deps.tool = async (name, args) => {
      deps.sent.push([name, args]);
      if (name === "wb_world" && args.action === "new" && args.confirm === true)
        deps.files.set(
          join(o.sandboxDir, ...worldRel.split("/")).replace(/\\/g, "/"),
          Buffer.from("w"),
        );
      if (name === "wb_module" && args.action === "setResource")
        open = String(args.target).replace(/^path:/, "");
      if (name === "wb_world" && args.action === "state")
        return { ok: true, readback: { worldPath: open, mode: "edit" } };
      if (name === "wb_entity" && args.action === "list")
        return { ok: true, readback: { total: 1 } };
      return { ok: true, readback: {} };
    };
    await runBattery(only("w6-13-stats"), deps, o);
    const order = deps.sent
      .filter(([n, a]) => n === "wb_world" && ["new", "register"].includes(String(a.action)))
      .map(([, a]) => `${String(a.action)}${a.confirm === true ? "!" : ""}`);
    expect(order).toEqual(["new", "new!", "register"]);
    expect(open).toBe(worldRel);
  });

  it("--skip-hand records the hand step HELD and sends nothing", async () => {
    const o = opts("skiphand", { skipHand: true });
    const deps = fakeDeps({});
    const r = await runBattery(only(HAND_STEP), deps, o);
    expect(r.records[0]!.status).toBe("HELD");
    expect(r.exit).toBe(EXIT.done);
    expect(deps.sent).toEqual([]);
  });

  it("the hand step writes the request with the full answer path, sees the dialog and pings after Cancel", async () => {
    const o = opts("hand");
    const deps = fakeDeps({});
    let dialog = false;
    deps.windows = async () => [
      win({ hwnd: 1 }),
      ...(dialog
        ? [win({ hwnd: 77, className: "#32770", title: "Find Linked Resources", owner: 1 })]
        : []),
    ];
    const write = deps.writeBytes;
    const logged: string[] = [];
    deps.log = (l) => logged.push(l);
    deps.writeBytes = (p, b) => {
      write(p, b);
      const m = /hand-(.+)\.request\.json$/.exec(p.replace(/\\/g, "/"));
      if (!m) return;
      const opening = m[1]!.endsWith("-open");
      dialog = opening;
      const answer = opening
        ? { opened: true, clickedAt: new Date().toISOString() }
        : { cancelled: true };
      write(p.replace(/\.request\.json$/, ".json"), Buffer.from(JSON.stringify(answer)));
    };
    const r = await runBattery(only(HAND_STEP), deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    expect(r.records[0]!.probes[0]!.id).toBe("P-W6-06");
    expect(r.records[0]!.probes[0]!.result).toBe("SETTLED");
    const hand = logged.filter((l) => l.startsWith("HAND REQUEST"));
    expect(hand).toHaveLength(2);
    expect(hand[0]).toContain(handFiles(o.runDir, `${HAND_STEP}-open`).answer);
    expect(deps.sent).toEqual([]);
  });

  it("a plugin dialog left after the Cancel request is a HANDOFF that names it", async () => {
    const o = opts("handleft");
    const deps = fakeDeps({});
    let dialog = false;
    deps.windows = async () =>
      dialog
        ? [win({ hwnd: 77, className: "#32770", title: "Find Linked Resources", owner: 1 })]
        : [];
    const write = deps.writeBytes;
    deps.writeBytes = (p, b) => {
      write(p, b);
      const m = /hand-(.+)\.request\.json$/.exec(p.replace(/\\/g, "/"));
      if (!m) return;
      if (m[1]!.endsWith("-open")) dialog = true;
      write(
        p.replace(/\.request\.json$/, ".json"),
        Buffer.from(
          JSON.stringify({ opened: true, cancelled: true, clickedAt: new Date().toISOString() }),
        ),
      );
    };
    const r = await runBattery(only(HAND_STEP), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.message).toContain("Find Linked Resources");
    expect(r.message).toContain("Cancel");
  });
});

describe("W6 battery: net-zero", () => {
  function realFsDeps(): W6Deps {
    const base = fakeDeps({});
    const walk = (dir: string, rel = ""): string[] =>
      readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
        const r = rel ? `${rel}/${e.name}` : e.name;
        return e.isDirectory() ? walk(dir, r) : [r];
      });
    return {
      ...base,
      readBytes: (p) => readFileSync(p),
      writeBytes: (p, b) => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, b);
      },
      exists: (p) => existsSync(p),
      listTree: (dir) => (existsSync(dir) ? walk(dir) : []),
    };
  }
  function put(root: string, rel: string, data: string | Buffer): void {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  }
  function sandbox(name: string): W6Options {
    const o = opts(name);
    put(o.sandboxDir, `${SANDBOX_NAME}.gproj`, "GameProject {}\n");
    put(o.sandboxDir, "Scripts/a.c", "class A {}\n");
    for (const [rel, b] of Object.entries(plantBytes())) put(o.sandboxDir, rel, b);
    return o;
  }

  it("changes under _throwaway/W6/ are no change; resourceDatabase.rdb is recorded, not failed", async () => {
    const o = sandbox("nz-ok");
    const deps = realFsDeps();
    expect((await runBattery(only(GATE_STEP), deps, o)).records[0]!.status).toBe("PASS");
    put(o.sandboxDir, `${W6_ROOT}/worlds/EMCP_W6_Tiny.ent`, "new\n");
    put(o.sandboxDir, "resourceDatabase.rdb", "db\n");
    expect(netZeroDiff(o.sittingDir, o.sandboxDir, deps)?.changed).toEqual([
      "resourceDatabase.rdb",
    ]);
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only(NETZERO_STEP), deps, o2)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
  });

  it("a real change outside the throwaway folder fails the net-zero step", async () => {
    const o = sandbox("nz-bad");
    const deps = realFsDeps();
    await runBattery(only(GATE_STEP), deps, o);
    put(o.sandboxDir, "Scripts/a.c", "changed\n");
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only(NETZERO_STEP), deps, o2)).records[0]!;
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Scripts/a.c");
  });

  it("a run that starts past the gate takes the snapshot itself", async () => {
    const o = sandbox("nz-resume");
    const deps = realFsDeps();
    const r = (await runBattery(only(NETZERO_STEP), deps, o)).records[0]!;
    const snap = JSON.parse(
      readFileSync(join(o.sittingDir, BATTERY_SNAPSHOT_FILE), "utf-8"),
    ) as Raw;
    expect(snap.taken_by).toBe("run start");
    expect(r.status).toBe("PASS");
  });
});

describe("W6 battery: plant and rollback", () => {
  function memIo(
    running: number[] = [],
  ): OfflineIo & { files: Map<string, Buffer>; dirs: Set<string> } {
    const files = new Map<string, Buffer>();
    const dirs = new Set<string>();
    const n = (p: string): string => p.replace(/\\/g, "/");
    return {
      files,
      dirs,
      workbenchPids: () => running,
      exists: (p) =>
        files.has(n(p)) ||
        dirs.has(n(p)) ||
        [...files.keys()].some((k) => k.startsWith(n(p) + "/")),
      listDir: (p) => [...files.keys()].filter((k) => k.startsWith(n(p) + "/")),
      listTree: (p) =>
        [...files.keys()]
          .filter((k) => k.startsWith(n(p) + "/"))
          .map((k) => k.slice(n(p).length + 1)),
      readBytes: (p) => {
        const b = files.get(n(p));
        if (!b) throw new Error(`ENOENT ${p}`);
        return b;
      },
      writeBytes: (p, b) => void files.set(n(p), b),
      makeDir: (p) => void dirs.add(n(p)),
      removeTree: (p) => {
        for (const k of [...files.keys()])
          if (k === n(p) || k.startsWith(n(p) + "/")) files.delete(k);
        for (const d of [...dirs]) if (d === n(p) || d.startsWith(n(p) + "/")) dirs.delete(d);
      },
      log: () => undefined,
    };
  }
  const SB = "C:/x/EMCP2_sandbox";
  const SIT = "C:/x/sitting";

  it("a dry run writes nothing", async () => {
    const io = memIo();
    expect(await runPlant(SB, SIT, false, io)).toBe(EXIT.done);
    expect(io.files.size).toBe(0);
  });

  it("plants the fixtures and the worlds folder, refuses while Workbench runs or when planted", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.done);
    for (const rel of PLANTED) expect(io.files.has(`${SB}/${rel}`), rel).toBe(true);
    for (const d of PLANT_DIRS) expect(io.dirs.has(`${SB}/${d}`), d).toBe(true);
    expect(io.files.has(`${SIT}/${PLANT_FILE}`)).toBe(true);
    const written = [...io.files.keys()].filter(
      (k) => k.startsWith(`${SB}/`) && !k.endsWith(".gproj"),
    );
    for (const k of written) expect(under(k.slice(SB.length + 1)), k).toBe(true);
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.refused);
    expect(await runPlant(SB, SIT, true, memIo([7]))).toBe(EXIT.refused);
  });

  it("rollback lists and removes _throwaway/W6/ only", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    await runPlant(SB, SIT, true, io);
    io.files.set(`${SB}/${W6_ROOT}/worlds/EMCP_W6_Tiny.ent`, Buffer.from("w"));
    expect(runRollback(SB, SIT, true, io)).toBe(EXIT.done);
    expect([...io.files.keys()].some((k) => k.startsWith(`${SB}/${W6_ROOT}/`))).toBe(false);
    expect(io.files.has(`${SB}/${SANDBOX_NAME}.gproj`)).toBe(true);
    expect(io.files.has(`${SIT}/throwaway-w6-listing.json`)).toBe(true);
  });

  it("plant and rollback refuse a sandbox that is not the test bed", async () => {
    const lines: string[] = [];
    const code = await main(["plant", "--sandbox", "C:/x/OtherMod", "--sitting-dir", SIT], {
      out: (l) => lines.push(l),
      offlineIo: memIo(),
    });
    expect(code).toBe(EXIT.usage);
  });
});

describe("W6 battery: the clipboard is saved and put back faithfully (fix-up 2)", () => {
  const empty: ClipboardSnap = { state: "empty", text: "", formats: [], error: null };
  const text = (t: string): ClipboardSnap => ({
    state: "text",
    text: t,
    formats: ["System.String", "UnicodeText", "Text"],
    error: null,
  });
  /** A clipboard in memory; `failWrite` makes every write answer that error. */
  const fakeClip = (start: ClipboardSnap, failWrite: string | null = null) => {
    let now = start;
    const writes: ClipboardSnap[] = [];
    return {
      writes,
      set: (s: ClipboardSnap) => {
        now = s;
      },
      deps: {
        clipboardRead: async () => now,
        clipboardWrite: async (s: ClipboardSnap) => {
          writes.push(s);
          if (failWrite) return { ok: false, error: failWrite };
          now = s;
          return { ok: true, error: null };
        },
      },
    };
  };

  it("classifies empty, plain text and anything else", () => {
    expect(clipboardSnapOf([], null).state).toBe("empty");
    expect(
      clipboardSnapOf(["System.String", "UnicodeText", "Text", "Locale", "OEMText"], "a"),
    ).toMatchObject({ state: "text", text: "a" });
    expect(clipboardSnapOf(["Bitmap", "DeviceIndependentBitmap"], null).state).toBe("other");
    expect(clipboardSnapOf(["UnicodeText", "HTML Format"], "a")).toMatchObject({
      state: "other",
      text: "",
    });
    expect(sameClipboard(empty, empty)).toBe(true);
    expect(sameClipboard(text("a"), text("b"))).toBe(false);
  });

  it("an unchanged clipboard (the class never ran) is not written: run 2's empty case passes", async () => {
    const c = fakeClip(empty);
    const r = await restoreClipboard(c.deps, empty);
    expect(r.ok).toBe(true);
    expect(c.writes).toEqual([]);
  });

  it("the plugin's text is replaced by the saved empty clipboard, then read back", async () => {
    const c = fakeClip(empty);
    c.set(text("Foo.Bar()"));
    const r = await restoreClipboard(c.deps, empty);
    expect(r.ok).toBe(true);
    expect(c.writes).toEqual([empty]);
  });

  it("a failed write names what failed, never an empty message", async () => {
    const c = fakeClip(text("Foo.Bar()"), "Value cannot be null.");
    const r = await restoreClipboard(c.deps, text("owner"));
    expect(r).toMatchObject({ ok: false, code: "RESTORE_FAILED" });
    expect(r.message).toContain("Value cannot be null.");
  });

  it("a write that does not read back is a mismatch with both states named", async () => {
    const c = fakeClip(text("Foo.Bar()"));
    c.deps.clipboardWrite = async (s: ClipboardSnap) => {
      c.writes.push(s);
      return { ok: true, error: null };
    };
    const r = await restoreClipboard(c.deps, text("owner"));
    expect(r).toMatchObject({ ok: false, code: "RESTORE_MISMATCH" });
    expect(r.message).toMatch(/reads text .* text was saved/);
  });

  it("a clipboard holding non-text data holds the confirm and is never written", async () => {
    const o = opts("clipother");
    const writes: ClipboardSnap[] = [];
    const deps = fakeDeps({
      tool: (name, args) =>
        name === "wb_script_editor" && args.action === "getLines"
          ? { ok: true, readback: { rows: [] } }
          : { ok: true, readback: {} },
    });
    deps.clipboardRead = async () => ({
      state: "other",
      text: "",
      formats: ["Bitmap"],
      error: null,
    });
    deps.clipboardWrite = async (s) => {
      writes.push(s);
      return { ok: true, error: null };
    };
    plantFake(o, deps);
    const r = (await runBattery(only("w6-31-run-script"), deps, o)).records[0]!;
    const sentTo = (cls: string, confirm: boolean) =>
      deps.sent.filter(
        ([n, a]) => n === "wb_plugin" && a.className === cls && !!a.confirm === confirm,
      );
    expect(sentTo("SCR_CopyClassAndMethodPlugin", false)).toHaveLength(1);
    expect(sentTo("SCR_CopyClassAndMethodPlugin", true)).toEqual([]);
    expect(sentTo("SCR_DebugLinePlugin", true)).toHaveLength(1);
    expect(writes).toEqual([]);
    expect(JSON.stringify(r.evidence)).toContain("cannot save and put back");
    expect(r.detail).not.toMatch(/restore clipboard/);
  });
});

describe("W6 battery: P-W6-15 reads Flags without a FLAGS value (fix-up 2)", () => {
  it("takes the prefab's value from a hex defaultValue when the value is empty and unset", () => {
    expect(
      flagsReadOf({ value: "", varType: "FLAGS", isSetDirectly: false, defaultValue: "0x403 0" })
        .int,
    ).toBe(0x403);
    expect(flagsReadOf({ value: "", isSetDirectly: true, defaultValue: "0x403 0" }).int).toBeNull();
    expect(flagsReadOf({ value: "7" }).int).toBe(7);
  });

  const r = (value: string, isSetDirectly: boolean) =>
    flagsReadOf({ value, varType: "FLAGS", isSetDirectly, defaultValue: "0x403 0" });
  const base = { setOk: true, resetOk: true, changed: 1, prefab: "", setTo: "1091", observed: {} };

  it("an override cleared by the reset and back after the undo is PARTIAL (value unread)", () => {
    const v = flagsVerdict({ ...base, reads: [r("", true), r("", false), r("", true)] });
    expect(v.result).toBe("PARTIAL");
  });

  it("an override still set after the reset is KILLED", () => {
    const v = flagsVerdict({ ...base, reads: [r("", true), r("", true), r("", true)] });
    expect(v.result).toBe("KILLED");
  });

  it("a reset that changed nothing is PARTIAL, never KILLED", () => {
    const v = flagsVerdict({ ...base, changed: 0, reads: [r("", true), r("", true), r("", true)] });
    expect(v.result).toBe("PARTIAL");
  });

  it("readable values settle it", () => {
    const v = flagsVerdict({
      ...base,
      prefab: "1027",
      reads: [r("1091", true), r("1027", false), r("1091", true)],
    });
    expect(v.result).toBe("SETTLED");
  });
});

describe("W6 battery: W1 cold run fix-up audit (busy windows are graced, 1.9.0.37)", () => {
  const win = (over: Partial<WindowInfo>): WindowInfo => ({
    hwnd: 1,
    pid: PID,
    className: "Qt683QWindowIcon",
    title: "Enfusion Workbench",
    owner: 0,
    enabled: true,
    rect: [0, 0, 10, 10],
    monitor: [0, 0, 10, 10],
    primary: true,
    ...over,
  });
  const MAIN = [
    win({ hwnd: 1, title: "Enfusion Workbench - EMCP2 sandbox (2.0 live lane)" }),
    win({ hwnd: 2, title: "World Editor - EMCP2_sandbox/_throwaway/W6/worlds/x.ent" }),
  ];
  /** W1 cold run's w1-60 change: both windows disabled, unowned, nothing added. */
  const BUSY = MAIN.map((w) => ({ ...w, enabled: false }));
  /** A real modal beside the transition: an owned #32770. */
  const MODAL = [
    ...BUSY,
    win({ hwnd: 4, className: "#32770", title: "Arma Reforger Workbench", owner: 2 }),
  ];

  /** Windows read MAIN, then `busy` reads of `during` from the first tool call on. */
  function busyDeps(busy: number, during: WindowInfo[] = BUSY) {
    const deps = fakeDeps({});
    let left = -1;
    const tool = deps.tool;
    deps.tool = async (name, args) => {
      if (left < 0) left = busy;
      return tool(name, args);
    };
    deps.windows = async () => {
      if (left > 0) {
        left--;
        return during;
      }
      return MAIN;
    };
    return { deps, seen: () => left === 0 };
  }

  it("w6-01-handlers watches with the busy-window grace", () => {
    expect(W2_WATCH_OPTIONS).toMatchObject({ busyGraceMs: BUSY_GRACE_MS });
  });

  it("a transient busy change (the editor windows disabled for a while) is not a handoff", async () => {
    const o = opts("busytransient");
    const { deps, seen } = busyDeps(5);
    plantFake(o, deps);
    const r = await runBattery(only("w6-01-handlers"), deps, o);
    expect(seen()).toBe(true);
    expect(r.records[0]!.status, r.records[0]!.detail).not.toBe("HANDOFF");
    expect(r.exit).not.toBe(EXIT.handoff);
  });

  it("the same windows past the grace are a handoff that says so", async () => {
    const o = opts("busystays");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER);
    plantFake(o, deps);
    const r = await runBattery(only("w6-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).toMatch(/past the 60000 ms grace/);
  });

  it("a real modal beside the busy windows still hands off at once", async () => {
    const o = opts("busymodal");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER, MODAL);
    plantFake(o, deps);
    const r = await runBattery(only("w6-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).not.toMatch(/grace/);
  });
});
