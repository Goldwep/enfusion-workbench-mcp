import { afterAll, describe, expect, it } from "vitest";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleArgs } from "../../src/tools/wb-module.js";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { defaultPlaceholderContext } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  EXIT,
  buildWalkerQueue,
  deriveId,
  normalizeLabel,
  runWalker,
  runWalkerSteps,
  validateLine,
  walkerPlan,
  type WalkerDeps,
  type WalkerOptions,
} from "../../scripts/census/live/common.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  SCRIPT,
  UNREAD_NOTE,
  classifyAllowList,
  l09Def,
  resolveMenuPath,
  type L09Kernel,
  type ToolAnswer,
} from "../../scripts/census/live/L09-actions.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l09-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FX = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "live", "L09-we-docks.json"), "utf-8"),
) as {
  window: { pid: number; className: string; title: string };
  nodes: Array<{ name: string; dock: string }>;
  g2_05: { dock: { before: number; afterFirst: number; after: number } };
};
const PID = FX.window.pid;
const WE: WindowInfo = {
  hwnd: 100,
  pid: PID,
  className: FX.window.className,
  title: FX.window.title,
  owner: 0,
  enabled: true,
  rect: [0, 0, 10, 10],
  monitor: [0, 0, 10, 10],
  primary: true,
};
const policy = loadPolicy();
const def0 = l09Def(() => {
  throw new Error("no kernel in a plan");
});
const sel = {
  module: "WorldEditor",
  state: { mode: "edit", selection: "none" } as const,
  allowOwned: false,
};

/** A fake Workbench: the fixture's dock nodes; only the exact "Window" spelling toggles. */
function fakeKernel(
  over: {
    accept?: (path: string[]) => boolean;
    moves?: boolean;
    findFails?: boolean;
    onSend?: (n: number) => void;
  } = {},
): L09Kernel & { sends: string[][]; finds: number; windowsUp: WindowInfo[] } {
  const hidden = new Set<string>();
  const k = {
    sends: [] as string[][],
    finds: 0,
    windowsUp: [WE] as WindowInfo[],
    windows: async () => k.windowsUp,
    module: async (a: ModuleArgs): Promise<ToolAnswer> => {
      k.sends.push(a.menuPath ?? []);
      over.onSend?.(k.sends.length);
      const p = a.menuPath ?? [];
      const ok = (over.accept ?? ((x) => x[0] === "Window"))(p);
      if (!ok) return { ok: false, code: "ENGINE_FALSE", message: "false" };
      if (over.moves !== false) {
        const dock = FX.nodes.find(
          (n) => normalizeLabel(n.dock).toLowerCase() === normalizeLabel(p[1]).toLowerCase(),
        )!.dock;
        if (hidden.has(dock)) hidden.delete(dock);
        else hidden.add(dock);
      }
      return { ok: true, readback: { menuPath: p.join(" > "), result: true } };
    },
    gui: async (a: Record<string, unknown>): Promise<ToolAnswer> => {
      k.finds++;
      expect(a.action).toBe("find");
      if (over.findFails) return { ok: false, code: "HANDLER_ERROR" };
      const name = String(a.name);
      const total = hidden.has(name) ? 0 : FX.nodes.filter((n) => n.name === name).length;
      return { ok: true, readback: { total, hits: [] } };
    },
  };
  return k;
}

/** Runner deps over a real temp folder (the script writes its oracle files there). */
function deps(windows: () => WindowInfo[]): WalkerDeps {
  return {
    windows: async () => [...windows()],
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => PID,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: existsSync,
    writeFile: (p, t, ex) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t, { encoding: "utf-8", flag: ex ? "wx" : "w" });
    },
    appendFile: (p, t) => {
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, t, "utf-8");
    },
    log: () => undefined,
  };
}

