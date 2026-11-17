import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import {
  CLOSE_COMMAND,
  DEFAULT_QUEUE,
  LAUNCH_ARGS,
  LAUNCH_COMMAND,
  PROPOSAL_FILE,
  RUN_SUB,
  SCRIPT_PATH,
  WINDOWS_FILE,
  buildPlan,
  buildQueue,
  buildSequence,
  checkEntries,
  composeArgs,
  judgeWindows,
  launchCount,
  main,
  menusBlocked,
  proposal,
  runEntries,
  windowsScript,
  type WindowsDoc,
} from "../../scripts/live/p4-4.js";
import { LAUNCHER_CLASS, SCRIPT as L14 } from "../../scripts/census/live/L14-launcher.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { PROBE_MUT_SESSIONS, validateQueue } from "../../scripts/live/preflight.js";

const IN = {
  laneId: "p4-4",
  really: true,
  sandbox: "<addons>/EMCP2_sandbox",
  sittingDir: "<artifacts>/sessions/P4-4/run",
};
const LAUNCHER = "Enfusion Workbench Launcher";
const doc = (over: Partial<WindowsDoc> = {}): WindowsDoc => ({
  pid: 100,
  foreground: { pid: 100, title: LAUNCHER, className: LAUNCHER_CLASS },
  windows: [{ title: LAUNCHER, className: LAUNCHER_CLASS, foreground: true }],
  ...over,
});

describe("P4-4 sequence", () => {
  it("runs lease, launch, windows, walk, menus, propose, close with one launch", () => {
    expect(buildSequence().map((e) => e.id)).toEqual([
      "h-lease",
      "h-launch",
      "w-00",
      "w-01",
      "w-02",
      "t-propose",
      "h-close",
    ]);
    expect(launchCount()).toBe(1);
  });

  it("launches with no project, no settings file and no -scriptAuthorizeAll; installs nothing", () => {
    expect(LAUNCH_ARGS).toEqual([]);
    expect(LAUNCH_COMMAND).toMatch(/--variant launcher-walk/);
    expect(LAUNCH_COMMAND).toMatch(/--queue docs\/v2\/sessions\/queues\/P4-4-queue\.json/);
    expect(LAUNCH_COMMAND).not.toMatch(/--install-handlers "|--probe-pack mod|--force-settings "/);
    expect(LAUNCH_COMMAND).toMatch(/no -scriptAuthorizeAll/);
    expect(CLOSE_COMMAND.split(" (")[0]).not.toMatch(/--remove-probe/);
    expect(CLOSE_COMMAND).toMatch(/WM_CLOSE/);
    expect(CLOSE_COMMAND).not.toMatch(/rollback --/);
  });
});

