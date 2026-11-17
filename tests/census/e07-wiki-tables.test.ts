/**
 * E07 (wiki tables and structure): the wikitext parser and every mapping on
 * synthetic wikitext, determinism, ledger acceptance in a temporary census
 * copy, and a block on the real export (`data/wiki/export.xml` is committed, so
 * it always runs) that asserts the headline counts and the gate.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { deriveId } from "../../src/census/ids.js";
import { censusPaths } from "../../src/census/ledger-io.js";
import type { Observation } from "../../src/census/schemas.js";
import {
  CLI_RISK,
  Collector,
  FILE_TYPE_USED_BY_MODULE,
  GENERATOR,
  PAGE_RULES,
  SHORTCUT_ALT_SEP,
  addUi,
  anchorOf,
  assignColumns,
  bodyLines,
  buildE07,
  chordAlternatives,
  checkRows,
  cleanWiki,
  commentOnlyBody,
  cutSentence,
  decidePage,
  featureItemLabel,
  fileTypeModule,
  finalize,
  firstSentence,
  gridCell,
  headingOfLine,
  headlines,
  indexPage,
  isMouseChord,
  isPageUnit,
  keySeg,
  leadLines,
  linkLabels,
  mapBullets,
  mapCliHeadings,
  mapColumnsTable,
  mapContextTable,
  mapCurated,
  mapFeatureTable,
  mapFileTypes,
  mapHeadings,
  mapLinks,
  mapMenuTable,
  mapTermLines,
  observationFileText,
  pageUnits,
  parseDefinitionList,
  parseExport,
  parseList,
  pageHasText,
  parseWikitext,
  quoteFrom,
  reportText,
  resolveOut,
  resolveRef,
  run,
  safeText,
  sameShortcut,
  shortcutText,
  splitItem,
  splitPhrase,
  splitTopLevel,
  statedInSection,
  titleSlug,
  todoTemplate,
  unmappedSections,
  xmlUnescape,
  type Ctx,
  type DraftRef,
  type E07Result,
  type WikiPage,
} from "../../scripts/census/enumerators/e07-wiki-tables.js";
import { insideGitWorkTree } from "../../scripts/live/paths.js";
import { MODULES } from "../../src/census/vocab.js";
import { REAL_CENSUS, REPO_ROOT, makeCensus, runIn } from "./helpers.js";

const REAL_EXPORT = join(REPO_ROOT, "data", "wiki", "export.xml");

function page(title: string, text: string, ns = 5050): WikiPage {
  return { title, ns, id: 1, text };
}

function ctxFor(
  text: string,
  module: Ctx["module"] = "ResourceManager",
  title = "Arma Reforger:Test Page",
): Ctx {
  return { c: new Collector(), ix: indexPage(page(title, text)), module, spec: "test" };
}

/** Path of every row a collector holds, with its kind. */
function rowsOf(c: Collector): string[] {
  return [...c.all.keys()];
}

// ── The parser ────────────────────────────────────────────────────────────────

describe("wikitext parser: tables", () => {
  const TABLE = [
    "== Menus ==",
    '{| class="wikitable"',
    "! Title !! Items",
    "|-",
    '! rowspan="2" | File',
    "| Save || {{Controls|Ctrl|S}}",
    "|-",
    "| Open || [[Foo|Open dialog]]",
    "|-",
    '| colspan="2" | A note spanning both',
    "|}",
  ].join("\n");

  it("reads header, rowspan and colspan cells and assigns logical columns", () => {
    const { tables } = parseWikitext(TABLE);
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect(t.section).toBe("Menus");
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0].cells.map((c) => [c.header, c.text])).toEqual([
      [true, "Title"],
      [true, "Items"],
    ]);
    const file = t.rows[1].cells[0];
    expect(file).toMatchObject({ header: true, text: "File", rowspan: 2, col: 0 });
    expect(t.rows[1].cells.map((c) => c.col)).toEqual([0, 1, 2]);
    // Row 2 starts one column to the right: the rowspan of "File" still holds column 0.
    expect(t.rows[2].cells.map((c) => c.col)).toEqual([1, 2]);
    expect(t.rows[3].cells[0]).toMatchObject({ colspan: 2, col: 0, text: "A note spanning both" });
    expect(gridCell(t, 2, 0)?.text).toBe("File");
    expect(gridCell(t, 2, 2)?.text).toBe("Open dialog");
    expect(gridCell(t, 3, 1)?.text).toBe("A note spanning both");
  });

  it("cleans templates and links inside cells", () => {
    const { tables } = parseWikitext(TABLE);
    expect(tables[0].rows[1].cells[2].text).toBe("Ctrl+S");
    expect(tables[0].rows[2].cells[1].text).toBe("Open dialog");
  });

  it("splits `||` cells and keeps a pipe inside a link or template", () => {
    const { tables } = parseWikitext(["{|", "| [[A|b]] || {{Link|X|y}} || plain", "|}"].join("\n"));
    expect(tables[0].rows[0].cells.map((c) => c.text)).toEqual(["b", "y", "plain"]);
  });

  it("keeps multi-line cells and bullet lists in the cell's raw text", () => {
    const { tables } = parseWikitext(["{|", "|", "* one", "** two", "|", "text", "|}"].join("\n"));
    expect(tables[0].rows[0].cells[0].raw).toBe("* one\n** two");
    expect(tables[0].rows[0].cells[1].raw).toBe("text");
  });

  it("parses nested tables and numbers every table in document order", () => {
    const wiki = [
      "= Top =",
      "{|",
      "|",
      "{|",
      "| inner",
      "|}",
      "| outer",
      "|}",
      "{|",
      "| second",
      "|}",
    ].join("\n");
    const { tables } = parseWikitext(wiki);
    expect(tables.map((t) => [t.index, t.parent])).toEqual([
      [1, null],
      [2, 1],
      [3, null],
    ]);
    expect(tables[0].rows[0].cells[0].tables).toHaveLength(1);
    expect(tables[0].rows[0].cells[0].tables[0].rows[0].cells[0].text).toBe("inner");
    expect(tables[0].rows[0].cells[1].text).toBe("outer");
    expect(tables[0].section).toBe("Top");
  });

  it("attaches a heading written inside a cell to that cell and not to the section pointer", () => {
    const wiki = [
      "== Types ==",
      "{|",
      "! Ext !! Name",
      "|-",
      "|",
      "==== .acp ====",
      "| Audio component",
      "|}",
      "== After ==",
    ].join("\n");
    const { tables, headings } = parseWikitext(wiki);
    const cell = tables[0].rows[1].cells[0];
    expect(cell.headings.map((h) => [h.text, h.anchor, h.inCell])).toEqual([
      [".acp", ".acp", true],
    ]);
    expect(cell.text).toBe("");
    expect(tables[0].section).toBe("Types");
    expect(headings.map((h) => h.anchor)).toEqual(["Types", ".acp", "After"]);
  });

  it("de-duplicates anchors like MediaWiki and reads ArgTitle headings", () => {
    const { headings } = parseWikitext(
      [
        "== Same ==",
        "text",
        "== Same ==",
        "{{ArgTitle|3|addonTempDir|{{GVI|armaR|1.1.0}}}}",
        "== Same ==",
      ].join("\n"),
    );
    expect(headings.map((h) => h.anchor)).toEqual(["Same", "Same_2", "addonTempDir", "Same_3"]);
    expect(headings[2].level).toBe(3);
    expect(headingOfLine("not a heading")).toBeNull();
    expect(anchorOf(" A  b ")).toBe("A_b");
  });

  it("strips comments but keeps line numbers", () => {
    const { headings } = parseWikitext(
      ["<!-- a", "b -->", "== After ==", "{| <!-- x -->", "|}"].join("\n"),
    );
    expect(headings[0].line).toBe(3);
  });

  it("assignColumns honours rowspans on its own", () => {
    const rows = parseWikitext(["{|", '| rowspan="2" | a', "| b", "|-", "| c", "|}"].join("\n"))
      .tables[0].rows;
    assignColumns(rows);
    expect(rows[1].cells[0].col).toBe(1);
  });
});

describe("wikitext parser: lists and cleaning", () => {
  it("parses nested bullet lists, keeping blank lines inside the list", () => {
    const items = parseList(["* a", "", "** a1", "** a2", "* b", "# n"]);
    expect(items.map((i) => [i.raw, i.depth, i.children.map((c) => c.raw)])).toEqual([
      ["a", 1, ["a1", "a2"]],
      ["b", 1, []],
      ["n", 1, []],
    ]);
  });

  it("parses a definition list: one-line and two-line forms, colon inside a template kept", () => {
    const defs = parseDefinitionList([
      "; Term : meaning",
      "; Alone",
      ": its text",
      "; Link {{x|a:b}} : after",
    ]);
    expect(defs).toEqual([
      { term: "Term", def: "meaning", line: 1 },
      { term: "Alone", def: "its text", line: 2 },
      { term: "Link {{x|a:b}}", def: "after", line: 4 },
    ]);
  });

  it("cleans templates, links, emphasis, entities and comments", () => {
    expect(
      cleanWiki(
        "{{Controls|Ctrl|Shift|V}} and '''bold''' [[Page|label]] [[Plain]] &rarr; x<!-- c -->",
      ),
    ).toBe("Ctrl+Shift+V and bold label Plain → x");
    expect(cleanWiki("{{Link|Arma Reforger:World Editor}} {{hl|-addons}} {{n/a}}")).toBe(
      "World Editor -addons n/a",
    );
    expect(cleanWiki("{{Feature|informative|A note.}} text{{Clear}}")).toBe("A note. text");
    expect(cleanWiki("a<br>b<br />c")).toBe("a b c");
    expect(splitTopLevel("a|{{b|c}}|[[d|e]]")).toEqual(["a", "{{b|c}}", "[[d|e]]"]);
  });

  it("splits item and phrase texts", () => {
    expect(splitItem("'''Design canvas:''' This is the area.")).toEqual({
      label: "Design canvas",
      what: "This is the area.",
    });
    expect(splitItem("Register<br>Registers the resource")).toEqual({
      label: "Register",
      what: "Registers the resource",
    });
    expect(splitItem("'''Continue:''' {{Controls|F5}} Continue execution.")).toEqual({
      label: "Continue",
      what: "Continue execution.",
    });
    expect(splitPhrase("Loop Animation: should it restart")).toEqual({
      label: "Loop Animation",
      what: "should it restart",
    });
    expect(splitPhrase("error button - shows errors")).toEqual({
      label: "error button",
      what: "shows errors",
    });
    expect(linkLabels("[[#Outline|'''Outline''']] and {{Link|#Workspace}}")).toEqual([
      "Outline",
      "Workspace",
    ]);
  });

  it("cuts sentences without breaking on e.g. and keeps shortcut text clean", () => {
    expect(cutSentence("Switch tools (e.g. move, rotate) now. Next one.")).toBe(
      "Switch tools (e.g. move, rotate) now.",
    );
    expect(
      firstSentence([
        { text: "{{Feature|x|y}}" },
        { text: "Hello there. More. Shortcut: {{Controls|Ctrl|N}}" },
      ]),
    ).toBe("Hello there.");
    expect(shortcutText("{{Controls|Ctrl|Shift|F}}}")).toBe("Ctrl+Shift+F");
    expect(isMouseChord("Ctrl+LMB (Click)")).toBe(true);
    expect(isMouseChord("Ctrl+Z")).toBe(false);
  });

  it("an ellipsis inside a menu name does not end the sentence", () => {
    const s =
      "When ticked, Select entities... actions will not include children (useful to e.g avoid trees from a Forest Generator)";
    expect(cutSentence(s)).toBe(s);
    expect(cutSentence(`${s}. Then more.`)).toBe(`${s}.`);
    expect(cutSentence("Pick Change layer's material... or Clear. Done.")).toBe(
      "Pick Change layer's material... or Clear.",
    );
    // A sentence that really ends still ends; a lone ellipsis at the end changes nothing.
    expect(cutSentence("One. Two.")).toBe("One.");
    expect(cutSentence("Trailing...")).toBe("Trailing...");
    // The whole sentence is the description, and it is a unit of the page (not a cut piece).
    const ctx = ctxFor(
      [
        "== Opts ==",
        "=== Exclude children ===",
        "When ticked, '''Select entities...''' actions will not include children (useful to e.g avoid trees from a Forest Generator)",
      ].join("\n"),
      "WorldEditor",
    );
    mapHeadings(ctx, { root: "Opts", kinds: ["control"], mode: "leaf" });
    expect(ctx.c.find("control", "WorldEditor", ["Exclude children"])?.what).toBe(s);
    expect(isPageUnit(ctx.ix, "When ticked, Select entities...")).toBe(false);
    expect(isPageUnit(ctx.ix, s)).toBe(true);
  });

  it("reads an export: entities unescaped, title slug without whitespace", () => {
    const xml = [
      "<mediawiki><page><title>Arma Reforger:Capture &amp; Hold</title><ns>5050</ns><id>7</id>",
      '<revision><text bytes="9" xml:space="preserve">a &lt; b &amp;amp; c</text></revision></page>',
      "<page><title>Other</title><ns>0</ns><id>8</id><revision><text>x</text></revision></page></mediawiki>",
    ].join("");
    const pages = parseExport(xml);
    expect(pages.map((p) => [p.title, p.ns, p.id])).toEqual([
      ["Arma Reforger:Capture & Hold", 5050, 7],
      ["Other", 0, 8],
    ]);
    expect(pages[0].text).toBe("a < b &amp; c");
    expect(titleSlug("Arma Reforger:Capture & Hold")).toBe("Arma_Reforger:Capture_&_Hold");
    expect(xmlUnescape("&amp;lt;")).toBe("&lt;");
  });
});

// ── The mappings ──────────────────────────────────────────────────────────────

