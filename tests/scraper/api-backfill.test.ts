import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseParamsFromSignature,
  signatureArity,
  splitSignatureParams,
} from "../../src/scraper/signature.js";
import { parseClassPage } from "../../src/scraper/doxygen-parser.js";
import {
  backfillApiIndex,
  correctMethodNames,
  correctParamsArrays,
  methodCountCheck,
  type ApiIndexFile,
  type PakMethodInfo,
} from "../../src/scraper/backfill.js";
import {
  API_INDEX_FILES,
  apiFileText,
  applySourceBackfill,
  parseApiFileText,
} from "../../src/scraper/backfill-io.js";
import { backfillScraped } from "../../src/scraper/writer.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  sourceIndexPath,
  sourceIndexText,
} from "../../src/census/source-index.js";
import type { ClassInfo, MethodInfo } from "../../src/index/types.js";
import { run as runBackfillCli } from "../../scripts/backfill-api-index.js";
import { memoryIo } from "../../scripts/census/cli-common.js";
import {
  analyze,
  inWorkbenchScope,
  parseApiIndex,
  signatureName,
} from "../../scripts/census/enumerators/e12-api-index.js";
import { artifactsDir } from "../../scripts/live/paths.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ── Parameter splitting: the shapes E12 found broken in the index ────────────

describe("parseParamsFromSignature (depth-aware split)", () => {
  it("keeps a generic's comma inside its parameter", () => {
    expect(
      parseParamsFromSignature(
        "bool GetMaterials (string xobPath, out map< string, ResourceName > AssignedMats)",
      ),
    ).toEqual([
      { name: "xobPath", type: "string", defaultValue: "" },
      { name: "AssignedMats", type: "out map< string, ResourceName >", defaultValue: "" },
    ]);
    expect(
      parseParamsFromSignature(
        "static proto ref Material Create (string name, string matClassName, map< string, string > params=null)",
      ),
    ).toEqual([
      { name: "name", type: "string", defaultValue: "" },
      { name: "matClassName", type: "string", defaultValue: "" },
      { name: "params", type: "map< string, string >", defaultValue: "null" },
    ]);
  });

  it("keeps nested generics and several generic parameters apart", () => {
    const init = parseParamsFromSignature(
      "void Init (notnull SCR_WorkshopItem item, notnull map< SCR_EAddonValidateState, ref SCR_AddonLineValidateState > states, notnull map< int, string > errorMessages)",
    );
    expect(init.map((p) => p.name)).toEqual(["item", "states", "errorMessages"]);
    expect(init[1].type).toBe(
      "notnull map< SCR_EAddonValidateState, ref SCR_AddonLineValidateState >",
    );
    const create = parseParamsFromSignature(
      "static SCR_AddonUpdateConfirmationDialog CreateForUpdates (notnull array< ref Tuple2< SCR_WorkshopItem, ref Revision > > addonsAndVersions, bool subscribeToAddons)",
    );
    expect(create).toEqual([
      {
        name: "addonsAndVersions",
        type: "notnull array< ref Tuple2< SCR_WorkshopItem, ref Revision > >",
        defaultValue: "",
      },
      { name: "subscribeToAddons", type: "bool", defaultValue: "" },
    ]);
  });

  it("does not cut a default value that holds a call", () => {
    const sig =
      "void SetTexture (string imagePath, string image=string.Empty, Color color=Color.FromInt(Color.WHITE), SCR_EButtonSize buttonType=SCR_EButtonSize.KEYBOARD_MEDIUM)";
    expect(parseParamsFromSignature(sig)).toEqual([
      { name: "imagePath", type: "string", defaultValue: "" },
      { name: "image", type: "string", defaultValue: "string.Empty" },
      { name: "color", type: "Color", defaultValue: "Color.FromInt(Color.WHITE)" },
      {
        name: "buttonType",
        type: "SCR_EButtonSize",
        defaultValue: "SCR_EButtonSize.KEYBOARD_MEDIUM",
      },
    ]);
    // An empty call: the old parser kept `RplId.Invalid(` and the count happened to be right.
    expect(
      parseParamsFromSignature("void OnSpawnPointSelected (RplId spId=RplId.Invalid())"),
    ).toEqual([{ name: "spId", type: "RplId", defaultValue: "RplId.Invalid()" }]);
    expect(
      parseParamsFromSignature(
        "void SetNewParent (RplId parentId=RplId.Invalid(), int nodeId=-1, vector customLocalTransform[4]={})",
      ),
    ).toEqual([
      { name: "parentId", type: "RplId", defaultValue: "RplId.Invalid()" },
      { name: "nodeId", type: "int", defaultValue: "-1" },
      { name: "customLocalTransform[4]", type: "vector", defaultValue: "{}" },
    ]);
  });

  it("keeps a comma inside a string default, and reads an empty list as no parameters", () => {
    expect(parseParamsFromSignature('void Join (string sep=", ", int n=0)')).toEqual([
      { name: "sep", type: "string", defaultValue: '", "' },
      { name: "n", type: "int", defaultValue: "0" },
    ]);
    expect(parseParamsFromSignature("void Run ()")).toEqual([]);
    expect(splitSignatureParams("no parens")).toEqual([]);
    expect(signatureArity("void F (map< K, V > m, int a)")).toBe(2);
  });

  it("parses a member row through parseClassPage the same way, and reads the protected static section", () => {
    const html = `<html><body>
<div class="headertitle"><div class="title">AnimateWidget Interface Reference</div></div>
<div class="contents">
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pub-methods" name="pub-methods"></a>Public Member Functions</h2></td></tr>
<tr class="memitem:a1"><td class="memItemLeft">void&#160;</td><td class="memItemRight"><a class="el" href="#a1">SetTexture</a> (string imagePath, Color color=Color.FromInt(Color.WHITE), <a class="el" href="x.html">map</a>&lt; string, int &gt; m=null)</td></tr>
</table>
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pro-methods" name="pro-methods"></a>Protected Member Functions</h2></td></tr>
<tr class="memitem:a2"><td class="memItemLeft">void&#160;</td><td class="memItemRight"><a class="el" href="#a2">Tick</a> ()</td></tr>
</table>
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pro-static-methods" name="pro-static-methods"></a>Static Protected Member Functions</h2></td></tr>
<tr class="memitem:a3"><td class="memItemLeft">static bool&#160;</td><td class="memItemRight"><a class="el" href="#a3">PrepareAnimation</a> (Widget w, float speed, TypeName typeName)</td></tr>
<tr class="memdesc:a3"><td class="mdescLeft">&#160;</td><td class="mdescRight">Make sure that animation can be played.</td></tr>
</table>
</div></body></html>`;
    const cls = parseClassPage(html, "arma", "interfaceAnimateWidget.html");
    expect(cls.methods).toHaveLength(1);
    expect(cls.methods[0].params.map((p) => [p.name, p.type, p.defaultValue])).toEqual([
      ["imagePath", "string", ""],
      ["color", "Color", "Color.FromInt(Color.WHITE)"],
      ["m", "map< string, int >", "null"],
    ]);
    expect(cls.protectedMethods.map((m) => m.signature)).toEqual([
      "void Tick ()",
      "static bool PrepareAnimation (Widget w, float speed, TypeName typeName)",
    ]);
    expect(cls.protectedMethods[1].description).toBe("Make sure that animation can be played.");
    expect(cls.staticMethods).toEqual([]);
  });
});

