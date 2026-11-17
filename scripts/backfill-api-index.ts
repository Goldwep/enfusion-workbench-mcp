/**
 * Applies the source backfill (`src/scraper/backfill.ts`) to the committed API
 * index files without re-scraping: sets each method name the old parser glued
 * link text onto to the identifier its signature declares, corrects the params
 * arrays the old comma-splitting parser broke, then derives the pak layer again: every method
 * and class the E02 source index declares and the index lacks, each marked
 * `origin: "pak"` with `pakFile`, `pakLine` and its `guards`. Entries an
 * earlier run wrote are refreshed or pruned. Records the source index's build
 * in `scrape-meta.json` (`sourceBackfill`). Idempotent: a second run changes
 * nothing.
 *
 * The files keep their stored form: `JSON.stringify(_, null, 2)`, no final
 * newline, CRLF line ends when the file has them (a Windows checkout; git
 * stores LF). Sizes are reported as the LF byte count, the size of the blob
 * GitHub sees.
 *
 * Size cap (plan risk R20): a file whose LF size would pass `--max-lf-bytes`
 * (default 49,900,000) is not written in place; its backfilled text goes to
 * `--overflow-dir` (default `<artifacts>/census/<build>/api-backfill/`) and
 * the run exits 1.
 *
 *   npx tsx scripts/backfill-api-index.ts [--api-dir <dir>] [--source-index <file>]
 *       [--build <tag>] [--max-lf-bytes <n>] [--overflow-dir <dir>] [--report <file>]
 *       [--dry-run] [--json]
 *
 * Exit: 0 applied (or nothing to do); 1 a file was held back by the size cap;
 * 2 usage or no source index.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { writeFileAtomic } from "../src/census/ledger-io.js";
import type { ApiIndexFile } from "../src/scraper/backfill.js";
import {
  API_FILE_MAX_LF_BYTES,
  API_INDEX_FILES,
  apiFileText,
  applySourceBackfill,
  lfByteLength,
  locateSourceIndex,
  parseApiFileText,
  type SourceBackfillMeta,
} from "../src/scraper/backfill-io.js";
import { artifactsDir } from "./live/paths.js";
import { isMainModule, PROCESS_IO, type Io } from "./census/cli-common.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** GitHub warns at 50 MB; plan risk R20 keeps the Arma file under this. */
export const DEFAULT_MAX_LF_BYTES = API_FILE_MAX_LF_BYTES;

const USAGE =
  "usage: backfill-api-index.ts [--api-dir <dir>] [--source-index <file>] [--build <tag>] [--max-lf-bytes <n>] [--overflow-dir <dir>] [--report <file>] [--dry-run] [--json]";

