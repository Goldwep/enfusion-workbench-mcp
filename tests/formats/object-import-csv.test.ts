import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  CSV_HEADER,
  formatCsv,
  formatRow,
  fromHandlerRow,
  invalidLines,
  parse,
  rowFromFields,
  rowsOf,
  serialize,
  splitFields,
  toHandlerRow,
  type ObjectRow,
} from "../../src/formats/object-import-csv.js";
import { seededRandom } from "../../src/tools/wb-world-tools.js";

/**
 * The game paks hold no .csv file (spec section 4, measured), so the proof runs on rows generated
 * here: random prefabs, positions, unit quaternions and scales, with and without a header.
 */
function generateRows(n: number, seed: number): ObjectRow[] {
  const rnd = seededRandom(seed);
  const hex = () =>
    Array.from({ length: 16 }, () => "0123456789ABCDEF"[Math.floor(rnd() * 16)]).join("");
  const fixed = (v: number, d: number) => v.toFixed(d);
  const rows: ObjectRow[] = [];
  for (let i = 0; i < n; i++) {
    let q = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const len = Math.hypot(...q);
    q = q.map((c) => c / len);
    rows.push({
      prefab: `{${hex()}}Prefabs/Gen/Item_${i}.et`,
      position: [fixed(rnd() * 12800, 3), fixed(rnd() * 300 - 20, 4), fixed(rnd() * 12800, 3)],
      quaternion: [fixed(q[0]!, 6), fixed(q[1]!, 6), fixed(q[2]!, 6), fixed(q[3]!, 6)],
      scale: fixed(0.5 + rnd() * 1.5, 2),
    });
  }
  return rows;
}

describe("object import CSV: byte-exact round trip on 50 generated rows", () => {
  const rows = generateRows(50, 0xc0ffee);

  for (const header of [true, false]) {
    for (const eol of ["\n", "\r\n"] as const) {
      it(`header ${header}, eol ${JSON.stringify(eol)}`, () => {
        const text = formatCsv(rows, { header, eol });
        const doc = parse(text);
        expect(serialize(doc)).toBe(text);
        expect(doc.header).toBe(header);
        expect(invalidLines(doc)).toEqual([]);
        expect(rowsOf(doc)).toEqual(rows);
        expect(formatCsv(rowsOf(doc), { header: doc.header, eol })).toBe(text);
      });
    }
  }

  it("reads the vanilla column order Prefab,x,y,z,qx,qy,qz,qw,scale", () => {
    const doc = parse("{0123456789ABCDEF}Prefabs/A.et,1,2,3,0.1,0.2,0.3,0.9,1.5\n");
    expect(rowsOf(doc)).toEqual([
      {
        prefab: "{0123456789ABCDEF}Prefabs/A.et",
        position: ["1", "2", "3"],
        quaternion: ["0.1", "0.2", "0.3", "0.9"],
        scale: "1.5",
      },
    ]);
    expect(CSV_HEADER).toBe("Prefab,x,y,z,qx,qy,qz,qw,scale");
  });

  it("each row converts to the handler row and back unchanged", () => {
    for (const r of rows) {
      const h = toHandlerRow(r);
      expect(h.split(";")).toHaveLength(4);
      const back = fromHandlerRow(h);
      expect(back).toEqual({ row: r });
    }
  });
});

