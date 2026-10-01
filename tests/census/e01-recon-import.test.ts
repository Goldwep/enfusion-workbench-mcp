import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import {
  cleanCell,
  coversFrom,
  mapColumns,
  loadMapping,
  normalizeKind,
  parseMarkdown,
  parsePaths,
  readCoverage,
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
    // The real recon header shape (mapping version 2).
    "## 2.6 World Editor UI: top bar, panels, native tools",
    "",
    "| Feature | Kind | What it does | Script API (class.method or none) | Automation path | Current MCP coverage (tool name, partial, or none) | Evidence (file / wiki page title / class) | Confidence |",
    "|---|---|---|---|---|---|---|---|",
    "| Top bar sections | toolbar | Basic Actions / Basic Tools / Scripted Tools groups | none | gui-automation | none | wiki:World Editor | high |",
    "| Copy / Cut / Paste (same position) / Duplicate | toolbar | Clipboard operations on the selection | WorldEditorAPI.CopySelectedEntities / CutSelectedEntities | net-api-handler | wb_clipboard [emcp_wb_clipboard] | EMCP_WB_Clipboard.c | high |",
    "| Toggle gizmo space | toolbar | World vs object reference (X) | none; registry `TranslationGizmoMode` | execute-action [label unverified]; gui-automation | **none** | wiki:World Editor; registry | medium |",
    "| Tool Properties panel | panel | Settings panel of the active tool | WorldEditorAPI.GetCurrentToolName (read) | gui-automation | none | wiki:World Editor | high |",
    "| Entity list filter / sort | control (2) | Filters the hierarchy | none | gui-automation | partial: wb_entity_list | wiki | high |",
    "| Script Editor: Build > Compile All | menu-action | Compiles every script | Workbench.ExecuteAction | execute-action | wb_reload (partial: hard-coded paths return false on 1.8) | INI | H |",
    "| GetSelectedEntitiesCount | API method | Number of selected entities | WorldEditorAPI.GetSelectedEntitiesCount() | net-api-handler | wb_entity_select [emcp_wb_selectentity] | WorldEditorAPI.c | high |",
    "| Startup | architecture | How the module boots | none | n/a | none | src/server.ts | high |",
    "",
    "## 2.8 Script plugins registered for the World Editor module (or driving it from the CLI)",
    "",
    "| Feature | Kind | What it does | Script API | Automation path | Current MCP coverage | Evidence | Confidence |",
    "|---|---|---|---|---|---|---|---|",
    "| SelectionToPrefabPlugin | plugin (WorldEditorPlugin) | Saves the selection as a prefab | WorldEditorAPI.CreateEntityTemplate | plugin-run | none | wiki | high |",
    "",
    "## 5. Proposed 2.0 work items",
    "",
    "| # | Title | Kind | Size | Needs live Workbench |",
    "|---|---|---|---|---|",
    "| 1 | Probe and fix headless argv | test + offline-tool | S | yes |",
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
    "## 3.2 Texture Editor",
    "",
    "| Feature | Kind | What it does | Script API | Automation path | Current MCP coverage | Evidence | Confidence |",
    "|---|---|---|---|---|---|---|---|",
    "| Open texture | editor | 2D viewer | SetOpenedResource | net-api-handler | partial: wb_resources open | wiki | high |",
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
    expect(lines.length).toBe(27);
    expect(lines.every((l) => l.confidence === "low")).toBe(true);
    expect(
      lines.every(
        (l) =>
          typeof l.ref === "string" &&
          /^<repo>\/docs\/v2\/recon\/[a-z-]+\.md#L\d+$/.test(l.ref as string),
      ),
    ).toBe(true);
    expect(r.stdout).toContain("27 provisional observations");
  });

  it("flags the row that stands for several features as aggregate", () => {
    const { fx } = reconFixture();
    runIn(fx, runImport, []);
    const agg = readObservationFile(fx).lines.filter((l) => l.aggregate === true);
    expect(agg.map((l) => l.label).sort()).toEqual([
      "59 actions of the Edit menu",
      "Copy / Cut / Paste (same position) / Duplicate",
      "Entity list filter / sort",
    ]);
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
    expect(built.rows).toHaveLength(27);
    expect(built.rows.every((r) => r.provisional && r.sources[0].enumerator === "E01")).toBe(true);
    expect(built.rows.find((r) => r.label === "Exit")?.risk).toBe("destructive");
    expect(built.meta.unverified_refs).toEqual({});
  });
});

