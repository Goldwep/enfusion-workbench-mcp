import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLease } from "../../src/workbench/lease.js";
import { Lane } from "../../scripts/live/lane.js";
import { encodePascalString } from "../../src/workbench/protocol.js";
import { checkPlan, main as dryRunMain, type PlanAction } from "../../scripts/live/dry-run.js";
import { BUNDLED_HANDLER_DIR, HANDLER_FOLDER } from "../../scripts/live/launch.js";
import { startMockNetServer } from "../../scripts/live/mock/net.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { ASSERT_WAIT_MS, validateQueue, PROBE_ORDER } from "../../scripts/live/preflight.js";
import { BACKGROUND_CAP_MS } from "../../scripts/live/session-common.js";
import {
  BI_EXCLUDED,
  BLOCKS,
  HELPER,
  TIMEOUTS,
  detachedBudgetMs,
  invocationWorstCaseMs,
  realDeps,
  runRollback,
  selectedIds,
  selectionRefusal,
  sha256Hex,
  walkerCmdRefusal,
  BI_INCLUDED,
  BI_REVERSIBLE,
  CHILD_ENV,
  DOCUMENTED_WALKER_CMD,
  DEC019_CHECKS,
  DEFAULT_QUEUE,
  EXIT,
  NOT_ANSWERED,
  PING_FILE,
  SCRIPT_PATH,
  StopSession,
  U13_DEFAULTS,
  U29_COLD_LINK,
  U29_FORWARD_LINK,
  U3_PLANT_FILE,
  U3_PLANT_FOLDER,
  U7_LATER_MS,
  VANILLA,
  baselineProblem,
  buildActionPlan,
  buildQueue,
  buildSteps,
  burstPerCallMs,
  childRequest,
  conditionalNotAnswered,
  editPingSource,
  insideDir,
  isDialogLike,
  loadedProjectsProblem,
  SCRATCH_INI_PLACEHOLDER,
  forceSettingsRefusal,
  iniScriptDebugMode,
  main,
  namesSandbox,
  notAnswered,
  parseResponseFrame,
  planInput,
  plantedSource,
  rawNetCall,
  resourceManagerWindow,
  runChildCall,
  runSession,
  scriptDebugMode,
  tinyWorldProblem,
  titleNames,
  validateU29Link,
  walkerArgv,
  windowChanges,
  withRestore,
  worldEditorWindow,
  worstCaseTotalMs,
  type DetachedSpec,
  type RawCallResult,
  type SessionDeps,
  type SessionOptions,
  type WindowInfo,
} from "../../scripts/live/s-c-natives.js";

// Everything below is synthetic: pids, window classes, titles, paths and NET
// answers are test data, not Workbench facts. No socket reaches port 5775 or
// 5776; the raw-call tests use an ephemeral local listener.

const repoPolicy = loadPolicy();
const undoPolicy: CensusPolicy = {
  ...repoPolicy,
  execute_action: { ...repoPolicy.execute_action, allow_list: [["Edit", "Undo"]] },
};
/** The policy without the Edit > Undo entry DEC-029 added for U19. */
const noUndoPolicy: CensusPolicy = {
  ...repoPolicy,
  execute_action: { ...repoPolicy.execute_action, allow_list: [] },
};

