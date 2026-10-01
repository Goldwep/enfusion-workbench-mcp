/**
 * Builds the coverage ledger (plan 4.1): joins observations, state, aliases,
 * policy and universes into `ledger.jsonl` (shard core),
 * `ledger.attribute.jsonl`, `ledger.schema.jsonl`, `ledger.diag.jsonl` and
 * `ledger.meta.json`. Deterministic: two runs on the same inputs are
 * byte-identical. Nobody edits the ledger by hand.
 *
 *   npx tsx scripts/census/build.ts [--build <tag>] [--data <dir>] [--check] [--json]
 *
 * --build  build tag (default: data/census/current-build.json `tag`)
 * --check  write nothing; exit 1 when a committed ledger file differs from a fresh build
 *
 * Exit: 0 clean; 1 rejected observation lines or join problems (the ledger is
 * still written, and G1 fails on them), or --check found a difference;
 * 2 usage; 3 a configuration file is malformed.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildLedger } from "../../src/census/build-ledger.js";
import { shardFileName, writeFileAtomic } from "../../src/census/ledger-io.js";
import { SHARDS } from "../../src/census/vocab.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "./cli-common.js";

const USAGE = "usage: build.ts [--build <tag>] [--data <dir>] [--check] [--json]";

function firstDifference(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return `line ${i + 1}:\n  committed: ${(la[i] ?? "<none>").slice(0, 160)}\n  rebuilt:   ${(lb[i] ?? "<none>").slice(0, 160)}`;
    }
  }
  return "no line difference";
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "build", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        data: { type: "string" },
        check: { type: "boolean" },
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
    const built = buildLedger(paths, { build: values.build });
    const files: [string, string][] = [
      ...SHARDS.map((s) => [paths.shards[s], built.shardTexts[s]] as [string, string]),
      [paths.meta, built.metaText],
    ];

    if (values.check) {
      const diffs: string[] = [];
      for (const [file, text] of files) {
        const committed = existsSync(file) ? readFileSync(file, "utf-8") : null;
        if (committed !== text) {
          const name = file.slice(paths.root.length + 1);
          diffs.push(
            committed === null
              ? `${name}: missing`
              : `${name}: differs at ${firstDifference(committed, text)}`,
          );
        }
      }
      if (values.json)
        io.out(
          JSON.stringify({
            ok: diffs.length === 0,
            command: "build --check",
            build: built.build,
            diffs,
          }),
        );
      else if (diffs.length === 0) io.out("ledger is up to date");
      else io.out(`ledger is stale or hand-edited:\n${diffs.join("\n")}`);
      return diffs.length === 0 ? EXIT_OK : EXIT_FAIL;
    }

    for (const [file, text] of files) writeFileAtomic(file, text);
    const ok = built.rejected.length === 0 && built.problems.length === 0;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok,
          command: "build",
          build: built.build,
          rows: built.rows.length,
          shards: Object.fromEntries(
            SHARDS.map((s) => [s, built.rows.filter((r) => r.shard === s).length]),
          ),
          observation_files: built.observationFiles.length,
          rejected: built.rejected,
          problems: built.problems,
        }),
      );
    } else {
      const byShard = SHARDS.map(
        (s) => `${shardFileName(s)} ${built.rows.filter((r) => r.shard === s).length}`,
      );
      io.out(
        `built ${built.rows.length} row${built.rows.length !== 1 ? "s" : ""} (${byShard.join(", ")}) from ` +
          `${built.observationFiles.length} observation file${built.observationFiles.length !== 1 ? "s" : ""} at build ${built.build.tag}`,
      );
      for (const r of built.rejected) io.out(`rejected ${r.file}:${r.line}: ${r.reason}`);
      for (const p of built.problems) io.out(`problem ${p.message}`);
    }
    return ok ? EXIT_OK : EXIT_FAIL;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
