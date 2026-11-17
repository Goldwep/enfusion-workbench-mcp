/**
 * Ground-truth existence check for engine symbols, flags, labels and
 * payload keys (plan existence rule; main ruling 13 as amended by DEC-018).
 * Reads the E02 (script source), E05 (executable tables) and E04 (NET
 * surface) observations first; a symbol none of them knows is then looked
 * up in the E02 source index of the build (the artifacts folder), which
 * covers every script declaration, not only the Workbench API rows. The
 * answer says which of the two answered. Exact match; never fuzzy.
 *
 *   npx tsx scripts/census/exists.ts <symbol> [--kind <kind>] [--ci] [--json] [--data <dir>]
 *       [--build <tag>] [--artifacts <dir>]
 *
 * Source-index forms: `Name`, `Class.member` (inherited members included),
 * `api:Class.Method/<arity>`.
 * --build      build whose source index is consulted (default data/census/current-build.json)
 * --artifacts  artifacts folder holding census/<build>/E02/source-index.jsonl
 *              (default: the folder of scripts/live/paths.ts)
 *
 * Exit: 0 FOUND; 1 NOT FOUND (with up to 5 `near:` candidates); 2 NO DATA
 * (neither those observation files nor the source index exist yet: check the
 * pak source or data/api directly and quote what you found) or usage.
 */
import { parseArgs } from "node:util";
import { loadCurrentBuild } from "../../src/census/census-config.js";
import {
  EXISTS_ENUMERATORS,
  loadExistsIndex,
  loadSourceFallback,
  lookup,
  lookupSource,
} from "../../src/census/exists-index.js";
import { redact } from "../../src/census/query-engine.js";
import type { SourceIndex } from "../../src/census/source-index.js";
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

const USAGE =
  "usage: exists.ts <symbol> [--kind <kind>] [--ci] [--json] [--data <dir>] [--build <tag>] [--artifacts <dir>]";
/** Source-index matches printed in text mode (JSON carries them all). */
const TEXT_MATCH_LIMIT = 25;

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
        build: { type: "string" },
        artifacts: { type: "string" },
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
    const paths = pathsFrom(values.data);
    const index = loadExistsIndex(paths);
    const answer =
      index.present.length > 0
        ? lookup(index, symbol, { ci: values.ci, kind: values.kind })
        : { found: [], near: [] };

    if (answer.found.length > 0) {
      if (values.json) {
        io.out(
          JSON.stringify({
            ok: true,
            symbol,
            found: true,
            answered_by: "observation",
            matches: answer.found.map((e) => ({
              source: "observation",
              id: e.id,
              kind: e.kind,
              enumerator: e.enumerator,
              build: e.build,
              ref: redact(e.ref),
              confidence: e.confidence,
            })),
            near: [],
            no_data: false,
            searched: index.present,
          }),
        );
        return EXIT_OK;
      }
      io.out(
        [
          `FOUND ${symbol}`,
          ...answer.found.map((e) =>
            redact(`${e.id} | ${e.kind} | ${e.enumerator}@${e.build} | ${e.ref} | ${e.confidence}`),
          ),
          `answered by: observation rows (${index.present.join(", ")})`,
        ].join("\n"),
      );
      return EXIT_OK;
    }

    // Not an observation row: the source index of the build, when present.
    let build: string | undefined = values.build;
    if (build === undefined) {
      try {
        build = loadCurrentBuild(paths).tag;
      } catch {
        build = undefined;
      }
    }
    const source: SourceIndex | undefined =
      build !== undefined ? loadSourceFallback(build, { dir: values.artifacts }) : undefined;
    const searched = [...index.present, ...(source ? [`source-index@${build}`] : [])];

    if (index.present.length === 0 && !source) {
      const msg = `NO DATA: no ${EXISTS_ENUMERATORS.join(", ")} observations and no E02 source index yet — check the pak source or data/api directly and quote what you found`;
      if (values.json)
        io.out(
          JSON.stringify({ ok: false, symbol, found: false, matches: [], near: [], no_data: true }),
        );
      else io.out(msg);
      return EXIT_USAGE;
    }

    const srcAnswer = source
      ? lookupSource(source, symbol, { ci: values.ci, kind: values.kind })
      : { found: [], near: [] };
    if (srcAnswer.found.length > 0) {
      if (values.json) {
        io.out(
          JSON.stringify({
            ok: true,
            symbol,
            found: true,
            answered_by: "source-index",
            matches: srcAnswer.found.map((m) => ({
              source: "source-index",
              symbol: m.arity !== undefined ? `${m.qualified}/${m.arity}` : m.qualified,
              kind: m.kind,
              build,
              ref: m.ref,
              signature: m.signature,
              inherited_from: m.inherited_from,
            })),
            near: [],
            no_data: false,
            searched,
          }),
        );
        return EXIT_OK;
      }
      const shown = srcAnswer.found.slice(0, TEXT_MATCH_LIMIT);
      io.out(
        [
          `FOUND ${symbol}`,
          ...shown.map((m) =>
            redact(
              `${m.arity !== undefined ? `${m.qualified}/${m.arity}` : m.qualified} | ${m.kind} | source-index@${build} | ${m.ref}` +
                (m.inherited_from ? ` | inherited from ${m.inherited_from}` : "") +
                (m.signature ? ` | ${m.signature}` : ""),
            ),
          ),
          ...(srcAnswer.found.length > shown.length
            ? [`... and ${srcAnswer.found.length - shown.length} more (use --json for all)`]
            : []),
          `answered by: E02 source index for build ${build} (pak source; not a ledger row)`,
        ].join("\n"),
      );
      return EXIT_OK;
    }

    const near = [...new Set([...answer.near, ...srcAnswer.near])].slice(0, 5);
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: false,
          symbol,
          found: false,
          matches: [],
          near,
          no_data: false,
          searched,
        }),
      );
      return EXIT_FAIL;
    }
    io.out(
      [
        `NOT FOUND: ${symbol} (searched ${searched.join(", ")})`,
        ...near.map((n) => `near: ${n}`),
      ].join("\n"),
    );
    return EXIT_FAIL;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
