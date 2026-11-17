/**
 * `wb_resources`: the resource database, import and file creation through EMCP_WB_Resources
 * (wave W2, phase5-w2-spec.md section 2.1), plus three TypeScript-only actions.
 *
 *   search, selection, resolve,
 *   addons, newGuid, wait          read; search is paged (`cursor`, `limit`)
 *   register, rebuild, import,
 *   create, prefabFromModel        write; a dry run unless `confirm: true`
 *   getInfo (TS)                   the Bohemia GetResourceInfo handler (BI), read
 *   open (TS)                      wb_module setResource: the owning editor opens the resource
 *   link (TS)                      builds or parses enfusion://ResourceManager/~<Addon>:<path>
 *
 * 1.x names stay accepted (LEGACY_MAP): `browse` is `search`; `register`, `rebuild`, `getInfo` and
 * `open` keep their names, but register and rebuild are now a dry run unless `confirm` (DEC-058).
 *
 * Ruling W2 OD-6 (DEC-063): `wb_world register` and `wb_world browserSelection` stay as aliases of
 * the wb_resources actions `register` and `selection`. The route table is ACTION_ALIASES in
 * src/manifest/aliases.ts; WORLD_ALIAS_MAP and routeWorldAlias are its wb_world view. wb_world keeps
 * answering both on EMCP_WB_World, the route the W1 battery proved live.
 *
 * The request is checked against the contract's per-action schema and the shared vocabulary before
 * anything is sent. Nothing here names a sandbox or a project: the handler's project guard answers
 * NOT_IN_PROJECT. Not registered here: src/server.ts registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { BI_TIMEOUTS, LIVE_NOTES, MODAL_HAZARD_WARNING } from "../workbench/bi-handlers.js";
import { routeActionAlias } from "../manifest/aliases.js";
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
import { codeOfClientError, owningModule, runModule, type ModuleClient } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Resources";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const RESOURCES_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const RESOURCES_REQUEST_SCHEMA = buildRequestSchema(RESOURCES_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbResourcesDescription(): string {
  return checkedDescription(RESOURCES_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = RESOURCES_CONTRACT.actions.map((a) => a.name);

/** The actions this file answers without the handler. */
export const TS_ACTIONS = ["getInfo", "open", "link"] as const;

/**
 * 1.x action name to what this tool sends. `browse` has no handler action: it is search.
 * The other four keep their name; the note says what changed.
 */
export const LEGACY_MAP: Readonly<Record<string, string>> = {
  browse: "search",
  register: "register (a dry run unless confirm: true)",
  rebuild: "rebuild (a dry run unless confirm: true; takes configuration, not buildRuntime)",
  getInfo: "getInfo (GetResourceInfo, as in 1.x)",
  open: "open (wb_module setResource)",
};
/** LEGACY_MAP's keys, written out so the census (E11) reads them as literals. */
export const LEGACY_ACTIONS: string[] = ["browse", "register", "rebuild", "getInfo", "open"];

/** The 1.x action names that are not a handler or TS action any more. */
const RENAMED_ACTIONS: Readonly<Record<string, string>> = { browse: "search" };

/**
 * OD-6: wb_world action to the wb_resources action that is its home. The integrator routes the
 * wb_world names through routeWorldAlias (src/manifest/aliases.ts); the answers differ in shape.
 */
export const WORLD_ALIAS_MAP: Readonly<Record<string, string>> = {
  register: "register",
  browserSelection: "selection",
};

export interface WorldAliasRoute {
  tool: "wb_resources";
  args: Record<string, unknown>;
}

/**
 * The wb_resources call a wb_world `register` or `browserSelection` call stands for. Throws
 * VocabularyError INVALID_ARGUMENT for another action and for an argument with no equivalent.
 */
