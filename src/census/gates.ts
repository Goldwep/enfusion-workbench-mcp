/**
 * Gates G1-G9 (plan 4.6), computed mechanically from the files under the
 * census root. `validate.ts` prints them; `report.ts` puts them at the top
 * of `COVERAGE.md`. G10 (the PII gate over the census files) was removed by
 * DEC-060; the other gates keep their numbers.
 *
 * Phases (`--phase`): several gates describe exit conditions of later phases
 * (frontier, module-by-kind matrix, orphans, unlinked tool actions). Before
 * the phase whose exit they guard they report SOFT, with the same offender
 * list, instead of FAIL.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { compareCodeUnits, lfBytes, toLf } from "./canon.js";
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

export const GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"] as const;
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
  // A CRLF checkout of the same lines is no edit: compare with line endings normalised.
  const current = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  if (!isBytePrefix(lfBytes(baseline), lfBytes(current))) {
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
    // Line endings are the checkout's, not content: CRLF compares as LF.
    for (const s of SHARDS) {
      const file = paths.shards[s];
      const committed = existsSync(file) ? toLf(readFileSync(file, "utf-8")) : null;
      if (committed === null && built.shardTexts[s] === "") continue;
      if (committed !== built.shardTexts[s]) {
        offenders.push({
          message: `${shardFileName(s)} is stale or hand-edited (run build.ts; build.ts --check shows it)`,
        });
      }
    }
    const meta = existsSync(paths.meta) ? toLf(readFileSync(paths.meta, "utf-8")) : null;
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

function g2(rec: ReconcileReport | null, built: BuildResult | null, phase: Phase): GateResult {
  if (!rec)
    return { gate: "G2", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  // Hard: count gates, copied files, and uncorroborated rows of universes
  // that can close with what has run. Open: rows of a universe that still
  // awaits a live enumerator; before Phase 4 they are reported, not failed
  // (plan 8, Phase 1 exit: "G2 (for static-only universes)"; DEC-024).
  const hard: Offender[] = [];
  const open: Offender[] = [];
  // A row that carries a work item names where its second source comes from
  // (a wave, a deferred enumerator, the residue wave): reported, not failed
  // (DEC-056 rulings 4 and 8).
  const workItems = new Map(
    (built?.rows ?? []).filter((r) => r.work_item).map((r) => [r.id, r.work_item as string]),
  );
  let evaluated = 0;
  for (const u of rec.universes) {
    if (u.count) {
      evaluated++;
      if (!u.count.ok) {
        hard.push({
          message: `${u.id}: ${u.count.enumerator} counts ${u.count.observed}, expected ${u.count.expected} (${u.count.source})`,
        });
      }
    }
    evaluated += u.pairs.length;
    const live = u.awaits.filter((e) => e.startsWith("L"));
    const waiting = !atLeast(phase, "4") && live.length > 0;
    // One offender per row, not per pair: a row needs a second independent
    // source or an explanation (DEC-022).
    for (const r of u.uncorroborated) {
      const base = `${u.id}: ${r.id} is seen only by ${r.seenBy.join(", ")} (no independent second source)`;
      const wi = workItems.get(r.id);
      if (waiting) {
        open.push({ id: r.id, message: `${base}; the universe awaits ${live.join(", ")}` });
      } else if (wi) {
        open.push({ id: r.id, message: `${base}; carries work item ${wi}` });
      } else {
        hard.push({ id: r.id, message: `${base} and has no explanation` });
      }
    }
  }
  for (const [a, b] of rec.copiedFiles) {
    hard.push({
      message: `${a} and ${b} carry identical reference sets under different enumerators`,
    });
  }
  if (evaluated === 0 && hard.length === 0 && open.length === 0) {
    return {
      gate: "G2",
      status: "SKIPPED",
      summary: "no universe has two independent sources or a count gate yet",
      offenders: [],
    };
  }
  if (hard.length > 0) {
    return {
      gate: "G2",
      status: "FAIL",
      summary: `${hard.length} issue${hard.length !== 1 ? "s" : ""}${open.length > 0 ? `; ${open.length} more await live enumerators` : ""}`,
      offenders: [...hard, ...open],
    };
  }
  if (open.length > 0) {
    return {
      gate: "G2",
      status: "SOFT",
      summary: `static universes clean; ${open.length} row(s) await live enumerators or a work item`,
      offenders: open,
    };
  }
  return {
    gate: "G2",
    status: "PASS",
    summary: `${evaluated} comparison${evaluated !== 1 ? "s" : ""} clean`,
    offenders: [],
  };
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
    // `except` names rows the entry does not reach; an `enumerate_only`
    // entry is for the walkers, not the gate (DEC-056 ruling 11).
    if (a.enumerate_only || a.except?.includes(row.id)) continue;
    let combos: string[][] = [[]];
    for (const axis of a.axes) {
      const def = matrix.axes[axis];
      let values: string[];
      if (def === undefined) return null;
      // `values` narrows an axis to the subset the containers take.
      if (a.values?.[axis]) values = a.values[axis];
      else if (Array.isArray(def)) values = def;
      else {
        // Measured rows only: a provisional (E01) file type is not a
        // resource type a walker can open (DEC-056 ruling 11).
        values = rows
          .filter((r) => r.kind === def.from_kind && !r.provisional)
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

/**
 * Kinds whose every live enumerator has no observation file at this build (an
 * enumerator deferred past Phase 4, DEC-056 ruling 8), each with the
 * enumerators it waits for. G3 and G6 report such rows as open, not failed.
 */
