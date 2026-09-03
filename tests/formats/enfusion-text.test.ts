import { describe, it, expect } from "vitest";
import {
  parse,
  serialize,
  createNode,
  setProperty,
  getProperty,
  MAX_NODE_DEPTH,
  isNumericScalar,
} from "../../src/formats/enfusion-text.js";
import { generateGuid } from "../../src/formats/guid.js";

describe("generateGuid", () => {
  it("produces 16-char uppercase hex", () => {
    const guid = generateGuid();
    expect(guid).toMatch(/^[0-9A-F]{16}$/);
  });

  it("produces unique values", () => {
    const a = generateGuid();
    const b = generateGuid();
    expect(a).not.toBe(b);
  });
});

describe("enfusion-text parser", () => {
  it("parses minimal .gproj", () => {
    const input = `GameProject {
 ID "TestMod"
 GUID "6156F2F771D5D73D"
}`;
    const node = parse(input);
    expect(node.type).toBe("GameProject");
    expect(getProperty(node, "ID")).toBe("TestMod");
    expect(getProperty(node, "GUID")).toBe("6156F2F771D5D73D");
  });

  it("parses .gproj with dependencies", () => {
    const input = `GameProject {
 ID "MyMod"
 GUID "AAAAAAAAAAAAAAAA"
 TITLE "My Mod"
 Dependencies {
  "58D0FB3206B6F859"
 }
}`;
    const node = parse(input);
    expect(node.type).toBe("GameProject");
    expect(getProperty(node, "TITLE")).toBe("My Mod");

    const deps = node.children.find((c) => c.type === "Dependencies");
    expect(deps).toBeDefined();
    expect(deps!.values).toContain("58D0FB3206B6F859");
  });

  it("parses .gproj with nested configurations", () => {
    const input = `GameProject {
 ID "TestMod"
 GUID "BBBBBBBBBBBBBBBB"
 Configurations {
  GameProjectConfig PC {
   ScriptProjectManagerSettings ScriptProjectManagerSettings "{CCCCCCCCCCCCCCCC}" {
    Configurations {
     ScriptConfigurationClass workbench {
      Defines {
       "PLATFORM_WINDOWS" "ENF_WB" "WORKBENCH"
      }
     }
    }
   }
  }
  GameProjectConfig HEADLESS {
  }
 }
}`;
    const node = parse(input);
    expect(node.type).toBe("GameProject");

    const configs = node.children.find((c) => c.type === "Configurations");
    expect(configs).toBeDefined();
    expect(configs!.children.length).toBe(2);

    const pcConfig = configs!.children.find((c) => c.id === "PC");
    expect(pcConfig).toBeDefined();
    expect(pcConfig!.type).toBe("GameProjectConfig");
  });

  it("parses simple .et prefab", () => {
    const input = `GenericEntity : "{AABB}Prefabs/Base.et" {
 ID "1234567890ABCDEF"
 components {
  MeshObject "{5584D66370FCAEF1}" {
  }
 }
}`;
    const node = parse(input);
    expect(node.type).toBe("GenericEntity");
    expect(node.inheritance).toBe("{AABB}Prefabs/Base.et");
    expect(getProperty(node, "ID")).toBe("1234567890ABCDEF");

    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    expect(comps!.children.length).toBe(1);
    expect(comps!.children[0].type).toBe("MeshObject");
    expect(comps!.children[0].id).toBe("{5584D66370FCAEF1}");
  });

  it("parses .et with multiple components and properties", () => {
    const input = `GenericEntity {
 ID "DDDDDDDDDDDDDDDD"
 components {
  SCR_EditableEntityComponent "{EEEEEEEEEEEEEEEE}" {
   m_sDisplayName "Test Entity"
   m_bAutoRegister 1
  }
  ActionsManagerComponent "{FFFFFFFFFFFFFFFF}" {
   ActionContexts {
    UserActionContext "{1111111111111111}" {
     ContextName "default"
    }
   }
  }
 }
}`;
    const node = parse(input);
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    expect(comps!.children.length).toBe(2);

    const editable = comps!.children[0];
    expect(editable.type).toBe("SCR_EditableEntityComponent");
    expect(getProperty(editable, "m_sDisplayName")).toBe("Test Entity");
    expect(getProperty(editable, "m_bAutoRegister")).toBe("1");
  });

  it("handles empty blocks", () => {
    const input = `Empty {
}`;
    const node = parse(input);
    expect(node.type).toBe("Empty");
    expect(node.properties).toEqual([]);
    expect(node.children).toEqual([]);
    expect(node.values).toEqual([]);
  });
});

