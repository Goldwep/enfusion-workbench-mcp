/**
 * `wb_anim`: animation export profiles and TXA tracks, plus an engine check of an animation,
 * behavior or procedural animation file, through EMCP_WB_Anim (wave W4, phase5-w4-spec.md
 * section 2.1, DEC-067).
 *
 *   txaProfiles   read: the export profiles (.apr) of the loaded addons
 *   txaChannels   read: the channels of one profile
 *   txaRead       read, paged (`cursor`, `limit`): events and custom properties of a .txa
 *   check         opens a file in its editor and reads the engine log between two markers (GATED, P-W4-14)
 *   txaExport     a new .txa from keys; registered and rebuilt; a dry run unless `confirm: true`
 *   txaEdit       events or properties of a .txa; a dry run unless `confirm: true` (writes GATED, P-W4-06)
 *
 * OI-W4-1 (DEC-067 OD-2): no .apr ships with the game. Until the owner exports one into the loaded
 * project every txa* action refuses RESOURCE_NOT_FOUND with that owner step in `next`. Nothing here
 * invents, loads or simulates a profile: an answer with no profile is reported as such.
 *
 * Floats travel as text in both directions: `keyData` and `diffData` may be given as numbers or
 * numeric strings and are sent as strings. The request is checked against the contract's per-action
 * schema before anything is sent. Nothing here names a sandbox or a project; the handler's project
 * guard answers NOT_IN_PROJECT. Not registered here: src/server.ts registers `registerWbAnim`.
 *
 * TXA_ERROR (TxaExporter.ErrCode answered an error; `errMsg` has its text) is a vocabulary code.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "../config.js";
import { parseLogFile, resolveSession, type LogLine } from "../logs/parser.js";
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

export const HANDLER = "EMCP_WB_Anim";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const ANIM_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const ANIM_REQUEST_SCHEMA = buildRequestSchema(ANIM_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbAnimDescription(): string {
  return checkedDescription(ANIM_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = ANIM_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(ANIM_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

export type AnimErrorCode = ErrorCode;

const ALL_CODES: Readonly<Record<string, string>> = ERROR_CODES;

/** The held owner item OI-W4-1 (DEC-067): the step that unblocks every txa* action. */
export const OWNER_STEP_OI_W4_1 =
  "owner step OI-W4-1: export one animation export profile (.apr) with the Enfusion Blender Tools add-on into the open project, then call again";

/**
 * The switches behind the actions the rulings gate. Both are closed: the integrator opens one only
 * after the probe it names has passed (and the handler's own constant is flipped with it).
 *   checkLogMarkers  P-W4-14: the editors log a load error between two markers with no dialog.
 *                    Handler side: the check body in EMCP_WB_Anim.c (it refuses MODAL_HAZARD today).
 *   txaEditWrite     P-W4-06: TrackExport after TrackLoad rewrites the loaded file.
 *                    Handler side: EMCP_WB_Anim.TXA_EDIT_PROVEN.
 */
export const ANIM_GATES = { checkLogMarkers: false, txaEditWrite: false };

const READ_TIMEOUT_MS = 30_000;
const CHECK_TIMEOUT_MS = 60_000;
/** txaExport registers and rebuilds the resource; Workbench can take a while. */
const EXPORT_TIMEOUT_MS = 120_000;

type Raw = Record<string, unknown>;

export interface AnimError {
  ok: false;
  action: string;
  target: string;
  code: AnimErrorCode;
  message: string;
  next: string;
  warnings: string[];
  /** TxaExporter.ErrCode and ErrMsg, when the handler answered them. */
  txa?: { errCode: number; errMsg: string };
}
export type AnimResponse = ActionOk | AnimError;

/** The client surface this tool needs (a fake in tests). */
export type AnimClient = Pick<WorkbenchClient, "call">;

function fail(
  action: string,
  target: string,
  code: AnimErrorCode,
  message: string,
  next?: string,
): AnimError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || ALL_CODES[code] || "",
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

