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
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  ANIM_SET,
  BATTERY_SNAPSHOT_FILE,
  BLOCKED_OI_W4_1,
  BT,
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  DOMAIN_CODES,
  EXIT,
  FILE_WRITE_ACTIONS,
  GATE_STEP,
  INDEPENDENT_BLOCKS,
  LAUNCH_ARGS,
  LIVE_FIXTURES,
  MODE_POLLS,
  NOT_EXERCISED,
  NOT_TESTABLE,
  OFF_PAP,
  PAP,
  PLANTED,
  PLANT_DIRS,
  PLANT_FILE,
  PROBE_IDS,
  SCRIPT_PATH,
  TS_ONLY_ACTIONS,
  W4_CONTRACTS,
  W4_ROOT,
  WATCH_OPTIONS,
  buildActionPlan,
  buildQueue,
  buildSteps,
  dryRunCheck,
  exercisedBy,
  failUnitOf,
  handAnswer,
  handFiles,
  handLine,
  handlerCalls,
  keyDataOf,
  main,
  missingWorldRefusal,
  netZeroDiff,
  offlinePlan,
  openRefusal,
  ownerOf,
  runBattery,
  runPlant,
  runRollback,
  selectSteps,
  textResponse,
  type OfflineIo,
  type ToolResponse,
  type W4Deps,
  type W4Options,
  type W4Tool,
} from "../live/w4.live.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-w4-"));
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

const under = (p: string): boolean => p.replace(/\\/g, "/").startsWith(`${W4_ROOT}/`);

