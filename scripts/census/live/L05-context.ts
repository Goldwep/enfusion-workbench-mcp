/**
 * L05, the context-menu walker of the Phase 4 live census (design
 * `docs/v2/design/phase4-live-census.md` sections 2.2 and 4, plan 4.5 L05).
 *
 * Targets are never written here. They come from policy `live_lane.uia_context.targets` (main
 * writes them), filtered to the module and state of the run. What this script derives
 * mechanically is the PROPOSAL main copies into the policy:
 *
 *   npx --no tsx scripts/census/live/L05-context.ts --propose <L01 walk.json> --module <M>
 *       [--propose-out <file>]
 *
 * reads one passive walk of the module window and proposes, per the plan's rule ("targets derived
 * mechanically from the file-type list and entity kinds"):
 *   - file-type targets: each Resource Browser ListItem or TreeItem whose name ends in an E09
 *     extension (`data/census/observations/E09/<build>.jsonl`, rows with a module other than
 *     "none"), the first item per extension; extensions with no visible item are listed as missing;
 *   - entity targets: each named TreeItem of the Hierarchy dock, the first per distinct name
 *     (the entity class is a grid column UIA does not name; distinct names stand in for kinds,
 *     [unverified] that they separate kinds).
 *
 * Steps (one per policy target of the run's module and state):
 *   p4-l05-probe       the FIRST target only: ShowContextMenu, a passive read of the popup, Collapse.
 *                      If no popup appears the step stops the block (exit 3) and records why: L05
 *                      then falls back to the owner's right-click and a passive read (sf-15 route).
 *   p4-l05-t<nn>-...   every further target, the same three calls; each refuses to start unless the
 *                      probe's record in this run folder says `pass`.
 * Plan per step: one `uia-context` (calls ShowContextMenu, Collapse) and one `uia-read` of the
 * popup window (`Qt683QWindowPopupDropShadowSaveBits`). The read is declared for the checker but
 * happens inside the same context.py process (no second call); context.py caps it at its own
 * max_items (200) with no time budget, so POPUP_BOUNDS is the declared ceiling, not what it enforces. No invoke, no key, no typing; the popup
 * pair is benign (`popups: true`), any other new window stops and a dialog-like one hands off.
 *
 * Lines: one `context-menu` per popup (key: the target's label path; parent: the L01 row of the
 * target's container, L01_TARGET_CONTAINERS, else the target's `control` row) and one `context-item` per MenuItem (key: target path + item label, or
 * `@QWidgetAction.<n>` for an unnamed one); Separators are not rows. Every line carries the D8
 * projection of the run's state (common.ts stateFor; `{}` for a kind the matrix declares no axes for). `children_count` only when every item was emitted.
 *
 * Kernel: tools/uia/context.ts / context.py (ShowContextMenu, a passive popup read, ExpandCollapse
 * Collapse on the popup; never a key, never Invoke). Unsupported or no popup: the probe stops.
 *
 * `--passive` (the sf-15 route, for a surface that does not answer ShowContextMenu: the Resource
 * Browser on 1.9.0.37, session 021): the step table becomes one HAND step per target,
 *   p4-l05-hand-<nn>-...  the script prints "OWNER: right-click <target> now"; context.py
 *                         `--passive` sends nothing and waits up to PASSIVE_TIMEOUT_MS for one popup
 *                         of the pid, reads it as the active path does (no sub-menu expanded); the
 *                         same `context-menu` / `context-item` lines are written, each carrying
 *                         OPENED_BY_HAND in `unverified` (the observation schema is strict: no
 *                         `opened_by` field); then "OWNER: press Esc once now" and the step waits up
 *                         to ESC_WAIT_MS for the popup to be gone (window list only; still open is a
 *                         HANDOFF, the lines already committed). No probe gate (nothing is sent).
 *                         Plan: one `uia-read` of the popup window, no `uia-context`.
 *   npx --no tsx scripts/census/live/L05-context.ts --passive --module <M> --state <s> --really
 *       --id <lane> --sandbox <dir> --run-dir <dir> --only p4-l05-hand-<nn>-<slug>
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANE_RECORDED_PID, uiaContextCaps, type PlanAction } from "../../live/dry-run.js";
import { REPO_ROOT, artifactsDir, defaultPlaceholderContext } from "../../live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../live/policy.js";
import {
  DEFAULT_BOUNDS,
  REDACT_ENV,
  buildActionPlan,
  redactionTable,
} from "../../../tools/uia/walk.js";
import {
  CONTEXT_PLAN_VERDICT_ENV,
  DEFAULT_PASSIVE_TIMEOUT_MS,
  KILL_GRACE_MS,
  OVERHEAD_MS,
  contextFileName,
  runContext,
  type ContextDoc,
  type LiveName,
} from "../../../tools/uia/context.js";
import {
  EDITOR_WINDOW_CLASS,
  EXIT,
  MODULE_TITLES,
  POPUP_WINDOW_CLASS,
  StopBattery,
  chooseKey,
  isMainModule,
  kindOf,
  normalizeLabel,
  parseState,
  runWalker,
  stateTag,
  stateFor,
  walkerRecordPath,
  type LiveObservation,
  type ObservedState,
  type RunWalkerOverrides,
  type WalkerDef,
  type WalkerOptions,
  type WalkerStep,
  type WalkerStepContext,
} from "./common.js";

export const ENUMERATOR = "L05";
export const SCRIPT = "scripts/census/live/L05-context.ts";
export const PROBE_ID = "p4-l05-probe";
/** Step id prefix of the passive (hand-opened) steps. */
export const HAND_PREFIX = "p4-l05-hand";
/** How long a passive step waits for the hand's right-click (context.py `--passive`). */
export const PASSIVE_TIMEOUT_MS = DEFAULT_PASSIVE_TIMEOUT_MS;
/** How long a passive step waits, after the read, for the hand's Esc to close the popup. */
export const ESC_WAIT_MS = 60_000;
export const ESC_POLL_MS = 1_000;
/** The mark every line of a hand-opened popup carries (the observation schema has no field). */
export const OPENED_BY_HAND =
  "opened_by: hand (the owner's right-click; read passively, no ShowContextMenu)";
