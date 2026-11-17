/**
 * ESRI Shapefile reader and writer (.shp, .shx, .dbf) for `wb_shape import`
 * (phase5-w6-spec.md sections 2.3 and 4; DEC-069 OD-7: the engine's GeoShapeLoader is a
 * cross-check only, P-W6-12).
 *
 * Lossless by construction: every byte a reader consumes is either a parsed value the writer
 * re-encodes the same way, or kept raw (the header's unused words, a record's bytes past its
 * geometry, a MultiPatch or unknown record's content, the .dbf's reserved bytes, header padding
 * and anything after the end-of-file marker). So `writeShp(readShp(b))` is `b` byte for byte for
 * a well-formed file, and `writeShx` derives the index from the records.
 *
 * Layout (ESRI white paper, July 1998): a 100-byte header, file code 9994 and the file length
 * in 16-bit words big-endian, version 1000, shape type and the box little-endian; then per
 * record a big-endian header (1-based record number, content length in words) and the
 * little-endian content. Shape types: 0 null, 1 point, 3 polyline, 5 polygon, 8 multipoint,
 * 11/13/15/18 the Z variants (M optional, told by the content length), 21/23/25/28 the M
 * variants, 31 multipatch (kept raw).
 */

export const SHP_FILE_CODE = 9994;
export const SHP_VERSION = 1000;
export const SHP_HEADER_BYTES = 100;

export const SHAPE_TYPES = {
  NULL: 0,
  POINT: 1,
  POLYLINE: 3,
  POLYGON: 5,
  MULTIPOINT: 8,
  POINTZ: 11,
  POLYLINEZ: 13,
  POLYGONZ: 15,
  MULTIPOINTZ: 18,
  POINTM: 21,
  POLYLINEM: 23,
  POLYGONM: 25,
  MULTIPOINTM: 28,
  MULTIPATCH: 31,
} as const;

export type ShapeKind = "null" | "point" | "polyline" | "polygon" | "multipoint" | "other";

/** The geometry family of a shape type number. */
export function shapeKind(type: number): ShapeKind {
  switch (type) {
    case 0:
      return "null";
    case 1:
    case 11:
    case 21:
      return "point";
    case 3:
    case 13:
    case 23:
      return "polyline";
    case 5:
    case 15:
    case 25:
      return "polygon";
    case 8:
    case 18:
    case 28:
      return "multipoint";
    default:
      return "other";
  }
}

/** True for the Z variants (11, 13, 15, 18). */
export function hasZ(type: number): boolean {
  return type === 11 || type === 13 || type === 15 || type === 18;
}

/** True for the M variants (21, 23, 25, 28); Z variants carry M only when hasM is set. */
export function isMType(type: number): boolean {
  return type === 21 || type === 23 || type === 25 || type === 28;
}

export class ShapefileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShapefileError";
  }
}

export interface ShpPoint {
  x: number;
  y: number;
  z?: number;
  m?: number;
}

export interface ShpHeader {
  /** Bytes 4..23: five unused big-endian words, kept as read. */
  unused: number[];
  /** The file length the header claims, in 16-bit words (recomputed on write). */
  fileLengthWords: number;
  version: number;
  shapeType: number;
  /** xmin, ymin, xmax, ymax, zmin, zmax, mmin, mmax. */
  bbox: number[];
}

export interface ShpRecord {
  /** The 1-based record number of the record header, kept as read. */
  number: number;
  /** The shape type of this record (0 for a null record in any file). */
  type: number;
  /** Polyline, polygon, multipoint: xmin, ymin, xmax, ymax. */
  box?: number[];
  /** Polyline and polygon: the first point index of each part. */
  parts?: number[];
  points: ShpPoint[];
  /** Multi-point Z variants: zmin, zmax. */
  zRange?: number[];
  /** Multi-point M (and Z with M) variants: mmin, mmax. */
  mRange?: number[];
  /** Z variants: whether the optional M block is present. */
  hasM?: boolean;
  /** Content bytes past the parsed geometry (kept for a lossless write). */
  extra?: Uint8Array;
  /** MultiPatch or unknown type: the whole content after the type word, kept raw. */
  raw?: Uint8Array;
}

