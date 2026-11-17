/**
 * `wb_world_tools`: dialog-free ports of vanilla World Editor plugins and tools through
 * EMCP_WB_WorldTools (wave W6, phase5-w6-spec.md section 2.2; DEC-069 OD-1, OD-6, OD-10).
 *
 *   exportObjects    read, paged: entities as Object Import rows (also answered as CSV text)
 *   floaters         read: entities whose bottom sits off the terrain
 *   stats            read, paged: counts per prefab, per layer and on a grid
 *   goToCoords       TS only: parses a SCR_CoordsTool text (enfusion link, x,y,z;p,y,r or map
 *                    digits), reads the terrain height (wb_terrain heights) for map digits, then
 *                    moves the camera (wb_view setCamera)
 *   importObjects    create entities from rows; `path` names a project CSV that this tool reads
 *                    (the handler reads no file) and sends in calls of at most 200 rows
 *   snapToTerrain    snap and orient entities to the terrain
 *   resetFlags       Flags back to the prefab's (allWorld must be explicit, OD-6)
 *   replaceEntities  swap entities for prefabs; `planReplacements` is the vanilla weights and
 *                    percentages as a caller-side helper (OD-10)
 *
 * World edits are one undo point per handler call (no confirm, DEC-061 OD-3) and need the project
 * guard Workbench-side (NOT_IN_PROJECT). Every request is checked against the contract's per-action
 * schema and the shared vocabulary before anything is sent. Floats travel as text. Nothing here
 * names a sandbox or a project. Not registered here: src/server.ts registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "../config.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  LIMIT_MAX,
  VocabularyError,
  checkRelativePath,
  parseCursor,
  parseEntityRef,
  printEntityRef,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import {
  formatCsv,
  fromHandlerRow,
  invalidLines,
  parse as parseCsv,
  toHandlerRow,
  type ObjectRow,
} from "../formats/object-import-csv.js";
import { resolveAddonRoot } from "../utils/addon-root.js";
import { isPathInsideRoot } from "../utils/path-guard.js";
import { codeOfClientError } from "./wb-module.js";
import { runTerrain, type HeightRow } from "./wb-terrain.js";
import { runView } from "./wb-view.js";

export const HANDLER = "EMCP_WB_WorldTools";
export const TOOL_NAME = "wb_world_tools";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const WORLD_TOOLS_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const WORLD_TOOLS_REQUEST_SCHEMA = buildRequestSchema(WORLD_TOOLS_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbWorldToolsDescription(): string {
  return checkedDescription(WORLD_TOOLS_CONTRACT);
}

/** Every action the contract names. */
export const ACTIONS: readonly string[] = WORLD_TOOLS_CONTRACT.actions.map((a) => a.name);
/** Served in TypeScript; the handler answers that it does not serve them. */
export const TS_ACTIONS: readonly string[] = ["goToCoords"];
const MUTATING = new Set(WORLD_TOOLS_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

/** Entity references, import rows and replace pairs one handler call takes at most. */
export const MAX_REFS = 200;
export const MAX_ROWS = 200;
export const MAX_PAIRS = 200;
/** Rows one CSV import reads at most (50 handler calls, one undo point each). */
export const MAX_FILE_ROWS = 10_000;
/** A CSV larger than this is refused before it is read. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const RADIUS_MAX = 5000;
export const GRID_MAX = 64;

/** EntityFlags names the handler accepts (spec 2.2). */
export const FLAG_NAMES: readonly string[] = [
  "VISIBLE",
  "TRACEABLE",
  "NO_LINK",
  "FEATURE",
  "SET_RENDERED",
  "STREAMABLE",
  "ACTIVE",
  "STATIC",
  "USER1",
  "USER2",
  "USER3",
  "USER4",
  "USER5",
  "NO_TREE",
  "RELATIVE_Y",
  "EDITOR_ONLY",
  "DISABLED",
  "PROXY",
  "UPDATE_LINK",
];
export const CATEGORIES: readonly string[] = ["rocks", "trees", "bushes", "buildings", "any"];

const READ_TIMEOUT_MS = 60_000;
/** A 200-row import or a whole-world resetFlags can take a while Workbench-side. */
const WRITE_TIMEOUT_MS = 120_000;
const TARGET = "open:WorldEditor";

type Raw = Record<string, unknown>;

export type WorldToolsError = ActionError & { readback?: unknown };
export type WorldToolsResponse = ActionOk | WorldToolsError;

/** The client surface this tool needs (a fake in tests). */
export type WorldToolsClient = Pick<WorkbenchClient, "call">;

export interface WorldToolsOptions {
  /** The project root a CSV `path` resolves under (Config.projectPath). */
  projectPath?: string;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): WorldToolsError {
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
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** A float as the text the handler parses (no exponent for ordinary values, no "-0"). */
export function floatText(n: number): string {
  const r = Number(n.toFixed(6));
  return Object.is(r, -0) ? "0" : String(r);
}

// ── Request checks ────────────────────────────────────────────────────────────

const PREFAB = /^\{[0-9A-Fa-f]{16}\}[^;=]*$/;

/** Each reference checked and printed in the canonical W1 form. Throws VocabularyError. */
export function checkRefs(refs: string[]): string[] {
  if (refs.length > MAX_REFS) {
    throw new VocabularyError("INVALID_ARGUMENT", `at most ${MAX_REFS} entity references per call`);
  }
  return refs.map((r) => printEntityRef(parseEntityRef(r.trim())));
}

/** `ref=prefab` pairs, split at the last "=" as the handler splits them. Throws VocabularyError. */
export function checkPairs(pairs: string[]): string[] {
  if (pairs.length === 0) throw new VocabularyError("INVALID_ARGUMENT", "pairs is empty");
  if (pairs.length > MAX_PAIRS) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `pairs holds ${pairs.length}, at most ${MAX_PAIRS} per call; send them in calls of ${MAX_PAIRS}`,
    );
  }
  return pairs.map((p, i) => {
    const eq = p.lastIndexOf("=");
    if (eq <= 0 || eq >= p.length - 1) {
      throw new VocabularyError("INVALID_ARGUMENT", `pairs[${i}] must be ref=prefab, got '${p}'`);
    }
    const prefab = p.slice(eq + 1).trim();
    if (!PREFAB.test(prefab)) {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        `pairs[${i}]: the prefab must be {GUID}path, got '${prefab}'`,
      );
    }
    let ref: string;
    try {
      ref = printEntityRef(parseEntityRef(p.slice(0, eq).trim()));
    } catch (e) {
      if (e instanceof VocabularyError) {
        throw new VocabularyError(e.code, `pairs[${i}]: ${e.message}`);
      }
      throw e;
    }
    return `${ref}=${prefab}`;
  });
}

