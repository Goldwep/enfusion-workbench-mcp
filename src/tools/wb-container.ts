import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkbenchError } from "../workbench/client.js";
import { defaultArtifactsDir } from "../census/source-index.js";
import { loadContract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  EDITOR_TARGET_MODULES,
  ERROR_CODES,
  FIELDS_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  parseClassTarget,
  parseEditorTarget,
  parseEntityTarget,
  parseModuleTarget,
  parseTarget,
  printClassTarget,
  printEditorTarget,
  printEntityTarget,
  printModuleTarget,
  printTarget,
  type ActionOk,
  type ClassTarget,
  type Change,
  type EditorTarget,
  type EntityTarget,
  type ModuleTarget,
  type Target,
} from "../manifest/vocabulary.js";
import type { WorkbenchClient } from "../workbench/client.js";
import type { Contract } from "../manifest/contract.js";

/**
 * wb_container: one resource's BaseContainer through EMCP_WB_Container (DEC-048 package 3.3).
 * The schema and the description come from contracts/EMCP_WB_Container.json; `target` and `path`
 * go through the shared vocabulary before anything is sent.
 */

export const HANDLER = "EMCP_WB_Container";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const CONTAINER_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const CONTAINER_REQUEST_SCHEMA = buildRequestSchema(CONTAINER_CONTRACT);
export const WB_CONTAINER_DESCRIPTION = checkedDescription(CONTAINER_CONTRACT);

/**
 * Actions the handler answers with UNPROVEN on an entity:<ref> target only (contract `refuses`):
 * arrayMove, since SetObjectVariableMember/4 names no array slot (P-W1-22). Path targets move.
 * Refused here before sending.
 */
export const ENTITY_UNPROVEN_ACTIONS: readonly string[] = CONTAINER_CONTRACT.actions
  .filter((a) => a.refuses?.startsWith("UNPROVEN"))
  .map((a) => a.name);
export const UNPROVEN_NEXT = "waits for train #2 gate 2";

/** Actions an entity:<ref> target cannot take: save re-writes a file, which an entity is not. */
const NO_ENTITY_TARGET: readonly string[] = ["save"];

/** One path segment: `name`, `name[3]` (an index) or `name[Class]` (the first element of that class). */
const PATH_SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+|[A-Za-z_][A-Za-z0-9_]*)\])?$/;

/**
 * Checks a property path: dotted segments, at most one bracket each, holding an index or a class
 * name (the handler's SplitSegment). Returns the path as it is sent; throws INVALID_ARGUMENT.
 */
export function checkPropertyPath(raw: string, opts: { childSteps?: boolean } = {}): string {
  if (raw === "") throw new VocabularyError("INVALID_ARGUMENT", "empty property path");
  const parts = raw.split(".");
  // get only: leading `#<i>` steps walk the container's child nodes (GetChild: a layout's widgets,
  // which are no variable of their parent; W2 run 3). A write never takes one.
  let first = 0;
  while (first < parts.length && /^#/.test(parts[first]!)) {
    if (!opts.childSteps) {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        `child step '${parts[first]}' in ${raw}: only get reads a child node (#<index>.<variable>)`,
      );
    }
    if (!/^#\d+$/.test(parts[first]!) || !Number.isSafeInteger(Number(parts[first]!.slice(1)))) {
      throw new VocabularyError("INVALID_ARGUMENT", `bad child step '${parts[first]}' in ${raw}`);
    }
    first++;
  }
  if (first === parts.length) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `${raw} names a child node, not a variable: follow it with .<variable>`,
    );
  }
  for (const part of parts.slice(first)) {
    if (PATH_SEGMENT.test(part)) {
      const idx = /\[(\d+)\]/.exec(part);
      if (idx && !Number.isSafeInteger(Number(idx[1]))) {
        throw new VocabularyError("INVALID_ARGUMENT", `index out of range in ${raw}`);
      }
      continue;
    }
    if ((part.match(/\[/g) ?? []).length > 1 || /\]\[/.test(part)) {
      throw new VocabularyError("INVALID_ARGUMENT", `one index per segment: ${part}`);
    }
    throw new VocabularyError("INVALID_ARGUMENT", `bad path segment '${part}' in ${raw}`);
  }
  return raw;
}

