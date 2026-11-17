import { describe, it, expect, afterAll } from "vitest";
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
import { join } from "node:path";
import type { RunResult } from "../../src/workbench/cli-runner.js";
import type { CliPolicy } from "../../src/tools/wb-cli-run.js";
import { checkPlan, main as dryRunMain } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { defaultPlaceholderContext, SANDBOX_NAME } from "../../scripts/live/paths.js";
import {
  BUILD_DATA_DIR,
  CI_INFO_FILE,
  EXIT,
  NEVER_FLAG,
  PLAN_PATHS,
  TIMEOUTS,
  acknowledge,
  addonBuildInfoArgv,
  buildActionPlan,
  buildDataArgv,
  buildScriptsArgv,
  buildSteps,
  forbiddenInArgv,
  main,
  runBattery,
  selectSteps,
  validateProbe,
  type CliDeps,
  type CliOptions,
} from "../live/cli.live.js";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function tmp(): string {
  const r = mkdtempSync(join(tmpdir(), "cli-battery-"));
  roots.push(r);
  return r;
}

const POLICY: CliPolicy = {
  verbs: new Set(["openProject", "buildScripts"]),
  plugins: new Set(["AddonBuildInfoTool"]),
  pluginArgs: new Map([["AddonBuildInfoTool", new Set(["addonPath", "ciInfoDst"])]]),
  source: "policy.json:cli_run.allow_list",
};

function ok(extra: Partial<RunResult> = {}): RunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 10,
    timedOut: false,
    earlySignal: null,
    ...extra,
  };
}

function fake(
  o: { pids?: number[]; policy?: CliPolicy; lease?: boolean; runThrows?: boolean } = {},
): {
  deps: CliDeps;
  spawned: string[][];
} {
  const spawned: string[][] = [];
  let clock = 0;
  const deps: CliDeps = {
    workbenchPids: () => o.pids ?? [],
    laneHoldsLease: () => o.lease ?? true,
    cliPolicy: () => o.policy ?? POLICY,
    run: async ({ args, pollSignal }) => {
      spawned.push(args);
      if (o.runThrows) throw new Error("cut off");
      if (args.some((a) => a.startsWith("-validate="))) {
        return ok({ exitCode: null, earlySignal: (await pollSignal!.check({ pid: 1 })) as string });
      }
      if (args.some((a) => a.startsWith("-plugin="))) {
        const dst = args.find((a) => a.startsWith("-ciInfoDst="))!.slice("-ciInfoDst=".length);
        writeFileSync(dst, "{}");
        return ok();
      }
      if (args.some((a) => a.startsWith("-buildData="))) {
        // Nothing changes: the idle meter must end it after TIMEOUTS.buildDataIdleMs.
        for (let i = 0; i < 1000; i++) {
          const s = await pollSignal!.check({ pid: 1 });
          if (s) return ok({ exitCode: null, earlySignal: s, durationMs: clock });
        }
        return ok({ exitCode: null, timedOut: true });
      }
      return ok();
    },
    validateCheck: () => () => "successful",
    activityBytes: () => 7,
    exists: (p) => existsSync(p),
    makeDir: (p) => mkdirSync(p, { recursive: true }),
    listDir: (p) => (existsSync(p) ? readdirSync(p) : []),
    now: () => (clock += TIMEOUTS.pollMs),
    log: () => {},
  };
  return { deps, spawned };
}

function options(runName = "run"): CliOptions {
  const root = tmp();
  const sandboxDir = join(root, SANDBOX_NAME);
  mkdirSync(sandboxDir, { recursive: true });
  const gproj = join(sandboxDir, `${SANDBOX_NAME}.gproj`);
  writeFileSync(gproj, "GameProject {}\n");
  const forceSettings = join(root, "p3-2-cli.ini");
  writeFileSync(forceSettings, "[scratch]\n");
  return {
    paths: { sandboxDir, gproj, runDir: join(root, runName), forceSettings },
    artifactsRoot: root,
    evidenceDir: null,
    ph: defaultPlaceholderContext({}),
    build: "test",
  };
}

const IDS = buildSteps().map((s) => s.id);

