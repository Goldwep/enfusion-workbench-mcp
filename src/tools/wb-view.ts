/**
 * `wb_view` - selection, visibility, camera and viewport of the World Editor, through
 * EMCP_WB_View (wave W1, phase5-w1-spec.md section 2.3; DEC-058, DEC-061).
 *
 *   selection     read: the selected entities, paged (cursor "<start>:<count>"), main member named
 *   select        mode set | add | remove | clear; the previous selection comes back to restore it
 *   setVisible    hide or show entities (undo point); recursive defaults to true Workbench-side
 *   camera        read: camera position, angles, look direction and viewport size
 *   setCamera     move the perspective camera ("x y z" position and look direction); view state
 *   focus         look at an entity from `distance` metres (default 10) along the current view
 *   trace         read: ray from a viewport pixel, hit point and entity
 *   underCursor   read: the mouse pixel and the entity under it
 *   placeAtPixel  create an entity at a viewport pixel (undo point)
 *
 * The request is checked against the zod union generated from contracts/EMCP_WB_View.json and
 * the shared vocabulary (entity references, cursors) before anything is sent; a refusal names a
 * vocabulary code. The handler has no dry run, so there is no `confirm`. Nothing here names a
 * project or a sandbox: the Workbench-side guard decides. Not registered here: src/server.ts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  LIMIT_MAX,
  VocabularyError,
  parseCursor,
  parseEntityRef,
  printEntityRef,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";

export const HANDLER = "EMCP_WB_View";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const VIEW_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const VIEW_REQUEST_SCHEMA = buildRequestSchema(VIEW_CONTRACT);
export const WB_VIEW_DESCRIPTION = checkedDescription(VIEW_CONTRACT);

export const VIEW_ACTIONS = VIEW_CONTRACT.actions.map((a) => a.name);
export const SELECT_MODES = ["set", "add", "remove", "clear"] as const;
/** The handler's per-call reference cap (EMCP_WB_ViewUtil.MAX_REFS). */
export const MAX_REFS = 200;
/** TraceFlags names the handler accepts (EMCP_WB_ViewUtil.ParseTraceFlags). */
export const TRACE_FLAGS = [
  "ENTS",
  "WORLD",
  "OCEAN",
  "VISIBILITY",
  "ANY_CONTACT",
  "DEFAULT",
] as const;
/** The page size the handler uses when no limit is sent (EMCP_WB_ViewUtil.PAGE_DEFAULT). */
export const PAGE_DEFAULT = 50;
export const CALL_TIMEOUT_MS = 30_000;
export const WORLD_EDITOR = "open:WorldEditor";
/** Columns of a selection row, as EMCP_WB_ViewUtil.EntityRow. */
export const ROW_COLUMNS = ["id", "name", "class", "parent", "layer", "sub", "kids"] as const;

export type ViewError = ActionError & { readback?: unknown };
export type ViewResponse = ActionOk | ViewError;
export type ViewClient = Pick<WorkbenchClient, "call">;

type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2, 2026-10-10). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): ViewError {
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

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

// -- Request ------------------------------------------------------------------------------------

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: ViewError };

function bad(action: string, target: string, message: string, next?: string): Prepared {
  return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", message, next) };
}

/** "x y z": three finite numbers separated by white space. Returns the tokens, or why not. */
function parseVector(text: string): { tokens: string[] } | { why: string } {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length !== 3) return { why: `must be three numbers "x y z", got "${text}"` };
  for (const t of tokens) {
    if (t === "" || !Number.isFinite(Number(t))) return { why: `"${t}" is not a number` };
  }
  return { tokens };
}

/** Entity reference list, each checked and printed in the canonical form. */
function checkRefs(
  action: string,
  refs: string[],
): { refs: string[] } | { error: Prepared & { ok: false } } {
  if (refs.length > MAX_REFS) {
    return {
      error: bad(
        action,
        WORLD_EDITOR,
        `at most ${MAX_REFS} entity references per call`,
      ) as Prepared & {
        ok: false;
      },
    };
  }
  const out: string[] = [];
  for (const r of refs) {
    try {
      out.push(printEntityRef(parseEntityRef(r)));
    } catch (e) {
      if (e instanceof VocabularyError) {
        return {
          error: {
            ok: false,
            error: fail(action, WORLD_EDITOR, e.code as ErrorCode, e.message),
          },
        };
      }
      throw e;
    }
  }
  return { refs: out };
}

