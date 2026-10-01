/**
 * Census file locations and line-oriented I/O. Every census script resolves
 * its files through `censusPaths` so a test can point the whole set at a
 * temporary directory (`--data <dir>`).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { splitLines } from "./canon.js";
import type { Row } from "./schemas.js";
import { SHARDS, type Shard } from "./vocab.js";

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * A census file is malformed (bad JSON line, duplicate id, schema violation).
 * CLIs branch on it to exit 3 instead of 1, so a corrupt ledger is never read
 * as "not found".
 */
export class CensusDataError extends Error {
  readonly code = "MALFORMED";
  constructor(message: string) {
    super(message);
    this.name = "CensusDataError";
  }
}

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `<repo>/data/census`, from both `src/census/` and a compiled `dist/census/`. */
export const DEFAULT_CENSUS_ROOT = resolve(
  import.meta.dirname ?? ".",
  "..",
  "..",
  "data",
  "census",
);

export interface CensusPaths {
  root: string;
  /** Repository root: two levels above the census root (`<repo>/data/census`). */
  repo: string;
  shards: Record<Shard, string>;
  meta: string;
  state: string;
  aliases: string;
  universes: string;
  policy: string;
  probes: string;
  stateMatrix: string;
  currentBuild: string;
  g4Rules: string;
  knownDefects: string;
  observations: string;
  evidence: string;
  liveResults: string;
  schema: string;
}

/** File name of a shard: `ledger.jsonl` for core, `ledger.<shard>.jsonl` otherwise. */
export function shardFileName(shard: Shard): string {
  return shard === "core" ? "ledger.jsonl" : `ledger.${shard}.jsonl`;
}

export function censusPaths(root: string = DEFAULT_CENSUS_ROOT): CensusPaths {
  const r = resolve(root);
  const shards = {} as Record<Shard, string>;
  for (const s of SHARDS) shards[s] = join(r, shardFileName(s));
  return {
    root: r,
    repo: dirname(dirname(r)),
    shards,
    meta: join(r, "ledger.meta.json"),
    state: join(r, "state.jsonl"),
    aliases: join(r, "aliases.json"),
    universes: join(r, "universes.json"),
    policy: join(r, "policy.json"),
    probes: join(r, "probes.jsonl"),
    stateMatrix: join(r, "state-matrix.json"),
    currentBuild: join(r, "current-build.json"),
    g4Rules: join(r, "g4-rules.json"),
    knownDefects: join(r, "known-defects.json"),
    observations: join(r, "observations"),
    evidence: join(r, "evidence"),
    liveResults: join(r, "live-results"),
    schema: join(r, "schema"),
  };
}

// ── Reading ───────────────────────────────────────────────────────────────────

export interface JsonlLine {
  /** 1-based line number in the file. */
  line: number;
  value: unknown;
  /** The raw text of the line. */
  text: string;
}

/**
 * Reads a JSONL file. A missing file reads as no lines. Blank lines are
 * skipped; a line that is not JSON throws `CensusDataError` naming file and line.
 */
export function readJsonl(file: string, displayName: string = file): JsonlLine[] {
  if (!existsSync(file)) return [];
  const out: JsonlLine[] = [];
  const lines = splitLines(readFileSync(file, "utf-8"));
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.trim() === "") continue;
    try {
      out.push({ line: i + 1, value: JSON.parse(text), text });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new CensusDataError(`${displayName} line ${i + 1}: not valid JSON (${msg})`);
    }
  }
  return out;
}

/** Reads a JSON file, or returns `fallback` when it is absent. Throws `CensusDataError` on bad JSON. */
export function readJson<T>(file: string, fallback: T, displayName: string = file): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CensusDataError(`${displayName}: not valid JSON (${msg})`);
  }
}

/** Writes a file through a temporary sibling and a rename, so a reader never sees half a file. */
export function writeFileAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf-8");
  renameSync(tmp, file);
}

// ── Observation files ─────────────────────────────────────────────────────────

export interface ObservationFileRef {
  enumerator: string;
  build: string;
  /** Absolute path. */
  file: string;
  /** Census-relative path with forward slashes (`observations/E01/unknown.jsonl`). */
  rel: string;
}

/** Lists `observations/<enumerator>/<build>.jsonl` files in code-unit order. */
export function listObservationFiles(paths: CensusPaths): ObservationFileRef[] {
  if (!existsSync(paths.observations)) return [];
  const out: ObservationFileRef[] = [];
  const dirs = readdirSync(paths.observations, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const enumerator of dirs) {
    const dir = join(paths.observations, enumerator);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const f of files) {
      out.push({
        enumerator,
        build: f.slice(0, -".jsonl".length),
        file: join(dir, f),
        rel: `observations/${enumerator}/${f}`,
      });
    }
  }
  return out;
}

// ── Ledger loading (query side) ───────────────────────────────────────────────

export interface LedgerMeta {
  build: { tag: string; branch: string; ui_language: string };
  [key: string]: unknown;
}

export interface LoadedLedger {
  rows: Row[];
  byId: Map<string, Row>;
  children: Map<string, Row[]>;
  meta: LedgerMeta | null;
}

/**
 * Loads every ledger shard (no observations, no state). Parses JSON only;
 * full schema validation is `validate.ts`'s job. Throws `CensusDataError` on a
 * bad line or an id present twice (within or across shards).
 */
export function loadLedger(paths: CensusPaths): LoadedLedger {
  const rows: Row[] = [];
  const byId = new Map<string, Row>();
  const children = new Map<string, Row[]>();
  for (const shard of SHARDS) {
    const file = paths.shards[shard];
    for (const l of readJsonl(file, shardFileName(shard))) {
      const row = l.value as Row;
      if (typeof row !== "object" || row === null || typeof row.id !== "string") {
        throw new CensusDataError(`${shardFileName(shard)} line ${l.line}: row without an id`);
      }
      if (byId.has(row.id)) {
        throw new CensusDataError(`${shardFileName(shard)} line ${l.line}: duplicate id ${row.id}`);
      }
      byId.set(row.id, row);
      rows.push(row);
      if (typeof row.parent === "string") {
        const list = children.get(row.parent);
        if (list) list.push(row);
        else children.set(row.parent, [row]);
      }
    }
  }
  const meta = readJson<LedgerMeta | null>(paths.meta, null, "ledger.meta.json");
  return { rows, byId, children, meta };
}

/** True when no ledger shard file and no meta file exist ("run build.ts"). */
export function ledgerMissing(paths: CensusPaths): boolean {
  return !existsSync(paths.meta) && SHARDS.every((s) => !existsSync(paths.shards[s]));
}
