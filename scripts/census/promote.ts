/**
 * Records tier evidence on a row (main session only). Appends state patches
 * to `state.jsonl`; never sets a tier (build.ts computes it) and never
 * touches the ledger. Every patch names an evidence record that must exist
 * under data/census/evidence/ and belong to the current build.
 *
 *   npx tsx scripts/census/promote.ts <id> --evidence EV-<session>-<seq>
 *       [--mcp <tool>.<action>:read|drive]... [--test <test id>:<file>:contract|negative-safety|corpus|live]...
 *       [--path <path>=verified|refuted]... [--chosen-path <path>] [--confirm-risk <class>]
 *       [--clear-unverified <claim>]... [--work-item <WI-n|Un|Dn|P-...>] [--notes <text>]
 *       [--dry-run] [--json] [--data <dir>] [--at <iso time>]
 *   npx tsx scripts/census/promote.ts --accept-covers --from observations/E11/<build>.jsonl --evidence EV-...
 *   npx tsx scripts/census/promote.ts --batch <file.jsonl> --evidence EV-... [--dry-run] [--json]
 *
 * --accept-covers turns every `covers_proposed` of that E11 file into an MCP
 * link (role read) on the covered row: proposals become links only here.
 *
 * --batch records many rows' tier evidence under one evidence id, all or
 * nothing: every line is checked first and nothing is written unless all of
 * them pass (a wave's promotion from its battery, plan 8 Phase 5 step 7).
 * One JSON object per line, one of:
 *   {"id": "<row>", "mcp": [{"action": "mcp:action/<tool>.<action>", "role": "read"|"drive"}],
 *    "tests": [{"id": ..., "file": "<repo-relative>", "kind": "contract"|"negative-safety"|"corpus"|"live"}],
 *    "paths": [{"path": ..., "status": "verified"|"refuted", "reason"?: ...}],
 *    "chosen_path": ..., "confirm_risk": ..., "notes": ...,
 *    "withdraw": ["mcp"|"tests"|"paths"|"chosen_path", ...]}       (every key but id optional;
 *    withdraw writes one clear patch first, for evidence the code or a run no longer supports,
 *    and needs notes)
 *   {"live_result": {"test": ..., "rows": [...], "verdict": "pass"|"fail"|"skip",
 *    "oracle": ..., "evidence"?: "EV-...", "date"?: ...}}           (appended to live-results/<build>.jsonl)
 * The row checks are the single-row ones: an mcp link must name an
 * mcp-action row, a test file must contain census:<id>, a confirmed risk may
 * not lower the row's risk.
 *
 * Exit: 0 written (or dry run ok); 1 refused; 2 usage; 3 malformed census data.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildLedger } from "../../src/census/build-ledger.js";
import { fileNamesRow } from "../../src/census/hygiene.js";
import { readJsonl } from "../../src/census/ledger-io.js";
import { liveResultSchema, type LiveResult, type Row } from "../../src/census/schemas.js";
import {
  appendLiveResult,
  appendStatePatch,
  requireEvidence,
  type PatchRequest,
} from "../../src/census/writers.js";
import {
  MCP_ROLES,
  PATH_KINDS,
  RISKS,
  TEST_KINDS,
  riskIndex,
  type Risk,
} from "../../src/census/vocab.js";
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
  "usage: promote.ts <id> --evidence EV-... [--mcp tool.action:read|drive]... [--test id:file:kind]...",
  "         [--path <path>=verified|refuted]... [--chosen-path <path>] [--confirm-risk <class>]",
  "         [--clear-unverified <claim>]... [--work-item <id>] [--notes <text>] [--dry-run] [--json] [--data <dir>]",
  "       promote.ts --accept-covers --from observations/E11/<build>.jsonl --evidence EV-...",
  "       promote.ts --batch <file.jsonl> --evidence EV-... [--dry-run] [--json]",
].join("\n");

/** One row line of a --batch file (every key but id optional). */
interface BatchRowLine {
  id: string;
  mcp?: { action: string; role: string }[];
  tests?: { id: string; file: string; kind: string }[];
  paths?: { path: string; status: string; reason?: string }[];
  chosen_path?: string;
  confirm_risk?: string;
  notes?: string;
  /** Fields whose recorded evidence no longer holds (the code changed or a run refuted it): one
   *  clear patch, written before the line's other patches. */
  withdraw?: string[];
}

/** The fields a batch line may withdraw (a clear patch): the evidence a tier is computed from. */
export const WITHDRAWABLE = ["mcp", "tests", "paths", "chosen_path"] as const;

