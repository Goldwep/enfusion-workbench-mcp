/**
 * `wb_terrain_edit`: terrain writes on the open world through EMCP_WB_TerrainEdit (wave W7,
 * phase5-w7-spec.md sections 2.1, 3.2 and 4; DEC-075).
 *
 *   tileRead     the handler's: packed height rows of one tile, paged by rows (at most 64).
 *   tileWrite    height runs "tx ty row col|v v ..." (at most 64), one undo point. Dry run unless
 *                confirm. A confirmed write takes the route of policy `terrain_write_route`.
 *   brush        served here: sculpt, flatten, smooth or noise computed by
 *                src/formats/terrain-brush.ts from the tiles under the radius, then written as runs.
 *   flatter, maps, exportMasks   the handler's, each a dry run unless confirm.
 *   backup       served here: copies the world's terrain file set to the artifacts folder with a
 *                sha256 manifest, and records the backup for this server session.
 *   restore      served here: checks the manifest, then copies the backup back (world closed).
 *
 * Gates and switches (each refusal names its switch):
 *
 *   - `terrain_write_route` (data/census/policy.json): "handler" (U18 passed), "exportTerrain"
 *     (K1: TS writes the ExportTerrain binary and sends Bohemia's ExportTerrain itself; wb_bi is
 *     not used, DEC-075) or "asc" (K2: TS writes an .asc for the owner's import, OI-W7-4). Absent
 *     means a confirmed tileWrite or brush answers GATED (P-W7-01).
 *   - TILE_ORDER (src/formats/terrain-brush.ts): unset until P-W7-01 records the tile array order;
 *     `brush` (and the asc route, which lays tiles out on the map) answers GATED until then.
 *   - `terrain_edit.any_world` (policy.json) with the handler's ANY_WORLD_OPEN: both false, so a
 *     confirmed tileWrite, brush, flatter, maps or restore on a world that is not under the
 *     project's top-level `_throwaway/` folder answers GATED (DEC-075 OD-5, OI-W7-6).
 *   - NO_BACKUP: a confirmed tileWrite, brush, flatter or maps refuses until `backup` ran for that
 *     world in this server session (spec 1.2 rule 8). exportMasks writes into a new folder only
 *     and is not behind it (DEC-075 OD-5 groups it with backup).
 *
 * The backup file set is P-W7-03's question. Until it is answered the set is the world's `.ent`,
 * its sibling files `<name>.<ext>` (and their `.meta`), and every file under the sibling folders
 * `<name>` and `<name>_<word>`: wider than needed, never narrower. Nothing here names a sandbox or a
 * project (DEC-058). Not registered here: src/server.ts registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CENSUS_ROOT } from "../census/ledger-io.js";
import { defaultArtifactsDir } from "../census/source-index.js";
import type { Config } from "../config.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  parseCursor,
  parseEntityRef,
  printEntityRef,
  type ActionOk,
} from "../manifest/vocabulary.js";
import { resolveAddonRoot, worldPrefixRefusal } from "../utils/addon-root.js";
import { renameOver, tempSibling, writeFileAtomic } from "../utils/atomic-write.js";
import { isPathInsideRoot } from "../utils/path-guard.js";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import {
  BRUSH_DEFAULTS,
  BRUSH_MODES,
  BrushError,
  FALLOFFS,
  MAX_PATCHES_PER_CALL,
  TILE_ORDER,
  TILE_ORDER_PROBE,
  applyBrush,
  applyPatches,
  brushRect,
  checkBrush,
  checkPatchesFit,
  chunkPatches,
  diffToPatches,
  estimatePatches,
  formatHeight,
  formatPatches,
  globalOf,
  layoutOfSamples,
  parsePatches,
  parseTileKey,
  parseTileRows,
  samplesX,
  samplesZ,
  tileKey,
  tileLayouts,
  tilesOfRect,
  windowFromTiles,
  type BrushMode,
  type BrushParams,
  type Estimate,
  type Falloff,
  type TerrainGrid,
  type TileLayout,
  type TilePatch,
  type TileOrder,
} from "../formats/terrain-brush.js";
import { ascFromGlobal, formatAsc, writeExportTerrain } from "../formats/terrain-export.js";
import { flatInputShape } from "./wb-entity.js";

export const HANDLER = "EMCP_WB_TerrainEdit";
export const TERRAIN_HANDLER = "EMCP_WB_Terrain";
export const WORLD_HANDLER = "EMCP_WB_World";
/** Bohemia's NET handler of branch K1 (scripts/WorkbenchGameCommon/EnfusionBlenderTools). */
export const EXPORT_TERRAIN_HANDLER = "ExportTerrain";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const TERRAIN_EDIT_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const TERRAIN_EDIT_REQUEST_SCHEMA = buildRequestSchema(TERRAIN_EDIT_CONTRACT);
export const WB_TERRAIN_EDIT_DESCRIPTION = checkedDescription(TERRAIN_EDIT_CONTRACT);

export const WORLD_TARGET = "open:WorldEditor";
export const THROWAWAY_FOLDER = "_throwaway/";
export const READ_TIMEOUT_MS = 30_000;
export const WRITE_TIMEOUT_MS = 120_000;
/** tileRead rows per page (the handler's PAGE_MAX). */
export const TILE_PAGE_MAX = 64;
/** tileWrite runs per call (the handler's MAX_PATCHES) and undo label length (MAX_LABEL). */
export const PATCHES_MAX = 64;
export const UNDO_LABEL_MAX = 64;
/** brush: samples in the window and tiles read, at most. */
export const BRUSH_MAX_SAMPLES = 1 << 20;
export const BRUSH_MAX_TILES = 64;
/** asc route: the whole terrain is read; at most this many tiles and samples. */
export const ASC_MAX_TILES = 256;
export const ASC_MAX_SAMPLES = 1 << 24;
/** backup: files in one set, at most. */
export const BACKUP_MAX_FILES = 20_000;
export const FILE_SET_PROBE = "P-W7-03";
export const MANIFEST_FILE = "manifest.json";

export const POLICY_ROUTE_KEY = "terrain_write_route";
export const POLICY_ANY_WORLD_KEY = "terrain_edit.any_world";
export const WRITE_ROUTES = ["handler", "exportTerrain", "asc"] as const;
export type WriteRoute = (typeof WRITE_ROUTES)[number];

export const ROUTE_SWITCH = `policy.json ${POLICY_ROUTE_KEY} ("handler", "exportTerrain" or "asc")`;
export const ANY_WORLD_SWITCH = `policy.json ${POLICY_ANY_WORLD_KEY} with EMCP_WB_TerrainEdit.ANY_WORLD_OPEN`;
export const ORDER_SWITCH = "TILE_ORDER in src/formats/terrain-brush.ts";

type Raw = Record<string, unknown>;

export interface TerrainEditError {
  ok: false;
  action: string;
  target: string;
  /** A vocabulary code or a kernel code (LOST, MODAL_OPEN, WEDGED). */
  code: string;
  message: string;
  next: string;
  warnings: string[];
  readback?: Record<string, unknown>;
}

export type TerrainEditResponse = ActionOk | TerrainEditError;

// ── Policy and session ──────────────────────────────────────────────────────

export interface TerrainPolicy {
  /** Undefined: the key is absent or not one of WRITE_ROUTES (a confirmed write answers GATED). */
  route?: WriteRoute;
  anyWorld: boolean;
  source: "policy.json" | "policy file unreadable";
}

/**
 * Reads `terrain_write_route` (top-level string) and `terrain_edit.any_world` (boolean) from
 * policy.json. A missing file or key gives no route and anyWorld false.
 */
export function loadTerrainPolicy(
  policyPath = join(DEFAULT_CENSUS_ROOT, "policy.json"),
): TerrainPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(policyPath, "utf-8"));
  } catch {
    return { anyWorld: false, source: "policy file unreadable" };
  }
  const obj = typeof raw === "object" && raw !== null ? (raw as Raw) : {};
  const route = obj[POLICY_ROUTE_KEY];
  const edit = obj.terrain_edit;
  const anyWorld = typeof edit === "object" && edit !== null && (edit as Raw).any_world === true;
  return {
    route: WRITE_ROUTES.includes(route as WriteRoute) ? (route as WriteRoute) : undefined,
    anyWorld,
    source: "policy.json",
  };
}

