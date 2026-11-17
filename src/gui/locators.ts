/**
 * Census locators for the GUI driver (W8 spec 1.2 rule 1, OD-3, OD-13; DEC-076 "the locator
 * file").
 *
 * Two kinds of locator exist:
 *
 *   the ledger's     `row.locator` in data/census/ledger.jsonl: `{ build, controlType,
 *                    windowClass, automationId? , menuPath? }`, captured by L01/L02 at 1.8.0.13
 *                    (carried under EV-s019-carry-001) or at 1.9. It names no window title. wb_gui
 *                    `read` resolves it (a read is harmless) so P-W8-02 can re-resolve it.
 *   the build file's `data/census/locators/<build>.jsonl`, one `LocatorRecord` per line, written
 *                    ONLY by scripts/census/locators-carry.ts from P-W8-02 results (DEC-076). A
 *                    drive action acts only on a row that has a record here for the current build.
 *
 * Resolution is a pure function over a snapshot (src/gui/uia.ts `UiaNode`): by automation id
 * (the elements carrying it, of the locator's control type when one of that type exists; one is
 * the hit; several: the `ordinal`-th in document order when the locator carries one (DEC-078),
 * else the one with the census name and type, if it is the only one), with `itemPath` labels
 * below that element for a property-grid item (DEC-078), or by a label path (the L05 rule of tools/uia/context.py `resolve_target`:
 * breadth-first, each label unique below the previous one; a non-final label named by several
 * elements takes the first container; `@<Class>.<n>` picks the n-th element of a UIA class).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { UiaNode } from "./uia.js";

/** The only probe whose results may become a locator record (DEC-076). */
export const LOCATOR_PROBE = "P-W8-02";
/** Folder under the census root that holds one locator file per build. */
export const LOCATORS_DIR = "locators";

/** Labels compare without mnemonic ampersands, surrounding space or case. */
export function normLabel(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "").trim().toLowerCase();
}

// ── Records ─────────────────────────────────────────────────────────────────────────────────────

/** The window a locator lives in: chosen as src/gui/uia.ts `selectWindow` chooses one. */
export interface LocatorWindow {
  /** Win32 class of the top-level window. */
  className: string;
  /** Regular expression matched against the whole window title. */
  titlePattern: string;
  /** The element sits in an owned window (a floating tool window or a dialog). */
  allowOwned?: boolean;
}

/**
 * One line of `data/census/locators/<build>.jsonl`. Exactly one of `automationId` and `path`.
 * `name` and `controlType` are what the element showed at P-W8-02 and what the census holds
 * (locators-carry.ts refuses a result where they differ from the ledger).
 */
export interface LocatorRecord {
  rowId: string;
  /** The Workbench build the element was resolved on (the file's own build). */
  build: string;
  module: string | null;
  window: LocatorWindow;
  automationId?: string;
  /** DEC-078: index in document order among the elements sharing automationId and controlType. */
  ordinal?: number;
  /** DEC-078: labels below the automationId element (a property grid) down to the item. */
  itemPath?: string[];
  /** Labels from the window root (context.py rule), for elements without a usable id. */
  path?: string[];
  name: string;
  controlType: string;
  /** Acting on the element opens a dialog (P-W8-02/P-W8-03 record it). */
  opensDialog?: boolean;
  /** The dialog it opens was closed by `dismiss` (Cancel, Close or No) on this build (P-W8-03). */
  cancelProven?: boolean;
  probe: typeof LOCATOR_PROBE;
  /** The evidence id of the P-W8-02 result. */
  evidence: string;
}

/** The ledger's `row.locator` (the L01/L02 capture). */
export interface LedgerLocator {
  build?: string;
  automationId?: string;
  controlType?: string;
  menuPath?: string[];
  windowClass?: string;
  /** DEC-078: emitted by the walker when several elements share automationId and controlType. */
  ordinal?: number;
  /** DEC-078: a property-grid item's labels below the grid named by automationId. */
  itemPath?: string[];
  /** DEC-084 option B: the element's own UIA name in the walk when its label was folded. */
  uiaName?: string;
}

