/**
 * `wb_layers`: sub-scene layers and folders of the open world through EMCP_WB_Layers
 * (wave W1, phase5-w1-spec.md section 2.4).
 *
 *   list, tree                          read; tree is paged (`cursor`, `limit`)
 *   create, createFolder, rename,
 *   delete, move                        in-memory edits inside one undo point; delete of a
 *                                       layer or folder that holds entities or child items is
 *                                       refused NOT_EMPTY unless withContents (then a dry run
 *                                       until confirm); W1.7 run 7 saw DeleteSubsceneFolder on a
 *                                       non-empty layer leave a pathless layer with its entity
 *   setActive, lock, unlock             editor state, read back by the handler
 *
 * OD-6 (DEC-061): the handler has one action surface. The 1.x names still work here and are
 * mapped in TypeScript (LEGACY_MAP):
 *
 *   getActive      tree (limit 1), the activeLayer of the answer
 *   isVisible      list, the row whose id is layerID
 *   getInfo        list for the row, plus tree (limit 1) for whether it is the active layer
 *   toggleLock     list for the row's lock state, then lock or unlock by its path
 *   getEntityLayer no handler action left; refused here, wb_entity get names the layer
 *
 * The request is checked against the contract's per-action schema before anything is sent
 * (nothing here names a sandbox or a project; the handler's project guard answers NOT_IN_PROJECT).
 * Not registered here: src/server.ts registers it.
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
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Layers";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const LAYERS_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const LAYERS_REQUEST_SCHEMA = buildRequestSchema(LAYERS_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbLayersDescription(): string {
  return checkedDescription(LAYERS_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = LAYERS_CONTRACT.actions.map((a) => a.name);

/**
 * A folder has no file of its own: the world saves only its layers' .layer files, so a folder
 * reaches disk only through a layer under it. W1.7 run 6 (2026-11-11): an empty folder, renamed,
 * was absent from the saved files and from the tree after save and reopen.
 */
export const FOLDER_PERSIST_WARNING =
  "a folder is saved only through the layers under it: an empty folder is lost on save; create a layer in it (wb_layers create with parentPath) before saving";

/** 1.x action name to what this tool sends (OD-6). */
export const LEGACY_MAP: Readonly<Record<string, string>> = {
  getActive: "tree",
  getEntityLayer: "(none)",
  isVisible: "list",
  getInfo: "list + tree",
  toggleLock: "list, then lock or unlock",
};
/** LEGACY_MAP's keys, written out so the census (E11) reads them as literals. */
export const LEGACY_ACTIONS: string[] = [
  "getActive",
  "getEntityLayer",
  "isVisible",
  "getInfo",
  "toggleLock",
];

const MUTATING = new Set(LAYERS_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

/** A layer or folder rename or move whose path form the handler could not confirm (P-W1-08). */
const UNVERIFIED_PATH_ACTIONS = new Set(["rename", "move"]);

const READ_TIMEOUT_MS = 30_000;

type Raw = Record<string, unknown>;

export type LayersError = ActionError & { readback?: unknown };
export type LayersResponse = ActionOk | LayersError;

/** The client surface this tool needs (a fake in tests). */
export type LayersClient = Pick<WorkbenchClient, "call">;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): LayersError {
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

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ── Request checks ────────────────────────────────────────────────────────────

const BAD_NAME = /[/\\|]/;

/** The one-sentence refusal text for an input that fails a check, or undefined. */
function checkValues(p: Raw): string | undefined {
  if (p.subScene !== undefined && (typeof p.subScene !== "number" || p.subScene < 0)) {
    return "subScene must be 0 or more (omit it for the current sub-scene)";
  }
  if (
    p.limit !== undefined &&
    (typeof p.limit !== "number" || p.limit < 1 || p.limit > LIMIT_MAX)
  ) {
    return `limit must be 1 to ${LIMIT_MAX}`;
  }
  if (typeof p.name === "string") {
    if (p.name.trim() === "") return "name is empty";
    if (BAD_NAME.test(p.name)) return `name must not hold '/', '\\' or '|': ${p.name}`;
  }
  if (typeof p.layer === "string" && p.layer.trim() === "") {
    return "layer is empty; pass a layer or folder path (wb_layers tree lists them)";
  }
  return undefined;
}

function targetOf(p: Raw): string {
  const layer = str(p.layer);
  if (layer) return `layer:${layer}`;
  return typeof p.subScene === "number" ? `subscene:${p.subScene}` : "subscene:current";
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: LayersError };

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
  const parsed = LAYERS_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const why = checkValues(req);
  if (why) return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", why) };
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
  return { ok: true, action, target, mutating: MUTATING.has(action), params: { ...req } };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a LayersError, else null. */
function handlerFailure(action: string, target: string, r: Raw): LayersError | null {
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
    if (status === "error") {
      // The engine call answered false after the undo point opened: say where it stands.
      e.readback = { undoName: str(r.undoName) || null, before: str(r.before) || null };
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: LayersClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: LayersError }> {
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: READ_TIMEOUT_MS,
    });
    const f = handlerFailure(action, target, r);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating) {
      f.next = "The call was lost and is never retried; read back with wb_layers tree first.";
    }
    return { error: f };
  }
}

