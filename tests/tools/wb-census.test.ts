import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_CENSUS_ROOT } from "../../src/census/ledger-io.js";
import { toJsonl } from "../../src/census/canon.js";
import { loadLedger, type LoadedLedger } from "../../src/census/ledger-io.js";
import { ROW_FIELD_ORDER, type Row } from "../../src/census/schemas.js";
import { NO_REACH, type ReachContext } from "../../src/census/query-engine.js";
import {
  HOWTO_MAX_CHARS,
  howto,
  registerWbCensus,
  registeredActions,
} from "../../src/tools/wb-census.js";
import { run as runBuild } from "../../scripts/census/build.js";
import {
  REAL_CENSUS,
  REPO_ROOT,
  apiClass,
  apiMethod,
  makeCensus,
  mcpTool,
  plantedWindowsPath,
  runIn,
  writeEvidence,
  writeObservations,
  type Fixture,
} from "../census/helpers.js";
import { makeConfig, textOf, type ToolHandler } from "./_tool-harness.js";

const BUILD = "1.0.0.1";
const CLASS = "api:WorldEditorAPI";
const METHOD = "api:WorldEditorAPI.GetSelectedEntity/1";

interface Captured {
  name: string;
  def: { description: string; annotations?: Record<string, unknown> };
  handler: ToolHandler;
}

/** Registers the tool on a fake server and keeps the definition as well as the handler. */
function capture(root?: string): Captured {
  let got: Captured | undefined;
  const fake = {
    registerTool: (name: string, def: Captured["def"], handler: ToolHandler) => {
      got = { name, def, handler };
    },
  } as unknown as McpServer;
  registerWbCensus(fake, makeConfig({}), root);
  if (!got) throw new Error("registerWbCensus did not call registerTool");
  return got;
}

/** A small census: three classes, six methods on one of them, one menu item, one MCP tool. */
function smallCensus(): Fixture {
  const fx = makeCensus(BUILD);
  const getters = ["GetAlpha", "GetBeta", "GetGamma", "GetDelta"];
  writeObservations(fx, "E02", BUILD, [
    apiClass("WorldEditorAPI", { children_count: 6 }),
    apiClass("SCR_MapEntity", { module: "Shared" }),
    apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
    apiMethod("WorldEditorAPI", "SetSelectedEntity", 2, { risk_hint: "mutating" }),
    ...getters.map((m) => apiMethod("WorldEditorAPI", m, 0)),
  ]);
  writeObservations(fx, "E05", BUILD, [
    {
      dim: "ui",
      kind: "menu-item",
      module: "WorldEditor",
      key: { object_name: "actionSaveWorld" },
      label: "Save",
      what: "Saves the open world",
      origin: "vanilla",
      ref: "exe:0x10",
      confidence: "high",
    },
  ]);
  writeObservations(fx, "E11", BUILD, mcpTool("wb_world", ["getSelection"]));
  const r = runIn(fx, runBuild, []);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return fx;
}

async function call(c: Captured, args: Record<string, unknown>) {
  const r = await c.handler(args);
  return { text: textOf(r), isError: r.isError === true };
}

