/**
 * E15 `[Attribute]` scan: argument parsing, plugin-setting and attribute
 * rows, merging, the UIWidgets usage file, determinism, acceptance by the
 * ledger in a temporary census, and (when the E02 source index of build
 * 1.8.0.13 is on this machine) the real counts. Synthetic sources only,
 * parsed by the E02 parser inside the test; no vanilla file is copied into the
 * repository, and planted paths are assembled at run time.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/census/build-ledger.js";
import { jsonlLine, splitLines } from "../../src/census/canon.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { deriveId } from "../../src/census/ids.js";
import { observationHeaderSchema, observationSchema } from "../../src/census/schemas.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  sourceIndexPath,
  type SourceInput,
} from "../../src/census/source-index.js";
import { memoryIo } from "../../scripts/census/cli-common.js";
import * as E02 from "../../scripts/census/enumerators/e02-script-source.js";
import {
  ATTRIBUTE_CLASS,
  GENERATOR,
  PATH_PLACEHOLDER,
  attributeParams,
  attributeSignature,
  classModulesFromIndex,
  classModulesFromObservations,
  classifyWidget,
  headlineCounts,
  observationFileText,
  parseAttributeArgs,
  pluginInfo,
  pluginModule,
  rawAttributeCount,
  resolveOut,
  run,
  scanAttributes,
  sharedPluginIds,
  splitTopLevel,
  stringLiteral,
  uiWidgetMembers,
  uiwidgetsUsage,
  uiwidgetsUsagePath,
  type ScanResult,
} from "../../scripts/census/enumerators/e15-attribute-scan.js";
import { artifactsDir } from "../../scripts/live/paths.js";
import { REAL_CENSUS, makeCensus, writeObservations } from "./helpers.js";

const BUILD = "1.0.0.1";
const src = (path: string, ...lines: string[]): SourceInput => ({
  path,
  text: lines.join("\n") + "\n",
});

// A drive path assembled at run time (the pre-commit gate refuses a literal one).
const DRIVE = ["c:", "Work", "Export"].join("/");

const CORE: SourceInput[] = [
  src(
    "scripts/Core/generated/Attributes/Attribute.c",
    "class Attribute: UniqueAttribute",
    "{",
    "\tstring m_DefValue;",
    '\tvoid Attribute(string defvalue = "", string uiwidget = "auto" , string desc = "", string params = "", ParamEnumArray enums = NULL, string category = "", int precision = 3, typename enumType = void, bool prefabbed = false);',
    "}",
  ),
  src(
    "scripts/Core/attributes.c",
    "class ParamEnumArray: array<ref ParamEnum>",
    "{",
    "\tstatic ParamEnumArray FromEnum(typename e);",
    "}",
    "class UIWidgets",
    "{",
    '\tstatic const string Auto = "auto";',
    '\tstatic const string Hidden = "";',
    '\tstatic const string None = "";',
    '\tstatic const string EditBox = "editbox";',
    '\tstatic const string Slider = "slider";',
    '\tstatic const string ComboBox = "combobox";',
    '\tstatic const string CheckBox = "checkbox";',
    '\tstatic const string Graph = "graph";',
    "}",
  ),
  src(
    "scripts/GameLib/workbench/workbench.c",
    "class WorkbenchPluginAttribute: UniqueAttribute",
    "{",
    '\tvoid WorkbenchPluginAttribute(string name, string description = "", string shortcut = "", string icon = "", array<string> wbModules = null, string category = "", int awesomeFontCode = 0, array<string> resourceTypes = null);',
    "}",
    "class WorkbenchToolAttribute: WorkbenchPluginAttribute",
    "{",
    "}",
    "class WorkbenchPlugin",
    "{",
    "}",
  ),
  src(
    "scripts/GameLib/generated/WorkbenchAPI/WorldEditorTool.c",
    "class WorldEditorTool: WorkbenchPlugin",
    "{",
    "}",
  ),
];

const GAME: SourceInput[] = [
  src(
    "scripts/Game/Things/Thing.c",
    "class Thing",
    "{",
    '\t[Attribute("5", UIWidgets.Slider, "Count, with a comma (and parentheses)", "0 100 1", category: "Cat, egory")]',
    "\tprotected int m_iCount;",
    "",
    '\t[Attribute(defvalue: "x", uiwidget: UIWidgets.EditBox, desc: "Named only")]',
    "\tstring m_sNamed;",
    "",
    '\t[Attribute("a, (b) {c}", desc: "x (y, z)")]',
    "\tstring m_sNested;",
    "",
    '\t[Attribute("1", UIWidgets.ComboBox, "Mode", "", ParamEnumArray.FromEnum(EMode))]',
    "\tEMode m_eMode;",
    "",
    '\t[Attribute("", UIWidgets.Auto, "Several", "", { new ParamEnum("a, b", "1"), ParamEnum("c", "2") }, "Group")]',
    "\tint m_iEnumList;",
    "",
    '\t[Attribute("1", "slider", "Literal widget")]',
    "\tfloat m_fLiteral;",
    "",
    "\t[Attribute()]",
    "\tint m_iBare;",
    "",
    '\t[Attribute("1"), RplProp()]',
    "\tbool m_bFirstOfTwo;",
    "",
    '\t[RplProp(), Attribute("2")]',
    "\tbool m_bSecondOfTwo;",
    "",
    '\t[Attribute(desc: "Also two", defvalue: "7")] int m_iTwoOnALine, m_iSecond;',
    "",
    "\t[RplProp()]",
    "\tint m_iRplOnly;",
    "",
    "\tint m_iPlain;",
    "}",
    "enum EMode { A, B }",
  ),
  src(
    "scripts/Game/Things/Odd.c",
    "class Odd",
    "{",
    '\t[Attribute("1", desc: "by name", "by position")]',
    "\tint m_iTwice;",
    "",
    '\t[Attribute(foo: "1", desc: "ok")]',
    "\tint m_iUnknownNamed;",
    "",
    '\t[Attribute("1", "A text in the widget slot")]',
    "\tint m_iTextInWidgetSlot;",
    "",
    '\t[Attribute("1", UIWidgets.EditBox, SOME_CONSTANT, "", null, "", 3, void, false, "extra")]',
    "\tint m_iTooMany;",
    "",
    '\t[Attribute("", UIWidgets.EditBox, "Empty widget and desc", "", null)]',
    "\tstring m_sNullEnums;",
    "",
    '\t[Attribute("", UIWidgets.EditBox, "")]',
    "\tstring m_sEmptyDesc;",
    "",
    `\t[Attribute("${DRIVE}", UIWidgets.EditBox, "Where")]`,
    "\tstring m_sDrive;",
    "",
    '	[Attribute("1", desc: "Use e.g:")]',
    "\tint m_iEscaped;",
    "",
    "\t[Attribute(",
    '\t\t"1", UIWidgets.CheckBox, "Spread over lines",',
    '\t\t"", null, "Group")]',
    "\tbool m_bMultiLine;",
    "}",
  ),
  src(
    "scripts/Game/Things/Dup.c",
    "class Dup",
    "{",
    "#ifdef VARIANT_A",
    '\t[Attribute("a", desc: "First")]',
    "\tstring m_sVariant;",
    "#else",
    '\t[Attribute("b", desc: "Second")]',
    "\tstring m_sVariant;",
    "#endif",
    "}",
    "modded class Dup",
    "{",
    '\t[Attribute("m", desc: "From the modded class")]',
    "\tstring m_sVariant;",
    '\t[Attribute("n")]',
    "\tstring m_sOnlyModded;",
    "}",
  ),
];

const WORKBENCH: SourceInput[] = [
  src(
    "scripts/WorkbenchGame/WorldEditor/SCR_Helper.c",
    "class SCR_Helper",
    "{",
    '\t[Attribute("1", UIWidgets.CheckBox, "Helper flag")]',
    "\tbool m_bFlag;",
    "}",
  ),
  src(
    "scripts/WorkbenchGame/PlugA.c",
    '[WorkbenchPluginAttribute(name: "A", wbModules: {"WorldEditor"})]',
    "class PlugA: WorkbenchPlugin",
    "{",
    '\t[Attribute("1", UIWidgets.CheckBox, "Flag one", category: "Cat")]',
    "\tbool m_bFlag;",
    "",
    '\t[Attribute("", UIWidgets.EditBox, "Folder")]',
    `\tstring m_sDir = "${DRIVE}";`,
    "}",
    "class PlugChild: PlugA",
    "{",
    '\t[Attribute("3", UIWidgets.Slider, "Inherited from the base plugin", "0 10")]',
    "\tint m_iChild;",
    "}",
    "class PlugGrandChild: PlugChild",
    "{",
    '\t[Attribute("4")]',
    "\tint m_iGrandChild;",
    "}",
  ),
  src(
    "scripts/WorkbenchGame/ToolB.c",
    '[WorkbenchToolAttribute("B", "A tool")]',
    "class ToolB: WorldEditorTool",
    "{",
    '\t[Attribute("0", UIWidgets.CheckBox, "Tool flag")]',
    "\tbool m_bToolFlag;",
    "}",
    '[WorkbenchPluginAttribute("C", wbModules: {"WorldEditor", "ResourceManager"})]',
    "class PlugTwo: WorkbenchPlugin",
    "{",
    '\t[Attribute("1")]',
    "\tint m_iTwo;",
    "}",
    '[WorkbenchPluginAttribute("D", wbModules: {"NoSuchModule"})]',
    "class PlugUnknown: WorkbenchPlugin",
    "{",
    '\t[Attribute("1")]',
    "\tint m_iUnknown;",
    "}",
    '[WorkbenchPluginAttribute("E")]',
    "class PlugNone: WorkbenchPlugin",
    "{",
    '\t[Attribute("1")]',
    "\tint m_iNone;",
    "}",
    "class ToolChild: ToolB",
    "{",
    '\t[Attribute("1")]',
    "\tint m_iToolChild;",
    "}",
    // A plugin base class without the attribute does not make its subclasses plugins.
    "class NotAPlugin: WorkbenchPlugin",
    "{",
    '\t[Attribute("1")]',
    "\tint m_iNotAPlugin;",
    "}",
  ),
];

const INPUTS: SourceInput[] = [...CORE, ...GAME, ...WORKBENCH];

/** `pak:<path>#L<n>` of the nth line of the file whose trimmed text starts with `text`. */
function at(path: string, text: string, nth = 1): string {
  const lines = (INPUTS.find((i) => i.path === path)?.text ?? "").split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++)
    if (lines[i].trim().startsWith(text) && ++seen === nth) return `pak:${path}#L${i + 1}`;
  throw new Error(`no line ${nth} starting with ${text} in ${path}`);
}
const THING = "scripts/Game/Things/Thing.c";
const ODD = "scripts/Game/Things/Odd.c";
const DUP = "scripts/Game/Things/Dup.c";
const PLUG_A = "scripts/WorkbenchGame/PlugA.c";
const oddLines = (INPUTS.find((i) => i.path === ODD)?.text ?? "").split("\n");

