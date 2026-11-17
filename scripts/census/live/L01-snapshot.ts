/**
 * L01, the passive accessibility snapshot of the Phase 4 live GUI census (design
 * `docs/v2/design/phase4-live-census.md` sections 1, 2 and 4; plan 4.5, 5.3). One step per
 * (module, state): a single passive walk of the module's window through `tools/uia/walk.ts`
 * (`runWalk`: the plan check, the redaction table, the lease-recorded pid, the file written outside
 * every git tree), then every node mapped to an observation line by the kind table (D6, `kindOf`
 * in common.ts) and the identity rules (D7, `chooseKey`).
 *
 *   p4-l01-snapshot-<Module>-<stateTag>   read-only: one `uia-read` of the module window; the walk
 *                                         file `L01-<Module>-<stateTag>-walk.json` is the artifact
 *                                         every line's `ref` cites by sha256 and tree path
 *
 * Nothing is invoked, typed or expanded: the plan holds one `uia-read` (readOnly, all nine bounds,
 * the pid the lane recorded) and no other action. Data containers are sampled by the walker
 * (`rowSample` 40); a sampled container, or one whose rows are project data (a custom list or tree
 * view, `gridRowCount` above the sample), emits its container row only, with no `children_count`
 * and an `unverified` note, and its items emit nothing (design 1.2: the container is deferred
 * "sampled"). ParticleEditor is never read (DEC-042). Credential fields are recorded from the
 * walk only (`risk_hint: credential`), never typed into.
 *
 *   npx --no tsx scripts/census/live/L01-snapshot.ts [--out <plan.json>] [--outline <file>]
 *       [--emit-queue <file>] [--module WorldEditor] [--state mode=edit,selection=none]
 *   npx --no tsx scripts/census/live/L01-snapshot.ts --really --id <lane> --sandbox <dir>
 *       --run-dir <dir> --module WorldEditor [--state ...] [--allow-owned] --only <step>
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  DEFAULT_BOUNDS,
  KILL_GRACE_MS,
  PLAN_VERDICT_ENV,
  REDACT_ENV,
  redactionTable,
  runWalk,
  walkerArgv,
  type FinishedWalk,
  type WalkBounds,
} from "../../../tools/uia/walk.js";
import { LANE_RECORDED_PID, checkPlan, formatResult, type PlanAction } from "../../live/dry-run.js";
import { locatorOrdinals } from "../../../src/gui/locators.js";
import { type PlaceholderContext } from "../../live/paths.js";
import { loadPolicy } from "../../live/policy.js";
import {
  EDITOR_WINDOW_CLASS,
  MODULE_TITLES,
  StopBattery,
  chooseKey,
  deriveId,
  dismissedLine,
  isMainModule,
  kindOf,
  normalizeLabel,
  objectNameOf,
  rekeyDockTabs,
  runWalker,
  stateFor,
  stateKey,
  stateTag,
  type KindNode,
  type LiveKey,
  type LiveKind,
  type LiveObservation,
  type ObservedState,
  type WalkerDef,
  type WalkerStep,
  type WalkerStepContext,
} from "./common.js";

export const ENUMERATOR = "L01";
/** Kinds the parent convention attaches to the module window (common.ts windowParentKey). */
const WINDOW_CHILD_KINDS: ReadonlySet<LiveKind> = new Set(["menu", "toolbar", "dock", "panel"]);
export const SCRIPT = "scripts/census/live/L01-snapshot.ts";
export const SESSION = "P4-1";

// ── The module windows ───────────────────────────────────────────────────────

/** How one module's main window is named to the walker (class and title together, never title alone). */
export interface ModuleWindow {
  className: string;
  /** A full-match pattern (walker.py `fullmatch`). */
  titlePattern: string;
  /** Why the pattern is not yet a live fact. */
  unverified?: string;
}

/**
 * Every module window comes from the one table, common.ts MODULE_TITLES (P4-FIX-H: L01 kept its own
 * table and still guessed "^Navmesh Generator.*$" after P4-FIX-E set the live title, so sitting P4-2
 * stopped the Navmesh walk and L03 had no walk to read). The Navmesh Generator is its own unowned
 * Qt683QWindowIcon titled "Arma Reforger Workbench" (P4-2 p4-l10-09 windowsAdded), so it is walked
 * like any other module. ParticleEditor has no entry on purpose (DEC-042); a module MODULE_TITLES
 * does not name (DialogueEditor) is refused. The ResourceManager.* sub-editors are read in the RM
 * window with their tab active (sitting P4-9, titles [unverified]).
 */
