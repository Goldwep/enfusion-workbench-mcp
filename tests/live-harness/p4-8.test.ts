import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPT as BLIND_SCRIPT } from "../../scripts/census/blind.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { TINY_WORLD, WALKERS } from "../../scripts/live/p4-1.js";
import { ENTITY_NAME, ROCK_PREFAB } from "../../scripts/live/p4-5.js";
import {
  CLOSE_COMMAND,
  DEFAULT_QUEUE,
  DRAWS_REL,
  LAUNCH_COMMAND,
  SESSION,
  WE_STATES,
  buildPlan,
  buildQueue,
  buildSequence,
  checkEntries,
  composeArgs,
  composeBatch,
  launchAction,
  launchCount,
  loadDraws,
  main,
  runEntries,
  type BlindEntry,
  type HandEntry,
} from "../../scripts/live/p4-8.js";
import type { NetEntry } from "../../scripts/live/p4-5.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { PROBE_MUT_SESSIONS, validateQueue } from "../../scripts/live/preflight.js";

const IN = {
  laneId: "p4-8",
  really: true,
  sandbox: "<addons>/EMCP2_sandbox",
  sittingDir: "<artifacts>/sessions/P4-8/run",
};

const draws = loadDraws();
const seq = buildSequence(draws);
const ids = seq.map((e) => e.id);
const blind = seq.filter((e): e is BlindEntry => e.kind === "blind");

describe("P4-8 sequence", () => {
  it("runs the world route, the World Editor states none, layer, entity, then each other module once", () => {
    expect(ids.slice(0, 7)).toEqual([
      "h-lease",
      "o-00-plant",
      "h-launch",
      "w-01-worlds-create",
      "w-02-world-editor",
      "w-03-world-open",
      "w-04-world-check",
    ]);
    expect(ids.at(-1)).toBe("h-close");
    expect(launchCount(seq)).toBe(1);
    const at = (id: string): number => ids.indexOf(id);
    expect(at("s-00-none-check")).toBeLessThan(at("h-layer"));
    expect(at("h-layer")).toBeLessThan(at("s-01-layer-check"));
    expect(at("s-01-layer-check")).toBeLessThan(at("e-00-entity-create"));
    const weIdx = (state: string): number[] =>
      blind.filter((b) => b.draw.module === "WorldEditor" && b.draw.state === state).map((b) => at(b.id));
    const [none, layer, entity] = WE_STATES.map(weIdx);
    expect(Math.max(...none)).toBeLessThan(at("h-layer"));
    expect(Math.min(...layer)).toBeGreaterThan(at("s-01-layer-check"));
    expect(Math.max(...layer)).toBeLessThan(at("e-00-entity-create"));
    expect(Math.min(...entity)).toBeGreaterThan(at("e-02-selection-check"));
    // every draw once; every module opened once, before its draws
    expect(blind.map((b) => b.id).sort()).toEqual(draws.map((d) => d.id).sort());
    const opens = ids.filter((x) => /^m-.+-open$/.test(x));
    expect(new Set(opens).size).toBe(opens.length);
    for (const b of blind.filter((x) => x.draw.module !== "WorldEditor"))
      expect(at(b.id)).toBeGreaterThan(at(`m-${b.draw.module}-open`));
    // context draws run last inside a module and state
    for (const state of WE_STATES) {
      const kinds = blind
        .filter((b) => b.draw.module === "WorldEditor" && b.draw.state === state)
        .map((b) => b.draw.kind);
      expect(kinds.lastIndexOf("menu")).toBeLessThan(kinds.indexOf("context-menu"));
    }
  });

  it("reuses P4-5's world route and entity create, never saves, closes on the owner's No", () => {
    const create = seq.find((e) => e.id === "e-00-entity-create") as NetEntry;
    expect(create.params).toMatchObject({ prefab: ROCK_PREFAB, name: ENTITY_NAME });
    expect((seq.find((e) => e.id === "w-03-world-open") as NetEntry).params.path).toBe(TINY_WORLD);
    for (const e of runEntries(seq))
      if (e.kind === "net") expect(String(e.params.action ?? "")).not.toMatch(/^save/i);
    const close = seq.at(-1) as HandEntry;
    expect(close.handoff).toBe(true);
    expect(close.text).toMatch(/"No"/);
    expect(CLOSE_COMMAND).toMatch(/--remove-probe-mut --remove-probe/);
    expect(CLOSE_COMMAND).toMatch(/p4-8\.ts rollback/);
  });

  it("gives each draw blind.ts walk in <sitting>/<module>-<stateTag>, its state and --only <id>", () => {
    const b = blind[0];
    const r = composeArgs(b.id, IN, seq, draws);
    if ("refusal" in r) throw new Error(r.refusal);
    expect(r.script).toBe(BLIND_SCRIPT);
    expect(r.argv.slice(0, 3)).toEqual(["walk", "--draws", DRAWS_REL]);
    expect(r.argv).toContain(join(IN.sittingDir, "WorldEditor-edit-none"));
    expect(r.argv).toEqual(expect.arrayContaining(["--state", b.draw.state, "--session", SESSION, "--only", b.id]));
    const open = composeArgs("m-ResourceManager-open", IN, seq, draws);
    if ("refusal" in open) throw new Error(open.refusal);
    expect(open.script).toBe(WALKERS.L10);
    expect(open.argv).toEqual(expect.arrayContaining(["--only", "p4-l10-08-ResourceManager"]));
    expect(composeArgs("h-layer", IN, seq, draws)).toHaveProperty("refusal");
    const FORBIDDEN = [/scriptauthorizeall/i, /script-authorize-all/i, /taskkill/i, /--force\b/];
    for (const e of runEntries(seq)) {
      const c = composeArgs(e.id, IN, seq, draws);
      if ("refusal" in c) continue;
      for (const f of FORBIDDEN) expect([c.script, ...c.argv].join(" "), e.id).not.toMatch(f);
    }
    expect(LAUNCH_COMMAND).toMatch(/--purpose "P4-8"/);
  });

  it("composes one batch per module and state: the menu and sub-menu draws, no --only, reused reads", async () => {
    const S = "mode=edit,selection=none";
    const want = draws
      .filter((d) => d.module === "WorldEditor" && d.state === S && (d.kind === "menu" || d.kind === "submenu"))
      .map((d) => d.id);
    const b = composeBatch({ module: "WorldEditor", state: S }, IN, draws);
    if ("refusal" in b) throw new Error(b.refusal);
    expect(b.script).toBe(BLIND_SCRIPT);
    expect(b.ids).toEqual(want);
    expect(b.argv.slice(0, 3)).toEqual(["walk", "--draws", DRAWS_REL]);
    expect(b.argv).toContain(join(IN.sittingDir, "WorldEditor-edit-none"));
    expect(b.argv).toEqual(
      expect.arrayContaining(["--really", "--state", S, "--session", SESSION, "--kinds", "menu,submenu", "--reuse-reads"]),
    );
    expect(b.argv).not.toContain("--only");
    const from = composeBatch({ module: "WorldEditor", state: S, from: want[3] }, IN, draws);
    if ("refusal" in from) throw new Error(from.refusal);
    expect(from.ids).toEqual(want.slice(3));
    expect(from.argv).toEqual(expect.arrayContaining(["--from", want[3]]));
    expect(composeBatch({ module: "WorldEditor", state: "none" }, IN, draws)).toHaveProperty("refusal");
    expect(composeBatch({ module: "WorldEditor", state: S, from: "b-999" }, IN, draws)).toHaveProperty("refusal");
    expect(composeBatch({ module: "WorldEditor", state: S }, { ...IN, sittingDir: null }, draws)).toHaveProperty(
      "refusal",
    );
    const logs: string[] = [];
    let spawned: string[] = [];
    const over = {
      log: (l: string) => logs.push(l),
      spawnChild: async (_s: string, a: string[]) => ((spawned = a), 0),
    };
    const args = ["--id", "p4-8", "--sandbox", IN.sandbox, "--sitting-dir", IN.sittingDir];
    expect(await main(["--batch", "WorldEditor", "--batch-state", S, ...args, "--print"], over)).toBe(0);
    expect(spawned).toEqual([]);
    expect(logs.at(-1)).toContain(`${want.length} draw(s) ${want[0]}..${want.at(-1)}`);
    expect(await main(["--batch", "ScriptEditor", ...args, "--really"], over)).toBe(0);
    expect(spawned).toEqual(expect.arrayContaining(["--module", "ScriptEditor", "--state", "none", "--really"]));
    expect(await main(["--batch", "WorldEditor", "--entry", "b-001", ...args], over)).toBe(2);
  });

  it("main refuses the flag, prints without spawning, delegates plant", async () => {
    const logs: string[] = [];
    let spawned = 0;
    let offline: string[] = [];
    const over = {
      log: (l: string) => logs.push(l),
      spawnChild: async () => (spawned++, 0),
      offline: async (a: string[]) => ((offline = a), 0),
    };
    expect(await main(["--script-authorize-all"], over)).toBe(2);
    const args = ["--id", "p4-8", "--sandbox", IN.sandbox, "--sitting-dir", IN.sittingDir];
    expect(await main(["--entry", blind[0].id, ...args, "--print"], over)).toBe(0);
    expect(spawned).toBe(0);
    expect(logs.at(-1)).toMatch(/blind\.ts walk/);
    expect(await main(["plant", ...args], over)).toBe(0);
    expect(offline[0]).toBe("plant");
  });
});

