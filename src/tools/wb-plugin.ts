/**
 * `wb_plugin` — Workbench plugins (design section 2; DEC-048 package 3.3; W6 spec 2.1, DEC-069).
 *
 *   list         the plugin catalog from the census ledger (E03: plugins and tools, with the
 *                module and the modal classification), paged; no Workbench call
 *   describe     EMCP_WB_Plugin: is the class present, does the open module's GetPlugin return an
 *                instance (U10, DEC-042); access "read". The TS side adds from the catalog and the
 *                policy: verdict (E03), runnable (on the run allow-list) and focusWarning.
 *   getSettings  EMCP_WB_Plugin: the instance's variables, paged; access "read"
 *   setSettings  {name, value, confirm}: a dry run (previous value, what would be written) unless
 *                confirm; the handler answers NO_SETTER for a confirmed write until probe P-W6-03
 *                finds a setter; access "mutate", project guard in the handler
 *   run          {confirm}: Run() of a class on the run allow-list (policy plugin_run_allow_list,
 *                read only); a class the catalog marks modal is PLUGIN_MODAL; the handler checks the
 *                preconditions (PRECONDITION_UNMET) and answers GATED for a confirmed run of a class
 *                probe P-W6-05 has not proven (the switch is the handler's RunProven, not a TS flag);
 *                access "mutate". No method parameter; RunCommandline and Configure are never called.
 *
 * Only a module and class on the matching allow-list (data/census/policy.json: describe, getSettings
 * and setSettings use plugin_read_allow_list, run uses plugin_run_allow_list) is sent; anything else
 * is NOT_ALLOWLISTED here and again in Enforce. Every refusal is raised before anything is sent.
 * The schema and description come from contracts/EMCP_WB_Plugin.json.
 * Registered in src/server.ts (tier core, src/manifest/tiers.ts).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  MODULE_IDS,
  moduleAllowsRead,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
  type ModuleId,
} from "../manifest/vocabulary.js";
import {
  censusPaths,
  DEFAULT_CENSUS_ROOT,
  ledgerMissing,
  loadLedger,
  readJson,
} from "../census/ledger-io.js";

export const HANDLER = "EMCP_WB_Plugin";
export const CONTRACT_FILE = join(DEFAULT_CENSUS_ROOT, "..", "..", "contracts", `${HANDLER}.json`);

/** The entry points never called; pinned against the Enforce text by a test. */
export const NEVER_CALLED = "RunCommandline and Configure are never called";
/** U10 (DEC-042): GetPlugin brought the module window to the front for 1 of 3 plugins. */
export const FOCUS_WARNING =
  "GetPlugin may bring the module window to the front (DEC-042 U10: 1 of 3 plugins)";

/** Every code this tool answers (W6 adds PLUGIN_MODAL, PRECONDITION_UNMET and NO_SETTER). */
export type PluginErrorCode = ErrorCode;

function isPluginCode(c: string): c is PluginErrorCode {
  return Object.hasOwn(ERROR_CODES, c);
}

export type PluginError = Omit<ActionError, "code"> & { code: PluginErrorCode };
type Raw = Record<string, unknown>;
export type PluginResponse = ActionOk | PluginError;

// ── Catalog (census ledger) ───────────────────────────────────────────────────

export interface CatalogRow {
  id: string;
  className: string;
  kind: "plugin" | "tool";
  module: string;
  label: string;
  /** E03's modal classification: "opens", "none", or "unknown" when E03 did not classify it. */
  modal: string;
  /**
   * E03's run verdict (modal, no-run, safe, effects, exits, unknown). A ledger row carries it as
   * `verdict` when the integrator stores it; today a row has only `modal`, so modal "opens" reads
   * "modal" and every other row reads "unknown".
   */
  verdict: string;
  risk: string;
}

interface LedgerLike {
  id: string;
  dim?: string;
  kind?: string;
  module?: string | null;
  label?: string;
  class_name?: string;
  modal?: string;
  verdict?: string;
  risk?: string;
  sources?: Array<{ enumerator?: string }>;
}

