/**
 * L14: the launcher walk (Phase 4, sitting P4-7; design `docs/v2/design/phase4-live-census.md`
 * sections 2, 3 and 4; plan 5.3). Pre-flight (`--variant launcher-walk`) does the launch: a start
 * with no `-gproj`, the launcher window asserted as the foreground window, no project open. This
 * script launches nothing, types nothing, presses nothing and closes nothing; the owner closes the
 * launcher window (or the post-flight does).
 *
 * Two steps, read-only first, then reversible (a Collapse undoes an Expand):
 *   p4-l14-walk   one passive `uia-read` of the launcher window (tools/uia/walk.ts) -> `window`,
 *                 `dialog`, `control` and `menu` (title) lines, module `Launcher`;
 *   p4-l14-menus  one `uia-menu` (tools/uia/menus.ts, Expand and Collapse only, depth 1) on the menu
 *                 titles the walk read, narrowed to the policy's `titles_by_module.Launcher` ->
 *                 `menu-item` lines and the title rows' `children_count`. The plan carries the
 *                 `uia-menu` only while that policy list exists: the Launcher is not on
 *                 `titles_by_module` today, so until main adds the titles its first walk reads, the
 *                 step plans nothing and opens nothing.
 *
 * Nothing here invokes a menu leaf, sends a key (Enter or any other), types, answers a prompt, or
 * opens a dialog: the plan holds `uia-read` and (when allow-listed) `uia-menu` only. A credential
 * field (Login and the like) is recorded as a `control` line with `risk_hint: "credential"` from
 * the passive read; it is never focused. The line type, kinds, identity, window rule and runner are
 * `common.ts`'s; the only local code is the node-to-line mapping and the kernel wrapper.
 *
 * Usage (design 2.1):
 *   npx --no tsx scripts/census/live/L14-launcher.ts [--out <plan.json>] [--outline <file>]
 *   npx --no tsx scripts/census/live/L14-launcher.ts --really --id <lane> --sandbox <dir>
 *       --run-dir <dir> --module Launcher --from p4-l14-walk
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUNCHER_WINDOW_TITLE } from "../../../src/workbench/launcher-nudge.js";
import { LANE_RECORDED_PID, type PlanAction } from "../../live/dry-run.js";
import { loadPolicy } from "../../live/policy.js";
import { toPlaceholders, type PlaceholderContext } from "../../live/paths.js";
import {
  DEFAULT_BOUNDS,
  KILL_GRACE_MS as WALK_KILL_GRACE_MS,
  REDACT_ENV,
  PLAN_VERDICT_ENV,
  redactionTable,
  runWalk,
  walkerArgv,
  type WalkBounds,
} from "../../../tools/uia/walk.js";
import { MENU_PLAN_VERDICT_ENV, PER_MENU_MS, readMenus } from "../../../tools/uia/menus.js";
import {
  EDITOR_WINDOW_CLASS,
  StopBattery,
  chooseKey,
  deriveId,
  isMainModule,
  kindOf,
  normalizeLabel,
  objectNameOf,
  runWalker,
  type KindNode,
  type LiveKey,
  type LiveObservation,
  type WalkerDef,
  type WalkerStep,
} from "./common.js";

export const ENUMERATOR = "L14";
export const SCRIPT = "scripts/census/live/L14-launcher.ts";
export const MODULE = "Launcher";
export const WALK_STEP = "p4-l14-walk";
export const MENUS_STEP = "p4-l14-menus";
/** Fixed file names inside the run folder (step B reads the walk step A wrote). */
export const WALK_FILE = "L14-launcher-walk.json";
export const MENUS_FILE = "L14-launcher-menus.json";
/** The window the walk targets. The class is the Workbench Qt window class [unverified for the launcher]. */
export const LAUNCHER_CLASS = EDITOR_WINDOW_CLASS;
export const LAUNCHER_TITLE_PATTERN = `^${LAUNCHER_WINDOW_TITLE}`;

// ── Walk and menu documents (the parts this script reads) ────────────────────

