/**
 * Vanilla corpus harness (plan Phase 1 item 5): the scoreboard that the
 * lossless parser of Phase 3 and the reader rewrites must move.
 *
 * Reads vanilla files straight out of the installed game paks at test time
 * (`PakVirtualFS`, game path from `loadConfig()`); nothing from the game is
 * ever copied into the repository. `baseline.json` beside this file holds the
 * committed numbers (counts only) for one build.
 *
 * A corpus run is SKIPPED, with the reason in the suite name, when:
 *   - the game path has no paks;
 *   - the census build tag (`data/census/current-build.json`) is not the
 *     baseline's build;
 *   - the paks hold a different number of files than the baseline recorded
 *     (the game updated before the census build tag did).
 *
 * Environment:
 *   CORPUS_FULL=1             measure every file instead of the seeded sample
 *   CORPUS_UPDATE_BASELINE=1  with CORPUS_FULL=1: rewrite the round-trip part
 *                             of baseline.json from this run (README)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareCodeUnits, sha256 } from "../../src/census/canon.js";
import { loadConfig } from "../../src/config.js";
import { parse, serialize } from "../../src/formats/enfusion-text.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";

// ── Paths and switches ───────────────────────────────────────────────────────

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BASELINE_PATH = join(REPO_ROOT, "tests", "corpus", "baseline.json");
const CURRENT_BUILD_PATH = join(REPO_ROOT, "data", "census", "current-build.json");

/** True when the whole corpus is measured (`CORPUS_FULL=1`). */
export const CORPUS_FULL = process.env.CORPUS_FULL === "1";
/** True when this run may rewrite the round-trip numbers in baseline.json. */
export const CORPUS_UPDATE = process.env.CORPUS_UPDATE_BASELINE === "1";

/** Files per extension in the default (seeded-sample) round-trip run. */
export const SAMPLE_PER_EXT = 200;
/** Seed of the round-trip sample. Changing it invalidates every `sample` number in the baseline. */
export const SAMPLE_SEED = "corpus-roundtrip-v1";

// ── Text sniffing ────────────────────────────────────────────────────────────

export type Sniff = "text" | "binary" | "empty";

/**
 * Text or binary from the first 8 KiB, by the same rule as the E09 census
 * (`sniffBytes` in `scripts/census/enumerators/e09-file-types.ts`), restated
 * here so the scoreboard does not move when an enumerator changes: a UTF-16
 * byte-order mark is text; a NUL, DEL or control byte other than tab,
 * newline, carriage return, form feed and escape is binary, and so is a head
 * where more than 30 percent of the bytes are 0x80 or above.
 */
export function sniffText(buf: Uint8Array): Sniff {
  if (buf.length === 0) return "empty";
  const head = buf.subarray(0, 8192);
  if (
    head.length >= 2 &&
    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  ) {
    return "text";
  }
  let high = 0;
  for (const b of head) {
    if (b === 0 || b === 0x7f) return "binary";
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) return "binary";
    if (b >= 0x80) high++;
  }
  return high * 10 > head.length * 3 ? "binary" : "text";
}

// ── The corpus ───────────────────────────────────────────────────────────────

/** The two VFS calls the harness needs; tests pass a synthetic one. */
export interface PakSource {
  allFilePaths(): string[];
  readFile(virtualPath: string): Buffer;
}

/**
 * Lower-case text after the last dot of the base name; undefined when there
 * is none. The E09 rule (`rawExtension`), so a dot-file counts under its name.
 */
export function extensionOf(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  if (i < 0 || i === base.length - 1) return undefined;
  return base.slice(i + 1).toLowerCase();
}

/**
 * The `n` paths with the smallest seeded hash, in code-unit order (all of
 * them when there are no more). Deterministic for a given path list, so a
 * sample count is reproducible exactly, not only statistically.
 */
export function seededSample(
  paths: readonly string[],
  n: number,
  key: string,
  seed: string = SAMPLE_SEED,
): string[] {
  const picked =
    paths.length <= n
      ? [...paths]
      : paths
          .map((p) => ({ p, h: sha256(`${seed}|${key}|${p}`) }))
          .sort((a, b) => compareCodeUnits(a.h, b.h) || compareCodeUnits(a.p, b.p))
          .slice(0, n)
          .map((x) => x.p);
  return picked.sort(compareCodeUnits);
}

