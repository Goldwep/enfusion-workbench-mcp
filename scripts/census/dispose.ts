/**
 * Records dispositions, deferrals, risk and target overrides, recon and
 * reconcile explanations, owner sign-off batches and probe outcomes (main
 * session only). Appends to `state.jsonl` or `probes.jsonl`; every write
 * names an evidence record. The disposition vocabulary is plan 1.4's
 * (`excluded-policy`, `not-automatable`, `blocked:<probe>`, `absent-in-build`,
 * `duplicate-of:<id>`, `subsumed-by:<id>`); `deferred` is a status, not a
 * disposition, and any other spelling is refused.
 *
 *   dispose.ts <id> --as <disposition>[:<ref>] --why <text> --evidence EV-...
 *   dispose.ts <id> --defer --reason <text> --work-item <WI-n|Un|Dn|Wn|P-...> --evidence EV-...
 *   dispose.ts <id> --work-item <WI-n|Un|Dn|Wn|P-...> --reason <text> --evidence EV-...   (stays active)
 *   dispose.ts <id> --reactivate --evidence EV-...
 *   dispose.ts <id> --risk-downgrade --to <class> --reason <text> --evidence EV-...
 *   dispose.ts <id> --target-override T<n> --reason <text> --evidence EV-...
 *   dispose.ts <id> --recon-resolution <merged-via-alias|duplicate-of|recon-error|absent-in-build|out-of-scope>:<ref> --evidence EV-...
 *   dispose.ts <id> --reconcile-explained <universe> --enumerator <E..> --explain <kind> --ref <ref> --evidence EV-...
 *   dispose.ts --signoff-batch EV-... --rows <id>,<id>,...
 *   dispose.ts --probe <P-id> --outcome <text> --evidence EV-... [--status resolved|blocked|deferred] [--owner-deferral]
 *   dispose.ts --probe <P-id> --schedule <session> [--status scheduled] [--architecture-deciding]
 *   dispose.ts --batch <file.jsonl> --evidence EV-...
 *   common: [--dry-run] [--json] [--data <dir>] [--at <iso time>]
 *
 * --batch applies many records under one evidence id, all or nothing: every
 * line is checked first and nothing is written unless all of them pass. One
 * JSON object per line, one of:
 *   {"id": "<row>", "recon_resolution": {"kind": ..., "ref": ...}}
 *   {"id": "<row>", "reconcile_explained": {"universe": ..., "enumerator": ..., "kind": ..., "ref": ...}}
 *   {"id": "<row>", "as": "<disposition>[:<ref>]", "why": "<text>"}
 *   {"id": "<row>", "work_item": "<id>", "reason": "<text>"}            (stays active)
 *   {"id": "<row>", "defer": {"reason": "<text>", "work_item": "<id>"}}
 *   {"id": "<row>", "mcp": [{"action": "mcp:action/<tool>.<action>", "role": "read"|"drive"}]}   (appended)
 *   {"probe": "<P-id>", "schedule": "<session>", "architecture_deciding": true|false, "status": "scheduled"|"deferred"|"blocked"}
 *   {"probe": "<P-id>", "outcome": "<text>", "status": "resolved"|"blocked"|"deferred", "owner_deferral": true|false}
 *   {"probe": "<P-id>", "open": {"question": ..., "source": ...}, "schedule": "<session>", "architecture_deciding": true|false}
 * A probe opened and scheduled takes one line; a probe scheduled and answered
 * takes two (schedule, then outcome). A probe is opened at most once per batch,
 * and a status outside the ones listed for its line is refused.
 *
 * Exit: 0 written; 1 refused; 2 usage; 3 malformed census data.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildLedger } from "../../src/census/build-ledger.js";
import { loadPolicy, policyPathExists } from "../../src/census/census-config.js";
import type { Row } from "../../src/census/schemas.js";
import { checkEvidence, foldProbes } from "../../src/census/state.js";
import {
  appendProbeLine,
  appendStatePatch,
  requireEvidence,
  type PatchRequest,
} from "../../src/census/writers.js";
import {
  DISPOSITIONS_OWNER_SIGNOFF,
  DISPOSITIONS_WITH_REFERENCE,
  DISPOSITION_KINDS,
  RISKS,
  TIERS,
  type DispositionKind,
} from "../../src/census/vocab.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "./cli-common.js";

const USAGE = [
  "usage: dispose.ts <id> --as <disposition>[:<ref>] --why <text> --evidence EV-...",
  "       dispose.ts <id> --defer --reason <text> --work-item <id> --evidence EV-...",
  "       dispose.ts <id> --work-item <id> --reason <text> --evidence EV-...   (stays active)",
  "       dispose.ts <id> --reactivate --evidence EV-...",
  "       dispose.ts <id> --risk-downgrade --to <class> --reason <text> --evidence EV-...",
  "       dispose.ts <id> --target-override T<n> --reason <text> --evidence EV-...",
  "       dispose.ts <id> --recon-resolution <kind>:<ref> --evidence EV-...",
  "       dispose.ts <id> --reconcile-explained <universe> --enumerator <E..> --explain <kind> --ref <ref> --evidence EV-...",
  "       dispose.ts --signoff-batch EV-... --rows <id>,<id>,...",
  "       dispose.ts --probe <P-id> --outcome <text> --evidence EV-... [--status s] [--owner-deferral]",
  "       dispose.ts --probe <P-id> --schedule <session> [--status scheduled] [--architecture-deciding]",
  "       dispose.ts --batch <file.jsonl> --evidence EV-...",
  "       common: [--dry-run] [--json] [--data <dir>] [--at <iso time>]",
].join("\n");

/** Parses `kind[:ref]` against the plan 1.4 vocabulary. Throws on `deferred`, typos or a missing reference. */
export function parseDisposition(value: string): { kind: DispositionKind; ref?: string } {
  const i = value.indexOf(":");
  const kind = i === -1 ? value : value.slice(0, i);
  const ref = i === -1 ? undefined : value.slice(i + 1);
  if (kind === "deferred") {
    throw new Error("deferred is a status, not a disposition: use --defer --reason --work-item");
  }
  if (!(DISPOSITION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `unknown disposition ${kind}; the vocabulary is ${DISPOSITION_KINDS.join(", ")}`,
    );
  }
  const k = kind as DispositionKind;
  if ((DISPOSITIONS_WITH_REFERENCE.includes(k) || k === "excluded-policy") && !ref) {
    throw new Error(
      k === "excluded-policy"
        ? "excluded-policy needs the policy.json path it rests on: excluded-policy:<path>"
        : `${k} needs a reference: ${k}:<${k === "blocked" ? "probe id" : "row id"}>`,
    );
  }
  if (ref !== undefined && !DISPOSITIONS_WITH_REFERENCE.includes(k) && k !== "excluded-policy") {
    throw new Error(`${k} takes no reference`);
  }
  return { kind: k, ref };
}

