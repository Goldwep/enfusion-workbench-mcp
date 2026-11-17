/**
 * Node-level diff of two `.bt` trees: nodes added, removed, moved and changed,
 * variables added, removed and changed, and the tree's own header.
 *
 * A `.bt` node has no id, so nodes are matched, in this order:
 *   1. class and name, where that pair is unique in both trees;
 *   2. under parents already matched, children of the same class and name in
 *      child order (repeated until nothing more matches);
 *   3. the same path and the same class (a renamed node stays in place);
 *   4. what is left of the same class and name, in tree order.
 * A node no pass matches is removed (first tree) or added (second tree); a
 * class change is a removal plus an addition.
 *
 * A matched node has moved when its parent is not the match of its old parent,
 * or when its order among the matched children of the same parent changed (the
 * children outside the longest kept order are the moved ones, so an insertion
 * does not mark its siblings as moved). Its params are the display name, the
 * own properties, the port wiring (by variable name) and the TEST classes;
 * canvas positions (`EditorPos`) and groups are not compared.
 */

import type { BtDocument } from "./model.js";
import { allNodes, portVariable, viewBt, type BtNodeView, type BtView } from "./tree.js";

export interface BtParamChange {
  key: string;
  /** null when the first tree does not have it. */
  before: string | null;
  /** null when the second tree does not have it. */
  after: string | null;
}

export interface BtNodeChange {
  what: "node";
  change: "added" | "removed" | "moved" | "changed";
  type: string;
  name: string;
  /** Path in the first tree ("root" for the RootNode); absent for an added node. */
  from?: string;
  /** Path in the second tree; absent for a removed node. */
  to?: string;
  /** Param changes of a matched node (a moved node may carry some too). */
  params?: BtParamChange[];
}

export interface BtVariableChange {
  what: "variable";
  change: "added" | "removed" | "changed";
  name: string;
  params?: BtParamChange[];
}

export interface BtTreeChange {
  what: "tree";
  change: "changed";
  params: BtParamChange[];
}

export type BtChange = BtTreeChange | BtVariableChange | BtNodeChange;

export interface BtDiffSummary {
  added: number;
  removed: number;
  moved: number;
  /** Matched nodes with at least one param change (moved ones included). */
  changed: number;
  variables: number;
  /** Nodes in each tree. */
  nodesA: number;
  nodesB: number;
}

export interface BtDiff {
  changes: BtChange[];
  summary: BtDiffSummary;
}

const label = (path: string): string => (path === "" ? "root" : path);
const keyOf = (n: BtNodeView): string => `${n.type}\0${n.name}`;

interface Side {
  view: BtView;
  nodes: BtNodeView[];
  parent: Map<BtNodeView, BtNodeView | null>;
  /** Top-level nodes (the RootNode and the detached ones), the children of a virtual parent. */
  tops: BtNodeView[];
}

function sideOf(doc: BtDocument): Side {
  const view = viewBt(doc);
  const nodes = allNodes(view);
  const parent = new Map<BtNodeView, BtNodeView | null>();
  const tops = [...(view.root ? [view.root] : []), ...view.detached];
  for (const t of tops) parent.set(t, null);
  for (const n of nodes) for (const c of n.children) parent.set(c, n);
  return { view, nodes, parent, tops };
}

/** Indexes of the longest strictly increasing subsequence of `seq`. */
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) keep.add(i);
  return keep;
}

function portValues(view: BtView, n: BtNodeView): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of n.ports) {
    const key = p.inline ? p.name : `${p.side}:${p.name}`;
    out.set(key, portVariable(view, p) ?? "(not connected)");
  }
  return out;
}

function compareMaps(
  a: Map<string, string>,
  b: Map<string, string>,
  out: BtParamChange[],
  prefix = "",
): void {
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  for (const k of keys) {
    const before = a.get(k) ?? null;
    const after = b.get(k) ?? null;
    if (before !== after) out.push({ key: prefix + k, before, after });
  }
}

function nodeParams(a: Side, na: BtNodeView, b: Side, nb: BtNodeView): BtParamChange[] {
  const out: BtParamChange[] = [];
  if (na.name !== nb.name) out.push({ key: "Name", before: na.name, after: nb.name });
  compareMaps(new Map(Object.entries(na.props)), new Map(Object.entries(nb.props)), out);
  compareMaps(portValues(a.view, na), portValues(b.view, nb), out, "port ");
  const ta = na.tests.join(", ");
  const tb = nb.tests.join(", ");
  if (ta !== tb) out.push({ key: "TEST", before: ta || null, after: tb || null });
  return out;
}

function variableChanges(a: BtView, b: BtView): BtVariableChange[] {
  const out: BtVariableChange[] = [];
  const inB = new Map(b.variables.map((v) => [v.name, v]));
  const inA = new Map(a.variables.map((v) => [v.name, v]));
  for (const v of a.variables) {
    const w = inB.get(v.name);
    if (!w) {
      out.push({ what: "variable", change: "removed", name: v.name });
      continue;
    }
    const params: BtParamChange[] = [];
    for (const k of ["type", "flags", "desc"] as const) {
      if (v[k] !== w[k]) params.push({ key: k, before: v[k], after: w[k] });
    }
    if (params.length) out.push({ what: "variable", change: "changed", name: v.name, params });
  }
  for (const w of b.variables) {
    if (!inA.has(w.name)) out.push({ what: "variable", change: "added", name: w.name });
  }
  return out;
}

