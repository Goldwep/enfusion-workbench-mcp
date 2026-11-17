/**
 * `wb_audio`: audition sound in the open World Editor world through EMCP_WB_Audio
 * (wave W5, phase5-w5-spec.md sections 1.3 and 2.1).
 *
 *   play, playSound, isPlaying, stop, audible   an .acp event or a sample, by handle
 *   variable, setVariable, resetVariables       the runtime audio variables of a variables .conf
 *   masters, setMaster, pause, outputStates     the mixer
 *   entityEvents, entityPlay, setSignal         the sound component and signals of an entity
 *   soundMap                                    the sound-map values at a position
 *   open                                        a project .acp/.sig in the Audio Editor
 *
 * The AudioSystem actions (PLAY_MODE_ACTIONS) answer only inside `wb_world play`: in edit mode the
 * handler refuses WRONG_MODE (fix-up 1, probe P-W5-06 KILLED in W5 run 1).
 *
 * Runtime only: nothing is saved, so no action needs confirm except `open` (a dry run unless
 * `confirm: true`). Floats go to the handler as text (`String(n)`); a caller may pass a number or
 * text. `open` with confirm is GATED here until probe P-W5-12 passes: flip AUDIO_OPEN_PROVEN (the
 * handler has the same switch, EMCP_WB_AudioUtil.OPEN_PROVEN). The dry run is always sent.
 *
 * The request is checked against the contract's per-action schema before anything is sent. Nothing
 * here names a sandbox or a project. Not registered here: src/server.ts registers it
 * (registerWbAudio).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema } from "../manifest/generate.js";
import {
  ERROR_CODES,
  VocabularyError,
  checkRelativePath,
  owningModule,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { formatFloat } from "./wb-anim.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Audio";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const AUDIO_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const AUDIO_REQUEST_SCHEMA = buildRequestSchema(AUDIO_CONTRACT);

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = AUDIO_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(AUDIO_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

/** The draft of phase5-w5-spec.md section 1.1 (340 chars, budget 400). */
export const WB_AUDIO_DESCRIPTION =
  "Audition sound in the World Editor world: play an .acp event, playSound, isPlaying, stop, audible; variable, setVariable, resetVariables; masters, setMaster, pause; outputStates (these need wb_world play); entityEvents, entityPlay, setSignal on an entity; soundMap; open a project .acp/.sig in the Audio Editor. Runtime only: nothing is saved.";

export function wbAudioDescription(): string {
  return WB_AUDIO_DESCRIPTION;
}

/**
 * The AudioSystem actions the handler runs only in play mode (fix-up 1: probe P-W5-06 was KILLED in
 * W5 run 1, so they refuse WRONG_MODE in edit mode and run inside `wb_world play`). `stop` is not
 * among them: it must always be sendable.
 */
export const PLAY_MODE_ACTIONS: readonly string[] = [
  "play",
  "playSound",
  "isPlaying",
  "audible",
  "variable",
  "setVariable",
  "resetVariables",
  "masters",
  "setMaster",
  "pause",
  "outputStates",
];

/**
 * `open` with confirm waits for probe P-W5-12 (Workbench.OpenResource of an audio file with no
 * modal). The main session flips this, and EMCP_WB_AudioUtil.OPEN_PROVEN, when the probe passes.
 */
export const AUDIO_OPEN_PROVEN = false;
export const AUDIO_OPEN_PROBE = "P-W5-12";

const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 60_000;

/** The masters, in the order `masters` answers them. */
export const MASTERS = ["SFX", "Music", "VoiceChat", "Dialog", "UI"] as const;
export const FADE_MAX = 60;
export const SIGNALS_MAX = 64;

type Raw = Record<string, unknown>;

// ── Codes ─────────────────────────────────────────────────────────────────────

export type AudioErrorCode = ErrorCode;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function defaultNext(code: AudioErrorCode): string {
  return ERROR_CODES[code];
}

export interface AudioError {
  ok: false;
  action: string;
  target: string;
  code: AudioErrorCode;
  message: string;
  next: string;
  warnings: string[];
}
export type AudioResponse = ActionOk | AudioError;