export const MODULE_WINDOWS: Readonly<Record<string, ModuleWindow>> = Object.fromEntries(
  Object.entries(MODULE_TITLES)
    .filter(([m]) => m !== "ParticleEditor")
    .map(([m, t]) => [
      m,
      {
        className: EDITOR_WINDOW_CLASS,
        titlePattern: t.pattern,
        ...(t.unverified ? { unverified: `the ${m} window title has not been seen live` } : {}),
      },
    ]),
);

/** The window a module's snapshot reads, or an Error saying why none may be read. */
export function moduleWindow(module: string): ModuleWindow {
  if (module === "ParticleEditor")
    throw new Error(
      "L01: ParticleEditor is never read (DEC-042: its module read crashed Workbench)",
    );
  const w = MODULE_WINDOWS[module];
  if (!w)
    throw new Error(
      `L01: no window title is recorded for module ${module}; add it to MODULE_WINDOWS from a window list before a real run`,
    );
  return w;
}

// ── Bounds and the plan ──────────────────────────────────────────────────────

/** The proven defaults (P3-3 walked 358 nodes in 2.8 s) with room for a larger module. */
export const L01_BOUNDS: WalkBounds = { ...DEFAULT_BOUNDS, maxNodes: 20_000, budgetMs: 180_000 };

/** The step's one plan action: the walk's `uia-read`, pid "lane-recorded" until the launch. */
export function walkAction(w: ModuleWindow, allowOwned: boolean): PlanAction {
  return {
    kind: "uia-read",
    target: {
      pid: LANE_RECORDED_PID,
      window: { className: w.className, titlePattern: w.titlePattern, allowOwned },
    },
    readOnly: true,
    view: "raw",
    bounds: { ...L01_BOUNDS },
  } as unknown as PlanAction;
}

export function stepId(module: string, state: ObservedState): string {
  return `p4-l01-snapshot-${module}-${stateTag(state)}`;
}

// ── The walk document ────────────────────────────────────────────────────────

export interface WalkNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  patterns?: string[];
  acceleratorKey?: string;
  helpText?: string;
  legacyDescription?: string;
  gridRowCount?: number;
  childCount?: number;
  childCountAtLeast?: number;
  truncated?: string;
  childError?: string;
  error?: string;
  sampled?: { kept: number; rule: string };
  children?: WalkNode[];
}

export interface WalkDoc {
  refused?: boolean;
  reason?: string;
  completed?: boolean;
  partial?: boolean;
  stop_reason?: string | null;
  bounds?: { row_sample?: number };
  target?: { className?: string; title?: string };
  tree?: WalkNode;
}

// ── State axes (D8) ──────────────────────────────────────────────────────────

/** D8 (common.ts `stateFor`): the axes `state-matrix.json` declares for this module and kind. */
export { stateFor };

// ── Node to row ──────────────────────────────────────────────────────────────

/** Kinds `universes.json` marks leaf: their `children_count` is never claimed. */
const LEAF_KINDS: ReadonlySet<LiveKind> = new Set([
  "menu-item",
  "toolbar-button",
  "control",
  "context-item",
  "tool-button",
  "region",
  "status-item",
]);

/**
 * Panels whose children are state-variable content with no state axis (P4-FIX-J): the status bar's
 * items and a dock tab bar's tabs differ between sittings, so the child rows of two states union
 * and no `children_count` is claimed. The child rows stay.
 */
const STATE_VARIABLE_PANEL = /^(statusBar|@QMainWindowTabBar\.\d+)$/;

/** Dismissal rules whose node is chrome with nothing worth a row beneath it. */
const SKIP_SUBTREE_RULES: ReadonlySet<string> = new Set([
  "system-menu",
  "structural-scrollbar",
  "structural-thumb",
  "structural-header",
]);

