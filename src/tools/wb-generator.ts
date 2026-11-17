/**
 * `wb_generator`: World Editor generators on shapes through EMCP_WB_Generator (wave W7,
 * phase5-w7-spec.md section 2.2; DEC-075 OD-2, OD-6, OD-7, OD-12).
 *
 *   list        read, paged (`cursor`, `limit`): the generators of one shape, or all of them
 *   attach      a generator prefab as a child of a shape                      (gate ATTACH_OPEN)
 *   detach      a generator, or every generator of a shape                    (gate ATTACH_OPEN)
 *   regenerate  rebuild a shape's generators                                  (gate REGENERATE_OPEN)
 *   pointData   add or remove a generator data entry on a shape point         (gate POINTDATA_OPEN)
 *   events      generator events on or off, editor-wide, not undoable         (gate EVENTS_OPEN)
 *
 * The gates are `static const bool` switches in the handler, false until their probe passes, so the
 * handler answers GATED itself; this tool passes that refusal through and names the probe and the
 * switch in `next` (GATE_OF). A gated action still checks its arguments here first and nothing is
 * sent when they fail. The edits are in-memory entity actions with one undo point each and take no
 * `confirm` (DEC-061 OD-3, DEC-075 OD-12); `events` is the exception to undo and answers `was` so
 * the caller can restore it.
 *
 * `dataClass` is checked here against the class list of the API index (the descendants of
 * ShapePointDataScriptBase, ForestGeneratorPointData and its relatives); a plain class name the
 * index does not list (a mod's own point-data class) goes on with a warning, and the handler's
 * ClassInherits test against the loaded scripts decides (review round 1, W7-GEN-02). Generator prefabs are `{GUID}path` names (vanilla ones are packed).
 *
 * NOT_A_GENERATOR (spec 1.2 rule 13) is in src/manifest/vocabulary.ts. Nothing here names a
 * sandbox or a project. src/server.ts registers the tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkbenchClient } from "../workbench/client.js";
import { loadContract, type Contract } from "../manifest/contract.js";
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
import { codeOfClientError } from "./wb-module.js";
import { flatInputShape } from "./wb-entity.js";

export const HANDLER = "EMCP_WB_Generator";
export const WORLD_TARGET = "open:WorldEditor";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const GENERATOR_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const GENERATOR_REQUEST_SCHEMA = buildRequestSchema(GENERATOR_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbGeneratorDescription(): string {
  return checkedDescription(GENERATOR_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = GENERATOR_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(GENERATOR_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

/** The handler's page size, its default and its most (EMCP_WB_Generator.PAGE_DEFAULT, PAGE_MAX). */
export const PAGE_MAX = 200;
const READ_TIMEOUT_MS = 30_000;
/** A write is one entity action; regenerate can take a moment on a large shape. */
const WRITE_TIMEOUT_MS = 60_000;

/**
 * Per gated action: the probe that opens it and the handler switch the main session flips
 * (spec 1.2 rule 9).
 */
export const GATE_OF: Readonly<Record<string, { probe: string; flag: string }>> = {
  attach: { probe: "P-W7-10", flag: "ATTACH_OPEN" },
  detach: { probe: "P-W7-10", flag: "ATTACH_OPEN" },
  regenerate: { probe: "P-W7-11", flag: "REGENERATE_OPEN" },
  pointData: { probe: "P-W7-13", flag: "POINTDATA_OPEN" },
  events: { probe: "P-W7-12", flag: "EVENTS_OPEN" },
};

type Raw = Record<string, unknown>;

export interface GeneratorError {
  ok: false;
  action: string;
  target: string;
  /** A vocabulary code, NOT_A_GENERATOR, or a kernel code (LOST, MODAL_OPEN, WEDGED). */
  code: string;
  message: string;
  next: string;
  warnings: string[];
  /** What the handler answered before failing (id, className, undoName, count, generators). */
  readback?: Record<string, unknown>;
}

export type GeneratorResponse = ActionOk | GeneratorError;

/** The client surface this tool needs (a fake in tests). */
export type GeneratorClient = Pick<WorkbenchClient, "call">;

export interface GeneratorOptions {
  /** The data directory holding api/hierarchy.json (the repo's `data/` by default). */
  dataDir?: string;
}

function nextFor(code: string): string {
  return (ERROR_CODES as Record<string, string>)[code] ?? "See the message.";
}

