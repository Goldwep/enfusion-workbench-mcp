/**
 * Terrain height writers for the two fallback routes of U18 (phase5-w7-spec.md section 3.2):
 *
 * - K1: the binary file Bohemia's `ExportTerrain` NET handler reads
 *   (scripts/WorkbenchGameCommon/EnfusionBlenderTools/ExportTerrain.c, 1.9.0.37). Per record it
 *   calls `bin.ReadArray(indices, 4, 2)` then `bin.ReadArray(coords, 4, area)` and writes
 *   `SetTerrainSurfaceTile(0, indices[0], indices[1], coords)`: int32 tileX, int32 tileY, then
 *   `area` float32 heights. Little-endian is assumed [unverified until P-W7-09]. The reader here
 *   is written to those reads.
 * - K2: an ESRI ASCII grid (`.asc`) the owner imports through Terrain Tool, Manage (OI-W7-4).
 *   Header `ncols`, `nrows`, `xllcorner`, `yllcorner`, `cellsize`, `NODATA_value`, then `nrows`
 *   lines of `ncols` values, the first line the northern (largest z) row.
 *
 * Pure: no I/O.
 */

export class TerrainExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerrainExportError";
  }
}

// ── K1: ExportTerrain binary ─────────────────────────────────────────────────

export interface ExportRecord {
  tileX: number;
  tileY: number;
  /** `area` heights in tile array order. */
  heights: ArrayLike<number>;
}

/** Bytes of one record: two int32 then `area` float32. */
export function recordBytes(area: number): number {
  return 8 + 4 * area;
}

const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;

/** The binary ExportTerrain reads: `count` records of int32 tileX, int32 tileY, `area` float32. */
export function writeExportTerrain(records: readonly ExportRecord[], area: number): Buffer {
  if (!(Number.isInteger(area) && area >= 1)) {
    throw new TerrainExportError(`area must be a positive integer, got ${area}`);
  }
  const buf = Buffer.alloc(records.length * recordBytes(area));
  let off = 0;
  records.forEach((r, i) => {
    for (const [k, v] of [
      ["tileX", r.tileX],
      ["tileY", r.tileY],
    ] as const) {
      if (!Number.isInteger(v) || v < INT32_MIN || v > INT32_MAX) {
        throw new TerrainExportError(`records[${i}].${k} must be an int32, got ${v}`);
      }
    }
    if (r.heights.length !== area) {
      throw new TerrainExportError(
        `records[${i}] holds ${r.heights.length} heights, area is ${area}`,
      );
    }
    buf.writeInt32LE(r.tileX, off);
    buf.writeInt32LE(r.tileY, off + 4);
    off += 8;
    for (let k = 0; k < area; k++) {
      const v = r.heights[k];
      if (!Number.isFinite(v))
        throw new TerrainExportError(`records[${i}] height ${k} is not finite`);
      buf.writeFloatLE(v, off);
      off += 4;
    }
  });
  return buf;
}

/**
 * Reads the binary as ExportTerrain.c does: for each of `count` records, two int32 then `area`
 * float32. Throws when the buffer is shorter than that; trailing bytes are ignored, as the
 * handler ignores them.
 */
export function readExportTerrain(buf: Buffer, area: number, count: number): ExportRecord[] {
  const need = count * recordBytes(area);
  if (buf.length < need) {
    throw new TerrainExportError(
      `the file has ${buf.length} bytes, ${need} needed for ${count} records`,
    );
  }
  const out: ExportRecord[] = [];
  let off = 0;
  for (let i = 0; i < count; i++) {
    const tileX = buf.readInt32LE(off);
    const tileY = buf.readInt32LE(off + 4);
    off += 8;
    const heights: number[] = [];
    for (let k = 0; k < area; k++) {
      heights.push(buf.readFloatLE(off));
      off += 4;
    }
    out.push({ tileX, tileY, heights });
  }
  return out;
}

// ── K2: ESRI ASCII grid ──────────────────────────────────────────────────────

export interface AscGrid {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
  nodata: number;
  /** Row-major, `nrows * ncols`, the first row the northern one. */
  values: ArrayLike<number>;
}

export const ASC_DECIMALS = 4;
export const ASC_NODATA = -9999;

function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) throw new TerrainExportError(`value ${v} is not finite`);
  let s = v.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/** The `.asc` text of a grid (CRLF line ends are not used; LF only). */