const EDITABLE: ReadonlySet<string> = new Set(["Edit", "ComboBox", "CheckBox"]);
const WRAPPER_TYPES: ReadonlySet<string> = new Set(["Group", "Custom", "Pane"]);
const STATIC_ITEM_VIEW = /^Q(List|Tree|Table)Widget$/;
const CREDENTIAL_NAME = /passw|passwd|token|secret|api[ _-]?key|credential/i;
const LIVE_COUNT_NAME = /^[\d.,%\s:/-]+$/;
/**
 * A parenthesised count inside a name ("Colliders (2)", "Bones (0 + 0)", "Resource Variants (1)"):
 * live data about the open resource, not identity (DEC-088). W8 run 8 re-walked the Model tab on
 * another .xob and every toolbox button changed id ("Colliders (0)" became "Colliders (2)").
 */
const LIVE_COUNT_PART = /\s*\(\s*\d+(?:\s*\+\s*\d+)*\s*\)/g;

/** The name with its parenthesised counts removed, or the name itself when nothing is left. */
export function foldLiveCounts(name: string): string {
  const folded = normalizeLabel(name.replace(LIVE_COUNT_PART, ""));
  return folded === "" ? name : folded;
}

interface Ctx {
  n: WalkNode;
  path: string;
  parent: Ctx | null;
  kids: Ctx[];
  /** The last dotted segment of the automation id. */
  seg: string;
}

interface Row {
  c: Ctx;
  kind: LiveKind;
  dismissed?: string;
  parent: Row | null;
  kids: Row[];
  /** Some child of this node was not emitted (sampling, a deferral, a closed popup, a failed read). */
  gap: boolean;
  /** The UIA name, or the folded sibling label, as the line's label_raw. */
  labelRaw?: string;
  /** DEC-084 option B: the node's own UIA name, kept when its label was folded from a Text. */
  uiaName?: string;
  notes: string[];
  medium: boolean;
  /** The name is not an identity: a tab strip follows its selected tab, a counter is live data. */
  nameVolatile?: "strip" | "live";
  key?: LiveKey;
  confidence?: "low";
  state: ObservedState;
}

function lastSeg(id: string | undefined): string {
  return (id ?? "").split(".").pop() ?? "";
}

function build(n: WalkNode, path: string, parent: Ctx | null): Ctx {
  const c: Ctx = { n, path, parent, kids: [], seg: lastSeg(n.automationId) };
  c.kids = (n.children ?? []).map((k, i) => build(k, `${path}/${i}`, c));
  return c;
}

const nameOf = (n: WalkNode): string => normalizeLabel(n.name ?? "");

/**
 * Text nodes that label an editable sibling (design 1.2): a Text named `<stem>Label` pairs with the
 * sibling Edit, ComboBox or CheckBox whose object name starts with the stem (unsuffixed labels
 * first), a Text with no stem match with the next unpaired editable sibling. Returns the label by
 * editable node and the set of Text nodes folded into one.
 */
function pairLabels(root: Ctx): { labels: Map<Ctx, string>; folded: Set<Ctx> } {
  const labels = new Map<Ctx, string>();
  const folded = new Set<Ctx>();
  const stack: Ctx[] = [root];
  while (stack.length) {
    const c = stack.pop()!;
    stack.push(...c.kids);
    const editables = c.kids.filter((k) => EDITABLE.has(k.n.controlType));
    const texts = c.kids.filter((k) => k.n.controlType === "Text" && nameOf(k.n) !== "");
    if (!editables.length || !texts.length) continue;
    const pair = (t: Ctx, e: Ctx): void => {
      labels.set(e, t.n.name ?? "");
      folded.add(t);
    };
    const stemOf = (t: Ctx): { stem: string; suffixed: boolean } | null => {
      const m = /^(.+?)(?:Label|Lbl)(_\d+)?$/i.exec(t.seg);
      return m ? { stem: m[1].toLowerCase(), suffixed: m[2] !== undefined } : null;
    };
    for (const wantSuffixed of [false, true]) {
      for (const t of texts) {
        const s = stemOf(t);
        if (!s || s.suffixed !== wantSuffixed || folded.has(t)) continue;
        const e = editables.find(
          (x) =>
            !labels.has(x) &&
            x.seg.toLowerCase().startsWith(s.stem) &&
            x.seg.length > s.stem.length,
        );
        if (e) pair(t, e);
      }
    }
    for (const t of texts) {
      if (folded.has(t) || stemOf(t)) continue;
      const i = c.kids.indexOf(t);
      const e = c.kids.slice(i + 1).find((x) => EDITABLE.has(x.n.controlType) && !labels.has(x));
      if (e) pair(t, e);
    }
  }
  return { labels, folded };
}