export interface WalkNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  enabled?: boolean;
  sampled?: boolean;
  legacyDescription?: string;
  accessKey?: string;
  childCount?: number;
  children?: WalkNode[];
}
export interface WalkDoc {
  refused?: boolean;
  reason?: string;
  completed?: boolean;
  partial?: boolean;
  target?: { className?: string; title?: string };
  tree?: WalkNode;
}
export interface MenuDocItem {
  name?: string;
  controlType?: string;
  acceleratorKey?: string | null;
  submenu?: boolean;
  enabled?: boolean;
}
export interface MenusDoc {
  result?: string;
  menus?: Array<{
    title: string;
    opened?: boolean;
    collapsed?: boolean | null;
    items?: MenuDocItem[];
  }>;
  leftOpen?: string[][];
}

// ── Kernel (the two proven tools, behind an injectable seam) ─────────────────

export interface WalkResult {
  doc: WalkDoc;
  sha256: string;
}
export interface MenusResult {
  doc: MenusDoc;
  sha256: string;
}
export interface LauncherKernel {
  walk(a: {
    pid: number;
    runDir: string;
    allowOwned: boolean;
    ph: PlaceholderContext;
  }): Promise<WalkResult>;
  menus(a: {
    pid: number;
    runDir: string;
    titles: string[];
    /** The policy's titles_by_module list for the Launcher, passed to menus.py as `--allowed` (D11). */
    allowed: readonly string[];
    ph: PlaceholderContext;
  }): Promise<MenusResult>;
  /** The walk step A wrote into this run folder, or null. */
  readWalk(runDir: string): WalkDoc | null;
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Bounds of the launcher walk: the walker defaults (the launcher is small). */
export const WALK_BOUNDS: WalkBounds = { ...DEFAULT_BOUNDS };

export const realKernel: LauncherKernel = {
  async walk({ pid, runDir, allowOwned, ph }) {
    const table = redactionTable(ph, undefined, process.env);
    const done = await runWalk({
      argv: walkerArgv({
        provider: "uia",
        target: {
          pid,
          className: LAUNCHER_CLASS,
          titlePattern: LAUNCHER_TITLE_PATTERN,
          allowOwned,
        },
        bounds: WALK_BOUNDS,
        view: "raw",
        really: true,
      }),
      env: { [REDACT_ENV]: JSON.stringify(table), [PLAN_VERDICT_ENV]: "PASS" },
      timeoutMs: WALK_BOUNDS.budgetMs + 4 * WALK_BOUNDS.callTimeoutMs + WALK_KILL_GRACE_MS,
      outPath: join(runDir, WALK_FILE),
      ctx: ph,
      table,
    });
    if (done.text === null || done.summary.sha256 === null)
      throw new StopBattery(
        "stopped",
        `the launcher walk gave no document: ${done.summary.reason ?? "unknown"}`,
      );
    return { doc: JSON.parse(done.text) as WalkDoc, sha256: done.summary.sha256 };
  },
  async menus({ pid, runDir, titles, allowed, ph }) {
    const table = redactionTable(ph, undefined, process.env);
    const done = await readMenus({
      options: {
        pid,
        className: LAUNCHER_CLASS,
        title: LAUNCHER_TITLE_PATTERN,
        menus: titles,
        module: MODULE,
        allowed,
        depth: 1,
        allowForeground: true,
        really: true,
      },
      provider: "uia",
      env: { [REDACT_ENV]: JSON.stringify(table), [MENU_PLAN_VERDICT_ENV]: "PASS" },
      outPath: join(runDir, MENUS_FILE),
      ctx: ph,
      table,
    });
    if (done.text === null)
      throw new StopBattery(
        "stopped",
        `the launcher menu read gave no document: ${done.stderr || "unknown"}`,
      );
    return { doc: JSON.parse(done.text) as MenusDoc, sha256: sha(done.text) };
  },
  readWalk(runDir) {
    const p = join(runDir, WALK_FILE);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as WalkDoc) : null;
  },
};

