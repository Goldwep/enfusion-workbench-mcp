import { describe, it, expect } from "vitest";
import {
  checkPlan,
  classifyKey,
  isSandboxProject,
  projectArguments,
  uiaReadCaps,
  type PlanAction,
} from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import type { UiaNode } from "../../scripts/live/mock/uia.js";

const repoPolicy = loadPolicy();

/** Synthetic accessibility tree; names and types are test data, not Workbench facts. */
const TREE: UiaNode = {
  controlType: "Pane",
  name: "Desktop",
  children: [
    {
      controlType: "Window",
      name: "Workbench",
      className: "TestMainClass",
      children: [
        {
          controlType: "MenuBar",
          name: "",
          children: [
            {
              controlType: "MenuItem",
              name: "&File",
              children: [
                { controlType: "MenuItem", name: "Save", automationId: "file.save" },
                { controlType: "MenuItem", name: "E&xit" },
                {
                  controlType: "MenuItem",
                  name: "Recent",
                  children: [{ controlType: "MenuItem", name: "one" }],
                },
              ],
            },
          ],
        },
        { controlType: "Button", name: "Refresh", automationId: "btn.refresh" },
        { controlType: "Button", name: "Delete", automationId: "btn.delete" },
      ],
    },
    {
      controlType: "Window",
      name: "Test probe modal",
      className: "TestProbeClass",
      children: [{ controlType: "Button", name: "OK" }],
    },
  ],
};

function withPolicy(patch: Partial<CensusPolicy>): CensusPolicy {
  return { ...repoPolicy, ...patch };
}

