import { describe, it, expect } from "vitest";
import { parseScript } from "../../src/script-parser/parser.ts";

describe("parseScript", () => {
  it("extracts a basic class", () => {
    const ast = parseScript(`class Foo {}`);
    expect(ast.classes).toHaveLength(1);
    expect(ast.classes[0].name).toBe("Foo");
    expect(ast.classes[0].kind).toBe("class");
    expect(ast.classes[0].baseClass).toBeNull();
  });

  it("extracts class with inheritance via colon", () => {
    const ast = parseScript(`class Child : Parent {}`);
    expect(ast.classes[0].baseClass).toBe("Parent");
  });

  it("extracts class with inheritance via extends keyword", () => {
    const ast = parseScript(`class Child extends Parent {}`);
    expect(ast.classes[0].baseClass).toBe("Parent");
  });

  it("recognizes modded class", () => {
    const ast = parseScript(`modded class SCR_PlayerController {}`);
    expect(ast.classes).toHaveLength(1);
    expect(ast.classes[0].kind).toBe("modded_class");
    expect(ast.classes[0].name).toBe("SCR_PlayerController");
    expect(ast.classes[0].baseClass).toBeNull();
  });

  it("extracts methods with parameters", () => {
    const ast = parseScript(`
      class Foo {
        void DoThing(int x, string name) {}
        int Compute(float a, float b) { return 0; }
      }
    `);
    const cls = ast.classes[0];
    expect(cls.methods).toHaveLength(2);
    expect(cls.methods[0].name).toBe("DoThing");
    expect(cls.methods[0].returnType).toBe("void");
    expect(cls.methods[0].parameters).toHaveLength(2);
    expect(cls.methods[0].parameters[0]).toEqual({ type: "int", name: "x" });
    expect(cls.methods[1].name).toBe("Compute");
    expect(cls.methods[1].returnType).toBe("int");
  });

  it("captures method body as opaque text", () => {
    const ast = parseScript(`
      class Foo {
        void Init() { Print("hello"); m_field = 42; }
      }
    `);
    const m = ast.classes[0].methods[0];
    expect(m.bodyText).toBeTruthy();
    expect(m.bodyText).toContain("Print");
    expect(m.bodyText).toContain('"hello"');
  });

  it("handles proto methods (semicolon, no body)", () => {
    const ast = parseScript(`
      class Foo {
        proto int GetThing(int x);
      }
    `);
    const m = ast.classes[0].methods[0];
    expect(m.bodyText).toBeNull();
    expect(m.modifiers).toContain("proto");
  });

  it("collects modifiers", () => {
    const ast = parseScript(`
      class Foo {
        protected static override void Init() {}
      }
    `);
    const m = ast.classes[0].methods[0];
    expect(m.modifiers).toEqual(["protected", "static", "override"]);
  });

  it("attaches attributes to methods", () => {
    const ast = parseScript(`
      class Foo {
        [RPC(RplChannel.Reliable)]
        void NotifyClient(int id) {}
      }
    `);
    const m = ast.classes[0].methods[0];
    expect(m.attributes).toHaveLength(1);
    expect(m.attributes[0].name).toBe("RPC");
    expect(m.attributes[0].args).toContain("Reliable");
  });

  it("attaches attributes to fields", () => {
    const ast = parseScript(`
      class Foo {
        [RplProp]
        int m_iScore;
      }
    `);
    const f = ast.classes[0].fields[0];
    expect(f.attributes).toHaveLength(1);
    expect(f.attributes[0].name).toBe("RplProp");
  });

  it("extracts field declarations with initializers", () => {
    const ast = parseScript(`
      class Foo {
        int m_iCount = 0;
        string m_sName = "default";
      }
    `);
    expect(ast.classes[0].fields).toHaveLength(2);
    expect(ast.classes[0].fields[0].name).toBe("m_iCount");
    expect(ast.classes[0].fields[0].type).toBe("int");
    expect(ast.classes[0].fields[0].initializer).toBe("0");
    expect(ast.classes[0].fields[1].name).toBe("m_sName");
    expect(ast.classes[0].fields[1].initializer).toBe('"default"');
  });

  it("extracts multiple classes in one file", () => {
    const ast = parseScript(`
      class A {}
      modded class B {}
      class C : A {}
    `);
    expect(ast.classes).toHaveLength(3);
    expect(ast.classes[0].name).toBe("A");
    expect(ast.classes[1].name).toBe("B");
    expect(ast.classes[1].kind).toBe("modded_class");
    expect(ast.classes[2].baseClass).toBe("A");
  });

  it("survives a malformed class", () => {
    const ast = parseScript(`
      class { not valid
      class Good {}
    `);
    // Should still find the good class even after the bad one.
    expect(ast.classes.some((c) => c.name === "Good")).toBe(true);
    expect(ast.diagnostics.length).toBeGreaterThan(0);
  });
});