export interface FileOutcome {
  file: string;
  /** Bytes as stored before, and as LF (the git blob size). */
  bytes_before: number;
  lf_bytes_before: number;
  bytes_after: number;
  lf_bytes_after: number;
  crlf: boolean;
  /** The pak layer the file carries after the run, against Doxygen's entries. */
  methods_added: number;
  classes_added: number;
  methods_added_by_reason: Record<string, number>;
  /** Lost methods not added: alternatives from the branch Doxygen did not read. */
  methods_withheld: number;
  /** Pak entries this run wrote that were not there byte for byte before, and earlier ones it pruned. */
  entries_new_or_changed: number;
  entries_pruned: number;
  method_names_corrected: number;
  params_arrays_corrected: number;
  /** `written`, `unchanged`, `dry-run`, or `held-back` (over the size cap; written to the overflow dir). */
  status: "written" | "unchanged" | "dry-run" | "held-back";
  overflow_path?: string;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      "api-dir": { type: "string" },
      "source-index": { type: "string" },
      build: { type: "string" },
      "max-lf-bytes": { type: "string" },
      "overflow-dir": { type: "string" },
      report: { type: "string" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  const maxLf = values["max-lf-bytes"] ? Number(values["max-lf-bytes"]) : DEFAULT_MAX_LF_BYTES;
  if (!Number.isFinite(maxLf) || maxLf <= 0) {
    io.err(`backfill-api-index: --max-lf-bytes must be a positive number\n${USAGE}`);
    return 2;
  }
  const apiDir = resolve(values["api-dir"] ?? join(REPO_ROOT, "data", "api"));
  const paths = API_INDEX_FILES.map((f) => join(apiDir, f.file));
  if (!paths.every((p) => existsSync(p))) {
    io.out(`NO DATA: the API index files are not under ${apiDir}; nothing written`);
    return 2;
  }
  const found = locateSourceIndex({
    dataDir: join(REPO_ROOT, "data"),
    build: values.build,
    file: values["source-index"] ? resolve(values["source-index"]) : undefined,
  });
  if (found.status !== "found") {
    io.out(`NO DATA: ${found.reason}; nothing written`);
    return 2;
  }

  const texts = paths.map((p) => readFileSync(p, "utf-8"));
  const stored = texts.map(parseApiFileText);
  const files: ApiIndexFile[] = API_INDEX_FILES.map((f, i) => ({
    file: f.file,
    source: f.source,
    classes: stored[i].classes,
  }));
  const summary = applySourceBackfill(files, found.index);

  const overflowDir = resolve(
    values["overflow-dir"] ?? join(artifactsDir(), "census", found.build, "api-backfill"),
  );
  const outcomes: FileOutcome[] = [];
  let heldBack = false;
  files.forEach((f, i) => {
    const text = apiFileText(f.classes, stored[i].crlf);
    const p = summary.result.perFile[f.file];
    const outcome: FileOutcome = {
      file: f.file,
      bytes_before: Buffer.byteLength(texts[i], "utf-8"),
      lf_bytes_before: lfByteLength(texts[i]),
      bytes_after: Buffer.byteLength(text, "utf-8"),
      lf_bytes_after: lfByteLength(text),
      crlf: stored[i].crlf,
      methods_added: p.methods,
      classes_added: p.classes,
      methods_added_by_reason: p.byReason,
      methods_withheld: p.withheld,
      entries_new_or_changed: summary.result.added.filter((a) => a.file === f.file).length,
      entries_pruned: summary.result.removed.filter((a) => a.file === f.file).length,
      method_names_corrected: summary.nameCorrections.filter((c) => c.file === f.file).length,
      params_arrays_corrected: summary.corrections.filter((c) => c.file === f.file).length,
      status: "unchanged",
    };
    if (text !== texts[i]) {
      if (outcome.lf_bytes_after > maxLf) {
        heldBack = true;
        outcome.status = "held-back";
        if (!values["dry-run"]) {
          mkdirSync(overflowDir, { recursive: true });
          outcome.overflow_path = join(overflowDir, f.file);
          writeFileAtomic(outcome.overflow_path, text);
        }
      } else if (values["dry-run"]) outcome.status = "dry-run";
      else {
        writeFileAtomic(paths[i], text);
        outcome.status = "written";
      }
    }
    outcomes.push(outcome);
  });

  // Provenance of the layer in scrape-meta.json, kept in that file's stored form.
  const metaPath = join(apiDir, "scrape-meta.json");
  let metaStatus = "absent";
  if (existsSync(metaPath)) {
    const metaText = readFileSync(metaPath, "utf-8");
    const crlf = metaText.includes("\r\n");
    const meta = JSON.parse(metaText.replace(/^﻿/, "")) as Record<string, unknown>;
    const sourceBackfill: SourceBackfillMeta = {
      build: found.build,
      inputsSha256: found.index.header.inputs_sha256,
      files: outcomes.filter((o) => o.status !== "held-back").map((o) => o.file),
    };
    meta.sourceBackfill = sourceBackfill;
    const next = JSON.stringify(meta, null, 2);
    const text = crlf ? next.replace(/\n/g, "\r\n") : next;
    if (text === metaText) metaStatus = "unchanged";
    else if (values["dry-run"]) metaStatus = "dry-run";
    else {
      writeFileAtomic(metaPath, text);
      metaStatus = "written";
    }
  }

  const report = {
    build: found.build,
    max_lf_bytes: maxLf,
    files: outcomes,
    scrape_meta: metaStatus,
    method_count_check: {
      classes_short_before: summary.shortfallBefore.length,
      methods_short_before: summary.shortfallBefore.reduce((n, c) => n + c.missing.length, 0),
      classes_short_after: summary.shortfallAfter.length,
      short_after: summary.shortfallAfter,
    },
    name_corrections: summary.nameCorrections,
    params_corrections: summary.corrections,
    added: summary.result.added,
    removed: summary.result.removed,
    withheld: summary.result.withheld,
    entries: summary.result.entries,
  };
  if (values.report) {
    const file = resolve(values.report);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(report, null, 2) + "\n", "utf-8");
  }
  if (values.json) {
    io.out(
      JSON.stringify({
        ...report,
        added: report.added.length,
        removed: report.removed.length,
        withheld: report.withheld.length,
        entries: report.entries.length,
        name_corrections: report.name_corrections.length,
        params_corrections: report.params_corrections.length,
      }),
    );
  } else {
    io.out(
      `Source index: build ${found.build}. Method-count check: ${report.method_count_check.classes_short_before} classes short of ${report.method_count_check.methods_short_before} methods before, ${report.method_count_check.classes_short_after} after.`,
    );
    for (const o of outcomes) {
      const reasons = Object.entries(o.methods_added_by_reason)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      io.out(
        `${o.file}: ${o.status}; +${o.methods_added} methods (${reasons || "none"}), +${o.classes_added} classes, ${o.methods_withheld} withheld as inactive-branch alternatives, ${o.method_names_corrected} method names corrected, ${o.params_arrays_corrected} params arrays corrected; this run: ${o.entries_new_or_changed} pak entries new or changed, ${o.entries_pruned} pruned; LF bytes ${o.lf_bytes_before} -> ${o.lf_bytes_after}${o.overflow_path ? `; written to ${o.overflow_path} instead` : ""}`,
      );
    }
    if (heldBack)
      io.out(
        `HELD BACK: a file would pass ${maxLf} LF bytes (plan risk R20); it was not written in place.`,
      );
  }
  return heldBack ? 1 : 0;
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
