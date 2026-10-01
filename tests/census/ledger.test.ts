import { describe, it, expect } from "vitest";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "prettier";
import { buildLedger } from "../../src/census/build-ledger.js";
import { runGates } from "../../src/census/gates.js";
import { loadLedger } from "../../src/census/ledger-io.js";
import type { Row } from "../../src/census/schemas.js";
import { run as runAlias } from "../../scripts/census/alias.js";
import { run as runBuild } from "../../scripts/census/build.js";
import { run as runDispose } from "../../scripts/census/dispose.js";
import { run as runPromote } from "../../scripts/census/promote.js";
import { run as runValidate } from "../../scripts/census/validate.js";
import {
  apiClass,
  apiMethod,
  makeCensus,
  mcpTool,
  plantedPosixPath,
  plantedWindowsPath,
  runIn,
  spawnScript,
  uiItem,
  writeEvidence,
  writeLiveResults,
  writeObservations,
  writeRepoFile,
  type Fixture,
} from "./helpers.js";

const BUILD = "1.0.0.1";
const METHOD = "api:WorldEditorAPI.GetSelectedEntity/1";
const ACTION = "mcp:action/wb_world.getSelection";

function rowOf(fx: Fixture, id: string): Row | undefined {
  return buildLedger(fx.paths).rows.find((r) => r.id === id);
}

function build(fx: Fixture): ReturnType<typeof runIn> {
  return runIn(fx, runBuild, []);
}

/** A census with the tracer method observed by E02 and the wb_world tool by E11. */
function tracerCensus(): Fixture {
  const fx = makeCensus(BUILD);
  writeObservations(fx, "E02", BUILD, [
    apiClass("WorldEditorAPI", { children_count: 1 }),
    apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
  ]);
  writeObservations(fx, "E11", BUILD, mcpTool("wb_world", ["getSelection"]));
  writeEvidence(fx, "EV-s1-001");
  writeRepoFile(
    fx,
    "tests/tools/wb-world.test.ts",
    `it("reads the selection", () => {}); // census:${METHOD}\n`,
  );
  writeRepoFile(fx, "tests/live/wb-world.live.ts", `// census:${METHOD}\n`);
  return fx;
}

describe("tracer row", () => {
  it("walks one row from T0 to T5 through the census scripts", () => {
    const fx = makeCensus(BUILD);
    // T0: the recon import alone (no parent, provisional).
    writeObservations(fx, "E01", BUILD, [
      {
        dim: "api",
        kind: "method",
        module: "Shared",
        key: { class: "WorldEditorAPI", method: "GetSelectedEntity", arity: 1 },
        origin: "vanilla",
        ref: "<repo>/docs/v2/recon/world-editor.md#L12",
        quote: "GetSelectedEntity",
        confidence: "low",
        recon_coverage: "none",
      },
    ]);
    expect(build(fx).code).toBe(0);
    expect(rowOf(fx, METHOD)?.tier).toBe("T0");

    // T1: a documented source that does not observe the build (E12, the API index).
    writeObservations(fx, "E12", BUILD, [
      apiClass("WorldEditorAPI", {
        ref: "<repo>/data/api/enfusion-classes.json#L5",
        confidence: "medium",
      }),
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1, {
        ref: "<repo>/data/api/enfusion-classes.json#L9",
      }),
    ]);
    expect(build(fx).code).toBe(0);
    expect(rowOf(fx, METHOD)?.tier).toBe("T1");

    // T2: the script-source index observes it on the current build.
    writeObservations(fx, "E02", BUILD, [
      apiClass("WorldEditorAPI", { children_count: 1 }),
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
    ]);
    writeObservations(fx, "E11", BUILD, mcpTool("wb_world", ["getSelection"]));
    expect(build(fx).code).toBe(0);
    expect(rowOf(fx, METHOD)?.tier).toBe("T2");

    // T3: a read link and a contract test that names the row.
    writeEvidence(fx, "EV-s1-001");
    writeRepoFile(fx, "tests/tools/wb-world.test.ts", `// census:${METHOD}\n`);
    let r = runIn(fx, runPromote, [
      METHOD,
      "--evidence",
      "EV-s1-001",
      "--mcp",
      "wb_world.getSelection:read",
      "--test",
      "wb-world-read:tests/tools/wb-world.test.ts:contract",
      "--at",
      "2026-10-01T00:00:00Z",
    ]);
    expect(r.code).toBe(0);
    expect(rowOf(fx, METHOD)?.tier).toBe("T3");

    // T4: a drive link, a verified chosen path and a confirmed risk.
    r = runIn(fx, runPromote, [
      METHOD,
      "--evidence",
      "EV-s1-001",
      "--mcp",
      "wb_world.getSelection:drive",
      "--path",
      "net-api-handler=verified",
      "--chosen-path",
      "net-api-handler",
      "--confirm-risk",
      "safe",
      "--at",
      "2026-10-01T00:00:00Z",
    ]);
    expect(r.code).toBe(0);
    expect(rowOf(fx, METHOD)?.tier).toBe("T4");

    // T5: a live test listed on the row passes on the current build with a strong oracle.
    writeRepoFile(fx, "tests/live/wb-world.live.ts", `// census:${METHOD}\n`);
    r = runIn(fx, runPromote, [
      METHOD,
      "--evidence",
      "EV-s1-001",
      "--test",
      "live-wb-world-1:tests/live/wb-world.live.ts:live",
      "--at",
      "2026-10-01T00:00:00Z",
    ]);
    expect(r.code).toBe(0);
    writeLiveResults(fx, BUILD, [
      { test: "live-wb-world-1", rows: [METHOD], verdict: "pass", oracle: "state-readback" },
    ]);
    expect(build(fx).code).toBe(0);
    const row = rowOf(fx, METHOD) as Row;
    expect(row.tier).toBe("T5");
    expect(row.tier_evidence.map((e) => e.tier)).toEqual(["T0", "T1", "T2", "T3", "T4", "T5"]);

    // The committed ledger then passes G1 (fresh build equal, evidence resolves).
    const v = runIn(fx, runValidate, [
      "--gate",
      "G1",
      "--baseline-state",
      join(fx.root, "state.jsonl"),
    ]);
    expect(v.stdout).toContain("G1  PASS");
  });

  it("runs build and validate as spawned scripts with their exit codes", () => {
    const fx = tracerCensus();
    const b = spawnScript("scripts/census/build.ts", ["--data", fx.root]);
    expect(b.code).toBe(0);
    expect(b.stdout).toContain("built 4 rows");
    const v = spawnScript("scripts/census/validate.ts", [
      "--gate",
      "G1",
      "--data",
      fx.root,
      "--baseline-state",
      join(fx.root, "state.jsonl"),
    ]);
    expect(v.code).toBe(0);
    writeFileSync(
      join(fx.root, "ledger.jsonl"),
      readFileSync(join(fx.root, "ledger.jsonl"), "utf-8").replace('"T2"', '"T5"'),
    );
    expect(
      spawnScript("scripts/census/validate.ts", ["--gate", "G1", "--data", fx.root]).code,
    ).toBe(1);
  });
});