describe("P4-4 composed commands", () => {
  it("compose L14 with module Launcher, state none, session P4-4, one step each", () => {
    const w1 = composeArgs("w-01", IN);
    if ("refusal" in w1) throw new Error(w1.refusal);
    expect(w1.script).toBe(L14);
    expect(w1.argv).toEqual([
      "--really",
      "--id",
      "p4-4",
      "--sandbox",
      IN.sandbox,
      "--run-dir",
      join(IN.sittingDir, RUN_SUB),
      "--module",
      "Launcher",
      "--state",
      "none",
      "--session",
      "P4-4",
      "--only",
      "p4-l14-walk",
    ]);
    const w0 = composeArgs("w-00", IN);
    if ("refusal" in w0) throw new Error(w0.refusal);
    expect(w0.script).toBe(SCRIPT_PATH);
    expect(w0.argv[0]).toBe("windows");
    for (const e of runEntries()) {
      const r = composeArgs(e.id, IN);
      if ("refusal" in r) throw new Error(r.refusal);
      expect(r.argv.join(" ")).not.toMatch(/scriptauthorizeall|gproj|forcesettings|allow-owned/i);
    }
    expect(composeArgs("h-close", IN)).toHaveProperty("refusal");
    expect(composeArgs("w-01", { ...IN, laneId: "" })).toHaveProperty("refusal");
  });

  it("main refuses launch switches, skips w-02 while no titles, gates w-01 on w-00", async () => {
    const logs: string[] = [];
    let spawned = 0;
    const over = { log: (l: string) => logs.push(l), spawnChild: async () => (spawned++, 0) };
    expect(await main(["--script-authorize-all"], over)).toBe(2);
    const base = ["--id", "p4-4", "--sandbox", IN.sandbox];
    const tmp = mkdtempSync(join(tmpdir(), "p4-4-"));
    const entry = (id: string) => ["--entry", id, ...base, "--sitting-dir", tmp, "--really"];
    const self = (sub: string) => [sub, "--sitting-dir", tmp, "--id", "p4-4", "--really"];
    try {
      expect(await main(entry("w-02"), over)).toBe(0);
      expect(logs.at(-1)).toMatch(/no titles/);
      expect(await main(entry("w-01"), over)).toBe(1);
      expect(spawned).toBe(0);
      const wrong = doc({
        foreground: { pid: 100, title: "Enfusion Workbench", className: LAUNCHER_CLASS },
      });
      const handoff = { ...over, recordedPid: () => 100, readWindows: async () => wrong };
      expect(await main(self("windows"), handoff)).toBe(5);
      expect(await main(entry("w-01"), over)).toBe(1);
      const ok = { ...over, recordedPid: () => 100, readWindows: async () => doc() };
      expect(await main(self("windows"), ok)).toBe(0);
      const rec = JSON.parse(readFileSync(join(tmp, RUN_SUB, WINDOWS_FILE), "utf-8"));
      expect(rec.verdict.ok).toBe(true);
      expect(await main(entry("w-01"), over)).toBe(0);
      expect(spawned).toBe(1);
      expect(await main(self("propose"), over)).toBe(0);
      expect(JSON.parse(readFileSync(join(tmp, PROPOSAL_FILE), "utf-8")).walk_found).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("P4-4 windows and proposal", () => {
  it("walks only the pid's foreground launcher of L14's class, never another window", () => {
    expect(judgeWindows(doc()).ok).toBe(true);
    const otherPid = doc({ foreground: { pid: 7, title: LAUNCHER, className: LAUNCHER_CLASS } });
    expect(judgeWindows(otherPid).exit).toBe(5);
    const otherClass = doc({ foreground: { pid: 100, title: LAUNCHER, className: "Other" } });
    expect(judgeWindows(otherClass).reason).toMatch(/LAUNCHER_CLASS/);
    const withMain = doc({
      windows: [...doc().windows, { title: "Enfusion Workbench", className: LAUNCHER_CLASS }],
    });
    expect(judgeWindows(withMain).ok).toBe(false);
    expect(() => windowsScript(0)).toThrow();
    expect(windowsScript(42)).toContain("[uint32]42");
  });

  it("proposes the walk's menu-bar titles, never the System menu", () => {
    const walk = {
      tree: {
        controlType: "Window",
        children: [
          {
            controlType: "MenuBar",
            name: "System",
            children: [{ controlType: "MenuItem", name: "System" }],
          },
          {
            controlType: "MenuBar",
            children: [
              { controlType: "MenuItem", name: "File" },
              { controlType: "MenuItem", name: "Help" },
            ],
          },
        ],
      },
    };
    expect(proposal(walk).titles).toEqual(["File", "Help"]);
    expect(proposal(null).walk_found).toBe(false);
  });
});

describe("P4-4 plan and queue", () => {
  it("passes the dry-run checks per entry and combined; the launch stays out of the plan", () => {
    const c = checkEntries();
    expect(c.lines.filter((l) => !/: PASS/.test(l))).toEqual([]);
    expect(c.ok).toBe(true);
    expect(checkPlan(buildPlan(), loadPolicy(), { script: SCRIPT_PATH }).violations).toEqual([]);
    expect(buildPlan().map((a) => a.kind)).toEqual(["uia-read"]);
    expect(menusBlocked()).toMatch(/no titles/);
  });

  it("emits a valid P4-4 queue with no pack", () => {
    const q = buildQueue();
    expect(q.session).toBe("P4-4");
    expect(q.launch_packs).toEqual([]);
    expect(q.launch_args).toEqual([]);
    expect(PROBE_MUT_SESSIONS).not.toContain("P4-4");
    const ids = validateQueue(q, false).map((p) => p.id);
    expect(ids).toEqual(["p4-4-w-00-windows", "p4-l14-walk", "p4-l14-menus", "p4-4-t-propose"]);
  });

  it("equals the committed queue file", () => {
    const file = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });
});