describe("checkPlan", () => {
  it("passes a plan of net calls, menu opens, a non-leaf invoke and screenshots", () => {
    const plan: PlanAction[] = [
      { kind: "net-call", target: "EMCP_WB_Ping" },
      { kind: "menu-open", target: { path: ["File"] } },
      { kind: "invoke", target: { path: ["File", "Recent"] } },
      { kind: "invoke", target: { automationId: "btn.refresh" } },
      { kind: "key", keys: "Escape" },
      { kind: "screenshot" },
    ];
    const r = checkPlan(plan, repoPolicy, { uia: TREE });
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("fails an invoke on a menu leaf with the action index and rule", () => {
    const r = checkPlan(
      [{ kind: "screenshot" }, { kind: "invoke", target: { path: ["File", "Save"] } }],
      repoPolicy,
      { uia: TREE },
    );
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual([
      expect.objectContaining({ index: 1, kind: "invoke", rule: "invoke-menu-leaf" }),
    ]);
  });

  it("fails a menu-open whose target is a leaf", () => {
    const r = checkPlan([{ kind: "menu-open", target: "File > Save" }], repoPolicy, { uia: TREE });
    expect(r.violations.map((v) => v.rule)).toEqual(["invoke-menu-leaf"]);
  });

  it("fails an invoke whose target cannot be resolved", () => {
    const r = checkPlan([{ kind: "invoke", target: { path: ["Nowhere"] } }], repoPolicy, {
      uia: TREE,
    });
    expect(r.violations.map((v) => v.rule)).toEqual(["unresolved-target"]);
  });

  it("fails an invoke when no accessibility tree is given", () => {
    const r = checkPlan([{ kind: "invoke", target: { path: ["File"] } }], repoPolicy);
    expect(r.violations.map((v) => v.rule)).toEqual(["unresolved-target"]);
  });

  it("fails an Enter key in every spelling", () => {
    for (const keys of ["Enter", "RETURN", "{ENTER}", "~", "VK_RETURN", "Shift+Enter"]) {
      const r = checkPlan([{ kind: "key", keys }], repoPolicy);
      expect(r.violations.map((v) => v.rule)).toEqual(["key-enter"]);
    }
  });

  it("fails Alt and Ctrl accelerators", () => {
    for (const keys of ["Alt+F", "Ctrl+S", "ctrl + shift + s", "Alt", "^s", "%f", "F10"]) {
      const r = checkPlan([{ kind: "key", key: keys }], repoPolicy);
      expect(r.violations.map((v) => v.rule)).toEqual(["key-accelerator"]);
    }
  });

  it("fails an invoke on a deny-listed label as well as on the leaf", () => {
    const r = checkPlan([{ kind: "invoke", target: { path: ["File", "Exit"] } }], repoPolicy, {
      uia: TREE,
    });
    expect(r.violations.map((v) => v.rule).sort()).toEqual([
      "deny-listed-path",
      "invoke-menu-leaf",
    ]);
  });

  it("fails an invoke of a deny-listed button resolved by automation id", () => {
    const r = checkPlan([{ kind: "invoke", target: { automationId: "btn.delete" } }], repoPolicy, {
      uia: TREE,
    });
    expect(r.violations.map((v) => v.rule)).toEqual(["deny-listed-path"]);
  });

  it("fails a confirm invoke of a dialog on the never-invoked list", () => {
    const r = checkPlan(
      [
        {
          kind: "invoke",
          target: { automationId: "btn.refresh" },
          dialog: "Publish",
          role: "confirm",
        },
      ],
      repoPolicy,
      { uia: TREE },
    );
    expect(r.violations.map((v) => v.rule)).toEqual(["deny-listed-path"]);
  });

  it("fails an execute-action on a deny-listed path", () => {
    const r = checkPlan(
      [{ kind: "execute-action", target: { path: ["File", "Force Save All"] } }],
      withPolicy({
        execute_action: { ...repoPolicy.execute_action, allow_list: [["File", "Force Save All"]] },
      }),
    );
    expect(r.violations.map((v) => v.rule)).toEqual(["deny-listed-path"]);
  });

  it("fails an execute-action that is not on the allow-list", () => {
    const r = checkPlan(
      [{ kind: "execute-action", target: { path: ["Window", "Console"] } }],
      repoPolicy,
    );
    expect(r.violations.map((v) => v.rule)).toEqual(["not-allow-listed"]);
  });

  it("passes an allow-listed execute-action", () => {
    const policy = withPolicy({
      execute_action: {
        ...repoPolicy.execute_action,
        allow_list: ["Window/Console", ["Window", "Log"]],
      },
    });
    const r = checkPlan(
      [
        { kind: "execute-action", target: { path: ["Window", "Console"] } },
        { kind: "execute-action", target: { path: "Window > Log" } },
      ],
      policy,
    );
    expect(r.ok).toBe(true);
  });

  it("fails a net call to an API that is never called on a live instance", () => {
    const r = checkPlan(
      [
        { kind: "net-call", target: "RunCommandline" },
        { kind: "net-call", target: { apiFunc: "Workbench.Exit" } },
      ],
      repoPolicy,
    );
    expect(r.violations.map((v) => [v.index, v.rule])).toEqual([
      [0, "deny-listed-api"],
      [1, "deny-listed-api"],
    ]);
  });

  it("fails an unknown kind", () => {
    const r = checkPlan([{ kind: "type-text", target: "hello" }], repoPolicy);
    expect(r.violations.map((v) => v.rule)).toEqual(["unknown-kind"]);
  });

  describe("exceptions", () => {
    const policy = withPolicy({
      dry_run: {
        exceptions: [
          {
            id: "modal-test-enter",
            script: "scripts/live/modal-test.ts",
            allows: "key-enter",
            target: { windowClassMatches: "TestProbeClass", titleMatches: "Test probe modal" },
          },
        ],
      },
    });
    const enter: PlanAction = {
      kind: "key",
      keys: "Enter",
      exception: "modal-test-enter",
      target: { window: { className: "TestProbeClass", title: "Test probe modal" } },
    };

    it("lifts the named rule when script, window class and title match", () => {
      const r = checkPlan([enter], policy, { script: "scripts/live/modal-test.ts" });
      expect(r.ok).toBe(true);
      expect(r.exceptionsUsed).toEqual([{ index: 0, id: "modal-test-enter", rule: "key-enter" }]);
    });

    it("does not lift the rule for another window title", () => {
      const r = checkPlan(
        [{ ...enter, target: { window: { className: "TestProbeClass", title: "Save changes?" } } }],
        policy,
        { script: "scripts/live/modal-test.ts" },
      );
      expect(r.violations.map((v) => v.rule)).toEqual(["key-enter"]);
    });

    it("does not lift the rule for another script", () => {
      const r = checkPlan([enter], policy, { script: "scripts/live/other.ts" });
      expect(r.ok).toBe(false);
    });

    it("does not lift a different rule", () => {
      const r = checkPlan([{ ...enter, keys: "Alt+F4" }], policy, {
        script: "scripts/live/modal-test.ts",
      });
      expect(r.violations.map((v) => v.rule)).toEqual(["key-accelerator"]);
    });

    it("lifts the rule at most once per plan", () => {
      const r = checkPlan([enter, enter], policy, { script: "scripts/live/modal-test.ts" });
      expect(r.violations.map((v) => v.index)).toEqual([1]);
    });

    it("does not match the placeholder exception shipped in policy.json", () => {
      const r = checkPlan(
        [{ ...enter, target: { window: { className: "X", title: "ECEN probe modal" } } }],
        repoPolicy,
        { script: "scripts/live/modal-test.ts" },
      );
      expect(r.ok).toBe(false);
    });
  });
});

describe("uia-read", () => {
  const BOUNDS = {
    maxDepth: 40,
    maxNodes: 5000,
    budgetMs: 60_000,
    rowSample: 40,
    maxChildren: 1000,
    countCap: 2000,
    callTimeoutMs: 2000,
    slowCallMs: 250,
    maxConsecutiveErrors: 3,
  };
  const read: PlanAction = {
    kind: "uia-read",
    target: {
      pid: 4242,
      window: { className: "TestMainClass", titlePattern: "Resource Manager.*", allowOwned: false },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: BOUNDS,
  };
  const rules = (a: Partial<PlanAction>, policy: CensusPolicy = repoPolicy) =>
    checkPlan([{ ...read, ...a } as PlanAction], policy).violations.map((v) => v.rule);

  it("passes a targeted, bounded, read-only read with the policy's caps", () => {
    expect(checkPlan([read], repoPolicy).violations).toEqual([]);
    expect(uiaReadCaps(repoPolicy)).toEqual({
      maxDepth: 200,
      maxNodes: 100_000,
      budgetMs: 600_000,
      rowSample: 1000,
      maxChildren: 10_000,
      countCap: 100_000,
      callTimeoutMs: 30_000,
      slowCallMs: 60_000,
      maxConsecutiveErrors: 50,
    });
    // A plan written before the launch names the pid the lane will record.
    expect(
      rules({ target: { ...(read.target as object), pid: "lane-recorded" } as never }),
    ).toEqual([]);
  });

  it("refuses a read that is not targeted by pid, class and title pattern, or names the foreground", () => {
    const t = read.target as unknown as { pid: number; window: Record<string, unknown> };
    expect(rules({ target: { window: t.window } as never })).toEqual(["uia-read-untargeted"]);
    expect(rules({ target: { pid: 0, window: t.window } as never })).toEqual([
      "uia-read-untargeted",
    ]);
    expect(rules({ target: { pid: 1, window: { titlePattern: "x" } } as never })).toEqual([
      "uia-read-untargeted",
    ]);
    expect(rules({ target: { pid: 1, window: { className: "C" } } as never })).toEqual([
      "uia-read-untargeted",
    ]);
    expect(rules({ target: { pid: 1, window: "foreground" } as never })).toContain(
      "uia-read-untargeted",
    );
    expect(rules({ target: { ...t, foreground: true } as never })).toEqual(["uia-read-untargeted"]);
    expect(rules({ target: { pid: 1, window: { ...t.window, hwnd: -5 } } as never })).toEqual([
      "uia-read-untargeted",
    ]);
  });

  it("refuses a bound that is missing, not a positive integer or over the policy cap", () => {
    expect(rules({ bounds: { ...BOUNDS, maxNodes: 100_001 } })).toEqual(["uia-read-unbounded"]);
    expect(rules({ bounds: { ...BOUNDS, budgetMs: 1.5 } })).toEqual(["uia-read-unbounded"]);
    const noCap: Record<string, number> = { ...BOUNDS };
    delete noCap.countCap;
    expect(rules({ bounds: noCap })).toEqual(["uia-read-unbounded"]);
    // Tighter caps in the policy are honoured; no caps at all refuse every bound.
    const tight: CensusPolicy = {
      ...repoPolicy,
      live_lane: { uia_read: { ...uiaReadCaps(repoPolicy), maxNodes: 1000 } },
    };
    expect(rules({}, tight)).toEqual(["uia-read-unbounded"]);
    expect(rules({}, { ...repoPolicy, live_lane: {} })).toHaveLength(9);
  });

  it("refuses a read that acts, and no exception lifts it", () => {
    expect(rules({ readOnly: false })).toEqual(["uia-read-not-read-only"]);
    expect(rules({ keys: "Escape" })).toEqual(["uia-read-not-read-only"]);
    expect(rules({ role: "confirm" })).toEqual(["uia-read-not-read-only"]);
    expect(rules({ target: { ...(read.target as object), automationId: "btn" } as never })).toEqual(
      ["uia-read-not-read-only"],
    );
    const policy = withPolicy({
      dry_run: {
        exceptions: [
          {
            id: "lift",
            allows: "uia-read-not-read-only",
            target: { windowClassMatches: "TestMainClass", titleMatches: "Resource Manager.*" },
          },
        ],
      },
    });
    expect(rules({ readOnly: false, exception: "lift" }, policy)).toEqual([
      "uia-read-not-read-only",
    ]);
  });
});

describe("launch", () => {
  const SANDBOX = "<sandbox>\\EMCP2_sandbox.gproj";
  const launch = (o: Partial<PlanAction>): PlanAction => ({
    kind: "launch",
    target: { gproj: SANDBOX } as unknown as PlanAction["target"],
    args: ["-gproj", SANDBOX, "-exitAfterInit"],
    ...o,
  });
  const rules = (a: PlanAction) => checkPlan([a], repoPolicy).violations.map((v) => v.rule);

  it("passes a -gproj launch of the 2.0 sandbox, in either form and slash style", () => {
    expect(rules(launch({}))).toEqual([]);
    const abs = "C:/x/addons/EMCP2_sandbox/EMCP2_sandbox.gproj";
    expect(
      rules(launch({ target: { gproj: abs } as never, args: [`-gproj=${abs}`, "-noThrow"] })),
    ).toEqual([]);
    expect(isSandboxProject("D:\\a\\emcp2_sandbox\\EMCP2_SANDBOX.gproj")).toBe(true);
    expect(isSandboxProject("D:\\a\\EMCP2_sandbox\\Other.gproj")).toBe(false);
    expect(isSandboxProject("D:\\a\\Test1_sandbox\\EMCP2_sandbox.gproj")).toBe(false);
  });

  it("refuses a deny-listed switch", () => {
    expect(rules(launch({ args: ["-gproj", SANDBOX, "-clearSettings"] }))).toEqual([
      "deny-listed-switch",
    ]);
    expect(rules(launch({ args: ["-gproj", SANDBOX, "-WBBACKENDLOGIN=1"] }))).toEqual([
      "deny-listed-switch",
    ]);
  });

  it("lets -scriptAuthorizeAll through on any launch (owner ruling 2026-11-06, the 2.0 release standard)", () => {
    const saa = ["-gproj", SANDBOX, "-scriptAuthorizeAll"];
    expect(rules(launch({ args: saa }))).toEqual([]);
    expect(rules(launch({ args: saa, ownerGo: "something-else" }))).toEqual([]);
    expect(rules(launch({ args: saa, ownerGo: "scriptAuthorizeAll" }))).toEqual([]);
    // Only that exact token is lifted: every other deny-listed switch is still refused.
    expect(rules(launch({ args: [...saa, "-clearSettings"] }))).toEqual(["deny-listed-switch"]);
    expect(
      rules(launch({ args: [...saa, "-clearSettings"], ownerGo: "scriptAuthorizeAll" })),
    ).toEqual(["deny-listed-switch"]);
  });

  it("refuses a launch of anything but the sandbox, or of no project, or of two", () => {
    const owner = "C:/x/addons/OwnerMod/OwnerMod.gproj";
    expect(rules(launch({ target: { gproj: owner } as never, args: ["-gproj", owner] }))).toEqual([
      "launch-not-sandbox",
    ]);
    expect(rules(launch({ args: ["-exitAfterInit"] }))).toEqual(["launch-not-sandbox"]);
    expect(rules(launch({ args: ["-gproj", SANDBOX, "-gproj", SANDBOX] }))).toEqual([
      "launch-not-sandbox",
    ]);
    // target.gproj must be the project the arguments name.
    expect(rules(launch({ target: { gproj: "<sandbox>\\other.gproj" } as never }))).toEqual([
      "launch-not-sandbox",
    ]);
    expect(rules(launch({ args: "-gproj x" as never }))).toEqual(["launch-not-sandbox"]);
  });

  it("needs the decoy precondition for the old -wbProjectPath form (S-A-1)", () => {
    const old = launch({ args: ["-wbProjectPath", SANDBOX, "-exitAfterInit"] });
    expect(rules(old)).toEqual(["launch-not-sandbox"]);
    expect(rules({ ...old, precondition: { launcherLast: "OwnerMod" } })).toEqual([
      "launch-not-sandbox",
    ]);
    expect(rules({ ...old, precondition: { launcherLast: "EMCP2_decoy" } })).toEqual([]);
    expect(projectArguments(["-wbProjectPath", "a", "-x", "-gproj=b"])).toEqual([
      { sw: "-wbprojectpath", value: "a" },
      { sw: "-gproj", value: "b" },
    ]);
  });
});

describe("classifyKey", () => {
  it("treats plain keys as safe", () => {
    expect(classifyKey("Escape")).toBeNull();
    expect(classifyKey("Tab")).toBeNull();
    expect(classifyKey("Shift+Tab")).toBeNull();
  });
});
