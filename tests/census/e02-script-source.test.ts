/**
 * E02 script-source index: the Enforce declaration parser, the source index
 * (build, save, load, lookups), the Workbench-scope observation rows, their
 * acceptance by the ledger, determinism, and (when the game is installed)
 * the headline counts of build 1.8.0.13. Synthetic sources only; no vanilla
 * file is copied into the repository.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/census/build-ledger.js";
import {
  firstSentence,
  parseEnforceSource,
  type ClassRecord,
  type EnumValueRecord,
  type FieldRecord,
  type MethodRecord,
} from "../../src/census/enforce-source.js";
import {
  buildSourceIndex,
  classChain,
  declarationsInFile,
  defaultArtifactsDir,
  findClass,
  loadSourceIndex,
  lookupSymbol,
  methodsOf,
  parseSourceIndexText,
  saveSourceIndex,
  sourceIndexText,
  type SourceInput,
} from "../../src/census/source-index.js";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import * as E02 from "../../scripts/census/enumerators/e02-script-source.js";
import {
  EXPECTED_PARSE_FAILURES,
  GENERATOR,
  HELPER_CLASSES,
  attributeModules,
  headlineCounts,
  inWorkbenchScope,
  observationFileText,
  observationRows,
  pathModule,
  undocumentedPath,
  undocumentedReport,
} from "../../scripts/census/enumerators/e02-script-source.js";
import { artifactsDir } from "../../scripts/live/paths.js";
import { makeCensus } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

const one = (file: string, text: string) => parseEnforceSource(file, text);
const methods = (r: ReturnType<typeof one>): MethodRecord[] =>
  r.records.filter((x): x is MethodRecord => x.kind === "method" || x.kind === "function");
const method = (r: ReturnType<typeof one>, name: string): MethodRecord => {
  const m = methods(r).find((x) => x.name === name);
  if (!m) throw new Error(`no method ${name}`);
  return m;
};
const cls = (r: ReturnType<typeof one>, name: string): ClassRecord => {
  const c = r.records.find((x): x is ClassRecord => x.kind === "class" && x.name === name);
  if (!c) throw new Error(`no class ${name}`);
  return c;
};

// ── Parser ────────────────────────────────────────────────────────────────────

describe("enforce-source parser", () => {
  it("reads classes with parents, generics, extends, sealed and forward declarations", () => {
    const r = one(
      "scripts/Game/a.c",
      [
        "class Fwd;",
        "class Box<Class T, Class U> : Managed",
        "{",
        "\tref array<ref T> m_Items;",
        "}",
        "sealed class Leaf extends Box<int, string> {}",
        "class IntList : array<int> {};",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(cls(r, "Fwd").forward).toBe(true);
    const box = cls(r, "Box");
    expect(box.generics).toEqual(["Class T", "Class U"]);
    expect(box.parent).toBe("Managed");
    expect(box.end_line).toBe(5);
    expect(box.signature).toBe("class Box<Class T, Class U> : Managed");
    const leaf = cls(r, "Leaf");
    expect(leaf).toMatchObject({
      sealed: true,
      parent: "Box<int, string>",
      parent_name: "Box",
      line: 6,
    });
    expect(cls(r, "IntList").parent_name).toBe("array");
    const f = r.records.find((x): x is FieldRecord => x.kind === "field");
    expect(f).toMatchObject({ owner: "Box", name: "m_Items", type: "ref array<ref T>", line: 4 });
    expect(r.script_module).toBe("Game");
  });

  it("records a modded class as modifying its class, and the merged view joins both", () => {
    const base: SourceInput = {
      path: "scripts/Game/base.c",
      text: "class Base\n{\n\tvoid A();\n\tint B(int x);\n}\nclass Mid : Base\n{\n\tvoid C();\n}\n",
    };
    const mod: SourceInput = {
      path: "scripts/Game/mod.c",
      text: "modded class Base\n{\n\toverride int B(int x);\n\tvoid D(string s, int n);\n}\n",
    };
    const ix = buildSourceIndex([mod, base], { build: "t" });
    const m = cls(parseEnforceSource(mod.path, mod.text), "Base");
    expect(m).toMatchObject({ modded: true, modifies: "Base" });
    const merged = findClass(ix, "Base");
    expect(merged?.declarations.map((d) => d.modded)).toEqual([false, true]);
    expect(merged?.methods.map((x) => `${x.name}/${x.arity}`)).toEqual([
      "A/0",
      "B/1",
      "B/1",
      "D/2",
    ]);
    const viaMid = methodsOf(ix, "Mid");
    expect(viaMid.map((v) => `${v.method.name}:${v.declared_in}:${v.inherited}`)).toEqual([
      "C:Mid:false",
      "A:Base:true",
      "B:Base:true",
      "B:Base:true",
      "D:Base:true",
    ]);
    expect(classChain(ix, "Mid").map((c) => c.name)).toEqual(["Mid", "Base"]);
    expect(declarationsInFile(ix, mod.path).map((x) => x.kind)).toEqual([
      "class",
      "method",
      "method",
    ]);
  });

  it("reads enums with explicit values, expressions and trailing doc comments", () => {
    const r = one(
      "scripts/Core/e.c",
      [
        "//! Flags of a thing.",
        "enum EFlags : int",
        "{",
        "\tNONE,           //!< nothing set",
        "\tA = 0x01,",
        "\tB = (1 << 2) | A, //!< shifted, then or-ed",
        "\tC = Max(1, 2),",
        "}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    const e = r.records.find((x) => x.kind === "enum");
    expect(e).toMatchObject({
      name: "EFlags",
      base: "int",
      value_count: 4,
      doc: "Flags of a thing.",
    });
    const vals = r.records.filter((x): x is EnumValueRecord => x.kind === "enum-value");
    expect(vals.map((v) => [v.name, v.value, v.ordinal])).toEqual([
      ["NONE", undefined, 0],
      ["A", "0x01", 1],
      ["B", "(1 << 2) | A", 2],
      ["C", "Max(1, 2)", 3],
    ]);
    expect(vals[0].doc).toBe("nothing set");
    expect(vals[1].doc).toBeUndefined();
    expect(vals[2].doc).toBe("shifted, then or-ed");
    expect(vals[2].signature).toBe("B = (1 << 2) | A");
  });

  it("keeps every declaration and parameter modifier, arity and exact signature", () => {
    const r = one(
      "scripts/Core/m.c",
      [
        "class M",
        "{",
        "\tstatic proto native external bool S(notnull out array<ref Foo> list, inout int n, const float f = 1.0);",
        "\tprivate void ~M();",
        "\tprotected override event void OnX();",
        "\tsealed volatile void V() {}",
        "\tproto native owned external string Owned();",
        "\tnotnull Foo NN();",
        "\tstatic const int K = 5, L = 6;",
        "\tvoid M();",
        "\tvoid Arr(vector[] t, float m[4], void data = NULL, ...);",
        "}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    const s = method(r, "S");
    expect(s.modifiers).toEqual(["static", "proto", "native", "external"]);
    expect(s.return_type).toBe("bool");
    expect(s.params).toEqual([
      { name: "list", type: "array<ref Foo>", modifiers: ["notnull", "out"] },
      { name: "n", type: "int", modifiers: ["inout"] },
      { name: "f", type: "float", modifiers: ["const"], default: "1.0" },
    ]);
    expect([s.arity, s.required, s.has_body]).toEqual([3, 2, false]);
    expect(s.signature).toBe(
      "static proto native external bool S(notnull out array<ref Foo> list, inout int n, const float f = 1.0)",
    );
    expect(method(r, "~M")).toMatchObject({
      is_destructor: true,
      modifiers: ["private"],
      arity: 0,
    });
    expect(method(r, "OnX").modifiers).toEqual(["protected", "override", "event"]);
    expect(method(r, "V")).toMatchObject({ modifiers: ["sealed", "volatile"], has_body: true });
    expect(method(r, "Owned").modifiers).toEqual(["proto", "native", "owned", "external"]);
    expect(method(r, "NN")).toMatchObject({ modifiers: ["notnull"], return_type: "Foo" });
    expect(method(r, "M").is_constructor).toBe(true);
    const arr = method(r, "Arr");
    expect(arr.params.map((p) => [p.type, p.name, p.array, p.default])).toEqual([
      ["vector[]", "t", undefined, undefined],
      ["float", "m", "[4]", undefined],
      ["void", "data", undefined, "NULL"],
    ]);
    expect([arr.arity, arr.variadic]).toEqual([3, true]);
    const fields = r.records.filter((x): x is FieldRecord => x.kind === "field");
    expect(fields.map((f) => [f.name, f.init, f.modifiers])).toEqual([
      ["K", "5", ["static", "const"]],
      ["L", "6", ["static", "const"]],
    ]);
  });

  it("keeps default values that contain commas, parentheses, braces and generics", () => {
    const r = one(
      "scripts/Core/d.c",
      [
        "class D",
        "{",
        '\tvoid F(string s = "a, b) {x}", vector v = Vector(0, 1, 0), int n = Max(Min(1, 2), 3), map<string, int> m = new map<string, int>(), array<int> a = {1, 2});',
        "}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    const f = method(r, "F");
    expect(f.params.map((p) => p.default)).toEqual([
      '"a, b) {x}"',
      "Vector(0, 1, 0)",
      "Max(Min(1, 2), 3)",
      "new map<string, int>()",
      "{1, 2}",
    ]);
    expect(f.params[3].type).toBe("map<string, int>");
    expect(f.arity).toBe(5);
  });

  it("attaches attribute annotations with nested parentheses and strings to the next declaration", () => {
    const r = one(
      "scripts/WorkbenchGame/WorldEditor/P.c",
      [
        '[WorkbenchPluginAttribute(name: "My (cool) plugin", wbModules: {"WorldEditor"}, shortcut: "Ctrl+]")]',
        "class P : WorkbenchPlugin",
        "{",
        '\t[Attribute("0", UIWidgets.ComboBox, "desc ] with, commas (and parens)", "", ParamEnumArray.FromEnum(EFoo))]',
        "\tprotected int m_Mode;",
        '\t[RplProp(onRplName: "OnX"), RplRpc]',
        "\tint m_Repl;",
        '\t[ButtonAttribute("Go")]',
        "\tvoid Go() {}",
        "}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    const p = cls(r, "P");
    expect(p.attributes).toEqual([
      {
        name: "WorkbenchPluginAttribute",
        args: 'name: "My (cool) plugin", wbModules: {"WorldEditor"}, shortcut: "Ctrl+]"',
        line: 1,
      },
    ]);
    expect(attributeModules(p.attributes[0].args)).toEqual(["WorldEditor"]);
    expect(attributeModules('"N", "d", "", "", {"ResourceManager", "WorldEditor"}')).toEqual([
      "ResourceManager",
      "WorldEditor",
    ]);
    const fields = r.records.filter((x): x is FieldRecord => x.kind === "field");
    expect(fields[0].attributes[0]).toMatchObject({
      name: "Attribute",
      args: '"0", UIWidgets.ComboBox, "desc ] with, commas (and parens)", "", ParamEnumArray.FromEnum(EFoo)',
    });
    expect(fields[1].attributes.map((a) => [a.name, a.args])).toEqual([
      ["RplProp", 'onRplName: "OnX"'],
      ["RplRpc", undefined],
    ]);
    expect(method(r, "Go").attributes[0]).toMatchObject({ name: "ButtonAttribute", args: '"Go"' });
  });

  it("is not fooled by braces and comment markers in strings or comments", () => {
    const r = one(
      "scripts/Game/c.c",
      [
        "/* class Fake { void Nope(); } */",
        "// class Fake2 {",
        "class Real",
        "{",
        '\tstring m_S = "}{ // not a comment /* nor this */";',
        "\tvoid Body()",
        "\t{",
        '\t\tstring t = "{{{"; // }',
        "\t\t/* } } */",
        '\t\tif (true) { Print("}"); }',
        "\t}",
        "\tvoid After();",
        "}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(r.records.filter((x) => x.kind === "class").map((x) => x.name)).toEqual(["Real"]);
    expect(methods(r).map((m) => m.name)).toEqual(["Body", "After"]);
    const f = r.records.find((x): x is FieldRecord => x.kind === "field");
    expect(f?.init).toBe('"}{ // not a comment /* nor this */"');
  });

  it("records #ifdef / #ifndef / #else guards, nested, on every declaration", () => {
    const r = one(
      "scripts/GameLib/g.c",
      [
        "#ifdef WORKBENCH",
        "class G",
        "{",
        "#ifdef DOXYGEN",
        "\tvoid Doc();",
        "#else",
        "\tvoid Real();",
        "#endif",
        "#ifndef SERVER",
        "\tvoid Client();",
        "#endif // SERVER",
        "}",
        "#endif",
        "class Free {}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(cls(r, "G").guards).toEqual(["WORKBENCH"]);
    expect(method(r, "Doc").guards).toEqual(["WORKBENCH", "DOXYGEN"]);
    expect(method(r, "Real").guards).toEqual(["WORKBENCH", "!DOXYGEN"]);
    expect(method(r, "Client").guards).toEqual(["WORKBENCH", "!SERVER"]);
    expect(cls(r, "Free").guards).toEqual([]);
  });

  it("flags a /endcode doc typo without letting it swallow any declaration", () => {
    const r = one(
      "scripts/Core/t.c",
      [
        "class T",
        "{",
        "\t/*!",
        "\tFirst one.",
        "\t\\code",
        "\t\tFirst();",
        "\t/endcode",
        "\t*/",
        "\tproto external bool First();",
        "\t//! Second one.",
        "\tproto external bool Second();",
        "\t/*!",
        "\t\\code",
        "\t\tThird();",
        "\t\\endcode",
        "\t*/",
        "\tproto external bool Third();",
        "}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(methods(r).map((m) => [m.name, m.line])).toEqual([
      ["First", 9],
      ["Second", 11],
      ["Third", 17],
    ]);
    expect(method(r, "Second").doc).toBe("Second one.");
    expect(firstSentence(method(r, "First").doc)).toBe("First one.");
    expect(r.doc_warnings).toEqual([
      { line: 3, message: expect.stringContaining("(written `/endcode`)") },
    ]);
  });

  it("does not take a file-level grouping comment or a separated comment as a doc", () => {
    const r = one(
      "scripts/Core/w.c",
      [
        "/*!",
        "\\addtogroup WorkbenchAPI",
        "\\{",
        "*/",
        "",
        "class W",
        "{",
        "\t// plain",
        "\tvoid A();",
        "}",
      ].join("\n"),
    );
    expect(cls(r, "W").doc).toBeUndefined();
    expect(method(r, "A").doc).toBeUndefined();
  });

  it("accepts what the engine accepts, as warnings: missing ';', stray ';', trailing comma, extra '>', omitted type, unclosed #ifdef", () => {
    const r = one(
      "scripts/Game/w.c",
      [
        "class W",
        "{",
        "\tstring m_NoSemi",
        "\t[Attribute()];",
        "\tint m_Attr;",
        "\tref array<string>> m_Extra;",
        "\tstatic ref s_Gen = new Gen();",
        "\tvoid F(int a, int b,",
        "\t);",
        "\tvoid G()",
        "\t{",
        "\t\t#ifdef CHECKS",
        "\t\tPrint(1);",
        "\t}",
        "}",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message.split(" ").slice(0, 2).join(" "))).toEqual([
      "#ifdef without",
      'missing ";"',
      'stray ";"',
      'extra ">"',
      "type omitted",
      "trailing comma",
    ]);
    expect(method(r, "F").arity).toBe(2);
    expect(r.records.filter((x) => x.kind === "field").map((x) => x.name)).toEqual([
      "m_NoSemi",
      "m_Attr",
      "m_Extra",
      "s_Gen",
    ]);
  });

  it("reports what it cannot read and recovers at the next statement", () => {
    const r = one(
      "scripts/Game/bad.c",
      "class A\n{\n\tTHIS IS NOT CODE;\n\tvoid Ok();\n}\nclass B {}\n",
    );
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].line).toBe(3);
    expect(methods(r).map((m) => m.name)).toEqual(["Ok"]);
    expect(r.records.filter((x) => x.kind === "class").map((x) => x.name)).toEqual(["A", "B"]);
  });

  it("does not let recovery from non-code under an #ifdef swallow the declaration after #endif", () => {
    const r = one(
      "scripts/Game/game.c",
      [
        "#ifdef BREAK_COMPILATION",
        "THIS DEFINE BREAKS COMPILATION",
        "DO NOT REMOVE IT, IT IS NEEDED",
        "#endif",
        "",
        "//! Flags as a bit mask",
        "enum EFlags",
        "{",
        "\tA = 1,",
        "\tB = 2",
        "};",
        "class After {}",
        "#ifdef X",
        "void Broken(int a,",
        "#else",
        "void Fine();",
        "#endif",
      ].join("\n"),
    );
    // The second error is reported where the parse failed (inside the #else
    // branch); recovery then rewinds to the first token of that branch.
    expect(r.errors.map((e) => e.line)).toEqual([2, 16]);
    expect(r.records.map((x) => [x.kind, x.name, x.line])).toEqual([
      ["enum", "EFlags", 7],
      ["enum-value", "A", 9],
      ["enum-value", "B", 10],
      ["class", "After", 12],
      ["function", "Fine", 16],
    ]);
    expect(r.records[0].doc).toBe("Flags as a bit mask");
  });

  it("reads typedefs and global functions", () => {
    const r = one(
      "scripts/GameLib/f.c",
      'typedef func Cb;\nvoid Cb(ResourceName r, string p = "");\ntypedef map<string, int> TMap;\nint g_Count;\n',
    );
    expect(r.errors).toEqual([]);
    expect(r.records.map((x) => [x.kind, x.name])).toEqual([
      ["typedef", "Cb"],
      ["function", "Cb"],
      ["typedef", "TMap"],
      ["variable", "g_Count"],
    ]);
  });

  it("takes the first sentence of a doc comment", () => {
    expect(firstSentence("Check whether user created an entity. Eg. drag and drop.")).toBe(
      "Check whether user created an entity.",
    );
    expect(firstSentence("\\brief Does e.g. this thing. Then more.")).toBe("Does e.g. this thing.");
    expect(firstSentence("No period here\n\\param x the x")).toBe("No period here");
    expect(firstSentence("\\param x only params")).toBeUndefined();
  });
});

