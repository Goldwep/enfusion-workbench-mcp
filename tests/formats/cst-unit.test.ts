/**
 * Lossless Enfusion-text CST (src/formats/enfusion-cst.ts) on synthetic
 * inputs: every construct round-trips byte-exact, and every edit changes only
 * its own span and writes fresh nodes in the vanilla style.
 */
import { describe, expect, it } from "vitest";
import {
  CstEditError,
  parseCst,
  parseCstBytes,
  roundTrip,
  tokenize,
  type CstObject,
} from "../../src/formats/enfusion-cst.js";

const ET = [
  'GenericEntity : "{A50E5DE98742F904}Prefabs/Base.et" {',
  ' ID "62D953462FF83896"',
  " components {",
  '  MeshObject "{5872F0A7E8E4F1B2}" {',
  '   Object "{1111111111111111}Assets/a.xob"',
  "  }",
  '  SCR_Thing "{5872F0A7E8E4F1B3}" {',
  "   Flags CARGO PILOT TURRET",
  "   Alignment 0.5 0.5",
  "  }",
  " }",
  "}",
].join("\n");

const constructs: Record<string, string> = {
  "class header with inheritance": 'Foo : "{0123456789ABCDEF}Configs/Base.conf" {\n Bar 1\n}',
  "multi-word bare enum": "Root {\n Flags CARGO PILOT TURRET\n ShapeType Point\n}\n",
  "bare number list": "Root {\n Color {\n  0 0.88 0.745 0.567\n }\n Size 32 32\n}",
  "legacy $ nodes":
    'Root {\n $grp StaticModelEntity : "{AD5D1A7FF5FB5FA2}P.et" {\n }\n}\n$eventtable {\n}\n',
  "original quoting": 'Root {\n Name "Spaced Name"\n Image dot\n Id "3"\n Plain 3\n}',
  "GUID-prefixed resource names": 'Root {\n Texture "{E23427CAC80DA8B7}UI/Textures/a.imageset"\n}',
  "nested objects and arrays":
    'A {\n B Class "{62AEA057BA26A12F}" {\n  C {\n   "x"\n   "y"\n  }\n  D Name {\n  }\n }\n}',
  "CRLF and mixed line endings": "A {\r\n B 1\n C 2\r\n}\r\n",
  "tabs and comments": "A {\n\t// note\n\tB 1 // trailing\n\t/* block\n */ C 2\n}",
  BOM: "﻿A {\n}\n",
  "spaced quoted names": 'Seq "Path Completed Test" {\n Name "Path Completed Test"\n}',
  "escaped quote in string": 'A {\n S "a \\" b"\n}',
  "unterminated string": 'A {\n S "abc\n}\n',
  "unterminated comment": "A {\n /* never closed\n}",
  "unmatched close brace": "A {\n}\n}\n} trailing",
  "unclosed block": "A {\n B {\n  C 1\n",
  "entry starting with colon": "A {\n : weird\n}",
  "Enforce script": 'class X : Y\n{\n\tvoid F() { int a = "}"; } // }\n};\r\n',
  JSON: '{\r\n  "a": [1, 2, {"b": "c"}]\r\n}',
  empty: "",
  "whitespace only": "  \r\n\t\n",
  "no trailing newline": "A {\n B 1\n}",
};

describe("cst round trip", () => {
  for (const [name, text] of Object.entries(constructs)) {
    it(`${name} serializes byte-exact`, () => {
      const doc = parseCst(text);
      expect(doc.serialize()).toBe(text);
      expect(
        tokenize(text)
          .map((t) => t.text)
          .join(""),
      ).toBe(text);
    });
  }

  it("covers every character with exactly one token", () => {
    const toks = tokenize(ET);
    let at = 0;
    for (const t of toks) {
      expect(t.start).toBe(at);
      at = t.end;
    }
    expect(at).toBe(ET.length);
  });

  it("round-trips bytes: utf8, utf16le with BOM, invalid utf8", () => {
    const cases = [
      Buffer.from('A {\n N "é"\n}', "utf8"),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("A {\n}\n", "utf16le")]),
      Buffer.from([0x41, 0x20, 0x7b, 0x0a, 0x20, 0x4e, 0x20, 0xe9, 0x0a, 0x7d]),
    ];
    const enc = cases.map((b) => parseCstBytes(b));
    expect(enc.map((d) => d.encoding)).toEqual(["utf8", "utf16le", "latin1"]);
    cases.forEach((b, i) => expect(enc[i].toBytes().equals(b)).toBe(true));
  });

  it("never throws on random input and still round-trips", () => {
    const alphabet = [
      '"',
      "{",
      "}",
      ":",
      " ",
      "\n",
      "\r",
      "\t",
      "/",
      "*",
      "\\",
      "a",
      "1",
      "$",
      "-",
    ];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed);
    for (let k = 0; k < 300; k++) {
      let s = "";
      for (let j = rnd() % 60; j > 0; j--) s += alphabet[rnd() % alphabet.length];
      expect(roundTrip(s)).toBe(s);
    }
  });
});

