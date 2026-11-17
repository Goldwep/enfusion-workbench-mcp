/**
 * Entity-resolution decisions that are not exact-key matches (plan 4.4).
 * The only writer of `aliases.json`; main runs `accept` on a proposal an
 * agent made with `propose` (which writes nothing and prints the line).
 *
 *   npx tsx scripts/census/alias.ts propose --from <id> --to <id> --why <text>
 *   npx tsx scripts/census/alias.ts accept --from <id> --to <id> --why <text> --proposed-by <worker>
 *       --evidence EV-... [--dry-run]
 *   npx tsx scripts/census/alias.ts list
 *   npx tsx scripts/census/alias.ts check
 *   common: [--json] [--data <dir>]
 *
 * `from` merges into the canonical `to`. accept refuses: an id that is not a
 * row, two dims, a pair observed only by one enumerator (that hides a
 * duplicate), chains and cycles, and rows that carry a disposition.
 *
 * Exit: 0 ok; 1 refused or (check) a broken alias; 2 usage; 3 malformed data.
 */
import { parseArgs } from "node:util";
import { buildLedger } from "../../src/census/build-ledger.js";
import { loadAliases } from "../../src/census/census-config.js";
import type { Row } from "../../src/census/schemas.js";
import { acceptAlias } from "../../src/census/writers.js";
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

const USAGE = [
  "usage: alias.ts propose --from <id> --to <id> --why <text>",
  "       alias.ts accept --from <id> --to <id> --why <text> --proposed-by <worker> --evidence EV-... [--dry-run]",
  "       alias.ts list | check",
  "       common: [--json] [--data <dir>]",
].join("\n");

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "alias", () => {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        from: { type: "string" },
        to: { type: "string" },
        why: { type: "string" },
        "proposed-by": { type: "string" },
        evidence: { type: "string" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
        data: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const [command] = positionals;
    const paths = pathsFrom(values.data);

    if (command === "propose") {
      if (!values.from || !values.to || !values.why) {
        io.err(`alias: propose needs --from, --to and --why\n${USAGE}`);
        return EXIT_USAGE;
      }
      // Writes nothing: the proposal travels in the worker's hand-off.
      io.out(
        JSON.stringify({ proposal: "alias", from: values.from, to: values.to, why: values.why }),
      );
      return EXIT_OK;
    }
    if (command === "list") {
      const aliases = loadAliases(paths);
      if (values.json) io.out(JSON.stringify({ ok: true, command: "alias list", aliases }));
      else
        io.out(
          aliases.length
            ? aliases.map((a) => `${a.from} -> ${a.to} — ${a.why} [${a.evidence}]`).join("\n")
            : "no aliases",
        );
      return EXIT_OK;
    }
    if (command === "check") {
      const built = buildLedger(paths);
      const broken = built.problems.filter((p) => p.message.includes("alias"));
      if (values.json)
        io.out(
          JSON.stringify({ ok: broken.length === 0, command: "alias check", problems: broken }),
        );
      else io.out(broken.length ? broken.map((p) => p.message).join("\n") : "aliases ok");
      return broken.length ? EXIT_FAIL : EXIT_OK;
    }
    if (command === "accept") {
      if (!values.from || !values.to || !values.why || !values["proposed-by"] || !values.evidence) {
        io.err(`alias: accept needs --from, --to, --why, --proposed-by and --evidence\n${USAGE}`);
        return EXIT_USAGE;
      }
      const built = buildLedger(paths);
      const rows = new Map<string, Row>(built.rows.map((r) => [r.id, r]));
      const alias = {
        from: values.from,
        to: values.to,
        why: values.why,
        proposed_by: values["proposed-by"],
        evidence: values.evidence,
      };
      acceptAlias(paths, rows, alias, { dryRun: values["dry-run"] });
      if (values.json)
        io.out(
          JSON.stringify({
            ok: true,
            command: "alias accept",
            dry_run: values["dry-run"] === true,
            alias,
          }),
        );
      else
        io.out(
          `${values["dry-run"] ? "would accept" : "accepted"} ${alias.from} -> ${alias.to}; run build.ts to merge the rows`,
        );
      return EXIT_OK;
    }
    io.err(`alias: ${command ? `unknown command ${command}` : "missing command"}\n${USAGE}`);
    return EXIT_USAGE;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
