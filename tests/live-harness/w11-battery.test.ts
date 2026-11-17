import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import {
  AE_CONTROLS,
  AE_CREATED,
  AW_CREATE,
  CLOSABLE_STEP,
  CONFIG_CASES,
  ENTITY_DUP_DEST,
  EXCLUDED,
  EXIT,
  FORMAT_FIXTURE,
  GATE_STEP,
  NETZERO_STEP,
  MOVE_FIXTURE,
  MOVE_SOURCE,
  PLANT_DIRS,
  PLANT_FILE,
  REF_CHILD,
  REF_CONF,
  REF_CONF_CLASS,
  REF_PARENT,
  SIGA_SET,
  SIGA_TL,
  containerPath,
  pickGets,
  pickWatch,
  refConfText,
  SCRIPT_PATH,
  W11_ROOT,
  buildActionPlan,
  buildQueue,
  buildSteps,
  dryRunCheck,
  gprojId,
  liveFileOf,
  main,
  namedVanillaEntity,
  pickScalar,
  plantSources,
  recordPath,
  runBattery,
  runPlant,
  runRollback,
  selectSteps,
  sigaMissReason,
  under,
  w11PlanViolations,
  withDuplicateDependency,
  type OfflineIo,
  type OfflineTool,
  type RefactorPlan,
  type StepDef,
  type ToolResponse,
  type W11Deps,
  type W11Options,
  type W11Tool,
} from "../live/w11.live.js";

type Raw = Record<string, unknown>;

const TMP = mkdtempSync(join(tmpdir(), "emcp-w11-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 1111;
const norm = (p: string): string => p.replace(/\\/g, "/");
const PHYS = CONFIG_CASES.find((c) => c.ext === ".physmat")!;

interface Sim {
  /** describe answers this error for a path containing the key. */
  reject?: Record<string, ToolResponse>;
  /** describe answers ok but without the file's text (a needle not read back). */
  blind?: boolean;
  /** The refactor plan's files (absolute). */
  plan?: (o: W11Options) => RefactorPlan;
  info?: Raw | null;
  stamp?: string;
  /** wb_container get answers this readback (the second read-back). */
  get?: (args: Raw) => Raw;
}

type Fake = W11Deps & {
  files: Map<string, Buffer>;
  dirs: Set<string>;
  sent: Array<[string, Raw]>;
  offlineSent: Array<[OfflineTool, Raw]>;
};

function fakeDeps(o: W11Options, sim: Sim = {}): Fake {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const sent: Array<[string, Raw]> = [];
  const offlineSent: Array<[OfflineTool, Raw]> = [];
  const at = (rel: string): string => norm(join(o.sandboxDir, ...rel.split("/")));
  const tool = (name: W11Tool, args: Raw): ToolResponse => {
    if (name === "wb_resources" && args.action === "register") {
      const rel = String(args.path);
      files.set(`${at(rel)}.meta`, Buffer.from('MetaFileClass {\n Name "{ABCDEF0123456789}' + rel + '"\n}\n'));
      return { ok: true, readback: { resourceName: `{ABCDEF0123456789}${rel}` } };
    }
    if (name === "wb_container" && args.action === "describe") {
      const rel = String(args.target).replace(/^path:/, "");
      for (const [k, r] of Object.entries(sim.reject ?? {})) if (rel.includes(k)) return r;
      const text = sim.blind ? "" : (files.get(at(rel))?.toString("utf-8") ?? "");
      if (args.mode === "page")
        return { ok: true, readback: { rows: [{ path: "root", name: "text", type: "string", value: text }] } };
      return { ok: true, readback: { rootClass: "PhysicsMaterial", total: 1, children: [] } };
    }
    if (name === "wb_container" && args.action === "get")
      return { ok: true, readback: sim.get ? sim.get(args) : {} };
    if (name === "wb_world" && args.action === "state") return { ok: true, readback: { mode: "edit", worldPath: "" } };
    return { ok: true, readback: {} };
  };
  const offline = (name: OfflineTool, args: Raw): ToolResponse => {
    if (name === "config_edit") {
      const p = at(String(args.path));
      const text = files.get(p)?.toString("utf-8") ?? "";
      if (args.action === "read") {
        const m = /Friction\s+([-\d.]+)/.exec(text);
        return {
          ok: true,
          readback: { entries: m ? [{ key: "Friction", kind: "scalar", path: "Friction", value: m[1] }] : [] },
        };
      }
      if (args.action === "set" && args.confirm)
        files.set(p, Buffer.from(text.replace(/Friction\s+[-\d.]+/, `Friction ${String(args.value)}`)));
      return { ok: true, readback: {} };
    }
    return { ok: true, readback: {} };
  };
  return {
    files,
    dirs,
    sent,
    offlineSent,
    tool: async (name, args) => {
      sent.push([name, args]);
      return tool(name, args);
    },
    offline: async (name, args) => {
      offlineSent.push([name, args]);
      return offline(name, args);
    },
    refactorPlan: async () => (sim.plan ? sim.plan(o) : { ok: true, files: [], detail: "none" }),
    info: async () => (sim.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : sim.info),
    ping: async () => ({ buildStamp: sim.stamp ?? "abc" }),
    bundleDigest: () => "abc",
    windows: async () => [],
    recordedPid: () => PID,
    commandLine: async () => `ArmaReforgerWorkbenchSteamDiag.exe -forceSettings ${join(o.sittingDir, "scratch.ini")}`,
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
    newGuid: () => "1234567890ABCDEF",
    now: () => Date.now(),
    sleep: async () => undefined,
    log: () => undefined,
  };
}

function opts(name: string): W11Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W11Options["ph"],
    build: "test",
  };
}

