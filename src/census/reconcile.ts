/**
 * Universe reconciliation (plan 4.6, gate G2). A universe is `closed` when
 * two independent enumerators agree or every difference is explained per
 * row; with one source it is `single-source`. Independence is computed from
 * `universes.json`: different `independence_group`, neither enumerator lists
 * the other among its `inputs`, and they share no input. Provisional
 * enumerators (E01) never take part in closure.
 *
 * Also evaluates the count gates (`expected` on a universe), exact unless
 * the plan states a lower bound (`at_least`) or a dispute (`candidates`).
 */
import { compareCodeUnits } from "./canon.js";
import type { EnumeratorDef, Universe, UniversesFile } from "./census-config.js";
import type { BuildResult } from "./build-ledger.js";
import type { StateOverlay } from "./state.js";

export type UniverseStatus = "closed" | "open" | "single-source" | "pending";

export interface PairDiff {
  left: string;
  right: string;
  onlyLeft: string[];
  onlyRight: string[];
  unexplained: string[];
}

export interface UniverseReport {
  id: string;
  kind: string;
  status: UniverseStatus;
  /** Enumerators with observations of this universe on the current build. */
  sources: Record<string, number>;
  pairs: PairDiff[];
  /**
   * Rows of a universe with at least one independent pair of sources that
   * only one independent source saw and nothing explains (DEC-022). A row
   * seen by any two independent sources is corroborated, whatever a third
   * source lacks.
   */
  uncorroborated: { id: string; seenBy: string[] }[];
  /** Declared enumerators that have no observation of this universe yet. */
  awaits: string[];
  count?: { enumerator: string; observed: number; expected: string; ok: boolean; source: string };
}

export interface ReconcileReport {
  universes: UniverseReport[];
  /** Pairs of observation files of different enumerators with identical ref sets. */
  copiedFiles: [string, string][];
}

/** Whether two enumerators count as independent sources (plan 4.6). */
export function independent(a: string, da: EnumeratorDef, b: string, db: EnumeratorDef): boolean {
  if (a === b) return false;
  if (da.provisional || db.provisional) return false;
  if (da.independence_group === db.independence_group) return false;
  if (da.inputs.includes(b) || db.inputs.includes(a)) return false;
  return !da.inputs.some((i) => db.inputs.includes(i));
}

function inUniverse(u: Universe, row: { kind: string; id: string; aggregate: boolean }): boolean {
  return (
    row.kind === u.kind &&
    !row.aggregate &&
    (u.id_prefix === undefined || row.id.startsWith(u.id_prefix))
  );
}

function expectedText(e: NonNullable<Universe["expected"]>): string {
  if (e.value !== undefined) return `${e.value}`;
  if (e.candidates !== undefined) return `one of ${e.candidates.join(", ")}`;
  return `at least ${e.at_least}`;
}

function expectedOk(e: NonNullable<Universe["expected"]>, n: number): boolean {
  if (e.value !== undefined) return n === e.value;
  if (e.candidates !== undefined) return e.candidates.includes(n);
  return n >= (e.at_least ?? 0);
}