function unrunLiveKinds(paths: CensusPaths, built: BuildResult): Map<string, string[]> {
  const universes = loadUniverses(paths);
  const ran = new Set(built.observationFiles.map((f) => f.enumerator));
  const out = new Map<string, string[]>();
  for (const u of universes.universes) {
    if (u.id !== `kind:${u.kind}`) continue;
    const live = u.enumerators.filter((e) => e.startsWith("L"));
    if (live.length > 0 && live.every((e) => !ran.has(e))) out.set(u.kind, live);
  }
  return out;
}

/**
 * The live enumerator that reads a row's states, for the kinds where a
 * reconcile explanation can settle every state (DEC-091 ruling 1). A diag
 * option is read per mode by L15 only; one that L15 cannot address at all
 * (explained `out-of-scope` for L15 in its own universe) has no per-mode read
 * to wait for. Diag menus are not here: L15 can address them once a menu
 * reader exists.
 */
export const STATE_READER_BY_KIND: Readonly<Record<string, string>> = { "diag-option": "L15" };

/** Whether a row's states are settled by an out-of-scope explanation for its state reader (DEC-091). */
export function statesSettledByExplanation(row: Row, state: FoldedState | null): boolean {
  const reader = STATE_READER_BY_KIND[row.kind];
  if (reader === undefined || state === null) return false;
  return (state.overlays.get(row.id)?.reconcile_explained ?? []).some(
    (x) =>
      x.kind === "out-of-scope" && x.enumerator === reader && x.universe === `kind:${row.kind}`,
  );
}

