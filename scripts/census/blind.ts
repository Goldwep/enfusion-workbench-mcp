/**
 * The blind exploration of plan 4.6 (Phase 4 exit; sitting P4-8): the independent test of
 * completeness. Three subcommands, all offline except `walk --really`:
 *
 *   draw   builds the SAMPLING FRAME blind of the ledger's item rows and draws from it, seeded:
 *            - menu       every title of policy `live_lane.uia_menu.titles_by_module` per walked module
 *                         (Launcher has no menu bar; ParticleEditor is never read, DEC-042);
 *            - submenu    the depth-1 sub-menus, named from the ledger's `menu` rows under a title that
 *                         a live walker read (the live read of the title reveals them anyway);
 *            - context-menu  the policy's `live_lane.uia_context.targets` of the module;
 *            - dialog     the ledger's `dialog` rows with a live (L<nn>) source; opened by the owner.
 *          A frame element is (container, live state). The live states are LIVE_STATES: the World
 *          Editor's edit/none, edit/layer, edit/entity (play is never drawn, DEC-055 ruling 2: its
 *          walks are void); every other module is read in the empty state P4-2/P4-3 used (`none`).
 *          The D8 projection (state-matrix.json `applies`) is applied at check time, not here, so a
 *          menu drawn in edit/layer tests whether the matrix is right to give menus no selection
 *          axis. Stratified by module (proportional to the module's frame size, floor FLOOR), then by
 *          kind (proportional), sampled without replacement (mulberry32, no clock). When `--n`
 *          exceeds the frame the whole frame is drawn and the shortfall is reported.
 *   walk   the live reader of the draws of one module and state (a walker on common.ts runWalker:
 *          the window watch, D13 stops, never-twice markers). Each step writes its raw document as
 *          `<run>/b-NNN-menus.json` (tools/uia/menus.ts, the title at depth 1, L02's reader and stop
 *          rules), `<run>/b-NNN-context.json` (tools/uia/context.py, L05's plan and stop rules, one
 *          target) or `<run>/b-NNN-walk.json` (walk.ts on the owner-opened dialog, L04's kernel; the
 *          step ends on a HANDOFF for the owner's Cancel). It emits NO observation line: the blind
 *          reads never feed the ledger they test.
 *   check  compares each read document with the ledger's child rows of the drawn container.
 *          An item live but absent from the ledger is an ESCAPE; a ledger child not seen live is a
 *          NOTE. Gate: the pooled DRAW escape rate (draws with at least one escape) against
 *          `--threshold` (default 0.02, the 98% claim; owner decision D5 pending). Item rates are
 *          reported beside it.
 *
 * Usage:
 *   npx --no tsx scripts/census/blind.ts draw --seed <int> --n 300 --out <plan.json>
 *   npx --no tsx scripts/census/blind.ts draw --list-frame
 *   npx --no tsx scripts/census/blind.ts check --draws <plan.json> --reads <sitting dir>
 *       --out <report.json> [--threshold 0.02]
 *   npx --no tsx scripts/census/blind.ts walk --draws <plan.json> [--really --id <lane>
 *       --sandbox <dir> --run-dir <dir> --module <M> --state <s> --only b-NNN]
 *       [--kinds menu,submenu] [--reuse-reads] [--passive]
 *   `--passive` reads each context draw through the sf-15 route (L05-context.ts `--passive`): the
 *   step prints "OWNER: right-click <target> now", context.py `--passive` sends nothing, reads the
 *   hand-opened popup into the same `b-NNN-context.json`, then asks for the owner's Esc and waits
 *   for the popup to go. Same draw ids, so the P4-8 queue is unchanged.
 *   walk without --only runs every step of the module and state in one process (the batch of
 *   DEC-057). `--kinds` keeps the draws of those kinds only (a batch leaves the dialog draws, which
 *   wait for the owner, and the context draws to their own steps). `--reuse-reads` sends one live
 *   read per menu title in the process: a later draw on the same title, in the same module, state
 *   and Workbench process, gets a byte copy of that read, listed in <run-dir>/reused-reads.jsonl.
 *   (draw and check also take --census-root <dir> and --policy <file>.)
 *
 * Exit: draw 0 / 2 usage; check 0 under the threshold, 1 over (or nothing read), 2 usage;
 * walk as every walker (common.ts EXIT).
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { censusPaths, loadLedger } from "../../src/census/ledger-io.js";
import { LANE_RECORDED_PID, uiaContextCaps, type PlanAction } from "../live/dry-run.js";
import { REPO_ROOT, defaultPlaceholderContext } from "../live/paths.js";
import { loadPolicy, type CensusPolicy } from "../live/policy.js";
import { isMainModule, parseArgs } from "../live/cli.js";
import { titlesFor } from "../../tools/uia/menus.js";
import {
  REDACT_ENV,
  redactionTable,
  type WalkBounds,
  DEFAULT_BOUNDS,
} from "../../tools/uia/walk.js";
import {
  CONTEXT_PLAN_VERDICT_ENV,
  runContext,
  type ContextDoc,
} from "../../tools/uia/context.js";
import {
  EDITOR_WINDOW_CLASS,
  EXIT,
  StopBattery,
  deriveId,
  normalizeLabel,
  parseState,
  projectState,
  runWalker,
  stateAxes,
  stateKey,
  stateTag,
  type ObservedState,
  type RunWalkerOverrides,
  type WalkerDef,
  type WalkerStep,
  type WalkerStepContext,
} from "./live/common.js";
import {
  MODULE_WINDOWS,
  NEVER_READ,
  menuLines,
  menusToolReader,
  stopFor,
  titlePlan,
  type MenuReader,
  type MenusDoc,
} from "./live/L02-menus.js";
import {
  LIST1,
  dialogLines,
  realKernel as l04RealKernel,
  type L04Kernel,
  type WalkDoc,
} from "./live/L04-dialogs.js";
import {
  ESC_WAIT_MS,
  PASSIVE_TIMEOUT_MS,
  awaitHandClose,
  handPlan,
  l05Steps,
  moduleTitlePattern,
  popupLines,
  popupTreeOf,
  realEnv as l05RealEnv,
  targetsFor,
} from "./live/L05-context.js";
import type { WindowInfo } from "../live/s-c-natives.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SCRIPT = "scripts/census/blind.ts";
/** The walker's enumerator tag (its records only; it emits no observation line). */
export const ENUMERATOR = "BLIND";
export const SESSION = "P4-8";
export const DRAWS_SCHEMA = "emcp-blind-draws/1";
export const REPORT_SCHEMA = "emcp-blind-report/1";
export const DEFAULT_THRESHOLD = 0.02;
export const THRESHOLD_NOTE =
  "0.02 is the plan's 98% claim [estimate]; the threshold is owner decision D5, PENDING";
