import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlan, main as dryRunMain, type PlanAction } from "../../scripts/live/dry-run.js";
import { probePackTarget } from "../../scripts/live/launch.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { PROBE_ORDER, validateQueue } from "../../scripts/live/preflight.js";
import { BACKGROUND_CAP_MS } from "../../scripts/live/session-common.js";
import type { DetachedSpec, RawCallResult, WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  ANSWERED_IN_007,
  BLOCKS,
  REPEAT_STEPS,
  WORLDS_FILE,
  registrationProblem,
  tinyOpenTarget,
  DEFAULT_QUEUE,
  EXIT,
  MUT_API,
  NEVER_MODULE,
  NOT_ANSWERED,
  OFFLINE_STEP,
  PROBE_API,
  RULINGS_PENDING,
  SCRIPT_PATH,
  SKIP_REASON,
  THROWAWAY,
  TINY_WORLD,
  U11_PLANTS,
  U14_FILE,
  U14_FOLDER_REL,
  U8_MODULES,
  buildActionPlan,
  HEIGHT_EPS,
  undoVerdict,
  type StepDef,
  entityState,
  infoAddonIds,
  moduleOpened,
  resourceLine,
  strayName,
  buildPlants,
  buildQueue,
  buildSteps,
  dropLine,
  editFirstNode,
  firstScalar,
  invocationWorstCaseMs,
  isThrowawayWorld,
  main,
  metaText,
  notAnswered,
  planInput,
  requote,
  rewriteMetaName,
  runRollback,
  runSession,
  selectedIds,
  selectionRefusal,
  sendRefusal,
  stripCompiled,
  swapFirstScalars,
  type OfflineIo,
  type SeDeps,
  type SeOptions,
} from "../../scripts/live/s-e-train1b.js";

// Everything below is synthetic: pids, window classes, titles, paths and NET answers are test
// data, not Workbench facts. No socket is opened.

const repoPolicy = loadPolicy();
const emptyLists: CensusPolicy = {
  ...repoPolicy,
  probe_mut: { plugin_run_allow_list: [], diag_set_allow_list: [] },
} as CensusPolicy;