describe("W4 battery: the dry-run gate", () => {
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
    expect(LAUNCH_ARGS.join(" ")).toContain("w4-scratch.ini");
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("step ids are unique, w4-NN-..., the gate first and the closable step last", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w4-\d\d-[a-z0-9-]+$/);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids[ids.length - 1]).toBe(CLOSABLE_STEP);
    for (const s of steps) {
      expect(s.expected.length, s.id).toBeGreaterThan(10);
      expect(s.kill_criterion.length, s.id).toBeGreaterThan(5);
    }
  });

  it("the hand steps sit in ONE block at the end (before net-zero and the closable step)", () => {
    const steps = buildSteps();
    const hand = steps.filter((s) => s.hand);
    expect(hand.length).toBeGreaterThan(0);
    expect(new Set(hand.map((s) => s.block)).size).toBe(1);
    const block = hand[0]!.block;
    expect(steps.filter((s) => s.block === block).every((s) => s.hand)).toBe(true);
    const first = steps.findIndex((s) => s.hand);
    const after = steps
      .slice(first)
      .filter((s) => !s.hand)
      .map((s) => s.id);
    expect(after).toEqual(["w4-95-netzero", CLOSABLE_STEP]);
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

describe("W4 battery: coverage", () => {
  const steps = buildSteps();
  const exercised = new Set(steps.flatMap(exercisedBy));

  it("every action of the four W4 contracts is exercised or in NOT_EXERCISED with a reason", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W4_CONTRACTS)) {
      for (const a of contractActions(handler)) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
    for (const reason of Object.values(NOT_EXERCISED)) expect(reason.length).toBeGreaterThan(10);
    // A NOT_EXERCISED entry names an action that really is not exercised.
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

  it("the TS-only lists hold every action the tools' own sources name", () => {
    const set = readFileSync(join(REPO_ROOT, "src/tools/animation-set.ts"), "utf-8");
    for (const a of TS_ONLY_ACTIONS.animation_set!) expect(set, a).toContain(`"${a}"`);
    const pap = readFileSync(join(REPO_ROOT, "src/tools/procanim.ts"), "utf-8");
    for (const a of TS_ONLY_ACTIONS.procanim!) expect(pap, a).toContain(`"${a}"`);
  });

  it("every GATED action is sent for its refusal only (a plan note says so, no confirm reaches Enforce)", () => {
    const plan = buildActionPlan(steps) as Array<Raw & { params?: Raw }>;
    const refused = (tool: string, action: string): Array<Raw & { params?: Raw }> =>
      plan.filter((a) => a.tool === tool && a.toolAction === action);
    for (const [tool, action] of [
      ["wb_anim", "check"],
      ["wb_anim_debug", "set"],
      ["wb_anim_debug", "command"],
      ["wb_anim_debug", "btBreakpoint"],
    ] as const) {
      const hits = refused(tool, action);
      expect(hits.length, `${tool}.${action}`).toBeGreaterThan(0);
      for (const a of hits) expect(String(a.note)).toMatch(/refused GATED by the TS/);
    }
    const confirmEdits = refused("wb_anim", "txaEdit").filter((a) => a.params?.confirm === true);
    expect(confirmEdits.length).toBe(1);
    expect(String(confirmEdits[0]!.note)).toMatch(/refused GATED/);
    for (const a of refused("wb_module", "save")) expect(a.params?.confirm).not.toBe(true);
    for (const a of refused("wb_module", "close")) expect(String(a.note)).toMatch(/refused/);
  });

  it("every probe P-W4-01..29 is assigned to a step or listed as not testable with a reason", () => {
    expect(PROBE_IDS).toHaveLength(29);
    const assigned = new Set(steps.flatMap((s) => s.probes));
    for (const id of PROBE_IDS) {
      const ok = assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10;
      expect(ok, id).toBe(true);
    }
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of steps) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
  });

  it("every probe of the inbox file is one of P-W4-01..29", () => {
    const lines = readFileSync(join(REPO_ROOT, "docs/v2/inbox/w4/probes.jsonl"), "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    const ids = lines.map((l) => String((JSON.parse(l) as Raw).id));
    expect([...ids].sort()).toEqual([...PROBE_IDS].sort());
  });
});

describe("W4 battery: writes stay under _throwaway/W4/", () => {
  const steps = buildSteps();

  it("every declared write lies under _throwaway/W4/", () => {
    for (const s of steps) for (const w of s.writes) expect(under(w), `${s.id} ${w}`).toBe(true);
  });

  it("every file-writing tool call in the plan names a file under _throwaway/W4/", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      // A register sent from inside a TS tool (registerProjectFile) writes a .meta too.
      const register = a.kind === "net-call" && a.params?.action === "register";
      if (!FILE_WRITE_ACTIONS.has(key) && !register) continue;
      const p = a.params ?? {};
      const files = ["path", "paths", "to", "target"]
        .flatMap((k) => (Array.isArray(p[k]) ? (p[k] as unknown[]) : [p[k]]))
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.replace(/^path:/, ""));
      expect(files.length, `${String(a.step)} ${key}`).toBeGreaterThan(0);
      for (const v of files) expect(under(v), `${String(a.step)} ${key} ${v}`).toBe(true);
    }
  });

  it("every offline write (confirm, behavior_tree create/edit, animation_graph author) names files under _throwaway/W4/", () => {
    let writes = 0;
    for (const c of offlinePlan(steps)) {
      const p = c.params;
      const btWrite =
        c.tool === "behavior_tree" && ["create", "edit"].includes(c.action) && p.dry_run !== true;
      const author = c.tool === "animation_graph" && c.action === "author";
      if (p.confirm !== true && !btWrite && !author) continue;
      writes++;
      const spec = p.spec as Raw | undefined;
      // duplicate reads `path` (the vanilla source) and writes beside `target`.
      const dup = c.tool === "animation_workspace" && c.action === "duplicate";
      const files = (dup ? [p.target] : [p.path, p.target, p.outputPath, spec?.path]).filter(
        (v): v is string => typeof v === "string",
      );
      expect(files.length, `${c.step} ${c.tool}.${c.action}`).toBeGreaterThan(0);
      for (const v of files) expect(under(v), `${c.step} ${c.tool}.${c.action} ${v}`).toBe(true);
    }
    expect(writes).toBeGreaterThan(10);
  });

  it("no plan entry calls a denied API or saves", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      if (a.kind !== "net-call") continue;
      expect(String(a.target)).not.toMatch(/RunCommandline|Workbench\.(Exit|RunCmd|RunProcess)/);
      expect(String(a.target)).not.toBe("EMCP_WB_Save");
      if (a.params?.action === "save") {
        // wb_module save is w4-36's refusal check (a dry run, NO_DOCUMENT in Enforce: P-W4-10 killed).
        expect(a.tool).toBe("wb_module");
        expect(a.step).toBe("w4-36-refusals");
        expect(a.params.confirm).not.toBe(true);
      }
    }
  });

  it("the plant writes only under _throwaway/W4/", () => {
    for (const p of [...PLANTED, ...PLANT_DIRS, ...ANIM_SET, ...LIVE_FIXTURES])
      expect(under(p), p).toBe(true);
  });
});