/**
 * The name a live element is expected to show (DEC-084 option B, DEC-088): a row whose label L01
 * folded from a sibling Text is judged against the element's own UIA name in the walk (the group
 * box's title for the World Editor snap edits, the check box's own text in the Font toolbar), not
 * against the folded label. Every other row: its label.
 */
export function censusName(row: Pick<CensusRowLite, "label" | "locator">): string | null {
  const own = row.locator?.uiaName;
  return typeof own === "string" ? own : row.label;
}

/** The fields of a ledger row the driver needs. */
export interface CensusRowLite {
  id: string;
  module: string | null;
  kind: string | null;
  label: string | null;
  risk: string | null;
  locator: LedgerLocator | null;
}

/**
 * One P-W8-02 result, as the battery records it: wb_gui `read`'s `capture` plus the probe, the
 * build it ran on and the evidence id.
 */
export interface LocatorProbeResult {
  probe: string;
  evidence: string;
  build: string;
  rowId: string;
  window: LocatorWindow;
  automationId?: string;
  ordinal?: number;
  itemPath?: string[];
  path?: string[];
  /** The build of the locator the sweep resolved (fix-up 2: each row's newest). */
  locatorBuild?: string;
  /** Where that locator came from: the build file or the ledger. */
  locatorSource?: "build-file" | "ledger";
  /** How many elements the locator resolved to (one is the only pass). */
  resolved: number;
  name: string;
  controlType: string;
  opensDialog?: boolean;
  cancelProven?: boolean;
  /**
   * Where the row's element lives (w8-30 sweepSurface, DEC-078 ruling 1): the module's main
   * window, or a menu popup, context menu or dialog that the sweep never has open (fix-up 3).
   */
  surface?: LocatorSurface;
}

export type LocatorSurface = "window" | "menu" | "context" | "dialog";

/**
 * The surface a carried result's row lives on when the result does not record it (results
 * written before fix-up 3): menu and context rows by kind or a menu path of two labels or more,
 * dialog rows by kind. A dialog found only by its automation id needs the tree's main id, which
 * the carry does not have; such a row is "window" here.
 */
export function rowSurface(
  row: Pick<CensusRowLite, "kind">,
  r: { surface?: unknown; path?: unknown },
): LocatorSurface {
  if (
    r.surface === "window" ||
    r.surface === "menu" ||
    r.surface === "context" ||
    r.surface === "dialog"
  )
    return r.surface;
  const kind = typeof row.kind === "string" ? row.kind : "";
  if (kind === "context-menu" || kind === "context-item") return "context";
  if (kind === "menu-item" || (Array.isArray(r.path) && r.path.length >= 2)) return "menu";
  if (kind === "dialog") return "dialog";
  return "window";
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isLabelPath(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length > 0);
}

/** Null when `w` is a usable window spec. */
export function validateLocatorWindow(w: unknown): string | null {
  const x = w as Partial<LocatorWindow> | null;
  if (!x || typeof x !== "object") return "window is required";
  if (!isStr(x.className) || !x.className) return "window.className is required";
  if (!isStr(x.titlePattern) || !x.titlePattern) return "window.titlePattern is required";
  try {
    new RegExp(x.titlePattern);
  } catch {
    return "window.titlePattern does not compile";
  }
  if (x.allowOwned !== undefined && typeof x.allowOwned !== "boolean")
    return "window.allowOwned must be a boolean";
  return null;
}

