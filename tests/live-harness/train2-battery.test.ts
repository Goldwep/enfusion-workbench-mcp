import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import type { RawCallResult, WindowInfo } from "../../scripts/live/s-c-natives.js";
import type { UiaNode } from "../../src/gui/uia.js";
import {
  DEFAULT_QUEUE,
  EXIT,
  HANDLER_COUNT,
  MAX_RELAUNCHES,
  NEVER_FLAG,
  PLANT_CONF,
  SCRIPT_PATH,
  TINY_WORLD,
  TOGGLE_PATH,
  WORLDS_DIR,
  WORLD_EDITOR_WINDOWS,
  baselineRefusal,
  liveStepRefusal,
  sittingLayout,
  buildActionPlan,
  buildQueue,
  buildSteps,
  compareTrees,
  compareTreesLoose,
  compileErrors,
  countLaunch,
  gateVerdictFile,
  lineDiff,
  main,
  runBattery,
  runRestore,
  runRollback,
  selectSteps,
  windowVerdict,
  type OfflineIo,
  type ToolName,
  type ToolResponse,
  type Train2Deps,
  type Train2Options,
} from "../live/train2.live.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-p33-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 4242;
const SE_DEBUG =
  "Script Editor - Debugging: ArmaReforgerWorkbenchSteamDiag.exe on port: 1000 - Configuration: WORKBENCH";
// Nested like the real conf: the fake describe rows name the dotted path Root.Volume, and the CST
// resolves the same path (the battery sets and reads the CST by that path).
const CONF = ["BaseClass {", " Root RootClass {", "  Volume 3", " }", ' Name "x"', "}", ""].join(
  "\n",
);

function ok(response?: unknown): RawCallResult {
  return {
    ok: true,
    response,
    timedOut: false,
    durationMs: 5,
    bytesSent: 10,
    bytesReceived: 10,
    wire: { status: "Ok", payload: "present" },
  } as RawCallResult;
}
const pack = (facts: Record<string, string>, status = "ok"): unknown => ({
  status,
  factKeys: Object.keys(facts),
  factValues: Object.values(facts),
  pageCount: 1,
});
const win = (title: string, hwnd: number, cls = "Qt683QWindowIcon", owner = 0): WindowInfo =>
  ({
    hwnd,
    pid: PID,
    className: cls,
    title,
    owner,
    enabled: true,
    rect: [],
    monitor: [],
    primary: true,
  }) as WindowInfo;
const node = (controlType: string, name: string, children: UiaNode[] = []): UiaNode => ({
  controlType,
  name,
  automationId: "",
  className: "",
  rect: null,
  enabled: true,
  offscreen: false,
  patterns: [],
  children,
});