export function formatAsc(g: AscGrid, decimals = ASC_DECIMALS): string {
  for (const [k, v] of [
    ["ncols", g.ncols],
    ["nrows", g.nrows],
  ] as const) {
    if (!Number.isInteger(v) || v < 1)
      throw new TerrainExportError(`${k} must be a positive integer`);
  }
  if (!(Number.isFinite(g.cellsize) && g.cellsize > 0)) {
    throw new TerrainExportError("cellsize must be a positive number");
  }
  if (g.values.length !== g.ncols * g.nrows) {
    throw new TerrainExportError(`values holds ${g.values.length}, ${g.ncols * g.nrows} expected`);
  }
  const lines = [
    `ncols ${g.ncols}`,
    `nrows ${g.nrows}`,
    `xllcorner ${formatNumber(g.xllcorner, 6)}`,
    `yllcorner ${formatNumber(g.yllcorner, 6)}`,
    `cellsize ${formatNumber(g.cellsize, 6)}`,
    `NODATA_value ${formatNumber(g.nodata, decimals)}`,
  ];
  for (let r = 0; r < g.nrows; r++) {
    const row: string[] = [];
    for (let c = 0; c < g.ncols; c++) row.push(formatNumber(g.values[r * g.ncols + c], decimals));
    lines.push(row.join(" "));
  }
  return `${lines.join("\n")}\n`;
}

const HEADER_KEYS = ["ncols", "nrows", "xllcorner", "yllcorner", "cellsize", "nodata_value"];

/** Parses an `.asc` (header keys in any case; `xllcenter`/`yllcenter` are refused). */
export function parseAsc(text: string): AscGrid {
  const tokens = text.split(/\s+/).filter((t) => t !== "");
  const header = new Map<string, number>();
  let i = 0;
  while (i + 1 < tokens.length && /^[A-Za-z_]+$/.test(tokens[i])) {
    const key = tokens[i].toLowerCase();
    if (!HEADER_KEYS.includes(key)) {
      throw new TerrainExportError(`unknown .asc header key '${tokens[i]}'`);
    }
    const v = Number(tokens[i + 1]);
    if (!Number.isFinite(v)) throw new TerrainExportError(`header ${tokens[i]} is not a number`);
    header.set(key, v);
    i += 2;
  }
  for (const k of HEADER_KEYS.slice(0, 5)) {
    if (!header.has(k)) throw new TerrainExportError(`the .asc header has no ${k}`);
  }
  const ncols = header.get("ncols")!;
  const nrows = header.get("nrows")!;
  if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || ncols < 1 || nrows < 1) {
    throw new TerrainExportError("ncols and nrows must be positive integers");
  }
  const body = tokens.slice(i);
  if (body.length !== ncols * nrows) {
    throw new TerrainExportError(`the .asc holds ${body.length} values, ${ncols * nrows} expected`);
  }
  const values = body.map((t, k) => {
    const v = Number(t);
    if (!Number.isFinite(v)) throw new TerrainExportError(`value ${k} ('${t}') is not a number`);
    return v;
  });
  return {
    ncols,
    nrows,
    xllcorner: header.get("xllcorner")!,
    yllcorner: header.get("yllcorner")!,
    cellsize: header.get("cellsize")!,
    nodata: header.get("nodata_value") ?? ASC_NODATA,
    values,
  };
}

/**
 * A grid from global heights stored row-major by z (`heights[gz * countX + gx]`, gz growing
 * north): the `.asc` lists the northern row first, so row r is gz = countZ - 1 - r. The lower-left
 * corner is the terrain's origin (boundsMin x and z).
 */
export function ascFromGlobal(
  heights: ArrayLike<number>,
  countX: number,
  countZ: number,
  originX: number,
  originZ: number,
  cellsize: number,
): AscGrid {
  if (heights.length !== countX * countZ) {
    throw new TerrainExportError(`heights holds ${heights.length}, ${countX * countZ} expected`);
  }
  const values = new Float64Array(countX * countZ);
  for (let r = 0; r < countZ; r++) {
    const gz = countZ - 1 - r;
    for (let gx = 0; gx < countX; gx++) values[r * countX + gx] = heights[gz * countX + gx];
  }
  return {
    ncols: countX,
    nrows: countZ,
    xllcorner: originX,
    yllcorner: originZ,
    cellsize,
    nodata: ASC_NODATA,
    values,
  };
}
