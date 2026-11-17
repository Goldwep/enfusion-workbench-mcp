/**
 * Writes `data/census/locators/<current build>.jsonl` from P-W8-02's results ONLY (W8 spec 4,
 * OD-13, DEC-076 "the locator file": no locator is written by hand).
 *
 * Input: a JSONL file of P-W8-02 results, one `LocatorProbeResult` per line (src/gui/locators.ts):
 * wb_gui `read`'s `capture` plus `probe: "P-W8-02"`, the `build` the read ran on and its `evidence`
 * id. A result becomes a record only when it is a P-W8-02 result on the current build, carries an
 * EV- evidence id, resolved to exactly one element, and that element's name and control type match
 * the ledger row (src/gui/locators.ts `carryLocators`). A result that resolved to nothing because
 * its element lives off the main window (its `surface`, or the row's kind: menu, context, dialog)
 * is counted under `elsewhere` and not listed. Every other line is listed with its reason.
 * A result's `ordinal` (several elements share the id and type) and `itemPath` (a property-grid
 * item below its grid) are carried into the record (DEC-078); the summary counts both, and the
 * results by the build of the locator the sweep resolved (`locatorBuild`).
 *
 * Dry run by default: prints the summary and writes nothing. `--write` replaces the build's file
 * with the carried records (the file is generated whole each time; a row a later result covers
 * keeps the later result).
 *
 * Usage:
 *   npx tsx scripts/census/locators-carry.ts --results <p-w8-02.jsonl> [--data <census dir>]
 *       [--build <tag>] [--write]
 *
 * Exit: 0 ok; 1 no result was carried; 2 usage (missing or unreadable input, no current build);
 * 3 a results line is not JSON.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_CENSUS_ROOT, writeFileAtomic } from "../../src/census/ledger-io.js";
import {
  LOCATOR_PROBE,
  carryLocators,
  loadCensusRows,
  locatorFilePath,
  readCurrentBuild,
  serializeLocatorFile,
} from "../../src/gui/locators.js";
import {
  EXIT_FAIL,
  EXIT_MALFORMED,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  isMainModule,
  type Io,
} from "./cli-common.js";

interface Args {
  results?: string;
  data?: string;
  build?: string;
  write: boolean;
}

function parse(argv: string[]): Args | string {
  const a: Args = { write: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--write") a.write = true;
    else if (k === "--results" || k === "--data" || k === "--build") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return `${k} needs a value`;
      a[k.slice(2) as "results" | "data" | "build"] = v;
    } else return `unknown argument ${k}`;
  }
  if (!a.results) return "--results <file> is required";
  return a;
}

/** How many results carry each value of `field` ("unrecorded" when absent). */
function countBy(results: unknown[], field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    const v = r && typeof r === "object" ? (r as Record<string, unknown>)[field] : undefined;
    const k = typeof v === "string" && v ? v : "unrecorded";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  const a = parse(argv);
  if (typeof a === "string") {
    io.err(
      `${a}\nusage: locators-carry.ts --results <file> [--data <dir>] [--build <tag>] [--write]`,
    );
    return EXIT_USAGE;
  }
  const root = a.data ? resolve(a.data) : DEFAULT_CENSUS_ROOT;
  const build = a.build ?? readCurrentBuild(root);
  if (!build) {
    io.err("no current build: current-build.json is missing or has no tag");
    return EXIT_USAGE;
  }
  const file = resolve(a.results!);
  if (!existsSync(file)) {
    io.err(`no results file at ${a.results}`);
    return EXIT_USAGE;
  }
  const results: unknown[] = [];
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      results.push(JSON.parse(lines[i]));
    } catch {
      io.err(`results line ${i + 1}: not JSON`);
      return EXIT_MALFORMED;
    }
  }
  const rows = loadCensusRows(root);
  const carried = carryLocators(results, rows, build);
  const byReason = new Map<string, number>();
  for (const r of carried.rejected) {
    const key = r.reason.replace(/"[^"]*"/g, '"…"');
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  const out = locatorFilePath(root, build);
  io.out(
    JSON.stringify({
      probe: LOCATOR_PROBE,
      build,
      results: results.length,
      carried: carried.records.length,
      rejected: carried.rejected.length,
      // Unresolved rows off the main window (menu, context, dialog): skipped, not rejected.
      elsewhere: carried.elsewhere,
      superseded: carried.superseded.length,
      withOrdinal: carried.records.filter((r) => r.ordinal !== undefined).length,
      withItemPath: carried.records.filter((r) => r.itemPath !== undefined).length,
      byLocatorBuild: countBy(results, "locatorBuild"),
      byReason: Object.fromEntries([...byReason].sort((x, y) => y[1] - x[1])),
      out: `locators/${build}.jsonl`,
      written: a.write && carried.records.length > 0,
    }),
  );
  for (const r of carried.rejected.slice(0, 50)) {
    io.out(`  rejected line ${r.line} ${r.rowId ?? "(no row)"}: ${r.reason}`);
  }
  if (carried.records.length === 0) {
    io.err("no result was carried; nothing written");
    return EXIT_FAIL;
  }
  if (a.write) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, serializeLocatorFile(carried.records));
  } else {
    io.out("dry run: pass --write to write the file");
  }
  return EXIT_OK;
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
