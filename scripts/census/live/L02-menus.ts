/**
 * L02, the menu walk (Phase 4 design §2, §4; plan 4.5). Per module and state, one step per
 * menu-bar title: `tools/uia/menus.ts` Expands the title, reads its items inside the QMenu popup
 * (the `read_items` descent), Expands and reads each sub-menu one level down (depth 1), and
 * Collapses everything it opened. Nothing is ever invoked, typed or keyed; the titles come from
 * the policy's `live_lane.uia_menu.titles_by_module[<module>]` (D11), never from this file.
 *
 *   npx --no tsx scripts/census/live/L02-menus.ts [--module WorldEditor] [--state mode=edit,...]
 *       [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/census/live/L02-menus.ts --really --id <lane> --sandbox <dir>
 *       --run-dir <dir> --module <ModuleId> [--state ...] [--from|--only <step>]
 *
 * Each step writes the redacted menus document `<run>/<step>-menus.json` (the D4 ref artifact) and
 * appends `menu` / `menu-item` lines to `<run>/L02-<Module>-<stateTag>.obs.jsonl`:
 *   - a title: kind `menu`, key path [title], parent the module window (object name from the
 *     popup's automation id, else MODULE_WINDOWS), `children_count` when every item was read;
 *   - an item: kind `menu` when it opens a sub-menu, else `menu-item`; key path [title, label]
 *     (an unnamed item `@<className>.<n>`, low confidence); `shortcut_default` from the
 *     AcceleratorKey, else Qt's AccessKey (which carries the shortcut, sf file-menu walk: "Save"
 *     AccessKey "Ctrl+S"), else the text after a tab; a label ending "..." gets `modal: "opens"`;
 *     disabled and checked states go to `unverified` (the schema has no field for them);
 *   - Separators are not rows; a same-named sibling after the first is not a row (noted).
 * `observed_state` carries only the axes `data/census/state-matrix.json` declares for `menu` in
 * that module (World Editor: `mode`), `{}` where none is declared (D8).
 *
 * Stops (D13): a popup left open after Collapse is a HANDOFF (the owner presses Esc once, by
 * hand); a new owned window or a disabled main window is a HANDOFF; any other new window, a
 * refusal or a missing document is a STOP. The window watch of common.ts runs around every step.
 * The ParticleEditor is never read (DEC-042).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANE_RECORDED_PID, type PlanAction } from "../../live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../live/policy.js";
import {
  buildMenuPlan,
  main as menusMain,
  menuTimeoutMs,
  titlesFor,
  KILL_GRACE_MS,
} from "../../../tools/uia/menus.js";
import {
  MODULE_TITLES,
  chooseKey,
  isMainModule,
  normalizeLabel,
  runWalker,
  stateFor,
  stateTag,
  StopBattery,
  type LiveObservation,
  type ObservedState,
  type WalkerDef,
  type WalkerStep,
  windowLine,
  windowParentKey,
  moduleWindowObjectName,
} from "./common.js";

export const ENUMERATOR = "L02";
export const SCRIPT = "scripts/census/live/L02-menus.ts";
export const SESSION = "P4-1";
export const DEPTH = 1 as const;

/**
 * Root automationId object names (`Arma4WorkbenchApp.<name>`) read from sitting P4-2 L01 walks
 * (2026-10-12), plus WorldEditor (P3-3 p33-g2-04). The fallback when a popup carries no id;
 * a module not listed falls back to its module id [unverified].
 */
export const OBJECT_NAMES: Readonly<Record<string, string>> = {
  WorldEditor: "worldEditorMain",
  ResourceManager: "ResourceManagerMain",
  ScriptEditor: "ScriptEditorMain",
  LocalizationEditor: "LocalizationEditorMain",
  BehaviorEditor: "BehaviorEditorMain",
  AudioEditor: "AudioEditorMainWindow",
  AnimEditor: "AnimEditor",
  ProcAnimEditor: "ProcAnimEditorMainWindow",
};

/**
 * The module windows L02 can address: Win32 class, title regex, object name fallback. Titles come
 * from the one table, common.ts MODULE_TITLES (P4-FIX-H: L02 kept a two-module table of its own).
 */
export const MODULE_WINDOWS: Readonly<
  Record<string, { className: string; title: string; objectName: string }>
> = Object.fromEntries(
  Object.entries(MODULE_TITLES)
    .filter(([m]) => m !== "ParticleEditor")
    .map(([m, t]) => [
      m,
      { className: "Qt683QWindowIcon", title: t.pattern, objectName: OBJECT_NAMES[m] ?? m },
    ]),
);