/** The client surface this tool needs (a fake in tests). */
export type AudioClient = Pick<WorkbenchClient, "call">;

function fail(
  action: string,
  target: string,
  code: AudioErrorCode,
  message: string,
  next?: string,
): AudioError {
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

/** A float the handler sent as text, as a number; the text itself when it does not parse. */
function floatOf(v: unknown): number | string {
  if (typeof v === "number") return v;
  const t = str(v).trim();
  if (t === "") return t;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

// ── Request checks ────────────────────────────────────────────────────────────

const GUID_PREFIX = /^(\{[0-9A-Fa-f]{16}\})(.*)$/;
const FLOAT_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** The resource types each action takes (lower case extension, with the dot). */
const RESOURCE_EXTS: Record<string, readonly string[]> = {
  play: [".acp"],
  audible: [".acp"],
  playSound: [".wav", ".snd"],
  variable: [".conf"],
  setVariable: [".conf"],
  outputStates: [".afm"],
};

/**
 * Checks a resource: project-relative or `{GUID}path`. Absolute forms and `..` refuse. Returns
 * the string to send (the GUID prefix kept, backslashes turned to slashes).
 */
export function checkResource(raw: string): string {
  const trimmed = raw.trim();
  const m = GUID_PREFIX.exec(trimmed);
  const rest = m ? m[2] : trimmed;
  const clean = checkRelativePath(rest);
  return m ? `${m[1]}${clean}` : clean;
}

/** A float as the text the handler parses; throws a VocabularyError for anything else. */
export function floatText(v: unknown, what: string): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new VocabularyError("INVALID_ARGUMENT", `${what} is not finite`);
    // Plain decimal text, never an exponent (review round 1, W5-03); formatFloat refuses 1e21+.
    return formatFloat(v);
  }
  if (typeof v === "string" && FLOAT_TEXT.test(v.trim())) {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return formatFloat(n);
  }
  throw new VocabularyError(
    "INVALID_ARGUMENT",
    `${what} must be a number (or number text), got ${JSON.stringify(v)}`,
  );
}

/** A position as "x y z": `[x, y, z]` or text of three numbers. */
export function positionText(v: unknown): string {
  let parts: unknown[];
  if (Array.isArray(v)) parts = v;
  else if (typeof v === "string") parts = v.trim().split(/[\s,]+/);
  else {
    throw new VocabularyError("INVALID_ARGUMENT", "position must be [x, y, z] or text 'x y z'");
  }
  if (parts.length !== 3) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `position needs 3 numbers (x y z), got ${parts.length}`,
    );
  }
  return parts.map((p, i) => floatText(p, `position[${i}]`)).join(" ");
}

/** signals as `name=value` strings, from a list of them or a `{name: value}` object. */
export function signalList(v: unknown): string[] {
  let entries: Array<[string, unknown]>;
  if (Array.isArray(v)) {
    entries = v.map((e) => {
      const s = String(e);
      const eq = s.indexOf("=");
      if (eq <= 0) {
        throw new VocabularyError("INVALID_ARGUMENT", `a signal must be name=value, got '${s}'`);
      }
      return [s.slice(0, eq).trim(), s.slice(eq + 1)];
    });
  } else if (v !== null && typeof v === "object") {
    entries = Object.entries(v as Raw);
  } else {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      "signals must be a list of name=value or an object {name: value}",
    );
  }
  if (entries.length > SIGNALS_MAX) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `${entries.length} signals; at most ${SIGNALS_MAX}`,
    );
  }
  return entries.map(([name, value]) => {
    if (name === "") throw new VocabularyError("INVALID_ARGUMENT", "a signal name is empty");
    return `${name}=${floatText(value, `signal '${name}'`)}`;
  });
}

function checkMaster(name: unknown): string {
  const s = str(name);
  if (!(MASTERS as readonly string[]).includes(s)) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `master must be one of ${MASTERS.join(", ")}, got '${s}'`,
    );
  }
  return s;
}

