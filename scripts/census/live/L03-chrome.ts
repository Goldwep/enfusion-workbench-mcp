/**
 * L03, toolbars, docks, tabs, status bar and native tool panels (design phase4-live-census.md
 * sections 1.2, 1.3, 2, 3.1 step 3, 4; plan item 8).
 *
 *   npx --no tsx scripts/census/live/L03-chrome.ts [--out <plan.json>] [--outline <file>] [--module <Id>]
 *   npx --no tsx scripts/census/live/L03-chrome.ts --really --id <lane> --sandbox <dir> --run-dir <dir>
 *       --module WorldEditor [--state mode=edit,selection=none] --from p4-l03-chrome
 *
 * Steps, in queue order (read-only, then reversible):
 *   p4-l03-chrome        one passive walk (`uia-read`, tools/uia/walk.ts) of the module's main window;
 *                        when L01 already wrote its walk into the run folder
 *                        (`L01-<Module>-<stateTag>-walk.json`) that file is read instead and nothing
 *                        is sent. Emits window, toolbar, toolbar-button, panel (tab strips, dock
 *                        contents), tab, dock, region (status bar), status-item and tool (the panel
 *                        in the current-tool dock) lines.
 *   p4-l03-window-menu   `uia-menu` on the Window title only, depth 1, Expand and Collapse only, the
 *                        popup pair benign. Emits nothing (menu items are L02's): it writes
 *                        `L03-<Module>-<stateTag>-window-docks.json`, the Window toggles matched to
 *                        the walked docks and those with no open dock, for main. A popup left open
 *                        is a HANDOFF. Planned only when the module's titles_by_module names Window.
 *   p4-l03-tool-<slug>   one per allow-listed `Tools > <tool>` path of policy.json
 *                        execute_action.allow_list (none today), planned only when the restore path
 *                        `Tools > Move` is listed too: walk, `wb_module action` (ExecuteAction), walk
 *                        (oracle: the current-tool dock's title is the tool's label), the restore
 *                        action, walk (the title is back). No visible effect: no restore is sent
 *                        (observed). A title not back after the restore: STOP, owner hand.
 * The Window dock toggles are L09's battery and never L03's. No key, no invoke, no Enter, no
 * typing; ParticleEditor is never read (no title pattern, so the checker refuses the plan).
 * Imports the runner, line type, identity and window rule from common.ts; copies none of it.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runModule } from "../../../src/tools/wb-module.js";
import { WorkbenchClient } from "../../../src/workbench/client.js";
import { LANE_RECORDED_PID, type PlanAction } from "../../live/dry-run.js";
import { DEFAULT_PORT } from "../../live/netcall.js";
import { REPO_ROOT } from "../../live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../live/policy.js";
import { DEFAULT_BOUNDS } from "../../../tools/uia/walk.js";
import { menuTimeoutMs } from "../../../tools/uia/menus.js";
import {
  EDITOR_WINDOW_CLASS,
  MODULE_TITLES,
  StopBattery,
  chooseKey,
  deriveId,
  isMainModule,
  laneArgv,
  normalizeLabel,
  objectNameOf,
  runWalker,
  stateFor,
  stateKey,
  stateTag,
  type LiveKind,
  type LiveObservation,
  type ObservedState,
  type WalkerDef,
  type WalkerStep,
  type WalkerLane,
  type WalkerStepContext,
} from "./common.js";

export const SCRIPT = "scripts/census/live/L03-chrome.ts";

/**
 * Main-window title patterns per module, from common.ts MODULE_TITLES (the modules L03 walks). WorldEditor: the P3-3 gate 2 walk (`World Editor - Unnamed
 * empty world`); ResourceManager: S-F's main window (`Enfusion Workbench - ...`) [unverified for the
 * walker]. A module without an entry plans an untargeted read, which the checker refuses: modules
 * enter as their L01 walk names their title. ParticleEditor never enters (DEC-042).
 */
// P4-2 2026-10-12: every module L10 opened and titled in P4-1 enters (ParticleEditor never, DEC-042).
export const MODULE_TITLE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MODULE_TITLES)
    .filter(([m]) => m !== "ParticleEditor")
    .map(([m, t]) => [m, t.pattern]),
);

