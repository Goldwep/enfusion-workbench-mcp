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
import { inflateSync } from "node:zlib";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { BUSY_GRACE_MS } from "../../scripts/census/live/common.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  BATTERY_SNAPSHOT_FILE,
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  DOMAIN_CODES,
  absentMeta,
  binaryKind,
  enumTextForm,
  failUnitOf,
  formatProbe,
  INDEPENDENT_BLOCKS,
  layoutNode,
  metaRelOf,
  EXIT,
  FILE_WRITE_ACTIONS,
  GATE_STEP,
  LAUNCH_ARGS,
  LIVE_FIXTURES,
  NOT_EXERCISED,
  NOT_TESTABLE,
  PLANTED,
  PLANT_DIRS,
  PLANT_FILE,
  PROBE_IDS,
  SCRIPT_PATH,
  TS_ONLY_ACTIONS,
  W2_CONTRACTS,
  W2_ROOT,
  buildActionPlan,
  buildQueue,
  buildSteps,
  dryRunCheck,
  exercisedBy,
  exactLineDiff,
  handAnswer,
  handFiles,
  handLine,
  main,
  missingWorldRefusal,
  netZeroDiff,
  offlinePlan,
  pickEnumVar,
  runBattery,
  runPlant,
  runRollback,
  selectSteps,
  solidPng,
  type OfflineIo,
  type ToolResponse,
  type W2Deps,
  type W2Options,
  type W2Tool,
  WATCH_OPTIONS,
} from "../live/w2.live.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-w2-"));
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

const under = (p: string): boolean => p.replace(/\\/g, "/").startsWith(`${W2_ROOT}/`);

describe("W2 battery: the dry-run gate", () => {
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
    expect(LAUNCH_ARGS.join(" ")).toContain("w2-scratch.ini");
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("step ids are unique, w2-NN-..., the gate first and the closable step last", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w2-\d\d-[a-z0-9-]+$/);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids[ids.length - 1]).toBe(CLOSABLE_STEP);
    for (const s of steps) {
      expect(s.expected.length, s.id).toBeGreaterThan(10);
      expect(s.kill_criterion.length, s.id).toBeGreaterThan(5);
    }
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

describe("W2 battery: coverage", () => {
  const steps = buildSteps();
  const exercised = new Set(steps.flatMap(exercisedBy));

  it("every action of the four W2 contracts is exercised or in NOT_EXERCISED with a reason", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W2_CONTRACTS)) {
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
    // The 1.x name of search is sent too.
    expect(exercised.has("wb_resources.browse")).toBe(true);
  });

  it("the TS-only lists match the tools' own action lists", async () => {
    const cfg = await import("../../src/tools/config-edit.js");
    const ps = await import("../../src/tools/project-settings.js");
    expect([...TS_ONLY_ACTIONS.config_edit].sort()).toEqual([...cfg.CONFIG_EDIT_ACTIONS].sort());
    expect([...TS_ONLY_ACTIONS.project_settings].sort()).toEqual(
      [...ps.PROJECT_SETTINGS_ACTIONS].sort(),
    );
    const layout = readFileSync(join(REPO_ROOT, "src/tools/layout-edit.ts"), "utf-8");
    for (const a of TS_ONLY_ACTIONS.layout_edit) expect(layout, a).toContain(`"${a}"`);
  });

  it("every probe P-W2-01..25 is assigned to a step or listed as not testable with a reason", () => {
    expect(PROBE_IDS).toHaveLength(25);
    const assigned = new Set(steps.flatMap((s) => s.probes));
    for (const id of PROBE_IDS) {
      const ok = assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10;
      expect(ok, id).toBe(true);
    }
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of steps) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
  });

  it("every probe of the inbox file is one of P-W2-01..25", () => {
    const lines = readFileSync(join(REPO_ROOT, "docs/v2/inbox/w2/probes.jsonl"), "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    const ids = lines.map((l) => String((JSON.parse(l) as Raw).id));
    expect([...ids].sort()).toEqual([...PROBE_IDS].sort());
  });
});

