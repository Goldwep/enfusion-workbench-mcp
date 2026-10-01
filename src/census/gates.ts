/**
 * Gates G1-G10 (plan 4.6), computed mechanically from the files under the
 * census root. `validate.ts` prints them; `report.ts` puts them at the top
 * of `COVERAGE.md`. The PII gate (G10) lives in `scripts/pii-gate.ts`, which
 * `src/` cannot import, so the caller supplies it.
 *
 * Phases (`--phase`): several gates describe exit conditions of later phases
 * (frontier, module-by-kind matrix, orphans, unlinked tool actions). Before
 * the phase whose exit they guard they report SOFT, with the same offender
 * list, instead of FAIL.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { compareCodeUnits } from "./canon.js";
import {
  loadG4Rules,
  loadPolicy,
  loadStateMatrix,
  loadUniverses,
  policyPathExists,
  riskOverride,
  type StateMatrix,
} from "./census-config.js";
import { buildLedger, type BuildResult } from "./build-ledger.js";
import { CensusDataError, readJsonl, shardFileName, type CensusPaths } from "./ledger-io.js";
import { reconcile, type ReconcileReport } from "./reconcile.js";
import { rowSchema, type Row } from "./schemas.js";
import { checkEvidence, foldProbes, foldState, isBytePrefix, type FoldedState } from "./state.js";
import { DISPOSITIONS_WITH_REFERENCE, KINDS, MODULES, SHARDS, TIERS } from "./vocab.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export const GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10"] as const;
export type GateId = (typeof GATE_IDS)[number];
export type GateStatus = "PASS" | "FAIL" | "SOFT" | "SKIPPED";
export type Phase = "0" | "1" | "2" | "4" | "release";
export const PHASES: readonly Phase[] = ["0", "1", "2", "4", "release"];

export interface Offender {
  id?: string;
  message: string;
}

export interface GateResult {
  gate: GateId;
  status: GateStatus;
  summary: string;
  offenders: Offender[];
}

export interface GateOptions {
  phase?: Phase;
  /** Gates to run (default: all). */
  gates?: readonly GateId[];
  /** Committed copy of `state.jsonl` for the append-only check (default: `git show HEAD:`). */
  baselineState?: string;
  /** Committed copy of `probes.jsonl` (default: `git show HEAD:`). */
  baselineProbes?: string;
  /** Build tag override (default: `current-build.json`). */
  build?: string;
  /** G10 runner (PII gate over the census files). */
  g10?: (phase: Phase) => GateResult;
}

export interface GateRun {
  phase: Phase;
  build: string;
  gates: GateResult[];
  built: BuildResult | null;
  reconcile: ReconcileReport | null;
}

const PHASE_ORDER: Record<Phase, number> = { "0": 0, "1": 1, "2": 2, "4": 4, release: 5 };

function atLeast(phase: Phase, min: Phase): boolean {
  return PHASE_ORDER[phase] >= PHASE_ORDER[min];
}

function result(
  gate: GateId,
  offenders: Offender[],
  passSummary: string,
  failStatus: GateStatus,
): GateResult {
  if (offenders.length === 0) return { gate, status: "PASS", summary: passSummary, offenders };
  return {
    gate,
    status: failStatus,
    summary: `${offenders.length} issue${offenders.length !== 1 ? "s" : ""}`,
    offenders,
  };
}

// ── Append-only baselines ─────────────────────────────────────────────────────

