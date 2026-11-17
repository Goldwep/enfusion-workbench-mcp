/**
 * Read-side queries over the built ledger (`query.ts`, later `wb_census`):
 * `find` with deterministic tiered ranking, `describe` with alias
 * resolution, `children` and `path`. Reads only the ledger shards,
 * `ledger.meta.json` and `aliases.json` (main ruling 14).
 */
import { compareCodeUnits } from "./canon.js";
import { containsMachinePath } from "./hygiene.js";
import { normalizeLabel } from "./ids.js";
import type { LoadedLedger } from "./ledger-io.js";
import type { Alias, Row } from "./schemas.js";
import { levenshtein, trigramSimilarity } from "../utils/fuzzy.js";
import { PATH_KINDS, TIERS } from "./vocab.js";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

export interface FindFilters {
  kind?: string;
  module?: string;
  dim?: string;
  shard?: string;
  tier?: string;
  status?: string;
  belowTarget?: boolean;
}

export interface FindResult {
  count: number;
  page: number;
  pages: number;
  pageSize: number;
  rows: Row[];
  /** Rank class of each returned row (0 = exact id ... 6 = fuzzy). */
  ranks: number[];
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function names(r: Row): string[] {
  const out: string[] = [];
  for (const v of [r.label, r.label_raw, r.object_name, r.class_name])
    if (v) out.push(normalizeLabel(v));
  if (r.signature) {
    const m = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(r.signature);
    if (m) out.push(m[1]);
  }
  // A row with no name (a setting key) is known by the last segment of its id.
  if (!r.label && !r.object_name && !r.class_name) {
    const segs = r.id.replace(/^[a-z]+:/, "").split("/");
    const last = segs[segs.length - 1];
    if (last && !last.startsWith("#")) {
      let t = last;
      try {
        t = decodeURIComponent(last);
      } catch {
        // keep the raw segment
      }
      t = t.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function passes(r: Row, f: FindFilters): boolean {
  if (f.kind && r.kind !== f.kind) return false;
  if (f.module && r.module !== f.module) return false;
  if (f.dim && r.dim !== f.dim) return false;
  if (f.shard && f.shard !== "all" && r.shard !== f.shard) return false;
  if (f.tier && r.tier !== f.tier) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.belowTarget && TIERS.indexOf(r.tier) >= TIERS.indexOf(r.target_tier)) return false;
  return true;
}

/**
 * Rank of a row for a query, or -1 for no match:
 * 0 exact id; 1 exact object or class name; 2 exact label; 3 case-insensitive
 * exact name; 4 token prefix; 5 substring of id, a name or `what`; 6 fuzzy.
 */
export function rankRow(r: Row, query: string): number {
  if (r.id === query) return 0;
  if (r.object_name === query || r.class_name === query) return 1;
  const ns = names(r);
  if (ns.includes(normalizeLabel(query))) return 2;
  const q = query.toLowerCase();
  if (ns.some((n) => n.toLowerCase() === q)) return 3;
  const qt = tokens(query);
  if (qt.length > 0) {
    const rt = [...tokens(r.id), ...ns.flatMap(tokens)];
    if (qt.every((t) => rt.some((x) => x.startsWith(t)))) return 4;
  }
  if (
    r.id.toLowerCase().includes(q) ||
    ns.some((n) => n.toLowerCase().includes(q)) ||
    r.what?.toLowerCase().includes(q)
  ) {
    return 5;
  }
  if (q.length >= 4 && ns.some((n) => trigramSimilarity(n.toLowerCase(), q) >= 0.5)) return 6;
  return -1;
}

/** Paged, ranked search. `limit` is clamped to `MAX_LIMIT`. */
export function find(
  ledger: LoadedLedger,
  query: string,
  filters: FindFilters = {},
  page = 1,
  limit = DEFAULT_LIMIT,
): FindResult {
  const size = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
  const hits: { row: Row; rank: number }[] = [];
  for (const r of ledger.rows) {
    if (!passes(r, filters)) continue;
    const rank = rankRow(r, query);
    if (rank >= 0) hits.push({ row: r, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || compareCodeUnits(a.row.id, b.row.id));
  const pages = Math.max(1, Math.ceil(hits.length / size));
  const p = Math.max(1, Math.floor(page));
  const slice = hits.slice((p - 1) * size, p * size);
  return {
    count: hits.length,
    page: p,
    pages,
    pageSize: size,
    rows: slice.map((h) => h.row),
    ranks: slice.map((h) => h.rank),
  };
}

export interface DescribeResult {
  row: Row | null;
  alias?: Alias;
  /** Set when the row was found from a wording, not an id (`describe` with `wording`). */
  wording?: string;
  /** Rows the wording fits equally well, when it did not single one out (at most 8). */
  tied?: string[];
  tiedCount?: number;
  near: string[];
  parentChain: string[];
  childrenIds: string[];
}

/** Up to `n` ids nearest to `id` (prefix and case-insensitive hits first, then edit distance). */
export function nearestIds(ids: readonly string[], id: string, n = 5): string[] {
  const lower = id.toLowerCase();
  const scored = ids.map((x) => {
    const xl = x.toLowerCase();
    const bonus = xl === lower ? -1000 : xl.startsWith(lower) || lower.startsWith(xl) ? -500 : 0;
    return { x, score: bonus + levenshtein(xl, lower) };
  });
  scored.sort((a, b) => a.score - b.score || compareCodeUnits(a.x, b.x));
  return scored.slice(0, n).map((s) => s.x);
}

/** Parent chain from the row up to its root (row first). */
export function parentChain(ledger: LoadedLedger, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = ledger.byId.get(id);
  while (cur && !seen.has(cur.id)) {
    out.push(cur.id);
    seen.add(cur.id);
    cur = typeof cur.parent === "string" ? ledger.byId.get(cur.parent) : undefined;
  }
  return out;
}

/** Direct children ids in code-unit order. */
export function childrenIds(ledger: LoadedLedger, id: string): string[] {
  return (ledger.children.get(id) ?? []).map((r) => r.id).sort(compareCodeUnits);
}

/**
 * Resolves an id (or an alias of one) to its row. With `wording`, text that is neither falls
 * back to `resolveWording` (a name with its owner: "the key 'd' of IOPItemOpEnvClass").
 */
export function describe(
  ledger: LoadedLedger,
  aliases: readonly Alias[],
  id: string,
  opts: { wording?: boolean } = {},
): DescribeResult {
  let row = ledger.byId.get(id) ?? null;
  let alias: Alias | undefined;
  let wording: string | undefined;
  if (!row) {
    alias = aliases.find((a) => a.from === id);
    if (alias) row = ledger.byId.get(alias.to) ?? null;
  }
  if (!row && opts.wording && id.trim()) {
    const w = resolveWording(ledger, id);
    if (w.row) {
      row = w.row;
      wording = id.trim();
    } else if (w.tiedCount > 1) {
      return {
        row: null,
        tied: w.tied.map((r) => r.id),
        tiedCount: w.tiedCount,
        near: [],
        parentChain: [],
        childrenIds: [],
      };
    }
  }
  if (!row) {
    return {
      row: null,
      near: nearestIds([...ledger.byId.keys()], id),
      parentChain: [],
      childrenIds: [],
    };
  }
  return {
    row,
    alias,
    ...(wording ? { wording } : {}),
    near: [],
    parentChain: parentChain(ledger, row.id),
    childrenIds: childrenIds(ledger, row.id),
  };
}

/** Replaces a string that looks like a machine path with `<redacted-path>`. */
export function redact(s: string): string {
  return containsMachinePath(s) ? "<redacted-path>" : s;
}

// ── howto: tool and action names ──────────────────────────────────────────────

/** A tool, and when known an action of it, that reaches a row. */
export interface ToolAction {
  tool: string;
  action?: string;
  /**
   * `link`: an `mcp` link on the row. `dedicated`: the tool built for the row's dimension
   * (wb_diag for diag rows, wb_settings for setting rows). `path`: a tool the row's recorded
   * path kind maps to.
   */
  via: "link" | "dedicated" | "path" | "self";
  role?: string;
  /** The path kind the tool was reached through (via `path`). */
  path?: string;
  /** Status of that path. */
  pathStatus?: string;
  /**
   * True: the tool sends this row today. False: it would refuse the row on this build, and
   * `blocker` says why. Undefined: not checked (an mcp link, or a check whose data is absent).
   */
  drivable?: boolean;
  /** Why the tool cannot act on the row yet (with `drivable: false`). */
  blocker?: string;
  /** A condition the action still has (play mode, an allow-list for writes). */
  note?: string;
}

/**
 * Path kinds that a tool reaches. Kinds not listed (net-api-handler,
 * builtin-net-handler, file-format, none-known) have no tool behind them.
 * `wb_execute_action` is the alias of `wb_menu run`. Whether the tool can act on
 * a given row today is `toolActionFor`'s question (a `ReachContext`).
 */
export const PATH_TOOLS: Readonly<Record<string, { tool: string; action?: string }>> = {
  "execute-action": { tool: "wb_menu", action: "run" },
  "plugin-run": { tool: "wb_plugin", action: "run" },
  "gui-automation": { tool: "wb_gui", action: "invoke" },
  cli: { tool: "wb_cli_run" },
};

/** One Diag Menu catalog entry, as `toolActionFor` needs it. */
export interface DiagReach {
  enumName: string;
  kind: string;
}

/**
 * What the tools check beyond the row before they act on it (review-1 finding 1): the locator
 * records of the current build (wb_gui drives only a row with one), the policy gates and
 * allow-lists, and the Diag Menu catalog (wb_diag reads and sets by script id).
 */
export interface ReachContext {
  /** Row ids with a record in data/census/locators/<current build>.jsonl. */
  locators: ReadonlySet<string>;
  /** policy.json gui.actions_enabled and gui.rows_enabled. */
  guiActions: ReadonlySet<string>;
  guiRows: ReadonlySet<string>;
  /** diag-catalog.json entries by menu path, lower case ("ai/aiscript/ai debug category"). */
  diag: ReadonlyMap<string, DiagReach>;
  /** Why `wb_menu run` refuses a menu-item row, or null when it sends it; absent: refused (not read). */
  menuRefusal?: (r: Row) => string | null;
  /** policy.json plugin_run_allow_list classes. */
  pluginRun: ReadonlySet<string>;
  /** policy.json cli_run.allow_list entries (`verb:<name>`, `plugin:<Name>`). */
  cliAllow: ReadonlySet<string>;
}

/** No locators, empty gates and lists, no catalog: nothing behind a path counts as drivable. */
export const NO_REACH: ReachContext = {
  locators: new Set(),
  guiActions: new Set(),
  guiRows: new Set(),
  diag: new Map(),
  pluginRun: new Set(),
  cliAllow: new Set(),
};

/** Splits `mcp:action/<tool>.<action>` into its two names. */
export function splitMcpAction(link: string): { tool: string; action: string } | null {
  const m = /^mcp:action\/([a-z0-9_]+)\.([A-Za-z0-9_-]+)$/.exec(link);
  return m ? { tool: m[1], action: m[2] } : null;
}

/** Plan 4.7 precedence: the chosen path unless refuted, else the first live path in precedence order. */
export function preferredPath(r: Row): Row["paths"][number] | undefined {
  const live = r.paths.filter((p) => p.status !== "refuted");
  const chosen = live.find((p) => p.path === r.chosen_path && p.path !== "none-known");
  if (chosen) return chosen;
  const ordered = [...live].sort((a, b) => PATH_KINDS.indexOf(a.path) - PATH_KINDS.indexOf(b.path));
  return ordered.find((p) => p.path !== "none-known") ?? ordered[0];
}

/** Every well-formed `mcp` link on the row. */
export function linksOf(r: Row): { tool: string; action: string; role: string }[] {
  return r.mcp.flatMap((m) => {
    const s = splitMcpAction(m.action);
    return s ? [{ ...s, role: m.role }] : [];
  });
}

/**
 * An MCP tool row is used through that tool, an MCP action row through its tool and action
 * (`mcp:tool/<tool>`, `mcp:action/<tool>.<action>`); null for any other row.
 */
export function selfTool(r: Row): ToolAction | null {
  if (r.kind === "mcp-tool") {
    const m = /^mcp:tool\/([a-z][a-z0-9_]*)$/.exec(r.id);
    return m ? { tool: m[1], via: "self" } : null;
  }
  if (r.kind === "mcp-action") {
    const s = splitMcpAction(r.id);
    return s ? { tool: s.tool, action: s.action, via: "self" } : null;
  }
  return null;
}

/** wb_diag for a diag row: by its catalog entry, else `select` for a menu; null for an uncatalogued option. */
function diagAction(r: Row, ctx: ReachContext): ToolAction | null {
  const e = ctx.diag.get(r.id.replace(/^diag:/, "").toLowerCase());
  const base = { tool: "wb_diag", via: "dedicated" as const };
  if (e?.kind === "menu" || (!e && r.kind === "diag-menu")) {
    return {
      ...base,
      action: "select",
      ...(e ? { drivable: true } : {}),
      note: e
        ? `menuId of ${e.enumName}; play mode only`
        : "by the menu name, not in the diag catalog; play mode only",
    };
  }
  if (!e) return null;
  if (e.kind === "range" || e.kind === "engine") {
    const probe = e.kind === "range" ? "P-W8-07" : "P-W8-08";
    return {
      ...base,
      action: "get",
      drivable: false,
      blocker: `wb_diag refuses ${e.kind} ids (UNPROVEN) until probe ${probe} passes`,
    };
  }
  return {
    ...base,
    action: "get",
    drivable: true,
    note: `name ${e.enumName}; set needs it on policy diag.set_allow_list`,
  };
}

/** wb_settings for a setting row: `get` for a store key; `options` waits for its probe. */
function settingAction(r: Row): ToolAction | null {
  const base = { tool: "wb_settings", via: "dedicated" as const };
  if (r.kind === "setting-key") {
    return { ...base, action: "get", drivable: true, note: "set writes only a scratch ini" };
  }
  if (r.kind === "option") {
    return {
      ...base,
      action: "options",
      drivable: false,
      blocker: "wb_settings options is GATED until probe P-W8-05",
    };
  }
  return null;
}

/** The tool of one live path kind for the row, with whether it can act today; null when the kind does not apply. */
function pathAction(r: Row, p: Row["paths"][number], ctx: ReachContext): ToolAction | null {
  const t = PATH_TOOLS[p.path];
  if (!t) return null;
  const base: ToolAction = { ...t, via: "path", path: p.path, pathStatus: p.status };
  switch (p.path) {
    case "execute-action": {
      const why = ctx.menuRefusal ? ctx.menuRefusal(r) : "its run allow-list was not read";
      return why === null
        ? { ...base, drivable: true }
        : { ...base, drivable: false, blocker: `wb_menu run refuses it: ${why}` };
    }
    case "plugin-run": {
      // wb_plugin runs a plugin class; an API row a plugin would use is not one.
      if (r.kind !== "plugin") return null;
      const cls = r.class_name ?? r.id.replace(/^plugin:/, "");
      return ctx.pluginRun.has(cls)
        ? { ...base, drivable: true }
        : {
            ...base,
            drivable: false,
            blocker: "wb_plugin run refuses it: not on policy plugin_run_allow_list",
          };
    }
    case "cli": {
      const name = (r.label ?? r.id).replace(/^[a-z]+:/, "");
      return ctx.cliAllow.has(`verb:${name}`) || ctx.cliAllow.has(`plugin:${name}`)
        ? { ...base, drivable: true }
        : {
            ...base,
            drivable: false,
            blocker: "wb_cli_run refuses it: not on policy cli_run.allow_list",
          };
    }
    case "gui-automation": {
      if (!ctx.locators.has(r.id)) {
        return { ...base, drivable: false, blocker: "no locator on this build" };
      }
      return ctx.guiActions.has("invoke") && ctx.guiRows.has(r.id)
        ? { ...base, drivable: true }
        : {
            ...base,
            drivable: false,
            blocker:
              "wb_gui invoke is GATED (policy gui.actions_enabled, gui.rows_enabled); wb_gui read works on its locator",
          };
    }
    default:
      return base;
  }
}

/**
 * The tool and action to use for a row, and whether it can act on it today:
 * 0. an MCP tool or action row: that tool (and action) itself (`selfTool`);
 * 1. its first `drive` link (else its first link);
 * 2. the tool built for its dimension: wb_diag (diag rows, through the Diag Menu catalog) and
 *    wb_settings (setting rows);
 * 3. the tools its live paths map to, the chosen path first, then plan 4.7 precedence; a menu
 *    item is also reached by wb_menu run. The first that can act today wins, else the first.
 * Null when no tool reaches it. `ctx` defaults to NO_REACH (no path tool counts as drivable).
 */
export function toolActionFor(r: Row, ctx: ReachContext = NO_REACH): ToolAction | null {
  const self = selfTool(r);
  if (self) return self;
  const links = linksOf(r);
  const link = links.find((m) => m.role === "drive") ?? links[0];
  if (link) return { tool: link.tool, action: link.action, via: "link", role: link.role };
  if (r.dim === "diag") {
    const d = diagAction(r, ctx);
    if (d) return d;
  }
  if (r.dim === "setting") {
    const s = settingAction(r);
    if (s) return s;
  }
  const live = r.paths.filter((p) => p.status !== "refuted" && p.path in PATH_TOOLS);
  if (r.kind === "menu-item" && !live.some((p) => p.path === "execute-action")) {
    live.push({ path: "execute-action", status: "candidate" } as Row["paths"][number]);
  }
  const rank = (p: Row["paths"][number]): number =>
    p.path === r.chosen_path ? -1 : PATH_KINDS.indexOf(p.path);
  live.sort((a, b) => rank(a) - rank(b));
  const options = live.flatMap((p) => {
    const t = pathAction(r, p, ctx);
    return t ? [t] : [];
  });
  return options.find((t) => t.drivable !== false) ?? options[0] ?? null;
}

/** Rows linked to a tool (and one of its actions), by id, with the linked action and role. */
export function rowsLinkedTo(
  ledger: LoadedLedger,
  tool: string,
  action?: string,
): { row: Row; action: string; role: string }[] {
  const out: { row: Row; action: string; role: string }[] = [];
  for (const row of ledger.rows) {
    for (const l of linksOf(row)) {
      if (l.tool === tool && (action === undefined || l.action === action)) {
        out.push({ row, action: l.action, role: l.role });
      }
    }
  }
  return out.sort((a, b) => compareCodeUnits(a.row.id, b.row.id));
}

/** Every tool name some row links to. */
export function linkedTools(ledger: LoadedLedger): Set<string> {
  const out = new Set<string>();
  for (const r of ledger.rows) for (const l of linksOf(r)) out.add(l.tool);
  return out;
}

/** The name a row is known by: label, object name, class name, or its signature. */
export function rowName(r: Row): string {
  return r.label ?? r.object_name ?? r.class_name ?? r.signature ?? "";
}

// ── howto: task phrasing ──────────────────────────────────────────────────────

/** A "how do I ..." question taken apart. */
export interface Task {
  /** The text as given, trimmed. */
  raw: string;
  /** True when a question frame ("how do I", "how to") or a quoted name was found. */
  framed: boolean;
  /** Quoted names in order; the first is the row's name, the rest are context (a parent, a class). */
  names: string[];
  /** Lower-case words outside the quotes, without the frame. */
  words: string[];
  /** Text outside the quotes with the frame, verb and articles removed. */
  rest: string;
  /**
   * Owner names written without quotes: CamelCase or snake_case identifiers outside the quotes
   * ("the key 'd' of IOPItemOpEnvClass"), and the owner of an unframed `Owner.name`.
   */
  hints: string[];
}

const FRAME =
  /^\s*(?:how\s+(?:do|can|could|would|should|might|does)\s+(?:i|we|you|one)|how\s+to|what(?:'s|\s+is)\s+the\s+way\s+to|(?:i|we)\s+(?:want|need|would\s+like)\s+to|ways?\s+to)\b[\s,:]*/i;
const LEAD_VERBS = [
  "read or change",
  "get to",
  "drive",
  "run",
  "use",
  "open",
  "change",
  "read",
  "set",
  "reach",
  "find",
  "invoke",
  "press",
  "click",
  "toggle",
  "enable",
  "disable",
  "create",
  "add",
  "remove",
  "delete",
  "edit",
  "call",
  "trigger",
  "activate",
  "switch",
  "select",
  "modify",
  "configure",
  "access",
  "show",
  "hide",
  "start",
  "stop",
];
const STOP = new Set([
  "the",
  "a",
  "an",
  "my",
  "this",
  "that",
  "in",
  "of",
  "to",
  "on",
  "for",
  "and",
  "from",
  "with",
  "within",
  "under",
  "it",
  "i",
  "do",
  "how",
]);

/** Takes a task phrasing apart: frame, quoted names, verb, articles. Never throws. */
export function parseTask(text: string): Task {
  const names: string[] = [];
  const outside = text.replace(/'([^']+)'|"([^"]+)"/g, (_m, a: string, b: string) => {
    names.push((a ?? b).trim());
    return " ";
  });
  let body = outside.replace(/[?!.]+\s*$/, "").trim();
  const frame = FRAME.exec(body);
  if (frame) body = body.slice(frame[0].length);
  const lower = body.toLowerCase();
  const verb = LEAD_VERBS.find((v) => lower === v || lower.startsWith(`${v} `));
  const afterVerb = verb ? body.slice(verb.length).trim() : body;
  const words = body
    .toLowerCase()
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 0);
  const rest = afterVerb
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP.has(w.toLowerCase()))
    .join(" ");
  const hints: string[] = [];
  for (const m of body.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const w = m[0];
    // An identifier a reader would not write as a plain word: inner capital, underscore or digit.
    if (w.length >= 3 && /^.+[A-Z_0-9]/.test(w) && !hints.includes(w)) hints.push(w);
  }
  // An unframed `Owner.name` (IOPItemOpEnvClass.d): the name, owned by the class before the dot.
  const dotted = /^([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(text.trim());
  if (!frame && names.length === 0 && dotted) {
    return {
      raw: text.trim(),
      framed: true,
      names: [dotted[2]],
      words,
      rest: dotted[2],
      hints: [dotted[1]],
    };
  }
  // Unquoted "<name> of [the ...] <Owner>" (Output of OverrideMeshObjectMaterial): the word
  // before "of" is the name, the identifier that ends the text its owner.
  const ofOwner = /\b([A-Za-z_][A-Za-z0-9_]*)\s+of\s+(?:.*\s)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    body.replace(/[?!.]+$/, ""),
  );
  if (names.length === 0 && ofOwner && hints.includes(ofOwner[2])) {
    return {
      raw: text.trim(),
      framed: true,
      names: [ofOwner[1]],
      words,
      rest,
      hints: hints.filter((h) => h !== ofOwner[1]),
    };
  }
  return { raw: text.trim(), framed: frame !== null || names.length > 0, names, words, rest, hints };
}

function singular(w: string): string {
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}

/** Plain words a reader uses for a part of a kind name ("network handler" for net-handler). */
const KIND_PART_WORDS: Readonly<Record<string, readonly string[]>> = {
  net: ["network"],
  diag: ["diagnostic"],
  cli: ["command"],
  arg: ["argument"],
  // "the setting 'X'" names a setting-key row.
  key: ["setting"],
};

/** True when the task's words name the row's kind: every part, or a plain word for it. */
function kindNamed(kind: string, words: ReadonlySet<string>): boolean {
  return kind
    .split("-")
    .every((k) => words.has(singular(k)) || (KIND_PART_WORDS[k] ?? []).some((w) => words.has(w)));
}

function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Deepest level below an owner that `ownerCandidates` looks at. */
const OWNER_DEPTH = 3;

/**
 * Rows answering exactly to `name` (rank 0 to 3) whose ancestor (up to three levels) or class is
 * named by one of `owners`. Found through the owners' own rows, so a name shared by thousands of
 * rows ("d", "Output") still reaches the one the owner names, past find's 200-row page.
 */
function ownerCandidates(ledger: LoadedLedger, name: string, owners: readonly string[]): Row[] {
  const out = new Map<string, Row>();
  for (const o of owners) {
    const heads = find(ledger, o, {}, 1, MAX_LIMIT);
    for (let i = 0; i < heads.rows.length; i++) {
      if (heads.ranks[i] > 3) break;
      let level: Row[] = [heads.rows[i]];
      for (let d = 0; d < OWNER_DEPTH && level.length > 0; d++) {
        const next: Row[] = [];
        for (const p of level) {
          for (const c of ledger.children.get(p.id) ?? []) {
            const rk = rankRow(c, name);
            if (rk >= 0 && rk <= 3) out.set(c.id, c);
            next.push(c);
          }
        }
        level = next;
      }
    }
  }
  return [...out.values()];
}

/** Candidate rows for a task. */
export interface TaskResolution {
  /** Best first, at most `limit`. */
  rows: Row[];
  /** How many rows matched in all. */
  count: number;
  /**
   * The rows that score exactly as well as the best one (the best included), at most 8, and how
   * many there are. More than one: the wording does not single out a row.
   */
  tied: Row[];
  tiedCount: number;
  /** True when the best row answers to the name exactly (rank 0 to 3), not by prefix or fuzz. */
  exact: boolean;
}

/** Most tied rows `resolveTask` hands back. */
const TIED_LIST = 8;

/** Candidate rows for a task, best first, with how many matched in all and which tie for first. */
export function resolveTask(ledger: LoadedLedger, task: Task, limit = 5): TaskResolution {
  const queries: string[] = [];
  if (task.names.length > 0) queries.push(task.names[0]);
  else {
    if (!task.framed && task.raw) queries.push(task.raw);
    if (task.rest) queries.push(task.rest);
    const content = task.words.filter((w) => !STOP.has(w));
    const all = content.join(" ");
    if (all && all !== task.rest) queries.push(all);
    const long = content.filter((w) => w.length >= 4).sort((a, b) => b.length - a.length);
    for (const w of long) queries.push(w);
  }
  const squashed = task.words.join("").replace(/'/g, "");
  const wordSet = new Set(task.words.map(singular));
  const owners = [...task.names.slice(1), ...task.hints.filter((h) => h !== task.names[0])];
  const ctx = owners.map((n) => n.toLowerCase());
  for (const [qi, q] of queries.entries()) {
    const res = find(ledger, q, {}, 1, MAX_LIMIT);
    const pool = res.rows.map((row, i) => ({ row, rank: res.ranks[i] }));
    let count = res.count;
    if (qi === 0 && owners.length > 0) {
      const seen = new Set(pool.map((p) => p.row.id));
      for (const row of ownerCandidates(ledger, q, owners)) {
        if (seen.has(row.id)) continue;
        pool.push({ row, rank: rankRow(row, q) });
        count++;
      }
    }
    if (pool.length === 0) continue;
    const scored = pool.map(({ row, rank }) => {
      let score = 0;
      const chain = parentChain(ledger, row.id)
        .slice(1)
        .map((id) => ledger.byId.get(id))
        .filter((x): x is Row => x !== undefined);
      const id = decoded(row.id).toLowerCase();
      for (const c of ctx) {
        if (
          chain.some((a) => rowName(a).toLowerCase() === c) ||
          row.class_name?.toLowerCase() === c ||
          // a setting's section is its owner: setting:<Section>/<key>
          (row.dim === "setting" && id.startsWith(`setting:${c}/`))
        )
          score += 2;
        else if (id.includes(c) || row.what?.toLowerCase().includes(c)) score += 1;
      }
      // A kind named in more words is the more specific fit ("schema class" over "class").
      if (kindNamed(row.kind, wordSet)) score += 1 + row.kind.split("-").length / 10;
      const mod = row.module.toLowerCase().replace(/\./g, "");
      if (row.module !== "none" && squashed.includes(mod)) score += 1 + mod.length / 100;
      // An exact id, object, class or label name all count as one band: a tie across them is a tie.
      const band = rank <= 3 ? 0 : rank === 4 ? 1 : rank === 5 ? 2 : 3;
      return { row, score, band, rank };
    });
    scored.sort(
      (a, b) =>
        a.band - b.band ||
        b.score - a.score ||
        a.rank - b.rank ||
        compareCodeUnits(a.row.id, b.row.id),
    );
    const best = scored[0];
    // An exact id is never tied: it names one row.
    const ties =
      best.rank === 0
        ? [best]
        : scored.filter((s) => s.band === best.band && s.score === best.score);
    return {
      rows: scored.slice(0, limit).map((s) => s.row),
      count,
      tied: ties.slice(0, TIED_LIST).map((s) => s.row),
      tiedCount: ties.length,
      exact: best.band === 0,
    };
  }
  return { rows: [], count: 0, tied: [], tiedCount: 0, exact: false };
}

/**
 * A row from a wording rather than an id ("the schema key 'd' of the schema class
 * 'IOPItemOpEnvClass'", "the key 'd' of IOPItemOpEnvClass", "IOPItemOpEnvClass.d"): the one row
 * that answers to the name exactly and fits the owners and module named better than any other.
 * `row` is null when no row answers exactly or several fit equally well (`tied` lists them).
 */
export function resolveWording(
  ledger: LoadedLedger,
  text: string,
): { row: Row | null; tied: Row[]; tiedCount: number } {
  const res = resolveTask(ledger, parseTask(text), 1);
  if (!res.exact) return { row: null, tied: [], tiedCount: 0 };
  if (res.tiedCount > 1) return { row: null, tied: res.tied, tiedCount: res.tiedCount };
  return { row: res.rows[0] ?? null, tied: [], tiedCount: 0 };
}
