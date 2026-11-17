/**
 * `wb_particle`: preview a .ptc in the open World Editor world through a ParticleEffectEntity,
 * via EMCP_WB_Particle (wave W5, phase5-w5-spec.md section 2.2, DEC-068).
 *
 *   spawn     place the effect (dry run unless confirm; undoable)
 *   stats     state, emitter and particle counts, emitter names, simulation time
 *   control   play, stop, pause, stopEmission, restart (runtime only)
 *   simulate  advance the effect by seconds (at most 60), optionally multi-step with minFps
 *   param     read one float EmitterParam of one emitter
 *   setParam  set or multiply one float EmitterParam (runtime only, not saved)
 *   remove    delete the effect entity (dry run unless confirm; undoable)
 *
 * The Particle Editor module is never opened (DEC-042). Offline .ptc work is the `particle` tool.
 *
 * Floats travel as text: seconds, minFps and value may be given as numbers or as text and are
 * sent as text. The request is checked against the contract's per-action schema and the
 * handler's own bounds before anything is sent. Nothing here names a sandbox or a project.
 *
 * The W5 codes it answers (NOT_A_PARTICLE_EFFECT, NO_PARTICLES) are vocabulary codes.
 * src/server.ts registers `registerWbParticle`.
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
  checkRelativePath,
  parseEntityRef,
  printEntityRef,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { formatFloat } from "./wb-anim.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Particle";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const PARTICLE_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const PARTICLE_REQUEST_SCHEMA = buildRequestSchema(PARTICLE_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbParticleDescription(): string {
  return checkedDescription(PARTICLE_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = PARTICLE_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(PARTICLE_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));
/** Actions that take `confirm` (a dry run until it is true). */
const CONFIRMED = new Set(
  PARTICLE_CONTRACT.actions
    .filter((a) => a.params.some((p) => p.key === "confirm"))
    .map((a) => a.name),
);

const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 60_000;

/** The handler's bounds (EMCP_WB_Particle.c). */
export const MAX_SECONDS = 60;
export const MAX_MIN_FPS = 240;
export const MAX_PARAM_VALUE = 10_000;
export const MAX_MULTIPLIER = 10;
export const CONTROL_OPS = ["play", "stop", "pause", "stopEmission", "restart"] as const;
/** The 23 float EmitterParams the handler reads and sets (EMCP_WB_Particle.FLOAT_PARAMS). */
export const FLOAT_PARAMS: readonly string[] = [
  "VELOCITY",
  "VELOCITY_AFFECT",
  "VELOCITY_RND",
  "AVELOCITY",
  "SIZE",
  "SIZE_RND",
  "STRETCH",
  "AIR_RESISTANCE",
  "AIR_RESISTANCE_RND",
  "GRAVITY_SCALE",
  "GRAVITY_SCALE_RND",
  "BIRTH_RATE",
  "BIRTH_RATE_RND",
  "LIFETIME",
  "LIFETIME_RND",
  "EMITTING_TIME",
  "CURRENT_TIME",
  "SPRING",
  "SCALE_X",
  "SCALE_Y",
  "CENTER_X",
  "CENTER_Y",
  "MAX_LV",
];
const READ_ONLY_PARAM = "CURRENT_TIME";
/** Request keys whose floats travel as text. */
export const FLOAT_TEXT_KEYS = ["seconds", "minFps", "value"] as const;

// ── Codes ─────────────────────────────────────────────────────────────────────

export type ParticleCode = ErrorCode;

const NEXT_OF: Record<string, string> = ERROR_CODES;
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(NEXT_OF));

type Raw = Record<string, unknown>;

export interface ParticleError {
  ok: false;
  action: string;
  target: string;
  code: ParticleCode;
  message: string;
  next: string;
  warnings: string[];
}

export interface ParticleOk {
  ok: true;
  action: string;
  target: string;
  changed: Change[] | null;
  readback: unknown;
  next?: string;
  warnings: string[];
}

export type ParticleResponse = ParticleOk | ParticleError;

/** The client surface this tool needs (a fake in tests). */
export type ParticleClient = Pick<WorkbenchClient, "call">;

function fail(
  action: string,
  target: string,
  code: ParticleCode,
  message: string,
  next?: string,
): ParticleError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || NEXT_OF[code] || "",
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

