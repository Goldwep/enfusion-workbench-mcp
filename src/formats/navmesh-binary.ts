/**
 * Header readers for the two binary navmesh files of Enfusion, offline.
 *
 * `.nmn` (one per navmesh project of a world) and `.ntile` (one per tile, in
 * the sibling `<dir>/.NavData/<nmn stem>/navData_<n>.ntile` folder). Only the
 * headers are read; nothing here writes either format (PLAN 1.4 binary rule).
 *
 * What is known (W5 spec 4.1, measured on the 1.9.0.37 paks):
 *   .nmn   `EV` `02 00`, u32 version (3; 2 in a few files), floats at 0x14
 *          and 0x18 (the tile size: 24, 51 or 204), then an IFF `FORM` at
 *          offset 40 (big-endian size) of type `NAVM`, whose first chunk is
 *          `TFHE`.
 *   .ntile `FORM....NAVD` then the chunk `TIHE`.
 * Every other field is reported raw (hex, u32 and f32 little-endian) until
 * the offline probe P-W5-17 names it. A reader never throws: a short or
 * foreign file answers `ok: false` with the problems found.
 */

/** One field the readers do not name yet, as raw bytes and both readings. */
export interface RawField {
  offset: string;
  hex: string;
  u32: number;
  f32: number;
}

/** One IFF chunk inside a FORM. */
export interface IffChunk {
  id: string;
  /** Offset of the chunk header in the file. */
  offset: number;
  size: number;
}

export interface IffForm {
  offset: number;
  /** The FORM's own size field (big-endian): the bytes after it. */
  size: number;
  type: string;
  /** True when the FORM ends exactly at the end of the file. */
  sizeMatches: boolean;
  chunks: IffChunk[];
  /** True when the chunks cover the FORM body exactly. */
  chunksCover: boolean;
}

export interface NmnHeader {
  format: "nmn";
  ok: boolean;
  bytes: number;
  magic: string;
  /** u16 little-endian after the magic (2 in every vanilla file). */
  magicVersion?: number;
  /** u32 little-endian at 4 (3, or 2 in older bakes). */
  version?: number;
  /** f32 at 0x14 and 0x18: the tile size in metres (NavmeshWorldParams.TileSize). */
  tileSize?: [number, number];
  form?: IffForm;
  /** Fields not named until P-W5-17. */
  raw: RawField[];
  /**
   * Observed on the vanilla corpus, not confirmed: the u32 at 0x1c equals
   * the TFHE chunk size divided by 16 (one 16-byte record per tile cell).
   */
  observed?: { cellsAt0x1c: number; tfheRecords16?: number; agrees: boolean };
  problems: string[];
}

export interface NtileHeader {
  format: "ntile";
  ok: boolean;
  bytes: number;
  form?: IffForm;
  /** The first 16 bytes after the first chunk header, raw. */
  firstChunkHead?: string;
  problems: string[];
}

export const NMN_MAGIC = "EV";
export const NMN_FORM_OFFSET = 40;
export const NMN_FORM_TYPE = "NAVM";
export const NMN_FIRST_CHUNK = "TFHE";
export const NTILE_FORM_TYPE = "NAVD";
export const NTILE_FIRST_CHUNK = "TIHE";

/** Offsets of the .nmn header words that are not named yet. */
const NMN_RAW_OFFSETS = [0x08, 0x0c, 0x10, 0x1c, 0x20, 0x24] as const;
const MAX_CHUNKS = 64;

function hex(buf: Buffer, start: number, len: number): string {
  return buf.subarray(start, Math.min(buf.length, start + len)).toString("hex");
}

function rawAt(buf: Buffer, off: number): RawField {
  return {
    offset: `0x${off.toString(16).padStart(2, "0")}`,
    hex: hex(buf, off, 4),
    u32: buf.readUInt32LE(off),
    f32: roundFloat(buf.readFloatLE(off)),
  };
}

/** A float32 as the nearest short decimal (24, 203.98), NaN and infinities as 0. */
function roundFloat(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Number.parseFloat(v.toPrecision(7));
}

function fourCC(buf: Buffer, off: number): string {
  return off + 4 <= buf.length ? buf.toString("latin1", off, off + 4) : "";
}

function printable(id: string): boolean {
  return id.length === 4 && /^[\x20-\x7e]{4}$/.test(id);
}