/** The menu title the tool paths start with, and the tool that restores the default [unverified]. */
export const TOOL_MENU = "Tools";
/** The current tool at the P3-3 snapshot (current-tool dock titled "Move", node 0/5). */
export const RESTORE_TOOL = "Move";

// ── Walk documents ────────────────────────────────────────────────────────────

/** One node of an `emcp-uia-walk/1` tree (tools/uia/walker.py). */
export interface WalkNode {
  controlType: string;
  name?: string | null;
  automationId?: string | null;
  className?: string | null;
  offscreen?: boolean;
  childCount?: number;
  gridRowCount?: number | null;
  children?: WalkNode[];
}
export interface WalkDoc {
  schema?: string;
  tree: WalkNode;
}

/** A walk as a kernel returns it: the document, its file and that file's sha256. */
export interface WalkResult {
  doc: WalkDoc | null;
  file: string | null;
  sha256: string | null;
  detail: string;
}

/** A menus.py document (tools/uia/menus.ts); items may nest once L02's descent lands. */
export interface MenuDoc {
  menus?: Array<{ title: string; opened?: boolean; collapsed?: boolean | null; items?: unknown[] }>;
  leftOpen?: string[][];
}
export interface MenuResult {
  doc: MenuDoc | null;
  file: string | null;
  sha256: string | null;
  detail: string;
}

/** What L03 calls (fakes in tests). */
export interface L03Kernel {
  walk: (t: {
    pid: number;
    className: string;
    titlePattern: string;
    out: string;
    lane?: WalkerLane;
  }) => Promise<WalkResult>;
  menus: (t: {
    pid: number;
    module: string;
    className: string;
    title: string;
    out: string;
    lane?: WalkerLane;
  }) => Promise<MenuResult>;
  action: (module: string, menuPath: string[]) => Promise<{ ok: boolean; detail: string }>;
  readText: (path: string) => string | null;
  writeText: (path: string, text: string) => void;
}

const nm = (n: WalkNode): string => (n.name ?? "").trim();
const cls = (n: WalkNode): string => n.className ?? "";
const aid = (n: WalkNode): string => n.automationId ?? "";

// ── Node to rows (design 1.2, D6; identity 1.3, D7) ───────────────────────────

type Role =
  | "window"
  | "toolbar"
  | "toolbar-button"
  | "separator"
  | "tabstrip"
  | "tab"
  | "dock"
  | "dock-contents"
  | "tool"
  | "statusbar"
  | "status-item"
  | "skip";

const KIND_OF_ROLE: Partial<Record<Role, LiveKind>> = {
  window: "window",
  toolbar: "toolbar",
  "toolbar-button": "toolbar-button",
  tabstrip: "panel",
  tab: "tab",
  dock: "dock",
  "dock-contents": "panel",
  tool: "tool",
  // L01 records a StatusBar as a panel; the same id keeps one parent for its status items
  statusbar: "panel",
  "status-item": "status-item",
};

/** The role of a child node given its parent's role (D6 for the chrome kinds only). */
function roleOf(n: WalkNode, parent: Role): Role {
  const ct = n.controlType;
  if (parent === "toolbar") {
    if (cls(n) === "QToolBarSeparator") return "separator";
    if ((ct === "Button" || ct === "CheckBox") && cls(n) === "QToolButton") return "toolbar-button";
    return "skip";
  }
  if (parent === "tabstrip") return ct === "TabItem" ? "tab" : "skip";
  if (parent === "statusbar") return ct === "Text" && nm(n) ? "status-item" : "skip";
  if (ct === "MenuBar" || ct === "TitleBar") return "skip";
  if (ct === "ToolBar") return "toolbar";
  if (ct === "Tab" && (cls(n) === "QMainWindowTabBar" || cls(n) === "QTabBar")) return "tabstrip";
  if (ct === "Window" && cls(n) === "QDockWidget") return "dock";
  if (ct === "StatusBar") return "statusbar";
  if (parent === "dock" && (ct === "Group" || ct === "Custom") && /Contents$/.test(aid(n)))
    return "dock-contents";
  return "skip";
}

/** The current-tool panel below a dock: a Group or Custom whose class ends `ToolPanel`. */
function findToolPanel(n: WalkNode, depth = 0): WalkNode | null {
  if (depth > 0 && (n.controlType === "Group" || n.controlType === "Custom"))
    if (/ToolPanel$/.test(cls(n))) return n;
  if (depth >= 4) return null;
  for (const c of n.children ?? []) {
    const hit = findToolPanel(c, depth + 1);
    if (hit) return hit;
  }
  return null;
}