const BATCH_ROW_KEYS = new Set([
  "withdraw",
  "id",
  "mcp",
  "tests",
  "paths",
  "chosen_path",
  "confirm_risk",
  "notes",
]);

/**
 * The state patches of one --batch row line, checked as the single-row flags
 * are: the row exists, each mcp link names an mcp-action row, each test file
 * names the row, a confirmed risk does not lower the row's risk.
 */
function batchRowRequests(
  line: BatchRowLine,
  rows: ReadonlyMap<string, Row>,
  repo: string,
  cache: Map<string, string | null>,
  base: Omit<PatchRequest, "id" | "op" | "fields">,
): PatchRequest[] {
  for (const k of Object.keys(line))
    if (!BATCH_ROW_KEYS.has(k)) throw new Error(`unknown key ${k} in a row line`);
  const row = rows.get(line.id);
  if (!row)
    throw new Error(`${line.id} is not a ledger row (run build.ts; state cannot create rows)`);
  const id = line.id;
  const out: PatchRequest[] = [];
  if (line.withdraw !== undefined) {
    if (!Array.isArray(line.withdraw) || line.withdraw.length === 0)
      throw new Error("withdraw takes a non-empty list of fields");
    const fields: Record<string, null> = {};
    for (const f of line.withdraw) {
      if (!(WITHDRAWABLE as readonly string[]).includes(f))
        throw new Error(`withdraw ${f}: expected ${WITHDRAWABLE.join("|")}`);
      fields[f] = null;
    }
    if (!line.notes) throw new Error(`${id}: a withdraw line needs notes saying why`);
    out.push({ ...base, id, op: "clear", fields });
  }
  if (line.mcp?.length) {
    for (const m of line.mcp) {
      if (rows.get(m.action)?.kind !== "mcp-action")
        throw new Error(`mcp link ${m.action} resolves to no tool action`);
      if (!(MCP_ROLES as readonly string[]).includes(m.role))
        throw new Error(`mcp role ${m.role}: expected ${MCP_ROLES.join("|")}`);
    }
    out.push({ ...base, id, op: "append", fields: { mcp: line.mcp } });
  }
  if (line.tests?.length) {
    for (const t of line.tests) {
      if (!(TEST_KINDS as readonly string[]).includes(t.kind))
        throw new Error(`test kind ${t.kind}: expected ${TEST_KINDS.join("|")}`);
      if (!fileNamesRow(repo, t.file, id, cache))
        throw new Error(`test file ${t.file} does not exist or does not contain census:${id}`);
    }
    out.push({ ...base, id, op: "append", fields: { tests: line.tests } });
  }
  if (line.paths?.length) out.push({ ...base, id, op: "append", fields: { paths: line.paths } });
  const set: Record<string, unknown> = {};
  if (line.chosen_path) set.chosen_path = line.chosen_path;
  if (line.confirm_risk) {
    const r = line.confirm_risk as Risk;
    if (!(RISKS as readonly string[]).includes(r))
      throw new Error(`confirm_risk ${r}: expected ${RISKS.join("|")}`);
    if (row.risk !== undefined && riskIndex(r) < riskIndex(row.risk))
      throw new Error(`${id} has risk ${row.risk}; confirming the lower ${r} would lower it`);
    set.risk_confirmed = r;
  }
  if (line.notes) set.notes = line.notes;
  if (Object.keys(set).length) out.push({ ...base, id, op: "set", fields: set });
  if (out.length === 0) throw new Error(`${id}: the line records nothing`);
  return out;
}

function parseMcp(v: string): { action: string; role: string } {
  const m = /^([a-z0-9_]+\.[A-Za-z0-9_-]+):(read|drive)$/.exec(v);
  if (!m) throw new Error(`--mcp ${v}: expected <tool>.<action>:${MCP_ROLES.join("|")}`);
  return { action: `mcp:action/${m[1]}`, role: m[2] };
}

function parseTest(v: string): { id: string; file: string; kind: string } {
  const first = v.indexOf(":");
  const last = v.lastIndexOf(":");
  const kind = v.slice(last + 1);
  if (first === -1 || first === last || !(TEST_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`--test ${v}: expected <test id>:<repo-relative file>:${TEST_KINDS.join("|")}`);
  }
  return { id: v.slice(0, first), file: v.slice(first + 1, last), kind };
}