/** Modules L02 never reads (DEC-042: the Particle Editor is opened and fronted only). */
export const NEVER_READ: ReadonlySet<string> = new Set(["ParticleEditor"]);

// ── The menus document (tools/uia/menus.py, schema emcp-uia-menus/1) ────────

export interface MenuItemDoc {
  controlType: string | null;
  name: string;
  className?: string | null;
  automationId?: string | null;
  enabled?: boolean | null;
  checked?: boolean | null;
  acceleratorKey?: string | null;
  accessKey?: string | null;
  submenu?: boolean;
  opened?: boolean;
  collapsed?: boolean;
  /** Read open after Collapse, closed by itself on menus.py's late re-check (nothing sent). */
  closedLate?: boolean;
  children?: MenuItemDoc[];
  popup?: PopupDoc;
}
export interface PopupDoc {
  count: number;
  automationIds: string[];
  classNames: string[];
  truncated: boolean;
}
export interface MenuEntryDoc {
  title: string;
  opened: boolean;
  collapsed: boolean | null;
  closedLate?: boolean;
  items: MenuItemDoc[];
  popup?: PopupDoc;
  skipped?: string;
}
export interface MenusDoc {
  schema?: string;
  result?: string;
  reason?: string;
  handoff?: string;
  dry_run?: boolean;
  target?: { className?: string; title?: string };
  menus?: MenuEntryDoc[];
  leftOpen?: string[][];
  newWindows?: Array<{ className: string; title: string; owned: boolean }>;
  calls?: Array<{ call: string; path: string[] }>;
}

// ── Reading through tools/uia/menus.ts ──────────────────────────────────────

export interface MenuReadRequest {
  pid: number;
  module: string;
  className: string;
  title: string;
  menu: string;
  allowed: readonly string[];
  depth: 0 | 1;
  out: string;
  /** The run's lane (ctx.lane), passed on to menus.ts. */
  lane?: LaneArgs;
}
export interface MenuReadResult {
  code: number;
  doc: MenusDoc | null;
  text: string | null;
}
export type MenuReader = (r: MenuReadRequest) => Promise<MenuReadResult>;

/** The lane flags passed through to menus.ts (its live gate and recorded-pid check). */
export interface LaneArgs {
  id?: string;
  leasePath?: string;
  markerPath?: string;
}

/** menus.ts argv for one title (the same tool S-F ran; `--fake-tree` for tests). */
export function menusToolArgv(r: MenuReadRequest, lane: LaneArgs, fakeTree?: string): string[] {
  const argv = [
    "--pid",
    String(r.pid),
    "--class",
    r.className,
    "--title",
    r.title,
    "--menus",
    r.menu,
    "--module",
    r.module,
    "--depth",
    String(r.depth),
    "--allow-foreground",
    "--out",
    r.out,
    "--label",
    `l02-${r.menu}`,
  ];
  if (fakeTree) argv.push("--fake-tree", fakeTree);
  else {
    if (lane.id) argv.push("--id", lane.id);
    if (lane.leasePath) argv.push("--lease-path", lane.leasePath);
    if (lane.markerPath) argv.push("--marker-path", lane.markerPath);
  }
  argv.push("--really");
  return argv;
}

/** A reader that runs menus.ts in this process and reads its artifact back (lane: the request's). */
export function menusToolReader(lane: LaneArgs = {}, fakeTree?: string): MenuReader {
  return async (r) => {
    const code = await menusMain(menusToolArgv(r, r.lane ?? lane, fakeTree));
    if (!existsSync(r.out)) return { code, doc: null, text: null };
    const text = readFileSync(r.out, "utf-8");
    let doc: MenusDoc | null = null;
    try {
      doc = JSON.parse(text) as MenusDoc;
    } catch {
      doc = null;
    }
    return { code, doc, text };
  };
}

// ── Lines ────────────────────────────────────────────────────────────────────

const MNEMONIC = /^Alt\+\S$/i;
export const DISABLED_NOTE = "disabled when read in this state";
export const CHECKED_NOTE = "checked when read in this state";
export const OPENS_NOTE =
  'modal "opens" from the "..." label suffix (Qt convention); never invoked';
export const ACCESSKEY_NOTE = "shortcut read from the AccessKey property (Qt), not AcceleratorKey";