function listTree(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

interface Fake {
  deps: Train2Deps;
  opts: Train2Options;
  windows: WindowInfo[];
  toolCalls: Array<{ name: ToolName; args: Record<string, unknown> }>;
  netCalls: string[];
  /** Hooks: return a response to override the default, push windows, etc. */
  onTool?: (name: ToolName, args: Record<string, unknown>) => ToolResponse | undefined;
  onNet?: (apiFunc: string, params: Record<string, unknown>) => RawCallResult | undefined;
  compiled: boolean;
  pid: number;
  loaded: boolean;
}

let seq = 0;
function fake(label: string, sittingDir?: string): Fake {
  const root = join(TMP, `${label}-${seq++}`);
  const sandboxDir = join(root, "addons", SANDBOX_NAME);
  mkdirSync(sandboxDir, { recursive: true });
  const sitting = sittingDir ?? join(root, "sitting");
  const runDir = join(sitting, `run-${seq}`);
  mkdirSync(runDir, { recursive: true });
  const tree = node("Window", "World Editor", [node("MenuBar", "", [node("MenuItem", "File")])]);
  const f: Fake = {
    windows: [win("Arma Reforger Workbench", 1)],
    toolCalls: [],
    netCalls: [],
    compiled: true,
    pid: PID,
    loaded: false,
    opts: {
      runDir,
      sittingDir: sitting,
      sandboxDir,
      evidenceDir: null,
      ph: {},
      build: "test",
    },
    deps: undefined as unknown as Train2Deps,
  };
  const resp = (readback: unknown): ToolResponse => ({ ok: true, readback, warnings: [] });
  f.deps = {
    tool: async (name, args) => {
      f.toolCalls.push({ name, args });
      const o = f.onTool?.(name, args);
      if (o) return o;
      const a = String(args.action);
      if (name === "wb_module" && a === "info" && args.module === "ParticleEditor")
        return { ok: false, code: "MODULE_NOT_SUPPORTED" };
      if (name === "wb_module" && a === "open" && args.module === "ScriptEditor")
        f.windows.push(win(SE_DEBUG, 50));
      if (name === "wb_module" && a === "setResource") f.loaded = true;
      if (name === "wb_module" && a === "save") {
        if (!args.confirm)
          return resp({ dryRun: true, worldPathForm: f.loaded ? "project" : "none" });
        return f.loaded
          ? resp({ saved: true })
          : { ok: false, code: "NOT_IN_PROJECT", changed: null };
      }
      if (name === "wb_container" && a === "describe")
        return resp(
          args.mode === "page"
            ? {
                rows: [
                  {
                    path: "Root.Volume",
                    name: "Volume",
                    type: "int",
                    value: (() => {
                      const t = String(args.target);
                      const file = t.startsWith("path:")
                        ? join(f.opts.sandboxDir, ...t.slice(5).split("/"))
                        : null;
                      const text =
                        file && existsSync(file) ? readFileSync(file, "utf-8") : " Volume 3";
                      return /^\s*Volume\s+(\S+)/m.exec(text)?.[1] ?? "3";
                    })(),
                  },
                ],
              }
            : { set: 1 },
        );
      if (name === "wb_container" && (a === "get" || a === "set" || a === "save"))
        if (args.path === "Volume")
          return { ok: false, code: "PATH_NOT_FOUND", message: "bare name" };
      if (name === "wb_container" && a === "get") {
        const file = String(args.target).startsWith("path:")
          ? join(f.opts.sandboxDir, ...String(args.target).slice(5).split("/"))
          : null;
        const text = file && existsSync(file) ? readFileSync(file, "utf-8") : " Volume 3";
        const m = new RegExp(`^\\s*${String(args.path).split(".").pop()}\\s+(\\S+)`, "m").exec(
          text,
        );
        return resp({ value: m ? m[1] : "3" });
      }
      if (name === "wb_container" && a === "set" && args.confirm) {
        const file = join(f.opts.sandboxDir, ...String(args.target).slice(5).split("/"));
        const text = readFileSync(file, "utf-8").replace(
          /^(\s*Volume\s+)\S+/m,
          `$1${String(args.value)}`,
        );
        writeFileSync(file, text);
        return resp({ saved: true });
      }
      if (name === "wb_gui" && a === "find") return resp({ total: 1, hits: [] });
      if (name === "wb_gui") return resp({ tree });
      return resp({});
    },
    net: async (apiFunc, params) => {
      f.netCalls.push(`${apiFunc}${params.action ? `.${String(params.action)}` : ""}`);
      const o = f.onNet?.(apiFunc, params);
      if (o) return o;
      switch (apiFunc) {
        case "IsWorkbenchRunning":
          return ok({ ScriptsCompiled: f.compiled });
        case "EMCP_WB_Ping":
          return ok({ status: "ok", buildStamp: "digest1", mode: "edit" });
        case "EMCP_WB_Info":
          return ok({
            status: "ok",
            projectFound: true,
            projectName: SANDBOX_NAME,
            handlerCount: HANDLER_COUNT,
            handlers: Array.from({ length: HANDLER_COUNT }, (_, i) => `EMCP_WB_H${i}`).join(","),
            openModules: "",
            modules:
              "AnimEditor,AudioEditor,BehaviorEditor,LocalizationEditor,NavmeshGeneratorMain,ProcAnimEditor,ResourceManager,ScriptEditor,WorldEditor",
            unreadModules: "ParticleEditor",
          });
        case "IsWorldEditorRunning":
          return ok({ IsRunning: f.windows.some((w) => w.title.startsWith("World Editor")) });
        case "ECEN_ProbeMut": {
          const dir = join(f.opts.sandboxDir, ...WORLDS_DIR.split("/"));
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "EMCP_P33_Tiny.ent"), "w");
          writeFileSync(join(dir, "EMCP_P33_Flat.ent"), "w");
          return ok(
            pack({
              tinyRegistered: "true",
              terrainRegistered: "true",
              tinyResourceName: `{0123456789ABCDEF}${TINY_WORLD}`,
              terrainResourceName: `{0123456789ABCDEE}${WORLDS_DIR}/EMCP_P33_Flat.ent`,
            }),
          );
        }
        case "EMCP_WB_EditorControl":
          f.windows.push(win("World Editor - EMCP_P33_Tiny", 60));
          return ok({ status: "ok", message: `Opened resource: ${TINY_WORLD}` });
        case "ECEN_Probe":
          if (params.action === "layerRead")
            return ok(pack({ worldPath: `$${SANDBOX_NAME}:${TINY_WORLD}`, subScenes: "1" }));
          if (params.action === "moduleMatrix")
            f.windows.push(win("World Editor - Unnamed empty world", 55));
          return ok(pack({}));
        default:
          return ok({});
      }
    },
    walk: async () => ({ ok: true, tree, summary: { nodes: 3 }, detail: "fake" }),
    windows: async () => f.windows.map((w) => ({ ...w, pid: f.pid })),
    bundleDigest: () => "digest1",
    recordedPid: () => f.pid,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    workbenchPids: () => [],
    sessionLog: () => "SCRIPT: compiling\n",
    install: () => ({
      shipped: Array.from({ length: 28 }, (_, i) => `EMCP_WB_F${i}.c`),
      probe: ["ECEN_Probe.c"],
      digest: "digest1",
      stamp: "digest1",
    }),
    lkgFiles: () => Array.from({ length: 21 }, (_, i) => ({ name: `EMCP_WB_F${i}.c`, blob: "b" })),
    readVanilla: () => Buffer.from(CONF, "utf-8"),
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    exists: (p) => existsSync(p),
    listTree,
    now: (() => {
      let t = 0;
      return () => (t += 10);
    })(),
    sleep: () => new Promise((r) => setImmediate(r)),
    log: () => undefined,
  };
  return f;
}