describe("tier rules", () => {
  function atT4(fx: Fixture): void {
    build(fx);
    runIn(fx, runPromote, [
      METHOD,
      "--evidence",
      "EV-s1-001",
      "--mcp",
      "wb_world.getSelection:read",
      "--mcp",
      "wb_world.getSelection:drive",
      "--test",
      "c1:tests/tools/wb-world.test.ts:contract",
      "--test",
      "live-1:tests/live/wb-world.live.ts:live",
      "--path",
      "net-api-handler=verified",
      "--chosen-path",
      "net-api-handler",
      "--confirm-risk",
      "safe",
    ]);
  }

  it("keeps tier T4 with weak_only for a pass whose oracle is the weak one", () => {
    const fx = tracerCensus();
    atT4(fx);
    writeLiveResults(fx, BUILD, [
      { test: "live-1", rows: [METHOD], verdict: "pass", oracle: "returned-true-only" },
    ]);
    const row = rowOf(fx, METHOD) as Row;
    expect(row.tier).toBe("T4");
    expect(row.weak_only).toBe(true);
  });

  it("reads T4 when the live result belongs to another build", () => {
    const fx = tracerCensus();
    atT4(fx);
    writeLiveResults(fx, "0.9.0.0", [
      { test: "live-1", rows: [METHOD], verdict: "pass", oracle: "state-readback" },
    ]);
    expect(rowOf(fx, METHOD)?.tier).toBe("T4");
    writeLiveResults(fx, BUILD, [
      { test: "live-1", rows: [METHOD], verdict: "pass", oracle: "state-readback" },
    ]);
    expect(rowOf(fx, METHOD)?.tier).toBe("T5");
  });

  it("does not grant T4 for a gui-automation locator from a different build", () => {
    const fx = makeCensus(BUILD);
    const item = uiItem("WorldEditor", "menu-item", ["File", "Save"], {
      what: "Saves the world",
      risk_hint: "safe",
      parent_key: { dim: "ui", kind: "menu", module: "WorldEditor", key: { path: ["File"] } },
      paths_proposed: [{ path: "gui-automation" }],
      locator: { menuPath: ["File", "Save"] },
      ref: "artifact:" + "a".repeat(64),
    });
    const menu = uiItem("WorldEditor", "menu", ["File"], {
      parent_key: null,
      ref: "artifact:" + "b".repeat(64),
      children_count: 1,
    });
    writeObservations(fx, "L02", "0.9.0.0", [item, menu]);
    writeObservations(fx, "L09", BUILD, [
      { ...item, locator: undefined, ref: "artifact:" + "c".repeat(64) },
    ]);
    writeObservations(fx, "E11", BUILD, mcpTool("wb_menu", ["invoke"]));
    writeEvidence(fx, "EV-s1-001");
    const id = "ui:WorldEditor/menu-item/File/Save";
    writeRepoFile(fx, "tests/tools/wb-menu.test.ts", `// census:${id}\n`);
    build(fx);
    const r = runIn(fx, runPromote, [
      id,
      "--evidence",
      "EV-s1-001",
      "--mcp",
      "wb_menu.invoke:drive",
      "--test",
      "c1:tests/tools/wb-menu.test.ts:contract",
      "--path",
      "gui-automation=verified",
      "--chosen-path",
      "gui-automation",
      "--confirm-risk",
      "safe",
    ]);
    expect(r.code).toBe(0);
    const row = rowOf(fx, id) as Row;
    expect(row.locator?.build).toBe("0.9.0.0");
    expect(row.tier).toBe("T3");
  });

  it("excludes E01 from T2 and caps its confidence at low", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E01", BUILD, [
      {
        ...apiMethod("Foo", "Bar", 0),
        parent_key: null,
        ref: "<repo>/docs/v2/recon/world-editor.md#L3",
        confidence: "high",
      },
    ]);
    const row = rowOf(fx, "api:Foo.Bar/0") as Row;
    expect(row.tier).toBe("T1");
    expect(row.provisional).toBe(true);
    expect(row.sources[0].confidence).toBe("low");
  });

  it("clamps E05 adjacency sources to medium", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E05", BUILD, [
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "gproj" },
        origin: "vanilla",
        ref: "exe:adjacency:0x10+0x20",
        confidence: "high",
      },
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "lsp" },
        origin: "vanilla",
        ref: "exe:0x30",
        confidence: "high",
      },
    ]);
    const rows = buildLedger(fx.paths).rows;
    expect(rows.find((r) => r.id === "cli:-gproj")?.sources[0].confidence).toBe("medium");
    expect(rows.find((r) => r.id === "cli:-lsp")?.sources[0].confidence).toBe("high");
  });

  it("fails T1 for a ref whose quote is not on the cited line", () => {
    const fx = makeCensus(BUILD);
    writeRepoFile(fx, "src/tools/wb-world.ts", "line one\nserver.registerTool(\n");
    const [tool] = mcpTool("wb_world", []);
    writeObservations(fx, "E11", BUILD, [
      { ...tool, children_count: 0, ref: "<repo>/src/tools/wb-world.ts#L2", quote: "registerTool" },
    ]);
    expect(rowOf(fx, "mcp:tool/wb_world")?.tier).toBe("T2");
    writeObservations(fx, "E11", BUILD, [
      { ...tool, children_count: 0, ref: "<repo>/src/tools/wb-world.ts#L1", quote: "registerTool" },
    ]);
    expect(rowOf(fx, "mcp:tool/wb_world")?.tier).toBe("T0");
  });

  it("floors risk to destructive for a label on a policy deny list", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "L02", BUILD, [
      uiItem("WorldEditor", "menu-item", ["File", "E&xit"], {
        label: "E&xit",
        risk_hint: "safe",
        ref: "artifact:" + "a".repeat(64),
      }),
    ]);
    const row = rowOf(fx, "ui:WorldEditor/menu-item/File/Exit") as Row;
    expect(row.risk).toBe("destructive");
    expect(row.risk_floor).toBe("execute_action.deny_list_seed");
    expect(row.target_tier).toBe("T2");
    expect(row.target_tier_source).toBe("risk-override");
  });

  it("refuses to lower risk below the highest hint without a risk-downgrade record", () => {
    const fx = tracerCensus();
    writeObservations(fx, "E12", BUILD, [
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1, {
        risk_hint: "mutating",
        ref: "<repo>/data/api/x.json#L1",
      }),
    ]);
    build(fx);
    expect(rowOf(fx, METHOD)?.risk).toBe("mutating");
    const r = runIn(fx, runPromote, [METHOD, "--evidence", "EV-s1-001", "--confirm-risk", "safe"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("risk-downgrade");
    const d = runIn(fx, runDispose, [
      METHOD,
      "--risk-downgrade",
      "--to",
      "safe",
      "--reason",
      "read-only call",
      "--evidence",
      "EV-s1-001",
    ]);
    expect(d.code).toBe(0);
    expect(rowOf(fx, METHOD)?.risk).toBe("safe");
  });

  it("errors when children_count is 3 and two child rows exist", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [
      apiClass("Foo", { children_count: 3 }),
      apiMethod("Foo", "A", 0),
      apiMethod("Foo", "B", 0),
    ]);
    const built = buildLedger(fx.paths);
    expect(
      built.problems.some((p) =>
        p.message.includes("claims children_count 3 but the file emits 2"),
      ),
    ).toBe(true);
    expect(built.rows.find((r) => r.id === "api:Foo")?.children_enumerated).toBe(false);
  });
});