/** Label and shortcut of a menu item name ("Save\tCtrl+S" carries both). */
export function splitName(name: string): { label: string; shortcut?: string } {
  const i = name.indexOf("\t");
  if (i < 0) return { label: name };
  const sc = name.slice(i + 1).trim();
  return sc ? { label: name.slice(0, i), shortcut: sc } : { label: name.slice(0, i) };
}

/** The window object name from a popup automation id (`Arma4WorkbenchApp.<main>.…`). */
export function windowObjectName(module: string, popup?: PopupDoc): string {
  for (const a of popup?.automationIds ?? []) {
    if (a.split(".").length < 3) continue;
    const seg = moduleWindowObjectName(a, false);
    if (seg) return seg;
  }
  return MODULE_WINDOWS[module]?.objectName ?? module;
}

export interface LineContext {
  module: string;
  state: ObservedState;
  sha: string;
  windowClass?: string;
}

interface Built {
  lines: LiveObservation[];
  complete: boolean;
}

function refOf(sha: string, path: string[]): string {
  return `artifact:${sha}#m/${path.join("/")}`;
}

/** The child lines of one opened menu (a title or a sub-menu) and whether every child became one. */
function childLines(
  ctx: LineContext,
  parentPath: string[],
  items: readonly MenuItemDoc[],
  popup: PopupDoc | undefined,
  notes: string[],
): Built {
  const lines: LiveObservation[] = [];
  let complete = !(popup?.truncated ?? false);
  const seen = new Set<string>();
  const unnamed = new Map<string, number>();
  const parentKey = {
    dim: "ui",
    kind: "menu" as const,
    module: ctx.module,
    key: { path: parentPath },
  };
  for (const it of items) {
    if (it.controlType === "Separator") continue;
    if (it.controlType !== "MenuItem") {
      complete = false;
      notes.push(
        `a ${it.controlType ?? "?"} node under ${parentPath.join(" > ")} was not read as an item`,
      );
      continue;
    }
    const { label, shortcut: tabShortcut } = splitName(it.name ?? "");
    const cls = it.className ?? "QAction";
    let ordinal: number | undefined;
    if (!label.trim()) {
      ordinal = (unnamed.get(cls) ?? 0) + 1;
      unnamed.set(cls, ordinal);
    }
    const id = chooseKey(
      { className: cls, ancestorLabels: parentPath, name: label, unnamedOrdinal: ordinal },
      () => false,
    );
    const keyPath = (id.key as { path: string[] }).path;
    const segment = keyPath[keyPath.length - 1];
    if (seen.has(segment)) {
      complete = false;
      notes.push(
        `"${segment}" appears twice under ${parentPath.join(" > ")}; only the first is a row`,
      );
      continue;
    }
    seen.add(segment);
    const unverified = [...(id.unverified ?? [])];
    let shortcut: string | undefined;
    if (it.acceleratorKey) shortcut = it.acceleratorKey;
    else if (it.accessKey && !MNEMONIC.test(it.accessKey)) {
      shortcut = it.accessKey;
      unverified.push(ACCESSKEY_NOTE);
    } else if (tabShortcut) shortcut = tabShortcut;
    if (it.enabled === false) unverified.push(DISABLED_NOTE);
    if (it.checked === true) unverified.push(CHECKED_NOTE);
    const opens = label.trim().endsWith("...");
    if (opens) unverified.push(OPENS_NOTE);
    const isSub = Boolean(it.submenu);
    let sub: Built | null = null;
    if (isSub && it.opened && it.collapsed && it.children)
      sub = childLines(ctx, keyPath, it.children, it.popup, notes);
    const line: LiveObservation = {
      dim: "ui",
      kind: isSub ? "menu" : "menu-item",
      module: ctx.module,
      key: { path: keyPath },
      parent_key: parentKey,
      origin: "vanilla",
      ...(label.trim() ? { label: normalizeLabel(label), label_raw: label } : {}),
      ...(shortcut ? { shortcut_default: shortcut } : {}),
      locator: {
        menuPath: keyPath,
        controlType: "MenuItem",
        ...(ctx.windowClass ? { windowClass: ctx.windowClass } : {}),
      },
      observed_state: ctx.state,
      ...(sub && sub.complete ? { children_count: countDirect(sub.lines, keyPath) } : {}),
      ...(opens ? { modal: "opens" as const } : {}),
      ref: refOf(ctx.sha, keyPath),
      confidence: id.confidence ?? "high",
      ...(unverified.length ? { unverified } : {}),
    };
    lines.push(line);
    if (sub) lines.push(...sub.lines);
  }
  return { lines, complete };
}