/** Import rows checked TS-side; the first bad row refuses the call. Throws VocabularyError. */
export function checkRows(rows: string[]): string[] {
  if (rows.length === 0) throw new VocabularyError("INVALID_ARGUMENT", "rows is empty");
  if (rows.length > MAX_ROWS) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `rows holds ${rows.length}, at most ${MAX_ROWS} per call; send them in calls of ${MAX_ROWS} or pass path`,
    );
  }
  return rows.map((text, i) => {
    const r = fromHandlerRow(text);
    if ("error" in r) throw new VocabularyError("INVALID_ARGUMENT", `rows[${i}]: ${r.error}`);
    return toHandlerRow(r.row);
  });
}

function checkLimit(p: Raw): string | undefined {
  if (p.limit !== undefined && ((p.limit as number) < 1 || (p.limit as number) > LIMIT_MAX)) {
    return `limit must be 1 to ${LIMIT_MAX}`;
  }
  return undefined;
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: WorldToolsError };

function refuse(action: string, code: ErrorCode, message: string): Prepared {
  return { ok: false, error: fail(action, TARGET, code, message) };
}

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  if (!ACTIONS.includes(action)) {
    return refuse(
      action,
      "INVALID_ARGUMENT",
      `unknown action '${action}'; one of ${ACTIONS.join(", ")}`,
    );
  }
  const parsed = WORLD_TOOLS_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return refuse(action, "INVALID_ARGUMENT", issues.join("; "));
  }
  const req = parsed.data as Raw;
  const params: Raw = { ...req };
  try {
    const lim = checkLimit(req);
    if (lim) return refuse(action, "INVALID_ARGUMENT", lim);
    if (typeof req.cursor === "string" && req.cursor !== "") parseCursor(req.cursor);
    if (Array.isArray(req.entities)) params.entities = checkRefs(req.entities as string[]);
    switch (action) {
      case "exportObjects":
        if ((params.entities as string[] | undefined)?.length && str(req.layer).trim() !== "") {
          return refuse(action, "INVALID_ARGUMENT", "give entities or layer, not both");
        }
        break;
      case "floaters": {
        const radius = req.radius as number | undefined;
        if (radius !== undefined && (radius <= 0 || radius > RADIUS_MAX)) {
          return refuse(
            action,
            "INVALID_ARGUMENT",
            `radius must be above 0 and at most ${RADIUS_MAX}`,
          );
        }
        const min = (req.minOffset as number | undefined) ?? 0.05;
        const max = (req.maxOffset as number | undefined) ?? 100;
        if (min >= max)
          return refuse(action, "INVALID_ARGUMENT", "minOffset must be below maxOffset");
        for (const k of ["radius", "minOffset", "maxOffset"] as const) {
          if (typeof req[k] === "number") params[k] = floatText(req[k] as number);
        }
        break;
      }
      case "stats": {
        const g = req.gridSize as number | undefined;
        if (g !== undefined && (g < 0 || g > GRID_MAX)) {
          return refuse(action, "INVALID_ARGUMENT", `gridSize must be 0 to ${GRID_MAX}`);
        }
        break;
      }
      case "goToCoords":
        parseCoordsText(str(req.text));
        break;
      case "importObjects": {
        const hasRows = Array.isArray(req.rows);
        const path = str(req.path).trim();
        if (hasRows && path !== "") {
          return refuse(action, "INVALID_ARGUMENT", "give rows or path, not both");
        }
        if (!hasRows && path === "") {
          return refuse(
            action,
            "INVALID_ARGUMENT",
            "importObjects needs rows or a project CSV path",
          );
        }
        if (hasRows) params.rows = checkRows(req.rows as string[]);
        else params.path = checkCsvPath(path);
        break;
      }
      case "resetFlags": {
        if (req.allWorld === true && (params.entities as string[] | undefined)?.length) {
          return refuse(action, "INVALID_ARGUMENT", "give entities or allWorld, not both");
        }
        if (Array.isArray(req.flags)) {
          params.flags = (req.flags as string[]).map((f, i) => {
            const up = f.trim().toUpperCase();
            if (!FLAG_NAMES.includes(up)) {
              throw new VocabularyError(
                "INVALID_ARGUMENT",
                `flags[${i}] '${f}' is not an EntityFlags name (${FLAG_NAMES.join(", ")})`,
              );
            }
            return up;
          });
        }
        if (Array.isArray(req.categories)) {
          params.categories = (req.categories as string[]).map((c, i) => {
            const low = c.trim().toLowerCase();
            if (!CATEGORIES.includes(low)) {
              throw new VocabularyError(
                "INVALID_ARGUMENT",
                `categories[${i}] '${c}' is not ${CATEGORIES.join(", ")}`,
              );
            }
            return low;
          });
          if (req.allWorld === true && (params.categories as string[]).includes("any")) {
            return refuse(
              action,
              "INVALID_ARGUMENT",
              "categories any needs entities or a selection, not allWorld",
            );
          }
        }
        break;
      }
      case "replaceEntities":
        params.pairs = checkPairs(req.pairs as string[]);
        break;
    }
  } catch (e) {
    if (e instanceof VocabularyError) return refuse(action, e.code, e.message);
    throw e;
  }
  return { ok: true, action, target: TARGET, mutating: MUTATING.has(action), params };
}