/** The per-module floor of the stratified draw (main's ruling for P4-8). */
export const FLOOR = 10;

/** Walked modules in the design's order (D15); Launcher has no menu bar; ParticleEditor never read. */
export const MODULE_ORDER = [
  "WorldEditor",
  "ResourceManager",
  "ScriptEditor",
  "LocalizationEditor",
  "AnimEditor",
  "BehaviorEditor",
  "AudioEditor",
  "ProcAnimEditor",
] as const;

/**
 * The states each module is read in live (`--state` syntax). World Editor: the three edit states
 * of the throwaway world (none right after the open; layer by the owner's click on the `default`
 * layer, as the P4-1 remainder; entity by p4-5's create and select); play is never drawn
 * (DEC-055 ruling 2). Every other module: the empty state P4-2 and P4-3 walked (`--state none`);
 * ScriptEditor's `script_debug` axis is not reached by any sitting.
 */
export const LIVE_STATES: Readonly<Record<string, readonly string[]>> = {
  WorldEditor: [
    "mode=edit,selection=none",
    "mode=edit,selection=layer",
    "mode=edit,selection=entity",
  ],
};
export const DEFAULT_LIVE_STATE = "none";
export function liveStates(module: string): readonly string[] {
  return LIVE_STATES[module] ?? [DEFAULT_LIVE_STATE];
}

export type DrawKind = "menu" | "submenu" | "dialog" | "context-menu";
/** Run order inside one module and state: context last (ShowContextMenu may move the selection). */
export const KIND_ORDER: readonly DrawKind[] = ["menu", "submenu", "dialog", "context-menu"];
/** The enumerator that should have caught an escape of each kind. */
export const CANDIDATES: Readonly<Record<DrawKind, string[]>> = {
  menu: ["L02"],
  submenu: ["L02"],
  "context-menu": ["L05"],
  dialog: ["L04"],
};
/** The raw document each kind's step writes: `<run>/<id>-<suffix>.json`. */
export const DOC_SUFFIX: Readonly<Record<DrawKind, string>> = {
  menu: "menus",
  submenu: "menus",
  "context-menu": "context",
  dialog: "walk",
};

/**
 * Owner hints for the dialog openers: L04's list 1 (opener label by dialog title, compared
 * case-insensitively) plus the live title the P4-1 remainder read for Login ("User Profile").
 */
export const OPENER_HINTS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LIST1.map((d) => [d.title.toLowerCase(), d.opener])),
  "user profile": "Login",
  "save world as": "Save World As",
};

// ── Ledger view (the fields blind.ts reads; a test builds one from rows) ─────

export interface LedgerRow {
  id: string;
  kind: string;
  module: string;
  parent?: string | null;
  label?: string;
  label_raw?: string;
  observed_states?: Array<Record<string, string>>;
  sources?: Array<{ enumerator: string }>;
}
export interface LedgerView {
  byId: Map<string, LedgerRow>;
  children: Map<string, LedgerRow[]>;
  build?: string | null;
}

export function ledgerOf(rows: readonly LedgerRow[], build: string | null = null): LedgerView {
  const byId = new Map<string, LedgerRow>();
  const children = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    if (typeof r.parent === "string") {
      const l = children.get(r.parent);
      if (l) l.push(r);
      else children.set(r.parent, [r]);
    }
  }
  return { byId, children, build };
}

export function loadLedgerView(root?: string): LedgerView {
  const l = loadLedger(censusPaths(root));
  return {
    byId: l.byId as unknown as Map<string, LedgerRow>,
    children: l.children as unknown as Map<string, LedgerRow[]>,
    build: l.meta?.build?.tag ?? null,
  };
}

const LIVE_SOURCE = /^L\d{2}$/;
export function hasLiveSource(r: LedgerRow): boolean {
  return (r.sources ?? []).some((s) => LIVE_SOURCE.test(s.enumerator));
}

// ── The frame ────────────────────────────────────────────────────────────────

export interface DrawOpen {
  /** menu: [title]; submenu: [title, sub-menu label]. */
  menuPath?: string[];
  /** context-menu: the policy target path. */
  target?: string[];
  /** dialog: the window title (the ledger's label). */
  dialog?: string;
  /** dialog: the label the owner clicks, when known. */
  opener_hint?: string | null;
}

export interface FrameElement {
  module: string;
  /** `--state` syntax: `mode=edit,selection=layer`, or `none`. */
  state: string;
  kind: DrawKind;
  open: DrawOpen;
  /** The ledger container row the draw maps to; null is a finding (unknown to the ledger). */
  container_id: string | null;
}

export interface Draw extends FrameElement {
  id: string;
}

export function frameKey(e: FrameElement): string {
  const how = e.open.menuPath ?? e.open.target ?? [e.open.dialog ?? ""];
  return `${e.module}|${e.kind}|${how.join(" > ")}|${e.state}`;
}

/** The ledger id of a ui container keyed by a label path, when the ledger has that row. */
export function containerId(
  ledger: LedgerView,
  module: string,
  kind: "menu" | "context-menu",
  path: readonly string[],
): string | null {
  const id = deriveId({ dim: "ui", kind, module, key: { path: [...path] } });
  return ledger.byId.has(id) ? id : null;
}

/** The walked modules: titles_by_module entries with a title, an L02 window and not never-read. */
export function frameModules(policy: CensusPolicy): string[] {
  return MODULE_ORDER.filter(
    (m) => !NEVER_READ.has(m) && MODULE_WINDOWS[m] && (titlesFor(policy, m)?.length ?? 0) > 0,
  );
}

/** Every (container, live state) of the walked modules, in a fixed order. */
export function buildFrame(policy: CensusPolicy, ledger: LedgerView): FrameElement[] {
  const out: FrameElement[] = [];
  for (const module of frameModules(policy)) {
    const titles = titlesFor(policy, module) ?? [];
    for (const state of liveStates(module)) {
      const st = parseState(state);
      if (typeof st === "string") throw new Error(`LIVE_STATES ${module}: ${st}`);
      for (const title of titles)
        out.push({
          module,
          state,
          kind: "menu",
          open: { menuPath: [title] },
          container_id: containerId(ledger, module, "menu", [title]),
        });
      for (const title of titles) {
        const tid = containerId(ledger, module, "menu", [title]);
        if (!tid) continue;
        const subs = (ledger.children.get(tid) ?? [])
          .filter((r) => r.kind === "menu" && hasLiveSource(r))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const r of subs) {
          const label = r.label_raw ?? r.label;
          if (!label) continue;
          out.push({
            module,
            state,
            kind: "submenu",
            open: { menuPath: [title, label] },
            container_id: r.id,
          });
        }
      }
      for (const t of targetsFor(policy, module, st))
        out.push({
          module,
          state,
          kind: "context-menu",
          open: { target: [...t.path] },
          container_id: containerId(ledger, module, "context-menu", t.path),
        });
      const dialogs = [...ledger.byId.values()]
        .filter((r) => r.kind === "dialog" && r.module === module && hasLiveSource(r))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const r of dialogs) {
        const title = r.label_raw ?? r.label;
        if (!title) continue;
        out.push({
          module,
          state,
          kind: "dialog",
          open: { dialog: title, opener_hint: OPENER_HINTS[title.toLowerCase()] ?? null },
          container_id: r.id,
        });
      }
    }
  }
  return out;
}

