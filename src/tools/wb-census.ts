import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { z } from "zod";
import { loadContracts } from "../manifest/contract.js";
import { shouldRegister } from "../manifest/tiers.js";
import { compareCodeUnits } from "../census/canon.js";
import type { Config } from "../config.js";
import { loadAliases } from "../census/census-config.js";
import { computeCoverage } from "../census/coverage.js";
import {
  DEFAULT_CENSUS_ROOT,
  censusPaths,
  ledgerMissing,
  loadLedger,
  type CensusPaths,
  type LoadedLedger,
} from "../census/ledger-io.js";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  describe as describeRow,
  find,
  linkedTools,
  NO_REACH,
  parseTask,
  preferredPath,
  redact,
  resolveTask,
  rowsLinkedTo,
  toolActionFor,
  type FindFilters,
  type ReachContext,
  type ToolAction,
} from "../census/query-engine.js";
import { loadDiagCatalog } from "../census/diag-catalog.js";
import { readCurrentBuild, loadLocatorRecords } from "../gui/locators.js";
import { loadAllowListFile, runRefusal } from "./wb-menu.js";
import {
  LEGACY_ACTIONS as TERRAIN_LEGACY,
  OTHER_TOOL_ACTIONS as TERRAIN_OTHER,
} from "./wb-terrain.js";
import { LEGACY_ACTIONS as LOCALIZATION_LEGACY } from "./wb-localization.js";
import { LEGACY_ACTIONS as LAYERS_LEGACY } from "./wb-layers.js";
import type { Alias, Row } from "../census/schemas.js";
import { DIMS, KINDS, MODULES, PATH_KINDS, TIERS } from "../census/vocab.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Census {
  ledger: LoadedLedger;
  aliases: Alias[];
  reach: ReachContext;
}

interface MetaEnumerators {
  done: string[];
  pending: string[];
}

/** Rows listed in `describe` for a parent before the rest are summarised as a count. */
const CHILD_PREVIEW = 10;

/** Longest `what` shown on a `find` line. */
const WHAT_WIDTH = 100;

// ── Loading ───────────────────────────────────────────────────────────────────

const cache = new Map<string, { signature: string; census: Census }>();

/** Size and mtime of every file the ledger is built from; changes when the ledger is rebuilt. */
function signatureOf(paths: CensusPaths): string {
  const build = readCurrentBuild(paths.root);
  const files = [
    ...Object.values(paths.shards),
    paths.meta,
    paths.aliases,
    join(paths.root, "policy.json"),
    join(paths.root, "diag-catalog.json"),
    ...(build ? [join(paths.root, "locators", `${build}.jsonl`)] : []),
  ];
  return files
    .map((f) => {
      if (!existsSync(f)) return "-";
      const s = statSync(f);
      return `${s.size}:${s.mtimeMs}`;
    })
    .join("|");
}

/**
 * Loads the ledger once and reuses it until a ledger file changes on disk.
 * Returns null when no ledger exists under the census root.
 */
function loadCensus(root: string): Census | null {
  const paths = censusPaths(root);
  if (ledgerMissing(paths)) return null;
  const signature = signatureOf(paths);
  const hit = cache.get(paths.root);
  if (hit && hit.signature === signature) return hit.census;
  const census = {
    ledger: loadLedger(paths),
    aliases: loadAliases(paths),
    reach: loadReach(paths.root),
  };
  cache.set(paths.root, { signature, census });
  return census;
}

function stringsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * What the tools check before acting on a row (query-engine ReachContext), from the files under
 * the census root: the current build's locator records, policy.json's gui gates and run
 * allow-lists, the Diag Menu catalog, and wb_menu's run allow-list pack. A file that is absent
 * or unreadable gives an empty part: nothing it would allow counts as drivable.
 */
