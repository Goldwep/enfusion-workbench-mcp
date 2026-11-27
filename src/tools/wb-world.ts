/**
 * `wb_world` — the open world (wave W1, phase5-w1-spec.md section 2.6).
 *
 * Handler actions (EMCP_WB_World, keys from contracts/EMCP_WB_World.json):
 *   state             mode flags, edit state, tool, world path, sub-scenes (read)
 *   browserSelection  resources selected in the Resource Browser panel (read)
 *   playEvents        the play recorder's events after a seq (read)
 *   comments          CommentEntity rows and categories, paged by `<start>:<count>` (read)
 *   register          give a file written offline its .meta (dry run unless confirm)
 *   play / stop       switch mode, then this tool polls state until the mode lands
 *   addComment        a CommentEntity in one undo step
 *   annotate          a CommentEntity note EMCP_Note_<entity> just above an entity, added, moved
 *                     and removed as an entity; add takes size (metres) and color, and its default
 *                     height is scaled from the distance wb_view focus frames the entity from
 *
 * Offline actions run here, never in the handler (OD-4, DEC-061): they write inside the project
 * folder only, through the lossless parser (src/formats/enfusion-cst.ts) and the path guard,
 * refuse to overwrite without `overwrite: true`, and are a dry run unless `confirm: true`:
 *   new               `<name>.ent` + `<name>_Layers/default.layer` (what SCR_WorldFilesHelper
 *                     .CreateWorld writes), then register the .ent
 *   duplicate         copy `.ent` + `<name>_Layers/` (no .meta), then register the copies
 *   saveAs            wb_module save (confirm) -> duplicate the open world -> wb_module setResource
 *   setWorldEntity    swap the GenericWorldEntity prefab in `<name>_Layers/default.layer` (what
 *                     SCR_WorldFilesHelper.ReplaceWorldEntity edits), with a snapshot first
 * An overwrite by new, duplicate or saveAs snapshots every file it replaces first, to the same
 * artifacts folder (readback.snapshot; live-tools-a-06).
 *
 * Every input is checked before anything is sent or written. Not registered here: src/server.ts
 * registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "../config.js";
import { resolveAddonRoot, worldPrefixRefusal, type AddonRootConfig } from "../utils/addon-root.js";
import { defaultArtifactsDir } from "../census/source-index.js";
import {
  CstDocument,
  parseCst,
  parseCstBytes,
  type CstEntry,
  type CstObject,
} from "../formats/enfusion-cst.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { DESCRIPTION_MAX, buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  LIMIT_MAX,
  VocabularyError,
  checkRelativePath,
  errorResponse,
  parseCursor,
  parseEntityRef,
  printCursor,
  printEntityRef,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { assertInsideRoot } from "../utils/path-guard.js";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import { runModule, type ModuleClient } from "./wb-module.js";

// ── Contract ──────────────────────────────────────────────────────────────────

export const HANDLER = "EMCP_WB_World";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const WORLD_CONTRACT: Contract = loadContract(CONTRACT_FILE);
const HANDLER_SCHEMA = buildRequestSchema(WORLD_CONTRACT);

/** The handler's actions, in contract order. */
export const HANDLER_ACTIONS: readonly string[] = WORLD_CONTRACT.actions.map((a) => a.name);
/** The offline writers this tool runs itself (OD-4). */
export const OFFLINE_ACTIONS = ["new", "duplicate", "saveAs", "setWorldEntity"] as const;
export type OfflineAction = (typeof OFFLINE_ACTIONS)[number];

/** The line the description adds for the offline writers (they are not handler actions). */
export const OFFLINE_LINE = "Offline (confirm): new, duplicate, saveAs, setWorldEntity";

/**
 * The description: the contract's text (checkedDescription, at most 400 chars) plus the offline
 * line, the whole at most 400 chars. Throws when either is over budget.
 */
export function wbWorldDescription(c: Contract = WORLD_CONTRACT): string {
  const d = `${checkedDescription(c)}\n${OFFLINE_LINE}`;
  if (d.length > DESCRIPTION_MAX) {
    throw new Error(`${c.tool}: description is ${d.length} chars, budget ${DESCRIPTION_MAX}`);
  }
  return d;
}

// The offline actions' own strict objects (no handler key: nothing of theirs is sent as is).
const REL = z.string().describe("project-relative .ent");
const OFFLINE_SCHEMAS = [
  z
    .object({
      action: z.literal("new"),
      path: REL,
      prefab: z.string().optional(),
      overwrite: z.boolean().optional(),
      confirm: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("duplicate"),
      path: REL,
      to: REL,
      overwrite: z.boolean().optional(),
      confirm: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("saveAs"),
      to: REL,
      overwrite: z.boolean().optional(),
      confirm: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("setWorldEntity"),
      path: REL,
      prefab: z.string().optional(),
      confirm: z.boolean().optional(),
    })
    .strict(),
];

/** Handler actions (from the contract) and the offline actions, discriminated on `action`. */
export const WORLD_REQUEST_SCHEMA = z.discriminatedUnion("action", [
  ...HANDLER_SCHEMA.options,
  ...OFFLINE_SCHEMAS,
] as unknown as [z.AnyZodObject, ...z.AnyZodObject[]]);

// ── Types and helpers ─────────────────────────────────────────────────────────

export type WorldError = ActionError & { readback?: unknown };
export type WorldResponse = ActionOk | WorldError;

/** The client surface this tool needs (a fake in tests); probe only for wb_module's front. */
export type WorldClient = Pick<WorkbenchClient, "call" | "probe">;

export interface WorldDeps {
  /** The addon folder the offline writers write in; when unset it is resolved from `addons`. */
  projectRoot?: string;
  /** ENFUSION_PROJECT_PATH and the default mod, read per call (src/utils/addon-root.ts). */
  addons?: AddonRootConfig;
  /** Root of the artifacts folder for the snapshots of setWorldEntity and of an overwrite (default: defaultArtifactsDir()). */
  artifactsRoot?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** play/stop: state reads until the mode lands (default 20, 500 ms apart). */
  pollTries?: number;
  pollIntervalMs?: number;
}