/** Frame sizes per module and kind. */
export function frameSizes(frame: readonly FrameElement[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const e of frame) {
    out[e.module] ??= {};
    out[e.module][e.kind] = (out[e.module][e.kind] ?? 0) + 1;
  }
  return out;
}

// ── The draw ─────────────────────────────────────────────────────────────────

/** mulberry32: a small seeded PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Allocate `n` over strata of `sizes`, proportional with a floor (capped by each size): every
 * stratum first gets min(floor, size), then one unit at a time goes to the stratum furthest below
 * its proportional share (ties: the earlier stratum). Deterministic; sums to min(n, total).
 */
export function allocate(sizes: readonly number[], n: number, floor = 0): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const want = Math.min(n, total);
  const alloc = sizes.map((s) => Math.min(floor, s));
  let used = alloc.reduce((a, b) => a + b, 0);
  // Floors above n (a tiny n): trim from the largest allocations, last stratum first.
  while (used > want) {
    let k = -1;
    for (let i = alloc.length - 1; i >= 0; i--) if (k === -1 || alloc[i] > alloc[k]) k = i;
    alloc[k]--;
    used--;
  }
  while (used < want) {
    let k = -1;
    let best = -Infinity;
    for (let i = 0; i < sizes.length; i++) {
      if (alloc[i] >= sizes[i]) continue;
      const deficit = (want * sizes[i]) / total - alloc[i];
      if (deficit > best) {
        best = deficit;
        k = i;
      }
    }
    if (k === -1) break;
    alloc[k]++;
    used++;
  }
  return alloc;
}

function shuffled<T>(list: readonly T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface DrawPlan {
  $comment: string;
  schema: string;
  seed: number;
  n_requested: number;
  n_drawn: number;
  frame_size: number;
  floor: number;
  /** Frame sizes per module and kind (the sampling frame, before the draw). */
  frame: Record<string, Record<string, number>>;
  /** Draws per module and kind. */
  allocation: Record<string, Record<string, number>>;
  live_states: Record<string, readonly string[]>;
  ledger_build: string | null;
  draws: Draw[];
}

/** The seeded stratified draw: module (proportional, floor), then kind (proportional), no replacement. */
export function drawFrom(
  frame: readonly FrameElement[],
  n: number,
  seed: number,
  floor = FLOOR,
): Draw[] {
  const rnd = mulberry32(seed);
  const modules = [...new Set(frame.map((e) => e.module))];
  const byModule = modules.map((m) => frame.filter((e) => e.module === m));
  const mAlloc = allocate(
    byModule.map((l) => l.length),
    n,
    floor,
  );
  const picked: FrameElement[] = [];
  byModule.forEach((list, mi) => {
    const kinds = KIND_ORDER.filter((k) => list.some((e) => e.kind === k));
    const byKind = kinds.map((k) =>
      list.filter((e) => e.kind === k).sort((a, b) => cmp(frameKey(a), frameKey(b))),
    );
    const kAlloc = allocate(
      byKind.map((l) => l.length),
      mAlloc[mi],
      0,
    );
    byKind.forEach((l, ki) => picked.push(...shuffled(l, rnd).slice(0, kAlloc[ki])));
  });
  const stateIdx = (e: FrameElement): number => liveStates(e.module).indexOf(e.state);
  picked.sort(
    (a, b) =>
      MODULE_ORDER.indexOf(a.module as (typeof MODULE_ORDER)[number]) -
        MODULE_ORDER.indexOf(b.module as (typeof MODULE_ORDER)[number]) ||
      stateIdx(a) - stateIdx(b) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      cmp(frameKey(a), frameKey(b)),
  );
  return picked.map((e, i) => ({ id: drawId(i + 1), ...e }));
}

export function drawId(n: number): string {
  return `b-${String(n).padStart(3, "0")}`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildDrawPlan(
  policy: CensusPolicy,
  ledger: LedgerView,
  n: number,
  seed: number,
): DrawPlan {
  const frame = buildFrame(policy, ledger);
  const draws = drawFrom(frame, n, seed);
  return {
    $comment: `Generated by \`${SCRIPT} draw --seed ${seed} --n ${n}\`: the blind exploration's draws (plan 4.6, sitting P4-8). The frame is built from the policy's menu titles and context targets and from the ledger's live-read sub-menu and dialog rows only, never from item rows. A null container_id is itself a finding: the container is unknown to the ledger.`,
    schema: DRAWS_SCHEMA,
    seed,
    n_requested: n,
    n_drawn: draws.length,
    frame_size: frame.length,
    floor: FLOOR,
    frame: frameSizes(frame),
    allocation: frameSizes(draws),
    live_states: Object.fromEntries(frameModules(policy).map((m) => [m, liveStates(m)])),
    ledger_build: ledger.build ?? null,
    draws,
  };
}

export function loadDrawPlan(path: string): DrawPlan {
  const p = JSON.parse(readFileSync(path, "utf-8")) as DrawPlan;
  if (p.schema !== DRAWS_SCHEMA || !Array.isArray(p.draws))
    throw new Error(`${path} is not a ${DRAWS_SCHEMA} document`);
  return p;
}

/** `<module>-<stateTag>`: the run folder of a draw under the sitting folder. */
export function runSubOf(d: Pick<Draw, "module" | "state">): string {
  const st = parseState(d.state);
  if (typeof st === "string") throw new Error(`${d.module}: ${st}`);
  return `${d.module}-${stateTag(st)}`;
}

// ── Live items of one read document ─────────────────────────────────────────

export type ReadDoc = MenusDoc | ContextDoc | WalkDoc;

export interface LiveRead {
  /** The drawn container was found in the document (opened, read). */
  seen: boolean;
  /** Normalized labels of the named items (separators and unnamed items excluded). */
  labels: string[];
  note?: string;
}

const ZERO_SHA = "0".repeat(64);

function sameLabels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => normalizeLabel(x) === normalizeLabel(b[i]));
}