describe("observation containment", () => {
  function rejects(line: Record<string, unknown>, enumerator = "E02", reason?: string): void {
    const fx = makeCensus(BUILD);
    writeObservations(fx, enumerator, BUILD, [line]);
    const built = buildLedger(fx.paths);
    expect(built.rows).toHaveLength(0);
    expect(built.rejected).toHaveLength(1);
    if (reason) expect(built.rejected[0].reason).toContain(reason);
  }

  it("rejects an observation carrying a tier field", () =>
    rejects({ ...apiClass("Foo"), tier: "T5" }, "E02", "tier"));
  it("rejects an observation carrying an enumerator field", () =>
    rejects({ ...apiClass("Foo"), enumerator: "E02" }, "E07"));
  it("rejects an observation carrying a disposition", () =>
    rejects({ ...apiClass("Foo"), disposition: "excluded-policy" }));
  it("rejects an observation whose id does not derive from its key", () =>
    rejects({ ...apiClass("Foo"), id: "api:Bar" }, "E02", "does not derive from its key"));
  it("rejects an E07 line with kind mcp-tool", () =>
    rejects({ ...mcpTool("wb_x", [])[0], ref: "wiki:Page#x" }, "E07", "may not emit"));
  it("rejects a ref containing a drive-letter path", () =>
    rejects(
      { ...apiClass("Foo"), what: `see ${plantedWindowsPath("x.c")}` },
      "E02",
      "machine path",
    ));
  it("rejects a ref containing a home path", () =>
    rejects({ ...apiClass("Foo"), what: `see ${plantedPosixPath("x.c")}` }, "E02", "machine path"));
  it("refuses to resolve a ref with a parent segment", () =>
    rejects(
      { ...mcpTool("wb_x", [])[0], ref: "<repo>/../etc/passwd#L1" },
      "E11",
      "leaves the repository",
    ));
  it("rejects a ref outside the enumerator's ref pattern", () =>
    rejects({ ...apiClass("Foo"), ref: "wiki:Foo" }, "E02", "ref pattern"));

  it("rejects a file whose header row_count differs from its line count", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [apiClass("Foo")], { row_count: 2 });
    expect(buildLedger(fx.paths).rejected[0].reason).toContain("row_count");
  });

  it("rejects a header whose enumerator differs from its directory", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E07", BUILD, [apiClass("Foo")], { enumerator: "E02" });
    expect(buildLedger(fx.paths).rejected[0].reason).toContain("differs from its directory");
  });

  it("rejects a file with the same key twice", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [apiClass("Foo"), apiClass("Foo")]);
    const built = buildLedger(fx.paths);
    expect(built.rows).toHaveLength(1);
    expect(built.rejected[0].reason).toContain("appears twice");
  });

  it("derives the same ui id for label_raw &File and label File", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "L02", BUILD, [
      uiItem("WorldEditor", "menu", ["&File"], {
        label_raw: "&File",
        ref: "artifact:" + "a".repeat(64),
      }),
    ]);
    writeObservations(fx, "E07", BUILD, [uiItem("WorldEditor", "menu", ["File"])]);
    const rows = buildLedger(fx.paths).rows;
    expect(rows.map((r) => r.id)).toEqual(["ui:WorldEditor/menu/File"]);
    expect(rows[0].sources.map((s) => s.enumerator)).toEqual(["E07", "L02"]);
  });
});

