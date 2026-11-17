import { describe, expect, it } from "vitest";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { DIALOG_COMMIT_BUTTONS } from "../../src/tools/wb-gui.js";

// The Phase 4 plan kinds of scripts/live/dry-run.ts (design 2.2): uia-context, uia-dialog-cancel,
// the execute-action dialog opener, and uia-menu titles_by_module. Labels are placeholders.
const policy: CensusPolicy = loadPolicy();
const L04 = "scripts/census/live/L04-dialogs.ts";
const rules = (plan: PlanAction[], p: CensusPolicy = policy, script = "test") =>
  checkPlan(plan, p, { script }).violations.map((v) => v.rule);

const withLane = (extra: Record<string, unknown>): CensusPolicy => ({
  ...policy,
  live_lane: { ...policy.live_lane, ...extra },
});
const ctxPolicy = withLane({
  uia_context: {
    perTargetMs: 15000,
    targets: [{ module: "WorldEditor", path: ["Hierarchy", "Entity"] }],
  },
});

const ctx = (o: Record<string, unknown> = {}): PlanAction => ({
  kind: "uia-context",
  target: {
    pid: "lane-recorded",
    window: { className: "Qt683QWindowIcon", titlePattern: "^World Editor - .+$" },
    path: ["Hierarchy", "Entity"],
  },
  module: "WorldEditor",
  calls: ["ShowContextMenu", "Collapse"],
  timeoutMs: 10_000,
  ...o,
});

const cancel = (o: Record<string, unknown> = {}): PlanAction => ({
  kind: "uia-dialog-cancel",
  target: {
    pid: "lane-recorded",
    window: { className: "Qt683QWindowIcon", title: "Options", owned: true },
  },
  button: "Cancel",
  calls: ["Invoke"],
  exception: "p4-d14-options-cancel",
  ...o,
});

describe("uia-context", () => {
  it("passes on a listed target with ShowContextMenu and Collapse", () => {
    expect(rules([ctx()], ctxPolicy)).toEqual([]);
    expect(rules([ctx({ calls: ["ShowContextMenu"] })], ctxPolicy)).toEqual([]);
  });
  it("the repo policy lists no target yet, so every uia-context is refused", () => {
    expect(rules([ctx()])).toContain("uia-context-not-allow-listed");
  });
  it("refuses any call other than ShowContextMenu then Collapse", () => {
    for (const calls of [
      ["Invoke"],
      ["ShowContextMenu", "Invoke"],
      ["Collapse"],
      ["Collapse", "ShowContextMenu"],
      ["ShowContextMenu", "Collapse", "Collapse"],
      ["Expand"],
      [],
    ])
      expect(rules([ctx({ calls })], ctxPolicy), JSON.stringify(calls)).toContain(
        "uia-context-not-show-only",
      );
  });
  it("refuses keys, a button, params, an automationId and a role", () => {
    for (const extra of [
      { keys: "Enter" },
      { key: "Esc" },
      { button: "Cancel" },
      { params: {} },
      { role: "confirm" },
      { dialog: "x" },
    ])
      expect(rules([ctx(extra)], ctxPolicy)).toContain("uia-context-not-show-only");
    const t = { ...(ctx().target as object), automationId: "A.B" };
    expect(rules([ctx({ target: t })], ctxPolicy)).toContain("uia-context-not-show-only");
  });
  it("refuses an untargeted, unlisted, other-module or unbounded action, and a missing block", () => {
    expect(rules([ctx({ target: { pid: 0, window: {}, path: [] } })], ctxPolicy)).toContain(
      "uia-context-untargeted",
    );
    const other = { ...(ctx().target as object), path: ["Hierarchy", "Other"] };
    expect(rules([ctx({ target: other })], ctxPolicy)).toContain("uia-context-not-allow-listed");
    expect(rules([ctx({ module: "ResourceManager" })], ctxPolicy)).toContain(
      "uia-context-not-allow-listed",
    );
    expect(rules([ctx({ timeoutMs: 60_000 })], ctxPolicy)).toContain("uia-context-unbounded");
    expect(rules([ctx()], withLane({ uia_context: undefined }))).toContain(
      "uia-context-not-allow-listed",
    );
  });
  it("no exception lifts a uia-context rule", () => {
    const p: CensusPolicy = {
      ...policy,
      dry_run: {
        ...policy.dry_run,
        exceptions: [
          {
            id: "x",
            allows: "uia-context-not-allow-listed",
            target: { windowClassMatches: "Qt683QWindowIcon" },
          },
        ],
      },
    };
    expect(rules([ctx({ exception: "x" })], p)).toContain("uia-context-not-allow-listed");
  });
});