/** What appeared live in the drawn container, by the walker's own line rules (L02, L05, L04). */
export function liveItems(d: Draw, doc: ReadDoc): LiveRead {
  const st = parseState(d.state);
  const state: ObservedState = typeof st === "string" ? {} : st;
  if (d.kind === "menu" || d.kind === "submenu") {
    const path = d.open.menuPath ?? [];
    const m = doc as MenusDoc;
    const entry = (m.menus ?? []).find((e) => e.title === path[0]);
    if (!entry || entry.skipped || !entry.opened || !entry.collapsed)
      return { seen: false, labels: [], note: `title ${path[0]} not read (${entry?.skipped ?? "absent"})` };
    const { lines } = menuLines(m, { module: d.module, state, sha: ZERO_SHA });
    const keyPath = (l: (typeof lines)[number]): string[] =>
      ((l.key as { path?: string[] }).path ?? []) as string[];
    let parent: string[] = [path[0]];
    if (d.kind === "submenu") {
      const sub = lines.find(
        (l) => l.kind === "menu" && keyPath(l).length === 2 && sameLabels(keyPath(l), path),
      );
      if (!sub) return { seen: false, labels: [], note: `sub-menu ${path.join(" > ")} not read` };
      parent = keyPath(sub);
    }
    const want = JSON.stringify(parent);
    const labels = lines
      .filter(
        (l) =>
          l.parent_key &&
          JSON.stringify((l.parent_key.key as { path?: string[] }).path) === want &&
          (l as { label?: string }).label,
      )
      .map((l) => (l as { label?: string }).label as string);
    return { seen: true, labels };
  }
  if (d.kind === "context-menu") {
    const tree = popupTreeOf(doc as ContextDoc);
    if (!tree) return { seen: false, labels: [], note: (doc as ContextDoc).reason ?? "no popup" };
    const r = popupLines(tree, { path: d.open.target ?? [] }, d.module, state, ZERO_SHA);
    return {
      seen: true,
      labels: r.lines
        .filter((l) => l.kind === "context-item" && (l as { label?: string }).label)
        .map((l) => (l as { label?: string }).label as string),
    };
  }
  const w = doc as WalkDoc;
  if (!w.tree) return { seen: false, labels: [], note: "no walk tree" };
  const lines = dialogLines({ doc: w, sha256: ZERO_SHA, module: d.module, title: d.open.dialog ?? "" });
  return {
    seen: true,
    labels: lines
      .slice(1)
      .filter((l) => (l as { label?: string }).label)
      .map((l) => (l as { label?: string }).label as string),
  };
}

// ── Ledger children of a container in a state ──────────────────────────────

/**
 * Does a ledger row count for a draw in `state`? When the state matrix declares no axis for the
 * row's kind in its module, any observation counts. Otherwise the row counts when one of its
 * observed states agrees with the drawn state on every declared axis (an axis the observation does
 * not carry is not a disagreement), or it carries no observed state at all (a non-live source).
 */
export function countsInState(
  r: LedgerRow,
  state: ObservedState,
  axesOf: (module: string, kind: string) => string[] = (m, k) => stateAxes(m, k),
): boolean {
  const axes = axesOf(r.module, r.kind);
  if (!axes.length) return true;
  const os = r.observed_states ?? [];
  if (!os.length) return true;
  const want = projectState(state, axes) as Record<string, string>;
  return os.some((o) => axes.every((a) => o[a] === undefined || want[a] === undefined || o[a] === want[a]));
}

/** The container's child rows a draw compares with: menus and dialogs as L02/L04 key them. */
export function ledgerChildren(ledger: LedgerView, d: Draw, id: string): LedgerRow[] {
  const direct = ledger.children.get(id) ?? [];
  if (d.kind === "menu" || d.kind === "submenu")
    return direct.filter((r) => r.kind === "menu" || r.kind === "menu-item");
  if (d.kind === "context-menu") return direct.filter((r) => r.kind === "context-item");
  const out: LedgerRow[] = [];
  const seen = new Set<string>();
  const stack = [...direct];
  while (stack.length) {
    const r = stack.pop()!;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    stack.push(...(ledger.children.get(r.id) ?? []));
  }
  return out;
}

/**
 * The labels a row answers to: `label` and `label_raw`. A live row merged with a wiki row (an alias
 * of DEC-054) keeps the wiki's casing in `label` and the live text in `label_raw`; the live read is
 * compared with both (first run of P4-8: 18 false escapes of this shape, DEC-057).
 */
function rowLabels(r: LedgerRow): string[] {
  return [...new Set([r.label, r.label_raw].filter((l): l is string => !!l).map((l) => normalizeLabel(l)))];
}

/** Re-resolve a draw's container against the ledger of the check (it may have moved on). */
export function resolveContainer(ledger: LedgerView, d: Draw): string | null {
  if (d.container_id && ledger.byId.has(d.container_id)) return d.container_id;
  if (d.kind === "menu" || d.kind === "submenu")
    return containerId(ledger, d.module, "menu", d.open.menuPath ?? []);
  if (d.kind === "context-menu")
    return containerId(ledger, d.module, "context-menu", d.open.target ?? []);
  return null;
}

// ── The check ────────────────────────────────────────────────────────────────

export interface Escape {
  draw: string;
  module: string;
  kind: DrawKind;
  state: string;
  container_id: string | null;
  label: string;
  /** The label is under the container in the ledger, but only in states that do not count here. */
  ledger_states?: Array<Record<string, string>>;
  container_unknown?: true;
  root_cause: null;
  candidates: string[];
}
export interface Note {
  draw: string;
  module: string;
  container_id: string;
  label: string;
  row: string;
}
export interface Rates {
  draws: number;
  checked: number;
  not_read: number;
  container_not_seen: number;
  draws_with_escape: number;
  draw_rate: number | null;
  items_live: number;
  items_escaped: number;
  item_rate: number | null;
  verdict: "under" | "over" | "no-data";
}
export interface BlindReport {
  schema: string;
  header: {
    threshold: number;
    threshold_note: string;
    gate: string;
    seed: number;
    n_drawn: number;
    ledger_build: string | null;
    draws_ledger_build: string | null;
  };
  pooled: Rates;
  modules: Record<string, Rates>;
  escapes: Escape[];
  notes: Note[];
  container_unknown: Array<{ draw: string; module: string; kind: DrawKind; open: DrawOpen }>;
  container_not_seen: Array<{ draw: string; module: string; kind: DrawKind; note: string }>;
  not_read: string[];
}

function emptyRates(): Rates {
  return {
    draws: 0,
    checked: 0,
    not_read: 0,
    container_not_seen: 0,
    draws_with_escape: 0,
    draw_rate: null,
    items_live: 0,
    items_escaped: 0,
    item_rate: null,
    verdict: "no-data",
  };
}

