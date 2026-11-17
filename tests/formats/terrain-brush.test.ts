/**
 * Corpus proofs of src/formats/terrain-brush.ts (phase5-w7-spec.md section 4): brush maths, the
 * patch codec and the estimate, on tiles generated at test time (the game paks hold no terrain
 * small enough to be a fixture). Every order is passed explicitly: TILE_ORDER stays unset until
 * P-W7-01 (DEC-075 OD-3).
 */
import { describe, expect, it } from "vitest";
import {
  BrushError,
  MAX_PATCHES_PER_CALL,
  TILE_ORDER,
  applyBrush,
  applyPatches,
  brushRect,
  brushWeight,
  checkPatchesFit,
  chunkPatches,
  diffToPatches,
  estimatePatches,
  falloffAt,
  formatHeight,
  formatPatches,
  globalOf,
  layoutOfSamples,
  parsePatch,
  parsePatches,
  parseTileRows,
  placements,
  samplesX,
  samplesZ,
  tileKey,
  tileLayouts,
  tilesOfRect,
  valueNoise,
  windowFromTiles,
  worldOf,
  type BrushParams,
  type HeightWindow,
  type TerrainGrid,
  type TileOrder,
  type TilePatch,
} from "../../src/formats/terrain-brush.js";

const ORDERS: TileOrder[] = [
  { order: "xMajor", flipZ: false },
  { order: "xMajor", flipZ: true },
  { order: "zMajor", flipZ: false },
  { order: "zMajor", flipZ: true },
];

/** A deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Surface = "flat" | "slope" | "cone" | "random";

function heightAt(kind: Surface, x: number, z: number, r: () => number): number {
  switch (kind) {
    case "flat":
      return 12.5;
    case "slope":
      return 3 + 0.25 * x - 0.125 * z;
    case "cone":
      return 50 - Math.hypot(x - 32, z - 32);
    case "random":
      return Math.round((r() * 40 - 10) * 10000) / 10000;
  }
}

function grid(side: number, tiles = 2, unitScale = 1): TerrainGrid {
  return { tilesX: tiles, tilesY: tiles, side, unitScale, originX: 0, originZ: 0 };
}

/** The whole terrain as one window, values at 4 decimals. */
function wholeWindow(g: TerrainGrid, kind: Surface, seed = 1): HeightWindow {
  const w = samplesX(g);
  const h = samplesZ(g);
  const r = rng(seed);
  const data = new Float64Array(w * h);
  for (let gz = 0; gz < h; gz++) {
    for (let gx = 0; gx < w; gx++) {
      const [x, z] = worldOf(g, gx, gz);
      data[gz * w + gx] = Number(formatHeight(heightAt(kind, x, z, r)));
    }
  }
  return { x0: 0, z0: 0, w, h, data };
}

/** Whole tiles holding a window that covers the terrain. */
function tilesOf(g: TerrainGrid, o: TileOrder, win: HeightWindow): Map<string, Float64Array> {
  const tiles = new Map<string, Float64Array>();
  for (let ty = 0; ty < g.tilesY; ty++) {
    for (let tx = 0; tx < g.tilesX; tx++) {
      const t = new Float64Array(g.side * g.side);
      for (let i = 0; i < t.length; i++) {
        const [gx, gz] = globalOf(g, o, tx, ty, i);
        t[i] = win.data[gz * win.w + gx];
      }
      tiles.set(tileKey(tx, ty), t);
    }
  }
  return tiles;
}

function dist(g: TerrainGrid, win: HeightWindow, k: number, p: BrushParams): number {
  const [x, z] = worldOf(g, win.x0 + (k % win.w), win.z0 + Math.floor(k / win.w));
  return Math.hypot(x - p.centreX, z - p.centreZ);
}

function variance(xs: number[]): number {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length;
}

const SIDES = [33, 65];
const SURFACES: Surface[] = ["flat", "slope", "cone", "random"];

