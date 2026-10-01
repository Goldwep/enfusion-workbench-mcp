/**
 * E01 — recon import (plan 4.5; Phase 0 item 10). Done by script, no model.
 *
 * Reads the eight recon files (plan 2.1: markdown tables of feature rows
 * with covered / partial / none readings) and writes provisional
 * observations to `data/census/observations/E01/<build>.jsonl`, plus a
 * `probes.jsonl` seed from every probe, unverified or open-question table or
 * list. Every E01 source is capped at confidence `low`, the file header says
 * `provisional: true`, and rows that stand for several features are flagged
 * `aggregate: true`. Every E01 row must later merge into a row of a real
 * enumerator or be explained (G6).
 *
 * WHAT IS A GUESS (the real recon files are local-only and were not
 * available when this was written; main ruling 17):
 *  - the table layout: a header row, a separator row, one feature per row;
 *  - which header names mean label / kind / what / coverage / module / risk,
 *    the coverage spellings, the kind words, the heading keywords that give
 *    a table its default kind and module, and the aggregate patterns. All of
 *    these live in `e01-mapping.json` so the REVIEWER pass corrects data, not
 *    code;
 *  - that probe / unverified / open-question material sits under a heading
 *    with one of those words, or in a table with such a column.
 * WHAT IS NOT A GUESS: determinism (sorted output, no timestamps; a second
 * run is byte-identical), the output location (only observations/E01/), the
 * low-confidence cap, the provisional header, and reporting every dropped
 * row and table with its reason.
 *
 *   npx tsx scripts/census/enumerators/e01-recon-import.ts [--recon <dir>] [--build <tag>]
 *       [--out <file under observations/E01/>] [--no-probes] [--data <dir>] [--json]
 *
 * --recon  default <repo>/docs/v2/recon (the census root's repository)
 * --build  default data/census/current-build.json `tag`
 *
 * Exit: 0 written; 1 refused (output outside observations/E01/); 2 usage or
 * no recon directory (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, sha256, splitLines } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId, normalizeLabel } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import { foldProbes } from "../../../src/census/state.js";
import { appendProbeLine } from "../../../src/census/writers.js";
import {
  KINDS,
  MODULES,
  RISKS,
  type Dim,
  type Kind,
  type Risk,
} from "../../../src/census/vocab.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "../cli-common.js";

/** Enumerator id (main ruling 11). */
export const ENUMERATOR_ID = "E01";
/** Registered generator path (must equal universes.json `enumerators.E01.generator`). */
export const GENERATOR = "scripts/census/enumerators/e01-recon-import.ts";
const MAPPING_FILE = join(import.meta.dirname ?? ".", "e01-mapping.json");
const QUOTE_MAX = 200;

// ── Mapping ───────────────────────────────────────────────────────────────────

type ColumnName = "label" | "kind" | "what" | "coverage" | "module" | "risk";
type Coverage = "covered" | "partial" | "none";

export interface E01Mapping {
  files: Record<string, { module: string }>;
  columns: Record<ColumnName, string[]>;
  tri_columns: Record<Coverage, string[]>;
  tri_marks: string[];
  coverage_values: Record<Coverage, string[]>;
  kind_values: Record<string, string>;
  heading_kinds: { pattern: string; kind: string }[];
  file_default_kinds: Record<string, string>;
  module_values: Record<string, string>;
  heading_modules: { pattern: string; module: string }[];
  risk_values: Record<string, string>;
  kind_dims: Record<string, string>;
  aggregate_patterns: string[];
  summary_labels: string[];
  probe_headings: string;
  probe_columns: string;
}

export function loadMapping(file: string = MAPPING_FILE): E01Mapping {
  return JSON.parse(readFileSync(file, "utf-8")) as E01Mapping;
}

// ── Markdown parsing ──────────────────────────────────────────────────────────