/** Null when `v` is a well-formed locator record. */
export function validateLocatorRecord(v: unknown): string | null {
  const r = v as Partial<LocatorRecord> | null;
  if (!r || typeof r !== "object") return "not an object";
  if (!isStr(r.rowId) || !r.rowId) return "rowId is required";
  if (!isStr(r.build) || !r.build) return "build is required";
  if (r.module !== null && !isStr(r.module)) return "module must be a string or null";
  const w = validateLocatorWindow(r.window);
  if (w) return w;
  const hasId = isStr(r.automationId) && r.automationId.length > 0;
  const hasPath = r.path !== undefined;
  if (hasId === hasPath) return "exactly one of automationId and path is required";
  if (hasPath && !isLabelPath(r.path)) return "path must be a non-empty list of labels";
  if (r.ordinal !== undefined) {
    if (!Number.isInteger(r.ordinal) || r.ordinal < 0)
      return "ordinal must be a non-negative integer";
    if (!hasId) return "ordinal needs an automationId";
  }
  if (r.itemPath !== undefined) {
    if (!isLabelPath(r.itemPath)) return "itemPath must be a non-empty list of labels";
    if (!hasId) return "itemPath needs an automationId";
  }
  if (!isStr(r.name)) return "name is required (may be empty)";
  if (!isStr(r.controlType) || !r.controlType) return "controlType is required";
  if (r.opensDialog !== undefined && typeof r.opensDialog !== "boolean")
    return "opensDialog must be a boolean";
  if (r.cancelProven !== undefined && typeof r.cancelProven !== "boolean")
    return "cancelProven must be a boolean";
  if (r.probe !== LOCATOR_PROBE) return `probe must be ${LOCATOR_PROBE}`;
  if (!isStr(r.evidence) || !/^EV-/.test(r.evidence)) return "evidence must be an EV- id";
  return null;
}

/** The record with its keys in a fixed order (stable file text). */
export function canonicalRecord(r: LocatorRecord): LocatorRecord {
  return {
    rowId: r.rowId,
    build: r.build,
    module: r.module,
    window: {
      className: r.window.className,
      titlePattern: r.window.titlePattern,
      ...(r.window.allowOwned ? { allowOwned: true } : {}),
    },
    ...(r.automationId !== undefined ? { automationId: r.automationId } : {}),
    ...(r.ordinal !== undefined ? { ordinal: r.ordinal } : {}),
    ...(r.itemPath !== undefined ? { itemPath: [...r.itemPath] } : {}),
    ...(r.path !== undefined ? { path: [...r.path] } : {}),
    name: r.name,
    controlType: r.controlType,
    ...(r.opensDialog !== undefined ? { opensDialog: r.opensDialog } : {}),
    ...(r.cancelProven !== undefined ? { cancelProven: r.cancelProven } : {}),
    probe: LOCATOR_PROBE,
    evidence: r.evidence,
  };
}

/** The file text: one canonical record per line, sorted by row id. */
export function serializeLocatorFile(records: LocatorRecord[]): string {
  const sorted = [...records].sort((a, b) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0));
  return (
    sorted.map((r) => JSON.stringify(canonicalRecord(r))).join("\n") + (sorted.length ? "\n" : "")
  );
}

/**
 * Parse a locator file for `build`. A malformed line, a record of another build or a duplicate
 * row id is an error (the file is generated; any of these means it was edited by hand).
 */
export function parseLocatorFile(
  text: string,
  build: string,
): { records: Map<string, LocatorRecord>; errors: string[] } {
  const records = new Map<string, LocatorRecord>();
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      errors.push(`line ${i + 1}: not JSON`);
      return;
    }
    const why = validateLocatorRecord(v);
    if (why) {
      errors.push(`line ${i + 1}: ${why}`);
      return;
    }
    const r = v as LocatorRecord;
    if (r.build !== build) {
      errors.push(`line ${i + 1}: build ${r.build} in the ${build} file`);
      return;
    }
    if (records.has(r.rowId)) {
      errors.push(`line ${i + 1}: duplicate row ${r.rowId}`);
      return;
    }
    records.set(r.rowId, r);
  });
  return { records, errors };
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────────

