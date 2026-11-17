/**
 * `wb_script_editor`: the Script Editor's active file through EMCP_WB_ScriptEditor
 * (wave W3, phase5-w3-spec.md section 2.1). Lines are 0-based, as the handler and the engine are
 * (KD-010: the 1.x tool called them 1-based and sent them unchanged).
 *
 *   state, getLines                  read; getLines is paged (`start` or `cursor`, `limit`)
 *   open, jump                       view changes: open a script tab, go to a symbol's definition
 *   setLine, insertLine, removeLine,
 *   replaceRange                     in-memory edits of the project's open file (nothing is saved);
 *                                    each answers the old text (`before`/`removed`) to restore it
 *   save                             writes the file; a dry run until `confirm: true`. W3 run 3:
 *                                    Save answered false (nothing written) for every script outside
 *                                    the script module folders (SAVE_LIMIT)
 *   close                            GATED by the handler until probe P-W3-04 passes (DEC-063)
 *
 * 1.x names still work here and are mapped in TypeScript (DEC-061, LEGACY_MAP):
 *
 *   getCurrentFile   state
 *   getLine          getLines (limit 1); its `line` is 1-based, as the 1.x tool documented it
 *   getLinesCount    state
 *   openFile         open
 *
 * The same-named edit actions take 0-based lines. A caller that counts from 1 sets
 * `oneBased: true` on getLines, setLine, insertLine, removeLine or replaceRange: the number is
 * converted here (line N becomes N - 1) before it is sent, and the answer says so.
 *
 * The request is checked against the contract's per-action schema before anything is sent (nothing
 * here names a sandbox or a project; the handler's project guard answers NOT_IN_PROJECT).
 * Not registered here: src/server.ts calls registerWbScriptEditor.
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
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_ScriptEditor";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const SCRIPT_EDITOR_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const SCRIPT_EDITOR_REQUEST_SCHEMA = buildRequestSchema(SCRIPT_EDITOR_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbScriptEditorDescription(): string {
  return checkedDescription(SCRIPT_EDITOR_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = SCRIPT_EDITOR_CONTRACT.actions.map((a) => a.name);

/** 1.x action name to what this tool sends (DEC-061). */
export const LEGACY_MAP: Readonly<Record<string, string>> = {
  getCurrentFile: "state",
  getLine: "getLines (limit 1, 1-based line)",
  getLinesCount: "state",
  openFile: "open",
};
/** LEGACY_MAP's keys, written out so the census (E11) reads them as literals. */
export const LEGACY_ACTIONS: string[] = ["getCurrentFile", "getLine", "getLinesCount", "openFile"];

/** NO_DOCUMENT and TEXT_CHANGED (phase5-w3-spec.md section 1) are in the shared vocabulary. */
export type ScriptEditorCode = ErrorCode;

/** The most lines one replaceRange replaces or supplies (the handler's RANGE_MAX). */
export const RANGE_MAX = 200;
const SYMBOL_MAX = 256;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LINE_KEYS: Readonly<Record<string, string>> = {
  getLines: "start",
  setLine: "line",
  insertLine: "line",
  removeLine: "line",
  replaceRange: "start",
};

const MUTATING = new Set(
  SCRIPT_EDITOR_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name),
);

const TIMEOUT_MS = 30_000;

type Raw = Record<string, unknown>;

export interface ScriptEditorError {
  ok: false;
  action: string;
  target: string;
  code: ScriptEditorCode;
  message: string;
  next: string;
  warnings: string[];
  /** What the handler knew when an edit failed after it began (old text, rows, counts). */
  readback?: unknown;
}
export type ScriptEditorResponse = ActionOk | ScriptEditorError;

/** The client surface this tool needs (a fake in tests). */
export type ScriptEditorClient = Pick<WorkbenchClient, "call">;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function defaultNext(code: ScriptEditorCode): string {
  return ERROR_CODES[code];
}

