/**
 * `wb_terrain`: the terrain of the open world, read only, through EMCP_WB_Terrain
 * (wave W1, phase5-w1-spec.md section 2.5).
 *
 *   info     resolution, tiles, unit scale, bounds, surfaces; min/max height (minMax) and land
 *            area (landArea) on ask
 *   heights  terrain height at up to 200 "x z" points, with onTerrain per point
 *   tile     the height samples of one tile, paged (`cursor`, `limit`)
 *
 * OD-6 (DEC-061): the handler has one action surface. The 1.x names still work here and are
 * mapped in TypeScript (LEGACY_MAP):
 *
 *   getHeight  heights with one point "x z" (from x and z); the answer is one height
 *   getBounds  info; the answer is the bounds and their size
 *
 * Every check runs before anything is sent. Not registered here: src/server.ts registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  LIMIT_MAX,
  VocabularyError,
  parseCursor,
  type ActionError,
  type ActionOk,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Terrain";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

/** The whole handler contract, the 1.x terrain_* tools' actions included. */
export const TERRAIN_CONTRACT: Contract = loadContract(CONTRACT_FILE);

/**
 * Contract actions the 1.x extended tools terrain_inspect, terrain_navmesh_status and
 * terrain_road_export_graph send with their 1.x keys; wb_terrain does not offer them.
 */
export const OTHER_TOOL_ACTIONS: string[] = ["inspect", "navmesh_status", "road_export_graph"];

/** The contract as wb_terrain offers it: without OTHER_TOOL_ACTIONS. */
export const TOOL_CONTRACT: Contract = {
  ...TERRAIN_CONTRACT,
  actions: TERRAIN_CONTRACT.actions.filter((a) => !OTHER_TOOL_ACTIONS.includes(a.name)),
};
export const TERRAIN_REQUEST_SCHEMA = buildRequestSchema(TOOL_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbTerrainDescription(): string {
  return checkedDescription(TOOL_CONTRACT);
}

export const HANDLER_ACTIONS: readonly string[] = TOOL_CONTRACT.actions.map((a) => a.name);

/** 1.x action name to what this tool sends (OD-6). */
export const LEGACY_MAP: Readonly<Record<string, string>> = {
  getHeight: "heights",
  getBounds: "info",
};
/** LEGACY_MAP's keys, written out so the census (E11) reads them as literals. */
export const LEGACY_ACTIONS: string[] = ["getHeight", "getBounds"];

/** The handler's cap on points per heights call. */
export const MAX_POINTS = 200;
/** A coordinate beyond this is not a world position; refused before it is formatted. */
const COORD_MAX = 1e9;

const READ_TIMEOUT_MS = 30_000;
/** landArea walks the whole terrain. */
const LAND_AREA_TIMEOUT_MS = 120_000;

type Raw = Record<string, unknown>;

export type TerrainResponse = ActionOk | ActionError;

/** The client surface this tool needs (a fake in tests). */
export type TerrainClient = Pick<WorkbenchClient, "call">;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): ActionError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || ERROR_CODES[code],
    warnings: [],
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/** A coordinate as plain decimal text (no exponent), which the handler's ParseFloat reads. */
function coordText(n: number): string {
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(6) : s;
}

/** One "x z" point, or the reason it is not one. Returns the normalised text. */
export function checkPoint(text: string): { point: string } | { why: string } {
  const parts = text.replace(/,/g, " ").trim().split(/\s+/);
  if (parts.length !== 2 || parts.some((p) => p === "")) {
    return { why: `a point is "x z", got '${text}'` };
  }
  const nums = parts.map((p) =>
    /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(p) ? Number(p) : NaN,
  );
  if (nums.some((n) => !Number.isFinite(n) || Math.abs(n) > COORD_MAX)) {
    return { why: `a point is two finite numbers "x z", got '${text}'` };
  }
  return { point: `${coordText(nums[0]!)} ${coordText(nums[1]!)}` };
}

// ── Request checks ────────────────────────────────────────────────────────────

function targetOf(p: Raw): string {
  const index = typeof p.terrainIndex === "number" ? p.terrainIndex : 0;
  if (p.action === "tile" && typeof p.tileX === "number" && typeof p.tileY === "number") {
    return `terrain:${index}/tile:${p.tileX},${p.tileY}`;
  }
  return `terrain:${index}`;
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; params: Raw }
  | { ok: false; error: ActionError };