export function routeWorldAlias(action: string, args: Record<string, unknown>): WorldAliasRoute {
  const to = WORLD_ALIAS_MAP[action];
  if (to === undefined) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `wb_world ${action} is not a wb_resources alias; the aliases are ${Object.keys(WORLD_ALIAS_MAP).join(", ")}`,
    );
  }
  // The table lives in src/manifest/aliases.ts (ACTION_ALIASES); this is its wb_world view.
  const routed = routeActionAlias("wb_world", action, args);
  if (!routed || routed.tool !== "wb_resources" || routed.args.action !== to) {
    throw new VocabularyError("INVALID_ARGUMENT", `wb_world ${action} has no wb_resources route`);
  }
  return { tool: "wb_resources", args: routed.args };
}

const MUTATING = new Set(RESOURCES_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

/** Most files one rebuild takes (the handler's PATHS_MAX). */
export const PATHS_MAX = 200;
/** Largest per-file wait (the handler's WAIT_MAX). */
export const WAIT_MAX = 10_000;
/** The six platform configurations the handler accepts. */
export const CONFIGURATIONS = ["PC", "XBOX_ONE", "XBOX_SERIES", "PS4", "PS5", "HEADLESS"] as const;
const READ_TIMEOUT_MS = 30_000;
/** A call must answer before the wedge threshold (150 s). */
const CALL_TIMEOUT_CAP_MS = 149_000;

type Raw = Record<string, unknown>;

export type ResourcesError = ActionError & { readback?: unknown };
export type ResourcesResponse = ActionOk | ResourcesError;

/** The client surface this tool needs (a fake in tests). */
export type ResourcesClient = Pick<WorkbenchClient, "call">;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): ResourcesError {
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

export interface RegisterFileResult {
  ok: boolean;
  /** The `{GUID}path` the handler answered, "" when none. */
  resourceName: string;
  message: string;
}

/**
 * Registers a file written offline under `addonDir` (the 1.x callers game_duplicate and
 * wb_entity_duplicate). The handler takes the project-relative path and writes only with
 * `confirm: true`, so both are sent; ok only when the handler answers `registered` and not a
 * dry run. The handler's project guard decides: a file outside the loaded project is refused.
 */
export async function registerProjectFile(
  client: ResourcesClient,
  addonDir: string,
  absPath: string,
  timeout = 30_000,
): Promise<RegisterFileResult> {
  const rel = relative(addonDir, absPath).replace(/\\/g, "/");
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, resourceName: "", message: `${absPath} is not under ${addonDir}` };
  }
  const r = await client.call<Raw>(
    HANDLER,
    { action: "register", path: rel, buildRuntime: false, confirm: true },
    { timeout },
  );
  const ok = str(r.status) === "ok" && truthy(r.registered) && !truthy(r.dryRun);
  const code = str(r.code);
  const text = str(r.message) || `the handler answered ${str(r.status) || "no status"}`;
  return {
    ok,
    resourceName: str(r.resourceName),
    message: ok ? text : code ? `${code}: ${text}` : text,
  };
}

/** The home folder out of any text the engine answered (the handler scrubs its own answers). */
export function scrubHome(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>")
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, "<home>");
}

function scrubDeep(v: unknown): unknown {
  if (typeof v === "string") return scrubHome(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)]));
  }
  return v;
}

// ── Request checks ────────────────────────────────────────────────────────────

const GUID_NAME = /^\{[0-9A-Fa-f]{16}\}/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ADDON_ID = /^[A-Za-z0-9_.-]+$/;

function invalid(message: string): never {
  throw new VocabularyError("INVALID_ARGUMENT", message);
}

/** A project-relative source file: relative form, and never a .meta (name the file it belongs to). */
function sourcePath(raw: string): string {
  const p = checkRelativePath(raw);
  if (p.toLowerCase().endsWith(".meta")) {
    invalid("a .meta file is not a resource; pass the file it belongs to");
  }
  return p;
}

/** A new file's path: one of the extensions, else UNSUPPORTED_TYPE. */
function newFilePath(raw: string, exts: readonly string[]): string {
  const p = sourcePath(raw);
  const lower = p.toLowerCase();
  if (!exts.some((e) => lower.endsWith(e))) {
    throw new VocabularyError(
      "UNSUPPORTED_TYPE",
      `the new file must end in one of ${exts.join(", ")}: ${p}`,
    );
  }
  return p;
}