describe("mappings on synthetic wikitext", () => {
  it("menu table: menus, items, sub-menus, then descriptions and shortcuts from the headings", () => {
    const wiki = [
      "== Window Menu ==",
      '{| class="wikitable"',
      "! Title",
      "! Hierarchy",
      "|-",
      "! File",
      "|",
      "* Save",
      "* Recent",
      "** First",
      "** Second",
      "* [[Page|Publish]]",
      "|-",
      "! Edit",
      "|",
      "* Undo",
      "|}",
      "=== File ===",
      "Menu text.",
      "==== Save ====",
      "Save the file. Shortcut: {{Controls|Ctrl|S}}",
      "==== Extra ====",
      "An item the table lacks.",
      "=== Edit ===",
      "==== Undo ====",
      "Undo it.",
    ].join("\n");
    const ctx = ctxFor(wiki);
    mapMenuTable(ctx, ctx.ix.parsed.tables[0], {
      headingRoot: "Window_Menu",
      risk: { Publish: "external" },
    });
    expect(rowsOf(ctx.c)).toEqual(
      expect.arrayContaining([
        "ui:ResourceManager/menu/File",
        "ui:ResourceManager/menu-item/File/Save",
        "ui:ResourceManager/menu/File/Recent",
        "ui:ResourceManager/menu-item/File/Recent/First",
        "ui:ResourceManager/menu-item/File/Publish",
        "ui:ResourceManager/menu/Edit",
        "ui:ResourceManager/menu-item/Edit/Undo",
        "ui:ResourceManager/menu-item/File/Extra",
        "ui:ResourceManager/shortcut/File/Save",
      ]),
    );
    const save = ctx.c.find("menu-item", "ResourceManager", ["File", "Save"]);
    expect(save).toMatchObject({ what: "Save the file.", shortcut: "Ctrl+S", confidence: "high" });
    expect(ctx.c.find("menu-item", "ResourceManager", ["File", "Extra"])?.confidence).toBe(
      "medium",
    );
    expect(ctx.c.find("menu-item", "ResourceManager", ["File", "Publish"])?.risk).toBe("external");
    expect(ctx.c.find("menu", "ResourceManager", ["File"])?.what).toBe("Menu text.");
    expect(ctx.c.mappedTables.get("Arma Reforger:Test Page")?.has(1)).toBe(true);
  });

  it("context table: contexts, items with <br> descriptions, nested menus", () => {
    const wiki = [
      "== Menus ==",
      "{|",
      "! Context",
      "! Options",
      "|-",
      "| Tree view",
      "|",
      "* Show",
      "* Info<br>Shows info",
      "* SVN",
      "** Update",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki);
    mapContextTable(ctx, ctx.ix.parsed.tables[0], {});
    expect(rowsOf(ctx.c)).toEqual([
      "ui:ResourceManager/context-menu/Tree view",
      "ui:ResourceManager/context-item/Tree view/Show",
      "ui:ResourceManager/context-item/Tree view/Info",
      "ui:ResourceManager/context-menu/Tree view/SVN",
      "ui:ResourceManager/context-item/Tree view/SVN/Update",
    ]);
    expect(ctx.c.find("context-item", "ResourceManager", ["Tree view", "Info"])?.what).toBe(
      "Shows info",
    );
  });

  it("shortcut table with group header: keyboard keys are shortcuts, mouse chords are canvas gestures", () => {
    const wiki = [
      "== Keys ==",
      "{|",
      '! colspan="2" | Scene',
      "|-",
      "| Save || {{Controls|Ctrl|S}}",
      "|-",
      "| Pan || {{Controls|LMB}} ''(Drag)''",
      "|-",
      "|",
      "|",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki, "AudioEditor");
    mapColumnsTable(ctx, ctx.ix.parsed.tables[0], {
      kind: ({ key }) => (isMouseChord(key) ? "canvas-gesture" : "shortcut"),
      label: 0,
      shortcut: 1,
      group: "header",
    });
    expect(rowsOf(ctx.c)).toEqual([
      "ui:AudioEditor/shortcut/Scene/Save",
      "ui:AudioEditor/canvas-gesture/Scene/Pan",
    ]);
    expect(ctx.c.find("shortcut", "AudioEditor", ["Scene", "Save"])?.shortcut).toBe("Ctrl+S");
    expect(ctx.c.find("canvas-gesture", "AudioEditor", ["Scene", "Pan"])?.shortcut).toBe(
      "LMB (Drag)",
    );
    expect(ctx.c.skipped.map((s) => s.reason)).toEqual(["row with an empty label or key"]);
  });

  it("tool-option table: the option name is a heading in the first cell", () => {
    const wiki = [
      "== Settings ==",
      "=== Brush ===",
      "{|",
      "! Name !! Description",
      "|-",
      "|",
      "==== Radius ====",
      "| Brush's radius",
      "|-",
      "|",
      "==== Strength ====",
      "| Brush's strength. More text.",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki, "WorldEditor");
    mapColumnsTable(ctx, ctx.ix.parsed.tables[0], {
      kind: "option",
      label: 0,
      what: 1,
      headingLabel: true,
      base: ["Brush Tool", "Brush"],
    });
    expect(rowsOf(ctx.c)).toEqual([
      "ui:WorldEditor/option/Brush Tool/Brush/Radius",
      "ui:WorldEditor/option/Brush Tool/Brush/Strength",
    ]);
    expect(ctx.c.find("option", "WorldEditor", ["Brush Tool", "Brush", "Strength"])).toMatchObject({
      what: "Brush's strength.",
      anchor: "Strength",
    });
  });

  it("bullet lists: bold labels, phrase lists with a trailing shortcut, link labels, a picked sub-list", () => {
    // "second" must be page text for the description to be kept.
    const ctx = ctxFor("== L ==\nsecond\n");
    const lines = (...l: string[]): { line: number; text: string }[] =>
      l.map((text, i) => ({ line: i + 2, text }));
    mapBullets(ctx, lines("# '''One:''' first", "# '''Two''' - second"), {
      kinds: ["panel"],
      labels: "bold",
      anchor: "L",
    });
    mapBullets(ctx, lines("* create workspace ({{Controls|Ctrl|N}})", "* stop playing"), {
      kinds: ["toolbar-button"],
      labels: "phrase",
      base: ["Bar"],
      anchor: "L",
      shortcutRows: true,
    });
    mapBullets(ctx, lines("# [[#Outline|'''Outline''']] and [[#Projects|'''Projects''']]"), {
      kinds: ["panel"],
      labels: "links",
      anchor: "L",
    });
    mapBullets(
      ctx,
      lines(
        "* Other",
        "* Timeline Controls:",
        "** First Frame",
        "** Show Options:",
        "*** Inplace: stays",
      ),
      {
        kinds: ["control", "option"],
        labels: "phrase",
        pick: "Timeline Controls",
        base: ["Timeline"],
        anchor: "L",
      },
    );
    expect(rowsOf(ctx.c)).toEqual([
      "ui:ResourceManager/panel/One",
      "ui:ResourceManager/panel/Two",
      "ui:ResourceManager/toolbar-button/Bar/create workspace",
      "ui:ResourceManager/shortcut/Bar/create workspace",
      "ui:ResourceManager/toolbar-button/Bar/stop playing",
      "ui:ResourceManager/panel/Outline",
      "ui:ResourceManager/panel/Projects",
      "ui:ResourceManager/control/Timeline/First Frame",
      "ui:ResourceManager/control/Timeline/Show Options",
      "ui:ResourceManager/option/Timeline/Show Options/Inplace",
    ]);
    expect(
      ctx.c.find("toolbar-button", "ResourceManager", ["Bar", "create workspace"])?.shortcut,
    ).toBe("Ctrl+N");
    expect(ctx.c.find("panel", "ResourceManager", ["Two"])?.what).toBe("second");
  });

  it("heading walk: leaf rows, groups in the path, parent from the nearest emitted ancestor, kind from a function", () => {
    const wiki = [
      "== Panels ==",
      "=== Preview Panel ===",
      "Preview text.",
      "==== Grid ====",
      "Shows the grid.",
      "=== Emitter ===",
      "==== General ====",
      "===== Shape =====",
      "Shape text.",
    ].join("\n");
    const ctx = ctxFor(wiki, "ParticleEditor");
    mapHeadings(ctx, {
      root: "Panels",
      kinds: [],
      mode: "all",
      kindOf: (_t, depth, parent) =>
        depth === 1
          ? "panel"
          : depth === 2 && parent?.text === "Preview Panel"
            ? "toolbar-button"
            : null,
    });
    expect(rowsOf(ctx.c)).toEqual([
      "ui:ParticleEditor/panel/Preview Panel",
      "ui:ParticleEditor/toolbar-button/Preview Panel/Grid",
      "ui:ParticleEditor/panel/Emitter",
    ]);
    expect(
      ctx.c.all.get("ui:ParticleEditor/toolbar-button/Preview Panel/Grid")?.parent?.key.path,
    ).toEqual(["Preview Panel"]);
    const leaf = ctxFor(wiki, "ParticleEditor");
    mapHeadings(leaf, {
      root: "Emitter",
      kinds: ["option"],
      mode: "leaf",
      groups: true,
      base: ["Emitter Tool"],
    });
    expect(rowsOf(leaf.c)).toEqual(["ui:ParticleEditor/option/Emitter Tool/General/Shape"]);
  });

  it("file types: the extension heading in the first cell gives the key; unknown rows are reported", () => {
    const wiki = [
      "{|",
      "! Extension !! File Type !! Saved/Used by !! Description",
      "|-",
      "|",
      "==== .acp ====",
      "| Audio component",
      "| {{Link|Arma Reforger:Audio Editor}}",
      "| Describe playback",
      "Second line",
      "|-",
      "|",
      "| No heading",
      "| x",
      "| y",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki, "ResourceManager", "Arma Reforger:File Types");
    mapFileTypes(ctx, ctx.ix.parsed.tables[0]);
    expect(rowsOf(ctx.c)).toEqual(["file:.acp"]);
    expect(ctx.c.all.get("file:.acp")).toMatchObject({
      // The Description cell's own first line; Saved/Used by is not folded into it.
      what: "Describe playback",
      anchor: ".acp",
      key: { ext: "acp" },
      // The module is the editor the Saved/Used by cell names.
      module: "AudioEditor",
    });
    expect(ctx.c.skipped).toHaveLength(1);
  });

  it("file-type module: the editor the Saved/Used by cell names, by the vocabulary; several editors or none named give none", () => {
    const cases: [string, string][] = [
      ["{{Link|Arma Reforger:Audio Editor}}", "AudioEditor"],
      ["{{Link|Arma Reforger:Animation Editor}}", "AnimEditor"],
      ["{{Link|Arma Reforger:Particle Editor}}", "ParticleEditor"],
      ["{{Link|Arma Reforger:String Editor}}", "LocalizationEditor"],
      ["{{Link|Arma Reforger:Behavior Editor}}", "BehaviorEditor"],
      ["{{Link|Arma Reforger:Procedural Animation Editor}}", "ProcAnimEditor"],
      ["{{Link|Arma Reforger:World Editor}}", "WorldEditor"],
      ["{{Link|Arma Reforger:Script Editor}}", "ScriptEditor"],
      ["{{Link|Arma Reforger:Resource Manager}}", "ResourceManager"],
      [
        "{{Link|Arma Reforger:Resource Manager}}'s {{Link|Arma Reforger:Resource Manager: Config Editor|Config Editor}}",
        "ResourceManager.Config",
      ],
      [
        "{{Link|Arma Reforger:Resource Manager}}'s {{Link|Arma Reforger:Resource Manager: Font Viewer|Font Viewer}}",
        "ResourceManager.Font",
      ],
      [
        "{{Link|Arma Reforger:Resource Manager: Config Editor|Config Editor}}",
        "ResourceManager.Config",
      ],
      // One editor and some plugins: the one editor.
      ["{{Link|Arma Reforger:Animation Editor}}\n+ various plugins", "AnimEditor"],
      // None named.
      [
        "Resource Browser\n+ various plugins (see {{Link|Arma Reforger:Enfusion Blender Tools|Enfusion Blender Tools}})",
        "none",
      ],
      ["Resource Browser", "none"],
      ["Art Tools", "none"],
      ["3D software", "none"],
      ["Proprietary format", "none"],
      ["Animation offline debugger", "none"],
      ["{{GameCategory|armaR|Modding|Official Tools|text= Workbench}}", "none"],
      // Several editors: none.
      ["{{Link|Arma Reforger:World Editor}} + {{Link|Arma Reforger:Script Editor}}", "none"],
      ["", "none"],
    ];
    for (const [cell, module] of cases) expect(fileTypeModule(cell), cell).toBe(module);
    // Every module the table can give is in the vocabulary.
    for (const m of Object.values(FILE_TYPE_USED_BY_MODULE))
      expect(MODULES as readonly string[]).toContain(m);
  });

  it("startup parameters: heading switches, ArgTitle switches, shared body, first occurrence wins", () => {
    const wiki = [
      "== General ==",
      "=== addons ===",
      "{{hl|-addons}} takes a list. Second sentence.",
      "{{ArgTitle|3|addonTempDir|{{GVI|armaR|1.1.0}}}}",
      "{{hl|-addonTempDir}} sets the temp dir.",
      "== Window ==",
      "=== posX ===",
      "=== posY ===",
      "{{hl|-posX}} and {{hl|-posY}} set the position.",
      "== Workbench - ScriptEditor Module ==",
      "=== saveDir ===",
      "{{hl|-saveDir}} a.",
      "== Workbench - ResourceManager Module ==",
      "=== saveDir ===",
      "{{hl|-saveDir}} b.",
      "=== wbBackendLogin ===",
      "{{hl|-wbBackendLogin}} logs in.",
      "== Unknown Section ==",
      "=== nope ===",
    ].join("\n");
    const ctx = ctxFor(wiki, "none", "Arma Reforger:Startup Parameters");
    expect(mapCliHeadings(ctx)).toBe(6);
    // `deriveId` folds a switch to lower case.
    expect(rowsOf(ctx.c)).toEqual([
      "cli:-addons",
      "cli:-addontempdir",
      "cli:-posx",
      "cli:-posy",
      "cli:-savedir",
      "cli:-wbbackendlogin",
    ]);
    expect(ctx.c.all.get("cli:-addons")?.what).toBe("-addons takes a list.");
    expect(ctx.c.all.get("cli:-posy")?.what).toBe("-posX and -posY set the position.");
    expect(ctx.c.all.get("cli:-savedir")?.what).toBe("-saveDir a.");
    expect(ctx.c.all.get("cli:-wbbackendlogin")?.risk).toBe("credential");
    expect(ctx.c.duplicates.map((d) => d.what)).toEqual(["-saveDir"]);
    expect(ctx.c.skipped.map((s) => s.what)).toEqual(["nope"]);
    expect(CLI_RISK.clearSettings).toBe("destructive");
  });

  it("links table: a rowspan cell supplies the parameters of the rows below it; the module is the table's own name", () => {
    const wiki = [
      "== Format ==",
      "{|",
      "! Module !! Module Name !! Base Link !! Parameters",
      "|-",
      "| WE || WorldEditor || {{Color|blue|enfusion://}}{{Color|darkorange|WorldEditor}}",
      "|",
      "* camera position",
      "* entity ID",
      "|-",
      '| colspan="4" | The following modules do not support a file parameter - a link can only be used to open the editor.',
      "|-",
      "| PE || ParticleEditor || {{Color|blue|enfusion://}}{{Color|darkorange|ParticleEditor}}",
      '| rowspan="2" | {{n/a}}',
      "|-",
      "| AE || AnimEditor || {{Color|blue|enfusion://}}{{Color|darkorange|AnimEditor}}",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki, "none", "Arma Reforger:Workbench Links");
    mapLinks(ctx, ctx.ix.parsed.tables[0]);
    expect(rowsOf(ctx.c)).toEqual([
      "link:enfusion://WorldEditor",
      "link:enfusion://ParticleEditor",
      "link:enfusion://AnimEditor",
    ]);
    // `what` is the page's own banner sentence, only on the rows below it; a bullet list of
    // parameters is not a sentence and is not carried.
    expect(ctx.c.all.get("link:enfusion://WorldEditor")).toMatchObject({
      module: "WorldEditor",
      what: undefined,
    });
    expect(ctx.c.all.get("link:enfusion://AnimEditor")?.what).toBe(
      "The following modules do not support a file parameter - a link can only be used to open the editor.",
    );
  });

  it("curated rows: a quote that is not in the page drops the row and says why", () => {
    const ctx = ctxFor("== S ==\nThe button does it.\n");
    mapCurated(ctx, [
      { kind: "control", path: ["Button"], anchor: "S", quote: "The button does it." },
      { kind: "control", path: ["Missing"], anchor: "S", quote: "not in the page" },
      { kind: "control", path: ["No anchor"], anchor: "Nope", quote: "The button does it." },
    ]);
    expect(rowsOf(ctx.c)).toEqual(["ui:ResourceManager/control/Button"]);
    expect(ctx.c.skipped.map((s) => s.reason).filter((r) => r.startsWith("curated"))).toEqual([
      "curated quote not found in the export",
      "curated anchor not found in the export",
    ]);
    // "Button" is a word inside the sentence, not a unit of the page: the key keeps the name, no label.
    expect(ctx.c.find("control", "ResourceManager", ["Button"])?.label).toBeUndefined();
  });

  it("feature table: the title cell is not a row; bold lines, labelled bullets and sub-headings are", () => {
    const wiki = [
      "== Paint ==",
      '{| class="wikitable"',
      "! Feature",
      "! Screenshot",
      "! Description",
      "|-",
      "|",
      "=== Brush ===",
      "| [[File:a.png]]",
      "| '''Show block''' – shows the block under the cursor. More text.",
      "Prose line.",
      "{{Feature|informative|See elsewhere.}}",
      "",
      "==== Strength ====",
      "range: 0..40",
      "",
      "Strength of the brush. {{Controls|Shift|MouseUp}} to adjust.",
      "|-",
      "|",
      "=== Layers ===",
      "| [[File:b.png]]",
      "|",
      "* '''Clear layer''' – clears it.",
      "* Layer list – A drag and drop list.",
      "* The first layer is the default and cannot be removed – read on for more details about it.",
      "** '''Legend child''' – below a remark, not a control",
      "* '''Replace''' – replaces it.",
      "** A 3x3 grid shows the neighbours.",
      "*** '''Green''' – free slot",
      "|-",
      "|",
      "=== Info ===",
      "| [[File:c.png]]",
      "|",
      "==== Block ====",
      "** '''Live''' – under the cursor.",
      "** '''Coordinates''' – the tile.",
      "==== Pixel ====",
      "** '''Coordinates''' – same as above.",
      "|-",
      "|",
      "=== Steps ===",
      "| {{Wiki|TODO}}",
      "|",
      "# Select a block.",
      "# '''Not a control''' – a step.",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki, "WorldEditor", "Arma Reforger:Tool");
    const tool: DraftRef = { dim: "ui", kind: "tool", module: "WorldEditor", key: { path: ["T"] } };
    mapFeatureTable(ctx, ctx.ix.parsed.tables[0], { base: ["T", "Paint"], parent: tool });
    expect(rowsOf(ctx.c)).toEqual([
      "ui:WorldEditor/control/T/Paint/Show block",
      "ui:WorldEditor/option/T/Paint/Strength",
      "ui:WorldEditor/control/T/Paint/Clear layer",
      "ui:WorldEditor/control/T/Paint/Layer list",
      "ui:WorldEditor/control/T/Paint/Replace",
      "ui:WorldEditor/control/T/Paint/Block/Live",
      "ui:WorldEditor/control/T/Paint/Block/Coordinates",
      "ui:WorldEditor/control/T/Paint/Pixel/Coordinates",
    ]);
    // The option's description skips the `range:` line; the item's is the page's own sentence.
    expect(ctx.c.find("option", "WorldEditor", ["T", "Paint", "Strength"])?.what).toBe(
      "Strength of the brush.",
    );
    expect(ctx.c.find("control", "WorldEditor", ["T", "Paint", "Show block"])?.what).toBe(
      "shows the block under the cursor.",
    );
    expect(ctx.c.find("control", "WorldEditor", ["T", "Paint", "Layer list"])?.what).toBe(
      "A drag and drop list.",
    );
    // "same as above" is not a description.
    expect(
      ctx.c.find("control", "WorldEditor", ["T", "Paint", "Pixel", "Coordinates"])?.what,
    ).toBeUndefined();
    // Row titles are reported, not emitted; the items' anchors are headings of the page.
    expect(ctx.c.skipped.map((s) => s.what)).toEqual(["Brush", "Layers", "Info", "Steps"]);
    for (const d of ctx.c.all.values()) expect(ctx.ix.anchors.has(d.anchor), d.anchor).toBe(true);
    expect(featureItemLabel("Name - a long description of the thing")).toEqual({
      label: "Name",
      what: "a long description of the thing",
    });
    expect(
      featureItemLabel("A sentence that goes on for a long while before it ever - dashes"),
    ).toBeNull();
  });

  it("a leaf control whose only content is an HTML comment is not a row; an empty one is; a tool is", () => {
    const wiki = [
      "== Manage ==",
      "=== Options ===",
      "<!-- '''hidden checkbox''' -->",
      "=== Empty ===",
      "=== Real ===",
      "Does a thing.",
      "=== Some Tool ===",
      "<!-- see the article -->",
    ].join("\n");
    const ctx = ctxFor(wiki, "WorldEditor");
    const ix = ctx.ix;
    expect(commentOnlyBody(ix, ix.byAnchor.get("Options")!)).toBe(true);
    expect(commentOnlyBody(ix, ix.byAnchor.get("Empty")!)).toBe(false);
    expect(commentOnlyBody(ix, ix.byAnchor.get("Real")!)).toBe(false);
    mapHeadings(ctx, {
      root: "Manage",
      kinds: [],
      kindOf: (t) => (/Tool$/.test(t) ? "tool" : "control"),
      mode: "leaf",
    });
    expect(rowsOf(ctx.c)).toEqual([
      "ui:WorldEditor/control/Empty",
      "ui:WorldEditor/control/Real",
      "ui:WorldEditor/tool/Some Tool",
    ]);
    expect(ctx.c.skipped.map((s) => s.what)).toEqual(["control Options"]);
    expect(ctx.c.skipped[0].reason).toMatch(/only content is an HTML comment/);
  });

  it("heading walk: an alias renames a synonym; a checkbox control becomes an option", () => {
    const wiki = [
      "== Tools ==",
      "=== Terrain Tool ===",
      "See {{Link|Arma Reforger:World Editor: Terrain Creation Tool#Sculpt}}. Shortcut: {{Controls|Ctrl|T}}",
      "=== Snap ===",
      "Checkbox: sets a thing.",
      "=== Snap again ===",
      "Snaps points.",
    ].join("\n");
    const ctx = ctxFor(wiki, "WorldEditor");
    mapHeadings(ctx, {
      root: "Tools",
      kinds: ["control"],
      mode: "leaf",
      shortcuts: true,
      alias: { "Terrain Tool": "Terrain Creation Tool" },
      checkboxOption: true,
    });
    expect(rowsOf(ctx.c)).toEqual([
      "ui:WorldEditor/control/Terrain Creation Tool",
      "ui:WorldEditor/shortcut/Terrain Creation Tool",
      "ui:WorldEditor/option/Snap",
      "ui:WorldEditor/control/Snap again",
    ]);
    expect(ctx.c.find("control", "WorldEditor", ["Terrain Creation Tool"])?.shortcut).toBe(
      "Ctrl+T",
    );
    // One row kept for two page locations: the kept rows (the row and its shortcut row) name the
    // other location and quote the section's sentence the merge rests on, verbatim from the page.
    const sentence =
      "See {{Link|Arma Reforger:World Editor: Terrain Creation Tool#Sculpt}}. Shortcut: {{Controls|Ctrl|T}}";
    expect(ctx.ix.page.text).toContain(sentence);
    for (const kind of ["control", "shortcut"] as const) {
      const notes = ctx.c.find(kind, "WorldEditor", ["Terrain Creation Tool"])?.unverified ?? [];
      expect(notes, kind).toHaveLength(1);
      expect(notes[0], kind).toContain(
        '"Terrain Tool" here (wiki:Arma_Reforger:Test_Page#Terrain_Tool)',
      );
      expect(notes[0], kind).toContain('"Terrain Creation Tool"');
      expect(notes[0], kind).toContain("(wiki:Arma_Reforger:World_Editor:_Terrain_Creation_Tool)");
      expect(notes[0], kind).toContain(`"${sentence}"`);
      expect(notes[0], kind).toContain("do not state that they are one thing");
    }
    // A row that is not an alias carries nothing.
    expect(ctx.c.find("option", "WorldEditor", ["Snap"])?.unverified).toBeUndefined();
  });

  it("term lines: `; Term` with the description on the next line", () => {
    const wiki = [
      "== Cog ==",
      "; Set Image",
      "Set the texture.",
      "",
      "; Clear Image",
      "Remove it.",
    ].join("\n");
    const ctx = ctxFor(wiki, "WorldEditor");
    const lines = ctx.ix.lines.map((text, i) => ({ line: i + 1, text })).slice(1);
    const parent: DraftRef = {
      dim: "ui",
      kind: "control",
      module: "WorldEditor",
      key: { path: ["Cog"] },
    };
    mapTermLines(ctx, lines, { kind: "menu-item", base: ["Cog"], parent, anchor: "Cog" });
    expect(rowsOf(ctx.c)).toEqual([
      "ui:WorldEditor/menu-item/Cog/Set Image",
      "ui:WorldEditor/menu-item/Cog/Clear Image",
    ]);
    expect(ctx.c.find("menu-item", "WorldEditor", ["Cog", "Clear Image"])?.what).toBe("Remove it.");
  });

  it("shortcut text: one separator between alternatives, the page's key names kept", () => {
    expect(SHORTCUT_ALT_SEP).toBe(" / ");
    // Key names are the page's own, however it spells them.
    expect(shortcutText("{{Controls|Ctrl|PageDown}}")).toBe("Ctrl+PageDown");
    expect(shortcutText("{{Controls|Ctrl|Page Up}}")).toBe("Ctrl+Page Up");
    expect(shortcutText("{{Controls|Ctrl|Spacebar}}")).toBe("Ctrl+Spacebar");
    expect(shortcutText("{{Controls|Ctrl|S}}")).toBe("Ctrl+S");
    // Alternatives: a <br>, a line break, a slash, a comma, "or", or two keys side by side.
    const mouse = "Shift+Mouse up / Shift+Mouse down";
    expect(shortcutText("{{Controls|Shift|Mouse up}}<br>\n{{Controls|Shift|Mouse down}}")).toBe(
      mouse,
    );
    expect(shortcutText("{{Controls|Shift|Mouse up}}\n{{Controls|Shift|Mouse down}}")).toBe(mouse);
    expect(shortcutText("{{Controls|Shift|Mouse up}}/{{Controls|Shift|Mouse down}}")).toBe(mouse);
    expect(shortcutText("{{Controls|Shift|Mouse up}}, {{Controls|Shift|Mouse down}}")).toBe(mouse);
    expect(shortcutText("{{Controls|Shift|Mouse up}} or {{Controls|Shift|Mouse down}}")).toBe(
      mouse,
    );
    expect(shortcutText("{{Controls|W}}{{Controls|A}}{{Controls|S}}{{Controls|D}}")).toBe(
      "W / A / S / D",
    );
    expect(shortcutText("{{Controls|W}}/{{Controls|A}}/{{Controls|S}}/{{Controls|D}}")).toBe(
      "W / A / S / D",
    );
    // A qualifier the page writes after the keys stays.
    expect(shortcutText("{{Controls|Alt|LMB}} ''(Click)''")).toBe("Alt+LMB (Click)");
    // A chord that holds one key and offers several others.
    expect(chordAlternatives("RMB", ["W", "S"])).toBe("RMB+W / RMB+S");
  });

  it("two spellings of one shortcut compare equal, and only for comparing", () => {
    expect(sameShortcut("Ctrl+PageUp", "Ctrl+Page Up")).toBe(true);
    expect(sameShortcut("Ctrl+Spacebar", "Ctrl+space")).toBe(true);
    expect(sameShortcut("Ctrl+Page Up", "Ctrl+Page Down")).toBe(false);
    expect(sameShortcut(undefined, "Ctrl+S")).toBe(false);
  });

  it("a description that is not text of the page is left out and reported; a cleaned one is kept", () => {
    const ctx = ctxFor("== S ==\n* '''Bold''' – the page says this.\nOther line.\n");
    expect(pageHasText(ctx.ix, "the page says this.")).toBe(true);
    expect(pageHasText(ctx.ix, "invented")).toBe(false);
    addUi(ctx, "control", ["A"], { what: "the page says this.", anchor: "S" });
    addUi(ctx, "control", ["B"], { what: "something the author wrote", anchor: "S" });
    expect(ctx.c.find("control", "ResourceManager", ["A"])?.what).toBe("the page says this.");
    expect(ctx.c.find("control", "ResourceManager", ["B"])?.what).toBeUndefined();
    expect(ctx.c.skipped.map((s) => s.reason)).toContain(
      "description is not a sentence of the page; omitted",
    );
  });

  it("labels and descriptions are the page's own units: a fragment label is left out, a fragment description is widened to its sentence", () => {
    const wiki = [
      "== Navigation ==",
      "With the mouse wheel {{Controls|MMB}} you can move the camera forward and backward.",
      "* Use the {{Controls|A}} and {{Controls|D}} keys to move the camera sideways.",
      "* \'\'\'Zoom\'\'\': scroll the wheel to zoom in.",
      'Click "OK" to create the project.',
      "{|",
      "! Function !! Key",
      "|-",
      "| Pan",
      "| {{Controls|LMB}}",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki, "WorldEditor");
    const u = pageUnits(ctx.ix);
    // Units: a whole sentence, a list item, a bold label, the description after it, a cell, a quoted name.
    for (const t of [
      "With the mouse wheel MMB you can move the camera forward and backward.",
      "Use the A and D keys to move the camera sideways.",
      "Zoom",
      "scroll the wheel to zoom in.",
      "Pan",
      "OK",
    ])
      expect(u.all.has(t), t).toBe(true);
    // Fragments: a clause cut out of a sentence.
    for (const t of ["move the camera forward and backward", "to create the project", "forward"])
      expect(isPageUnit(ctx.ix, t), t).toBe(false);
    // A composed gesture name: the key keeps it, the label is dropped, the quote is the sentence.
    addUi(ctx, "canvas-gesture", ["Viewport", "move the camera forward and backward"], {
      shortcut: "MMB",
      anchor: "Navigation",
      quote: "With the mouse wheel {{Controls|MMB}} you can move the camera forward and backward.",
    });
    const g = ctx.c.find("canvas-gesture", "WorldEditor", [
      "Viewport",
      "move the camera forward and backward",
    ]);
    expect(g?.label).toBeUndefined();
    expect(g?.what).toBeUndefined();
    expect(g?.quote).toContain("move the camera forward and backward");
    // A page unit stays the label.
    addUi(ctx, "shortcut", ["Pan"], { shortcut: "LMB", anchor: "Navigation", quote: "Pan" });
    expect(ctx.c.find("shortcut", "WorldEditor", ["Pan"])?.label).toBe("Pan");
    // A description cut from the tail of a sentence is widened to that sentence.
    addUi(ctx, "control", ["OK"], { what: "to create the project", anchor: "Navigation" });
    expect(ctx.c.find("control", "WorldEditor", ["OK"])?.what).toBe(
      'Click "OK" to create the project.',
    );
    expect(ctx.c.rewritten.map((r) => r.what)).toEqual(["OK"]);
    // A description the page does not hold is left out.
    addUi(ctx, "control", ["Zoom"], { what: "scrolls the wheel", anchor: "Navigation" });
    expect(ctx.c.find("control", "WorldEditor", ["Zoom"])?.what).toBeUndefined();
  });

  it("a row can be skipped when the same thing is already a row", () => {
    const wiki = [
      "== Sc ==",
      "{|",
      "! Key",
      "! What",
      "|-",
      "| {{Controls|Ctrl|W}}",
      "| Closes tab",
      "|-",
      "| {{Controls|F9}}",
      "| Does it",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki);
    const seen: { label: string; key: string; raw: { label: string; key: string } }[] = [];
    mapColumnsTable(ctx, ctx.ix.parsed.tables[0], {
      kind: "shortcut",
      label: 1,
      shortcut: 0,
      skipRow: (label, key, raw) => {
        seen.push({ label, key, raw });
        return label === "Closes tab" ? "same shortcut as a menu row" : undefined;
      },
    });
    expect(rowsOf(ctx.c)).toEqual(["ui:ResourceManager/shortcut/Does it"]);
    expect(ctx.c.skipped.map((s) => s.reason)).toEqual(["same shortcut as a menu row"]);
    // The callback gets the cells as the page writes them, so a kept row can quote them.
    expect(seen[0]).toEqual({
      label: "Closes tab",
      key: "Ctrl+W",
      raw: { label: "Closes tab", key: "{{Controls|Ctrl|W}}" },
    });
    for (const s of seen) {
      expect(ctx.ix.page.text).toContain(s.raw.label);
      expect(ctx.ix.page.text).toContain(s.raw.key);
    }
  });

  it("a maintenance TODO in a description cell is no description: `what` is left out and the row carries the template in `unverified`", () => {
    const todo =
      "{{Wiki|TODO|seems to disable '''View > Perspective''' and '''Focus selected object'''}}";
    const wiki = [
      "== Bar ==",
      "{|",
      "! Tool",
      "! What",
      "|-",
      "| '''Camera auto placement'''",
      `| ${todo}`,
      "|-",
      "| '''Reset'''",
      "| Resets the view.",
      "|-",
      "| '''Empty'''",
      "| {{Wiki|TODO}}",
      "|}",
    ].join("\n");
    const ctx = ctxFor(wiki, "ResourceManager.Model");
    expect(cleanWiki(todo)).toBe("");
    expect(cleanWiki("a {{Wiki|TODO}} b")).toBe("a b");
    expect(todoTemplate(`| ${todo}`)).toBe(todo);
    expect(todoTemplate("| Resets the view.")).toBeUndefined();
    mapColumnsTable(ctx, ctx.ix.parsed.tables[0], {
      kind: "toolbar-button",
      label: 0,
      what: 1,
      base: ["Bar"],
    });
    const row = ctx.c.find("toolbar-button", "ResourceManager.Model", [
      "Bar",
      "Camera auto placement",
    ]);
    expect(row?.what).toBeUndefined();
    expect(row?.unverified).toHaveLength(1);
    expect(row?.unverified?.[0]).toContain(todo);
    expect(ctx.ix.page.text).toContain(todo);
    // A real description stays and carries nothing; a bare TODO has no text to flatten either.
    const reset = ctx.c.find("toolbar-button", "ResourceManager.Model", ["Bar", "Reset"]);
    expect(reset?.what).toBe("Resets the view.");
    expect(reset?.unverified).toBeUndefined();
    const empty = ctx.c.find("toolbar-button", "ResourceManager.Model", ["Bar", "Empty"]);
    expect(empty?.what).toBeUndefined();
    expect(empty?.unverified?.[0]).toContain("{{Wiki|TODO}}");
    // The note reaches the observation.
    const f = finalize(ctx.c, { kinds: new Set(["toolbar-button"]), dims: new Set(["ui"]) });
    expect(f.invalid).toEqual([]);
    const obs = f.rows.find((r) => r.id.endsWith("/Camera auto placement"))?.obs;
    expect(obs?.what).toBeUndefined();
    expect(obs?.unverified).toEqual(row?.unverified);
  });

  it("a control name the page states in running prose keeps its label when the spec marks it `named` and the cited section holds those exact words; a composed phrase never does", () => {
    const wiki = [
      "== Panel ==",
      "Next there are controls which allow you to Restart or Pause the effect.",
      "== Other ==",
      "Nothing about it here.",
    ].join("\n");
    const ctx = ctxFor(wiki, "ParticleEditor");
    expect(statedInSection(ctx.ix, "Panel", "Pause")).toBe(true);
    expect(statedInSection(ctx.ix, "Panel", "pause")).toBe(false); // exact case
    expect(statedInSection(ctx.ix, "Panel", "Paus")).toBe(false); // whole words
    expect(statedInSection(ctx.ix, "Other", "Pause")).toBe(false); // the cited section only
    addUi(ctx, "control", ["Panel", "Pause"], { anchor: "Panel", named: true });
    addUi(ctx, "control", ["Panel", "Restart"], { anchor: "Panel" }); // not marked
    addUi(ctx, "control", ["Panel", "Stop"], { anchor: "Panel", named: true }); // not in the section
    addUi(ctx, "control", ["Other", "Pause"], { anchor: "Other", named: true }); // another section
    expect(ctx.c.find("control", "ParticleEditor", ["Panel", "Pause"])?.label).toBe("Pause");
    expect(ctx.c.find("control", "ParticleEditor", ["Other", "Pause"])?.label).toBeUndefined();
    expect(ctx.c.find("control", "ParticleEditor", ["Panel", "Restart"])?.label).toBeUndefined();
    expect(ctx.c.find("control", "ParticleEditor", ["Panel", "Stop"])?.label).toBeUndefined();
    // The lead (no heading above) is a section too.
    const lead = ctxFor("The AI Debug Panel is an important tool.\n== A ==\nx", "Shared");
    expect(statedInSection(lead.ix, "", "AI Debug Panel")).toBe(true);
    expect(statedInSection(lead.ix, "A", "AI Debug Panel")).toBe(false);
    addUi(lead, "debug-panel", ["AI Debug Panel"], { anchor: "", named: true });
    expect(lead.c.find("debug-panel", "Shared", ["AI Debug Panel"])?.label).toBe("AI Debug Panel");
    // What was not kept is still reported.
    expect(
      ctx.c.skipped.filter((s) => /^label is not a unit/.test(s.reason)).map((s) => s.what),
    ).toEqual(["Restart", "Stop", "Pause"]);
  });

  it("unmapped sections: list-like content in a section no row cites is recorded", () => {
    const ix = indexPage(
      page(
        "Arma Reforger:P",
        [
          "== Cited ==",
          "* a",
          "== Uncited ==",
          "* b",
          "* '''c''' d",
          "== Prose ==",
          "Only prose.",
        ].join("\n"),
      ),
    );
    expect(unmappedSections(ix, new Set(["Cited"]))).toEqual([
      { page: "Arma Reforger:P", anchor: "Uncited", heading: "Uncited", items: 2 },
    ]);
  });

  it("a literal ampersand survives identity: the key holds && and the id one &", () => {
    const ctx = ctxFor("== Info & Diags ==\n", "WorldEditor");
    mapHeadings(ctx, { root: null, kinds: ["tab"], mode: "all" });
    expect(keySeg("Info & Diags")).toBe("Info && Diags");
    expect(rowsOf(ctx.c)).toEqual(["ui:WorldEditor/tab/Info & Diags"]);
    expect(ctx.c.all.get("ui:WorldEditor/tab/Info & Diags")?.label).toBe("Info & Diags");
  });

  it("text hygiene: machine paths are replaced, quotes must be verbatim", () => {
    const drive = ["C:", "path", "to", "file.ext"].join("\\");
    expect(containsMachinePath(drive)).toBe(true);
    expect(safeText(`format ${drive} here`)).toBe("format <path> here");
    const ix = indexPage(page("Arma Reforger:Q", "a line with text\nsecond"));
    expect(quoteFrom(ix, "a line with text")).toBe("a line with text");
    expect(quoteFrom(ix, "invented text")).toBeUndefined();
    expect(quoteFrom(ix, `a line with text ${drive}`)).toBeUndefined();
  });
});