// ── Source index and observation rows ────────────────────────────────────────

const SCOPE_INPUTS: SourceInput[] = [
  {
    path: "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c",
    text: [
      "sealed class WorldEditorAPI",
      "{",
      "\tprivate void WorldEditorAPI();",
      "\t//! Beginning of logical edit action.",
      "\tproto external bool BeginEntityAction(string name = string.Empty, string icon = string.Empty);",
      "\tproto external int GetSelectedEntitiesCount();",
      "}",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Workbench.c",
    text: [
      "#ifdef WORKBENCH",
      "sealed class Workbench",
      "{",
      "\tstatic proto WBModuleDef GetModule(typename type);",
      "\tstatic proto void Exit(int exitCode);",
      "}",
      "#endif",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Modules/WBModuleDef.c",
    text: "class WBModuleDef\n{\n\tproto external bool Save();\n\tevent void OnAfterLoad();\n}\nenum EMode\n{\n\tA,\n\tB = 2\n}\n",
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Modules/DialogueEditor.c",
    text: "class DialogueEditor : WBModuleDef\n{\n\tproto external int GetCurrentNode();\n}\n",
  },
  {
    path: "scripts/WorkbenchGame/ResourceManager/Thing.c",
    text: [
      '[WorkbenchPluginAttribute(name: "Thing", wbModules: {"ScriptEditor"})]',
      "class ThingPlugin : WorkbenchPlugin",
      "{",
      "#ifdef A",
      "\tvoid Run(int x);",
      "#else",
      "\tvoid Run(int y);",
      "#endif",
      "\tvoid Add(string a, int b);",
      "\tvoid Add(string a, float b);",
      "\tint m_Field;",
      "}",
      "class Helper",
      "{",
      "\tstatic void Do();",
      "}",
    ].join("\n"),
  },
  {
    path: "scripts/WorkbenchGame/ResourceManager/Mod.c",
    text: "modded class Helper\n{\n\tstatic void Do();\n\tvoid More();\n}\n",
  },
  { path: "scripts/Game/OutOfScope.c", text: "class Outside\n{\n\tvoid NotARow();\n}\n" },
];

function fixtureIndex() {
  return buildSourceIndex(SCOPE_INPUTS, { build: "1.0.0.1" });
}
const linesOf = (p: string): string[] | undefined =>
  SCOPE_INPUTS.find((s) => s.path === p)?.text.split("\n");

describe("source index and Workbench-scope rows", () => {
  it("decides scope and module from the folders", () => {
    expect(inWorkbenchScope("scripts/Workbench/X.c")).toBe(true);
    expect(inWorkbenchScope("scripts/WorkbenchCommon/X.c")).toBe(true);
    expect(inWorkbenchScope("scripts/Core/generated/Math/Math.c")).toBe(false);
    expect(inWorkbenchScope("scripts/Game/Workbench.c")).toBe(false);
    expect(pathModule("scripts/WorkbenchGame/WorldEditor/Helpers/H.c")).toBe("WorldEditor");
    expect(pathModule("scripts/GameLib/generated/WorkbenchAPI/Modules/ScriptEditor.c")).toBe(
      "ScriptEditor",
    );
    expect(
      pathModule("scripts/GameLib/generated/WorkbenchAPI/Plugins/ResourceManagerPlugin.c"),
    ).toBe("ResourceManager");
    expect(pathModule("scripts/WorkbenchGameCommon/NetApiDocs.c")).toBeUndefined();
  });

  it("emits one row per key, merges #ifdef pairs, overloads and modded repeats, and leaves out what has no row kind", () => {
    const ix = fixtureIndex();
    const rows = observationRows(ix, linesOf, []);
    const ids = rows.observations.map((o) => o.id);
    expect(ids).toEqual([
      "api:DialogueEditor",
      "api:DialogueEditor.GetCurrentNode/0",
      "api:EMode",
      "api:EMode.A",
      "api:EMode.B",
      "api:Helper",
      "api:Helper.Do/0",
      "api:Helper.More/0",
      "api:ThingPlugin",
      "api:ThingPlugin.Add/2",
      "api:ThingPlugin.Run/1",
      "api:WBModuleDef",
      "api:WBModuleDef.OnAfterLoad/0",
      "api:WBModuleDef.Save/0",
      "api:Workbench",
      "api:Workbench.Exit/1",
      "api:Workbench.GetModule/1",
      "api:WorldEditorAPI",
      "api:WorldEditorAPI.BeginEntityAction/2",
      "api:WorldEditorAPI.GetSelectedEntitiesCount/0",
      "api:WorldEditorAPI.WorldEditorAPI/0",
    ]);
    const by = (id: string) => rows.observations.find((o) => o.id === id)!.obs;
    expect(by("api:Workbench.GetModule/1").kind).toBe("static-method");
    expect(by("api:WBModuleDef.OnAfterLoad/0").kind).toBe("event");
    expect(by("api:WorldEditorAPI").module).toBe("WorldEditor");
    expect(by("api:WorldEditorAPI.BeginEntityAction/2")).toMatchObject({
      module: "WorldEditor",
      what: "Beginning of logical edit action.",
      ref: "pak:scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c#L5",
      signature:
        "proto external bool BeginEntityAction(string name = string.Empty, string icon = string.Empty)",
      parent_key: {
        dim: "api",
        kind: "class",
        module: "WorldEditor",
        key: { class: "WorldEditorAPI" },
      },
      confidence: "high",
    });
    expect(by("api:DialogueEditor").module).toBe("DialogueEditor");
    expect(by("api:ThingPlugin").module).toBe("ScriptEditor"); // wbModules beats the folder
    expect(by("api:Helper").module).toBe("ResourceManager"); // folder
    expect(by("api:Workbench").module).toBe("Shared");
    expect(by("api:WorldEditorAPI").children_count).toBe(3);
    expect(by("api:EMode").children_count).toBe(2);
    expect(by("api:EMode.B").signature).toBe("B = 2");
    expect(by("api:Helper.Do/0").ref).toBe("pak:scripts/WorkbenchGame/ResourceManager/Thing.c#L15");
    expect(rows.merges.map((m) => [m.id, m.count, m.reason.split(" (")[0].split(";")[0]])).toEqual([
      ["api:Helper", 2, "modded class"],
      ["api:Helper.Do/0", 2, "modded class"],
      ["api:ThingPlugin.Add/2", 2, "overloads with the same name and arity"],
      ["api:ThingPlugin.Run/1", 2, "#ifdef branches"],
    ]);
    expect(rows.leftOut).toEqual({ "member variable": 1 });
  });

  it("cites the public static overload, not a protected instance one, when both share a key", () => {
    const ix = buildSourceIndex(
      [
        {
          path: "scripts/WorkbenchGame/LocalizationEditor/L.c",
          text: [
            "class LocMgr",
            "{",
            "\tprotected void Run(BaseContainer src, bool logOnly);",
            "\tstatic void Run(ResourceName cfg, bool logOnly);",
            "}",
          ].join("\n"),
        },
      ],
      { build: "t" },
    );
    const rows = observationRows(ix, () => undefined, []);
    const run = rows.observations.find((o) => o.id === "api:LocMgr.Run/2")!.obs;
    expect(run).toMatchObject({
      kind: "static-method",
      ref: "pak:scripts/WorkbenchGame/LocalizationEditor/L.c#L4",
    });
    expect(rows.merges).toHaveLength(1);
    expect(rows.merges[0].count).toBe(2);
    expect(rows.merges[0].reason).toContain("kinds differ (method / static-method)");
  });

  it("holds no row back: every in-scope class is emitted with the module E02 measures (DEC-020)", () => {
    expect("HELD_BACK" in E02).toBe(false);
    const rows = observationRows(fixtureIndex(), linesOf, []);
    expect(Object.keys(rows)).not.toContain("heldBack");
    const ix = buildSourceIndex(
      [
        {
          path: "scripts/GameLib/generated/WorkbenchAPI/Plugins/WorkbenchPlugin.c",
          text: "class WorkbenchPlugin\n{\n\tvoid Run();\n}\n",
        },
        {
          path: "scripts/GameLib/generated/WorkbenchAPI/Plugins/Bases.c",
          text: "class WorldEditorPlugin : WorkbenchPlugin\n{\n}\nclass ResourceManagerPlugin : WorkbenchPlugin\n{\n}\n",
        },
        {
          path: "scripts/WorkbenchGame/WorldEditor/Helpers/H.c",
          text: "class SomeHelper\n{\n\tstatic void PrintDialog();\n}\n",
        },
      ],
      { build: "t" },
    );
    const mods = Object.fromEntries(
      observationRows(ix, () => undefined, [])
        .observations.filter((o) => o.obs.kind === "class")
        .map((o) => [o.id, o.obs.module]),
    );
    expect(mods).toEqual({
      "api:ResourceManagerPlugin": "ResourceManager",
      "api:SomeHelper": "WorldEditor",
      "api:WorkbenchPlugin": "Shared",
      "api:WorldEditorPlugin": "WorldEditor",
    });
  });

  it("emits a listed helper class outside the folders (its declarations, modded ones and methods), and nothing through an empty list", () => {
    expect(HELPER_CLASSES).toEqual([]);
    const inputs: SourceInput[] = [
      ...SCOPE_INPUTS,
      {
        path: "scripts/GameLib/Other/OutsideMod.c",
        text: "modded class Outside\n{\n\tint m_X;\n\tvoid Extra(int a);\n}\n",
      },
    ];
    const ix = buildSourceIndex(inputs, { build: "1.0.0.1" });
    const lines = (p: string) => inputs.find((s) => s.path === p)?.text.split("\n");
    const plain = observationRows(ix, lines);
    expect(plain.observations.some((o) => o.id.startsWith("api:Outside"))).toBe(false);
    expect(plain.helpers).toEqual([]);
    expect(observationFileText(plain, ix, "1.0.0.1")).toBe(
      observationFileText(observationRows(ix, lines, []), ix, "1.0.0.1"),
    );

    const rows = observationRows(ix, lines, ["Outside"]);
    const ids = rows.observations.map((o) => o.id).filter((id) => id.startsWith("api:Outside"));
    expect(ids).toEqual(["api:Outside", "api:Outside.Extra/1", "api:Outside.NotARow/0"]);
    const by = (id: string) => rows.observations.find((o) => o.id === id)!.obs;
    expect(by("api:Outside")).toMatchObject({
      kind: "class",
      module: "Shared",
      parent_key: null,
      ref: "pak:scripts/Game/OutOfScope.c#L1",
      children_count: 2,
    });
    expect(by("api:Outside.Extra/1")).toMatchObject({
      kind: "method",
      ref: "pak:scripts/GameLib/Other/OutsideMod.c#L4",
      parent_key: { dim: "api", kind: "class", module: "Shared", key: { class: "Outside" } },
    });
    expect(rows.helpers).toEqual([{ name: "Outside", declarations_outside_scope: 2 }]);
    expect(rows.helpersMissing).toEqual([]);
    expect(rows.leftOut).toEqual({ "member variable": 2 });
    // The other out-of-scope rows stay out; the in-scope ones are unchanged.
    expect(rows.observations.length).toBe(plain.observations.length + 3);

    const missing = observationRows(ix, lines, ["NoSuchClass"]);
    expect(missing.helpersMissing).toEqual(["NoSuchClass"]);
    expect(missing.observations.length).toBe(plain.observations.length);
  });

  it("reports the rows with no what per kind and lists the undocumented classes and methods", () => {
    const rows = observationRows(fixtureIndex(), linesOf, []);
    const rep = undocumentedReport(rows, "1.0.0.1");
    expect(rep.build).toBe("1.0.0.1");
    expect(Object.keys(rep.by_kind)).toEqual([
      "class",
      "enum",
      "enum-value",
      "event",
      "method",
      "static-method",
    ]);
    // Only WorldEditorAPI.BeginEntityAction/2 carries a doc comment in the fixture.
    expect(rep.by_kind.method).toEqual({ rows: 8, undocumented: 7 });
    expect(rep.by_kind.class).toEqual({ rows: 6, undocumented: 6 });
    expect(rep.by_kind["enum-value"]).toEqual({ rows: 2, undocumented: 2 });
    const total = Object.values(rep.by_kind).reduce((s, k) => s + k.rows, 0);
    expect(total).toBe(rows.observations.length);
    expect(rep.classes.map((c) => c.id)).toEqual([
      "api:DialogueEditor",
      "api:Helper",
      "api:ThingPlugin",
      "api:WBModuleDef",
      "api:Workbench",
      "api:WorldEditorAPI",
    ]);
    expect(rep.methods.map((m) => m.id)).not.toContain("api:WorldEditorAPI.BeginEntityAction/2");
    expect(rep.methods.find((m) => m.id === "api:Workbench.GetModule/1")).toEqual({
      id: "api:Workbench.GetModule/1",
      kind: "static-method",
      ref: "pak:scripts/GameLib/generated/WorkbenchAPI/Workbench.c#L4",
    });
    expect(rep.methods.map((m) => m.kind)).toContain("event");
    // Enums and enum values are counted, not listed.
    expect([...rep.classes, ...rep.methods].some((x) => x.id.startsWith("api:EMode"))).toBe(false);
    expect(rep.methods.length).toBe(
      rep.by_kind.method.undocumented +
        rep.by_kind["static-method"].undocumented +
        rep.by_kind.event.undocumented,
    );
    const art = mkdtempSync(join(tmpdir(), "e02-undoc-"));
    expect(undocumentedPath("1.0.0.1", art)).toBe(
      join(art, "census", "1.0.0.1", "E02", "undocumented.json"),
    );
  });

  it("is deterministic: two builds give byte-identical index and observation files", () => {
    const a = fixtureIndex();
    const b = buildSourceIndex([...SCOPE_INPUTS].reverse(), { build: "1.0.0.1" });
    expect(sourceIndexText(a)).toBe(sourceIndexText(b));
    const ra = observationFileText(observationRows(a, linesOf, []), a, "1.0.0.1");
    const rb = observationFileText(observationRows(b, linesOf, []), b, "1.0.0.1");
    expect(ra).toBe(rb);
    expect(ra.endsWith("\n")).toBe(true);
    expect(JSON.parse(ra.split("\n")[0])).toMatchObject({
      enumerator: "E02",
      generator: GENERATOR,
      provisional: false,
    });
  });

  it("saves and loads the index (absent build: undefined), and lookups work on the loaded copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "e02-artifacts-"));
    const ix = fixtureIndex();
    const file = saveSourceIndex(ix, { dir });
    expect(file).toBe(join(dir, "census", "1.0.0.1", "E02", "source-index.jsonl"));
    expect(loadSourceIndex("9.9.9.9", { dir })).toBeUndefined();
    const back = loadSourceIndex("1.0.0.1", { dir })!;
    expect(sourceIndexText(back)).toBe(sourceIndexText(ix));
    expect(parseSourceIndexText(sourceIndexText(ix)).records.length).toBe(ix.records.length);
    expect(methodsOf(back, "DialogueEditor").map((v) => v.method.name)).toEqual([
      "GetCurrentNode",
      "Save",
      "OnAfterLoad",
    ]);
    expect(lookupSymbol(back, "DialogueEditor.Save")).toMatchObject([
      { qualified: "WBModuleDef.Save", inherited_from: "WBModuleDef", arity: 0 },
    ]);
    expect(lookupSymbol(back, "api:Workbench.GetModule/1")).toMatchObject([
      { kind: "static-method", ref: "pak:scripts/GameLib/generated/WorkbenchAPI/Workbench.c#L4" },
    ]);
    expect(lookupSymbol(back, "Workbench.GetModul")).toEqual([]);
  });

  it("puts the index where scripts/live/paths.ts puts artifacts", () => {
    const env = { LOCALAPPDATA: "X:\\LocalAppData" } as NodeJS.ProcessEnv;
    expect(defaultArtifactsDir(env, "win32", "X:\\home")).toBe(
      artifactsDir(env, "win32", "X:\\home"),
    );
    expect(defaultArtifactsDir({}, "linux", "/home/u")).toBe(artifactsDir({}, "linux", "/home/u"));
    const outside = mkdtempSync(join(tmpdir(), "e02-art-"));
    expect(defaultArtifactsDir({ ENFUSION_ARTIFACTS_DIR: outside })).toBe(
      artifactsDir({ ENFUSION_ARTIFACTS_DIR: outside }),
    );
  });

  it("builds into the ledger with no rejected line and no problem", () => {
    const fx = makeCensus("1.0.0.1");
    const ix = fixtureIndex();
    const dir = join(fx.root, "observations", "E02");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "1.0.0.1.jsonl"),
      observationFileText(observationRows(ix, linesOf, []), ix, "1.0.0.1"),
    );
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems).toEqual([]);
    expect(built.rows.length).toBe(21);
    const row = built.rows.find((r) => r.id === "api:WorldEditorAPI.BeginEntityAction/2");
    expect(row).toMatchObject({
      parent: "api:WorldEditorAPI",
      kind: "method",
      module: "WorldEditor",
    });
    expect(built.rows.find((r) => r.id === "api:WorldEditorAPI")?.children_enumerated).toBe(true);
  });
});

