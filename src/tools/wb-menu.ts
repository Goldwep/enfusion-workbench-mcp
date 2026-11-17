/**
 * `wb_menu`: the Workbench menu items of the census ledger, and a guarded way to press one
 * (wave W8, phase5-w8-spec.md section 2.5, DEC-076 OD-1).
 *
 *   list      read, paged (`cursor`, `limit`): the ledger's menu items, optionally of one `module`:
 *             path, risk, verified, allowListed, opensDialog. Nothing is sent to Workbench.
 *   describe  read: one item (`module`, `path`), the same five fields.
 *   run       one item through the existing EMCP_WB_ExecuteAction handler (the shared run path of
 *             wb-execute-action.ts, which this tool and the wb_execute_action alias both use).
 *
 * `path` is the menu path, one comma between segments (the form ExecuteAction takes).
 * `verified` is the ledger's own word: the row's execute-action path is marked verified. `run`
 * does not wait for it: it needs the path on the allow-list the handler pack carries
 * (EMCP_WB_ActionAllowList.c, generated from the policy and filled from probe P-W8-22). It also
 * refuses a path with a denied word or label, a destructive, external or credential item
 * (NOT_ALLOWLISTED), and an item that opens a dialog (MODAL_HAZARD: the label ends in "..."). A
 * mutating item, or one the ledger does not know, is a dry run unless `confirm: true`. The
 * handler drives the World Editor only. Every refusal is raised before anything is sent. If the
 * allow-list file cannot be read, every run is refused (fail closed).
 *
 * The handler has no passive open check (GetModule opens a closed module), so MODULE_NOT_OPEN is
 * the handler's own "module not available" answer. Not registered here: src/server.ts registers
 * it. Nothing here names a sandbox or a project.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { compareCodeUnits } from "../census/canon.js";
import {
  censusPaths,
  DEFAULT_CENSUS_ROOT,
  ledgerMissing,
  loadLedger,
} from "../census/ledger-io.js";
import type { Row } from "../census/schemas.js";
import type { WorkbenchClient } from "../workbench/client.js";
import {
  ERROR_CODES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  MODULE_SCHEMA,
  VocabularyError,
  checkCursor,
  errorResponse,
  nextCursor,
  parseCursor,
  type ActionError,
  type ActionOk,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { codeOfClientError } from "./wb-module.js";
import { isBlockedMenuPath, normalizeMenuPath } from "./wb-execute-action.js";

export const MENU_ACTIONS = ["list", "describe", "run"] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** Risks the tool never presses, listed or not. */
const REFUSED_RISKS: readonly string[] = ["destructive", "external", "credential"];

const MODULE_NAME = "WorldEditor";

/**
 * The handler run sends to (the same call as callExecuteAction in wb-execute-action.ts). Named in
 * this file so the census inventory (E11) links `wb_menu run` to it.
 */
const EXECUTE_ACTION = "EMCP_WB_ExecuteAction";

export type MenuError = ActionError;
export type MenuResponse = ActionOk | MenuError;

/** The client surface this tool needs (a fake in tests); `state` is read when the client has one. */
export type MenuClient = Pick<WorkbenchClient, "call"> & {
  state?: { mode?: string };
};

export interface MenuArgs {
  action: MenuAction;
  module?: string;
  path?: string;
  cursor?: string;
  limit?: number;
  confirm?: boolean;
}

/** One menu item of the ledger. */
export interface MenuItem {
  module: string;
  /** Segments joined by a comma. */
  path: string;
  segments: string[];
  risk: string;
  verified: boolean;
  opensDialog: boolean;
}

/** The allow-list pack: the paths that may run and the words and labels that stay refused. */
export interface AllowListPack {
  /** Each path as its segments. */
  paths: string[][];
  denyLabels: string[];
  denyWords: string[];
}

/** What the tool reads: injectable so a test needs no ledger and no .c file. */
export interface MenuDeps {
  items(): MenuItem[];
  allowList(): AllowListPack;
}

// ── Ledger rows ───────────────────────────────────────────────────────────────

