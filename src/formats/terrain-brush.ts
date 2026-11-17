/**
 * Terrain brush maths and the height patch codec of `wb_terrain_edit` (wave W7, phase5-w7-spec.md
 * sections 2.1 and 4; DEC-075 OD-3).
 *
 * Build 1.9.0.37 has no brush API (ModifyHeightMap* is gone), so sculpt, flatten, smooth and noise
 * are computed here from tiles read back (`tileRead`) and written as height runs (`tileWrite`).
 *
 * Tile array order. The engine's tile array is `row * side + col`; which world axis a row follows
 * is U18's third question, settled only by probe P-W7-01. Every mapping here takes the order as a
 * parameter ({@link TileOrder}). {@link TILE_ORDER} is the recorded constant and stays undefined
 * until P-W7-01 records it; until then the tool refuses `brush` GATED. No order is guessed.
 *
 *   - `xMajor`: x runs along a row (col = x, row = z); `zMajor`: z runs along a row (col = z,
 *     row = x). Tile index tileX follows x and tileY follows z.
 *   - `flipZ`: the global z sample index is mirrored (`countZ - 1 - gz`) before it is split into
 *     tile and local index, so tile rows and local rows flip together.
 *
 * Seams (P-W7-02). With `sharedEdges` false a tile owns `side` samples per axis and tiles do not
 * overlap (layout "disjoint": resolution = tiles * side). With `sharedEdges` true neighbouring tiles
 * share their edge samples (layout "sharedEdge": resolution = tiles * (side - 1) + 1, stride
 * `side - 1`) and the patcher writes every copy of a shared sample. Vanilla EmptyArland is the
 * second: 2049 samples in 16 tiles, and one tile reads 129 * 129 (W1, P-W1-15). The layout is never
 * taken from the resolution alone: {@link tileLayouts} gives the candidates and a tile's sample
 * count picks one ({@link layoutOfSamples}, the handler's ConfirmSide).
 *
 * Heights travel as text with 4 decimals (0.1 mm, inside P-W7-16's 1 mm). Pure: no I/O.
 */

// ── Order and grid ───────────────────────────────────────────────────────────

export type AxisOrder = "xMajor" | "zMajor";

export interface TileOrder {
  order: AxisOrder;
  flipZ: boolean;
}

/** The probe that records the tile array order. */
export const TILE_ORDER_PROBE = "P-W7-01";

/**
 * The tile array order P-W7-01 records. Undefined until then (DEC-075 OD-3): the main session sets
 * it on the probe's evidence, and `brush` refuses GATED while it is undefined.
 */
export const TILE_ORDER: TileOrder | undefined = undefined;

export interface TerrainGrid {
  tilesX: number;
  tilesY: number;
  /** Samples per tile row (tiles are square). */
  side: number;
  /** Metres between two samples. */
  unitScale: number;
  /** World x and z of global sample (0, 0): the terrain's boundsMin. */
  originX: number;
  originZ: number;
  /** Neighbouring tiles share their edge samples (P-W7-02). Default false. */
  sharedEdges?: boolean;
}

/** A refusal raised by the maths or the codec (the tool answers INVALID_ARGUMENT). */
export class BrushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrushError";
  }
}

function stride(g: TerrainGrid): number {
  return g.sharedEdges ? g.side - 1 : g.side;
}

/** Global samples along x. */
export function samplesX(g: TerrainGrid): number {
  return g.sharedEdges ? g.tilesX * (g.side - 1) + 1 : g.tilesX * g.side;
}

/** Global samples along z. */
export function samplesZ(g: TerrainGrid): number {
  return g.sharedEdges ? g.tilesY * (g.side - 1) + 1 : g.tilesY * g.side;
}

/** A tile layout: "single" is one tile per axis, where both formulas give the same side. */
export type TileLayout = "disjoint" | "sharedEdge" | "single";

/**
 * The tile sides the resolution allows (0 = that layout does not fit with square tiles):
 * disjoint res = tiles * side, sharedEdge res = tiles * (side - 1) + 1. As the handler's Grid.
 */
