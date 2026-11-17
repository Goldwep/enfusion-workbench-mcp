import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
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
  BATTERY_SNAPSHOT_FILE,
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  EXIT,
  FILE_WRITE_ACTIONS,
  LAUNCH_ARGS,
  NOT_EXERCISED,
  NOT_TESTABLE,
  PROBE_IDS,
  SCRIPT_PATH,
  W1_CONTRACTS,
  W1_ROOT,
  WORLD_OFFLINE_ACTIONS,
  buildActionPlan,
  buildQueue,
  buildSteps,
  dryRunCheck,
  exercisedBy,
  exactLineDiff,
  handAnswer,
  handFiles,
  folderPersisted,
  handLine,
  isSavableThrowaway,
  layersDirOf,
  missingWorldRefusal,
  panelChildrenAgree,
  lineDiffCount,
  main,
  netZeroDiff,
  runBattery,
  selectSteps,
  snapshotFiles,
  type ToolResponse,
  type W1Deps,
  type W1Options,
  type W1Tool,
  MODE_POLLS,
  WATCH_OPTIONS,
} from "../live/w1.live.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-w1-"));
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

describe("W1 battery: the dry-run gate", () => {
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
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("step ids are unique, w1-NN-…, and play is the last Workbench step", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w1-\d\d-[a-z0-9-]+$/);
    const play = ids.indexOf("w1-60-play");
    expect(play).toBeGreaterThan(-1);
    // After play: read-only steps, then the close-out (it opens a fresh world, edits nothing).
    expect(
      steps.slice(play + 1).every((s) => s.risk === "read-only" || s.id === CLOSABLE_STEP),
    ).toBe(true);
    expect(ids[ids.length - 1]).toBe(CLOSABLE_STEP);
  });
});

describe("W1 battery: coverage", () => {
  const steps = buildSteps();
  const exercised = new Set(steps.flatMap(exercisedBy));

  it("every action of the seven contracts is exercised or in NOT_EXERCISED with a reason", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W1_CONTRACTS)) {
      for (const a of contractActions(handler)) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    }
    for (const a of WORLD_OFFLINE_ACTIONS) {
      const key = `wb_world.${a}`;
      if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
    }
    expect(missing).toEqual([]);
    for (const reason of Object.values(NOT_EXERCISED)) expect(reason.length).toBeGreaterThan(10);
  });

  it("every probe P-W1-01..26 is assigned to a step or listed as not testable with a reason", () => {
    expect(PROBE_IDS).toHaveLength(26);
    const assigned = new Set(steps.flatMap((s) => s.probes));
    for (const id of PROBE_IDS) {
      const ok = assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10;
      expect(ok, id).toBe(true);
    }
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of steps) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
  });
});

describe("W1 battery: writes stay under _throwaway/W1/", () => {
  const steps = buildSteps();

  it("every declared write lies under _throwaway/W1/", () => {
    for (const s of steps)
      for (const w of s.writes) expect(w.startsWith(`${W1_ROOT}/`), `${s.id} ${w}`).toBe(true);
  });

  it("every file-writing call in the plan names a path under _throwaway/W1/; saveAs is confirmed only in W1.7", () => {
    // Session 023: W1.7 saves THROWAWAY worlds (saveAs of the open world, which the step's helper
    // refuses unless that world lies under _throwaway/W1/); every other block only dry-runs it.
    const blockOf = new Map(steps.map((s) => [s.id, s.block]));
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (key === "wb_world.saveAs" && a.params?.confirm === true)
        expect(blockOf.get(String(a.step)), String(a.step)).toBe("W1.7");
    }
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (!FILE_WRITE_ACTIONS.has(key)) continue;
      const p = a.params ?? {};
      const paths = ["path", "to", "target"]
        .map((k) => p[k])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.replace(/^path:/, ""));
      for (const v of paths)
        expect(v.startsWith(`${W1_ROOT}/`), `${String(a.step)} ${key} ${v}`).toBe(true);
      if (key === "wb_world.saveAs" && blockOf.get(String(a.step)) !== "W1.7")
        expect(p.confirm, String(a.step)).not.toBe(true);
    }
  });

  it("no plan entry saves the world or calls a denied API", () => {
    for (const a of buildActionPlan(steps) as Array<Raw & { params?: Raw }>) {
      if (a.kind !== "net-call") continue;
      expect(String(a.target)).not.toMatch(/RunCommandline|Workbench\.(Exit|RunCmd|RunProcess)/);
      // Only the throwaway template (wb_prefabs), the planted conf (wb_container) and, in W1.7, the
      // open throwaway world (wb_module save: saveThrowaway, never the fixture) are ever saved.
      if (a.params?.action === "save") {
        if (a.tool === "wb_module")
          expect(steps.find((s) => s.id === a.step)?.block, String(a.step)).toBe("W1.7");
        else expect(["wb_prefabs", "wb_container"]).toContain(a.tool);
      }
      expect(String(a.target)).not.toBe("EMCP_WB_Save");
    }
  });
});

