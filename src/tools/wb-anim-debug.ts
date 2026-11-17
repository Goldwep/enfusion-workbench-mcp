/**
 * `wb_anim_debug`: the animation state of one play-mode entity through EMCP_WB_AnimDebug
 * (wave W4, phase5-w4-spec.md section 2.2, DEC-067 OD-1). Play mode only; nothing is written to a file.
 *
 *   vars          read: graph variable values (`names` with one `varTypes` entry each)
 *   tags          read: tags (default) or events (`kind: event`) set this frame
 *   procAnim      read: ProcAnim controllers, signals, bones and slots of one controller
 *   set           a graph variable, in memory (GATED, P-W4-19)
 *   command       a graph command call (GATED, P-W4-19)
 *   btBreakpoint  the AI behavior-tree breakpoint (GATED, P-W4-21)
 *
 * `target` is `entity:<ref>` with `<ref>` one of `id:<hex>`, `name:<name>`, `index:<i>`; a bare
 * `<ref>` is accepted. The handler resolves the bare reference, so the `entity:` prefix is removed
 * before sending. Outside play mode every action answers WRONG_MODE (a handler refusal, passed
 * through with its own `next`). Floats travel as text in both directions: `value` and `floatParam`
 * may be given as numbers and are sent as strings; read values come back as strings.
 *
 * The request is checked against the contract's per-action schema before anything is sent. Nothing
 * here names a sandbox or a project. Not registered here: src/server.ts registers
 * `registerWbAnimDebug`.
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
  VocabularyError,
  parseEntityRef,
  printEntityRef,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_AnimDebug";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const ANIM_DEBUG_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const ANIM_DEBUG_REQUEST_SCHEMA = buildRequestSchema(ANIM_DEBUG_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbAnimDebugDescription(): string {
  return checkedDescription(ANIM_DEBUG_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = ANIM_DEBUG_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(ANIM_DEBUG_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

/**
 * The switches behind the actions the rulings gate. Both are closed: the integrator opens one only
 * after its probe has passed, together with the handler's constant of the same name.
 *   setCommand    P-W4-19: Set*Variable and CallCommand are safe in play mode
 *                 (handler: EMCP_WB_AnimDebug.SET_COMMAND_PROVEN).
 *   btBreakpoint  P-W4-21: SetBtBreakpoint opens no dialog and does not hang play
 *                 (handler: EMCP_WB_AnimDebug.BT_BREAKPOINT_PROVEN).
 */
export const ANIM_DEBUG_GATES = { setCommand: false, btBreakpoint: false };

/** The most names one vars or tags call takes (the handler's MAX_NAMES). */
export const MAX_NAMES = 64;

const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 30_000;

type Raw = Record<string, unknown>;

export type DebugError = ActionError;
export type DebugResponse = ActionOk | DebugError;

/** The client surface this tool needs (a fake in tests). */
export type DebugClient = Pick<WorkbenchClient, "call">;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): DebugError {
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

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0. */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ── Request checks ────────────────────────────────────────────────────────────

const VAR_TYPES = ["int", "float", "bool"];
const FLOAT_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INT_TEXT = /^[+-]?\d+$/;

/** A number as float text without an exponent; NaN, Infinity and 1e21 and over refuse. */
export function formatFloat(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) >= 1e21) {
    throw new VocabularyError("INVALID_ARGUMENT", `not a usable float: ${String(n)}`);
  }
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const fixed = n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" || fixed === "" ? "0" : fixed;
}

/**
 * `entity:<ref>` or a bare `<ref>`, as the canonical reference the handler resolves (no prefix).
 * Throws INVALID_ARGUMENT for anything else.
 */
export function checkTarget(raw: string): string {
  const text = raw.trim();
  const ref = text.startsWith("entity:") ? text.slice(7) : text;
  if (ref === "") {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      "target is empty: pass entity:<ref> (id:<hex>, name:<name> or index:<i>)",
    );
  }
  return printEntityRef(parseEntityRef(ref));
}

function targetOf(p: Raw): string {
  const t = str(p.target).trim();
  if (t === "") return "entity:";
  try {
    return `entity:${checkTarget(t)}`;
  } catch {
    return t.startsWith("entity:") ? t : `entity:${t}`;
  }
}

/** Why a value text is wrong for its type, or undefined. */
export function valueWhy(varType: string, text: string): string | undefined {
  const t = text.trim();
  if (varType === "int") return INT_TEXT.test(t) ? undefined : `value '${text}' is not an int`;
  if (varType === "float") {
    return FLOAT_TEXT.test(t) ? undefined : `value '${text}' is not a float`;
  }
  return ["true", "false", "1", "0"].includes(t.toLowerCase())
    ? undefined
    : `value '${text}' is not true, false, 1 or 0`;
}

/** True when two texts hold the same value of the type (1 and true are the same bool; 0.5 and 0.50 the same float). */
export function sameValue(varType: string, a: string, b: string): boolean {
  if (varType === "bool") {
    const t = (s: string) => ["true", "1"].includes(s.trim().toLowerCase());
    return t(a) === t(b);
  }
  const x = Number(a.trim());
  const y = Number(b.trim());
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a.trim() === b.trim();
}