describe("determinism and hand edits", () => {
  it("produces byte-identical ledger files on two consecutive builds", () => {
    const fx = tracerCensus();
    build(fx);
    const first = ["ledger.jsonl", "ledger.meta.json"].map((f) => readFileSync(join(fx.root, f)));
    build(fx);
    const second = ["ledger.jsonl", "ledger.meta.json"].map((f) => readFileSync(join(fx.root, f)));
    expect(second[0].equals(first[0])).toBe(true);
    expect(second[1].equals(first[1])).toBe(true);
    expect(first[0].includes(0x0d)).toBe(false);
    expect(first[0][0]).not.toBe(0xef);
  });

  it("fails --check after one byte of ledger.jsonl is changed", () => {
    const fx = tracerCensus();
    build(fx);
    expect(runIn(fx, runBuild, ["--check"]).code).toBe(0);
    const file = join(fx.root, "ledger.jsonl");
    writeFileSync(file, readFileSync(file, "utf-8").replace('"tier":"T2"', '"tier":"T3"'));
    const r = runIn(fx, runBuild, ["--check"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("stale or hand-edited");
    const v = runIn(fx, runValidate, ["--gate", "G1"]);
    expect(v.code).toBe(1);
  });

  it("puts shard rows in their own files and keeps ids unique across shards", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E15", BUILD, [
      {
        dim: "api",
        kind: "attribute",
        module: "Shared",
        key: { class: "Foo", attr: "m_iX" },
        origin: "vanilla",
        ref: "pak:scripts/Foo.c#L3",
        confidence: "high",
      },
    ]);
    build(fx);
    expect(readFileSync(join(fx.root, "ledger.attribute.jsonl"), "utf-8")).toContain(
      "api:Foo#attr:m_iX",
    );
    expect(readFileSync(join(fx.root, "ledger.jsonl"), "utf-8")).toBe("");
    writeFileSync(
      join(fx.root, "ledger.jsonl"),
      readFileSync(join(fx.root, "ledger.attribute.jsonl")),
    );
    expect(() => loadLedger(fx.paths)).toThrow("duplicate id");
  });
});