/**
 * W4 editor targets (phase5-w4-spec.md 2.3, DEC-067) live in the vocabulary with the W2 ones; the
 * handler refuses each GATED until its probes pass (EMCP_WB_ContainerTarget.EditorGate), so this
 * tool sends the request.
 */
export { EDITOR_TARGET_MODULES, parseEditorTarget };

/** Every target wb_container takes; the W2 and W4 ones (open:<module>, class:) live in the vocabulary. */
export type { ClassTarget, EditorTarget, ModuleTarget };
export type ContainerTarget = Target | EntityTarget | ModuleTarget | ClassTarget | EditorTarget;

/** Columns of a describe row, as the handler's COLUMN_NAMES. */
export const COLUMNS = [
  "path",
  "name",
  "type",
  "default",
  "set",
  "setDirectly",
  "objectClass",
  "value",
] as const;
/** The three columns `fields: schema` adds, as the handler's SCHEMA_COLUMN_NAMES. */
export const SCHEMA_ONLY_COLUMNS: readonly string[] = ["widget", "limits", "enumValues"];
export const SCHEMA_COLUMNS: readonly string[] = [...COLUMNS, ...SCHEMA_ONLY_COLUMNS];

/** The handler's walk cap (EMCP_WB_Container.MAX_ROWS): the most pages a spill fetches. */
export const MAX_ROWS = 20_000;
const MAX_SPILL_PAGES = Math.ceil(MAX_ROWS / LIMIT_MAX);
/** A reload of a resource and a walk of a world can take a while on the NET thread. */
export const READ_TIMEOUT_MS = 30_000;

export interface ContainerError {
  ok: false;
  action: string;
  target: string;
  /** A vocabulary code, UNPROVEN, SAVE_FAILED, or a kernel code (LOST, MODAL_OPEN, WEDGED, ...). */
  code: string;
  message: string;
  next: string;
  warnings: string[];
  /** set/save by path: the target's GetSourceAddons list, comma-joined, as the handler answered it. */
  sourceAddons?: string;
}

export type ContainerResponse = ActionOk | ContainerError;

export interface ContainerDeps {
  /** Root of the artifacts folder (default: defaultArtifactsDir()). */
  artifactsRoot?: string;
  now?: () => Date;
}

type Raw = Record<string, unknown>;