const TMP = mkdtempSync(join(tmpdir(), "emcp-sc-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const SANDBOX = join(TMP, "addons", SANDBOX_NAME);
const GPROJ = join(SANDBOX, `${SANDBOX_NAME}.gproj`);
const TINY = "Worlds/ECEN_tiny.ent";
const WB = "ArmaReforgerWorkbenchSteamDiag.exe";
const FIRST = 1000;
const COLD = 2000;
const SECOND = 3000;
const LOG_LINE = (project: string): string =>
  `ENGINE: Using autosave directory: T:/planted/Projects/${project}/autosaves\n`;
const PING_BUNDLE = readFileSync(join(BUNDLED_HANDLER_DIR, PING_FILE));
const INSTALLED_PING = join(SANDBOX, "Scripts", "WorkbenchGame", HANDLER_FOLDER, PING_FILE);
/** The scratch ini a real run passes as --force-settings (TMP is the artifacts folder in tests). */
const SCRATCH_INI = join(TMP, "scratch.ini");
const INI_OFF = "[World%20Editor]\r\nScriptDebugMode=false\r\n";
writeFileSync(SCRATCH_INI, INI_OFF);

// ── Mock dependencies ────────────────────────────────────────────────────────

interface Scenario {
  recordedPid: number | null;
  recordedImage: string;
  foreignPortOwner: number | null;
  scriptsCompiled: boolean;
  loaded: string[];
  logProject: string;
  coldLogProject: string;
  coldLauncher: boolean;
  closeFails: number[];
  secondStays: boolean;
  /** Net call (1-based, over deps.net) that times out. */
  timeoutAt: number | null;
  /** apiFunc after which the Workbench main window is disabled (a modal). */
  modalAfter: string | null;
  /** Detached result names (prefix) that never appear. */
  detachedNever: string[];
  undoRemoves: boolean;
  reloadCompiles: boolean;
  tinyWorld: boolean;
  installedPingDiffers: boolean;
  walkerTimesOut: boolean;
  /** WM_NULL unanswered: from the start, or only after the walker ran. */
  guiHung: "start" | "after-walk" | null;
  /** The NET port stays held after the first Workbench exits. */
  portStuck: boolean;
  /** The second U29 process stays at the launcher picker. */
  secondLauncher: boolean;
  /** The second U29 process stays with a #32770 box. */
  secondDialog: boolean;
  /** The running Workbench shows the launcher picker after the second spawn (the recorded hazard). */
  firstLauncherAfterSecond: boolean;
  /** The running Workbench stops answering after the second spawn. */
  firstDropsAfterSecond: boolean;
  /** Project named by a session log the second process writes. */
  secondLogProject: string | null;
  /** Removing the planted U3 file does nothing. */
  removeFails: boolean;
  /** Writing the original bytes back to the installed Ping does nothing. */
  restoreFails: boolean;
  /** apiFunc after which an owned dialog window appears on the Workbench. */
  dialogAfter: string | null;
  /** apiFunc after which an owned window titled with the opened resource appears. */
  ownedEditorAfter: string | null;
  /** An owned dialog is already up when the gate takes its baseline. */
  baselineDialog: boolean;
  /** A world with entities is open from the start (Workbench reopened its last world). */
  worldOpenAtStart: boolean;
  /** Title of the Workbench main window. */
  mainTitle: string;
  /** Title of the World Editor window once a world is open (null: no such window). */
  worldEditorTitle: string | null;
  /** The tiny world's mode and entity count once it is open. */
  tinyMode: string;
  tinyEntities: number;
  /** Lines of the pre-flight registry export. */
  reg: string[];
  /** Text of the forced settings ini (any path ending in .ini). */
  ini: string;
  /** apiFunc of a detached call during which an owned dialog appears on the Workbench. */
  dialogDuring: string | null;
  /** Workbench adds a .meta file beside the planted U3 file. */
  metaAdded: boolean;
  respond?: (apiFunc: string, params: Record<string, unknown>) => RawCallResult | null;
}

const BASE: Scenario = {
  recordedPid: FIRST,
  recordedImage: WB,
  foreignPortOwner: null,
  scriptsCompiled: true,
  loaded: ["ArmaReforger", SANDBOX_NAME],
  logProject: SANDBOX_NAME,
  coldLogProject: SANDBOX_NAME,
  coldLauncher: false,
  closeFails: [],
  secondStays: false,
  timeoutAt: null,
  modalAfter: null,
  detachedNever: [],
  undoRemoves: true,
  reloadCompiles: true,
  tinyWorld: true,
  installedPingDiffers: false,
  walkerTimesOut: false,
  guiHung: null,
  portStuck: false,
  secondLauncher: false,
  secondDialog: false,
  firstLauncherAfterSecond: false,
  firstDropsAfterSecond: false,
  secondLogProject: null,
  removeFails: false,
  restoreFails: false,
  dialogAfter: null,
  ownedEditorAfter: null,
  baselineDialog: false,
  worldOpenAtStart: false,
  mainTitle: "Resource Manager",
  worldEditorTitle: "World Editor - ECEN_tiny",
  tinyMode: "edit",
  tinyEntities: 3,
  reg: ["[HKEY_CURRENT_USER\\Software\\Test\\World Editor]", '"ScriptDebugMode"=dword:00000000'],
  ini: INI_OFF,
  dialogDuring: null,
  metaAdded: false,
};

function ok(response?: unknown): RawCallResult {
  return {
    ok: true,
    response,
    timedOut: false,
    durationMs: 5,
    bytesSent: 10,
    bytesReceived: 10,
    wire: { status: "Ok", payload: response === undefined ? "absent" : "present" },
  };
}
function err(status: string): RawCallResult {
  return {
    ok: false,
    error: `Workbench error: ${status}`,
    timedOut: false,
    durationMs: 5,
    bytesSent: 10,
    bytesReceived: 10,
    wire: { status, payload: "absent" },
  };
}
const TIMED_OUT: RawCallResult = {
  ok: false,
  error: "timed out (mock)",
  timedOut: true,
  durationMs: 0,
  bytesSent: 10,
  bytesReceived: 0,
};

interface Harness {
  deps: SessionDeps;
  netCalls: Array<{ apiFunc: string; params: Record<string, unknown>; concurrent: number }>;
  maxConcurrent: number;
  captures: string[];
  windowLists: number;
  closed: number[];
  launches: string[][];
  second: string[][];
  detached: DetachedSpec[];
  walker: string[][];
  files: Map<string, Buffer>;
  writes: Array<{ path: string; exclusive: boolean }>;
  artifacts: Map<string, unknown>;
  evidence: string[];
}

function harness(over: Partial<Scenario> = {}): Harness {
  const sc: Scenario = { ...BASE, ...over };
  let t = 1_700_000_000_000;
  let inFlight = 0;
  const h: Harness = {
    deps: undefined as unknown as SessionDeps,
    netCalls: [],
    maxConcurrent: 0,
    captures: [],
    windowLists: 0,
    closed: [],
    launches: [],
    second: [],
    detached: [],
    walker: [],
    files: new Map([[join(BUNDLED_HANDLER_DIR, PING_FILE), PING_BUNDLE]]),
    writes: [],
    artifacts: new Map(),
    evidence: [],
  };
  h.files.set(
    INSTALLED_PING,
    sc.installedPingDiffers ? Buffer.from("// edited\n") : Buffer.from(PING_BUNDLE),
  );
  if (sc.tinyWorld) h.files.set(join(SANDBOX, TINY), Buffer.from("tiny"));
  const images = new Map<number, string | null>();
  if (sc.recordedPid !== null) images.set(sc.recordedPid, sc.recordedImage);
  let port: number[] = sc.foreignPortOwner !== null ? [sc.foreignPortOwner] : [FIRST];
  const disabled = new Set<number>();
  /** Extra windows per pid (dialogs, editors), added by the scenario. */
  const extra = new Map<number, WindowInfo[]>();
  const entities = new Map<string, string>();
  const results = new Map<string, { at: number; result: RawCallResult }>();
  let netN = 0;
  let launchedCold = false;
  let secondLaunched = false;
  let walked = false;
  let worldOpen = sc.worldOpenAtStart;
  const wbPid = (): number => (launchedCold ? COLD : FIRST);

  const win = (
    pid: number,
    title: string,
    hwnd: number,
    owner = 0,
    cls = "TestQtMain",
  ): WindowInfo => ({
    hwnd,
    pid,
    className: cls,
    title,
    owner,
    enabled: owner !== 0 || !disabled.has(pid),
    rect: [0, 0, 1000, 800],
    monitor: [0, 0, 2560, 1440],
    primary: true,
  });
  const addExtra = (pid: number, w: WindowInfo): void => {
    extra.set(pid, [...(extra.get(pid) ?? []), w]);
  };
  if (sc.baselineDialog) addExtra(FIRST, win(FIRST, "Some prompt", FIRST * 10 + 1, FIRST * 10));

  const answer = (apiFunc: string, params: Record<string, unknown>): RawCallResult => {
    const custom = sc.respond?.(apiFunc, params);
    if (custom) return custom;
    if (secondLaunched && sc.firstDropsAfterSecond && apiFunc === "IsWorkbenchRunning") {
      return {
        ok: false,
        error: "read ECONNRESET",
        timedOut: false,
        durationMs: 5,
        bytesSent: 10,
        bytesReceived: 0,
      };
    }
    switch (apiFunc) {
      case "IsWorkbenchRunning":
      case "IsWorldEditorRunning":
        return ok({ IsRunning: true, ScriptsCompiled: sc.scriptsCompiled });
      case "GetLoadedProjects":
        return ok({ "Loaded Projects": sc.loaded });
      case "EMCP_WB_Ping": {
        const text = h.files.get(INSTALLED_PING)!.toString("utf-8");
        const m = /\[S-C U4 [a-z0-9]+\]/.exec(text);
        return ok({
          status: "ok",
          mode: worldOpen ? sc.tinyMode : "edit",
          message: `EnfusionMCP Workbench bridge active${sc.reloadCompiles && m && reloaded ? ` ${m[0]}` : ""}`,
        });
      }
      case "EvaluateScript":
        return err("Undefined API func");
      case "OpenResource":
        if (String(params.ResourceName).endsWith(".ent")) worldOpen = true;
        return ok({ Opened: true });
      case "EMCP_WB_GetState":
        return ok({ status: "ok", mode: "edit", entityCount: worldOpen ? sc.tinyEntities : 0 });
      case "EMCP_WB_CreateEntity":
        entities.set(String(params.name), "-0.008");
        return ok({ status: "ok", entityName: params.name });
      case "EMCP_WB_GetEntity":
        return ok(entities.has(String(params.name)) ? { status: "ok" } : { status: "error" });
      case "EMCP_WB_EditorControl":
        if (sc.undoRemoves) entities.delete([...entities.keys()].pop()!);
        return ok({ status: "ok" });
      case "EMCP_WB_DeleteEntity":
        entities.delete(String(params.name));
        return ok({ status: "ok" });
      case "EMCP_WB_Components":
        return ok({
          status: "ok",
          components: [
            { className: "MeshObject", index: 0 },
            { className: U13_DEFAULTS.component, index: 1 },
          ],
        });
      case "EMCP_WB_ModifyEntity":
        if (params.action === "setProperty") {
          entities.set(String(params.name), String(params.value));
          return ok({ status: "ok" });
        }
        return ok({ status: "ok", message: entities.get(String(params.name)) ?? "" });
      default:
        return ok({});
    }
  };
  let reloaded = false;

  h.deps = {
    net: async (apiFunc, params) => {
      const n = ++netN;
      inFlight++;
      h.maxConcurrent = Math.max(h.maxConcurrent, inFlight);
      h.netCalls.push({ apiFunc, params, concurrent: inFlight });
      // A macrotask: every call of the U30 burst starts before any of them answers.
      await new Promise<void>((r) => setImmediate(r));
      inFlight--;
      const r = sc.timeoutAt === n ? TIMED_OUT : answer(apiFunc, params);
      const pid = wbPid();
      if (sc.modalAfter === apiFunc) disabled.add(pid);
      if (sc.dialogAfter === apiFunc) addExtra(pid, win(pid, "A prompt", pid * 10 + 2, pid * 10));
      if (sc.ownedEditorAfter === apiFunc) {
        const name = String(params.ResourceName ?? params.path ?? "x")
          .replace(/^.*\//, "")
          .replace(/\.[^.]+$/, "");
        addExtra(pid, win(pid, `${name} - Editor`, pid * 10 + 100 + n, pid * 10));
      }
      return r;
    },
    listWindows: async () => {
      h.windowLists++;
      const out: WindowInfo[] = [];
      for (const [pid, image] of images) {
        if (image === null) continue;
        if (pid === COLD && sc.coldLauncher)
          out.push(win(pid, "Enfusion Workbench Launcher", pid * 10));
        else if (pid === SECOND && sc.secondLauncher)
          out.push(win(pid, "Enfusion Workbench Launcher", pid * 10));
        else out.push(win(pid, sc.mainTitle, pid * 10));
        if (pid === wbPid() && worldOpen && sc.worldEditorTitle)
          out.push(win(pid, sc.worldEditorTitle, pid * 10 + 5));
        if (pid === SECOND && sc.secondDialog)
          out.push(win(pid, "Error", pid * 10 + 3, 0, "#32770"));
        if (pid === wbPid() && secondLaunched && sc.firstLauncherAfterSecond)
          out.push(win(pid, "Enfusion Workbench Launcher", pid * 10 + 4));
        out.push(...(extra.get(pid) ?? []));
      }
      out.push(win(9999, "someone else's window", 99990));
      return out;
    },
    capture: async (label) => {
      h.captures.push(label);
      return { ok: true, path: `capture-${label}.png`, detail: "mock" };
    },
    guiStall: async (_pid, samples) =>
      Array.from({ length: samples }, () =>
        sc.guiHung === "start" || (sc.guiHung === "after-walk" && walked) ? null : 3,
      ),
    processImage: (pid) => images.get(pid) ?? null,
    processCreated: async (pid) => (images.get(pid) ? pid * 10 : null),
    listRunFiles: () => [
      ...h.artifacts.keys(),
      ...[...results].filter(([, e]) => t >= e.at).map(([n]) => n),
    ],
    listDir: (p) =>
      [...h.files.keys()]
        .filter((k) => k.startsWith(p + "\\") || k.startsWith(p + "/"))
        .map((k) => k.slice(p.length + 1)),
    portOwners: () => port,
    crashReporters: () => (sc.portStuck ? [7777] : []),
    closeGracefully: async (pid) => {
      h.closed.push(pid);
      if (sc.closeFails.includes(pid))
        return { exited: false, detail: "closeSent true, exited false" };
      images.set(pid, null);
      if (!sc.portStuck) port = port.filter((p) => p !== pid);
      return { exited: true, detail: "closeSent true, exited true" };
    },
    launchRecorded: (extraArgs) => {
      h.launches.push(extraArgs);
      launchedCold = true;
      images.set(COLD, WB);
      port = [COLD];
      return COLD;
    },
    launchUnrecorded: (extraArgs) => {
      h.second.push(extraArgs);
      secondLaunched = true;
      const stays = sc.secondStays || sc.secondLauncher || sc.secondDialog;
      images.set(SECOND, stays ? WB : null);
      return SECOND;
    },
    recordedPid: () => sc.recordedPid,
    heartbeat: () => {},
    sessionLogAfter: (after) =>
      after === null
        ? "LOG1"
        : secondLaunched && sc.secondLogProject
          ? "LOG3"
          : launchedCold
            ? "LOG2"
            : null,
    readText: (p) =>
      /\.ini$/i.test(p)
        ? sc.ini
        : LOG_LINE(
            p === "LOG3" ? sc.secondLogProject! : p === "LOG2" ? sc.coldLogProject : sc.logProject,
          ),
    readRegLines: () => sc.reg,
    fileExists: (p) =>
      h.files.has(p) ||
      [...h.files.keys()].some((k) => k.startsWith(p + "\\") || k.startsWith(p + "/")),
    readBytes: (p) => {
      const b = h.files.get(p);
      if (!b) throw new Error(`no file ${p}`);
      return b;
    },
    writeBytes: (p, data, exclusive) => {
      if (exclusive && h.files.has(p)) throw new Error("EEXIST");
      h.writes.push({ path: p, exclusive });
      if (sc.restoreFails && p === INSTALLED_PING && Buffer.from(data).equals(PING_BUNDLE)) return;
      h.files.set(p, Buffer.from(data));
    },
    removeFile: (p) => {
      if (sc.removeFails && p.endsWith(U3_PLANT_FILE)) return;
      h.files.delete(p);
    },
    makeDir: () => {},
    removeEmptyDir: () => {},
    startDetached: (spec) => {
      h.detached.push(spec);
      if (sc.dialogDuring === spec.apiFunc) {
        addExtra(wbPid(), win(wbPid(), "Compile error", wbPid() * 10 + 7, wbPid() * 10));
      }
      if (sc.metaAdded && spec.apiFunc === "ValidateScripts") {
        const planted = [...h.files.keys()].find((k) => k.endsWith(U3_PLANT_FILE));
        if (planted) h.files.set(`${planted}.meta`, Buffer.from("meta"));
      }
      if (sc.detachedNever.some((n) => spec.resultName.includes(n))) return 4242;
      let r: RawCallResult;
      if (spec.apiFunc === "ValidateScripts") {
        const planted = [...h.files.keys()].some((k) => k.endsWith(U3_PLANT_FILE));
        r = ok({
          Errors: planted
            ? [
                {
                  error: "syntax",
                  file: `scripts/WorkbenchGame/${U3_PLANT_FOLDER}/${U3_PLANT_FILE}`,
                },
              ]
            : [],
          Warnings: [],
          Success: !planted,
        });
      } else {
        reloaded = true;
        r = ok();
      }
      results.set(spec.resultName, { at: t + 10_000, result: r });
      return 4242;
    },
    readRunFile: (name) => {
      const e = results.get(name);
      if (e && t >= e.at) return JSON.stringify(e.result);
      const a = h.artifacts.get(name);
      return a === undefined ? null : JSON.stringify(a);
    },
    runWalker: async (argv) => {
      h.walker.push(argv);
      walked = true;
      return sc.walkerTimesOut
        ? { exitCode: null, timedOut: true, lastLine: null }
        : { exitCode: 0, timedOut: false, lastLine: '{"nodes":12}' };
    },
    writeArtifact: (name, value) => {
      h.artifacts.set(name, JSON.parse(JSON.stringify(value)));
      return `run/${name}`;
    },
    writeEvidence: (summary) => {
      h.evidence.push(summary);
      return `EV-S-C-${String(h.evidence.length).padStart(3, "0")}`;
    },
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    log: () => {},
  };
  return h;
}

function options(over: Partial<SessionOptions> = {}): SessionOptions {
  return {
    sandboxDir: SANDBOX,
    gproj: GPROJ,
    tinyWorld: TINY,
    walkerCmd: [
      "{node}",
      "walk.ts",
      "--pid",
      "{pid}",
      "--class",
      "{class}",
      "--title-pattern",
      "{title}",
      "--out",
      "{out}",
    ],
    from: null,
    until: null,
    openedProjectPattern:
      "Using autosave directory: .*[\\\\/]Projects[\\\\/]([^\\\\/]+)[\\\\/]autosaves",
    allowedAddons: ["ArmaReforger"],
    nonce: "abc123",
    runDir: join(TMP, "run"),
    laneId: "sc-test",
    policy: undoPolicy,
    u13: U13_DEFAULTS,
    u29Forward: true,
    registryExport: "REG",
    debugModeUnsetOk: false,
    ...over,
  };
}

/** Status of each step id in a report. */
function statuses(r: Awaited<ReturnType<typeof runSession>>): Record<string, string> {
  return Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
}

// ── The dry-run plan ─────────────────────────────────────────────────────────

describe("action plan", () => {
  const variants = [
    { name: "tiny world, undo allow-listed", tiny: true, policy: undoPolicy },
    { name: "tiny world, repo policy", tiny: true, policy: repoPolicy },
    { name: "no tiny world, repo policy", tiny: false, policy: repoPolicy },
    { name: "tiny world, no undo entry", tiny: true, policy: noUndoPolicy },
  ];
  for (const v of variants) {
    it(`passes the checker with the policy (${v.name})`, () => {
      const p = planInput({
        sandboxDir: SANDBOX,
        tinyWorld: v.tiny ? TINY : null,
        tinyWorldPresent: v.tiny,
        policy: v.policy,
        nonce: "n",
      });
      const plan = buildActionPlan(p);
      const r = checkPlan(plan, v.policy, { script: SCRIPT_PATH });
      expect(r.violations).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }

  it("without Edit > Undo on the allow-list carries no ExecuteAction; the repo policy lists it (DEC-029)", () => {
    const plan = buildActionPlan(
      planInput({
        sandboxDir: SANDBOX,
        tinyWorld: TINY,
        tinyWorldPresent: true,
        policy: noUndoPolicy,
        nonce: "n",
      }),
    );
    expect(plan.some((a) => a.kind === "execute-action")).toBe(false);
    expect(plan.some((a) => a.target === "EMCP_WB_EditorControl")).toBe(false);
    // Allow-listed, the undo is in the plan as the ExecuteAction it is.
    const allowed = buildActionPlan(
      planInput({
        sandboxDir: SANDBOX,
        tinyWorld: TINY,
        tinyWorldPresent: true,
        policy: repoPolicy,
        nonce: "n",
      }),
    );
    expect(allowed.filter((a) => a.kind === "execute-action")).toEqual([
      expect.objectContaining({ target: { path: ["Edit", "Undo"], module: "WorldEditor" } }),
    ]);
    // ...and the checker refuses that plan under a policy without the entry.
    expect(checkPlan(allowed, noUndoPolicy, { script: SCRIPT_PATH }).violations).toEqual([
      expect.objectContaining({ rule: "not-allow-listed" }),
    ]);
  });

  it("carries the launches as launch actions and the walks as uia-read actions", () => {
    const p = planInput({
      sandboxDir: SANDBOX,
      tinyWorld: TINY,
      tinyWorldPresent: true,
      policy: repoPolicy,
      nonce: "n",
      u29Forward: true,
    });
    const plan = buildActionPlan(p);
    expect(plan.filter((a) => a.kind === "launch").map((a) => [a.step, a.args])).toEqual([
      [
        "sc-09-u29-cold",
        ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI_PLACEHOLDER, `-uri=${U29_COLD_LINK}`],
      ],
      [
        "sc-10-u29-forward",
        ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI_PLACEHOLDER, `-uri=${U29_FORWARD_LINK}`],
      ],
    ]);
    const reads = plan.filter((a) => a.kind === "uia-read");
    expect(reads.map((a) => a.step)).toEqual(["sc-06-u7-walk", "sc-11b-u7-walk-world"]);
    for (const a of reads) {
      expect(a).toMatchObject({ readOnly: true, target: { pid: "lane-recorded" } });
    }
    // Without the forward and without the tiny world, those actions leave the plan.
    const lean = buildActionPlan(
      planInput({
        sandboxDir: SANDBOX,
        tinyWorld: null,
        tinyWorldPresent: false,
        policy: repoPolicy,
        nonce: "n",
      }),
    );
    expect(lean.filter((a) => a.kind === "launch").map((a) => a.step)).toEqual(["sc-09-u29-cold"]);
    expect(lean.filter((a) => a.kind === "uia-read").map((a) => a.step)).toEqual(["sc-06-u7-walk"]);
    // A launch of another project, or a walk without bounds, fails the checker.
    const bad = plan.map((a) =>
      a.step === "sc-09-u29-cold" && a.kind === "launch"
        ? {
            ...a,
            args: ["-gproj", "C:/x/OwnerMod/OwnerMod.gproj"],
            target: { gproj: "C:/x/OwnerMod/OwnerMod.gproj" },
          }
        : a.kind === "uia-read"
          ? { ...a, bounds: {} }
          : a,
    ) as PlanAction[];
    const rules = checkPlan(bad, repoPolicy, { script: SCRIPT_PATH }).violations.map((v) => v.rule);
    expect(rules).toContain("launch-not-sandbox");
    expect(rules).toContain("uia-read-unbounded");
  });

  it("holds no key, invoke or menu action, and no denied API", () => {
    const plan = buildActionPlan(
      planInput({
        sandboxDir: null,
        tinyWorld: TINY,
        tinyWorldPresent: true,
        policy: undoPolicy,
        nonce: "n",
      }),
    );
    expect(plan.filter((a) => ["key", "invoke", "menu-open"].includes(a.kind))).toEqual([]);
    const apis = plan.filter((a) => a.kind === "net-call").map((a) => String(a.target));
    for (const bad of [
      "RunCommandline",
      "Workbench.Exit",
      "Workbench.RunCmd",
      "Workbench.RunProcess",
    ]) {
      expect(apis).not.toContain(bad);
    }
    // The only concurrent actions are U30's burst.
    expect(plan.filter((a) => a.concurrent).map((a) => a.step)).toEqual(
      Array(7).fill("sc-03-u30-burst"),
    );
  });

  it("the CLI dry run writes a plan the checker CLI passes, and touches nothing", async () => {
    const out = join(TMP, "plan.json");
    const lines: string[] = [];
    let built = false;
    const code = await main(["--out", out, "--tiny-world", TINY, "--nonce", "n"], {
      out: (l) => lines.push(l),
      deps: () => {
        built = true;
        throw new Error("no deps in a dry run");
      },
    });
    expect(code).toBe(EXIT.done);
    expect(built).toBe(false);
    expect(lines.some((l) => l.includes("dry-run check: PASS"))).toBe(true);
    expect(dryRunMain([out, "--script", SCRIPT_PATH])).toBe(0);
    const plan = JSON.parse(readFileSync(out, "utf-8")) as PlanAction[];
    expect(plan.length).toBeGreaterThan(50);
  });
});

// ── The queue ────────────────────────────────────────────────────────────────

/** Fold probes.jsonl and return the ids scheduled to S-C. */
function scheduledToSC(): string[] {
  const folded = new Map<string, Record<string, unknown>>();
  for (const line of readFileSync(join(REPO_ROOT, "data", "census", "probes.jsonl"), "utf-8").split(
    /\r?\n/,
  )) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Record<string, unknown>;
    folded.set(String(r.id), { ...(folded.get(String(r.id)) ?? {}), ...r });
  }
  return [...folded.values()]
    .filter((p) =>
      String(p.scheduled_session ?? "")
        .split(/,\s*/)
        .includes("S-C"),
    )
    .map((p) => String(p.id));
}

/** Every probe whose schedule ever named S-C: the queue was built against that set on the day. */
function everScheduledToSC(): string[] {
  const ids = new Set<string>();
  for (const line of readFileSync(join(REPO_ROOT, "data", "census", "probes.jsonl"), "utf-8").split(
    /\r?\n/,
  )) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Record<string, unknown>;
    if (
      String(r.scheduled_session ?? "")
        .split(/,\s*/)
        .includes("S-C")
    )
      ids.add(String(r.id));
  }
  return [...ids];
}

describe("queue", () => {
  const raw = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as {
    probes: Array<Record<string, unknown>>;
  };

  it("validates as a pre-flight step 7 queue without an owner yes above mutating", () => {
    const q = validateQueue(raw, false);
    expect(q.length).toBe(buildSteps().length);
    const ranks = q.map((p) => (PROBE_ORDER as readonly string[]).indexOf(p.risk_class));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("equals the script's step table (regenerate with --emit-queue)", () => {
    expect(raw).toEqual(JSON.parse(JSON.stringify(buildQueue())));
    expect(raw.probes.map((p) => p.id)).toEqual(buildSteps().map((s) => s.id));
  });

  it("keeps the plan's order where the risk order allows, U4 last", () => {
    const ids = buildSteps().map((s) => s.id);
    const at = (id: string): number => ids.indexOf(id);
    const order = [
      "sc-01-natives-read",
      "sc-02-bi-GetLoadedProjects",
      "sc-03-u30-burst",
      "sc-04-u2-evaluate",
      "sc-06-u7-walk",
      "sc-09-u29-cold",
      "sc-11-open-tiny-world",
      "sc-12-u19-undo",
      "sc-13-u13-component",
      "sc-14-u3-clean",
      "sc-15-u3-planted",
      "sc-16-u4-reload",
    ];
    for (let i = 1; i < order.length; i++) expect(at(order[i])).toBeGreaterThan(at(order[i - 1]));
    expect(ids[ids.length - 1]).toBe("sc-16-u4-reload");
  });

  it("covers every probe scheduled to S-C: answered by a step or listed as not answered", () => {
    const scheduled = scheduledToSC();
    // 48 recon probes, 9 register unknowns and the two DEC-019 checks of S-C (DEC-029) were
    // scheduled; the sitting ran on 2026-10-06 and its batch (EV-s005-001, DEC-040) moved ten of
    // them on to S-E, S-D and P4-census, and seq 600 scheduled P-U30 to S-D, so 48 still name S-C
    // as their latest schedule.
    expect(scheduled.length).toBe(48);
    expect(scheduled).toContain(DEC019_CHECKS.slashStyle);
    expect(scheduled).toContain(DEC019_CHECKS.prefabGuidForms);
    expect(scheduled).not.toContain(DEC019_CHECKS.textureValidator);
    expect(scheduled).not.toContain("P-E01-gui-census-feasibility-L699");
    const answered = new Set(buildSteps().flatMap((s) => s.answers));
    const unanswered = new Set(NOT_ANSWERED.filter((n) => n.part === "all").map((n) => n.id));
    for (const id of scheduled) expect(answered.has(id) || unanswered.has(id), id).toBe(true);
    // Nothing is claimed that the schedule does not hold, except TextureValidator's
    // DEC-019 check, which is S-E's and listed here as not answered.
    // After the sitting, DEC-040's batch resolved or moved on many of the probes the queue
    // names; the queue still names them, as it did on the day, so the check is against every
    // probe ever scheduled to S-C.
    const known = new Set([...everScheduledToSC(), ...Object.values(DEC019_CHECKS)]);
    for (const id of [...answered, ...notAnswered().map((n) => n.id)])
      expect(known.has(id), id).toBe(true);
    // A probe fully and unconditionally not answered is not also claimed by a step.
    for (const id of unanswered) expect(answered.has(id), id).toBe(false);
    // TextureValidator's DEC-019 check went to S-E as a whole.
    expect(unanswered.has(DEC019_CHECKS.textureValidator)).toBe(true);
  });

  it("lists the probes a skippable step alone answers as conditionally not answered", () => {
    const cond = conditionalNotAnswered();
    const byId = new Map(cond.map((n) => [n.id, n]));
    for (const id of ["P-U19", "P-E01-world-editor-L477"]) {
      const n = byId.get(id)!;
      expect(n, id).toBeDefined();
      expect(n.part).toBe("all");
      expect(n.carried_to).toBe("S-E");
      expect(n.condition).toMatch(/execute_action\.allow_list/);
      expect(n.answered_by).toEqual(["sc-12-u19-undo"]);
    }
    expect(byId.get("P-U13")?.answered_by).toEqual(["sc-13-u13-component"]);
    expect(byId.get("P-E01-world-editor-L490")?.condition).toMatch(/--u29-forward/);
    expect(byId.get("P-U7")?.answered_by).toEqual([
      "sc-05-u7-before",
      "sc-06-u7-walk",
      "sc-07-u7-after",
      "sc-07b-u7-later",
      "sc-11b-u7-walk-world",
    ]);
    // The World Editor tree (L484) is answered by the step G walk alone (DEC-029).
    expect(byId.get("P-E01-world-editor-L484")).toMatchObject({
      answered_by: ["sc-11b-u7-walk-world"],
      carried_to: expect.stringMatching(/P4-census/),
    });
    // No walk runs beside a NET call in S-C: L699 is not this sitting's (P4-census).
    expect(notAnswered().some((n) => n.id === "P-E01-gui-census-feasibility-L699")).toBe(false);
    expect(buildSteps().some((s) => s.answers.includes("P-E01-gui-census-feasibility-L699"))).toBe(
      false,
    );
    // Probes another, always-run step answers are not listed (P-U29: sc-09).
    expect(byId.has("P-U29")).toBe(false);
    expect(byId.has("P-E01-gui-census-feasibility-L698")).toBe(false);
    // The queue carries them with their condition.
    const q = buildQueue() as { not_answered: Array<{ id: string; condition?: string }> };
    expect(q.not_answered.filter((n) => n.condition).map((n) => n.id)).toEqual(
      cond.map((n) => n.id),
    );
  });

  it("gives each step a timeout no smaller than what its planned calls can spend", () => {
    const steps = buildSteps();
    const p = planInput({
      sandboxDir: SANDBOX,
      tinyWorld: TINY,
      tinyWorldPresent: true,
      policy: undoPolicy,
      nonce: "n",
      u29Forward: true,
    });
    for (const s of steps) {
      const calls = s.plan(p).filter((a) => a.kind === "net-call");
      const serial = calls
        .filter((a) => !a.concurrent)
        .reduce((sum, a) => sum + Number(a.timeout_ms), 0);
      const burst = Math.max(
        0,
        ...calls.filter((a) => a.concurrent).map((a) => Number(a.timeout_ms)),
      );
      expect(s.timeout_ms, s.id).toBeGreaterThanOrEqual(serial + burst);
    }
    const q = buildQueue(steps) as { worst_case_total_ms: number };
    expect(q.worst_case_total_ms).toBe(steps.reduce((sum, s) => sum + s.timeout_ms, 0));
    expect(q.worst_case_total_ms).toBe(worstCaseTotalMs(steps));
    // U30's per-call budget never passes the step's declared worst case.
    const u30 = steps.find((s) => s.id === "sc-03-u30-burst")!;
    expect(burstPerCallMs(10_000_000)).toBeLessThanOrEqual(u30.timeout_ms);
    expect(burstPerCallMs(null)).toBe(120_000);
    expect(burstPerCallMs(100_000)).toBe(400_000);
    // sc-09 chains the close, the port, the log, the listen and the compile.
    expect(steps.find((s) => s.id === "sc-09-u29-cold")!.timeout_ms).toBeGreaterThanOrEqual(
      120_000 + 60_000 + 120_000 + 300_000 + 300_000,
    );
  });

  it("classifies all 34 Bohemia handlers of E04, with E04's refs and declared response fields", () => {
    const rows = readFileSync(
      join(REPO_ROOT, "data", "census", "observations", "E04", "1.8.0.13.jsonl"),
      "utf-8",
    )
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const handlers = rows.filter(
      (r) => r.kind === "net-handler" && !String(r.class_name ?? "").startsWith("EMCP_"),
    );
    const names = handlers.map((r) => String((r.key as { handler: string }).handler)).sort();
    expect(names.length).toBe(34);
    const classified = [...BI_INCLUDED, ...BI_REVERSIBLE]
      .map((h) => h.name)
      .concat(BI_EXCLUDED.map((h) => h.name))
      .sort();
    expect(classified).toEqual(names);
    for (const h of [...BI_INCLUDED, ...BI_REVERSIBLE]) {
      const row = handlers.find((r) => (r.key as { handler: string }).handler === h.name)!;
      expect(h.ref, h.name).toBe(row.ref);
      const resp = rows
        .filter(
          (r) =>
            r.kind === "net-field" &&
            (r.key as { handler?: string; resp?: string }).handler === h.name &&
            (r.key as { resp?: string }).resp,
        )
        .map((r) => String((r.key as { resp: string }).resp))
        .sort();
      expect([...h.response].sort(), h.name).toEqual(resp);
    }
  });
});

describe("the scratch profile in the relaunches (DEC-038, S-C read B-1)", () => {
  it("sc-09 and sc-10 carry -forceSettings <ini>, and the plan passes the checker", () => {
    const plan = buildActionPlan(
      planInput({
        sandboxDir: SANDBOX,
        tinyWorld: TINY,
        tinyWorldPresent: true,
        policy: repoPolicy,
        nonce: "n",
        u29Forward: true,
        forceSettings: SCRATCH_INI,
      }),
    );
    const launches = plan.filter((a) => a.kind === "launch");
    expect(launches.map((a) => a.step)).toEqual(["sc-09-u29-cold", "sc-10-u29-forward"]);
    for (const a of launches) {
      const args = a.args as string[];
      expect(args.slice(0, 4)).toEqual(["-gproj", GPROJ, "-forceSettings", SCRATCH_INI]);
    }
    expect(checkPlan(plan, repoPolicy, { script: SCRIPT_PATH }).violations).toEqual([]);
    // A dry run without the flag names the placeholder, as s-b-scratch-profile.ts's plan does.
    expect(SCRATCH_INI_PLACEHOLDER).toBe("<artifacts>\\sessions\\S-C\\<stamp>\\scratch.ini");
  });

  it("the gate reads ScriptDebugMode from the forced ini when --force-settings is given", async () => {
    const on = harness({ ini: "[World%20Editor]\r\nScriptDebugMode=true\r\n", reg: [] });
    const ron = await runSession(options({ forceSettings: SCRATCH_INI }), on.deps);
    expect(ron.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-00-gate" }));
    expect(ron.stop?.reason).toMatch(/on in the forced settings ini/);
    expect(on.netCalls).toEqual([]);
    // Off in the ini wins over "on" in the export: the ini is the setting that counts.
    const off = harness({ reg: ['"ScriptDebugMode"=dword:00000001'] });
    const roff = await runSession(options({ forceSettings: SCRATCH_INI }), off.deps);
    expect(roff.exit).toBe(EXIT.done);
    expect(roff.steps[0].summary).toMatch(
      /Script Debug Mode off \(read from the force-settings-ini\)/,
    );
    // Absent (no line in [World%20Editor]): stop unless the owner confirmed it.
    const absentIni = "[General]\r\nScriptDebugMode=false\r\n\r\n[World%20Editor]\r\nOther=1\r\n";
    const a = harness({ ini: absentIni });
    const ra = await runSession(options({ forceSettings: SCRATCH_INI }), a.deps);
    expect(ra.stop?.reason).toMatch(/forced settings ini holds no ScriptDebugMode/);
    expect(a.netCalls).toEqual([]);
    const b = harness({ ini: absentIni });
    const rb = await runSession(
      options({ forceSettings: SCRATCH_INI, debugModeUnsetOk: true }),
      b.deps,
    );
    expect(rb.exit).toBe(EXIT.done);
    // Without the flag the export is still read, and the summary says so.
    const c = harness();
    const rc = await runSession(options(), c.deps);
    expect(rc.steps[0].summary).toMatch(/\(read from the registry-export\)/);
  });

  it("iniScriptDebugMode reads only the [World%20Editor] section", () => {
    expect(iniScriptDebugMode("[World%20Editor]\nScriptDebugMode=false\n").state).toBe("off");
    expect(iniScriptDebugMode("[World%20Editor]\nScriptDebugMode=0\n").state).toBe("off");
    expect(iniScriptDebugMode("[World%20Editor]\nScriptDebugMode=true\n").state).toBe("on");
    expect(iniScriptDebugMode("[World%20Editor]\r\nScriptDebugMode=1\r\n").state).toBe("on");
    expect(iniScriptDebugMode("[Other]\nScriptDebugMode=true\n").state).toBe("absent");
    expect(iniScriptDebugMode("").state).toBe("absent");
  });

  it("forceSettingsRefusal: required, not a switch, inside the artifacts folder, existing", () => {
    expect(forceSettingsRefusal(undefined, TMP)).toMatch(/needs --force-settings/);
    expect(forceSettingsRefusal("-x.ini", TMP)).toMatch(/looks like a switch/);
    expect(forceSettingsRefusal(join(homedir(), "x.ini"), TMP)).toMatch(/not inside the artifacts/);
    expect(forceSettingsRefusal(join(TMP, "missing.ini"), TMP)).toMatch(/does not exist/);
    expect(forceSettingsRefusal(SCRATCH_INI, TMP)).toBeNull();
  });
});

// ── Real mode refuses ────────────────────────────────────────────────────────

describe("real mode gate", () => {
  const leasePath = join(TMP, "lease.json");
  const markerPath = join(TMP, "marker");
  const realArgs = [
    "--really",
    "--id",
    "sc-test",
    "--lease-path",
    leasePath,
    "--marker-path",
    markerPath,
    "--sandbox",
    SANDBOX,
    "--workbench-path",
    join(TMP, "tools"),
    "--game-path",
    join(TMP, "game"),
    "--logs-path",
    join(TMP, "logs"),
    "--run-dir",
    join(TMP, "gate-run"),
    "--tiny-world",
    TINY,
    "--walker-cmd",
    JSON.stringify(DOCUMENTED_WALKER_CMD.map((a) => (a === "<lane id>" ? "sc-test" : a))),
    "--nonce",
    "gate01",
    // One declared block per invocation (DEC-032).
    "--from",
    "sc-01-natives-read",
    "--until",
    "sc-02-bi-GetGameMaterials",
    "--registry-export",
    join(TMP, "registry-before.reg"),
    "--force-settings",
    SCRATCH_INI,
    "--u29-forward",
  ];

  it("needs --registry-export for a real run", async () => {
    const i = realArgs.indexOf("--registry-export");
    const without = [...realArgs.slice(0, i), ...realArgs.slice(i + 2)];
    let built = false;
    const code = await main(without, {
      platform: "win32",
      out: () => {},
      deps: () => {
        built = true;
        return harness().deps;
      },
    });
    expect(code).toBe(EXIT.usage);
    expect(built).toBe(false);
  });

  it("refuses a real run without --force-settings, or with one outside the artifacts folder (B-1)", async () => {
    const i = realArgs.indexOf("--force-settings");
    const without = [...realArgs.slice(0, i), ...realArgs.slice(i + 2)];
    const errors: string[] = [];
    const saved = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      for (const args of [
        without,
        [...without, "--force-settings", join(TMP, "missing.ini")],
        [...without, "--force-settings", join(homedir(), "emcp-scratch.ini")],
      ]) {
        let built = false;
        const lines: string[] = [];
        const code = await main(args, {
          platform: "win32",
          policy: undoPolicy,
          artifactsRoot: TMP,
          out: (l) => lines.push(l),
          deps: () => {
            built = true;
            return harness().deps;
          },
        });
        expect(code).toBe(EXIT.refused);
        expect(built).toBe(false);
        expect(lines[lines.length - 1]).toBe("STOPPED: refused: --force-settings");
      }
    } finally {
      console.error = saved;
    }
    expect(errors[0]).toMatch(/needs --force-settings/);
    expect(errors[1]).toMatch(/does not exist/);
    expect(errors[2]).toMatch(/not inside the artifacts folder/);
  });

  it("needs --id for a real run", async () => {
    expect(await main(["--really"], { platform: "win32", out: () => {} })).toBe(EXIT.usage);
  });

  it("refuses without the lease, and builds no dependency", async () => {
    let built = false;
    const code = await main(realArgs, {
      platform: "win32",
      policy: undoPolicy,
      artifactsRoot: TMP,
      out: () => {},
      deps: () => {
        built = true;
        return harness().deps;
      },
    });
    expect(code).toBe(EXIT.refused);
    expect(built).toBe(false);
  });

  it("refuses off win32 even with the lease held", async () => {
    acquireLease(leasePath, { session: "v2-harness:sc-test", purpose: "test" });
    // The lease records the Workbench pre-flight started on the sandbox (DEC-032 M3).
    new Lane({ id: "sc-test", leasePath, markerPath }).record(FIRST, GPROJ);
    let built = false;
    const lines: string[] = [];
    const code = await main(realArgs, {
      platform: "linux",
      policy: undoPolicy,
      artifactsRoot: TMP,
      out: (l) => lines.push(l),
      deps: () => {
        built = true;
        return harness().deps;
      },
    });
    expect(code).toBe(EXIT.refused);
    expect(built).toBe(false);
    expect(lines.join("\n")).toMatch(/Windows-only/);
  });

  it("runs against the injected dependencies with --really, win32 and the lease", async () => {
    // The lease from the previous test is held by lane sc-test.
    const h = harness();
    const code = await main(realArgs, {
      platform: "win32",
      policy: undoPolicy,
      artifactsRoot: TMP,
      out: () => {},
      deps: () => h.deps,
    });
    expect(code).toBe(EXIT.done);
    // One block: the gate, the read-only natives and the 15 Bohemia handlers.
    expect(h.netCalls.length).toBeGreaterThan(15);
    expect(h.netCalls.some((c) => c.apiFunc === "EMCP_WB_Ping")).toBe(false);
  });
});

// ── The run against mocks ────────────────────────────────────────────────────

describe("happy path", () => {
  it("runs every step in order, one call at a time outside U30", async () => {
    const h = harness();
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.done);
    expect(r.stop).toBeNull();
    expect(r.steps.map((s) => s.id)).toEqual(buildSteps().map((s) => s.id));
    expect(r.steps.every((s) => ["pass", "observed"].includes(s.status))).toBe(true);
    // One evidence record and one artifact per step, naming the probes it answers.
    expect(h.evidence.length).toBe(r.steps.length);
    expect(h.evidence.find((e) => e.includes("sc-04-u2-evaluate"))).toMatch(/P-U2/);
    // Concurrency only in the burst: 7 at most, and 6 calls ever started beside another.
    expect(h.maxConcurrent).toBeLessThanOrEqual(7);
    expect(h.netCalls.filter((c) => c.concurrent > 1).length).toBeLessThanOrEqual(6);
    // No capture on the happy path; only pids this lane started were closed.
    expect(h.captures).toEqual([]);
    expect(h.closed.every((p) => [FIRST, COLD, SECOND].includes(p))).toBe(true);
  });

  it("every NET call it makes is in the action plan of its step (apiFunc)", async () => {
    const h = harness();
    await runSession(options(), h.deps);
    const plan = buildActionPlan(
      planInput({
        sandboxDir: SANDBOX,
        tinyWorld: TINY,
        tinyWorldPresent: true,
        policy: undoPolicy,
        nonce: "abc123",
        u29Forward: true,
      }),
    );
    const planned = new Set(plan.filter((a) => a.kind === "net-call").map((a) => String(a.target)));
    for (const c of h.netCalls) expect(planned.has(c.apiFunc), c.apiFunc).toBe(true);
    // Detached calls too.
    for (const d of h.detached) expect(planned.has(d.apiFunc)).toBe(true);
  });

  it("U29 launches only the sandbox with the two vanilla links; the second process is not recorded", async () => {
    const h = harness({ secondStays: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.done);
    expect(h.launches).toEqual([
      [expect.stringMatching(/^-uri=enfusion:\/\/ResourceManager\/~ArmaReforger:/)],
    ]);
    expect(h.second).toEqual([[expect.stringMatching(/^-uri=enfusion:\/\/ScriptEditor\//)]]);
    expect(h.closed).toEqual([FIRST, SECOND]);
  });

  it("U3 plants the copy inside the sandbox, outside the handler folder, and removes it", async () => {
    const h = harness();
    await runSession(options(), h.deps);
    const planted = h.writes.find((w) => w.path.endsWith(U3_PLANT_FILE))!;
    expect(planted.exclusive).toBe(true);
    expect(insideDir(SANDBOX, planted.path)).toBe(true);
    expect(insideDir(join(SANDBOX, "Scripts", "WorkbenchGame", HANDLER_FOLDER), planted.path)).toBe(
      false,
    );
    expect([...h.files.keys()].some((k) => k.endsWith(U3_PLANT_FILE))).toBe(false);
    const u3 = h.artifacts.get("sc-15-u3-planted.json") as {
      data: { plantedErrorReported: boolean };
    };
    expect(u3.data.plantedErrorReported).toBe(true);
  });

  it("U4 edits the installed Ping, reads the marker back, and restores the bundle bytes", async () => {
    const h = harness();
    await runSession(options(), h.deps);
    expect(h.files.get(INSTALLED_PING)!.equals(PING_BUNDLE)).toBe(true);
    const u4 = h.artifacts.get("sc-16-u4-reload.json") as { data: { verdict: string } };
    expect(u4.data.verdict).toMatch(/U4 yes/);
    expect(h.detached.map((d) => d.apiFunc)).toEqual([
      "ValidateScripts",
      "ValidateScripts",
      "ValidateScripts",
      "ValidateScripts",
      "ReloadScripts",
    ]);
  });

  it("U13 writes components[i] once and always deletes its entity", async () => {
    const h = harness();
    await runSession(options(), h.deps);
    const sets = h.netCalls.filter(
      (c) => c.apiFunc === "EMCP_WB_ModifyEntity" && c.params.action === "setProperty",
    );
    expect(sets).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ propertyPath: "components[1]" }),
      }),
    ]);
    expect(
      h.netCalls.filter((c) => c.apiFunc === "EMCP_WB_DeleteEntity").map((c) => c.params.name),
    ).toContain("ECEN_SC_U13_abc123");
  });

  it("U19: an undo that removes the entity needs no delete; one that does not gets the rollback", async () => {
    const yes = harness();
    await runSession(options(), yes.deps);
    expect(
      yes.netCalls.filter(
        (c) => c.apiFunc === "EMCP_WB_DeleteEntity" && String(c.params.name).includes("U19"),
      ),
    ).toEqual([]);
    const no = harness({ undoRemoves: false });
    await runSession(options(), no.deps);
    expect(
      no.netCalls.filter(
        (c) => c.apiFunc === "EMCP_WB_DeleteEntity" && String(c.params.name).includes("U19"),
      ).length,
    ).toBe(1);
  });
});

describe("skips", () => {
  it("without the tiny world, sc-11 to sc-13 are skipped and nothing is created", async () => {
    const h = harness({ tinyWorld: false });
    const r = await runSession(options(), h.deps);
    const s = statuses(r);
    expect([
      s["sc-11-open-tiny-world"],
      s["sc-11b-u7-walk-world"],
      s["sc-12-u19-undo"],
      s["sc-13-u13-component"],
    ]).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(h.walker.length).toBe(1);
    expect(r.steps.find((x) => x.id === "sc-12-u19-undo")!.summary).toMatch(/S-E/);
    expect(h.netCalls.some((c) => c.apiFunc === "EMCP_WB_CreateEntity")).toBe(false);
    expect(r.exit).toBe(EXIT.done);
  });

  it("without the undo allow-list entry, U19 is skipped and no undo is sent", async () => {
    const h = harness();
    const r = await runSession(options({ policy: noUndoPolicy }), h.deps);
    expect(statuses(r)["sc-12-u19-undo"]).toBe("skipped");
    expect(h.netCalls.some((c) => c.apiFunc === "EMCP_WB_EditorControl")).toBe(false);
  });

  it("without --walker-cmd, U7 hands off and a resume from sc-07 reads sc-05's numbers", async () => {
    const h = harness();
    const r = await runSession(options({ walkerCmd: null }), h.deps);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stop?.step).toBe("sc-06-u7-walk");
    expect(h.walker).toEqual([]);
    const resumed = await runSession(
      options({ walkerCmd: null, from: "sc-07-u7-after", nonce: "resume1" }),
      h.deps,
    );
    expect(resumed.exit).toBe(EXIT.done);
    const s = statuses(resumed);
    expect(s["sc-00-gate"]).toBe("pass");
    expect(s["sc-04-u2-evaluate"]).toBe("not-run");
    const after = h.artifacts.get("sc-07-u7-after.json") as { data: { before: unknown } };
    expect(after.data.before).not.toBeNull();
  });

  it("the walker gets the documented placeholders filled", async () => {
    const h = harness();
    await runSession(options(), h.deps);
    expect(h.walker[0]).toEqual([
      process.execPath,
      "walk.ts",
      "--pid",
      String(FIRST),
      "--class",
      "TestQtMain",
      "--title-pattern",
      "Resource Manager",
      "--out",
      join(TMP, "run", "u7-walk.json"),
    ]);
  });

  it("sc-11b walks the World Editor window after the tiny world opens, then one Ping", async () => {
    const h = harness();
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.done);
    expect(statuses(r)["sc-11b-u7-walk-world"]).toBe("observed");
    expect(h.walker.length).toBe(2);
    expect(h.walker[1]).toEqual([
      process.execPath,
      "walk.ts",
      "--pid",
      String(COLD),
      "--class",
      "TestQtMain",
      "--title-pattern",
      "World Editor - ECEN_tiny",
      "--out",
      join(TMP, "run", "u7-walk-world.json"),
    ]);
    const art = h.artifacts.get("sc-11b-u7-walk-world.json") as {
      answers: string[];
      calls: Array<{ apiFunc: string }>;
    };
    expect(art.answers).toEqual(["P-U7", "P-E01-world-editor-L484"]);
    expect(art.calls.map((c) => c.apiFunc)).toEqual(["EMCP_WB_Ping"]);
  });

  it("sc-11b hands off without exactly one World Editor window, and is skipped after an unclean sc-06", async () => {
    const none = harness({ worldEditorTitle: null });
    const a = await runSession(options(), none.deps);
    expect(a.exit).toBe(EXIT.handoff);
    expect(a.stop?.step).toBe("sc-11b-u7-walk-world");
    expect(a.stop?.reason).toMatch(/walker\.md step G1/);
    expect(a.stop?.reason).toMatch(/--from sc-12-u19-undo/);
    expect(none.walker.length).toBe(1);

    const hung = harness();
    const walk = hung.deps.runWalker;
    hung.deps.runWalker = async (argv, budget) => {
      const r = await walk(argv, budget);
      return { ...r, lastLine: '{"nodes":3,"stop_reason":"hung"}' };
    };
    const b = await runSession(options(), hung.deps);
    expect(statuses(b)["sc-11b-u7-walk-world"]).toBe("skipped");
    expect(b.steps.find((x) => x.id === "sc-11b-u7-walk-world")!.summary).toMatch(/hung/);
    expect(hung.walker.length).toBe(1);
  });

  it("worldEditorWindow takes the one unowned World Editor window of the pid, never the Resource Manager", () => {
    const w = (o: Partial<WindowInfo>): WindowInfo => ({
      hwnd: 1,
      pid: 7,
      className: "c",
      title: "",
      owner: 0,
      enabled: true,
      rect: [0, 0, 1, 1],
      monitor: [0, 0, 1, 1],
      primary: true,
      ...o,
    });
    expect(worldEditorWindow([w({ title: "World Editor - x" })], 7)?.title).toBe(
      "World Editor - x",
    );
    expect(worldEditorWindow([w({ title: "World Editor - x", owner: 3 })], 7)).toBeNull();
    expect(worldEditorWindow([w({ title: "World Editor - x", pid: 8 })], 7)).toBeNull();
    expect(worldEditorWindow([w({ title: "Resource Manager - World Editor" })], 7)).toBeNull();
    expect(
      worldEditorWindow(
        [w({ title: "World Editor - a" }), w({ hwnd: 2, title: "World Editor - b" })],
        7,
      ),
    ).toBeNull();
  });

  it("sc-07b waits five minutes of clock after sc-07 before measuring", async () => {
    const h = harness();
    await runSession(options(), h.deps);
    const a = h.artifacts.get("sc-07-u7-after.json") as { calls: Array<{ apiFunc: string }> };
    const b = h.artifacts.get("sc-07b-u7-later.json") as { calls: Array<{ apiFunc: string }> };
    expect(a.calls.length).toBe(10);
    expect(b.calls.length).toBe(10);
    expect(U7_LATER_MS).toBe(300_000);
  });
});

