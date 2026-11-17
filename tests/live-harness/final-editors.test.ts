import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EDITORS, planFixtures } from "../../scripts/live/editor-fixtures.js";
import {
  DEFAULT_QUEUE,
  DIALOG_CLASS,
  FIXTURES,
  POSTFLIGHT,
  PREFLIGHT,
  UNREGISTERED_EXTS,
  buildEditors,
  buildQueue,
  dialogsFromUia,
  main,
  particleRead,
  planProblems,
  queueFileFresh,
  runEditor,
  type EditorPlan,
  type RunContext,
  type StepDeps,
  type StepDef,
} from "../../scripts/live/final-editors.js";
import { MockNet, type MockScript } from "../../scripts/live/mock/net.js";
import { MockUia, type UiaNode } from "../../scripts/live/mock/uia.js";
import { SANDBOX_NAME } from "../../scripts/live/paths.js";
import { validateQueue } from "../../scripts/live/preflight.js";

// A vanilla-shaped tree standing in for the one the fixture plan re-paths (as editor-fixtures.test.ts).
const VANILLA = [
  'BehaviorTree "{0123456789ABCDEF}AI/BehaviorTrees/Waypoints/WP_Animate.bt" {',
  ' Name "AI/BehaviorTrees/Waypoints/WP_Animate.bt"',
  " Nodes {",
  "  RootNode Root {",
  '   Name "Root"',
  "   EditorPos 0 80",
  "   Nodes {",
  "    AITaskIdle Idle {",
  '     Name "Idle"',
  "     EditorPos 0 260",
  "     Period 2",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const editors = buildEditors();
const plan = (e: string): EditorPlan => editors.find((p) => p.editor === e)!;
const SANDBOX: RunContext = {
  projectDir: `/addons/${SANDBOX_NAME}`,
  gproj: `/addons/${SANDBOX_NAME}/${SANDBOX_NAME}.gproj`,
  pid: 4242,
};
const FIXTURE_PROJECT: RunContext = {
  projectDir: "/addons/EMCP2_fixtures/EMCP2_fx_WorldEditor",
  gproj: "/addons/EMCP2_fixtures/EMCP2_fx_WorldEditor/addon.gproj",
  pid: 4242,
};

/** Every tool of the queue answers `{ ok: true }` unless the script says otherwise. */
function scriptFor(over: MockScript = {}): MockScript {
  const s: MockScript = {};
  for (const e of editors) for (const st of e.steps) s[st.tool] = { ok: true };
  return { ...s, ...over };
}

/**
 * Tool deps on the NET mock (every call logged in `net.calls`, keyed by tool name) and the
 * accessibility mock (a top-level window of the dialog class is an open dialog). A success answer
 * carries the strings the step expects, so only scripted errors and dialogs stop a run.
 */
function mockDeps(net: MockNet, uia: () => MockUia, opts: { hang?: string } = {}): StepDeps {
  return {
    call: async (step: StepDef, args, timeoutMs) => {
      if (opts.hang === step.id)
        return { ok: false, text: `no answer in ${timeoutMs} ms`, timedOut: true };
      try {
        const r = net.call(step.tool, args);
        return { ok: true, text: JSON.stringify({ ...r, echo: step.expect.contains ?? [] }) };
      } catch (e) {
        return { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
    },
    dialogs: async () => ({ ok: true, modals: dialogsFromUia(uia().root) }),
  };
}

const quiet = (): MockUia => new MockUia({ controlType: "Desktop", name: "", children: [] });

describe("FINAL-editors queue", () => {
  const fixtures = planFixtures(() => VANILLA);

  it("names every editor of the fixture plan, in its order", () => {
    expect(editors.map((e) => e.editor)).toEqual([...EDITORS]);
    const q = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as {
      editors: Array<{ editor: string }>;
    };
    expect(q.editors.map((e) => e.editor)).toEqual([...EDITORS]);
  });

  it("references every fixture file the plan writes, under its own editor, and nothing else", () => {
    for (const editor of EDITORS) {
      const want = fixtures
        .filter((f) => f.editor === editor)
        .map((f) => f.path)
        .sort();
      expect([...FIXTURES[editor]].sort(), editor).toEqual(want);
      const named = new Set(plan(editor).steps.flatMap((s) => s.fixtures));
      for (const f of want) expect(named.has(f), `${editor}: ${f}`).toBe(true);
    }
  });

  it("registers exactly the fixtures of the types the smoke scan reported unregistered, before the editor's other steps", () => {
    for (const e of editors) {
      const reg = e.steps.filter((s) => s.tool === "wb_resources" && s.args.action === "register");
      const want = e.fixtures.filter((f) => UNREGISTERED_EXTS.some((x) => f.endsWith(x)));
      expect(
        reg.map((s) => s.args.path),
        e.editor,
      ).toEqual(want);
      expect(e.steps.slice(0, reg.length)).toEqual(reg);
    }
    expect(plan("BehaviorEditor").steps.some((s) => s.args.action === "register")).toBe(false);
  });

  it("is the file on disk, valid for the pre-flight, with no plan problem", () => {
    expect(queueFileFresh()).toBe(true);
    expect(validateQueue(buildQueue(), false).length).toBeGreaterThan(50);
    expect(planProblems()).toEqual([]);
  });

  it("never saves and keeps every mutating step but register to the sandbox", () => {
    for (const e of editors)
      for (const s of e.steps) {
        expect(s.tool).not.toBe("wb_save");
        expect(s.args.action).not.toBe("save");
        expect(s.args.confirm).not.toBe(true);
        if (s.risk === "mutating" && s.args.action !== "register")
          expect(s.sandboxOnly, s.id).toBe(true);
      }
  });
});

describe("ParticleEditor", () => {
  it("is never read: its plan holds open and front only, and no editor's step names it otherwise", () => {
    const wb = plan("ParticleEditor").steps.filter((s) => s.args.module === "ParticleEditor");
    expect(wb.map((s) => s.args.action)).toEqual(["open", "front"]);
    for (const e of editors)
      for (const s of e.steps) expect(particleRead(e.editor, s), s.id).toBeNull();
    expect(
      plan("ParticleEditor").steps.some((s) => s.tool === "wb_gui" || s.tool === "wb_container"),
    ).toBe(false);
  });

  it("sends nothing but list, logs, register, open and front to the Workbench in a run", async () => {
    const net = new MockNet(scriptFor());
    const r = await runEditor(plan("ParticleEditor"), SANDBOX, mockDeps(net, quiet));
    expect(r.outcome).toBe("passed");
    const wb = net.calls.filter((c) => c.apiFunc === "wb_module").map((c) => c.params.action);
    expect(wb).toEqual(["list", "open", "front"]);
    expect(
      net.calls.some(
        (c) =>
          c.params.module === "ParticleEditor" &&
          !["open", "front"].includes(String(c.params.action)),
      ),
    ).toBe(false);
    expect(r.records.find((x) => x.tool === "owner")?.status).toBe("hand");
  });

  it("refuses a read before sending it", async () => {
    const bad = {
      ...plan("ParticleEditor"),
      steps: [
        {
          ...plan("ParticleEditor").steps[1],
          id: "x",
          args: { action: "info", module: "ParticleEditor" },
        },
      ],
    };
    const net = new MockNet(scriptFor());
    const r = await runEditor(bad, SANDBOX, mockDeps(net, quiet));
    expect(r.outcome).toBe("stopped");
    expect(r.records[0].status).toBe("refused");
    expect(net.calls).toEqual([]);
  });
});

describe("runEditor against the mock", () => {
  it("runs every WorldEditor step in the sandbox, in order", async () => {
    const net = new MockNet(scriptFor());
    const r = await runEditor(plan("WorldEditor"), SANDBOX, mockDeps(net, quiet));
    expect(r.outcome).toBe("passed");
    expect(net.calls.map((c) => c.apiFunc)).toEqual(plan("WorldEditor").steps.map((s) => s.tool));
    expect(net.calls.find((c) => c.apiFunc === "wb_gui")).toBeUndefined();
  });

  it("skips the write steps outside the sandbox and sends none of them", async () => {
    const net = new MockNet(scriptFor());
    const r = await runEditor(plan("WorldEditor"), FIXTURE_PROJECT, mockDeps(net, quiet));
    expect(r.outcome).toBe("passed");
    const writes = plan("WorldEditor").steps.filter((s) => s.sandboxOnly);
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const w of writes) expect(r.records.find((x) => x.id === w.id)?.status).toBe("skipped");
    for (const t of ["wb_entity_create", "wb_entity_modify", "wb_undo_redo", "wb_entity_delete"])
      expect(
        net.calls.some((c) => c.apiFunc === t),
        t,
      ).toBe(false);
  });

  it("stops at the first error: later steps are not sent", async () => {
    const net = new MockNet(scriptFor({ wb_entity_inspect: { error: "Entity not found" } }));
    const steps = plan("WorldEditor").steps;
    const at = steps.findIndex((s) => s.tool === "wb_entity_inspect");
    const r = await runEditor(plan("WorldEditor"), SANDBOX, mockDeps(net, quiet));
    expect(r.outcome).toBe("stopped");
    expect(r.stoppedAt).toBe(steps[at].id);
    expect(r.records.at(-1)?.status).toBe("error");
    expect(net.calls).toHaveLength(at + 1);
  });

  it("stops at an unexpected dialog after a step", async () => {
    const net = new MockNet(scriptFor());
    const dialog: UiaNode = {
      controlType: "Window",
      name: "Save changes?",
      className: DIALOG_CLASS,
    };
    const uia = () =>
      new MockUia({
        controlType: "Desktop",
        name: "",
        children: net.calls.length >= 3 ? [dialog] : [],
      });
    const r = await runEditor(plan("ScriptEditor"), SANDBOX, mockDeps(net, uia));
    expect(r.outcome).toBe("stopped");
    expect(r.records.at(-1)).toMatchObject({ status: "dialog", modals: ["Save changes?"] });
    expect(net.calls).toHaveLength(3);
  });

  it("stops at a mismatch and at a timeout, not retried", async () => {
    const steps = plan("WorldEditor").steps;
    const logs = steps.find((s) => s.tool === "logs_tail")!;
    const mismatchDeps: StepDeps = {
      ...mockDeps(new MockNet(scriptFor()), quiet),
      call: async (s) => ({
        ok: true,
        text:
          s.id === logs.id
            ? `error in ${SANDBOX_NAME}/x.c`
            : JSON.stringify({ echo: s.expect.contains ?? [] }),
      }),
    };
    const m = await runEditor(plan("WorldEditor"), SANDBOX, mismatchDeps);
    expect(m).toMatchObject({ outcome: "stopped", stoppedAt: logs.id });
    expect(m.records.at(-1)?.status).toBe("mismatch");

    const net = new MockNet(scriptFor());
    const t = await runEditor(
      plan("WorldEditor"),
      SANDBOX,
      mockDeps(net, quiet, { hang: steps[2].id }),
    );
    expect(t).toMatchObject({ outcome: "stopped", stoppedAt: steps[2].id });
    expect(t.records.at(-1)?.status).toBe("timeout");
    expect(net.calls).toHaveLength(2);
  });
});

describe("main", () => {
  const dir = mkdtempSync(join(tmpdir(), "emcp-final-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const sandbox = join(dir, "addons", SANDBOX_NAME);
  mkdirSync(sandbox, { recursive: true });
  writeFileSync(join(sandbox, `${SANDBOX_NAME}.gproj`), "GameProject {}\n");
  const artifacts = join(dir, "artifacts");
  mkdirSync(artifacts, { recursive: true });

  it("dry run: no launch, no spawn, no tool call; exit 0", async () => {
    const spawned: string[] = [];
    let deps = 0;
    const lines: string[] = [];
    for (const argv of [
      ["--editor", "all", "--dry-run"],
      ["--editor", "WorldEditor"],
    ]) {
      const code = await main([...argv, "--sandbox", sandbox], {
        log: (l) => lines.push(l),
        spawnChild: async (s) => (spawned.push(s), 0),
        stepDeps: async () => (deps++, mockDeps(new MockNet(scriptFor()), quiet)),
      });
      expect(code).toBe(0);
    }
    expect(spawned).toEqual([]);
    expect(deps).toBe(0);
    expect(lines.some((l) => l.startsWith("dry run: nothing launched"))).toBe(true);
  });

  it("refuses --go for all editors, for the projects layout, and without its options", async () => {
    const spawned: string[] = [];
    const over = { log: () => undefined, spawnChild: async (s: string) => (spawned.push(s), 0) };
    const base = [
      "--sandbox",
      sandbox,
      "--id",
      "fx",
      "--lint",
      "passed",
      "--force-settings",
      "x.ini",
    ];
    expect(await main(["--editor", "all", "--go", ...base], over)).toBe(2);
    expect(
      await main(["--editor", "WorldEditor", "--go", "--layout", "projects", ...base], over),
    ).toBe(2);
    expect(await main(["--editor", "WorldEditor", "--go", "--sandbox", sandbox], over)).toBe(2);
    expect(spawned).toEqual([]);
  });

  it("--go: lease, install, pre-flight, the steps, post-flight, one JSONL; a failing pre-flight still closes", async () => {
    const spawned: string[] = [];
    const outDir = join(artifacts, "run1");
    const code = await main(
      [
        "--editor",
        "LocalizationEditor",
        "--go",
        "--sandbox",
        sandbox,
        "--id",
        "fx",
        "--lint",
        "passed",
        "--force-settings",
        "x.ini",
        "--out-dir",
        outDir,
      ],
      {
        log: () => undefined,
        spawnChild: async (s) => (spawned.push(s), 0),
        stepDeps: async () => mockDeps(new MockNet(scriptFor()), quiet),
        recordedPid: () => 4242,
        artifactsRoot: artifacts,
        writeEvidence: () => null,
      },
    );
    expect(code).toBe(0);
    expect(spawned).toEqual([
      "scripts/live/lane.ts",
      "scripts/live/launch.ts",
      PREFLIGHT,
      POSTFLIGHT,
    ]);
    const file = readdirSync(outDir);
    expect(file).toEqual(["09-LocalizationEditor.jsonl"]);
    const rows = readFileSync(join(outDir, file[0]), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(rows[0].type).toBe("header");
    expect(rows.at(-1)).toMatchObject({ type: "end", outcome: "passed" });
    expect(rows.filter((r) => r.type === "step")).toHaveLength(
      plan("LocalizationEditor").steps.length,
    );

    const spawned2: string[] = [];
    const code2 = await main(
      [
        "--editor",
        "AudioEditor",
        "--go",
        "--sandbox",
        sandbox,
        "--id",
        "fx",
        "--lint",
        "passed",
        "--force-settings",
        "x.ini",
        "--out-dir",
        join(artifacts, "run2"),
      ],
      {
        log: () => undefined,
        spawnChild: async (s) => (spawned2.push(s), s === PREFLIGHT ? 1 : 0),
        stepDeps: async () => mockDeps(new MockNet(scriptFor()), quiet),
        recordedPid: () => 4242,
        artifactsRoot: artifacts,
        writeEvidence: () => null,
      },
    );
    expect(code2).toBe(1);
    expect(spawned2.at(-1)).toBe(POSTFLIGHT);
  });
});