type Raw = Record<string, unknown>;

const CALL_TIMEOUT_MS = 30_000;
const POLL_TRIES = 20;
const POLL_INTERVAL_MS = 500;
/** EMCP_WB_WorldUtil.SELECTION_MAX. */
export const SELECTION_MAX = 2000;
export const COMMENTS_LIMIT_DEFAULT = 50;
/** annotate add: the largest text height a request may ask for, metres (the handler's NOTE_SIZE_MAX). */
export const NOTE_SIZE_MAX = 100;
const WORLD_ENTITY_CLASS = "GenericWorldEntity";
const PREFAB = /^\{[0-9A-Fa-f]{16}\}[^"\r\n\\]+\.et$/;
const WORLD_NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/;
const FS_PREFIX = /^\$[A-Za-z0-9_]*:/;
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));
const OPEN = "open:WorldEditor";

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): WorldError {
  return errorResponse(action, target, code, message, next || ERROR_CODES[code]);
}

class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0. */
export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/** Maps a client failure to a code (MODAL_OPEN, LOST and WEDGED keep their names). */
function clientFailure(action: string, target: string, e: unknown, mutating: boolean): WorldError {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof WorkbenchError) {
    if (e.code === "MODAL_OPEN") return fail(action, target, "MODAL_OPEN", message);
    if (e.code === "WEDGED") return fail(action, target, "WEDGED", message);
    if (e.code === "LOST") {
      return fail(
        action,
        target,
        "LOST",
        message,
        mutating
          ? "The call was lost and is never retried; read back with wb_world state first."
          : undefined,
      );
    }
  }
  return fail(action, target, "UNREACHABLE", message);
}

/** A handler answer that is not ok, as an error (the handler's code and next win), else null. */
export function handlerFailure(action: string, target: string, r: Raw): WorldError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const known = KNOWN_CODES.has(raw);
    const code = (
      known ? raw : status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT"
    ) as ErrorCode;
    const e = fail(
      action,
      target,
      code,
      str(r.message) || `${HANDLER} answered ${status}`,
      str(r.next),
    );
    if (!known) e.warnings.push(`the handler answered an unknown code '${raw}'`);
    // addComment creates the entity before a field write fails: its id is a fact to keep.
    if (str(r.id)) e.readback = { id: str(r.id), undoName: str(r.undoName) || undefined };
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(client: WorldClient, params: Raw, mutating: boolean): Promise<Raw> {
  return client.call<Raw>(HANDLER, params, {
    access: mutating ? "mutate" : "read",
    timeout: CALL_TIMEOUT_MS,
  });
}

// ── Checks shared by the handler actions ──────────────────────────────────────

function parseNumbers(raw: string, label: string, counts: number[]): number[] {
  const parts = raw
    .replace(/,/g, " ")
    .trim()
    .split(/\s+/)
    .filter((s) => s !== "");
  const values = parts.map(Number);
  if (!counts.includes(parts.length) || values.some((v) => !Number.isFinite(v))) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${label} takes ${counts.join(" or ")} numbers separated by blanks, got '${raw}'`,
    );
  }
  return values;
}

function checkColor(raw: string, counts: number[]): string {
  const v = parseNumbers(raw, "color", counts);
  if (v.some((x) => x < 0 || x > 1)) {
    throw new Refusal("INVALID_ARGUMENT", `color components are 0..1, got '${raw}'`);
  }
  return v.join(" ");
}

/** Project-relative path of a file of the project; ABSOLUTE_PATH or INVALID_ARGUMENT. */
function checkRel(raw: string, label: string, ext?: string): string {
  let rel: string;
  try {
    rel = checkRelativePath(raw);
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `${label}: ${e.message}`);
    throw e;
  }
  if (ext && !rel.toLowerCase().endsWith(ext)) {
    throw new Refusal("INVALID_ARGUMENT", `${label} must name a ${ext} file, got ${rel}`);
  }
  return rel;
}

/** A checked request for a handler action: the wire params, or the refusal. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: WorldError };

/**
 * Validates one handler-action input against the contract's schema and the shared vocabulary.
 * Nothing is sent when this refuses.
 */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  let target = OPEN;
  const parsed = HANDLER_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const mutating = WORLD_CONTRACT.actions.find((a) => a.name === action)?.mutating ?? true;
  const params: Raw = { ...req };
  try {
    switch (action) {
      case "register": {
        const rel = checkRel(str(req.path), "path");
        target = `path:${rel}`;
        if (rel.toLowerCase().endsWith(".meta")) {
          throw new Refusal(
            "INVALID_ARGUMENT",
            "a .meta file is not registered; name the resource it belongs to",
          );
        }
        params.path = rel;
        params.confirm = req.confirm === true;
        break;
      }
      case "playEvents":
        if (req.after !== undefined && (req.after as number) < 0) {
          throw new Refusal("INVALID_ARGUMENT", "after must be 0 or more");
        }
        break;
      case "comments": {
        if (req.cursor !== undefined) {
          try {
            params.cursor = printCursor(parseCursor(str(req.cursor)));
          } catch (e) {
            if (e instanceof VocabularyError) throw new Refusal(e.code, e.message);
            throw e;
          }
        }
        const limit = req.limit as number | undefined;
        if (limit !== undefined && (limit < 1 || limit > LIMIT_MAX)) {
          throw new Refusal("INVALID_ARGUMENT", `limit must be 1 to ${LIMIT_MAX}`);
        }
        break;
      }
      case "addComment": {
        if (str(req.text).trim() === "") throw new Refusal("INVALID_ARGUMENT", "text is required");
        params.coords = parseNumbers(str(req.coords), "coords", [3]).join(" ");
        if (req.color !== undefined) params.color = checkColor(str(req.color), [3]);
        if (req.size !== undefined && !((req.size as number) > 0)) {
          throw new Refusal("INVALID_ARGUMENT", "size must be above 0 (metres)");
        }
        // Text on the wire: a JSON integer never reaches a float field through RegV (W1 live run
        // 2026-11-11); the handler parses it.
        if (typeof req.size === "number") params.size = String(req.size);
        if (req.layer !== undefined && str(req.layer).trim() === "") {
          throw new Refusal(
            "INVALID_ARGUMENT",
            "layer must not be empty; leave it out for the current one",
          );
        }
        break;
      }
      case "annotate": {
        let ref;
        try {
          ref = parseEntityRef(str(req.entity));
        } catch (e) {
          if (e instanceof VocabularyError) throw new Refusal(e.code, e.message);
          throw e;
        }
        params.entity = printEntityRef(ref);
        target = `entity:${params.entity}`;
        const mode = str(req.mode);
        if (mode !== "add" && mode !== "move" && mode !== "remove") {
          throw new Refusal("INVALID_ARGUMENT", `mode must be add, move or remove; got '${mode}'`);
        }
        const addOnly = ["text", "category", "color", "size"].filter((k) => req[k] !== undefined);
        if (mode !== "add" && addOnly.length) {
          throw new Refusal(
            "INVALID_ARGUMENT",
            `${addOnly.join(", ")}: add only (mode is ${mode})`,
          );
        }
        if (mode !== "move" && req.coords !== undefined) {
          throw new Refusal("INVALID_ARGUMENT", `coords: move only (mode is ${mode})`);
        }
        if (mode === "add") {
          if (str(req.text).trim() === "")
            throw new Refusal("INVALID_ARGUMENT", "text is required for add");
          if (req.color !== undefined) params.color = checkColor(str(req.color), [3, 4]);
          if (req.size !== undefined) {
            const size = req.size as number;
            if (!(size > 0 && size <= NOTE_SIZE_MAX)) {
              throw new Refusal(
                "INVALID_ARGUMENT",
                `size must be above 0 and at most ${NOTE_SIZE_MAX} (metres); leave it out for a height scaled from the entity's bounds`,
              );
            }
            // Text on the wire: a JSON integer never reaches a float field through RegV.
            params.size = String(size);
          }
        }
        if (mode === "move") {
          params.coords = parseNumbers(str(req.coords), "coords", [3]).join(" ");
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    if (e instanceof Refusal) {
      return { ok: false, error: fail(action, target, e.code, e.message, e.next) };
    }
    throw e;
  }
  return { ok: true, action, target, mutating, params };
}