function only(steps: StepDef[], id: string): StepDef[] {
  const s = selectSteps(steps as never, { only: id }) as StepDef[] | string;
  if (typeof s === "string") throw new Error(s);
  return s;
}

function record(o: W11Options, step: string): Raw {
  return JSON.parse(readFileSync(recordPath(o.runDir, step), "utf-8")) as Raw;
}

function liveLines(o: W11Options, step: string): Raw[] {
  const p = join(o.sittingDir, liveFileOf(step));
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Raw);
}

/** The test bed with its .gproj, the planted folders and the planted .physmat. */
function sandbox(o: W11Options, deps: Fake, plantPhys = true): void {
  deps.files.set(norm(join(o.sandboxDir, `${SANDBOX_NAME}.gproj`)), Buffer.from('GameProject {\n ID "EMCP2_sandbox"\n}\n'));
  for (const d of PLANT_DIRS) deps.dirs.add(norm(join(o.sandboxDir, ...d.split("/"))));
  if (plantPhys)
    for (const rel of [PHYS.rel, REF_PARENT])
      deps.files.set(norm(join(o.sandboxDir, ...rel.split("/"))), Buffer.from("PhysicsMaterial {\n Friction 0.7\n Restitution 0.2\n}\n"));
}

const physStep = (): string => buildSteps().find((s) => s.writes.includes(PHYS.rel))!.id;

// ── Offline: plan, queue, census tags ────────────────────────────────────────