interface Found {
  node: WalkNode;
  path: string;
  role: Role;
  parent: Found | null;
  /** 1-based ordinal among unnamed siblings of the same class (D7 rule 3). */
  ordinal?: number;
  /** For a tool: the dock whose title names it. */
  dock?: WalkNode;
  /** Every non-separator child became a row. */
  complete?: boolean;
  rowChildren: Found[];
}

/** Collect the chrome nodes of one walk, with their tree paths (`0/4/0`). */
export function collectChrome(tree: WalkNode): Found[] {
  const out: Found[] = [];
  const root: Found = { node: tree, path: "0", role: "window", parent: null, rowChildren: [] };
  out.push(root);
  const visit = (n: WalkNode, path: string, role: Role, row: Found): void => {
    const unnamed = new Map<string, number>();
    let complete = true;
    (n.children ?? []).forEach((c, i) => {
      const cpath = `${path}/${i}`;
      const r = roleOf(c, role);
      if (r === "separator") return;
      if (r === "skip") {
        // a toolbar or tab strip with a child that is not a row has no children_count
        if (role === "toolbar" || role === "tabstrip") {
          complete = false;
          return;
        }
        if (role === "statusbar") return;
        // data containers are sampled and are never chrome: no descent into them
        if (["Tree", "List", "Table", "DataGrid"].includes(c.controlType)) return;
        visit(c, cpath, "skip", row);
        return;
      }
      const f: Found = { node: c, path: cpath, role: r, parent: row, rowChildren: [] };
      if (!nm(c)) {
        const k = cls(c) || c.controlType;
        const o = (unnamed.get(k) ?? 0) + 1;
        unnamed.set(k, o);
        f.ordinal = o;
      }
      out.push(f);
      row.rowChildren.push(f);
      if (r === "dock") {
        const tp = findToolPanel(c);
        if (tp && nm(c)) {
          const t: Found = {
            node: tp,
            path: locate(c, tp, cpath),
            role: "tool",
            parent: f,
            dock: c,
            rowChildren: [],
          };
          out.push(t);
          f.rowChildren.push(t);
        }
      }
      if (r === "toolbar" || r === "tabstrip" || r === "statusbar" || r === "dock")
        visit(c, cpath, r, f);
      else if (r === "dock-contents") visit(c, cpath, "skip", f);
    });
    if (role === "toolbar" || role === "tabstrip") row.complete = complete;
  };
  visit(tree, "0", "window", root);
  return out;
}

function locate(from: WalkNode, target: WalkNode, path: string): string {
  const kids = from.children ?? [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i] === target) return `${path}/${i}`;
    const p = locate(kids[i], target, `${path}/${i}`);
    if (p) return p;
  }
  return "";
}

/** The segment a row contributes to its children's key path (gap in D7: see the hand-off). */
function segmentOf(line: LiveObservation): string {
  const k = line.key;
  return "object_name" in k ? k.object_name : k.path[k.path.length - 1];
}

export interface ChromeResult {
  lines: LiveObservation[];
  /** Rows dropped because another row of the same kind already had that id. */
  duplicates: string[];
  counts: Partial<Record<LiveKind, number>>;
}

/**
 * The L03 rows of one walk. `ref(path)` gives the line's ref (`artifact:<sha>#n/<path>`). The module
 * window has no key path segment of its own (the module id carries it). `children_count` only on a
 * toolbar or tab strip whose every non-separator child became a row.
 */