function fail(
  action: string,
  target: string,
  code: string,
  message: string,
  next?: string,
): ContainerError {
  const fallback = (ERROR_CODES as Record<string, string>)[code] ?? "See the message.";
  return { ok: false, action, target, code, message, next: next || fallback, warnings: [] };
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2, 2026-10-10). */
function isTrue(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | {
      ok: true;
      action: string;
      target: ContainerTarget;
      mutating: boolean;
      params: Raw;
      /** describe: the columns to show. */
      columns: readonly string[];
      /** describe: the handler walks with the schema columns. */
      schema: boolean;
    }
  | { ok: false; error: ContainerError };

/**
 * `path:` / `open:WorldEditor` through the shared vocabulary, `entity:<ref>` through the entity
 * one, `open:ResourceManager` and `class:<Name>` here.
 */
function parseAnyTarget(text: string): ContainerTarget {
  const moduleTarget = parseModuleTarget(text);
  if (moduleTarget) return moduleTarget;
  const editorTarget = parseEditorTarget(text);
  if (editorTarget) return editorTarget;
  if (text.startsWith("class:")) return parseClassTarget(text);
  return text.startsWith("entity:") ? parseEntityTarget(text) : parseTarget(text);
}

function printAnyTarget(t: ContainerTarget): string {
  if (t.kind === "module") return printModuleTarget(t);
  if (t.kind === "editor") return printEditorTarget(t);
  if (t.kind === "class") return printClassTarget(t);
  return t.kind === "entity" ? printEntityTarget(t) : printTarget(t);
}

/** Actions open:ResourceManager takes as writes; the rest are UNPROVEN there (handler RM_WRITE_UNPROVEN). */
const RM_WRITE_ACTIONS: readonly string[] = ["set", "save"];

/**
 * Validates one tool input against the contract's per-action schema and the shared vocabulary.
 * Nothing is sent when this refuses: ABSOLUTE_PATH and INVALID_ARGUMENT for the target and the
 * path, UNPROVEN for arrayMove on an entity and for any write into open:WorldEditor.
 */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const targetText = str(raw.target);
  const parsed = CONTAINER_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, targetText, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const contractAction = CONTAINER_CONTRACT.actions.find((a) => a.name === action);
  const mutating = contractAction?.mutating ?? true;

  let target: ContainerTarget;
  try {
    target = parseAnyTarget(targetText);
  } catch (e) {
    if (e instanceof VocabularyError)
      return { ok: false, error: fail(action, targetText, e.code, e.message) };
    throw e;
  }
  if (target.kind === "entity" && NO_ENTITY_TARGET.includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        targetText,
        "INVALID_ARGUMENT",
        `${action} re-writes a file: target path:<resource>. An entity is saved with the world (wb_module save).`,
      ),
    };
  }
  if (target.kind === "entity" && ENTITY_UNPROVEN_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        targetText,
        "UNPROVEN",
        `${action}: ${contractAction?.refuses ?? "unproven"} Nothing was sent.`,
      ),
    };
  }
  if (mutating && target.kind === "class") {
    return {
      ok: false,
      error: fail(
        action,
        targetText,
        "WRONG_MODE",
        "class:<Name> is a read-only schema target: a fresh container that is never saved. Write a file with target path:<rel>. Nothing was sent.",
      ),
    };
  }
  if (
    mutating &&
    (target.kind === "module" || target.kind === "editor") &&
    !RM_WRITE_ACTIONS.includes(action)
  ) {
    return {
      ok: false,
      error: fail(
        action,
        targetText,
        "UNPROVEN",
        `on ${targetText} only set and save are specified; no clear, array or class write into a module's container was ever made. Nothing was sent.`,
      ),
    };
  }
  if (mutating && target.kind === "open") {
    return {
      ok: false,
      error: fail(
        action,
        targetText,
        "UNPROVEN",
        "no write into the World Editor's container was ever made (U8 write, DEC-044); use wb_module save for the world. Nothing was sent.",
      ),
    };
  }

  const params: Raw = { ...req, target: printAnyTarget(target) };
  if (typeof req.path === "string") {
    try {
      params.path = checkPropertyPath(req.path, { childSteps: action === "get" });
    } catch (e) {
      if (e instanceof VocabularyError)
        return { ok: false, error: fail(action, targetText, e.code, e.message) };
      throw e;
    }
  }
  if (action === "arrayAdd" && req.index === undefined) params.index = -1;
  for (const k of ["index", "toIndex"]) {
    const v = req[k] as number | undefined;
    if (v !== undefined && v < -1) {
      return {
        ok: false,
        error: fail(action, targetText, "INVALID_ARGUMENT", `${k} must be -1 or higher, got ${v}`),
      };
    }
  }
  if ((action === "arrayRemove" || action === "arrayMove") && (req.index as number) < 0) {
    return {
      ok: false,
      error: fail(action, targetText, "INVALID_ARGUMENT", "index must be 0 or higher"),
    };
  }
  if (action === "arrayMove" && (req.toIndex as number) < 0) {
    return {
      ok: false,
      error: fail(action, targetText, "INVALID_ARGUMENT", "toIndex must be 0 or higher"),
    };
  }
  if ((action === "arrayAdd" || action === "setClass") && str(req.className).trim() === "") {
    return {
      ok: false,
      error: fail(action, targetText, "INVALID_ARGUMENT", "className must not be empty"),
    };
  }
  // An empty string is a value: the handler cannot tell it from a key left out, so say so.
  if (action === "set") params.emptyValue = str(req.value) === "";
  if (mutating) params.confirm = req.confirm === true;
  let schema = false;
  let columns: readonly string[] = parseFields(FIELDS_DEFAULT);
  if (action === "describe") {
    if (req.mode !== undefined && req.mode !== "summary" && req.mode !== "page") {
      return {
        ok: false,
        error: fail(action, targetText, "INVALID_ARGUMENT", "mode must be summary or page"),
      };
    }
    const limit = req.limit as number | undefined;
    if (limit !== undefined && (limit < 1 || limit > LIMIT_MAX)) {
      return {
        ok: false,
        error: fail(action, targetText, "INVALID_ARGUMENT", `limit must be 1 to ${LIMIT_MAX}`),
      };
    }
    if (req.fields !== undefined) {
      const tokens = parseFields(str(req.fields));
      const unknown = tokens.filter((f) => f !== "schema" && !SCHEMA_COLUMNS.includes(f));
      if (unknown.length) {
        return {
          ok: false,
          error: fail(
            action,
            targetText,
            "INVALID_ARGUMENT",
            `unknown fields ${unknown.join(", ")}; columns are ${COLUMNS.join(", ")}; schema adds ${SCHEMA_ONLY_COLUMNS.join(", ")}`,
          ),
        };
      }
      // The token "schema", or naming a schema column, asks for the schema walk.
      schema = tokens.some((f) => f === "schema" || SCHEMA_ONLY_COLUMNS.includes(f));
      if (!schema) columns = tokens;
      else {
        const base = tokens.filter((f) => f !== "schema" && !SCHEMA_ONLY_COLUMNS.includes(f));
        const named = tokens.filter((f) => SCHEMA_ONLY_COLUMNS.includes(f));
        columns = [
          ...(base.length ? base : parseFields(FIELDS_DEFAULT)),
          ...(named.length ? named : SCHEMA_ONLY_COLUMNS),
        ];
      }
    }
    // The client filters columns; the handler reads only the "schema" token.
    if (schema) params.fields = "schema";
    else delete params.fields;
  }
  return { ok: true, action, target, mutating, params, columns, schema };
}

