import { z } from "zod";

/**
 * Shared parameter vocabulary and response shape (phase3-tool-surface.md sections 3 and 4).
 * Every Phase 3 tool schema uses exactly these names.
 */

/**
 * The 9 module ids, spelled as ECEN_ProbeUtil.ModuleType (mod-dev/probe/ECEN_ProbeUtil.c:55-75)
 * without DialogueEditor, plus ParticleEditor. NavmeshGeneratorMain left with build 1.9.0.37,
 * where its class is gone (W5 OD-5, DEC-068; EMCP_WB_Guard.ModuleType holds the same list).
 */
export const MODULE_IDS = [
  "AnimEditor",
  "AudioEditor",
  "BehaviorEditor",
  "LocalizationEditor",
  "ParticleEditor",
  "ProcAnimEditor",
  "ResourceManager",
  "ScriptEditor",
  "WorldEditor",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * The module that owns a path's file type (EMCP_WB_OpenResource.OwnerOf, the same table): the
 * World Editor takes only a world (.ent) and a prefab (.et, prefab edit mode: W1 w1-43); a .conf
 * handed to it raised the modal "Cannot open prefabs at this time (not implemented)" (W2 run 2,
 * w2-50, 1.9.0.37). Everything without its own editor opens in the Resource Manager.
 */
export function owningModule(path: string): ModuleId {
  const lower = path.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  if (ext === ".ent" || ext === ".et") return "WorldEditor";
  if (ext === ".bt") return "BehaviorEditor";
  if ([".aw", ".agr", ".agf", ".ast", ".asi"].includes(ext)) return "AnimEditor";
  if ([".acp", ".sig"].includes(ext)) return "AudioEditor";
  if ([".pap", ".siga"].includes(ext)) return "ProcAnimEditor";
  if (ext === ".st") return "LocalizationEditor";
  if (ext === ".c") return "ScriptEditor";
  if (ext === ".ptc") return "ParticleEditor";
  return "ResourceManager";
}
export const MODULE_SCHEMA = z.enum(MODULE_IDS);

/** Accepted for open/front/close only; every read refuses (the Enforce handler refuses too). */
export const READ_REFUSED_MODULES: readonly ModuleId[] = ["ParticleEditor"];

export function moduleAllowsRead(module: ModuleId): boolean {
  return !READ_REFUSED_MODULES.includes(module);
}

// Error codes: code -> default `next` text.

export const ERROR_CODES = {
  MODULE_NOT_OPEN: "Open the module first: wb_module open.",
  NOT_IN_PROJECT: "Mutating actions run only inside the open project.",
  NOT_ALLOWLISTED: "The action is not on the allow-list; nothing was sent.",
  ABSOLUTE_PATH:
    "Use a project-relative resource path (no drive, root, filesystem prefix or '..').",
  PATH_NOT_FOUND: "Check the path against the sibling names listed.",
  MODAL_OPEN: "A modal dialog is open; nothing was sent; ask the owner.",
  LOST: "The call was lost in a queue reset; read back the state before any retry.",
  INVALID_ARGUMENT: "Fix the argument named in the message.",
  WEDGED:
    "No answer and no reset past the wedge threshold; nothing is retried; check the Workbench window.",
  UNREACHABLE: "Workbench is not running or the NET API is off; wb_launch or check the lease.",
  BUSY: "A mutating call is pending; retry when the queue is idle.",
  VALIDATION_FAILED: "ValidateScripts reported errors; read them and fix the scripts.",
  RELOAD_FAILED:
    "The old handlers are still loaded (DEC-044). A reload after the fix may still answer Compilation failed (DEC-044 U14); relaunch with wb_launch is the fallback (DEC-047 L1).",
  RUN_FAILED: "The Workbench process ended without the expected line; read its log.",
  GATED: "The action exists but waits for its live battery (DEC-047); nothing was sent.",
  HANDLER_ERROR: "The handler answered an error; read its message.",
  MODULE_NOT_SUPPORTED: "waits for sitting P3-1",
  ENGINE_FALSE: "The engine call returned false; nothing changed.",
  UNPROVEN: "waits for train #2 gate 2",
  SAVE_FAILED:
    "SaveContainer returned false; the in-memory value may differ from the file; read back before retrying.",
  // Wave W1 (phase5-w1-spec.md section 1).
  ENTITY_NOT_FOUND:
    "No editor entity matches the reference; list them (wb_entity list) and use the id: it answers.",
  WRONG_MODE:
    "The World Editor is not in edit mode (play or prefab edit); stop play or leave prefab edit first.",
  NO_WORLD: "No world is open in the World Editor; open one first (wb_module setResource).",
  NO_TERRAIN: "The open world has no terrain; open a world that has one.",
  STALE_CURSOR: "The list changed since the cursor was issued; read again without a cursor.",
  NOT_EMPTY:
    "The layer or folder still holds entities or child items; move them out, or delete with withContents: true and confirm: true.",
  // Waves W2 and W3 offline tools (phase5-w2-spec.md section 1, phase5-w3-spec.md section 1; DEC-065).
  META_NOT_FOUND:
    "No .meta sits beside the resource. Register a new resource through Workbench (wb_resources register); this tool never creates a meta.",
  UNSUPPORTED_TYPE:
    "The file is not a meta this writer can reproduce byte for byte; edit it in Workbench (wb_meta).",
  READ_ONLY_SOURCE: "The meta is game data (read only): copy the resource into the project first.",
  ITEM_NOT_FOUND:
    "No item with that Id or index; list the table (string_table get) and use an Id it answers.",
  DUPLICATE_ID:
    "An item with that Id already exists, or the Id is given twice; pick a new Id or update the existing item.",
  // Waves W2 and W3 handlers and tools (phase5-w2-spec.md section 1, phase5-w3-spec.md section 1).
  RESOURCE_NOT_FOUND:
    "No resource has that GUID or path; search for it (wb_resources search) and use the name it answers.",
  NO_OPEN_RESOURCE: "Open a resource in the Resource Manager first (wb_module setResource).",
  NO_DOCUMENT:
    "The editor has no file or table open; open one first (wb_script_editor open, wb_localization open <path>.st).",
  MODAL_HAZARD:
    "The edit would open an engine dialog; nothing was changed. Make that edit in the editor by hand.",
  TEXT_CHANGED:
    "The lines no longer read as expected; read them again (wb_script_editor getLines) and resend.",
  LSP_OFF:
    "The language server is not enabled or does not answer: the owner sets LSP_Enabled=1 and LSP_Port in the Workbench ini (or launches with -lsp), then restarts the Workbench.",
  // Wave W4 (phase5-w4-spec.md section 1.1; DEC-067).
  TXA_ERROR:
    "TxaExporter answered an error; errMsg has its text. Check the profile, the keys or the file, then call again.",
  REWRITE_INCOMPLETE:
    "Fix the unresolved or unregistered files named in the message, then run duplicate again.",
  // Wave W5 (phase5-w5-spec.md section 1.3; DEC-068).
  NO_AI_WORLD:
    "The open world has no AIWorld; add the SCR_AIWorld prefab (or an AIWorld entity) to the world.",
  NO_NAVMESH_COMPONENT:
    "The AIWorld declares no such navmesh project; pass one of the projects wb_navmesh status answers.",
  NOT_SCR_AI_WORLD:
    "The AIWorld is not an SCR_AIWorld, so its rebuild areas cannot be read; use rebuild with a box around the entity.",
  NO_SOUND_COMPONENT:
    "The entity has no sound component; pick an entity whose prefab has a SoundComponent.",
  NO_SIGNALS_MANAGER:
    "The entity has no SignalsManagerComponent; pick an entity whose prefab has one.",
  NO_SOUND_WORLD: "The open world has no SoundWorld; open a game world in the World Editor.",
  EVENT_NOT_FOUND:
    "No event with that name; list the events (audio events offline, wb_audio entityEvents on an entity) and use a name it answers.",
  VARIABLE_NOT_FOUND:
    "No variable with that name; list the variables (audio variables) and use a name it answers.",
  PLAY_FAILED: "The engine gave no playing handle; check the .acp or the event name.",
  NOT_A_PARTICLE_EFFECT:
    "The entity is not a ParticleEffectEntity; spawn one (wb_particle spawn) or pick another entity.",
  NO_PARTICLES:
    "The effect has no particle system yet (no effect path, or not simulated); read it offline with particle inspect.",
  BOX_TOO_LARGE: "A rebuild box is at most 512 m on each side; rebuild a smaller box, or several.",
  WRONG_MODULE: "The file belongs to another module; it is never opened in the Audio Editor.",
  SIG_COMPILED_STALE:
    "The .sig carries a compiled block that an edit does not regenerate; edit it in the Audio Editor, or pass acceptStale: true to write anyway.",
  NODE_NOT_FOUND:
    "No node has that id in this .acp; list the nodes (audio nodes) and use an id it answers.",
  LINK_NOT_FOUND:
    "No link matches; list the node's links (audio node) and use the ports it answers.",
  NODE_IN_USE:
    "Other nodes name this node (outState, piid or group); repoint them first, or pass force: true to remove it anyway.",
  // Wave W6 (phase5-w6-spec.md section 1.2 rule 12; DEC-069).
  PLUGIN_MODAL:
    "The plugin's Run opens a dialog (E03); it is never run from here; use the GUI path, wave W8.",
  PRECONDITION_UNMET:
    "The plugin's preconditions are not met; the message names the missing one. Set it up and call again.",
  NO_SETTER: "This build has no way to write a plugin setting; read it with getSettings.",
  NOT_A_SHAPE: "The entity is not a ShapeEntity; pass a polyline or spline (wb_entity list).",
  // Wave W7 (phase5-w7-spec.md section 1.2 rule 13; DEC-075).
  TERRAIN_ACTION_REFUSED: "BeginTerrainAction answered false; nothing was written.",
  NO_BACKUP: "Run wb_terrain_edit backup for this world first.",
  NOT_A_GENERATOR: "The prefab or entity is not a GeneratorBaseEntity.",
  WORLD_OPEN: "Close the world in the World Editor before restore.",
  ENGINE_BUSY: "The editor is inside another edit action or an undo; retry when it ends.",
  // Wave W8 (phase5-w8-spec.md section 1.2 rule 10; DEC-076).
  NO_LOCATOR: "No locator for this row on this build; use find, or the pixel recipe.",
  LOCATOR_STALE: "The locator no longer matches the census name and type.",
  WB_RUNNING: "Workbench is running; it writes settings at exit, so close it first.",
  NOT_SCRATCH: "The file is not a scratch ini made by wb_settings profile.",
  DIAG_UNKNOWN:
    "No diag id with that name in SCR_DebugMenuID or EDiagMenu; wb_diag catalog lists the names.",
  WORLD_DIFFERS: "The link names another world than the open one; confirm to switch.",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

/** A refusal raised in TypeScript before anything is sent to Workbench. */
export class VocabularyError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "VocabularyError";
    this.code = code;
  }
}

