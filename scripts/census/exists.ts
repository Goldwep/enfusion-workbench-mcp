/**
 * Ground-truth existence check for engine symbols, flags, labels and
 * payload keys (plan existence rule; main ruling 13). Reads only the E02
 * (script source), E05 (executable tables) and E04 (NET surface)
 * observations. Exact match; never fuzzy.
 *
 *   npx tsx scripts/census/exists.ts <symbol> [--kind <kind>] [--ci] [--json] [--data <dir>]
 *
 * Exit: 0 FOUND; 1 NOT FOUND (with up to 5 `near:` candidates); 2 NO DATA
 * (none of those observation files exist yet: check the pak source or
 * data/api directly and quote what you found) or usage.
 */
import { parseArgs } from "node:util";
import { EXISTS_ENUMERATORS, loadExistsIndex, lookup } from "../../src/census/exists-index.js";
import { redact } from "../../src/census/query-engine.js";
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

const USAGE = "usage: exists.ts <symbol> [--kind <kind>] [--ci] [--json] [--data <dir>]";

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "exists", () => {
    // A CLI switch is a symbol too (`-gproj`): single-dash tokens are positionals here.
    const dashed = argv.filter((a) => /^-[^-]/.test(a));
    const { values, positionals: plain } = parseArgs({
      args: argv.filter((a) => !/^-[^-]/.test(a)),
      allowPositionals: true,
      options: {
        kind: { type: "string" },
        ci: { type: "boolean" },
        json: { type: "boolean" },
        data: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    const positionals = [...dashed, ...plain];
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (positionals.length !== 1) {
      io.err(`exists: give exactly one symbol\n${USAGE}`);
      return EXIT_USAGE;
    }
    const symbol = positionals[0];
    const index = loadExistsIndex(pathsFrom(values.data));
    if (index.present.length === 0) {
      const msg = `NO DATA: no ${EXISTS_ENUMERATORS.join(", ")} observations yet — check the pak source or data/api directly and quote what you found`;
      if (values.json)
        io.out(
          JSON.stringify({ ok: false, symbol, found: false, matches: [], near: [], no_data: true }),
        );
      else io.out(msg);
      return EXIT_USAGE;
    }
    const answer = lookup(index, symbol, { ci: values.ci, kind: values.kind });
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: answer.found.length > 0,
          symbol,
          found: answer.found.length > 0,
          matches: answer.found.map((e) => ({
            id: e.id,
            kind: e.kind,
            enumerator: e.enumerator,
            build: e.build,
            ref: redact(e.ref),
            confidence: e.confidence,
          })),
          near: answer.near,
          no_data: false,
          searched: index.present,
        }),
      );
      return answer.found.length > 0 ? EXIT_OK : EXIT_FAIL;
    }
    if (answer.found.length === 0) {
      io.out(
        [
          `NOT FOUND: ${symbol} (searched ${index.present.join(", ")})`,
          ...answer.near.map((n) => `near: ${n}`),
        ].join("\n"),
      );
      return EXIT_FAIL;
    }
    io.out(
      [
        `FOUND ${symbol}`,
        ...answer.found.map((e) =>
          redact(`${e.id} | ${e.kind} | ${e.enumerator}@${e.build} | ${e.ref} | ${e.confidence}`),
        ),
      ].join("\n"),
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
