/**
 * Shapefile reader and writer (src/formats/shapefile.ts), proved on fixtures generated here at
 * test time by an encoder written independently from the ESRI layout (the game paks hold no
 * .shp, .shx or .dbf: phase5-w6-spec.md section 4). Pass conditions: write(read(f)) is f byte
 * for byte for every fixture, and the .shx offsets agree with the .shp record headers.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  compareShx,
  dbfRow,
  readDbf,
  readShp,
  readShx,
  recordParts,
  shapeKind,
  shxEntries,
  writeDbf,
  writeShp,
  writeShx,
  writeShxFile,
  ShapefileError,
} from "../../src/formats/shapefile.js";

// ── Independent fixture encoder ───────────────────────────────────────────────

type P = { x: number; y: number; z?: number; m?: number };
interface Rec {
  type: number;
  parts?: number[];
  points: P[];
  /** Z types: write the optional M block. */
  withM?: boolean;
  raw?: number[];
}

class Bytes {
  private chunks: Buffer[] = [];
  i32be(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v);
    this.chunks.push(b);
  }
  i32le(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    this.chunks.push(b);
  }
  f64(v: number) {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(v);
    this.chunks.push(b);
  }
  raw(b: Buffer) {
    this.chunks.push(b);
  }
  done(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

const Z_TYPES = new Set([11, 13, 15, 18]);
const M_TYPES = new Set([21, 23, 25, 28]);

function content(r: Rec): Buffer {
  const b = new Bytes();
  b.i32le(r.type);
  const base = r.type % 10;
  const z = Z_TYPES.has(r.type);
  const m = M_TYPES.has(r.type) || (z && r.withM);
  if (r.type === 0) return b.done();
  if (r.type === 31) {
    b.raw(Buffer.from(r.raw ?? []));
    return b.done();
  }
  if (base === 1) {
    const p = r.points[0];
    b.f64(p.x);
    b.f64(p.y);
    if (z) b.f64(p.z ?? 0);
    if (m) b.f64(p.m ?? 0);
    return b.done();
  }
  const xs = r.points.map((p) => p.x);
  const ys = r.points.map((p) => p.y);
  b.f64(Math.min(...xs));
  b.f64(Math.min(...ys));
  b.f64(Math.max(...xs));
  b.f64(Math.max(...ys));
  const multi = base === 8;
  if (!multi) b.i32le(r.parts!.length);
  b.i32le(r.points.length);
  if (!multi) for (const p of r.parts!) b.i32le(p);
  for (const p of r.points) {
    b.f64(p.x);
    b.f64(p.y);
  }
  if (z) {
    const zs = r.points.map((p) => p.z ?? 0);
    b.f64(Math.min(...zs));
    b.f64(Math.max(...zs));
    for (const v of zs) b.f64(v);
  }
  if (m) {
    const ms = r.points.map((p) => p.m ?? 0);
    b.f64(Math.min(...ms));
    b.f64(Math.max(...ms));
    for (const v of ms) b.f64(v);
  }
  return b.done();
}

function header(type: number, fileBytes: number, bbox: number[]): Buffer {
  const b = new Bytes();
  b.i32be(9994);
  for (let i = 0; i < 5; i++) b.i32be(0);
  b.i32be(fileBytes / 2);
  b.i32le(1000);
  b.i32le(type);
  for (let i = 0; i < 8; i++) b.f64(bbox[i] ?? 0);
  return b.done();
}

function encode(type: number, recs: Rec[]): { shp: Buffer; shx: Buffer } {
  const bodies = recs.map(content);
  const all = recs.flatMap((r) => r.points);
  const bbox = all.length
    ? [
        Math.min(...all.map((p) => p.x)),
        Math.min(...all.map((p) => p.y)),
        Math.max(...all.map((p) => p.x)),
        Math.max(...all.map((p) => p.y)),
        Math.min(...all.map((p) => p.z ?? 0)),
        Math.max(...all.map((p) => p.z ?? 0)),
        0,
        0,
      ]
    : [0, 0, 0, 0, 0, 0, 0, 0];
  const shpSize = 100 + bodies.reduce((s, c) => s + 8 + c.length, 0);
  const shp = new Bytes();
  shp.raw(header(type, shpSize, bbox));
  const shx = new Bytes();
  shx.raw(header(type, 100 + recs.length * 8, bbox));
  let at = 100;
  bodies.forEach((c, i) => {
    shp.i32be(i + 1);
    shp.i32be(c.length / 2);
    shp.raw(c);
    shx.i32be(at / 2);
    shx.i32be(c.length / 2);
    at += 8 + c.length;
  });
  return { shp: shp.done(), shx: shx.done() };
}

interface Field {
  name: string;
  type: string;
  length: number;
  decimals?: number;
}

function encodeDbf(fields: Field[], rows: string[][], deleted: number[] = []): Buffer {
  const headerLen = 32 + fields.length * 32 + 1;
  const recordLen = 1 + fields.reduce((s, f) => s + f.length, 0);
  const head = Buffer.alloc(32);
  head[0] = 0x03;
  head[1] = 126;
  head[2] = 11;
  head[3] = 12;
  head.writeUInt32LE(rows.length, 4);
  head.writeUInt16LE(headerLen, 8);
  head.writeUInt16LE(recordLen, 10);
  const parts: Buffer[] = [head];
  for (const f of fields) {
    const d = Buffer.alloc(32);
    d.write(f.name, 0, "latin1");
    d[11] = f.type.charCodeAt(0);
    d[16] = f.length;
    d[17] = f.decimals ?? 0;
    parts.push(d);
  }
  parts.push(Buffer.from([0x0d]));
  rows.forEach((row, i) => {
    const r = Buffer.alloc(recordLen, 0x20);
    r[0] = deleted.includes(i) ? 0x2a : 0x20;
    let q = 1;
    fields.forEach((f, k) => {
      const cell = f.type === "N" ? row[k].padStart(f.length) : row[k].padEnd(f.length);
      r.write(cell, q, "latin1");
      q += f.length;
    });
    parts.push(r);
  });
  parts.push(Buffer.from([0x1a]));
  return Buffer.concat(parts);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const square = (x: number, y: number, s: number): P[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
  { x, y },
];

const FIXTURES: Record<string, { type: number; recs: Rec[] }> = {
  null: {
    type: 0,
    recs: [
      { type: 0, points: [] },
      { type: 0, points: [] },
    ],
  },
  point: {
    type: 1,
    recs: [
      { type: 1, points: [{ x: 1.5, y: -2.25 }] },
      { type: 0, points: [] },
      { type: 1, points: [{ x: 1e7, y: -0.000123 }] },
    ],
  },
  polyline: {
    type: 3,
    recs: [
      {
        type: 3,
        parts: [0],
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
          { x: 20, y: 0 },
        ],
      },
      {
        type: 3,
        parts: [0, 2],
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 5, y: 5 },
          { x: 6, y: 7 },
          { x: 8, y: 9 },
        ],
      },
    ],
  },
  polygon: {
    type: 5,
    recs: [
      { type: 5, parts: [0, 5], points: [...square(0, 0, 100), ...square(10, 10, 20)] },
      { type: 5, parts: [0], points: square(500, 500, 3) },
    ],
  },
  multipoint: {
    type: 8,
    recs: [
      {
        type: 8,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: -5, y: 6.5 },
        ],
      },
    ],
  },
  pointz: {
    type: 11,
    recs: [
      { type: 11, points: [{ x: 1, y: 2, z: 3, m: 4 }], withM: true },
      { type: 11, points: [{ x: 5, y: 6, z: 7 }], withM: false },
    ],
  },
  polylinez: {
    type: 13,
    recs: [
      {
        type: 13,
        parts: [0],
        points: [
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 1, z: 2 },
        ],
        withM: false,
      },
      {
        type: 13,
        parts: [0, 1],
        points: [
          { x: 0, y: 0, z: 1, m: 9 },
          { x: 1, y: 1, z: 2, m: 8 },
          { x: 4, y: 4, z: 3, m: 7 },
        ],
        withM: true,
      },
    ],
  },
  polygonz: {
    type: 15,
    recs: [
      {
        type: 15,
        parts: [0, 5],
        points: [...square(0, 0, 8), ...square(2, 2, 2)].map((p, i) => ({ ...p, z: i * 0.5 })),
        withM: true,
      },
    ],
  },
  multipointz: {
    type: 18,
    recs: [
      {
        type: 18,
        points: [
          { x: 1, y: 2, z: 3 },
          { x: 4, y: 5, z: 6 },
        ],
        withM: false,
      },
    ],
  },
  pointm: { type: 21, recs: [{ type: 21, points: [{ x: 1, y: 2, m: 3 }] }] },
  polylinem: {
    type: 23,
    recs: [
      {
        type: 23,
        parts: [0],
        points: [
          { x: 0, y: 0, m: 1 },
          { x: 3, y: 3, m: 2 },
        ],
      },
    ],
  },
  polygonm: {
    type: 25,
    recs: [{ type: 25, parts: [0], points: square(0, 0, 1).map((p, i) => ({ ...p, m: i })) }],
  },
  multipointm: {
    type: 28,
    recs: [
      {
        type: 28,
        points: [
          { x: 1, y: 1, m: 0 },
          { x: 2, y: 2, m: 5 },
        ],
      },
    ],
  },
  multipatch: {
    type: 31,
    recs: [{ type: 31, points: [], raw: Array.from({ length: 44 }, (_, i) => i) }],
  },
};