/** A CSV path: project-relative, `.csv`. Throws VocabularyError. */
export function checkCsvPath(raw: string): string {
  const rel = checkRelativePath(raw);
  if (!rel.toLowerCase().endsWith(".csv")) {
    throw new VocabularyError("INVALID_ARGUMENT", `path must name a .csv file, got '${raw}'`);
  }
  return rel;
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a WorldToolsError, else null. */
function handlerFailure(action: string, target: string, r: Raw): WorldToolsError | null {
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
    const failed = strs(r.failed);
    const missing = strs(r.missing);
    const undoName = str(r.undoName);
    if (failed.length > 0 || missing.length > 0 || undoName !== "") {
      e.readback = { failed: splitIndexed(failed), missing, undoName: undoName || null };
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: WorldToolsClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: WorldToolsError }> {
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
      f.next =
        "The call was lost and is never retried; read the world back (wb_entity list) and check wb_undo_redo before any retry.";
    }
    return { error: f };
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/** "head;reason" lines (index;reason or ref;reason), split at the first ";". */
export function splitIndexed(lines: string[]): Array<{ at: string; reason: string }> {
  return lines.map((l) => {
    const i = l.indexOf(";");
    return i < 0 ? { at: l, reason: "" } : { at: l.slice(0, i), reason: l.slice(i + 1) };
  });
}

/** "label;count" lines, split at the last ";". */
export function splitCounts(lines: string[]): Array<{ label: string; count: number }> {
  return lines.map((l) => {
    const i = l.lastIndexOf(";");
    return i < 0
      ? { label: l, count: 0 }
      : { label: l.slice(0, i), count: Number(l.slice(i + 1)) || 0 };
  });
}

export interface FloaterRow {
  id: string;
  gap: number | null;
  reason: string;
}

/** floaters rows "id;gap;reason". */
export function parseFloaterRows(lines: string[]): FloaterRow[] {
  return lines.map((l) => {
    const [id = "", gap = "", ...rest] = l.split(";");
    return { id, gap: num(gap), reason: rest.join(";") };
  });
}

/** stats grid lines of space-separated counts, north first. */
export function parseGrid(lines: string[]): number[][] {
  return lines.map((l) =>
    l
      .trim()
      .split(/\s+/)
      .filter((t) => t !== "")
      .map((t) => Number(t) || 0),
  );
}

// ── Shaping ───────────────────────────────────────────────────────────────────

/**
 * The notes an ok handler answer carries only in its message (review round 1, W6-01): a false
 * scale write of importObjects and resetFlags' RELATIVE_Y rows that kept their coords.
 */
export function handlerNotes(action: string, message: string): string[] {
  const out: string[] = [];
  if (action === "importObjects") {
    const m = /SetVariableValue scale returned false for (\d+)/.exec(message);
    if (m) out.push(`${m[1]} entit(ies) kept at scale 1: SetVariableValue scale returned false`);
  }
  if (action === "resetFlags") {
    const m = /(\d+) RELATIVE_Y changes kept coords \(no terrain under them\)/.exec(message);
    if (m) out.push(`${m[1]} RELATIVE_Y change(s) kept their coords: no terrain under them`);
  }
  return out;
}

function shapeOk(action: string, target: string, params: Raw, r: Raw): ActionOk {
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  const undoName = str(r.undoName) || null;
  const missing = strs(r.missing);
  if (missing.length > 0) warnings.push(`${missing.length} reference(s) named no entity (missing)`);
  switch (action) {
    case "exportObjects": {
      const rows = strs(r.rows);
      const parsedRows: ObjectRow[] = [];
      rows.forEach((row, i) => {
        const p = fromHandlerRow(row);
        if ("row" in p) parsedRows.push(p.row);
        else warnings.push(`rows[${i}] is not an import row: ${p.error}`);
      });
      const cursor = str(r.nextCursor);
      const first = typeof params.cursor === "string" && params.cursor !== "";
      readback = {
        total: num(r.total) ?? rows.length,
        rows,
        csv: formatCsv(parsedRows, { header: !first }),
        nextCursor: cursor || null,
        missing,
      };
      next = cursor
        ? `wb_world_tools exportObjects with cursor "${cursor}" for the next page`
        : "wb_world_tools importObjects takes these rows back";
      break;
    }
    case "floaters": {
      const hits = parseFloaterRows(strs(r.rows));
      readback = {
        scanned: num(r.scanned) ?? 0,
        total: num(r.total) ?? hits.length,
        hits,
        missing,
      };
      if (hits.length > 0)
        next =
          "wb_view select with the hit ids selects them; wb_world_tools snapToTerrain moves them";
      break;
    }
    case "stats": {
      const cursor = str(r.nextCursor);
      const grid = strs(r.grid);
      readback = {
        scanned: num(r.scanned) ?? 0,
        total: num(r.total) ?? 0,
        prefabs: splitCounts(strs(r.rows)).map((c) => ({ prefab: c.label, count: c.count })),
        layers: splitCounts(strs(r.layers)).map((c) => ({ layer: c.label, count: c.count })),
        grid: parseGrid(grid),
        cellSize: grid.length > 0 ? num(r.cellSize) : null,
        nextCursor: cursor || null,
      };
      if (cursor) next = `wb_world_tools stats with cursor "${cursor}" for the next page`;
      break;
    }
    case "importObjects": {
      const ids = strs(r.ids);
      const failed = splitIndexed(strs(r.failed));
      readback = { created: num(r.created) ?? ids.length, ids, failed, undoName };
      changed = ids.map((id) => ({ path: id, before: null, after: "created" }));
      if (failed.length > 0) warnings.push(`${failed.length} row(s) failed (see failed)`);
      warnings.push(...handlerNotes(action, str(r.message)));
      break;
    }
    case "snapToTerrain": {
      const moved = num(r.moved) ?? 0;
      const failed = splitIndexed(strs(r.failed));
      readback = { moved, missing, failed, undoName };
      changed = [{ path: "entities.transform", before: null, after: `${moved} snapped` }];
      if (failed.length > 0) warnings.push(`${failed.length} entit(ies) not moved (see failed)`);
      break;
    }
    case "resetFlags": {
      const n = num(r.changed) ?? 0;
      const scanned = num(r.scanned) ?? 0;
      // walked: every entity the source gave; scanned: those with a prefab passing the categories
      // filter (W6 run 1: a prop-only world walks 2 and scans 0 under the default categories).
      const walked = num(r.total) ?? null;
      readback = {
        walked,
        scanned,
        changed: n,
        cleared: num(r.cleared) ?? 0,
        missing,
        undoName,
      };
      changed = n > 0 ? [{ path: "entities.Flags", before: null, after: `${n} reset` }] : [];
      warnings.push(...handlerNotes(action, str(r.message)));
      if (walked !== null && walked > 0 && scanned === 0)
        warnings.push(
          `${walked} entit(ies) walked, none passed the filter: only prefab entities whose top-most ancestor is a categories base (rocks, trees, bushes, buildings) are scanned unless categories any`,
        );
      break;
    }
    default: {
      // replaceEntities
      const ids = strs(r.ids);
      const failed = splitIndexed(strs(r.failed));
      readback = { replaced: num(r.replaced) ?? ids.length, ids, missing, failed, undoName };
      changed = ids.map((id) => ({ path: id, before: null, after: "replacement" }));
      if (failed.length > 0) warnings.push(`${failed.length} pair(s) failed (see failed)`);
    }
  }
  if (MUTATING.has(action) && undoName) {
    next = `wb_undo_redo undo reverts the call ("${undoName}")`;
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── importObjects from a CSV ──────────────────────────────────────────────────

/** Reads a project CSV into rows with their line numbers. Throws VocabularyError. */
export function readImportCsv(
  rel: string,
  projectPath: string | undefined,
): { file: string; rows: Array<{ line: number; row: string }>; header: boolean } {
  if (!projectPath) {
    throw new VocabularyError(
      "NOT_IN_PROJECT",
      "path needs a project path (ENFUSION_PROJECT_PATH); or send rows",
    );
  }
  const file = resolve(projectPath, rel);
  if (!isPathInsideRoot(file, projectPath)) {
    throw new VocabularyError("NOT_IN_PROJECT", `path resolves outside the project: ${rel}`);
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new VocabularyError("PATH_NOT_FOUND", `no file at ${rel} in the project`);
  }
  if (statSync(file).size > MAX_FILE_BYTES) {
    throw new VocabularyError("INVALID_ARGUMENT", `${rel} is over ${MAX_FILE_BYTES} bytes`);
  }
  const doc = parseCsv(readFileSync(file, "utf-8"));
  const bad = invalidLines(doc);
  if (bad.length > 0) {
    const shown = bad
      .slice(0, 5)
      .map((l) => `line ${l.line}: ${l.error}`)
      .join("; ");
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `${bad.length} line(s) of ${rel} are not rows (${shown}${bad.length > 5 ? "; ..." : ""}); nothing was sent`,
    );
  }
  const rows = doc.lines
    .filter((l) => l.kind === "row")
    .map((l) => ({ line: l.line, row: toHandlerRow(l.row!) }));
  if (rows.length === 0) throw new VocabularyError("INVALID_ARGUMENT", `${rel} holds no rows`);
  if (rows.length > MAX_FILE_ROWS) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `${rel} holds ${rows.length} rows, at most ${MAX_FILE_ROWS} per import; split the file`,
    );
  }
  return { file, rows, header: doc.header };
}

async function importFromCsv(
  client: WorldToolsClient,
  params: Raw,
  opts: WorldToolsOptions,
): Promise<WorldToolsResponse> {
  const action = "importObjects";
  const rel = str(params.path);
  let csv: ReturnType<typeof readImportCsv>;
  try {
    csv = readImportCsv(rel, opts.projectPath);
  } catch (e) {
    if (e instanceof VocabularyError) return fail(action, `path:${rel}`, e.code, e.message);
    throw e;
  }
  const target = `path:${rel}`;
  const warnings: string[] = [];
  if (params.relativeY === undefined) {
    warnings.push(
      "relativeY was not given: y is absolute (the vanilla plugin's default is y above the terrain)",
    );
  }
  const ids: string[] = [];
  const failed: Array<{ at: string; line: number; reason: string }> = [];
  const undoNames: string[] = [];
  let created = 0;
  const calls = Math.ceil(csv.rows.length / MAX_ROWS);
  for (let c = 0; c < calls; c++) {
    const chunk = csv.rows.slice(c * MAX_ROWS, (c + 1) * MAX_ROWS);
    const body: Raw = { action, rows: chunk.map((x) => x.row) };
    if (params.layer !== undefined) body.layer = params.layer;
    if (params.relativeY !== undefined) body.relativeY = params.relativeY;
    const s = await send(client, body, true, action, target);
    const progress = {
      calls: c,
      created,
      ids,
      failed,
      undoNames,
      rowsSent: c * MAX_ROWS,
      rowsTotal: csv.rows.length,
    };
    if ("error" in s) {
      if (c > 0) {
        s.error.message = `call ${c + 1} of ${calls} failed after ${created} entities were created: ${s.error.message}`;
        s.error.readback = { ...progress, failedCall: s.error.readback ?? null };
        s.error.next = `${calls - c} call(s) were not sent; each sent call is its own undo point (wb_undo_redo undo ${c} time(s) reverts them). ${s.error.next}`;
      }
      return s.error;
    }
    const r = s.r;
    for (const id of strs(r.ids)) ids.push(id);
    created += num(r.created) ?? strs(r.ids).length;
    for (const f of splitIndexed(strs(r.failed))) {
      // The handler's index is local to the call: answer the CSV row index and its line number.
      const local = Number(f.at);
      const isIndex = /^\d+$/.test(f.at) && local < chunk.length;
      failed.push({
        at: isIndex ? String(c * MAX_ROWS + local) : f.at,
        line: isIndex ? chunk[local]!.line : -1,
        reason: f.reason,
      });
    }
    if (str(r.undoName)) undoNames.push(str(r.undoName));
    for (const note of handlerNotes("importObjects", str(r.message))) {
      warnings.push(calls > 1 ? `call ${c + 1}: ${note}` : note);
    }
  }
  if (calls > 1)
    warnings.push(
      `${calls} handler calls: ${calls} undo points, one per call of up to ${MAX_ROWS} rows`,
    );
  if (failed.length > 0)
    warnings.push(`${failed.length} row(s) failed (see failed; line is the CSV line)`);
  return {
    ok: true,
    action,
    target,
    changed: ids.map((id) => ({ path: id, before: null, after: "created" })),
    readback: {
      file: rel,
      header: csv.header,
      rows: csv.rows.length,
      calls,
      created,
      ids,
      failed,
      undoName: undoNames[0] ?? null,
      undoNames,
    },
    next:
      calls > 1
        ? `wb_undo_redo undo ${calls} times reverts the import`
        : 'wb_undo_redo undo reverts the import ("' + (undoNames[0] ?? "") + '")',
    warnings,
  };
}

// ── goToCoords (SCR_CoordsTool) ───────────────────────────────────────────────

export const WEB_PREFIX = "https://enfusionengine.com/api/redirect?to=";
/** SCR_CoordsTool.MIN_CAMERA_Y. */
export const MIN_CAMERA_Y = 5;
/** The camera rotation the map-digits form uses (pitch, yaw, roll). */
export const MAP_ROTATION: [number, number, number] = [-45, 0, 0];

export interface ParsedCoords {
  form: "link" | "coords" | "map";
  /** For "map", y is 0 here: the height comes from the terrain (mapCameraY). */
  position: [number, number, number];
  /** Pitch, yaw, roll in degrees. */
  rotation: [number, number, number];
  /** The world an enfusion link names, if any. */
  world?: string;
  map?: { digits: number; left: number; right: number; multiplier: number; lift: number };
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function vector3(text: string, label: string): [number, number, number] {
  const t = text
    .replace(/,/g, " ")
    .trim()
    .split(/\s+/)
    .filter((x) => x !== "");
  if (t.length !== 3 || t.some((x) => !NUM.test(x))) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `${label} must be three numbers, got '${text.trim()}'`,
    );
  }
  const v = t.map(Number);
  if (v.some((n) => !Number.isFinite(n))) {
    throw new VocabularyError("INVALID_ARGUMENT", `${label} must be finite, got '${text.trim()}'`);
  }
  return [v[0]!, v[1]!, v[2]!];
}