/** The ledger's E03 plugin and tool rows, sorted by id. */
export function catalogRows(rows: readonly LedgerLike[]): CatalogRow[] {
  return rows
    .filter(
      (r) =>
        r.dim === "plugin" &&
        (r.kind === "plugin" || r.kind === "tool") &&
        (r.sources ?? []).some((s) => s.enumerator === "E03"),
    )
    .map((r) => ({
      id: r.id,
      className: r.class_name ?? r.id.replace(/^plugin:/, ""),
      kind: r.kind as "plugin" | "tool",
      module: r.module ?? "",
      label: r.label ?? "",
      modal: r.modal ?? "unknown",
      verdict: r.verdict ?? (r.modal === "opens" ? "modal" : "unknown"),
      risk: r.risk ?? "unknown",
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface AllowEntry {
  module: string;
  className: string;
}

/**
 * policy.json `<key>.allow_list` ([module, class] pairs) as {module, className}; read only. A key
 * the policy does not hold yet (plugin_run_allow_list before the main session writes it) is empty.
 */
export function allowListOf(
  policy: unknown,
  key: "plugin_read_allow_list" | "plugin_run_allow_list" = "plugin_read_allow_list",
): AllowEntry[] {
  const list = (policy as Record<string, { allow_list?: unknown } | undefined> | null)?.[key]
    ?.allow_list;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (e): e is [string, string] =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && typeof e[1] === "string",
    )
    .map(([module, className]) => ({ module, className }));
}

export function loadCatalog(root: string = DEFAULT_CENSUS_ROOT): CatalogRow[] {
  const paths = censusPaths(root);
  if (ledgerMissing(paths)) return [];
  return catalogRows(loadLedger(paths).rows as unknown as LedgerLike[]);
}

export function loadAllowList(root: string = DEFAULT_CENSUS_ROOT): AllowEntry[] {
  return allowListOf(readJson(censusPaths(root).policy, null));
}

/** The run allow-list (policy plugin_run_allow_list); read only here. */
export function loadRunAllowList(root: string = DEFAULT_CENSUS_ROOT): AllowEntry[] {
  return allowListOf(readJson(censusPaths(root).policy, null), "plugin_run_allow_list");
}

// ── Contract ──────────────────────────────────────────────────────────────────

let contractCache: Contract | null = null;
export function pluginContract(): Contract {
  contractCache ??= loadContract(CONTRACT_FILE);
  return contractCache;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export interface PluginDeps {
  client: Pick<WorkbenchClient, "call">;
  catalog: () => CatalogRow[];
  allowList: () => AllowEntry[];
  /** The run allow-list; empty when absent. */
  runAllowList?: () => AllowEntry[];
}

function targetOf(args: Record<string, unknown>): string {
  return typeof args.className === "string" && args.className !== ""
    ? `plugin:${args.className}`
    : "plugin:catalog";
}

function fail(
  action: string,
  target: string,
  code: PluginErrorCode,
  message: string,
  next?: string,
): PluginError {
  const dflt = ERROR_CODES[code];
  return { ok: false, action, target, code, message, next: next ?? dflt, warnings: [] };
}

function parseCursor(cursor: unknown): number | null {
  if (cursor === undefined || cursor === "") return 0;
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) return null;
  return Number(cursor);
}

function listAction(args: Record<string, unknown>, deps: PluginDeps): PluginResponse {
  const target = "plugin:catalog";
  const start = parseCursor(args.cursor);
  if (start === null) {
    return fail("list", target, "INVALID_ARGUMENT", "cursor must be the nextCursor of a page");
  }
  const limit = (args.limit as number | undefined) ?? LIMIT_DEFAULT;
  if (limit < 1 || limit > LIMIT_MAX) {
    return fail("list", target, "INVALID_ARGUMENT", `limit must be 1..${LIMIT_MAX}`);
  }
  let rows = deps.catalog();
  if (typeof args.moduleName === "string" && args.moduleName !== "") {
    rows = rows.filter((r) => r.module === args.moduleName);
  }
  const page = rows.slice(start, start + limit);
  const nextCursor = start + limit < rows.length ? String(start + limit) : null;
  const modal = { opens: 0, none: 0, unknown: 0 } as Record<string, number>;
  for (const r of rows) modal[r.modal] = (modal[r.modal] ?? 0) + 1;
  const ok: ActionOk = {
    ok: true,
    action: "list",
    target,
    changed: null,
    readback: { total: rows.length, modal, rows: page, nextCursor },
    warnings: rows.length === 0 ? ["the census ledger has no plugin rows (E03)"] : [],
  };
  if (nextCursor) ok.next = `list with cursor "${nextCursor}"`;
  return ok;
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

type EngineAction = "describe" | "getSettings" | "setSettings" | "run";
const MUTATING: readonly EngineAction[] = ["setSettings", "run"];

const inList = (list: AllowEntry[], moduleName: string, className: string): boolean =>
  list.some((e) => e.module === moduleName && e.className === className);

/** The refusals raised before anything is sent; null when the request may go. */
function precheck(
  action: EngineAction,
  args: Raw,
  deps: PluginDeps,
  target: string,
): PluginError | null {
  const moduleName = args.moduleName as string;
  const className = args.className as string;
  if (!(MODULE_IDS as readonly string[]).includes(moduleName)) {
    return fail(action, target, "INVALID_ARGUMENT", `unknown module ${moduleName}`);
  }
  if (!moduleAllowsRead(moduleName as ModuleId)) {
    return fail(
      action,
      target,
      "MODULE_NOT_SUPPORTED",
      "the Particle Editor is never read (its module read crashed the Workbench, DEC-042)",
      "Use wb_module open, front or close for ParticleEditor.",
    );
  }
  if (className === "RunCommandline" || className === "Configure") {
    return fail(action, target, "INVALID_ARGUMENT", NEVER_CALLED);
  }
  if (action === "run") {
    const row = deps.catalog().find((r) => r.className === className);
    if (row?.modal === "opens") {
      return fail(
        action,
        target,
        "PLUGIN_MODAL",
        `${className}'s Run opens a dialog (E03); it is never run from here; nothing was sent`,
      );
    }
    if (!inList((deps.runAllowList ?? (() => []))(), moduleName, className)) {
      return fail(
        action,
        target,
        "NOT_ALLOWLISTED",
        `${moduleName} ${className} is not on the plugin run allow-list; nothing was sent`,
        "Propose the class for data/census/policy.json plugin_run_allow_list.",
      );
    }
  } else if (!inList(deps.allowList(), moduleName, className)) {
    return fail(
      action,
      target,
      "NOT_ALLOWLISTED",
      `${moduleName} ${className} is not on the plugin allow-list; nothing was sent`,
      "Propose the class for data/census/policy.json.",
    );
  }
  if (action === "getSettings") {
    if (parseCursor(args.cursor) === null) {
      return fail(action, target, "INVALID_ARGUMENT", "cursor must be the nextCursor of a page");
    }
    const limit = args.limit as number | undefined;
    if (limit !== undefined && (limit < 1 || limit > LIMIT_MAX)) {
      return fail(action, target, "INVALID_ARGUMENT", `limit must be 1..${LIMIT_MAX}`);
    }
  }
  if (action === "setSettings" && (args.name as string).trim() === "") {
    return fail(action, target, "INVALID_ARGUMENT", "name (the variable) is empty");
  }
  return null;
}

function paramsOf(action: EngineAction, args: Raw): Raw {
  const params: Raw = { action, moduleName: args.moduleName, className: args.className };
  if (action === "getSettings") {
    if (args.cursor !== undefined) params.cursor = args.cursor;
    if (args.limit !== undefined) params.limit = args.limit;
  }
  if (action === "setSettings") {
    params.name = args.name;
    params.value = args.value;
  }
  // A write or a run is a dry run unless confirm is true: send the flag explicitly.
  if (MUTATING.includes(action)) params.confirm = args.confirm === true;
  return params;
}

async function engineAction(
  action: EngineAction,
  args: Raw,
  deps: PluginDeps,
): Promise<PluginResponse> {
  const target = targetOf(args);
  const refused = precheck(action, args, deps, target);
  if (refused) return refused;
  const moduleName = args.moduleName as string;
  const className = args.className as string;
  const mutating = MUTATING.includes(action);
  const params = paramsOf(action, args);

  let resp: Raw;
  try {
    resp = await deps.client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof WorkbenchError && ["MODAL_OPEN", "LOST", "WEDGED"].includes(e.code)) {
      const f = fail(action, target, e.code as ErrorCode, message);
      if (e.code === "LOST" && mutating) {
        const read = action === "run" ? "describe" : "getSettings";
        f.next = `The call was lost and is never retried; read back first (wb_plugin ${read}).`;
      }
      return f;
    }
    return fail(action, target, "UNREACHABLE", message);
  }

  const status = resp.status;
  if (status === "refused") {
    const raw = typeof resp.code === "string" ? resp.code : "";
    const code: PluginErrorCode = isPluginCode(raw) ? raw : "HANDLER_ERROR";
    const next = typeof resp.nextStep === "string" && resp.nextStep ? resp.nextStep : undefined;
    const f = fail(action, target, code, String(resp.message ?? ""), next);
    if (raw !== "" && code === "HANDLER_ERROR") {
      f.warnings.push(`the handler answered an unknown code '${raw}'`);
    }
    return f;
  }
  if (status !== "ok") {
    return fail(action, target, "HANDLER_ERROR", String(resp.message ?? "no status"));
  }

  const readback: Raw = {
    module: resp.moduleName ?? moduleName,
    className: resp.className ?? className,
    message: resp.message,
  };
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let next: string | undefined;
  const dryRun = args.confirm !== true;
  if (action === "describe" || action === "getSettings") {
    readback.present = truthy(resp.present);
    readback.instance = truthy(resp.instance);
    readback.instanceClass = resp.instanceClass;
    warnings.push(FOCUS_WARNING);
  }
  if (action === "describe") {
    const row = deps.catalog().find((r) => r.className === className);
    readback.verdict = row?.verdict ?? "unknown";
    readback.runnable = inList((deps.runAllowList ?? (() => []))(), moduleName, className);
    readback.focusWarning = FOCUS_WARNING;
  }
  if (action === "getSettings") {
    readback.variableCount = resp.variableCount;
    readback.attributeCount = resp.attributeCount;
    readback.settings = Array.isArray(resp.settings) ? resp.settings : [];
    const nextCursor =
      typeof resp.nextCursor === "string" && resp.nextCursor ? resp.nextCursor : null;
    readback.nextCursor = nextCursor;
    if (nextCursor) next = `getSettings with cursor "${nextCursor}"`;
  }
  if (action === "setSettings") {
    const did = truthy(resp.changed);
    const name = String(resp.name ?? args.name);
    readback.name = name;
    readback.type = resp.type;
    readback.value = resp.value;
    readback.previous = resp.previous;
    readback.changed = did;
    readback.dryRun = dryRun;
    if (did) {
      changed = [{ path: `plugin:${className}.${name}`, before: resp.previous, after: resp.value }];
    } else if (dryRun) {
      warnings.push("dry run: nothing was written");
    }
    warnings.push(FOCUS_WARNING);
  }
  if (action === "run") {
    const ran = truthy(resp.ran);
    readback.ran = ran;
    readback.entry = resp.entry;
    readback.dryRun = dryRun;
    if (ran) warnings.push("Run's effect is not read back here; read it with the oracle tool");
    else if (dryRun) warnings.push("dry run: only the preconditions were checked");
  }
  if (next === undefined && typeof resp.nextStep === "string" && resp.nextStep) {
    next = resp.nextStep;
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

/** Validates against the contract's per-action schema, then answers. Never throws. */
export async function runPlugin(raw: unknown, deps: PluginDeps): Promise<PluginResponse> {
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  const action = typeof rawObj.action === "string" ? rawObj.action : "";
  const parsed = buildRequestSchema(pluginContract()).safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return fail(action, targetOf(rawObj), "INVALID_ARGUMENT", msg);
  }
  const args = parsed.data as Record<string, unknown>;
  switch (args.action) {
    case "list":
      return listAction(args, deps);
    case "describe":
    case "getSettings":
    case "setSettings":
    case "run":
      return engineAction(args.action, args, deps);
    default:
      return fail(action, targetOf(args), "INVALID_ARGUMENT", `unknown action ${action}`);
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

/** Flat input shape for MCP: the action enum plus every contract param, optional. */
export function inputShape(c: Contract = pluginContract()): Record<string, z.ZodTypeAny> {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: Record<string, z.ZodTypeAny> = { action: z.enum(names) };
  const seen = new Set<string>();
  for (const a of c.actions) {
    for (const p of a.params) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      const base =
        p.type === "int" ? z.number().int() : p.type === "bool" ? z.boolean() : z.string();
      shape[p.key] = (p.note ? base.describe(p.note) : base).optional();
    }
  }
  return shape;
}

export function registerWbPluginTool(
  server: McpServer,
  client: WorkbenchClient,
  deps: Partial<Omit<PluginDeps, "client">> = {},
): void {
  const full: PluginDeps = {
    client,
    catalog: deps.catalog ?? (() => loadCatalog()),
    allowList: deps.allowList ?? (() => loadAllowList()),
    runAllowList: deps.runAllowList ?? (() => loadRunAllowList()),
  };
  server.registerTool(
    "wb_plugin",
    // Strict, so the SDK does not strip unknown keys (a `method` key is refused, not dropped).
    {
      description: checkedDescription(pluginContract()),
      inputSchema: z.object(inputShape()).strict(),
    },
    async (args) => {
      const r = await runPlugin(args, full);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