/** Removes emphasis, backticks and link syntax; collapses whitespace. */
export function cleanCell(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/(^|\s)_{1,2}([^_\s][^_]*)_{1,2}(?=\s|$)/g, "$1$2")
    .replace(/`/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a markdown table row into cells (escaped `\|` kept). */
export function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (t[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

export interface MdTable {
  /** 1-based line of the header row. */
  line: number;
  headings: string[];
  header: string[];
  rows: { line: number; cells: string[]; raw: string }[];
}

export interface MdListItem {
  line: number;
  headings: string[];
  text: string;
  raw: string;
}

/** Finds every table and list item with the heading path above it (nearest last). */
export function parseMarkdown(text: string): { tables: MdTable[]; items: MdListItem[] } {
  const lines = splitLines(text);
  const tables: MdTable[] = [];
  const items: MdListItem[] = [];
  const stack: { level: number; text: string }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      while (stack.length && stack[stack.length - 1].level >= h[1].length) stack.pop();
      stack.push({ level: h[1].length, text: cleanCell(h[2]) });
      continue;
    }
    const headings = stack.map((s) => s.text);
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const table: MdTable = {
        line: i + 1,
        headings,
        header: splitRow(line).map(cleanCell),
        rows: [],
      };
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        table.rows.push({ line: j + 1, cells: splitRow(lines[j]), raw: lines[j] });
        j++;
      }
      tables.push(table);
      i = j - 1;
      continue;
    }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) items.push({ line: i + 1, headings, text: cleanCell(li[1]), raw: line });
  }
  return { tables, items };
}

// ── Row mapping ───────────────────────────────────────────────────────────────

function norm(s: string): string {
  return cleanCell(s).toLowerCase();
}

function headerMatches(cell: string, synonyms: readonly string[]): "exact" | "prefix" | null {
  const c = norm(cell);
  if (synonyms.includes(c)) return "exact";
  if (synonyms.some((s) => c.startsWith(`${s} `) || c.startsWith(`${s}(`))) return "prefix";
  return null;
}

/** Column index per mapped column: exact header matches win over prefix matches. */
export function mapColumns(
  header: readonly string[],
  m: E01Mapping,
): Partial<Record<ColumnName, number>> {
  const out: Partial<Record<ColumnName, number>> = {};
  const used = new Set<number>();
  for (const pass of ["exact", "prefix"] as const) {
    for (const col of ["label", "coverage", "kind", "what", "module", "risk"] as ColumnName[]) {
      if (out[col] !== undefined) continue;
      const idx = header.findIndex(
        (h, i) => !used.has(i) && headerMatches(h, m.columns[col]) === pass,
      );
      if (idx !== -1) {
        out[col] = idx;
        used.add(idx);
      }
    }
  }
  return out;
}

function triColumns(header: readonly string[], m: E01Mapping): Record<Coverage, number> | null {
  const find = (c: Coverage): number => header.findIndex((h) => m.tri_columns[c].includes(norm(h)));
  const t = { covered: find("covered"), partial: find("partial"), none: find("none") };
  return t.covered !== -1 && t.partial !== -1 && t.none !== -1 ? t : null;
}

function readCoverage(value: string, m: E01Mapping): Coverage | null {
  const v = norm(value);
  for (const c of ["covered", "partial", "none"] as Coverage[]) {
    if (m.coverage_values[c].includes(v)) return c;
    if (m.coverage_values[c].some((x) => x.length > 2 && v.startsWith(`${x} `))) return c;
  }
  return null;
}

function headingMatch<R extends { pattern: string }>(
  headings: readonly string[],
  rules: readonly R[],
  pick: (rule: R) => string,
): string | undefined {
  for (let i = headings.length - 1; i >= 0; i--) {
    for (const r of rules) if (new RegExp(r.pattern, "i").test(headings[i])) return pick(r);
  }
  return undefined;
}

function kindOf(value: string): Kind | undefined {
  const v = value.toLowerCase().replace(/\s+/g, "-");
  return (KINDS as readonly string[]).includes(v) ? (v as Kind) : undefined;
}

function buildKey(kind: Kind, dim: Dim, label: string): Observation["key"] {
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (dim === "ui") {
    const path = label
      .split(/\s+(?:>|→|›|»)\s+/)
      .map(normalizeLabel)
      .filter((s) => s.length > 0);
    return path.length ? { path } : { name: label };
  }
  if (kind === "cli-switch" && /^-{0,2}[A-Za-z][\w-]*$/.test(label))
    return { switch: label.replace(/^-+/, "") };
  if (kind === "mcp-tool" && /^[a-z][a-z0-9_]*$/.test(label)) return { tool: label };
  if (kind === "file-type" && /^\.?[A-Za-z0-9]+$/.test(label))
    return { ext: label.replace(/^\./, "") };
  if ((kind === "plugin" || kind === "class" || kind === "enum") && ident.test(label))
    return { class: label };
  if (kind === "net-function" && ident.test(label)) return { native: label };
  if (kind === "net-handler" && ident.test(label)) return { handler: label };
  return { name: label };
}

export interface Dropped {
  file: string;
  line: number;
  reason: string;
}

export interface TableReport {
  file: string;
  line: number;
  heading: string;
  rows: number;
  emitted: number;
  aggregate: number;
  dropped: number;
  probes: number;
  unmappable?: string;
}

export interface ProbeSeed {
  id: string;
  source: string;
  question: string;
}

export interface ImportResult {
  observations: { id: string; obs: Observation }[];
  probes: ProbeSeed[];
  tables: TableReport[];
  dropped: Dropped[];
  inputs: { path: string; sha256: string }[];
  missingFiles: string[];
}

function ref(file: string, line: number): string {
  return `<repo>/docs/v2/recon/${file}#L${line}`;
}

function quoteOf(raw: string): string {
  return raw.trim().slice(0, QUOTE_MAX);
}

/** Imports one directory of recon files. Pure apart from reading `reconDir`. */
export function importRecon(reconDir: string, m: E01Mapping): ImportResult {
  const files = readdirSync(reconDir)
    .filter((f) => f.endsWith(".md"))
    .sort(compareCodeUnits);
  const missingFiles = Object.keys(m.files)
    .filter((f) => !files.includes(f))
    .sort(compareCodeUnits);
  const observations: { id: string; obs: Observation }[] = [];
  const seenIds = new Map<string, string>();
  const probes: ProbeSeed[] = [];
  const tables: TableReport[] = [];
  const dropped: Dropped[] = [];
  const inputs: { path: string; sha256: string }[] = [];
  const aggregateRes = m.aggregate_patterns.map((p) => new RegExp(p, "i"));
  const probeHeading = new RegExp(m.probe_headings, "i");
  const probeColumn = new RegExp(m.probe_columns, "i");

  for (const file of files) {
    if (!/^[a-z0-9-]+\.md$/.test(file)) {
      dropped.push({ file, line: 0, reason: "file name is not of the form <kebab-case>.md" });
      continue;
    }
    const text = readFileSync(join(reconDir, file), "utf-8");
    inputs.push({ path: `<repo>/docs/v2/recon/${file}`, sha256: sha256(text) });
    const { tables: mdTables, items } = parseMarkdown(text);
    const fileModule = m.files[file]?.module ?? "none";

    const addProbe = (line: number, question: string, raw: string): boolean => {
      if (!question || containsMachinePath(raw)) {
        dropped.push({
          file,
          line,
          reason: question ? "probe text contains a machine path" : "empty probe text",
        });
        return false;
      }
      probes.push({
        id: `P-E01-${file.replace(/\.md$/, "")}-L${line}`,
        source: ref(file, line),
        question,
      });
      return true;
    };

    for (const it of items) {
      if (it.headings.length && probeHeading.test(it.headings[it.headings.length - 1])) {
        addProbe(it.line, it.text, it.raw);
      }
    }

    for (const t of mdTables) {
      const heading = t.headings[t.headings.length - 1] ?? "";
      const report: TableReport = {
        file,
        line: t.line,
        heading,
        rows: t.rows.length,
        emitted: 0,
        aggregate: 0,
        dropped: 0,
        probes: 0,
      };
      tables.push(report);
      const cols = mapColumns(t.header, m);
      const tri = triColumns(t.header, m);
      const hasCoverage = tri !== null || cols.coverage !== undefined;
      const probeTable =
        (heading !== "" && probeHeading.test(heading)) ||
        (!hasCoverage && t.header.some((h) => probeColumn.test(h)));
      if (probeTable) {
        const qIdx = Math.max(
          0,
          t.header.findIndex((h) => probeColumn.test(h)),
        );
        for (const r of t.rows) {
          if (addProbe(r.line, cleanCell(r.cells[qIdx] ?? ""), r.raw)) report.probes++;
          else report.dropped++;
        }
        continue;
      }
      if (cols.label === undefined) {
        report.unmappable = "no label column";
        report.dropped = t.rows.length;
        dropped.push({
          file,
          line: t.line,
          reason: `table "${heading}" unmappable: no label column (${t.header.join(" | ")})`,
        });
        continue;
      }
      if (!hasCoverage) {
        report.unmappable = "no coverage column";
        report.dropped = t.rows.length;
        dropped.push({
          file,
          line: t.line,
          reason: `table "${heading}" unmappable: no coverage column (${t.header.join(" | ")})`,
        });
        continue;
      }
      const tableKind =
        headingMatch(t.headings, m.heading_kinds, (r) => r.kind) ?? m.file_default_kinds[file];
      const tableModule =
        headingMatch(t.headings, m.heading_modules, (r) => r.module) ?? fileModule;

      for (const r of t.rows) {
        const drop = (reason: string): void => {
          report.dropped++;
          dropped.push({ file, line: r.line, reason });
        };
        const cell = (c: number | undefined): string =>
          c === undefined ? "" : cleanCell(r.cells[c] ?? "");
        const label = cell(cols.label);
        if (!label) {
          drop("empty label");
          continue;
        }
        if (m.summary_labels.includes(label.toLowerCase())) {
          drop("summary row");
          continue;
        }
        if (containsMachinePath(r.raw)) {
          drop("row contains a machine path");
          continue;
        }
        let coverage: Coverage | null = null;
        if (tri) {
          const marks = (["covered", "partial", "none"] as Coverage[]).filter((c) =>
            m.tri_marks.includes(norm(r.cells[tri[c]] ?? "")),
          );
          coverage = marks.length === 1 ? marks[0] : null;
        } else coverage = readCoverage(cell(cols.coverage), m);
        if (!coverage) {
          drop(
            `coverage reading unrecognised (${tri ? "covered/partial/none marks" : cell(cols.coverage) || "empty"})`,
          );
          continue;
        }
        const kindCell = cell(cols.kind);
        const kind: Kind | undefined = kindCell
          ? ((m.kind_values[kindCell.toLowerCase()] as Kind | undefined) ?? kindOf(kindCell))
          : (tableKind as Kind | undefined);
        if (!kind || !(KINDS as readonly string[]).includes(kind)) {
          drop(`kind unmappable (${kindCell || `heading "${heading}"`})`);
          continue;
        }
        const moduleCell = cell(cols.module);
        const module = moduleCell
          ? (m.module_values[moduleCell.toLowerCase()] ?? moduleCell)
          : tableModule;
        if (!(MODULES as readonly string[]).includes(module)) {
          drop(`module unmappable (${moduleCell})`);
          continue;
        }
        const riskCell = cell(cols.risk).toLowerCase();
        const risk = riskCell ? (m.risk_values[riskCell] as Risk | undefined) : undefined;
        if (riskCell && (!risk || !(RISKS as readonly string[]).includes(risk))) {
          drop(`risk unmappable (${riskCell})`);
          continue;
        }
        const dim = (m.kind_dims[kind] ?? "ui") as Dim;
        const what = cell(cols.what);
        const aggregate = aggregateRes.some((re) => re.test(label));
        const obs: Observation = {
          dim,
          kind,
          module: module as Observation["module"],
          key: buildKey(kind, dim, label),
          label:
            dim === "ui"
              ? normalizeLabel(label.split(/\s+(?:>|→|›|»)\s+/).pop() ?? label) || label
              : label,
          what: what || undefined,
          risk_hint: risk,
          origin: "vanilla",
          aggregate: aggregate || undefined,
          ref: ref(file, r.line),
          quote: quoteOf(r.raw),
          confidence: "low",
          recon_coverage: coverage,
        };
        const parsed = observationSchema.safeParse(obs);
        if (!parsed.success) {
          drop(
            `observation invalid: ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`,
          );
          continue;
        }
        let id: string;
        try {
          id = deriveId(parsed.data, { allowGeneric: true });
        } catch (e) {
          drop(e instanceof Error ? e.message : String(e));
          continue;
        }
        const prior = seenIds.get(id);
        if (prior) {
          drop(`duplicate of ${prior} (same id ${id})`);
          continue;
        }
        seenIds.set(id, `${file}:${r.line}`);
        observations.push({ id, obs: parsed.data });
        report.emitted++;
        if (aggregate) report.aggregate++;
      }
    }
  }
  observations.sort((a, b) => compareCodeUnits(a.id, b.id));
  return { observations, probes, tables, dropped, inputs, missingFiles };
}

/** Exact text of the E01 observation file. */
export function observationFileText(result: ImportResult, build: string): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: result.inputs,
    provisional: true,
    row_count: result.observations.length,
  };
  const lines = [
    jsonlLine(header, ["$header"]),
    ...result.observations.map((o) => jsonlLine(o.obs)),
  ];
  return lines.join("\n") + "\n";
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e01-recon-import.ts [--recon <dir>] [--build <tag>] [--out <file under observations/E01/>] [--no-probes] [--data <dir>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E01/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E01/ (E01 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e01-recon-import", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        recon: { type: "string" },
        build: { type: "string" },
        out: { type: "string" },
        "no-probes": { type: "boolean" },
        data: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const paths = pathsFrom(values.data);
    const build = values.build ?? loadCurrentBuild(paths).tag;
    let out: string;
    try {
      out = resolveOut(paths, values.out, build);
    } catch (e) {
      io.err(`e01-recon-import: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const reconDir = values.recon ? resolve(values.recon) : join(paths.repo, "docs", "v2", "recon");
    if (!existsSync(reconDir)) {
      io.out("NO DATA: no recon directory (docs/v2/recon is local-only); nothing imported");
      return EXIT_USAGE;
    }
    const result = importRecon(reconDir, loadMapping());
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(result, build));

    let seeded = 0;
    if (!values["no-probes"]) {
      const existing = foldProbes(paths).probes;
      for (const p of result.probes) {
        if (existing.has(p.id)) continue;
        appendProbeLine(paths, {
          id: p.id,
          op: "open",
          source: p.source,
          question: p.question,
          status: "open",
          by: "e01-recon-import.ts",
        });
        seeded++;
      }
    }

    const emitted = result.observations.length;
    const aggregates = result.observations.filter((o) => o.obs.aggregate).length;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e01-recon-import",
          build,
          emitted,
          aggregates,
          probes_found: result.probes.length,
          probes_seeded: seeded,
          tables: result.tables,
          dropped: result.dropped,
          missing_files: result.missingFiles,
        }),
      );
      return EXIT_OK;
    }
    for (const t of result.tables) {
      io.out(
        `${t.file}:${t.line} "${t.heading}": rows ${t.rows}, emitted ${t.emitted}, aggregate ${t.aggregate}, ` +
          `probes ${t.probes}, dropped ${t.dropped}${t.unmappable ? ` (unmappable: ${t.unmappable})` : ""}`,
      );
    }
    for (const d of result.dropped) io.out(`dropped ${d.file}:${d.line}: ${d.reason}`);
    for (const f of result.missingFiles) io.out(`missing recon file ${f}`);
    io.out(
      `E01 at build ${build}: ${emitted} provisional observation${emitted !== 1 ? "s" : ""} (${aggregates} aggregate), ` +
        `${result.dropped.length} dropped, ${result.probes.length} probe${result.probes.length !== 1 ? "s" : ""} found, ${seeded} newly seeded`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