/** `x,y,z(;pitch,yaw,roll)` as SCR_CoordsTool.GetCoordsFromString reads it (empty parts dropped). */
function coordsForm(text: string): Pick<ParsedCoords, "position" | "rotation"> {
  const values = text.split(";").filter((v) => v !== "");
  if (values.length === 0)
    throw new VocabularyError("INVALID_ARGUMENT", "no coordinates in the text");
  const position = vector3(values[0]!, "the position x,y,z");
  const rotation: [number, number, number] =
    values.length > 1 && values[1]!.trim() !== ""
      ? vector3(values[1]!, "the rotation pitch,yaw,roll")
      : [0, 0, 0];
  return { position, rotation };
}

/** 10^(5 - half), exact for a negative exponent by dividing. */
export function mapMultiplier(half: number): number {
  const e = 5 - half;
  return e >= 0 ? 10 ** e : 1 / 10 ** -e;
}

/**
 * Parses a SCR_CoordsTool text. Forms:
 * - enfusion link `enfusion://WorldEditor/<world>;x,y,z(;pitch,yaw,roll)`, optionally behind
 *   the `https://enfusionengine.com/api/redirect?to=` prefix (removed wherever it appears);
 * - coordinates `x,y,z(;pitch,yaw,roll)` (commas or spaces inside a vector);
 * - map digits: one or two groups of digits only, an even count of 2 to 12 (`1234`, `123 456`);
 *   multiplier `10^(5 - half)`, x = left * m + 0.5 * m, z = right * m, rotation -45 0 0.
 * Vanilla reads three space-separated numbers as a position before it tries map digits; here a
 * text of one or two digit groups is map digits and three numbers are a position. Throws
 * INVALID_ARGUMENT on anything else.
 */