/** `<census>/locators/<build>.jsonl`. */
export function locatorFilePath(censusRoot: string, build: string): string {
  return join(censusRoot, LOCATORS_DIR, `${build}.jsonl`);
}

/** The current build tag from `<census>/current-build.json`; null when absent or unreadable. */
export function readCurrentBuild(censusRoot: string): string | null {
  const file = join(censusRoot, "current-build.json");
  if (!existsSync(file)) return null;
  try {
    const tag = (JSON.parse(readFileSync(file, "utf-8")) as { tag?: unknown }).tag;
    return typeof tag === "string" && tag ? tag : null;
  } catch {
    return null;
  }
}

const fileCache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();

/** Keyed on mtime and size: a rewrite inside one mtime tick (coarse clocks) still reloads. */
function cached<T>(file: string, load: () => T): T {
  const st = statSync(file);
  const mtimeMs = st.mtimeMs;
  const size = st.size;
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.value as T;
  const value = load();
  fileCache.set(file, { mtimeMs, size, value });
  return value;
}

/**
 * The build's locator records. A missing file is an empty map (no row has a locator yet). A
 * malformed file throws: the driver refuses rather than act on a partly read file.
 */
export function loadLocatorRecords(censusRoot: string, build: string): Map<string, LocatorRecord> {
  const file = locatorFilePath(censusRoot, build);
  if (!existsSync(file)) return new Map();
  return cached(file, () => {
    const { records, errors } = parseLocatorFile(readFileSync(file, "utf-8"), build);
    if (errors.length) {
      throw new Error(
        `locators/${build}.jsonl is malformed (${errors.slice(0, 3).join("; ")}); regenerate it with scripts/census/locators-carry.ts`,
      );
    }
    return records;
  });
}

function slimRow(v: unknown): CensusRowLite | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r.id !== "string") return null;
  const loc = r.locator as LedgerLocator | null | undefined;
  return {
    id: r.id,
    module: typeof r.module === "string" ? r.module : null,
    kind: typeof r.kind === "string" ? r.kind : null,
    label: typeof r.label === "string" ? r.label : null,
    risk: typeof r.risk === "string" ? r.risk : null,
    locator: loc && typeof loc === "object" ? loc : null,
  };
}

/** The ui rows of a ledger shard text (other dimensions have no GUI element). */
export function parseCensusRows(text: string): Map<string, CensusRowLite> {
  const out = new Map<string, CensusRowLite>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"dim":"ui"')) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    const row = slimRow(v);
    if (row && (v as { dim?: unknown }).dim === "ui") out.set(row.id, row);
  }
  return out;
}

/** The ledger's ui rows (core shard `ledger.jsonl`), cached until the file changes. */
export function loadCensusRows(censusRoot: string): Map<string, CensusRowLite> {
  const file = join(censusRoot, "ledger.jsonl");
  if (!existsSync(file)) return new Map();
  return cached(file, () => parseCensusRows(readFileSync(file, "utf-8")));
}

// ── Resolution over a snapshot ──────────────────────────────────────────────────────────────────

export interface LocatorSpec {
  automationId?: string;
  /** DEC-078: pick this index (document order) among the elements sharing the id and type. */
  ordinal?: number;
  /** DEC-078: labels below the id's element (a property grid), resolved as a label path there. */
  itemPath?: string[];
  path?: string[];
  /** The census name; empty or absent: not used to narrow. */
  name?: string;
  controlType?: string;
}

export interface ResolvedElement {
  /** walker.py path form: "0/3/1" (child indexes from the root). */
  path: string;
  node: UiaNode;
}

export interface Resolution {
  /** Exactly one element was chosen. */
  ok: boolean;
  /** How many elements the locator itself matched (before any narrowing). */
  count: number;
  hit: ResolvedElement | null;
  reason: string | null;
  /** Set when several elements shared the id and the census name and type picked one. */
  narrowed?: boolean;
  /** Set when several elements shared the id and type and the locator's ordinal picked one. */
  ordinal?: boolean;
}

