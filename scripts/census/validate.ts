/**
 * Runs the census gates G1-G10 (plan 4.6). Read-only; anyone may run it.
 *
 *   npx tsx scripts/census/validate.ts [--all | --gate G1,G3] [--phase 0|1|2|4|release]
 *       [--data <dir>] [--build <tag>] [--baseline-state <file>] [--baseline-probes <file>] [--json]
 *
 * G1 rebuilds the ledger in memory and byte-compares it with the committed
 * files, so a hand-edited or stale ledger, a recomputed tier that differs, a
 * rejected observation line or a state patch without resolvable evidence all
 * fail it. The append-only check compares `state.jsonl` and `probes.jsonl`
 * with `git show HEAD:` (or the `--baseline-*` files in tests).
 *
 * Exit: 0 when no requested gate FAILs (SOFT and SKIPPED do not fail);
 * 1 when one does; 2 usage; 3 malformed configuration.
 */
import { parseArgs } from "node:util";
import {
  GATE_IDS,
  PHASES,
  gateLines,
  runGates,
  type GateId,
  type Phase,
} from "../../src/census/gates.js";
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
  "usage: validate.ts [--all | --gate G1,G2,...] [--phase 0|1|2|4|release] [--data <dir>] [--build <tag>] " +
  "[--baseline-state <file>] [--baseline-probes <file>] [--json]";

/** Offenders printed per gate in text mode. */
const TEXT_OFFENDER_CAP = 10;

export function run(
  argv: string[],
  io: Io = PROCESS_IO,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return guard(io, "validate", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        all: { type: "boolean" },
        gate: { type: "string" },
        phase: { type: "string" },
        data: { type: "string" },
        build: { type: "string" },
        "baseline-state": { type: "string" },
        "baseline-probes": { type: "string" },
        json: { type: "boolean" },
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
      io.err(`validate: unknown phase ${values.phase}\n${USAGE}`);
      return EXIT_USAGE;
    }
    let gates: GateId[] | undefined;
    if (values.gate && !values.all) {
      gates = values.gate.split(",").map((g) => g.trim().toUpperCase()) as GateId[];
      const bad = gates.find((g) => !GATE_IDS.includes(g));
      if (bad) {
        io.err(`validate: unknown gate ${bad}\n${USAGE}`);
        return EXIT_USAGE;
      }
    }
    const paths = pathsFrom(values.data);
    const result = runGates(paths, {
      phase,
      gates,
      build: values.build,
      baselineState: values["baseline-state"],
      baselineProbes: values["baseline-probes"],
      g10: g10Runner(paths, env),
    });
    const failed = result.gates.some((g) => g.status === "FAIL");
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: !failed,
          command: "validate",
          phase,
          build: result.built?.build ?? { tag: result.build },
          gates: Object.fromEntries(
            result.gates.map((g) => [
              g.gate,
              { status: g.status, summary: g.summary, offenders: g.offenders },
            ]),
          ),
        }),
      );
    } else {
      io.out(`census gates at build ${result.build}, phase ${phase}`);
      const lines = gateLines(result);
      result.gates.forEach((g, i) => {
        io.out(lines[i]);
        for (const o of g.offenders.slice(0, TEXT_OFFENDER_CAP)) io.out(`      ${o.message}`);
        if (g.offenders.length > TEXT_OFFENDER_CAP) {
          io.out(`      ... and ${g.offenders.length - TEXT_OFFENDER_CAP} more (--json lists all)`);
        }
      });
    }
    return failed ? EXIT_FAIL : EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