function fail(
  action: string,
  target: string,
  code: ScriptEditorCode,
  message: string,
  next?: string,
): ScriptEditorError {
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

function hasBreak(s: string): boolean {
  return s.includes("\n") || s.includes("\r");
}

// ── Request checks ────────────────────────────────────────────────────────────

/** The refusal text for a value that fails a check, or undefined. Runs after the schema. */
function checkValues(action: string, p: Raw): string | undefined {
  if (typeof p.start === "number" && p.start < 0) {
    return "start must be 0 or more (lines are 0-based)";
  }
  if (typeof p.line === "number" && p.line < 0) {
    return "line must be 0 or more (lines are 0-based)";
  }
  if (typeof p.count === "number" && (p.count < 0 || p.count > RANGE_MAX)) {
    return `count must be 0 to ${RANGE_MAX}`;
  }
  if (
    p.limit !== undefined &&
    (typeof p.limit !== "number" || p.limit < 1 || p.limit > LIMIT_MAX)
  ) {
    return `limit must be 1 to ${LIMIT_MAX}`;
  }
  if (typeof p.text === "string" && hasBreak(p.text)) {
    return "text holds a line break; one line is written at a time (replaceRange takes several)";
  }
  if (action === "replaceRange") {
    const lines = strs(p.lines);
    if (lines.length > RANGE_MAX) {
      return `at most ${RANGE_MAX} lines are given per call; split the edit`;
    }
    const bad = lines.findIndex(hasBreak);
    if (bad >= 0) return `lines[${bad}] holds a line break; pass one entry per line`;
    const expected = strs(p.expected);
    const badExpected = expected.findIndex(hasBreak);
    if (badExpected >= 0) return `expected[${badExpected}] holds a line break`;
    if (expected.length > 0 && typeof p.count === "number" && expected.length !== p.count) {
      return `expected holds ${expected.length} lines, count is ${p.count}`;
    }
    if (p.count === 0 && lines.length === 0) {
      return "count is 0 and lines is empty: nothing to replace";
    }
  }
  return undefined;
}

function targetOf(p: Raw): string {
  if (typeof p.path === "string" && p.path !== "") return `path:${p.path}`;
  if (typeof p.symbol === "string" && p.symbol !== "") return `symbol:${p.symbol}`;
  return "script:current";
}

/** Checks the `open` path: clean relative, ends in .c. Returns the normalised path. */
function checkScriptPath(raw: string): string {
  const norm = checkRelativePath(raw);
  if (norm.includes(":")) {
    throw new VocabularyError(
      "ABSOLUTE_PATH",
      `a drive or prefix is not allowed in a path: ${raw}`,
    );
  }
  if (norm.split("/").some((seg) => seg === "" || seg === ".")) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `empty or '.' segment, or a leading or trailing slash in the path: ${raw}`,
    );
  }
  if (!norm.toLowerCase().endsWith(".c")) {
    throw new VocabularyError("INVALID_ARGUMENT", `path is not a .c script: ${norm}`);
  }
  return norm;
}