/** The popup's own title (sf-15 walk: `Qt683QWindowPopupDropShadowSaveBits`, "Arma Reforger Workbench"). */
export const POPUP_TITLE_PATTERN = "^Arma Reforger Workbench$";
/** Docks whose items are targets (design 3.1 step 3). */
export const HIERARCHY_DOCK = "Hierarchy";
export const RESOURCE_DOCK = "Resource Browser";

/**
 * Module window title patterns: common.ts MODULE_TITLES (one table for every walker; walker.py
 * full-matches). ParticleEditor is absent there on purpose: it is never read (DEC-042), so a run
 * naming it plans no step.
 */
export function moduleTitlePattern(module: string): string | undefined {
  return module === "ParticleEditor" ? undefined : MODULE_TITLES[module]?.pattern;
}

/** Bounds of the popup read: a menu is one level deep (sf-15: 19 nodes, depth 1). */
export const POPUP_BOUNDS = { ...DEFAULT_BOUNDS, maxDepth: 4, maxNodes: 500, budgetMs: 15_000 };

// ── Targets ─────────────────────────────────────────────────────────────────

export interface ContextTarget {
  module?: string;
  path: string[];
}

/** E09 file-type rows: extension and owning module (rows of module "none" are dropped). */
export function e09Extensions(path?: string): Map<string, string> {
  const p =
    path ??
    join(
      REPO_ROOT,
      "data",
      "census",
      "observations",
      "E09",
      `${(JSON.parse(readFileSync(join(REPO_ROOT, "data", "census", "current-build.json"), "utf-8")) as { tag: string }).tag}.jsonl`,
    );
  const out = new Map<string, string>();
  for (const l of readFileSync(p, "utf-8").split(/\r?\n/)) {
    if (!l.trim()) continue;
    const o = JSON.parse(l) as { $header?: unknown; key?: { ext?: string }; module?: string };
    if (o.$header !== undefined || !o.key?.ext || !o.module || o.module === "none") continue;
    out.set(o.key.ext.toLowerCase(), o.module);
  }
  return out;
}

/** The extension of a label (`foo.conf` -> `conf`), lower case, or null. */
export function extOf(label: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(label.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * The policy targets this run walks: the module's entries (an entry without a module applies to
 * every module), and when the state names a `resource_type` only targets whose last label has that
 * extension. ParticleEditor and modules without a title pattern get none.
 */
export function targetsFor(
  policy: CensusPolicy,
  module: string,
  state: ObservedState,
): ContextTarget[] {
  if (!moduleTitlePattern(module)) return [];
  const caps = uiaContextCaps(policy);
  if (!caps) return [];
  return caps.targets.filter((t) => {
    if (t.module !== undefined && t.module !== module) return false;
    if (state.resource_type !== undefined)
      return extOf(t.path[t.path.length - 1]) === state.resource_type.toLowerCase();
    return true;
  });
}

/** The context-menu line's note for a step matched by the Hierarchy dirty marker. */
export function liveNameNote(n: LiveName): string {
  return `live name "${n.live}" at path step ${n.step}: the Hierarchy row of an unsaved world carries a trailing "*"; keyed by the census name "${n.census}"`;
}

/**
 * Whether a policy target exists in a walk of the module window, by context.py's resolve_target
 * rule loosely (any match per step, not a unique one: the kernel still refuses an ambiguous step):
 * a plain label matches a descendant by Name, `@<Class>.<n>` the n-th descendant of that class
 * (breadth-first), and under the Hierarchy dock a later step also matches its name plus one
 * trailing `*` (the dirty marker of an unsaved world, P4-5).
 */
export function targetInWalk(walk: WalkNode, path: readonly string[]): boolean {
  const below = (n: WalkNode): WalkNode[] => {
    const out: WalkNode[] = [];
    let level = n.children ?? [];
    while (level.length) {
      out.push(...level);
      level = level.flatMap((c) => c.children ?? []);
    }
    return out;
  };
  let scope: WalkNode[] = [walk];
  for (let i = 0; i < path.length; i++) {
    const label = path[i];
    const cls = /^@(.+)\.(\d+)$/.exec(label);
    const next: WalkNode[] = [];
    for (const s of scope) {
      const all = below(s);
      if (cls) {
        const hit = all.filter((c) => c.className === cls[1])[Number(cls[2]) - 1];
        if (hit) next.push(hit);
        continue;
      }
      let hits = all.filter((c) => (c.name ?? "") === label);
      if (!hits.length && i > 0 && path[0] === HIERARCHY_DOCK)
        hits = all.filter((c) => (c.name ?? "") === `${label}*`);
      next.push(...hits);
    }
    if (!next.length) return false;
    scope = next;
  }
  return true;
}

/** The L01 walk of this run's module and state in the run folder (`e-03` writes it before L05). */
export function runWalkPath(runDir: string, module: string, state: ObservedState): string {
  return join(runDir, `L01-${module}-${stateTag(state)}-walk.json`);
}

/** A walk node as tools/uia/walker.py writes it (fields L05 reads). */
export interface WalkNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  enabled?: boolean;
  acceleratorKey?: string;
  children?: WalkNode[];
}