export function chromeLines(
  tree: WalkNode,
  o: { module: string; state: ObservedState; ref: (path: string) => string },
): ChromeResult {
  const found = collectChrome(tree);
  const candCount = new Map<string, number>();
  for (const f of found) {
    const kind = KIND_OF_ROLE[f.role];
    const cand = objectNameOf(aid(f.node) || undefined, cls(f.node) || undefined);
    if (kind && cand) candCount.set(`${kind}|${cand}`, (candCount.get(`${kind}|${cand}`) ?? 0) + 1);
  }
  const lineOf = new Map<Found, LiveObservation>();
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const counts: Partial<Record<LiveKind, number>> = {};
  const lines: LiveObservation[] = [];
  for (const f of found) {
    const kind = KIND_OF_ROLE[f.role];
    if (!kind) continue;
    const parentLine = f.parent ? lineOf.get(f.parent) : undefined;
    if (f.parent && !parentLine) continue;
    const ancestors: string[] = [];
    for (let p = f.parent; p && p.role !== "window"; p = p.parent) {
      const l = lineOf.get(p);
      if (l) ancestors.unshift(segmentOf(l));
    }
    const unverified: string[] = [];
    let label = nm(f.node);
    let confidence: LiveObservation["confidence"] = "high";
    let key: LiveObservation["key"];
    if (f.role === "tool") {
      label = nm(f.dock!);
      key = { path: [...ancestors, label] };
      confidence = "medium";
      unverified.push(`tool named by its dock's title; panel class ${cls(f.node)}`);
    } else {
      const id = chooseKey(
        {
          automationId: aid(f.node) || undefined,
          className: cls(f.node) || undefined,
          ancestorLabels: ancestors,
          name: label,
          unnamedOrdinal: f.ordinal,
          moduleWindow: f.role === "window",
        },
        (c) => (candCount.get(`${kind}|${c}`) ?? 0) === 1,
      );
      key = id.key;
      if (id.confidence) confidence = id.confidence;
      if (id.unverified) unverified.push(...id.unverified);
    }
    if (f.role === "toolbar-button" && f.node.controlType === "CheckBox")
      unverified.push("a CheckBox: its checked state is not recorded (no state field)");
    if (f.role === "tabstrip")
      unverified.push("a tab strip's accessible name is its current tab's label");
    if (f.role === "status-item")
      unverified.push("status text may be dynamic; identity by its text");
    const line: LiveObservation = {
      dim: "ui",
      kind,
      module: o.module,
      key,
      parent_key: parentLine
        ? {
            dim: parentLine.dim,
            kind: parentLine.kind,
            module: parentLine.module,
            key: parentLine.key,
          }
        : null,
      origin: "vanilla",
      ...(label && f.role !== "window" ? { label: normalizeLabel(label), label_raw: label } : {}),
      locator: {
        ...(aid(f.node) ? { automationId: aid(f.node) } : {}),
        controlType: f.node.controlType,
        windowClass: EDITOR_WINDOW_CLASS,
      },
      observed_state: stateFor(o.module, kind, o.state),
      ref: o.ref(f.path),
      confidence,
      ...(unverified.length ? { unverified } : {}),
    };
    const id = `${deriveId(line)}|${JSON.stringify(line.observed_state)}`;
    if (seen.has(id)) {
      duplicates.push(`${deriveId(line)} at n/${f.path}`);
      continue;
    }
    seen.add(id);
    lineOf.set(f, line);
    lines.push(line);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  // children_count: every non-separator child of a toolbar or tab strip became a row
  for (const f of found) {
    const l = lineOf.get(f);
    if (!l || !(f.role === "toolbar" || f.role === "tabstrip") || !f.complete) continue;
    const kids = f.rowChildren.map((c) => lineOf.get(c));
    // the build counts children per (file, state): a child in another state is not counted there
    const sk = stateKey(l.observed_state);
    if (kids.every((c) => c !== undefined && stateKey(c.observed_state) === sk))
      l.children_count = kids.length;
  }
  return { lines, duplicates, counts };
}

// ── Window menu toggles (passive read) ─────────────────────────────────────────

/** The named MenuItem labels under the Window title, at any nesting of `items`/`children`. */
export function windowToggles(doc: MenuDoc | null): string[] | null {
  const m = doc?.menus?.find((x) => x.title === "Window");
  if (!m) return null;
  const out: string[] = [];
  const walk = (xs: unknown[] | undefined): void => {
    for (const x of xs ?? []) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (o.controlType === "MenuItem" && name) out.push(name.split("\t")[0]);
      walk(o.items as unknown[] | undefined);
      walk(o.children as unknown[] | undefined);
    }
  };
  walk(m.items);
  return out;
}

/** Dock titles of a walk, open (not offscreen). */
export function openDocks(tree: WalkNode | undefined): string[] {
  const out: string[] = [];
  const walk = (n: WalkNode): void => {
    if (n.controlType === "Window" && cls(n) === "QDockWidget" && !n.offscreen && nm(n))
      out.push(nm(n));
    for (const c of n.children ?? []) walk(c);
  };
  if (tree) walk(tree);
  return out;
}

