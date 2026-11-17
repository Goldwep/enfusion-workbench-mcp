/**
 * Sitting P3-2, part 2: the CLI battery (plan Phase 3 exit gate L7; DEC-048 "Live sittings" item 2).
 *
 * NO Workbench open, the lease free of any other session (the lane given with --id holds it). The
 * runbook runs `preflight.ts --variant headless-cli` first (as S-A did); c-00 re-checks its core.
 * Every spawn carries `-forceSettings <scratch ini inside the artifacts folder>` (`--force-settings`,
 * required with --really): the owner's registry profile is never read or written (DEC-038 U12).
 * [unverified] U12 proved -forceSettings on a GUI launch only; headless it is unproven. Every spawn goes through src/workbench/cli-runner.ts
 * (`runWorkbench`: the refused-switch check, no shell, the whole tree killed on a timeout or an
 * early signal) with its argv built by src/tools/wb-cli-run.ts `planFor` and checked against
 * policy.json `cli_run.allow_list` (`loadCliPolicy`), so the battery also proves wb_cli_run's argv.
 * The one form `wb_cli_run` does not list (`-buildData`, DEC-047 L7 "one more form to try") goes
 * through the same runner with `validateArgs` and the battery's own curated flag list.
 *
 * Publish and pack verbs never: every argv is checked for them before the plan is emitted.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline and the ACTION PLAN (`launch` actions,
 * one per spawn, with placeholders), checks it with scripts/live/dry-run.ts and writes it to --out.
 *
 * Steps (each writes `<run>/<step>.json`; every spawned argv is appended to `<run>/argv.jsonl`):
 *   c-00-preflight      no Workbench image running; the lane holds the lease; headlessSpawnBlocker
 *                       clear; the sandbox .gproj exists; no space in the paths the one-token forms
 *                       carry (a `-key=<path>` token is cut at the first space, cli-runner.ts header).
 *   c-01-open-project   verb:openProject  -gproj <p> -exitAfterInit: exits by itself (DEC-033 U1).
 *   c-02-build-scripts  verb:buildScripts -gproj <p> -wbModule=ScriptEditor -validate=PC: the harness
 *                       ends the process on "Script validation successful." in script.log (DEC-035,
 *                       DEC-047 L7; the module switch is required, cli-battery-1.9.md).
 *   c-03-addon-build-info plugin:AddonBuildInfoTool -wbModule=ResourceManager -plugin= with -addonPath=<sandbox> and
 *                       -ciInfoDst=<run>/addon.ci-info.json, one token each (DEC-037).
 *   c-04-build-data     -gproj <p> -wbModule=ResourceManager -buildData=<run>/buildData (the folder in
 *                       ONE token), idle timeout 300 s, the harness ends the process.
 *
 * Usage:
 *   npx --no tsx tests/live/cli.live.ts [--out <plan.json>] [--outline <file>]
 *   npx --no tsx tests/live/cli.live.ts --really --id <lane id> --sandbox <dir>
 *       [--run-dir <dir>] [--from <step> | --only <step>] [--evidence-dir <dir>]
 *
 * Exit: 0 done (or dry run passed), 1 refused or plan check failed, 2 usage, 3 stopped.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { loadCliPolicy, planFor, type CliPolicy } from "../../src/tools/wb-cli-run.js";
import { ValidateRunTracker } from "../../src/tools/wb-validate-scripts.js";
import { buildWorkbenchArgs } from "../../src/workbench/client.js";
import {
  headlessSpawnBlocker,
  runWorkbench,
  runningWorkbenchPids,
  validateArgs,
  type RunOptions,
  type RunResult,
} from "../../src/workbench/cli-runner.js";
import { snapshotSessionDirs } from "../../src/workbench/launch-tracker.js";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { checkPlan, formatResult, type PlanAction } from "../../scripts/live/dry-run.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "../../scripts/live/evidence.js";
import { Lane } from "../../scripts/live/lane.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import {
  acknowledgedMarkerPath,
  outsideArtifacts,
  startedMarkerPath,
  writeStartedMarker,
} from "../../scripts/live/session-common.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P3-2-C";
export const SCRIPT_PATH = "tests/live/cli.live.ts";
export const EXIT = { done: 0, refused: 1, usage: 2, stopped: 3 } as const;

export const NEVER_FLAG = "-scriptAuthorizeAll";
/**
 * No argv of this battery may carry one of these (plan 5.7: publish verbs are never run).
 * -scriptAuthorizeAll is no longer listed: owner ruling 2026-11-06, the 2.0 release standard.
 */
