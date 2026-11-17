import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_TITLES } from "../../scripts/census/live/common.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import {
  CLOSE_COMMAND,
  DEFAULT_QUEUE,
  L05_TARGETS,
  L10_RM_STEP,
  LAUNCH_COMMAND,
  SCRIPT_PATH,
  SESSION,
  SUB_EDITORS,
  blockedReason,
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
  type NetEntry,
  type WalkerEntry,
} from "../../scripts/live/p4-9.js";
import { NETCALL, SAA, SCRIPT_PATH as P41_SCRIPT, WALKERS } from "../../scripts/live/p4-1.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { PROBE_MUT_SESSIONS, validateQueue } from "../../scripts/live/preflight.js";
import { MODULES } from "../../src/census/vocab.js";

const IN = {
  laneId: "p4-9",
  really: true,
  sandbox: "<addons>/EMCP2_sandbox",
  sittingDir: "<artifacts>/sessions/P4-9/run",
};
const SUBS = [
  "ResourceManager.Config",
  "ResourceManager.Layout",
  "ResourceManager.Imageset",
  "ResourceManager.Model",
  "ResourceManager.Texture",
  "ResourceManager.Material",
  "ResourceManager.Font",
  "ResourceManager.Styles",
];

describe("P4-9 sequence", () => {
  const seq = buildSequence();

  it("opens each of the eight sub-editors, then L10, L01, L02, L03, L07, then the owner's close", () => {
    const per = SUB_EDITORS.flatMap(({ nn }) => [
      `s${nn}-open`,
      `h${nn}-tab`,
      `s${nn}-l10`,
      `s${nn}-l01`,
      `s${nn}-l02`,
      `s${nn}-l03`,
      `s${nn}-l07`,
      `h${nn}-close`,
    ]);
    const stretch = SUB_EDITORS.map(({ ext }) => `rb-${ext}-l05`);
    expect(seq.map((e) => e.id)).toEqual([
      "h-lease",
      "o-00-plant",
      "h-launch",
      ...per,
      "h-l05-gate",
      ...stretch,
      "h-close",
    ]);
    expect(launchCount(seq)).toBe(1);
  });

  it("covers the vocabulary's eight sub-editors, one vanilla resource of each type", () => {
    expect(SUB_EDITORS.map((s) => s.module)).toEqual(SUBS);
    expect(MODULES.filter((m) => m.startsWith("ResourceManager."))).toEqual(SUBS);
    expect(SUB_EDITORS.map((s) => s.resource.split(".").pop())).toEqual(
      SUB_EDITORS.map((s) => s.ext),
    );
    for (const s of SUB_EDITORS) {
      const open = seq.find((e) => e.id === `s${s.nn}-open`) as NetEntry;
      expect(open.kind).toBe("net");
      expect(open.apiFunc).toBe("OpenResource");
      expect(open.params).toEqual({ ResourceName: s.resource });
      expect(open.risk).toBe("mutating");
    }
  });

  it("gives every walk the sub-editor as module and its own run folder; L10 runs the RM step only", () => {
    for (const s of SUB_EDITORS) {
      const l10 = seq.find((e) => e.id === `s${s.nn}-l10`) as WalkerEntry;
      expect(entrySteps(l10).map((x) => x.id)).toEqual([L10_RM_STEP]);
      expect(l10.runSub).toBe(s.module);
      for (const w of ["l01", "l03", "l07"]) {
        const e = seq.find((x) => x.id === `s${s.nn}-${w}`) as WalkerEntry;
        expect(e.module).toBe(s.module);
        expect(e.runSub).toBe(s.module);
        expect(e.state).toBe("none");
        expect(entrySteps(e).length, e.id).toBeGreaterThan(0);
      }
    }
  });

  it("titles the sub-editors [unverified], read in the Resource Manager's window", () => {
    for (const m of SUBS) {
      expect(MODULE_TITLES[m]?.unverified, m).toBe(true);
      expect(new RegExp(MODULE_TITLES[m].pattern).test("Enfusion Workbench - EMCP2 sandbox")).toBe(
        true,
      );
    }
  });

  it("blocks L02 until the policy has its titles, L05 until it has the targets", () => {
    const policy = loadPolicy();
    const by = (policy.live_lane?.uia_menu as { titles_by_module?: Record<string, unknown> })
      .titles_by_module;
    for (const s of SUB_EDITORS) {
      const l02 = runEntries().find((e) => e.id === `s${s.nn}-l02`)!;
      expect(blockedReason(l02) === null).toBe(Boolean(by?.[s.module]));
    }
    expect(L05_TARGETS).toHaveLength(8);
    expect(L05_TARGETS[0]).toEqual({
      module: "ResourceManager",
      path: ["Resource Browser", "inputCommon.conf"],
    });
    const rb = runEntries().filter((e) => e.id.startsWith("rb-")) as WalkerEntry[];
    expect(rb.map((e) => e.state)).toEqual(SUB_EDITORS.map((s) => `resource_type=${s.ext}`));
    expect(new Set(rb.map((e) => e.runSub)).size).toBe(8);
  });
});