/** True when a label opens a dialog: the Qt convention of a trailing ellipsis. */
export function opensDialog(label: string): boolean {
  const t = label.trim();
  return t.endsWith("...") || t.endsWith("…");
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The menu path segments of a menu-item row: the locator's menuPath, else the id's tail. */
export function segmentsOf(row: Row): string[] {
  const locator = row.locator?.menuPath;
  if (Array.isArray(locator) && locator.length > 0) return locator.map((s) => String(s).trim());
  const marker = "/menu-item/";
  const at = row.id.indexOf(marker);
  if (at < 0) return [];
  return row.id
    .slice(at + marker.length)
    .split("/")
    .map((s) => decodeSegment(s).trim())
    .filter((s) => s.length > 0);
}

/** The menu items of the ledger rows (kind menu-item), sorted by module then path, one per pair. */
export function buildMenuItems(rows: readonly Row[]): MenuItem[] {
  const out = new Map<string, MenuItem>();
  for (const row of rows) {
    if (row.kind !== "menu-item") continue;
    const segments = segmentsOf(row);
    if (segments.length === 0) continue;
    const path = segments.join(",");
    const key = `${row.module}\u0000${path}`;
    if (out.has(key)) continue;
    const label = segments[segments.length - 1] as string;
    out.set(key, {
      module: String(row.module),
      path,
      segments,
      risk: String(row.risk),
      verified: (row.paths ?? []).some(
        (p) => p.path === "execute-action" && p.status === "verified",
      ),
      opensDialog: opensDialog(label),
    });
  }
  return [...out.values()].sort(
    (a, b) => compareCodeUnits(a.module, b.module) || compareCodeUnits(a.path, b.path),
  );
}

// ── Allow-list pack (the generated .c file) ───────────────────────────────────

/** mod/ sits two levels above both src/tools and dist/tools. */
export const ALLOW_LIST_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "mod",
  "Scripts",
  "WorkbenchGame",
  "EnfusionMCP",
  "EMCP_WB_ActionAllowList.c",
);

function insertsOf(source: string, method: string): string[] {
  const start = source.indexOf(`static void ${method}(`);
  if (start < 0) return [];
  const open = source.indexOf("{", start);
  const close = source.indexOf("\n\t}", open);
  const body = source.slice(open, close < 0 ? undefined : close);
  const out: string[] = [];
  for (const m of body.matchAll(/\.Insert\("((?:[^"\\]|\\.)*)"\)/g)) {
    out.push((m[1] as string).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1"));
  }
  return out;
}

/** Reads the three lists out of the text of EMCP_WB_ActionAllowList.c. */
export function parseAllowListSource(source: string): AllowListPack {
  return {
    paths: insertsOf(source, "Paths").map((p) => p.split("\n")),
    denyLabels: insertsOf(source, "DenyLabels"),
    denyWords: insertsOf(source, "DenyWords"),
  };
}

/** Reads the pack from disk; an unreadable file gives an empty pack (every run refuses). */
export function loadAllowListFile(file: string = ALLOW_LIST_FILE): AllowListPack {
  try {
    return parseAllowListSource(readFileSync(file, "utf-8"));
  } catch {
    return { paths: [], denyLabels: [], denyWords: [] };
  }
}

function wordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/** True when `needle` occurs in `hay` as a run of consecutive words. */
function holdsRun(hay: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/** The denied label or word a path's segment holds, else null. Labels with ":" are the probe pack's confirm tokens and are not read here. */
export function deniedBy(pack: AllowListPack, segments: readonly string[]): string | null {
  for (const seg of segments) {
    const words = wordsOf(seg);
    for (const label of pack.denyLabels) {
      if (label.includes(":")) continue;
      if (holdsRun(words, wordsOf(label))) return label;
    }
    for (const w of pack.denyWords) {
      if (words.includes(w.toLowerCase())) return w;
    }
  }
  return null;
}

/** True when the path is listed (segments match exactly: no case folding, no mnemonic stripping). */
export function isAllowListed(pack: AllowListPack, segments: readonly string[]): boolean {
  return pack.paths.some(
    (p) => p.length === segments.length && p.every((s, i) => s === segments[i]),
  );
}

/**
 * Why `run` would refuse a menu-item row before sending it, in the order `doRun` checks, or null
 * when it would send it (the World Editor must still be open and in edit mode). Read by
 * `wb_census howto` and the cold-test answer key, so neither names `run` for an item it refuses.
 */
export function runRefusal(row: Row, pack: AllowListPack): string | null {
  const segments = normalizeMenuPath(segmentsOf(row).join(",")).split(",").filter(Boolean);
  if (segments.length === 0) return "no menu path recorded";
  if (isBlockedMenuPath(segments.join(","))) return "a destructive menu path";
  if (!isAllowListed(pack, segments)) return "not on the run allow-list (P-W8-22)";
  const denied = deniedBy(pack, segments);
  if (denied) return `it holds the denied word or label '${denied}'`;
  if (opensDialog(segments[segments.length - 1] as string)) return "it opens a dialog";
  if (REFUSED_RISKS.includes(String(row.risk))) return `risk ${row.risk}`;
  if (row.module !== MODULE_NAME) return `the handler drives the ${MODULE_NAME} only`;
  return null;
}

// ── Default deps (ledger cached until a file changes) ─────────────────────────

let cache: { signature: string; items: MenuItem[] } | null = null;

function signatureOf(root: string): string {
  const paths = censusPaths(root);
  return [paths.meta, ...Object.values(paths.shards)]
    .map((f) => {
      if (!existsSync(f)) return "-";
      const s = statSync(f);
      return `${s.size}:${s.mtimeMs}`;
    })
    .join("|");
}

/** The menu items of the census under `root`; empty when no ledger exists. */
export function loadMenuItems(root: string = DEFAULT_CENSUS_ROOT): MenuItem[] {
  const paths = censusPaths(root);
  if (ledgerMissing(paths)) return [];
  const signature = `${paths.root}|${signatureOf(root)}`;
  if (cache && cache.signature === signature) return cache.items;
  const items = buildMenuItems(loadLedger(paths).rows);
  cache = { signature, items };
  return items;
}

export function defaultDeps(): MenuDeps {
  return { items: () => loadMenuItems(), allowList: () => loadAllowListFile() };
}

// ── Responses ─────────────────────────────────────────────────────────────────

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): MenuError {
  return errorResponse(action, target, code, message, next || ERROR_CODES[code]);
}

function view(item: MenuItem, pack: AllowListPack) {
  return {
    module: item.module,
    path: item.path,
    risk: item.risk,
    verified: item.verified,
    allowListed: isAllowListed(pack, item.segments),
    opensDialog: item.opensDialog,
  };
}

function targetOf(args: MenuArgs): string {
  return args.path ? `menu:${args.module ?? "-"}:${normalizeMenuPath(args.path)}` : "menu";
}

function doList(args: MenuArgs, deps: MenuDeps): MenuResponse {
  const pack = deps.allowList();
  const all = deps.items().filter((i) => !args.module || i.module === args.module);
  const total = all.length;
  const limit = args.limit ?? LIMIT_DEFAULT;
  let start = 0;
  if (args.cursor !== undefined) {
    const c = parseCursor(args.cursor);
    checkCursor(c, total);
    start = c.start;
  }
  const items = all.slice(start, start + limit).map((i) => view(i, pack));
  const next = nextCursor(start, limit, total);
  const ok: ActionOk = {
    ok: true,
    action: "list",
    target: args.module ? `menu:${args.module}` : "menu",
    changed: null,
    readback: { total, nextCursor: next ?? null, items },
    warnings:
      total === 0
        ? ["no menu items: the census ledger has none for this module or is missing"]
        : [],
  };
  if (next) ok.next = `wb_menu list with cursor ${next}`;
  return ok;
}

function findItem(args: MenuArgs, deps: MenuDeps, segments: string[]): MenuItem | undefined {
  const path = segments.join(",");
  return deps.items().find((i) => i.module === args.module && i.path === path);
}

function doDescribe(args: MenuArgs, deps: MenuDeps): MenuResponse {
  const target = targetOf(args);
  if (!args.module) return fail("describe", target, "INVALID_ARGUMENT", "describe needs module");
  if (!args.path) return fail("describe", target, "INVALID_ARGUMENT", "describe needs path");
  const segments = normalizeMenuPath(args.path).split(",").filter(Boolean);
  const item = findItem(args, deps, segments);
  if (!item) {
    return fail(
      "describe",
      target,
      "INVALID_ARGUMENT",
      `no menu item ${segments.join(",")} of ${args.module} in the ledger`,
      "wb_menu list module <module> and use a path it answers",
    );
  }
  const pack = deps.allowList();
  const v = view(item, pack);
  const denied = deniedBy(pack, item.segments);
  return {
    ok: true,
    action: "describe",
    target,
    changed: null,
    readback: { ...v, deniedBy: denied },
    warnings: [],
  };
}

