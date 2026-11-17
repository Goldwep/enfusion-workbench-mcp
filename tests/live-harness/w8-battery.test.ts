import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME, defaultPlaceholderContext } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { isAllowListed, loadAllowListFile, loadMenuItems } from "../../src/tools/wb-menu.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { buildWorkbenchArgs } from "../../src/workbench/client.js";
import { BUSY_GRACE_MS } from "../../scripts/census/live/common.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  ACCEPT_SETTING,
  ACCEPT_STEP,
  AGF_SEED,
  AI_DIR,
  ANIM_AGF,
  ANIM_AW,
  BT,
  CONTEXT_SURFACES,
  CURVE_GAP,
  FIXTURE_ENTITY,
  FIXTURE_UNDO_MAX,
  FIXTURE_FILES,
  FIXTURE_GRAPH_CALLS,
  GESTURE_CANVASES,
  PLANT_FILES,
  MODULE_WINDOWS,
  SELECT_SHOT_FILE,
  SELECT_SHOT_STEP,
  VIEWER_EXTENSIONS,
  judgeGestures,
  liveFixture,
  plannedFixtures,
  sweepSelectionBound,
  ACCEPT_SUFFIX,
  CLOSABLE_STEP,
  RELOAD_NO_INSTRUCTION,
  RELOAD_NO_KEY,
  RELOAD_NO_STEP,
  DEFAULT_QUEUE,
  EXIT,
  FILE_WRITE_ACTIONS,
  GATE_STEP,
  GPROJ,
  HAND_GATE_STEP,
  LAUNCH_ARGS,
  NETZERO_STEP,
  NOT_EXERCISED,
  NOT_TESTABLE,
  OPEN_LINKS,
  PLANT_DIRS,
  PLANT_FILE,
  POSTCHECK_STEP,
  PREP_FILE,
  PROBE_IDS,
  PROFILE_INI,
  SCRIPT_PATH,
  TS_ONLY_ACTIONS,
  W8_CONTRACTS,
  W8_ROOT,
  WORLD,
  buildActionPlan,
  buildQueue,
  buildSteps,
  carriesForceSettings,
  chordValues,
  diagValues,
  dryRunCheck,
  exercisedBy,
  failUnitOf,
  firstResourcePath,
  flipSetting,
  handFiles,
  indexCallers,
  main,
  menuRunPicks,
  offlinePlan,
  killedProbes,
  recordPath,
  runBattery,
  runPlant,
  runRollback,
  selectSteps,
  settingBool,
  toggleAsSetting,
  w8PlanViolations,
  WATCH_OPTIONS,
  P02_RESULTS_FILE,
  TREE_TRIES,
  applySweepFilter,
  LAUNCH1_SUB_EDITORS,
  SUB_EDITOR_CAP,
  parseSweepFilter,
  sweepByBuildText,
  sweepFailure,
  sweepLocator,
  sweepShares,
  sweepSurface,
  sweepVolatile,
  treeOf,
  type OfflineIo,
  type StepDef,
  type ToolResponse,
  type W8Deps,
  type W8Options,
  type W8Tool,
} from "../live/w8.live.js";

const STEPS = buildSteps();
const ids = STEPS.map((s) => s.id);
const indexOf = (id: string): number => ids.indexOf(id);
const policy = loadPolicy();
type Raw = Record<string, unknown>;

function planOf(s: StepDef): PlanAction[] {
  return s.plan();
}

function contractActions(handler: string): string[] {
  const c = JSON.parse(readFileSync(join(REPO_ROOT, "contracts", `${handler}.json`), "utf-8")) as {
    actions: Array<{ name?: string; action?: string }> | Record<string, unknown>;
  };
  return Array.isArray(c.actions)
    ? c.actions.map((a) => String(a.name ?? a.action))
    : Object.keys(c.actions);
}

const under = (p: string): boolean => p.replace(/\\/g, "/").startsWith(`${W8_ROOT}/`);
const prepJson = (over: Raw = {}): Buffer =>
  Buffer.from(
    JSON.stringify({
      kind: "w8-prep",
      profile: "w8",
      forceSettings: "C:/art/settings/scratch/w8-accept.ini",
      registrySha256: "h",
      registryExport: "x",
      at: "t",
      ...over,
    }),
  );

describe("W8 battery: the plan and the queue", () => {
  it("passes the dry-run gate (checkPlan, the W8 plan check, validateQueue)", () => {
    const r = dryRunCheck(policy);
    expect(r.lines.join("\n")).toContain("W8 plan check: PASS");
    expect(r.ok).toBe(true);
    expect(checkPlan(buildActionPlan(), policy, { script: SCRIPT_PATH }).ok).toBe(true);
  });

  it("main with no arguments is a dry run that passes and writes nothing", async () => {
    const before = statSync(DEFAULT_QUEUE).mtimeMs;
    const out: string[] = [];
    const code = await main([], { out: (l) => out.push(l) });
    expect(code).toBe(EXIT.done);
    expect(out.join("\n")).toContain("W8 plan check: PASS");
    expect(statSync(DEFAULT_QUEUE).mtimeMs).toBe(before);
  });

  it("the queue file equals buildQueue and validates", () => {
    const file = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildQueue())));
    expect(validateQueue(buildQueue(), false).length).toBe(STEPS.length);
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("launches with the argv wb_launch forceSettings builds, on the accept ini", () => {
    expect([...LAUNCH_ARGS]).toEqual(
      buildWorkbenchArgs({ gproj: GPROJ, forceSettings: PROFILE_INI }),
    );
    expect(GPROJ).toContain(`${SANDBOX_NAME}.gproj`);
    expect(LAUNCH_ARGS).toContain("-forceSettings");
    expect(LAUNCH_ARGS).toContain("-scriptAuthorizeAll");
    expect(PROFILE_INI).toContain(`<profile>${ACCEPT_SUFFIX}.ini`);
  });

  it("step ids are unique and shaped; phases are ordered prep, live, post", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w8-\d\d-[a-z0-9-]+$/);
    const phases = STEPS.map((s) => s.phase);
    const firstLive = phases.indexOf("live");
    expect(phases.slice(0, firstLive).every((p) => p === "prep")).toBe(true);
    expect(ids[firstLive]).toBe(GATE_STEP);
    expect(ids[ids.length - 1]).toBe(POSTCHECK_STEP);
    expect(ids[ids.length - 2]).toBe(CLOSABLE_STEP);
    for (const s of STEPS) {
      expect(s.expected.length, s.id).toBeGreaterThan(10);
      expect(s.kill_criterion.length, s.id).toBeGreaterThan(5);
    }
  });

  it("the offline probes run first, in the ruled order P-W8-21, -06, -04", () => {
    const prep = STEPS.filter((s) => s.phase === "prep").flatMap((s) => s.probes);
    expect(prep).toEqual(["P-W8-21", "P-W8-06", "P-W8-04"]);
  });

  it("P-W8-24 comes before any wb_diag call, and every later wb_diag step depends on it", () => {
    const first = STEPS.findIndex((s) => planOf(s).some((a) => a.tool === "wb_diag"));
    expect(STEPS[first]!.probes).toContain("P-W8-24");
    for (const s of STEPS.slice(first + 1))
      if (planOf(s).some((a) => a.tool === "wb_diag"))
        expect(s.dependsOn ?? [], s.id).toContain("P-W8-24");
  });

  it("P-W8-02 comes before any drive or row read, and every such step depends on it", () => {
    const sweep = STEPS.findIndex((s) => s.probes.includes("P-W8-02"));
    const rowActions = new Set(["invoke", "expand", "toggle", "select", "setValue", "read"]);
    for (const [i, s] of STEPS.entries()) {
      if (!planOf(s).some((a) => a.tool === "wb_gui" && rowActions.has(String(a.toolAction))))
        continue;
      expect(i, s.id).toBeGreaterThan(sweep);
      expect(s.dependsOn ?? [], s.id).toContain("P-W8-02");
    }
  });

  it("P-W8-03 comes before any other dialog step, and they depend on it", () => {
    const p03 = STEPS.findIndex((s) => s.probes.includes("P-W8-03"));
    for (const [i, s] of STEPS.entries()) {
      if (!s.dialog || i === p03) continue;
      expect(i).toBeGreaterThan(p03);
      expect(s.dependsOn ?? []).toContain("P-W8-03");
    }
  });

  it("the hand steps form one block at the end, after the relaunch boundary", () => {
    const boundary = indexOf(NETZERO_STEP);
    expect(STEPS[boundary]!.boundary).toBeTruthy();
    expect(indexOf(HAND_GATE_STEP)).toBe(boundary + 1);
    const hands = STEPS.map((s, i) => (s.hand ? i : -1)).filter((i) => i >= 0);
    expect(hands.length).toBeGreaterThan(0);
    for (const i of hands) expect(i).toBeGreaterThan(boundary);
    // contiguous: nothing hand-free between the first and the last hand step
    expect(hands[hands.length - 1]! - hands[0]! + 1).toBe(hands.length);
    expect(indexOf(CLOSABLE_STEP)).toBe(hands[hands.length - 1]! + 1);
    for (const s of STEPS.slice(0, boundary + 1)) expect(s.hand ?? false, s.id).toBe(false);
  });

  it("the test-bed check lives in the battery, never in a shipped tool or handler (DEC-058)", () => {
    const self = readFileSync(join(REPO_ROOT, ...SCRIPT_PATH.split("/")), "utf-8");
    expect(self).toContain("projectName !== SANDBOX_NAME");
    expect(self).toContain('"aborted"');
    const walk = (d: string): string[] =>
      readdirSync(join(REPO_ROOT, d), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      );
    for (const dir of ["src/tools", "mod/Scripts/WorkbenchGame/EnfusionMCP"])
      for (const f of walk(dir))
        expect(readFileSync(join(REPO_ROOT, f), "utf-8"), f).not.toContain(SANDBOX_NAME);
  });

  it("selectSteps refuses unknown ids and inverted ranges, and honours --only, --from, --until", () => {
    expect(typeof selectSteps(STEPS, { only: "nope" })).toBe("string");
    expect(typeof selectSteps(STEPS, { from: CLOSABLE_STEP, until: GATE_STEP })).toBe("string");
    expect(typeof selectSteps(STEPS, { only: GATE_STEP, from: GATE_STEP })).toBe("string");
    expect((selectSteps(STEPS, { only: GATE_STEP }) as StepDef[]).length).toBe(1);
    const r = selectSteps(STEPS, { from: GATE_STEP, until: NETZERO_STEP }) as StepDef[];
    expect(r[0]!.id).toBe(GATE_STEP);
    expect(r[r.length - 1]!.id).toBe(NETZERO_STEP);
  });
});

describe("W8 battery: coverage", () => {
  const exercised = new Set(STEPS.flatMap(exercisedBy));

  it("every action of the wave's contract (EMCP_WB_Diag) is exercised or NOT_EXERCISED", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W8_CONTRACTS))
      for (const a of contractActions(handler)) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    expect(missing).toEqual([]);
    expect(contractActions("EMCP_WB_Diag").sort()).toEqual(
      ["catalog", "get", "info", "select", "set"].sort(),
    );
  });

  it("every TS-only action of the wave's tools is exercised or NOT_EXERCISED", () => {
    const missing: string[] = [];
    for (const [tool, actions] of Object.entries(TS_ONLY_ACTIONS))
      for (const a of actions) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    expect(missing).toEqual([]);
  });

  it("the TS-only lists are the tools' own action lists", async () => {
    const settings = await import("../../src/tools/wb-settings.js");
    const link = await import("../../src/tools/wb-link.js");
    const menu = await import("../../src/tools/wb-menu.js");
    const gui = await import("../../src/tools/wb-gui.js");
    const scripts = await import("../../src/tools/wb-scripts.js");
    expect([...TS_ONLY_ACTIONS.wb_settings!]).toEqual([...settings.ACTIONS]);
    expect([...TS_ONLY_ACTIONS.wb_link!]).toEqual([...link.ACTIONS]);
    expect([...TS_ONLY_ACTIONS.wb_menu!]).toEqual([...menu.MENU_ACTIONS]);
    expect([...TS_ONLY_ACTIONS.wb_gui!]).toEqual([...gui.ACTIONS]);
    expect(scripts.SCRIPTS_ACTIONS).toContain("status");
  });

  it("NOT_EXERCISED names only actions no step exercises, each with a reason", () => {
    for (const [key, reason] of Object.entries(NOT_EXERCISED)) {
      expect(exercised.has(key), key).toBe(false);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("every probe of the inbox is assigned to a step or not testable with a reason", () => {
    const inbox = readFileSync(
      join(REPO_ROOT, "docs", "v2", "inbox", "w8", "probes.jsonl"),
      "utf-8",
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { id: string }).id);
    expect(PROBE_IDS).toHaveLength(24);
    expect([...inbox].sort()).toEqual([...PROBE_IDS].sort());
    const assigned = new Set(STEPS.flatMap((s) => s.probes));
    for (const id of PROBE_IDS)
      expect(assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10, id).toBe(true);
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of STEPS) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
  });

  it("the engine-accept proof of the offline writer reads the edited value back from the engine", () => {
    const prep = STEPS.find((s) => s.id === "w8-04-profile")!;
    const sets = planOf(prep).filter((a) => a.tool === "wb_settings" && a.toolAction === "set");
    expect(sets.length).toBe(2);
    const accept = STEPS.find((s) => s.id === ACCEPT_STEP)!;
    expect(accept.phase).toBe("live");
    expect(
      planOf(accept).some(
        (a) =>
          a.tool === "wb_gui" &&
          a.toolAction === "read" &&
          (a.params as Raw).rowId === ACCEPT_SETTING.row,
      ),
    ).toBe(true);
    expect(indexOf(ACCEPT_STEP)).toBeGreaterThan(indexOf("w8-30-p02-locator-sweep"));
  });
});