function index(inputs: SourceInput[] = INPUTS) {
  return buildSourceIndex(inputs, { build: BUILD });
}

const linesOf = (inputs: SourceInput[]) => (p: string) =>
  inputs.find((s) => s.path === p)?.text.split("\n");

function scan(inputs: SourceInput[] = INPUTS): ScanResult {
  const ix = index(inputs);
  return scanAttributes(ix, { readLines: linesOf(inputs) });
}

const rowOf = (s: ScanResult, id: string) => {
  const r = s.rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}; have ${s.rows.map((x) => x.id).join(", ")}`);
  return r.obs;
};

// ── Arguments ─────────────────────────────────────────────────────────────────

describe("[Attribute] argument parsing", () => {
  it("splits at top-level commas only: strings, parentheses, braces and brackets nest", () => {
    expect(
      splitTopLevel('"a, b", f(1, 2), { x("p, q"), y }, arr[1, 2], "say \\"hi, there\\""').parts,
    ).toEqual(['"a, b"', "f(1, 2)", '{ x("p, q"), y }', "arr[1, 2]", '"say \\"hi, there\\""']);
    expect(splitTopLevel('"a, b').balanced).toBe(false);
    expect(splitTopLevel("f(1, 2").balanced).toBe(false);
    expect(splitTopLevel("1, 2)").balanced).toBe(false);
    expect(splitTopLevel("").parts).toEqual([]);
  });

  it("maps positional and named arguments to the parameters of the Attribute class", () => {
    const names = attributeParams(index());
    expect(names).toEqual([
      "defvalue",
      "uiwidget",
      "desc",
      "params",
      "enums",
      "category",
      "precision",
      "enumType",
      "prefabbed",
    ]);
    expect(
      parseAttributeArgs('"5", UIWidgets.Slider, "A, b (c)", "0 100", category: "Cat"', names),
    ).toEqual({
      values: {
        defvalue: '"5"',
        uiwidget: "UIWidgets.Slider",
        desc: '"A, b (c)"',
        params: '"0 100"',
        category: '"Cat"',
      },
      problems: [],
      count: 5,
    });
    // Named first, positional after: a positional argument keeps its position in the list.
    expect(
      parseAttributeArgs('"0", uiwidget: UIWidgets.ComboBox, "Why", "", ParamEnumArray.FromEnum(E)')
        .values,
    ).toEqual({
      defvalue: '"0"',
      uiwidget: "UIWidgets.ComboBox",
      desc: '"Why"',
      params: '""',
      enums: "ParamEnumArray.FromEnum(E)",
    });
    expect(parseAttributeArgs(undefined)).toEqual({ values: {}, problems: [], count: 0 });
    expect(parseAttributeArgs("   ").values).toEqual({});
  });

  it("reports a parameter given twice, an unknown name, too many arguments and an unclosed string", () => {
    const twice = parseAttributeArgs('"1", desc: "by name", "by position"');
    expect(twice.values).toEqual({ defvalue: '"1"' });
    expect(twice.problems.map((p) => p.kind)).toEqual(["given-twice"]);
    const unknown = parseAttributeArgs('foo: "1", desc: "ok"');
    expect(unknown.values).toEqual({ desc: '"ok"' });
    expect(unknown.problems.map((p) => p.kind)).toEqual(["unknown-named"]);
    const many = parseAttributeArgs("1, 2, 3, 4, 5, 6, 7, 8, 9, 10");
    expect(Object.keys(many.values)).toHaveLength(9);
    expect(many.problems.map((p) => p.kind)).toEqual(["too-many"]);
    const open = parseAttributeArgs('"abc, desc');
    expect(open.values).toEqual({});
    expect(open.problems.map((p) => p.kind)).toEqual(["unbalanced"]);
    expect(parseAttributeArgs('"1", , "x"').problems.map((p) => p.kind)).toEqual([
      "empty-argument",
    ]);
  });

  it("reads string literals raw and classifies widget arguments against the UIWidgets members", () => {
    expect(stringLiteral('"a \\" b"')).toBe('a \\" b');
    expect(stringLiteral('"a" + "b"')).toBeUndefined();
    expect(stringLiteral("SOME_CONSTANT")).toBeUndefined();
    const members = uiWidgetMembers(index());
    expect(members.map((m) => m.name)).toEqual([
      "Auto",
      "Hidden",
      "None",
      "EditBox",
      "Slider",
      "ComboBox",
      "CheckBox",
      "Graph",
    ]);
    expect(classifyWidget("UIWidgets.Slider", members)).toEqual({
      state: "member",
      kind: "Slider",
      form: "symbol",
    });
    expect(classifyWidget('"slider"', members)).toEqual({
      state: "member",
      kind: "Slider",
      form: "literal",
    });
    expect(classifyWidget('""', members)).toEqual({ state: "empty-literal" });
    expect(classifyWidget("UIWidgets.Nope", members)).toEqual({
      state: "other",
      text: "UIWidgets.Nope",
    });
    expect(classifyWidget('"A description"', members)).toMatchObject({ state: "other" });
    expect(classifyWidget(undefined, members)).toEqual({ state: "none" });
    expect(classifyWidget("UIWidgets.Slider", members, true)).toEqual({ state: "unreadable" });
  });

  it("writes the signature from the arguments and withholds a machine path", () => {
    expect(attributeSignature("int m_i", { defvalue: '"5"' }, "Slider")).toBe(
      'int m_i = "5" [UIWidgets.Slider]',
    );
    expect(
      attributeSignature(
        "EMode m_e",
        { defvalue: '"1"', enums: "ParamEnumArray.FromEnum(EMode)", category: '"Cat"' },
        "ComboBox",
      ),
    ).toBe(
      'EMode m_e = "1" [UIWidgets.ComboBox, enums: ParamEnumArray.FromEnum(EMode), category: "Cat"]',
    );
    expect(attributeSignature("int m_i", {}, undefined)).toBe("int m_i");
    expect(attributeSignature("int m_i", { enums: "null" }, undefined)).toBe("int m_i");
    const withheld: string[] = [];
    expect(attributeSignature("string m_s", { defvalue: `"${DRIVE}"` }, undefined, withheld)).toBe(
      `string m_s = ${PATH_PLACEHOLDER}`,
    );
    expect(withheld).toEqual(["defvalue"]);
  });
});

// ── Rows ──────────────────────────────────────────────────────────────────────

describe("rows", () => {
  it("emits one attribute row per [Attribute] member, with signature, what, ref, quote and a null parent outside the Workbench folders", () => {
    const s = scan();
    expect(rowOf(s, "api:Thing#attr:m_iCount")).toEqual({
      dim: "api",
      kind: "attribute",
      module: "none",
      key: { class: "Thing", attr: "m_iCount" },
      parent_key: null,
      label: "m_iCount",
      signature: 'int m_iCount = "5" [UIWidgets.Slider, params: "0 100 1", category: "Cat, egory"]',
      what: "Count, with a comma (and parentheses)",
      origin: "vanilla",
      ref: at(THING, '[Attribute("5"'),
      quote:
        '[Attribute("5", UIWidgets.Slider, "Count, with a comma (and parentheses)", "0 100 1", category: "Cat, egory")]',
      confidence: "high",
    });
    expect(rowOf(s, "api:Thing#attr:m_sNamed")).toMatchObject({
      signature: 'string m_sNamed = "x" [UIWidgets.EditBox]',
      what: "Named only",
      ref: at(THING, "[Attribute(defvalue"),
    });
    // Nested parentheses, braces and commas inside a default and a desc.
    expect(rowOf(s, "api:Thing#attr:m_sNested")).toMatchObject({
      signature: 'string m_sNested = "a, (b) {c}"',
      what: "x (y, z)",
    });
    // An enum source call, and a literal list with commas inside strings.
    expect(rowOf(s, "api:Thing#attr:m_eMode").signature).toBe(
      'EMode m_eMode = "1" [UIWidgets.ComboBox, enums: ParamEnumArray.FromEnum(EMode)]',
    );
    expect(rowOf(s, "api:Thing#attr:m_iEnumList").signature).toBe(
      'int m_iEnumList = "" [UIWidgets.Auto, enums: { new ParamEnum("a, b", "1"), ParamEnum("c", "2") }, category: "Group"]',
    );
    expect(rowOf(s, "api:Thing#attr:m_fLiteral").signature).toBe(
      'float m_fLiteral = "1" [UIWidgets.Slider]',
    );
    expect(rowOf(s, "api:Thing#attr:m_iBare")).toMatchObject({ signature: "int m_iBare" });
    expect(rowOf(s, "api:Thing#attr:m_iBare").what).toBeUndefined();
    // Attribute first or second in the annotation list; several names on one declaration.
    for (const m of ["m_bFirstOfTwo", "m_bSecondOfTwo", "m_iTwoOnALine", "m_iSecond"])
      expect(s.rows.some((r) => r.id === `api:Thing#attr:${m}`)).toBe(true);
    expect(rowOf(s, "api:Thing#attr:m_iSecond")).toMatchObject({
      signature: 'int m_iSecond = "7"',
      what: "Also two",
    });
    // Not [Attribute] members.
    expect(s.rows.some((r) => r.id.includes("m_iRplOnly") || r.id.includes("m_iPlain"))).toBe(
      false,
    );
    expect(s.otherAnnotations).toEqual({ RplProp: 1 });
    expect(s.notOnMembers).toBe(0);
    for (const r of s.rows) {
      expect(() => observationSchema.parse(r.obs)).not.toThrow();
      expect(deriveId(r.obs)).toBe(r.id);
    }
  });

  it("flags what the parser cannot map, keeps the row, and counts the annotation as unreadable", () => {
    const s = scan();
    const twice = rowOf(s, "api:Odd#attr:m_iTwice");
    expect(twice.confidence).toBe("medium");
    expect(twice.what).toBeUndefined();
    expect(twice.signature).toBe('int m_iTwice = "1"');
    expect(twice.unverified).toEqual([
      '[Attribute] argument "desc" is given twice (by position and by name); not read',
    ]);
    expect(rowOf(s, "api:Odd#attr:m_iUnknownNamed")).toMatchObject({
      what: "ok",
      confidence: "medium",
    });
    expect(
      rowOf(s, "api:Odd#attr:m_iTooMany").unverified?.some((c) =>
        /beyond the 9 parameters/.test(c),
      ),
    ).toBe(true);
    expect(s.unreadable.map((u) => [u.id, u.kinds])).toEqual([
      ["api:Odd#attr:m_iTooMany", ["too-many"]],
      ["api:Odd#attr:m_iTwice", ["given-twice"]],
      ["api:Odd#attr:m_iUnknownNamed", ["unknown-named"]],
    ]);
    expect(s.unreadable.find((u) => u.id === "api:Odd#attr:m_iTwice")?.args).toBe(
      '"1", desc: "by name", "by position"',
    );
    // Readable, but not a UIWidgets kind or not a literal: a claim, no kind recorded.
    expect(rowOf(s, "api:Odd#attr:m_iTextInWidgetSlot")).toMatchObject({
      signature: 'int m_iTextInWidgetSlot = "1"',
      confidence: "medium",
    });
    expect(rowOf(s, "api:Odd#attr:m_iTooMany").what).toBeUndefined();
    // null enums, an empty desc and a machine path in a default.
    expect(rowOf(s, "api:Odd#attr:m_sNullEnums").signature).toBe(
      'string m_sNullEnums = "" [UIWidgets.EditBox]',
    );
    expect(rowOf(s, "api:Odd#attr:m_sEmptyDesc").what).toBeUndefined();
    const drive = rowOf(s, "api:Odd#attr:m_sDrive");
    expect(drive.signature).toBe(`string m_sDrive = ${PATH_PLACEHOLDER} [UIWidgets.EditBox]`);
    expect(drive.quote).toBeUndefined();
    expect(s.scrubbed.map((x) => `${x.id} ${x.field}`)).toEqual(
      expect.arrayContaining([
        "api:Odd#attr:m_sDrive signature: defvalue",
        "api:Odd#attr:m_sDrive quote",
      ]),
    );
    // `e.g:` before a closing quote reads as a drive path once the quote is JSON-escaped (`e.g:\"`):
    // the quote line goes, the what stays.
    const esc = rowOf(s, "api:Odd#attr:m_iEscaped");
    expect(esc.quote).toBeUndefined();
    expect(esc.what).toBe("Use e.g:");
    expect(esc.signature).toBe('int m_iEscaped = "1"');
    expect(
      s.scrubbed.filter((x) => x.id === "api:Odd#attr:m_iEscaped").map((x) => x.field),
    ).toEqual(["quote (reads as a path once JSON-escaped)"]);
    expect(containsMachinePath(jsonlLine(esc))).toBe(false);
    // An annotation over several lines: the row cites its first line.
    expect(rowOf(s, "api:Odd#attr:m_bMultiLine")).toMatchObject({
      ref: `pak:${ODD}#L${oddLines.findIndex((l) => l.trim() === "[Attribute(") + 1}`,
      quote: "[Attribute(",
      signature: 'bool m_bMultiLine = "1" [UIWidgets.CheckBox, category: "Group"]',
    });
    expect(s.multiLine).toBe(1);
  });

  it("merges rows that share an id (#ifdef branches, a modded repeat) into the first non-modded declaration", () => {
    const s = scan();
    expect(rowOf(s, "api:Dup#attr:m_sVariant")).toMatchObject({
      signature: 'string m_sVariant = "a"',
      what: "First",
      ref: at(DUP, '[Attribute("a"'),
    });
    expect(s.merges).toEqual([
      {
        id: "api:Dup#attr:m_sVariant",
        count: 3,
        reason: "modded class; #ifdef branches (VARIANT_A / !VARIANT_A / unguarded)",
        refs: [at(DUP, '[Attribute("a"'), at(DUP, '[Attribute("b"'), at(DUP, '[Attribute("m"')],
      },
    ]);
    expect(s.mergedAway).toBe(2);
    expect(s.annotations).toBe(s.rows.length + s.mergedAway);
    expect(rowOf(s, "api:Dup#attr:m_sOnlyModded")).toMatchObject({
      signature: 'string m_sOnlyModded = "n"',
    });
  });

  it("gives a member of a class in a Workbench folder its class row as parent, with E02's module", () => {
    const ix = index();
    const modules = classModulesFromIndex(ix);
    expect(modules.get("SCR_Helper")).toBe("WorldEditor");
    expect(modules.has("Thing")).toBe(false);
    const s = scanAttributes(ix, { readLines: linesOf(INPUTS) });
    expect(rowOf(s, "api:SCR_Helper#attr:m_bFlag")).toMatchObject({
      dim: "api",
      kind: "attribute",
      module: "WorldEditor",
      parent_key: {
        dim: "api",
        kind: "class",
        module: "WorldEditor",
        key: { class: "SCR_Helper" },
      },
    });
    // A given map overrides the recompute: a class absent from it has no parent.
    const bare = scanAttributes(ix, { classModules: new Map(), readLines: linesOf(INPUTS) });
    expect(rowOf(bare, "api:SCR_Helper#attr:m_bFlag")).toMatchObject({
      module: "none",
      parent_key: null,
    });
    // Class rows read back from an E02 observation file agree with the recompute.
    const text = E02.observationFileText(E02.observationRows(ix, linesOf(INPUTS), []), ix, BUILD);
    expect(classModulesFromObservations(text)).toEqual(modules);
  });

  it("makes plugin-setting rows of plugin and tool classes, directly or through a parent class, with the shared module rule", () => {
    const ix = index();
    expect(pluginInfo(ix, "PlugA")).toEqual({
      kind: "plugin",
      module: "WorldEditor",
      direct: true,
      carrier: "PlugA",
    });
    expect(pluginInfo(ix, "ToolB")).toEqual({
      kind: "tool",
      module: "Shared",
      direct: true,
      carrier: "ToolB",
    });
    expect(pluginInfo(ix, "PlugGrandChild")).toEqual({
      kind: "plugin",
      module: "WorldEditor",
      direct: false,
      carrier: "PlugA",
    });
    expect(pluginInfo(ix, "ToolChild")).toMatchObject({
      kind: "tool",
      direct: false,
      carrier: "ToolB",
    });
    expect(pluginInfo(ix, "NotAPlugin")).toBeUndefined();
    expect(pluginInfo(ix, "Thing")).toBeUndefined();
    expect(pluginModule('name: "A", wbModules: {"WorldEditor"}')).toBe("WorldEditor");
    expect(pluginModule('"A", "d", "", "", {"ResourceManager"}')).toBe("ResourceManager");
    expect(pluginModule('"A", wbModules: {"WorldEditor", "ResourceManager"}')).toBe("Shared");
    expect(pluginModule('"A", wbModules: {"NoSuchModule"}')).toBe("Shared");
    expect(pluginModule('"A"')).toBe("Shared");
    expect(pluginModule(undefined)).toBe("Shared");

    const s = scan();
    expect(rowOf(s, "plugin:PlugA#attr:m_bFlag")).toEqual({
      dim: "plugin",
      kind: "plugin-setting",
      module: "WorldEditor",
      key: { class: "PlugA", attr: "m_bFlag" },
      parent_key: {
        dim: "plugin",
        kind: "plugin",
        module: "WorldEditor",
        key: { class: "PlugA" },
      },
      label: "m_bFlag",
      signature: 'bool m_bFlag = "1" [UIWidgets.CheckBox, category: "Cat"]',
      what: "Flag one",
      origin: "vanilla",
      ref: at(PLUG_A, '[Attribute("1", UIWidgets.CheckBox'),
      quote: '[Attribute("1", UIWidgets.CheckBox, "Flag one", category: "Cat")]',
      confidence: "high",
    });
    expect(rowOf(s, "plugin:ToolB#attr:m_bToolFlag")).toMatchObject({
      module: "Shared",
      parent_key: { dim: "plugin", kind: "tool", module: "Shared", key: { class: "ToolB" } },
    });
    expect(rowOf(s, "plugin:PlugTwo#attr:m_iTwo").module).toBe("Shared");
    expect(rowOf(s, "plugin:PlugUnknown#attr:m_iUnknown").module).toBe("Shared");
    expect(rowOf(s, "plugin:PlugNone#attr:m_iNone").module).toBe("Shared");
    // Through a parent class: the ancestor's attribute decides kind and module.
    expect(rowOf(s, "plugin:PlugChild#attr:m_iChild")).toMatchObject({
      dim: "plugin",
      kind: "plugin-setting",
      module: "WorldEditor",
      parent_key: { kind: "plugin", module: "WorldEditor", key: { class: "PlugChild" } },
      signature: 'int m_iChild = "3" [UIWidgets.Slider, params: "0 10"]',
    });
    expect(rowOf(s, "plugin:PlugGrandChild#attr:m_iGrandChild").module).toBe("WorldEditor");
    expect(rowOf(s, "plugin:ToolChild#attr:m_iToolChild")).toMatchObject({
      module: "Shared",
      parent_key: { kind: "tool", key: { class: "ToolChild" } },
    });
    expect(s.inheritedPluginClasses).toEqual(["PlugChild", "PlugGrandChild", "ToolChild"]);
    // The field initialiser is not the attribute's default.
    expect(rowOf(s, "plugin:PlugA#attr:m_sDir").signature).toBe(
      'string m_sDir = "" [UIWidgets.EditBox]',
    );
    // A class that only derives from the plugin base class is not a plugin class.
    expect(rowOf(s, "api:NotAPlugin#attr:m_iNotAPlugin")).toMatchObject({
      dim: "api",
      kind: "attribute",
    });
  });
});