describe("P4-9 composed commands", () => {
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
      if ("refusal" in r) {
        expect(r.refusal, e.id).toMatch(/is blocked/);
        continue;
      }
      for (const f of FORBIDDEN) expect([r.script, ...r.argv].join(" "), e.id).not.toMatch(f);
    }
    expect(CLOSE_COMMAND).not.toMatch(/probe-mut/);
    expect(CLOSE_COMMAND).toMatch(/--remove-probe /);
    expect(CLOSE_COMMAND).toMatch(/p4-9\.ts rollback/);
    expect(LAUNCH_COMMAND).not.toMatch(/probe-mut/);
    expect(LAUNCH_COMMAND).toMatch(/--queue docs\/v2\/sessions\/queues\/P4-9-queue\.json/);
    expect(launchAction().args).toContain(SAA);
  });

  it("composes OpenResource through netcall and the walkers with state none and session P4-9", () => {
    const open = composeArgs("s03-open", IN);
    if ("refusal" in open) throw new Error(open.refusal);
    expect(open.script).toBe(NETCALL);
    expect(open.argv.slice(0, 3)).toEqual([
      "OpenResource",
      "--params",
      JSON.stringify({ ResourceName: "UI/Imagesets/ScrollbarRectangles.imageset" }),
    ]);
    expect(open.argv.slice(-3)).toEqual(["--really", "--id", "p4-9"]);
    const l10 = composeArgs("s02-l10", IN);
    if ("refusal" in l10) throw new Error(l10.refusal);
    expect(l10.script).toBe(WALKERS.L10);
    expect(l10.argv).toEqual([
      "--really",
      "--id",
      "p4-9",
      "--sandbox",
      IN.sandbox,
      "--run-dir",
      join(IN.sittingDir, "ResourceManager.Layout"),
      "--module",
      "Shared",
      "--state",
      "none",
      "--session",
      SESSION,
      "--only",
      L10_RM_STEP,
    ]);
    const l01 = composeArgs("s04-l01", IN);
    if ("refusal" in l01) throw new Error(l01.refusal);
    expect(l01.script).toBe(WALKERS.L01);
    expect(l01.argv.slice(-8)).toEqual([
      "--module",
      "ResourceManager.Model",
      "--state",
      "none",
      "--session",
      "P4-9",
      "--from",
      "p4-l01-snapshot-ResourceManager.Model-none",
    ]);
    const plant = composeArgs("o-00-plant", IN);
    if ("refusal" in plant) throw new Error(plant.refusal);
    expect(plant.script).toBe(P41_SCRIPT);
    expect(plant.argv[0]).toBe("plant");
  });

  it("refuses hand entries, unknown steps and a missing lane", () => {
    expect(composeArgs("h-launch", IN)).toHaveProperty("refusal");
    expect(composeArgs("h01-close", IN)).toHaveProperty("refusal");
    expect(composeArgs("s01-l01", { ...IN, onlyStep: "p4-l03-chrome" })).toHaveProperty("refusal");
    expect(composeArgs("s01-l01", { ...IN, laneId: "" })).toHaveProperty("refusal");
  });

  it("main refuses the flag, delegates plant/rollback and prints without spawning", async () => {
    const logs: string[] = [];
    let spawned = 0;
    let offline: string[] | null = null;
    const over = {
      log: (l: string) => logs.push(l),
      spawnChild: async () => (spawned++, 0),
      offline: async (a: string[]) => ((offline = a), 0),
    };
    expect(await main(["--script-authorize-all"], over)).toBe(2);
    const argv = ["--entry", "s01-l03", "--id", "p4-9", "--sandbox", IN.sandbox];
    expect(await main([...argv, "--sitting-dir", IN.sittingDir, "--print"], over)).toBe(0);
    expect(spawned).toBe(0);
    expect(logs.at(-1)).toMatch(/L03-chrome\.ts/);
    expect(await main(["rollback", "--sandbox", IN.sandbox], over)).toBe(0);
    expect(offline).toEqual(["rollback", "--sandbox", IN.sandbox]);
  });
});

describe("P4-9 plan and queue", () => {
  it("passes the dry-run checks per entry and combined under p4-9's script", () => {
    const c = checkEntries();
    expect(c.lines.filter((l) => !/: PASS/.test(l))).toEqual([]);
    expect(c.ok).toBe(true);
    const r = checkPlan(buildPlan(), loadPolicy(), { script: SCRIPT_PATH });
    expect(r.violations).toEqual([]);
    expect(buildPlan().filter((a) => a.kind === "launch")).toHaveLength(1);
  });

  it("emits a valid queue for session P4-9 without the mutating pack", () => {
    const q = buildQueue();
    expect(q.session).toBe("P4-9");
    expect(q.launch_packs).toEqual(["mod-dev/probe"]);
    expect(PROBE_MUT_SESSIONS).not.toContain("P4-9");
    const probes = validateQueue(q, false);
    const ids = probes.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => /-open$/.test(id))).toEqual(
      SUB_EDITORS.map(({ nn }) => `p4-s${nn}-open`),
    );
  });

  it("equals the committed queue file", () => {
    const file = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });
});