describe("W8 battery: writes stay under _throwaway/W8/", () => {
  it("every declared write lies under _throwaway/W8/", () => {
    for (const s of STEPS) for (const w of s.writes) expect(w.startsWith(W8_ROOT), s.id).toBe(true);
  });

  it("every file-writing tool call in the plan names a file under _throwaway/W8/", () => {
    for (const a of buildActionPlan(STEPS) as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (!FILE_WRITE_ACTIONS.has(key)) continue;
      const p = String(a.params?.path ?? "");
      expect(under(p), `${String(a.step)} ${key} ${p}`).toBe(true);
    }
  });

  it("wb_settings writes name scratch ini files only; no plan entry saves or calls a denied API", () => {
    for (const a of buildActionPlan(STEPS) as Array<Raw & { params?: Raw }>) {
      if (a.kind !== "net-call") continue;
      expect(String(a.target)).not.toMatch(/RunCommandline|Workbench\.(Exit|RunCmd|RunProcess)/);
      expect(String(a.target)).not.toBe("EMCP_WB_Save");
      expect(a.params?.action, String(a.step)).not.toBe("save");
      if (a.tool === "wb_settings" && ["set", "unset", "profile"].includes(String(a.toolAction)))
        expect(String(a.params?.store ?? "")).not.toBe("registry");
    }
    for (const c of offlinePlan(STEPS)) expect(c.tool).not.toBe("wb_world");
  });

  it("the plant makes only folders under _throwaway/W8/", () => {
    for (const d of PLANT_DIRS) expect(d === W8_ROOT || under(d), d).toBe(true);
    expect(PLANT_DIRS).toContain(W8_ROOT);
    expect(under(WORLD)).toBe(true);
  });

  it("the links opened go to modules that own their type (no .et into the World Editor)", () => {
    for (const l of OPEN_LINKS) expect(l).not.toMatch(/\.et(;|$)/);
  });

  it("the W8 plan check refuses a free-name drive, a commit dismiss, a registry write and a save", () => {
    const bad = [
      {
        kind: "net-call",
        target: "x",
        tool: "wb_gui",
        toolAction: "invoke",
        params: { name: "Open" },
      },
      {
        kind: "net-call",
        target: "x",
        tool: "wb_gui",
        toolAction: "dismiss",
        params: { button: "OK" },
      },
      {
        kind: "net-call",
        target: "x",
        tool: "wb_gui",
        toolAction: "invoke",
        params: { rowId: "ui:WorldEditor/menu-item/File/Save" },
      },
      {
        kind: "net-call",
        target: "x",
        tool: "wb_settings",
        toolAction: "set",
        params: { store: "registry" },
      },
      {
        kind: "net-call",
        target: "x",
        tool: "wb_world",
        toolAction: "save",
        params: { action: "save" },
      },
    ] as unknown as PlanAction[];
    const v = w8PlanViolations(bad, policy);
    expect(v.some((x) => x.includes("needs a census row id"))).toBe(true);
    expect(v.some((x) => x.includes('dismiss presses "OK"'))).toBe(true);
    expect(v.some((x) => x.includes("denied label"))).toBe(true);
    expect(v.some((x) => x.includes("registry"))).toBe(true);
    expect(v.some((x) => x.includes("save is never planned"))).toBe(true);
  });
});

describe("W8 battery: w8-50 draws from the proven list (DEC-100)", () => {
  it("menuRunPicks keeps verified World Editor Window rows on both lists, never Manage Layouts", () => {
    const p = loadPolicy();
    const picks = menuRunPicks(
      loadMenuItems(),
      loadAllowListFile(),
      p.execute_action?.allow_list ?? [],
      p.execute_action?.dialog_openers ?? [],
    );
    expect(picks.length).toBeGreaterThan(0);
    const pack = loadAllowListFile();
    for (const i of picks) {
      expect(i.verified, i.path).toBe(true);
      expect(i.module).toBe("WorldEditor");
      expect(isAllowListed(pack, i.segments), i.path).toBe(true);
    }
    expect(picks.some((i) => i.path === "Window,Manage Layouts")).toBe(false);
    // an unverified item or a dialog opener is never drawn, even when listed
    const ml = {
      module: "WorldEditor",
      path: "Window,Manage Layouts",
      segments: ["Window", "Manage Layouts"],
      risk: "safe",
      verified: true,
      opensDialog: false,
    };
    const fake = { paths: [ml.segments, ["Window", "X"]], denyLabels: [], denyWords: [] };
    const allow = [ml.segments, ["Window", "X"]];
    expect(menuRunPicks([ml], fake, allow, [ml.segments])).toEqual([]);
    const x = { ...ml, path: "Window,X", segments: ["Window", "X"], verified: false };
    expect(menuRunPicks([x], fake, allow)).toEqual([]);
    expect(menuRunPicks([{ ...x, verified: true }], fake, allow)).toHaveLength(1);
  });
});

describe("W8 battery: the offline helpers", () => {
  it("carriesForceSettings reads the launch command line", () => {
    const ini = "C:\\a\\settings\\scratch\\w8.ini";
    expect(carriesForceSettings(`"wb.exe" -gproj x.gproj -forceSettings "${ini}"`, ini)).toBe(true);
    expect(carriesForceSettings("wb.exe -gproj x.gproj", ini)).toBe(false);
    expect(carriesForceSettings("wb.exe -forceSettings C:\\other.ini", ini)).toBe(false);
  });

  it("chordValues finds key chords in a reg export", () => {
    const text =
      '[HKEY_CURRENT_USER\\Software\\X\\Shortcuts]\r\n"Undo"="Ctrl+Z"\r\n"Name"="plain"\r\n';
    expect(chordValues(text)).toEqual(["HKEY_CURRENT_USER\\Software\\X\\Shortcuts\\Undo"]);
    expect(chordValues('"Name"="plain"')).toEqual([]);
  });

  it("indexCallers names the file of a JSON line", () => {
    const hits = indexCallers(
      '{"file":"scripts/a.c","text":"Workbench.SavePixelRawData(x)"}\nnothing',
    );
    expect(hits).toEqual([{ where: "scripts/a.c", token: "SavePixelRawData" }]);
  });

  it("diagValues reads pairs, name=value and maps", () => {
    expect(diagValues({ ok: true, readback: { values: ["A=1", "B=0"] } }).get("B")).toBe("0");
    expect(diagValues({ ok: true, readback: { values: { A: 1 } } }).get("A")).toBe("1");
    expect(diagValues({ ok: true, readback: { values: ["A", "1"] } }).get("A")).toBe("1");
  });

  it("firstResourcePath drops the GUID, skips unregistered empties and throwaway files (W2 run 1)", () => {
    const r = {
      ok: true,
      readback: {
        items: ["", "{C984F03E1A9A14A0}_throwaway/W2/W2_cfg.conf", "{0123456789ABCDEF}UI/a.layout"],
      },
    };
    expect(firstResourcePath(r)).toBe("UI/a.layout");
    expect(firstResourcePath({ ok: true, readback: { items: [""] } })).toBe("");
    expect(firstResourcePath(null)).toBe("");
  });

  it("the fixture graph's two nodes sit close together (W8 run 8: the graph fit at 5 percent zoom)", () => {
    const adds = FIXTURE_GRAPH_CALLS.filter(([, a]) => a.op === "addNode" && a.confirm === true);
    expect(adds.map(([, a]) => a.name)).toEqual(["EMCP_W8_Pose", "EMCP_W8_Queue"]);
    expect(adds.map(([, a]) => a.editorPos)).toEqual([
      [0, 0],
      [200, 0],
    ]);
    // the dry run previews the same first node
    const dry = FIXTURE_GRAPH_CALLS.find(([k]) => k === "addNodeDry")![1];
    expect(dry.editorPos).toEqual([0, 0]);
  });

  it("firstResourcePath skips `$name:` filesystem-prefixed hits (W8 run 8: `$profile:` refused ABSOLUTE_PATH)", () => {
    const r = {
      ok: true,
      readback: {
        items: [
          "$profile:.save/a.conf",
          "{0123456789ABCDEF}$somefs:Configs/b.conf",
          "{0123456789ABCDEF}Configs/c.conf",
        ],
      },
    };
    expect(firstResourcePath(r)).toBe("Configs/c.conf");
    expect(
      firstResourcePath({
        ok: true,
        readback: { results: [{ path: "$profile:x.conf" }, { name: "$somefs:y.conf" }] },
      }),
    ).toBe("");
  });

  it("flipSetting, toggleAsSetting and settingBool read the accept value", () => {
    expect(flipSetting("true")).toBe("false");
    expect(flipSetting("false")).toBe("true");
    expect(flipSetting("0")).toBe("1");
    expect(flipSetting(null)).toBe("true");
    expect(toggleAsSetting("On")).toBe("true");
    expect(toggleAsSetting("Off")).toBe("false");
    expect(toggleAsSetting("Indeterminate")).toBeNull();
    expect(settingBool("1")).toBe("true");
    expect(settingBool("x")).toBeNull();
  });

  it("the FAIL counter counts per step in an independent block, per block elsewhere", () => {
    expect(failUnitOf({ id: "w8-10-settings-read", block: "W8.1" })).toBe(
      "W8.1/w8-10-settings-read",
    );
    expect(failUnitOf({ id: "w8-40-p01-dock-toggles", block: "W8.4" })).toBe("W8.4");
  });
});

// ── plant and rollback (offline io in memory) ──

