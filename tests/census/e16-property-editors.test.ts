/**
 * E16 property-editor kinds: the UIWidgets members read from a synthetic
 * class through the E02 parser, usage counting, popup evidence, determinism,
 * the ledger's acceptance of the rows in a temporary census, the NO DATA
 * paths, and (when the source index and the game are present) the headline
 * counts of build 1.8.0.13. Synthetic sources only; no vanilla file is
 * copied into the repository.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/census/build-ledger.js";
import { sha256 } from "../../src/census/canon.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { deriveId } from "../../src/census/ids.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  sourceIndexPath,
  type SourceInput,
} from "../../src/census/source-index.js";
import { loadConfig } from "../../src/config.js";
import {
  GENERATOR,
  WIKI_EXPORT,
  defaultWikiFile,
  headline,
  observationFileText,
  observationRows,
  pakBytes,
  plainWikitext,
  reportJson,
  resolveOut,
  run as runE16,
  splitArguments,
  stringValue,
  topUsed,
  usageTable,
  widgetAfterNamedArgument,
  widgetMembers,
  widgetTableRows,
  widgetsNamedBy,
  wikiWidgetRows,
  type RowsResult,
  type ScriptBytes,
} from "../../scripts/census/enumerators/e16-property-editors.js";
import { REPO_ROOT, makeCensus, runIn } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic inputs ──────────────────────────────────────────────────────────

const ATTRIBUTES_FILE = "scripts/Core/attributes.c";
const SAMPLE_FILE = "scripts/Game/Sample/SCR_SampleComponent.c";

/** A UIWidgets class shaped like the real one: doc comments of both forms, members without a doc. */
function widgetsSource(extraDoc = ""): string {
  return [
    "// -------------------------------------------------------------------------",
    "class UIWidgets",
    "{",
    "\t//! Widget is set automatically by script variable type.",
    '\tstatic const string\tAuto = "auto";',
    "",
    "\t//! Property is hidden when None is used.",
    '\tstatic const string\tNone = "";',
    "",
    "\t/*!",
    `\tColor wheel picker. m_strParams has no usage.${extraDoc}`,
    "\t*/",
    '\tstatic const string\tColorPicker = "colorPicker";',
    "",
    "\t/*!",
    "\tRegistered resource picker.",
    "",
    "\tm_strParams contains file extensions separated by whitespace.",
    "\t*/",
    '\tstatic const string\tResourceNamePicker = "resourcePickerSimple";',
    "",
    "\t/*!",
    "\tCombobox. Enums may contain selectable values.",
    "\t*/",
    '\tstatic const string\tComboBox = "combobox";',
    "",
    '\tstatic const string\tEditComboBox = "editcombobox";',
    "",
    "\t/*!",
    "\tSlider. m_strParams may contain min, max and step values separated by",
    "\tspace.",
    "\t*/",
    '\tstatic const string\tSlider = "slider";',
    "",
    "\t/*!",
    '\tEdit box with a generic ".." button which is used to open separate window',
    "\twith text editor. Type must be enf::DVT_STRING.",
    "\t*/",
    '\tstatic const string\tEditBoxMultiline = "editboxMultiline";',
    "",
    "\t/*!",
    "\tSmall script preview and button which opens ScriptEditor to edit script",
    "\tproperty. Type must be enf::DVT_STRING.",
    "\t*/",
    '\tstatic const string\tScript = "script";',
    "",
    "\t/*!",
    "\tProperty parameters for curve consists of:",
    "",
    "\t- type: Default curve type selected",
    "\t*/",
    '\tstatic const string\tCurveDialog = "curveDialog";',
    "",
    "\t//! Font picker. m_strParams has no usage.",
    '\tstatic const string\tFont = "font";',
    "}",
    "",
  ].join("\n");
}