function countDirect(lines: readonly LiveObservation[], parentPath: string[]): number {
  const want = JSON.stringify(parentPath);
  return lines.filter(
    (l) => l.parent_key && JSON.stringify((l.parent_key.key as { path?: string[] }).path) === want,
  ).length;
}

/** The obs lines of one menus document (every title it opened and read). */
export function menuLines(
  doc: MenusDoc,
  ctx: Omit<LineContext, "windowClass">,
): {
  lines: LiveObservation[];
  notes: string[];
} {
  const out: LiveObservation[] = [];
  const notes: string[] = [];
  const c: LineContext = { ...ctx, windowClass: doc.target?.className };
  for (const e of doc.menus ?? []) {
    if (e.closedLate) notes.push(`${e.title} closed late (by itself, after the re-check)`);
    for (const it of e.items ?? [])
      if (it.closedLate)
        notes.push(`${e.title} > ${it.name} closed late (by itself, after the re-check)`);
    if (e.skipped || !e.opened || !e.collapsed) continue;
    const titlePath = [e.title];
    const kids = childLines(c, titlePath, e.items ?? [], e.popup, notes);
    out.push({
      dim: "ui",
      kind: "menu",
      module: ctx.module,
      key: { path: titlePath },
      parent_key: windowParentKey(ctx.module, windowObjectName(ctx.module, e.popup)),
      origin: "vanilla",
      label: normalizeLabel(e.title),
      label_raw: e.title,
      locator: {
        menuPath: titlePath,
        controlType: "MenuItem",
        ...(c.windowClass ? { windowClass: c.windowClass } : {}),
      },
      observed_state: ctx.state,
      ...(kids.complete ? { children_count: countDirect(kids.lines, titlePath) } : {}),
      risk_hint: "safe",
      modal: "none",
      ref: refOf(ctx.sha, titlePath),
      confidence: "high",
    });
    out.push(...kids.lines);
  }
  return { lines: out, notes };
}

/**
 * The module window row the title rows name as parent (common.ts windowParentKey), so the parent
 * exists even where no L01 or L03 ran (Resource Manager in P4-1). Null when no title was read.
 */
export function menusWindowLine(
  doc: MenusDoc,
  ctx: { module: string; state: ObservedState; sha: string },
): LiveObservation | null {
  const e = (doc.menus ?? []).find((m) => !m.skipped && m.opened && m.collapsed);
  if (!e) return null;
  return windowLine(ctx.module, windowObjectName(ctx.module, e.popup), {
    ref: `artifact:${ctx.sha}#w`,
    observed_state: stateFor(ctx.module, "window", ctx.state),
    ...(doc.target?.className ? { windowClass: doc.target.className } : {}),
  });
}

/** The stop a menus document calls for, or null when the step may emit (D13). */
export function stopFor(r: MenuReadResult, out: string): StopBattery | null {
  const d = r.doc;
  const where = `menus document ${out}`;
  if (!d) return new StopBattery("stopped", `menus.ts gave no document (exit ${r.code}); ${where}`);
  const left = d.leftOpen ?? [];
  if (left.length)
    return new StopBattery(
      "handoff",
      `a popup is still open after Collapse (${left.map((p) => p.join(" > ")).join("; ")}): the owner presses Esc once, by hand; ${where}`,
      { leftOpen: left },
    );
  if (d.result === "ok") return null;
  const reason = d.reason ?? d.result ?? "unknown";
  if (d.result === "refused-auth-window")
    return new StopBattery(
      "handoff",
      `Script Authorization Required is up; never answered by a script: ${reason}`,
    );
  if (d.result === "stopped") {
    const owned = (d.newWindows ?? []).some((w) => w.owned);
    if (owned || /disabled/.test(reason))
      return new StopBattery(
        "handoff",
        `a dialog-like window: ${reason}; the owner looks and closes it by hand`,
        {
          newWindows: d.newWindows ?? [],
        },
      );
    return new StopBattery("stopped", `${reason}; touch nothing`, {
      newWindows: d.newWindows ?? [],
    });
  }
  return new StopBattery("stopped", `menus.ts ${d.result}: ${reason}`);
}

// ── Steps ────────────────────────────────────────────────────────────────────

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The step id of one title in one module and state. */
export function stepId(module: string, title: string, state: ObservedState): string {
  return `p4-l02-${slug(module)}-${slug(title)}-${stateTag(state)}`;
}

export interface L02Options {
  policy?: CensusPolicy;
  reader?: MenuReader;
  stateMatrix?: string;
}

