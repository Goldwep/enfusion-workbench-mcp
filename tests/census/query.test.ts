import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toJsonl } from "../../src/census/canon.js";
import { loadLedger } from "../../src/census/ledger-io.js";
import { find } from "../../src/census/query-engine.js";
import { ROW_FIELD_ORDER, type Row } from "../../src/census/schemas.js";
import { KINDS, MODULES } from "../../src/census/vocab.js";
import { run as runExists } from "../../scripts/census/exists.js";
import {
  SETTINGS_ROOT_SECTION,
  callLine,
  rowIdFromPath,
  run as runQuery,
  settingsArgs,
  toolCall,
  withCallLine,
} from "../../scripts/census/query.js";
import { ROOT_SECTION } from "../../scripts/census/enumerators/e06-settings-store.js";
import type { DiagEntry } from "../../src/census/diag-catalog.js";
import {
  apiClass,
  apiMethod,
  makeCensus,
  plantedWindowsPath,
  runIn,
  spawnScript,
  writeObservations,
  type Fixture,
} from "./helpers.js";

function fakeRow(i: number, extra: Partial<Row> = {}): Row {
  const kind = KINDS[i % KINDS.length];
  return {
    id: `ui:WorldEditor/${kind}/Item ${String(i).padStart(5, "0")}`,
    shard: "core",
    dim: "ui",
    kind,
    module: MODULES[i % 11],
    parent: null,
    label: `Item ${i} ${["alpha", "bravo", "charlie", "delta", "echo"][i % 5]}`,
    what: `Synthetic row number ${i} for the timing test`,
    risk_confirmed: false,
    origin: "vanilla",
    aggregate: false,
    provisional: false,
    sources: [{ enumerator: "L01", build: "1.0.0.1", ref: "ev:EV-s1-001", confidence: "high" }],
    build: { first_seen: "1.0.0.1", last_seen: "1.0.0.1" },
    children_enumerated: "n/a",
    observed_states: [],
    status: "active",
    paths: [],
    tier: "T0",
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

function writeLedger(fx: Fixture, rows: Row[]): void {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(join(fx.root, "ledger.jsonl"), toJsonl(sorted, ROW_FIELD_ORDER));
  writeFileSync(
    join(fx.root, "ledger.meta.json"),
    JSON.stringify({
      build: { tag: "1.0.0.1", branch: "stable", ui_language: "en" },
      enumerators: { done: ["L01"], pending: [] },
    }) + "\n",
  );
}

function bigCensus(): Fixture {
  const fx = makeCensus();
  writeLedger(
    fx,
    Array.from({ length: 10_000 }, (_, i) => fakeRow(i)),
  );
  return fx;
}

describe("query.ts find", () => {
  it("loads 10,000 rows and answers find in under 2 s", () => {
    const fx = bigCensus();
    const t0 = performance.now();
    const ledger = loadLedger(fx.paths);
    const res = find(ledger, "charlie");
    const ms = performance.now() - t0;
    expect(ledger.rows).toHaveLength(10_000);
    expect(res.count).toBe(2_000);
    expect(ms).toBeLessThan(2_000);
  });

  it("caps output: a broad query returns 20 rows per page and clamps --limit to 200", () => {
    const fx = bigCensus();
    let r = runIn(fx, runQuery, ["find", "e", "--json"]);
    let out = JSON.parse(r.stdout);
    expect(out.count).toBeGreaterThan(200);
    expect(out.rows).toHaveLength(20);
    r = runIn(fx, runQuery, ["find", "e", "--json", "--limit", "5000"]);
    out = JSON.parse(r.stdout);
    expect(out.rows).toHaveLength(200);
    expect(out.pageSize).toBe(200);
  });

  it("prints the paginated text shape", () => {
    const fx = bigCensus();
    const r = runIn(fx, runQuery, ["find", "delta", "--page", "2"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Page 2 of 100 — showing results 21–40 of 2000");
    expect(r.stdout).toContain("Next: call again with page=3.");
  });

  it("ranks exact id, then exact label, then prefix, then substring", () => {
    const fx = makeCensus();
    writeLedger(fx, [
      fakeRow(1, { id: "ui:WorldEditor/menu-item/Save", label: "Save" }),
      fakeRow(2, { id: "ui:WorldEditor/menu-item/Save All", label: "Save All" }),
      fakeRow(3, { id: "ui:WorldEditor/menu-item/Autosave", label: "Autosave" }),
      fakeRow(4, { id: "ui:WorldEditor/menu-item/X", label: "Unrelated" }),
    ]);
    const ledger = loadLedger(fx.paths);
    expect(find(ledger, "Save").rows.map((r) => r.label)).toEqual(["Save", "Save All", "Autosave"]);
    expect(find(ledger, "ui:WorldEditor/menu-item/Autosave").rows[0].label).toBe("Autosave");
  });

  it("takes a text that starts with a dash as the text, not as an option", () => {
    const fx = makeCensus();
    writeLedger(fx, [fakeRow(1, { label: "-forceSaveAll" }), fakeRow(2)]);
    const dashed = runIn(fx, runQuery, ["find", "-forceSaveAll", "--limit", "5"]);
    expect(dashed.code).toBe(0);
    expect(dashed.stdout).toContain("-forceSaveAll");
    expect(runIn(fx, runQuery, ["find", "--limit", "5", "Item 2"]).code).toBe(0);
    expect(runIn(fx, runQuery, ["find", "--nope", "x"]).code).not.toBe(0);
  });

  it("exits 1 with a hint when nothing matches", () => {
    const fx = bigCensus();
    const r = runIn(fx, runQuery, ["find", "zzzzqqq"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("No rows match");
  });

  it("emits a single JSON document", () => {
    const fx = bigCensus();
    const r = spawnScript("scripts/census/query.ts", [
      "find",
      "alpha",
      "--json",
      "--data",
      fx.root,
    ]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.ok).toBe(true);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });
});

describe("query.ts describe", () => {
  it("names the canonical id first when resolved through an alias", () => {
    const fx = makeCensus();
    writeLedger(fx, [fakeRow(1, { id: "ui:WorldEditor/menu-item/#actionSave", label: "Save" })]);
    writeFileSync(
      fx.paths.aliases,
      JSON.stringify({
        aliases: [
          {
            from: "ui:WorldEditor/menu-item/File/Save",
            to: "ui:WorldEditor/menu-item/#actionSave",
            why: "same action",
            proposed_by: "w",
            evidence: "EV-s1-001",
          },
        ],
      }),
    );
    const r = runIn(fx, runQuery, ["describe", "ui:WorldEditor/menu-item/File/Save"]);
    const lines = r.stdout.split("\n");
    expect(lines[0]).toBe("id: ui:WorldEditor/menu-item/#actionSave");
    expect(lines[1]).toMatch(/^via alias: ui:WorldEditor\/menu-item\/File\/Save/);
    expect(r.stdout).toContain("paths:");
  });

  it("prints NOT FOUND with near ids and exits 1", () => {
    const fx = bigCensus();
    const r = runIn(fx, runQuery, ["describe", "ui:WorldEditor/menu/Item 00052"]);
    expect(r.code).toBe(1);
    expect(r.stdout.split("\n")[0]).toBe("NOT FOUND: ui:WorldEditor/menu/Item 00052");
    expect(r.stdout).toContain("near: ");
  });

  it("redacts a machine path in printed text", () => {
    const fx = makeCensus();
    writeLedger(fx, [fakeRow(1, { what: `see ${plantedWindowsPath("x")}` })]);
    const r = runIn(fx, runQuery, ["describe", fakeRow(1).id]);
    expect(r.stdout).toContain("<redacted-path>");
    expect(r.stdout).not.toContain("someone");
  });
});

describe("query.ts robustness", () => {
  it("rejects an unknown command with exit 2", () => {
    const fx = bigCensus();
    expect(runIn(fx, runQuery, ["frobnicate"]).code).toBe(2);
  });

  it("exits 2 when no ledger was built", () => {
    const fx = makeCensus();
    const r = runIn(fx, runQuery, ["find", "x"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("run build.ts");
  });

  it("reports the bad line of a malformed ledger and exits 3", () => {
    const fx = makeCensus();
    const lines = Array.from({ length: 8 }, (_, i) => JSON.stringify(fakeRow(i)));
    lines[6] = "{";
    writeFileSync(join(fx.root, "ledger.jsonl"), lines.join("\n") + "\n\n");
    const r = runIn(fx, runQuery, ["find", "x"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("line 7");
  });

  it("loads only ledger files", () => {
    const fx = bigCensus();
    mkdirSync(join(fx.root, "observations", "E02"), { recursive: true });
    writeFileSync(join(fx.root, "observations", "E02", "x.jsonl"), "{ not json\n");
    writeFileSync(fx.paths.state, "{ not json\n");
    writeFileSync(join(fx.root, "universes.json"), "{ not json");
    const r = runIn(fx, runQuery, ["find", "bravo", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).count).toBe(2_000);
  });

  it("prints the status histogram with no single percentage", () => {
    const fx = bigCensus();
    const r = runIn(fx, runQuery, ["status"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("tier histogram: T0 10000");
    expect(r.stdout).not.toContain("%");
  });
});

describe("exists.ts", () => {
  function existsCensus(): Fixture {
    const fx = makeCensus();
    writeObservations(fx, "E02", "1.0.0.1", [
      apiClass("WorldEditorAPI"),
      apiMethod("WorldEditorAPI", "GetUserName", 0),
    ]);
    return fx;
  }

  it("distinguishes no data from absent", () => {
    const fx = makeCensus();
    writeObservations(fx, "E07", "1.0.0.1", [
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "wbProjectPath" },
        origin: "vanilla",
        ref: "wiki:CLI#x",
        confidence: "medium",
      },
    ]);
    const r = runIn(fx, runExists, ["wbProjectPath"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("NO DATA");
  });

  it("finds an exact symbol in the script-source index", () => {
    const fx = existsCensus();
    const r = runIn(fx, runExists, ["GetUserName"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("FOUND GetUserName");
    expect(r.stdout).toContain("api:WorldEditorAPI.GetUserName/0 | method | E02@1.0.0.1");
    expect(runIn(fx, runExists, ["WorldEditorAPI.GetUserName"]).code).toBe(0);
    expect(runIn(fx, runExists, ["api:WorldEditorAPI.GetUserName/0"]).code).toBe(0);
  });

  it("refuses near matches and answers no for a prefix of a known symbol", () => {
    const fx = existsCensus();
    const r = runIn(fx, runExists, ["GetUserNam"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("NOT FOUND: GetUserNam");
    expect(r.stdout).toContain("near: GetUserName");
  });

  it("matches case-insensitively only with --ci", () => {
    const fx = existsCensus();
    expect(runIn(fx, runExists, ["getusername"]).code).toBe(1);
    expect(runIn(fx, runExists, ["getusername", "--ci"]).code).toBe(0);
  });

  it("never answers from wiki observations", () => {
    const fx = existsCensus();
    writeObservations(fx, "E07", "1.0.0.1", [
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "wbProjectPath" },
        origin: "vanilla",
        ref: "wiki:CLI#x",
        confidence: "medium",
      },
    ]);
    expect(runIn(fx, runExists, ["-wbProjectPath"]).code).toBe(1);
  });
});

describe("query.ts howto", () => {
  const linked = (extra: Partial<Row> = {}): Row =>
    fakeRow(7, {
      id: "ui:WorldEditor/menu-item/Save",
      label: "Save",
      risk: "mutating",
      paths: [
        { path: "gui-automation", status: "candidate" },
        { path: "net-api-handler", status: "verified", evidence: "EV-s001-042" },
        { path: "cli", status: "refuted" },
      ],
      mcp: [{ action: "mcp:action/prefab.create", role: "drive" }],
      ...extra,
    } as Partial<Row>);

  it("gives path, tool, action, safety and evidence, within 600 characters", () => {
    const fx = makeCensus();
    writeLedger(fx, [linked()]);
    const r = runIn(fx, runQuery, ["howto", "Save"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Tier: T0 now, T5 target");
    expect(r.stdout).toContain("Path: net-api-handler (verified)");
    expect(r.stdout).toContain("Use: prefab action create");
    expect(r.stdout).toContain("Safety: mutating (proposed)");
    expect(r.stdout).toContain("Evidence: EV-s001-042");
    expect(r.stdout).not.toContain("Enable with");
    expect(r.stdout.trim().length).toBeLessThanOrEqual(600);
  });

  it("says to enable a tool outside the core tier", () => {
    const fx = makeCensus();
    writeLedger(fx, [
      linked({ mcp: [{ action: "mcp:action/terrain_inspect.run", role: "read" }] } as Partial<Row>),
    ]);
    const r = runIn(fx, runQuery, ["howto", "ui:WorldEditor/menu-item/Save", "--json"]);
    const out = JSON.parse(r.stdout);
    expect(out.enable).toBe("ENFUSION_TOOLS=+terrain_inspect");
    expect(out.text).toContain("Enable with ENFUSION_TOOLS=+terrain_inspect");
  });

  it("says so when no tool is linked, and exits 1 for an unknown row", () => {
    const fx = makeCensus();
    writeLedger(fx, [
      linked({
        mcp: [],
        paths: [{ path: "net-api-handler", status: "candidate" }],
      } as Partial<Row>),
    ]);
    expect(runIn(fx, runQuery, ["howto", "Save"]).stdout).toContain("no tool reaches this row");
    expect(runIn(fx, runQuery, ["howto", "zzzzzzzzqq"]).code).toBe(1);
  });

  it("reports a row whose paths are all refuted as such", () => {
    const fx = makeCensus();
    writeLedger(fx, [
      linked({
        chosen_path: "cli",
        paths: [{ path: "cli", status: "refuted" }],
        mcp: [],
      } as Partial<Row>),
    ]);
    const r = runIn(fx, runQuery, ["howto", "Save"]);
    expect(r.stdout).toContain("Path: all recorded paths refuted");
    expect(r.stdout).not.toContain("cli (");
  });

  it("caps a long answer at 600 characters", () => {
    const fx = makeCensus();
    writeLedger(fx, [
      linked({
        paths: [{ path: "cli", status: "candidate", evidence: "EV-s001-001-" + "x".repeat(900) }],
      } as Partial<Row>),
    ]);
    expect(runIn(fx, runQuery, ["howto", "Save"]).stdout.trim().length).toBeLessThanOrEqual(600);
  });
});

describe("query.ts howto: tasks, fallback, reverse lookup", () => {
  const rows = (): Row[] => [
    fakeRow(1, {
      id: "ui:WorldEditor/menu-item/Save",
      kind: "menu-item",
      module: "WorldEditor",
      label: "Save",
      mcp: [{ action: "mcp:action/wb_world.state", role: "drive" }],
    } as Partial<Row>),
    fakeRow(2, {
      id: "ui:ResourceManager/menu-item/Save",
      kind: "menu-item",
      module: "ResourceManager",
      label: "Save",
      paths: [{ path: "execute-action", status: "candidate" }],
    } as Partial<Row>),
    fakeRow(3, {
      id: "ui:WorldEditor/menu-item/Frobnicate",
      kind: "menu-item",
      module: "WorldEditor",
      label: "Frobnicate",
      mcp: [{ action: "mcp:action/wb_world.nosuchaction", role: "drive" }],
    } as Partial<Row>),
  ];

  it("answers a task phrasing and breaks a tie by the module named", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    const we = runIn(fx, runQuery, [
      "howto",
      "How do I use the menu item 'Save' in the World Editor?",
    ]);
    expect(we.code).toBe(0);
    expect(we.stdout.split("\n")[0]).toContain("ui:WorldEditor/menu-item/Save");
    expect(we.stdout).toContain("Use: wb_world action state");
    const rm = runIn(fx, runQuery, [
      "howto",
      "how do I use the menu item 'Save' in the Resource Manager",
    ]);
    expect(rm.stdout.split("\n")[0]).toContain("ui:ResourceManager/menu-item/Save");
    // wb_menu run drives the World Editor only and needs the allow-list: not drivable here.
    expect(rm.stdout).toContain("Use: not drivable yet: wb_menu run refuses it");
    expect(rm.stdout).toContain("Also: ui:WorldEditor/menu-item/Save");
  });

  it("lists the rows linked to a tool or a tool.action", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    const all = runIn(fx, runQuery, ["howto", "wb_world", "--json"]);
    const out = JSON.parse(all.stdout);
    expect(out.reverse).toEqual({ tool: "wb_world", action: undefined, count: 2 });
    expect(out.text).toContain("wb_world: 2 rows link it");
    const one = runIn(fx, runQuery, ["howto", "wb_world.state"]);
    expect(one.code).toBe(0);
    expect(one.stdout).toContain("ui:WorldEditor/menu-item/Save");
    expect(one.stdout).not.toContain("Frobnicate");
  });

  it("flags a linked action the tool does not register", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    const r = runIn(fx, runQuery, ["howto", "Frobnicate", "--json"]);
    const out = JSON.parse(r.stdout);
    expect(out.registered).toBe(false);
    expect(out.text).toContain('Warning: wb_world has no registered action "nosuchaction"');
    expect(runIn(fx, runQuery, ["howto", "wb_world.nosuchaction"]).stdout).toContain(
      'no registered action "nosuchaction"',
    );
  });
});

describe("query.ts howto: diag and setting rows answer with the concrete call", () => {
  const rows = (): Row[] => [
    fakeRow(1, {
      id: "diag:Render",
      dim: "diag",
      kind: "diag-menu",
      module: "Shared",
      label: "Render",
    } as Partial<Row>),
    fakeRow(2, {
      id: "diag:Render/Sky",
      dim: "diag",
      kind: "diag-menu",
      module: "Shared",
      parent: "diag:Render",
      label: "Sky",
      paths: [{ path: "gui-automation", status: "candidate" }],
    } as Partial<Row>),
    fakeRow(3, {
      id: "diag:Render/Sky/Fog",
      dim: "diag",
      kind: "diag-option",
      module: "Shared",
      parent: "diag:Render/Sky",
      label: "Fog",
    } as Partial<Row>),
    fakeRow(4, {
      id: "diag:Render/Atmosphere/Show Sky LUTs",
      dim: "diag",
      kind: "diag-option",
      module: "Shared",
      label: "Show Sky LUTs",
    } as Partial<Row>),
    fakeRow(5, {
      id: "setting:String Editor/legacyOptionsLoaded",
      dim: "setting",
      kind: "setting-key",
      module: "LocalizationEditor",
      label: undefined,
      paths: [{ path: "file-format", status: "candidate" }],
    } as Partial<Row>),
    fakeRow(6, {
      id: "setting:Audio Editor/legacyOptionsLoaded",
      dim: "setting",
      kind: "setting-key",
      module: "AudioEditor",
      label: undefined,
    } as Partial<Row>),
    fakeRow(7, {
      id: "setting:Animation Editor%2FFileBrowser/ascendingOrder",
      dim: "setting",
      kind: "setting-key",
      module: "AnimEditor",
      label: undefined,
    } as Partial<Row>),
  ];

  it("answers diag:Render/Sky, Render/Sky and Render > Sky with the wb_diag select call", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    for (const q of ["diag:Render/Sky", "Render/Sky", "Render > Sky", "render/sky"]) {
      const r = runIn(fx, runQuery, ["howto", q]);
      expect(r.code, q).toBe(0);
      expect(r.stdout.split("\n")[0], q).toBe("diag:Render/Sky");
      expect(r.stdout, q).toContain("Use: wb_diag action select");
      expect(r.stdout, q).toContain('Call: wb_diag {"action":"select","menu":"Sky"}');
    }
    const j = JSON.parse(runIn(fx, runQuery, ["howto", "Render/Sky", "--json"]).stdout);
    expect(j.id).toBe("diag:Render/Sky");
    expect(j.tool).toBe("wb_diag");
    expect(j.action).toBe("select");
    expect(j.call).toEqual({ action: "select", menu: "Sky" });
  });

  it("answers a task phrasing of the diag menu with the call", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    const r = runIn(fx, runQuery, [
      "howto",
      "How do I reach the diagnostics menu 'Sky' under the diagnostics menu 'Render' in the shared editor code?",
    ]);
    expect(r.stdout.split("\n")[0]).toContain("diag:Render/Sky");
    expect(r.stdout).toContain('Call: wb_diag {"action":"select","menu":"Sky"}');
  });

  it("answers a settings key with the wb_settings get call, by id, path or task phrasing", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    const call =
      'Call: wb_settings {"action":"get","section":"String Editor","key":"legacyOptionsLoaded"}';
    for (const q of [
      "setting:String Editor/legacyOptionsLoaded",
      "String Editor/legacyOptionsLoaded",
      "How do I read or change the setting 'legacyOptionsLoaded' in the settings section 'String Editor' in the Localization Editor?",
    ]) {
      const r = runIn(fx, runQuery, ["howto", q]);
      expect(r.code, q).toBe(0);
      expect(r.stdout.split("\n")[0], q).toContain("setting:String Editor/legacyOptionsLoaded");
      expect(r.stdout, q).toContain("Use: wb_settings action get");
      expect(r.stdout, q).toContain(call);
      expect(r.stdout.trim().length, q).toBeLessThanOrEqual(600);
    }
    const nested = runIn(fx, runQuery, ["howto", "Animation Editor/FileBrowser/ascendingOrder"]);
    expect(nested.stdout.split("\n")[0]).toBe(
      "setting:Animation Editor%2FFileBrowser/ascendingOrder",
    );
    expect(nested.stdout).toContain(
      'Call: wb_settings {"action":"get","section":"Animation Editor","key":"FileBrowser/ascendingOrder"}',
    );
  });

  it("names the tool call in describe for diag and setting rows", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    const d = runIn(fx, runQuery, ["describe", "diag:Render/Sky"]);
    expect(d.stdout).toContain("use: wb_diag select");
    expect(d.stdout).toContain('Call: wb_diag {"action":"select","menu":"Sky"}');
    const p = runIn(fx, runQuery, ["describe", "Render/Sky"]);
    expect(p.stdout.split("\n")[0]).toBe("id: diag:Render/Sky");
    const s = runIn(fx, runQuery, ["describe", "setting:String Editor/legacyOptionsLoaded"]);
    expect(s.stdout).toContain("use: wb_settings get");
    expect(s.stdout).toContain('"section":"String Editor","key":"legacyOptionsLoaded"');
  });

  it("leaves a still-ambiguous key to howto's candidate list", () => {
    const fx = makeCensus();
    writeLedger(fx, rows());
    const r = runIn(fx, runQuery, ["howto", "legacyOptionsLoaded"]);
    expect(r.stdout).not.toContain("Call:");
    expect(r.stdout).toContain("setting:String Editor/legacyOptionsLoaded");
  });
});

describe("query.ts call helpers", () => {
  const ledgerOf = (rows: Row[]) => {
    const fx = makeCensus();
    writeLedger(fx, rows);
    return loadLedger({ ...fx.paths });
  };

  it("builds the id from a path only when exactly one diag or setting row has it", () => {
    const l = ledgerOf([
      fakeRow(1, { id: "diag:A/B", dim: "diag", kind: "diag-menu" } as Partial<Row>),
      fakeRow(2, { id: "setting:A/B", dim: "setting", kind: "setting-key" } as Partial<Row>),
      fakeRow(3, { id: "diag:C/D", dim: "diag", kind: "diag-menu" } as Partial<Row>),
    ]);
    expect(rowIdFromPath(l, "C > D")).toBe("diag:C/D");
    expect(rowIdFromPath(l, "A/B")).toBe("A/B");
    expect(rowIdFromPath(l, "setting:A/B")).toBe("setting:A/B");
    expect(rowIdFromPath(l, "diag:A > B")).toBe("diag:A/B");
    expect(rowIdFromPath(l, "nothing here")).toBe("nothing here");
    expect(rowIdFromPath(l, "how do I open 'C/D'")).toBe("how do I open 'C/D'");
  });

  it("maps setting ids to wb_settings section and key", () => {
    expect(settingsArgs("setting:String Editor/legacyOptionsLoaded")).toEqual({
      section: "String Editor",
      key: "legacyOptionsLoaded",
    });
    expect(settingsArgs("setting:A%2FB%2FC/k")).toEqual({ section: "A", key: "B/C/k" });
    expect(settingsArgs(`setting:${SETTINGS_ROOT_SECTION}/QtVersion`)).toEqual({
      section: "General",
      key: "QtVersion",
    });
    expect(settingsArgs("diag:x")).toBeUndefined();
    expect(SETTINGS_ROOT_SECTION).toBe(ROOT_SECTION);
  });

  it("uses the catalog: menuId for a catalogued menu, the script name for an option", () => {
    const entry = (over: Partial<DiagEntry>): DiagEntry =>
      ({
        enumName: "DEBUGUI_X",
        enum: "SCR_DebugMenuID",
        id: 43,
        kind: "menu",
        path: "GameMode",
        label: "GameMode",
        values: "",
        shortcut: "",
        guard: "",
        declared: "x.c:1",
        ...over,
      }) as DiagEntry;
    const menu = fakeRow(1, { id: "diag:GameMode", label: "GameMode" } as Partial<Row>);
    const sel = { tool: "wb_diag", action: "select" };
    expect(toolCall(menu, sel, [entry({})])).toEqual({ action: "select", menuId: 43 });
    expect(toolCall(menu, sel, [])).toEqual({ action: "select", menu: "GameMode" });
    const spaced = fakeRow(2, { id: "diag:Has Space", label: "Has Space" } as Partial<Row>);
    expect(toolCall(spaced, sel, [])).toBeUndefined();
    const opt = fakeRow(3, { id: "diag:Character/Draw X", label: "Draw X" } as Partial<Row>);
    expect(
      toolCall(opt, { tool: "wb_diag", action: "get" }, [
        entry({ kind: "bool", path: "Character/Draw X", enumName: "DEBUGUI_DRAW_X", id: 0 }),
      ]),
    ).toEqual({ action: "get", names: ["DEBUGUI_DRAW_X"] });
    expect(toolCall(opt, { tool: "wb_world", action: "state" })).toBeUndefined();
  });

  it("keeps the answer within 600 characters, dropping Also lines first", () => {
    const text = [
      "row",
      "Use: x",
      ...Array.from({ length: 12 }, (_, i) => `Also: ${"y".repeat(60)}${i}`),
    ].join("\n");
    const out = withCallLine(text, callLine("wb_diag", { action: "select", menu: "Sky" }));
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.split("\n")[2]).toBe('Call: wb_diag {"action":"select","menu":"Sky"}');
    expect(out).toContain("Also: ");
  });
});

describe("query.ts scan-project", () => {
  it("does not leak an absolute path in a missing-folder error", () => {
    const fx = makeCensus();
    writeLedger(fx, [fakeRow(1)]);
    const r = runIn(fx, runQuery, ["scan-project", join(fx.root, "nope", "gone")]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).not.toContain(fx.root);
  });

  it("lists file types and plugins offline, tagged with the addon origin", () => {
    const fx = makeCensus();
    writeLedger(fx, [fakeRow(1, { id: "plugin:Known", kind: "plugin" } as Partial<Row>)]);
    const proj = join(fx.root, "MyAddon");
    mkdirSync(join(proj, "Scripts"), { recursive: true });
    writeFileSync(
      join(proj, "Scripts", "a.c"),
      '[WorkbenchPluginAttribute("A", "x", "", "", {"WorldEditor"})]\nclass NewTool : WorkbenchPlugin {\n  [Attribute("1")] int a;\n}\n[WorkbenchPluginAttribute("K")]\nclass Known : WorkbenchPlugin {}\n[WorkbenchToolAttribute("T", "x")]\nclass NewWbTool : WorldEditorTool {}\n',
    );
    writeFileSync(join(proj, "x.et"), "");
    const r = runIn(fx, runQuery, ["scan-project", proj, "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.addon).toBe("MyAddon");
    expect(out.plugins).toEqual([
      { id: "plugin:Known", origin: "addon:MyAddon", inLedger: true },
      { id: "plugin:NewTool", origin: "addon:MyAddon", inLedger: false },
      { id: "plugin:NewWbTool", origin: "addon:MyAddon", inLedger: false },
    ]);
    expect(out.fileTypes.map((t: { ext: string }) => t.ext).sort()).toEqual([".c", ".et"]);
    expect(out.attributes).toBeGreaterThanOrEqual(3);
  });
});