/** Reads an IFF FORM at `off`; undefined when no `FORM` is there. */
export function readIffForm(buf: Buffer, off: number, problems: string[]): IffForm | undefined {
  if (fourCC(buf, off) !== "FORM") {
    problems.push(`no FORM at offset ${off}`);
    return undefined;
  }
  if (off + 12 > buf.length) {
    problems.push("the FORM header is cut short");
    return undefined;
  }
  const size = buf.readUInt32BE(off + 4);
  const type = fourCC(buf, off + 8);
  const end = Math.min(buf.length, off + 8 + size);
  const sizeMatches = off + 8 + size === buf.length;
  if (!sizeMatches) {
    problems.push(
      `the FORM size ${size} ends at ${off + 8 + size}, the file has ${buf.length} bytes`,
    );
  }
  const chunks: IffChunk[] = [];
  let p = off + 12;
  while (p + 8 <= end && chunks.length < MAX_CHUNKS) {
    const id = fourCC(buf, p);
    if (!printable(id)) {
      problems.push(`no chunk id at offset ${p}`);
      break;
    }
    const csize = buf.readUInt32BE(p + 4);
    chunks.push({ id, offset: p, size: csize });
    p += 8 + csize;
  }
  const chunksCover = p === off + 8 + size && chunks.length > 0;
  return { offset: off, size, type, sizeMatches, chunks, chunksCover };
}

/** The header of a `.nmn` navmesh file; never throws. */
export function readNmnHeader(input: Uint8Array): NmnHeader {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const problems: string[] = [];
  const out: NmnHeader = {
    format: "nmn",
    ok: false,
    bytes: buf.length,
    magic: buf.toString("latin1", 0, Math.min(2, buf.length)),
    raw: [],
    problems,
  };
  if (out.magic !== NMN_MAGIC) problems.push('the magic is not "EV"');
  if (buf.length < NMN_FORM_OFFSET) {
    problems.push(`the file has ${buf.length} bytes, the header needs ${NMN_FORM_OFFSET}`);
    return out;
  }
  out.magicVersion = buf.readUInt16LE(2);
  out.version = buf.readUInt32LE(4);
  out.tileSize = [roundFloat(buf.readFloatLE(0x14)), roundFloat(buf.readFloatLE(0x18))];
  out.raw = NMN_RAW_OFFSETS.map((o) => rawAt(buf, o));
  out.form = readIffForm(buf, NMN_FORM_OFFSET, problems);
  if (out.form && out.form.type !== NMN_FORM_TYPE) {
    problems.push(`the FORM type is "${out.form.type}", not "${NMN_FORM_TYPE}"`);
  }
  const first = out.form?.chunks[0];
  if (out.form && first?.id !== NMN_FIRST_CHUNK) {
    problems.push(`the first chunk is "${first?.id ?? "none"}", not "${NMN_FIRST_CHUNK}"`);
  }
  const cells = buf.readUInt32LE(0x1c);
  const records =
    first?.id === NMN_FIRST_CHUNK && first.size % 16 === 0 ? first.size / 16 : undefined;
  out.observed = { cellsAt0x1c: cells, tfheRecords16: records, agrees: records === cells };
  out.ok = problems.length === 0;
  return out;
}

/** The header of a `.ntile` tile file; never throws. */
export function readNtileHeader(input: Uint8Array): NtileHeader {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const problems: string[] = [];
  const out: NtileHeader = { format: "ntile", ok: false, bytes: buf.length, problems };
  out.form = readIffForm(buf, 0, problems);
  if (out.form && out.form.type !== NTILE_FORM_TYPE) {
    problems.push(`the FORM type is "${out.form.type}", not "${NTILE_FORM_TYPE}"`);
  }
  const first = out.form?.chunks[0];
  if (out.form && first?.id !== NTILE_FIRST_CHUNK) {
    problems.push(`the first chunk is "${first?.id ?? "none"}", not "${NTILE_FIRST_CHUNK}"`);
  }
  if (first) out.firstChunkHead = hex(buf, first.offset + 8, 16);
  out.ok = problems.length === 0;
  return out;
}

/** `.nmn` or `.ntile` by the bytes: an `EV` start is a navmesh, a `FORM` start a tile. */
export function sniffNavmeshBinary(input: Uint8Array): "nmn" | "ntile" | undefined {
  if (input.length >= 2 && input[0] === 0x45 && input[1] === 0x56) return "nmn";
  if (input.length >= 4 && Buffer.from(input.subarray(0, 4)).toString("latin1") === "FORM") {
    return "ntile";
  }
  return undefined;
}

/** The tile folder of a `.nmn` path: `<dir>/.NavData/<stem>` (forward slashes). */
export function navDataFolderOf(nmnPath: string): string {
  const p = nmnPath.replace(/\\/g, "/");
  const slash = p.lastIndexOf("/");
  const dir = slash < 0 ? "" : p.slice(0, slash);
  const base = p.slice(slash + 1);
  const stem = base.replace(/\.nmn$/i, "");
  return dir ? `${dir}/.NavData/${stem}` : `.NavData/${stem}`;
}

/** The tile index of `navData_<n>.ntile`; undefined for any other name. */
export function tileIndexOf(name: string): number | undefined {
  const m = /^navData_(\d+)\.ntile$/i.exec(name);
  return m ? Number(m[1]) : undefined;
}