// ── Kill criteria and aborts ─────────────────────────────────────────────────

describe("kill criteria and aborts", () => {
  it("gate: no recorded pid stops before any NET call, with capture and window list", async () => {
    const h = harness({ recordedPid: null });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-00-gate" }));
    expect(h.netCalls).toEqual([]);
    expect(h.captures.length).toBe(1);
    expect(h.windowLists).toBeGreaterThan(0);
  });

  it("gate: a pid that is not Workbench, or a foreign port owner, stops", async () => {
    const a = await runSession(options(), harness({ recordedImage: "notepad.exe" }).deps);
    expect(a.stop?.kind).toBe("kill");
    const b = await runSession(options(), harness({ foreignPortOwner: 4444 }).deps);
    expect(b.stop?.kind).toBe("kill");
    expect(b.stop?.reason).toMatch(/held by pid 4444/);
  });

  it("gate: scripts never compiled stops after the 300 s budget", async () => {
    const h = harness({ scriptsCompiled: false });
    const r = await runSession(options(), h.deps);
    expect(r.stop?.kind).toBe("kill");
    expect(r.stop?.reason).toMatch(/compile gate/);
    expect(h.netCalls.every((c) => c.apiFunc === "IsWorkbenchRunning")).toBe(true);
  });

  it("gate: another loaded project aborts and closes the Workbench", async () => {
    const h = harness({ loaded: ["ArmaReforger", "SomeoneElsesMod"] });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.stop?.reason).toMatch(/not the sandbox/);
    expect(h.closed).toEqual([FIRST]);
  });

  it("gate: a session log naming another project aborts", async () => {
    const h = harness({ logProject: "OtherProject" });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(h.closed).toEqual([FIRST]);
  });

  it("a modal after a Bohemia call stops without clicking anything", async () => {
    const h = harness({ modalAfter: "CheckGUID" });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-02-bi-CheckGUID");
    expect(r.stop?.reason).toMatch(/modal/);
    expect(h.netCalls[h.netCalls.length - 1].apiFunc).toBe("CheckGUID");
  });

  it("U30: a burst call that times out stops after the burst settles, no retry", async () => {
    const base = harness();
    await runSession(options(), base.deps);
    const firstBurst =
      base.netCalls.findIndex((c) => c.apiFunc === "GetGameMaterials" && c.concurrent > 0) + 1;
    // The second GetGameMaterials of the whole run is the burst's first heavy call.
    const idx =
      base.netCalls
        .map((c, i) => (c.apiFunc === "GetGameMaterials" ? i : -1))
        .filter((i) => i >= 0)[1] + 1;
    expect(idx).toBeGreaterThan(firstBurst);
    const h = harness({ timeoutAt: idx });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-03-u30-burst");
    expect(h.netCalls.length).toBe(idx + 6);
  });

  it("U29: a Workbench that will not close stops (never killed)", async () => {
    const h = harness({ closeFails: [FIRST] });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-09-u29-cold");
    expect(h.launches).toEqual([]);
  });

  it("U29: the cold start opening another project aborts and closes the new Workbench", async () => {
    const h = harness({ coldLogProject: "OtherProject" });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(h.closed).toEqual([FIRST, COLD]);
  });

  it("U29: the launcher window on the cold start aborts and closes it", async () => {
    const h = harness({ coldLauncher: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.stop?.reason).toMatch(/launcher/);
    expect(h.closed).toEqual([FIRST, COLD]);
  });

  it("U29: a second process that stays and will not close stops", async () => {
    const h = harness({ secondStays: true, closeFails: [SECOND] });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-10-u29-forward");
  });

  it("U13: a timeout on the write leaves the delete to the main session (no NET call after it)", async () => {
    const base = harness();
    await runSession(options(), base.deps);
    const idx =
      base.netCalls.findIndex(
        (c) => c.apiFunc === "EMCP_WB_ModifyEntity" && c.params.action === "setProperty",
      ) + 1;
    const h = harness({ timeoutAt: idx });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(h.netCalls.length).toBe(idx);
    const stop = h.artifacts.get("sc-13-u13-component.json") as {
      data: { pendingRollback: string[] };
    };
    expect(stop.data.pendingRollback).toEqual([expect.stringContaining("ECEN_SC_U13_abc123")]);
  });

  it("U3: a detached call with no result stops, is started once, and the planted file is still removed", async () => {
    const h = harness({ detachedNever: ["u3-planted"] });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-15-u3-planted");
    expect(r.stop?.reason).toMatch(/not retried/);
    expect(h.detached.filter((d) => d.resultName.includes("u3-planted")).length).toBe(1);
    expect([...h.files.keys()].some((k) => k.endsWith(U3_PLANT_FILE))).toBe(false);
  });

  it("U4: a reload with no result stops, the Ping file is restored, nothing after", async () => {
    const h = harness({ detachedNever: ["u4-reload"] });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-16-u4-reload");
    expect(h.files.get(INSTALLED_PING)!.equals(PING_BUNDLE)).toBe(true);
    expect(h.netCalls[h.netCalls.length - 1].apiFunc).toBe("EMCP_WB_Ping");
  });

  it("U4: an installed Ping that differs from the bundle stops before any edit", async () => {
    const h = harness({ installedPingDiffers: true });
    const r = await runSession(options(), h.deps);
    expect(r.stop?.step).toBe("sc-16-u4-reload");
    expect(h.writes.some((w) => w.path === INSTALLED_PING)).toBe(false);
    expect(h.detached.some((d) => d.apiFunc === "ReloadScripts")).toBe(false);
  });

  it("the walker running past its budget stops", async () => {
    const h = harness({ walkerTimesOut: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "timeout", step: "sc-06-u7-walk" }));
  });

  it("a detached result left over from an earlier run is refused, not read", async () => {
    const h = harness();
    h.artifacts.set("child-u3-clean-WORKBENCH-abc123.json", ok({ Success: true }));
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/already exists/);
  });
});