describe("finalize", () => {
  it("counts blocked kinds, re-parents to the nearest emitted ancestor and sets children_count only when every child is emitted by the same spec", () => {
    const ctx = ctxFor("x", "WorldEditor");
    const panel = {
      dim: "ui" as const,
      kind: "panel" as const,
      module: "WorldEditor" as const,
      key: { path: ["P"] },
    };
    const base = {
      page: "Arma Reforger:Test Page",
      anchor: "",
      confidence: "high" as const,
      spec: "test",
    };
    ctx.c.add({ ...panel, parent: null, container: true, ...base });
    ctx.c.add({
      ...panel,
      kind: "tab",
      key: { path: ["P", "T"] },
      parent: panel,
      container: true,
      ...base,
    });
    ctx.c.add({
      ...panel,
      kind: "control",
      key: { path: ["P", "T", "C"] },
      parent: { ...panel, kind: "tab", key: { path: ["P", "T"] } },
      ...base,
    });
    ctx.c.add({
      ...panel,
      kind: "control",
      key: { path: ["P", "D"] },
      parent: panel,
      spec: "other",
      page: base.page,
      anchor: "",
      confidence: "high",
    });
    const f = finalize(ctx.c, { kinds: new Set(["panel", "control"]), dims: new Set(["ui"]) });
    expect(f.blocked).toEqual({ tab: 1 });
    expect(f.reparented).toBe(1);
    const byId = new Map(f.rows.map((r) => [r.id, r.obs]));
    expect(byId.get("ui:WorldEditor/control/P/T/C")?.parent_key?.key.path).toEqual(["P"]);
    // Two children from two specs: no children_count.
    expect(byId.get("ui:WorldEditor/panel/P")?.children_count).toBeUndefined();
  });

  it("sets children_count when one spec emits all the children", () => {
    const ctx = ctxFor("x", "WorldEditor");
    const root = {
      dim: "ui" as const,
      kind: "menu" as const,
      module: "WorldEditor" as const,
      key: { path: ["M"] },
    };
    const base = {
      page: "Arma Reforger:Test Page",
      anchor: "",
      confidence: "high" as const,
      spec: "s",
    };
    ctx.c.add({ ...root, parent: null, container: true, ...base });
    for (const n of ["a", "b"]) {
      ctx.c.add({ ...root, kind: "menu-item", key: { path: ["M", n] }, parent: root, ...base });
    }
    const f = finalize(ctx.c, { kinds: new Set(["menu", "menu-item"]), dims: new Set(["ui"]) });
    expect(f.rows.find((r) => r.id === "ui:WorldEditor/menu/M")?.obs.children_count).toBe(2);
  });

  it("a row that stands beside an item takes the item (same key path, other kind), else the nearest emitted ancestor by key path, as its parent; `unverified` reaches the observation", () => {
    const ctx = ctxFor("x", "ResourceManager");
    const ref = (kind: DraftRef["kind"], path: string[]): DraftRef => ({
      dim: "ui",
      kind,
      module: "ResourceManager",
      key: { path },
    });
    const base = {
      page: "Arma Reforger:Test Page",
      anchor: "",
      confidence: "high" as const,
      spec: "s",
    };
    ctx.c.add({ ...ref("menu", ["File"]), parent: null, container: true, ...base });
    ctx.c.add({ ...ref("menu-item", ["File", "Save"]), parent: ref("menu", ["File"]), ...base });
    // Same key path as the item: the item is the parent, whatever `parent` says.
    ctx.c.add({
      ...ref("shortcut", ["File", "Save"]),
      shortcut: "Ctrl+S",
      parent: null,
      parentByPath: true,
      unverified: ["a claim the page does not settle"],
      ...base,
    });
    // No row at [File, Open]: the nearest emitted ancestor is the File menu.
    ctx.c.add({
      ...ref("shortcut", ["File", "Open", "Deep"]),
      parent: null,
      parentByPath: true,
      ...base,
    });
    // A row of a blocked kind is not an ancestor (it is not emitted): the climb goes on to File.
    ctx.c.add({ ...ref("dock", ["File", "Open"]), parent: ref("menu", ["File"]), ...base });
    // No ancestor at all: a root. And a row that does not ask for it keeps the parent it declared.
    ctx.c.add({ ...ref("shortcut", ["Solo"]), parent: null, parentByPath: true, ...base });
    ctx.c.add({ ...ref("shortcut", ["File", "Declared"]), parent: null, ...base });
    const f = finalize(ctx.c, {
      kinds: new Set(["menu", "menu-item", "shortcut"]),
      dims: new Set(["ui"]),
    });
    const parentOf = (id: string) => {
      const pk = f.rows.find((r) => r.id === id)?.obs.parent_key;
      return pk ? deriveId(pk) : null;
    };
    expect(parentOf("ui:ResourceManager/shortcut/File/Save")).toBe(
      "ui:ResourceManager/menu-item/File/Save",
    );
    expect(parentOf("ui:ResourceManager/shortcut/File/Open/Deep")).toBe(
      "ui:ResourceManager/menu/File",
    );
    expect(parentOf("ui:ResourceManager/shortcut/Solo")).toBeNull();
    expect(parentOf("ui:ResourceManager/shortcut/File/Declared")).toBeNull();
    expect(f.blocked).toEqual({ dock: 1 });
    expect(f.orphans).toEqual([]);
    expect(
      f.rows.find((r) => r.id === "ui:ResourceManager/shortcut/File/Save")?.obs.unverified,
    ).toEqual(["a claim the page does not settle"]);
    expect(
      f.rows.find((r) => r.id === "ui:ResourceManager/menu-item/File/Save")?.obs.unverified,
    ).toBeUndefined();
  });
});