function targetOf(p: Raw): string {
  const resource = str(p.resource) || str(p.path);
  if (resource) return `path:${resource}`;
  if (typeof p.handle === "number") return `handle:${p.handle}`;
  if (str(p.entity)) return `entity:${str(p.entity)}`;
  if (str(p.master)) return `master:${str(p.master)}`;
  return "audio:runtime";
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: AudioError };

/**
 * Turns the caller's friendlier input (numbers for floats, `[x,y,z]` for a position, an object
 * for signals) into the contract's wire types. Throws VocabularyError.
 */
function normalize(raw: Raw): Raw {
  const out: Raw = { ...raw };
  if (raw.value !== undefined) out.value = floatText(raw.value, "value");
  if (raw.fadeTime !== undefined) out.fadeTime = floatText(raw.fadeTime, "fadeTime");
  if (raw.position !== undefined) out.position = positionText(raw.position);
  if (raw.signals !== undefined) out.signals = signalList(raw.signals);
  return out;
}

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const target = targetOf(raw);
  const refuse = (code: AudioErrorCode, message: string, next?: string): Prepared => ({
    ok: false,
    error: fail(action, target, code, message, next),
  });
  if (!HANDLER_ACTIONS.includes(action)) {
    return refuse(
      "INVALID_ARGUMENT",
      `unknown action '${action}'; one of ${HANDLER_ACTIONS.join(", ")}`,
    );
  }
  let req: Raw;
  try {
    const wire = normalize(raw);
    const parsed = AUDIO_REQUEST_SCHEMA.safeParse(wire);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      );
      return refuse("INVALID_ARGUMENT", issues.join("; "));
    }
    req = parsed.data as Raw;

    const params: Raw = { ...req };
    const exts = RESOURCE_EXTS[action];
    if (exts && req.resource !== undefined) {
      const resource = checkResource(str(req.resource));
      const lower = resource.toLowerCase();
      if (!exts.some((e) => lower.endsWith(e))) {
        return refuse(
          "INVALID_ARGUMENT",
          `${action} takes a ${exts.join(" or ")} resource, got '${resource}'`,
        );
      }
      params.resource = resource;
    }
    if (action === "outputStates" && str(req.name) !== "" && req.resource === undefined) {
      return refuse("INVALID_ARGUMENT", "name (a signal) needs resource (the .afm)");
    }
    for (const key of ["eventName", "name", "entity"] as const) {
      if (typeof req[key] === "string" && str(req[key]).trim() === "") {
        return refuse("INVALID_ARGUMENT", `${key} is empty`);
      }
    }
    if (typeof req.handle === "number" && req.handle < 0) {
      return refuse(
        "INVALID_ARGUMENT",
        "handle must be 0 or more (the handle play, playSound or entityPlay answered)",
      );
    }
    if (action === "stop" && req.fadeTime !== undefined) {
      const f = Number(req.fadeTime);
      if (f < 0 || f > FADE_MAX) {
        return refuse("INVALID_ARGUMENT", `fadeTime must be 0 to ${FADE_MAX} seconds, got ${f}`);
      }
    }
    if (action === "setMaster") {
      params.master = checkMaster(req.master);
      if (Number(req.value) < 0) {
        return refuse("INVALID_ARGUMENT", `value must be 0 or more, got ${str(req.value)}`);
      }
    }
    if (action === "pause") {
      const names = strs(req.masters);
      if (names.length === 0) {
        return refuse(
          "INVALID_ARGUMENT",
          `masters is empty; pass one or more of ${MASTERS.join(", ")}`,
        );
      }
      params.masters = names.map(checkMaster);
    }
    if (action === "open") {
      const path = checkRelativePath(str(req.path));
      const owner = owningModule(path);
      if (owner !== "AudioEditor") {
        return refuse(
          "WRONG_MODULE",
          `${path} belongs to ${owner}, not the Audio Editor; it is never opened here`,
          "open it with wb_module setResource, or pass an .acp or .sig",
        );
      }
      params.path = path;
      params.confirm = req.confirm === true;
      if (params.confirm && !AUDIO_OPEN_PROVEN) {
        return refuse(
          "GATED",
          `open with confirm waits for probe ${AUDIO_OPEN_PROBE} (Workbench.OpenResource of an audio file with no modal); nothing was sent`,
          "the dry run (without confirm) shows what would open; the main session enables the open after the probe passes",
        );
      }
    }
    const t = action === "open" ? `path:${str(params.path)}` : targetOf(params);
    return { ok: true, action, target: t, mutating: MUTATING.has(action), params };
  } catch (e) {
    if (e instanceof VocabularyError) return refuse(e.code, e.message);
    throw e;
  }
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as an AudioError, else null. */
function handlerFailure(action: string, target: string, r: Raw): AudioError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ErrorCode = status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT";
    const code = (KNOWN_CODES.has(raw) ? raw : fallback) as AudioErrorCode;
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
  client: AudioClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: AudioError }> {
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
      f.next = `The call was lost and is never retried; read back first (${readbackHint(action)}).`;
    }
    return { error: f };
  }
}