/** The per-session NO_BACKUP record: world (project-relative, folded) -> backupId. */
export class TerrainBackupRecord {
  private readonly worlds = new Map<string, string>();

  record(worldRel: string, backupId: string): void {
    this.worlds.set(fold(worldRel), backupId);
  }

  backupOf(worldRel: string): string | undefined {
    return this.worlds.get(fold(worldRel));
  }
}

export interface TerrainEditOptions {
  /** The addon folder the writes go in (registration resolves it from ENFUSION_PROJECT_PATH per
   *  call, src/utils/addon-root.ts). */
  projectPath?: string;
  /** Why no addon folder was resolved, when projectPath is unset. */
  projectRefusal?: string;
  /** Where backups and K1/K2 files go; default defaultArtifactsDir(). */
  artifactsDir?: string;
  /** The policy; read from policy.json on every call by default. */
  policy?: () => TerrainPolicy;
  /** The NO_BACKUP record; one per registered tool by default. */
  session?: TerrainBackupRecord;
  /** Overrides TILE_ORDER (tests, P-W7-16). */
  tileOrder?: TileOrder;
  /** Runs per tileWrite call (P-W7-04). */
  maxPatchesPerCall?: number;
  /** The clock of backup ids and file names. */
  now?: () => Date;
}

// ── Small helpers ───────────────────────────────────────────────────────────

function fold(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
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
): TerrainEditError {
  return { ok: false, action, target, code, message, next: next || nextFor(code), warnings: [] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly next?: string,
  ) {
    super(message);
  }
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseNumber(key: string, text: string): number {
  const t = text.trim();
  if (!NUMBER.test(t))
    throw new Refusal("INVALID_ARGUMENT", `${key} must be a number as text, got '${text}'`);
  return Number(t);
}

function numbersOf(text: string): string[] {
  return text
    .replace(/,/g, " ")
    .split(" ")
    .filter((p) => p !== "");
}

/** "x z" (or "x y z", y ignored): the brush centre in world metres. */
export function parseCentre(text: string): [number, number] {
  const parts = numbersOf(text);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((p) => !NUMBER.test(p))) {
    throw new Refusal("INVALID_ARGUMENT", `centre must be "x z" (or "x y z"), got '${text}'`);
  }
  const n = parts.map(Number);
  return parts.length === 2 ? [n[0], n[1]] : [n[0], n[2]];
}

