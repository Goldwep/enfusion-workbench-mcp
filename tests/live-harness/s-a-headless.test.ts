import { describe, it, expect, vi } from "vitest";
import {
  IDLE_CPU_PERCENT,
  RUN_PATH_SPACE_REFUSAL,
  SHORT_PATH_REFUSAL,
  WORKBENCH_MODULE_FAILED_LINE,
  parseShortPath,
  selectSteps,
  shortPathCommand,
  workbenchModuleFailed,
} from "../../scripts/live/s-a-headless.js";
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
import { acquireLease } from "../../src/workbench/lease.js";
import type { WbDepsCheck } from "../../src/workbench/wb-deps.js";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { Lane } from "../../scripts/live/lane.js";
import { ARTIFACTS_ENV, REPO_ROOT } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import {
  FORCED_KILLS_FILE,
  readForcedKills,
  recordForcedKill,
} from "../../scripts/live/postflight.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { takeSnapshot } from "../../scripts/live/snapshot.js";
import {
  ADDON_NOT_FOUND_MESSAGE,
  BASELINE_FILE,
  DECOY_NAME,
  DEFAULT_QUEUE,
  IDLE_QUIET_MS,
  INVOCATION_MARGIN_MS,
  KILL_WAIT_MS,
  LAUNCHER_QUIET_MS,
  MAX_RECOVERIES,
  NODE_FILE_OPS,
  POLL_MS,
  PlantError,
  SCRIPT_PATH,
  STEPS,
  S_A_8_RETIRED,
  TOP_WINDOWS_SCRIPT,
  U14_BROKEN_FILE,
  U14_FOLDER,
  WINDOW_PROBE_ERROR_LIMIT,
  addonsDirFromDeps,
  decoyGproj,
  acknowledgedMarkerPath,
  decoyPreselectionRefusal,
  deniedSwitch,
  descendantPlan,
  echoMatches,
  invocationWorstCaseMs,
  killOwnWorkbench,
  localMsOfDay,
  main,
  outsideArtifacts,
  plantU14,
  readLogFacts,
  readProjectLists,
  recoverRecords,
  registration,
  rollbackU14,
  runAcknowledge,
  runDecoy,
  runOwnPids,
  runRecover,
  runRollback,
  runSession,
  runStep,
  sessionLogBornAfter,
  spawnWithExit,
  startedMarkerPath,
  stepArgs,
  stepById,
  filesNamedIn,
  type KillResult,
  type PlantManifest,
  type ProcRow,
  type ProcessExit,
  type ProjectListFile,
  type RunState,
  type SessionConfig,
  type SessionDeps,
  type StepRecord,
  type TopWindow,
} from "../../scripts/live/s-a-headless.js";

const policy = loadPolicy();

/** A fake clock earlier than any real file time, so files the tests write count as "after launch". */
const T0 = Date.parse("2020-01-01T08:00:00Z");

const BASE_ONLY = {
  gprojPath: "x",
  wbAddonsDir: "x",
  workshopDir: null,
  findings: [
    { guid: "58D0FB3206B6F859", status: "wb-visible", locationKind: "base-game", gprojPath: "g" },
  ],
  allWbVisible: true,
  scannedRoots: [],
} as WbDepsCheck;

// ── A scripted Workbench ─────────────────────────────────────────────────────

interface Scenario {
  /** Project named by the opened-project line; null: no such line. */
  opened?: string | null;
  openedAfterMs?: number;
  initAfterMs?: number;
  /** `Workbench Create Engine took` (default 100 ms). */
  engineAfterMs?: number;
  /** `CLI Params:` echo (default 200 ms). */
  echoAfterMs?: number;
  /** The launcher holds: the log stops after the engine marker (no echo, no init, no project). */
  hold?: boolean;
  /** With `hold`: not even the engine marker (an empty log). */
  noEngineMarker?: boolean;
  /** Self-exit after spawn; null: never exits by itself. */
  exitAfterMs?: number | null;
  exitCode?: number;
  launcherAfterMs?: number;
  /** The launcher window disappears at this age. */
  launcherUntilMs?: number;
  modalAfterMs?: number;
  /** After the exit, another Workbench pid keeps running. */
  respawnPid?: number;
  scriptErrors?: string[];
  /** Extra SCRIPT lines (default level) once the project opened. */
  scriptLines?: string[];
  /** findSessionLog hands back the previous launch's log. */
  staleLog?: boolean;
  killThrows?: boolean;
  /** The kill "succeeds" but the process keeps running. */
  killNoop?: boolean;
  /** After the kill, a CrashReporter.exe is running. */
  crashAfterKill?: boolean;
  /** workbenchPids throws once the process has exited. */
  pidsThrowAfterExit?: boolean;
  spawnThrows?: boolean;
  onSpawn?: (args: string[], cfg: SessionConfig) => void;
  /** Child Workbench images of the started pid (a launcher stub's engine). */
  childPids?: number[];
  /** The launcher window belongs to the first child, not to the started pid. */
  launcherOnChild?: boolean;
  /** The window probe of the started pid fails on these polls (1-based), or on every poll. */
  probeErrors?: number[] | "always";
  /** The `CLI Params:` echo leaves out `-exitAfterInit` (a bare flag): an echo mismatch. */
  echoWithoutBareFlags?: boolean;
  /** The kill finds the pid already gone (it exited on its own just before). */
  killFindsGone?: boolean;
  /** The kill leaves these descendants running (another image, or created before the parent). */
  killLeaves?: Array<{ pid: number; image: string }>;
  /** The child images are still terminating for this long after the started pid exited. */
  childDyingMs?: number;
  /**
   * CPU time the started pid uses per second of its age, as the process table reports it
   * (`cpu_ms`); undefined: the table carries no CPU time (the idle rule never decides).
   */
  cpuMsPerSec?: number;
  /** After the opened-project line, one more log line every 10 s until this age. */
  logGrowsUntilMs?: number;
}

interface Launch {
  pid: number;
  args: string[];
  cwd: string;
  spawnedAt: number;
  scenario: Scenario;
  logPath: string;
  exit: ProcessExit | null;
  resolve: (e: ProcessExit) => void;
  released: boolean;
  /** Window probes of the started pid so far. */
  probes: number;
  /** World time of the exit. */
  exitAt: number | null;
}

/** The newest retained session log before any launch: the owner's decoy open. */
const PRIOR_LOG = join("logs", "logs_prior", "console.log");

function hhmmss(epochMs: number): string {
  const ms = localMsOfDay(epochMs);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
}

class World {
  t = T0;
  launches: Launch[] = [];
  kills: number[] = [];
  /** Whether each kill was asked to end descendants too, in order. */
  killDescendants: boolean[] = [];
  /** The options of each kill, in order (m-2: the creation time it must still have). */
  killOpts: Array<{ descendants?: boolean; expectCreated?: number | null }> = [];
  captures: string[] = [];
  /** The launcher's project-list files (set by the fixture: both app numbers, decoy first). */
  lists: ProjectListFile[] = [];
  /** The project the newest retained session log (before any launch) names. */
  priorOpened: string | null = DECOY_NAME;
  windowLists = 0;
  lines: string[] = [];
  preRunning: number[] = [];
  crashPids: number[] = [];
  portPids: number[] = [];
  /** The process table throws (the creation times cannot be read). */
  tableThrows = false;
  spawnAttempts = 0;
  preflightCalls: number[][] = [];
  extraWindows: TopWindow[] = [];
  images = new Map<number, string>();
  constructor(
    private readonly scenarios: Scenario[],
    private readonly cfgRef: () => SessionConfig,
  ) {}

  get cur(): Launch | undefined {
    return this.launches[this.launches.length - 1];
  }

  private finish(l: Launch, e: ProcessExit): void {
    if (l.exit) return;
    l.exit = e;
    l.exitAt = this.t;
    l.resolve(e);
  }

  /** Child images of an exited launch that are still terminating. */
  private dying(l: Launch): number[] {
    const ms = l.scenario.childDyingMs ?? 0;
    return l.exit && l.exitAt !== null && this.t < l.exitAt + ms
      ? [...(l.scenario.childPids ?? [])]
      : [];
  }

  private tick(): void {
    const l = this.cur;
    if (!l || l.exit) return;
    const s = l.scenario;
    if (
      s.exitAfterMs !== undefined &&
      s.exitAfterMs !== null &&
      this.t - l.spawnedAt >= s.exitAfterMs
    ) {
      this.finish(l, { code: s.exitCode ?? 0, signal: null });
    }
  }

  logText(path: string): string {
    if (path === PRIOR_LOG) {
      return this.priorOpened === null
        ? "07:00:00.000 ENGINE       : Workbench Init Engine\n"
        : `07:00:01.000 DEFAULT      : Using autosave directory: C:/p/Projects/${this.priorOpened}/autosaves\n`;
    }
    const l = this.launches.find((x) => x.logPath === path);
    if (!l) return "";
    const s = l.scenario;
    const age = (l.exit ? Number.POSITIVE_INFINITY : this.t - l.spawnedAt) as number;
    const at = (off: number): string => hhmmss(l.spawnedAt + off);
    const out: string[] = [];
    const engine = s.engineAfterMs ?? 100;
    if (!(s.hold && s.noEngineMarker) && age >= engine) {
      out.push(`${at(engine)} ENGINE       : Workbench Create Engine took 900 ms`);
    }
    if (s.hold) return out.length ? out.join("\n") + "\n" : "";
    const echo = s.echoAfterMs ?? 200;
    const echoed = s.echoWithoutBareFlags ? l.args.filter((a) => a !== "-exitAfterInit") : l.args;
    if (age >= echo) out.push(`${at(echo)} ENGINE       : CLI Params: ${echoed.join(" ")}`);
    const init = s.initAfterMs ?? 3_000;
    const opened = s.openedAfterMs ?? 6_000;
    if (age >= init) out.push(`${at(init)} ENGINE       : Workbench Init Engine`);
    if (s.opened && age >= opened) {
      out.push(
        `${at(opened)} DEFAULT      : Using autosave directory: C:/p/Projects/${s.opened}/autosaves`,
      );
      for (const e of s.scriptErrors ?? []) out.push(`${at(opened + 10)} SCRIPT    (E): ${e}`);
      for (const e of s.scriptLines ?? []) out.push(`${at(opened + 20)} SCRIPT       : ${e}`);
      if (s.logGrowsUntilMs !== undefined) {
        for (let k = opened + 10_000; k <= Math.min(age, s.logGrowsUntilMs); k += 10_000) {
          out.push(`${at(k)} DEFAULT      : still working (test)`);
        }
      }
    }
    return out.join("\n") + "\n";
  }

  deps(): SessionDeps {
    return {
      platform: "win32",
      now: () => this.t,
      sleep: async (ms) => {
        this.t += ms;
        this.tick();
      },
      exec: (file) => {
        throw new Error(`unexpected exec of ${file}`);
      },
      powershell: () => Promise.reject(new Error("unexpected PowerShell")),
      spawn: (_exe, args, cwd) => {
        // One scenario per spawn attempt, a failed one included.
        const scenario = this.scenarios[this.spawnAttempts++];
        if (!scenario) throw new Error(`unexpected launch #${this.spawnAttempts}`);
        if (scenario.spawnThrows) throw new Error("CreateProcess failed (test)");
        let resolve!: (e: ProcessExit) => void;
        const exited = new Promise<ProcessExit>((r) => (resolve = r));
        const pid = 1001 + this.launches.length;
        const l: Launch = {
          pid,
          args,
          cwd,
          spawnedAt: this.t,
          scenario,
          logPath: join("logs", `logs_${pid}`, "console.log"),
          exit: null,
          resolve,
          released: false,
          probes: 0,
          exitAt: null,
        };
        this.launches.push(l);
        scenario.onSpawn?.(args, this.cfgRef());
        return { pid, exited, release: () => (l.released = true) };
      },
      windowsOfPid: async (pid) => {
        const child = this.launches.find((x) => x.scenario.childPids?.includes(pid));
        const l = child ?? this.launches.find((x) => x.pid === pid)!;
        const s = l.scenario;
        if (!child) {
          l.probes++;
          if (s.probeErrors === "always" || s.probeErrors?.includes(l.probes)) {
            return {
              titles: [],
              launcher: false,
              missingDepsModal: false,
              error: "powershell probe failed: Add-Type could not compile (test)",
            };
          }
        }
        // The launcher window and the modal belong to the child when `launcherOnChild`.
        const owner = s.launcherOnChild ? child !== undefined : child === undefined;
        const age = this.t - l.spawnedAt;
        const launcher =
          owner &&
          s.launcherAfterMs !== undefined &&
          age >= s.launcherAfterMs &&
          (s.launcherUntilMs === undefined || age < s.launcherUntilMs);
        const modal = owner && s.modalAfterMs !== undefined && age >= s.modalAfterMs;
        const titles = [
          ...(launcher ? ["Enfusion Workbench Launcher"] : []),
          ...(modal ? ["Missing Addon Dependencies"] : []),
        ];
        return { titles, launcher, missingDepsModal: modal, error: null };
      },
      childWorkbenchPids: async (pid) => {
        const l = this.launches.find((x) => x.pid === pid);
        return l && !l.exit ? [...(l.scenario.childPids ?? [])] : [];
      },
      processTable: async (): Promise<ProcRow[]> => {
        if (this.tableThrows) throw new Error("Get-CimInstance failed (test)");
        return this.launches
          .filter((l) => !l.exit)
          .flatMap((l) => [
            {
              pid: l.pid,
              ppid: 4,
              name: "ArmaReforgerWorkbenchSteamDiag.exe",
              created: l.spawnedAt,
              ...(l.scenario.cpuMsPerSec === undefined
                ? {}
                : {
                    cpu_ms: Math.floor(((this.t - l.spawnedAt) / 1000) * l.scenario.cpuMsPerSec),
                  }),
            },
            ...(l.scenario.childPids ?? []).map((c) => ({
              pid: c,
              ppid: l.pid,
              name: "ArmaReforgerWorkbenchSteamDiag.exe",
              created: l.spawnedAt + 50,
            })),
          ]);
      },
      listTopWindows: async () => {
        this.windowLists++;
        return [
          { pid: this.cur?.pid ?? 0, className: "TestClass", title: "Workbench test window" },
          { pid: 99, className: "Other", title: "a private document title" },
          ...this.extraWindows,
        ];
      },
      captureDesktop: async (label, dir) => {
        this.captures.push(label);
        return { ok: true, skipped: false, path: join(dir, `${label}.png`), detail: "test" };
      },
      findSessionLog: (after) => {
        const l = this.cur;
        if (!l || l.spawnedAt < after) return null;
        if (l.scenario.staleLog) return this.launches[this.launches.length - 2]?.logPath ?? null;
        return l.logPath;
      },
      newestSessionLog: () => this.cur?.logPath ?? PRIOR_LOG,
      readLog: (p) => this.logText(p),
      workbenchPids: () => {
        const l = this.cur;
        if (!l) return [...this.preRunning];
        if (!l.exit) return [l.pid, ...(l.scenario.childPids ?? [])];
        if (l.scenario.pidsThrowAfterExit) throw new Error("tasklist failed (test)");
        return [...this.dying(l), ...(l.scenario.respawnPid ? [l.scenario.respawnPid] : [])];
      },
      crashReporterPids: () => [...this.crashPids],
      portListeners: () => [...this.portPids],
      imageOfPid: (pid) =>
        this.images.get(pid) ??
        (this.launches.some((l) => this.dying(l).includes(pid))
          ? "ArmaReforgerWorkbenchSteamDiag.exe"
          : null),
      kill: async (pid, opts): Promise<KillResult> => {
        const l = this.launches.find((x) => x.pid === pid)!;
        if (l.scenario.killThrows) throw new Error(`pid ${pid} is notepad.exe (test)`);
        const none = { ended_pids: [], left: [], descendants_unknown: false };
        if (l.scenario.killFindsGone) {
          this.finish(l, { code: 0, signal: null });
          return {
            ...none,
            ended: false,
            detail: `pid ${pid} is no longer running; nothing killed`,
          };
        }
        this.kills.push(pid);
        this.killDescendants.push(opts?.descendants !== false);
        this.killOpts.push({ ...opts });
        if (l.scenario.crashAfterKill) this.crashPids = [555];
        if (!l.scenario.killNoop) this.finish(l, { code: 1, signal: null });
        const children = opts?.descendants === false ? [] : (l.scenario.childPids ?? []);
        return {
          ended: true,
          ended_pids: [...children, pid],
          left: [...(l.scenario.killLeaves ?? [])],
          descendants_unknown: false,
          detail: [...children, pid].map((p) => `taskkill /PID ${p} /F (test)`).join("; "),
        };
      },
      fs: NODE_FILE_OPS,
      checkDeps: () => BASE_ONLY,
      projectLists: () => this.lists.map((l) => ({ ...l, entries: [...l.entries] })),
      snapshot: (root, paths) => takeSnapshot(root, paths),
      preflight: async (ctx, skip) => {
        this.preflightCalls.push([...skip].sort());
        const n = this.preflightCalls.length;
        if (!skip.has(6))
          ctx.state.snapshotFile = join(ctx.artifactsDir, `snapshot-before-${n}.json`);
        if (!skip.has(5))
          ctx.state.registryExport = join(ctx.artifactsDir, `registry-before-${n}.reg`);
        return { ok: true, results: [] };
      },
      log: (line) => this.lines.push(line),
    };
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface Fixture {
  root: string;
  cfg: SessionConfig;
  world: World;
  deps: SessionDeps;
}

function fixture(
  scenarios: Scenario[],
  over: Partial<SessionConfig> = {},
  holdLease = true,
): Fixture {
  const root = mkdtempSync(join(tmpdir(), "emcp-sa-"));
  const sandbox = join(root, "EMCP2_sandbox");
  mkdirSync(sandbox);
  writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), 'GameProject {\n ID "EMCP2_sandbox"\n}\n');
  writeFileSync(join(sandbox, ".gitignore"), "resourceDatabase.rdb\n");
  const decoy = join(root, DECOY_NAME);
  mkdirSync(decoy);
  writeFileSync(decoyGproj(decoy), 'GameProject {\n ID "EMCP2_decoy"\n}\n');
  const handlers = join(root, "handlers");
  mkdirSync(handlers);
  writeFileSync(join(handlers, "EMCP_WB_Ping.c"), "class EMCP_WB_Ping {}\n");
  writeFileSync(join(handlers, "EMCP_WB_Common.c"), "class EMCP_WB_Common {}\n");
  writeFileSync(join(handlers, "README.md"), "not copied\n");
  const leasePath = join(root, "lease.json");
  if (holdLease) acquireLease(leasePath, { session: "v2-harness:sa", purpose: "test" });
  const runDir = join(root, "run");
  const cfg: SessionConfig = {
    lane: new Lane({ id: "sa", leasePath, markerPath: join(root, "marker") }),
    really: true,
    workbenchPath: join(root, "tools"),
    gamePath: join(root, "game"),
    sandboxDir: sandbox,
    gproj: join(sandbox, "EMCP2_sandbox.gproj"),
    logsPath: join(root, "logs"),
    artifactsRoot: root,
    runDir,
    evidenceDir: join(runDir, "evidence"),
    decoyDir: decoy,
    launcherLastIsDecoy: true,
    lint: "passed",
    queuePath: DEFAULT_QUEUE,
    ledgerMetaPath: join(root, "ledger.meta.json"),
    registryKey: null,
    validateConfig: "PC",
    bundledHandlerDir: handlers,
    launcherKnowsSandbox: true,
    port: 5775,
    build: "1.8.0.13",
    policy,
    ph: { sandbox, game: join(root, "game"), tools: join(root, "tools"), localAppData: root },
    ...over,
  };
  const world = new World(scenarios, () => cfg);
  // One list per Steam app number, as on the owner's machine: the game's and the Tools'.
  world.lists = ["1874880", "1874910"].map((app) => ({
    app,
    readable: true,
    entries: [decoyGproj(decoy), cfg.gproj],
    mtimeMs: T0,
  }));
  return { root, cfg, world, deps: world.deps() };
}