export interface Proposal {
  module: string;
  targets: Array<ContextTarget & { source: "file-type" | "entity"; resource_type?: string }>;
  missing_file_types: string[];
  unnamed_entities: number;
}

/** The proposal (module header): file-type targets from E09, entity targets from the Hierarchy. */
export function deriveTargets(walk: WalkNode, module: string, exts: Map<string, string>): Proposal {
  const out: Proposal = { module, targets: [], missing_file_types: [], unnamed_entities: 0 };
  const docks: Array<{ name: string; node: WalkNode }> = [];
  const findDocks = (n: WalkNode): void => {
    if (n.controlType === "Window" && n.className === "QDockWidget")
      docks.push({ name: n.name ?? "", node: n });
    for (const c of n.children ?? []) findDocks(c);
  };
  findDocks(walk);
  const items = (n: WalkNode, types: string[], acc: WalkNode[] = []): WalkNode[] => {
    if (types.includes(n.controlType)) acc.push(n);
    for (const c of n.children ?? []) items(c, types, acc);
    return acc;
  };
  const seenExt = new Set<string>();
  for (const d of docks.filter((x) => x.name === RESOURCE_DOCK))
    for (const it of items(d.node, ["ListItem", "TreeItem"])) {
      const name = it.name ?? "";
      const ext = extOf(name);
      if (!ext || !exts.has(ext) || seenExt.has(ext)) continue;
      seenExt.add(ext);
      out.targets.push({
        module,
        path: [RESOURCE_DOCK, name],
        source: "file-type",
        resource_type: ext,
      });
    }
  out.missing_file_types = [...exts.keys()].filter((e) => !seenExt.has(e)).sort();
  const seenName = new Set<string>();
  for (const d of docks.filter((x) => x.name === HIERARCHY_DOCK))
    for (const it of items(d.node, ["TreeItem"])) {
      const name = (it.name ?? "").trim();
      if (!name) {
        out.unnamed_entities++;
        continue;
      }
      if (seenName.has(name)) continue;
      seenName.add(name);
      out.targets.push({ module, path: [HIERARCHY_DOCK, name], source: "entity" });
    }
  return out;
}

// ── The kernel ──────────────────────────────────────────────────────────────

export interface PopupRead {
  /** The popup's root node (a `Window` of uiaClassName QMenu in sf-15), or null when none. */
  tree: WalkNode | null;
  /** The walk JSON written to the artifacts folder. */
  artifact: { path: string; sha256: string } | null;
}

/** What L05 sends: ShowContextMenu on one target, a passive read of the popup, Collapse. */
export interface ContextKernel {
  show: (
    pid: number,
    window: { className: string; titlePattern: string },
    path: string[],
    timeoutMs: number,
  ) => Promise<{ answered: boolean; detail: string; liveNames?: LiveName[] }>;
  readPopup: (pid: number) => Promise<PopupRead>;
  collapse: (pid: number) => Promise<{ leftOpen: boolean; detail: string }>;
  /**
   * The sf-15 route: send nothing, wait up to `timeoutMs` for the popup the hand opened, read it.
   * `tree` null: no popup came (`detail` says why). Throws on a refusal or a stop.
   */
  readPassive?: (
    pid: number,
    window: { className: string; titlePattern: string },
    path: string[],
    timeoutMs: number,
  ) => Promise<PopupRead & { detail: string; presentAtStart?: boolean }>;
}

/** How the real kernel runs tools/uia/context.py (tests pass the fake provider). */
export interface KernelRoute {
  provider: "uia" | "fake";
  fakeTree?: string;
  /** Where the redacted popup document goes (default: the artifacts folder's `uia`). */
  outDir?: string;
  python?: string;
}