function parseVector3(key: string, text: string): [number, number, number] {
  const parts = numbersOf(text);
  if (parts.length !== 3 || parts.some((p) => !NUMBER.test(p))) {
    throw new Refusal("INVALID_ARGUMENT", `${key} must be "x y z", got '${text}'`);
  }
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}Z`
  );
}

const LABEL = /^[A-Za-z0-9_-]{1,40}$/;
const BACKUP_ID = /^[0-9]{8}T[0-9]{9}Z(-[A-Za-z0-9_-]{1,40})?(-[0-9]{1,4})?$/;

// ── Request checks ──────────────────────────────────────────────────────────

/** A checked request: what is sent (or served here), or the refusal raised before anything is sent. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: TerrainEditError };

const MUTATING = new Set(
  TERRAIN_EDIT_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name),
);

/** The brush parameters of a checked brush request. */
export function brushParamsOf(req: Raw): BrushParams {
  const [centreX, centreZ] = parseCentre(str(req.centre));
  const opt = (key: string): number | undefined =>
    typeof req[key] === "string" && str(req[key]).trim() !== ""
      ? parseNumber(key, str(req[key]))
      : undefined;
  const p: BrushParams = {
    mode: str(req.mode) as BrushMode,
    centreX,
    centreZ,
    radius: parseNumber("radius", str(req.radius)),
    strength: opt("strength") ?? BRUSH_DEFAULTS.strength,
    falloff: (typeof req.falloff === "string" ? req.falloff : BRUSH_DEFAULTS.falloff) as Falloff,
    delta: opt("delta"),
    height: opt("height"),
    passes: typeof req.passes === "number" ? req.passes : undefined,
    scale: opt("scale"),
    seed: typeof req.seed === "number" ? req.seed : undefined,
  };
  return p;
}

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const parsed = TERRAIN_EDIT_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, WORLD_TARGET, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const mutating = MUTATING.has(action);
  const params: Raw = { ...req };
  let target = WORLD_TARGET;
  try {
    if (typeof req.terrainIndex === "number" && req.terrainIndex < 0) {
      throw new Refusal("INVALID_ARGUMENT", "terrainIndex must not be negative");
    }
    switch (action) {
      case "tileRead": {
        if ((req.tileX as number) < 0 || (req.tileY as number) < 0) {
          throw new Refusal("INVALID_ARGUMENT", "tileX and tileY must not be negative");
        }
        if (typeof req.limit === "number" && (req.limit < 1 || req.limit > TILE_PAGE_MAX)) {
          throw new Refusal("INVALID_ARGUMENT", `limit must be 1 to ${TILE_PAGE_MAX}`);
        }
        if (typeof req.cursor === "string") parseCursor(req.cursor);
        target = `tile:${req.tileX},${req.tileY}`;
        break;
      }
      case "tileWrite": {
        const patches = req.patches as string[];
        if (patches.length < 1 || patches.length > PATCHES_MAX) {
          throw new Refusal(
            "INVALID_ARGUMENT",
            `patches must hold 1 to ${PATCHES_MAX} runs, got ${patches.length}; split them over several calls`,
          );
        }
        const runs = parsePatches(patches);
        params.patches = formatPatches(runs);
        if (typeof req.undoLabel === "string" && req.undoLabel.length > UNDO_LABEL_MAX) {
          throw new Refusal(
            "INVALID_ARGUMENT",
            `undoLabel is at most ${UNDO_LABEL_MAX} characters`,
          );
        }
        break;
      }
      case "brush": {
        if (!BRUSH_MODES.includes(str(req.mode) as BrushMode)) {
          throw new Refusal("INVALID_ARGUMENT", `mode must be one of ${BRUSH_MODES.join(", ")}`);
        }
        if (typeof req.falloff === "string" && !FALLOFFS.includes(req.falloff as Falloff)) {
          throw new Refusal("INVALID_ARGUMENT", `falloff must be one of ${FALLOFFS.join(", ")}`);
        }
        checkBrush(brushParamsOf(req));
        break;
      }
      case "flatter": {
        const op = str(req.op);
        if (op !== "add" && op !== "remove") {
          throw new Refusal("INVALID_ARGUMENT", `op must be add or remove, got '${op}'`);
        }
        params.entity = printEntityRef(parseEntityRef(str(req.entity)));
        target = `entity:${params.entity}`;
        if (op === "add") {
          if (typeof req.mins !== "string" || typeof req.maxs !== "string") {
            throw new Refusal("INVALID_ARGUMENT", 'add needs mins and maxs as "x y z" (local)');
          }
          const lo = parseVector3("mins", req.mins);
          const hi = parseVector3("maxs", req.maxs);
          if (lo.some((v, i) => v > hi[i])) {
            throw new Refusal("INVALID_ARGUMENT", "mins must not exceed maxs on any axis");
          }
          for (const key of ["falloffStart", "falloff"]) {
            if (typeof req[key] === "string" && parseNumber(key, str(req[key])) < 0) {
              throw new Refusal("INVALID_ARGUMENT", `${key} must be 0 or more`);
            }
          }
        }
        break;
      }
      case "maps": {
        const kind = str(req.kind);
        if (kind !== "shore" && kind !== "flow") {
          throw new Refusal("INVALID_ARGUMENT", `kind must be shore or flow, got '${kind}'`);
        }
        break;
      }
      case "exportMasks": {
        const dir = checkRelativePath(str(req.directory));
        params.directory = dir;
        target = `path:${dir}`;
        break;
      }
      case "backup": {
        if (typeof req.label === "string" && !LABEL.test(req.label)) {
          throw new Refusal("INVALID_ARGUMENT", "label takes 1 to 40 letters, digits, '_' and '-'");
        }
        break;
      }
      case "restore": {
        if (!BACKUP_ID.test(str(req.backupId))) {
          throw new Refusal(
            "INVALID_ARGUMENT",
            `backupId must be one that backup answered, got '${str(req.backupId)}'`,
          );
        }
        target = `backup:${str(req.backupId)}`;
        break;
      }
    }
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: fail(action, target, e.code, e.message) };
    if (e instanceof VocabularyError || e instanceof BrushError) {
      const code = e instanceof VocabularyError ? e.code : "INVALID_ARGUMENT";
      return { ok: false, error: fail(action, target, code, e.message) };
    }
    throw e;
  }
  // Every terrain write is a dry run unless confirm is true: send the flag explicitly.
  if (mutating && TAKES_CONFIRM.has(action)) params.confirm = req.confirm === true;
  return { ok: true, action, target, mutating, params };
}

const TAKES_CONFIRM = new Set(
  TERRAIN_EDIT_CONTRACT.actions
    .filter((a) => a.params.some((p) => p.key === "confirm"))
    .map((a) => a.name),
);

// ── Calls ───────────────────────────────────────────────────────────────────

type Called = { ok: true; r: Raw } | { ok: false; error: TerrainEditError; kernel?: string };

/** One handler call; a WorkbenchError or a non-ok answer comes back as the error shape. */
async function callHandler(
  client: WorkbenchClient,
  fn: string,
  params: Raw,
  access: "read" | "mutate",
  action: string,
  target: string,
  extra: { timeout?: number; skipAutoLaunch?: boolean } = {},
): Promise<Called> {
  let r: Raw;
  try {
    r = await client.call<Raw>(fn, params, {
      access,
      timeout: extra.timeout ?? (access === "read" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
      ...(extra.skipAutoLaunch ? { skipAutoLaunch: true } : {}),
    });
  } catch (e) {
    if (e instanceof WorkbenchError) {
      const known = e.code === "LOST" || e.code === "MODAL_OPEN" || e.code === "WEDGED";
      const code = known ? e.code : "UNREACHABLE";
      let next = nextFor(code);
      if (e.code === "LOST" && access === "mutate") {
        next = `${ERROR_CODES.LOST} The call is never retried; read the terrain back (wb_terrain_edit tileRead) before anything else.`;
      }
      return { ok: false, error: fail(action, target, code, e.message, next), kernel: e.code };
    }
    throw e;
  }
  if (fn === EXPORT_TERRAIN_HANDLER) return { ok: true, r };
  if (str(r.status) !== "ok") {
    const code = str(r.code) || "HANDLER_ERROR";
    const message = str(r.message) || `${fn} answered ${str(r.status) || "no status"}`;
    const error = fail(action, target, code, message, str(r.next));
    const partial: Raw = {};
    for (const k of ["tiles", "samples", "minDelta", "maxDelta", "meanDelta", "undoName", "id"]) {
      if (r[k] !== undefined && r[k] !== "") partial[k] = r[k];
    }
    if (r.dryRun !== undefined) partial.dryRun = truthy(r.dryRun);
    if (Object.keys(partial).length) error.readback = partial;
    return { ok: false, error };
  }
  return { ok: true, r };
}

interface OpenWorld {
  /** As wb_world state answers it ($addon:path). */
  worldPath: string;
  /** Project-relative, forward slashes. */
  rel: string;
  abs: string;
  name: string;
  throwaway: boolean;
}

const FS_PREFIX = /^\$[A-Za-z0-9_]*:/;

/** The open world as a world file of the project, or a Refusal (NO_WORLD, NOT_IN_PROJECT, WRONG_MODE). */
function projectWorld(
  state: Raw,
  projectPath: string | undefined,
  projectRefusal?: string,
): OpenWorld {
  const worldPath = str(state.worldPath);
  if (!worldPath)
    throw new Refusal("NO_WORLD", "wb_world state answers no world path: no world is open");
  if (str(state.mode) === "play") {
    throw new Refusal(
      "WRONG_MODE",
      "the World Editor is in play mode",
      "stop play first (wb_world stop)",
    );
  }
  if (!projectPath) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      `terrain writes need the project path (ENFUSION_PROJECT_PATH)${projectRefusal ? `: ${projectRefusal}` : ""}; nothing was changed`,
    );
  }
  const foreign = worldPrefixRefusal(projectPath, worldPath);
  if (foreign) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      `the open world is not a world file of the project: ${foreign} (a game or dependency world is never written); nothing was changed`,
      "open a world of the project you have open",
    );
  }
  let rel: string;
  try {
    rel = checkRelativePath(worldPath.replace(FS_PREFIX, ""));
  } catch (e) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      `the open world ${worldPath} is not a project path: ${(e as Error).message}`,
    );
  }
  const abs = resolve(projectPath, rel);
  if (!isPathInsideRoot(abs, projectPath) || !existsSync(abs) || !lstatSync(abs).isFile()) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      `the open world ${worldPath} is not a world file of the project (a game or dependency world is never written); nothing was changed`,
      "open a world of the project you have open",
    );
  }
  const name = basename(rel).replace(/\.ent$/i, "");
  return { worldPath, rel, abs, name, throwaway: fold(rel).startsWith(THROWAWAY_FOLDER) };
}

async function openWorld(
  client: WorkbenchClient,
  action: string,
  target: string,
  options: Pick<TerrainEditOptions, "projectPath" | "projectRefusal">,
): Promise<{ ok: true; world: OpenWorld } | { ok: false; error: TerrainEditError }> {
  const st = await callHandler(client, WORLD_HANDLER, { action: "state" }, "read", action, target);
  if (!st.ok) return st;
  try {
    return {
      ok: true,
      world: projectWorld(st.r, options.projectPath, options.projectRefusal),
    };
  } catch (e) {
    if (e instanceof Refusal)
      return { ok: false, error: fail(action, target, e.code, e.message, e.next) };
    throw e;
  }
}

function worldGateRefusal(action: string, target: string, rel: string): TerrainEditError {
  return fail(
    action,
    target,
    "GATED",
    `${rel} is not under the project's ${THROWAWAY_FOLDER} folder: terrain writes on other worlds wait for the owner (DEC-075 OD-5, OI-W7-6); nothing was sent`,
    `Switch: ${ANY_WORLD_SWITCH}. Until then write on a world under ${THROWAWAY_FOLDER}.`,
  );
}

/**
 * The TS guard of a confirmed terrain write: the open world is a world of the project, the world
 * gate of DEC-075 OD-5, and NO_BACKUP. Answers the open world.
 */
async function confirmGuard(
  client: WorkbenchClient,
  action: string,
  target: string,
  options: TerrainEditOptions,
  policy: TerrainPolicy,
  session: TerrainBackupRecord,
): Promise<{ ok: true; world: OpenWorld } | { ok: false; error: TerrainEditError }> {
  const w = await openWorld(client, action, target, options);
  if (!w.ok) return w;
  if (!w.world.throwaway && !policy.anyWorld) {
    return { ok: false, error: worldGateRefusal(action, target, w.world.rel) };
  }
  if (session.backupOf(w.world.rel) === undefined) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "NO_BACKUP",
        `no backup of ${w.world.rel} was taken in this server session; nothing was sent`,
        "Run wb_terrain_edit backup (it copies the terrain files with a sha256 manifest), then call again.",
      ),
    };
  }
  return w;
}

function routeGated(action: string, target: string): TerrainEditError {
  return fail(
    action,
    target,
    "GATED",
    "confirmed terrain writes wait for probe P-W7-01 (U18): no write route is set; nothing was sent",
    `Switch: ${ROUTE_SWITCH}, set from U18's outcome. A dry run (no confirm) answers the estimate.`,
  );
}

function orderGated(action: string, target: string, what: string): TerrainEditError {
  return fail(
    action,
    target,
    "GATED",
    `${what} waits for probe ${TILE_ORDER_PROBE} to record the tile array order (DEC-075 OD-3); nothing was sent`,
    `Switch: ${ORDER_SWITCH}, set from ${TILE_ORDER_PROBE}'s corner markers.`,
  );
}

// ── Grid and tiles ──────────────────────────────────────────────────────────