describe("state patches", () => {
  it("refuses to promote without a resolvable evidence file", () => {
    const fx = tracerCensus();
    build(fx);
    const r = runIn(fx, runPromote, [METHOD, "--evidence", "EV-s1-999", "--work-item", "WI-1"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("has no file");
    expect(runIn(fx, runPromote, [METHOD, "--work-item", "WI-1"]).code).toBe(2);
    expect(readFileSync(fx.paths.state, "utf-8")).toBe("");
  });

  it("rejects a state line whose evidence is missing or unresolvable", () => {
    const fx = tracerCensus();
    build(fx);
    appendFileSync(
      fx.paths.state,
      JSON.stringify({
        seq: 1,
        id: METHOD,
        op: "set",
        fields: { work_item: "WI-1" },
        evidence: "EV-s1-404",
        session: "s1",
        at: "x",
        by: "promote.ts",
      }) + "\n",
    );
    const v = runIn(fx, runValidate, ["--gate", "G1", "--baseline-state", fx.paths.state]);
    expect(v.code).toBe(1);
    expect(v.stdout).toContain("EV-s1-404 has no file");
    writeFileSync(
      fx.paths.state,
      JSON.stringify({
        seq: 1,
        id: METHOD,
        op: "set",
        fields: { work_item: "WI-1" },
        session: "s1",
        at: "x",
        by: "promote.ts",
      }) + "\n",
    );
    expect(
      runIn(fx, runValidate, ["--gate", "G1", "--baseline-state", fx.paths.state]).stdout,
    ).toContain("evidence");
  });

  it("fails validate when a patch's session differs from its evidence id", () => {
    const fx = tracerCensus();
    build(fx);
    writeFileSync(
      fx.paths.state,
      JSON.stringify({
        seq: 1,
        id: METHOD,
        op: "set",
        fields: { work_item: "WI-1" },
        evidence: "EV-s1-001",
        session: "s2",
        at: "x",
        by: "promote.ts",
      }) + "\n",
    );
    expect(
      runIn(fx, runValidate, ["--gate", "G1", "--baseline-state", fx.paths.state]).stdout,
    ).toContain("does not match evidence");
  });

  it("fails the append-only check when a previous state line is altered", () => {
    const fx = tracerCensus();
    build(fx);
    runIn(fx, runPromote, [METHOD, "--evidence", "EV-s1-001", "--work-item", "WI-1", "--at", "t1"]);
    const baseline = join(fx.repo, "state.baseline.jsonl");
    writeFileSync(baseline, readFileSync(fx.paths.state));
    runIn(fx, runPromote, [METHOD, "--evidence", "EV-s1-001", "--notes", "more", "--at", "t2"]);
    build(fx);
    expect(runIn(fx, runValidate, ["--gate", "G1", "--baseline-state", baseline]).code).toBe(0);
    writeFileSync(fx.paths.state, readFileSync(fx.paths.state, "utf-8").replace("WI-1", "WI-2"));
    build(fx);
    const v = runIn(fx, runValidate, ["--gate", "G1", "--baseline-state", baseline]);
    expect(v.code).toBe(1);
    expect(v.stdout).toContain("append-only");
  });

  it("fails G1 for a state patch whose id has no observation", () => {
    const fx = tracerCensus();
    writeFileSync(
      fx.paths.state,
      JSON.stringify({
        seq: 1,
        id: "api:Ghost",
        op: "set",
        fields: { notes: "x" },
        evidence: "EV-s1-001",
        session: "s1",
        at: "x",
        by: "promote.ts",
      }) + "\n",
    );
    build(fx);
    const v = runIn(fx, runValidate, ["--gate", "G1", "--baseline-state", fx.paths.state]);
    expect(v.code).toBe(1);
    expect(v.stdout).toContain("absent-in-build candidate");
    expect(
      runIn(fx, runPromote, ["api:Ghost", "--evidence", "EV-s1-001", "--notes", "x"]).code,
    ).toBe(1);
  });

  it("keeps the id and state of a row absent from the current observations", () => {
    const fx = tracerCensus();
    build(fx);
    runIn(fx, runPromote, [METHOD, "--evidence", "EV-s1-001", "--work-item", "WI-7"]);
    writeObservations(fx, "E02", BUILD, [apiClass("WorldEditorAPI")]);
    const built = buildLedger(fx.paths);
    expect(built.meta.absent_candidates).toEqual([METHOD]);
    expect(readFileSync(fx.paths.state, "utf-8")).toContain("WI-7");
    const d = runIn(fx, runDispose, [
      METHOD,
      "--as",
      "absent-in-build",
      "--why",
      "gone in this build",
      "--evidence",
      "EV-s1-001",
    ]);
    expect(d.code).toBe(0);
    const after = buildLedger(fx.paths);
    expect(after.meta.retired).toEqual([METHOD]);
    expect(after.problems.filter((p) => p.id === METHOD)).toHaveLength(0);
  });

  it("rejects a work_item that does not match the declared pattern", () => {
    const fx = tracerCensus();
    build(fx);
    const r = runIn(fx, runPromote, [METHOD, "--evidence", "EV-s1-001", "--work-item", "TODO"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("work_item");
  });

  it("rejects a tests entry whose file lacks the census marker", () => {
    const fx = tracerCensus();
    writeRepoFile(fx, "tests/tools/other.test.ts", "// no marker here\n");
    build(fx);
    const r = runIn(fx, runPromote, [
      METHOD,
      "--evidence",
      "EV-s1-001",
      "--test",
      "c9:tests/tools/other.test.ts:contract",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`census:${METHOD}`);
  });

  it("refuses evidence recorded on another build", () => {
    const fx = tracerCensus();
    writeEvidence(fx, "EV-old-001", { build: "0.9.0.0" });
    build(fx);
    const r = runIn(fx, runPromote, [METHOD, "--evidence", "EV-old-001", "--notes", "x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("recorded on build 0.9.0.0");
  });
});

describe("dispositions", () => {
  function disposed(argv: string[]): ReturnType<typeof runIn> {
    const fx = tracerCensus();
    build(fx);
    return runIn(fx, runDispose, [METHOD, ...argv, "--why", "test", "--evidence", "EV-s1-001"]);
  }

  it("refuses the spelling subsumed-of", () => {
    const r = disposed(["--as", `subsumed-of:${METHOD}`]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown disposition subsumed-of");
  });

  it("accepts subsumed-by:<id> naming another row", () => {
    expect(disposed(["--as", "subsumed-by:api:WorldEditorAPI"]).code).toBe(0);
  });

  it("refuses deferred as a disposition", () => {
    expect(disposed(["--as", "deferred"]).stderr).toContain("status, not a disposition");
  });

  it("refuses duplicate-of without a target id", () => {
    expect(disposed(["--as", "duplicate-of"]).stderr).toContain("needs a reference");
  });

  it("refuses blocked naming an unknown probe", () => {
    expect(disposed(["--as", "blocked:P-nope"]).stderr).toContain("names no probe");
  });

  it("refuses excluded-policy without an existing policy path", () => {
    expect(disposed(["--as", "excluded-policy:deny_lists.nope"]).code).toBe(1);
    expect(
      disposed(["--as", "excluded-policy:deny_lists.never_called_on_live_instance"]).code,
    ).toBe(0);
  });

  it("rejects status deferred without deferred_reason and work_item", () => {
    const fx = tracerCensus();
    build(fx);
    expect(
      runIn(fx, runDispose, [METHOD, "--defer", "--reason", "later", "--evidence", "EV-s1-001"])
        .stderr,
    ).toContain("--defer needs --reason and --work-item");
    writeFileSync(
      fx.paths.state,
      JSON.stringify({
        seq: 1,
        id: METHOD,
        op: "set",
        fields: { status: "deferred" },
        evidence: "EV-s1-001",
        session: "s1",
        at: "x",
        by: "dispose.ts",
      }) + "\n",
    );
    expect(
      buildLedger(fx.paths).problems.some((p) =>
        p.message.includes("needs deferred_reason and work_item"),
      ),
    ).toBe(true);
  });

  it("flags a blocked row whose probe outcome is resolved under G9", () => {
    const fx = tracerCensus();
    writeFileSync(
      fx.paths.probes,
      JSON.stringify({
        seq: 1,
        id: "P-U8",
        op: "open",
        source: "PLAN 7",
        question: "GetModule?",
        status: "open",
        by: "test",
      }) + "\n",
    );
    build(fx);
    expect(
      runIn(fx, runDispose, [
        METHOD,
        "--as",
        "blocked:P-U8",
        "--why",
        "waits on U8",
        "--evidence",
        "EV-s1-001",
      ]).code,
    ).toBe(0);
    expect(
      runIn(fx, runDispose, [
        "--probe",
        "P-U8",
        "--outcome",
        "GetModule returns a handle",
        "--evidence",
        "EV-s1-001",
      ]).code,
    ).toBe(0);
    build(fx);
    const g9 = runGates(fx.paths, { gates: ["G9"] }).gates[0];
    expect(
      g9.offenders.some((o) => o.message.includes("blocked:P-U8 but the probe has an outcome")),
    ).toBe(true);
  });
});

describe("gates", () => {
  it("fails G8 when only mcp_proposed links exist", () => {
    const fx = tracerCensus();
    const [tool, action] = mcpTool("wb_world", ["getSelection"]);
    writeObservations(fx, "E11", BUILD, [tool, { ...action, covers_proposed: [METHOD] }]);
    build(fx);
    expect(rowOf(fx, METHOD)?.mcp_proposed).toEqual([ACTION]);
    const g8 = runGates(fx.paths, { gates: ["G8"], phase: "4" }).gates[0];
    expect(g8.status).toBe("FAIL");
    expect(g8.offenders[0].message).toContain("links to no row");
    expect(
      runIn(fx, runPromote, [
        "--accept-covers",
        "--from",
        `observations/E11/${BUILD}.jsonl`,
        "--evidence",
        "EV-s1-001",
      ]).code,
    ).toBe(0);
    build(fx);
    expect(runGates(fx.paths, { gates: ["G8"], phase: "4" }).gates[0].status).toBe("PASS");
  });

  it("fails the E11 count gate at 113 as well as 111", () => {
    for (const n of [111, 112, 113]) {
      const fx = makeCensus(BUILD);
      const tools = Array.from(
        { length: n },
        (_, i) => mcpTool(`tool_${String(i).padStart(3, "0")}`, [], { children_count: 0 })[0],
      );
      writeObservations(fx, "E11", BUILD, tools);
      const g2 = runGates(fx.paths, { gates: ["G2"] }).gates[0];
      expect(g2.status).toBe(n === 112 ? "PASS" : "FAIL");
    }
  });

  it("reports a universe single-source when one enumerator lists the other in its inputs", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [apiClass("Foo")]);
    writeObservations(fx, "E12", BUILD, [
      apiClass("Foo", { ref: "<repo>/data/api/x.json#L1" }),
      apiClass("Bar", { ref: "<repo>/data/api/x.json#L2" }),
    ]);
    const run = runGates(fx.paths, { gates: ["G2"] });
    const u = run.reconcile?.universes.find((x) => x.id === "kind:class");
    expect(u?.status).toBe("single-source");
    expect(u?.pairs).toHaveLength(0);
  });

  it("reports an open universe for an unexplained difference between independent enumerators", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E05", BUILD, [
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "gproj" },
        origin: "vanilla",
        ref: "exe:0x10",
        confidence: "high",
      },
    ]);
    writeObservations(fx, "L13", BUILD, [
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "gproj" },
        origin: "vanilla",
        ref: "ev:EV-s1-001",
        confidence: "high",
      },
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "lsp" },
        origin: "vanilla",
        ref: "ev:EV-s1-001",
        confidence: "high",
      },
    ]);
    const run = runGates(fx.paths, { gates: ["G2"] });
    expect(run.gates[0].status).toBe("FAIL");
    expect(
      run.reconcile?.universes.find((x) => x.id === "kind:cli-switch")?.pairs[0].unexplained,
    ).toEqual(["cli:-lsp"]);
  });

  it("excludes E01 from closure", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E01", BUILD, [
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "lsp" },
        origin: "vanilla",
        ref: "<repo>/docs/v2/recon/plugins-netapi-cli.md#L4",
        confidence: "low",
      },
    ]);
    writeObservations(fx, "E05", BUILD, [
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "gproj" },
        origin: "vanilla",
        ref: "exe:0x10",
        confidence: "high",
      },
    ]);
    const u = runGates(fx.paths, { gates: ["G2"] }).reconcile?.universes.find(
      (x) => x.id === "kind:cli-switch",
    );
    expect(u?.status).toBe("single-source");
  });

  it("fails G10 when the pattern file is absent unless CI is set", () => {
    const fx = makeCensus(BUILD);
    build(fx);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ENFUSION_PII_PATTERNS: join(fx.repo, "absent.txt"),
    };
    delete env.CI;
    // Plan 5.2: without the owner pattern file the gate refuses to pass
    // unless CI is set, in every phase.
    let r = runIn(fx, (a, io) => runValidate(a, io, env), ["--gate", "G10"]);
    expect(r.stdout).toContain("G10 FAIL");
    expect(r.stdout).toContain("owner pattern file is missing");
    expect(r.code).toBe(1);
    r = runIn(fx, (a, io) => runValidate(a, io, env), ["--gate", "G10", "--phase", "release"]);
    expect(r.code).toBe(1);
    r = runIn(fx, (a, io) => runValidate(a, io, { ...env, CI: "1" }), ["--gate", "G10"]);
    expect(r.stdout).toContain("G10 PASS");
    expect(r.stdout).toContain("CI set");
  });

  it("fails G10 on a planted home path in a census file", () => {
    const fx = makeCensus(BUILD);
    build(fx);
    writeFileSync(
      join(fx.root, "evidence", "EV-x-001.json"),
      JSON.stringify({ note: plantedWindowsPath("file") }) + "\n",
    );
    const env = { ...process.env, CI: "1", ENFUSION_PII_PATTERNS: join(fx.repo, "absent.txt") };
    const r = runIn(fx, (a, io) => runValidate(a, io, env), ["--gate", "G10"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("G10 FAIL");
    rmSync(fx.repo, { recursive: true, force: true });
  });
});