describe("CLI battery: the plan and the argv", () => {
  it("passes the dry-run checker: one launch action per spawn, all on the sandbox", () => {
    const plan = buildActionPlan();
    expect(plan.map((a) => (a as Record<string, unknown>).step)).toEqual(IDS.slice(1));
    expect(plan.every((a) => a.kind === "launch")).toBe(true);
    expect(checkPlan(plan, loadPolicy(), { script: "tests/live/cli.live.ts" }).ok).toBe(true);
  });

  it("main's dry run writes a plan dry-run.ts accepts", async () => {
    const out = join(tmp(), "plan.json");
    const lines: string[] = [];
    expect(await main(["--out", out], { out: (l) => lines.push(l) })).toBe(EXIT.done);
    expect(dryRunMain([out, "--script", "tests/live/cli.live.ts"])).toBe(0);
  });

  it("never carries a publish, pack or refused verb", async () => {
    for (const s of buildSteps()) {
      const a = s.argv(PLAN_PATHS);
      if (a) expect(forbiddenInArgv(a)).toBeNull();
    }
    expect(forbiddenInArgv(["-gproj", "x.gproj", "-publishAddon"])).toBe("-publishAddon");
    expect(await main([NEVER_FLAG], { out: () => {} })).toBe(EXIT.usage);
  });

  it("puts each plugin argument and the buildData folder in ONE token", () => {
    const a = addonBuildInfoArgv(PLAN_PATHS);
    expect(a).toContain("-plugin=AddonBuildInfoTool");
    expect(a).toContain("-addonPath=<sandbox>");
    expect(a.some((x) => x.startsWith("-ciInfoDst=<run>") && x.endsWith(CI_INFO_FILE))).toBe(true);
    const b = buildDataArgv(PLAN_PATHS);
    expect(b.filter((x) => x.startsWith("-buildData"))).toHaveLength(1);
    expect(b.find((x) => x.startsWith("-buildData="))).toMatch(new RegExp(`${BUILD_DATA_DIR}$`));
  });

  it("opens the module each verb needs: ScriptEditor before -validate, ResourceManager before -plugin (2026-11-14)", () => {
    const v = buildScriptsArgv(PLAN_PATHS);
    expect(v.indexOf("-wbModule=ScriptEditor")).toBe(v.indexOf("-validate=PC") - 1);
    const a = addonBuildInfoArgv(PLAN_PATHS);
    expect(a.indexOf("-wbModule=ResourceManager")).toBe(a.indexOf("-plugin=AddonBuildInfoTool") - 1);
  });
});

describe("CLI battery: the -validate probe", () => {
  it("hands the tracker's async verdict on (the old probe tested the promise for a string and lost it)", async () => {
    const probe = validateProbe(async () => "successful");
    await expect(probe({ pid: 1 })).resolves.toBe("successful");
    await expect(validateProbe(async () => null)({})).resolves.toBeNull();
  });
});