/** Document order: pre-order, children by index (walker.py paths). */
function walk(n: UiaNode, path: string, visit: (n: UiaNode, path: string) => void): void {
  visit(n, path);
  (n.children ?? []).forEach((c, i) => walk(c, `${path}/${i}`, visit));
}

/** Context.py's container types: a non-final path step may settle on the first of these. */
export const CONTAINER_TYPES = ["Tree", "List", "Pane", "Window", "Group", "DataGrid", "Table"];
/** Bound of the breadth-first search of one path step (context.py MAX_SEARCH_NODES). */
export const MAX_SEARCH_NODES = 20_000;

function bfs(
  start: ResolvedElement,
  match: (n: UiaNode) => boolean,
): { found: ResolvedElement[]; overflow: boolean } {
  const found: ResolvedElement[] = [];
  let level: ResolvedElement[] = [start];
  let seen = 0;
  while (level.length) {
    const next: ResolvedElement[] = [];
    for (const el of level) {
      (el.node.children ?? []).forEach((c, i) => {
        seen++;
        const here = { path: `${el.path}/${i}`, node: c };
        if (match(c)) found.push(here);
        else next.push(here);
      });
      if (seen > MAX_SEARCH_NODES) return { found, overflow: true };
    }
    level = next;
  }
  return { found, overflow: false };
}

function classStep(label: string): { cls: string; n: number } | null {
  if (!label.startsWith("@")) return null;
  const m = /^@(.+)\.(\d+)$/.exec(label);
  if (!m || Number(m[2]) < 1) return null;
  return { cls: m[1], n: Number(m[2]) };
}

/** tools/uia/context.py `resolve_target` over a snapshot. */
export function resolvePath(tree: UiaNode, labels: string[]): Resolution {
  let el: ResolvedElement = { path: "0", node: tree };
  let lastCount = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const cs = classStep(label);
    if (cs) {
      const { found, overflow } = bfs(el, (n) => n.className === cs.cls);
      if (overflow) return fail(found.length, `the search passed ${MAX_SEARCH_NODES} elements`);
      if (found.length < cs.n)
        return fail(found.length, `${found.length} elements of class "${cs.cls}" at step ${i + 1}`);
      el = found[cs.n - 1];
      lastCount = 1;
      continue;
    }
    const { found, overflow } = bfs(el, (n) => n.name === label);
    if (overflow) return fail(found.length, `the search passed ${MAX_SEARCH_NODES} elements`);
    let hits = found;
    if (hits.length > 1 && i < labels.length - 1) {
      const containers = hits.filter((h) => CONTAINER_TYPES.includes(h.node.controlType));
      // DEC-088: a tab's menu bar title shares its label with the tab (Imageset's "ImageSet"
      // menu and "ImageSet" tab, W8 run 8): a menu path's step settles on the menu item the
      // breadth-first search reaches first, when no container carries the label.
      hits = containers.length
        ? containers.slice(0, 1)
        : hits.filter((h) => h.node.controlType === "MenuItem").slice(0, 1);
    }
    lastCount = found.length;
    if (hits.length !== 1) {
      return fail(found.length, `${found.length} elements named "${label}" at step ${i + 1}`);
    }
    el = hits[0];
  }
  return { ok: true, count: lastCount, hit: el, reason: null };
}

function fail(count: number, reason: string): Resolution {
  return { ok: false, count, hit: null, reason };
}

/**
 * The elements carrying `automationId`, in document order (pre-order, child index order: the walk's
 * order), narrowed to `controlType` when given and at least one carries it (DEC-078: the
 * locator's other fields). `typed` says whether the type narrowed.
 */