/**
 * Validates one tool input against the contract's per-action schema and the shared vocabulary.
 * Nothing is sent when this refuses.
 */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const parsed = VIEW_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return bad(action, WORLD_EDITOR, issues.join("; "));
  }
  const req = parsed.data as Raw;
  const contractAction = VIEW_CONTRACT.actions.find((a) => a.name === action);
  const mutating = contractAction?.mutating ?? true;
  const params: Raw = { ...req };
  let target = WORLD_EDITOR;

  switch (action) {
    case "selection": {
      if (req.limit !== undefined) {
        const limit = req.limit as number;
        if (limit < 1 || limit > LIMIT_MAX) {
          return bad(action, target, `limit must be 1 to ${LIMIT_MAX}`);
        }
      }
      if (req.cursor !== undefined) {
        try {
          parseCursor(req.cursor as string);
        } catch (e) {
          if (e instanceof VocabularyError) {
            return { ok: false, error: fail(action, target, e.code as ErrorCode, e.message) };
          }
          throw e;
        }
      }
      break;
    }
    case "select": {
      const mode = req.mode as string;
      if (!(SELECT_MODES as readonly string[]).includes(mode)) {
        return bad(action, target, `mode must be ${SELECT_MODES.join(", ")}, got "${mode}"`);
      }
      const refs = (req.entities as string[] | undefined) ?? [];
      if (mode === "clear") {
        if (refs.length > 0) return bad(action, target, "mode clear takes no entities");
        delete params.entities;
      } else {
        if (refs.length === 0) return bad(action, target, `mode ${mode} needs at least one entity`);
        const c = checkRefs(action, refs);
        if ("error" in c) return c.error;
        params.entities = c.refs;
      }
      break;
    }
    case "setVisible": {
      const refs = req.entities as string[];
      if (refs.length === 0) return bad(action, target, "setVisible needs at least one entity");
      const c = checkRefs(action, refs);
      if ("error" in c) return c.error;
      params.entities = c.refs;
      break;
    }
    case "setCamera": {
      for (const key of ["coords", "look"] as const) {
        const v = parseVector(req[key] as string);
        if ("why" in v) return bad(action, target, `${key} ${v.why}`);
        params[key] = v.tokens.join(" ");
        if (key === "look" && v.tokens.every((t) => Number(t) === 0)) {
          return bad(action, target, "look must not be the zero vector");
        }
      }
      break;
    }
    case "focus": {
      try {
        const ref = printEntityRef(parseEntityRef(req.entity as string));
        params.entity = ref;
        target = ref;
      } catch (e) {
        if (e instanceof VocabularyError) {
          return { ok: false, error: fail(action, target, e.code as ErrorCode, e.message) };
        }
        throw e;
      }
      if (req.distance !== undefined) {
        const d = req.distance as number;
        if (!Number.isFinite(d) || d < 0) {
          return bad(action, target, "distance must be a non-negative number of metres");
        }
        // Text on the wire: a JSON integer never reaches a float field through RegV (W1 live run
        // 2026-11-11: distance 8 read as 0); the handler parses it.
        params.distance = String(d);
      }
      break;
    }
    case "trace":
    case "placeAtPixel": {
      for (const key of ["x", "y"] as const) {
        if ((req[key] as number) < 0) return bad(action, target, `${key} must not be negative`);
      }
      if (action === "trace" && req.flags !== undefined) {
        const names = str(req.flags)
          .split(",")
          .map((s) => s.trim().toUpperCase());
        const unknown = names.filter((n) => !(TRACE_FLAGS as readonly string[]).includes(n));
        if (names.length === 0 || unknown.length > 0) {
          return bad(
            action,
            target,
            `unknown TraceFlags name ${unknown.map((u) => `"${u}"`).join(", ") || '""'}; use ${TRACE_FLAGS.join(", ")}`,
          );
        }
        params.flags = names.join(",");
      }
      if (action === "placeAtPixel") {
        if (str(req.prefab).trim() === "") return bad(action, target, "prefab is empty");
        if (req.window !== undefined && (req.window as number) < 0) {
          return bad(action, target, "window must not be negative");
        }
      }
      break;
    }
    default:
      break;
  }
  return { ok: true, action, target, mutating, params };
}