/** A terrain grid with the layout its resolution allows (confirmed by every tile read). */
export type LaidGrid = TerrainGrid & { layout: TileLayout };

/**
 * The grid of one terrain from wb_terrain info. The resolution allows at most one side: res = tiles *
 * side ("disjoint") or res = tiles * (side - 1) + 1 ("sharedEdge"; vanilla EmptyArland, 2049 in 16);
 * both formulas meet only at one tile per axis ("single"). Every tileRead then confirms that side
 * from the handler's sample count (readTile), so no brush result is used on an unconfirmed side.
 */
async function readGrid(
  client: WorkbenchClient,
  terrainIndex: number,
  action: string,
  target: string,
): Promise<{ ok: true; grid: LaidGrid } | { ok: false; error: TerrainEditError }> {
  const got = await callHandler(
    client,
    TERRAIN_HANDLER,
    { action: "info", terrainIndex },
    "read",
    action,
    target,
  );
  if (!got.ok) return got;
  const r = got.r;
  const tilesX = num(r.tilesX);
  const tilesY = num(r.tilesY);
  const resX = num(r.resolutionX);
  const resY = num(r.resolutionY);
  const unitScale = num(r.unitScale);
  const origin = numbersOf(str(r.boundsMin)).map(Number);
  const c = tileLayouts(resX, resY, tilesX, tilesY);
  const side = c.shared || c.disjoint;
  const layout: TileLayout =
    c.shared && c.disjoint ? "single" : c.shared ? "sharedEdge" : "disjoint";
  if (
    !(side >= 2) ||
    !(unitScale > 0) ||
    origin.length !== 3 ||
    origin.some((v) => !Number.isFinite(v))
  ) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "UNPROVEN",
        `wb_terrain info answered ${resX}x${resY} samples in ${tilesX}x${tilesY} tiles, unit scale ${r.unitScale}, origin '${str(r.boundsMin)}': neither res = tiles * side nor res = tiles * (side - 1) + 1 gives square tiles; nothing was sent`,
        "Read the terrain with wb_terrain info.",
      ),
    };
  }
  return {
    ok: true,
    grid: {
      tilesX,
      tilesY,
      side,
      unitScale,
      originX: origin[0],
      originZ: origin[2],
      sharedEdges: layout === "sharedEdge",
      layout,
    },
  };
}

/** One whole tile through tileRead, page by page. */
async function readTile(
  client: WorkbenchClient,
  terrainIndex: number,
  tileX: number,
  tileY: number,
  side: number,
  layout: TileLayout,
  action: string,
  target: string,
): Promise<{ ok: true; heights: Float64Array } | { ok: false; error: TerrainEditError }> {
  const heights = new Float64Array(side * side);
  const seen = new Set<number>();
  let cursor: string | undefined;
  for (let page = 0; page <= side; page++) {
    const params: Raw = { action: "tileRead", tileX, tileY, terrainIndex, limit: TILE_PAGE_MAX };
    if (cursor) params.cursor = cursor;
    const got = await callHandler(client, HANDLER, params, "read", action, target);
    if (!got.ok) return got;
    const answered = num(got.r.side);
    // The handler confirms side and layout from the tile's sample count; both must be info's.
    const answeredLayout = str(got.r.layout);
    const confirmed = layoutOfSamples(
      layout === "disjoint"
        ? { disjoint: side, shared: 0 }
        : layout === "sharedEdge"
          ? { disjoint: 0, shared: side }
          : { disjoint: side, shared: side },
      answered * answered,
    );
    if (answered !== side || !confirmed || (answeredLayout && answeredLayout !== layout)) {
      return {
        ok: false,
        error: fail(
          action,
          target,
          "HANDLER_ERROR",
          `tileRead of ${tileX},${tileY} answered side ${got.r.side} (layout '${answeredLayout}'), ${side} (${layout}) expected from wb_terrain info; nothing was written`,
        ),
      };
    }
    let rows: Map<number, number[]>;
    try {
      rows = parseTileRows(strs(got.r.rows), side);
    } catch (e) {
      if (e instanceof BrushError) {
        return {
          ok: false,
          error: fail(
            action,
            target,
            "HANDLER_ERROR",
            `tileRead of ${tileX},${tileY}: ${e.message}`,
          ),
        };
      }
      throw e;
    }
    for (const [row, values] of rows) {
      if (row >= side) continue;
      heights.set(values, row * side);
      seen.add(row);
    }
    cursor = str(got.r.nextCursor) || undefined;
    if (!cursor) break;
  }
  if (seen.size !== side) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "HANDLER_ERROR",
        `tileRead of ${tileX},${tileY} answered ${seen.size} of ${side} rows; nothing was written`,
      ),
    };
  }
  return { ok: true, heights };
}

async function readTiles(
  client: WorkbenchClient,
  terrainIndex: number,
  keys: Array<[number, number]>,
  side: number,
  layout: TileLayout,
  action: string,
  target: string,
): Promise<
  { ok: true; tiles: Map<string, Float64Array> } | { ok: false; error: TerrainEditError }
> {
  const tiles = new Map<string, Float64Array>();
  for (const [tx, ty] of keys) {
    const t = await readTile(client, terrainIndex, tx, ty, side, layout, action, target);
    if (!t.ok) return t;
    tiles.set(tileKey(tx, ty), t.heights);
  }
  return { ok: true, tiles };
}

function distinctTiles(patches: readonly TilePatch[]): Array<[number, number]> {
  const keys = new Set(patches.map((p) => tileKey(p.tileX, p.tileY)));
  return [...keys].map(parseTileKey).sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]));
}

function estimateReadback(e: Estimate, unitScale: number | undefined): Raw {
  const out: Raw = {
    tiles: e.tiles,
    samples: e.samples,
    minDelta: formatHeight(e.minDelta),
    maxDelta: formatHeight(e.maxDelta),
    meanDelta: formatHeight(e.meanDelta),
  };
  if (unitScale !== undefined && unitScale > 0) out.areaM2 = e.samples * unitScale * unitScale;
  return out;
}

function areaText(samples: number, unitScale: number | undefined): string {
  return unitScale !== undefined && unitScale > 0
    ? `, about ${formatHeight(samples * unitScale * unitScale, 1)} m2 of terrain`
    : "";
}

// ── K1 and K2 writers ───────────────────────────────────────────────────────

function exportDir(options: TerrainEditOptions): string {
  return join(options.artifactsDir ?? defaultArtifactsDir(), "terrain-export");
}