export function tileLayouts(
  resX: number,
  resY: number,
  tilesX: number,
  tilesY: number,
): { disjoint: number; shared: number } {
  const ok = [resX, resY, tilesX, tilesY].every((v) => Number.isInteger(v) && v >= 1);
  if (!ok) return { disjoint: 0, shared: 0 };
  const evenX = resX / tilesX;
  const evenY = resY / tilesY;
  const disjoint = Number.isInteger(evenX) && evenX >= 2 && evenX === evenY ? evenX : 0;
  const strideX = (resX - 1) / tilesX;
  const strideY = (resY - 1) / tilesY;
  const shared = Number.isInteger(strideX) && strideX >= 1 && strideX === strideY ? strideX + 1 : 0;
  return { disjoint, shared };
}

/**
 * The layout one tile's sample count confirms: side * side for one of the candidates, else null.
 * As the handler's ConfirmSide.
 */
export function layoutOfSamples(
  c: { disjoint: number; shared: number },
  sampleCount: number,
): { side: number; layout: TileLayout } | null {
  const isShared = c.shared > 0 && sampleCount === c.shared * c.shared;
  const isDisjoint = c.disjoint > 0 && sampleCount === c.disjoint * c.disjoint;
  if (isShared && isDisjoint) return { side: c.shared, layout: "single" };
  if (isShared) return { side: c.shared, layout: "sharedEdge" };
  if (isDisjoint) return { side: c.disjoint, layout: "disjoint" };
  return null;
}

/** Checks a grid's numbers; throws BrushError. */
export function checkGrid(g: TerrainGrid): void {
  const ints: Array<[string, number]> = [
    ["tilesX", g.tilesX],
    ["tilesY", g.tilesY],
    ["side", g.side],
  ];
  for (const [k, v] of ints) {
    if (!Number.isInteger(v) || v < 1) throw new BrushError(`${k} must be a positive integer`);
  }
  if (g.sharedEdges && g.side < 2) throw new BrushError("shared edges need a side of 2 or more");
  if (!(Number.isFinite(g.unitScale) && g.unitScale > 0)) {
    throw new BrushError("unitScale must be a positive number");
  }
  if (!Number.isFinite(g.originX) || !Number.isFinite(g.originZ)) {
    throw new BrushError("the terrain origin must be finite");
  }
}

export function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

export function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

interface AxisPlace {
  tile: number;
  local: number;
}

function axisPlacements(gi: number, tiles: number, g: TerrainGrid): AxisPlace[] {
  const s = stride(g);
  const tile = Math.min(Math.floor(gi / s), tiles - 1);
  const local = gi - tile * s;
  const out: AxisPlace[] = [{ tile, local }];
  if (g.sharedEdges && local === 0 && tile > 0) out.push({ tile: tile - 1, local: s });
  return out;
}

/** One copy of a global sample in a tile array. */
export interface Placement {
  tileX: number;
  tileY: number;
  /** Index into the tile array (row * side + col). */
  index: number;
}

/** Every tile array slot that holds global sample (gx, gz): one, or up to four on shared edges. */
export function placements(g: TerrainGrid, o: TileOrder, gx: number, gz: number): Placement[] {
  const gzz = o.flipZ ? samplesZ(g) - 1 - gz : gz;
  const out: Placement[] = [];
  for (const x of axisPlacements(gx, g.tilesX, g)) {
    for (const z of axisPlacements(gzz, g.tilesY, g)) {
      const index = o.order === "xMajor" ? z.local * g.side + x.local : x.local * g.side + z.local;
      out.push({ tileX: x.tile, tileY: z.tile, index });
    }
  }
  return out;
}