describe("enfusion-text serializer", () => {
  // L2-5.1 fixed: serializer now quotes mixed-case identifier-like values
  // (PascalCase, camelCase, lowercase) and emits bare only for numbers,
  // booleans, and ALL-UPPERCASE engine enums (e.g. `PC`, `HEADLESS`).
  it("serializes minimal node", () => {
    const node = createNode("GameProject", {
      properties: [
        { key: "ID", value: "TestMod" },
        { key: "GUID", value: "AAAA0000BBBB1111" },
      ],
    });
    const text = serialize(node);
    expect(text).toContain("GameProject {");
    expect(text).toContain('ID "TestMod"');
    expect(text).toContain('GUID "AAAA0000BBBB1111"');
    expect(text).toContain("}");
  });

  it("serializes node with inheritance", () => {
    const node = createNode("GenericEntity", {
      inheritance: "{GUID}Prefabs/Base.et",
      properties: [{ key: "ID", value: "1234567890ABCDEF" }],
    });
    const text = serialize(node);
    expect(text).toContain('GenericEntity : "{GUID}Prefabs/Base.et" {');
  });

  it("serializes node with quoted GUID id", () => {
    const node = createNode("MeshObject", {
      id: "5584D66370FCAEF1",
    });
    const text = serialize(node);
    expect(text).toContain('MeshObject "5584D66370FCAEF1" {');
  });

  it("serializes node with bare word id", () => {
    const node = createNode("GameProjectConfig", {
      id: "PC",
    });
    const text = serialize(node);
    expect(text).toContain("GameProjectConfig PC {");
  });

  it("serializes standalone values", () => {
    const node = createNode("Dependencies", {
      values: ["58D0FB3206B6F859"],
    });
    const text = serialize(node);
    expect(text).toContain('"58D0FB3206B6F859"');
  });

  it("serializes nested children", () => {
    const inner = createNode("MeshObject", { id: "AAAAAAAAAAAAAAAA" });
    const comps = createNode("components", { children: [inner] });
    const root = createNode("GenericEntity", {
      properties: [{ key: "ID", value: "BBBBBBBBBBBBBBBB" }],
      children: [comps],
    });
    const text = serialize(root);
    expect(text).toContain("GenericEntity {");
    expect(text).toContain("components {");
    expect(text).toContain('MeshObject "AAAAAAAAAAAAAAAA" {');
  });
});

describe("round-trip", () => {
  it("round-trips a .gproj", () => {
    const input = `GameProject {
 ID "MyMod"
 GUID "6156F2F771D5D73D"
 TITLE "My Mod"
 Dependencies {
  "58D0FB3206B6F859"
 }
}`;
    const node = parse(input);
    const output = serialize(node);
    // Re-parse the output to verify structural equivalence
    const node2 = parse(output);
    expect(node2.type).toBe(node.type);
    expect(getProperty(node2, "ID")).toBe(getProperty(node, "ID"));
    expect(getProperty(node2, "GUID")).toBe(getProperty(node, "GUID"));
    expect(getProperty(node2, "TITLE")).toBe(getProperty(node, "TITLE"));
    const deps1 = node.children.find((c) => c.type === "Dependencies");
    const deps2 = node2.children.find((c) => c.type === "Dependencies");
    expect(deps2!.values).toEqual(deps1!.values);
  });

  it("round-trips an .et prefab", () => {
    const input = `GenericEntity : "{AABB}Prefabs/Base.et" {
 ID "1234567890ABCDEF"
 components {
  MeshObject "{5584D66370FCAEF1}" {
  }
  SCR_EditableEntityComponent "{CCCCCCCCCCCCCCCC}" {
   m_sDisplayName "Test"
  }
 }
}`;
    const node = parse(input);
    const output = serialize(node);
    const node2 = parse(output);
    expect(node2.type).toBe("GenericEntity");
    expect(node2.inheritance).toBe("{AABB}Prefabs/Base.et");
    const comps = node2.children.find((c) => c.type === "components");
    expect(comps!.children.length).toBe(2);
    expect(comps!.children[0].type).toBe("MeshObject");
    expect(comps!.children[1].type).toBe("SCR_EditableEntityComponent");
    expect(getProperty(comps!.children[1], "m_sDisplayName")).toBe("Test");
  });
});

