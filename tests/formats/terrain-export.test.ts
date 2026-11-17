/**
 * Proofs of src/formats/terrain-export.ts (phase5-w7-spec.md section 4): the K1 binary read back
 * by a reader written to ExportTerrain.c's reads, and the K2 .asc read back equal. Fixtures are
 * generated (the game paks hold no .asc and no small terrain).
 */
import { describe, expect, it } from "vitest";
import {
  ASC_NODATA,
  TerrainExportError,
  ascFromGlobal,
  formatAsc,
  parseAsc,
  readExportTerrain,
  recordBytes,
  writeExportTerrain,
  type ExportRecord,
} from "../../src/formats/terrain-export.js";

function heights(n: number, seed: number): number[] {
  return Array.from({ length: n }, (_, i) =>
    Math.fround(((i * 7919 + seed * 104729) % 20000) / 7 - 500),
  );
}

describe("terrain-export: K1 ExportTerrain binary", () => {
  it("one record: int32 tileX, int32 tileY, then area float32, little-endian", () => {
    const area = 4;
    const rec: ExportRecord = { tileX: 3, tileY: 1, heights: [1.5, -2, 0.25, 1000] };
    const buf = writeExportTerrain([rec], area);
    expect(buf.length).toBe(recordBytes(area));
    expect(buf.length).toBe(8 + 16);
    expect(buf.readInt32LE(0)).toBe(3);
    expect(buf.readInt32LE(4)).toBe(1);
    expect([0, 1, 2, 3].map((k) => buf.readFloatLE(8 + 4 * k))).toEqual([1.5, -2, 0.25, 1000]);
    expect(readExportTerrain(buf, area, 1)).toEqual([rec]);
  });

  it("three records of a 33 x 33 tile read back equal (float32 precision)", () => {
    const area = 33 * 33;
    const recs: ExportRecord[] = [0, 1, 2].map((i) => ({
      tileX: i,
      tileY: 2 - i,
      heights: heights(area, i),
    }));
    const buf = writeExportTerrain(recs, area);
    expect(buf.length).toBe(3 * recordBytes(area));
    const back = readExportTerrain(buf, area, 3);
    expect(back).toEqual(recs);
    // A double that is not a float32 comes back as its float32.
    const odd = writeExportTerrain([{ tileX: 0, tileY: 0, heights: [0.1] }], 1);
    expect(readExportTerrain(odd, 1, 1)[0].heights[0]).toBe(Math.fround(0.1));
  });

  it("refuses a wrong height count, a non-int32 index and a short file", () => {
    expect(() => writeExportTerrain([{ tileX: 0, tileY: 0, heights: [1] }], 2)).toThrow(
      TerrainExportError,
    );
    expect(() => writeExportTerrain([{ tileX: 0.5, tileY: 0, heights: [1] }], 1)).toThrow(/int32/);
    expect(() => writeExportTerrain([{ tileX: 0, tileY: 0, heights: [NaN] }], 1)).toThrow(
      /not finite/,
    );
    expect(() => writeExportTerrain([], 0)).toThrow(/area/);
    expect(() => readExportTerrain(Buffer.alloc(10), 2, 1)).toThrow(/bytes/);
  });

  it("trailing bytes are ignored, as the handler ignores them", () => {
    const buf = Buffer.concat([
      writeExportTerrain([{ tileX: 1, tileY: 1, heights: [2] }], 1),
      Buffer.alloc(5),
    ]);
    expect(readExportTerrain(buf, 1, 1)).toEqual([{ tileX: 1, tileY: 1, heights: [2] }]);
  });
});

describe("terrain-export: K2 .asc", () => {
  it("a 65 x 65 grid: the ESRI header, then values read back equal", () => {
    const n = 65;
    const values = Array.from({ length: n * n }, (_, k) =>
      Number((Math.sin(k / 50) * 120 + (k % 17) * 0.0625).toFixed(4)),
    );
    const grid = {
      ncols: n,
      nrows: n,
      xllcorner: 1000,
      yllcorner: -250.5,
      cellsize: 2,
      nodata: ASC_NODATA,
      values,
    };
    const text = formatAsc(grid);
    const lines = text.split("\n");
    expect(lines.slice(0, 6)).toEqual([
      "ncols 65",
      "nrows 65",
      "xllcorner 1000",
      "yllcorner -250.5",
      "cellsize 2",
      "NODATA_value -9999",
    ]);
    expect(lines).toHaveLength(6 + n + 1);
    expect(lines[6].split(" ")).toHaveLength(n);
    const back = parseAsc(text);
    expect({ ...back, values: Array.from(back.values) }).toEqual(grid);
  });

  it("ascFromGlobal lists the northern row first", () => {
    // 3 x 2 samples, gz 0 is south.
    const g = ascFromGlobal([1, 2, 3, 4, 5, 6], 3, 2, 10, 20, 0.5);
    expect(Array.from(g.values)).toEqual([4, 5, 6, 1, 2, 3]);
    expect([g.ncols, g.nrows, g.xllcorner, g.yllcorner, g.cellsize]).toEqual([3, 2, 10, 20, 0.5]);
  });

  it("refuses malformed grids", () => {
    expect(() => parseAsc("ncols 2\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1\n1")).toThrow(
      /values/,
    );
    expect(() => parseAsc("ncols 2\nnrows 1\nxllcorner 0\ncellsize 1\n1 2")).toThrow(/yllcorner/);
    expect(() => parseAsc("ncols 1\nnrows 1\nxllcenter 0\nyllcorner 0\ncellsize 1\n1")).toThrow(
      /unknown/,
    );
    expect(() =>
      formatAsc({
        ncols: 2,
        nrows: 1,
        xllcorner: 0,
        yllcorner: 0,
        cellsize: 1,
        nodata: -1,
        values: [1],
      }),
    ).toThrow(TerrainExportError);
    expect(() => ascFromGlobal([1], 2, 1, 0, 0, 1)).toThrow(TerrainExportError);
  });
});