describe("W2 battery: writes stay under _throwaway/W2/", () => {
  const steps = buildSteps();

  it("every declared write lies under _throwaway/W2/", () => {
    for (const s of steps) for (const w of s.writes) expect(under(w), `${s.id} ${w}`).toBe(true);
  });

  it("every file-writing tool call in the plan names a file under _throwaway/W2/", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (!FILE_WRITE_ACTIONS.has(key)) continue;
      const p = a.params ?? {};
      // wb_container's `path` is a property path; its file is the target or the resource. A
      // class:<Name> write is refused WRONG_MODE before sending (w2-14 proves it): no file.
      if (a.tool === "wb_container" && String(p.target).startsWith("class:")) {
        expect(a.step).toBe("w2-14-schema");
        continue;
      }
      const keys = a.tool === "wb_container" ? ["target", "resource"] : ["path", "paths", "to"];
      const files = keys
        .flatMap((k) => (Array.isArray(p[k]) ? (p[k] as unknown[]) : [p[k]]))
        .filter((v): v is string => typeof v === "string")
        .filter((v) => v !== "open:ResourceManager")
        .map((v) => v.replace(/^path:/, ""));
      expect(files.length, `${String(a.step)} ${key}`).toBeGreaterThan(0);
      for (const v of files) expect(under(v), `${String(a.step)} ${key} ${v}`).toBe(true);
    }
  });

  it("every confirmed offline write names files under _throwaway/W2/; override is never confirmed", () => {
    for (const c of offlinePlan(steps)) {
      const p = c.params;
      if (c.action === "override") expect(p.confirm, c.step).not.toBe(true);
      if (p.confirm !== true) continue;
      const files = ["path", "newPath", "to"]
        .map((k) => p[k])
        .filter((v): v is string => typeof v === "string");
      expect(files.length, `${c.step} ${c.tool}.${c.action}`).toBeGreaterThan(0);
      for (const v of files) expect(under(v), `${c.step} ${c.tool}.${c.action} ${v}`).toBe(true);
    }
  });

  it("no plan entry calls a denied API or saves a world", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      if (a.kind !== "net-call") continue;
      expect(String(a.target)).not.toMatch(/RunCommandline|Workbench\.(Exit|RunCmd|RunProcess)/);
      expect(String(a.target)).not.toBe("EMCP_WB_Save");
      if (a.params?.action === "save") {
        // Only the Resource Manager's one opened .conf (w2-50) is saved; wb_module save is the
        // refusal check of w2-90 (MODULE_NOT_SUPPORTED before sending).
        if (a.tool === "wb_module") expect(a.step).toBe("w2-90-aliases");
        else expect(a.tool).toBe("wb_container");
      }
    }
  });

  it("the plant writes only under _throwaway/W2/ and the planted files are the fixtures", () => {
    for (const p of [...PLANTED, ...PLANT_DIRS]) expect(under(p), p).toBe(true);
    for (const f of LIVE_FIXTURES) expect(PLANTED).toContain(f);
  });
});