describe("inline multi-component vectors (FMT-1)", () => {
  // Regression: real Reforger `.layer`/`.ent` files and this project's own
  // scenario template write transforms as bare, space-separated triples
  // (`coords 0 0 0`, `angles 0 90 0`). The parser used to split each extra
  // component into a bogus key/value property, destroying the Y/Z components
  // and corrupting serialize() output. Now an inline numeric run is captured
  // as ONE space-joined value, matching the quoted form.

  it("parses a bare inline vector as a single space-joined property", () => {
    const node = parse("GenericEntity {\n coords 100 0 200\n}");
    expect(node.properties).toHaveLength(1);
    expect(node.properties[0]).toEqual({ key: "coords", value: "100 0 200" });
  });

  it("does not create bogus key/value props from the extra components", () => {
    const node = parse("GenericEntity {\n coords 100 0 200\n}");
    // The old bug produced [{key:"coords",value:"100"},{key:"0",value:"200"}].
    expect(node.properties.find((p) => p.key === "0")).toBeUndefined();
    expect(node.properties.find((p) => p.key === "200")).toBeUndefined();
  });

  it("parses a bare angles vector", () => {
    const node = parse("GenericEntity {\n angles 0 90 0\n}");
    expect(getProperty(node, "angles")).toBe("0 90 0");
  });

  it("parses a negative/decimal bare vector", () => {
    const node = parse("GenericEntity {\n coords -22 -0.672 14.5\n}");
    expect(getProperty(node, "coords")).toBe("-22 -0.672 14.5");
  });

  it("parses the quoted form identically (both forms converge)", () => {
    const bare = parse("GenericEntity {\n coords 100 0 200\n}");
    const quoted = parse('GenericEntity {\n coords "100 0 200"\n}');
    expect(getProperty(bare, "coords")).toBe(getProperty(quoted, "coords"));
  });

  it("captures a bare vector inside a nested node, not the node itself", () => {
    const node = parse("Entity {\n components {\n  Xform {\n   coords 0 0 0\n  }\n }\n}");
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    const xform = comps!.children.find((c) => c.type === "Xform");
    expect(xform).toBeDefined();
    expect(getProperty(xform!, "coords")).toBe("0 0 0");
  });

  it("does not swallow a following nested node into a vector value", () => {
    // `coords 0 0 0` must stop at the `}`; the sibling `components { ... }`
    // node must still parse as a child, not be absorbed.
    const node = parse(
      "GenericEntity {\n coords 0 0 0\n components {\n  MeshObject {\n  }\n }\n}",
    );
    expect(getProperty(node, "coords")).toBe("0 0 0");
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    expect(comps!.children[0].type).toBe("MeshObject");
  });

  it("keeps adjacent single-value numeric props separate (no over-joining)", () => {
    // Two distinct properties whose values are both numeric must NOT merge —
    // the second token after the first value is a (non-numeric) key.
    const node = parse(
      "GenericEntity {\n m_fAutoReloadTime 30\n m_iControlPointsThreshold 2\n}",
    );
    expect(getProperty(node, "m_fAutoReloadTime")).toBe("30");
    expect(getProperty(node, "m_iControlPointsThreshold")).toBe("2");
  });

  it("serializes an inline numeric vector BARE (wire-compatible)", () => {
    const node = createNode("GenericEntity", {
      properties: [{ key: "coords", value: "100 0 200" }],
    });
    const text = serialize(node);
    expect(text).toContain("coords 100 0 200");
    expect(text).not.toContain('coords "100 0 200"');
  });

  it("round-trips a bare inline vector (parse → serialize → parse)", () => {
    const input = "GenericEntity {\n ID \"1234567890ABCDEF\"\n coords 6120.51 157.665 4210.3\n angles 0 90 0\n}";
    const node = parse(input);
    const output = serialize(node);
    const reparsed = parse(output);
    // Structural equality on the round-tripped values.
    expect(getProperty(reparsed, "coords")).toBe("6120.51 157.665 4210.3");
    expect(getProperty(reparsed, "angles")).toBe("0 90 0");
    expect(getProperty(reparsed, "ID")).toBe("1234567890ABCDEF");
    // Serialize again — text is stable (re-parses identically).
    expect(serialize(reparsed)).toBe(output);
  });

  it("round-trips the quoted form too (quoted input still works)", () => {
    const input = 'GenericEntity {\n coords "1 2 3"\n}';
    const node = parse(input);
    expect(getProperty(node, "coords")).toBe("1 2 3");
    const reparsed = parse(serialize(node));
    expect(getProperty(reparsed, "coords")).toBe("1 2 3");
  });
});

