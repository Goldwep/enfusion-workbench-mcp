import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import {
  CLOSE_COMMAND,
  DEFAULT_QUEUE,
  LAUNCH_COMMAND,
  MODULES,
  SCRIPT_PATH,
  SESSION,
  buildPlan,
  buildQueue,
  buildSequence,
  checkEntries,
  composeArgs,
  entrySteps,
  launchAction,
  launchCount,
  main,
  runEntries,
  type WalkerEntry,
} from "../../scripts/live/p4-3.js";
import { SAA, SCRIPT_PATH as P41_SCRIPT, WALKERS } from "../../scripts/live/p4-1.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { PROBE_MUT_SESSIONS, validateQueue } from "../../scripts/live/preflight.js";

const IN = {
  laneId: "p4-3",
  really: true,
  sandbox: "<addons>/EMCP2_sandbox",
  sittingDir: "<artifacts>/sessions/P4-3/run",
};
const ORDER = [
  "LocalizationEditor",
  "BehaviorEditor",
  "AudioEditor",
  "AnimEditor",
  "ProcAnimEditor",
  "ScriptEditor",
  "NavmeshGeneratorMain",
  "WorldEditor",
  "ResourceManager",
];

describe("P4-3 sequence", () => {
  const seq = buildSequence();

  it("runs its entries in the brief's order: editors L10/L02/L07, Navmesh L10/L01/L03/L07, WE and RM L10/L07", () => {
    const perModule = MODULES.flatMap(({ nn, ws }) =>
      ["L10", ...ws].map((w) => `m${nn}-${w.toLowerCase()}`),
    );
    expect(seq.map((e) => e.id)).toEqual([
      "h-lease",
      "o-00-plant",
      "h-launch",
      ...perModule,
      "h-close",
    ]);
    expect(MODULES.map((m) => m.module)).toEqual(ORDER);
    expect(perModule.filter((id) => /m(01|02|03|04|05|06)-/.test(id))).toHaveLength(18);
    expect(perModule.filter((id) => /m09-/.test(id))).toEqual([
      "m09-l10",
      "m09-l01",
      "m09-l03",
      "m09-l07",
    ]);
    expect(perModule.filter((id) => /m0[78]-/.test(id))).toEqual([
      "m07-l10",
      "m07-l07",
      "m08-l10",
      "m08-l07",
    ]);
    expect(launchCount(seq)).toBe(1);
  });

  it("opens each module by its own L10 step before walking it, in its own run folder", () => {
    for (const { nn, module, ws } of MODULES) {
      const l10 = seq.find((e) => e.id === `m${nn}-l10`) as WalkerEntry;
      expect(entrySteps(l10).map((s) => s.id)).toEqual([`p4-l10-${nn}-${module}`]);
      for (const w of ws) {
        const e = seq.find((x) => x.id === `m${nn}-${w.toLowerCase()}`) as WalkerEntry;
        expect(e.module).toBe(module);
        expect(e.runSub).toBe(module);
        expect(entrySteps(e).length).toBeGreaterThan(0);
      }
    }
  });

  it("has no owner hand, no L06, no netcall", () => {
    const walkers = runEntries(seq).flatMap((e) => (e.kind === "walker" ? [e.walker] : []));
    expect(new Set(walkers)).toEqual(new Set(["L10", "L01", "L02", "L03", "L07"]));
    expect(JSON.stringify(seq)).not.toMatch(/ownerHand/);
  });
});