export const NEVER_IN_ARGV = /^-(publish|pack|wbBackendLogin|clearSettings)/i;

export const BUILD_DATA_DIR = "buildData";
export const CI_INFO_FILE = "addon.ci-info.json";
export const PLUGIN = "AddonBuildInfoTool";

export const TIMEOUTS = {
  /** openProject and the plugin exit by themselves; this is the wall-clock cap. */
  selfExitMs: 300_000,
  /** -validate never exits by itself (DEC-035): the success line or this cap. */
  validateMs: 300_000,
  /** -buildData: no change in the output folder or the log for this long ends the process. */
  buildDataIdleMs: 300_000,
  /** -buildData wall-clock cap (S-A-4 idled 1,800 s). */
  buildDataCapMs: 1_800_000,
  pollMs: 2_000,
} as const;

/** The flags this battery's own `-buildData` form may carry (cli-runner.ts validateArgs). */
export const BUILD_DATA_FLAGS = [
  "-gproj",
  "-scriptAuthorizeAll",
  "-wbModule",
  "-buildData",
  "-forceSettings",
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export type StepStatus = "pass" | "fail" | "observed" | "stopped";

export interface StepRecord {
  step: string;
  title: string;
  proves: string;
  status: StepStatus;
  startedAt: string;
  endedAt: string;
  argv?: string[];
  evidence: Record<string, unknown>;
  stop?: string;
}

export interface StepOutcome {
  status: StepStatus;
  argv?: string[];
  evidence: Record<string, unknown>;
}

export interface CliPaths {
  sandboxDir: string;
  gproj: string;
  runDir: string;
  /** The scratch settings ini (`-forceSettings`), inside the artifacts folder. */
  forceSettings: string;
}

export interface CliDeps {
  workbenchPids: () => number[];
  /** True when the lane holds the lease (and so no other session does). */
  laneHoldsLease: () => boolean;
  cliPolicy: () => CliPolicy;
  /** cli-runner.ts runWorkbench (tests: a fake). */
  run: (o: Pick<RunOptions, "args" | "timeoutMs" | "pollSignal">) => Promise<RunResult>;
  /**
   * A fresh completion probe for `-validate` (ValidateRunTracker.check). The tracker's check is
   * async: the probe must hand its promise on (runWorkbench awaits it), never test it for a string.
   */
  validateCheck: () => (ctx: { pid?: number }) => string | null | Promise<string | null>;
  /** Bytes under a folder plus the newest session log's size: the idle meter of -buildData. */
  activityBytes: (dir: string) => number;
  exists: (p: string) => boolean;
  makeDir: (p: string) => void;
  listDir: (p: string) => string[];
  now: () => number;
  log: (line: string) => void;
}

export interface CliOptions {
  paths: CliPaths;
  /** The artifacts folder: the run folder and the ini must lie inside it. */
  artifactsRoot: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

export interface StepContext {
  deps: CliDeps;
  opts: CliOptions;
  prior: (id: string) => StepRecord | null;
}

export interface StepDef {
  id: string;
  title: string;
  proves: string;
  /** The argv this step spawns, for the given paths (null: spawns nothing). */
  argv: (p: CliPaths) => string[] | null;
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

export class StopBattery extends Error {
  constructor(
    message: string,
    readonly evidence: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StopBattery";
  }
}

// ── Argv ─────────────────────────────────────────────────────────────────────

/**
 * The scratch profile on every spawn: `-forceSettings` and the ini as two tokens (the path as its own
 * argv entry, cli-runner.ts header). Appended after wb_cli_run's argv: the planFor part is unchanged.
 */
export function withScratch(argv: string[], p: CliPaths): string[] {
  if (p.forceSettings.startsWith("-")) throw new Error("flag-shaped settings path");
  return [...argv, "-forceSettings", p.forceSettings];
}

export function openProjectArgv(p: CliPaths): string[] {
  return withScratch(planFor("openProject", { gproj: p.gproj }), p);
}

export function buildScriptsArgv(p: CliPaths): string[] {
  return withScratch(planFor("buildScripts", { gproj: p.gproj, configuration: "PC" }), p);
}

export function addonBuildInfoArgv(p: CliPaths): string[] {
  return withScratch(
    planFor("plugin", {
      gproj: p.gproj,
      plugin: {
        name: PLUGIN,
        args: { addonPath: p.sandboxDir, ciInfoDst: join(p.runDir, CI_INFO_FILE) },
      },
    }),
    p,
  );
}

/** The DEC-047 L7 "one more form": the output folder in ONE `-buildData=<dir>` token. */
export function buildDataArgv(p: CliPaths): string[] {
  return withScratch(
    [
      ...buildWorkbenchArgs({ gproj: p.gproj }),
      "-wbModule=ResourceManager",
      `-buildData=${join(p.runDir, BUILD_DATA_DIR)}`,
    ],
    p,
  );
}

/** The first argv entry that is a publish, pack or refused verb, or null. */
export function forbiddenInArgv(argv: readonly string[]): string | null {
  return argv.find((a) => NEVER_IN_ARGV.test(a)) ?? null;
}

/** Paths a one-token `-key=<path>` form carries must hold no space (cli-runner.ts header). */
export function spaceProblem(p: CliPaths): string | null {
  for (const [name, v] of [
    ["sandbox", p.sandboxDir],
    ["run folder", p.runDir],
  ] as const) {
    if (/\s/.test(v))
      return `the ${name} path holds a space; a -key=<path> token would be cut there`;
  }
  return null;
}

function result(r: RunResult): Record<string, unknown> {
  const tail = (s: string): string => s.split(/\r?\n/).slice(-30).join("\n");
  return {
    exitCode: r.exitCode,
    signal: r.signal,
    durationMs: r.durationMs,
    timedOut: r.timedOut,
    earlySignal: r.earlySignal,
    stdoutTail: tail(r.stdout),
    stderrTail: tail(r.stderr),
  };
}

function allowListed(policy: CliPolicy, entry: string): boolean {
  const [kind, name] = entry.split(":");
  return kind === "verb" ? policy.verbs.has(name) : policy.plugins.has(name);
}

/** Append the argv to `<run>/argv.jsonl` BEFORE the spawn, so a cut-off spawn is still listed. */
function recordArgv(ctx: StepContext, step: string, argv: string[]): void {
  ctx.deps.log(`spawn: ${argv.join(" ")}`);
  const clean = argv.map((a) => toPlaceholders(a, ctx.opts.ph));
  appendFileSync(
    join(ctx.opts.paths.runDir, "argv.jsonl"),
    JSON.stringify({ step, argv: clean }) + "\n",
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────

export function buildSteps(): StepDef[] {
  const spawnStep = (o: {
    id: string;
    title: string;
    proves: string;
    entry: string;
    argv: (p: CliPaths) => string[];
    timeoutMs: number;
    validate?: boolean;
    judge: (
      r: RunResult,
      ctx: StepContext,
    ) => { status: StepStatus; extra?: Record<string, unknown> };
  }): StepDef => ({
    id: o.id,
    title: o.title,
    proves: o.proves,
    argv: o.argv,
    run: async (ctx) => {
      if (ctx.prior("c-00-preflight")?.status !== "pass") {
        throw new StopBattery("c-00-preflight has not passed in this run folder");
      }
      const policy = ctx.deps.cliPolicy();
      if (!allowListed(policy, o.entry)) {
        throw new StopBattery(`${o.entry} is not on cli_run.allow_list (${policy.source})`);
      }
      const pids = ctx.deps.workbenchPids();
      if (pids.length) throw new StopBattery("a Workbench image is running", { pids });
      const argv = o.argv(ctx.opts.paths);
      const bad = forbiddenInArgv(argv);
      if (bad) throw new StopBattery(`argv carries ${bad}`);
      recordArgv(ctx, o.id, argv);
      const r = await ctx.deps.run({
        args: argv,
        timeoutMs: o.timeoutMs,
        ...(o.validate
          ? { pollSignal: { intervalMs: TIMEOUTS.pollMs, check: ctx.deps.validateCheck() } }
          : {}),
      });
      const j = o.judge(r, ctx);
      return {
        status: j.status,
        argv,
        evidence: { entry: o.entry, ...result(r), ...(j.extra ?? {}) },
      };
    },
  });

  return [
    {
      id: "c-00-preflight",
      title: "headless pre-flight: no Workbench, the lease ours, the paths one-token safe",
      proves:
        "plan 5.1 / 5.3 (the headless pre-flight variant, as S-A), cli-runner headlessSpawnBlocker",
      argv: () => null,
      run: async (ctx) => {
        const p = ctx.opts.paths;
        const pids = ctx.deps.workbenchPids();
        const blocker = headlessSpawnBlocker(pids);
        const evidence = {
          pids,
          blocker,
          laneHoldsLease: ctx.deps.laneHoldsLease(),
          gprojExists: ctx.deps.exists(p.gproj),
          forceSettings: p.forceSettings,
          iniProblem:
            outsideArtifacts(p.forceSettings, ctx.opts.artifactsRoot) ??
            (!/\.ini$/i.test(p.forceSettings)
              ? "the scratch settings file is not an .ini"
              : !ctx.deps.exists(p.forceSettings)
                ? "the scratch ini does not exist (build it as S-F did)"
                : null),
          runDirProblem: outsideArtifacts(p.runDir, ctx.opts.artifactsRoot),
          space: spaceProblem(p),
          allowList: [...ctx.deps.cliPolicy().verbs]
            .map((v) => `verb:${v}`)
            .concat([...ctx.deps.cliPolicy().plugins].map((v) => `plugin:${v}`)),
        };
        if (blocker) throw new StopBattery(blocker, evidence);
        if (!evidence.laneHoldsLease)
          throw new StopBattery("the lane does not hold the lease", evidence);
        if (!evidence.gprojExists) throw new StopBattery("the sandbox .gproj is missing", evidence);
        if (evidence.space) throw new StopBattery(evidence.space, evidence);
        if (evidence.iniProblem) throw new StopBattery(evidence.iniProblem, evidence);
        if (evidence.runDirProblem) throw new StopBattery(evidence.runDirProblem, evidence);
        ctx.deps.makeDir(p.runDir);
        return { status: "pass", evidence };
      },
    },
    spawnStep({
      id: "c-01-open-project",
      title: "openProject: -gproj -exitAfterInit exits by itself",
      proves: "DEC-047 L7 / U1 (DEC-033), wb_cli_run verb:openProject",
      entry: "verb:openProject",
      argv: openProjectArgv,
      timeoutMs: TIMEOUTS.selfExitMs,
      judge: (r) => ({ status: r.exitCode === 0 && !r.timedOut ? "pass" : "fail" }),
    }),
    spawnStep({
      id: "c-02-build-scripts",
      title: "buildScripts: -gproj -wbModule=ScriptEditor -validate=PC ended on 'Script validation successful.'",
      proves: "DEC-047 L7 (DEC-035), wb_cli_run verb:buildScripts",
      entry: "verb:buildScripts",
      argv: buildScriptsArgv,
      timeoutMs: TIMEOUTS.validateMs,
      validate: true,
      judge: (r) => ({ status: r.earlySignal === "successful" ? "pass" : "fail" }),
    }),
    spawnStep({
      id: "c-03-addon-build-info",
      title: "AddonBuildInfoTool: -plugin= with -addonPath= and -ciInfoDst= one token each",
      proves: "DEC-047 L7 (DEC-037, S-A-10), wb_cli_run plugin:AddonBuildInfoTool",
      entry: `plugin:${PLUGIN}`,
      argv: addonBuildInfoArgv,
      timeoutMs: TIMEOUTS.selfExitMs,
      judge: (r, ctx) => {
        const written = ctx.deps.exists(join(ctx.opts.paths.runDir, CI_INFO_FILE));
        return {
          status: r.exitCode === 0 && !r.timedOut && written ? "pass" : "fail",
          extra: { ciInfoWritten: written },
        };
      },
    }),
    {
      id: "c-04-build-data",
      title: "-buildData=<dir> in one token, idle timeout 300 s, ended by the harness",
      proves: "DEC-047 L7 ('-buildData unresolved, one more form to try'; S-A-4, S-A-8)",
      argv: buildDataArgv,
      run: async (ctx) => {
        if (ctx.prior("c-00-preflight")?.status !== "pass") {
          throw new StopBattery("c-00-preflight has not passed in this run folder");
        }
        const pids = ctx.deps.workbenchPids();
        if (pids.length) throw new StopBattery("a Workbench image is running", { pids });
        const argv = buildDataArgv(ctx.opts.paths);
        validateArgs(argv, [...BUILD_DATA_FLAGS]);
        const bad = forbiddenInArgv(argv);
        if (bad) throw new StopBattery(`argv carries ${bad}`);
        const out = join(ctx.opts.paths.runDir, BUILD_DATA_DIR);
        ctx.deps.makeDir(out);
        let last = ctx.deps.activityBytes(out);
        let lastChange = ctx.deps.now();
        recordArgv(ctx, "c-04-build-data", argv);
        const r = await ctx.deps.run({
          args: argv,
          timeoutMs: TIMEOUTS.buildDataCapMs,
          pollSignal: {
            intervalMs: TIMEOUTS.pollMs,
            check: () => {
              const b = ctx.deps.activityBytes(out);
              if (b !== last) {
                last = b;
                lastChange = ctx.deps.now();
                return null;
              }
              return ctx.deps.now() - lastChange >= TIMEOUTS.buildDataIdleMs
                ? "idle-timeout"
                : null;
            },
          },
        });
        const files = ctx.deps.listDir(out);
        return {
          status: "observed",
          argv,
          evidence: {
            entry:
              "not on cli_run.allow_list (DEC-047 L7: unresolved); runWorkbench + validateArgs",
            ...result(r),
            endedBy:
              r.earlySignal === "idle-timeout"
                ? "harness (idle)"
                : r.timedOut
                  ? "harness (cap)"
                  : "itself",
            outputFiles: files.length,
            outputSample: files.slice(0, 20),
            built: files.length > 0,
          },
        };
      },
    },
  ];
}

// ── Plan, outline ────────────────────────────────────────────────────────────

/** Placeholder paths of the printed plan (the dry run's sandbox test accepts `<sandbox>/...gproj`). */
export const PLAN_PATHS: CliPaths = {
  sandboxDir: "<sandbox>",
  gproj: `<sandbox>/${SANDBOX_NAME}.gproj`,
  runDir: "<run>",
  forceSettings: "<run>/p3-2-cli.ini",
};

export function buildActionPlan(
  steps: StepDef[] = buildSteps(),
  p: CliPaths = PLAN_PATHS,
): PlanAction[] {
  const out: PlanAction[] = [];
  for (const s of steps) {
    const argv = s.argv(p);
    if (!argv) continue;
    out.push({
      kind: "launch",
      target: { gproj: p.gproj } as unknown as PlanAction["target"],
      args: argv.map((a) => a.replace(/\\/g, "/")),
      step: s.id,
      headless: true,
    } as PlanAction);
  }
  return out;
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: CLI battery (${SCRIPT_PATH}), ${steps.length} steps, NO Workbench open`,
    ...steps.map((s) => {
      const a = s.argv(PLAN_PATHS);
      return `  ${s.id}: ${s.title} (proves ${s.proves})${a ? `\n      argv: ${a.join(" ")}` : ""}`;
    }),
  ];
}

// ── Runner ───────────────────────────────────────────────────────────────────

export function recordPath(runDir: string, id: string): string {
  return join(runDir, `${id}.json`);
}

export function readRecord(runDir: string, id: string): StepRecord | null {
  const p = recordPath(runDir, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as StepRecord;
  } catch {
    return null;
  }
}

export function selectSteps(
  steps: StepDef[],
  sel: { from?: string; only?: string },
): StepDef[] | string {
  if (sel.only && sel.from) return "--only excludes --from";
  const id = sel.only ?? sel.from;
  if (!id) return steps;
  const at = steps.findIndex((s) => s.id === id);
  if (at === -1) return `${id} is not a step id`;
  return sel.only ? [steps[at]] : steps.slice(at);
}

/** Steps with a `.started` marker, no record and no owner acknowledgement. */
export function danglingMarkers(runDir: string): string[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .filter((f) => f.endsWith(".started"))
    .map((f) => f.slice(0, -".started".length))
    .filter(
      (id) =>
        !existsSync(recordPath(runDir, id)) && !existsSync(acknowledgedMarkerPath(runDir, id)),
    )
    .sort();
}

/** The owner's acknowledgement of a dangling marker: the step is never re-run, the rest may go on. */
export function acknowledge(runDir: string, id: string, now: Date = new Date()): string {
  if (!existsSync(startedMarkerPath(runDir, id))) return `no started marker for ${id}`;
  if (existsSync(recordPath(runDir, id))) return `${id} has a record; nothing to acknowledge`;
  writeFileSync(
    acknowledgedMarkerPath(runDir, id),
    JSON.stringify({ step: id, acknowledged_at: now.toISOString(), by: "owner" }, null, 2) + "\n",
    { encoding: "utf-8", flag: "wx" },
  );
  return `acknowledged ${id}`;
}

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

export async function runBattery(
  steps: StepDef[],
  deps: CliDeps,
  opts: CliOptions,
): Promise<BatteryReport> {
  const runDir = opts.paths.runDir;
  mkdirSync(runDir, { recursive: true });
  const records: StepRecord[] = [];
  const write = (r: StepRecord): void => {
    const clean = JSON.parse(toPlaceholders(JSON.stringify(r), opts.ph)) as StepRecord;
    writeFileSync(recordPath(runDir, r.step), JSON.stringify(clean, null, 2) + "\n", {
      encoding: "utf-8",
      flag: "wx",
    });
    records.push(clean);
    if (opts.evidenceDir) {
      writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${r.step}`,
          build: opts.build,
          result_summary: `${r.step}: ${r.status}${r.stop ? ` (${r.stop})` : ""}`,
          artifacts: [recordPath(runDir, r.step)],
        },
        opts.ph,
      );
    }
  };
  const ctx: StepContext = { deps, opts, prior: (id) => readRecord(runDir, id) };
  const dangling = danglingMarkers(runDir);
  if (dangling.length) {
    return {
      exit: EXIT.refused,
      records,
      stoppedAt: dangling[0],
      message:
        `${dangling.join(", ")} started and never recorded: a spawn may have run (see argv.jsonl). ` +
        "Check no Workbench image runs, then the owner acknowledges with " +
        "`cli.live.ts acknowledge --run-dir <run> --step <id> --owner-ack`; it is never re-run (plan 5.3)",
    };
  }
  for (const s of steps) {
    if (existsSync(recordPath(runDir, s.id)) || existsSync(startedMarkerPath(runDir, s.id))) {
      return {
        exit: EXIT.refused,
        records,
        stoppedAt: s.id,
        message: `${s.id} already has a record in this run folder: a step is never run twice (plan 5.3)`,
      };
    }
    deps.log(`step ${s.id}: ${s.title}`);
    const startedAt = new Date(deps.now()).toISOString();
    writeStartedMarker(
      startedMarkerPath(runDir, s.id),
      { step: s.id, started_at: startedAt, pid: null, created: null },
      true,
    );
    try {
      const out = await s.run(ctx);
      write({
        step: s.id,
        title: s.title,
        proves: s.proves,
        status: out.status,
        startedAt,
        endedAt: new Date(deps.now()).toISOString(),
        ...(out.argv ? { argv: out.argv } : {}),
        evidence: out.evidence,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      write({
        step: s.id,
        title: s.title,
        proves: s.proves,
        status: "stopped",
        startedAt,
        endedAt: new Date(deps.now()).toISOString(),
        evidence: e instanceof StopBattery ? e.evidence : {},
        stop: message,
      });
      return { exit: EXIT.stopped, records, stoppedAt: s.id, message };
    }
  }
  return { exit: EXIT.done, records, stoppedAt: null, message: null };
}

// ── Real dependencies ────────────────────────────────────────────────────────

function treeBytes(dir: string): number {
  let n = 0;
  if (!existsSync(dir)) return 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      const st = statSync(p);
      n += st.isDirectory() ? treeBytes(p) : st.size;
    } catch {
      // a file that vanished between the list and the stat
    }
  }
  return n;
}

/**
 * Wrap the tracker's async check as the -validate probe. Until 2026-11-14 the battery tested the
 * returned promise with `typeof v === "string"`, so the verdict never reached runWorkbench and
 * c-02 could only time out (cli-battery-1.9.md).
 */
export function validateProbe(
  check: (ctx: { pid?: number }) => Promise<string | null>,
): (ctx: { pid?: number }) => Promise<string | null> {
  return async (ctx) => {
    const v = await check(ctx);
    return typeof v === "string" ? v : null;
  };
}

export function realDeps(lane: Lane): CliDeps {
  const config = loadConfig();
  const newestLogBytes = (): number => {
    try {
      const dirs = readdirSync(config.logsPath)
        .filter((d) => d.startsWith("logs_"))
        .sort();
      const last = dirs[dirs.length - 1];
      return last ? treeBytes(join(config.logsPath, last)) : 0;
    } catch {
      return 0;
    }
  };
  return {
    workbenchPids: () => runningWorkbenchPids(),
    laneHoldsLease: () => lane.holdsLease(),
    cliPolicy: () => loadCliPolicy(),
    run: (o) =>
      runWorkbench({ workbenchPath: config.workbenchPath, gamePath: config.gamePath, ...o }),
    validateCheck: () => {
      const t = new ValidateRunTracker(config.logsPath, snapshotSessionDirs(config.logsPath));
      return validateProbe(t.check);
    },
    activityBytes: (dir) => treeBytes(dir) + newestLogBytes(),
    exists: (p) => existsSync(p),
    makeDir: (p) => mkdirSync(p, { recursive: true }),
    listDir: (p) => (existsSync(p) ? readdirSync(p) : []),
    now: () => Date.now(),
    log: (l) => console.log(l),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "out",
  "outline",
  "id",
  "sandbox",
  "run-dir",
  "from",
  "only",
  "evidence-dir",
  "lease-path",
  "marker-path",
  "build",
  "step",
  "force-settings",
] as const;
const FLAGS = ["really", "owner-ack"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: CliDeps;
  leaseHeld?: boolean;
  artifactsRoot?: string;
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  if (argv.some((a) => a.toLowerCase() === NEVER_FLAG.toLowerCase())) {
    say(`refused: ${NEVER_FLAG} is never part of sitting P3-2`);
    return EXIT.usage;
  }
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const unknown = [...args.flags].filter((f) => !(FLAGS as readonly string[]).includes(f));
  if (unknown.length) {
    say(`unknown option(s): ${unknown.map((f) => `--${f}`).join(", ")}`);
    return EXIT.usage;
  }
  const o = args.options;
  const steps = buildSteps();
  if (args.positional[0] === "acknowledge") {
    if (!o["run-dir"] || !o.step || !args.flags.has("owner-ack")) {
      say("acknowledge needs --run-dir <run> --step <id> --owner-ack (the owner's word)");
      return EXIT.usage;
    }
    say(acknowledge(resolve(o["run-dir"]), o.step));
    return EXIT.done;
  }
  const selected = selectSteps(steps, { from: o.from, only: o.only });
  if (typeof selected === "string") {
    say(selected);
    return EXIT.usage;
  }
  const plan = buildActionPlan(steps);
  const check = checkPlan(plan, over.policy ?? loadPolicy(), { script: SCRIPT_PATH });
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps).join("\n") + "\n", "utf-8");
  const really = args.flags.has("really");
  if (!really) {
    for (const l of sessionOutline(steps)) say(l);
    say(formatResult(check));
    return check.ok ? EXIT.done : EXIT.refused;
  }
  if (!check.ok) {
    say(formatResult(check));
    return EXIT.refused;
  }
  if (!o.id || !o.sandbox || !o["force-settings"]) {
    say(
      "--really needs --id <lane id>, --sandbox <the 2.0 sandbox folder> and " +
        "--force-settings <the scratch ini inside the artifacts folder>",
    );
    return EXIT.usage;
  }
  const sandboxDir = resolve(o.sandbox);
  if (basename(sandboxDir) !== SANDBOX_NAME) {
    say(`refused: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}`);
    return EXIT.refused;
  }
  const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  const gate = liveGateReason({
    really,
    platform: over.platform ?? process.platform,
    leaseHeld: over.leaseHeld ?? lane.holdsLease(),
  });
  if (gate) {
    say(gate);
    return EXIT.refused;
  }
  const runDir = resolve(
    o["run-dir"] ??
      join(
        artifactsDir(),
        "sessions",
        "P3-2",
        `cli-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      ),
  );
  const artifactsRoot = over.artifactsRoot ?? artifactsDir();
  const forceSettings = resolve(o["force-settings"]);
  for (const [what, dir] of [
    ["--run-dir", runDir],
    ["--force-settings", forceSettings],
  ] as const) {
    const outside = outsideArtifacts(dir, artifactsRoot);
    if (outside) {
      say(toPlaceholders(`refused: ${what} ${outside} (plan 5.3)`, ph));
      return EXIT.refused;
    }
  }
  const deps = over.deps ?? realDeps(lane);
  if (!over.deps) lane.startHeartbeat();
  try {
    const r = await runBattery(selected, deps, {
      paths: {
        sandboxDir,
        gproj: join(sandboxDir, `${SANDBOX_NAME}.gproj`),
        runDir,
        forceSettings,
      },
      artifactsRoot,
      evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
      ph: { ...ph, sandbox: sandboxDir },
      build: o.build ?? "unrecorded",
    });
    for (const rec of r.records) say(`${rec.step}: ${rec.status}`);
    if (r.message) say(toPlaceholders(`STOPPED: ${r.message}`, ph));
    say(toPlaceholders(`run folder: ${runDir}`, ph));
    return r.exit;
  } finally {
    lane.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}