describe("uia-context deny-listed-path (review P4 F3)", () => {
  it("an exception naming deny-listed-path does not lift it on a uia-context", () => {
    const denied = deniedLabel();
    const p = withLane({
      uia_context: {
        perTargetMs: 15000,
        targets: [{ module: "WorldEditor", path: ["Hierarchy", denied] }],
      },
    });
    const pe: CensusPolicy = {
      ...p,
      dry_run: {
        ...p.dry_run,
        exceptions: [
          {
            id: "x",
            allows: "deny-listed-path",
            target: { windowClassMatches: "Qt683QWindowIcon" },
          },
        ],
      },
    };
    const t = { ...(ctx().target as Record<string, unknown>), path: ["Hierarchy", denied] };
    const r = checkPlan([ctx({ target: t, exception: "x" })], pe, { script: "test" });
    expect(r.violations.map((v) => v.rule)).toContain("deny-listed-path");
    expect(r.exceptionsUsed).toEqual([]);
  });
});

describe("uia-dialog-cancel", () => {
  it("Cancel on the Options dialog passes only for L04 under the D14 exception", () => {
    expect(rules([cancel()], policy, L04)).toEqual([]);
    expect(rules([cancel()], policy, "scripts/census/live/L06-grids.ts")).toContain(
      "uia-dialog-cancel-not-allow-listed",
    );
    expect(rules([cancel({ exception: undefined })], policy, L04)).toContain(
      "uia-dialog-cancel-not-allow-listed",
    );
    const other = {
      pid: "lane-recorded",
      window: { className: "Qt683QWindowIcon", title: "Save World As", owned: true },
    };
    expect(rules([cancel({ target: other })], policy, L04)).toContain(
      "uia-dialog-cancel-not-allow-listed",
    );
  });
  it("the D14 exception is used once per plan", () => {
    expect(rules([cancel(), cancel()], policy, L04)).toContain(
      "uia-dialog-cancel-not-allow-listed",
    );
  });
  it("the title-bar Close passes with titleBar: true", () => {
    expect(rules([cancel({ button: "Close", titleBar: true })], policy, L04)).toEqual([]);
    expect(rules([cancel({ button: "Close" })], policy, L04)).toContain(
      "uia-dialog-cancel-refused",
    );
    expect(rules([cancel({ titleBar: true })], policy, L04)).toContain("uia-dialog-cancel-refused");
  });
  it("refuses every other label, every commit button, and near spellings of Cancel", () => {
    for (const b of [
      ...DIALOG_COMMIT_BUTTONS,
      "cancel",
      "Cancel ",
      "&Cancel",
      "No",
      "Discard",
      "Don't Save",
      undefined,
    ])
      expect(rules([cancel({ button: b })], policy, L04), String(b)).toContain(
        "uia-dialog-cancel-refused",
      );
  });
  it("refuses calls other than one Invoke, keys, a path, an automationId, params, a role", () => {
    for (const calls of [["Invoke", "Invoke"], ["Toggle"], [], undefined])
      expect(rules([cancel({ calls })], policy, L04)).toContain("uia-dialog-cancel-refused");
    for (const extra of [{ keys: "Esc" }, { key: "Enter" }, { params: {} }, { role: "confirm" }])
      expect(rules([cancel(extra)], policy, L04)).toContain("uia-dialog-cancel-refused");
    const withPath = { ...(cancel().target as object), path: ["Options", "OK"] };
    expect(rules([cancel({ target: withPath })], policy, L04)).toContain(
      "uia-dialog-cancel-refused",
    );
  });
  it("refuses an unowned window, a missing title, a bad pid; no exception lifts those", () => {
    const unowned = {
      pid: "lane-recorded",
      window: { className: "Qt683QWindowIcon", title: "Options", owned: false },
    };
    expect(rules([cancel({ target: unowned })], policy, L04)).toContain(
      "uia-dialog-cancel-untargeted",
    );
    expect(rules([cancel({ target: { pid: 0, window: { owned: true } } })], policy, L04)).toContain(
      "uia-dialog-cancel-untargeted",
    );
  });
});