const steps = buildSteps();
const phase = (p: "offline-0" | 1 | 2) => steps.filter((s) => s.phase === p);
const statusOf = (dir: string, id: string): string =>
  (JSON.parse(readFileSync(join(dir, `${id}.json`), "utf-8")) as { status: string }).status;

async function runPhases(f: Fake): Promise<void> {
  expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
  expect((await runBattery(phase(1), f.deps, f.opts)).exit).toBe(EXIT.done);
}

describe("P3-3 step table and plan", () => {
  it("has the gates in order: offline install and plant, gate 1, gate 2", () => {
    expect(steps.map((s) => s.id)).toEqual([
      "p33-o1-install",
      "p33-o2-plant",
      "p33-g1-00-gate",
      "p33-g1-01-compile",
      "p33-g1-02-build-stamp",
      "p33-g1-03-info",
      "p33-g1-05-container-path",
      "p33-g1-04-module-reads",
      "p33-g1-06-script-editor",
      "p33-g1-07-verdict",
      "p33-g2-00-gate",
      "p33-g2-01-ready",
      "p33-g2-02-bi-reads",
      "p33-g2-03-plugin-reads",
      "p33-g2-04-gui-tree",
      "p33-g2-05-module-action",
      "p33-g2-06-save-not-sandbox",
      "p33-g2-07-worlds-create",
      "p33-g2-08-world-open",
      "p33-g2-09-container-world",
      "p33-g2-10-set-resource-save",
      "p33-g2-11-container-write",
      "p33-g2-12-cst-accept",
      "p33-g2-13-verdict",
    ]);
    for (const s of steps) expect(s.proves.length).toBeGreaterThan(0);
  });

  it("the dry run accepts the plan: two launches, no -scriptAuthorizeAll, the toggle allow-listed", () => {
    const plan = buildActionPlan();
    const r = checkPlan(plan, policy, { script: SCRIPT_PATH });
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
    const launches = plan.filter((a) => a.kind === "launch");
    expect(launches).toHaveLength(2);
    expect(JSON.stringify(plan)).not.toContain(NEVER_FLAG);
    expect(plan.filter((a) => a.kind === "execute-action")).toHaveLength(2);
    expect(plan.filter((a) => a.kind === "uia-read")).toHaveLength(2);
    expect(JSON.stringify(plan)).not.toMatch(/ParticleEditor|MainMenuWorld/);
  });

  it("the dry run fails a plan with a toggle that is not allow-listed", () => {
    const plan = buildActionPlan().map((a) =>
      a.kind === "execute-action" ? { ...a, target: { path: ["File", "Exit"] } } : a,
    );
    expect(checkPlan(plan, policy, { script: SCRIPT_PATH }).ok).toBe(false);
    expect(TOGGLE_PATH).toEqual(["Window", "Hierarchy"]);
  });

  it("the queue file equals the table and pre-flight accepts it per launch", () => {
    // DEC-058: the recorded queue (docs/v2, frozen) predates the guard rename; read it with the
    // renamed guard words (isSandbox -> projectFound, NOT_SANDBOX -> NOT_IN_PROJECT, form "sandbox"
    // -> "project") and compare everything else as recorded.
    const recorded = readFileSync(DEFAULT_QUEUE, "utf-8")
      .replaceAll("EMCP_WB_Info info: isSandbox,", "EMCP_WB_Info info: projectFound,")
      .replaceAll("status ok, isSandbox true,", "status ok, projectFound true,")
      .replaceAll(
        "the form is not sandbox (NOT_SANDBOX)",
        "the form is not project (NOT_IN_PROJECT)",
      )
      .replaceAll("confirm refused NOT_SANDBOX,", "confirm refused NOT_IN_PROJECT,")
      .replaceAll(
        "(the guard refuses a non-sandbox world)",
        "(the guard refuses a world outside the open project, DEC-058)",
      );
    const onDisk = JSON.parse(recorded) as unknown;
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(buildQueue())));
    expect(() => validateQueue(buildQueue(), false)).not.toThrow();
  });

  it("main: dry run exits 0; -scriptAuthorizeAll in any spelling is refused", async () => {
    const out: string[] = [];
    expect(await main([], { out: (l) => out.push(l) })).toBe(EXIT.done);
    expect(out.at(-1)).toBe("PASS");
    expect(await main([NEVER_FLAG], { out: () => undefined })).toBe(EXIT.usage);
    expect(await main(["--script-authorize-all"], { out: () => undefined })).toBe(EXIT.usage);
  });

  it("selects one phase per invocation", () => {
    expect(typeof selectSteps(steps, { from: "p33-g1-07-verdict", until: "p33-g2-00-gate" })).toBe(
      "string",
    );
    expect(typeof selectSteps(steps, {})).toBe("string");
    expect(selectSteps(steps, { only: "p33-g2-04-gui-tree" })).toHaveLength(1);
    expect(selectSteps(steps, { from: "p33-g1-00-gate" })).toBe(
      "one invocation runs one phase (offline-0, gate 1 or gate 2): the gates are separate launches",
    );
    expect(selectSteps(steps, { from: "p33-g2-00-gate" })).toHaveLength(phase(2).length);
  });
});