export function idMatches(
  tree: UiaNode,
  automationId: string,
  controlType?: string,
): { all: ResolvedElement[]; typed: boolean } {
  const byId: ResolvedElement[] = [];
  walk(tree, "0", (n, path) => {
    if (n.automationId === automationId) byId.push({ path, node: n });
  });
  if (controlType === undefined) return { all: byId, typed: false };
  const typed = byId.filter((h) => h.node.controlType === controlType);
  return typed.length ? { all: typed, typed: true } : { all: byId, typed: false };
}

/** The node fields an ordinal needs (the walk document's, wb_gui's and L06's node types fit). */
export interface OrdinalNode {
  automationId?: string;
  controlType: string;
  children?: OrdinalNode[];
}

/**
 * DEC-078: the ordinal a walker emits for each element of its tree that carries an automation id
 * shared, with the same control type, by another element of the same tree: its zero-based index
 * in document order among those elements. Keyed by walker.py path ("0/3/1"); an element whose id
 * and type are unique in the tree has no entry (its locator carries no ordinal). The order is
 * resolveLocator's (pre-order, children by index), so the same tree gives the same index.
 */
export function locatorOrdinals(
  tree: OrdinalNode,
): Map<string, { ordinal: number; matches: number }> {
  const groups = new Map<string, string[]>();
  const visit = (n: OrdinalNode, path: string): void => {
    if (n.automationId) {
      const k = `${n.automationId}\u0000${n.controlType}`;
      const g = groups.get(k);
      if (g) g.push(path);
      else groups.set(k, [path]);
    }
    (n.children ?? []).forEach((c, i) => visit(c, `${path}/${i}`));
  };
  visit(tree, "0");
  const out = new Map<string, { ordinal: number; matches: number }>();
  for (const paths of groups.values()) {
    if (paths.length < 2) continue;
    paths.forEach((p, i) => out.set(p, { ordinal: i, matches: paths.length }));
  }
  return out;
}

/**
 * Resolve a locator in a snapshot: one element, or a reason. Name and type only narrow several
 * matches of a locator that carries no ordinal (censusMismatch checks the hit).
 */
export function resolveLocator(tree: UiaNode, spec: LocatorSpec): Resolution {
  if (spec.path && spec.path.length) return resolvePath(tree, spec.path);
  if (!spec.automationId) return fail(0, "the locator has neither an automation id nor a path");
  if (spec.itemPath && spec.itemPath.length) {
    // A property-grid item (DEC-078): the grid is the container carrying the id (its items may
    // carry the same id), then the item's labels below it.
    const grids = idMatches(tree, spec.automationId).all.filter((h) =>
      CONTAINER_TYPES.includes(h.node.controlType),
    );
    if (grids.length !== 1)
      return fail(
        grids.length,
        `${grids.length} containers carry the automation id; the item path needs one`,
      );
    const inner = resolvePath(grids[0].node, spec.itemPath);
    if (!inner.ok || !inner.hit) return inner;
    // resolvePath numbers the subtree from "0": graft it onto the grid's own path.
    const rel = inner.hit.path.slice(1);
    return { ...inner, hit: { path: `${grids[0].path}${rel}`, node: inner.hit.node } };
  }
  const { all, typed } = idMatches(tree, spec.automationId, spec.controlType);
  if (all.length === 0) return fail(0, "no element carries the automation id");
  if (spec.ordinal !== undefined) {
    if (spec.controlType !== undefined && !typed)
      return fail(
        all.length,
        `no element carrying the automation id is a ${spec.controlType}; the ordinal counts those`,
      );
    if (spec.ordinal >= all.length)
      return fail(
        all.length,
        `ordinal ${spec.ordinal}, but ${all.length} elements carry the automation id and type`,
      );
    return { ok: true, count: all.length, hit: all[spec.ordinal], reason: null, ordinal: true };
  }
  if (all.length === 1) return { ok: true, count: 1, hit: all[0], reason: null };
  const narrowed = all.filter(
    (h) =>
      (spec.controlType === undefined || h.node.controlType === spec.controlType) &&
      spec.name !== undefined &&
      spec.name !== "" &&
      normLabel(h.node.name) === normLabel(spec.name),
  );
  if (narrowed.length === 1) {
    return { ok: true, count: all.length, hit: narrowed[0], reason: null, narrowed: true };
  }
  return fail(all.length, `${all.length} elements carry the automation id; refusing to choose`);
}

