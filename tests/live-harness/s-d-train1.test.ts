import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLease } from "../../src/workbench/lease.js";
import { Lane } from "../../scripts/live/lane.js";
import { checkPlan, main as dryRunMain, type PlanAction } from "../../scripts/live/dry-run.js";
import { probePackTarget } from "../../scripts/live/launch.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { PROBE_ORDER, validateQueue } from "../../scripts/live/preflight.js";
import { BACKGROUND_CAP_MS } from "../../scripts/live/session-common.js";
import type { DetachedSpec, RawCallResult, WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  AUTH_CLASS,
  AUTH_LOG,
  AUTH_TITLE,
  BLOCKS,
  DEFAULT_QUEUE,
  EVAL_REFUSED,
  EXIT,
  EXTRA_ANSWERED,
  MODAL_CAPTION,
  NOT_ANSWERED,
  PROBE_API,
  SCRIPT_PATH,
  THROWAWAY,
  TIMEOUTS,
  WINDOW_PATHS,
  authWindow,
  buildActionPlan,
  buildQueue,
  buildSteps,
  invocationWorstCaseMs,
  isNeverPath,
  listenersInNetstat,
  main,
  mainWindowOf,
  notAnswered,
  planInput,
  probeFacts,
  runRollback,
  runSession,
  scanSessionLog,
  screenshotName,
  selectedIds,
  selectionRefusal,
  u6Dialog,
  type SdDeps,
  type SdOptions,
} from "../../scripts/live/s-d-train1.js";

// Everything below is synthetic: pids, window classes, titles, paths and NET answers are test
// data, not Workbench facts. No socket is opened.

const repoPolicy = loadPolicy();
/** The policy without any Window dock entry (sd-19a and sd-19b are then skipped). */
const noDockPolicy: CensusPolicy = {
  ...repoPolicy,
  execute_action: { ...repoPolicy.execute_action, allow_list: [["Edit", "Undo"]] },
};