/** The plan action of one title: menus.ts's own buildMenuPlan, pid left to the lane's record. */
export function titlePlan(module: string, title: string, step: string): PlanAction[] {
  const w = MODULE_WINDOWS[module];
  return buildMenuPlan({
    pid: 1,
    className: w.className,
    title: w.title,
    menus: [title],
    module,
    depth: DEPTH,
    allowForeground: true,
  }).map((a) => ({ ...a, step, pid: LANE_RECORDED_PID }));
}

export function l02Steps(
  sel: { module: string; state: ObservedState },
  o: L02Options = {},
): WalkerStep[] {
  const { module, state } = sel;
  if (NEVER_READ.has(module) || !MODULE_WINDOWS[module]) return [];
  const titles = titlesFor(o.policy ?? loadPolicy(), module);
  if (!titles) return [];
  const w = MODULE_WINDOWS[module];
  const reader = o.reader ?? menusToolReader();
  return titles.map((title): WalkerStep => {
    const id = stepId(module, title, state);
    return {
      id,
      title: `${module} menu ${title}: Expand, read items and sub-menus (depth ${DEPTH}), Collapse`,
      risk: "reversible",
      timeout_ms: menuTimeoutMs({ menus: [title], depth: DEPTH }) + KILL_GRACE_MS,
      expected: `${title} opens, its items are read inside the popup, every popup collapses (leftOpen empty)`,
      kill_criterion:
        "a new window that is not the popup pair, a dialog-like or disabled window, a popup left open after Collapse, a timeout",
      side_effects: [],
      rollback:
        "Collapse by the tool itself; a popup left open: the owner presses Esc once, by hand",
      popups: true,
      plan: () => titlePlan(module, title, id),
      run: async (ctx) => {
        const out = join(ctx.opts.runDir, `${id}-menus.json`);
        const r = await ctx.call("uia-menu", () =>
          reader({
            pid: ctx.pid,
            module,
            className: w.className,
            title: w.title,
            menu: title,
            allowed: titles,
            depth: DEPTH,
            out,
            lane: ctx.lane,
          }),
        );
        const stop = stopFor(r, out);
        if (stop) throw stop;
        const text = r.text ?? "";
        const sha = createHash("sha256").update(text, "utf-8").digest("hex");
        const artifacts = [{ path: out, sha256: sha }];
        const entry = r.doc!.menus?.find((m) => m.title === title);
        if (!entry || entry.skipped)
          return {
            status: "fail",
            summary: `${title}: ${entry?.skipped ?? "no entry"}`,
            artifacts,
          };
        const projected = o.stateMatrix
          ? stateFor(module, "menu", state, o.stateMatrix)
          : stateFor(module, "menu", state);
        const { lines, notes } = menuLines(r.doc!, { module, state: projected, sha });
        if (lines.length <= 1)
          return {
            status: "fail",
            summary:
              `${title}: no item read inside the popup (popups ${entry.popup?.count ?? 0}); ${notes.join("; ")}`.trim(),
            artifacts,
          };
        const win = menusWindowLine(r.doc!, { module, state, sha });
        ctx.emit(win ? [win, ...lines] : lines);
        const items = lines.length - 1;
        return {
          status: notes.length ? "observed" : "pass",
          summary: `${title}: ${items} item line(s), popups ${entry.popup?.count ?? 0}${notes.length ? `; ${notes.join("; ")}` : ""}`,
          artifacts,
        };
      },
    };
  });
}

export function l02Def(o: L02Options = {}): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    session: SESSION,
    script: SCRIPT,
    defaultModule: "WorldEditor",
    steps: (sel) => l02Steps(sel, o),
  };
}

export async function main(argv: string[], o: L02Options = {}): Promise<number> {
  const mi = argv.indexOf("--module");
  const module = mi >= 0 ? argv[mi + 1] : "WorldEditor";
  if (module && NEVER_READ.has(module)) {
    console.log(`${module} is never read (DEC-042)`);
    return 2;
  }
  if (module && !MODULE_WINDOWS[module]) {
    console.log(
      `${module}: no module window known to L02 (MODULE_WINDOWS); main adds it from its L01 walk`,
    );
    return 2;
  }
  if (module && !titlesFor(o.policy ?? loadPolicy(), module)) {
    console.log(
      `${module} has no live_lane.uia_menu.titles_by_module entry; main adds it from its L01 walk`,
    );
    return 2;
  }
  return runWalker(l02Def(o), argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((c) => process.exit(c));
}
