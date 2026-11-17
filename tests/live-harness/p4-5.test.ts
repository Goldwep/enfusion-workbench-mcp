import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { TINY_WORLD, WALKERS } from "../../scripts/live/p4-1.js";
import {
  CLOSE_COMMAND,
  DEFAULT_QUEUE,
  ENTITY_NAME,
  LAUNCH_COMMAND,
  ROCK_PREFAB,
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
  type HandEntry,
  type NetEntry,
  type WalkerEntry,
} from "../../scripts/live/p4-5.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { PROBE_MUT_SESSIONS, validateQueue } from "../../scripts/live/preflight.js";

const IN = {
  laneId: "p4-5",
  really: true,
  sandbox: "<addons>/EMCP2_sandbox",
  sittingDir: "<artifacts>/sessions/P4-5/run",
};

describe("P4-5 sequence", () => {
  const seq = buildSequence();
  const ids = seq.map((e) => e.id);

  it("runs its entries in order", () => {
    expect(ids).toEqual([
      "h-lease",
      "o-00-plant",
      "h-launch",
      "w-01-worlds-create",
      "w-02-world-editor",
      "w-03-world-open",
      "w-04-world-check",
      "e-00-entity-create",
      "e-01-entity-select",
      "e-02-selection-check",
      "e-03-l01",
      "e-04-l03",
      "e-05-l02",
      "e-06-l06",
      "h-l05-targets",
      "e-07-l05-hand",
      "p-01-play",
      "p-02-play-check",
      "p-03-l15",
      "p-04-l01",
      "p-05-stop",
      "p-06-edit-check",
      "h-close",
    ]);
    expect(launchCount(seq)).toBe(1);
  });

  it("has no owner hand for the selection: create and select are NET calls in the tiny world", () => {
    expect(ids).not.toContain("h-select");
    const create = seq.find((e) => e.id === "e-00-entity-create") as NetEntry;
    expect(create.apiFunc).toBe("EMCP_WB_CreateEntity");
    expect(create.params).toEqual({
      prefab: ROCK_PREFAB,
      position: "0 0 0",
      name: ENTITY_NAME,
      layerID: 0,
    });
    expect(ROCK_PREFAB).toMatch(/^\{[0-9A-F]{16}\}Prefabs\//);
    const sel = seq.find((e) => e.id === "e-01-entity-select") as NetEntry;
    expect(sel.params).toEqual({ action: "select", name: ENTITY_NAME });
    const chk = seq.find((e) => e.id === "e-02-selection-check") as NetEntry;
    expect(chk.risk).toBe("read-only");
    expect(chk.params).toEqual({ action: "getSelected" });
    const open = seq.find((e) => e.id === "w-03-world-open") as NetEntry;
    expect(open.params.path).toBe(TINY_WORLD);
    for (const e of seq.filter((x) => x.kind === "walker" && x.state === "edit-entity"))
      expect(ids.indexOf(e.id)).toBeGreaterThan(ids.indexOf("e-02-selection-check"));
  });

  it("never saves: no save or saveAs action anywhere, Don't Save at the close HANDOFF", () => {
    for (const e of runEntries(seq))
      if (e.kind === "net") expect(String(e.params.action ?? "")).not.toMatch(/^save/i);
    const close = seq.at(-1) as HandEntry;
    expect(close.id).toBe("h-close");
    expect(close.handoff).toBe(true);
    expect(close.text).toMatch(/Don't Save/);
    expect(CLOSE_COMMAND).toMatch(/--remove-probe-mut --remove-probe/);
    expect(CLOSE_COMMAND).toMatch(/p4-5\.ts rollback/);
  });

  it("plays between a play check and a stop, walks play in mode=play", () => {
    const play = seq.find((e) => e.id === "p-01-play") as NetEntry;
    expect(play.params).toEqual({ action: "play", debugMode: false, fullScreen: false });
    const l15 = seq.find((e) => e.id === "p-03-l15") as WalkerEntry;
    expect(entrySteps(l15).every((s) => s.id.startsWith("p4-l15-play-"))).toBe(true);
    expect(ids.indexOf("p-02-play-check")).toBeLessThan(ids.indexOf("p-03-l15"));
    expect(ids.indexOf("p-04-l01")).toBeLessThan(ids.indexOf("p-05-stop"));
    const a = composeArgs("p-04-l01", IN);
    if ("refusal" in a) throw new Error(a.refusal);
    expect(a.argv).toContain("mode=play,selection=none");
  });
});

describe("P4-5 L05 is a hand block (DEC-091 ruling 2)", () => {
  it("plans no ShowContextMenu step: e-07 is passive hand steps only", () => {
    const seq = buildSequence();
    const l05 = runEntries(seq).filter(
      (x) => x.kind === "walker" && x.walker === "L05",
    ) as WalkerEntry[];
    expect(l05.map((e) => e.id)).toEqual(["e-07-l05-hand"]);
    const e = l05[0];
    expect(e.flags).toContain("--passive");
    for (const st of entrySteps(e)) {
      expect(st.id).toMatch(/^p4-l05-hand-/);
      expect(
        st.plan({ module: e.module, state: {}, allowOwned: false }).map((p) => p.kind),
      ).not.toContain("uia-context");
    }
    const steps = (buildQueue().probes as Array<{ step?: string }>).map((p) => p.step ?? "");
    expect(steps.some((x) => x === "p4-l05-probe" || /^p4-l05-td/.test(x))).toBe(false);
  });
});

describe("P4-5 composed commands", () => {
  const FORBIDDEN = [/scriptauthorizeall/i, /script-authorize-all/i, /taskkill/i, /--force\b/];

  it("hold no forbidden flag; -scriptAuthorizeAll only on the launch", () => {
    for (const e of runEntries()) {
      const r = composeArgs(e.id, IN);
      if ("refusal" in r) continue;
      for (const f of FORBIDDEN) expect([r.script, ...r.argv].join(" "), e.id).not.toMatch(f);
    }
    expect(LAUNCH_COMMAND).toMatch(/--purpose "P4-5"/);
    expect(launchAction().args).toContain("-scriptAuthorizeAll");
  });

  it("gives each walker its CLI, run folder, state and session; netcalls only --really", () => {
    const r = composeArgs("e-06-l06", IN);
    if ("refusal" in r) throw new Error(r.refusal);
    expect(r.script).toBe(WALKERS.L06);
    expect(r.argv).toContain("mode=edit,selection=entity");
    expect(r.argv).toContain(join(IN.sittingDir, "edit-entity"));
    expect(r.argv).toEqual(expect.arrayContaining(["--session", SESSION]));
    const dry = composeArgs("e-00-entity-create", { ...IN, really: false });
    if ("refusal" in dry) throw new Error(dry.refusal);
    expect(dry.argv).not.toContain("--really");
    expect(composeArgs("h-close", IN)).toHaveProperty("refusal");
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
    const args = ["--id", "p4-5", "--sandbox", IN.sandbox, "--sitting-dir", IN.sittingDir];
    expect(await main(["--entry", "e-03-l01", ...args, "--print"], over)).toBe(0);
    expect(spawned).toBe(0);
    expect(logs.at(-1)).toMatch(/L01-snapshot\.ts/);
    expect(await main(["plant", ...args], over)).toBe(0);
    expect(offline[0]).toBe("plant");
  });
});

describe("P4-5 plan and queue", () => {
  it("passes the dry-run checks per entry and combined", () => {
    expect(checkEntries().ok).toBe(true);
    const plan = buildPlan();
    expect(checkPlan(plan, loadPolicy(), { script: "scripts/live/p4-5.ts" }).violations).toEqual(
      [],
    );
    expect(plan.filter((a) => a.kind === "launch")).toHaveLength(1);
    expect(JSON.stringify(plan)).not.toMatch(/"kind":"key"/);
  });

  it("emits a queue validateQueue accepts, session P4-5 with the mutating pack", () => {
    const q = buildQueue();
    expect(q.session).toBe("P4-5");
    expect(PROBE_MUT_SESSIONS).toContain("P4-5");
    const probes = validateQueue(q, false);
    expect(probes.filter((p) => p.risk_class === "mutating").map((p) => p.id)).toEqual([
      "p4-o-00-plant",
      "p4-w-01-worlds-create",
      "p4-l10-07-WorldEditor",
      "p4-w-03-world-open",
      "p4-e-00-entity-create",
    ]);
    const ids = probes.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("equals the committed queue file", () => {
    const file = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });
});