/** Null when the element shows the expected name and control type; else what differs. */
export function censusMismatch(
  node: Pick<UiaNode, "name" | "controlType">,
  expected: { name?: string | null; controlType?: string | null },
): string | null {
  const diffs: string[] = [];
  if (expected.controlType && node.controlType !== expected.controlType) {
    diffs.push(`control type ${node.controlType || "(none)"}, census ${expected.controlType}`);
  }
  if (
    expected.name !== undefined &&
    expected.name !== null &&
    normLabel(node.name) !== normLabel(expected.name)
  ) {
    diffs.push(`name "${node.name}", census "${expected.name}"`);
  }
  return diffs.length ? diffs.join("; ") : null;
}

/** The locator spec of a ledger locator (a menu path becomes a label path). */
export function ledgerSpec(row: CensusRowLite): LocatorSpec | null {
  const loc = row.locator;
  if (!loc) return null;
  if (loc.automationId) {
    return {
      automationId: loc.automationId,
      ...(Number.isInteger(loc.ordinal) && (loc.ordinal as number) >= 0
        ? { ordinal: loc.ordinal }
        : {}),
      ...(isLabelPath(loc.itemPath) ? { itemPath: [...loc.itemPath] } : {}),
      ...(loc.controlType ? { controlType: loc.controlType } : {}),
      ...(censusName(row) ? { name: censusName(row) as string } : {}),
    };
  }
  if (isLabelPath(loc.menuPath)) {
    return {
      path: [...loc.menuPath],
      ...(loc.controlType ? { controlType: loc.controlType } : {}),
    };
  }
  return null;
}

// ── The carry (scripts/census/locators-carry.ts) ────────────────────────────────────────────────

export interface CarryResult {
  records: LocatorRecord[];
  rejected: Array<{ rowId: string | null; line: number; reason: string }>;
  /** Rows that had more than one passing result; the last one is kept. */
  superseded: string[];
  /**
   * Results that did not resolve to one element because their element lives off the main window
   * (a menu popup, context menu or dialog the sweep never has open), counted by surface and not
   * rejected (fix-up 3: run 4's carry listed 330 menu rows as "resolved to 0 elements, not one";
   * DEC-088: run 8's four Imageset menu items resolved to 2).
   */
  elsewhere: Record<string, number>;
}

/**
 * DEC-088: the id a row has once L01 folds parenthesised counts out of its key ("Colliders (2)"
 * becomes "Colliders"). A result written before the fold names the old id; the carry finds the
 * row under this one. The label keeps the count, so the name check is unchanged.
 */
export function countFoldedId(id: string): string {
  const m = /^(ui:[^/]+\/[^/]+\/)(.*)$/.exec(id);
  if (!m) return id;
  const folded = m[2]
    .split("/")
    .map((seg) => {
      const f = seg.replace(/\s*\(\s*\d+(?:\s*\+\s*\d+)*\s*\)/g, "").trim();
      return f === "" ? seg : f;
    })
    .join("/");
  return m[1] + folded;
}

/**
 * DEC-090: the id a dock tab has once L01 keys it by its name (`ui:<M>/tab/.../@QMainWindowTabBar.<n>/
 * <name>` becomes `.../@QMainWindowTabBar/<name>`; the strip ordinal changes between launches). A
 * result written before the re-key names the old id; the carry finds the row under this one. A
 * tab whose name sat on two strips of one walk keeps its ordinal id, and is found under that id.
 * Every other id is returned unchanged.
 */
