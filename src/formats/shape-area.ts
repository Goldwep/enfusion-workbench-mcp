/**
 * Shape area outlines: a TypeScript port of the point maths of the vanilla World Editor tool
 * `SCR_ShapeAreaTool` (scripts/WorkbenchGame/WorldEditor/SCR_ShapeAreaTool.c, 1.9 paks), used by
 * `wb_shape area` (phase5-w6-spec.md section 2.3).
 *
 * The points are local to the shape's origin (the tool's default `m_bCentreOnPosition`: the
 * outline is centred on the origin), in metres, x across (width) and z along (length), y 0, and
 * clockwise as the tool makes them:
 *
 * - circle: from angle PI/2 + 2 PI, stepping down by 2 PI / segments while above PI/2 and not
 *   `float.AlmostEqual` to it (epsilon 0.0001, the engine default): (cos a * w/2, 0, sin a * l/2).
 * - rectangle: per side, `segments` points from the side's start corner stepping by side/segments,
 *   corners top-right, bottom-right, bottom-left, top-left.
 * - star: per branch the outer point at a and the inner point at a - step/2 scaled by innerRatio.
 *
 * One deliberate difference: the vanilla `GetRectanglePoints` tests `if (m_iRectangleSegmentsPerSide)`
 * where it means "is 1", so the shipped tool always answers the four corners. Here `segments` per
 * side reaches the multi-segment branch the tool wrote (its formula is ported as written); at 1
 * both branches give the same four corners.
 */

/** The three outlines of the vanilla tool. */
export const AREA_SHAPES = ["circle", "rectangle", "star"] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

/** The vanilla tool's defaults and bounds (its [Attribute] defvalue and params). */
export const AREA_DEFAULTS = {
  circleSegments: 12,
  rectangleSegments: 1,
  branches: 5,
  innerRatio: 0.5,
} as const;
export const AREA_BOUNDS = {
  minSize: 0.001,
  minCircleSegments: 3,
  minRectangleSegments: 1,
  minBranches: 2,
  minInnerRatio: 0.01,
  maxInnerRatio: 1,
} as const;
/** `float.AlmostEqual`'s default epsilon (scripts/Core/generated/Types/float.c). */
export const ALMOST_EQUAL_EPSILON = 0.0001;

export interface AreaSpec {
  shape: AreaShape;
  /** Metres across (x). */
  width: number;
  /** Metres along (z); defaults to width. */
  length?: number;
  /** Circle: points round the circle; rectangle: points per side. */
  segments?: number;
  /** Star: branches. */
  branches?: number;
  /** Star: inner radius as a share of the outer one, 0.01..1. */
  innerRatio?: number;
}

/** One local point [x, y, z]. */
export type Vec3 = [number, number, number];

/** Why a spec is out of the vanilla tool's bounds, or undefined when it is in them. */
export function checkAreaSpec(spec: AreaSpec): string | undefined {
  if (!(AREA_SHAPES as readonly string[]).includes(spec.shape)) {
    return `shape must be one of ${AREA_SHAPES.join(", ")}, got '${String(spec.shape)}'`;
  }
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (!finite(spec.width) || spec.width < AREA_BOUNDS.minSize) {
    return `width must be a number of at least ${AREA_BOUNDS.minSize} metres`;
  }
  if (spec.length !== undefined && (!finite(spec.length) || spec.length < AREA_BOUNDS.minSize)) {
    return `length must be a number of at least ${AREA_BOUNDS.minSize} metres`;
  }
  if (spec.segments !== undefined) {
    const min =
      spec.shape === "rectangle" ? AREA_BOUNDS.minRectangleSegments : AREA_BOUNDS.minCircleSegments;
    if (!Number.isInteger(spec.segments) || spec.segments < min) {
      return `segments must be a whole number of at least ${min} for a ${spec.shape}`;
    }
  }
  if (
    spec.branches !== undefined &&
    (!Number.isInteger(spec.branches) || spec.branches < AREA_BOUNDS.minBranches)
  ) {
    return `branches must be a whole number of at least ${AREA_BOUNDS.minBranches}`;
  }
  if (
    spec.innerRatio !== undefined &&
    (!finite(spec.innerRatio) ||
      spec.innerRatio < AREA_BOUNDS.minInnerRatio ||
      spec.innerRatio > AREA_BOUNDS.maxInnerRatio)
  ) {
    return `innerRatio must be ${AREA_BOUNDS.minInnerRatio} to ${AREA_BOUNDS.maxInnerRatio}`;
  }
  return undefined;
}