describe("W11 plan and queue", () => {
  it("the plan passes checkPlan and the W11 plan check, never saves or closes, and the queue validates", () => {
    const plan = buildActionPlan();
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT_PATH }).ok).toBe(true);
    expect(w11PlanViolations(buildSteps())).toEqual([]);
    expect(dryRunCheck(loadPolicy()).ok).toBe(true);
    for (const a of plan) expect(String(a.toolAction ?? ""), JSON.stringify(a)).not.toMatch(/save|close|set$/i);
    expect(validateQueue(buildQueue(), false).length).toBe(buildSteps().length);
  });

  it("starts with the gate and ends with net-zero and the closable step; the index steps run before any .gproj step", () => {
    const ids = buildSteps().map((s) => s.id);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids.slice(-2)).toEqual([NETZERO_STEP, CLOSABLE_STEP]);
    const firstGproj = ids.findIndex((i) => /mod-create|rename-project-id/.test(i));
    expect(ids.indexOf("w11-40-replace-guid")).toBeLessThan(firstGproj);
    expect(ids.indexOf("w11-41-move-resource-path")).toBeLessThan(firstGproj);
  });

  it("the W11 plan check refuses a save, a write outside the throwaway folder, an override and include_workshop", () => {
    const base = buildSteps()[1]!;
    const bad: StepDef = {
      ...base,
      id: "w11-bad",
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_World", tool: "wb_world", toolAction: "save", params: { action: "save" } } as never,
        { kind: "net-call", target: "EMCP_WB_Resources", tool: "wb_resources", toolAction: "register", params: { action: "register", path: "Prefabs/X.et" } } as never,
      ],
      offlineCalls: () => [
        { tool: "config_edit", params: { action: "override", path: `${W11_ROOT}/config/x.emat` } },
        { tool: "refactor_replace_guid", params: { old_guid: "A", new_guid: "B", include_workshop: true } },
        { tool: "faction_create", params: { out_path: "Configs/Factions/X.conf" } },
      ],
    };
    const v = w11PlanViolations([bad]);
    expect(v.join("\n")).toMatch(/not an allowed wb_world action/);
    expect(v.join("\n")).toMatch(/path Prefabs\/X\.et is outside/);
    expect(v.join("\n")).toMatch(/override writes outside/);
    expect(v.join("\n")).toMatch(/include_workshop/);
    expect(v.join("\n")).toMatch(/out_path Configs\/Factions\/X\.conf is outside/);
    expect(dryRunCheck(loadPolicy(), [...buildSteps(), bad]).ok).toBe(false);
  });

  it("names every census row a step can pass in a census: comment, and lists the exclusions", () => {
    const text = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    for (const r of new Set(buildSteps().flatMap((s) => s.rows))) expect(text).toContain(`census:${r}`);
    expect(EXCLUDED.map((e) => e.what).join(" ")).toMatch(/wb_terrain_edit/);
  });

  it("helpers: pickScalar, under, gprojId, withDuplicateDependency", () => {
    expect(pickScalar([{ key: "Friction", kind: "scalar", path: "Friction", value: "0.7" }])?.needle).toBe("7.0625");
    expect(pickScalar([{ key: "Count", kind: "scalar", path: "Count", value: "4" }])?.needle).toBe("5");
    expect(pickScalar([{ key: "X", kind: "object", path: "X", value: "" }])).toBeNull();
    // config_edit read answers source text: a .styles Name comes quoted (run 1 NOT-RUN).
    const styles = pickScalar([
      { key: "Font", kind: "scalar", path: "[0].Styles.WSStyle.Font", value: '"{3E7733BAC8C831F6}UI/Fonts/x.fnt"' },
      { key: "Name", kind: "scalar", path: "[0].Name", value: '"EditBoxWidget"' },
    ]);
    expect(styles).toMatchObject({ path: "[0].Name", after: "EditBoxWidgetW11", needle: "EditBoxWidgetW11" });
    // Run 6: the engine answered get Name "" unset on the .styles root; another word comes first.
    const nested = pickScalar([
      { key: "Name", kind: "scalar", path: "[0].Name", value: '"EditBoxWidget"' },
      { key: "Name", kind: "scalar", path: "[0].Styles.WSStyle.Name", value: '"Editor"' },
      { key: "Image", kind: "scalar", path: "[0].Styles.WSStyle.States[0].Items[0].Image", value: '"CheckBox_disabled_Bottom"' },
    ]);
    expect(nested).toMatchObject({ key: "Image", needle: "CheckBox_disabled_BottomW11" });
    expect(pickScalar([{ key: "Image", kind: "scalar", path: "a.Image", value: '"Button_normal_Top"' }])?.needle).toBe("Button_normal_TopW11");
    expect(pickScalar([{ key: "Visible", kind: "scalar", path: "Visible", value: "true" }])?.needle).toBe("false");
    expect(pickScalar([{ key: "Font", kind: "scalar", path: "Font", value: '"{3E7733BAC8C831F6}UI/x.fnt"' }])).toBeNull();
    expect(pickScalar([{ key: "Label", kind: "scalar", path: "Label", value: '"7.5"' }])).toBeNull();
    // The .siga miss reason from the watched rows.
    const acc = (watched: Raw[]) => ({ rel: "x.siga", via: "container" as const, result: "PARTIAL" as const, evidence: { rows: 86, watched } });
    expect(sigaMissReason(acc([{ path: "Inputs[0].tl", type: "OBJECT", value: "" }]))).toMatch(/Inputs\[0\]\.tl is a OBJECT row .* only for SCALAR/);
    // Since the run 6 handler change a VECTOR2 row carries a value; an empty one is reported as read.
    expect(sigaMissReason(acc([{ path: "Inputs[0].tl", type: "VECTOR2", value: "" }]))).toMatch(/reads "", not 31\.5/);
    expect(sigaMissReason(acc([]))).toMatch(/no Inputs\[0\]\.tl row in the 86 describe rows/);
    expect(sigaMissReason(acc([{ path: "Inputs[0].tl", type: "STRING", value: "25 -4" }]))).toMatch(/reads "25 -4", not 31\.5/);
    expect(under(`${W11_ROOT}/a/b.et`, W11_ROOT)).toBe(true);
    expect(under("_throwaway/W110/b.et", W11_ROOT)).toBe(false);
    expect(gprojId('GameProject {\n ID "Foo"\n}')).toBe("Foo");
    const d = withDuplicateDependency('Dependencies {\n  "58D0FB3206B6F859"\n }\n');
    expect(d.dep).toBe("58D0FB3206B6F859");
    expect(d.text.match(/58D0FB3206B6F859/g)).toHaveLength(2);
  });

  it("dry run of main prints the outline and passes", async () => {
    const out: string[] = [];
    expect(await main([], { out: (l) => out.push(l) })).toBe(EXIT.done);
    expect(out.join("\n")).toMatch(/W11 plan check: PASS/);
  });
});

// ── The gate ─────────────────────────────────────────────────────────────────