function finish(r: Rates, threshold: number): Rates {
  r.draw_rate = r.checked ? r.draws_with_escape / r.checked : null;
  r.item_rate = r.items_live ? r.items_escaped / r.items_live : null;
  r.verdict = r.draw_rate === null ? "no-data" : r.draw_rate <= threshold ? "under" : "over";
  return r;
}

export function checkDraws(
  plan: Pick<DrawPlan, "draws" | "seed" | "n_drawn" | "ledger_build">,
  ledger: LedgerView,
  read: (d: Draw) => ReadDoc | null,
  threshold = DEFAULT_THRESHOLD,
  axesOf?: (module: string, kind: string) => string[],
): BlindReport {
  const pooled = emptyRates();
  const modules: Record<string, Rates> = {};
  const report: BlindReport = {
    schema: REPORT_SCHEMA,
    header: {
      threshold,
      threshold_note: THRESHOLD_NOTE,
      gate: "pooled draw escape rate (draws with at least one escape / draws checked) <= threshold; item rates reported beside it",
      seed: plan.seed,
      n_drawn: plan.n_drawn,
      ledger_build: ledger.build ?? null,
      draws_ledger_build: plan.ledger_build,
    },
    pooled,
    modules,
    escapes: [],
    notes: [],
    container_unknown: [],
    container_not_seen: [],
    not_read: [],
  };
  for (const d of plan.draws) {
    const m = (modules[d.module] ??= emptyRates());
    for (const r of [pooled, m]) r.draws++;
    const doc = read(d);
    if (!doc) {
      for (const r of [pooled, m]) r.not_read++;
      report.not_read.push(d.id);
      continue;
    }
    const live = liveItems(d, doc);
    if (!live.seen) {
      for (const r of [pooled, m]) r.container_not_seen++;
      report.container_not_seen.push({
        draw: d.id,
        module: d.module,
        kind: d.kind,
        note: live.note ?? "not seen",
      });
      continue;
    }
    for (const r of [pooled, m]) r.checked++;
    const st = parseState(d.state);
    const state: ObservedState = typeof st === "string" ? {} : st;
    const id = resolveContainer(ledger, d);
    const kids = id ? ledgerChildren(ledger, d, id) : [];
    const counted = new Set<string>();
    const otherStates = new Map<string, Array<Record<string, string>>>();
    for (const r of kids) {
      const inState = countsInState(r, state, axesOf);
      for (const l of rowLabels(r)) {
        if (inState) counted.add(l);
        else otherStates.set(l, [...(otherStates.get(l) ?? []), ...(r.observed_states ?? [])]);
      }
    }
    if (!id)
      report.container_unknown.push({ draw: d.id, module: d.module, kind: d.kind, open: d.open });
    const liveSet = new Set(live.labels.map((l) => normalizeLabel(l)));
    let escaped = 0;
    for (const label of liveSet) {
      for (const r of [pooled, m]) r.items_live++;
      if (counted.has(label)) continue;
      escaped++;
      report.escapes.push({
        draw: d.id,
        module: d.module,
        kind: d.kind,
        state: d.state,
        container_id: id,
        label,
        ...(otherStates.has(label) ? { ledger_states: otherStates.get(label) } : {}),
        ...(id ? {} : { container_unknown: true as const }),
        root_cause: null,
        candidates: CANDIDATES[d.kind],
      });
    }
    for (const r of [pooled, m]) r.items_escaped += escaped;
    if (escaped) for (const r of [pooled, m]) r.draws_with_escape++;
    if (id)
      for (const r of kids) {
        const ls = rowLabels(r);
        if (ls.length && countsInState(r, state, axesOf) && !ls.some((l) => liveSet.has(l)))
          report.notes.push({ draw: d.id, module: d.module, container_id: id, label: ls[0], row: r.id });
      }
  }
  finish(pooled, threshold);
  for (const r of Object.values(modules)) finish(r, threshold);
  return report;
}

/** The document a draw's step wrote: `<reads>/<module>-<state>/<id>-<suffix>.json`, else anywhere below. */
export function findReadDoc(readsDir: string, d: Draw): string | null {
  const name = `${d.id}-${DOC_SUFFIX[d.kind]}.json`;
  const direct = join(readsDir, runSubOf(d), name);
  if (existsSync(direct)) return direct;
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 4) return null;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }
    for (const e of entries.sort()) {
      const p = join(dir, e);
      if (e === name) return p;
      try {
        if (statSync(p).isDirectory()) {
          const hit = walk(p, depth + 1);
          if (hit) return hit;
        }
      } catch {
        /* unreadable entry */
      }
    }
    return null;
  };
  return walk(readsDir, 0);
}

export function fileReader(readsDir: string): (d: Draw) => ReadDoc | null {
  return (d) => {
    const p = findReadDoc(readsDir, d);
    if (!p) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as ReadDoc;
    } catch {
      return null;
    }
  };
}

// ── The live walker (one module and state; one step per draw) ───────────────

/**
 * What a context step sends: tools/uia/context.py once (ShowContextMenu, read, Collapse), or with
 * `passive` nothing at all (context.py `--passive`: wait for the hand's popup, read it).
 */
export type ContextReader = (r: {
  pid: number;
  window: { className: string; titlePattern: string };
  path: string[];
  timeoutMs: number;
  out: string;
  passive?: boolean;
}) => Promise<{ doc: ContextDoc | null; sha256: string | null; stderr: string }>;

export interface BlindKernels {
  menuReader?: MenuReader;
  context?: ContextReader;
  dialog?: (port?: number) => Pick<L04Kernel, "windows" | "walk">;
  policy?: CensusPolicy;
  /** `walk --passive`: context draws are read from the owner's right-click (sf-15 route). */
  passiveContext?: boolean;
}

/** One line of `<run-dir>/reused-reads.jsonl`: the document `out` is a byte copy of `reused_read`. */
export interface ReusedRead {
  out: string;
  reused_read: string;
  menu: string;
}
export const REUSED_READS_FILE = "reused-reads.jsonl";

/**
 * One live read per (Workbench pid, module, window title, menu title, depth) in this process. A
 * later request with the same key gets the first read's text written to its own `out` and no call
 * is sent. Only a read that came back whole (exit 0, a document, its text) is kept; a failed read
 * is asked again. The caller owns the claim that the menu cannot have changed in between: one
 * module, one state, one Workbench process (walk --reuse-reads).
 */