// ── Usage per UIWidgets member ────────────────────────────────────────────────

describe("UIWidgets usage", () => {
  it("counts every member including the unused ones, with three example members each", () => {
    const ix = index();
    const s = scanAttributes(ix, { readLines: linesOf(INPUTS) });
    const u = uiwidgetsUsage(ix, s, BUILD);
    expect(u.members).toBe(8);
    expect(Object.keys(u.kinds)).toEqual([
      "Auto",
      "Hidden",
      "None",
      "EditBox",
      "Slider",
      "ComboBox",
      "CheckBox",
      "Graph",
    ]);
    expect(u.kinds.Slider.uses).toBeGreaterThanOrEqual(3);
    expect(u.kinds.Slider.as_string_literal).toBe(1);
    expect(u.kinds.Slider.examples).toHaveLength(3);
    expect(u.kinds.Slider.examples.map((e) => e.id)).toEqual(
      [...u.kinds.Slider.examples.map((e) => e.id)].sort(),
    );
    expect(u.kinds.EditBox.value).toBe("editbox");
    expect(u.members_unused).toEqual(["Hidden", "None", "Graph"]);
    expect(u.kinds.Graph).toEqual({
      value: "graph",
      uses: 0,
      as_symbol: 0,
      as_string_literal: 0,
      examples: [],
    });
    const used = Object.values(u.kinds).reduce((n, k) => n + k.uses, 0);
    expect(used + u.empty_literal.uses + u.other.uses + u.not_given.uses + u.unreadable.uses).toBe(
      s.annotations,
    );
    expect(u.other.uses).toBe(1);
    expect(u.other.examples[0].text).toBe('"A text in the widget slot"');
    expect(u.unreadable.uses).toBe(0);
    expect(u.attributes).toBe(s.annotations);
    expect(uiwidgetsUsagePath(BUILD, "<dir>")).toBe(
      join("<dir>", "census", BUILD, "E15", "uiwidgets-usage.json"),
    );
  });

  it("counts the headline numbers over the synthetic index", () => {
    const ix = index();
    const s = scanAttributes(ix, { readLines: linesOf(INPUTS) });
    const c = headlineCounts(ix, s);
    expect(c.attributed_members).toBe(s.annotations);
    expect(c.rows).toBe(s.rows.length);
    expect(c.rows_by_kind["plugin-setting"]).toBe(9);
    expect(c.plugin_classes_with_setting).toBe(8);
    expect(c.with_enum_source.enums).toBe(2);
    expect(c.with_enum_source.enumType).toBe(0);
    expect(c.with_category).toBe(4);
    expect(c.uiwidgets_members).toBe(8);
    expect(c.unreadable).toBe(3);
    expect(c.other_annotations_only).toEqual({ members: 1, by_name: { RplProp: 1 } });
    expect(c.global_variables).toBe(0);
    expect(Object.values(c.attributed_members_per_script_module).reduce((a, b) => a + b, 0)).toBe(
      s.annotations,
    );
  });
});