/** The current tool: the title of the dock holding a `*ToolPanel` (null when none). */
export function currentTool(tree: WalkNode | undefined): string | null {
  let hit: string | null = null;
  const walk = (n: WalkNode): void => {
    if (hit) return;
    if (n.controlType === "Window" && cls(n) === "QDockWidget" && findToolPanel(n)) {
      hit = nm(n) || null;
      return;
    }
    for (const c of n.children ?? []) walk(c);
  };
  if (tree) walk(tree);
  return hit;
}

// ── Tool activation paths (policy-derived, never hand-written) ─────────────────

/** `Tools > <tool>` entries of execute_action.allow_list, exact segments only. */
export function toolPaths(policy: CensusPolicy): string[][] {
  const list = (policy.execute_action?.allow_list ?? []) as Array<string | string[]>;
  return list
    .map((raw) =>
      Array.isArray(raw)
        ? raw.map(String)
        : String(raw)
            .split(">")
            .map((s) => s.trim()),
    )
    .filter((p) => p.length === 2 && p[0] === TOOL_MENU && p[1].trim() !== "");
}

/** The tools L03 may activate: listed, not the restore tool, and only when the restore is listed. */
export function activatable(policy: CensusPolicy): string[][] {
  const paths = toolPaths(policy);
  if (!paths.some((p) => p[1] === RESTORE_TOOL)) return [];
  return paths.filter((p) => p[1] !== RESTORE_TOOL);
}

// ── Plans ────────────────────────────────────────────────────────────────────

function readAction(module: string): PlanAction {
  return {
    kind: "uia-read",
    target: {
      pid: LANE_RECORDED_PID,
      window: {
        className: EDITOR_WINDOW_CLASS,
        titlePattern: MODULE_TITLE[module] ?? "",
        allowOwned: false,
      },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: { ...DEFAULT_BOUNDS },
  };
}

function menuAction(module: string): PlanAction {
  return {
    kind: "uia-menu",
    target: { window: { className: EDITOR_WINDOW_CLASS, title: MODULE_TITLE[module] ?? "" } },
    pid: LANE_RECORDED_PID,
    module,
    menus: ["Window"],
    depth: 1,
    calls: ["Expand", "Collapse"],
    allowForeground: true,
    timeoutMs: menuTimeoutMs({ menus: ["Window"], depth: 1 }),
  };
}

function execAction(module: string, path: string[]): PlanAction {
  return { kind: "execute-action", target: { path: [...path], module } };
}

// ── Steps ────────────────────────────────────────────────────────────────────

const sha = (t: string): string => createHash("sha256").update(t).digest("hex");

/** Walk files: the L01 walk of this module and state if it is in the run folder, else ours. */
export function l01WalkPath(runDir: string, module: string, s: ObservedState): string {
  return join(runDir, `L01-${module}-${stateTag(s)}-walk.json`);
}

async function walkOnce(
  ctx: WalkerStepContext,
  k: L03Kernel,
  module: string,
  label: string,
): Promise<WalkResult> {
  return ctx.call("uia-read", () =>
    k.walk({
      pid: ctx.pid,
      className: EDITOR_WINDOW_CLASS,
      titlePattern: MODULE_TITLE[module] ?? "",
      out: join(ctx.opts.runDir, `L03-${module}-${stateTag(ctx.opts.state)}-${label}-walk.json`),
      lane: ctx.lane,
    }),
  );
}

/** Ids already in this run's obs file (a later step never emits a row twice). */
function emittedIds(k: L03Kernel, obsPath: string): Set<string> {
  const text = k.readText(obsPath);
  const out = new Set<string>();
  for (const l of (text ?? "").split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l) as LiveObservation;
      out.add(`${deriveId(o)}|${JSON.stringify(o.observed_state)}`);
    } catch {
      /* a broken line is normalise's to reject */
    }
  }
  return out;
}

function fresh(k: L03Kernel, obsPath: string, lines: LiveObservation[]): LiveObservation[] {
  const have = emittedIds(k, obsPath);
  return lines.filter((l) => {
    const id = `${deriveId(l)}|${JSON.stringify(l.observed_state)}`;
    if (have.has(id)) return false;
    have.add(id);
    return true;
  });
}

const refOf = (s: string) => (path: string) => `artifact:${s}#n/${path}`;

