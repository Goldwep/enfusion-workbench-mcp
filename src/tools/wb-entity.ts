import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
  parseCursor,
  parseEntityRef,
  printEntityRef,
  type ActionOk,
  type Change,
} from "../manifest/vocabulary.js";
import type { WorkbenchClient } from "../workbench/client.js";
import type { Contract } from "../manifest/contract.js";

/**
 * wb_entity: the entities of the open world through EMCP_WB_Entity (wave W1, spec section 2.1).
 * The schema and the description come from contracts/EMCP_WB_Entity.json; entity references,
 * cursors, vectors and counts are checked here before anything is sent. Every mutating action is
 * an in-memory World Editor edit that the handler wraps in one undo step (OD-3, DEC-061): there is
 * no confirm and no dry run, and nothing here names a sandbox or a project (DEC-058).
 */

export const HANDLER = "EMCP_WB_Entity";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const ENTITY_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const ENTITY_REQUEST_SCHEMA = buildRequestSchema(ENTITY_CONTRACT);
export const WB_ENTITY_DESCRIPTION = checkedDescription(ENTITY_CONTRACT);

/** The handler's cap on one entities list (EMCP_WB_Entity.MAX_REFS). */
export const MAX_REFS = 200;
/** Float inputs sent to the handler as text (its fields are strings it parses). */
export const FLOAT_WIRE_KEYS = ["radius", "scale"] as const;
/** The handler's cap on what one world query collects (EMCP_WB_Entity.MAX_QUERY). */
export const MAX_QUERY = 20_000;
export const READ_TIMEOUT_MS = 30_000;
/** Target shown for an action that names no single entity. */
export const WORLD_TARGET = "open:WorldEditor";

/** Columns of a list, children or query row, as the handler's Row(). */
export const ROW_COLUMNS = ["id", "name", "class", "parent", "layer", "sub", "kids"] as const;

export interface EntityError {
  ok: false;
  action: string;
  target: string;
  /** A vocabulary code or a kernel code (LOST, MODAL_OPEN, WEDGED, ...). */
  code: string;
  message: string;
  next: string;
  warnings: string[];
  /** What the handler answered before it failed (a created id, a before/after pair, ...). */
  readback?: Record<string, unknown>;
}

export type EntityResponse = ActionOk | EntityError;

type Raw = Record<string, unknown>;

function fail(
  action: string,
  target: string,
  code: string,
  message: string,
  next?: string,
): EntityError {
  const fallback = (ERROR_CODES as Record<string, string>)[code] ?? "See the message.";
  return { ok: false, action, target, code, message, next: next || fallback, warnings: [] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2, 2026-10-10). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: EntityError };

/** Three finite numbers, space or comma separated, as the handler's ParseVectorString. */
function checkVector(key: string, text: string): string | undefined {
  const parts = text
    .replace(/,/g, " ")
    .split(" ")
    .filter((p) => p !== "");
  if (parts.length !== 3 || parts.some((p) => !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(p))) {
    return `${key} must be three numbers as "x y z", got '${text}'`;
  }
  return undefined;
}

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Parses one entity reference and returns its canonical form; refuses with INVALID_ARGUMENT. */
function canonicalRef(key: string, text: string): string {
  try {
    return printEntityRef(parseEntityRef(text));
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `${key}: ${e.message}`);
    throw e;
  }
}