/** The popup document as the WalkNode popupLines reads: the popup root, its items as children. */
export function popupTreeOf(doc: ContextDoc): WalkNode | null {
  if (!doc.popup) return null;
  return {
    controlType: doc.popup.controlType ?? "Window",
    ...(doc.popup.name ? { name: doc.popup.name } : {}),
    ...(doc.popup.automationId ? { automationId: doc.popup.automationId } : {}),
    ...(doc.popup.uiaClassName ? { className: doc.popup.uiaClassName } : {}),
    children: (doc.items ?? []).map((i) => ({
      controlType: i.controlType ?? "",
      ...(i.name ? { name: i.name } : {}),
      ...(i.automationId ? { automationId: i.automationId } : {}),
      ...(i.className ? { className: i.className } : {}),
      ...(typeof i.enabled === "boolean" ? { enabled: i.enabled } : {}),
      ...(i.acceleratorKey ? { acceleratorKey: i.acceleratorKey } : {}),
    })),
  };
}

/**
 * The real kernel: `show` runs tools/uia/context.py once (ShowContextMenu, the passive popup read,
 * Collapse on the popup, all in one process); `readPopup` and `collapse` hand back what that run
 * recorded. runWalker has already applied the live gate, the lease and the step's checkPlan; the
 * plan verdict is passed to context.py only for the uia route.
 */
export function makeRealKernel(route: KernelRoute = { provider: "uia" }): ContextKernel {
  let last: { doc: ContextDoc | null; out: string | null; sha256: string | null } | null = null;
  const take = () => {
    if (!last) throw new Error("the context kernel was asked for a result before ShowContextMenu");
    return last;
  };
  const run = async (
    pid: number,
    window: { className: string; titlePattern: string },
    path: string[],
    timeoutMs: number,
    passive: boolean,
  ) => {
    const ctx = defaultPlaceholderContext();
    const table = redactionTable(ctx, undefined, process.env);
    const env: Record<string, string> = { [REDACT_ENV]: JSON.stringify(table) };
    if (route.provider === "uia") env[CONTEXT_PLAN_VERDICT_ENV] = "PASS";
    const outPath = join(
      route.outDir ?? join(artifactsDir(), "uia"),
      contextFileName(`L05-${passive ? "hand-" : ""}${route.provider}`),
    );
    return runContext({
      options: {
        pid,
        className: window.className,
        title: window.titlePattern,
        path,
        timeoutMs,
        fakeTree: route.fakeTree,
        really: true,
        ...(passive ? { passive: true } : {}),
      },
      provider: route.provider,
      env,
      outPath,
      ctx,
      table,
      python: route.python,
    });
  };
  return {
    readPassive: async (pid, window, path, timeoutMs) => {
      const r = await run(pid, window, path, timeoutMs, true);
      const d = r.doc;
      if (!d) throw new Error(`context kernel (passive): ${r.stderr || "no document"}`);
      if (d.result !== "ok" && d.result !== "no-popup")
        throw new Error(
          `context kernel (passive) ${d.result ?? "no result"}: ${d.reason ?? "no reason"}${d.handoff ? `; ${d.handoff}` : ""}`,
        );
      const tree = d.result === "ok" ? popupTreeOf(d) : null;
      return {
        tree,
        artifact:
          tree && r.summary.out && r.sha256 ? { path: r.summary.out, sha256: r.sha256 } : null,
        detail: d.reason ?? (tree ? "read" : "no popup"),
        presentAtStart: d.popupPresentAtStart,
      };
    },
    show: async (pid, window, path, timeoutMs) => {
      last = null;
      const r = await run(pid, window, path, timeoutMs, false);
      last = { doc: r.doc, out: r.summary.out, sha256: r.sha256 };
      const d = r.doc;
      if (!d) throw new Error(`context kernel: ${r.stderr || "no document"}`);
      if (d.result === "stopped" || d.result === "refused" || d.result === "refused-auth-window")
        throw new Error(`context kernel ${d.result}: ${d.reason ?? "no reason"}`);
      if (d.supported === false)
        return { answered: false, detail: `supported:false (${d.reason ?? "unsupported"})` };
      if (!d.popup) return { answered: false, detail: d.reason ?? "no popup" };
      const liveNames = d.target?.liveNames;
      return {
        answered: true,
        detail: `${d.result}; selectionChanged ${String(d.selectionChanged ?? "unknown")}`,
        ...(liveNames?.length ? { liveNames } : {}),
      };
    },
    readPopup: async () => {
      const l = take();
      const tree = l.doc ? popupTreeOf(l.doc) : null;
      return {
        tree,
        artifact: tree && l.out && l.sha256 ? { path: l.out, sha256: l.sha256 } : null,
      };
    },
    collapse: async () => {
      const l = take();
      return {
        leftOpen: Boolean(l.doc?.leftOpen),
        detail:
          l.doc?.collapseSkipped ?? (l.doc?.leftOpen ? "Collapse did not close it" : "collapsed"),
      };
    },
  };
}

export const realKernel: ContextKernel = makeRealKernel();

// ── Lines ───────────────────────────────────────────────────────────────────

/**
 * The L01 row a context menu hangs under (P4-FIX-K). L01 emits no world-data rows (Hierarchy
 * entries, Resource Browser tiles; docs/v2/inbox/P4-L01.HANDOFF.md), so a target inside one of
 * these containers is parented under the container as L01 keys it and the target's own label goes
 * to `unverified[]`. Keys copied from data/census/observations/L01/1.8.0.13.jsonl.
 */
export const L01_TARGET_CONTAINERS: Record<
  string,
  Record<string, { kind: string; key: Record<string, unknown>; what: string }>