function fail(
  action: string,
  target: string,
  code: string,
  message: string,
  next?: string,
): GeneratorError {
  return { ok: false, action, target, code, message, next: next || nextFor(code), warnings: [] };
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
export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

// ── The index's class lists ───────────────────────────────────────────────────

/** The concrete point-data classes known when the index cannot be read (ForestGeneratorPointData and its relatives). */
export const POINT_DATA_FALLBACK: readonly string[] = [
  "ForestGeneratorPointData",
  "PrefabGeneratorPointData",
  "SCR_GeoPointData",
  "SCR_PowerlineGeneratorPointData",
  "WallGeneratorPointData",
];

export const POINT_DATA_BASE = "ShapePointDataScriptBase";
export const ROAD_BASE = "RoadGeneratorEntity";

interface HierarchyEntry {
  name: string;
  children?: string[];
}

export function defaultDataDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
}

const hierarchyCache = new Map<string, Map<string, string[]>>();

/** The class hierarchy of `data/api/hierarchy.json` (name to direct children); empty when unreadable. */
function hierarchyOf(dataDir: string): Map<string, string[]> {
  const cached = hierarchyCache.get(dataDir);
  if (cached) return cached;
  const map = new Map<string, string[]>();
  const file = join(dataDir, "api", "hierarchy.json");
  try {
    if (existsSync(file)) {
      const list = JSON.parse(readFileSync(file, "utf-8")) as HierarchyEntry[];
      for (const e of list) {
        if (typeof e?.name !== "string") continue;
        const kids = map.get(e.name) ?? [];
        for (const c of e.children ?? []) if (!kids.includes(c)) kids.push(c);
        map.set(e.name, kids);
      }
    }
  } catch {
    // An unreadable index falls back to the built-in lists.
  }
  hierarchyCache.set(dataDir, map);
  return map;
}

/** `root` and every class under it in the hierarchy. */
function descendantsOf(h: Map<string, string[]>, root: string): Set<string> {
  const seen = new Set<string>([root]);
  const todo = [root];
  while (todo.length) {
    const cur = todo.pop()!;
    for (const c of h.get(cur) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        todo.push(c);
      }
    }
  }
  return seen;
}

/**
 * The classes `dataClass` may name: those the index lists under ShapePointDataScriptBase, the
 * index classes named `*PointData` (the index records no parents for them), and the built-in
 * five. The abstract base itself is not one.
 */
export function pointDataClasses(dataDir: string = defaultDataDir()): string[] {
  const h = hierarchyOf(dataDir);
  const out = new Set<string>(POINT_DATA_FALLBACK);
  for (const c of descendantsOf(h, POINT_DATA_BASE)) out.add(c);
  for (const name of h.keys()) if (/PointData$/.test(name)) out.add(name);
  out.delete(POINT_DATA_BASE);
  return [...out].sort();
}

/** RoadGeneratorEntity and its descendants in the index (the class names a road generator has). */
export function roadGeneratorClasses(dataDir: string = defaultDataDir()): Set<string> {
  return descendantsOf(hierarchyOf(dataDir), ROAD_BASE);
}

// ── Request checks ────────────────────────────────────────────────────────────

const GUID_PREFIX = /^(\{[0-9A-Fa-f]{16}\})(.*)$/;

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function canonicalRef(key: string, text: string): string {
  try {
    return printEntityRef(parseEntityRef(text));
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `${key}: ${e.message}`);
    throw e;
  }
}

/** A generator prefab: `{GUID}path` or a project-relative path, ending in .et. Returns what to send. */
export function checkPrefab(raw: string): string {
  const trimmed = raw.trim();
  const m = GUID_PREFIX.exec(trimmed);
  if (trimmed.startsWith("{") && !m) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `prefab: a GUID is 16 hex digits in braces, got '${raw}'`,
    );
  }
  const rest = m ? m[2] : trimmed;
  let clean = rest;
  try {
    clean = rest === "" ? "" : checkRelativePath(rest);
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `prefab: ${e.message}`);
    throw e;
  }
  if (clean !== "" && !clean.toLowerCase().endsWith(".et")) {
    throw new Refusal("INVALID_ARGUMENT", `prefab must name an .et generator prefab, got '${raw}'`);
  }
  if (clean === "" && m) return m[1];
  return m ? `${m[1]}${clean}` : clean;
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw; warnings: string[] }
  | { ok: false; error: GeneratorError };

/**
 * Validates one tool input against the contract's per-action schema and the rules its types
 * cannot say. Nothing is sent when this refuses. A gated action is checked the same way, then
 * sent: the handler answers GATED.
 */
