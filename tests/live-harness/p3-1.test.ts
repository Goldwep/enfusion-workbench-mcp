import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import {
  BC_BUTTON,
  DEFAULT_QUEUE,
  LAUNCH_PACKS,
  LAUNCH_QUEUE,
  P31_BUTTON,
  SCRIPTS,
  buildPlan,
  buildQueue,
  buildSequence,
  composeArgs,
  launchCount,
  main,
  runEntries,
  type RunEntry,
} from "../../scripts/live/p3-1.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import * as se from "../../scripts/live/s-e-train1b.js";
import * as sf from "../../scripts/live/s-f-gui.js";

const BASE = {
  laneId: "p3-1",
  really: true,
  sfRunDir: "<artifacts>/sessions/S-F/run",
  seRunDir: "<artifacts>/sessions/S-E/run",
  registryExport: "<artifacts>/pre.reg",
  forceSettings: "<artifacts>/sessions/S-F/run/sf-launch1.ini",
  iniIn: "<artifacts>/scrubbed.ini",
};
const argvOf = (
  id: string,
  extra: Partial<typeof BASE> & Record<string, unknown> = {},
): string[] => {
  const r = composeArgs(id, { ...BASE, ...extra });
  if ("refusal" in r) throw new Error(r.refusal);
  return r.argv;
};

describe("P3-1 sequence", () => {
  const seq = buildSequence();
  const runs = runEntries(seq);

  it("runs in this order of invocations", () => {
    expect(runs.map((e) => e.id)).toEqual([
      "a-00",
      "a-01",
      "a-02",
      "a-03",
      "a-04",
      "a-05",
      "a-06",
      "a-07",
      "a-08",
      "a-09",
      "a-10",
      "a-11",
      "a-12",
      "bc-00",
      "bc-01",
      "bc-02",
      "bc-03",
      "bc-04",
    ]);
  });

  it("needs three launches, each preceded by its offline steps and followed by a close", () => {
    expect(launchCount(seq)).toBe(3);
    const ids = seq.map((e) => e.id);
    expect(ids.indexOf("h-launch-a1")).toBeLessThan(ids.indexOf("a-01"));
    expect(ids.indexOf("h-close-a1")).toBeLessThan(ids.indexOf("a-07"));
    expect(ids.indexOf("a-07")).toBeLessThan(ids.indexOf("h-launch-a2"));
    expect(ids.indexOf("bc-00")).toBeLessThan(ids.indexOf("h-launch-bc"));
    expect(ids[ids.length - 1]).toBe("h-close-bc");
  });

  it("names only steps that exist in the sub-scripts, through selections they accept", () => {
    const sfIds = sf.buildSteps().map((s) => s.id);
    const seIds = se.buildSteps().map((s) => s.id);
    for (const e of runs) {
      if ("sub" in e.sel) continue;
      for (const s of e.steps) expect(e.script === "s-f" ? sfIds : seIds).toContain(s);
      const sel = { from: null, until: null, only: null, ...e.sel, runDir: true };
      const offline = e.phase.startsWith("offline");
      const refusal =
        e.script === "s-f"
          ? sf.selectionRefusal({ ...sel, offline })
          : se.selectionRefusal({ ...sel, offline, repeatAll: true });
      expect(refusal, e.id).toBeNull();
      const picked = e.script === "s-f" ? sf.selectedIds(sel) : se.selectedIds(sel);
      expect(picked, e.id).toEqual(e.steps);
    }
  });

  it("runs FileExists and OpenFile before any FindFiles in launch 1 (DEC-047 U27 row)", () => {
    const a1 = runs.filter((e) => e.phase === "A1").flatMap((e) => e.steps);
    const firstFind = a1.findIndex((s) => /findfiles/.test(s));
    expect(a1.indexOf("sf-04-u27-fileexists")).toBeLessThan(firstFind);
    expect(a1.indexOf("sf-09-u27-openfile-yes-to-all")).toBeLessThan(firstFind);
    expect(a1.indexOf("sf-02-u27-findfiles")).toBe(firstFind);
    expect(a1.indexOf("sf-03-u27-findfiles-again")).toBeLessThan(
      a1.indexOf("sf-05-u27-findfiles-line-b"),
    );
  });

  it("rules Yes first, No at the deliberate step, Yes to All at the scope step", () => {
    expect(P31_BUTTON["sf-04-u27-fileexists"]).toBe("No");
    expect(P31_BUTTON["sf-09-u27-openfile-yes-to-all"]).toBe("Yes");
    expect(P31_BUTTON["sf-02-u27-findfiles"]).toBe("No");
    expect(P31_BUTTON["sf-03-u27-findfiles-again"]).toBe("YesToAll");
    expect(P31_BUTTON["sf-05-u27-findfiles-line-b"]).toBe("Yes");
    expect(BC_BUTTON).toBe("YesToAll");
  });

  it("carries B and C in the one S-E launch, se-16 last, the mutating pack only there", () => {
    const bc = runs.filter((e) => e.phase === "BC");
    expect(bc.map((e) => e.steps[0])).toEqual([
      "se-05-u16-save",
      "se-07-u8-AudioEditor",
      "se-07-u8-ProcAnimEditor",
      "se-16-u14-reload-broken",
    ]);
    expect(LAUNCH_PACKS.A1).not.toContain("mod-dev/probe-mut");
    expect(LAUNCH_PACKS.A2).not.toContain("mod-dev/probe-mut");
    expect(LAUNCH_PACKS.BC).toContain("mod-dev/probe-mut");
    expect(LAUNCH_QUEUE.BC).toMatch(/S-E-queue\.json$/);
    expect(JSON.parse(readFileSync(join(REPO_ROOT, LAUNCH_QUEUE.BC), "utf-8")).session).toBe(
      se.SESSION ?? "S-E",
    );
  });
});