describe("W1 battery: helpers and selection", () => {
  it("lineDiffCount counts changed lines", () => {
    expect(lineDiffCount("a\nb\nc", "a\nB\nc")).toBe(1);
    expect(lineDiffCount("a\nb", "a\nb\nc")).toBe(1);
  });

  it("exactLineDiff counts one removed line as one, where the positional count reads a rewrite", () => {
    const before = ["k1 1", "k2 2", "k3 3", "k4 4", "k5 5"].join("\n");
    const after = ["k1 1", "k3 3", "k4 4", "k5 5"].join("\n");
    expect(lineDiffCount(before, after)).toBe(4);
    expect(exactLineDiff(before, after)).toEqual({ removed: ["k2 2"], added: [] });
    expect(exactLineDiff("a\nb\nc", "a\nB\nc")).toEqual({ removed: ["b"], added: ["B"] });
    expect(exactLineDiff("x\ny", "x\ny")).toEqual({ removed: [], added: [] });
  });

  it("W1.7: hand files live in the run folder, layer folders follow the world name, W1.7 runs before play", () => {
    const f = handFiles(join("run", "r1"), "w1-70-outside");
    expect(f.request).toBe(join("run", "r1", "hand-w1-70-outside.request.json"));
    expect(f.answer).toBe(join("run", "r1", "hand-w1-70-outside.json"));
    expect(layersDirOf(`${W1_ROOT}/worlds/A.ent`)).toBe(`${W1_ROOT}/worlds/A_Layers`);
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    const w17 = steps.filter((s) => s.block === "W1.7").map((s) => ids.indexOf(s.id));
    expect(w17.length).toBeGreaterThan(0);
    expect(Math.max(...w17)).toBeLessThan(ids.indexOf("w1-60-play"));
  });

  it("run 6 fix-ups: the children comparison, the folder check, the savable throwaway", () => {
    // w1-71: the hand answers the row names; Number(array) made run 6 KILL a true agreement.
    expect(panelChildrenAgree(["W1_H3", "W1_H2"], ["W1_H2", "W1_H3"], 2)).toBe(true);
    expect(panelChildrenAgree(["W1_H2"], ["W1_H2", "W1_H3"], 2)).toBe(false);
    expect(panelChildrenAgree(["W1_H2", "W1_X"], ["W1_H2", "W1_H3"], 2)).toBe(false);
    expect(panelChildrenAgree(2, ["W1_H2", "W1_H3"], 2)).toBe(true);
    // w1-73: the renamed folder holding W1_PFL, as a folder row or through its layer's path.
    expect(
      folderPersisted(["layer:default", "folder:W1_PF2", "layer:W1_PF2/W1_PFL"], "W1_PF2"),
    ).toBe(true);
    expect(folderPersisted(["layer:default", "layer:W1_PF2/W1_PFL"], "W1_PF2")).toBe(true);
    expect(folderPersisted(["layer:default", "layer:W1_PL"], "W1_PF2")).toBe(false);
    // saveThrowaway saves a W1.7 throwaway world, never the fixture or a world outside W1_ROOT.
    expect(isSavableThrowaway(`$EMCP2_sandbox:${W1_ROOT}/worlds/EMCP_W1_LayerDel.ent`)).toBe(true);
    expect(isSavableThrowaway(`$EMCP2_sandbox:${W1_ROOT}/worlds/EMCP_W1_Tiny.ent`)).toBe(false);
    expect(isSavableThrowaway("worlds/Eden/Eden.ent")).toBe(false);
  });

  it("every W1.7 world step saves the open throwaway world first (no dirty switch, a clean resume)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    const at = src.indexOf("async function throwawayWorld(");
    expect(src.slice(at, src.indexOf("\n}\n", at))).toContain("await saveThrowaway(ctx)");
    for (const id of ["w1-74-visible-file", "w1-76-prefab-remove"]) {
      const s = src.indexOf(`id: "${id}"`);
      const body = src.slice(s, src.indexOf("\n    {\n      id:", s + 10));
      expect(body, id).toContain("await saveThrowaway(ctx)");
    }
    const s75 = src.indexOf('id: "w1-75-layer-delete"');
    const b75 = src.slice(s75, src.indexOf('id: "w1-76-prefab-remove"'));
    // The delete is saved in place before saveAs switches worlds.
    expect(b75.indexOf("const saved1 = await saveThrowaway(ctx)")).toBeGreaterThan(-1);
    expect(b75.indexOf("const saved1")).toBeLessThan(
      b75.indexOf("saveAsAndReopen(ctx, LAYERDEL2_WORLD)"),
    );
  });

  it("w1-75 proves the NOT_EMPTY refusal and the withContents delete, one undo, then saves (W1.7 run 7)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    const s75 = src.indexOf('id: "w1-75-layer-delete"');
    const run = src.slice(
      src.indexOf("run: async (ctx)", s75),
      src.indexOf('id: "w1-76-prefab-remove"'),
    );
    const at = (t: string) => run.indexOf(t);
    const order = [
      'const refusal = await ctx.tool("wb_layers", { action: "delete", layer, confirm: true });',
      'const dry = await ctx.tool("wb_layers", { action: "delete", layer, withContents: true });',
      "const del = await ctx.tool(",
      "const undo = del.ok ? await ctx.undo() : null;",
      "const del2 = undo",
      "const saved1 = await saveThrowaway(ctx);",
      "saveAsAndReopen(ctx, LAYERDEL2_WORLD)",
    ];
    for (let i = 1; i < order.length; i++)
      expect(at(order[i]!), order[i]).toBeGreaterThan(at(order[i - 1]!));
    expect(at(order[0]!)).toBeGreaterThan(-1);
    expect(run).toContain('refusal.code === "NOT_EMPTY"');
    expect(run).toContain("Number(rb(del).entitiesDeleted) === 1");
    // The refusal must leave the layer, its entity and no pathless layer.
    expect(run).toMatch(/refusedClean =[\s\S]*pathless\(tR\)\.length === 0[\s\S]*onLayer\(gR\)/);
    // w1-26 sends the same three forms and its leftover sweep deletes with withContents.
    const s26 = src.indexOf('id: "w1-26-layers"');
    const b26 = src.slice(s26, src.indexOf('id: "w1-27-select"'));
    expect(b26).toContain("const delRefused = await ctx.tool(");
    expect(b26).toContain('{ action: "delete", layer: path, withContents: true, confirm: true }');
  });

  it("w1-72 asks the hand whether the whole note is readable in the frame, and lifts it in view", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    const s72 = src.indexOf('id: "w1-72-annotate-hand"');
    const b72 = src.slice(s72, src.indexOf('id: "w1-73-persist"'));
    expect(b72).toContain('"readable": true|false');
    expect(b72).toContain("seenAdd.readable !== true");
    expect(b72).toContain("Math.max(4 * (noteSize > 0 ? noteSize : 0), 0.2)");
    expect(b72).toContain('"inFrame": true|false');
  });

  it("the HAND REQUEST line names the run folder and the full answer path", () => {
    const run = join("run", "r1");
    const line = handLine(run, "w1-70-cursor-hand", "look at the cursor");
    expect(line).toContain(`run folder: ${run}`);
    expect(line).toContain(handFiles(run, "w1-70-cursor-hand").answer);
  });

  it("an open of a _throwaway world that is not on disk is refused before it is sent", () => {
    const ctx = (present: boolean) => ({
      opts: { sandboxDir: join("sb") },
      deps: { exists: () => present },
    });
    expect(missingWorldRefusal(ctx(false), `${W1_ROOT}/worlds/Gone.ent`)).toMatch(/not on disk/);
    expect(missingWorldRefusal(ctx(true), `${W1_ROOT}/worlds/Here.ent`)).toBeNull();
    expect(missingWorldRefusal(ctx(false), "worlds/Game/Game.ent")).toBeNull();
  });

  it("every step that edits the fixture makes and opens it itself (--from/--only on a fresh launch)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8").replace(/\r\n/g, "\n");
    const body = (name: string): string => {
      const at = src.indexOf(`async function ${name}(`);
      return src.slice(at, src.indexOf("\n}\n", at));
    };
    expect(body("requireFixture")).toContain("openFixture(ctx)");
    expect(body("ensureFixture")).toContain("openFixture(ctx)");
    expect(body("openFixture")).toContain("makeFixture(ctx, evidence, fails)");
    expect(body("throwawayWorld")).toContain("makeFixture(ctx, fixture, fixtureFails)");
    expect(body("openWorld")).toContain("missingWorldRefusal(ctx, rel)");
  });

  it("selectSteps honours --only, --from, --until", () => {
    const steps = buildSteps();
    expect(selectSteps(steps, { only: "w1-10-world-state" })).toHaveLength(1);
    expect(typeof selectSteps(steps, { only: "nope" })).toBe("string");
    expect(typeof selectSteps(steps, { from: "w1-60-play", until: "w1-10-world-state" })).toBe(
      "string",
    );
  });
});