function parseFields(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Row-major cells to row objects, keeping the given columns. */
export function rowsToObjects(
  cells: string[],
  fields: readonly string[],
  layout: readonly string[] = COLUMNS,
): Raw[] {
  const out: Raw[] = [];
  for (let r = 0; r + layout.length <= cells.length; r += layout.length) {
    const row: Raw = {};
    for (const f of fields) {
      const c = layout.indexOf(f);
      if (c >= 0) row[f] = cells[r + c];
    }
    out.push(row);
  }
  return out;
}

/** `TYPE=count` lines to a record. */
function counts(lines: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const at = l.lastIndexOf("=");
    if (at > 0) out[l.slice(0, at)] = Number(l.slice(at + 1));
  }
  return out;
}

/** Maps a handler answer that is not ok to the error shape (the handler's code and next win). */
function handlerFailure(action: string, target: string, r: Raw): ContainerError {
  const code = str(r.code) || "INVALID_ARGUMENT";
  const siblings = strs(r.siblings);
  const nextText = str(r.next) || undefined;
  let message = str(r.message) || `${HANDLER} answered ${str(r.status) || "no status"}`;
  if (siblings.length) message += ` (siblings: ${siblings.join(", ")})`;
  const error = fail(action, target, code, message, nextText);
  // The handler's message names the deciding guard; the source-addon list rides along as a fact.
  if (typeof r.sourceAddons === "string") {
    error.sourceAddons = r.sourceAddons;
    if (!message.includes("GetSourceAddons"))
      error.message += ` (sourceAddons: [${r.sourceAddons}])`;
  }
  return error;
}

function isOk(r: Raw): boolean {
  return str(r.status) === "ok";
}

/** Fetches every page of a describe walk (page mode, LIMIT_MAX rows each) and writes one JSON file. */
async function spill(
  client: WorkbenchClient,
  target: string,
  deps: ContainerDeps,
  schema: boolean,
): Promise<{ path: string; rows: number } | { error: Raw }> {
  // The answer carries the placeholder form; the absolute path (a home folder) stays internal.
  const cells: string[] = [];
  let cursor = "";
  let rootClass = "";
  let total = 0;
  let capped = false;
  for (let page = 0; page < MAX_SPILL_PAGES; page++) {
    const params: Raw = { action: "describe", target, mode: "page", limit: LIMIT_MAX };
    if (schema) params.fields = "schema";
    if (cursor) params.cursor = cursor;
    const r = await client.call<Raw>(HANDLER, params, {
      access: "read",
      timeout: READ_TIMEOUT_MS,
    });
    if (!isOk(r)) return { error: r };
    cells.push(...strs(r.rows));
    rootClass = str(r.rootClass);
    total = Number(r.total ?? 0);
    capped = isTrue(r.capped);
    cursor = str(r.nextCursor);
    if (!cursor) break;
  }
  const now = (deps.now ?? (() => new Date()))();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const file = join(deps.artifactsRoot ?? defaultArtifactsDir(), "container", `${stamp}.json`);
  mkdirSync(dirname(file), { recursive: true });
  const layout = schema ? SCHEMA_COLUMNS : COLUMNS;
  const rows = rowsToObjects(cells, layout, layout);
  writeFileSync(
    file,
    JSON.stringify({ target, rootClass, total, capped, columns: layout, rows }, null, 1),
  );
  return { path: `<artifacts>/container/${stamp}.json`, rows: rows.length };
}