describe("page decisions and refs", () => {
  it("every page gets exactly one decision with a reason; templates and namespace-0 pages are out", () => {
    const pages = [
      page("Arma Reforger:World Editor", "x"),
      page("Arma Reforger:Weapon Creation", "x"),
      page("Template:Link", "x", 10),
      page("Steam", "x", 0),
      page("Arma Reforger:Diag Menu", "x"),
      page("Arma Reforger:Enfusion Blender Tools", "x"),
    ];
    const d = pages.map((p) => decidePage(p));
    expect(d.map((x) => [x.in_scope, x.category])).toEqual([
      [true, "module-page"],
      [false, "asset-content"],
      [false, "wiki-template"],
      [false, "general-wiki"],
      [true, "diag-menu"],
      [false, "blender-addon"],
    ]);
    expect(d[4].owner).toBe("E14");
    for (const x of d) expect(x.reason.length).toBeGreaterThan(10);
    expect(PAGE_RULES[PAGE_RULES.length - 1].test("anything", pages[0])).toBe(true);
  });

  it("resolves refs to pages, headings and table indexes, and refuses the rest", () => {
    const ix = indexPage(page("Arma Reforger:A Page", "{|\n| x\n|}\n== Real ==\n{|\n| y\n|}"));
    const by = new Map([[ix.slug, ix]]);
    expect(resolveRef("wiki:Arma_Reforger:A_Page#Real", by)).toBeNull();
    expect(resolveRef("wiki:Arma_Reforger:A_Page#table-2", by)).toBeNull();
    expect(resolveRef("wiki:Arma_Reforger:A_Page", by)).toBeNull();
    expect(resolveRef("wiki:Arma_Reforger:A_Page#table-3", by)).toMatch(/does not exist/);
    expect(resolveRef("wiki:Arma_Reforger:A_Page#Gone", by)).toMatch(/does not exist/);
    expect(resolveRef("wiki:Nowhere#x", by)).toMatch(/not in the export/);
    expect(resolveRef("wiki: bad", by)).toMatch(/form/);
  });
});

// ── Parents by key path: the check, written here and not taken from the generator ──

/**
 * The rows whose parent is shallower than the nearest emitted ancestor by key path: for every
 * row, if an emitted row of the same dim and module has a longer proper prefix of the row's key
 * path than the row's parent has, the row is mis-parented. A parent counts at the length of its
 * key path when that path is a prefix of the row's own (the item a shortcut row sits beside has
 * the whole path); a parent off the row's path, or none, counts for nothing.
 */
function misparented(rows: readonly Observation[]): string[] {
  const at = (o: { dim: string; module: string }, path: readonly string[]): string =>
    [o.dim, o.module, ...path].join("\u0000");
  const emitted = new Set(rows.filter((o) => o.key.path).map((o) => at(o, o.key.path ?? [])));
  const bad: string[] = [];
  for (const o of rows) {
    const path = o.key.path;
    if (!path || path.length < 2) continue;
    let longest = 0;
    for (let n = path.length - 1; n >= 1 && longest === 0; n--)
      if (emitted.has(at(o, path.slice(0, n)))) longest = n;
    if (longest === 0) continue;
    const parent = o.parent_key;
    const pp = parent?.key.path;
    const depth =
      parent &&
      pp &&
      parent.dim === o.dim &&
      parent.module === o.module &&
      pp.length <= path.length &&
      pp.every((s, i) => s === path[i])
        ? pp.length
        : 0;
    if (depth < longest)
      bad.push(
        `${deriveId(o)} has parent ${parent ? deriveId(parent) : "none"}, but ${path.slice(0, longest).join(" > ")} is a row`,
      );
  }
  return bad;
}

describe("the mis-parent check", () => {
  const obs = (kind: Observation["kind"], path: string[], parent?: Observation): Observation => ({
    dim: "ui",
    kind,
    module: "WorldEditor",
    key: { path },
    origin: "vanilla",
    ref: "wiki:Arma_Reforger:X",
    confidence: "high",
    parent_key: parent
      ? { dim: parent.dim, kind: parent.kind, module: parent.module, key: parent.key }
      : null,
  });

  it("flags a row whose parent is shallower than a longer emitted prefix, and accepts a nested parent or the item a shortcut sits beside", () => {
    const tool = obs("tool", ["T"]);
    const tab = obs("tab", ["T", "Manage"], tool);
    const cog = obs("control", ["T", "Manage", "Cog"], tab);
    const wrong = obs("control", ["T", "Manage", "X"], tool); // hangs off the tool, sits in the tab
    const right = obs("control", ["T", "Manage", "X"], tab);
    const nested = obs("menu-item", ["T", "Manage", "Cog", "Y"], cog);
    const skipped = obs("menu-item", ["T", "Manage", "Cog", "Z"], tab); // tab, but Cog is closer
    const orphan = obs("shortcut", ["T", "Manage", "Q"]); // no parent at all
    const beside = obs("shortcut", ["T", "Manage"], tab); // beside the item with the same path
    const offPath = obs("shortcut", ["T", "Manage", "W"], obs("tool", ["Other"]));
    expect(misparented([tool, tab, cog, right, nested, beside])).toEqual([]);
    expect(misparented([tool, tab, cog, wrong]).map((m) => m.split(" has ")[0])).toEqual([
      "ui:WorldEditor/control/T/Manage/X",
    ]);
    expect(misparented([tool, tab, cog, skipped])).toHaveLength(1);
    expect(misparented([tool, tab, orphan])).toHaveLength(1);
    expect(misparented([tool, tab, offPath])).toHaveLength(1);
    // A row with no emitted prefix is nobody's child by key path: nothing to flag.
    expect(misparented([obs("shortcut", ["Solo", "Alone"])])).toEqual([]);
  });
});