/** K1: the binary of the touched tiles, then Bohemia's ExportTerrain on the open world. */
async function writeK1(
  client: WorkbenchClient,
  action: string,
  target: string,
  world: OpenWorld,
  side: number,
  after: Map<string, Float64Array>,
  options: TerrainEditOptions,
): Promise<{ ok: true; readback: Raw } | { ok: false; error: TerrainEditError }> {
  const area = side * side;
  const keys = [...after.keys()]
    .map(parseTileKey)
    .sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]));
  const records = keys.map(([tileX, tileY]) => ({
    tileX,
    tileY,
    heights: after.get(tileKey(tileX, tileY))!,
  }));
  const dir = exportDir(options);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${world.name}-${stamp((options.now ?? (() => new Date()))())}.bin`);
  writeFileAtomic(file, writeExportTerrain(records, area));
  // worldPath is exactly what wb_world state answered, so ExportTerrain never switches worlds.
  const got = await callHandler(
    client,
    EXPORT_TERRAIN_HANDLER,
    { area, worldPath: world.worldPath, path: file, count: records.length },
    "mutate",
    action,
    target,
  );
  if (!got.ok) {
    got.error.readback = { ...(got.error.readback ?? {}), binary: file };
    return got;
  }
  if (!truthy(got.r.Output)) {
    const error = fail(
      action,
      target,
      "ENGINE_FALSE",
      `ExportTerrain did not answer Output true for ${records.length} tile(s)`,
      "Read the terrain back (wb_terrain_edit tileRead); restore from the backup if it changed.",
    );
    error.readback = { binary: file };
    return { ok: false, error };
  }
  return {
    ok: true,
    readback: { route: "exportTerrain", binary: file, records: records.length, dryRun: false },
  };
}

/** K2: the whole terrain with the edits as an .asc for the owner's import; answers GATED. */
async function writeK2(
  client: WorkbenchClient,
  action: string,
  target: string,
  world: OpenWorld,
  grid: LaidGrid,
  terrainIndex: number,
  edits: readonly TilePatch[],
  order: TileOrder,
  options: TerrainEditOptions,
): Promise<TerrainEditError> {
  const countX = samplesX(grid);
  const countZ = samplesZ(grid);
  if (grid.tilesX * grid.tilesY > ASC_MAX_TILES || countX * countZ > ASC_MAX_SAMPLES) {
    return fail(
      action,
      target,
      "INVALID_ARGUMENT",
      `the asc route reads the whole terrain; ${grid.tilesX}x${grid.tilesY} tiles of ${grid.side} is over the ${ASC_MAX_TILES}-tile limit; nothing was written`,
    );
  }
  const keys: Array<[number, number]> = [];
  for (let ty = 0; ty < grid.tilesY; ty++)
    for (let tx = 0; tx < grid.tilesX; tx++) keys.push([tx, ty]);
  const read = await readTiles(client, terrainIndex, keys, grid.side, grid.layout, action, target);
  if (!read.ok) return read.error;
  const changed = applyPatches(read.tiles, grid.side, edits);
  const global = new Float64Array(countX * countZ);
  for (const [tx, ty] of keys) {
    const key = tileKey(tx, ty);
    const t = changed.get(key) ?? read.tiles.get(key)!;
    for (let i = 0; i < t.length; i++) {
      const [gx, gz] = globalOf(grid, order, tx, ty, i);
      global[gz * countX + gx] = t[i];
    }
  }
  const asc = formatAsc(
    ascFromGlobal(global, countX, countZ, grid.originX, grid.originZ, grid.unitScale),
  );
  const dir = exportDir(options);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${world.name}-${stamp((options.now ?? (() => new Date()))())}.asc`);
  writeFileAtomic(file, asc);
  const error = fail(
    action,
    target,
    "GATED",
    "no script route writes terrain on this build (U18 branch K2); the heights were written to an .asc and nothing was sent to Workbench",
    `Import ${file} through Terrain Tool, Manage, on the open world (owner item OI-W7-4); restore from the backup to go back.`,
  );
  error.readback = { route: "asc", asc: file, ncols: countX, nrows: countZ };
  return error;
}

// ── tileWrite and brush ─────────────────────────────────────────────────────

async function unitScaleOf(
  client: WorkbenchClient,
  terrainIndex: number,
  action: string,
  target: string,
  warnings: string[],
): Promise<number | undefined> {
  const got = await callHandler(
    client,
    TERRAIN_HANDLER,
    { action: "info", terrainIndex },
    "read",
    action,
    target,
  );
  if (!got.ok) {
    warnings.push(`wb_terrain info failed (${got.error.code}): the area in m2 is left out`);
    return undefined;
  }
  const u = num(got.r.unitScale);
  return u > 0 ? u : undefined;
}

function handlerEstimate(r: Raw): Raw {
  return {
    tiles: num(r.tiles) || 0,
    samples: num(r.samples) || 0,
    minDelta: str(r.minDelta),
    maxDelta: str(r.maxDelta),
    meanDelta: str(r.meanDelta),
    layout: str(r.layout) || null,
  };
}

async function runTileWrite(
  client: WorkbenchClient,
  target: string,
  params: Raw,
  options: TerrainEditOptions,
  session: TerrainBackupRecord,
): Promise<TerrainEditResponse> {
  const action = "tileWrite";
  const policy = (options.policy ?? (() => loadTerrainPolicy()))();
  const terrainIndex = typeof params.terrainIndex === "number" ? params.terrainIndex : 0;
  const warnings: string[] = [];

  if (params.confirm !== true) {
    const got = await callHandler(client, HANDLER, params, "mutate", action, target);
    if (!got.ok) return got.error;
    const unitScale = await unitScaleOf(client, terrainIndex, action, target, warnings);
    const est = handlerEstimate(got.r);
    if (unitScale !== undefined) est.areaM2 = (est.samples as number) * unitScale * unitScale;
    if (!policy.route)
      warnings.push(
        `no write route is set (${ROUTE_SWITCH}): a confirmed write answers GATED until P-W7-01`,
      );
    return {
      ok: true,
      action,
      target,
      changed: null,
      readback: { ...est, dryRun: true, route: policy.route ?? null },
      next: "Resend with confirm: true to write (after wb_terrain_edit backup).",
      warnings: [
        `dry run: ${str(got.r.message) || "nothing was written"}${areaText(est.samples as number, unitScale)}`,
        ...warnings,
      ],
    };
  }

  if (!policy.route) return routeGated(action, target);
  const guard = await confirmGuard(client, action, target, options, policy, session);
  if (!guard.ok) return guard.error;
  const world = guard.world;

  if (policy.route === "handler") {
    const got = await callHandler(client, HANDLER, params, "mutate", action, target);
    if (!got.ok) return got.error;
    const est = handlerEstimate(got.r);
    const undoName = str(got.r.undoName);
    const dry = truthy(got.r.dryRun);
    return {
      ok: true,
      action,
      target,
      changed: dry
        ? null
        : [{ path: `terrain:${terrainIndex}`, before: null, after: `${est.samples} samples` }],
      readback: { ...est, dryRun: dry, undoName, route: "handler", world: world.rel },
      next: undoName ? "Undo with wb_undo_redo, or restore from the backup." : undefined,
      warnings,
    };
  }

  // K1 and K2 need the whole tiles: read them, apply the runs here.
  const runs = parsePatches(params.patches as string[]);
  if (policy.route === "exportTerrain" && terrainIndex !== 0) {
    return fail(
      action,
      target,
      "INVALID_ARGUMENT",
      "the exportTerrain route writes terrain index 0 only (ExportTerrain.c); nothing was sent",
    );
  }
  const g = await readGrid(client, terrainIndex, action, target);
  if (!g.ok) return g.error;
  try {
    checkPatchesFit(runs, g.grid);
  } catch (e) {
    if (e instanceof BrushError)
      return fail(action, target, "INVALID_ARGUMENT", `${e.message}; nothing was sent`);
    throw e;
  }
  if (policy.route === "asc") {
    const order = options.tileOrder ?? TILE_ORDER;
    if (!order)
      return orderGated(action, target, "the asc route (it lays the tiles out on the map)");
    return writeK2(client, action, target, world, g.grid, terrainIndex, runs, order, options);
  }
  const read = await readTiles(
    client,
    terrainIndex,
    distinctTiles(runs),
    g.grid.side,
    g.grid.layout,
    action,
    target,
  );
  if (!read.ok) return read.error;
  const est = estimatePatches(read.tiles, g.grid.side, runs);
  const after = applyPatches(read.tiles, g.grid.side, runs);
  const k1 = await writeK1(client, action, target, world, g.grid.side, after, options);
  if (!k1.ok) return k1.error;
  return {
    ok: true,
    action,
    target,
    changed: [{ path: `terrain:${terrainIndex}`, before: null, after: `${est.samples} samples` }],
    readback: {
      ...estimateReadback(est, g.grid.unitScale),
      layout: g.grid.layout,
      ...k1.readback,
      world: world.rel,
    },
    next: "ExportTerrain opens one unnamed terrain action per tile; restore from the backup to go back.",
    warnings,
  };
}

