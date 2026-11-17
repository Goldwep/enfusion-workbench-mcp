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
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  BAKE_FILE,
  BATTERY_SNAPSHOT_FILE,
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  EXIT,
  FILE_WRITE_ACTIONS,
  GATE_STEP,
  INDEPENDENT_BLOCKS,
  LAUNCH_ARGS,
  LIVE_FIXTURES,
  NOT_EXERCISED,
  NOT_TESTABLE,
  OFFLINE_WRITE_ACTIONS,
  PLANTED,
  PLANT_DIRS,
  PLANT_FILE,
  PROBE_IDS,
  REFUSALS,
  RESULT_FILE,
  ROUND_TRIPS,
  SCRIPT_PATH,
  TS_ONLY_ACTIONS,
  W5_CONTRACTS,
  W5_ROOT,
  WORLD,
  buildActionPlan,
  buildQueue,
  buildSteps,
  closableStep,
  dryRunCheck,
  exactLineDiff,
  exercisedBy,
  failUnitOf,
  guidOf,
  handAnswer,
  handFiles,
  handLine,
  isSavableThrowaway,
  judgeNmnHeaders,
  legacyResponse,
  main,
  metaRelOf,
  missingWorldRefusal,
  netZeroDiff,
  offlinePlan,
  openRel,
  plantSources,
  runBake,
  runBattery,
  runPlant,
  runRollback,
  selectSteps,
  type BakeIo,
  type OfflineIo,
  type StepDef,
  type ToolResponse,
  type W5Deps,
  type W5Options,
  type W5Tool,
} from "../live/w5.live.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-w5-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 4242;

type Raw = Record<string, unknown>;

function contractActions(handler: string): string[] {
  const c = JSON.parse(readFileSync(join(REPO_ROOT, "contracts", `${handler}.json`), "utf-8")) as {
    actions: Array<{ name?: string; action?: string }> | Record<string, unknown>;
  };
  return Array.isArray(c.actions)
    ? c.actions.map((a) => String(a.name ?? a.action))
    : Object.keys(c.actions);
}

const under = (p: string): boolean => p.replace(/\\/g, "/").startsWith(`${W5_ROOT}/`);