describe("W11 gate", () => {
  it("aborts when Info does not name the test bed, and nothing else runs", async () => {
    const o = opts("gate-abort");
    const deps = fakeDeps(o, { info: { projectFound: 1, projectName: "SomethingElse" } });
    sandbox(o, deps);
    const steps = buildSteps();
    const r = await runBattery(steps.slice(0, 3), deps, o, steps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(record(o, GATE_STEP).status).toBe("ABORTED");
    expect(deps.offlineSent).toEqual([]);
  });

  it("stops on a build stamp mismatch", async () => {
    const o = opts("gate-stamp");
    const deps = fakeDeps(o, { stamp: "old" });
    sandbox(o, deps);
    const steps = buildSteps();
    const r = await runBattery(only(steps, GATE_STEP), deps, o, steps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(String(record(o, GATE_STEP).detail)).toMatch(/build stamp/);
  });

  it("passes on the test bed and takes the snapshot", async () => {
    const o = opts("gate-pass");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    const steps = buildSteps();
    const r = await runBattery(only(steps, GATE_STEP), deps, o, steps);
    expect(r.exit).toBe(EXIT.done);
    expect(record(o, GATE_STEP).status).toBe("PASS");
  });
});

// ── Writer steps ─────────────────────────────────────────────────────────────

describe("W11 writer steps", () => {
  it("config_edit on the .physmat: PASS with the value read back, state-readback live lines", async () => {
    const o = opts("phys-pass");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    const steps = buildSteps();
    const id = physStep();
    const r = await runBattery(only(steps, id), deps, o, steps);
    const rec = record(o, id);
    expect(rec.status, String(rec.detail)).toBe("PASS");
    expect(r.exit).toBe(EXIT.done);
    const lines = liveLines(o, id);
    expect(lines).toHaveLength(2);
    expect((lines[1]!.live_result as Raw).oracle).toBe("state-readback");
    expect((lines[1]!.live_result as Raw).rows).toEqual(["mcp:action/config_edit.set"]);
    expect(deps.offlineSent.filter(([, a]) => a.action === "set" && !a.confirm)).toHaveLength(1);
  });

  it("a needle not read back is PASS with returned-true-only", async () => {
    const o = opts("phys-partial");
    const deps = fakeDeps(o, { blind: true });
    sandbox(o, deps);
    const steps = buildSteps();
    const id = physStep();
    await runBattery(only(steps, id), deps, o, steps);
    expect(record(o, id).status).toBe("PASS");
    expect((liveLines(o, id)[1]!.live_result as Raw).oracle).toBe("returned-true-only");
  });

  it("an engine refusal is FAIL with the engine's error, and writes no live line", async () => {
    const o = opts("phys-reject");
    const deps = fakeDeps(o, {
      reject: { W11_phys: { ok: false, code: "LOAD_FAILED", message: "Cannot load resource" } },
    });
    sandbox(o, deps);
    const steps = buildSteps();
    const id = physStep();
    const r = await runBattery(only(steps, id), deps, o, steps);
    const rec = record(o, id);
    expect(rec.status).toBe("FAIL");
    expect(String(rec.detail)).toMatch(/LOAD_FAILED Cannot load resource/);
    expect(r.exit).toBe(EXIT.refused);
    expect(liveLines(o, id)).toEqual([]);
  });

  it("a missing plant is NOT-RUN and calls no writer", async () => {
    const o = opts("phys-noplant");
    const deps = fakeDeps(o);
    sandbox(o, deps, false);
    const steps = buildSteps();
    const id = physStep();
    await runBattery(only(steps, id), deps, o, steps);
    expect(record(o, id).status).toBe("NOT-RUN");
    expect(deps.offlineSent).toEqual([]);
  });

  it("a replace plan touching a file outside the throwaway folder is NOT-RUN and nothing is committed", async () => {
    const o = opts("guid-outside");
    const deps = fakeDeps(o, {
      plan: (op) => ({
        ok: true,
        files: [join(op.sandboxDir, "Prefabs", "Real.et"), join(op.sandboxDir, ...REF_PARENT.split("/"))],
        detail: "2 file(s)",
      }),
    });
    sandbox(o, deps);
    // the child exists already, so the only offline call left would be the replace itself
    deps.files.set(norm(join(o.sandboxDir, W11_ROOT, "refactor", "W11_child.physmat")), Buffer.from("x"));
    const steps = buildSteps();
    await runBattery(only(steps, "w11-40-replace-guid"), deps, o, steps);
    const rec = record(o, "w11-40-replace-guid");
    expect(rec.status).toBe("NOT-RUN");
    expect(String(rec.detail)).toMatch(/Prefabs\/Real\.et/);
    expect(deps.offlineSent.filter(([t]) => t === "refactor_replace_guid")).toEqual([]);
  });

  it("the index steps refuse when a .gproj lies under the throwaway folder", async () => {
    const o = opts("guid-shadow");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    deps.files.set(norm(join(o.sandboxDir, W11_ROOT, "gproj", "x.gproj")), Buffer.from("x"));
    const steps = buildSteps();
    await runBattery(only(steps, "w11-40-replace-guid"), deps, o, steps);
    expect(String(record(o, "w11-40-replace-guid").detail)).toMatch(/shadow/);
  });

  it("net-zero FAILs on a change outside the throwaway folder", async () => {
    const o = opts("netzero");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    const steps = buildSteps();
    await runBattery(only(steps, GATE_STEP), deps, o, steps);
    deps.files.set(norm(join(o.sandboxDir, `${SANDBOX_NAME}.gproj`)), Buffer.from("changed"));
    await runBattery(only(steps, NETZERO_STEP), deps, o, steps);
    const rec = record(o, NETZERO_STEP);
    expect(rec.status).toBe("FAIL");
    expect(String(rec.detail)).toMatch(/EMCP2_sandbox\.gproj/);
  });

  it("a step never runs twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    const steps = buildSteps();
    await runBattery(only(steps, GATE_STEP), deps, o, steps);
    const r = await runBattery(only(steps, GATE_STEP), deps, o, steps);
    expect(r.exit).toBe(EXIT.refused);
  });
});

// ── Run 2 fix-ups: the refactors and faction_create ──────────────────────────

describe("W11 run 2 fix-ups", () => {
  it("replace_guid: the battery writes a scanned .conf naming the parent; a .meta left on the old GUID is a FAIL naming it", async () => {
    const o = opts("guid-conf");
    const deps = fakeDeps(o, {
      plan: (op) => ({ ok: true, files: [join(op.sandboxDir, ...REF_CONF.split("/"))], detail: "1 file(s)" }),
    });
    sandbox(o, deps);
    // the commit rewrites the referencing files only, as the tool does
    const offline = deps.offline;
    deps.offline = async (name, args) => {
      if (name === "refactor_replace_guid" && args.commit) {
        const p = norm(join(o.sandboxDir, ...REF_CONF.split("/")));
        deps.files.set(p, Buffer.from(deps.files.get(p)!.toString().replace(String(args.old_guid), String(args.new_guid))));
      }
      return offline(name, args);
    };
    const steps = buildSteps();
    await runBattery(only(steps, "w11-40-replace-guid"), deps, o, steps);
    const rec = record(o, "w11-40-replace-guid");
    expect(rec.status, String(rec.detail)).toBe("FAIL");
    expect(String(rec.detail)).toMatch(/W11_parent\.physmat\.meta still holds ABCDEF0123456789/);
    const conf = deps.files.get(norm(join(o.sandboxDir, ...REF_CONF.split("/"))))!.toString();
    expect(conf).toBe(refConfText(`{1234567890ABCDEF}${REF_PARENT}`));
  });

  it("replace_guid: a plan without the .conf is NOT-RUN and nothing is committed", async () => {
    const o = opts("guid-noconf");
    const deps = fakeDeps(o, {
      plan: (op) => ({ ok: true, files: [join(op.sandboxDir, ...REF_CHILD.split("/"))], detail: "1 file(s)" }),
    });
    sandbox(o, deps);
    const steps = buildSteps();
    await runBattery(only(steps, "w11-40-replace-guid"), deps, o, steps);
    expect(String(record(o, "w11-40-replace-guid").detail)).toMatch(/does not hold .*W11_ref\.conf/);
    expect(deps.offlineSent.filter(([t]) => t === "refactor_replace_guid")).toEqual([]);
  });

  it("move: the source is the generated .et fixture, and a refusal in the tool's text is a FAIL", async () => {
    expect(plantSources().find((s) => s.rel === MOVE_SOURCE)?.from).toMatch(/generated/);
    const o = opts("move-text-refusal");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    deps.files.set(norm(join(o.sandboxDir, ...MOVE_SOURCE.split("/"))), Buffer.from(MOVE_FIXTURE));
    const offline = deps.offline;
    deps.offline = async (name, args) =>
      name === "refactor_move_resource_path"
        ? { ok: true, message: `## refactor_move_resource_path\n\n❌ No resource indexed at ${MOVE_SOURCE}. Crawl your project first.` }
        : offline(name, args);
    const steps = buildSteps();
    await runBattery(only(steps, "w11-41-move-resource-path"), deps, o, steps);
    const rec = record(o, "w11-41-move-resource-path");
    expect(rec.status).toBe("FAIL");
    expect(String(rec.detail)).toMatch(/commit refused in its text: ❌ No resource indexed/);
  });

  it("faction_create passes force (the test bed's throwaway folder is untracked in git)", () => {
    const s = buildSteps().find((x) => x.id === "w11-63-faction-create")!;
    expect(s.offlineCalls()[0]!.params.force).toBe(true);
  });
});

// ── The .ae step and its vanilla controls ────────────────────────────────────

describe("W11 .ae step", () => {
  const EMPTY = "$eventtable {\n \n}\n";
  const AE_ID = "w11-30-ae-create";
  const refused: ToolResponse = { ok: false, code: "PATH_NOT_FOUND", message: "LoadContainer found no valid resource" };
  /** The .aw and .ae already on disk (the resumed-run path), the controls planted unless told not to. */
  function aeBed(name: string, sim: Sim, plantControls = true) {
    const o = opts(name);
    const deps = fakeDeps(o, sim);
    sandbox(o, deps);
    const put = (rel: string, text: string) => deps.files.set(norm(join(o.sandboxDir, ...rel.split("/"))), Buffer.from(text));
    put(AW_CREATE, "BaseSource {\n AnimSetInstances {\n }\n PreviewModels {\n }\n}");
    put(AE_CREATED, EMPTY);
    if (plantControls) {
      put(AE_CONTROLS[0]!.rel, EMPTY);
      put(AE_CONTROLS[1]!.rel, 'AnimEventTable {\n EventNames {\n  "BlendIn"\n }\n}');
    }
    return { o, deps };
  }

  it("every vanilla control refused too: the .ae is NOT-JUDGED, not a FAIL, and the .aw evidence stands", async () => {
    const { o, deps } = aeBed("ae-notjudged", { reject: { ".ae": refused } });
    const steps = buildSteps();
    await runBattery(only(steps, AE_ID), deps, o, steps);
    const rec = record(o, AE_ID);
    expect(rec.status, String(rec.detail)).toBe("PASS");
    expect(String(rec.detail)).toMatch(/W11_new_EventTable\.ae NOT-JUDGED/);
    expect(String(rec.detail)).toMatch(/oracle cannot judge \.ae.*every vanilla control too/);
    expect(String(rec.detail)).toMatch(/the \.aw names no event table/);
    expect((rec.evidence as Raw).awNamesAe).toBe(false);
    expect((liveLines(o, AE_ID)[1]!.live_result as Raw).oracle).toBe("returned-true-only");
    const described = deps.sent.filter(([t, a]) => t === "wb_container" && a.mode !== "page").map(([, a]) => String(a.target));
    expect(described.slice(0, 2)).toEqual(AE_CONTROLS.map((c) => `path:${c.rel}`));
  });

  it("a control loads and ours does not: FAIL, with a diff against the smallest control", async () => {
    const { o, deps } = aeBed("ae-fail", { reject: { W11_new_EventTable: refused } });
    const steps = buildSteps();
    await runBattery(only(steps, AE_ID), deps, o, steps);
    const rec = record(o, AE_ID);
    expect(rec.status).toBe("FAIL");
    const diff = (rec.evidence as Raw).diff as Raw;
    expect(diff.against).toBe(AE_CONTROLS[0]!.rel);
    expect(diff.identical).toBe(true);
    expect(liveLines(o, AE_ID)).toEqual([]);
  });

  it("no control planted and ours refused: NOT-JUDGED naming the missing plant", async () => {
    const { o, deps } = aeBed("ae-noctl", { reject: { ".ae": refused } }, false);
    const steps = buildSteps();
    await runBattery(only(steps, AE_ID), deps, o, steps);
    const rec = record(o, AE_ID);
    expect(String(rec.detail)).toMatch(/no vanilla control was planted/);
    expect((rec.evidence as Raw).controlsNotPlanted).toEqual(AE_CONTROLS.map((c) => c.rel));
  });
});

// ── Plant and rollback ───────────────────────────────────────────────────────

function fakeIo(running: number[] = []): OfflineIo & { files: Map<string, Buffer>; dirs: Set<string> } {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    workbenchPids: () => running,
    exists: (p) => files.has(norm(p)) || dirs.has(norm(p)) || [...files.keys()].some((k) => k.startsWith(norm(p) + "/")),
    listDir: (p) => [...files.keys()].filter((k) => k.startsWith(norm(p) + "/")),
    listTree: (p) => {
      const d = norm(p).replace(/\/$/, "") + "/";
      return [...files.keys()].filter((k) => k.startsWith(d)).map((k) => k.slice(d.length));
    },
    readBytes: (p) => files.get(norm(p)) ?? Buffer.alloc(0),
    writeBytes: (p, b) => void files.set(norm(p), b),
    removeTree: (p) => {
      for (const k of [...files.keys()]) if (k.startsWith(norm(p) + "/")) files.delete(k);
      for (const k of [...dirs]) if (k === norm(p) || k.startsWith(norm(p) + "/")) dirs.delete(k);
    },
    makeDir: (p) => void dirs.add(norm(p)),
    readVanilla: async (p) => Buffer.from(`vanilla ${p}`),
    log: () => undefined,
  };
}