/** The global sample (gx, gz) of a tile array slot: the inverse of {@link placements}. */
export function globalOf(
  g: TerrainGrid,
  o: TileOrder,
  tileX: number,
  tileY: number,
  index: number,
): [number, number] {
  const row = Math.floor(index / g.side);
  const col = index % g.side;
  const lx = o.order === "xMajor" ? col : row;
  const lz = o.order === "xMajor" ? row : col;
  const s = stride(g);
  const gx = tileX * s + lx;
  const gzz = tileY * s + lz;
  return [gx, o.flipZ ? samplesZ(g) - 1 - gzz : gzz];
}

// ── Height window ────────────────────────────────────────────────────────────

/** A rectangle of global samples, row-major by z: `data[(gz - z0) * w + (gx - x0)]`. */
export interface HeightWindow {
  x0: number;
  z0: number;
  w: number;
  h: number;
  data: Float64Array;
}

/** World x and z of a global sample. */
export function worldOf(g: TerrainGrid, gx: number, gz: number): [number, number] {
  return [g.originX + gx * g.unitScale, g.originZ + gz * g.unitScale];
}

/**
 * The global sample rectangle that covers the circle (centre, radius) plus `margin` samples on
 * each side, clipped to the terrain. Throws BrushError when the circle misses the terrain.
 */
export function brushRect(
  g: TerrainGrid,
  centreX: number,
  centreZ: number,
  radius: number,
  margin = 1,
): { x0: number; z0: number; w: number; h: number } {
  const lo = (v: number, origin: number) => Math.ceil((v - radius - origin) / g.unitScale) - margin;
  const hi = (v: number, origin: number) =>
    Math.floor((v + radius - origin) / g.unitScale) + margin;
  const x0 = Math.max(0, lo(centreX, g.originX));
  const z0 = Math.max(0, lo(centreZ, g.originZ));
  const x1 = Math.min(samplesX(g) - 1, hi(centreX, g.originX));
  const z1 = Math.min(samplesZ(g) - 1, hi(centreZ, g.originZ));
  if (x1 < x0 || z1 < z0) {
    throw new BrushError(
      `the brush at ${centreX} ${centreZ} with radius ${radius} m does not reach the terrain`,
    );
  }
  return { x0, z0, w: x1 - x0 + 1, h: z1 - z0 + 1 };
}

/** The tiles that hold any sample of a rectangle (every copy on shared edges), sorted by y then x. */
export function tilesOfRect(
  g: TerrainGrid,
  o: TileOrder,
  r: { x0: number; z0: number; w: number; h: number },
): Array<[number, number]> {
  const keys = new Set<string>();
  // Placements change only at tile boundaries: sampling every sample is simple and bounded by the
  // caller's window cap.
  for (let gz = r.z0; gz < r.z0 + r.h; gz++) {
    for (let gx = r.x0; gx < r.x0 + r.w; gx++) {
      for (const p of placements(g, o, gx, gz)) keys.add(tileKey(p.tileX, p.tileY));
    }
  }
  return [...keys].map(parseTileKey).sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]));
}

/** Fills a window from whole tile arrays (side * side each). Throws when a tile is missing. */
export function windowFromTiles(
  g: TerrainGrid,
  o: TileOrder,
  r: { x0: number; z0: number; w: number; h: number },
  tiles: ReadonlyMap<string, ArrayLike<number>>,
): HeightWindow {
  const data = new Float64Array(r.w * r.h);
  for (let gz = r.z0; gz < r.z0 + r.h; gz++) {
    for (let gx = r.x0; gx < r.x0 + r.w; gx++) {
      const p = placements(g, o, gx, gz)[0];
      const tile = tiles.get(tileKey(p.tileX, p.tileY));
      if (!tile || tile.length !== g.side * g.side) {
        throw new BrushError(`tile ${p.tileX},${p.tileY} was not read whole`);
      }
      data[(gz - r.z0) * r.w + (gx - r.x0)] = tile[p.index];
    }
  }
  return { ...r, data };
}

// ── Brush ────────────────────────────────────────────────────────────────────

export const BRUSH_MODES = ["sculpt", "flatten", "smooth", "noise"] as const;
export type BrushMode = (typeof BRUSH_MODES)[number];
export const FALLOFFS = ["linear", "smooth", "none"] as const;
export type Falloff = (typeof FALLOFFS)[number];