describe("P4-8 plan and queue", () => {
  it("passes the dry-run checks per entry and combined; no key, no invoke, no execute-action", () => {
    expect(checkEntries(seq, draws).ok).toBe(true);
    const plan = buildPlan(seq, draws);
    expect(plan.filter((a) => a.kind === "launch")).toHaveLength(1);
    expect(checkPlan(plan, loadPolicy(), { script: "scripts/live/p4-8.ts" }).violations).toEqual([]);
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/"kind":"key"/);
    expect(text).not.toMatch(/"kind":"execute-action"/);
    expect(text).not.toMatch(/"Invoke"/);
    expect(launchAction().args).toContain("-scriptAuthorizeAll");
  });

  it("emits a queue validateQueue accepts, session P4-8 with the mutating pack", () => {
    const q = buildQueue(seq, draws);
    expect(q.session).toBe("P4-8");
    expect(PROBE_MUT_SESSIONS).toContain("P4-8");
    const probes = validateQueue(q, false);
    expect(probes.filter((p) => p.risk_class === "mutating").map((p) => p.id).slice(0, 5)).toEqual([
      "p4-o-00-plant",
      "p4-w-01-worlds-create",
      "p4-l10-07-WorldEditor",
      "p4-w-03-world-open",
      "p4-e-00-entity-create",
    ]);
    const pids = probes.map((p) => p.id);
    expect(new Set(pids).size).toBe(pids.length);
    for (const d of draws) expect(pids).toContain(d.id);
  });

  it("equals the committed queue file", () => {
    const file = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildQueue(seq, draws))));
  });
});