async function runBrush(
  client: WorkbenchClient,
  target: string,
  params: Raw,
  options: TerrainEditOptions,
  session: TerrainBackupRecord,
): Promise<TerrainEditResponse> {
  const action = "brush";
  const order = options.tileOrder ?? TILE_ORDER;
  if (!order) return orderGated(action, target, "brush (world metres to tile samples)");
  const policy = (options.policy ?? (() => loadTerrainPolicy()))();
  const confirm = params.confirm === true;
  const terrainIndex = typeof params.terrainIndex === "number" ? params.terrainIndex : 0;
  const bp = brushParamsOf(params);
  const warnings: string[] = [];

  let world: OpenWorld | undefined;
  if (confirm) {
    if (!policy.route) return routeGated(action, target);
    if (policy.route === "exportTerrain" && terrainIndex !== 0) {
      return fail(
        action,
        target,
        "INVALID_ARGUMENT",
        "the exportTerrain route writes terrain index 0 only (ExportTerrain.c); nothing was sent",
      );
    }
    const guard = await confirmGuard(client, action, target, options, policy, session);
    if (!guard.ok) return guard.error;
    world = guard.world;
  }

  const g = await readGrid(client, terrainIndex, action, target);
  if (!g.ok) return g.error;
  const grid = g.grid;
  let rect: { x0: number; z0: number; w: number; h: number };
  try {
    rect = brushRect(grid, bp.centreX, bp.centreZ, bp.radius, 1);
  } catch (e) {
    if (e instanceof BrushError)
      return fail(action, target, "INVALID_ARGUMENT", `${e.message}; nothing was sent`);
    throw e;
  }
  if (rect.w * rect.h > BRUSH_MAX_SAMPLES) {
    return fail(
      action,
      target,
      "INVALID_ARGUMENT",
      `the brush covers ${rect.w * rect.h} samples, at most ${BRUSH_MAX_SAMPLES}; use a smaller radius`,
    );
  }
  const keys = tilesOfRect(grid, order, rect);
  if (keys.length > BRUSH_MAX_TILES) {
    return fail(
      action,
      target,
      "INVALID_ARGUMENT",
      `the brush touches ${keys.length} tiles, at most ${BRUSH_MAX_TILES}; use a smaller radius`,
    );
  }
  const read = await readTiles(client, terrainIndex, keys, grid.side, grid.layout, action, target);
  if (!read.ok) return read.error;
  const win = windowFromTiles(grid, order, rect, read.tiles);
  const after = applyBrush(grid, win, bp);
  const patches = diffToPatches(grid, order, rect, win.data, after);
  const est = estimatePatches(read.tiles, grid.side, patches);
  const max = options.maxPatchesPerCall ?? MAX_PATCHES_PER_CALL;
  const calls = chunkPatches(patches, max);
  const base: Raw = {
    mode: bp.mode,
    ...estimateReadback(est, grid.unitScale),
    layout: grid.layout,
    patches: patches.length,
    calls: calls.length,
  };

  if (patches.length === 0) {
    return {
      ok: true,
      action,
      target,
      changed: null,
      readback: { ...base, dryRun: !confirm },
      warnings: ["the brush changes no sample at 4-decimal precision; nothing to write"],
    };
  }
  if (!confirm) {
    if (!policy.route)
      warnings.push(
        `no write route is set (${ROUTE_SWITCH}): a confirmed brush answers GATED until P-W7-01`,
      );
    return {
      ok: true,
      action,
      target,
      changed: null,
      readback: { ...base, dryRun: true, route: policy.route ?? null },
      next: "Resend with confirm: true to write (after wb_terrain_edit backup).",
      warnings: [
        `dry run: ${est.tiles} tiles, ${est.samples} samples changed${areaText(est.samples, grid.unitScale)}; nothing was written`,
        ...warnings,
      ],
    };
  }

  const w = world!;
  if (policy.route === "asc") {
    return writeK2(client, action, target, w, grid, terrainIndex, patches, order, options);
  }
  if (policy.route === "exportTerrain") {
    const k1 = await writeK1(
      client,
      action,
      target,
      w,
      grid.side,
      applyPatches(read.tiles, grid.side, patches),
      options,
    );
    if (!k1.ok) return k1.error;
    return {
      ok: true,
      action,
      target,
      changed: [{ path: `terrain:${terrainIndex}`, before: null, after: `${est.samples} samples` }],
      readback: { ...base, ...k1.readback, world: w.rel },
      next: "ExportTerrain opens one unnamed terrain action per tile; restore from the backup to go back.",
      warnings,
    };
  }

  // handler route: one tileWrite per chunk, each its own undo point.
  const undoNames: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    const p: Raw = {
      action: "tileWrite",
      patches: formatPatches(calls[i]),
      undoLabel: `brush ${bp.mode}${calls.length > 1 ? ` ${i + 1}/${calls.length}` : ""}`,
      terrainIndex,
      confirm: true,
    };
    const got = await callHandler(client, HANDLER, p, "mutate", action, target);
    if (!got.ok) {
      const error = got.error;
      error.message = `call ${i + 1} of ${calls.length}: ${error.message}; ${i} call(s) were written before it`;
      error.readback = { ...(error.readback ?? {}), written: i, undoNames };
      if (i > 0)
        error.next = `${error.next} Undo the written calls with wb_undo_redo, or restore from the backup.`;
      return error;
    }
    undoNames.push(str(got.r.undoName));
  }
  return {
    ok: true,
    action,
    target,
    changed: [{ path: `terrain:${terrainIndex}`, before: null, after: `${est.samples} samples` }],
    readback: { ...base, dryRun: false, route: "handler", undoNames, world: w.rel },
    next: `Undo with wb_undo_redo (${undoNames.length} undo point(s)), or restore from the backup.`,
    warnings,
  };
}

// ── flatter, maps, exportMasks, tileRead ────────────────────────────────────

async function runHandlerWrite(
  client: WorkbenchClient,
  action: string,
  target: string,
  params: Raw,
  options: TerrainEditOptions,
  session: TerrainBackupRecord,
): Promise<TerrainEditResponse> {
  const confirm = params.confirm === true;
  let world: OpenWorld | undefined;
  if (confirm && action !== "exportMasks") {
    const policy = (options.policy ?? (() => loadTerrainPolicy()))();
    const guard = await confirmGuard(client, action, target, options, policy, session);
    if (!guard.ok) return guard.error;
    world = guard.world;
  }
  const got = await callHandler(client, HANDLER, params, "mutate", action, target);
  if (!got.ok) return got.error;
  const r = got.r;
  const dry = truthy(r.dryRun);
  const readback: Raw = { dryRun: dry };
  if (action === "flatter") {
    readback.id = str(r.id);
    readback.undoName = str(r.undoName);
  } else if (action === "maps") {
    readback.built = truthy(r.built);
  } else {
    readback.exported = truthy(r.exported);
  }
  if (world) readback.world = world.rel;
  const undoName = str(r.undoName);
  return {
    ok: true,
    action,
    target,
    changed: dry
      ? null
      : [{ path: target, before: null, after: action === "flatter" ? str(params.op) : action }],
    readback,
    next: dry
      ? "Resend with confirm: true to write (after wb_terrain_edit backup)."
      : undoName
        ? "Undo with wb_undo_redo, or restore from the backup."
        : action === "maps"
          ? "The map files were overwritten (no undo); restore from the backup to go back."
          : undefined,
    warnings: [str(r.message)].filter((m) => m !== ""),
  };
}

async function runTileRead(
  client: WorkbenchClient,
  target: string,
  params: Raw,
): Promise<TerrainEditResponse> {
  const action = "tileRead";
  const got = await callHandler(client, HANDLER, params, "read", action, target);
  if (!got.ok) return got.error;
  const r = got.r;
  const total = num(r.total) || 0;
  if (typeof params.cursor === "string") {
    try {
      checkCursor(parseCursor(params.cursor), total);
    } catch (e) {
      if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
      throw e;
    }
  }
  const nextCursor = str(r.nextCursor);
  return {
    ok: true,
    action,
    target,
    changed: null,
    readback: {
      side: num(r.side) || 0,
      layout: str(r.layout) || null,
      total,
      rows: strs(r.rows),
      nextCursor: nextCursor || null,
    },
    next: nextCursor ? `More: resend with cursor "${nextCursor}".` : undefined,
    warnings: [],
  };
}

// ── backup and restore ──────────────────────────────────────────────────────

export interface FileEntry {
  rel: string;
  abs: string;
}