// ── Handler actions ───────────────────────────────────────────────────────────

function rowsSplit(row: string, head: number): string[] {
  const parts = row.split("|");
  if (parts.length <= head) return parts;
  return [...parts.slice(0, head), parts.slice(head).join("|")];
}

/** Polls state until the mode is `want` (play/stop land after the handler answers). */
async function pollMode(
  client: WorldClient,
  first: string,
  want: string,
  deps: WorldDeps,
): Promise<{ mode: string; settled: boolean; reads: number; error?: string }> {
  let mode = first;
  let reads = 0;
  const tries = deps.pollTries ?? POLL_TRIES;
  const wait = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  while (mode !== want && reads < tries) {
    await sleep(wait);
    reads++;
    try {
      const r = await send(client, { action: "state" }, false);
      if (str(r.status) !== "ok") return { mode, settled: false, reads, error: str(r.message) };
      mode = str(r.mode) || mode;
    } catch (e) {
      return { mode, settled: false, reads, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { mode, settled: mode === want, reads };
}

async function runHandlerAction(
  client: WorldClient,
  input: unknown,
  deps: WorldDeps,
): Promise<WorldResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;

  let r: Raw;
  try {
    r = await send(client, params, mutating);
  } catch (e) {
    return clientFailure(action, target, e, mutating);
  }
  const f = handlerFailure(action, target, r);
  if (f) return f;

  const warnings: string[] = [];
  const done = (changed: Change[] | null, readback: unknown, next?: string): ActionOk => {
    const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
    if (next) ok.next = next;
    return ok;
  };

  switch (action) {
    case "state": {
      const worldPath = str(r.worldPath);
      return done(
        null,
        {
          worldPath: worldPath || null,
          worldName: str(r.worldName),
          mode: str(r.mode),
          editAction: truthy(r.editAction),
          restoring: truthy(r.restoring),
          modifying: truthy(r.modifying),
          creatingInWindow: truthy(r.creatingInWindow),
          generatorEvents: truthy(r.generatorEvents),
          toolName: str(r.toolName),
          subScenes: num(r.subScenes),
          currentSubScene: num(r.currentSubScene),
          entityCount: num(r.entityCount),
        },
        worldPath ? undefined : "open a world: wb_module setResource",
      );
    }
    case "browserSelection": {
      const rows = strs(r.rows);
      if (rows.length >= SELECTION_MAX) {
        warnings.push(`the handler answers at most ${SELECTION_MAX} resources: ${str(r.message)}`);
      }
      return done(null, { resources: rows, count: rows.length });
    }
    case "playEvents": {
      const events = strs(r.rows).map((row) => {
        const [seq, tick, event, world, mode, camera] = rowsSplit(row, 5);
        return { seq: num(seq), tick: num(tick), event, world, mode, camera: camera ?? "" };
      });
      const eventSeq = num(r.eventSeq);
      return done(
        null,
        { events, eventSeq },
        `wb_world playEvents after: ${eventSeq} for newer events`,
      );
    }
    case "comments": {
      const rows = strs(r.rows).map((row) => {
        const [id, color, size, text] = rowsSplit(row, 3);
        return { id, color, size: num(size), text: text ?? "" };
      });
      const next = str(r.nextCursor);
      return done(
        null,
        { rows, categories: strs(r.categories), total: num(r.total), nextCursor: next || null },
        next ? `wb_world comments cursor: ${next}` : undefined,
      );
    }
    case "register": {
      const rel = str(params.path);
      const readback = {
        resourceName: str(r.resourceName) || null,
        alreadyRegistered: truthy(r.alreadyRegistered),
        dryRun: truthy(r.dryRun),
      };
      if (readback.alreadyRegistered) {
        return done(null, readback);
      }
      if (readback.dryRun) {
        warnings.push("dry run: nothing was written");
        return done(null, readback, "Resend with confirm: true to register the file.");
      }
      return done([{ path: `${rel}.meta`, before: null, after: readback.resourceName }], readback);
    }
    case "play":
    case "stop": {
      const want = action === "play" ? "play" : "edit";
      const before = action === "play" ? "edit" : "play";
      const p = await pollMode(client, str(r.mode), want, deps);
      if (!p.settled) {
        warnings.push(
          `the mode read back is '${p.mode}' after ${p.reads} state reads${p.error ? ` (${p.error})` : ""}; the switch may still land`,
        );
      }
      return done(
        [{ path: "WorldEditor.mode", before, after: p.mode }],
        { mode: p.mode, settled: p.settled, stateReads: p.reads, eventSeq: num(r.eventSeq) },
        p.settled ? undefined : "wb_world state to read the mode again",
      );
    }
    case "addComment": {
      const id = str(r.id);
      return done(
        [{ path: id, before: null, after: "CommentEntity" }],
        { id, undoName: str(r.undoName) },
        "wb_undo_redo undo reverses it",
      );
    }
    case "annotate": {
      // The note is a CommentEntity EMCP_Note_<entity> (W1.7 run 6: AddCommentEntity drew nothing);
      // id is the note's, entity the annotated one; add and move name where the note is.
      const mode = str(params.mode);
      const id = str(r.id);
      if (params.category !== undefined && str(params.category) !== "")
        warnings.push(
          "category is not stored: the note is a CommentEntity, which has no category field",
        );
      const at = /(?:at|to) (-?[0-9.e+-]+ -?[0-9.e+-]+ -?[0-9.e+-]+)$/.exec(str(r.message));
      const where = mode === "remove" ? null : str(r.noteCoords) || (at ? at[1] : null);
      // add: what was applied (W1.7 run 7: a fixed 0.5 m height was far too large).
      const applied =
        mode === "add"
          ? {
              size: num(r.noteSize),
              color: str(r.noteColor) || null,
              sizeFrom:
                params.size !== undefined
                  ? "request"
                  : `the framing distance ${String(num(r.noteDistance))} m`,
            }
          : null;
      return done(
        [
          {
            path: id || `${str(params.entity)}.note`,
            before: mode === "add" ? null : "note",
            after: mode === "remove" ? null : mode === "add" ? "CommentEntity" : where,
          },
        ],
        {
          id,
          entity: str(params.entity),
          mode,
          at: where,
          ...(applied ? { applied } : {}),
          undoName: str(r.undoName),
        },
        "wb_undo_redo undo reverses it; wb_world comments lists the note",
      );
    }
    default:
      return done(null, r);
  }
}

// ── Offline writers ───────────────────────────────────────────────────────────

interface WorldFiles {
  rel: string;
  abs: string;
  name: string;
  layersRel: string;
  layersAbs: string;
  defaultLayerRel: string;
  defaultLayerAbs: string;
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

/** The guarded paths of a world: `<dir>/<name>.ent` and `<dir>/<name>_Layers/default.layer`. */
function worldFiles(root: string, rawRel: string, label: string): WorldFiles {
  const rel = checkRel(rawRel, label, ".ent");
  const name = basename(rel).slice(0, -".ent".length);
  if (!WORLD_NAME.test(name)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${label}: the world name '${name}' takes letters, digits, '_', '-', '.' and blanks`,
    );
  }
  const abs = resolve(root, rel);
  const layersAbs = join(dirname(abs), `${name}_Layers`);
  const defaultLayerAbs = join(layersAbs, "default.layer");
  for (const p of [abs, layersAbs, defaultLayerAbs]) guard(p, root, label);
  return {
    rel,
    abs,
    name,
    layersRel: toRel(root, layersAbs),
    layersAbs,
    defaultLayerRel: toRel(root, defaultLayerAbs),
    defaultLayerAbs,
  };
}

function guard(abs: string, root: string, label: string): void {
  try {
    assertInsideRoot(abs, root, label);
  } catch (e) {
    throw new Refusal("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
}

function checkPrefab(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const p = raw.trim();
  if (!PREFAB.test(p)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `prefab must be a resource name {GUID}path.et (16 hex digits), got '${p}'`,
    );
  }
  return p;
}

/** The text of a fresh world's `.ent` and `default.layer`, built through the CST writer. */
export function newWorldTexts(prefab?: string): { ent: string; layer: string } {
  const ent = parseCst("");
  ent.createObject("", { key: "Layer", name: "default", entries: [{ key: "Index", value: 0 }] });
  const layer = parseCst("");
  layer.createObject("", { key: WORLD_ENTITY_CLASS, name: "world", base: prefab });
  return { ent: `${ent.serialize()}\n`, layer: `${layer.serialize()}\n` };
}

interface PlannedFile {
  rel: string;
  abs: string;
  bytes: Buffer;
  /** Register this file after writing (it is a resource with a .meta). */
  register: boolean;
}

/** Writes every file; on a failure restores what was there before and removes what was new. */
function writeAll(files: PlannedFile[]): void {
  const done: { abs: string; prior: Buffer | null }[] = [];
  try {
    for (const f of files) {
      const prior = existsSync(f.abs) ? readFileSync(f.abs) : null;
      mkdirSync(dirname(f.abs), { recursive: true });
      // Write-then-rename: a failed write leaves the file as it was (review round 1, F9).
      writeFileAtomic(f.abs, f.bytes);
      done.push({ abs: f.abs, prior });
    }
  } catch (e) {
    for (const d of done.reverse()) {
      try {
        if (d.prior) writeFileAtomic(d.abs, d.prior);
        else rmSync(d.abs, { force: true });
      } catch {
        /* best effort */
      }
    }
    throw e;
  }
}

/** Registers each file through the handler; failures become warnings (the files stay written). */
async function registerAll(
  client: WorldClient,
  rels: string[],
  warnings: string[],
): Promise<{ path: string; resourceName: string | null; alreadyRegistered: boolean }[]> {
  const out: { path: string; resourceName: string | null; alreadyRegistered: boolean }[] = [];
  for (const rel of rels) {
    try {
      const r = await send(client, { action: "register", path: rel, confirm: true }, true);
      const f = handlerFailure("register", `path:${rel}`, r);
      if (f) {
        warnings.push(`register ${rel}: ${f.code}: ${f.message}`);
        continue;
      }
      out.push({
        path: rel,
        resourceName: str(r.resourceName) || null,
        alreadyRegistered: truthy(r.alreadyRegistered),
      });
    } catch (e) {
      const f = clientFailure("register", `path:${rel}`, e, true);
      warnings.push(`register ${rel}: ${f.code}: ${f.message}`);
    }
  }
  return out;
}

function registerNext(rels: string[], done: number): string | undefined {
  if (done >= rels.length) return undefined;
  return `register what is missing: ${rels.map((r) => `wb_world register path: ${r} confirm: true`).join("; ")}`;
}

function filesOf(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) out.push(...filesOf(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** The copy plan of a world: the `.ent` and every file of its layers folder except .meta. */
function duplicatePlan(
  root: string,
  src: WorldFiles,
  dst: WorldFiles,
  overwrite: boolean,
  warnings: string[],
): PlannedFile[] {
  if (!existsSync(src.abs) || !lstatSync(src.abs).isFile()) {
    throw new Refusal("PATH_NOT_FOUND", `no world file ${src.rel} in the project`);
  }
  if (src.abs.toLowerCase() === dst.abs.toLowerCase()) {
    throw new Refusal("INVALID_ARGUMENT", "the destination is the source");
  }
  const existing = [dst.abs, dst.layersAbs].filter((p) => existsSync(p));
  if (existing.length && !overwrite) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `already exists: ${existing.map((p) => toRel(root, p)).join(", ")}; pass overwrite: true to write over it`,
    );
  }
  const plan: PlannedFile[] = [
    { rel: dst.rel, abs: dst.abs, bytes: readFileSync(src.abs), register: true },
  ];
  if (existsSync(src.layersAbs) && lstatSync(src.layersAbs).isDirectory()) {
    for (const file of filesOf(src.layersAbs)) {
      if (file.toLowerCase().endsWith(".meta")) continue;
      guard(file, root, "path");
      const target = join(dst.layersAbs, relative(src.layersAbs, file));
      guard(target, root, "to");
      plan.push({
        rel: toRel(root, target),
        abs: target,
        bytes: readFileSync(file),
        register: existsSync(`${file}.meta`),
      });
    }
  } else {
    warnings.push(`the source has no ${src.layersRel} folder: only the .ent is copied`);
  }
  if (overwrite && existsSync(dst.layersAbs)) {
    const planned = new Set(plan.map((p) => p.abs.toLowerCase()));
    const kept = filesOf(dst.layersAbs).filter(
      (f) => !f.toLowerCase().endsWith(".meta") && !planned.has(f.toLowerCase()),
    );
    if (kept.length) {
      warnings.push(
        `kept in the destination's layers folder (not in the source): ${kept.map((f) => toRel(root, f)).join(", ")}`,
      );
    }
  }
  const dir = dirname(src.abs);
  const terrain = [
    `${src.name}.smap`,
    `${src.name}.topo`,
    `${src.name}_SMD.conf`,
    "Terrain",
  ].filter((n) => existsSync(join(dir, n)));
  if (terrain.length) {
    warnings.push(
      `terrain data is not copied (${terrain.join(", ")}): the copy is the entity layers only`,
    );
  }
  return plan;
}

interface OfflineInput {
  action: OfflineAction;
  path?: string;
  to?: string;
  prefab?: string;
  overwrite?: boolean;
  confirm?: boolean;
}

function dryRunReadback(plan: PlannedFile[], extra: Raw = {}): Raw {
  return {
    dryRun: true,
    wouldWrite: plan.map((p) => ({ path: p.rel, bytes: p.bytes.length, register: p.register })),
    ...extra,
  };
}

/**
 * Copies every planned file that already exists to `<artifacts>/world/<stamp>-<action>-<world>/`,
 * under its project-relative path, before an overwrite replaces it (live-tools-a-06): the same
 * artifacts folder as setWorldEntity's snapshot, outside the project so no backup lands in a
 * layers folder a later duplicate would copy. Returns that folder as `<artifacts>/...`, or null
 * when nothing existed.
 */
function snapshotExisting(
  plan: PlannedFile[],
  action: string,
  world: string,
  deps: WorldDeps,
): string | null {
  const existing = plan.filter((p) => existsSync(p.abs));
  if (existing.length === 0) return null;
  const now = (deps.now ?? (() => new Date()))();
  const dirName = `${now.toISOString().replace(/[:.]/g, "-")}-${action}-${world}`;
  const dir = join(deps.artifactsRoot ?? defaultArtifactsDir(), "world", dirName);
  for (const p of existing) {
    const dst = join(dir, ...p.rel.split("/"));
    mkdirSync(dirname(dst), { recursive: true });
    writeFileAtomic(dst, readFileSync(p.abs));
  }
  return `<artifacts>/world/${dirName}`;
}

async function writeAndRegister(
  client: WorldClient,
  plan: PlannedFile[],
  warnings: string[],
  snap: { action: string; world: string; deps: WorldDeps },
): Promise<{ changed: Change[]; registered: Raw[]; next?: string; snapshot: string | null }> {
  const before = new Map(plan.map((p) => [p.abs, existsSync(p.abs)]));
  // An overwrite keeps the replaced files: written before the first project write.
  const snapshot = snapshotExisting(plan, snap.action, snap.world, snap.deps);
  writeAll(plan);
  const rels = plan.filter((p) => p.register).map((p) => p.rel);
  const registered = await registerAll(client, rels, warnings);
  const changed: Change[] = plan.map((p) => ({
    path: p.rel,
    before: before.get(p.abs) ? "existed" : null,
    after: "written",
  }));
  return { changed, registered, next: registerNext(rels, registered.length), snapshot };
}

async function doNew(
  client: WorldClient,
  root: string,
  req: OfflineInput,
  deps: WorldDeps,
): Promise<WorldResponse> {
  const w = worldFiles(root, str(req.path), "path");
  const target = `path:${w.rel}`;
  const prefab = checkPrefab(req.prefab);
  const existing = [w.abs, w.defaultLayerAbs].filter((p) => existsSync(p));
  if (existing.length && req.overwrite !== true) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `already exists: ${existing.map((p) => toRel(root, p)).join(", ")}; pass overwrite: true to write over it`,
    );
  }
  const texts = newWorldTexts(prefab);
  const plan: PlannedFile[] = [
    { rel: w.rel, abs: w.abs, bytes: Buffer.from(texts.ent, "utf8"), register: true },
    {
      rel: w.defaultLayerRel,
      abs: w.defaultLayerAbs,
      bytes: Buffer.from(texts.layer, "utf8"),
      register: false,
    },
  ];
  const warnings: string[] = [];
  if (req.confirm !== true) {
    warnings.push("dry run: nothing was written");
    return {
      ok: true,
      action: "new",
      target,
      changed: null,
      readback: dryRunReadback(plan, { ent: texts.ent, defaultLayer: texts.layer }),
      next: "Resend with confirm: true to write the files and register the world.",
      warnings,
    };
  }
  const res = await writeAndRegister(client, plan, warnings, { action: "new", world: w.name, deps });
  const ok: ActionOk = {
    ok: true,
    action: "new",
    target,
    changed: res.changed,
    readback: {
      files: plan.map((p) => p.rel),
      registered: res.registered,
      ...(res.snapshot ? { snapshot: res.snapshot } : {}),
    },
    warnings,
  };
  ok.next = res.next ?? `open it: wb_module setResource path:${w.rel}`;
  return ok;
}