/** `{GUID}path` with a non-empty path ending in `ext` (when given). */
function resourceNameOf(raw: string, what: string, ext?: string): string {
  if (!GUID_NAME.test(raw) || raw.length <= 18) {
    invalid(`${what} must be a resource name {GUID}path, got '${raw}'`);
  }
  if (ext !== undefined && !raw.toLowerCase().endsWith(ext)) {
    invalid(`${what} must end in ${ext}, got '${raw}'`);
  }
  return raw;
}

/** The handler's rootPath rule: `$Addon:Folder/` or a relative folder. */
function checkRootPath(raw: string): string {
  const root = raw.replace(/\\/g, "/");
  const prefixed = root.startsWith("$") && root.indexOf(":") > 1;
  const colons = root.split(":").length - 1;
  if ((!prefixed && colons > 0) || colons > 1 || root.includes("..") || root.startsWith("/")) {
    throw new VocabularyError(
      "ABSOLUTE_PATH",
      `rootPath must be $Addon:Folder/ or a relative folder, got '${raw}'`,
    );
  }
  return root;
}

function checkTimeout(v: unknown): void {
  if (v === undefined) return;
  if (typeof v !== "number" || v < 0 || v > WAIT_MAX) invalid(`timeoutMs must be 0 to ${WAIT_MAX}`);
}

function checkConfiguration(v: unknown): void {
  if (v === undefined) return;
  if (!(CONFIGURATIONS as readonly string[]).includes(str(v))) {
    invalid(`configuration must be ${CONFIGURATIONS.join(", ")}; got '${str(v)}'`);
  }
}

/** The target text of a request: what the action works on. */
function targetOf(p: Raw): string {
  const action = str(p.action);
  switch (action) {
    case "search":
    case "browse":
      return `root:${str(p.rootPath) || "(all addons)"}`;
    case "selection":
      return "browser:selection";
    case "addons":
      return "addons";
    case "newGuid":
      return "guid";
    case "link":
      return "link";
    case "rebuild":
      if (Array.isArray(p.paths) && p.paths.length > 0 && str(p.path) === "") {
        return `paths:${p.paths.length}`;
      }
      return `path:${str(p.path)}`;
    case "prefabFromModel":
      return `path:${str(p.path)}`;
    default:
      return `path:${str(p.path)}`;
  }
}

/** A checked request: what is sent, or the refusal raised before sending. */
export type Prepared =
  | {
      ok: true;
      kind: "handler";
      /** The name the caller used (a 1.x name stays visible in the answer). */
      action: string;
      target: string;
      mutating: boolean;
      /** What goes to the handler (action already mapped). */
      params: Raw;
      warnings: string[];
    }
  | { ok: true; kind: "getInfo"; action: string; target: string; path: string; expand: boolean }
  | { ok: true; kind: "open"; action: string; target: string; path: string }
  | { ok: true; kind: "link"; action: string; target: string; link: LinkRequest }
  | { ok: false; error: ResourcesError };

export type LinkRequest =
  | { mode: "build"; addon: string; path: string }
  | { mode: "parse"; url: string };

const GETINFO_SCHEMA = z
  .object({
    action: z.literal("getInfo"),
    path: z.string().describe("resource path ({GUID}path or project-relative)"),
    expandResource: z.boolean().optional().describe("also read the container"),
  })
  .strict();

const OPEN_SCHEMA = z
  .object({ action: z.literal("open"), path: z.string().describe("project-relative resource") })
  .strict();

const LINK_SCHEMA = z
  .object({
    action: z.literal("link"),
    addon: z.string().optional().describe("link: addon id (with path)"),
    path: z.string().optional().describe("link: resource path (with addon)"),
    url: z.string().optional().describe("link: an enfusion:// link to parse"),
  })
  .strict();

const LINK_PREFIX = "enfusion://ResourceManager/~";
const LINK_PARSE = /^enfusion:\/\/ResourceManager\/~([^:/]+):(.+)$/;