describe("P3-3 runner against a fake client", () => {
  it("runs both gates; gate verdicts, plant and relaunch book are written", async () => {
    const f = fake("happy");
    await runPhases(f);
    const v1 = JSON.parse(readFileSync(join(f.opts.sittingDir, gateVerdictFile(1)), "utf-8"));
    expect(v1.passed).toBe(true);
    const f2 = fake("happy2", f.opts.sittingDir);
    f2.opts.sandboxDir = f.opts.sandboxDir;
    f2.pid = PID + 1;
    const r = await runBattery(phase(2), f2.deps, f2.opts);
    expect(r.message).toBeNull();
    expect(r.exit).toBe(EXIT.done);
    for (const s of phase(2)) {
      const st = statusOf(f2.opts.runDir, s.id);
      const why =
        st === "fail" ? readFileSync(join(f2.opts.runDir, `${s.id}.json`), "utf-8") : s.id;
      expect(["pass", "observed", "skipped"], why).toContain(st);
    }
    expect(
      JSON.parse(readFileSync(join(f.opts.sittingDir, gateVerdictFile(2)), "utf-8")).passed,
    ).toBe(true);
    const book = JSON.parse(readFileSync(join(f.opts.sittingDir, "relaunches.json"), "utf-8"));
    expect(book).toEqual({ gate1: [PID], gate2: [PID + 1] });
    // the container write landed on disk and was read back through the CST
    const rec = JSON.parse(
      readFileSync(join(f2.opts.runDir, "p33-g2-11-container-write.json"), "utf-8"),
    );
    expect(rec.evidence.onDisk).toBe("4");
    expect(readFileSync(join(f.opts.sandboxDir, ...PLANT_CONF.split("/")), "utf-8")).toContain(
      "Volume 4",
    );
    // the ParticleEditor never reached the wire: the tool refuses it, and no net call names it
    expect(f.netCalls.join(" ")).not.toContain("ParticleEditor");
    // the GUI compare was node for node
    const gui = JSON.parse(readFileSync(join(f2.opts.runDir, "p33-g2-04-gui-tree.json"), "utf-8"));
    expect(gui.evidence.compare.equal).toBe(true);
    expect(gui.evidence.menuBar).toBe(true);
  });

  it("gate 2 is refused unless gate 1 passed", async () => {
    const f = fake("nogate1");
    const r = await runBattery(phase(2), f.deps, f.opts);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe("p33-g2-00-gate");
    expect(existsSync(join(f.opts.runDir, "p33-g2-01-ready.json"))).toBe(false);
  });

  it("a compile failure is a handoff and nothing after it runs", async () => {
    const f = fake("compile");
    f.compiled = false;
    expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
    const r = await runBattery(phase(1), f.deps, f.opts);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stoppedAt).toBe("p33-g1-01-compile");
    expect(existsSync(join(f.opts.runDir, "p33-g1-02-build-stamp.json"))).toBe(false);
  });

  it("a new window in a step that expects none = stop and record", async () => {
    const f = fake("newwin");
    f.onNet = (api) => {
      if (api === "EMCP_WB_Info") f.windows.push(win("Something", 70));
      return undefined;
    };
    expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
    const r = await runBattery(phase(1), f.deps, f.opts);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe("p33-g1-03-info");
    const rec = JSON.parse(readFileSync(join(f.opts.runDir, "p33-g1-03-info.json"), "utf-8"));
    expect(rec.status).toBe("stopped");
    expect(rec.evidence.windowsAdded[0].title).toBe("Something");
    expect(existsSync(join(f.opts.runDir, "p33-g1-04-module-reads.json"))).toBe(false);
  });

  it("a dialog in a step that expects windows = handoff, nothing sent to it", async () => {
    const f = fake("dialog");
    f.onTool = (name, args) => {
      if (name === "wb_module" && args.action === "open")
        f.windows.push(win("Save", 80, "#32770", 1));
      return undefined;
    };
    expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
    const r = await runBattery(phase(1), f.deps, f.opts);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stoppedAt).toBe("p33-g1-06-script-editor");
  });

  it("the expected module windows are recorded, not stopped", async () => {
    const f = fake("expected");
    await runPhases(f);
    const f2 = fake("expected2", f.opts.sittingDir);
    f2.opts.sandboxDir = f.opts.sandboxDir;
    f2.pid = PID + 1;
    await runBattery(phase(2), f2.deps, f2.opts);
    const rec = JSON.parse(
      readFileSync(join(f2.opts.runDir, "p33-g2-03-plugin-reads.json"), "utf-8"),
    );
    expect(rec.status).toBe("pass");
    expect(rec.evidence.windowsAdded.map((w: { title: string }) => w.title)).toContain(
      "World Editor - Unnamed empty world",
    );
  });

  it("a GATED or UNPROVEN refusal is a record (observed), not a failure", async () => {
    const f = fake("gated");
    await runPhases(f);
    const f2 = fake("gated2", f.opts.sittingDir);
    f2.opts.sandboxDir = f.opts.sandboxDir;
    f2.pid = PID + 1;
    f2.onTool = (name, args) =>
      name === "wb_bi" && args.handler === "CheckGUID"
        ? { ok: false, code: "GATED", message: "gated" }
        : undefined;
    const r = await runBattery([phase(2)[0], phase(2)[1], phase(2)[2]], f2.deps, f2.opts);
    expect(r.exit).toBe(EXIT.done);
    expect(statusOf(f2.opts.runDir, "p33-g2-02-bi-reads")).toBe("observed");
  });

  it("the negative save sends confirm only after a dry run outside the project", async () => {
    const f = fake("neg");
    await runPhases(f);
    const f2 = fake("neg2", f.opts.sittingDir);
    f2.opts.sandboxDir = f.opts.sandboxDir;
    f2.pid = PID + 1;
    f2.onTool = (name, args) => {
      if (name === "wb_module" && args.action === "save" && args.confirm)
        return { ok: false, code: "NOT_IN_PROJECT", changed: null };
      if (name === "wb_module" && args.action === "save")
        return { ok: true, readback: { dryRun: true, worldPathForm: "project" } };
      return undefined;
    };
    const sel = phase(2).filter(
      (s) => s.id === "p33-g2-00-gate" || s.id === "p33-g2-06-save-not-sandbox",
    );
    await runBattery(sel, f2.deps, f2.opts);
    expect(statusOf(f2.opts.runDir, "p33-g2-06-save-not-sandbox")).toBe("observed");
    expect(f2.toolCalls.filter((c) => c.args.confirm === true)).toHaveLength(0);
  });

  it("a step cut by the window poller sends nothing more and its record says cut (TRAIN2-01)", async () => {
    const f = fake("cut");
    expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
    const slow = f.deps.tool;
    f.deps.tool = async (name, args) => {
      const r = await slow(name, args);
      await new Promise((res) => setTimeout(res, 30));
      return r;
    };
    f.onTool = (name, args) => {
      if (name === "wb_module" && args.action === "open")
        f.windows.push(win("Save", 80, "#32770", 1));
      return undefined;
    };
    const r = await runBattery(phase(1), f.deps, f.opts);
    expect(r.exit).toBe(EXIT.handoff);
    await new Promise((res) => setTimeout(res, 150));
    const openAt = f.toolCalls.findIndex((c) => c.args.action === "open");
    const after = f.toolCalls.slice(openAt + 1);
    expect(after).toHaveLength(0);
    const rec = JSON.parse(
      readFileSync(join(f.opts.runDir, "p33-g1-06-script-editor.json"), "utf-8"),
    );
    expect(rec.evidence.cut).toBe(true);
  });

  it("a dialog already up refuses the step before anything is sent (TRAIN2-03)", async () => {
    const f = fake("baseline");
    expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
    f.windows.push(win("Script Authorization Required", 90, "Qt683QWindowIcon", 1));
    const r = await runBattery(phase(1), f.deps, f.opts);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stoppedAt).toBe("p33-g1-00-gate");
    expect(f.netCalls).toHaveLength(0);
    expect(baselineRefusal([win("ok", 1)], PID)).toBeNull();
  });

  it("a live step outside a counted launch is refused (TRAIN2-05)", async () => {
    const f = fake("uncounted");
    expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
    const r = await runBattery([phase(1)[1]], f.deps, f.opts);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/not gate 1's counted launch/);
    expect(f.netCalls).toHaveLength(0);
    expect(liveStepRefusal(f.opts, 2, PID, f.deps)).toMatch(/counted launch/);
  });

  it("g2-11 dry-runs set and save before any confirm (TRAIN2-09)", async () => {
    const f = fake("dryfirst");
    await runPhases(f);
    const f2 = fake("dryfirst2", f.opts.sittingDir);
    f2.opts.sandboxDir = f.opts.sandboxDir;
    f2.pid = PID + 1;
    await runBattery(phase(2), f2.deps, f2.opts);
    const c = f2.toolCalls.filter(
      (x) => x.name === "wb_container" && x.args.action !== "get" && x.args.action !== "describe",
    );
    expect(c.map((x) => `${String(x.args.action)}:${x.args.confirm === true}`)).toEqual([
      "set:false",
      "save:false",
      "set:true",
      "save:true",
    ]);
  });

  it("a step is never run twice in a run folder", async () => {
    const f = fake("twice");
    expect((await runBattery(phase("offline-0"), f.deps, f.opts)).exit).toBe(EXIT.done);
    const r = await runBattery([phase("offline-0")[0]], f.deps, f.opts);
    expect(r.exit).toBe(EXIT.refused);
  });

  it("the offline steps refuse while a Workbench runs", async () => {
    const f = fake("offline-running");
    f.deps.workbenchPids = () => [99];
    const r = await runBattery(phase("offline-0"), f.deps, f.opts);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe("p33-o1-install");
  });
});