describe("more containment", () => {
  it("flags two observation files whose ref sets are identical across enumerators", () => {
    const fx = makeCensus(BUILD);
    const attr = {
      dim: "api",
      kind: "attribute",
      module: "Shared",
      key: { class: "Foo", attr: "m_iX" },
      origin: "vanilla",
      ref: "pak:scripts/Foo.c#L3",
      confidence: "high",
    };
    writeObservations(fx, "E02", BUILD, [attr]);
    writeObservations(fx, "E15", BUILD, [attr]);
    const g2 = runGates(fx.paths, { gates: ["G2"] }).gates[0];
    expect(g2.status).toBe("FAIL");
    expect(g2.offenders.some((o) => o.message.includes("identical reference sets"))).toBe(true);
  });

  it("keeps the highest hint when a bare state patch confirms a lower risk", () => {
    const fx = tracerCensus();
    writeObservations(fx, "E12", BUILD, [
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1, {
        risk_hint: "mutating",
        ref: "<repo>/data/api/x.json#L1",
      }),
    ]);
    writeFileSync(
      fx.paths.state,
      JSON.stringify({
        seq: 1,
        id: METHOD,
        op: "set",
        fields: { risk_confirmed: "safe" },
        evidence: "EV-s1-001",
        session: "s1",
        at: "x",
        by: "promote.ts",
      }) + "\n",
    );
    const row = rowOf(fx, METHOD) as Row;
    expect(row.risk).toBe("mutating");
    expect(row.risk_confirmed).toBe(false);
  });

  it("writes ledger.meta.json without timestamps or machine paths, in prettier's shape", async () => {
    const fx = tracerCensus();
    build(fx);
    const meta = readFileSync(join(fx.root, "ledger.meta.json"), "utf-8");
    expect(meta).not.toContain(fx.repo);
    expect(meta).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    const pretty = await format(meta, { parser: "json", printWidth: 100, endOfLine: "lf" });
    expect(pretty).toBe(meta);
  });
});