function zodIssues(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/** Builds or parses a Resource Manager link; throws VocabularyError. */
export function resolveLink(link: LinkRequest): { url: string; addon: string; path: string } {
  if (link.mode === "build") {
    if (!ADDON_ID.test(link.addon)) invalid(`addon must be an addon id, got '${link.addon}'`);
    const path = checkRelativePath(link.path);
    return { url: `${LINK_PREFIX}${link.addon}:${path}`, addon: link.addon, path };
  }
  const m = LINK_PARSE.exec(link.url.trim());
  if (!m) invalid(`a link is ${LINK_PREFIX}<Addon>:<path>, got '${link.url}'`);
  const addon = m[1];
  if (!ADDON_ID.test(addon)) invalid(`addon must be an addon id, got '${addon}'`);
  const path = checkRelativePath(m[2]);
  return { url: `${LINK_PREFIX}${addon}:${path}`, addon, path };
}

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const target = targetOf(raw);
  const known = [...HANDLER_ACTIONS, ...TS_ACTIONS, ...Object.keys(RENAMED_ACTIONS)];
  if (!known.includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `unknown action '${action}'; one of ${known.join(", ")}`,
      ),
    };
  }
  try {
    if (action === "getInfo") {
      const parsed = GETINFO_SCHEMA.safeParse(input);
      if (!parsed.success) invalid(zodIssues(parsed.error));
      const path = parsed.data.path.trim();
      if (path === "") invalid("path is empty");
      // A {GUID}path or {GUID} resource name goes as it is; a plain path must be relative.
      const checked = path.startsWith("{")
        ? checkResourceNameOrGuid(path)
        : checkRelativePath(path);
      return {
        ok: true,
        kind: "getInfo",
        action,
        target: `path:${checked}`,
        path: checked,
        expand: parsed.data.expandResource === true,
      };
    }
    if (action === "open") {
      const parsed = OPEN_SCHEMA.safeParse(input);
      if (!parsed.success) invalid(zodIssues(parsed.error));
      const path = sourcePath(parsed.data.path);
      return { ok: true, kind: "open", action, target: `path:${path}`, path };
    }
    if (action === "link") {
      const parsed = LINK_SCHEMA.safeParse(input);
      if (!parsed.success) invalid(zodIssues(parsed.error));
      const { addon, path, url } = parsed.data;
      if (url !== undefined) {
        if (addon !== undefined || path !== undefined) invalid("link: pass url, or addon and path");
        resolveLink({ mode: "parse", url });
        return { ok: true, kind: "link", action, target, link: { mode: "parse", url } };
      }
      if (addon === undefined || path === undefined) invalid("link needs addon and path, or url");
      resolveLink({ mode: "build", addon, path });
      return { ok: true, kind: "link", action, target, link: { mode: "build", addon, path } };
    }
    return prepareHandler(action, raw, input);
  } catch (e) {
    if (e instanceof VocabularyError)
      return { ok: false, error: fail(action, targetOf(raw), e.code, e.message) };
    throw e;
  }
}

/** `{GUID}` or `{GUID}path` for getInfo; the path part, when there is one, must be relative. */
function checkResourceNameOrGuid(raw: string): string {
  if (!GUID_NAME.test(raw)) invalid(`a GUID is 16 hex characters in braces, got '${raw}'`);
  const rest = raw.slice(18);
  if (rest !== "") checkRelativePath(rest);
  return raw;
}