describe("W5 battery: the dry-run gate", () => {
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
    expect(LAUNCH_ARGS.join(" ")).toContain("w5-scratch.ini");
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("step ids are unique, w5-NN-..., the gate first and the closable step last", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w5-\d\d-[a-z0-9-]+$/);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids[ids.length - 1]).toBe(CLOSABLE_STEP);
    for (const s of steps) {
      expect(s.expected.length, s.id).toBeGreaterThan(10);
      expect(s.kill_criterion.length, s.id).toBeGreaterThan(5);
    }
  });

  it("hand steps: none (spec section 6), and any added later sit in one block at the end", () => {
    const steps = buildSteps();
    const hands = steps.map((s, i) => (s.hand ? i : -1)).filter((i) => i >= 0);
    expect(hands).toEqual([]);
    expect((buildQueue().probes as Raw[]).filter((p) => p.hand)).toEqual([]);
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

describe("W5 battery: coverage", () => {
  const steps = buildSteps();
  const exercised = new Set(steps.flatMap(exercisedBy));

  it("every action of the three W5 contracts is exercised or in NOT_EXERCISED with a reason", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W5_CONTRACTS)) {
      for (const a of contractActions(handler)) {
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

  it("the TS-only lists hold the tools' own action lists (49 offline actions)", async () => {
    const audio = await import("../../src/tools/audio.js");
    const particle = await import("../../src/tools/particle.js");
    const navmesh = await import("../../src/tools/navmesh.js");
    expect([...TS_ONLY_ACTIONS.audio!].sort()).toEqual(
      [...audio.READ_ACTIONS, ...audio.WRITE_ACTIONS, ...audio.GRAPH_ACTIONS].sort(),
    );
    expect([...TS_ONLY_ACTIONS.particle!].sort()).toEqual(
      [...particle.READ_ACTIONS, ...particle.WRITE_ACTIONS].sort(),
    );
    expect([...TS_ONLY_ACTIONS.navmesh!].sort()).toEqual([...navmesh.NAVMESH_ACTIONS].sort());
  });

  it("every probe P-W5-01..17 is assigned to a step or listed as not testable with a reason", () => {
    expect(PROBE_IDS).toHaveLength(17);
    const assigned = new Set(steps.flatMap((s) => s.probes));
    for (const id of PROBE_IDS) {
      const ok = assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10;
      expect(ok, id).toBe(true);
    }
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of steps) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
  });

  it("every probe of the inbox file is one of P-W5-01..17", () => {
    const lines = readFileSync(join(REPO_ROOT, "docs/v2/inbox/w5/probes.jsonl"), "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    const ids = lines.map((l) => String((JSON.parse(l) as Raw).id));
    expect([...ids].sort()).toEqual([...PROBE_IDS].sort());
  });
});

describe("W5 battery: writes stay under _throwaway/W5/", () => {
  const steps = buildSteps();

  it("every declared write lies under _throwaway/W5/", () => {
    for (const s of steps) for (const w of s.writes) expect(under(w), `${s.id} ${w}`).toBe(true);
  });

  it("every file-writing tool call in the plan names a file under _throwaway/W5/", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (!FILE_WRITE_ACTIONS.has(key)) continue;
      const p = a.params ?? {};
      const files = ["path", "paths", "to"]
        .flatMap((k) => (Array.isArray(p[k]) ? (p[k] as unknown[]) : [p[k]]))
        .filter((v): v is string => typeof v === "string");
      expect(files.length, `${String(a.step)} ${key}`).toBeGreaterThan(0);
      for (const v of files) expect(under(v), `${String(a.step)} ${key} ${v}`).toBe(true);
    }
  });

  it("every confirmed offline write names a file under _throwaway/W5/, except the NOT_IN_PROJECT refusal", () => {
    const refusedOutside = REFUSALS.filter((r) => r.codes.includes("NOT_IN_PROJECT")).map((r) =>
      JSON.stringify(r.params),
    );
    for (const c of offlinePlan(steps)) {
      const p = c.params;
      if (c.action === "overrideConfig") expect(p.confirm, c.step).not.toBe(true);
      if (!OFFLINE_WRITE_ACTIONS.has(`${c.tool}.${c.action}`) || p.confirm !== true) continue;
      const path = String(p.path ?? "");
      if (!under(path)) {
        expect(refusedOutside, `${c.step} ${c.tool}.${c.action} ${path}`).toContain(
          JSON.stringify(p),
        );
        continue;
      }
      expect(under(path)).toBe(true);
    }
  });

  it("the round trips and the refusals act only on _throwaway/W5/ copies (the NOT_IN_PROJECT one aside)", () => {
    for (const t of ROUND_TRIPS) expect(under(t.path), t.key).toBe(true);
    for (const r of REFUSALS)
      if (!r.codes.includes("NOT_IN_PROJECT") && r.tool !== "navmesh")
        expect(under(String(r.params.path)), JSON.stringify(r.params)).toBe(true);
  });

  it("no plan entry calls a denied API; only the throwaway world is ever saved", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      if (a.kind !== "net-call") continue;
      expect(String(a.target)).not.toMatch(/RunCommandline|Workbench\.(Exit|RunCmd|RunProcess)/);
      expect(String(a.target)).not.toBe("EMCP_WB_Save");
      if (a.params?.action === "save") {
        expect(a.tool).toBe("wb_module");
        expect(a.params.path).toBe(WORLD);
      }
    }
    expect(isSavableThrowaway(`$EMCP2_sandbox:${WORLD}`)).toBe(true);
    expect(isSavableThrowaway("worlds/GameMaster/GM_Arland.ent")).toBe(false);
    expect(openRel("$EMCP2_sandbox:_throwaway\\W5\\worlds\\EMCP_W5_Tiny.ent")).toBe(WORLD);
  });

  it("the plant writes only under _throwaway/W5/ and the planted files are the fixtures", () => {
    for (const p of [...PLANTED, ...PLANT_DIRS]) expect(under(p), p).toBe(true);
    for (const f of LIVE_FIXTURES) expect(PLANTED).toContain(f);
    expect(
      plantSources()
        .map((s) => s.rel)
        .sort(),
    ).toEqual([...PLANTED].sort());
  });

  it("wb_cli_run is never sent with a listed verb inside the GUI sitting", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    expect(src).toContain("loadCliPolicy().verbs.has(verb)");
    const cli = offlinePlan(steps).filter((c) => c.tool === "wb_cli_run");
    expect(cli.map((c) => c.action).sort()).toEqual(["navmeshBake", "navmeshGenerate"]);
    for (const c of cli) expect(c.params.confirm).not.toBe(true);
  });
});