function walkFiles(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

/**
 * The terrain file set of a world (provisional until P-W7-03): the `.ent`, sibling files
 * `<name>.<ext>` and `<name>.<ext>.meta`, and every file under the sibling folders `<name>` and
 * `<name>_<word>`. Sorted by path; symbolic links are left out.
 */
export function terrainFileSet(projectRoot: string, worldRel: string): FileEntry[] {
  const abs = resolve(projectRoot, worldRel);
  const dir = dirname(abs);
  const name = basename(abs).replace(/\.ent$/i, "");
  const fileRe = new RegExp(`^${escapeRe(name)}\\.[^.]+(\\.meta)?$`, "i");
  const dirRe = new RegExp(`^${escapeRe(name)}(_[^_]+)?$`, "i");
  const entries = readdirSync(dir, { withFileTypes: true });
  // A folder `<name>_<word>` that is another world's own folder (`<name>_<word>.ent` beside it) is
  // that world's, not this one's.
  const otherWorlds = new Set(
    entries
      .filter((e) => e.isFile() && /\.ent$/i.test(e.name))
      .map((e) => e.name.slice(0, -4).toLowerCase())
      .filter((w) => w !== name.toLowerCase()),
  );
  const files: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isFile() && fileRe.test(e.name)) files.push(p);
    else if (e.isDirectory() && dirRe.test(e.name) && !otherWorlds.has(e.name.toLowerCase())) {
      walkFiles(p, files);
    }
  }
  return files
    .filter((f) => isPathInsideRoot(f, projectRoot))
    .map((f) => ({ rel: toRel(projectRoot, f), abs: f }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface ManifestFile {
  rel: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  version: 1;
  tool: "wb_terrain_edit";
  backupId: string;
  label: string | null;
  created: string;
  worldPath: string;
  worldRel: string;
  projectRoot: string;
  fileSet: string;
  files: ManifestFile[];
}

function backupRoot(options: TerrainEditOptions): string {
  return join(options.artifactsDir ?? defaultArtifactsDir(), "terrain-backup");
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_") || "world";
}

/** Copies files into a new backup folder with its manifest; answers the folder and the manifest. */
function writeBackup(
  options: TerrainEditOptions,
  projectRoot: string,
  world: { worldPath: string; rel: string; name: string },
  files: FileEntry[],
  label: string | undefined,
): { dir: string; manifest: BackupManifest } {
  const now = (options.now ?? (() => new Date()))();
  const worldDir = join(backupRoot(options), safeName(world.name));
  let backupId = label ? `${stamp(now)}-${label}` : stamp(now);
  for (let n = 2; existsSync(join(worldDir, backupId)); n++) {
    backupId = `${label ? `${stamp(now)}-${label}` : stamp(now)}-${n}`;
  }
  const dir = join(worldDir, backupId);
  const entries: ManifestFile[] = [];
  for (const f of files) {
    const bytes = readFileSync(f.abs);
    const dest = join(dir, "files", ...f.rel.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    // A fresh backup folder: an exclusive create, never a replace.
    writeFileSync(dest, bytes, { flag: "wx" });
    const copy = readFileSync(dest);
    const hash = sha256(bytes);
    if (sha256(copy) !== hash)
      throw new Refusal(
        "SAVE_FAILED",
        `the copy of ${f.rel} does not match its source`,
        "Check the disk under the artifacts folder and run backup again.",
      );
    entries.push({ rel: f.rel, size: bytes.length, sha256: hash });
  }
  const manifest: BackupManifest = {
    version: 1,
    tool: "wb_terrain_edit",
    backupId,
    label: label ?? null,
    created: now.toISOString(),
    worldPath: world.worldPath,
    worldRel: world.rel,
    projectRoot: resolve(projectRoot),
    fileSet: `provisional until ${FILE_SET_PROBE}: the .ent, <name>.<ext> siblings, and the <name> and <name>_<word> folders`,
    files: entries,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { dir, manifest };
}

async function runBackup(
  client: WorkbenchClient,
  params: Raw,
  options: TerrainEditOptions,
  session: TerrainBackupRecord,
): Promise<TerrainEditResponse> {
  const action = "backup";
  const w = await openWorld(client, action, WORLD_TARGET, options);
  if (!w.ok) return w.error;
  const world = w.world;
  const target = `path:${world.rel}`;
  const root = options.projectPath!;
  const files = terrainFileSet(root, world.rel);
  if (files.length === 0)
    return fail(action, target, "PATH_NOT_FOUND", `no terrain files of ${world.rel} on disk`);
  if (files.length > BACKUP_MAX_FILES) {
    return fail(
      action,
      target,
      "INVALID_ARGUMENT",
      `the file set of ${world.rel} holds ${files.length} files, at most ${BACKUP_MAX_FILES}`,
    );
  }
  let made: { dir: string; manifest: BackupManifest };
  try {
    made = writeBackup(
      options,
      root,
      world,
      files,
      typeof params.label === "string" ? params.label : undefined,
    );
  } catch (e) {
    if (e instanceof Refusal) return fail(action, target, e.code, e.message, e.next);
    throw e;
  }
  session.record(world.rel, made.manifest.backupId);
  const bytes = made.manifest.files.reduce((s, f) => s + f.size, 0);
  return {
    ok: true,
    action,
    target,
    changed: null,
    readback: {
      backupId: made.manifest.backupId,
      files: made.manifest.files.length,
      bytes,
      folder: made.dir,
      manifest: join(made.dir, MANIFEST_FILE),
      world: world.rel,
    },
    next: `Confirmed terrain writes on ${world.rel} are open for this server session; restore with backupId "${made.manifest.backupId}".`,
    warnings: [
      `the file set is provisional until ${FILE_SET_PROBE}: it is wider than the terrain files, never narrower`,
      "backup copies the files on disk: save the world first if it holds unsaved edits",
    ],
  };
}

/** Finds a backup folder by id under any world folder. */
function findBackup(options: TerrainEditOptions, backupId: string): string | undefined {
  const root = backupRoot(options);
  if (!existsSync(root)) return undefined;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name, backupId);
    if (existsSync(join(dir, MANIFEST_FILE))) return dir;
  }
  return undefined;
}

function readManifest(dir: string): BackupManifest {
  let m: BackupManifest;
  try {
    m = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8")) as BackupManifest;
  } catch (e) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `the manifest of ${basename(dir)} does not parse: ${(e as Error).message}`,
    );
  }
  if (
    m?.version !== 1 ||
    typeof m.worldRel !== "string" ||
    typeof m.projectRoot !== "string" ||
    !Array.isArray(m.files)
  ) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `the manifest of ${basename(dir)} is not a wb_terrain_edit manifest`,
    );
  }
  return m;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32"
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}