/** Checks `Class` or `Class.Member`; a script identifier on each side, at most 256 chars. */
function checkSymbol(symbol: string): string | undefined {
  if (symbol === "" || symbol.length > SYMBOL_MAX) {
    return `symbol must be 1 to ${SYMBOL_MAX} characters`;
  }
  const parts = symbol.split(".");
  if (parts.length > 2) return `symbol must be Class or Class.Member: ${symbol}`;
  const bad = parts.find((x) => !IDENT.test(x));
  if (bad !== undefined) return `'${bad}' is not a script identifier in the symbol ${symbol}`;
  return undefined;
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | {
      ok: true;
      action: string;
      target: string;
      mutating: boolean;
      params: Raw;
      warnings: string[];
    }
  | { ok: false; error: ScriptEditorError };

/**
 * Validates a handler-surface request. Nothing is sent when this refuses. `oneBased: true`
 * (1.x callers) is removed here and the line number of the action is converted to 0-based.
 */
export function prepareRequest(input: unknown): Prepared {
  const raw = { ...((input ?? {}) as Raw) };
  const action = str(raw.action);
  const target = targetOf(raw);
  const refuse = (code: ScriptEditorCode, message: string): Prepared => ({
    ok: false,
    error: fail(action, target, code, message),
  });
  if (!HANDLER_ACTIONS.includes(action)) {
    return refuse(
      "INVALID_ARGUMENT",
      `unknown action '${action}'; one of ${[...HANDLER_ACTIONS, ...LEGACY_ACTIONS].join(", ")}`,
    );
  }

  const warnings: string[] = [];
  if (raw.oneBased !== undefined) {
    const key = LINE_KEYS[action];
    if (typeof raw.oneBased !== "boolean")
      return refuse("INVALID_ARGUMENT", "oneBased must be true or false");
    if (raw.oneBased) {
      if (!key) return refuse("INVALID_ARGUMENT", `oneBased does not apply to ${action}`);
      const n = raw[key];
      if (typeof n === "number") {
        if (!Number.isInteger(n) || n < 1) {
          return refuse("INVALID_ARGUMENT", `${key} counts from 1 with oneBased, got ${String(n)}`);
        }
        raw[key] = n - 1;
        warnings.push(
          `oneBased: ${key} ${n} was sent as ${n - 1}; the answer and the handler count lines from 0`,
        );
      }
    }
    delete raw.oneBased;
  }

  const parsed = SCRIPT_EDITOR_REQUEST_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return refuse("INVALID_ARGUMENT", issues.join("; "));
  }
  const req = { ...(parsed.data as Raw) };
  const why = checkValues(action, req);
  if (why) return refuse("INVALID_ARGUMENT", why);

  if (typeof req.cursor === "string" && req.cursor !== "") {
    try {
      parseCursor(req.cursor);
    } catch (e) {
      if (e instanceof VocabularyError) return refuse(e.code, e.message);
      throw e;
    }
  }
  if (action === "open") {
    try {
      req.path = checkScriptPath(str(req.path));
    } catch (e) {
      if (e instanceof VocabularyError) return refuse(e.code, e.message);
      throw e;
    }
  }
  if (action === "jump") {
    const bad = checkSymbol(str(req.symbol));
    if (bad) return refuse("INVALID_ARGUMENT", bad);
  }
  if (action === "save" || action === "close") req.confirm = req.confirm === true;
  return {
    ok: true,
    action,
    target: targetOf(req),
    mutating: MUTATING.has(action),
    params: req,
    warnings,
  };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** The facts an edit that failed after it began still reports, for the caller to restore from. */
function partial(r: Raw): Raw {
  const out: Raw = {};
  for (const k of ["file", "line", "start", "linesCount"] as const) {
    const n = k === "file" ? str(r[k]) || null : num(r[k]);
    if (n !== null) out[k] = n;
  }
  for (const k of ["before", "after"] as const) if (typeof r[k] === "string") out[k] = r[k];
  for (const k of ["removed", "rows"] as const) {
    if (Array.isArray(r[k]) && (r[k] as unknown[]).length > 0) out[k] = strs(r[k]);
  }
  return out;
}

/** A handler refusal or error as a ScriptEditorError, else null. */
function handlerFailure(action: string, target: string, r: Raw): ScriptEditorError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ScriptEditorCode = status === "error" ? "ENGINE_FALSE" : "INVALID_ARGUMENT";
    const code = (KNOWN_CODES.has(raw) ? raw : fallback) as ScriptEditorCode;
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
    e.warnings.push(...strs(r.warnings));
    if (status === "error") e.readback = partial(r);
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: ScriptEditorClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: ScriptEditorError }> {
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: TIMEOUT_MS,
    });
    const f = handlerFailure(action, target, r);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating) {
      f.next =
        "The call was lost and is never retried; read back with wb_script_editor getLines first.";
    }
    return { error: f };
  }
}

// ── Shaping ───────────────────────────────────────────────────────────────────

const NOT_SAVED = "nothing is saved: wb_script_editor save with confirm: true writes the file";

/**
 * P-W3-06 (W3 live run 2, w3-20): one Edit > Undo of the Script Editor after a setLine left the
 * line empty, neither the new nor the old text. Undo is not offered as the restore of a SetLineText.
 */
export const UNDO_NOT_THE_RESTORE =
  "Edit > Undo is not the restore for this edit: one undo after a setLine left the line empty (P-W3-06); restore with the returned before/removed text";

/**
 * W3 live run 3 (w3-40, w3-41, w3-61): Save returned false for every script under _throwaway/W3/
 * (outside every script module folder, not registered), edited or not, with the tab current, and
 * wrote nothing. Not proven: whether it saves a script inside a script module folder.
 */
