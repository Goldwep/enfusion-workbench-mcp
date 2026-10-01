import { describe, it, expect } from "vitest";
import { format } from "prettier";
import {
  compareCodeUnits,
  formatJson,
  jsonlLine,
  splitLines,
  toJsonl,
} from "../../src/census/canon.js";

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("compareCodeUnits", () => {
  it("orders ids by code unit", () => {
    const ids = ["a_b", "a-b", "aB", "a.b", "ab", "Ab"];
    expect([...ids].sort(compareCodeUnits)).toEqual(["Ab", "a-b", "a.b", "aB", "a_b", "ab"]);
  });
});

describe("jsonlLine", () => {
  it("serialises shuffled keys identically", () => {
    const row = { id: "x", z: 1, a: { d: [1, { y: 2, b: 3 }], c: null }, m: "s" };
    const keys = Object.keys(row);
    for (let seed = 1; seed < 20; seed++) {
      const shuffled = Object.fromEntries(
        shuffle(keys, seed).map((k) => [k, (row as Record<string, unknown>)[k]]),
      );
      expect(jsonlLine(shuffled, ["id"])).toBe(jsonlLine(row, ["id"]));
    }
    expect(jsonlLine(row, ["id"])).toBe(
      '{"id":"x","a":{"c":null,"d":[1,{"b":3,"y":2}]},"m":"s","z":1}',
    );
  });

  it("round-trips numeric-looking keys in code-unit order", () => {
    const a = jsonlLine({ "10": 1, "2": 2, a: 3 });
    const b = jsonlLine(
      Object.fromEntries([
        ["a", 3],
        ["2", 2],
        ["10", 1],
      ]),
    );
    expect(a).toBe(b);
    expect(a).toBe('{"10":1,"2":2,"a":3}');
  });

  it("drops undefined values", () => {
    expect(jsonlLine({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("toJsonl", () => {
  it("writes LF only with a trailing newline", () => {
    const text = toJsonl([{ a: 1 }, { a: 2 }]);
    expect(text).toBe('{"a":1}\n{"a":2}\n');
    expect(text.includes("\r")).toBe(false);
    expect(toJsonl([])).toBe("");
  });
});

describe("splitLines", () => {
  it("reads a CRLF copy with a BOM and a trailing blank line", () => {
    expect(splitLines("﻿a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("formatJson", () => {
  const samples: unknown[] = [
    {
      $comment: "c",
      version: 1,
      list: ["a", "b"],
      empty: [],
      obj: {},
      nested: { deep: { x: [1, 2, 3] } },
    },
    { long: Array.from({ length: 30 }, (_, i) => `entry-number-${i}`) },
    {
      pairs: [["Window", "Resource Browser"]],
      pairs2: [
        ["a", "b"],
        ["c", "d"],
      ],
      mixed: [[1], [2, 3]],
    },
    { objs: [{ a: 1 }, { b: 2 }], one: [{ a: 1, b: { c: [] } }] },
    { edge: "x".repeat(80), arr: ["y".repeat(40), "z".repeat(40)] },
    { "10": 1, "2": 2, s: "unicode — ✓ é", esc: 'quote " and \\ backslash' },
  ];
  it("survives prettier", async () => {
    for (const s of samples) {
      const text = formatJson(s);
      const pretty = await format(text, {
        parser: "json",
        printWidth: 100,
        tabWidth: 2,
        endOfLine: "lf",
      });
      expect(text).toBe(pretty);
    }
  });

  it("puts $comment first and sorts the other keys", () => {
    expect(formatJson({ b: 1, $comment: "x", a: 2 })).toBe(
      '{\n  "$comment": "x",\n  "a": 2,\n  "b": 1\n}\n',
    );
  });
});
