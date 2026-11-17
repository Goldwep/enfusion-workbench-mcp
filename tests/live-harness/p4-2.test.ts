import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import {
  CLOSE_COMMAND,
  DEFAULT_QUEUE,
  LAUNCH_COMMAND,
  MODULES,
  PROPOSAL_FILE,
  SCRIPT_PATH,
  SESSION,
  buildPlan,
  buildProposal,
  buildQueue,
  buildSequence,
  checkEntries,
  composeArgs,
  entrySteps,
  launchAction,
  launchCount,
  main,
  menuTitles,
  runEntries,
  type WalkerEntry,
} from "../../scripts/live/p4-2.js";
import { SAA, SCRIPT_PATH as P41_SCRIPT, WALKERS } from "../../scripts/live/p4-1.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { PROBE_MUT_SESSIONS, validateQueue } from "../../scripts/live/preflight.js";

const IN = {
  laneId: "p4-2",
  really: true,
  sandbox: "<addons>/EMCP2_sandbox",
  sittingDir: "<artifacts>/sessions/P4-2/run",
};
const ORDER = [
  "LocalizationEditor",
  "BehaviorEditor",
  "AudioEditor",
  "AnimEditor",
  "ProcAnimEditor",
  "ScriptEditor",
  "ResourceManager",
  "NavmeshGeneratorMain",
];

describe("P4-2 sequence", () => {
  const seq = buildSequence();

  it("runs its entries in the design's order, World Editor and Particle Editor left out", () => {
    const perModule = MODULES.flatMap(({ nn }) =>
      ["l10", "l01", "l03", "l07"].map((w) => `m${nn}-${w}`),
    );
    expect(seq.map((e) => e.id)).toEqual([
      "h-lease",
      "o-00-plant",
      "h-launch",
      ...perModule,
      "t-propose",
      "h-close",
    ]);
    expect(MODULES.map((m) => m.module)).toEqual(ORDER);
    expect(launchCount(seq)).toBe(1);
  });

  it("opens each module by its own L10 step before walking it, in its own run folder", () => {
    for (const { nn, module } of MODULES) {
      const l10 = seq.find((e) => e.id === `m${nn}-l10`) as WalkerEntry;
      expect(entrySteps(l10).map((s) => s.id)).toEqual([`p4-l10-${nn}-${module}`]);
      for (const w of ["l01", "l03", "l07"]) {
        const e = seq.find((x) => x.id === `m${nn}-${w}`) as WalkerEntry;
        expect(e.module).toBe(module);
        expect(e.runSub).toBe(module);
        expect(entrySteps(e).length).toBeGreaterThan(0);
      }
    }
  });

  it("has no owner hand, no L02, no L06, no netcall", () => {
    const walkers = runEntries(seq).flatMap((e) => (e.kind === "walker" ? [e.walker] : []));
    expect(new Set(walkers)).toEqual(new Set(["L10", "L01", "L03", "L07"]));
    expect(JSON.stringify(seq)).not.toMatch(/ownerHand/);
  });
});