describe("W5 battery: helpers and selection", () => {
  it("exactLineDiff counts removed and added lines", () => {
    expect(exactLineDiff("a\nb\nc", "a\nB\nc")).toEqual({ removed: ["b"], added: ["B"] });
    expect(exactLineDiff("x\ny", "x\ny")).toEqual({ removed: [], added: [] });
  });

  it("metaRelOf: beside the resource the register answered, else <rel>.meta; guidOf", () => {
    expect(metaRelOf(`${W5_ROOT}/W5_snd.acp`)).toBe(`${W5_ROOT}/W5_snd.acp.meta`);
    expect(metaRelOf(`${W5_ROOT}/W5_snd.acp`, `{0123456789ABCDEF}${W5_ROOT}/W5_snd.acp`)).toBe(
      `${W5_ROOT}/W5_snd.acp.meta`,
    );
    expect(guidOf("{a983320ba69b2065}Sounds/x.acp")).toBe("A983320BA69B2065");
    expect(guidOf("Sounds/x.acp")).toBe("");
  });

  it("judgeNmnHeaders: SETTLED when every header reads with a tile size, KILLED when one does not", () => {
    const ok = (ts: number): ToolResponse => ({ ok: true, readback: { tileSize: ts } });
    expect(
      judgeNmnHeaders([
        { path: "a.nmn", r: ok(24) },
        { path: "b.nmn", r: ok(51) },
      ]).result,
    ).toBe("SETTLED");
    expect(
      judgeNmnHeaders([
        { path: "a.nmn", r: ok(24) },
        { path: "b.nmn", r: { ok: false, code: "INVALID_ARGUMENT" } },
      ]).result,
    ).toBe("KILLED");
    expect(judgeNmnHeaders([{ path: "a.nmn", r: { ok: true, readback: {} } }]).result).toBe(
      "PARTIAL",
    );
  });

  it("a 1.x tool's answer is read as JSON when it is, else its code from the text", () => {
    expect(
      legacyResponse("x", { content: [{ type: "text", text: '{"ok":false,"code":"GATED"}' }] }),
    ).toMatchObject({ ok: false, code: "GATED" });
    expect(
      legacyResponse("x", {
        content: [{ type: "text", text: "navmeshGenerate: NOT_ALLOWLISTED by policy" }],
        isError: true,
      }),
    ).toMatchObject({ ok: false, code: "NOT_ALLOWLISTED" });
  });

  it("failUnitOf: each W5.4 accept is its own unit; other blocks count together", () => {
    expect(INDEPENDENT_BLOCKS.has("W5.4")).toBe(true);
    expect(failUnitOf({ id: "w5-40-accept-acp", block: "W5.4" })).not.toBe(
      failUnitOf({ id: "w5-41-accept-ptc", block: "W5.4" }),
    );
    expect(failUnitOf({ id: "w5-10-audio-reads", block: "W5.1" })).toBe(
      failUnitOf({ id: "w5-11-audio-play", block: "W5.1" }),
    );
  });

  it("the HAND REQUEST line names the run folder and the full answer path", () => {
    const run = join("run", "r1");
    const line = handLine(run, "w5-k", "look");
    expect(line).toContain(`run folder: ${run}`);
    expect(line).toContain(handFiles(run, "w5-k").answer);
    expect(handFiles(run, "k").request).toBe(join(run, "hand-k.request.json"));
  });

  it("an open of a _throwaway world that is not on disk is refused before it is sent", () => {
    const ctx = (present: boolean) => ({
      opts: { sandboxDir: join("sb") },
      deps: { exists: () => present },
    });
    expect(missingWorldRefusal(ctx(false), WORLD)).toMatch(/not on disk/);
    expect(missingWorldRefusal(ctx(true), WORLD)).toBeNull();
    expect(missingWorldRefusal(ctx(false), "worlds/GameMaster/GM_Arland.ent")).toBeNull();
  });

  it("a save prompt HANDOFF names the exact title, the answer No and the resume", () => {
    const h = handAnswer(
      'a dialog-like window appeared (Qt683QWindowIcon "Loading world")',
      "w5-60-nav-vanilla",
    );
    expect(h.title).toBe("Loading world");
    expect(h.answer).toBe("No");
    expect(h.instruction).toContain("--from w5-60-nav-vanilla");
  });

  it("selectSteps honours --only, --from, --until", () => {
    const steps = buildSteps();
    expect(selectSteps(steps, { only: "w5-10-audio-reads" })).toHaveLength(1);
    expect(typeof selectSteps(steps, { only: "nope" })).toBe("string");
    expect(
      typeof selectSteps(steps, { from: "w5-50-nav-status", until: "w5-10-audio-reads" }),
    ).toBe("string");
    expect(
      selectSteps(steps, { from: "w5-40-accept-acp", until: "w5-47-accept-create" }),
    ).toHaveLength(8);
  });

  it("every step that sends ensures its fixtures or the world itself (a resumed run)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    for (const s of buildSteps()) {
      const sends =
        s.plan().some((a) => typeof (a as Raw).tool === "string") ||
        (s.offlineCalls?.() ?? []).length > 0;
      if (!sends || s.id === CLOSABLE_STEP || s.id === "w5-01-handlers") continue;
      const at = src.indexOf(`id: "${s.id}"`);
      expect(at, s.id).toBeGreaterThan(0);
      const body = src.slice(at, src.indexOf("run: async", at) + 700);
      // w5-60 opens a vanilla world: it saves the throwaway world first and needs no fixture.
      expect(
        /ensureFixtures(OnDisk)?\(ctx\)|ensureWorld\(ctx|saveThrowaway\(ctx\)/.test(body),
        s.id,
      ).toBe(true);
    }
    const at = src.indexOf("async function openWorld(");
    expect(src.slice(at, src.indexOf("\n}\n", at))).toContain("missingWorldRefusal(ctx, rel)");
  });
});

