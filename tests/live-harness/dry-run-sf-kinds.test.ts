import { describe, expect, it } from "vitest";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";

// The three S-F action kinds of scripts/live/dry-run.ts: uia-menu, ini-edit, lsp. Paths are
// placeholders, not owner data.
const policy: CensusPolicy = loadPolicy();
const rules = (plan: PlanAction[], p: CensusPolicy = policy) =>
  checkPlan(plan, p, { script: "test" }).violations.map((v) => v.rule);

const menu = (o: Record<string, unknown> = {}): PlanAction => ({
  kind: "uia-menu",
  target: { window: { className: "TestMainClass", title: "^Workbench$" } },
  pid: 4242,
  menus: ["File", "Utilities"],
  depth: 1,
  calls: ["Expand", "Collapse"],
  allowForeground: false,
  timeoutMs: 80_000,
  ...o,
});

describe("uia-menu", () => {
  it("passes against the repo policy", () => {
    expect(rules([menu()])).toEqual([]);
  });
  it("refuses a title off the policy's list, Invoke, depth 2, an element target and keys", () => {
    expect(rules([menu({ menus: ["System"] })])).toContain("uia-menu-not-allow-listed");
    expect(rules([menu({ menus: ["File", "File"] })])).toContain("uia-menu-not-allow-listed");
    expect(rules([menu({ calls: ["Expand", "Invoke"] })])).toContain("uia-menu-not-expand-only");
    expect(rules([menu({ depth: 2 })])).toContain("uia-menu-unbounded");
    expect(rules([menu({ timeoutMs: 10_000_000 })])).toContain("uia-menu-unbounded");
    expect(rules([menu({ keys: "Alt+F" })])).toContain("uia-menu-not-expand-only");
    expect(rules([menu({ pid: 0 })])).toContain("uia-menu-untargeted");
    expect(
      rules([menu({ target: { window: { className: "C", title: "T" }, path: ["File", "Exit"] } })]),
    ).toContain("uia-menu-not-expand-only");
  });
  it("refuses everything when the policy has no uia_menu block", () => {
    const bare = { ...policy, live_lane: { ...policy.live_lane, uia_menu: undefined } };
    expect(rules([menu()], bare)).toContain("uia-menu-not-allow-listed");
  });
  it("no exception lifts it", () => {
    const p = {
      ...policy,
      dry_run: {
        ...(policy.dry_run ?? {}),
        exceptions: [
          {
            id: "x",
            script: "test",
            allows: "uia-menu-not-expand-only",
            target: { windowClassMatches: "TestMainClass", titleMatches: "^Workbench$" },
          },
        ],
      },
    } as unknown as CensusPolicy;
    expect(rules([menu({ calls: ["Invoke"], exception: "x" })], p)).toContain(
      "uia-menu-not-expand-only",
    );
  });
});

const ini = (o: Record<string, unknown> = {}): PlanAction =>
  ({
    kind: "ini-edit",
    command: "set",
    in: "<artifacts>/sessions/S-F/launch1-after.ini",
    out: "<artifacts>/sessions/S-F/launch2.ini",
    artifacts: "<artifacts>",
    keys: ["LSP_Enabled", "LSP_Port", "ScriptTools\\SCR_ImageSetGenerator"],
    workbenchRunning: false,
    ...o,
  }) as unknown as PlanAction;

describe("ini-edit", () => {
  it("passes for the three commands inside the artifacts folder", () => {
    expect(rules([ini()])).toEqual([]);
    expect(rules([ini({ command: "drop-section", keys: undefined })])).toEqual([]);
    expect(rules([ini({ command: "read-keys", out: undefined, keys: undefined })])).toEqual([]);
  });
  it("refuses a bad command, a path outside, out = in, NetAPI keys and a running Workbench", () => {
    expect(rules([ini({ command: "write" })])).toContain("ini-edit-refused");
    expect(rules([ini({ out: "<v2>/x.ini" })])).toContain("ini-edit-refused");
    expect(rules([ini({ in: "<artifacts>/../x.ini" })])).toContain("ini-edit-refused");
    expect(rules([ini({ out: "<artifacts>/sessions/S-F/launch1-after.ini" })])).toContain(
      "ini-edit-refused",
    );
    expect(rules([ini({ keys: ["NetAPI_Port"] })])).toContain("ini-edit-refused");
    expect(rules([ini({ keys: ["netapi_enabled"] })])).toContain("ini-edit-refused");
    expect(rules([ini({ workbenchRunning: true })])).toContain("ini-edit-refused");
    expect(rules([ini({ workbenchRunning: undefined })])).toContain("ini-edit-refused");
  });
});

const lsp = (o: Record<string, unknown> = {}): PlanAction => ({
  kind: "lsp",
  host: "127.0.0.1",
  port: 5776,
  netPort: 5775,
  plan: "session",
  methods: [
    "initialize",
    "initialized",
    "textDocument/didOpen",
    "textDocument/diagnostic",
    "textDocument/hover",
    "textDocument/completion",
  ],
  ...o,
});

describe("lsp", () => {
  it("passes for session and second-client", () => {
    expect(rules([lsp()])).toEqual([]);
    expect(rules([lsp({ plan: "second-client", methods: ["initialize"] })])).toEqual([]);
  });
  it("refuses another host, the NET port, a bad plan and every forbidden method", () => {
    expect(rules([lsp({ host: "localhost" })])).toContain("lsp-refused");
    expect(rules([lsp({ host: "10.0.0.2" })])).toContain("lsp-refused");
    expect(rules([lsp({ port: 5775 })])).toContain("lsp-refused");
    expect(rules([lsp({ plan: "all" })])).toContain("lsp-refused");
    expect(rules([lsp({ methods: [] })])).toContain("lsp-refused");
    for (const m of [
      "textDocument/didSave",
      "textDocument/didChange",
      "workspace/applyEdit",
      "shutdown",
      "exit",
    ]) {
      expect(rules([lsp({ methods: ["initialize", m] })])).toContain("lsp-refused");
    }
  });
});

describe("lsp hoverUri (review F-H4)", () => {
  it("passes inside the sandbox and refuses outside or escaping", () => {
    expect(rules([lsp({ hoverUri: "file:///<addons>/EMCP2_sandbox/Scripts/Game/x.c" })])).toEqual(
      [],
    );
    expect(rules([lsp({ hoverUri: "<sandbox>/Scripts/x.c" })])).toEqual([]);
    for (const u of [
      "file:///<v2>/src/x.c",
      "file:///<addons>/EMCP2_sandbox/../other/x.c",
      "file:///<addons>/EMCP2_sandbox",
      "http://x/EMCP2_sandbox/a.c",
    ]) {
      expect(rules([lsp({ hoverUri: u })])).toContain("lsp-refused");
    }
  });
});
