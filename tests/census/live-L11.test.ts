import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import {
  EXIT,
  buildWalkerQueue,
  runWalkerSteps,
  validateLine,
  type WalkerDeps,
  type WalkerStep,
} from "../../scripts/census/live/common.js";
import { mergeObservations } from "../../scripts/census/live/normalise.js";
import {
  buildSteps,
  declaredModules,
  def,
  matrixPairs,
  stepId,
  type E03Row,
  type PluginTool,
} from "../../scripts/census/live/L11-plugins.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l11-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "live", "L11-plugin-reads.json"), "utf-8"),
) as {
  plugins: Record<
    string,
    { describe: Record<string, unknown>; getSettings: Record<string, unknown> }
  >;
  e03: E03Row[];
};
const ALLOW = [
  { module: "WorldEditor", className: "SCR_SnapAndOrientToTerrainPlugin" },
  { module: "ScriptEditor", className: "SCR_CopyClassAndMethodPlugin" },
  { module: "ScriptEditor", className: "SCR_DebugLinePlugin" },
];
const { pairs } = matrixPairs(ALLOW, FIX.e03);

function fakeTool(
  sent: Array<Record<string, unknown>>,
  over?: Partial<Record<string, unknown>>,
): () => PluginTool {
  return () => async (args) => {
    sent.push(args);
    if (over?.[String(args.action)]) return over[String(args.action)] as Record<string, unknown>;
    const f = FIX.plugins[String(args.className)];
    return (args.action === "describe" ? f.describe : f.getSettings) as Record<string, unknown>;
  };
}

function deps(files: Map<string, string>, pid = 4242): WalkerDeps {
  return {
    windows: async () => [],
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => pid,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: (p) => files.has(p),
    writeFile: (p, t) => void files.set(p, t),
    appendFile: (p, t) => void files.set(p, (files.get(p) ?? "") + t),
    log: () => undefined,
  };
}
const o = (runDir: string) => ({
  enumerator: "L11",
  script: "scripts/census/live/L11-plugins.ts",
  session: "P4-1",
  runDir,
  module: "WorldEditor",
  state: {},
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});

// A sandbox-like fixture block of the real fixtures is used by the steps; the readback holds
// "readback" with the P3-3 shape.
const wrap = (r: Record<string, unknown>) => ({ ok: true, readback: r });
for (const f of Object.values(FIX.plugins)) {
  f.describe = wrap(f.describe.readback as Record<string, unknown>);
  f.getSettings = wrap(f.getSettings.readback as Record<string, unknown>);
}

describe("L11 matrix", () => {
  it("keeps only allow-listed pairs in the modules E03 declares", () => {
    expect(pairs).toHaveLength(3);
    const r = matrixPairs([{ module: "WorldEditor", className: "SCR_DebugLinePlugin" }], FIX.e03);
    expect(r.pairs).toHaveLength(0);
    expect(r.dropped[0].why).toContain("ScriptEditor");
    expect(
      declaredModules({
        kind: "plugin",
        signature: 'x(wbModules: { "ScriptEditor", "WorldEditor" })',
      }),
    ).toEqual(["ScriptEditor", "WorldEditor"]);
  });
  it("the real def plans the policy allow-list, and the plan is clean and holds only EMCP_WB_Plugin reads", () => {
    const steps = def.steps({ module: "WorldEditor", state: {}, allowOwned: false });
    expect(steps.map((s) => s.id)).toEqual(pairs.map(stepId));
    const plan = steps.flatMap((s) =>
      s.plan({ module: "WorldEditor", state: {}, allowOwned: false }),
    );
    expect(checkPlan(plan, loadPolicy(), { script: def.script }).ok).toBe(true);
    for (const a of plan as unknown as Array<Record<string, unknown>>) {
      expect(a.kind).toBe("net-call");
      expect(a.target).toBe("EMCP_WB_Plugin");
      expect(["describe", "getSettings"]).toContain((a.params as Record<string, unknown>).action);
    }
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/"run"|setSettings|RunCommandline|Configure|"key"|Enter|invoke/);
    const q = buildWalkerQueue(def, steps);
    expect(validateQueue(q, false)).toHaveLength(steps.length);
  });
});