describe("cst tree", () => {
  it("reads headers, inheritance, legacy nodes and values", () => {
    const doc = parseCst(ET);
    const root = doc.root.children[0] as CstObject;
    expect(root.key).toBe("GenericEntity");
    expect(doc.get("ID")).toMatchObject({
      kind: "scalar",
      values: ["62D953462FF83896"],
      quoted: [true],
    });
    expect(doc.get("components[1].Flags")).toMatchObject({
      values: ["CARGO", "PILOT", "TURRET"],
      quoted: [false, false, false],
    });
    expect(doc.get("components[0]")).toMatchObject({
      kind: "object",
      head: ["MeshObject", "{5872F0A7E8E4F1B2}"],
    });
    expect(doc.get("components[0].Object")).toMatchObject({
      values: ["{1111111111111111}Assets/a.xob"],
    });
    const leg = parseCst(constructs["legacy $ nodes"]);
    expect(leg.get("Root.$grp")).toMatchObject({
      kind: "object",
      legacy: true,
      base: "{AD5D1A7FF5FB5FA2}P.et",
    });
    expect(parseCst(constructs["class header with inheritance"]).get("Bar").kind).toBe("scalar");
    const arr = parseCst(constructs["nested objects and arrays"]);
    expect(arr.get("B.C[1]")).toMatchObject({ kind: "value", values: ["y"] });
    expect(parseCst(constructs["bare number list"]).get("Color[0]")).toMatchObject({
      kind: "value",
      values: ["0", "0.88", "0.745", "0.567"],
    });
  });

  it("keeps unknown constructs as opaque spans with diagnostics", () => {
    const d = parseCst(constructs["unmatched close brace"]);
    expect(d.root.children.some((c) => c.kind === "opaque")).toBe(true);
    expect(d.diagnostics.length).toBeGreaterThan(0);
    expect(parseCst(constructs["entry starting with colon"]).get("[0]").kind).toBe("opaque");
    const u = parseCst(constructs["unclosed block"]);
    expect(u.diagnostics.map((x) => x.message)).toContain("block 'B' not closed");
  });

  it("rejects bad paths and missing entries with codes", () => {
    const doc = parseCst(ET);
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as CstEditError).code;
      }
      return "none";
    };
    expect(code(() => doc.get("nope"))).toBe("PATH_NOT_FOUND");
    expect(code(() => doc.get("components[9]"))).toBe("PATH_NOT_FOUND");
    expect(code(() => doc.get("a..b"))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.get("a[x]"))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.set("components", 1))).toBe("UNSUPPORTED");
    expect(code(() => doc.set("ID", 'has "quote'))).toBe("INVALID_ARGUMENT");
  });
});

/** Asserts the edit left text before `start` and after the replaced span unchanged. */
function onlySpan(
  before: string,
  after: string,
  e: { start: number; end: number; inserted: string },
) {
  expect(after.slice(0, e.start)).toBe(before.slice(0, e.start));
  expect(after.slice(e.start + e.inserted.length)).toBe(before.slice(e.end));
}