export const BRUSH_DEFAULTS = {
  strength: 0.5,
  falloff: "smooth" as Falloff,
  passes: 1,
  scale: 32,
  seed: 0,
};
export const PASSES_MAX = 8;

export interface BrushParams {
  mode: BrushMode;
  centreX: number;
  centreZ: number;
  /** Metres; samples at this distance or further are never changed. */
  radius: number;
  /** 0..1. */
  strength: number;
  falloff: Falloff;
  /** sculpt: signed metres; noise: amplitude in metres. */
  delta?: number;
  /** flatten: the target height; default the sample nearest the centre. */
  height?: number;
  /** smooth: 1..PASSES_MAX. */
  passes?: number;
  /** noise: metres per noise period. */
  scale?: number;
  /** noise: the seed. */
  seed?: number;
}

/** Checks brush parameters; throws BrushError with the reason. */
export function checkBrush(p: BrushParams): void {
  if (!BRUSH_MODES.includes(p.mode)) throw new BrushError(`mode must be one of ${BRUSH_MODES}`);
  if (!Number.isFinite(p.centreX) || !Number.isFinite(p.centreZ)) {
    throw new BrushError("centre must be finite");
  }
  if (!(Number.isFinite(p.radius) && p.radius > 0)) throw new BrushError("radius must be > 0");
  if (!(Number.isFinite(p.strength) && p.strength >= 0 && p.strength <= 1)) {
    throw new BrushError("strength must be 0..1");
  }
  if (!FALLOFFS.includes(p.falloff)) throw new BrushError(`falloff must be one of ${FALLOFFS}`);
  if (p.mode === "sculpt" && !(p.delta !== undefined && Number.isFinite(p.delta))) {
    throw new BrushError("sculpt needs delta (signed metres)");
  }
  if (p.mode === "noise" && !(p.delta !== undefined && Number.isFinite(p.delta) && p.delta > 0)) {
    throw new BrushError("noise needs delta (the amplitude, metres > 0)");
  }
  if (p.mode === "noise" && p.scale !== undefined && !(Number.isFinite(p.scale) && p.scale > 0)) {
    throw new BrushError("scale must be > 0 metres");
  }
  if (p.mode === "noise" && p.seed !== undefined && !Number.isInteger(p.seed)) {
    throw new BrushError("seed must be an integer");
  }
  if (
    p.mode === "smooth" &&
    p.passes !== undefined &&
    !(Number.isInteger(p.passes) && p.passes >= 1 && p.passes <= PASSES_MAX)
  ) {
    throw new BrushError(`passes must be 1..${PASSES_MAX}`);
  }
  if (p.mode === "flatten" && p.height !== undefined && !Number.isFinite(p.height)) {
    throw new BrushError("height must be finite");
  }
}

/** The falloff at relative distance t (0 at the centre, 1 at the radius): 1 down to 0. */
export function falloffAt(t: number, falloff: Falloff): number {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  if (falloff === "none") return 1;
  if (falloff === "linear") return 1 - t;
  return 1 - t * t * (3 - 2 * t);
}

/** The brush weight at distance d: strength times the falloff, 0 at the radius and beyond. */
export function brushWeight(d: number, p: Pick<BrushParams, "radius" | "strength" | "falloff">) {
  if (!(d < p.radius)) return 0;
  return p.strength * falloffAt(d / p.radius, p.falloff);
}