export const SAVE_LIMIT =
  "Save answered false (ENGINE_FALSE, nothing written) for every script outside the script module folders in W3 run 3; a script inside a module folder is not proven either way";

function lineTarget(r: Raw, line: unknown): string {
  const file = str(r.relPath) || str(r.file) || "script";
  const n = num(line);
  return n === null ? file : `${file}:${n}`;
}

function shapeOk(action: string, target: string, r: Raw, warnings: string[]): ActionOk {
  const w = [...warnings];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  switch (action) {
    case "state": {
      const opened = truthy(r.opened);
      const link = str(r.link);
      readback = {
        opened,
        file: str(r.file),
        relPath: str(r.relPath),
        inProject: truthy(r.inProject),
        line: num(r.line),
        linesCount: num(r.linesCount),
        link,
        mayHaveOpened: truthy(r.mayHaveOpened),
      };
      if (!opened) next = "wb_script_editor open opens a script";
      else if (!truthy(r.inProject)) {
        w.push("the open file is outside the project: line edits and save are refused for it");
      }
      if (link) w.push("the line base of the link is not yet proven");
      break;
    }
    case "getLines": {
      const cursor = str(r.nextCursor);
      readback = {
        start: num(r.start),
        total: num(r.total),
        rows: strs(r.rows),
        nextCursor: cursor || null,
        mayHaveOpened: truthy(r.mayHaveOpened),
      };
      if (cursor) next = `wb_script_editor getLines with cursor "${cursor}" for the next page`;
      break;
    }
    case "open":
      readback = {
        result: truthy(r.result),
        file: str(r.file),
        relPath: str(r.relPath),
        inProject: truthy(r.inProject),
        linesCount: num(r.linesCount),
        mayHaveOpened: truthy(r.mayHaveOpened),
      };
      break;
    case "jump":
      readback = {
        result: truthy(r.result),
        file: str(r.file),
        relPath: str(r.relPath),
        line: num(r.line),
        mayHaveOpened: truthy(r.mayHaveOpened),
      };
      break;
    case "setLine":
      readback = {
        line: num(r.line),
        before: str(r.before),
        after: str(r.after),
        linesCount: num(r.linesCount),
      };
      changed = [{ path: lineTarget(r, r.line), before: str(r.before), after: str(r.after) }];
      next = `setLine with the before text restores it; ${NOT_SAVED}`;
      w.push(UNDO_NOT_THE_RESTORE);
      break;
    case "insertLine":
      readback = { line: num(r.line), after: str(r.after), linesCount: num(r.linesCount) };
      changed = [{ path: lineTarget(r, r.line), before: null, after: str(r.after) }];
      next = `removeLine at the same line takes it out again; ${NOT_SAVED}`;
      break;
    case "removeLine":
      readback = { line: num(r.line), before: str(r.before), linesCount: num(r.linesCount) };
      changed = [{ path: lineTarget(r, r.line), before: str(r.before), after: null }];
      next = `insertLine with the before text puts it back; ${NOT_SAVED}`;
      break;
    case "replaceRange": {
      const removed = strs(r.removed);
      const rows = strs(r.rows);
      readback = {
        start: num(r.start),
        removed,
        rows,
        linesCount: num(r.linesCount),
      };
      changed = [{ path: lineTarget(r, r.start), before: removed, after: rows }];
      next = `replaceRange with the removed lines (count = rows.length, expected = rows) restores them; ${NOT_SAVED}`;
      w.push(UNDO_NOT_THE_RESTORE);
      break;
    }
    case "save": {
      const dryRun = truthy(r.dryRun);
      w.push(...strs(r.warnings));
      w.push(SAVE_LIMIT);
      readback = {
        dryRun,
        relPath: str(r.relPath),
        saved: truthy(r.saved),
        mayHaveOpened: truthy(r.mayHaveOpened),
      };
      if (dryRun) next = "Resend with confirm: true to save the file.";
      else {
        changed = [{ path: str(r.relPath), before: "unsaved edits", after: "saved" }];
      }
      break;
    }
    case "close":
      w.push(...strs(r.warnings));
      readback = { dryRun: truthy(r.dryRun), closed: truthy(r.closed) };
      if (truthy(r.dryRun)) next = "Resend with confirm: true to close the Script Editor.";
      break;
    default:
      readback = r;
  }
  const out: ActionOk = { ok: true, action, target, changed, readback, warnings: w };
  if (next) out.next = next;
  return out;
}

