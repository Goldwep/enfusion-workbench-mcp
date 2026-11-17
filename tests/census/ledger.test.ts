import { describe, it, expect } from "vitest";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "prettier";
import { buildLedger } from "../../src/census/build-ledger.js";
import { runGates } from "../../src/census/gates.js";
import { loadLedger } from "../../src/census/ledger-io.js";
import type { Row } from "../../src/census/schemas.js";
import { foldProbes } from "../../src/census/state.js";
import { KINDS, MODULES } from "../../src/census/vocab.js";
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
  }, 60_000); // four node processes starting tsx: past 5 s on a loaded Windows machine
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

  it("lets a measured enumerator overrule the recon import on module, parent and aggregate", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E01", BUILD, [
      {
        ...apiClass("Foo"),
        module: "none",
        aggregate: true,
        parent_key: { dim: "api", kind: "class", module: "none", key: { class: "Missing" } },
        ref: "<repo>/docs/v2/recon/world-editor.md#L3",
      },
    ]);
    writeObservations(fx, "E02", BUILD, [apiClass("Foo", { module: "WorldEditor" })]);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems).toEqual([]);
    const row = built.rows.find((r) => r.id === "api:Foo") as Row;
    expect(row.module).toBe("WorldEditor");
    expect(row.parent).toBeNull();
    expect(row.aggregate).toBe(false);
    expect(row.provisional).toBe(false);
    expect(row.sources.map((s) => s.enumerator)).toEqual(["E01", "E02"]);
  });

  describe("a recon twin on a measured row (DEC-026, R5)", () => {
    const RECON_REF = "<repo>/docs/v2/recon/world-editor.md#L3";
    const fields = (r: Row) => ({
      tier: r.tier,
      tier_evidence: r.tier_evidence,
      paths: r.paths,
      risk: r.risk,
      risk_open: r.risk_open,
      risk_commit: r.risk_commit,
    });
    /** Builds the measured rows, optionally with E01 twins of the same ids, and returns them. */
    function twin(
      measured: Record<string, unknown>[],
      recon: Record<string, unknown>[] | undefined,
    ): Map<string, Row> {
      const fx = makeCensus(BUILD);
      writeObservations(fx, "E02", BUILD, measured);
      if (recon) writeObservations(fx, "E01", BUILD, recon);
      const built = buildLedger(fx.paths);
      expect(built.rejected).toEqual([]);
      expect(built.problems).toEqual([]);
      return new Map(built.rows.map((r) => [r.id, r]));
    }

    it("builds to the same tier, tier evidence, paths and risk as the measured row alone", () => {
      const measured = [
        apiClass("Foo", { children_count: 2 }),
        // One method proposes its own path, the other leaves it to the policy default.
        apiMethod("Foo", "Bar", 0),
        apiMethod("Foo", "Baz", 0, { paths_proposed: undefined, risk_hint: undefined }),
      ];
      const recon = ["Bar", "Baz"].map((m) => ({
        ...apiMethod("Foo", m, 0),
        parent_key: null,
        what: `the recon's reading of ${m}`,
        risk_hint: "destructive",
        risk_open_hint: "destructive",
        paths_proposed: [{ path: "gui-automation" }, { path: "none-known" }],
        ref: RECON_REF,
        recon_coverage: "partial",
      }));
      const alone = twin(measured, undefined);
      const joined = twin(measured, recon);
      for (const id of ["api:Foo.Bar/0", "api:Foo.Baz/0"]) {
        const a = alone.get(id) as Row;
        const j = joined.get(id) as Row;
        expect(fields(j)).toEqual(fields(a));
        // The merge itself: the recon source is kept, and fills only what it may.
        expect(j.sources.map((s) => s.enumerator)).toEqual(["E01", "E02"]);
        expect(j.recon_coverage).toBe("partial");
        expect(j.what).toBe(a.what);
        expect(j.tier_evidence[0]).toEqual({ tier: "T0", ref: `E02@${BUILD}` });
        expect(j.tier_evidence[1]).toEqual({ tier: "T1", ref: "pak:scripts/Foo.c#L10" });
      }
      // The policy default keeps its reason; the measured proposal stays as proposed.
      expect((joined.get("api:Foo.Baz/0") as Row).paths).toEqual([
        expect.objectContaining({
          path: "net-api-handler",
          reason: expect.stringMatching(/^Policy default/),
        }),
      ]);
      expect((joined.get("api:Foo.Bar/0") as Row).paths.map((p) => p.path)).toEqual([
        "net-api-handler",
      ]);
      expect((joined.get("api:Foo.Bar/0") as Row).tier).toBe("T2");
    });

    it("keeps a measured row whose only path is the policy none-known at its tier", () => {
      const measured = [apiClass("Foo", { paths_proposed: undefined })];
      // The recon states none-known without a reason, which alone would fail T1.
      const recon = [
        {
          ...apiClass("Foo"),
          paths_proposed: [{ path: "none-known" }],
          ref: RECON_REF,
          recon_coverage: "none",
        },
      ];
      const a = twin(measured, undefined).get("api:Foo") as Row;
      const j = twin(measured, recon).get("api:Foo") as Row;
      expect(a.tier).not.toBe("T0");
      expect(j.paths).toEqual([
        expect.objectContaining({ path: "none-known", reason: expect.stringMatching(/\S/) }),
      ]);
      expect(fields(j)).toEqual(fields(a));
    });

    it("gives a recon-only row its recon evidence and proposed paths", () => {
      const fx = makeCensus(BUILD);
      writeObservations(fx, "E01", BUILD, [
        {
          ...apiMethod("Foo", "Bar", 0),
          parent_key: null,
          paths_proposed: [{ path: "gui-automation" }],
          ref: RECON_REF,
          recon_coverage: "none",
        },
      ]);
      const row = rowOf(fx, "api:Foo.Bar/0") as Row;
      expect(row.provisional).toBe(true);
      expect(row.tier).toBe("T1");
      expect(row.tier_evidence).toEqual([
        { tier: "T0", ref: `E01@${BUILD}` },
        { tier: "T1", ref: RECON_REF },
      ]);
      expect(row.paths).toEqual([{ path: "gui-automation", status: "candidate" }]);
    });
  });

  it("still reports two measured enumerators that disagree on the module", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [apiClass("Foo", { module: "WorldEditor" })]);
    writeObservations(fx, "E12", BUILD, [
      apiClass("Foo", { module: "ScriptEditor", ref: "<repo>/data/api/arma-classes.json#L1" }),
    ]);
    const built = buildLedger(fx.paths);
    expect(built.problems.map((p) => p.message).join("\n")).toMatch(
      /api:Foo: .*says api\/class\/ScriptEditor.*says api\/class\/WorldEditor/,
    );
  });

  it("reads module none as no claim: the source that states a module decides", () => {
    const fx = makeCensus(BUILD);
    // E02 sorts first and says none; E12 states the module.
    writeObservations(fx, "E02", BUILD, [apiClass("Foo", { module: "none" })]);
    writeObservations(fx, "E12", BUILD, [
      apiClass("Foo", { module: "ScriptEditor", ref: "<repo>/data/api/arma-classes.json#L1" }),
    ]);
    const built = buildLedger(fx.paths);
    expect(built.problems).toEqual([]);
    expect((built.rows.find((r) => r.id === "api:Foo") as Row).module).toBe("ScriptEditor");
  });

  it("gives a row with no stated risk or path the policy defaults, by name rule first", () => {
    const fx = makeCensus(BUILD);
    const bare = (method: string, extra: Record<string, unknown> = {}) => ({
      ...apiMethod("Foo", method, 0),
      risk_hint: undefined,
      paths_proposed: undefined,
      ...extra,
    });
    writeObservations(fx, "E02", BUILD, [
      apiClass("Foo", { children_count: 4, risk_hint: undefined, paths_proposed: undefined }),
      bare("GetThing"),
      bare("SetThing"),
      bare("PublishThing"),
      bare("Toggle", { risk_hint: "destructive" }),
    ]);
    const built = buildLedger(fx.paths);
    expect(built.problems).toEqual([]);
    const row = (id: string) => built.rows.find((r) => r.id === id) as Row;
    expect(row("api:Foo").risk).toBe("safe");
    expect(row("api:Foo").paths).toEqual([
      expect.objectContaining({ path: "none-known", status: "candidate" }),
    ]);
    expect(row("api:Foo.GetThing/0").risk).toBe("safe");
    expect(row("api:Foo.SetThing/0").risk).toBe("mutating");
    expect(row("api:Foo.PublishThing/0").risk).toBe("external");
    // A stated hint is kept; "To" + lower case is not the getter rule.
    expect(row("api:Foo.Toggle/0").risk).toBe("destructive");
    expect(row("api:Foo.GetThing/0").paths.map((p) => `${p.path}/${p.status}`)).toEqual([
      "net-api-handler/candidate",
    ]);
    // Defaults are never a confirmation, and they are enough for T1 with a description.
    expect(row("api:Foo.GetThing/0").risk_confirmed).toBe(false);
    expect(row("api:Foo.GetThing/0").tier).toBe("T2");
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

  it("reads a CRLF checkout as the same ledger: input hashes, --check and G1 agree", () => {
    const fx = tracerCensus();
    build(fx);
    const meta = readFileSync(join(fx.root, "ledger.meta.json"), "utf-8");
    const crlf = (rel: string): void => {
      const file = join(fx.root, rel);
      // From whatever this checkout holds (the configuration is copied from it) to CRLF.
      writeFileSync(file, readFileSync(file, "utf-8").replace(/\r?\n/g, "\r\n"));
    };
    for (const f of [
      "universes.json",
      "policy.json",
      "aliases.json",
      "state-matrix.json",
      `observations/E02/${BUILD}.jsonl`,
      "ledger.jsonl",
      "ledger.meta.json",
    ])
      crlf(f);
    expect(readFileSync(join(fx.root, "universes.json")).includes(0x0d)).toBe(true);
    expect(buildLedger(fx.paths).metaText).toBe(meta);
    expect(runIn(fx, runBuild, ["--check"]).code).toBe(0);
    const v = runIn(fx, runValidate, [
      "--gate",
      "G1",
      "--baseline-state",
      join(fx.root, "state.jsonl"),
    ]);
    expect(v.stdout).toContain("G1  PASS");
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

describe("promote --batch (a wave's promotion from its battery)", () => {
  const batchLines = (extra: unknown[] = []): string =>
    [
      {
        id: METHOD,
        mcp: [{ action: ACTION, role: "drive" }],
        tests: [
          { id: "wb-world-contract", file: "tests/tools/wb-world.test.ts", kind: "contract" },
          { id: "w1-27-select", file: "tests/live/wb-world.live.ts", kind: "live" },
        ],
        paths: [{ path: "net-api-handler", status: "verified" }],
        chosen_path: "net-api-handler",
        confirm_risk: "safe",
        notes: "via: direct",
      },
      {
        live_result: {
          test: "w1-27-select",
          rows: [METHOD],
          verdict: "pass",
          oracle: "state-readback",
          evidence: "EV-s1-001",
        },
      },
      ...extra,
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n";

  it("takes a row from T2 to T5 in one batch and writes the live result", () => {
    const fx = tracerCensus();
    expect(build(fx).code).toBe(0);
    expect(rowOf(fx, METHOD)?.tier).toBe("T2");
    writeRepoFile(fx, "batch.jsonl", batchLines());
    const r = runIn(fx, runPromote, [
      "--batch",
      join(fx.repo, "batch.jsonl"),
      "--evidence",
      "EV-s1-001",
      "--at",
      "2026-10-01T00:00:00Z",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("1 live result(s)");
    expect(r.stdout).toContain("T5 1");
    const row = rowOf(fx, METHOD) as Row;
    expect(row.tier).toBe("T5");
    expect(row.notes).toBe("via: direct");
    expect(readFileSync(join(fx.root, "live-results", `${BUILD}.jsonl`), "utf-8")).toContain(
      '"test":"w1-27-select"',
    );
  });

  it("withdraw clears evidence a later run refuted, before the line's other patches", () => {
    const fx = tracerCensus();
    build(fx);
    writeRepoFile(fx, "batch.jsonl", batchLines());
    const args = (f: string): string[] => [
      "--batch",
      join(fx.repo, f),
      "--evidence",
      "EV-s1-001",
      "--at",
      "2026-10-01T00:00:00Z",
    ];
    expect(runIn(fx, runPromote, args("batch.jsonl")).code).toBe(0);
    expect(rowOf(fx, METHOD)?.tier).toBe("T5");
    // A bare withdraw (no notes) and an unknown field are refused; nothing is written.
    const before = readFileSync(fx.paths.state, "utf-8");
    writeRepoFile(fx, "bad.jsonl", JSON.stringify({ id: METHOD, withdraw: ["mcp"] }) + "\n");
    expect(runIn(fx, runPromote, args("bad.jsonl")).code).toBe(1);
    writeRepoFile(
      fx,
      "bad2.jsonl",
      JSON.stringify({ id: METHOD, withdraw: ["risk"], notes: "x" }) + "\n",
    );
    expect(runIn(fx, runPromote, args("bad2.jsonl")).code).toBe(1);
    expect(readFileSync(fx.paths.state, "utf-8")).toBe(before);
    writeRepoFile(
      fx,
      "withdraw.jsonl",
      JSON.stringify({
        id: METHOD,
        withdraw: ["mcp", "paths", "chosen_path"],
        notes: "the handler no longer calls it",
      }) + "\n",
    );
    expect(runIn(fx, runPromote, args("withdraw.jsonl")).code).toBe(0);
    const row = rowOf(fx, METHOD) as Row;
    expect(row.mcp).toEqual([]);
    expect(row.chosen_path).toBeUndefined();
    expect(row.tier).not.toBe("T5");
    expect(row.notes).toBe("the handler no longer calls it");
    const last = readFileSync(fx.paths.state, "utf-8").trim().split("\n").slice(-2);
    expect(JSON.parse(last[0]).op).toBe("clear");
    expect(JSON.parse(last[1]).op).toBe("set");
  });

  it("writes nothing when one line fails, and a dry run writes nothing either", () => {
    const fx = tracerCensus();
    build(fx);
    writeRepoFile(
      fx,
      "bad.jsonl",
      batchLines([{ id: METHOD, tests: [{ id: "x", file: "tests/none.ts", kind: "contract" }] }]),
    );
    const bad = runIn(fx, runPromote, [
      "--batch",
      join(fx.repo, "bad.jsonl"),
      "--evidence",
      "EV-s1-001",
    ]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("bad.jsonl:3");
    expect(readFileSync(fx.paths.state, "utf-8")).toBe("");
    writeRepoFile(fx, "ok.jsonl", batchLines());
    const dry = runIn(fx, runPromote, [
      "--batch",
      join(fx.repo, "ok.jsonl"),
      "--evidence",
      "EV-s1-001",
      "--dry-run",
    ]);
    expect(dry.code).toBe(0);
    expect(readFileSync(fx.paths.state, "utf-8")).toBe("");
    const unknownRow = runIn(fx, runPromote, [
      "--batch",
      join(fx.repo, "ok.jsonl"),
      "--evidence",
      "EV-s1-001",
      METHOD,
    ]);
    expect(unknownRow.code).toBe(2);
  });

  it("refuses a live result naming a row that is not in the ledger", () => {
    const fx = tracerCensus();
    build(fx);
    writeRepoFile(
      fx,
      "live.jsonl",
      JSON.stringify({
        live_result: { test: "t", rows: ["api:Nope.Nope/0"], verdict: "pass", oracle: "log-line" },
      }) + "\n",
    );
    const r = runIn(fx, runPromote, [
      "--batch",
      join(fx.repo, "live.jsonl"),
      "--evidence",
      "EV-s1-001",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not a ledger row");
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

  it("applies a batch under one evidence id, and nothing when one line is bad", () => {
    const fx = tracerCensus();
    build(fx);
    const before = readFileSync(fx.paths.state, "utf-8");
    const good = {
      id: METHOD,
      reconcile_explained: { universe: "u", enumerator: "E99", kind: "out-of-scope", ref: "r" },
    };
    const file = join(fx.root, "batch.jsonl");
    const lines = (items: object[]): string => items.map((x) => JSON.stringify(x)).join("\n");

    writeFileSync(file, lines([good, { id: "api:NoSuchRow#Nope", recon_resolution: {} }]) + "\n");
    const bad = runIn(fx, runDispose, ["--batch", file, "--evidence", "EV-s1-001"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("batch.jsonl:2:");
    expect(readFileSync(fx.paths.state, "utf-8")).toBe(before);

    writeFileSync(
      file,
      lines([good, { id: METHOD, recon_resolution: { kind: "out-of-scope", ref: "plan 1.4" } }]),
    );
    expect(runIn(fx, runDispose, ["--batch", file, "--evidence", "EV-s1-001"]).code).toBe(0);
    const added = readFileSync(fx.paths.state, "utf-8").slice(before.length).trim().split("\n");
    expect(added).toHaveLength(2);
    expect(added.every((l) => JSON.parse(l).evidence === "EV-s1-001")).toBe(true);
    expect(buildLedger(fx.paths).problems).toEqual([]);
  });

  /** The tracer census with one recon probe open, and a writer for batch files. */
  function probeCensus(): {
    fx: Fixture;
    batch: (items: object[], evidence?: string) => ReturnType<typeof runIn>;
    probesText: () => string;
  } {
    const fx = tracerCensus();
    writeFileSync(
      fx.paths.probes,
      JSON.stringify({
        seq: 1,
        id: "P-E01-x-L1",
        op: "open",
        source: "recon",
        question: "Does x answer?",
        status: "open",
        by: "test",
      }) + "\n",
    );
    build(fx);
    const file = join(fx.root, "batch.jsonl");
    return {
      fx,
      batch: (items, evidence = "EV-s1-001") => {
        writeFileSync(file, items.map((x) => JSON.stringify(x)).join("\n") + "\n");
        return runIn(fx, runDispose, ["--batch", file, "--evidence", evidence]);
      },
      probesText: () => readFileSync(fx.paths.probes, "utf-8"),
    };
  }

  it("opens and schedules a probe on one batch line", () => {
    const { fx, batch } = probeCensus();
    const r = batch([
      {
        probe: "P-U99",
        open: { question: "Does Workbench answer?", source: "PLAN 7" },
        schedule: "S-A",
        architecture_deciding: true,
      },
    ]);
    expect(r.code).toBe(0);
    const folded = foldProbes(fx.paths);
    expect(folded.problems).toEqual([]);
    expect(folded.probes.get("P-U99")).toMatchObject({
      question: "Does Workbench answer?",
      source: "PLAN 7",
      status: "scheduled",
      scheduled_session: "S-A",
      architecture_deciding: true,
    });
  });

  it("schedules a probe as deferred, and refuses a status a schedule line cannot carry", () => {
    const { fx, batch, probesText } = probeCensus();
    const before = probesText();
    const bad = batch([{ probe: "P-E01-x-L1", schedule: "Phase 4", status: "resolved" }]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("batch.jsonl:1: status resolved");
    expect(probesText()).toBe(before);

    expect(batch([{ probe: "P-E01-x-L1", schedule: "Phase 4", status: "deferred" }]).code).toBe(0);
    const p = foldProbes(fx.paths).probes.get("P-E01-x-L1");
    expect(p).toMatchObject({
      status: "deferred",
      scheduled_session: "Phase 4",
      architecture_deciding: false,
    });
    expect(p?.outcome).toBeUndefined();
  });

  it("schedules then answers a probe; the outcome needs a resolvable evidence record", () => {
    const { fx, batch, probesText } = probeCensus();
    const before = probesText();
    const lines = [
      { probe: "P-E01-x-L1", schedule: "S-0" },
      { probe: "P-E01-x-L1", outcome: "answered from the static census" },
    ];
    const missing = batch(lines, "EV-s1-404");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("EV-s1-404 has no file");
    expect(probesText()).toBe(before);

    expect(batch(lines).code).toBe(0);
    const folded = foldProbes(fx.paths);
    expect(folded.problems).toEqual([]);
    expect(folded.probes.get("P-E01-x-L1")).toMatchObject({
      status: "resolved",
      scheduled_session: "S-0",
      outcome: "answered from the static census",
      evidence: "EV-s1-001",
    });
  });

  it("refuses an open line without a question, or a probe opened twice, and writes nothing", () => {
    const { batch, probesText } = probeCensus();
    const before = probesText();
    const good = { probe: "P-U98", open: { question: "Q?", source: "PLAN 7" }, schedule: "S-B" };
    const noQuestion = batch([
      good,
      { probe: "P-U97", open: { source: "PLAN 7" }, schedule: "S-B" },
    ]);
    expect(noQuestion.code).toBe(1);
    expect(noQuestion.stderr).toContain(
      "batch.jsonl:2: an opened probe needs a question and a source",
    );
    expect(probesText()).toBe(before);

    const twice = batch([good, good]);
    expect(twice.code).toBe(1);
    expect(twice.stderr).toContain("batch.jsonl:2: probe P-U98 is opened twice in this batch");
    expect(probesText()).toBe(before);
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

  it("G7: an empty cell needs a reason or a named filler, and a filler has a due phase", () => {
    const fx = tracerCensus();
    build(fx);
    const file = join(fx.root, "universes.json");
    const base = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    const g7 = (open: object[], phase: "0" | "1" | "4" | "release") => {
      // Every cell explained except WorldEditor x menu.
      const reasons = [
        ...MODULES.filter((m) => m !== "WorldEditor").map((m) => ({ module: m, kind: "*" })),
        ...KINDS.filter((k) => k !== "menu").map((k) => ({ module: "WorldEditor", kind: k })),
      ].map((e) => ({ ...e, why_ref: "PLAN 4.6" }));
      writeFileSync(
        file,
        JSON.stringify({ ...base, g7_empty_reasons: reasons, g7_open_cells: open }),
      );
      return runGates(fx.paths, { gates: ["G7"], phase }).gates[0];
    };
    const cell = { module: "WorldEditor", kind: "menu" };

    expect(g7([], "0").status).toBe("SOFT");
    const bare = g7([], "1");
    expect(bare.status).toBe("FAIL");
    expect(bare.offenders[0].message).toContain("empty without a written reason");

    const live = [{ ...cell, awaits: ["L01", "L03"] }];
    expect(g7(live, "1").status).toBe("SOFT");
    expect(g7(live, "1").offenders[0].message).toContain("awaits L01, L03");
    expect(g7(live, "4").status).toBe("FAIL");

    const wave = [{ ...cell, awaits: ["L01", "W4"] }];
    expect(g7(wave, "4").status).toBe("SOFT");
    expect(g7(wave, "release").status).toBe("FAIL");
  });

  // The expected count is the real universes.json value: 150 tools under ENFUSION_TOOLSET=all (DEC-087; was 120).
  it("fails the E11 count gate at 151 as well as 149", () => {
    for (const n of [149, 150, 151]) {
      const fx = makeCensus(BUILD);
      const tools = Array.from(
        { length: n },
        (_, i) => mcpTool(`tool_${String(i).padStart(3, "0")}`, [], { children_count: 0 })[0],
      );
      writeObservations(fx, "E11", BUILD, tools);
      const g2 = runGates(fx.paths, { gates: ["G2"] }).gates[0];
      expect(g2.status).toBe(n === 150 ? "PASS" : "FAIL");
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

  it("closes a row seen by any two independent sources, whatever a third source lacks", () => {
    const fx = makeCensus(BUILD);
    const sw = (name: string, ref: string) => ({
      dim: "cli",
      kind: "cli-switch",
      module: "none",
      key: { switch: name },
      origin: "vanilla",
      ref,
      confidence: "high",
    });
    // "both" is in all three; "docs" only in the wiki and the shipped docs; "exe" only in the executable.
    writeObservations(fx, "E05", BUILD, [sw("both", "exe:0x10"), sw("exe", "exe:0x20")]);
    writeObservations(fx, "E07", BUILD, [sw("both", "wiki:P#a"), sw("docs", "wiki:P#b")]);
    writeObservations(fx, "E08", BUILD, [
      sw("both", "<tools>/Workbench/docs/Page_CLI.html#a"),
      sw("docs", "<tools>/Workbench/docs/Page_CLI.html#b"),
    ]);
    const run = runGates(fx.paths, { gates: ["G2"] });
    const u = run.reconcile?.universes.find((x) => x.id === "kind:cli-switch");
    expect(u?.status).toBe("open");
    expect(u?.uncorroborated).toEqual([{ id: "cli:-exe", seenBy: ["E05"] }]);
    // One offender for the row, not one per pair it differs in.
    expect(run.gates[0].offenders.filter((o) => o.id === "cli:-exe")).toHaveLength(1);
    expect(run.gates[0].offenders.some((o) => o.id === "cli:-docs")).toBe(false);
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

  it("knows no G10 any more (DEC-060)", () => {
    const fx = makeCensus(BUILD);
    build(fx);
    const r = runIn(fx, (a, io) => runValidate(a, io), ["--gate", "G10"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown gate G10");
    const all = runIn(fx, (a, io) => runValidate(a, io), []);
    expect(all.stdout).not.toContain("G10");
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

describe("carry-over with an own-build file (DEC-059)", () => {
  const OLD = "1.0.0.0";
  const NEW = "1.0.0.1";
  const CLS = "api:WorldEditorAPI";

  /** A census at NEW that carries E02 from OLD under an accepted carry-over. */
  function carryCensus(): Fixture {
    const fx = makeCensus(NEW);
    writeEvidence(fx, "EV-carry-001");
    writeFileSync(
      join(fx.root, "current-build.json"),
      JSON.stringify(
        {
          tag: NEW,
          branch: "stable",
          ui_language: "en",
          recorded_by: "test",
          carry_over: [
            {
              from: OLD,
              enumerators: ["E02"],
              status: "accepted",
              evidence: "EV-carry-001",
              rule: "test",
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    return fx;
  }

  function t2(fx: Fixture, id: string): string | undefined {
    const row = rowOf(fx, id);
    return row?.tier_evidence.find((e) => e.tier === "T2")?.ref;
  }

  function carryMeta(fx: Fixture): unknown {
    const meta = buildLedger(fx.paths).meta as { carry_over?: Array<{ rows: unknown }> };
    return meta.carry_over?.[0]?.rows;
  }

  it("carried only: the rows are carried and marked so", () => {
    const fx = carryCensus();
    writeObservations(fx, "E02", OLD, [
      apiClass("WorldEditorAPI", { children_count: 1 }),
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
    ]);
    const built = buildLedger(fx.paths);
    expect(built.problems).toEqual([]);
    expect(t2(fx, METHOD)).toBe(`E02@${OLD} carried to ${NEW}`);
    expect(carryMeta(fx)).toEqual({ E02: { carried: 2, own_build: 0 } });
  });

  it("own-build only: no carry-over problem, the rows are of the build", () => {
    const fx = carryCensus();
    writeObservations(fx, "E02", OLD, []);
    writeObservations(fx, "E02", NEW, [
      apiClass("WorldEditorAPI", { children_count: 1 }),
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
    ]);
    const built = buildLedger(fx.paths);
    expect(built.problems).toEqual([]);
    expect(t2(fx, METHOD)).toBe(`E02@${NEW}`);
    expect(carryMeta(fx)).toEqual({ E02: { carried: 0, own_build: 2 } });
  });

  it("both, disjoint ids: own rows of the build, the other rows stay carried", () => {
    const fx = carryCensus();
    writeObservations(fx, "E02", OLD, [
      apiClass("WorldEditorAPI", { children_count: 1 }),
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
    ]);
    writeObservations(fx, "E02", NEW, [apiClass("WorkbenchApi", { children_count: 0 })]);
    const built = buildLedger(fx.paths);
    expect(built.problems).toEqual([]);
    expect(t2(fx, "api:WorkbenchApi")).toBe(`E02@${NEW}`);
    expect(t2(fx, METHOD)).toBe(`E02@${OLD} carried to ${NEW}`);
    expect(t2(fx, CLS)).toBe(`E02@${OLD} carried to ${NEW}`);
    expect(carryMeta(fx)).toEqual({ E02: { carried: 2, own_build: 1 } });
  });

  it("both, an overlapping id: the own-build row wins and is not counted as carried", () => {
    const fx = carryCensus();
    writeObservations(fx, "E02", OLD, [
      apiClass("WorldEditorAPI", { children_count: 1, what: "old text" }),
      apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
    ]);
    writeObservations(fx, "E02", NEW, [
      apiClass("WorldEditorAPI", { children_count: 0, what: "new text" }),
    ]);
    const built = buildLedger(fx.paths);
    expect(built.problems).toEqual([]);
    const cls = rowOf(fx, CLS);
    expect(cls?.what).toBe("new text");
    expect(t2(fx, CLS)).toBe(`E02@${NEW}`);
    expect(t2(fx, METHOD)).toBe(`E02@${OLD} carried to ${NEW}`);
    expect(carryMeta(fx)).toEqual({ E02: { carried: 1, own_build: 1 } });
    expect(built.observations.every((a) => a.build === OLD || a.build === NEW)).toBe(true);
  });
});