// ── Row parsing ───────────────────────────────────────────────────────────────

export interface ListRow {
  id: number;
  path: string;
  visible: boolean;
  locked: boolean;
  entityCount: number;
}

/** list rows "id|path|visible|locked|count". */
export function parseListRows(rows: string[]): ListRow[] {
  return rows.map((line) => {
    const c = line.split("|");
    return {
      id: Number(c[0]),
      path: c[1] ?? "",
      visible: c[2] === "true",
      locked: c[3] === "true",
      entityCount: Number(c[4] ?? 0),
    };
  });
}

export interface TreeRow {
  subScene: number;
  path: string;
  id: number;
  kind: string;
  visible: boolean;
  /** null for a folder: it has no lock of its own. */
  locked: boolean | null;
  lockedHierarchy: boolean | null;
  entityCount: number | null;
}

/** tree rows "sub|path|id|kind|vis|lock|lockH|count"; a folder leaves the last three empty. */
export function parseTreeRows(rows: string[]): TreeRow[] {
  return rows.map((line) => {
    const c = line.split("|");
    const flag = (s: string | undefined) => (s === undefined || s === "" ? null : s === "true");
    return {
      subScene: Number(c[0]),
      path: c[1] ?? "",
      id: Number(c[2]),
      kind: c[3] ?? "",
      visible: c[4] === "true",
      locked: flag(c[5]),
      lockedHierarchy: flag(c[6]),
      entityCount: c[7] === undefined || c[7] === "" ? null : Number(c[7]),
    };
  });
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(
  action: string,
  target: string,
  params: Raw,
  r: Raw,
  extra: { warnings?: string[] } = {},
): ActionOk {
  const warnings = [...(extra.warnings ?? [])];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  const layer = str(params.layer);
  switch (action) {
    case "list":
      readback = {
        currentSubScene: num(r.currentSubScene),
        layers: parseListRows(strs(r.rows)),
      };
      break;
    case "tree": {
      const total = num(r.total) ?? 0;
      const cursor = str(r.nextCursor);
      readback = {
        subScenes: num(r.subScenes),
        activeLayer: str(r.activeLayer),
        total,
        rows: parseTreeRows(strs(r.rows)),
        nextCursor: cursor || null,
      };
      if (cursor) next = `wb_layers tree with cursor "${cursor}" for the next page`;
      break;
    }
    case "create":
    case "createFolder": {
      const path = str(r.layer);
      readback = {
        path,
        ...(action === "create" ? { layerId: num(r.layerId) } : {}),
        undoName: str(r.undoName),
        message: str(r.message),
      };
      changed = [{ path, before: null, after: action === "create" ? "layer" : "folder" }];
      next = "wb_undo_redo undoes it; wb_layers tree reads it back";
      break;
    }
    case "rename":
    case "move":
      readback = {
        before: str(r.before),
        after: str(r.after),
        undoName: str(r.undoName),
        message: str(r.message),
      };
      changed = [{ path: str(r.before), before: str(r.before), after: str(r.after) }];
      next = "wb_undo_redo undoes it; wb_layers tree reads it back";
      break;
    case "delete": {
      const count = num(r.entityCount) ?? 0;
      const childCount = num(r.childCount) ?? 0;
      if (truthy(r.dryRun)) {
        readback = { dryRun: true, entityCount: count, childCount, message: str(r.message) };
        next =
          "Resend with withContents: true and confirm: true to delete it together with its entities and child items.";
      } else {
        const deletedItems = strs(r.rows);
        readback = {
          dryRun: false,
          entityCount: count,
          childCount,
          entitiesDeleted: num(r.entitiesDeleted),
          deletedItems,
          undoName: str(r.undoName),
          message: str(r.message),
        };
        changed = (deletedItems.length ? deletedItems : [layer]).map((path) => ({
          path,
          before: "present",
          after: null,
        }));
        next = "wb_undo_redo undoes it (one undo restores the entities and the items)";
      }
      break;
    }
    case "setActive":
      readback = { before: str(r.before), after: str(r.after) };
      changed = [{ path: "activeLayer", before: str(r.before), after: str(r.after) }];
      break;
    case "lock":
    case "unlock": {
      const locked = truthy(r.layerLocked);
      readback = { layer, locked };
      changed = [{ path: `${layer}.locked`, before: null, after: locked }];
      warnings.push("the lock state before the call is not read; 'before' is unknown");
      break;
    }
    default:
      readback = r;
  }
  if (action === "createFolder" || action === "rename" || action === "move")
    warnings.push(FOLDER_PERSIST_WARNING);
  if (UNVERIFIED_PATH_ACTIONS.has(action)) {
    warnings.push(
      "the engine's folder calls taking a layer path are unverified (P-W1-08): check the readback and the message",
    );
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── 1.x names ─────────────────────────────────────────────────────────────────

const LEGACY_SCHEMAS: Record<string, z.ZodTypeAny> = {
  getActive: z
    .object({ action: z.literal("getActive"), subScene: z.number().int().optional() })
    .strict(),
  getEntityLayer: z
    .object({
      action: z.literal("getEntityLayer"),
      entityName: z.string().min(1),
      subScene: z.number().int().optional(),
    })
    .strict(),
  isVisible: z
    .object({
      action: z.literal("isVisible"),
      layerID: z.number().int().min(0),
      subScene: z.number().int().optional(),
    })
    .strict(),
  getInfo: z
    .object({
      action: z.literal("getInfo"),
      layerID: z.number().int().min(0),
      subScene: z.number().int().optional(),
    })
    .strict(),
  toggleLock: z
    .object({
      action: z.literal("toggleLock"),
      layerID: z.number().int().min(0).optional(),
      layer: z.string().min(1).optional(),
      subScene: z.number().int().optional(),
    })
    .strict(),
};

function mappedWarning(action: string): string {
  return `1.x action name '${action}': sent as ${LEGACY_MAP[action]} (OD-6); the handler has one action surface`;
}

async function runLegacy(client: LayersClient, input: Raw): Promise<LayersResponse> {
  const action = str(input.action);
  const target =
    typeof input.subScene === "number" ? `subscene:${input.subScene}` : "subscene:current";
  const parsed = LEGACY_SCHEMAS[action]!.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return fail(action, target, "INVALID_ARGUMENT", issues.join("; "));
  }
  const p = parsed.data as Raw;
  const why = checkValues(p);
  if (why) return fail(action, target, "INVALID_ARGUMENT", why);
  const sub = typeof p.subScene === "number" ? { subScene: p.subScene } : {};
  const warn = mappedWarning(action);

  if (action === "getEntityLayer") {
    return fail(
      action,
      `entity:${str(p.entityName)}`,
      "INVALID_ARGUMENT",
      "getEntityLayer has no wb_layers handler action any more: the entity's layer is part of wb_entity get",
      "wb_entity get with the entity's reference; its readback names the layer and sub-scene",
    );
  }

  if (action === "getActive") {
    const s = await send(client, { action: "tree", limit: 1, ...sub }, false, action, target);
    if ("error" in s) return s.error;
    return {
      ok: true,
      action,
      target,
      changed: null,
      readback: { activeLayer: str(s.r.activeLayer), subScenes: num(s.r.subScenes) },
      warnings: [warn],
    };
  }

  const wantedPath = str(p.layer);
  if (action === "toggleLock" && p.layerID === undefined && !wantedPath) {
    return fail(action, target, "INVALID_ARGUMENT", "toggleLock needs layerID or layer");
  }
  // isVisible, getInfo and toggleLock look the layer up in list (rows by id).
  const listed = await send(client, { action: "list", ...sub }, false, action, target);
  if ("error" in listed) return listed.error;
  const rows = parseListRows(strs(listed.r.rows));
  const row =
    p.layerID !== undefined
      ? rows.find((x) => x.id === p.layerID)
      : wantedPath
        ? rows.find((x) => x.path === wantedPath)
        : undefined;
  const label = p.layerID !== undefined ? `layer ${String(p.layerID)}` : `layer '${wantedPath}'`;
  const layerTarget = row ? `layer:${row.path}` : target;
  if (!row) {
    return fail(
      action,
      target,
      "PATH_NOT_FOUND",
      `${label} is not in the list of sub-scene ${String(num(listed.r.currentSubScene) ?? "?")}`,
      "wb_layers list shows the layers and their ids",
    );
  }

  if (action === "isVisible") {
    return {
      ok: true,
      action,
      target: layerTarget,
      changed: null,
      readback: { layerID: row.id, path: row.path, visible: row.visible },
      warnings: [warn],
    };
  }

  if (action === "getInfo") {
    const warnings = [warn];
    let active: boolean | null = null;
    const t = await send(client, { action: "tree", limit: 1, ...sub }, false, action, target);
    if ("error" in t) {
      warnings.push(`the active layer was not read: ${t.error.message}`);
    } else {
      active = str(t.r.activeLayer) === row.path;
    }
    return {
      ok: true,
      action,
      target: layerTarget,
      changed: null,
      readback: {
        layerID: row.id,
        path: row.path,
        visible: row.visible,
        locked: row.locked,
        active,
        entityCount: row.entityCount,
      },
      warnings,
    };
  }

  // toggleLock: lock when it reads unlocked, unlock when it reads locked.
  const to = row.locked ? "unlock" : "lock";
  const s = await send(client, { action: to, layer: row.path, ...sub }, true, action, layerTarget);
  if ("error" in s) return s.error;
  const nowLocked = truthy(s.r.layerLocked);
  return {
    ok: true,
    action,
    target: layerTarget,
    changed: [{ path: `${row.path}.locked`, before: row.locked, after: nowLocked }],
    readback: { layerID: row.id, path: row.path, locked: nowLocked, sentAs: to },
    warnings: [warn],
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_layers request end to end; never throws for a Workbench-side failure. */
export async function runLayers(client: LayersClient, input: unknown): Promise<LayersResponse> {
  const raw = (input ?? {}) as Raw;
  if (LEGACY_ACTIONS.includes(str(raw.action))) return runLegacy(client, raw);
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: LayersResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = LAYERS_CONTRACT): z.ZodRawShape {
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
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  shape.layerID = z
    .number()
    .int()
    .optional()
    .describe("1.x isVisible/getInfo/toggleLock: layer id from list");
  shape.entityName = z
    .string()
    .optional()
    .describe("1.x getEntityLayer (refused: use wb_entity get)");
  return shape;
}

export function registerWbLayers(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_layers",
    {
      description: wbLayersDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "World Editor layers",
        readOnlyHint: false,
        // delete removes a layer or folder (with withContents and confirm, its entities and child
        // items too); undo is available.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runLayers(client, input));
    },
  );
}