function isArrayAction(action: string): boolean {
  return action === "arrayAdd" || action === "arrayRemove" || action === "arrayMove";
}

/** What a by-path write reports about the file: saved, the path, the source addons. */
function fileReadback(r: Raw): Raw {
  return {
    saved: isTrue(r.saved),
    file: str(r.savedPath),
    sourceAddons: str(r.sourceAddons),
  };
}

/** An entity write is in memory as one undo step; the world is not saved. */
function entityReadback(r: Raw, warnings: string[]): Raw {
  const undoName = str(r.undoName);
  warnings.push(
    `applied in memory as one undo step${undoName ? ` (${undoName})` : ""}; the world is not saved: wb_undo_redo reverts it, wb_module save keeps it`,
  );
  return { saved: false, undoName };
}

const DRY_NEXT: Record<string, string> = {
  clear: "Resend with confirm: true to clear the override and save the file.",
  setClass: "Resend with confirm: true to replace the object and save the file.",
  arrayAdd: "Resend with confirm: true to add the element and save the file.",
  arrayRemove: "Resend with confirm: true to remove the element and save the file.",
  arrayMove: "Resend with confirm: true to move the element and save the file.",
};

/** The answer of clear, setClass and the array writes: a dry run (path) or the applied change. */
function mapWrite(
  action: string,
  params: Raw,
  r: Raw,
  base: { ok: true; action: string; target: string; warnings: string[] },
  warnings: string[],
  isEntity: boolean,
): ActionOk {
  const path = str(params.path);
  const before = str(r.before);
  const after = str(r.after);
  const detail: Raw = { type: str(r.varType) };
  if (str(r.objectClass)) detail.objectClass = str(r.objectClass);
  if (isArrayAction(action)) detail.count = Number(r.count ?? 0);
  if (action === "clear") detail.isSet = isTrue(r.isSet);

  if (isTrue(r.dryRun)) {
    // clear answers no `after`: the variable would read its inherited value.
    const wouldChange =
      action === "clear" ? { path, before, after: "(inherited value)" } : { path, before, after };
    return {
      ...base,
      changed: null,
      readback: {
        dryRun: true,
        ...detail,
        wouldChange: [wouldChange],
        sourceAddons: str(r.sourceAddons),
      },
      next: DRY_NEXT[action],
    };
  }
  const change: Change = { path, before, after };
  return {
    ...base,
    changed: [change],
    readback: {
      ...detail,
      ...(isEntity ? entityReadback(r, warnings) : fileReadback(r)),
    },
  };
}