// ── 1.x names ─────────────────────────────────────────────────────────────────

const LEGACY_SCHEMAS: Record<string, z.ZodTypeAny> = {
  getCurrentFile: z.object({ action: z.literal("getCurrentFile") }).strict(),
  getLine: z.object({ action: z.literal("getLine"), line: z.number().int().min(1) }).strict(),
  getLinesCount: z.object({ action: z.literal("getLinesCount") }).strict(),
  openFile: z.object({ action: z.literal("openFile"), path: z.string().min(1) }).strict(),
};

function mappedWarning(action: string): string {
  return `1.x action name '${action}': sent as ${LEGACY_MAP[action]} (DEC-061); the handler has one action surface`;
}

async function runLegacy(client: ScriptEditorClient, input: Raw): Promise<ScriptEditorResponse> {
  const action = str(input.action);
  const target = targetOf(input);
  const parsed = LEGACY_SCHEMAS[action]!.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return fail(action, target, "INVALID_ARGUMENT", issues.join("; "));
  }
  const p = parsed.data as Raw;
  const warn = mappedWarning(action);

  if (action === "openFile") {
    const r = await runScriptEditor(client, { action: "open", path: p.path });
    return { ...r, action, warnings: [warn, ...r.warnings] };
  }

  if (action === "getLine") {
    const line = p.line as number;
    const s = await runScriptEditor(client, { action: "getLines", start: line - 1, limit: 1 });
    if (!s.ok) return { ...s, action, warnings: [warn, ...s.warnings] };
    const rb = s.readback as { rows: string[]; total: number | null };
    if (rb.rows.length === 0) {
      return fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `line ${line} is past the end (the file has ${String(rb.total ?? "?")} lines; getLine counts from 1)`,
        "wb_script_editor state gives the line count",
      );
    }
    return {
      ok: true,
      action,
      target: s.target,
      changed: null,
      readback: { line, lineText: rb.rows[0], total: rb.total },
      warnings: [warn, "line is 1-based here (the 1.x contract); getLines takes 0-based start"],
    };
  }

  // getCurrentFile and getLinesCount read state.
  const s = await runScriptEditor(client, { action: "state" });
  if (!s.ok) return { ...s, action, warnings: [warn, ...s.warnings] };
  const rb = s.readback as { opened: boolean; file: string; linesCount: number | null };
  const base = { ok: true as const, action, target: s.target, changed: null };
  if (action === "getCurrentFile") {
    return {
      ...base,
      readback: { currentFile: rb.opened ? rb.file : "(no file open)", ...rb },
      warnings: [warn, ...s.warnings],
    };
  }
  if (!rb.opened) {
    return fail(
      action,
      target,
      "NO_DOCUMENT",
      "no file is open in the Script Editor",
      "wb_script_editor open",
    );
  }
  return {
    ...base,
    readback: { linesCount: rb.linesCount },
    warnings: [warn, ...s.warnings],
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_script_editor request end to end; never throws for a Workbench-side failure. */
export async function runScriptEditor(
  client: ScriptEditorClient,
  input: unknown,
): Promise<ScriptEditorResponse> {
  const raw = (input ?? {}) as Raw;
  if (LEGACY_ACTIONS.includes(str(raw.action))) return runLegacy(client, raw);
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params, warnings } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) {
    s.error.warnings.unshift(...warnings);
    return s.error;
  }
  return shapeOk(action, target, s.r, warnings);
}

export function toToolResult(r: ScriptEditorResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = SCRIPT_EDITOR_CONTRACT): z.ZodRawShape {
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
  shape.oneBased = z
    .boolean()
    .optional()
    .describe(
      "1.x: the line or start number counts from 1 (getLines, setLine, insertLine, removeLine, replaceRange); default is 0-based",
    );
  return shape;
}

export function registerWbScriptEditor(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_script_editor",
    {
      description: wbScriptEditorDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Script Editor",
        readOnlyHint: false,
        // Line edits change an open file in memory; save (confirm) overwrites it on disk.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runScriptEditor(client, input));
    },
  );
}
