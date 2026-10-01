/**
 * Census queries (plan 4.6 cold-tester tool; no Workbench contact). Reads
 * only the ledger shards, `ledger.meta.json`, `aliases.json` and
 * `universes.json` (main ruling 14).
 *
 *   npx tsx scripts/census/query.ts find <text> [--kind k] [--module m] [--dim d]
 *       [--shard core|attribute|schema|diag|all] [--tier Tn] [--status active|deferred]
 *       [--below-target] [--limit 20] [--page 1] [--json]
 *   npx tsx scripts/census/query.ts describe <id> [--children all] [--json]
 *   npx tsx scripts/census/query.ts status [--module m] [--kind k] [--dim d] [--shard s] [--json]
 *   npx tsx scripts/census/query.ts children <id> [--page n] [--limit n] [--json]
 *   npx tsx scripts/census/query.ts path <id> [--json]
 *   npx tsx scripts/census/query.ts howto <text>          (stub until Phase 3: exit 2)
 *   npx tsx scripts/census/query.ts scan-project <dir>    (stub until Phase 3: exit 2)
 *
 * Exit: 0 found; 1 nothing found; 2 usage, stub or no ledger; 3 malformed ledger.
 * With --json, stdout carries exactly one JSON document.
 */
import { parseArgs } from "node:util";
import { loadAliases } from "../../src/census/census-config.js";
import { computeCoverage, renderCoverageText } from "../../src/census/coverage.js";
import { ledgerMissing, loadLedger, type LoadedLedger } from "../../src/census/ledger-io.js";
import {
  DEFAULT_LIMIT,
  childrenIds,
  describe,
  find,
  parentChain,
  redact,
  type FindFilters,
} from "../../src/census/query-engine.js";
import type { Row } from "../../src/census/schemas.js";
import { PATH_KINDS } from "../../src/census/vocab.js";
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
  "usage: query.ts find <text> [--kind k] [--module m] [--dim d] [--shard s] [--tier Tn] [--status s] [--below-target] [--limit n] [--page n] [--json]",
  "       query.ts describe <id> [--children all] [--json]",
  "       query.ts status [--module m] [--kind k] [--dim d] [--shard s] [--json]",
  "       query.ts children <id> [--page n] [--limit n] [--json]",
  "       query.ts path <id> [--json]",
  "       query.ts howto <text> | scan-project <dir>   (not available before Phase 3)",
].join("\n");

const COMMANDS = ["find", "describe", "status", "children", "path", "howto", "scan-project"];

function buildOf(ledger: LoadedLedger): { tag: string; branch: string; ui_language: string } {
  return ledger.meta?.build ?? { tag: "unknown", branch: "stable", ui_language: "unknown" };
}

function headerOf(ledger: LoadedLedger): string {
  const b = buildOf(ledger);
  const n = ledger.rows.length;
  return `census build ${b.tag} (${b.branch}, ${b.ui_language}) — ${n} row${n !== 1 ? "s" : ""}`;
}

function hitLine(r: Row): string {
  const name = r.label ?? r.object_name ?? r.class_name ?? "";
  const what = (r.what ?? "").replace(/\s+/g, " ");
  return redact(
    `${r.id} | ${r.kind} | ${r.module} | ${r.tier}/${r.target_tier} | ${name} | ${what.length > 80 ? what.slice(0, 79) + "…" : what}`,
  );
}