export class Corpus {
  private byExt = new Map<string, string[]>();

  constructor(
    private readonly pak: PakSource,
    /** Census build tag the corpus is taken to be. */
    readonly build: string,
  ) {
    for (const p of pak.allFilePaths()) {
      const ext = extensionOf(p);
      if (ext === undefined) continue;
      const list = this.byExt.get(ext);
      if (list) list.push(p);
      else this.byExt.set(ext, [p]);
    }
    for (const list of this.byExt.values()) list.sort(compareCodeUnits);
  }

  /** Files in the paks, all extensions. */
  get fileCount(): number {
    return this.pak.allFilePaths().length;
  }

  /** Every path of one extension (lower-case, no dot), in code-unit order. */
  list(ext: string): string[] {
    return [...(this.byExt.get(ext.toLowerCase()) ?? [])];
  }

  /** The seeded round-trip sample of one extension (`SAMPLE_PER_EXT` files at most). */
  sample(ext: string, n: number = SAMPLE_PER_EXT): string[] {
    return seededSample(this.list(ext), n, ext.toLowerCase());
  }

  /** What a run measures: the sample by default, every file under `CORPUS_FULL=1`. */
  selection(ext: string, full: boolean = CORPUS_FULL): string[] {
    return full ? this.list(ext) : this.sample(ext);
  }

  /** Every extension present, in code-unit order. */
  extensions(): string[] {
    return [...this.byExt.keys()].sort(compareCodeUnits);
  }

  read(path: string): Buffer {
    return this.pak.readFile(path);
  }

  readText(path: string): string {
    return this.pak.readFile(path).toString("utf-8");
  }
}

/** E09's sniff sample: size and seed (`SNIFF_SAMPLE`, `SNIFF_SEED`). */
export const TEXT_SNIFF_SAMPLE = 64;
export const TEXT_SNIFF_SEED = "E09-sniff-v1";

/**
 * The text extensions of a corpus, decided as E09 decides them: an extension
 * is text (or mixed) when at least one file of its seeded sample sniffs as
 * text. Same sample as E09, so the same set. Only a baseline re-record calls
 * this; a checked run takes the set from the baseline.
 */
export async function textExtensions(corpus: Corpus): Promise<string[]> {
  const out: string[] = [];
  for (const ext of corpus.extensions()) {
    const sample = seededSample(corpus.list(ext), TEXT_SNIFF_SAMPLE, ext, TEXT_SNIFF_SEED);
    for (const p of sample) {
      let buf: Buffer;
      try {
        buf = corpus.read(p);
      } catch {
        continue;
      }
      if (sniffText(buf) === "text") {
        out.push(ext);
        break;
      }
    }
    await new Promise((r) => setImmediate(r));
  }
  return out;
}

// ── Opening the vanilla corpus (or saying why not) ───────────────────────────

export type CorpusOpen =
  | { corpus: Corpus; skip?: undefined }
  | { corpus?: undefined; skip: string };