// ── Proofs ────────────────────────────────────────────────────────────────────

describe("shapefile round trip on generated fixtures", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`${name}: write(read(shp)) and write(read(shx)) are byte-exact, the .shx agrees`, () => {
      const { shp, shx } = encode(f.type, f.recs);
      const file = readShp(shp);
      expect(file.records).toHaveLength(f.recs.length);
      expect(Buffer.from(writeShp(file)).equals(shp)).toBe(true);
      expect(Buffer.from(writeShx(file)).equals(shx)).toBe(true);
      const index = readShx(shx);
      expect(compareShx(file, index)).toEqual([]);
      expect(Buffer.from(writeShxFile(index)).equals(shx)).toBe(true);
      // Every .shx offset points at a record header whose number and length match.
      const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
      index.entries.forEach((e, i) => {
        expect(view.getInt32(e.offsetWords * 2, false)).toBe(i + 1);
        expect(view.getInt32(e.offsetWords * 2 + 4, false)).toBe(e.lengthWords);
      });
    });
  }

  it("parses the geometry as encoded", () => {
    const poly = readShp(encode(5, FIXTURES.polygon.recs).shp);
    expect(shapeKind(poly.header.shapeType)).toBe("polygon");
    expect(poly.records[0].parts).toEqual([0, 5]);
    expect(recordParts(poly.records[0]).map((p) => p.length)).toEqual([5, 5]);
    expect(poly.records[0].box).toEqual([0, 0, 100, 100]);

    const pz = readShp(encode(11, FIXTURES.pointz.recs).shp);
    expect(pz.records[0].points[0]).toEqual({ x: 1, y: 2, z: 3, m: 4 });
    expect(pz.records[0].hasM).toBe(true);
    expect(pz.records[1].points[0]).toEqual({ x: 5, y: 6, z: 7 });
    expect(pz.records[1].hasM).toBe(false);

    const lz = readShp(encode(13, FIXTURES.polylinez.recs).shp);
    expect(lz.records[1].points.map((p) => p.m)).toEqual([9, 8, 7]);
    expect(lz.records[1].zRange).toEqual([1, 3]);
    expect(recordParts(lz.records[1]).map((p) => p.length)).toEqual([1, 2]);

    const pt = readShp(encode(1, FIXTURES.point.recs).shp);
    expect(pt.records.map((r) => shapeKind(r.type))).toEqual(["point", "null", "point"]);
    expect(pt.records.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it("edits change only the targeted bytes", () => {
    const { shp } = encode(3, FIXTURES.polyline.recs);
    const file = readShp(shp);
    file.records[1].points[2].x = 5.5;
    const out = Buffer.from(writeShp(file));
    expect(out.length).toBe(shp.length);
    const diff = [...out].map((b, i) => (b !== shp[i] ? i : -1)).filter((i) => i >= 0);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.length).toBeLessThanOrEqual(8);
    const recordStart = 100 + 8 + content(FIXTURES.polyline.recs[0]).length;
    // record 2 header 8 + type 4 + box 32 + counts 8 + parts 8 + two points 32 = x of point 2
    const xAt = recordStart + 8 + 4 + 32 + 8 + 8 + 32;
    for (const i of diff) expect(i >= xAt && i < xAt + 8).toBe(true);
  });

  it("keeps bytes after the last whole record and content past the geometry", () => {
    const { shp } = encode(1, FIXTURES.point.recs);
    const withTail = Buffer.concat([shp, Buffer.from([1, 2, 3])]);
    const file = readShp(withTail);
    expect(file.trailing).toHaveLength(3);
    expect(Buffer.from(writeShp(file)).equals(withTail)).toBe(true);

    // A point record whose content length claims 4 more bytes than a point takes.
    const b = Buffer.from(shp);
    const padded = Buffer.concat([
      b.subarray(0, 100),
      (() => {
        const h = Buffer.alloc(8);
        h.writeInt32BE(1, 0);
        h.writeInt32BE((20 + 4) / 2, 4);
        return h;
      })(),
      content(FIXTURES.point.recs[0]),
      Buffer.from([9, 9, 9, 9]),
    ]);
    padded.writeInt32BE(padded.length / 2, 24);
    const f2 = readShp(padded);
    expect(f2.records[0].extra).toEqual(new Uint8Array([9, 9, 9, 9]));
    expect(Buffer.from(writeShp(f2)).equals(padded)).toBe(true);
  });

  it("names .shx disagreements", () => {
    const { shp, shx } = encode(3, FIXTURES.polyline.recs);
    const bad = Buffer.from(shx);
    bad.writeInt32BE(51, 100 + 8);
    const msgs = compareShx(readShp(shp), readShx(bad));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/record 2/);
    const short = readShx(shx.subarray(0, 108));
    expect(compareShx(readShp(shp), short)[0]).toMatch(/1 entries/);
    expect(shxEntries(readShp(shp))[0]).toEqual({ offsetWords: 50, lengthWords: 48 });
  });

  it("refuses what is not a shapefile", () => {
    expect(() => readShp(Buffer.alloc(50))).toThrow(ShapefileError);
    const notShp = Buffer.alloc(100);
    notShp.writeInt32BE(1234, 0);
    expect(() => readShp(notShp)).toThrow(/file code/);
    // A polyline record whose point count runs past its content.
    const { shp } = encode(3, [FIXTURES.polyline.recs[0]]);
    const cut = Buffer.from(shp);
    cut.writeInt32LE(99, 100 + 8 + 4 + 32 + 4);
    expect(() => readShp(cut)).toThrow(/runs past/);
  });
});