const TMP = mkdtempSync(join(tmpdir(), "emcp-sd-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const SANDBOX = join(TMP, "addons", SANDBOX_NAME);
const GPROJ = join(SANDBOX, `${SANDBOX_NAME}.gproj`);
const WB = "ArmaReforgerWorkbenchSteamDiag.exe";
const PID = 1000;
const SCRATCH_INI = join(TMP, "scratch.ini");
writeFileSync(SCRATCH_INI, "[World%20Editor]\r\nScriptDebugMode=false\r\n");
const LOG_LINE = `ENGINE: Using autosave directory: T:/planted/Projects/${SANDBOX_NAME}/autosaves\n`;
/** The synthetic main window's title (the gate records the unowned "Enfusion Workbench..." window). */
const MAIN_TITLE = "Enfusion Workbench - World Editor";

// ── Mock dependencies ────────────────────────────────────────────────────────

interface Scenario {
  /** Raise the authorization prompt on the detached call whose label (result name) contains this. */
  authOn: string | null;
  /** Raise the authorization prompt after this (non-detached) probe action answers. */
  authAfterAction: string | null;
  /** The pack answers "Undefined API func" (it did not compile). */
  packMissing: boolean;
  /** evalCompile compiles every text (the Enforce screen fails open). */
  screenFailsOpen: boolean;
  /** The Ping on the second socket answers while the U6 dialog is up. */
  pingAnswersDuringModal: boolean;
  /** Toggle back leaves an extra window (a dock not restored). */
  dockLeftOpen: boolean;
  /** Files in the pack folder. */
  packFiles: string[];
  /** A detached call whose result name contains this never answers (and raises no dialog). */
  detachedNever: string | null;
  /** The owner field of the authorization window the mock raises (0: unowned, as S-C saw). */
  authOwner: number;
}

const BASE: Scenario = {
  authOn: null,
  authAfterAction: null,
  packMissing: false,
  screenFailsOpen: false,
  pingAnswersDuringModal: false,
  dockLeftOpen: false,
  packFiles: ["ECEN_Probe.c", "ECEN_ProbeSystem.c"],
  detachedNever: null,
  authOwner: 0,
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
const pack = (facts: Record<string, string> = {}, status = "ok"): unknown => ({
  status,
  factKeys: Object.keys(facts),
  factValues: Object.values(facts),
  pageCount: 1,
});

interface Harness {
  deps: SdDeps;
  sc: Scenario;
  netCalls: Array<{
    apiFunc: string;
    params: Record<string, unknown>;
    at: number;
    concurrent: number;
  }>;
  maxConcurrent: number;
  detached: DetachedSpec[];
  captures: string[];
  closed: number[];
  files: Map<string, Buffer>;
  dirs: Set<string>;
  artifacts: Map<string, unknown>;
  texts: Map<string, string>;
  evidence: string[];
  /** Results of detached children, by result name, and when they become readable. */
  results: Map<string, { at: number; result: RawCallResult }>;
  /** Windows beyond the main one (dialogs, docks), removable by a test (the owner's click). */
  extra: WindowInfo[];
  /** The hwnd every WM_NULL and IsHungAppWindow sample was sent to (null: the S-C default). */
  stallTargets: Array<number | null>;
  hungTargets: Array<number | null>;
  /** The session log's text (the gate scans it). */
  log: string;
  now(): number;
  advance(ms: number): void;
}

function harness(over: Partial<Scenario> = {}): Harness {
  const sc: Scenario = { ...BASE, ...over };
  let t = 1_700_000_000_000;
  let inFlight = 0;
  let worldOpen = false;
  const h: Harness = {
    deps: undefined as unknown as SdDeps,
    sc,
    netCalls: [],
    maxConcurrent: 0,
    detached: [],
    captures: [],
    closed: [],
    files: new Map(),
    dirs: new Set(),
    artifacts: new Map(),
    texts: new Map(),
    evidence: [],
    results: new Map(),
    extra: [],
    stallTargets: [],
    hungTargets: [],
    log: LOG_LINE,
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
  for (const f of sc.packFiles) h.files.set(join(probePackTarget(SANDBOX), f), Buffer.from("// c"));
  const win = (
    title: string,
    hwnd: number,
    owner = 0,
    cls = "TestQtMain",
    enabled = true,
  ): WindowInfo => ({
    hwnd,
    pid: PID,
    className: cls,
    title,
    owner,
    enabled,
    rect: [0, 0, 1000, 800],
    monitor: [0, 0, 2560, 1440],
    primary: true,
  });
  const raiseAuth = (): void => {
    if (!h.extra.some((w) => w.title === AUTH_TITLE))
      h.extra.push(win(AUTH_TITLE, 7001, sc.authOwner, AUTH_CLASS));
  };
  const answer = (apiFunc: string, params: Record<string, unknown>): RawCallResult => {
    switch (apiFunc) {
      case "IsWorkbenchRunning":
      case "IsWorldEditorRunning":
        return ok({ IsRunning: true, ScriptsCompiled: true });
      case "GetLoadedProjects":
        return ok({ "Loaded Projects": ["ArmaReforger", SANDBOX_NAME] });
      case "OpenResource":
        if (String(params.ResourceName).endsWith(".ent")) worldOpen = true;
        return ok({ Opened: true });
      case "EMCP_WB_GetState":
        return ok({ status: "ok", mode: "edit", entityCount: worldOpen ? 12 : 0 });
      case PROBE_API: {
        if (sc.packMissing) {
          return {
            ...ok(),
            ok: false,
            error: "Workbench error: Undefined API func",
            wire: { status: "Undefined API func", payload: "absent" },
          };
        }
        const action = String(params.action);
        if (action === "info") return ok(pack({ isSandbox: "true", loadedAddons: "2" }));
        if (action === "executeAction") {
          if (
            sc.dockLeftOpen &&
            h.netCalls.filter((c) => c.params.action === "executeAction").length === 2
          ) {
            h.extra.push(win("Hierarchy", 7100));
          }
          return ok(pack({ result: "true" }));
        }
        if (action === "evalCompile") {
          if (!sc.screenFailsOpen && EVAL_REFUSED.includes(String(params.text)))
            return ok(pack({}, "refused"));
          return ok(pack({ compiled: "true", called: "true", result: "ok" }));
        }
        if (action === "screenshot") {
          const target = join(SANDBOX, String(params.folder), String(params.path));
          h.files.set(target, Buffer.from("BM-test-image"));
          return ok(pack({ written: "true" }));
        }
        return ok(pack());
      }
      default:
        return ok({});
    }
  };
  h.deps = {
    net: async (apiFunc, params) => {
      inFlight++;
      h.maxConcurrent = Math.max(h.maxConcurrent, inFlight);
      h.netCalls.push({ apiFunc, params, at: t, concurrent: inFlight });
      await new Promise<void>((r) => setImmediate(r));
      inFlight--;
      const r = answer(apiFunc, params);
      if (sc.authAfterAction && params.action === sc.authAfterAction) raiseAuth();
      return r;
    },
    listWindows: async () => [
      win(MAIN_TITLE, PID * 10),
      ...h.extra,
      { ...win("other", 99990), pid: 9999 },
    ],
    capture: async (label) => {
      h.captures.push(label);
      return { ok: true, path: `capture-${label}.png`, detail: "mock" };
    },
    guiStall: async (_pid, samples, hwnd) => {
      h.stallTargets.push(hwnd ?? null);
      return Array.from({ length: samples }, () => 3);
    },
    hungApp: async (_pid, hwnd) => {
      h.hungTargets.push(hwnd ?? null);
      return false;
    },
    processImage: (pid) => (pid === PID ? WB : null),
    processCreated: async (pid) => (pid === PID ? PID * 10 : null),
    listRunFiles: () => [
      ...h.artifacts.keys(),
      ...h.texts.keys(),
      ...[...h.results].filter(([, e]) => t >= e.at).map(([n]) => n),
    ],
    listDir: (p) =>
      [...h.files.keys()]
        .filter((k) => k.startsWith(p + "\\") || k.startsWith(p + "/"))
        .map((k) => k.slice(p.length + 1)),
    portOwners: () => [PID],
    crashReporters: () => [4242],
    listenersOf: () => [],
    closeGracefully: async (pid) => {
      h.closed.push(pid);
      return { exited: true, detail: "mock" };
    },
    recordedPid: () => PID,
    heartbeat: () => {},
    sessionLogAfter: () => "LOG",
    readText: (p) => (/\.ini$/i.test(p) ? readFileSync(SCRATCH_INI, "utf-8") : h.log),
    readRegLines: () => ['"ScriptDebugMode"=dword:00000000'],
    fileExists: (p) =>
      h.files.has(p) ||
      h.dirs.has(p) ||
      [...h.files.keys()].some((k) => k.startsWith(p + "\\") || k.startsWith(p + "/")),
    readBytes: (p) => {
      const b = h.files.get(p);
      if (!b) throw new Error(`no file ${p}`);
      return b;
    },
    removeFile: (p) => {
      h.files.delete(p);
    },
    makeDir: (p) => {
      h.dirs.add(p);
    },
    removeEmptyDir: (p) => {
      h.dirs.delete(p);
    },
    startDetached: (spec) => {
      h.detached.push(spec);
      const action = String(spec.params.action ?? "");
      if (sc.authOn && spec.resultName.includes(sc.authOn)) {
        raiseAuth();
        return 4242;
      }
      if (sc.detachedNever && spec.resultName.includes(sc.detachedNever)) return 4246;
      if (action === "modalTest") {
        h.extra.push(win(MODAL_CAPTION, 7200, PID * 10, "TestQtDialog"));
        return 4243;
      }
      if (spec.resultName.includes("u6-ping") && !sc.pingAnswersDuringModal) return 4244;
      h.results.set(spec.resultName, { at: t + 10_000, result: answer(spec.apiFunc, spec.params) });
      return 4245;
    },
    readRunFile: (name) => {
      const e = h.results.get(name);
      if (e && t >= e.at) return JSON.stringify(e.result);
      if (h.texts.has(name)) return h.texts.get(name)!;
      const a = h.artifacts.get(name);
      return a === undefined ? null : JSON.stringify(a);
    },
    readRunBytes: (name) => (h.texts.has(name) ? Buffer.from(h.texts.get(name)!, "latin1") : null),
    writeRunBytes: (name, data) => {
      if (h.texts.has(name)) throw new Error("EEXIST");
      h.texts.set(name, data.toString("latin1"));
      return `run/${name}`;
    },
    appendRunLine: (name, line) => {
      h.texts.set(name, (h.texts.get(name) ?? "") + line + "\n");
    },
    runWalker: async () => ({ exitCode: 0, timedOut: false, lastLine: '{"nodes":12}' }),
    writeArtifact: (name, value) => {
      h.artifacts.set(name, JSON.parse(JSON.stringify(value)));
      return `run/${name}`;
    },
    writeEvidence: (summary) => {
      h.evidence.push(summary);
      return `EV-S-D-${String(h.evidence.length).padStart(3, "0")}`;
    },
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    log: () => {},
  };
  return h;
}

function options(over: Partial<SdOptions> = {}): SdOptions {
  return {
    sandboxDir: SANDBOX,
    gproj: GPROJ,
    from: null,
    until: null,
    only: null,
    openedProjectPattern:
      "Using autosave directory: .*[\\\\/]Projects[\\\\/]([^\\\\/]+)[\\\\/]autosaves",
    allowedAddons: ["ArmaReforger"],
    nonce: "abc123",
    runDir: join(TMP, "run"),
    laneId: "sd-test",
    policy: repoPolicy,
    registryExport: "REG",
    debugModeUnsetOk: false,
    forceSettings: SCRATCH_INI,
    u30Rerun: true,
    ...over,
  };
}

/** A plan action's params as a record. */
const paramsOf = (a: PlanAction): Record<string, unknown> =>
  (a.params ?? {}) as Record<string, unknown>;

const statuses = (r: Awaited<ReturnType<typeof runSession>>): Record<string, string> =>
  Object.fromEntries(r.steps.map((s) => [s.id, s.status]));

/** Fold probes.jsonl and return the ids scheduled to S-D. */
function scheduledToSD(): string[] {
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
        .includes("S-D"),
    )
    .map((p) => String(p.id));
}

/** Every probe whose schedule ever named S-D: the queue was built against that set on the day. */
function everScheduledToSD(): string[] {
  const ids = new Set<string>();
  for (const line of readFileSync(join(REPO_ROOT, "data", "census", "probes.jsonl"), "utf-8").split(
    /\r?\n/,
  )) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Record<string, unknown>;
    if (
      String(r.scheduled_session ?? "")
        .split(/,\s*/)
        .includes("S-D")
    )
      ids.add(String(r.id));
  }
  return [...ids];
}

// ── The queue ────────────────────────────────────────────────────────────────

describe("queue", () => {
  const raw = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as {
    probes: Array<Record<string, unknown>>;
  };

  it("equals the script's step table (regenerate with --emit-queue)", () => {
    expect(raw).toEqual(JSON.parse(JSON.stringify(buildQueue())));
    expect(raw.probes.map((p) => p.id)).toEqual(buildSteps().map((s) => s.id));
  });

  it("validates as a pre-flight step 7 queue: read-only, then reversible, then mutating", () => {
    const q = validateQueue(raw, false);
    expect(q.length).toBe(buildSteps().length);
    const ranks = q.map((p) => (PROBE_ORDER as readonly string[]).indexOf(p.risk_class));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const by = (r: string): number => buildSteps().filter((s) => s.risk === r).length;
    expect([by("read-only"), by("reversible"), by("mutating")]).toEqual([13, 21, 4]);
    expect(buildSteps()[buildSteps().length - 1].id).toBe("sd-22-u6-after");
  });

  it("covers every probe scheduled to S-D: answered by a step or listed as not answered", () => {
    const scheduled = scheduledToSD();
    // Seq 600 scheduled P-U30 (sd-11) to S-D: 48 entries were scheduled when the queue was built.
    // The sitting ran on 2026-10-07 and its batch (EV-s006-001, DEC-042) resolved or moved some
    // on, so the check is against every probe ever scheduled to S-D.
    const ever = everScheduledToSD();
    expect(ever.length).toBe(48);
    expect(ever).toContain("P-U30");
    const answered = new Set(buildSteps().flatMap((s) => s.answers));
    const unanswered = new Set(NOT_ANSWERED.filter((n) => n.part === "all").map((n) => n.id));
    for (const id of scheduled) expect(answered.has(id) || unanswered.has(id), id).toBe(true);
    // Nothing is claimed beyond the schedule (EXTRA_ANSWERED is empty since seq 600).
    const known = new Set([...ever, ...EXTRA_ANSWERED]);
    for (const id of [...answered, ...notAnswered().map((n) => n.id)])
      expect(known.has(id), id).toBe(true);
    for (const id of unanswered) expect(answered.has(id), id).toBe(false);
    // The six probes the design carries away as a whole.
    expect([...unanswered].sort()).toEqual(
      [
        "P-E01-gui-census-feasibility-L675",
        "P-E01-gui-census-feasibility-L677",
        "P-E01-plugins-netapi-cli-L469",
        "P-E01-resource-manager-L663",
        "P-E01-script-string-dialogue-L406",
        "P-E01-world-editor-L490",
      ].sort(),
    );
    // A partial entry names steps that exist (or the sd-12 family).
    const ids = new Set(buildSteps().map((s) => s.id));
    for (const n of notAnswered()) {
      for (const s of n.answered_by ?? [])
        expect(ids.has(s) || s === "sd-12-u8-*", `${n.id} ${s}`).toBe(true);
    }
  });

  it("gives each step a timeout no smaller than what its planned calls can spend", () => {
    const p = planInput({
      sandboxDir: SANDBOX,
      policy: repoPolicy,
      nonce: "abc123",
      u30Rerun: true,
      walker: true,
    });
    for (const s of buildSteps()) {
      const calls = s.plan(p).filter((a) => a.kind === "net-call");
      const serial = calls
        .filter((a) => !a.concurrent)
        .reduce((sum, a) => sum + Number(a.timeout_ms), 0);
      const burst = Math.max(
        0,
        ...calls.filter((a) => a.concurrent).map((a) => Number(a.timeout_ms)),
      );
      // sd-21's two children wait far longer than the step: the step hands off while they wait.
      if (s.id === "sd-21-u6-modal") continue;
      expect(s.timeout_ms, s.id).toBeGreaterThanOrEqual(serial + burst);
    }
  });
});

// ── Blocks and selections ────────────────────────────────────────────────────

describe("one block or one step per invocation", () => {
  it("every declared block fits the 2-hour background cap with margin, and the queue lists them", () => {
    const steps = buildSteps();
    for (const b of BLOCKS) {
      const ids = selectedIds({ from: b.from, until: b.until }, steps);
      expect(ids.length, b.from).toBeGreaterThan(0);
      expect(invocationWorstCaseMs(ids, steps), b.from).toBeLessThan(BACKGROUND_CAP_MS - 900_000);
    }
    // The blocks cover every step after the gate, in order, once.
    const covered = BLOCKS.flatMap((b) => selectedIds({ from: b.from, until: b.until }, steps));
    expect(covered).toEqual(steps.slice(1).map((s) => s.id));
    const q = buildQueue(steps) as { invocation_blocks: Array<{ worst_case_ms: number }> };
    expect(q.invocation_blocks.length).toBe(BLOCKS.length);
  });

  it("every step that can raise the authorization prompt is a block of its own", () => {
    const steps = buildSteps();
    const prompting = steps.filter((s) => s.canPrompt).map((s) => s.id);
    expect(prompting).toEqual([
      "sd-01-auth-restart",
      "sd-02-auth-again",
      "sd-07-u5-eval-ok",
      "sd-08-u5-screen",
      "sd-09-u5-reach",
      "sd-10a-u16-load-first",
      "sd-10b-u16-load-rest",
      "sd-20a-u28-screenshot",
      "sd-20b-u28-screenshot",
    ]);
    for (const id of prompting) {
      expect(
        BLOCKS.some((b) => b.from === id && b.until === id),
        id,
      ).toBe(true);
      for (const b of BLOCKS) {
        const ids = selectedIds({ from: b.from, until: b.until }, steps);
        if (ids.length > 1) expect(ids, `${b.from}..${b.until}`).not.toContain(id);
      }
    }
    // The U6 steps and the U30 re-run are alone too.
    for (const id of ["sd-11-u30-rerun", "sd-15-world-open", "sd-21-u6-modal", "sd-22-u6-after"]) {
      expect(
        BLOCKS.some((b) => b.from === id && b.until === id),
        id,
      ).toBe(true);
    }
  });

  it("refuses a selection that is not a declared block or one step, and a later block without --run-dir", () => {
    const steps = buildSteps();
    expect(selectionRefusal({ from: null, until: null, only: null, runDir: false }, steps)).toMatch(
      /one declared block/,
    );
    expect(
      selectionRefusal(
        { from: "sd-03-crash-reporter", until: "sd-12-u8-AnimEditor", only: null, runDir: true },
        steps,
      ),
    ).toMatch(/one declared block/);
    expect(
      selectionRefusal(
        { from: null, until: null, only: "sd-01-auth-restart", runDir: false },
        steps,
      ),
    ).toBeNull();
    expect(
      selectionRefusal({ from: null, until: null, only: "sd-07-u5-eval-ok", runDir: false }, steps),
    ).toMatch(/--run-dir/);
    expect(
      selectionRefusal({ from: null, until: null, only: "sd-07-u5-eval-ok", runDir: true }, steps),
    ).toBeNull();
    expect(
      selectionRefusal(
        {
          from: "sd-03-crash-reporter",
          until: "sd-06-u17-layer-noworld",
          only: null,
          runDir: true,
        },
        steps,
      ),
    ).toBeNull();
    // A step whose worst case passes the cap is refused (a synthetic table).
    const fat = steps.map((s) =>
      s.id === "sd-15-world-open" ? { ...s, timeout_ms: BACKGROUND_CAP_MS } : s,
    );
    expect(
      selectionRefusal({ from: null, until: null, only: "sd-15-world-open", runDir: true }, fat),
    ).toMatch(/background limit/);
  });
});

// ── The dry-run plan ─────────────────────────────────────────────────────────

describe("action plan", () => {
  const KINDS = new Set(["net-call", "execute-action", "uia-read", "screenshot"]);
  for (const v of [
    { name: "repo policy", policy: repoPolicy, walker: false },
    { name: "repo policy, walker", policy: repoPolicy, walker: true },
    { name: "no dock entry", policy: noDockPolicy, walker: false },
  ]) {
    it(`passes the checker and holds only allowed kinds (${v.name})`, () => {
      const plan = buildActionPlan(
        planInput({
          sandboxDir: SANDBOX,
          policy: v.policy,
          nonce: "abc123",
          u30Rerun: true,
          walker: v.walker,
        }),
      );
      const r = checkPlan(plan, v.policy, { script: SCRIPT_PATH });
      expect(r.violations).toEqual([]);
      for (const a of plan) expect(KINDS.has(a.kind), a.kind).toBe(true);
      // Edit > Undo is never planned (ruling 7), and no key, invoke, menu or launch.
      expect(
        plan.some(
          (a) => a.kind === "execute-action" && isNeverPath((a.target as { path: string[] }).path),
        ),
      ).toBe(false);
      expect(
        plan.some(
          (a) =>
            Array.isArray(paramsOf(a).menuPath) && isNeverPath(paramsOf(a).menuPath as string[]),
        ),
      ).toBe(false);
    });
  }

  it("plans an execute-action beside every executeAction call, only for allow-listed paths", () => {
    const plan = buildActionPlan(
      planInput({ sandboxDir: SANDBOX, policy: repoPolicy, nonce: "abc123" }),
    );
    const calls = plan.filter(
      (a) => a.kind === "net-call" && paramsOf(a).action === "executeAction",
    );
    const execs = plan.filter((a) => a.kind === "execute-action");
    expect(calls.length).toBe(execs.length);
    expect(calls.length).toBeGreaterThan(0);
    const lean = buildActionPlan(
      planInput({ sandboxDir: SANDBOX, policy: noDockPolicy, nonce: "abc123" }),
    );
    expect(
      lean.some((a) => a.kind === "execute-action" || paramsOf(a).action === "executeAction"),
    ).toBe(false);
    // The repo policy carries every WINDOW_PATHS entry (the other agent's 6d1ac64).
    expect(
      planInput({ sandboxDir: SANDBOX, policy: repoPolicy, nonce: "n" }).windowPaths.length,
    ).toBe(WINDOW_PATHS.length);
  });

  it("the only concurrent actions are U30's burst and U6's second socket; prompt-capable calls are detached", () => {
    const plan = buildActionPlan(
      planInput({ sandboxDir: SANDBOX, policy: repoPolicy, nonce: "abc123", u30Rerun: true }),
    );
    const conc = plan.filter((a) => a.concurrent).map((a) => a.step);
    expect(conc).toEqual([...Array(7).fill("sd-11-u30-rerun"), "sd-21-u6-modal"]);
    const prompting = new Set(
      buildSteps()
        .filter((s) => s.canPrompt)
        .map((s) => s.id),
    );
    for (const a of plan.filter((x) => x.kind === "net-call" && prompting.has(String(x.step)))) {
      expect(a.detached, String(a.step)).toBe(true);
    }
  });

  it("the CLI dry run writes a plan the checker CLI passes, and touches nothing", async () => {
    const out = join(TMP, "plan.json");
    const outline = join(TMP, "outline.txt");
    const lines: string[] = [];
    let built = false;
    const code = await main(
      ["--out", out, "--outline", outline, "--sandbox", SANDBOX, "--nonce", "abc123"],
      {
        out: (l) => lines.push(l),
        deps: () => {
          built = true;
          throw new Error("no deps in a dry run");
        },
      },
    );
    expect(code).toBe(EXIT.done);
    expect(built).toBe(false);
    expect(lines.some((l) => l.includes("dry-run check: PASS"))).toBe(true);
    expect(dryRunMain([out, "--script", SCRIPT_PATH])).toBe(0);
    const plan = JSON.parse(readFileSync(out, "utf-8")) as PlanAction[];
    expect(plan.length).toBeGreaterThan(100);
    expect(readFileSync(out, "utf-8")).not.toContain(TMP);
    expect(readFileSync(outline, "utf-8")).toContain("<sandbox>");
  });
});

// ── Real-run refusals ────────────────────────────────────────────────────────

describe("real mode gate", () => {
  const leasePath = join(TMP, "lease.json");
  const markerPath = join(TMP, "marker");
  const realArgs = [
    "--really",
    "--id",
    "sd-test",
    "--lease-path",
    leasePath,
    "--marker-path",
    markerPath,
    "--sandbox",
    SANDBOX,
    "--logs-path",
    join(TMP, "logs"),
    "--run-dir",
    join(TMP, "gate-run"),
    "--nonce",
    "abc123",
    "--from",
    "sd-03-crash-reporter",
    "--until",
    "sd-06-u17-layer-noworld",
    "--registry-export",
    join(TMP, "registry-before.reg"),
    "--force-settings",
    SCRATCH_INI,
  ];
  const without = (flag: string): string[] => {
    const i = realArgs.indexOf(flag);
    return [...realArgs.slice(0, i), ...realArgs.slice(i + 2)];
  };
  const quiet = async <T>(f: () => Promise<T>): Promise<{ value: T; errors: string[] }> => {
    const errors: string[] = [];
    const saved = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      return { value: await f(), errors };
    } finally {
      console.error = saved;
    }
  };

  it("refuses without --force-settings (or one outside the artifacts folder), and builds no dependency", async () => {
    for (const args of [
      without("--force-settings"),
      [...without("--force-settings"), "--force-settings", join(TMP, "missing.ini")],
    ]) {
      let built = false;
      const lines: string[] = [];
      const { value } = await quiet(() =>
        main(args, {
          platform: "win32",
          artifactsRoot: TMP,
          out: (l) => lines.push(l),
          deps: () => {
            built = true;
            return harness().deps;
          },
        }),
      );
      expect(value).toBe(EXIT.refused);
      expect(built).toBe(false);
      expect(lines[lines.length - 1]).toBe("STOPPED: refused: --force-settings");
    }
  });

  it("needs --registry-export, a valid --owner-clicked and a declared selection", async () => {
    let built = false;
    const deps = (): SdDeps => {
      built = true;
      return harness().deps;
    };
    const a = await quiet(() =>
      main(without("--registry-export"), {
        platform: "win32",
        artifactsRoot: TMP,
        out: () => {},
        deps,
      }),
    );
    expect(a.value).toBe(EXIT.usage);
    const b = await quiet(() =>
      main([...realArgs, "--owner-clicked", "Maybe"], {
        platform: "win32",
        artifactsRoot: TMP,
        out: () => {},
        deps,
      }),
    );
    expect(b.value).toBe(EXIT.usage);
    // M3: a comma-separated list, every entry a known button.
    const b2 = await quiet(() =>
      main([...realArgs, "--owner-clicked", "Yes,Maybe"], {
        platform: "win32",
        artifactsRoot: TMP,
        out: () => {},
        deps,
      }),
    );
    expect(b2.value).toBe(EXIT.usage);
    expect(b2.errors.join(" ")).toMatch(/comma-separated/);
    const i = realArgs.indexOf("--until");
    const sel = [
      ...realArgs.slice(0, i),
      "--until",
      "sd-12-u8-AnimEditor",
      ...realArgs.slice(i + 2),
    ];
    const c = await quiet(() =>
      main(sel, { platform: "win32", artifactsRoot: TMP, out: () => {}, deps }),
    );
    expect(c.value).toBe(EXIT.usage);
    expect(built).toBe(false);
  });

  it("refuses without the lease, and builds no dependency", async () => {
    let built = false;
    const lines: string[] = [];
    const code = await main(realArgs, {
      platform: "win32",
      artifactsRoot: TMP,
      out: (l) => lines.push(l),
      deps: () => {
        built = true;
        return harness().deps;
      },
    });
    expect(code).toBe(EXIT.refused);
    expect(built).toBe(false);
    expect(lines.join("\n")).toMatch(/does not hold the Workbench lease/);
  });

  it("runs one block against the injected dependencies with --really, win32 and the lease", async () => {
    acquireLease(leasePath, { session: "v2-harness:sd-test", purpose: "test" });
    new Lane({ id: "sd-test", leasePath, markerPath }).record(PID, GPROJ);
    const h = harness();
    const code = await main(realArgs, {
      platform: "win32",
      artifactsRoot: TMP,
      out: () => {},
      deps: () => h.deps,
    });
    expect(code).toBe(EXIT.done);
    // The gate plus sd-03 to sd-06; nothing of another block.
    expect(h.netCalls.some((c) => c.params.action === "diagRead")).toBe(true);
    expect(h.netCalls.some((c) => c.params.action === "evalCompile")).toBe(false);
    expect(h.artifacts.has("sd-06-u17-layer-noworld.json")).toBe(true);
  });
});

// ── The run against mocks ────────────────────────────────────────────────────

describe("the sitting against mocks", () => {
  it("runs every step to the U6 handoff, one call at a time outside U30, with no capture", async () => {
    const h = harness();
    const r = await runSession(options(), h.deps);
    const st = statuses(r);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stop).toMatchObject({ kind: "handoff", step: "sd-21-u6-modal" });
    expect(st["sd-00-gate"]).toBe("pass");
    // sd-02 and sd-20b repeat nothing when the first call did not prompt.
    expect(st["sd-02-auth-again"]).toBe("skipped");
    expect(st["sd-20b-u28-screenshot"]).toBe("skipped");
    expect(st["sd-08-u5-screen"]).toBe("pass");
    expect(st["sd-15-world-open"]).toBe("pass");
    expect(st["sd-16-u17-layer-world"]).toBe("observed");
    expect(h.captures).toEqual([]);
    expect(h.closed).toEqual([]);
    // Concurrency only in the burst (7) and, as separate processes, U6's two children.
    expect(h.maxConcurrent).toBe(7);
    expect(
      h.netCalls
        .filter((c) => c.concurrent > 1)
        .every((c) => ["GetGameMaterials", "EMCP_WB_Ping"].includes(c.apiFunc)),
    ).toBe(true);
    // The U6 waiting record and the dialog left for the owner; nothing sent to it.
    expect(h.artifacts.has("u6-waiting.json")).toBe(true);
    expect(h.detached.map((d) => String(d.params.action ?? d.apiFunc))).toContain("modalTest");
    expect(r.stop?.reason).toMatch(/Owner: close the dialog with its own button/);
  });

  it("U30 re-run: the seven sockets are opened within the same tick (no stagger)", async () => {
    const h = harness();
    await runSession(options({ only: "sd-11-u30-rerun" }), h.deps);
    const burst = h.netCalls.filter(
      (c) => c.concurrent > 1 || (c.apiFunc !== "IsWorkbenchRunning" && h.netCalls.indexOf(c) > 0),
    );
    const starts = h.netCalls.slice(-8, -1).map((c) => c.at);
    expect(new Set(starts).size).toBe(1);
    expect(burst.length).toBeGreaterThan(0);
    const res = h.artifacts.get("sd-11-u30-rerun.json") as { data: { stagger: number } };
    expect(res.data.stagger).toBe(0);
    // Without the flag the step is skipped and names P-U30.
    const h2 = harness();
    const r2 = await runSession(options({ only: "sd-11-u30-rerun", u30Rerun: false }), h2.deps);
    expect(statuses(r2)["sd-11-u30-rerun"]).toBe("skipped");
    expect(r2.steps.find((s) => s.id === "sd-11-u30-rerun")!.summary).toMatch(/P-U30/);
  });

  it("every NET call it makes is in the action plan (apiFunc and probe action)", async () => {
    const h = harness();
    await runSession(options(), h.deps);
    const plan = buildActionPlan(
      planInput({ sandboxDir: SANDBOX, policy: repoPolicy, nonce: "abc123", u30Rerun: true }),
    );
    const key = (apiFunc: string, params: Record<string, unknown>): string =>
      `${apiFunc}:${String(params.action ?? "")}`;
    const planned = new Set(
      plan
        .filter((a) => a.kind === "net-call")
        .map((a) => key(String(a.target), (a.params ?? {}) as Record<string, unknown>)),
    );
    for (const c of h.netCalls)
      expect(planned.has(key(c.apiFunc, c.params)), key(c.apiFunc, c.params)).toBe(true);
    for (const d of h.detached)
      expect(planned.has(key(d.apiFunc, d.params)), key(d.apiFunc, d.params)).toBe(true);
    // Edit > Undo is never sent.
    expect(
      h.netCalls.some(
        (c) => Array.isArray(c.params.menuPath) && isNeverPath(c.params.menuPath as string[]),
      ),
    ).toBe(false);
  });

  it("U28: the plant first, the BMP copied into the run folder, deleted by hash, the folder removed", async () => {
    const h = harness();
    const r = await runSession(options({ only: "sd-20a-u28-screenshot" }), h.deps);
    expect(statuses(r)["sd-20a-u28-screenshot"]).toBe("observed");
    const name = screenshotName("ECEN_SD_U28a", "abc123");
    expect(name).toBe("ECEN_SD_U28a-abc123.bmp");
    expect(h.artifacts.get("plant-sd-20a.json")).toMatchObject({
      file: name,
      folder: THROWAWAY,
      folderExisted: false,
    });
    expect(h.artifacts.get("rollback-sd-20a.json")).toMatchObject({ ok: true, landed: true });
    expect(h.texts.has(`u28-${name}`)).toBe(true);
    expect(h.files.has(join(SANDBOX, THROWAWAY, name))).toBe(false);
    expect(h.dirs.has(join(SANDBOX, THROWAWAY))).toBe(false);
    const call = h.detached.find((d) => d.params.action === "screenshot")!;
    expect(call.params).toMatchObject({ folder: THROWAWAY, path: name });
  });

  it("U28: a call that times out leaves the plant open (the child may still write the BMP)", async () => {
    const h = harness({ detachedNever: "sd-20a-u28-screenshot" });
    const r = await runSession(options({ only: "sd-20a-u28-screenshot" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.kind).toBe("timeout");
    expect(h.artifacts.has("plant-sd-20a.json")).toBe(true);
    expect(h.artifacts.has("rollback-sd-20a.json")).toBe(false);
  });

  it("refuses Edit > Undo at the call, whatever the policy says", async () => {
    const steps = buildSteps();
    const undo = { ...steps.find((s) => s.id === "sd-17-u10-tool")! };
    undo.run = async (ctx) => {
      await ctx.call({
        apiFunc: PROBE_API,
        params: { action: "executeAction", moduleName: "WorldEditor", menuPath: ["&Edit", "undo"] },
        timeoutMs: 1000,
      });
      return { status: "observed", summary: "sent" };
    };
    const h = harness();
    const r = await runSession(
      options({ only: "sd-17-u10-tool" }),
      h.deps,
      steps.map((s) => (s.id === undo.id ? undo : s)),
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/Edit > Undo is never called/);
    expect(h.netCalls.some((c) => c.params.action === "executeAction")).toBe(false);
  });
});

// ── The authorization prompt: stop, handoff, the owner's button ──────────────

describe("the authorization prompt (ruling 1)", () => {
  it("a prompt during a promptable call hands off: auth record, no click, the child left running", async () => {
    const h = harness({ authOn: "sd-01-auth-restart" });
    const r = await runSession(options({ only: "sd-01-auth-restart" }), h.deps);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stop).toMatchObject({ kind: "handoff", step: "sd-01-auth-restart" });
    expect(r.stop?.reason).toMatch(/passive walker/);
    expect(r.stop?.reason).toMatch(/--only sd-02-auth-again/);
    expect(r.stop?.reason).toMatch(/--owner-clicked/);
    const auth = h.artifacts.get("auth-sd-01-auth-restart.json") as {
      window: WindowInfo;
      classMatches: boolean;
      resultName: string;
    };
    expect(auth.window.title).toBe(AUTH_TITLE);
    expect(auth.classMatches).toBe(true);
    expect(auth.resultName).toMatch(/^child-sd-01-auth-restart-abc123\.json$/);
    // The child waits past the call's own timeout so the owner's click can still answer it.
    expect(h.detached[0].timeoutMs).toBe(30_000 + TIMEOUTS.authClick);
    expect(h.captures).toEqual([]);
    expect(h.closed).toEqual([]);
    expect((h.artifacts.get("sd-01-auth-restart.json") as { status: string }).status).toBe(
      "handoff",
    );
  });

  it("the modal check recognises the unowned authorization window after a plain call too", async () => {
    const h = harness({ authAfterAction: "diagRead" });
    const r = await runSession(options({ only: "sd-05-u34-diag-get" }), h.deps);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stop?.step).toBe("sd-05-u34-diag-get");
    expect(h.artifacts.has("auth-sd-05-u34-diag-get.json")).toBe(true);
    // Exactly one diagRead was sent: no NET call after the prompt.
    expect(h.netCalls.filter((c) => c.params.action === "diagRead").length).toBe(1);
    // authWindow wants the exact title, whatever the owner field (m1).
    const w = {
      hwnd: 1,
      pid: PID,
      className: AUTH_CLASS,
      title: AUTH_TITLE,
      owner: 0,
      enabled: true,
      rect: [],
      monitor: [],
      primary: true,
    };
    expect(authWindow([w], PID)).not.toBeNull();
    expect(authWindow([{ ...w, owner: 5 }], PID)).not.toBeNull();
    expect(authWindow([{ ...w, title: "Script Authorization" }], PID)).toBeNull();
  });

  it("the next invocation refuses without --owner-clicked, and records the button and the late answer with it", async () => {
    const h = harness({ authOn: "sd-01-auth-restart" });
    await runSession(options({ only: "sd-01-auth-restart" }), h.deps);
    // The owner clicks Yes: the dialog goes, the child's call answers.
    h.extra.splice(0);
    h.results.set("child-sd-01-auth-restart-abc123.json", {
      at: h.now(),
      result: ok({ status: "ok" }),
    });
    const refused = await runSession(
      options({ only: "sd-02-auth-again", nonce: "def456" }),
      h.deps,
    );
    expect(refused.exit).toBe(EXIT.refused);
    expect(refused.stop?.reason).toMatch(/--owner-clicked/);
    const before = h.netCalls.length;
    expect(before).toBeGreaterThan(0);
    const r = await runSession(
      options({ only: "sd-02-auth-again", nonce: "def456", ownerClicked: "Yes" }),
      h.deps,
    );
    const log = h.texts
      .get(AUTH_LOG)!
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(log).toEqual([
      expect.objectContaining({
        step: "sd-01-auth-restart",
        button: "Yes",
        late_answer: expect.objectContaining({ ok: true }),
      }),
    ]);
    // sd-02 runs after a Yes, and answers without a prompt.
    expect(statuses(r)["sd-02-auth-again"]).toBe("observed");
    // A second --owner-clicked with nothing pending is refused.
    const again = await runSession(
      options({ only: "sd-03-crash-reporter", nonce: "aaa111", ownerClicked: "No" }),
      h.deps,
    );
    expect(again.stop?.reason).toMatch(/no authorization handoff waits/);
  });

  it("sd-02 is skipped when the owner reported another button than Yes; Yes to All voids later no-prompt results", async () => {
    const h = harness({ authOn: "sd-01-auth-restart" });
    await runSession(options({ only: "sd-01-auth-restart" }), h.deps);
    h.extra.splice(0);
    const r = await runSession(
      options({ only: "sd-02-auth-again", nonce: "def456", ownerClicked: "YesToAll" }),
      h.deps,
    );
    expect(statuses(r)["sd-02-auth-again"]).toBe("skipped");
    const r7 = await runSession(options({ only: "sd-07-u5-eval-ok", nonce: "fed654" }), h.deps);
    expect(r7.steps.find((s) => s.id === "sd-07-u5-eval-ok")!.summary).toMatch(/void for U27/);
  });

  it("after a prompt on sd-20a, the BMP that lands after the click is settled by sd-20b", async () => {
    const h = harness({ authOn: "sd-20a-u28-screenshot" });
    const r = await runSession(options({ only: "sd-20a-u28-screenshot" }), h.deps);
    expect(r.exit).toBe(EXIT.handoff);
    expect(h.artifacts.has("plant-sd-20a.json")).toBe(true);
    expect(h.artifacts.has("rollback-sd-20a.json")).toBe(false);
    // The owner clicks: the call finishes and the BMP lands.
    h.extra.splice(0);
    const late = join(SANDBOX, THROWAWAY, "ECEN_SD_U28a-abc123.bmp");
    h.files.set(late, Buffer.from("BM-late"));
    h.results.set("child-sd-20a-u28-screenshot-abc123.json", {
      at: h.now(),
      result: ok(pack({ written: "true" })),
    });
    h.sc.authOn = null;
    const b = await runSession(
      options({ only: "sd-20b-u28-screenshot", nonce: "def456", ownerClicked: "Yes" }),
      h.deps,
    );
    expect(statuses(b)["sd-20b-u28-screenshot"]).toBe("observed");
    expect(h.files.has(late)).toBe(false);
    expect(h.artifacts.get("rollback-sd-20a.json")).toMatchObject({ landed: true });
    expect(h.artifacts.get("rollback-sd-20b.json")).toMatchObject({ landed: true });
  });
});

