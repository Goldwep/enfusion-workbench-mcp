/**
 * Audit H12 — modifiers must be consumed as modifiers (never as the type),
 * generic types must survive intact, and preprocessor / typedef / attribute
 * blocks must never surface as phantom fields.
 */
import { describe, it, expect } from "vitest";
import { parseScript } from "../../src/script-parser/parser.ts";

const MODIFIER_WORDS = [
  "static", "const", "protected", "private", "override", "proto", "native", "external",
  "sealed", "ref", "autoptr", "out", "inout", "notnull", "event", "owned", "volatile",
];

function inClass(body: string): string {
  return `class Foo {\n${body}\n}`;
}

describe("parseScript — H12 modifiers vs types", () => {
  it("static const string TAG — modifiers consumed, type is string", () => {
    const ast = parseScript(inClass(`static const string TAG = "x";`));
    expect(ast.diagnostics).toEqual([]);
    const f = ast.classes[0].fields;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ name: "TAG", type: "string", initializer: '"x"' });
    expect(f[0].modifiers).toEqual(["static", "const"]);
  });

  it("const float m_f = 1.0;", () => {
    const ast = parseScript(inClass(`const float m_f = 1.0;`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].fields[0]).toMatchObject({ name: "m_f", type: "float", modifiers: ["const"], initializer: "1.0" });
  });

  it("ref map<string, int> m_Map; — generic kept as one type string", () => {
    const ast = parseScript(inClass(`ref map<string, int> m_Map;`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].fields).toHaveLength(1);
    expect(ast.classes[0].fields[0]).toMatchObject({ name: "m_Map", type: "map<string, int>", modifiers: ["ref"] });
  });

  it("array<ref map<string, ref array<int>>> m_Nested; — nested generics balanced", () => {
    const ast = parseScript(inClass(`array<ref map<string, ref array<int>>> m_Nested;`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].fields).toHaveLength(1);
    expect(ast.classes[0].fields[0].name).toBe("m_Nested");
    expect(ast.classes[0].fields[0].type).toBe("array<ref map<string, ref array<int>>>");
  });

  it("generic initializer with comma does not split into phantom declarators", () => {
    const ast = parseScript(inClass(`protected ref map<ResourceName, int> m_MagazinesToSpawn = new map<ResourceName, int>();`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].fields).toHaveLength(1);
    expect(ast.classes[0].fields[0].initializer).toBe("new map < ResourceName , int > ( )");
  });

  it("multiple declarators share the type: int a, b = 2;", () => {
    const ast = parseScript(inClass(`int a, b = 2;`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].fields.map((f) => f.name)).toEqual(["a", "b"]);
    expect(ast.classes[0].fields[1].initializer).toBe("2");
  });

  it("sealed class Foo {} — sealed is a class modifier", () => {
    const ast = parseScript(`sealed class Foo {}`);
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes).toHaveLength(1);
    expect(ast.classes[0].name).toBe("Foo");
    expect(ast.classes[0].modifiers).toEqual(["sealed"]);
  });

  it("class Tpl<Class T> {} — template header parsed with type params", () => {
    const ast = parseScript(`class Tpl<Class T> { T m_Value; }\nclass Pair<Class K, Class V> : Base<K> {}`);
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes).toHaveLength(2);
    expect(ast.classes[0].name).toBe("Tpl");
    expect(ast.classes[0].typeParameters).toEqual(["Class T"]);
    expect(ast.classes[0].fields[0]).toMatchObject({ name: "m_Value", type: "T" });
    expect(ast.classes[1].typeParameters).toEqual(["Class K", "Class V"]);
    expect(ast.classes[1].baseClass).toBe("Base");
  });

  it("#ifdef WORKBENCH ... #endif around a member is trivia, never a field", () => {
    const src = `class Foo {
	#ifdef WORKBENCH
	#define FOO_DEBUG
	#endif
	#ifdef FOO_DEBUG
		static bool s_DebugRegistered = false;
	#endif
	int m_i;
#ifndef DISABLE_X
	void Bar() {}
#else
	void Baz() {}
#endif
}`;
    const ast = parseScript(src);
    expect(ast.diagnostics).toEqual([]);
    const names = ast.classes[0].fields.map((f) => f.name);
    expect(names).toEqual(["s_DebugRegistered", "m_i"]);
    expect(ast.classes[0].methods.map((m) => m.name)).toEqual(["Bar", "Baz"]);
    for (const f of ast.classes[0].fields) {
      expect(f.name.startsWith("#")).toBe(false);
      expect(f.type.startsWith("#")).toBe(false);
    }
  });

  it("[Attribute(...)] protected int m_i; — attribute attached, modifier consumed", () => {
    const ast = parseScript(inClass(`[Attribute("1", UIWidgets.Slider, "desc")] protected int m_i;`));
    expect(ast.diagnostics).toEqual([]);
    const f = ast.classes[0].fields;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ name: "m_i", type: "int", modifiers: ["protected"] });
    expect(f[0].attributes).toHaveLength(1);
    expect(f[0].attributes[0].name).toBe("Attribute");
    expect(f[0].attributes[0].args).toContain("UIWidgets");
  });

  it("[Attribute(...), RplProp(...)] — comma-separated attribute list yields one node each", () => {
    const ast = parseScript(
      inClass(`[Attribute(desc: "x", category: "Game Mode"), RplProp(onRplName: "OnChanged")]\nprotected ref array<EResourceType> m_aTypes;`),
    );
    expect(ast.diagnostics).toEqual([]);
    const f = ast.classes[0].fields[0];
    expect(f.name).toBe("m_aTypes");
    expect(f.type).toBe("array<EResourceType>");
    expect(f.attributes.map((a) => a.name)).toEqual(["Attribute", "RplProp"]);
  });

  it("typedef map<string, int> TStringIntMap; — parsed as typedef node, not a field", () => {
    const ast = parseScript(`typedef map<string, int> TStringIntMap;\ntypedef func OnThing;\nclass Foo { typedef array<int> TInts; int m_x; }`);
    expect(ast.diagnostics).toEqual([]);
    expect(ast.typedefs).toEqual([
      expect.objectContaining({ name: "TStringIntMap", type: "map<string, int>" }),
      expect.objectContaining({ name: "OnThing", type: "func" }),
    ]);
    expect(ast.classes[0].fields.map((f) => f.name)).toEqual(["m_x"]);
  });

  it("override void EOnFrame(IEntity owner, float timeSlice) — modifier + params", () => {
    const ast = parseScript(inClass(`override void EOnFrame(IEntity owner, float timeSlice) { super.EOnFrame(owner, timeSlice); }`));
    expect(ast.diagnostics).toEqual([]);
    const m = ast.classes[0].methods[0];
    expect(m).toMatchObject({ name: "EOnFrame", returnType: "void", modifiers: ["override"] });
    expect(m.parameters).toEqual([
      { type: "IEntity", name: "owner", defaultValue: undefined },
      { type: "float", name: "timeSlice", defaultValue: undefined },
    ]);
    expect(ast.classes[0].fields).toHaveLength(0);
  });

  it("proto native external void Foo(); — three modifiers, bodiless", () => {
    const ast = parseScript(inClass(`proto native external void Foo();\nproto external int Bar(notnull IEntity e, out int result);`));
    expect(ast.diagnostics).toEqual([]);
    const [foo, bar] = ast.classes[0].methods;
    expect(foo).toMatchObject({ name: "Foo", returnType: "void", modifiers: ["proto", "native", "external"], bodyText: null });
    expect(bar.parameters).toEqual([
      { type: "notnull IEntity", name: "e", defaultValue: undefined },
      { type: "out int", name: "result", defaultValue: undefined },
    ]);
    expect(ast.classes[0].fields).toHaveLength(0);
  });

  it("operator overload is parsed as a method named operator<op>", () => {
    const ast = parseScript(inClass(`bool operator==(Foo other) { return true; }\nFoo operator[](int i) { return this; }`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].methods.map((m) => m.name)).toEqual(["operator==", "operator[]"]);
    expect(ast.classes[0].methods[0].returnType).toBe("bool");
    expect(ast.classes[0].fields).toHaveLength(0);
  });

  it("modded class X : Y with super calls — body captured, no phantom fields", () => {
    const ast = parseScript(`modded class SCR_PlayerController : PlayerController {
	protected ref array<ref map<string, int>> m_aStats;
	override void OnInit(IEntity owner) { super.OnInit(owner); m_aStats = {}; }
	override protected void OnDestroyed() { super.OnDestroyed(); }
}`);
    expect(ast.diagnostics).toEqual([]);
    const cls = ast.classes[0];
    expect(cls.kind).toBe("modded_class");
    expect(cls.baseClass).toBe("PlayerController");
    expect(cls.fields.map((f) => f.name)).toEqual(["m_aStats"]);
    expect(cls.methods.map((m) => m.name)).toEqual(["OnInit", "OnDestroyed"]);
    expect(cls.methods[0].bodyText).toContain("super.OnInit(owner)");
    expect(cls.methods[1].modifiers).toEqual(["override", "protected"]);
  });

  it("destructor and constructor shapes", () => {
    const ast = parseScript(inClass(`void Foo(IEntityComponentSource src, IEntity ent, IEntity parent) {}\nvoid ~Foo() {}\n~Foo();`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].methods.map((m) => m.name)).toEqual(["Foo", "~Foo", "~Foo"]);
  });

  it("modifier words used as parameter / field names are still names", () => {
    const ast = parseScript(inClass(`int event;\nvoid Handle(SCR_Event event, int owned = 3) {}`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].fields[0]).toMatchObject({ name: "event", type: "int", modifiers: [] });
    expect(ast.classes[0].methods[0].parameters).toEqual([
      { type: "SCR_Event", name: "event", defaultValue: undefined },
      { type: "int", name: "owned", defaultValue: "3" },
    ]);
  });

  it("static array declarators keep the suffix on the type", () => {
    const ast = parseScript(inClass(`static const string NAMES[] = { "a", "b" };\nint m_arr[4];`));
    expect(ast.diagnostics).toEqual([]);
    expect(ast.classes[0].fields[0]).toMatchObject({ name: "NAMES", type: "string[]" });
    expect(ast.classes[0].fields[1]).toMatchObject({ name: "m_arr", type: "int[4]" });
  });

  it("top-level enums, global prototypes and typedefs are captured, never as classes", () => {
    const ast = parseScript(`enum EFoo { A, B = 2, C }
enum EBar : EFoo { D }
void SCR_OnThing(notnull SCR_Ctx ctx);
typedef func SCR_OnThing;
class Real {}`);
    expect(ast.diagnostics).toEqual([]);
    expect(ast.enums.map((e) => e.name)).toEqual(["EFoo", "EBar"]);
    expect(ast.enums[0].members).toEqual(["A", "B", "C"]);
    expect(ast.enums[1].baseType).toBe("EFoo");
    expect(ast.functions.map((f) => f.name)).toEqual(["SCR_OnThing"]);
    expect(ast.classes.map((c) => c.name)).toEqual(["Real"]);
  });

  it("never emits a field whose name or type is a bare modifier word", () => {
    const src = `class Foo {
	const static string A = "1";
	protected ref ScriptInvoker Event_OnStart = new ScriptInvoker();
	protected ref ScriptInvokerBase<SCR_Id> m_OnId = new ScriptInvokerBase<SCR_Id>();
	private static const int MAX = 3;
	autoptr Widget m_w;
	typename m_type;
	proto native void Native();
}`;
    const ast = parseScript(src);
    expect(ast.diagnostics).toEqual([]);
    for (const f of ast.classes[0].fields) {
      expect(MODIFIER_WORDS).not.toContain(f.name);
      expect(MODIFIER_WORDS).not.toContain(f.type);
      expect(f.type).not.toBe("auto");
    }
    expect(ast.classes[0].fields.map((f) => f.name)).toEqual(["A", "Event_OnStart", "m_OnId", "MAX", "m_w", "m_type"]);
    expect(ast.classes[0].fields[2].type).toBe("ScriptInvokerBase<SCR_Id>");
  });

  it("recovers from a bad member without cascading and still reports it", () => {
    const ast = parseScript(inClass(`int = 5;\nint m_ok;`));
    expect(ast.diagnostics.length).toBeGreaterThan(0);
    expect(ast.diagnostics.length).toBeLessThanOrEqual(2);
    expect(ast.classes[0].fields.map((f) => f.name)).toEqual(["m_ok"]);
  });
});