export interface ShpFile {
  header: ShpHeader;
  records: ShpRecord[];
  /** Bytes after the last whole record (none in a well-formed file). */
  trailing: Uint8Array;
}

export interface ShxEntry {
  /** Offset of the record header in the .shp, in 16-bit words. */
  offsetWords: number;
  /** The record's content length in 16-bit words (the record header's). */
  lengthWords: number;
}

export interface ShxFile {
  header: ShpHeader;
  entries: ShxEntry[];
  trailing: Uint8Array;
}

// ── Header ───────────────────────────────────────────────────────────────────

function readHeader(view: DataView, label: string): ShpHeader {
  if (view.byteLength < SHP_HEADER_BYTES) {
    throw new ShapefileError(`${label} is ${view.byteLength} bytes, a header takes 100`);
  }
  const code = view.getInt32(0, false);
  if (code !== SHP_FILE_CODE) {
    throw new ShapefileError(`${label} file code is ${code}, a shapefile's is ${SHP_FILE_CODE}`);
  }
  const unused: number[] = [];
  for (let i = 0; i < 5; i++) unused.push(view.getInt32(4 + i * 4, false));
  const bbox: number[] = [];
  for (let i = 0; i < 8; i++) bbox.push(view.getFloat64(36 + i * 8, true));
  return {
    unused,
    fileLengthWords: view.getInt32(24, false),
    version: view.getInt32(28, true),
    shapeType: view.getInt32(32, true),
    bbox,
  };
}

function writeHeader(view: DataView, h: ShpHeader, fileBytes: number): void {
  view.setInt32(0, SHP_FILE_CODE, false);
  for (let i = 0; i < 5; i++) view.setInt32(4 + i * 4, h.unused[i] ?? 0, false);
  view.setInt32(24, fileBytes / 2, false);
  view.setInt32(28, h.version, true);
  view.setInt32(32, h.shapeType, true);
  for (let i = 0; i < 8; i++) view.setFloat64(36 + i * 8, h.bbox[i] ?? 0, true);
}

/** A plain Uint8Array copy of a range (a Node Buffer's slice would stay a Buffer). */
function copyOf(buf: Uint8Array, start: number, end: number = buf.length): Uint8Array {
  return new Uint8Array(buf.subarray(start, end));
}