describe("W2 battery: helpers and selection", () => {
  it("exactLineDiff counts removed and added lines", () => {
    expect(exactLineDiff("a\nb\nc", "a\nB\nc")).toEqual({ removed: ["b"], added: ["B"] });
    expect(exactLineDiff("x\ny", "x\ny")).toEqual({ removed: [], added: [] });
  });

  it("pickEnumVar takes an enum variable with two entries and a value other than the current", () => {
    const rows = [
      { name: "Size", enum: "", value: "1", setDirectly: "0" },
      { name: "Conversion", enum: "None=0|Normal=1|Gloss=2", value: "0", setDirectly: "0" },
      { name: "ColorSpace", enum: "ToLinear=0|Linear=1", value: "Linear", setDirectly: "1" },
    ];
    expect(pickEnumVar(rows)).toEqual({
      name: "ColorSpace",
      current: "Linear",
      other: "ToLinear",
      currentValue: "1",
      otherValue: "0",
      setDirectly: true,
    });
    expect(pickEnumVar([{ name: "X", enum: "", value: "1" }])).toBeNull();
    // Run 1's row: the value as its number, the entries "ToLinear=2|ToSRGB=1".
    expect(
      pickEnumVar([
        { name: "ColorSpace", enum: "ToLinear=2|ToSRGB=1", value: "1", setDirectly: "false" },
      ]),
    ).toEqual({
      name: "ColorSpace",
      current: "ToSRGB",
      other: "ToLinear",
      currentValue: "1",
      otherValue: "2",
      setDirectly: false,
    });
  });

  it("metaRelOf: a .png's .meta is beside the .edds it registered as (run 1), else <rel>.meta", () => {
    expect(metaRelOf("_throwaway/W2/W2_tex_co.png")).toBe("_throwaway/W2/W2_tex_co.edds.meta");
    expect(
      metaRelOf("_throwaway/W2/W2_tex_co.png", "{8BB6157363C94FBC}_throwaway/W2/W2_tex_co.edds"),
    ).toBe("_throwaway/W2/W2_tex_co.edds.meta");
    expect(metaRelOf("_throwaway/W2/W2_cfg.conf")).toBe("_throwaway/W2/W2_cfg.conf.meta");
    expect(
      metaRelOf("_throwaway/W2/W2_cfg.conf", "{C984F03E1A9A14A0}_throwaway/W2/W2_cfg.conf"),
    ).toBe("_throwaway/W2/W2_cfg.conf.meta");
  });

  it("absentMeta names an absent .meta instead of reading it as a change (run 1: same(null, null))", () => {
    expect(absentMeta("a.meta", Buffer.from("x"), Buffer.from("x"))).toBeNull();
    expect(absentMeta("a.meta", null, null)).toMatch(/a\.meta is absent on disk at 2 of 2 reads/);
  });

  it("enumTextForm reads how the engine wrote an enum into the .meta text", () => {
    expect(enumTextForm(["   ColorSpace 2"], "ColorSpace")).toBe("number");
    expect(enumTextForm(['   ColorSpace "ToLinear"'], "ColorSpace")).toBe("name");
    expect(enumTextForm(["   Conversion 8"], "ColorSpace")).toBe("");
  });

  it("binaryKind tells an IFF FORM file (run 1's .fnt) and NUL bytes from text", () => {
    const fnt = Buffer.concat([
      Buffer.from("FORM"),
      Buffer.from([0, 0, 8, 0x12]),
      Buffer.from("FNT5HEAD"),
    ]);
    expect(binaryKind(fnt)).toBe("FORM/FNT5");
    expect(binaryKind(Buffer.from([0x41, 0, 0x42]))).toBe("binary");
    expect(binaryKind(Buffer.from("RplComponent {\n}"))).toBeNull();
  });

  it("formatProbe records a binary format without feeding it to the parser", () => {
    const files: Record<string, Buffer> = {
      "a/x.ct": Buffer.from("RplComponent {\n}"),
      "a/y.fnt": Buffer.concat([
        Buffer.from("FORM"),
        Buffer.from([0, 0, 8, 0x12]),
        Buffer.from("FNT5HEAD"),
      ]),
    };
    const fs = {
      paths: () => Object.keys(files),
      read: (p: string) => files[p]!,
      exists: (p: string) => p in files,
    };
    const r = formatProbe(fs as never, [".ct", ".fnt"]);
    expect(r[".ct"]!.parses).toBe(true);
    expect(r[".fnt"]).toMatchObject({
      binary: true,
      magic: "FORM/FNT5",
      parses: false,
      binarySampled: "1 of 1",
    });
  });

  it("DOMAIN_CODES counts the handler's own ENGINE_FALSE and STALE_CURSOR as an answer (run 1 w2-01)", () => {
    expect(DOMAIN_CODES.has("ENGINE_FALSE")).toBe(true);
    expect(DOMAIN_CODES.has("STALE_CURSOR")).toBe(true);
    expect(DOMAIN_CODES.has("UNREACHABLE")).toBe(false);
    expect(DOMAIN_CODES.has("HANDLER_ERROR")).toBe(false);
  });

  it("solidPng writes a valid PNG of the size asked", () => {
    const b = solidPng(4, 3, [1, 2, 3, 255]);
    expect(b.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(b.readUInt32BE(16)).toBe(4);
    expect(b.readUInt32BE(20)).toBe(3);
    const idatLen = b.readUInt32BE(33);
    const raw = inflateSync(b.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(3 * (1 + 4 * 4));
  });

  it("the HAND REQUEST line names the run folder and the full answer path", () => {
    const run = join("run", "r1");
    const line = handLine(run, "w2-81-context-conf-open", "right-click");
    expect(line).toContain(`run folder: ${run}`);
    expect(line).toContain(handFiles(run, "w2-81-context-conf-open").answer);
    expect(handFiles(run, "k").request).toBe(join(run, "hand-k.request.json"));
  });

  it("an open of a _throwaway world that is not on disk is refused before it is sent", () => {
    const ctx = (present: boolean) => ({
      opts: { sandboxDir: join("sb") },
      deps: { exists: () => present },
    });
    expect(missingWorldRefusal(ctx(false), `${W2_ROOT}/worlds/Gone.ent`)).toMatch(/not on disk/);
    expect(missingWorldRefusal(ctx(true), `${W2_ROOT}/worlds/Here.ent`)).toBeNull();
    expect(missingWorldRefusal(ctx(false), "worlds/Arland/EmptyArland.ent")).toBeNull();
  });

  it("a save prompt HANDOFF names the exact title, the answer No and the resume", () => {
    const h = handAnswer(
      'a dialog-like window appeared (Qt683QWindowIcon "Loading world")',
      "w2-60-prefab-model",
    );
    expect(h.title).toBe("Loading world");
    expect(h.answer).toBe("No");
    expect(h.instruction).toContain("--from w2-60-prefab-model");
  });

  it("selectSteps honours --only, --from, --until", () => {
    const steps = buildSteps();
    expect(selectSteps(steps, { only: "w2-10-resolve" })).toHaveLength(1);
    expect(typeof selectSteps(steps, { only: "nope" })).toBe("string");
    expect(typeof selectSteps(steps, { from: "w2-50-rm-open", until: "w2-10-resolve" })).toBe(
      "string",
    );
    expect(
      selectSteps(steps, { from: "w2-80-selection-hand", until: "w2-85-context-layout" }),
    ).toHaveLength(6);
  });

  it("every step that sends to a fixture ensures the fixtures itself (a resumed run)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    for (const s of buildSteps()) {
      const sends = s.plan().some((a) => typeof (a as Raw).tool === "string");
      if (!sends || s.id === CLOSABLE_STEP || s.id === "w2-01-handlers") continue;
      const at = src.indexOf(`id: "${s.id}"`);
      if (at < 0) continue; // the context steps are built by contextStep()
      const body = src.slice(at, src.indexOf("run: async", at) + 600);
      expect(/ensureFixtures(OnDisk)?\(ctx\)|ensureWorld\(ctx/.test(body), s.id).toBe(true);
    }
    const at = src.indexOf("async function openWorld(");
    expect(src.slice(at, src.indexOf("\n}\n", at))).toContain("missingWorldRefusal(ctx, rel)");
  });
});

// ── Fake deps for runBattery ──

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W2Tool, args: Raw) => ToolResponse;
  files?: Map<string, Buffer>;
}): W2Deps & { files: Map<string, Buffer>; sent: Array<[string, Raw]> } {
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
    windows: async (): Promise<WindowInfo[]> => [],
    recordedPid: () => PID,
    contextRead: async () => ({
      read: true,
      items: ["Open", "Copy path"],
      detail: "read",
      artifact: null,
    }),
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

function opts(name: string): W2Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W2Options["ph"],
    build: "test",
  };
}