function currentBuildTag(): string | undefined {
  try {
    const tag = (JSON.parse(readFileSync(CURRENT_BUILD_PATH, "utf-8")) as { tag?: unknown }).tag;
    return typeof tag === "string" ? tag : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens the installed game's paks when they are the baseline's build. With
 * `ignoreBaseline` (re-recording a baseline) only the paks must exist.
 */
export function openVanillaCorpus(
  baseline: Baseline | undefined,
  options: { ignoreBaseline?: boolean } = {},
): CorpusOpen {
  let gamePath: string;
  try {
    gamePath = loadConfig().gamePath;
  } catch (e) {
    return { skip: `no game path (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!existsSync(join(gamePath, "addons"))) {
    return { skip: "no game install (set ENFUSION_GAME_PATH)" };
  }
  const build = currentBuildTag();
  if (build === undefined) return { skip: "data/census/current-build.json has no build tag" };
  if (!options.ignoreBaseline) {
    if (!baseline) return { skip: "tests/corpus/baseline.json is missing" };
    if (baseline.build !== build) {
      return { skip: `census build ${build} is not the baseline's build ${baseline.build}` };
    }
  }
  const vfs = PakVirtualFS.get(gamePath);
  if (!vfs || vfs.fileCount === 0) return { skip: "no pak files under the game path" };
  if (!options.ignoreBaseline && baseline && vfs.fileCount !== baseline.pak_files) {
    return {
      skip:
        `the paks hold ${vfs.fileCount} files, the baseline's build ${baseline.build} held ` +
        `${baseline.pak_files}: the game changed; re-record the baseline (tests/corpus/README.md)`,
    };
  }
  return { corpus: new Corpus(vfs, build) };
}

// ── Round trip ───────────────────────────────────────────────────────────────

/** What one round-trip run counts for one extension. */
export interface RoundTripCounts {
  /** Files measured. */
  files: number;
  unreadable: number;
  empty: number;
  /** Files whose own bytes sniff as binary (not parsed). */
  not_text: number;
  /** Text files handed to the parser. */
  text_files: number;
  /** Text files `parse()` read without throwing. */
  parsed: number;
  /** Parsed files whose `serialize()` output equals the file's bytes. */
  round_trip_exact: number;
}

export function emptyCounts(): RoundTripCounts {
  return {
    files: 0,
    unreadable: 0,
    empty: 0,
    not_text: 0,
    text_files: 0,
    parsed: 0,
    round_trip_exact: 0,
  };
}

/** One file's outcome. */
export type FileOutcome = "unreadable" | "empty" | "not_text" | "parse_failed" | "parsed" | "exact";

/**
 * Parse then serialize one file with the repository's current text format
 * (`src/formats/enfusion-text.ts`) and compare the bytes.
 */
export function roundTripFile(read: () => Buffer): FileOutcome {
  let buf: Buffer;
  try {
    buf = read();
  } catch {
    return "unreadable";
  }
  const s = sniffText(buf);
  if (s === "empty") return "empty";
  if (s !== "text") return "not_text";
  let node: ReturnType<typeof parse>;
  try {
    node = parse(buf.toString("utf-8"));
  } catch {
    return "parse_failed";
  }
  try {
    return Buffer.from(serialize(node), "utf-8").equals(buf) ? "exact" : "parsed";
  } catch {
    return "parsed";
  }
}

export function addOutcome(c: RoundTripCounts, o: FileOutcome): void {
  c.files++;
  if (o === "unreadable") c.unreadable++;
  else if (o === "empty") c.empty++;
  else if (o === "not_text") c.not_text++;
  else {
    c.text_files++;
    if (o === "parsed" || o === "exact") c.parsed++;
    if (o === "exact") c.round_trip_exact++;
  }
}

/**
 * Round-trips `files` and returns the outcome per path. Yields to the event
 * loop every `chunk` files so a whole-corpus run does not block the vitest
 * worker for minutes.
 */
export async function roundTripFiles(
  corpus: Pick<Corpus, "read">,
  files: readonly string[],
  chunk = 250,
): Promise<Map<string, FileOutcome>> {
  const out = new Map<string, FileOutcome>();
  for (let i = 0; i < files.length; i++) {
    out.set(
      files[i],
      roundTripFile(() => corpus.read(files[i])),
    );
    if ((i + 1) % chunk === 0) await new Promise((r) => setImmediate(r));
  }
  return out;
}

export function countOutcomes(
  outcomes: ReadonlyMap<string, FileOutcome>,
  only?: readonly string[],
): RoundTripCounts {
  const c = emptyCounts();
  for (const p of only ?? outcomes.keys()) {
    const o = outcomes.get(p);
    if (o !== undefined) addOutcome(c, o);
  }
  return c;
}

export function sumCounts(all: readonly RoundTripCounts[]): RoundTripCounts {
  const t = emptyCounts();
  for (const c of all) {
    for (const k of Object.keys(t) as (keyof RoundTripCounts)[]) t[k] += c[k];
  }
  return t;
}

// ── Baseline ─────────────────────────────────────────────────────────────────

export interface BaselineExt {
  /** Files of this extension in the paks. */
  files_total: number;
  /** Whole-corpus counts (a `CORPUS_FULL=1` run). */
  full: RoundTripCounts;
  /** Counts on the seeded sample (the default run), measured, not scaled. */
  sample: RoundTripCounts;
}

export interface ReaderBaseline {
  /** What the independent count counts, and how. */
  counts: string;
  /** Files the reader was run on. */
  files: number;
  /** Items in those files by the independent count. */
  independent: number;
  /** Items the shipped reader returned on the same files. */
  reader_yield: number;
  /** Further numbers the case pins (reader-specific). */
  [extra: string]: number | string;
}

export interface Baseline {
  $comment?: string;
  build: string;
  pak_files: number;
  roundtrip: {
    parser: string;
    sample_per_ext: number;
    sample_seed: string;
    extensions: Record<string, BaselineExt>;
  };
  readers: Record<string, ReaderBaseline>;
}

export function loadBaseline(path: string = BASELINE_PATH): Baseline | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as Baseline;
}

/**
 * Two-space JSON in insertion order, with every object that holds no object
 * or array on one line, so a baseline diff reads one extension per line.
 */
export function formatBaseline(b: Baseline): string {
  return (
    JSON.stringify(b, null, 2).replace(
      /\{\n([^{}[\]]*?)\n[ ]*\}/g,
      (_, body: string) =>
        `{ ${body
          .trim()
          .split(/,\n[ ]*/)
          .join(", ")} }`,
    ) + "\n"
  );
}

export function writeBaseline(b: Baseline, path: string = BASELINE_PATH): void {
  writeFileSync(path, formatBaseline(b));
}

// ── Comparator ───────────────────────────────────────────────────────────────

/** Counts that may only go up: a lower number is a regression. */
export const AT_LEAST_FIELDS = ["parsed", "round_trip_exact"] as const;
/** Counts that describe the corpus itself: any change means a different input. */
export const IDENTITY_FIELDS = ["files", "text_files"] as const;

export interface Comparison {
  /** A field that went down. The test fails. */
  regressions: string[];
  /** A field that went up. The test passes and asks for a baseline update. */
  improvements: string[];
  /** The input differs from the baseline's (file or text-file count). The test fails. */
  mismatches: string[];
}

/** Measured against baseline for one labelled scope (`"et sample"`, `"et full"`). */
export function compareCounts(
  label: string,
  measured: RoundTripCounts,
  baseline: RoundTripCounts,
): Comparison {
  const out: Comparison = { regressions: [], improvements: [], mismatches: [] };
  for (const f of IDENTITY_FIELDS) {
    if (measured[f] !== baseline[f]) {
      out.mismatches.push(`${label}: ${f} ${measured[f]}, baseline ${baseline[f]}`);
    }
  }
  for (const f of AT_LEAST_FIELDS) {
    if (measured[f] < baseline[f]) {
      out.regressions.push(`${label}: ${f} fell from ${baseline[f]} to ${measured[f]}`);
    } else if (measured[f] > baseline[f]) {
      out.improvements.push(`${label}: ${f} rose from ${baseline[f]} to ${measured[f]}`);
    }
  }
  return out;
}

export function mergeComparisons(all: readonly Comparison[]): Comparison {
  return {
    regressions: all.flatMap((c) => c.regressions),
    improvements: all.flatMap((c) => c.improvements),
    mismatches: all.flatMap((c) => c.mismatches),
  };
}

export const UPDATE_INSTRUCTION =
  "The corpus numbers improved. Record them: CORPUS_FULL=1 CORPUS_UPDATE_BASELINE=1 " +
  "npx --no vitest run tests/corpus/roundtrip.corpus.test.ts, then commit tests/corpus/baseline.json " +
  "(tests/corpus/README.md).";

// ── Reporting ────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`;
}

/** A fixed-width table of round-trip counts, one row per extension plus a total. */
export function formatRoundTripTable(rows: ReadonlyMap<string, RoundTripCounts>): string {
  const head = ["ext", "files", "text", "parsed", "exact", "exact/text"];
  const lines: string[][] = [head];
  const keys = [...rows.keys()].sort(compareCodeUnits);
  for (const k of keys) {
    const c = rows.get(k) as RoundTripCounts;
    lines.push([
      k,
      String(c.files),
      String(c.text_files),
      String(c.parsed),
      String(c.round_trip_exact),
      pct(c.round_trip_exact, c.text_files),
    ]);
  }
  const t = sumCounts(keys.map((k) => rows.get(k) as RoundTripCounts));
  lines.push([
    "TOTAL",
    String(t.files),
    String(t.text_files),
    String(t.parsed),
    String(t.round_trip_exact),
    pct(t.round_trip_exact, t.text_files),
  ]);
  const widths = head.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  return lines
    .map((l) =>
      l.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  "),
    )
    .join("\n");
}