// target

export type Target = { kind: "path"; path: string } | { kind: "open"; module: "WorldEditor" };

const DRIVE = /^[A-Za-z]:/;
const FS_PREFIX = /^\$[A-Za-z0-9_]*:/;
/** Any scheme-like prefix (`file:`, `http:`, `file:///`); two chars minimum so `C:` stays a drive. */
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:/;

/**
 * Checks a project-relative resource path. Absolute forms (drive, leading slash or backslash,
 * UNC, `$prefix:` filesystem roots, URLs) and any `..` segment throw ABSOLUTE_PATH.
 * Returns the path with backslashes turned into forward slashes.
 */
export function checkRelativePath(raw: string): string {
  const p = raw.trim();
  if (p === "") throw new VocabularyError("INVALID_ARGUMENT", "empty resource path");
  if (p.includes("\0")) throw new VocabularyError("INVALID_ARGUMENT", "NUL in resource path");
  if (
    DRIVE.test(p) ||
    p.startsWith("/") ||
    p.startsWith("\\") ||
    FS_PREFIX.test(p) ||
    URL_SCHEME.test(p)
  ) {
    throw new VocabularyError("ABSOLUTE_PATH", `absolute path refused: ${p}`);
  }
  const norm = p.replace(/\\/g, "/");
  if (norm.split("/").some((seg) => seg === "..")) {
    throw new VocabularyError("ABSOLUTE_PATH", `'..' refused in path: ${p}`);
  }
  return norm;
}

