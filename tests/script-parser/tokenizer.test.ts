import { describe, it, expect } from "vitest";
import { tokenize, withoutTrivia } from "../../src/script-parser/tokenizer.ts";

describe("tokenize", () => {
  it("emits eof for empty input", () => {
    const t = tokenize("");
    expect(t).toHaveLength(1);
    expect(t[0].type).toBe("eof");
  });

  it("identifies keywords vs identifiers", () => {
    const t = withoutTrivia(tokenize("class Foo"));
    expect(t[0].type).toBe("keyword");
    expect(t[0].text).toBe("class");
    expect(t[1].type).toBe("identifier");
    expect(t[1].text).toBe("Foo");
  });

  it("recognizes modded as keyword", () => {
    const t = withoutTrivia(tokenize("modded class Bar"));
    expect(t[0].text).toBe("modded");
    expect(t[0].type).toBe("keyword");
  });

  it("tracks line numbers", () => {
    const t = withoutTrivia(tokenize("class\nFoo"));
    expect(t[0].range.start.line).toBe(1);
    expect(t[1].range.start.line).toBe(2);
  });

  it("emits braces / parens / brackets / semicolons as distinct types", () => {
    const t = withoutTrivia(tokenize("{ } ( ) [ ] ; , :"));
    expect(t.map((x) => x.type)).toEqual([
      "lbrace",
      "rbrace",
      "lparen",
      "rparen",
      "attribute_open",
      "attribute_close",
      "semicolon",
      "comma",
      "colon",
      "eof",
    ]);
  });

  it("reads strings with escape sequences", () => {
    const t = withoutTrivia(tokenize(`"hello\\nworld"`));
    expect(t[0].type).toBe("string");
    expect(t[0].text).toBe(`"hello\\nworld"`);
    expect(t[0].value).toBe("hello\nworld");
  });

  it("reads numbers with optional float suffix; '-' is always operator (audit-fix C9)", () => {
    const t = withoutTrivia(tokenize("42 3.14 -5 1.5f"));
    // Sequence: 42 (number) 3.14 (number) - (punct) 5 (number) 1.5f (number) eof
    expect(t.map((x) => x.type)).toEqual([
      "number",
      "number",
      "punct",
      "number",
      "number",
      "eof",
    ]);
    expect(t[2].text).toBe("-");
    expect(t[3].text).toBe("5");
    expect(t[4].text).toBe("1.5f");
  });

  it("handles line + block comments", () => {
    const t = tokenize("// line comment\n/* block\ncomment */class Foo");
    const types = t.map((x) => x.type);
    expect(types).toContain("comment_line");
    expect(types).toContain("comment_block");
    expect(types).toContain("keyword");
  });

  it("emits multi-char operators as punct", () => {
    const t = withoutTrivia(tokenize("a == b && c::d"));
    const operators = t.filter((x) => x.type === "punct").map((x) => x.text);
    expect(operators).toContain("==");
    expect(operators).toContain("&&");
    expect(operators).toContain("::");
  });

  it("tokenizes a minimal class skeleton", () => {
    const src = `class Foo : Bar { int m_x; void Init() {} }`;
    const t = withoutTrivia(tokenize(src));
    const types = t.map((x) => x.type);
    expect(types[0]).toBe("keyword"); // class
    expect(types[1]).toBe("identifier"); // Foo
    expect(types[2]).toBe("colon");
    expect(types[3]).toBe("identifier"); // Bar
    expect(types[4]).toBe("lbrace");
  });

  it("tokenizes an attribute block", () => {
    const t = withoutTrivia(tokenize("[RPC(Reliable)]\nvoid F() {}"));
    expect(t[0].type).toBe("attribute_open");
    expect(t[1].type).toBe("identifier");
    expect(t[1].text).toBe("RPC");
    expect(t[2].type).toBe("lparen");
    expect(t[3].type).toBe("identifier");
    expect(t[4].type).toBe("rparen");
    expect(t[5].type).toBe("attribute_close");
  });
});