describe("W4 battery: helpers and selection", () => {
  it("ownerOf names the module that owns each W4 type", () => {
    expect(ownerOf(BT)).toBe("BehaviorEditor");
    expect(ownerOf(PAP)).toBe("ProcAnimEditor");
    for (const rel of ANIM_SET) expect(ownerOf(rel), rel).toBe("AnimEditor");
    expect(ownerOf("_throwaway/W4/types/W4_events.ae")).toBe("ResourceManager");
    expect(ownerOf("worlds/x.ent")).toBe("WorldEditor");
  });

  it("an open is refused before sending when the file is not on disk or the module does not own it", () => {
    const ctx = (present: boolean) => ({
      opts: { sandboxDir: join("sb") },
      deps: { exists: () => present },
    });
    expect(openRefusal(ctx(false), "BehaviorEditor", BT)).toMatch(/not on disk/);
    expect(openRefusal(ctx(true), "BehaviorEditor", BT)).toBeNull();
    expect(openRefusal(ctx(true), "AnimEditor", BT)).toMatch(/does not own/);
    expect(openRefusal(ctx(true), "ProcAnimEditor", PAP)).toBeNull();
    expect(missingWorldRefusal(ctx(false), `${W4_ROOT}/worlds/Gone.ent`)).toMatch(/not on disk/);
    expect(missingWorldRefusal(ctx(false), "worlds/Arland/EmptyArland.ent")).toBeNull();
  });

  it("keyDataOf gives frames x channels values", () => {
    expect(keyDataOf(2, 3)).toHaveLength(6);
  });

  it("textResponse reads a JSON envelope, wraps other JSON and plain text", () => {
    expect(textResponse('{"ok":false,"code":"X"}', true, "edit")).toMatchObject({
      ok: false,
      code: "X",
    });
    expect(textResponse('{"nodes":[1]}', false, "nodes")).toMatchObject({
      ok: true,
      readback: { nodes: [1] },
    });
    expect(textResponse("Tree written", false, "create")).toMatchObject({
      ok: true,
      readback: { text: "Tree written" },
    });
    expect(textResponse("bad path", true, "create")).toMatchObject({ ok: false });
  });

  it("handlerCalls lists a handler class's engine calls and its FileIO calls", () => {
    const files: Record<string, Buffer> = {
      "scripts/WorkbenchGame/Anim/ExportTXA.c": Buffer.from(
        "class ExportTXAResource : NetApiHandler\n{\n  void Do() { TxaExporter.TrackExport(a); FileIO.OpenFile(p, 1); }\n}\nclass Other\n{\n  void X() { FileIO.DeleteFile(q); }\n}\n",
      ),
    };
    const fs = { paths: () => Object.keys(files), read: (p: string) => files[p]! };
    const r = handlerCalls(fs, "ExportTXAResource");
    expect(r.fileIo).toEqual(["FileIO.OpenFile"]);
    expect(r.calls).toContain("TxaExporter.TrackExport");
    expect(handlerCalls(fs, "Missing").file).toBeNull();
  });

  it("DOMAIN_CODES counts a handler's own refusal as an answer, never a dead client", () => {
    expect(DOMAIN_CODES.has("ENTITY_NOT_FOUND")).toBe(true);
    expect(DOMAIN_CODES.has("UNREACHABLE")).toBe(false);
    expect(DOMAIN_CODES.has("HANDLER_ERROR")).toBe(false);
  });

  it("the HAND REQUEST line names the run folder and the full answer path", () => {
    const run = join("run", "r1");
    const line = handLine(run, "w4-90-pap-save", "press Save");
    expect(line).toContain(`run folder: ${run}`);
    expect(line).toContain(handFiles(run, "w4-90-pap-save").answer);
  });

  it("a save prompt HANDOFF names the exact title, the answer No and the resume", () => {
    const h = handAnswer(
      'a dialog-like window appeared (Qt683QWindowIcon "Loading world")',
      "w4-60-play",
    );
    expect(h.title).toBe("Loading world");
    expect(h.answer).toBe("No");
    expect(h.instruction).toContain("--from w4-60-play");
  });

  it("selectSteps honours --only, --from, --until", () => {
    const steps = buildSteps();
    expect(selectSteps(steps, { only: "w4-30-module-info" })).toHaveLength(1);
    expect(typeof selectSteps(steps, { only: "nope" })).toBe("string");
    expect(typeof selectSteps(steps, { from: "w4-36-refusals", until: "w4-30-module-info" })).toBe(
      "string",
    );
    expect(selectSteps(steps, { from: "w4-30-module-info", until: "w4-36-refusals" })).toHaveLength(
      6,
    );
  });

  it("every step that opens a fixture in an editor ensures the fixtures itself (a resumed run)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    for (const s of buildSteps()) {
      const opens = (s.plan() as Array<Raw & { params?: Raw }>).some(
        (a) => a.toolAction === "setResource" && under(String(a.params?.path ?? "")),
      );
      if (!opens) continue;
      const at = src.indexOf(`id: "${s.id}"`);
      const body = src.slice(at, src.indexOf("run: async", at) + 400);
      expect(/ensureFixtures(OnDisk)?\(ctx\)|ensureWorld\(ctx/.test(body), s.id).toBe(true);
    }
    const at = src.indexOf("async function openInEditor(");
    expect(src.slice(at, src.indexOf("\n}\n", at))).toContain("openRefusal(ctx, module, rel)");
    const w = src.indexOf("async function openWorld(");
    expect(src.slice(w, src.indexOf("\n}\n", w))).toContain("missingWorldRefusal(ctx, rel)");
  });
});