/**
 * Validates one tool input against the contract's per-action schema and the shared vocabulary.
 * Nothing is sent when this refuses: INVALID_ARGUMENT for a malformed reference, cursor, vector or
 * count, and for a shape the contract does not allow.
 */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const parsed = ENTITY_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, WORLD_TARGET, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const contractAction = ENTITY_CONTRACT.actions.find((a) => a.name === action);
  const mutating = contractAction?.mutating ?? true;
  const params: Raw = { ...req };
  let target = WORLD_TARGET;

  try {
    // Entity references: each one is parsed and sent in its canonical form.
    for (const key of ["entity", "parent"]) {
      if (typeof req[key] === "string") params[key] = canonicalRef(key, req[key]);
    }
    if (typeof params.entity === "string") target = `entity:${params.entity}`;
    if (Array.isArray(req.entities)) {
      const list = req.entities as string[];
      if (list.length < 1) {
        throw new Refusal("INVALID_ARGUMENT", "entities must hold at least one entity reference");
      }
      if (list.length > MAX_REFS) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          `entities holds ${list.length} references, at most ${MAX_REFS}`,
        );
      }
      params.entities = list.map((r, i) => canonicalRef(`entities[${i}]`, r));
      if (action === "parent" && (params.entities as string[]).includes(String(params.parent))) {
        throw new Refusal("INVALID_ARGUMENT", "an entity cannot be its own parent");
      }
    }

    // Paging.
    if (typeof req.cursor === "string") {
      try {
        parseCursor(req.cursor);
      } catch (e) {
        if (e instanceof VocabularyError) throw new Refusal(e.code, e.message);
        throw e;
      }
    }
    if (typeof req.limit === "number" && (req.limit < 1 || req.limit > LIMIT_MAX)) {
      throw new Refusal("INVALID_ARGUMENT", `limit must be 1 to ${LIMIT_MAX}`);
    }
    if (typeof req.subScene === "number" && req.subScene < 0) {
      throw new Refusal(
        "INVALID_ARGUMENT",
        "subScene must be 0 or more; leave it out for the default",
      );
    }

    // Vectors and numbers.
    for (const key of ["coords", "angles", "center", "mins", "maxs"]) {
      if (typeof req[key] === "string") {
        const bad = checkVector(key, req[key]);
        if (bad) throw new Refusal("INVALID_ARGUMENT", bad);
      }
    }
    if (typeof req.scale === "number" && !(req.scale > 0)) {
      throw new Refusal("INVALID_ARGUMENT", "scale must be above 0");
    }
    // Floats travel as text: a JSON integer never reaches a float field through RegV (W1 live run
    // 2026-11-11: radius 5 read as not given, scale 2 left unchanged). The handler parses them.
    for (const key of FLOAT_WIRE_KEYS) {
      if (typeof req[key] === "number") params[key] = String(req[key]);
    }

    // Per-action rules the contract's types cannot say.
    if (action === "query") {
      const sphere = req.center !== undefined || req.radius !== undefined;
      const box = req.mins !== undefined || req.maxs !== undefined;
      if (sphere === box) {
        throw new Refusal("INVALID_ARGUMENT", "give either center with radius, or mins with maxs");
      }
      if (sphere && (req.center === undefined || !(Number(req.radius) > 0))) {
        throw new Refusal("INVALID_ARGUMENT", "a sphere needs center and a radius above 0");
      }
      if (box && (req.mins === undefined || req.maxs === undefined)) {
        throw new Refusal("INVALID_ARGUMENT", "a box needs both mins and maxs");
      }
    }
    if (action === "create" && str(req.prefab).trim() === "") {
      throw new Refusal("INVALID_ARGUMENT", "prefab must be a class name or {GUID}path");
    }
    if (action === "rename" && str(req.name) === "") {
      throw new Refusal("INVALID_ARGUMENT", "name must not be empty");
    }
    if (action === "setLayer" && str(req.layer) === "") {
      throw new Refusal("INVALID_ARGUMENT", "layer must be a layer path (wb_layers list)");
    }
    if (
      action === "transform" &&
      req.coords === undefined &&
      req.angles === undefined &&
      req.scale === undefined
    ) {
      throw new Refusal("INVALID_ARGUMENT", "give coords, angles or scale");
    }
  } catch (e) {
    if (e instanceof Refusal) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  return { ok: true, action, target, mutating, params };
}

export interface EntityRow {
  id: string;
  name: string;
  class: string;
  parent: string;
  layer: string;
  sub: number;
  kids: number;
}