/** A lattice value in [-1, 1] from integer coordinates and a seed (integer hash). */
export function latticeValue(ix: number, iz: number, seed: number): number {
  let h =
    Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Smooth value noise in [-1, 1]: bilinear between lattice values with a smoothstep fade. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = latticeValue(ix, iz, seed);
  const b = latticeValue(ix + 1, iz, seed);
  const c = latticeValue(ix, iz + 1, seed);
  const d = latticeValue(ix + 1, iz + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

/** The height of the window sample nearest a world point (flatten's default target). */
export function heightNear(g: TerrainGrid, win: HeightWindow, x: number, z: number): number {
  const gx = Math.round((x - g.originX) / g.unitScale);
  const gz = Math.round((z - g.originZ) / g.unitScale);
  const cx = Math.min(win.x0 + win.w - 1, Math.max(win.x0, gx));
  const cz = Math.min(win.z0 + win.h - 1, Math.max(win.z0, gz));
  return win.data[(cz - win.z0) * win.w + (cx - win.x0)];
}

/**
 * Applies a brush to a window and answers the new heights (a copy). A sample whose weight is 0
 * (at or beyond the radius) keeps its exact value. smooth changes a sample only when its whole
 * 3 x 3 neighbourhood lies in the window, so a terrain edge is left as it is.
 */
export function applyBrush(g: TerrainGrid, win: HeightWindow, p: BrushParams): Float64Array {
  checkGrid(g);
  checkBrush(p);
  const { w, h } = win;
  const weights = new Float64Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [x, z] = worldOf(g, win.x0 + i, win.z0 + j);
      weights[j * w + i] = brushWeight(Math.hypot(x - p.centreX, z - p.centreZ), p);
    }
  }
  const out = Float64Array.from(win.data);
  if (p.mode === "sculpt") {
    const delta = p.delta ?? 0;
    for (let k = 0; k < out.length; k++)
      if (weights[k] > 0) out[k] = win.data[k] + delta * weights[k];
  } else if (p.mode === "flatten") {
    const target = p.height ?? heightNear(g, win, p.centreX, p.centreZ);
    for (let k = 0; k < out.length; k++) {
      if (weights[k] > 0) out[k] = win.data[k] + (target - win.data[k]) * weights[k];
    }
  } else if (p.mode === "noise") {
    const amp = p.delta ?? 0;
    const scale = p.scale ?? BRUSH_DEFAULTS.scale;
    const seed = p.seed ?? BRUSH_DEFAULTS.seed;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (!(weights[k] > 0)) continue;
        const [x, z] = worldOf(g, win.x0 + i, win.z0 + j);
        out[k] = win.data[k] + amp * weights[k] * valueNoise(x / scale, z / scale, seed);
      }
    }
  } else {
    const passes = p.passes ?? BRUSH_DEFAULTS.passes;
    for (let pass = 0; pass < passes; pass++) {
      const src = Float64Array.from(out);
      for (let j = 1; j < h - 1; j++) {
        for (let i = 1; i < w - 1; i++) {
          const k = j * w + i;
          if (!(weights[k] > 0)) continue;
          let sum = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) sum += src[k + dj * w + di];
          }
          const mean = sum / 9;
          out[k] = src[k] + (mean - src[k]) * weights[k];
        }
      }
    }
  }
  return out;
}

// ── Patch codec ──────────────────────────────────────────────────────────────

/** Height runs per tileWrite call (the handler's MAX_PATCHES; P-W7-04 may lower it). */
export const MAX_PATCHES_PER_CALL = 64;
/** Decimals of a height on the wire: 0.1 mm, inside P-W7-16's 1 mm. */
export const HEIGHT_DECIMALS = 4;
/** The handler refuses a height outside +-this (EMCP_WB_TerrainEdit.MAX_ABS_HEIGHT). */
export const MAX_ABS_HEIGHT = 10000;

/** One run of heights along a tile array row: `"tx ty row col|v v ..."` on the wire. */
export interface TilePatch {
  tileX: number;
  tileY: number;
  row: number;
  col: number;
  values: number[];
}