async function doDuplicate(
  client: WorldClient,
  root: string,
  req: OfflineInput,
  deps: WorldDeps,
): Promise<WorldResponse> {
  const src = worldFiles(root, str(req.path), "path");
  const dst = worldFiles(root, str(req.to), "to");
  const target = `path:${dst.rel}`;
  const warnings: string[] = [];
  const plan = duplicatePlan(root, src, dst, req.overwrite === true, warnings);
  if (req.confirm !== true) {
    warnings.push("dry run: nothing was written");
    return {
      ok: true,
      action: "duplicate",
      target,
      changed: null,
      readback: dryRunReadback(plan, { from: src.rel }),
      next: "Resend with confirm: true to copy the files and register them.",
      warnings,
    };
  }
  const res = await writeAndRegister(client, plan, warnings, {
    action: "duplicate",
    world: dst.name,
    deps,
  });
  const ok: ActionOk = {
    ok: true,
    action: "duplicate",
    target,
    changed: res.changed,
    readback: {
      from: src.rel,
      files: plan.map((p) => p.rel),
      registered: res.registered,
      ...(res.snapshot ? { snapshot: res.snapshot } : {}),
    },
    warnings,
  };
  if (res.next) ok.next = res.next;
  return ok;
}

/** The project-relative path of the open world, from wb_world state's `$addon:path`. */
function openWorldRel(worldPath: string): string {
  return worldPath.replace(FS_PREFIX, "").replace(/\\/g, "/");
}

