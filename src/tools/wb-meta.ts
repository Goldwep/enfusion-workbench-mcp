/**
 * `wb_meta`: a resource's `.meta` (import settings per platform) through EMCP_WB_Meta
 * (wave W2, phase5-w2-spec.md section 2.2, OD-2).
 *
 *   get             read: GUID, class and ancestor per platform, tags
 *   vars            read, paged (`cursor`, `limit`): the per-variable schema of one configuration
 *   set, clear      one import setting of one platform, or of all (`allPlatforms`)
 *   setAncestor     the base config of one platform
 *   assignMaterial  a model's material slot to an .emat
 *
 * `path` is the source file (project-relative, or `{GUID}path`), never the `.meta`. Reads take any
 * file on disk; the four writes are a dry run until `confirm: true` and need the project guard
 * (the handler answers NOT_IN_PROJECT). Every write answers `before` and `after`; the inverse call
 * is the same action with the `before` value.
 *
 * The request is checked against the contract's per-action schema before anything is sent. Nothing
 * here names a sandbox or a project. Not registered here: src/server.ts registers it.
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
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Meta";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const META_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const META_REQUEST_SCHEMA = buildRequestSchema(META_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbMetaDescription(): string {
  return checkedDescription(META_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = META_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(META_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

const READ_TIMEOUT_MS = 30_000;
/** A write saves the meta; Workbench can take a moment to write it. */
const WRITE_TIMEOUT_MS = 60_000;

type Raw = Record<string, unknown>;

export type MetaError = ActionError & { readback?: unknown };
export type MetaResponse = ActionOk | MetaError;

/** The client surface this tool needs (a fake in tests). */
export type MetaClient = Pick<WorkbenchClient, "call">;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): MetaError {
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

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ── Request checks ────────────────────────────────────────────────────────────

const GUID_PREFIX = /^(\{[0-9A-Fa-f]{16}\})(.*)$/;

/**
 * Checks a source path: project-relative, or `{GUID}path`. Absolute forms, `..` and a `.meta`
 * name refuse. Returns the path to send (the GUID prefix kept, backslashes turned to slashes).
 */
export function checkSourcePath(raw: string): string {
  const trimmed = raw.trim();
  const m = GUID_PREFIX.exec(trimmed);
  const rest = m ? m[2] : trimmed;
  const clean = checkRelativePath(rest);
  if (clean.toLowerCase().endsWith(".meta")) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `path names the .meta itself; name the source file it belongs to: ${raw}`,
    );
  }
  return m ? `${m[1]}${clean}` : clean;
}

/** The one-sentence refusal text for an input that fails a check, or undefined. */
function checkValues(action: string, p: Raw): string | undefined {
  if (
    p.limit !== undefined &&
    (typeof p.limit !== "number" || p.limit < 1 || p.limit > LIMIT_MAX)
  ) {
    return `limit must be 1 to ${LIMIT_MAX}`;
  }
  if (typeof p.platform === "string" && p.platform.trim() === "") {
    return "platform is empty (omit it for PC; wb_meta get lists the platforms)";
  }
  if (typeof p.name === "string" && p.name.trim() === "") {
    return action === "assignMaterial"
      ? "name is empty: pass the source material slot"
      : "name is empty: pass the variable name (wb_meta vars lists them)";
  }
  if (action === "setAncestor") {
    const v = str(p.value);
    if (!v.startsWith("{")) {
      return `value must be the ancestor's ResourceName {GUID}path, got '${v}'`;
    }
  }
  if (action === "assignMaterial") {
    const v = str(p.value);
    if (!v.startsWith("{") || !v.toLowerCase().endsWith(".emat")) {
      return `value must be an .emat ResourceName {GUID}path, got '${v}'`;
    }
  }
  return undefined;
}

