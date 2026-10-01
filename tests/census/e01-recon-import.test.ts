import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import {
  cleanCell,
  mapColumns,
  loadMapping,
  parseMarkdown,
} from "../../scripts/census/enumerators/e01-recon-import.js";
import { run as runImport } from "../../scripts/census/enumerators/e01-recon-import.js";
import { makeCensus, runIn, type Fixture } from "./helpers.js";

/** Eight synthetic recon files with plausible tables, an aggregate row, probe lists and one unmappable table. */
const RECON: Record<string, string> = {
  "world-editor.md": [
    "# World Editor recon",
    "",
    "## Menus",
    "",
    "| Feature | Kind | Coverage | Notes |",
    "| --- | --- | --- | --- |",
    "| File > Save World | menu item | covered | Saves the current world |",
    "| File > E&xit | menu item | none | Closes Workbench |",
    "| 59 actions of the Edit menu | menu item | none | one row for many |",
    "| **Total** | | | |",
    "",
    "## Docks",
    "",
    "| Dock | Covered | Partial | None |",
    "|------|:-------:|:-------:|:----:|",
    "| Hierarchy | x | | |",
    "| Entity Properties | | x | |",
    "| Layers | | | x |",
    "",
    "## Probes",
    "",
    "- Does `GetModule` return a handle for the Animation Editor?",
    "- Is undo registered for API-driven edits?",
    "",
  ].join("\n"),
  "resource-manager.md": [
    "# Resource Manager",
    "",
    "## Plugins",
    "",
    "| Plugin | Module | Coverage | Risk |",
    "| --- | --- | --- | --- |",
    "| `TextureImportPlugin` | Resource Manager | partial | mutating |",
    "| `MaterialCheckPlugin` | Resource Manager | none | read-only |",
    "",
  ].join("\n"),
  "script-string-dialogue.md": [
    "# Script, String and Dialogue editors",
    "",
    "## Script Editor menus",
    "",
    "| Menu item | Coverage |",
    "| --- | --- |",
    "| Build > Compile and Reload | partial |",
    "",
    "## String Editor menus",
    "",
    "| Menu item | Coverage |",
    "| --- | --- |",
    "| File > Export | none |",
    "",
  ].join("\n"),
  "anim-procanim-behavior.md": [
    "# Animation editors",
    "",
    "### Behavior editor docks",
    "",
    "| Dock | Coverage |",
    "| --- | --- |",
    "| Node Palette | none |",
    "",
  ].join("\n"),
  "audio-particle-navmesh.md": [
    "# Audio, Particle, Navmesh",
    "",
    "## Particle editor toolbar",
    "",
    "| Button | Coverage | Risk |",
    "| --- | --- | --- |",
    "| Play | none | safe |",
    "| Delete Emitter | none | dangerous |",
    "",
  ].join("\n"),
  "plugins-netapi-cli.md": [
    "# Plugins, NET API and CLI",
    "",
    "## CLI switches",
    "",
    "| Switch | What | Coverage |",
    "| --- | --- | --- |",
    "| `-gproj` | Project to open | covered |",
    "| `-wbProjectPath` | Absent from the executable | partial |",
    "",
    "## Native functions",
    "",
    "| Function | Coverage |",
    "| --- | --- |",
    "| EvaluateScript | none |",
    "",
    "## Open questions",
    "",
    "| Question | Owner |",
    "| --- | --- |",
    "| Does a modal inside Run() park the NET queue? | main |",
    "",
  ].join("\n"),
  "mcp-inventory.md": [
    "# MCP inventory",
    "",
    "| Tool | Coverage | Notes |",
    "| --- | --- | --- |",
    "| wb_launch | covered | launches Workbench |",
    "| wb_validate_scripts | partial | passes a flag that does not exist |",
    "",
  ].join("\n"),
  "gui-census-feasibility.md": [
    "# GUI census feasibility",
    "",
    "## Counts",
    "",
    "| Item | Count |",
    "| --- | --- |",
    "| docks | 73 |",
    "",
    "## Status bar",
    "",
    "| Item | Coverage |",
    "| --- | --- |",
    "| FPS counter | maybe |",
    "",
    "## Unverified claims",
    "",
    "1. Workbench exposes its menus through UI Automation.",
    "",
  ].join("\n"),
};

function reconFixture(): { fx: Fixture; recon: string } {
  const fx = makeCensus("1.0.0.1");
  const recon = join(fx.repo, "docs", "v2", "recon");
  mkdirSync(recon, { recursive: true });
  for (const [name, text] of Object.entries(RECON)) writeFileSync(join(recon, name), text);
  return { fx, recon };
}

function readObservationFile(fx: Fixture): {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
  text: string;
} {
  const text = readFileSync(join(fx.root, "observations", "E01", "1.0.0.1.jsonl"), "utf-8");
  const [h, ...rest] = text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { header: h, lines: rest, text };
}