// ── The whole run on a synthetic export ──────────────────────────────────────

const ALLOWED = (() => {
  const u = JSON.parse(readFileSync(join(REAL_CENSUS, "universes.json"), "utf-8")) as {
    enumerators: Record<string, { kinds: string[]; dims: string[]; ref_pattern: string }>;
  };
  const e = u.enumerators.E07;
  return { kinds: new Set(e.kinds), dims: new Set(e.dims), refPattern: new RegExp(e.ref_pattern) };
})();

/**
 * Rows the specs produce in total on the real export (1,135 at the committed
 * export: 998 rows of the kinds E07 first had, 141 tabs and toolbar buttons that
 * `universes.json` now allows, less six rows that are another row under a second
 * key, plus the two General Shortcuts rows for the tab keys that the page
 * contradicts itself on and that are no longer merged into the menu rows). Kinds
 * E07 may not emit are counted as blocked and left out; the universes entry allows
 * `tab` and `toolbar-button` now, so nothing is blocked.
 */
const SPEC_ROWS = 1135;
const BLOCKABLE: Record<string, number> = { tab: 29, "toolbar-button": 112 };
const EXPECTED_BLOCKED = Object.fromEntries(
  Object.entries(BLOCKABLE).filter(([k]) => !ALLOWED.kinds.has(k)),
);
const EXPECTED_ROWS = SPEC_ROWS - Object.values(EXPECTED_BLOCKED).reduce((a, b) => a + b, 0);

/**
 * Control names the page states in running prose (not as a heading, cell, item or bold phrase).
 * Their label is not a unit of the page, so it is kept only where the spec marks the row `named`
 * and the cited section holds those exact words. [row id, label]
 */
const NAMED_LABELS: readonly (readonly [string, string])[] = [
  ["ui:ParticleEditor/control/Effect Panel/Emitters", "Emitters"],
  ["ui:ParticleEditor/control/Effect Panel/Restart", "Restart"],
  ["ui:ParticleEditor/control/Effect Panel/Pause", "Pause"],
  ["ui:ParticleEditor/control/Effect Panel/Step", "Step"],
  ["ui:ParticleEditor/option/Effect Panel/Hide inactive", "Hide inactive"],
  ["ui:ParticleEditor/option/Effect Panel/Restart on change", "Restart on change"],
  ["ui:WorldEditor/control/Log Console/Clear Console", "Clear Console"],
  ["ui:Shared/debug-panel/AI Debug Panel", "AI Debug Panel"],
];

