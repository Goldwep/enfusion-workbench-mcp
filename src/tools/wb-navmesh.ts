/**
 * `wb_navmesh`: the navmesh of the open World Editor world through its AIWorld, via
 * EMCP_WB_Navmesh (wave W5, phase5-w5-spec.md section 2.3, DEC-068).
 *
 *   status         read, paged: the navmesh projects, the AIWorld and a tile-state grid
 *                  (`step`, `cursor`, `limit`); a cursor of a changed grid is STALE_CURSOR
 *   tile           read: loaded, valid and requested at one position
 *   load           memory: ask the engine to load the tile at a position
 *   reachable      read: the nearest navmesh point within a distance of a position
 *   rebuild        memory: request a rebuild of a box (dry run unless confirm; at most 512 m a side)
 *   rebuildEntity  memory: request a rebuild of an entity's areas (dry run unless confirm)
 *
 * Nothing is saved: a rebuild changes the navmesh in memory only, and saving stays the World
 * Editor Navmesh Tool. `status` is the target of the `terrain_navmesh_status` alias
 * (src/manifest/aliases.ts), so its request keys (project, step, cursor, limit) stay as they are.
 *
 * Floats and vectors travel as text: `step` and `distance` may be given as numbers or as text and
 * are sent as text; positions and box corners are "x y z". The request is checked against the
 * contract's per-action schema and the handler's bounds before anything is sent. Nothing here
 * names a sandbox or a project.
 *
 * The W5 codes it answers (NO_AI_WORLD, NO_NAVMESH_COMPONENT, NOT_SCR_AI_WORLD, BOX_TOO_LARGE) are
 * vocabulary codes. src/server.ts registers `registerWbNavmesh`.
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
  checkCursor,
  parseCursor,
  parseEntityRef,
  printEntityRef,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { formatFloat } from "./wb-anim.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Navmesh";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const NAVMESH_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const NAVMESH_REQUEST_SCHEMA = buildRequestSchema(NAVMESH_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbNavmeshDescription(): string {
  return checkedDescription(NAVMESH_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = NAVMESH_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(NAVMESH_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));
/** Actions that take `confirm` (a dry run until it is true). */
const CONFIRMED = new Set(
  NAVMESH_CONTRACT.actions
    .filter((a) => a.params.some((p) => p.key === "confirm"))
    .map((a) => a.name),
);

const READ_TIMEOUT_MS = 30_000;
/**
 * Probe P-W5-15 was KILLED in W5 run 1 with no observable change (tile state and files the same
 * after a confirmed rebuild and rebuildEntity on the throwaway world). Its repoint for that case:
 * rebuild stays, with a weak oracle and this warning on every confirmed request (fix-up 1).
 */
export const REBUILD_WEAK_ORACLE =
  "weak oracle (probe P-W5-15): a confirmed request showed no observable change in W5 run 1 (tile state and files the same after it); the rebuild is requested, not confirmed";

/** A grid page reads up to 200 tiles; a load or rebuild call can take longer. */
const WRITE_TIMEOUT_MS = 60_000;

/** The handler's bounds (EMCP_WB_Navmesh.c). */
export const BOX_MAX = 512;
export const REACH_MAX = 500;
export const STEP_MIN = 1;
/** Request keys whose floats travel as text. */
export const FLOAT_TEXT_KEYS = ["step", "distance"] as const;

// ── Codes ─────────────────────────────────────────────────────────────────────

export type NavmeshCode = ErrorCode;

const NEXT_OF: Record<string, string> = ERROR_CODES;
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(NEXT_OF));

type Raw = Record<string, unknown>;

export interface NavmeshError {
  ok: false;
  action: string;
  target: string;
  code: NavmeshCode;
  message: string;
  next: string;
  warnings: string[];
}

export interface NavmeshOk {
  ok: true;
  action: string;
  target: string;
  changed: Change[] | null;
  readback: unknown;
  next?: string;
  warnings: string[];
}