/** A float answered as text: the number when it parses, else the text itself. */
function floatOf(v: unknown): number | string {
  if (typeof v === "number") return v;
  const t = str(v).trim();
  if (t === "") return "";
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

// ── Request checks ────────────────────────────────────────────────────────────

const FLOAT_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const GUID_PREFIX = /^(\{[0-9A-Fa-f]{16}\})(.*)$/;

/** Parses a float given as text; undefined when it is not a plain decimal number. */
function parseFloatText(text: string): number | undefined {
  const t = text.trim();
  if (!FLOAT_TEXT.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Checks an effect path: project-relative or `{GUID}path`, naming a .ptc. Returns the path to send. */
export function checkEffectPath(raw: string): string {
  const trimmed = raw.trim();
  const m = GUID_PREFIX.exec(trimmed);
  const rest = m ? m[2] : trimmed;
  const clean = checkRelativePath(rest);
  if (!clean.toLowerCase().endsWith(".ptc")) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `effect must name a .ptc file, got '${raw}' (project-relative path or {GUID}path)`,
    );
  }
  return m ? `${m[1]}${clean}` : clean;
}

/** The text of an "x y z" vector as the handler reads it, or a refusal sentence. */
function checkCoords(text: string): string | undefined {
  const parts = text
    .replace(/,/g, " ")
    .split(" ")
    .filter((p) => p !== "");
  if (parts.length !== 3 || parts.some((p) => parseFloatText(p) === undefined)) {
    return `coords must be three numbers as "x y z", got '${text}'`;
  }
  return undefined;
}

/** Per-action rules the contract's types cannot say; a sentence when the input is refused. */
function checkValues(action: string, p: Raw): string | undefined {
  if (action === "spawn") {
    if (typeof p.coords === "string") {
      const bad = checkCoords(p.coords);
      if (bad) return bad;
    }
    if (typeof p.name === "string" && p.name.trim() === "") {
      return "name is empty: omit it or give the entity a name";
    }
  }
  if (action === "control" && !(CONTROL_OPS as readonly string[]).includes(str(p.op))) {
    return `op must be one of ${CONTROL_OPS.join(", ")}, got '${str(p.op)}'`;
  }
  if (action === "simulate") {
    const s = parseFloatText(str(p.seconds));
    if (s === undefined || s <= 0 || s > MAX_SECONDS) {
      return `seconds must be a number above 0 and at most ${MAX_SECONDS}, got '${str(p.seconds)}'`;
    }
    if (p.minFps !== undefined) {
      const f = parseFloatText(str(p.minFps));
      if (f === undefined || f <= 0 || f > MAX_MIN_FPS) {
        return `minFps must be a number above 0 and at most ${MAX_MIN_FPS}, got '${str(p.minFps)}'`;
      }
    }
  }
  if (action === "param" || action === "setParam") {
    const name = str(p.param);
    if (!FLOAT_PARAMS.includes(name)) {
      return `param must be a float EmitterParam (${FLOAT_PARAMS.join(", ")}), got '${name}'`;
    }
    const emitter = p.emitter as number;
    if (action === "param" && emitter < 0) {
      return "emitter must be an emitter index from wb_particle stats (-1 is only for setParam)";
    }
    if (emitter < -1) return "emitter must be an index of 0 or more, or -1 for all (setParam)";
  }
  if (action === "setParam") {
    if (str(p.param) === READ_ONLY_PARAM) {
      return `${READ_ONLY_PARAM} is read only: read it with param`;
    }
    const v = parseFloatText(str(p.value));
    if (v === undefined) return `value must be a number, got '${str(p.value)}'`;
    if (p.multiply === true) {
      if (v < 0 || v > MAX_MULTIPLIER) {
        return `a multiplier must be from 0 to ${MAX_MULTIPLIER}, got ${v}`;
      }
    } else if (Math.abs(v) > MAX_PARAM_VALUE) {
      return `value must be from -${MAX_PARAM_VALUE} to ${MAX_PARAM_VALUE}, got ${v}`;
    }
  }
  return undefined;
}

function targetOf(p: Raw): string {
  const entity = str(p.entity);
  if (entity) return `entity:${entity}`;
  const effect = str(p.effect);
  return effect ? `path:${effect}` : "open:WorldEditor";
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: ParticleError };

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = { ...((input ?? {}) as Raw) };
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
  // Floats travel as text: a number is turned into its text before the contract sees it.
  for (const key of FLOAT_TEXT_KEYS) {
    const v = raw[key];
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Math.abs(v) >= 1e21) {
        return {
          ok: false,
          error: fail(action, target, "INVALID_ARGUMENT", `${key} must be a finite number`),
        };
      }
      // Plain decimal text, never an exponent (review round 1, W5-03).
      raw[key] = formatFloat(v);
    }
  }
  const parsed = PARTICLE_REQUEST_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const params: Raw = { ...req };
  let shownTarget = target;
  try {
    if (action === "spawn") {
      params.effect = checkEffectPath(str(req.effect));
      shownTarget = `path:${params.effect}`;
    } else {
      const ref = printEntityRef(parseEntityRef(str(req.entity)));
      params.entity = ref;
      shownTarget = `entity:${ref}`;
    }
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const why = checkValues(action, params);
  if (why) return { ok: false, error: fail(action, shownTarget, "INVALID_ARGUMENT", why) };
  const mutating = MUTATING.has(action);
  // spawn and remove are a dry run unless confirm is true: send the flag explicitly.
  if (CONFIRMED.has(action)) params.confirm = req.confirm === true;
  return { ok: true, action, target: shownTarget, mutating, params };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a ParticleError, else null. */
function handlerFailure(action: string, target: string, r: Raw): ParticleError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ErrorCode = status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT";
    const code = (KNOWN_CODES.has(raw) ? raw : fallback) as ParticleCode;
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

const LOST_NEXT: Record<string, string> = {
  spawn:
    "The call was lost and is never retried; list the entities (wb_entity list) before sending spawn again.",
  remove:
    "The call was lost and is never retried; read the entity back (wb_particle stats) before sending remove again.",
  control: "The call was lost and is never retried; read the state back with wb_particle stats.",
  simulate: "The call was lost and is never retried; read the result back with wb_particle stats.",
  setParam: "The call was lost and is never retried; read the value back with wb_particle param.",
};

async function send(
  client: ParticleClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: ParticleError }> {
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
    if (c.code === "LOST" && mutating && LOST_NEXT[action]) f.next = LOST_NEXT[action];
    return { error: f };
  }
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(action: string, target: string, params: Raw, r: Raw): ParticleOk {
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  const message = str(r.message);
  switch (action) {
    case "spawn": {
      const dry = truthy(r.dryRun);
      const entity = str(r.entity);
      readback = {
        dryRun: dry,
        entity: entity || null,
        effectPath: str(r.effectPath) || str(params.effect),
        coords: str(r.coords),
        message,
      };
      if (dry) {
        next = "Resend with confirm: true to place the effect in the open world.";
      } else {
        changed = [{ path: "world.entities", before: null, after: entity }];
        next =
          "wb_particle stats reads it; wb_particle remove or wb_undo_redo undo takes it back (it is not saved to a file until the world is saved).";
        if (entity === "") warnings.push("the handler answered no entity id for the new effect");
      }
      break;
    }
    case "stats": {
      readback = {
        entity: str(r.entity),
        effectPath: str(r.effectPath),
        state: str(r.state),
        emitters: num(r.emitters) ?? 0,
        particles: num(r.particles) ?? 0,
        emitterNames: strs(r.emitterNames),
        active: truthy(r.active),
        time: floatOf(r.time),
      };
      next = "wb_particle control, simulate and setParam act on it; param reads one emitter value";
      break;
    }
    case "control": {
      const before = str(r.stateBefore);
      const after = str(r.state);
      readback = { entity: str(r.entity), stateBefore: before, state: after, message };
      changed = before === after ? [] : [{ path: "state", before, after }];
      next = "Runtime only, nothing is saved. wb_particle stats reads the state back.";
      break;
    }
    case "simulate": {
      readback = {
        entity: str(r.entity),
        particles: num(r.particles) ?? 0,
        time: floatOf(r.time),
        message,
      };
      next =
        "The step runs later this frame: read wb_particle stats for the result. control restart resets the effect.";
      break;
    }
    case "param": {
      readback = {
        entity: str(r.entity),
        emitter: num(params.emitter),
        param: str(r.param) || str(params.param),
        value: floatOf(r.value),
        original: floatOf(r.original),
      };
      break;
    }
    case "setParam": {
      const before = str(r.before);
      const after = str(r.after);
      const emitter = num(params.emitter);
      const name = str(r.param) || str(params.param);
      readback = {
        entity: str(r.entity),
        emitter,
        param: name,
        multiply: params.multiply === true,
        before: floatOf(before),
        after: floatOf(after),
        message,
      };
      changed = [
        {
          path: `emitters[${emitter === -1 ? "*" : emitter}].${name}`,
          before: floatOf(before),
          after: floatOf(after),
        },
      ];
      if (before === "" || after === "") {
        warnings.push(
          "the engine value could not be read back (weak oracle): check it with wb_particle stats or param",
        );
      }
      if (emitter === -1) {
        warnings.push("emitter -1 sets every emitter; before and after are those of emitter 0");
      }
      next =
        "Runtime only, nothing is saved. The inverse is wb_particle setParam with the 'before' value (or control restart).";
      break;
    }
    case "remove": {
      const dry = truthy(r.dryRun);
      const removed = truthy(r.removed);
      readback = { dryRun: dry, entity: str(r.entity), removed, message };
      if (dry) {
        next = "Resend with confirm: true to delete the effect entity.";
      } else {
        changed = [{ path: "world.entities", before: str(r.entity), after: null }];
        next = "wb_undo_redo undo restores it.";
        if (!removed) warnings.push("the handler did not report the entity removed");
      }
      break;
    }
    default:
      readback = { ...r };
  }
  const ok: ParticleOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_particle request end to end; never throws for a Workbench-side failure. */
export async function runParticle(
  client: ParticleClient,
  input: unknown,
): Promise<ParticleResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: ParticleResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = PARTICLE_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else if ((FLOAT_TEXT_KEYS as readonly string[]).includes(p.key)) {
        // A float given as text or as a number; sent as text.
        s = z.union([z.string(), z.number()]);
      } else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

export function registerWbParticle(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_particle",
    {
      description: wbParticleDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Particle effect preview",
        readOnlyHint: false,
        // spawn and remove are undoable entity actions (a dry run until confirm); control,
        // simulate and setParam change runtime state only and save nothing.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runParticle(client, input));
    },
  );
}