function prepareHandler(action: string, raw: Raw, input: unknown): Prepared {
  const warnings: string[] = [];
  let sentAs = action;
  const renamed = RENAMED_ACTIONS[action];
  if (renamed !== undefined) {
    sentAs = renamed;
    warnings.push(`1.x action name '${action}': sent as ${renamed} (OD-6)`);
  }
  if (sentAs === "rebuild" && raw.buildRuntime !== undefined) {
    invalid(
      "buildRuntime belongs to register; rebuild takes configuration (default PC) and timeoutMs",
    );
  }
  const parsed = RESOURCES_REQUEST_SCHEMA.safeParse({ ...(input as Raw), action: sentAs });
  if (!parsed.success) invalid(zodIssues(parsed.error));
  const req = parsed.data as Raw;
  const params: Raw = { ...req };

  if (typeof req.limit === "number" && (req.limit < 1 || req.limit > LIMIT_MAX)) {
    invalid(`limit must be 1 to ${LIMIT_MAX}`);
  }
  if (typeof req.cursor === "string" && req.cursor !== "") parseCursor(req.cursor);
  checkTimeout(req.timeoutMs);
  checkConfiguration(req.configuration);

  switch (sentAs) {
    case "search": {
      if (typeof req.rootPath === "string" && req.rootPath !== "") {
        params.rootPath = checkRootPath(req.rootPath);
      }
      if (Array.isArray(req.extensions)) {
        params.extensions = (req.extensions as string[]).map((ext) => {
          const bare = ext.startsWith(".") ? ext.slice(1) : ext;
          if (bare === "" || bare.includes("/") || bare.includes("\\")) {
            invalid(`extensions holds an empty or invalid entry '${ext}'; pass it without the dot`);
          }
          return bare;
        });
      }
      break;
    }
    case "resolve": {
      const p = str(req.path);
      if (p.startsWith("{")) params.path = checkResourceNameOrGuid(p);
      else params.path = checkRelativePath(p);
      break;
    }
    case "wait":
      params.path = checkRelativePath(str(req.path));
      break;
    case "register":
      params.path = sourcePath(str(req.path));
      break;
    case "rebuild": {
      const asked: string[] = [];
      if (typeof req.path === "string") asked.push(sourcePath(req.path));
      if (Array.isArray(req.paths))
        for (const x of req.paths as string[]) asked.push(sourcePath(x));
      if (asked.length === 0) invalid("path or paths is required");
      if (asked.length > PATHS_MAX) invalid(`${asked.length} files; at most ${PATHS_MAX}`);
      if (typeof req.path === "string") params.path = asked[0];
      if (Array.isArray(req.paths)) {
        params.paths = asked.slice(typeof req.path === "string" ? 1 : 0);
      }
      break;
    }
    case "import": {
      params.path = sourcePath(str(req.path));
      for (const s of (req.settings as string[] | undefined) ?? []) {
        const eq = s.indexOf("=");
        if (eq < 1 || !IDENTIFIER.test(s.slice(0, eq))) {
          invalid(`a setting must be name=value with a variable name, got '${s}'`);
        }
      }
      break;
    }
    case "create": {
      params.path = newFilePath(str(req.path), [".conf", ".emat", ".layout"]);
      if (!IDENTIFIER.test(str(req.className))) {
        invalid(`className must be a class name, got '${str(req.className)}'`);
      }
      if (typeof req.inherit === "string" && req.inherit !== "") {
        resourceNameOf(req.inherit, "inherit");
      }
      break;
    }
    case "prefabFromModel": {
      params.path = newFilePath(str(req.path), [".et"]);
      resourceNameOf(str(req.xobPath), "xobPath", ".xob");
      if (typeof req.inherit === "string" && req.inherit !== "") {
        resourceNameOf(req.inherit, "inherit", ".et");
      }
      break;
    }
    default:
      break;
  }

  const mutating = MUTATING.has(sentAs);
  if (mutating) params.confirm = req.confirm === true;
  return {
    ok: true,
    kind: "handler",
    action,
    target: targetOf({ ...params, action }),
    mutating,
    params,
    warnings,
  };
}

// ── Handler answer ────────────────────────────────────────────────────────────

const PARTIAL_KEYS = [
  "saved",
  "savedPath",
  "resourceName",
  "guid",
  "registered",
  "before",
  "after",
  "rebuilt",
  "pending",
] as const;