/** L02's read of the World Editor Window menu, as it lies in a sitting's run folder. */
const L02_WINDOW_MENUS = "p4-l02-worldeditor-window-edit-none-menus.json";
const L02_DOC = {
  schema: "emcp-uia-menus/1",
  menus: [
    {
      title: "Window",
      opened: true,
      collapsed: true,
      items: [
        { controlType: "MenuItem", name: "Hierarchy" },
        { controlType: "MenuItem", name: "Log Console	Ctrl+L" },
      ],
    },
  ],
};

let runN = 0;
function opts(withL02 = true): WalkerOptions {
  const runDir = join(TMP, `run${++runN}`);
  mkdirSync(runDir, { recursive: true });
  if (withL02) writeFileSync(join(runDir, L02_WINDOW_MENUS), JSON.stringify(L02_DOC), "utf-8");
  return {
    enumerator: "L09",
    script: SCRIPT,
    session: "P4-1",
    runDir,
    module: "WorldEditor",
    state: { mode: "edit", selection: "none" },
    allowOwned: false,
    evidenceDir: null,
    ph: defaultPlaceholderContext(),
    build: "test",
  };
}

const rec = (o: WalkerOptions, id: string) =>
  JSON.parse(readFileSync(join(o.runDir, `${id}.json`), "utf-8"));

// The menu battery plan is in the 2.0 programme record (docs/v2), which the public export leaves
// out; without it L09 knows no W9 rows and the classification check skips.
const HAS_W9_PLAN = existsSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../docs/v2/inbox/phase6/bk3/bk3-menu-plan.jsonl",
  ),
);

describe("L09 classification and plan", () => {
  it.skipIf(!HAS_W9_PLAN)("derives the battery from the allow-list: Window toggles run, Undo and Qt Introspection never", () => {
    const items = classifyAllowList(policy);
    expect(items).toHaveLength((policy.execute_action?.allow_list ?? []).length);
    expect(items.filter((i) => i.kind === "toggle")).toHaveLength(6);
    expect(items.find((i) => i.path.join(">") === "Edit>Undo")).toMatchObject({
      kind: "mutating",
      wave: expect.stringContaining("S-E"),
    });
    expect(items.find((i) => i.path[0] === "Utilities")).toMatchObject({ kind: "opener" });
    expect(items.some((i) => i.kind === "unclassified")).toBe(false);
    // DEC-095: the safe-state rows are W9 view items, never sent by L09. DEC-100 keeps only the 2
    // proven ones (Focus Selection, Select Layer) on the allow-list; the other 17 are candidates.
    expect(items.filter((i) => i.kind === "w9" && i.why.startsWith("a DEC-095"))).toHaveLength(2);
  });

  it("the plan passes checkPlan and holds no key, no invoke, no unlisted or deny-listed path", () => {
    const steps = def0.steps(sel);
    const plan = walkerPlan(steps, sel);
    expect(checkPlan(plan, policy, { script: SCRIPT }).ok).toBe(true);
    const kinds = new Set(plan.map((a) => a.kind));
    expect([...kinds].sort()).toEqual(["execute-action", "net-call", "uia-read"]);
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/"kind":"key"|"invoke"|Invoke|"Enter"|"type"/);
    const allow = (policy.execute_action?.allow_list ?? []).map((p) => JSON.stringify(p));
    const deny = (policy.execute_action?.deny_list_seed ?? []).map((l) => normalizeLabel(l));
    for (const a of plan.filter((x) => x.kind === "execute-action")) {
      const path = (a.target as { path: string[] }).path;
      expect(allow).toContain(JSON.stringify(path));
      for (const seg of path) expect(deny).not.toContain(normalizeLabel(seg));
      expect(path.join(">")).not.toMatch(/Undo|Introspection/);
    }
    for (const a of plan.filter((x) => x.kind === "uia-read"))
      expect((a as PlanAction & { readOnly: boolean }).readOnly).toBe(true);
  });

  it("step order: ledger (read-only) first, then the toggles; the queue validates", () => {
    const steps = def0.steps(sel);
    expect(steps[0].id).toBe("p4-l09-ledger");
    expect(steps[0].plan(sel)).toEqual([]);
    expect(steps.slice(1).every((s) => s.risk === "reversible")).toBe(true);
    expect(steps[1].id).toBe("p4-l09-t01-window-hierarchy");
    expect(validateQueue(buildWalkerQueue(def0, steps), false)).toHaveLength(steps.length);
    const rm = def0.steps({ ...sel, module: "ResourceManager" });
    expect(rm.map((s) => s.id)).toEqual(["p4-l09-ledger"]);
    expect(rm[0].title).toMatch(/Qt Introspection Tool: opener, not run; owner L17/);
  });

  it("the CLI dry run prints the outline and PASS", async () => {
    const out: string[] = [];
    const code = await runWalker(def0, ["--out", join(TMP, "plan.json")], {
      out: (l) => out.push(l),
    });
    expect(code).toBe(EXIT.done);
    expect(out.at(-1)).toMatch(/PASS/);
    expect(out.join("\n")).not.toMatch(/FAIL/);
  });
});

