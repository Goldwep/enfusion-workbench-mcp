/**
 * `wb_localization`: the string table open in the Localization Editor, through EMCP_WB_Localization
 * (wave W3, phase5-w3-spec.md section 2.2; KD-009, DEC-061, DEC-063 OD-5).
 *
 *   status, columns, list, get, selection   reads (list is paged: `cursor`, `limit`)
 *   open                                    opens a .st (a view; the handler refuses to replace a
 *                                           table that has its own unsaved edits)
 *   insert, set, delete                     in-memory edits inside one undo point, read back
 *   filter                                  a user filter on a column (a view)
 *   save                                    WBModuleDef.Save; a dry run unless `confirm: true`
 *   buildRuntime, close                     GATED (contract `refuses`): refused here, nothing sent
 *
 * The 1.x action names still work and are mapped here (DEC-061), the handler has one surface:
 *
 *   getTable       list
 *   listLanguages  columns (the readback adds `languages`)
 *   modify         set, from { itemId, property, value } to { id, fields: [property], values: [value] }
 *
 * and the 1.x keys `itemId`, `property`, `value` are lifted onto insert and delete the same way.
 * Of the old property names only `en_us` and `target` are mapped (to Target_en_us): the 1.x handler
 * read columns that the table does not have.
 *
 * Every request is checked against the contract's per-action schema and the handler's own value
 * rules before anything is sent. The save dry run and the edit answers carry the OD-5 warning: the
 * engine's SCR_LocModifiedPlugin writes the Workbench user name into Author and LastChanged.
 * Nothing here names a project or a sandbox. Not registered here: src/server.ts registers it.
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
  checkRelativePath,
  parseCursor,
  type ActionOk,
  type Change,
} from "../manifest/vocabulary.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Localization";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const LOCALIZATION_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const LOCALIZATION_REQUEST_SCHEMA = buildRequestSchema(LOCALIZATION_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbLocalizationDescription(): string {
  return checkedDescription(LOCALIZATION_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = LOCALIZATION_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(
  LOCALIZATION_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name),
);

/**
 * Actions the contract marks GATED (its `refuses` starts with GATED): refused here before sending,
 * with the handler's own next step. They follow the contract when a probe un-gates them.
 */
export const GATED_ACTIONS: readonly string[] = LOCALIZATION_CONTRACT.actions
  .filter((a) => a.refuses?.startsWith("GATED"))
  .map((a) => a.name);

const GATED_NEXT: Record<string, string> = {
  buildRuntime: "string_table buildRuntime (offline) writes the runtime table",
  close: "the owner closes the Localization Editor by hand",
};

/** 1.x action name to what this tool sends (DEC-061). */
export const LEGACY_MAP: Readonly<Record<string, string>> = {
  getTable: "list",
  listLanguages: "columns",
  modify: "set",
};
/** LEGACY_MAP's keys, written out so the census (E11) reads them as literals. */
export const LEGACY_ACTIONS: string[] = ["getTable", "listLanguages", "modify"];

/** The only 1.x property names with a field behind them. */
export const LEGACY_FIELDS: Readonly<Record<string, string>> = {
  en_us: "Target_en_us",
  target: "Target_en_us",
};

/** DEC-063 OD-5, said by every edit answer and by the save dry run. */
export const AUTHOR_WARNING =
  "the engine's SCR_LocModifiedPlugin writes the Workbench user name into Author and LastChanged of an edited item; the saved .st keeps that name (OD-5)";

/** NO_DOCUMENT and MODAL_HAZARD (phase5-w3-spec.md section 1) are in the shared vocabulary. */
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

const READ_TIMEOUT_MS = 30_000;
const FIELDS_MAX = 64;

type Raw = Record<string, unknown>;

export interface LocalizationError {
  ok: false;
  action: string;
  target: string;
  code: string;
  message: string;
  next: string;
  warnings: string[];
  readback?: unknown;
}

export type LocalizationResponse = ActionOk | LocalizationError;

/** The client surface this tool needs (a fake in tests). */
export type LocalizationClient = Pick<WorkbenchClient, "call">;

function defaultNext(code: string): string {
  return (ERROR_CODES as Record<string, string>)[code] ?? "Read the message.";
}