describe("cst edits", () => {
  it("set keeps quoting and touches only the value span", () => {
    const doc = parseCst(ET.replace(/\n/g, "\r\n"));
    const before = doc.text;
    const e = doc.set("components[0].Object", "{2222222222222222}Assets/b.xob");
    onlySpan(before, doc.text, e);
    expect(doc.text).toContain('   Object "{2222222222222222}Assets/b.xob"\r\n');
    const b2 = doc.text;
    const e2 = doc.set("components[1].Alignment", [1, 0.25]);
    onlySpan(b2, doc.text, e2);
    expect(doc.text).toContain("   Alignment 1 0.25\r\n");
    doc.set("components[1].Flags", ["CARGO"]);
    expect(doc.get("components[1].Flags")).toMatchObject({ values: ["CARGO"], quoted: [false] });
    doc.set("ID", "AAAA");
    expect(doc.text).toContain(' ID "AAAA"');
  });

  it("set on a missing key appends a fresh line at the sibling indent", () => {
    const doc = parseCst(ET);
    const before = doc.text;
    const e = doc.set("components[1].Enabled", true);
    onlySpan(before, doc.text, e);
    expect(doc.text).toContain("   Alignment 0.5 0.5\n   Enabled 1\n  }");
    doc.set("components[1].Mode", "Point", { quoted: false });
    expect(doc.text).toContain("   Enabled 1\n   Mode Point\n  }");
    doc.set("Name", "Spaced name");
    expect(doc.text.endsWith(' }\n Name "Spaced name"\n}')).toBe(true);
  });

  it("set on a value entry (array item)", () => {
    const doc = parseCst(constructs["nested objects and arrays"]);
    doc.set("B.C[0]", "z");
    expect(doc.text).toContain('   "z"\n   "y"');
  });

  it("arrayAdd appends, inserts at an index and fills an empty block", () => {
    const doc = parseCst(constructs["nested objects and arrays"]);
    let before = doc.text;
    let e = doc.arrayAdd("B.C", "w");
    onlySpan(before, doc.text, e);
    expect(doc.get("B.C[2]")).toMatchObject({ values: ["w"] });
    before = doc.text;
    e = doc.arrayAdd("B.C", "first", 0);
    onlySpan(before, doc.text, e);
    expect(doc.get("B.C[0]")).toMatchObject({ values: ["first"] });
    doc.arrayAdd("B.D", [2, 8, 20]);
    expect(doc.text).toContain("  D Name {\n   2 8 20\n  }");
  });

  it("arrayAdd into an inline empty block opens it onto lines", () => {
    const doc = parseCst("A {\n B {}\n}");
    doc.arrayAdd("B", "x");
    expect(doc.text).toBe('A {\n B {\n  "x"\n }\n}');
  });

  it("arrayRemove and delete take the whole line, comments after it too", () => {
    const doc = parseCst("A {\r\n B 1 // gone\r\n C {\r\n  1\r\n  2\r\n }\r\n}");
    let before = doc.text;
    let e = doc.delete("B");
    onlySpan(before, doc.text, e);
    expect(doc.text).toBe("A {\r\n C {\r\n  1\r\n  2\r\n }\r\n}");
    before = doc.text;
    e = doc.arrayRemove("C", 0);
    onlySpan(before, doc.text, e);
    expect(doc.text).toBe("A {\r\n C {\r\n  2\r\n }\r\n}");
    doc.delete("C");
    expect(doc.text).toBe("A {\r\n}");
  });

  it("delete of the last line without a line ending takes the ending before it", () => {
    const doc = parseCst("A {\n}\nB {\n}");
    doc.delete("[1]");
    expect(doc.text).toBe("A {\n}");
  });

  it("arrayMove reorders whole lines", () => {
    const doc = parseCst("A {\n L {\n  1\n  2\n  3\n }\n}");
    let before = doc.text;
    onlySpan(before, doc.text, doc.arrayMove("L", 0, 2));
    expect(doc.text).toBe("A {\n L {\n  2\n  3\n  1\n }\n}");
    before = doc.text;
    onlySpan(before, doc.text, doc.arrayMove("L", 2, 0));
    expect(doc.text).toBe("A {\n L {\n  1\n  2\n  3\n }\n}");
    before = doc.text;
    onlySpan(before, doc.text, doc.arrayMove("L", 1, 2));
    expect(doc.text).toBe("A {\n L {\n  1\n  3\n  2\n }\n}");
  });

  it("createObject writes the canonical header and body", () => {
    const doc = parseCst(ET);
    const before = doc.text;
    const e = doc.createObject("components", {
      key: "SCR_New",
      guid: "abcdefabcdefabcd",
      base: "{FD29F07BE96EDAFE}Configs/x.conf",
      entries: [
        { key: "Enabled", value: false },
        { key: "Name", value: "Spaced Name" },
        {
          object: {
            key: "Slot",
            className: "FrameWidgetSlot",
            entries: [{ key: "SizeX", value: 60 }],
          },
        },
        { object: { key: "Seq", name: "Path Completed Test" } },
        { value: [2, 8] },
      ],
    });
    onlySpan(before, doc.text, e);
    expect(e.inserted).toBe(
      [
        '  SCR_New "{ABCDEFABCDEFABCD}" : "{FD29F07BE96EDAFE}Configs/x.conf" {',
        "   Enabled 0",
        '   Name "Spaced Name"',
        "   Slot FrameWidgetSlot {",
        "    SizeX 60",
        "   }",
        '   Seq "Path Completed Test" {',
        "   }",
        "   2 8",
        "  }",
        "",
      ].join("\n"),
    );
    expect(doc.get("components[2].Slot.SizeX")).toMatchObject({ values: ["60"] });
    expect(doc.diagnostics).toEqual([]);
  });

  it("fresh lines follow tab indentation and the header line's ending", () => {
    const doc = parseCst("A {\r\n\tB {\r\n\t}\r\n}");
    doc.set("B.X", 1);
    expect(doc.text).toBe("A {\r\n\tB {\r\n\t\tX 1\r\n\t}\r\n}");
  });

  it("a multi-root document resolves from the document", () => {
    const doc = parseCst("A {\n X 1\n}\nB {\n Y 2\n}\n");
    expect(doc.get("B.Y")).toMatchObject({ values: ["2"] });
    doc.createObject("", { key: "C" });
    expect(doc.text).toBe("A {\n X 1\n}\nB {\n Y 2\n}\nC {\n}");
  });
});