// ── Policy: the titles the plan may open ─────────────────────────────────────

/** `live_lane.uia_menu.titles_by_module.Launcher`, or null while main has not added it. */
export function launcherMenuTitles(policy = loadPolicy()): string[] | null {
  const raw = (
    policy.live_lane?.uia_menu as { titles_by_module?: Record<string, unknown> } | undefined
  )?.titles_by_module?.[MODULE];
  return Array.isArray(raw) && raw.length && raw.every((t) => typeof t === "string")
    ? (raw as string[])
    : null;
}

// ── Node to line (design 1.2 and 1.3; D6, D7, D8) ────────────────────────────

interface Rec {
  node: WalkNode;
  path: string;
  parent: number;
  verdict: ReturnType<typeof kindOf>;
  labelRaw: string;
  inDialog: boolean;
  ordinal: number;
}

const EDITABLE = new Set(["Edit", "ComboBox", "CheckBox"]);
const CREDENTIAL = /password|passwd|token|secret|login|log in|sign in|api.?key|credential/i;
const DESTRUCTIVE = /\b(delete|remove|forget|clear)\b/i;
const COMMIT = /\b(open|launch|start|create|new|add|browse|import|play)\b/i;

export interface MappedWalk {
  lines: LiveObservation[];
  /** Direct tree nodes seen but not emitted, by reason (a kind outside L14's, dismissed, deferred, folded). */
  skipped: Record<string, number>;
  menuTitles: string[];
  windowKey: LiveKey | null;
}

/** The title row names of the application MenuBar (not the title-bar System menu). */
export function menuTitlesOf(doc: WalkDoc): string[] {
  const out: string[] = [];
  const visit = (n: WalkNode, depth: number): void => {
    if (n.controlType === "MenuBar" && (n.name ?? "") !== "System") {
      for (const c of n.children ?? [])
        if (c.controlType === "MenuItem" && c.name?.trim()) out.push(c.name);
      return;
    }
    if (depth < 4) for (const c of n.children ?? []) visit(c, depth + 1);
  };
  if (doc.tree) visit(doc.tree, 0);
  return out;
}

