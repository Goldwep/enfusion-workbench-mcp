/**
 * Checks the ledger ids and MCP tool names the release docs cite (PLAN Phase 6 roster; review-1
 * finding 11): README.md, docs/UPDATE-PLAYBOOK.md and docs/WORKBENCH-OPERATIONS.md by default.
 *
 *   npx tsx scripts/census/check-doc-citations.ts [<file.md> ...] [--data <census dir>] [--json]
 *
 * A ledger id is a backticked token that starts with a ledger dimension and a colon
 * (`api:WorldEditorAPI`, `mcp:action/wb_menu.run`); it must be a row id or an alias of one.
 * A tool name is a snake_case word (backticked or bare) whose first segment is the first segment
 * of a registered tool (wb, api, game, logs, ...); it must be a tool the ledger records
 * (an `mcp:tool/<name>` row, which E11 writes for every registered tool). A word that is a tool
 * name followed by `.<action>` must also name an `mcp:action/<tool>.<action>` row.
 *
 * Reads only the files named and the ledger; writes nothing. Exit: 0 every citation resolves;
 * 1 a citation does not; 2 usage or no ledger; 3 malformed ledger.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits } from "../../src/census/canon.js";
import { loadAliases } from "../../src/census/census-config.js";
import { ledgerMissing, loadLedger, type LoadedLedger } from "../../src/census/ledger-io.js";
import { DIMS } from "../../src/census/vocab.js";
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

const REPO = resolve(import.meta.dirname ?? ".", "..", "..");

export const DEFAULT_DOCS = [
  "README.md",
  "docs/UPDATE-PLAYBOOK.md",
  "docs/WORKBENCH-OPERATIONS.md",
];

export interface CitationProblem {
  file: string;
  line: number;
  cited: string;
  why: string;
}

/** Tool names, their action names, and every row id and alias the ledger knows. */
export interface Known {
  tools: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  ids: ReadonlySet<string>;
}

export function knownFrom(ledger: LoadedLedger, aliasFrom: readonly string[] = []): Known {
  const tools = new Set<string>();
  const actions = new Set<string>();
  for (const r of ledger.rows) {
    const t = /^mcp:tool\/([a-z0-9_]+)$/.exec(r.id);
    if (t) tools.add(t[1]);
    const a = /^mcp:action\/([a-z0-9_]+\.[A-Za-z0-9_-]+)$/.exec(r.id);
    if (a) actions.add(a[1]);
  }
  return { tools, actions, ids: new Set([...ledger.byId.keys(), ...aliasFrom]) };
}

const ID_TOKEN = new RegExp("`((?:" + DIMS.join("|") + "):[^`]+)`", "g");
const WORD = /(?<![A-Za-z0-9_./\-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\.([A-Za-z][A-Za-z0-9_-]*))?/g;

/** Problems in one document's text. */
export function checkText(file: string, text: string, k: Known): CitationProblem[] {
  const prefixes = new Set([...k.tools].map((t) => t.slice(0, t.indexOf("_"))));
  const out: CitationProblem[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(ID_TOKEN)) {
      const id = m[1];
      if (/[<>{}]/.test(id)) continue; // a pattern such as api:<Class>.<Method>/<arity>
      if (!k.ids.has(id)) out.push({ file, line: i + 1, cited: id, why: "no ledger row or alias" });
    }
    for (const m of line.matchAll(WORD)) {
      const word = m[1];
      const prefix = word.slice(0, word.indexOf("_"));
      if (!prefixes.has(prefix)) continue;
      if (!k.tools.has(word)) {
        out.push({ file, line: i + 1, cited: word, why: "no registered tool of that name" });
        continue;
      }
      const action = m[2];
      if (action && !/^(ts|js|md|json|c)$/.test(action) && !k.actions.has(`${word}.${action}`)) {
        out.push({
          file,
          line: i + 1,
          cited: `${word}.${action}`,
          why: "the tool has no action of that name",
        });
      }
    }
  });
  return out;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "check-doc-citations", () => {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { data: { type: "string" }, json: { type: "boolean" } },
      strict: true,
    });
    const paths = pathsFrom(values.data);
    if (ledgerMissing(paths)) {
      io.err("check-doc-citations: no ledger under the census root; run build.ts first");
      return EXIT_USAGE;
    }
    const files = (positionals.length > 0 ? positionals : DEFAULT_DOCS).map((f) =>
      resolve(positionals.length > 0 ? "." : REPO, f),
    );
    for (const f of files) {
      if (!existsSync(f)) {
        io.err(`check-doc-citations: no such file: ${relative(REPO, f)}`);
        return EXIT_USAGE;
      }
    }
    const known = knownFrom(
      loadLedger(paths),
      loadAliases(paths).map((a) => a.from),
    );
    const problems = files
      .flatMap((f) =>
        checkText(relative(REPO, f).replace(/\\/g, "/"), readFileSync(f, "utf-8"), known),
      )
      .sort((a, b) => compareCodeUnits(a.file, b.file) || a.line - b.line);
    if (values.json) io.out(JSON.stringify({ ok: problems.length === 0, problems }));
    else if (problems.length === 0) {
      io.out(
        `check-doc-citations: every ledger id and tool name in ${files.length} file(s) resolves`,
      );
    } else {
      io.out(problems.map((p) => `${p.file}:${p.line}: ${p.cited}: ${p.why}`).join("\n"));
    }
    return problems.length === 0 ? EXIT_OK : EXIT_FAIL;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