// ── Fake deps for runBattery ──

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W5Tool, args: Raw) => ToolResponse;
  files?: Map<string, Buffer>;
}): W5Deps & { files: Map<string, Buffer>; sent: Array<[string, Raw]> } {
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
    offline: async (name, args) => {
      sent.push([name, args]);
      return { ok: true, readback: {} };
    },
    undo: async () => ({ ok: true, message: "Undo executed" }),
    redo: async () => ({ ok: true, message: "Redo executed" }),
    info: async () =>
      over.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : over.info,
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async (): Promise<WindowInfo[]> => [],
    recordedPid: () => PID,
    vanilla: () => null,
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

function opts(name: string, extra: Partial<W5Options> = {}): W5Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W5Options["ph"],
    build: "test",
    ...extra,
  };
}

function plantFake(o: W5Options, deps: { files: Map<string, Buffer> }): void {
  for (const rel of PLANTED)
    deps.files.set(join(o.sandboxDir, ...rel.split("/")).replace(/\\/g, "/"), Buffer.from("x"));
}

function only(id: string): StepDef[] {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

describe("W5 battery: runner stop rules", () => {
  it("refuses to start unless the open project is the test bed", async () => {
    const o = opts("notbed");
    const deps = fakeDeps({ info: { projectFound: 1, projectName: "SomeOtherMod" } });
    plantFake(o, deps);
    const r = await runBattery(buildSteps().slice(0, 1), deps, o);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.records[0]!.status).toBe("ABORTED");
    expect(deps.sent).toEqual([]);
  });

  it("the gate stops when a planted file is absent (nothing that is not on disk is opened)", async () => {
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
    expect(deps.exists(join(o.sittingDir, RESULT_FILE))).toBe(true);
  });

  it("a LOST client code stops the battery and is not retried", async () => {
    const o = opts("lost");
    const deps = fakeDeps({
      tool: () => ({ ok: false, code: "LOST", message: "connection lost" }),
    });
    plantFake(o, deps);
    const r = await runBattery(only("w5-10-audio-reads"), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.status).toBe("STOPPED");
    expect(deps.sent).toHaveLength(1);
  });

  it("MODAL_OPEN is a HANDOFF", async () => {
    const o = opts("modal");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "MODAL_OPEN", message: "a modal" }) });
    plantFake(o, deps);
    const r = await runBattery(only("w5-10-audio-reads"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
  });

  it("three consecutive FAILs in one block stop the battery, and the closable step still runs", async () => {
    const o = opts("threefails");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = [
      "w5-10-audio-reads",
      "w5-11-audio-play",
      "w5-12-audio-state",
      "w5-20-particle-spawn",
    ];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => ({ ...s, run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual([...ids.slice(0, 3), CLOSABLE_STEP]);
  });

  it("the FAIL count resets at a block boundary, and W5.4's independent accepts never add up", async () => {
    const o = opts("unitfails");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = [
      "w5-30-entity-sound",
      "w5-40-accept-acp",
      "w5-41-accept-ptc",
      "w5-42-accept-vars",
      "w5-43-accept-afm",
      "w5-44-accept-sig",
      "w5-50-nav-status",
    ];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => ({ ...s, run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.message ?? "").not.toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual(ids);
  });

  it("a step that depends on a killed probe is SKIPPED with the reason; the battery continues", async () => {
    const o = opts("skip");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const kill = {
      step: "w5-20-particle-spawn",
      block: "W5.2",
      title: "x",
      status: "KILLED",
      detail: "x",
      startedAt: "",
      endedAt: "",
      probes: [
        { id: "P-W5-07", result: "KILLED", observed: { emitters: 0 }, note: "no Particles" },
      ],
      evidence: {},
    };
    deps.files.set(
      join(o.runDir, "w5-20-particle-spawn.json").replace(/\\/g, "/"),
      Buffer.from(JSON.stringify(kill)),
    );
    const steps = buildSteps().filter((s) =>
      ["w5-21-particle-control", "w5-22-particle-param", "w5-95-netzero"].includes(s.id),
    );
    const r = await runBattery(steps, deps, o);
    expect(r.records.map((x) => x.status).slice(0, 2)).toEqual(["SKIPPED", "SKIPPED"]);
    expect(r.records[0]!.detail).toContain("P-W5-07");
    expect(r.records[2]!.step).toBe("w5-95-netzero");
    expect(deps.sent).toEqual([]);
  });

  it("a step is never run twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps({});
    deps.files.set(join(o.runDir, "w5-10-audio-reads.json").replace(/\\/g, "/"), Buffer.from("{}"));
    const r = await runBattery(only("w5-10-audio-reads"), deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });

  it("a resumed run registers a fixture that has no .meta before its step", async () => {
    const o = opts("resume");
    const deps = fakeDeps({});
    plantFake(o, deps);
    deps.tool = async (name, args) => {
      deps.sent.push([name, args]);
      if (name === "wb_resources" && args.action === "resolve")
        return { ok: true, readback: { hasMeta: false, resourceName: "" } };
      if (name === "wb_resources" && args.action === "register")
        return { ok: true, readback: { resourceName: `{0123456789ABCDEF}${String(args.path)}` } };
      return { ok: true, readback: {} };
    };
    await runBattery(only("w5-10-audio-reads"), deps, o);
    const regs = deps.sent.filter(([n, a]) => n === "wb_resources" && a.action === "register");
    expect(regs.map(([, a]) => a.path)).toEqual([...LIVE_FIXTURES]);
    expect(regs.every(([, a]) => a.confirm === true)).toBe(true);
  });

  it("--skip-hand records a hand step HELD and sends nothing", async () => {
    const o = opts("held", { skipHand: true });
    const deps = fakeDeps({});
    const hand: StepDef = {
      ...closableStep(),
      id: "w5-98-hand",
      hand: true,
      run: async () => {
        throw new Error("a held hand step must not run");
      },
    };
    const r = await runBattery([hand], deps, o);
    expect(r.records[0]!.status).toBe("HELD");
    expect(r.exit).toBe(EXIT.done);
    expect(r.message).toMatch(/HELD/);
    expect(deps.sent).toEqual([]);
  });

  it("the play step owes wb_world stop from the moment it plays", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    const at = src.indexOf('id: "w5-80-play-mode"');
    const body = src.slice(at, src.indexOf('id: "w5-90-aliases"', at));
    expect(body.indexOf('label: "wb_world stop"')).toBeLessThan(
      body.indexOf('play = await ctx.tool("wb_world"'),
    );
    expect(body).toContain("finally");
  });
});