/** Rows that are project data (entities, files, entity types), not interface. */
function itemsAreData(container: Ctx, rowSample: number): boolean {
  const n = container.n;
  return (
    n.sampled !== undefined ||
    (n.gridRowCount ?? 0) > rowSample ||
    !STATIC_ITEM_VIEW.test(n.className ?? "")
  );
}

export interface SnapshotInput {
  module: string;
  state: ObservedState;
  /** sha256 of the walk file the refs cite. */
  sha256: string;
  /** The walk read an owned window (the Options dialog): its root is a dialog, not a module window. */
  allowOwned?: boolean;
}

export interface SnapshotStats {
  nodes: number;
  rows: number;
  byKind: Record<string, number>;
  dismissed: number;
  folded: number;
  deferred: string[];
  outOfScope: number;
  dataItemsSkipped: number;
  sampledContainers: string[];
  childrenCounted: number;
  incomplete: boolean;
}

/**
 * The pure core: a walk document to observation lines. Throws when the document holds no tree.
 * Every line passes `validateLine(line, "L01")`; ids are unique per state; every `parent_key`
 * resolves to a line of the same file.
 */
export function snapshotLines(
  doc: WalkDoc,
  input: SnapshotInput,
): { lines: LiveObservation[]; stats: SnapshotStats } {
  if (!doc.tree || !doc.tree.controlType) throw new Error("the walk document holds no tree");
  const { module, state } = input;
  const allowOwned = input.allowOwned === true;
  const rowSample = doc.bounds?.row_sample ?? DEFAULT_BOUNDS.rowSample;
  const winClass = doc.target?.className ?? EDITOR_WINDOW_CLASS;
  const root = build(doc.tree, "0", null);
  const { labels: folds, folded } = pairLabels(root);
  const stats: SnapshotStats = {
    nodes: 0,
    rows: 0,
    byKind: {},
    dismissed: 0,
    folded: folded.size,
    deferred: [],
    outOfScope: 0,
    dataItemsSkipped: 0,
    sampledContainers: [],
    childrenCounted: 0,
    incomplete: doc.completed === false || doc.partial === true,
  };

  // Pass A: classify every node; rows form a tree of their own (nearest emitted ancestor).
  const rows: Row[] = [];
  const sink = { gap: false };
  const visit = (c: Ctx, parentRow: Row | null, gapSink: { gap: boolean }): void => {
    stats.nodes++;
    const n = c.n;
    const ct = n.controlType;
    const name = nameOf(n);
    const parent = c.parent;
    const patterns = n.patterns ?? [];
    const isRoot = c.path === "0";
    const ownGap =
      n.truncated !== undefined ||
      n.childError !== undefined ||
      n.error !== undefined ||
      n.childCountAtLeast !== undefined ||
      n.sampled !== undefined ||
      (n.childCount !== undefined && n.sampled === undefined && n.childCount > c.kids.length);
    const makeRow = (kind: LiveKind, extra: Partial<Row> = {}): Row => {
      const r: Row = {
        c,
        kind,
        parent: parentRow,
        kids: [],
        gap: ownGap,
        notes: [],
        medium: false,
        state: stateFor(module, kind, state),
        ...extra,
      };
      rows.push(r);
      parentRow?.kids.push(r);
      return r;
    };
    let row: Row | null = null;
    let verdict: ReturnType<typeof kindOf> | null = null;

    // Data items (rows of a list, tree or grid) first: the container decides.
    const isItem = ct === "ListItem" || ct === "TreeItem" || ct === "DataItem";
    const inGrid = isItem && parent !== null && /PropertyGrid/.test(parent.n.className ?? "");
    const pageItem =
      ct === "ListItem" &&
      parent !== null &&
      (parent.parent?.kids ?? []).some((k) => k.n.className === "QStackedWidget");
    if (isItem && !inGrid && !pageItem) {
      if (parent === null || itemsAreData(parent, rowSample)) {
        stats.dataItemsSkipped++;
        gapSink.gap = true;
        return;
      }
    }
    // A page list beside a QStackedWidget is the tab strip in function (D9): its items are the
    // tabs and attach to the dialog; the list itself is no row.
    if (ct === "List" && (parent?.kids ?? []).some((k) => k.n.className === "QStackedWidget")) {
      for (const k of c.kids) visit(k, parentRow, gapSink);
      return;
    }
    const kn: KindNode = {
      controlType: ct,
      className: /PropertyGrid/.test(n.className ?? "") ? "PropertyGrid" : (n.className ?? ""),
      name,
      isModuleRoot: isRoot && !allowOwned,
      owned: isRoot && allowOwned,
      underAppMenuBar:
        ct === "MenuItem" &&
        parent?.n.controlType === "MenuBar" &&
        (parent.n.name ?? "") !== "System",
      underToolBar: parent?.n.controlType === "ToolBar",
      pageListItem: pageItem,
      dockContents: parent?.n.className === "QDockWidget" && c.seg.endsWith("Contents"),
      inPropertyGrid: inGrid,
      expandable: patterns.includes("ExpandCollapse"),
      underStatusBar: ct === "Text" && parent?.n.controlType === "StatusBar",
      labelsEditable: folded.has(c),
      underDockOrDialog: true,
      childCount: n.childCount,
    };
    verdict = kindOf(kn, ENUMERATOR);
    if ("kind" in verdict) {
      row = makeRow(verdict.kind);
      if (verdict.kind === "menu" || verdict.kind === "tab") row.gap = true;
      if (verdict.kind === "property-group" && ct === "TreeItem") row.gap = true;
    } else if ("dismissed" in verdict) {
      row = makeRow("region", { dismissed: verdict.dismissed });
      stats.dismissed++;
    } else if ("foldLabel" in verdict) {
      return; // folded into its editable sibling's label_raw
    } else if ("outOfScope" in verdict) {
      stats.outOfScope++;
      gapSink.gap = true;
      for (const k of c.kids) visit(k, parentRow, gapSink);
      return;
    } else {
      // Deferred. Local rows the table has none for: a StatusBar, a named Group box.
      if (ct === "StatusBar") {
        row = makeRow("panel", { medium: true });
        row.notes.push("StatusBar has no row in design 1.2; recorded as a panel");
      } else if ((ct === "Group" || ct === "Custom") && name !== "") {
        row = makeRow("panel", { medium: true });
        row.notes.push("a named Group has no row in design 1.2; recorded as a panel");
      } else {
        if (!(WRAPPER_TYPES.has(ct) && name === "")) {
          gapSink.gap = true;
          stats.deferred.push(`${c.path} ${verdict.deferred}`);
        } else if (ownGap) {
          gapSink.gap = true;
        }
        for (const k of c.kids) visit(k, parentRow, gapSink);
        return;
      }
    }

    // Row-level facts.
    const r = row;
    if (r.dismissed === undefined) {
      const folding = folds.get(c);
      const raw = folding ?? n.name ?? "";
      if (normalizeLabel(raw) !== "") r.labelRaw = raw;
      if (folding !== undefined) r.uiaName = normalizeLabel(n.name ?? "");
      if (ct === "Tab") {
        r.nameVolatile = "strip";
        r.medium = true;
      } else if (name !== "" && LIVE_COUNT_NAME.test(name) && !folding) {
        r.nameVolatile = "live";
        r.medium = true;
      }
      if (ct === "CheckBox" && r.kind === "toolbar-button")
        r.notes.push("checkable (CheckBox); the toggle state is not read");
    }
    if (n.sampled !== undefined || ((n.gridRowCount ?? 0) > rowSample && ct !== "TreeItem")) {
      const kept = n.sampled?.kept ?? c.kids.length;
      const total = n.childCount ?? n.gridRowCount ?? kept;
      r.notes.push(
        `sampled: ${kept} of ${n.gridRowCount ?? total} rows read; the rest are deferred (a scrolled read or another source closes them)`,
      );
      r.gap = true;
      stats.sampledContainers.push(c.path);
    } else if (/^(List|Tree|Table)$/.test(ct) && itemsAreData(c, rowSample)) {
      r.notes.push(
        /PropertyGrid/.test(n.className ?? "")
          ? "leaf property rows belong to L06; L01 emits the grid and its category rows"
          : `${n.className ?? ct} rows are project data; L01 emits the container only`,
      );
      r.gap = true;
    }
    if (n.truncated !== undefined || n.childError !== undefined)
      r.notes.push(`child list incomplete (${n.truncated ?? n.childError})`);

    if (r.dismissed !== undefined && SKIP_SUBTREE_RULES.has(r.dismissed)) return;
    for (const k of c.kids) visit(k, r, r);
  };
  visit(root, null, sink);

  // Pass B: keys, in document order (a parent's key is final before its children read it).
  const objectCount = new Map<string, number>();
  for (const r of rows) {
    const cand = objectNameOf(r.c.n.automationId, r.c.n.className || r.c.n.controlType);
    if (cand) objectCount.set(`${r.kind}|${cand}`, (objectCount.get(`${r.kind}|${cand}`) ?? 0) + 1);
  }
  const ordinals = new Map<string, number>();
  const seen = new Set<string>();
  const segOf = (r: Row): string => {
    const k = r.key!;
    return "object_name" in k ? k.object_name : k.path[k.path.length - 1];
  };
  const chain = (r: Row | null): string[] => {
    const out: string[] = [];
    for (let p = r; p; p = p.parent) {
      const isModuleRoot = p.parent === null && p.kind === "window" && !allowOwned;
      if (isModuleRoot || p.dismissed !== undefined) continue;
      out.unshift(segOf(p));
    }
    return out;
  };
  const idOf = (r: Row): string =>
    `${deriveId({ dim: "ui", kind: r.kind, module, key: r.key! })}|${stateKey(r.state)}`;
  for (const r of rows) {
    const n = r.c.n;
    const cls = n.className || n.controlType;
    const ancestors = chain(r.parent);
    const fullName =
      r.dismissed !== undefined || r.nameVolatile ? "" : normalizeLabel(r.labelRaw ?? "");
    const name = foldLiveCounts(fullName);
    if (name !== fullName)
      r.notes.push("the parenthesised count in the name is live data; the key omits it");
    const cand = objectNameOf(n.automationId, cls);
    const unique = cand !== null && objectCount.get(`${r.kind}|${cand}`) === 1;
    let ordinal: number | undefined;
    if (!(cand && unique) && name === "") {
      const k = `${ancestors.join("/")}|${cls}`;
      ordinal = (ordinals.get(k) ?? 0) + 1;
      ordinals.set(k, ordinal);
    }
    const idn = chooseKey(
      {
        automationId: n.automationId,
        className: cls,
        ancestorLabels: ancestors,
        name,
        unnamedOrdinal: ordinal,
        moduleWindow: r.parent === null && r.kind === "window" && !allowOwned,
      },
      () => unique,
    );
    r.key = idn.key;
    if (idn.confidence) r.confidence = idn.confidence;
    if (idn.unverified && r.dismissed === undefined) {
      if (r.nameVolatile === "strip")
        r.notes.push("the strip name follows the selected tab; ordinal identity");
      else if (r.nameVolatile === "live")
        r.notes.push("the name is a live counter; ordinal identity");
      else r.notes.push(...idn.unverified);
    }
    if (r.nameVolatile) delete r.confidence;
    try {
      idOf(r);
    } catch {
      const seg = name !== "" ? name : `@${cls}.${ordinal ?? 1}`;
      r.key = { path: [...ancestors, seg] };
      r.confidence = "low";
      r.notes.push("the automation id is not a usable object name; identity by label path");
    }
    for (let k = 2; seen.has(idOf(r)); k++) {
      const base = segOf(r).replace(/@\d+$/, "");
      r.key = { path: [...ancestors, `${base}@${k}`] };
      r.confidence = "low";
      if (!r.notes.includes("a sibling shares this label; ordinal disambiguated"))
        r.notes.push("a sibling shares this label; ordinal disambiguated");
    }
    seen.add(idOf(r));
  }

  // Pass B2: the parent convention (common.ts windowParentKey). A menu-bar title, toolbar, dock or
  // panel whose only row ancestors below the module window are regions (the menu bar, the content
  // area) is a child of the window row. Keys are final, so only the parent link moves.
  const top = rows[0];
  if (top && top.parent === null && top.kind === "window" && !allowOwned) {
    for (const r of rows) {
      if (!WINDOW_CHILD_KINDS.has(r.kind) || r.dismissed !== undefined) continue;
      if (!r.parent || r.parent === top) continue;
      let p: Row | null = r.parent;
      while (p && p !== top && p.kind === "region") p = p.parent;
      if (p !== top) continue;
      r.parent.kids.splice(r.parent.kids.indexOf(r), 1);
      r.parent = top;
      top.kids.push(r);
    }
  }

  // Pass C: children_count where every child was emitted and shares the parent's state.
  const counts = new Map<Row, number>();
  for (const r of rows) {
    if (LEAF_KINDS.has(r.kind) || r.gap) continue;
    const sk = stateKey(r.state);
    if (r.kids.some((k) => stateKey(k.state) !== sk)) continue;
    if (r.kind === "panel" && STATE_VARIABLE_PANEL.test(segOf(r))) continue;
    counts.set(r, r.kids.length);
    stats.childrenCounted++;
  }

  // Pass D: the lines. DEC-078: a locator whose automation id and control type more than one
  // element of this walk carries gets the element's ordinal among them (document order), from the
  // walk itself, never from a key's `@Class.n` suffix.
  const locOrdinals = locatorOrdinals(doc.tree);
  const lines: LiveObservation[] = rows.map((r) => {
    const n = r.c.n;
    const label = r.labelRaw !== undefined ? normalizeLabel(r.labelRaw) : undefined;
    const locator: NonNullable<LiveObservation["locator"]> = {
      controlType: n.controlType,
      windowClass: winClass,
    };
    if (n.automationId) {
      locator.automationId = n.automationId;
      const o = locOrdinals.get(r.c.path);
      if (o) locator.ordinal = o.ordinal;
    }
    if (r.kind === "menu" && label) locator.menuPath = [label];
    if (r.uiaName !== undefined && r.dismissed === undefined) locator.uiaName = r.uiaName;
    const base: Omit<LiveObservation, "kind" | "control_type" | "dismissed_by" | "confidence"> = {
      dim: "ui",
      module,
      key: r.key!,
      parent_key: r.parent ? { dim: "ui", kind: r.parent.kind, module, key: r.parent.key! } : null,
      origin: "vanilla",
      ...(label !== undefined && r.labelRaw !== undefined ? { label, label_raw: r.labelRaw } : {}),
      locator,
      observed_state: r.state,
      ref: `artifact:${input.sha256}#n/${r.c.path}`,
    };
    if (r.dismissed !== undefined) return dismissedLine(base, n.controlType, r.dismissed);
    const line: LiveObservation = {
      ...base,
      kind: r.kind,
      confidence: r.confidence === "low" ? "low" : r.medium ? "medium" : "high",
    };
    const raw = n.acceleratorKey ?? (r.labelRaw?.includes("\t") ? r.labelRaw.split("\t")[1] : "");
    if (raw && raw.trim()) line.shortcut_default = raw.trim();
    const quote = n.helpText || n.legacyDescription;
    if (quote) line.quote = quote;
    if (counts.has(r)) line.children_count = counts.get(r);
    if (CREDENTIAL_NAME.test(`${n.name ?? ""} ${n.automationId ?? ""}`))
      line.risk_hint = "credential";
    if (r.notes.length) line.unverified = [...new Set(r.notes)];
    return line;
  });
  // DEC-090: a dock tab is keyed by its name, not by its strip's launch-dependent ordinal.
  rekeyDockTabs(lines);

  for (const l of lines) {
    stats.rows++;
    stats.byKind[l.kind] = (stats.byKind[l.kind] ?? 0) + 1;
  }
  return { lines, stats };
}