/** The planted files in the fake file map. */
function plantFake(o: W2Options, deps: { files: Map<string, Buffer> }): void {
  for (const rel of PLANTED)
    deps.files.set(join(o.sandboxDir, ...rel.split("/")).replace(/\\/g, "/"), Buffer.from("x"));
}

function only(id: string) {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

describe("W2 battery: runner stop rules", () => {
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
    const r = await runBattery(only("w2-10-resolve"), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.status).toBe("STOPPED");
    expect(deps.sent).toHaveLength(1);
  });

  it("MODAL_OPEN is a HANDOFF", async () => {
    const o = opts("modal");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "MODAL_OPEN", message: "a modal" }) });
    plantFake(o, deps);
    const r = await runBattery(only("w2-10-resolve"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
  });

  it("three consecutive FAILs in one block stop the battery, and the closable step still runs", async () => {
    const o = opts("threefails");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "HANDLER_ERROR", message: "x" }) });
    plantFake(o, deps);
    const steps = buildSteps().filter((s) =>
      [
        "w2-10-resolve",
        "w2-13-info-link",
        "w2-16-bi-reads",
        "w2-90-aliases",
        "w2-95-netzero",
      ].includes(s.id),
    );
    // ensureFixtures resolves first: the fixture answer must hold a .meta, else it stops.
    deps.tool = async (name, args) => {
      deps.sent.push([name, args]);
      if (name === "wb_resources" && args.action === "resolve")
        return { ok: true, readback: { hasMeta: true, resourceName: "{0123456789ABCDEF}x" } };
      return { ok: false, code: "HANDLER_ERROR", message: "x" };
    };
    const r = await runBattery(steps, deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual([
      "w2-10-resolve",
      "w2-13-info-link",
      "w2-16-bi-reads",
      CLOSABLE_STEP,
    ]);
  });

  it("the FAIL count resets at a block boundary, and W2.7's independent accepts never add up (run 3)", async () => {
    expect(INDEPENDENT_BLOCKS.has("W2.7")).toBe(true);
    expect(failUnitOf({ id: "w2-72-layout-edit", block: "W2.7" })).not.toBe(
      failUnitOf({ id: "w2-73-config-edit", block: "W2.7" }),
    );
    expect(failUnitOf({ id: "w2-10-resolve", block: "W2.1" })).toBe(
      failUnitOf({ id: "w2-13-info-link", block: "W2.1" }),
    );
    const o = opts("unitfails");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    // One FAIL in W2.4, one in W2.5, five in W2.7, one in W2.9: no unit holds three.
    const ids = [
      "w2-40-create",
      "w2-50-rm-open",
      "w2-70-meta-file",
      "w2-71-imageset",
      "w2-72-layout-edit",
      "w2-73-config-edit",
      "w2-74-project-settings",
      "w2-90-aliases",
    ];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => ({ ...s, run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.message ?? "").not.toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual(ids);
    expect(r.records.every((x) => x.status === "FAIL")).toBe(true);
  });

  it("finds a layout's widget among the child nodes a describe summary lists", () => {
    const nodes = [
      '#0=RichTextWidgetClass "W2_T2" (0 nodes)',
      '#1=TextWidgetClass "W2_T" (0 nodes)',
      "#=60 nodes, the first 50 listed",
    ];
    expect(layoutNode(nodes, "TextWidgetClass", "W2_T")).toBe(1);
    expect(layoutNode(nodes, "TextWidgetClass", "W2_T2")).toBeNull();
    expect(layoutNode(["Slot=FrameWidgetSlot (12 rows)"], "TextWidgetClass", "W2_T")).toBeNull();
  });

  it("a step that depends on a killed probe is SKIPPED with the reason", async () => {
    const o = opts("skip");
    const deps = fakeDeps({});
    const kill = {
      step: "w2-01-handlers",
      block: "W2.0",
      title: "x",
      status: "KILLED",
      detail: "x",
      startedAt: "",
      endedAt: "",
      probes: [{ id: "P-W2-01", result: "KILLED", observed: {}, note: "Validate does not answer" }],
      evidence: {},
    };
    deps.files.set(
      join(o.runDir, "w2-01-handlers.json").replace(/\\/g, "/"),
      Buffer.from(JSON.stringify(kill)),
    );
    const r = await runBattery(only("w2-15-material"), deps, o);
    expect(r.records[0]!.status).toBe("SKIPPED");
    expect(r.records[0]!.detail).toContain("P-W2-01");
  });

  it("a step is never run twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps({});
    deps.files.set(join(o.runDir, "w2-10-resolve.json").replace(/\\/g, "/"), Buffer.from("{}"));
    const r = await runBattery(only("w2-10-resolve"), deps, o);
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
    await runBattery(only("w2-13-info-link"), deps, o);
    const regs = deps.sent.filter(([n, a]) => n === "wb_resources" && a.action === "register");
    expect(regs.map(([, a]) => a.path)).toEqual([...LIVE_FIXTURES]);
    expect(regs.every(([, a]) => a.confirm === true)).toBe(true);
  });

  it("a context-menu hand step writes the request, reads the popup passively and asks for Esc", async () => {
    const o = opts("hand");
    const deps = fakeDeps({});
    plantFake(o, deps);
    const write = deps.writeBytes;
    const logged: string[] = [];
    deps.log = (l) => logged.push(l);
    deps.writeBytes = (p, b) => {
      write(p, b);
      const m = /hand-(.+)\.request\.json$/.exec(p.replace(/\\/g, "/"));
      if (m) {
        const answer = m[1]!.endsWith("-open") ? { opened: true } : { closed: true };
        write(p.replace(/\.request\.json$/, ".json"), Buffer.from(JSON.stringify(answer)));
      }
    };
    const r = await runBattery(only("w2-81-context-conf"), deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    expect(r.records[0]!.detail).toContain("Copy path");
    const hand = logged.filter((l) => l.startsWith("HAND REQUEST"));
    expect(hand).toHaveLength(2);
    expect(hand[0]).toContain(handFiles(o.runDir, "w2-81-context-conf-open").answer);
    expect(deps.sent).toEqual([]);
  });
});