describe("cst review fixes", () => {
  const code = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return (e as CstEditError).code;
    }
    return "none";
  };

  it("D-01: set on a single-word array item replaces the word", () => {
    const doc = parseCst("A {\n L {\n  ENUM_A\n  ENUM_B\n }\n}");
    doc.set("L[0]", "ENUM_C");
    expect(doc.text).toBe("A {\n L {\n  ENUM_C\n  ENUM_B\n }\n}");
    const multi = parseCst("A {\n L {\n  ENUM_A ENUM_B\n }\n}");
    expect(code(() => multi.set("L[0]", "X"))).toBe("UNSUPPORTED");
    expect(multi.text).toBe("A {\n L {\n  ENUM_A ENUM_B\n }\n}");
  });

  it("D-02: a quoted slot keeps numbers quoted; quoted:true quotes them", () => {
    const doc = parseCst('A {\n Id "3"\n X 1\n}');
    doc.set("Id", 4);
    doc.set("X", 2, { quoted: true });
    expect(doc.text).toBe('A {\n Id "4"\n X "2"\n}');
  });

  it("D-03: a comment opener is quoted in an inherited bare slot, refused when bare is asked", () => {
    const doc = parseCst("A {\n Image dot\n}");
    doc.set("Image", "a//b");
    expect(doc.text).toBe('A {\n Image "a//b"\n}');
    expect(doc.get("Image")).toMatchObject({ values: ["a//b"] });
    expect(code(() => doc.set("Image", "a/*b", { quoted: false }))).toBe("INVALID_ARGUMENT");
  });

  it("D-04: arrayMove reports its range in old-text coordinates", () => {
    for (const [from, to] of [
      [0, 2],
      [2, 0],
      [1, 2],
    ]) {
      const doc = parseCst("A {\n L {\n  1\n  2\n  3\n }\n}");
      const old = doc.text;
      const e = doc.arrayMove("L", from, to);
      expect(old.slice(0, e.start) + e.inserted + old.slice(e.end)).toBe(doc.text);
    }
  });

  it("D-06: vocabulary path grammar, INVALID_ARGUMENT, misses list siblings", () => {
    const doc = parseCst("A {\n X 1\n Y 2\n}");
    expect(code(() => doc.get("a[0]b"))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.get("X.[0]"))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.get(""))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.get("1x"))).toBe("INVALID_ARGUMENT");
    expect(() => doc.get("Z")).toThrow(/entries: X, Y/);
    expect(doc.get("[1]")).toMatchObject({ key: "Y" });
  });

  it("D-07: an unclosed quote stops at its line end", () => {
    const text = 'A {\n S "abc\n T "x"\n U 1\n}';
    const doc = parseCst(text);
    const a = doc.root.children[0] as CstObject;
    expect(a.children.map((c) => (c.kind === "scalar" ? c.key : c.kind))).toEqual(["S", "T", "U"]);
    expect(doc.diagnostics).toEqual([{ offset: 7, line: 2, message: "unterminated string" }]);
    expect(doc.serialize()).toBe(text);
  });

  it("D-08: diagnostics count a lone CR as a line break", () => {
    const doc = parseCst("A {\r X 1\r : y\r}");
    expect(doc.diagnostics[0]).toMatchObject({ line: 3 });
  });

  it("D-09: backslashes survive set then get", () => {
    const v = "a\\\\b"; // a, two backslashes, b
    const doc = parseCst('A {\n P "x"\n}');
    doc.set("P", v);
    expect(doc.get("P")).toMatchObject({ values: [v] });
    expect(parseCst('A {\n P "q\\"r"\n}').get("P")).toMatchObject({ values: ['q"r'] });
  });
});