function checkNames(p: Raw): string | undefined {
  const names = strs(p.names);
  if (names.length === 0) return "names must hold at least one name";
  if (names.length > MAX_NAMES) {
    return `names holds ${names.length} names, at most ${MAX_NAMES}`;
  }
  const empty = names.findIndex((n) => n.trim() === "");
  if (empty >= 0) return `names[${empty}] is empty`;
  return undefined;
}

/** The one-sentence refusal for an input that fails a check, or undefined. */
function checkValues(action: string, p: Raw): string | undefined {
  if (action === "vars" || action === "tags") {
    const why = checkNames(p);
    if (why) return why;
  }
  if (action === "vars") {
    const names = strs(p.names);
    const types = strs(p.varTypes);
    if (types.length !== names.length) {
      return `varTypes must hold one type per name: ${names.length} names, ${types.length} types`;
    }
    const bad = types.findIndex((t) => !VAR_TYPES.includes(t));
    if (bad >= 0) return `varTypes[${bad}] is '${types[bad]}'; one of int, float, bool`;
  }
  if (action === "tags" && p.kind !== undefined && !["tag", "event"].includes(str(p.kind))) {
    return `kind must be tag or event, got '${str(p.kind)}'`;
  }
  if (action === "procAnim" && p.ctrl !== undefined) {
    if (typeof p.ctrl !== "number" || p.ctrl < 0) return "ctrl must be 0 or more";
  }
  if (action === "set") {
    if (str(p.name).trim() === "") return "set needs name (the variable name from the .agr)";
    if (!VAR_TYPES.includes(str(p.varType))) {
      return `varType must be int, float or bool, got '${str(p.varType)}'`;
    }
    return valueWhy(str(p.varType), str(p.value));
  }
  if (action === "command") {
    if (str(p.name).trim() === "") return "command needs name (the command name from the graph)";
    if (
      p.floatParam !== undefined &&
      str(p.floatParam) !== "" &&
      !FLOAT_TEXT.test(str(p.floatParam).trim())
    ) {
      return `floatParam '${str(p.floatParam)}' is not a float`;
    }
  }
  return undefined;
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: DebugError };

