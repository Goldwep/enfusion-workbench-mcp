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
import { TIERS } from "./vocab.js";

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

/** Resolves an id (or an alias of one) to its row. */
export function describe(
  ledger: LoadedLedger,
  aliases: readonly Alias[],
  id: string,
): DescribeResult {
  let row = ledger.byId.get(id) ?? null;
  let alias: Alias | undefined;
  if (!row) {
    alias = aliases.find((a) => a.from === id);
    if (alias) row = ledger.byId.get(alias.to) ?? null;
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
    near: [],
    parentChain: parentChain(ledger, row.id),
    childrenIds: childrenIds(ledger, row.id),
  };
}

/** Replaces a string that looks like a machine path with `<redacted-path>`. */
export function redact(s: string): string {
  return containsMachinePath(s) ? "<redacted-path>" : s;
}
