import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import {
  CLOSE_COMMAND,
  DEFAULT_QUEUE,
  LAUNCH_COMMAND,
  P4_ROOT,
  PLANT_CONF,
  PLANT_FILE,
  SAA,
  SESSION,
  VANILLA_CONF,
  WALKERS,
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
  runPlant,
  runRollback,
  type OfflineIo,
  type WalkerEntry,
} from "../../scripts/live/p4-1.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { PROBE_MUT_SESSIONS, validateQueue } from "../../scripts/live/preflight.js";
import { VANILLA_CONF as TRAIN2_VANILLA } from "../live/train2.live.js";

const IN = {
  laneId: "p4-1",
  really: true,
  sandbox: "<addons>/EMCP2_sandbox",
  sittingDir: "<artifacts>/sessions/P4-1/run",
};

describe("P4-1 sequence", () => {
  const seq = buildSequence();

  it("runs its entries in the design's order", () => {
    expect(seq.map((e) => e.id)).toEqual([
      "h-lease",
      "o-00-plant",
      "h-launch",
      "w-01-worlds-create",
      "w-02-world-editor",
      "w-03-world-open",
      "w-04-world-check",
      "n-01-l01",
      "n-02-l03",
      "n-03-l02",
      "n-04-l06",
      "n-05-l09",
      "n-06-l15",
      "x-01-l10",
      "x-02-l02-rm",
      "x-03-l11",
      "x-04-l04-d14",
      "h-list1-go",
      "x-05-l04-list1",
      "x-06-l05-hand",
      "x-08-l07",
      "x-09-l17",
      "h-select",
      "e-01-l01",
      "e-02-l03",
      "e-03-l02",
      "e-04-l05-hand",
      "e-06-l06",
      "h-close",
    ]);
  });

  it("has one launch, the plant before it and the close last", () => {
    expect(launchCount(seq)).toBe(1);
    const ids = seq.map((e) => e.id);
    expect(ids.indexOf("o-00-plant")).toBeLessThan(ids.indexOf("h-launch"));
    expect(ids.at(-1)).toBe("h-close");
    expect(CLOSE_COMMAND).toMatch(/--remove-probe-mut --remove-probe/);
    expect(CLOSE_COMMAND).toMatch(/p4-1\.ts rollback/);
  });

  it("puts D14 before the list 1 block and the owner's selection before edit/entity", () => {
    const ids = seq.map((e) => e.id);
    expect(ids.indexOf("x-04-l04-d14")).toBeLessThan(ids.indexOf("x-05-l04-list1"));
    for (const e of seq.filter((x) => x.kind === "walker" && x.state === "edit-entity"))
      expect(ids.indexOf(e.id)).toBeGreaterThan(ids.indexOf("h-select"));
    const d14 = seq.find((e) => e.id === "x-04-l04-d14") as WalkerEntry;
    expect(entrySteps(d14).map((s) => s.id)).toEqual(["p4-l04-d14-options"]);
    const l1 = seq.find((e) => e.id === "x-05-l04-list1") as WalkerEntry;
    expect(entrySteps(l1)).toHaveLength(6);
  });

  it("runs L17 after the Resource Manager L02 it gates on, in a sibling run folder", () => {
    const ids = seq.map((e) => e.id);
    expect(ids.indexOf("x-02-l02-rm")).toBeLessThan(ids.indexOf("x-09-l17"));
    const rm = seq.find((e) => e.id === "x-02-l02-rm") as WalkerEntry;
    const qt = seq.find((e) => e.id === "x-09-l17") as WalkerEntry;
    expect(rm.module).toBe("ResourceManager");
    expect(rm.runSub).toBe("modules");
    expect(rm.runSub).not.toBe(qt.runSub);
    // P4-1 2026-10-12: L17 ran with --module WorldEditor and answered absent
    expect(qt.module).toBe("ResourceManager");
    const a = composeArgs(qt.id, IN);
    expect("argv" in a && a.argv.join(" ")).toContain("--module ResourceManager");
  });

  it("marks L05 blocked while it plans nothing", () => {
    for (const e of runEntries(seq).filter((x) => x.kind === "walker" && x.walker === "L05")) {
      const w = e as WalkerEntry;
      const r = composeArgs(e.id, IN);
      if (entrySteps(w).length === 0) {
        expect(blockedReason(e)).toMatch(/uia_context/);
        expect("refusal" in r && r.refusal).toMatch(/blocked/);
      } else expect("argv" in r).toBe(true);
    }
  });
});