describe("L11 run", () => {
  it("steps run in order, send only describe and getSettings, and the lines merge", async () => {
    const run = join(TMP, "run1");
    const sent: Array<Record<string, unknown>> = [];
    const files = new Map<string, string>();
    const r = await runWalkerSteps(buildSteps(pairs, fakeTool(sent)), deps(files), o(run));
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => x.step)).toEqual(pairs.map(stepId));
    expect(r.records.every((x) => x.status === "pass")).toBe(true);
    expect(sent.map((s) => s.action)).toEqual(pairs.flatMap(() => ["describe", "getSettings"]));
    expect([...files.keys()].some((k) => k.endsWith(".started"))).toBe(true);
    // ctx.emit writes through deps.appendFile, one obs file per plugin module.
    const obsFiles = [...files.keys()].filter((f) => f.endsWith(".obs.jsonl"));
    expect(obsFiles.map((f) => f.slice(run.length + 1)).sort()).toEqual([
      "L11-ScriptEditor-none.obs.jsonl",
      "L11-WorldEditor-none.obs.jsonl",
    ]);
    const lines = obsFiles
      .flatMap((f) => files.get(f)!.trim().split("\n"))
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(validateLine(l, "L11")).toEqual([]);
      expect(l.dim).toBe("plugin");
      expect(l.class_name).toBe(l.key.class);
      expect(l.confidence).toBe("high");
    }
    expect(lines.map((l) => (l as { key: { class: string } }).key.class).sort()).toEqual(
      ALLOW.map((a) => a.className).sort(),
    );
    // the merge accepts them: common.ts knows the plugin kind and the { class } key
    const m = mergeObservations(
      obsFiles.map((f) => ({ source: f, text: files.get(f)! })),
      { enumerator: "L11", build: "t", def: { generator: def.script } },
    );
    expect(m.rejected).toEqual([]);
    expect(m.rows).toBe(3);
  });
  it("a refusal is a recorded observation with no row; a hard code stops the run", async () => {
    const run = join(TMP, "run2");
    const refused = { ok: false, code: "MODULE_NOT_OPEN", message: "not open" };
    const r = await runWalkerSteps(
      buildSteps(pairs.slice(0, 1), fakeTool([], { describe: refused })),
      deps(new Map()),
      o(run),
    );
    expect(r.records[0].status).toBe("observed");
    expect(existsSync(run) ? readdirSync(run).filter((f) => f.endsWith(".obs.jsonl")) : []).toEqual(
      [],
    );
    const hard = await runWalkerSteps(
      buildSteps(
        pairs,
        fakeTool([], { describe: { ok: false, code: "MODAL_OPEN", message: "m" } }),
      ),
      deps(new Map()),
      o(join(TMP, "run3")),
    );
    expect(hard.exit).toBe(EXIT.stopped);
    expect(hard.records).toHaveLength(1);
  });
  it("an absent plugin gives no row; a new window stops the step; a started step is not rerun", async () => {
    const absent = wrap({ present: 0, instance: 0, message: "no" });
    const run = join(TMP, "run4");
    const r = await runWalkerSteps(
      buildSteps(pairs.slice(0, 1), fakeTool([], { describe: absent })),
      deps(new Map()),
      o(run),
    );
    expect(r.records[0].status).toBe("observed");
    let n = 0;
    const d = deps(new Map());
    d.windows = async () =>
      n++ > 0
        ? [{ pid: 4242, className: "Qt683QWindowIcon", title: "Stray", owner: 0 } as never]
        : [];
    const step: WalkerStep = {
      ...buildSteps(pairs.slice(0, 1), fakeTool([]))[0],
      run: async (ctx) => {
        await ctx.sleep(1);
        await ctx.sleep(1);
        return { status: "pass", summary: "" };
      },
    };
    expect((await runWalkerSteps([step], d, o(join(TMP, "run5")))).exit).toBe(EXIT.stopped);
    const files = new Map<string, string>();
    const dd = deps(files);
    await runWalkerSteps(buildSteps(pairs.slice(0, 1), fakeTool([])), dd, o(join(TMP, "run6")));
    const again = await runWalkerSteps(
      buildSteps(pairs.slice(0, 1), fakeTool([])),
      dd,
      o(join(TMP, "run6")),
    );
    expect(again.exit).toBe(EXIT.refused);
  });
});
