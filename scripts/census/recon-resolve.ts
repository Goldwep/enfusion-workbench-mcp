/**
 * Proposes (and, for the main session, applies) resolutions for the recon
 * rows gate G6 still counts as hard offenders: E01 rows of kinds that close
 * offline that no measured enumerator merged and nothing explained. The rules
 * live in `src/census/recon-resolve.ts`.
 *
 *   npx tsx scripts/census/recon-resolve.ts [--propose] [--out-dir <dir>]
 *       [--source-index <file>] [--exe-strings <ascii.tsv>] [--recon-dir <dir>]
 *   npx tsx scripts/census/recon-resolve.ts --apply --evidence EV-... [--in <resolutions.jsonl>]
 *   common: [--data <dir>] [--json] [--dry-run]
 *
 * --propose (default) writes `docs/v2/inbox/recon-resolutions.jsonl` (one
 * proposal per line: id, recon_resolution, rule, mistake, evidence, note,
 * merge_effect, recon) and `recon-unresolved.jsonl` (id, recon, reason,
 * tried). Nothing under `data/census` is touched. It needs the source index and
 * E05's executable strings: without either it writes nothing and exits 2
 * (absence is never ruled on a partial search). --dry-run prints the counts
 * and writes nothing; it runs without those inputs, ruling no absence.
 * `merge_effect` lists what an alias changes on its target at the next build
 * (description, candidate paths); the summary counts them.
 *
 * --apply (main session only) reads the proposals and applies them all or
 * nothing: a merged-via-alias line becomes an alias through `acceptAlias`
 * (no state patch: the row disappears into its target on the next build); every
 * other line becomes a `recon_resolution` state patch (plus `notes` when the
 * proposal has one) through `appendStatePatch`, written as `dispose.ts`. Every
 * write is checked first; run build.ts afterwards.
 *
 * Exit: 0 ok; 1 a check refused the proposals; 2 usage or no data; 3 malformed census data.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildLedger } from "../../src/census/build-ledger.js";
import { jsonlLine } from "../../src/census/canon.js";
import {
  defaultPaths,
  loadAliases,
  loadCurrentBuild,
  loadPolicy,
  loadUniverses,
} from "../../src/census/census-config.js";
import {
  awaitsLiveKinds,
  checkProposals,
  exeStringsFromTsv,
  resolveRecon,
  tally,
  PROPOSED_BY,
  type Proposal,
  type ResolveResult,
} from "../../src/census/recon-resolve.js";
import type { Row } from "../../src/census/schemas.js";
import type { Kind } from "../../src/census/vocab.js";
import { defaultArtifactsDir, loadSourceIndex } from "../../src/census/source-index.js";
import { foldState } from "../../src/census/state.js";
import { acceptAlias, appendStatePatch } from "../../src/census/writers.js";
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

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_OUT = join(REPO, "docs", "v2", "inbox");
const RESOLUTIONS = "recon-resolutions.jsonl";
const UNRESOLVED = "recon-unresolved.jsonl";

const USAGE = [
  "usage: recon-resolve.ts [--propose] [--out-dir <dir>] [--source-index <file>] [--exe-strings <ascii.tsv>] [--recon-dir <dir>]",
  "       recon-resolve.ts --apply --evidence EV-... [--in <recon-resolutions.jsonl>]",
  "       common: [--data <dir>] [--json] [--dry-run] [--phase <n>]  (phase >= 4: live kinds too)",
].join("\n");

/** Aliases by the change they make to their target (a proposal may count under several). */
function mergeEffects(r: ResolveResult): Record<string, number> {
  const aliases = r.proposals.filter((p) => p.recon_resolution.kind === "merged-via-alias");
  const count = (prefix: string): number =>
    aliases.filter((p) => p.merge_effect?.some((e) => e.startsWith(prefix))).length;
  return {
    aliases: aliases.length,
    "gain what": count("what:"),
    "change paths": count("paths:"),
    unchanged: aliases.filter((p) => !p.merge_effect).length,
    "turned into duplicate-of (no alias)": r.proposals.filter((p) => p.note?.includes("no alias: "))
      .length,
  };
}