// ── The observation file ──────────────────────────────────────────────────────

describe("observation file", () => {
  const inputs = [
    { path: "<artifacts>/census/1.0.0.1/E02/source-index.jsonl", sha256: "0".repeat(64) },
  ];

  it("is deterministic and carries a valid header", () => {
    const a = observationFileText(scan(), BUILD, inputs);
    const b = observationFileText(scan([...INPUTS].reverse()), BUILD, inputs);
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    const lines = splitLines(a);
    const header = observationHeaderSchema.parse(JSON.parse(lines[0]));
    expect(header).toMatchObject({
      enumerator: "E15",
      generator: GENERATOR,
      provisional: false,
      build: BUILD,
      row_count: lines.length - 1,
    });
    const ids = lines.slice(1).map((l) => deriveId(JSON.parse(l)));
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(a).not.toContain(DRIVE);
  });

  it("names its generator as the universes entry does and keeps to its own dims, kinds and prefixes", () => {
    const u = JSON.parse(readFileSync(join(REAL_CENSUS, "universes.json"), "utf-8")) as {
      enumerators: Record<
        string,
        {
          generator: string;
          dims: string[];
          kinds: string[];
          id_prefixes: string[];
          ref_pattern: string;
        }
      >;
    };
    const e = u.enumerators.E15;
    expect(e.generator).toBe(GENERATOR);
    for (const r of scan().rows) {
      expect(e.dims).toContain(r.obs.dim);
      expect(e.kinds).toContain(r.obs.kind);
      expect(e.id_prefixes.some((p) => r.id.startsWith(p))).toBe(true);
      expect(new RegExp(e.ref_pattern).test(r.obs.ref)).toBe(true);
    }
  });

  it("refuses an --out outside observations/E15/ and stops with NO DATA without a game install", () => {
    const fx = makeCensus(BUILD);
    expect(() =>
      resolveOut(fx.paths, join(fx.root, "observations", "E02", "x.jsonl"), BUILD),
    ).toThrow(/refusing --out/);
    expect(resolveOut(fx.paths, undefined, BUILD)).toBe(
      join(fx.root, "observations", "E15", `${BUILD}.jsonl`),
    );
    const io = memoryIo();
    const empty = mkdtempSync(join(tmpdir(), "e15-nogame-"));
    expect(run(["--data", fx.root, "--game", empty], io)).toBe(2);
    expect(io.stdout()).toMatch(/^NO DATA/);
    expect(existsSync(join(fx.root, "observations", "E15"))).toBe(false);
    const help = memoryIo();
    expect(run(["--help"], help)).toBe(0);
    expect(help.stdout()).toMatch(/usage: e15-attribute-scan/);
  });

  it("counts raw [Attribute tokens the way the index counts annotations", () => {
    const text = INPUTS.map((s) => s.text).join("\n");
    const ix = index();
    // One annotation can head several declarators (`int a, b;`): count each source line once.
    const annotations = new Set<string>();
    for (const r of ix.records)
      for (const a of "attributes" in r ? r.attributes : [])
        if (a.name === ATTRIBUTE_CLASS) annotations.add(`${r.file}#${a.line}`);
    expect(annotations.size).toBeGreaterThan(20);
    expect(rawAttributeCount(text)).toBe(annotations.size);
    expect(rawAttributeCount('// [Attribute("x")]\nclass A { /* [Attribute()] */ int m; }')).toBe(
      0,
    );
  });
});