describe("L09 against a fake Workbench", () => {
  it("toggles with the g2-05 oracle, toggles back, records false labels once, lines conform", async () => {
    const o = opts();
    const k = fakeKernel();
    const steps = l09Def(() => k).steps(sel);
    const r = await runWalkerSteps(
      steps,
      deps(() => k.windowsUp),
      o,
    );
    expect(r.exit).toBe(EXIT.done);
    const t01 = rec(o, "p4-l09-t01-window-hierarchy");
    expect(t01.status).toBe("pass");
    expect(t01.calls.map((c: { call: string }) => c.call)).toEqual([
      "windows",
      "wb_gui find",
      "wb_module action",
      "wb_gui find",
      "wb_module action",
      "wb_gui find",
    ]);
    const ev = JSON.parse(
      readFileSync(join(o.runDir, "p4-l09-t01-window-hierarchy.oracle.json"), "utf-8"),
    );
    expect(ev.counts).toEqual(FX.g2_05.dock);
    const amp = rec(o, "p4-l09-t03-ampwindow-hierarchy");
    expect(amp.status).toBe("observed");
    expect(amp.calls.filter((c: { call: string }) => c.call === "wb_module action")).toHaveLength(
      1,
    );
    expect(rec(o, "p4-l09-ledger").summary).toMatch(/Edit > Undo: mutating, not run; owner S-E/);
    // only the two accepted paths were sent twice; four false labels once each
    expect(k.sends).toHaveLength(2 * 2 + 4);
    const obs = join(o.runDir, "L09-WorldEditor-edit-none.obs.jsonl");
    const lines = readFileSync(obs, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(validateLine(l, "L09")).toEqual([]);
    expect(lines.map((l) => l.confidence)).toEqual(["high", "high"]);
    // the NORMALISER accepts them
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    copyFileSync(
      join(__dirname, "..", "..", "data", "census", "universes.json"),
      join(data, "universes.json"),
    );
    const io = { out: () => undefined, err: (l: string) => expect.fail(l) };
    expect(
      runNormalise(
        ["--enumerator", "L09", "--build", "test", "--data", data, "--fresh", o.runDir],
        io,
      ),
    ).toBe(0);
    expect(
      runNormalise(
        ["--enumerator", "L09", "--build", "test", "--data", data, "--fresh", "--check", o.runDir],
        io,
      ),
    ).toBe(0);
  });

  it("an unreadable oracle sends nothing; ok with no movement is observed and never re-sent", async () => {
    const o = opts();
    const k = fakeKernel({ findFails: true });
    const [, t01] = l09Def(() => k).steps(sel);
    await runWalkerSteps(
      [t01],
      deps(() => k.windowsUp),
      o,
    );
    expect(rec(o, t01.id).status).toBe("fail");
    expect(k.sends).toHaveLength(0);

    const o2 = opts();
    const k2 = fakeKernel({ moves: false });
    const [, s] = l09Def(() => k2).steps(sel);
    await runWalkerSteps(
      [s],
      deps(() => k2.windowsUp),
      o2,
    );
    expect(rec(o2, s.id).status).toBe("observed");
    expect(k2.sends).toHaveLength(1);
    const line = JSON.parse(
      readFileSync(join(o2.runDir, "L09-WorldEditor-edit-none.obs.jsonl"), "utf-8"),
    );
    expect(line.confidence).toBe("medium");
  });

  it("a new window stops the run, a dialog hands off, a stopped step is never retried", async () => {
    const o = opts();
    const k = fakeKernel({
      onSend: () => k.windowsUp.push({ ...WE, hwnd: 200, title: "Qt Introspection" }),
    });
    const steps = l09Def(() => k).steps(sel);
    const r = await runWalkerSteps(
      steps,
      deps(() => k.windowsUp),
      o,
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe("p4-l09-t01-window-hierarchy");
    expect(existsSync(join(o.runDir, "p4-l09-t02-window-log-console.started"))).toBe(false);
    const again = await runWalkerSteps(
      steps.slice(1),
      deps(() => k.windowsUp),
      o,
    );
    expect(again.exit).toBe(EXIT.refused);

    const o2 = opts();
    const k2 = fakeKernel({
      onSend: () =>
        k2.windowsUp.push({ ...WE, hwnd: 300, title: "Script Authorization Required", owner: 100 }),
    });
    const r2 = await runWalkerSteps(
      l09Def(() => k2).steps(sel),
      deps(() => k2.windowsUp),
      o2,
    );
    expect(r2.exit).toBe(EXIT.handoff);
    expect(k2.sends).toHaveLength(1);
  });

  it("ids and parents are L02's: the sent spelling resolves to the labels L02 read, or no row", async () => {
    expect(resolveMenuPath(["&window", "log console"], [L02_DOC])).toEqual([
      "Window",
      "Log Console",
    ]);
    expect(resolveMenuPath(["Window", "Minimap"], [L02_DOC])).toBeNull();
    const o = opts();
    const k = fakeKernel();
    const [, t01] = l09Def(() => k).steps(sel);
    await runWalkerSteps(
      [t01],
      deps(() => k.windowsUp),
      o,
    );
    const line = JSON.parse(
      readFileSync(join(o.runDir, "L09-WorldEditor-edit-none.obs.jsonl"), "utf-8"),
    );
    expect(deriveId(line)).toBe("ui:WorldEditor/menu-item/Window/Hierarchy");
    expect(line.parent_key.key).toEqual({ path: ["Window"] });
    const o2 = opts(false);
    const k2 = fakeKernel();
    const [, s2] = l09Def(() => k2).steps(sel);
    await runWalkerSteps(
      [s2],
      deps(() => k2.windowsUp),
      o2,
    );
    expect(existsSync(join(o2.runDir, "L09-WorldEditor-edit-none.obs.jsonl"))).toBe(false);
    expect(rec(o2, s2.id).summary).toContain(UNREAD_NOTE);
  });

  it("writes run files only into the run folder, with a started marker first", async () => {
    const o = opts();
    const k = fakeKernel();
    await runWalkerSteps(
      l09Def(() => k)
        .steps(sel)
        .slice(0, 2),
      deps(() => k.windowsUp),
      o,
    );
    const files = readdirSync(o.runDir).sort();
    expect(files).toEqual([
      "L09-WorldEditor-edit-none.obs.jsonl",
      "p4-l02-worldeditor-window-edit-none-menus.json", // L02's read, placed by the test
      "p4-l09-ledger.items.json",
      "p4-l09-ledger.json",
      "p4-l09-ledger.started",
      "p4-l09-t01-window-hierarchy.json",
      "p4-l09-t01-window-hierarchy.oracle.json",
      "p4-l09-t01-window-hierarchy.started",
    ]);
    expect(readdirSync(TMP).every((f) => /^run\d+$|^data$|^plan\.json$/.test(f))).toBe(true);
  });
});
