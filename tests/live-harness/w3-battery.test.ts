import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
  FILTER_TEMP_ID,
  LAUNCH_INI_NAMES,
  RELOAD_GRACE_MS,
  lspKeysInIni,
  watchOptions,
  FIXTURE_ST,
  GATE_STEP,
  GPROJ_BACKUP,
  GPROJ_REL,
  HANDOFF_PROBES,
  HAND_STEP,
  LAUNCH_ARGS,
  NOT_EXERCISED,
  NOT_TESTABLE,
  PLANT_FILE,
  PROBE_IDS,
  SCRIPT_LIST,
  SCRIPT_PATH,
  SCRIPT_UNDO_PRESSES_MAX,
  STEP_DIALOG_ANSWERS,
  TS_ONLY_ACTIONS,
  W3_CONTRACTS,
  W3_ROOT,
  buildActionPlan,
  buildQueue,
  buildSteps,
  dryRunCheck,
  enumNumber,
  exercisedBy,
  fixtureInstruction,
  guidOfMeta,
  handAnswer,
  handFiles,
  handLine,
  listTreeOf,
  main,
  missingFileRefusal,
  namesRel,
  netZeroDiff,
  PLANNED_DIALOGS,
  RELOAD_PROMPT,
  plannedDialogUp,
  plantedLines,
  plantedText,
  priorHandAnswer,
  redactPersonal,
  relOf,
  runBattery,
  runPlant,
  runRollback,
  sameLines,
  selectSteps,
  underW3,
  withPrelude,
  type OfflineIo,
  type StepDef,
  type ToolResponse,
  type TreeFs,
  type W3Deps,
  type W3Options,
  type W3Tool,
} from "../live/w3.live.js";
import { baselinePath, baselineRegressions, readBaseline } from "../live/baseline.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-w3-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 4343;

type Raw = Record<string, unknown>;

function contractActions(handler: string): string[] {
  const c = JSON.parse(readFileSync(join(REPO_ROOT, "contracts", `${handler}.json`), "utf-8")) as {
    actions: Array<{ name?: string; action?: string }> | Record<string, unknown>;
  };
  return Array.isArray(c.actions)
    ? c.actions.map((a) => String(a.name ?? a.action))
    : Object.keys(c.actions);
}

describe("W3 battery: the dry-run gate", () => {
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
    expect(LAUNCH_ARGS.join(" ")).toContain("<sitting>/w3-scratch.ini");
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("step ids are unique, w3-NN-…; the gate is first, the hand step makes the fixture, closable is last", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w3-\d\d-[a-z0-9-]+$/);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids[ids.length - 1]).toBe(CLOSABLE_STEP);
    const hand = steps.find((s) => s.id === HAND_STEP)!;
    expect(hand.handDriven).toBe(true);
    expect(ids.indexOf(HAND_STEP)).toBeLessThan(ids.findIndex((id) => id.startsWith("w3-1")));
  });

  it("the OD-1 instruction names File > New, both dialogs, the full folder, Save, the X and the answer JSON", () => {
    const t = fixtureInstruction(join("D:", "bed", SANDBOX_NAME));
    expect(t).toContain("File > New");
    expect(t).toContain("Create string table");
    expect(t).toContain("Choose String Table Item class");
    expect(t).toContain(join("D:", "bed", SANDBOX_NAME, "_throwaway", "W3", "st"));
    expect(t).toContain("File > Save");
    expect(t).toContain("title-bar X");
    expect(t).toMatch(/"done": true/);
    expect(t).toMatch(/"itemClass"/);
    // W3 fix-up 1: run 1's dialog facts
    expect(t).toContain("no OK button");
    expect(t).toContain("double-click");
    expect(t).toContain("StringTable successfully created.");
  });
});

describe("W3 battery: fix-up 1 (run 1)", () => {
  it("no step registers a script .c (not a registrable resource: W6 fix-up 1, W3 run 1 w3-03)", () => {
    const plan = buildActionPlan(buildSteps()) as unknown as Raw[];
    const regs = plan.filter((a) => a.tool === "wb_world" && a.toolAction === "register");
    expect(regs.length).toBeGreaterThan(0);
    for (const a of regs)
      expect(String(((a.params ?? {}) as Raw).path), String(a.step)).not.toMatch(/\.c$/i);
  });

  it("w3-03 plants a missing script without a register call", async () => {
    const o = opts("fixup1-w303");
    const calls: Array<[string, Raw]> = [];
    const deps = fakeDeps({
      tool: (name, args) => {
        calls.push([name, args]);
        return { ok: true, readback: {} };
      },
    });
    plantSitting(deps, o);
    deps.writeBytes(join(o.sandboxDir, ...FIXTURE_ST.split("/")), Buffer.from("StringTable {}"));
    const only = selectSteps(buildSteps(), { only: "w3-03-fixture-check" });
    if (typeof only === "string") throw new Error(only);
    await runBattery(only, deps, o);
    for (const rel of SCRIPT_LIST)
      expect(deps.exists(join(o.sandboxDir, ...rel.split("/"))), rel).toBe(true);
    expect(calls.some(([n, a]) => n === "wb_world" && a.path === FIXTURE_ST)).toBe(true);
    const scriptRegs = calls.filter(
      ([n, a]) => n === "wb_world" && a.action === "register" && /\.c$/i.test(String(a.path)),
    );
    expect(scriptRegs).toEqual([]);
  });

  it("a resumed hand step with the fixture on disk asks nothing and records the earlier answer", async () => {
    const o = opts("fixup1-hand");
    const deps = fakeDeps({});
    plantSitting(deps, o);
    deps.writeBytes(join(o.sandboxDir, ...FIXTURE_ST.split("/")), Buffer.from("StringTable {}"));
    const earlier = handFiles(join(o.sittingDir, "run-0"), "w3-02-fixture").answer;
    deps.writeBytes(earlier, Buffer.from(JSON.stringify({ done: true, itemClass: "X" })));
    expect(priorHandAnswer(o.sittingDir, "w3-02-fixture", deps)?.runDir).toBe("run-0");
    const only = selectSteps(buildSteps(), { only: HAND_STEP });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    const rec = r.records.find((x) => x.step === HAND_STEP)!;
    expect(rec.status).toBe("PASS");
    expect((rec.evidence as Raw).alreadyPresent).toBe(true);
    expect(((rec.evidence as Raw).priorHand as Raw).itemClass).toBe("X");
    expect(deps.exists(handFiles(o.runDir, "w3-02-fixture").request)).toBe(false);
  });

  it("listTreeOf skips an entry that vanishes between the listing and the stat", () => {
    const fs: TreeFs = {
      exists: () => true,
      readdir: (p) => {
        if (p.endsWith("gone-dir")) throw new Error("ENOENT: no such file or directory, scandir");
        return p.endsWith("sub") ? ["b.txt"] : ["a.txt", "scratch.ini.jOXMLh", "sub", "gone-dir"];
      },
      isDir: (p) => {
        if (p.endsWith("scratch.ini.jOXMLh"))
          throw new Error("ENOENT: no such file or directory, stat");
        return p.endsWith("sub") || p.endsWith("gone-dir");
      },
    };
    expect(listTreeOf(join("X", "root"), fs)).toEqual(["a.txt", "sub/b.txt"]);
    const real = join(TMP, "fixup1-tree");
    mkdirSync(join(real, "d"), { recursive: true });
    writeFileSync(join(real, "d", "f.txt"), "x");
    expect(listTreeOf(real)).toEqual(["d/f.txt"]);
  });
});

