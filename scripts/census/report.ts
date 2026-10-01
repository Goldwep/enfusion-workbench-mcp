/**
 * Coverage report (plan 1.5). Never a single percentage.
 *
 *   npx tsx scripts/census/report.ts [--out <file>] [--check] [--summary] [--json]
 *       [--phase 0|1|2|4|release] [--data <dir>]
 *
 * default    writes docs/v2/COVERAGE.md (the only writer of that file): gate
 *            table, tier histogram, the three numbers per dimension, module
 *            and kind, headline (shard core) and all shards, pending items
 * --summary  prints the G1-G10 one-liners, then the tier histogram and the
 *            three numbers, and writes nothing (re-orientation routine 13.3)
 * --check    writes nothing; exit 1 when the file on disk would change
 * --json     prints {ok, command, build, coverage, gates}
 *
 * Exit: 0 ok; 1 --check found a difference; 2 usage or no ledger ("run build.ts").
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { sha256 } from "../../src/census/canon.js";
import {
  computeCoverage,
  renderCoverageMarkdown,
  renderCoverageText,
} from "../../src/census/coverage.js";
import { PHASES, runGates, type Phase } from "../../src/census/gates.js";
import {
  ledgerMissing,
  loadLedger,
  writeFileAtomic,
  type CensusPaths,
} from "../../src/census/ledger-io.js";
import { SHARDS } from "../../src/census/vocab.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "./cli-common.js";
import { g10Runner } from "./pii-check.js";

const USAGE =
  "usage: report.ts [--out <file>] [--check] [--summary] [--json] [--phase 0|1|2|4|release] [--data <dir>]";

/** Default output: `<repo>/docs/v2/COVERAGE.md`. */
export function defaultCoveragePath(paths: CensusPaths): string {
  return join(paths.repo, "docs", "v2", "COVERAGE.md");
}

export function run(
  argv: string[],
  io: Io = PROCESS_IO,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return guard(io, "report", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        out: { type: "string" },
        check: { type: "boolean" },
        summary: { type: "boolean" },
        json: { type: "boolean" },
        phase: { type: "string" },
        data: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const phase = (values.phase ?? "0") as Phase;
    if (!PHASES.includes(phase)) {
      io.err(`report: unknown phase ${values.phase}\n${USAGE}`);
      return EXIT_USAGE;
    }
    const paths = pathsFrom(values.data);
    if (ledgerMissing(paths)) {
      io.err("report: no ledger under the census root; run build.ts first");
      return EXIT_USAGE;
    }
    const ledger = loadLedger(paths);
    const meta = ledger.meta as Record<string, unknown> | null;
    const build = (meta?.build as { tag: string; branch: string; ui_language: string }) ?? {
      tag: "unknown",
      branch: "stable",
      ui_language: "unknown",
    };
    const enumerators = (meta?.enumerators as { done: string[]; pending: string[] }) ?? {
      done: [],
      pending: [],
    };
    const shardText = SHARDS.map((s) =>
      existsSync(paths.shards[s]) ? readFileSync(paths.shards[s], "utf-8") : "",
    ).join("");
    const coverage = computeCoverage({
      rows: ledger.rows,
      build,
      enumerators,
      unverifiedRefs: (meta?.unverified_refs as Record<string, number>) ?? {},
      ledgerSha: sha256(shardText),
    });
    const gates = runGates(paths, { phase, g10: g10Runner(paths, env) });

    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "report",
          build,
          coverage,
          gates: gates.gates.map((g) => ({ gate: g.gate, status: g.status, summary: g.summary })),
        }),
      );
      return EXIT_OK;
    }
    if (values.summary) {
      io.out(renderCoverageText(coverage, gates));
      return EXIT_OK;
    }
    const out = values.out ? resolve(values.out) : defaultCoveragePath(paths);
    const text = renderCoverageMarkdown(coverage, gates);
    if (values.check) {
      const current = existsSync(out) ? readFileSync(out, "utf-8") : null;
      if (current === text) {
        io.out("COVERAGE.md is up to date");
        return EXIT_OK;
      }
      io.out(
        current === null ? "COVERAGE.md is missing" : "COVERAGE.md would change; run report.ts",
      );
      return EXIT_FAIL;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, text);
    const n = ledger.rows.length;
    io.out(
      `wrote COVERAGE.md (${n} row${n !== 1 ? "s" : ""}, ${coverage.shards.length} non-empty shard${coverage.shards.length !== 1 ? "s" : ""})`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