/** Validates a handler-surface request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const target = targetOf(raw);
  if (!HANDLER_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `unknown action '${action}'; one of ${[...HANDLER_ACTIONS, ...LEGACY_ACTIONS].join(", ")}`,
      ),
    };
  }
  const parsed = TERRAIN_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const bad = (why: string): Prepared => ({
    ok: false,
    error: fail(action, target, "INVALID_ARGUMENT", why),
  });

  for (const key of ["terrainIndex", "tileX", "tileY"]) {
    const v = req[key];
    if (v !== undefined && (typeof v !== "number" || v < 0)) return bad(`${key} must be 0 or more`);
  }
  const limit = req.limit;
  if (limit !== undefined && (typeof limit !== "number" || limit < 1 || limit > LIMIT_MAX)) {
    return bad(`limit must be 1 to ${LIMIT_MAX}`);
  }
  if (typeof req.cursor === "string" && req.cursor !== "") {
    try {
      parseCursor(req.cursor);
    } catch (e) {
      if (e instanceof VocabularyError) {
        return { ok: false, error: fail(action, target, e.code, e.message) };
      }
      throw e;
    }
  }
  const params: Raw = { ...req };
  if (action === "heights") {
    const points = req.points as string[];
    if (points.length === 0) return bad('points must hold at least one "x z"');
    if (points.length > MAX_POINTS) {
      return bad(`at most ${MAX_POINTS} points per call, got ${points.length}; split the points`);
    }
    const clean: string[] = [];
    for (const p of points) {
      const c = checkPoint(p);
      if ("why" in c) return bad(c.why);
      clean.push(c.point);
    }
    params.points = clean;
  }
  return { ok: true, action, target, params };
}

// ── Handler answer ────────────────────────────────────────────────────────────

function handlerFailure(action: string, target: string, r: Raw): ActionError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ErrorCode = status === "error" ? "ENGINE_FALSE" : "INVALID_ARGUMENT";
    const code = (KNOWN_CODES.has(raw) ? raw : fallback) as ErrorCode;
    const e = fail(
      action,
      target,
      code,
      str(r.message) || `the handler answered ${status}`,
      str(r.next) || undefined,
    );
    if (raw !== "" && !KNOWN_CODES.has(raw)) {
      e.warnings.push(`the handler answered an unknown code '${raw}'`);
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: TerrainClient,
  params: Raw,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: ActionError }> {
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: "read",
      timeout:
        params.landArea === true || params.minMax === true ? LAND_AREA_TIMEOUT_MS : READ_TIMEOUT_MS,
    });
    const f = handlerFailure(action, target, r);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    return { error: fail(action, target, c.code, c.message) };
  }
}

// ── Shaping ───────────────────────────────────────────────────────────────────

export interface HeightRow {
  x: number;
  z: number;
  onTerrain: boolean;
  /** null when the point is off the terrain (the handler's 0 is not a height). */
  y: number | null;
}

/** heights rows "x|z|onTerrain|y". */
export function parseHeightRows(rows: string[]): HeightRow[] {
  return rows.map((line) => {
    const c = line.split("|");
    const on = c[2] === "true";
    return { x: Number(c[0]), z: Number(c[1]), onTerrain: on, y: on ? Number(c[3]) : null };
  });
}

/** "x y z" text to numbers, or null when it is not three finite numbers. */
function vec3(text: string): [number, number, number] | null {
  const p = text.trim().split(/\s+/).map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return null;
  return [p[0]!, p[1]!, p[2]!];
}

function infoReadback(r: Raw, asked: boolean, minMaxAsked: boolean): Raw {
  const min = str(r.boundsMin);
  const max = str(r.boundsMax);
  const a = vec3(min);
  const b = vec3(max);
  return {
    hasTerrain: truthy(r.hasTerrain),
    resolution: { x: num(r.resolutionX), y: num(r.resolutionY) },
    tiles: { x: num(r.tilesX), y: num(r.tilesY) },
    unitScale: num(r.unitScale),
    bounds: {
      min,
      max,
      sizeX: a && b ? b[0] - a[0] : null,
      sizeZ: a && b ? b[2] - a[2] : null,
    },
    // The handler computes them only with minMax; its 0 otherwise is not a height.
    minY: minMaxAsked ? num(r.minY) : null,
    maxY: minMaxAsked ? num(r.maxY) : null,
    landArea: asked ? num(r.landArea) : null,
    surfaces: strs(r.surfaces),
  };
}

