/**
 * `wb_diag`: Diag Menu options by script id and Workbench environment reads through EMCP_WB_Diag
 * (wave W8, phase5-w8-spec.md section 2.4, DEC-076).
 *
 *   catalog  read, paged (`menu`, `cursor`, `limit`): served here from data/census/diag-catalog.json
 *            (written by scripts/census/gen-diag-catalog.ts); nothing is sent to Workbench
 *   get      read: option values by enum name (SCR_DebugMenuID or EDiagMenu)
 *   info     read: user (redacted here), cwd, executable, project, UTC time, script modules,
 *            command-line values of a module
 *   set      one option at runtime (memory only); the caller restores it with `previous`
 *   select   show a Diag Menu page, in play mode only
 *
 * `set` sends only a catalogued name of a known kind that is on policy.json `diag.set_allow_list`
 * (seeded empty, OD-6): NOT_ALLOWLISTED otherwise (a kind `unknown` id is refused whatever the
 * list says); DIAG_UNKNOWN for a name the catalog does not hold. Range and engine kinds are refused
 * UNPROVEN by the handler until probes P-W8-07 and P-W8-08 pass; that answer passes through.
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
  CLASS_NAME,
  ERROR_CODES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  MODULE_IDS,
  VocabularyError,
  checkCursor,
  moduleAllowsRead,
  nextCursor,
  parseCursor,
  type ActionError,
  type ActionOk,
  type ErrorCode,
  type ModuleId,
} from "../manifest/vocabulary.js";
import { censusPaths, readJson } from "../census/ledger-io.js";
import {
  catalogRow,
  filterByMenu,
  findDiagEntry,
  loadDiagCatalog,
  type DiagCatalog,
  type DiagEntry,
} from "../census/diag-catalog.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Diag";
export const TOOL = "wb_diag";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const DIAG_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const DIAG_REQUEST_SCHEMA = buildRequestSchema(DIAG_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbDiagDescription(): string {
  return checkedDescription(DIAG_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = DIAG_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(DIAG_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 30_000;

/** Limits the handler enforces, checked here first so nothing is sent that it refuses. */
export const NAMES_MAX = 300;
export const CMD_NAMES_MAX = 20;
export const NAME_LEN_MAX = 128;
export const VALUE_LEN_MAX = 64;
const MENU_FILTER_MAX = 256;

/** The kinds the handler reads and writes with. */
export const HANDLER_KINDS = ["bool", "value", "range", "engine", "engineRange"] as const;

/** DIAG_UNKNOWN (spec 1.2 rule 10) is in src/manifest/vocabulary.ts since the W8 integration. */
export type DiagCode = ErrorCode;

const CODE_TEXT: Readonly<Record<string, string>> = ERROR_CODES;
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(CODE_TEXT));

/** The switch that opens the catalog and set: the generated catalog file. */
export const CATALOG_SWITCH =
  "data/census/diag-catalog.json, written by npx tsx scripts/census/gen-diag-catalog.ts";
/** The switch that lets set reach the handler for one option. */
export const ALLOW_LIST_SWITCH = "data/census/policy.json diag.set_allow_list";

type Raw = Record<string, unknown>;

export type DiagError = Omit<ActionError, "code"> & { code: DiagCode };
export type DiagResponse = ActionOk | DiagError;

/** The client surface this tool needs (a fake in tests). */
export type DiagClient = Pick<WorkbenchClient, "call">;

/** Injected data sources (tests); the defaults read the census files. */
export interface DiagDeps {
  /** The catalog, or undefined when it has not been generated. May throw on a malformed file. */
  catalog?: () => DiagCatalog | undefined;
  /** The names on policy.json diag.set_allow_list. */
  allowList?: () => string[];
  /** Environment whose USERNAME is redacted from info (default process.env). */
  env?: NodeJS.ProcessEnv;
}

function fail(
  action: string,
  target: string,
  code: DiagCode,
  message: string,
  next?: string,
): DiagError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || CODE_TEXT[code],
    warnings: [],
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ── Policy ────────────────────────────────────────────────────────────────────

/**
 * policy.json `diag.set_allow_list` as enum names; read only. Entries are a name, or an object
 * with `name`. A key the policy does not hold yet is an empty list. The probe pack's
 * `probe_mut.diag_set_allow_list` is a separate list and is not read (DEC-076 OD-6).
 */