// ── Backfill on a planted source and index ───────────────────────────────────

const CORE_FILE = "scripts/Core/generated/WorkbenchAPI/TestEditorAPI.c";
const GAME_FILE = "scripts/Game/Test/SCR_TestThings.c";

const CORE_SOURCE = [
  "//! Planted editor API",
  "sealed class TestEditorAPI",
  "{",
  "\t//! Doxygen sees this one",
  "\tproto external bool BeginAction(string name = string.Empty);",
  "#ifdef WORKBENCH",
  "\t//! Only in the Workbench build",
  "\tproto external void GuardedMethod(int a);",
  "#endif",
  "\tprotected static void ProtStatic(map<string, int> m);",
  "\tprivate void Hidden();",
  "\tvoid Overload(int a);",
  "\tvoid Overload(float a);",
  "\t/*!",
  "\tExample:",
  "\t\\code",
  "\tTestEditorAPI.Swallowed();",
  "\t/endcode",
  "\t*/",
  "\tproto external void AfterTypo(notnull array<ref Managed> list, Color c = Color.FromInt(Color.WHITE));",
  "}",
  "",
  "class Tuple9<Class T1>",
  "{",
  "\tvoid Get();",
  "}",
  "",
].join("\n");

const GAME_SOURCE = [
  "class SCR_IndexedThing : Managed",
  "{",
  "\tvoid Indexed();",
  "\tstatic void PubStatic(out int x);",
  "}",
  "",
  "//! Not in the Doxygen output",
  "class SCR_MissingThing : SCR_IndexedThing",
  "{",
  "\tvoid Foo(int a);",
  "\tprotected void Bar();",
  "\tprivate void Baz();",
  "}",
  "",
  "modded class SCR_IndexedThing",
  "{",
  "\tvoid AddedByMod();",
  "}",
  "",
].join("\n");

function doxygenMethod(signature: string, returnType: string, anchor: string): MethodInfo {
  const at = signature.indexOf("(");
  return {
    name: anchor,
    returnType,
    signature,
    params: parseParamsFromSignature(signature.slice(at)),
    description: "",
  };
}

function doxygenClass(name: string, source: "enfusion" | "arma", methods: MethodInfo[]): ClassInfo {
  return {
    name,
    source,
    brief: "",
    description: "",
    parents: [],
    children: [],
    group: "",
    sourceFile: "",
    methods,
    protectedMethods: [],
    staticMethods: [],
    enums: [],
    properties: [],
    protectedProperties: [],
    docsUrl: "",
  };
}

function plantedFiles(): ApiIndexFile[] {
  const brokenGeneric: MethodInfo = {
    name: "Mapmap",
    returnType: "void",
    signature: "void Map (map< string, int > m)",
    // What the old comma split wrote.
    params: [
      { name: "string,", type: "map<", defaultValue: "" },
      { name: ">", type: "int", defaultValue: "" },
    ],
    description: "",
  };
  return [
    {
      file: "enfusion-classes.json",
      source: "enfusion",
      classes: [
        doxygenClass("TestEditorAPI", "enfusion", [
          doxygenMethod(
            "proto external bool BeginAction (string name=string.Empty)",
            "proto external bool",
            "BeginActionstringstring.Empty",
          ),
          doxygenMethod("void Overload (int a)", "void", "Overloadint"),
          // An inherited listing: no own method of that name.
          doxygenMethod("proto external int Inherited ()", "proto external int", "Inherited"),
          brokenGeneric,
        ]),
        doxygenClass("Tuple9< Class T1 > Interface Template Reference", "enfusion", [
          doxygenMethod("void Get ()", "void", "Get"),
        ]),
      ],
    },
    {
      file: "arma-classes.json",
      source: "arma",
      classes: [
        doxygenClass("SCR_IndexedThing", "arma", [
          doxygenMethod("void Indexed ()", "void", "Indexed"),
        ]),
        doxygenClass("SCR_ZetaLast", "arma", []),
      ],
    },
  ];
}