function summaryLines(r: ResolveResult): string[] {
  const lines = [
    `${r.considered} recon row(s) considered: ${r.proposals.length} proposed, ${r.unresolved.length} unresolved`,
    "by resolution kind:",
    ...tally(r.proposals, (p) => p.recon_resolution.kind).map(([k, n]) => `  ${k} ${n}`),
    "by rule:",
    ...tally(r.proposals, (p) => p.rule).map(([k, n]) => `  ${k} ${n}`),
    "by recon mistake:",
    ...tally(r.proposals, (p) => p.mistake).map(([k, n]) => `  ${n}  ${k}`),
    "aliases that change their target at the next build (merge_effect):",
    ...Object.entries(mergeEffects(r)).map(([k, n]) => `  ${k} ${n}`),
  ];
  if (r.unresolved.length) {
    lines.push("unresolved by reason:");
    lines.push(
      ...tally(r.unresolved, (u) => u.reason.replace(/:.*$/, "")).map(([k, n]) => `  ${n}  ${k}`),
    );
  }
  return lines;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "recon-resolve", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        propose: { type: "boolean" },
        apply: { type: "boolean" },
        evidence: { type: "string" },
        in: { type: "string" },
        "out-dir": { type: "string" },
        "source-index": { type: "string" },
        "exe-strings": { type: "string" },
        "recon-dir": { type: "string" },
        phase: { type: "string" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
        data: { type: "string" },
        at: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (values.apply && values.propose) {
      io.err(`recon-resolve: --propose and --apply are exclusive\n${USAGE}`);
      return EXIT_USAGE;
    }
    const paths = pathsFrom(values.data);
    const dryRun = values["dry-run"] === true;

    // ── Apply ────────────────────────────────────────────────────────────────
    if (values.apply) {
      if (!values.evidence) {
        io.err(`recon-resolve: --apply needs --evidence\n${USAGE}`);
        return EXIT_USAGE;
      }
      const evidence = values.evidence;
      const file = values.in ?? join(DEFAULT_OUT, RESOLUTIONS);
      if (!existsSync(file)) {
        io.err(`recon-resolve: no proposals file ${file}`);
        return EXIT_USAGE;
      }
      const proposals = readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l, i) => {
          try {
            return JSON.parse(l) as Proposal;
          } catch {
            throw new Error(`${file}:${i + 1}: not valid JSON`);
          }
        });
      const rows = new Map<string, Row>(buildLedger(paths).rows.map((r) => [r.id, r]));
      const problems = checkProposals(proposals, rows, loadAliases(paths));
      if (problems.length) {
        io.err(`recon-resolve: ${problems.length} proposal(s) refused:\n${problems.join("\n")}`);
        return EXIT_FAIL;
      }
      const at = values.at ?? new Date().toISOString();
      const applyAll = (dry: boolean): { aliases: number; patches: number } => {
        let aliases = 0;
        let patches = 0;
        proposals.forEach((p, i) => {
          try {
            const { kind, ref } = p.recon_resolution;
            if (kind === "merged-via-alias") {
              const why = `recon carry-over (${p.rule}): ${p.recon}${p.note ? `; ${p.note}` : ""}`;
              acceptAlias(
                paths,
                rows,
                { from: p.id, to: ref, why, proposed_by: PROPOSED_BY, evidence },
                { dryRun: dry },
              );
              aliases++;
            } else {
              const fields: Record<string, unknown> = { recon_resolution: { kind, ref } };
              if (p.note) fields.notes = p.note;
              appendStatePatch(
                paths,
                rows,
                { id: p.id, op: "set", fields, evidence, by: "dispose.ts", at },
                { dryRun: dry },
              );
              patches++;
            }
          } catch (e) {
            throw new Error(
              `${file}:${i + 1} (${p.id}): ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        });
        return { aliases, patches };
      };
      // Check every line first: nothing is written unless all of them pass.
      applyAll(true);
      const done = dryRun ? applyAll(true) : applyAll(false);
      if (values.json)
        io.out(
          JSON.stringify({ ok: true, command: "recon-resolve apply", dry_run: dryRun, ...done }),
        );
      else
        io.out(
          `${dryRun ? "checked" : "applied"} ${proposals.length} proposal(s) under ${evidence}: ${done.aliases} alias(es), ${done.patches} state patch(es); run build.ts`,
        );
      return EXIT_OK;
    }

    // ── Propose ──────────────────────────────────────────────────────────────
    const build = loadCurrentBuild(paths).tag;
    const built = buildLedger(paths);
    const state = foldState(paths);
    const source = values["source-index"]
      ? loadSourceIndex(build, { file: values["source-index"] })
      : loadSourceIndex(build);
    const exeFile =
      values["exe-strings"] ?? join(defaultArtifactsDir(), "census", build, "E05", "ascii.tsv");
    const exe = existsSync(exeFile) ? exeStringsFromTsv(readFileSync(exeFile, "utf-8")) : undefined;
    // Absence is ruled only against both inputs. The library never rules it
    // without them; the files are not overwritten with a partial reading either.
    const missing = [
      source
        ? undefined
        : `no source index for build ${build}${values["source-index"] ? ` at ${values["source-index"]}` : ""}`,
      exe ? undefined : `no executable strings at ${exeFile}`,
    ].filter((m): m is string => m !== undefined);
    if (missing.length && !dryRun) {
      io.err(
        `recon-resolve: ${missing.join("; ")}; nothing written (run with --dry-run to see the partial reading)`,
      );
      return EXIT_USAGE;
    }
    const reconDir = values["recon-dir"] ?? join(REPO, "docs", "v2", "recon");
    const policy = loadPolicy(paths);
    const result = resolveRecon({
      rows: built.rows,
      overlays: state.overlays,
      // At phase 4 the live enumerators have run: G6 counts every kind, so
      // the resolver proposes for every kind too (DEC-056 ruling 13).
      awaitsLive:
        Number(values.phase ?? "0") >= 4
          ? new Set<string>()
          : awaitsLiveKinds(loadUniverses(paths)),
      aliases: loadAliases(paths),
      source,
      exe,
      readRecon: (f) => {
        const p = join(reconDir, f);
        return existsSync(p) ? readFileSync(p, "utf-8").split(/\r?\n/) : undefined;
      },
      defaultPaths: (kind) => defaultPaths(policy, kind as Kind),
    });
    const inputsNote = [
      source
        ? "source index loaded"
        : "NO source index (member and type rules limited to the ledger; no absence ruled)",
      exe ? "executable strings loaded" : "NO executable strings (no absence ruled)",
    ];
    if (!dryRun) {
      const out = values["out-dir"] ?? DEFAULT_OUT;
      mkdirSync(out, { recursive: true });
      writeFileSync(
        join(out, RESOLUTIONS),
        result.proposals.map((p) => jsonlLine(p, ["id", "recon_resolution", "rule"])).join("\n") +
          (result.proposals.length ? "\n" : ""),
      );
      writeFileSync(
        join(out, UNRESOLVED),
        result.unresolved.map((u) => jsonlLine(u, ["id", "recon", "reason"])).join("\n") +
          (result.unresolved.length ? "\n" : ""),
      );
    }
    if (values.json)
      io.out(
        JSON.stringify({
          ok: true,
          command: "recon-resolve propose",
          dry_run: dryRun,
          considered: result.considered,
          proposed: result.proposals.length,
          unresolved: result.unresolved.length,
          by_kind: Object.fromEntries(tally(result.proposals, (p) => p.recon_resolution.kind)),
          by_rule: Object.fromEntries(tally(result.proposals, (p) => p.rule)),
          by_mistake: Object.fromEntries(tally(result.proposals, (p) => p.mistake)),
          merge_effects: mergeEffects(result),
          inputs: inputsNote,
        }),
      );
    else io.out([...inputsNote, ...summaryLines(result)].join("\n"));
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