describe("P4-1 L05 is a hand block (DEC-091 ruling 2)", () => {
  const seq = buildSequence();
  const l05 = runEntries(seq).filter(
    (x) => x.kind === "walker" && x.walker === "L05",
  ) as WalkerEntry[];

  it("plans no ShowContextMenu step: every L05 step is a passive hand step", () => {
    expect(l05.map((e) => e.id)).toEqual(["x-06-l05-hand", "e-04-l05-hand"]);
    for (const e of l05) {
      expect(e.flags).toContain("--passive");
      expect(e.ownerHand).toMatch(/right-click/);
      for (const st of entrySteps(e)) {
        expect(st.id).toMatch(/^p4-l05-hand-/);
        expect(
          st.plan({ module: e.module, state: {}, allowOwned: false }).map((p) => p.kind),
        ).not.toContain("uia-context");
      }
      const r = composeArgs(e.id, IN);
      if ("argv" in r) expect(r.argv).toContain("--passive");
    }
  });
});

describe("P4-1 composed commands", () => {
  const seq = buildSequence();
  const FORBIDDEN = [
    /scriptauthorizeall/i,
    /script-authorize-all/i,
    /--owner-clicked-deviation/,
    /--repeat-all/,
    /taskkill/i,
    /--force\b/,
    /--extra-args/,
  ];

  it("hold no forbidden flag; the ruled -scriptAuthorizeAll is only on the launch", () => {
    for (const e of runEntries(seq)) {
      const r = composeArgs(e.id, IN);
      if ("refusal" in r) continue;
      const text = [r.script, ...r.argv].join(" ");
      for (const f of FORBIDDEN) expect(text, `${e.id}`).not.toMatch(f);
    }
    for (const e of seq)
      if (e.kind === "hand" && e.command && e.id !== "h-launch")
        for (const f of FORBIDDEN) expect(e.command, e.id).not.toMatch(f);
    expect(LAUNCH_COMMAND).toMatch(/--script-authorize-all --owner-go-script-authorize-all/);
    expect(launchAction().args).toContain(SAA);
  });

  it("gives each walker its own CLI, run folder, state and session", () => {
    const r = composeArgs("n-01-l01", IN);
    if ("refusal" in r) throw new Error(r.refusal);
    expect(r.script).toBe(WALKERS.L01);
    expect(r.argv).toEqual([
      "--really",
      "--id",
      "p4-1",
      "--sandbox",
      IN.sandbox,
      "--run-dir",
      join(IN.sittingDir, "edit-none"),
      "--module",
      "WorldEditor",
      "--state",
      "mode=edit,selection=none",
      "--session",
      SESSION,
      "--from",
      "p4-l01-snapshot-WorldEditor-edit-none",
    ]);
    const l1 = composeArgs("x-05-l04-list1", IN);
    if ("refusal" in l1) throw new Error(l1.refusal);
    expect(l1.argv).toEqual(expect.arrayContaining(["--allow-owned", "--owner-done"]));
    const e = composeArgs("e-06-l06", IN);
    if ("refusal" in e) throw new Error(e.refusal);
    expect(e.argv).toContain("mode=edit,selection=entity");
    expect(e.argv).toContain(join(IN.sittingDir, "edit-entity"));
  });

  it("refuses hand entries, unknown steps and a missing lane", () => {
    expect(composeArgs("h-launch", IN)).toHaveProperty("refusal");
    expect(composeArgs("n-03-l02", { ...IN, onlyStep: "p4-l01-x" })).toHaveProperty("refusal");
    expect(composeArgs("n-01-l01", { ...IN, laneId: "" })).toHaveProperty("refusal");
    const r = composeArgs("n-03-l02", { ...IN, onlyStep: "p4-l02-worldeditor-help-edit-none" });
    if ("refusal" in r) throw new Error(r.refusal);
    expect(r.argv.slice(-2)).toEqual(["--only", "p4-l02-worldeditor-help-edit-none"]);
  });

  it("sends the netcalls only with --really", () => {
    const dry = composeArgs("w-01-worlds-create", { ...IN, really: false });
    if ("refusal" in dry) throw new Error(dry.refusal);
    expect(dry.argv).not.toContain("--really");
    const real = composeArgs("w-01-worlds-create", IN);
    if ("refusal" in real) throw new Error(real.refusal);
    expect(real.argv[0]).toBe("ECEN_ProbeMut");
    expect(real.argv.join(" ")).toMatch(/_throwaway\/P4\/worlds/);
  });

  it("main refuses the flag, prints without spawning", async () => {
    const logs: string[] = [];
    let spawned = 0;
    const over = { log: (l: string) => logs.push(l), spawnChild: async () => (spawned++, 0) };
    expect(await main(["--script-authorize-all"], over)).toBe(2);
    expect(
      await main(
        [
          "--entry",
          "n-01-l01",
          "--id",
          "p4-1",
          "--sandbox",
          IN.sandbox,
          "--sitting-dir",
          IN.sittingDir,
          "--print",
        ],
        over,
      ),
    ).toBe(0);
    expect(spawned).toBe(0);
    expect(logs.at(-1)).toMatch(/L01-snapshot\.ts/);
  });
});