describe("aliases", () => {
  function aliasCensus(): Fixture {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E05", BUILD, [
      {
        dim: "ui",
        kind: "menu-item",
        module: "WorldEditor",
        key: { object_name: "actionSaveWorld" },
        label: "Save",
        origin: "vanilla",
        ref: "exe:0x10",
        confidence: "high",
      },
      {
        dim: "ui",
        kind: "menu-item",
        module: "WorldEditor",
        key: { object_name: "actionOpenWorld" },
        label: "Open",
        origin: "vanilla",
        ref: "exe:0x20",
        confidence: "high",
      },
      {
        dim: "cli",
        kind: "cli-switch",
        module: "none",
        key: { switch: "gproj" },
        origin: "vanilla",
        ref: "exe:0x30",
        confidence: "high",
      },
    ]);
    writeObservations(fx, "L02", BUILD, [
      uiItem("WorldEditor", "menu-item", ["File", "Save"], { ref: "artifact:" + "a".repeat(64) }),
    ]);
    writeEvidence(fx, "EV-s1-001");
    build(fx);
    return fx;
  }
  const accept = (fx: Fixture, from: string, to: string): ReturnType<typeof runIn> =>
    runIn(fx, runAlias, [
      "accept",
      "--from",
      from,
      "--to",
      to,
      "--why",
      "same item",
      "--proposed-by",
      "worker-a",
      "--evidence",
      "EV-s1-001",
    ]);

  it("merges an accepted alias into the canonical row and keeps both sources", () => {
    const fx = aliasCensus();
    expect(
      accept(fx, "ui:WorldEditor/menu-item/File/Save", "ui:WorldEditor/menu-item/#actionSaveWorld")
        .code,
    ).toBe(0);
    const rows = buildLedger(fx.paths).rows;
    expect(rows.some((r) => r.id === "ui:WorldEditor/menu-item/File/Save")).toBe(false);
    const row = rows.find((r) => r.id === "ui:WorldEditor/menu-item/#actionSaveWorld") as Row;
    expect(row.sources.map((s) => s.enumerator)).toEqual(["E05", "L02"]);
  });

  it("refuses alias accept when both ids come only from one enumerator", () => {
    const fx = aliasCensus();
    const r = accept(
      fx,
      "ui:WorldEditor/menu-item/#actionOpenWorld",
      "ui:WorldEditor/menu-item/#actionSaveWorld",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("only from E05");
  });

  it("rejects an alias across dims", () => {
    const fx = aliasCensus();
    expect(accept(fx, "ui:WorldEditor/menu-item/File/Save", "cli:-gproj").stderr).toContain(
      "across dims",
    );
  });

  it("refuses an alias that closes a cycle", () => {
    const fx = aliasCensus();
    expect(
      accept(fx, "ui:WorldEditor/menu-item/File/Save", "ui:WorldEditor/menu-item/#actionSaveWorld")
        .code,
    ).toBe(0);
    build(fx);
    expect(
      accept(fx, "ui:WorldEditor/menu-item/#actionSaveWorld", "ui:WorldEditor/menu-item/File/Save")
        .code,
    ).toBe(1);
    const aliases = JSON.parse(readFileSync(fx.paths.aliases, "utf-8")) as { aliases: unknown[] };
    expect(aliases.aliases).toHaveLength(1);
  });

  it("writes nothing on propose", () => {
    const fx = aliasCensus();
    const before = readFileSync(fx.paths.aliases, "utf-8");
    const r = runIn(fx, runAlias, ["propose", "--from", "a", "--to", "b", "--why", "x"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ proposal: "alias", from: "a", to: "b", why: "x" });
    expect(readFileSync(fx.paths.aliases, "utf-8")).toBe(before);
  });
});