function memIo(
  seed: string[] = [],
  pids: number[] = [],
): OfflineIo & {
  files: Map<string, Buffer>;
  dirs: Set<string>;
  logs: string[];
} {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const logs: string[] = [];
  const n = (p: string): string => p.replace(/\\/g, "/");
  for (const s of seed) files.set(n(s), Buffer.from("x"));
  const isUnder = (k: string, p: string): boolean => k.startsWith(`${n(p)}/`);
  return {
    files,
    dirs,
    logs,
    workbenchPids: () => pids,
    exists: (p) =>
      files.has(n(p)) || dirs.has(n(p)) || [...files.keys(), ...dirs].some((k) => isUnder(k, p)),
    listDir: (p) => [
      ...new Set(
        [...files.keys(), ...dirs]
          .filter((k) => isUnder(k, p))
          .map((k) => k.slice(n(p).length + 1).split("/")[0]!),
      ),
    ],
    listTree: (p) =>
      [...files.keys()].filter((k) => isUnder(k, p)).map((k) => k.slice(n(p).length + 1)),
    readBytes: (p) => {
      const b = files.get(n(p));
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    writeBytes: (p, b) => void files.set(n(p), b),
    removeTree: (p) => {
      for (const k of [...files.keys()]) if (k === n(p) || isUnder(k, p)) files.delete(k);
      for (const k of [...dirs]) if (k === n(p) || isUnder(k, p)) dirs.delete(k);
    },
    makeDir: (p) => void dirs.add(n(p)),
    log: (l) => void logs.push(l),
  };
}

const SB = "C:/s/EMCP2_sandbox";
const SIT = "C:/sit";

describe("W8 battery: plant and rollback", () => {
  it("plant is a dry run without --really and writes nothing", () => {
    const io = memIo();
    expect(runPlant(SB, SIT, false, io)).toBe(EXIT.done);
    expect(io.files.size + io.dirs.size).toBe(0);
    expect(io.logs.join("\n")).toContain("dry run");
  });

  it("plant makes the folders and the record; refuses while Workbench runs or when planted", () => {
    const io = memIo();
    expect(runPlant(SB, SIT, true, io)).toBe(EXIT.done);
    for (const d of PLANT_DIRS) expect(io.dirs.has(`${SB}/${d}`)).toBe(true);
    for (const d of io.dirs) expect(d.startsWith(`${SB}/${W8_ROOT}`)).toBe(true);
    const rec = JSON.parse(io.files.get(`${SIT}/${PLANT_FILE}`)!.toString()) as Raw;
    expect(rec.throwawayExistedBefore).toBe(false);
    // Followups item 1: the seed graph is written, and the record names every fixture.
    for (const f of PLANT_FILES) expect(io.files.get(`${SB}/${f.rel}`)?.toString()).toBe(f.text);
    expect(rec.files).toEqual(PLANT_FILES.map((f) => f.rel));
    expect((rec.fixtures as Raw[]).map((f) => f.kind)).toEqual([
      "entity",
      "animation",
      "behavior-tree",
    ]);
    expect(rec.entities).toEqual([]);
    expect(runPlant(SB, SIT, true, io)).toBe(EXIT.refused);
    expect(runPlant(SB, SIT, true, memIo([], [77]))).toBe(EXIT.refused);
  });

  it("rollback is a dry run without --really and lists nothing when absent", () => {
    const io = memIo();
    expect(runRollback(SB, SIT, false, io)).toBe(EXIT.done);
    expect(io.logs.join("\n")).toContain("nothing to roll back");
    const io2 = memIo([`${SB}/${WORLD}`]);
    expect(runRollback(SB, SIT, false, io2)).toBe(EXIT.done);
    expect(io2.files.has(`${SB}/${WORLD}`)).toBe(true);
    expect(io2.logs.join("\n")).toContain("dry run");
  });

  it("rollback removes _throwaway/W8/ only, and _throwaway/ only when the plant made it", () => {
    const io = memIo([`${SB}/${WORLD}`, `${SB}/_throwaway/W2/keep.conf`, `${SB}/other.conf`]);
    io.files.set(`${SIT}/${PLANT_FILE}`, Buffer.from('{"throwawayExistedBefore":false}'));
    expect(runRollback(SB, SIT, true, io)).toBe(EXIT.done);
    expect(io.files.has(`${SB}/${WORLD}`)).toBe(false);
    expect(io.files.has(`${SB}/_throwaway/W2/keep.conf`)).toBe(true);
    expect(io.files.has(`${SB}/other.conf`)).toBe(true);
    expect(io.files.has(`${SIT}/throwaway-w8-listing.json`)).toBe(true);
    const lone = memIo([`${SB}/${WORLD}`]);
    lone.files.set(`${SIT}/${PLANT_FILE}`, Buffer.from('{"throwawayExistedBefore":true}'));
    lone.dirs.add(`${SB}/_throwaway`);
    expect(runRollback(SB, SIT, true, lone)).toBe(EXIT.done);
    expect(lone.dirs.has(`${SB}/_throwaway`)).toBe(true);
    expect(runRollback(SB, SIT, true, memIo([`${SB}/${WORLD}`], [9]))).toBe(EXIT.refused);
  });
});

// ── runBattery over fake deps (an in-memory file system, no Workbench) ──

function memFs(): Pick<W8Deps, "exists" | "readBytes" | "writeBytes" | "listTree"> & {
  files: Map<string, Buffer>;
} {
  const files = new Map<string, Buffer>();
  const n = (p: string): string => p.replace(/\\/g, "/");
  return {
    files,
    exists: (p) => files.has(n(p)) || [...files.keys()].some((k) => k.startsWith(`${n(p)}/`)),
    readBytes: (p) => {
      const b = files.get(n(p));
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    writeBytes: (p, b) => void files.set(n(p), b),
    listTree: (dir) =>
      [...files.keys()]
        .filter((k) => k.startsWith(`${n(dir)}/`))
        .map((k) => k.slice(n(dir).length + 1))
        .sort(),
  };
}

function fakeDeps(
  over: Partial<W8Deps> = {},
  fs = memFs(),
): W8Deps & { files: Map<string, Buffer>; logs: string[] } {
  const logs: string[] = [];
  return {
    ...fs,
    logs,
    tool: async (_n: W8Tool): Promise<ToolResponse> => ({ ok: true, readback: {} }),
    info: async () => ({ projectFound: true, projectName: SANDBOX_NAME }),
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async () => [],
    recordedPid: () => 4242,
    commandLine: async () => '"wb.exe" -forceSettings "C:/art/settings/scratch/w8-accept.ini"',
    workbenchPids: () => [],
    registryExport: async () => ({ ok: true, sha256: "h", path: "C:/art/x.reg", text: "" }),
    backlog: async () => ({
      firstOk: true,
      firstMs: 10,
      firstCode: null,
      secondOk: true,
      secondMs: 5,
      secondCode: null,
      secondRefused: false,
    }),
    censusRows: () => new Map(),
    locators: () => new Map(),
    menuItems: () => [],
    menuAllowList: () => ({ paths: [] }) as unknown as ReturnType<W8Deps["menuAllowList"]>,
    diagNames: () => null,
    setAllowList: () => [],
    rowsEnabled: () => [],
    sourceIndexPath: () => null,
    profileListing: () => [],
    userName: () => "someone",
    artifactsRoot: () => "C:/art",
    now: () => Date.parse("2026-11-12T00:00:00Z"),
    sleep: async () => undefined,
    log: (l) => void logs.push(l),
    ...over,
  };
}

function opts(over: Partial<W8Options> = {}): W8Options {
  return {
    runDir: "C:/sit/run-1",
    sittingDir: "C:/sit",
    sandboxDir: "C:/sb/EMCP2_sandbox",
    evidenceDir: null,
    ph: defaultPlaceholderContext({ v2: REPO_ROOT }),
    build: "1.9.0.37",
    ...over,
  };
}

/** The prep record and the planted folders a live run needs. */
function plantedPrep(deps: W8Deps, prepOver: Raw = {}): void {
  deps.writeBytes(join("C:/sit", PREP_FILE), prepJson(prepOver));
  deps.writeBytes(
    join("C:/sb/EMCP2_sandbox", "_throwaway", "W8", "worlds", ".keep"),
    Buffer.from(""),
  );
  // The plant's other folders (followups item 1): the seed graph and the tree folder.
  deps.writeBytes(join("C:/sb/EMCP2_sandbox", ...ANIM_AGF.split("/")), Buffer.from(AGF_SEED));
  deps.writeBytes(join("C:/sb/EMCP2_sandbox", ...AI_DIR.split("/"), ".keep"), Buffer.from(""));
}

const step = (id: string): StepDef => STEPS.find((s) => s.id === id)!;

describe("W8 battery: runBattery over fake deps", () => {
  it("a prep step refuses while a Workbench image runs", async () => {
    const deps = fakeDeps({ workbenchPids: () => [99] });
    const r = await runBattery([step("w8-01-p21-callers")], deps, opts({ runDir: "C:/sit/prep" }));
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.status).toBe("STOPPED");
  });

  it("the gate aborts on a project that is not the test bed", async () => {
    const deps = fakeDeps({
      info: async () => ({ projectFound: true, projectName: "SomethingElse" }),
    });
    plantedPrep(deps);
    const r = await runBattery([step(GATE_STEP)], deps, opts());
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.records[0]!.status).toBe("ABORTED");
  });

  it("the gate stops when the planted folders are absent (nothing is sent past it)", async () => {
    const deps = fakeDeps();
    deps.writeBytes(join("C:/sit", PREP_FILE), prepJson());
    const r = await runBattery([step(GATE_STEP), step("w8-06-world")], deps, opts());
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.detail).toContain("plant");
    expect(r.records.some((x) => x.step === "w8-06-world")).toBe(false);
  });

  it("the gate stops when the process does not carry the prep scratch ini", async () => {
    const deps = fakeDeps({ commandLine: async () => "wb.exe -gproj x.gproj" });
    plantedPrep(deps);
    const r = await runBattery([step(GATE_STEP)], deps, opts());
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.detail).toContain("-forceSettings");
  });

  it("the gate passes on the test bed with the prep ini and takes the snapshot", async () => {
    const deps = fakeDeps();
    plantedPrep(deps);
    deps.writeBytes("C:/sb/EMCP2_sandbox/EMCP2_sandbox.gproj", Buffer.from("g"));
    const r = await runBattery([step(GATE_STEP)], deps, opts());
    expect(r.records[0]!.status).toBe("PASS");
    expect(r.exit).toBe(EXIT.done);
    const snap = JSON.parse(deps.files.get("C:/sit/w8-battery-snapshot.json")!.toString()) as {
      files: Raw;
    };
    expect(Object.keys(snap.files)).toContain("EMCP2_sandbox.gproj");
    expect(Object.keys(snap.files).some((f) => f.startsWith(W8_ROOT))).toBe(false);
  });

  it("a run that starts past the gate (--from/--only) takes the snapshot itself", async () => {
    const deps = fakeDeps();
    plantedPrep(deps);
    deps.writeBytes("C:/sb/EMCP2_sandbox/a.conf", Buffer.from("a"));
    expect(deps.exists("C:/sit/w8-battery-snapshot.json")).toBe(false);
    await runBattery([step("w8-23-scripts-status")], deps, opts());
    expect(deps.exists("C:/sit/w8-battery-snapshot.json")).toBe(true);
  });

  it("a resumed step creates the throwaway world when it is absent, and never opens one not on disk", async () => {
    const sent: Raw[] = [];
    const deps = fakeDeps({
      tool: async (n, a) => {
        sent.push({ n, ...a });
        if (n === "wb_world" && a.action === "state")
          return { ok: true, readback: { mode: "edit", worldPath: "" } };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-70-p12-tool-panels")], deps, opts());
    const news = sent.filter((x) => x.n === "wb_world" && x.action === "new");
    expect(news.map((x) => x.confirm ?? false)).toEqual([false, true]);
    expect(news.every((x) => x.path === WORLD)).toBe(true);
    // the fake never writes the world, so it is not on disk: setResource is never sent for it
    expect(sent.some((x) => x.n === "wb_module" && x.action === "setResource")).toBe(false);
    expect(r.records[0]!.status).toBe("FAIL");
  });

  it("a LOST client code stops the battery at once and is not retried", async () => {
    let calls = 0;
    const deps = fakeDeps({
      tool: async () => {
        calls++;
        return { ok: false, code: "LOST", message: "socket closed" };
      },
    });
    plantedPrep(deps);
    const r = await runBattery(
      [step("w8-23-scripts-status"), step("w8-21-diag-catalog")],
      deps,
      opts(),
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(calls).toBe(1);
    expect(r.records.map((x) => x.status)).toEqual(["STOPPED"]);
  });

  it("MODAL_OPEN is a HANDOFF naming the answer, never Save", async () => {
    const deps = fakeDeps({
      tool: async () => ({ ok: false, code: "MODAL_OPEN", message: 'dialog "Loading world"' }),
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-23-scripts-status")], deps, opts());
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).toMatch(/No \/ Don't Save/);
  });

  it("FAILs across an independent block's steps never add up to a stop", async () => {
    const deps = fakeDeps({
      tool: async () => ({ ok: false, code: "HANDLER_ERROR", message: "x" }),
    });
    plantedPrep(deps);
    const r = await runBattery(
      [step("w8-10-settings-read"), step("w8-11-link-offline"), step("w8-12-menu-offline")],
      deps,
      opts(),
    );
    expect(r.records.map((x) => x.status)).toEqual(["FAIL", "FAIL", "FAIL"]);
    expect(r.exit).toBe(EXIT.refused);
    expect(r.stoppedAt).toBeNull();
  });

  it("--skip-hand records the hand steps HELD and sends nothing for them", async () => {
    let calls = 0;
    const deps = fakeDeps({
      tool: async () => {
        calls++;
        return { ok: true, readback: {} };
      },
    });
    const hands = STEPS.filter((s) => s.hand);
    const r = await runBattery(hands, deps, opts({ skipHand: true }));
    expect(r.records.every((x) => x.status === "HELD")).toBe(true);
    expect(calls).toBe(0);
  });

  it("a hand step prints one HAND REQUEST line with the run folder and the full answer path", async () => {
    const deps = fakeDeps();
    const key = "w8-95-gestures";
    const f = handFiles("C:/sit/run-1", key);
    deps.writeBytes(
      f.answer,
      Buffer.from(JSON.stringify({ gestures: [{ canvas: "a", acted: true, undone: true }] })),
    );
    const r = await runBattery([step("w8-95-p18-canvas-gestures")], deps, opts());
    const line = deps.logs.find((l) => l.startsWith(`HAND REQUEST ${key}`))!;
    expect(line).toContain("run folder: C:/sit/run-1");
    expect(line).toContain(f.answer);
    expect(deps.exists(f.request)).toBe(true);
    expect(r.records[0]!.probes[0]!.id).toBe("P-W8-18");
  });

  it("the reload-with-No hand step comes right before w8-98 and its HAND REQUEST names the save prompt (W8 run 8)", async () => {
    expect(indexOf(RELOAD_NO_STEP)).toBe(indexOf(CLOSABLE_STEP) - 1);
    expect(step(RELOAD_NO_STEP).hand).toBe(true);
    expect(step(RELOAD_NO_STEP).block).toBe("W8.H");
    expect(RELOAD_NO_INSTRUCTION).toContain('window "Loading world"');
    expect(RELOAD_NO_INSTRUCTION).toContain('text "Do you want to save changes?"');
    expect(RELOAD_NO_INSTRUCTION).toContain("Press No");
    expect(RELOAD_NO_INSTRUCTION).toContain(WORLD);
    let listed = 1;
    const sent: string[] = [];
    const deps = fakeDeps({
      tool: async (n, a) => {
        sent.push(`${n}.${String(a.action ?? "")}`);
        if (n === "wb_world") return { ok: true, readback: { mode: "edit", worldPath: WORLD } };
        if (n === "wb_entity")
          return {
            ok: true,
            readback: { rows: listed ? [{ id: "id:0x3", name: FIXTURE_ENTITY.name }] : [] },
          };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const f = handFiles("C:/sit/run-1", RELOAD_NO_KEY);
    deps.writeBytes(f.answer, Buffer.from('{"prompt":true,"pressed":"No","reloaded":true}'));
    // the edits discarded: the fixture is gone after the reload
    listed = 0;
    const r = await runBattery([step(RELOAD_NO_STEP)], deps, opts());
    const line = deps.logs.find((l) => l.startsWith(`HAND REQUEST ${RELOAD_NO_KEY}`))!;
    expect(line).toContain("Do you want to save changes?");
    expect(line).toContain("Loading world");
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    expect(sent).not.toContain("wb_entity.delete");
    expect(sent.some((s) => s.startsWith("wb_save") || s === "wb_world.save")).toBe(false);
    // a fixture still listed after the reload is a FAIL
    listed = 1;
    deps.writeBytes(
      handFiles("C:/sit/run-2", RELOAD_NO_KEY).answer,
      Buffer.from('{"prompt":true,"pressed":"No","reloaded":true}'),
    );
    const r2 = await runBattery([step(RELOAD_NO_STEP)], deps, opts({ runDir: "C:/sit/run-2" }));
    expect(r2.records[0]!.status).toBe("FAIL");
    expect(r2.records[0]!.detail).toContain("still listed");
  });

  it("the owner picks are BLOCKED as blocked:OI-W8-6 without --owner-present", async () => {
    const deps = fakeDeps();
    const r = await runBattery([step("w8-91-picks")], deps, opts());
    expect(r.records[0]!.status).toBe("BLOCKED");
    expect(r.records[0]!.detail).toContain("blocked:OI-W8-6");
    expect(deps.exists(handFiles("C:/sit/run-1", "w8-91-picks").request)).toBe(false);
  });

  it("a step whose probe was KILLED in an earlier run of the sitting is SKIPPED, the battery goes on", async () => {
    const deps = fakeDeps();
    plantedPrep(deps);
    deps.writeBytes(
      recordPath("C:/sit/run-0", "w8-30-p02-locator-sweep"),
      Buffer.from(
        JSON.stringify({
          step: "w8-30-p02-locator-sweep",
          status: "KILLED",
          probes: [{ id: "P-W8-02", result: "KILLED", observed: {}, note: "under 90" }],
        }),
      ),
    );
    const r = await runBattery(
      [step("w8-40-p01-dock-toggles"), step("w8-23-scripts-status")],
      deps,
      opts(),
    );
    expect(r.records[0]!.status).toBe("SKIPPED");
    expect(r.records[0]!.detail).toContain("P-W8-02");
    expect(r.records[1]!.status).toBe("PASS");
  });

  /** A w8-30 record with one P-W8-02 verdict (run 4's shapes). */
  const sweepRecord = (result: string, startedAt: string): Buffer =>
    Buffer.from(
      JSON.stringify({
        step: "w8-30-p02-locator-sweep",
        status: result === "KILLED" ? "KILLED" : "PASS",
        startedAt,
        probes: [{ id: "P-W8-02", result, observed: {}, note: `${result} at ${startedAt}` }],
      }),
    );

  it("fix-up 3: a later SETTLED of the owning step supersedes its earlier KILL (run 4)", async () => {
    const deps = fakeDeps();
    plantedPrep(deps);
    // Run 4: the first pass KILLED P-W8-02; --only w8-30 in a new run folder SETTLED it.
    deps.writeBytes(
      recordPath("C:/sit/run-2026-11-12T15-09-20-798Z", "w8-30-p02-locator-sweep"),
      sweepRecord("KILLED", "2026-11-12T15:09:34.007Z"),
    );
    deps.writeBytes(
      recordPath("C:/sit/run-2026-11-12T15-11-26-413Z", "w8-30-p02-locator-sweep"),
      sweepRecord("SETTLED", "2026-11-12T15:11:26.417Z"),
    );
    const k = killedProbes(
      ["C:/sit/run-2026-11-12T15-09-20-798Z", "C:/sit/run-2026-11-12T15-11-26-413Z"],
      deps,
      STEPS,
    );
    expect(k.has("P-W8-02")).toBe(false);
    const r = await runBattery([step("w8-40-p01-dock-toggles")], deps, opts());
    expect(r.records[0]!.status).not.toBe("SKIPPED");
  });

  it("fix-up 3: the reverse, a later KILL supersedes an earlier SETTLED; the time orders, not the folder name", async () => {
    const deps = fakeDeps();
    // The later verdict sits in a folder whose name sorts first (a --run-dir of any name).
    deps.writeBytes(
      recordPath("C:/sit/a-rerun", "w8-30-p02-locator-sweep"),
      sweepRecord("KILLED", "2026-11-12T16:00:00.000Z"),
    );
    deps.writeBytes(
      recordPath("C:/sit/run-2026-11-12T15-00-00-000Z", "w8-30-p02-locator-sweep"),
      sweepRecord("SETTLED", "2026-11-12T15:00:00.000Z"),
    );
    const k = killedProbes(["C:/sit/a-rerun", "C:/sit/run-2026-11-12T15-00-00-000Z"], deps, STEPS);
    expect(k.get("P-W8-02")).toBe(
      "P-W8-02 KILLED in w8-30-p02-locator-sweep: KILLED at 2026-11-12T16:00:00.000Z",
    );
  });

  it("fix-up 3: w8-82 reads the mode before wb_play, and a refused play names wb_play's answer", async () => {
    const sent: string[] = [];
    const deps = fakeDeps({
      diagNames: () => ({ script: ["DEBUGUI_A"] }) as unknown as ReturnType<W8Deps["diagNames"]>,
      tool: async (n, a) => {
        sent.push(`${n}${a.action ? `.${String(a.action)}` : ""}`);
        if (n === "wb_play")
          return {
            ok: false,
            code: null,
            message:
              "Cannot start play mode: Workbench mode is unknown. Call `wb_state` first to confirm edit mode.\n\n---\n`Workbench: connected (mode unknown)`",
          } as unknown as ToolResponse;
        if (n === "wb_world") return { ok: true, readback: { mode: "edit" } };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-82-p07-diag-play")], deps, opts());
    expect(sent.indexOf("wb_world.state")).toBeGreaterThanOrEqual(0);
    expect(sent.indexOf("wb_world.state")).toBeLessThan(sent.indexOf("wb_play"));
    expect(r.records[0]!.status).toBe("FAIL");
    expect(r.records[0]!.detail).toContain("wb_play answered");
    expect(r.records[0]!.detail).toContain("mode is unknown");
    expect(r.records[0]!.detail).not.toContain("\n");
  });

  it("a step never runs twice in one run folder", async () => {
    const deps = fakeDeps();
    deps.writeBytes(recordPath("C:/sit/run-1", "w8-23-scripts-status"), Buffer.from("{}"));
    const r = await runBattery([step("w8-23-scripts-status")], deps, opts());
    expect(r.exit).toBe(EXIT.refused);
  });

  it("P-W8-06 is KILLED when the export holds no chord, and shortcuts GATED is not a FAIL", async () => {
    const deps = fakeDeps({
      tool: async (n) =>
        n === "wb_settings" ? { ok: false, code: "GATED", message: "P-W8-06" } : { ok: true },
    });
    const r = await runBattery(
      [step("w8-02-p06-shortcuts")],
      deps,
      opts({ runDir: "C:/sit/prep" }),
    );
    expect(r.records[0]!.status).toBe("KILLED");
    expect(r.records[0]!.probes[0]!.id).toBe("P-W8-06");
  });

  it("prep writes the accept edit into a new ini and names it as the launch's", async () => {
    const sent: Raw[] = [];
    const fs = memFs();
    const deps = fakeDeps(
      {
        tool: async (n, a) => {
          sent.push({ n, ...a });
          if (a.action === "profile")
            return a.confirm
              ? (fs.writeBytes("C:/art/settings/scratch/w8.ini", Buffer.from("i")),
                { ok: true, readback: { forceSettings: "C:/art/settings/scratch/w8.ini" } })
              : { ok: true, readback: { dryRun: true } };
          if (a.action === "get")
            return { ok: true, readback: { value: a.store === "w8" ? "false" : "true" } };
          if (a.action === "set")
            return a.confirm
              ? (fs.writeBytes("C:/art/settings/scratch/w8-accept.ini", Buffer.from("j")),
                { ok: true, readback: { forceSettings: "C:/art/settings/scratch/w8-accept.ini" } })
              : { ok: true, readback: { dryRun: true } };
          return { ok: true, readback: {} };
        },
      },
      fs,
    );
    const r = await runBattery(
      [step("w8-04-profile")],
      deps,
      opts({ runDir: "C:/sit/prep", profile: "w8" }),
    );
    expect(r.records[0]!.status).toBe("PASS");
    const rec = JSON.parse(deps.files.get(`C:/sit/${PREP_FILE}`)!.toString()) as Raw;
    expect(rec.forceSettings).toBe("C:/art/settings/scratch/w8-accept.ini");
    expect((rec.accept as Raw).after).toBe("true");
    expect((rec.accept as Raw).before).toBe("false");
    const set = sent.filter((x) => x.action === "set");
    expect(set.map((x) => x.confirm ?? false)).toEqual([false, true]);
    expect(set.every((x) => x.path === "w8" && x.name === `w8${ACCEPT_SUFFIX}`)).toBe(true);
  });

  it("the accept step PASSes when the engine shows the edited value, FAILs on the other", async () => {
    const run = async (toggleState: string): Promise<string> => {
      const deps = fakeDeps({
        tool: async (n, a) => {
          if (n === "wb_settings")
            return { ok: true, readback: { value: a.store ? "true" : "false" } };
          if (n === "wb_gui") return { ok: true, readback: { toggleState } };
          return { ok: true, readback: {} };
        },
      });
      plantedPrep(deps, {
        accept: {
          section: ACCEPT_SETTING.section,
          key: ACCEPT_SETTING.key,
          from: "w8.ini",
          ini: "w8-accept.ini",
          before: "false",
          after: "true",
        },
      });
      const r = await runBattery([step(ACCEPT_STEP)], deps, opts());
      return `${r.records[0]!.status} ${r.records[0]!.detail}`;
    };
    expect(await run("On")).toMatch(/^PASS .*registry holds false/);
    expect(await run("Off")).toMatch(/^FAIL /);
  });

  it("the accept step is NOT-RUN with the switch while the row has no 1.9 locator", async () => {
    const deps = fakeDeps({
      tool: async (n) =>
        n === "wb_gui"
          ? { ok: false, code: "NO_LOCATOR", message: "no locator" }
          : { ok: true, readback: { value: "true" } },
    });
    plantedPrep(deps, {
      accept: {
        section: ACCEPT_SETTING.section,
        key: ACCEPT_SETTING.key,
        from: "w8.ini",
        ini: "w8-accept.ini",
        before: "false",
        after: "true",
      },
    });
    const r = await runBattery([step(ACCEPT_STEP)], deps, opts());
    expect(r.records[0]!.status).toBe("NOT-RUN");
    expect(r.records[0]!.detail).toContain("NO_LOCATOR");
  });

  it("the post-check fails when the registry hash moved", async () => {
    const deps = fakeDeps({
      registryExport: async () => ({ ok: true, sha256: "moved", path: "x", text: "" }),
    });
    deps.writeBytes(join("C:/sit", PREP_FILE), prepJson());
    deps.writeBytes(
      join("C:/sit", "w8-battery-snapshot.json"),
      Buffer.from(JSON.stringify({ kind: "w8-battery-snapshot", taken_at: "t", files: {} })),
    );
    const r = await runBattery([step(POSTCHECK_STEP)], deps, opts({ runDir: "C:/sit/post-1" }));
    expect(r.records[0]!.status).toBe("FAIL");
    expect(r.records[0]!.detail).toContain("registry");
  });

  it("net-zero: changes under _throwaway/W8/ are no change; resourceDatabase.rdb is recorded", async () => {
    const deps = fakeDeps({
      tool: async (n) =>
        n === "wb_world" ? { ok: true, readback: { mode: "edit" } } : { ok: true, readback: {} },
    });
    plantedPrep(deps);
    deps.writeBytes("C:/sb/EMCP2_sandbox/resourceDatabase.rdb", Buffer.from("1"));
    deps.writeBytes(
      join("C:/sit", "w8-battery-snapshot.json"),
      Buffer.from(
        JSON.stringify({
          kind: "w8-battery-snapshot",
          taken_at: "t",
          files: { "resourceDatabase.rdb": "old" },
        }),
      ),
    );
    deps.writeBytes(`C:/sb/EMCP2_sandbox/${WORLD}`, Buffer.from("w"));
    const r = await runBattery([step(NETZERO_STEP)], deps, opts());
    expect(r.records[0]!.status).toBe("PASS");
    const ev = r.records[0]!.evidence as { diff: { tolerated: string[]; changed: string[] } };
    expect(ev.diff.tolerated).toEqual(["resourceDatabase.rdb"]);
    expect(ev.diff.changed).toEqual([]);
  });
});

describe("W8 fix-up 1: the play-mode transition (w8-82, run 2)", () => {
  const win = (over: Partial<WindowInfo>): WindowInfo => ({
    hwnd: 1,
    pid: 4242,
    className: "Qt683QWindowIcon",
    title: "Enfusion Workbench",
    owner: 0,
    enabled: true,
    rect: [0, 0, 10, 10],
    monitor: [0, 0, 10, 10],
    primary: true,
    ...over,
  });
  const MAIN = [
    win({ hwnd: 1, title: "Enfusion Workbench - EMCP2 sandbox (2.0 live lane)" }),
    win({ hwnd: 2, title: "World Editor - EMCP2_sandbox/_throwaway/W8/worlds/EMCP_W8_Tiny.ent" }),
  ];
  /** Run 2's change: both titled main windows disabled, no window added. */
  const PLAY = MAIN.map((w) => ({ ...w, enabled: false }));

  /** Deps whose windows read MAIN, then `busy` reads of PLAY from the first tool call on. */
  function playDeps(busy: number): ReturnType<typeof fakeDeps> {
    let left = -1;
    const deps = fakeDeps({
      tool: async () => {
        if (left < 0) left = busy;
        return { ok: true, readback: {} };
      },
      windows: async () => {
        if (left > 0) {
          left--;
          return PLAY;
        }
        return MAIN;
      },
    });
    plantedPrep(deps);
    return deps;
  }

  it("every polled step watches with the W5 busy-window grace", () => {
    expect(WATCH_OPTIONS).toEqual({ popups: false, busyGraceMs: BUSY_GRACE_MS });
  });

  it("the main windows disabled for a few polls are waited out, not a handoff", async () => {
    const deps = playDeps(5);
    const r = await runBattery([step("w8-23-scripts-status")], deps, opts());
    expect(r.records[0]!.status, r.records[0]!.detail).not.toBe("HANDOFF");
    expect(r.exit).not.toBe(EXIT.handoff);
  });

  it("the same windows past the grace are a handoff that says so", async () => {
    const deps = playDeps(Number.MAX_SAFE_INTEGER);
    const r = await runBattery([step("w8-23-scripts-status")], deps, opts());
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).toMatch(/past the 60000 ms grace/);
  });

  it("w8-82 is a polled step (neither hand nor dialog), so the grace applies to it", () => {
    const s = step("w8-82-p07-diag-play");
    expect(s.hand ?? false).toBe(false);
    expect(s.dialog ?? false).toBe(false);
  });
});

describe("W8 fix-up 1: the P-W8-02 sweep (run 2: 130/698)", () => {
  const MAIN_ID = "Arma4WorkbenchApp.worldEditorMain";
  /** Three levels: the window, a dock, its contents, a button (deeper than the 2-level outline). */
  const deep = {
    controlType: "Window",
    name: "World Editor - x",
    automationId: MAIN_ID,
    children: [
      {
        controlType: "Window",
        name: "Hierarchy",
        automationId: `${MAIN_ID}.entityTreeDock`,
        children: [
          {
            controlType: "Group",
            name: "",
            automationId: `${MAIN_ID}.entityTreeDock.hierarchyDockContents`,
            children: [
              {
                controlType: "Button",
                name: "",
                automationId: `${MAIN_ID}.entityTreeDock.hierarchyDockContents.entityFilterButton`,
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
  const outline = { ...deep, children: [{ ...deep.children[0]!, children: [] }] };
  const FILE = "gui/tree-pid4242-x.json";

  it("treeOf reads the saved tree under the artifacts folder and never takes the outline", () => {
    const fs = memFs();
    const deps = { ...fs, artifactsRoot: () => "C:/art" };
    fs.writeBytes("C:/art/gui/tree-pid4242-x.json", Buffer.from(JSON.stringify({ tree: deep })));
    const answer = {
      ok: true,
      readback: { file: FILE, relativeTo: "artifacts", outline },
    } as unknown as ToolResponse;
    expect(treeOf(answer, deps)).toEqual(deep);
    const noFile = {
      ok: true,
      readback: { file: "gui/missing.json", relativeTo: "artifacts", outline },
    } as unknown as ToolResponse;
    expect(treeOf(noFile, deps)).toBeNull();
    expect(treeOf({ ok: true, readback: { tree: deep } } as ToolResponse, deps)).toEqual(deep);
  });

  it("sweepSurface: run 2's menu, context and dialog rows are not main-window rows", () => {
    const id = (x: string) => ({ automationId: x });
    expect(sweepSurface({ kind: "control" }, id(`${MAIN_ID}.statusBar`), MAIN_ID)).toBe("window");
    expect(sweepSurface({ kind: "control" }, id("Maximize-Restore"), MAIN_ID)).toBe("window");
    expect(sweepSurface({ kind: "window" }, id(MAIN_ID), MAIN_ID)).toBe("window");
    expect(sweepSurface({ kind: "menu-item" }, { path: ["Edit", "Copy"] }, MAIN_ID)).toBe("menu");
    expect(sweepSurface({ kind: "menu" }, { path: ["Plugins", "BIKI"] }, MAIN_ID)).toBe("menu");
    expect(sweepSurface({ kind: "menu" }, { path: ["Edit"] }, MAIN_ID)).toBe("window");
    expect(
      sweepSurface({ kind: "context-item" }, id("Arma4WorkbenchApp.QMenu.QAction"), MAIN_ID),
    ).toBe("context");
    expect(sweepSurface({ kind: "dialog" }, id("Arma4WorkbenchApp.FileDlg"), MAIN_ID)).toBe(
      "dialog",
    );
    expect(
      sweepSurface({ kind: "control" }, id("Arma4WorkbenchApp.FileDlg.okButton"), MAIN_ID),
    ).toBe("dialog");
    expect(sweepFailure({ ok: false, count: 0 }, "unresolved")).toBe("none");
    expect(sweepFailure({ ok: false, count: 6 }, "unresolved")).toBe("ambiguous");
    expect(sweepFailure({ ok: true, count: 1 }, "name differs")).toBe("mismatch");
  });

  it("w8-30 resolves against the saved tree, keeps popup rows out of the share, records a tree that does not read", async () => {
    const row = (id: string, module: string, kind: string, locator: Raw) => ({
      id,
      module,
      kind,
      label: null,
      risk: "mutating",
      locator: { build: "1.8.0.13", ...locator },
    });
    const rows = [
      row("ui:WorldEditor/control/#entityFilterButton", "WorldEditor", "control", {
        automationId: `${MAIN_ID}.entityTreeDock.hierarchyDockContents.entityFilterButton`,
        controlType: "Button",
      }),
      row("ui:WorldEditor/menu-item/Edit/Copy", "WorldEditor", "menu-item", {
        menuPath: ["Edit", "Copy"],
      }),
      row("ui:WorldEditor/context-item/Hierarchy/default/Delete", "WorldEditor", "context-item", {
        automationId: "Arma4WorkbenchApp.QMenu.QAction",
      }),
      row("ui:WorldEditor/control/#okButton", "WorldEditor", "control", {
        automationId: "Arma4WorkbenchApp.FileDlg.okButton",
      }),
      row("ui:AnimEditor/control/#x", "AnimEditor", "control", {
        automationId: "Arma4WorkbenchApp.AnimEditor.x",
      }),
    ];
    let animTries = 0;
    const deps = fakeDeps({
      censusRows: () => new Map(rows.map((r) => [r.id, r as never])),
      tool: async (n, a) => {
        if (n === "wb_gui" && a.action === "tree") {
          if (String(a.windowTitle).includes("Animation")) {
            animTries++;
            return { ok: false, code: "INVALID_ARGUMENT", message: "no window matches" };
          }
          return { ok: true, readback: { file: FILE, relativeTo: "artifacts", outline } };
        }
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    deps.writeBytes("C:/art/gui/tree-pid4242-x.json", Buffer.from(JSON.stringify({ tree: deep })));
    const r = await runBattery([step("w8-30-p02-locator-sweep")], deps, opts());
    const rec = r.records[0]!;
    const p = rec.probes.find((x) => x.id === "P-W8-02")!;
    const o = p.observed as Raw;
    expect(o.carried, JSON.stringify(o)).toBe(1);
    expect(o.carriedOk).toBe(1);
    expect(o.elsewhere).toEqual({ menu: 1, context: 1, dialog: 1 });
    expect(o.notRead18).toBe(1);
    expect(p.result).toBe("SETTLED");
    expect(animTries).toBe(TREE_TRIES);
    const ev = rec.evidence as Raw;
    expect(JSON.stringify((ev.notSwept as Raw).AnimEditor)).toContain("no window matches");
    const lines =
      deps.files.get(`C:/sit/run-1/${P02_RESULTS_FILE}`) ??
      deps.files.get(`C:/sit/${P02_RESULTS_FILE}`);
    expect(lines?.toString() ?? "").toContain('"build":"1.9.0.37"');
  });

  it("wb_menu runs and the context-menu reads do not wait on P-W8-02 (no locator)", () => {
    expect(step("w8-50-p22-menu-runs").dependsOn ?? []).not.toContain("P-W8-02");
    expect(step("w8-94-p15-context-menus").dependsOn ?? []).not.toContain("P-W8-02");
  });
});

describe("W8 fix-up 2: DEC-078 in the locator sweep", () => {
  const MAIN = "Arma4WorkbenchApp.worldEditorMain";
  const STATUS = `${MAIN}.statusBar.QLabel`;
  const GRID = `${MAIN}.entityPropDock.entityPropGrid`;
  const tree = {
    controlType: "Window",
    name: "World Editor - x",
    automationId: MAIN,
    children: [
      { controlType: "Button", name: "Maximize", automationId: "Maximize-Restore", children: [] },
      {
        controlType: "StatusBar",
        name: "",
        automationId: `${MAIN}.statusBar`,
        children: [
          { controlType: "Text", name: "Version 1.9.0.37", automationId: STATUS, children: [] },
          { controlType: "Text", name: "Material: none", automationId: STATUS, children: [] },
          { controlType: "Text", name: "Ready", automationId: STATUS, children: [] },
        ],
      },
      {
        controlType: "Tree",
        name: "",
        automationId: GRID,
        children: [
          {
            controlType: "TreeItem",
            name: "Transformation",
            automationId: GRID,
            children: [
              { controlType: "TreeItem", name: "Angles", automationId: GRID, children: [] },
            ],
          },
        ],
      },
    ],
  };
  const row = (id: string, label: string | null, locator: Raw) => ({
    id,
    module: "WorldEditor",
    kind: "control",
    label,
    risk: "safe",
    locator: locator as never,
  });
  const fileRec = (rowId: string, over: Raw) =>
    ({
      rowId,
      build: "1.9.0.37",
      module: "WorldEditor",
      window: { className: "Qt683QWindowIcon", titlePattern: "^World Editor( - .+)?$" },
      name: "Ready",
      controlType: "Text",
      probe: "P-W8-02",
      evidence: "EV-W8-090",
      ...over,
    }) as never;

  it("sweepVolatile: only the two title-bar window-state buttons (ruling 3)", () => {
    expect(sweepVolatile({ automationId: "Maximize-Restore" })).toBe(true);
    expect(sweepVolatile({ automationId: "Minimize-Restore" })).toBe(true);
    expect(sweepVolatile({ automationId: `${MAIN}.Maximize-Restore` })).toBe(false);
    expect(sweepVolatile({})).toBe(false);
  });

  it("sweepLocator: a 1.9.0.37 locator is swept before a 1.8.0.13 one for the same row", () => {
    const r18 = row("ui:WorldEditor/x", "Ready", {
      build: "1.8.0.13",
      automationId: STATUS,
      controlType: "Text",
    });
    const rec = fileRec("ui:WorldEditor/x", { automationId: STATUS, ordinal: 2 });
    const a = sweepLocator(r18 as never, rec)!;
    expect(a).toMatchObject({ build: "1.9.0.37", source: "build-file" });
    expect(a.spec).toMatchObject({ automationId: STATUS, ordinal: 2, name: "Ready" });
    // A newer ledger locator wins over an older build-file record; a tie goes to the file.
    const r20 = { ...r18, locator: { ...(r18.locator as Raw), build: "1.10.0.1" } };
    expect(sweepLocator(r20 as never, rec)!.source).toBe("ledger");
    const r19 = { ...r18, locator: { ...(r18.locator as Raw), build: "1.9.0.37" } };
    expect(sweepLocator(r19 as never, rec)!.source).toBe("build-file");
    expect(sweepLocator(r18 as never, null)).toMatchObject({
      build: "1.8.0.13",
      source: "ledger",
    });
    expect(sweepLocator({ ...r18, locator: { build: "1.8.0.13" } } as never, null)).toBeNull();
  });

  it("sweepShares and sweepByBuildText: the overall share, per build, and the newest build's", () => {
    const by = { "1.9.0.37": { rows: 4, ok: 4 }, "1.8.0.13": { rows: 6, ok: 3 } };
    const s1 = sweepShares(by, "1.9.0.37");
    expect(s1).toMatchObject({ rows: 10, ok: 7, share: 0.7 });
    expect(s1.newest).toEqual({ rows: 4, ok: 4, share: 1 });
    expect(sweepShares(by, "2.0.0.1").newest).toBeNull();
    expect(sweepShares({}, "1.9.0.37")).toMatchObject({ rows: 0, share: 0, newest: null });
    expect(sweepByBuildText(by)).toBe("1.8.0.13 3/6, 1.9.0.37 4/4");
  });

  it("w8-30: ordinal and item-path rows resolve, the volatile row is outside the share, the share is reported per build", async () => {
    const rows = [
      row("ui:WorldEditor/status-item/statusBar/Material: none", "Material: none", {
        build: "1.9.0.37",
        automationId: STATUS,
        controlType: "Text",
        ordinal: 1,
      }),
      row("ui:WorldEditor/status-item/statusBar/Version 1.8.0.13", "Version 1.8.0.13", {
        build: "1.8.0.13",
        automationId: STATUS,
        controlType: "Text",
      }),
      row("ui:WorldEditor/control/#Maximize-Restore", "Restore", {
        build: "1.8.0.13",
        automationId: "Maximize-Restore",
        controlType: "Button",
      }),
      row("ui:WorldEditor/status-item/statusBar/Ready", "Ready", {
        build: "1.8.0.13",
        automationId: STATUS,
        controlType: "Text",
      }),
      row("ui:WorldEditor/property/Object Properties/entityPropGrid/Angles", "Angles", {
        build: "1.9.0.37",
        automationId: GRID,
        controlType: "TreeItem",
        itemPath: ["Transformation", "Angles"],
      }),
    ];
    const deps = fakeDeps({
      censusRows: () => new Map(rows.map((r) => [r.id, r as never])),
      locators: () =>
        new Map([
          [
            "ui:WorldEditor/status-item/statusBar/Ready",
            fileRec("ui:WorldEditor/status-item/statusBar/Ready", {
              automationId: STATUS,
              ordinal: 2,
            }),
          ],
        ]),
      tool: async (n, a) =>
        n === "wb_gui" && a.action === "tree"
          ? { ok: true, readback: { file: "gui/tree-pid4242-y.json", relativeTo: "artifacts" } }
          : { ok: true, readback: {} },
    });
    plantedPrep(deps);
    deps.writeBytes("C:/art/gui/tree-pid4242-y.json", Buffer.from(JSON.stringify({ tree })));
    const r = await runBattery([step("w8-30-p02-locator-sweep")], deps, opts());
    const p = r.records[0]!.probes.find((x) => x.id === "P-W8-02")!;
    const o = p.observed as Raw;
    expect(o.byBuild, JSON.stringify(o)).toEqual({
      "1.9.0.37": { rows: 3, ok: 3 },
      "1.8.0.13": { rows: 1, ok: 0 },
    });
    expect(o.volatile).toEqual(["ui:WorldEditor/control/#Maximize-Restore"]);
    expect(o.carried).toBe(4);
    expect(o.carriedOk).toBe(3);
    expect(o.newest).toEqual({ build: "1.9.0.37", rows: 3, ok: 3, share: 1 });
    expect(o.failures).toEqual({ "1.8.0.13 ambiguous": 1 });
    // DEC-079: 1.9.0.37 holds 3 of the 4 rows, so the verdict is its share (3 of 3).
    expect(p.result).toBe("SETTLED");
    expect(o.verdictOn).toBe("1.9.0.37");
    expect(JSON.stringify(p)).toContain("1.8.0.13 0/1, 1.9.0.37 3/3");
    const text = (deps.files.get(`C:/sit/run-1/${P02_RESULTS_FILE}`) ??
      deps.files.get(`C:/sit/${P02_RESULTS_FILE}`))!.toString();
    const lines = text
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l) as Raw);
    const by = new Map(lines.map((l) => [l.rowId, l]));
    expect(by.get("ui:WorldEditor/status-item/statusBar/Material: none")).toMatchObject({
      ordinal: 1,
      resolved: 1,
      name: "Material: none",
      locatorBuild: "1.9.0.37",
      locatorSource: "ledger",
    });
    expect(by.get("ui:WorldEditor/status-item/statusBar/Ready")).toMatchObject({
      ordinal: 2,
      locatorSource: "build-file",
      resolved: 1,
    });
    expect(by.get("ui:WorldEditor/property/Object Properties/entityPropGrid/Angles")).toMatchObject(
      {
        itemPath: ["Transformation", "Angles"],
        controlType: "TreeItem",
        resolved: 1,
      },
    );
  });
});

// ── Follow-ups (inbox/w8/followups.md items 1, 2, 4, 5): offline only, nothing proven live ──

describe("W8 follow-ups: fixtures planted and rolled back", () => {
  const W8_DIR = `${W8_ROOT}/`;
  const FX_WORLD = `C:/sb/EMCP2_sandbox/${WORLD}`;

  it("every planted folder, file and fixture file lies under _throwaway/W8/", () => {
    for (const d of PLANT_DIRS) expect(d === W8_ROOT || d.startsWith(W8_DIR), d).toBe(true);
    for (const f of PLANT_FILES) expect(f.rel.startsWith(W8_DIR), f.rel).toBe(true);
    for (const f of FIXTURE_FILES) expect(f.startsWith(W8_DIR), f).toBe(true);
    expect(PLANT_DIRS).toEqual(expect.arrayContaining([`${W8_ROOT}/anim`, AI_DIR]));
    expect(ANIM_AW).toBe(`${W8_ROOT}/anim/EMCP_W8.aw`);
    expect(BT).toBe(`${W8_ROOT}/ai/EMCP_W8.bt`);
  });

  it("every planned fixture names its maker and its rollback", () => {
    for (const f of plannedFixtures()) {
      expect(String(f.madeBy).length, String(f.kind)).toBeGreaterThan(10);
      expect(String(f.rollback).length, String(f.kind)).toBeGreaterThan(10);
    }
    const anim = plannedFixtures().find((f) => f.kind === "animation")!;
    expect((anim.graph as Raw).nodes).toHaveLength(2);
    expect((anim.graph as Raw).curve).toBe(CURVE_GAP);
  });

  it("every offline file-tool call names a path under _throwaway/W8/", () => {
    const fileTools = new Set(["animation_graph", "animation_workspace", "behavior_tree"]);
    const calls = offlinePlan(STEPS).filter((c) => fileTools.has(c.tool));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const p = c.params;
      const named = [p.path, p.target, p.outputPath, (p.spec as Raw | undefined)?.path].filter(
        (x) => typeof x === "string",
      ) as string[];
      expect(named.length, JSON.stringify(p)).toBeGreaterThan(0);
      for (const n of named) expect(n.startsWith(W8_DIR), `${c.step} ${n}`).toBe(true);
    }
  });

  it("each launch that creates the fixture entity deletes it before the launch ends", () => {
    const creates = (s: StepDef) =>
      planOf(s).some((a) => a.tool === "wb_entity" && a.toolAction === "create");
    const deletes = (s: StepDef) =>
      planOf(s).some((a) => a.tool === "wb_entity" && a.toolAction === "delete");
    const boundary = indexOf(NETZERO_STEP);
    const launch1 = STEPS.slice(0, boundary + 1);
    const launch2 = STEPS.slice(boundary + 1);
    for (const launch of [launch1, launch2]) {
      const created = launch.map((s, i) => (creates(s) ? i : -1)).filter((i) => i >= 0);
      expect(created.length, "a launch creates the fixture").toBeGreaterThan(0);
      const last = created[created.length - 1]!;
      const del = launch.findIndex((s, i) => i > last && deletes(s));
      expect(del, launch[last]!.id).toBeGreaterThan(last);
    }
    expect(indexOf("w8-07-fixtures")).toBe(indexOf("w8-06-world") + 1);
    expect(indexOf("w8-88-fixture-delete")).toBe(boundary - 1);
    expect(deletes(step(CLOSABLE_STEP))).toBe(true);
  });

  it("rollback removes the fixture files with _throwaway/W8/ and names an entity with no delete", () => {
    const seeds = [`${SB}/${WORLD}`, ...FIXTURE_FILES.map((f) => `${SB}/${f}`)];
    const io = memIo(seeds);
    io.files.set(
      `${SIT}/${PLANT_FILE}`,
      Buffer.from(
        JSON.stringify({
          throwawayExistedBefore: true,
          entities: [
            { step: "w8-07-fixtures", ref: "id:AA", id: "AA", deleted: true },
            { step: "w8-95-p18-canvas-gestures", ref: "id:BB", id: "BB" },
          ],
        }),
      ),
    );
    expect(runRollback(SB, SIT, true, io)).toBe(EXIT.done);
    for (const s of seeds) expect(io.files.has(s), s).toBe(false);
    const log = io.logs.join("\n");
    expect(log).toContain("id:BB");
    expect(log).not.toContain("id:AA");
  });

  it("w8-07 creates the entity in the throwaway world, records its id, and makes the files by the tools", async () => {
    const sent: Raw[] = [];
    const deps = fakeDeps({
      tool: async (n, a) => {
        sent.push({ n, ...a });
        if (n === "wb_world") return { ok: true, readback: { mode: "edit", worldPath: FX_WORLD } };
        if (n === "wb_entity" && a.action === "list") return { ok: true, readback: { rows: [] } };
        if (n === "wb_entity" && a.action === "create")
          return { ok: true, readback: { id: "0123ABCD", name: FIXTURE_ENTITY.name } };
        if (n === "wb_resources")
          return {
            ok: true,
            readback: { hasMeta: true, resourceName: `{0000000000000001}${String(a.path)}` },
          };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-07-fixtures")], deps, opts());
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    const create = sent.find((x) => x.n === "wb_entity" && x.action === "create")!;
    expect(create).toMatchObject({
      prefab: FIXTURE_ENTITY.prefab,
      name: FIXTURE_ENTITY.name,
      coords: FIXTURE_ENTITY.coords,
    });
    expect(liveFixture({ sittingDir: "C:/sit" }, deps)).toMatchObject({
      ref: "id:0123ABCD",
      id: "0123ABCD",
      step: "w8-07-fixtures",
    });
    const tools = sent.map((x) => `${String(x.n)}.${String(x.action)}`);
    expect(tools).toContain("animation_graph.author");
    expect(sent.filter((x) => x.n === "animation_graph" && x.op === "addNode")).toHaveLength(3);
    expect(tools).toContain("animation_workspace.create");
    expect(tools).toContain("behavior_tree.create");
    for (const x of sent.filter((y) => y.n === "animation_workspace" || y.n === "behavior_tree"))
      expect(String(x.target ?? (x.spec as Raw).path).startsWith(`${W8_ROOT}/`)).toBe(true);
  });

  it("w8-07 creates no entity when the throwaway world is not the open one", async () => {
    const sent: Raw[] = [];
    const deps = fakeDeps({
      tool: async (n, a) => {
        sent.push({ n, ...a });
        if (n === "wb_world")
          return {
            ok: true,
            readback: { mode: "edit", worldPath: "worlds/Arland/EmptyArland.ent" },
          };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-07-fixtures")], deps, opts());
    expect(sent.some((x) => x.n === "wb_entity")).toBe(false);
    expect(r.records[0]!.status).toBe("FAIL");
  });

  // Cold run 1 fix (w8-exit-crash.md): launch 1 ends on a clean world, so the close needs no hand.
  const undoDeps = (undoWorks: boolean): { deps: ReturnType<typeof fakeDeps>; sent: Raw[] } => {
    const sent: Raw[] = [];
    let present = true;
    const deps = fakeDeps({
      tool: async (n, a) => {
        sent.push({ n, ...a });
        if (n === "wb_entity" && a.action === "list")
          return {
            ok: true,
            readback: { rows: present ? [{ id: "0123ABCD", name: FIXTURE_ENTITY.name }] : [] },
          };
        if (n === "wb_undo_redo") {
          if (!undoWorks) return { ok: false, code: "TOOL_ERROR", message: "Nothing to undo" };
          present = false;
          return { ok: true, message: "**Undo Complete**\n\nUndo executed" };
        }
        if (n === "wb_entity" && a.action === "delete") present = false;
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    deps.writeBytes(
      `C:/sit/${PLANT_FILE}`,
      Buffer.from(
        JSON.stringify({
          entities: [{ step: "w8-07-fixtures", ref: "id:0123ABCD", id: "0123ABCD" }],
        }),
      ),
    );
    return { deps, sent };
  };

  it("w8-88 undoes the fixture (no delete, no save), marks the record deleted and leaves the world clean", async () => {
    const { deps, sent } = undoDeps(true);
    const r = await runBattery([step("w8-88-fixture-delete")], deps, opts());
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    expect((r.records[0]!.evidence as Raw).clean).toBe(true);
    expect(sent.filter((x) => x.n === "wb_undo_redo")).toEqual([
      { n: "wb_undo_redo", action: "undo" },
    ]);
    expect(sent.some((x) => x.n === "wb_entity" && x.action === "delete")).toBe(false);
    expect(sent.some((x) => /save/i.test(String(x.action)))).toBe(false);
    expect(liveFixture({ sittingDir: "C:/sit" }, deps)).toBeNull();
  });

  it("w8-88 falls back to the delete when the undo does not take the fixture, and FAILs (the world is dirty)", async () => {
    const { deps, sent } = undoDeps(false);
    const r = await runBattery([step("w8-88-fixture-delete")], deps, opts());
    expect(r.records[0]!.status).toBe("FAIL");
    expect(r.records[0]!.detail).toMatch(/World editor - closing/);
    expect((r.records[0]!.evidence as Raw).clean).toBe(false);
    expect(sent.filter((x) => x.n === "wb_undo_redo")).toHaveLength(1);
    expect(sent.find((x) => x.n === "wb_entity" && x.action === "delete")).toMatchObject({
      entities: ["id:0123ABCD"],
    });
    expect(liveFixture({ sittingDir: "C:/sit" }, deps)).toBeNull();
  });

  it("w8-88 presses undo at most FIXTURE_UNDO_MAX times", async () => {
    const sent: Raw[] = [];
    const deps = fakeDeps({
      tool: async (n, a) => {
        sent.push({ n, ...a });
        if (n === "wb_entity" && a.action === "list")
          return { ok: true, readback: { rows: [{ id: "0123ABCD", name: FIXTURE_ENTITY.name }] } };
        if (n === "wb_undo_redo") return { ok: true, message: "Undo executed" };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-88-fixture-delete")], deps, opts());
    expect(sent.filter((x) => x.n === "wb_undo_redo")).toHaveLength(FIXTURE_UNDO_MAX);
    expect(r.records[0]!.status).toBe("FAIL");
  });
});

describe("W8 follow-ups: the hand block's pass rules", () => {
  it("P-W8-18 settles only with one acted and undone gesture on each canvas", () => {
    const g = (canvas: string, acted = true, undone = true) => ({ canvas, acted, undone });
    expect(GESTURE_CANVASES).toEqual(["graph", "curve", "gizmo"]);
    expect(judgeGestures({ gestures: [g("graph"), g("curve"), g("gizmo")] }).result).toBe(
      "SETTLED",
    );
    const two = judgeGestures({ gestures: [g("graph"), g("gizmo"), g("gizmo")] });
    expect(two.result).toBe("PARTIAL");
    expect(two.note).toContain("missing: curve");
    expect(judgeGestures({ gestures: [g("graph"), g("curve", false), g("gizmo")] }).result).toBe(
      "PARTIAL",
    );
    expect(judgeGestures({ gestures: [g("graph", true, false)] }).result).toBe("KILLED");
    expect(judgeGestures(null).result).toBe("PARTIAL");
  });

  it("P-W8-15 settles with 8 of 8 menus read, and is PARTIAL with 7", async () => {
    const surfaces = [
      "World Editor: Hierarchy",
      "Resource Manager: Resource Browser",
      "World Editor: Layers",
      "Script Editor: a file tab",
      "World Editor: Log Console",
      "World Editor: Object Properties",
      "Animation Editor: the graph",
      "Behavior Editor: the tree",
    ];
    for (const opened of [8, 7]) {
      const deps = fakeDeps({
        tool: async (n, a) =>
          n === "wb_gui" && a.action === "context"
            ? { ok: true, readback: { items: [{ name: "x" }] } }
            : { ok: true, readback: {} },
      });
      surfaces.forEach((s, i) => {
        const key = `w8-94-p15-context-menus-${s.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
        deps.writeBytes(
          handFiles("C:/sit/run-1", `${key}-open`).answer,
          Buffer.from(JSON.stringify(i < opened ? { opened: true } : { opened: false, why: "x" })),
        );
        deps.writeBytes(
          handFiles("C:/sit/run-1", `${key}-close`).answer,
          Buffer.from('{"closed":true}'),
        );
      });
      const r = await runBattery([step("w8-94-p15-context-menus")], deps, opts());
      expect(r.records[0]!.probes[0]!.result, String(opened)).toBe(
        opened === 8 ? "SETTLED" : "PARTIAL",
      );
    }
  });

  it("the fixture entity is selected and the .aw and .bt opened before w8-94 and w8-95 ask the hand", async () => {
    for (const id of ["w8-94-p15-context-menus", "w8-95-p18-canvas-gestures"]) {
      const order: string[] = [];
      const fs = memFs();
      const write = fs.writeBytes;
      fs.writeBytes = (p, b) => {
        if (/request/i.test(p)) order.push(`write:${p}`);
        write(p, b);
      };
      const deps = fakeDeps(
        {
          tool: async (n, a) => {
            order.push(`${n}.${String(a.action ?? "")}${a.mode ? `.${String(a.mode)}` : ""}`);
            if (n === "wb_world")
              return {
                ok: true,
                readback: { mode: "edit", worldPath: `C:/sb/EMCP2_sandbox/${WORLD}` },
              };
            if (n === "wb_entity" && a.action === "list")
              return { ok: true, readback: { rows: [] } };
            if (n === "wb_entity" && a.action === "create")
              return { ok: true, readback: { id: "FEED" } };
            return { ok: true, readback: {} };
          },
        },
        fs,
      );
      plantedPrep(deps);
      for (const rel of [ANIM_AW, BT])
        deps.writeBytes(join("C:/sb/EMCP2_sandbox", ...rel.split("/")), Buffer.from("x"));
      // Answers ready, so the fake run never waits on a hand (its clock does not move).
      write(handFiles("C:/sit/run-1", "w8-95-gestures").answer, Buffer.from('{"gestures":[]}'));
      for (const s of CONTEXT_SURFACES) {
        const key = `w8-94-p15-context-menus-${s.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
        write(handFiles("C:/sit/run-1", `${key}-open`).answer, Buffer.from('{"opened":false}'));
        write(handFiles("C:/sit/run-1", `${key}-close`).answer, Buffer.from('{"closed":true}'));
      }
      await runBattery([step(id)], deps, opts());
      const sel = order.indexOf("wb_view.select.set");
      const firstWrite = order.findIndex((x) => x.startsWith("write:"));
      expect(sel, `${id}: ${order.join(" ")}`).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("wb_entity.create")).toBeLessThan(sel);
      expect(order.filter((x) => x === "wb_module.setResource")).toHaveLength(2);
      expect(firstWrite, `${id}: a hand request was written`).toBeGreaterThan(sel);
      const plan = planOf(step(id)).map((a) => `${String(a.tool)}.${String(a.toolAction)}`);
      expect(plan.indexOf("wb_entity.create")).toBeLessThan(plan.indexOf("wb_view.select"));
    }
  });
});

describe("W8 follow-ups: the sweep (items 2 and 4)", () => {
  const MAIN = "Arma4WorkbenchApp.worldEditorMain";
  const GRID = `${MAIN}.entityPropDock.entityPropGrid`;
  const RM = "Arma4WorkbenchApp.ResourceManagerMain";
  const label = (a: PlanAction): string => {
    const p = (a.params ?? {}) as Raw;
    return `${String(a.tool)}.${String(a.toolAction)}${p.mode ? `.${String(p.mode)}` : ""}`;
  };

  it("w8-30's plan opens the capped sub-editors (exit-crash cap), then reads the RM window", () => {
    const plan = planOf(step("w8-30-p02-locator-sweep"));
    const sets = plan.filter((a) => a.tool === "wb_module" && a.toolAction === "setResource");
    expect(sets).toHaveLength(SUB_EDITOR_CAP);
    for (const s of sets) {
      const i = plan.indexOf(s);
      expect(plan[i + 1]).toMatchObject({ tool: "wb_gui", toolAction: "tree" });
      expect(String((plan[i + 1]!.params as Raw).windowTitle)).toContain("Enfusion Workbench");
      expect(plan[i - 1]).toMatchObject({ tool: "wb_resources", toolAction: "search" });
    }
  });

  it("w8-30's plan: selection none, the tree, the fixture selected, the tree again, cleared", () => {
    const plan = planOf(step("w8-30-p02-locator-sweep")).map(label);
    const open = plan.indexOf("wb_module.open");
    expect(plan.slice(open, open + 7)).toEqual([
      "wb_module.open",
      "wb_view.select.clear",
      "wb_gui.tree",
      "wb_view.select.set",
      "wb_gui.tree",
      "wb_view.select.clear",
      "wb_module.open",
    ]);
  });

  it("sweepSelectionBound: the grid's items, never the grid itself", () => {
    expect(
      sweepSelectionBound("ui:WorldEditor/property/Object Properties/entityPropGrid/Angles", {}),
    ).toBe(true);
    expect(
      sweepSelectionBound(
        "ui:WorldEditor/property-group/Object Properties/entityPropGrid/Flags",
        {},
      ),
    ).toBe(true);
    expect(
      sweepSelectionBound("ui:WorldEditor/property-group/#entityPropGrid", { automationId: GRID }),
    ).toBe(false);
    expect(sweepSelectionBound("ui:x", { automationId: GRID, itemPath: ["General"] })).toBe(true);
    expect(sweepSelectionBound("ui:x", { automationId: `${MAIN}.other`, itemPath: ["a"] })).toBe(
      false,
    );
  });

  it("w8-30: grid items resolve on the selected read, other rows on the selection-none read; sub-editor rows are tallied apart", async () => {
    const none = {
      controlType: "Window",
      name: "World Editor - x",
      automationId: MAIN,
      children: [{ controlType: "Tree", name: "", automationId: GRID, children: [] }],
    };
    const selected = {
      ...none,
      children: [
        {
          controlType: "Tree",
          name: "",
          automationId: GRID,
          children: [
            { controlType: "TreeItem", name: "General", automationId: GRID, children: [] },
          ],
        },
      ],
    };
    const rmTree = {
      controlType: "Window",
      name: "Enfusion Workbench - x",
      automationId: RM,
      children: [
        { controlType: "Button", name: "Grid", automationId: `${RM}.cfgGrid`, children: [] },
      ],
    };
    const row = (id: string, module: string, label2: string | null, locator: Raw) => ({
      id,
      module,
      kind: "control",
      label: label2,
      risk: "safe",
      locator: { build: "1.9.0.37", ...locator } as never,
    });
    const rows = [
      row("ui:WorldEditor/property-group/#entityPropGrid", "WorldEditor", null, {
        automationId: GRID,
        controlType: "Tree",
      }),
      row(
        "ui:WorldEditor/property-group/Object Properties/entityPropGrid/General",
        "WorldEditor",
        "General",
        { automationId: GRID, controlType: "TreeItem", itemPath: ["General"] },
      ),
      row("ui:ResourceManager.Material/control/#cfgGrid", "ResourceManager.Material", "Grid", {
        automationId: `${RM}.cfgGrid`,
        controlType: "Button",
      }),
    ];
    let selectedNow = false;
    const order: string[] = [];
    const deps = fakeDeps({
      censusRows: () => new Map(rows.map((r) => [r.id, r as never])),
      tool: async (n, a) => {
        order.push(`${n}.${String(a.action)}${a.mode ? `.${String(a.mode)}` : ""}`);
        if (n === "wb_view" && a.action === "select") selectedNow = a.mode === "set";
        if (n === "wb_resources" && a.action === "search")
          return { ok: true, readback: { items: ["{0123456789ABCDEF}Configs/a.conf"] } };
        if (n === "wb_gui" && a.action === "tree") {
          const t = String(a.windowTitle).includes("World Editor")
            ? selectedNow
              ? selected
              : none
            : rmTree;
          return { ok: true, readback: { tree: t } };
        }
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    deps.writeBytes(
      `C:/sit/${PLANT_FILE}`,
      Buffer.from(
        JSON.stringify({ entities: [{ step: "w8-07-fixtures", ref: "id:FEED", id: "FEED" }] }),
      ),
    );
    const r = await runBattery([step("w8-30-p02-locator-sweep")], deps, opts());
    const p = r.records[0]!.probes.find((x) => x.id === "P-W8-02")!;
    const o = p.observed as Raw;
    expect(o.selectionBound, JSON.stringify(o)).toMatchObject({
      rows: 1,
      ok: 1,
      read: true,
      ref: "id:FEED",
    });
    // the grid and its item are in the share; the sub-editor row is apart
    expect(o.byBuild).toEqual({ "1.9.0.37": { rows: 2, ok: 2 } });
    expect(o.subEditors).toEqual({
      "ResourceManager.Material": { rows: 1, ok: 1, elsewhere: 0, resource: "Configs/a.conf" },
    });
    // the sub-editor is read after the World Editor, with its file set first
    expect(order.indexOf("wb_module.setResource")).toBeGreaterThan(
      order.lastIndexOf("wb_view.select.clear"),
    );
    const text = (deps.files.get(`C:/sit/run-1/${P02_RESULTS_FILE}`) ??
      deps.files.get(`C:/sit/${P02_RESULTS_FILE}`))!.toString();
    expect(text).toContain("ui:ResourceManager.Material/control/#cfgGrid");
    expect(text).toContain("Object Properties/entityPropGrid/General");
  });
});

describe("W8 follow-ups: the screenshot after wb_diag select (item 5)", () => {
  it("w8-82's plan screenshots right after the select; no plan entry names a Win key", () => {
    const plan = planOf(step("w8-82-p07-diag-play"));
    const sel = plan.findIndex((a) => a.tool === "wb_diag" && a.toolAction === "select");
    // W8 run 8: the World Editor is fronted, then its window alone is captured
    expect(plan[sel + 1]).toMatchObject({
      tool: "wb_module",
      toolAction: "front",
      params: { module: "WorldEditor" },
    });
    expect(plan[sel + 2]).toMatchObject({ tool: "wb_gui", toolAction: "screenshot" });
    expect(plan[sel + 2].params).toMatchObject({ windowTitle: MODULE_WINDOWS.WorldEditor });
    for (const s of STEPS)
      for (const a of planOf(s))
        expect(JSON.stringify(a.params ?? {}), s.id).not.toMatch(/\bwin\b/i);
    const judge = step(SELECT_SHOT_STEP);
    expect(judge.hand).toBe(true);
    expect(indexOf(SELECT_SHOT_STEP)).toBeGreaterThan(indexOf(HAND_GATE_STEP));
  });

  it("w8-82 records the screenshot after select; the hand step reads it for judgement", async () => {
    let mode = "edit";
    const sent: string[] = [];
    let shotArgs: Raw = {};
    const deps = fakeDeps({
      diagNames: () =>
        ({
          script: ["DEBUGUI_A"],
          engine: [],
          menus: ["DEBUGUI_RADIALMENU_MENU"],
        }) as unknown as ReturnType<W8Deps["diagNames"]>,
      tool: async (n, a) => {
        sent.push(`${n}.${String(a.action ?? "")}`);
        if (n === "wb_play") mode = "play";
        if (n === "wb_stop") mode = "edit";
        if (n === "wb_world") return { ok: true, readback: { mode } };
        if (n === "wb_gui" && a.action === "screenshot") {
          shotArgs = a;
          return {
            ok: true,
            readback: { file: "gui/desktop-w8-82-diag-select-x.png", relativeTo: "artifacts" },
          };
        }
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    await runBattery([step("w8-82-p07-diag-play")], deps, opts());
    const i = sent.indexOf("wb_diag.select");
    expect(i, sent.join(" ")).toBeGreaterThanOrEqual(0);
    expect(sent[i + 1]).toBe("wb_module.front");
    expect(sent[i + 2]).toBe("wb_gui.screenshot");
    // window-scoped: a pid and the World Editor's title, never the bare desktop
    expect(shotArgs).toMatchObject({ windowTitle: MODULE_WINDOWS.WorldEditor });
    expect(shotArgs.pid).toBeDefined();
    const rec = JSON.parse(deps.files.get(`C:/sit/${SELECT_SHOT_FILE}`)!.toString()) as Raw;
    expect(rec).toMatchObject({
      menu: "DEBUGUI_RADIALMENU_MENU",
      file: "gui/desktop-w8-82-diag-select-x.png",
      judgeIn: SELECT_SHOT_STEP,
    });
    // the judgement in a later run folder: the hand answers; never a KILL
    deps.writeBytes(
      handFiles("C:/sit/run-2", "w8-92-select-shot").answer,
      Buffer.from('{"drawn":true,"region":"0,0,10,10"}'),
    );
    const j = await runBattery([step(SELECT_SHOT_STEP)], deps, opts({ runDir: "C:/sit/run-2" }));
    const p = j.records[0]!.probes[0]!;
    expect(p.result).toBe("PARTIAL");
    expect(JSON.stringify(p.observed)).toContain("desktop-w8-82-diag-select-x.png");
    expect(p.note).toContain("drew");
  });

  it("without a screenshot record the judgement asks nothing and is PARTIAL", async () => {
    const deps = fakeDeps();
    const r = await runBattery([step(SELECT_SHOT_STEP)], deps, opts());
    expect(r.records[0]!.probes[0]!.result).toBe("PARTIAL");
    expect(deps.exists(handFiles("C:/sit/run-1", "w8-92-select-shot").request)).toBe(false);
  });
});

describe("W8 exit-crash bisect aid: the w8-30 sweep filter", () => {
  const ORDER = [
    "WorldEditor",
    "ResourceManager",
    "ResourceManager.Config",
    "ResourceManager.Material",
    "ResourceManager.Texture",
  ];

  it("parseSweepFilter: none given is null; bad values are usage errors", () => {
    expect(parseSweepFilter(undefined, undefined, false)).toBeNull();
    expect(parseSweepFilter("WorldEditor, ResourceManager.Material", "2", true)).toEqual({
      only: ["WorldEditor", "ResourceManager.Material"],
      limit: 2,
      noTree: true,
    });
    expect(typeof parseSweepFilter(",", undefined, false)).toBe("string");
    expect(typeof parseSweepFilter(undefined, "0", false)).toBe("string");
    expect(typeof parseSweepFilter(undefined, "1.5", false)).toBe("string");
  });

  it("applySweepFilter: without --sweep-only the sub-editors outside the cap are left out", () => {
    const a = applySweepFilter(ORDER, undefined);
    expect(a.kept).toEqual([
      "WorldEditor",
      "ResourceManager",
      "ResourceManager.Material",
      "ResourceManager.Texture",
    ]);
    expect(a.capped).toEqual(["ResourceManager.Config"]);
    expect(LAUNCH1_SUB_EDITORS).toHaveLength(SUB_EDITOR_CAP);
    // an explicit --sweep-only is taken as given (a bisect or a follow-up launch)
    expect(applySweepFilter(ORDER, { only: ["ResourceManager.Config"] }).kept).toEqual([
      "ResourceManager.Config",
    ]);
  });

  it("applySweepFilter: only keeps the sweep's order, limit takes the first n after it", () => {
    const a = applySweepFilter(ORDER, { only: ["ResourceManager.Texture", "WorldEditor", "Nope"] });
    expect(a.kept).toEqual(["WorldEditor", "ResourceManager.Texture"]);
    expect(a.unknown).toEqual(["Nope"]);
    expect(applySweepFilter(ORDER, { limit: 2 }).kept).toEqual(["WorldEditor", "ResourceManager"]);
    expect(applySweepFilter(ORDER, { limit: 2 }).dropped).toHaveLength(2);
    expect(applySweepFilter(ORDER, { limit: 2 }).capped).toEqual(["ResourceManager.Config"]);
  });

  const rows = [
    { id: "ui:WorldEditor/control/#a", module: "WorldEditor", kind: "control", label: "A" },
    { id: "ui:ResourceManager/control/#b", module: "ResourceManager", kind: "control", label: "B" },
    {
      id: "ui:ResourceManager.Material/control/#c",
      module: "ResourceManager.Material",
      kind: "control",
      label: "C",
    },
    {
      id: "ui:ResourceManager.Texture/control/#d",
      module: "ResourceManager.Texture",
      kind: "control",
      label: "D",
    },
  ].map((r) => ({
    ...r,
    risk: "safe",
    locator: { build: "1.9.0.37", automationId: `X.${r.label}`, controlType: "Button" } as never,
  }));
  const run = async (sweep: Raw) => {
    const calls: string[] = [];
    const deps = fakeDeps({
      censusRows: () => new Map(rows.map((r) => [r.id, r as never])),
      tool: async (n, a) => {
        calls.push(
          `${n}.${String(a.action)}${a.extensions ? `.${String((a.extensions as string[])[0])}` : ""}`,
        );
        if (n === "wb_resources" && a.action === "search")
          return { ok: true, readback: { items: ["{0123456789ABCDEF}Assets/x.bin"] } };
        if (n === "wb_gui" && a.action === "tree")
          return {
            ok: true,
            readback: {
              tree: { controlType: "Window", name: "w", automationId: "X", children: [] },
            },
          };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-30-p02-locator-sweep")], deps, opts({ sweep } as never));
    return { calls, rec: r.records[0]!, observed: r.records[0]!.probes[0]!.observed as Raw };
  };

  it("--sweep-only ResourceManager.Material opens that one sub-editor and reads it; P-W8-02 stays PARTIAL", async () => {
    const { calls, rec, observed } = await run({ only: ["ResourceManager.Material"] });
    expect(calls.filter((c) => c === "wb_module.open")).toHaveLength(0);
    expect(calls.filter((c) => c === "wb_module.setResource")).toHaveLength(1);
    expect(calls).toContain("wb_resources.search.emat");
    expect(calls).not.toContain("wb_resources.search.edds");
    expect(calls.filter((c) => c === "wb_gui.tree")).toHaveLength(1);
    expect(rec.probes[0]!.result).toBe("PARTIAL");
    expect((observed.notSwept as Raw).WorldEditor).toMatchObject({
      why: expect.stringContaining("bisect"),
    });
    expect(observed.bisect).toMatchObject({ swept: ["ResourceManager.Material"] });
  });

  it("--sweep-limit 1 sweeps only the first module (the World Editor)", async () => {
    const { calls } = await run({ limit: 1 });
    expect(calls.filter((c) => c === "wb_module.open")).toHaveLength(1);
    expect(calls).not.toContain("wb_module.setResource");
  });

  it("--sweep-no-tree opens every module and sub-editor, sends no tree read", async () => {
    const { calls, rec } = await run({ noTree: true });
    expect(calls.filter((c) => c === "wb_gui.tree")).toHaveLength(0);
    expect(calls.filter((c) => c === "wb_module.setResource")).toHaveLength(2);
    expect(calls.filter((c) => c === "wb_module.open")).toHaveLength(2);
    expect(rec.probes[0]!.result).toBe("PARTIAL");
  });

  it("an --sweep-only name outside the sweep FAILs the step", async () => {
    const { rec } = await run({ only: ["ResourceManager.Nope"] });
    expect(rec.status).toBe("FAIL");
  });

  it("the full sweep opens only the capped sub-editors and records the others NOT-SWEPT with the reason", async () => {
    const extra = {
      id: "ui:ResourceManager.Layout/control/#e",
      module: "ResourceManager.Layout",
      kind: "control",
      label: "E",
      risk: "safe",
      locator: { build: "1.9.0.37", automationId: "X.E", controlType: "Button" } as never,
    };
    const calls: string[] = [];
    const deps = fakeDeps({
      censusRows: () => new Map([...rows, extra].map((r) => [r.id, r as never])),
      tool: async (n, a) => {
        calls.push(
          `${n}.${String(a.action)}${a.extensions ? `.${String((a.extensions as string[])[0])}` : ""}`,
        );
        if (n === "wb_resources" && a.action === "search")
          return { ok: true, readback: { items: ["{0123456789ABCDEF}Assets/x.bin"] } };
        if (n === "wb_gui" && a.action === "tree")
          return {
            ok: true,
            readback: {
              tree: { controlType: "Window", name: "w", automationId: "X", children: [] },
            },
          };
        return { ok: true, readback: {} };
      },
    });
    plantedPrep(deps);
    const r = await runBattery([step("w8-30-p02-locator-sweep")], deps, opts());
    const o = r.records[0]!.probes[0]!.observed as Raw;
    expect(calls).not.toContain("wb_resources.search.layout");
    expect(calls).toContain("wb_resources.search.emat");
    expect((o.notSwept as Raw)["ResourceManager.Layout"]).toMatchObject({
      why: expect.stringContaining("sub-editor cap"),
    });
    expect(o.subEditorCap).toEqual({ cap: SUB_EDITOR_CAP, notSwept: ["ResourceManager.Layout"] });
    expect(o.bisect).toBeUndefined();
  });

  it("w8-75's plan opens only the capped sub-editors", () => {
    const sets = planOf(step("w8-75-p16-viewers")).filter(
      (a) => a.tool === "wb_module" && a.toolAction === "setResource",
    );
    expect(sets).toHaveLength(SUB_EDITOR_CAP);
  });
});