export function setAllowListOf(policy: unknown): string[] {
  const list = (policy as { diag?: { set_allow_list?: unknown } } | null)?.diag?.set_allow_list;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const e of list) {
    if (typeof e === "string" && e !== "") out.push(e);
    else if (e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string") {
      out.push((e as { name: string }).name);
    }
  }
  return out;
}

function defaultAllowList(): string[] {
  return setAllowListOf(readJson(censusPaths().policy, null));
}

// ── Redaction ─────────────────────────────────────────────────────────────────

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A string with the Workbench user name, the environment's user name and any `X:\Users\<name>`
 * home prefix left in it replaced. Names shorter than 2 (handler) or 3 (environment) characters
 * are not searched for, so a short name never eats ordinary text.
 */
export function redactUser(
  text: string,
  userName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let out = text.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"]+/gi, "<home-path>");
  const names: string[] = [];
  if (userName.trim().length >= 2) names.push(userName.trim());
  const envUser = env.USERNAME ?? env.USER ?? "";
  if (envUser.length >= 3) names.push(envUser);
  for (const n of names) out = out.replace(new RegExp(escapeRx(n), "gi"), "<user>");
  return out;
}

// ── Request checks ────────────────────────────────────────────────────────────

/** A plain name as the handler takes it: 1 to 128 characters, no whitespace, quote or '='. */
const PLAIN_NAME = /^[^\s"=]{1,128}$/;

const INT_TEXT = /^[+-]?\d{1,10}$/;
const FLOAT_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The handler kinds a catalog kind may be read and written with, the first one the default. */
const KINDS_FOR: Partial<Record<DiagEntry["kind"], readonly string[]>> = {
  bool: ["bool", "value"],
  value: ["value"],
  range: ["range"],
  engine: ["engine", "engineRange"],
};

/** The one-sentence refusal text for a value that does not suit the kind, or undefined. */
export function checkSetValue(kind: string, value: string): string | undefined {
  if (value === "" || value.length > VALUE_LEN_MAX) {
    return `value is required as text of at most ${VALUE_LEN_MAX} characters`;
  }
  if (kind === "bool") {
    return ["0", "1", "true", "false"].includes(value)
      ? undefined
      : `a bool value is 0, 1, true or false, got '${value}'`;
  }
  if (kind === "range" || kind === "engineRange") {
    // The handler refuses a magnitude past 1e9 (an Inf stored in an option raises the BadFloat modal).
    return FLOAT_TEXT.test(value) && Math.abs(Number(value)) <= 1e9
      ? undefined
      : `a ${kind} value is a number within +-1e9 sent as text, got '${value}'`;
  }
  return INT_TEXT.test(value)
    ? undefined
    : `a ${kind} value is an integer sent as text, got '${value}'`;
}

function targetOf(action: string, p: Raw): string {
  switch (action) {
    case "catalog":
      return `diag:catalog${str(p.menu) ? `:${str(p.menu)}` : ""}`;
    case "get": {
      const names = strs(p.names);
      return names.length === 1 ? `diag:${names[0]}` : `diag:${names.length} names`;
    }
    case "info":
      return `module:${str(p.module) || "WorldEditor"}`;
    case "set":
      return `diag:${str(p.name)}`;
    case "select":
      return typeof p.menuId === "number" ? `menuId:${p.menuId}` : `menu:${str(p.menu)}`;
    default:
      return "diag:";
  }
}

/** A checked request: what is sent to the handler (or served here), or the refusal. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: DiagError };

function refuse(
  action: string,
  target: string,
  code: DiagCode,
  message: string,
  next?: string,
): Prepared {
  return { ok: false, error: fail(action, target, code, message, next) };
}

/** The catalog, or the GATED refusal when it is absent or malformed. */
function catalogOr(
  deps: DiagDeps,
  action: string,
  target: string,
): { catalog: DiagCatalog } | { error: DiagError } {
  let catalog: DiagCatalog | undefined;
  try {
    catalog = (deps.catalog ?? loadDiagCatalog)();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: fail(
        action,
        target,
        "GATED",
        `the diag catalog is malformed (${msg}); nothing was sent`,
        `Regenerate it: ${CATALOG_SWITCH}.`,
      ),
    };
  }
  if (!catalog) {
    return {
      error: fail(
        action,
        target,
        "GATED",
        "the diag catalog has not been generated on this install; nothing was sent",
        `It opens with ${CATALOG_SWITCH}.`,
      ),
    };
  }
  return { catalog };
}

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown, deps: DiagDeps = {}): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const target = targetOf(action, raw);
  if (!HANDLER_ACTIONS.includes(action)) {
    return refuse(
      action,
      target,
      "INVALID_ARGUMENT",
      `unknown action '${action}'; one of ${HANDLER_ACTIONS.join(", ")}`,
    );
  }
  const parsed = DIAG_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return refuse(action, target, "INVALID_ARGUMENT", issues.join("; "));
  }
  const req = parsed.data as Raw;
  const mutating = MUTATING.has(action);
  const params: Raw = { ...req };

  switch (action) {
    case "catalog": {
      if (
        req.limit !== undefined &&
        ((req.limit as number) < 1 || (req.limit as number) > LIMIT_MAX)
      ) {
        return refuse(action, target, "INVALID_ARGUMENT", `limit must be 1 to ${LIMIT_MAX}`);
      }
      if (str(req.menu).length > MENU_FILTER_MAX) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `menu is at most ${MENU_FILTER_MAX} characters`,
        );
      }
      if (typeof req.cursor === "string" && req.cursor !== "") {
        try {
          parseCursor(req.cursor);
        } catch (e) {
          if (e instanceof VocabularyError) return refuse(action, target, e.code, e.message);
          throw e;
        }
      }
      break;
    }
    case "get": {
      const names = strs(req.names);
      if (names.length === 0) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          "names is required (wb_diag catalog lists them)",
        );
      }
      if (names.length > NAMES_MAX) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `${names.length} names; at most ${NAMES_MAX}`,
        );
      }
      const bad = names.find((n) => !CLASS_NAME.test(n));
      if (bad !== undefined) {
        return refuse(action, target, "INVALID_ARGUMENT", `'${bad}' is not an enum name`);
      }
      const kinds = strs(req.kinds);
      if (kinds.length > 1 && kinds.length !== names.length) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `kinds holds ${kinds.length} entries for ${names.length} names: pass one kind for all, or one per name`,
        );
      }
      const badKind = kinds.find(
        (k) => k !== "" && !(HANDLER_KINDS as readonly string[]).includes(k),
      );
      if (badKind !== undefined) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `kind must be one of ${HANDLER_KINDS.join(", ")}, got '${badKind}'`,
        );
      }
      break;
    }
    case "info": {
      const module = str(req.module) || "WorldEditor";
      if (
        !(MODULE_IDS as readonly string[]).includes(module) ||
        !moduleAllowsRead(module as ModuleId)
      ) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `module must be one of ${MODULE_IDS.filter((m) => moduleAllowsRead(m)).join(", ")}; got '${module}'`,
        );
      }
      const cmdNames = strs(req.cmdNames);
      if (cmdNames.length > CMD_NAMES_MAX) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `${cmdNames.length} cmdNames; at most ${CMD_NAMES_MAX}`,
        );
      }
      const badCmd = cmdNames.find((n) => !PLAIN_NAME.test(n));
      if (badCmd !== undefined) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `a cmdNames entry is a bare parameter name (no space, quote or '='), got '${badCmd}'`,
        );
      }
      break;
    }
    case "set": {
      const name = str(req.name);
      if (!CLASS_NAME.test(name)) {
        return refuse(action, target, "INVALID_ARGUMENT", `'${name}' is not an enum name`);
      }
      const c = catalogOr(deps, action, target);
      if ("error" in c) return { ok: false, error: c.error };
      const entry = findDiagEntry(c.catalog, name);
      if (!entry) {
        return refuse(
          action,
          target,
          "DIAG_UNKNOWN",
          `'${name}' is no SCR_DebugMenuID or EDiagMenu value in the diag catalog; nothing was sent`,
        );
      }
      if (entry.kind === "menu") {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `${name} is a menu, not an option; nothing was sent`,
          "wb_diag select shows a menu page (play mode only).",
        );
      }
      const allowed = KINDS_FOR[entry.kind];
      if (!allowed) {
        return refuse(
          action,
          target,
          "NOT_ALLOWLISTED",
          `${name} has kind unknown (no DiagMenu.Register* call found in the game scripts, or calls of different kinds); set refuses it whatever the allow-list says`,
        );
      }
      const kind = str(req.kind) || allowed[0];
      if (!allowed.includes(kind)) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `${name} is registered as ${entry.kind}; its kind is ${allowed.join(" or ")}, not '${kind}'`,
        );
      }
      const why = checkSetValue(kind, str(req.value));
      if (why) return refuse(action, target, "INVALID_ARGUMENT", why);
      const list = (deps.allowList ?? defaultAllowList)();
      if (!list.includes(name)) {
        return refuse(
          action,
          target,
          "NOT_ALLOWLISTED",
          `${name} is not on the diag set allow-list (${list.length} entries); nothing was sent`,
          `An option is added to ${ALLOW_LIST_SWITCH} only from probe P-W8-07's evidence.`,
        );
      }
      params.kind = kind;
      break;
    }
    case "select": {
      const hasMenu = typeof req.menu === "string" && req.menu !== "";
      const hasId = typeof req.menuId === "number";
      if (hasMenu === hasId) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          "pass exactly one of menu (a registered menu name) and menuId (a SCR_DebugMenuID value)",
        );
      }
      if (hasId && (req.menuId as number) < 0) {
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          "menuId is a SCR_DebugMenuID value (0 or more)",
        );
      }
      if (hasMenu && !PLAIN_NAME.test(str(req.menu))) {
        let next: string | undefined;
        try {
          const catalog = (deps.catalog ?? loadDiagCatalog)();
          const hit = catalog?.entries.find(
            (e) => e.kind === "menu" && e.label === str(req.menu) && e.id !== null,
          );
          if (hit) next = `Pass menuId ${hit.id} (${hit.enumName}) instead.`;
        } catch {
          // a malformed catalog only loses the hint
        }
        return refuse(
          action,
          target,
          "INVALID_ARGUMENT",
          `menu must be a name of at most ${NAME_LEN_MAX} characters with no space, quote or '=': the handler refuses '${str(req.menu)}'`,
          next ?? "Pass menuId, the SCR_DebugMenuID value of the menu.",
        );
      }
      break;
    }
  }
  return { ok: true, action, target, mutating, params };
}