describe("e01 real recon shape (mapping version 2)", () => {
  it("reads the eight-column feature tables: paths, covered tools, kind counts, label module prefixes", () => {
    const { fx } = reconFixture();
    const r = runIn(fx, runImport, []);
    expect(r.code).toBe(0);
    const { lines } = readObservationFile(fx);
    const by = (label: string): Record<string, unknown> | undefined =>
      lines.find((l) => l.label === label);
    expect(by("Top bar sections")).toMatchObject({
      kind: "toolbar",
      module: "WorldEditor",
      recon_coverage: "none",
      paths_proposed: [{ path: "gui-automation" }],
    });
    expect(by("Top bar sections")).not.toHaveProperty("covers_proposed");
    expect(by("Top bar sections")).not.toHaveProperty("signature");
    expect(by("Copy / Cut / Paste (same position) / Duplicate")).toMatchObject({
      aggregate: true,
      recon_coverage: "covered",
      covers_proposed: ["wb_clipboard"],
      paths_proposed: [{ path: "net-api-handler" }],
    });
    expect(by("Toggle gizmo space")).toMatchObject({
      recon_coverage: "none",
      paths_proposed: [
        { path: "execute-action", reason: "label unverified" },
        { path: "gui-automation" },
      ],
    });
    expect(by("Tool Properties panel")?.kind).toBe("panel");
    expect(by("Entity list filter / sort")).toMatchObject({
      kind: "control",
      aggregate: true,
      recon_coverage: "partial",
      covers_proposed: ["wb_entity_list"],
    });
    expect(by("Compile All")).toMatchObject({
      kind: "menu-item",
      module: "ScriptEditor",
      key: { path: ["Build", "Compile All"] },
      recon_coverage: "partial",
      covers_proposed: ["wb_reload"],
      paths_proposed: [{ path: "execute-action" }],
    });
    expect(by("GetSelectedEntitiesCount")).toMatchObject({
      dim: "api",
      kind: "method",
      signature: "WorldEditorAPI.GetSelectedEntitiesCount()",
      covers_proposed: ["wb_entity_select"],
    });
    expect(r.stdout).toContain("kind unmappable (architecture)");
    // A fixed-module file keeps its module under a heading that merely mentions "Script".
    expect(by("SelectionToPrefabPlugin")).toMatchObject({
      dim: "plugin",
      kind: "plugin",
      module: "WorldEditor",
      key: { class: "SelectionToPrefabPlugin" },
      signature: "WorldEditorAPI.CreateEntityTemplate",
      paths_proposed: [{ path: "plugin-run" }],
    });
    // A heading naming a Resource Manager sub-editor outright selects that module.
    expect(by("Open texture")).toMatchObject({
      kind: "window",
      module: "ResourceManager.Texture",
      recon_coverage: "partial",
      covers_proposed: ["wb_resources"],
    });
  });

  it("skips work-item tables by heading instead of dropping their rows", () => {
    const { fx } = reconFixture();
    const r = runIn(fx, runImport, []);
    expect(r.stdout).toMatch(
      /world-editor\.md:\d+ "5\. Proposed 2\.0 work items": rows 1, emitted 0, aggregate 0, probes 0, dropped 0 \(skipped: work-item table, not a feature table\)/,
    );
    expect(r.stdout).not.toMatch(/dropped world-editor\.md:\d+: table "5\. Proposed/);
    expect(r.stdout).toContain("1 table skipped");
  });

  it("maps the kind cells the real recon files use", () => {
    const m = loadMapping();
    const k = (cell: string): [string | undefined, boolean] => {
      const r = normalizeKind(cell, m);
      return [r.kind, r.aggregate];
    };
    expect(k("plugin (WorkbenchPlugin)")).toEqual(["plugin", false]);
    expect(k("API method")).toEqual(["method", false]);
    expect(k("mcp-tool LIVE (World Editor)")).toEqual(["mcp-tool", false]);
    expect(k("mcp-tool LIVE+FILE (lifecycle)")).toEqual(["mcp-tool", false]);
    expect(k("NetApiHandler, 7 actions")).toEqual(["net-handler", true]);
    expect(k("file type, text")).toEqual(["file-type", false]);
    expect(k("menu item -> dialog")).toEqual(["menu-item", false]);
    expect(k("static methods")).toEqual(["static-method", false]);
    expect(k("flag passed by MCP")).toEqual(["cli-switch", false]);
    expect(k("native tool")).toEqual(["tool", false]);
    expect(k("plugin x4 (R)")).toEqual(["plugin", true]);
    expect(k("menu items [File membership inferred]")).toEqual(["menu-item", false]);
    expect(k("control (3)")).toEqual(["control", true]);
    expect(k("engine built-in NET function")).toEqual(["net-function", false]);
    expect(k("BI `NetApiHandler` subclasses (7)")).toEqual(["net-handler", true]);
    expect(k("menu (dynamic)")).toEqual(["menu", false]);
    expect(k("setting/action")).toEqual(["setting-key", false]);
    expect(k("signal node")).toEqual(["class", false]);
    expect(k("startup parameter")).toEqual(["cli-switch", false]);
    expect(k("**undocumented / unrecognised**")).toEqual([undefined, false]);
    expect(k("architecture")).toEqual([undefined, false]);
  });

  it("reads the coverage spellings the real recon files use", () => {
    const m = loadMapping();
    expect(readCoverage("none (handler: not used)", m)).toBe("none");
    expect(readCoverage("**none**", m)).toBe("none");
    expect(readCoverage("shipped", m)).toBe("covered");
    expect(readCoverage("wb_entity_modify (partial)", m)).toBe("partial");
    expect(readCoverage("partial — as above", m)).toBe("partial");
    expect(readCoverage("partial-broken (same)", m)).toBe("partial");
    expect(readCoverage("wb_clipboard [emcp_wb_clipboard]", m)).toBe("covered");
    expect(readCoverage("none (wb_connect uses emcp_wb_ping)", m)).toBe("none");
    expect(readCoverage("≈ 75.7k chars of string literals", m)).toBeNull();
    expect(coversFrom("wb_state, wb_layers [emcp_wb_getstate/layers]")).toEqual([
      "wb_state",
      "wb_layers",
    ]);
    expect(coversFrom("none")).toBeUndefined();
    expect(
      parsePaths(
        "net-api-handler; builtin-net-handler (BringModuleWindowToFront, OpenResource); cli (-wbmodule=ResourceManager); execute-action",
        m,
      ),
    ).toEqual([
      { path: "net-api-handler" },
      { path: "builtin-net-handler", reason: "BringModuleWindowToFront, OpenResource" },
      { path: "cli", reason: "-wbmodule=ResourceManager" },
      { path: "execute-action" },
    ]);
    expect(parsePaths("none", m)).toEqual([{ path: "none-known" }]);
    expect(parsePaths("n/a", m)).toBeUndefined();
    expect(parsePaths("", m)).toBeUndefined();
  });

  it("maps the real eight-column header", () => {
    const m = loadMapping();
    expect(
      mapColumns(
        [
          "Feature",
          "Kind",
          "What it does",
          "Script API (class.method or none)",
          "Automation path",
          "Current MCP coverage (tool name, partial, or none)",
          "Evidence (file / wiki page title / class)",
          "Confidence",
        ],
        m,
      ),
    ).toEqual({
      label: 0,
      kind: 1,
      what: 2,
      api: 3,
      path: 4,
      coverage: 5,
      evidence: 6,
      confidence: 7,
    });
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