export function parseCoordsText(raw: string): ParsedCoords {
  let text = raw.trim();
  if (text === "") throw new VocabularyError("INVALID_ARGUMENT", "text is empty");
  text = text.split(WEB_PREFIX).join("").trim();
  if (/^enfusion%3a/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      throw new VocabularyError("INVALID_ARGUMENT", "the link's percent-encoding is malformed");
    }
  }
  if (text.startsWith("enfusion")) {
    const sep = text.indexOf(";");
    if (sep < 0) {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        "the enfusion link has no coordinates (enfusion://WorldEditor/<world>;x,y,z)",
      );
    }
    let world = text.slice(0, sep).replace(/^enfusion:\/\/WorldEditor\//i, "");
    if (world.startsWith("enfusion")) world = "";
    const c = coordsForm(text.slice(sep + 1));
    return { form: "link", ...c, ...(world ? { world } : {}) };
  }
  if (/^\d+(?:\s+\d+)?$/.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length % 2 !== 0 || digits.length < 2 || digits.length > 12) {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        `map coordinates need an even count of 2 to 12 digits, got ${digits.length}`,
      );
    }
    const half = digits.length / 2;
    const left = Number(digits.slice(0, half));
    const right = Number(digits.slice(half));
    const m = mapMultiplier(half);
    return {
      form: "map",
      position: [left * m + 0.5 * m, 0, right * m],
      rotation: [...MAP_ROTATION],
      map: { digits: digits.length, left, right, multiplier: m, lift: Math.max(m, MIN_CAMERA_Y) },
    };
  }
  if (text.includes(",") || text.includes(";") || text.split(/\s+/).length === 3) {
    return { form: "coords", ...coordsForm(text) };
  }
  throw new VocabularyError(
    "INVALID_ARGUMENT",
    "text must be an enfusion link, x,y,z(;pitch,yaw,roll) or map digits such as 123 456",
  );
}

