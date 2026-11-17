/**
 * L04, the dialog census (design `docs/v2/design/phase4-live-census.md` sections 2.2, 2.4, D9, D14,
 * 3.1 step 4; owner rulings 1 and 2 of 2026-10-10). One step per dialog:
 *
 *   p4-l04-d14-options   the first step of a sitting: opens Options by its allow-listed opener
 *                        (`execute-action` with `opensDialog: true`, on `live_lane.dialog_openers`),
 *                        walks it with `--allow-owned`, presses its Cancel (`uia-dialog-cancel`, the
 *                        policy exception `p4-d14-options-cancel`) and passes when the window is gone
 *                        within 5 s. The registry comparison of D14 is the owner's and main's.
 *   p4-l04-open-<slug>   one per further path on `live_lane.dialog_openers.paths`: open, walk, then
 *                        Cancel by script only when D14 passed in this run folder and the policy has a
 *                        cancel exception for that dialog; otherwise (and always with `--owner-closes`)
 *                        a HANDOFF after the walk: the owner presses Cancel.
 *   p4-l04-l1-<slug>     Appendix B list 1 (Create World, Create Terrain, Save World As, Pack Project,
 *                        Publish, Login): owner-opened. Runs only with `--owner-done` (the owner's one
 *                        go for the block, ruling 2); the step waits for the owner's click, walks the
 *                        dialog, then hands off for the owner's Cancel. No opener is ever planned.
 *
 * Nothing is typed, no key is sent, no menu leaf is invoked through UIA, no prompt is answered;
 * credential fields are recorded passively (`risk_hint: "credential"`). Observation lines follow
 * design 1.2 and 1.3 through common.ts (`kindOf`, `chooseKey`, `validateLine` via `ctx.emit`).
 *
 *   npx --no tsx scripts/census/live/L04-dialogs.ts [--out <plan.json>] [--outline <file>]
 *       [--owner-closes] [--owner-done]
 *   npx --no tsx scripts/census/live/L04-dialogs.ts --really --id <lane> --sandbox <dir>
 *       --run-dir <dir> --module WorldEditor --allow-owned (--from|--only <step>)
 *       [--owner-closes] [--owner-done]
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlan, LANE_RECORDED_PID, type PlanAction } from "../../live/dry-run.js";
import { DEFAULT_PORT } from "../../live/netcall.js";
import { REPO_ROOT } from "../../live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../live/policy.js";
import { runPowerShell } from "../../live/powershell.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../live/s-c-natives.js";
import { DIALOG_COMMIT_BUTTONS } from "../../../src/tools/wb-gui.js";
import { runModule } from "../../../src/tools/wb-module.js";
import { WorkbenchClient } from "../../../src/workbench/client.js";
import { DEFAULT_BOUNDS, type WalkBounds } from "../../../tools/uia/walk.js";
import {
  EDITOR_WINDOW_CLASS,
  EXIT,
  StopBattery,
  chooseKey,
  isMainModule,
  kindOf,
  laneArgv,
  normalizeLabel,
  objectNameOf,
  runWalker,
  selectWalkerSteps,
  walkerRecordPath,
  windowVerdict,
  type LiveKind,
  type LiveKey,
  type LiveObservation,
  type RunWalkerOverrides,
  type WalkerDef,
  type WalkerStep,
  type WalkerLane,
  type WalkerStepContext,
} from "./common.js";

export const SCRIPT = "scripts/census/live/L04-dialogs.ts";
export const ENUMERATOR = "L04";
export const D14_STEP = "p4-l04-d14-options";

/** The Options opener (S-F file-menu-owner-2 walk: File > Options...); its WE path is [unverified]. */
export const OPTIONS_OPENER: readonly string[] = ["File", "Options..."];
export const OPTIONS_TITLE = "Options";
/** D14: the window must be gone this long after the Cancel. */
export const D14_GONE_MS = 5_000;
/** How long an opened dialog may take to appear. */
export const DIALOG_APPEAR_MS = 15_000;
/** How long a list 1 step waits for the owner's click. */
export const OWNER_WAIT_MS = 600_000;
/** The window poll inside a step. */
export const POLL_MS = 1_000;
/** The walk's bounds: walk.ts defaults (rowSample 40), allowOwned set. */
export const WALK_BOUNDS: WalkBounds = { ...DEFAULT_BOUNDS };

/**
 * Appendix B list 1 (policy `deny_lists.openers_main_never_invokes`), owner ruling 2. `opener` is
 * the deny-listed label the owner clicks; `title` the expected window title [unverified until the
 * first live run: a different title is a HANDOFF, and main corrects it here].
 */
