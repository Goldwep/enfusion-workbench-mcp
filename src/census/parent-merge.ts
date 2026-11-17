/**
 * Parent merge (DEC-054, main ruling 2026-10-12). Several enumerators may
 * claim a row's parent; this decides one and says which claims lose.
 *
 * 1. A live enumerator (L01..L17) outranks a static one: the live parent wins
 *    and the static claim is kept as "static parent: <id> (<enumerator>)".
 *    Between two live enumerators the deeper parent wins; the other is kept as
 *    "live parent: <id> (<enumerator>)". Equal depth stays a conflict.
 * 2. A null parent from a static source means unknown, never a root claim.
 *    A row is a root only when every source says root or its kind is
 *    `module` or `window`.
 * 3. A static `.../module/<M>` parent is satisfied by any ancestor chain of
 *    the chosen parent that reaches that module row: no note, no conflict.
 */

export interface ParentClaim {
  enumerator: string;
  /** undefined: the source does not say; null: a root claim. */
  parentId?: string | null;
}

export interface ParentDecision {
  parent: string | null | undefined;
  /** Losing claims, recorded in the row's `unverified[]`. */
  notes: string[];
  /** Set when the claims conflict and no rule settles them. */
  conflict?: string[];
}

export const isLiveEnumerator = (e: string): boolean => /^L\d{2}$/.test(e);

const isModuleId = (id: string): boolean => /\/module\/[^/]+$/.test(id);

/** The chain parent, grandparent, ... of `id` under `parentOf` (cycle-safe). */
export function ancestors(
  id: string,
  parentOf: (id: string) => string | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf(id);
  while (typeof cur === "string" && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf(cur);
  }
  return out;
}

export function mergeParent(
  claims: ParentClaim[],
  kind: string,
  parentOf: (id: string) => string | null | undefined,
): ParentDecision {
  const live = claims.filter((c) => isLiveEnumerator(c.enumerator) && c.parentId !== undefined);
  // Rule 2: a static null is "unknown".
  const stat = claims.filter(
    (c) => !isLiveEnumerator(c.enumerator) && typeof c.parentId === "string",
  );
  const notes: string[] = [];

  const liveIds = [...new Set(live.map((c) => c.parentId))];
  const liveStrings = liveIds.filter((p): p is string => typeof p === "string");
  let chosen: string | null | undefined;
  if (liveStrings.length > 0) {
    // Rule 1, live vs live: the deepest wins (a descendant beats its ancestor).
    const depth = (p: string): number => ancestors(p, parentOf).length;
    const ranked = liveStrings.slice().sort((a, b) => depth(b) - depth(a));
    if (ranked.length > 1 && depth(ranked[0]) === depth(ranked[1]))
      return { parent: ranked[0], notes, conflict: ranked };
    chosen = ranked[0];
    for (const c of live)
      if (c.parentId !== chosen)
        notes.push(`live parent: ${c.parentId === null ? "root" : c.parentId} (${c.enumerator})`);
  } else if (liveIds.length > 0) {
    chosen = null; // every live source that speaks says root
  }

  if (chosen === undefined) {
    // No live claim: static strings decide; several different ones conflict
    // unless one is satisfied by another's chain (rule 3).
    const ids = [...new Set(stat.map((c) => c.parentId as string))];
    if (ids.length === 0) {
      const anyRoot = claims.some((c) => c.parentId === null);
      return {
        parent: anyRoot || kind === "module" || kind === "window" ? null : undefined,
        notes,
      };
    }
    const deepest = ids
      .slice()
      .sort((a, b) => ancestors(b, parentOf).length - ancestors(a, parentOf).length)[0];
    const chain = new Set([deepest, ...ancestors(deepest, parentOf)]);
    const unsatisfied = ids.filter((p) => !(chain.has(p) && (p === deepest || isModuleId(p))));
    if (unsatisfied.length > 0) return { parent: ids[0], notes, conflict: ids };
    return { parent: deepest, notes };
  }

  if (chosen === null && kind !== "module" && kind !== "window" && stat.length > 0) {
    // Live says root, a static source names a parent: live wins (rule 1).
    for (const c of stat) notes.push(`static parent: ${c.parentId} (${c.enumerator})`);
    return { parent: null, notes };
  }
  const chain =
    typeof chosen === "string"
      ? new Set([chosen, ...ancestors(chosen, parentOf)])
      : new Set<string>();
  for (const c of stat) {
    const p = c.parentId as string;
    if (p === chosen) continue;
    if (isModuleId(p) && chain.has(p)) continue; // rule 3
    notes.push(`static parent: ${p} (${c.enumerator})`);
  }
  return { parent: chosen, notes: [...new Set(notes)].sort() };
}