describe("terrain-brush: order and grid", () => {
  it("TILE_ORDER stays unset until P-W7-01 records it", () => {
    expect(TILE_ORDER).toBeUndefined();
  });

  it("placements and globalOf are inverse for every order, with and without shared edges", () => {
    for (const sharedEdges of [false, true]) {
      const g = { ...grid(9, 3), sharedEdges };
      for (const o of ORDERS) {
        for (let ty = 0; ty < g.tilesY; ty++) {
          for (let tx = 0; tx < g.tilesX; tx++) {
            for (let i = 0; i < g.side * g.side; i++) {
              const [gx, gz] = globalOf(g, o, tx, ty, i);
              const ps = placements(g, o, gx, gz);
              expect(ps).toContainEqual({ tileX: tx, tileY: ty, index: i });
            }
          }
        }
      }
    }
  });

  it("a shared edge sample sits in two tiles, a shared corner in four", () => {
    const g = { ...grid(9, 2), sharedEdges: true };
    const o = ORDERS[0];
    expect(samplesX(g)).toBe(17);
    expect(placements(g, o, 8, 3)).toHaveLength(2);
    expect(placements(g, o, 8, 8)).toHaveLength(4);
    expect(placements(g, o, 3, 3)).toHaveLength(1);
  });

  it("xMajor puts x along a row, zMajor puts z along a row, flipZ mirrors z", () => {
    const g = grid(4, 2);
    expect(placements(g, { order: "xMajor", flipZ: false }, 1, 2)).toEqual([
      { tileX: 0, tileY: 0, index: 2 * 4 + 1 },
    ]);
    expect(placements(g, { order: "zMajor", flipZ: false }, 1, 2)).toEqual([
      { tileX: 0, tileY: 0, index: 1 * 4 + 2 },
    ]);
    // flipZ: gz 2 of 8 becomes 5, tile 1, local 1.
    expect(placements(g, { order: "xMajor", flipZ: true }, 1, 2)).toEqual([
      { tileX: 0, tileY: 1, index: 1 * 4 + 1 },
    ]);
  });

  it("brushRect clips to the terrain and refuses a brush that misses it", () => {
    const g = grid(33);
    expect(brushRect(g, 10, 10, 3, 1)).toEqual({ x0: 6, z0: 6, w: 9, h: 9 });
    expect(brushRect(g, 0, 0, 2, 1)).toEqual({ x0: 0, z0: 0, w: 4, h: 4 });
    expect(() => brushRect(g, -50, -50, 2, 1)).toThrow(BrushError);
  });

  it("tilesOfRect lists each tile under the rectangle once, sorted", () => {
    const g = grid(33);
    expect(tilesOfRect(g, ORDERS[0], { x0: 30, z0: 2, w: 6, h: 3 })).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(tilesOfRect(g, ORDERS[1], { x0: 30, z0: 2, w: 6, h: 3 })).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});

describe("terrain-brush: maths on generated tiles", () => {
  for (const side of SIDES) {
    for (const kind of SURFACES) {
      const g = grid(side);
      const win = wholeWindow(g, kind, side);
      const centre = samplesX(g) / 2;

      it(`sculpt adds delta x weight and leaves outside bit-identical (${kind}, side ${side})`, () => {
        for (const falloff of ["linear", "smooth", "none"] as const) {
          const p: BrushParams = {
            mode: "sculpt",
            centreX: centre,
            centreZ: centre - 3,
            radius: side / 3,
            strength: 0.7,
            falloff,
            delta: -2.5,
          };
          const out = applyBrush(g, win, p);
          for (let k = 0; k < out.length; k++) {
            const d = dist(g, win, k, p);
            if (d >= p.radius) expect(Object.is(out[k], win.data[k])).toBe(true);
            else expect(out[k]).toBeCloseTo(win.data[k] + p.delta! * brushWeight(d, p), 12);
          }
        }
      });

      it(`flatten lands between the original and the target (${kind}, side ${side})`, () => {
        const p: BrushParams = {
          mode: "flatten",
          centreX: centre,
          centreZ: centre,
          radius: side / 4,
          strength: 1,
          falloff: "smooth",
          height: 7,
        };
        const out = applyBrush(g, win, p);
        for (let k = 0; k < out.length; k++) {
          const lo = Math.min(win.data[k], 7) - 1e-9;
          const hi = Math.max(win.data[k], 7) + 1e-9;
          expect(out[k]).toBeGreaterThanOrEqual(lo);
          expect(out[k]).toBeLessThanOrEqual(hi);
          if (dist(g, win, k, p) >= p.radius) expect(Object.is(out[k], win.data[k])).toBe(true);
        }
        // Default target: the sample nearest the centre, which stays put.
        const q = { ...p, height: undefined };
        const near = Math.round(centre) * win.w + Math.round(centre);
        expect(applyBrush(g, win, q)[near]).toBeCloseTo(win.data[near], 12);
      });

      it(`noise is deterministic per seed, bounded and zero at the radius (${kind}, side ${side})`, () => {
        const p: BrushParams = {
          mode: "noise",
          centreX: centre,
          centreZ: centre,
          radius: side / 3,
          strength: 1,
          falloff: "none",
          delta: 1.5,
          scale: 4,
          seed: 7,
        };
        const a = applyBrush(g, win, p);
        const b = applyBrush(g, win, p);
        const c = applyBrush(g, win, { ...p, seed: 8 });
        expect(Array.from(a)).toEqual(Array.from(b));
        expect(Array.from(a)).not.toEqual(Array.from(c));
        for (let k = 0; k < a.length; k++) {
          expect(Math.abs(a[k] - win.data[k])).toBeLessThanOrEqual(1.5 + 1e-12);
          if (dist(g, win, k, p) >= p.radius) expect(Object.is(a[k], win.data[k])).toBe(true);
        }
      });
    }

    it(`smooth leaves a plane unchanged (no run to write), side ${side}`, () => {
      const g = grid(side);
      for (const kind of ["flat", "slope"] as const) {
        const win = wholeWindow(g, kind);
        const p: BrushParams = {
          mode: "smooth",
          centreX: side,
          centreZ: side,
          radius: side / 2,
          strength: 1,
          falloff: "linear",
          passes: 3,
        };
        const out = applyBrush(g, win, p);
        for (let k = 0; k < out.length; k++) expect(out[k]).toBeCloseTo(win.data[k], 9);
        expect(diffToPatches(g, ORDERS[0], win, win.data, out)).toEqual([]);
      }
    });

    it(`smooth lowers the variance of a random surface, side ${side}`, () => {
      const g = grid(side);
      const win = wholeWindow(g, "random", 99);
      const p: BrushParams = {
        mode: "smooth",
        centreX: side,
        centreZ: side,
        radius: side / 2,
        strength: 1,
        falloff: "none",
        passes: 2,
      };
      const out = applyBrush(g, win, p);
      const inside: number[] = [];
      const before: number[] = [];
      for (let k = 0; k < out.length; k++) {
        if (dist(g, win, k, p) < p.radius - 2) {
          inside.push(out[k]);
          before.push(win.data[k]);
        }
      }
      expect(variance(inside)).toBeLessThan(variance(before));
    });
  }

  it("falloff runs from 1 at the centre to 0 at the radius", () => {
    for (const f of ["linear", "smooth", "none"] as const) {
      expect(falloffAt(0, f)).toBe(1);
      expect(falloffAt(1, f)).toBe(0);
      expect(falloffAt(1.5, f)).toBe(0);
    }
    expect(falloffAt(0.5, "linear")).toBe(0.5);
    expect(falloffAt(0.5, "smooth")).toBe(0.5);
    expect(falloffAt(0.5, "none")).toBe(1);
  });

  it("value noise stays within [-1, 1]", () => {
    for (let i = 0; i < 2000; i++) {
      const v = valueNoise(i * 0.37 - 100, i * 0.11 + 5, i % 5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it("checkBrush refuses bad parameters", () => {
    const g = grid(33);
    const win = wholeWindow(g, "flat");
    const base: BrushParams = {
      mode: "sculpt",
      centreX: 5,
      centreZ: 5,
      radius: 3,
      strength: 0.5,
      falloff: "smooth",
      delta: 1,
    };
    expect(() => applyBrush(g, win, { ...base, radius: 0 })).toThrow(BrushError);
    expect(() => applyBrush(g, win, { ...base, strength: 1.5 })).toThrow(BrushError);
    expect(() => applyBrush(g, win, { ...base, delta: undefined })).toThrow(/sculpt needs delta/);
    expect(() => applyBrush(g, win, { ...base, mode: "noise", delta: 0 })).toThrow(/noise needs/);
    expect(() => applyBrush(g, win, { ...base, mode: "smooth", passes: 9 })).toThrow(/passes/);
  });
});

describe("terrain-brush: patch codec", () => {
  it("parsePatches(formatPatches(p)) is deep-equal", () => {
    const r = rng(5);
    const ps: TilePatch[] = [];
    for (let i = 0; i < 40; i++) {
      const len = 1 + Math.floor(r() * 30);
      ps.push({
        tileX: Math.floor(r() * 4),
        tileY: Math.floor(r() * 4),
        row: Math.floor(r() * 65),
        col: Math.floor(r() * 30),
        values: Array.from({ length: len }, () => Number(formatHeight(r() * 2000 - 1000))),
      });
    }
    expect(parsePatches(formatPatches(ps))).toEqual(ps);
  });

  it("height text round trips within 1 mm and never shows -0 or an exponent", () => {
    const r = rng(11);
    for (let i = 0; i < 5000; i++) {
      const v = (r() - 0.5) * 2000;
      const s = formatHeight(v);
      expect(s).not.toMatch(/e/i);
      expect(Math.abs(Number(s) - v)).toBeLessThanOrEqual(0.00005 + 1e-9);
    }
    expect(formatHeight(-0.00001)).toBe("0");
    expect(formatHeight(1e-7)).toBe("0");
    expect(formatHeight(12)).toBe("12");
    expect(formatHeight(-3.25)).toBe("-3.25");
  });

  it("parsePatch refuses malformed runs", () => {
    expect(() => parsePatch("1 2 3|4")).toThrow(BrushError);
    expect(() => parsePatch("1 2 3 4|")).toThrow(BrushError);
    expect(() => parsePatch("1 -2 3 4|5")).toThrow(BrushError);
    expect(() => parsePatch("1 2 3 4|abc")).toThrow(BrushError);
    expect(() => parsePatch("1 2 3 4|10001")).toThrow(/outside/);
    expect(parsePatch("1 2 3 4|5 -6.5  7")).toEqual({
      tileX: 1,
      tileY: 2,
      row: 3,
      col: 4,
      values: [5, -6.5, 7],
    });
  });

  it("runs split at tile edges and rows, every order", () => {
    const g = grid(33);
    for (const o of ORDERS) {
      const win = wholeWindow(g, "slope");
      const p: BrushParams = {
        mode: "sculpt",
        centreX: 33,
        centreZ: 33,
        radius: 10,
        strength: 1,
        falloff: "none",
        delta: 1,
      };
      const rect = brushRect(g, p.centreX, p.centreZ, p.radius, 1);
      const tiles = tilesOf(g, o, win);
      const sub = windowFromTiles(g, o, rect, tiles);
      const out = applyBrush(g, sub, p);
      const patches = diffToPatches(g, o, rect, sub.data, out);
      expect(new Set(patches.map((q) => tileKey(q.tileX, q.tileY))).size).toBe(4);
      expect(() => checkPatchesFit(patches, g)).not.toThrow();
      for (const q of patches) expect(q.col + q.values.length).toBeLessThanOrEqual(g.side);
      // Applying the runs to the tiles gives the brushed window back.
      const after = applyPatches(tiles, g.side, patches);
      const merged = new Map(tiles);
      for (const [k, v] of after) merged.set(k, v);
      const back = windowFromTiles(g, o, rect, merged);
      for (let k = 0; k < out.length; k++) expect(back.data[k]).toBe(Number(formatHeight(out[k])));
    }
  });

  it("shared edges: both copies of an edge sample are written", () => {
    const g = { ...grid(9, 2), sharedEdges: true };
    const o = ORDERS[0];
    const win = wholeWindow(g, "flat");
    const after = Float64Array.from(win.data);
    after[3 * win.w + 8] = 99; // gx 8 is the shared column
    const patches = diffToPatches(g, o, win, win.data, after);
    expect(patches).toEqual([
      { tileX: 0, tileY: 0, row: 3, col: 8, values: [99] },
      { tileX: 1, tileY: 0, row: 3, col: 0, values: [99] },
    ]);
  });

  it(`chunkPatches keeps at most ${MAX_PATCHES_PER_CALL} runs per call, in order`, () => {
    const ps: TilePatch[] = Array.from({ length: 150 }, (_, i) => ({
      tileX: 0,
      tileY: 0,
      row: i % 33,
      col: 0,
      values: [i],
    }));
    const calls = chunkPatches(ps);
    expect(calls.map((c) => c.length)).toEqual([64, 64, 22]);
    expect(calls.flat()).toEqual(ps);
    expect(chunkPatches(ps, 10)).toHaveLength(15);
    expect(() => chunkPatches(ps, 0)).toThrow(BrushError);
  });

  it("checkPatchesFit refuses a tile outside the grid or a run past the row", () => {
    const g = grid(9);
    expect(() => checkPatchesFit([{ tileX: 2, tileY: 0, row: 0, col: 0, values: [1] }], g)).toThrow(
      /outside/,
    );
    expect(() =>
      checkPatchesFit([{ tileX: 0, tileY: 0, row: 0, col: 8, values: [1, 2] }], g),
    ).toThrow(/do not fit/);
  });
});

describe("terrain-brush: tiles and the estimate", () => {
  it("the estimate equals a brute-force diff", () => {
    for (const side of SIDES) {
      const g = grid(side);
      const o = ORDERS[2];
      const win = wholeWindow(g, "random", side + 3);
      const tiles = tilesOf(g, o, win);
      const r = rng(side);
      const patches: TilePatch[] = [];
      for (let i = 0; i < 64; i++) {
        const col = Math.floor(r() * (side - 5));
        patches.push({
          tileX: Math.floor(r() * 2),
          tileY: Math.floor(r() * 2),
          row: Math.floor(r() * side),
          col,
          values: Array.from({ length: 1 + Math.floor(r() * 5) }, () =>
            r() < 0.2 ? NaN : Number(formatHeight(r() * 30)),
          ),
        });
      }
      // NaN marks "same as before": write the tile's own value there.
      for (const p of patches) {
        const t = tiles.get(tileKey(p.tileX, p.tileY))!;
        p.values = p.values.map((v, k) => (Number.isNaN(v) ? t[p.row * side + p.col + k] : v));
      }
      const est = estimatePatches(tiles, side, patches);
      // Brute force: the last write wins; compare every touched slot.
      const after = new Map<string, Float64Array>();
      const touched = new Map<string, Set<number>>();
      for (const p of patches) {
        const key = tileKey(p.tileX, p.tileY);
        if (!after.has(key)) after.set(key, Float64Array.from(tiles.get(key)!));
        if (!touched.has(key)) touched.set(key, new Set());
        p.values.forEach((v, k) => {
          after.get(key)![p.row * side + p.col + k] = v;
          touched.get(key)!.add(p.row * side + p.col + k);
        });
      }
      const deltas: number[] = [];
      for (const [key, idx] of touched) {
        for (const i of idx) {
          const d = after.get(key)![i] - tiles.get(key)![i];
          if (d !== 0) deltas.push(d);
        }
      }
      expect(est.tiles).toBe(touched.size);
      expect(est.samples).toBe(deltas.length);
      expect(est.minDelta).toBe(Math.min(...deltas));
      expect(est.maxDelta).toBe(Math.max(...deltas));
      expect(est.meanDelta).toBeCloseTo(deltas.reduce((s, d) => s + d, 0) / deltas.length, 12);
    }
  });

  it("an empty diff estimates zero", () => {
    const g = grid(9);
    const tiles = tilesOf(g, ORDERS[0], wholeWindow(g, "flat"));
    expect(estimatePatches(tiles, 9, [])).toEqual({
      tiles: 0,
      samples: 0,
      minDelta: 0,
      maxDelta: 0,
      meanDelta: 0,
    });
  });

  it("parseTileRows reads tileRead rows and refuses a short row", () => {
    const rows = parseTileRows(["0|1 2 3", "2|4.5 -1 0.25"], 3);
    expect(rows.get(0)).toEqual([1, 2, 3]);
    expect(rows.get(2)).toEqual([4.5, -1, 0.25]);
    expect(() => parseTileRows(["0|1 2"], 3)).toThrow(BrushError);
    expect(() => parseTileRows(["x|1 2 3"], 3)).toThrow(BrushError);
  });

  it("windowFromTiles refuses a tile that was not read", () => {
    const g = grid(9);
    expect(() => windowFromTiles(g, ORDERS[0], { x0: 0, z0: 0, w: 2, h: 2 }, new Map())).toThrow(
      /not read whole/,
    );
  });
});

describe("fix-up 1: tile layouts", () => {
  it("EmptyArland: 2049 in 16 tiles is sharedEdge of 129, and 16641 samples confirm it", () => {
    const c = tileLayouts(2049, 2049, 16, 16);
    expect(c).toEqual({ disjoint: 0, shared: 129 });
    expect(layoutOfSamples(c, 16641)).toEqual({ side: 129, layout: "sharedEdge" });
    expect(layoutOfSamples(c, 128 * 128)).toBeNull();
  });

  it("2048 in 16 tiles is disjoint of 128; one tile per axis is single", () => {
    const c = tileLayouts(2048, 2048, 16, 16);
    expect(c).toEqual({ disjoint: 128, shared: 0 });
    expect(layoutOfSamples(c, 128 * 128)).toEqual({ side: 128, layout: "disjoint" });
    const one = tileLayouts(129, 129, 1, 1);
    expect(one).toEqual({ disjoint: 129, shared: 129 });
    expect(layoutOfSamples(one, 129 * 129)).toEqual({ side: 129, layout: "single" });
  });

  it("no square layout, unequal axes or bad numbers give no candidate", () => {
    expect(tileLayouts(2050, 2050, 16, 16)).toEqual({ disjoint: 0, shared: 0 });
    expect(tileLayouts(2049, 1025, 16, 16)).toEqual({ disjoint: 0, shared: 0 });
    expect(tileLayouts(0, 0, 16, 16)).toEqual({ disjoint: 0, shared: 0 });
    expect(tileLayouts(2049, 2049, 0, 16)).toEqual({ disjoint: 0, shared: 0 });
  });
});