// ── Plugin-row ids shared with other enumerators ──────────────────────────────

describe("plugin-setting ids shared with E03 and E17", () => {
  it("counts the shared ids and reports a disagreement on dim, kind or module", () => {
    const s = scan();
    const row = (id: string, module: string, kind = "plugin-setting") =>
      JSON.stringify({
        dim: "plugin",
        kind,
        module,
        key: { class: id.split("#attr:")[0].replace("plugin:", ""), attr: id.split("#attr:")[1] },
        origin: "vanilla",
        ref: "pak:scripts/x.c#L1",
        confidence: "high",
      });
    expect(sharedPluginIds(s, undefined)).toEqual({ present: false, shared: 0, disagree: [] });
    const text = [
      JSON.stringify({ $header: 1 }),
      row("plugin:PlugA#attr:m_bFlag", "WorldEditor"),
      row("plugin:ToolB#attr:m_bToolFlag", "WorldEditor"),
      row("plugin:Other#attr:m_x", "Shared"),
    ].join("\n");
    expect(sharedPluginIds(s, text)).toEqual({
      present: true,
      shared: 2,
      disagree: [
        "plugin:ToolB#attr:m_bToolFlag: plugin/plugin-setting/Shared vs plugin/plugin-setting/WorldEditor",
      ],
    });
  });
});