export type NavmeshResponse = NavmeshOk | NavmeshError;

/** The client surface this tool needs (a fake in tests). */
export type NavmeshClient = Pick<WorkbenchClient, "call">;

function fail(
  action: string,
  target: string,
  code: NavmeshCode,
  message: string,
  next?: string,
): NavmeshError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || NEXT_OF[code] || "",
    warnings: [],
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ── Request checks ────────────────────────────────────────────────────────────

const FLOAT_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseFloatText(text: string): number | undefined {
  const t = text.trim();
  if (!FLOAT_TEXT.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** "x y z" (commas allowed) as three numbers, or a refusal sentence naming `key`. */
export function parseVector(key: string, text: string): [number, number, number] | string {
  const parts = text
    .replace(/,/g, " ")
    .split(" ")
    .filter((p) => p !== "");
  const nums = parts.map(parseFloatText);
  if (parts.length !== 3 || nums.some((n) => n === undefined)) {
    return `${key} must be three numbers as "x y z", got '${text}'`;
  }
  return nums as [number, number, number];
}

/** Per-action rules the contract's types cannot say; a refusal {code, why}, or undefined. */
function checkValues(action: string, p: Raw): { code: NavmeshCode; why: string } | undefined {
  const bad = (why: string) => ({ code: "INVALID_ARGUMENT" as NavmeshCode, why });
  if (typeof p.project === "string" && p.project.trim() === "") {
    return bad("project is empty: omit it for the AIWorld's first project (status lists them)");
  }
  if (action === "status") {
    if (
      p.limit !== undefined &&
      (typeof p.limit !== "number" || p.limit < 1 || p.limit > LIMIT_MAX)
    ) {
      return bad(`limit must be 1 to ${LIMIT_MAX}`);
    }
    if (p.step !== undefined) {
      const s = parseFloatText(str(p.step));
      if (s === undefined || s < STEP_MIN) {
        return bad(`step must be a number of metres of at least ${STEP_MIN}, got '${str(p.step)}'`);
      }
    }
    return undefined;
  }
  if (action === "tile" || action === "load" || action === "reachable") {
    const v = parseVector("position", str(p.position));
    if (typeof v === "string") return bad(v);
  }
  if (action === "reachable") {
    const d = parseFloatText(str(p.distance));
    if (d === undefined || d <= 0 || d > REACH_MAX) {
      return bad(
        `distance must be a number of metres above 0 and at most ${REACH_MAX}, got '${str(p.distance)}'`,
      );
    }
  }
  if (action === "rebuild") {
    const lo = parseVector("min", str(p.min));
    if (typeof lo === "string") return bad(lo);
    const hi = parseVector("max", str(p.max));
    if (typeof hi === "string") return bad(hi);
    if (hi[0] <= lo[0] || hi[2] <= lo[2] || hi[1] < lo[1]) {
      return bad(
        "max must be above min on x and z and not below it on y: pass the box's low corner as min and its high corner as max",
      );
    }
    for (let k = 0; k < 3; k++) {
      const side = hi[k] - lo[k];
      if (side > BOX_MAX) {
        return {
          code: "BOX_TOO_LARGE",
          why: `the box is ${side} m on axis ${k}, above ${BOX_MAX} m per side; nothing was sent`,
        };
      }
    }
  }
  return undefined;
}

function targetOf(p: Raw): string {
  const entity = str(p.entity);
  return entity ? `entity:${entity}` : "open:WorldEditor";
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: NavmeshError };

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = { ...((input ?? {}) as Raw) };
  const action = str(raw.action);
  let target = targetOf(raw);
  if (!HANDLER_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `unknown action '${action}'; one of ${HANDLER_ACTIONS.join(", ")}`,
      ),
    };
  }
  // Floats travel as text: a number is turned into its text before the contract sees it.
  for (const key of FLOAT_TEXT_KEYS) {
    const v = raw[key];
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Math.abs(v) >= 1e21) {
        return {
          ok: false,
          error: fail(action, target, "INVALID_ARGUMENT", `${key} must be a finite number`),
        };
      }
      // Plain decimal text, never an exponent (review round 1, W5-03).
      raw[key] = formatFloat(v);
    }
  }
  const parsed = NAVMESH_REQUEST_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const params: Raw = { ...req };
  try {
    if (action === "rebuildEntity") {
      const ref = printEntityRef(parseEntityRef(str(req.entity)));
      params.entity = ref;
      target = `entity:${ref}`;
    }
    if (typeof req.cursor === "string" && req.cursor !== "") parseCursor(req.cursor);
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const refusal = checkValues(action, params);
  if (refusal) return { ok: false, error: fail(action, target, refusal.code, refusal.why) };
  const mutating = MUTATING.has(action);
  // rebuild and rebuildEntity are a dry run unless confirm is true: send the flag explicitly.
  if (CONFIRMED.has(action)) params.confirm = req.confirm === true;
  return { ok: true, action, target, mutating, params };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a NavmeshError, else null. */
function handlerFailure(action: string, target: string, r: Raw): NavmeshError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ErrorCode = status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT";
    const code = (KNOWN_CODES.has(raw) ? raw : fallback) as NavmeshCode;
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

const LOST_NEXT: Record<string, string> = {
  load: "The call was lost and is never retried; read the tile back with wb_navmesh tile before sending load again.",
  rebuild:
    "The call was lost and is never retried; a rebuild request is in memory only and cannot be read back, so check wb_navmesh status before asking again.",
  rebuildEntity:
    "The call was lost and is never retried; a rebuild request is in memory only and cannot be read back, so check wb_navmesh status before asking again.",
};

async function send(
  client: NavmeshClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: NavmeshError }> {
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: mutating ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS,
    });
    const f = handlerFailure(action, target, r);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating && LOST_NEXT[action]) f.next = LOST_NEXT[action];
    return { error: f };
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