function readbackHint(action: string): string {
  switch (action) {
    case "play":
    case "playSound":
    case "entityPlay":
    case "stop":
      return "wb_audio isPlaying with the handle, if you have it";
    case "setVariable":
    case "resetVariables":
      return "wb_audio variable";
    case "setMaster":
    case "pause":
      return "wb_audio masters";
    case "setSignal":
      return "wb_audio entityEvents lists the signals";
    default:
      return "wb_module list shows whether the Audio Editor opened";
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/** "name=value" lines into an object; a value that parses as a float becomes a number. */
export function parseKeyed(lines: string[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const line of lines) {
    const eq = line.indexOf("=");
    const key = eq < 0 ? line : line.slice(0, eq);
    out[key] = eq < 0 ? "" : floatOf(line.slice(eq + 1));
  }
  return out;
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function change(path: string, before: unknown, after: unknown): Change[] {
  return before === after ? [] : [{ path, before, after }];
}

function shapeOk(action: string, target: string, params: Raw, r: Raw): ActionOk {
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  const handle = num(r.handle);
  switch (action) {
    case "play":
    case "playSound":
    case "entityPlay": {
      readback = { handle, playing: truthy(r.playing) };
      if (action === "play") readback.position = str(r.position);
      if (action === "entityPlay") readback.entity = str(r.entity);
      if (!truthy(r.playing)) {
        warnings.push("the handler answered a handle that is not playing (already finished?)");
      }
      next = `wb_audio isPlaying or stop with handle ${handle}`;
      break;
    }
    case "isPlaying": {
      readback = { handle, playing: truthy(r.playing) };
      break;
    }
    case "stop": {
      const before = truthy(r.playingBefore);
      const after = truthy(r.playing);
      readback = { handle, playingBefore: before, playing: after };
      changed = change(`handle:${handle}.playing`, before, after);
      if (!before) warnings.push("the handle was not playing before the call");
      else if (after) warnings.push("the handle still reports playing (a fade may be running)");
      break;
    }
    case "audible": {
      readback = { audibility: floatOf(r.audibility), distance: floatOf(r.distance) };
      break;
    }
    case "variable": {
      readback = { id: num(r.id), value: floatOf(r.value) };
      break;
    }
    case "setVariable": {
      const before = floatOf(r.before);
      const after = floatOf(r.after);
      readback = { id: num(r.id), before, after };
      changed = change(`variable.${str(params.name)}`, before, after);
      next = `The inverse is wb_audio setVariable with value ${str(r.before)}; wb_audio resetVariables resets all.`;
      break;
    }
    case "resetVariables": {
      readback = { reset: truthy(r.reset) };
      next = "wb_audio variable reads one back";
      break;
    }
    case "masters": {
      readback = { outputVolume: floatOf(r.outputVolume), masters: parseKeyed(strs(r.masters)) };
      next = "wb_audio setMaster changes one";
      break;
    }
    case "setMaster": {
      const before = floatOf(r.before);
      const after = floatOf(r.after);
      readback = { master: str(r.master), before, after };
      changed = change(`master.${str(r.master)}`, before, after);
      next = `The inverse is wb_audio setMaster with value ${str(r.before)}.`;
      break;
    }
    case "pause": {
      const paused = truthy(r.paused);
      readback = { masters: strs(r.masters), paused };
      next = paused
        ? "The inverse is wb_audio pause with the same masters and resume: true."
        : "The masters are running again.";
      break;
    }
    case "outputStates": {
      const index = num(r.index);
      const signalIndex = num(r.signalIndex);
      readback = { count: num(r.count) ?? 0, index, signalIndex };
      if (str(params.resource) !== "" && index === -1) {
        warnings.push("the .afm has no instance in the running mixer (index -1)");
      }
      if (str(params.name) !== "" && index !== -1 && signalIndex === -1) {
        warnings.push(`the instance has no signal '${str(params.name)}' (signalIndex -1)`);
      }
      break;
    }
    case "entityEvents": {
      const events = strs(r.events);
      readback = {
        entity: str(r.entity),
        component: str(r.component),
        events,
        signals: strs(r.signals),
        count: num(r.count) ?? events.length,
      };
      next = "wb_audio entityPlay with an event, or setSignal with a signal";
      if (events.length === 0) {
        // An SndComponent (the game's SoundComponent family) has no GetEvents (fix-up 1).
        warnings.push(
          "the component lists no events (an SndComponent has no GetEvents): read them offline with audio events on the component's .acp",
        );
      }
      break;
    }
    case "setSignal": {
      const index = num(r.index);
      if (index === null || index < 0) {
        readback = { entity: str(r.entity), index: index ?? -1, set: false };
        warnings.push(
          `no signal '${str(params.name)}' on the entity (index -1): nothing was set; signals are never created here`,
        );
        next = "wb_audio entityEvents lists the entity's signals";
      } else {
        const before = floatOf(r.before);
        const after = floatOf(r.after);
        readback = { entity: str(r.entity), index, set: true, before, after };
        changed = change(`signal.${str(params.name)}`, before, after);
        next = `The inverse is wb_audio setSignal with value ${str(r.before)}.`;
      }
      break;
    }
    case "soundMap": {
      readback = { position: str(r.position), values: parseKeyed(strs(r.values)) };
      break;
    }
    case "open": {
      const dry = truthy(r.dryRun);
      readback = {
        path: str(r.path) || str(params.path),
        module: str(r.module),
        opened: truthy(r.opened),
        dryRun: dry,
        message: str(r.message),
      };
      if (dry) {
        next = AUDIO_OPEN_PROVEN
          ? "Resend with confirm: true to open the file in the Audio Editor."
          : `Opening waits for probe ${AUDIO_OPEN_PROBE}; confirm answers GATED until then.`;
      } else {
        next = "Close the tab with wb_module close AudioEditor.";
      }
      break;
    }
    default: {
      readback = {};
    }
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_audio request end to end; never throws for a Workbench-side failure. */
export async function runAudio(client: AudioClient, input: unknown): Promise<AudioResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: AudioResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * A flat input shape for registerTool (the per-action union is checked in prepareRequest). Floats
 * accept a number or text, a position `[x, y, z]` or text, signals a list or an object.
 */
export function flatInputShape(c: Contract = AUDIO_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
  const floaty = z.union([z.number(), z.string()]);
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.key === "value" || p.key === "fadeTime") s = floaty;
      else if (p.key === "position") s = z.union([z.string(), z.array(z.number()).length(3)]);
      else if (p.key === "signals") {
        s = z.union([z.array(z.string()), z.record(z.union([z.number(), z.string()]))]);
      } else if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else if (p.type === "array<string>") s = z.array(z.string());
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

export function registerWbAudio(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_audio",
    {
      description: wbAudioDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Audio audition",
        readOnlyHint: false,
        // Runtime engine state only; stop, setVariable, setMaster, pause and setSignal reverse it.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runAudio(client, input));
    },
  );
}