/** A height as wire text: fixed decimals, trailing zeros trimmed, never "-0", never an exponent. */
export function formatHeight(v: number, decimals = HEIGHT_DECIMALS): string {
  if (!Number.isFinite(v)) throw new BrushError(`height ${v} is not finite`);
  let s = v.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

export function formatPatch(p: TilePatch): string {
  return `${p.tileX} ${p.tileY} ${p.row} ${p.col}|${p.values.map((v) => formatHeight(v)).join(" ")}`;
}

export function formatPatches(ps: readonly TilePatch[]): string[] {
  return ps.map(formatPatch);
}

const UINT = /^\d{1,9}$/;
const FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parses one `"tx ty row col|v v ..."`; throws BrushError. */
export function parsePatch(text: string): TilePatch {
  const bar = text.indexOf("|");
  if (bar <= 0 || bar >= text.length - 1) {
    throw new BrushError(`a patch is "tx ty row col|v v ...", got '${text}'`);
  }
  const head = text
    .slice(0, bar)
    .split(" ")
    .filter((s) => s !== "");
  if (head.length !== 4 || head.some((s) => !UINT.test(s))) {
    throw new BrushError(
      `a patch starts with four non-negative integers, got '${text.slice(0, bar)}'`,
    );
  }
  const body = text
    .slice(bar + 1)
    .split(" ")
    .filter((s) => s !== "");
  if (body.length === 0) throw new BrushError(`a patch holds at least one height: '${text}'`);
  const values = body.map((s, i) => {
    if (!FLOAT.test(s)) throw new BrushError(`height ${i} ('${s}') is not a number`);
    const v = Number(s);
    if (Math.abs(v) > MAX_ABS_HEIGHT) {
      throw new BrushError(`height ${i} (${s}) is outside +-${MAX_ABS_HEIGHT} m`);
    }
    return v;
  });
  const [tileX, tileY, row, col] = head.map(Number);
  return { tileX, tileY, row, col, values };
}

export function parsePatches(texts: readonly string[]): TilePatch[] {
  return texts.map(parsePatch);
}

/** Splits patches into calls of at most `max` runs each, in order. */
export function chunkPatches(ps: readonly TilePatch[], max = MAX_PATCHES_PER_CALL): TilePatch[][] {
  if (!(Number.isInteger(max) && max >= 1)) throw new BrushError("max must be a positive integer");
  const out: TilePatch[][] = [];
  for (let i = 0; i < ps.length; i += max) out.push(ps.slice(i, i + max));
  return out;
}

/** Checks each run against the grid (tile in range, run inside one array row); throws BrushError. */
export function checkPatchesFit(
  ps: readonly TilePatch[],
  g: Pick<TerrainGrid, "tilesX" | "tilesY" | "side">,
): void {
  ps.forEach((p, i) => {
    if (p.tileX >= g.tilesX || p.tileY >= g.tilesY) {
      throw new BrushError(
        `patches[${i}]: tile ${p.tileX},${p.tileY} is outside the ${g.tilesX}x${g.tilesY} tiles`,
      );
    }
    if (p.row >= g.side || p.col + p.values.length > g.side) {
      throw new BrushError(
        `patches[${i}]: row ${p.row}, col ${p.col} and ${p.values.length} heights do not fit a row of ${g.side}`,
      );
    }
  });
}

/**
 * The runs that turn `before` into `after` over a window: every sample whose wire text changes,
 * written to every tile copy, grouped into runs along each tile array row. A sample whose text
 * does not change is not written. Values are rounded to the wire's decimals. Sorted by tile (y,
 * then x), row, col.
 */
export function diffToPatches(
  g: TerrainGrid,
  o: TileOrder,
  win: Pick<HeightWindow, "x0" | "z0" | "w" | "h">,
  before: ArrayLike<number>,
  after: ArrayLike<number>,
): TilePatch[] {
  const perTile = new Map<string, Map<number, number>>();
  for (let j = 0; j < win.h; j++) {
    for (let i = 0; i < win.w; i++) {
      const k = j * win.w + i;
      const next = formatHeight(after[k]);
      if (next === formatHeight(before[k])) continue;
      const value = Number(next);
      for (const p of placements(g, o, win.x0 + i, win.z0 + j)) {
        const key = tileKey(p.tileX, p.tileY);
        let slots = perTile.get(key);
        if (!slots) perTile.set(key, (slots = new Map()));
        slots.set(p.index, value);
      }
    }
  }
  const keys = [...perTile.keys()]
    .map(parseTileKey)
    .sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]));
  const out: TilePatch[] = [];
  for (const [tx, ty] of keys) {
    const slots = perTile.get(tileKey(tx, ty))!;
    const indices = [...slots.keys()].sort((a, b) => a - b);
    let run: TilePatch | undefined;
    let last = -2;
    for (const idx of indices) {
      const row = Math.floor(idx / g.side);
      const col = idx % g.side;
      if (run && idx === last + 1 && row === run.row) {
        run.values.push(slots.get(idx)!);
      } else {
        run = { tileX: tx, tileY: ty, row, col, values: [slots.get(idx)!] };
        out.push(run);
      }
      last = idx;
    }
  }
  return out;
}