/** Reconciles every universe against the built ledger. */
export function reconcile(
  universes: UniversesFile,
  built: BuildResult,
  overlays: ReadonlyMap<string, StateOverlay>,
): ReconcileReport {
  const tag = built.build.tag;
  const rowsById = new Map(built.rows.map((r) => [r.id, r]));

  // enumerator -> set of row ids it observed on the current build (or carried to it).
  const carried = new Set(built.carried ?? []);
  const seenBy = new Map<string, Set<string>>();
  for (const a of built.observations) {
    if (a.build !== tag && !carried.has(`${a.enumerator}@${a.build}`)) continue;
    const set = seenBy.get(a.enumerator) ?? new Set<string>();
    set.add(a.id);
    seenBy.set(a.enumerator, set);
  }

  const out: UniverseReport[] = [];
  for (const u of universes.universes) {
    const members = (e: string): Set<string> => {
      const s = new Set<string>();
      for (const id of seenBy.get(e) ?? []) {
        const r = rowsById.get(id);
        if (r && inUniverse(u, r)) s.add(id);
      }
      return s;
    };
    const sources: Record<string, number> = {};
    const sets = new Map<string, Set<string>>();
    for (const e of [...u.enumerators].sort(compareCodeUnits)) {
      const s = members(e);
      if (s.size > 0) {
        sources[e] = s.size;
        sets.set(e, s);
      }
    }
    // Provisional enumerators (the recon import) never take part in closure:
    // a row only they saw is gate G6's business, not this one's.
    const names = [...sets.keys()].filter((e) => !universes.enumerators[e]?.provisional);
    // Declared enumerators with no observation of this universe yet.
    const awaits = [...u.enumerators].filter((e) => !sets.has(e)).sort(compareCodeUnits);
    const indep = (a: string, b: string): boolean => {
      const da = universes.enumerators[a];
      const db = universes.enumerators[b];
      return da !== undefined && db !== undefined && independent(a, da, b, db);
    };
    const anyIndependentPair = names.some((a, i) => names.slice(i + 1).some((b) => indep(a, b)));

    // Per row: corroborated when two independent sources saw it; otherwise it
    // needs a disposition or an explanation recorded for this universe.
    const uncorroborated: { id: string; seenBy: string[] }[] = [];
    const open = new Set<string>();
    if (anyIndependentPair) {
      const union = new Set<string>();
      for (const n of names) for (const id of sets.get(n) as Set<string>) union.add(id);
      for (const id of [...union].sort(compareCodeUnits)) {
        const seenBy = names.filter((n) => (sets.get(n) as Set<string>).has(id));
        if (seenBy.some((a, i) => seenBy.slice(i + 1).some((b) => indep(a, b)))) continue;
        if (rowsById.get(id)?.disposition) continue;
        const explained = (overlays.get(id)?.reconcile_explained ?? []).some(
          (x) => x.universe === u.id && !seenBy.includes(x.enumerator),
        );
        if (explained) continue;
        uncorroborated.push({ id, seenBy });
        open.add(id);
      }
    }

    const pairs: PairDiff[] = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i];
        const b = names[j];
        if (!indep(a, b)) continue;
        const sa = sets.get(a) as Set<string>;
        const sb = sets.get(b) as Set<string>;
        const onlyLeft = [...sa].filter((x) => !sb.has(x)).sort(compareCodeUnits);
        const onlyRight = [...sb].filter((x) => !sa.has(x)).sort(compareCodeUnits);
        const unexplained = [...onlyLeft, ...onlyRight]
          .filter((id) => open.has(id))
          .sort(compareCodeUnits);
        pairs.push({ left: a, right: b, onlyLeft, onlyRight, unexplained });
      }
    }
    let status: UniverseStatus;
    if (sets.size === 0) status = "pending";
    else if (!anyIndependentPair) status = "single-source";
    else status = uncorroborated.length === 0 ? "closed" : "open";

    const report: UniverseReport = {
      id: u.id,
      kind: u.kind,
      status,
      sources,
      pairs,
      uncorroborated,
      awaits,
    };
    if (u.expected && sets.has(u.expected.enumerator)) {
      const observed = sets.get(u.expected.enumerator)?.size ?? 0;
      report.count = {
        enumerator: u.expected.enumerator,
        observed,
        expected: expectedText(u.expected),
        ok: expectedOk(u.expected, observed),
        source: u.expected.source,
      };
    }
    out.push(report);
  }

  // Copied observation files: identical ref sets under two enumerators.
  const refSets = new Map<string, { enumerator: string; refs: string }>();
  const byFile = new Map<string, string[]>();
  for (const a of built.observations) {
    const list = byFile.get(a.file) ?? [];
    list.push(a.obs.ref);
    byFile.set(a.file, list);
  }
  const copied: [string, string][] = [];
  for (const file of [...byFile.keys()].sort(compareCodeUnits)) {
    const refs = [...new Set(byFile.get(file))].sort(compareCodeUnits).join("\n");
    const enumerator = file.split("/")[1];
    for (const [other, v] of refSets) {
      if (v.enumerator !== enumerator && v.refs === refs) copied.push([other, file]);
    }
    refSets.set(file, { enumerator, refs });
  }
  return { universes: out, copiedFiles: copied };
}