function chromeStep(module: string, kernel: () => L03Kernel): WalkerStep {
  return {
    id: "p4-l03-chrome",
    title: `L03 toolbars, docks, tabs, status bar and current tool of the ${module} window`,
    risk: "read-only",
    timeout_ms: DEFAULT_BOUNDS.budgetMs + 60_000,
    expected: "one walk (or L01's walk file); rows of the L03 kinds",
    kill_criterion: "any new window; a dialog-like window is a handoff",
    side_effects: [],
    rollback: "none: a passive read",
    plan: () => [readAction(module)],
    run: async (ctx) => {
      const k = kernel();
      const l01 = l01WalkPath(ctx.opts.runDir, module, ctx.opts.state);
      const l01Text = k.readText(l01);
      let w: WalkResult;
      if (l01Text) {
        w = {
          doc: JSON.parse(l01Text) as WalkDoc,
          file: l01,
          sha256: sha(l01Text),
          detail: "L01's walk file, nothing sent",
        };
      } else w = await walkOnce(ctx, k, module, "chrome");
      if (!w.doc?.tree || !w.sha256) return { status: "fail", summary: `no walk: ${w.detail}` };
      const r = chromeLines(w.doc.tree, {
        module,
        state: ctx.opts.state,
        ref: refOf(w.sha256),
      });
      const lines = fresh(k, ctx.obsPath, r.lines);
      ctx.emit(lines);
      const counts = Object.entries(r.counts)
        .map(([kk, v]) => `${kk} ${v}`)
        .join(", ");
      return {
        status: lines.length ? "pass" : "observed",
        summary: `${lines.length} row(s) (${counts}); ${r.duplicates.length} duplicate id(s) dropped; ${w.detail}`,
        artifacts: w.file ? [{ path: w.file, sha256: w.sha256 }] : [],
      };
    },
  };
}

function windowMenuStep(module: string, kernel: () => L03Kernel): WalkerStep {
  return {
    id: "p4-l03-window-menu",
    title: `L03 Window menu toggles of the ${module} window (Expand and Collapse only)`,
    risk: "reversible",
    timeout_ms: menuTimeoutMs({ menus: ["Window"], depth: 1 }) + 15_000,
    expected: "the Window popup opened and collapsed; leftOpen empty; toggles matched to docks",
    kill_criterion: "a popup left open (handoff: the owner presses Esc once); any non-popup window",
    side_effects: ["the Window popup opens and is collapsed"],
    rollback: "Collapse; a popup still open is the owner's Esc by hand",
    popups: true,
    plan: () => [menuAction(module)],
    run: async (ctx) => {
      const k = kernel();
      const tag = stateTag(ctx.opts.state);
      const m = await ctx.call("uia-menu", () =>
        k.menus({
          pid: ctx.pid,
          module,
          className: EDITOR_WINDOW_CLASS,
          title: MODULE_TITLE[module] ?? "",
          out: join(ctx.opts.runDir, `L03-${module}-${tag}-window-menu.json`),
          lane: ctx.lane,
        }),
      );
      const left = m.doc?.leftOpen ?? [];
      if (left.length)
        throw new StopBattery(
          "handoff",
          `a menu popup is still open after Collapse (${left.map((p) => p.join(" > ")).join("; ")}): the owner presses Esc once, by hand`,
        );
      const toggles = windowToggles(m.doc);
      if (toggles === null) return { status: "fail", summary: `no Window menu read: ${m.detail}` };
      const walkText = k.readText(l01WalkPath(ctx.opts.runDir, module, ctx.opts.state));
      const ownWalk = k.readText(join(ctx.opts.runDir, `L03-${module}-${tag}-chrome-walk.json`));
      const text = walkText ?? ownWalk;
      const docks = text ? openDocks((JSON.parse(text) as WalkDoc).tree) : null;
      const report = {
        module,
        state: ctx.opts.state,
        menuRef: m.sha256 ? `artifact:${m.sha256}#m/Window` : null,
        toggles,
        matched: docks ? toggles.filter((t) => docks.includes(t)) : null,
        noOpenDock: docks ? toggles.filter((t) => !docks.includes(t)) : null,
        docksNotInMenu: docks ? docks.filter((d) => !toggles.includes(d)) : null,
        note: toggles.length
          ? undefined
          : "no named item under Window: menus.py read_items does not descend yet (L02)",
      };
      const out = join(ctx.opts.runDir, `L03-${module}-${tag}-window-docks.json`);
      k.writeText(out, JSON.stringify(report, null, 2) + "\n");
      const arts = [] as Array<{ path: string; sha256: string }>;
      if (m.file && m.sha256) arts.push({ path: m.file, sha256: m.sha256 });
      return {
        status: toggles.length ? "pass" : "observed",
        summary: `${toggles.length} Window toggle(s); ${report.noOpenDock?.length ?? "?"} with no open dock; walk ${docks ? "read" : "absent"}`,
        artifacts: arts,
      };
    },
  };
}