describe("every remaining kill criterion and abort path", () => {
  it("sc-00: Script Debug Mode on stops before any NET call", async () => {
    const h = harness({ reg: ['"ScriptDebugMode"=dword:00000001'] });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-00-gate" }));
    expect(r.stop?.reason).toMatch(/Script Debug Mode is on/);
    expect(h.netCalls).toEqual([]);
  });

  it("sc-00: no ScriptDebugMode value stops unless the owner confirmed it", async () => {
    const a = harness({ reg: ["[HKEY_CURRENT_USER\\Software\\Test]"] });
    const ra = await runSession(options(), a.deps);
    expect(ra.stop?.reason).toMatch(/--debug-mode-unset-ok/);
    expect(a.netCalls).toEqual([]);
    const b = harness({ reg: ["[HKEY_CURRENT_USER\\Software\\Test]"] });
    const rb = await runSession(options({ debugModeUnsetOk: true }), b.deps);
    expect(rb.exit).toBe(EXIT.done);
    const c = harness();
    const rc = await runSession(options({ registryExport: null }), c.deps);
    expect(rc.stop?.reason).toMatch(/no pre-flight registry export/);
  });

  it("sc-00: a dialog already up refuses the window baseline", async () => {
    const h = harness({ baselineDialog: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-00-gate");
    expect(r.stop?.reason).toMatch(/refusing the window baseline/);
    expect(h.netCalls.some((c) => c.apiFunc === "IsWorldEditorRunning")).toBe(false);
  });

  it("a new owned dialog after a call stops before the next NET call", async () => {
    const h = harness({ dialogAfter: "CheckGUID" });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.step).toBe("sc-02-bi-CheckGUID");
    expect(r.stop?.reason).toMatch(/new owned or dialog-class window/);
    expect(h.netCalls[h.netCalls.length - 1].apiFunc).toBe("CheckGUID");
  });

  it("sc-08: an owned window naming the resource is accepted only when its class is a known module class (DEC-032 m3)", async () => {
    const h = harness({ ownedEditorAfter: "OpenResource" });
    const r = await runSession(options({ ownedModuleClasses: ["TestQtMain"] }), h.deps);
    expect(r.exit).toBe(EXIT.done);
    expect(statuses(r)["sc-08-natives-gui"]).toBe("observed");
    // Without the class an owned window is a possible prompt titled like the module: stop.
    const h2 = harness({ ownedEditorAfter: "OpenResource" });
    const r2 = await runSession(options(), h2.deps);
    expect(r2.exit).toBe(EXIT.stopped);
    expect(r2.stop?.step).toBe("sc-08-natives-gui");
  });

  it("sc-05: a GUI that does not answer WM_NULL stops with no NET call after", async () => {
    const h = harness({ guiHung: "start" });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-05-u7-before" }));
    expect(r.stop?.reason).toMatch(/GUI hung/);
    expect(h.walker).toEqual([]);
    expect(h.netCalls[h.netCalls.length - 1].apiFunc).toBe("EMCP_WB_Ping");
    expect(h.captures.length).toBe(1);
  });

  it("sc-07: a GUI hung after the walk stops there", async () => {
    const h = harness({ guiHung: "after-walk" });
    const r = await runSession(options(), h.deps);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-07-u7-after" }));
    expect(h.walker.length).toBe(1);
  });

  it("sc-05: a world already open skips U7 with the reason and names the probes", async () => {
    const h = harness({ worldOpenAtStart: true, tinyWorld: false });
    const r = await runSession(options({ tinyWorld: null }), h.deps);
    expect(r.exit).toBe(EXIT.done);
    const s = statuses(r);
    for (const id of ["sc-05-u7-before", "sc-06-u7-walk", "sc-07-u7-after", "sc-07b-u7-later"])
      expect(s[id], id).toBe("skipped");
    expect(h.walker).toEqual([]);
    const sum = r.steps.find((x) => x.id === "sc-05-u7-before")!.summary;
    expect(sum).toMatch(/a world is open/);
    expect(sum).toMatch(/P-U7/);
  });

  it("sc-06: no window titled Resource Manager hands off even with --walker-cmd", async () => {
    const h = harness({ mainTitle: "Enfusion Workbench" });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stop?.step).toBe("sc-06-u7-walk");
    expect(r.stop?.reason).toMatch(/walker\.md step B/);
    expect(h.walker).toEqual([]);
  });

  it("sc-09: the NET port still held after the close stops; nothing is killed or launched", async () => {
    const h = harness({ portStuck: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-09-u29-cold" }));
    expect(r.stop?.reason).toMatch(/still held/);
    expect(r.stop?.reason).toMatch(/not killed/);
    expect(r.stop?.reason).toMatch(/7777/);
    expect(h.launches).toEqual([]);
  });

  it("sc-09: the cold link names a config no earlier step opened", async () => {
    expect(U29_COLD_LINK).toContain(VANILLA.coldConf);
    const opened = buildSteps()
      .slice(
        0,
        buildSteps().findIndex((s) => s.id === "sc-09-u29-cold"),
      )
      .flatMap((s) =>
        s.plan(
          planInput({
            sandboxDir: SANDBOX,
            tinyWorld: TINY,
            tinyWorldPresent: true,
            policy: undoPolicy,
            nonce: "n",
          }),
        ),
      )
      .flatMap((a) => Object.values(a.params ?? {}).map(String));
    expect(opened.some((v) => v.toLowerCase().includes(VANILLA.coldConf.toLowerCase()))).toBe(
      false,
    );
  });

  it("sc-10: the second process at the launcher aborts; only it is closed", async () => {
    const h = harness({ secondLauncher: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.stop?.step).toBe("sc-10-u29-forward");
    expect(r.stop?.reason).toMatch(/launcher picker/);
    expect(h.closed).toEqual([FIRST, SECOND]);
    // No NET call after the spawn: the last one is sc-09's GetLoadedProjects.
    expect(h.netCalls[h.netCalls.length - 1].apiFunc).toBe("GetLoadedProjects");
  });

  it("sc-10: the launcher picker on the running Workbench aborts with nothing sent to it", async () => {
    const h = harness({ firstLauncherAfterSecond: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.stop?.reason).toMatch(/the first Workbench 2000/);
    expect(r.stop?.reason).toMatch(/must NOT confirm/);
    // Neither Workbench is closed: the picker is left for the owner, unconfirmed.
    expect(h.closed).toEqual([FIRST]);
    expect(h.captures).toEqual(["sc-10-u29-forward-abort"]);
    const art = h.artifacts.get("sc-10-u29-forward.json") as { data: { windows: WindowInfo[] } };
    expect(art.data.windows.some((w) => /Launcher/.test(w.title))).toBe(true);
  });

  it("sc-10: a second process on another project aborts after it is closed", async () => {
    const h = harness({ secondStays: true, secondLogProject: "OtherProject" });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.stop?.reason).toMatch(/opened OtherProject/);
    expect(h.closed).toEqual([FIRST, SECOND]);
  });

  it("sc-10: a second process showing a dialog stops with nothing sent to it", async () => {
    const h = harness({ secondDialog: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/shows a dialog/);
    expect(h.closed).toEqual([FIRST]);
  });

  it("sc-10: the running Workbench no longer answering stops", async () => {
    const h = harness({ firstDropsAfterSecond: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-10-u29-forward" }));
    expect(r.stop?.reason).toMatch(/no longer answers/);
    expect(h.netCalls[h.netCalls.length - 1].apiFunc).toBe("IsWorkbenchRunning");
  });

  it("sc-10 is skipped without --u29-forward and names the probe it leaves", async () => {
    const h = harness();
    const r = await runSession(options({ u29Forward: false }), h.deps);
    expect(r.exit).toBe(EXIT.done);
    expect(statuses(r)["sc-10-u29-forward"]).toBe("skipped");
    expect(h.second).toEqual([]);
    expect(r.steps.find((x) => x.id === "sc-10-u29-forward")!.summary).toMatch(
      /P-E01-world-editor-L490/,
    );
  });

  it("sc-11: Opened false, another mode or too many entities stops", async () => {
    const notOpened = harness({
      respond: (f, p) =>
        f === "OpenResource" && String(p.ResourceName).endsWith(".ent")
          ? ok({ Opened: false })
          : null,
    });
    const a = await runSession(options(), notOpened.deps);
    expect(a.stop).toEqual(
      expect.objectContaining({ kind: "kill", step: "sc-11-open-tiny-world" }),
    );
    expect(a.stop?.reason).toMatch(/Opened false/);
    expect(notOpened.netCalls[notOpened.netCalls.length - 1].apiFunc).toBe("EMCP_WB_GetState");
    const game = await runSession(options(), harness({ tinyMode: "game" }).deps);
    expect(game.stop?.reason).toMatch(/mode "game"/);
    const big = await runSession(options(), harness({ tinyEntities: 501 }).deps);
    expect(big.stop?.reason).toMatch(/entityCount 501/);
  });

  it("sc-12 is skipped without the Edit > Undo entry and names P-U19 and L477 as not answered", async () => {
    const h = harness();
    const r = await runSession(options({ policy: noUndoPolicy }), h.deps);
    const sum = r.steps.find((x) => x.id === "sc-12-u19-undo")!.summary;
    expect(sum).toMatch(/allow_list/);
    expect(sum).toMatch(/P-U19/);
    expect(sum).toMatch(/P-E01-world-editor-L477/);
    expect(sum).toMatch(/S-E/);
  });

  it("sc-13: the component class absent is a fail with the entity deleted, and the run goes on", async () => {
    const h = harness({
      respond: (f) =>
        f === "EMCP_WB_Components"
          ? ok({ status: "ok", components: [{ className: "MeshObject", index: 0 }] })
          : null,
    });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.done);
    expect(statuses(r)["sc-13-u13-component"]).toBe("fail");
    expect(r.steps.find((x) => x.id === "sc-13-u13-component")!.summary).toMatch(
      /not on the entity/,
    );
    expect(
      h.netCalls.some(
        (c) => c.apiFunc === "EMCP_WB_ModifyEntity" && c.params.action === "setProperty",
      ),
    ).toBe(false);
    expect(
      h.netCalls.filter((c) => c.apiFunc === "EMCP_WB_DeleteEntity").map((c) => c.params.name),
    ).toContain("ECEN_SC_U13_abc123");
  });

  it("sc-15: the planted file still on disk after its removal stops before U4", async () => {
    const h = harness({ removeFails: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-15-u3-planted" }));
    expect(r.stop?.reason).toMatch(/still on disk/);
    expect(h.detached.some((d) => d.apiFunc === "ReloadScripts")).toBe(false);
  });

  it("sc-15: a timeout whose removal also fails stays a timeout and names the file", async () => {
    const h = harness({ removeFails: true, detachedNever: ["u3-planted"] });
    const r = await runSession(options(), h.deps);
    expect(r.stop?.kind).toBe("timeout");
    expect(r.stop?.reason).toMatch(/wrote no result/);
    expect(r.stop?.reason).toMatch(/restore after it failed/);
    expect(r.stop?.reason).toMatch(/still on disk/);
  });

  it("sc-16: a Ping file that cannot be restored stops", async () => {
    const h = harness({ restoreFails: true });
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop).toEqual(expect.objectContaining({ kind: "kill", step: "sc-16-u4-reload" }));
    expect(r.stop?.reason).toMatch(/could not be restored/);
    expect(h.files.get(INSTALLED_PING)!.equals(PING_BUNDLE)).toBe(false);
  });

  it("sc-16: a reload timeout whose restore also fails stays a timeout and names the restore", async () => {
    const h = harness({ restoreFails: true, detachedNever: ["u4-reload"] });
    const r = await runSession(options(), h.deps);
    expect(r.stop?.kind).toBe("timeout");
    expect(r.stop?.reason).toMatch(/ReloadScripts \(detached child pid 4242\) wrote no result/);
    expect(r.stop?.reason).toMatch(/could not be restored/);
    // No NET call after the timeout.
    expect(h.netCalls[h.netCalls.length - 1].apiFunc).toBe("EMCP_WB_Ping");
  });
});

describe("arguments and the detached child", () => {
  it("refuses a --tiny-world outside the sandbox or not a world, dry run included", async () => {
    for (const bad of [
      "../Other/x.ent",
      "Worlds/../../x.ent",
      "C:/abs/x.ent",
      "/abs/x.ent",
      "Worlds/x.txt",
    ]) {
      const code = await main(["--sandbox", SANDBOX, "--tiny-world", bad], { out: () => {} });
      expect(code, bad).toBe(EXIT.usage);
    }
    expect(tinyWorldProblem("Worlds/ECEN_tiny.ent", SANDBOX)).toBeNull();
    expect(tinyWorldProblem("Worlds/ECEN_tiny.ent", null)).toBeNull();
  });

  it("the gate treats a confining-rule breach in --tiny-world as no tiny world", async () => {
    const h = harness();
    const r = await runSession(options({ tinyWorld: "../escape.ent" }), h.deps);
    expect(statuses(r)["sc-11-open-tiny-world"]).toBe("skipped");
    expect(h.netCalls.some((c) => c.apiFunc === "EMCP_WB_CreateEntity")).toBe(false);
  });

  it("the child's request file holds no path; the lease and marker paths go by environment", async () => {
    const spec: DetachedSpec = {
      apiFunc: "ValidateScripts",
      params: { Configuration: "WORKBENCH" },
      timeoutMs: 1_000,
      resultName: "child-test-x1.json",
    };
    const lane = {
      id: "sc-child",
      leasePath: join(TMP, "child-lease.json"),
      markerPath: join(TMP, "child-marker"),
    };
    const req = childRequest(spec, 5775, lane);
    expect(req.file).not.toMatch(/lease|marker|resultPath/i);
    expect(req.file).not.toContain(TMP.replace(/\\/g, "\\\\"));
    expect(req.env).toEqual({
      [CHILD_ENV.leasePath]: lane.leasePath,
      [CHILD_ENV.markerPath]: lane.markerPath,
    });
    // The child reads the paths from its environment and writes its result
    // beside the request; off win32 (and without the lease) it refuses the call.
    const dir = mkdtempSync(join(TMP, "child-"));
    const specPath = join(dir, "child-test-x1.json.request.json");
    writeFileSync(specPath, req.file);
    const code = await runChildCall(specPath, "linux", { ...req.env });
    expect(code).toBe(1);
    const result = JSON.parse(readFileSync(join(dir, spec.resultName), "utf-8")) as RawCallResult;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Windows-only|lease/);
  });
});

describe("no code path retries after a timeout", () => {
  it("for every NET call of a full run, a timeout there is the last NET call, then capture and stop", async () => {
    const base = harness();
    await runSession(options(), base.deps);
    const total = base.netCalls.length;
    const burst = new Set(
      base.netCalls.map((c, i) =>
        c.concurrent > 1 || (base.netCalls[i + 1]?.concurrent ?? 0) > 1 ? i + 1 : -1,
      ),
    );
    for (let n = 1; n <= total; n++) {
      const h = harness({ timeoutAt: n });
      const r = await runSession(options(), h.deps);
      expect(r.exit, `call ${n} ${base.netCalls[n - 1].apiFunc}`).toBe(EXIT.stopped);
      expect(r.stop?.kind).toBe("timeout");
      // Inside the U30 burst the other burst calls are already in flight; nothing starts after it.
      if (!burst.has(n)) expect(h.netCalls.length, `call ${n}`).toBe(n);
      else expect(h.netCalls.length).toBeLessThanOrEqual(n + 6);
      expect(h.captures.length).toBe(1);
    }
    // The burst really is concurrent, and it is the only place that is.
    expect(base.maxConcurrent).toBe(7);
    expect(base.netCalls.filter((c) => c.concurrent > 1).length).toBe(6);
  }, 120_000);
});

// ── Pure helpers and the raw call ────────────────────────────────────────────

describe("helpers", () => {
  it("the planted copy renames every EMCP_WB_ class and adds one syntax error", () => {
    const text = plantedSource(PING_BUNDLE.toString("utf-8"));
    // References to installed classes stay (Ping reads EMCP_WB_BuildStamp.VALUE since DEC-048);
    // the copy declares none of them.
    expect(text).not.toMatch(/class\s+EMCP_WB_/);
    expect(text).toMatch(/class ECEN_SC_U3Ping : NetApiHandler/);
    expect(text).toMatch(/void Broken\(\n\}/);
  });

  it("the U4 edit adds the marker to every Ping message and refuses another file", () => {
    const edited = editPingSource(PING_BUNDLE.toString("utf-8"), "[S-C U4 x]");
    expect(edited.split("[S-C U4 x]").length - 1).toBe(3);
    expect(() => editPingSource("class Other {}", "[m]")).toThrow(/not the shipped handler/);
  });

  it("U29 links: only the two vanilla forms", () => {
    expect(
      validateU29Link("enfusion://ResourceManager/~ArmaReforger:configs/inputCommon.conf"),
    ).toBeTruthy();
    expect(validateU29Link("enfusion://ScriptEditor/scripts/X.c;5")).toBeTruthy();
    for (const bad of [
      "enfusion://WorldEditor/worlds/x.ent;1,2,3",
      "enfusion://ResourceManager/~OtherMod:x.conf",
      'enfusion://ScriptEditor/a.c" -gproj "x',
      "enfusion://ScriptEditor/a b.c",
    ]) {
      expect(() => validateU29Link(bad), bad).toThrow();
    }
  });

  it("namesSandbox and loadedProjectsProblem", () => {
    expect(namesSandbox(SANDBOX_NAME, GPROJ)).toBe(true);
    expect(namesSandbox("Test1_sandbox", GPROJ)).toBe(false);
    expect(namesSandbox(GPROJ, GPROJ)).toBe(true);
    expect(loadedProjectsProblem(["ArmaReforger", SANDBOX_NAME], ["ArmaReforger"])).toBeNull();
    expect(loadedProjectsProblem(["ArmaReforger"], ["ArmaReforger"])).toMatch(/do not include/);
    expect(loadedProjectsProblem([SANDBOX_NAME, "X"], ["ArmaReforger"])).toMatch(/unexpected/);
    expect(loadedProjectsProblem(null, [])).toMatch(/did not return/);
  });

  it("windowChanges reports a newly disabled window as a modal and new windows as added", () => {
    const w = (hwnd: number, enabled: boolean): WindowInfo => ({
      hwnd,
      pid: 1,
      className: "c",
      title: "t",
      owner: 0,
      enabled,
      rect: [],
      monitor: [],
      primary: true,
    });
    const ch = windowChanges([w(1, true)], [w(1, false), w(2, true)], 1);
    expect(ch.disabled.map((x) => x.hwnd)).toEqual([1]);
    expect(ch.added.map((x) => x.hwnd)).toEqual([2]);
  });

  it("isDialogLike, baselineProblem, titleNames and resourceManagerWindow", () => {
    const w = (o: Partial<WindowInfo>): WindowInfo => ({
      hwnd: 1,
      pid: 1,
      className: "Qt680QWindowIcon",
      title: "t",
      owner: 0,
      enabled: true,
      rect: [],
      monitor: [],
      primary: true,
      ...o,
    });
    expect(isDialogLike(w({}))).toBe(false);
    expect(isDialogLike(w({ className: "#32770" }))).toBe(true);
    expect(isDialogLike(w({ owner: 5 }))).toBe(true);
    expect(isDialogLike(w({ owner: 5, className: "Qt680QWindowToolSaveBits" }))).toBe(false);
    expect(baselineProblem([w({})])).toBeNull();
    expect(baselineProblem([w({ enabled: false })])).toMatch(/disabled/);
    expect(baselineProblem([w({ owner: 5, title: "Save?" })])).toMatch(/Save\?/);
    // An owned window is accepted by its title only with a known module class (DEC-032 m3).
    expect(
      baselineProblem([w({ owner: 5, title: "NESW" })], (x) => titleNames(x, VANILLA.xob)),
    ).toMatch(/NESW/);
    expect(
      baselineProblem([w({ owner: 5, title: "NESW" })], (x) => titleNames(x, VANILLA.xob), [
        "Qt680QWindowIcon",
      ]),
    ).toBeNull();
    expect(baselineProblem([w({ title: "NESW" })], (x) => titleNames(x, VANILLA.xob))).toBeNull();
    // A disabled window is never accepted.
    expect(baselineProblem([w({ enabled: false, title: "NESW" })], () => true)).toMatch(/disabled/);
    expect(titleNames(w({ title: "Script Editor - NetApiDocs.c" }), "ScriptEditor")).toBe(true);
    expect(titleNames(w({ title: "inputCommon.conf" }), "configs/inputCommon.conf")).toBe(true);
    expect(titleNames(w({ title: "inputCommons.conf" }), "configs/inputCommon.conf")).toBe(false);
    expect(titleNames(w({ className: "#32770", title: "NESW" }), VANILLA.xob)).toBe(false);
    const ws = [
      w({ hwnd: 1, title: "World Editor", rect: [0, 0, 3000, 2000] }),
      w({ hwnd: 2, title: "Resource Manager", rect: [0, 0, 10, 10] }),
      w({ hwnd: 3, title: "Resource Manager", owner: 9 }),
    ];
    // The title decides, not the size; an owned window is never the target.
    expect(resourceManagerWindow(ws, 1)?.hwnd).toBe(2);
    expect(resourceManagerWindow([ws[0]], 1)).toBeNull();
  });

  it("scriptDebugMode reads the reg export value", () => {
    expect(scriptDebugMode(['"ScriptDebugMode"=dword:00000000']).state).toBe("off");
    expect(scriptDebugMode(['"ScriptDebugMode"="false"']).state).toBe("off");
    expect(scriptDebugMode(['"ScriptDebugMode"=dword:00000001']).state).toBe("on");
    expect(scriptDebugMode(['"ScriptDebugMode"="true"']).state).toBe("on");
    expect(scriptDebugMode(['"ScriptDebugMode"="maybe"']).state).toBe("on");
    expect(scriptDebugMode(['"Other"=dword:00000000']).state).toBe("absent");
  });

  it("withRestore keeps the body's stop kind when the restore fails too", async () => {
    const restoreFail = (): void => {
      throw new StopSession("kill", "restore failed");
    };
    await expect(
      withRestore(async () => {
        throw new StopSession("timeout", "body timed out");
      }, restoreFail),
    ).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringMatching(
        /body timed out; and the restore after it failed: restore failed/,
      ),
    });
    // Body fine, restore fails: the restore's stop.
    await expect(withRestore(async () => 1, restoreFail)).rejects.toMatchObject({ kind: "kill" });
    // Body fails, restore fine: the body's error, the restore ran.
    let restored = false;
    await expect(
      withRestore(
        async () => {
          throw new StopSession("timeout", "t");
        },
        () => {
          restored = true;
        },
      ),
    ).rejects.toMatchObject({ kind: "timeout", message: "t" });
    expect(restored).toBe(true);
  });

  it("the Bohemia calls never give TextureValidator or PrefabImporterBake an input", () => {
    const names = BI_INCLUDED.map((h) => h.name);
    for (const n of [
      "TextureValidator",
      "PrefabImporterBake",
      "LayerPresets",
      "GetLayerInteraction",
    ]) {
      expect(names, n).not.toContain(n);
      expect(
        BI_EXCLUDED.map((h) => h.name),
        n,
      ).toContain(n);
    }
    // The expanded GetResourceInfo reads the small prop's parent, not the character.
    const gri = BI_INCLUDED.find((h) => h.name === "GetResourceInfo")!;
    const expanded = gri
      .calls({ sandbox: "s", gproj: "g", tinyWorldAbs: null })
      .filter((c) => c.params.expandResource === true);
    expect(expanded.map((c) => c.params.path)).toEqual([VANILLA.propBaseRef]);
  });

  it("walkerArgv escapes the title into an exact pattern", () => {
    expect(
      walkerArgv(["{title}", "{pid}"], { pid: 7, out: "o", className: "c", title: "A (b) [c]" }),
    ).toEqual(["A \\(b\\) \\[c\\]", "7"]);
  });

  it("parseResponseFrame tells an absent, an empty and a present payload apart", () => {
    const st = encodePascalString("Ok");
    expect(parseResponseFrame(st)).toEqual({ ok: true, wire: { status: "Ok", payload: "absent" } });
    expect(parseResponseFrame(Buffer.concat([st, encodePascalString("")]))).toEqual({
      ok: true,
      wire: { status: "Ok", payload: "empty" },
    });
    expect(parseResponseFrame(Buffer.concat([st, encodePascalString('{"a":1}')]))).toEqual({
      ok: true,
      response: { a: 1 },
      wire: { status: "Ok", payload: "present" },
    });
    expect(parseResponseFrame(encodePascalString("Undefined API func"))).toEqual(
      expect.objectContaining({ ok: false, error: "Workbench error: Undefined API func" }),
    );
    expect(parseResponseFrame(Buffer.alloc(0))).toEqual(
      expect.objectContaining({ ok: false, error: "connection closed without a response" }),
    );
  });
});

describe("rawNetCall (ephemeral local listener)", () => {
  it("decodes an Ok answer from the mock server", async () => {
    const server = await startMockNetServer({
      IsWorkbenchRunning: { IsRunning: true, ScriptsCompiled: true },
    });
    try {
      const r = await rawNetCall("IsWorkbenchRunning", {}, { port: server.port, timeoutMs: 2_000 });
      expect(r.ok).toBe(true);
      expect(r.response).toEqual({ IsRunning: true, ScriptsCompiled: true });
      expect(r.wire).toEqual({ status: "Ok", payload: "present" });
    } finally {
      await server.close();
    }
  });

  it("keeps a status-only answer (no payload string)", async () => {
    const server = createServer({ allowHalfOpen: true }, (s) => {
      s.on("data", () => {});
      s.on("end", () => s.end(encodePascalString("Ok")));
      s.on("error", () => {});
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as AddressInfo).port;
      const r = await rawNetCall("ReloadScripts", {}, { port, timeoutMs: 2_000 });
      expect(r.ok).toBe(true);
      expect(r.wire).toEqual({ status: "Ok", payload: "absent" });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("reports a timeout once and does not retry", async () => {
    const server = await startMockNetServer({}, { silentFor: ["ValidateScripts"] });
    try {
      const r = await rawNetCall(
        "ValidateScripts",
        { Configuration: "WORKBENCH" },
        { port: server.port, timeoutMs: 200 },
      );
      expect(r.timedOut).toBe(true);
      expect(server.mock.calls.length).toBe(1);
    } finally {
      await server.close();
    }
  });
});

describe("files", () => {
  it("the committed queue file parses and names this script", () => {
    const q = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as {
      script: string;
      session: string;
    };
    expect(q.script).toBe(SCRIPT_PATH);
    expect(q.session).toBe("S-C");
  });

  it("the runbook names every step and every probe it does not answer", () => {
    const md = readFileSync(join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-C.md"), "utf-8");
    for (const s of buildSteps()) {
      if (!s.id.startsWith("sc-02-bi-")) expect(md.includes(s.id), s.id).toBe(true);
    }
    for (const n of notAnswered().filter((x) => x.part === "all"))
      expect(md.includes(n.id.replace(/^P-E01-/, "")), n.id).toBe(true);
    // The worst-case budget the runbook gives is the queue's.
    const minutes = Math.round(worstCaseTotalMs() / 60_000);
    expect(md).toContain(`${minutes} minutes`);
    // The forwarded-case hazard is stated where the owner reads it.
    expect(md).toMatch(/--u29-forward/);
    expect(md).toMatch(/TEST-RESULTS/);
    expect(md).toMatch(/ScriptDebugMode/);
    for (const h of [...BI_INCLUDED, ...BI_REVERSIBLE, ...BI_EXCLUDED])
      expect(md.includes(h.name), h.name).toBe(true);
  });

  it("the dry run reads the tiny world's presence through the injected check only", async () => {
    const seen: string[] = [];
    const lines: string[] = [];
    const code = await main(["--sandbox", SANDBOX, "--tiny-world", TINY, "--nonce", "n"], {
      out: (l) => lines.push(l),
      exists: (p) => {
        seen.push(p);
        return false;
      },
    });
    expect(code).toBe(EXIT.done);
    expect(seen).toEqual([join(SANDBOX, TINY)]);
    expect(lines[0]).toMatch(/tiny world absent/);
    expect(lines.some((l) => l.includes("sc-11-open-tiny-world") && l.includes("SKIPPED"))).toBe(
      true,
    );
  });
});

// ── The pre-sitting read of S-C (DEC-032) ────────────────────────────────────

describe("DEC-032: started markers, no retry, detached children (B1, M1)", () => {
  it("writes a started marker with the Workbench pid and its creation time before every step it runs", async () => {
    const h = harness();
    const r = await runSession(options(), h.deps);
    expect(r.exit).toBe(EXIT.done);
    const m = h.artifacts.get("sc-03-u30-burst.started") as Record<string, unknown>;
    expect(m).toMatchObject({ step: "sc-03-u30-burst", pid: FIRST, created: FIRST * 10 });
    // sc-09's marker names the relaunched pid once it is known.
    expect(h.artifacts.get("sc-09-u29-cold.started")).toMatchObject({
      pid: COLD,
      created: COLD * 10,
    });
    // Every marker has its result.
    for (const k of h.artifacts.keys()) {
      if (k.endsWith(".started"))
        expect(h.artifacts.has(k.replace(/\.started$/, ".json")), k).toBe(true);
    }
    expect(h.artifacts.has("sc-00-gate.started")).toBe(false);
  });

  it("refuses every step while a started marker has no result: nothing is sent", async () => {
    const h = harness();
    h.artifacts.set("sc-14-u3-clean.started", { step: "sc-14-u3-clean", pid: FIRST, created: 1 });
    const r = await runSession(options({ from: "sc-16-u4-reload" }), h.deps);
    expect(r.exit).toBe(EXIT.refused);
    expect(r.stop?.reason).toContain("sc-14-u3-clean has a started marker and no result");
    expect(r.stop?.reason).toContain("acknowledge --step sc-14-u3-clean");
    expect(h.netCalls).toEqual([]);
  });

  it("never runs a step twice: a stopped step is not retried on a resume", async () => {
    const h = harness({ detachedNever: ["u3-clean-WORKBENCH"] });
    const r = await runSession(options({ only: "sc-14-u3-clean" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    const before = h.detached.length;
    const again = await runSession(options({ only: "sc-14-u3-clean", nonce: "resume2" }), h.deps);
    expect(again.exit).toBe(EXIT.refused);
    expect(again.stop?.reason).toContain("never retried");
    expect(h.detached.length).toBe(before);
  });

  it("refuses before the gate's first NET call while a detached child without a result still runs", async () => {
    const h = harness();
    h.artifacts.set("child-u4-reload-old.json.request.json", { apiFunc: "ReloadScripts" });
    // No pid file: it cannot be shown that the child ended.
    const r1 = await runSession(options({ only: "sc-16-u4-reload" }), h.deps);
    expect(r1.exit).toBe(EXIT.refused);
    expect(r1.stop?.reason).toContain("no recorded child pid");
    // The child still runs (its pid and creation time match).
    h.artifacts.set("child-u4-reload-old.json.pid.json", { pid: FIRST, created: FIRST * 10 });
    const r2 = await runSession(options({ only: "sc-16-u4-reload" }), h.deps);
    expect(r2.stop?.reason).toContain("still runs");
    expect(h.netCalls).toEqual([]);
    // The child is gone: the run goes on.
    h.artifacts.set("child-u4-reload-old.json.pid.json", { pid: 99, created: 5 });
    const r3 = await runSession(options({ only: "sc-16-u4-reload" }), h.deps);
    expect(r3.exit).toBe(EXIT.done);
  });

  it("the gate refuses a recorded pid a marker names with another creation time (a reused pid)", async () => {
    const h = harness();
    h.artifacts.set("sc-03-u30-burst.started", { step: "sc-03-u30-burst", pid: FIRST, created: 7 });
    h.artifacts.set("sc-03-u30-burst.json", { status: "observed" });
    const r = await runSession(options({ only: "sc-04-u2-evaluate" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toContain("reused pid");
    expect(h.netCalls).toEqual([]);
  });
});

describe("DEC-032: one block per invocation (B1, M4, m2)", () => {
  it("every declared block fits the caller's background cap; the queue lists them with their worst case", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    const covered = BLOCKS.flatMap((b) => selectedIds({ from: b.from, until: b.until }, steps));
    // The blocks cover every step after the gate exactly once, in order.
    expect(covered).toEqual(ids.slice(1));
    for (const b of BLOCKS) {
      const ms = invocationWorstCaseMs(selectedIds({ from: b.from, until: b.until }, steps), steps);
      expect(ms, b.from).toBeLessThan(BACKGROUND_CAP_MS);
    }
    const q = buildQueue(steps) as {
      invocation_blocks: Array<{ from: string; worst_case_ms: number }>;
    };
    expect(q.invocation_blocks.map((b) => b.from)).toEqual(BLOCKS.map((b) => b.from));
    // The helpers are counted: three detached ValidateScripts calls with their overrun and checks.
    expect(steps.find((s) => s.id === "sc-14-u3-clean")!.timeout_ms).toBe(
      3 * detachedBudgetMs(600_000) + HELPER.table,
    );
    expect(TIMEOUTS.sessionLog).toBe(ASSERT_WAIT_MS);
  });

  it("a real run selects one declared block or one step; a resume names its run folder", () => {
    const sel = (o: Partial<{ from: string; until: string; only: string; runDir: boolean }>) =>
      selectionRefusal({ from: null, until: null, only: null, runDir: false, ...o });
    expect(sel({})).toContain("never the whole sitting");
    expect(sel({ from: "sc-03-u30-burst", until: "sc-16-u4-reload", runDir: true })).toContain(
      "one declared block",
    );
    expect(sel({ from: "sc-01-natives-read", until: "sc-02-bi-GetGameMaterials" })).toBeNull();
    expect(sel({ only: "sc-14-u3-clean" })).toContain("--run-dir");
    expect(sel({ only: "sc-14-u3-clean", runDir: true })).toBeNull();
  });

  it("a resumed burst takes its baseline from sc-02's result, and a resumed walk its window from sc-05's", async () => {
    const h = harness({
      respond: (api) => (api === "GetGameMaterials" ? { ...ok({}), durationMs: 100_000 } : null),
    });
    const first = await runSession(
      options({ from: "sc-01-natives-read", until: "sc-02-bi-GetGameMaterials" }),
      h.deps,
    );
    expect(first.exit).toBe(EXIT.done);
    const burst = await runSession(options({ only: "sc-03-u30-burst", nonce: "b2" }), h.deps);
    expect(burst.exit).toBe(EXIT.done);
    const sc03 = h.artifacts.get("sc-03-u30-burst.json") as { data: { perCallTimeoutMs: number } };
    expect(sc03.data.perCallTimeoutMs).toBe(400_000);
    // The gate of the resume knew the process: one check each, no waits.
    const gate = h.artifacts.get("sc-00-gate.json") as { data: { resumed: boolean } };
    expect(gate.data.resumed).toBe(true);
    await runSession(
      options({ from: "sc-04-u2-evaluate", until: "sc-05-u7-before", nonce: "b3" }),
      h.deps,
    );
    const walk = await runSession(options({ only: "sc-06-u7-walk", nonce: "b4" }), h.deps);
    expect(walk.exit).toBe(EXIT.done);
    expect(h.walker.length).toBe(1);
  });
});

describe("DEC-032: windows and dialogs (m3, m4), the plant folder (m7), the world (m11)", () => {
  it("a dialog during a detached call ends the wait as a stop, with no NET call after it", async () => {
    const h = harness({ dialogDuring: "ValidateScripts" });
    const r = await runSession(options({ only: "sc-14-u3-clean" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toContain("appeared during the call");
    expect(h.detached.length).toBe(1);
    const afterDetached = h.netCalls.filter(
      (c) => c.apiFunc !== "IsWorkbenchRunning" && c.apiFunc !== "GetLoadedProjects",
    );
    expect(afterDetached).toEqual([]);
  });

  it("a file Workbench added to the plant folder stops sc-15 and is named, never deleted", async () => {
    const h = harness({ metaAdded: true });
    const r = await runSession(options({ only: "sc-15-u3-planted" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toContain("ECEN_SC_U3_Planted.c.meta");
    expect([...h.files.keys()].some((k) => k.endsWith(U3_PLANT_FILE))).toBe(false);
    expect([...h.files.keys()].some((k) => k.endsWith(".meta"))).toBe(true);
    // The plant was recorded before it was written; the rollback record is missing (incomplete).
    expect(h.artifacts.get("plant-sc-15.json")).toMatchObject({ file: U3_PLANT_FILE });
    expect(h.artifacts.has("rollback-sc-15.json")).toBe(false);
  });

  it("sc-12 and sc-13 edit nothing when the World Editor title did not name the tiny world", async () => {
    const h = harness({ worldEditorTitle: "World Editor - SomethingElse" });
    const r = await runSession(options(), h.deps);
    expect(statuses(r)["sc-12-u19-undo"]).toBe("skipped");
    expect(statuses(r)["sc-13-u13-component"]).toBe("skipped");
    expect(h.netCalls.some((c) => c.apiFunc === "EMCP_WB_CreateEntity")).toBe(false);
    const sc11 = h.artifacts.get("sc-11-open-tiny-world.json") as {
      data: { worldTitleNamesTiny: boolean };
    };
    expect(sc11.data.worldTitleNamesTiny).toBe(false);
    // The main session's call: run them anyway.
    const h2 = harness({ worldEditorTitle: "World Editor - SomethingElse" });
    const r2 = await runSession(options({ worldTitleUnchecked: true }), h2.deps);
    expect(statuses(r2)["sc-13-u13-component"]).toBe("observed");
  });
});

describe("DEC-032: the CLI (M3, m6, m8, i1, i2) and the subcommands", () => {
  const leasePath = join(TMP, "cli-lease.json");
  const markerPath = join(TMP, "cli-marker");
  const base = [
    "--really",
    "--id",
    "sc-cli",
    "--lease-path",
    leasePath,
    "--marker-path",
    markerPath,
    "--sandbox",
    SANDBOX,
    "--workbench-path",
    join(TMP, "tools"),
    "--game-path",
    join(TMP, "game"),
    "--logs-path",
    join(TMP, "logs"),
    "--registry-export",
    join(TMP, "registry-before.reg"),
    "--force-settings",
    SCRATCH_INI,
    "--only",
    "sc-04-u2-evaluate",
    "--run-dir",
    join(TMP, "cli-run"),
  ];

  it("refuses unless the lease records the sandbox's project, and a --sandbox of another name", async () => {
    acquireLease(leasePath, { session: "v2-harness:sc-cli", purpose: "test" });
    const lane = new Lane({ id: "sc-cli", leasePath, markerPath });
    lane.record(FIRST, join(TMP, "addons", "OwnerMod", "OwnerMod.gproj"));
    let built = false;
    const lines: string[] = [];
    const code = await main(base, {
      platform: "win32",
      policy: undoPolicy,
      artifactsRoot: TMP,
      out: (l) => lines.push(l),
      deps: () => {
        built = true;
        return harness().deps;
      },
    });
    expect(code).toBe(EXIT.refused);
    expect(built).toBe(false);
    expect(lines[lines.length - 1]).toMatch(/^STOPPED: refused: the lease records the project/);
    const other = join(TMP, "addons", "Test1_sandbox");
    expect(await main(["--sandbox", other], { out: () => {} })).toBe(EXIT.refused);
    lane.record(FIRST, GPROJ);
  });

  it("refuses a run folder outside the artifacts folder, and prints no home path", async () => {
    const errors: string[] = [];
    const saved = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      const i = base.indexOf("--run-dir");
      const args = [...base.slice(0, i), "--run-dir", join(homedir(), "emcp-sc-run-x")];
      const code = await main(args, {
        platform: "win32",
        policy: undoPolicy,
        artifactsRoot: TMP,
        out: () => {},
        deps: () => harness().deps,
      });
      expect(code).toBe(EXIT.refused);
    } finally {
      console.error = saved;
    }
    expect(errors.join("\n")).toContain("not inside the artifacts folder");
    expect(errors.join("\n")).not.toContain(homedir());
  });

  it("a real run's walker command must be walk.ts with --really, this lane and the placeholders", () => {
    const good = DOCUMENTED_WALKER_CMD.map((a) => (a === "<lane id>" ? "sc-x" : a));
    expect(walkerCmdRefusal(good, "sc-x")).toBeNull();
    expect(walkerCmdRefusal(good, "other")).toContain("--id other");
    expect(walkerCmdRefusal(["calc.exe"], "sc-x")).toContain("tools/uia/walk.ts");
    expect(
      walkerCmdRefusal(
        good.filter((a) => a !== "--really"),
        "sc-x",
      ),
    ).toContain("--really");
    expect(
      walkerCmdRefusal(
        good.filter((a) => a !== "{title}"),
        "sc-x",
      ),
    ).toContain("{title}");
  });

  it("the bundled Ping file may be read but never written", () => {
    const deps = realDeps({
      lane: new Lane({
        id: "sc-i1",
        leasePath: join(TMP, "i1-lease.json"),
        markerPath: join(TMP, "i1-m"),
      }),
      port: 1,
      workbenchPath: join(TMP, "tools"),
      gamePath: join(TMP, "game"),
      gproj: GPROJ,
      sandboxDir: SANDBOX,
      logsPath: null,
      runDir: join(TMP, "i1-run"),
      evidenceDir: join(TMP, "i1-run", "evidence"),
      evidenceSession: "S-C",
      build: "x",
      placeholders: {},
      forceSettings: SCRATCH_INI,
    });
    const bundle = join(BUNDLED_HANDLER_DIR, PING_FILE);
    expect(deps.readBytes(bundle).equals(PING_BUNDLE)).toBe(true);
    // The bytes written are the bundle's own and the folder exists: should this ever regress,
    // the test still changes nothing under mod/.
    expect(() => deps.writeBytes(bundle, PING_BUNDLE, false)).toThrow(/outside the sandbox/);
    expect(() => deps.makeDir(BUNDLED_HANDLER_DIR)).toThrow(/outside the sandbox/);
  });

  it("rollback removes the planted file the run wrote and restores the edited Ping, only with no Workbench", () => {
    const files = new Map<string, Buffer>();
    const run = new Map<string, string>();
    const plantDir = join(SANDBOX, "Scripts", "WorkbenchGame", U3_PLANT_FOLDER);
    const planted = join(plantDir, U3_PLANT_FILE);
    const installed = join(SANDBOX, "Scripts", "WorkbenchGame", HANDLER_FOLDER, PING_FILE);
    const source = Buffer.from("planted text");
    const edited = Buffer.from("edited ping");
    files.set(planted, source);
    files.set(installed, edited);
    files.set(join(BUNDLED_HANDLER_DIR, PING_FILE), PING_BUNDLE);
    run.set(
      "plant-sc-15.json",
      JSON.stringify({ sha256: sha256Hex(source), folderExisted: false }),
    );
    run.set(
      "plant-sc-16.json",
      JSON.stringify({ bundleSha256: sha256Hex(PING_BUNDLE), editedSha256: sha256Hex(edited) }),
    );
    let running = [FIRST];
    const removedDirs: string[] = [];
    const lines: string[] = [];
    const io = {
      workbenchPids: () => running,
      fileExists: (p: string) =>
        files.has(p) ||
        [...files.keys()].some((k) => k.startsWith(p + "\\") || k.startsWith(p + "/")),
      readBytes: (p: string) => files.get(p)!,
      writeBytes: (p: string, d: Buffer) => void files.set(p, Buffer.from(d)),
      removeFile: (p: string) => void files.delete(p),
      removeEmptyDir: (p: string) => void removedDirs.push(p),
      listDir: () => [],
      readRunFile: (n: string) => run.get(n) ?? null,
      writeRunFile: (n: string, t: string) => void run.set(n, t),
      log: (l: string) => void lines.push(l),
    };
    const cfg = { runDir: "run", sandboxDir: SANDBOX, gate: null, really: true };
    expect(runRollback({ ...cfg, gate: "dry run", really: false }, io)).toBe(0);
    expect(files.has(planted)).toBe(true);
    expect(runRollback(cfg, io)).toBe(1);
    expect(lines.join("\n")).toContain("Workbench is running");
    running = [];
    expect(runRollback(cfg, io)).toBe(0);
    expect(files.has(planted)).toBe(false);
    expect(files.get(installed)!.equals(PING_BUNDLE)).toBe(true);
    expect(run.has("rollback-sc-15.json") && run.has("rollback-sc-16.json")).toBe(true);
    // Nothing open any more.
    expect(runRollback(cfg, io)).toBe(0);
    expect(lines[lines.length - 1]).toContain("no U3 plant or U4 edit without a rollback");
  });

  it("rollback leaves a planted file that is not the run's own", () => {
    const files = new Map<string, Buffer>();
    const planted = join(SANDBOX, "Scripts", "WorkbenchGame", U3_PLANT_FOLDER, U3_PLANT_FILE);
    files.set(planted, Buffer.from("someone else's file"));
    const run = new Map<string, string>([
      ["plant-sc-15.json", JSON.stringify({ sha256: sha256Hex("planted text") })],
    ]);
    const io = {
      workbenchPids: () => [],
      fileExists: (p: string) => files.has(p),
      readBytes: (p: string) => files.get(p)!,
      writeBytes: () => {},
      removeFile: (p: string) => void files.delete(p),
      removeEmptyDir: () => {},
      listDir: () => [],
      readRunFile: (n: string) => run.get(n) ?? null,
      writeRunFile: (n: string, t: string) => void run.set(n, t),
      log: () => {},
    };
    expect(runRollback({ runDir: "r", sandboxDir: SANDBOX, gate: null, really: true }, io)).toBe(1);
    expect(files.has(planted)).toBe(true);
  });

  it("recover and acknowledge are the shared subcommands, dry runs without --really", async () => {
    const runDir = join(TMP, "sub-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "sc-14-u3-clean.started"),
      JSON.stringify({ step: "sc-14-u3-clean", pid: FIRST, created: 1 }),
    );
    const lines: string[] = [];
    const args = [
      "--run-dir",
      runDir,
      "--id",
      "sc-cli",
      "--lease-path",
      leasePath,
      "--marker-path",
      markerPath,
    ];
    expect(
      await main(["recover", ...args], {
        out: (l) => lines.push(l),
        artifactsRoot: TMP,
        platform: "win32",
      }),
    ).toBe(0);
    expect(lines.join("\n")).toContain("a started marker of sc-14-u3-clean names it");
    expect(lines.join("\n")).not.toMatch(/\/T\b/);
    const ack = await main(
      ["acknowledge", ...args, "--step", "sc-14-u3-clean", "--owner-ack", "--really"],
      {
        out: (l) => lines.push(l),
        artifactsRoot: TMP,
        platform: "win32",
        recoverDeps: { workbenchPids: () => [] },
      },
    );
    expect(ack).toBe(0);
    expect(existsSync(join(runDir, "sc-14-u3-clean.started.acknowledged"))).toBe(true);
  });
});

describe("DEC-032: a dry run of one block", () => {
  it("plans the gate and that block only, and says what the real run would do with the selection", async () => {
    const out = join(TMP, "block-plan.json");
    const lines: string[] = [];
    const code = await main(
      ["--sandbox", SANDBOX, "--tiny-world", TINY, "--only", "sc-14-u3-clean", "--out", out],
      { out: (l) => lines.push(l), exists: () => true, policy: undoPolicy },
    );
    expect(code).toBe(EXIT.done);
    const plan = JSON.parse(readFileSync(out, "utf-8")) as PlanAction[];
    const stepsIn = new Set(plan.map((a) => String(a.step)));
    expect([...stepsIn].sort()).toEqual(["any", "sc-00-gate", "sc-14-u3-clean"]);
    expect(lines.join("\n")).toContain("the real run would refuse this selection");
    expect(lines.join("\n")).toContain("--run-dir");
  });
});