// The vanilla corpus: every .shp, .shx and .dbf in the game paks (none on 1.9.0.37, spec
// section 4), round-tripped through the repo's pak reader. Skipped when the game is absent.
const GAME = (() => {
  try {
    const gamePath = loadConfig().gamePath;
    if (!existsSync(join(gamePath, "addons"))) return undefined;
    const vfs = PakVirtualFS.get(gamePath);
    return vfs && vfs.fileCount > 0 ? vfs : undefined;
  } catch {
    return undefined;
  }
})();

describe.skipIf(GAME === undefined)("shapefile round trip on the vanilla paks", () => {
  it("every .shp, .shx and .dbf in the paks writes back byte-exact", () => {
    const vfs = GAME!;
    const files = vfs.allFilePaths().filter((p) => /\.(shp|shx|dbf)$/i.test(p));
    const misses: string[] = [];
    for (const p of files) {
      const buf = vfs.readFile(p);
      const ext = p.slice(-3).toLowerCase();
      const out =
        ext === "shp"
          ? writeShp(readShp(buf))
          : ext === "shx"
            ? writeShxFile(readShx(buf))
            : writeDbf(readDbf(buf));
      if (!Buffer.from(out).equals(buf)) misses.push(p);
    }
    console.info(`[shapefile corpus] ${files.length} shapefile parts in the paks`);
    expect(misses).toEqual([]);
  }, 120_000);
});