describe("P3-3 relaunch budget", () => {
  it("counts distinct pids per gate: a launch and three relaunches, the fifth refused", () => {
    const f = fake("budget");
    const d = f.deps;
    for (let i = 0; i <= MAX_RELAUNCHES; i++) {
      const c = countLaunch(f.opts.sittingDir, 1, 100 + i, d);
      expect(c.refused).toBeNull();
      expect(c.relaunches).toBe(i);
    }
    expect(countLaunch(f.opts.sittingDir, 1, 100, d).refused).toBeNull();
    expect(countLaunch(f.opts.sittingDir, 1, 999, d).refused).toMatch(/relaunches/);
    expect(countLaunch(f.opts.sittingDir, 2, 999, d).refused).toBeNull();
  });

  it("a corrupt book stops; gate 2 refuses gate 1's pid (TRAIN2-13)", () => {
    const f = fake("book");
    expect(countLaunch(f.opts.sittingDir, 1, 100, f.deps).refused).toBeNull();
    expect(countLaunch(f.opts.sittingDir, 2, 100, f.deps).refused).toMatch(/new launch/);
    writeFileSync(join(f.opts.sittingDir, "relaunches.json"), "{not json");
    expect(countLaunch(f.opts.sittingDir, 1, 101, f.deps).refused).toMatch(/does not parse/);
  });

  it("sittingLayout: one explicit sitting folder, new for the offline block (TRAIN2-06)", () => {
    const now = new Date(0);
    const none = (): boolean => false;
    expect(
      sittingLayout({ sittingDir: undefined, runDir: undefined, phase: 1, exists: none, now }),
    ).toMatch(/--sitting-dir/);
    const ok = sittingLayout({
      sittingDir: join(TMP, "s1"),
      runDir: undefined,
      phase: "offline-0",
      exists: none,
      now,
    });
    expect(typeof ok).toBe("object");
    expect(dirname((ok as { runDir: string }).runDir)).toBe(join(TMP, "s1"));
    expect(
      sittingLayout({
        sittingDir: join(TMP, "s1"),
        runDir: undefined,
        phase: "offline-0",
        exists: () => true,
        now,
      }),
    ).toMatch(/NEW sitting/);
    expect(
      sittingLayout({
        sittingDir: join(TMP, "s1"),
        runDir: undefined,
        phase: 2,
        exists: none,
        now,
      }),
    ).toMatch(/plant-p33.json/);
    expect(
      sittingLayout({
        sittingDir: join(TMP, "s1"),
        runDir: join(TMP, "elsewhere", "r"),
        phase: 1,
        exists: () => true,
        now,
      }),
    ).toMatch(/directly in/);
  });

  it("the gate step stops on a spent budget", async () => {
    const f = fake("budget-gate");
    for (let i = 0; i <= MAX_RELAUNCHES; i++) countLaunch(f.opts.sittingDir, 1, 100 + i, f.deps);
    const r = await runBattery([phase(1)[0]], f.deps, f.opts);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/spent its 3 relaunches/);
  });
});