/** Maps the handler's answer to a response. */
function shapeRun(target: string, path: string, r: Record<string, unknown>): MenuResponse {
  const status = typeof r.status === "string" ? r.status : "";
  const message = typeof r.message === "string" ? r.message : "";
  if (status === "refused") {
    const raw = typeof r.code === "string" ? r.code : "";
    const code = (raw in ERROR_CODES ? raw : "HANDLER_ERROR") as ErrorCode;
    const next = typeof r.nextStep === "string" && r.nextStep ? r.nextStep : undefined;
    return fail("run", target, code, message || `${raw} refusal`, next);
  }
  if (status === "error") {
    if (/not available/i.test(message)) {
      return fail("run", target, "MODULE_NOT_OPEN", message);
    }
    if (/returned false/i.test(message)) {
      return fail(
        "run",
        target,
        "ENGINE_FALSE",
        message,
        "The engine answered false; the path may be wrong or unavailable in this mode. Nothing is known to have run.",
      );
    }
    return fail("run", target, "HANDLER_ERROR", message || "the handler answered an error");
  }
  return {
    ok: true,
    action: "run",
    target,
    changed: null,
    readback: { ran: true, path },
    warnings: [
      "ExecuteAction answers only true or false; what the menu item changed is not read back",
    ],
  };
}

/** What the run checks decided: a refusal, a dry run, or send. */
export type MenuRunGate =
  | { kind: "refuse"; code: ErrorCode; message: string; next?: string }
  | { kind: "dryRun"; risk: string; warning: string }
  | { kind: "send"; risk: string };

/**
 * The checks a menu press passes before anything is sent, in order: a destructive path, the
 * allow-list, a denied word or label, a dialog (MODAL_HAZARD), a refused risk, a comma in a
 * segment, `onlyModule` (wb_menu's handler drives the World Editor only), play or unknown mode
 * for a World Editor item (WRONG_MODE), then a dry run for an item that is not safe unless `confirm`. wb_menu run and
 * wb_module action both run it (live-tools-b-1), so neither is a side door around the other.
 */
export function menuRunGate(
  client: MenuClient,
  module: string,
  segments: readonly string[],
  confirm: boolean | undefined,
  deps: MenuDeps,
  onlyModule?: string,
): MenuRunGate {
  const normalized = segments.join(",");
  const pack = deps.allowList();
  const refuse = (code: ErrorCode, message: string, next?: string): MenuRunGate => ({
    kind: "refuse",
    code,
    message,
    ...(next ? { next } : {}),
  });
  if (isBlockedMenuPath(normalized)) {
    return refuse(
      "NOT_ALLOWLISTED",
      `${normalized} is a destructive menu path; it is never driven by a tool`,
      "perform it by hand in Workbench",
    );
  }
  if (!isAllowListed(pack, segments)) {
    return refuse(
      "NOT_ALLOWLISTED",
      pack.paths.length === 0
        ? "the allow-list holds no path (or its file could not be read); nothing may run"
        : `${normalized} is not on the allow-list; nothing was sent`,
      "wb_menu list shows allowListed per item",
    );
  }
  const denied = deniedBy(pack, segments);
  if (denied) {
    return refuse(
      "NOT_ALLOWLISTED",
      `${normalized} holds the denied word or label '${denied}'; it is refused even when listed`,
    );
  }
  const item = deps.items().find((i) => i.module === module && i.path === normalized);
  const label = segments[segments.length - 1] as string;
  if (opensDialog(label) || item?.opensDialog) {
    return refuse(
      "MODAL_HAZARD",
      `${normalized} opens a dialog; nothing was sent`,
      "press it by hand in Workbench",
    );
  }
  const risk = item?.risk ?? "unknown";
  if (REFUSED_RISKS.includes(risk)) {
    return refuse(
      "NOT_ALLOWLISTED",
      `${normalized} has risk ${risk}; such an item is never run by this tool`,
      "perform it by hand in Workbench",
    );
  }
  if (segments.some((s) => s.includes(","))) {
    return refuse("INVALID_ARGUMENT", "a segment holds a comma; the wire cannot carry it");
  }
  if (onlyModule && module !== onlyModule) {
    return refuse(
      "MODULE_NOT_SUPPORTED",
      `the ExecuteAction handler drives the ${onlyModule} only, not ${module}`,
      "use a World Editor menu item",
    );
  }
  // The mode is the World Editor's (edit or play), so only a World Editor item checks it: an
  // Edit > Undo of the Script Editor or the String Editor does not edit the world, and W3 drives
  // it with no world open, while the mode reads unknown (W3 a1 regression of P-W3-06/10/14).
  const mode = module === MODULE_NAME ? client.state?.mode : undefined;
  if (mode === "play" || mode === "unknown") {
    return refuse(
      "WRONG_MODE",
      mode === "play"
        ? "the World Editor is in play mode; a menu item runs in edit mode only"
        : "the Workbench mode is unknown; read it first (wb_state)",
    );
  }
  if (risk !== "safe" && confirm !== true) {
    return {
      kind: "dryRun",
      risk,
      warning: `dry run: ${risk === "unknown" ? "the ledger does not know this item, so it is treated as mutating" : "the item is mutating"}; nothing was sent`,
    };
  }
  return { kind: "send", risk };
}