export const LIST1: ReadonlyArray<{
  slug: string;
  opener: string;
  title: string;
  credential?: boolean;
}> = [
  { slug: "create-world", opener: "New World", title: "Create World" },
  { slug: "create-terrain", opener: "Create Terrain", title: "Create Terrain" },
  { slug: "save-world-as", opener: "Save World As", title: "Save World As" },
  { slug: "pack-project", opener: "Pack Project", title: "Pack Project" },
  { slug: "publish", opener: "Publish Project", title: "Publish", credential: true },
  { slug: "login", opener: "Login", title: "Login", credential: true },
];

// ── Walk document (tools/uia/walk.ts, schema emcp-uia-walk/1) ────────────────

export interface WalkNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  childCount?: number;
  gridRowCount?: number;
  legacyDescription?: string;
  children?: WalkNode[];
}

export interface WalkDoc {
  completed?: boolean | null;
  partial?: boolean | null;
  sampling?: { applied?: Array<{ path?: string } | string> };
  target?: { className?: string };
  tree: WalkNode;
}

// ── Kernels (injected by the test; real ones below) ──────────────────────────

export interface L04Kernel {
  /** Every top-level window (s-c-natives WINDOWS_SCRIPT). */
  windows: () => Promise<WindowInfo[]>;
  /** The allow-listed opener through `wb_module action` (an ExecuteAction). */
  open: (module: string, menuPath: readonly string[]) => Promise<unknown>;
  /** walk.ts `--allow-owned --hwnd` on one window of the recorded pid. */
  walk: (
    t: { pid: number; hwnd: number; className: string; titlePattern: string; lane?: WalkerLane },
    outPath: string,
  ) => Promise<{ doc: WalkDoc; path: string; sha256: string }>;
  /** One UIA Invoke on the only Button named exactly "Cancel" in that window. */
  cancel: (t: { pid: number; hwnd: number }) => Promise<{ invoked: boolean; detail: string }>;
  /** A step record of this run folder, or null. */
  readText: (path: string) => string | null;
}

export interface L04Config {
  policy: CensusPolicy;
  ownerCloses: boolean;
  ownerDone: boolean;
  /** The run's kernel, on the handler port of the run (`ctx.port`). */
  kernel: (port?: number) => L04Kernel;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const pathKey = (p: readonly string[]): string => p.map(normalizeLabel).join("/");

/** The dialog title an opener is expected to show: its last segment without "..." or "&". */
export function titleOfOpener(path: readonly string[]): string {
  return (path[path.length - 1] ?? "")
    .replace(/&/g, "")
    .replace(/(\.\.\.|…)\s*$/, "")
    .trim();
}

export function slugOf(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "dialog"
  );
}

/** The allow-listed openers of the policy, as label arrays. */
export function dialogOpeners(policy: CensusPolicy): string[][] {
  const raw = (policy.live_lane?.dialog_openers as { paths?: unknown } | undefined)?.paths;
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => (Array.isArray(p) ? p.map(String) : String(p).split(/\s*>\s*/)));
}

/** The Appendix B list 1 labels of the policy. */
export function list1Labels(policy: CensusPolicy): string[] {
  const d = (policy as unknown as Record<string, unknown>).deny_lists as
    | Record<string, { labels?: string[] }>
    | undefined;
  return d?.openers_main_never_invokes?.labels ?? [];
}