describe("execute-action dialog openers", () => {
  const opener = (path: string[], o: Record<string, unknown> = {}): PlanAction => ({
    kind: "execute-action",
    target: { path, module: "WorldEditor" },
    opensDialog: true,
    ...o,
  });
  it("the repo list is empty, so every opener is refused", () => {
    expect(rules([opener(["Edit", "Options..."])])).toContain("dialog-opener-not-listed");
  });
  it("a listed opener passes; an unlisted one, opensDialog false, or a deny-listed one does not", () => {
    const p = withLane({ dialog_openers: { paths: [["Edit", "Options..."]] } });
    expect(rules([opener(["Edit", "Options..."])], p)).toEqual([]);
    expect(rules([opener(["Edit", "Other..."])], p)).toContain("dialog-opener-not-listed");
    expect(rules([opener(["Edit", "Options..."], { opensDialog: false })], p)).toContain(
      "dialog-opener-not-listed",
    );
    const denied = deniedLabel();
    const pd = withLane({ dialog_openers: { paths: [["File", denied]] } });
    expect(rules([opener(["File", denied])], pd)).toContain("deny-listed-path");
  });
});

describe("execute-action under DEC-100: proven, candidate, observed dialog opener", () => {
  const ea = (path: string[], o: Record<string, unknown> = {}): PlanAction => ({
    kind: "execute-action",
    target: { path, module: "WorldEditor" },
    ...o,
  });
  const ml = ["Window", "Manage Layouts"];
  it("a proven path passes; a candidate passes only marked candidate, and a proven path marked candidate does not", () => {
    expect(rules([ea(["Entities", "Select Layer"])])).toEqual([]);
    expect(rules([ea(["Entities", "Select Children"])])).toContain("not-allow-listed");
    expect(rules([ea(["Entities", "Select Children"], { candidate: true })])).toEqual([]);
    expect(rules([ea(["Entities", "Select Layer"], { candidate: true })])).toContain(
      "not-allow-listed",
    );
  });
  it("Window > Manage Layouts is refused dialog-opener-observed by every route, and no exception lifts it", () => {
    expect(rules([ea(ml)])).toContain("dialog-opener-observed");
    expect(rules([ea(ml, { candidate: true })])).toContain("dialog-opener-observed");
    const net: PlanAction = {
      kind: "net-call",
      target: "EMCP_WB_ExecuteAction",
      params: { menuPath: ml },
    } as PlanAction;
    expect(rules([net])).toContain("dialog-opener-observed");
    const lifted: CensusPolicy = {
      ...policy,
      dry_run: {
        ...policy.dry_run,
        exceptions: [{ id: "x", script: "test", allows: "dialog-opener-observed", target: {} }],
      },
    };
    expect(rules([ea(ml, { exception: "x" })], lifted)).toContain("dialog-opener-observed");
  });
});

function deniedLabel(): string {
  const seed = policy.execute_action?.deny_list_seed ?? [];
  const lists = Object.values(policy.deny_lists ?? {}).flatMap((l) => l?.labels ?? []);
  const label = [...seed, ...lists][0];
  if (!label) throw new Error("the policy holds no denied label");
  return label;
}

describe("uia-menu titles_by_module", () => {
  const menu = (o: Record<string, unknown> = {}): PlanAction => ({
    kind: "uia-menu",
    target: { window: { className: "Qt683QWindowIcon", title: "^World Editor - .+$" } },
    pid: "lane-recorded",
    menus: ["Game", "Entities"],
    module: "WorldEditor",
    depth: 1,
    calls: ["Expand", "Collapse"],
    timeoutMs: 80_000,
    ...o,
  });
  it("the World Editor's nine titles pass with its module; Game is not a Resource Manager title", () => {
    expect(rules([menu()])).toEqual([]);
    expect(
      rules([
        menu({
          menus: ["File", "Edit", "View", "Game", "Tools", "Window", "Plugins", "Entities", "Help"],
          timeoutMs: 320_000,
        }),
      ]),
    ).toEqual([]);
    expect(rules([menu({ module: "ResourceManager" })])).toContain("uia-menu-not-allow-listed");
    expect(rules([menu({ module: undefined })])).toContain("uia-menu-not-allow-listed");
    // A module with no titles_by_module entry (the Particle Editor is never read, DEC-042; the
    // Audio Editor gained its titles from sitting P4-2 on 2026-10-12).
    expect(rules([menu({ module: "ParticleEditor", menus: ["File"] })])).toContain(
      "uia-menu-not-allow-listed",
    );
    expect(rules([menu({ module: "AudioEditor", menus: ["File"], timeoutMs: 20_000 })])).toEqual(
      [],
    );
    expect(rules([menu({ menus: ["System"] })])).toContain("uia-menu-not-allow-listed");
  });
});