describe("e01-recon-import", () => {
  it("imports the synthetic recon tables as provisional low-confidence observations", () => {
    const { fx } = reconFixture();
    const r = runIn(fx, runImport, []);
    expect(r.code).toBe(0);
    const { header, lines } = readObservationFile(fx);
    expect(header).toMatchObject({
      $header: 1,
      enumerator: "E01",
      provisional: true,
      row_count: lines.length,
    });
    expect(lines.length).toBe(18);
    expect(lines.every((l) => l.confidence === "low")).toBe(true);
    expect(
      lines.every(
        (l) =>
          typeof l.ref === "string" &&
          /^<repo>\/docs\/v2\/recon\/[a-z-]+\.md#L\d+$/.test(l.ref as string),
      ),
    ).toBe(true);
    expect(r.stdout).toContain("18 provisional observations");
  });

  it("flags the row that stands for several features as aggregate", () => {
    const { fx } = reconFixture();
    runIn(fx, runImport, []);
    const agg = readObservationFile(fx).lines.filter((l) => l.aggregate === true);
    expect(agg.map((l) => l.label)).toEqual(["59 actions of the Edit menu"]);
  });

  it("reads tri-column coverage, heading modules and risk words", () => {
    const { fx } = reconFixture();
    runIn(fx, runImport, []);
    const { lines } = readObservationFile(fx);
    const by = (label: string): Record<string, unknown> | undefined =>
      lines.find((l) => l.label === label);
    expect(by("Hierarchy")).toMatchObject({
      kind: "dock",
      module: "WorldEditor",
      recon_coverage: "covered",
    });
    expect(by("Entity Properties")?.recon_coverage).toBe("partial");
    expect(by("Layers")?.recon_coverage).toBe("none");
    expect(by("Compile and Reload")?.module).toBe("ScriptEditor");
    expect(by("Export")?.module).toBe("LocalizationEditor");
    expect(by("Node Palette")?.module).toBe("BehaviorEditor");
    expect(by("Delete Emitter")).toMatchObject({
      kind: "toolbar-button",
      module: "ParticleEditor",
      risk_hint: "destructive",
    });
    expect(by("TextureImportPlugin")).toMatchObject({
      dim: "plugin",
      key: { class: "TextureImportPlugin" },
      risk_hint: "mutating",
    });
    expect(by("-wbProjectPath")).toMatchObject({
      kind: "cli-switch",
      key: { switch: "wbProjectPath" },
    });
    expect(by("wb_validate_scripts")).toMatchObject({
      kind: "mcp-tool",
      key: { tool: "wb_validate_scripts" },
    });
    expect(by("EvaluateScript")).toMatchObject({
      kind: "net-function",
      key: { native: "EvaluateScript" },
    });
  });

  it("drops summary rows, unmappable tables and unreadable coverage with reasons", () => {
    const { fx } = reconFixture();
    const r = runIn(fx, runImport, []);
    expect(r.stdout).toMatch(/dropped world-editor\.md:10: summary row/);
    expect(r.stdout).toContain('table "Counts" unmappable: no coverage column');
    expect(r.stdout).toContain("coverage reading unrecognised (maybe)");
    expect(r.stdout).toContain("(unmappable: no coverage column)");
  });

  it("seeds probes.jsonl from probe, open-question and unverified material", () => {
    const { fx } = reconFixture();
    runIn(fx, runImport, []);
    const probes = readFileSync(fx.paths.probes, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(probes.map((p) => p.id)).toEqual([
      "P-E01-gui-census-feasibility-L17",
      "P-E01-plugins-netapi-cli-L20",
      "P-E01-world-editor-L22",
      "P-E01-world-editor-L23",
    ]);
    expect(probes.every((p) => p.op === "open" && p.status === "open")).toBe(true);
    expect(probes[2].question).toBe("Does GetModule return a handle for the Animation Editor?");
  });

  it("produces byte-identical output on a second run", () => {
    const { fx } = reconFixture();
    runIn(fx, runImport, []);
    const obs1 = readObservationFile(fx).text;
    const probes1 = readFileSync(fx.paths.probes, "utf-8");
    const r = runIn(fx, runImport, []);
    expect(readObservationFile(fx).text).toBe(obs1);
    expect(readFileSync(fx.paths.probes, "utf-8")).toBe(probes1);
    expect(r.stdout).toContain("4 probes found, 0 newly seeded");
  });

  it("refuses an output path outside observations/E01", () => {
    const { fx } = reconFixture();
    const r = runIn(fx, runImport, [
      "--out",
      join(fx.root, "observations", "E02", "1.0.0.1.jsonl"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing --out outside observations/E01/");
    expect(existsSync(join(fx.root, "observations", "E02"))).toBe(false);
  });

  it("answers NO DATA without a recon directory", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runImport, []);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("NO DATA");
  });

  it("builds into a ledger with no rejected lines, every row provisional", () => {
    const { fx } = reconFixture();
    runIn(fx, runImport, []);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.rows).toHaveLength(18);
    expect(built.rows.every((r) => r.provisional && r.sources[0].enumerator === "E01")).toBe(true);
    expect(built.rows.find((r) => r.label === "Exit")?.risk).toBe("destructive");
    expect(built.meta.unverified_refs).toEqual({});
  });
});

describe("e01 markdown helpers", () => {
  it("keeps underscores inside identifiers while removing emphasis", () => {
    expect(cleanCell("`wb_launch`")).toBe("wb_launch");
    expect(cleanCell("**Total**")).toBe("Total");
    expect(cleanCell("_emphasis_ text")).toBe("emphasis text");
  });

  it("maps exact header names before prefixes", () => {
    const m = loadMapping();
    expect(mapColumns(["MCP tool", "MCP coverage", "Notes"], m)).toEqual({
      label: 0,
      coverage: 1,
      what: 2,
    });
  });

  it("ignores tables inside fenced code", () => {
    const { tables } = parseMarkdown("```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n");
    expect(tables).toHaveLength(0);
  });
});
