import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkbenchError } from "../workbench/client.js";
import { loadContract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  parseCursor,
  parseEntityRef,
  printEntityRef,
  type ActionOk,
  type Change,
} from "../manifest/vocabulary.js";
import { isPathInsideRoot } from "../utils/path-guard.js";
import { flatInputShape } from "./wb-entity.js";
import {
  AREA_DEFAULTS,
  areaPointCount,
  areaPoints,
  checkAreaSpec,
  toWorld,
  type AreaShape,
  type Vec3,
} from "../formats/shape-area.js";
import {
  ShapefileError,
  compareShx,
  dbfRow,
  hasZ,
  readDbf,
  readShp,
  readShx,
  recordParts,
  shapeKind,
  type DbfFile,
  type ShpFile,
  type ShpPoint,
} from "../formats/shapefile.js";
import type { Config } from "../config.js";
import type { WorkbenchClient } from "../workbench/client.js";
import type { Contract } from "../manifest/contract.js";

/**
 * wb_shape: World Editor shapes through EMCP_WB_Shape (wave W6, phase5-w6-spec.md section 2.3;
 * DEC-069 OD-2: W7 grows the tool by actions).
 *
 * - points, create: the handler's, checked here before anything is sent.
 * - parallel: the handler's, GATED behind PARALLEL_OPEN until probe P-W6-16 passes (the main
 *   session flips the switch here and the handler's PARALLEL_OPEN together).
 * - area: served here. The outline is SCR_ShapeAreaTool's maths (src/formats/shape-area.ts);
 *   the centre is given, or the camera's screen-centre trace (wb_view camera, then trace with
 *   TraceFlags WORLD, as the vanilla tool); y comes from wb_terrain heights when snapToGround;
 *   then one create.
 * - import: served here (DEC-069 OD-7). The shapefile is read by src/formats/shapefile.ts from a
 *   project-relative path inside the project; polyline parts and polygon parts become one create
 *   each, point and multipoint records are reported, not placed; paged by record.
 *
 * - edit (W7, spec 2.3): set, insert, remove, move points, open or close; the handler's, GATED
 *   behind EDIT_OPEN until probe P-W7-14 passes. planEdit is the TS statement of the engine call
 *   order (SCR_ShapeAreaTool.SetShapePoints: append, then remove from the end), proven in the tests.
 * - area with target: replaces that shape's points through edit set instead of creating one.
 * - points: tesselated true pages the tessellated points; a spline's anchors also return tangents.
 *
 * Every world edit is in memory with one undo step per call (DEC-061 OD-3, DEC-075 OD-12: no
 * confirm), and nothing here names a sandbox or a project (DEC-058).
 */

export const HANDLER = "EMCP_WB_Shape";
export const VIEW_HANDLER = "EMCP_WB_View";
export const TERRAIN_HANDLER = "EMCP_WB_Terrain";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const SHAPE_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const SHAPE_REQUEST_SCHEMA = buildRequestSchema(SHAPE_CONTRACT);
export const WB_SHAPE_DESCRIPTION = checkedDescription(SHAPE_CONTRACT);

/**
 * The switch of the gated action. parallel answers GATED until probe P-W6-16 shows a handler
 * calling SCR_ParallelShapeHelper works and the copies land where they should (contract
 * "refuses"; handler EMCP_WB_Shape.PARALLEL_OPEN). The main session sets both to true.
 */
export const PARALLEL_OPEN = false;
export const PARALLEL_GATE_REASON =
  "parallel waits for probe P-W6-16 (a handler calling SCR_ParallelShapeHelper is unproven); nothing was sent";

/**
 * The switch of the gated edit action: EMCP_WB_Shape.EDIT_OPEN, until probe P-W7-14 shows each op
 * writes the points asked with one undo. The main session sets both to true.
 */
export const EDIT_OPEN = false;
export const EDIT_GATE_REASON =
  "edit waits for probe P-W7-14 (the shape edit ops are unproven from a handler); the arguments are valid, nothing was sent";
export const EDIT_GATE_NEXT =
  "The main session opens it after probe P-W7-14 passes (EDIT_OPEN in wb-shape.ts and EMCP_WB_Shape.c).";
export const EDIT_OPS = ["set", "insert", "remove", "move", "open", "close"] as const;
export type EditOp = (typeof EDIT_OPS)[number];

/** The handler's bounds (EMCP_WB_Shape.MIN_POINTS, MAX_POINTS, MAX_OFFSETS). */
export const MIN_POINTS = 2;
export const MAX_POINTS = 2000;
export const MAX_OFFSETS = 16;
/** wb_terrain heights takes at most this many points per call (EMCP_WB_TerrainUtil.MAX_POINTS). */
export const HEIGHTS_BATCH = 200;
/** import: records per call. */
export const IMPORT_LIMIT_DEFAULT = 50;
/** import: points of a point or multipoint record listed in the report. */
export const REPORT_POINTS_MAX = 20;
export const READ_TIMEOUT_MS = 30_000;
export const WORLD_TARGET = "open:WorldEditor";