/** The number of points an area spec gives, without computing them. */
export function areaPointCount(spec: AreaSpec): number {
  if (spec.shape === "circle") return angleSteps(spec.segments ?? AREA_DEFAULTS.circleSegments);
  if (spec.shape === "star") return 2 * angleSteps(spec.branches ?? AREA_DEFAULTS.branches);
  return 4 * (spec.segments ?? AREA_DEFAULTS.rectangleSegments);
}

/** The angles of the vanilla clockwise loop for `count` steps round the circle. */
function clockwiseAngles(count: number): number[] {
  const step = (Math.PI * 2) / count;
  const min = Math.PI / 2;
  const out: number[] = [];
  for (let a = Math.PI / 2 + Math.PI * 2; a > min; a -= step) {
    if (Math.abs(a - min) <= ALMOST_EQUAL_EPSILON) break;
    out.push(a);
  }
  return out;
}

function angleSteps(count: number): number {
  return clockwiseAngles(count).length;
}

/** SCR_ShapeAreaTool.GetCirclePoints. */
export function circlePoints(width: number, length: number, segments: number): Vec3[] {
  return clockwiseAngles(segments).map((a) => [
    Math.cos(a) * width * 0.5,
    0,
    Math.sin(a) * length * 0.5,
  ]);
}

/** SCR_ShapeAreaTool.GetRectanglePoints (the multi-segment branch; see the file comment). */
export function rectanglePoints(width: number, length: number, segments: number): Vec3[] {
  const data: Vec3[] = [
    [width * 0.5, 0, length * 0.5], // top-right
    [0, 0, -length / segments],
    [width * 0.5, 0, -length * 0.5], // bottom-right
    [-width / segments, 0, 0],
    [-width * 0.5, 0, -length * 0.5], // bottom-left
    [0, 0, length / segments],
    [-width * 0.5, 0, length * 0.5], // top-left
    [width / segments, 0, 0],
  ];
  const out: Vec3[] = [];
  for (let i = 0; i < data.length; i += 2) {
    const [sx, sy, sz] = data[i];
    const [ox, oy, oz] = data[i + 1];
    for (let j = 0; j < segments; j++) out.push([sx + j * ox, sy + j * oy, sz + j * oz]);
  }
  return out;
}

/** SCR_ShapeAreaTool.GetStarPoints. */
export function starPoints(
  width: number,
  length: number,
  branches: number,
  innerRatio: number,
): Vec3[] {
  const step = (Math.PI * 2) / branches;
  const out: Vec3[] = [];
  for (const a of clockwiseAngles(branches)) {
    out.push([Math.cos(a) * width * 0.5, 0, Math.sin(a) * length * 0.5]);
    const b = a - 0.5 * step;
    out.push([Math.cos(b) * width * 0.5 * innerRatio, 0, Math.sin(b) * length * 0.5 * innerRatio]);
  }
  return out;
}

/** The local outline of a spec (SCR_ShapeAreaTool.GetShapePoints, centred). Check it first. */
export function areaPoints(spec: AreaSpec): Vec3[] {
  const width = spec.width;
  const length = spec.length ?? spec.width;
  if (spec.shape === "circle") {
    return circlePoints(width, length, spec.segments ?? AREA_DEFAULTS.circleSegments);
  }
  if (spec.shape === "star") {
    return starPoints(
      width,
      length,
      spec.branches ?? AREA_DEFAULTS.branches,
      spec.innerRatio ?? AREA_DEFAULTS.innerRatio,
    );
  }
  return rectanglePoints(width, length, spec.segments ?? AREA_DEFAULTS.rectangleSegments);
}

/** The outline moved to a world centre. */
export function toWorld(points: Vec3[], centre: Vec3): Vec3[] {
  return points.map(([x, y, z]) => [x + centre[0], y + centre[1], z + centre[2]]);
}