describe("string escape handling", () => {
  it("should parse \\n escape in string values", () => {
    const input = 'MyNode {\n  key "line1\\nline2"\n}';
    const node = parse(input);
    expect(node.properties[0].value).toBe("line1\nline2");
  });

  it("should parse \\t escape in string values", () => {
    const input = 'MyNode {\n  key "col1\\tcol2"\n}';
    const node = parse(input);
    expect(node.properties[0].value).toBe("col1\tcol2");
  });

  it("should parse \\\\ escape as literal backslash", () => {
    const input = 'MyNode {\n  key "c:\\\\path"\n}';
    const node = parse(input);
    expect(node.properties[0].value).toBe("c:\\path");
  });

  it("should round-trip strings with newlines", () => {
    const input = 'MyNode {\n  key "line1\\nline2"\n}';
    const node = parse(input);
    const output = serialize(node);
    const reparsed = parse(output);
    expect(reparsed.properties[0].value).toBe("line1\nline2");
  });

  it("should serialize newlines as \\n in output", () => {
    const input = 'MyNode {\n  key "has newline"\n}';
    const node = parse(input);
    node.properties[0].value = "line1\nline2";
    const output = serialize(node);
    expect(output).toContain("\\n");
    expect(output).not.toContain('\n"');
  });
});

describe("createNode / setProperty / getProperty helpers", () => {
  it("creates node with defaults", () => {
    const node = createNode("Test");
    expect(node.type).toBe("Test");
    expect(node.properties).toEqual([]);
    expect(node.values).toEqual([]);
    expect(node.children).toEqual([]);
    expect(node.id).toBeUndefined();
    expect(node.inheritance).toBeUndefined();
  });

  it("setProperty adds new property", () => {
    const node = createNode("Test");
    setProperty(node, "foo", "bar");
    expect(getProperty(node, "foo")).toBe("bar");
  });

  it("setProperty updates existing property", () => {
    const node = createNode("Test", {
      properties: [{ key: "foo", value: "old" }],
    });
    setProperty(node, "foo", "new");
    expect(getProperty(node, "foo")).toBe("new");
    expect(node.properties.length).toBe(1);
  });

  it("serialize escapes quotes and backslashes in string values", () => {
    const node = createNode("Test");
    setProperty(node, "m_sName", 'has "quotes" inside');
    setProperty(node, "m_sPath", "C:\\Users\\test");
    const text = serialize(node);
    expect(text).toContain('has \\"quotes\\" inside');
    expect(text).toContain("C:\\\\Users\\\\test");
  });

  it("round-trips strings with quotes through parse/serialize", () => {
    const node = createNode("Test");
    setProperty(node, "m_sDesc", 'say "hello"');
    const text = serialize(node);
    const parsed = parse(text);
    expect(getProperty(parsed, "m_sDesc")).toBe('say "hello"');
  });

  it("escapes special characters in node id and inheritance", () => {
    const node = createNode("GenericEntity", {
      id: 'has "quotes"',
      inheritance: 'C:\\path\\to "base".et',
    });
    const text = serialize(node);
    expect(text).toContain('has \\"quotes\\"');
    expect(text).toContain('C:\\\\path\\\\to \\"base\\".et');
    // Round-trip
    const parsed = parse(text);
    expect(parsed.id).toBe('has "quotes"');
    expect(parsed.inheritance).toBe('C:\\path\\to "base".et');
  });
});