async function runRestore(
  client: WorkbenchClient,
  target: string,
  params: Raw,
  options: TerrainEditOptions,
): Promise<TerrainEditResponse> {
  const action = "restore";
  const backupId = str(params.backupId);
  const confirm = params.confirm === true;
  const root = options.projectPath;
  if (!root)
    return fail(
      action,
      target,
      "NOT_IN_PROJECT",
      `restore needs the project path (ENFUSION_PROJECT_PATH)${options.projectRefusal ? `: ${options.projectRefusal}` : ""}; nothing was changed`,
    );
  const dir = findBackup(options, backupId);
  if (!dir)
    return fail(
      action,
      target,
      "PATH_NOT_FOUND",
      `no backup "${backupId}" under ${backupRoot(options)}`,
    );

  let manifest: BackupManifest;
  try {
    manifest = readManifest(dir);
  } catch (e) {
    if (e instanceof Refusal) return fail(action, target, e.code, e.message);
    throw e;
  }
  if (!samePath(manifest.projectRoot, root)) {
    return fail(
      action,
      target,
      "NOT_IN_PROJECT",
      `backup "${backupId}" was taken in ${manifest.projectRoot}, not in the open project; nothing was changed`,
    );
  }

  // The backup copies must match the manifest before anything is written.
  const plan: Array<{
    rel: string;
    abs: string;
    copy: string;
    state: "same" | "changed" | "missing";
  }> = [];
  const mismatched: string[] = [];
  for (const f of manifest.files) {
    let rel: string;
    try {
      rel = checkRelativePath(String(f.rel));
    } catch {
      return fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `the manifest names a path that is not project-relative: '${f.rel}'; nothing was changed`,
      );
    }
    const abs = resolve(root, rel);
    if (!isPathInsideRoot(abs, root)) {
      return fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `the manifest path ${rel} resolves outside the project; nothing was changed`,
      );
    }
    const copy = join(dir, "files", ...rel.split("/"));
    if (!existsSync(copy) || sha256(readFileSync(copy)) !== f.sha256) {
      mismatched.push(rel);
      continue;
    }
    const state = !existsSync(abs)
      ? "missing"
      : sha256(readFileSync(abs)) === f.sha256
        ? "same"
        : "changed";
    plan.push({ rel, abs, copy, state });
  }
  if (mismatched.length) {
    const error = fail(
      action,
      target,
      "INVALID_ARGUMENT",
      `the backup does not match its manifest (${mismatched.length} file(s), first ${mismatched[0]}); nothing was changed`,
      "Do not restore from this backup; take another, or restore the files by hand.",
    );
    error.readback = { mismatched: mismatched.slice(0, 50) };
    return error;
  }

  const warnings: string[] = [];
  const throwaway = fold(manifest.worldRel).startsWith(THROWAWAY_FOLDER);
  const policy = (options.policy ?? (() => loadTerrainPolicy()))();

  // Which world is open: Workbench not running counts as closed.
  let worldOpen = false;
  let stateError: TerrainEditError | undefined;
  const st = await callHandler(client, WORLD_HANDLER, { action: "state" }, "read", action, target, {
    skipAutoLaunch: true,
  });
  if (st.ok) {
    const open = str(st.r.worldPath).replace(FS_PREFIX, "");
    worldOpen = open !== "" && fold(open) === fold(manifest.worldRel);
  } else if (st.kernel === "CONNECTION_REFUSED") {
    warnings.push("Workbench is not running: the world counts as closed");
  } else {
    stateError = st.error;
  }

  const current = existsSync(dirname(resolve(root, manifest.worldRel)))
    ? terrainFileSet(root, manifest.worldRel)
    : [];
  const listed = new Set(plan.map((p) => fold(p.rel)));
  const extra = current.filter((f) => !listed.has(fold(f.rel))).map((f) => f.rel);
  if (extra.length) {
    warnings.push(
      `${extra.length} file(s) of the set are not in the backup and are left as they are: ${extra.slice(0, 5).join(", ")}`,
    );
  }
  const toWrite = plan.filter((p) => p.state !== "same");
  const summary = {
    backupId,
    world: manifest.worldRel,
    files: toWrite.length,
    unchanged: plan.length - toWrite.length,
    changedFiles: toWrite.filter((p) => p.state === "changed").map((p) => p.rel),
    missingFiles: toWrite.filter((p) => p.state === "missing").map((p) => p.rel),
    extra,
  };

  if (!confirm) {
    if (worldOpen)
      warnings.push(
        `${manifest.worldRel} is open in the World Editor: close it before a confirmed restore`,
      );
    if (stateError)
      warnings.push(
        `the world state could not be read (${stateError.code}): a confirmed restore refuses until it can`,
      );
    if (!throwaway && !policy.anyWorld) {
      warnings.push(
        `a confirmed restore outside ${THROWAWAY_FOLDER} answers GATED (${ANY_WORLD_SWITCH})`,
      );
    }
    return {
      ok: true,
      action,
      target,
      changed: null,
      readback: { ...summary, dryRun: true },
      next: toWrite.length
        ? "Resend with confirm: true (world closed) to copy the backup back."
        : "The files already match the backup.",
      warnings: ["dry run: nothing was written", ...warnings],
    };
  }
  if (!throwaway && !policy.anyWorld) return worldGateRefusal(action, target, manifest.worldRel);
  if (stateError) return stateError;
  if (worldOpen) {
    return fail(
      action,
      target,
      "WORLD_OPEN",
      `${manifest.worldRel} is open in the World Editor; nothing was changed`,
    );
  }

  // A safety copy of what is about to be overwritten, then the copy back, then a check.
  let safety: string | undefined;
  const overwritten = toWrite
    .filter((p) => p.state === "changed")
    .map((p) => ({ rel: p.rel, abs: p.abs }));
  if (overwritten.length) {
    try {
      const made = writeBackup(
        options,
        root,
        {
          worldPath: manifest.worldPath,
          rel: manifest.worldRel,
          name: basename(manifest.worldRel).replace(/\.ent$/i, ""),
        },
        overwritten,
        "prerestore",
      );
      safety = made.manifest.backupId;
    } catch (e) {
      if (e instanceof Refusal) return fail(action, target, e.code, e.message, e.next);
      throw e;
    }
  }
  // Each file is copied to a temporary sibling and renamed over the target (review round 1,
  // W7-TE-01), and a file that cannot be written (locked, read-only) is recorded, not thrown, so
  // the answer still names what was restored and the safety backup.
  const failed: string[] = [];
  const reasons: string[] = [];
  const restored: string[] = [];
  for (const p of toWrite) {
    const tmp = tempSibling(p.abs);
    try {
      mkdirSync(dirname(p.abs), { recursive: true });
      copyFileSync(p.copy, tmp);
      renameOver(tmp, p.abs, true);
    } catch (e) {
      rmSync(tmp, { force: true });
      failed.push(p.rel);
      reasons.push(`${p.rel}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
      continue;
    }
    const want = manifest.files.find((f) => fold(f.rel) === fold(p.rel))!.sha256;
    if (sha256(readFileSync(p.abs)) !== want) failed.push(p.rel);
    else restored.push(p.rel);
  }
  if (failed.length) {
    const error = fail(
      action,
      target,
      "SAVE_FAILED",
      `${failed.length} file(s) were not restored or do not match the manifest after the copy: ${failed.slice(0, 5).join(", ")}${reasons.length ? ` (${reasons.slice(0, 3).join("; ")})` : ""}`,
      safety
        ? `The overwritten files are in backup "${safety}".`
        : "Check the disk and restore again.",
    );
    error.readback = { ...summary, failed, restored, safetyBackup: safety ?? null };
    return error;
  }
  return {
    ok: true,
    action,
    target,
    changed: toWrite.map((p) => ({ path: p.rel, before: p.state, after: "restored" })),
    readback: { ...summary, dryRun: false, verified: true, safetyBackup: safety ?? null },
    next: `Reopen ${manifest.worldRel} in the World Editor (wb_module setResource) to load the restored terrain.`,
    warnings,
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

const DEFAULT_SESSION = new TerrainBackupRecord();

/** Runs one wb_terrain_edit request end to end; never throws for a Workbench-side failure. */
export async function runTerrainEdit(
  client: WorkbenchClient,
  input: unknown,
  options: TerrainEditOptions = {},
): Promise<TerrainEditResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, params } = prepared;
  const session = options.session ?? DEFAULT_SESSION;
  try {
    switch (action) {
      case "tileRead":
        return await runTileRead(client, target, params);
      case "tileWrite":
        return await runTileWrite(client, target, params, options, session);
      case "brush":
        return await runBrush(client, target, params, options, session);
      case "backup":
        return await runBackup(client, params, options, session);
      case "restore":
        return await runRestore(client, target, params, options);
      default:
        return await runHandlerWrite(client, action, target, params, options, session);
    }
  } catch (e) {
    if (e instanceof Refusal) return fail(action, target, e.code, e.message, e.next);
    if (e instanceof BrushError) return fail(action, target, "INVALID_ARGUMENT", e.message);
    throw e;
  }
}

export function registerWbTerrainEdit(
  server: McpServer,
  client: WorkbenchClient,
  config?: Pick<Config, "projectPath" | "defaultMod">,
  options: TerrainEditOptions = {},
): void {
  const session = options.session ?? new TerrainBackupRecord();
  server.registerTool(
    "wb_terrain_edit",
    {
      description: WB_TERRAIN_EDIT_DESCRIPTION,
      inputSchema: flatInputShape(TERRAIN_EDIT_CONTRACT),
      annotations: {
        title: "Terrain edits",
        readOnlyHint: false,
        // Confirmed writes change terrain and overwrite map files (maps has no undo).
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      // Per call: wb_launch sets defaultMod at run time.
      const addon = resolveAddonRoot(config ?? {});
      const res = await runTerrainEdit(client, input, {
        ...(addon.ok ? { projectPath: addon.root } : { projectRefusal: addon.message }),
        ...options,
        session,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