// ── Fake deps for runBattery ──

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W4Tool, args: Raw) => ToolResponse;
  files?: Map<string, Buffer>;
  windows?: () => WindowInfo[];
}): W4Deps & { files: Map<string, Buffer>; sent: Array<[string, Raw]> } {
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
    info: async () =>
      over.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : over.info,
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async (): Promise<WindowInfo[]> => (over.windows ? over.windows() : []),
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

function opts(name: string, extra: Partial<W4Options> = {}): W4Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W4Options["ph"],
    build: "test",
    ...extra,
  };
}

/** Files in the fake file map (the planted ones by default). */
function plantFake(
  o: W4Options,
  deps: { files: Map<string, Buffer> },
  rels: readonly string[] = PLANTED,
): void {
  for (const rel of rels)
    deps.files.set(join(o.sandboxDir, ...rel.split("/")).replace(/\\/g, "/"), Buffer.from("x"));
}

function only(id: string) {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

const NAMED: ToolResponse = {
  ok: true,
  readback: { hasMeta: true, resourceName: "{0123456789ABCDEF}x" },
};

describe("W4 battery: runner stop rules", () => {
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
  });

  it("a LOST client code stops the battery and is not retried", async () => {
    const o = opts("lost");
    const deps = fakeDeps({
      tool: () => ({ ok: false, code: "LOST", message: "connection lost" }),
    });
    plantFake(o, deps);
    const r = await runBattery(only("w4-30-module-info"), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.status).toBe("STOPPED");
    expect(deps.sent).toHaveLength(1);
  });

  it("WEDGED stops cleanly: no close-out is sent after it", async () => {
    const o = opts("wedged");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "WEDGED", message: "wedged" }) });
    plantFake(o, deps);
    const r = await runBattery(only("w4-30-module-info"), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records.map((x) => x.step)).toEqual(["w4-30-module-info"]);
  });

  it("MODAL_OPEN is a HANDOFF", async () => {
    const o = opts("modal");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "MODAL_OPEN", message: "a modal" }) });
    plantFake(o, deps);
    const r = await runBattery(only("w4-30-module-info"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
  });

  it("three consecutive FAILs in one block stop the battery, and the closable step still runs", async () => {
    const o = opts("threefails");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "HANDLER_ERROR", message: "x" }) });
    plantFake(o, deps);
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = [
      "w4-30-module-info",
      "w4-31-anim-open",
      "w4-32-bt-open",
      "w4-33-types-open",
      "w4-95-netzero",
    ];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => (s.id === "w4-95-netzero" ? s : { ...s, run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual([
      "w4-30-module-info",
      "w4-31-anim-open",
      "w4-32-bt-open",
      CLOSABLE_STEP,
    ]);
  });

  it("the FAIL count resets at a block boundary, and W4.5's independent accepts never add up", async () => {
    expect(INDEPENDENT_BLOCKS.has("W4.5")).toBe(true);
    expect(failUnitOf({ id: "w4-50-graph-accept", block: "W4.5" })).not.toBe(
      failUnitOf({ id: "w4-51-set-accept", block: "W4.5" }),
    );
    const o = opts("unitfails");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = [
      "w4-36-refusals",
      "w4-49-lint-tools",
      "w4-50-graph-accept",
      "w4-51-set-accept",
      "w4-52-bt-accept",
      "w4-53-pap-accept",
      "w4-60-play",
    ];
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
      step: "w4-01-handlers",
      block: "W4.0",
      title: "x",
      status: "KILLED",
      detail: "x",
      startedAt: "",
      endedAt: "",
      probes: [{ id: "P-W4-01", result: "KILLED", observed: {}, note: "no answer" }],
      evidence: {},
    };
    deps.files.set(
      join(o.runDir, "w4-01-handlers.json").replace(/\\/g, "/"),
      Buffer.from(JSON.stringify(kill)),
    );
    const r = await runBattery(only("w4-20-txa-profiles"), deps, o);
    expect(r.records[0]!.status).toBe("SKIPPED");
    expect(r.records[0]!.detail).toContain("P-W4-01");
    expect(deps.sent).toEqual([]);
  });

  it("a step is never run twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps({});
    deps.files.set(join(o.runDir, "w4-30-module-info.json").replace(/\\/g, "/"), Buffer.from("{}"));
    const r = await runBattery(only("w4-30-module-info"), deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });

  it("with no export profile the TXA steps are NOT-RUN blocked:OI-W4-1 and send nothing else", async () => {
    const o = opts("noprofile");
    const deps = fakeDeps({ tool: () => ({ ok: true, readback: { total: 0, profiles: [] } }) });
    plantFake(o, deps);
    const steps = buildSteps().filter((s) =>
      ["w4-21-txa-channels", "w4-22-txa-export", "w4-23-txa-read", "w4-24-txa-edit"].includes(s.id),
    );
    const r = await runBattery(steps, deps, o);
    for (const rec of r.records) {
      expect(rec.status, rec.step).toBe("NOT-RUN");
      expect(rec.detail).toContain(BLOCKED_OI_W4_1);
    }
    expect(deps.sent.every(([n, a]) => n === "wb_anim" && a.action === "txaProfiles")).toBe(true);
  });

  it("a resumed run makes and registers the missing fixtures, and never opens a file not on disk", async () => {
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
    const r = await runBattery(only("w4-32-bt-open"), deps, o);
    const offline = deps.sent
      .filter(([n]) => !n.startsWith("wb_"))
      .map(([n, a]) => `${n}.${String(a.action)}`);
    expect(offline).toEqual([
      "animation_workspace.duplicate",
      "animation_workspace.duplicate",
      "behavior_tree.create",
      "procanim.create",
    ]);
    const regs = deps.sent.filter(([n, a]) => n === "wb_resources" && a.action === "register");
    expect(regs.map(([, a]) => a.path)).toEqual([...ANIM_SET, ...LIVE_FIXTURES]);
    expect(regs.every(([, a]) => a.confirm === true)).toBe(true);
    // The fake create wrote nothing: the .bt is not on disk, so no open is sent.
    expect(deps.sent.some(([n, a]) => n === "wb_module" && a.action === "setResource")).toBe(false);
    expect(r.records[0]!.status).toBe("FAIL");
    expect(r.records[0]!.detail).toMatch(/not on disk/);
  });

  it("a partly duplicated set stops the battery (roll back and plant again)", async () => {
    const o = opts("partial");
    const deps = fakeDeps({ tool: () => NAMED });
    plantFake(o, deps, [...PLANTED, ANIM_SET[0]!]);
    const r = await runBattery(only("w4-31-anim-open"), deps, o);
    expect(r.records[0]!.status).toBe("STOPPED");
    expect(r.records[0]!.detail).toMatch(/partly on disk/);
  });

  it("the gated actions answer their refusal and the step passes", async () => {
    const o = opts("refusals");
    const deps = fakeDeps({});
    plantFake(o, deps, [...PLANTED, ...ANIM_SET, BT, PAP]);
    deps.tool = async (name, args) => {
      deps.sent.push([name, args]);
      if (name === "wb_resources") return NAMED;
      if (name === "wb_module" && args.action === "front") return { ok: true, readback: {} };
      if (name === "wb_module" && args.action === "close")
        return { ok: false, code: "MODULE_NOT_SUPPORTED", message: "x" };
      // P-W4-10 killed (fix-up 1): save in the three editors refuses NO_DOCUMENT.
      if (name === "wb_module" && args.action === "save")
        return { ok: false, code: "NO_DOCUMENT", message: "x" };
      return { ok: false, code: "GATED", message: "x" };
    };
    const r = await runBattery(only("w4-36-refusals"), deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    const saves = deps.sent.filter(([n, a]) => n === "wb_module" && a.action === "save");
    expect(saves).toHaveLength(3);
    expect(saves.every(([, a]) => a.confirm === undefined)).toBe(true);
  });

  it("the hand step writes the request, logs the full answer path and reads the answer", async () => {
    const o = opts("hand");
    const deps = fakeDeps({ tool: () => NAMED });
    plantFake(o, deps, [...PLANTED, OFF_PAP]);
    const write = deps.writeBytes;
    const logged: string[] = [];
    deps.log = (l) => logged.push(l);
    deps.writeBytes = (p, b) => {
      write(p, b);
      if (/hand-.+\.request\.json$/.test(p.replace(/\\/g, "/")))
        write(p.replace(/\.request\.json$/, ".json"), Buffer.from(JSON.stringify({ saved: true })));
    };
    const r = await runBattery(only("w4-90-pap-save-hand"), deps, o);
    const hand = logged.filter((l) => l.startsWith("HAND REQUEST"));
    expect(hand).toHaveLength(1);
    expect(hand[0]).toContain(handFiles(o.runDir, "w4-90-pap-save").answer);
    // The fake file is unchanged by the "save": the probe is KILLED with the observation.
    expect(r.records[0]!.status).toBe("KILLED");
    expect(r.records[0]!.probes[0]!.id).toBe("P-W4-12");
  });

  it("--skip-hand records the hand step HELD and sends nothing", async () => {
    const o = opts("skiphand", { skipHand: true });
    const deps = fakeDeps({});
    plantFake(o, deps, [...PLANTED, OFF_PAP]);
    const r = await runBattery(only("w4-90-pap-save-hand"), deps, o);
    expect(r.records[0]!.status).toBe("HELD");
    expect(deps.sent).toEqual([]);
    expect(r.exit).toBe(EXIT.done);
  });
});