/** SCR_CoordsTool's camera height over map digits: terrain + lift, or lift where the terrain is at or below 0. */
export function mapCameraY(terrainY: number | null, lift: number): number {
  return terrainY === null || terrainY <= 0 ? lift : terrainY + lift;
}

/** vector.AnglesToVector of (yaw, pitch, roll) in degrees: the unit look direction. */
export function anglesToVector(yaw: number, pitch: number): [number, number, number] {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
}

/** The look direction SCR_CoordsTool.SetCamera gives a pitch, yaw, roll rotation. */
export function lookOf(rotation: [number, number, number]): [number, number, number] {
  return anglesToVector(rotation[1], rotation[0]);
}

const vecText = (v: readonly number[]) => v.map(floatText).join(" ");

async function goToCoords(client: WorldToolsClient, params: Raw): Promise<WorldToolsResponse> {
  const action = "goToCoords";
  const target = "camera";
  const text = str(params.text);
  let parsed: ParsedCoords;
  try {
    parsed = parseCoordsText(text);
  } catch (e) {
    if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
    throw e;
  }
  const warnings: string[] = [];
  const position: [number, number, number] = [...parsed.position];
  let terrainY: number | null = null;
  if (parsed.form === "map") {
    const h = await runTerrain(client, {
      action: "heights",
      points: [`${floatText(position[0])} ${floatText(position[2])}`],
    });
    if (!h.ok)
      return {
        ...h,
        action,
        warnings: [...h.warnings, "terrain height read failed; the camera did not move"],
      };
    const row = (h.readback as { points?: HeightRow[] }).points?.[0];
    if (!row) return fail(action, target, "HANDLER_ERROR", "wb_terrain heights answered no row");
    terrainY = row.onTerrain ? row.y : null;
    if (!row.onTerrain)
      warnings.push(
        "the point is off the terrain: the camera sits at the lift height (vanilla reads the height as 0)",
      );
    position[1] = mapCameraY(terrainY, parsed.map!.lift);
  }
  if (parsed.world) {
    warnings.push(
      `the link names world '${parsed.world}': only the camera moved, in the open world (wb_module setResource opens another)`,
    );
  }
  const look = lookOf(parsed.rotation);
  const v = await runView(client, {
    action: "setCamera",
    coords: vecText(position),
    look: vecText(look),
  });
  if (!v.ok) return { ...v, action };
  const res: ActionOk = {
    ...v,
    action,
    target,
    readback: {
      form: parsed.form,
      position,
      rotation: parsed.rotation,
      look: vecText(look),
      ...(parsed.world ? { world: parsed.world } : {}),
      ...(parsed.map ? { map: parsed.map, terrainY } : {}),
      camera: v.readback,
    },
    warnings: [...warnings, ...v.warnings],
  };
  return res;
}