// ── Floats as text ────────────────────────────────────────────────────────────

const FLOAT_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** True for a string the handler's float parser can be expected to read. */
export function isFloatText(s: string): boolean {
  return FLOAT_TEXT.test(s.trim());
}

/**
 * A number as float text without an exponent (the handler's ParseFloat is not shown to read one).
 * Throws INVALID_ARGUMENT for NaN, Infinity or a magnitude of 1e21 and over.
 */
export function formatFloat(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) >= 1e21) {
    throw new VocabularyError("INVALID_ARGUMENT", `not a usable float: ${String(n)}`);
  }
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // Tiny magnitudes only (1e-7 and below): fixed notation, trailing zeros trimmed.
  const fixed = n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" || fixed === "" ? "0" : fixed;
}

/** Numbers and numeric strings to float text, element by element; anything else is refused. */
function floatList(key: string, v: unknown): string[] {
  if (!Array.isArray(v)) return v as string[];
  return v.map((x, i) => {
    if (typeof x === "number") return formatFloat(x);
    if (typeof x === "string") {
      if (!isFloatText(x)) {
        throw new VocabularyError("INVALID_ARGUMENT", `${key}[${i}] is not a number: '${x}'`);
      }
      return x.trim();
    }
    throw new VocabularyError("INVALID_ARGUMENT", `${key}[${i}] must be a number or a string`);
  });
}

/** Scalars to text for the keys the contract types as strings. */
function textList(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((x) => (typeof x === "number" || typeof x === "boolean" ? String(x) : x));
}

function textScalar(v: unknown): unknown {
  return typeof v === "number" || typeof v === "boolean" ? String(v) : v;
}

// ── Request checks ────────────────────────────────────────────────────────────

const GUID_PREFIX = /^(\{[0-9A-Fa-f]{16}\})(.*)$/;

/** `check` takes a file of the Anim, Behavior or ProcAnim editor (the engine accepts .ae .aex .asy: P-W4-15). */
export const CHECK_EXTENSIONS: readonly string[] = [
  ".aw",
  ".agr",
  ".agf",
  ".ast",
  ".asi",
  ".ae",
  ".aex",
  ".asy",
  ".bt",
  ".pap",
  ".siga",
];

function extOf(path: string): string {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot);
}

/** A `{GUID}path` or project-relative path; the GUID prefix is kept, slashes forward. */
export function checkFilePath(raw: string): string {
  const trimmed = raw.trim();
  const m = GUID_PREFIX.exec(trimmed);
  const rest = m ? m[2] : trimmed;
  const clean = checkRelativePath(rest);
  return m ? `${m[1]}${clean}` : clean;
}

/** A profile: `$addon:path`, a path, or a bare name; no drive, root or '..'. */
export function checkProfile(raw: string): string {
  const p = raw.trim();
  if (p === "") throw new VocabularyError("INVALID_ARGUMENT", "profile is empty");
  if (p.includes("\0")) throw new VocabularyError("INVALID_ARGUMENT", "NUL in profile");
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\")) {
    throw new VocabularyError("ABSOLUTE_PATH", `absolute path refused: ${p}`);
  }
  if (
    p
      .replace(/\\/g, "/")
      .split("/")
      .some((s) => s === "..")
  ) {
    throw new VocabularyError("ABSOLUTE_PATH", `'..' refused in profile: ${p}`);
  }
  return p.replace(/\\/g, "/");
}

function targetOf(p: Raw): string {
  if (typeof p.target === "string" && p.target !== "") return `path:${p.target}`;
  if (typeof p.path === "string" && p.path !== "") return `path:${p.path}`;
  if (typeof p.profile === "string" && p.profile !== "") return `profile:${p.profile}`;
  if (typeof p.addon === "string" && p.addon !== "") return `addon:${p.addon}`;
  return "addons:loaded";
}

const EVENT_TYPES = ["generic", "audio", "weighted"];
const EDIT_OPS = ["add", "edit", "erase", "setProp", "clearProps"];