// ── The walk kernel ──────────────────────────────────────────────────────────

export interface WalkRequest {
  pid: number;
  className: string;
  titlePattern: string;
  allowOwned: boolean;
  bounds: WalkBounds;
  outPath: string;
  ph: PlaceholderContext;
}

/** One passive walk. The real one is `tools/uia/walk.ts runWalk`; tests pass a fake. */
export type WalkKernel = (req: WalkRequest) => Promise<FinishedWalk>;

/**
 * The real kernel: the plan is checked against policy.json once more, then `runWalk` spawns walker.py with the redaction table and the verdict env. The lease
 * heartbeat belongs to the runner (common.ts starts it for the whole run).
 */
export const realWalkKernel: WalkKernel = async (req) => {
  const action = walkAction(
    { className: req.className, titlePattern: req.titlePattern },
    req.allowOwned,
  );
  const check = checkPlan([action], loadPolicy(), { script: SCRIPT });
  if (!check.ok) throw new StopBattery("stopped", `refused: ${formatResult(check)}`);
  const table = redactionTable(req.ph, undefined, process.env);
  return runWalk({
    argv: walkerArgv({
      provider: "uia",
      target: {
        pid: req.pid,
        className: req.className,
        titlePattern: req.titlePattern,
        allowOwned: req.allowOwned,
      },
      bounds: req.bounds,
      view: "raw",
      really: true,
    }),
    env: { [REDACT_ENV]: JSON.stringify(table), [PLAN_VERDICT_ENV]: "PASS" },
    timeoutMs: req.bounds.budgetMs + 4 * req.bounds.callTimeoutMs + KILL_GRACE_MS,
    outPath: req.outPath,
    ctx: req.ph,
    table,
  });
};