/** Committed bytes of a census file from `git show HEAD:<path>`, or null when untracked or no git. */
export function gitBaseline(paths: CensusPaths, file: string): Buffer | null {
  const rel = relative(paths.repo, file).split("\\").join("/");
  try {
    return execFileSync("git", ["-C", paths.repo, "show", `HEAD:${rel}`], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function appendOnly(
  name: string,
  file: string,
  baseline: Buffer | null,
  offenders: Offender[],
  notes: string[],
): void {
  if (baseline === null) {
    notes.push(`${name}: no committed copy to compare`);
    return;
  }
  const current = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  if (!isBytePrefix(baseline, current)) {
    offenders.push({
      message: `${name} is append-only: the committed content is not a prefix of the working file`,
    });
  }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

function g1(
  paths: CensusPaths,
  built: BuildResult | null,
  buildError: string | null,
  state: FoldedState,
  opts: GateOptions,
): GateResult {
  const offenders: Offender[] = [];
  const notes: string[] = [];
  if (buildError) offenders.push({ message: buildError });
  if (built) {
    for (const r of built.rejected) offenders.push({ message: `${r.file}:${r.line}: ${r.reason}` });
    for (const p of built.problems) offenders.push({ id: p.id, message: p.message });
    // Committed ledger equals a fresh build (no hand edits, no stale ledger).
    for (const s of SHARDS) {
      const file = paths.shards[s];
      const committed = existsSync(file) ? readFileSync(file, "utf-8") : null;
      if (committed === null && built.shardTexts[s] === "") continue;
      if (committed !== built.shardTexts[s]) {
        offenders.push({
          message: `${shardFileName(s)} is stale or hand-edited (run build.ts; build.ts --check shows it)`,
        });
      }
    }
    const meta = existsSync(paths.meta) ? readFileSync(paths.meta, "utf-8") : null;
    if (meta !== built.metaText)
      offenders.push({ message: "ledger.meta.json is stale or hand-edited (run build.ts)" });
    // Committed rows are schema-valid and ids unique across shards.
    const ids = new Set<string>();
    for (const s of SHARDS) {
      try {
        for (const l of readJsonl(paths.shards[s], shardFileName(s))) {
          const r = rowSchema.safeParse(l.value);
          if (!r.success) {
            offenders.push({
              message: `${shardFileName(s)} line ${l.line}: ${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}`,
            });
            continue;
          }
          if (ids.has(r.data.id))
            offenders.push({
              id: r.data.id,
              message: `${r.data.id}: id appears in two ledger lines`,
            });
          ids.add(r.data.id);
        }
      } catch (e) {
        offenders.push({ message: e instanceof Error ? e.message : String(e) });
      }
    }
    // Disposition references.
    const policy = loadPolicy(paths);
    const probes = foldProbes(paths);
    const byId = new Map(built.rows.map((r) => [r.id, r]));
    for (const row of built.rows) {
      const d = row.disposition;
      if (d) {
        if (DISPOSITIONS_WITH_REFERENCE.includes(d.kind) && !d.ref) {
          offenders.push({
            id: row.id,
            message: `${row.id}: disposition ${d.kind} needs a reference`,
          });
        }
        if (d.kind === "blocked" && d.ref && !probes.probes.has(d.ref)) {
          offenders.push({ id: row.id, message: `${row.id}: blocked:${d.ref} names no probe` });
        }
        if ((d.kind === "duplicate-of" || d.kind === "subsumed-by") && d.ref) {
          const target = byId.get(d.ref);
          if (d.ref === row.id || !target) {
            offenders.push({
              id: row.id,
              message: `${row.id}: ${d.kind}:${d.ref} does not name another row`,
            });
          } else if (
            target.disposition &&
            DISPOSITIONS_WITH_REFERENCE.includes(target.disposition.kind)
          ) {
            offenders.push({
              id: row.id,
              message: `${row.id}: ${d.kind}:${d.ref} chains through a dispositioned row`,
            });
          }
        }
        if (d.kind === "excluded-policy" && (!d.ref || !policyPathExists(policy, d.ref))) {
          offenders.push({
            id: row.id,
            message: `${row.id}: excluded-policy must cite an existing policy.json path`,
          });
        }
      }
      if (row.owner_signoff) {
        const ev = checkEvidence(paths, row.owner_signoff);
        if (!ev.ok || ev.record?.kind !== "owner-signoff") {
          offenders.push({
            id: row.id,
            message: `${row.id}: owner_signoff ${row.owner_signoff} is not an owner-signoff evidence record`,
          });
        }
      }
      for (const u of row.unverified) {
        if (u.cleared_by && !checkEvidence(paths, u.cleared_by).ok) {
          offenders.push({
            id: row.id,
            message: `${row.id}: unverified claim cleared by unresolvable ${u.cleared_by}`,
          });
        }
      }
    }
    for (const p of probes.problems) offenders.push({ id: p.id, message: p.message });
  }
  for (const p of state.problems) {
    if (!built) offenders.push({ id: p.id, message: p.message });
  }
  appendOnly(
    "state.jsonl",
    paths.state,
    opts.baselineState !== undefined
      ? readOrEmpty(opts.baselineState)
      : gitBaseline(paths, paths.state),
    offenders,
    notes,
  );
  appendOnly(
    "probes.jsonl",
    paths.probes,
    opts.baselineProbes !== undefined
      ? readOrEmpty(opts.baselineProbes)
      : gitBaseline(paths, paths.probes),
    offenders,
    notes,
  );
  if (existsSync(paths.liveResults)) {
    for (const f of readdirSync(paths.liveResults)
      .filter((x) => x.endsWith(".jsonl"))
      .sort(compareCodeUnits)) {
      const file = join(paths.liveResults, f);
      appendOnly(`live-results/${f}`, file, gitBaseline(paths, file), offenders, notes);
    }
  }
  const rows = built?.rows.length ?? 0;
  return result(
    "G1",
    offenders,
    `${rows} row${rows !== 1 ? "s" : ""} valid; ledger matches a fresh build`,
    "FAIL",
  );
}

function readOrEmpty(file: string): Buffer {
  return existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
}

function g2(rec: ReconcileReport | null): GateResult {
  if (!rec)
    return { gate: "G2", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const offenders: Offender[] = [];
  let evaluated = 0;
  for (const u of rec.universes) {
    if (u.count) {
      evaluated++;
      if (!u.count.ok) {
        offenders.push({
          message: `${u.id}: ${u.count.enumerator} counts ${u.count.observed}, expected ${u.count.expected} (${u.count.source})`,
        });
      }
    }
    for (const p of u.pairs) {
      evaluated++;
      for (const id of p.unexplained) {
        offenders.push({
          id,
          message: `${u.id}: ${id} differs between ${p.left} and ${p.right} without an explanation`,
        });
      }
    }
  }
  for (const [a, b] of rec.copiedFiles) {
    offenders.push({
      message: `${a} and ${b} carry identical reference sets under different enumerators`,
    });
  }
  if (evaluated === 0 && offenders.length === 0) {
    return {
      gate: "G2",
      status: "SKIPPED",
      summary: "no universe has two independent sources or a count gate yet",
      offenders,
    };
  }
  return result(
    "G2",
    offenders,
    `${evaluated} comparison${evaluated !== 1 ? "s" : ""} clean`,
    "FAIL",
  );
}

/** Required (container, state) pairs of the declared state matrix for one row. */
export function requiredStates(
  matrix: StateMatrix,
  row: Row,
  rows: readonly Row[],
): string[][] | null {
  const applies = matrix.applies.filter(
    (a) => a.kind === row.kind && (a.module === undefined || a.module === row.module),
  );
  if (applies.length === 0) return [];
  const out: string[][] = [];
  for (const a of applies) {
    let combos: string[][] = [[]];
    for (const axis of a.axes) {
      const def = matrix.axes[axis];
      let values: string[];
      if (def === undefined) return null;
      if (Array.isArray(def)) values = def;
      else {
        values = rows
          .filter((r) => r.kind === def.from_kind)
          .map((r) => r.id.slice(r.id.indexOf(".") + 1))
          .sort(compareCodeUnits);
        if (values.length === 0) return null;
      }
      combos = combos.flatMap((c) => values.map((v) => [...c, `${axis}=${v}`]));
    }
    out.push(...combos);
  }
  return out;
}

function g3(paths: CensusPaths, built: BuildResult | null, phase: Phase): GateResult {
  if (!built)
    return { gate: "G3", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const matrix = loadStateMatrix(paths);
  const offenders: Offender[] = [];
  let unresolvedAxes = 0;
  for (const row of built.rows) {
    if (row.status === "deferred" || row.disposition || row.aggregate) continue;
    if (row.children_enumerated === false) {
      offenders.push({ id: row.id, message: `${row.id}: children not enumerated (frontier)` });
    }
    const req = requiredStates(matrix, row, built.rows);
    if (req === null) {
      unresolvedAxes++;
      continue;
    }
    const have = new Set(
      row.observed_states.map((s) =>
        Object.keys(s)
          .sort(compareCodeUnits)
          .map((k) => `${k}=${(s as Record<string, string>)[k]}`)
          .join(";"),
      ),
    );
    for (const combo of req) {
      const k = [...combo].sort(compareCodeUnits).join(";");
      const covered = [...have].some((h) => combo.every((c) => h.split(";").includes(c)));
      if (!covered) offenders.push({ id: row.id, message: `${row.id}: state ${k} not enumerated` });
    }
  }
  const r = result("G3", offenders, "no open frontier", atLeast(phase, "4") ? "FAIL" : "SOFT");
  if (unresolvedAxes > 0)
    r.summary += `; ${unresolvedAxes} row(s) with a state axis that has no values yet`;
  return r;
}

function g4(paths: CensusPaths, built: BuildResult | null): GateResult {
  if (!built)
    return { gate: "G4", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const l01 = built.observations.filter((a) => a.enumerator === "L01");
  if (l01.length === 0)
    return { gate: "G4", status: "SKIPPED", summary: "no L01 observations yet", offenders: [] };
  const rules = loadG4Rules(paths);
  const offenders: Offender[] = [];
  for (const a of l01) {
    const by = a.obs.dismissed_by;
    if (!by) continue;
    const rule = rules.rules.find((r) => r.id === by);
    const label = a.obs.label ?? a.obs.object_name ?? "";
    if (!rule)
      offenders.push({
        id: a.id,
        message: `${a.file}:${a.line}: dismissed_by ${by} names no rule in g4-rules.json`,
      });
    else if (
      rule.controlType !== a.obs.control_type ||
      (rule.namePattern && !new RegExp(rule.namePattern).test(label))
    ) {
      offenders.push({
        id: a.id,
        message: `${a.file}:${a.line}: rule ${by} does not match this node`,
      });
    }
  }
  return result("G4", offenders, `${l01.length} L01 node(s) consistent with g4-rules.json`, "FAIL");
}

function g5(built: BuildResult | null): GateResult {
  if (!built)
    return { gate: "G5", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const e05 = built.rows.filter(
    (r) => r.dim === "ui" && r.sources.some((s) => s.enumerator === "E05"),
  );
  if (e05.length === 0)
    return { gate: "G5", status: "SKIPPED", summary: "no E05 UI labels yet", offenders: [] };
  const unlocated = e05.filter(
    (r) => !r.sources.some((s) => s.enumerator.startsWith("L")) && !r.disposition,
  );
  return {
    gate: "G5",
    status: "SOFT",
    summary: `${unlocated.length} of ${e05.length} executable UI label(s) unlocated (audited sample, not a hard gate)`,
    offenders: unlocated.map((r) => ({ id: r.id, message: `${r.id}: unlocated` })),
  };
}

function g6(
  paths: CensusPaths,
  built: BuildResult | null,
  state: FoldedState,
  phase: Phase,
): GateResult {
  if (!built)
    return { gate: "G6", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const offenders: Offender[] = [];
  const probes = foldProbes(paths);
  const e01Rows = built.rows.filter((r) => r.sources.some((s) => s.enumerator === "E01"));
  for (const r of e01Rows) {
    const merged = r.sources.some((s) => s.enumerator !== "E01");
    if (!merged && !state.overlays.get(r.id)?.recon_resolution && !r.disposition) {
      offenders.push({ id: r.id, message: `${r.id}: recon row neither merged nor explained` });
    }
  }
  for (const p of probes.probes.values()) {
    if (atLeast(phase, "1") && (!p.status || !p.scheduled_session)) {
      offenders.push({
        id: p.id,
        message: `${p.id}: probe needs a status and a scheduled session`,
      });
    }
    if (atLeast(phase, "2") && p.architecture_deciding && !p.outcome) {
      offenders.push({ id: p.id, message: `${p.id}: architecture-deciding probe has no outcome` });
    }
    if (atLeast(phase, "4") && !p.outcome && !p.deferral_accepted_by_owner) {
      offenders.push({
        id: p.id,
        message: `${p.id}: probe has neither an outcome nor an owner-accepted deferral`,
      });
    }
  }
  const summary = `${e01Rows.length} recon row(s), ${probes.probes.size} probe(s) carried over`;
  return result("G6", offenders, summary, atLeast(phase, "1") ? "FAIL" : "SOFT");
}

function g7(paths: CensusPaths, built: BuildResult | null, phase: Phase): GateResult {
  if (!built)
    return { gate: "G7", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const universes = loadUniverses(paths);
  const filled = new Set(built.rows.map((r) => `${r.module}\u0000${r.kind}`));
  const offenders: Offender[] = [];
  for (const m of MODULES) {
    for (const k of KINDS) {
      if (filled.has(`${m}\u0000${k}`)) continue;
      const reason = universes.g7_empty_reasons.some(
        (e) => (e.module === m || e.module === "*") && (e.kind === k || e.kind === "*"),
      );
      if (!reason) offenders.push({ message: `${m} x ${k}: empty without a written reason` });
    }
  }
  const r = result(
    "G7",
    offenders,
    "every module-by-kind cell is filled or explained",
    atLeast(phase, "4") ? "FAIL" : "SOFT",
  );
  if (offenders.length > 0)
    r.summary = `${offenders.length} of ${MODULES.length * KINDS.length} module-by-kind cells empty without a reason`;
  return r;
}

function g8(built: BuildResult | null, phase: Phase): GateResult {
  if (!built)
    return { gate: "G8", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const actions = new Set(built.rows.filter((r) => r.kind === "mcp-action").map((r) => r.id));
  const linked = new Set<string>();
  const hard: Offender[] = [];
  for (const r of built.rows) {
    for (const m of r.mcp) {
      if (!actions.has(m.action))
        hard.push({
          id: r.id,
          message: `${r.id}: mcp link ${m.action} resolves to no tool action`,
        });
      else linked.add(m.action);
    }
  }
  const soft: Offender[] = [...actions]
    .filter((a) => !linked.has(a))
    .sort(compareCodeUnits)
    .map((a) => ({ id: a, message: `${a}: tool action links to no row` }));
  if (hard.length > 0)
    return {
      gate: "G8",
      status: "FAIL",
      summary: `${hard.length} dangling link(s)`,
      offenders: [...hard, ...soft],
    };
  return result(
    "G8",
    soft,
    `${linked.size} tool action(s) linked`,
    atLeast(phase, "4") ? "FAIL" : "SOFT",
  );
}

function g9(paths: CensusPaths, built: BuildResult | null, phase: Phase): GateResult {
  if (!built)
    return { gate: "G9", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const policy = loadPolicy(paths);
  const probes = foldProbes(paths);
  const offenders: Offender[] = [];
  for (const r of built.rows) {
    if (r.aggregate) continue;
    if (r.disposition?.kind === "blocked" && r.disposition.ref) {
      const p = probes.probes.get(r.disposition.ref);
      if (p?.outcome && p.status !== "blocked") {
        offenders.push({
          id: r.id,
          message: `${r.id}: blocked:${p.id} but the probe has an outcome; re-open the row`,
        });
      }
    }
    const needsDisposition = r.risk !== undefined && riskOverride(policy, r.risk) !== undefined;
    if (needsDisposition && !r.disposition) {
      offenders.push({
        id: r.id,
        message: `${r.id}: risk ${r.risk} needs a disposition (policy risk_overrides)`,
      });
      continue;
    }
    const below = TIERS.indexOf(r.tier) < TIERS.indexOf(r.target_tier);
    if (r.status === "active" && below && !r.disposition && !r.work_item) {
      offenders.push({
        id: r.id,
        message: `${r.id}: ${r.tier} below target ${r.target_tier} with no work item or disposition`,
      });
    }
  }
  return result("G9", offenders, "no orphan below target", atLeast(phase, "4") ? "FAIL" : "SOFT");
}

// ── Runner ────────────────────────────────────────────────────────────────────

/** Runs the requested gates. Never throws for data problems; they become offenders. */
export function runGates(paths: CensusPaths, opts: GateOptions = {}): GateRun {
  const phase = opts.phase ?? "0";
  const wanted = new Set(opts.gates ?? GATE_IDS);
  let built: BuildResult | null = null;
  let buildError: string | null = null;
  try {
    built = buildLedger(paths, { build: opts.build });
  } catch (e) {
    if (!(e instanceof CensusDataError)) throw e;
    buildError = e.message;
  }
  const state = foldState(paths);
  let rec: ReconcileReport | null = null;
  if (built) rec = reconcile(loadUniverses(paths), built, state.overlays);
  const gates: GateResult[] = [];
  for (const g of GATE_IDS) {
    if (!wanted.has(g)) continue;
    switch (g) {
      case "G1":
        gates.push(g1(paths, built, buildError, state, opts));
        break;
      case "G2":
        gates.push(g2(rec));
        break;
      case "G3":
        gates.push(g3(paths, built, phase));
        break;
      case "G4":
        gates.push(g4(paths, built));
        break;
      case "G5":
        gates.push(g5(built));
        break;
      case "G6":
        gates.push(g6(paths, built, state, phase));
        break;
      case "G7":
        gates.push(g7(paths, built, phase));
        break;
      case "G8":
        gates.push(g8(built, phase));
        break;
      case "G9":
        gates.push(g9(paths, built, phase));
        break;
      case "G10":
        gates.push(
          opts.g10
            ? opts.g10(phase)
            : { gate: "G10", status: "SKIPPED", summary: "no PII scanner supplied", offenders: [] },
        );
        break;
    }
  }
  return {
    phase,
    build: built?.build.tag ?? opts.build ?? "unknown",
    gates,
    built,
    reconcile: rec,
  };
}

/** One line per gate: `G1 PASS  <summary>`. */
export function gateLines(run: GateRun): string[] {
  return run.gates.map((g) => `${g.gate.padEnd(3)} ${g.status.padEnd(7)} ${g.summary}`);
}