export interface ShapeError {
  ok: false;
  action: string;
  target: string;
  /** A vocabulary code (NOT_A_SHAPE among them) or a kernel code (LOST, MODAL_OPEN, WEDGED). */
  code: string;
  message: string;
  next: string;
  warnings: string[];
  /** What was done before the failure (created ids, the resume cursor, ...). */
  readback?: Record<string, unknown>;
}

export type ShapeResponse = ActionOk | ShapeError;

export interface ShapeOptions {
  /** The project root (config.projectPath); import reads only inside it. */
  projectPath?: string;
  /** Overrides PARALLEL_OPEN (tests and the probe). */
  parallelOpen?: boolean;
  /** Overrides EDIT_OPEN (tests and the probe); gates edit and area with a target. */
  editOpen?: boolean;
}

type Raw = Record<string, unknown>;

function nextFor(code: string): string {
  return (ERROR_CODES as Record<string, string>)[code] ?? "See the message.";
}

function fail(
  action: string,
  target: string,
  code: string,
  message: string,
  next?: string,
): ShapeError {
  return { ok: false, action, target, code, message, next: next || nextFor(code), warnings: [] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function numbersOf(text: string): string[] {
  return text
    .replace(/,/g, " ")
    .split(" ")
    .filter((p) => p !== "");
}

/** "x y z" (spaces or commas), three finite numbers, as the handler's ParseVectorString. */
export function parseVector(key: string, text: string): Vec3 {
  const parts = numbersOf(text);
  if (parts.length !== 3 || parts.some((p) => !NUMBER.test(p))) {
    throw new Refusal("INVALID_ARGUMENT", `${key} must be three numbers as "x y z", got '${text}'`);
  }
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** "r g b a", four numbers each 0..1, as the handler's ParseColor. */
export function checkColor(text: string): void {
  const parts = numbersOf(text);
  if (parts.length !== 4 || parts.some((p) => !NUMBER.test(p) || Number(p) < 0 || Number(p) > 1)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `color must be "r g b a", four numbers 0..1, got '${text}'`,
    );
  }
}

/** A number as handler text: six decimals at most, never an exponent, never "-0". */
export function num(n: number): string {
  const r = Number(n.toFixed(6));
  return Object.is(r, -0) ? "0" : String(r);
}

export function vecText(v: Vec3): string {
  return `${num(v[0])} ${num(v[1])} ${num(v[2])}`;
}

function canonicalRef(key: string, text: string): string {
  try {
    return printEntityRef(parseEntityRef(text));
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `${key}: ${e.message}`);
    throw e;
  }
}

function checkPaging(req: Raw, max: number): void {
  if (typeof req.cursor === "string") {
    try {
      parseCursor(req.cursor);
    } catch (e) {
      if (e instanceof VocabularyError) throw new Refusal(e.code, e.message);
      throw e;
    }
  }
  if (typeof req.limit === "number" && (req.limit < 1 || req.limit > max)) {
    throw new Refusal("INVALID_ARGUMENT", `limit must be 1 to ${max}`);
  }
}

// ── Edit planner ─────────────────────────────────────────────────────────────

/** One engine call of an edit, inside the open entity action (the "Points" array of ShapePoint). */
export type EditStep =
  | { call: "CreateObjectArrayVariableMember"; slot: number }
  | { call: "SetVariableValue"; variable: "Position"; slot: number; point: number }
  | { call: "RemoveObjectArrayVariableMember"; slot: number }
  | { call: "SetVariableValue"; variable: "IsClosed"; value: "1" }
  | { call: "ClearVariableValue"; variable: "IsClosed" };

export interface EditPlan {
  steps: EditStep[];
  /** Points the shape holds after the edit. */
  expected: number;
  closedAfter: boolean;
}

export interface EditPlanInput {
  op: EditOp;
  /** Points in the shape now. */
  before: number;
  /** insert, remove, move. */
  index?: number;
  /** Points given (set, insert, move). */
  count: number;
  /** The shape is closed now. */
  closed: boolean;
}

/** Why an edit does not fit a shape (the handler's rangeWhy), or undefined when it does. */
export function editRangeProblem(i: EditPlanInput): string | undefined {
  const index = i.index ?? 0;
  switch (i.op) {
    case "set":
      return i.closed && i.count < 3
        ? `the shape is closed and set gives ${i.count} points, at least 3 are needed`
        : undefined;
    case "insert":
      if (index > i.before) {
        return `insert index ${index} is past the end (the shape has ${i.before} points; ${i.before} appends)`;
      }
      return i.before + i.count > MAX_POINTS
        ? `insert gives ${i.before + i.count} points, a shape takes at most ${MAX_POINTS}`
        : undefined;
    case "remove":
      if (index >= i.before) {
        return `remove index ${index} is out of range (the shape has ${i.before} points)`;
      }
      return i.before - 1 < MIN_POINTS || (i.closed && i.before - 1 < 3)
        ? `remove leaves ${i.before - 1} points, too few for this shape`
        : undefined;
    case "move":
      return index >= i.before
        ? `move index ${index} is out of range (the shape has ${i.before} points)`
        : undefined;
    case "close":
      return i.before < 3
        ? `a closed shape needs at least 3 points, this one has ${i.before}`
        : undefined;
    default:
      return undefined;
  }
}

/**
 * The engine calls of one edit, in the order of EMCP_WB_Shape.ApplyEdit and
 * SCR_ShapeAreaTool.SetShapePoints: set appends the new points at slots before + i (create, then
 * position), then removes the old points from the end (before - 1 down to 0), so the new ones
 * end at 0 .. count - 1; insert creates and positions the new points at index + i; remove removes
 * the point at index; move re-positions the point at index; close sets IsClosed "1"; open clears
 * it. A close of a closed shape or an open of an open one plans nothing (the handler answers ok,
 * nothing changed). `point` of a Position step indexes the points given. Throws a Refusal
 * (INVALID_ARGUMENT) when the edit does not fit the shape.
 */
export function planEdit(i: EditPlanInput): EditPlan {
  const why = editRangeProblem(i);
  if (why) throw new Refusal("INVALID_ARGUMENT", why);
  const index = i.index ?? 0;
  const steps: EditStep[] = [];
  let expected = i.before;
  let closedAfter = i.closed;
  if (i.op === "close" || i.op === "open") {
    closedAfter = i.op === "close";
    if (closedAfter !== i.closed) {
      steps.push(
        closedAfter
          ? { call: "SetVariableValue", variable: "IsClosed", value: "1" }
          : { call: "ClearVariableValue", variable: "IsClosed" },
      );
    }
  } else if (i.op === "remove") {
    steps.push({ call: "RemoveObjectArrayVariableMember", slot: index });
    expected = i.before - 1;
  } else if (i.op === "move") {
    steps.push({ call: "SetVariableValue", variable: "Position", slot: index, point: 0 });
  } else {
    const first = i.op === "set" ? i.before : index;
    for (let k = 0; k < i.count; k++) {
      steps.push({ call: "CreateObjectArrayVariableMember", slot: first + k });
      steps.push({ call: "SetVariableValue", variable: "Position", slot: first + k, point: k });
    }
    if (i.op === "set") {
      for (let old = i.before - 1; old >= 0; old--) {
        steps.push({ call: "RemoveObjectArrayVariableMember", slot: old });
      }
      expected = i.count;
    } else {
      expected = i.before + i.count;
    }
  }
  return { steps, expected, closedAfter };
}

/**
 * Runs a plan on a plain point list the way the engine's array calls act (create inserts an empty
 * point at the slot, position fills it, remove deletes the slot), to prove what a plan produces.
 * Throws when a step names a slot that does not exist.
 */
export function applyEditPlan(
  points: string[],
  closed: boolean,
  steps: EditStep[],
  given: string[],
): { points: string[]; closed: boolean } {
  const list: Array<string | null> = [...points];
  let isClosed = closed;
  const inRange = (slot: number, max: number) => {
    if (!Number.isInteger(slot) || slot < 0 || slot > max) {
      throw new Error(`slot ${slot} is outside 0..${max}`);
    }
  };
  for (const s of steps) {
    if (s.call === "CreateObjectArrayVariableMember") {
      inRange(s.slot, list.length);
      list.splice(s.slot, 0, null);
    } else if (s.call === "RemoveObjectArrayVariableMember") {
      inRange(s.slot, list.length - 1);
      list.splice(s.slot, 1);
    } else if (s.call === "ClearVariableValue") {
      isClosed = false;
    } else if (s.variable === "IsClosed") {
      isClosed = true;
    } else {
      inRange(s.slot, list.length - 1);
      list[s.slot] = given[s.point];
    }
  }
  return { points: list.map((p) => p ?? "(empty)"), closed: isClosed };
}

/** The argument checks of edit that need no shape (the handler's, before its gate). */
function checkEditArgs(req: Raw): void {
  const op = str(req.op);
  if (!(EDIT_OPS as readonly string[]).includes(op)) {
    throw new Refusal("INVALID_ARGUMENT", `op must be ${EDIT_OPS.join(", ")}; got '${op}'`);
  }
  const points = Array.isArray(req.points) ? (req.points as string[]) : [];
  const takesPoints = op === "set" || op === "insert" || op === "move";
  const takesIndex = op === "insert" || op === "remove" || op === "move";
  if (!takesPoints && points.length > 0) {
    throw new Refusal("INVALID_ARGUMENT", `op ${op} takes no points, got ${points.length}`);
  }
  if (op === "set" && (points.length < MIN_POINTS || points.length > MAX_POINTS)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `set takes ${MIN_POINTS} to ${MAX_POINTS} points, got ${points.length}`,
    );
  }
  if (op === "insert" && (points.length < 1 || points.length > MAX_POINTS)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `insert takes 1 to ${MAX_POINTS} points, got ${points.length}`,
    );
  }
  if (op === "move" && points.length !== 1) {
    throw new Refusal("INVALID_ARGUMENT", `move takes exactly 1 point, got ${points.length}`);
  }
  if (takesIndex && !(typeof req.index === "number" && req.index >= 0)) {
    throw new Refusal("INVALID_ARGUMENT", `op ${op} needs index (0 or more)`);
  }
  if (!takesIndex && req.index !== undefined) {
    throw new Refusal("INVALID_ARGUMENT", `op ${op} takes no index`);
  }
  points.forEach((p, i) => parseVector(`points[${i}]`, p));
}