describe("dbf round trip", () => {
  const fields: Field[] = [
    { name: "ID", type: "N", length: 6 },
    { name: "NAME", type: "C", length: 12 },
    { name: "HEIGHT", type: "N", length: 10, decimals: 3 },
    { name: "LIT", type: "L", length: 1 },
    { name: "BUILT", type: "D", length: 8 },
  ];
  const rows = [
    ["1", "Road A", "12.500", "T", "20260101"],
    ["2", "Ünïcode-ish", "", "F", "19991231"],
    ["3", "", "-0.125", "?", "        "],
  ];

  it("write(read(dbf)) is byte-exact, with a deleted record and the EOF marker", () => {
    const buf = encodeDbf(fields, rows, [1]);
    const dbf = readDbf(buf);
    expect(dbf.fields.map((f) => f.name)).toEqual(["ID", "NAME", "HEIGHT", "LIT", "BUILT"]);
    expect(dbf.records[1].flag).toBe(0x2a);
    expect(dbf.tail).toEqual(new Uint8Array([0x1a]));
    expect(Buffer.from(writeDbf(dbf)).equals(buf)).toBe(true);
  });

  it("reads cells as values", () => {
    const dbf = readDbf(encodeDbf(fields, rows));
    expect(dbfRow(dbf, 0)).toEqual({
      ID: 1,
      NAME: "Road A",
      HEIGHT: 12.5,
      LIT: true,
      BUILT: "20260101",
    });
    expect(dbfRow(dbf, 1).HEIGHT).toBeNull();
    expect(dbfRow(dbf, 1).LIT).toBe(false);
    expect(dbfRow(dbf, 2).LIT).toBeNull();
    expect(dbfRow(dbf, 2).HEIGHT).toBe(-0.125);
    expect(dbfRow(dbf, 9)).toEqual({});
  });

  it("an edited cell changes only its bytes; header padding is kept", () => {
    const buf = encodeDbf(fields, rows);
    // A backlink-style pad between the terminator and the first record.
    const headerLen = buf.readUInt16LE(8);
    const padded = Buffer.concat([
      buf.subarray(0, headerLen),
      Buffer.alloc(4, 7),
      buf.subarray(headerLen),
    ]);
    padded.writeUInt16LE(headerLen + 4, 8);
    const dbf = readDbf(padded);
    expect(dbf.headerPad).toEqual(new Uint8Array([7, 7, 7, 7]));
    expect(Buffer.from(writeDbf(dbf)).equals(padded)).toBe(true);
    dbf.records[0].cells[1] = "Road B".padEnd(12);
    const out = Buffer.from(writeDbf(dbf));
    const diff = [...out].map((b, i) => (b !== padded[i] ? i : -1)).filter((i) => i >= 0);
    expect(diff).toHaveLength(1);
  });

  it("refuses a record length that disagrees with the fields", () => {
    const buf = encodeDbf(fields, rows);
    buf.writeUInt16LE(5, 10);
    expect(() => readDbf(buf)).toThrow(/record length/);
  });
});