> = {
  WorldEditor: {
    [HIERARCHY_DOCK]: {
      kind: "control",
      key: { object_name: "entityTree" },
      what: "the Hierarchy tree",
    },
    [RESOURCE_DOCK]: {
      kind: "control",
      key: { path: ["resourcesDock", "resourceBrowserDockContents", "@ResourceListView.1"] },
      what: "the Resource Browser item view",
    },
    Viewport: {
      kind: "region",
      key: { path: ["@WorldRenderWindowQt.1"] },
      what: "the render window",
    },
  },
};

/** The menu's parent: the L01 container of the target's dock when known, else a control keyed by the target path. */
export function menuParent(
  target: ContextTarget,
  module: string,
): { parent_key: LiveObservation["parent_key"]; note: string } {
  const c = L01_TARGET_CONTAINERS[module]?.[target.path[0] ?? ""];
  if (!c)
    return {
      parent_key: { dim: "ui", kind: "control", module, key: { path: [...target.path] } },
      note: "parent_key assumes L01 keys the target as [dock, item label]",
    };
  const leaf = target.path.length > 1 ? target.path.slice(1).join(" > ") : null;
  return {
    parent_key: { dim: "ui", kind: c.kind, module, key: c.key } as LiveObservation["parent_key"],
    note: leaf
      ? `target "${leaf}" inside ${c.what}; L01 emits no row for it, so the menu hangs under ${c.what}`
      : `target: ${c.what}`,
  };
}