describe("numeric token forms: hex / exponent / sign (C1)", () => {
  // Regression for CODE-REVIEW-2026-09 C1: the FMT-1 fix only recognized
  // `-?\d+(\.\d+)?` as numeric, so hex flag masks (`0x3`) and scientific
  // floats (`1e-05`) broke the inline-vector run logic. `Flags 0 0x3`
  // followed by `coords 79.022 2.001 230.457` parsed as Flags="0",
  // {"0x3":"coords"}, {"79.022":"2.001 230.457"} and serialized back as
  // `0x3 "coords"` — silent data corruption in ~5.6% of real game files.

  it("keeps `Flags 0 0x3` as one property and `coords` as the next", () => {
    const input =
      "SomeComponent {\n Flags 0 0x3\n coords 79.022 2.001 230.457\n}";
    const node = parse(input);
    expect(node.properties).toEqual([
      { key: "Flags", value: "0 0x3" },
      { key: "coords", value: "79.022 2.001 230.457" },
    ]);
    expect(serialize(node)).toBe(input);
  });

  it("keeps `Flags 0x1 0` + `coords 0 0 0` separate and byte-identical", () => {
    const input = "InputSource {\n Flags 0x1 0\n coords 0 0 0\n}";
    const node = parse(input);
    expect(node.properties).toEqual([
      { key: "Flags", value: "0x1 0" },
      { key: "coords", value: "0 0 0" },
    ]);
    expect(serialize(node)).toBe(input);
  });

  it("never emits a numeric-looking key from a Flags/coords pair", () => {
    const node = parse("X {\n Flags 0 0x3\n coords 79.022 2.001 230.457\n}");
    for (const p of node.properties) {
      expect(p.key).not.toMatch(/^[-+]?(0x|\d|\.\d)/);
    }
    expect(serialize(node)).not.toContain('0x3 "coords"');
  });

  it("parses an exponent-float vector `coords 1e-05 0 0`", () => {
    const input = "X {\n coords 1e-05 0 0\n}";
    const node = parse(input);
    expect(node.properties).toEqual([{ key: "coords", value: "1e-05 0 0" }]);
    expect(serialize(node)).toBe(input);
  });

  it("parses negative + exponent components and a following property", () => {
    const input = "X {\n coords -1.5e-05 -2E+3 3.25e10\n angles 0 -90 0\n}";
    const node = parse(input);
    expect(node.properties).toEqual([
      { key: "coords", value: "-1.5e-05 -2E+3 3.25e10" },
      { key: "angles", value: "0 -90 0" },
    ]);
    expect(serialize(node)).toBe(input);
  });

  it("accepts leading `+`, `.5` and `5.` forms as numeric components", () => {
    const input = "X {\n v +1 .5 5. 0xFF\n next 7\n}";
    const node = parse(input);
    expect(node.properties).toEqual([
      { key: "v", value: "+1 .5 5. 0xFF" },
      { key: "next", value: "7" },
    ]);
    expect(serialize(node)).toBe(input);
  });

  it("isNumericScalar accepts every bare numeric form and rejects identifiers", () => {
    for (const ok of ["0", "-1", "+1", "5.", ".5", "5.25", "0x3", "0XfF", "-0x10",
                      "1e-05", "2.5E+3", "3e10", ".5e-3", "-1.5e-05"]) {
      expect(isNumericScalar(ok), ok).toBe(true);
    }
    for (const bad of ["0x", "0x1g", "1.2.3", "word", "e5", "1e", "-", "+", ".",
                       "m_fValue", "PC", "AAAA0000BBBB1111", "1 2", ""]) {
      expect(isNumericScalar(bad), bad).toBe(false);
    }
  });

  it("stops the run at a non-numeric token so the next key parses normally", () => {
    // `x1` / `v1.2.3` / `word` are identifiers, not numbers: each ends the
    // preceding run and starts its own property.
    const node = parse("X {\n a 1 0x2\n x1 2\n v1.2.3 3\n word 4\n}");
    expect(node.properties).toEqual([
      { key: "a", value: "1 0x2" },
      { key: "x1", value: "2" },
      { key: "v1.2.3", value: "3" },
      { key: "word", value: "4" },
    ]);
  });

  it("serializes a single hex / exponent scalar bare", () => {
    const node = createNode("X", {
      properties: [
        { key: "Flags", value: "0x4" },
        { key: "m_fEps", value: "1e-05" },
      ],
    });
    expect(serialize(node)).toBe("X {\n Flags 0x4\n m_fEps 1e-05\n}");
  });

  it("still parses a hex-flag line directly before a nested node", () => {
    const input = "X {\n Flags 0x2 0\n Child {\n }\n}";
    const node = parse(input);
    expect(getProperty(node, "Flags")).toBe("0x2 0");
    expect(node.children.map((c) => c.type)).toEqual(["Child"]);
    expect(serialize(node)).toBe(input);
  });
});