// ── replaceEntities helper (SCR_EntityReplacerTool weights and percentages, OD-10) ──

/** SCR_ArrayHelper.GetWeightedIndex: -1 when empty; a value outside 0..1 wraps; 0 as fallback. */
export function weightedIndex(weights: readonly number[], value01: number): number {
  if (weights.length === 0) return -1;
  let v = value01;
  if (v < 0 || v > 1) v = ((v % 1) + 1) % 1;
  const sum = weights.reduce((a, b) => a + b, 0) * v;
  let add = 0;
  for (let i = 0; i < weights.length; i++) {
    add += weights[i]!;
    if (add > sum) return i;
  }
  return 0;
}

export interface ReplaceCandidate {
  /** W1 entity reference. */
  ref: string;
  /** The entity's prefab (its ancestor's resource name). */
  prefab: string;
}
export interface ToReplace {
  prefab: string;
  /** 0 to 100; vanilla default 100. */
  percentage?: number;
}
export interface ReplaceWith {
  prefab: string;
  /** At least 0; vanilla default 50. */
  weight?: number;
}

/** A seeded 0..1 generator (mulberry32) for reproducible plans. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function guidOf(prefab: string): string {
  const m = /^\{([0-9A-Fa-f]{16})\}/.exec(prefab.trim());
  return m ? m[1]!.toUpperCase() : prefab.trim().toLowerCase();
}

/**
 * The `ref=prefab` pairs SCR_EntityReplacerTool.CreateReplacements would make: a candidate whose
 * prefab is in `toReplace` (matched by GUID) is replaced with chance percentage/100; the
 * replacement is the same index of `replaceWith` when `inOrder` and that index exists, else a
 * weighted pick. Send the pairs to replaceEntities in calls of at most 200. Throws on bad input.
 */