function targetOf(p: Raw): string {
  const path = str(p.path);
  return path ? `path:${path}` : "path:";
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: MetaError };

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
  const parsed = META_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  let path: string;
  try {
    path = checkSourcePath(str(req.path));
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const why = checkValues(action, req);
  if (why) return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", why) };
  if (typeof req.cursor === "string" && req.cursor !== "") {
    try {
      parseCursor(req.cursor);
    } catch (e) {
      if (e instanceof VocabularyError) {
        return { ok: false, error: fail(action, target, e.code, e.message) };
      }
      throw e;
    }
  }
  const mutating = MUTATING.has(action);
  const params: Raw = { ...req, path };
  // A write is a dry run unless confirm is true: send the flag explicitly.
  if (mutating) params.confirm = req.confirm === true;
  return { ok: true, action, target: `path:${path}`, mutating, params };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a MetaError, else null. */
function handlerFailure(action: string, target: string, r: Raw): MetaError | null {
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
    const before = strs(r.before);
    const after = strs(r.after);
    if (status === "error" && (before.length > 0 || after.length > 0)) {
      // A write that failed part way: say what was read and what stood after.
      e.readback = { before, after, saved: truthy(r.saved) };
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: MetaClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: MetaError }> {
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
      f.next = `The call was lost and is never retried; read back with wb_meta ${
        action === "assignMaterial" ? "get" : "vars"
      } first.`;
    }
    return { error: f };
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

export interface PlatformRow {
  platform: string;
  className: string;
  ancestor: string;
}

/** get platforms "PLATFORM=Class:ancestor". */
export function parsePlatforms(lines: string[]): PlatformRow[] {
  return lines.map((line) => {
    const eq = line.indexOf("=");
    const platform = eq < 0 ? line : line.slice(0, eq);
    const rest = eq < 0 ? "" : line.slice(eq + 1);
    const colon = rest.indexOf(":");
    return {
      platform,
      className: colon < 0 ? rest : rest.slice(0, colon),
      ancestor: colon < 0 ? "" : rest.slice(colon + 1),
    };
  });
}

/** Splits "key=value" lines at the first "="; a line without one has an empty value. */
export function splitPairs(lines: string[]): Array<[string, string]> {
  return lines.map((line) => {
    const eq = line.indexOf("=");
    return eq < 0 ? [line, ""] : [line.slice(0, eq), line.slice(eq + 1)];
  });
}

/** vars rows are row-major cells of the kept columns; one object per variable. */
export function parseVarRows(columns: string, cells: string[]): Array<Record<string, string>> {
  const names = columns === "" ? [] : columns.split(",");
  if (names.length === 0) return [];
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i + names.length <= cells.length; i += names.length) {
    const row: Record<string, string> = {};
    names.forEach((n, k) => {
      row[n] = cells[i + k] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** One Change per key whose value differs between the before and after lines. */
export function diffPairs(before: string[], after: string[], prefix: string): Change[] {
  const b = new Map(splitPairs(before));
  const a = new Map(splitPairs(after));
  const keys = [...new Set([...b.keys(), ...a.keys()])];
  const out: Change[] = [];
  for (const k of keys) {
    const bv = b.has(k) ? b.get(k)! : null;
    const av = a.has(k) ? a.get(k)! : null;
    if (bv === av) continue;
    out.push({ path: `${prefix}${k}`, before: bv, after: av });
  }
  return out;
}

// ── Shaping ───────────────────────────────────────────────────────────────────

const RESEND: Record<string, string> = {
  set: "Resend with confirm: true to set the value and save the meta.",
  clear: "Resend with confirm: true to clear the setting and save the meta.",
  setAncestor: "Resend with confirm: true to set the ancestor and save the meta.",
  assignMaterial: "Resend with confirm: true to assign the material and save the meta.",
};

const INVERSE: Record<string, string> = {
  set: "The inverse is wb_meta set with the 'before' value (wb_meta clear resets it to the inherited one).",
  clear: "The inverse is wb_meta set with the 'before' value.",
  setAncestor: "The inverse is wb_meta setAncestor with the 'before' ResourceName.",
  assignMaterial: "The inverse is wb_meta assignMaterial with the 'before' material for the slot.",
};

function shapeOk(action: string, target: string, params: Raw, r: Raw): ActionOk {
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  switch (action) {
    case "get": {
      const platforms = parsePlatforms(strs(r.platforms));
      readback = {
        resourceName: str(r.resourceName),
        guid: str(r.guid),
        sourcePath: str(r.sourcePath),
        count: num(r.count) ?? platforms.length,
        platforms,
        tags: strs(r.tags),
      };
      next = "wb_meta vars reads one platform's variables; wb_meta set changes one";
      break;
    }
    case "vars": {
      const columns = str(r.columns);
      const cells = strs(r.rows);
      const width = columns === "" ? 0 : columns.split(",").length;
      if (width > 0 && cells.length % width !== 0) {
        warnings.push(
          `the handler answered ${cells.length} cells for ${width} columns: the last partial row is dropped`,
        );
      }
      const cursor = str(r.nextCursor);
      readback = {
        platform: str(params.platform) || "PC",
        total: num(r.total) ?? 0,
        columns: columns === "" ? [] : columns.split(","),
        rows: parseVarRows(columns, cells),
        nextCursor: cursor || null,
      };
      if (cursor) next = `wb_meta vars with cursor "${cursor}" for the next page`;
      break;
    }
    default: {
      const before = strs(r.before);
      const after = strs(r.after);
      const dry = truthy(r.dryRun);
      const saved = truthy(r.saved);
      readback = { dryRun: dry, saved, before, after, message: str(r.message) };
      if (dry) {
        next = RESEND[action];
      } else {
        const keyed = diffPairs(before, after, "");
        changed =
          action === "set" || action === "clear"
            ? keyed.map((c) => ({ ...c, path: `${c.path}.${str(params.name)}` }))
            : action === "setAncestor"
              ? keyed.map((c) => ({ ...c, path: `${c.path}.ancestor` }))
              : keyed.map((c) => ({ ...c, path: `MaterialAssigns.${c.path}` }));
        next = INVERSE[action];
        if (!saved) warnings.push("the handler did not report the meta saved");
        if (changed.length === 0) warnings.push("the value read back equals the value before");
      }
      const note = str(r.message);
      if (note.includes("(the ancestor's class")) {
        warnings.push(note.slice(note.indexOf("(the ancestor's class")));
      }
    }
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_meta request end to end; never throws for a Workbench-side failure. */
export async function runMeta(client: MetaClient, input: unknown): Promise<MetaResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: MetaResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = META_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
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
  return shape;
}

export function registerWbMeta(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_meta",
    {
      description: wbMetaDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Resource meta files",
        readOnlyHint: false,
        // set, clear, setAncestor and assignMaterial rewrite a .meta (a dry run until confirm);
        // each answers before and after, and the same action with before reverses it.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runMeta(client, input));
    },
  );
}