function readAction(title: string): PlanAction {
  return {
    kind: "uia-read",
    target: {
      pid: LANE_RECORDED_PID,
      window: {
        className: EDITOR_WINDOW_CLASS,
        titlePattern: `^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        allowOwned: true,
      },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: { ...WALK_BOUNDS },
  };
}

function openAction(module: string, path: readonly string[]): PlanAction {
  return { kind: "execute-action", target: { path: [...path], module }, opensDialog: true };
}

/** The id of this script's dry_run exception for a scripted Cancel on `title`, or undefined. */
export function cancelExceptionId(policy: CensusPolicy, title: string): string | undefined {
  return (policy.dry_run?.exceptions ?? []).find(
    (e) =>
      e.script === SCRIPT &&
      e.allows === "uia-dialog-cancel-not-allow-listed" &&
      e.target?.titleMatches === title &&
      e.target?.windowClassMatches === EDITOR_WINDOW_CLASS,
  )?.id;
}

function cancelAction(title: string, exception?: string): PlanAction {
  return {
    ...(exception ? { exception } : {}),
    kind: "uia-dialog-cancel",
    target: {
      pid: LANE_RECORDED_PID,
      window: { className: EDITOR_WINDOW_CLASS, title, owned: true },
    },
    button: "Cancel",
    calls: ["Invoke"],
  };
}

/** True when the policy lets this script press Cancel on `title` (its dry_run exception). */
export function cancelAllowed(policy: CensusPolicy, title: string): boolean {
  const ex = cancelExceptionId(policy, title);
  return ex !== undefined && checkPlan([cancelAction(title, ex)], policy, { script: SCRIPT }).ok;
}

/**
 * True when the handler would send `path`: EMCP_WB_ActionAllowList.c is generated from
 * execute_action.allow_list only (gen-action-allowlist.ts), and EMCP_WB_Module.c matches the
 * newline-joined path exactly; anything else answers NOT_ALLOWLISTED.
 */
export function handlerAllowed(policy: CensusPolicy, path: readonly string[]): boolean {
  const want = path.join("\n");
  return (policy.execute_action?.allow_list ?? []).some((e) => {
    const p = Array.isArray(e) ? e : e.split(">").map((x) => x.trim());
    return p.join("\n") === want;
  });
}

/**
 * True when the policy lists `path` as a dialog opener, it holds no deny-listed label (the dry
 * run, which checks live_lane.dialog_openers only) and the handler-side allow list has it too.
 */
export function openerAllowed(policy: CensusPolicy, module: string, path: readonly string[]) {
  return (
    checkPlan([openAction(module, path)], policy, { script: SCRIPT }).ok &&
    handlerAllowed(policy, path)
  );
}

// ── Node-to-row mapping (design 1.2, 1.3) ───────────────────────────────────

interface Draft {
  node: WalkNode;
  treePath: string;
  kind: LiveKind;
  parent: number | null;
  /** Label used in children's key paths. */
  name: string;
  labelRaw?: string;
  incomplete: boolean;
  sampledNote?: string;
}

const EDITABLE = new Set(["Edit", "ComboBox", "CheckBox"]);
const CHROME = new Set(["TitleBar", "ScrollBar", "Thumb", "Header", "MenuBar"]);

/** A grid, list or tree whose rows were not all read: its items are not rows (design 1.2). */
function sampledContainer(n: WalkNode, sampledPaths: Set<string>, treePath: string): boolean {
  if (!["Tree", "Table", "List", "DataGrid"].includes(n.controlType)) return false;
  const kids = n.children?.length ?? 0;
  const grid = n.gridRowCount ?? 0;
  return (
    sampledPaths.has(treePath) ||
    grid > WALK_BOUNDS.rowSample ||
    (grid > 0 && grid > kids) ||
    (n.childCount !== undefined && n.childCount > kids)
  );
}

export interface DialogLinesInput {
  doc: WalkDoc;
  sha256: string;
  module: string;
  title: string;
  credential?: boolean;
  /** The walk's target window class (locator.windowClass). */
  windowClass?: string;
}

/**
 * The L04 lines of one dialog walk: the dialog row, its tabs (page list beside a QStackedWidget,
 * D9), controls and property groups. Chrome (title bar, system menu, scroll bars) gives no row;
 * a sampled data container gets a row without `children_count`; `observed_state` is `{}` (the state
 * matrix declares no axis for dialogs, D8).
 */
export function dialogLines(i: DialogLinesInput): LiveObservation[] {
  const sampledPaths = new Set(
    (i.doc.sampling?.applied ?? []).map((a) => (typeof a === "string" ? a : String(a.path ?? ""))),
  );
  const complete = i.doc.completed !== false && i.doc.partial !== true;
  const drafts: Draft[] = [];
  const root = i.doc.tree;
  drafts.push({
    node: root,
    treePath: "0",
    kind: "dialog",
    parent: null,
    name: i.title,
    labelRaw: root.name || i.title,
    incomplete: !complete,
  });

  const visit = (n: WalkNode, tp: string, parent: number): void => {
    const kids = n.children ?? [];
    const pageList = kids.some((k) => k.className === "QStackedWidget");
    kids.forEach((c, idx) => {
      const path = `${tp}/${idx}`;
      if (CHROME.has(c.controlType)) return;
      if (c.controlType === "Text") {
        const v = kindOf(
          {
            controlType: "Text",
            name: c.name,
            labelsEditable: kids.some((k) => EDITABLE.has(k.controlType)),
          },
          ENUMERATOR,
        );
        if ("foldLabel" in v && c.name?.trim()) {
          const after = kids.slice(idx + 1).find((k) => EDITABLE.has(k.controlType));
          const target =
            after ?? [...kids.slice(0, idx)].reverse().find((k) => EDITABLE.has(k.controlType));
          if (target && !target.name?.trim())
            (target as WalkNode & { _label?: string })._label = c.name;
        }
        return;
      }
      if (pageList && c.controlType === "List" && c.className === "QListWidget") {
        // D9: the page list is not a row; its items are the dialog's tabs.
        (c.children ?? []).forEach((item, j) => {
          const v = kindOf({ controlType: item.controlType, pageListItem: true }, ENUMERATOR);
          if ("kind" in v)
            drafts.push({
              node: item,
              treePath: `${path}/${j}`,
              kind: v.kind,
              parent,
              name: item.name ?? "",
              labelRaw: item.name,
              incomplete: false,
            });
        });
        return;
      }
      const v = kindOf(
        {
          controlType: c.controlType,
          className: c.className,
          name: c.name,
          underDockOrDialog: true,
          inPropertyGrid: n.className === "PropertyGrid",
          expandable: (c.children?.length ?? 0) > 0,
          childCount: c.childCount ?? c.children?.length,
        },
        ENUMERATOR,
      );
      if ("kind" in v) {
        const sampled = sampledContainer(c, sampledPaths, path);
        const label =
          c.name?.trim() || (c as WalkNode & { _label?: string })._label?.trim() || undefined;
        drafts.push({
          node: c,
          treePath: path,
          kind: v.kind,
          parent,
          name: c.name ?? "",
          labelRaw: label,
          incomplete: sampled,
          sampledNote: sampled
            ? `sampled data container (${c.gridRowCount ?? c.childCount ?? "?"} rows); items not emitted`
            : undefined,
        });
        if (!sampled) visit(c, path, drafts.length - 1);
        return;
      }
      if (
        ("outOfScope" in v && v.outOfScope === "property") ||
        ("deferred" in v && v.deferred.startsWith("sampled"))
      ) {
        drafts[parent].incomplete = true;
        return;
      }
      // Transparent: an unkinded wrapper (QStackedWidget) or a panel outside L04's kinds.
      visit(c, path, parent);
    });
  };
  visit(root, "0", 0);

  // Keys (D7): object name when unique among this walk's nodes of that kind, else the label path.
  const candCount = new Map<string, number>();
  for (const d of drafts) {
    const cand = objectNameOf(d.node.automationId, d.node.className);
    if (cand)
      candCount.set(`${d.kind}\u0000${cand}`, (candCount.get(`${d.kind}\u0000${cand}`) ?? 0) + 1);
  }
  const keys: LiveKey[] = [];
  const segs: string[][] = [];
  const extra: Array<{ low?: boolean; unverified: string[] }> = [];
  const used = new Set<string>();
  const unnamedSeen = new Map<string, number>();
  drafts.forEach((d, idx) => {
    const ancestors = d.parent === null ? [] : segs[d.parent];
    const label = d.parent === null ? i.title : (d.labelRaw ?? "");
    let ord: number | undefined;
    if (!label.trim()) {
      const k = `${d.parent}\u0000${d.node.className ?? ""}`;
      ord = (unnamedSeen.get(k) ?? 0) + 1;
      unnamedSeen.set(k, ord);
    }
    const id = chooseKey(
      {
        automationId: d.node.automationId,
        className: d.node.className,
        ancestorLabels: ancestors,
        name: label,
        unnamedOrdinal: ord,
      },
      (cand) => candCount.get(`${d.kind}\u0000${cand}`) === 1,
    );
    const ex: { low?: boolean; unverified: string[] } = {
      low: id.confidence === "low",
      unverified: [...(id.unverified ?? [])],
    };
    let key = id.key;
    const seen = `${d.kind}\u0000${JSON.stringify(key)}`;
    if (used.has(seen) && "path" in key) {
      // Two siblings with one label: the second gets an ordinal segment, never an invented name.
      let n = 2;
      const base = key.path.slice(0, -1);
      const last = key.path[key.path.length - 1];
      while (used.has(`${d.kind}\u0000${JSON.stringify({ path: [...base, `${last}@${n}`] })}`)) n++;
      key = { path: [...base, `${last}@${n}`] };
      ex.low = true;
      ex.unverified.push("duplicate label under one parent; ordinal identity");
    }
    used.add(`${d.kind}\u0000${JSON.stringify(key)}`);
    keys[idx] = key;
    segs[idx] = "path" in key ? key.path : [...ancestors, label || key.object_name];
    extra[idx] = ex;
  });

  const childCount = new Map<number, number>();
  for (const d of drafts)
    if (d.parent !== null) childCount.set(d.parent, (childCount.get(d.parent) ?? 0) + 1);

  const commit = new Set(DIALOG_COMMIT_BUTTONS.map((b) => normalizeLabel(b).toLowerCase()));
  return drafts.map((d, idx) => {
    const parentDraft = d.parent === null ? null : drafts[d.parent];
    const raw = d.parent === null ? d.labelRaw : d.labelRaw;
    const line: LiveObservation = {
      dim: "ui",
      kind: d.kind,
      module: i.module,
      key: keys[idx],
      parent_key:
        parentDraft === null || d.parent === null
          ? null
          : { dim: "ui", kind: parentDraft.kind, module: i.module, key: keys[d.parent] },
      origin: "vanilla",
      locator: {
        ...(d.node.automationId ? { automationId: d.node.automationId } : {}),
        controlType: d.node.controlType,
        windowClass: i.windowClass ?? i.doc.target?.className ?? EDITOR_WINDOW_CLASS,
      },
      observed_state: {},
      ref: `artifact:${i.sha256}#n/${d.treePath}`,
      confidence: extra[idx].low ? "low" : "high",
    };
    if (raw && raw.trim()) {
      line.label_raw = raw;
      line.label = normalizeLabel(raw);
    }
    if (d.kind === "dialog") line.modal = "blocks";
    const lbl = (raw ?? "").trim().toLowerCase();
    if (d.node.controlType === "Button") {
      if (lbl === "cancel") line.risk_hint = "safe";
      else if (commit.has(normalizeLabel(raw ?? "").toLowerCase()))
        line.risk_commit_hint = "mutating";
    }
    if (i.credential && d.node.controlType === "Edit") line.risk_hint = "credential";
    if (d.node.legacyDescription && d.kind !== "dialog") line.quote = d.node.legacyDescription;
    const un = [...extra[idx].unverified];
    if (d.sampledNote) un.push(d.sampledNote);
    if (
      d.parent !== null &&
      parentDraft?.kind === "dialog" &&
      drafts[0].node.children?.some((c) => c.className === "QStackedWidget") &&
      d.kind !== "tab"
    )
      un.push("shown on the page selected at walk time");
    if (un.length) line.unverified = un;
    // A page-list tab never gets children (the shown page's controls hang off the dialog), so a
    // count would read as "enumerated, empty" and take the page off the G3 frontier.
    if (!d.incomplete && complete && d.kind !== "tab")
      line.children_count = childCount.get(idx) ?? 0;
    return line;
  });
}