describe("quoted type names", () => {
  // Surfaced by the ENFUSION_GAME_PATH corpus test: AIBallisticTables configs
  // nest `"Table data" { ... }`. The parser accepted the quoted type but the
  // serializer emitted it bare, so a round-trip re-parsed it as type="Table",
  // id="data".
  it("round-trips a quoted type name with a space byte-identically", () => {
    const input =
      'BallisticTableArray {\n "Table data" {\n  BallisticTable "{6318AAFD7677F9E2}" {\n   InitSpeedCoefficient 0.1\n  }\n }\n}';
    const node = parse(input);
    expect(node.children[0].type).toBe("Table data");
    expect(node.children[0].id).toBeUndefined();
    expect(serialize(node)).toBe(input);
    expect(parse(serialize(node))).toEqual(node);
  });

  it("still emits plain identifier type names bare", () => {
    expect(serialize(createNode("SCR_Thing.v2-x"))).toBe("SCR_Thing.v2-x {\n}");
  });
});

describe("line endings and BOM", () => {
  it("round-trips CRLF input byte-identically", () => {
    const input = "X {\r\n Flags 0 0x3\r\n coords 1 2 3\r\n Child {\r\n  ID \"a1b2\"\r\n }\r\n}";
    const node = parse(input);
    expect(node.eol).toBe("\r\n");
    expect(getProperty(node, "Flags")).toBe("0 0x3");
    expect(serialize(node)).toBe(input);
  });

  it("round-trips LF input byte-identically (eol unset)", () => {
    const input = "X {\n Flags 0 0x3\n coords 1 2 3\n Child {\n  ID \"a1b2\"\n }\n}";
    const node = parse(input);
    expect(node.eol).toBeUndefined();
    expect(serialize(node)).toBe(input);
  });

  it("CRLF and LF sources produce the same tree apart from eol", () => {
    const lf = parse("X {\n a 1\n b \"two\"\n C {\n }\n}");
    const crlf = parse("X {\r\n a 1\r\n b \"two\"\r\n C {\r\n }\r\n}");
    expect({ ...crlf, eol: undefined }).toEqual({ ...lf, eol: undefined });
  });

  it("parses a BOM-prefixed document", () => {
    const plain = "GameProject {\n ID \"TestMod\"\n coords 0 0x1 2\n}";
    const withBom = "\uFEFF" + plain;
    const node = parse(withBom);
    expect(node.type).toBe("GameProject");
    expect(getProperty(node, "ID")).toBe("TestMod");
    expect(getProperty(node, "coords")).toBe("0 0x1 2");
    expect(node).toEqual(parse(plain));
    expect(serialize(node)).toBe(plain);
  });
});

describe("nesting depth cap (M22)", () => {
  it("parses nesting right at the cap", () => {
    const depth = MAX_NODE_DEPTH;
    const input = "N {\n".repeat(depth + 1) + "}\n".repeat(depth + 1);
    const root = parse(input);
    let cur = root;
    let levels = 0;
    while (cur.children.length > 0) {
      cur = cur.children[0];
      levels++;
    }
    expect(levels).toBe(depth);
  });

  it("throws a clear Error (not RangeError) when nesting exceeds the cap", () => {
    const depth = MAX_NODE_DEPTH + 1;
    const input = "N {\n".repeat(depth + 1) + "}\n".repeat(depth + 1);
    let caught: unknown;
    try {
      parse(input);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RangeError);
    expect((caught as Error).message).toMatch(/maximum depth of 256/);
  });

  it("does not overflow the stack on pathological nesting (10k levels)", () => {
    const input = "N {\n".repeat(10_000) + "}\n".repeat(10_000);
    expect(() => parse(input)).toThrow(/maximum depth/);
  });
});