describe("P3-1 flags passed to each script", () => {
  it("creates the S-F run folder offline with the scrubbed ini, no launch flags", () => {
    const a = argvOf("a-00");
    expect(a).toEqual([
      "--really",
      "--id",
      "p3-1",
      "--from",
      "sf-p2-dlg-consumers-static",
      "--until",
      "sf-p1-ini-launch1",
      "--offline",
      "--ini-in",
      BASE.iniIn,
    ]);
  });

  it("resumes the run folder with the launch flags in a launch", () => {
    expect(argvOf("a-01")).toEqual([
      "--really",
      "--id",
      "p3-1",
      "--only",
      "sf-04-u27-fileexists",
      "--run-dir",
      BASE.sfRunDir,
      "--registry-export",
      BASE.registryExport,
      "--force-settings",
      BASE.forceSettings,
      "--ruled-buttons",
      "sf-04-u27-fileexists=No,sf-09-u27-openfile-yes-to-all=Yes,sf-02-u27-findfiles=No,sf-03-u27-findfiles-again=YesToAll,sf-05-u27-findfiles-line-b=Yes",
    ]);
    expect(argvOf("a-06")).toContain("--from");
    // Offline S-F invocations and S-E get no rulings.
    expect(argvOf("a-07")).not.toContain("--ruled-buttons");
    expect(argvOf("bc-01")).not.toContain("--ruled-buttons");
  });

  it("passes S-F's deviation flag only for a press other than P3-1's ruling", () => {
    // a-02 resumes a-01's prompt (sf-04: P3-1 rules No).
    const a2 = argvOf("a-02", { ownerClicked: ["No"] } as never);
    expect(a2).toEqual(expect.arrayContaining(["--owner-clicked", "No"]));
    expect(a2).not.toContain("--owner-clicked-deviation");
    // a-04 resumes a-03 (sf-02: P3-1 rules No; S-F's own Yes no longer matters).
    expect(argvOf("a-04", { ownerClicked: ["No"] } as never)).not.toContain(
      "--owner-clicked-deviation",
    );
  });

  it("refuses a button other than P3-1's ruling unless the owner's deviation is stated", () => {
    const r = composeArgs("a-04", { ...BASE, ownerClicked: ["Yes"] });
    expect("refusal" in r && r.refusal).toMatch(/P3-1 rules No/);
    const ok = composeArgs("a-04", { ...BASE, ownerClicked: ["Yes"], ownerDeviation: true });
    expect("argv" in ok && ok.argv).toEqual(
      expect.arrayContaining(["--owner-clicked", "Yes", "--owner-clicked-deviation"]),
    );
    const none = composeArgs("a-01", { ...BASE, ownerClicked: ["Yes"] });
    expect("refusal" in none && none.refusal).toMatch(/none is expected/);
  });

  it("passes --repeat-all to the S-E steps session 007 answered, and the S-E run folder", () => {
    for (const id of ["bc-01", "bc-02", "bc-03", "bc-04"]) {
      const a = argvOf(id);
      expect(a).toContain("--repeat-all");
      expect(a).toEqual(expect.arrayContaining(["--run-dir", BASE.seRunDir]));
      expect(a).not.toContain("--offline");
    }
    // S-E has no deviation flag.
    expect(argvOf("bc-02", { ownerClicked: ["YesToAll"] } as never)).not.toContain(
      "--owner-clicked-deviation",
    );
  });

  it("plants offline with the S-E run folder", () => {
    expect(argvOf("bc-00")).toEqual([
      "plant",
      "--run-dir",
      BASE.seRunDir,
      "--id",
      "p3-1",
      "--really",
    ]);
  });

  it("resumes an owner-hand step with --only and --owner-done", () => {
    const a = argvOf("a-06", { onlyStep: "sf-13-u21-menus-foreground", ownerDone: true } as never);
    expect(a).toEqual(
      expect.arrayContaining(["--only", "sf-13-u21-menus-foreground", "--owner-done"]),
    );
    expect(a).not.toContain("--from");
    const r = composeArgs("a-06", {
      ...BASE,
      onlyStep: "sf-14-u31-qt-introspection",
      ownerDone: true,
    });
    expect("refusal" in r).toBe(true);
  });

  it("refuses hand entries and a missing run folder", () => {
    expect("refusal" in composeArgs("h-launch-a1", BASE)).toBe(true);
    expect("refusal" in composeArgs("a-01", { ...BASE, sfRunDir: null })).toBe(true);
    expect("refusal" in composeArgs("a-01", { ...BASE, registryExport: null })).toBe(true);
  });
});