// ── Tiles and the estimate ───────────────────────────────────────────────────

/** Parses tileRead rows `"r|v v v ..."` into a sparse map row -> heights. Throws BrushError. */
export function parseTileRows(rows: readonly string[], side: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const line of rows) {
    const bar = line.indexOf("|");
    const r = bar > 0 ? line.slice(0, bar) : "";
    if (!UINT.test(r))
      throw new BrushError(`a tile row is "r|v v ...", got '${line.slice(0, 40)}'`);
    const cells = line
      .slice(bar + 1)
      .split(" ")
      .filter((s) => s !== "");
    if (cells.length !== side || cells.some((s) => !FLOAT.test(s))) {
      throw new BrushError(`tile row ${r} holds ${cells.length} numbers, ${side} expected`);
    }
    out.set(Number(r), cells.map(Number));
  }
  return out;
}

/** Applies runs to whole tiles; answers copies of the touched tiles (a later run wins). */
export function applyPatches(
  tiles: ReadonlyMap<string, ArrayLike<number>>,
  side: number,
  patches: readonly TilePatch[],
): Map<string, Float64Array> {
  const out = new Map<string, Float64Array>();
  for (const p of patches) {
    const key = tileKey(p.tileX, p.tileY);
    let t = out.get(key);
    if (!t) {
      const src = tiles.get(key);
      if (!src || src.length !== side * side) {
        throw new BrushError(`tile ${key} was not read whole`);
      }
      out.set(key, (t = Float64Array.from(src)));
    }
    const start = p.row * side + p.col;
    p.values.forEach((v, k) => {
      t[start + k] = v;
    });
  }
  return out;
}

export interface Estimate {
  /** Distinct tiles a run touches. */
  tiles: number;
  /** Touched samples whose height changes. */
  samples: number;
  minDelta: number;
  maxDelta: number;
  meanDelta: number;
}

/** The estimate of the handler's dry run: tiles touched, samples changed and their deltas. */
export function estimatePatches(
  tiles: ReadonlyMap<string, ArrayLike<number>>,
  side: number,
  patches: readonly TilePatch[],
): Estimate {
  const after = applyPatches(tiles, side, patches);
  const touched = new Map<string, Set<number>>();
  for (const p of patches) {
    const key = tileKey(p.tileX, p.tileY);
    let s = touched.get(key);
    if (!s) touched.set(key, (s = new Set()));
    for (let k = 0; k < p.values.length; k++) s.add(p.row * side + p.col + k);
  }
  let samples = 0;
  let min = 0;
  let max = 0;
  let sum = 0;
  for (const [key, idx] of touched) {
    const orig = tiles.get(key)!;
    const now = after.get(key)!;
    for (const i of idx) {
      const d = now[i] - orig[i];
      if (d === 0) continue;
      if (samples === 0 || d < min) min = d;
      if (samples === 0 || d > max) max = d;
      sum += d;
      samples++;
    }
  }
  return {
    tiles: touched.size,
    samples,
    minDelta: min,
    maxDelta: max,
    meanDelta: samples > 0 ? sum / samples : 0,
  };
}
