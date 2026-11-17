import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sandboxRefusal as lspSandboxRefusal } from "../../scripts/live/lsp-probe.js";
import { checkPlan, main as dryRunMain } from "../../scripts/live/dry-run.js";
import { probePackTarget } from "../../scripts/live/launch.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { BACKGROUND_CAP_MS } from "../../scripts/live/session-common.js";
import type { DetachedSpec, RawCallResult, WindowInfo } from "../../scripts/live/s-c-natives.js";
import { AUTH_LOG, AUTH_TITLE } from "../../scripts/live/s-d-train1.js";
import {
  API_INDEX_DIR,
  AUTH_ROOT,
  BLOCKS,
  DEFAULT_QUEUE,
  EXIT,
  GATE_LAUNCH1,
  LSP_PORT,
  NEVER_FLAG,
  PROBE_API,
  argvRefusal,
  authProbe,
  buildActionPlan,
  buildQueue,
  buildSteps,
  closeRefusal,
  dlgConsumersIn,
  iniPathRefusal,
  invocationWorstCaseMs,
  isOffline,
  lspRefusal,
  main,
  menuHasLabel,
  planInput,
  promptText,
  keyNamesOf,
  isPropertyGridRow,
  parseRuledButtons,
  ruledButton,
  runSession,
  selectedIds,
  selectionRefusal,
  sendRefusal,
  type SfDeps,
  type SfOptions,
  type ToolResult,
} from "../../scripts/live/s-f-gui.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-sf-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const SANDBOX = join(TMP, "addons", SANDBOX_NAME);
const PID = 1000;
const SCRATCH_INI = join(TMP, "scratch.ini");
writeFileSync(SCRATCH_INI, "[World%20Editor]\r\nScriptDebugMode=false\r\n");
const LOG_LINE = `ENGINE: Using autosave directory: T:/planted/Projects/${SANDBOX_NAME}/autosaves\n`;

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

interface Harness {
  deps: SfDeps;
  netCalls: Array<{ apiFunc: string; params: Record<string, unknown> }>;
  detached: DetachedSpec[];
  tools: Array<{ tool: string; args: string[] }>;
  artifacts: Map<string, unknown>;
  texts: Map<string, string>;
  results: Map<string, RawCallResult>;
  extra: WindowInfo[];
  /** Detached labels that raise the authorization prompt. */
  promptOn: Set<string>;
  maxConcurrent: number;
  running: { wb: boolean; child: boolean };
  closed: number;
  toolAnswer: (tool: string, args: string[]) => ToolResult;
}

