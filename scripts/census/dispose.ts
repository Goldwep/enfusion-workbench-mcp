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
 *   dispose.ts <id> --defer --reason <text> --work-item <WI-n|Un|Dn|P-...> --evidence EV-...
 *   dispose.ts <id> --reactivate --evidence EV-...
 *   dispose.ts <id> --risk-downgrade --to <class> --reason <text> --evidence EV-...
 *   dispose.ts <id> --target-override T<n> --reason <text> --evidence EV-...
 *   dispose.ts <id> --recon-resolution <merged-via-alias|duplicate-of|recon-error|absent-in-build>:<ref> --evidence EV-...
 *   dispose.ts <id> --reconcile-explained <universe> --enumerator <E..> --explain <kind> --ref <ref> --evidence EV-...
 *   dispose.ts --signoff-batch EV-... --rows <id>,<id>,...
 *   dispose.ts --probe <P-id> --outcome <text> --evidence EV-... [--status resolved|blocked|deferred] [--owner-deferral]
 *   dispose.ts --probe <P-id> --schedule <session> [--status scheduled] [--architecture-deciding]
 *   common: [--dry-run] [--json] [--data <dir>] [--at <iso time>]
 *
 * Exit: 0 written; 1 refused; 2 usage; 3 malformed census data.
 */
import { parseArgs } from "node:util";
import { buildLedger } from "../../src/census/build-ledger.js";
import { loadPolicy, policyPathExists } from "../../src/census/census-config.js";
import type { Row } from "../../src/census/schemas.js";
import { checkEvidence, foldProbes } from "../../src/census/state.js";
import { appendProbeLine, appendStatePatch, type PatchRequest } from "../../src/census/writers.js";
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
  "       dispose.ts <id> --reactivate --evidence EV-...",
  "       dispose.ts <id> --risk-downgrade --to <class> --reason <text> --evidence EV-...",
  "       dispose.ts <id> --target-override T<n> --reason <text> --evidence EV-...",
  "       dispose.ts <id> --recon-resolution <kind>:<ref> --evidence EV-...",
  "       dispose.ts <id> --reconcile-explained <universe> --enumerator <E..> --explain <kind> --ref <ref> --evidence EV-...",
  "       dispose.ts --signoff-batch EV-... --rows <id>,<id>,...",
  "       dispose.ts --probe <P-id> --outcome <text> --evidence EV-... [--status s] [--owner-deferral]",
  "       dispose.ts --probe <P-id> --schedule <session> [--status scheduled] [--architecture-deciding]",
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
      const d = parseDisposition(values.as);
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