// ── Catalog (served here) ─────────────────────────────────────────────────────

function serveCatalog(params: Raw, target: string, deps: DiagDeps): DiagResponse {
  const c = catalogOr(deps, "catalog", target);
  if ("error" in c) return c.error;
  const menu = str(params.menu);
  const rows = filterByMenu(c.catalog.entries, menu);
  const total = rows.length;
  const limit = typeof params.limit === "number" ? params.limit : LIMIT_DEFAULT;
  let start = 0;
  const cursor = str(params.cursor);
  if (cursor !== "") {
    try {
      const parsed = parseCursor(cursor);
      checkCursor(parsed, total);
      start = parsed.start;
    } catch (e) {
      if (e instanceof VocabularyError) return fail("catalog", target, e.code, e.message);
      throw e;
    }
  }
  const page = rows.slice(start, start + limit);
  const after = nextCursor(start, limit, total) ?? null;
  const warnings: string[] = [];
  const guarded = page.filter((e) => e.guard !== "");
  for (const e of guarded) {
    warnings.push(
      `${e.enumName} is declared under #ifdef ${e.guard} (${e.declared}); it exists only in a build that defines it`,
    );
  }
  if (total === 0) {
    warnings.push(
      menu ? `no catalogued path lies under '${menu}'` : "the catalog holds no entries",
    );
  }
  const ok: ActionOk = {
    ok: true,
    action: "catalog",
    target,
    changed: null,
    readback: {
      build: c.catalog.build,
      total,
      nextCursor: after,
      columns: ["path", "enumName", "kind", "values"],
      rows: page.map(catalogRow),
    },
    warnings,
  };
  ok.next = after
    ? `wb_diag catalog with cursor "${after}" for the next page`
    : "wb_diag get reads values by enumName; kind unknown and menu ids are never set";
  return ok;
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a DiagError, else null. */
function handlerFailure(action: string, target: string, r: Raw): DiagError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: DiagCode = status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT";
    const code = (KNOWN_CODES.has(raw) ? raw : fallback) as DiagCode;
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
  client: DiagClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: DiagError }> {
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
        action === "set"
          ? `The call was lost and is never retried; read the option back with wb_diag get names ["${str(params.name)}"] first.`
          : "The call was lost and is never retried; check the game view before calling again.";
    }
    return { error: f };
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/** Splits "key=value" lines at the first "="; a line without one has an empty value. */
export function splitPairs(lines: string[]): Array<[string, string]> {
  return lines.map((line) => {
    const eq = line.indexOf("=");
    return eq < 0 ? [line, ""] : [line.slice(0, eq), line.slice(eq + 1)];
  });
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(action: string, target: string, params: Raw, r: Raw, deps: DiagDeps): ActionOk {
  const warnings: string[] = [];
  let changed: ActionOk["changed"] = null;
  let readback: Raw;
  let next: string | undefined;
  const message = str(r.message);
  switch (action) {
    case "get": {
      const values = splitPairs(strs(r.values)).map(([name, value]) => ({ name, value }));
      const missing = strs(r.missing);
      readback = { values, missing, gameMode: truthy(r.gameMode), message };
      if (missing.length > 0) warnings.push(`no enum value for: ${missing.join(", ")}`);
      next = "wb_diag set changes one allow-listed option; restore it with its previous value";
      break;
    }
    case "info": {
      const env = deps.env ?? process.env;
      const rawUser = str(r.userName);
      const scrub = (s: string) => redactUser(s, rawUser, env);
      const modules: Record<string, boolean> = {};
      for (const [k, v] of splitPairs(strs(r.scriptModules))) modules[k] = truthy(v);
      const cmdLine: Record<string, string> = {};
      for (const [k, v] of splitPairs(strs(r.cmdLine))) cmdLine[k] = scrub(v);
      readback = {
        // The Workbench user name never leaves this tool (spec 2.4): only whether one was read.
        userName: rawUser === "" ? "" : "<user>",
        cwd: scrub(str(r.cwd)),
        executable: scrub(str(r.executable)),
        projectFile: scrub(str(r.projectFile)),
        projectSettingsClass: str(r.projectSettingsClass),
        utcTime: str(r.utcTime),
        scriptModules: modules,
        cmdLine,
        gameMode: truthy(r.gameMode),
        message: scrub(message),
      };
      const asked = strs(params.cmdNames);
      const absent = asked.filter((n) => !(n in cmdLine));
      if (absent.length > 0)
        warnings.push(`not on the module's command line: ${absent.join(", ")}`);
      break;
    }
    case "set": {
      const previous = str(r.previous);
      const after = str(r.readback);
      const didChange = truthy(r.changed);
      // applied: the handler compared the read-back with the asked value as numbers (review round
      // 1, W8-DIAG-01); null from a handler that does not answer it.
      const applied = r.applied === undefined ? null : truthy(r.applied);
      readback = {
        name: str(params.name),
        kind: str(params.kind),
        previous,
        readback: after,
        changed: didChange,
        applied,
        gameMode: truthy(r.gameMode),
        message,
      };
      if (previous !== after) {
        changed = [{ path: `diag.${str(params.name)}`, before: previous, after }];
      }
      if (!didChange) warnings.push("the value read back equals the value before");
      if (applied === false) {
        warnings.push(
          `the value read back (${after}) is not the value asked for (${str(params.value)}): the engine clamped or ignored it`,
        );
      }
      next = `Runtime only. Restore with wb_diag set name ${str(params.name)} kind ${str(params.kind)} value "${previous}".`;
      break;
    }
    case "select": {
      readback = { selected: str(r.selected), message };
      next = "The engine answers no result: check the game view (wb_gui screenshot).";
      break;
    }
    default:
      readback = { ...r };
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_diag request end to end; never throws for a Workbench-side failure. */
export async function runDiag(
  client: DiagClient,
  input: unknown,
  deps: DiagDeps = {},
): Promise<DiagResponse> {
  const prepared = prepareRequest(input, deps);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  if (action === "catalog") return serveCatalog(params, target, deps);
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r, deps);
}

export function toToolResult(r: DiagResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = DIAG_CONTRACT): z.ZodRawShape {
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

export function registerWbDiag(
  server: McpServer,
  client: WorkbenchClient,
  deps: DiagDeps = {},
): void {
  server.registerTool(
    "wb_diag",
    {
      description: wbDiagDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Diag Menu and Workbench environment",
        readOnlyHint: false,
        // set changes one allow-listed option in memory only (the caller restores it with
        // `previous`); select shows a menu page. Nothing is written to disk.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runDiag(client, input, deps));
    },
  );
}
