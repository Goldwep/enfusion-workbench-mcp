/**
 * File side of the source backfill (`backfill.ts`): finding the source index,
 * reading and writing the API index files in their stored form, and the one
 * call the scraper writer and `scripts/backfill-api-index.ts` share.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassInfo } from "../index/types.js";
import { loadCurrentBuild } from "../census/census-config.js";
import { censusPaths } from "../census/ledger-io.js";
import {
  loadSourceIndex,
  parseSourceIndexText,
  sourceIndexPath,
  type SourceIndex,
} from "../census/source-index.js";
import {
  backfillApiIndex,
  correctMethodNames,
  correctParamsArrays,
  methodCountCheck,
  type ApiIndexFile,
  type BackfillResult,
  type MethodCountShortfall,
  type NameCorrection,
  type ParamsCorrection,
} from "./backfill.js";

/**
 * GitHub warns at 50 MB; plan risk R20 keeps each index file's git blob (its
 * LF byte count) under this. Both the scrape and `scripts/backfill-api-index.ts`
 * hold the pak layer back from a file it would push past it.
 */
export const API_FILE_MAX_LF_BYTES = 49_900_000;

/** Provenance of the pak layer, recorded in `data/api/scrape-meta.json` as `sourceBackfill`. */
export interface SourceBackfillMeta {
  /** Build tag of the source index the layer was derived from. */
  build: string;
  /** The source index header's `inputs_sha256`. */
  inputsSha256: string;
  /** Index files that carry the layer (a file held back by the size cap is not listed). */
  files: string[];
}

/** The two index files, in the order the census and the loader read them. */
export const API_INDEX_FILES = [
  { file: "enfusion-classes.json", source: "enfusion" },
  { file: "arma-classes.json", source: "arma" },
] as const;

export type SourceIndexLookup =
  | { status: "found"; index: SourceIndex; path: string; build: string }
  | { status: "absent"; reason: string };

/**
 * The source index to backfill from: `file` when given, else the index of
 * `build` (default: the census's current build, `<dataDir>/census/current-build.json`)
 * in the artifacts folder. Never builds one (that reads the game paks; E02
 * and `ensureSourceIndex` do it).
 */
export function locateSourceIndex(opts: {
  dataDir: string;
  build?: string;
  file?: string;
}): SourceIndexLookup {
  try {
    if (opts.file) {
      if (!existsSync(opts.file))
        return { status: "absent", reason: `no source index at ${opts.file}` };
      const index = parseSourceIndexText(readFileSync(opts.file, "utf-8"));
      return { status: "found", index, path: opts.file, build: index.header.build };
    }
    const build = opts.build ?? loadCurrentBuild(censusPaths(join(opts.dataDir, "census"))).tag;
    const path = sourceIndexPath(build);
    const index = loadSourceIndex(build, { file: path });
    if (!index) return { status: "absent", reason: `no source index for build ${build} (run E02)` };
    return { status: "found", index, path, build };
  } catch (e) {
    return { status: "absent", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** An index file as stored: its classes and whether its lines end in CRLF (a Windows checkout). */
export interface StoredApiFile {
  classes: ClassInfo[];
  crlf: boolean;
}

export function parseApiFileText(text: string): StoredApiFile {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const classes = JSON.parse(body) as unknown;
  if (!Array.isArray(classes)) throw new Error("expected a JSON array of classes");
  return { classes: classes as ClassInfo[], crlf: body.includes("\r\n") };
}

/** Text of an index file in the scraper's format (`JSON.stringify(_, null, 2)`, no final newline), CRLF when asked. */
export function apiFileText(classes: readonly ClassInfo[], crlf: boolean): string {
  const text = JSON.stringify(classes, null, 2);
  return crlf ? text.replace(/\n/g, "\r\n") : text;
}

/** Bytes of a text with CRLF read as LF: the size of the blob git stores for it. */
export function lfByteLength(text: string): number {
  return Buffer.byteLength(text.replace(/\r\n/g, "\n"), "utf-8");
}

export interface BackfillSummary {
  /** Doxygen entries whose `name` was set to their signature's identifier. */
  nameCorrections: NameCorrection[];
  corrections: ParamsCorrection[];
  /** Classes short of methods before the backfill (the per-class method-count check). */
  shortfallBefore: MethodCountShortfall[];
  result: BackfillResult;
  /** The same check afterwards: empty when the index is complete against the source. */
  shortfallAfter: MethodCountShortfall[];
}

/** Corrects the method names and the params arrays, then backfills from the source index; `files` are extended in place. */
export function applySourceBackfill(
  files: readonly ApiIndexFile[],
  index: SourceIndex,
): BackfillSummary {
  const nameCorrections = correctMethodNames(files);
  const corrections = correctParamsArrays(files);
  const shortfallBefore = methodCountCheck(files, index);
  const result = backfillApiIndex(files, index);
  const shortfallAfter = methodCountCheck(files, index);
  return { nameCorrections, corrections, shortfallBefore, result, shortfallAfter };
}