/** The launcher walk to raw observation lines. Pure. */
export function walkToLines(doc: WalkDoc, sha256: string, module: string = MODULE): MappedWalk {
  const skipped: Record<string, number> = {};
  const bump = (k: string): void => {
    skipped[k] = (skipped[k] ?? 0) + 1;
  };
  const empty: MappedWalk = { lines: [], skipped, menuTitles: [], windowKey: null };
  if (!doc.tree) return empty;
  const rootClass = doc.tree.className ?? doc.target?.className ?? LAUNCHER_CLASS;
  const recs: Rec[] = [];
  // Pass 1: classify, fold labels, skip window chrome.
  const visit = (
    n: WalkNode,
    path: string,
    parent: number,
    inDialog: boolean,
    siblings: WalkNode[],
    idx: number,
  ): void => {
    const ct = n.controlType;
    const isRoot = parent === -1;
    const parentRec = parent >= 0 ? recs[parent] : null;
    const parentCt = parentRec?.node.controlType;
    const kn: KindNode = {
      controlType: ct,
      className: n.className,
      name: n.name,
      isModuleRoot: isRoot,
      underAppMenuBar:
        ct === "MenuItem" && parentCt === "MenuBar" && (parentRec?.node.name ?? "") !== "System",
      inSystemMenu: false,
      underStatusBar: parentCt === "StatusBar",
      underToolBar: parentCt === "ToolBar",
      underDockOrDialog: inDialog,
      childCount: n.childCount ?? n.children?.length,
      labelsEditable:
        ct === "Text" &&
        siblings.slice(idx + 1).some((s) => EDITABLE.has(s.controlType) && !(s.name ?? "").trim()),
    };
    const verdict = kindOf(kn, ENUMERATOR);
    if (ct === "TitleBar" || ("dismissed" in verdict && verdict.dismissed === "system-menu")) {
      bump(ct === "TitleBar" ? "window chrome (TitleBar subtree)" : "system menu");
      return;
    }
    const idxSelf = recs.length;
    recs.push({ node: n, path, parent, verdict, labelRaw: n.name ?? "", inDialog, ordinal: 0 });
    const nowDialog = inDialog || ("kind" in verdict && verdict.kind === "dialog");
    const kids = n.children ?? [];
    kids.forEach((c, i) => visit(c, `${path}/${i}`, idxSelf, nowDialog, kids, i));
  };
  visit(doc.tree, "0", -1, false, [doc.tree], 0);

  // Folded labels: a standalone Text names the next unnamed editable sibling.
  recs.forEach((r, i) => {
    if (!("foldLabel" in r.verdict) || !r.labelRaw.trim()) return;
    const sibs = recs.filter((x) => x.parent === r.parent);
    const next = sibs
      .slice(sibs.indexOf(r) + 1)
      .find((s) => EDITABLE.has(s.node.controlType) && !s.labelRaw.trim());
    if (next) next.labelRaw = r.labelRaw;
    void i;
  });

  // Ordinals among unnamed siblings of one class (D7 rule 3).
  const seen = new Map<string, number>();
  for (const r of recs) {
    if (!("kind" in r.verdict) || r.labelRaw.trim()) continue;
    const k = `${r.parent}|${r.node.className ?? ""}`;
    r.ordinal = (seen.get(k) ?? 0) + 1;
    seen.set(k, r.ordinal);
  }
  // Object-name uniqueness among the walk's nodes of the same kind.
  const nameCount = new Map<string, number>();
  for (const r of recs) {
    if (!("kind" in r.verdict)) continue;
    const on = objectNameOf(r.node.automationId, r.node.className);
    if (on)
      nameCount.set(`${r.verdict.kind}|${on}`, (nameCount.get(`${r.verdict.kind}|${on}`) ?? 0) + 1);
  }

  // Pass 2: lines.
  const lineOf = new Map<number, LiveObservation>();
  const labelsOf = (i: number): string[] => {
    const out: string[] = [];
    for (let p = recs[i].parent; p >= 0; p = recs[p].parent)
      if (lineOf.has(p)) out.unshift(recs[p].labelRaw);
    return out;
  };
  const ids = new Map<string, number>();
  recs.forEach((r, i) => {
    const v = r.verdict;
    if (!("kind" in v)) {
      bump(
        "dismissed" in v
          ? `dismissed ${v.dismissed}`
          : "foldLabel" in v
            ? "text folded into a control label"
            : "deferred" in v
              ? v.deferred
              : `kind ${v.outOfScope} is not an L14 kind`,
      );
      return;
    }
    const n = r.node;
    const isMenu = v.kind === "menu";
    const ancForKey = labelsOf(i);
    let id = chooseKey(
      {
        automationId: n.automationId,
        className: n.className,
        ancestorLabels: ancForKey,
        name: r.labelRaw,
        unnamedOrdinal: r.ordinal || 1,
      },
      (on) => (nameCount.get(`${v.kind}|${on}`) ?? 0) === 1,
    );
    if (isMenu) id = { key: { path: [r.labelRaw] } };
    const parentLine = r.parent >= 0 ? nearestLine(i) : null;
    function nearestLine(from: number): LiveObservation | null {
      for (let p = recs[from].parent; p >= 0; p = recs[p].parent) {
        const l = lineOf.get(p);
        if (l) return l;
      }
      return null;
    }
    const line: LiveObservation = {
      dim: "ui",
      kind: v.kind,
      module,
      key: id.key,
      parent_key: parentLine
        ? {
            dim: parentLine.dim,
            kind: parentLine.kind,
            module: parentLine.module,
            key: parentLine.key,
          }
        : null,
      origin: "vanilla",
      ...(r.labelRaw.trim() ? { label: normalizeLabel(r.labelRaw), label_raw: r.labelRaw } : {}),
      locator: {
        ...(n.automationId ? { automationId: n.automationId } : {}),
        controlType: n.controlType,
        windowClass: rootClass,
        ...(isMenu ? { menuPath: [r.labelRaw] } : {}),
      },
      observed_state: {},
      modal: "none",
      ref: `artifact:${sha256}#n/${r.path}`,
      confidence: id.confidence ?? "high",
      ...(id.unverified ? { unverified: id.unverified } : {}),
    };
    if (n.legacyDescription) line.quote = n.legacyDescription;
    if (v.kind === "control") {
      const text = `${r.labelRaw} ${n.automationId ?? ""}`;
      if (n.controlType === "Edit" && CREDENTIAL.test(text)) line.risk_hint = "credential";
      else if (n.controlType === "Button") {
        if (CREDENTIAL.test(r.labelRaw)) line.risk_hint = "credential";
        else if (DESTRUCTIVE.test(r.labelRaw)) line.risk_commit_hint = "destructive";
        else if (COMMIT.test(r.labelRaw)) line.risk_commit_hint = "mutating";
        else line.risk_hint = "safe";
        if (r.labelRaw.trim().endsWith("...")) line.modal = "opens";
      } else line.risk_hint = "safe";
    } else if (v.kind === "menu") line.risk_hint = "safe";
    // A duplicate id inside this walk gets an ordinal segment (low confidence), never a silent merge.
    const did = deriveId(line);
    const dup = (ids.get(did) ?? 0) + 1;
    ids.set(did, dup);
    if (dup > 1 && "path" in line.key) {
      const p = line.key.path.slice();
      p[p.length - 1] = `${p[p.length - 1]}@${n.className || "unknown"}.${dup}`;
      line.key = { path: p };
      line.confidence = "low";
      line.unverified = [
        ...(line.unverified ?? []),
        "duplicate label under the same parent; ordinal identity",
      ];
    }
    lineOf.set(i, line);
  });

  // children_count only where every direct child produced a line.
  recs.forEach((r, i) => {
    const l = lineOf.get(i);
    if (!l) return;
    const kids = recs.map((x, j) => ({ x, j })).filter(({ x }) => x.parent === i);
    const declared = r.node.childCount ?? r.node.children?.length ?? 0;
    if (
      kids.length &&
      kids.length === declared &&
      !r.node.sampled &&
      kids.every(({ j }) => lineOf.has(j))
    )
      l.children_count = kids.length;
  });

  const lines = recs
    .map((_, i) => lineOf.get(i))
    .filter((l): l is LiveObservation => l !== undefined);
  return { lines, skipped, menuTitles: menuTitlesOf(doc), windowKey: lines[0]?.key ?? null };
}