describe("W11 plant and rollback", () => {
  const sb = join(TMP, "plant", SANDBOX_NAME);
  const sit = join(TMP, "plant");

  it("refuses while a Workbench runs, and writes nothing", async () => {
    const io = fakeIo([42]);
    expect(await runPlant(sb, sit, true, io)).toBe(EXIT.refused);
    expect(io.files.size).toBe(0);
  });

  it("plants every source and the record, then rollback removes the folder", async () => {
    const io = fakeIo();
    expect(await runPlant(sb, sit, true, io)).toBe(EXIT.done);
    for (const s of plantSources()) expect(io.files.has(norm(join(sb, ...s.rel.split("/"))))).toBe(true);
    expect(io.files.has(norm(join(sit, PLANT_FILE)))).toBe(true);
    expect(io.files.get(norm(join(sb, W11_ROOT, "script", "W11_format.c")))?.toString()).toBe(FORMAT_FIXTURE);
    expect(runRollback(sb, sit, true, io)).toBe(EXIT.done);
    expect([...io.files.keys()].filter((k) => k.includes("/_throwaway/W11/"))).toEqual([]);
  });

  it("a dry run writes nothing", async () => {
    const io = fakeIo();
    expect(await runPlant(sb, sit, false, io)).toBe(EXIT.done);
    expect(io.files.size).toBe(0);
  });
});