/** A checked request: what the action needs, or the refusal raised before anything is sent. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: ShapeError };

/**
 * Validates one tool input against the contract's per-action schema and the rules its types
 * cannot say. Nothing is sent when this refuses (INVALID_ARGUMENT, or GATED for parallel while
 * its switch is off).
 */
export function prepareRequest(input: unknown, options: ShapeOptions = {}): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const parsed = SHAPE_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, WORLD_TARGET, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const mutating = SHAPE_CONTRACT.actions.find((a) => a.name === action)?.mutating ?? true;
  const params: Raw = { ...req };
  let target = WORLD_TARGET;

  try {
    for (const key of ["entity", "parent", "target"]) {
      if (typeof req[key] === "string") params[key] = canonicalRef(key, req[key]);
    }
    if (typeof params.entity === "string") target = `entity:${params.entity}`;
    else if (typeof params.target === "string") target = `entity:${params.target}`;
    if (typeof req.color === "string") checkColor(req.color);

    if (action === "points") {
      checkPaging(req, LIMIT_MAX);
    } else if (action === "edit") {
      checkEditArgs(req);
      if (!(options.editOpen ?? EDIT_OPEN)) {
        return {
          ok: false,
          error: fail(action, target, "GATED", EDIT_GATE_REASON, EDIT_GATE_NEXT),
        };
      }
    } else if (action === "create") {
      const points = req.points as string[];
      if (points.length < MIN_POINTS || points.length > MAX_POINTS) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          `points must hold ${MIN_POINTS} to ${MAX_POINTS} entries, got ${points.length}`,
        );
      }
      points.forEach((p, i) => parseVector(`points[${i}]`, p));
      if (req.closed === true && points.length < 3) {
        throw new Refusal("INVALID_ARGUMENT", "a closed shape needs at least 3 points");
      }
    } else if (action === "parallel") {
      if (!(options.parallelOpen ?? PARALLEL_OPEN)) {
        return { ok: false, error: fail(action, target, "GATED", PARALLEL_GATE_REASON) };
      }
      const offsets = req.offsets as string[];
      if (offsets.length < 1 || offsets.length > MAX_OFFSETS) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          `offsets must hold 1 to ${MAX_OFFSETS} entries, got ${offsets.length}`,
        );
      }
      offsets.forEach((o, i) => {
        if (!NUMBER.test(o.trim())) {
          throw new Refusal("INVALID_ARGUMENT", `offsets[${i}] is not a number: '${o}'`);
        }
      });
      params.offsets = offsets.map((o) => o.trim());
      if (typeof req.minDistance === "number") {
        if (!(req.minDistance >= 0)) {
          throw new Refusal("INVALID_ARGUMENT", "minDistance must be 0 or more");
        }
        // Floats travel as text (W1 live run 2026-11-11: a JSON number never reaches a float).
        params.minDistance = num(req.minDistance);
      }
    } else if (action === "area") {
      const why = checkAreaSpec(areaSpecOf(req));
      if (why) throw new Refusal("INVALID_ARGUMENT", why);
      const count = areaPointCount(areaSpecOf(req));
      if (count > MAX_POINTS) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          `the outline would have ${count} points, a shape takes at most ${MAX_POINTS}`,
        );
      }
      if (typeof req.centre === "string") parseVector("centre", req.centre);
      if (typeof req.target === "string") {
        for (const key of ["closed", "spline", "layer"]) {
          if (req[key] !== undefined) {
            throw new Refusal(
              "INVALID_ARGUMENT",
              `${key} does not apply with target: the shape keeps its own class, layer and closed state`,
            );
          }
        }
        if (!(options.editOpen ?? EDIT_OPEN)) {
          return {
            ok: false,
            error: fail(action, target, "GATED", EDIT_GATE_REASON, EDIT_GATE_NEXT),
          };
        }
      }
    } else if (action === "import") {
      const rel = checkRelativePath(str(req.path));
      if (!/\.shp$/i.test(rel)) {
        throw new Refusal("INVALID_ARGUMENT", `path must name a .shp file, got '${rel}'`);
      }
      params.path = rel;
      target = `path:${rel}`;
      if (typeof req.offset === "string") parseVector("offset", req.offset);
      checkPaging(req, LIMIT_MAX);
    }
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: fail(action, target, e.code, e.message) };
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  return { ok: true, action, target, mutating, params };
}

