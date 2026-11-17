/**
 * Census queries (plan 4.6 cold-tester tool; no Workbench contact). Reads
 * only the ledger shards, `ledger.meta.json`, `aliases.json` and
 * `universes.json` (main ruling 14), for howto what `loadReach` reads (policy, locators,
 * allow-lists) and `diag-catalog.json`, and, for `scan-project`, the named addon folder
 * (read-only).
 *
 *   npx tsx scripts/census/query.ts find <text> [--kind k] [--module m] [--dim d]
 *       [--shard core|attribute|schema|diag|all] [--tier Tn] [--status active|deferred]
 *       [--below-target] [--limit 20] [--page 1] [--json]
 *   npx tsx scripts/census/query.ts describe <id | owner-qualified name> [--children all] [--json]
 *       (not an id: "the key 'd' of IOPItemOpEnvClass" or "IOPItemOpEnvClass.d" resolves to the
 *       one row that fits; several that fit equally are listed as AMBIGUOUS, exit 1)
 *   npx tsx scripts/census/query.ts status [--module m] [--kind k] [--dim d] [--shard s] [--json]
 *   npx tsx scripts/census/query.ts children <id> [--page n] [--limit n] [--json]
 *   npx tsx scripts/census/query.ts path <id> [--json]
 *   npx tsx scripts/census/query.ts howto <row id | label | "how do I ..." | tool[.action]> [--json]
 *       (a diag menu path or a settings section/key, "Render/Sky" or "Render > Sky", names its
 *       row; a diag or setting row's answer carries the concrete wb_diag or wb_settings call,
 *       and describe of such a row names it too)
 *   npx tsx scripts/census/query.ts scan-project <dir> [--json]   (offline walk of an addon folder)
 *
 * Exit: 0 found; 1 nothing found; 2 usage or no ledger; 3 malformed ledger.
 * With --json, stdout carries exactly one JSON document.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadAliases } from "../../src/census/census-config.js";
import { loadDiagCatalog, type DiagEntry } from "../../src/census/diag-catalog.js";
import { escapeSegment } from "../../src/census/ids.js";
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
import {
  formatScan,
  howto,
  loadReach,
  scanProject,
  type HowtoResult,
} from "../../src/tools/wb-census.js";
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
  "       query.ts howto <row id | label | 'how do I ...' | tool[.action]> [--json]",
  "       query.ts scan-project <dir> [--json]",
].join("\n");

const COMMANDS = ["find", "describe", "status", "children", "path", "howto", "scan-project"];

// ── Diag and setting rows: the id from a path, and the concrete tool call ───────

/** E06's section name for values on the Workbench root key (`ROOT_SECTION` in e06-settings-store.ts). */
export const SETTINGS_ROOT_SECTION = "Arma Reforger Workbench";