// ── Stops ────────────────────────────────────────────────────────────────────

describe("stops", () => {
  it("the gate: a pack that did not compile stops (train #1 failed)", async () => {
    const h = harness({ packMissing: true });
    const r = await runSession(options({ only: "sd-03-crash-reporter" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/did not compile/);
    expect(h.captures.length).toBe(1);
  });

  it("the gate: the mutating pack installed, or no pack, stops before the info call", async () => {
    for (const packFiles of [["ECEN_Probe.c", "ECEN_ProbeMut.c"], []]) {
      const h = harness({ packFiles });
      const r = await runSession(options({ only: "sd-03-crash-reporter" }), h.deps);
      expect(r.exit).toBe(EXIT.stopped);
      expect(h.netCalls.some((c) => c.apiFunc === PROBE_API)).toBe(false);
    }
  });

  it("sd-08: a text the screen should refuse that compiles stops the sitting", async () => {
    const h = harness({ screenFailsOpen: true });
    const r = await runSession(options({ only: "sd-08-u5-screen" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/not its model/);
  });

  it("sd-19a: a dock not restored after its pair stops", async () => {
    const h = harness({ dockLeftOpen: true });
    const r = await runSession(options({ only: "sd-19a-u9-worldeditor" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/not restored/);
    const h2 = harness();
    const r2 = await runSession(
      options({ only: "sd-19a-u9-worldeditor", policy: noDockPolicy }),
      h2.deps,
    );
    expect(statuses(r2)["sd-19a-u9-worldeditor"]).toBe("skipped");
    expect(h2.netCalls.some((c) => c.params.action === "executeAction")).toBe(false);
  });

  it("U6: sd-22 refuses while the dialog is up, then reads both children once the owner closed it", async () => {
    const h = harness();
    const r = await runSession(options({ only: "sd-21-u6-modal" }), h.deps);
    expect(r.exit).toBe(EXIT.handoff);
    const waiting = h.artifacts.get("u6-waiting.json") as {
      secondSocketPing: { answeredDuringModal: boolean };
      children: { modal: { resultName: string }; ping: { resultName: string } };
    };
    expect(waiting.secondSocketPing.answeredDuringModal).toBe(false);
    const pingsBefore = h.netCalls.filter((c) => c.apiFunc === "EMCP_WB_Ping").length;
    const up = await runSession(options({ only: "sd-22-u6-after", nonce: "def456" }), h.deps);
    // The gate's baseline already refuses the dialog that is still up; sd-22 never sends a Ping.
    expect(up.exit).toBe(EXIT.stopped);
    expect(up.stop?.reason).toMatch(/refusing the window baseline/);
    expect(h.netCalls.filter((c) => c.apiFunc === "EMCP_WB_Ping").length).toBe(pingsBefore);
  });

  it("U6: after the owner's close, sd-22 records both answers and the queue alive", async () => {
    const h = harness();
    await runSession(options({ only: "sd-21-u6-modal" }), h.deps);
    const waiting = h.artifacts.get("u6-waiting.json") as {
      children: { modal: { resultName: string }; ping: { resultName: string } };
    };
    h.extra.splice(0);
    h.results.set(waiting.children.modal.resultName, {
      at: h.now(),
      result: ok(pack({ caption: MODAL_CAPTION })),
    });
    h.results.set(waiting.children.ping.resultName, { at: h.now(), result: ok({ status: "ok" }) });
    const r = await runSession(options({ only: "sd-22-u6-after", nonce: "def456" }), h.deps);
    expect(statuses(r)["sd-22-u6-after"]).toBe("observed");
    const res = h.artifacts.get("sd-22-u6-after.json") as {
      data: { modalResult: unknown; pingResult: unknown };
    };
    expect(res.data.modalResult).not.toBeNull();
    expect(res.data.pingResult).not.toBeNull();
  });
});

// ── Rollback and helpers ─────────────────────────────────────────────────────

describe("rollback and helpers", () => {
  it("rollback settles an open screenshot plant only while no Workbench runs", () => {
    const files = new Map<string, Buffer>([
      [join(SANDBOX, THROWAWAY, "ECEN_SD_U28a-abc123.bmp"), Buffer.from("BM")],
    ]);
    const run = new Map<string, string>([
      [
        "plant-sd-20a.json",
        JSON.stringify({
          step: "sd-20a-u28-screenshot",
          folder: THROWAWAY,
          file: "ECEN_SD_U28a-abc123.bmp",
          folderExisted: false,
          resultName: "x",
        }),
      ],
    ]);
    const removedDirs: string[] = [];
    let running = [PID];
    const io = {
      workbenchPids: () => running,
      fileExists: (p: string) =>
        files.has(p) ||
        [...files.keys()].some((k) => k.startsWith(p + "\\") || k.startsWith(p + "/")),
      readBytes: (p: string) => files.get(p)!,
      removeFile: (p: string) => {
        files.delete(p);
      },
      removeEmptyDir: (p: string) => {
        removedDirs.push(p);
      },
      listDir: () => [],
      readRunFile: (n: string) => run.get(n) ?? null,
      writeRunFile: (n: string, d: string | Buffer) => {
        run.set(n, d.toString());
      },
      log: () => {},
    };
    const cfg = { runDir: "run", sandboxDir: SANDBOX, gate: null, really: true };
    expect(runRollback(cfg, io)).toBe(1);
    expect(files.size).toBe(1);
    running = [];
    expect(runRollback(cfg, io)).toBe(0);
    expect(files.size).toBe(0);
    expect(run.has("u28-ECEN_SD_U28a-abc123.bmp")).toBe(true);
    expect(JSON.parse(run.get("rollback-sd-20a.json")!)).toMatchObject({ ok: true, landed: true });
    // Dry run: says what it would do, touches nothing.
    expect(runRollback({ ...cfg, gate: "dry run", really: false }, io)).toBe(0);
  });

  it("screenshot names carry the run nonce; probe facts and netstat listeners parse", () => {
    expect(() => screenshotName("ECEN_SD_U28a", "xyz")).toThrow();
    expect(() => screenshotName("bad-label", "abc123")).toThrow();
    expect(probeFacts({ factKeys: ["a", "b"], factValues: ["1", "2"] })).toEqual({
      a: "1",
      b: "2",
    });
    const out =
      "  TCP    0.0.0.0:5775   0.0.0.0:0   LISTENING   1000\r\n  TCP    127.0.0.1:9000   0.0.0.0:0   LISTENING   4242\r\n  TCP    [::]:9001   [::]:0   LISTENING   4242\r\n";
    expect(listenersInNetstat(out, [4242])).toEqual([
      { pid: 4242, port: 9000 },
      { pid: 4242, port: 9001 },
    ]);
    expect(isNeverPath(["&Edit", "Undo"])).toBe(true);
    expect(isNeverPath(["Window", "Hierarchy"])).toBe(false);
  });

  it("the runbook names every step, every invocation and every probe it does not answer", () => {
    const md = readFileSync(join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-D.md"), "utf-8");
    for (const s of buildSteps()) expect(md, s.id).toContain(s.id);
    for (const n of NOT_ANSWERED.filter((x) => x.part === "all"))
      expect(md, n.id).toContain(n.id.replace(/^P-E01-/, ""));
    expect(md).toContain("--owner-clicked");
    expect(md).toContain("--remove-probe");
  });
});

// ── Pre-sitting read fixes (M1 to M6, m1 to m10) ─────────────────────────────

describe("pre-sitting read fixes", () => {
  const gateData = (h: Harness): Record<string, unknown> =>
    (h.artifacts.get("sd-00-gate.json") as { data: Record<string, unknown> }).data;

  it("M1: a resumed gate ignores old log lines and stops only on a new ECEN_Probe compile error", async () => {
    const h = harness();
    const r1 = await runSession(options({ only: "sd-03-crash-reporter" }), h.deps);
    expect(statuses(r1)["sd-00-gate"]).toBe("pass");
    expect(gateData(h).logScan).toMatchObject({ from: 0, lines: 1, resumed: false });
    // sd-09's deliberate syntax error (an eval text, not a pack file) lands in the log.
    h.log += "SCRIPT (E): ECEN_Eval: syntax error, unexpected '}' (sd-09)\n";
    // A first, non-resumed gate still scans the whole log as before.
    const fresh = harness();
    fresh.log = h.log;
    const rf = await runSession(options({ only: "sd-03-crash-reporter" }), fresh.deps);
    expect(rf.exit).toBe(EXIT.stopped);
    expect(rf.stop?.reason).toMatch(/probe-pack compile errors/);
    // The resumed gate scans from line 1 and passes.
    const r2 = await runSession(options({ only: "sd-04-u8-matrix-closed" }), h.deps);
    expect(statuses(r2)["sd-00-gate"]).toBe("pass");
    expect(gateData(h).logScan).toMatchObject({ from: 1, lines: 2, resumed: true });
    expect(r2.steps.find((s) => s.id === "sd-00-gate")!.summary).toMatch(/resumed/);
    // A new compile error naming a pack file stops the next gate.
    h.log += 'SCRIPT (E): @"scripts/WorkbenchGame/EnfusionCensus/ECEN_ProbeSystem.c,12": error\n';
    const r3 = await runSession(options({ only: "sd-05-u34-diag-get" }), h.deps);
    expect(r3.exit).toBe(EXIT.stopped);
    expect(r3.stop?.reason).toMatch(/new ECEN_Probe compile errors after line 2/);
    expect(gateData(h).logScan).toMatchObject({ from: 2, stopped: true });
  });

  it("M2: WM_NULL and IsHungAppWindow go only to the main window recorded at the gate", async () => {
    const h = harness();
    await runSession(options({ only: "sd-21-u6-modal" }), h.deps);
    expect(gateData(h).mainHwnd).toBe(PID * 10);
    expect(h.stallTargets.length).toBeGreaterThan(0);
    expect(h.stallTargets.every((x) => x === PID * 10)).toBe(true);
    expect(h.hungTargets).toEqual([PID * 10]);
    // A prompt during a promptable call: no WM_NULL is sent while it is up.
    const a = harness({ authOn: "sd-01-auth-restart" });
    await runSession(options({ only: "sd-01-auth-restart" }), a.deps);
    expect(a.stallTargets).toEqual([]);
    expect(mainWindowOf([], PID)).toBeNull();
  });

  it("m2: sd-21 takes a new owned window as the dialog when its title is not the caption", () => {
    const w = (hwnd: number, title: string, owner = 0, enabled = true): WindowInfo => ({
      hwnd,
      pid: PID,
      className: "TestQt",
      title,
      owner,
      enabled,
      rect: [],
      monitor: [],
      primary: true,
    });
    const base = [w(10, MAIN_TITLE)];
    expect(u6Dialog(base, [w(10, MAIN_TITLE), w(20, "Probe", 10)], PID, 10)).toMatchObject({
      window: { hwnd: 20 },
      rule: expect.stringMatching(/owned/),
    });
    expect(u6Dialog(base, [w(10, MAIN_TITLE, 0, false), w(21, "x")], PID, 10)?.rule).toMatch(
      /main window is disabled/,
    );
    expect(u6Dialog(base, [w(10, MAIN_TITLE), w(21, "x")], PID, 10)).toBeNull();
  });

  it("M3: a second prompt of the same call is recorded and the owner reports every button", async () => {
    const h = harness({ authOn: "sd-01-auth-restart" });
    await runSession(options({ only: "sd-01-auth-restart" }), h.deps);
    // The owner clicked Yes; the same call raised a second prompt and its child still waits.
    const child = "child-sd-01-auth-restart-abc123.json";
    h.texts.set(`${child}.request.json`, "{}");
    h.texts.set(`${child}.pid.json`, JSON.stringify({ pid: 4242, created: 42420 }));
    const image = h.deps.processImage;
    h.deps.processImage = (pid) => (pid === 4242 ? "node.exe" : image(pid));
    const created = h.deps.processCreated;
    h.deps.processCreated = async (pid) => (pid === 4242 ? 42420 : created(pid));
    const r2 = await runSession(
      options({ only: "sd-02-auth-again", nonce: "def456", ownerClicked: "Yes" }),
      h.deps,
    );
    expect(r2.exit).toBe(EXIT.handoff);
    expect(r2.stop?.reason).toMatch(/prompt 2 of the same call/);
    expect(r2.stop?.reason).toMatch(/tools\/uia\/walk\.ts .*--label auth-sd-01-auth-restart-2/);
    expect(r2.stop?.reason).toMatch(
      /--only sd-02-auth-again .*--owner-clicked <button 1>,\.\.\.,<button 2>/,
    );
    expect(h.artifacts.get("auth-sd-01-auth-restart-2.json")).toMatchObject({
      step: "sd-01-auth-restart",
      prompt: 2,
      resultName: child,
      nonce: "def456",
    });
    expect(h.texts.has(AUTH_LOG)).toBe(false);
    // The owner clicks the second prompt: the call answers.
    h.extra.splice(0);
    h.results.set(child, { at: h.now(), result: ok({ status: "ok" }) });
    const one = await runSession(
      options({ only: "sd-02-auth-again", nonce: "def456", ownerClicked: "Yes" }),
      h.deps,
    );
    expect(one.exit).toBe(EXIT.refused);
    expect(one.stop?.reason).toMatch(/takes 2 button/);
    const r3 = await runSession(
      options({ only: "sd-02-auth-again", nonce: "def456", ownerClicked: ["Yes", "No"] }),
      h.deps,
    );
    const log = JSON.parse(h.texts.get(AUTH_LOG)!.trim()) as Record<string, unknown>;
    expect(log).toMatchObject({
      step: "sd-01-auth-restart",
      button: "Yes",
      buttons: ["Yes", "No"],
    });
    expect(statuses(r3)["sd-02-auth-again"]).toBe("observed");
  });

  it("M4: a timed-out child leaves the screenshot plant open for rollback, and the result says so", async () => {
    const h = harness({ authOn: "sd-20a-u28-screenshot" });
    await runSession(options({ only: "sd-20a-u28-screenshot" }), h.deps);
    h.extra.splice(0);
    h.results.set("child-sd-20a-u28-screenshot-abc123.json", {
      at: h.now(),
      result: { ...ok(), ok: false, timedOut: true, error: "timed out" },
    });
    h.sc.authOn = null;
    const b = await runSession(
      options({ only: "sd-20b-u28-screenshot", nonce: "def456", ownerClicked: "Yes" }),
      h.deps,
    );
    expect(statuses(b)["sd-20b-u28-screenshot"]).toBe("observed");
    expect(h.artifacts.has("rollback-sd-20a.json")).toBe(false);
    expect(h.artifacts.get("rollback-sd-20b.json")).toMatchObject({ landed: true });
    const res = h.artifacts.get("sd-20b-u28-screenshot.json") as {
      summary: string;
      data: { lateSettled: Array<{ settled: boolean }> };
    };
    expect(res.data.lateSettled[0].settled).toBe(false);
    expect(res.summary).toMatch(/plant-sd-20a\.json left open \(its child timed out\).*rollback/);
  });

  it("M5: sd-01 records the CrashReporter processes present at its handoff", async () => {
    const h = harness({ authOn: "sd-01-auth-restart" });
    await runSession(options({ only: "sd-01-auth-restart" }), h.deps);
    const res = h.artifacts.get("sd-01-auth-restart.json") as {
      data: { crashReporters: number[] };
    };
    expect(res.data.crashReporters).toEqual([4242]);
  });

  it("m1 and m4: an owned authorization window is the prompt; the record carries the owner and the nonce", async () => {
    const h = harness({ authOn: "sd-01-auth-restart", authOwner: PID * 10 });
    const r = await runSession(options({ only: "sd-01-auth-restart" }), h.deps);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stop?.reason).toMatch(/owned by 10000/);
    expect(r.stop?.reason).toMatch(/--allow-owned/);
    expect(h.artifacts.get("auth-sd-01-auth-restart.json")).toMatchObject({
      owner: PID * 10,
      nonce: "abc123",
    });
    // The gate's own handoff file carries the nonce too.
    const g = harness();
    g.extra.push({ ...(await g.deps.listWindows())[0], hwnd: 7001, title: AUTH_TITLE });
    const rg = await runSession(options({ only: "sd-03-crash-reporter", nonce: "a1b2c3" }), g.deps);
    expect(rg.stop?.step).toBe("sd-00-gate");
    expect(g.artifacts.get("auth-sd-00-gate.json")).toMatchObject({ nonce: "a1b2c3" });
  });

  it("m6: a failed window list is a stop, not 'no dialog'", async () => {
    const h = harness();
    h.deps.listWindows = async () => {
      throw new Error("the window list script failed: mock");
    };
    const r = await runSession(options({ only: "sd-05-u34-diag-get" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/window list failed/);
    expect(h.netCalls.some((c) => c.apiFunc === PROBE_API)).toBe(false);
  });

  it("m5: sd-11's summary states the queue signal, not a client-side overlap flag", async () => {
    const h = harness();
    const r = await runSession(options({ only: "sd-11-u30-rerun" }), h.deps);
    expect(r.steps.find((s) => s.id === "sd-11-u30-rerun")!.summary).toMatch(
      /a cheap call ended before a heavy call that started in the same tick: (yes|no)/,
    );
  });

  it("m10: a copy whose hash differs from the source's stops and leaves the BMP", async () => {
    const h = harness();
    h.deps.readRunBytes = () => Buffer.from("corrupt");
    const r = await runSession(options({ only: "sd-20a-u28-screenshot" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/does not hash to the source/);
    expect(h.files.has(join(SANDBOX, THROWAWAY, "ECEN_SD_U28a-abc123.bmp"))).toBe(true);
    expect(h.artifacts.has("rollback-sd-20a.json")).toBe(false);
  });

  it("scanSessionLog: a stopped scan is not resumed from", () => {
    const prev = { log: "L", lines: 1, from: 0, resumed: false, stopped: true };
    expect(scanSessionLog("L", "a\nECEN_Eval error\n", prev).scan.resumed).toBe(false);
    expect(scanSessionLog("L", "a\nECEN_Eval error\n", { ...prev, stopped: false }).errors).toEqual(
      [],
    );
  });
});