// ── The second read-backs and the steps added for the engine-accept gaps ─────

describe("W11 second read-back and the added steps", () => {
  it("containerPath drops config_edit's root index", () => {
    expect(containerPath("[0].Name")).toBe("Name");
    expect(containerPath("[0]")).toBe("");
    expect(containerPath("Styles[1].Font")).toBe("Styles[1].Font");
  });

  it("pickGets sends get only for a top-level pick; pickWatch matches the pick's rows", () => {
    expect(pickGets("[0].Name")).toEqual(["Name"]);
    expect(pickGets("Friction")).toEqual(["Friction"]);
    expect(pickGets("[0].Styles.WSStyle.States[0].Items[0].Image")).toEqual([]);
    expect(pickWatch("Image").test("Styles[0].States[0].Items[0].Image")).toBe(true);
    expect(pickWatch("Image").test("ImageSet")).toBe(false);
  });

  /** A creator step whose writer puts `text` at `file` (relative to its case folder). */
  function creatorBed(name: string, sim: Sim, tool: OfflineTool, file: string, text: string) {
    const o = opts(name);
    const deps = fakeDeps(o, sim);
    sandbox(o, deps);
    const offline = deps.offline;
    deps.offline = async (n, args) => {
      if (n === tool) deps.files.set(norm(join(o.sandboxDir, ...file.split("/"))), Buffer.from(text));
      return offline(n, args);
    };
    return { o, deps };
  }

  it("faction_create: describe misses the key, get on FactionKey reads it: ACCEPTED, state-readback", async () => {
    const id = "w11-63-faction-create";
    const file = `${W11_ROOT}/create/faction-create/W11_Faction.conf`;
    const { o, deps } = creatorBed("faction-get", { blind: true, get: (a) => ({ path: a.path, type: "STRING", value: "W11F" }) }, "faction_create", file, 'SCR_Faction {\n m_sFactionKey "W11F"\n}\n');
    const steps = buildSteps();
    await runBattery(only(steps, id), deps, o, steps);
    const rec = record(o, id);
    expect(rec.status, String(rec.detail)).toBe("PASS");
    expect(String(rec.detail)).toMatch(/W11_Faction\.conf ACCEPTED/);
    expect((liveLines(o, id)[1]!.live_result as Raw).oracle).toBe("state-readback");
    const gets = deps.sent.filter(([t, a]) => t === "wb_container" && a.action === "get");
    expect(gets.map(([, a]) => [a.target, a.path])).toEqual([[`path:${file}`, "FactionKey"]]);
  });

  it("get is not sent when describe reads the needle, and a get miss stays PARTIAL naming both reads", async () => {
    const id = "w11-63-faction-create";
    const file = `${W11_ROOT}/create/faction-create/W11_Faction.conf`;
    const seen = creatorBed("faction-describe", {}, "faction_create", file, 'SCR_Faction {\n m_sFactionKey "W11F"\n}\n');
    const steps = buildSteps();
    await runBattery(only(steps, id), seen.deps, seen.o, steps);
    expect(seen.deps.sent.filter(([t, a]) => t === "wb_container" && a.action === "get")).toEqual([]);
    const miss = creatorBed("faction-miss", { blind: true }, "faction_create", file, 'SCR_Faction {\n m_sFactionKey "W11F"\n}\n');
    await runBattery(only(steps, id), miss.deps, miss.o, steps);
    expect(String(record(miss.o, id).detail)).toMatch(/not read back in the describe rows or by get on FactionKey: W11F/);
  });

  it("the .siga edit sets the SCALAR valueMax beside the move and judges the file by both", () => {
    const s = buildSteps().find((x) => x.id === "w11-20-siga")!;
    const edit = s.offlineCalls().find((c) => c.params.action === "edit")!;
    expect(edit.params.ops).toContainEqual({ op: "set_property", node: SIGA_SET.node, key: SIGA_SET.key, value: SIGA_SET.value });
    for (const path of [SIGA_SET.path, SIGA_TL.path])
      expect(s.plan().some((a) => a.toolAction === "get" && (a.params as Raw).path === path), path).toBe(true);
    expect(SIGA_TL.needle).toBe("31.5 -4.25");
  });

  it("w11-42 reads the rewritten .conf when it names the parent's GUID, else NOT-RUN", async () => {
    const id = "w11-42-replace-guid-conf";
    const steps = buildSteps();
    const o = opts("guid-conf-read");
    const deps = fakeDeps(o);
    sandbox(o, deps);
    await runBattery(only(steps, id), deps, o, steps);
    expect(record(o, id).status).toBe("NOT-RUN");
    const o2 = opts("guid-conf-read-2");
    const deps2 = fakeDeps(o2);
    sandbox(o2, deps2);
    const put = (rel: string, t: string) => deps2.files.set(norm(join(o2.sandboxDir, ...rel.split("/"))), Buffer.from(t));
    put(REF_CONF, refConfText(`{1234567890ABCDEF}${REF_PARENT}`));
    put(`${REF_PARENT}.meta`, `MetaFileClass {\n Name "{1234567890ABCDEF}${REF_PARENT}"\n}\n`);
    await runBattery(only(steps, id), deps2, o2, steps);
    const rec = record(o2, id);
    expect(rec.status, String(rec.detail)).toBe("PASS");
    expect(String(rec.detail)).toMatch(/W11_ref\.conf ACCEPTED/);
    expect(refConfText("x")).toContain(REF_CONF_CLASS);
  });

  it("mod with a pattern: the .c through the Script Editor, the .conf through describe", async () => {
    const id = "w11-6a-mod-pattern";
    const dir = `${W11_ROOT}/create/mod-pattern/W11AddonGM`;
    const { o, deps } = creatorBed("mod-pattern", {}, "mod", `${dir}/Configs/W11GM_MissionHeader.conf`, 'SCR_MissionHeader {\n m_sName "W11GM Scenario"\n}\n');
    const writeConf = deps.offline;
    deps.offline = async (n, args) => {
      if (n === "mod") deps.files.set(norm(join(o.sandboxDir, ...`${dir}/Scripts/Game/W11GM_GameMode.c`.split("/"))), Buffer.from("class W11GM_GameMode {}\n"));
      return writeConf(n, args);
    };
    const steps = buildSteps();
    expect(steps.find((x) => x.id === id)!.offlineCalls()[0]!.params).toMatchObject({ action: "create", pattern: "game-mode" });
    await runBattery(only(steps, id), deps, o, steps);
    const rec = record(o, id);
    const accepts = (rec.evidence as Raw).accepts as Raw[];
    expect(accepts.map((a) => [String(a.rel).split("/").pop(), a.via])).toEqual(
      expect.arrayContaining([["W11GM_MissionHeader.conf", "container"], ["W11GM_GameMode.c", "script"]]),
    );
  });
});