function plantedIndex() {
  return buildSourceIndex(
    [
      { path: CORE_FILE, text: CORE_SOURCE },
      { path: GAME_FILE, text: GAME_SOURCE },
    ],
    { build: "test" },
  );
}

describe("backfillApiIndex", () => {
  it("adds what the source declares and the index lacks, each marked as coming from the pak", () => {
    const index = plantedIndex();
    const files = plantedFiles();
    const before = JSON.parse(JSON.stringify(files)) as ApiIndexFile[];
    const r = backfillApiIndex(files, index);

    const what = r.added.map(
      (a) => `${a.file}|${a.class}|${a.method ?? "(class)"}|${a.array ?? ""}|${a.reason}`,
    );
    expect(what).toEqual([
      "arma-classes.json|SCR_IndexedThing|PubStatic|staticMethods|unexplained",
      "enfusion-classes.json|TestEditorAPI|GuardedMethod|methods|preprocessor-guard",
      "enfusion-classes.json|TestEditorAPI|ProtStatic|protectedMethods|protected-static-method",
      "enfusion-classes.json|TestEditorAPI|Overload|methods|unexplained",
      "enfusion-classes.json|TestEditorAPI|AfterTypo|methods|doxygen-block-typo",
      "arma-classes.json|SCR_MissingThing|(class)||class-missing-from-index",
      "arma-classes.json|SCR_MissingThing|Foo|methods|class-missing-from-index",
      "arma-classes.json|SCR_MissingThing|Bar|protectedMethods|class-missing-from-index",
    ]);
    expect(r.perFile["enfusion-classes.json"]).toEqual({
      methods: 4,
      classes: 0,
      byReason: {
        "preprocessor-guard": 1,
        "protected-static-method": 1,
        unexplained: 1,
        "doxygen-block-typo": 1,
      },
      withheld: 0,
    });
    expect(r.entries).toEqual(r.added);
    expect(r.removed).toEqual([]);
    expect(r.withheld).toEqual([]);
    expect(r.perFile["arma-classes.json"]).toMatchObject({ methods: 3, classes: 1 });

    // Private methods and methods of a modded class are not expected in the index.
    expect(
      what.some((w) => w.includes("Hidden") || w.includes("Baz") || w.includes("AddedByMod")),
    ).toBe(false);

    // The Doxygen entries are untouched, in place, and the additions come after them.
    const api = files[0].classes[0];
    expect(api.methods.slice(0, 4)).toEqual(before[0].classes[0].methods);
    expect(files[0].classes[1]).toEqual(before[0].classes[1]);
    const typo = api.methods.find((m) => m.name === "AfterTypo") as PakMethodInfo;
    expect(typo).toEqual({
      name: "AfterTypo",
      returnType: "proto external void",
      signature:
        "proto external void AfterTypo(notnull array<ref Managed> list, Color c = Color.FromInt(Color.WHITE))",
      params: [
        { name: "list", type: "notnull array<ref Managed>", defaultValue: "" },
        { name: "c", type: "Color", defaultValue: "Color.FromInt(Color.WHITE)" },
      ],
      // The doc comment with the typo is this method's own.
      description: "Example:\n\t\\code\n\tTestEditorAPI.Swallowed();\n\t/endcode",
      origin: "pak",
      pakFile: CORE_FILE,
      pakLine: 20,
    });
    const prot = api.protectedMethods[0] as PakMethodInfo;
    expect(prot).toMatchObject({
      name: "ProtStatic",
      returnType: "static void",
      origin: "pak",
      pakFile: CORE_FILE,
      pakLine: 10,
    });
    expect(api.methods.find((m) => m.name === "GuardedMethod")).toMatchObject({
      description: "Only in the Workbench build",
      origin: "pak",
      pakLine: 8,
      guards: ["WORKBENCH"],
    });
    // An unguarded declaration carries no guards field.
    expect("guards" in typo).toBe(false);

    // The missing Game class goes to the file that holds the Game module's classes, in name order.
    expect(files[1].classes.map((c) => c.name)).toEqual([
      "SCR_IndexedThing",
      "SCR_MissingThing",
      "SCR_ZetaLast",
    ]);
    expect(files[1].classes[1]).toMatchObject({
      name: "SCR_MissingThing",
      source: "arma",
      brief: "Not in the Doxygen output",
      parents: ["SCR_IndexedThing"],
      sourceFile: GAME_FILE,
      origin: "pak",
      pakFile: GAME_FILE,
      pakLine: 8,
    });
    expect(Object.keys(files[1].classes[1])).toEqual([
      "name",
      "source",
      "brief",
      "description",
      "parents",
      "children",
      "group",
      "sourceFile",
      "methods",
      "protectedMethods",
      "staticMethods",
      "enums",
      "properties",
      "protectedProperties",
      "docsUrl",
      "origin",
      "pakFile",
      "pakLine",
    ]);
  });

  it("is idempotent: a second run adds nothing, prunes nothing and changes no byte", () => {
    const index = plantedIndex();
    const files = plantedFiles();
    const first = backfillApiIndex(files, index);
    const once = files.map((f) => apiFileText(f.classes, true));
    const again = backfillApiIndex(files, index);
    expect(again.added).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.entries).toEqual(first.entries);
    expect(files.map((f) => apiFileText(f.classes, true))).toEqual(once);
  });

  it("derives the pak layer again each run: a stale entry is pruned, a changed one restored", () => {
    const index = plantedIndex();
    const files = plantedFiles();
    backfillApiIndex(files, index);
    const once = files.map((f) => apiFileText(f.classes, true));
    // A method the source no longer declares, a class it no longer declares,
    // and a pak entry edited by hand.
    const stale: PakMethodInfo = {
      name: "Gone",
      returnType: "void",
      signature: "void Gone()",
      params: [],
      description: "",
      origin: "pak",
      pakFile: CORE_FILE,
      pakLine: 99,
    };
    files[0].classes[0].methods.push(stale);
    files[1].classes.push({
      ...doxygenClass("SCR_GoneClass", "arma", []),
      origin: "pak",
      pakFile: GAME_FILE,
      pakLine: 99,
    } as ClassInfo);
    const edited = files[0].classes[0].methods.find((m) => m.name === "GuardedMethod");
    if (!edited) throw new Error("planted method missing");
    edited.description = "edited";
    const r = backfillApiIndex(files, index);
    expect(r.removed.map((x) => `${x.class}|${x.method ?? "(class)"}`).sort()).toEqual([
      "SCR_GoneClass|(class)",
      "TestEditorAPI|Gone",
    ]);
    expect(r.added.map((a) => a.method)).toEqual(["GuardedMethod"]);
    expect(files.map((f) => apiFileText(f.classes, true))).toEqual(once);
  });

  it("withholds an alternative from the other branch of a guard; marks a guarded method it adds", () => {
    const file = "scripts/Game/Test/SCR_Branchy.c";
    const index = buildSourceIndex(
      [
        {
          path: file,
          text: [
            "class SCR_Branchy",
            "{",
            "#ifndef DISABLE_THING",
            "\tbool Equip(int a, int b = -1);",
            "\tvoid OnlyActive();",
            "#else",
            "\tvoid Equip(int a);",
            "\tvoid OnlyStub();",
            "#endif",
            "#ifdef ENABLE_DIAG",
            "\tvoid DiagOnly();",
            "#endif",
            "}",
            "",
          ].join("\n"),
        },
      ],
      { build: "test" },
    );
    const files: ApiIndexFile[] = [
      { file: "enfusion-classes.json", source: "enfusion", classes: [] },
      {
        file: "arma-classes.json",
        source: "arma",
        classes: [
          doxygenClass("SCR_Branchy", "arma", [
            doxygenMethod("bool Equip (int a, int b=-1)", "bool", "Equipintint"),
            doxygenMethod("void OnlyActive ()", "void", "OnlyActive"),
          ]),
        ],
      },
    ];
    const r = backfillApiIndex(files, index);
    expect(r.withheld).toEqual([
      {
        file: "arma-classes.json",
        class: "SCR_Branchy",
        method: "Equip",
        arity: 1,
        pakFile: file,
        pakLine: 7,
        guards: ["DISABLE_THING"],
        reason: "inactive-branch-alternative",
        alternativeOf: `${file}#L4`,
      },
    ]);
    expect(r.perFile["arma-classes.json"].withheld).toBe(1);
    const cls = files[1].classes[0];
    expect(cls.methods.map((m) => m.signature)).toEqual([
      "bool Equip (int a, int b=-1)",
      "void OnlyActive ()",
      "void OnlyStub()",
      "void DiagOnly()",
    ]);
    expect(cls.methods.slice(2).map((m) => (m as PakMethodInfo).guards)).toEqual([
      ["DISABLE_THING"],
      ["ENABLE_DIAG"],
    ]);
    // The withheld alternative is not a shortfall of the method-count check.
    expect(methodCountCheck(files, index)).toEqual([]);
  });

  it("pairs a source class with the page whose name differs only in case (Doxygen's TypeName)", () => {
    const file = "scripts/Core/generated/Types/typename.c";
    const index = buildSourceIndex(
      [
        {
          path: file,
          text: [
            "sealed class typename",
            "{",
            "\tprivate void typename();",
            "\tproto external string ToString();",
            "\tproto external bool IsInherited(typename baseType);",
            "}",
            "",
          ].join("\n"),
        },
      ],
      { build: "test" },
    );
    const files: ApiIndexFile[] = [
      {
        file: "enfusion-classes.json",
        source: "enfusion",
        classes: [
          doxygenClass("TypeName", "enfusion", [
            doxygenMethod("proto external string ToString ()", "proto external string", "ToString"),
            doxygenMethod(
              "proto external bool IsInherited (TypeName baseType)",
              "proto external bool",
              "IsInheritedTypeName",
            ),
          ]),
        ],
      },
      { file: "arma-classes.json", source: "arma", classes: [] },
    ];
    const before = JSON.stringify(files);
    const r = backfillApiIndex(files, index);
    expect(r.entries).toEqual([]);
    expect(JSON.stringify(files)).toBe(before);
    expect(methodCountCheck(files, index)).toEqual([]);
  });

  it("the per-class method-count check lists the short classes before and none after", () => {
    const index = plantedIndex();
    const files = plantedFiles();
    const before = methodCountCheck(files, index);
    expect(before.map((c) => [c.class, c.indexed, c.expected, c.classMissing])).toEqual([
      ["SCR_IndexedThing", 1, 2, false],
      ["SCR_MissingThing", 0, 2, true],
      ["TestEditorAPI", 2, 6, false],
    ]);
    expect(before[2].missing).toEqual([
      "GuardedMethod/1",
      "ProtStatic/1",
      "Overload/1",
      "AfterTypo/2",
    ]);
    backfillApiIndex(files, index);
    expect(methodCountCheck(files, index)).toEqual([]);
  });
});