async function doSaveAs(
  client: WorldClient,
  root: string,
  req: OfflineInput,
  deps: WorldDeps,
): Promise<WorldResponse> {
  const dst = worldFiles(root, str(req.to), "to");
  const target = `path:${dst.rel}`;
  // Which world is open: a read.
  let state: Raw;
  try {
    state = await send(client, { action: "state" }, false);
  } catch (e) {
    return clientFailure("saveAs", target, e, false);
  }
  const sf = handlerFailure("saveAs", target, state);
  if (sf) return sf;
  const worldPath = str(state.worldPath);
  if (!worldPath) {
    throw new Refusal("NO_WORLD", "state answers no world path: no world is open");
  }
  if (str(state.mode) === "play") {
    throw new Refusal("WRONG_MODE", "the World Editor is in play mode", "wb_world stop");
  }
  const foreign = worldPrefixRefusal(root, worldPath);
  if (foreign) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      `the open world is not a world file of the project: ${foreign} (a game or dependency world is not copied)`,
    );
  }
  let src: WorldFiles;
  try {
    src = worldFiles(root, openWorldRel(worldPath), "the open world");
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    throw new Refusal(
      "NOT_IN_PROJECT",
      `the open world ${worldPath} is not a world file of the project: ${(e as Error).message}`,
    );
  }
  if (!existsSync(src.abs)) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      `the open world ${worldPath} has no file ${src.rel} in the project folder (a game or dependency world is not copied)`,
    );
  }
  const warnings: string[] = [];
  if (req.confirm !== true) {
    const plan = duplicatePlan(root, src, dst, req.overwrite === true, warnings);
    warnings.push(
      "dry run: nothing was saved or written; the copy is of the files as they are now",
    );
    return {
      ok: true,
      action: "saveAs",
      target,
      changed: null,
      readback: dryRunReadback(plan, {
        from: src.rel,
        steps: ["wb_module save", "duplicate", "register", `wb_module setResource path:${dst.rel}`],
      }),
      next: "Resend with confirm: true to save the open world, copy it and open the copy.",
      warnings,
    };
  }
  // Check the destination before saving anything.
  duplicatePlan(root, src, dst, req.overwrite === true, []);
  const mc = client as ModuleClient;
  const saved = await runModule(mc, { action: "save", module: "WorldEditor", confirm: true });
  if (!saved.ok) {
    return { ...saved, action: "saveAs", target, message: `wb_module save: ${saved.message}` };
  }
  warnings.push(...saved.warnings);
  // From here the open world is saved: a failure says so (review round 1, F8).
  let plan: PlannedFile[];
  let res: Awaited<ReturnType<typeof writeAndRegister>>;
  try {
    plan = duplicatePlan(root, src, dst, req.overwrite === true, warnings);
    res = await writeAndRegister(client, plan, warnings, { action: "saveAs", world: dst.name, deps });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return fail(
      "saveAs",
      target,
      e instanceof Refusal ? e.code : "SAVE_FAILED",
      `the open world ${src.rel} was saved (wb_module save); the copy to ${dst.rel} failed and what it had written was rolled back: ${why}`,
      `The open world is saved and still open. Fix the destination, then wb_world duplicate path:${src.rel} to:${dst.rel}.`,
    );
  }
  const opened = await runModule(mc, {
    action: "setResource",
    module: "WorldEditor",
    target: `path:${dst.rel}`,
  });
  const changed: Change[] = [{ path: src.rel, before: null, after: "saved" }, ...res.changed];
  let next = res.next;
  if (opened.ok) {
    changed.push({ path: "WorldEditor.openedResource", before: src.rel, after: dst.rel });
  } else {
    warnings.push(`wb_module setResource: ${opened.code}: ${opened.message}`);
    next = `the copy is written; open it: wb_module setResource path:${dst.rel}`;
  }
  const ok: ActionOk = {
    ok: true,
    action: "saveAs",
    target,
    changed,
    readback: {
      from: src.rel,
      files: plan.map((p) => p.rel),
      registered: res.registered,
      opened: opened.ok,
      ...(res.snapshot ? { snapshot: res.snapshot } : {}),
    },
    warnings,
  };
  if (next) ok.next = next;
  return ok;
}