// ── Ledger acceptance ─────────────────────────────────────────────────────────

describe("ledger acceptance in a temporary census", () => {
  const pluginClasses = [
    ["PlugA", "plugin", "WorldEditor"],
    ["PlugChild", "plugin", "WorldEditor"],
    ["PlugGrandChild", "plugin", "WorldEditor"],
    ["ToolB", "tool", "Shared"],
    ["ToolChild", "tool", "Shared"],
    ["PlugTwo", "plugin", "Shared"],
    ["PlugUnknown", "plugin", "Shared"],
    ["PlugNone", "plugin", "Shared"],
  ] as const;

  function census(withE03: boolean) {
    const fx = makeCensus(BUILD);
    const ix = index();
    const e02 = E02.observationRows(ix, linesOf(INPUTS), []);
    mkdirSync(join(fx.root, "observations", "E02"), { recursive: true });
    writeFileSync(
      join(fx.root, "observations", "E02", `${BUILD}.jsonl`),
      E02.observationFileText(e02, ix, BUILD),
    );
    const s = scanAttributes(ix, { readLines: linesOf(INPUTS) });
    mkdirSync(join(fx.root, "observations", "E15"), { recursive: true });
    writeFileSync(
      join(fx.root, "observations", "E15", `${BUILD}.jsonl`),
      observationFileText(s, BUILD, []),
    );
    if (withE03) {
      // Stand-in for E03, which owns the plugin and tool rows.
      writeObservations(
        fx,
        "E03",
        BUILD,
        pluginClasses.map(([cls, kind, module]) => ({
          dim: "plugin",
          kind,
          module,
          key: { class: cls },
          parent_key: null,
          origin: "vanilla",
          ref: "pak:scripts/WorkbenchGame/PlugA.c#L2",
          confidence: "high",
        })),
      );
    }
    return { fx, s };
  }

  it("has no rejected line and no problem once E03's plugin rows exist", () => {
    const { fx, s } = census(true);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems).toEqual([]);
    const attr = built.rows.filter((r) => r.kind === "attribute");
    const settings = built.rows.filter((r) => r.kind === "plugin-setting");
    expect(attr.length + settings.length).toBe(s.rows.length);
    expect(settings.every((r) => r.parent?.startsWith("plugin:"))).toBe(true);
    expect(built.rows.find((r) => r.id === "api:SCR_Helper#attr:m_bFlag")).toMatchObject({
      shard: "attribute",
      parent: "api:SCR_Helper",
      module: "WorldEditor",
    });
    expect(built.rows.find((r) => r.id === "api:Thing#attr:m_iCount")).toMatchObject({
      shard: "attribute",
      parent: null,
      module: "none",
      what: "Count, with a comma (and parentheses)",
    });
    expect(built.rows.find((r) => r.id === "plugin:PlugChild#attr:m_iChild")).toMatchObject({
      parent: "plugin:PlugChild",
      kind: "plugin-setting",
      module: "WorldEditor",
    });
    // The unreadable-argument claim reaches the row.
    expect(built.rows.find((r) => r.id === "api:Odd#attr:m_iTwice")?.unverified).toEqual([
      { claim: '[Attribute] argument "desc" is given twice (by position and by name); not read' },
    ]);
  });

  it("without E03's file the only problems are the missing plugin parents, and they name E15 rows", () => {
    const { fx } = census(false);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems.length).toBeGreaterThan(0);
    for (const p of built.problems) {
      expect(p.message).toMatch(/parent plugin:\w+ has no row$/);
      expect(p.id).toMatch(/^plugin:\w+#attr:/);
    }
  });
});