describe("P3-3 helpers", () => {
  it("windowVerdict: dialog handoff, unexpected stop, expected go", () => {
    expect(windowVerdict({ added: [win("x", 1, "#32770", 2)], disabled: [] }, [/x/])?.kind).toBe(
      "handoff",
    );
    expect(
      windowVerdict({ added: [win("Script Authorization Required", 1)], disabled: [] }, [/./])
        ?.kind,
    ).toBe("handoff");
    expect(windowVerdict({ added: [win("Other", 1)], disabled: [] }, [/World Editor/])?.kind).toBe(
      "stopped",
    );
    expect(
      windowVerdict({ added: [win("World Editor - x", 1)], disabled: [] }, [/^World Editor - .+$/]),
    ).toBeNull();
    // an owned window or a prompt titled like the app is a handoff whatever its title (TRAIN2-02)
    expect(
      windowVerdict({ added: [win("World Editor - x", 1, "Qt683QWindowIcon", 7)], disabled: [] }, [
        /^World Editor - .+$/,
      ])?.kind,
    ).toBe("handoff");
    expect(
      windowVerdict(
        { added: [win("Arma Reforger Workbench", 1)], disabled: [] },
        WORLD_EDITOR_WINDOWS,
      ),
    ).toBeNull();
    expect(
      windowVerdict({ added: [win("World Editor - x", 1, "OtherClass")], disabled: [] }, [
        /^World Editor - .+$/,
      ])?.kind,
    ).toBe("stopped");
    expect(windowVerdict({ added: [], disabled: [win("Main", 1)] }, undefined)?.kind).toBe(
      "handoff",
    );
  });

  it("compareTrees compares controlType+name node for node", () => {
    const a = node("Window", "W", [node("MenuBar", "", [node("MenuItem", "File")])]);
    const b = node("Window", "W", [node("MenuBar", "", [node("MenuItem", "Edit")])]);
    expect(compareTrees(a, a).equal).toBe(true);
    const c = compareTrees(a, b);
    expect(c.equal).toBe(false);
    expect(c.firstDiff).toBe(2);
  });

  it("compareTreesLoose: types strict, names only where both non-empty, case-insensitive", () => {
    const a = node("Window", "W", [node("MenuBar", "", [node("MenuItem", "File")])]);
    const b = node("Window", "w", [
      node("MenuBar", "System Menu Bar", [node("MenuItem", " file ")]),
    ]);
    const ok = compareTreesLoose(a, b);
    expect(ok.equal).toBe(true);
    expect(ok.nameDiffs).toBe(0);
    const d = compareTreesLoose(
      a,
      node("Window", "W", [node("MenuBar", "", [node("MenuItem", "Edit")])]),
    );
    expect(d.equal).toBe(true);
    expect(d.nameDiffs).toBe(1);
    expect(d.nameDiffSample).toHaveLength(1);
    expect(
      compareTreesLoose(a, node("Window", "W", [node("ToolBar", "", [node("MenuItem", "File")])]))
        .equal,
    ).toBe(false);
    expect(compareTreesLoose(a, node("Window", "W", [])).equal).toBe(false);
  });

  it("an unowned enabled Qt683QWindowIcon titled Arma Reforger Workbench is benign (gate 2 launch 1)", () => {
    expect(
      windowVerdict(
        { added: [win("Arma Reforger Workbench", 7, "Qt683QWindowIcon")], disabled: [] },
        undefined,
      ),
    ).toBeNull();
    expect(
      windowVerdict({ added: [win("Other Thing", 7, "Qt683QWindowIcon")], disabled: [] }, undefined)
        ?.kind,
    ).toBe("stopped");
  });

  it("the queue [unverified] list records the authorize prompt and the 358-node tree", () => {
    const q = readFileSync(
      join(process.cwd(), "docs", "v2", "sessions", "queues", "P3-3.md"),
      "utf-8",
    );
    expect(q).toMatch(/createSandboxWorlds[^\n]*DOES prompt[^\n]*Script Authorization Required/);
    expect(q).toMatch(/358 nodes with the menu bar/);
  });

  it("compileErrors and lineDiff", () => {
    expect(
      compileErrors("SCRIPT (E): EMCP_WB_Module.c(12): Undefined function\nok line"),
    ).toHaveLength(1);
    expect(compileErrors("SCRIPT: all fine")).toHaveLength(0);
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual(['2: "b" -> "B"']);
  });
});