function findObject(entries: CstEntry[], key: string): CstObject | undefined {
  for (const e of entries) {
    if (e.kind !== "object") continue;
    if (e.key === key) return e;
    const inner = findObject(e.children, key);
    if (inner) return inner;
  }
  return undefined;
}

/** The world entity's header in a default.layer, and the text with a new base. */
export function replaceWorldEntity(
  doc: CstDocument,
  prefab: string | undefined,
): { before: string; after: string; doc: CstDocument } {
  const obj = findObject(doc.root.children, WORLD_ENTITY_CLASS);
  if (!obj) {
    throw new Refusal("PATH_NOT_FOUND", `no ${WORLD_ENTITY_CLASS} block in the default layer`);
  }
  const text = doc.text;
  const before = text.slice(obj.start, obj.open.end);
  const last = obj.head[obj.head.length - 1];
  const head = text.slice(obj.start, last.end);
  const after = `${head}${prefab ? ` : "${prefab}"` : ""} {`;
  const next = new CstDocument(
    text.slice(0, obj.start) + after + text.slice(obj.open.end),
    doc.encoding,
  );
  // Read the edit back through the parser: one world entity, the new base, no new diagnostics.
  const again = findObject(next.root.children, WORLD_ENTITY_CLASS);
  const base = again?.base.length ? next.text.slice(again.base[0].start, again.base[0].end) : "";
  if (
    !again ||
    base !== (prefab ? `"${prefab}"` : "") ||
    next.diagnostics.length !== doc.diagnostics.length
  ) {
    throw new Refusal("INVALID_ARGUMENT", "the edited layer does not read back as written");
  }
  return { before, after, doc: next };
}