// ── The step ─────────────────────────────────────────────────────────────────

export function snapshotStep(
  kernel: WalkKernel,
  o: { module: string; state: ObservedState; allowOwned: boolean },
): WalkerStep {
  const w = moduleWindow(o.module);
  return {
    id: stepId(o.module, o.state),
    title: `passive accessibility snapshot of the ${o.module} window`,
    risk: "read-only",
    timeout_ms: L01_BOUNDS.budgetMs + 4 * L01_BOUNDS.callTimeoutMs + KILL_GRACE_MS,
    expected: `one uia-read of the unowned ${w.className} window matching ${w.titlePattern}; every node becomes a window, dock, panel, tab, toolbar, control, property-group, status-item or dismissed row${w.unverified ? ` (${w.unverified})` : ""}`,
    kill_criterion:
      "a new window not on the benign list (stop), a dialog-like window (handoff), a walker refusal or timeout; never retried",
    side_effects: [],
    rollback: "none: a passive read; the walk file stays in the run folder",
    plan: ({ allowOwned }) => [walkAction(w, allowOwned)],
    run: (ctx: WalkerStepContext) => runSnapshot(kernel, ctx, o.module, w),
  };
}

async function runSnapshot(
  kernel: WalkKernel,
  ctx: WalkerStepContext,
  module: string,
  w: ModuleWindow,
) {
  const { state, allowOwned, runDir, ph } = ctx.opts;
  const outPath = join(runDir, `${ENUMERATOR}-${module}-${stateTag(state)}-walk.json`);
  const done = await ctx.call("uia-read", () =>
    kernel({
      pid: ctx.pid,
      className: w.className,
      titlePattern: w.titlePattern,
      allowOwned,
      bounds: L01_BOUNDS,
      outPath,
      ph,
    }),
  );
  if (done.text === null)
    throw new StopBattery(
      "stopped",
      `the walk returned no document: ${done.summary.reason ?? "unknown"}${done.stderr?.trim() ? ` (${done.stderr.trim().slice(0, 300)})` : ""}`,
    );
  let doc: WalkDoc;
  try {
    doc = JSON.parse(done.text) as WalkDoc;
  } catch {
    throw new StopBattery("stopped", "the walk document is not JSON");
  }
  if (doc.refused === true || !doc.tree)
    throw new StopBattery(
      "stopped",
      `the walker refused the target: ${doc.reason ?? "no reason given"}`,
    );
  const sha256 = createHash("sha256").update(done.text, "utf-8").digest("hex");
  const { lines, stats } = snapshotLines(doc, { module, state, sha256, allowOwned });
  ctx.emit(lines);
  const kinds = Object.entries(stats.byKind)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const summary =
    `${stats.nodes} nodes -> ${stats.rows} rows (${kinds}); dismissed ${stats.dismissed}, folded ${stats.folded}, ` +
    `deferred ${stats.deferred.length}, out of scope ${stats.outOfScope}, data items skipped ${stats.dataItemsSkipped}, ` +
    `sampled containers ${stats.sampledContainers.length}, children_count on ${stats.childrenCounted}` +
    `${stats.incomplete ? `; INCOMPLETE walk (${doc.stop_reason ?? "partial"})` : ""}`;
  return {
    status:
      lines.length === 0
        ? ("fail" as const)
        : stats.incomplete
          ? ("observed" as const)
          : ("pass" as const),
    summary,
    artifacts: [{ path: outPath, sha256 }],
  };
}

// ── The walker ───────────────────────────────────────────────────────────────

export function makeL01Def(kernel: WalkKernel = realWalkKernel): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    script: SCRIPT,
    session: SESSION,
    defaultModule: "WorldEditor",
    steps: ({ module, state, allowOwned }) => [snapshotStep(kernel, { module, state, allowOwned })],
  };
}

export const def: WalkerDef = makeL01Def();

if (isMainModule(import.meta.url)) {
  runWalker(def, process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(2);
    },
  );
}