export function reusingMenuReader(real: MenuReader, onReuse: (r: ReusedRead) => void = () => undefined): MenuReader {
  const cache = new Map<string, { code: number; doc: MenusDoc; text: string; from: string }>();
  return async (r) => {
    const key = JSON.stringify([r.pid, r.module, r.title, r.menu, r.depth]);
    const hit = cache.get(key);
    if (hit) {
      writeFileSync(r.out, hit.text, "utf-8");
      onReuse({ out: basename(r.out), reused_read: hit.from, menu: r.menu });
      return { code: hit.code, doc: hit.doc, text: hit.text };
    }
    const res = await real(r);
    if (res.code === 0 && res.doc && res.text)
      cache.set(key, { code: res.code, doc: res.doc, text: res.text, from: basename(r.out) });
    return res;
  };
}

export const realContextReader: ContextReader = async (r) => {
  const ctx = defaultPlaceholderContext();
  const table = redactionTable(ctx, undefined, process.env);
  const out = await runContext({
    options: {
      pid: r.pid,
      className: r.window.className,
      title: r.window.titlePattern,
      path: r.path,
      timeoutMs: r.timeoutMs,
      really: true,
      ...(r.passive ? { passive: true } : {}),
    },
    provider: "uia",
    env: { [REDACT_ENV]: JSON.stringify(table), [CONTEXT_PLAN_VERDICT_ENV]: "PASS" },
    outPath: r.out,
    ctx,
    table,
  });
  return { doc: out.doc, sha256: out.sha256, stderr: out.stderr };
};

/** How long a dialog step waits for the owner's click. */
export const OWNER_WAIT_MS = 600_000;
export const POLL_MS = 1_000;
const WALK_BOUNDS: WalkBounds = { ...DEFAULT_BOUNDS };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The owned window of `pid` titled `title` (case-insensitive, as L04), or null. */
export function findDialog(ws: readonly WindowInfo[], pid: number, title: string): WindowInfo | null {
  const t = title.toLowerCase();
  return ws.find((w) => w.pid === pid && w.title.toLowerCase() === t && w.owner !== 0) ?? null;
}