export interface TileRow {
  x: number;
  z: number;
  loaded: boolean;
  valid: boolean;
  requested: boolean;
}

/** status rows are "x|z|loaded|valid|requested" with 1/0 flags; one object per grid point. */
export function parseTileRows(rows: string[]): { rows: TileRow[]; bad: number } {
  const out: TileRow[] = [];
  let bad = 0;
  for (const line of rows) {
    const c = line.split("|");
    const x = Number(c[0]);
    const z = Number(c[1]);
    if (
      c.length !== 5 ||
      c[0] === "" ||
      c[1] === "" ||
      !Number.isFinite(x) ||
      !Number.isFinite(z)
    ) {
      bad++;
      continue;
    }
    out.push({ x, z, loaded: c[2] === "1", valid: c[3] === "1", requested: c[4] === "1" });
  }
  return { rows: out, bad };
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(action: string, target: string, params: Raw, r: Raw): NavmeshOk {
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  const message = str(r.message);
  switch (action) {
    case "status": {
      const parsed = parseTileRows(strs(r.rows));
      if (parsed.bad > 0) {
        warnings.push(`${parsed.bad} grid row(s) did not parse and are dropped`);
      }
      const cursor = str(r.nextCursor);
      readback = {
        aiWorld: str(r.aiWorld) || null,
        aiWorldClass: str(r.aiWorldClass),
        aiWorldFrom: str(r.aiWorldFrom),
        project: str(r.project) || null,
        projects: strs(r.projects),
        component: truthy(r.component),
        boundsMin: str(r.boundsMin) || null,
        boundsMax: str(r.boundsMax) || null,
        step: str(r.step) || null,
        total: num(r.total) ?? 0,
        count: num(r.count) ?? parsed.rows.length,
        rows: parsed.rows,
        nextCursor: cursor || null,
        message,
      };
      if (cursor) next = `wb_navmesh status with cursor "${cursor}" for the next page`;
      else if (!truthy(r.component)) {
        next = "Add a NavmeshWorldComponent with a NavmeshProject to the AIWorld to get a grid.";
      } else next = "wb_navmesh tile reads one position; load asks the engine to load it.";
      break;
    }
    case "tile": {
      readback = {
        position: str(r.position),
        loaded: truthy(r.loaded),
        valid: truthy(r.valid),
        requested: truthy(r.requested),
        message,
      };
      next = "wb_navmesh load asks the engine to load this tile (in memory).";
      break;
    }
    case "load": {
      const requested = truthy(r.requested);
      const loaded = truthy(r.loaded);
      readback = { position: str(r.position), requested, loaded, message };
      if (!requested) warnings.push("the engine refused the load: the tile cannot be loaded");
      else if (!loaded) warnings.push("a load can take many frames: read wb_navmesh tile again");
      next = "In memory only; wb_navmesh tile reads the state back.";
      break;
    }
    case "reachable": {
      const found = truthy(r.found);
      const point = str(r.point);
      readback = { position: str(r.position), found, point: point || null, message };
      if (found && point === "") {
        warnings.push("the engine found a point but it was not written back; only found is known");
      }
      break;
    }
    case "rebuild": {
      const dry = truthy(r.dryRun);
      const requested = truthy(r.requested);
      readback = {
        dryRun: dry,
        min: str(r.min) || str(params.min),
        max: str(r.max) || str(params.max),
        requested,
        message,
      };
      if (dry) {
        next = "Resend with confirm: true to request the rebuild (in memory, nothing is saved).";
      } else {
        changed = [];
        next =
          "The request returns nothing, so it is not confirmed: read wb_navmesh status or tile. Nothing is saved; saving stays in the World Editor Navmesh Tool.";
        if (!requested) warnings.push("the handler did not report the rebuild requested");
        else warnings.push(REBUILD_WEAK_ORACLE);
      }
      break;
    }
    case "rebuildEntity": {
      const dry = truthy(r.dryRun);
      const requested = truthy(r.requested);
      const areas = num(r.areas) ?? 0;
      readback = { dryRun: dry, entity: str(r.entity), areas, requested, message };
      if (dry) {
        next = "Resend with confirm: true to request the rebuild (in memory, nothing is saved).";
      } else {
        changed = [];
        next =
          "The request returns nothing, so it is not confirmed: read wb_navmesh status or tile. Nothing is saved.";
        if (areas === 0) warnings.push("the entity gives no rebuild areas: nothing was requested");
        else if (!requested) warnings.push("the handler did not report the rebuild requested");
        else warnings.push(REBUILD_WEAK_ORACLE);
      }
      break;
    }
    default:
      readback = { ...r };
  }
  const ok: NavmeshOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_navmesh request end to end; never throws for a Workbench-side failure. */
export async function runNavmesh(client: NavmeshClient, input: unknown): Promise<NavmeshResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  if (action === "status" && typeof params.cursor === "string" && params.cursor !== "") {
    // The handler checks the cursor against its grid; this is the same check on the answer.
    const total = num(s.r.total);
    if (total !== null) {
      try {
        checkCursor(parseCursor(params.cursor), total);
      } catch (e) {
        if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
        throw e;
      }
    }
  }
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: NavmeshResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = NAVMESH_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else if ((FLOAT_TEXT_KEYS as readonly string[]).includes(p.key)) {
        // A float given as text or as a number; sent as text.
        s = z.union([z.string(), z.number()]);
      } else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

export function registerWbNavmesh(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_navmesh",
    {
      description: wbNavmeshDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "World navmesh",
        readOnlyHint: false,
        // load, rebuild and rebuildEntity change the navmesh in memory only; nothing is saved,
        // and rebuild and rebuildEntity are a dry run until confirm.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runNavmesh(client, input));
    },
  );
}