/** The `uia-menu` document to `menu-item` / `menu` lines and the title rows with their `children_count`. */
export function menuLines(
  doc: MenusDoc,
  sha256: string,
  windowLine: Pick<LiveObservation, "dim" | "kind" | "module" | "key">,
  module: string = MODULE,
): { lines: LiveObservation[]; unread: string[] } {
  const lines: LiveObservation[] = [];
  const unread: string[] = [];
  for (const m of doc.menus ?? []) {
    if (!m.opened) {
      unread.push(m.title);
      continue;
    }
    const title: LiveObservation = {
      dim: "ui",
      kind: "menu",
      module,
      key: { path: [m.title] },
      parent_key: {
        dim: windowLine.dim,
        kind: windowLine.kind,
        module: windowLine.module,
        key: windowLine.key,
      },
      origin: "vanilla",
      label: normalizeLabel(m.title),
      label_raw: m.title,
      locator: { controlType: "MenuItem", windowClass: LAUNCHER_CLASS, menuPath: [m.title] },
      observed_state: {},
      risk_hint: "safe",
      modal: "none",
      ref: `artifact:${sha256}#m/${m.title}`,
      confidence: "high",
    };
    const named = (m.items ?? []).filter((i) => (i.name ?? "").trim());
    const out: LiveObservation[] = [];
    const seen = new Set<string>();
    const dupes: string[] = [];
    named.forEach((it) => {
      const raw = it.name as string;
      // Same rule as L02 childLines: a second item of one label under one title is noted, not a row.
      if (seen.has(raw)) {
        dupes.push(`"${raw}" appears twice under ${m.title}; only the first is a row`);
        return;
      }
      seen.add(raw);
      const child: LiveObservation = {
        dim: "ui",
        kind: it.submenu ? "menu" : "menu-item",
        module,
        key: { path: [m.title, raw] },
        parent_key: { dim: "ui", kind: "menu", module, key: { path: [m.title] } },
        origin: "vanilla",
        label: normalizeLabel(raw),
        label_raw: raw,
        ...(it.acceleratorKey ? { shortcut_default: it.acceleratorKey } : {}),
        locator: { controlType: "MenuItem", windowClass: LAUNCHER_CLASS, menuPath: [m.title, raw] },
        observed_state: {},
        risk_hint: "safe",
        modal: "none",
        ref: `artifact:${sha256}#m/${m.title}/${raw}`,
        confidence: "high",
      };
      out.push(child);
    });
    if (dupes.length) title.unverified = dupes;
    else if (named.length) title.children_count = out.length;
    else
      title.unverified = [
        "menu items not readable: the reader stops at the popup (menus.py read_items); the L02 descent is pending",
      ];
    lines.push(title, ...out);
  }
  return { lines, unread };
}