const slug = (s: string): string =>
  normalizeLabel(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function toolStep(module: string, path: string[], kernel: () => L03Kernel): WalkerStep {
  const tool = path[1];
  const restore = [TOOL_MENU, RESTORE_TOOL];
  return {
    id: `p4-l03-tool-${slug(tool)}`,
    title: `L03 activate ${path.join(" > ")} and read its panel, then restore ${restore.join(" > ")}`,
    risk: "reversible",
    timeout_ms: 3 * (DEFAULT_BOUNDS.budgetMs + 30_000) + 60_000,
    expected: `the current-tool dock is titled "${tool}" after the action and "${RESTORE_TOOL}" after the restore`,
    kill_criterion:
      "any new window; a dialog is a handoff; the title not back after the restore is a stop",
    side_effects: [`the current tool changes to ${tool} and back`],
    rollback: `wb_module action ${restore.join(" > ")} (planned in this step)`,
    plan: () => [
      readAction(module),
      execAction(module, path),
      readAction(module),
      execAction(module, restore),
      readAction(module),
    ],
    run: async (ctx) => {
      const k = kernel();
      const a = await walkOnce(ctx, k, module, `${slug(tool)}-before`);
      const before = currentTool(a.doc?.tree);
      if (!a.doc?.tree || !a.sha256)
        return { status: "fail", summary: `baseline walk failed, nothing sent: ${a.detail}` };
      if (before !== RESTORE_TOOL)
        return {
          status: "fail",
          summary: `the current tool is "${before ?? "none"}", not ${RESTORE_TOOL}: nothing sent (the restore would not restore it)`,
        };
      const sent = await ctx.call("execute-action", () => k.action(module, path));
      if (!sent.ok)
        return {
          status: "observed",
          summary: `${path.join(" > ")} answered: ${sent.detail}; nothing changed is assumed, no restore sent`,
        };
      const b = await walkOnce(ctx, k, module, `${slug(tool)}-active`);
      if (!b.doc?.tree || !b.sha256)
        throw new StopBattery(
          "stopped",
          `the readback walk failed after ${path.join(" > ")}: the current tool is unknown; owner hand (${b.detail})`,
        );
      const during = currentTool(b.doc.tree);
      const arts = [a, b].map((x) => ({ path: x.file ?? "", sha256: x.sha256 ?? "" }));
      if (during === before)
        return {
          status: "observed",
          summary: `${path.join(" > ")} sent, the current-tool dock still "${during}": no restore sent`,
          artifacts: arts,
        };
      const r = chromeLines(b.doc.tree, { module, state: ctx.opts.state, ref: refOf(b.sha256) });
      const lines = fresh(k, ctx.obsPath, r.lines);
      ctx.emit(lines);
      const back = await ctx.call("execute-action", () => k.action(module, restore));
      const c = await walkOnce(ctx, k, module, `${slug(tool)}-restored`);
      const after = currentTool(c.doc?.tree);
      if (!back.ok || after !== before)
        throw new StopBattery(
          "stopped",
          `the restore ${restore.join(" > ")} ${back.ok ? "was sent" : `answered ${back.detail}`} and the current tool is "${after ?? "unknown"}", not "${before}": owner hand`,
        );
      arts.push({ path: c.file ?? "", sha256: c.sha256 ?? "" });
      return {
        status: during === tool ? "pass" : "observed",
        summary: `current tool ${before} -> ${during} -> ${after}; ${lines.length} new row(s)`,
        artifacts: arts,
      };
    },
  };
}

// ── Real kernel ──────────────────────────────────────────────────────────────

function spawnTool(
  script: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; last: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(REPO_ROOT, script), ...args], {
      cwd: REPO_ROOT,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, last: stdout.trim().split(/\r?\n/).pop() ?? "" });
    });
    child.on("error", () => {
      clearTimeout(timer);
      done({ code: null, last: "" });
    });
  });
}