/** Runs one wb_container request end to end; never throws for a Workbench-side failure. */
export async function runContainer(
  client: WorkbenchClient,
  input: unknown,
  deps: ContainerDeps = {},
): Promise<ContainerResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, mutating, params, columns, schema } = prepared;
  const target = printAnyTarget(prepared.target);
  const isWorld = prepared.target.kind === "open"; // WorldEditor only: module targets are kind "module"

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
            : "Check the Workbench connection (wb_diagnose).";
      return fail(action, target, e.code, e.message, next);
    }
    throw e;
  }
  if (!isOk(r)) return handlerFailure(action, target, r);

  const warnings: string[] = [];
  const base = { ok: true as const, action, target, warnings };
  // OD-6 (DEC-067): an editor's own save may change the file beyond canonical form.
  if (mutating && prepared.target.kind === "editor" && !isTrue(r.dryRun)) {
    warnings.push(
      "saved by the editor's own Save: it may change the file beyond canonical form (OD-6); compare the file with its version-control copy",
    );
  }

  if (action === "describe") {
    const mode = str(params.mode) || "summary";
    const total = Number(r.total ?? 0);
    const limit = Number(params.limit ?? 100);
    const readback: Raw = {
      rootClass: str(r.rootClass),
      total,
      capped: isTrue(r.capped),
    };
    if (isTrue(r.capped)) warnings.push(`the walk stopped at ${MAX_ROWS} rows (capped)`);
    if (mode === "summary") {
      readback.typeCounts = counts(strs(r.typeCounts));
      readback.set = Number(r.setCount ?? 0);
      readback.default = Number(r.defaultCount ?? 0);
      readback.children = strs(r.children);
      readback.topSet = strs(r.topSet);
    } else {
      readback.rows = rowsToObjects(strs(r.rows), columns, schema ? SCHEMA_COLUMNS : COLUMNS);
      readback.nextCursor = str(r.nextCursor) || null;
    }
    const overOnePage = mode === "summary" ? total > LIMIT_MAX : total > limit;
    if (overOnePage || isWorld) {
      const s = await spill(client, target, deps, schema);
      if ("error" in s) {
        warnings.push(`the full dump was not written: ${str(s.error.message)}`);
      } else {
        readback.artifact = s.path;
        readback.artifactRows = s.rows;
      }
    }
    return { ...base, changed: null, readback };
  }

  if (action === "get") {
    const readback: Raw = {
      path: params.path,
      type: str(r.varType),
      objectClass: str(r.objectClass) || undefined,
      value: str(r.value),
    };
    // An element read ("name[i]") answers its class only: no set flags, no default.
    if (str(r.varType) !== "element") {
      readback.isSet = isTrue(r.isSet);
      readback.isSetDirectly = isTrue(r.isSetDirectly);
      readback.defaultValue = str(r.defaultValue);
    }
    // The variable's schema (W2 2.4): UI widget, limits "min,max,step", enum entries "name=value".
    if (str(r.widget)) readback.widget = str(r.widget);
    if (str(r.limits)) readback.limits = str(r.limits);
    const enumValues = strs(r.enumValues);
    if (enumValues.length) readback.enumValues = enumValues;
    return { ...base, changed: null, readback };
  }

  if (action === "set") {
    const path = str(params.path);
    if (isTrue(r.dryRun)) {
      return {
        ...base,
        changed: null,
        readback: {
          dryRun: true,
          type: str(r.varType),
          wouldChange: [{ path, before: str(r.before), after: str(r.after) }],
          sourceAddons: str(r.sourceAddons),
        },
        next: "Resend with confirm: true to set the value and save the file.",
      };
    }
    const change: Change = { path, before: str(r.before), after: str(r.after) };
    // The handler reads the variable back after Set: say so when the engine kept another value
    // (an empty string on an inherited variable drops the override and the parent value shows).
    if (str(r.after) !== str(params.value)) {
      warnings.push(
        `the engine reads back "${str(r.after)}", not the value sent: the variable took its inherited or default value`,
      );
    }
    const isEntity = prepared.target.kind === "entity";
    return {
      ...base,
      changed: [change],
      readback: {
        type: str(r.varType),
        value: str(r.after),
        ...(isEntity ? entityReadback(r, warnings) : fileReadback(r)),
      },
    };
  }

  if (action === "clear" || action === "setClass" || isArrayAction(action)) {
    return mapWrite(action, params, r, base, warnings, prepared.target.kind === "entity");
  }

  // save
  if (isTrue(r.dryRun)) {
    return {
      ...base,
      changed: null,
      readback: {
        dryRun: true,
        file: str(r.savedPath),
        message: str(r.message),
        sourceAddons: str(r.sourceAddons),
      },
      next: "Resend with confirm: true to write the file.",
    };
  }
  warnings.push(
    "canonicalised: unknown; the engine re-writes the text in its canonical form for most types (U11)",
  );
  return {
    ...base,
    changed: [{ path: str(r.savedPath), before: null, after: "saved" }],
    readback: {
      file: str(r.savedPath),
      saved: isTrue(r.saved),
      canonicalised: "unknown",
      sourceAddons: str(r.sourceAddons),
    },
  };
}

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = CONTAINER_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
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
  return shape;
}

export function registerWbContainer(
  server: McpServer,
  client: WorkbenchClient,
  deps: ContainerDeps = {},
): void {
  server.registerTool(
    "wb_container",
    { description: WB_CONTAINER_DESCRIPTION, inputSchema: flatInputShape() },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      const res = await runContainer(client, input, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