export function prepareRequest(input: unknown, options: GeneratorOptions = {}): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  if (!HANDLER_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        WORLD_TARGET,
        "INVALID_ARGUMENT",
        `unknown action '${action}'; one of ${HANDLER_ACTIONS.join(", ")}`,
      ),
    };
  }
  const parsed = GENERATOR_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, WORLD_TARGET, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const params: Raw = { ...req };
  const warnings: string[] = [];
  let target = WORLD_TARGET;
  try {
    for (const key of ["shape", "entity"]) {
      if (typeof req[key] === "string") params[key] = canonicalRef(key, req[key]);
    }
    const ref = str(params.shape) || str(params.entity);
    if (ref) target = `entity:${ref}`;

    if (
      typeof req.limit === "number" &&
      (req.limit < 1 || req.limit > Math.min(PAGE_MAX, LIMIT_MAX))
    ) {
      throw new Refusal("INVALID_ARGUMENT", `limit must be 1 to ${PAGE_MAX}`);
    }
    if (typeof req.cursor === "string") {
      try {
        parseCursor(req.cursor);
      } catch (e) {
        if (e instanceof VocabularyError) throw new Refusal(e.code, e.message);
        throw e;
      }
    }
    if (action === "attach") {
      params.prefab = checkPrefab(str(req.prefab));
      if (typeof req.name === "string" && (req.name.trim() === "" || /[\0-\x1f]/.test(req.name))) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          "name must be non-empty text without control characters",
        );
      }
    } else if (action === "pointData") {
      const index = req.index as number;
      if (index < 0) throw new Refusal("INVALID_ARGUMENT", `index must be 0 or more, got ${index}`);
      const op = str(req.op);
      if (op !== "add" && op !== "remove") {
        throw new Refusal("INVALID_ARGUMENT", `op must be add or remove, got '${op}'`);
      }
      if (op === "add") {
        if (typeof req.dataClass !== "string" || req.dataClass === "") {
          throw new Refusal(
            "INVALID_ARGUMENT",
            "dataClass is required for op add, e.g. ForestGeneratorPointData",
          );
        }
        if (req.dataIndex !== undefined) {
          throw new Refusal("INVALID_ARGUMENT", "dataIndex belongs to op remove; op add appends");
        }
        const known = pointDataClasses(options.dataDir);
        if (!known.includes(req.dataClass)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(req.dataClass) || req.dataClass === POINT_DATA_BASE) {
            throw new Refusal(
              "INVALID_ARGUMENT",
              `dataClass '${req.dataClass}' is not a point-data class of the index; one of ${known.join(", ")}`,
            );
          }
          warnings.push(
            `dataClass '${req.dataClass}' is not in the API index (a mod's own class?); the handler checks that it inherits ${POINT_DATA_BASE}`,
          );
        }
      } else {
        if (req.dataClass !== undefined) {
          throw new Refusal(
            "INVALID_ARGUMENT",
            "dataClass belongs to op add; op remove takes dataIndex",
          );
        }
        if (typeof req.dataIndex === "number" && req.dataIndex < 0) {
          throw new Refusal(
            "INVALID_ARGUMENT",
            `dataIndex must be 0 or more, got ${req.dataIndex}`,
          );
        }
      }
    } else if (action === "events") {
      // A request bool goes as an explicit JSON boolean (the proven confirm form); a number into a
      // bool field of a JsonApiStruct is unproven (enforce-review W7 G1).
      params.enabled = req.enabled === true;
    }
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: fail(action, target, e.code, e.message) };
    throw e;
  }
  return { ok: true, action, target, mutating: MUTATING.has(action), params, warnings };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** The handler's own next, with the probe and the switch of a GATED action added. */
function gatedNext(action: string, handlerNext: string): string {
  const gate = GATE_OF[action];
  if (!gate) return handlerNext || nextFor("GATED");
  return (
    `${action} waits for probe ${gate.probe}; nothing was changed. ` +
    `The main session sets EMCP_WB_Generator.${gate.flag} true and recompiles once the probe passes.`
  );
}

/** A handler refusal or error as a GeneratorError, else null. */
function handlerFailure(action: string, target: string, r: Raw): GeneratorError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const code = KNOWN_CODES.has(raw)
      ? raw
      : status === "error"
        ? "HANDLER_ERROR"
        : "INVALID_ARGUMENT";
    const next = code === "GATED" ? gatedNext(action, str(r.next)) : str(r.next) || undefined;
    const e = fail(action, target, code, str(r.message) || `the handler answered ${status}`, next);
    if (raw !== "" && !KNOWN_CODES.has(raw)) {
      e.warnings.push(`the handler answered an unknown code '${raw}'`);
    }
    const partial: Raw = {};
    for (const k of ["id", "className", "undoName"]) if (str(r[k]) !== "") partial[k] = r[k];
    for (const k of ["count", "generators"])
      if (num(r[k]) !== null && r[k] !== 0) partial[k] = r[k];
    if (status === "error" && Object.keys(partial).length) e.readback = partial;
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: GeneratorClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: GeneratorError }> {
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: mutating ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS,
    });
    const f = handlerFailure(action, target, r ?? {});
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating) {
      f.next = `The call was lost and is never retried; read back with wb_generator list${
        action === "events" ? " (it reports eventsEnabled)" : ""
      } first.`;
    }
    return { error: f };
  }
}

