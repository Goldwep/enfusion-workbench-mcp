import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "prettier";
import { run as runBuild } from "../../scripts/census/build.js";
import { run as runPromote } from "../../scripts/census/promote.js";
import { run as runReport } from "../../scripts/census/report.js";
import {
  apiClass,
  apiMethod,
  makeCensus,
  mcpTool,
  runIn,
  writeEvidence,
  writeLiveResults,
  writeObservations,
  writeRepoFile,
  type Fixture,
} from "./helpers.js";

const BUILD = "1.0.0.1";
const METHOD = "api:WorldEditorAPI.GetSelectedEntity/1";

function populated(): Fixture {
  const fx = makeCensus(BUILD);
  writeObservations(fx, "E02", BUILD, [
    apiClass("WorldEditorAPI", { children_count: 1 }),
    apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
  ]);
  writeObservations(fx, "E11", BUILD, mcpTool("wb_world", ["getSelection"]));
  writeObservations(fx, "E15", BUILD, [
    {
      dim: "api",
      kind: "attribute",
      module: "Shared",
      key: { class: "SCR_X", attr: "m_iY" },
      origin: "vanilla",
      ref: "pak:scripts/X.c#L3",
      confidence: "high",
    },
  ]);
  writeEvidence(fx, "EV-s1-001");
  writeRepoFile(fx, "tests/tools/wb-world.test.ts", `// census:${METHOD}\n`);
  writeRepoFile(fx, "tests/live/wb-world.live.ts", `// census:${METHOD}\n`);
  runIn(fx, runBuild, []);
  return fx;
}

describe("report.ts", () => {
  it("prints a tier histogram on an empty census", () => {
    const fx = makeCensus();
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const r = runIn(fx, runReport, ["--summary"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("tier histogram: T0 0  T1 0  T2 0  T3 0  T4 0  T5 0");
    expect(r.stdout.indexOf("G1 ")).toBeLessThan(r.stdout.indexOf("tier histogram"));
    expect(r.stdout).toContain("complete relative to enumerators none at build");
  });

  it("is idempotent and --check detects a stale COVERAGE.md", () => {
    const fx = populated();
    expect(runIn(fx, runReport, []).code).toBe(0);
    const file = join(fx.repo, "docs", "v2", "COVERAGE.md");
    const first = readFileSync(file, "utf-8");
    expect(runIn(fx, runReport, []).code).toBe(0);
    expect(readFileSync(file, "utf-8")).toBe(first);
    expect(runIn(fx, runReport, ["--check"]).code).toBe(0);
    writeFileSync(file, first + "edit\n");
    expect(runIn(fx, runReport, ["--check"]).code).toBe(1);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(first).not.toContain(fx.repo);
  });

  it("writes Markdown that prettier leaves unchanged", async () => {
    const fx = populated();
    runIn(fx, runReport, []);
    const text = readFileSync(join(fx.repo, "docs", "v2", "COVERAGE.md"), "utf-8");
    expect(await format(text, { parser: "markdown", printWidth: 100, endOfLine: "lf" })).toBe(text);
  });

  it("prints headline and all-shards tables and never a single percentage", () => {
    const fx = populated();
    const r = runIn(fx, runReport, ["--summary"]);
    expect(r.stdout).toContain("headline (shard core): 4 rows");
    expect(r.stdout).toContain("all shards: 5 rows");
    expect(r.stdout).not.toContain("%");
  });

  it("keeps weak oracles separate from Driven and verified", () => {
    const fx = populated();
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
    writeLiveResults(fx, BUILD, [
      { test: "live-1", rows: [METHOD], verdict: "pass", oracle: "returned-true-only" },
    ]);
    runIn(fx, runBuild, []);
    const out = JSON.parse(runIn(fx, runReport, ["--json"]).stdout);
    expect(out.coverage.all.total.driven).toBe(0);
    expect(out.coverage.all.total.weak).toBe(1);
  });

  it("exits 2 when no ledger was built", () => {
    const fx = makeCensus();
    expect(runIn(fx, runReport, ["--summary"]).code).toBe(2);
  });
});