/** What a failed write already did: the keys the handler filled before it stopped. */
function partialReadback(r: Raw): Raw | undefined {
  const out: Raw = {};
  for (const k of PARTIAL_KEYS) {
    const v = r[k];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = k === "saved" || k === "registered" ? truthy(v) : v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A handler refusal or error as a ResourcesError, else null. */
function handlerFailure(
  action: string,
  target: string,
  r: Raw,
  mutating: boolean,
): ResourcesError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ErrorCode = status === "error" ? "ENGINE_FALSE" : "INVALID_ARGUMENT";
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
    // A refusal after import registered a file that had no .meta still reports that write (F1).
    if (mutating && (status === "error" || truthy(r.registered))) {
      const partial = partialReadback(r);
      if (partial) e.readback = partial;
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

/** The client timeout of a call: rebuild and wait take up to timeoutMs per file. */
export function timeoutFor(sentAs: string, params: Raw): number {
  if (sentAs !== "rebuild" && sentAs !== "wait") return READ_TIMEOUT_MS;
  const perFile = typeof params.timeoutMs === "number" ? params.timeoutMs : 1000;
  const files =
    (typeof params.path === "string" && params.path !== "" ? 1 : 0) +
    (Array.isArray(params.paths) ? params.paths.length : 0);
  return Math.min(CALL_TIMEOUT_CAP_MS, READ_TIMEOUT_MS + perFile * Math.max(1, files));
}

async function send(
  client: ResourcesClient,
  prepared: Extract<Prepared, { kind: "handler" }>,
): Promise<{ r: Raw } | { error: ResourcesError }> {
  const { action, target, mutating, params } = prepared;
  const wire = str(params.action);
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: timeoutFor(wire, params),
    });
    const f = handlerFailure(action, target, r, mutating);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating) {
      f.next = `The call was lost and is never retried; read back first (wb_resources resolve path: ${str(params.path)}).`;
    }
    return { error: f };
  }
}

// ── Row parsing ───────────────────────────────────────────────────────────────

export interface AddonRow {
  guid: string;
  id: string;
  vanilla: boolean;
  loaded: boolean;
  title: string;
}

/** addons rows "guid|id|vanilla|loaded|title"; the title is last and may hold a `|`. */
export function parseAddonRows(rows: string[]): AddonRow[] {
  return rows.map((line) => {
    const c = line.split("|");
    return {
      guid: c[0] ?? "",
      id: c[1] ?? "",
      vanilla: c[2] === "true",
      loaded: c[3] === "true",
      title: c.slice(4).join("|"),
    };
  });
}

export interface SettingRow {
  configuration: string;
  name: string;
  value: string;
}