// ── Shaping ───────────────────────────────────────────────────────────────────

export interface GeneratorRow {
  id: string;
  className: string;
  prefab: string;
  shapeId: string;
}

/** list rows "id|className|prefab|shapeId". A row with fewer cells keeps what it has. */
export function parseRows(rows: string[]): GeneratorRow[] {
  return rows.map((row) => {
    const c = row.split("|");
    return { id: c[0] ?? "", className: c[1] ?? "", prefab: c[2] ?? "", shapeId: c[3] ?? "" };
  });
}

function shapeOk(action: string, target: string, params: Raw, r: Raw): GeneratorResponse {
  const warnings: string[] = [];
  const message = str(r.message);
  const undoName = str(r.undoName);
  const undoNext = undoName ? "Undo with wb_undo_redo." : undefined;
  switch (action) {
    case "list": {
      const total = num(r.total) ?? 0;
      if (typeof params.cursor === "string") {
        try {
          checkCursor(parseCursor(params.cursor), total);
        } catch (e) {
          if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
          throw e;
        }
      }
      const cursor = str(r.nextCursor);
      return {
        ok: true,
        action,
        target,
        changed: null,
        readback: {
          eventsEnabled: truthy(r.eventsEnabled),
          total,
          rows: parseRows(strs(r.rows)),
          nextCursor: cursor || null,
        },
        next: cursor ? `More: resend with cursor "${cursor}".` : undefined,
        warnings,
      };
    }
    case "attach": {
      const id = str(r.id);
      const className = str(r.className);
      if (message.includes("(the editor named it")) {
        warnings.push(message.slice(message.indexOf("(the editor named it")).split(";")[0]);
      }
      return {
        ok: true,
        action,
        target,
        changed: [{ path: id, before: null, after: className }],
        readback: { id, className, undoName },
        next: undoNext,
        warnings,
      };
    }
    case "detach": {
      const id = str(r.id);
      return {
        ok: true,
        action,
        target,
        changed: [{ path: id, before: "present", after: null }],
        readback: { id, undoName, message },
        next: undoNext,
        warnings,
      };
    }
    case "regenerate": {
      const generators = num(r.generators) ?? 0;
      if (generators === 0)
        warnings.push("the shape has no generator children; nothing was changed");
      if (message.includes("generator events are off")) {
        warnings.push(
          "generator events are off, so the rebuild may not have run (wb_generator events)",
        );
      }
      return {
        ok: true,
        action,
        target,
        changed:
          generators > 0 ? [{ path: str(params.shape), before: null, after: "regenerated" }] : [],
        readback: { generators, undoName, message },
        next: generators > 0 ? undoNext : "Attach one with wb_generator attach.",
        warnings,
      };
    }
    case "pointData": {
      const count = num(r.count) ?? 0;
      const adding = params.op === "add";
      const change: Change = {
        path: `${str(params.shape)}.Points[${String(params.index)}].Data.count`,
        before: adding ? count - 1 : count + 1,
        after: count,
      };
      return {
        ok: true,
        action,
        target,
        changed: [change],
        readback: { op: params.op, index: params.index, count, undoName },
        next: undoNext,
        warnings,
      };
    }
    default: {
      // events
      const after = truthy(r.eventsEnabled);
      const was = truthy(r.was);
      return {
        ok: true,
        action,
        target,
        changed: [{ path: "generatorEvents", before: was, after }],
        readback: { eventsEnabled: after, was },
        next: `Editor-wide and not undoable; restore with wb_generator events enabled: ${was}.`,
        warnings,
      };
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_generator request end to end; never throws for a Workbench-side failure. */
export async function runGenerator(
  client: GeneratorClient,
  input: unknown,
  options: GeneratorOptions = {},
): Promise<GeneratorResponse> {
  const prepared = prepareRequest(input, options);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params, warnings } = prepared;
  const s = await send(client, params, mutating, action, target);
  const out = "error" in s ? s.error : shapeOk(action, target, params, s.r);
  out.warnings.unshift(...warnings);
  return out;
}

export function toToolResult(r: GeneratorResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerWbGenerator(
  server: McpServer,
  client: WorkbenchClient,
  options: GeneratorOptions = {},
): void {
  server.registerTool(
    "wb_generator",
    {
      description: wbGeneratorDescription(),
      inputSchema: flatInputShape(GENERATOR_CONTRACT),
      annotations: {
        title: "World Editor generators",
        readOnlyHint: false,
        // attach, detach, regenerate and pointData are one undo point each; events is
        // editor-wide and answers was so the caller can restore it.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runGenerator(client, input, options));
    },
  );
}