/** Parses `path:<project-relative resource>` or `open:WorldEditor`. */
export function parseTarget(raw: string): Target {
  if (raw.startsWith("path:")) return { kind: "path", path: checkRelativePath(raw.slice(5)) };
  if (raw === "open:WorldEditor") return { kind: "open", module: "WorldEditor" };
  if (raw.startsWith("open:")) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `only open:WorldEditor is a document target in Phase 3, got ${raw}`,
    );
  }
  throw new VocabularyError(
    "INVALID_ARGUMENT",
    `target must be path:<resource> or open:WorldEditor, got ${raw}`,
  );
}

export function printTarget(t: Target): string {
  return t.kind === "path" ? `path:${t.path}` : `open:${t.module}`;
}

/**
 * Wave W2 container targets (phase5-w2-spec.md section 2.4, OD-10): the resource open in the
 * Resource Manager, and a class's default container (read only). Only wb_container takes them.
 */
export type ModuleTarget = { kind: "module"; module: "ResourceManager" };
export type ClassTarget = { kind: "class"; name: string };

/** A script class name, as the Container handler's IsClassName (letter or underscore first, 128 at most). */
export const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** `open:ResourceManager`, or undefined for any other text. */
export function parseModuleTarget(raw: string): ModuleTarget | undefined {
  return raw === "open:ResourceManager" ? { kind: "module", module: "ResourceManager" } : undefined;
}