// ── wb_entity_duplicate (w11-54, gap 10) ─────────────────────────────────────

describe("W11 wb_entity_duplicate step (w11-54)", () => {
  const ID = "w11-54-entity-duplicate";
  const DEF = "_throwaway/W11/scenario/b/Worlds/W11_ConflictB_Layers/default.layer";
  const ENT = "_throwaway/W11/scenario/b/Worlds/W11_ConflictB.ent";
  const LAYER =
    'SCR_GameModeCampaign GameMode1 : "{0000000000000001}Prefabs/Placeholder.et" {\n}\n' +
    'SCR_CampaignFactionManager CampaignFactionManager1 : "{F1AC26310BAE3788}Prefabs/MP/Campaign/CampaignFactionManager_Seize.et" {\n ID "1"\n}\n';

  function setup(name: string, worldPath: string, write = true) {
    const o = opts(name);
    const deps = fakeDeps(o);
    sandbox(o, deps);
    const at = (rel: string) => norm(join(o.sandboxDir, ...rel.split("/")));
    deps.files.set(at(DEF), Buffer.from(LAYER));
    const tool = deps.tool;
    deps.tool = async (n, a) =>
      n === "wb_world" && a.action === "state"
        ? (deps.sent.push([n, a]), { ok: true, readback: { mode: "edit", worldPath } })
        : tool(n, a);
    const offline = deps.offline;
    deps.offline = async (n, a) => {
      if (n !== "wb_entity_duplicate") return offline(n, a);
      deps.offlineSent.push([n, a]);
      if (write) deps.files.set(at(String(a.destPath)), Buffer.from("SCR_CampaignFactionManager {\n}\n"));
      return { ok: true, readback: {} };
    };
    return { o, deps };
  }

  it("namedVanillaEntity skips placeholders and takes the first named Prefabs/ entity", () => {
    expect(namedVanillaEntity(LAYER)).toEqual({
      cls: "SCR_CampaignFactionManager",
      name: "CampaignFactionManager1",
      prefab: "Prefabs/MP/Campaign/CampaignFactionManager_Seize.et",
    });
    expect(namedVanillaEntity('GenericEntity : "{F1AC26310BAE3788}Prefabs/A.et" {\n}')).toBeNull();
  });

  it("runs after w11-53 with replaceInScene false, the copy under the throwaway folder, and PASSes on the engine read", async () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(ids.indexOf(ID)).toBe(ids.indexOf("w11-53-scenario-open") + 1);
    expect(under(ENTITY_DUP_DEST, "_throwaway/W11")).toBe(true);
    const { o, deps } = setup("entdup-pass", `$EMCP2_sandbox:${ENT}`);
    const r = await runBattery(only(steps, ID), deps, o, steps);
    const rec = record(o, ID);
    expect(rec.status, String(rec.detail)).toBe("PASS");
    expect(r.exit).toBe(EXIT.done);
    const sent = deps.offlineSent.filter(([n]) => n === "wb_entity_duplicate");
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toMatchObject({
      entityName: "CampaignFactionManager1",
      destPath: ENTITY_DUP_DEST,
      modName: SANDBOX_NAME,
      replaceInScene: false,
    });
    const lines = liveLines(o, ID);
    expect(lines).toHaveLength(2);
    expect((lines[1]!.live_result as Raw).rows).toEqual(["mcp:action/wb_entity_duplicate.run"]);
    expect((lines[1]!.live_result as Raw).oracle).toBe("state-readback");
  });

  it("B not open is NOT-RUN and calls no writer", async () => {
    const { o, deps } = setup("entdup-closed", "$EMCP2_sandbox:worlds/Other.ent");
    const steps = buildSteps();
    await runBattery(only(steps, ID), deps, o, steps);
    expect(record(o, ID).status).toBe("NOT-RUN");
    expect(deps.offlineSent.filter(([n]) => n === "wb_entity_duplicate")).toEqual([]);
  });

  it("a tool answer that writes no file is FAIL", async () => {
    const { o, deps } = setup("entdup-nofile", `$EMCP2_sandbox:${ENT}`, false);
    const steps = buildSteps();
    await runBattery(only(steps, ID), deps, o, steps);
    const rec = record(o, ID);
    expect(rec.status).toBe("FAIL");
    expect(String(rec.detail)).toMatch(/wrote no/);
  });

  it("wb_entity_duplicate is no longer in the excluded list", () => {
    expect(EXCLUDED.map((e) => e.what)).not.toContain("wb_entity_duplicate");
  });
});