describe("P3-3 restore and rollback", () => {
  function io(
    files: Record<string, Buffer>,
    running: number[] = [],
  ): OfflineIo & { log: (l: string) => void; lines: string[] } {
    const lines: string[] = [];
    const o = {
      lines,
      workbenchPids: () => running,
      exists: (p: string) =>
        Object.keys(files).some((k) => k === p || k.startsWith(p + "/") || k.startsWith(p + "\\")),
      listDir: (p: string) => [
        ...new Set(
          Object.keys(files)
            .filter((k) => dirname(k) === p)
            .map((k) => k.slice(p.length + 1)),
        ),
      ],
      listTree: (p: string) =>
        Object.keys(files)
          .filter((k) => k.startsWith(p))
          .map((k) => k.slice(p.length + 1).replace(/\\/g, "/")),
      readBytes: (p: string) => files[p] ?? Buffer.from("{}"),
      removeFile: (p: string) => void delete files[p],
      removeTree: (p: string) => {
        for (const k of Object.keys(files)) if (k.startsWith(p)) delete files[k];
      },
      lkgBytes: (n: string) => Buffer.from(`old ${n}`),
      lkgNames: () => ["EMCP_WB_Common.c", "EMCP_WB_Ping.c"],
      writeBytes: (p: string, b: Buffer) => void (files[p] = b),
      log: (l: string) => lines.push(l),
    };
    return o;
  }
  const sandbox = join(TMP, "rs", SANDBOX_NAME);
  const hdir = join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP");

  it("restore removes the Phase 3 files and writes the tag's set; dry run writes nothing", () => {
    const files: Record<string, Buffer> = {
      [join(hdir, "EMCP_WB_Common.c")]: Buffer.from("new"),
      [join(hdir, "EMCP_WB_Ping.c")]: Buffer.from("new"),
      [join(hdir, "EMCP_WB_Guard.c")]: Buffer.from("new"),
    };
    const dry = io(files);
    expect(runRestore(sandbox, false, dry)).toBe(EXIT.done);
    expect(Object.keys(files)).toHaveLength(3);
    expect(runRestore(sandbox, true, io(files, [7]))).toBe(EXIT.refused);
    expect(runRestore(sandbox, true, io(files))).toBe(EXIT.done);
    expect(Object.keys(files).sort()).toEqual(
      [join(hdir, "EMCP_WB_Common.c"), join(hdir, "EMCP_WB_Ping.c")].sort(),
    );
    expect(files[join(hdir, "EMCP_WB_Ping.c")].toString()).toBe("old EMCP_WB_Ping.c");
  });

  it("rollback lists and removes _throwaway/P33 only with no Workbench running", () => {
    const p33 = join(sandbox, "_throwaway", "P33");
    const files: Record<string, Buffer> = { [join(p33, "u16", "a.conf")]: Buffer.from("x") };
    const sitting = join(TMP, "rs-sitting");
    expect(runRollback(sandbox, sitting, true, io(files, [3]))).toBe(EXIT.refused);
    expect(runRollback(sandbox, sitting, true, io(files))).toBe(EXIT.done);
    expect(Object.keys(files).some((k) => k.startsWith(p33))).toBe(false);
    expect(Object.keys(files).some((k) => k.endsWith("throwaway-p33-listing.json"))).toBe(true);
  });
});
