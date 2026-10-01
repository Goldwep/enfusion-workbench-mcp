/**
 * Coverage arithmetic and its two renderings (plan 1.5). One computation
 * serves `query.ts status`, `report.ts --summary` (text) and `COVERAGE.md`
 * (Markdown), so the numbers cannot drift between them.
 *
 * Never a single percentage. Each row (aggregate rows excluded and counted
 * apart) falls in exactly one class:
 *   driven      T5 on the current build with a strong oracle
 *   weak        passes only with the weak oracle (reported apart, plan 1.4)
 *   known       carries a terminal disposition (split by disposition class)
 *   unexplored  deferred, on the frontier, or recon-only (provisional)
 *   in-progress everything else (active, explored, below T5)
 * Tables are printed twice: headline (shard `core`) and all shards.
 */
import { compareCodeUnits } from "./canon.js";
import type { GateRun } from "./gates.js";
import type { Row } from "./schemas.js";
import { DISPOSITION_KINDS, TIERS, type Tier } from "./vocab.js";

export type CoverageClass = "driven" | "weak" | "known" | "unexplored" | "in-progress";

export interface Cell {
  rows: number;
  driven: number;
  weak: number;
  known: Record<string, number>;
  unexplored: number;
  inProgress: number;
}

export interface Scope {
  name: "headline" | "all";
  rows: number;
  aggregate: number;
  histogram: Record<Tier, number>;
  total: Cell;
  byDim: Record<string, Cell>;
  byModule: Record<string, Cell>;
  byKind: Record<string, Cell>;
}

export interface Coverage {
  build: { tag: string; branch: string; ui_language: string };
  shards: { name: string; rows: number }[];
  enumerators: { done: string[]; pending: string[] };
  headline: Scope;
  all: Scope;
  deferred: string[];
  unsignedDispositions: string[];
  unverifiedRefs: Record<string, number>;
  ledgerSha: string;
}

/** The single class a row counts in. */
export function classify(row: Row): CoverageClass {
  if (row.tier === "T5" && !row.weak_only) return "driven";
  if (row.weak_only) return "weak";
  if (row.disposition) return "known";
  if (row.status === "deferred" || row.children_enumerated === false || row.provisional)
    return "unexplored";
  return "in-progress";
}

function emptyCell(): Cell {
  return { rows: 0, driven: 0, weak: 0, known: {}, unexplored: 0, inProgress: 0 };
}

function add(cell: Cell, row: Row): void {
  cell.rows++;
  const c = classify(row);
  if (c === "driven") cell.driven++;
  else if (c === "weak") cell.weak++;
  else if (c === "known") {
    const k = row.disposition?.kind ?? "unknown";
    cell.known[k] = (cell.known[k] ?? 0) + 1;
  } else if (c === "unexplored") cell.unexplored++;
  else cell.inProgress++;
}

function scope(name: Scope["name"], rows: readonly Row[]): Scope {
  const histogram = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const total = emptyCell();
  const byDim: Record<string, Cell> = {};
  const byModule: Record<string, Cell> = {};
  const byKind: Record<string, Cell> = {};
  let aggregate = 0;
  for (const r of rows) {
    if (r.aggregate) {
      aggregate++;
      continue;
    }
    histogram[r.tier]++;
    add(total, r);
    add((byDim[r.dim] ??= emptyCell()), r);
    add((byModule[r.module] ??= emptyCell()), r);
    add((byKind[r.kind] ??= emptyCell()), r);
  }
  return {
    name,
    rows: rows.length - aggregate,
    aggregate,
    histogram,
    total,
    byDim,
    byModule,
    byKind,
  };
}

export interface CoverageInput {
  rows: readonly Row[];
  build: { tag: string; branch: string; ui_language: string };
  enumerators: { done: string[]; pending: string[] };
  unverifiedRefs: Record<string, number>;
  ledgerSha: string;
}