describe("CLI battery: the run against a fake runner", () => {
  it("runs the steps in order and records every spawned argv", async () => {
    const f = fake();
    const o = options();
    const r = await runBattery(buildSteps(), f.deps, o);
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => x.step)).toEqual(IDS);
    expect(r.records.slice(0, 4).every((x) => x.status === "pass")).toBe(true);
    const bd = r.records[4];
    expect(bd.status).toBe("observed");
    expect(bd.evidence.endedBy).toBe("harness (idle)");
    expect(bd.evidence.earlySignal).toBe("idle-timeout");
    const argvLog = readFileSync(join(o.paths.runDir, "argv.jsonl"), "utf-8").trim().split("\n");
    expect(argvLog).toHaveLength(4);
    expect(f.spawned).toHaveLength(4);
    expect(f.spawned[1]).toContain("-validate=PC");
  });

  it("stops at the pre-flight when a Workbench image runs, and spawns nothing", async () => {
    const f = fake({ pids: [99] });
    const r = await runBattery(buildSteps(), f.deps, options());
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe("c-00-preflight");
    expect(f.spawned).toHaveLength(0);
  });

  it("stops at the pre-flight when the lane does not hold the lease", async () => {
    const r = await runBattery(buildSteps(), fake({ lease: false }).deps, options());
    expect(r.stoppedAt).toBe("c-00-preflight");
  });

  it("stops at the pre-flight on a space in a one-token path", async () => {
    const r = await runBattery(buildSteps(), fake().deps, options("run folder"));
    expect(r.stoppedAt).toBe("c-00-preflight");
    expect(r.message).toMatch(/space/);
  });

  it("stops a verb that is not on cli_run.allow_list", async () => {
    const policy = { ...POLICY, verbs: new Set(["openProject"]) };
    const f = fake({ policy });
    const r = await runBattery(buildSteps(), f.deps, options());
    expect(r.stoppedAt).toBe("c-02-build-scripts");
    expect(f.spawned).toHaveLength(1);
  });

  it("refuses a spawn step whose pre-flight has not passed in the run folder", async () => {
    const steps = selectSteps(buildSteps(), { only: "c-01-open-project" }) as ReturnType<
      typeof buildSteps
    >;
    const f = fake();
    const r = await runBattery(steps, f.deps, options());
    expect(r.exit).toBe(EXIT.stopped);
    expect(f.spawned).toHaveLength(0);
  });

  it("never runs a step twice in a run folder", async () => {
    const o = options();
    const pre = selectSteps(buildSteps(), { only: "c-00-preflight" }) as ReturnType<
      typeof buildSteps
    >;
    await runBattery(pre, fake().deps, o);
    expect((await runBattery(pre, fake().deps, o)).exit).toBe(EXIT.refused);
  });

  it("puts -forceSettings <scratch ini> on every spawn, -buildData included", async () => {
    const f = fake();
    const o = options();
    await runBattery(buildSteps(), f.deps, o);
    expect(f.spawned).toHaveLength(4);
    for (const a of f.spawned) {
      const i = a.indexOf("-forceSettings");
      expect(i).toBeGreaterThan(-1);
      expect(a[i + 1]).toBe(o.paths.forceSettings);
    }
  });

  it("stops at the pre-flight when the scratch ini is missing or outside the artifacts folder", async () => {
    const o = options();
    rmSync(o.paths.forceSettings);
    const r = await runBattery(buildSteps(), fake().deps, o);
    expect(r.stoppedAt).toBe("c-00-preflight");
    const o2 = options();
    o2.paths.forceSettings = join(tmp(), "elsewhere.ini");
    writeFileSync(o2.paths.forceSettings, "x");
    expect((await runBattery(buildSteps(), fake().deps, o2)).stoppedAt).toBe("c-00-preflight");
  });

  it("records the argv before the spawn, and a cut-off step blocks the folder until acknowledged", async () => {
    const o = options();
    const r = await runBattery(buildSteps(), fake({ runThrows: true }).deps, o);
    expect(r.stoppedAt).toBe("c-01-open-project");
    expect(readFileSync(join(o.paths.runDir, "argv.jsonl"), "utf-8")).toContain(
      "c-01-open-project",
    );
    // A marker with no record (a kill mid-spawn) is simulated by removing the record.
    rmSync(join(o.paths.runDir, "c-01-open-project.json"));
    const next = selectSteps(buildSteps(), { only: "c-02-build-scripts" }) as ReturnType<
      typeof buildSteps
    >;
    const blocked = await runBattery(next, fake().deps, o);
    expect(blocked.exit).toBe(EXIT.refused);
    expect(blocked.message).toMatch(/never recorded/);
    expect(acknowledge(o.paths.runDir, "c-01-open-project")).toMatch(/acknowledged/);
    expect((await runBattery(next, fake().deps, o)).stoppedAt).toBeNull();
  });

  it("main refuses --really without --force-settings, and a run folder outside the artifacts folder", async () => {
    const o = options();
    const base = ["--really", "--id", "t1", "--sandbox", o.paths.sandboxDir];
    const ov = {
      out: () => {},
      platform: "win32" as const,
      leaseHeld: true,
      deps: fake().deps,
      artifactsRoot: o.artifactsRoot,
    };
    expect(await main(base, ov)).toBe(EXIT.usage);
    expect(
      await main(
        [...base, "--force-settings", o.paths.forceSettings, "--run-dir", join(tmp(), "x")],
        ov,
      ),
    ).toBe(EXIT.refused);
  });
});