describe("W4 battery: net-zero", () => {
  function realFsDeps(): W4Deps {
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
  function sandbox(name: string): W4Options {
    const o = opts(name);
    put(o.sandboxDir, `${SANDBOX_NAME}.gproj`, "GameProject {}\n");
    put(o.sandboxDir, "Scripts/a.c", "class A {}\n");
    for (const rel of PLANTED) put(o.sandboxDir, rel, "plant\n");
    return o;
  }

  it("changes under _throwaway/W4/ are no change; resourceDatabase.rdb is recorded, not failed", async () => {
    const o = sandbox("nz-ok");
    const deps = realFsDeps();
    expect((await runBattery(only(GATE_STEP), deps, o)).records[0]!.status).toBe("PASS");
    put(o.sandboxDir, `${W4_ROOT}/created/x.agr`, "new\n");
    put(o.sandboxDir, "resourceDatabase.rdb", "db\n");
    expect(netZeroDiff(o.sittingDir, o.sandboxDir, deps)?.changed).toEqual([
      "resourceDatabase.rdb",
    ]);
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only("w4-95-netzero"), deps, o2)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
  });

  it("a real change outside the throwaway folder fails w4-95", async () => {
    const o = sandbox("nz-bad");
    const deps = realFsDeps();
    await runBattery(only(GATE_STEP), deps, o);
    put(o.sandboxDir, "Scripts/a.c", "changed\n");
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only("w4-95-netzero"), deps, o2)).records[0]!;
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Scripts/a.c");
  });

  it("a run that starts past the gate takes the snapshot itself", async () => {
    const o = sandbox("nz-resume");
    const deps = realFsDeps();
    const r = (await runBattery(only("w4-95-netzero"), deps, o)).records[0]!;
    const snap = JSON.parse(
      readFileSync(join(o.sittingDir, BATTERY_SNAPSHOT_FILE), "utf-8"),
    ) as Raw;
    expect(snap.taken_by).toBe("run start");
    expect(r.status).toBe("PASS");
  });
});