function fail(
  action: string,
  target: string,
  code: string,
  message: string,
  next?: string,
): LocalizationError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || defaultNext(code),
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

function ints(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}

function addWarning(list: string[], text: string, already: RegExp): void {
  if (!list.some((w) => already.test(w))) list.push(text);
}

// ── Rows ──────────────────────────────────────────────────────────────────────

/** Splits a handler row on its unescaped "|" and unescapes each cell ("\\", "\|", "\n", "\r"). */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) {
      const n = line[++i];
      cur += n === "n" ? "\n" : n === "r" ? "\r" : n;
    } else if (c === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

export interface ColumnInfo {
  name: string;
  type: string;
  /** NAME=n pairs of an enum column, else an empty list. */
  enums: string[];
}

/** columns rows "name|type|NAME=n,..." */
export function parseColumns(rows: string[]): ColumnInfo[] {
  return rows.map((line) => {
    const c = line.split("|");
    const enums = (c[2] ?? "").split(",").filter((s) => s !== "");
    return { name: c[0] ?? "", type: c[1] ?? "", enums };
  });
}

/** "name|value" rows (before, after) to [name, value] pairs. */
export function parsePairs(rows: string[]): Array<[string, string]> {
  return rows.map((line) => {
    const c = splitRow(line);
    return [c[0] ?? "", c.slice(1).join("|")];
  });
}

export interface FieldRow {
  name: string;
  type: string;
  value: string;
}

/** get rows "name|type|value" */
export function parseFieldRows(rows: string[]): FieldRow[] {
  return rows.map((line) => {
    const c = splitRow(line);
    return { name: c[0] ?? "", type: c[1] ?? "", value: c.slice(2).join("|") };
  });
}

/** The 1.x language names behind Target_<lang> columns (Target_en_us -> en_us). */
export function languagesOf(columns: ColumnInfo[]): string[] {
  const out: string[] = [];
  for (const c of columns) {
    const m = /^Target_(.+)$/.exec(c.name);
    if (!m || m[1]!.endsWith("_edited")) continue;
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

// ── Request checks ────────────────────────────────────────────────────────────

const GUID_PREFIX = /^\{[0-9A-Fa-f]{16}\}/;

/** A project-relative .st path, plain or with a {GUID} prefix; returns the form that is sent. */
export function checkTablePath(raw: string): string {
  const guid = GUID_PREFIX.exec(raw.trim())?.[0] ?? "";
  const rest = guid ? raw.trim().slice(guid.length) : raw;
  const clean = checkRelativePath(rest);
  if (!clean.toLowerCase().endsWith(".st")) {
    throw new VocabularyError("INVALID_ARGUMENT", `open takes a string table (.st): ${clean}`);
  }
  return guid + clean;
}

/** The index of a field that may name the Id variable, case folded (W3-LOC-4), -1 when none. */
function idFieldAt(fields: string[]): number {
  return fields.findIndex((f) => f.toLowerCase() === "id");
}

function checkFields(
  fields: string[],
  values: string[] | undefined,
  min: number,
): string | undefined {
  if (values !== undefined && fields.length !== values.length) {
    return `fields and values must have the same length (${fields.length} fields, ${values.length} values)`;
  }
  if (fields.length < min) return "give at least one field and its value";
  if (fields.length > FIELDS_MAX) return `at most ${FIELDS_MAX} fields`;
  for (let i = 0; i < fields.length; i++) {
    if (fields[i]!.trim() === "") return `field ${i} is empty`;
    // Case folded: whether the engine's GetVarIndex folds case is unproven (review round 1, W3-LOC-4).
    const folded = fields[i]!.toLowerCase();
    if (fields.findIndex((f) => f.toLowerCase() === folded) !== i) {
      return `field ${fields[i]} is given twice`;
    }
  }
  return undefined;
}

function targetOf(action: string, p: Raw): string {
  if (action === "open" && typeof p.path === "string") return `path:${p.path}`;
  return "table:open";
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | {
      ok: true;
      action: string;
      /** The 1.x name this request came in under, when it was one. */
      legacy?: string;
      target: string;
      mutating: boolean;
      params: Raw;
      warnings: string[];
    }
  | { ok: false; error: LocalizationError };

interface Normalized {
  input: Raw;
  legacy?: string;
  warnings: string[];
  error?: string;
}

/** Maps the 1.x action names and keys onto the handler surface (see the file header). */
export function normalizeLegacy(raw: Raw): Normalized {
  const input: Raw = { ...raw };
  const warnings: string[] = [];
  const oldAction = str(raw.action);
  let legacy: string | undefined;
  if (oldAction in LEGACY_MAP) {
    legacy = oldAction;
    input.action = LEGACY_MAP[oldAction];
    warnings.push(
      `1.x action name '${oldAction}': sent as ${LEGACY_MAP[oldAction]} (DEC-061); the handler has one action surface`,
    );
  }
  const action = str(input.action);
  const hasOld = ["itemId", "property", "value"].some((k) => input[k] !== undefined);
  if (!hasOld) return { input, legacy, warnings };

  const takesItem = action === "set" || action === "insert" || action === "delete";
  if (!takesItem) return { input, legacy, warnings }; // the strict schema names the stray key

  if (input.itemId !== undefined) {
    if (input.id !== undefined && input.id !== input.itemId) {
      return {
        input,
        legacy,
        warnings,
        error: "give id or the 1.x itemId, not two different ones",
      };
    }
    input.id = input.itemId;
    delete input.itemId;
  }
  const writes = action === "set" || action === "insert";
  if (input.property !== undefined || input.value !== undefined) {
    if (!writes) return { input, legacy, warnings };
    if (input.fields !== undefined || input.values !== undefined) {
      return {
        input,
        legacy,
        warnings,
        error: "give fields and values, or the 1.x property and value, not both",
      };
    }
    if (action === "set" && (input.property === undefined || input.value === undefined)) {
      return { input, legacy, warnings, error: "the 1.x modify needs itemId, property and value" };
    }
    if (input.value !== undefined) {
      const given = typeof input.property === "string" ? input.property : "";
      const field = given === "" ? "Target_en_us" : (LEGACY_FIELDS[given] ?? given);
      if (field !== given) {
        warnings.push(`1.x property '${given || "(none)"}' sent as the field ${field}`);
      }
      input.fields = [field];
      input.values = [String(input.value)];
    } else if (action === "insert") {
      return { input, legacy, warnings, error: "the 1.x property without a value" };
    }
    delete input.property;
    delete input.value;
  }
  if (input.itemId !== undefined) delete input.itemId;
  return { input, legacy, warnings };
}

/** Validates one request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const rawIn = (input ?? {}) as Raw;
  const norm = normalizeLegacy(rawIn);
  const raw = norm.input;
  const action = str(raw.action);
  const target = targetOf(action, raw);
  if (norm.error) {
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", norm.error) };
  }
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
  const parsed = LOCALIZATION_REQUEST_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const refuse = (why: string, code = "INVALID_ARGUMENT") => ({
    ok: false as const,
    error: fail(action, target, code, why),
  });

  if (GATED_ACTIONS.includes(action)) {
    const a = LOCALIZATION_CONTRACT.actions.find((x) => x.name === action);
    return {
      ok: false,
      error: fail(
        action,
        target,
        "GATED",
        `${action}: ${a?.refuses ?? "gated"}. Nothing was sent.`,
        GATED_NEXT[action],
      ),
    };
  }

  if (typeof req.limit === "number" && (req.limit < 1 || req.limit > LIMIT_MAX)) {
    return refuse(`limit must be 1 to ${LIMIT_MAX}`);
  }
  if (typeof req.cursor === "string" && req.cursor !== "") {
    try {
      parseCursor(req.cursor);
    } catch (e) {
      if (e instanceof VocabularyError) return refuse(e.message, e.code);
      throw e;
    }
  }
  const params: Raw = { ...req };

  if (action === "open") {
    try {
      params.path = checkTablePath(str(req.path));
    } catch (e) {
      if (e instanceof VocabularyError) return refuse(e.message, e.code);
      throw e;
    }
  }
  if (action === "get" || action === "set" || action === "delete") {
    const hasId = typeof req.id === "string" && req.id !== "";
    const idx = req.index as number | undefined;
    if (req.id === "") return refuse("id is empty; give the item Id or its index");
    if (idx !== undefined && idx < 0) return refuse("index must be 0 or higher");
    if (!hasId && idx === undefined) return refuse("give id or index");
  }
  if (action === "insert") {
    const id = str(req.id);
    if (id.trim() === "") return refuse("the new item's id is empty");
    if (/[\r\n]/.test(id)) return refuse("the item Id holds a line break");
    const fields = (req.fields as string[] | undefined) ?? [];
    const values = (req.values as string[] | undefined) ?? [];
    const why = checkFields(fields, values, 0);
    if (why) return refuse(why);
    if (idFieldAt(fields) >= 0) return refuse("the Id is given by id, not as a field");
  }
  if (action === "set") {
    const fields = req.fields as string[];
    const why = checkFields(fields, req.values as string[], 1);
    if (why) return refuse(why);
    const at = idFieldAt(fields);
    if (at >= 0) {
      const newId = (req.values as string[])[at]!;
      if (newId.trim() === "" || /[\r\n]/.test(newId)) {
        return refuse("the new Id is empty or holds a line break");
      }
    }
  }
  if (action === "list" && req.fields !== undefined) {
    const why = checkFields(req.fields as string[], undefined, 0);
    if (why) return refuse(why);
  }
  if (action === "filter") {
    if (str(req.column).trim() === "") return refuse("column is empty; give a field name");
    if (str(req.filter) === "") return refuse("filter is empty; give the text the column contains");
  }
  if (action === "save") params.confirm = req.confirm === true;

  return {
    ok: true,
    action,
    legacy: norm.legacy,
    target: targetOf(action, params),
    mutating: MUTATING.has(action),
    params,
    warnings: norm.warnings,
  };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a LocalizationError, else null. */
function handlerFailure(
  action: string,
  target: string,
  r: Raw,
  mutating: boolean,
): LocalizationError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback = status === "error" ? "ENGINE_FALSE" : "INVALID_ARGUMENT";
    const code = KNOWN_CODES.has(raw) ? raw : fallback;
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
    if (status === "error" && mutating) {
      // The edit ran and then did not read back as sent: say where it stands.
      e.readback = {
        id: str(r.id) || null,
        index: num(r.index),
        before: strs(r.before),
        after: strs(r.after),
      };
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: LocalizationClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: LocalizationError }> {
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: READ_TIMEOUT_MS,
    });
    const f = handlerFailure(action, target, r, mutating);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating) {
      f.next =
        "The call was lost and is never retried; read back with wb_localization get or list first.";
    }
    return { error: f };
  }
}