/** Attribute annotations in every argument form the script source uses. */
function sampleSource(): string {
  return [
    "class SCR_SampleComponent",
    "{",
    '\t[Attribute("1", UIWidgets.Slider, "positional", "0 10 1")]',
    "\tfloat m_A;",
    "",
    '\t[Attribute(defvalue: "1", uiwidget: UIWidgets.Slider, desc: "named")]',
    "\tfloat m_B;",
    "",
    '\t[Attribute("0", desc: "positional after a named argument", UIWidgets.ComboBox)]',
    "\tint m_C;",
    "",
    '\t[Attribute("1", uiwidget: UIWidgets.ComboBox, enums: ParamEnumArray.FromEnum(EFoo, 1, 2))]',
    "\tint m_D;",
    "",
    '\t[Attribute(defvalue: "x", desc: "text that mentions UIWidgets.Slider is not an argument")]',
    "\tstring m_E;",
    "",
    '\t//[Attribute("", UIWidgets.ColorPicker)]',
    "\tstring m_F;",
    "",
    '\t[Attribute("", UIWidgets.Bogus)]',
    "\tstring m_G;",
    "",
    '\t[Attribute("", UIWidgets.Auto)]',
    "\tstring m_H;",
    "",
    '\t[Attribute(defvalue: "", uiwidget: UIWidgets.Auto)]',
    "\tstring m_I;",
    "",
    '\t[Attribute("", "slider")]',
    "\tstring m_J;",
    "",
    "\t[Attribute(desc: UIWidgets.Slider)]",
    "\tstring m_K;",
    "",
    "\t[Attribute()]",
    "\tstring m_L;",
    "}",
    "",
  ].join("\n");
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A wiki export with the shape of the real widget table: a table nested in the uiwidget row. */
function wikiExport(): string {
  const text = [
    "{{TOC|side}}",
    '{| class="wikitable"',
    "|+ Parameters Description",
    "! Parameter",
    "! Type",
    "! Description",
    "|-",
    "| defvalue",
    "| string",
    "| The default value.",
    "|-",
    "| uiwidget",
    "| string",
    "| The Widget type to be used. See the {{Link/Enfusion|armaR|UIWidgets}} class.",
    "",
    '{| class="wikitable"',
    "! rowspan=2 | Value",
    "! rowspan=2 | Description",
    "|-",
    "| ColorPicker",
    "| A colour modification UI. Clicking the colour rectangle will display the colour picker, allowing to set values in many ways.",
    "<!-- bool float int string vector -->",
    '| colspan="5" | <enforce inline>Color</enforce>',
    "|-",
    "| ComboBox",
    "| A combo box that opens and allows to pick one value among a selection.",
    "|-",
    "| Slider",
    "| A click and drag allows to set the value on the slider.",
    "|-",
    "| FileEditBox",
    "| Internal use.",
    "|}",
    "",
    "|-",
    "| desc",
    "| string",
    "| The variable's description.",
    "|}",
    "",
    '{| class="wikitable"',
    "! Attribute Type",
    "! Default UI Widget",
    "|-",
    "| bool",
    "| Checkbox",
    "|-",
    "| int",
    "| SpinBox",
    "|}",
  ].join("\n");
  return [
    "<mediawiki>",
    "  <page>",
    "    <title>Sample:Config Object</title>",
    "    <ns>0</ns>",
    "    <id>1</id>",
    `    <revision><text bytes="1" xml:space="preserve">${xmlEscape(text)}</text></revision>`,
    "  </page>",
    "  <page>",
    "    <title>Sample:Unrelated</title>",
    "    <ns>0</ns>",
    "    <id>2</id>",
    `    <revision><text xml:space="preserve">${xmlEscape("{|\n|-\n| ColorPicker\n| opens a window in some other tool\n|}\n(no widget class named here)")}</text></revision>`,
    "  </page>",
    "</mediawiki>",
  ].join("\n");
}

const BUILD = "1.0.0.1";

function sources(extraDoc = ""): SourceInput[] {
  return [
    { path: ATTRIBUTES_FILE, text: widgetsSource(extraDoc) },
    { path: SAMPLE_FILE, text: sampleSource() },
  ];
}

/** Raw bytes of the synthetic files, the way the pak would give them. */
function bytesOf(inputs: readonly SourceInput[]): ScriptBytes {
  const m = new Map(inputs.map((i) => [i.path, Buffer.from(i.text, "utf-8")]));
  return { readFile: (p) => m.get(p) };
}

function rowsFor(extraDoc = "", withWiki = true): { result: RowsResult; inputs: SourceInput[] } {
  const inputs = sources(extraDoc);
  const index = buildSourceIndex(inputs, { build: BUILD });
  const wikiXml = wikiExport();
  const result = observationRows(index, {
    build: BUILD,
    scripts: bytesOf(inputs),
    wikiRows: withWiki ? wikiWidgetRows(wikiXml) : undefined,
    wikiSha256: withWiki ? "0".repeat(64) : undefined,
  });
  return { result, inputs };
}

const byId = (r: RowsResult): Map<string, RowsResult["observations"][number]> =>
  new Map(r.observations.map((o) => [deriveId(o), o]));

// ── Members ───────────────────────────────────────────────────────────────────

describe("e16 members of a synthetic UIWidgets class (through the E02 parser)", () => {
  const index = buildSourceIndex(sources(), { build: BUILD });

  it("reads every member in declaration order with value, line and doc", () => {
    const members = widgetMembers(index);
    expect(members.map((m) => m.name)).toEqual([
      "Auto",
      "None",
      "ColorPicker",
      "ResourceNamePicker",
      "ComboBox",
      "EditComboBox",
      "Slider",
      "EditBoxMultiline",
      "Script",
      "CurveDialog",
      "Font",
    ]);
    const cp = members.find((m) => m.name === "ColorPicker");
    expect(cp?.value).toBe("colorPicker");
    expect(cp?.file).toBe(ATTRIBUTES_FILE);
    expect(sources()[0].text.split("\n")[(cp?.line ?? 0) - 1]).toContain("ColorPicker =");
    expect(members.find((m) => m.name === "None")?.value).toBe("");
    expect(members.find((m) => m.name === "EditComboBox")?.doc).toBeUndefined();
    expect(members.find((m) => m.name === "Auto")?.doc).toBe(
      "Widget is set automatically by script variable type.",
    );
  });

  it("returns nothing when the class is absent or only forward-declared", () => {
    const none = buildSourceIndex([{ path: "scripts/Core/other.c", text: "class Other {}\n" }], {
      build: BUILD,
    });
    expect(widgetMembers(none)).toEqual([]);
    const result = observationRows(none, { build: BUILD, scripts: bytesOf([]) });
    expect(result.observations).toEqual([]);
    expect(result.members).toEqual([]);
  });

  it("unquotes string initialisers and refuses anything else", () => {
    expect(stringValue('"colorPicker"')).toBe("colorPicker");
    expect(stringValue('""')).toBe("");
    expect(stringValue("SOME_CONST")).toBeUndefined();
    expect(stringValue(undefined)).toBeUndefined();
  });
});

// ── Usage ─────────────────────────────────────────────────────────────────────

describe("e16 usage of the kinds by attribute annotations", () => {
  it("splits arguments at top-level commas only", () => {
    expect(splitArguments('"a, b", UIWidgets.Slider, enums: F(1, 2), x: { 1, 2 }')).toEqual([
      '"a, b"',
      "UIWidgets.Slider",
      "enums: F(1, 2)",
      "x: { 1, 2 }",
    ]);
    expect(splitArguments('"a \\", b", c')).toEqual(['"a \\", b"', "c"]);
    expect(splitArguments("")).toEqual([]);
  });

  it("names the widget of a bare argument or of uiwidget:, and nothing else", () => {
    expect(widgetsNamedBy('"1", UIWidgets.Slider, "d"')).toEqual(["Slider"]);
    expect(widgetsNamedBy("defvalue: 1, uiwidget: UIWidgets.ComboBox")).toEqual(["ComboBox"]);
    expect(widgetsNamedBy('"0", desc: "x", UIWidgets.ComboBox')).toEqual(["ComboBox"]);
    expect(widgetsNamedBy("desc: UIWidgets.Slider")).toEqual([]);
    expect(widgetsNamedBy('desc: "see UIWidgets.Slider"')).toEqual([]);
    expect(widgetsNamedBy('"", "slider"')).toEqual([]);
    expect(widgetsNamedBy("UIWidgets.Slider, uiwidget: UIWidgets.Slider")).toEqual(["Slider"]);
    expect(widgetsNamedBy(undefined)).toEqual([]);
    expect(widgetsNamedBy("")).toEqual([]);
  });

  it("detects a bare widget argument that follows a named argument", () => {
    expect(widgetAfterNamedArgument('defvalue: "8", UIWidgets.EditBox, desc: "x"')).toBe(true);
    expect(widgetAfterNamedArgument('"0", desc: "x", UIWidgets.ComboBox')).toBe(true);
    expect(widgetAfterNamedArgument('"1", UIWidgets.Slider, desc: "x"')).toBe(false);
    expect(widgetAfterNamedArgument("defvalue: 1, uiwidget: UIWidgets.ComboBox")).toBe(false);
    expect(widgetAfterNamedArgument("desc: UIWidgets.Slider")).toBe(false);
    expect(widgetAfterNamedArgument(undefined)).toBe(false);
  });

  it("counts annotations per member, once per annotation, and keeps unused members at 0", () => {
    const index = buildSourceIndex(sources(), { build: BUILD });
    const names = widgetMembers(index).map((m) => m.name);
    const u = usageTable(index, names);
    expect(u.by_member).toMatchObject({
      Slider: 2,
      ComboBox: 2,
      Auto: 2,
      ColorPicker: 0, // only in a comment
      Font: 0,
      None: 0,
    });
    expect(Object.keys(u.by_member)).toEqual(names);
    expect(u.unknown_members).toEqual({ Bogus: 1 });
    expect(u.annotations_naming_a_widget).toBe(7);
    expect(u.annotations_widget_after_named_argument).toBe(1); // m_C only
    expect(u.by_attribute_name).toEqual({ Attribute: 7 });
    expect(u.by_host_kind).toEqual({ field: 7 });
    expect(u.annotations_scanned).toBe(11);
  });

  it("ranks the most used kinds by count, then name, and leaves out unused ones", () => {
    const index = buildSourceIndex(sources(), { build: BUILD });
    const u = usageTable(
      index,
      widgetMembers(index).map((m) => m.name),
    );
    expect(topUsed(u, 5)).toEqual([
      { member: "Auto", count: 2 },
      { member: "ComboBox", count: 2 },
      { member: "Slider", count: 2 },
    ]);
    expect(topUsed(u, 2)).toHaveLength(2);
  });
});

// ── Wiki ──────────────────────────────────────────────────────────────────────

describe("e16 wiki widget table", () => {
  it("reads the rows of tables on pages that name UIWidgets, nested tables included", () => {
    const rows = wikiWidgetRows(wikiExport());
    expect(rows.map((r) => r.name)).toEqual([
      "defvalue",
      "uiwidget",
      "ColorPicker",
      "ComboBox",
      "Slider",
      "FileEditBox",
      "desc",
      "bool",
      "int",
    ]);
    expect(new Set(rows.map((r) => r.page))).toEqual(new Set(["Sample:Config Object"]));
    const cp = rows.find((r) => r.name === "ColorPicker");
    expect(cp?.description).toBe(
      "A colour modification UI. Clicking the colour rectangle will display the colour picker, allowing to set values in many ways.",
    );
  });

  it("keeps only the table that holds at least three member names", () => {
    const rows = wikiWidgetRows(wikiExport());
    const kept = widgetTableRows(rows, ["ColorPicker", "ComboBox", "Slider", "Auto"]);
    expect(kept.map((r) => r.name)).toEqual(["ColorPicker", "ComboBox", "Slider", "FileEditBox"]);
    expect(widgetTableRows(rows, ["ColorPicker", "ComboBox"])).toEqual([]);
  });

  it("reduces wikitext markup to plain words", () => {
    expect(plainWikitext("A '''bold''' [[Page|link]] {{Controls|Del}} <!-- c --> word")).toBe(
      "A bold link word",
    );
  });
});

// ── Rows ──────────────────────────────────────────────────────────────────────

describe("e16 rows", () => {
  const { result, inputs } = rowsFor();
  const rows = byId(result);
  const pe = (m: string) => rows.get(`ui:Shared/property-editor/UIWidgets/${m}`);
  const dlg = (m: string) => rows.get(`ui:Shared/dialog/UIWidgets/${m}/popup`);

  it("emits one property-editor row per member, in the id form of ui rows", () => {
    expect(result.observations.filter((o) => o.kind === "property-editor")).toHaveLength(11);
    for (const o of result.observations) {
      expect(o.dim).toBe("ui");
      expect(o.module).toBe("Shared");
      expect(o.origin).toBe("vanilla");
      expect(o).not.toHaveProperty("id");
      expect(o).not.toHaveProperty("risk_hint");
      expect(o).not.toHaveProperty("paths_proposed");
    }
    const slider = pe("Slider");
    expect(slider).toMatchObject({
      kind: "property-editor",
      key: { path: ["UIWidgets", "Slider"] },
      label: "Slider",
      parent_key: null,
      confidence: "high",
      signature: 'static const string Slider = "slider"',
    });
  });

  it("uses the first paragraph of the doc comment as what, and leaves it out when the source says nothing", () => {
    expect(pe("Auto")?.what).toBe("Widget is set automatically by script variable type.");
    expect(pe("ResourceNamePicker")?.what).toBe("Registered resource picker.");
    expect(pe("Slider")?.what).toBe(
      "Slider. m_strParams may contain min, max and step values separated by space.",
    );
    // No doc comment: no invented sentence (no usage count either; that is in the report).
    expect(pe("EditComboBox")).toBeDefined();
    expect(pe("EditComboBox")).not.toHaveProperty("what");
    // A first paragraph that only introduces a list says nothing about the kind.
    expect(pe("CurveDialog")).not.toHaveProperty("what");
    for (const o of result.observations)
      expect(o.what ?? "").not.toMatch(/^used by \d+ attributes/);
    expect(pe("Font")?.what).toBe("Font picker. m_strParams has no usage.");
  });

  it("cites the declaration line verbatim", () => {
    const lines = new Map(inputs.map((i) => [i.path, i.text.split("\n")]));
    for (const o of result.observations) {
      const m = /^pak:([^#]+)#L(\d+)$/.exec(o.ref);
      expect(m).not.toBeNull();
      const line = lines.get(m![1])?.[Number(m![2]) - 1];
      expect(line).toBeDefined();
      expect(o.quote).toBeDefined();
      expect(line).toContain(o.quote);
    }
    expect(pe("Slider")?.quote).toBe('static const string\tSlider = "slider";');
  });

  it("gives a popup row to doc-stated, wiki-stated and name-implied kinds only", () => {
    const popups = result.observations
      .filter((o) => o.kind === "dialog")
      .map((o) => (o.key.path ?? [])[1])
      .sort();
    expect(popups).toEqual([
      "ColorPicker",
      "CurveDialog",
      "EditBoxMultiline",
      "ResourceNamePicker",
    ]);
    // No popup where the source shows none.
    for (const m of ["Auto", "None", "ComboBox", "EditComboBox", "Slider", "Script", "Font"])
      expect(dlg(m)).toBeUndefined();
    expect(pe("Slider")?.children_count).toBe(0);
    expect(pe("ColorPicker")?.children_count).toBe(1);
    expect(result.observations.filter((o) => o.children_count === 1).length).toBe(4);
  });

  it("states the evidence of each popup, with confidence medium unless a source states it", () => {
    const doc = dlg("EditBoxMultiline");
    expect(doc).toMatchObject({
      kind: "dialog",
      confidence: "high",
      parent_key: {
        dim: "ui",
        kind: "property-editor",
        module: "Shared",
        key: { path: ["UIWidgets", "EditBoxMultiline"] },
      },
    });
    // The row cites the doc line that says so, not the declaration.
    expect(doc?.quote).toBe(
      'Edit box with a generic ".." button which is used to open separate window',
    );
    const declLine = Number(/#L(\d+)$/.exec(pe("EditBoxMultiline")?.ref ?? "")?.[1]);
    expect(Number(/#L(\d+)$/.exec(doc?.ref ?? "")?.[1])).toBeLessThan(declLine);
    expect(doc?.unverified?.[0]).toContain("used to open separate window");

    const wiki = dlg("ColorPicker");
    // The wiki says a picker is displayed, not that a window opens; the ref is the declaration.
    expect(wiki?.confidence).toBe("medium");
    expect(wiki?.ref).toBe(pe("ColorPicker")?.ref);
    expect(wiki?.what).toBe(
      "Clicking the colour rectangle will display the colour picker, allowing to set values in many ways.",
    );
    expect(wiki?.unverified?.[0]).toContain('wiki page "Sample:Config Object"');

    for (const m of ["ResourceNamePicker", "CurveDialog"]) {
      const d = dlg(m);
      expect(d?.confidence).toBe("medium");
      expect(d?.what).toBeUndefined();
      expect(d?.ref).toBe(pe(m)?.ref);
      expect(d?.unverified?.[0]).toContain(`member name ${m}`);
    }
  });

  it("does not turn a doc that merely names an editor or a picker into a popup, and says so", () => {
    expect(dlg("Script")).toBeUndefined();
    expect(dlg("Font")).toBeUndefined();
    const notes = Object.fromEntries(
      result.members.filter((m) => m.no_popup_note).map((m) => [m.member, m.no_popup_note]),
    );
    expect(Object.keys(notes).sort()).toEqual(["Font", "Script"]);
    expect(notes.Script).toContain("opens ScriptEditor");
  });

  it("a wiki sentence about a dropdown ('opens and allows to pick') is not a popup", () => {
    expect(dlg("ComboBox")).toBeUndefined();
  });

  it("without a wiki export the wiki-stated popup falls back to the name", () => {
    const { result: bare } = rowsFor("", false);
    const d = byId(bare).get("ui:Shared/dialog/UIWidgets/ColorPicker/popup");
    expect(d?.confidence).toBe("medium");
    expect(d?.what).toBeUndefined();
    expect(bare.inputs.some((i) => i.path.endsWith("export.xml"))).toBe(false);
    expect(result.inputs.some((i) => i.path === "<repo>/data/wiki/export.xml")).toBe(true);
  });

  it("reports the wiki names that are not members, and the members the wiki has no row for", () => {
    expect(result.wiki.not_members).toEqual(["FileEditBox"]);
    expect(result.wiki.members_without_row).toContain("EditBoxMultiline");
    expect(result.wiki.members_without_row).not.toContain("Slider");
    expect(result.wiki.rows.map((r) => r.name)).toEqual([
      "ColorPicker",
      "ComboBox",
      "Slider",
      "FileEditBox",
    ]);
  });

  it("drops a string that looks like a machine path instead of writing it", () => {
    const planted = ["C", ":\\", "Users", "\\", "nobody", "\\", "x"].join("");
    const { result: r } = rowsFor(` See ${planted}.`);
    expect(r.scrubbed.length).toBeGreaterThan(0);
    expect(byId(r).get("ui:Shared/property-editor/UIWidgets/ColorPicker")?.what).toBeUndefined();
    expect(observationFileText(r, BUILD)).not.toContain(planted);
  });

  it("headline numbers of the synthetic class", () => {
    const h = headline(result);
    expect(h).toMatchObject({
      members: 11,
      distinct_values: 11,
      with_doc_comment: 10,
      without_doc_comment: ["EditComboBox"],
      used: 3,
      rows: { property_editor: 11, dialog: 4 },
    });
    expect(h.unused).toHaveLength(8);
    expect(h.popup_rows.map((p) => p.member).sort()).toEqual([
      "ColorPicker",
      "CurveDialog",
      "EditBoxMultiline",
      "ResourceNamePicker",
    ]);
    expect(JSON.parse(reportJson(result, BUILD, false)).headline.members).toBe(11);
  });
});

// ── File, determinism, ledger ─────────────────────────────────────────────────

function writeTree(): { scripts: string; wiki: string; artifacts: string } {
  const root = mkdtempSync(join(tmpdir(), "e16-"));
  for (const s of sources()) {
    const f = join(root, s.path);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, s.text);
  }
  const wiki = join(root, "export.xml");
  writeFileSync(wiki, wikiExport());
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts);
  return { scripts: root, wiki, artifacts };
}

const obsFile = (root: string, build = BUILD): string =>
  join(root, "observations", "E16", `${build}.jsonl`);

describe("e16 file, determinism and ledger", () => {
  it("writes a header and rows sorted by id, and a second run is byte-identical", () => {
    const fx = makeCensus(BUILD);
    const t = writeTree();
    const args = ["--scripts", t.scripts, "--wiki", t.wiki, "--artifacts", t.artifacts];
    const r1 = runIn(fx, runE16, args);
    expect(r1.code).toBe(0);
    const text1 = readFileSync(obsFile(fx.root), "utf-8");
    const lines = text1.trim().split("\n");
    const header = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(header).toMatchObject({
      $header: 1,
      build: BUILD,
      enumerator: "E16",
      generator: GENERATOR,
      provisional: false,
      row_count: lines.length - 1,
    });
    const inputs = header.inputs as { path: string; sha256: string }[];
    expect(inputs.map((i) => i.path)).toEqual([
      "<game>/addons/**/scripts/**/*.c",
      "<game>/pak:scripts/Core/attributes.c",
      "<repo>/data/wiki/export.xml",
    ]);
    expect(inputs.every((i) => /^[0-9a-f]{64}$/.test(i.sha256))).toBe(true);
    // The hash is over the file's bytes.
    const attrBytes = readFileSync(join(t.scripts, ATTRIBUTES_FILE));
    expect(inputs[1].sha256).toBe(sha256(attrBytes));
    expect(text1).not.toMatch(/[A-Za-z]:[\\/]/);
    const objs = lines.slice(1).map((l) => JSON.parse(l) as Parameters<typeof deriveId>[0]);
    const ids = objs.map((o) => deriveId(o));
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(ids).size).toBe(ids.length);
    const r2 = runIn(fx, runE16, args);
    expect(r2.code).toBe(0);
    expect(readFileSync(obsFile(fx.root), "utf-8")).toBe(text1);
    expect(r1.stdout).toContain(`E16 at build ${BUILD}: 15 observations`);
    // The report went to the artifacts folder, not into the census.
    expect(existsSync(join(t.artifacts, "census", BUILD, "E16", "report.json"))).toBe(true);
  });

  it("writes no report with --no-artifacts", () => {
    const fx = makeCensus(BUILD);
    const t = writeTree();
    const r = runIn(fx, runE16, [
      "--scripts",
      t.scripts,
      "--wiki",
      t.wiki,
      "--artifacts",
      t.artifacts,
      "--no-artifacts",
    ]);
    expect(r.code).toBe(0);
    expect(existsSync(join(t.artifacts, "census"))).toBe(false);
  });

  it("is accepted by the ledger: no rejected line, no problem naming the rows, parents resolve", () => {
    const fx = makeCensus(BUILD);
    const t = writeTree();
    runIn(fx, runE16, ["--scripts", t.scripts, "--wiki", t.wiki, "--artifacts", t.artifacts]);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(
      built.problems.filter((p) => (p.id ?? "").includes("UIWidgets") || p.message.includes("E16")),
    ).toEqual([]);
    const mine = built.rows.filter((r) => r.id.includes("UIWidgets"));
    const obsCount = readFileSync(obsFile(fx.root), "utf-8").trim().split("\n").length - 1;
    expect(mine).toHaveLength(obsCount);
    const ids = new Set(mine.map((r) => r.id));
    expect(
      mine.every((r) => r.parent === null || r.parent === undefined || ids.has(r.parent)),
    ).toBe(true);
    const cp = mine.find((r) => r.id === "ui:Shared/property-editor/UIWidgets/ColorPicker");
    expect(cp).toMatchObject({
      kind: "property-editor",
      children_count: 1,
      children_enumerated: true,
    });
    const popup = mine.find((r) => r.id === "ui:Shared/dialog/UIWidgets/ColorPicker/popup");
    expect(popup).toMatchObject({
      kind: "dialog",
      parent: "ui:Shared/property-editor/UIWidgets/ColorPicker",
    });
    expect(popup?.sources[0]).toMatchObject({ enumerator: "E16", confidence: "medium" });
  });

  it("answers NO DATA without a source index and a game, and without the class", () => {
    const fx = makeCensus(BUILD);
    const t = writeTree();
    const noGame = runIn(fx, runE16, [
      "--game",
      join(tmpdir(), "no-such-game"),
      "--artifacts",
      t.artifacts,
    ]);
    expect(noGame.code).toBe(2);
    expect(noGame.stdout).toContain("NO DATA");
    expect(existsSync(obsFile(fx.root))).toBe(false);
    const noDir = runIn(fx, runE16, ["--scripts", join(tmpdir(), "no-such-scripts")]);
    expect(noDir.code).toBe(2);
    expect(noDir.stdout).toContain("NO DATA");
    const empty = mkdtempSync(join(tmpdir(), "e16-empty-"));
    mkdirSync(join(empty, "scripts"), { recursive: true });
    writeFileSync(join(empty, "scripts", "x.c"), "class X {}\n");
    const noClass = runIn(fx, runE16, ["--scripts", empty, "--artifacts", t.artifacts]);
    expect(noClass.code).toBe(2);
    expect(noClass.stdout).toContain("UIWidgets is not in the source index");
    expect(existsSync(obsFile(fx.root))).toBe(false);
  });

  it("works without a wiki export, and refuses a foreign --out", () => {
    const fx = makeCensus(BUILD);
    const t = writeTree();
    const r = runIn(fx, runE16, [
      "--scripts",
      t.scripts,
      "--wiki",
      join(tmpdir(), "no-such-export.xml"),
      "--artifacts",
      t.artifacts,
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("wiki evidence skipped");
    const bad = runIn(fx, runE16, [
      "--scripts",
      t.scripts,
      "--artifacts",
      t.artifacts,
      "--out",
      join(tmpdir(), "elsewhere.jsonl"),
    ]);
    expect(bad.code).toBe(1);
    expect(() =>
      resolveOut(fx.paths, join(fx.root, "observations", "E02", "x.jsonl"), BUILD),
    ).toThrow(/refusing/);
  });

  it("refuses an --artifacts folder inside a git working tree and writes nothing", () => {
    const fx = makeCensus(BUILD);
    const t = writeTree();
    const inside = join(REPO_ROOT, "tests", "census", ".e16-artifacts-probe");
    const r = runIn(fx, runE16, ["--scripts", t.scripts, "--wiki", t.wiki, "--artifacts", inside]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("git working tree");
    expect(existsSync(inside)).toBe(false);
    expect(existsSync(obsFile(fx.root))).toBe(false);
  });

  it("finds the wiki export of the script's own repository when the census root is a copy", () => {
    const fx = makeCensus(BUILD);
    // The census root sits in a temporary repository with no data/wiki beside it.
    expect(existsSync(join(fx.paths.repo, WIKI_EXPORT))).toBe(false);
    expect(defaultWikiFile(fx.paths)).toBe(resolve(REPO_ROOT, WIKI_EXPORT));
    expect(defaultWikiFile({ ...fx.paths, repo: REPO_ROOT })).toBe(join(REPO_ROOT, WIKI_EXPORT));
  });

  it("prints usage for --help and stays quiet in --json", () => {
    const fx = makeCensus(BUILD);
    const t = writeTree();
    expect(runIn(fx, runE16, ["--help"]).stdout).toContain("usage:");
    const j = runIn(fx, runE16, [
      "--scripts",
      t.scripts,
      "--wiki",
      t.wiki,
      "--artifacts",
      t.artifacts,
      "--json",
    ]);
    const parsed = JSON.parse(j.stdout.trim()) as { ok: boolean; rows: number };
    expect(parsed).toMatchObject({ ok: true, rows: 15 });
  });
});

// ── Against the game (build 1.8.0.13) ─────────────────────────────────────────

const REAL_BUILD = "1.8.0.13";
const GAME_PATH = loadConfig().gamePath;
const HAVE_GAME = Boolean(GAME_PATH) && existsSync(join(GAME_PATH, "addons"));
const HAVE_INDEX = existsSync(sourceIndexPath(REAL_BUILD));
const REAL_WIKI = join(REPO_ROOT, "data", "wiki", "export.xml");

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !HAVE_GAME || !HAVE_INDEX)(
  "e16 against the source index and paks (build 1.8.0.13)",
  () => {
    const index = HAVE_INDEX ? loadSourceIndex(REAL_BUILD) : undefined;
    const bytes = HAVE_GAME ? pakBytes(GAME_PATH) : null;
    const wikiRaw = existsSync(REAL_WIKI) ? readFileSync(REAL_WIKI) : undefined;
    const result =
      index && bytes
        ? observationRows(index, {
            build: REAL_BUILD,
            scripts: bytes,
            wikiRows: wikiRaw ? wikiWidgetRows(wikiRaw.toString("utf-8")) : undefined,
          })
        : undefined;
    const h = result ? headline(result) : undefined;

    it("has 31 members and 31 property-editor rows, and 6 popup rows", () => {
      expect(h?.members).toBe(31);
      expect(h?.rows).toEqual({ property_editor: 31, dialog: 6 });
      expect(result?.observations).toHaveLength(37);
      expect(h?.distinct_values).toBe(30); // Hidden and None are both ""
    });

    it("counts the doc comments and the usage", () => {
      expect(h?.with_doc_comment).toBe(29);
      expect(h?.without_doc_comment).toEqual(["EditComboBox", "SearchComboBox"]);
      expect(h?.used).toBe(25);
      expect([...(h?.unused ?? [])].sort()).toEqual(
        ["Button", "Font", "Hidden", "LODFactorsEdit", "Script", "TopLevelObject"].sort(),
      );
      expect(h?.top5.map((t) => t.member)).toEqual([
        "EditBox",
        "ComboBox",
        "Slider",
        "CheckBox",
        "ResourceNamePicker",
      ]);
      expect(result?.usage.annotations_naming_a_widget).toBe(4265);
      expect(result?.usage.unknown_members).toEqual({});
    });

    it("names the popups and the source each rests on", () => {
      expect(h?.popup_rows.map((p) => `${p.member}:${p.evidence}:${p.confidence}`).sort()).toEqual([
        "ColorPicker:wiki:medium",
        "CurveDialog:name:medium",
        "EditBoxMultiline:doc:high",
        "FileNamePicker:name:medium",
        "ResourceNamePicker:name:medium",
        "ResourcePickerThumbnail:name:medium",
      ]);
    });

    it("cites the pak line verbatim for every row, with no machine path", () => {
      const text = (bytes?.readFile(ATTRIBUTES_FILE) ?? Buffer.alloc(0))
        .toString("utf-8")
        .split(/\r?\n/);
      for (const o of result?.observations ?? []) {
        const m = /^pak:scripts\/Core\/attributes\.c#L(\d+)$/.exec(o.ref);
        expect(m).not.toBeNull();
        expect(text[Number(m![1]) - 1]).toContain(o.quote);
        expect(containsMachinePath(JSON.stringify(o))).toBe(false);
      }
    });

    it("is deterministic over the real index", () => {
      if (!index || !bytes) return;
      const again = observationRows(index, {
        build: REAL_BUILD,
        scripts: bytes,
        wikiRows: wikiRaw ? wikiWidgetRows(wikiRaw.toString("utf-8")) : undefined,
      });
      expect(observationFileText(again, REAL_BUILD)).toBe(
        observationFileText(result as RowsResult, REAL_BUILD),
      );
    });
  },
);