/**
 * One "id|name|class|parent|layer|sub|kids" row to an object, or undefined when it does not have
 * the seven cells (a name with a pipe cannot be told from a cell break).
 */
export function parseRow(row: string): EntityRow | undefined {
  const cells = row.split("|");
  if (cells.length !== ROW_COLUMNS.length) return undefined;
  return {
    id: cells[0],
    name: cells[1],
    class: cells[2],
    parent: cells[3],
    layer: cells[4],
    sub: Number(cells[5]),
    kids: Number(cells[6]),
  };
}

/** The rows as objects; a row that does not parse is kept as {raw}. */
export function rowsToObjects(rows: string[]): Array<EntityRow | { raw: string }> {
  return rows.map((r) => parseRow(r) ?? { raw: r });
}

/** A handler answer that is not ok, as the error shape (the handler's code and next win). */
function handlerFailure(action: string, target: string, r: Raw): EntityError {
  const code = str(r.code) || "HANDLER_ERROR";
  const message = str(r.message) || `${HANDLER} answered ${str(r.status) || "no status"}`;
  const error = fail(action, target, code, message, str(r.next));
  const partial = partialReadback(r);
  if (Object.keys(partial).length) error.readback = partial;
  return error;
}

/** The keys a failed mutating call may have filled before it failed. */
function partialReadback(r: Raw): Raw {
  const out: Raw = {};
  for (const k of ["id", "name", "className", "parentId", "layer", "before", "after", "undoName"]) {
    if (str(r[k]) !== "") out[k] = r[k];
  }
  for (const k of ["deleted", "missing", "parented", "unparented", "moved"]) {
    const list = strs(r[k]);
    if (list.length) out[k] = list;
  }
  return out;
}

function isOk(r: Raw): boolean {
  return str(r.status) === "ok";
}

/** `coords|angles|scale` of the handler's before/after, or undefined when it does not split in 3. */
function splitTransform(text: string): [string, string, string] | undefined {
  const cells = text.split("|");
  return cells.length === 3 ? [cells[0], cells[1], cells[2]] : undefined;
}