describe("P4-1 plan and queue", () => {
  it("passes the dry-run checks per entry, and the combined plan under L04's script", () => {
    expect(checkEntries().ok).toBe(true);
    const plan = buildPlan();
    const r = checkPlan(plan, loadPolicy(), { script: WALKERS.L04 });
    expect(r.violations).toEqual([]);
    // File > Options... left execute_action.allow_list (DEC-107, total audit live-tools-b-1): D14
    // is BLOCKED, so the plan no longer lifts the D14 Cancel exception (owner ruling 1 of 2026-10-10).
    expect(r.exceptionsUsed.map((x) => x.id)).toEqual([]);
    expect(plan.filter((a) => a.kind === "launch")).toHaveLength(1);
    expect(JSON.stringify(plan)).not.toMatch(/"kind":"key"/);
  });

  it("emits a queue validateQueue accepts, session P4-1, mutating only plant, create, open, L10 modules", () => {
    const q = buildQueue();
    expect(q.session).toBe("P4-1");
    expect(PROBE_MUT_SESSIONS).toContain("P4-1");
    const probes = validateQueue(q, false);
    expect(probes.filter((p) => p.risk_class === "mutating").map((p) => p.id)).toEqual([
      "p4-o-00-plant",
      "p4-w-01-worlds-create",
      "p4-l10-07-WorldEditor",
      "p4-w-03-world-open",
      "p4-l10-01-LocalizationEditor",
      "p4-l10-02-BehaviorEditor",
      "p4-l10-03-AudioEditor",
      "p4-l10-04-AnimEditor",
      "p4-l10-05-ProcAnimEditor",
      "p4-l10-06-ScriptEditor",
      "p4-l10-07-WorldEditor@mode-edit-selection-none",
      "p4-l10-08-ResourceManager",
      "p4-l10-09-NavmeshGeneratorMain",
    ]);
    const ids = probes.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("equals the committed queue file", () => {
    const file = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });
});

describe("P4-1 plant and rollback", () => {
  const fake = (): OfflineIo & { files: Map<string, Buffer>; logs: string[] } => {
    const files = new Map<string, Buffer>();
    const logs: string[] = [];
    const norm = (p: string): string => p.replace(/\\/g, "/");
    return {
      files,
      logs,
      workbenchPids: () => [],
      exists: (p) => [...files.keys()].some((k) => k === norm(p) || k.startsWith(norm(p) + "/")),
      listDir: (p) =>
        [...files.keys()]
          .filter((k) => k.startsWith(norm(p) + "/"))
          .map((k) => k.slice(norm(p).length + 1).split("/")[0]),
      listTree: (p) =>
        [...files.keys()]
          .filter((k) => k.startsWith(norm(p) + "/"))
          .map((k) => k.slice(norm(p).length + 1)),
      readVanilla: () => Buffer.from("InputManagerConfig {\n Foo 3\n}\n"),
      readBytes: (p) => {
        const b = files.get(norm(p));
        if (!b) throw new Error(`no ${p}`);
        return b;
      },
      writeBytes: (p, b) => void files.set(norm(p), b),
      removeTree: (p) => {
        for (const k of [...files.keys()]) if (k.startsWith(norm(p) + "/")) files.delete(k);
      },
      log: (l) => logs.push(l),
    };
  };

  it("uses train2's U16 source", () => {
    expect(VANILLA_CONF).toBe(TRAIN2_VANILLA);
  });

  it("plants once, records hash and scalar, and rolls back", () => {
    const io = fake();
    expect(runPlant("/sb", "/sit", true, io)).toBe(0);
    expect(io.files.has(`/sb/${PLANT_CONF}`)).toBe(true);
    const rec = JSON.parse(io.files.get(`/sit/${PLANT_FILE}`)!.toString("utf-8")) as Record<
      string,
      unknown
    >;
    expect(rec).toMatchObject({ varName: "Foo", value: "3", next: "4" });
    expect(runPlant("/sb", "/sit", true, io)).toBe(3);
    expect(runRollback("/sb", "/sit", true, io)).toBe(0);
    expect([...io.files.keys()].some((k) => k.startsWith(`/sb/${P4_ROOT}`))).toBe(false);
  });

  it("refuses while a Workbench runs", () => {
    const io = { ...fake(), workbenchPids: () => [42] };
    expect(runPlant("/sb", "/sit", true, io)).toBe(1);
  });
});