function shapeOk(action: string, target: string, params: Raw, r: Raw): ActionOk {
  const warnings: string[] = [];
  let readback: Raw;
  let next: string | undefined;
  switch (action) {
    case "info":
      readback = infoReadback(r, params.landArea === true, params.minMax === true);
      break;
    case "heights": {
      const rows = parseHeightRows(strs(r.rows));
      readback = { points: rows, onTerrain: rows.filter((x) => x.onTerrain).length };
      if (rows.some((x) => !x.onTerrain)) warnings.push("some points are off the terrain (y null)");
      break;
    }
    default: {
      // tile
      const cursor = str(r.nextCursor);
      const total = num(r.total) ?? 0;
      const start =
        typeof params.cursor === "string" && params.cursor ? parseCursor(params.cursor).start : 0;
      const samples = strs(r.rows).map(Number);
      readback = {
        tile: { x: params.tileX, y: params.tileY },
        sampleCount: num(r.sampleCount),
        total,
        first: start,
        samples,
        nextCursor: cursor || null,
      };
      if (cursor) next = `wb_terrain tile with cursor "${cursor}" for the next page`;
    }
  }
  const ok: ActionOk = { ok: true, action, target, changed: null, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── 1.x names ─────────────────────────────────────────────────────────────────

const LEGACY_SCHEMAS: Record<string, z.ZodTypeAny> = {
  getHeight: z
    .object({
      action: z.literal("getHeight"),
      x: z.number().finite(),
      z: z.number().finite(),
    })
    .strict(),
  getBounds: z.object({ action: z.literal("getBounds") }).strict(),
};

async function runLegacy(client: TerrainClient, input: Raw): Promise<TerrainResponse> {
  const action = str(input.action);
  const parsed = LEGACY_SCHEMAS[action]!.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    const needsXz =
      action === "getHeight" && (input.x === undefined || input.z === undefined)
        ? "; getHeight needs x and z"
        : "";
    return fail(action, "terrain:0", "INVALID_ARGUMENT", issues.join("; ") + needsXz);
  }
  const warn = `1.x action name '${action}': sent as ${LEGACY_MAP[action]} (OD-6); the handler has one action surface`;

  if (action === "getBounds") {
    const res = await runTerrain(client, { action: "info" });
    if (!res.ok) return { ...res, action };
    return { ...res, action, warnings: [warn, ...res.warnings] };
  }

  const p = parsed.data as { x: number; z: number };
  if (Math.abs(p.x) > COORD_MAX || Math.abs(p.z) > COORD_MAX) {
    return fail(action, "terrain:0", "INVALID_ARGUMENT", "x and z must be world coordinates");
  }
  const res = await runTerrain(client, {
    action: "heights",
    points: [`${coordText(p.x)} ${coordText(p.z)}`],
  });
  if (!res.ok) return { ...res, action };
  const row = (res.readback as { points: HeightRow[] }).points[0];
  if (!row) {
    return fail(action, "terrain:0", "HANDLER_ERROR", "the handler answered no row for the point");
  }
  // A point off the terrain has no height: never read it as 0.
  const warnings = [warn, ...res.warnings];
  return {
    ok: true,
    action,
    target: res.target,
    changed: null,
    readback: { x: p.x, z: p.z, onTerrain: row.onTerrain, height: row.y },
    ...(row.onTerrain
      ? {}
      : { next: "the point is off the terrain; wb_terrain info gives the bounds" }),
    warnings,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_terrain request end to end; never throws for a Workbench-side failure. */
export async function runTerrain(client: TerrainClient, input: unknown): Promise<TerrainResponse> {
  const raw = (input ?? {}) as Raw;
  if (LEGACY_ACTIONS.includes(str(raw.action))) return runLegacy(client, raw);
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, params } = prepared;
  const s = await send(client, params, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: TerrainResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = TOOL_CONTRACT): z.ZodRawShape {
  const names = [...c.actions.map((a) => a.name), ...LEGACY_ACTIONS] as [string, ...string[]];
  const shape: z.ZodRawShape = {
    action: z.enum(names).describe(`1.x names still accepted: ${LEGACY_ACTIONS.join(", ")}`),
  };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else if (p.type === "array<string>") s = z.array(z.string());
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  shape.x = z.number().optional().describe("1.x getHeight: world X");
  shape.z = z.number().optional().describe("1.x getHeight: world Z");
  return shape;
}

export function registerWbTerrain(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_terrain",
    {
      description: wbTerrainDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "World Editor terrain",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runTerrain(client, input));
    },
  );
}