// ── Fake deps for runBattery ──

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W1Tool, args: Raw) => ToolResponse;
  files?: Map<string, Buffer>;
}): W1Deps & { files: Map<string, Buffer> } {
  const files = over.files ?? new Map<string, Buffer>();
  const norm = (p: string): string => p.replace(/\\/g, "/");
  return {
    files,
    tool: async (name, args) => (over.tool ? over.tool(name, args) : { ok: true, readback: {} }),
    undo: async () => ({ ok: true, message: "Undo executed" }),
    info: async () =>
      over.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : over.info,
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async (): Promise<WindowInfo[]> => [],
    recordedPid: () => PID,
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

function opts(name: string): W1Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W1Options["ph"],
    build: "test",
  };
}

function only(id: string) {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

describe("W1 battery: runner stop rules", () => {
  it("refuses to start unless the open project is the test bed", async () => {
    const o = opts("notbed");
    const deps = fakeDeps({ info: { projectFound: 1, projectName: "SomeOtherMod" } });
    const r = await runBattery(buildSteps().slice(0, 1), deps, o);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.records[0].status).toBe("ABORTED");
  });

  it("a LOST client code stops the battery and is not retried", async () => {
    const o = opts("lost");
    let calls = 0;
    const deps = fakeDeps({
      tool: () => {
        calls++;
        return { ok: false, code: "LOST", message: "connection lost" };
      },
    });
    const only = selectSteps(buildSteps(), { only: "w1-10-world-state" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0].status).toBe("STOPPED");
    expect(calls).toBe(1);
  });

  it("a step that depends on a killed probe is SKIPPED with the reason", async () => {
    const o = opts("skip");
    const deps = fakeDeps({});
    const kill = {
      step: "w1-29-camera",
      block: "W1.2",
      title: "x",
      status: "KILLED",
      detail: "x",
      startedAt: "",
      endedAt: "",
      probes: [{ id: "P-W1-11", result: "KILLED", observed: {}, note: "screen size 0" }],
      evidence: {},
    };
    deps.files.set(
      join(o.runDir, "w1-29-camera.json").replace(/\\/g, "/"),
      Buffer.from(JSON.stringify(kill)),
    );
    const only = selectSteps(buildSteps(), { only: "w1-30-trace" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(r.records[0].status).toBe("SKIPPED");
    expect(r.records[0].detail).toContain("P-W1-11");
  });

  it("a step is never run twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps({});
    deps.files.set(join(o.runDir, "w1-10-world-state.json").replace(/\\/g, "/"), Buffer.from("{}"));
    const only = selectSteps(buildSteps(), { only: "w1-10-world-state" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });
});

describe("W1 battery: fix-up 2 (run 2 of 2026-11-11)", () => {
  it("a save prompt HANDOFF names the exact title, the answer No and the resume", () => {
    const h = handAnswer(
      'a dialog-like window appeared (Qt683QWindowIcon "Loading world", owner 30279804): owner hand, nothing is sent to it',
      "w1-43-prefab-edit",
    );
    expect(h.title).toBe("Loading world");
    expect(h.answer).toBe("No");
    expect(h.instruction).toContain("--from w1-43-prefab-edit");
    expect(h.instruction).toMatch(/never Yes, never Cancel/);
    expect(handAnswer('window ("Other")', "w1-50-terrain").answer).toMatch(/never Save/);
  });

  it("w1-42 undoes all four undo steps (create and the three writes) so nothing is swept", async () => {
    const o = opts("w142");
    let undos = 0;
    const deps = fakeDeps({
      tool: (name, args) => {
        const a = String(args.action);
        if (name === "wb_entity" && a === "create")
          return { ok: true, readback: { name: "W1_Q", undoName: "EMCP wb_entity create" } };
        if (name === "wb_entity" && a === "list")
          return { ok: true, readback: { rows: undos >= 4 ? [] : [{ name: "W1_Q" }] } };
        if (name === "wb_prefabs" && args.confirm === true)
          return { ok: true, readback: { file: "x", undoName: `EMCP wb_prefabs ${a}` } };
        return { ok: true, readback: { dryRun: true } };
      },
    });
    deps.undo = async () => {
      undos++;
      return { ok: true, message: "Undo executed" };
    };
    const only = selectSteps(buildSteps(), { only: "w1-42-prefab-files" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(undos).toBe(4);
    const ev = r.records[0].evidence as Raw;
    expect((ev.sweep as Raw).found).toEqual([]);
    expect(ev.extraUndos).toBeUndefined();
  });

  it("w1-44 kills P-W1-18 when removeMembers of a world entity is not refused", async () => {
    const o = opts("w144");
    const deps = fakeDeps({
      tool: (name, args) => {
        const a = String(args.action);
        if (name === "wb_prefabs" && a === "editState")
          return { ok: true, readback: { prefabEdit: true, rootId: "id:0x0000000000000003" } };
        if (name === "wb_entity" && a === "create")
          return { ok: true, readback: { name: "W1_M2", undoName: "u" } };
        return { ok: true, readback: { rows: [] } };
      },
    });
    const only = selectSteps(buildSteps(), { only: "w1-44-prefab-members" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(r.records[0].probes[0]).toMatchObject({ id: "P-W1-18", result: "KILLED" });
    expect(r.records[0].probes[0].note).toMatch(/UNPROVEN/);
  });
});

describe("W1 battery: fix-up 3 net-zero (w1-90 read the pre-flight manifest as a flat map)", () => {
  /** Real files in a temp sandbox that has a .git folder. */
  function realFsDeps(): W1Deps {
    const base = fakeDeps({ tool: () => ({ ok: true, readback: { rows: [] } }) });
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

  function sandbox(name: string): W1Options {
    const o = opts(name);
    const sb = o.sandboxDir;
    put(sb, ".git/HEAD", "ref: refs/heads/main\n");
    put(sb, ".git/COMMIT_EDITMSG", "first\n");
    put(sb, ".gitignore", "x\n");
    put(sb, `${SANDBOX_NAME}.gproj`, "GameProject {}\n");
    put(sb, "Scripts/a.c", "class A {}\n");
    put(sb, `${W1_ROOT}/conf/inputCommon.conf`, "plant\n");
    return o;
  }

  /** The pre-flight manifest form the runbook copied into the sitting as w1-snapshot-before.json. */
  function manifestCopy(o: W1Options): void {
    const files: Record<string, string> = {};
    for (const f of [".gitignore", `${SANDBOX_NAME}.gproj`, "Scripts/a.c"])
      files[f] = createHash("sha256")
        .update(readFileSync(join(o.sandboxDir, f)))
        .digest("hex");
    writeFileSync(
      join(o.sittingDir, "w1-snapshot-before.json"),
      JSON.stringify({
        root: o.sandboxDir,
        declared: [".gitignore", `${SANDBOX_NAME}.gproj`, "Scripts", "_throwaway"],
        taken_at: "2026-11-11T00:00:00Z",
        files,
      }),
    );
  }

  async function run(o: W1Options, deps: W1Deps, id: string) {
    const only = selectSteps(buildSteps(), { only: id });
    if (typeof only === "string") throw new Error(only);
    return (await runBattery(only, deps, o)).records[0];
  }

  it("the gate takes its own snapshot beside the manifest copy; a .git change after it is no change", async () => {
    const o = sandbox("nz-gate");
    manifestCopy(o);
    put(o.sandboxDir, ".git/COMMIT_EDITMSG", "the pre-flight's commit\n");
    const deps = realFsDeps();
    expect((await run(o, deps, "w1-00-gate")).status).toBe("PASS");
    expect(existsSync(join(o.sittingDir, BATTERY_SNAPSHOT_FILE))).toBe(true);
    put(o.sandboxDir, `${W1_ROOT}/worlds/x.ent`, "throwaway\n");
    const nz = netZeroDiff(o.sittingDir, o.sandboxDir, deps);
    expect(nz).toMatchObject({ source: BATTERY_SNAPSHOT_FILE, declared: null, changed: [] });
    const r = await run(o, deps, "w1-90-netzero");
    expect(r.status, r.detail).toBe("PASS");
  });

  it("a real change outside the throwaway folder still fails w1-90", async () => {
    const o = sandbox("nz-real");
    const deps = realFsDeps();
    expect((await run(o, deps, "w1-00-gate")).status).toBe("PASS");
    put(o.sandboxDir, "Scripts/a.c", "class A { int x; }\n");
    const r = await run(o, deps, "w1-90-netzero");
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Scripts/a.c");
  });

  it("the manifest form alone compares only its declared paths, so .git is outside it", () => {
    const o = sandbox("nz-manifest");
    manifestCopy(o);
    put(o.sandboxDir, ".git/HEAD", "ref: refs/heads/other\n");
    const deps = realFsDeps();
    expect(netZeroDiff(o.sittingDir, o.sandboxDir, deps)).toMatchObject({
      source: "w1-snapshot-before.json",
      changed: [],
    });
    put(o.sandboxDir, "Scripts/a.c", "changed\n");
    expect(netZeroDiff(o.sittingDir, o.sandboxDir, deps)?.changed).toEqual(["Scripts/a.c"]);
  });

  it("a run that starts past w1-00 takes the snapshot before its first step (run 7: w1-90 NOT-RUN)", async () => {
    const o = sandbox("nz-resume");
    const deps = realFsDeps();
    const snap = join(o.sittingDir, BATTERY_SNAPSHOT_FILE);
    expect(existsSync(snap)).toBe(false);
    // The first step (w1-90 itself here) sees the snapshot already written; a change made by the
    // run after the snapshot is seen.
    const tool = deps.tool;
    deps.tool = async (name, args) => {
      put(o.sandboxDir, "Scripts/a.c", "changed during the run\n");
      return tool(name, args);
    };
    const r = await run(o, deps, "w1-90-netzero");
    expect(existsSync(snap)).toBe(true);
    const taken = JSON.parse(readFileSync(snap, "utf-8")) as Raw;
    expect(taken.taken_by).toBe("run start");
    expect(r.status).not.toBe("NOT-RUN");
    expect((r.evidence as Raw).snapshotTakenBy).toBe("run start");
    // A second resumed run keeps the sitting's first snapshot.
    const before = readFileSync(snap, "utf-8");
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const only = selectSteps(buildSteps(), { only: "w1-90-netzero" });
    if (typeof only === "string") throw new Error(only);
    const r2 = (await runBattery(only, deps, o2)).records[0];
    expect(readFileSync(snap, "utf-8")).toBe(before);
    expect(r2.status).toBe("FAIL");
    expect(r2.detail).toContain("Scripts/a.c");
  });

  it("the gate's snapshot records that the gate took it", async () => {
    const o = sandbox("nz-gate-by");
    const deps = realFsDeps();
    expect((await run(o, deps, "w1-00-gate")).status).toBe("PASS");
    const taken = JSON.parse(
      readFileSync(join(o.sittingDir, BATTERY_SNAPSHOT_FILE), "utf-8"),
    ) as Raw;
    expect(taken.taken_by).toBe("gate");
  });

  it("the first runs' flat map is still read as path to sha256", () => {
    expect(snapshotFiles({ "a.c": "0".repeat(64) })).toEqual({
      files: { "a.c": "0".repeat(64) },
      declared: null,
    });
    expect(snapshotFiles({ root: "x", declared: ["a"], taken_at: "t" })).toBeNull();
  });
});

describe("W1 battery: W1 cold run fix-up audit (busy windows are graced, 1.9.0.37)", () => {
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
    win({ hwnd: 2, title: "World Editor - EMCP2_sandbox/_throwaway/W1/worlds/x.ent" }),
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

  it("w1-10-world-state watches with the busy-window grace", () => {
    expect(WATCH_OPTIONS).toMatchObject({ busyGraceMs: BUSY_GRACE_MS });
  });

  it("a transient busy change (the editor windows disabled for a while) is not a handoff", async () => {
    const o = opts("busytransient");
    const { deps, seen } = busyDeps(5);
    const r = await runBattery(only("w1-10-world-state"), deps, o);
    expect(seen()).toBe(true);
    expect(r.records[0]!.status, r.records[0]!.detail).not.toBe("HANDOFF");
    expect(r.exit).not.toBe(EXIT.handoff);
  });

  it("the same windows past the grace are a handoff that says so", async () => {
    const o = opts("busystays");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER);
    const r = await runBattery(only("w1-10-world-state"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).toMatch(/past the 60000 ms grace/);
  });

  it("a real modal beside the busy windows still hands off at once", async () => {
    const o = opts("busymodal");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER, MODAL);
    const r = await runBattery(only("w1-10-world-state"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).not.toMatch(/grace/);
  });
});

describe("W1 cold run fix-up: the play-mode transition (w1-60, 1.9.0.37)", () => {
  const SRC = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf8");

  it("every step is watched with WATCH_OPTIONS (W4's and W8's busy grace)", () => {
    expect(WATCH_OPTIONS).toEqual({ popups: false, busyGraceMs: BUSY_GRACE_MS });
    expect(SRC).toContain("s.run(ctx), WATCH_OPTIONS)");
  });

  it("w1-60 is a polled step (no hand request), so the grace applies to it", () => {
    const at = SRC.indexOf('id: "w1-60-play"');
    const body = SRC.slice(at, SRC.indexOf('id: "w1-90-netzero"', at));
    expect(body).not.toContain("awaitHand(");
  });

  it("w1-60 waits for edit mode after its stop, and its restorer does too", () => {
    const at = SRC.indexOf('id: "w1-60-play"');
    const body = SRC.slice(at, SRC.indexOf('id: "w1-90-netzero"', at));
    const stop = body.indexOf('stop = await ctx.tool("wb_world", { action: "stop" }');
    expect(stop).toBeGreaterThan(0);
    expect(body.indexOf('waitMode(ctx, "edit")', stop)).toBeGreaterThan(stop);
    expect(body).toContain("await settleEdit(ctx.deps)");
  });

  function worldDeps(mode: (stopped: boolean) => string) {
    let stopped = false;
    const sent: string[] = [];
    const deps = fakeDeps({
      tool: (name, args) => {
        if (name === "wb_world") sent.push(String(args.action));
        if (name === "wb_world" && args.action === "stop") stopped = true;
        if (name === "wb_world" && args.action === "state")
          return { ok: true, readback: { mode: mode(stopped), worldPath: "" } };
        return { ok: true, readback: {} };
      },
    });
    return { deps, sent };
  }

  it("the closable step leaves play mode before anything else: stop, then state until edit", async () => {
    const o = opts("closeplay");
    let editReads = 0;
    const { deps, sent } = worldDeps((stopped) => {
      if (!stopped) return "play";
      editReads++;
      return editReads < 3 ? "play" : "edit";
    });
    const r = await runBattery(only(CLOSABLE_STEP), deps, o);
    expect(sent.slice(0, 5)).toEqual(["state", "stop", "state", "state", "state"]);
    expect((r.records[0]!.evidence as { editPolls: number }).editPolls).toBe(3);
    expect(r.records[0]!.detail).not.toMatch(/play was not left/);
  });

  it("the closable step FAILs when play is never left", async () => {
    const o = opts("closestuck");
    const { deps } = worldDeps(() => "play");
    const r = await runBattery(only(CLOSABLE_STEP), deps, o);
    expect(r.records[0]!.status).toBe("FAIL");
    expect(r.records[0]!.detail).toMatch(new RegExp(`no edit mode after ${MODE_POLLS} poll`));
  });
});