describe("P3-1 main against a fake spawner", () => {
  it("spawns the sub-script with the composed argv and returns its exit code", async () => {
    const calls: Array<{ script: string; argv: string[] }> = [];
    const code = await main(
      [
        "--entry",
        "a-03",
        "--id",
        "p3-1",
        "--really",
        "--sf-run-dir",
        BASE.sfRunDir,
        "--registry-export",
        BASE.registryExport,
        "--force-settings",
        BASE.forceSettings,
        "--owner-clicked",
        "Yes",
        "--owner-deviation",
      ],
      { spawnChild: async (script, argv) => (calls.push({ script, argv }), 5), log: () => {} },
    );
    expect(code).toBe(5);
    expect(calls).toHaveLength(1);
    expect(calls[0].script).toBe(SCRIPTS["s-f"]);
    expect(calls[0].argv).toEqual(
      expect.arrayContaining([
        "--only",
        "sf-02-u27-findfiles",
        "--owner-clicked",
        "Yes",
        "--owner-clicked-deviation",
      ]),
    );
  });

  it("--print spawns nothing; -scriptAuthorizeAll is refused", async () => {
    let n = 0;
    const spawnChild = async (): Promise<number> => (n++, 0);
    expect(
      await main(["--entry", "bc-00", "--id", "p3-1", "--se-run-dir", "x", "--print"], {
        spawnChild,
        log: () => {},
      }),
    ).toBe(0);
    expect(
      await main(["--entry", "a-00", "--script-authorize-all"], { spawnChild, log: () => {} }),
    ).toBe(2);
    expect(
      await main(["--entry", "a-00", "--ini-in", "-scriptAuthorizeAll"], {
        spawnChild,
        log: () => {},
      }),
    ).toBe(2);
    expect(n).toBe(0);
  });

  it("the dry run passes and spawns nothing", async () => {
    let n = 0;
    expect(await main([], { spawnChild: async () => (n++, 0), log: () => {} })).toBe(0);
    expect(n).toBe(0);
  });
});

describe("P3-1 plan and queue", () => {
  it("the combined plan passes dry-run's check and carries three launches without the flag", () => {
    const plan = buildPlan();
    expect(checkPlan(plan, loadPolicy(), { script: "scripts/live/p3-1.ts" }).ok).toBe(true);
    const launches = plan.filter((a) => a.kind === "launch");
    expect(launches).toHaveLength(3);
    for (const l of launches)
      expect((l.args as string[]).join(" ")).not.toMatch(/scriptAuthorizeAll/i);
    const steps = new Set(plan.map((a) => a.step));
    for (const e of runEntries() as RunEntry[])
      for (const s of e.steps)
        if (
          s !== "sf-p2-dlg-consumers-static" &&
          s !== "sf-22-u22-lsp-port" &&
          s !== "sf-27-close-test"
        )
          expect(steps, s).toContain(s);
    expect(plan.some((a) => /ParticleEditor|MainMenuWorld/.test(JSON.stringify(a)))).toBe(false);
  });

  it("validates with validateQueue per launch, and the file equals the generator", () => {
    const q = buildQueue();
    expect(validateQueue(q, false)).toHaveLength((q.probes as unknown[]).length);
    expect(JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8"))).toEqual(JSON.parse(JSON.stringify(q)));
    expect(q.launches).toBe(3);
  });
});