async function doSetWorldEntity(
  root: string,
  req: OfflineInput,
  deps: WorldDeps,
): Promise<WorldResponse> {
  const w = worldFiles(root, str(req.path), "path");
  const target = `path:${w.rel}`;
  const prefab = checkPrefab(req.prefab);
  if (!existsSync(w.abs))
    throw new Refusal("PATH_NOT_FOUND", `no world file ${w.rel} in the project`);
  if (!existsSync(w.defaultLayerAbs)) {
    throw new Refusal("PATH_NOT_FOUND", `no default layer ${w.defaultLayerRel} beside the world`);
  }
  const original = readFileSync(w.defaultLayerAbs);
  const edit = replaceWorldEntity(parseCstBytes(original), prefab);
  const warnings: string[] = [];
  const change: Change = {
    path: `${w.defaultLayerRel}:${WORLD_ENTITY_CLASS}`,
    before: edit.before,
    after: edit.after,
  };
  if (edit.before === edit.after) {
    return {
      ok: true,
      action: "setWorldEntity",
      target,
      changed: null,
      readback: { file: w.defaultLayerRel, header: edit.before, unchanged: true },
      warnings,
    };
  }
  if (req.confirm !== true) {
    warnings.push("dry run: nothing was written");
    return {
      ok: true,
      action: "setWorldEntity",
      target,
      changed: null,
      readback: { dryRun: true, file: w.defaultLayerRel, wouldChange: [change] },
      next: "Resend with confirm: true to write the layer (a snapshot is kept).",
      warnings,
    };
  }
  const now = (deps.now ?? (() => new Date()))();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const snapName = `${stamp}-${w.name}-default.layer`;
  const snapAbs = join(deps.artifactsRoot ?? defaultArtifactsDir(), "world", snapName);
  mkdirSync(dirname(snapAbs), { recursive: true });
  // The snapshot (artifacts folder) also goes write-then-rename: no cut-short snapshot.
  writeFileAtomic(snapAbs, original);
  try {
    // Write-then-rename: a failed write leaves the layer as it was (review round 1, F8 and F9).
    writeFileAtomic(w.defaultLayerAbs, edit.doc.toBytes());
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return fail(
      "setWorldEntity",
      target,
      "SAVE_FAILED",
      `the layer ${w.defaultLayerRel} could not be written and is unchanged: ${why}`,
      `A snapshot of the layer is at <artifacts>/world/${snapName}. Check the file (read only, locked) and retry.`,
    );
  }
  warnings.push(
    "if this world is open in the World Editor, its in-memory copy still has the old entity: reopen it (wb_module setResource) before a save, or the save writes the old one back",
  );
  return {
    ok: true,
    action: "setWorldEntity",
    target,
    changed: [change],
    readback: { file: w.defaultLayerRel, snapshot: `<artifacts>/world/${snapName}` },
    warnings,
  };
}