/** A project-list file for a test. */
function list(app: string, entries: string[], readable = true): ProjectListFile {
  return { app, readable, entries, mtimeMs: T0 };
}

const SANDBOX_OK: Scenario = { opened: "EMCP2_sandbox", exitAfterMs: 12_000, exitCode: 0 };
/** S-A-1's expected result: the ignored switch opens the launcher's last project, the decoy. */
const DECOY_OPENS: Scenario = { opened: DECOY_NAME, exitAfterMs: null };
/** The launcher's hold signature: engine created, no echo, the launcher window up. */
const LAUNCHER_HOLD: Scenario = { hold: true, launcherAfterMs: 3_000, exitAfterMs: null };

function happyScenarios(): Scenario[] {
  return [
    { ...DECOY_OPENS },
    { ...SANDBOX_OK },
    { ...SANDBOX_OK, exitCode: 0 },
    {
      ...SANDBOX_OK,
      onSpawn: (_a, cfg) => writeFileSync(join(cfg.runDir, "buildData", "data.pak"), "x"),
    },
    {
      ...SANDBOX_OK,
      onSpawn: (_a, cfg) => writeFileSync(join(cfg.runDir, "addon.ci-info.json"), '{"addon":"x"}'),
    },
    {
      ...SANDBOX_OK,
      onSpawn: (_a, cfg) => {
        const folder = join(cfg.sandboxDir, "Scripts", "WorkbenchGame", U14_FOLDER);
        expect(readdirSync(folder).sort()).toEqual(["EMCP_WB_Common.c", "EMCP_WB_Ping.c"]);
      },
    },
    {
      ...SANDBOX_OK,
      exitCode: 1,
      scriptErrors: [`scripts/WorkbenchGame/${U14_FOLDER}/${U14_BROKEN_FILE}(7): syntax error`],
      onSpawn: (_a, cfg) => {
        const folder = join(cfg.sandboxDir, "Scripts", "WorkbenchGame", U14_FOLDER);
        expect(readFileSync(join(folder, U14_BROKEN_FILE), "utf-8")).toContain(
          "EMCP2_U14_NoSuchFunction(y);",
        );
      },
    },
  ];
}

function record(f: Fixture, id: string): StepRecord {
  return JSON.parse(readFileSync(join(f.cfg.runDir, `${id}.json`), "utf-8")) as StepRecord;
}

function cleanup(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true });
}

function freshState(over: Partial<RunState> = {}): RunState {
  return {
    assertionPassed: false,
    validateSelfExit: false,
    validateErrorBaseline: 0,
    controlClean: false,
    lastHeartbeat: T0,
    sandboxRegistration: "registered",
    usedLogs: new Set(),
    ...over,
  };
}

const U14_READY = { assertionPassed: true, validateSelfExit: true, controlClean: true };

// ── Dry run and the action-plan checker ──────────────────────────────────────

