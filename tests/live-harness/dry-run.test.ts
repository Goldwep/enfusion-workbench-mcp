import { describe, it, expect } from "vitest";
import { checkPlan, classifyKey, type PlanAction } from "../../scripts/live/dry-run.js";
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

describe("classifyKey", () => {
  it("treats plain keys as safe", () => {
    expect(classifyKey("Escape")).toBeNull();
    expect(classifyKey("Tab")).toBeNull();
    expect(classifyKey("Shift+Tab")).toBeNull();
  });
});