/**
 * Parses and checks a disposition for one row: the row exists (or is a
 * retired candidate taking absent-in-build), a blocked probe still blocks,
 * a duplicate-of/subsumed-by target is the end of its chain, and an
 * excluded-policy path exists in policy.json.
 */
function checkDisposition(
  paths: ReturnType<typeof pathsFrom>,
  rows: ReadonlyMap<string, Row>,
  absent: ReadonlySet<string>,
  id: string,
  value: string,
): { kind: DispositionKind; ref?: string } {
  const d = parseDisposition(value);
  const row = rows.get(id);
  if (!row && !(absent.has(id) && d.kind === "absent-in-build"))
    throw new Error(`${id} is not a ledger row`);
  if (d.kind === "blocked") {
    const p = foldProbes(paths).probes.get(d.ref as string);
    if (!p) throw new Error(`blocked:${d.ref} names no probe in probes.jsonl`);
    if (p.outcome && p.status !== "blocked")
      throw new Error(`probe ${d.ref} already has an outcome; it no longer blocks`);
  }
  if (d.kind === "duplicate-of" || d.kind === "subsumed-by") {
    const target = rows.get(d.ref as string);
    if (!target || d.ref === id)
      throw new Error(`${d.kind}:${d.ref} must name another existing row`);
    if (target.disposition && DISPOSITIONS_WITH_REFERENCE.includes(target.disposition.kind)) {
      throw new Error(
        `${d.ref} is itself ${target.disposition.kind}; point at the end of the chain`,
      );
    }
  }
  if (d.kind === "excluded-policy" && !policyPathExists(loadPolicy(paths), d.ref as string)) {
    throw new Error(`policy.json has no path ${d.ref}`);
  }
  return d;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "dispose", () => {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        as: { type: "string" },
        why: { type: "string" },
        evidence: { type: "string" },
        defer: { type: "boolean" },
        reactivate: { type: "boolean" },
        reason: { type: "string" },
        "work-item": { type: "string" },
        "risk-downgrade": { type: "boolean" },
        to: { type: "string" },
        "target-override": { type: "string" },
        "recon-resolution": { type: "string" },
        "reconcile-explained": { type: "string" },
        enumerator: { type: "string" },
        explain: { type: "string" },
        ref: { type: "string" },
        "signoff-batch": { type: "string" },
        rows: { type: "string" },
        probe: { type: "string" },
        outcome: { type: "string" },
        schedule: { type: "string" },
        status: { type: "string" },
        "owner-deferral": { type: "boolean" },
        "architecture-deciding": { type: "boolean" },
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
    const paths = pathsFrom(values.data);
    const dryRun = values["dry-run"] === true;
    const at = values.at ?? new Date().toISOString();
    const emit = (lines: string[], payload: unknown): void => {
      if (values.json)
        io.out(JSON.stringify({ ok: true, command: "dispose", dry_run: dryRun, result: payload }));
      else io.out(lines.join("\n"));
    };

    // ── Batch ────────────────────────────────────────────────────────────────
    if (values.batch) {
      if (!values.evidence) throw new Error("--batch needs --evidence");
      const evidence = values.evidence;
      // Schedule lines carry the id too, so it must resolve even when no line checks it.
      requireEvidence(paths, evidence);
      const items = readFileSync(values.batch, "utf-8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l, i) => {
          try {
            return JSON.parse(l) as Record<string, unknown>;
          } catch {
            throw new Error(`${values.batch}:${i + 1}: not valid JSON`);
          }
        });
      const builtForBatch = buildLedger(paths);
      const rows = new Map<string, Row>(builtForBatch.rows.map((r) => [r.id, r]));
      const absent = new Set((builtForBatch.meta.absent_candidates as string[]) ?? []);
      const statusOf = <const S extends string>(
        value: unknown,
        allowed: readonly S[],
        fallback: S,
      ): S => {
        if (value === undefined) return fallback;
        if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
          throw new Error(`status ${String(value)}: expected ${allowed.join("|")}`);
        return value as S;
      };
      const applyAll = (dry: boolean): string[] => {
        const done: string[] = [];
        // The checking pass writes nothing, so it cannot see a probe opened by
        // an earlier line of the same batch; a second open is refused here.
        const openedHere = new Set<string>();
        items.forEach((it, i) => {
          try {
            if (typeof it.probe === "string") {
              const open = it.open as { question?: string; source?: string } | undefined;
              if (open) {
                if (!open.question || !open.source)
                  throw new Error("an opened probe needs a question and a source");
                if (openedHere.has(it.probe))
                  throw new Error(`probe ${it.probe} is opened twice in this batch`);
                openedHere.add(it.probe);
                // A probe opened here may be scheduled on the same line.
                const line = appendProbeLine(
                  paths,
                  {
                    id: it.probe,
                    op: "open",
                    question: open.question,
                    source: open.source,
                    status: typeof it.schedule === "string" ? "scheduled" : "open",
                    scheduled_session: typeof it.schedule === "string" ? it.schedule : undefined,
                    architecture_deciding: it.architecture_deciding === true ? true : undefined,
                    by: "dispose.ts",
                  },
                  { dryRun: dry },
                );
                done.push(`${line.id} opened`);
              } else if (typeof it.outcome === "string") {
                const line = appendProbeLine(
                  paths,
                  {
                    id: it.probe,
                    op: "outcome",
                    outcome: it.outcome,
                    evidence,
                    status: statusOf(it.status, ["resolved", "blocked", "deferred"], "resolved"),
                    deferral_accepted_by_owner: it.owner_deferral === true ? true : undefined,
                    by: "dispose.ts",
                  },
                  { dryRun: dry },
                );
                done.push(`${line.id} outcome`);
              } else if (typeof it.schedule === "string") {
                const line = appendProbeLine(
                  paths,
                  {
                    id: it.probe,
                    op: "schedule",
                    scheduled_session: it.schedule,
                    status: statusOf(it.status, ["scheduled", "deferred", "blocked"], "scheduled"),
                    architecture_deciding:
                      typeof it.architecture_deciding === "boolean"
                        ? it.architecture_deciding
                        : undefined,
                    evidence,
                    by: "dispose.ts",
                  },
                  { dryRun: dry },
                );
                done.push(`${line.id} scheduled ${it.schedule}`);
              } else throw new Error("a probe line needs open, outcome or schedule");
              return;
            }
            if (typeof it.id !== "string") throw new Error("a line needs id or probe");
            const base = { id: it.id, evidence, by: "dispose.ts" as const, at };
            let req: PatchRequest;
            if (it.recon_resolution !== undefined) {
              req = { ...base, op: "set", fields: { recon_resolution: it.recon_resolution } };
            } else if (it.reconcile_explained !== undefined) {
              req = {
                ...base,
                op: "append",
                fields: { reconcile_explained: [it.reconcile_explained] },
              };
            } else if (typeof it.as === "string") {
              if (typeof it.why !== "string" || it.why === "")
                throw new Error("a disposition line needs as and why");
              const d = checkDisposition(paths, rows, absent, it.id, it.as);
              req = {
                ...base,
                op: "set",
                fields: { disposition: { kind: d.kind, ref: d.ref, why: it.why } },
              };
              if (!rows.has(it.id)) {
                // A retired id (absent-in-build): the row is gone from every observation.
                const fake = new Map(rows);
                fake.set(it.id, { id: it.id } as Row);
                const p = appendStatePatch(paths, fake, req, { dryRun: dry });
                done.push(`${p.id} retired as absent-in-build`);
                return;
              }
            } else if (typeof it.work_item === "string") {
              if (typeof it.reason !== "string" || it.reason === "")
                throw new Error("a work_item line needs reason");
              req = {
                ...base,
                op: "set",
                fields: { work_item: it.work_item, work_item_reason: it.reason },
              };
            } else if (it.defer !== undefined) {
              const d = it.defer as { reason?: unknown; work_item?: unknown };
              if (typeof d.reason !== "string" || typeof d.work_item !== "string")
                throw new Error("a defer line needs defer.reason and defer.work_item");
              req = {
                ...base,
                op: "set",
                fields: { status: "deferred", deferred_reason: d.reason, work_item: d.work_item },
              };
            } else if (Array.isArray(it.mcp)) {
              for (const m of it.mcp as { action?: unknown }[]) {
                if (typeof m.action !== "string" || rows.get(m.action)?.kind !== "mcp-action")
                  throw new Error(`mcp link ${String(m.action)} resolves to no tool action`);
              }
              req = { ...base, op: "append", fields: { mcp: it.mcp } };
            } else {
              throw new Error(
                "a row line needs recon_resolution, reconcile_explained, as, work_item, defer or mcp",
              );
            }
            const p = appendStatePatch(paths, rows, req, { dryRun: dry });
            done.push(`${p.id} ${Object.keys(p.fields).join(", ")}`);
          } catch (e) {
            throw new Error(
              `${values.batch}:${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        });
        return done;
      };
      // Check every line first: nothing is written unless all of them pass.
      applyAll(true);
      const done = dryRun ? [] : applyAll(false);
      emit(
        [
          `${dryRun ? "checked" : "appended"} ${items.length} record(s) from ${values.batch} under ${evidence}`,
        ],
        { records: items.length, written: done.length },
      );
      return EXIT_OK;
    }

    // ── Probe log ────────────────────────────────────────────────────────────
    if (values.probe) {
      if (values.outcome) {
        if (!values.evidence) throw new Error("a probe outcome needs --evidence");
        const line = appendProbeLine(
          paths,
          {
            id: values.probe,
            op: "outcome",
            outcome: values.outcome,
            evidence: values.evidence,
            status:
              (values.status as "resolved" | "blocked" | "deferred" | undefined) ?? "resolved",
            deferral_accepted_by_owner: values["owner-deferral"] ? true : undefined,
            by: "dispose.ts",
          },
          { dryRun },
        );
        emit(
          [
            `${dryRun ? "would append" : "appended"} probes.jsonl seq ${line.seq}: ${line.id} outcome`,
          ],
          line,
        );
        return EXIT_OK;
      }
      if (values.schedule) {
        const line = appendProbeLine(
          paths,
          {
            id: values.probe,
            op: "schedule",
            scheduled_session: values.schedule,
            status: (values.status as "scheduled" | undefined) ?? "scheduled",
            architecture_deciding: values["architecture-deciding"] ? true : undefined,
            evidence: values.evidence,
            by: "dispose.ts",
          },
          { dryRun },
        );
        emit(
          [
            `${dryRun ? "would append" : "appended"} probes.jsonl seq ${line.seq}: ${line.id} scheduled ${values.schedule}`,
          ],
          line,
        );
        return EXIT_OK;
      }
      io.err(`dispose: --probe needs --outcome or --schedule\n${USAGE}`);
      return EXIT_USAGE;
    }

    const built = buildLedger(paths);
    const rows = new Map<string, Row>(built.rows.map((r) => [r.id, r]));
    const absent = new Set((built.meta.absent_candidates as string[]) ?? []);

    // ── Owner sign-off batch ─────────────────────────────────────────────────
    if (values["signoff-batch"]) {
      const ev = values["signoff-batch"];
      const check = checkEvidence(paths, ev);
      if (!check.ok) throw new Error(check.message);
      if (check.record?.kind !== "owner-signoff")
        throw new Error(`${ev} is not an evidence record of kind owner-signoff`);
      const ids = (values.rows ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) throw new Error("--signoff-batch needs --rows <id>,<id>,...");
      for (const id of ids) {
        const d = rows.get(id)?.disposition;
        if (!d || !DISPOSITIONS_OWNER_SIGNOFF.includes(d.kind)) {
          throw new Error(
            `${id} carries no ${DISPOSITIONS_OWNER_SIGNOFF.join(" or ")} disposition to sign off`,
          );
        }
      }
      const written = ids.map((id) =>
        appendStatePatch(
          paths,
          rows,
          { id, op: "set", fields: { owner_signoff: ev }, evidence: ev, by: "dispose.ts", at },
          { dryRun },
        ),
      );
      emit(
        written.map(
          (p) =>
            `${dryRun ? "would append" : "appended"} seq ${p.seq}: ${p.id} owner_signoff ${ev}`,
        ),
        written,
      );
      return EXIT_OK;
    }

    // ── Row-level patches ────────────────────────────────────────────────────
    if (positionals.length !== 1) {
      io.err(`dispose: give exactly one row id\n${USAGE}`);
      return EXIT_USAGE;
    }
    const id = positionals[0];
    if (!values.evidence) {
      io.err(`dispose: --evidence is required\n${USAGE}`);
      return EXIT_USAGE;
    }
    const base = { id, evidence: values.evidence, by: "dispose.ts" as const, at };
    let req: PatchRequest | null = null;

    if (values.as) {
      if (!values.why) throw new Error("--as needs --why");
      const d = checkDisposition(paths, rows, absent, id, values.as);
      const row = rows.get(id);
      req = {
        ...base,
        op: "set",
        fields: { disposition: { kind: d.kind, ref: d.ref, why: values.why } },
      };
      if (!row) {
        // A retired id: the row is gone from every observation; state is kept.
        const fake = new Map(rows);
        fake.set(id, { id } as Row);
        const p = appendStatePatch(paths, fake, req, { dryRun });
        emit(
          [
            `${dryRun ? "would append" : "appended"} seq ${p.seq}: ${id} retired as absent-in-build`,
          ],
          p,
        );
        return EXIT_OK;
      }
    } else if (values.defer) {
      if (!values.reason || !values["work-item"])
        throw new Error("--defer needs --reason and --work-item");
      req = {
        ...base,
        op: "set",
        fields: {
          status: "deferred",
          deferred_reason: values.reason,
          work_item: values["work-item"],
        },
      };
    } else if (values["work-item"]) {
      // A row that stays active but names the wave that will raise it
      // (DEC-056 ruling 1).
      if (!values.reason) throw new Error("--work-item needs --reason (or --defer)");
      req = {
        ...base,
        op: "set",
        fields: { work_item: values["work-item"], work_item_reason: values.reason },
      };
    } else if (values.reactivate) {
      req = { ...base, op: "set", fields: { status: "active" } };
    } else if (values["risk-downgrade"]) {
      if (!values.to || !values.reason) throw new Error("--risk-downgrade needs --to and --reason");
      if (!(RISKS as readonly string[]).includes(values.to))
        throw new Error(`--to ${values.to}: expected ${RISKS.join("|")}`);
      req = {
        ...base,
        op: "set",
        fields: { risk_downgrade: { to: values.to, reason: values.reason } },
      };
    } else if (values["target-override"]) {
      const t = values["target-override"];
      if (!(TIERS as readonly string[]).includes(t) || !values.reason) {
        throw new Error("--target-override needs a tier T0..T5 and --reason");
      }
      req = {
        ...base,
        op: "set",
        fields: { target_tier_override: { tier: t, reason: values.reason } },
      };
    } else if (values["recon-resolution"]) {
      const v = values["recon-resolution"];
      const i = v.indexOf(":");
      if (i === -1) throw new Error("--recon-resolution expects <kind>:<ref>");
      req = {
        ...base,
        op: "set",
        fields: { recon_resolution: { kind: v.slice(0, i), ref: v.slice(i + 1) } },
      };
    } else if (values["reconcile-explained"]) {
      if (!values.enumerator || !values.explain || !values.ref) {
        throw new Error("--reconcile-explained needs --enumerator, --explain and --ref");
      }
      const entry = {
        universe: values["reconcile-explained"],
        enumerator: values.enumerator,
        kind: values.explain,
        ref: values.ref,
      };
      req = { ...base, op: "append", fields: { reconcile_explained: [entry] } };
    }
    if (!req) {
      io.err(`dispose: nothing to record\n${USAGE}`);
      return EXIT_USAGE;
    }
    const p = appendStatePatch(paths, rows, req, { dryRun });
    emit(
      [
        `${dryRun ? "would append" : "appended"} seq ${p.seq}: ${id} ${Object.keys(p.fields).join(", ")}`,
      ],
      p,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