describe("W5 battery: net-zero", () => {
  function realFsDeps(): W5Deps {
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
  function put(root: string, rel: string, text: string): void {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  function sandbox(name: string): W5Options {
    const o = opts(name);
    put(o.sandboxDir, `${SANDBOX_NAME}.gproj`, "GameProject {}\n");
    put(o.sandboxDir, "Scripts/a.c", "class A {}\n");
    for (const rel of PLANTED) put(o.sandboxDir, rel, "plant\n");
    return o;
  }

  it("changes under _throwaway/W5/ are no change; resourceDatabase.rdb is recorded, not failed", async () => {
    const o = sandbox("nz-ok");
    const deps = realFsDeps();
    expect((await runBattery(only(GATE_STEP), deps, o)).records[0]!.status).toBe("PASS");
    put(o.sandboxDir, `${W5_ROOT}/created/x.acp`, "new\n");
    put(o.sandboxDir, "resourceDatabase.rdb", "db\n");
    expect(netZeroDiff(o.sittingDir, o.sandboxDir, deps)?.changed).toEqual([
      "resourceDatabase.rdb",
    ]);
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only("w5-95-netzero"), deps, o2)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
  });

  it("a real change outside the throwaway folder fails w5-95", async () => {
    const o = sandbox("nz-bad");
    const deps = realFsDeps();
    await runBattery(only(GATE_STEP), deps, o);
    put(o.sandboxDir, "Scripts/a.c", "changed\n");
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only("w5-95-netzero"), deps, o2)).records[0]!;
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Scripts/a.c");
  });

  it("a run that starts past the gate takes the snapshot itself (--from / --only)", async () => {
    const o = sandbox("nz-resume");
    const deps = realFsDeps();
    const r = (await runBattery(only("w5-95-netzero"), deps, o)).records[0]!;
    const snap = JSON.parse(
      readFileSync(join(o.sittingDir, BATTERY_SNAPSHOT_FILE), "utf-8"),
    ) as Raw;
    expect(snap.taken_by).toBe("run start");
    expect(r.status).toBe("PASS");
  });
});