function viewOf(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ── Record content ───────────────────────────────────────────────────────────

/** Parses one record's content (type word included) of `len` bytes at `at`. */
function readContent(view: DataView, at: number, len: number, number: number): ShpRecord {
  if (len < 4) throw new ShapefileError(`record ${number}: content of ${len} bytes has no type`);
  const end = at + len;
  const type = view.getInt32(at, true);
  const rec: ShpRecord = { number, type, points: [] };
  let p = at + 4;
  const need = (n: number, what: string) => {
    if (p + n > end) {
      throw new ShapefileError(`record ${number}: ${what} runs past its content (${len} bytes)`);
    }
  };
  const f64 = () => {
    const v = view.getFloat64(p, true);
    p += 8;
    return v;
  };
  const i32 = () => {
    const v = view.getInt32(p, true);
    p += 4;
    return v;
  };
  const kind = shapeKind(type);

  if (kind === "null") {
    // nothing
  } else if (kind === "point") {
    need(16, "the point");
    const pt: ShpPoint = { x: f64(), y: f64() };
    if (hasZ(type)) {
      need(8, "the point's z");
      pt.z = f64();
      rec.hasM = p + 8 <= end;
      if (rec.hasM) pt.m = f64();
    } else if (isMType(type)) {
      need(8, "the point's m");
      pt.m = f64();
    }
    rec.points.push(pt);
  } else if (kind === "polyline" || kind === "polygon" || kind === "multipoint") {
    need(32, "the box");
    rec.box = [f64(), f64(), f64(), f64()];
    let numParts = 0;
    if (kind !== "multipoint") {
      need(4, "the part count");
      numParts = i32();
    }
    need(4, "the point count");
    const numPoints = i32();
    if (numParts < 0 || numPoints < 0) {
      throw new ShapefileError(`record ${number}: negative part or point count`);
    }
    if (kind !== "multipoint") {
      need(numParts * 4, "the part indices");
      rec.parts = [];
      for (let i = 0; i < numParts; i++) rec.parts.push(i32());
    }
    need(numPoints * 16, "the points");
    for (let i = 0; i < numPoints; i++) rec.points.push({ x: f64(), y: f64() });
    if (hasZ(type)) {
      need(16 + numPoints * 8, "the z block");
      rec.zRange = [f64(), f64()];
      for (const pt of rec.points) pt.z = f64();
      rec.hasM = p + 16 + numPoints * 8 <= end;
    }
    if (isMType(type) || rec.hasM) {
      // An M type without its M block is legal ("optional"): told by the length.
      if (p + 16 + numPoints * 8 <= end) {
        rec.mRange = [f64(), f64()];
        for (const pt of rec.points) pt.m = f64();
        if (isMType(type)) rec.hasM = true;
      } else if (isMType(type)) {
        rec.hasM = false;
      }
    }
  } else {
    rec.raw = new Uint8Array(view.buffer.slice(view.byteOffset + p, view.byteOffset + end));
    p = end;
  }
  if (p < end)
    rec.extra = new Uint8Array(view.buffer.slice(view.byteOffset + p, view.byteOffset + end));
  return rec;
}

/** The byte length of one record's content (type word included). */
export function contentBytes(rec: ShpRecord): number {
  const kind = shapeKind(rec.type);
  let n = 4;
  const pts = rec.points.length;
  if (kind === "null") {
    // type only
  } else if (kind === "point") {
    n += 16;
    if (hasZ(rec.type)) n += 8 + (rec.hasM ? 8 : 0);
    else if (isMType(rec.type)) n += 8;
  } else if (kind === "polyline" || kind === "polygon" || kind === "multipoint") {
    n += 32 + 4 + pts * 16;
    if (kind !== "multipoint") n += 4 + (rec.parts?.length ?? 0) * 4;
    if (hasZ(rec.type)) n += 16 + pts * 8;
    if (rec.hasM) n += 16 + pts * 8;
  } else {
    n += rec.raw?.length ?? 0;
  }
  return n + (rec.extra?.length ?? 0);
}

function writeContent(view: DataView, at: number, rec: ShpRecord): number {
  let p = at;
  const f64 = (v: number) => {
    view.setFloat64(p, v, true);
    p += 8;
  };
  const i32 = (v: number) => {
    view.setInt32(p, v, true);
    p += 4;
  };
  i32(rec.type);
  const kind = shapeKind(rec.type);
  if (kind === "point") {
    const pt = rec.points[0] ?? { x: 0, y: 0 };
    f64(pt.x);
    f64(pt.y);
    if (hasZ(rec.type)) {
      f64(pt.z ?? 0);
      if (rec.hasM) f64(pt.m ?? 0);
    } else if (isMType(rec.type)) {
      f64(pt.m ?? 0);
    }
  } else if (kind === "polyline" || kind === "polygon" || kind === "multipoint") {
    const box = rec.box ?? boxOf(rec.points);
    for (let i = 0; i < 4; i++) f64(box[i]);
    if (kind !== "multipoint") i32(rec.parts?.length ?? 0);
    i32(rec.points.length);
    if (kind !== "multipoint") for (const part of rec.parts ?? []) i32(part);
    for (const pt of rec.points) {
      f64(pt.x);
      f64(pt.y);
    }
    if (hasZ(rec.type)) {
      const zr = rec.zRange ?? rangeOf(rec.points.map((q) => q.z ?? 0));
      f64(zr[0]);
      f64(zr[1]);
      for (const pt of rec.points) f64(pt.z ?? 0);
    }
    if (rec.hasM) {
      const mr = rec.mRange ?? rangeOf(rec.points.map((q) => q.m ?? 0));
      f64(mr[0]);
      f64(mr[1]);
      for (const pt of rec.points) f64(pt.m ?? 0);
    }
  } else if (kind === "other" && rec.raw) {
    new Uint8Array(view.buffer, view.byteOffset + p, rec.raw.length).set(rec.raw);
    p += rec.raw.length;
  }
  if (rec.extra) {
    new Uint8Array(view.buffer, view.byteOffset + p, rec.extra.length).set(rec.extra);
    p += rec.extra.length;
  }
  return p;
}

/** xmin, ymin, xmax, ymax of points (zeros when there are none). */
export function boxOf(points: ShpPoint[]): number[] {
  if (points.length === 0) return [0, 0, 0, 0];
  const xs = points.map((q) => q.x);
  const ys = points.map((q) => q.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function rangeOf(values: number[]): number[] {
  return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
}

// ── .shp ─────────────────────────────────────────────────────────────────────

/** Reads a .shp. Throws ShapefileError on a file that is not one or is cut short. */
export function readShp(buf: Uint8Array): ShpFile {
  const view = viewOf(buf);
  const header = readHeader(view, ".shp");
  const records: ShpRecord[] = [];
  let at = SHP_HEADER_BYTES;
  while (at + 8 <= buf.length) {
    const number = view.getInt32(at, false);
    const lengthWords = view.getInt32(at + 4, false);
    const len = lengthWords * 2;
    if (lengthWords < 2 || at + 8 + len > buf.length) break;
    records.push(readContent(view, at + 8, len, number));
    at += 8 + len;
  }
  return { header, records, trailing: copyOf(buf, at) };
}

/** The .shp bytes of a file model. */
export function writeShp(file: ShpFile): Uint8Array {
  let size = SHP_HEADER_BYTES;
  for (const r of file.records) size += 8 + contentBytes(r);
  size += file.trailing.length;
  const out = new Uint8Array(size);
  const view = viewOf(out);
  writeHeader(view, file.header, size - file.trailing.length);
  let at = SHP_HEADER_BYTES;
  for (const r of file.records) {
    const len = contentBytes(r);
    if (len % 2 !== 0) throw new ShapefileError(`record ${r.number}: odd content length ${len}`);
    view.setInt32(at, r.number, false);
    view.setInt32(at + 4, len / 2, false);
    const end = writeContent(view, at + 8, r);
    if (end !== at + 8 + len) {
      throw new ShapefileError(`record ${r.number}: wrote ${end - at - 8} of ${len} bytes`);
    }
    at = end;
  }
  out.set(file.trailing, at);
  return out;
}

// ── .shx ─────────────────────────────────────────────────────────────────────

export function readShx(buf: Uint8Array): ShxFile {
  const view = viewOf(buf);
  const header = readHeader(view, ".shx");
  const entries: ShxEntry[] = [];
  let at = SHP_HEADER_BYTES;
  while (at + 8 <= buf.length) {
    entries.push({
      offsetWords: view.getInt32(at, false),
      lengthWords: view.getInt32(at + 4, false),
    });
    at += 8;
  }
  return { header, entries, trailing: copyOf(buf, at) };
}

/** The index entries a .shp's records give. */
export function shxEntries(file: ShpFile): ShxEntry[] {
  const out: ShxEntry[] = [];
  let at = SHP_HEADER_BYTES;
  for (const r of file.records) {
    const len = contentBytes(r);
    out.push({ offsetWords: at / 2, lengthWords: len / 2 });
    at += 8 + len;
  }
  return out;
}

/** The .shx bytes for a .shp model (header as the .shp's, its own file length). */
export function writeShx(file: ShpFile): Uint8Array {
  const entries = shxEntries(file);
  const size = SHP_HEADER_BYTES + entries.length * 8;
  const out = new Uint8Array(size);
  const view = viewOf(out);
  writeHeader(view, file.header, size);
  let at = SHP_HEADER_BYTES;
  for (const e of entries) {
    view.setInt32(at, e.offsetWords, false);
    view.setInt32(at + 4, e.lengthWords, false);
    at += 8;
  }
  return out;
}

/** Writes an .shx model back (entries as read, header length recomputed). */
export function writeShxFile(shx: ShxFile): Uint8Array {
  const body = SHP_HEADER_BYTES + shx.entries.length * 8;
  const out = new Uint8Array(body + shx.trailing.length);
  const view = viewOf(out);
  writeHeader(view, shx.header, body);
  let at = SHP_HEADER_BYTES;
  for (const e of shx.entries) {
    view.setInt32(at, e.offsetWords, false);
    view.setInt32(at + 4, e.lengthWords, false);
    at += 8;
  }
  out.set(shx.trailing, body);
  return out;
}

/** Where an .shx disagrees with the .shp's record headers; empty when they agree. */
export function compareShx(file: ShpFile, shx: ShxFile): string[] {
  const want = shxEntries(file);
  const out: string[] = [];
  if (want.length !== shx.entries.length) {
    out.push(`.shx holds ${shx.entries.length} entries, the .shp ${want.length} records`);
  }
  const n = Math.min(want.length, shx.entries.length);
  for (let i = 0; i < n; i++) {
    const a = want[i];
    const b = shx.entries[i];
    if (a.offsetWords !== b.offsetWords || a.lengthWords !== b.lengthWords) {
      out.push(
        `record ${i + 1}: .shx says offset ${b.offsetWords} length ${b.lengthWords}, ` +
          `the .shp ${a.offsetWords} and ${a.lengthWords} (16-bit words)`,
      );
    }
  }
  return out;
}

// ── Parts ────────────────────────────────────────────────────────────────────

/** The parts of a polyline or polygon record as point lists (one list for other kinds). */
export function recordParts(rec: ShpRecord): ShpPoint[][] {
  const parts = rec.parts;
  if (!parts || parts.length === 0) return rec.points.length ? [rec.points] : [];
  const out: ShpPoint[][] = [];
  for (let i = 0; i < parts.length; i++) {
    const start = Math.max(0, parts[i]);
    const end = i + 1 < parts.length ? parts[i + 1] : rec.points.length;
    out.push(rec.points.slice(start, Math.max(start, end)));
  }
  return out;
}

// ── .dbf (dBASE III) ─────────────────────────────────────────────────────────

export interface DbfField {
  name: string;
  /** C, N, F, L, D, ... */
  type: string;
  length: number;
  decimals: number;
  /** The 32-byte descriptor as read; its reserved bytes are kept on write. */
  raw?: Uint8Array;
}

export interface DbfRecord {
  /** The deletion flag byte: 0x20 live, 0x2a deleted. */
  flag: number;
  /** One latin1 cell per field, padded as stored. */
  cells: string[];
}

export interface DbfFile {
  /** The 32-byte file header as read (version, date, reserved bytes kept). */
  head: Uint8Array;
  fields: DbfField[];
  /** Bytes between the field terminator 0x0d and the header length (e.g. a backlink). */
  headerPad: Uint8Array;
  records: DbfRecord[];
  /** Bytes after the last record: usually the 0x1a end-of-file marker. */
  tail: Uint8Array;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function latin1Bytes(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length).fill(0x20);
  for (let i = 0; i < Math.min(length, text.length); i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** The field name of a 32-byte descriptor: bytes 0..10 up to the first NUL. */
function fieldName(raw: Uint8Array): string {
  const nameBytes = raw.subarray(0, 11);
  const zero = nameBytes.indexOf(0);
  return latin1(zero < 0 ? nameBytes : nameBytes.subarray(0, zero));
}

export function readDbf(buf: Uint8Array): DbfFile {
  if (buf.length < 33) throw new ShapefileError(`.dbf is ${buf.length} bytes, too short`);
  const view = viewOf(buf);
  const count = view.getUint32(4, true);
  const headerLen = view.getUint16(8, true);
  const recordLen = view.getUint16(10, true);
  if (headerLen > buf.length) throw new ShapefileError(".dbf header runs past the file");
  const fields: DbfField[] = [];
  let at = 32;
  while (at < headerLen && buf[at] !== 0x0d) {
    if (at + 32 > headerLen) throw new ShapefileError(".dbf field descriptor runs past the header");
    const raw = copyOf(buf, at, at + 32);
    fields.push({
      name: fieldName(raw),
      type: String.fromCharCode(raw[11]),
      length: raw[16],
      decimals: raw[17],
      raw,
    });
    at += 32;
  }
  if (buf[at] !== 0x0d) throw new ShapefileError(".dbf has no field terminator");
  const headerPad = copyOf(buf, at + 1, headerLen);
  const width = 1 + fields.reduce((s, f) => s + f.length, 0);
  if (width !== recordLen) {
    throw new ShapefileError(`.dbf record length ${recordLen} differs from its fields' ${width}`);
  }
  const records: DbfRecord[] = [];
  let p = headerLen;
  for (let i = 0; i < count && p + recordLen <= buf.length; i++) {
    const cells: string[] = [];
    let q = p + 1;
    for (const f of fields) {
      cells.push(latin1(buf.subarray(q, q + f.length)));
      q += f.length;
    }
    records.push({ flag: buf[p], cells });
    p += recordLen;
  }
  return { head: copyOf(buf, 0, 32), fields, headerPad, records, tail: copyOf(buf, p) };
}

export function writeDbf(dbf: DbfFile): Uint8Array {
  const headerLen = 32 + dbf.fields.length * 32 + 1 + dbf.headerPad.length;
  const recordLen = 1 + dbf.fields.reduce((s, f) => s + f.length, 0);
  const size = headerLen + dbf.records.length * recordLen + dbf.tail.length;
  const out = new Uint8Array(size);
  const view = viewOf(out);
  out.set(dbf.head.subarray(0, 32), 0);
  view.setUint32(4, dbf.records.length, true);
  view.setUint16(8, headerLen, true);
  view.setUint16(10, recordLen, true);
  let at = 32;
  for (const f of dbf.fields) {
    const d = new Uint8Array(32);
    if (f.raw) d.set(f.raw.subarray(0, 32));
    if (!f.raw || fieldName(f.raw) !== f.name) {
      d.fill(0, 0, 11);
      for (let i = 0; i < Math.min(10, f.name.length); i++) d[i] = f.name.charCodeAt(i) & 0xff;
    }
    d[11] = f.type.charCodeAt(0) & 0xff;
    d[16] = f.length;
    d[17] = f.decimals;
    out.set(d, at);
    at += 32;
  }
  out[at++] = 0x0d;
  out.set(dbf.headerPad, at);
  at = headerLen;
  for (const r of dbf.records) {
    out[at] = r.flag;
    let q = at + 1;
    dbf.fields.forEach((f, i) => {
      out.set(latin1Bytes(r.cells[i] ?? "", f.length), q);
      q += f.length;
    });
    at += recordLen;
  }
  out.set(dbf.tail, at);
  return out;
}

/** One cell as a value: numbers for N and F (null when blank), booleans for L, else trimmed text. */
export function dbfValue(field: DbfField, cell: string): string | number | boolean | null {
  const t = cell.trim();
  if (field.type === "N" || field.type === "F") {
    if (t === "" || /^\*+$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "L") {
    if ("YyTt".includes(t)) return true;
    if ("NnFf".includes(t) && t !== "") return false;
    return null;
  }
  return t;
}

/** A record's cells as name → value. */
export function dbfRow(
  dbf: DbfFile,
  index: number,
): Record<string, string | number | boolean | null> {
  const rec = dbf.records[index];
  const out: Record<string, string | number | boolean | null> = {};
  if (!rec) return out;
  dbf.fields.forEach((f, i) => (out[f.name] = dbfValue(f, rec.cells[i] ?? "")));
  return out;
}
