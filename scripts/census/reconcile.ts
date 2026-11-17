/**
 * Universe reconciliation report (plan 4.6, G2). Read-only: prints, per
 * universe, its status (closed, open, single-source, pending), the sources
 * that observed it on the current build, the symmetric difference of every
 * independent pair with each row's explanation status, and the count gate.
 * Explanations are recorded by main through `dispose.ts
 * --reconcile-explained` or `alias.ts accept`, never by this script.
 *
 *   npx tsx scripts/census/reconcile.ts [--universe <id>] [--json] [--data <dir>] [--build <tag>]
 *
 * Exit: 0 every evaluated universe closed and every count gate met;
 * 1 an open universe, a failed count gate or a copied observation file; 2 usage.
 */
import { parseArgs } from "node:util";
import { buildLedger } from "../../src/census/build-ledger.js";
import { loadUniverses } from "../../src/census/census-config.js";
import { reconcile } from "../../src/census/reconcile.js";
import { foldState } from "../../src/census/state.js";
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

const USAGE = "usage: reconcile.ts [--universe <id>] [--json] [--data <dir>] [--build <tag>]";

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "reconcile", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        universe: { type: "string" },
        json: { type: "boolean" },
        data: { type: "string" },
        build: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const paths = pathsFrom(values.data);
    const universes = loadUniverses(paths);
    if (values.universe && !universes.universes.some((u) => u.id === values.universe)) {
      io.err(`reconcile: unknown universe ${values.universe}\n${USAGE}`);
      return EXIT_USAGE;
    }
    const built = buildLedger(paths, { build: values.build });
    const rep = reconcile(universes, built, foldState(paths).overlays);
    const list = rep.universes.filter((u) => !values.universe || u.id === values.universe);
    const bad =
      list.some((u) => u.status === "open" || (u.count !== undefined && !u.count.ok)) ||
      rep.copiedFiles.length > 0;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: !bad,
          command: "reconcile",
          build: built.build,
          universes: list,
          copied_files: rep.copiedFiles,
        }),
      );
      return bad ? EXIT_FAIL : EXIT_OK;
    }
    const counts: Record<string, number> = {};
    for (const u of list) counts[u.status] = (counts[u.status] ?? 0) + 1;
    io.out(
      `reconcile at build ${built.build.tag}: ${list.length} universe(s) — ` +
        Object.keys(counts)
          .sort()
          .map((k) => `${k} ${counts[k]}`)
          .join(", "),
    );
    for (const u of list) {
      if (u.status === "pending" && !values.universe) continue;
      const src = Object.entries(u.sources)
        .map(([e, n]) => `${e}:${n}`)
        .join(" ");
      io.out(`${u.id} ${u.status}${src ? ` — ${src}` : ""}`);
      if (u.count) {
        io.out(
          `  count ${u.count.enumerator} ${u.count.observed}, expected ${u.count.expected} (${u.count.source}) ${u.count.ok ? "ok" : "FAIL"}`,
        );
      }
      for (const p of u.pairs) {
        io.out(
          `  ${p.left} vs ${p.right}: only-${p.left} ${p.onlyLeft.length}, only-${p.right} ${p.onlyRight.length}, unexplained ${p.unexplained.length}`,
        );
        for (const id of p.unexplained) io.out(`    unexplained ${id}`);
      }
    }
    for (const [a, b] of rep.copiedFiles)
      io.out(`copied: ${a} and ${b} carry identical reference sets`);
    return bad ? EXIT_FAIL : EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