describe("dry run", () => {
  it("launches nothing and produces a plan that passes the dry-run checker", async () => {
    const f = fixture([], { really: false });
    try {
      const outPlan = join(f.root, "plan.json");
      const s = await runSession({ ...f.cfg, outPlan }, f.deps);
      expect(s.mode).toBe("dry-run");
      expect(s.exitCode).toBe(0);
      expect(f.world.launches).toHaveLength(0);
      const plan = JSON.parse(readFileSync(outPlan, "utf-8")) as PlanAction[];
      expect(plan).toHaveLength(2 * selectSteps({}).length);
      expect(plan.map((a) => a.kind)).toEqual(
        selectSteps({}).flatMap(() => ["launch", "screenshot"]),
      );
      const r = checkPlan(plan, policy, { script: SCRIPT_PATH });
      expect(r.violations).toEqual([]);
      expect(r.ok).toBe(true);
      expect(JSON.stringify(plan)).not.toContain(f.root);
      // S-A-1 names its project with the old switch and carries the decoy precondition.
      expect(plan[0]).toMatchObject({
        kind: "launch",
        step: "S-A-1",
        precondition: { launcherLast: DECOY_NAME },
      });
      expect((plan[0].args as string[]).slice(0, 2)).toEqual([
        "-wbProjectPath",
        join("<sandbox>", "EMCP2_sandbox.gproj"),
      ]);
      expect(plan.filter((a) => a.precondition !== undefined)).toHaveLength(1);
      expect(s.schedule.map((x) => x.step.id)).toEqual(selectSteps({}).map((x) => x.id));
      const out = f.world.lines.join("\n");
      expect(out).toContain(
        `S-A-1 decoy ${DECOY_NAME}: present; named by every launcher list (app 1874880: names it; app 1874910: names it)`,
      );
      expect(out).toContain("all name the sandbox");
      expect(out).toContain("shipped set (2 files)");
      expect(out).toContain("Enforce lint passed");
      expect(existsSync(f.cfg.runDir)).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("a plan without the decoy confirmation fails the checker on S-A-1's launch only", async () => {
    const f = fixture([], { really: false });
    try {
      const s = await runSession({ ...f.cfg, launcherLastIsDecoy: false }, f.deps);
      const r = checkPlan(s.plan, policy, { script: SCRIPT_PATH });
      expect(r.ok).toBe(false);
      expect(r.violations.map((v) => [v.index, v.rule])).toEqual([[0, "launch-not-sandbox"]]);
      expect(r.violations[0].detail).toContain(DECOY_NAME);
    } finally {
      cleanup(f);
    }
  });

  it("puts the old project switch in S-A-1 only and -gproj in every other launch", async () => {
    const f = fixture([], { really: false });
    try {
      const s = await runSession(f.cfg, f.deps);
      const [first, ...rest] = s.schedule;
      expect(first.args.slice(0, 2)).toEqual(["-wbProjectPath", f.cfg.gproj]);
      expect(first.args).toContain("-exitAfterInit");
      for (const x of rest) {
        expect(x.args.slice(0, 2)).toEqual(["-gproj", f.cfg.gproj]);
        expect(x.args).not.toContain("-wbProjectPath");
        expect(x.args).not.toContain("-addonsDir");
      }
      expect(
        stepById("S-A-3")!.verb({ validateConfig: "PC", runDir: "r", sandboxDir: "s" }),
      ).toContain("-validate=PC");
    } finally {
      cleanup(f);
    }
  });

  it("the CLI dry run runs pre-flight steps 1 to 7 against the real queue and writes the plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sa-cli-"));
    try {
      const sandbox = join(root, "EMCP2_sandbox");
      mkdirSync(sandbox);
      writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "GameProject {\n}\n");
      const lines: string[] = [];
      const out = join(root, "plan.json");
      const code = await main(
        [
          "--sandbox",
          sandbox,
          "--workbench-path",
          join(root, "tools"),
          "--game-path",
          join(root, "game"),
          "--logs-path",
          join(root, "logs"),
          "--run",
          join(root, "run"),
          "--lease-path",
          join(root, "lease.json"),
          "--marker-path",
          join(root, "marker"),
          "--id",
          "sa",
          "--out",
          out,
        ],
        {
          checkDeps: () => BASE_ONLY,
          log: (l) => lines.push(l),
          spawn: () => {
            throw new Error("spawn in a dry run");
          },
        },
      );
      expect(code).toBe(0);
      expect(lines.join("\n")).toContain(
        "7 probe queue: 10 probes: 3 read-only, 7 reversible, 0 mutating",
      );
      expect(lines.join("\n")).toContain("NOT confirmed (--launcher-last-is-decoy)");
      // Without the decoy confirmation the plan fails on S-A-1's launch, and on nothing else.
      const r = checkPlan(JSON.parse(readFileSync(out, "utf-8")) as PlanAction[], policy, {
        script: SCRIPT_PATH,
      });
      expect(r.violations.map((v) => [v.index, v.rule])).toEqual([[0, "launch-not-sandbox"]]);
      expect(existsSync(join(root, "run"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── Probe queue ──────────────────────────────────────────────────────────────

describe("S-A probe queue", () => {
  const raw = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as {
    probes: Array<Record<string, unknown>>;
    not_answered: Array<{ probe: string; part: string }>;
  };

  it("validates with the pre-flight's queue rules and matches the script's steps", () => {
    const q = validateQueue(raw, false);
    expect(q.map((p) => p.id)).toEqual(STEPS.map((s) => s.id));
    for (const s of STEPS) {
      const p = raw.probes.find((x) => x.id === s.id)!;
      expect(p.answers).toEqual(s.answers);
      expect(p.risk_class).toBe(s.risk);
      expect(p.timeout_ms).toBe(s.initTimeoutMs + s.exitTimeoutMs);
      // The kill criteria name the tree kill of DEC-030, not a single-pid kill.
      expect(String(p.kill_criterion)).not.toMatch(/kill that pid/);
    }
  });

  it("states the per-invocation margin and the sitting's worst case as the script computes them", () => {
    const q = raw as unknown as { invocation_margin_ms: number; worst_case_total_ms: number };
    expect(q.invocation_margin_ms).toBe(INVOCATION_MARGIN_MS);
    expect(q.worst_case_total_ms).toBe(STEPS.reduce((n, s) => n + invocationWorstCaseMs(s), 0));
  });

  it("covers every probe scheduled to S-A in probes.jsonl", () => {
    const latest = new Map<string, string>();
    for (const line of readFileSync(
      join(REPO_ROOT, "data", "census", "probes.jsonl"),
      "utf-8",
    ).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as { id: string; scheduled_session?: string };
      if (e.scheduled_session !== undefined) latest.set(e.id, e.scheduled_session);
    }
    const scheduled = [...latest]
      .filter(([, s]) => s.split(/\s*,\s*/).includes("S-A"))
      .map(([id]) => id)
      .sort();
    expect(scheduled).toContain("P-U1");
    expect(scheduled).toContain("P-U14");
    const answered = new Set(raw.probes.flatMap((p) => p.answers as string[]));
    expect(scheduled.filter((id) => !answered.has(id))).toEqual([]);
    for (const n of raw.not_answered) expect(scheduled).toContain(n.probe);
  });

  it("lists the untried = form of the plugin arguments as not answered", () => {
    const l275 = raw.not_answered.find((n) => n.probe === "P-E01-mcp-inventory-L275");
    expect(l275?.part).toContain("=");
  });
});

// ── Real mode refuses without its gates ──────────────────────────────────────

describe("real mode gates", () => {
  async function cli(
    extra: string[],
    over: Partial<SessionDeps>,
    holdLease: boolean,
    artifactsInFixture = true,
  ): Promise<{ code: number; spawned: number; lines: string[]; preflights: number }> {
    const f = fixture([]);
    const saved = process.env[ARTIFACTS_ENV];
    // The CLI takes its artifacts folder from paths.ts; point it at the fixture.
    if (artifactsInFixture) process.env[ARTIFACTS_ENV] = f.root;
    else delete process.env[ARTIFACTS_ENV];
    try {
      if (!holdLease) rmSync(join(f.root, "lease.json"));
      let spawned = 0;
      let preflights = 0;
      const lines: string[] = [];
      const code = await main(
        [
          "--sandbox",
          f.cfg.sandboxDir,
          "--workbench-path",
          f.cfg.workbenchPath,
          "--game-path",
          f.cfg.gamePath,
          "--logs-path",
          f.cfg.logsPath,
          "--run",
          f.cfg.runDir,
          "--lease-path",
          join(f.root, "lease.json"),
          "--marker-path",
          join(f.root, "marker"),
          "--id",
          "sa",
          ...extra,
        ],
        {
          ...f.deps,
          log: (l) => lines.push(l),
          spawn: () => {
            spawned++;
            throw new Error("must not spawn");
          },
          preflight: async () => {
            preflights++;
            return { ok: true, results: [] };
          },
          ...over,
        },
      );
      return { code, spawned, lines, preflights };
    } finally {
      if (saved === undefined) delete process.env[ARTIFACTS_ENV];
      else process.env[ARTIFACTS_ENV] = saved;
      cleanup(f);
    }
  }

  it("is a dry run without --really", async () => {
    const r = await cli(["--launcher-knows-sandbox"], {}, true);
    expect(r.code).toBe(0);
    expect(r.spawned).toBe(0);
    expect(r.lines[0]).toContain("dry run");
  });

  it("refuses off win32", async () => {
    const r = await cli(["--really", "--launcher-knows-sandbox"], { platform: "linux" }, true);
    expect(r.code).toBe(1);
    expect(r.spawned).toBe(0);
    expect(r.lines.join("\n")).toContain("Windows-only");
  });

  it("refuses without the lease", async () => {
    const r = await cli(["--really", "--launcher-knows-sandbox"], {}, false);
    expect(r.code).toBe(1);
    expect(r.spawned).toBe(0);
    expect(r.lines.join("\n")).toContain("does not hold the Workbench lease");
  });

  it("refuses without the OA-3 entry condition", async () => {
    const r = await cli(["--really"], {}, true);
    expect(r.code).toBe(1);
    expect(r.spawned).toBe(0);
    expect(r.lines.join("\n")).toContain("OA-3");
  });

  it("refuses S-A-1 before pre-flight unless the decoy is confirmed as the launcher's last project", async () => {
    const r = await cli(["--really", "--launcher-knows-sandbox"], {}, true);
    expect(r.code).toBe(1);
    expect(r.spawned).toBe(0);
    expect(r.preflights).toBe(0);
    expect(r.lines.join("\n")).toContain("--launcher-last-is-decoy");
  });

  it("refuses when the launcher's project lists do not name the sandbox", async () => {
    const r = await cli(
      ["--really", "--launcher-knows-sandbox", "--launcher-last-is-decoy"],
      { projectLists: () => [list("1874880", ["C:\\elsewhere\\Other\\Other.gproj"])] },
      true,
    );
    expect(r.code).toBe(1);
    expect(r.preflights).toBe(0);
    expect(r.lines.join("\n")).toContain("do not all name the sandbox");
  });

  it("refuses a run folder outside the artifacts folder", async () => {
    // The CLI's artifacts folder is the host default; the fixture's run folder lies elsewhere.
    const r = await cli(
      ["--really", "--launcher-knows-sandbox", "--launcher-last-is-decoy"],
      {},
      true,
      false,
    );
    expect(r.code).toBe(1);
    expect(r.spawned).toBe(0);
    expect(r.lines.join("\n")).toContain("inside the artifacts folder");
  });

  it("refuses a workshop-only dependency before any launch", async () => {
    const f = fixture([]);
    try {
      const check = {
        ...BASE_ONLY,
        findings: [{ guid: "5B0D1E4380971EBD", status: "workshop-only" }],
      } as WbDepsCheck;
      const s = await runSession(f.cfg, { ...f.deps, checkDeps: () => check });
      expect(s.exitCode).toBe(1);
      expect(s.stopped).toContain("workshop-only");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("refuses a run or evidence folder outside the artifacts folder or inside a git tree", async () => {
    const f = fixture([]);
    try {
      const outside = mkdtempSync(join(tmpdir(), "emcp-sa-out-"));
      try {
        const a = await runSession({ ...f.cfg, runDir: join(outside, "run") }, f.deps);
        expect(a.stopped).toContain("not inside the artifacts folder");
        const b = await runSession({ ...f.cfg, evidenceDir: join(outside, "ev") }, f.deps);
        expect(b.stopped).toContain("evidence folder");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
      mkdirSync(join(f.root, ".git"));
      const c = await runSession(f.cfg, f.deps);
      expect(c.stopped).toContain("git working tree");
      expect(f.world.launches).toHaveLength(0);
      expect(f.world.preflightCalls).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("refuses S-A-1 when the decoy is missing", async () => {
    const f = fixture([{ ...DECOY_OPENS }]);
    try {
      rmSync(f.cfg.decoyDir, { recursive: true });
      const s = await runSession(f.cfg, f.deps);
      expect(s.stopped).toContain("decoy subcommand");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });
});

// ── The whole sitting with a scripted Workbench ──────────────────────────────

describe("runSession, real mode with mocks", () => {
  it("runs the seven launches in order and writes a result and an evidence record per step", async () => {
    const f = fixture(happyScenarios());
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.stopped).toBeNull();
      expect(s.exitCode).toBe(0);
      expect(f.world.launches.map((l) => l.args[0])).toEqual([
        "-wbProjectPath",
        "-gproj",
        "-gproj",
        "-gproj",
        "-gproj",
        "-gproj",
        "-gproj",
      ]);
      expect(f.world.launches.every((l) => l.cwd === f.cfg.gamePath)).toBe(true);
      // S-A-1: the ignored switch opened the decoy; only that tree was ended; the session went on.
      expect(f.world.kills).toEqual([1001]);
      const one = record(f, "S-A-1");
      expect(one.outcome).toBe("flag-ignored");
      expect(one.failure_result).toBe("flag-ignored");
      expect(one.opened_project).toBe(DECOY_NAME);
      expect(one.exit.killed_by_run).toBe(true);
      expect(one.decoy).toMatchObject({ net_zero: true });
      expect(one.session_log_match).toBe("matched");
      const two = record(f, "S-A-2");
      expect(two.outcome).toBe("pass");
      expect(two.assertion).toBe("pass");
      expect(two.opened_project).toBe("EMCP2_sandbox");
      expect(two.exit).toMatchObject({ by_itself: true, code: 0 });
      expect(two.init.seen).toBe(true);
      expect(two.init.log_spawn_to_init_ms).toBe(3_000);
      expect(two.init.log_create_to_init_ms).toBe(2_900);
      expect(two.cli_echo).toContain("-gproj");
      expect(record(f, "S-A-4").output).toMatchObject({ written_after_launch: 1 });
      expect(record(f, "S-A-5").output).toMatchObject({
        exists: true,
        parses_as_json: true,
        addon_not_found_line: false,
      });
      expect(record(f, "S-A-6").outcome).toBe("pass");
      const seven = record(f, "S-A-7");
      expect(seven.outcome).toBe("pass");
      expect(seven.exit.code).toBe(1);
      expect(seven.script_errors).toMatchObject({
        count: 1,
        naming_broken_file: 1,
        naming_other_planted: 0,
      });
      // U14 rolled back: the sandbox holds what it held before.
      expect(readdirSync(f.cfg.sandboxDir).sort()).toEqual([".gitignore", "EMCP2_sandbox.gproj"]);
      expect(seven.rollback).toMatchObject({ ok: true, net_zero: true });
      // One evidence record per step, each naming the probes it answers.
      const ev = readdirSync(f.cfg.evidenceDir).sort();
      expect(ev).toHaveLength(7);
      const first = JSON.parse(readFileSync(join(f.cfg.evidenceDir, ev[0]), "utf-8")) as {
        id: string;
        result_summary: string;
      };
      expect(first.id).toBe("EV-S-A-001");
      expect(first.result_summary).toContain("P-U1");
      // Placeholders, never the machine's paths.
      for (const name of readdirSync(f.cfg.runDir).filter((n) => n.endsWith(".json"))) {
        const text = readFileSync(join(f.cfg.runDir, name), "utf-8");
        expect(text).not.toContain(f.root);
        expect(text).not.toContain(f.root.replace(/\\/g, "\\\\"));
      }
      expect(f.cfg.lane.recordedPid()).toBeNull();
      // One pre-flight, steps 1 to 7, and its baseline kept for post-flight.
      expect(f.world.preflightCalls).toEqual([[]]);
      const baseline = JSON.parse(readFileSync(join(f.cfg.runDir, BASELINE_FILE), "utf-8")) as {
        snapshot_file: string;
      };
      expect(baseline.snapshot_file).toBe("snapshot-before-1.json");
    } finally {
      cleanup(f);
    }
  });

  it("kills the started pid, stops and drops free text when the new arguments open another project", async () => {
    const f = fixture([
      { ...DECOY_OPENS },
      {
        opened: "SomeOwnerProject",
        exitAfterMs: null,
        scriptErrors: ["scripts/Game/SomeOwnerProject/Thing.c(3): error"],
      },
    ]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(2);
      expect(f.world.kills).toEqual([1001, 1002]);
      const r = record(f, "S-A-2");
      expect(r.outcome).toBe("wrong-project");
      expect(r.failure_result).toBe("wrong-project");
      expect(r.assertion).toBe("fail");
      expect(r.opened_project).toBe("<other-project>");
      expect(r.redacted).toContain("not the sandbox");
      expect(r.script_errors.count).toBe(1);
      expect(r.script_errors.lines).toEqual([]);
      expect(readFileSync(join(f.cfg.runDir, "S-A-2.json"), "utf-8")).not.toContain(
        "SomeOwnerProject",
      );
    } finally {
      cleanup(f);
    }
  });

  it("stops after S-A-1 when the old arguments open a project other than the decoy", async () => {
    const f = fixture([{ opened: "SomeOwnerProject", exitAfterMs: null }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.kills).toEqual([1001]);
      expect(f.world.launches).toHaveLength(1);
      const r = record(f, "S-A-1");
      expect(r.outcome).toBe("wrong-project");
      expect(r.continue_session).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("records the decoy as flag ignored when -gproj falls back to the launcher's preselection", async () => {
    const f = fixture([{ ...DECOY_OPENS }, { ...DECOY_OPENS }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(record(f, "S-A-2")).toMatchObject({
        outcome: "flag-ignored",
        failure_result: "flag-ignored",
        continue_session: false,
      });
    } finally {
      cleanup(f);
    }
  });

  it("names the base game when the new arguments fall back to it", async () => {
    const f = fixture([{ ...SANDBOX_OK }, { opened: "ArmaReforger", exitAfterMs: null }]);
    try {
      await runSession(f.cfg, f.deps);
      expect(record(f, "S-A-2").opened_project).toBe("ArmaReforger");
      expect(f.world.kills).toEqual([1002]);
    } finally {
      cleanup(f);
    }
  });

  it("treats the Missing Addon Dependencies modal as a held launcher, at once", async () => {
    const f = fixture([{ ...SANDBOX_OK }, { modalAfterMs: 6_000, exitAfterMs: null }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.kills).toEqual([1002]);
      expect(record(f, "S-A-2")).toMatchObject({
        outcome: "launcher-held",
        failure_result: "launcher-held",
      });
      expect(record(f, "S-A-2").windows_seen).toContain("Missing Addon Dependencies");
    } finally {
      cleanup(f);
    }
  });

  it("on an init timeout captures, lists windows, kills nothing and never retries", async () => {
    const f = fixture([{ opened: null, exitAfterMs: null }]);
    try {
      f.world.extraWindows = [
        { pid: 77, className: "#32770", title: "a private dialog title" },
        { pid: 88, className: "CrashWnd", title: "Workbench has crashed" },
      ];
      f.world.images.set(77, "explorer.exe");
      f.world.images.set(88, "CrashReporter.exe");
      f.world.images.set(99, "notepad.exe");
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(1);
      expect(f.world.kills).toEqual([]);
      expect(f.world.captures).toEqual(["S-A-1-init-timeout"]);
      expect(f.world.windowLists).toBe(1);
      expect(f.world.launches[0].released).toBe(true);
      const r = record(f, "S-A-1");
      expect(r.outcome).toBe("timeout");
      expect(r.timeout?.phase).toBe("init");
      const windows = r.timeout?.windows.join("\n") ?? "";
      expect(windows).not.toContain("private document");
      expect(windows).not.toContain("private dialog");
      expect(windows).toContain("pid 77 explorer.exe [#32770] dialog (title not recorded)");
      expect(windows).toContain("pid 88 CrashReporter.exe [CrashWnd] Workbench has crashed");
      expect(windows).toContain("1 other top-level windows");
      expect(r.detail).toContain("keeps the lease");
      expect(r.continue_session).toBe(false);
      // The pid stays in the lease for the recorded recovery.
      expect(f.cfg.lane.recordedPid()).toBe(1001);
      // The same step is never run again in this run.
      const again = await runSession({ ...f.cfg, from: "S-A-1" }, f.deps);
      expect(again.stopped).toContain("never run twice");
      expect(f.world.launches).toHaveLength(1);
    } finally {
      cleanup(f);
    }
  });

  it("on an exit timeout (the sandbox opened, no self-exit) stops without a kill", async () => {
    const f = fixture([{ ...SANDBOX_OK }, { opened: "EMCP2_sandbox", exitAfterMs: null }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(2);
      expect(f.world.kills).toEqual([]);
      const r = record(f, "S-A-2");
      expect(r.outcome).toBe("timeout");
      expect(r.timeout?.phase).toBe("exit");
      expect(r.assertion).toBe("pass");
      expect(r.detail).toContain("flag ignored");
    } finally {
      cleanup(f);
    }
  });

  it("stops when the new arguments exit before naming an opened project", async () => {
    const f = fixture([{ ...SANDBOX_OK }, { opened: null, exitAfterMs: 4_000, exitCode: 0 }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(2);
      expect(record(f, "S-A-2")).toMatchObject({ outcome: "exited-early", assertion: "none" });
    } finally {
      cleanup(f);
    }
  });

  it("stops without a kill when another Workbench outlives the started pid", async () => {
    const f = fixture([{ ...SANDBOX_OK, respawnPid: 4242 }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.kills).toEqual([]);
      const r = record(f, "S-A-1");
      expect(r.outcome).toBe("respawned");
      expect(r.leftover_pids).toEqual([4242]);
      expect(f.cfg.lane.recordedPid()).toBe(1001);
    } finally {
      cleanup(f);
    }
  });

  it("stops after a kill when another Workbench process outlives the killed pid", async () => {
    const f = fixture([{ ...LAUNCHER_HOLD, respawnPid: 4343 }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.kills).toEqual([1001]);
      const r = record(f, "S-A-1");
      expect(r.outcome).toBe("launcher-held");
      expect(r.continue_session).toBe(false);
      expect(r.detail).toContain("pid 4343 is still running");
      expect(f.cfg.lane.recordedPid()).toBe(1001);
    } finally {
      cleanup(f);
    }
  });

  it("checks for a leftover Workbench when the wrong project was named after the pid exited", async () => {
    const f = fixture([
      { ...DECOY_OPENS },
      { opened: "SomeOwnerProject", openedAfterMs: 1_000, exitAfterMs: 2_000, respawnPid: 5151 },
    ]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.kills).toEqual([1001]);
      const r = record(f, "S-A-2");
      expect(r.outcome).toBe("wrong-project");
      expect(r.detail).toContain("already exited");
      expect(r.leftover_pids).toEqual([5151]);
      expect(r.continue_session).toBe(false);
      expect(f.cfg.lane.recordedPid()).toBe(1002);
    } finally {
      cleanup(f);
    }
  });

  it("records a plugin exit code by the plugin's own meaning", async () => {
    const f = fixture([
      { ...DECOY_OPENS },
      { ...SANDBOX_OK },
      { ...SANDBOX_OK },
      {
        ...SANDBOX_OK,
        onSpawn: (_a, cfg) => writeFileSync(join(cfg.runDir, "buildData", "x"), "x"),
      },
      { ...SANDBOX_OK, exitCode: 1 },
      { ...SANDBOX_OK },
      { ...SANDBOX_OK },
    ]);
    try {
      const s = await runSession(f.cfg, f.deps);
      const five = record(f, "S-A-5");
      expect(five.outcome).toBe("flag-ignored");
      expect(five.detail).toContain("-addonPath");
      expect(five.continue_session).toBe(true);
      expect(s.records).toHaveLength(7);
    } finally {
      cleanup(f);
    }
  });

  it("does not run S-A-7 when the U14 control is not clean", async () => {
    const happy = happyScenarios();
    happy[5] = {
      ...SANDBOX_OK,
      scriptErrors: [`scripts/WorkbenchGame/${U14_FOLDER}/EMCP_WB_Ping.c(1): error`],
    };
    const f = fixture(happy.slice(0, 6));
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(6);
      const six = record(f, "S-A-6");
      expect(six.outcome).toBe("control-dirty");
      expect(six.rollback).toMatchObject({ ok: true });
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts"))).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("stops before the next launch when a CrashReporter is running after a kill", async () => {
    const f = fixture([{ ...DECOY_OPENS, crashAfterKill: true }, { ...SANDBOX_OK }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(1);
      expect(s.stopped).toContain("CrashReporter.exe is running (pid 555)");
      expect(s.stopped).toContain("not killed");
    } finally {
      cleanup(f);
    }
  });

  it("writes a record when the harness itself fails after the spawn", async () => {
    const f = fixture([{ ...DECOY_OPENS }, { ...SANDBOX_OK, pidsThrowAfterExit: true }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      const r = record(f, "S-A-2");
      expect(r.outcome).toBe("harness-error");
      expect(r.detail).toContain("tasklist failed");
      expect(r.continue_session).toBe(false);
      expect(f.cfg.lane.recordedPid()).toBe(1002);
    } finally {
      cleanup(f);
    }
  });
});

// ── Launcher-hold decision ───────────────────────────────────────────────────

describe("launcher hold", () => {
  it("does not kill a launcher window that shows up on the way to a good open", async () => {
    const f = fixture([
      {
        ...SANDBOX_OK,
        launcherAfterMs: 3_000,
        launcherUntilMs: 9_000,
        echoAfterMs: 7_000,
        initAfterMs: 8_000,
        openedAfterMs: 10_000,
        exitAfterMs: 14_000,
      },
    ]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(f.world.kills).toEqual([]);
      expect(r.outcome).toBe("pass");
      expect(r.launcher).toMatchObject({ window_polls: 2, quiet_ms_at_decision: null });
    } finally {
      cleanup(f);
    }
  });

  it("kills on the watchdog signature and records a launcher held on an unregistered project, even when every list names the sandbox", async () => {
    const f = fixture([{ ...LAUNCHER_HOLD }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(f.world.kills).toEqual([1001]);
      // DEC-031 (M-1): never "flag ignored", so a hold never reads as a U1 "no".
      expect(r.outcome).toBe("launcher-held");
      expect(r.failure_result).toBe("launcher-held");
      expect(r.session_log_match).toBe("no-echo");
      expect(r.launcher?.engine_marker_seen).toBe(true);
      expect(r.launcher?.quiet_ms_at_decision).toBeGreaterThanOrEqual(LAUNCHER_QUIET_MS);
      expect(r.detail).toContain("launcher held on an unregistered project");
      expect(r.detail).toContain("the sandbox is registered");
    } finally {
      cleanup(f);
    }
  });

  it("records launcher held when the sandbox's registration cannot be confirmed", async () => {
    const f = fixture([{ ...LAUNCHER_HOLD }]);
    try {
      const r = await runStep(
        stepById("S-A-2")!,
        f.cfg,
        f.deps,
        freshState({ sandboxRegistration: "unknown" }),
        [],
      );
      expect(r.outcome).toBe("launcher-held");
      expect(r.failure_result).toBe("launcher-held");
      expect(r.detail).toContain("the sandbox is unknown");
    } finally {
      cleanup(f);
    }
  });

  it("never kills a launcher window before the engine marker: a slow start runs to the init timeout", async () => {
    const f = fixture([{ ...LAUNCHER_HOLD, noEngineMarker: true }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(f.world.kills).toEqual([]);
      expect(r.outcome).toBe("timeout");
      expect(r.timeout?.phase).toBe("init");
      expect(f.world.captures).toEqual(["S-A-2-init-timeout"]);
      expect(r.launcher?.engine_marker_seen).toBe(false);
      expect(r.launcher?.window_polls).toBeGreaterThanOrEqual(30);
    } finally {
      cleanup(f);
    }
  });

  it("waits the full quiet time from the engine marker, however long the window was up before it", async () => {
    // The launcher window is up from 3 s; the engine marker only at 40 s; no echo ever.
    const f = fixture([{ ...LAUNCHER_HOLD, engineAfterMs: 40_000 }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(f.world.kills).toEqual([1001]);
      expect(r.launcher?.quiet_ms_at_decision).toBeGreaterThanOrEqual(LAUNCHER_QUIET_MS);
      expect(r.launcher?.quiet_ms_at_decision).toBeLessThan(LAUNCHER_QUIET_MS + 5_000);
      expect(f.world.t - T0).toBeGreaterThanOrEqual(40_000 + LAUNCHER_QUIET_MS);
    } finally {
      cleanup(f);
    }
  });

  it("reads the windows of the started pid's child Workbench images and ends them one by one on a hold there", async () => {
    const f = fixture([{ ...LAUNCHER_HOLD, childPids: [2001], launcherOnChild: true }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(f.world.kills).toEqual([1001]);
      expect(f.world.killDescendants).toEqual([true]);
      expect(r.outcome).toBe("launcher-held");
      expect(r.window_probe.child_pids).toEqual([2001]);
      expect(r.windows_seen).toContain("Enfusion Workbench Launcher");
      expect(r.kill?.ended_pids).toEqual([2001, 1001]);
      expect(r.detail).not.toContain("/T");
      // Both ended processes are recorded for post-flight.
      expect(readForcedKills(f.cfg.runDir).map((k) => k.pid)).toEqual([2001, 1001]);
    } finally {
      cleanup(f);
    }
  });

  it("stops for the main session and the owner when the kill left a descendant running", async () => {
    const f = fixture([
      { ...LAUNCHER_HOLD, killLeaves: [{ pid: 3333, image: "steamwebhelper.exe" }] },
    ]);
    try {
      const r = await runStep(
        stepById("S-A-2")!,
        f.cfg,
        f.deps,
        freshState({ assertionPassed: true }),
        [],
      );
      expect(r.continue_session).toBe(false);
      expect(r.detail).toContain("3333 (steamwebhelper.exe)");
      expect(r.detail).toContain("stop for the main session and the owner");
      expect(r.kill?.left).toEqual([{ pid: 3333, image: "steamwebhelper.exe" }]);
    } finally {
      cleanup(f);
    }
  });
});

// ── Window probe errors ──────────────────────────────────────────────────────

describe("window probe errors", () => {
  it("records and counts a failed probe without taking it as 'no window'", async () => {
    const f = fixture([{ ...SANDBOX_OK, probeErrors: [2] }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("pass");
      expect(r.window_probe.errors).toBe(1);
      expect(r.window_probe.last_error).toContain("Add-Type");
    } finally {
      cleanup(f);
    }
  });

  it("after the project opened, counts probe errors but never stops a healthy step on them (minor 5)", async () => {
    const f = fixture([{ ...SANDBOX_OK, exitAfterMs: 30_000, probeErrors: "always" }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("pass");
      expect(r.window_probe.errors).toBeGreaterThan(WINDOW_PROBE_ERROR_LIMIT);
      expect(f.world.captures).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("waits for the children it saw to finish terminating before calling anything a leftover (minor 8)", async () => {
    const f = fixture([{ ...SANDBOX_OK, childPids: [2001], childDyingMs: 5_000 }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.window_probe.child_pids).toEqual([2001]);
      expect(r.leftover_pids).toEqual([]);
      expect(r.outcome).toBe("pass");
      expect(r.continue_session).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("stops the step as a timeout would when the probe fails on consecutive polls", async () => {
    const f = fixture([{ opened: null, exitAfterMs: null, probeErrors: "always" }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("timeout");
      expect(r.timeout?.phase).toBe("window-probe");
      expect(r.window_probe.errors).toBe(WINDOW_PROBE_ERROR_LIMIT);
      expect(f.world.kills).toEqual([]);
      expect(f.world.captures).toEqual(["S-A-2-window-probe-timeout"]);
      expect(r.continue_session).toBe(false);
      expect(r.detail).toContain("blind");
    } finally {
      cleanup(f);
    }
  });
});

// ── Session-log choice ───────────────────────────────────────────────────────

describe("session log choice", () => {
  it("never takes an earlier step's log for this launch's assertion", async () => {
    const f = fixture([{ ...DECOY_OPENS }, { ...SANDBOX_OK }, { ...SANDBOX_OK, staleLog: true }]);
    try {
      const s = await runSession({ ...f.cfg, from: undefined }, f.deps);
      expect(s.exitCode).toBe(1);
      const three = record(f, "S-A-3");
      expect(three.outcome).toBe("exited-early");
      expect(three.assertion).toBe("none");
      expect(three.session_log_match).toBe("no-log");
    } finally {
      cleanup(f);
    }
  });

  it("does not assert from a log whose CLI Params echo is another launch's", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const foreign = join("logs", "logs_other", "console.log");
      const text = [
        "08:00:00.100 ENGINE       : CLI Params: -gproj C:/x/EMCP2_sandbox.gproj -exitAfterInit",
        "08:00:01.000 DEFAULT      : Using autosave directory: C:/p/Projects/EMCP2_sandbox/autosaves",
      ].join("\n");
      const deps: SessionDeps = {
        ...f.deps,
        findSessionLog: () => foreign,
        readLog: (p) => (p === foreign ? text : f.world.logText(p)),
      };
      const r = await runStep(stepById("S-A-3")!, f.cfg, deps, freshState(), []);
      expect(r.session_log_match).toBe("echo-mismatch");
      expect(r.assertion).toBe("none");
      expect(r.outcome).toBe("exited-early");
      expect(r.redacted).toContain("not this launch's");
    } finally {
      cleanup(f);
    }
  });

  it("chooses a log folder by birth time, not by change time", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sa-logs-"));
    try {
      const old = join(root, "logs_2020-01-01_08-00-00");
      mkdirSync(old);
      writeFileSync(join(old, "console.log"), "old\n");
      await new Promise((r) => setTimeout(r, 50));
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      // A crash reporter writes into the old folder after the spawn: its change time moves.
      writeFileSync(join(old, "crash.dmp"), "x");
      expect(sessionLogBornAfter(root, t0)).toBeNull();
      const fresh = join(root, "logs_2020-01-01_08-00-09");
      mkdirSync(fresh);
      writeFileSync(join(fresh, "console.log"), "new\n");
      expect(sessionLogBornAfter(root, t0)).toBe(join(fresh, "console.log"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── Abort paths ──────────────────────────────────────────────────────────────

describe("abort paths", () => {
  it("kill refused: kill-failed, the session stops", async () => {
    const f = fixture([{ ...DECOY_OPENS, killThrows: true }]);
    try {
      const r = await runStep(stepById("S-A-1")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("kill-failed");
      expect(r.detail).toContain("kill refused");
      expect(r.continue_session).toBe(false);
      expect(f.world.launches[0].released).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("killed pid still running after the wait: kill-failed, no second kill", async () => {
    const f = fixture([{ ...DECOY_OPENS, killNoop: true }]);
    try {
      const before = f.world.t;
      const r = await runStep(stepById("S-A-1")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("kill-failed");
      expect(r.detail).toContain(`still running after ${KILL_WAIT_MS} ms`);
      expect(f.world.kills).toEqual([1001]);
      expect(f.world.t - before).toBeGreaterThanOrEqual(KILL_WAIT_MS);
      expect(r.continue_session).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("lease heartbeat fails: lease-lost, nothing killed, the session stops", async () => {
    const f = fixture([{ opened: "EMCP2_sandbox", exitAfterMs: null }]);
    try {
      f.cfg.lane.heartbeat = () => {
        throw new Error("lease taken by another session (test)");
      };
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("lease-lost");
      expect(f.world.kills).toEqual([]);
      expect(r.continue_session).toBe(false);
      expect(f.world.launches[0].released).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("a planted file changed during the step: rollback-incomplete, the session stops", async () => {
    const f = fixture([
      {
        ...SANDBOX_OK,
        onSpawn: (_a, cfg) =>
          writeFileSync(
            join(cfg.sandboxDir, "Scripts", "WorkbenchGame", U14_FOLDER, "EMCP_WB_Ping.c"),
            "changed by Workbench",
          ),
      },
    ]);
    try {
      const r = await runStep(stepById("S-A-6")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("rollback-incomplete");
      expect(r.rollback).toMatchObject({ ok: false });
      expect(r.continue_session).toBe(false);
      expect(existsSync(join(f.cfg.runDir, "u14-rollback-S-A-6.json"))).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("spawn fails after the plant: refused, the plant rolled back, its records set aside, and the step may run again", async () => {
    const f = fixture([{ spawnThrows: true }, { ...SANDBOX_OK }]);
    try {
      const r = await runStep(stepById("S-A-6")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("refused");
      expect(r.pid).toBeNull();
      expect(r.detail).toContain("spawn failed");
      expect(r.detail).toContain("rolled back (net-zero)");
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts"))).toBe(false);
      expect(existsSync(join(f.cfg.runDir, "u14-rollback-S-A-6.spawn-failed-1.json"))).toBe(true);
      expect(existsSync(join(f.cfg.runDir, "u14-plant-S-A-6.spawn-failed-1.json"))).toBe(true);
      expect(existsSync(join(f.cfg.runDir, "u14-plant-S-A-6.json"))).toBe(false);
      // Nothing started, so the U14 step may run again in this run folder (DEC-031).
      const again = await runStep(stepById("S-A-6")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(again.outcome).toBe("pass");
      expect(f.world.launches).toHaveLength(1);
    } finally {
      cleanup(f);
    }
  });

  it("the harness fails after the exit: the plant stays for the rollback command", async () => {
    const f = fixture([{ ...SANDBOX_OK, pidsThrowAfterExit: true }]);
    try {
      const r = await runStep(stepById("S-A-6")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("harness-error");
      expect(r.pid).toBe(1001);
      expect(r.rollback).toHaveProperty("pending");
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts", "WorkbenchGame", U14_FOLDER))).toBe(true);
      expect(existsSync(join(f.cfg.runDir, "u14-plant-S-A-6.json"))).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("refuses a launch while the NET port is held", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      f.world.portPids = [77];
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("TCP 5775 is held by pid 77");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });
});

// ── Step gates and kill criteria ─────────────────────────────────────────────

describe("step gates", () => {
  it("refuses a writing verb before the assertion has passed once", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const s = await runSession({ ...f.cfg, only: "S-A-4" }, f.deps);
      expect(s.stopped).toContain("assertion has passed once");
      expect(f.world.launches).toHaveLength(0);
      expect(existsSync(join(f.cfg.runDir, "S-A-4.json"))).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("resumes a writing verb when the run folder holds a passed assertion, keeping the first baseline", async () => {
    const f = fixture([
      { ...SANDBOX_OK },
      {
        ...SANDBOX_OK,
        onSpawn: (_a, cfg) => writeFileSync(join(cfg.runDir, "buildData", "x"), "x"),
      },
    ]);
    try {
      await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
      f.world.lines = [];
      const s = await runSession({ ...f.cfg, only: "S-A-4" }, f.deps);
      expect(s.stopped).toBeNull();
      expect(record(f, "S-A-4").outcome).toBe("pass");
      // The resume skipped pre-flight steps 5 and 6 and printed the first run's files.
      expect(f.world.preflightCalls).toEqual([[], [5, 6]]);
      const out = f.world.lines.join("\n");
      expect(out).toContain("snapshot-before-1.json");
      expect(out).toContain("registry-before-1.reg");
      expect(out).not.toContain("snapshot-before-2.json");
    } finally {
      cleanup(f);
    }
  });

  it("does not trust a prior result that no evidence record hashes", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      mkdirSync(f.cfg.runDir, { recursive: true });
      writeFileSync(
        join(f.cfg.runDir, "S-A-2.json"),
        JSON.stringify({ step: "S-A-2", form: "new", assertion: "pass", outcome: "pass" }),
      );
      writeFileSync(
        join(f.cfg.runDir, BASELINE_FILE),
        JSON.stringify({ snapshot_file: null, registry_export: null, written_at: "x" }),
      );
      const s = await runSession({ ...f.cfg, only: "S-A-4" }, f.deps);
      expect(s.stopped).toContain("assertion has passed once");
      expect(f.world.lines.join("\n")).toContain("no evidence record hashing them");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("stops on a run folder that holds results but no baseline", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      mkdirSync(f.cfg.runDir, { recursive: true });
      writeFileSync(join(f.cfg.runDir, "S-A-1.json"), "{}");
      const s = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
      expect(s.stopped).toContain(BASELINE_FILE);
    } finally {
      cleanup(f);
    }
  });

  it("refuses to launch while a Workbench this run did not start is running", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      f.world.preRunning = [77];
      const r = await runStep(STEPS[0], f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("never adopted");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("refuses S-A-1 without the decoy confirmation", async () => {
    const f = fixture([{ ...DECOY_OPENS }], { launcherLastIsDecoy: false });
    try {
      const r = await runStep(STEPS[0], f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("--launcher-last-is-decoy");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("refuses U14 without the Enforce lint confirmation, planting nothing", async () => {
    const f = fixture([{ ...SANDBOX_OK }], { lint: null });
    try {
      const r = await runStep(stepById("S-A-6")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("--lint passed|triaged");
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts"))).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("refuses U14 when a handler set is installed in the sandbox, planting nothing", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      mkdirSync(join(f.cfg.sandboxDir, "Scripts", "WorkbenchGame", "EnfusionMCP"), {
        recursive: true,
      });
      const r = await runStep(stepById("S-A-6")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("kill criterion");
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts", "WorkbenchGame", U14_FOLDER))).toBe(
        false,
      );
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("refuses U14 when an earlier plant attempt of the step left a manifest", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      mkdirSync(f.cfg.runDir, { recursive: true });
      writeFileSync(join(f.cfg.runDir, "u14-plant-S-A-6.json"), "{}");
      const r = await runStep(stepById("S-A-6")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("earlier plant attempt");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("leaves a U14 plant for the rollback command when Workbench is left running", async () => {
    const f = fixture([{ opened: "EMCP2_sandbox", exitAfterMs: null }]);
    try {
      const r = await runStep(stepById("S-A-7")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("timeout");
      expect(r.rollback).toHaveProperty("pending");
      const folder = join(f.cfg.sandboxDir, "Scripts", "WorkbenchGame", U14_FOLDER);
      expect(existsSync(join(folder, U14_BROKEN_FILE))).toBe(true);
      // While Workbench runs, the rollback command refuses.
      expect(runRollback(f.cfg, f.deps)).toBe(1);
      expect(existsSync(folder)).toBe(true);
      // Outside the artifacts folder it refuses too.
      f.world.launches[0].exit = { code: 0, signal: null };
      expect(runRollback({ ...f.cfg, artifactsRoot: join(f.root, "elsewhere") }, f.deps)).toBe(1);
      expect(existsSync(folder)).toBe(true);
      // Once the process is gone, it removes exactly what was planted.
      expect(runRollback(f.cfg, f.deps)).toBe(0);
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts"))).toBe(false);
      expect(existsSync(join(f.cfg.runDir, "u14-rollback-S-A-7.json"))).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("refuses a deny-listed switch", () => {
    expect(deniedSwitch(["-gproj", "x", "-clearSettings"], policy)).toBe("-clearSettings");
    expect(deniedSwitch(["-WBBACKENDLOGIN=1"], policy)).toBe("-WBBACKENDLOGIN=1");
    expect(deniedSwitch(["-gproj", "x", "-exitAfterInit", "-validate=PC"], policy)).toBeNull();
    for (const s of STEPS) {
      expect(
        deniedSwitch(
          s.verb({ validateConfig: "PC", runDir: "r", sandboxDir: "s", sandboxShortDir: "S~1" }),
          policy,
        ),
      ).toBeNull();
    }
  });
});

// ── S-A-5's oracle ───────────────────────────────────────────────────────────

describe("S-A-5 oracle", () => {
  it("records exit meaning 3 when the log says the addon was not found, whatever the exit code", async () => {
    const f = fixture([
      {
        ...SANDBOX_OK,
        exitCode: 0,
        scriptLines: [`${ADDON_NOT_FOUND_MESSAGE} 'C:/x/EMCP2_sandbox'.`],
        onSpawn: (_a, cfg) => writeFileSync(join(cfg.runDir, "addon.ci-info.json"), "{}"),
      },
    ]);
    try {
      const r = await runStep(
        stepById("S-A-5")!,
        f.cfg,
        f.deps,
        freshState({ assertionPassed: true }),
        [],
      );
      expect(r.outcome).toBe("flag-ignored");
      expect(r.output).toMatchObject({
        addon_not_found_line: true,
        exit_meaning: "no loaded addon matches -addonPath",
        parses_as_json: true,
      });
      expect(r.detail).toContain("exit meaning 3");
    } finally {
      cleanup(f);
    }
  });

  it("fails a ci-info file that does not parse as JSON", async () => {
    const f = fixture([
      {
        ...SANDBOX_OK,
        onSpawn: (_a, cfg) => writeFileSync(join(cfg.runDir, "addon.ci-info.json"), "not json"),
      },
    ]);
    try {
      const r = await runStep(
        stepById("S-A-5")!,
        f.cfg,
        f.deps,
        freshState({ assertionPassed: true }),
        [],
      );
      expect(r.outcome).toBe("flag-ignored");
      expect(r.detail).toContain("does not parse as JSON");
    } finally {
      cleanup(f);
    }
  });
});

// ── U14 plant and rollback ───────────────────────────────────────────────────

describe("U14 plant and rollback", () => {
  const deps = {
    fs: NODE_FILE_OPS,
    snapshot: (r: string, p: string[]) => takeSnapshot(r, p),
    now: () => T0,
  };

  it("never deletes a planted file that changed, nor a file it did not plant", () => {
    const f = fixture([]);
    try {
      const m = plantU14(stepById("S-A-7")!, f.cfg.sandboxDir, f.cfg.bundledHandlerDir, deps);
      expect(m.files.map((x) => x.path.split("/").pop()).sort()).toEqual([
        "EMCP2_U14_Broken.c",
        "EMCP_WB_Common.c",
        "EMCP_WB_Ping.c",
      ]);
      expect(m.created_dirs).toEqual([
        "Scripts",
        "Scripts/WorkbenchGame",
        `Scripts/WorkbenchGame/${U14_FOLDER}`,
      ]);
      const folder = join(f.cfg.sandboxDir, "Scripts", "WorkbenchGame", U14_FOLDER);
      writeFileSync(join(folder, "EMCP_WB_Ping.c"), "edited");
      writeFileSync(join(folder, "workbench-wrote-this.meta"), "x");
      const rb = rollbackU14(m, f.cfg.sandboxDir, deps);
      expect(rb.ok).toBe(false);
      expect(rb.changed).toEqual([`Scripts/WorkbenchGame/${U14_FOLDER}/EMCP_WB_Ping.c`]);
      expect(rb.extra).toContain(`Scripts/WorkbenchGame/${U14_FOLDER}/workbench-wrote-this.meta`);
      expect(existsSync(join(folder, "EMCP_WB_Ping.c"))).toBe(true);
      expect(existsSync(join(folder, "workbench-wrote-this.meta"))).toBe(true);
      expect(rb.dirs_removed).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("refuses to plant over an earlier plant", () => {
    const f = fixture([]);
    try {
      plantU14(stepById("S-A-6")!, f.cfg.sandboxDir, f.cfg.bundledHandlerDir, deps);
      expect(() =>
        plantU14(stepById("S-A-7")!, f.cfg.sandboxDir, f.cfg.bundledHandlerDir, deps),
      ).toThrow(/already exists/);
    } finally {
      cleanup(f);
    }
  });

  it("persists the manifest before the first write and rolls back a plant that fails halfway", () => {
    const f = fixture([]);
    try {
      const seen: PlantManifest[] = [];
      let writes = 0;
      const failing = {
        ...deps,
        fs: {
          ...NODE_FILE_OPS,
          writeNew: (p: string, d: Buffer | string) => {
            if (++writes === 2) throw new Error("disk full (test)");
            NODE_FILE_OPS.writeNew(p, d);
          },
        },
      };
      let err: unknown = null;
      try {
        plantU14(stepById("S-A-6")!, f.cfg.sandboxDir, f.cfg.bundledHandlerDir, failing, (m) =>
          seen.push(JSON.parse(JSON.stringify(m)) as PlantManifest),
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PlantError);
      expect((err as PlantError).message).toContain("disk full");
      expect((err as PlantError).rollback?.ok).toBe(true);
      expect(seen[0].files).toEqual([]);
      expect(seen[0].created_dirs).toEqual([]);
      expect(seen[seen.length - 1].files).toHaveLength(1);
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts"))).toBe(false);
    } finally {
      cleanup(f);
    }
  });
});

// ── Decoy ────────────────────────────────────────────────────────────────────

describe("decoy subcommand", () => {
  it("creates nothing in a dry run, creates the decoy with --really, and refuses a non-empty folder", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sa-decoy-"));
    try {
      const decoyDir = join(root, DECOY_NAME);
      const lines: string[] = [];
      const deps = {
        fs: NODE_FILE_OPS,
        log: (l: string) => lines.push(l),
        platform: "win32" as NodeJS.Platform,
      };
      const cfg = { decoyDir, sandboxDir: join(root, "EMCP2_sandbox"), really: false, ph: {} };
      expect(runDecoy(cfg, deps)).toBe(0);
      expect(existsSync(decoyDir)).toBe(false);
      // A real run is Windows-only, like every other real operation.
      expect(runDecoy({ ...cfg, really: true }, { ...deps, platform: "linux" })).toBe(1);
      expect(existsSync(decoyDir)).toBe(false);
      expect(lines.join("\n")).toContain("Windows-only");
      expect(runDecoy({ ...cfg, really: true }, deps)).toBe(0);
      const text = readFileSync(decoyGproj(decoyDir), "utf-8");
      expect(text).toContain(`ID "${DECOY_NAME}"`);
      expect(text).toContain("58D0FB3206B6F859");
      expect(runDecoy({ ...cfg, really: true }, deps)).toBe(1);
      expect(lines.join("\n")).toContain("not empty");
      expect(runDecoy({ ...cfg, decoyDir: cfg.sandboxDir, really: true }, deps)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

describe("helpers", () => {
  it("adds -addonsDir only for dependencies outside the base game and the core", () => {
    expect(addonsDirFromDeps(BASE_ONLY).args).toEqual([]);
    const own = {
      ...BASE_ONLY,
      findings: [
        ...BASE_ONLY.findings,
        {
          guid: "1111111111111111",
          status: "wb-visible",
          locationKind: "launcher-registered",
          gprojPath: join("D:", "repos", "Dep", "addon.gproj"),
        },
      ],
    } as WbDepsCheck;
    const r = addonsDirFromDeps(own);
    expect(r.refusal).toBeNull();
    expect(r.args[0]).toBe("-addonsDir");
    expect(r.args[1].toLowerCase()).toContain("repos");
    expect(
      addonsDirFromDeps({
        ...BASE_ONLY,
        findings: [{ guid: "2", status: "missing" }],
      } as WbDepsCheck).refusal,
    ).toContain("missing");
  });

  it("reads the init line, the opened-project line, the echo and the hazards with E13's patterns", () => {
    const text = [
      "10:00:00.050 ENGINE       : Workbench Create Engine took 800 ms",
      "10:00:00.100 ENGINE       : CLI Params: -gproj C:/a/EMCP2_sandbox.gproj -exitAfterInit",
      "10:00:01.150 ENGINE       : Workbench Init Engine",
      "10:00:02.000 ENGINE    (E): Addon 'X' dependency '5B0D1E4380971EBD' can't be added",
      "10:00:03.000 DEFAULT      : Using autosave directory: C:/p/Projects/EMCP2_sandbox/autosaves",
      "10:00:04.000 SCRIPT    (E): Can't compile",
      "10:00:05.000 ENGINE       : Loaded addons:",
      "10:00:05.001 ENGINE       : gproj: 'C:/g/addons/data/ArmaReforger.gproj' guid: '58D0FB3206B6F859'",
      "10:00:05.002 ENGINE       : gproj: 'C:/a/EMCP2_sandbox/EMCP2_sandbox.gproj' guid: '0000000000000001'",
      "10:00:05.003 ENGINE       : something else",
    ].join("\n");
    const facts = readLogFacts(text);
    expect(facts.engineCreated).toBe(true);
    expect(facts.initSeen).toBe(true);
    expect((facts.initMsOfDay ?? 0) - (facts.firstMsOfDay ?? 0)).toBe(1_100);
    expect(facts.opened).toBe("EMCP2_sandbox");
    expect(facts.echo).toContain("-exitAfterInit");
    expect(facts.hazards["missing-addon-dependency"]).toBe(1);
    expect(facts.scriptErrors).toEqual(["Can't compile"]);
    expect(facts.compileLines).toHaveLength(1);
    expect(facts.lastLoadedAddon).toBe("EMCP2_sandbox");
    expect(facts.addonNotFound).toBe(false);
  });

  it("matches a CLI Params echo by this launch's switch names", () => {
    const args = ["-gproj", "C:/a b/EMCP2_sandbox.gproj", "-wbModule=ScriptEditor", "-validate=PC"];
    expect(
      echoMatches(
        "CLI Params: -gproj C:/a b/EMCP2_sandbox.gproj -wbModule=ScriptEditor -validate=PC",
        args,
      ),
    ).toBe(true);
    expect(echoMatches("CLI Params: -gproj C:/a/EMCP2_sandbox.gproj -exitAfterInit", args)).toBe(
      false,
    );
    expect(echoMatches("CLI Params:", [])).toBe(false);
  });

  it("counts the sandbox as registered only when EVERY launcher list names it (M-1)", () => {
    const sb = "c:/a/EMCP2_sandbox.gproj";
    const both = [list("1874880", ["C:\\A\\EMCP2_sandbox.gproj"]), list("1874910", [sb])];
    expect(registration([], sb)).toBe("unknown");
    expect(registration(both, sb)).toBe("registered");
    // Opened only through Steam's Tools launcher: the game's list does not know it.
    expect(registration([list("1874880", ["C:/b/Other.gproj"]), list("1874910", [sb])], sb)).toBe(
      "not-registered",
    );
    expect(registration([list("1874880", [], false), list("1874910", [sb])], sb)).toBe("unknown");
    expect(registration([list("1874880", [], false), list("1874910", [])], sb)).toBe(
      "not-registered",
    );
  });

  it("records the launcher lists per app number in each step result, counts only", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      f.world.lists = [
        list("1874880", [join(f.root, "Owner", "Owner.gproj"), f.cfg.gproj]),
        list("1874910", [decoyGproj(f.cfg.decoyDir)]),
      ];
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.launcher_lists?.before).toEqual([
        expect.objectContaining({
          app: "1874880",
          entries: 2,
          sandbox: true,
          decoy: false,
          first: "other",
        }),
        expect.objectContaining({
          app: "1874910",
          entries: 1,
          sandbox: false,
          decoy: true,
          first: "decoy",
        }),
      ]);
      expect(r.launcher_lists?.after).toHaveLength(2);
      expect(JSON.stringify(r.launcher_lists)).not.toContain("Owner");
    } finally {
      cleanup(f);
    }
  });

  it("keeps run output strictly inside the artifacts folder and outside git trees", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sa-art-"));
    try {
      expect(outsideArtifacts(join(root, "sessions", "S-A", "x"), root)).toBeNull();
      expect(outsideArtifacts(root, root)).toContain("not inside");
      expect(outsideArtifacts(join(root, "..", "elsewhere"), root)).toContain("not inside");
      expect(outsideArtifacts(join(REPO_ROOT, "tmp-run"), REPO_ROOT)).toContain("git working tree");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * A process world for `killOwnWorkbench`: a tasklist and taskkill that read and change
   * `alive`, and a process table with creation times. Records every exec call.
   */
  function procWorld(rows: ProcRow[], over: { failKill?: number[]; goneOnFail?: number[] } = {}) {
    const alive = new Map(rows.map((r) => [r.pid, r.name]));
    const calls: string[][] = [];
    const exec = (file: string, args: string[]): string => {
      calls.push([file, ...args]);
      if (file === "tasklist") {
        const pid = Number(/PID eq (\d+)/.exec(args.join(" "))?.[1]);
        const img = alive.get(pid);
        return img
          ? `"${img}","${pid}","Console","1","1 K"\r\n`
          : "INFO: No tasks are running which match the specified criteria.\r\n";
      }
      if (file === "taskkill") {
        const pid = Number(args[1]);
        if (over.failKill?.includes(pid)) {
          if (over.goneOnFail?.includes(pid)) alive.delete(pid);
          throw new Error(`taskkill exited with code 128 for ${pid} (test)`);
        }
        alive.delete(pid);
        return "";
      }
      throw new Error(`unexpected exec of ${file}`);
    };
    return { exec, calls, alive, processTable: async () => rows.filter((r) => alive.has(r.pid)) };
  }
  const WB = "ArmaReforgerWorkbenchSteamDiag.exe";

  it("ends processes one at a time, children first and the started pid last, never with a tree flag (M-2)", async () => {
    const w = procWorld([
      { pid: 42, ppid: 4, name: WB, created: 1000 },
      { pid: 43, ppid: 42, name: WB, created: 1100 },
      { pid: 44, ppid: 43, name: "CrashReporter.exe", created: 1200 },
      { pid: 45, ppid: 42, name: "WerFault.exe", created: 1300 },
      // A Steam client the engine brought up, and a reused pid whose real parent is long gone.
      { pid: 46, ppid: 42, name: "steam.exe", created: 1400 },
      { pid: 47, ppid: 42, name: WB, created: 900 },
      { pid: 48, ppid: 46, name: "steamwebhelper.exe", created: 1500 },
    ]);
    const res = await killOwnWorkbench(w, 42);
    expect(res.ended_pids).toEqual([44, 43, 45, 42]);
    expect(res.left).toEqual([
      { pid: 46, image: "steam.exe" },
      { pid: 47, image: WB },
    ]);
    expect(res.ended).toBe(true);
    expect([...w.alive.keys()].sort()).toEqual([46, 47, 48]);
    const kills = w.calls.filter((c) => c[0] === "taskkill");
    expect(kills).toEqual([44, 43, 45, 42].map((p) => ["taskkill", "/PID", String(p), "/F"]));
    expect(w.calls.flat()).not.toContain("/T");
    // Each kill is preceded by its own image check.
    for (const p of [44, 43, 45, 42]) {
      const at = w.calls.findIndex((c) => c[0] === "taskkill" && c[2] === String(p));
      expect(w.calls[at - 1]).toEqual(["tasklist", "/FI", `PID eq ${p}`, "/FO", "CSV", "/NH"]);
    }
  });

  it("leaves a descendant whose image changed just before its kill, and refuses a root of another image", async () => {
    const w = procWorld([
      { pid: 42, ppid: 4, name: WB, created: 1000 },
      { pid: 43, ppid: 42, name: WB, created: 1100 },
    ]);
    w.alive.set(43, "notepad.exe"); // the pid was reused between the table read and the kill
    const res = await killOwnWorkbench(w, 42);
    expect(res.ended_pids).toEqual([42]);
    expect(res.left).toEqual([{ pid: 43, image: "notepad.exe" }]);
    const other = procWorld([{ pid: 50, ppid: 4, name: "notepad.exe", created: 1 }]);
    await expect(killOwnWorkbench(other, 50)).rejects.toThrow(/not ArmaReforgerWorkbenchSteamDiag/);
    expect(other.calls.some((c) => c[0] === "taskkill")).toBe(false);
  });

  it("counts a taskkill that errors as ended when the process is gone afterwards (minor 1)", async () => {
    const w = procWorld([{ pid: 42, ppid: 4, name: WB, created: 1000 }], {
      failKill: [42],
      goneOnFail: [42],
    });
    const res = await killOwnWorkbench(w, 42);
    expect(res.ended).toBe(true);
    expect(res.ended_pids).toEqual([42]);
    expect(res.detail).toContain("reported an error but the process is gone");
    const still = procWorld([{ pid: 42, ppid: 4, name: WB, created: 1000 }], { failKill: [42] });
    const r2 = await killOwnWorkbench(still, 42);
    expect(r2.ended).toBe(false);
    expect(r2.left).toEqual([{ pid: 42, image: WB }]);
  });

  it("without descendants ends the pid alone and reports its children; an unreadable table is reported", async () => {
    const w = procWorld([
      { pid: 42, ppid: 4, name: WB, created: 1000 },
      { pid: 43, ppid: 42, name: WB, created: 1100 },
    ]);
    const res = await killOwnWorkbench(w, 42, { descendants: false });
    expect(res.ended_pids).toEqual([42]);
    expect(res.left).toEqual([{ pid: 43, image: WB }]);
    const blind = procWorld([{ pid: 42, ppid: 4, name: WB, created: 1000 }]);
    const r2 = await killOwnWorkbench(
      { exec: blind.exec, processTable: () => Promise.reject(new Error("CIM failed")) },
      42,
    );
    expect(r2.ended_pids).toEqual([42]);
    expect(r2.descendants_unknown).toBe(true);
    const gone = procWorld([]);
    expect(await killOwnWorkbench(gone, 44)).toMatchObject({ ended: false, ended_pids: [] });
    expect(gone.calls.some((c) => c[0] === "taskkill")).toBe(false);
  });

  it("plans the kills by creation time and image: a reused-pid link is never followed", () => {
    const rows: ProcRow[] = [
      { pid: 10, ppid: 1, name: WB, created: 100 },
      { pid: 11, ppid: 10, name: WB, created: 110 },
      { pid: 12, ppid: 11, name: "CrashReporter.exe", created: 120 },
      { pid: 13, ppid: 10, name: WB, created: 50 },
      { pid: 14, ppid: 13, name: WB, created: 130 },
      { pid: 15, ppid: 10, name: "steam.exe", created: 140 },
      { pid: 16, ppid: 10, name: WB, created: null },
    ];
    const p = descendantPlan(rows, 10);
    expect(p.end.map((r) => r.pid)).toEqual([12, 11]);
    expect(p.left.map((r) => r.pid)).toEqual([13, 15, 16]);
    expect(descendantPlan(rows, 99).rootRow).toBeNull();
    expect(descendantPlan(rows, 10, false).left.map((r) => r.pid)).toEqual([11, 13, 15, 16]);
  });

  it("reads every launcher project-list file by app number; an unreadable one is marked (minor 2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-sa-plist-"));
    try {
      writeFileSync(
        join(dir, ".projectList_app1874880_user1.conf"),
        'WBProjectList {\n Projects {\n  WBProjectListItem { FilePath "C:/a/EMCP2_decoy/EMCP2_decoy.gproj" }\n  WBProjectListItem { FilePath "C:/b/Other.gproj" }\n }\n}\n',
      );
      // Another encoding: text, but no FilePath the reader can see.
      writeFileSync(
        join(dir, ".projectList_app1874910_user1.conf"),
        Buffer.from('WBProjectList { FilePath "C:/a/X.gproj" }', "utf16le"),
      );
      mkdirSync(join(dir, ".projectList_app5_user1.conf"));
      writeFileSync(join(dir, "unrelated.conf"), 'FilePath "C:/c/X.gproj"\n');
      const lists = readProjectLists(dir);
      expect(lists.map((l) => [l.app, l.readable, l.entries.length])).toEqual([
        ["1874880", true, 2],
        ["1874910", false, 0],
        ["5", false, 0],
      ]);
      expect(lists[0].entries[0]).toBe("C:/a/EMCP2_decoy/EMCP2_decoy.gproj");
      expect(readProjectLists(join(dir, "missing"))).toEqual([]);
      // The decoy check refuses on the unreadable list instead of skipping it.
      expect(
        decoyPreselectionRefusal(
          { decoyDir: "C:/a/EMCP2_decoy", gproj: "C:/s/EMCP2_sandbox.gproj" },
          { projectLists: () => lists, newestSessionLog: () => null, readLog: () => "" },
        ),
      ).toContain("app 1874910, 5 could not be read");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a failed spawn ends as a refusal, never as an unhandled error event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-sa-spawn-"));
    try {
      expect(() => spawnWithExit(join(dir, "missing.exe"), [], dir)).toThrow(/did not start/);
      // Node emits `error` on the next tick; a listener must already be there.
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never sends input: no nudge, no Enter, no key posting anywhere in the script", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    for (const banned of [
      "nudgeEnfusionLauncher",
      "doNudge: true",
      "VK_RETURN",
      "SendKeys",
      "PostMessage",
      "keybd_event",
      "SendInput",
    ]) {
      expect(src).not.toContain(banned);
    }
    expect(TOP_WINDOWS_SCRIPT).toContain("EnumWindows");
    expect(POLL_MS).toBeGreaterThan(0);
  });

  it("never retries: one spawn per step in every scenario above, and no spawn inside a loop", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    expect(src.match(/deps\.spawn\(/g)).toHaveLength(1);
  });
});

// ── B1: the recover subcommand ───────────────────────────────────────────────

describe("recover subcommand (B1)", () => {
  const WB = "ArmaReforgerWorkbenchSteamDiag.exe";

  /** A run folder whose S-A-3 started pid 1003 created at 5000; the lease records it. */
  function recoverFixture(leasePid: number | null = 1003) {
    const f = fixture([]);
    mkdirSync(f.cfg.runDir, { recursive: true });
    writeFileSync(
      startedMarkerPath(f.cfg.runDir, "S-A-3"),
      JSON.stringify({ step: "S-A-3", started_at: "x", pid: 1003, created: 5000 }),
    );
    if (leasePid !== null) f.cfg.lane.record(leasePid, f.cfg.gproj);
    const images = new Map<number, string>([[1003, WB]]);
    const created = new Map<number, number>([[1003, 5000]]);
    const kills: Array<{ pid: number; descendants: boolean }> = [];
    const lines: string[] = [];
    let running: number[] = [];
    let t = T0;
    const deps = {
      platform: "win32" as NodeJS.Platform,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      imageOfPid: (pid: number) => images.get(pid) ?? null,
      processTable: async (): Promise<ProcRow[]> =>
        [...images].map(([pid, name]) => ({
          pid,
          ppid: 4,
          name,
          created: created.get(pid) ?? null,
        })),
      kill: async (pid: number, opts?: { descendants?: boolean }): Promise<KillResult> => {
        kills.push({ pid, descendants: opts?.descendants !== false });
        images.delete(pid);
        return {
          ended: true,
          ended_pids: [pid],
          left: [],
          descendants_unknown: false,
          detail: `taskkill /PID ${pid} /F (test)`,
        };
      },
      workbenchPids: () => [...running],
      log: (l: string) => lines.push(l),
    };
    const setRunning = (p: number[]): void => {
      running = p;
    };
    return { f, deps, images, created, kills, lines, setRunning };
  }

  it("is a dry run without --really: says what it would check and ends nothing", async () => {
    const { f, deps, kills, lines } = recoverFixture();
    try {
      expect(await runRecover({ ...f.cfg, really: false }, deps)).toBe(0);
      expect(kills).toEqual([]);
      const out = lines.join("\n");
      expect(out).toContain("records Workbench pid 1003");
      expect(out).toContain("a started marker of S-A-3 names it");
      expect(out).toContain("would confirm that pid 1003 is ArmaReforgerWorkbenchSteamDiag.exe");
      expect(out).toContain("compare its creation time");
      expect(out).toContain("children first, then taskkill /PID 1003 /F");
      expect(out).not.toContain("/T");
      expect(f.cfg.lane.recordedPid()).toBe(1003);
    } finally {
      cleanup(f);
    }
  });

  it("ends the lease pid with its descendants only after the image and creation-time checks, records it and clears the lease pid", async () => {
    const { f, deps, kills, lines } = recoverFixture();
    try {
      expect(await runRecover(f.cfg, deps)).toBe(0);
      expect(kills).toEqual([{ pid: 1003, descendants: true }]);
      expect(lines.join("\n")).toContain("recovered (1 of 3)");
      expect(f.cfg.lane.recordedPid()).toBeNull();
      expect(f.cfg.lane.holdsLease()).toBe(true);
      expect(readForcedKills(f.cfg.runDir)).toMatchObject([{ pid: 1003, by: "recover" }]);
      expect(recoverRecords(f.cfg.runDir)).toMatchObject([
        {
          pid: 1003,
          image: WB,
          own: true,
          descendants: true,
          ended: true,
          gone: true,
          leftovers: [],
        },
      ]);
    } finally {
      cleanup(f);
    }
  });

  it("does not take a reused pid for the run's own: another creation time needs --owner-go (minor 6)", async () => {
    const { f, deps, created, kills, lines } = recoverFixture();
    try {
      created.set(1003, 9999); // the started process is gone; another Workbench got its pid
      expect(await runRecover(f.cfg, deps)).toBe(1);
      expect(kills).toEqual([]);
      expect(lines.join("\n")).toContain("created at another time");
      // The same holds when the marker has no creation time, or the table cannot be read.
      writeFileSync(
        startedMarkerPath(f.cfg.runDir, "S-A-3"),
        JSON.stringify({ step: "S-A-3", started_at: "x", pid: 1003, created: null }),
      );
      expect(await runRecover(f.cfg, deps)).toBe(1);
      expect(lines.join("\n")).toContain("no creation time to compare");
      expect(kills).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("--owner-go takes the pid, which must be the lease's pid (info item)", async () => {
    const { f, deps, images, kills, lines } = recoverFixture(4242);
    try {
      images.set(4242, WB);
      expect(await runRecover(f.cfg, deps, { ownerGo: 5151 })).toBe(1);
      expect(kills).toEqual([]);
      expect(lines.join("\n")).toContain(
        "--owner-go names pid 5151, but the lease records pid 4242",
      );
    } finally {
      cleanup(f);
    }
  });

  it("counts recoveries across every run folder of the sitting (minor 4)", async () => {
    const { f, deps, kills, lines } = recoverFixture();
    try {
      const earlier = join(f.root, "run-earlier");
      mkdirSync(earlier);
      for (let i = 1; i <= MAX_RECOVERIES; i++) {
        writeFileSync(join(earlier, `recover-${i}.json`), JSON.stringify({ ended: true }));
      }
      expect(await runRecover(f.cfg, deps)).toBe(1);
      expect(kills).toEqual([]);
      expect(lines.join("\n")).toContain("3 recoveries already ended a process in this sitting");
      expect(lines.join("\n")).toContain("stop and ask the owner");
    } finally {
      cleanup(f);
    }
  });

  it("refuses, ending nothing, when the lease's pid is now another image (a reused pid)", async () => {
    const { f, deps, images, kills, lines } = recoverFixture();
    try {
      images.set(1003, "notepad.exe");
      expect(await runRecover(f.cfg, deps)).toBe(1);
      expect(kills).toEqual([]);
      expect(lines.join("\n")).toContain(
        "pid 1003 is notepad.exe, not ArmaReforgerWorkbenchSteamDiag.exe",
      );
      expect(f.cfg.lane.recordedPid()).toBe(1003);
      expect(existsSync(join(f.cfg.runDir, FORCED_KILLS_FILE))).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("refuses when the pid is gone, and names a leftover Workbench it will not end", async () => {
    const { f, deps, images, kills, lines, setRunning } = recoverFixture();
    try {
      images.delete(1003);
      setRunning([4242]);
      expect(await runRecover(f.cfg, deps)).toBe(1);
      expect(kills).toEqual([]);
      const out = lines.join("\n");
      expect(out).toContain("shows no pid 1003");
      expect(out).toContain("pid 4242 is running and not recorded in the lease");
      expect(out).toContain("owner's word");
    } finally {
      cleanup(f);
    }
  });

  it("refuses a pid this run did not start without --owner-go <pid>, and ends that pid alone with it", async () => {
    const { f, deps, images, kills, lines } = recoverFixture(4242);
    try {
      images.set(4242, WB);
      expect(await runRecover(f.cfg, deps)).toBe(1);
      expect(kills).toEqual([]);
      expect(lines.join("\n")).toContain("not shown to be one this run started");
      expect(await runRecover(f.cfg, deps, { ownerGo: 4242 })).toBe(0);
      expect(kills).toEqual([{ pid: 4242, descendants: false }]);
      expect(recoverRecords(f.cfg.runDir)).toMatchObject([
        { own: false, owner_go: 4242, descendants: false },
      ]);
    } finally {
      cleanup(f);
    }
  });

  it("refuses a fourth recovery in one run folder (plan 5.3: three per session)", async () => {
    const { f, deps, images, kills, lines } = recoverFixture();
    try {
      for (let i = 1; i <= MAX_RECOVERIES; i++) {
        images.set(1003, WB);
        f.cfg.lane.record(1003, f.cfg.gproj);
        expect(await runRecover(f.cfg, deps)).toBe(0);
      }
      images.set(1003, WB);
      f.cfg.lane.record(1003, f.cfg.gproj);
      expect(await runRecover(f.cfg, deps)).toBe(1);
      expect(kills).toHaveLength(MAX_RECOVERIES);
      expect(lines.join("\n")).toContain("3 recoveries already ended a process");
    } finally {
      cleanup(f);
    }
  });

  it("refuses off win32, without the lease, with no pid in the lease, and outside the artifacts folder", async () => {
    const a = recoverFixture();
    try {
      expect(await runRecover(a.f.cfg, { ...a.deps, platform: "linux" })).toBe(1);
      expect(
        await runRecover({ ...a.f.cfg, artifactsRoot: join(a.f.root, "elsewhere") }, a.deps),
      ).toBe(1);
      expect(a.lines.join("\n")).toContain("not inside the artifacts folder");
      rmSync(join(a.f.root, "lease.json"));
      expect(await runRecover(a.f.cfg, a.deps)).toBe(1);
      expect(a.lines.join("\n")).toContain("does not hold the Workbench lease");
      expect(a.kills).toEqual([]);
    } finally {
      cleanup(a.f);
    }
    const b = recoverFixture(null);
    try {
      expect(await runRecover(b.f.cfg, b.deps)).toBe(1);
      expect(b.lines.join("\n")).toContain("the lease records no Workbench pid");
      expect(b.kills).toEqual([]);
    } finally {
      cleanup(b.f);
    }
  });

  it("knows the pids of the run from its started markers only (a step result alone proves nothing)", () => {
    const { f } = recoverFixture();
    try {
      writeFileSync(join(f.cfg.runDir, "S-A-1.json"), JSON.stringify({ step: "S-A-1", pid: 1001 }));
      writeFileSync(join(f.cfg.runDir, "S-A-2.started"), "not json");
      writeFileSync(
        acknowledgedMarkerPath(f.cfg.runDir, "S-A-4"),
        JSON.stringify({ step: "S-A-4", started_at: "x", pid: 1004, created: 7000 }),
      );
      expect(runOwnPids(f.cfg.runDir)).toEqual([1003, 1004]);
    } finally {
      cleanup(f);
    }
  });

  it("the runbook's recovery passages point at recover and print no bare taskkill", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-A.md"),
      "utf-8",
    );
    expect(text).toContain("s-a-headless.ts recover --run");
    for (const line of text.split("\n")) {
      if (/taskkill/.test(line)) expect(line).toMatch(/recover|kill criteri|at a time/);
    }
  });

  it("no script of the live lane and no S-A document passes a tree flag to taskkill (M-2)", () => {
    const files = [
      ...readdirSync(join(REPO_ROOT, "scripts", "live"))
        .filter((n) => n.endsWith(".ts"))
        .map((n) => join(REPO_ROOT, "scripts", "live", n)),
      join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-A.md"),
      join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-A-queue.json"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      expect(text, file).not.toMatch(/\/T \/F|"\/T"/);
    }
  });
});

// ── The runbook's owner steps and stated limits (DEC-031) ────────────────────

describe("runbook, second pass (DEC-031)", () => {
  const text = readFileSync(join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-A.md"), "utf-8");

  it("has the owner open the sandbox and then the decoy last in both ways, with the direct-start line (M-1)", () => {
    expect(text).toContain(
      'Start-Process -FilePath "<tools>\\Workbench\\ArmaReforgerWorkbenchSteamDiag.exe" -WorkingDirectory "<game>"',
    );
    expect(text).toContain("Manage, Browse local files");
    expect(text).toMatch(/OA-3 in both ways/);
    expect(text).toMatch(/OA-12 in both ways/);
    expect(text).toContain("The main session never starts Workbench here.");
    expect(text).toContain("1874880");
    expect(text).toContain("1874910");
    expect(text).toContain("Which app id's list a direct launch reads and writes");
    expect(text).toMatch(/S-A-2 held at the launcher's picker\s*\|\s*Not a U1 answer/);
  });

  it("states the Steam precondition, the heartbeat during the owner's opens, both timeout outcomes and the estimate", () => {
    expect(text).toContain("The Steam client is already running before the sitting");
    expect(text).toContain("While the owner works, the main session keeps the lease alive");
    expect(text).toContain("left running unwatched");
    expect(text).toContain("no forced-kill record is written");
    expect(text).toContain("an estimate, not a bound");
    expect(text).toContain("--owner-go <leftover pid>");
    expect(text).toContain("acknowledge --run <run> --id sa1 --step S-A-<n> --owner-ack --really");
  });

  it("states the query timeouts, that any step may come first, the preselection gate and the idle rule (DEC-033)", () => {
    expect(text).not.toContain("its own 20 s timeout");
    expect(text).toContain("the PowerShell process-table read and the window list 30 s");
    expect(text).not.toContain("The first invocation (S-A-1)");
    expect(text).toContain("Any step may come first");
    expect(text).toContain("do OA-12 first; stop and ask the owner");
    expect(text).toContain("registration unknown");
    expect(text).toContain("--idle-quiet-ms");
    expect(text).toMatch(/\*\*Idle\.\*\*/);
    expect(text).toContain("expected-noise.json");
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    expect(src).not.toContain("a launcher hold is then");
    expect(src).not.toContain("its own 20 s timeout");
  });
});

// ── acknowledge: the one way to clear a dangling started marker ──────────────

describe("acknowledge subcommand (minor 3)", () => {
  it("renames the marker only with the owner's acknowledgement, no Workbench running and no open plant", () => {
    const f = fixture([]);
    try {
      mkdirSync(f.cfg.runDir, { recursive: true });
      const marker = startedMarkerPath(f.cfg.runDir, "S-A-3");
      writeFileSync(marker, "{}");
      const lines: string[] = [];
      const deps = {
        platform: "win32" as NodeJS.Platform,
        workbenchPids: () => [] as number[],
        log: (l: string) => lines.push(l),
      };
      // Dry run: says what it would do.
      expect(
        runAcknowledge({ ...f.cfg, really: false }, deps, { step: "S-A-3", ownerAck: true }),
      ).toBe(0);
      expect(existsSync(marker)).toBe(true);
      // No acknowledgement, a running Workbench, an open plant: refused.
      expect(runAcknowledge(f.cfg, deps, { step: "S-A-3", ownerAck: false })).toBe(1);
      expect(
        runAcknowledge(
          f.cfg,
          { ...deps, workbenchPids: () => [77] },
          { step: "S-A-3", ownerAck: true },
        ),
      ).toBe(1);
      writeFileSync(join(f.cfg.runDir, "u14-plant-S-A-3.json"), "{}");
      expect(runAcknowledge(f.cfg, deps, { step: "S-A-3", ownerAck: true })).toBe(1);
      rmSync(join(f.cfg.runDir, "u14-plant-S-A-3.json"));
      expect(existsSync(marker)).toBe(true);
      expect(lines.join("\n")).toContain("--owner-ack");
      // With all three: renamed.
      expect(runAcknowledge(f.cfg, deps, { step: "S-A-3", ownerAck: true })).toBe(0);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(acknowledgedMarkerPath(f.cfg.runDir, "S-A-3"))).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("after the acknowledgement the other steps run, and the acknowledged step never does", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      mkdirSync(f.cfg.runDir, { recursive: true });
      writeFileSync(join(f.cfg.runDir, BASELINE_FILE), JSON.stringify({ snapshot_file: null }));
      writeFileSync(startedMarkerPath(f.cfg.runDir, "S-A-3"), "{}");
      const blocked = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
      expect(blocked.stopped).toContain("S-A-3 has a started marker and no result");
      expect(f.world.launches).toHaveLength(0);
      const lines: string[] = [];
      const ack = {
        platform: "win32" as NodeJS.Platform,
        workbenchPids: () => [] as number[],
        log: (l: string) => lines.push(l),
      };
      expect(runAcknowledge(f.cfg, ack, { step: "S-A-3", ownerAck: true })).toBe(0);
      const s = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
      expect(s.stopped).toBeNull();
      expect(f.world.launches).toHaveLength(1);
      const r = await runStep(stepById("S-A-3")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("S-A-3.started is already in this run folder");
    } finally {
      cleanup(f);
    }
  });
});

// ── B2: one step per invocation, started markers ─────────────────────────────

describe("one step per invocation (B2)", () => {
  it("writes S-A-n.started before the spawn and adds the pid after it", async () => {
    let seen: unknown = null;
    const f = fixture([
      {
        ...SANDBOX_OK,
        onSpawn: (_a, cfg) => {
          seen = JSON.parse(readFileSync(startedMarkerPath(cfg.runDir, "S-A-2"), "utf-8"));
        },
      },
    ]);
    try {
      await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(seen).toMatchObject({ step: "S-A-2", pid: null, created: null });
      // The pid and its creation time from the process table (minor 6).
      expect(
        JSON.parse(readFileSync(startedMarkerPath(f.cfg.runDir, "S-A-2"), "utf-8")),
      ).toMatchObject({ step: "S-A-2", pid: 1001, created: T0 });
    } finally {
      cleanup(f);
    }
  });

  it("refuses a step with a started marker and no result, as a harness error", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      mkdirSync(f.cfg.runDir, { recursive: true });
      writeFileSync(join(f.cfg.runDir, BASELINE_FILE), JSON.stringify({ snapshot_file: null }));
      writeFileSync(startedMarkerPath(f.cfg.runDir, "S-A-3"), "{}");
      const s = await runSession({ ...f.cfg, only: "S-A-3" }, f.deps);
      expect(s.exitCode).toBe(1);
      expect(s.stopped).toContain("started marker and no result");
      expect(s.stopped).toContain("harness error");
      expect(s.stopped).toContain("rollback command");
      expect(s.stopped).toContain("git -C <sandbox> status --short");
      expect(s.stopped).toContain("stop and ask the owner");
      expect(f.world.launches).toHaveLength(0);
      expect(f.world.preflightCalls).toHaveLength(0);
      // Every other step of the run folder is blocked too (minor 3), not only S-A-3.
      const other = await runSession({ ...f.cfg, only: "S-A-4" }, f.deps);
      expect(other.stopped).toContain("S-A-3 has a started marker and no result");
      expect(f.world.launches).toHaveLength(0);
      // runStep refuses on its own too.
      const r = await runStep(stepById("S-A-3")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toContain("S-A-3.started");
    } finally {
      cleanup(f);
    }
  });

  it("the script's own refusals never send the main session to a new run folder (minor 4)", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    expect(src).not.toMatch(/use a new run folder/);
  });

  it("removes the marker when the spawn itself fails, so the step may run again", async () => {
    const f = fixture([{ spawnThrows: true }]);
    try {
      const r = await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("refused");
      expect(existsSync(startedMarkerPath(f.cfg.runDir, "S-A-2"))).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("ends an --only invocation with the done line naming its step and the run folder", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const s = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
      expect(s.exitCode).toBe(0);
      const out = f.world.lines.join("\n");
      expect(out).toContain("run folder: %LOCALAPPDATA%");
      expect(f.world.lines[f.world.lines.length - 1]).toMatch(/^S-A steps done \(S-A-2\)\. Next: /);
    } finally {
      cleanup(f);
    }
  });

  it("states each invocation's worst case, and the runbook gives the same figures", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-A.md"),
      "utf-8",
    );
    for (const s of STEPS) {
      const worst = invocationWorstCaseMs(s);
      expect(worst).toBe(s.initTimeoutMs + s.exitTimeoutMs + INVOCATION_MARGIN_MS);
      const row = new RegExp(
        `\\|\\s*${s.id}\\s*\\|\\s*${(s.initTimeoutMs + s.exitTimeoutMs) / 1000} s\\s*\\|\\s*${worst / 1000} s\\s*\\|[^|\\n]*timeout (\\d+) ms`,
      );
      const m = row.exec(text);
      expect(m, `${s.id} row`).not.toBeNull();
      // The command timeout the runbook gives is above the invocation's worst case.
      expect(Number(m![1])).toBeGreaterThan(worst);
      // A step that can exceed ten minutes runs as a background command.
      if (worst > 600_000) expect(m![0]).toContain("background");
    }
  });

  it("the runbook passes --only and --registry-key on every real step invocation", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-A.md"),
      "utf-8",
    );
    const real = text
      .split("\n")
      .filter((l) => l.includes("scripts/live/s-a-headless.ts --id") && l.includes("--really"));
    expect(real.length).toBeGreaterThan(0);
    for (const l of real) {
      expect(l).toContain("--only S-A-");
      expect(l).toContain('--registry-key "');
      expect(l).toContain("--run ");
    }
  });
});

// ── M1: the decoy, checked from files before the old-arguments launch ────────

describe("decoy checks before S-A-1 (M1)", () => {
  it("refuses S-A-1 unless the decoy is the first entry of EVERY launcher list, naming the app", async () => {
    const f = fixture([{ ...DECOY_OPENS }]);
    try {
      // The owner opened the decoy only through Steam's Tools launcher (app 1874910).
      const owner = join(f.root, "OwnerProject", "OwnerProject.gproj");
      f.world.lists = [
        list("1874880", [owner, decoyGproj(f.cfg.decoyDir), f.cfg.gproj]),
        list("1874910", [decoyGproj(f.cfg.decoyDir), f.cfg.gproj]),
      ];
      const s = await runSession({ ...f.cfg, only: "S-A-1" }, f.deps);
      expect(s.stopped).toContain(
        "not the first entry of the launcher's project list of app 1874880 (1 of 2 lists)",
      );
      expect(s.stopped).toContain("in both ways");
      expect(f.world.launches).toHaveLength(0);
      expect(f.world.lines.join("\n")).not.toContain("OwnerProject");
    } finally {
      cleanup(f);
    }
  });

  it("refuses a real run while one list does not name the sandbox (OA-3 done one way only)", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      f.world.lists = [
        list("1874880", [decoyGproj(f.cfg.decoyDir)]),
        list("1874910", [decoyGproj(f.cfg.decoyDir), f.cfg.gproj]),
      ];
      const s = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
      expect(s.stopped).toContain("do not all name the sandbox");
      expect(s.stopped).toContain("app 1874880: does NOT name it; app 1874910: names it");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("refuses S-A-1 unless the newest retained session log names the decoy", async () => {
    const f = fixture([{ ...DECOY_OPENS }]);
    try {
      f.world.priorOpened = "OwnerProject";
      const s = await runSession({ ...f.cfg, only: "S-A-1" }, f.deps);
      expect(s.stopped).toContain("names <other-project>, not EMCP2_decoy");
      expect(f.world.launches).toHaveLength(0);
      expect(f.world.lines.join("\n")).not.toContain("OwnerProject");
      f.world.priorOpened = null;
      expect(decoyPreselectionRefusal(f.cfg, f.deps)).toContain("names no project");
    } finally {
      cleanup(f);
    }
  });

  it("prints 'registration unknown' in a real run and refuses S-A-1 on it", async () => {
    const f = fixture([{ ...DECOY_OPENS }]);
    try {
      f.world.lists = [];
      const s = await runSession({ ...f.cfg, only: "S-A-1" }, f.deps);
      expect(f.world.lines.join("\n")).toContain("could not be read: registration unknown");
      expect(s.stopped).toContain("registration unknown");
      expect(f.world.launches).toHaveLength(0);
    } finally {
      cleanup(f);
    }
  });

  it("kills at once when a log born after the spawn names an owner project although its echo differs", async () => {
    const f = fixture([
      { opened: "OwnerProject", echoWithoutBareFlags: true, exitAfterMs: null },
      { ...SANDBOX_OK },
    ]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.kills).toEqual([1001]);
      expect(f.world.launches).toHaveLength(1);
      const r = record(f, "S-A-1");
      expect(r).toMatchObject({
        outcome: "wrong-project",
        session_log_match: "echo-mismatch",
        continue_session: false,
      });
      expect(readFileSync(join(f.cfg.runDir, "S-A-1.json"), "utf-8")).not.toContain("OwnerProject");
    } finally {
      cleanup(f);
    }
  });

  it("goes on after S-A-1 only on a matched log: an unmatched early exit stops the sitting", async () => {
    const f = fixture([
      { opened: DECOY_NAME, echoWithoutBareFlags: true, exitAfterMs: 8_000 },
      { ...SANDBOX_OK },
    ]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(1);
      expect(f.world.kills).toEqual([]);
      const r = record(f, "S-A-1");
      expect(r.outcome).toBe("exited-early");
      expect(r.continue_session).toBe(false);
      expect(r.detail).toContain("not matched (echo-mismatch)");
    } finally {
      cleanup(f);
    }
  });

  it("stops after a launcher hold on S-A-1 (no echo, so no matched log)", async () => {
    const f = fixture([{ ...LAUNCHER_HOLD }, { ...SANDBOX_OK }]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(1);
      expect(record(f, "S-A-1")).toMatchObject({
        outcome: "launcher-held",
        session_log_match: "no-echo",
        continue_session: false,
      });
    } finally {
      cleanup(f);
    }
  });

  it("stops after the Missing Addon Dependencies modal on S-A-1", async () => {
    const f = fixture([
      { opened: null, modalAfterMs: 6_000, exitAfterMs: null },
      { ...SANDBOX_OK },
    ]);
    try {
      const s = await runSession(f.cfg, f.deps);
      expect(s.exitCode).toBe(1);
      expect(f.world.launches).toHaveLength(1);
      const r = record(f, "S-A-1");
      expect(r).toMatchObject({
        outcome: "launcher-held",
        session_log_match: "matched",
        continue_session: false,
      });
      expect(r.detail).toContain("Missing Addon Dependencies modal appeared, and neither");
    } finally {
      cleanup(f);
    }
  });
});

// ── M3: the sandbox root's entry list, per step ──────────────────────────────

describe("sandbox root entries (M3)", () => {
  it("records a new file at the sandbox root in the step result and prints it", async () => {
    const f = fixture([
      {
        ...SANDBOX_OK,
        onSpawn: (_a, cfg) => writeFileSync(join(cfg.sandboxDir, "resourceDatabase.rdb"), "x"),
      },
    ]);
    try {
      const s = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
      expect(s.exitCode).toBe(0);
      expect(record(f, "S-A-2").sandbox_root).toEqual({
        added: ["resourceDatabase.rdb"],
        removed: [],
      });
      expect(f.world.lines.join("\n")).toContain(
        "sandbox root entries added: resourceDatabase.rdb",
      );
    } finally {
      cleanup(f);
    }
  });
});

// ── Info items and placeholders ──────────────────────────────────────────────

describe("forced kills and placeholders", () => {
  it("records killed_by_run only when the kill ended a live process", async () => {
    const f = fixture([{ ...DECOY_OPENS, killFindsGone: true }]);
    try {
      const r = await runStep(stepById("S-A-1")!, f.cfg, f.deps, freshState(), []);
      expect(r.exit.killed_by_run).toBe(false);
      expect(r.exit.by_itself).toBe(true);
      expect(r.detail).toContain("nothing killed");
      expect(readForcedKills(f.cfg.runDir)).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("writes every kill that ended a process to the run folder for post-flight", async () => {
    const f = fixture([{ ...DECOY_OPENS }]);
    try {
      const r = await runStep(stepById("S-A-1")!, f.cfg, f.deps, freshState(), []);
      expect(r.exit.killed_by_run).toBe(true);
      expect(readForcedKills(f.cfg.runDir)).toMatchObject([{ pid: 1001, by: "S-A-1" }]);
    } finally {
      cleanup(f);
    }
  });

  it("prints the dependency line of a dry run in placeholder form", async () => {
    const f = fixture([], { really: false });
    try {
      const dep = {
        ...BASE_ONLY,
        findings: [
          ...BASE_ONLY.findings,
          {
            guid: "1111111111111111",
            status: "wb-visible",
            locationKind: "launcher-registered",
            gprojPath: join(f.root, "deps", "Dep", "Dep.gproj"),
          },
        ],
      } as WbDepsCheck;
      await runSession(f.cfg, { ...f.deps, checkDeps: () => dep });
      const line = f.world.lines.find((l) => l.startsWith("dependencies:"))!;
      expect(line).toContain("-addonsDir %LOCALAPPDATA%");
      expect(line).not.toContain(f.root);
    } finally {
      cleanup(f);
    }
  });

  it("main refuses a sandbox folder that is not EMCP2_sandbox, and its catch prints placeholders", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sa-main-"));
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => {
      errors.push(String(m));
    });
    try {
      const base = [
        "--workbench-path",
        join(root, "tools"),
        "--game-path",
        join(root, "game"),
        "--logs-path",
        join(root, "logs"),
        "--lease-path",
        join(root, "lease.json"),
        "--marker-path",
        join(root, "marker"),
        "--id",
        "sa",
      ];
      const other = join(root, "OwnerProjectX");
      mkdirSync(other);
      const out = join(root, "plan.json");
      expect(await main(["--sandbox", other, "--out", out, ...base])).toBe(2);
      expect(existsSync(out)).toBe(false);
      expect(errors.join("\n")).toContain("must be the 2.0 sandbox folder EMCP2_sandbox");
      const sandbox = join(root, "EMCP2_sandbox");
      mkdirSync(sandbox);
      errors.length = 0;
      const code = await main(["--sandbox", sandbox, ...base], {
        checkDeps: () => BASE_ONLY,
        log: () => {
          throw new Error(`log failed for ${join(sandbox, "EMCP2_sandbox.gproj")}`);
        },
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("<sandbox>");
      expect(errors.join("\n")).not.toContain(sandbox);
    } finally {
      spy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets pre-flight pass the U14 folder only for this run's own open plant of the step it runs", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const seen: Array<boolean | undefined> = [];
      const deps: SessionDeps = {
        ...f.deps,
        preflight: async (ctx) => {
          seen.push(ctx.ownU14Plant);
          return { ok: false, results: [] };
        },
      };
      await runSession({ ...f.cfg, only: "S-A-6" }, deps);
      mkdirSync(f.cfg.runDir, { recursive: true });
      writeFileSync(join(f.cfg.runDir, "u14-plant-S-A-6.json"), "{}");
      await runSession({ ...f.cfg, only: "S-A-6" }, deps);
      await runSession({ ...f.cfg, only: "S-A-2" }, deps);
      writeFileSync(join(f.cfg.runDir, "u14-rollback-S-A-6.json"), "{}");
      await runSession({ ...f.cfg, only: "S-A-6" }, deps);
      expect(seen).toEqual([false, true, false, false]);
    } finally {
      cleanup(f);
    }
  });
});

// ── The narrow read of fc5010b (DEC-033): B-1 and m-1 to m-4 ─────────────────

describe("preselection gate on every -gproj step (B-1)", () => {
  it("refuses S-A-2 to S-A-7 while a readable list has another project first, naming the app only", async () => {
    for (const only of ["S-A-2", "S-A-3", "S-A-4", "S-A-5", "S-A-6", "S-A-7"] as const) {
      const f = fixture([{ ...SANDBOX_OK }]);
      try {
        const owner = join(f.root, "OwnerProject", "OwnerProject.gproj");
        f.world.lists = [
          list("1874880", [owner, decoyGproj(f.cfg.decoyDir), f.cfg.gproj]),
          list("1874910", [decoyGproj(f.cfg.decoyDir), f.cfg.gproj]),
        ];
        const s = await runSession({ ...f.cfg, only }, f.deps);
        expect(s.exitCode, only).toBe(1);
        expect(s.stopped, only).toContain("app 1874880");
        expect(s.stopped, only).toContain("do OA-12 first; stop and ask the owner");
        expect(f.world.launches, only).toHaveLength(0);
        expect(f.world.preflightCalls, only).toHaveLength(0);
        expect(f.world.lines.join("\n"), only).not.toContain("OwnerProject");
      } finally {
        cleanup(f);
      }
    }
  });

  it("passes with the decoy or the sandbox first in every list (the lists as edited for DEC-033)", async () => {
    for (const first of ["decoy", "sandbox"] as const) {
      const f = fixture([{ ...SANDBOX_OK }]);
      try {
        const d = decoyGproj(f.cfg.decoyDir);
        const entries = first === "decoy" ? [d, f.cfg.gproj] : [f.cfg.gproj, d];
        f.world.lists = [list("1874880", entries), list("1874910", [d, f.cfg.gproj])];
        const s = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
        expect(s.exitCode, first).toBe(0);
        expect(f.world.launches, first).toHaveLength(1);
      } finally {
        cleanup(f);
      }
    }
  });

  it("prints each list's first entry and the gate's verdict in every dry run", async () => {
    const f = fixture([], { really: false });
    try {
      f.world.lists = [
        list("1874880", [join(f.root, "Owner", "Owner.gproj"), f.cfg.gproj]),
        list("1874910", [decoyGproj(f.cfg.decoyDir), f.cfg.gproj]),
      ];
      const s = await runSession({ ...f.cfg, only: "S-A-3" }, f.deps);
      expect(s.exitCode).toBe(0);
      const out = f.world.lines.join("\n");
      expect(out).toContain("launcher lists, first entry: app 1874880 other; app 1874910 decoy");
      expect(out).toContain("-gproj preselection gate: a real run would REFUSE");
      expect(out).not.toContain("Owner");
      const g = fixture([], { really: false });
      try {
        await runSession({ ...g.cfg, only: "S-A-2" }, g.deps);
        const o2 = g.world.lines.join("\n");
        expect(o2).toContain("launcher lists, first entry: app 1874880 decoy; app 1874910 decoy");
        expect(o2).toContain("-gproj preselection gate: passes");
      } finally {
        cleanup(g);
      }
    } finally {
      cleanup(f);
    }
  });
});

describe("registration unknown stops a real run (m-4)", () => {
  it("refuses S-A-2 while a list cannot be read, or when there is no list at all", async () => {
    const cases: Array<(f: Fixture) => ProjectListFile[]> = [
      (f) => [
        list("1874880", [], false),
        list("1874910", [decoyGproj(f.cfg.decoyDir), f.cfg.gproj]),
      ],
      () => [],
    ];
    for (const lists of cases) {
      const f = fixture([{ ...SANDBOX_OK }]);
      try {
        f.world.lists = lists(f);
        const s = await runSession({ ...f.cfg, only: "S-A-2" }, f.deps);
        expect(s.exitCode).toBe(1);
        expect(s.stopped).toContain("registration unknown");
        expect(s.stopped).toContain("stop and ask the owner");
        expect(f.world.launches).toHaveLength(0);
        expect(f.world.preflightCalls).toHaveLength(0);
      } finally {
        cleanup(f);
      }
    }
  });
});

describe("checked ends keep their records (m-1, m-2)", () => {
  const WB = "ArmaReforgerWorkbenchSteamDiag.exe";

  /** tasklist and taskkill over `alive`; tasklist throws once `failListAfterKills` kills ran. */
  function world2(
    rows: ProcRow[],
    over: { failListAfterKills?: number; failKill?: number[]; createdLater?: number } = {},
  ) {
    const alive = new Map(rows.map((r) => [r.pid, r.name]));
    const calls: string[][] = [];
    let kills = 0;
    let tables = 0;
    const exec = (file: string, args: string[]): string => {
      calls.push([file, ...args]);
      if (file === "tasklist") {
        if (over.failListAfterKills !== undefined && kills >= over.failListAfterKills) {
          throw new Error("tasklist timed out (test)");
        }
        const pid = Number(/PID eq (\d+)/.exec(args.join(" "))?.[1]);
        const img = alive.get(pid);
        return img
          ? `"${img}","${pid}","Console","1","1 K"\r\n`
          : "INFO: No tasks are running which match the specified criteria.\r\n";
      }
      if (file === "taskkill") {
        kills++;
        const pid = Number(args[1]);
        if (over.failKill?.includes(pid)) throw new Error(`taskkill failed for ${pid} (test)`);
        alive.delete(pid);
        return "";
      }
      throw new Error(`unexpected exec of ${file}`);
    };
    // The second table read (just before the root's end) can show another creation time.
    const processTable = async (): Promise<ProcRow[]> => {
      tables++;
      return rows
        .filter((r) => alive.has(r.pid))
        .map((r) =>
          tables > 1 && over.createdLater !== undefined && r.pid === rows[0].pid
            ? { ...r, created: over.createdLater }
            : r,
        );
    };
    return { exec, calls, alive, processTable, tables: () => tables };
  }

  it("a failed process query after an end returns the partial result instead of throwing (m-1)", async () => {
    const w = world2(
      [
        { pid: 42, ppid: 4, name: WB, created: 1000 },
        { pid: 43, ppid: 42, name: WB, created: 1100 },
      ],
      { failListAfterKills: 1 },
    );
    const res = await killOwnWorkbench(w, 42);
    expect(res.ended_pids).toEqual([43]);
    expect(res.ended).toBe(true);
    expect(res.left).toEqual([{ pid: 42, image: WB }]);
    expect(res.detail).toContain("the process list could not be read");
    // A taskkill that fails, followed by a process query that fails: state unknown, left.
    const v = world2([{ pid: 42, ppid: 4, name: WB, created: 1000 }], {
      failKill: [42],
      failListAfterKills: 1,
    });
    const r2 = await killOwnWorkbench(v, 42);
    expect(r2.ended_pids).toEqual([]);
    expect(r2.left).toEqual([{ pid: 42, image: WB }]);
    expect(r2.detail).toContain("could not be read afterwards");
  });

  it("the in-step kill records the child it ended although the next process query fails (m-1)", async () => {
    const f = fixture([{ opened: "OwnerProject", exitAfterMs: null }]);
    try {
      const w = world2(
        [
          { pid: 1001, ppid: 4, name: WB, created: T0 },
          { pid: 1002, ppid: 1001, name: WB, created: T0 + 50 },
        ],
        { failListAfterKills: 1 },
      );
      const deps: SessionDeps = {
        ...f.deps,
        kill: (pid, opts) => killOwnWorkbench(w, pid, opts),
      };
      const r = await runStep(stepById("S-A-2")!, f.cfg, deps, freshState(), []);
      expect(r.kill?.ended_pids).toEqual([1002]);
      expect(readForcedKills(f.cfg.runDir).map((k) => k.pid)).toEqual([1002]);
      expect(r.continue_session).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  it("leaves the started pid running when its creation time differs right before its end (m-2)", async () => {
    const rows: ProcRow[] = [
      { pid: 42, ppid: 4, name: WB, created: 1000 },
      { pid: 43, ppid: 42, name: WB, created: 1100 },
    ];
    // Another creation time at the first read: nothing is ended, children included.
    const a = world2(rows);
    const ra = await killOwnWorkbench(a, 42, { expectCreated: 999 });
    expect(ra.ended_pids).toEqual([]);
    expect(ra.left).toContainEqual({ pid: 42, image: WB });
    expect(a.calls.some((c) => c[0] === "taskkill")).toBe(false);
    // The same time at the first read, another one just before the root's end.
    const b = world2(rows, { createdLater: 5000 });
    const rb = await killOwnWorkbench(b, 42, { expectCreated: 1000 });
    expect(rb.ended_pids).toEqual([43]);
    expect(rb.left).toEqual([{ pid: 42, image: WB }]);
    expect(rb.detail).toContain("created at another time");
    expect(b.tables()).toBe(2);
    // The same time throughout: ended as before.
    const c = world2(rows);
    const rc = await killOwnWorkbench(c, 42, { expectCreated: 1000 });
    expect(rc.ended_pids).toEqual([43, 42]);
    expect(rc.left).toEqual([]);
  });

  it("the in-step kill passes the spawn's creation time, and recover the marker's (m-2)", async () => {
    const f = fixture([{ opened: "OwnerProject", exitAfterMs: null }]);
    try {
      await runStep(stepById("S-A-2")!, f.cfg, f.deps, freshState(), []);
      expect(f.world.killOpts).toEqual([{ descendants: true, expectCreated: T0 }]);
    } finally {
      cleanup(f);
    }
    const g = fixture([]);
    try {
      mkdirSync(g.cfg.runDir, { recursive: true });
      writeFileSync(
        startedMarkerPath(g.cfg.runDir, "S-A-3"),
        JSON.stringify({ step: "S-A-3", started_at: "x", pid: 1003, created: 5000 }),
      );
      g.cfg.lane.record(1003, g.cfg.gproj);
      const seen: Array<{ descendants?: boolean; expectCreated?: number | null }> = [];
      let gone = false;
      const code = await runRecover(g.cfg, {
        platform: "win32",
        now: () => T0,
        sleep: async () => {},
        imageOfPid: () => (gone ? null : WB),
        processTable: async () => [{ pid: 1003, ppid: 4, name: WB, created: 5000 }],
        kill: async (pid, opts) => {
          seen.push({ ...opts });
          gone = true;
          return {
            ended: true,
            ended_pids: [pid],
            left: [],
            descendants_unknown: false,
            detail: "test",
          };
        },
        workbenchPids: () => [],
        log: () => {},
      });
      expect(code).toBe(0);
      expect(seen).toEqual([{ descendants: true, expectCreated: 5000 }]);
    } finally {
      cleanup(g);
    }
  });
});

describe("the U14 rollback confines its manifest (m-3)", () => {
  const deps = {
    fs: NODE_FILE_OPS,
    snapshot: (r: string, p: string[]) => takeSnapshot(r, p),
    now: () => T0,
  };

  it("refuses a manifest whose folder or paths leave the throwaway folder, deleting nothing", () => {
    const f = fixture([]);
    try {
      const m = plantU14(stepById("S-A-6")!, f.cfg.sandboxDir, f.cfg.bundledHandlerDir, deps);
      const victim = f.cfg.gproj;
      const hash = NODE_FILE_OPS.sha256(victim);
      const bad: PlantManifest[] = [
        { ...m, folder: "Scripts" },
        { ...m, folder: "Scripts/WorkbenchGame/EnfusionMCP" },
        {
          ...m,
          files: [...m.files, { path: `${m.folder}/../../../EMCP2_sandbox.gproj`, sha256: hash }],
        },
        { ...m, files: [...m.files, { path: "EMCP2_sandbox.gproj", sha256: hash }] },
        { ...m, created_dirs: [...m.created_dirs, "Scripts/Game"] },
      ];
      for (const b of bad) {
        expect(() => rollbackU14(b, f.cfg.sandboxDir, deps)).toThrow(/manifest refused/);
        expect(existsSync(victim)).toBe(true);
        for (const x of m.files) {
          expect(existsSync(join(f.cfg.sandboxDir, ...x.path.split("/")))).toBe(true);
        }
      }
      // The plant's own manifest still rolls back.
      expect(rollbackU14(m, f.cfg.sandboxDir, deps).ok).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("the rollback command refuses a tampered manifest and writes no rollback record", () => {
    const f = fixture([]);
    try {
      const m = plantU14(stepById("S-A-6")!, f.cfg.sandboxDir, f.cfg.bundledHandlerDir, deps);
      mkdirSync(f.cfg.runDir, { recursive: true });
      const tampered: PlantManifest = {
        ...m,
        files: [{ path: "EMCP2_sandbox.gproj", sha256: NODE_FILE_OPS.sha256(f.cfg.gproj) }],
      };
      writeFileSync(join(f.cfg.runDir, "u14-plant-S-A-6.json"), JSON.stringify(tampered));
      expect(runRollback(f.cfg, f.deps)).toBe(1);
      expect(existsSync(f.cfg.gproj)).toBe(true);
      expect(existsSync(join(f.cfg.runDir, "u14-rollback-S-A-6.json"))).toBe(false);
      expect(f.world.lines.join("\n")).toContain("manifest refused");
    } finally {
      cleanup(f);
    }
  });
});

// ── DEC-033: the idle end rule ───────────────────────────────────────────────

describe("idle end rule (DEC-033)", () => {
  it("ends a step whose log is quiet and whose process uses no CPU as idle: captured, not killed, not retried", async () => {
    const f = fixture([{ opened: "EMCP2_sandbox", exitAfterMs: null, cpuMsPerSec: 0 }]);
    try {
      const s = await runSession({ ...f.cfg, only: "S-A-3" }, f.deps);
      expect(s.exitCode).toBe(1);
      expect(s.stopped).toContain("S-A-3: idle");
      const r = record(f, "S-A-3");
      expect(r.outcome).toBe("idle");
      expect(r.timeout?.phase).toBe("idle");
      expect(r.continue_session).toBe(false);
      expect(r.idle).toMatchObject({ quiet_ms: IDLE_QUIET_MS, decided: true, cpu_ms: 0 });
      expect(r.idle!.window_ms).toBeGreaterThanOrEqual(IDLE_QUIET_MS);
      expect(r.detail).toContain("recover");
      expect(r.detail).toContain("not retried, not killed");
      expect(f.world.kills).toEqual([]);
      expect(f.world.captures).toEqual(["S-A-3-idle"]);
      expect(f.world.windowLists).toBe(1);
      expect(f.world.launches).toHaveLength(1);
      // Far sooner than the 900 s exit timeout.
      expect(f.world.t - f.world.launches[0].spawnedAt).toBeLessThan(IDLE_QUIET_MS + 120_000);
      expect(f.cfg.lane.recordedPid()).toBe(1001);
    } finally {
      cleanup(f);
    }
  });

  it("does not end a step whose process keeps a core busy: the exit timeout decides", async () => {
    const f = fixture([{ opened: "EMCP2_sandbox", exitAfterMs: null, cpuMsPerSec: 500 }]);
    try {
      const r = await runStep(stepById("S-A-3")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("timeout");
      expect(r.timeout?.phase).toBe("exit");
      expect(r.idle?.decided).toBe(false);
      expect(r.idle?.cpu_ms).toBeGreaterThan(0);
    } finally {
      cleanup(f);
    }
  });

  it("waits for the log to stop growing, and takes the quiet period from the config", async () => {
    const f = fixture([
      { opened: "EMCP2_sandbox", exitAfterMs: null, cpuMsPerSec: 0, logGrowsUntilMs: 400_000 },
    ]);
    try {
      const r = await runStep(
        stepById("S-A-3")!,
        { ...f.cfg, idleQuietMs: 60_000 },
        f.deps,
        freshState(),
        [],
      );
      expect(r.outcome).toBe("idle");
      expect(r.idle?.quiet_ms).toBe(60_000);
      // The last log line is at 396 s; the decision needs 60 s of quiet after it was seen.
      const age = f.world.t - f.world.launches[0].spawnedAt;
      expect(age).toBeGreaterThanOrEqual(396_000 + 60_000);
      expect(age).toBeLessThan(400_000 + 60_000 + 40_000);
    } finally {
      cleanup(f);
    }
  });

  it("never decides when the process table carries no CPU time or cannot be read", async () => {
    const f = fixture([{ opened: "EMCP2_sandbox", exitAfterMs: null }]);
    try {
      const r = await runStep(stepById("S-A-3")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("timeout");
      expect(r.idle?.decided).toBe(false);
    } finally {
      cleanup(f);
    }
    const g = fixture([{ opened: "EMCP2_sandbox", exitAfterMs: null, cpuMsPerSec: 0 }]);
    try {
      g.world.tableThrows = true;
      const r = await runStep(stepById("S-A-3")!, g.cfg, g.deps, freshState(), []);
      expect(r.outcome).toBe("timeout");
      expect(r.idle?.table_errors).toBeGreaterThan(0);
    } finally {
      cleanup(g);
    }
  });

  it("does not change any step's launch arguments, and the CLI checks its idle flags", async () => {
    expect(
      STEPS.map((s) =>
        s.verb({ validateConfig: "PC", runDir: "R", sandboxDir: "S", sandboxShortDir: "S~1" }),
      ),
    ).toEqual([
      ["-exitAfterInit"],
      ["-exitAfterInit"],
      ["-wbModule=ScriptEditor", "-validate=PC"],
      ["-wbModule=ResourceManager", "-buildData", "PC", join("R", "buildData")],
      [
        "-wbModule=ResourceManager",
        "-plugin=AddonBuildInfoTool",
        "-addonPath",
        "S",
        "-ciInfoDst",
        join("R", "addon.ci-info.json"),
      ],
      ["-wbModule=ScriptEditor", "-validate=PC"],
      ["-wbModule=ScriptEditor", "-validate=PC"],
      [],
      [
        "-wbModule=ResourceManager",
        "-plugin=AddonBuildInfoTool",
        "-addonPath",
        "S~1",
        "-ciInfoDst",
        join("R", "addon.ci-info.S-A-9.json"),
      ],
      [
        "-wbModule=ResourceManager",
        "-plugin=AddonBuildInfoTool",
        "-addonPath=S~1",
        `-ciInfoDst=${join("R", "addon.ci-info.S-A-10.json")}`,
      ],
    ]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["--idle-quiet-ms", "abc"])).toBe(2);
      expect(await main(["--idle-quiet-ms", "0"])).toBe(2);
      expect(await main(["--idle-cpu-percent", "-1"])).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("validate steps end on the verdict line", () => {
  const SUCCESS: Scenario = {
    opened: "EMCP2_sandbox",
    exitAfterMs: null,
    scriptLines: ["Script validation successful."],
  };

  it("a success verdict: pass, ended through the checked end, the forced kill recorded", async () => {
    const f = fixture([{ ...SUCCESS }]);
    try {
      const r = await runStep(stepById("S-A-3")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("pass");
      expect(r.ended_on).toBe("verdict");
      expect(r.verdict).toMatchObject({ verdict: "successful", error_lines: [], files_named: [] });
      expect(r.verdict!.spawn_to_verdict_ms).toBeLessThan(10_000);
      expect(r.exit.by_itself).toBe(false);
      expect(r.exit.killed_by_run).toBe(true);
      expect(r.continue_session).toBe(true);
      expect(f.world.kills).toEqual([1001]);
      expect(f.world.killOpts[0]).toMatchObject({ descendants: true });
      expect(f.world.killOpts[0].expectCreated).not.toBeUndefined();
      expect(readForcedKills(f.cfg.runDir)).toMatchObject([{ pid: 1001, by: "S-A-3" }]);
      expect(f.world.captures).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("a failure verdict: validation-failed with its error lines", async () => {
    const f = fixture([
      {
        opened: "EMCP2_sandbox",
        exitAfterMs: null,
        scriptErrors: ["Scripts/Game/Foo.c(12): Unknown type 'Bar'"],
        scriptLines: ["Script validation failed."],
      },
    ]);
    try {
      const r = await runStep(stepById("S-A-3")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("validation-failed");
      expect(r.ended_on).toBe("verdict");
      expect(r.verdict?.verdict).toBe("failed");
      expect(r.verdict?.error_lines.join("\n")).toContain("Unknown type 'Bar'");
      expect(r.verdict?.files_named).toEqual(["Foo.c"]);
      expect(r.exit.by_itself).toBe(false);
      expect(r.continue_session).toBe(false);
      expect(f.world.kills).toEqual([1001]);
      expect(readForcedKills(f.cfg.runDir)).toHaveLength(1);
    } finally {
      cleanup(f);
    }
  });

  it("a verdict-pass S-A-3 satisfies S-A-6's gate", async () => {
    const f = fixture([{ ...SUCCESS }, { ...SUCCESS }]);
    try {
      const state = freshState();
      const a = await runStep(stepById("S-A-3")!, f.cfg, f.deps, state, []);
      expect(a.outcome).toBe("pass");
      expect(state.validateSelfExit).toBe(true);
      const b = await runStep(stepById("S-A-6")!, f.cfg, f.deps, state, []);
      expect(b.outcome).toBe("pass");
      expect(b.ended_on).toBe("verdict");
      expect(state.controlClean).toBe(true);
      expect(b.rollback).toMatchObject({ ok: true });
    } finally {
      cleanup(f);
    }
  });

  it("S-A-7: the failed verdict names the planted file, and the rollback runs after the end", async () => {
    const f = fixture([
      {
        opened: "EMCP2_sandbox",
        exitAfterMs: null,
        scriptErrors: [
          `scripts/WorkbenchGame/${U14_FOLDER}/${U14_BROKEN_FILE}(3): Broken expression`,
        ],
        scriptLines: ["Script validation failed."],
      },
    ]);
    try {
      const r = await runStep(stepById("S-A-7")!, f.cfg, f.deps, freshState(U14_READY), []);
      // An (E) line names the planted file: the module failed, whatever the verdict said.
      expect(r.outcome).toBe("workbench-module-failed");
      expect(r.workbench_module_failed).toBe(true);
      expect(r.verdict?.files_named).toEqual([U14_BROKEN_FILE]);
      expect(r.script_errors.naming_broken_file).toBe(1);
      expect(r.continue_session).toBe(true);
      expect(r.rollback).toMatchObject({ ok: true });
      expect(existsSync(join(f.cfg.sandboxDir, "Scripts"))).toBe(false);
      expect(existsSync(join(f.cfg.runDir, "u14-rollback-S-A-7.json"))).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("an exit before any verdict keeps the self-exit path", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const r = await runStep(stepById("S-A-3")!, f.cfg, f.deps, freshState(), []);
      expect(r.outcome).toBe("pass");
      expect(r.ended_on).toBeNull();
      expect(r.verdict).toBeNull();
      expect(r.exit.by_itself).toBe(true);
      expect(f.world.kills).toEqual([]);
      expect(readForcedKills(f.cfg.runDir)).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("names .c files once each, in order", () => {
    expect(filesNamedIn(["a/B.c(1): x", "C.c: y B.c", "no file"])).toEqual(["B.c", "C.c"]);
  });
});

// ── S-A-8, S-A-9 and S-A-7's WorkbenchGame compile line ─────────────────────

describe("S-A-8: retired after its one run (DEC-037, EV-S-A-006)", () => {
  it("holds no launch argv and names why it is retired", () => {
    const step = stepById("S-A-8")!;
    expect(step.retired).toBe(S_A_8_RETIRED);
    expect(step.verb({ validateConfig: "PC", runDir: "R", sandboxDir: "S" })).toEqual([]);
    expect(STEPS.filter((s) => s.retired).map((s) => s.id)).toEqual(["S-A-8"]);
  });

  it("runStep refuses it before anything starts, even after the assertion passed", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const r = await runStep(stepById("S-A-8")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toBe(S_A_8_RETIRED);
      expect(r.command_line).toBe("");
      expect(f.world.kills).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("runSession --only S-A-8 stops before any plan or launch", async () => {
    const f = fixture([], { really: false });
    try {
      const s = await runSession({ ...f.cfg, only: "S-A-8" }, f.deps);
      expect(s.stopped).toBe(S_A_8_RETIRED);
      expect(s.schedule).toEqual([]);
      expect(s.exitCode).toBe(1);
    } finally {
      cleanup(f);
    }
  });
});

describe("S-A-9: -addonPath as the 8.3 short path", () => {
  const GPROJ = "C:\\x\\EMCP2_sandbox\\EMCP2_sandbox.gproj";
  const V = { validateConfig: "PC", runDir: "C:\\run", sandboxDir: "C:\\My Games\\EMCP2_sandbox" };

  it("argv: the short path unquoted and the step's own ci-info file", () => {
    expect(
      stepArgs(stepById("S-A-9")!, GPROJ, [], { ...V, sandboxShortDir: "C:\\MYGAME~1\\EMCP2_~1" }),
    ).toEqual([
      "-gproj",
      GPROJ,
      "-wbModule=ResourceManager",
      "-plugin=AddonBuildInfoTool",
      "-addonPath",
      "C:\\MYGAME~1\\EMCP2_~1",
      "-ciInfoDst",
      join("C:\\run", "addon.ci-info.S-A-9.json"),
    ]);
  });

  it("the verb refuses without a short path", () => {
    expect(() => stepArgs(stepById("S-A-9")!, GPROJ, [], V)).toThrow(SHORT_PATH_REFUSAL);
  });

  it("the cmd line and the parse: a long path with a space back means no short name", () => {
    expect(shortPathCommand("C:\\My Games\\S")).toBe(
      '/d /s /c for %I in ("C:\\My Games\\S") do @echo %~sI',
    );
    expect(parseShortPath("C:\\MYGAME~1\\EMCP2_~1\r\n")).toBe("C:\\MYGAME~1\\EMCP2_~1");
    expect(parseShortPath("C:\\My Games\\EMCP2_sandbox\r\n")).toBeNull();
    expect(parseShortPath("")).toBeNull();
    expect(parseShortPath("C:\\A\r\nC:\\B")).toBeNull();
    expect(parseShortPath("-gproj")).toBeNull();
  });

  it("runStep refuses with the message and launches nothing when no short path was resolved", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const r = await runStep(stepById("S-A-9")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toBe(SHORT_PATH_REFUSAL);
      expect(f.world.kills).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("pass: exit 0 and the ci-info JSON parses; exit 1 or bad JSON is flag-ignored", async () => {
    const write = (body: string) => (_a: string[], cfg: SessionConfig) =>
      writeFileSync(join(cfg.runDir, "addon.ci-info.S-A-9.json"), body, { flag: "w" });
    const cases: [number, string, string][] = [
      [0, '{"addon":"x"}', "pass"],
      [1, '{"addon":"x"}', "flag-ignored"],
      [0, "not json", "flag-ignored"],
    ];
    for (const [exitCode, body, want] of cases) {
      const f = fixture([{ ...SANDBOX_OK, exitCode, onSpawn: write(body) }]);
      try {
        const st = freshState({ ...U14_READY, sandboxShortDir: "C:\\MYGAME~1\\EMCP2_~1" });
        const r = await runStep(stepById("S-A-9")!, f.cfg, f.deps, st, []);
        expect(r.outcome, `exit ${exitCode} ${body}`).toBe(want);
        expect(r.output).toMatchObject({ file: "addon.ci-info.S-A-9.json" });
      } finally {
        cleanup(f);
      }
    }
  });
});

describe("S-A-10: -addonPath= and -ciInfoDst= as single tokens", () => {
  const GPROJ = "C:\\x\\EMCP2_sandbox\\EMCP2_sandbox.gproj";
  const V = { validateConfig: "PC", runDir: "C:\\run", sandboxDir: "C:\\My Games\\EMCP2_sandbox" };
  const SHORT = "C:\\MYGAME~1\\EMCP2_~1";

  it("argv: each value inside its flag's own = token, no separate value argument", () => {
    const args = stepArgs(stepById("S-A-10")!, GPROJ, [], { ...V, sandboxShortDir: SHORT });
    expect(args).toEqual([
      "-gproj",
      GPROJ,
      "-wbModule=ResourceManager",
      "-plugin=AddonBuildInfoTool",
      `-addonPath=${SHORT}`,
      `-ciInfoDst=${join("C:\\run", "addon.ci-info.S-A-10.json")}`,
    ]);
    expect(args).not.toContain("-addonPath");
    expect(args).not.toContain("-ciInfoDst");
  });

  it("the verb refuses without a short path or with a space in the run path", () => {
    expect(() => stepArgs(stepById("S-A-10")!, GPROJ, [], V)).toThrow(SHORT_PATH_REFUSAL);
    expect(() =>
      stepArgs(stepById("S-A-10")!, GPROJ, [], {
        ...V,
        runDir: "C:\\My Runs\\r1",
        sandboxShortDir: SHORT,
      }),
    ).toThrow(RUN_PATH_SPACE_REFUSAL);
  });

  it("runStep refuses and launches nothing without a short path", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const r = await runStep(stepById("S-A-10")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toBe(SHORT_PATH_REFUSAL);
      expect(f.world.kills).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("runStep refuses and launches nothing when the run path holds a space", async () => {
    const f = fixture([{ ...SANDBOX_OK }]);
    try {
      const st = freshState({ ...U14_READY, sandboxShortDir: SHORT });
      const cfg = { ...f.cfg, runDir: "C:\\My Runs\\r1" };
      const r = await runStep(stepById("S-A-10")!, cfg, f.deps, st, []);
      expect(r.outcome).toBe("refused");
      expect(r.detail).toBe(RUN_PATH_SPACE_REFUSAL);
      expect(f.world.kills).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  it("pass: exit 0 and the ci-info JSON parses; exit 1 or bad JSON is flag-ignored", async () => {
    const write = (body: string) => (_a: string[], cfg: SessionConfig) =>
      writeFileSync(join(cfg.runDir, "addon.ci-info.S-A-10.json"), body, { flag: "w" });
    const cases: [number, string, string][] = [
      [0, '{"addon":"x"}', "pass"],
      [1, '{"addon":"x"}', "flag-ignored"],
      [0, "not json", "flag-ignored"],
    ];
    for (const [exitCode, body, want] of cases) {
      const f = fixture([{ ...SANDBOX_OK, exitCode, onSpawn: write(body) }]);
      try {
        expect(f.cfg.runDir).not.toMatch(/\s/);
        const st = freshState({ ...U14_READY, sandboxShortDir: SHORT });
        const r = await runStep(stepById("S-A-10")!, f.cfg, f.deps, st, []);
        expect(r.outcome, `exit ${exitCode} ${body}`).toBe(want);
        expect(r.output).toMatchObject({ file: "addon.ci-info.S-A-10.json" });
      } finally {
        cleanup(f);
      }
    }
  });
});

describe("idle rule defaults", () => {
  it("5 % of one core over a 300 s quiet period", () => {
    expect(IDLE_CPU_PERCENT).toBe(5);
    expect(IDLE_QUIET_MS).toBe(300_000);
  });
});

describe("S-A-8 and S-A-9 run by --only only", () => {
  it("a full or --from sequence leaves them out; --only picks each", () => {
    const ids = (x: { id: string }[]) => x.map((s) => s.id);
    expect(ids(selectSteps({}))).not.toContain("S-A-8");
    expect(ids(selectSteps({ from: "S-A-5" }))).toEqual(["S-A-5", "S-A-6", "S-A-7"]);
    expect(ids(selectSteps({ only: "S-A-8" }))).toEqual(["S-A-8"]);
    expect(ids(selectSteps({ only: "S-A-9" }))).toEqual(["S-A-9"]);
    expect(ids(selectSteps({}))).not.toContain("S-A-10");
    expect(ids(selectSteps({ only: "S-A-10" }))).toEqual(["S-A-10"]);
  });
});

describe("S-A-7 reads the WorkbenchGame compile line", () => {
  it("the log line or an (E) line naming the planted file", () => {
    expect(workbenchModuleFailed(`12:00:00.000 SCRIPT (E): ${WORKBENCH_MODULE_FAILED_LINE}`)).toBe(
      true,
    );
    expect(workbenchModuleFailed(`SCRIPT (E): x/${U14_BROKEN_FILE}(3): Broken`)).toBe(true);
    expect(workbenchModuleFailed(`SCRIPT (W): x/${U14_BROKEN_FILE}(3): warn`)).toBe(false);
    expect(workbenchModuleFailed("Script validation successful.")).toBe(false);
  });

  it("a success verdict with the module line is workbench-module-failed and continues", async () => {
    const f = fixture([
      {
        opened: "EMCP2_sandbox",
        exitAfterMs: null,
        scriptLines: [WORKBENCH_MODULE_FAILED_LINE, "Script validation successful."],
      },
    ]);
    try {
      const r = await runStep(stepById("S-A-7")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.verdict?.verdict).toBe("successful");
      expect(r.outcome).toBe("workbench-module-failed");
      expect(r.workbench_module_failed).toBe(true);
      expect(r.continue_session).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  it("a success verdict without it stays pass, flag false", async () => {
    const f = fixture([
      {
        opened: "EMCP2_sandbox",
        exitAfterMs: null,
        scriptLines: ["Script validation successful."],
      },
    ]);
    try {
      const r = await runStep(stepById("S-A-7")!, f.cfg, f.deps, freshState(U14_READY), []);
      expect(r.outcome).toBe("pass");
      expect(r.workbench_module_failed).toBe(false);
    } finally {
      cleanup(f);
    }
  });
});