describe("correctParamsArrays", () => {
  it("rewrites only a params array that differs from its signature, never a pak entry", () => {
    const files = plantedFiles();
    const pak: PakMethodInfo = {
      name: "Odd",
      returnType: "void",
      signature: "void Odd(map<string, int> m)",
      params: [{ name: "m", type: "map<string, int>", defaultValue: "" }],
      description: "",
      origin: "pak",
      pakFile: CORE_FILE,
      pakLine: 1,
    };
    files[1].classes[1].methods.push(pak);
    const untouched = JSON.parse(JSON.stringify(files[0].classes[0].methods.slice(0, 3)));
    const fixed = correctParamsArrays(files);
    expect(fixed).toEqual([
      {
        file: "enfusion-classes.json",
        class: "TestEditorAPI",
        signature: "void Map (map< string, int > m)",
        before: 2,
        after: 1,
      },
    ]);
    expect(files[0].classes[0].methods[3].params).toEqual([
      { name: "m", type: "map< string, int >", defaultValue: "" },
    ]);
    expect(files[0].classes[0].methods.slice(0, 3)).toEqual(untouched);
    expect(correctParamsArrays(files)).toEqual([]);
  });
});

describe("correctMethodNames", () => {
  it("sets a Doxygen entry's name to its signature's identifier, changing nothing else, never a pak entry", () => {
    const files = plantedFiles();
    const pak: PakMethodInfo = {
      name: "OddName",
      returnType: "void",
      signature: "void Odd(int a)",
      params: [{ name: "a", type: "int", defaultValue: "" }],
      description: "",
      origin: "pak",
      pakFile: CORE_FILE,
      pakLine: 1,
    };
    files[1].classes[1].methods.push(pak);
    // A destructor keeps its tilde; an entry whose signature declares no identifier is left alone.
    files[1].classes[0].protectedMethods.push(
      doxygenMethod("void ~SCR_IndexedThing ()", "void", "~SCR_IndexedThingx"),
      { ...doxygenMethod("bool operator== (int a)", "bool", "operator=="), params: [] },
    );
    const before = JSON.parse(JSON.stringify(files)) as ApiIndexFile[];
    const fixed = correctMethodNames(files);
    expect(fixed).toEqual([
      {
        file: "enfusion-classes.json",
        class: "TestEditorAPI",
        array: "methods",
        signature: "proto external bool BeginAction (string name=string.Empty)",
        before: "BeginActionstringstring.Empty",
        after: "BeginAction",
      },
      {
        file: "enfusion-classes.json",
        class: "TestEditorAPI",
        array: "methods",
        signature: "void Overload (int a)",
        before: "Overloadint",
        after: "Overload",
      },
      {
        file: "enfusion-classes.json",
        class: "TestEditorAPI",
        array: "methods",
        signature: "void Map (map< string, int > m)",
        before: "Mapmap",
        after: "Map",
      },
      {
        file: "arma-classes.json",
        class: "SCR_IndexedThing",
        array: "protectedMethods",
        signature: "void ~SCR_IndexedThing ()",
        before: "~SCR_IndexedThingx",
        after: "~SCR_IndexedThing",
      },
    ]);
    // Only `name` changed, in place (key order kept), and the pak entry is untouched.
    const names = (fs: ApiIndexFile[]): string[] =>
      fs.flatMap((f) =>
        f.classes.flatMap((c) =>
          [...c.methods, ...c.protectedMethods, ...c.staticMethods].map((m) => m.name),
        ),
      );
    const strip = (fs: ApiIndexFile[]): string =>
      JSON.stringify(fs, (k, v) => (k === "name" && typeof v === "string" ? "" : v));
    expect(strip(files)).toBe(strip(before));
    expect(Object.keys(files[0].classes[0].methods[0])).toEqual(
      Object.keys(before[0].classes[0].methods[0]),
    );
    expect(names(files).filter((n, i) => n !== names(before)[i])).toEqual([
      "BeginAction",
      "Overload",
      "Map",
      "~SCR_IndexedThing",
    ]);
    expect(files[1].classes[1].methods.at(-1)).toEqual(pak);
    expect(files[1].classes[0].protectedMethods.at(-1)?.name).toBe("operator==");
    // Idempotent.
    expect(correctMethodNames(files)).toEqual([]);
  });

  it("runs in applySourceBackfill before the backfill, which pairs the same either way", () => {
    const raw = plantedFiles();
    const s = applySourceBackfill(raw, plantedIndex());
    expect(s.nameCorrections.map((c) => c.after)).toEqual(["BeginAction", "Overload", "Map"]);
    const pre = plantedFiles();
    correctMethodNames(pre);
    const r = backfillApiIndex(pre, plantedIndex());
    expect(r.added).toEqual(s.result.added);
    expect(applySourceBackfill(raw, plantedIndex()).nameCorrections).toEqual([]);
  });
});