function areaSpecOf(req: Raw) {
  return {
    shape: str(req.shape) as AreaShape,
    width: req.width as number,
    length: req.length as number | undefined,
    segments: req.segments as number | undefined,
    branches: req.branches as number | undefined,
    innerRatio: req.innerRatio as number | undefined,
  };
}

// ── Calls ────────────────────────────────────────────────────────────────────

/** One handler call; a WorkbenchError or a non-ok answer comes back as the error shape. */
async function callHandler(
  client: WorkbenchClient,
  fn: string,
  params: Raw,
  access: "read" | "mutate",
  action: string,
  target: string,
): Promise<{ ok: true; r: Raw } | { ok: false; error: ShapeError }> {
  let r: Raw;
  try {
    r = await client.call<Raw>(fn, params, { access, timeout: READ_TIMEOUT_MS });
  } catch (e) {
    if (e instanceof WorkbenchError) {
      const next =
        e.code === "LOST"
          ? ERROR_CODES.LOST
          : e.code === "MODAL_OPEN"
            ? ERROR_CODES.MODAL_OPEN
            : e.code === "WEDGED"
              ? ERROR_CODES.WEDGED
              : "Check the Workbench connection (wb_diagnose).";
      return { ok: false, error: fail(action, target, e.code, e.message, next) };
    }
    throw e;
  }
  if (str(r.status) !== "ok") {
    const code = str(r.code) || "HANDLER_ERROR";
    const message = str(r.message) || `${fn} answered ${str(r.status) || "no status"}`;
    const error = fail(action, target, code, message, str(r.next));
    const partial: Raw = {};
    for (const k of ["id", "className", "undoName"]) if (str(r[k]) !== "") partial[k] = r[k];
    const ids = strs(r.ids);
    if (ids.length) partial.ids = ids;
    if (Object.keys(partial).length) error.readback = partial;
    return { ok: false, error };
  }
  return { ok: true, r };
}