/**
 * The live kernel: walk.ts and menus.ts as children (their own gates apply; the lane is the step's
 * `ctx.lane`, passed in each request), wb_module action.
 */
export function realKernel(): L03Kernel {
  const laneOf = (l: WalkerLane | undefined): string[] => (l?.id ? laneArgv(l) : []);
  const port = Number(process.env.ENFUSION_WORKBENCH_PORT) || DEFAULT_PORT;
  let client: WorkbenchClient | null = null;
  const readFile = (p: string): { text: string; sha256: string } | null => {
    try {
      const text = readFileSync(p, "utf-8");
      return { text, sha256: sha(text) };
    } catch {
      return null;
    }
  };
  return {
    walk: async (t) => {
      const r = await spawnTool(
        "tools/uia/walk.ts",
        [
          "--pid",
          String(t.pid),
          "--class",
          t.className,
          "--title-pattern",
          t.titlePattern,
          "--label",
          "p4-l03",
          "--out",
          t.out,
          ...laneOf(t.lane),
          "--really",
        ],
        DEFAULT_BOUNDS.budgetMs + 60_000,
      );
      const f = readFile(t.out);
      return {
        doc: f ? (JSON.parse(f.text) as WalkDoc) : null,
        file: f ? t.out : null,
        sha256: f?.sha256 ?? null,
        detail: `walk.ts exit ${r.code}`,
      };
    },
    menus: async (t) => {
      const r = await spawnTool(
        "tools/uia/menus.ts",
        [
          "--pid",
          String(t.pid),
          "--class",
          t.className,
          "--title",
          t.title,
          "--module",
          t.module,
          "--menus",
          "Window",
          "--depth",
          "1",
          "--allow-foreground",
          "--out",
          t.out,
          ...laneOf(t.lane),
          "--really",
        ],
        menuTimeoutMs({ menus: ["Window"], depth: 1 }) + 30_000,
      );
      const f = readFile(t.out);
      let leftOpen: string[][] = [];
      try {
        leftOpen = (JSON.parse(r.last) as { leftOpen?: string[][] }).leftOpen ?? [];
      } catch {
        /* no summary line */
      }
      const doc = f ? (JSON.parse(f.text) as MenuDoc) : null;
      return {
        doc: doc
          ? { ...doc, leftOpen: doc.leftOpen ?? leftOpen }
          : r.code === null
            ? null
            : { leftOpen },
        file: f ? t.out : null,
        sha256: f?.sha256 ?? null,
        detail: `menus.ts exit ${r.code}`,
      };
    },
    action: async (module, menuPath) => {
      client ??= new WorkbenchClient("127.0.0.1", port);
      const r = (await runModule(client, {
        action: "action",
        module: module as never,
        menuPath,
      })) as unknown as { ok: boolean; code?: string; message?: string };
      return { ok: r.ok === true, detail: r.ok ? "ok" : `${r.code ?? "?"}: ${r.message ?? ""}` };
    },
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
    writeText: (p, t) => writeFileSync(p, t, { encoding: "utf-8", flag: "wx" }),
  };
}

// ── Definition ───────────────────────────────────────────────────────────────

export function l03Def(
  kernel: () => L03Kernel = (() => {
    let k: L03Kernel | null = null;
    return () => (k ??= realKernel());
  })(),
  policy: () => CensusPolicy = loadPolicy,
): WalkerDef {
  return {
    enumerator: "L03",
    script: SCRIPT,
    session: "P4-1",
    defaultModule: "WorldEditor",
    steps: ({ module }) => {
      const p = policy();
      const by = (p.live_lane?.uia_menu as { titles_by_module?: Record<string, string[]> })
        ?.titles_by_module;
      const steps = [chromeStep(module, kernel)];
      if (by?.[module]?.includes("Window")) steps.push(windowMenuStep(module, kernel));
      for (const path of activatable(p)) steps.push(toolStep(module, path, kernel));
      return steps;
    },
  };
}

if (isMainModule(import.meta.url))
  runWalker(l03Def(), process.argv.slice(2)).then((c) => process.exit(c));