describe("W4 battery: plant and rollback", () => {
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

  it("plants the five copies and the folders, refuses while Workbench runs or when planted", async () => {
    const io = memIo();
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.done);
    for (const rel of PLANTED) expect(io.files.has(`${SB}/${rel}`), rel).toBe(true);
    for (const d of PLANT_DIRS) expect(io.dirs.has(`${SB}/${d}`), d).toBe(true);
    expect(io.files.has(`${SIT}/${PLANT_FILE}`)).toBe(true);
    expect(
      [...io.files.keys()]
        .filter((k) => k.startsWith(SB))
        .every((k) => k.startsWith(`${SB}/${W4_ROOT}/`)),
    ).toBe(true);
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.refused);
    expect(await runPlant(SB, SIT, true, memIo([7]))).toBe(EXIT.refused);
  });

  it("rollback lists and removes _throwaway/W4/ only", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    await runPlant(SB, SIT, true, io);
    io.files.set(`${SB}/${W4_ROOT}/created/W4_author.agr`, Buffer.from("c"));
    expect(runRollback(SB, SIT, true, io)).toBe(EXIT.done);
    expect([...io.files.keys()].some((k) => k.startsWith(`${SB}/${W4_ROOT}/`))).toBe(false);
    expect(io.files.has(`${SB}/${SANDBOX_NAME}.gproj`)).toBe(true);
    expect(io.files.has(`${SIT}/throwaway-w4-listing.json`)).toBe(true);
  });
});