// -- Response -----------------------------------------------------------------------------------

/** A handler refusal or error as a ViewError (the handler's code, message and next win). */
function handlerFailure(action: string, target: string, r: Raw): ViewError {
  const status = str(r.status);
  const raw = str(r.code);
  const known = KNOWN_CODES.has(raw);
  const code = (
    known ? raw : status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT"
  ) as ErrorCode;
  const e = fail(
    action,
    target,
    code,
    str(r.message) || `${HANDLER} answered ${status || "no status"}${raw ? ` (${raw})` : ""}`,
    str(r.next) || undefined,
  );
  if (!known && raw) e.warnings.push(`the handler answered an unknown code '${raw}'`);
  // An error that still read something back (setVisible not reading back) keeps it.
  const changed = strs(r.changed);
  const readback: Raw = {};
  if (changed.length > 0) readback.changed = parseVisibleRows(changed);
  if (strs(r.missing).length > 0) readback.missing = strs(r.missing);
  if (str(r.undoName)) readback.undoName = str(r.undoName);
  if (Object.keys(readback).length > 0) e.readback = readback;
  return e;
}

/** One selection row "id|name|class|parent|layer|sub|kids" as an object. */
export function parseRow(row: string): Raw {
  const cells = row.split("|");
  return {
    id: cells[0] ?? "",
    name: cells[1] ?? "",
    class: cells[2] ?? "",
    parent: cells[3] || null,
    layer: Number(cells[4] ?? 0) || 0,
    sub: Number(cells[5] ?? 0) || 0,
    kids: Number(cells[6] ?? 0) || 0,
  };
}

/** setVisible `changed` cells "id|visibleAfter". */
function parseVisibleRows(cells: string[]): { id: string; visible: boolean }[] {
  return cells.map((c) => {
    const at = c.lastIndexOf("|");
    return { id: at >= 0 ? c.slice(0, at) : c, visible: at >= 0 && c.slice(at + 1) === "true" };
  });
}

/**
 * True when the handler's write made its own undo point. The handler refuses when
 * BeginEntityAction is false (review round 1, F2); an older handler carried on and said so only in
 * its message, so an answer without undoName or with that note promises no undo.
 */
function ownUndoPoint(r: Raw): boolean {
  return str(r.undoName) !== "" && !/no own undo point/.test(str(r.message));
}

const NO_UNDO_WARNING =
  "the handler made no undo point of its own (an edit action was already open): wb_undo_redo undo would revert another step";