/** The create answer as the tool's ok shape. */
function createOk(action: string, target: string, r: Raw, extra: Raw = {}): ActionOk {
  const id = str(r.id);
  const undoName = str(r.undoName);
  return {
    ok: true,
    action,
    target,
    changed: [{ path: id, before: null, after: str(r.className) }],
    readback: { id, className: str(r.className), total: Number(r.total ?? 0), undoName, ...extra },
    next: undoName ? "Undo with wb_undo_redo." : undefined,
    warnings: [],
  };
}

/** The edit answer as the tool's ok shape; an answer without undoName changed nothing. */
function editOk(action: string, target: string, r: Raw, op: string, extra: Raw = {}): ActionOk {
  const id = str(r.id);
  const undoName = str(r.undoName);
  const total = Number(r.total ?? 0);
  const warnings: string[] = [];
  if (undoName === "" && str(r.message) !== "") warnings.push(str(r.message));
  return {
    ok: true,
    action,
    target,
    changed: undoName ? [{ path: id, before: null, after: `${op}: ${total} points` }] : null,
    readback: { id, op, total, closed: truthy(r.closed), undoName, ...extra },
    next: undoName ? "Undo with wb_undo_redo." : undefined,
    warnings,
  };
}

/**
 * Terrain heights of world points through wb_terrain heights, in batches. A point the terrain
 * does not cover keeps undefined. NO_TERRAIN answers `noTerrain` so a caller may fall back.
 */