/** Validates a request. Nothing is sent when this refuses. */
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
        `unknown action '${action}'; one of ${HANDLER_ACTIONS.join(", ")}`,
      ),
    };
  }
  const normal: Raw = { ...raw };
  try {
    // The wire carries `value` and `floatParam` as text; a number or boolean is turned to text here.
    if (typeof normal.value === "number") {
      normal.value =
        str(normal.varType) === "float" ? formatFloat(normal.value) : String(normal.value);
    } else if (typeof normal.value === "boolean") {
      normal.value = String(normal.value);
    }
    if (typeof normal.floatParam === "number") normal.floatParam = formatFloat(normal.floatParam);
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const parsed = ANIM_DEBUG_REQUEST_SCHEMA.safeParse(normal);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = { ...(parsed.data as Raw) };
  try {
    req.target = checkTarget(str(req.target));
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const why = checkValues(action, req);
  if (why) return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", why) };
  return {
    ok: true,
    action,
    target: `entity:${str(req.target)}`,
    mutating: MUTATING.has(action),
    params: req,
  };
}

/** A GATED answer for an action whose switch is closed, or null. Nothing is sent when it answers. */
export function gateOf(action: string, target: string): DebugError | null {
  if ((action === "set" || action === "command") && !ANIM_DEBUG_GATES.setCommand) {
    return fail(
      action,
      target,
      "GATED",
      `${action} waits for probe P-W4-19 (Set*Variable and CallCommand in play mode are not proven safe); nothing was called. Switch: ANIM_DEBUG_GATES.setCommand (src/tools/wb-anim-debug.ts) with EMCP_WB_AnimDebug.SET_COMMAND_PROVEN.`,
      "read the value with wb_anim_debug vars or tags",
    );
  }
  if (action === "btBreakpoint" && !ANIM_DEBUG_GATES.btBreakpoint) {
    return fail(
      action,
      target,
      "GATED",
      "btBreakpoint waits for probe P-W4-21 (SetBtBreakpoint may pause play or open the BT debugger); nothing was called. Switch: ANIM_DEBUG_GATES.btBreakpoint (src/tools/wb-anim-debug.ts) with EMCP_WB_AnimDebug.BT_BREAKPOINT_PROVEN.",
      "none until the probe passes",
    );
  }
  return null;
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a DebugError, else null. */
function handlerFailure(action: string, target: string, r: Raw): DebugError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ErrorCode = status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT";
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
  client: DebugClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: DebugError }> {
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
    if (c.code === "LOST" && mutating) {
      f.next = `The call was lost and is never retried; read back with wb_anim_debug ${
        action === "set" ? "vars" : "tags"
      } first.`;
    }
    return { error: f };
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/** Splits a `a|b|c` row into `n` cells; the last cell keeps any further `|`. */
export function splitFixed(line: string, n: number): string[] {
  const out: string[] = [];
  let rest = line;
  for (let i = 0; i < n - 1; i++) {
    const at = rest.indexOf("|");
    if (at < 0) {
      out.push(rest);
      rest = "";
    } else {
      out.push(rest.slice(0, at));
      rest = rest.slice(at + 1);
    }
  }
  out.push(rest);
  return out;
}

function intOr(text: string, dflt: number): number {
  const n = Number(text);
  return text !== "" && Number.isFinite(n) ? n : dflt;
}

export interface VarRow {
  name: string;
  type: string;
  /** The bind id; -1 when the graph has no such variable. */
  id: number;
  known: boolean;
  /** The value as text (floats are never turned to numbers). */
  value: string;
}

/** vars rows `name|type|id|value`. */
export function parseVarRows(lines: string[]): VarRow[] {
  return lines.map((line) => {
    const [name = "", type = "", id = "", value = ""] = splitFixed(line, 4);
    const n = intOr(id, -1);
    return { name, type, id: n, known: n >= 0, value };
  });
}

export interface TagRow {
  name: string;
  id: number;
  known: boolean;
  on: boolean;
}

/** tags rows `name|id|on`. */
export function parseTagRows(lines: string[]): TagRow[] {
  return lines.map((line) => {
    const [name = "", id = "", on = ""] = splitFixed(line, 3);
    const n = intOr(id, -1);
    return { name, id: n, known: n >= 0, on: truthy(on) };
  });
}

export interface IndexedName {
  index: number;
  name: string;
}

/** procAnim rows `index|name`. */
export function parseIndexed(lines: string[]): IndexedName[] {
  return lines.map((line) => {
    const [index = "", name = ""] = splitFixed(line, 2);
    return { index: intOr(index, -1), name };
  });
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(action: string, target: string, params: Raw, r: Raw): ActionOk {
  const warnings = strs(r.warnings);
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  switch (action) {
    case "vars": {
      const values = parseVarRows(strs(r.values));
      readback = { values };
      const unknown = values.filter((v) => !v.known).map((v) => v.name);
      if (unknown.length > 0) {
        warnings.push(`no graph variable of this name (id -1): ${unknown.join(", ")}`);
      }
      next =
        "wb_anim_debug tags reads tags and events; names come from the .agr (animation_graph inspect)";
      break;
    }
    case "tags": {
      const values = parseTagRows(strs(r.values));
      readback = { kind: str(params.kind) || "tag", values };
      const unknown = values.filter((v) => !v.known).map((v) => v.name);
      if (unknown.length > 0) {
        warnings.push(`no tag or event of this name (id -1): ${unknown.join(", ")}`);
      }
      break;
    }
    case "procAnim": {
      readback = {
        ctrl: num(params.ctrl) ?? 0,
        controllers: num(r.controllers) ?? 0,
        signals: parseIndexed(strs(r.signals)),
        bones: parseIndexed(strs(r.bones)),
        slots: parseIndexed(strs(r.slots)),
      };
      if ((num(r.controllers) ?? 0) === 0) warnings.push("the entity has no ProcAnim controller");
      break;
    }
    case "set": {
      const before = parseVarRows(strs(r.before));
      const after = parseVarRows(strs(r.after));
      readback = { before, after, requested: str(params.value) };
      const b = before[0];
      const a = after[0];
      changed = [{ path: str(params.name), before: b ? b.value : null, after: a ? a.value : null }];
      if (a && !sameValue(str(params.varType), a.value, str(params.value))) {
        warnings.push(
          "the value read back differs from the value sent; the graph may overwrite it every frame",
        );
      }
      next =
        "In memory only, until the graph overwrites it. The inverse is wb_anim_debug set with the 'before' value.";
      break;
    }
    case "command": {
      const id = num(r.id) ?? -1;
      readback = { id, called: truthy(r.called) };
      if (id < 0) warnings.push("no graph command of this name (id -1)");
      if (!truthy(r.called)) warnings.push("the command was not called");
      break;
    }
    default: {
      // btBreakpoint
      readback = { called: truthy(r.called), enable: params.enable === true };
      if (!truthy(r.called)) warnings.push("the breakpoint call was not made");
    }
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_anim_debug request end to end; never throws for a Workbench-side failure. */
export async function runAnimDebug(client: DebugClient, input: unknown): Promise<DebugResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const gated = gateOf(action, target);
  if (gated) return gated;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: DebugResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** Keys a caller may give as a number or boolean where the wire carries text. */
const LOOSE_TEXT_KEYS = new Set(["value", "floatParam"]);

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = ANIM_DEBUG_CONTRACT): z.ZodRawShape {
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
      else
        s = LOOSE_TEXT_KEYS.has(p.key)
          ? z.union([z.string(), z.number(), z.boolean()])
          : z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

export function registerWbAnimDebug(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_anim_debug",
    {
      description: wbAnimDebugDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Animation debug (play mode)",
        readOnlyHint: false,
        // set, command and btBreakpoint change memory in the running game only (GATED), never a file.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runAnimDebug(client, input));
    },
  );
}