/**
 * The addon folder the offline writers write in: deps.projectRoot when set (tests and the live
 * batteries pass the sandbox addon), else the addon resolveAddonRoot reads from
 * ENFUSION_PROJECT_PATH (the addons directory, src/config.ts). Throws a NOT_IN_PROJECT Refusal.
 */
function offlineRoot(deps: WorldDeps): string {
  if (deps.projectRoot !== undefined || !deps.addons) {
    const root = deps.projectRoot;
    if (!root || !existsSync(root)) {
      throw new Refusal(
        "NOT_IN_PROJECT",
        "no project folder is configured (ENFUSION_PROJECT_PATH) or it does not exist",
      );
    }
    return root;
  }
  const r = resolveAddonRoot(deps.addons);
  if (!r.ok) throw new Refusal(r.code, `${r.message}; nothing was written`);
  return r.root;
}

async function runOffline(
  client: WorldClient,
  input: unknown,
  deps: WorldDeps,
): Promise<WorldResponse> {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action) as OfflineAction;
  const guessTarget = (k: string) => (typeof raw[k] === "string" ? `path:${str(raw[k])}` : "");
  let target =
    action === "duplicate" || action === "saveAs" ? guessTarget("to") : guessTarget("path");
  const schema = OFFLINE_SCHEMAS.find((s) => s.shape.action.value === action);
  const parsed = schema?.safeParse(input);
  if (!parsed?.success) {
    const issues = parsed
      ? parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
      : `unknown action ${action}`;
    return fail(action, target, "INVALID_ARGUMENT", issues);
  }
  const req = parsed.data as OfflineInput;
  try {
    const root = offlineRoot(deps);
    switch (action) {
      case "new":
        return await doNew(client, root, req, deps);
      case "duplicate":
        return await doDuplicate(client, root, req, deps);
      case "saveAs":
        return await doSaveAs(client, root, req, deps);
      case "setWorldEntity":
        return await doSetWorldEntity(root, req, deps);
    }
  } catch (e) {
    if (e instanceof Refusal) return fail(action, target, e.code, e.message, e.next);
    // new and duplicate: a write that failed part way was rolled back by writeAll. saveAs and
    // setWorldEntity answer their own failures after their first write (review round 1, F8).
    target ||= OPEN;
    return fail(
      action,
      target,
      "SAVE_FAILED",
      `the write failed: ${e instanceof Error ? e.message : String(e)}`,
      "What this call had written was rolled back; check the folder (read only, locked, full) and retry.",
    );
  }
  return fail(action, target, "INVALID_ARGUMENT", `unknown action ${action}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_world request end to end; never throws for a Workbench-side failure. */
export async function runWorld(
  client: WorldClient,
  input: unknown,
  deps: WorldDeps = {},
): Promise<WorldResponse> {
  const action = str(((input ?? {}) as Raw).action);
  if ((OFFLINE_ACTIONS as readonly string[]).includes(action)) {
    return runOffline(client, input, deps);
  }
  return runHandlerAction(client, input, deps);
}

/** A flat input shape for registerTool (the per-action union is checked in runWorld). */
export function flatInputShape(c: Contract = WORLD_CONTRACT): z.ZodRawShape {
  const names = [...c.actions.map((a) => a.name), ...OFFLINE_ACTIONS] as string[] as [
    string,
    ...string[],
  ];
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
  shape.path = z
    .string()
    .describe("register: project-relative file; new, duplicate, setWorldEntity: the .ent")
    .optional();
  shape.to = z.string().describe("duplicate, saveAs: the new .ent (project-relative)").optional();
  shape.prefab = z
    .string()
    .describe("new, setWorldEntity: world entity prefab {GUID}path.et; empty = plain")
    .optional();
  shape.overwrite = z
    .boolean()
    .describe("new, duplicate, saveAs: write over existing files")
    .optional();
  shape.confirm = z
    .boolean()
    .describe("register and offline writers: true writes; else a dry run")
    .optional();
  return shape;
}

export function toToolResult(r: WorldResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

export function registerWbWorld(
  server: McpServer,
  client: WorkbenchClient,
  config: Pick<Config, "projectPath" | "defaultMod">,
  deps: WorldDeps = {},
): void {
  // The config object itself: wb_launch sets defaultMod at run time.
  const full: WorldDeps = { addons: config, ...deps };
  server.registerTool(
    "wb_world",
    {
      description: wbWorldDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "World Editor world",
        readOnlyHint: false,
        // setWorldEntity and an overwrite rewrite files of the project.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runWorld(client, input, full));
    },
  );
}