describe("P4-3 composed commands", () => {
  const FORBIDDEN = [
    /scriptauthorizeall/i,
    /script-authorize-all/i,
    /--allow-owned/,
    /--owner-done/,
    /taskkill/i,
    /--force\b/,
    /probe-mut/,
  ];

  it("hold no forbidden flag; the launch carries the ruled switch and the read-only pack only", () => {
    for (const e of runEntries()) {
      const r = composeArgs(e.id, IN);
      if ("refusal" in r) throw new Error(`${e.id}: ${r.refusal}`);
      for (const f of FORBIDDEN) expect([r.script, ...r.argv].join(" "), e.id).not.toMatch(f);
    }
    expect(CLOSE_COMMAND).not.toMatch(/probe-mut/);
    expect(CLOSE_COMMAND).toMatch(/--remove-probe /);
    expect(CLOSE_COMMAND).toMatch(/p4-1\.ts rollback/);
    expect(LAUNCH_COMMAND).not.toMatch(/probe-mut/);
    expect(LAUNCH_COMMAND).toMatch(/--queue docs\/v2\/sessions\/queues\/P4-3-queue\.json/);
    expect(launchAction().args).toContain(SAA);
  });

  it("composes the walker CLIs with state none and session P4-3", () => {
    const l10 = composeArgs("m03-l10", IN);
    if ("refusal" in l10) throw new Error(l10.refusal);
    expect(l10.script).toBe(WALKERS.L10);
    expect(l10.argv).toEqual([
      "--really",
      "--id",
      "p4-3",
      "--sandbox",
      IN.sandbox,
      "--run-dir",
      join(IN.sittingDir, "AudioEditor"),
      "--module",
      "Shared",
      "--state",
      "none",
      "--session",
      SESSION,
      "--only",
      "p4-l10-03-AudioEditor",
    ]);
    const l01 = composeArgs("m09-l01", IN);
    if ("refusal" in l01) throw new Error(l01.refusal);
    expect(l01.script).toBe(WALKERS.L01);
    expect(l01.argv.slice(-8)).toEqual([
      "--module",
      "NavmeshGeneratorMain",
      "--state",
      "none",
      "--session",
      "P4-3",
      "--from",
      "p4-l01-snapshot-NavmeshGeneratorMain-none",
    ]);
    const plant = composeArgs("o-00-plant", IN);
    if ("refusal" in plant) throw new Error(plant.refusal);
    expect(plant.script).toBe(P41_SCRIPT);
    expect(plant.argv[0]).toBe("plant");
    const l02 = composeArgs("m06-l02", IN);
    if ("refusal" in l02) throw new Error(l02.refusal);
    expect(l02.script).toBe(WALKERS.L02);
    expect(l02.argv).toContain("ScriptEditor");
    expect(l02.argv.slice(l02.argv.indexOf("--state"), l02.argv.indexOf("--state") + 2)).toEqual([
      "--state",
      "none",
    ]);
  });

  it("refuses hand entries, unknown steps and a missing lane", () => {
    expect(composeArgs("h-launch", IN)).toHaveProperty("refusal");
    expect(composeArgs("m09-l01", { ...IN, onlyStep: "p4-l03-chrome" })).toHaveProperty("refusal");
    expect(composeArgs("m09-l01", { ...IN, laneId: "" })).toHaveProperty("refusal");
  });

  it("main refuses the flag and prints without spawning", async () => {
    const logs: string[] = [];
    let spawned = 0;
    const over = { log: (l: string) => logs.push(l), spawnChild: async () => (spawned++, 0) };
    expect(await main(["--script-authorize-all"], over)).toBe(2);
    const argv = ["--entry", "m09-l03", "--id", "p4-3", "--sandbox", IN.sandbox];
    expect(await main([...argv, "--sitting-dir", IN.sittingDir, "--print"], over)).toBe(0);
    expect(spawned).toBe(0);
    expect(logs.at(-1)).toMatch(/L03-chrome\.ts/);
  });
});

describe("P4-3 plan and queue", () => {
  it("passes the dry-run checks per entry and combined under p4-3's script", () => {
    const c = checkEntries();
    expect(c.lines.filter((l) => !/: PASS/.test(l))).toEqual([]);
    expect(c.ok).toBe(true);
    const r = checkPlan(buildPlan(), loadPolicy(), { script: SCRIPT_PATH });
    expect(r.violations).toEqual([]);
    expect(buildPlan().filter((a) => a.kind === "launch")).toHaveLength(1);
  });

  it("emits a valid queue for session P4-3 without the mutating pack", () => {
    const q = buildQueue();
    expect(q.session).toBe("P4-3");
    expect(q.launch_packs).toEqual(["mod-dev/probe"]);
    expect(PROBE_MUT_SESSIONS).not.toContain("P4-3");
    const probes = validateQueue(q, false);
    expect(probes.filter((p) => p.risk_class === "mutating").map((p) => p.id)).toEqual([
      "p4-o-00-plant",
      ...MODULES.map(({ nn, module }) => `p4-l10-${nn}-${module}`),
    ]);
    const ids = probes.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("equals the committed queue file", () => {
    const file = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });
});
