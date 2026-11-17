/**
 * SCR_ShapeAreaTool's maths (src/formats/shape-area.ts) against the vanilla formulas written out
 * here independently (phase5-w6-spec.md section 4: point counts and radii to 1e-9).
 */
import { describe, expect, it } from "vitest";
import {
  AREA_DEFAULTS,
  areaPointCount,
  areaPoints,
  checkAreaSpec,
  circlePoints,
  rectanglePoints,
  starPoints,
  toWorld,
  type Vec3,
} from "../../src/formats/shape-area.js";

const EPS = 1e-9;
const close = (a: Vec3, b: Vec3) => {
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(EPS);
};
/** x^2/(w/2)^2 + z^2/(l/2)^2: 1 on the ellipse of half-axes w/2, l/2. */
const ellipse = (p: Vec3, w: number, l: number) => (p[0] / (w / 2)) ** 2 + (p[2] / (l / 2)) ** 2;

describe("circle", () => {
  it("gives N points for N from 3 to 200 and 1000, on the ellipse, y 0", () => {
    for (const n of [...Array.from({ length: 198 }, (_, i) => i + 3), 1000]) {
      const pts = circlePoints(48, 32, n);
      expect(pts).toHaveLength(n);
      for (const p of pts) {
        expect(Math.abs(ellipse(p, 48, 32) - 1)).toBeLessThan(EPS);
        expect(p[1]).toBe(0);
      }
    }
  });

  it("matches cos/sin of PI/2 + 2PI - k * 2PI/N times the half sizes", () => {
    const n = 12;
    const pts = circlePoints(48, 32, n);
    pts.forEach((p, k) => {
      const a = Math.PI / 2 + Math.PI * 2 - k * ((Math.PI * 2) / n);
      close(p, [Math.cos(a) * 24, 0, Math.sin(a) * 16]);
    });
  });

  it("starts at the top and goes clockwise (x grows first)", () => {
    const pts = circlePoints(10, 10, 4);
    close(pts[0], [0, 0, 5]);
    close(pts[1], [5, 0, 0]);
    close(pts[2], [0, 0, -5]);
    close(pts[3], [-5, 0, 0]);
  });
});

describe("rectangle", () => {
  it("one segment per side: the four corners TR, BR, BL, TL", () => {
    const pts = rectanglePoints(48, 32, 1);
    expect(pts).toHaveLength(4);
    close(pts[0], [24, 0, 16]);
    close(pts[1], [24, 0, -16]);
    close(pts[2], [-24, 0, -16]);
    close(pts[3], [-24, 0, 16]);
  });

  it("n segments per side: 4n points, each side from its corner by side/n", () => {
    const n = 3;
    const pts = rectanglePoints(48, 32, n);
    expect(pts).toHaveLength(12);
    for (let j = 0; j < n; j++) {
      close(pts[j], [24, 0, 16 - (j * 32) / n]);
      close(pts[n + j], [24 - (j * 48) / n, 0, -16]);
      close(pts[2 * n + j], [-24, 0, -16 + (j * 32) / n]);
      close(pts[3 * n + j], [-24 + (j * 48) / n, 0, 16]);
    }
  });
});

describe("star", () => {
  it("2B points: outer on the ellipse, inner on the ratio ellipse, inner half a step behind", () => {
    for (const [b, r] of [
      [5, 0.5],
      [2, 0.01],
      [7, 1],
      [12, 0.75],
    ] as const) {
      const pts = starPoints(40, 20, b, r);
      expect(pts).toHaveLength(2 * b);
      const step = (Math.PI * 2) / b;
      for (let k = 0; k < b; k++) {
        const a = Math.PI / 2 + Math.PI * 2 - k * step;
        close(pts[2 * k], [Math.cos(a) * 20, 0, Math.sin(a) * 10]);
        const c = a - step / 2;
        close(pts[2 * k + 1], [Math.cos(c) * 20 * r, 0, Math.sin(c) * 10 * r]);
        expect(Math.abs(ellipse(pts[2 * k], 40, 20) - 1)).toBeLessThan(EPS);
        expect(Math.abs(ellipse(pts[2 * k + 1], 40, 20) - r * r)).toBeLessThan(EPS);
      }
    }
  });
});

describe("areaPoints, counts and checks", () => {
  it("uses the vanilla defaults and length = width", () => {
    expect(areaPoints({ shape: "circle", width: 10 })).toHaveLength(AREA_DEFAULTS.circleSegments);
    expect(areaPoints({ shape: "star", width: 10 })).toHaveLength(2 * AREA_DEFAULTS.branches);
    expect(areaPoints({ shape: "rectangle", width: 10 })).toHaveLength(4);
    const c = areaPoints({ shape: "circle", width: 10, segments: 4 });
    close(c[0], [0, 0, 5]);
  });

  it("areaPointCount equals the computed length", () => {
    for (const spec of [
      { shape: "circle" as const, width: 3, segments: 37 },
      { shape: "rectangle" as const, width: 3, segments: 9 },
      { shape: "star" as const, width: 3, branches: 11, innerRatio: 0.3 },
    ]) {
      expect(areaPointCount(spec)).toBe(areaPoints(spec).length);
    }
  });

  it("refuses what the vanilla attributes bound", () => {
    expect(checkAreaSpec({ shape: "circle", width: 10 })).toBeUndefined();
    expect(checkAreaSpec({ shape: "hexagon" as never, width: 10 })).toMatch(/shape/);
    expect(checkAreaSpec({ shape: "circle", width: 0 })).toMatch(/width/);
    expect(checkAreaSpec({ shape: "circle", width: 1, length: -1 })).toMatch(/length/);
    expect(checkAreaSpec({ shape: "circle", width: 1, segments: 2 })).toMatch(/segments/);
    expect(checkAreaSpec({ shape: "rectangle", width: 1, segments: 1 })).toBeUndefined();
    expect(checkAreaSpec({ shape: "rectangle", width: 1, segments: 0 })).toMatch(/segments/);
    expect(checkAreaSpec({ shape: "star", width: 1, branches: 1 })).toMatch(/branches/);
    expect(checkAreaSpec({ shape: "star", width: 1, innerRatio: 0 })).toMatch(/innerRatio/);
    expect(checkAreaSpec({ shape: "star", width: 1, innerRatio: 1.5 })).toMatch(/innerRatio/);
  });

  it("toWorld adds the centre", () => {
    expect(toWorld([[1, 2, 3]], [10, 20, 30])).toEqual([[11, 22, 33]]);
  });
});
