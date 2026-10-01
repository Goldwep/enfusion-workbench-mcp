import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toJsonl } from "../../src/census/canon.js";
import { loadLedger } from "../../src/census/ledger-io.js";
import { find } from "../../src/census/query-engine.js";
import { ROW_FIELD_ORDER, type Row } from "../../src/census/schemas.js";
import { KINDS, MODULES } from "../../src/census/vocab.js";
import { run as runExists } from "../../scripts/census/exists.js";
import { run as runQuery } from "../../scripts/census/query.js";
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
  it("answers stubs with exit 2 before Phase 3", () => {
    const fx = bigCensus();
    expect(runIn(fx, runQuery, ["howto", "save a world"]).code).toBe(2);
    expect(runIn(fx, runQuery, ["scan-project", "x"]).stderr).toContain(
      "not available before Phase 3",
    );
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