function describeLines(r: Row, chain: string[], kids: string[], allChildren: boolean): string[] {
  const lines: string[] = [];
  lines.push(`kind: ${r.kind}   dim: ${r.dim}   module: ${r.module}   shard: ${r.shard}`);
  lines.push(
    `tier: ${r.tier} (target ${r.target_tier}, from ${r.target_tier_source})${r.weak_only ? "  weak-oracle only" : ""}`,
  );
  for (const e of r.tier_evidence) lines.push(`  ${e.tier}: ${e.ref}`);
  if (r.label) lines.push(`label: ${r.label}${r.label_raw ? ` (raw ${r.label_raw})` : ""}`);
  if (r.object_name) lines.push(`object name: ${r.object_name}`);
  if (r.class_name) lines.push(`class: ${r.class_name}`);
  if (r.signature) lines.push(`signature: ${r.signature}`);
  lines.push(`what: ${r.what ?? "(not documented yet)"}`);
  const riskParts = [r.risk ?? "unknown"];
  if (r.risk_open || r.risk_commit)
    riskParts.push(`open ${r.risk_open ?? "?"}, commit ${r.risk_commit ?? "?"}`);
  if (r.risk_floor) riskParts.push(`floored by ${r.risk_floor}`);
  lines.push(`risk: ${riskParts.join("; ")}${r.risk_confirmed ? " (confirmed)" : " (proposed)"}`);
  lines.push(`status: ${r.status}${r.deferred_reason ? ` (${r.deferred_reason})` : ""}`);
  if (r.disposition) {
    lines.push(
      `disposition: ${r.disposition.kind}${r.disposition.ref ? `:${r.disposition.ref}` : ""} — ${r.disposition.why} [${r.disposition.evidence}]${r.owner_signoff ? ` signed off ${r.owner_signoff}` : ""}`,
    );
  }
  if (r.work_item) lines.push(`work item: ${r.work_item}`);
  lines.push("paths:");
  const paths = [...r.paths].sort(
    (a, b) => PATH_KINDS.indexOf(a.path) - PATH_KINDS.indexOf(b.path),
  );
  if (paths.length === 0) lines.push("  (none recorded)");
  for (const p of paths) {
    lines.push(
      `  ${p.path} ${p.status}${p.evidence ? ` ${p.evidence}` : ""}${p.reason ? ` — ${p.reason}` : ""}${p.path === r.chosen_path ? "  [chosen]" : ""}`,
    );
  }
  if (r.mcp.length) lines.push(`mcp: ${r.mcp.map((m) => `${m.action} (${m.role})`).join(", ")}`);
  if (r.mcp_proposed.length) lines.push(`mcp proposed: ${r.mcp_proposed.join(", ")}`);
  if (r.locator) lines.push(`locator: ${JSON.stringify(r.locator)}`);
  if (r.modal) lines.push(`modal: ${r.modal}`);
  if (r.shortcut_default) lines.push(`shortcut: ${r.shortcut_default}`);
  lines.push(
    `parent chain: ${chain.length > 1 ? chain.slice(1).join(" > ") : r.parent === null ? "(root)" : "(unknown)"}`,
  );
  const shown = allChildren ? kids : kids.slice(0, 20);
  lines.push(`children: ${kids.length} (enumerated: ${String(r.children_enumerated)})`);
  for (const k of shown) lines.push(`  ${k}`);
  if (shown.length < kids.length)
    lines.push(`  ... ${kids.length - shown.length} more (--children all)`);
  if (r.observed_states.length) {
    lines.push(`observed states: ${r.observed_states.map((s) => JSON.stringify(s)).join(" ")}`);
  }
  lines.push("sources:");
  for (const s of r.sources) lines.push(`  ${s.enumerator}@${s.build} ${s.ref} (${s.confidence})`);
  if (r.tests.length)
    lines.push(`tests: ${r.tests.map((t) => `${t.id} [${t.kind}] ${t.file}`).join(", ")}`);
  for (const u of r.unverified)
    lines.push(`unverified: ${u.claim}${u.cleared_by ? ` (cleared by ${u.cleared_by})` : ""}`);
  if (r.aggregate) lines.push("aggregate: true (excluded from every percentage)");
  if (r.provisional) lines.push("provisional: true (recon import only)");
  if (r.notes) lines.push(`notes: ${r.notes}`);
  return lines.map(redact);
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "query", () => {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        kind: { type: "string" },
        module: { type: "string" },
        dim: { type: "string" },
        shard: { type: "string" },
        tier: { type: "string" },
        status: { type: "string" },
        "below-target": { type: "boolean" },
        limit: { type: "string" },
        page: { type: "string" },
        children: { type: "string" },
        json: { type: "boolean" },
        data: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    const [command, ...rest] = positionals;
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (!command || !COMMANDS.includes(command)) {
      io.err(`query: ${command ? `unknown command ${command}` : "missing command"}\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (command === "howto" || command === "scan-project") {
      io.err(`query: ${command} is not available before Phase 3`);
      return EXIT_USAGE;
    }
    const paths = pathsFrom(values.data);
    if (ledgerMissing(paths)) {
      io.err("query: no ledger under the census root; run build.ts first");
      return EXIT_USAGE;
    }
    const ledger = loadLedger(paths);
    const build = buildOf(ledger);
    const json = values.json === true;
    const page = values.page ? Number(values.page) : 1;
    const limit = values.limit ? Number(values.limit) : DEFAULT_LIMIT;
    if (!Number.isFinite(page) || !Number.isFinite(limit)) {
      io.err(`query: --page and --limit take numbers\n${USAGE}`);
      return EXIT_USAGE;
    }
    const filters: FindFilters = {
      kind: values.kind,
      module: values.module,
      dim: values.dim,
      shard: values.shard,
      tier: values.tier,
      status: values.status,
      belowTarget: values["below-target"],
    };

    if (command === "status") {
      const rows = ledger.rows.filter(
        (r) =>
          (!filters.kind || r.kind === filters.kind) &&
          (!filters.module || r.module === filters.module) &&
          (!filters.dim || r.dim === filters.dim) &&
          (!filters.shard || filters.shard === "all" || r.shard === filters.shard),
      );
      const meta = ledger.meta as Record<string, unknown> | null;
      const coverage = computeCoverage({
        rows,
        build,
        enumerators: (meta?.enumerators as { done: string[]; pending: string[] }) ?? {
          done: [],
          pending: [],
        },
        unverifiedRefs: (meta?.unverified_refs as Record<string, number>) ?? {},
        ledgerSha: "",
      });
      if (json) io.out(JSON.stringify({ ok: true, command, build, filters, coverage }));
      else io.out(renderCoverageText(coverage));
      return EXIT_OK;
    }

    const target = rest.join(" ");
    if (!target) {
      io.err(`query: ${command} needs an argument\n${USAGE}`);
      return EXIT_USAGE;
    }

    if (command === "find" || command === "children") {
      let res;
      if (command === "find") res = find(ledger, target, filters, page, limit);
      else {
        const kids = childrenIds(ledger, target).map((id) => ledger.byId.get(id) as Row);
        const sub: LoadedLedger = { ...ledger, rows: kids };
        res = find(sub, "", filters, page, limit);
      }
      if (json) {
        io.out(
          JSON.stringify({
            ok: res.count > 0,
            command,
            build,
            query: target,
            filters,
            count: res.count,
            page: res.page,
            pageSize: res.pageSize,
            rows: res.rows,
          }),
        );
        return res.count > 0 ? EXIT_OK : EXIT_FAIL;
      }
      const lines = [headerOf(ledger)];
      if (res.count === 0) {
        lines.push(
          command === "find"
            ? `No rows match "${target}". Try a shorter query, drop a filter (--kind, --module, --dim, --shard), or use describe with an exact id.`
            : `${target} has no child rows in the ledger.`,
        );
        io.out(lines.join("\n"));
        return EXIT_FAIL;
      }
      const from = (res.page - 1) * res.pageSize + 1;
      const to = from + res.rows.length - 1;
      lines.push(
        `Page ${res.page} of ${res.pages} — showing results ${from}–${to} of ${res.count}`,
      );
      lines.push("---");
      for (const r of res.rows) lines.push(hitLine(r));
      lines.push("---");
      if (res.page < res.pages) lines.push(`Next: call again with page=${res.page + 1}.`);
      io.out(lines.join("\n"));
      return EXIT_OK;
    }

    const aliases = loadAliases(paths);
    const d = describe(ledger, aliases, target);
    if (!d.row) {
      if (json) io.out(JSON.stringify({ ok: false, command, build, id: target, near: d.near }));
      else io.out([`NOT FOUND: ${target}`, ...d.near.map((n) => `near: ${n}`)].join("\n"));
      return EXIT_FAIL;
    }
    if (command === "path") {
      const chain = parentChain(ledger, d.row.id).reverse();
      if (json) io.out(JSON.stringify({ ok: true, command, build, id: d.row.id, path: chain }));
      else io.out(chain.join(" > "));
      return EXIT_OK;
    }
    if (json) {
      io.out(
        JSON.stringify({
          ok: true,
          command,
          build,
          row: d.row,
          children_ids: d.childrenIds,
          parent_chain: d.parentChain,
          alias: d.alias ?? null,
        }),
      );
      return EXIT_OK;
    }
    const lines = [`id: ${d.row.id}`];
    if (d.alias) lines.push(`via alias: ${d.alias.from} — ${d.alias.why}`);
    lines.push(...describeLines(d.row, d.parentChain, d.childrenIds, values.children === "all"));
    io.out(lines.join("\n"));
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