function harness(): Harness {
  let t = 1_700_000_000_000;
  let inFlight = 0;
  const h: Harness = {
    deps: undefined as unknown as SfDeps,
    netCalls: [],
    detached: [],
    tools: [],
    artifacts: new Map(),
    texts: new Map(),
    results: new Map(),
    extra: [],
    promptOn: new Set(),
    maxConcurrent: 0,
    running: { wb: false, child: false },
    closed: 0,
    toolAnswer: () => ({ code: 0, json: {}, detail: "" }),
  };
  const answer = (apiFunc: string, params: Record<string, unknown>): RawCallResult => {
    if (apiFunc === "IsWorkbenchRunning") return ok({ IsRunning: true, ScriptsCompiled: true });
    if (apiFunc === "GetLoadedProjects")
      return ok({ "Loaded Projects": ["ArmaReforger", SANDBOX_NAME] });
    if (apiFunc === PROBE_API && params.action === "info") return ok(pack({ isSandbox: "true" }));
    if (apiFunc === PROBE_API && params.action === "authProbe")
      return ok(
        pack({
          method: String(params.authMethod),
          root: AUTH_ROOT,
          variant: String(params.authVariant),
          returned: "true",
          count: "3",
        }),
      );
    return ok(pack());
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
    listWindows: async () => [win("Enfusion Workbench", PID * 10), ...h.extra],
    capture: async (label) => ({ ok: true, path: `capture-${label}.png`, detail: "mock" }),
    processImage: (pid) =>
      pid === PID
        ? "ArmaReforgerWorkbenchSteamDiag.exe"
        : pid === 4300 && h.running.child
          ? "node.exe"
          : null,
    processCreated: async (pid) => (pid === PID ? PID * 10 : pid === 4300 ? 43 : null),
    workbenchPids: () => (h.running.wb ? [PID] : []),
    listRunFiles: () => [...h.artifacts.keys(), ...h.texts.keys(), ...h.results.keys()],
    listDir: () => ["ECEN_Probe.c", "ECEN_ProbeAuth.c"],
    portOwners: (port) => (port === LSP_PORT ? [] : [PID]),
    crashReporters: () => [],
    closeGracefully: async () => {
      h.closed++;
      return { exited: true, detail: "mock" };
    },
    recordedPid: () => PID,
    heartbeat: () => {},
    sessionLogAfter: () => "LOG",
    readText: (p) => (/\.ini$/i.test(p) ? readFileSync(SCRATCH_INI, "utf-8") : LOG_LINE),
    readRegLines: () => [],
    fileExists: () => false,
    startDetached: (spec) => {
      h.detached.push(spec);
      if ([...h.promptOn].some((l) => spec.resultName.includes(l))) {
        h.extra.push(win(AUTH_TITLE, 7300, 0, "Qt683QWindowIcon"));
        h.texts.set(`${spec.resultName}.request.json`, "{}");
        h.texts.set(`${spec.resultName}.pid.json`, JSON.stringify({ pid: 4300, created: 43 }));
        h.running.child = true;
        return 4300;
      }
      h.results.set(spec.resultName, answer(spec.apiFunc, spec.params));
      return 4245;
    },
    runTool: async (tool, args) => {
      h.tools.push({ tool, args });
      return h.toolAnswer(tool, args);
    },
    dlgConsumers: () => ({ classes: ["SCR_Dialogue"], files: 1 }),
    readRunFile: (name) => {
      if (h.results.has(name)) return JSON.stringify(h.results.get(name));
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

/** The owner answered: the prompt is gone and the child wrote its late answer. */
function ownerAnswers(h: Harness, late: RawCallResult): void {
  h.extra = h.extra.filter((w) => w.title !== AUTH_TITLE);
  const req = [...h.texts.keys()].find((k) => k.endsWith(".request.json"))!;
  h.results.set(req.replace(/\.request\.json$/, ""), late);
  h.running.child = false;
}

function options(over: Partial<SfOptions> = {}): SfOptions {
  return {
    sandboxDir: SANDBOX,
    gproj: join(SANDBOX, `${SANDBOX_NAME}.gproj`),
    from: null,
    until: null,
    only: null,
    openedProjectPattern:
      "Using autosave directory: .*[\\\\/]Projects[\\\\/]([^\\\\/]+)[\\\\/]autosaves",
    allowedAddons: ["ArmaReforger"],
    nonce: "abc123",
    runDir: join(TMP, "run"),
    laneId: "sf-test",
    policy,
    registryExport: "REG",
    debugModeUnsetOk: false,
    forceSettings: SCRATCH_INI,
    offline: false,
    netPort: 5775,
    ...over,
  };
}

// ── The queue ────────────────────────────────────────────────────────────────

describe("queue", () => {
  const q = buildQueue();
  it("equals the script's step table (regenerate with --emit-queue)", () => {
    expect(JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8"))).toEqual(JSON.parse(JSON.stringify(q)));
  });
  it("validates as a pre-flight step 7 queue, ordered within each phase", () => {
    expect(() => validateQueue(q, false)).not.toThrow();
  });
  it("carries no -scriptAuthorizeAll in its launch args, and the ruled buttons", () => {
    expect(JSON.stringify(q.launch_args)).not.toContain(NEVER_FLAG);
    expect(ruledButton("sf-04-u27-fileexists")).toBe("No");
    expect(ruledButton("sf-09-u27-openfile-yes-to-all")).toBe("YesToAll");
    expect(ruledButton("sf-02-u27-findfiles")).toBe("Yes");
    const probes = q.probes as Array<{ id: string; ruled_button?: string }>;
    expect(probes.filter((p) => p.ruled_button === "No").map((p) => p.id)).toEqual([
      "sf-04-u27-fileexists",
    ]);
    expect(probes.filter((p) => p.ruled_button === "YesToAll").map((p) => p.id)).toEqual([
      "sf-09-u27-openfile-yes-to-all",
    ]);
  });
});

describe("blocks", () => {
  it("every block fits the background cap and the blocks cover every step but the gate once", () => {
    const steps = buildSteps();
    const covered = BLOCKS.flatMap((b) => selectedIds({ from: b.from, until: b.until }, steps));
    expect(covered.sort()).toEqual(
      steps
        .slice(1)
        .map((s) => s.id)
        .sort(),
    );
    for (const b of BLOCKS)
      expect(invocationWorstCaseMs(selectedIds(b, steps), steps)).toBeLessThan(BACKGROUND_CAP_MS);
  });
  it("refuses undeclared selections, offline mixups and a later block without --run-dir", () => {
    const base = { from: null, until: null, only: null, runDir: true };
    expect(
      selectionRefusal({
        ...base,
        from: "sf-02-u27-findfiles",
        until: "sf-10-u27-searchresources-after-yta",
      }),
    ).toMatch(/declared block/);
    expect(selectionRefusal({ ...base, only: "sf-p3-ini-after-launch1" })).toMatch(/--offline/);
    expect(selectionRefusal({ ...base, only: "sf-02-u27-findfiles", offline: true })).toMatch(
      /offline/,
    );
    expect(selectionRefusal({ ...base, only: "sf-02-u27-findfiles", runDir: false })).toMatch(
      /--run-dir/,
    );
    expect(selectionRefusal({ ...base, only: "sf-02-u27-findfiles" })).toBeNull();
    expect(isOffline("offline-1")).toBe(true);
  });
});

// ── Send-time refusals ───────────────────────────────────────────────────────

describe("refusals", () => {
  const r = (
    step: string,
    api: string,
    params: Record<string, unknown>,
    qt = false,
  ): string | null => sendRefusal(step, api, params, policy, qt);
  it("-scriptAuthorizeAll: the CLI flag is unknown (exit 2) and no token passes", async () => {
    expect(argvRefusal(["--script-authorize-all"])).toMatch(/not an option/);
    expect(argvRefusal(["--allowed-addons", "-scriptAuthorizeAll"])).toMatch(/never passed/);
    expect(await main(["--script-authorize-all"], { out: () => {} })).toBe(EXIT.usage);
    expect(await main(["--no-such-flag"], { out: () => {} })).toBe(EXIT.usage);
    expect(
      r("sf-02-u27-findfiles", PROBE_API, { action: "evalCompile", text: NEVER_FLAG }),
    ).toMatch(/never sent/);
  });
  it("moduleMatrix in any form; the Particle Editor in any request", () => {
    expect(r("sf-02-u27-findfiles", PROBE_API, { action: "moduleMatrix" })).toMatch(/moduleMatrix/);
    expect(
      r("sf-16-l421-editor-windows", "BringModuleWindowToFront", { ModuleName: "ParticleEditor" }),
    ).toMatch(/Particle Editor/);
    expect(
      r("sf-23-u22-plugin-preset", PROBE_API, {
        action: "pluginAttrs",
        moduleName: " particleeditor ",
      }),
    ).toMatch(/Particle Editor/);
  });
  it("any .ent and MainMenuWorld.ent; OpenResource only in sf-17 for a .st; no EditorControl", () => {
    expect(r("sf-17-l410-open-st", "OpenResource", { ResourceName: "worlds/X/X.ent" })).toMatch(
      /\.ent/,
    );
    expect(
      r("sf-07-u27-loadcontainer", PROBE_API, {
        action: "loadContainer",
        path: "worlds/MainMenuWorld/MainMenuWorld.ent",
      }),
    ).toMatch(/MainMenuWorld/);
    expect(r("sf-16-l421-editor-windows", "OpenResource", { ResourceName: "a.st" })).toMatch(
      /only sf-17/,
    );
    expect(r("sf-17-l410-open-st", "OpenResource", { ResourceName: "a.conf" })).toMatch(
      /\.st only/,
    );
    expect(r("sf-17-l410-open-st", "OpenResource", { ResourceName: "UI/a.st" })).toBeNull();
    expect(r("sf-02-u27-findfiles", "EMCP_WB_EditorControl", { action: "openResource" })).toMatch(
      /not used/,
    );
  });
  it("authProbe outside the lists: method, root, variant, extra fields", () => {
    const s = "sf-02-u27-findfiles";
    expect(r(s, PROBE_API, authProbe("FindFiles", "a").params)).toBeNull();
    expect(r(s, PROBE_API, authProbe("FindFiles", "b").params)).toBeNull();
    expect(r(s, PROBE_API, { ...authProbe("FindFiles").params, authMethod: "DeleteFile" })).toMatch(
      /authMethod/,
    );
    expect(r(s, PROBE_API, { ...authProbe("FindFiles").params, authRoot: "$profile:" })).toMatch(
      /authRoot/,
    );
    expect(r(s, PROBE_API, { ...authProbe("FileExists").params, authVariant: "b" })).toMatch(
      /authVariant/,
    );
    expect(r(s, PROBE_API, { ...authProbe("FindFiles").params, authVariant: "c" })).toMatch(
      /authVariant/,
    );
    expect(r(s, PROBE_API, { ...authProbe("FindFiles").params, path: "x" })).toMatch(/only/);
  });
  it("executeAction: only sf-14, only the Qt Introspection path, only after sf-12 read the label", () => {
    const qt = {
      action: "executeAction",
      moduleName: "ResourceManager",
      menuPath: ["Utilities", "Qt Introspection Tool"],
    };
    expect(r("sf-14-u31-qt-introspection", PROBE_API, qt, true)).toBeNull();
    expect(r("sf-14-u31-qt-introspection", PROBE_API, qt, false)).toMatch(/until sf-12/);
    expect(r("sf-12-u21-menus-background", PROBE_API, qt, true)).toMatch(/only sf-14/);
    expect(
      r("sf-14-u31-qt-introspection", PROBE_API, { ...qt, menuPath: ["File", "Exit"] }, true),
    ).toMatch(/sends only/);
    expect(
      r(
        "sf-14-u31-qt-introspection",
        "EMCP_WB_ExecuteAction",
        { path: ["Utilities", "Qt Introspection Tool"] },
        true,
      ),
    ).toMatch(/never sent/);
    expect(
      menuHasLabel(
        { menus: [{ title: "Utilities", items: [{ name: "Qt Introspection Tool" }] }] },
        "Utilities",
        "Qt Introspection Tool",
      ),
    ).toBe(true);
    expect(
      menuHasLabel(
        { menus: [{ title: "Utilities", items: [{ name: "Qt Introspection" }] }] },
        "Utilities",
        "Qt Introspection Tool",
      ),
    ).toBe(false);
  });
  it("WM_CLOSE: never in launch 1; in launch 2 only with one top-level window", () => {
    expect(closeRefusal(1, [win("Main", 1)])).toMatch(/owner's hand/);
    expect(closeRefusal(2, [win("Main", 1), win("World Editor", 2)])).toMatch(/2 top-level/);
    expect(closeRefusal(2, [win("Main", 1)])).toBeNull();
  });
  it("the mutating pack and writes; any NET call in sf-26; lsp-probe on the NET port; ini outside artifacts", () => {
    expect(r("sf-02-u27-findfiles", "ECEN_ProbeMut", { action: "none" })).toMatch(/mutating pack/);
    expect(r("sf-02-u27-findfiles", "SaveContainer", {})).toMatch(/no write/);
    expect(r("sf-02-u27-findfiles", "CreateWorld", {})).toMatch(/no write/);
    expect(r("sf-02-u27-findfiles", "TextureValidator", {})).toMatch(/no write/);
    expect(r("sf-26-u36-shortcuts-page-owner", "IsWorkbenchRunning", {})).toMatch(/sf-26/);
    expect(lspRefusal(5775, 5775)).toMatch(/NET API port/);
    expect(lspRefusal(LSP_PORT, 5775)).toBeNull();
    expect(iniPathRefusal(join(TMP, "x.ini"), join(TMP, "artifacts"))).toMatch(/not inside/);
    expect(iniPathRefusal(join(TMP, "artifacts", "x.ini"), join(TMP, "artifacts"))).toBeNull();
  });
  it("the engine refuses at the call: no second call while one is pending (max concurrency 1)", async () => {
    const h = harness();
    await runSession(options({ only: "sf-01-port-5776-closed" }), h.deps);
    expect(h.maxConcurrent).toBe(1);
  });
});

// ── The authorization handoff ────────────────────────────────────────────────

describe("authorization handoff", () => {
  it("a prompt is a handoff naming the ruled button; nothing is sent to it; the resume records button, text and late answer", async () => {
    const h = harness();
    h.promptOn.add("sf-04");
    const r1 = await runSession(options({ only: "sf-04-u27-fileexists" }), h.deps);
    expect(r1.exit).toBe(EXIT.handoff);
    expect(r1.stop?.reason).toMatch(/press No \(ruled for sf-04-u27-fileexists\)/);
    expect(h.artifacts.has("auth-sf-04-u27-fileexists.json")).toBe(true);
    // Nothing more was sent once the prompt was up.
    const sent = h.netCalls.length + h.detached.length;
    // The resume without the button, and with a deviation, is refused.
    ownerAnswers(h, ok(pack({ method: "FileExists", returned: "false", count: "0" })));
    h.texts.set(
      "auth-sf-04-u27-fileexists-walk.json",
      JSON.stringify({
        name: AUTH_TITLE,
        children: [{ name: "Allow script ... FileIO.FileExists?" }],
      }),
    );
    expect((await runSession(options({ only: "sf-05-u27-findfiles-line-b" }), h.deps)).exit).toBe(
      EXIT.refused,
    );
    const dev = await runSession(
      options({ only: "sf-05-u27-findfiles-line-b", ownerClicked: ["Yes"] }),
      h.deps,
    );
    expect(dev.stop?.reason).toMatch(/ruled button is No/);
    expect(h.netCalls.length + h.detached.length).toBe(sent);
    // The ruled button: recorded with the prompt text and the refused call's answer.
    const r2 = await runSession(
      options({ only: "sf-05-u27-findfiles-line-b", ownerClicked: ["No"] }),
      h.deps,
    );
    expect(r2.exit).toBe(EXIT.done);
    const entry = JSON.parse(h.texts.get(AUTH_LOG)!.trim()) as Record<string, unknown>;
    expect(entry.buttons).toEqual(["No"]);
    expect(entry.deviation).toBe(false);
    expect(String((entry.prompt_texts as string[])[0])).toMatch(/FileIO\.FileExists/);
    expect((entry.late_answer_facts as Record<string, string>).returned).toBe("false");
    expect(
      (h.artifacts.get("sf-04-u27-fileexists.json") as { ownerAnswer?: unknown }).ownerAnswer,
    ).toBeTruthy();
  });
  it("a deviation is recorded only with --owner-clicked-deviation; Yes to All marks the run", async () => {
    const h = harness();
    h.promptOn.add("sf-09");
    await runSession(options({ only: "sf-09-u27-openfile-yes-to-all" }), h.deps);
    ownerAnswers(h, ok(pack({ returned: "true", count: "0" })));
    const r = await runSession(
      options({
        only: "sf-10-u27-searchresources-after-yta",
        ownerClicked: ["Yes"],
        ownerClickedDeviation: true,
      }),
      h.deps,
    );
    expect(r.exit).toBe(EXIT.done);
    const entry = JSON.parse(h.texts.get(AUTH_LOG)!.trim()) as Record<string, unknown>;
    expect(entry).toMatchObject({ ruled: "YesToAll", deviation: true, buttons: ["Yes"] });
  });
  it("a second prompt of the same call is a handoff; the resume takes the buttons as a list", async () => {
    const h = harness();
    h.promptOn.add("sf-09");
    await runSession(options({ only: "sf-09-u27-openfile-yes-to-all" }), h.deps);
    // The owner clicked; the child still waits and the prompt is up again.
    const again = await runSession(
      options({ only: "sf-10-u27-searchresources-after-yta", ownerClicked: ["YesToAll"] }),
      h.deps,
    );
    expect(again.exit).toBe(EXIT.handoff);
    expect(h.artifacts.has("auth-sf-09-u27-openfile-yes-to-all-2.json")).toBe(true);
    ownerAnswers(h, ok(pack({ returned: "true" })));
    expect(
      (
        await runSession(
          options({ only: "sf-10-u27-searchresources-after-yta", ownerClicked: ["YesToAll"] }),
          h.deps,
        )
      ).exit,
    ).toBe(EXIT.refused);
    const r = await runSession(
      options({
        only: "sf-10-u27-searchresources-after-yta",
        ownerClicked: ["YesToAll", "YesToAll"],
      }),
      h.deps,
    );
    expect(r.exit).toBe(EXIT.done);
    expect(r.steps.find((s) => s.id === "sf-10-u27-searchresources-after-yta")?.summary).toMatch(
      /Yes to All was clicked earlier/,
    );
  });
  it("--ruled-buttons replaces the ruling: the handoff names it, the deviation flag compares with it", async () => {
    const h = harness();
    const ruled = {
      "sf-04-u27-fileexists": "Yes",
      "sf-09-u27-openfile-yes-to-all": "Yes",
    } as const;
    h.promptOn.add("sf-04");
    const r1 = await runSession(
      options({ only: "sf-04-u27-fileexists", ruledButtons: ruled }),
      h.deps,
    );
    expect(r1.stop?.reason).toMatch(/press Yes \(ruled for sf-04-u27-fileexists\)/);
    ownerAnswers(h, ok(pack({ method: "FileExists", returned: "true", count: "0" })));
    // S-F's own No is now the deviation.
    const dev = await runSession(
      options({ only: "sf-09-u27-openfile-yes-to-all", ownerClicked: ["No"], ruledButtons: ruled }),
      h.deps,
    );
    expect(dev.stop?.reason).toMatch(/ruled button is Yes/);
    const r2 = await runSession(
      options({
        only: "sf-09-u27-openfile-yes-to-all",
        ownerClicked: ["Yes"],
        ruledButtons: ruled,
      }),
      h.deps,
    );
    expect(r2.exit).toBe(EXIT.done);
    const entry = JSON.parse(h.texts.get(AUTH_LOG)!.trim()) as Record<string, unknown>;
    expect(entry).toMatchObject({ ruled: "Yes", ruled_by: "command line", deviation: false });
    // OpenFile answered with no prompt after a Yes in the process: void as a per-method answer.
    expect(r2.steps.find((s) => s.id === "sf-09-u27-openfile-yes-to-all")?.summary).toMatch(/VOID/);
  });
  it("the U27 verdicts read the recorded presses: a No on sf-02, Yes to All on sf-03", async () => {
    const h = harness();
    const ruled = { "sf-02-u27-findfiles": "No", "sf-03-u27-findfiles-again": "YesToAll" } as const;
    h.promptOn.add("sf-02");
    await runSession(options({ only: "sf-02-u27-findfiles", ruledButtons: ruled }), h.deps);
    ownerAnswers(h, ok(pack({ method: "FindFiles", returned: "false", count: "0" })));
    const r3 = await runSession(
      options({ only: "sf-03-u27-findfiles-again", ownerClicked: ["No"], ruledButtons: ruled }),
      h.deps,
    );
    expect(r3.steps.find((s) => s.id === "sf-03-u27-findfiles-again")?.summary).toMatch(
      /after No on sf-02: the refusal held/,
    );
    const h2 = harness();
    h2.promptOn.add("sf-03");
    await runSession(options({ only: "sf-03-u27-findfiles-again", ruledButtons: ruled }), h2.deps);
    ownerAnswers(h2, ok(pack({ method: "FindFiles", returned: "true", count: "1" })));
    const r5 = await runSession(
      options({
        only: "sf-05-u27-findfiles-line-b",
        ownerClicked: ["YesToAll"],
        ruledButtons: ruled,
      }),
      h2.deps,
    );
    expect(r5.steps.find((s) => s.id === "sf-05-u27-findfiles-line-b")?.summary).toMatch(
      /after Yes to All: its scope covers another call site/,
    );
  });
  it("parseRuledButtons refuses an unknown button", () => {
    expect(parseRuledButtons("sf-04-u27-fileexists=Yes")).toEqual({
      "sf-04-u27-fileexists": "Yes",
    });
    expect(() => parseRuledButtons("sf-04-u27-fileexists=Maybe")).toThrow(/ruled-buttons/);
  });
  it("--owner-done is refused for an authorization handoff", async () => {
    const h = harness();
    h.promptOn.add("sf-02");
    await runSession(options({ only: "sf-02-u27-findfiles" }), h.deps);
    ownerAnswers(h, ok(pack()));
    const r = await runSession(
      options({ only: "sf-03-u27-findfiles-again", ownerDone: true }),
      h.deps,
    );
    expect(r.stop?.reason).toMatch(/--owner-done is refused/);
  });
  it("no menus tool while the authorization window is up", async () => {
    const h = harness();
    h.extra.push(win(AUTH_TITLE, 7300, 0, "Qt683QWindowIcon"));
    const r = await runSession(
      options({ from: "sf-12-u21-menus-background", until: "sf-14-u31-qt-introspection" }),
      h.deps,
    );
    expect(r.exit).not.toBe(EXIT.done);
    expect(h.tools.filter((t) => t.tool === "menus")).toHaveLength(0);
  });
});

// ── Owner-hand steps and conditions ──────────────────────────────────────────

describe("owner-hand and conditional steps", () => {
  it("sf-15: exit 5 owner-hand; the resume needs --owner-done; --owner-clicked is refused", async () => {
    const h = harness();
    const r1 = await runSession(options({ only: "sf-15-u21-context-menu-owner" }), h.deps);
    expect(r1.exit).toBe(EXIT.handoff);
    expect(r1.stop?.kind).toBe("owner-hand");
    expect(
      (await runSession(options({ only: "sf-16-l421-editor-windows" }), h.deps)).stop?.reason,
    ).toMatch(/--owner-done/);
    expect(
      (
        await runSession(
          options({ only: "sf-15-u21-context-menu-owner", ownerClicked: ["Yes"] }),
          h.deps,
        )
      ).stop?.reason,
    ).toMatch(/no authorization handoff/);
    const r2 = await runSession(
      options({ only: "sf-15-u21-context-menu-owner", ownerDone: true }),
      h.deps,
    );
    expect(r2.exit).toBe(EXIT.done);
  });
  it("menus exit 6: a popup left open is the owner's Esc; without one (a disabled window) a STOP", async () => {
    const h = harness();
    h.toolAnswer = () => ({ code: 6, json: { leftOpen: [["File"]] }, detail: "" });
    const r = await runSession(
      options({ from: "sf-12-u21-menus-background", until: "sf-14-u31-qt-introspection" }),
      h.deps,
    );
    expect(r.stop?.kind).toBe("owner-hand");
    const h2 = harness();
    h2.toolAnswer = () => ({ code: 6, json: { result: "stopped", leftOpen: [] }, detail: "" });
    const r2 = await runSession(
      options({ from: "sf-12-u21-menus-background", until: "sf-14-u31-qt-introspection" }),
      h2.deps,
    );
    expect(r2.exit).toBe(EXIT.stopped);
  });
  it("the launch-1 pid record is write-once; sf-20 passes on a new pid and stops on the same", async () => {
    const h = harness();
    await runSession(options({ only: "sf-01-port-5776-closed" }), h.deps);
    expect(h.artifacts.get(GATE_LAUNCH1)).toMatchObject({ pid: PID });
    // Launch 2: another pid; the invocation's gate (sf-00) rewrites sf-00-gate.json, not the record.
    const PID2 = 2000;
    h.deps.recordedPid = () => PID2;
    h.deps.processImage = (pid) =>
      pid === PID || pid === PID2 ? "ArmaReforgerWorkbenchSteamDiag.exe" : null;
    h.deps.processCreated = async (pid) => (pid === PID2 ? PID2 * 10 : pid * 10);
    h.deps.portOwners = (port) => (port === LSP_PORT ? [] : [PID2]);
    h.deps.listWindows = async () => [
      { ...win("Enfusion Workbench", PID2 * 10), pid: PID2 },
      ...h.extra,
    ];
    const r = await runSession(options({ only: "sf-20-gate" }), h.deps);
    expect((h.artifacts.get("sf-00-gate.json") as { data: { pid: number } }).data.pid).toBe(PID2);
    expect(h.artifacts.get(GATE_LAUNCH1)).toMatchObject({ pid: PID });
    expect(r.steps.find((s) => s.id === "sf-20-gate")?.status).toBe("pass");
    // The same pid as launch 1: a STOP.
    const h3 = harness();
    await runSession(options({ only: "sf-01-port-5776-closed" }), h3.deps);
    const r3 = await runSession(options({ only: "sf-20-gate" }), h3.deps);
    expect(r3.stop?.reason).toMatch(/not a new process/);
  });
  it("sf-24 and sf-25 call lsp-probe with a --sandbox its own check accepts", async () => {
    const h = harness();
    h.deps.portOwners = () => [PID];
    await runSession(
      options({ from: "sf-22-u22-lsp-port", until: "sf-23-u22-plugin-preset" }),
      h.deps,
    );
    await runSession(
      options({ from: "sf-24-u20-lsp-session", until: "sf-25-u20-coexistence" }),
      h.deps,
    );
    const calls = h.tools.filter((t) => t.tool === "lsp-probe");
    expect(calls.length).toBe(2);
    for (const c of calls) {
      const i = c.args.indexOf("--sandbox");
      expect(i).toBeGreaterThan(-1);
      // lsp-probe's main resolves the value, then applies sandboxRefusal.
      expect(lspSandboxRefusal(resolve(c.args[i + 1]))).toBeNull();
    }
    expect(lspSandboxRefusal(resolve(join(TMP, "addons", "Other")))).not.toBeNull();
    expect(lspSandboxRefusal(resolve(SANDBOX + "\\"))).toBeNull();
  });
  it("every step id the runbook's block table names is a step id", () => {
    const md = readFileSync(join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-F.md"), "utf-8");
    const table = md.split("## Steps and blocks")[1].split("\n\n")[1];
    const named = [...table.matchAll(/--(?:only|from|until) (sf-[A-Za-z0-9-]+)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(20);
    const ids = new Set(buildSteps().map((s) => s.id));
    expect(named.filter((n) => !ids.has(n))).toEqual([]);
  });
  it("sf-p2's static scan reads the repo's scraped API index (at least one index file)", () => {
    const r = dlgConsumersIn(API_INDEX_DIR);
    expect(r.files).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(r.classes)).toBe(true);
  });
  it("sf-p4 sends the LSP keys with --create and the preset as a struct-token edit", async () => {
    const h = harness();
    h.toolAnswer = () => ({ code: 0, json: { sets: [{}, {}, {}] }, detail: "" });
    const r = await runSession(options({ only: "sf-p4-ini-launch2", offline: true }), h.deps);
    expect(r.steps.find((s) => s.id === "sf-p4-ini-launch2")?.status).toBe("pass");
    const a = h.tools.find((t) => t.tool === "ini-edit")!.args.join(" ");
    expect(a).toContain("--key LSP_Enabled --value 1 --create");
    expect(a).toContain("--key LSP_Port --value 5776 --create");
    expect(a).toContain(
      "--section Resource%20Manager --key ScriptTools\\SCR_ImageSetGenerator --value 384 --token m_iImageWidth --old 512",
    );
    expect(a).not.toContain("--key m_iImageWidth");
  });
  it("sf-13 runs only if sf-12 opened none; sf-14 only on the exact label", async () => {
    const h = harness();
    h.toolAnswer = () => ({
      code: 0,
      json: {
        opened: 2,
        menus: [{ title: "Utilities", opened: true, items: [{ name: "Qt Introspection Tool" }] }],
      },
      detail: "",
    });
    const r = await runSession(
      options({ from: "sf-12-u21-menus-background", until: "sf-14-u31-qt-introspection" }),
      h.deps,
    );
    const st = Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
    expect(st["sf-13-u21-menus-foreground"]).toBe("skipped");
    expect(st["sf-14-u31-qt-introspection"]).toBe("observed");
    const h2 = harness();
    h2.toolAnswer = () => ({ code: 0, json: { opened: 1, menus: [] }, detail: "" });
    const r2 = await runSession(
      options({ from: "sf-12-u21-menus-background", until: "sf-14-u31-qt-introspection" }),
      h2.deps,
    );
    expect(
      Object.fromEntries(r2.steps.map((s) => [s.id, s.status]))["sf-14-u31-qt-introspection"],
    ).toBe("skipped");
    expect(h2.detached.some((d) => d.params.action === "executeAction")).toBe(false);
  });
  it("sf-17 skips without --st-path; sf-24 and sf-25 skip unless sf-22 saw the port", async () => {
    const h = harness();
    const r = await runSession(
      options({ from: "sf-16-l421-editor-windows", until: "sf-17-l410-open-st" }),
      h.deps,
    );
    expect(r.steps.find((s) => s.id === "sf-17-l410-open-st")?.summary).toMatch(/--st-path/);
    const h2 = harness();
    await runSession(
      options({ from: "sf-22-u22-lsp-port", until: "sf-23-u22-plugin-preset" }),
      h2.deps,
    );
    const r2 = await runSession(
      options({ from: "sf-24-u20-lsp-session", until: "sf-25-u20-coexistence" }),
      h2.deps,
    );
    expect(r2.steps.filter((s) => s.status === "skipped").map((s) => s.id)).toEqual([
      "sf-24-u20-lsp-session",
      "sf-25-u20-coexistence",
    ]);
    expect(h2.tools.some((t) => t.tool === "lsp-probe")).toBe(false);
  });
  it("sf-27: several top-level windows make the close the owner's hand; one sends one WM_CLOSE", async () => {
    const h = harness();
    h.extra.push(win("World Editor", 2));
    const r = await runSession(options({ only: "sf-27-close-test" }), h.deps);
    expect(r.stop?.kind).toBe("owner-hand");
    expect(h.closed).toBe(0);
    const h2 = harness();
    const r2 = await runSession(options({ only: "sf-27-close-test" }), h2.deps);
    expect(r2.exit).toBe(EXIT.done);
    expect(h2.closed).toBe(1);
  });
  it("offline steps refuse while a Workbench runs; sf-p4 stops unless exactly 3 lines differ", async () => {
    const h = harness();
    h.running.wb = true;
    expect(
      (
        await runSession(
          options({ from: "sf-p3-ini-after-launch1", until: "sf-p4-ini-launch2", offline: true }),
          h.deps,
        )
      ).exit,
    ).toBe(EXIT.refused);
    const h2 = harness();
    h2.toolAnswer = (_t, a) => ({
      code: 0,
      json: a[0] === "set" ? { sets: [1, 2, 3, 4] } : null,
      stdout: "[Workbench] LSP_Enabled=1\n",
      detail: "",
    });
    const r = await runSession(
      options({ from: "sf-p3-ini-after-launch1", until: "sf-p4-ini-launch2", offline: true }),
      h2.deps,
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stop?.reason).toMatch(/not exactly 3/);
    expect(h2.netCalls).toHaveLength(0);
  });
  it("prompt text from a walker file", () => {
    expect(promptText(JSON.stringify({ name: "A", c: [{ text: "B" }, { name: "A" }] }))).toBe(
      "A | B",
    );
    expect(promptText(null)).toBeNull();
  });
});

// ── The action plan ──────────────────────────────────────────────────────────

describe("action plan", () => {
  it("passes the checker; every NET call of a step after the gate is detached except sf-25's", () => {
    const plan = buildActionPlan(planInput({ sandboxDir: null }));
    expect(checkPlan(plan, policy, { script: "scripts/live/s-f-gui.ts" }).ok).toBe(true);
    const nets = plan.filter(
      (a) =>
        a.kind === "net-call" &&
        !["sf-00-gate", "sf-20-gate", "sf-25-u20-coexistence"].includes(String(a.step)),
    );
    expect(nets.every((a) => a.detached === true)).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(
      /ParticleEditor|MainMenuWorld|\.ent"|moduleMatrix|scriptAuthorizeAll/,
    );
  });
  it("the menus, ini-edit and LSP calls are plan actions the checker validates", () => {
    const plan = buildActionPlan(planInput({ sandboxDir: null }));
    const kinds = (k: string): string[] =>
      plan.filter((a) => a.kind === k).map((a) => String(a.step));
    expect(kinds("uia-menu")).toEqual(["sf-12-u21-menus-background", "sf-13-u21-menus-foreground"]);
    expect(kinds("ini-edit")).toEqual([
      "sf-p1-ini-launch1",
      "sf-p3-ini-after-launch1",
      "sf-p4-ini-launch2",
      "sf-p5-ini-after-launch2",
    ]);
    expect(kinds("lsp")).toEqual(["sf-24-u20-lsp-session", "sf-25-u20-coexistence"]);
    const bent = plan.map((a) =>
      a.kind === "lsp"
        ? { ...a, port: a.netPort }
        : a.kind === "uia-menu"
          ? { ...a, menus: ["System"] }
          : a,
    );
    const rules = checkPlan(bent, policy, { script: "scripts/live/s-f-gui.ts" }).violations.map(
      (v) => v.rule,
    );
    expect(rules).toContain("lsp-refused");
    expect(rules).toContain("uia-menu-not-allow-listed");
  });
  it("the CLI dry run writes a plan the checker CLI passes", async () => {
    const out = join(TMP, "plan.json");
    expect(await main(["--sandbox", SANDBOX, "--out", out], { out: () => {} })).toBe(EXIT.done);
    expect(await dryRunMain([out, "--script", "scripts/live/s-f-gui.ts"])).toBe(0);
    expect(REPO_ROOT).toBeTruthy();
    expect(probePackTarget(SANDBOX)).toContain(SANDBOX_NAME);
  });
});

describe("isPropertyGridRow (the sf-p3 and sf-p5 counter)", () => {
  it("counts the [Workbench] shortcut rows that keyNamesOf reports with their section", () => {
    const keys = keyNamesOf(
      [
        "[Workbench] PropertyGrid\\unnamed\\Camera%3EMove%20Forward=true",
        "[Workbench] PropertyGrid\\unnamed\\Common%3EUndo=true",
        "[Workbench] hierarchyWindow\\showUnnamedEntities=true",
        "[Workbench] PropertyGrid\\ProjectSettingsGridCommon\\SplitterPos=250",
        "[ScriptEditor] LSP_Port=5776",
      ].join("\n"),
    );
    expect(keys).toHaveLength(5);
    expect(keys.filter(isPropertyGridRow)).toEqual([
      "Workbench\\PropertyGrid\\unnamed\\Camera%3EMove%20Forward",
      "Workbench\\PropertyGrid\\unnamed\\Common%3EUndo",
    ]);
    expect(isPropertyGridRow("PropertyGrid\\unnamed\\Common%3ESave")).toBe(true);
  });
});