describe("W4 cold run fix-up: the play-mode transition (w4-60, 1.9.0.37)", () => {
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
  const WE = win({
    hwnd: 2,
    title: "World Editor - EMCP2_sandbox/_throwaway/W4/worlds/EMCP_W4_Tiny.ent",
  });
  const MAIN = [win({ hwnd: 1, title: "Enfusion Workbench - EMCP2 sandbox (2.0 live lane)" }), WE];
  /** The cold run's change: the tool window added disabled, the World Editor window disabled (and dirty). */
  const PLAY = [
    MAIN[0]!,
    { ...WE, title: `${WE.title}*`, enabled: false },
    win({
      hwnd: 3,
      className: "Qt683QWindowToolSaveBits",
      title: "Arma Reforger Workbench",
      enabled: false,
    }),
  ];
  /** A real modal beside the transition: an owned window. */
  const MODAL = [
    ...PLAY,
    win({ hwnd: 4, className: "#32770", title: "Arma Reforger Workbench", owner: 2 }),
  ];

  /** Windows read MAIN, then `busy` reads of `during` from the first tool call on. */
  function playDeps(busy: number, during: WindowInfo[] = PLAY) {
    let left = -1;
    return fakeDeps({
      tool: () => {
        if (left < 0) left = busy;
        return { ok: true, readback: {} };
      },
      windows: () => {
        if (left > 0) {
          left--;
          return during;
        }
        return MAIN;
      },
    });
  }

  it("every polled step watches with the W5 busy-window grace (W8's WATCH_OPTIONS)", () => {
    expect(WATCH_OPTIONS).toEqual({ popups: false, busyGraceMs: BUSY_GRACE_MS });
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf8");
    expect(src).toContain("s.run(ctx), WATCH_OPTIONS)");
  });

  it("a transient tool window during play entry is not a handoff", async () => {
    const o = opts("playtransient");
    const deps = playDeps(5);
    plantFake(o, deps);
    const r = await runBattery(only("w4-30-module-info"), deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).not.toBe("HANDOFF");
    expect(r.exit).not.toBe(EXIT.handoff);
  });

  it("the same windows past the grace are a handoff that says so", async () => {
    const o = opts("playstays");
    const deps = playDeps(Number.MAX_SAFE_INTEGER);
    plantFake(o, deps);
    const r = await runBattery(only("w4-30-module-info"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).toMatch(/past the 60000 ms grace/);
  });

  it("a real modal beside the transition still hands off at once", async () => {
    const o = opts("playmodal");
    const deps = playDeps(Number.MAX_SAFE_INTEGER, MODAL);
    plantFake(o, deps);
    const r = await runBattery(only("w4-30-module-info"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).not.toMatch(/grace/);
  });

  it("w4-60 is a polled step (not a hand step), so the grace applies to it", () => {
    expect(only("w4-60-play")[0]!.hand ?? false).toBe(false);
  });

  it("w4-60 waits for edit mode after its stop, and its restorer does too", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf8");
    const at = src.indexOf('id: "w4-60-play"');
    const body = src.slice(at, src.indexOf('id: "w4-70-aliases"', at));
    const stop = body.indexOf('stop = await ctx.tool("wb_world", { action: "stop" }');
    expect(stop).toBeGreaterThan(0);
    expect(body.indexOf('waitMode(ctx, "edit")', stop)).toBeGreaterThan(stop);
    expect(body).toContain("await settleEdit(ctx.deps)");
  });

  it("the closable step leaves play mode before anything else: stop, then state until edit", async () => {
    const o = opts("closeplay");
    let stopped = false;
    let editReads = 0;
    const deps = fakeDeps({
      tool: (name, args) => {
        if (name === "wb_world" && args.action === "stop") stopped = true;
        if (name === "wb_world" && args.action === "state") {
          if (!stopped) return { ok: true, readback: { mode: "play", worldPath: "" } };
          editReads++;
          return { ok: true, readback: { mode: editReads < 3 ? "play" : "edit", worldPath: "" } };
        }
        return { ok: true, readback: {} };
      },
    });
    plantFake(o, deps);
    const r = await runBattery(only(CLOSABLE_STEP), deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    const world = deps.sent.filter(([n]) => n === "wb_world").map(([, a]) => a.action);
    expect(world).toEqual(["state", "stop", "state", "state", "state"]);
    expect((r.records[0]!.evidence as { editPolls: number }).editPolls).toBe(3);
  });

  it("the closable step FAILs when play is never left", async () => {
    const o = opts("closestuck");
    const deps = fakeDeps({
      tool: (name, args) =>
        name === "wb_world" && args.action === "state"
          ? { ok: true, readback: { mode: "play", worldPath: "" } }
          : { ok: true, readback: {} },
    });
    plantFake(o, deps);
    const r = await runBattery(only(CLOSABLE_STEP), deps, o);
    expect(r.records[0]!.status).toBe("FAIL");
    expect(r.records[0]!.detail).toMatch(new RegExp(`no edit mode after ${MODE_POLLS} poll`));
  });
});