function treeChange(a: BtView, b: BtView): BtTreeChange | undefined {
  const params: BtParamChange[] = [];
  const cmp = (key: string, x: string | undefined, y: string | undefined): void => {
    if ((x ?? null) !== (y ?? null)) params.push({ key, before: x ?? null, after: y ?? null });
  };
  cmp("Name", a.name, b.name);
  cmp("GUID", a.guid, b.guid);
  cmp("header path", a.resourcePath, b.resourcePath);
  return params.length ? { what: "tree", change: "changed", params } : undefined;
}

/** The node-level diff of tree `a` (before) against tree `b` (after). */
export function diffBt(docA: BtDocument, docB: BtDocument): BtDiff {
  const a = sideOf(docA);
  const b = sideOf(docB);
  const fwd = new Map<BtNodeView, BtNodeView>();
  const back = new Map<BtNodeView, BtNodeView>();
  const pair = (x: BtNodeView, y: BtNodeView): void => {
    fwd.set(x, y);
    back.set(y, x);
  };

  // 1. Unique class and name in both trees.
  const count = (nodes: BtNodeView[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(keyOf(n), (m.get(keyOf(n)) ?? 0) + 1);
    return m;
  };
  const ca = count(a.nodes);
  const cb = count(b.nodes);
  const uniqueB = new Map(b.nodes.filter((n) => cb.get(keyOf(n)) === 1).map((n) => [keyOf(n), n]));
  for (const n of a.nodes) {
    const m = ca.get(keyOf(n)) === 1 ? uniqueB.get(keyOf(n)) : undefined;
    if (m) pair(n, m);
  }

  // 2. Children of matched parents (and the top level), same class and name, in order.
  const matchKids = (xs: BtNodeView[], ys: BtNodeView[]): boolean => {
    let grew = false;
    let from = 0;
    for (const x of xs) {
      if (fwd.has(x)) continue;
      for (let j = from; j < ys.length; j++) {
        const y = ys[j];
        if (back.has(y) || keyOf(y) !== keyOf(x)) continue;
        pair(x, y);
        from = j + 1;
        grew = true;
        break;
      }
    }
    return grew;
  };
  for (let grew = true; grew; ) {
    grew = matchKids(a.tops, b.tops);
    for (const [x, y] of [...fwd]) grew = matchKids(x.children, y.children) || grew;
  }

  // 3. Same path, same class.
  const byPathB = new Map(b.nodes.map((n) => [n.path, n]));
  for (const n of a.nodes) {
    if (fwd.has(n)) continue;
    const m = byPathB.get(n.path);
    if (m && !back.has(m) && m.type === n.type) pair(n, m);
  }

  // 4. What is left of the same class and name, in tree order.
  const leftB = new Map<string, BtNodeView[]>();
  for (const n of b.nodes) {
    if (back.has(n)) continue;
    const list = leftB.get(keyOf(n)) ?? [];
    list.push(n);
    leftB.set(keyOf(n), list);
  }
  for (const n of a.nodes) {
    if (fwd.has(n)) continue;
    const m = leftB.get(keyOf(n))?.shift();
    if (m) pair(n, m);
  }

  // Moved: a new parent, or out of the longest kept order among matched siblings.
  const moved = new Set<BtNodeView>();
  for (const [x, y] of fwd) {
    const px = a.parent.get(x) ?? null;
    const py = b.parent.get(y) ?? null;
    if ((px === null ? null : (fwd.get(px) ?? undefined)) !== py) moved.add(y);
  }
  const reorder = (xs: BtNodeView[], ys: BtNodeView[]): void => {
    const stay = xs.filter((x) => {
      const y = fwd.get(x);
      return y !== undefined && ys.includes(y);
    });
    const seq = stay.map((x) => ys.indexOf(fwd.get(x)!));
    const keep = longestIncreasing(seq);
    stay.forEach((x, i) => {
      if (!keep.has(i)) moved.add(fwd.get(x)!);
    });
  };
  reorder(a.tops, b.tops);
  for (const [x, y] of fwd) reorder(x.children, y.children);

  const changes: BtChange[] = [];
  const tree = treeChange(a.view, b.view);
  if (tree) changes.push(tree);
  const vars = variableChanges(a.view, b.view);
  changes.push(...vars);
  const summary: BtDiffSummary = {
    added: 0,
    removed: 0,
    moved: moved.size,
    changed: 0,
    variables: vars.length,
    nodesA: a.nodes.length,
    nodesB: b.nodes.length,
  };
  for (const y of b.nodes) {
    const x = back.get(y);
    if (!x) {
      summary.added++;
      changes.push({
        what: "node",
        change: "added",
        type: y.type,
        name: y.name,
        to: label(y.path),
      });
      continue;
    }
    const params = nodeParams(a, x, b, y);
    if (params.length) summary.changed++;
    if (!moved.has(y) && params.length === 0) continue;
    const entry: BtNodeChange = {
      what: "node",
      change: moved.has(y) ? "moved" : "changed",
      type: y.type,
      name: y.name,
      from: label(x.path),
      to: label(y.path),
    };
    if (params.length) entry.params = params;
    changes.push(entry);
  }
  for (const x of a.nodes) {
    if (fwd.has(x)) continue;
    summary.removed++;
    changes.push({
      what: "node",
      change: "removed",
      type: x.type,
      name: x.name,
      from: label(x.path),
    });
  }
  return { changes, summary };
}