async function terrainHeights(
  client: WorkbenchClient,
  xz: Array<[number, number]>,
  action: string,
  target: string,
): Promise<{ ok: true; ys: Array<number | undefined> } | { ok: false; error: ShapeError }> {
  const ys: Array<number | undefined> = [];
  for (let i = 0; i < xz.length; i += HEIGHTS_BATCH) {
    const batch = xz.slice(i, i + HEIGHTS_BATCH);
    const got = await callHandler(
      client,
      TERRAIN_HANDLER,
      { action: "heights", points: batch.map(([x, z]) => `${num(x)} ${num(z)}`) },
      "read",
      action,
      target,
    );
    if (!got.ok) return got;
    const rows = strs(got.r.rows);
    if (rows.length !== batch.length) {
      return {
        ok: false,
        error: fail(
          action,
          target,
          "HANDLER_ERROR",
          `wb_terrain heights answered ${rows.length} rows for ${batch.length} points; nothing was created`,
        ),
      };
    }
    for (const row of rows) {
      const cells = row.split("|");
      const y = Number(cells[3]);
      ys.push(cells.length === 4 && truthy(cells[2]) && Number.isFinite(y) ? y : undefined);
    }
  }
  return { ok: true, ys };
}

// ── area ─────────────────────────────────────────────────────────────────────

async function runArea(
  client: WorkbenchClient,
  action: string,
  target: string,
  req: Raw,
): Promise<ShapeResponse> {
  const warnings: string[] = [];
  let centre: Vec3;
  let centreFrom: string;
  if (typeof req.centre === "string") {
    centre = parseVector("centre", req.centre);
    centreFrom = "given";
  } else {
    // SCR_ShapeAreaTool.CreateShape: TraceWorldPos at the screen centre, TraceFlags.WORLD.
    const cam = await callHandler(
      client,
      VIEW_HANDLER,
      { action: "camera" },
      "read",
      action,
      target,
    );
    if (!cam.ok) return cam.error;
    const w = Number(cam.r.screenWidth ?? 0);
    const h = Number(cam.r.screenHeight ?? 0);
    if (!(w > 0 && h > 0)) {
      return fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `the viewport is ${w}x${h}; pass centre as "x y z"`,
      );
    }
    const x = Math.floor(w * 0.5);
    const y = Math.floor(h * 0.5);
    const tr = await callHandler(
      client,
      VIEW_HANDLER,
      { action: "trace", x, y, flags: "WORLD" },
      "read",
      action,
      target,
    );
    if (!tr.ok) return tr.error;
    if (!truthy(tr.r.hit)) {
      return fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `the trace from the screen centre (${x}, ${y}) hit no ground; nothing was created`,
        'Point the camera at the ground (wb_view setCamera) or pass centre as "x y z".',
      );
    }
    try {
      centre = parseVector("trace end", str(tr.r.end));
    } catch (e) {
      if (e instanceof Refusal) return fail(action, target, "HANDLER_ERROR", e.message);
      throw e;
    }
    centreFrom = `camera trace at (${x}, ${y})`;
  }

  const spec = areaSpecOf(req);
  const world = toWorld(areaPoints(spec), centre);

  let snapped = 0;
  if (req.snapToGround === true) {
    const hs = await terrainHeights(
      client,
      world.map((p) => [p[0], p[2]] as [number, number]),
      action,
      target,
    );
    if (!hs.ok) return hs.error;
    hs.ys.forEach((y, i) => {
      if (y !== undefined) {
        world[i][1] = y;
        snapped++;
      }
    });
    if (snapped < world.length) {
      warnings.push(
        `${world.length - snapped} point(s) are off the terrain and keep the centre's y`,
      );
    }
  }

  const extra = {
    shape: spec.shape,
    centre: vecText(centre),
    centreFrom,
    pointCount: world.length,
    snapped,
    segments:
      spec.shape === "circle"
        ? (spec.segments ?? AREA_DEFAULTS.circleSegments)
        : spec.shape === "rectangle"
          ? (spec.segments ?? AREA_DEFAULTS.rectangleSegments)
          : undefined,
  };
  let res: ActionOk;
  if (typeof req.target === "string") {
    // Replace the target's points: one edit set (one undo step); the shape keeps its class.
    const set = await callHandler(
      client,
      HANDLER,
      { action: "edit", entity: req.target, op: "set", points: world.map(vecText) },
      "mutate",
      action,
      target,
    );
    if (!set.ok) return set.error;
    res = editOk(action, target, set.r, "set", extra);
  } else {
    const params: Raw = {
      action: "create",
      points: world.map(vecText),
      closed: req.closed !== false,
      spline: req.spline === true,
    };
    if (typeof req.layer === "string") params.layer = req.layer;
    const made = await callHandler(client, HANDLER, params, "mutate", action, target);
    if (!made.ok) return made.error;
    res = createOk(action, target, made.r, extra);
  }
  res.warnings.push(...warnings);
  return res;
}

// ── import ───────────────────────────────────────────────────────────────────

interface ImportUnit {
  record: number;
  part: number;
  closed: boolean;
  points: ShpPoint[];
}