// ── The real build ────────────────────────────────────────────────────────────

const REAL_BUILD = "1.8.0.13";
const realIndexFile = (() => {
  try {
    return sourceIndexPath(REAL_BUILD, artifactsDir());
  } catch {
    return "";
  }
})();

describe.skipIf(!realIndexFile || !existsSync(realIndexFile))(
  "E15 on the E02 source index of build 1.8.0.13",
  () => {
    it("reproduces the headline counts", () => {
      const ix = loadSourceIndex(REAL_BUILD, { file: realIndexFile })!;
      const modules = classModulesFromIndex(ix);
      const s = scanAttributes(ix, { classModules: modules });
      const c = headlineCounts(ix, s);

      expect(c.member_variables).toBe(30803);
      expect(c.global_variables).toBe(122);
      expect(c.attributed_members).toBe(9686);
      expect(c.attributed_members_per_script_module).toEqual({
        Autotest: 12,
        Game: 8714,
        GameCode: 97,
        GameLib: 93,
        Workbench: 14,
        WorkbenchCommon: 30,
        WorkbenchGame: 610,
        WorkbenchGameCommon: 116,
      });
      expect(Object.keys(c.files_per_script_module)).toHaveLength(9);
      // Every attribute the index holds is a row, or repeats another row's id.
      expect(c.rows + c.merged_away).toBe(9686);
      expect(c.merged_away).toBe(3);
      expect(c.rows).toBe(9683);
      expect(c.rows_by_kind).toEqual({ attribute: 9163, "plugin-setting": 520 });
      expect(c.classes_with_attribute).toBe(2712);
      expect(c.plugin_classes_with_setting).toBe(86);
      expect(c.inherited_plugin_classes).toEqual([]);
      expect(c.with_desc).toBe(6295);
      expect(c.with_uiwidget).toBe(4243);
      expect(c.with_enum_source).toEqual({ enums: 796, enumType: 174, either: 970 });
      expect(c.with_category).toBe(1748);
      expect(c.uiwidgets_members).toBe(31);
      expect(c.unreadable).toBe(26);
      expect(c.unreadable_by_kind).toEqual({ "given-twice": 26 });
      expect(c.attribute_not_on_members).toBe(0);
      expect(c.other_annotations_only.members).toBe(171);

      const u = uiwidgetsUsage(ix, s, REAL_BUILD);
      expect(u.members).toBe(31);
      expect(Object.keys(u.kinds)).toHaveLength(31);
      expect(u.members_unused).toEqual([
        "Hidden",
        "Font",
        "Button",
        "Script",
        "LODFactorsEdit",
        "TopLevelObject",
      ]);
      expect(u.kinds.EditBox.uses).toBe(827);
      expect(u.kinds.ComboBox.uses).toBe(724);
      expect(Object.values(u.kinds).every((k) => k.examples.length === Math.min(3, k.uses))).toBe(
        true,
      );
      expect(
        Object.values(u.kinds).reduce((n, k) => n + k.uses, 0) +
          u.empty_literal.uses +
          u.other.uses +
          u.not_given.uses +
          u.unreadable.uses,
      ).toBe(9686);

      // No row carries a machine path; every row validates and derives a distinct id.
      const ids = new Set<string>();
      for (const r of s.rows) {
        expect(() => observationSchema.parse(r.obs)).not.toThrow();
        expect(deriveId(r.obs)).toBe(r.id);
        ids.add(r.id);
        expect(containsMachinePath(jsonlLine(r.obs))).toBe(false);
      }
      expect(ids.size).toBe(s.rows.length);
    });

    it("assigns the class module exactly as E02's observation file does", () => {
      const e02File = join(REAL_CENSUS, "observations", "E02", `${REAL_BUILD}.jsonl`);
      if (!existsSync(e02File)) return;
      const ix = loadSourceIndex(REAL_BUILD, { file: realIndexFile })!;
      const fromFile = classModulesFromObservations(readFileSync(e02File, "utf-8"));
      const fromIndex = classModulesFromIndex(ix);
      expect(fromFile.size).toBeGreaterThan(0);
      expect(fromIndex.size).toBe(fromFile.size);
      for (const [cls, m] of fromIndex) expect(fromFile.get(cls)).toBe(m);
      // And every plugin and tool class has the module the shared rule gives.
      expect(pluginInfo(ix, "SCR_EntityFlagsManagerPlugin")?.module).toBe("WorldEditor");
    });
  },
);