const TMP = mkdtempSync(join(tmpdir(), "emcp-se-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const SANDBOX = join(TMP, "addons", SANDBOX_NAME);
const GPROJ = join(SANDBOX, `${SANDBOX_NAME}.gproj`);
const WB = "ArmaReforgerWorkbenchSteamDiag.exe";
const PID = 1000;
const SCRATCH_INI = join(TMP, "scratch.ini");
writeFileSync(SCRATCH_INI, "[World%20Editor]\r\nScriptDebugMode=false\r\n");
const LOG_LINE = `ENGINE: Using autosave directory: T:/planted/Projects/${SANDBOX_NAME}/autosaves\n`;
const rel = (p: string): string => join(SANDBOX, ...p.split("/"));

function ok(response?: unknown): RawCallResult {
  return {
    ok: true,
    response,
    timedOut: false,
    durationMs: 5,
    bytesSent: 10,
    bytesReceived: 10,
    wire: { status: "Ok", payload: "present" },
  };
}
const pack = (facts: Record<string, string> = {}, status = "ok", message = ""): unknown => ({
  status,
  message,
  factKeys: Object.keys(facts),
  factValues: Object.values(facts),
  pageCount: 1,
});

interface Scenario {
  mutRefused: boolean;
  mutMissing: boolean;
  workbenchRunning: boolean;
  worldExisted: boolean;
  dialogOn: string | null;
  diagRestoreFails: boolean;
  diagSetRefused: boolean;
  undoFails: boolean;
  renameFails: boolean;
  saveErrorNoFile: boolean;
  moduleNotOpened: boolean;
  getEntityUnknown: boolean;
  worldPath: string;
  diagStart: number;
  tileAfterDelta: number;
  onlyTinyCreated: boolean;
  layerError: boolean;
  lpFails: boolean;
  noBounds: boolean;
  /** createSandboxWorlds' registration facts (DEC-044 fix, 9eed30b). */
  registration: Record<string, string>;
}
const GUID_TINY = `{0123456789ABCDEF}${TINY_WORLD}`;
const GUID_FLAT = "{FEDCBA9876543210}_throwaway/SE/worlds/ECEN_SE_Flat.ent";
const BASE: Scenario = {
  registration: {
    tinyRegistered: "true",
    tinyResourceName: GUID_TINY,
    terrainRegistered: "true",
    terrainResourceName: GUID_FLAT,
  },
  diagSetRefused: false,
  undoFails: false,
  renameFails: false,
  saveErrorNoFile: false,
  moduleNotOpened: false,
  getEntityUnknown: false,
  worldPath: `<sandbox>/${TINY_WORLD}`,
  diagStart: 0,
  tileAfterDelta: 1,
  onlyTinyCreated: false,
  layerError: false,
  lpFails: false,
  noBounds: false,
  mutRefused: false,
  mutMissing: false,
  workbenchRunning: false,
  worldExisted: false,
  dialogOn: null,
  diagRestoreFails: false,
};

interface Harness {
  deps: SeDeps;
  netCalls: Array<{ apiFunc: string; params: Record<string, unknown> }>;
  detached: DetachedSpec[];
  files: Map<string, Buffer>;
  artifacts: Map<string, unknown>;
  texts: Map<string, string>;
  extra: WindowInfo[];
  maxConcurrent: number;
  now(): number;
}

function harness(over: Partial<Scenario> = {}): Harness {
  const sc = { ...BASE, ...over };
  let t = 1_700_000_000_000;
  let inFlight = 0;
  let diag = sc.diagStart;
  const entities = new Set<string>();
  const results = new Map<string, RawCallResult>();
  const h: Harness = {
    deps: undefined as unknown as SeDeps,
    netCalls: [],
    detached: [],
    files: new Map(),
    artifacts: new Map(),
    texts: new Map(),
    extra: [],
    maxConcurrent: 0,
    now: () => t,
  };
  for (const f of ["ECEN_Probe.c", "ECEN_ProbeSystem.c", "ECEN_ProbeMut.c", "ECEN_ProbeMutGuard.c"])
    h.files.set(join(probePackTarget(SANDBOX), f), Buffer.from("// c"));
  // The offline plants, as the plant subcommand writes them.
  const plants = buildPlants(
    (p) =>
      Buffer.from(
        p.endsWith(".pap") || p.endsWith(".siga")
          ? "X {\n a 1\n b 2\n compiled C {\n  v 2\n }\n}\n"
          : p.endsWith(".agf")
            ? "G {\n EditorPos 1 2\n}\n"
            : 'R {\n Version 2\n E {\n  a 1\n  b 2\n  n "Ident"\n }\n}\n',
      ),
    () => "0123456789ABCDEF",
  );
  for (const p of [...plants.u25, ...plants.u11]) h.files.set(rel(p.rel), p.data);
  h.texts.set(
    "plant-se-u25.json",
    JSON.stringify(plants.u25.map((p) => ({ rel: p.rel, sha256: "x" }))),
  );
  h.texts.set("plant-se-u11.json", "[]");
  if (sc.worldExisted) h.files.set(rel(TINY_WORLD), Buffer.from("world"));
  const win = (title: string, hwnd: number, owner = 0, cls = "TestQtMain"): WindowInfo => ({
    hwnd,
    pid: PID,
    className: cls,
    title,
    owner,
    enabled: true,
    rect: [],
    monitor: [],
    primary: true,
  });
  const answer = (apiFunc: string, params: Record<string, unknown>): RawCallResult => {
    const action = String(params.action ?? "");
    switch (apiFunc) {
      case "IsWorkbenchRunning":
      case "IsWorldEditorRunning":
        return ok({ IsRunning: true, ScriptsCompiled: true });
      case "GetLoadedProjects":
        if (sc.lpFails && h.netCalls.filter((c) => c.apiFunc === "GetLoadedProjects").length > 1)
          return { ...ok(), ok: false, error: "connection closed" };
        return ok({ "Loaded Projects": ["ArmaReforger", SANDBOX_NAME] });
      case "EMCP_WB_Terrain":
        return ok({ status: "ok", height: 10 });
      case "OpenResource":
        return ok({ Opened: true });
      case "EMCP_WB_GetState":
        return ok({ status: "ok", mode: "edit", entityCount: 0, selectedCount: 0 });
      case "EMCP_WB_CreateEntity":
        if (sc.renameFails) {
          entities.add("Entity_7");
          return ok({
            status: "error",
            message: "RenameEntity returned false",
            entityName: "Entity_7",
          });
        }
        entities.add(String(params.name));
        return ok({ status: "ok", entityName: String(params.name) });
      case "EMCP_WB_GetEntity":
        if (
          sc.getEntityUnknown &&
          h.netCalls.filter((c) => c.apiFunc === "EMCP_WB_GetEntity").length > 1
        )
          return ok({ status: "error", message: "WorldEditorAPI not available" });
        return entities.has(String(params.name))
          ? ok({ status: "ok" })
          : ok({ status: "error", message: `Entity not found with name: ${String(params.name)}` });
      case "EMCP_WB_EditorControl":
        if (params.action === "openResource")
          return ok({ status: "ok", message: `Opened resource: ${String(params.path)}` });
        if (sc.undoFails)
          return ok({ status: "error", message: "ExecuteAction(Edit, Undo) returned false" });
        entities.clear();
        return ok({ status: "ok" });
      case "EMCP_WB_DeleteEntity":
        entities.delete(String(params.name));
        return ok({ status: "ok" });
      case "EMCP_WB_Components":
        return ok({ components: [{ className: "SCR_CharacterStaminaComponent", index: 3 }] });
      case "EMCP_WB_ModifyEntity":
        return ok({ status: "ok", message: "-0.009" });
      case PROBE_API:
        if (action === "info") return ok(pack({ isSandbox: "true" }));
        if (action === "layerRead")
          return ok({
            ...(pack({ worldPath: sc.worldPath, subScenes: "1" }) as object),
            cells: ["ECEN_SE_L1"],
          });
        if (action === "diagRead") return ok(pack({ value: String(diag) }));
        if (action === "terrainFacts")
          return ok(
            pack(
              sc.noBounds
                ? { hasBounds: "false" }
                : { hasBounds: "true", boundsMin: "<0, 0, 0>", boundsMax: "<100, 50, 100>" },
            ),
          );
        if (action === "moduleMatrix")
          return ok({
            ...(pack() as object),
            columns: ["module", "present", "openCalled", "openResult"],
            cells: [
              String(params.moduleName ?? "AnimEditor"),
              String(!sc.moduleNotOpened),
              "true",
              String(!sc.moduleNotOpened),
            ],
          });
        return ok(pack());
      case MUT_API:
        if (sc.mutMissing)
          return { ...ok(), ok: false, error: "Workbench error: Undefined API func" };
        if (sc.mutRefused)
          return ok(pack({}, "refused", "refused: the 2.0 sandbox addon is not loaded"));
        if (action === "none") return ok(pack({}, "error", "Unknown action: none"));
        if (action === "diagSet") {
          if (sc.diagSetRefused) return ok(pack({}, "refused", "not on the diag list"));
          diag =
            sc.diagRestoreFails && Number(params.diagValue) === 0 ? 1 : Number(params.diagValue);
          return ok(pack({ after: String(diag) }));
        }
        if (action === "createSandboxWorlds") {
          h.files.set(rel(TINY_WORLD), Buffer.from("world"));
          if (!sc.onlyTinyCreated)
            h.files.set(rel("_throwaway/SE/worlds/ECEN_SE_Flat.ent"), Buffer.from("world"));
          return ok(
            pack({
              tinyWorld: "t",
              terrainWorld: "f",
              tinyExistedBefore: String(sc.worldExisted),
              terrainExistedBefore: "false",
              ...sc.registration,
            }),
          );
        }
        if (action === "saveContainer") {
          if (sc.saveErrorNoFile) return ok(pack({}, "error", "LoadContainer returned null"));
          h.files.set(rel(String(params.target)), Buffer.from("C {\n Volume 3\n}\n"));
          return ok(pack({ saved: "true" }));
        }
        if (action === "terrainWriteThrowaway")
          return ok(
            pack({
              began: "true",
              wrote: "true",
              before: "12.345",
              after: String(12.345 + sc.tileAfterDelta),
            }),
          );
        if (action === "layerCreateThrowaway" && sc.layerError)
          return ok(pack({}, "error", "name must be an identifier starting with ECEN_"));
        if (action === "layerCreateThrowaway")
          return ok(pack({ created: "ECEN_SE_L1", createdIsNewItem: "true", saved: "true" }));
        if (action === "containerWriteTest")
          return ok(
            pack({ containers: "0" }, "error", "index out of range: the module holds 0 containers"),
          );
        return ok(pack());
      default:
        return ok({});
    }
  };
  h.deps = {
    net: async (apiFunc, params) => {
      inFlight++;
      h.maxConcurrent = Math.max(h.maxConcurrent, inFlight);
      h.netCalls.push({ apiFunc, params });
      await new Promise<void>((r) => setImmediate(r));
      inFlight--;
      return answer(apiFunc, params);
    },
    listWindows: async () => [win("Enfusion Workbench - World Editor", PID * 10), ...h.extra],
    capture: async (label) => ({ ok: true, path: `capture-${label}.png`, detail: "mock" }),
    guiStall: async (_p, n) => Array.from({ length: n }, () => 3),
    hungApp: async () => false,
    processImage: (pid) => (pid === PID ? WB : null),
    processCreated: async (pid) => (pid === PID ? PID * 10 : null),
    workbenchPids: () => (sc.workbenchRunning ? [PID] : []),
    listRunFiles: () => [...h.artifacts.keys(), ...h.texts.keys(), ...results.keys()],
    listDir: (p) => [
      ...new Set(
        [...h.files.keys()]
          .filter((k) => k.startsWith(p + "\\") || k.startsWith(p + "/"))
          .map((k) => k.slice(p.length + 1).split(/[\\/]/)[0]),
      ),
    ],
    listTree: (p) =>
      [...h.files.keys()]
        .filter((k) => k.startsWith(p + "\\") || k.startsWith(p + "/"))
        .map((k) => k.slice(p.length + 1).replace(/\\/g, "/")),
    portOwners: () => [PID],
    crashReporters: () => [],
    closeGracefully: async () => ({ exited: true, detail: "mock" }),
    recordedPid: () => PID,
    heartbeat: () => {},
    sessionLogAfter: () => "LOG",
    readText: (p) => (/\.ini$/i.test(p) ? readFileSync(SCRATCH_INI, "utf-8") : LOG_LINE),
    readRegLines: () => [],
    fileExists: (p) =>
      h.files.has(p) ||
      [...h.files.keys()].some((k) => k.startsWith(p + "\\") || k.startsWith(p + "/")),
    readBytes: (p) => {
      const b = h.files.get(p);
      if (!b) throw new Error(`no file ${p}`);
      return b;
    },
    writeFile: (p, d) => {
      h.files.set(p, d);
    },
    moveFile: (a, b) => {
      h.files.set(b, h.files.get(a)!);
      h.files.delete(a);
    },
    removeFile: (p) => {
      h.files.delete(p);
    },
    removeEmptyDir: () => {},
    startDetached: (spec) => {
      h.detached.push(spec);
      if (sc.dialogOn && spec.resultName.includes(sc.dialogOn)) {
        h.extra.push(win("Error", 7300, PID * 10, "#32770"));
        return 4300;
      }
      results.set(spec.resultName, answer(spec.apiFunc, spec.params));
      return 4245;
    },
    readRunFile: (name) => {
      if (results.has(name)) return JSON.stringify(results.get(name));
      if (h.texts.has(name)) return h.texts.get(name)!;
      const a = h.artifacts.get(name);
      return a === undefined ? null : JSON.stringify(a);
    },
    appendRunLine: (name, line) => {
      h.texts.set(name, (h.texts.get(name) ?? "") + line + "\n");
    },
    writeArtifact: (name, value) => {
      h.artifacts.set(name, JSON.parse(JSON.stringify(value)));
      return `run/${name}`;
    },
    writeEvidence: () => "EV",
    writeGracefulExit: () => "run/graceful-exit.json",
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    log: () => {},
  };
  return h;
}

function options(over: Partial<SeOptions> = {}): SeOptions {
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
    laneId: "se-test",
    policy: repoPolicy,
    registryExport: "REG",
    debugModeUnsetOk: false,
    forceSettings: SCRATCH_INI,
    offline: false,
    u15Launch3: false,
    ...over,
  };
}
const statuses = (r: Awaited<ReturnType<typeof runSession>>): Record<string, string> =>
  Object.fromEntries(r.steps.map((s) => [s.id, s.status]));

/**
 * Every probe whose schedule ever named S-E. After the S-E batch (session 007) the probes carried
 * to "an S-E repeat" are deferred, not scheduled: a deferred record whose outcome names an S-E
 * repeat counts as scheduled to S-E here.
 */
function everScheduledToSE(): string[] {
  const ids = new Set<string>();
  for (const line of readFileSync(join(REPO_ROOT, "data", "census", "probes.jsonl"), "utf-8").split(
    /\r?\n/,
  )) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Record<string, unknown>;
    if (
      String(r.scheduled_session ?? "")
        .split(/,\s*/)
        .includes("S-E") ||
      (r.status === "deferred" && /an S-E repeat/.test(String(r.outcome ?? "")))
    )
      ids.add(String(r.id));
  }
  return [...ids];
}