/** import rows "<configuration>:<name>=<value>"; the value may hold `:` and `=`. */
export function parseSettingRow(line: string): SettingRow {
  const colon = line.indexOf(":");
  const eq = line.indexOf("=", colon + 1);
  if (colon < 1 || eq < 0) return { configuration: "", name: line, value: "" };
  return {
    configuration: line.slice(0, colon),
    name: line.slice(colon + 1, eq),
    value: line.slice(eq + 1),
  };
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(
  prepared: Extract<Prepared, { kind: "handler" }>,
  r: Raw,
  warnings: string[],
): ActionOk {
  const { action, target, params } = prepared;
  const sentAs = str(params.action);
  const rel = str(params.path);
  const message = str(r.message);
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined = str(r.next) || undefined;
  const dryRun = truthy(r.dryRun);

  switch (sentAs) {
    case "search": {
      const cursor = str(r.nextCursor);
      const capped = truthy(r.capped);
      readback = {
        total: num(r.total) ?? 0,
        items: strs(r.items),
        nextCursor: cursor || null,
        capped,
      };
      if (capped) warnings.push(message || "the hits are capped: narrow the filter");
      if (cursor)
        next = `wb_resources search with cursor "${cursor}" and the same filter for the next page`;
      break;
    }
    case "selection": {
      const capped = truthy(r.capped);
      readback = { total: num(r.total) ?? 0, items: strs(r.items), capped };
      if (capped) warnings.push(message || "the selection is capped");
      break;
    }
    case "resolve": {
      const hasMeta = truthy(r.hasMeta);
      readback = {
        resourceName: str(r.resourceName),
        guid: str(r.guid),
        relPath: str(r.relPath),
        absPath: str(r.absPath),
        hasMeta,
        sourcePath: str(r.sourcePath),
      };
      if (!hasMeta) {
        warnings.push("no .meta on disk: a packed resource, or a file that is not registered");
      }
      break;
    }
    case "addons": {
      readback = {
        total: num(r.total) ?? 0,
        addons: parseAddonRows(strs(r.items)),
        projectFile: str(r.projectFile),
      };
      break;
    }
    case "newGuid":
      readback = { guid: str(r.guid) };
      break;
    case "wait": {
      const found = truthy(r.found);
      readback = { path: rel, found };
      if (!found) warnings.push(message || "the file was not acknowledged within the timeout");
      break;
    }
    case "register": {
      const registered = truthy(r.registered);
      const already = registered && /already registered/i.test(message);
      readback = {
        path: rel,
        registered,
        alreadyRegistered: already,
        dryRun: already ? false : dryRun,
        resourceName: str(r.resourceName) || null,
        guid: str(r.guid) || null,
      };
      if (already) break;
      if (dryRun) {
        warnings.push("dry run: nothing was written");
        next = "Resend with confirm: true to register the file.";
        break;
      }
      changed = [{ path: `${rel}.meta`, before: null, after: str(r.resourceName) }];
      next = "The file stays registered; a file created for a test is removed by hand.";
      break;
    }
    case "rebuild": {
      const pending = strs(r.pending);
      readback = {
        count: num(r.count) ?? 0,
        dryRun,
        rebuilt: strs(r.rebuilt),
        pending,
        message,
      };
      if (dryRun) {
        warnings.push("dry run: nothing was rebuilt");
        next = "Resend with confirm: true to rebuild.";
      } else if (pending.length > 0) {
        warnings.push(
          `${pending.length} file(s) not acknowledged in time: the rebuild may still finish; read the Workbench log (the engine calls are void)`,
        );
      }
      break;
    }
    case "import": {
      const before = strs(r.before).map(parseSettingRow);
      const after = strs(r.after).map(parseSettingRow);
      const rows = after.map((a, i) => ({
        path: `${a.configuration}.${a.name}`,
        before: before.length === after.length ? before[i].value : null,
        after: a.value,
      }));
      readback = {
        path: rel,
        dryRun,
        resourceName: str(r.resourceName) || null,
        guid: str(r.guid) || null,
        rebuilt: strs(r.rebuilt),
        message,
      };
      if (dryRun) {
        readback.wouldChange = rows;
        warnings.push("dry run: nothing was written");
        next = "Resend with confirm: true to register, set and rebuild.";
      } else {
        changed = rows;
        next = "The inverse is wb_meta set with the before value.";
        if (strs(r.rebuilt).length === 0) {
          warnings.push("the rebuild was not acknowledged within the wait; read the Workbench log");
        }
      }
      break;
    }
    case "create":
    case "prefabFromModel": {
      const savedPath = str(r.savedPath);
      readback = {
        dryRun,
        savedPath,
        saved: truthy(r.saved),
        resourceName: str(r.resourceName) || null,
        guid: str(r.guid) || null,
        message,
      };
      if (dryRun) {
        warnings.push("dry run: nothing was written");
        next = `Resend with confirm: true to ${sentAs === "create" ? "create the file" : "write the prefab"}.`;
      } else {
        changed = [{ path: savedPath || rel, before: null, after: str(r.resourceName) }];
        next = "The new file and its .meta are removed by hand (or by the test harness).";
      }
      break;
    }
    default:
      readback = r;
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── TypeScript-only actions ───────────────────────────────────────────────────

async function runGetInfo(
  client: ResourcesClient,
  p: Extract<Prepared, { kind: "getInfo" }>,
): Promise<ResourcesResponse> {
  const { action, target } = p;
  const warnings: string[] = [];
  if (LIVE_NOTES.GetResourceInfo) warnings.push(LIVE_NOTES.GetResourceInfo);
  warnings.push(MODAL_HAZARD_WARNING);
  let r: Raw;
  try {
    const o = { access: "read" as const, timeout: BI_TIMEOUTS.read };
    // One line, so the census (E11) finds the handler name on the call's own line.
    r = await client.call<Raw>("GetResourceInfo", { path: p.path, expandResource: p.expand }, o);
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    f.warnings = warnings;
    return f;
  }
  if (str(r.status).toLowerCase() === "error") {
    const message = scrubHome(str(r.message)) || "GetResourceInfo answered an error";
    const missing = /not found/i.test(message);
    const f = fail(
      action,
      target,
      missing ? "PATH_NOT_FOUND" : "HANDLER_ERROR",
      message,
      missing
        ? "wb_resources resolve names the file; packed vanilla resources have no .meta on disk (DEC-040)"
        : undefined,
    );
    f.warnings = warnings;
    return f;
  }
  return {
    ok: true,
    action,
    target,
    changed: null,
    readback: {
      resourceName: str(r.resourceName),
      absolutePath: scrubHome(str(r.absolutePath)),
      data: scrubDeep(r.data),
      message: scrubHome(str(r.message)),
    },
    warnings,
  };
}

async function runOpen(
  client: ResourcesClient,
  p: Extract<Prepared, { kind: "open" }>,
): Promise<ResourcesResponse> {
  // The module that owns the file type (owningModule): a .conf, .emat or .layout goes to the
  // Resource Manager, never to the World Editor, which raised a modal for a .conf (W2 run 2).
  const module = owningModule(p.path);
  const routed = await runModule(client as ModuleClient, {
    action: "setResource",
    module,
    target: `path:${p.path}`,
  });
  const note = `routed to wb_module setResource module ${module}: the editor that owns the file type opens it`;
  if (!routed.ok) {
    return { ...routed, action: p.action, target: p.target };
  }
  const inner =
    typeof routed.readback === "object" && routed.readback !== null
      ? (routed.readback as Raw)
      : { value: routed.readback };
  return {
    ...routed,
    action: p.action,
    target: p.target,
    readback: { ...inner, routedTo: "wb_module setResource", module },
    warnings: [...routed.warnings, note],
  };
}

function runLink(p: Extract<Prepared, { kind: "link" }>): ResourcesResponse {
  const link = resolveLink(p.link);
  return {
    ok: true,
    action: p.action,
    target: `path:${link.path}`,
    changed: null,
    readback: { url: link.url, addon: link.addon, path: link.path },
    warnings: [],
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_resources request end to end; never throws for a Workbench-side failure. */
export async function runResources(
  client: ResourcesClient,
  input: unknown,
): Promise<ResourcesResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  switch (prepared.kind) {
    case "getInfo":
      return runGetInfo(client, prepared);
    case "open":
      return runOpen(client, prepared);
    case "link":
      try {
        return runLink(prepared);
      } catch (e) {
        if (e instanceof VocabularyError) {
          return fail(prepared.action, prepared.target, e.code, e.message);
        }
        throw e;
      }
    case "handler": {
      const s = await send(client, prepared);
      if ("error" in s) return s.error;
      return shapeOk(prepared, s.r, [...prepared.warnings]);
    }
  }
}

export function toToolResult(r: ResourcesResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

function flatSchemaFor(type: Contract["actions"][number]["params"][number]["type"]) {
  switch (type) {
    case "bool":
      return z.boolean();
    case "int":
      return z.number().int();
    case "float":
      return z.number();
    case "array<string>":
      return z.array(z.string());
    case "array<int>":
      return z.array(z.number().int());
    default:
      return z.string();
  }
}

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = RESOURCES_CONTRACT): z.ZodRawShape {
  const names = [...c.actions.map((a) => a.name), ...TS_ACTIONS, "browse"] as string[] as [
    string,
    ...string[],
  ];
  const shape: z.ZodRawShape = {
    action: z
      .enum(names)
      .describe(
        "getInfo: BI GetResourceInfo; open: the owning editor; link: build or parse an enfusion:// link; browse: 1.x name of search",
      ),
  };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      const s = flatSchemaFor(p.type);
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  shape.expandResource = z.boolean().optional().describe("getInfo: also read the container");
  shape.addon = z.string().optional().describe("link: addon id (with path)");
  shape.url = z.string().optional().describe("link: an enfusion:// link to parse");
  return shape;
}

export function registerWbResources(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_resources",
    {
      description: wbResourcesDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Resource Manager",
        readOnlyHint: false,
        // Writes create files and .meta files and set import settings; nothing is deleted.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runResources(client, input));
    },
  );
}