/** Runs one wb_entity request end to end; never throws for a Workbench-side failure. */
export async function runEntity(client: WorkbenchClient, input: unknown): Promise<EntityResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;

  let r: Raw;
  try {
    r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: READ_TIMEOUT_MS,
    });
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
      return fail(action, target, e.code, e.message, next);
    }
    throw e;
  }
  if (!isOk(r)) return handlerFailure(action, target, r);

  const warnings: string[] = [];
  const base = { ok: true as const, action, target, warnings };
  const missing = strs(r.missing);
  if (missing.length) {
    warnings.push(
      `${missing.length} reference(s) named no entity and were skipped: ${missing.join(", ")}`,
    );
  }
  const undoName = str(r.undoName);
  const undoNext = undoName ? "Undo with wb_undo_redo." : undefined;

  if (action === "list" || action === "children" || action === "query") {
    const total = Number(r.total ?? 0);
    if (typeof params.cursor === "string") {
      try {
        checkCursor(parseCursor(params.cursor), total);
      } catch (e) {
        if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
        throw e;
      }
    }
    const rows = strs(r.rows);
    const nextCursor = str(r.nextCursor);
    if (action === "query" && total >= MAX_QUERY) {
      warnings.push(`the query stopped at ${MAX_QUERY} entities; narrow the shape`);
    }
    return {
      ...base,
      changed: null,
      readback: { total, rows: rowsToObjects(rows), nextCursor: nextCursor || null },
      next: nextCursor ? `More: resend with cursor "${nextCursor}".` : undefined,
    };
  }

  if (action === "get") {
    return {
      ...base,
      changed: null,
      readback: {
        id: str(r.id),
        name: str(r.name),
        niceName: str(r.niceName),
        className: str(r.className),
        ancestor: str(r.ancestor) || null,
        parentId: str(r.parentId) || null,
        parentName: str(r.parentName) || null,
        idText: str(r.idText),
        runtimeIdText: str(r.runtimeIdText),
        layer: str(r.layer),
        subScene: Number(r.subScene ?? 0),
        coords: str(r.coords),
        angles: str(r.angles),
        visible: truthy(r.visible),
        selected: truthy(r.selected),
        childCount: Number(r.childCount ?? 0),
        components: strs(r.components).map((c) => {
          const at = c.indexOf("|");
          return at < 0
            ? { index: Number.NaN, class: c }
            : { index: Number(c.slice(0, at)), class: c.slice(at + 1) };
        }),
      },
    };
  }

  const id = str(r.id);

  if (action === "create") {
    return {
      ...base,
      changed: [{ path: id, before: null, after: str(r.className) }],
      readback: {
        id,
        name: str(r.name),
        className: str(r.className),
        parentId: str(r.parentId) || null,
        parentName: str(r.parentName) || null,
        layer: str(r.layer),
        undoName,
      },
      next: undoNext,
    };
  }

  if (action === "clone") {
    return {
      ...base,
      changed: [{ path: id, before: null, after: str(r.name) }],
      readback: { id, name: str(r.name), childCount: Number(r.childCount ?? 0), undoName },
      next: undoNext,
    };
  }

  if (action === "delete") {
    const deleted = strs(r.deleted);
    return {
      ...base,
      changed: deleted.map((d): Change => ({ path: d, before: "present", after: null })),
      readback: { deleted, missing, undoName },
      next: undoNext,
    };
  }

  if (action === "parent") {
    const parented = strs(r.parented);
    const parent = str(params.parent);
    return {
      ...base,
      changed: parented.map((p): Change => ({ path: p, before: null, after: `parent ${parent}` })),
      readback: { parent, parented, missing, undoName },
      next: undoNext,
    };
  }

  if (action === "unparent") {
    const unparented = strs(r.unparented);
    return {
      ...base,
      changed: unparented.map((u): Change => ({ path: u, before: "parented", after: null })),
      readback: { unparented, missing, undoName },
      next: undoNext,
    };
  }

  if (action === "rename") {
    const before = str(r.before);
    const after = str(r.after);
    return {
      ...base,
      changed: before === after ? [] : [{ path: id, before, after }],
      readback: { id, name: after, undoName },
      next: undoNext,
    };
  }

  if (action === "transform") {
    const before = splitTransform(str(r.before));
    const after = splitTransform(str(r.after));
    const changed: Change[] = [];
    if (before && after) {
      const keys = ["coords", "angles", "scale"] as const;
      keys.forEach((k, i) => {
        if (params[k] === undefined) return;
        if (before[i] === after[i]) warnings.push(`${k} is unchanged (${after[i]})`);
        else changed.push({ path: `${id}.${k}`, before: before[i], after: after[i] });
      });
    } else {
      warnings.push("the handler's before/after did not split into coords|angles|scale");
    }
    return {
      ...base,
      changed,
      readback: {
        id,
        before: str(r.before),
        after: str(r.after),
        coords: after?.[0],
        angles: after?.[1],
        scale: after ? Number(after[2]) : undefined,
        undoName,
      },
      next: undoNext,
    };
  }

  // setLayer
  const moved = strs(r.moved);
  const layer = str(r.layer);
  return {
    ...base,
    changed: moved.map((m): Change => ({ path: m, before: null, after: `layer ${layer}` })),
    readback: { moved, missing, layer, undoName },
    next: undoNext,
  };
}

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = ENTITY_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else if (p.type === "array<string>") s = z.array(z.string());
      else if (p.type === "array<int>") s = z.array(z.number().int());
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

export function registerWbEntity(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_entity",
    { description: WB_ENTITY_DESCRIPTION, inputSchema: flatInputShape() },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      const res = await runEntity(client, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