/** The one-sentence refusal for an input that fails a check, or undefined. */
function checkValues(action: string, p: Raw): string | undefined {
  if (p.limit !== undefined) {
    if (typeof p.limit !== "number" || p.limit < 1 || p.limit > LIMIT_MAX) {
      return `limit must be 1 to ${LIMIT_MAX}`;
    }
  }
  if (typeof p.addon === "string" && p.addon.trim() === "") {
    return "addon is empty (omit it for every loaded addon)";
  }
  if (action === "txaRead" || action === "txaEdit") {
    if (extOf(str(p.path)) !== ".txa") return `path must name a .txa, got '${str(p.path)}'`;
  }
  if (action === "txaExport") {
    if (extOf(str(p.target)) !== ".txa") return `target must name a .txa, got '${str(p.target)}'`;
    const frames = num(p.frames) ?? 0;
    const fps = num(p.fps) ?? 0;
    const channels = num(p.channelCount) ?? 0;
    if (frames < 1 || fps < 1 || channels < 1) {
      return `frames, fps and channelCount must be at least 1, got ${frames}, ${fps}, ${channels}`;
    }
    const keys = strs(p.keyData);
    const block = frames * channels;
    if (keys.length === 0 || keys.length % block !== 0) {
      return `keyData has ${keys.length} values, not a positive multiple of channelCount * frames = ${block}`;
    }
    if (strs(p.diffData).length > 0 && strs(p.diffData).some((d) => !isFloatText(d))) {
      return "diffData holds a value that is not a number";
    }
  }
  if (action === "check") {
    const ext = extOf(str(p.path));
    if (!CHECK_EXTENSIONS.includes(ext)) {
      return `check takes the files of the Anim, Behavior and ProcAnim editors (${CHECK_EXTENSIONS.join(" ")}), got '${str(p.path)}'`;
    }
  }
  if (action === "txaEdit") return checkEdit(p);
  return undefined;
}