describe("stored form and the scraper writer", () => {
  it("writes the files back byte for byte in their stored form (CRLF kept, no final newline)", () => {
    const files = plantedFiles();
    for (const crlf of [false, true]) {
      const text = apiFileText(files[0].classes, crlf);
      const parsed = parseApiFileText(text);
      expect(parsed.crlf).toBe(crlf);
      expect(apiFileText(parsed.classes, parsed.crlf)).toBe(text);
      expect(text.endsWith("]")).toBe(true);
    }
  });

  it("backfills freshly scraped lists before they are written; a preserved file is read, not written", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-backfill-"));
    try {
      const files = plantedFiles();
      const armaPath = join(dir, "arma-classes.json");
      writeFileSync(armaPath, apiFileText(files[1].classes, false), "utf-8");
      const armaBefore = readFileSync(armaPath, "utf-8");
      const output = {
        enfusionClasses: files[0].classes,
        armaClasses: [] as ClassInfo[],
        hierarchy: [],
        groups: [],
        wikiPages: [],
      };
      const meta = backfillScraped(dir, output, plantedIndex());
      expect(output.enfusionClasses[0].methods.map((m) => m.name)).toContain("GuardedMethod");
      expect(output.armaClasses).toEqual([]);
      expect(readFileSync(armaPath, "utf-8")).toBe(armaBefore);
      // Provenance for scrape-meta.json: the preserved file does not carry the layer.
      expect(meta).toEqual({
        build: "test",
        inputsSha256: plantedIndex().header.inputs_sha256,
        files: ["enfusion-classes.json"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the scrape writes a class list without the pak layer when the layer would pass the size cap", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-backfill-cap-"));
    try {
      const files = plantedFiles();
      const doxygenOnly = JSON.parse(JSON.stringify(files[0].classes)) as ClassInfo[];
      correctMethodNames([{ ...files[0], classes: doxygenOnly }]);
      correctParamsArrays([{ ...files[0], classes: doxygenOnly }]);
      const output = {
        enfusionClasses: files[0].classes,
        armaClasses: files[1].classes,
        hierarchy: [],
        groups: [],
        wikiPages: [],
      };
      // A cap the backfilled Enfusion list passes and the backfilled Arma list does not.
      const probe = plantedFiles();
      applySourceBackfill(probe, plantedIndex());
      const [enfSize, armaSize] = probe.map((f) =>
        Buffer.byteLength(JSON.stringify(f.classes, null, 2)),
      );
      expect(enfSize).toBeGreaterThan(armaSize);
      const meta = backfillScraped(dir, output, plantedIndex(), armaSize);
      expect(output.enfusionClasses).toEqual(doxygenOnly);
      expect(output.armaClasses.map((c) => c.name)).toContain("SCR_MissingThing");
      expect(meta.files).toEqual(["arma-classes.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the CLI refuses with NO DATA when there is no source index, and applies one it is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-backfill-cli-"));
    try {
      const files = plantedFiles();
      files.forEach((f, i) =>
        writeFileSync(join(dir, API_INDEX_FILES[i].file), apiFileText(f.classes, true), "utf-8"),
      );
      const io1 = memoryIo();
      expect(
        runBackfillCli(["--api-dir", dir, "--source-index", join(dir, "absent.jsonl")], io1),
      ).toBe(2);
      expect(io1.stdout()).toContain("NO DATA");

      const indexFile = join(dir, "source-index.jsonl");
      writeFileSync(indexFile, sourceIndexText(plantedIndex()), "utf-8");
      const metaPath = join(dir, "scrape-meta.json");
      writeFileSync(metaPath, '{\r\n  "buildBranch": "x"\r\n}', "utf-8");
      const io2 = memoryIo();
      expect(runBackfillCli(["--api-dir", dir, "--source-index", indexFile], io2)).toBe(0);
      expect(io2.stdout()).toContain("enfusion-classes.json: written; +4 methods");
      expect(io2.stdout()).toContain("arma-classes.json: written; +3 methods");
      const enf = readFileSync(join(dir, "enfusion-classes.json"), "utf-8");
      expect(enf.includes("\r\n")).toBe(true);
      expect(enf.replace(/\r\n/g, "").includes("\n")).toBe(false);
      // The layer's provenance goes into scrape-meta.json, in that file's stored form.
      const metaText = readFileSync(metaPath, "utf-8");
      expect(metaText.replace(/\r\n/g, "").includes("\n")).toBe(false);
      expect(JSON.parse(metaText)).toEqual({
        buildBranch: "x",
        sourceBackfill: {
          build: "test",
          inputsSha256: plantedIndex().header.inputs_sha256,
          files: ["enfusion-classes.json", "arma-classes.json"],
        },
      });
      // A second run writes nothing.
      const io2b = memoryIo();
      expect(runBackfillCli(["--api-dir", dir, "--source-index", indexFile, "--json"], io2b)).toBe(
        0,
      );
      const second = JSON.parse(io2b.stdout()) as {
        files: { status: string }[];
        scrape_meta: string;
      };
      expect(second.files.map((f) => f.status)).toEqual(["unchanged", "unchanged"]);
      expect(second.scrape_meta).toBe("unchanged");

      // Over the size cap: held back, written to the overflow folder instead.
      const io3 = memoryIo();
      const overflow = join(dir, "overflow");
      writeFileSync(
        join(dir, "enfusion-classes.json"),
        apiFileText(plantedFiles()[0].classes, true),
      );
      expect(
        runBackfillCli(
          [
            "--api-dir",
            dir,
            "--source-index",
            indexFile,
            "--max-lf-bytes",
            "100",
            "--overflow-dir",
            overflow,
          ],
          io3,
        ),
      ).toBe(1);
      expect(io3.stdout()).toContain("HELD BACK");
      expect(existsSync(join(overflow, "enfusion-classes.json"))).toBe(true);
      expect(readFileSync(join(dir, "enfusion-classes.json"), "utf-8")).toBe(
        apiFileText(plantedFiles()[0].classes, true),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Gate: the committed index against the real source index ──────────────────

const REAL_BUILD = "1.8.0.13";
const realIndexFile = ((): string | undefined => {
  try {
    const f = sourceIndexPath(REAL_BUILD, artifactsDir());
    return existsSync(f) ? f : undefined;
  } catch {
    return undefined;
  }
})();
const apiPaths = API_INDEX_FILES.map((f) => join(REPO_ROOT, "data", "api", f.file));
const hasApi = apiPaths.every((p) => existsSync(p));

/**
 * Losses E12 still counts that the backfill leaves on purpose, `Class.method/arity`
 * (or `Class (class)`) to the reason. The withheld inactive-branch alternatives
 * are listed by the backfill itself (`withheld`, with the guard and the method
 * they stand in for); the `typename` class is Doxygen's page `TypeName`, which
 * the backfill pairs by case and E12 pairs by exact name only.
 */
const TYPENAME_REASON =
  "held by Doxygen's page TypeName (same methods); E12 pairs class names exactly";
const KNOWN_RESIDUAL_LOSSES: Record<string, string> = {
  "typename (class)": TYPENAME_REASON,
  ...Object.fromEntries(
    [
      "ToString/0",
      "IsInherited/1",
      "Spawn/0",
      "GetVariableCount/0",
      "GetVariableName/1",
      "GetVariableType/1",
      "GetVariableValue/3",
      "GetVariableAttributes/2",
      "GetAttributes/1",
      "GetInheritedTypes/1",
      "EnumToString/2",
      "StringToEnum/2",
    ].map((m) => [`typename.${m}`, TYPENAME_REASON]),
  ),
};

/** Pak entries at build 1.8.0.13: 1,113 methods and 40 classes; 67 alternatives withheld. */
const PAK_METHODS = 1113;
const PAK_CLASSES = 40;
const WITHHELD = 67;

/** The 28 `WorldEditorAPI` methods the `/endcode` typos at lines 161 and 182 of WorldEditorAPI.c hid from Doxygen (E12). */
const WEA_TYPO_LOST = [
  "AddCommentEntity/4",
  "AddTerrainFlatterEntity/9",
  "AreGeneratorEventsEnabled/0",
  "BuildShoreMap/0",
  "CreateEntityInWindow/6",
  "CreateEntityInWindowEx/6",
  "DeleteEntities/1",
  "DeleteEntity/1",
  "GetCommentCategories/1",
  "GetCurrentEntityLayerId/0",
  "GetTerrainResolutionX/1",
  "GetTerrainResolutionY/1",
  "GetTerrainSurfaceTile/4",
  "GetTerrainTilesX/1",
  "GetTerrainTilesY/1",
  "GetTerrainUnitScale/1",
  "IsEntityLayerLocked/2",
  "IsEntityLayerLockedHierarchy/2",
  "LockEntityLayer/2",
  "MoveCommentEntity/2",
  "RegenerateFlowMaps/4",
  "RemoveCommentEntity/1",
  "RemoveTerrainFlatterEntity/2",
  "SetTerrainSurfaceTile/4",
  "ToggleGeneratorEvents/1",
  "TraceWorldPos/7",
  "TryGetTerrainSurfaceY/3",
  "UnlockEntityLayer/2",
];

const methodKeyOf = (m: MethodInfo): string =>
  `${signatureName(m.signature) ?? m.name}/${splitSignatureParams(m.signature).length}`;

// Needs only the committed files: runs on every machine that has data/api.
describe.skipIf(!hasApi)("committed API index (KD-013 guard)", { timeout: 120_000 }, () => {
  it("WorldEditorAPI holds 124 methods: the 96 from Doxygen plus the 28 backfilled, by name", () => {
    const enf = parseApiFileText(readFileSync(apiPaths[0], "utf-8")).classes;
    const wea = enf.find((c) => c.name === "WorldEditorAPI");
    expect(wea).toBeDefined();
    const all = [...wea!.methods, ...wea!.protectedMethods, ...wea!.staticMethods];
    const fromPak = all.filter((m) => (m as Partial<PakMethodInfo>).origin === "pak");
    const fromDoxygen = all.filter((m) => (m as Partial<PakMethodInfo>).origin !== "pak");
    expect(wea!.methods).toHaveLength(124);
    expect(fromDoxygen).toHaveLength(96);
    expect(fromPak.map(methodKeyOf).sort()).toEqual(WEA_TYPO_LOST);
    for (const m of fromPak)
      expect((m as PakMethodInfo).pakFile).toBe(
        "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c",
      );
  });

  it("every method's name is the identifier its own signature declares", () => {
    // Exceptions by rule, not by entry: an entry whose signature declares no
    // identifier before its `(` keeps its name (there are none at 1.8.0.13).
    const differ: string[] = [];
    let noIdentifier = 0;
    let checked = 0;
    for (const p of apiPaths)
      for (const c of parseApiFileText(readFileSync(p, "utf-8")).classes)
        for (const m of [...c.methods, ...c.protectedMethods, ...c.staticMethods]) {
          const id = typeof m.signature === "string" ? signatureName(m.signature) : undefined;
          if (id === undefined) {
            noIdentifier++;
            continue;
          }
          checked++;
          if (id !== m.name) differ.push(`${c.name}: ${m.name} | ${m.signature}`);
        }
    expect(differ.slice(0, 10)).toEqual([]);
    expect(differ).toHaveLength(0);
    expect(noIdentifier).toBe(0);
    expect(checked).toBeGreaterThan(100_000);
  });

  it("no class name is held twice by case (the typename/TypeName duplicate stays out)", () => {
    const names = apiPaths.flatMap((p) =>
      parseApiFileText(readFileSync(p, "utf-8")).classes.map((c) => c.name),
    );
    const pak = new Set(
      apiPaths.flatMap((p) =>
        parseApiFileText(readFileSync(p, "utf-8"))
          .classes.filter((c) => (c as Partial<PakMethodInfo>).origin === "pak")
          .map((c) => c.name.toLowerCase()),
      ),
    );
    const holders = names.filter((n) => pak.has(n.toLowerCase()));
    // Each pak class's lowercased name occurs once over both files.
    expect(holders.length).toBe(pak.size);
    expect(pak.size).toBe(PAK_CLASSES);
    expect(pak.has("typename")).toBe(false);
  });
});

describe.skipIf(!realIndexFile || !hasApi)(
  `committed API index against the source index (build ${REAL_BUILD})`,
  { timeout: 300_000 },
  () => {
    let index: NonNullable<ReturnType<typeof loadSourceIndex>>;
    let stored: ApiIndexFile[];
    let a: ReturnType<typeof analyze>;

    beforeAll(() => {
      const loaded = loadSourceIndex(REAL_BUILD, { file: realIndexFile });
      if (!loaded) throw new Error("source index vanished");
      index = loaded;
      const bytes = apiPaths.map((p) => readFileSync(p));
      stored = API_INDEX_FILES.map((f, i) => ({
        file: f.file,
        source: f.source,
        classes: parseApiFileText(bytes[i].toString("utf-8")).classes,
      }));
      a = analyze({
        build: REAL_BUILD,
        index,
        api: API_INDEX_FILES.map((f, i) => parseApiIndex(f.file, bytes[i])),
        inputs: [],
      });
    }, 300_000);

    it("Workbench API scope (DEC-018): zero methods lost and no class missing (E12's measure)", () => {
      const scopeLost = a.report.classes
        .filter((c) => inWorkbenchScope(c.source_file as string))
        .flatMap((c) =>
          (c.lost as { name: string; arity: number }[]).map(
            (m) => `${c.class}.${m.name}/${m.arity}`,
          ),
        );
      expect(scopeLost).toEqual([]);
      expect(a.report.classes_missing_from_index.filter((c) => c.in_workbench_scope)).toEqual([]);
      expect(a.rows.scopeClassesNotInIndex).toEqual([]);
    });

    it("WorldEditorAPI: E12 counts 124 declared, 124 indexed, none lost", () => {
      expect(a.report.worldeditorapi).toMatchObject({
        methods_declared_public_or_protected: 124,
        methods_in_index: 124,
        lost: 0,
      });
    });

    it("all classes: every remaining loss is listed with a reason", () => {
      const lost = a.report.classes.flatMap((c) =>
        (c.lost as { name: string; arity: number }[]).map((m) => `${c.class}.${m.name}/${m.arity}`),
      );
      const missing = a.report.classes_missing_from_index.map(
        (c) => `${c.class as string} (class)`,
      );
      const withheld = applySourceBackfill(
        stored.map((f) => ({ ...f, classes: JSON.parse(JSON.stringify(f.classes)) })),
        index,
      ).result.withheld;
      expect(withheld).toHaveLength(WITHHELD);
      const reasons = new Map<string, string>(Object.entries(KNOWN_RESIDUAL_LOSSES));
      for (const w of withheld) {
        expect(w.guards.length).toBeGreaterThan(0);
        reasons.set(
          `${w.class}.${w.method}/${w.arity}`,
          `${w.reason}: under ${w.guards.join(" & ")}, the other branch of ${w.alternativeOf}`,
        );
      }
      const residual = [...lost, ...missing];
      expect(residual.filter((k) => !reasons.has(k))).toEqual([]);
      // E12 counts the withheld alternatives apart from its losses and pairs
      // the typename class by case, as the backfill does: nothing is lost.
      expect(a.report.headline.methods).toMatchObject({
        lost_total: 0,
        inactive_branch_alternatives: WITHHELD,
        index_entries_params_array_longer_than_signature: 0,
        index_entries_params_array_shorter_than_signature: 0,
      });
    });

    it("per-class method-count check: no class is short of a method", () => {
      expect(methodCountCheck(stored, index)).toEqual([]);
    });

    it("the backfill is idempotent on the committed files and every pak entry cites a source declaration", () => {
      const s = applySourceBackfill(stored, index);
      expect(s.nameCorrections).toEqual([]);
      expect(s.corrections).toEqual([]);
      expect(s.result.added).toEqual([]);
      const decls = new Set(
        index.records
          .filter((r) => r.kind === "method" || r.kind === "class")
          .map((r) => `${r.file}#${r.line}#${r.name}`),
      );
      const guardsAt = new Map(
        index.records
          .filter((r) => r.kind === "method" || r.kind === "class")
          .map((r) => [`${r.file}#${r.line}#${r.name}`, r.guards]),
      );
      let pakMethods = 0;
      let pakClasses = 0;
      for (const f of stored)
        for (const c of f.classes) {
          const entries: (ClassInfo | MethodInfo)[] = [
            c,
            ...c.methods,
            ...c.protectedMethods,
            ...c.staticMethods,
          ];
          for (const e of entries) {
            const p = e as Partial<PakMethodInfo>;
            if (p.origin !== "pak") continue;
            if (e === c) pakClasses++;
            else pakMethods++;
            const k = `${p.pakFile}#${p.pakLine}#${e.name}`;
            expect(decls.has(k)).toBe(true);
            // The entry states the declaration's guards, and only when it has some.
            const g = guardsAt.get(k) ?? [];
            if (g.length > 0) expect(p.guards).toEqual(g);
            else expect("guards" in e).toBe(false);
          }
        }
      expect([pakMethods, pakClasses]).toEqual([PAK_METHODS, PAK_CLASSES]);
    });
  },
);