/**
 * Wave W4 editor targets (phase5-w4-spec.md 2.3, DEC-067): the one open document of AnimEditor,
 * BehaviorEditor or ProcAnimEditor, by the open:ResourceManager rule. The Container handler refuses
 * each GATED, before any engine call, until probes P-W4-10 and P-W4-29 pass for that editor; the
 * gate lives in Enforce only (EMCP_WB_ContainerTarget.EditorGate). Only wb_container takes them.
 */
export const EDITOR_TARGET_MODULES = ["AnimEditor", "BehaviorEditor", "ProcAnimEditor"] as const;
export type EditorTarget = { kind: "editor"; module: (typeof EDITOR_TARGET_MODULES)[number] };

/** `open:<AnimEditor|BehaviorEditor|ProcAnimEditor>`, or undefined for any other text. */
export function parseEditorTarget(raw: string): EditorTarget | undefined {
  const m = EDITOR_TARGET_MODULES.find((e) => raw === `open:${e}`);
  return m ? { kind: "editor", module: m } : undefined;
}

export function printEditorTarget(t: EditorTarget): string {
  return `open:${t.module}`;
}

/** `class:<Name>`; throws INVALID_ARGUMENT for a bad class name. */
export function parseClassTarget(raw: string): ClassTarget {
  if (!raw.startsWith("class:")) {
    throw new VocabularyError("INVALID_ARGUMENT", `target must be class:<Name>, got ${raw}`);
  }
  const name = raw.slice(6);
  if (!CLASS_NAME.test(name)) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `class:<Name> takes a script class name (letters, digits, underscores), got '${name}'`,
    );
  }
  return { kind: "class", name };
}

export function printModuleTarget(t: ModuleTarget): string {
  return `open:${t.module}`;
}

export function printClassTarget(t: ClassTarget): string {
  return `class:${t.name}`;
}

export const TARGET_SCHEMA = z
  .string()
  .describe("path:<project-relative resource> | open:WorldEditor");

// entity