describe("W2 battery: net-zero", () => {
  function realFsDeps(): W2Deps {
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
  function sandbox(name: string): W2Options {
    const o = opts(name);
    put(o.sandboxDir, `${SANDBOX_NAME}.gproj`, "GameProject {}\n");
    put(o.sandboxDir, "Scripts/a.c", "class A {}\n");
    for (const rel of PLANTED) put(o.sandboxDir, rel, "plant\n");
    return o;
  }

  it("changes under _throwaway/W2/ are no change; resourceDatabase.rdb is recorded, not failed", async () => {
    const o = sandbox("nz-ok");
    const deps = realFsDeps();
    expect((await runBattery(only(GATE_STEP), deps, o)).records[0]!.status).toBe("PASS");
    put(o.sandboxDir, `${W2_ROOT}/created/x.conf`, "new\n");
    put(o.sandboxDir, "resourceDatabase.rdb", "db\n");
    expect(netZeroDiff(o.sittingDir, o.sandboxDir, deps)?.changed).toEqual([
      "resourceDatabase.rdb",
    ]);
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only("w2-95-netzero"), deps, o2)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
  });

  it("a real change outside the throwaway folder fails w2-95", async () => {
    const o = sandbox("nz-bad");
    const deps = realFsDeps();
    await runBattery(only(GATE_STEP), deps, o);
    put(o.sandboxDir, "Scripts/a.c", "changed\n");
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only("w2-95-netzero"), deps, o2)).records[0]!;
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Scripts/a.c");
  });

  it("a run that starts past the gate takes the snapshot itself", async () => {
    const o = sandbox("nz-resume");
    const deps = realFsDeps();
    const r = (await runBattery(only("w2-95-netzero"), deps, o)).records[0]!;
    const snap = JSON.parse(
      readFileSync(join(o.sittingDir, BATTERY_SNAPSHOT_FILE), "utf-8"),
    ) as Raw;
    expect(snap.taken_by).toBe("run start");
    expect(r.status).toBe("PASS");
  });
});

