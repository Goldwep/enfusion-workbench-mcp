/**
 * Shared plumbing for the census CLIs: the "run as a script" guard, an
 * injectable output sink (tests call `run(argv, io)` in-process), the
 * census root override (`--data <dir>`), and the uniform exit codes:
 *
 *   0  ok / found
 *   1  not found / zero results / a gate failed / a write was refused
 *   2  usage error, no data, ledger missing
 *   3  malformed census file (bad line, duplicate id, schema violation)
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CensusDataError,
  DEFAULT_CENSUS_ROOT,
  censusPaths,
  type CensusPaths,
} from "../../src/census/ledger-io.js";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;
export const EXIT_MALFORMED = 3;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** Process stdout / stderr. */
export const PROCESS_IO: Io = {
  out: (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n"),
  err: (text) => process.stderr.write(text.endsWith("\n") ? text : text + "\n"),
};

/** An in-memory sink for tests. */
export function memoryIo(): Io & { stdout: () => string; stderr: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  return {
    out: (t) => o.push(t.endsWith("\n") ? t : t + "\n"),
    err: (t) => e.push(t.endsWith("\n") ? t : t + "\n"),
    stdout: () => o.join(""),
    stderr: () => e.join(""),
  };
}

/** True when the module whose `import.meta.url` is given is the process entry point. */
export function isMainModule(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && importMetaUrl === pathToFileURL(resolve(entry)).href;
}

/** Census paths from `--data <dir>` (default `<repo>/data/census`). */
export function pathsFrom(data: string | undefined): CensusPaths {
  return censusPaths(data ? resolve(data) : DEFAULT_CENSUS_ROOT);
}

/**
 * Runs a CLI body, mapping thrown errors to exit codes: a `CensusDataError`
 * is 3, an argument error (`ERR_PARSE_ARGS_*`) is 2, anything else 1.
 */
export function guard(io: Io, name: string, body: () => number): number {
  try {
    return body();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof CensusDataError) {
      io.err(`${name}: malformed census data: ${msg}`);
      return EXIT_MALFORMED;
    }
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) {
      io.err(`${name}: ${msg}`);
      return EXIT_USAGE;
    }
    io.err(`${name}: ${msg}`);
    return EXIT_FAIL;
  }
}
