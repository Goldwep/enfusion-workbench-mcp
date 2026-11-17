/**
 * Enforce linter (plan 5.4 step 1): synthetic handler sources checked against
 * a synthetic source index built through the E02 parser, the CLI's exit codes,
 * and a block (skipped when the build's source index is absent) that runs the
 * real check on the shipped handler bundle under mod/.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryIo } from "../../scripts/census/cli-common.js";

const SHIPPED_DIR = fileURLToPath(
  new URL("../../mod/Scripts/WorkbenchGame/EnfusionMCP", import.meta.url),
);
import { run as runLint } from "../../scripts/enforce-lint.js";
import {
  lintEnforceFiles,
  type LintInput,
  type LintReport,
} from "../../src/census/enforce-lint.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  saveSourceIndex,
  type SourceIndex,
} from "../../src/census/source-index.js";

const BUILD = "1.0.0.1";

/** A small engine: an API class with prototypes, a module hierarchy, an enum, JsonApiStruct, typedefs. */
const ENGINE: { path: string; text: string }[] = [
  {
    path: "scripts/Core/proto/Types.c",
    text: [
      "class Class",
      "{",
      "\tproto native external typename Type();",
      "\tproto static Class Cast(Class from);",
      "}",
      "class Managed",
      "{",
      "\tproto external Managed Clone();",
      "}",
      "sealed class string",
      "{",
      "\tstatic const string Empty;",
      "\tproto external int Length();",
      "\tproto external string Substring(int start, int len);",
      "}",
      "sealed class int",
      "{",
      "\tproto string ToString(int len = -1);",
      "}",
      "sealed class bool",
      "{",
      "}",
      "sealed class vector",
      "{",
      "}",
      "class array<Class T> : Managed",
      "{",
      "\tproto external int Count();",
      "\tproto int Insert(T value);",
      "\tproto T Get(int n);",
      "}",
      "typedef array<string> TStringArray;",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Modules/WBModuleDef.c",
    text: [
      "class WBModuleDef",
      "{",
      "\tproto external bool ExecuteAction(notnull array<string> menuPath, bool bKeepFocus = true);",
      "}",
      "class WorldEditor : WBModuleDef",
      "{",
      "\tproto external WorldEditorAPI GetApi();",
      "\tproto external bool GetTerrainBounds(out vector min, out vector max);",
      "}",
    ].join("\n"),
  },
  {
    path: "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c",
    text: [
      "sealed class WorldEditorAPI",
      "{",
      "\tproto external int GetEditorEntityCount();",
      "\tproto external bool SetVariableValue(BaseContainer top, array<ref ContainerIdPathEntry> path, string key, string value);",
      "}",
      "class BaseContainer",
      "{",
      "\tproto external string GetName();",
      "}",
      "class ContainerIdPathEntry",
      "{",
      "\tvoid ContainerIdPathEntry(string name, int index = -1);",
      "}",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/Workbench.c",
    text: [
      "sealed class Workbench",
      "{",
      "\tstatic proto WBModuleDef GetModule(typename type);",
      "\tstatic proto int OpenModule(typename type);",
      "}",
      "enum LogLevel",
      "{",
      "\tNORMAL,",
      "\tWARNING,",
      "}",
      "enum ELogLevelExtra : LogLevel",
      "{",
      "\tVERBOSE,",
      "}",
      "proto void Print(void var, LogLevel level = LogLevel.NORMAL);",
      "proto void PrintFormat(string fmt, void param1 = NULL, void param2 = NULL, LogLevel level = LogLevel.NORMAL);",
      "proto native vector Vector(float x, float y, float z);",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/online/JsonApiStruct.c",
    text: [
      "class JsonApiStruct : Managed",
      "{",
      "\tproto external void RegV(string name);",
      "\tproto external void StoreString(string name, string value);",
      "\tvoid OnPack();",
      "}",
      "class NetApiHandler",
      "{",
      "\tJsonApiStruct GetRequest();",
      "\tJsonApiStruct GetResponse(JsonApiStruct request);",
      "}",
      "class Attribute",
      "{",
      "}",
    ].join("\n"),
  },
  {
    path: "scripts/Game/Weapons/SCR_Gun.c",
    text: [
      "class SCR_Gun",
      "{",
      "\tvoid Reload();",
      "}",
      "modded class WorldEditor",
      "{",
      "\tvoid ModdedHelper();",
      "}",
    ].join("\n"),
  },
];

function engineIndex(): SourceIndex {
  return buildSourceIndex(ENGINE, { build: BUILD });
}

const HANDLER_PATH = "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Test.c";

/** A handler skeleton: request / response classes and GetResponse with `body` inside. */
function handler(body: string, extraMembers = ""): LintInput {
  return {
    path: HANDLER_PATH,
    text: [
      "class EMCP_WB_TestRequest : JsonApiStruct",
      "{",
      "\tstring name;",
      "\tvoid EMCP_WB_TestRequest()",
      "\t{",
      '\t\tRegV("name");',
      "\t}",
      "}",
      "class EMCP_WB_TestResponse : JsonApiStruct",
      "{",
      "\tstring status;",
      "\tvoid EMCP_WB_TestResponse()",
      "\t{",
      '\t\tRegV("status");',
      "\t}",
      "}",
      "class EMCP_WB_Test : NetApiHandler",
      "{",
      extraMembers,
      "\toverride JsonApiStruct GetRequest()",
      "\t{",
      "\t\treturn new EMCP_WB_TestRequest();",
      "\t}",
      "\toverride JsonApiStruct GetResponse(JsonApiStruct request)",
      "\t{",
      "\t\tEMCP_WB_TestRequest req = EMCP_WB_TestRequest.Cast(request);",
      "\t\tEMCP_WB_TestResponse resp = new EMCP_WB_TestResponse();",
      "\t\tWorldEditor worldEditor = Workbench.GetModule(WorldEditor);",
      "\t\tWorldEditorAPI api = worldEditor.GetApi();",
      body,
      "\t\treturn resp;",
      "\t}",
      "}",
    ].join("\n"),
  };
}

function lint(body: string, extraMembers = ""): LintReport {
  return lintEnforceFiles(engineIndex(), [handler(body, extraMembers)]);
}

describe("enforce-lint level 1: resolved receivers", () => {
  it("passes a correct handler: static calls, typed locals, Cast, new, registrations", () => {
    const r = lint("\t\tint n = api.GetEditorEntityCount();\n\t\tresp.status = n.ToString();");
    const f = r.files[0];
    expect(f.failures).toEqual([]);
    expect(f.unresolved).toEqual([]);
    // RegV x2, GetRequest's new, Cast, new response, GetModule, GetApi, GetEditorEntityCount, ToString.
    expect(f.counts).toEqual({
      calls: 9,
      resolved: 9,
      failed_calls: 0,
      unresolved: 0,
      failures: 0,
      parse_errors: 0,
    });
    expect(r.totals.failures).toBe(0);
  });

  it("fails a call whose argument count fits no declaration, with the declaration as evidence", () => {
    const r = lint('\t\tapi.SetVariableValue(null, null, "coords");');
    expect(r.files[0].failures).toHaveLength(1);
    const x = r.files[0].failures[0];
    expect(x).toMatchObject({
      check: "arity",
      line: 30,
      expression: 'api.SetVariableValue(null, null, "coords")',
    });
    expect(x.what).toContain("called with 3 arguments; its declarations take 4");
    expect(x.candidates[0]).toContain(
      "WorldEditorAPI.SetVariableValue/4 | pak:scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c#L4",
    );
  });

  it("fails a method that exists only on another class (a name-only match is not enough)", () => {
    const r = lint("\t\tTStringArray path = {};\n\t\tapi.ExecuteAction(path);");
    const x = r.files[0].failures;
    expect(x).toHaveLength(1);
    expect(x[0].check).toBe("method");
    expect(x[0].what).toContain(
      "WorldEditorAPI (chain WorldEditorAPI > Managed > Class) has no method ExecuteAction",
    );
    expect(x[0].candidates.some((c) => c.startsWith("WBModuleDef.ExecuteAction/1..2 | pak:"))).toBe(
      true,
    );
  });

  it("resolves an inherited method and a method added by a modded class", () => {
    const r = lint(
      "\t\tTStringArray path = {};\n\t\tworldEditor.ExecuteAction(path);\n\t\tworldEditor.ExecuteAction(path, false);\n\t\tworldEditor.ModdedHelper();",
    );
    expect(r.files[0].failures).toEqual([]);
    expect(r.files[0].unresolved).toEqual([]);
  });

  it("counts out parameters as required and lets default parameters be left out", () => {
    const ok = lint(
      '\t\tvector a, b;\n\t\tworldEditor.GetTerrainBounds(a, b);\n\t\tnew ContainerIdPathEntry("m_x");\n\t\tnew ContainerIdPathEntry("m_x", 2);',
    );
    expect(ok.files[0].failures).toEqual([]);
    const bad = lint(
      "\t\tvector a;\n\t\tworldEditor.GetTerrainBounds(a);\n\t\tnew ContainerIdPathEntry();",
    );
    expect(bad.files[0].failures.map((f) => `${f.check}@${f.line}`)).toEqual([
      "arity@31",
      "arity@32",
    ]);
    expect(bad.files[0].failures[1].what).toBe(
      "no constructor of ContainerIdPathEntry takes 0 arguments",
    );
  });

  it("types chained calls and generic elements through declared return types and typedefs", () => {
    const r = lint(
      "\t\tTStringArray parts = {};\n\t\tint len = parts.Get(0).Length();\n\t\tparts[0].Substring(0);",
    );
    const f = r.files[0];
    expect(f.failures.map((x) => `${x.check}:${x.expression}`)).toEqual([
      "arity:parts[0].Substring(0)",
    ]);
    expect(f.unresolved).toEqual([]);
  });

  it("fails a Cast to a class that does not exist, and a declaration of an unknown type", () => {
    const r = lint("\t\tEMCP_Missing m = EMCP_Missing.Cast(request);");
    const x = r.files[0].failures.map((f) => `${f.check}:${f.expression}`);
    expect(x).toEqual(["class:EMCP_Missing m", "class:EMCP_Missing.Cast(request)"]);
  });

  it("fails an unknown enum value and suggests the near one", () => {
    const r = lint('\t\tPrint("x", LogLevel.WARNNIG);\n\t\tPrint("y", LogLevel.WARNING);');
    const x = r.files[0].failures;
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({
      check: "enum-value",
      expression: "LogLevel.WARNNIG",
      candidates: ["LogLevel.WARNING"],
    });
  });

  it("fails an unqualified call that is neither a method of the class chain nor a global function", () => {
    const r = lint("\t\tFrobnicate(1);");
    expect(r.files[0].failures.map((f) => f.check)).toEqual(["function"]);
  });

  it("fails an instance method called through the class name", () => {
    const r = lint("\t\tWorldEditorAPI.GetEditorEntityCount();");
    expect(r.files[0].failures.map((f) => f.check)).toEqual(["static"]);
  });

  it("fails a member variable the class does not declare", () => {
    const r = lint('\t\tresp.stauts = "ok";');
    expect(r.files[0].failures.map((f) => `${f.check}:${f.expression}`)).toEqual([
      "field:resp.stauts",
    ]);
  });

  it("fails RegV of a key the class does not declare, and an unknown attribute class", () => {
    const r = lintEnforceFiles(engineIndex(), [
      {
        path: HANDLER_PATH,
        text: [
          "class EMCP_WB_BadRequest : JsonApiStruct",
          "{",
          "\t[Attribute()]",
          "\tstring name;",
          "\t[NoSuchAttribute()]",
          "\tint count;",
          "\tvoid EMCP_WB_BadRequest()",
          "\t{",
          '\t\tRegV("name");',
          '\t\tRegV("cuont");',
          "\t}",
          "}",
        ].join("\n"),
      },
    ]);
    expect(r.files[0].failures.map((f) => `${f.check}@${f.line}`)).toEqual([
      "attribute@5",
      "registration@10",
    ]);
    expect(r.files[0].failures[1].candidates).toEqual(["near: count"]);
    expect(r.files[0].notes.map((n) => n.message)).toContain(
      "EMCP_WB_BadRequest.count is declared but never registered with RegV (not serialised unless written in OnPack)",
    );
  });
});

describe("enforce-lint: forms vanilla compiles", () => {
  it("fits named arguments by parameter name, positional ones after them continuing from there", () => {
    const ok = lint(
      '\t\tPrint("x", level: LogLevel.WARNING);\n\t\tPrintFormat("%1", level: LogLevel.WARNING);\n\t\tPrintFormat("%1 %2", param2: 1, LogLevel.NORMAL);',
    );
    expect(ok.files[0].failures).toEqual([]);
    expect(ok.files[0].notes).toEqual([]);
    const bad = lint('\t\tPrint("x", lvl: LogLevel.WARNING);');
    expect(bad.files[0].failures.map((f) => f.check)).toEqual(["arity"]);
  });

  it("reads a trailing comma, ClassName(args) and Type name(args) as the engine does", () => {
    const r = lint(
      '\t\tvector v = Vector(1, 2, 3, );\n\t\tContainerIdPathEntry e = ContainerIdPathEntry("m_x");\n\t\tContainerIdPathEntry f("m_y", 1);\n\t\tContainerIdPathEntry g(1, 2, 3);',
    );
    const f = r.files[0];
    expect(f.failures.map((x) => `${x.check}:${x.expression}`)).toEqual([
      "arity:ContainerIdPathEntry g(1, 2, 3)",
    ]);
    expect(f.notes).toEqual([]);
  });

  it("follows an enum's base enum, and treats a parentless script class as Managed", () => {
    const r = lint(
      "\t\tPrint(1, ELogLevelExtra.WARNING);\n\t\tPrint(1, ELogLevelExtra.VERBOSE);\n\t\treq.Clone();",
    );
    expect(r.files[0].failures).toEqual([]);
  });

  it("checks that a super call's method exists, not its arguments", () => {
    const members = [
      "\toverride JsonApiStruct GetResponse(JsonApiStruct request, int extra)",
      "\t{",
      "\t\tsuper.GetResponse(request, extra);",
      "\t\tsuper.NoSuchParentMethod();",
      "\t\treturn null;",
      "\t}",
    ].join("\n");
    const r = lint("", members);
    expect(r.files[0].failures.map((f) => `${f.check}:${f.expression}`)).toEqual([
      "method:super.NoSuchParentMethod()",
    ]);
  });

  it("names the #ifdef guards around a failure", () => {
    const r = lint("#ifdef SOME_DEBUG\n\t\tapi.NotThere();\n#endif");
    expect(r.files[0].failures.map((f) => f.guards)).toEqual([["SOME_DEBUG"]]);
  });
});

describe("enforce-lint: initializer lists, access, static context, duplicate classes", () => {
  it("does not read the commas of a brace initializer list as declarators", () => {
    const members = [
      "\tvoid Init(string s1, string s2, WorldEditorAPI api)",
      "\t{",
      "\t\tTStringArray x = {s1, s2, s2.Length().ToString()};",
      "\t\tTStringArray y = {s1, s2, s2.Count().ToString()};",
      "\t\tarray<int> z = {1, api, api.GetEditorEntityCount()};",
      "\t\tvector a, b;",
      "\t}",
    ].join("\n");
    const r = lint("", members);
    // Only s2.Count() fails: s2 stays a string inside the list, api stays a WorldEditorAPI.
    expect(r.files[0].failures.map((f) => `${f.check}:${f.expression}`)).toEqual([
      "method:s2.Count()",
    ]);
    expect(r.files[0].failures[0].what).toMatch(/^string \(chain string\) has no method Count/);
  });

  it("fails a private or protected member used from outside the class, and allows it inside", () => {
    const r = lintEnforceFiles(engineIndex(), [
      {
        path: HANDLER_PATH,
        text: [
          "class EMCP_Locked",
          "{",
          "\tprotected int m_secret;",
          "\tprivate void Hidden() {}",
          "\tprotected void Guarded() {}",
          "\tvoid Open() { Hidden(); Guarded(); m_secret = 1; }",
          "}",
          "class EMCP_Derived : EMCP_Locked",
          "{",
          "\tvoid G(EMCP_Locked other) { Guarded(); other.Guarded(); Hidden(); }",
          "}",
          "class EMCP_Outsider",
          "{",
          "\tvoid H(EMCP_Locked l) { l.Hidden(); l.Guarded(); l.m_secret = 2; l.Open(); }",
          "}",
        ].join("\n"),
      },
    ]);
    expect(r.files[0].failures.map((f) => `${f.check}@${f.line}:${f.expression}`)).toEqual([
      "access@10:Hidden()",
      "access@14:l.Guarded()",
      "access@14:l.Hidden()",
      "access@14:l.m_secret",
    ]);
    expect(r.files[0].failures[1].what).toBe(
      "EMCP_Locked.Guarded is protected in EMCP_Locked and used from EMCP_Outsider, which does not derive from it",
    );
  });

  it("fails an instance method, this or super used from a static method", () => {
    const members = [
      "\tstatic void Stat()",
      "\t{",
      "\t\tInst();",
      "\t\tthis.Inst();",
      "\t\tStatToo();",
      "\t}",
      "\tstatic void StatToo() {}",
      "\tvoid Inst() { StatToo(); this.Inst(); }",
    ].join("\n");
    const r = lint("", members);
    expect(r.files[0].failures.map((f) => `${f.check}@${f.line}:${f.expression}`)).toEqual([
      "static@21:Inst()",
      "static@22:this",
    ]);
  });

  it("does not type a static array as its element", () => {
    const r = lint(
      "\t\tBaseContainer arr[4];\n\t\tarr.GetName();\n\t\tarr[0].GetName();\n\t\tarr.NoSuchOnArr();",
    );
    const f = r.files[0];
    expect(f.failures).toEqual([]);
    expect(f.unresolved.map((u) => `${u.line}:${u.expression}:${u.reason}`)).toEqual([
      "31:arr.GetName():call on the static array BaseContainer[]",
      "33:arr.NoSuchOnArr():call on the static array BaseContainer[]",
    ]);
  });

  it("fails a plain declaration of a class the index already declares, not a modded one", () => {
    const r = lintEnforceFiles(engineIndex(), [
      {
        path: HANDLER_PATH,
        text: [
          "class WorldEditorAPI",
          "{",
          "\tvoid Mine() {}",
          "}",
          "modded class WorldEditor",
          "{",
          "\tvoid Fine() {}",
          "}",
        ].join("\n"),
      },
    ]);
    const x = r.files[0].failures;
    expect(x.map((f) => `${f.check}@${f.line}`)).toEqual(["class@1"]);
    expect(x[0].what).toContain("class WorldEditorAPI is already declared");
    expect(x[0].candidates[0]).toContain(
      "pak:scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c#L1",
    );
  });
});

describe("enforce-lint: out / inout parameters of engine pointer types (W1 first live compile)", () => {
  /** ENGINE plus a pointer-rooted chain and a Managed-rooted engine class, as 1.9.0.37 declares them. */
  function pointerIndex(): SourceIndex {
    return buildSourceIndex(
      [
        ...ENGINE,
        {
          path: "scripts/Core/proto/Pointers.c",
          text: [
            "class pointer",
            "{",
            "}",
            "class global_pointer : pointer",
            "{",
            "}",
            "class BaseResourceObject : global_pointer",
            "{",
            "}",
            "class IEntitySource : BaseResourceObject",
            "{",
            "}",
            "class EngineHandle : pointer",
            "{",
            "}",
            "class IEntity : Managed",
            "{",
            "}",
            "enum TraceFlags",
            "{",
            "\tWORLD,",
            "}",
          ].join("\n"),
        },
      ],
      { build: BUILD },
    );
  }

  function lintHelper(lines: string[]): LintReport {
    return lintEnforceFiles(pointerIndex(), [
      { path: HANDLER_PATH, text: ["class EMCP_WB_Helper", "{", ...lines, "}"].join("\n") },
    ]);
  }

  it("fails out and inout of a type whose chain reaches pointer, quoting the compile error", () => {
    const r = lintHelper([
      "\tstatic bool A(string s, out IEntitySource src, out int index)",
      "\t{",
      "\t\tindex = 0;",
      "\t\treturn false;",
      "\t}",
      "\tstatic void B(inout EngineHandle h)",
      "\t{",
      "\t}",
    ]);
    const x = r.files[0].failures;
    expect(x.map((f) => `${f.check}@${f.line}`)).toEqual(["out-param@3", "out-param@8"]);
    expect(x[0].what).toContain("parameter src is out IEntitySource");
    expect(x[0].what).toContain("IEntitySource > BaseResourceObject > global_pointer > pointer");
    expect(x[0].what).toContain("Types 'Class' and 'IEntitySource' are unrelated");
    expect(x[1].what).toContain("parameter h is inout EngineHandle");
  });

  it("fails out of a parentless engine class from the explicit list (the index gives no Class ancestor)", () => {
    const r = lintHelper([
      "\tstatic void C(out BaseContainer c, out WorldEditorAPI api)",
      "\t{",
      "\t}",
    ]);
    const x = r.files[0].failures;
    expect(x.map((f) => `${f.check}@${f.line}`)).toEqual(["out-param@3", "out-param@3"]);
    for (const t of ["BaseContainer", "WorldEditorAPI"])
      expect(
        x.some((f) =>
          f.what.includes(`${t} is an engine class the source index gives no Class ancestor`),
        ),
        t,
      ).toBe(true);
  });

  it("passes out of values, arrays, enums, script classes and Managed engine classes, and plain engine parameters", () => {
    const r = lintHelper([
      "\tstatic void D(out string s, out int i, out bool b, out float f, out vector v, out TraceFlags t)",
      "\t{",
      "\t}",
      "\tstatic void E(notnull array<string> a, out EMCP_WB_Helper h, out IEntity e, IEntitySource src, notnull array<IEntitySource> found)",
      "\t{",
      "\t}",
      "\tstatic IEntitySource F(BaseContainer c)",
      "\t{",
      "\t\treturn null;",
      "\t}",
    ]);
    expect(r.files[0].failures.filter((f) => f.check === "out-param")).toEqual([]);
  });

  it("does not judge a prototype (no body): only script-declared functions", () => {
    const r = lintHelper(["\tproto native bool G(out IEntitySource src);"]);
    expect(r.files[0].failures.filter((f) => f.check === "out-param")).toEqual([]);
  });
});

describe("enforce-lint: reserved names (W2 run 1: Wait and vanilla failed the 1.9.0.37 compile)", () => {
  const reserved = (r: LintReport) =>
    r.files[0].failures.filter((f) => f.check === "reserved-name");

  it("fails a method named Wait, a local named vanilla, a parameter and a member", () => {
    const r = lint(
      "\t\tbool vanilla = true;",
      ["\tint Wait;", "\tstatic void Wait(int vanilla)", "\t{", "\t}"].join("\n"),
    );
    const x = reserved(r);
    expect(x.map((f) => f.what.split(":")[0])).toEqual(
      expect.arrayContaining([
        "member 'Wait'",
        "method 'Wait'",
        "parameter 'vanilla'",
        "local 'vanilla'",
      ]),
    );
    expect(x).toHaveLength(4);
    expect(x.every((f) => f.what.includes("1.9.0.37"))).toBe(true);
    expect(r.totals.files_failed).toBe(1);
  });

  it("notes, never fails, an unproven keyword or a case variant (event, volatile, wait, Vanilla)", () => {
    const r = lint(
      '\t\tint event = 0;\n\t\tstring Vanilla = "";',
      ["\tstatic void wait(int volatile)", "\t{", "\t}"].join("\n"),
    );
    expect(reserved(r)).toEqual([]);
    const notes = r.files[0].notes.map((n) => n.message);
    for (const n of ["'event'", "'Vanilla'", "'wait'", "'volatile'"])
      expect(
        notes.some((m) => m.includes(n)),
        n,
      ).toBe(true);
  });

  it("passes names that only contain a reserved word (WaitForResource, isVanillaAddon)", () => {
    const r = lint(
      "\t\tbool isVanillaAddon = false;",
      ["\tstatic void WaitForResource(int waitMs)", "\t{", "\t}"].join("\n"),
    );
    expect(reserved(r)).toEqual([]);
    expect(r.files[0].notes.filter((n) => /keyword/.test(n.message))).toEqual([]);
  });
});

describe("enforce-lint: malformed source", () => {
  // Each of these looped forever before unmatched inner openers were bounded.
  it.each([
    ["an unclosed call", "\t\tapi.GetEditorEntityCount(;"],
    ["a call closed by the wrong bracket", "\t\tapi.GetEditorEntityCount(];"],
    ["an unclosed call with an argument", "\t\tapi.SetVariableValue(null;"],
    ["an unclosed index", "\t\tTStringArray p = {};\n\t\tp[0;"],
  ])(
    "terminates on %s and fails the file with a parse error",
    (_label, body) => {
      const r = lint(body);
      const f = r.files[0];
      expect(f.parse_errors.some((e) => /is never closed|closes nothing/.test(e.message))).toBe(
        true,
      );
      expect(f.counts.parse_errors).toBe(f.parse_errors.length);
      expect(r.totals.parse_errors).toBeGreaterThan(0);
      expect(r.totals.files_failed).toBe(1);
    },
    10_000,
  );

  it("fails a file the E02 parser could not read even when no call fails", () => {
    const r = lintEnforceFiles(engineIndex(), [
      {
        path: HANDLER_PATH,
        text: "class EMCP_H6\n{\n\tvoid A()\n\t{\n\t}\n\t/* forgot to close\n\tvoid B(WorldEditorAPI api)\n\t{\n\t\tapi.NoSuchHidden();\n\t}\n}\n",
      },
    ]);
    expect(r.totals.failures).toBe(0);
    expect(r.files[0].parse_errors.map((e) => e.message)).toContain("unterminated block comment");
    expect(r.totals.files_failed).toBe(1);
  });
});

describe("enforce-lint level 2: unresolved receivers", () => {
  it("reports a call on an auto-typed local as unresolved, never as passed or failed", () => {
    const r = lint("\t\tauto mod = Workbench.GetModule(WorldEditor);\n\t\tmod.NoSuchMethod(1, 2);");
    const f = r.files[0];
    expect(f.failures).toEqual([]);
    expect(f.unresolved).toEqual([
      {
        file: HANDLER_PATH,
        line: 31,
        method: "NoSuchMethod",
        expression: "mod.NoSuchMethod(1, 2)",
        reason: "auto-typed local mod",
      },
    ]);
    expect(f.counts.unresolved).toBe(1);
    expect(r.totals.failures).toBe(0);
  });

  it("reports a call on a class whose ancestor the index does not hold as unresolved", () => {
    const r = lintEnforceFiles(engineIndex(), [
      {
        path: HANDLER_PATH,
        text: "class EMCP_A : SomethingUnknown\n{\n\tvoid F()\n\t{\n\t\tEMCP_A a;\n\t\ta.Whatever();\n\t}\n}\n",
      },
    ]);
    const f = r.files[0];
    expect(f.failures.map((x) => x.check)).toEqual(["class"]); // the parent itself
    expect(f.unresolved.map((u) => u.reason)).toEqual([
      "EMCP_A has an ancestor the index does not hold (SomethingUnknown)",
    ]);
  });
});

describe("enforce-lint determinism and contracts", () => {
  it("produces byte-identical reports for the same input", () => {
    const input = handler(
      '\t\tauto x = api;\n\t\tx.A();\n\t\tapi.B();\n\t\tPrint("x", LogLevel.NOPE);',
    );
    const a = JSON.stringify(lintEnforceFiles(engineIndex(), [input]));
    const b = JSON.stringify(lintEnforceFiles(engineIndex(), [input]));
    expect(a).toBe(b);
  });

  it("skips the contract check with a run note when no contracts are given, and compares keys when they are", () => {
    const input = handler("");
    expect(lintEnforceFiles(engineIndex(), [input]).notes[0]).toMatch(
      /^contracts: no contracts directory given/,
    );
    const r = lintEnforceFiles(engineIndex(), [input], {
      contracts: new Map([["EMCP_WB_Test", { request: ["name", "extra"], response: ["status"] }]]),
    });
    expect(r.notes).toEqual([]);
    expect(r.files[0].failures.map((f) => `${f.check}:${f.what}`)).toEqual([
      'contract:the contract lists request key "extra", which EMCP_WB_Test does not register',
    ]);
  });
});

describe("enforce-lint CLI", () => {
  function fixture(): { index: string; dir: string; good: string; bad: string } {
    const dir = mkdtempSync(join(tmpdir(), "enforce-lint-"));
    const index = saveSourceIndex(engineIndex(), {
      file: join(dir, "index", "source-index.jsonl"),
    });
    const good = join(dir, "good.c");
    const bad = join(dir, "bad.c");
    writeFileSync(good, handler("").text);
    writeFileSync(bad, handler("\t\tapi.GetEditorEntityCount(1);").text);
    return { index, dir, good, bad };
  }

  it("exits 0 when no level-1 failure, 1 when there is one, and prints totals", async () => {
    const fx = fixture();
    const io = memoryIo();
    expect(await runLint([fx.good, "--index", fx.index], io)).toBe(0);
    expect(io.stdout()).toContain("RESULT: PASS");
    const io2 = memoryIo();
    expect(await runLint([fx.bad, "--index", fx.index, "--json"], io2)).toBe(1);
    const json = JSON.parse(io2.stdout()) as LintReport & { ok: boolean };
    expect(json.ok).toBe(false);
    expect(json.totals).toMatchObject({ files: 1, failures: 1, failed_calls: 1 });
    expect(json.files[0].file).toBe("bad.c");
  });

  it("exits 2 with NO DATA when the source index is absent and no game install can build it", async () => {
    const fx = fixture();
    const empty = mkdtempSync(join(tmpdir(), "enforce-lint-art-"));
    const noGame = join(empty, "no-game");
    mkdirSync(noGame);
    const io = memoryIo();
    const code = await runLint(
      [fx.good, "--build", BUILD, "--artifacts", empty, "--game", noGame],
      io,
    );
    expect(code).toBe(2);
    expect(io.stdout()).toMatch(/^NO DATA/);
  });

  it("exits 1 with ok false on a file that does not parse, though no call fails", async () => {
    const fx = fixture();
    const broken = join(fx.dir, "broken.c");
    writeFileSync(broken, 'class EMCP_H7\n{\n\tvoid A()\n\t{\n\t\tstring s = "abc;\n\t}\n}\n');
    const io = memoryIo();
    expect(await runLint([broken, "--index", fx.index], io)).toBe(1);
    expect(io.stdout()).toContain("PARSE L5  unterminated string");
    expect(io.stdout()).toContain("RESULT: FAIL (parse errors");
    const io2 = memoryIo();
    expect(await runLint([broken, "--index", fx.index, "--json"], io2)).toBe(1);
    const json = JSON.parse(io2.stdout()) as LintReport & { ok: boolean };
    expect(json.ok).toBe(false);
    expect(json.totals).toMatchObject({ failures: 0, files_failed: 1 });
    expect(json.totals.parse_errors).toBeGreaterThan(0);
  });

  it("exits 2 when --contracts names no directory, instead of skipping every contract", async () => {
    const fx = fixture();
    const io = memoryIo();
    const code = await runLint(
      [fx.good, "--index", fx.index, "--contracts", join(fx.dir, "no-such-contracts")],
      io,
    );
    expect(code).toBe(2);
    expect(io.stderr()).toContain("--contracts is not a directory");
  });

  it("exits 2 on a usage error", async () => {
    const io = memoryIo();
    expect(await runLint(["--no-such-flag"], io)).toBe(2);
    const io2 = memoryIo();
    expect(await runLint([join(tmpdir(), "enforce-lint-missing", "x.c")], io2)).toBe(2);
  });
});

// ── Real handler bundle (skipped without the build's source index) ───────────

// The census's current build: the W1 handlers call 1.9-only API (GetSurfaceMaterials), so the
// bundle is linted against the build it ships for, the same default enforce-lint uses.
const REAL_BUILD = (
  JSON.parse(
    readFileSync(new URL("../../data/census/current-build.json", import.meta.url), "utf8"),
  ) as { tag: string }
).tag;
let realIndex: SourceIndex | undefined;
try {
  realIndex = loadSourceIndex(REAL_BUILD);
} catch {
  realIndex = undefined;
}

describe.skipIf(!realIndex)(
  `enforce-lint on the shipped handlers (source index ${REAL_BUILD})`,
  () => {
    it("lints every .c file under mod/ without crashing: all calls resolved, no failure", async () => {
      const io = memoryIo();
      const code = await runLint(["--build", REAL_BUILD, "--json"], io);
      const r = JSON.parse(io.stdout()) as LintReport;
      const shipped = readdirSync(SHIPPED_DIR).filter((f) => f.endsWith(".c"));
      // The shipped bundle grows with Phase 3 (DEC-048: Guard, BuildStamp, Info, Module, Container,
      // Plugin); the count is read from the folder, the invariants stay frozen.
      expect(r.files).toHaveLength(shipped.length);
      expect(r.files.map((f) => f.file.split("/").pop())).toContain("EMCP_WB_Common.c");
      expect(r.files.every((f) => f.parse_errors.length === 0)).toBe(true);
      expect(r.totals.files).toBe(shipped.length);
      expect(r.totals.files_failed).toBe(0);
      expect(r.totals.resolved).toBe(r.totals.calls);
      expect(r.totals.failed_calls).toBe(0);
      expect(r.totals.unresolved).toBe(0);
      expect(r.totals.failures).toBe(0);
      expect(code).toBe(0);
      const io2 = memoryIo();
      await runLint(["--build", REAL_BUILD, "--json"], io2);
      expect(io2.stdout()).toBe(io.stdout());
    }, 120_000);
  },
);