describe("wb_census registration", () => {
  const c = capture(DEFAULT_CENSUS_ROOT);

  it("registers wb_census as read-only and offline", () => {
    expect(c.name).toBe("wb_census");
    expect(c.def.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(c.def.annotations?.openWorldHint).toBe(false);
  });

  it("keeps the description short, since every client receives it every session", () => {
    expect(c.def.description.length).toBeLessThan(450);
  });

  it("resolves the census root two levels above src/census and dist/census alike", () => {
    // ledger-io.ts computes resolve(<dir of ledger-io>, "..", "..", "data", "census"), and both
    // <repo>/src/census and <repo>/dist/census sit two levels below the repository root.
    expect(resolve(REPO_ROOT, "src", "census", "..", "..", "data", "census")).toBe(
      DEFAULT_CENSUS_ROOT,
    );
    expect(resolve(REPO_ROOT, "dist", "census", "..", "..", "data", "census")).toBe(
      DEFAULT_CENSUS_ROOT,
    );
  });
});

describe("wb_census find", () => {
  const fx = smallCensus();
  const c = capture(fx.root);

  it("ranks the exact class name first and lists compact rows", async () => {
    const { text, isError } = await call(c, { action: "find", query: "WorldEditorAPI" });
    expect(isError).toBe(false);
    expect(text).toContain(`census build ${BUILD}`);
    const first = text.split("\n").find((l) => l.startsWith("api:"));
    expect(first).toMatch(/^api:WorldEditorAPI \| class \| \S+ \| T\d\/T\d \| WorldEditorAPI \|/);
    expect(text).toContain("Use describe with an id");
  });

  it("combines dim, kind and module filters", async () => {
    const all = await call(c, { action: "find", query: "Get", kind: "method" });
    expect(all.text).toContain("GetSelectedEntity");
    expect(all.text).not.toContain("| class |");

    const ui = await call(c, { action: "find", query: "Save", dim: "ui", module: "WorldEditor" });
    expect(ui.text).toContain("Found 1 row");
    expect(ui.text).toContain("menu-item");

    const wrongDim = await call(c, { action: "find", query: "Save", dim: "api" });
    expect(wrongDim.text).toContain("No rows match");
  });

  it("filters by tier and allows a filter without a query", async () => {
    const row = (await call(c, { action: "find", query: "WorldEditorAPI" })).text
      .split("\n")
      .find((l) => l.startsWith(`${CLASS} |`));
    const tier = /\| (T\d)\/T\d \|/.exec(row ?? "")?.[1];
    expect(tier).toBeDefined();
    const own = await call(c, { action: "find", tier, kind: "class" });
    expect(own.isError).toBe(false);
    expect(own.text).toContain(CLASS);
    const other = await call(c, { action: "find", query: "Get", kind: "method", tier: "T5" });
    expect(other.text).toContain("No rows match");

    const t5 = await call(c, { action: "find", query: "WorldEditorAPI", tier: "T5" });
    expect(t5.text).toContain("No rows match");
  });

  it("applies the limit and says how many rows were left out", async () => {
    const two = await call(c, { action: "find", query: "Get", kind: "method", limit: 2 });
    const rows = two.text.split("\n").filter((l) => l.startsWith("api:"));
    expect(rows).toHaveLength(2);
    expect(two.text).toMatch(/\d+ more not shown/);

    const wide = await call(c, { action: "find", query: "Get", kind: "method", limit: 50 });
    expect(wide.text.split("\n").filter((l) => l.startsWith("api:")).length).toBeGreaterThan(2);
    expect(wide.text).not.toContain("more not shown");
  });

  it("answers an empty result with a hint, not an error", async () => {
    const r = await call(c, { action: "find", query: "zzzqqqxx" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('No rows match "zzzqqqxx"');
    expect(r.text).toContain("drop a filter");
  });

  it("rejects a find with neither query nor filter", async () => {
    const r = await call(c, { action: "find" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("needs a query");
  });

  it("names the valid values when a filter is outside the vocabulary", async () => {
    const r = await call(c, { action: "find", query: "x", dim: "banana" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('unknown dim "banana"');
    expect(r.text).toContain("api");
  });
});

describe("wb_census describe", () => {
  const fx = smallCensus();
  const c = capture(fx.root);

  it("describes a method: what, where, sources, risk, paths and tier", async () => {
    const { text, isError } = await call(c, { action: "describe", id: METHOD });
    expect(isError).toBe(false);
    expect(text).toContain(`## ${METHOD}`);
    expect(text).toContain("### What it is");
    expect(text).toContain("- Kind: method (dimension api)");
    expect(text).toContain("GetSelectedEntity(int a0)");
    expect(text).toContain("### Where it lives");
    expect(text).toContain("- Module: Shared");
    expect(text).toContain(`- Parent chain: ${CLASS}`);
    expect(text).toContain("- Children: 0 in the ledger");
    expect(text).toMatch(/- E02@1\.0\.0\.1 pak:scripts\/WorldEditorAPI\.c#L10 \(high\)/);
    expect(text).toContain("### Risk");
    expect(text).toMatch(/- safe — /);
    expect(text).toContain("not confirmed");
    expect(text).toContain("### Candidate paths");
    expect(text).toMatch(/- net-api-handler: candidate/);
    expect(text).toContain("### Tier");
    expect(text).toMatch(/- Now T\d, target T\d \(target from /);
  });

  it("describes a class with its children count and a preview of their ids", async () => {
    const { text } = await call(c, { action: "describe", id: CLASS });
    expect(text).toContain("- Children: 6 in the ledger (enumerated: true)");
    expect(text).toContain(`  - ${METHOD}`);
    expect(text).toContain("- Parent: (root row)");
  });

  it("reports a risk the enumerator hinted as unconfirmed", async () => {
    const { text } = await call(c, {
      action: "describe",
      id: "api:WorldEditorAPI.SetSelectedEntity/2",
    });
    expect(text).toMatch(/- mutating — not confirmed/);
  });

  it("answers an unknown id with the nearest ids and no error", async () => {
    const r = await call(c, { action: "describe", id: "api:WorldEditorAPI.GetSelectedEntty/1" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('No row with id "api:WorldEditorAPI.GetSelectedEntty/1"');
    expect(r.text).toMatch(/Nearest ids: .*api:WorldEditorAPI\.GetSelectedEntity\/1/);
  });

  it("needs an id", async () => {
    const r = await call(c, { action: "describe" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("describe needs an id");
  });

  it("resolves an accepted alias to its canonical row", async () => {
    writeEvidence(fx, "EV-s1-001");
    writeFileSync(
      join(fx.root, "aliases.json"),
      JSON.stringify({
        aliases: [
          {
            from: "api:WorldEditorAPI.GetSelection/1",
            to: METHOD,
            why: "same method, older name",
            proposed_by: "worker-a",
            evidence: "EV-s1-001",
          },
        ],
      }),
    );
    const { text } = await call(c, { action: "describe", id: "api:WorldEditorAPI.GetSelection/1" });
    expect(text).toContain(`## ${METHOD}`);
    expect(text).toContain("is an alias: same method, older name");
  });

  it("redacts a machine path that reached a ledger field", async () => {
    const own = smallCensus();
    const ledgerFile = join(own.root, "ledger.jsonl");
    const planted = plantedWindowsPath("x", "y").replace(/\\/g, "\\\\");
    const text = readFileSync(ledgerFile, "utf-8").replace(
      '"what":"The WorldEditorAPI class"',
      `"what":"${planted}"`,
    );
    writeFileSync(ledgerFile, text);
    const r = await call(capture(own.root), { action: "describe", id: CLASS });
    expect(r.text).toContain("<redacted-path>");
    expect(r.text).not.toContain(plantedWindowsPath("x", "y"));
  });
});

describe("wb_census status", () => {
  const fx = smallCensus();
  const c = capture(fx.root);

  it("reports the build, enumerators and counts per dimension and tier", async () => {
    const { text, isError } = await call(c, { action: "status" });
    expect(isError).toBe(false);
    expect(text).toContain("## Census status");
    expect(text).toContain(`census build ${BUILD} (stable, en)`);
    expect(text).toMatch(/Enumerators done: E02, E05, E11/);
    expect(text).toMatch(/Enumerators pending: .*E03/);
    expect(text).toMatch(/dimension +T0 +T1 +T2 +T3 +T4 +T5 +total/);
    expect(text).toMatch(/\n {2}api +\d+ +\d+ +\d+ +\d+ +\d+ +\d+ +8\n/);
    expect(text).toMatch(/\n {2}ui +\d+ +\d+ +\d+ +\d+ +\d+ +\d+ +1\n/);
    expect(text).toContain("Gate results are not evaluated");
  });

  it("narrows the counts with a dimension filter", async () => {
    const { text } = await call(c, { action: "status", dim: "ui" });
    expect(text).toContain("Counts below cover only dim=ui");
    expect(text).not.toMatch(/\n {2}api /);
  });
});

describe("wb_census data problems", () => {
  it("says so when there is no ledger under the census root", async () => {
    const empty = mkdtempSync(join(tmpdir(), "census-empty-"));
    const r = await call(capture(empty), { action: "status" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no ledger found");
  });

  it("returns an error, not a crash, for a malformed ledger line", async () => {
    const fx = makeCensus(BUILD);
    writeFileSync(join(fx.root, "ledger.jsonl"), "not json\n");
    const r = await call(capture(fx.root), { action: "find", query: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Error querying census");
    expect(r.text).toContain("ledger.jsonl line 1");
  });

  it("picks up a rebuilt ledger without a restart", async () => {
    const fx = smallCensus();
    const c = capture(fx.root);
    expect((await call(c, { action: "find", query: "SCR_NewThing" })).text).toContain("No rows");
    writeObservations(fx, "E02", BUILD, [
      apiClass("WorldEditorAPI", { children_count: 6 }),
      apiClass("SCR_MapEntity", { module: "Shared" }),
      apiClass("SCR_NewThing", { module: "Shared" }),
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
      apiMethod("WorldEditorAPI", "SetSelectedEntity", 2, { risk_hint: "mutating" }),
      ...["GetAlpha", "GetBeta", "GetGamma", "GetDelta"].map((m) =>
        apiMethod("WorldEditorAPI", m, 0),
      ),
    ]);
    runIn(fx, runBuild, []);
    expect((await call(c, { action: "find", query: "SCR_NewThing" })).text).toContain(
      "api:SCR_NewThing",
    );
  });
});

describe.skipIf(!existsSync(join(REAL_CENSUS, "ledger.jsonl")))(
  "wb_census on the shipped ledger",
  () => {
    const c = capture(undefined);

    it("reads the default census root", () => {
      expect(existsSync(join(DEFAULT_CENSUS_ROOT, "ledger.meta.json"))).toBe(true);
    });

    it("finds rows for WorldEditorAPI and describes one of them", async () => {
      const found = await call(c, { action: "find", query: "WorldEditorAPI" });
      expect(found.isError).toBe(false);
      const ids = found.text
        .split("\n")
        .filter((l) => /^[a-z]+:\S+ \| /.test(l))
        .map((l) => l.split(" | ")[0]);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).toContain(CLASS);

      const described = await call(c, { action: "describe", id: CLASS });
      expect(described.isError).toBe(false);
      expect(described.text).toContain(`## ${CLASS}`);
      expect(described.text).toContain("- Kind: class");
      expect(described.text).toMatch(/- Children: \d+ in the ledger/);
      expect(described.text).toMatch(/- E02@\S+ pak:/);

      const status = await call(c, { action: "status" });
      expect(status.text).toMatch(/Enumerators done: .*E02/);
    });
  },
);

// ── howto ─────────────────────────────────────────────────────────────────────

function howtoRow(id: string, extra: Partial<Row> = {}): Row {
  const kind = (extra.kind ?? "menu-item") as Row["kind"];
  const name = id.split("/").pop() as string;
  return {
    id,
    shard: "core",
    dim: "ui",
    kind,
    module: "WorldEditor",
    parent: null,
    label: name,
    what: `Row for ${name}`,
    risk_confirmed: false,
    origin: "vanilla",
    aggregate: false,
    provisional: false,
    sources: [{ enumerator: "L01", build: BUILD, ref: "ev:EV-s1-001", confidence: "high" }],
    build: { first_seen: BUILD, last_seen: BUILD },
    children_enumerated: "n/a",
    observed_states: [],
    status: "active",
    paths: [],
    tier: "T2",
    target_tier: "T5",
    target_tier_source: "policy",
    tier_evidence: [],
    weak_only: false,
    mcp: [],
    mcp_proposed: [],
    tests: [],
    unverified: [],
    ...extra,
  } as Row;
}

const HOWTO_ROWS: Row[] = [
  howtoRow("ui:WorldEditor/menu-item/Save", {
    paths: [{ path: "net-api-handler", status: "verified", evidence: "EV-s1-042" }],
    chosen_path: "net-api-handler",
    mcp: [{ action: "mcp:action/wb_world.state", role: "drive" }],
    risk: "mutating",
  }),
  howtoRow("ui:ResourceManager/menu-item/Save", {
    module: "ResourceManager",
    paths: [{ path: "execute-action", status: "candidate" }],
  }),
  howtoRow("ui:WorldEditor/menu-item/Frobnicate", {
    mcp: [{ action: "mcp:action/wb_world.nosuchaction", role: "drive" }],
  }),
  howtoRow("ui:WorldEditor/menu-item/Pan", {
    mcp: [{ action: "mcp:action/wb_world.stop", role: "drive" }],
  }),
  howtoRow("plugin:Spawner", {
    dim: "plugin",
    kind: "plugin",
    module: "none",
    paths: [{ path: "plugin-run", status: "candidate" }],
  }),
  howtoRow("ui:WorldEditor/tool/Brush", {
    kind: "tool",
    paths: [
      { path: "net-api-handler", status: "candidate" },
      { path: "gui-automation", status: "candidate" },
    ],
  }),
  howtoRow("cli:-validate", {
    dim: "cli",
    kind: "cli-switch",
    module: "none",
    paths: [{ path: "cli", status: "candidate" }],
  }),
  howtoRow("ui:WorldEditor/tool/Lonely", {
    kind: "tool",
    paths: [{ path: "net-api-handler", status: "candidate" }],
  }),
  ...["WorldEditor", "ResourceManager", "ScriptEditor", "AnimEditor"].map((m) =>
    howtoRow(`ui:${m}/menu-item/Toggle Grid`, {
      module: m as Row["module"],
      paths: [{ path: "gui-automation", status: "candidate" }],
    }),
  ),
];

function howtoCensus(rows: Row[] = HOWTO_ROWS): { c: Captured; ledger: LoadedLedger } {
  const fx = makeCensus(BUILD);
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(join(fx.root, "ledger.jsonl"), toJsonl(sorted, ROW_FIELD_ORDER));
  writeFileSync(
    join(fx.root, "ledger.meta.json"),
    JSON.stringify({
      build: { tag: BUILD, branch: "stable", ui_language: "en" },
      enumerators: { done: ["L01"], pending: [] },
    }) + "\n",
  );
  return { c: capture(fx.root), ledger: loadLedger(fx.paths) };
}

describe("wb_census howto", () => {
  const { c, ledger } = howtoCensus();
  const ask = async (q: string) => (await call(c, { action: "howto", query: q })).text;
  const registered = new Map([["wb_world", ["state", "stop"]]]);

  it("keeps the tool description under 400 characters", () => {
    expect(c.def.description.length).toBeLessThan(400);
  });

  it("reads a question frame and a quoted name, and the module breaks a tie", async () => {
    const we = await ask("How do I use the menu item 'Save' in the World Editor?");
    expect(we.split("\n")[0]).toContain("ui:WorldEditor/menu-item/Save");
    expect(we).toContain("Use: wb_world action state");
    const rm = await ask("How do I use the menu item 'Save' in the Resource Manager?");
    expect(rm.split("\n")[0]).toContain("ui:ResourceManager/menu-item/Save");
  });

  it("reads unquoted task phrasing: frame, verb and articles are dropped", async () => {
    for (const q of [
      "how do I frobnicate",
      "How can I frobnicate?",
      "how to frobnicate",
      "I want to use the Frobnicate",
    ]) {
      expect((await ask(q)).split("\n")[0], q).toContain("ui:WorldEditor/menu-item/Frobnicate");
    }
  });

  it("lists rows that fit equally well and says it could not choose, instead of taking the first", async () => {
    const text = await ask("how do I toggle the grid");
    const first = text.split("\n")[0];
    expect(first).toBe("Ambiguous: 4 rows fit equally well; howto could not choose one.");
    expect(first).not.toContain("ui:");
    expect(text.match(/^- ui:[A-Za-z]+\/menu-item\/Toggle Grid /gm)).toHaveLength(4);
    expect(text).toContain("not drivable yet");
    expect(text).not.toContain("wb_gui invoke");
    const r = howto(ledger, [], "how do I toggle the grid");
    expect(r.ambiguous?.count).toBe(4);
    expect(r.id).toBeUndefined();
    // The module named breaks the tie: one row, with the others as Also.
    const we = await ask("how do I toggle the grid in the World Editor");
    expect(we.split("\n")[0]).toContain("ui:WorldEditor/menu-item/Toggle Grid");
  });

  it("names the tier now and the target", async () => {
    expect(await ask("ui:WorldEditor/menu-item/Save")).toContain("Tier: T2 now, T5 target");
  });

  it("falls back to the tool of a path kind when it can act on the row today, and says so", () => {
    const reach: ReachContext = {
      ...NO_REACH,
      locators: new Set(["ui:WorldEditor/tool/Brush"]),
      guiActions: new Set(["invoke"]),
      guiRows: new Set(["ui:WorldEditor/tool/Brush"]),
      menuRefusal: () => null,
      pluginRun: new Set(["Spawner"]),
      cliAllow: new Set(["verb:-validate"]),
    };
    const ask2 = (q: string) => howto(ledger, [], q, { reach }).text;
    expect(ask2("ui:ResourceManager/menu-item/Save")).toContain(
      "Use: wb_menu action run (via the execute-action path, candidate",
    );
    expect(ask2("plugin:Spawner")).toContain("Use: wb_plugin action run");
    const gui = ask2("ui:WorldEditor/tool/Brush");
    expect(gui).toContain("Use: wb_gui action invoke (via the gui-automation path");
    expect(gui).toContain("ENFUSION_GUI=1");
    expect(ask2("cli:-validate")).toContain("Use: wb_cli_run (via the cli path");
  });

  it("says 'not drivable yet' with the reason when the tool would refuse the row today", () => {
    const gui = howto(ledger, [], "ui:WorldEditor/tool/Brush");
    expect(gui.text).toContain("Use: not drivable yet: no locator on this build");
    expect(gui.text).not.toContain("wb_gui");
    expect(gui.tool).toBeUndefined();
    expect(gui.drivable).toBe(false);
    expect(gui.blocker).toBe("no locator on this build");
    const located = howto(ledger, [], "ui:WorldEditor/tool/Brush", {
      reach: { ...NO_REACH, locators: new Set(["ui:WorldEditor/tool/Brush"]) },
    });
    expect(located.text).toContain("wb_gui invoke is GATED");
    const menu = howto(ledger, [], "ui:ResourceManager/menu-item/Save", {
      reach: { ...NO_REACH, menuRefusal: () => "not on the run allow-list (P-W8-22)" },
    });
    expect(menu.text).toContain(
      "Use: not drivable yet: wb_menu run refuses it: not on the run allow-list (P-W8-22)",
    );
    expect(howto(ledger, [], "plugin:Spawner").text).toContain("plugin_run_allow_list");
  });

  it("names wb_diag for a diag row and wb_settings for a setting row, not wb_gui", () => {
    const rows = [
      howtoRow("diag:AI", {
        dim: "diag",
        kind: "diag-menu",
        module: "Shared",
        paths: [{ path: "gui-automation", status: "candidate" }],
      }),
      howtoRow("diag:AI/Debug", {
        dim: "diag",
        kind: "diag-option",
        module: "Shared",
        paths: [{ path: "gui-automation", status: "candidate" }],
      }),
      howtoRow("diag:Render/Rain", {
        dim: "diag",
        kind: "diag-option",
        module: "Shared",
        paths: [{ path: "gui-automation", status: "candidate" }],
      }),
      howtoRow("setting:Editor/grid", {
        dim: "setting",
        kind: "setting-key",
        paths: [{ path: "gui-automation", status: "candidate" }],
      }),
      howtoRow("setting:Options", { dim: "setting", kind: "option" }),
    ];
    const lg = howtoCensus(rows).ledger;
    const reach: ReachContext = {
      ...NO_REACH,
      diag: new Map([
        ["ai", { enumName: "DEBUGUI_AI", kind: "menu" }],
        ["ai/debug", { enumName: "DEBUGUI_AI_DEBUG", kind: "bool" }],
        ["render/rain", { enumName: "DEBUGUI_RAIN", kind: "range" }],
      ]),
    };
    const a = (id: string) => howto(lg, [], id, { reach });
    expect(a("diag:AI").text).toContain("Use: wb_diag action select");
    const opt = a("diag:AI/Debug");
    expect(opt.text).toContain("Use: wb_diag action get");
    expect(opt.text).toContain("DEBUGUI_AI_DEBUG");
    expect(a("diag:Render/Rain").text).toContain(
      "Use: not drivable yet: wb_diag refuses range ids",
    );
    expect(a("setting:Editor/grid").text).toContain("Use: wb_settings action get");
    expect(a("setting:Options").text).toContain(
      "Use: not drivable yet: wb_settings options is GATED",
    );
    for (const id of ["diag:AI", "diag:AI/Debug", "setting:Editor/grid"])
      expect(a(id).text).not.toContain("wb_gui");
  });

  it("answers a tool name from the tool's own row when no row links to it", () => {
    const rows = [
      howtoRow("mcp:tool/api_search", {
        dim: "mcp",
        kind: "mcp-tool",
        module: "none",
        label: "api_search",
        what: "Search the script API.",
      }),
      howtoRow("mcp:action/api_search.run", {
        dim: "mcp",
        kind: "mcp-action",
        module: "none",
        label: "api_search.run",
        parent: "mcp:tool/api_search",
      }),
    ];
    const lg = howtoCensus(rows).ledger;
    const r = howto(lg, [], "api_search", { registered: new Map() });
    expect(r.found).toBe(true);
    expect(r.text).toContain("api_search: no row links to it");
    expect(r.text).toContain("Row: mcp:tool/api_search");
    expect(r.text).toContain("Accepts: run");
    expect(r.text).not.toContain("no tool reaches this row");
    const bad = howto(lg, [], "api_search.nope", { registered: new Map() });
    expect(bad.text).toContain(
      'Warning: api_search has no registered action "nope" (registered: run)',
    );
  });

  it("says plainly when no tool reaches the row", async () => {
    const text = await ask("ui:WorldEditor/tool/Lonely");
    expect(text).toContain("Use: no tool reaches this row");
    const r = howto(ledger, [], "ui:WorldEditor/tool/Lonely");
    expect(r.tool).toBeUndefined();
    expect(r.found).toBe(true);
  });

  it("lists the rows linked to a tool or a tool.action", async () => {
    const tool = await ask("wb_world");
    expect(tool).toContain("wb_world: 3 rows link it");
    expect(tool).toContain("ui:WorldEditor/menu-item/Save");
    expect(tool).toContain("ui:WorldEditor/menu-item/Pan");
    const one = await ask("wb_world.stop");
    expect(one).toContain("wb_world.stop: 1 row link it");
    expect(one).toContain("ui:WorldEditor/menu-item/Pan");
    expect(one).not.toContain("Save");
    const none = howto(ledger, [], "wb_world.play", {
      registered: new Map([["wb_world", ["play"]]]),
    });
    expect(none.found).toBe(false);
    expect(none.text).toContain("no row links to it");
    expect(none.reverse).toEqual({ tool: "wb_world", action: "play", count: 0 });
  });

  it("flags an action the tool does not register, in both directions", () => {
    const row = howto(ledger, [], "ui:WorldEditor/menu-item/Frobnicate", { registered });
    expect(row.registered).toBe(false);
    expect(row.text).toContain('Warning: wb_world has no registered action "nosuchaction"');
    expect(row.text).toContain("registered: state, stop");
    const ok = howto(ledger, [], "ui:WorldEditor/menu-item/Pan", { registered });
    expect(ok.registered).toBe(true);
    expect(ok.text).not.toContain("Warning");
    const rev = howto(ledger, [], "wb_world", { registered });
    expect(rev.text).toContain("Warning: not registered for wb_world: nosuchaction");
    const one = howto(ledger, [], "wb_world.nosuchaction", { registered });
    expect(one.text).toContain('no registered action "nosuchaction"');
  });

  it("reads the shipped handler contracts for the registered actions", async () => {
    expect(registeredActions().get("wb_world")).toContain("state");
    // What the tools accept: legacy names kept, actions left to other tools removed.
    const terrain = registeredActions().get("wb_terrain") ?? [];
    expect(terrain).toEqual(expect.arrayContaining(["getHeight", "getBounds", "heights", "info"]));
    for (const gone of ["inspect", "navmesh_status", "road_export_graph"])
      expect(terrain).not.toContain(gone);
    expect(registeredActions().get("wb_localization")).toEqual(
      expect.arrayContaining(["modify", "getTable", "listLanguages"]),
    );
    expect(await ask("ui:WorldEditor/menu-item/Frobnicate")).toContain(
      'Warning: wb_world has no registered action "nosuchaction"',
    );
    expect(await ask("ui:WorldEditor/menu-item/Save")).not.toContain("Warning");
  });

  it("leaves a tool without a contract unchecked", () => {
    const r = howto(ledger, [], "ui:WorldEditor/menu-item/Save", { registered: new Map() });
    expect(r.registered).toBeUndefined();
    expect(r.text).not.toContain("Warning");
  });

  it("says when nothing matches", async () => {
    expect(await ask("how do I zzzzqqqq")).toContain("No row matches");
  });

  it("caps every answer at 600 characters", async () => {
    const long = howtoRow("ui:WorldEditor/menu-item/Verbose", {
      paths: [{ path: "cli", status: "candidate", evidence: "EV-" + "x".repeat(900) }],
      mcp: [{ action: "mcp:action/wb_world.nosuchaction", role: "drive" }],
    });
    const many = Array.from({ length: 40 }, (_, i) =>
      howtoRow(`ui:WorldEditor/menu-item/Verbose Many ${i}`, {
        mcp: [{ action: "mcp:action/wb_long_tool_name.act" + i, role: "drive" }],
      }),
    );
    const big = howtoCensus([...HOWTO_ROWS, long, ...many]);
    for (const q of [
      "ui:WorldEditor/menu-item/Verbose",
      "how do I use verbose",
      "wb_long_tool_name",
      "wb_world",
    ]) {
      const t = (await call(big.c, { action: "howto", query: q })).text;
      expect(t.length, q).toBeLessThanOrEqual(HOWTO_MAX_CHARS);
    }
  });
});