export function dialogReadAction(title: string): PlanAction {
  return {
    kind: "uia-read",
    target: {
      pid: LANE_RECORDED_PID,
      window: { className: EDITOR_WINDOW_CLASS, titlePattern: `^${escapeRe(title)}$`, allowOwned: true },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: { ...WALK_BOUNDS },
  };
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function menuStep(d: Draw, k: BlindKernels, policy: CensusPolicy): WalkerStep {
  const title = d.open.menuPath?.[0] ?? "";
  const w = MODULE_WINDOWS[d.module];
  const plan = titlePlan(d.module, title, d.id);
  return {
    id: d.id,
    title: `blind ${d.kind} ${(d.open.menuPath ?? []).join(" > ")} in ${d.module} (${d.state}): read the title at depth 1, Collapse`,
    risk: "reversible",
    timeout_ms: Number((plan[0] as { timeoutMs?: number }).timeoutMs ?? 40_000) + 15_000,
    expected: `${title} opens, its items${d.kind === "submenu" ? " and the sub-menu's" : ""} are read, every popup collapses (leftOpen empty); the document lands as ${d.id}-menus.json`,
    kill_criterion:
      "a new window that is not the popup pair, a dialog-like or disabled window, a popup left open after Collapse, a timeout",
    side_effects: [],
    rollback: "Collapse by the tool itself; a popup left open: the owner presses Esc once, by hand",
    popups: true,
    plan: () => plan,
    run: async (ctx) => {
      const out = join(ctx.opts.runDir, `${d.id}-menus.json`);
      const reader = k.menuReader ?? menusToolReader();
      const r = await ctx.call("uia-menu", () =>
        reader({
          pid: ctx.pid,
          module: d.module,
          className: w.className,
          title: w.title,
          menu: title,
          allowed: titlesFor(policy, d.module) ?? [],
          depth: 1,
          out,
          lane: ctx.lane,
        }),
      );
      const stop = stopFor(r, out);
      if (stop) throw stop;
      const artifacts = [{ path: out, sha256: sha(r.text ?? "") }];
      const live = liveItems(d, r.doc!);
      if (!live.seen)
        return { status: "observed", summary: `container not seen live: ${live.note ?? ""}`, artifacts };
      return { status: "pass", summary: `${live.labels.length} named item(s) read`, artifacts };
    },
  };
}

function contextStep(d: Draw, k: BlindKernels, policy: CensusPolicy, state: ObservedState): WalkerStep {
  const path = d.open.target ?? [];
  const titlePattern = moduleTitlePattern(d.module);
  const targets = targetsFor(policy, d.module, state);
  const idx = targets.findIndex((t) => JSON.stringify(t.path) === JSON.stringify(path));
  const l05 =
    idx >= 0
      ? l05Steps({ module: d.module, state, allowOwned: false }, policy, l05RealEnv)[idx]
      : undefined;
  const timeoutMs = uiaContextCaps(policy)?.perTargetMs ?? 15_000;
  return {
    id: d.id,
    title: `blind context-menu of ${path.join(" > ")} in ${d.module} (${d.state}): ShowContextMenu, read, Collapse`,
    risk: "reversible",
    timeout_ms: l05?.timeout_ms ?? timeoutMs + 45_000,
    expected: `a QMenu popup appears, is read passively and collapses; the document lands as ${d.id}-context.json`,
    kill_criterion:
      "no popup (stop), a new window other than the popup pair (stop), a dialog-like window (handoff), the popup open after Collapse (handoff)",
    side_effects: [
      "a popup opens and closes; whether ShowContextMenu also selects the target is [unverified]",
    ],
    rollback: "Collapse; a popup left open is the owner's Esc by hand",
    popups: true,
    plan: () => (l05 ? l05.plan({ module: d.module, state, allowOwned: false }) : []),
    run: async (ctx: WalkerStepContext) => {
      if (!l05 || !titlePattern)
        throw new StopBattery(
          "stopped",
          `${path.join(" > ")} is not on live_lane.uia_context.targets for ${d.module}: nothing sent`,
        );
      const out = join(ctx.opts.runDir, `${d.id}-context.json`);
      const reader = k.context ?? realContextReader;
      const r = await ctx.call("ShowContextMenu", () =>
        reader({
          pid: ctx.pid,
          window: { className: EDITOR_WINDOW_CLASS, titlePattern },
          path,
          timeoutMs,
          out,
        }),
      );
      const doc = r.doc;
      if (!doc) throw new StopBattery("stopped", `context.py gave no document: ${r.stderr}`);
      if (doc.result === "stopped" || doc.result === "refused" || doc.result === "refused-auth-window")
        throw new StopBattery("stopped", `context kernel ${doc.result}: ${doc.reason ?? "no reason"}`);
      if (doc.leftOpen)
        throw new StopBattery(
          "handoff",
          `the popup is still open after Collapse (${doc.collapseSkipped ?? "Collapse did not close it"}): the owner presses Esc once, by hand`,
        );
      const artifacts = r.sha256 ? [{ path: out, sha256: r.sha256 }] : [];
      if (doc.supported === false || !doc.popup)
        throw new StopBattery(
          "stopped",
          `no context menu appeared on "${path.join(" > ")}" (${doc.reason ?? "no popup"}): the owner's right-click and a passive read is L05's fallback`,
        );
      const live = liveItems(d, doc);
      return { status: "pass", summary: `${live.labels.length} named item(s) read`, artifacts };
    },
  };
}

/**
 * A context draw read through the sf-15 route (`walk --passive`): the owner right-clicks the
 * target, context.py `--passive` sends nothing and reads the popup into `b-NNN-context.json` (the
 * file `check` reads), the owner presses Esc and the step waits for the popup to go.
 */
function passiveContextStep(
  d: Draw,
  k: BlindKernels,
  policy: CensusPolicy,
  state: ObservedState,
): WalkerStep {
  const path = d.open.target ?? [];
  const titlePattern = moduleTitlePattern(d.module);
  const listed = targetsFor(policy, d.module, state).some(
    (t) => JSON.stringify(t.path) === JSON.stringify(path),
  );
  const what = `"${path.join(" > ")}"`;
  return {
    id: d.id,
    title: `blind context-menu of ${path.join(" > ")} in ${d.module} (${d.state}): the owner right-clicks, a passive read, the owner's Esc`,
    risk: "reversible",
    timeout_ms: PASSIVE_TIMEOUT_MS + ESC_WAIT_MS + 45_000,
    expected: `the owner right-clicks the target; one QMenu popup is read passively (nothing sent) and the owner's Esc closes it; the document lands as ${d.id}-context.json`,
    kill_criterion:
      "no popup within the wait (stop), several popups or a new window other than the popup pair (stop), a dialog-like window (handoff), the popup still open after the Esc wait (handoff)",
    side_effects: [
      "the owner's right-click may select the target (a hand action, not this tool's)",
    ],
    rollback: "the owner presses Esc once; nothing was sent by the tool",
    popups: true,
    plan: () => (listed ? handPlan() : []),
    run: async (ctx: WalkerStepContext) => {
      if (!listed || !titlePattern)
        throw new StopBattery(
          "stopped",
          `${path.join(" > ")} is not on live_lane.uia_context.targets for ${d.module}: nothing read`,
        );
      const out = join(ctx.opts.runDir, `${d.id}-context.json`);
      const reader = k.context ?? realContextReader;
      ctx.log(
        `OWNER: right-click ${what} now (one right-click, no menu choice); the step waits up to ${PASSIVE_TIMEOUT_MS / 1000} s and sends nothing`,
      );
      const r = await ctx.call("uia-read popup (hand-opened)", () =>
        reader({
          pid: ctx.pid,
          window: { className: EDITOR_WINDOW_CLASS, titlePattern },
          path,
          timeoutMs: PASSIVE_TIMEOUT_MS,
          out,
          passive: true,
        }),
      );
      const doc = r.doc;
      if (!doc) throw new StopBattery("stopped", `context.py gave no document: ${r.stderr}`);
      if (doc.result !== "ok" || !doc.popup)
        throw new StopBattery(
          "stopped",
          `no context menu was read on ${what} (context kernel ${doc.result ?? "no result"}: ${doc.reason ?? "no popup"}); nothing was sent${doc.handoff ? `; ${doc.handoff}` : ""}`,
        );
      const artifacts = r.sha256 ? [{ path: out, sha256: r.sha256 }] : [];
      const live = liveItems(d, doc);
      if (!(await awaitHandClose(ctx, what)))
        throw new StopBattery(
          "handoff",
          `read ${what} (${live.labels.length} named item(s), opened_by hand, ${d.id}-context.json), but the popup is still open: the owner presses Esc once, by hand`,
        );
      return {
        status: "pass",
        summary: `opened_by hand: ${live.labels.length} named item(s) read`,
        artifacts,
      };
    },
  };
}

function dialogStep(d: Draw, k: BlindKernels): WalkerStep {
  const title = d.open.dialog ?? "";
  return {
    id: d.id,
    title: `blind dialog "${title}" in ${d.module} (${d.state}): wait for the owner's ${d.open.opener_hint ? `"${d.open.opener_hint}"` : "opener"}, walk it, HANDOFF for the owner's Cancel`,
    risk: "read-only",
    timeout_ms: OWNER_WAIT_MS + 120_000,
    expected: `the owner opens "${title}"; the walk reads it into ${d.id}-walk.json; credential fields are never typed into`,
    kill_criterion:
      "any other new window (STOP), any other dialog (HANDOFF), no dialog within the wait (STOP)",
    side_effects: [],
    rollback: "the owner presses Cancel on the dialog; nothing was committed (never Save)",
    expectsDialogs: [{ title, owned: true, className: EDITOR_WINDOW_CLASS }],
    popups: true,
    plan: () => [dialogReadAction(title)],
    run: async (ctx) => {
      const kern = (k.dialog ?? ((p?: number) => l04RealKernel(p)))(ctx.port);
      ctx.log(
        `OWNER: open "${title}"${d.open.opener_hint ? ` (${d.open.opener_hint})` : ""} now; the step waits up to ${OWNER_WAIT_MS / 1000} s`,
      );
      const end = Date.now() + OWNER_WAIT_MS;
      let w: WindowInfo | null = null;
      for (;;) {
        const ws = await ctx.call("windows", () => kern.windows());
        w = findDialog(ws, ctx.pid, title);
        if (w || Date.now() >= end) break;
        await ctx.sleep(POLL_MS);
      }
      if (!w) throw new StopBattery("stopped", `"${title}" did not appear within the owner wait`);
      const out = join(ctx.opts.runDir, `${d.id}-walk.json`);
      const win = w;
      const r = await ctx.call("uia-read", () =>
        kern.walk(
          {
            pid: ctx.pid,
            hwnd: win.hwnd,
            className: win.className,
            titlePattern: `^${escapeRe(win.title)}$`,
            lane: ctx.lane,
          },
          out,
        ),
      );
      const live = liveItems(d, r.doc);
      throw new StopBattery(
        "handoff",
        `walked "${title}" (${live.labels.length} named item(s), ${d.id}-walk.json); OWNER: press Cancel on "${title}" (never Save), then main runs the next entry`,
      );
    },
  };
}

/** The steps of one module and state: one per draw, in the draws' order. */
export function blindSteps(
  draws: readonly Draw[],
  sel: { module: string; state: ObservedState },
  k: BlindKernels = {},
): WalkerStep[] {
  const policy = k.policy ?? loadPolicy();
  const want = stateKey(sel.state);
  return draws
    .filter((d) => {
      if (d.module !== sel.module) return false;
      const st = parseState(d.state);
      return typeof st !== "string" && stateKey(st) === want;
    })
    .map((d) =>
      d.kind === "context-menu"
        ? k.passiveContext
          ? passiveContextStep(d, k, policy, sel.state)
          : contextStep(d, k, policy, sel.state)
        : d.kind === "dialog"
          ? dialogStep(d, k)
          : menuStep(d, k, policy),
    );
}

export function blindDef(draws: readonly Draw[], k: BlindKernels = {}): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    session: SESSION,
    script: SCRIPT,
    defaultModule: "WorldEditor",
    steps: (sel) => blindSteps(draws, sel, k),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function repoPath(p: string): string {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

function take(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}

export interface BlindOverrides extends RunWalkerOverrides {
  log?: (line: string) => void;
  ledger?: LedgerView;
  kernels?: BlindKernels;
}

function frameTable(frame: readonly FrameElement[]): string[] {
  const sizes = frameSizes(frame);
  const lines = [`frame: ${frame.length} (container, live state) elements`];
  for (const [m, kinds] of Object.entries(sizes)) {
    const total = Object.values(kinds).reduce((a, b) => a + b, 0);
    lines.push(
      `  ${m}: ${total} (${KIND_ORDER.filter((k) => kinds[k]).map((k) => `${k} ${kinds[k]}`).join(", ")}); states ${liveStates(m).join(" | ")}`,
    );
  }
  return lines;
}

export async function main(argvIn: string[], over: BlindOverrides = {}): Promise<number> {
  const log = over.log ?? ((l: string) => console.log(l));
  const argv = [...argvIn];
  const sub = argv.shift();
  if (sub === "walk") {
    const draws = take(argv, "draws");
    if (!draws) {
      log("walk needs --draws <plan.json>");
      return EXIT.usage;
    }
    let plan: DrawPlan;
    try {
      plan = loadDrawPlan(repoPath(draws));
    } catch (e) {
      log(e instanceof Error ? e.message : String(e));
      return EXIT.usage;
    }
    const kindsArg = take(argv, "kinds");
    const kinds = kindsArg?.split(",").filter(Boolean) ?? null;
    const badKinds = (kinds ?? []).filter((k) => !(KIND_ORDER as readonly string[]).includes(k));
    if (kinds && (!kinds.length || badKinds.length)) {
      log(`--kinds takes a comma list of ${KIND_ORDER.join(", ")}${badKinds.length ? `; not ${badKinds.join(", ")}` : ""}`);
      return EXIT.usage;
    }
    const reuseAt = argv.indexOf("--reuse-reads");
    if (reuseAt !== -1) argv.splice(reuseAt, 1);
    const passiveAt = argv.indexOf("--passive");
    if (passiveAt !== -1) argv.splice(passiveAt, 1);
    const kept = kinds ? plan.draws.filter((d) => kinds.includes(d.kind)) : plan.draws;
    let kernels: BlindKernels | undefined =
      passiveAt !== -1 ? { ...over.kernels, passiveContext: true } : over.kernels;
    if (reuseAt !== -1) {
      const runDir = argv[argv.indexOf("--run-dir") + 1];
      if (argv.indexOf("--run-dir") === -1 || !runDir) {
        log("--reuse-reads lists its copies in the run folder: pass --run-dir <dir>");
        return EXIT.usage;
      }
      kernels = {
        ...kernels,
        menuReader: reusingMenuReader(over.kernels?.menuReader ?? menusToolReader(), (r) => {
          mkdirSync(runDir, { recursive: true });
          appendFileSync(join(runDir, REUSED_READS_FILE), JSON.stringify(r) + "\n", "utf-8");
        }),
      };
    }
    return runWalker(blindDef(kept, kernels), argv, over);
  }
  let args;
  try {
    args = parseArgs(argv, [
      "seed",
      "n",
      "out",
      "draws",
      "reads",
      "threshold",
      "census-root",
      "policy",
    ]);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  const policy = over.policy ?? loadPolicy(o.policy);
  const ledger = (): LedgerView => over.ledger ?? loadLedgerView(o["census-root"]);
  const write = (path: string, value: unknown): void => {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
  };
  if (sub === "draw") {
    if (args.flags.has("list-frame")) {
      for (const l of frameTable(buildFrame(policy, ledger()))) log(l);
      return 0;
    }
    const seed = Number(o.seed);
    const n = Number(o.n ?? 300);
    if (!o.seed || !Number.isInteger(seed) || !Number.isInteger(n) || n <= 0 || !o.out) {
      log("usage: blind.ts draw --seed <int> --n <int> --out <plan.json> | draw --list-frame");
      return 2;
    }
    const plan = buildDrawPlan(policy, ledger(), n, seed);
    write(o.out, plan);
    log(
      `${plan.n_drawn} draw(s) of ${n} requested from a frame of ${plan.frame_size}${plan.n_drawn < n ? " (the frame is smaller than --n: every element is drawn)" : ""}; ${plan.draws.filter((d) => d.container_id === null).length} with no ledger container`,
    );
    return 0;
  }
  if (sub === "check") {
    const threshold = o.threshold === undefined ? DEFAULT_THRESHOLD : Number(o.threshold);
    if (!o.draws || !o.reads || !o.out || !(threshold >= 0 && threshold <= 1)) {
      log("usage: blind.ts check --draws <plan.json> --reads <dir> --out <report.json> [--threshold 0.02]");
      return 2;
    }
    let plan: DrawPlan;
    try {
      plan = loadDrawPlan(o.draws);
    } catch (e) {
      log(e instanceof Error ? e.message : String(e));
      return 2;
    }
    const report = checkDraws(plan, ledger(), fileReader(o.reads), threshold);
    write(o.out, report);
    const p = report.pooled;
    const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(2)}%`);
    log(
      `pooled: ${p.checked} checked, ${p.not_read} not read, ${p.container_not_seen} container not seen; draw escape rate ${pct(p.draw_rate)} (${p.draws_with_escape}), item escape rate ${pct(p.item_rate)} (${p.items_escaped}/${p.items_live}); threshold ${threshold} (${THRESHOLD_NOTE}): ${p.verdict.toUpperCase()}`,
    );
    for (const [m, r] of Object.entries(report.modules))
      log(`  ${m}: ${r.checked} checked, draw rate ${pct(r.draw_rate)}, item rate ${pct(r.item_rate)}`);
    return p.verdict === "under" ? 0 : 1;
  }
  log("usage: blind.ts draw|check|walk ... (see the header)");
  return 2;
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