function g3(
  paths: CensusPaths,
  built: BuildResult | null,
  phase: Phase,
  state: FoldedState | null = null,
): GateResult {
  if (!built)
    return { gate: "G3", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const matrix = loadStateMatrix(paths);
  const awaitsUnrun = unrunLiveKinds(paths, built);
  const offenders: Offender[] = [];
  const open: Offender[] = [];
  let unresolvedAxes = 0;
  for (const row of built.rows) {
    if (row.status === "deferred" || row.disposition || row.aggregate) continue;
    // A provisional (E01-only) row's exit is its G6 resolution, never a
    // frontier or a state pair (DEC-056 ruling 3). A row that carries a work
    // item names the wave that enumerates its frontier and states (ruling 1).
    if (row.provisional || row.work_item) continue;
    // The frontier and states of a row are the live walker's to read: while
    // that walker has not run, the asks stay open (ruling 8).
    const unrun = awaitsUnrun.get(row.kind);
    const sink = unrun ? open : offenders;
    const tail = unrun ? `; awaits ${unrun.join(", ")}, which has not run` : "";
    if (row.children_enumerated === false) {
      sink.push({ id: row.id, message: `${row.id}: children not enumerated (frontier)${tail}` });
    }
    // An option its state reader cannot address at all is settled for every
    // state by that explanation (DEC-091 ruling 1).
    if (statesSettledByExplanation(row, state)) continue;
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
      if (!covered)
        sink.push({ id: row.id, message: `${row.id}: state ${k} not enumerated${tail}` });
    }
  }
  if (offenders.length === 0 && open.length > 0) {
    const r: GateResult = {
      gate: "G3",
      status: "SOFT",
      summary: `no open frontier a run enumerator should have closed; ${open.length} ask(s) await live enumerators that have not run`,
      offenders: open,
    };
    if (unresolvedAxes > 0)
      r.summary += `; ${unresolvedAxes} row(s) with a state axis that has no values yet`;
    return r;
  }
  const r = result(
    "G3",
    [...offenders, ...open],
    "no open frontier",
    atLeast(phase, "4") ? "FAIL" : "SOFT",
  );
  if (offenders.length > 0)
    r.summary = `${offenders.length} issue${offenders.length !== 1 ? "s" : ""}${open.length > 0 ? `; ${open.length} more await live enumerators that have not run` : ""}`;
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
  // A recon row of a kind whose universe still awaits a live enumerator cannot
  // be merged before that enumerator runs: before Phase 4 it is reported as
  // open, not failed (DEC-024). Rows of kinds that close offline must be
  // merged or explained from Phase 1 on.
  const universes = loadUniverses(paths);
  const awaitsLive = new Set(
    universes.universes
      .filter((u) => u.id === `kind:${u.kind}` && u.enumerators.some((e) => e.startsWith("L")))
      .map((u) => u.kind),
  );
  // Recon rows of a kind whose live enumerator has not run stay open at
  // phase 4, reported with the enumerators they wait for (DEC-056 ruling 8).
  const awaitsUnrun = unrunLiveKinds(paths, built);
  const open: Offender[] = [];
  for (const r of e01Rows) {
    const merged = r.sources.some((s) => s.enumerator !== "E01");
    if (!merged && !state.overlays.get(r.id)?.recon_resolution && !r.disposition) {
      const unrun = awaitsUnrun.get(r.kind);
      if (!atLeast(phase, "4") && awaitsLive.has(r.kind)) {
        open.push({
          id: r.id,
          message: `${r.id}: recon row not merged yet; its kind awaits a live enumerator`,
        });
      } else if (unrun) {
        open.push({
          id: r.id,
          message: `${r.id}: recon row not merged yet; its kind awaits ${unrun.join(", ")}, which has not run`,
        });
      } else if (r.work_item) {
        // The work item names the wave or sitting that reads its container
        // (DEC-056: the resolver's live-kind rules are not built).
        open.push({
          id: r.id,
          message: `${r.id}: recon row not merged yet; carries work item ${r.work_item}`,
        });
      } else {
        offenders.push({ id: r.id, message: `${r.id}: recon row neither merged nor explained` });
      }
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
    // A deferred outcome is a deferral: it passes only once the owner has
    // accepted it (plan 4.6; DEC-056 ruling 2).
    if (atLeast(phase, "4") && p.status === "deferred" && !p.deferral_accepted_by_owner) {
      offenders.push({
        id: p.id,
        message: `${p.id}: deferred outcome without an owner-accepted deferral`,
      });
    }
  }
  const summary = `${e01Rows.length} recon row(s), ${probes.probes.size} probe(s) carried over`;
  if (offenders.length === 0 && open.length > 0) {
    return {
      gate: "G6",
      status: "SOFT",
      summary: `${summary}; ${open.length} recon row(s) await live enumerators`,
      offenders: open,
    };
  }
  const r = result("G6", [...offenders, ...open], summary, atLeast(phase, "1") ? "FAIL" : "SOFT");
  if (offenders.length > 0)
    r.summary = `${offenders.length} issue${offenders.length !== 1 ? "s" : ""}${open.length > 0 ? `; ${open.length} more await live enumerators` : ""}`;
  return r;
}

function g7(paths: CensusPaths, built: BuildResult | null, phase: Phase): GateResult {
  if (!built)
    return { gate: "G7", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const universes = loadUniverses(paths);
  const filled = new Set(built.rows.map((r) => `${r.module}\u0000${r.kind}`));
  // An empty cell is explained (a written reason), open (it should hold rows:
  // a named enumerator or coverage wave will fill it) or neither. Neither is
  // a failure from Phase 1 on. An open cell is reported, not failed, until the
  // phase by which its fillers have run: the Phase 4 exit for enumerators,
  // release for coverage waves (DEC-025).
  const openCells = new Map(universes.g7_open_cells.map((e) => [`${e.module}\u0000${e.kind}`, e]));
  const offenders: Offender[] = [];
  const open: Offender[] = [];
  for (const m of MODULES) {
    for (const k of KINDS) {
      if (filled.has(`${m}\u0000${k}`)) continue;
      const reason = universes.g7_empty_reasons.some(
        (e) => (e.module === m || e.module === "*") && (e.kind === k || e.kind === "*"),
      );
      if (reason) continue;
      const waits = openCells.get(`${m}\u0000${k}`);
      if (!waits) {
        offenders.push({ message: `${m} x ${k}: empty without a written reason` });
        continue;
      }
      const due: Phase = waits.awaits.some((a) => a.startsWith("W")) ? "release" : "4";
      const o = { message: `${m} x ${k}: empty, awaits ${waits.awaits.join(", ")}` };
      if (atLeast(phase, due)) offenders.push(o);
      else open.push(o);
    }
  }
  const total = MODULES.length * KINDS.length;
  if (offenders.length === 0) {
    if (open.length === 0)
      return result("G7", [], "every module-by-kind cell is filled or explained", "FAIL");
    return {
      gate: "G7",
      status: "SOFT",
      summary: `every empty cell is explained or names what will fill it; ${open.length} of ${total} cells await enumerators or waves`,
      offenders: open,
    };
  }
  return {
    gate: "G7",
    status: atLeast(phase, "1") ? "FAIL" : "SOFT",
    summary: `${offenders.length} of ${total} module-by-kind cells empty with no reason, or still empty past the phase that should have filled them${open.length > 0 ? `; ${open.length} more await enumerators or waves` : ""}`,
    offenders: [...offenders, ...open],
  };
}

function g8(paths: CensusPaths, built: BuildResult | null, phase: Phase): GateResult {
  if (!built)
    return { gate: "G8", status: "SKIPPED", summary: "ledger could not be built", offenders: [] };
  const actions = new Set(built.rows.filter((r) => r.kind === "mcp-action").map((r) => r.id));
  // An action that touches no census surface is listed in policy
  // `mcp_link_exempt` with a reason (DEC-056 ruling 12, R6); it needs no row.
  const exempt = new Map(
    (loadPolicy(paths).mcp_link_exempt ?? []).map((e) => [e.action, e.reason] as const),
  );
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
    .filter((a) => !linked.has(a) && !exempt.has(a))
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
    `${linked.size} tool action(s) linked${exempt.size > 0 ? `, ${exempt.size} exempt` : ""}`,
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
    // A provisional (E01-only) row cannot climb by design; G6 owns its exit
    // (DEC-056 ruling 3).
    if (r.provisional) continue;
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
        gates.push(g2(rec, built, phase));
        break;
      case "G3":
        gates.push(g3(paths, built, phase, state));
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
        gates.push(g8(paths, built, phase));
        break;
      case "G9":
        gates.push(g9(paths, built, phase));
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