// ── Plans ────────────────────────────────────────────────────────────────────

/** The one passive read of the launcher window. */
export function walkPlan(allowOwned: boolean): PlanAction[] {
  return [
    {
      kind: "uia-read",
      target: {
        pid: LANE_RECORDED_PID,
        window: { className: LAUNCHER_CLASS, titlePattern: LAUNCHER_TITLE_PATTERN, allowOwned },
      } as unknown as PlanAction["target"],
      readOnly: true,
      view: "raw",
      bounds: { ...WALK_BOUNDS },
    },
  ];
}

/** The menu read, planned only while the policy lists titles for the Launcher. */
export function menusPlan(module: string, policy = loadPolicy()): PlanAction[] {
  const titles = module === MODULE ? launcherMenuTitles(policy) : null;
  if (!titles) return [];
  return [
    {
      kind: "uia-menu",
      target: { window: { className: LAUNCHER_CLASS, title: LAUNCHER_TITLE_PATTERN } },
      pid: LANE_RECORDED_PID,
      module,
      menus: [...titles],
      depth: 1,
      calls: ["Expand", "Collapse"],
      allowForeground: true,
      timeoutMs: titles.length * PER_MENU_MS * 4,
    },
  ];
}

// ── Steps ────────────────────────────────────────────────────────────────────