// ── Shaping ───────────────────────────────────────────────────────────────────

const NOT_SAVED = "in memory only: wb_localization save with confirm: true writes the .st file";

function pairChanges(id: string, before: Array<[string, string]>, after: Array<[string, string]>) {
  const was = new Map(before);
  return after.map(
    ([name, value]): Change => ({
      path: `${id}.${name}`,
      before: was.has(name) ? was.get(name) : null,
      after: value,
    }),
  );
}

function shapeOk(
  action: string,
  target: string,
  legacy: string | undefined,
  r: Raw,
  warnings: string[],
): ActionOk {
  // The handler's own warnings first: the OD-5 text is added below only when none carries it.
  for (const w of strs(r.warnings)) if (!warnings.includes(w)) warnings.push(w);
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  const id = str(r.id);
  const index = num(r.index);
  const at = index !== null && index >= 0 ? index : null;

  switch (action) {
    case "status":
      readback = {
        table: str(r.table) || null,
        inProject: truthy(r.inProject),
        itemClass: str(r.itemClass) || null,
        total: num(r.total) ?? 0,
        message: str(r.message),
      };
      break;
    case "columns": {
      const columns = parseColumns(strs(r.columns));
      readback = { itemClass: str(r.itemClass) || null, columns };
      if (legacy === "listLanguages") (readback as Raw).languages = languagesOf(columns);
      break;
    }
    case "list": {
      const names = strs(r.columns);
      const cursor = str(r.nextCursor);
      readback = {
        columns: names,
        total: num(r.total) ?? 0,
        rows: strs(r.rows).map((line) => {
          const cells = splitRow(line);
          const row: Raw = { index: Number(cells[0]) };
          names.slice(1).forEach((n, i) => {
            row[n] = cells[i + 1] ?? "";
          });
          return row;
        }),
        nextCursor: cursor || null,
      };
      if (cursor) next = `wb_localization list with cursor "${cursor}" for the next page`;
      break;
    }
    case "get":
      readback = { id, index: at, fields: parseFieldRows(strs(r.rows)) };
      break;
    case "selection":
      readback = { selected: ints(r.selected), filtered: ints(r.filtered) };
      break;
    case "open":
      readback = {
        opened: truthy(r.result),
        table: str(r.table),
        inProject: truthy(r.inProject),
        total: num(r.total) ?? 0,
      };
      next = "wb_localization list reads the items";
      break;
    case "insert": {
      const after = parsePairs(strs(r.after));
      readback = {
        id,
        index: at,
        total: num(r.total) ?? 0,
        after: after.map(([n, v]) => ({ name: n, value: v })),
      };
      changed = [{ path: `Items[${at ?? "?"}]`, before: null, after: id }];
      next = NOT_SAVED;
      addWarning(warnings, AUTHOR_WARNING, /Author/);
      break;
    }
    case "set": {
      const before = parsePairs(strs(r.before));
      const after = parsePairs(strs(r.after));
      readback = {
        id,
        index: at,
        before: before.map(([n, v]) => ({ name: n, value: v })),
        after: after.map(([n, v]) => ({ name: n, value: v })),
      };
      changed = pairChanges(id, before, after);
      next = NOT_SAVED;
      addWarning(warnings, AUTHOR_WARNING, /Author/);
      break;
    }
    case "delete": {
      const removed = parsePairs(strs(r.before));
      readback = {
        id,
        index: at,
        total: num(r.total) ?? 0,
        removed: removed.map(([n, v]) => ({ name: n, value: v })),
        // What wb_localization insert needs to put it back (the Id travels as `id`).
        restore: {
          action: "insert",
          id,
          fields: removed.filter(([n]) => n !== "Id").map(([n]) => n),
          values: removed.filter(([n]) => n !== "Id").map(([, v]) => v),
        },
      };
      changed = [{ path: `Items[${at ?? "?"}]`, before: id, after: null }];
      next = NOT_SAVED;
      break;
    }
    case "filter":
      readback = { filtered: ints(r.filtered), message: str(r.message) };
      break;
    case "save": {
      const dry = truthy(r.dryRun);
      addWarning(warnings, AUTHOR_WARNING, /Author/);
      if (dry) {
        readback = { dryRun: true, table: str(r.table), message: str(r.message) };
        next = "Resend with confirm: true to write the .st file.";
      } else {
        readback = { saved: truthy(r.saved), table: str(r.table) };
        changed = [{ path: str(r.table), before: null, after: "saved" }];
      }
      break;
    }
    case "buildRuntime":
      readback = truthy(r.dryRun)
        ? { dryRun: true, table: str(r.table), message: str(r.message) }
        : { built: truthy(r.built), table: str(r.table) };
      if (truthy(r.dryRun)) next = "Resend with confirm: true to build the runtime table.";
      break;
    case "close":
      readback = truthy(r.dryRun) ? { dryRun: true } : { closed: truthy(r.closed) };
      if (truthy(r.dryRun)) next = "Resend with confirm: true to close the table.";
      break;
    default:
      readback = r;
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_localization request end to end; never throws for a Workbench-side failure. */
export async function runLocalization(
  client: LocalizationClient,
  input: unknown,
): Promise<LocalizationResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params, legacy } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) {
    if (prepared.warnings.length) s.error.warnings.unshift(...prepared.warnings);
    return s.error;
  }
  return shapeOk(action, target, legacy, s.r, [...prepared.warnings]);
}

export function toToolResult(r: LocalizationResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = LOCALIZATION_CONTRACT): z.ZodRawShape {
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
      else if (p.type === "array<int>") s = z.array(z.number().int());
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  shape.itemId = z.string().optional().describe("1.x insert/delete/modify: the item Id (now id)");
  shape.property = z.string().optional().describe("1.x modify: the field to set (now fields)");
  shape.value = z.string().optional().describe("1.x insert/modify: the value (now values)");
  return shape;
}

export function registerWbLocalization(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_localization",
    {
      description: wbLocalizationDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Localization Editor",
        readOnlyHint: false,
        // delete removes an item from the open table in memory (a snapshot comes back for insert).
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runLocalization(client, input));
    },
  );
}