export const ENTITY_SCHEMA = z.union([
  z.object({ name: z.string().min(1) }).strict(),
  z.object({ index: z.number().int().min(0) }).strict(),
]);
export type EntityRef = z.infer<typeof ENTITY_SCHEMA>;

/**
 * W1 entity reference string (phase5-w1-spec.md section 1), resolved Workbench-side by
 * EMCP_WB_EntityRef.c: `id:<hex>` | `name:<name>` | `index:<i>`.
 * - `id`: optional `0x`, hex digits in any case; held canonical as 16 lower-case digits
 *   (leading zeros past 16 dropped, then left-padded), the form EMCP_WB_EntityRef.NormalizeHex
 *   answers. Printed as `id:0x<16 hex>`.
 * - `name`: any non-empty text, exact and case-sensitive (the first editor entity with that name).
 * - `index`: 1 to 9 decimal digits, no sign (the editor list index).
 */
export type ParsedEntityRef =
  | { kind: "id"; id: string }
  | { kind: "name"; name: string }
  | { kind: "index"; index: number };

const ENTITY_ID_DIGITS = 16;
const HEX = /^[0-9a-f]+$/;
const INDEX_DIGITS = /^\d{1,9}$/;

/** Canonical 16-digit lower-case hex of an `id:` body, or undefined when it is not hex. */
export function normalizeEntityId(raw: string): string | undefined {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("0x")) s = s.slice(2);
  if (s === "" || !HEX.test(s)) return undefined;
  while (s.length > ENTITY_ID_DIGITS && s.startsWith("0")) s = s.slice(1);
  if (s.length > ENTITY_ID_DIGITS) return undefined;
  return s.padStart(ENTITY_ID_DIGITS, "0");
}

/** Parses `id:<hex>`, `name:<name>` or `index:<i>`. Throws INVALID_ARGUMENT on anything else. */
export function parseEntityRef(raw: string): ParsedEntityRef {
  if (raw.startsWith("id:")) {
    const id = normalizeEntityId(raw.slice(3));
    if (id === undefined) {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        `id: takes 1 to 16 hex digits with an optional 0x, got ${raw}`,
      );
    }
    return { kind: "id", id };
  }
  if (raw.startsWith("name:")) {
    const name = raw.slice(5);
    if (name === "") throw new VocabularyError("INVALID_ARGUMENT", "name: needs a name");
    if (name.includes("\0")) throw new VocabularyError("INVALID_ARGUMENT", "NUL in entity name");
    return { kind: "name", name };
  }
  if (raw.startsWith("index:")) {
    const body = raw.slice(6);
    if (!INDEX_DIGITS.test(body)) {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        `index: takes 1 to 9 decimal digits, got ${raw}`,
      );
    }
    return { kind: "index", index: Number(body) };
  }
  throw new VocabularyError(
    "INVALID_ARGUMENT",
    `entity reference must be id:<hex>, name:<name> or index:<i>, got ${raw}`,
  );
}

export function printEntityRef(r: ParsedEntityRef): string {
  switch (r.kind) {
    case "id":
      return `id:0x${r.id}`;
    case "name":
      return `name:${r.name}`;
    case "index":
      return `index:${r.index}`;
  }
}

export const ENTITY_REF_SCHEMA = z
  .string()
  .describe("id:<hex> | name:<name> | index:<i>")
  .superRefine((v, ctx) => {
    try {
      parseEntityRef(v);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    }
  });

/**
 * The `entity:<ref>` target of a W1 container action (spec 2.2). Kept apart from `parseTarget`
 * so the tools that take only `path:`/`open:` keep refusing it.
 */
export type EntityTarget = { kind: "entity"; ref: ParsedEntityRef };

export function parseEntityTarget(raw: string): EntityTarget {
  if (!raw.startsWith("entity:")) {
    throw new VocabularyError("INVALID_ARGUMENT", `target must be entity:<ref>, got ${raw}`);
  }
  return { kind: "entity", ref: parseEntityRef(raw.slice(7)) };
}

export function printEntityTarget(t: EntityTarget): string {
  return `entity:${printEntityRef(t.ref)}`;
}