export function dockTabStableId(id: string): string {
  const m = /^(ui:[^/]+\/tab\/(?:.*\/)?)@QMainWindowTabBar\.\d+\/([^/]+)$/.exec(id);
  return m ? `${m[1]}@QMainWindowTabBar/${m[2]}` : id;
}

/**
 * The locator records P-W8-02's results justify, and why each other result was refused. Only a
 * P-W8-02 result on `build`, with an EV- evidence id, that resolved to exactly one element whose
 * name and control type match the census row, becomes a record.
 */
export function carryLocators(
  results: unknown[],
  rows: Map<string, CensusRowLite>,
  build: string,
): CarryResult {
  const keep = new Map<string, LocatorRecord>();
  const rejected: CarryResult["rejected"] = [];
  const superseded = new Set<string>();
  const elsewhere: Record<string, number> = {};
  results.forEach((v, i) => {
    const line = i + 1;
    const r = v as Partial<LocatorProbeResult> | null;
    const rowId = r && typeof r.rowId === "string" ? r.rowId : null;
    const reject = (reason: string): void => void rejected.push({ rowId, line, reason });
    if (!r || typeof r !== "object") return reject("not an object");
    if (r.probe !== LOCATOR_PROBE) return reject(`not a ${LOCATOR_PROBE} result`);
    if (!isStr(r.evidence) || !/^EV-/.test(r.evidence)) return reject("no EV- evidence id");
    if (r.build !== build) return reject(`ran on build ${String(r.build)}, not ${build}`);
    if (!rowId) return reject("no rowId");
    const row =
      rows.get(rowId) ?? rows.get(countFoldedId(rowId)) ?? rows.get(dockTabStableId(rowId));
    if (!row) return reject("no ui row with that id in the ledger");
    // DEC-088: any count but one on an off-window surface says nothing about the row: the sweep
    // never has the menu open (run 8: Imageset's ImageSet menu items counted the ImageSet menu
    // title and the ImageSet tab, 2 elements).
    if (r.resolved !== 1) {
      const surface = rowSurface(row, r);
      if (surface !== "window") {
        elsewhere[surface] = (elsewhere[surface] ?? 0) + 1;
        return;
      }
    }
    if (r.resolved !== 1) return reject(`resolved to ${String(r.resolved)} elements, not one`);
    if (!isStr(r.name) || !isStr(r.controlType) || !r.controlType)
      return reject("no name or control type recorded");
    const why = censusMismatch(
      { name: r.name, controlType: r.controlType },
      { name: censusName(row), controlType: row.locator?.controlType ?? null },
    );
    if (why) return reject(`differs from the census: ${why}`);
    const rec: LocatorRecord = {
      rowId: row.id,
      build,
      module: row.module,
      window: r.window as LocatorWindow,
      ...(isStr(r.automationId) && r.automationId ? { automationId: r.automationId } : {}),
      ...(r.ordinal !== undefined ? { ordinal: r.ordinal } : {}),
      ...(r.itemPath !== undefined ? { itemPath: r.itemPath } : {}),
      ...(r.path !== undefined ? { path: r.path } : {}),
      name: r.name,
      controlType: r.controlType,
      ...(typeof r.opensDialog === "boolean" ? { opensDialog: r.opensDialog } : {}),
      ...(typeof r.cancelProven === "boolean" ? { cancelProven: r.cancelProven } : {}),
      probe: LOCATOR_PROBE,
      evidence: r.evidence,
    };
    const bad = validateLocatorRecord(rec);
    if (bad) return reject(bad);
    if (keep.has(row.id)) superseded.add(row.id);
    keep.set(row.id, canonicalRecord(rec));
  });
  return {
    records: [...keep.values()],
    rejected,
    superseded: [...superseded].sort(),
    elsewhere,
  };
}