describe("W5 battery: plant, bake and rollback", () => {
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
      readVanilla: async (v) => Buffer.from(`vanilla ${v}`),
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

  it("plants the sixteen copies and three folders, refuses while Workbench runs or when planted", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.done);
    expect(PLANTED).toHaveLength(16);
    for (const rel of PLANTED) expect(io.files.has(`${SB}/${rel}`), rel).toBe(true);
    for (const d of PLANT_DIRS) expect(io.dirs.has(`${SB}/${d}`), d).toBe(true);
    expect(io.files.has(`${SIT}/${PLANT_FILE}`)).toBe(true);
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.refused);
    expect(await runPlant(SB, SIT, true, memIo([7]))).toBe(EXIT.refused);
  });

  it("rollback lists and removes _throwaway/W5/ only", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    await runPlant(SB, SIT, true, io);
    io.files.set(`${SB}/${W5_ROOT}/created/W5_new.acp`, Buffer.from("c"));
    expect(runRollback(SB, SIT, true, io)).toBe(EXIT.done);
    expect([...io.files.keys()].some((k) => k.startsWith(`${SB}/${W5_ROOT}/`))).toBe(false);
    expect(io.files.has(`${SB}/${SANDBOX_NAME}.gproj`)).toBe(true);
    expect(io.files.has(`${SIT}/throwaway-w5-listing.json`)).toBe(true);
  });

  function bakeIo(
    running: number[] = [],
    writes = true,
  ): BakeIo & { calls: Raw[]; files: Map<string, Buffer> } {
    const io = memIo(running);
    const calls: Raw[] = [];
    return {
      ...io,
      calls,
      cliBake: async (args) => {
        calls.push(args);
        if (writes) {
          io.writeBytes(`${String(args.save_dir)}/EMCP_W5_Tiny.nmn`, Buffer.from("EV"));
          io.writeBytes(`${String(args.save_dir)}/EMCP_W5_Tiny_0_0.ntile`, Buffer.from("T"));
        }
        return { ok: true, readback: { exitCode: 0 } };
      },
      navmesh: () => ({ ok: true, readback: { tileSize: 24 } }),
    };
  }

  it("bake (P-W5-01): a dry run spawns nothing; refused while Workbench runs or without the world", async () => {
    const dry = bakeIo();
    expect(await runBake(SB, SIT, false, dry)).toBe(EXIT.done);
    expect(dry.calls).toEqual([]);
    expect(await runBake(SB, SIT, true, bakeIo([9]))).toBe(EXIT.refused);
    expect(await runBake(SB, SIT, true, bakeIo())).toBe(EXIT.refused);
  });

  it("bake writes w5-bake.json: SETTLED with .nmn and .ntile output, KILLED without", async () => {
    const io = bakeIo();
    io.files.set(`${SB}/${WORLD}`, Buffer.from("world"));
    expect(await runBake(SB, SIT, true, io)).toBe(EXIT.done);
    expect(io.calls[0]).toMatchObject({ verb: "navmeshBake", target: WORLD, timeout_seconds: 600 });
    expect(String(io.calls[0]!.save_dir).replace(/\\/g, "/")).toBe(`${SB}/${W5_ROOT}/bake`);
    const rec = JSON.parse(io.files.get(`${SIT}/${BAKE_FILE}`)!.toString("utf-8")) as {
      probe: { id: string; result: string };
    };
    expect(rec.probe).toMatchObject({ id: "P-W5-01", result: "SETTLED" });
    const none = bakeIo([], false);
    none.files.set(`${SB}/${WORLD}`, Buffer.from("world"));
    await runBake(SB, SIT, true, none);
    const rec2 = JSON.parse(none.files.get(`${SIT}/${BAKE_FILE}`)!.toString("utf-8")) as {
      probe: { result: string };
    };
    expect(rec2.probe.result).toBe("KILLED");
  });

  it("the subcommands refuse a sandbox that is not the test bed", async () => {
    for (const sub of ["plant", "bake", "rollback"]) {
      const lines: string[] = [];
      const code = await main([sub, "--sandbox", "C:/x/Other", "--sitting-dir", SIT], {
        out: (l) => lines.push(l),
        offlineIo: memIo(),
        bakeIo: bakeIo(),
      });
      expect(code, sub).toBe(EXIT.usage);
    }
  });
});