// ── The queue ────────────────────────────────────────────────────────────────

describe("queue", () => {
  const raw = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as {
    probes: Array<Record<string, unknown>>;
    rulings_pending: Array<{ id: string; gates: string[] }>;
  };

  it("equals the script's step table (regenerate with --emit-queue)", () => {
    expect(raw).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });

  it("validates as a pre-flight step 7 queue, ordered within each launch", () => {
    const q = validateQueue(raw, false);
    expect(q.length).toBe(buildSteps().length);
    for (const l of [0, 1, 2, 3]) {
      const ranks = raw.probes
        .filter((p) => p.launch === l)
        .map((p) => (PROBE_ORDER as readonly string[]).indexOf(String(p.risk_class)));
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
    expect(buildSteps().length).toBe(29);
  });

  it("covers every probe scheduled to S-E: answered by a step or listed as not answered; claims nothing else", () => {
    const ever = everScheduledToSE();
    expect(ever.length).toBe(46);
    const answered = new Set(buildSteps().flatMap((s) => s.answers));
    const unanswered = new Set(NOT_ANSWERED.filter((n) => n.part === "all").map((n) => n.id));
    for (const id of ever) expect(answered.has(id) || unanswered.has(id), id).toBe(true);
    for (const id of [...answered, ...notAnswered().map((n) => n.id)])
      expect(ever.includes(id), id).toBe(true);
    for (const id of unanswered) expect(answered.has(id), id).toBe(false);
    expect([...unanswered].sort()).toEqual([
      "P-E01-mcp-inventory-L348",
      "P-E01-plugins-netapi-cli-L469",
      "P-E01-resource-manager-L663",
      "P-E01-script-string-dialogue-L413",
    ]);
    const ids = new Set(buildSteps().map((s) => s.id));
    for (const n of notAnswered())
      for (const s of n.answered_by ?? []) expect(ids.has(s), `${n.id} ${s}`).toBe(true);
  });

  it("names the pending owner rulings and the steps they gate", () => {
    expect(raw.rulings_pending.map((r) => r.id)).toEqual(["Q1", "Q3"]);
    const q1 = RULINGS_PENDING.find((r) => r.id === "Q1")!;
    expect([...q1.gates]).toEqual([
      "se-12-world-open-terrain",
      "se-13-u18-tile",
      "se-14-u18-modify",
      "se-15-u10-run",
    ]);
    for (const r of RULINGS_PENDING)
      for (const id of r.gates)
        expect(buildSteps().find((s) => s.id === id)?.waitsOn, id).toBe(r.id);
  });

  it("has no Particle Editor step and both Q8 restores in the step definitions", () => {
    const steps = buildSteps();
    expect(steps.some((s) => /ParticleEditor/.test(s.id))).toBe(false);
    expect(U8_MODULES.map((m) => m.name)).not.toContain(NEVER_MODULE);
    expect(steps.find((s) => s.id === "se-04-u34-diag-set")!.restore).toMatch(/value .* before/);
    expect(steps.find((s) => s.id === "se-15-u10-run")!.restore).toMatch(/selection is read empty/);
  });

  it("gives each step a timeout no smaller than its planned calls", () => {
    const p = planInput({
      sandboxDir: SANDBOX,
      policy: repoPolicy,
      nonce: "abc123",
      u15Launch3: true,
    });
    for (const s of buildSteps()) {
      const sum = s
        .plan(p)
        .filter((a) => a.kind === "net-call")
        .reduce((n, a) => n + Number(a.timeout_ms), 0);
      expect(s.timeout_ms, s.id).toBeGreaterThanOrEqual(sum);
    }
  });
});

describe("blocks", () => {
  it("every block fits the background cap with margin and the blocks cover every step once", () => {
    const steps = buildSteps();
    for (const b of BLOCKS)
      expect(invocationWorstCaseMs(selectedIds(b, steps), steps), b.from).toBeLessThan(
        BACKGROUND_CAP_MS - 900_000,
      );
    expect(BLOCKS.flatMap((b) => selectedIds(b, steps))).toEqual(steps.slice(1).map((s) => s.id));
  });

  it("refuses undeclared selections, a later block without --run-dir, and offline mixups", () => {
    expect(selectionRefusal({ from: null, until: null, only: null, runDir: false })).toMatch(
      /one declared block/,
    );
    expect(
      selectionRefusal({
        from: "se-01-u25-first-start",
        until: "se-02-u11-load-handedits",
        only: null,
        runDir: false,
        repeatAll: true,
      }),
    ).toBeNull();
    expect(
      selectionRefusal({
        from: null,
        until: null,
        only: "se-05-u16-save",
        runDir: false,
        repeatAll: true,
      }),
    ).toMatch(/--run-dir/);
    expect(
      selectionRefusal({
        from: null,
        until: null,
        only: OFFLINE_STEP,
        runDir: true,
        repeatAll: true,
      }),
    ).toMatch(/--offline/);
    expect(
      selectionRefusal({
        from: null,
        until: null,
        only: "se-05-u16-save",
        runDir: true,
        offline: true,
        repeatAll: true,
      }),
    ).toMatch(/--offline runs/);
  });
});

// ── The repeat sitting (DEC-044) ─────────────────────────────────────────────

describe("repeat sitting", () => {
  it("se-03 passes only with both worlds registered under {GUID}-prefixed names, and writes worlds.json", async () => {
    const h = harness();
    const r = await runSession(options({ only: "se-03-worlds-create" }), h.deps);
    expect(statuses(r)["se-03-worlds-create"]).toBe("pass");
    expect(h.artifacts.get(WORLDS_FILE)).toMatchObject({
      tinyRegistered: "true",
      tinyResourceName: GUID_TINY,
      terrainRegistered: "true",
      terrainResourceName: GUID_FLAT,
      registrationProblem: null,
    });
    const data = (h.artifacts.get("se-03-worlds-create.json") as { data: Record<string, unknown> })
      .data;
    expect(data.registration).toMatchObject({ tinyResourceName: GUID_TINY });
    for (const [reg, why] of [
      [{ ...BASE.registration, tinyRegistered: "false" }, /tinyRegistered "false"/],
      [
        { ...BASE.registration, terrainResourceName: "_throwaway/SE/worlds/ECEN_SE_Flat.ent" },
        /terrainResourceName .* not \{GUID\}-prefixed/,
      ],
      [{ tinyWorld: "t" }, /tinyRegistered absent; terrainRegistered absent/],
    ] as const) {
      const h2 = harness({ registration: reg as Record<string, string> });
      const r2 = await runSession(options({ only: "se-03-worlds-create" }), h2.deps);
      expect(statuses(r2)["se-03-worlds-create"]).toBe("fail");
      expect(r2.steps.find((x) => x.id === "se-03-worlds-create")!.summary).toMatch(why);
    }
    expect(registrationProblem({ ...BASE.registration })).toBeNull();
  });

  it("se-08 and se-23 open by the registered name from worlds.json, else by the path, and record which", async () => {
    expect(tinyOpenTarget(null)).toMatchObject({ form: "path", resourceName: TINY_WORLD });
    expect(
      tinyOpenTarget(JSON.stringify({ tinyRegistered: "true", tinyResourceName: GUID_TINY })),
    ).toMatchObject({ form: "resourceName", resourceName: GUID_TINY });
    expect(
      tinyOpenTarget(JSON.stringify({ tinyRegistered: "false", tinyResourceName: GUID_TINY })).form,
    ).toBe("path");
    expect(
      tinyOpenTarget(
        JSON.stringify({
          tinyRegistered: "true",
          tinyResourceName: "{0123456789ABCDEF}Worlds/X.ent",
        }),
      ).form,
    ).toBe("path");
    expect(isThrowawayWorld({ worldPath: GUID_TINY, subScenes: "1" }, TINY_WORLD)).toBe(true);

    // With worlds.json from se-03: the GUID name is sent; GetWorldPath in that form passes.
    const h = harness({ worldPath: GUID_TINY });
    await runSession(options({ only: "se-03-worlds-create", nonce: "aaa001" }), h.deps);
    const r = await runSession(
      options({ only: "se-08-world-open-tiny", runDir: "x", nonce: "aaa002" }),
      h.deps,
    );
    expect(statuses(r)["se-08-world-open-tiny"]).toBe("pass");
    // The open goes through the shipped openResource with the project-relative path (the 1.x
    // tool's route); the registered name is recorded in openedBy, not sent.
    const open = h.detached.filter((d) => d.apiFunc === "EMCP_WB_EditorControl");
    expect(open.at(-1)!.params).toEqual({ action: "openResource", path: TINY_WORLD });
    const d8 = (h.artifacts.get("se-08-world-open-tiny.json") as { data: Record<string, unknown> })
      .data;
    expect(d8.openedBy).toMatchObject({ form: "resourceName" });
    expect(d8.rawWorldPath).toBe(GUID_TINY);
    expect(d8.rawWorldPathGuidPrefixed).toBe(true);

    // Without worlds.json: the path, recorded as such, in se-08 and se-23.
    const h2 = harness({ worldExisted: true });
    h2.files.set(rel(TINY_WORLD), Buffer.from("w"));
    await runSession(options({ only: "se-08-world-open-tiny", runDir: "x" }), h2.deps);
    await runSession(
      options({ only: "se-23-world-reopen-tiny", runDir: "x", nonce: "bbb001" }),
      h2.deps,
    );
    for (const id of ["se-08-world-open-tiny", "se-23-world-reopen-tiny"]) {
      const d = (h2.artifacts.get(`${id}.json`) as { data: Record<string, unknown> }).data;
      expect(d.openedBy, id).toMatchObject({ form: "path", resourceName: TINY_WORLD });
      expect(d.rawWorldPath, id).toBe(`<sandbox>/${TINY_WORLD}`);
    }
    expect(
      h2.detached.filter((d) => d.apiFunc === "EMCP_WB_EditorControl").map((d) => d.params.path),
    ).toEqual([TINY_WORLD, TINY_WORLD]);
  });

  it("--repeat selects exactly the gate, se-03, se-08 to se-11 and the close test, in one launch", async () => {
    const steps = buildSteps();
    expect(selectedIds({ from: null, until: null, repeat: true }, steps)).toEqual([
      ...REPEAT_STEPS,
    ]);
    expect(
      selectionRefusal({ from: null, until: null, only: null, runDir: false, repeat: true }),
    ).toBeNull();
    expect(
      selectionRefusal({
        from: null,
        until: null,
        only: "se-03-worlds-create",
        runDir: false,
        repeat: true,
      }),
    ).toMatch(/--repeat excludes/);
    expect(
      selectionRefusal({
        from: null,
        until: null,
        only: null,
        runDir: false,
        repeat: true,
        offline: true,
      }),
    ).toMatch(/--offline runs/);
    expect(
      invocationWorstCaseMs(selectedIds({ from: null, until: null, repeat: true }, steps), steps),
    ).toBeLessThan(BACKGROUND_CAP_MS);
    const h = harness();
    const r = await runSession(options({ repeat: true }), h.deps);
    expect(r.exit).toBe(EXIT.done);
    const ran = r.steps.filter((s) => s.status !== "not-run").map((s) => s.id);
    expect(ran).toEqual(["se-00-gate", ...REPEAT_STEPS]);
    const st = statuses(r);
    expect(st["se-03-worlds-create"]).toBe("pass");
    expect(st["se-08-world-open-tiny"]).toBe("pass");
    expect(st["se-24-close-test"]).toBe("observed");
    expect(h.maxConcurrent).toBe(1);
    const q = buildQueue(steps) as {
      repeat_sitting: { steps: string[]; not_run: string[] };
      probes: Array<{ id: string; repeat?: string }>;
    };
    expect(q.repeat_sitting.steps).toEqual(["se-00-gate", ...REPEAT_STEPS]);
    expect(q.probes.filter((p) => p.repeat).map((p) => p.id)).toEqual([...ANSWERED_IN_007]);
  });

  it("refuses a step session 007 answered unless --repeat-all is given; Q1 and Q3 steps keep their gates", async () => {
    for (const id of ANSWERED_IN_007) {
      expect(selectionRefusal({ from: null, until: null, only: id, runDir: true }), id).toMatch(
        /answered in session 007, not run in the repeat/,
      );
    }
    expect(
      selectionRefusal({ from: "se-20-gate", until: "se-24-close-test", only: null, runDir: true }),
    ).toMatch(/answered in session 007/);
    expect(
      selectionRefusal({
        from: null,
        until: null,
        only: "se-05-u16-save",
        runDir: true,
        repeatAll: true,
      }),
    ).toBeNull();
    expect(
      selectionRefusal({ from: null, until: null, only: "se-12-world-open-terrain", runDir: true }),
    ).toBeNull();
    expect(
      selectionRefusal({ from: null, until: null, only: "se-08-world-open-tiny", runDir: true }),
    ).toBeNull();
    for (const g of RULINGS_PENDING)
      for (const id of g.gates) expect(REPEAT_STEPS as readonly string[]).not.toContain(id);
    const lines: string[] = [];
    const code = await main(["--repeat", "--sandbox", SANDBOX, "--nonce", "abc123"], {
      out: (l) => lines.push(l),
    });
    expect(code).toBe(EXIT.done);
    expect(lines.some((l) => l.startsWith(`this invocation: ${REPEAT_STEPS.join(", ")}`))).toBe(
      true,
    );
  });
});

// ── The dry-run plan ─────────────────────────────────────────────────────────

describe("action plan", () => {
  it("passes the checker with only net-call, execute-action and screenshot; never names the Particle Editor or MainMenuWorld", () => {
    for (const policy of [repoPolicy, emptyLists]) {
      const plan = buildActionPlan(
        planInput({ sandboxDir: SANDBOX, policy, nonce: "abc123", u15Launch3: true }),
      );
      expect(checkPlan(plan, policy, { script: SCRIPT_PATH }).violations).toEqual([]);
      for (const a of plan) expect(["net-call", "execute-action", "screenshot"]).toContain(a.kind);
      const text = JSON.stringify(plan);
      expect(text).not.toMatch(/ParticleEditor|MainMenuWorld/);
      for (const a of plan.filter(
        (x) => x.params && (x.params as Record<string, unknown>).action === "terrainWriteThrowaway",
      ))
        expect((a.params as Record<string, unknown>).save).toBe(false);
    }
  });

  it("the file writes and dialog-capable calls are detached; no call is concurrent", () => {
    const plan = buildActionPlan(
      planInput({ sandboxDir: SANDBOX, policy: repoPolicy, nonce: "abc123" }),
    );
    expect(plan.some((a) => a.concurrent)).toBe(false);
    const must = [
      "createSandboxWorlds",
      "saveContainer",
      "containerWriteTest",
      "pluginRunDialogFree",
      "layerCreateThrowaway",
    ];
    for (const a of plan.filter((x): x is PlanAction => x.kind === "net-call")) {
      const p = (a.params ?? {}) as Record<string, unknown>;
      if (
        must.includes(String(p.action)) ||
        ["OpenResource", "ReloadScripts"].includes(String(a.target))
      )
        expect(a.detached, `${a.step} ${String(p.action ?? a.target)}`).toBe(true);
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
    expect(readFileSync(out, "utf-8")).not.toContain(TMP);
  });
});

// ── Refusals at the send ─────────────────────────────────────────────────────

describe("refusals", () => {
  const ref = (
    step: string,
    apiFunc: string,
    params: Record<string, unknown>,
    confirmed: string | null = null,
  ): string | null => sendRefusal(step, apiFunc, params, repoPolicy, confirmed);

  it("the Particle Editor is never addressed, and a .ptc is never opened", () => {
    expect(
      ref("se-07-u8-AnimEditor", MUT_API, {
        action: "containerWriteTest",
        moduleName: "ParticleEditor",
        target: `${THROWAWAY}/SE/u16/x.ptc`,
      }),
    ).toMatch(/Particle Editor/);
    expect(
      ref("se-02-u11-load-handedits", PROBE_API, {
        action: "moduleMatrix",
        openModules: true,
        moduleName: "ParticleEditor",
      }),
    ).toMatch(/Particle Editor/);
    expect(
      ref("se-08-world-open-tiny", "OpenResource", {
        ResourceName: "Particles/Enviroment/Flies.ptc",
      }),
    ).toMatch(/\.ptc/);
    expect(
      ref("se-02-u11-load-handedits", PROBE_API, {
        action: "loadContainer",
        path: "Particles/Enviroment/Flies.ptc",
      }),
    ).toBeNull();
  });

  it("MainMenuWorld.ent is never named", () => {
    expect(
      ref("se-08-world-open-tiny", "OpenResource", {
        ResourceName: "worlds/MainMenuWorld/MainMenuWorld.ent",
      }),
    ).toMatch(/MainMenuWorld/);
  });

  it("Edit > Undo only in se-09 and se-14, only after the throwaway-world check, never through executeAction", () => {
    const undo = { action: "undo" };
    expect(
      ref("se-10-u13-component", "EMCP_WB_EditorControl", undo, "se-10-u13-component"),
    ).toMatch(/only se-09 and se-14/);
    expect(ref("se-09-u19-undo", "EMCP_WB_EditorControl", undo, null)).toMatch(/throwaway world/);
    expect(ref("se-09-u19-undo", "EMCP_WB_EditorControl", undo, "se-09-u19-undo")).toBeNull();
    expect(ref("se-14-u18-modify", "EMCP_WB_EditorControl", undo, "se-14-u18-modify")).toBeNull();
    expect(
      ref(
        "se-09-u19-undo",
        PROBE_API,
        { action: "executeAction", moduleName: "WorldEditor", menuPath: ["Edit", "Undo"] },
        "se-09-u19-undo",
      ),
    ).toMatch(/never sent/);
    expect(
      ref("se-09-u19-undo", "EMCP_WB_ExecuteAction", { path: ["&Edit", "undo"] }, "se-09-u19-undo"),
    ).toMatch(/never sent/);
    expect(
      isThrowawayWorld({ worldPath: `<sandbox>/${TINY_WORLD}`, subScenes: "1" }, TINY_WORLD),
    ).toBe(true);
    expect(
      isThrowawayWorld({ worldPath: "<sandbox>/Worlds/Master.ent", subScenes: "1" }, TINY_WORLD),
    ).toBe(false);
  });

  it("writes outside _throwaway/ are refused; save:true never goes to terrainWriteThrowaway; moduleSave never", () => {
    expect(
      ref("se-05-u16-save", MUT_API, {
        action: "saveContainer",
        source: "a.conf",
        target: "Configs/a.conf",
      }),
    ).toMatch(/not under _throwaway/);
    expect(
      ref("se-05-u16-save", MUT_API, {
        action: "saveContainer",
        source: "a.conf",
        target: `${THROWAWAY}/../a.conf`,
      }),
    ).toMatch(/not under _throwaway/);
    expect(
      ref("se-03-worlds-create", MUT_API, {
        action: "createSandboxWorlds",
        target: `$${SANDBOX_NAME}:Worlds`,
      }),
    ).toMatch(/createSandboxWorlds target/);
    expect(
      ref("se-03-worlds-create", MUT_API, {
        action: "createSandboxWorlds",
        target: `$${SANDBOX_NAME}:${THROWAWAY}/SE/worlds`,
      }),
    ).toBeNull();
    expect(
      ref("se-13-u18-tile", MUT_API, {
        action: "terrainWriteThrowaway",
        target: `${THROWAWAY}/SE/terrain/t.ent`,
        mode: "tile",
        save: true,
      }),
    ).toMatch(/H2/);
    expect(
      ref("se-07-u8-AnimEditor", MUT_API, {
        action: "containerWriteTest",
        target: `${THROWAWAY}/SE/u16/a.agr`,
        moduleSave: true,
      }),
    ).toMatch(/moduleSave/);
  });

  it("the engine refuses at the call: a step that sends a write outside _throwaway/ stops and sends nothing", async () => {
    const steps = buildSteps();
    const s = { ...steps.find((x) => x.id === "se-05-u16-save")! };
    s.run = async (ctx) => {
      await ctx.call({
        apiFunc: MUT_API,
        params: { action: "saveContainer", source: "a.conf", target: "Configs/a.conf" },
        timeoutMs: 1000,
      });
      return { status: "observed", summary: "sent" };
    };
    const h = harness();
    const r = await runSession(
      options({ only: "se-05-u16-save" }),
      h.deps,
      steps.map((x) => (x.id === s.id ? s : x)),
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/not under _throwaway/);
    expect(h.netCalls.some((c) => c.params.action === "saveContainer")).toBe(false);
  });

  it("launch 3 needs both flags; without them its steps record the Q3 skip and run no gate", async () => {
    const lines: string[] = [];
    const errs: string[] = [];
    const saved = console.error;
    console.error = (m: string) => errs.push(String(m));
    try {
      const code = await main(
        ["--really", "--id", "x", "--u15-launch3", "--only", "se-31-u15-host-ping"],
        { out: (l) => lines.push(l), platform: "win32", artifactsRoot: TMP },
      );
      expect(code).toBe(EXIT.usage);
      expect(errs.join(" ")).toMatch(/--owner-go-u15-launch3/);
    } finally {
      console.error = saved;
    }
    const h = harness();
    const r = await runSession(
      options({ from: "se-30-u15-gate", until: "se-31-u15-host-ping", runDir: "x" }),
      h.deps,
    );
    expect(statuses(r)["se-30-u15-gate"]).toBe("skipped");
    expect(statuses(r)["se-00-gate"]).toBe("not-run");
    expect(r.steps.find((s) => s.id === "se-31-u15-host-ping")!.summary).toContain(SKIP_REASON.q3);
    expect(h.netCalls.length).toBe(0);
  });

  it("offline mode refuses while a Workbench runs, and runs se-19 without a gate otherwise", async () => {
    const busy = harness({ workbenchRunning: true });
    const r1 = await runSession(options({ only: OFFLINE_STEP, offline: true }), busy.deps);
    expect(r1.exit).toBe(EXIT.refused);
    expect(r1.stop?.reason).toMatch(/Workbench image runs/);
    const idle = harness();
    const r2 = await runSession(options({ only: OFFLINE_STEP, offline: true }), idle.deps);
    expect(statuses(r2)[OFFLINE_STEP]).toBe("pass");
    expect(idle.netCalls.length).toBe(0);
    const r3 = await runSession(options({ only: OFFLINE_STEP }), harness().deps);
    expect(r3.stop?.reason).toMatch(/only with --offline/);
  });
});

// ── The sitting against mocks ────────────────────────────────────────────────

describe("the sitting against mocks", () => {
  it("launch 1 runs the gate and the blocks; Q1 skips se-12 to se-15 with its reason; one call at a time", async () => {
    const h = harness();
    const st: Record<string, string> = {};
    let n = 0;
    for (const b of BLOCKS.filter((x) => buildSteps().find((s) => s.id === x.from)!.launch === 1)) {
      const r = await runSession(
        options({ from: b.from, until: b.until, nonce: `aaa${String(n++).padStart(3, "0")}` }),
        h.deps,
      );
      Object.assign(
        st,
        Object.fromEntries(
          r.steps.filter((s) => s.status !== "not-run").map((s) => [s.id, s.status]),
        ),
      );
      expect(r.exit, b.from).toBe(EXIT.done);
    }
    expect(st["se-03-worlds-create"]).toBe("pass");
    expect(st["se-04-u34-diag-set"]).toBe("observed");
    expect(st["se-08-world-open-tiny"]).toBe("pass");
    expect(st["se-09-u19-undo"]).toBe("observed");
    expect(st["se-11-u17-layer-create"]).toBe("pass");
    for (const id of [
      "se-12-world-open-terrain",
      "se-13-u18-tile",
      "se-14-u18-modify",
      "se-15-u10-run",
    ])
      expect(st[id], id).toBe("skipped");
    expect(
      (h.artifacts.get("se-12-world-open-terrain.json") as { summary: string }).summary,
    ).toContain("Q1 held by the owner");
    expect(st["se-16-u14-reload-broken"]).toBe("observed");
    expect(h.files.has(join(rel(U14_FOLDER_REL), U14_FILE))).toBe(false);
    expect(h.maxConcurrent).toBe(1);
    expect(h.netCalls.some((c) => JSON.stringify(c.params).includes("ParticleEditor"))).toBe(false);
    expect((h.artifacts.get("se-07-u8-AnimEditor.json") as { summary: string }).summary).toMatch(
      /U8 write no/,
    );
  });

  it("the gate stops on a mutating pack that refuses (B1) or did not compile", async () => {
    for (const sc of [{ mutRefused: true }, { mutMissing: true }]) {
      const r = await runSession(
        options({ only: "se-05-u16-save", runDir: "x" }),
        harness(sc).deps,
      );
      expect(r.exit).toBe(EXIT.stopped);
      expect(r.stop?.step).toBe("se-00-gate");
    }
  });

  it("se-03 skips when the tiny world is there (no gate, no call)", async () => {
    const h = harness();
    h.files.set(rel(TINY_WORLD), Buffer.from("w"));
    const r = await runSession(options({ only: "se-03-worlds-create" }), h.deps);
    expect(statuses(r)["se-03-worlds-create"]).toBe("skipped");
  });

  it("se-04 stops when the restore read differs from the value before", async () => {
    const r = await runSession(
      options({ only: "se-04-u34-diag-set" }),
      harness({ diagRestoreFails: true }).deps,
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/not restored/);
  });

  it("se-16: a dialog after the reload is a handoff (Q6)", async () => {
    const r = await runSession(
      options({ only: "se-16-u14-reload-broken" }),
      harness({ dialogOn: "se-16-reload" }).deps,
    );
    expect(r.exit).toBe(EXIT.handoff);
  });

  it("a dialog during another detached call is a stop", async () => {
    const h = harness({ dialogOn: "se-05" });
    const r = await runSession(options({ only: "se-05-u16-save" }), h.deps);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/queue is blocked/);
  });
});

// ── Review round 2 ───────────────────────────────────────────────────────────

describe("review round 2", () => {
  const steps = buildSteps();
  const planOf = (id: string): PlanAction[] =>
    steps
      .find((s) => s.id === id)!
      .plan(planInput({ sandboxDir: SANDBOX, policy: engineDiag, nonce: "abc123" }));
  const engineDiag = {
    ...repoPolicy,
    probe_mut: { plugin_run_allow_list: [], diag_set_allow_list: [{ key: "engine:42" }] },
  } as CensusPolicy;

  it("ro-pack F1: an engine diagRead sends engine:true", () => {
    const reads = planOf("se-04-u34-diag-set").filter(
      (a) => (a.params as Record<string, unknown>).action === "diagRead",
    );
    for (const a of reads) expect(a.params).toMatchObject({ engine: true, diagId: 42 });
  });

  it("mut-plugin-diag-worlds F1: a refused diagSet stops after the restore", async () => {
    const r = await runSession(
      options({ only: "se-04-u34-diag-set" }),
      harness({ diagSetRefused: true }).deps,
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/diagSet did not take/);
  });

  it("shipped-world F2: entity state is tri-state", () => {
    expect(entityState(ok({ status: "ok" }))).toBe("present");
    expect(entityState(ok({ status: "error", message: "Entity not found with name: x" }))).toBe(
      "absent",
    );
    expect(entityState(ok({ status: "error", message: "WorldEditorAPI not available" }))).toBe(
      "unknown",
    );
    expect(entityState({ ...ok(), ok: false, error: "x" })).toBe("unknown");
  });

  it("shipped-world F3: an undo that answers error does not answer U19", async () => {
    const h = harness({ undoFails: true });
    const r = await runSession(
      options({ only: "se-09-u19-undo" }),
      h.deps,
      steps.map((s) => (s.id === "se-09-u19-undo" ? { ...s, skip: undefined } : s)),
    );
    expect(statuses(r)["se-09-u19-undo"]).toBe("fail");
    expect(r.steps.find((s) => s.id === "se-09-u19-undo")!.summary).toMatch(/undo not executed/);
  });

  it("shipped-world F4: a create that kept its auto-name removes that entity", async () => {
    const h = harness({ renameFails: true });
    const r = await runSession(
      options({ only: "se-09-u19-undo" }),
      h.deps,
      steps.map((s) => (s.id === "se-09-u19-undo" ? { ...s, skip: undefined } : s)),
    );
    expect(statuses(r)["se-09-u19-undo"]).toBe("fail");
    expect(
      h.netCalls.some((c) => c.apiFunc === "EMCP_WB_DeleteEntity" && c.params.name === "Entity_7"),
    ).toBe(true);
    expect(h.netCalls.some((c) => c.apiFunc === "EMCP_WB_EditorControl")).toBe(false);
    expect(strayName(ok({ entityName: "A" }), "A")).toBeNull();
  });

  it("shipped-world F2: removeEntity stops when the state after the delete is unknown", async () => {
    const h = harness({ getEntityUnknown: true });
    const r = await runSession(
      options({ only: "se-09-u19-undo" }),
      h.deps,
      steps.map((s) => (s.id === "se-09-u19-undo" ? { ...s, skip: undefined } : s)),
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/unconfirmed/);
  });

  it("shipped-world F1, F5, mut-plugin-diag-worlds F2, F3, mut-world F1 to F4: the terrain plan sends strings and checks first", () => {
    const p = planInput({
      sandboxDir: SANDBOX,
      policy: repoPolicy,
      nonce: "abc123",
      terrainWorld: "_throwaway/SE/terrain/T.ent",
    });
    for (const id of ["se-13-u18-tile", "se-14-u18-modify", "se-15-u10-run"]) {
      const plan = steps.find((s) => s.id === id)!.plan(p);
      const firstWrite = plan.findIndex((a) =>
        ["terrainWriteThrowaway", "pluginRunDialogFree"].includes(
          String((a.params as Record<string, unknown> | undefined)?.action),
        ),
      );
      const check = plan.findIndex(
        (a) => (a.params as Record<string, unknown> | undefined)?.action === "layerRead",
      );
      expect(check, id).toBeGreaterThanOrEqual(0);
      expect(check, id).toBeLessThan(firstWrite);
    }
    const src = readFileSync(join(REPO_ROOT, "scripts", "live", "s-e-train1b.ts"), "utf-8");
    expect(src).toMatch(/getHeight", x: String\(x\), z: String\(z\)/);
    expect(src).toMatch(/x: xs, z: zs/);
    expect(src).toMatch(/field\(st\.response, "mode"\) !== "edit"/);
    expect(src).toMatch(/S\(field\(r\.response, "message"\)\) === "Run\(\) returned"/);
    expect(src).toMatch(/terrain-centre\.json \(se-12's centre\) is absent/);
    expect(src).toMatch(/f\.began !== "true"/);
  });

  it("ro-pack F2, mut-containers F2 to F4: se-07 sends nothing when the module did not open, and never an empty varName", async () => {
    const h = harness({ moduleNotOpened: true });
    const r = await runSession(options({ only: "se-07-u8-AnimEditor" }), h.deps);
    expect(r.steps.find((s) => s.id === "se-07-u8-AnimEditor")!.summary).toMatch(
      /INCONCLUSIVE: AnimEditor did not open/,
    );
    expect(h.netCalls.some((c) => c.params.action === "containerWriteTest")).toBe(false);
    const h2 = harness();
    const r2 = await runSession(options({ only: "se-07-u8-AnimEditor" }), h2.deps);
    expect(r2.steps.find((s) => s.id === "se-07-u8-AnimEditor")!.summary).toMatch(
      /INCONCLUSIVE: .*is not on disk/,
    );
    expect(h2.netCalls.some((c) => c.params.action === "containerWriteTest")).toBe(false);
    expect(
      moduleOpened({ columns: ["module", "present"], cells: ["AnimEditor", "true"] }, "AnimEditor"),
    ).toBe(true);
    expect(firstScalar("C {\n X {\n  deep 1\n }\n top 2\n}")).toMatchObject({
      varName: "top",
      topLevel: true,
    });
    expect(
      sendRefusal(
        "se-07-u8-AnimEditor",
        MUT_API,
        { action: "containerWriteTest", target: "_throwaway/a.agr" },
        repoPolicy,
        null,
      ),
    ).toBeNull();
  });

  it("mut-containers F1: a save error with no file is INCONCLUSIVE", async () => {
    const r = await runSession(
      options({ only: "se-06-u11-resave" }),
      harness({ saveErrorNoFile: true }).deps,
    );
    expect(r.steps.find((s) => s.id === "se-06-u11-resave")!.summary).toMatch(/INCONCLUSIVE/);
  });

  it("ro-pack F3: the world path match strips a GUID prefix and accepts the project-relative form", () => {
    const one = { subScenes: "1" };
    expect(
      isThrowawayWorld({ ...one, worldPath: `{0123456789ABCDEF}${TINY_WORLD}` }, TINY_WORLD),
    ).toBe(true);
    expect(isThrowawayWorld({ ...one, worldPath: TINY_WORLD }, TINY_WORLD)).toBe(true);
    expect(
      isThrowawayWorld({ ...one, worldPath: `$EMCP2_sandbox:${TINY_WORLD}` }, TINY_WORLD),
    ).toBe(true);
    expect(isThrowawayWorld({ ...one, worldPath: "Worlds/ECEN_SE_Tiny.ent" }, TINY_WORLD)).toBe(
      false,
    );
  });

  it("shipped-misc F1, ro-pack F4: se-21 reads the payload; se-30 reads the info table", () => {
    expect(
      resourceLine({
        resourceInfo: { ok: true, response: { status: "Error", resourceName: "" } },
        prefabGuid: { ok: true, response: { status: "ok", guid: "{A}" } },
      }),
    ).toMatch(/info status "Error"/);
    expect(
      infoAddonIds({
        columns: ["guid", "id", "title", "vanilla"],
        cells: ["g", "ECEN_HostAddon", "t", "false"],
      }),
    ).toEqual(["ECEN_HostAddon"]);
  });
});

// ── Review round 2, per handler ─────────────────────────────────────────────

describe("review round 2, per handler", () => {
  const steps = buildSteps();
  const unskipped = (id: string): StepDef[] =>
    steps.map((s) => (s.id === id ? { ...s, skip: undefined, preSkip: undefined } : s));
  const TERRAIN = "_throwaway/SE/terrain/ECEN_T.ent";
  const summary = (r: Awaited<ReturnType<typeof runSession>>, id: string): string =>
    r.steps.find((s) => s.id === id)!.summary;

  it("mut-plugin-diag-worlds F1, F6: se-03 passes only when both .ent are new; the folder state is recorded", async () => {
    const h = harness({ onlyTinyCreated: true });
    const r = await runSession(options({ only: "se-03-worlds-create" }), h.deps);
    expect(statuses(r)["se-03-worlds-create"]).toBe("fail");
    const h2 = harness();
    const r2 = await runSession(options({ only: "se-03-worlds-create" }), h2.deps);
    expect(statuses(r2)["se-03-worlds-create"]).toBe("pass");
    expect(
      (
        h2.artifacts.get("se-03-worlds-create.json") as {
          data: { worldsFolderExistedBefore: boolean };
        }
      ).data.worldsFolderExistedBefore,
    ).toBe(false);
  });

  it("mut-plugin-diag-worlds F2, F5: se-04 sets the other value when the option already holds 1; the plan sends numbers", async () => {
    const h = harness({ diagStart: 1 });
    const r = await runSession(options({ only: "se-04-u34-diag-set" }), h.deps);
    expect(statuses(r)["se-04-u34-diag-set"]).toBe("observed");
    expect(
      h.netCalls.filter((c) => c.params.action === "diagSet").map((c) => c.params.diagValue),
    ).toEqual([0, 1]);
    const plan = steps
      .find((s) => s.id === "se-04-u34-diag-set")!
      .plan(planInput({ sandboxDir: SANDBOX, policy: repoPolicy, nonce: "abc123" }));
    for (const a of plan.filter((x) => (x.params as Record<string, unknown>).action === "diagSet"))
      expect(typeof (a.params as Record<string, unknown>).diagValue).toBe("number");
  });

  it("mut-containers R2-2: se-05 records status and message, INCONCLUSIVE on an error with no file", async () => {
    const r = await runSession(
      options({ only: "se-05-u16-save" }),
      harness({ saveErrorNoFile: true }).deps,
    );
    expect(summary(r, "se-05-u16-save")).toMatch(
      /INCONCLUSIVE: saveContainer error "LoadContainer returned null"/,
    );
  });

  it("mut-containers R2-1: the boolean parse failure is a bad variable pick", () => {
    const src = readFileSync(join(REPO_ROOT, "scripts", "live", "s-e-train1b.ts"), "utf-8");
    expect(src).toMatch(
      /must be true or false\|writes scalar, integer, boolean\|; nothing saved\$/,
    );
  });

  it("shipped-world R2-3, R2-4; mut-world R2-3: entity count, the read-back status, a layer error", async () => {
    const src = readFileSync(join(REPO_ROOT, "scripts", "live", "s-e-train1b.ts"), "utf-8");
    expect(src).toMatch(/field\(st\.response, "entityCount"\) === 0/);
    expect(src).toMatch(/read-back errored/);
    const r = await runSession(
      options({ only: "se-11-u17-layer-create" }),
      harness({ layerError: true }).deps,
      unskipped("se-11-u17-layer-create"),
    );
    expect(statuses(r)["se-11-u17-layer-create"]).toBe("fail");
    expect(summary(r, "se-11-u17-layer-create")).toMatch(/name must be an identifier/);
  });

  it("ro-pack R2-4: se-12 sends no getHeight without bounds", async () => {
    const h = harness({ noBounds: true, worldPath: TERRAIN });
    h.files.set(rel(TERRAIN), Buffer.from("SubScene"));
    const r = await runSession(options({ only: "se-12-world-open-terrain" }), h.deps);
    expect(statuses(r)["se-12-world-open-terrain"]).toBe("fail");
    expect(h.netCalls.some((c) => c.apiFunc === "EMCP_WB_Terrain")).toBe(false);
    expect(h.artifacts.has("terrain-centre.json")).toBe(false);
  });

  it("mut-world R2-1: se-13 compares the heights with a tolerance", async () => {
    for (const [delta, want] of [
      [1.0000001, "observed"],
      [0.5, "fail"],
    ] as const) {
      const h = harness({ worldPath: TERRAIN, tileAfterDelta: delta });
      h.files.set(rel(TERRAIN), Buffer.from("SubScene"));
      const r = await runSession(
        options({ only: "se-13-u18-tile" }),
        h.deps,
        unskipped("se-13-u18-tile"),
      );
      expect(statuses(r)["se-13-u18-tile"], String(delta)).toBe(want);
    }
  });

  it("shipped-world R2-1, R2-2: se-14's verdict comes from the three heights", () => {
    expect(undoVerdict(10, 11, 10.001, true, "").verdict).toMatch(/restored/);
    expect(undoVerdict(10, 11, 11, true, "").verdict).toMatch(/undo ran, height unchanged/);
    expect(undoVerdict(10, null, 10, true, "").status).toBe("fail");
    expect(undoVerdict(10, 11, 10, false, "nothing to undo").verdict).toMatch(/undo not executed/);
    expect(HEIGHT_EPS).toBe(0.01);
    const plan = steps
      .find((s) => s.id === "se-14-u18-modify")!
      .plan(
        planInput({
          sandboxDir: SANDBOX,
          policy: repoPolicy,
          nonce: "abc123",
          terrainWorld: TERRAIN,
        }),
      );
    const iH0 = plan.findIndex((a) => a.target === "EMCP_WB_Terrain");
    const iW = plan.findIndex(
      (a) => (a.params as Record<string, unknown> | undefined)?.action === "terrainWriteThrowaway",
    );
    expect(iH0).toBeLessThan(iW);
  });

  it("ro-pack R2-1: se-23 reads persistence only from the tiny world's layerRead", async () => {
    const r = await runSession(
      options({ only: "se-23-world-reopen-tiny", runDir: "x" }),
      harness({ worldExisted: true, worldPath: "<sandbox>/Worlds/Other.ent" }).deps,
    );
    expect(statuses(r)["se-23-world-reopen-tiny"]).toBe("fail");
    expect(summary(r, "se-23-world-reopen-tiny")).toMatch(/INCONCLUSIVE: not the tiny world/);
  });

  it("shipped-misc R2-1: se-30 says unknown when GetLoadedProjects failed", async () => {
    const r = await runSession(
      options({ from: "se-30-u15-gate", until: "se-31-u15-host-ping", u15Launch3: true }),
      harness({ lpFails: true }).deps,
    );
    expect(summary(r, "se-30-u15-gate")).toMatch(/unknown by GetLoadedProjects \(failed/);
  });

  it("shipped-misc R2-2, R2-3: se-20 stops without a pid; se-16 records the reload status", () => {
    const src = readFileSync(join(REPO_ROOT, "scripts", "live", "s-e-train1b.ts"), "utf-8");
    expect(src).toMatch(/the gate recorded no Workbench pid/);
    expect(src).toMatch(/reload with the broken file \$\{ans\(r1\)\} \(status/);
  });
});

// ── Plants, rollback, helpers ────────────────────────────────────────────────

describe("plants and helpers", () => {
  it("the plant edits apply to vanilla-shaped text", () => {
    expect(swapFirstScalars("C {\n a 1\n b 2\n}\n")).toBe("C {\n b 2\n a 1\n}\n");
    expect(requote('C {\n n "Ident"\n}\n')).toBe("C {\n n Ident\n}\n");
    expect(dropLine("E {\n Version 2\n a 1\n}\n", /^\s*Version\s/)).toBe("E {\n a 1\n}\n");
    expect(editFirstNode(" EditorPos 616.9 346.1\n")).toBe(" EditorPos 626.9 346.1\n");
    expect(stripCompiled("X {\n a 1\n compiled C {\n  version 2\n }\n}\n")).toBe("X {\n a 1\n}\n");
    expect(U11_PLANTS.length).toBe(7);
    expect(metaText(`${THROWAWAY}/SE/u25/a.conf`, "0123456789ABCDEF")).toContain(
      'Name "{0123456789ABCDEF}_throwaway/SE/u25/a.conf"',
    );
    expect(rewriteMetaName(' Name "{0123456789ABCDEF}a/b.conf"\n', "a/b.conf", "a/c/b.conf")).toBe(
      ' Name "{0123456789ABCDEF}a/c/b.conf"\n',
    );
    expect(firstScalar("X {\n Volume -9\n}")).toMatchObject({
      varName: "Volume",
      value: "-9",
      next: "-8",
    });
  });

  it("rollback removes _throwaway/ only when it was absent before, after keeping its listing", () => {
    const run = new Map<string, string>([
      ["plant-offline.json", JSON.stringify({ throwawayExistedBefore: false })],
    ]);
    const removed: string[] = [];
    const io: OfflineIo = {
      workbenchPids: () => [],
      fileExists: () => false,
      readBytes: () => Buffer.from("x"),
      writeFile: () => {},
      removeFile: () => {},
      removeEmptyDir: () => {},
      listTree: () => ["SE/u16/a.conf"],
      removeThrowaway: (p) => removed.push(p),
      readRunFile: (n) => run.get(n) ?? null,
      writeRunFile: (n, d) => {
        run.set(n, d);
      },
      log: () => {},
    };
    const cfg = {
      runDir: "run",
      sandboxDir: SANDBOX,
      gate: null,
      really: true,
      removeThrowaway: true,
    };
    expect(runRollback(cfg, io)).toBe(0);
    expect(removed.length).toBe(1);
    expect(run.has("throwaway-listing.json")).toBe(true);
    run.set("plant-offline.json", JSON.stringify({ throwawayExistedBefore: true }));
    run.delete("throwaway-listing.json");
    expect(runRollback(cfg, io)).toBe(1);
    expect(removed.length).toBe(1);
  });

  it("the runbook names every step, the pending rulings and the set-back checklist", () => {
    const md = readFileSync(join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-E.md"), "utf-8");
    for (const s of buildSteps()) expect(md, s.id).toContain(s.id);
    for (const n of NOT_ANSWERED.filter((x) => x.part === "all"))
      expect(md, n.id).toContain(n.id.replace(/^P-E01-/, ""));
    for (const w of [
      "Q1",
      "Q3",
      "--offline",
      "--u15-launch3",
      "--owner-go-u15-launch3",
      "--remove-probe",
      "set back to normal",
    ])
      expect(md, w).toContain(w);
  });
});