// ── Step runtime ─────────────────────────────────────────────────────────────

/** The owned window of `pid` titled `title` (case-insensitive: "Create world" live), or null. */
function findDialog(ws: readonly WindowInfo[], pid: number, title: string): WindowInfo | null {
  const t = title.toLowerCase();
  return ws.find((w) => w.pid === pid && w.title.toLowerCase() === t && w.owner !== 0) ?? null;
}

async function waitFor<T>(
  ctx: WalkerStepContext,
  k: L04Kernel,
  ms: number,
  probe: (ws: WindowInfo[]) => T | null,
): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const ws = await ctx.call("windows", () => k.windows());
    const v = probe(ws);
    if (v !== null) return v;
    if (Date.now() >= end) return null;
    await ctx.sleep(POLL_MS);
  }
}

/** Did D14 pass in this run folder (its record says pass)? */
export function d14Passed(k: Pick<L04Kernel, "readText">, runDir: string): boolean {
  const t = k.readText(walkerRecordPath(runDir, D14_STEP));
  if (!t) return false;
  try {
    return (JSON.parse(t) as { status?: string }).status === "pass";
  } catch {
    return false;
  }
}

async function walkAndEmit(
  ctx: WalkerStepContext,
  k: L04Kernel,
  w: WindowInfo,
  step: string,
  module: string,
  title: string,
  credential: boolean,
): Promise<{ lines: number; artifact: { path: string; sha256: string } }> {
  const out = join(ctx.opts.runDir, `${step}-walk.json`);
  const r = await ctx.call("uia-read", () =>
    k.walk(
      {
        pid: ctx.pid,
        hwnd: w.hwnd,
        className: w.className,
        titlePattern: `^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        lane: ctx.lane,
      },
      out,
    ),
  );
  const lines = dialogLines({
    doc: r.doc,
    sha256: r.sha256,
    module,
    title,
    credential,
    windowClass: w.className,
  });
  ctx.emit(lines);
  return { lines: lines.length, artifact: { path: r.path, sha256: r.sha256 } };
}

/** Open (not awaited: a modal may hold the call), wait for the dialog, walk it. */
async function openAndWalk(
  ctx: WalkerStepContext,
  k: L04Kernel,
  step: string,
  module: string,
  linesModule: string,
  opener: readonly string[],
  title: string,
): Promise<{
  w: WindowInfo;
  lines: number;
  artifact: { path: string; sha256: string };
  opened: Promise<unknown>;
  baseline: Set<number>;
}> {
  const baseline = new Set(
    (await ctx.call("windows", () => k.windows()))
      .filter((x) => x.pid === ctx.pid)
      .map((x) => x.hwnd),
  );
  const opened = ctx.call("execute-action", () => k.open(module, opener));
  opened.catch(() => undefined);
  const w = await waitFor(ctx, k, DIALOG_APPEAR_MS, (ws) => findDialog(ws, ctx.pid, title));
  if (!w)
    throw new StopBattery(
      "stopped",
      `"${title}" did not appear within ${DIALOG_APPEAR_MS} ms after ${opener.join(" > ")}: nothing more sent`,
    );
  const r = await walkAndEmit(ctx, k, w, step, linesModule, title, false);
  return { w, ...r, opened, baseline };
}

/** Cancel by script and check the window is gone within D14_GONE_MS. */
async function scriptedCancel(
  ctx: WalkerStepContext,
  k: L04Kernel,
  w: WindowInfo,
  title: string,
  baseline: ReadonlySet<number>,
): Promise<number> {
  // The window poller runs every 2 s: before the one Invoke, check the list here too, so a
  // window that appeared since the open cuts the step before anything is pressed.
  const now = await ctx.call("windows", () => k.windows());
  const added = now.filter((x) => x.pid === ctx.pid && !baseline.has(x.hwnd) && x.hwnd !== w.hwnd);
  const v = windowVerdict(
    { added, disabled: now.filter((x) => x.pid === ctx.pid && x.enabled === false) },
    undefined,
  );
  if (v) throw new StopBattery(v.kind, `before Cancel: ${v.message}`);
  const t0 = Date.now();
  const c = await ctx.call("uia-dialog-cancel", () => k.cancel({ pid: ctx.pid, hwnd: w.hwnd }));
  if (!c.invoked)
    throw new StopBattery(
      "handoff",
      `Cancel was not pressed on "${title}" (${c.detail}): OWNER closes it with Cancel by hand`,
    );
  const gone = await waitFor(ctx, k, D14_GONE_MS, (ws) =>
    ws.some((x) => x.hwnd === w.hwnd) ? null : true,
  );
  if (!gone)
    throw new StopBattery(
      "handoff",
      `"${title}" is still up ${D14_GONE_MS} ms after Cancel: OWNER closes it by hand`,
    );
  return Date.now() - t0;
}

// ── Steps ────────────────────────────────────────────────────────────────────

const ROLLBACK_OWNER = "the owner presses Cancel on the dialog; nothing was committed";

/** The L04 steps for a module, from the policy's openers and the flags. */
export function l04Steps(cfg: L04Config, sel: { module: string }): WalkerStep[] {
  const steps: WalkerStep[] = [];
  const module = sel.module;
  const optionsListed = checkPlan([openAction(module, OPTIONS_OPENER)], cfg.policy, {
    script: SCRIPT,
  }).ok;
  const optionsHandler = handlerAllowed(cfg.policy, OPTIONS_OPENER);
  const optionsCancel = cancelAllowed(cfg.policy, OPTIONS_TITLE);
  const d14Ready = optionsListed && optionsHandler && optionsCancel;

  steps.push({
    id: D14_STEP,
    title: d14Ready
      ? `D14: open Options (${OPTIONS_OPENER.join(" > ")}), walk it, scripted Cancel, gone within ${D14_GONE_MS} ms`
      : `D14 BLOCKED: ${!optionsListed ? `${OPTIONS_OPENER.join(" > ")} is not on live_lane.dialog_openers.paths` : !optionsHandler ? `${OPTIONS_OPENER.join(" > ")} is not on execute_action.allow_list, so the handler answers NOT_ALLOWLISTED (main adds it and regenerates EMCP_WB_ActionAllowList.c with gen-action-allowlist.ts)` : "no p4-d14-options-cancel exception"} (main)`,
    risk: "reversible",
    timeout_ms: DIALOG_APPEAR_MS + 120_000 + D14_GONE_MS,
    expected:
      "Options opens owned; the walk reads 7 pages; Cancel closes it within 5 s; the owner's registry export shows no Options change",
    kill_criterion:
      "any other new window (STOP), any other dialog (HANDOFF), Options not gone 5 s after Cancel (HANDOFF)",
    side_effects: ["the Options dialog opens and is cancelled"],
    rollback: ROLLBACK_OWNER,
    expectsDialogs: [{ title: OPTIONS_TITLE, owned: true, className: EDITOR_WINDOW_CLASS }],
    plan: () =>
      d14Ready
        ? [
            openAction(module, OPTIONS_OPENER),
            readAction(OPTIONS_TITLE),
            cancelAction(OPTIONS_TITLE, cancelExceptionId(cfg.policy, OPTIONS_TITLE)),
          ]
        : [],
    run: async (ctx) => {
      if (!d14Ready)
        throw new StopBattery(
          "stopped",
          optionsHandler
            ? "D14 is blocked on main (policy)"
            : "D14 is blocked on main: File > Options... is not on execute_action.allow_list (NOT_ALLOWLISTED); nothing was sent",
        );
      const k = cfg.kernel(ctx.port);
      const r = await openAndWalk(
        ctx,
        k,
        D14_STEP,
        module,
        "Shared",
        OPTIONS_OPENER,
        OPTIONS_TITLE,
      );
      const ms = await scriptedCancel(ctx, k, r.w, OPTIONS_TITLE, r.baseline);
      return {
        status: "pass",
        summary: `D14: ${r.lines} lines; Cancel closed Options in ${ms} ms; registry comparison pending (owner and main)`,
        artifacts: [r.artifact],
      };
    },
  });

  for (const opener of dialogOpeners(cfg.policy)) {
    if (pathKey(opener) === pathKey(OPTIONS_OPENER)) continue;
    if (!openerAllowed(cfg.policy, module, opener)) continue; // a deny-listed label never plans
    const title = titleOfOpener(opener);
    const id = `p4-l04-open-${slugOf(opener.join("-"))}`;
    const scripted = !cfg.ownerCloses && cancelAllowed(cfg.policy, title);
    steps.push({
      id,
      title: `open ${opener.join(" > ")}, walk "${title}", ${scripted ? "scripted Cancel (needs D14 pass)" : "HANDOFF for the owner's Cancel"}`,
      risk: "reversible",
      timeout_ms: DIALOG_APPEAR_MS + 120_000 + D14_GONE_MS,
      expected: `"${title}" opens owned and is walked`,
      kill_criterion: "any other new window (STOP), any other dialog (HANDOFF)",
      side_effects: [`the "${title}" dialog opens and is cancelled`],
      rollback: ROLLBACK_OWNER,
      expectsDialogs: [{ title, owned: true, className: EDITOR_WINDOW_CLASS }],
      plan: () => [
        openAction(module, opener),
        readAction(title),
        ...(scripted ? [cancelAction(title, cancelExceptionId(cfg.policy, title))] : []),
      ],
      run: async (ctx) => {
        const k = cfg.kernel(ctx.port);
        if (scripted && !d14Passed(k, ctx.opts.runDir))
          throw new StopBattery(
            "stopped",
            `D14 has not passed in this run folder: nothing opened; run with --owner-closes`,
          );
        const r = await openAndWalk(ctx, k, id, module, module, opener, title);
        if (!scripted) {
          // The planned end is the owner's Cancel: the walk was good, so its lines are kept.
          ctx.commit();
          throw new StopBattery(
            "handoff",
            `walked "${title}" (${r.lines} lines, ${r.artifact.path}); OWNER: press Cancel on "${title}", then resume with --from the next step`,
          );
        }
        const ms = await scriptedCancel(ctx, k, r.w, title, r.baseline);
        return {
          status: "pass",
          summary: `${r.lines} lines; Cancel closed "${title}" in ${ms} ms`,
          artifacts: [r.artifact],
        };
      },
    });
  }

  // List 1 is read-only (the script presses nothing; the owner opens and Cancels) and runs after the
  // reversible D14 on purpose (D14 is the sitting's first dialog). The sitting queue (p4-1.ts)
  // opens a new launch block where the rank drops; a standalone --emit-queue of L04 alone is
  // refused by validateQueue for that order, before launch.
  for (const d of LIST1) {
    const id = `p4-l04-l1-${d.slug}`;
    steps.push({
      id,
      title: `list 1 (owner-opened): wait for the owner's "${d.opener}", walk "${d.title}", HANDOFF for the owner's Cancel`,
      risk: "read-only",
      timeout_ms: OWNER_WAIT_MS + 120_000,
      expected: `the owner opens "${d.title}"; the walk reads it; credential fields recorded passively`,
      kill_criterion:
        "any other new window (STOP), any other dialog (HANDOFF), no dialog within the wait (STOP)",
      side_effects: [],
      rollback: ROLLBACK_OWNER,
      expectsDialogs: [{ title: d.title, owned: true, className: EDITOR_WINDOW_CLASS }],
      // The owner reaches the opener through a menu: the menu popup pair is benign while the
      // step waits (P4-1 remainder, 2026-10-12: the File menu popup stopped the first attempt).
      popups: true,
      plan: () => [readAction(d.title)],
      run: async (ctx) => {
        if (!cfg.ownerDone)
          throw new StopBattery("stopped", "a list 1 step runs only with --owner-done");
        const k = cfg.kernel(ctx.port);
        ctx.log(
          `OWNER: click "${d.opener}" now; the step waits up to ${OWNER_WAIT_MS / 1000} s for "${d.title}"`,
        );
        const w = await waitFor(ctx, k, OWNER_WAIT_MS, (ws) => findDialog(ws, ctx.pid, d.title));
        if (!w)
          throw new StopBattery("stopped", `"${d.title}" did not appear within the owner wait`);
        const r = await walkAndEmit(ctx, k, w, id, module, d.title, d.credential === true);
        // The planned end is the owner's Cancel: the walk was good, so its lines are kept.
        ctx.commit();
        throw new StopBattery(
          "handoff",
          `walked "${d.title}" (${r.lines} lines, ${r.artifact.path}); OWNER: press Cancel on "${d.title}", then resume with --from the next step`,
        );
      },
    });
  }
  return steps;
}

export function l04Def(cfg: L04Config): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    session: "P4-1",
    script: SCRIPT,
    defaultModule: "WorldEditor",
    steps: (sel) => l04Steps(cfg, sel),
  };
}

// ── Real kernel ──────────────────────────────────────────────────────────────

const CANCEL_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$hwnd = [IntPtr][long]$env:L04_HWND
$pid0 = [int]$env:L04_PID
$el = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($el.Current.ProcessId -ne $pid0) { '{"invoked":false,"detail":"window of another process"}'; exit 0 }
$c = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Cancel')))
$all = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c)
if ($all.Count -ne 1) { '{"invoked":false,"detail":"' + $all.Count + ' buttons named Cancel"}'; exit 0 }
$p = $all[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$p.Invoke()
'{"invoked":true,"detail":"Invoke sent"}'
`;

/** The live kernel; walk.ts takes the step's lane (`ctx.lane`, passed in each walk request). */
export function realKernel(port: number = DEFAULT_PORT): L04Kernel {
  const client = new WorkbenchClient("127.0.0.1", port);
  return {
    windows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    open: (module, menuPath) =>
      runModule(client, { action: "action", module, menuPath: [...menuPath] } as Parameters<
        typeof runModule
      >[1]),
    walk: (t, out) =>
      new Promise((done, fail) => {
        const args = [
          "--import",
          "tsx",
          join(REPO_ROOT, "tools", "uia", "walk.ts"),
          "--pid",
          String(t.pid),
          "--hwnd",
          String(t.hwnd),
          "--class",
          t.className,
          "--title-pattern",
          t.titlePattern,
          "--allow-owned",
          "--label",
          "l04",
          "--out",
          out,
          ...(t.lane?.id ? laneArgv(t.lane) : []),
          "--really",
        ];
        const child = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true });
        const timer = setTimeout(() => child.kill(), WALK_BOUNDS.budgetMs + 30_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          try {
            const buf = readFileSync(out);
            const doc = JSON.parse(buf.toString("utf-8")) as WalkDoc;
            if (code !== 0 || !doc.tree) throw new Error(`walk.ts exit ${code}`);
            done({ doc, path: out, sha256: createHash("sha256").update(buf).digest("hex") });
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          fail(e);
        });
      }),
    cancel: async (t) => {
      const r = await runPowerShell(CANCEL_PS, {
        timeoutMs: 15_000,
        env: { L04_HWND: String(t.hwnd), L04_PID: String(t.pid) },
      });
      if (!r.ok) return { invoked: false, detail: `cancel script failed: ${r.error}` };
      const last = r.stdout.trim().split(/\r?\n/).pop() ?? "";
      try {
        return JSON.parse(last) as { invoked: boolean; detail: string };
      } catch {
        return { invoked: false, detail: "cancel script gave no JSON" };
      }
    },
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** L04's own flags, taken out before common.ts parses the rest (its flag list is fixed). */
export function splitL04Flags(argv: readonly string[]): {
  rest: string[];
  ownerCloses: boolean;
  ownerDone: boolean;
} {
  const rest = argv.filter((a) => a !== "--owner-closes" && a !== "--owner-done");
  return {
    rest,
    ownerCloses: argv.includes("--owner-closes"),
    ownerDone: argv.includes("--owner-done"),
  };
}

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * The L04 entry: its own flags, then the refusals that must come before any marker (a blocked D14,
 * a list 1 step without `--owner-done`, a scripted Cancel before D14 passed, `--really` without
 * `--allow-owned`), then common.ts `runWalker`.
 */
export async function main(
  argv: readonly string[],
  over: RunWalkerOverrides & { kernel?: L04Kernel } = {},
): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const f = splitL04Flags(argv);
  const policy = over.policy ?? loadPolicy();
  let kernel: L04Kernel | null = over.kernel ?? null;
  const cfg: L04Config = {
    policy,
    ownerCloses: f.ownerCloses,
    ownerDone: f.ownerDone,
    kernel: (port) => {
      if (!kernel) kernel = realKernel(port);
      return kernel;
    },
  };
  const def = l04Def(cfg);
  if (f.rest.includes("--really")) {
    if (!f.rest.includes("--allow-owned")) {
      say("L04 --really needs --allow-owned (every dialog is an owned window)");
      return EXIT.usage;
    }
    const steps = def.steps({
      module: valueOf(f.rest, "--module") ?? def.defaultModule,
      state: {},
      allowOwned: true,
    });
    const sel = selectWalkerSteps(steps, {
      from: valueOf(f.rest, "--from"),
      only: valueOf(f.rest, "--only"),
    });
    if (typeof sel !== "string") {
      const runDir = valueOf(f.rest, "--run-dir");
      for (const s of sel) {
        if (s.id === D14_STEP && s.plan({ module: "", state: {}, allowOwned: true }).length === 0) {
          say(`REFUSED: ${s.title}`);
          return EXIT.refused;
        }
        if (s.id.startsWith("p4-l04-l1-") && !f.ownerDone) {
          say(`REFUSED: ${s.id} is an Appendix B list 1 dialog: it runs only with --owner-done`);
          return EXIT.refused;
        }
        const scripted = s
          .plan({ module: "", state: {}, allowOwned: true })
          .some((a) => a.kind === "uia-dialog-cancel");
        if (s.id.startsWith("p4-l04-open-") && scripted && !sel.some((x) => x.id === D14_STEP)) {
          const k = over.kernel ?? {
            readText: (p: string) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
          };
          if (!runDir || !d14Passed(k, runDir)) {
            say(
              `REFUSED: ${s.id} cancels by script and D14 has not passed in this run folder: use --owner-closes`,
            );
            return EXIT.refused;
          }
        }
      }
    }
  }
  return runWalker(def, f.rest, over);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