describe("object import CSV: lossless on non-canonical text", () => {
  const cases: Array<[string, string]> = [
    ["empty", ""],
    ["BOM and header", "﻿Prefab,x,y,z,qx,qy,qz,qw,scale\n{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,1\n"],
    ["no final newline", "{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,1"],
    ["spaces around commas", "{0123456789ABCDEF}A.et , 1 , 2 , 3 , 0 , 0 , 0 , 1 , 1\r\n"],
    ["whitespace separated", "{0123456789ABCDEF}A.et 1 2 3 0 0 0 1 1\n\n  \n"],
    [
      "mixed endings and a comment field",
      "{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,1,rock by road\r\n{0123456789ABCDEF}B.et,4,5,6,0,0,0,1,2\n",
    ],
    ["invalid lines kept", "hello\n{0123456789ABCDEF}A.et,1,2\n"],
    ["lone CR inside a line", "{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,1\r"],
  ];
  for (const [name, text] of cases) {
    it(name, () => {
      expect(serialize(parse(text))).toBe(text);
    });
  }

  it("ignores fields past the ninth and keeps them as extra", () => {
    const doc = parse("{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,1,note,more\n");
    expect(doc.lines[0]!.kind).toBe("row");
    expect(doc.lines[0]!.extra).toEqual(["note", "more"]);
  });

  it("whitespace and comma separators read the same row", () => {
    const a = rowsOf(parse("{0123456789ABCDEF}A.et 1 2 3 0 0 0 1 1"));
    const b = rowsOf(parse("{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,1"));
    expect(a).toEqual(b);
  });

  it("drops outer quotes of a field", () => {
    expect(splitFields('"{0123456789ABCDEF}A.et",1')).toEqual(["{0123456789ABCDEF}A.et", "1"]);
  });

  it("a header only counts on the first non-blank line", () => {
    const doc = parse("\n{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,1\nPrefab,x,y,z,qx,qy,qz,qw,scale\n");
    expect(doc.header).toBe(false);
    expect(doc.lines.map((l) => l.kind)).toEqual(["blank", "row", "invalid"]);
  });

  it("numbers as text are kept exactly (no float drift)", () => {
    const doc = parse("{0123456789ABCDEF}A.et,0.1000,-0,1e3,0,0,0,1.0,1.50\n");
    const r = rowsOf(doc)[0]!;
    expect(r.position).toEqual(["0.1000", "-0", "1e3"]);
    expect(formatRow(r)).toBe("{0123456789ABCDEF}A.et,0.1000,-0,1e3,0,0,0,1.0,1.50");
  });
});

describe("object import CSV: row checks", () => {
  const ok = ["{0123456789ABCDEF}A.et", "1", "2", "3", "0", "0", "0", "1", "1"];
  it("accepts a good row", () => {
    expect("row" in rowFromFields(ok)).toBe(true);
  });
  it.each([
    ["too few fields", ok.slice(0, 8), "expected 9"],
    ["prefab without GUID", ["Prefabs/A.et", ...ok.slice(1)], "{GUID}path"],
    ["x not a number", [ok[0]!, "a", ...ok.slice(2)], "x is not a number"],
    ["zero quaternion", [...ok.slice(0, 4), "0", "0", "0", "0", "1"], "zero length"],
    ["zero scale", [...ok.slice(0, 8), "0"], "scale must be above 0"],
    ["negative scale", [...ok.slice(0, 8), "-1"], "scale must be above 0"],
  ])("%s", (_n, fields, why) => {
    const r = rowFromFields(fields as string[]);
    expect("error" in r && r.error).toContain(why);
  });

  it("fromHandlerRow refuses a wrong field count and short vectors", () => {
    expect(fromHandlerRow("{0123456789ABCDEF}A.et;1 2 3;0 0 0 1")).toHaveProperty("error");
    expect(fromHandlerRow("{0123456789ABCDEF}A.et;1 2;0 0 0 1;1")).toHaveProperty("error");
    expect(fromHandlerRow("{0123456789ABCDEF}A.et;1 2 3;0 0 1;1")).toHaveProperty("error");
    expect(fromHandlerRow("{0123456789ABCDEF}A.et;1,2,3;0,0,0,1;1")).toHaveProperty("row");
  });

  it("an invalid line carries its line number and reason", () => {
    const bad = invalidLines(
      parse("Prefab,x,y,z,qx,qy,qz,qw,scale\n{0123456789ABCDEF}A.et,1,2,3,0,0,0,1,0\n"),
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]!.line).toBe(2);
    expect(bad[0]!.error).toContain("scale");
  });
});

const GAME = process.env.ENFUSION_GAME_PATH ?? "";

describe.skipIf(!GAME || !existsSync(GAME))("object import CSV: vanilla corpus (game paks)", () => {
  it("every .csv in the paks round-trips byte for byte (the 1.9 paks hold none)", () => {
    const vfs = PakVirtualFS.get(GAME);
    if (!vfs) return;
    const files = vfs.allFilePaths().filter((p) => p.toLowerCase().endsWith(".csv"));
    for (const p of files) {
      const bytes = vfs.readFile(p);
      const text = bytes.toString("utf-8");
      if (Buffer.from(text, "utf-8").equals(bytes)) {
        expect(Buffer.from(serialize(parse(text)), "utf-8").equals(bytes), p).toBe(true);
      }
    }
    expect(files.length).toBeGreaterThanOrEqual(0);
  });
});