function parsePath(v: string): { path: string; status: string } {
  const m = /^([a-z-]+)=(verified|refuted)$/.exec(v);
  if (!m || !(PATH_KINDS as readonly string[]).includes(m[1])) {
    throw new Error(`--path ${v}: expected <${PATH_KINDS.join("|")}>=verified|refuted`);
  }
  return { path: m[1], status: m[2] };
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "promote", () => {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        evidence: { type: "string" },
        mcp: { type: "string", multiple: true },
        test: { type: "string", multiple: true },
        path: { type: "string", multiple: true },
        "chosen-path": { type: "string" },
        "confirm-risk": { type: "string" },
        "clear-unverified": { type: "string", multiple: true },
        "work-item": { type: "string" },
        notes: { type: "string" },
        "accept-covers": { type: "boolean" },
        from: { type: "string" },
        batch: { type: "string" },
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
    if (!values.evidence) {
      io.err(
        `promote: --evidence is required (every state patch names an evidence record)\n${USAGE}`,
      );
      return EXIT_USAGE;
    }
    const paths = pathsFrom(values.data);
    const before = buildLedger(paths);
    const rows = new Map<string, Row>(before.rows.map((r) => [r.id, r]));
    const at = values.at ?? new Date().toISOString();
    const requests: PatchRequest[] = [];
    const base = { evidence: values.evidence, by: "promote.ts" as const, at };

    if (values.batch) {
      if (values["accept-covers"] || positionals.length > 0) {
        io.err(`promote: --batch takes no row id and no --accept-covers\n${USAGE}`);
        return EXIT_USAGE;
      }
      requireEvidence(paths, values.evidence);
      const file = values.batch;
      const lines = readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l, i) => {
          try {
            return JSON.parse(l) as Record<string, unknown>;
          } catch {
            throw new Error(`${file}:${i + 1}: not valid JSON`);
          }
        });
      const cache = new Map<string, string | null>();
      const patches: PatchRequest[] = [];
      const live: LiveResult[] = [];
      lines.forEach((l, i) => {
        try {
          if (l.live_result !== undefined) {
            if (Object.keys(l).length !== 1)
              throw new Error("a live_result line holds nothing else");
            live.push(liveResultSchema.parse(l.live_result));
          } else {
            if (typeof l.id !== "string") throw new Error("a row line needs an id");
            patches.push(
              ...batchRowRequests(l as unknown as BatchRowLine, rows, paths.repo, cache, base),
            );
          }
        } catch (e) {
          throw new Error(`${file}:${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      // Check every patch and live line first: nothing is written unless all of them pass.
      for (const p of patches) appendStatePatch(paths, rows, p, { dryRun: true });
      for (const r of live) appendLiveResult(paths, rows, r, { dryRun: true });
      const dry = values["dry-run"] === true;
      if (!dry) {
        for (const p of patches) appendStatePatch(paths, rows, p);
        for (const r of live) appendLiveResult(paths, rows, r);
      }
      const after = dry ? null : buildLedger(paths);
      const tiers: Record<string, string> = {};
      if (after) {
        const ids = new Set(patches.map((p) => p.id));
        for (const r of after.rows)
          if (ids.has(r.id)) tiers[r.tier] = String(Number(tiers[r.tier] ?? 0) + 1);
      }
      const summary = {
        ok: true,
        command: "promote",
        dry_run: dry,
        lines: lines.length,
        patches: patches.length,
        rows: new Set(patches.map((p) => p.id)).size,
        live_results: live.length,
        tiers_after: after ? tiers : null,
      };
      if (values.json) io.out(JSON.stringify(summary));
      else {
        io.out(
          `${dry ? "checked" : "appended"} ${patches.length} patch(es) on ${summary.rows} row(s) and ${live.length} live result(s) from ${file} under ${values.evidence}`,
        );
        if (after)
          io.out(
            `tiers of those rows now: ${Object.entries(tiers)
              .sort()
              .map(([t, n]) => `${t} ${n}`)
              .join(", ")}; run build.ts to refresh the committed ledger`,
          );
      }
      return EXIT_OK;
    }

    if (values["accept-covers"]) {
      if (!values.from || positionals.length > 0) {
        io.err(`promote: --accept-covers takes --from and no row id\n${USAGE}`);
        return EXIT_USAGE;
      }
      const rel = values.from.split("\\").join("/");
      if (!/^observations\/E11\/[^/]+\.jsonl$/.test(rel)) {
        io.err("promote: --from must name an observations/E11/<build>.jsonl file");
        return EXIT_USAGE;
      }
      const file = resolve(join(paths.root, rel));
      const accepted = before.observations.filter((a) => a.file === rel);
      if (accepted.length === 0 && readJsonl(file).length === 0) {
        io.err(`promote: ${rel} has no accepted observations`);
        return EXIT_FAIL;
      }
      const links = new Map<string, Set<string>>();
      for (const a of accepted) {
        if (!a.id.startsWith("mcp:action/")) continue;
        for (const target of a.obs.covers_proposed ?? []) {
          const set = links.get(target) ?? new Set<string>();
          set.add(a.id);
          links.set(target, set);
        }
      }
      for (const [target, actions] of [...links.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        const existing = new Set(rows.get(target)?.mcp.map((m) => m.action) ?? []);
        const add = [...actions].filter((a) => !existing.has(a)).sort();
        if (add.length === 0) continue;
        requests.push({
          ...base,
          id: target,
          op: "append",
          fields: { mcp: add.map((action) => ({ action, role: "read" })) },
        });
      }
    } else {
      if (positionals.length !== 1) {
        io.err(`promote: give exactly one row id\n${USAGE}`);
        return EXIT_USAGE;
      }
      const id = positionals[0];
      const row = rows.get(id);
      if (!row) {
        io.err(`promote: ${id} is not a ledger row (run build.ts; state cannot create rows)`);
        return EXIT_FAIL;
      }
      if (values.mcp?.length)
        requests.push({ ...base, id, op: "append", fields: { mcp: values.mcp.map(parseMcp) } });
      if (values.test?.length) {
        const tests = values.test.map(parseTest);
        const cache = new Map<string, string | null>();
        const missing = tests.find((t) => !fileNamesRow(paths.repo, t.file, id, cache));
        if (missing)
          throw new Error(
            `test file ${missing.file} does not exist or does not contain census:${id}`,
          );
        requests.push({ ...base, id, op: "append", fields: { tests } });
      }
      if (values.path?.length)
        requests.push({ ...base, id, op: "append", fields: { paths: values.path.map(parsePath) } });
      const set: Record<string, unknown> = {};
      if (values["chosen-path"]) set.chosen_path = values["chosen-path"];
      if (values["confirm-risk"]) {
        const r = values["confirm-risk"] as Risk;
        if (!(RISKS as readonly string[]).includes(r))
          throw new Error(`--confirm-risk ${r}: expected ${RISKS.join("|")}`);
        if (row.risk !== undefined && riskIndex(r) < riskIndex(row.risk)) {
          throw new Error(
            `${id} has risk ${row.risk}; confirming the lower ${r} would lower it (use dispose.ts --risk-downgrade with evidence)`,
          );
        }
        set.risk_confirmed = r;
      }
      if (values["work-item"]) set.work_item = values["work-item"];
      if (values.notes) set.notes = values.notes;
      if (Object.keys(set).length) requests.push({ ...base, id, op: "set", fields: set });
      if (values["clear-unverified"]?.length) {
        const claims = new Set(row.unverified.map((u) => u.claim));
        const unknown = values["clear-unverified"].find((c) => !claims.has(c));
        if (unknown) throw new Error(`${id} has no unverified claim "${unknown}"`);
        requests.push({
          ...base,
          id,
          op: "append",
          fields: { unverified_cleared: values["clear-unverified"] },
        });
      }
    }

    if (requests.length === 0) {
      io.err(`promote: nothing to record\n${USAGE}`);
      return EXIT_USAGE;
    }
    const written = requests.map((r) =>
      appendStatePatch(paths, rows, r, { dryRun: values["dry-run"] }),
    );
    const after = values["dry-run"] ? null : buildLedger(paths);
    const afterRows = new Map(after?.rows.map((r) => [r.id, r]) ?? []);
    const report = written.map((p) => ({
      seq: p.seq,
      id: p.id,
      op: p.op,
      fields: p.fields,
      tier_before: rows.get(p.id)?.tier,
      tier_after: afterRows.get(p.id)?.tier ?? null,
    }));
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "promote",
          dry_run: values["dry-run"] === true,
          patches: report,
        }),
      );
    } else {
      for (const r of report) {
        io.out(
          `${values["dry-run"] ? "would append" : "appended"} seq ${r.seq}: ${r.id} ${r.op} ${Object.keys(r.fields).join(", ")}` +
            ` — tier ${r.tier_before}${r.tier_after ? ` -> ${r.tier_after}` : ""}`,
        );
      }
      if (after) io.out("run build.ts to refresh the committed ledger");
    }
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