/** The context-menu line and its item lines from one popup read. */
export function popupLines(
  tree: WalkNode,
  target: ContextTarget,
  module: string,
  state: ObservedState,
  sha256: string,
  how: { openedBy?: "hand" } = {},
): { lines: LiveObservation[]; items: number; separators: number; skipped: number } {
  const handNote = how.openedBy === "hand" ? [OPENED_BY_HAND] : [];
  // Fragments into the context document (tools/uia/context.py: `popup`, `items[]`), not a walk tree.
  const ref = (p: string): string => `artifact:${sha256}#${p}`;
  // D8: each kind carries the axes state-matrix.json declares for it ({} where none).
  const itemState = stateFor(module, "context-item", state);
  const menuState = stateFor(module, "context-menu", state);
  const menuKey = { path: [...target.path] };
  const kids = tree.children ?? [];
  const lines: LiveObservation[] = [];
  let separators = 0;
  let skipped = 0;
  const unnamedByClass = new Map<string, number>();
  const seen = new Set<string>();
  kids.forEach((c, i) => {
    if (c.controlType === "Separator") {
      separators++;
      return;
    }
    const v = kindOf({ controlType: c.controlType, className: c.className, inContextPopup: true });
    if (!("kind" in v) || v.kind !== "context-item") {
      skipped++;
      return;
    }
    const raw = c.name ?? "";
    const [labelPart, afterTab] = raw.split("\t");
    let ord: number | undefined;
    if (!labelPart.trim()) {
      const cls = c.className ?? "unknown";
      ord = (unnamedByClass.get(cls) ?? 0) + 1;
      unnamedByClass.set(cls, ord);
    }
    const id = chooseKey(
      {
        automationId: c.automationId,
        className: c.className,
        ancestorLabels: [...target.path],
        name: labelPart,
        unnamedOrdinal: ord,
      },
      () => false,
    );
    const k = JSON.stringify(id.key);
    if (seen.has(k)) {
      skipped++;
      return;
    }
    seen.add(k);
    const unverified = [...(id.unverified ?? [])];
    if (c.enabled === false) unverified.push("disabled when read");
    unverified.push(...handNote);
    const shortcut = (c.acceleratorKey ?? "").trim() || (afterTab ?? "").trim();
    lines.push({
      dim: "ui",
      kind: "context-item",
      module,
      key: id.key,
      parent_key: { dim: "ui", kind: "context-menu", module, key: menuKey },
      origin: "vanilla",
      ...(labelPart.trim() ? { label: normalizeLabel(labelPart), label_raw: labelPart } : {}),
      ...(shortcut ? { shortcut_default: shortcut } : {}),
      locator: {
        ...(c.automationId ? { automationId: c.automationId } : {}),
        controlType: c.controlType,
        windowClass: POPUP_WINDOW_CLASS,
      },
      observed_state: itemState,
      ref: ref(`items/${i}`),
      confidence: id.confidence ?? "high",
      ...(unverified.length ? { unverified } : {}),
    });
  });
  const parent = menuParent(target, module);
  const menu: LiveObservation = {
    dim: "ui",
    kind: "context-menu",
    module,
    key: menuKey,
    parent_key: parent.parent_key,
    origin: "vanilla",
    locator: {
      ...(tree.automationId ? { automationId: tree.automationId } : {}),
      controlType: tree.controlType,
      windowClass: POPUP_WINDOW_CLASS,
    },
    observed_state: menuState,
    ...(skipped === 0 ? { children_count: lines.length } : {}),
    modal: "none",
    ref: ref("popup"),
    confidence: "high",
    unverified: [
      parent.note,
      ...(separators ? [`${separators} separator(s) are not rows`] : []),
      ...handNote,
    ],
  };
  return { lines: [menu, ...lines], items: lines.length, separators, skipped };
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** `p4-l05-t03-hierarchy-default` (lower-case label slug, at most 40 characters). */
export function stepId(index: number, target: ContextTarget): string {
  if (index === 0) return PROBE_ID;
  const slug = target.path
    .map((p) => normalizeLabel(p))
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `p4-l05-t${String(index).padStart(2, "0")}-${slug || "target"}`;
}

export interface L05Env {
  kernel: ContextKernel;
  /** Read a file of the run folder (the probe's record), or null when absent. */
  readText: (path: string) => string | null;
}

export const realEnv: L05Env = {
  kernel: realKernel,
  readText: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
};

function contextPlan(
  module: string,
  target: ContextTarget,
  timeoutMs: number,
  titlePattern: string,
): PlanAction[] {
  return [
    {
      kind: "uia-context",
      module,
      target: {
        pid: LANE_RECORDED_PID,
        window: { className: EDITOR_WINDOW_CLASS, titlePattern },
        path: [...target.path],
      } as unknown as PlanAction["target"],
      calls: ["ShowContextMenu", "Collapse"],
      timeoutMs,
    },
    ...buildActionPlan(
      {
        pid: LANE_RECORDED_PID as unknown as number,
        className: POPUP_WINDOW_CLASS,
        titlePattern: POPUP_TITLE_PATTERN,
        allowOwned: false,
      },
      POPUP_BOUNDS,
      "raw",
    ),
  ];
}

async function runTarget(
  ctx: WalkerStepContext,
  env: L05Env,
  target: ContextTarget,
  titlePattern: string,
  timeoutMs: number,
  probe: boolean,
): Promise<{
  status: "pass";
  summary: string;
  artifacts: Array<{ path: string; sha256: string }>;
}> {
  if (!probe) {
    const text = env.readText(walkerRecordPath(ctx.opts.runDir, PROBE_ID));
    const status = text ? (JSON.parse(text) as { status?: string }).status : undefined;
    if (status !== "pass")
      throw new StopBattery(
        "stopped",
        `the probe ${PROBE_ID} has no pass record in this run folder (${status ?? "none"}): no target is shown before ShowContextMenu is proven`,
      );
  }
  const window = { className: EDITOR_WINDOW_CLASS, titlePattern };
  const shown = await ctx.call("ShowContextMenu", () =>
    env.kernel.show(ctx.pid, window, target.path, timeoutMs),
  );
  if (!shown.answered)
    throw new StopBattery(
      "stopped",
      `no context menu appeared on "${target.path.join(" > ")}" (${shown.detail}): ShowContextMenu is not answered; L05 falls back to the owner's right-click and a passive read (sf-15 route)`,
    );
  const read = await ctx.call("uia-read popup", () => env.kernel.readPopup(ctx.pid));
  const closed = await ctx.call("Collapse", () => env.kernel.collapse(ctx.pid));
  if (!read.tree || !read.artifact) {
    if (closed.leftOpen)
      throw new StopBattery(
        "handoff",
        `the popup is still open after Collapse (${closed.detail}): the owner presses Esc once, by hand`,
      );
    throw new StopBattery(
      "stopped",
      `ShowContextMenu was answered on "${target.path.join(" > ")}" but no popup was read (${shown.detail})`,
    );
  }
  const r = popupLines(read.tree, target, ctx.opts.module, ctx.opts.state, read.artifact.sha256);
  // The census key stays the policy path; the live name the kernel matched is recorded (P4-5).
  for (const n of shown.liveNames ?? []) r.lines[0].unverified?.push(liveNameNote(n));
  ctx.emit(r.lines);
  if (closed.leftOpen)
    throw new StopBattery(
      "handoff",
      `the popup is still open after Collapse (${closed.detail}): the owner presses Esc once, by hand`,
    );
  return {
    status: "pass",
    summary: `${target.path.join(" > ")}: 1 context-menu, ${r.items} item(s), ${r.separators} separator(s), ${r.skipped} skipped`,
    artifacts: [read.artifact],
  };
}

// ── Passive steps (the sf-15 route) ─────────────────────────────────────────

/** `p4-l05-hand-03-resource-browser-foo-layout`: every target, numbered from 00. */
export function handStepId(index: number, target: ContextTarget): string {
  return stepId(index + 1, target).replace(
    /^p4-l05-t\d+/,
    `${HAND_PREFIX}-${String(index).padStart(2, "0")}`,
  );
}

/** The plan of a passive step: one read of the popup window, nothing sent. */
export function handPlan(): PlanAction[] {
  return buildActionPlan(
    {
      pid: LANE_RECORDED_PID as unknown as number,
      className: POPUP_WINDOW_CLASS,
      titlePattern: POPUP_TITLE_PATTERN,
      allowOwned: false,
    },
    POPUP_BOUNDS,
    "raw",
  );
}

/**
 * After a passive read: ask for the hand's Esc and wait (window list only) until no popup of the
 * pid is up. True when it closed within `waitMs`.
 */
export async function awaitHandClose(
  ctx: WalkerStepContext,
  what: string,
  waitMs: number = ESC_WAIT_MS,
): Promise<boolean> {
  ctx.log(`OWNER: press Esc once now to close the context menu of ${what} (never a menu choice)`);
  const polls = Math.max(1, Math.ceil(waitMs / ESC_POLL_MS));
  for (let i = 0; i <= polls; i++) {
    const ws = await ctx.windows();
    // context.py's popup rule: `QWindowPopup` in the class, unowned.
    if (!ws.some((w) => w.pid === ctx.pid && w.owner === 0 && w.className.includes("QWindowPopup")))
      return true;
    if (i < polls) await ctx.sleep(ESC_POLL_MS);
  }
  return false;
}

async function runHandTarget(
  ctx: WalkerStepContext,
  env: L05Env,
  target: ContextTarget,
  titlePattern: string,
  timeoutMs: number,
): Promise<{
  status: "pass";
  summary: string;
  artifacts: Array<{ path: string; sha256: string }>;
}> {
  const what = `"${target.path.join(" > ")}"`;
  const read = env.kernel.readPassive;
  if (!read) throw new StopBattery("stopped", "this kernel has no passive read: nothing sent");
  ctx.log(
    `OWNER: right-click ${what} now (one right-click, no menu choice); the step waits up to ${Math.round(timeoutMs / 1000)} s for the popup and sends nothing`,
  );
  const window = { className: EDITOR_WINDOW_CLASS, titlePattern };
  const r = await ctx.call("uia-read popup (hand-opened)", () =>
    read(ctx.pid, window, target.path, timeoutMs),
  );
  if (!r.tree || !r.artifact)
    throw new StopBattery(
      "stopped",
      `no context menu was read on ${what} (${r.detail}): nothing was sent; the hand's right-click did not open a popup in time`,
    );
  const lines = popupLines(r.tree, target, ctx.opts.module, ctx.opts.state, r.artifact.sha256, {
    openedBy: "hand",
  });
  ctx.emit(lines.lines);
  // The read is whole: keep the lines even if the Esc does not come (the HANDOFF below).
  ctx.commit();
  const closed = await awaitHandClose(ctx, what);
  if (!closed)
    throw new StopBattery(
      "handoff",
      `read ${what} (${lines.items} item(s), opened_by hand), but the popup is still open after ${ESC_WAIT_MS / 1000} s: the owner presses Esc once, by hand`,
    );
  return {
    status: "pass",
    summary: `${target.path.join(" > ")}: opened_by hand${r.presentAtStart ? " (popup already up when the wait began)" : ""}; 1 context-menu, ${lines.items} item(s), ${lines.separators} separator(s), ${lines.skipped} skipped`,
    artifacts: [r.artifact],
  };
}

/** The passive step table: one hand step per target of the run's module and state. */
export function l05HandSteps(
  sel: Pick<WalkerOptions, "module" | "state" | "allowOwned">,
  policy: CensusPolicy,
  env: L05Env = realEnv,
): WalkerStep[] {
  const titlePattern = moduleTitlePattern(sel.module);
  if (!titlePattern || !uiaContextCaps(policy)) return [];
  return targetsFor(policy, sel.module, sel.state).map((t, i) => ({
    id: handStepId(i, t),
    title: `context menu of ${t.path.join(" > ")}, opened by the owner's right-click and read passively (sf-15 route)`,
    risk: "reversible",
    timeout_ms: PASSIVE_TIMEOUT_MS + ESC_WAIT_MS + OVERHEAD_MS + KILL_GRACE_MS,
    expected:
      "the owner right-clicks the target; one QMenu popup appears, is read passively (no call sent) and the owner's Esc closes it; context-menu and context-item lines marked opened_by hand",
    kill_criterion:
      "no popup within the wait (stop), several popups or a new window other than the popup pair (stop), a dialog-like window (handoff), the popup still open after the Esc wait (handoff)",
    side_effects: [
      "the owner's right-click may select the target (a hand action, not this tool's)",
    ],
    rollback: "the owner presses Esc once; nothing was sent by the tool",
    popups: true,
    plan: () => handPlan(),
    run: (ctx) => runHandTarget(ctx, env, t, titlePattern, PASSIVE_TIMEOUT_MS),
  }));
}

/**
 * The steps of one run: the probe on the first target, then one step per further target. With
 * `mode.walk` (the run's L01 walk), only the policy targets that exist in it are walked, in policy
 * order, so the probe goes to the first target the window shows (P4-5: the first policy target,
 * `Hierarchy > unnamed`, was not in the world and the probe refused).
 */
export function l05Steps(
  sel: Pick<WalkerOptions, "module" | "state" | "allowOwned">,
  policy: CensusPolicy,
  env: L05Env = realEnv,
  mode: { passive?: boolean; walk?: WalkNode } = {},
): WalkerStep[] {
  if (mode.passive) return l05HandSteps(sel, policy, env);
  const titlePattern = moduleTitlePattern(sel.module);
  const caps = uiaContextCaps(policy);
  if (!titlePattern || !caps) return [];
  const timeoutMs = caps.perTargetMs;
  const walk = mode.walk;
  const targets = targetsFor(policy, sel.module, sel.state).filter(
    (t) => !walk || targetInWalk(walk, t.path),
  );
  return targets.map((t, i) => ({
    id: stepId(i, t),
    title:
      i === 0
        ? `probe: does Qt answer ShowContextMenu? one target, ${t.path.join(" > ")}`
        : `context menu of ${t.path.join(" > ")}`,
    risk: "reversible",
    timeout_ms: timeoutMs + OVERHEAD_MS + KILL_GRACE_MS,
    expected:
      "a QMenu popup appears, is read passively and collapses; context-menu and context-item lines",
    kill_criterion:
      "no popup (the block stops), a new window other than the popup pair (stop), a dialog-like window (handoff), the popup open after Collapse (handoff)",
    side_effects: [
      "a popup opens and closes; whether ShowContextMenu also selects the target is [unverified]",
    ],
    rollback: "Collapse; a popup left open is the owner's Esc by hand",
    popups: true,
    plan: () => contextPlan(sel.module, t, timeoutMs, titlePattern),
    run: (ctx) => runTarget(ctx, env, t, titlePattern, timeoutMs, i === 0),
  }));
}

export function l05Def(
  policy: CensusPolicy = loadPolicy(),
  env: L05Env = realEnv,
  mode: { passive?: boolean; walk?: WalkNode } = {},
): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    script: SCRIPT,
    session: "P4-1",
    defaultModule: "WorldEditor",
    steps: (sel) => l05Steps(sel, policy, env, mode),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/** Remove `--name <value>` from argv; returns the value. */
function takeOpt(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}

/**
 * `--propose <walk> [--propose-out <file>]` writes the target proposal; otherwise the walker CLI
 * (`runWalker`) with an optional `--policy <file>` (a scratch policy for a dry run).
 */
export async function main(
  argvIn: string[],
  over: RunWalkerOverrides & { env?: L05Env; e09Path?: string } = {},
): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const argv = [...argvIn];
  const propose = takeOpt(argv, "propose");
  const proposeOut = takeOpt(argv, "propose-out");
  const policyPath = takeOpt(argv, "policy");
  if (propose !== undefined) {
    const module = takeOpt(argv, "module") ?? "WorldEditor";
    if (!propose || argv.length) {
      say(`usage: --propose <walk.json> --module <M> [--propose-out <file>]`);
      return EXIT.usage;
    }
    const raw = readFileSync(propose, "utf-8");
    const doc = JSON.parse(raw) as { tree?: WalkNode };
    if (!doc.tree) {
      say(`${propose} has no tree`);
      return EXIT.usage;
    }
    const p = deriveTargets(doc.tree, module, e09Extensions(over.e09Path));
    const out = {
      $comment: `Proposed live_lane.uia_context.targets for ${module}, derived by ${SCRIPT} --propose from a walk (sha256 ${createHash("sha256").update(raw).digest("hex")}); main copies {module, path} into policy.json.`,
      ...p,
    };
    const text = JSON.stringify(out, null, 2) + "\n";
    if (proposeOut) writeFileSync(proposeOut, text, "utf-8");
    say(
      `${p.targets.length} target(s) proposed (${p.targets.filter((t) => t.source === "file-type").length} file-type, ${p.targets.filter((t) => t.source === "entity").length} entity); ${p.missing_file_types.length} file type(s) without a visible item; ${p.unnamed_entities} unnamed Hierarchy row(s)`,
    );
    return EXIT.done;
  }
  const passiveAt = argv.indexOf("--passive");
  if (passiveAt !== -1) argv.splice(passiveAt, 1);
  const policy = over.policy ?? loadPolicy(policyPath);
  const st = parseState(takeValue(argv, "state"));
  const module = takeValue(argv, "module") ?? "WorldEditor";
  // The run's L01 walk, when the run folder holds one: the probe takes the first policy target it
  // shows (P4-5). `--targets-walk <file>` names another walk.
  const walkArg = takeOpt(argv, "targets-walk");
  const runDir = takeValue(argv, "run-dir");
  const walkPath =
    walkArg ??
    (runDir && typeof st !== "string" ? runWalkPath(runDir, module, st) : undefined);
  let walk: WalkNode | undefined;
  if (walkPath && existsSync(walkPath)) {
    walk = (JSON.parse(readFileSync(walkPath, "utf-8")) as { tree?: WalkNode }).tree;
    if (walk && typeof st !== "string") {
      const absent = targetsFor(policy, module, st).filter((t) => !targetInWalk(walk!, t.path));
      say(
        `targets from the walk ${walkPath}: ${absent.length ? `not in it, not walked: ${absent.map((t) => t.path.join(" > ")).join("; ")}` : "every policy target is in it"}`,
      );
    }
  } else if (walkArg) {
    say(`${walkArg} does not exist`);
    return EXIT.usage;
  }
  const def = l05Def(policy, over.env ?? realEnv, { passive: passiveAt !== -1, walk });
  if (typeof st !== "string" && !def.steps({ module, state: st, allowOwned: false }).length)
    say(
      "note: no live_lane.uia_context target for this module and state; run --propose and let main list the targets",
    );
  return runWalker(def, argv, { ...over, policy });
}

/** The value of `--name` without removing it (runWalker parses it again). */
function takeValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