export function planReplacements(
  candidates: readonly ReplaceCandidate[],
  toReplace: readonly ToReplace[],
  replaceWith: readonly ReplaceWith[],
  opts: { inOrder?: boolean; random?: () => number } = {},
): string[] {
  if (toReplace.length === 0) throw new VocabularyError("INVALID_ARGUMENT", "toReplace is empty");
  if (replaceWith.length === 0)
    throw new VocabularyError("INVALID_ARGUMENT", "replaceWith is empty");
  for (const t of toReplace) {
    const p = t.percentage ?? 100;
    if (!(p >= 0 && p <= 100)) {
      throw new VocabularyError("INVALID_ARGUMENT", `percentage must be 0 to 100, got ${p}`);
    }
  }
  for (const w of replaceWith) {
    if (!PREFAB.test(w.prefab.trim())) {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        `replaceWith prefab must be {GUID}path, got '${w.prefab}'`,
      );
    }
    const wt = w.weight ?? 50;
    if (!(wt >= 0 && Number.isFinite(wt))) {
      throw new VocabularyError("INVALID_ARGUMENT", `weight must be 0 or more, got ${wt}`);
    }
  }
  const rand = opts.random ?? Math.random;
  const weights = replaceWith.map((w) => w.weight ?? 50);
  const keys = toReplace.map((t) => guidOf(t.prefab));
  const pairs: string[] = [];
  for (const c of candidates) {
    let index = keys.indexOf(guidOf(c.prefab));
    if (index < 0) continue;
    if ((toReplace[index]!.percentage ?? 100) * 0.01 < rand()) continue;
    if (!opts.inOrder || index > replaceWith.length - 1) index = weightedIndex(weights, rand());
    const ref = printEntityRef(parseEntityRef(c.ref.trim()));
    pairs.push(`${ref}=${replaceWith[index]!.prefab.trim()}`);
  }
  return pairs;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_world_tools request end to end; never throws for a Workbench-side failure. */
export async function runWorldTools(
  client: WorldToolsClient,
  input: unknown,
  opts: WorldToolsOptions = {},
): Promise<WorldToolsResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  if (action === "goToCoords") return goToCoords(client, params);
  if (action === "importObjects" && typeof params.path === "string") {
    return importFromCsv(client, params, opts);
  }
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: WorldToolsResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = WORLD_TOOLS_CONTRACT): z.ZodRawShape {
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
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

export function registerWbWorldTools(
  server: McpServer,
  config: Config,
  client: WorkbenchClient,
): void {
  server.registerTool(
    "wb_world_tools", // TOOL_NAME, written out for the E11 census ref
    {
      description: wbWorldToolsDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "World Editor tools",
        readOnlyHint: false,
        // importObjects, snapToTerrain, resetFlags and replaceEntities edit the open world: one
        // undo point per call (wb_undo_redo); goToCoords moves the camera only.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      // The CSV path is relative to the project addon (src/utils/addon-root.ts), resolved per call.
      const addon = resolveAddonRoot(config);
      return toToolResult(
        await runWorldTools(client, input, { projectPath: addon.ok ? addon.root : undefined }),
      );
    },
  );
}