/** wb_diag's `menu` must be one plain name (no space, quote or '='), at most 128 characters. */
const DIAG_MENU_NAME = /^[^\s"=]{1,128}$/;

/** howto's answer cap (plan 4.7). */
const HOWTO_MAX = 600;

function unescapeSegment(s: string): string {
  return s.replace(/^%23/, "#").replace(/%2F/g, "/").replace(/%25/g, "%");
}

/**
 * A diag menu path or a settings section and key written as a path ("Render/Sky",
 * "Render > Sky", "String Editor/legacyOptionsLoaded") names one row: the `diag:` or
 * `setting:` id built from it. Returns that id when exactly one such row exists (exact case
 * first, then case-insensitive), else the text unchanged. Anything else is left to howto.
 */
export function rowIdFromPath(ledger: LoadedLedger, text: string): string {
  const t = text.trim();
  if (ledger.byId.has(t)) return t;
  const prefixed = /^(diag|setting):(.*)$/i.exec(t);
  const path = (prefixed ? prefixed[2] : t).replace(/\s*>\s*/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path.includes("/") || /["']/.test(path)) return text;
  const cut = path.lastIndexOf("/");
  const settingId = `setting:${escapeSegment(path.slice(0, cut))}/${escapeSegment(path.slice(cut + 1))}`;
  const wanted = prefixed
    ? [prefixed[1].toLowerCase() === "diag" ? `diag:${path}` : settingId]
    : [`diag:${path}`, settingId];
  const exact = [...new Set(wanted)].filter((id) => ledger.byId.has(id));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return text;
  const lower = new Set(wanted.map((w) => w.toLowerCase()));
  const loose = ledger.rows.filter((r) => lower.has(r.id.toLowerCase())).map((r) => r.id);
  return loose.length === 1 ? loose[0] : text;
}

/** The section and key `wb_settings get` takes for a `setting:<section>/<key>` row id. */
export function settingsArgs(id: string): { section: string; key: string } | undefined {
  const m = /^setting:([^/]+)\/(.+)$/.exec(id);
  if (!m) return undefined;
  const section = unescapeSegment(m[1]);
  const key = unescapeSegment(m[2]);
  // wb_settings: the first registry segment is the ini section, the rest joins the key.
  const segs = section === SETTINGS_ROOT_SECTION ? [] : section.split("/");
  return segs.length === 0
    ? { section: "General", key }
    : { section: segs[0], key: [...segs.slice(1), key].join("/") };
}

/**
 * The concrete call for a diag or setting row howto answered with wb_diag or wb_settings:
 * `select` by menuId (catalogued menu) or by the menu name, `get` by the catalog's script
 * name, and `wb_settings get` by section and key. Undefined when no valid call can be built
 * (a menu name with a space and no catalog id, a gated action, another tool).
 */
export function toolCall(
  row: Row,
  h: Pick<HowtoResult, "tool" | "action">,
  catalog: readonly DiagEntry[] = [],
): Record<string, unknown> | undefined {
  if (h.tool === "wb_diag" && row.id.startsWith("diag:")) {
    const path = row.id.slice("diag:".length).toLowerCase();
    const e = catalog.find((c) => c.path.toLowerCase() === path);
    if (h.action === "select") {
      if (e && e.kind === "menu" && e.id !== null) return { action: "select", menuId: e.id };
      const name = row.label ?? row.id.slice(row.id.lastIndexOf("/") + 1);
      return DIAG_MENU_NAME.test(name) ? { action: "select", menu: name } : undefined;
    }
    if (h.action === "get" && e && e.kind !== "menu") {
      return { action: "get", names: [e.enumName] };
    }
    return undefined;
  }
  if (h.tool === "wb_settings" && h.action === "get") {
    const a = settingsArgs(row.id);
    return a ? { action: "get", section: a.section, key: a.key } : undefined;
  }
  return undefined;
}

/** `Call: <tool> <json args>`. */
export function callLine(tool: string, call: Record<string, unknown>): string {
  return `Call: ${tool} ${JSON.stringify(call)}`;
}

/** Puts the call line after the `Use:` line and keeps the answer within the cap (drops `Also:` lines first). */
export function withCallLine(text: string, line: string, max = HOWTO_MAX): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("Use: "));
  lines.splice(at < 0 ? 1 : at + 1, 0, line);
  while (lines.join("\n").length > max) {
    const also = lines.map((l) => l.startsWith("Also: ")).lastIndexOf(true);
    if (also < 0) break;
    lines.splice(also, 1);
  }
  const out = lines.join("\n");
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

function loadCatalogEntries(root: string): DiagEntry[] {
  try {
    return loadDiagCatalog(join(root, "diag-catalog.json"))?.entries ?? [];
  } catch {
    return [];
  }
}

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
    const options = {
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
    } as const;
    // The text or id right after the command may start with a dash (a CLI
    // switch such as -forceSaveAll): it is the argument, not an option.
    const [first, second] = argv;
    const dashText =
      first !== undefined &&
      COMMANDS.includes(first) &&
      second !== undefined &&
      second.startsWith("-") &&
      second !== "--" &&
      !(second.startsWith("--") && second.slice(2).split("=")[0] in options);
    const { values, positionals } = parseArgs({
      args: dashText ? [first, ...argv.slice(2)] : argv,
      allowPositionals: true,
      options,
      strict: true,
    });
    const command = positionals[0];
    const rest = dashText ? [second, ...positionals.slice(1)] : positionals.slice(1);
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (!command || !COMMANDS.includes(command)) {
      io.err(`query: ${command ? `unknown command ${command}` : "missing command"}\n${USAGE}`);
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

    if (command === "howto") {
      const h = howto(ledger, loadAliases(paths), rowIdFromPath(ledger, target), {
        reach: loadReach(paths.root),
      });
      const row = h.id ? ledger.byId.get(h.id) : undefined;
      const call =
        row && h.tool && !h.ambiguous
          ? toolCall(row, h, loadCatalogEntries(paths.root))
          : undefined;
      const answer =
        call && h.tool
          ? { ...h, text: withCallLine(h.text, redact(callLine(h.tool, call))), call }
          : h;
      if (json) io.out(JSON.stringify({ ok: h.found, command, build, query: target, ...answer }));
      else io.out(answer.text);
      return h.found ? EXIT_OK : EXIT_FAIL;
    }

    if (command === "scan-project") {
      const scan = scanProject(ledger, target);
      if (json) io.out(JSON.stringify({ ok: true, command, build, ...scan }));
      else io.out(formatScan(scan));
      return EXIT_OK;
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
    const d = describe(ledger, aliases, rowIdFromPath(ledger, target), { wording: true });
    if (!d.row && d.tied) {
      if (json) {
        io.out(
          JSON.stringify({
            ok: false,
            command,
            build,
            id: target,
            ambiguous: { ids: d.tied, count: d.tiedCount },
          }),
        );
      } else {
        io.out(
          [
            `AMBIGUOUS: ${d.tiedCount} rows fit "${redact(target)}" equally well; name the owner or the module`,
            ...d.tied.map((t) => `tied: ${t}`),
          ].join("\n"),
        );
      }
      return EXIT_FAIL;
    }
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
    if (d.wording) lines.push(`via wording: ${redact(d.wording)}`);
    lines.push(...describeLines(d.row, d.parentChain, d.childrenIds, values.children === "all"));
    // describe names the dedicated tool too, so a reader who stops here still gets the call.
    if (d.row.id.startsWith("diag:") || d.row.id.startsWith("setting:")) {
      const h = howto(ledger, aliases, d.row.id, { reach: loadReach(paths.root) });
      if (h.tool && h.action) {
        const call = toolCall(d.row, h, loadCatalogEntries(paths.root));
        const how = h.drivable === false && h.blocker ? ` (not drivable yet: ${h.blocker})` : "";
        lines.push(redact(`use: ${h.tool} ${h.action}${how}`));
        if (call) lines.push(redact(callLine(h.tool, call)));
      }
    }
    io.out(lines.join("\n"));
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