export function launcherSteps(
  kernel: LauncherKernel = realKernel,
  policy = loadPolicy(),
): (o: { module: string; allowOwned: boolean }) => WalkerStep[] {
  return ({ module, allowOwned }) => [
    {
      id: WALK_STEP,
      title: "Walk the launcher window (passive uia-read)",
      risk: "read-only",
      timeout_ms: WALK_BOUNDS.budgetMs + 4 * WALK_BOUNDS.callTimeoutMs + WALK_KILL_GRACE_MS,
      expected:
        "one walk of the launcher window; window, control, dialog and menu-title lines (module Launcher); no new window",
      kill_criterion:
        "any new window (a project opened); a dialog-like window; the walk refused or timed out",
      side_effects: [],
      rollback: "none: nothing is sent to the launcher; the owner closes it",
      plan: () => walkPlan(allowOwned),
      run: async (ctx) => {
        const res = await ctx.call("uia-read launcher", () =>
          kernel.walk({
            pid: ctx.pid,
            runDir: ctx.opts.runDir,
            allowOwned: ctx.opts.allowOwned,
            ph: ctx.opts.ph,
          }),
        );
        if (res.doc.refused || !res.doc.tree)
          return { status: "fail", summary: `walk refused: ${res.doc.reason ?? "no tree"}` };
        const m = walkToLines(res.doc, res.sha256, module);
        ctx.emit(m.lines);
        const skipped = Object.entries(m.skipped)
          .map(([k, n]) => `${k} x${n}`)
          .join("; ");
        const partial = res.doc.completed === false || res.doc.partial === true;
        return {
          status: partial ? "observed" : "pass",
          summary: `${m.lines.length} lines, ${m.menuTitles.length} menu titles${partial ? " (walk partial)" : ""}; skipped: ${skipped || "none"}`,
          artifacts: [
            {
              path: toPlaceholders(join(ctx.opts.runDir, WALK_FILE), ctx.opts.ph),
              sha256: res.sha256,
            },
          ],
        };
      },
    },
    {
      id: MENUS_STEP,
      title: "Expand and Collapse each launcher menu title (depth 1)",
      risk: "reversible",
      timeout_ms: Math.max(1, launcherMenuTitles(policy)?.length ?? 1) * PER_MENU_MS * 4 + 15_000,
      expected: "each allow-listed title opened and collapsed, leftOpen empty; menu-item lines",
      kill_criterion:
        "a menu popup still open after Collapse (handoff: the owner presses Esc once by hand); a non-popup new window",
      side_effects: ["menu popups opened and collapsed (Expand and Collapse only)"],
      rollback: "Collapse per title; a leftover popup is closed by the owner",
      popups: true,
      plan: () => menusPlan(module, policy),
      run: async (ctx) => {
        const walk = kernel.readWalk(ctx.opts.runDir);
        const allowed = launcherMenuTitles(policy);
        if (!walk)
          return {
            status: "observed",
            summary: "no launcher walk in this run folder; no menu opened",
          };
        const found = menuTitlesOf(walk);
        if (!found.length)
          return {
            status: "observed",
            summary: "the launcher walk shows no application menu bar; no menu opened",
          };
        if (!allowed)
          return {
            status: "observed",
            summary: `menu titles seen (${found.join(", ")}) but policy titles_by_module.${MODULE} is absent; no menu opened (main adds the titles)`,
          };
        const titles = found.filter((t) => allowed.includes(t));
        const left = found.filter((t) => !titles.includes(t));
        if (!titles.length)
          return {
            status: "observed",
            summary: `no seen title is allow-listed and readable (not opened: ${left.join(", ")})`,
          };
        const res = await ctx.call("uia-menu launcher", () =>
          kernel.menus({ pid: ctx.pid, runDir: ctx.opts.runDir, titles, allowed, ph: ctx.opts.ph }),
        );
        if ((res.doc.leftOpen ?? []).length)
          throw new StopBattery(
            "handoff",
            `a menu popup is still open after Collapse (${res.doc.leftOpen!.map((p) => p.join(" > ")).join("; ")}): the owner presses Esc once by hand`,
          );
        if (res.doc.result !== undefined && res.doc.result !== "ok")
          return { status: "fail", summary: `menu read result ${res.doc.result}` };
        const mapped = walkToLines(walk, "0".repeat(64), module);
        const win = mapped.lines[0];
        const m = menuLines(res.doc, res.sha256, win);
        ctx.emit(m.lines);
        return {
          status: "pass",
          summary: `${m.lines.length} lines from ${titles.length} titles${left.length ? `; not opened: ${left.join(", ")}` : ""}${m.unread.length ? `; unread: ${m.unread.join(", ")}` : ""}`,
          artifacts: [
            {
              path: toPlaceholders(join(ctx.opts.runDir, MENUS_FILE), ctx.opts.ph),
              sha256: res.sha256,
            },
          ],
        };
      },
    },
  ];
}

export const def: WalkerDef = {
  enumerator: ENUMERATOR,
  script: SCRIPT,
  session: "P4-7",
  defaultModule: MODULE,
  steps: (o) => launcherSteps()({ module: o.module, allowOwned: o.allowOwned }),
};

if (isMainModule(import.meta.url)) {
  runWalker(def, process.argv.slice(2)).then((code) => process.exit(code));
}