describe("the run", () => {
  const syntheticXml = (): string =>
    [
      "<mediawiki>",
      "<page><title>Arma Reforger:Resource Manager</title><ns>5050</ns><id>1</id><revision><text>",
      "== Interface ==\n# '''Resource Browser''' - browse\n\n== Window Menu ==\n{|\n! Title\n! Hierarchy\n|-\n! Workbench\n|\n* Save\n* Exit\n|}\n== General Shortcuts ==\n{|\n! Shortcut\n! Function\n|-\n| {{Controls|Ctrl|S}}\n| Saves\n|}",
      "</text></revision></page>",
      "<page><title>Arma Reforger:File Types</title><ns>5050</ns><id>2</id><revision><text>",
      "{|\n! Extension\n! File Type\n! Saved/Used by\n! Description\n|-\n|\n==== .meta ====\n| Meta\n| RM\n| settings\n|}",
      "</text></revision></page>",
      "<page><title>Template:Link</title><ns>10</ns><id>3</id><revision><text>t</text></revision></page>",
      "</mediawiki>",
    ].join("");

  it("has one page decision per page and rows whose refs resolve; blocked kinds are never written", () => {
    const pages = parseExport(syntheticXml());
    const r = buildE07(pages, { kinds: ALLOWED.kinds, dims: ALLOWED.dims });
    expect(r.pages).toHaveLength(3);
    expect(r.pages.map((p) => p.in_scope)).toEqual([true, true, false]);
    expect(r.rows.map((x) => x.id)).toContain("file:.meta");
    expect(r.missingPages.length).toBeGreaterThan(0); // specs for pages this export lacks
    expect(checkRows(r.rows, r.bySlug, ALLOWED.refPattern)).toEqual([]);
  });

  it("is deterministic: the same input gives byte-identical text, and rows are in code-unit order", () => {
    const pages = parseExport(syntheticXml());
    const a = buildE07(pages, { kinds: ALLOWED.kinds, dims: ALLOWED.dims });
    const b = buildE07(pages, { kinds: ALLOWED.kinds, dims: ALLOWED.dims });
    const inputs = [{ path: "<repo>/data/wiki/export.xml", sha256: "0".repeat(64) }];
    expect(observationFileText(a.rows, "1.0.0.1", inputs)).toBe(
      observationFileText(b.rows, "1.0.0.1", inputs),
    );
    const ids = a.rows.map((x) => x.id);
    expect(ids).toEqual([...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("run() refuses an --out outside observations/E07/ and says NO DATA without an export", () => {
    const fx = makeCensus("1.0.0.1");
    const refused = runIn(fx, run, [
      "--out",
      join(fx.root, "observations", "E05", "x.jsonl"),
      "--export",
      REAL_EXPORT,
    ]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("refusing --out");
    expect(() => resolveOut(fx.paths, undefined, "1.0.0.1")).not.toThrow();
    const none = runIn(fx, run, ["--export", join(fx.repo, "absent.xml"), "--no-artifacts"]);
    expect(none.code).toBe(2);
    expect(none.stdout).toContain("NO DATA");
    expect(runIn(fx, run, ["--help"]).stdout).toContain("usage:");
  });
});

// ── Real export ──────────────────────────────────────────────────────────────

describe("the real export (data/wiki/export.xml)", () => {
  let result: E07Result;
  let pagesInExport = 0;
  let h: ReturnType<typeof headlines>;
  const xml = readFileSync(REAL_EXPORT, "utf-8");

  beforeAll(() => {
    pagesInExport = (xml.match(/<page>/g) ?? []).length;
    result = buildE07(parseExport(xml), { kinds: ALLOWED.kinds, dims: ALLOWED.dims });
    h = headlines(result, pagesInExport);
  });

  it("count gate: one decision per page of the export, each with a reason and no duplicate title", () => {
    expect(pagesInExport).toBe(295);
    expect(result.pages).toHaveLength(pagesInExport);
    expect(new Set(result.pages.map((p) => p.title)).size).toBe(pagesInExport);
    for (const p of result.pages) {
      expect(p.reason.length, p.title).toBeGreaterThan(10);
      expect(typeof p.in_scope).toBe("boolean");
    }
    expect(h.pages_in_scope + h.pages_out_of_scope).toBe(pagesInExport);
    expect(result.missingPages).toEqual([]);
  });

  it("headline counts", () => {
    expect(h.pages_in_scope).toBe(100);
    expect(h.pages_out_of_scope).toBe(195);
    expect(h.tables_total).toBe(716);
    // The same number by a different method: lines that open a table, comments removed.
    const independent = parseExport(xml)
      .map((p) => (p.text.replace(/<!--[\s\S]*?-->/g, "").match(/^\s*\{\|/gm) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(independent).toBe(h.tables_total);
    expect(h.tables_mapped + h.tables_skipped).toBe(h.tables_total);
    expect(h.rows).toBe(EXPECTED_ROWS);
    expect(h.rows + Object.values(h.blocked_by_kind).reduce((a, b) => a + b, 0)).toBe(SPEC_ROWS);
    expect(h.cli_switches).toBe(128);
    expect(h.cli_switches_startup_parameters).toBe(127);
    expect(h.file_types).toBe(56);
    expect(h.link_formats).toBe(11);
    expect(h.rows_by_kind["diag-menu"]).toBe(29);
    expect(h.blocked_by_kind).toEqual(EXPECTED_BLOCKED);
    // `universes.json` allows tabs and toolbar buttons for E07: they are rows, nothing is blocked.
    expect(ALLOWED.kinds.has("tab")).toBe(true);
    expect(ALLOWED.kinds.has("toolbar-button")).toBe(true);
    expect(h.blocked_by_kind).toEqual({});
    expect(h.rows_by_kind.tab).toBe(29);
    expect(h.rows_by_kind["toolbar-button"]).toBe(112);
    // No row of a kind E07 may not emit.
    for (const k of Object.keys(h.rows_by_kind)) expect(ALLOWED.kinds.has(k), k).toBe(true);
    for (const d of Object.keys(h.rows_by_dim)) expect(ALLOWED.dims.has(d), d).toBe(true);
  });

  it("the file-type rows are the File Types table: 56 extensions, each a heading of the table", () => {
    const table = result.bySlug.get("Arma_Reforger:File_Types")?.parsed.tables[0];
    expect(table?.rows.length).toBe(57); // header + 56
    const exts = result.rows.filter((r) => r.obs.kind === "file-type").map((r) => r.obs.key.ext);
    expect(exts).toHaveLength(56);
    expect(exts).toEqual(expect.arrayContaining(["acp", "xob", "layout", "gproj", "stars"]));
    for (const r of result.rows.filter((x) => x.obs.kind === "file-type")) {
      expect(r.obs.ref).toMatch(/^wiki:Arma_Reforger:File_Types#\./);
    }
  });

  it("the file-type module is the editor the Saved/Used by cell names (derived here from the cell text, by the stated mapping)", () => {
    // The 28 distinct cells of the column and the module the stated mapping gives each.
    const byCell: Record<string, string> = {
      "Audio Editor": "AudioEditor",
      "Animation offline debugger": "none",
      "Animation Editor": "AnimEditor",
      "Animation Editor + various plugins": "AnimEditor",
      "World Editor": "WorldEditor",
      "Behavior Editor": "BehaviorEditor",
      "Script Editor": "ScriptEditor",
      "Resource Manager's Config Editor": "ResourceManager.Config",
      "Art Tools": "none",
      "Resource Manager's Texture Editor": "ResourceManager.Texture",
      "Resource Manager": "ResourceManager",
      "3D software": "none",
      "Resource Manager's Font Viewer": "ResourceManager.Font",
      "Resource Manager's Imageset Editor": "ResourceManager.Imageset",
      "Resource Manager's Layout Editor": "ResourceManager.Layout",
      "Navmesh Generator Tool": "NavmeshGeneratorMain",
      Workbench: "none",
      "Procedural Animation Editor": "ProcAnimEditor",
      "Config Editor": "ResourceManager.Config",
      "Resource Browser": "none",
      "Particle Editor": "ParticleEditor",
      "String Editor": "LocalizationEditor",
      "Proprietary format": "none",
      "Resource Manager's Styles Editor": "ResourceManager.Styles",
      "Resource Browser + various plugins (see Enfusion Blender Tools)": "none",
      "Audio software": "none",
    };
    const table = result.bySlug.get("Arma_Reforger:File_Types")?.parsed.tables[0];
    let checked = 0;
    for (const row of table?.rows ?? []) {
      const ext = row.cells[0]?.headings[0]?.text.replace(/^\.+/, "").toLowerCase();
      if (!ext) continue;
      const cell = cleanWiki(row.cells[2].raw);
      expect(Object.keys(byCell), cell).toContain(cell);
      const r = result.rows.find((x) => x.obs.kind === "file-type" && x.obs.key.ext === ext);
      expect(r?.obs.module, `.${ext} (${cell})`).toBe(byCell[cell]);
      checked++;
    }
    expect(checked).toBe(56);
    const by = h.rows_by_module;
    expect(by.none).toBeGreaterThan(0);
    const mod = (e: string) => result.rows.find((x) => x.id === `file:.${e}`)?.obs.module;
    expect(mod("acp")).toBe("AudioEditor");
    expect(mod("anm")).toBe("AnimEditor");
    expect(mod("conf")).toBe("ResourceManager.Config");
    expect(mod("nmn")).toBe("NavmeshGeneratorMain");
    expect(mod("xob")).toBe("none");
    expect(mod("meta")).toBe("ResourceManager");
    expect(mod("ragdoll")).toBe("ResourceManager");
  });

  it("tabs and toolbar buttons are rows, and their children keep them as parents", () => {
    const tabs = result.rows.filter((r) => r.obs.kind === "tab");
    const buttons = result.rows.filter((r) => r.obs.kind === "toolbar-button");
    expect(tabs).toHaveLength(29);
    expect(buttons).toHaveLength(112);
    expect(result.finalized.blocked).toEqual({});
    expect(result.finalized.reparented).toBe(0);
    const ids = new Set(result.rows.map((r) => r.id));
    const kids = result.rows.filter(
      (r) => r.obs.parent_key && ["tab", "toolbar-button"].includes(r.obs.parent_key.kind),
    );
    expect(kids.length).toBeGreaterThanOrEqual(48);
    for (const k of kids) {
      expect(k.obs.parent_key && ids.has(deriveId(k.obs.parent_key)), k.id).toBe(true);
    }
    // A tab row, and a container whose children are all tabs, are in the file.
    expect(ids.has("ui:ResourceManager/tab/Options/Game Project")).toBe(true);
  });

  it("the CLI rows are the Startup Parameters headings (plus the Autotest `autotest` switch)", () => {
    const ix = result.bySlug.get("Arma_Reforger:Startup_Parameters");
    const level3 = ix?.sections.filter((s) => s.level === 3) ?? [];
    const distinct = new Set(level3.map((s) => s.text.replace(/^-+/, "")));
    expect(distinct.size).toBe(127);
    expect(level3.length).toBe(128); // saveDir is documented twice
    const cli = result.rows.filter((r) => r.obs.kind === "cli-switch");
    expect(cli.map((r) => r.obs.key.switch)).toContain("autotest");
    expect(cli.every((r) => r.obs.module === "none")).toBe(true);
    expect(cli.find((r) => r.obs.key.switch === "wbBackendLogin")?.obs.risk_hint).toBe(
      "credential",
    );
  });

  it("the Publish dialog and its controls carry risk hints and nothing that suggests invoking them", () => {
    const publish = result.rows.filter(
      (r) => r.draft.page === "Arma Reforger:Mod Publishing Process",
    );
    const dialog = publish.find((r) => r.id === "ui:ResourceManager/dialog/Publish Project");
    expect(dialog?.obs.risk_hint).toBe("external");
    const controls = publish.filter(
      (r) => r.obs.kind === "control" && r.obs.parent_key?.key.path?.[0] === "Publish Project",
    );
    expect(controls.length).toBeGreaterThanOrEqual(14);
    for (const r of publish.filter((x) => x.obs.kind === "control" || x.obs.kind === "dialog")) {
      expect(["external", "credential"], r.id).toContain(r.obs.risk_hint);
      expect(r.obs.paths_proposed).toBeUndefined();
    }
    expect(publish.some((r) => r.obs.risk_hint === "credential")).toBe(true);
  });

  it("the Diag Menu page yields only top-level diag-menu rows (E14 owns the options)", () => {
    const diag = result.rows.filter((r) => r.draft.page === "Arma Reforger:Diag Menu");
    expect(diag.length).toBe(29);
    expect(diag.every((r) => r.obs.kind === "diag-menu" && r.obs.key.path?.length === 1)).toBe(
      true,
    );
    expect(diag.some((r) => r.obs.kind === "diag-option")).toBe(false);
  });

  it("gate: every ref resolves to a page and a section that exist; quotes are verbatim; nothing contains a machine path", () => {
    expect(checkRows(result.rows, result.bySlug, ALLOWED.refPattern)).toEqual([]);
    expect(result.finalized.invalid).toEqual([]);
    expect(result.collector.invalid).toEqual([]);
    for (const r of result.rows) {
      expect(r.obs.ref).toMatch(ALLOWED.refPattern);
      expect(r.obs.ref.split("#")[0]).not.toMatch(/\s/);
      expect(JSON.stringify(r.obs), r.id).not.toMatch(/[A-Za-z]:\\\\/);
      expect(deriveId(r.obs), r.id).toBe(r.id);
    }
  });

  it("ids are unique, parents exist among the rows, and a parent is never of a blocked kind", () => {
    const ids = new Set(result.rows.map((r) => r.id));
    expect(ids.size).toBe(result.rows.length);
    for (const r of result.rows) {
      if (r.obs.parent_key) expect(ids.has(deriveId(r.obs.parent_key)), r.id).toBe(true);
    }
    expect(result.finalized.orphans).toEqual([]);
  });

  it("every table has a decision: mapped by a named spec or skipped with a reason", () => {
    expect(result.tables).toHaveLength(716);
    for (const t of result.tables) {
      expect(t.detail.length, `${t.page} T${t.index}`).toBeGreaterThan(3);
      expect(["mapped", "skipped"]).toContain(t.status);
    }
    expect(result.tables.filter((t) => t.status === "mapped").length).toBe(33);
  });

  it("rows from the sources are spot-checked against the page text", () => {
    const rm = result.bySlug.get("Arma_Reforger:Resource_Manager");
    expect(rm?.page.text).toContain("* Save All");
    const row = result.rows.find((r) => r.id === "ui:ResourceManager/menu-item/Workbench/Save All");
    expect(row?.obs.ref).toBe("wiki:Arma_Reforger:Resource_Manager#Window_Menu");
    expect(row?.obs.quote).toBe("Save All");
    const gesture = result.rows.find(
      (r) => r.id === "ui:BehaviorEditor/canvas-gesture/Node area/Zoom in%2Fout",
    );
    expect(gesture?.obs.what).toBe("Mousewheel up/down.");
  });

  const rowOf = (id: string) => result.rows.find((r) => r.id === id);

  it("Terrain Creation Tool: the feature tables give controls and options, not their section titles", () => {
    const tct = result.rows.filter(
      (r) => r.draft.page === "Arma Reforger:World Editor: Terrain Creation Tool",
    );
    const ids = tct.map((r) => r.id);
    // Titles of the Paint and Info & Diags table rows are not rows.
    for (const title of [
      "Basic Brush Settings",
      "Brush Shape and Type",
      "Surface Layer List",
      "Basic Painting",
      "Extra Surface Layer Operations",
      "Block and Pixel Under Cursor Diagnostics",
      "Basic Surface Diagnostics",
      "Surface Layer Merge or Replace Operations",
    ]) {
      expect(
        ids.filter((i) => i.endsWith(`/${title}`)),
        title,
      ).toEqual([]);
    }
    // The controls inside the Description cells are.
    for (const [kind, ...path] of [
      ["control", "Paint", "Show diagnostics for block under cursor"],
      ["option", "Paint", "Strength"],
      ["option", "Paint", "Radius"],
      ["option", "Paint", "Falloff"],
      ["option", "Paint", "Angle"],
      ["control", "Paint", "Brush shape"],
      ["control", "Paint", "Brush type"],
      ["control", "Paint", "Surface layer list"],
      ["control", "Paint", "Change layer's material..."],
      ["control", "Paint", "Clear surface layer"],
      ["control", "Paint", "Fill surface layer (clear other)"],
      ["control", "Paint", "Remove surface layer"],
      ["control", "Paint", "Priority surface mask import"],
      ["control", "Paint", "Priority surface mask import..."],
      ["control", "Paint", "Export surface mask"],
      ["control", "Paint", "Export surface mask..."],
      ["control", "Info & Diags", "Block", "Live (under cursor)"],
      ["control", "Info & Diags", "Block", "Camera auto-align"],
      ["control", "Info & Diags", "Block", "Coordinates"],
      ["control", "Info & Diags", "Pixel Under Cursor", "Coordinates"],
      ["control", "Info & Diags", "Merge"],
      ["control", "Info & Diags", "Replace"],
    ] as const) {
      const id = `ui:WorldEditor/${kind}/Terrain Creation Tool/${path.join("/")}`;
      expect(rowOf(id), id).toBeDefined();
    }
    // Legend entries and procedure steps are not controls.
    expect(ids.some((i) => /\/(Green|Yellow|Red)$/.test(i))).toBe(false);
    // The Manage > Options heading holds only a comment.
    expect(ids).not.toContain("ui:WorldEditor/control/Terrain Creation Tool/Manage/Options");
    // The Cogwheel entries (a term list).
    expect(
      rowOf(
        "ui:WorldEditor/menu-item/Terrain Creation Tool/Manage/Tile Map/Minimap Controls/Cogwheel/Set Background Image",
      ),
    ).toBeDefined();
    // One tool, not two: the top bar's "Terrain Tool" points at this page.
    expect(rowOf("ui:WorldEditor/tool/Terrain Tool")).toBeUndefined();
    expect(rowOf("ui:WorldEditor/tool/Terrain Creation Tool")?.obs.shortcut_default).toBe("Ctrl+T");
  });

  it("UI content outside tables: Layout Editor property menus, copy-link entries, Vector Tool and Particle Editor controls", () => {
    for (const id of [
      "ui:ResourceManager.Layout/control/Properties Tab/Property Grid Options",
      "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Show only modified properties",
      "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Expand all groups",
      "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Collapse all groups",
      "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Copy all properties",
      "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Paste properties",
      "ui:ResourceManager.Layout/context-menu/Properties Tab/Property Group Options",
      "ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Copy group properties",
      "ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Paste properties",
      "ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Paste properties here",
      "ui:ResourceManager.Layout/control/Properties Tab/Search field",
      "ui:ResourceManager.Layout/control/Properties Tab/Name field",
      "ui:ScriptEditor/menu-item/Edit/Copy link option",
      "ui:WorldEditor/menu-item/Game/Copy view link",
      "ui:WorldEditor/control/Vector Tool/New Polyline",
      "ui:WorldEditor/control/Vector Tool/New Spline",
      "ui:ParticleEditor/control/Effect Panel/Restart",
      "ui:ParticleEditor/control/Effect Panel/Pause",
      "ui:ParticleEditor/control/Effect Panel/Step",
      "ui:ParticleEditor/control/Effect Panel/drop-down menu",
      "ui:ParticleEditor/option/Effect Panel/Hide inactive",
      "ui:ParticleEditor/option/Effect Panel/Restart on change",
    ]) {
      expect(rowOf(id), id).toBeDefined();
    }
    expect(rowOf("ui:ScriptEditor/menu-item/Edit/Copy link option")?.obs.shortcut_default).toBe(
      "Ctrl+Shift+L",
    );
    expect(rowOf("ui:WorldEditor/shortcut/Game/Copy view link")?.obs.shortcut_default).toBe(
      "Ctrl+Shift+L",
    );
    const gestures = result.rows
      .filter((r) => r.id.startsWith("ui:WorldEditor/canvas-gesture/Vector Tool/"))
      .map((r) => r.obs.shortcut_default);
    expect(gestures.sort()).toEqual(["Alt+LMB", "Ctrl+LMB"]);
    // Vector Tool "Snap to terrain" is two headings under "Terrain Snapping": a checkbox and a button.
    // The button is a control of its own, and its path carries the section heading.
    const checkbox = rowOf("ui:WorldEditor/option/Vector Tool/Snap to terrain");
    const button = rowOf("ui:WorldEditor/control/Vector Tool/Terrain Snapping/Snap to terrain");
    expect(checkbox?.obs.ref).toBe("wiki:Arma_Reforger:World_Editor:_Vector_Tool#Snap_to_terrain");
    expect(checkbox?.obs.what).toBe(
      "Checkbox: sets if newly-placed points are to snap to the terrain or to world's zero.",
    );
    expect(button?.obs.ref).toBe("wiki:Arma_Reforger:World_Editor:_Vector_Tool#Snap_to_terrain_2");
    expect(button?.obs.what).toBe("Snaps selected points to terrain below them.");
    expect(button?.obs.label).toBe("Snap to terrain");
    expect(rowOf("ui:WorldEditor/control/Vector Tool/Snap to terrain")).toBeUndefined();
    // Headings of one name under one section do not collide anywhere else: the one duplicate is
    // a switch the Startup Parameters page documents under two sections.
    expect(result.collector.duplicates.map((d) => d.what)).toEqual(["-saveDir"]);
  });

  it("report.json accounts for content outside tables: sections with list items that no row cites", () => {
    expect(h.unmapped_sections).toBeGreaterThan(0);
    expect(h.unmapped_items).toBeGreaterThanOrEqual(h.unmapped_sections);
    const report = JSON.parse(reportText(result, "1.8.0.13", pagesInExport)) as {
      unmapped_sections: { page: string; anchor: string; items: number }[];
    };
    expect(report.unmapped_sections).toHaveLength(h.unmapped_sections);
    // Only in-scope pages that emitted rows.
    const counted = new Set(
      result.pages.filter((p) => p.in_scope && p.rows_emitted > 0).map((p) => p.title),
    );
    for (const u of report.unmapped_sections) expect(counted.has(u.page), u.page).toBe(true);
    // What the Layout Editor spec still does not reach is on the record.
    expect(
      report.unmapped_sections.some(
        (u) => u.page === "Arma Reforger:Resource Manager: Layout Editor" && u.anchor === "Slot",
      ),
    ).toBe(true);
  });

  it("every label and every description is a unit of its page (a heading, cell, item, label or description part, bold phrase, title or whole sentence), never a fragment of a sentence", () => {
    const bad: string[] = [];
    for (const r of result.rows) {
      const ix = result.bySlug.get(r.obs.ref.slice(5).split("#")[0]);
      if (!ix) continue;
      if (r.obs.what !== undefined && !pageHasText(ix, r.obs.what)) bad.push(`what text ${r.id}`);
      if (r.obs.what !== undefined && !isPageUnit(ix, r.obs.what)) {
        // The one allowed exception: a sentence longer than 200 characters, cut at a word.
        const long = pageUnits(ix).sentences.some(
          (s) => s.length > 200 && s.startsWith(r.obs.what as string),
        );
        if (!long) bad.push(`what unit ${r.id}`);
      }
      if (r.obs.label !== undefined && !isPageUnit(ix, r.obs.label)) {
        // The one other kind of label: a control name the page states in running prose, marked
        // `named` by the spec, whose exact words are in the section the row cites.
        const named = NAMED_LABELS.some(([id, label]) => id === r.id && label === r.obs.label);
        if (!named || !statedInSection(ix, r.obs.ref.split("#")[1] ?? "", r.obs.label))
          bad.push(`label ${r.id}`);
      }
    }
    expect(bad).toEqual([]);
    // Nothing is left over from the old rule.
    expect(result.collector.skipped.filter((s) => /not text of the page/.test(s.reason))).toEqual(
      [],
    );
    // What was cut or widened is on the record.
    expect(result.collector.rewritten.length).toBeGreaterThan(15);
    expect(
      result.collector.skipped.filter((s) => /^label is not a unit/.test(s.reason)).length,
    ).toBeGreaterThan(25);
  });

  it("canvas gestures whose name the author composed from a sentence keep the name as the key path, with no label and the page's sentence as the quote", () => {
    for (const id of [
      "ui:AnimEditor/canvas-gesture/Animation Graph/add to current selection",
      "ui:AnimEditor/canvas-gesture/Animation Graph/zoom%2Funzoom",
      "ui:AnimEditor/canvas-gesture/Anim Editor Preview/The camera can be moved",
      "ui:WorldEditor/canvas-gesture/Vector Tool/adds a point after the selected one",
      "ui:WorldEditor/canvas-gesture/Viewport/focuses on the currently selected entity",
    ]) {
      const r = rowOf(id);
      expect(r, id).toBeDefined();
      expect(r?.obs.label, id).toBeUndefined();
      expect(r?.obs.quote, id).toBeDefined();
      expect(r?.obs.quote?.length, id).toBeGreaterThan(25);
    }
    // The description of a gesture is the page's sentence, whole.
    expect(
      rowOf("ui:WorldEditor/canvas-gesture/Rotate Tool/duplicate the element and rotate the copy")
        ?.obs.what,
    ).toBe("Alt+LMB will duplicate the element and rotate the copy");
    expect(
      rowOf(
        "ui:WorldEditor/canvas-gesture/Viewport/Use the W and S keys to move the camera forward and backward",
      )?.obs.what,
    ).toBe(
      "Use the W and S keys to move the camera forward and backward along the camera orientation at the set speed.",
    );
    // A gesture the page names in a table cell keeps that cell as its label.
    expect(rowOf("ui:AudioEditor/canvas-gesture/Scene/Pan")?.obs.label).toBe("Pan");
    expect(rowOf("ui:BehaviorEditor/canvas-gesture/Node area/Connect nodes")?.obs.label).toBe(
      "Connect nodes",
    );
    // Fragments of a sentence become sentences.
    expect(rowOf("ui:Launcher/control/Project Creation/OK")?.obs.what).toBe(
      'Click "OK" to create the project.',
    );
    expect(rowOf("ui:WorldEditor/control/Vector Tool/New Polyline")?.obs.what).toBe(
      "New Polyline / New Spline is used to create a new shape.",
    );
  });

  it("the Resource Manager General Shortcuts do not repeat the menu rows with the same key", () => {
    for (const label of [
      "Closes active tab",
      "Cycles between opened tab",
      "Locates active resource in Resource Browser",
      "Reimports active resource",
      "Opens/closes Resource Browser window",
      "Opens/closes log console",
    ]) {
      expect(rowOf(`ui:ResourceManager/shortcut/${label}`), label).toBeUndefined();
    }
    expect(
      rowOf("ui:ResourceManager/shortcut/Window/Close Current Tab")?.obs.shortcut_default,
    ).toBe("Ctrl+W");
    // The table's "Next tab" (Ctrl+Page Up) and "Previous tab" (Ctrl+Page Down) are NOT merged
    // into the Window menu section's "Prev Tab" (Ctrl+PageUp) and "Next Tab" (Ctrl+PageDown): the
    // page contradicts itself on the pair, so both sides are rows (see the contradiction test).
    expect(rowOf("ui:ResourceManager/shortcut/Next tab")?.obs.shortcut_default).toBe(
      "Ctrl+Page Up",
    );
    expect(rowOf("ui:ResourceManager/shortcut/Previous tab")?.obs.shortcut_default).toBe(
      "Ctrl+Page Down",
    );
    expect(rowOf("ui:ResourceManager/menu-item/Window/Prev Tab")?.obs.shortcut_default).toBe(
      "Ctrl+PageUp",
    );
    expect(rowOf("ui:ResourceManager/menu-item/Window/Next Tab")?.obs.shortcut_default).toBe(
      "Ctrl+PageDown",
    );
    expect(
      result.collector.skipped.filter((s) =>
        /same shortcut as the menu row Window > (?:Prev|Next) Tab/.test(s.reason),
      ),
    ).toEqual([]);
    // The six that are merged are on the record.
    expect(
      result.collector.skipped.filter((s) => /^same shortcut as the menu row/.test(s.reason)),
    ).toHaveLength(6);
    // Other General Shortcuts rows stay (they have no menu row).
    expect(rowOf("ui:ResourceManager/shortcut/Save all")?.obs.shortcut_default).toBe(
      "Ctrl+Shift+S",
    );
    expect(
      result.rows.filter((r) => r.draft.spec === "rm-window" && r.obs.kind === "shortcut").length,
    ).toBeGreaterThan(10);
  });

  it("the Script Editor's Keyboard Shortcuts rows `Debug: Step Over` and the like are the Debug section's controls, not rows of their own", () => {
    for (const [name, key] of [
      ["Continue", "F5"],
      ["Step Over", "F10"],
      ["Step Into", "F11"],
      ["Step Out", "Shift+F11"],
    ]) {
      expect(rowOf(`ui:ScriptEditor/shortcut/Debug: ${name}`), name).toBeUndefined();
      expect(rowOf(`ui:ScriptEditor/control/Debug/${name}`)?.obs.shortcut_default, name).toBe(key);
    }
    // The other rows of that table stay.
    expect(rowOf("ui:ScriptEditor/shortcut/Insert Breakpoint")?.obs.shortcut_default).toBe("F9");
  });

  it("the World Editor's Terrain Tool heading is the Terrain Creation Tool: one row, labelled with the heading; the Vector Entity Tool and the Vector Tool page are two rows and the report says the pages do not call them the same", () => {
    const terrain = result.rows.filter(
      (r) => /Terrain (?:Creation )?Tool$/.test(r.id) && r.obs.kind === "tool",
    );
    expect(terrain.map((r) => r.id)).toEqual(["ui:WorldEditor/tool/Terrain Creation Tool"]);
    expect(terrain[0].obs.label).toBe("Terrain Tool");
    expect(terrain[0].obs.quote).toBe("Terrain Tool");
    expect(terrain[0].obs.ref).toBe("wiki:Arma_Reforger:World_Editor#Terrain_Tool");
    expect(rowOf("ui:WorldEditor/shortcut/Top Bar/Terrain Creation Tool")?.obs.label).toBe(
      "Terrain Tool",
    );
    expect(rowOf("ui:WorldEditor/tool/Vector Entity Tool")).toBeDefined();
    expect(rowOf("ui:WorldEditor/tool/Vector Tool")).toBeDefined();
    const text = reportText(result, "1.8.0.13", pagesInExport);
    const report = JSON.parse(text) as {
      identity_decisions: { what: string; reason: string }[];
    };
    expect(
      report.identity_decisions.some(
        (d) => d.what === "Terrain Tool" && /Terrain Creation Tool/.test(d.reason),
      ),
    ).toBe(true);
    expect(
      report.identity_decisions.some(
        (d) => d.what === "Vector Tool" && /do not say they are the same/.test(d.reason),
      ),
    ).toBe(true);
  });

  // ── Parents by key path ────────────────────────────────────────────────────

  const fileRows = (): Observation[] => {
    const inputs = [{ path: "<repo>/data/wiki/export.xml", sha256: "0".repeat(64) }];
    return observationFileText(result.rows, "1.8.0.13", inputs)
      .split("\n")
      .filter(Boolean)
      .slice(1)
      .map((l) => JSON.parse(l) as Observation);
  };

  it("no row of the observation file has a parent shallower than a longer emitted key-path prefix", () => {
    const rows = fileRows();
    expect(rows).toHaveLength(EXPECTED_ROWS);
    expect(misparented(rows)).toEqual([]);
    // A parent with the row's own key path is only ever the item a shortcut or gesture sits beside.
    let beside = 0;
    for (const o of rows) {
      const pp = o.parent_key?.key.path;
      const path = o.key.path;
      if (!pp || !path || pp.length !== path.length || !pp.every((s, i) => s === path[i])) continue;
      beside++;
      expect(["shortcut", "canvas-gesture"], deriveId(o)).toContain(o.kind);
      expect(o.parent_key?.kind, deriveId(o)).not.toBe(o.kind);
    }
    expect(beside).toBeGreaterThan(30);
    // Before this was a rule, the Terrain Creation Tool's rows hung off the tool (45 rows and one
    // root); the check as the generator's own output stands is what the file holds.
    expect(
      rows.filter(
        (o) =>
          o.key.path?.[0] === "Terrain Creation Tool" &&
          o.key.path.length >= 3 &&
          o.parent_key?.kind === "tool",
      ),
    ).toEqual([]);
  });

  it("Terrain Creation Tool: the four tabs hang off the tool, everything the page puts inside a tab hangs off that tab (or a row nested in it), and the Info & Diags shortcut is not a root", () => {
    const toolId = "ui:WorldEditor/tool/Terrain Creation Tool";
    const tabId = (seg: string): string =>
      deriveId({
        dim: "ui",
        kind: "tab",
        module: "WorldEditor",
        key: { path: ["Terrain Creation Tool", seg] },
      });
    const parentId = (r: { obs: Observation }): string | null =>
      r.obs.parent_key ? deriveId(r.obs.parent_key) : null;
    const tabs = ["Manage", "Sculpt", "Paint", "Info & Diags"].map(keySeg);
    for (const seg of tabs) {
      const tab = result.rows.find((r) => r.id === tabId(seg));
      expect(tab, seg).toBeDefined();
      expect(parentId(tab as { obs: Observation }), seg).toBe(toolId);
    }
    // The tool's children on its own page are the four tabs and nothing else.
    const tctPage = result.rows.filter(
      (r) => r.draft.page === "Arma Reforger:World Editor: Terrain Creation Tool",
    );
    expect(tctPage.filter((r) => parentId(r) === toolId).map((r) => r.id)).toEqual(
      tabs.map(tabId).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    // Every row whose key path sits under a tab.
    const inside = result.rows.filter(
      (r) => r.obs.key.path?.[0] === "Terrain Creation Tool" && (r.obs.key.path?.length ?? 0) >= 3,
    );
    expect(inside).toHaveLength(48);
    let direct = 0;
    const nested: string[] = [];
    for (const r of inside) {
      const path = r.obs.key.path as string[];
      expect(tabs, r.id).toContain(path[1]);
      if (parentId(r) === tabId(path[1])) {
        direct++;
        continue;
      }
      // Otherwise the parent is a row nested in the tab: its key path is a longer prefix of the row's.
      const pp = r.obs.parent_key?.key.path as string[];
      expect(pp.length, r.id).toBeGreaterThan(2);
      expect(path.slice(0, pp.length), r.id).toEqual(pp);
      nested.push(r.id);
    }
    expect(direct).toBe(46);
    expect(nested).toEqual([
      "ui:WorldEditor/menu-item/Terrain Creation Tool/Manage/Tile Map/Minimap Controls/Cogwheel/Clear Background Image",
      "ui:WorldEditor/menu-item/Terrain Creation Tool/Manage/Tile Map/Minimap Controls/Cogwheel/Set Background Image",
    ]);
    // The Cogwheel button itself is in the Manage tab.
    const cog = result.rows.find((r) => r.id.endsWith("/Minimap Controls/Cogwheel"));
    expect(cog && parentId(cog)).toBe(tabId("Manage"));
    // The Info & Diags shortcut (Ctrl+X in the viewport) has the Info & Diags tab as its parent.
    const sc = inside.find((r) => r.obs.kind === "shortcut");
    expect(sc?.obs.shortcut_default).toBe("Ctrl+X");
    expect(sc && parentId(sc)).toBe(tabId(keySeg("Info & Diags")));
    // Sculpt: the common-controls gestures and the common values hang off the Sculpt tab.
    for (const r of inside.filter((x) => x.obs.key.path?.[1] === "Sculpt"))
      expect(parentId(r), r.id).toBe(tabId("Sculpt"));
    expect(inside.filter((x) => x.obs.key.path?.[1] === "Sculpt")).toHaveLength(9);
  });

  // ── Identity decisions are on the rows ─────────────────────────────────────

  /** The page's wikitext with line ends as `\n` (the export holds `\r\n`). */
  const pageText = (slug: string): string =>
    (result.bySlug.get(slug)?.page.text ?? "").replace(/\r\n/g, "\n");
  const notesOf = (id: string): string[] => rowOf(id)?.obs.unverified ?? [];

  it("the rows that carry `unverified` are exactly the identity decisions, the contradiction and the TODO", () => {
    expect(result.rows.filter((r) => r.obs.unverified).map((r) => r.id)).toEqual([
      "ui:ResourceManager.Model/toolbar-button/Horizontal bar/Camera auto placement",
      "ui:ResourceManager/menu-item/Edit/Locate file in resource browser",
      "ui:ResourceManager/menu-item/Edit/Reimport resource",
      "ui:ResourceManager/menu-item/Window/Close Current Tab",
      "ui:ResourceManager/menu-item/Window/Cycle Tabs",
      "ui:ResourceManager/menu-item/Window/Log Console",
      "ui:ResourceManager/menu-item/Window/Next Tab",
      "ui:ResourceManager/menu-item/Window/Prev Tab",
      "ui:ResourceManager/menu-item/Window/Resource Browser",
      "ui:ResourceManager/shortcut/Edit/Locate file in resource browser",
      "ui:ResourceManager/shortcut/Edit/Reimport resource",
      "ui:ResourceManager/shortcut/Next tab",
      "ui:ResourceManager/shortcut/Previous tab",
      "ui:ResourceManager/shortcut/Window/Close Current Tab",
      "ui:ResourceManager/shortcut/Window/Cycle Tabs",
      "ui:ResourceManager/shortcut/Window/Log Console",
      "ui:ResourceManager/shortcut/Window/Next Tab",
      "ui:ResourceManager/shortcut/Window/Prev Tab",
      "ui:ResourceManager/shortcut/Window/Resource Browser",
      "ui:ScriptEditor/control/Debug/Continue",
      "ui:ScriptEditor/control/Debug/Step Into",
      "ui:ScriptEditor/control/Debug/Step Out",
      "ui:ScriptEditor/control/Debug/Step Over",
      "ui:WorldEditor/shortcut/Top Bar/Terrain Creation Tool",
      "ui:WorldEditor/shortcut/Top Bar/Vector Entity Tool",
      "ui:WorldEditor/tool/Terrain Creation Tool",
      "ui:WorldEditor/tool/Vector Entity Tool",
      "ui:WorldEditor/tool/Vector Tool",
    ]);
    expect(h.rows_with_unverified).toBe(28);
    for (const r of result.rows) {
      for (const u of r.obs.unverified ?? []) {
        expect(u.length, r.id).toBeGreaterThan(40);
        expect(containsMachinePath(u), r.id).toBe(false);
      }
    }
  });

  it("Terrain Tool / Terrain Creation Tool: the kept row names the other page location and quotes the sentence the merge rests on", () => {
    const sentence =
      "See {{Link|Arma Reforger:World Editor: Terrain Creation Tool#Sculpt}}. Shortcut: {{Controls|Ctrl|T}}";
    expect(pageText("Arma_Reforger:World_Editor")).toContain(sentence);
    for (const id of [
      "ui:WorldEditor/tool/Terrain Creation Tool",
      "ui:WorldEditor/shortcut/Top Bar/Terrain Creation Tool",
    ]) {
      const notes = notesOf(id);
      expect(notes, id).toHaveLength(1);
      expect(notes[0], id).toContain("(wiki:Arma_Reforger:World_Editor#Terrain_Tool)");
      expect(notes[0], id).toContain("(wiki:Arma_Reforger:World_Editor:_Terrain_Creation_Tool)");
      expect(notes[0], id).toContain(`"${sentence}"`);
      expect(notes[0], id).toContain("do not state that they are one thing");
    }
    expect(result.bySlug.has("Arma_Reforger:World_Editor:_Terrain_Creation_Tool")).toBe(true);
  });

  it("Vector Entity Tool / Vector Tool: two rows the pages do not call one thing, each naming the other", () => {
    const entity = "ui:WorldEditor/tool/Vector Entity Tool";
    const vector = "ui:WorldEditor/tool/Vector Tool";
    expect(rowOf(entity)?.obs.ref).toBe("wiki:Arma_Reforger:World_Editor#Vector_Entity_Tool");
    expect(rowOf(vector)?.obs.ref).toBe("wiki:Arma_Reforger:World_Editor:_Vector_Tool");
    expect(notesOf(entity)).toHaveLength(1);
    expect(notesOf(entity)[0]).toContain("(wiki:Arma_Reforger:World_Editor:_Vector_Tool)");
    expect(notesOf(entity)[0]).toContain("do not say that");
    expect(notesOf(vector)).toHaveLength(1);
    expect(notesOf(vector)[0]).toContain("(wiki:Arma_Reforger:World_Editor#Vector_Entity_Tool)");
    expect(notesOf(vector)[0]).toContain("do not say that");
    // The shortcut row of the top bar entry says it too.
    expect(notesOf("ui:WorldEditor/shortcut/Top Bar/Vector Entity Tool")).toEqual(notesOf(entity));
    expect(result.bySlug.has("Arma_Reforger:World_Editor:_Vector_Tool")).toBe(true);
  });

  it("General Shortcuts rows merged into menu rows: the kept menu row and its shortcut row name the absorbed table row, in the page's own cells, and the section they rest on", () => {
    const rm = pageText("Arma_Reforger:Resource_Manager");
    for (const [keyCell, labelCell, path, sentence] of [
      [
        "{{Controls|F5}}",
        "Reimports active resource",
        ["Edit", "Reimport resource"],
        "Reload the current file from storage.",
      ],
      [
        "{{Controls|Ctrl|B}}",
        "Locates active resource in Resource Browser",
        ["Edit", "Locate file in resource browser"],
        "Show the selected file in the Resource Browser tree.",
      ],
      [
        "{{Controls|F1}}",
        "Opens/closes log console",
        ["Window", "Log Console"],
        "Hide/show the Log Console and its history.",
      ],
      [
        "{{Controls|F3}}",
        "Opens/closes Resource Browser window",
        ["Window", "Resource Browser"],
        'Hide/show the "project tree" view.',
      ],
      [
        "{{Controls|Ctrl|Tab}}",
        "Cycles between opened tab",
        ["Window", "Cycle Tabs"],
        "Shortcut: {{Controls|Ctrl|Tab}}.",
      ],
      [
        "{{Controls|Ctrl|W}}",
        "Closes active tab",
        ["Window", "Close Current Tab"],
        "Shortcut: {{Controls|Ctrl|W}}.",
      ],
    ] as const) {
      expect(rm).toContain(`| ${keyCell}\n| ${labelCell}`);
      expect(rm).toContain(sentence);
      for (const kind of ["menu-item", "shortcut"]) {
        const id = `ui:ResourceManager/${kind}/${path.join("/")}`;
        const notes = notesOf(id);
        expect(notes, id).toHaveLength(1);
        expect(notes[0], id).toContain("Merged from two page locations");
        expect(notes[0], id).toContain(`the cells "${keyCell}" and "${labelCell}"`);
        expect(notes[0], id).toContain(sentence);
        expect(notes[0], id).toContain("does not say they are one action");
      }
      // The absorbed row is not a row of its own.
      expect(rowOf(`ui:ResourceManager/shortcut/${labelCell}`), labelCell).toBeUndefined();
    }
  });

  it("Script Editor Keyboard Shortcuts rows absorbed into the Debug section: the kept control row names the table row and quotes the Debug line", () => {
    const se = pageText("Arma_Reforger:Script_Editor");
    for (const [name, keyCell, line] of [
      [
        "Continue",
        "{{Controls|F5}}",
        "'''Continue:''' {{Controls|F5}} Continue standard code execution",
      ],
      [
        "Step Over",
        "{{Controls|F10}}",
        "'''Step Over:''' {{Controls|F10}} Advance the debugger without stepping into functions or methods.",
      ],
      [
        "Step Into",
        "{{Controls|F11}}",
        "'''Step Into:''' {{Controls|F11}} Advance the debugger one statement at a time.",
      ],
      [
        "Step Out",
        "{{Controls|Shift|F11}}",
        "'''Step Out:''' {{Controls|Shift|F11}} Advance the debugger until the current function returns.",
      ],
    ] as const) {
      expect(se).toContain(`| ${keyCell}\n| Debug: ${name}`);
      expect(se).toContain(line);
      const id = `ui:ScriptEditor/control/Debug/${name}`;
      const notes = notesOf(id);
      expect(notes, id).toHaveLength(1);
      expect(notes[0], id).toContain("Merged from two page locations");
      expect(notes[0], id).toContain(`the cells "${keyCell}" and "Debug: ${name}"`);
      expect(notes[0], id).toContain(line);
      expect(notes[0], id).toContain("(wiki:Arma_Reforger:Script_Editor#Debug)");
    }
  });

  it("the Resource Manager page contradicts itself on Ctrl+Page Up / Ctrl+Page Down: both sides stay as rows, each with the contradiction and the other section", () => {
    const rm = pageText("Arma_Reforger:Resource_Manager");
    // [General Shortcuts label, its key as the table writes it, Window menu item, section heading, section line]
    for (const [general, tableKey, item, heading, sectionLine] of [
      [
        "Next tab",
        "{{Controls|Ctrl|Page Up}}",
        "Prev Tab",
        "Previous Tab",
        "Shortcut: {{Controls|Ctrl|PageUp}}.",
      ],
      [
        "Previous tab",
        "{{Controls|Ctrl|Page Down}}",
        "Next Tab",
        "Next Tab",
        "Shortcut: {{Controls|Ctrl|PageDown}}.",
      ],
    ] as const) {
      // The page really says both (the verifier's evidence): the table row and the section.
      expect(rm).toContain(`| ${tableKey}\n| ${general}`);
      expect(rm).toContain(`==== ${heading} ====\n${sectionLine}`);
      // Both sides are rows (no side is deleted as a duplicate of the other).
      const table = rowOf(`ui:ResourceManager/shortcut/${general}`);
      const menu = rowOf(`ui:ResourceManager/menu-item/Window/${item}`);
      expect(table, general).toBeDefined();
      expect(menu, item).toBeDefined();
      expect(table?.obs.ref).toBe("wiki:Arma_Reforger:Resource_Manager#General_Shortcuts");
      const here = notesOf(table?.id ?? "");
      expect(here, general).toHaveLength(1);
      expect(here[0]).toContain("The page contradicts itself on this key");
      expect(here[0]).toContain(`the cells "${tableKey}" and "${general}"`);
      expect(here[0]).toContain(`the Window Menu section "${heading}"`);
      expect(here[0]).toContain(`"${sectionLine}"`);
      expect(here[0]).toContain("Both rows are kept");
      for (const kind of ["menu-item", "shortcut"]) {
        const there = notesOf(`ui:ResourceManager/${kind}/Window/${item}`);
        expect(there, `${kind} ${item}`).toHaveLength(1);
        expect(there[0]).toContain("The page contradicts itself on this key");
        expect(there[0]).toContain(`the Window Menu section "${heading}"`);
        expect(there[0]).toContain(`"${sectionLine}"`);
        expect(there[0]).toContain(
          `the General Shortcuts table row with the cells "${tableKey}" and "${general}"`,
        );
        expect(there[0]).toContain("Both rows are kept");
      }
    }
    // The two sides really do give one key two names.
    expect(rowOf("ui:ResourceManager/shortcut/Next tab")?.obs.shortcut_default).toBe(
      "Ctrl+Page Up",
    );
    expect(rowOf("ui:ResourceManager/menu-item/Window/Prev Tab")?.obs.shortcut_default).toBe(
      "Ctrl+PageUp",
    );
    expect(rowOf("ui:ResourceManager/shortcut/Previous tab")?.obs.shortcut_default).toBe(
      "Ctrl+Page Down",
    );
    expect(rowOf("ui:ResourceManager/menu-item/Window/Next Tab")?.obs.shortcut_default).toBe(
      "Ctrl+PageDown",
    );
  });

  // ── Whole sentences, TODO, named labels ────────────────────────────────────

  it("a `what` is a whole sentence or statement of the page: not cut at an ellipsis in a menu name or at a dash inside one item", () => {
    expect(rowOf("ui:WorldEditor/control/Vector Tool/Exclude children")?.obs.what).toBe(
      "When ticked, Select entities... actions will not include children (useful to e.g avoid trees from a Forest Generator)",
    );
    const gesture = rowOf(
      "ui:WorldEditor/canvas-gesture/Viewport/changes the speed at which the camera moves",
    );
    expect(gesture?.obs.what).toBe(
      "The mouse wheel MMB changes the speed at which the camera moves - scroll up to increase the speed, scroll down to decrease it.",
    );
    expect(gesture?.obs.quote).toBe(
      "* The mouse wheel {{Controls|MMB}} changes the speed at which the camera moves - scroll up to increase the speed, scroll down to decrease it.",
    );
    expect(rowOf("ui:ResourceManager/control/Resource Browser/Search bar")?.obs.what).toBe(
      "The Search bar allows the typing of words/sequences, separated by a space, that should be found in the file name - including keywords.",
    );
    // Sweep: no description is the head of a longer item of its page that goes on with `...` or ` - `.
    const heads: string[] = [];
    const itemsBySlug = new Map<string, string[]>();
    for (const r of result.rows) {
      const slug = r.obs.ref.slice(5).split("#")[0];
      const ix = result.bySlug.get(slug);
      if (!ix || r.obs.what === undefined) continue;
      const w = r.obs.what.replace(/[.\s]+$/, "");
      let items = itemsBySlug.get(slug);
      if (!items) {
        items = [];
        for (const line of ix.lines)
          for (const cell of line.replace(/^[|!*#:;\s]+/, "").split(/\|\||!!/))
            items.push(cleanWiki(cell));
        for (const t of ix.parsed.tables)
          for (const row of t.rows)
            for (const cell of row.cells)
              for (const l of cell.raw.split(/\r?\n/))
                items.push(cleanWiki(l.replace(/^[*#:;\s]+/, "")));
        itemsBySlug.set(slug, items);
      }
      const longer = items.find(
        (i) =>
          i.length > w.length + 3 &&
          i.startsWith(w) &&
          /^(?:\.\.\.|\s[-–—]\s)/.test(i.slice(w.length)),
      );
      if (longer) heads.push(`${r.id}: ${JSON.stringify(r.obs.what)} of ${JSON.stringify(longer)}`);
    }
    expect(heads).toEqual([]);
  });

  it("a maintenance TODO template is not flattened into a `what`: the row has no `what` and the TODO is in `unverified`", () => {
    const id = "ui:ResourceManager.Model/toolbar-button/Horizontal bar/Camera auto placement";
    const todo =
      "{{Wiki|TODO|seems to disable '''View > Perspective''' and '''Focus selected object'''}}";
    expect(pageText("Arma_Reforger:Resource_Manager:_Model_Editor")).toContain(todo);
    const r = rowOf(id);
    expect(r?.obs.what).toBeUndefined();
    expect(r?.obs.label).toBe("Camera auto placement");
    expect(notesOf(id)).toEqual([
      `The page carries a maintenance TODO in this row's description cell, not a description: ${todo}`,
    ]);
    for (const x of result.rows) {
      expect(x.obs.what ?? "", x.id).not.toMatch(/TODO/);
      expect(x.obs.label ?? "", x.id).not.toMatch(/TODO/);
    }
  });

  it("control names the page states in running prose keep their label when the exact words are in the cited section; composed phrases do not", () => {
    for (const [id, label] of NAMED_LABELS) {
      const r = rowOf(id);
      expect(r?.obs.label, id).toBe(label);
      const ref = r?.obs.ref ?? "";
      const ix = result.bySlug.get(ref.slice(5).split("#")[0]);
      const anchor = ref.split("#")[1] ?? "";
      const heading = ix?.byAnchor.get(anchor);
      const lines = ix
        ? anchor === ""
          ? leadLines(ix)
          : heading
            ? bodyLines(ix, heading)
            : []
        : [];
      const hay = lines.map((l) => cleanWiki(l.text)).join(" ");
      expect(hay, id).toMatch(new RegExp(`(?<![A-Za-z0-9])${label}(?![A-Za-z0-9])`));
    }
    // Not marked: the generic words of a sentence stay without a label (the key keeps them).
    expect(
      rowOf("ui:ParticleEditor/control/Effect Panel/drop-down menu")?.obs.label,
    ).toBeUndefined();
    expect(
      rowOf("ui:WorldEditor/canvas-gesture/Viewport/move the camera forward and backward")?.obs
        .label,
    ).toBeUndefined();
    // What is still left out of the labels is on the record: 35 before, 8 kept.
    expect(
      result.collector.skipped.filter((s) => /^label is not a unit/.test(s.reason)),
    ).toHaveLength(27);
  });

  it("shortcut_default values: one separator between alternatives everywhere, the page's key names kept", () => {
    const all = result.rows.map((r) => r.obs.shortcut_default).filter((x): x is string => !!x);
    // Alternatives are joined with " / " and nothing else: no bare slash, comma, "or" or ampersand.
    for (const x of all) {
      // (A qualifier in parentheses is the page's own words: `Alt+LMB (Drag & drop)`.)
      const keys = x.replace(/\s*\([^)]*\)/g, "");
      expect(keys, x).not.toMatch(/\S\/|\/\S/);
      expect(keys, x).not.toMatch(/,|\bor\b|&/);
    }
    const alternatives = all.filter((x) => x.includes(SHORTCUT_ALT_SEP));
    expect(alternatives).toEqual(
      expect.arrayContaining([
        "W / A / S / D",
        "Shift+Mouse up / Shift+Mouse down",
        "Ctrl+Mouse up / Ctrl+Mouse down",
        "RMB+W / RMB+S",
        "RMB+A / RMB+D",
        "RMB+Q / RMB+Z",
      ]),
    );
    // The page's own key names: both spellings of Page Down occur because two pages write them so.
    expect(all).toContain("Ctrl+PageDown");
    expect(all).toContain("Ctrl+Page Down");
    expect(all).toContain("Ctrl+Spacebar");
    expect(all.some((x) => /Mouse (?:up|down) [A-Z]/.test(x))).toBe(false);
    // The row for each alternative is one row: no second row repeats a key under the same label.
    const sc = result.rows.filter((r) => r.obs.kind === "shortcut");
    expect(new Set(sc.map((r) => r.id)).size).toBe(sc.length);
  });

  it("is byte-identical on a second run over the same export", () => {
    const again = buildE07(parseExport(xml), { kinds: ALLOWED.kinds, dims: ALLOWED.dims });
    const inputs = [{ path: "<repo>/data/wiki/export.xml", sha256: "0".repeat(64) }];
    expect(observationFileText(again.rows, "1.8.0.13", inputs)).toBe(
      observationFileText(result.rows, "1.8.0.13", inputs),
    );
  });
});

// ── Ledger acceptance in a temporary copy ────────────────────────────────────

describe("ledger acceptance (temporary census root, real export)", () => {
  it("run() writes observations/E07/<build>.jsonl and the artifacts; buildLedger rejects no line and reports no problem naming E07 rows", () => {
    const fx = makeCensus("1.8.0.13");
    const artifacts = mkdtempSync(join(tmpdir(), "e07-artifacts-"));
    const res = runIn(fx, run, ["--export", REAL_EXPORT, "--artifacts", artifacts]);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain(`E07 at build 1.8.0.13: ${EXPECTED_ROWS} observations`);
    const file = join(fx.root, "observations", "E07", "1.8.0.13.jsonl");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const header = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(header).toMatchObject({
      $header: 1,
      build: "1.8.0.13",
      enumerator: "E07",
      generator: GENERATOR,
      provisional: false,
      row_count: EXPECTED_ROWS,
    });
    expect((header.inputs as { path: string }[])[0].path).toBe("<repo>/data/wiki/export.xml");
    expect(lines.length - 1).toBe(EXPECTED_ROWS);
    for (const l of lines.slice(1)) {
      const o = JSON.parse(l) as Observation;
      expect(o.origin).toBe("vanilla");
      expect(Object.keys(o)).not.toContain("id");
    }

    const decisions = JSON.parse(
      readFileSync(join(artifacts, "census", "1.8.0.13", "E07", "page-decisions.json"), "utf-8"),
    ) as {
      summary: { pages: number; in_scope: number };
      pages: { reason: string; in_scope: boolean; title: string }[];
    };
    expect(decisions.summary.pages).toBe(295);
    expect(decisions.pages).toHaveLength(295);
    expect(decisions.pages.filter((p) => p.in_scope)).toHaveLength(decisions.summary.in_scope);
    expect(JSON.stringify(decisions)).not.toMatch(/[A-Za-z]:\\\\Users/);
    expect(existsSync(join(artifacts, "census", "1.8.0.13", "E07", "report.json"))).toBe(true);

    const built = buildLedger(fx.paths, { build: "1.8.0.13" });
    expect(built.rejected.filter((r) => r.file.includes("/E07/"))).toEqual([]);
    expect(built.rejected).toEqual([]);
    expect(built.problems.filter((p) => JSON.stringify(p).includes("E07"))).toEqual([]);
    expect(built.problems).toEqual([]);
    expect(built.rows.length).toBe(EXPECTED_ROWS);

    // Second run: byte-identical file.
    const first = readFileSync(file, "utf-8");
    const res2 = runIn(fx, run, ["--export", REAL_EXPORT, "--artifacts", artifacts]);
    expect(res2.code).toBe(0);
    expect(readFileSync(file, "utf-8")).toBe(first);
  });

  it("a copy of the whole data/census accepts the file: no rejected line; a problem naming E07 can only be a provisional E01 row disagreeing", { timeout: 300_000 }, () => {
    const repo = mkdtempSync(join(tmpdir(), "e07-full-"));
    const root = join(repo, "data", "census");
    cpSync(REAL_CENSUS, root, { recursive: true });
    const fx = { repo, root, paths: censusPaths(root) };
    const artifacts = mkdtempSync(join(tmpdir(), "e07-full-art-"));
    const res = runIn(fx, run, ["--export", REAL_EXPORT, "--artifacts", artifacts]);
    expect(res.code, res.stderr).toBe(0);
    const built = buildLedger(fx.paths, { build: "1.8.0.13" });
    expect(built.rejected).toEqual([]);
    // A conflict is between this file and another enumerator's. E07 follows the wiki; the only
    // file allowed to disagree is E01's provisional recon import (DEC-020).
    const own = built.problems.filter((p) => p.message.includes("observations/E07/"));
    for (const p of own) {
      expect(p.message, p.message).toContain("observations/E01/");
      expect(p.message, p.message).not.toMatch(/observations\/E(?!01\/|07\/)\d+\//);
    }
  });

  it("run() refuses --artifacts inside a git working tree before writing anything", () => {
    const fx = makeCensus("1.8.0.13");
    const inside = join(REPO_ROOT, "node_modules", ".e07-artifacts-test");
    const res = runIn(fx, run, ["--export", REAL_EXPORT, "--artifacts", inside]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("refusing --artifacts inside a git working tree");
    expect(existsSync(join(fx.root, "observations", "E07", "1.8.0.13.jsonl"))).toBe(false);
    expect(existsSync(inside)).toBe(false);
    // A relative path is resolved first: the working directory is inside the repository.
    const relative = runIn(fx, run, ["--export", REAL_EXPORT, "--artifacts", "."]);
    expect(relative.code).toBe(1);
    expect(relative.stderr).toContain("refusing --artifacts inside a git working tree");
    // The check is `insideGitWorkTree` (a parent holding `.git`); `--no-artifacts` is exempt.
    expect(insideGitWorkTree(inside)).toBe(true);
    expect(insideGitWorkTree(mkdtempSync(join(tmpdir(), "e07-outside-")))).toBe(false);
    expect(existsSync(join(fx.root, "observations", "E07", "1.8.0.13.jsonl"))).toBe(false);
  });

  it("the artifacts folder is created outside the census root", () => {
    const fx = makeCensus("1.8.0.13");
    const artifacts = join(mkdtempSync(join(tmpdir(), "e07-art-")), "nested");
    mkdirSync(artifacts, { recursive: true });
    const res = runIn(fx, run, ["--export", REAL_EXPORT, "--artifacts", artifacts]);
    expect(res.code).toBe(0);
    expect(existsSync(join(artifacts, "census", "1.8.0.13", "E07", "page-decisions.json"))).toBe(
      true,
    );
    expect(existsSync(join(fx.root, "census"))).toBe(false);
  });
});