/**
 * A Script Editor on fakes: one buffer per script, the active one, and an undo stack in which a
 * setLine is two steps (run 2: one Edit > Undo took the new text to ""). `saves` lists each save.
 */
function fakeScriptEditor(): {
  tool: (name: W3Tool, args: Raw) => ToolResponse;
  saves: string[];
  buf: () => string[];
} {
  const bufs = new Map<string, string[]>();
  let active = "";
  const undo: Array<() => void> = [];
  const saves: string[] = [];
  const cur = (): string[] => {
    if (!bufs.has(active)) bufs.set(active, [...plantedLines(active)]);
    return bufs.get(active)!;
  };
  const tool = (name: W3Tool, args: Raw): ToolResponse => {
    if (name === "wb_module" && args.action === "action") {
      // As the tool: Edit > Undo is mutating in the ledger, so without confirm it is a dry run.
      if (args.confirm !== true)
        return { ok: true, readback: { dryRun: true, ran: false, risk: "mutating" } };
      const step = undo.pop();
      if (step) step();
      return { ok: true, readback: { menuPath: "Edit > Undo", result: true } };
    }
    if (name !== "wb_script_editor") return { ok: true, readback: {} };
    const b = active ? cur() : [];
    switch (args.action) {
      case "open":
        active = String(args.path);
        return { ok: true, readback: { result: true, relPath: active, inProject: true } };
      case "state":
        return { ok: true, readback: { opened: !!active, relPath: active, inProject: true } };
      case "getLines": {
        const s = Number(args.start ?? 0);
        const rows = b.slice(s, s + Number(args.limit ?? 50));
        return { ok: true, readback: { start: s, total: b.length, rows } };
      }
      case "setLine": {
        const n = Number(args.line);
        const before = b[n]!;
        b[n] = String(args.text);
        undo.push(() => (b[n] = before));
        undo.push(() => (b[n] = ""));
        return { ok: true, readback: { line: n, before, after: b[n], linesCount: b.length } };
      }
      case "save":
        saves.push(active);
        return { ok: true, readback: { dryRun: false, relPath: active, saved: true } };
      default:
        return { ok: true, readback: {} };
    }
  };
  return { tool, saves, buf: () => [...(bufs.get(SCRIPT_LIST[0]!) ?? [])] };
}