// ── Real install (skipped without the game) ──────────────────────────────────

const gamePath = loadConfig().gamePath;
const hasGame = !!gamePath && existsSync(join(gamePath, "addons"));

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !hasGame)("E02 headline counts on the installed game (build 1.8.0.13)", () => {
  it("parses every script and reproduces the headline counts", () => {
    const vfs = PakVirtualFS.get(gamePath)!;
    const ix = buildSourceIndex(vfs, { build: "1.8.0.13" });
    const rows = observationRows(ix, (p) => vfs.readTextFile(p).split(/\r?\n/));
    const c = headlineCounts(ix, rows, (p) => vfs.readTextFile(p));
    expect(c.files_parsed).toBe(6568);
    expect(c.files_failed.map((f) => f.file)).toEqual(Object.keys(EXPECTED_PARSE_FAILURES));
    // game.c: the junk under #ifdef BREAK_COMPILATION is one error, and the
    // enum right after its #endif is still indexed with its four values.
    expect(c.files_failed[0].errors).toHaveLength(1);
    expect(findClass(ix, "EGameFlags")).toBeUndefined();
    const egf = ix.records.filter(
      (r) => r.name === "EGameFlags" || (r as { owner?: string }).owner === "EGameFlags",
    );
    expect(egf.map((r) => `${r.kind}:${r.name}@${r.line}`)).toEqual([
      "enum:EGameFlags@16",
      "enum-value:Metabolism@18",
      "enum-value:SpawnVehicles@19",
      "enum-value:SpawnAI@20",
      "enum-value:Last@21",
    ]);
    expect(c.totals).toMatchObject({
      enums: 830,
      enum_values: 6510,
      classes: 9011,
      methods: 46519,
    });
    expect(c.records).toBe(94709);
    expect(c.world_editor_api).toMatchObject({
      methods: 126,
      constructors_destructors: 2,
      proto_external: 124,
    });
    expect(c.world_editor_api.endcode_typo?.slash_endcode_lines).toEqual([161, 182]);
    expect(c.world_editor_api.endcode_typo?.next_endcode_line).toBe(239);
    expect(c.world_editor_api.endcode_typo?.between.length).toBe(28);
    expect(c.static_methods).toEqual({ Workbench: 27, DiagMenu: 16, DbgUI: 27 });
    expect(c.ui_widgets_members).toBe(31);
    expect(c.plugin_classes).toMatchObject({ declarations: 142, commented_out_in_source: 6 });
    expect(c.net_api_handlers.direct.length).toBe(34);
    expect(
      c.net_api_handlers.direct.filter((d) => d.guards.includes("DOXYGEN")).map((d) => d.name),
    ).toEqual(["ExampleCall"]);
    expect(rows.observations.length).toBe(2653);
    // The seven classes held back before DEC-020, now emitted with the module E02 measures.
    const mod = (id: string) => rows.observations.find((o) => o.id === id)?.obs.module;
    expect(
      [
        "api:LocalizationEditorPlugin",
        "api:ResourceManagerPlugin",
        "api:SCR_WorkbenchHelper",
        "api:WBProgressDialog",
        "api:WorkbenchPlugin",
        "api:WorldEditorPlugin",
        "api:WorldEditorTool",
      ].map(mod),
    ).toEqual([
      "LocalizationEditor",
      "ResourceManager",
      "WorldEditor",
      "Shared",
      "Shared",
      "WorldEditor",
      "WorldEditor",
    ]);
    expect(rows.helpers).toEqual([]);
    expect(rows.helpersMissing).toEqual([]);
    const undoc = undocumentedReport(rows, "1.8.0.13");
    expect(Object.values(undoc.by_kind).reduce((s, k) => s + k.rows, 0)).toBe(2653);
    expect(rows.merges.length).toBe(10);
    expect(rows.merges.reduce((s, m) => s + m.count, 0)).toBe(23);
    expect(rows.observations.find((o) => o.id === "api:LocParserManager.Run/4")?.obs.kind).toBe(
      "static-method",
    );
  }, 300_000);
});