describe("P4-2 composed commands", () => {
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
    expect(LAUNCH_COMMAND).toMatch(/--queue docs\/v2\/sessions\/queues\/P4-2-queue\.json/);
    expect(launchAction().args).toContain(SAA);
  });

  it("composes the walker CLIs with state none and session P4-2", () => {
    const l10 = composeArgs("m03-l10", IN);
    if ("refusal" in l10) throw new Error(l10.refusal);
    expect(l10.script).toBe(WALKERS.L10);
    expect(l10.argv).toEqual([
      "--really",
      "--id",
      "p4-2",
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
    const l01 = composeArgs("m06-l01", IN);
    if ("refusal" in l01) throw new Error(l01.refusal);
    expect(l01.script).toBe(WALKERS.L01);
    expect(l01.argv.slice(-8)).toEqual([
      "--module",
      "ScriptEditor",
      "--state",
      "none",
      "--session",
      "P4-2",
      "--from",
      "p4-l01-snapshot-ScriptEditor-none",
    ]);
    const plant = composeArgs("o-00-plant", IN);
    if ("refusal" in plant) throw new Error(plant.refusal);
    expect(plant.script).toBe(P41_SCRIPT);
    expect(plant.argv[0]).toBe("plant");
    const prop = composeArgs("t-propose", { ...IN, laneId: "", sandbox: null });
    if ("refusal" in prop) throw new Error(prop.refusal);
    expect(prop).toEqual({
      script: SCRIPT_PATH,
      argv: ["propose", "--sitting-dir", IN.sittingDir, "--really"],
    });
  });

  it("refuses hand entries, unknown steps and a missing lane", () => {
    expect(composeArgs("h-launch", IN)).toHaveProperty("refusal");
    expect(composeArgs("m01-l01", { ...IN, onlyStep: "p4-l03-chrome" })).toHaveProperty("refusal");
    expect(composeArgs("m01-l01", { ...IN, laneId: "" })).toHaveProperty("refusal");
  });

  it("main refuses the flag and prints without spawning", async () => {
    const logs: string[] = [];
    let spawned = 0;
    const over = { log: (l: string) => logs.push(l), spawnChild: async () => (spawned++, 0) };
    expect(await main(["--script-authorize-all"], over)).toBe(2);
    const argv = ["--entry", "m01-l03", "--id", "p4-2", "--sandbox", IN.sandbox];
    expect(await main([...argv, "--sitting-dir", IN.sittingDir, "--print"], over)).toBe(0);
    expect(spawned).toBe(0);
    expect(logs.at(-1)).toMatch(/L03-chrome\.ts/);
  });
});

describe("P4-2 plan and queue", () => {
  it("passes the dry-run checks per entry and combined under p4-2's script", () => {
    const c = checkEntries();
    expect(c.lines.filter((l) => !/: PASS/.test(l))).toEqual([]);
    expect(c.ok).toBe(true);
    const r = checkPlan(buildPlan(), loadPolicy(), { script: SCRIPT_PATH });
    expect(r.violations).toEqual([]);
    expect(buildPlan().filter((a) => a.kind === "launch")).toHaveLength(1);
  });

  it("emits a valid queue for session P4-2 without the mutating pack", () => {
    const q = buildQueue();
    expect(q.session).toBe("P4-2");
    expect(q.launch_packs).toEqual(["mod-dev/probe"]);
    expect(PROBE_MUT_SESSIONS).not.toContain("P4-2");
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

describe("P4-2 titles proposal", () => {
  const line = (title: string, parent: object | null, path = [title]): string =>
    JSON.stringify({
      kind: "menu",
      label_raw: title,
      key: { path },
      locator: { menuPath: path },
      parent_key: parent,
    });
  const WIN = { dim: "ui", kind: "window", key: { object_name: "w" }, module: "AudioEditor" };
  const BAR = { dim: "ui", kind: "region", key: { path: ["@QMenuBar.1"] }, module: "AudioEditor" };

  it("reads the menu-bar titles under the window row (and a pre-FIX-F QMenuBar parent)", () => {
    const text = [
      line("File", WIN),
      line("Edit", BAR),
      line("New", WIN, ["File", "New"]),
      line("Stray", { kind: "panel", key: { path: ["x"] } }),
      JSON.stringify({ kind: "window", label_raw: "Audio Editor", parent_key: null }),
      line("File", WIN),
      "not json",
    ].join("\n");
    expect(menuTitles(text)).toEqual(["File", "Edit"]);
  });

  it("writes a proposal naming missing modules, and only with --really", async () => {
    const files: Record<string, string> = {};
    const read = (p: string): string | null =>
      p.replace(/\\/g, "/").endsWith("AudioEditor/L01-AudioEditor-none.obs.jsonl")
        ? line("File", WIN)
        : null;
    const prop = buildProposal("/sit", read);
    expect(prop.titles_by_module).toEqual({ AudioEditor: ["File"] });
    expect(prop.missing).toHaveLength(7);
    const over = {
      log: () => undefined,
      readText: read,
      writeText: (p: string, t: string) => void (files[p] = t),
    };
    expect(await main(["propose", "--sitting-dir", "/sit"], over)).toBe(0);
    expect(Object.keys(files)).toHaveLength(0);
    expect(await main(["propose", "--sitting-dir", "/sit", "--really"], over)).toBe(0);
    expect(Object.keys(files)[0]).toMatch(new RegExp(`${PROPOSAL_FILE}$`));
  });
});