describe("W3 battery: fix-up 2 (run 2)", () => {
  it("w3-20 presses Edit > Undo again while it changes line 7: two steps restore it, P-W3-06 PARTIAL", async () => {
    const o = opts("fixup2-w320");
    const se = fakeScriptEditor();
    const deps = fakeDeps({ tool: se.tool });
    plantSitting(deps, o);
    const only = selectSteps(buildSteps(), { only: "w3-20-script-undo" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    const rec = r.records.find((x) => x.step === "w3-20-script-undo")!;
    const p = rec.probes.find((x) => x.id === "P-W3-06")!;
    expect(p.result).toBe("PARTIAL");
    expect((p.observed as Raw).presses).toBe(2);
    expect((p.observed as Raw).line7AfterEachPress).toEqual(["", plantedLines(SCRIPT_LIST[0]!)[7]]);
    expect(p.note).toMatch(/in 2 steps, not one/);
    expect((rec.evidence as Raw).restoreByBefore).toBeUndefined();
    expect(sameLines(se.buf(), plantedLines(SCRIPT_LIST[0]!))).toBe(true);
    expect(SCRIPT_UNDO_PRESSES_MAX).toBe(3);
  });

  it("w3-95 saves every planted script even when its buffer equals the disk (run 2 close prompt)", async () => {
    const o = opts("fixup2-w395");
    const se = fakeScriptEditor();
    const deps = fakeDeps({ tool: se.tool });
    plantSitting(deps, o);
    for (const rel of SCRIPT_LIST)
      deps.writeBytes(join(o.sandboxDir, ...rel.split("/")), Buffer.from(plantedText(rel)));
    const only = selectSteps(buildSteps(), { only: CLOSABLE_STEP });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    const rec = r.records.find((x) => x.step === CLOSABLE_STEP)!;
    expect(rec.status).toBe("PASS");
    expect([...se.saves].sort()).toEqual([...SCRIPT_LIST].sort());
    const scripts = (rec.evidence as Raw).scripts as Record<string, Raw>;
    for (const rel of SCRIPT_LIST) expect(scripts[rel]!.bufferEqualsDisk, rel).toBe(true);
  });
});

describe("W3 battery: fix-up 3 (run 3)", () => {
  it("w3-40: a save that answers ENGINE_FALSE and writes nothing is the stated limit, not a FAIL", async () => {
    const o = opts("fixup3-w340");
    const se = fakeScriptEditor();
    const tool = (name: W3Tool, args: Raw): ToolResponse =>
      name === "wb_script_editor" && args.action === "save" && args.confirm === true
        ? {
            ok: false,
            code: "ENGINE_FALSE",
            message: "ENGINE_FALSE: Save returned false for _throwaway/W3/scripts/EMCP_W3_SaveA.c",
          }
        : name === "wb_script_editor" && args.action === "save"
          ? { ok: true, readback: { dryRun: true, saved: false } }
          : se.tool(name, args);
    const deps = fakeDeps({ tool });
    plantSitting(deps, o);
    const only = selectSteps(buildSteps(), { only: "w3-40-script-save" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    const rec = r.records.find((x) => x.step === "w3-40-script-save")!;
    expect(rec.status, rec.detail).toBe("PASS");
    expect(rec.detail).toMatch(/refused ENGINE_FALSE, nothing written/);
    expect((rec.evidence as Raw).saveLimit).toMatch(/wrote nothing/);
  });

  it("w3-27 inserts a decoy row so the seed filter can narrow, and deletes it", () => {
    const s = buildSteps().find((x) => x.id === "w3-27-loc-filter")!;
    const calls = s
      .plan()
      .map((a) => `${String((a as Raw).tool)}.${String(((a as Raw).params as Raw)?.action)}`);
    expect(calls).toContain("wb_localization.insert");
    expect(calls).toContain("wb_localization.delete");
    expect(FILTER_TEMP_ID.startsWith("W3_T_")).toBe(true);
    expect(FILTER_TEMP_ID).not.toContain("EMCP_W3_SEED");
  });

  it("only w3-62 opts into the reload grace (progress windows, 30 s); the rest get the busy grace", () => {
    const graced = buildSteps().filter((s) => s.reloadGrace);
    expect(graced.map((s) => s.id)).toEqual(["w3-62-reload"]);
    expect(watchOptions(graced[0]!)).toEqual({
      busyGraceMs: RELOAD_GRACE_MS,
      progressWindows: true,
    });
    expect(watchOptions({})).toEqual({ busyGraceMs: BUSY_GRACE_MS });
    expect(RELOAD_GRACE_MS).toBe(30_000);
  });

  it("w3-42's planned answer names the Reload prompt and Yes, and resumes at the next step", () => {
    const h = handAnswer(
      'a dialog-like window appeared (Qt683QWindowIcon "Reload", owner 7669974): owner hand',
      "w3-42-script-reload",
    );
    expect(h.title).toBe("Reload");
    expect(h.answer).toMatch(/^Yes on the "Reload" prompt/);
    expect(h.answer).toMatch(/never Save/);
    expect(h.resumeFrom).toBe("w3-43-loc-save");
    const s = buildSteps().find((x) => x.id === "w3-42-script-reload")!;
    const opens = s
      .plan()
      .filter(
        (a) =>
          (a as Raw).tool === "wb_script_editor" && ((a as Raw).params as Raw)?.action === "open",
      );
    expect(opens.length).toBeGreaterThanOrEqual(3);
  });

  it("lspKeysInIni reads LSP_Enabled in [Workbench] of w3-scratch.ini, else scratch.ini", () => {
    const o = opts("fixup3-ini");
    const deps = fakeDeps({});
    expect(lspKeysInIni({ opts: o, deps })).toEqual({ ini: null, enabled: null, port: null });
    deps.writeBytes(
      join(o.sittingDir, "scratch.ini"),
      Buffer.from("[Other]\r\nLSP_Enabled=1\r\n[Workbench]\r\nNetAPI_Enabled=1\r\n"),
    );
    expect(lspKeysInIni({ opts: o, deps })).toEqual({
      ini: "scratch.ini",
      enabled: false,
      port: null,
    });
    deps.writeBytes(
      join(o.sittingDir, "w3-scratch.ini"),
      Buffer.from("[Workbench]\nLSP_Enabled=1\nLSP_Port=5776\n"),
    );
    expect(lspKeysInIni({ opts: o, deps })).toEqual({
      ini: "w3-scratch.ini",
      enabled: true,
      port: "5776",
    });
    expect(LAUNCH_INI_NAMES).toEqual(["w3-scratch.ini", "scratch.ini"]);
  });

  const lspRun = async (name: string, ini: string): Promise<Raw[]> => {
    const o = opts(name);
    const deps = fakeDeps({});
    deps.lsp = async () => ({
      result: "connect-failed",
      detail: "connect failed (ECONNREFUSED)",
      messages: [],
    });
    plantSitting(deps, o);
    deps.writeBytes(join(o.sittingDir, "scratch.ini"), Buffer.from(ini));
    const sel = selectSteps(buildSteps(), { from: "w3-50-lsp-init", until: "w3-52-lsp-tool" });
    if (typeof sel === "string") throw new Error(sel);
    const r = await runBattery(sel, deps, o);
    return r.records as unknown as Raw[];
  };

  it("w3-50: no listener without the LSP keys is NOT-RUN (precondition absent) and skips w3-51/52", async () => {
    const recs = await lspRun("fixup3-lsp-off", "[Workbench]\nNetAPI_Enabled=1\n");
    const r50 = recs.find((x) => x.step === "w3-50-lsp-init")!;
    expect(r50.status).toBe("NOT-RUN");
    const p = (r50.probes as Raw[])[0]!;
    expect(p.result).toBe("PARTIAL");
    expect((p.observed as Raw).preconditionAbsent).toBe(true);
    for (const id of ["w3-51-lsp-second", "w3-52-lsp-tool"]) {
      const r = recs.find((x) => x.step === id)!;
      expect(r.status, id).toBe("SKIPPED");
      expect(String(r.detail), id).toMatch(/P-W3-23 not run in w3-50/);
    }
  });

  it("w3-50: no listener WITH the LSP keys set is still the kill", async () => {
    const recs = await lspRun("fixup3-lsp-on", "[Workbench]\nLSP_Enabled=1\nLSP_Port=5776\n");
    const r50 = recs.find((x) => x.step === "w3-50-lsp-init")!;
    expect(r50.status).toBe("KILLED");
    expect(String(r50.detail)).toMatch(/with LSP_Enabled=1 in scratch.ini/);
  });
});

describe("W3 battery: coverage", () => {
  const steps = buildSteps();
  const exercised = new Set(steps.flatMap(exercisedBy));

  it("every action of the two contracts is exercised or in NOT_EXERCISED with a reason", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W3_CONTRACTS)) {
      const actions = contractActions(handler);
      expect(actions.length, handler).toBeGreaterThan(5);
      for (const a of actions) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
    for (const reason of Object.values(NOT_EXERCISED)) expect(reason.length).toBeGreaterThan(10);
  });

  it("every TS-only action (string_table, script_lsp, the 1.x names, the audit) is exercised or listed", () => {
    const missing: string[] = [];
    for (const [tool, actions] of Object.entries(TS_ONLY_ACTIONS))
      for (const a of actions) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    expect(missing).toEqual([]);
  });

  it("every probe P-W3-01..26 is assigned to a step or listed as not testable with a reason", () => {
    expect(PROBE_IDS).toHaveLength(26);
    const assigned = new Set(steps.flatMap((s) => s.probes));
    for (const id of PROBE_IDS) {
      const ok = assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10;
      expect(ok, id).toBe(true);
    }
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of steps) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
    for (const [step, probe] of Object.entries(HANDOFF_PROBES)) {
      const s = steps.find((x) => x.id === step);
      expect(s, step).toBeTruthy();
      expect(s!.probes).toContain(probe);
    }
    for (const step of Object.keys(STEP_DIALOG_ANSWERS))
      expect(
        steps.some((s) => s.id === step),
        step,
      ).toBe(true);
  });

  it("P-W3-23 is reported by a step and the battery never sets ENFUSION_SCRIPT_LSP", () => {
    expect(steps.some((s) => s.probes.includes("P-W3-23"))).toBe(true);
    const src = readFileSync(join(REPO_ROOT, ...SCRIPT_PATH.split("/")), "utf-8");
    // No assignment to the gate variable and no object key that sets it (prose may name it).
    expect(src).not.toMatch(/process\.env(\.ENFUSION_SCRIPT_LSP|\[[^\]]+\])\s*=(?!=)/);
    expect(src).not.toMatch(/["']?ENFUSION_SCRIPT_LSP["']?\s*:/);
    expect(src).not.toMatch(/\[GATE_ENV\]\s*:/);
  });
});

describe("W3 battery: writes stay under _throwaway/W3/", () => {
  const steps = buildSteps();
  const plan = buildActionPlan(steps) as unknown as Raw[];

  it("every declared write lies under _throwaway/W3/", () => {
    for (const s of steps)
      for (const w of s.writes) expect(w.startsWith(`${W3_ROOT}/`), `${s.id} ${w}`).toBe(true);
  });

  it("every file-writing call in the plan names its paths under _throwaway/W3/", () => {
    let seen = 0;
    for (const a of plan) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (!FILE_WRITE_ACTIONS.has(key)) continue;
      const params = (a.params ?? {}) as Raw;
      const paths = [params.path, params.outDir, a.document].filter((p) => typeof p === "string");
      const isSave = key.endsWith(".save");
      if (isSave) expect(typeof a.document, `${String(a.step)} ${key}`).toBe("string");
      expect(paths.length, `${String(a.step)} ${key}`).toBeGreaterThan(0);
      for (const p of paths)
        expect(String(p).startsWith(`${W3_ROOT}/`), `${String(a.step)} ${key} ${String(p)}`).toBe(
          true,
        );
      seen++;
    }
    expect(seen).toBeGreaterThan(20);
  });

  it("every wb_module action press carries confirm: true (a mutating item is a dry run without)", () => {
    const presses = plan.filter((a) => a.tool === "wb_module" && a.toolAction === "action");
    expect(presses.length).toBeGreaterThan(0);
    for (const a of presses) expect((a.params as Raw).confirm, String(a.step)).toBe(true);
  });

  it("no plan entry calls a denied API, executes anything but Edit > Undo, or sends an LSP write method", () => {
    const denied = ["RunCommandline", "Workbench.Exit", "Workbench.RunCmd", "Workbench.RunProcess"];
    for (const a of plan) {
      if (a.kind === "net-call") expect(denied).not.toContain(a.target);
      if (a.kind === "execute-action")
        expect((a.target as Raw).path, String(a.step)).toEqual(["Edit", "Undo"]);
      if (a.kind === "lsp")
        for (const m of (a.methods as string[]) ?? [])
          expect(m).not.toMatch(
            /didSave|didChange|willSave|applyEdit|executeCommand|shutdown|exit/,
          );
    }
    // wb_localization buildRuntime and both close actions are only sent in their GATED form.
    const gated = plan.filter(
      (a) =>
        (a.tool === "wb_localization" &&
          (a.toolAction === "buildRuntime" || a.toolAction === "close")) ||
        (a.tool === "wb_script_editor" && a.toolAction === "close"),
    );
    expect(gated.length).toBe(3);
    for (const a of gated) expect(((a.params ?? {}) as Raw).confirm).not.toBe(true);
  });

  it("the battery's own write refuses a path outside _throwaway/W3/ at run time", async () => {
    const o = opts("writeguard");
    const deps = fakeDeps({});
    plantSitting(deps, o);
    const steps = buildSteps();
    const evil = {
      ...steps.find((s) => s.id === "w3-60-validate")!,
      id: "w3-60-validate",
      run: async (ctx: Parameters<(typeof steps)[number]["run"]>[0]) => {
        ctx.write("Scripts/Game/evil.c", Buffer.from("x"));
        return { status: "PASS" as const, detail: "", evidence: {} };
      },
    };
    const r = await runBattery([evil], deps, o);
    const rec = r.records.find((x) => x.step === "w3-60-validate")!;
    expect(rec.status).toBe("STOPPED");
    expect(rec.detail).toContain("only under _throwaway/W3/");
    expect(deps.exists(join(o.sandboxDir, "Scripts", "Game", "evil.c"))).toBe(false);
  });
});

describe("W3 battery: helpers", () => {
  it("the planted script is 10 lines with CRLF and line 7 a Print", () => {
    const rel = SCRIPT_LIST[0]!;
    const t = plantedText(rel).toString("utf-8");
    expect(t.split("\r\n").length).toBe(11);
    expect(plantedLines(rel)[7]).toContain("Print");
    expect(sameLines(plantedLines(rel), [...plantedLines(rel), ""])).toBe(true);
    expect(sameLines(plantedLines(rel), plantedLines(rel).slice(1))).toBe(false);
    for (const s of SCRIPT_LIST) expect(s.startsWith(`${W3_ROOT}/scripts/`)).toBe(true);
  });

  it("paths: the addon prefix and GUID are taken off; underW3 and namesRel", () => {
    expect(relOf("$EMCP2_sandbox:{0123456789ABCDEF}_throwaway/W3/st/x.st")).toBe(
      "_throwaway/W3/st/x.st",
    );
    expect(underW3("$EMCP2_sandbox:_throwaway/W3/scripts/a.c")).toBe(true);
    expect(underW3("Scripts/Game/a.c")).toBe(false);
    expect(
      namesRel("C:\\x\\EMCP2_sandbox\\_throwaway\\W3\\st\\a.st", "_throwaway/W3/st/a.st"),
    ).toBe(true);
    expect(guidOfMeta('MetaFileClass {\n Name "{5A1B2C3D4E5F6071}_throwaway/W3/st/a.st"\n}')).toBe(
      "{5A1B2C3D4E5F6071}",
    );
    expect(
      enumNumber(
        [{ name: "Status", enums: ["A=0", "TRANSLATION_PENDING=3"] }],
        "Status",
        "TRANSLATION_PENDING",
      ),
    ).toBe("3");
  });

  it("the Workbench user name never reaches a record (Author, LastChanged, file text)", () => {
    const r = redactPersonal({
      a: { Author: "wb_user_q7", LastChanged: "wb_user_q7 2026" },
      fields: [{ name: "Author", type: "string", value: "wb_user_q7" }],
      text: 'Author "wb_user_q7"\nLastChanged "x"',
    });
    expect(JSON.stringify(r)).not.toContain("wb_user_q7");
  });

  it("an open of a _throwaway file that is not on disk is refused before it is sent", () => {
    const ctx = { opts: { sandboxDir: "C:/bed" }, deps: { exists: () => false } };
    expect(missingFileRefusal(ctx, FIXTURE_ST)).toMatch(/not on disk/);
    expect(missingFileRefusal(ctx, "Scripts/Game/x.c")).toBeNull();
  });

  it("the HAND REQUEST line names the run folder and the full answer path", () => {
    const run = join(TMP, "sit", "run-1");
    const l = handLine(run, "w3-02-fixture", "do it");
    expect(l).toContain(run);
    expect(l).toContain(handFiles(run, "w3-02-fixture").answer);
  });

  it("a planned dialog resumes at the next step; a save prompt gets No and resumes the same step", () => {
    const h = handAnswer(
      'a dialog-like window appeared: #32770 "File changed"',
      "w3-42-script-reload",
    );
    expect(h.title).toBe("File changed");
    expect(h.resumeFrom).toBe("w3-43-loc-save");
    expect(h.answer).toMatch(/never Save/);
    const s = handAnswer('window #32770 "Save changes?"', "w3-43-loc-save");
    expect(s.answer).toBe("No");
    expect(s.resumeFrom).toBe("w3-43-loc-save");
  });

  it("selectSteps honours --only, --from, --until", () => {
    const steps = buildSteps();
    expect(selectSteps(steps, { only: "w3-20-script-undo" })).toHaveLength(1);
    const r = selectSteps(steps, { from: "w3-20-script-undo", until: "w3-22-script-replace" });
    expect(Array.isArray(r) && r.map((s) => s.id)).toEqual([
      "w3-20-script-undo",
      "w3-21-script-lines",
      "w3-22-script-replace",
    ]);
    expect(typeof selectSteps(steps, { only: "w3-99-x" })).toBe("string");
    expect(typeof selectSteps(steps, { only: "w3-20-script-undo", from: GATE_STEP })).toBe(
      "string",
    );
  });

  it("a resumed run sends the gate first, and the fixture steps when the table is absent", () => {
    const all = buildSteps();
    const only = all.filter((s) => s.id === "w3-24-loc-set-undo");
    expect(withPrelude(only, all, true).map((s) => s.id)).toEqual([
      GATE_STEP,
      "w3-24-loc-set-undo",
    ]);
    expect(withPrelude(only, all, false).map((s) => s.id)).toEqual([
      GATE_STEP,
      "w3-01-editors",
      HAND_STEP,
      "w3-03-fixture-check",
      "w3-24-loc-set-undo",
    ]);
    const script = all.filter((s) => s.id === "w3-20-script-undo");
    expect(withPrelude(script, all, false).map((s) => s.id)).toEqual([
      GATE_STEP,
      "w3-20-script-undo",
    ]);
  });
});

// ── Fake deps for runBattery ──

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W3Tool, args: Raw) => ToolResponse;
  windows?: WindowInfo[];
  files?: Map<string, Buffer>;
}): W3Deps & { files: Map<string, Buffer> } {
  const files = over.files ?? new Map<string, Buffer>();
  const norm = (p: string): string => p.replace(/\\/g, "/");
  return {
    files,
    tool: async (name, args) => (over.tool ? over.tool(name, args) : { ok: true, readback: {} }),
    lsp: async () => ({ result: "no-answer", messages: [] }),
    info: async () =>
      over.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : over.info,
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async (): Promise<WindowInfo[]> => over.windows ?? [],
    recordedPid: () => PID,
    readBytes: (p) => {
      const b = files.get(norm(p));
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    writeBytes: (p, b) => {
      files.set(norm(p), b);
    },
    makeDir: () => undefined,
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

function opts(name: string): W3Options {
  const sitting = join(TMP, name);
  return {
    runDir: join(sitting, "run-1"),
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W3Options["ph"],
    build: "test",
  };
}

function plantSitting(deps: W3Deps, o: W3Options): void {
  deps.writeBytes(join(o.sittingDir, PLANT_FILE), Buffer.from("{}"));
  deps.writeBytes(join(o.sandboxDir, GPROJ_REL), Buffer.from("gproj"));
}

function only(id: string) {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

const dialog = (title: string): WindowInfo => ({
  hwnd: 7,
  pid: PID,
  className: "#32770",
  title,
  owner: 1,
  enabled: true,
  rect: [0, 0, 10, 10],
  monitor: [0, 0, 100, 100],
  primary: true,
});

describe("W3 battery: runner stop rules", () => {
  it("a step that PASSED in the W3 baseline and ends KILLED is a REGRESSION line (a1: the undo steps)", () => {
    const baseline = readBaseline(baselinePath("w3"));
    expect(baseline?.steps["w3-20-script-undo"]).toBe("PASS");
    const out = baselineRegressions(
      [
        { step: "w3-20-script-undo", status: "KILLED", detail: "P-W3-06: undo refused" },
        { step: "w3-21-script-lines", status: "PASS" },
        { step: "w3-85-handoffs", status: "KILLED" },
      ],
      baseline,
    );
    expect(out).toEqual([
      "REGRESSION w3-20-script-undo: PASS in W3/a4, KILLED now (P-W3-06: undo refused)",
    ]);
  });

  it("refuses to start unless the open project is the test bed", async () => {
    const o = opts("notbed");
    const deps = fakeDeps({ info: { projectFound: 1, projectName: "SomeOtherMod" } });
    plantSitting(deps, o);
    const only = selectSteps(buildSteps(), { only: "w3-10-script-state" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.records[0]!.step).toBe(GATE_STEP);
    expect(r.records[0]!.status).toBe("ABORTED");
    expect(r.records).toHaveLength(1);
  });

  it("the gate takes the battery's snapshot; a LOST client code stops the battery and is not retried", async () => {
    const o = opts("lost");
    let calls = 0;
    const deps = fakeDeps({
      tool: () => {
        calls++;
        return { ok: false, code: "LOST", message: "connection lost" };
      },
    });
    plantSitting(deps, o);
    const only = selectSteps(buildSteps(), { only: "w3-10-script-state" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(deps.exists(join(o.sittingDir, BATTERY_SNAPSHOT_FILE))).toBe(true);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records.map((x) => x.status)).toEqual(["PASS", "STOPPED"]);
    expect(calls).toBe(1);
  });

  it("a step that depends on a killed probe is SKIPPED with the reason", async () => {
    const o = opts("skip");
    const deps = fakeDeps({});
    plantSitting(deps, o);
    const kill = {
      step: "w3-10-script-state",
      block: "W3.1",
      title: "x",
      status: "KILLED",
      detail: "x",
      startedAt: "",
      endedAt: "",
      probes: [{ id: "P-W3-01", result: "KILLED", observed: {}, note: "inProject false" }],
      evidence: {},
    };
    deps.writeBytes(join(o.runDir, "w3-10-script-state.json"), Buffer.from(JSON.stringify(kill)));
    const only = selectSteps(buildSteps(), { only: "w3-20-script-undo" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    const rec = r.records.find((x) => x.step === "w3-20-script-undo")!;
    expect(rec.status).toBe("SKIPPED");
    expect(rec.detail).toContain("P-W3-01");
  });

  it("a step is never run twice in one run folder", async () => {
    const o = opts("twice");
    const deps = fakeDeps({});
    plantSitting(deps, o);
    deps.writeBytes(join(o.runDir, `${GATE_STEP}.json`), Buffer.from("{}"));
    const r = await runBattery(buildSteps().slice(0, 1), deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });

  it("the hand step refuses to start over a dialog already up (HANDOFF, nothing asked)", async () => {
    const o = opts("handdialog");
    const deps = fakeDeps({ windows: [dialog("Create string table")] });
    plantSitting(deps, o);
    const only = selectSteps(buildSteps(), { only: HAND_STEP });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records.some((x) => x.status === "HANDOFF")).toBe(true);
    expect(r.records.find((x) => x.step === HAND_STEP)?.status ?? "HANDOFF").toBe("HANDOFF");
    expect(deps.exists(handFiles(o.runDir, "w3-02-fixture").request)).toBe(false);
  });

  it("the hand step asks with the request file and checks the file and the sandbox after the answer", async () => {
    const o = opts("hand");
    const deps = fakeDeps({});
    plantSitting(deps, o);
    // The hand answers and the editor made the table (both already on disk when polled).
    deps.writeBytes(
      handFiles(o.runDir, "w3-02-fixture").answer,
      Buffer.from(
        JSON.stringify({ done: true, file: FIXTURE_ST, itemClass: "CustomStringTableItem" }),
      ),
    );
    const only = selectSteps(buildSteps(), { only: HAND_STEP });
    if (typeof only === "string") throw new Error(only);
    // Absent fixture: FAIL (the file is checked, never assumed).
    const r1 = await runBattery(only, deps, o);
    expect(r1.records.find((x) => x.step === HAND_STEP)!.status).toBe("FAIL");
    expect(deps.exists(handFiles(o.runDir, "w3-02-fixture").request)).toBe(true);
    // Present fixture: the hand is not asked again; a .gproj change shows in the net-zero diff.
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    deps.writeBytes(
      join(o.sandboxDir, ...FIXTURE_ST.split("/")),
      Buffer.from("StringTable {\n}\n"),
    );
    deps.writeBytes(join(o.sandboxDir, GPROJ_REL), Buffer.from("gproj changed"));
    const r2 = await runBattery(only, deps, o2);
    const rec = r2.records.find((x) => x.step === HAND_STEP)!;
    expect(rec.status).toBe("PASS"); // the fixture is present: no hand step is asked again
    const nz = netZeroDiff(o.sittingDir, o.sandboxDir, deps);
    expect(nz?.changed).toContain(GPROJ_REL);
  });
});

describe("W3 battery: cold run 1 fix (the Reload prompt in w3-61 is a planned hand request)", () => {
  const SETTLE = "w3-61-settle";
  const win = (title: string, o: Partial<WindowInfo> = {}): WindowInfo => ({
    hwnd: 9,
    pid: PID,
    className: "Qt683QWindowIcon",
    title,
    owner: 15730788,
    enabled: true,
    rect: [0, 0, 10, 10],
    monitor: [0, 0, 100, 100],
    primary: true,
    ...o,
  });
  // Cold run 1's windowsAdded: the busy tool window beside the prompt.
  const busyTool = win("Arma Reforger Workbench", {
    hwnd: 10,
    className: "Qt683QWindowToolSaveBits",
    owner: 0,
    enabled: false,
  });

  /**
   * deps whose window list shows `up` while phase is 1; reading the hand's answer file is the
   * hand's press (phase 2: the window gone). The answer is written before the run.
   */
  function promptDeps(
    o: W3Options,
    up: WindowInfo[],
    answer: Raw | null,
  ): { deps: W3Deps & { files: Map<string, Buffer> }; state: { phase: number; seen: boolean } } {
    const state = { phase: 0, seen: false };
    const deps = fakeDeps({});
    plantSitting(deps, o);
    const f = handFiles(o.runDir, RELOAD_PROMPT.key);
    if (answer) deps.writeBytes(f.answer, Buffer.from(JSON.stringify(answer)));
    const read = deps.readBytes;
    deps.readBytes = (p) => {
      if (p === f.answer && state.phase === 1) state.phase = 2;
      return read(p);
    };
    deps.windows = async () => {
      if (state.phase !== 1) return [];
      state.seen = true;
      return up;
    };
    return { deps, state };
  }

  function settleDef(run: StepDef["run"]): StepDef {
    const real = buildSteps().find((s) => s.id === SETTLE)!;
    return { ...real, needsFixture: false, plan: () => [], run };
  }

  it("w3-61 plans Reload only; the fallback answer is Yes and resumes at w3-61", () => {
    expect(PLANNED_DIALOGS[SETTLE]).toBe(RELOAD_PROMPT);
    expect(Object.keys(PLANNED_DIALOGS)).toEqual([SETTLE]);
    const h = handAnswer(
      'a dialog-like window appeared (Qt683QWindowIcon "Reload", owner 15730788): owner hand',
      SETTLE,
    );
    expect(h.answer).toMatch(/^Yes on the "Reload" prompt/);
    expect(h.resumeFrom).toBe(SETTLE);
    const other = handAnswer(
      'a dialog-like window appeared (Qt683QWindowIcon "Open file", owner 1): owner hand',
      SETTLE,
    );
    expect(other.answer).toMatch(/^none planned/);
  });

  it("plannedDialogUp: Reload beside the busy tool window matches; another dialog or title does not", () => {
    expect(plannedDialogUp([win("Reload"), busyTool], PID, RELOAD_PROMPT)?.title).toBe("Reload");
    expect(plannedDialogUp([win("Reload"), win("Save", { hwnd: 11 })], PID, RELOAD_PROMPT)).toBe(
      null,
    );
    expect(plannedDialogUp([win("Reload?")], PID, RELOAD_PROMPT)).toBe(null);
    expect(plannedDialogUp([win("Reload", { owner: 0 })], PID, RELOAD_PROMPT)).toBe(null);
    expect(plannedDialogUp([win("Reload", { className: "#32770" })], PID, RELOAD_PROMPT)).toBe(
      null,
    );
    expect(plannedDialogUp([win("Reload", { pid: 1 })], PID, RELOAD_PROMPT)).toBe(null);
  });

  it("a prompt that cut the body: the hand is asked, the step runs once more, one PASS record, no handoff", async () => {
    const o = opts("cold1-reload-cut");
    const { deps, state } = promptDeps(o, [win("Reload"), busyTool], {
      done: true,
      pressed: "Yes",
      title: "Reload",
    });
    let runs = 0;
    const def = settleDef(async (ctx) => {
      runs++;
      await ctx.tool("wb_script_editor", { action: "state" });
      if (runs === 1) {
        state.phase = 1;
        while (!state.seen) await new Promise((r) => setTimeout(r, 1));
        for (let i = 0; i < 50; i++) await ctx.sleep(1); // cut here by the poller
      }
      return { status: "PASS", detail: "documents settled", evidence: {} };
    });
    const r = await runBattery([def], deps, o);
    expect(r.exit, String(r.message)).toBe(EXIT.done);
    const recs = r.records.filter((x) => x.step === SETTLE);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.status).toBe("PASS");
    const pd = (recs[0]!.evidence as Raw).plannedDialog as Raw;
    expect(pd.title).toBe("Reload");
    expect(pd.cleared).toBe(true);
    expect(pd.rerun).toBe(true);
    expect(runs).toBe(2);
    expect(deps.exists(handFiles(o.runDir, RELOAD_PROMPT.key).request)).toBe(true);
  });

  it("a prompt after the body ended: its outcome is recorded as it is, not run again", async () => {
    const o = opts("cold1-reload-end");
    const { deps, state } = promptDeps(o, [win("Reload"), busyTool], {
      done: true,
      pressed: "Yes",
    });
    let runs = 0;
    const def = settleDef(async () => {
      runs++;
      state.phase = 1;
      return { status: "PASS", detail: "documents settled", evidence: {} };
    });
    const r = await runBattery([def], deps, o);
    expect(r.exit, String(r.message)).toBe(EXIT.done);
    const rec = r.records.find((x) => x.step === SETTLE)!;
    expect(rec.status).toBe("PASS");
    expect(((rec.evidence as Raw).plannedDialog as Raw).bodyEnded).toBe(true);
    expect(runs).toBe(1);
  });

  it("another window in w3-61 still hands off; nothing is asked", async () => {
    const o = opts("cold1-reload-other");
    const { deps, state } = promptDeps(o, [win("Save changes")], { done: true, pressed: "Yes" });
    const def = settleDef(async () => {
      state.phase = 1;
      return { status: "PASS", detail: "x", evidence: {} };
    });
    const r = await runBattery([def], deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records.find((x) => x.step === SETTLE)!.status).toBe("HANDOFF");
    expect(deps.exists(handFiles(o.runDir, RELOAD_PROMPT.key).request)).toBe(false);
  });

  it("an answer that is not Yes leaves the HANDOFF with the planned fallback", async () => {
    const o = opts("cold1-reload-no");
    const { deps, state } = promptDeps(o, [win("Reload"), busyTool], {
      done: false,
      why: "the prompt was not on screen",
    });
    const def = settleDef(async () => {
      state.phase = 1;
      return { status: "PASS", detail: "x", evidence: {} };
    });
    const r = await runBattery([def], deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    const rec = r.records.find((x) => x.step === SETTLE)!;
    expect(rec.status).toBe("HANDOFF");
    expect(rec.detail).toMatch(/did not clear it/);
    expect(((rec.evidence as Raw).handAnswer as Raw).answer).toMatch(/^Yes on the "Reload"/);
  });

  it("w3-85 records P-W3-07 KILLED from w3-61's inline answer", async () => {
    const o = opts("cold1-reload-85");
    const deps = fakeDeps({});
    plantSitting(deps, o);
    const prev = join(o.sittingDir, "run-0");
    deps.writeBytes(
      join(prev, `${SETTLE}.json`),
      Buffer.from(
        JSON.stringify({
          step: SETTLE,
          block: "W3.5",
          title: "x",
          status: "PASS",
          detail: "documents settled",
          startedAt: "",
          endedAt: "",
          probes: [],
          evidence: { plannedDialog: { title: "Reload", cleared: true } },
        }),
      ),
    );
    const only = selectSteps(buildSteps(), { only: "w3-85-handoffs" });
    if (typeof only === "string") throw new Error(only);
    const r = await runBattery(only, deps, o);
    const rec = r.records.find((x) => x.step === "w3-85-handoffs")!;
    expect(rec.status).toBe("KILLED");
    const p = rec.probes.find((x) => x.id === "P-W3-07")!;
    expect(p.result).toBe("KILLED");
    expect((p.observed as Raw).step).toBe(SETTLE);
  });
});

describe("W3 battery: net-zero, plant and rollback", () => {
  it("a change inside _throwaway/W3/ is no change; outside it is", () => {
    const o = opts("nz");
    const deps = fakeDeps({});
    deps.writeBytes(join(o.sandboxDir, "Scripts", "a.c"), Buffer.from("a"));
    const snap = {
      kind: "w3-battery-snapshot",
      root: o.sandboxDir,
      taken_at: "x",
      files: { "Scripts/a.c": "0", [`${W3_ROOT}/st/x.st`]: "1" },
    };
    deps.writeBytes(join(o.sittingDir, BATTERY_SNAPSHOT_FILE), Buffer.from(JSON.stringify(snap)));
    deps.writeBytes(join(o.sandboxDir, ...`${W3_ROOT}/st/x.st`.split("/")), Buffer.from("new"));
    const nz = netZeroDiff(o.sittingDir, o.sandboxDir, deps)!;
    expect(nz.changed).toEqual(["Scripts/a.c"]);
  });

  function realIo(log: string[], pids: number[] = []): OfflineIo {
    const tree = (d: string): string[] => {
      const out: string[] = [];
      const walk = (x: string, rel: string): void => {
        for (const n of readdirSync(x)) {
          const p = join(x, n);
          const r = rel ? `${rel}/${n}` : n;
          if (statSync(p).isDirectory()) walk(p, r);
          else out.push(r);
        }
      };
      if (existsSync(d)) walk(d, "");
      return out;
    };
    return {
      workbenchPids: () => pids,
      exists: (p) => existsSync(p),
      listDir: (p) => readdirSync(p),
      listTree: tree,
      readBytes: (p) => readFileSync(p),
      writeBytes: (p, b) => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, b);
      },
      makeDir: (p) => {
        mkdirSync(p, { recursive: true });
      },
      removeTree: (p) => rmSync(p, { recursive: true }),
      log: (l) => log.push(l),
    };
  }

  it("plant writes only under _throwaway/W3/ and copies the .gproj; rollback removes it all and puts the .gproj back", () => {
    const bed = join(TMP, "pr", SANDBOX_NAME);
    const sitting = join(TMP, "pr", "sitting");
    mkdirSync(bed, { recursive: true });
    mkdirSync(sitting, { recursive: true });
    writeFileSync(join(bed, GPROJ_REL), "original");
    const log: string[] = [];
    expect(runPlant(bed, sitting, false, realIo(log))).toBe(EXIT.done);
    expect(existsSync(join(bed, "_throwaway"))).toBe(false);
    expect(runPlant(bed, sitting, true, realIo(log, [99]))).toBe(EXIT.refused);
    expect(runPlant(bed, sitting, true, realIo(log))).toBe(EXIT.done);
    for (const rel of SCRIPT_LIST) expect(existsSync(join(bed, ...rel.split("/")))).toBe(true);
    expect(readdirSync(bed).sort()).toEqual([GPROJ_REL, "_throwaway"].sort());
    expect(readFileSync(join(sitting, GPROJ_BACKUP), "utf-8")).toBe("original");
    expect(runPlant(bed, sitting, true, realIo(log))).toBe(EXIT.refused); // W3 exists
    // The hand's File > New registered the table and made files beside it.
    writeFileSync(join(bed, GPROJ_REL), "changed");
    writeFileSync(join(bed, "_throwaway", "W3", "st", "EMCP_W3_Fixture.st"), "StringTable {}");
    expect(runRollback(bed, sitting, true, realIo(log))).toBe(EXIT.done);
    expect(existsSync(join(bed, "_throwaway"))).toBe(false);
    expect(readFileSync(join(bed, GPROJ_REL), "utf-8")).toBe("original");
    expect(existsSync(join(sitting, "throwaway-w3-listing.json"))).toBe(true);
  });
});

describe("W3 battery: W1 cold run fix-up audit (busy windows are graced, 1.9.0.37)", () => {
  const STEP = "w3-10-script-state";
  const rec = (r: { records: Array<{ step: string; status: string; detail: string }> }) =>
    r.records.find((x) => x.step === STEP)!;
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
    win({ hwnd: 2, title: "World Editor - EMCP2_sandbox/_throwaway/W3/worlds/x.ent" }),
  ];
  /** W1 cold run's w1-60 change: both windows disabled, unowned, nothing added. */
  const BUSY = MAIN.map((w) => ({ ...w, enabled: false }));
  /** A real modal beside the transition: an owned #32770. */
  const MODAL = [
    ...BUSY,
    win({ hwnd: 4, className: "#32770", title: "Arma Reforger Workbench", owner: 2 }),
  ];

  /** Windows read MAIN, then `busy` reads of `during` from the step's start on. */
  function busyDeps(busy: number, during: WindowInfo[] = BUSY) {
    const deps = fakeDeps({});
    let left = -1;
    // The runner prepends the gate and fixture steps (withPrelude): the change starts with the
    // step's own log line; its first read (the watch's baseline) is still MAIN.
    let armed = false;
    deps.log = (line: string) => {
      if (line.startsWith(`step ${STEP}:`)) armed = true;
    };
    deps.windows = async () => {
      if (armed && left < 0) {
        left = busy;
        return MAIN;
      }
      if (left > 0) {
        left--;
        return during;
      }
      return MAIN;
    };
    return { deps, seen: () => left === 0 };
  }

  it(`${STEP} watches with the busy-window grace`, () => {
    expect(watchOptions(only(STEP)[0]!)).toMatchObject({
      busyGraceMs: BUSY_GRACE_MS,
    });
  });

  it("a transient busy change (the editor windows disabled for a while) is not a handoff", async () => {
    const o = opts("busytransient");
    const { deps, seen } = busyDeps(5);
    plantSitting(deps, o);
    const r = await runBattery(only(STEP), deps, o);
    expect(seen()).toBe(true);
    expect(rec(r).status, rec(r).detail).not.toBe("HANDOFF");
    expect(r.exit).not.toBe(EXIT.handoff);
  });

  it("the same windows past the grace are a handoff that says so", async () => {
    const o = opts("busystays");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER);
    plantSitting(deps, o);
    const r = await runBattery(only(STEP), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(rec(r).status).toBe("HANDOFF");
    expect(rec(r).detail).toMatch(/past the 60000 ms grace/);
  });

  it("a real modal beside the busy windows still hands off at once", async () => {
    const o = opts("busymodal");
    const { deps } = busyDeps(Number.MAX_SAFE_INTEGER, MODAL);
    plantSitting(deps, o);
    const r = await runBattery(only(STEP), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(rec(r).status).toBe("HANDOFF");
    expect(rec(r).detail).not.toMatch(/grace/);
  });
});