export function loadReach(root: string): ReachContext {
  let locators = new Set<string>();
  try {
    const build = readCurrentBuild(root);
    if (build) locators = new Set(loadLocatorRecords(root, build).keys());
  } catch {
    // malformed locator file: wb_gui refuses every row, so none counts
  }
  const policy = (() => {
    try {
      return JSON.parse(readFileSync(join(root, "policy.json"), "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  })();
  const gui = (policy.gui ?? {}) as { actions_enabled?: unknown; rows_enabled?: unknown };
  const guiRows = new Set<string>();
  for (const e of Array.isArray(gui.rows_enabled) ? gui.rows_enabled : []) {
    if (typeof e === "string") guiRows.add(e);
    else if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string")
      guiRows.add((e as { id: string }).id);
  }
  const pluginRun = new Set<string>();
  for (const e of Array.isArray(policy.plugin_run_allow_list) ? policy.plugin_run_allow_list : []) {
    const cls = (e as { class?: unknown })?.class;
    if (typeof cls === "string") pluginRun.add(cls);
  }
  const diag = new Map<string, { enumName: string; kind: string }>();
  try {
    for (const e of loadDiagCatalog(join(root, "diag-catalog.json"))?.entries ?? []) {
      if (e.path) diag.set(e.path.toLowerCase(), { enumName: e.enumName, kind: e.kind });
    }
  } catch {
    // unreadable catalog: wb_diag refuses every name, so no diag row counts
  }
  const pack = loadAllowListFile();
  return {
    locators,
    guiActions: new Set(stringsOf(gui.actions_enabled)),
    guiRows,
    diag,
    menuRefusal: (r: Row) => runRefusal(r, pack),
    pluginRun,
    cliAllow: new Set(stringsOf((policy.cli_run as { allow_list?: unknown })?.allow_list)),
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function buildOf(ledger: LoadedLedger): { tag: string; branch: string; ui_language: string } {
  return ledger.meta?.build ?? { tag: "unknown", branch: "stable", ui_language: "unknown" };
}

function headerOf(ledger: LoadedLedger): string {
  const b = buildOf(ledger);
  const n = ledger.rows.length;
  return `census build ${b.tag} (${b.branch}, ${b.ui_language}) — ${n} row${n !== 1 ? "s" : ""}`;
}

function oneLine(s: string, width: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > width ? flat.slice(0, width - 1) + "…" : flat;
}

/** The name a row is known by: label, object name, class name, or its signature. */
function nameOf(r: Row): string {
  return r.label ?? r.object_name ?? r.class_name ?? r.signature ?? "";
}

function formatHit(r: Row): string {
  return redact(
    `${r.id} | ${r.kind} | ${r.module} | ${r.tier}/${r.target_tier} | ${nameOf(r)} | ${oneLine(r.what ?? "", WHAT_WIDTH)}`,
  );
}

function formatRisk(r: Row): string {
  if (!r.risk) return "not assigned";
  const parts: string[] = [r.risk];
  if (r.risk_open || r.risk_commit) {
    parts.push(`open ${r.risk_open ?? "?"}, commit ${r.risk_commit ?? "?"}`);
  }
  if (r.risk_floor) parts.push(`floored by ${r.risk_floor}`);
  const basis = r.risk_confirmed
    ? "confirmed"
    : "not confirmed (a policy default or an enumerator hint, never a measured result)";
  return `${parts.join("; ")} — ${basis}`;
}

function formatDescribe(r: Row, alias: Alias | undefined, chain: string[], kids: string[]): string {
  const lines: string[] = [];
  lines.push(`## ${r.id}`);
  if (alias) lines.push(`(requested id ${alias.from} is an alias: ${alias.why})`);
  lines.push("");

  lines.push("### What it is");
  lines.push(`- Kind: ${r.kind} (dimension ${r.dim})`);
  const name = nameOf(r);
  if (name) lines.push(`- Name: ${name}${r.label_raw ? ` (raw label ${r.label_raw})` : ""}`);
  if (r.object_name && r.object_name !== name) lines.push(`- Object name: ${r.object_name}`);
  if (r.class_name && r.class_name !== name) lines.push(`- Class: ${r.class_name}`);
  if (r.signature && r.signature !== name) lines.push(`- Signature: ${r.signature}`);
  if (r.shortcut_default) lines.push(`- Default shortcut: ${r.shortcut_default}`);
  lines.push(`- Description: ${r.what ?? "(none in the source yet)"}`);
  lines.push(`- Origin: ${r.origin}`);

  lines.push("");
  lines.push("### Where it lives");
  lines.push(`- Module: ${r.module} (shard ${r.shard})`);
  if (chain.length > 1) lines.push(`- Parent chain: ${chain.slice(1).join(" > ")}`);
  else
    lines.push(
      `- Parent: ${r.parent === null || r.parent === undefined ? "(root row)" : "(unresolved)"}`,
    );
  const reported =
    r.children_count !== undefined && r.children_count !== kids.length
      ? `, source reports ${r.children_count}`
      : "";
  lines.push(
    `- Children: ${kids.length} in the ledger (enumerated: ${String(r.children_enumerated)}${reported})`,
  );
  for (const k of kids.slice(0, CHILD_PREVIEW)) lines.push(`  - ${k}`);
  if (kids.length > CHILD_PREVIEW) {
    lines.push(
      `  - ... ${kids.length - CHILD_PREVIEW} more (use find with kind and module to list them)`,
    );
  }
  if (r.locator) lines.push(`- Locator: ${JSON.stringify(r.locator)}`);
  if (r.modal) lines.push(`- Modal: ${r.modal}`);

  lines.push("");
  lines.push(`### Sources (${r.sources.length})`);
  for (const s of r.sources) lines.push(`- ${s.enumerator}@${s.build} ${s.ref} (${s.confidence})`);
  lines.push(`- Seen in builds ${r.build.first_seen} to ${r.build.last_seen}`);

  lines.push("");
  lines.push("### Risk");
  lines.push(`- ${formatRisk(r)}`);

  lines.push("");
  lines.push("### Candidate paths");
  if (r.paths.length === 0) lines.push("- (none recorded)");
  const ordered = [...r.paths].sort(
    (a, b) => PATH_KINDS.indexOf(a.path) - PATH_KINDS.indexOf(b.path),
  );
  for (const p of ordered) {
    const chosen = p.path === r.chosen_path ? " [chosen]" : "";
    const evidence = p.evidence ? ` ${p.evidence}` : "";
    const reason = p.reason ? ` — ${p.reason}` : "";
    lines.push(`- ${p.path}: ${p.status}${evidence}${reason}${chosen}`);
  }
  if (r.mcp.length > 0) {
    lines.push(`- MCP: ${r.mcp.map((m) => `${m.action} (${m.role})`).join(", ")}`);
  }
  if (r.mcp_proposed.length > 0) lines.push(`- MCP proposed: ${r.mcp_proposed.join(", ")}`);

  lines.push("");
  lines.push("### Tier");
  lines.push(
    `- Now ${r.tier}, target ${r.target_tier} (target from ${r.target_tier_source})${r.weak_only ? "; weak oracle only" : ""}`,
  );
  for (const e of r.tier_evidence) lines.push(`  - ${e.tier}: ${e.ref}`);
  lines.push(`- Status: ${r.status}${r.deferred_reason ? ` (${r.deferred_reason})` : ""}`);
  if (r.disposition) {
    const d = r.disposition;
    const signoff = r.owner_signoff ? `, signed off ${r.owner_signoff}` : "";
    lines.push(
      `- Disposition: ${d.kind}${d.ref ? `:${d.ref}` : ""} — ${d.why} [${d.evidence}]${signoff}`,
    );
  }
  if (r.work_item) lines.push(`- Work item: ${r.work_item}`);
  if (r.tests.length > 0) {
    lines.push(`- Tests: ${r.tests.map((t) => `${t.id} [${t.kind}] ${t.file}`).join(", ")}`);
  }
  if (r.observed_states.length > 0) {
    lines.push(`- Observed states: ${r.observed_states.map((s) => JSON.stringify(s)).join(" ")}`);
  }
  if (r.aggregate) lines.push("- Aggregate row: excluded from every percentage");
  if (r.provisional) lines.push("- Provisional: imported from the recon, not yet measured");
  for (const u of r.unverified) {
    lines.push(`- Unverified: ${u.claim}${u.cleared_by ? ` (cleared by ${u.cleared_by})` : ""}`);
  }
  if (r.notes) lines.push(`- Notes: ${r.notes}`);
  return lines.map(redact).join("\n");
}

function formatStatus(ledger: LoadedLedger, filters: FindFilters): string {
  const rows = ledger.rows.filter(
    (r) =>
      (!filters.kind || r.kind === filters.kind) &&
      (!filters.module || r.module === filters.module) &&
      (!filters.dim || r.dim === filters.dim),
  );
  const meta = ledger.meta as Record<string, unknown> | null;
  const enumerators = (meta?.enumerators as MetaEnumerators | undefined) ?? {
    done: [],
    pending: [],
  };
  const unverifiedRefs = (meta?.unverified_refs as Record<string, number> | undefined) ?? {};
  const coverage = computeCoverage({
    rows,
    build: buildOf(ledger),
    enumerators,
    unverifiedRefs,
    ledgerSha: "",
  });
  const all = coverage.all;

  const lines: string[] = [];
  lines.push("## Census status");
  lines.push(headerOf(ledger));
  const scope = [
    filters.dim && `dim=${filters.dim}`,
    filters.kind && `kind=${filters.kind}`,
    filters.module && `module=${filters.module}`,
  ].filter(Boolean);
  if (scope.length > 0) lines.push(`Counts below cover only ${scope.join(", ")}.`);
  lines.push(`Shards: ${coverage.shards.map((s) => `${s.name} ${s.rows}`).join(", ") || "none"}`);
  lines.push(`Enumerators done: ${enumerators.done.join(", ") || "none"}`);
  lines.push(`Enumerators pending: ${enumerators.pending.join(", ") || "none"}`);
  lines.push(
    "A row's absence means only that no done enumerator saw it at this build; the ledger is not complete until the pending ones land.",
  );

  lines.push("");
  lines.push(
    `Rows by dimension and tier (${all.rows} counted, ${all.aggregate} aggregate excluded):`,
  );
  const dims = Object.keys(all.byDim).sort();
  const cell = new Map<string, number>();
  for (const r of rows) {
    if (r.aggregate) continue;
    cell.set(`${r.dim}|${r.tier}`, (cell.get(`${r.dim}|${r.tier}`) ?? 0) + 1);
  }
  const width = Math.max(9, ...dims.map((d) => d.length));
  lines.push(`  ${"dimension".padEnd(width)}  ${TIERS.join("  ")}  total`);
  for (const d of dims) {
    const counts = TIERS.map((t) => String(cell.get(`${d}|${t}`) ?? 0).padStart(2));
    lines.push(`  ${d.padEnd(width)}  ${counts.join("  ")}  ${all.byDim[d].rows}`);
  }
  if (dims.length === 0) lines.push("  (no rows)");

  const c = all.total;
  const known = Object.values(c.known).reduce((a, b) => a + b, 0);
  lines.push("");
  lines.push(
    `Coverage: driven and verified ${c.driven}; weak oracle ${c.weak}; known, not driven ${known}; unexplored ${c.unexplored}; in progress ${c.inProgress}.`,
  );
  const provisional = rows.filter((r) => r.provisional).length;
  if (provisional > 0)
    lines.push(`Provisional rows (recon import, not yet measured): ${provisional}`);
  const refs = Object.keys(unverifiedRefs).sort();
  if (refs.length > 0) {
    lines.push(
      `References not verifiable on this machine: ${refs.map((e) => `${e} ${unverifiedRefs[e]}`).join(", ")}`,
    );
  }
  lines.push("Gate results are not evaluated by this tool.");
  return lines.join("\n");
}

// ── howto ─────────────────────────────────────────────────────────────────────

/** Longest `howto` answer, in characters. */
export const HOWTO_MAX_CHARS = 600;

/** Rows listed for an ambiguous task or a reverse lookup, at most. */
const HOWTO_LIST = 3;
const REVERSE_LIST = 8;
const EVIDENCE_WIDTH = 100;

export interface HowtoMatch {
  id: string;
  tier: string;
  targetTier: string;
  tool?: string;
  action?: string;
  /** True when a tool reaches the row but cannot act on it yet. */
  notDrivable?: boolean;
}

export interface HowtoResult {
  found: boolean;
  id?: string;
  text: string;
  path?: string;
  tool?: string;
  action?: string;
  /** `link`: an mcp link on the row; `dedicated`: wb_diag or wb_settings; `path`: the tool its recorded path kind maps to; `self`: the row is an MCP tool or action. */
  via?: "link" | "dedicated" | "path" | "self";
  /** Set when several rows fit the task equally well and howto did not choose: their ids (at most 8) and count. */
  ambiguous?: { ids: string[]; count: number };
  /** False when a tool reaches the row but cannot act on it yet (`blocker` says why); undefined when unchecked. */
  drivable?: boolean;
  blocker?: string;
  tier?: string;
  targetTier?: string;
  risk?: string;
  evidence?: string;
  enable?: string;
  /** False when the tool's registered action list does not hold the action; undefined when unchecked. */
  registered?: boolean;
  /** Rows matched by a task phrasing, best first (the answer describes the first). */
  matches?: HowtoMatch[];
  /** Set for a tool or `tool.action` target: the rows linked to it. */
  reverse?: { tool: string; action?: string; count: number };
}

/** Tool name to its registered actions, as the handler contracts list them. */
export type RegisteredActions = ReadonlyMap<string, readonly string[]>;

/** `<repo>/contracts`, from both `src/tools/` and a compiled `dist/tools/`. */
const CONTRACTS_DIR = resolve(import.meta.dirname ?? ".", "..", "..", "contracts");

let contractActions: RegisteredActions | undefined;

/**
 * What a contract-backed tool accepts beyond or short of its contract (review-1 finding 2): the
 * contract actions it leaves to other tools, and the 1.x action names it still takes.
 */
export const CONTRACT_ADJUSTMENTS: Readonly<
  Record<string, { stripped?: readonly string[]; legacy?: readonly string[] }>
> = {
  wb_terrain: { stripped: TERRAIN_OTHER, legacy: TERRAIN_LEGACY },
  wb_localization: { legacy: LOCALIZATION_LEGACY },
  wb_layers: { legacy: LAYERS_LEGACY },
};

/**
 * The actions each contract-backed tool accepts: its contract's actions (read through
 * src/manifest/contract.ts) less those it leaves to other tools, plus the 1.x names it still
 * takes (CONTRACT_ADJUSTMENTS). Tools without a contract are absent here; howto checks them
 * against the ledger's own mcp:action rows (E11). An unreadable contracts folder gives an empty map.
 */
export function registeredActions(dir?: string): RegisteredActions {
  if (dir === undefined && contractActions) return contractActions;
  const map = new Map<string, string[]>();
  try {
    for (const c of loadContracts(dir ?? CONTRACTS_DIR)) {
      const adj = CONTRACT_ADJUSTMENTS[c.tool] ?? {};
      const names = c.actions.map((a) => a.name).filter((n) => !adj.stripped?.includes(n));
      for (const l of adj.legacy ?? []) if (!names.includes(l)) names.push(l);
      map.set(c.tool, names);
    }
  } catch {
    // unreadable or invalid contracts: nothing can be checked
  }
  if (dir === undefined) contractActions = map;
  return map;
}

function capText(s: string): string {
  return s.length > HOWTO_MAX_CHARS ? s.slice(0, HOWTO_MAX_CHARS - 1) + "…" : s;
}

/** Environment switches a tool needs before it is listed, or undefined when none. */
function enableFor(tool: string): string | undefined {
  const parts: string[] = [];
  if (!shouldRegister(tool)) parts.push(`ENFUSION_TOOLS=+${tool}`);
  if (tool === "wb_gui") parts.push("ENFUSION_GUI=1");
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The actions a tool accepts: the registered map (contracts, adjusted), else the tool's own
 * mcp:action rows in the ledger (E11 reads every registration). Undefined when neither knows it.
 */
function knownActions(
  reg: RegisteredActions,
  ledger: LoadedLedger,
  tool: string,
): readonly string[] | undefined {
  const fromReg = reg.get(tool);
  if (fromReg) return fromReg;
  const rows = (ledger.children.get(`mcp:tool/${tool}`) ?? []).filter(
    (r) => r.kind === "mcp-action" && r.status === "active",
  );
  if (rows.length === 0) return undefined;
  return rows.map((r) => r.id.slice(r.id.lastIndexOf(".") + 1)).sort(compareCodeUnits);
}

/** The accepted actions of the tool when `action` is not among them; undefined when it is or cannot be checked. */
function missingAction(
  known: readonly string[] | undefined,
  action: string | undefined,
): readonly string[] | undefined {
  if (!known || action === undefined || known.includes(action)) return undefined;
  return known;
}

function warnLine(tool: string, action: string, known: readonly string[]): string {
  return `Warning: ${tool} has no registered action "${action}" (registered: ${known.join(", ")})`;
}

/** True when howto names the tool as the one to use (it can act, or it was not checked). */
function usable(t: ToolAction | null): t is ToolAction {
  return t !== null && t.drivable !== false;
}

function useLine(t: ToolAction | null): string {
  if (!t) return "Use: no tool reaches this row (no MCP link, and no recorded path maps to a tool)";
  if (t.via === "link") return `Use: ${t.tool} action ${t.action}`;
  if (t.via === "self") {
    return t.action
      ? `Use: ${t.tool} action ${t.action} (this row is that MCP action)`
      : `Use: ${t.tool} (this row is that MCP tool; pick one of its actions)`;
  }
  const how =
    t.via === "dedicated"
      ? `the ${t.tool === "wb_diag" ? "diag" : "settings"} tool; no MCP link on this row`
      : `via the ${t.path} path, ${t.pathStatus}; no MCP link on this row`;
  if (t.drivable === false) return `Use: not drivable yet: ${t.blocker} (${how})`;
  const note = t.note ? `; ${t.note}` : "";
  return t.action
    ? `Use: ${t.tool} action ${t.action} (${how}${note})`
    : `Use: ${t.tool} (${how}; the verb is not recorded${note})`;
}

function matchOf(r: Row, reach: ReachContext): HowtoMatch {
  const t = toolActionFor(r, reach);
  return usable(t)
    ? { id: r.id, tier: r.tier, targetTier: r.target_tier, tool: t.tool, action: t.action }
    : { id: r.id, tier: r.tier, targetTier: r.target_tier, notDrivable: t !== null };
}

/**
 * Answer for a task that several rows fit equally well: howto does not choose. It lists them,
 * says so on the first line (no single row id there), and asks for the owner or the module.
 */
function ambiguousAnswer(tied: readonly Row[], count: number, reach: ReachContext): HowtoResult {
  const lines = [
    `Ambiguous: ${count} rows fit equally well; howto could not choose one.`,
    "Name the owner (class, handler, schema class, parent) or the module to pick one:",
  ];
  let listed = 0;
  for (const r of tied) {
    const m = matchOf(r, reach);
    const how = m.tool
      ? `${m.tool}${m.action ? ` ${m.action}` : ""}`
      : m.notDrivable
        ? "not drivable yet"
        : "no tool";
    const line = `- ${r.id} (${r.kind}, ${r.module}; ${how})`;
    if ([...lines, line].join("\n").length > HOWTO_MAX_CHARS - 20) break;
    lines.push(line);
    listed++;
  }
  if (count > listed) lines.push(`... ${count - listed} more`);
  return {
    found: true,
    text: capText(redact(lines.join("\n"))),
    ambiguous: { ids: tied.map((r) => r.id), count },
    matches: tied.map((r) => matchOf(r, reach)),
  };
}

/** Answer for a `tool` or `tool.action` target: the rows linked to it, and what the tool accepts. */
function reverseAnswer(
  ledger: LoadedLedger,
  reg: RegisteredActions,
  tool: string,
  action: string | undefined,
): HowtoResult {
  const hits = rowsLinkedTo(ledger, tool, action);
  const name = action ? `${tool}.${action}` : tool;
  const known = knownActions(reg, ledger, tool);
  const own = ledger.byId.get(action ? `mcp:action/${tool}.${action}` : `mcp:tool/${tool}`);
  const lines = [
    hits.length > 0
      ? `${name}: ${hits.length} row${hits.length !== 1 ? "s" : ""} link it`
      : `${name}: no row links to it`,
  ];
  if (own)
    lines.push(`Row: ${own.id} (${own.tier}/${own.target_tier}): ${oneLine(own.what ?? "", 120)}`);
  const missing = missingAction(known, action);
  if (missing && action) lines.push(warnLine(tool, action, missing));
  if (!action && hits.length === 0 && known)
    lines.push(`Accepts: ${known.slice(0, 12).join(", ")}`);
  if (!action && hits.length > 0) {
    const counts = new Map<string, number>();
    for (const h of hits) counts.set(h.action, (counts.get(h.action) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1] || compareCodeUnits(a[0], b[0]));
    const shown = top.slice(0, 6).map(([a, n]) => `${a} ${n}`);
    lines.push(`Actions: ${shown.join(", ")}${top.length > 6 ? `, ${top.length - 6} more` : ""}`);
    const bad = top.map(([a]) => a).filter((a) => known && !known.includes(a));
    if (known && bad.length > 0) {
      lines.push(`Warning: not registered for ${tool}: ${bad.slice(0, 6).join(", ")}`);
    }
  }
  const enable = enableFor(tool);
  if (enable && (hits.length > 0 || own)) lines.push(`Enable with ${enable}`);
  let listed = 0;
  for (const h of hits.slice(0, REVERSE_LIST)) {
    const line = `- ${h.row.id} | ${h.row.tier}/${h.row.target_tier} | ${action ? "" : `${h.action} `}${h.role}`;
    if ([...lines, line].join("\n").length > HOWTO_MAX_CHARS - 20) break;
    lines.push(line);
    listed++;
  }
  if (hits.length > listed) lines.push(`... ${hits.length - listed} more`);
  return {
    found: hits.length > 0 || own !== undefined,
    ...(own ? { id: own.id } : {}),
    text: capText(redact(lines.join("\n"))),
    tool,
    action,
    enable,
    registered: action && known ? missing === undefined : undefined,
    reverse: { tool, action, count: hits.length },
  };
}

/**
 * The answer to "how do I do this": at most 600 characters, from the row's own links, the tool
 * built for its dimension and its recorded paths, checked against what the tools accept today
 * (`reach`: locators, gates, allow-lists, the diag catalog). The target is a row id or label, a
 * task phrasing ("how do I use the menu item 'Save'"), or a tool or `tool.action` (the rows
 * linked to it). Without `reach`, no path tool counts as drivable.
 */
export function howto(
  ledger: LoadedLedger,
  aliases: Alias[],
  target: string,
  opts: { registered?: RegisteredActions; reach?: ReachContext } = {},
): HowtoResult {
  const text = target.trim();
  const reg = opts.registered ?? registeredActions();
  const reach = opts.reach ?? NO_REACH;
  const asTool = /^(?:mcp:(?:action|tool)\/)?([a-z][a-z0-9_]*)(?:\.([A-Za-z0-9_-]+))?$/.exec(text);
  if (
    asTool &&
    (reg.has(asTool[1]) ||
      linkedTools(ledger).has(asTool[1]) ||
      ledger.byId.has(`mcp:tool/${asTool[1]}`))
  ) {
    return reverseAnswer(ledger, reg, asTool[1], asTool[2]);
  }
  let row = text ? describeRow(ledger, aliases, text).row : undefined;
  let candidates: Row[] = row ? [row] : [];
  let total = row ? 1 : 0;

  if (!row && text) {
    const res = resolveTask(ledger, parseTask(text), HOWTO_LIST);
    if (res.tiedCount > 1) return ambiguousAnswer(res.tied, res.tiedCount, reach);
    candidates = res.rows;
    total = res.count;
    row = candidates[0];
  }
  if (!row)
    return { found: false, text: capText(`No row matches "${redact(text)}". Use find first.`) };

  const p = preferredPath(row);
  const t = toolActionFor(row, reach);
  const use = usable(t) ? t : undefined;
  const evidence =
    p?.evidence ?? row.disposition?.evidence ?? row.tier_evidence[0]?.ref ?? "none recorded";
  const risk = row.risk
    ? `${row.risk} (${row.risk_confirmed ? "confirmed" : "proposed"})`
    : "not assigned";
  const enable = use ? enableFor(use.tool) : undefined;
  const known = use ? knownActions(reg, ledger, use.tool) : undefined;
  const missing = use ? missingAction(known, use.action) : undefined;

  const head = `${row.id}${total > candidates.length ? ` (${total} matches)` : ""}`;
  const lines = [
    head,
    `Tier: ${row.tier} now, ${row.target_tier} target`,
    `Path: ${p ? `${p.path} (${p.status})` : row.paths.length > 0 ? "all recorded paths refuted" : "none recorded"}`,
    useLine(t),
  ];
  if (enable) lines.push(`Enable with ${enable}`);
  if (use && missing && use.action) lines.push(warnLine(use.tool, use.action, missing));
  lines.push(`Safety: ${risk}`, `Evidence: ${oneLine(evidence, EVIDENCE_WIDTH)}`);
  const matches = candidates.map((c) => matchOf(c, reach));
  for (const m of matches.slice(1)) {
    const how = m.tool
      ? `${m.tool}${m.action ? ` ${m.action}` : ""}`
      : m.notDrivable
        ? "not drivable yet"
        : "no tool";
    const line = `Also: ${m.id} (${m.tier}/${m.targetTier}; ${how})`;
    if ([...lines, line].join("\n").length > HOWTO_MAX_CHARS) break;
    lines.push(line);
  }
  return {
    found: true,
    id: row.id,
    text: capText(redact(lines.join("\n"))),
    path: p?.path,
    tool: use?.tool,
    action: use?.action,
    via: t?.via,
    drivable: t ? t.drivable : undefined,
    blocker: t?.drivable === false ? t.blocker : undefined,
    tier: row.tier,
    targetTier: row.target_tier,
    risk: row.risk,
    evidence,
    enable,
    registered: use && use.action && known ? missing === undefined : undefined,
    matches: matches.length > 1 ? matches : undefined,
  };
}

// ── scanProject ───────────────────────────────────────────────────────────────

const SCAN_SKIP_DIRS = new Set([".git", "node_modules", ".vs", "obj", "bin"]);
const SCAN_MAX_FILES = 20000;
const SCAN_MAX_SCRIPT_BYTES = 1_000_000;
const SCAN_MAX_LIST = 25;

export interface ScanOverlayRow {
  id: string;
  origin: string;
  /** True when the vanilla ledger already holds this id (the addon redeclares it). */
  inLedger: boolean;
}

export interface ScanResult {
  addon: string;
  files: number;
  truncated: boolean;
  fileTypes: { ext: string; count: number; rowId: string | null }[];
  plugins: ScanOverlayRow[];
  attributes: number;
}

/** Addon name from the folder name, limited to what the origin pattern allows. */
function addonName(dir: string): string {
  const raw = basename(resolve(dir)).replace(/[^A-Za-z0-9_.-]/g, "_");
  return raw || "addon";
}

/**
 * Walks a project folder offline (plugin, attribute and file-type
 * enumeration over the addon's files) and overlays rows tagged with the addon
 * origin. Reads files only; never makes an Enforce or Workbench call.
 */
export function scanProject(ledger: LoadedLedger, dir: string): ScanResult {
  const root = resolve(dir);
  try {
    return scanFolder(ledger, root);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // File-system errors carry absolute paths: show the folder as <project>.
    throw new Error(redact(msg.split(root).join("<project>")));
  }
}

function scanFolder(ledger: LoadedLedger, root: string): ScanResult {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`scanProject: not a folder: ${basename(root)}`);
  }
  const addon = addonName(root);
  const counts = new Map<string, number>();
  const scripts: string[] = [];
  let files = 0;
  let truncated = false;
  const stack = [root];
  while (stack.length > 0 && !truncated) {
    const cur = stack.pop() as string;
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SCAN_SKIP_DIRS.has(e.name)) stack.push(join(cur, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      if (++files > SCAN_MAX_FILES) {
        truncated = true;
        break;
      }
      const ext = extname(e.name).toLowerCase();
      if (!ext) continue;
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
      if (ext === ".c") scripts.push(join(cur, e.name));
    }
  }
  const plugins = new Map<string, ScanOverlayRow>();
  let attributes = 0;
  for (const f of scripts) {
    if (statSync(f).size > SCAN_MAX_SCRIPT_BYTES) continue;
    const src = readFileSync(f, "utf8");
    attributes += (src.match(/\[\s*(?:[A-Za-z_]\w*)?Attribute\s*\(/g) ?? []).length;
    const re =
      /\[\s*(?:WorkbenchPluginAttribute|WorkbenchToolAttribute)\s*\([^\]]*\]\s*class\s+([A-Za-z_]\w*)/g;
    for (const m of src.matchAll(re)) {
      const id = `plugin:${m[1]}`;
      plugins.set(id, { id, origin: `addon:${addon}`, inLedger: ledger.byId.has(id) });
    }
  }
  const fileTypes = [...counts.entries()]
    .map(([ext, count]) => ({
      ext,
      count,
      rowId: ledger.byId.has(`file:${ext}`) ? `file:${ext}` : null,
    }))
    .sort((a, b) => b.count - a.count || compareCodeUnits(a.ext, b.ext));
  return {
    addon,
    files: Math.min(files, SCAN_MAX_FILES),
    truncated,
    fileTypes,
    plugins: [...plugins.values()].sort((a, b) => compareCodeUnits(a.id, b.id)),
    attributes,
  };
}

export function formatScan(r: ScanResult): string {
  const lines = [
    `Offline scan of addon ${r.addon}: ${r.files} files${r.truncated ? " (stopped at the file cap)" : ""}, ${r.attributes} attribute uses, ${r.plugins.length} plugins. Overlay rows carry origin addon:${r.addon}.`,
    "File types (ext | count | ledger row):",
  ];
  for (const t of r.fileTypes.slice(0, SCAN_MAX_LIST)) {
    lines.push(`  ${t.ext} | ${t.count} | ${t.rowId ?? "no ledger row"}`);
  }
  if (r.fileTypes.length > SCAN_MAX_LIST) {
    lines.push(`  ... ${r.fileTypes.length - SCAN_MAX_LIST} more types`);
  }
  lines.push("Plugins (overlay id | origin | note):");
  if (r.plugins.length === 0) lines.push("  (none)");
  for (const p of r.plugins.slice(0, SCAN_MAX_LIST)) {
    lines.push(
      `  ${p.id} | ${p.origin} | ${p.inLedger ? "redeclares a ledger row" : "new in this addon"}`,
    );
  }
  if (r.plugins.length > SCAN_MAX_LIST)
    lines.push(`  ... ${r.plugins.length - SCAN_MAX_LIST} more`);
  return redact(lines.join("\n"));
}

// ── Registration ──────────────────────────────────────────────────────────────

function errorText(text: string): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function textOf(text: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text }] };
}

/** Names the filters whose value is not in the census vocabulary, with the valid values. */
function vocabProblems(f: FindFilters): string[] {
  const checks: [string, string | undefined, readonly string[]][] = [
    ["dim", f.dim, DIMS],
    ["kind", f.kind, KINDS],
    ["module", f.module, MODULES],
    ["tier", f.tier, TIERS],
  ];
  return checks
    .filter(([, value, valid]) => value !== undefined && !valid.includes(value))
    .map(([name, value, valid]) => `unknown ${name} "${value}"; valid: ${valid.join(", ")}`);
}

/**
 * Register the `wb_census` MCP tool.
 *
 * Read-only and offline: answers from the census ledger files shipped under
 * `data/census` and never contacts Workbench. The census root is the one the
 * library resolves (`<repo>/data/census`, from both `src/` and `dist/`); the
 * optional third argument points a test at a temporary ledger.
 */
export function registerWbCensus(
  server: McpServer,
  _config?: Config,
  censusRoot: string = DEFAULT_CENSUS_ROOT,
): void {
  server.registerTool(
    "wb_census",
    {
      description:
        "Query the census ledger: what a Workbench or game surface is and where it lives. " +
        "find: by name or id (filters dim, kind, module, tier). describe: one row by id. " +
        "status: build and counts. howto (query: a task, row id or tool name): tool, action, tier, path, safety. " +
        "scanProject walks a project folder (path) offline. Read-only, never contacts Workbench.",
      inputSchema: {
        action: z
          .enum(["find", "describe", "howto", "status", "scanProject"])
          .describe("find, describe, howto, status or scanProject"),
        path: z.string().optional().describe("scanProject: project folder to walk"),
        query: z.string().optional().describe("find: name, id or keyword"),
        id: z.string().optional().describe("describe: row id, e.g. api:WorldEditorAPI"),
        dim: z.string().optional().describe("filter: dimension, e.g. api, ui, mcp"),
        kind: z.string().optional().describe("filter: row kind, e.g. class, method, menu-item"),
        module: z.string().optional().describe("filter: module, e.g. WorldEditor"),
        tier: z.string().optional().describe("find filter: exact tier T0 to T5"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .default(DEFAULT_LIMIT)
          .describe("find: maximum rows returned"),
      },
      annotations: {
        title: "Census query",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ action, query, id, path, dim, kind, module, tier, limit }) => {
      try {
        const census = loadCensus(censusRoot);
        if (!census) {
          return errorText(
            "Error reading census: no ledger found under the census root (data/census). The census data ships with the server; reinstall or rebuild it.",
          );
        }
        const { ledger, aliases } = census;
        const filters: FindFilters = { dim, kind, module, tier };

        const problems = vocabProblems(filters);
        if (problems.length > 0) return errorText(`Error querying census: ${problems.join("; ")}`);

        if (action === "status") return textOf(formatStatus(ledger, filters));

        if (action === "howto") {
          const target = (id ?? query ?? "").trim();
          if (!target) return errorText("Error querying census: howto needs an id or a name.");
          return textOf(howto(ledger, aliases, target, { reach: census.reach }).text);
        }

        if (action === "scanProject") {
          if (!path?.trim()) {
            return errorText("Error querying census: scanProject needs path, a project folder.");
          }
          return textOf(formatScan(scanProject(ledger, path)));
        }

        if (action === "describe") {
          const target = (id ?? query ?? "").trim();
          if (!target) {
            return errorText(
              "Error querying census: describe needs an id, e.g. api:WorldEditorAPI.",
            );
          }
          const d = describeRow(ledger, aliases, target, { wording: true });
          if (!d.row && d.tied) {
            const lines = [
              `Ambiguous: ${d.tiedCount} rows fit "${redact(target)}" equally well; name the owner or the module.`,
              ...d.tied.map((t) => `- ${t}`),
            ];
            return textOf(lines.join("\n"));
          }
          if (!d.row) {
            const lines = [`No row with id "${target}".`];
            if (d.near.length > 0) lines.push(`Nearest ids: ${d.near.join(", ")}`);
            lines.push("Use find to search by name; ids look like api:<Class>.<Method>/<arity>.");
            return textOf(lines.join("\n"));
          }
          return textOf(formatDescribe(d.row, d.alias, d.parentChain, d.childrenIds));
        }

        // find
        const text = (query ?? "").trim();
        const hasFilter = Boolean(dim || kind || module || tier);
        if (!text && !hasFilter) {
          return errorText("Error querying census: find needs a query or at least one filter.");
        }
        const res = find(ledger, text, filters, 1, limit);
        const filterDesc = [
          dim && `dim=${dim}`,
          kind && `kind=${kind}`,
          module && `module=${module}`,
          tier && `tier=${tier}`,
        ]
          .filter(Boolean)
          .join(", ");
        if (res.count === 0) {
          return textOf(
            `${headerOf(ledger)}\nNo rows match "${text}"${filterDesc ? ` with ${filterDesc}` : ""}. ` +
              "Try a shorter query, drop a filter, or search by a class or method name instead of a description.",
          );
        }
        const lines = [headerOf(ledger)];
        lines.push(
          `Found ${res.count} row${res.count !== 1 ? "s" : ""}${filterDesc ? ` (${filterDesc})` : ""}; showing ${res.rows.length}`,
        );
        lines.push("id | kind | module | tier/target | name | what");
        lines.push("---");
        for (const r of res.rows) lines.push(formatHit(r));
        lines.push("---");
        if (res.count > res.rows.length) {
          lines.push(
            `${res.count - res.rows.length} more not shown: narrow with dim, kind, module or tier, or raise limit (max ${MAX_LIMIT}).`,
          );
        }
        lines.push("Use describe with an id for the full record.");
        return textOf(lines.join("\n"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorText(`Error querying census: ${msg}`);
      }
    },
  );
}