describe("W2 battery: plant and rollback", () => {
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

  it("plants the eight files and three folders, refuses while Workbench runs or when planted", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.done);
    for (const rel of PLANTED) expect(io.files.has(`${SB}/${rel}`), rel).toBe(true);
    for (const d of PLANT_DIRS) expect(io.dirs.has(`${SB}/${d}`), d).toBe(true);
    expect(io.files.has(`${SIT}/${PLANT_FILE}`)).toBe(true);
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.refused);
    expect(await runPlant(SB, SIT, true, memIo([7]))).toBe(EXIT.refused);
  });

  it("rollback lists and removes _throwaway/W2/ only", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    await runPlant(SB, SIT, true, io);
    io.files.set(`${SB}/${W2_ROOT}/created/W2_probe.conf`, Buffer.from("c"));
    expect(runRollback(SB, SIT, true, io)).toBe(EXIT.done);
    expect([...io.files.keys()].some((k) => k.startsWith(`${SB}/${W2_ROOT}/`))).toBe(false);
    expect(io.files.has(`${SB}/${SANDBOX_NAME}.gproj`)).toBe(true);
    expect(io.files.has(`${SIT}/throwaway-w2-listing.json`)).toBe(true);
  });
});

describe("W2 battery: W1 cold run fix-up audit (busy windows are graced, 1.9.0.37)", () => {
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
    win({ hwnd: 2, title: "World Editor - EMCP2_sandbox/_throwaway/W2/worlds/x.ent" }),
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

  it("w2-01-handlers watches with the busy-window grace", () => {
    expect(WATCH_OPTIONS).toMatchObject({ busyGraceMs: BUSY_GRACE_MS });
  });

  it("a transient busy change (the editor windows disabled for a while) is not a handoff", async () => {
    const o = opts("busytransient");
    const { deps, seen } = busyDeps(5);
    plantFake(o, deps);
    const r = await runBattery(only("w2-01-handlers"), deps, o);
    expect(seen()).toBe(true);
    expect(r.records[0]!.status, r.records[0]!.detail).not.toBe("HANDOFF");
    expect(r.exit).not.toBe(EXIT.handoff);
  });

  it("the same windows past the grace are a handoff that says so", async () => {
    const o = opts("busystays");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER);
    plantFake(o, deps);
    const r = await runBattery(only("w2-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).toMatch(/past the 60000 ms grace/);
  });

  it("a real modal beside the busy windows still hands off at once", async () => {
    const o = opts("busymodal");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER, MODAL);
    plantFake(o, deps);
    const r = await runBattery(only("w2-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).not.toMatch(/grace/);
  });
});