export function computeCoverage(input: CoverageInput): Coverage {
  const shards = new Map<string, number>();
  for (const r of input.rows) shards.set(r.shard, (shards.get(r.shard) ?? 0) + 1);
  return {
    build: input.build,
    shards: [...shards.entries()]
      .sort((a, b) => compareCodeUnits(a[0], b[0]))
      .map(([name, rows]) => ({ name, rows })),
    enumerators: input.enumerators,
    headline: scope(
      "headline",
      input.rows.filter((r) => r.shard === "core"),
    ),
    all: scope("all", input.rows),
    deferred: input.rows.filter((r) => r.status === "deferred").map((r) => r.id),
    unsignedDispositions: input.rows
      .filter(
        (r) =>
          (r.disposition?.kind === "excluded-policy" ||
            r.disposition?.kind === "not-automatable") &&
          !r.owner_signoff,
      )
      .map((r) => r.id),
    unverifiedRefs: input.unverifiedRefs,
    ledgerSha: input.ledgerSha,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** The header line every status rendering starts with (plan 1.5 wording). */
export function headerLine(c: Coverage): string {
  const n = c.all.rows + c.all.aggregate;
  const done = c.enumerators.done.length ? c.enumerators.done.join(", ") : "none";
  return (
    `census build ${c.build.tag} (${c.build.branch}, ${c.build.ui_language}) — ${n} row${n !== 1 ? "s" : ""} ` +
    `in ${c.shards.length} shard${c.shards.length !== 1 ? "s" : ""} — complete relative to enumerators ${done} ` +
    `at build ${c.build.tag}; pending: ${c.enumerators.pending.join(", ") || "none"}`
  );
}

function knownText(known: Record<string, number>): string {
  const total = Object.values(known).reduce((a, b) => a + b, 0);
  if (total === 0) return "0";
  const parts = DISPOSITION_KINDS.filter((k) => known[k]).map((k) => `${k} ${known[k]}`);
  return `${total} (${parts.join(", ")})`;
}

const COLUMNS = [
  "Rows",
  "Driven and verified",
  "Weak oracle",
  "Known, not driven",
  "Unexplored",
  "In progress",
];

function cellValues(c: Cell): string[] {
  return [
    `${c.rows}`,
    `${c.driven}`,
    `${c.weak}`,
    knownText(c.known),
    `${c.unexplored}`,
    `${c.inProgress}`,
  ];
}

function histogramText(s: Scope): string {
  return TIERS.map((t) => `${t} ${s.histogram[t]}`).join("  ");
}

function textTable(title: string, cells: Record<string, Cell>): string[] {
  const keys = Object.keys(cells).sort(compareCodeUnits);
  const lines = [`  ${title}:`];
  if (keys.length === 0) {
    lines.push("    (no rows)");
    return lines;
  }
  const width = Math.max(...keys.map((k) => k.length), 8);
  lines.push(`    ${"".padEnd(width)}  ${COLUMNS.join(" | ")}`);
  for (const k of keys) lines.push(`    ${k.padEnd(width)}  ${cellValues(cells[k]).join(" | ")}`);
  return lines;
}

/** Plain-text rendering (`query.ts status`, `report.ts --summary`). */
export function renderCoverageText(c: Coverage, gates?: GateRun): string {
  const lines: string[] = [];
  if (gates) {
    lines.push(`gates (phase ${gates.phase}):`);
    for (const g of gates.gates)
      lines.push(`  ${g.gate.padEnd(3)} ${g.status.padEnd(7)} ${g.summary}`);
    lines.push("");
  }
  lines.push(headerLine(c));
  for (const s of [c.headline, c.all]) {
    lines.push("");
    lines.push(
      `${s.name === "headline" ? "headline (shard core)" : "all shards"}: ${s.rows} row${s.rows !== 1 ? "s" : ""}, ${s.aggregate} aggregate excluded`,
    );
    lines.push(`  tier histogram: ${histogramText(s)}`);
    lines.push(
      `  ${COLUMNS.slice(1)
        .map((h, i) => `${h} ${cellValues(s.total)[i + 1]}`)
        .join("; ")}`,
    );
    lines.push(...textTable("by dimension", s.byDim));
    lines.push(...textTable("by module", s.byModule));
    lines.push(...textTable("by kind", s.byKind));
  }
  return lines.join("\n") + "\n";
}

/** A Markdown table with columns padded the way prettier aligns them (so `npm run format` is a no-op). */
export function alignedTable(
  header: readonly string[],
  body: readonly (readonly string[])[],
): string[] {
  const widths = header.map((h, i) => Math.max(3, h.length, ...body.map((r) => r[i].length)));
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
  return [line(header), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...body.map(line)];
}

function mdTable(cells: Record<string, Cell>, first: string): string[] {
  const keys = Object.keys(cells).sort(compareCodeUnits);
  if (keys.length === 0) return ["No rows yet."];
  return alignedTable(
    [first, ...COLUMNS],
    keys.map((k) => [k, ...cellValues(cells[k])]),
  );
}

/** Markdown rendering for `docs/v2/COVERAGE.md`. No dates; the build tag and ledger hash identify it. */
export function renderCoverageMarkdown(c: Coverage, gates: GateRun): string {
  const out: string[] = [];
  out.push("# Coverage");
  out.push("");
  out.push("Generated by `scripts/census/report.ts` from the census ledger. Do not edit by hand.");
  out.push("");
  out.push(`- Build: \`${c.build.tag}\` (${c.build.branch}, UI language ${c.build.ui_language})`);
  out.push(`- Ledger sha256 (all shards): \`${c.ledgerSha.slice(0, 12)}\``);
  out.push(`- ${headerLine(c).replace(/^census build [^—]*— /, "")}`);
  out.push("");
  out.push(
    "Never read one number on its own: each table gives the three plan 1.5 numbers (Driven and",
  );
  out.push("verified, Known not driven, Unexplored) plus weak-oracle passes and work in progress.");
  out.push("");
  out.push(`## Gates (phase ${gates.phase})`);
  out.push("");
  out.push(
    ...alignedTable(
      ["Gate", "Status", "Summary"],
      gates.gates.map((g) => [g.gate, g.status, g.summary.replace(/\|/g, "\\|")]),
    ),
  );
  for (const s of [c.headline, c.all]) {
    out.push("");
    out.push(s.name === "headline" ? "## Headline (shard core)" : "## All shards");
    out.push("");
    out.push(
      `${s.rows} row${s.rows !== 1 ? "s" : ""}; ${s.aggregate} aggregate row${s.aggregate !== 1 ? "s" : ""} excluded from every number.`,
    );
    out.push("");
    out.push("### Tier histogram");
    out.push("");
    out.push(...alignedTable(TIERS, [TIERS.map((t) => `${s.histogram[t]}`)]));
    for (const [title, cells, first] of [
      ["By dimension", s.byDim, "Dimension"],
      ["By module", s.byModule, "Module"],
      ["By kind", s.byKind, "Kind"],
    ] as const) {
      out.push("");
      out.push(`### ${title}`);
      out.push("");
      out.push(...mdTable(cells, first));
    }
  }
  out.push("");
  out.push("## Pending and open items");
  out.push("");
  out.push(
    `- Enumerators pending at build \`${c.build.tag}\`: ${c.enumerators.pending.join(", ") || "none"}`,
  );
  out.push(`- Deferred rows: ${c.deferred.length}`);
  out.push(`- Dispositions awaiting owner sign-off: ${c.unsignedDispositions.length}`);
  const refs = Object.keys(c.unverifiedRefs).sort(compareCodeUnits);
  out.push(
    `- References not verifiable on this machine: ${refs.length ? refs.map((e) => `${e} ${c.unverifiedRefs[e]}`).join(", ") : "none"}`,
  );
  return out.join("\n") + "\n";
}