async function doRun(client: MenuClient, args: MenuArgs, deps: MenuDeps): Promise<MenuResponse> {
  const target = targetOf(args);
  if (!args.module) return fail("run", target, "INVALID_ARGUMENT", "run needs module");
  if (!args.path) return fail("run", target, "INVALID_ARGUMENT", "run needs path");
  const normalized = normalizeMenuPath(args.path);
  const segments = normalized.split(",").filter(Boolean);
  if (segments.length === 0) {
    return fail("run", target, "INVALID_ARGUMENT", "path is empty after normalization");
  }
  const gate = menuRunGate(client, args.module, segments, args.confirm, deps, MODULE_NAME);
  if (gate.kind === "refuse") return fail("run", target, gate.code, gate.message, gate.next);
  if (gate.kind === "dryRun") {
    return {
      ok: true,
      action: "run",
      target,
      changed: null,
      readback: { dryRun: true, ran: false, path: normalized, risk: gate.risk },
      warnings: [gate.warning],
      next: `wb_menu run module ${args.module} path ${normalized} with confirm: true presses it`,
    };
  }

  try {
    const r = await client.call<Record<string, unknown>>(EXECUTE_ACTION, { menuPath: normalized });
    return shapeRun(target, normalized, r);
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail("run", target, c.code, c.message);
    if (c.code === "LOST") {
      f.next = "The call was lost and is never retried; read back the state before any retry.";
    }
    return f;
  }
}

/** Runs one action; never throws. */
export async function runMenu(
  client: MenuClient,
  args: MenuArgs,
  deps: MenuDeps = defaultDeps(),
): Promise<MenuResponse> {
  try {
    if (args.action === "list") return doList(args, deps);
    if (args.action === "describe") return doDescribe(args, deps);
    return await doRun(client, args, deps);
  } catch (e) {
    if (e instanceof VocabularyError) return fail(args.action, targetOf(args), e.code, e.message);
    const c = codeOfClientError(e);
    return fail(args.action, targetOf(args), c.code, c.message);
  }
}

export function toToolResult(r: MenuResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

export const WB_MENU_DESCRIPTION =
  "Workbench menu items from the census ledger. list and describe page them (read only): path, risk, verified, allowListed, opensDialog. run presses one via ExecuteAction, only if on the allow-list; a dialog or risk item refuses, a mutating one is a dry run unless confirm: true. The module must be open.";

export const WB_MENU_INPUT = {
  action: z.enum(MENU_ACTIONS),
  module: MODULE_SCHEMA.optional().describe("list: filter; describe and run: required"),
  path: z.string().optional().describe("describe, run: comma-separated menu path"),
  cursor: z.string().optional().describe("list: nextCursor"),
  limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe("list: default 100"),
  confirm: z.boolean().optional().describe("run: press a mutating item; else a dry run"),
};

export function registerWbMenu(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_menu",
    {
      description: WB_MENU_DESCRIPTION,
      inputSchema: WB_MENU_INPUT,
      annotations: {
        title: "Workbench menu items",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => toToolResult(await runMenu(client, args as MenuArgs)),
  );
}