function shapeOk(action: string, target: string, params: Raw, r: Raw): ViewResponse {
  const warnings: string[] = [];
  const base = { ok: true as const, action, target, warnings };
  const missing = strs(r.missing);
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} reference(s) did not name an editor entity: ${missing.join(", ")}`,
    );
  }

  switch (action) {
    case "selection": {
      const nextCursor = str(r.nextCursor);
      const rows = strs(r.rows).map(parseRow);
      const ok: ActionOk = {
        ...base,
        changed: null,
        readback: {
          total: num(r.total),
          returned: rows.length,
          mainId: str(r.mainId) || null,
          rows,
          nextCursor: nextCursor || null,
        },
      };
      if (nextCursor) {
        ok.next = `wb_view selection with cursor "${nextCursor}"${params.limit !== undefined ? ` and limit ${String(params.limit)}` : ""} for the next page`;
      }
      return ok;
    }
    case "select": {
      const previous = strs(r.previous);
      const count = num(r.selectedCount);
      if (previous.length >= MAX_REFS) {
        warnings.push(`previous holds at most ${MAX_REFS} ids; a larger selection is cut short`);
      }
      const ok: ActionOk = {
        ...base,
        changed: [{ path: "selection", before: previous, after: { count } }],
        readback: { mode: str(params.mode), selectedCount: count, previous, missing },
      };
      warnings.push(
        "selection is editor state: no undo point; restore it with the ids in previous",
      );
      if (previous.length > 0)
        ok.next =
          "wb_view select mode set with entities = readback.previous restores the old selection";
      return ok;
    }
    case "setVisible": {
      const rows = parseVisibleRows(strs(r.changed));
      const changed: Change[] = rows.map((x) => ({
        path: x.id,
        before: null,
        after: { visible: x.visible },
      }));
      warnings.push("before is unknown: the handler reads visibility after the change only");
      const undo = ownUndoPoint(r);
      if (!undo) warnings.push(NO_UNDO_WARNING);
      return {
        ...base,
        changed,
        readback: { visible: truthy(params.visible), rows, missing, undoName: str(r.undoName) },
        next: undo
          ? "wb_undo_redo undo reverts it, or send setVisible with the opposite visible"
          : "send setVisible with the opposite visible to revert it",
      };
    }
    case "camera":
      return {
        ...base,
        changed: null,
        readback: {
          coords: str(r.coords),
          angles: str(r.angles),
          direction: str(r.direction),
          screenWidth: num(r.screenWidth),
          screenHeight: num(r.screenHeight),
        },
      };
    case "setCamera": {
      warnings.push(
        "before is the old position only; the old look direction is not returned (read camera first to keep it). View state: no undo point",
      );
      return {
        ...base,
        changed: [{ path: "camera.position", before: str(r.before), after: str(r.after) }],
        readback: { requested: str(params.coords), look: str(params.look), after: str(r.after) },
        next: "wb_view setCamera with coords = changed[0].before restores the position",
      };
    }
    case "focus": {
      warnings.push("view state: no undo point; restore with setCamera to before");
      // The handler frames the entity's bounds when no distance is given (W1.7 run 6: a fixed 10 m
      // left a small prop invisible) and names the distance it used in its message.
      const used = /from distance ([0-9.]+) m/.exec(str(r.message));
      const distance = used
        ? Number(used[1])
        : params.distance !== undefined
          ? Number(params.distance)
          : null;
      return {
        ...base,
        changed: [{ path: "camera.position", before: str(r.before) || null, after: str(r.after) }],
        readback: { id: str(r.id), before: str(r.before) || null, after: str(r.after), distance },
      };
    }
    case "trace":
      return {
        ...base,
        changed: null,
        readback: {
          hit: truthy(r.hit),
          start: str(r.start),
          end: str(r.end),
          direction: str(r.direction),
          entity: str(r.id) || null,
        },
      };
    case "underCursor":
      return {
        ...base,
        changed: null,
        readback: { x: num(r.x), y: num(r.y), entity: str(r.id) || null },
      };
    case "placeAtPixel": {
      const undo = ownUndoPoint(r);
      if (!undo) warnings.push(NO_UNDO_WARNING);
      return {
        ...base,
        changed: [{ path: str(r.id), before: null, after: "created" }],
        readback: { id: str(r.id), coords: str(r.coords), undoName: str(r.undoName) },
        next: undo
          ? "wb_undo_redo undo removes it; wb_entity get reads it back"
          : `wb_entity delete with entities ["${str(r.id)}"] removes it; wb_entity get reads it back`,
      };
    }
    default:
      return { ...base, changed: null, readback: r };
  }
}

/** Runs one wb_view request end to end; never throws for a Workbench-side failure. */
export async function runView(client: ViewClient, input: unknown): Promise<ViewResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;

  let r: Raw;
  try {
    r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: CALL_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof WorkbenchError) {
      const code: ErrorCode =
        e.code === "LOST" || e.code === "MODAL_OPEN" || e.code === "WEDGED"
          ? e.code
          : "UNREACHABLE";
      const f = fail(action, target, code, e.message);
      if (code === "LOST" && mutating) {
        f.next =
          "The call was lost and is never retried; read back with wb_view selection or camera first.";
      }
      return f;
    }
    throw e;
  }
  if (str(r.status) !== "ok") return handlerFailure(action, target, r);
  return shapeOk(action, target, params, r);
}

export function toToolResult(r: ViewResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// -- Registration -------------------------------------------------------------------------------

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = VIEW_CONTRACT): z.ZodRawShape {
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

export function registerWbView(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_view",
    { description: WB_VIEW_DESCRIPTION, inputSchema: flatInputShape() },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runView(client, input));
    },
  );
}