function checkEdit(p: Raw): string | undefined {
  const op = str(p.op);
  if (!EDIT_OPS.includes(op)) return `op must be one of ${EDIT_OPS.join(", ")}, got '${op}'`;
  const fields = strs(p.fields);
  const values = strs(p.values);
  if (fields.length !== values.length) {
    return `fields and values must be the same length, got ${fields.length} and ${values.length}`;
  }
  if (fields.some((f) => f.trim() === "")) return "fields holds an empty name";
  const index = p.index;
  const needsIndex = op === "edit" || op === "erase";
  if (needsIndex && (typeof index !== "number" || index < 0)) {
    return `${op} needs index (the event index, 0 or more)`;
  }
  if (op === "add") {
    if (!EVENT_TYPES.includes(str(p.eventType))) {
      return `add needs eventType: one of ${EVENT_TYPES.join(", ")}`;
    }
  } else if (p.eventType !== undefined) {
    return "eventType is for op add only";
  }
  if (op === "edit" && fields.length === 0) return "edit needs fields and values";
  if (op === "setProp") {
    if (str(p.propName).trim() === "") return "setProp needs propName";
    if (typeof p.propValue !== "string") return "setProp needs propValue (text)";
  }
  if (op !== "setProp" && (p.propName !== undefined || p.propValue !== undefined)) {
    return "propName and propValue are for op setProp only";
  }
  if (op !== "add" && op !== "edit" && fields.length > 0) {
    return "fields and values are for op add and edit only";
  }
  return undefined;
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: AnimError };

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
  let normal: Raw;
  try {
    normal = { ...raw };
    if ("keyData" in normal) normal.keyData = floatList("keyData", normal.keyData);
    if ("diffData" in normal) normal.diffData = floatList("diffData", normal.diffData);
    if ("fields" in normal) normal.fields = textList(normal.fields);
    if ("values" in normal) normal.values = textList(normal.values);
    if ("propNames" in normal) normal.propNames = textList(normal.propNames);
    if ("propValue" in normal) normal.propValue = textScalar(normal.propValue);
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const parsed = ANIM_REQUEST_SCHEMA.safeParse(normal);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = { ...(parsed.data as Raw) };
  try {
    if (typeof req.path === "string") {
      req.path = action === "check" ? checkFilePath(req.path) : checkRelativePath(req.path);
    }
    if (typeof req.target === "string") req.target = checkRelativePath(req.target);
    if (typeof req.profile === "string") req.profile = checkProfile(req.profile);
    if (typeof req.hint === "string" && req.hint !== "") req.hint = checkFilePath(req.hint);
    if (typeof req.cursor === "string" && req.cursor !== "") parseCursor(req.cursor);
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const why = checkValues(action, req);
  if (why) return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", why) };
  const mutating = MUTATING.has(action);
  const params: Raw = { ...req };
  // A write is a dry run unless confirm is true: send the flag explicitly.
  if (action === "txaExport" || action === "txaEdit") params.confirm = req.confirm === true;
  return { ok: true, action, target: targetOf(req), mutating, params };
}

/** A GATED answer for an action whose switch is closed, or null. Nothing is sent when it answers. */
export function gateOf(action: string, params: Raw, target: string): AnimError | null {
  if (action === "check" && !ANIM_GATES.checkLogMarkers) {
    return fail(
      action,
      target,
      "GATED",
      "check waits for probe P-W4-14 (the editors log a load error between two markers with no dialog); nothing was opened. Switch: ANIM_GATES.checkLogMarkers (src/tools/wb-anim.ts) with the check body in EMCP_WB_Anim.c.",
      "animation_graph, behavior_tree or procanim validate (offline) until the probe passes",
    );
  }
  if (action === "txaEdit" && params.confirm === true && !ANIM_GATES.txaEditWrite) {
    return fail(
      action,
      target,
      "GATED",
      "txaEdit writes wait for probe P-W4-06 (where TrackExport writes after TrackLoad, and whether edits survive the round trip); nothing was changed. Switch: ANIM_GATES.txaEditWrite with EMCP_WB_Anim.TXA_EDIT_PROVEN. The dry run is open.",
      "txaExport a new .txa with the wanted content",
    );
  }
  return null;
}

// ── Handler answer ────────────────────────────────────────────────────────────

const TXA_ACTIONS = new Set(["txaProfiles", "txaChannels", "txaRead", "txaExport", "txaEdit"]);

/** A handler refusal or error as an AnimError, else null. */
function handlerFailure(action: string, target: string, r: Raw): AnimError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: AnimErrorCode = status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT";
    const code = (raw in ALL_CODES ? raw : fallback) as AnimErrorCode;
    const e = fail(
      action,
      target,
      code,
      str(r.message) || `the handler answered ${status}`,
      str(r.next) || undefined,
    );
    if (raw !== "" && !(raw in ALL_CODES)) {
      e.warnings.push(`the handler answered an unknown code '${raw}'`);
    }
    // OI-W4-1: a missing profile is the owner step, never a profile this tool makes up.
    if (TXA_ACTIONS.has(action) && code === "RESOURCE_NOT_FOUND" && !e.next.includes("OI-W4-1")) {
      if (/\.apr|profile/i.test(e.message)) e.next = `${e.next} (${OWNER_STEP_OI_W4_1})`.trim();
    }
    if (code === "TXA_ERROR" || r.errCode !== undefined) {
      e.txa = { errCode: num(r.errCode) ?? 0, errMsg: str(r.errMsg) };
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: AnimClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: AnimError }> {
  const timeout =
    action === "txaExport" ? EXPORT_TIMEOUT_MS : mutating ? CHECK_TIMEOUT_MS : READ_TIMEOUT_MS;
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout,
    });
    const f = handlerFailure(action, target, r);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating) {
      f.next =
        action === "check"
          ? "The call was lost and is never retried; read the Workbench state (wb_module info) first."
          : "The call was lost and is never retried; read back with wb_anim txaRead first.";
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

export interface ProfileRow {
  name: string;
  channels: number;
  path: string;
}

/** txaProfiles rows `name|channels|path`. */
export function parseProfiles(lines: string[]): ProfileRow[] {
  return lines.map((line) => {
    const [name = "", channels = "", path = ""] = splitFixed(line, 3);
    const n = Number(channels);
    return { name, channels: Number.isFinite(n) && channels !== "" ? n : 0, path };
  });
}

export interface ChannelRow {
  index: number;
  name: string;
  genFn: string;
}

/** txaChannels rows `index|name|genFn`. */
export function parseChannels(lines: string[]): ChannelRow[] {
  return lines.map((line) => {
    const [index = "", name = "", genFn = ""] = splitFixed(line, 3);
    const n = Number(index);
    return { index: Number.isFinite(n) && index !== "" ? n : -1, name, genFn };
  });
}

export interface EventRow {
  index: number;
  className: string;
  vars: Array<{ name: string; value: string }>;
  raw: string;
}

/** `var=value;var=value`: a piece without `=` continues the previous value (a value may hold `;`). */
export function parseVars(text: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  if (text === "") return out;
  for (const piece of text.split(";")) {
    const eq = piece.indexOf("=");
    if (eq < 0) {
      const last = out[out.length - 1];
      if (last) last.value += `;${piece}`;
      else out.push({ name: piece, value: "" });
    } else {
      out.push({ name: piece.slice(0, eq), value: piece.slice(eq + 1) });
    }
  }
  return out;
}

/** txaRead events `index|class|var=value;...`. */
export function parseEvents(lines: string[]): EventRow[] {
  return lines.map((line) => {
    const [index = "", className = "", vars = ""] = splitFixed(line, 3);
    const n = Number(index);
    return {
      index: Number.isFinite(n) && index !== "" ? n : -1,
      className,
      vars: parseVars(vars),
      raw: line,
    };
  });
}

/** `name=value` lines split at the first `=`. */
export function parseProps(lines: string[]): Array<{ name: string; value: string }> {
  return lines.map((line) => {
    const eq = line.indexOf("=");
    return eq < 0
      ? { name: line, value: "" }
      : { name: line.slice(0, eq), value: line.slice(eq + 1) };
  });
}

// ── The log-marker reader (check) ─────────────────────────────────────────────

/** What the log said between the begin and end marker of one check. */
export interface LogRead {
  /** The begin marker was found in the log. */
  found: boolean;
  /** Both markers were found, so the lines are the whole span. */
  complete: boolean;
  /** Lines strictly between the markers, as on disk. */
  lines: string[];
  /** Of those, the lines the engine marked as errors. */
  errors: string[];
  /** Of those, the lines it marked as warnings. */
  warnings: string[];
  session?: string;
  note?: string;
}

export type LogReader = (marker: string) => Promise<LogRead>;

/**
 * The lines between the first and the last line that carry `marker` (the begin and end markers
 * both name the pair id). Pure: the reader below feeds it a parsed console.log.
 */
export function extractMarked(lines: LogLine[], marker: string): LogRead {
  const empty: LogRead = { found: false, complete: false, lines: [], errors: [], warnings: [] };
  if (marker === "") return { ...empty, note: "the handler answered no marker" };
  const at: number[] = [];
  lines.forEach((l, i) => {
    if (l.raw.includes(marker)) at.push(i);
  });
  if (at.length === 0) return { ...empty, note: `marker ${marker} is not in the log (yet)` };
  const begin = at[0] as number;
  const complete = at.length >= 2;
  const end = complete ? (at[at.length - 1] as number) : lines.length;
  const span = lines.slice(begin + 1, end);
  return {
    found: true,
    complete,
    lines: span.map((l) => l.raw),
    errors: span.filter((l) => l.level === "error").map((l) => l.raw),
    warnings: span.filter((l) => l.level === "warn").map((l) => l.raw),
    ...(complete ? {} : { note: `the end marker of ${marker} is not in the log (yet)` }),
  };
}

export interface LogReaderDeps {
  /** Pause between reads while the end marker is missing (a fake in tests). */
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  delayMs?: number;
}

/**
 * The reader over the newest Workbench session's console.log: the same route as `logs_tail`
 * (resolveSession + parseLogFile). It re-reads a few times because the log is written behind the call.
 */
export function makeLogReader(logsPath: string, deps: LogReaderDeps = {}): LogReader {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = deps.attempts ?? 4;
  const delayMs = deps.delayMs ?? 250;
  return async (marker: string) => {
    let last: LogRead = { found: false, complete: false, lines: [], errors: [], warnings: [] };
    for (let i = 0; i < attempts; i++) {
      const session = resolveSession(logsPath, "latest");
      if (!session) {
        return { ...last, note: `no Workbench log session under ${logsPath}` };
      }
      last = {
        ...extractMarked(parseLogFile(join(session.absPath, "console.log")), marker),
        session: session.name,
      };
      if (last.complete) return last;
      if (i < attempts - 1) await sleep(delayMs);
    }
    return last;
  };
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(action: string, target: string, params: Raw, r: Raw): ActionOk {
  const warnings = strs(r.warnings);
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  const errCode = num(r.errCode) ?? 0;
  const errMsg = str(r.errMsg);
  if (errCode === 1 && errMsg !== "") warnings.push(`TxaExporter warning: ${errMsg}`);
  switch (action) {
    case "txaProfiles": {
      const profiles = parseProfiles(strs(r.profiles));
      const total = num(r.total) ?? profiles.length;
      readback = { total, profiles };
      if (profiles.length === 0) {
        warnings.push("no animation export profile (.apr) was found in the loaded addons");
        next = OWNER_STEP_OI_W4_1;
      } else {
        next = "wb_anim txaChannels reads one profile's channels";
      }
      break;
    }
    case "txaChannels": {
      const channels = parseChannels(strs(r.channels));
      readback = {
        profile: str(params.profile),
        total: num(r.total) ?? channels.length,
        channels,
        errCode,
        errMsg,
      };
      next = "wb_anim txaExport writes a new .txa for this profile";
      break;
    }
    case "txaRead": {
      const cursor = str(r.nextCursor);
      readback = {
        path: str(r.path) || str(params.path),
        eventCount: num(r.eventCount) ?? 0,
        events: parseEvents(strs(r.events)),
        props: parseProps(strs(r.props)),
        nextCursor: cursor || null,
        errCode,
        errMsg,
      };
      if (cursor) next = `wb_anim txaRead with cursor "${cursor}" for the next page`;
      break;
    }
    case "txaExport": {
      const dry = truthy(r.dryRun);
      const written = truthy(r.written);
      readback = {
        target: str(r.target) || str(params.target),
        dryRun: dry,
        written,
        registered: truthy(r.registered),
        rebuilt: truthy(r.rebuilt),
        errCode,
        errMsg,
      };
      if (dry) {
        next = "Resend with confirm: true to write the .txa, register it and rebuild it.";
      } else {
        changed = [{ path: str(r.target) || str(params.target), before: null, after: "created" }];
        next =
          "wb_anim txaRead reads the new track back; there is no inverse call, delete the file by hand.";
        if (!written) warnings.push("the handler did not report the .txa written");
        if (!truthy(r.registered)) warnings.push("the handler did not report the .txa registered");
        if (!truthy(r.rebuilt)) warnings.push("the handler did not report the resource rebuilt");
      }
      break;
    }
    default: {
      // txaEdit
      const dry = truthy(r.dryRun);
      const before = strs(r.before);
      const after = strs(r.after);
      readback = {
        path: str(r.path) || str(params.path),
        op: str(params.op),
        dryRun: dry,
        written: truthy(r.written),
        eventCount: num(r.eventCount) ?? 0,
        before,
        after,
        errCode,
        errMsg,
      };
      if (dry) {
        next = "Resend with confirm: true to write the edit (GATED until P-W4-06).";
      } else {
        changed = [{ path: str(r.path) || str(params.path), before, after }];
        next = "wb_anim txaRead reads the track back.";
        if (!truthy(r.written)) warnings.push("the handler did not report the .txa written");
      }
    }
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

async function shapeCheck(
  target: string,
  params: Raw,
  r: Raw,
  readLog: LogReader | undefined,
): Promise<ActionOk> {
  const warnings = strs(r.warnings);
  const marker = str(r.marker);
  let log: LogRead | null = null;
  if (!readLog) {
    warnings.push("no log reader is configured: the engine log was not read");
  } else if (marker === "") {
    warnings.push("the handler answered no marker: the engine log was not read");
  } else {
    log = await readLog(marker);
    if (log.note) warnings.push(log.note);
  }
  const readOk = log?.complete === true;
  const readback = {
    path: str(r.path) || str(params.path),
    openedIn: str(r.openedIn),
    result: truthy(r.result),
    docClass: str(r.docClass),
    marker,
    log: {
      read: readOk,
      session: log?.session ?? null,
      lines: log?.lines ?? [],
      errorCount: log?.errors.length ?? 0,
      errors: log?.errors ?? [],
      warnings: log?.warnings ?? [],
      // null: the log was not read in full, so nothing is claimed about errors.
      clean: readOk ? (log?.errors.length ?? 0) === 0 && truthy(r.result) : null,
    },
  };
  if (!truthy(r.result)) warnings.push("the open call returned false");
  const ok: ActionOk = {
    ok: true,
    action: "check",
    target,
    changed: null,
    readback,
    warnings,
  };
  ok.next = !readOk
    ? "The log span was not read in full; wb_logs tail (logs_tail) shows the log by hand."
    : readback.log.errorCount > 0
      ? "Fix what the log lines name, then check again (animation_graph, behavior_tree or procanim edit)."
      : "No error between the markers.";
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export interface RunDeps {
  /** Reads the engine log between the check markers; absent means the log is not read. */
  readLog?: LogReader;
}

/** Runs one wb_anim request end to end; never throws for a Workbench-side failure. */
export async function runAnim(
  client: AnimClient,
  input: unknown,
  deps: RunDeps = {},
): Promise<AnimResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const gated = gateOf(action, params, target);
  if (gated) return gated;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  if (action === "check") return shapeCheck(target, params, s.r, deps.readLog);
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: AnimResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** Keys a caller may give as numbers (or booleans) where the contract types the wire value as text. */
const LOOSE_TEXT_KEYS = new Set(["propValue"]);
const LOOSE_LIST_KEYS = new Set(["keyData", "diffData", "fields", "values"]);

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = ANIM_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else if (p.type === "array<string>") {
        s = LOOSE_LIST_KEYS.has(p.key)
          ? z.array(z.union([z.string(), z.number(), z.boolean()]))
          : z.array(z.string());
      } else if (p.type === "array<int>") s = z.array(z.number().int());
      else
        s = LOOSE_TEXT_KEYS.has(p.key)
          ? z.union([z.string(), z.number(), z.boolean()])
          : z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

/**
 * Registers `wb_anim`. `config` supplies the Workbench logs directory for the check action's marker
 * reader; without it `check` answers, but says the log was not read.
 */
export function registerWbAnim(
  server: McpServer,
  client: WorkbenchClient,
  config?: Pick<Config, "logsPath">,
): void {
  const readLog = config?.logsPath ? makeLogReader(config.logsPath) : undefined;
  server.registerTool(
    "wb_anim",
    {
      description: wbAnimDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Animation profiles, TXA tracks and file check",
        readOnlyHint: false,
        // txaExport writes a new .txa and txaEdit rewrites one (both a dry run until confirm);
        // check opens a file in its editor and changes nothing on disk.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runAnim(client, input, { readLog }));
    },
  );
}