/** A sibling of the .shp with another extension, either case. */
function sibling(file: string, ext: string): string | undefined {
  const base = file.slice(0, -4);
  for (const e of [ext.toLowerCase(), ext.toUpperCase()]) {
    const p = `${base}.${e}`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

function samePoint(a: ShpPoint, b: ShpPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

async function runImport(
  client: WorkbenchClient,
  action: string,
  target: string,
  req: Raw,
  options: ShapeOptions,
): Promise<ShapeResponse> {
  const rel = str(req.path);
  const root = options.projectPath;
  if (!root) {
    return fail(
      action,
      target,
      "NOT_IN_PROJECT",
      "import needs the project path (ENFUSION_PROJECT_PATH); nothing was read",
    );
  }
  const file = resolve(root, rel);
  if (!isPathInsideRoot(file, root)) {
    return fail(
      action,
      target,
      "NOT_IN_PROJECT",
      `${rel} resolves outside the project; nothing was read`,
    );
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    return fail(action, target, "PATH_NOT_FOUND", `no file at ${rel} in the project`);
  }

  const warnings: string[] = [];
  let shp: ShpFile;
  let dbf: DbfFile | undefined;
  try {
    shp = readShp(readFileSync(file));
    const shxFile = sibling(file, "shx");
    if (shxFile) {
      const bad = compareShx(shp, readShx(readFileSync(shxFile)));
      if (bad.length)
        warnings.push(`the .shx disagrees with the .shp: ${bad.slice(0, 3).join("; ")}`);
    } else {
      warnings.push("no .shx beside the .shp (the engine loader needs it; this reader does not)");
    }
    const dbfFile = sibling(file, "dbf");
    if (dbfFile) dbf = readDbf(readFileSync(dbfFile));
  } catch (e) {
    if (e instanceof ShapefileError) {
      return fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `${rel} is not a readable shapefile: ${e.message}`,
      );
    }
    throw e;
  }
  if (shp.trailing.length)
    warnings.push(`${shp.trailing.length} byte(s) after the last record were ignored`);

  const total = shp.records.length;
  let start = 0;
  if (typeof req.cursor === "string") {
    const c = parseCursor(req.cursor);
    try {
      checkCursor(c, total);
    } catch (e) {
      if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
      throw e;
    }
    start = c.start;
  }
  const limit = typeof req.limit === "number" ? req.limit : IMPORT_LIMIT_DEFAULT;
  const end = Math.min(total, start + limit);
  const offset: Vec3 =
    typeof req.offset === "string" ? parseVector("offset", req.offset) : [0, 0, 0];

  // Sort the page's records: parts to create, records to report, records to skip.
  const units: ImportUnit[] = [];
  const reported: Raw[] = [];
  const skipped: Raw[] = [];
  for (let i = start; i < end; i++) {
    const rec = shp.records[i];
    const kind = shapeKind(rec.type);
    const record = i + 1;
    if (kind === "null") {
      skipped.push({ record, reason: "null shape" });
    } else if (kind === "point" || kind === "multipoint") {
      reported.push({
        record,
        kind,
        count: rec.points.length,
        points: rec.points.slice(0, REPORT_POINTS_MAX).map((p) => {
          const o: Raw = { x: p.x + offset[0], z: p.y + offset[2] };
          if (p.z !== undefined) o.y = p.z + offset[1];
          return o;
        }),
        attributes: dbf ? dbfRow(dbf, i) : undefined,
      });
    } else if (kind === "polyline" || kind === "polygon") {
      recordParts(rec).forEach((part, p) => {
        let pts = part;
        const closed = kind === "polygon";
        // A polygon ring repeats its first point last (SCR_ImportShapefilePlugin drops it).
        if (closed && pts.length > 1 && samePoint(pts[0], pts[pts.length - 1]))
          pts = pts.slice(0, -1);
        const min = closed ? 3 : MIN_POINTS;
        if (pts.length < min || pts.length > MAX_POINTS) {
          skipped.push({
            record,
            part: p,
            reason: `${pts.length} points; a ${closed ? "closed " : ""}shape takes ${min} to ${MAX_POINTS}`,
          });
        } else {
          units.push({ record, part: p, closed, points: pts });
        }
      });
    } else {
      skipped.push({ record, reason: `shape type ${rec.type} is not imported` });
    }
  }

  // Heights first (vanilla: terrain y + offset y), before any create.
  const all: Array<[number, number]> = [];
  for (const u of units) for (const p of u.points) all.push([p.x + offset[0], p.y + offset[2]]);
  let ys: Array<number | undefined> = [];
  if (all.length) {
    const hs = await terrainHeights(client, all, action, target);
    if (hs.ok) ys = hs.ys;
    else if (hs.error.code === "NO_TERRAIN") {
      warnings.push("the world has no terrain: y is the shapefile's z (or 0) plus the offset");
    } else return hs.error;
  }

  const fileHasZ = hasZ(shp.header.shapeType);
  const created: Raw[] = [];
  const changed: Change[] = [];
  let off = 0;
  let offTerrain = 0;
  for (const u of units) {
    const points = u.points.map((p) => {
      const terrainY = ys[off++];
      if (terrainY === undefined) offTerrain++;
      const y = (terrainY ?? (fileHasZ ? (p.z ?? 0) : 0)) + offset[1];
      return vecText([p.x + offset[0], y, p.y + offset[2]]);
    });
    const params: Raw = { action: "create", points, closed: u.closed, spline: req.spline === true };
    if (typeof req.color === "string") params.color = req.color;
    if (typeof req.layer === "string") params.layer = req.layer;
    const made = await callHandler(client, HANDLER, params, "mutate", action, target);
    if (!made.ok) {
      const error = made.error;
      const resume = `${u.record - 1}:${total}`;
      error.message = `record ${u.record} part ${u.part}: ${error.message}; ${created.length} shape(s) were created before it`;
      error.readback = { ...(error.readback ?? {}), created, resumeCursor: resume };
      error.warnings = warnings;
      if (error.code !== "LOST" && error.code !== "WEDGED" && error.code !== "MODAL_OPEN") {
        error.next = `${error.next} Resume with cursor "${resume}" (earlier parts of that record are created again); undo with wb_undo_redo.`;
      }
      return error;
    }
    const id = str(made.r.id);
    created.push({ record: u.record, part: u.part, id, points: Number(made.r.total ?? 0) });
    changed.push({ path: id, before: null, after: str(made.r.className) });
  }
  if (ys.length && offTerrain) {
    warnings.push(
      `${offTerrain} vertex(es) are off the terrain: y is the shapefile's z (or 0) plus the offset`,
    );
  }

  const next = end < total ? `${end}:${total}` : undefined;
  return {
    ok: true,
    action,
    target,
    changed,
    readback: {
      path: rel,
      shapeType: shp.header.shapeType,
      records: total,
      from: start,
      to: end,
      created,
      reported,
      skipped,
      nextCursor: next ?? null,
    },
    next: next
      ? `More: resend with cursor "${next}". Each shape is one undo step (wb_undo_redo).`
      : created.length
        ? "Each shape is one undo step (wb_undo_redo)."
        : undefined,
    warnings,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Runs one wb_shape request end to end; never throws for a Workbench-side failure. */
export async function runShape(
  client: WorkbenchClient,
  input: unknown,
  options: ShapeOptions = {},
): Promise<ShapeResponse> {
  const prepared = prepareRequest(input, options);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;

  if (action === "area") return runArea(client, action, target, params);
  if (action === "import") return runImport(client, action, target, params, options);

  const got = await callHandler(
    client,
    HANDLER,
    params,
    mutating ? "mutate" : "read",
    action,
    target,
  );
  if (!got.ok) return got.error;
  const r = got.r;

  if (action === "points") {
    const total = Number(r.total ?? 0);
    if (typeof params.cursor === "string") {
      try {
        checkCursor(parseCursor(params.cursor), total);
      } catch (e) {
        if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
        throw e;
      }
    }
    const nextCursor = str(r.nextCursor);
    const tangents = strs(r.tangents);
    return {
      ok: true,
      action,
      target,
      changed: null,
      readback: {
        id: str(r.id),
        className: str(r.className),
        closed: truthy(r.closed),
        total,
        points: strs(r.points),
        ...(tangents.length ? { tangents } : {}),
        ...(params.tesselated === true ? { tesselated: true } : {}),
        nextCursor: nextCursor || null,
      },
      next: nextCursor ? `More: resend with cursor "${nextCursor}".` : undefined,
      warnings: [],
    };
  }

  if (action === "create") return createOk(action, target, r);
  if (action === "edit") return editOk(action, target, r, str(params.op));

  // parallel
  const ids = strs(r.ids);
  const undoName = str(r.undoName);
  return {
    ok: true,
    action,
    target,
    changed: ids.map((id): Change => ({ path: id, before: null, after: "parallel copy" })),
    readback: { created: Number(r.created ?? ids.length), ids, undoName },
    next: undoName ? "Undo with wb_undo_redo." : undefined,
    warnings: [],
  };
}

export function registerWbShape(
  server: McpServer,
  client: WorkbenchClient,
  config?: Pick<Config, "projectPath">,
): void {
  server.registerTool(
    "wb_shape",
    { description: WB_SHAPE_DESCRIPTION, inputSchema: flatInputShape(SHAPE_CONTRACT) },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      const res = await runShape(client, input, { projectPath: config?.projectPath || undefined });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