// path grammar

export interface PathSegment {
  name: string;
  indices: number[];
}

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[\d+\])*)$/;

/** `components[2].MeshObject.Object` -> segments. Throws INVALID_ARGUMENT on any malformed part. */
export function parsePath(raw: string): PathSegment[] {
  if (raw === "") throw new VocabularyError("INVALID_ARGUMENT", "empty property path");
  return raw.split(".").map((part) => {
    const m = SEGMENT.exec(part);
    if (!m) throw new VocabularyError("INVALID_ARGUMENT", `bad path segment '${part}' in ${raw}`);
    const indices = [...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
    if (indices.some((i) => !Number.isSafeInteger(i))) {
      throw new VocabularyError("INVALID_ARGUMENT", `index out of range in ${raw}`);
    }
    return { name: m[1], indices };
  });
}

export function printPath(segments: PathSegment[]): string {
  return segments.map((s) => s.name + s.indices.map((i) => `[${i}]`).join("")).join(".");
}

// paging, confirm

export const LIMIT_DEFAULT = 100;
export const LIMIT_MAX = 200;
export const FIELDS_DEFAULT = "name,type,value";

export const PAGING_SHAPE = {
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(LIMIT_MAX).default(LIMIT_DEFAULT),
  fields: z.string().default(FIELDS_DEFAULT),
  mode: z.enum(["summary", "page"]).default("summary"),
};
export const PAGING_SCHEMA = z.object(PAGING_SHAPE).strict();
export type Paging = z.infer<typeof PAGING_SCHEMA>;

/**
 * W1 cursor (phase5-w1-spec.md section 1): `<start>:<count>`, both non-negative decimal integers;
 * `count` is the list's total at the first read. A later read whose total differs is STALE_CURSOR.
 */
export interface Cursor {
  start: number;
  count: number;
}

const CURSOR = /^(\d{1,9}):(\d{1,9})$/;

/** Parses `<start>:<count>`. Throws INVALID_ARGUMENT when malformed or when start > count. */
export function parseCursor(raw: string): Cursor {
  const m = CURSOR.exec(raw);
  if (!m) {
    throw new VocabularyError("INVALID_ARGUMENT", `cursor must be <start>:<count>, got ${raw}`);
  }
  const cursor = { start: Number(m[1]), count: Number(m[2]) };
  if (cursor.start > cursor.count) {
    throw new VocabularyError("INVALID_ARGUMENT", `cursor start is past its count: ${raw}`);
  }
  return cursor;
}

export function printCursor(c: Cursor): string {
  return `${c.start}:${c.count}`;
}

/** True when the list's current total no longer equals the total the cursor was issued for. */
export function isStaleCursor(c: Cursor, total: number): boolean {
  return c.count !== total;
}

/** Throws STALE_CURSOR when the total changed since the cursor was issued. */
export function checkCursor(c: Cursor, total: number): void {
  if (isStaleCursor(c, total)) {
    throw new VocabularyError(
      "STALE_CURSOR",
      `cursor ${printCursor(c)} was issued for ${c.count} items, the list now has ${total}`,
    );
  }
}

/** The cursor of the page after `[start, start + limit)` of `total` items, undefined at the end. */
export function nextCursor(start: number, limit: number, total: number): string | undefined {
  const next = start + limit;
  return next < total ? printCursor({ start: next, count: total }) : undefined;
}

export const CONFIRM_SCHEMA = z.literal(true);

// response shape

export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

export interface ActionOk {
  ok: true;
  action: string;
  target: string;
  changed: Change[] | null;
  readback: unknown;
  next?: string;
  warnings: string[];
}

export interface ActionError {
  ok: false;
  action: string;
  target: string;
  code: ErrorCode;
  message: string;
  next: string;
  warnings: string[];
}

export type ActionResponse = ActionOk | ActionError;

/** Builds an error response; `next` defaults to the code's table entry. */
export function errorResponse(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next: string = ERROR_CODES[code],
): ActionError {
  return { ok: false, action, target, code, message, next, warnings: [] };
}
