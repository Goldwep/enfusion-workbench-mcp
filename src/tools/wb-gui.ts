/**
 * wb_gui: the GUI layer (plan 8 work package 3.5; DEC-047 L5 "tree-based"; reworked for wave W8:
 * docs/v2/design/phase5-w8-spec.md section 2.1 and rules 1.2; DEC-076, OD-2 to OD-4, OD-13).
 *
 * Opt-in (ENFUSION_GUI=1) and Windows-only.
 *
 * Reads, free-form:
 *   tree        one window's accessibility tree (src/gui/uia.ts snapshot)
 *   find        a search over a fresh snapshot (src/gui/uia.ts find)
 *   screenshot  the full desktop to the artifacts folder (the scripts/live/capture.ts script), or
 *               with pid + windowTitle/hwnd that one window's rectangle only (WINDOW_CAPTURE_SCRIPT);
 *               the answer carries the path relative to the artifacts folder, never a home path
 *   modals      the modal watchdog's report (src/gui/modal-watchdog.ts)
 *   context     the one context menu of the pid that is already open (src/gui/context.ts, the
 *               passive L05 route): nothing is sent; no menu open is INVALID_ARGUMENT
 * Reads by census row id:
 *   read        resolves the row's locator (the build file's record, else the ledger's own
 *               locator, which P-W8-02 re-resolves) and reads the element's state
 * Drive actions (invoke, expand, toggle, select, setValue): a census row id ONLY (OD-3), in this
 * order: the deny list (DIALOG_COMMIT_BUTTONS, policy.json's deny labels, the ledger's risk rows;
 * rule 1.2.2) first; a record in data/census/locators/<current build>.jsonl (NO_LOCATOR); the
 * gates `gui.actions_enabled` and `gui.rows_enabled` of policy.json (GATED, UNPROVEN; rule 1.2.7);
 * MODAL_HAZARD for a row that opens a dialog with no proven Cancel; MODAL_OPEN when a dialog is
 * open; the locator must resolve to one element with the census name and control type
 * (LOCATOR_STALE). Dry run unless confirm: true. The dialogs are listed again after the act.
 *   dismiss     presses Cancel, Close or No on one open dialog, never anything else (OD-4);
 *               gated by `gui.actions_enabled` (P-W8-03)
 * Nothing synthesises input (rule 1.2.8): every act is one UI Automation pattern call
 * (src/gui/driver.ts).
 *
 * Responses follow design section 4: `{ ok, action, target, changed, readback, next?, warnings }`.
 * NO_LOCATOR and LOCATOR_STALE are in src/manifest/vocabulary.ts (spec 1.2 rule 10).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_CENSUS_ROOT } from "../census/ledger-io.js";
import { defaultArtifactsDir } from "../census/source-index.js";
import { readOpenContextMenu } from "../gui/context.js";
import {
  ACTION_PATTERN,
  DEFAULT_SETTLE_MS,
  DISMISS_BUTTONS,
  DRIVE_ACTIONS,
  checkDialogs,
  describeDialog,
  runDriver,
  type DriveAction,
  type DriverResult,
  type ElementState,
} from "../gui/driver.js";
import {
  censusMismatch,
  censusName,
  ledgerSpec,
  loadCensusRows,
  loadLocatorRecords,
  normLabel,
  readCurrentBuild,
  resolveLocator,
  type CensusRowLite,
  type LocatorRecord,
  type LocatorSpec,
  type LocatorWindow,
} from "../gui/locators.js";
import { AUTH_WINDOW_TITLE, ModalWatchdog } from "../gui/modal-watchdog.js";
import {
  FIND_LIMIT_MAX,
  countNodes,
  find,
  lastLine,
  listWindows,
  runPowerShell,
  snapshot,
  type PowerShellRunner,
  type SnapshotTarget,
  type UiaNode,
  type WindowInfo,
} from "../gui/uia.js";
import {
  CONFIRM_SCHEMA,
  ERROR_CODES,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";

export const WB_GUI_ENV = "ENFUSION_GUI";

export const READ_ACTIONS = ["tree", "find", "screenshot", "modals", "read", "context"] as const;
/** Literal here (not spread from driver.ts DRIVE_ACTIONS) so the E11 enumerator reads it. */
export const MUTATING_ACTIONS = [
  "invoke",
  "expand",
  "toggle",
  "select",
  "setValue",
  "dismiss",
] as const;
export const ACTIONS = [...READ_ACTIONS, ...MUTATING_ACTIONS] as const;
export type GuiAction = (typeof ACTIONS)[number];

export const WB_GUI_DESCRIPTION =
  "Workbench GUI through UI Automation (opt-in: ENFUSION_GUI=1; Windows). Read: tree, find, screenshot, modals, read (a census row by id), context (read an open context menu). Drive a census row by id when it has a locator captured on this build: invoke, expand, toggle, select, setValue; dismiss presses Cancel, Close or No only. Commit buttons and deny-listed labels are never pressed.";

/** Commit buttons of a dialog: never pressed by a tool (design section 2 row wb_gui). */
export const DIALOG_COMMIT_BUTTONS = [
  "OK",
  "Yes",
  "Yes to All",
  "Save",
  "Apply",
  "Confirm",
  "Accept",
  "Allow",
  "Publish",
  "Delete",
  "Overwrite",
  "Replace",
] as const;

/** Ledger risk classes whose rows are never pressed, whatever the row id (rule 1.2.2). */
export const RISK_DENY = ["destructive", "credential", "external"] as const;

export type GuiErrorCode = ErrorCode;
export interface GuiError extends Omit<ActionError, "code"> {
  code: GuiErrorCode;
}
export type GuiResponse = ActionOk | GuiError;

function fail(
  action: string,
  target: string,
  code: GuiErrorCode,
  message: string,
  next?: string,
): GuiError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next ?? ERROR_CODES[code],
    warnings: [],
  };
}

/** A tree answer larger than this is written to the artifacts folder (design section 4). */
export const INLINE_TREE_MAX_CHARS = 40_000;
/** Depth of the inline outline when the full tree goes to a file. */
export const OUTLINE_DEPTH = 2;
/** Depth of a dialog's button read (modal-watchdog.ts BUTTON_READ_DEPTH). */
export const DIALOG_READ_DEPTH = 8;

/** The PowerShell script of scripts/live/capture.ts (src cannot import scripts/). */
export const CAPTURE_PATH_ENV = "EMCP_CAPTURE_PATH";
export const CAPTURE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
  "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
  "$g = [System.Drawing.Graphics]::FromImage($bmp)",
  "try {",
  "  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)",
  `  $bmp.Save($env:${CAPTURE_PATH_ENV}, [System.Drawing.Imaging.ImageFormat]::Png)`,
  "} finally { $g.Dispose(); $bmp.Dispose() }",
  "Write-Output ('{\"width\":' + $b.Width + ',\"height\":' + $b.Height + '}')",
].join("\n");

/**
 * One window's rectangle only (W8 run 8: w8-82's desktop capture showed the Resource Manager and
 * another application in front of the World Editor, so it could not be judged). The window is
 * named by hwnd (EMCP_CAPTURE_HWND); the process is made DPI-aware so the rectangle and the copy
 * are both in physical pixels.
 */
export const CAPTURE_HWND_ENV = "EMCP_CAPTURE_HWND";
export const WINDOW_CAPTURE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Drawing",
  'Add-Type @"',
  "using System; using System.Runtime.InteropServices;",
  "public static class EmcpCaptureWindow {",
  "  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }",
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
  '  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
  "}",
  '"@',
  "[void][EmcpCaptureWindow]::SetProcessDPIAware()",
  "$r = New-Object EmcpCaptureWindow+RECT",
  `if (-not [EmcpCaptureWindow]::GetWindowRect([IntPtr][long]$env:${CAPTURE_HWND_ENV}, [ref]$r)) { throw 'GetWindowRect failed' }`,
  "$w = $r.R - $r.L; $h = $r.B - $r.T",
  "if ($w -le 0 -or $h -le 0) { throw 'the window rectangle is empty' }",
  "$bmp = New-Object System.Drawing.Bitmap $w, $h",
  "$g = [System.Drawing.Graphics]::FromImage($bmp)",
  "try {",
  "  $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)",
  `  $bmp.Save($env:${CAPTURE_PATH_ENV}, [System.Drawing.Imaging.ImageFormat]::Png)`,
  "} finally { $g.Dispose(); $bmp.Dispose() }",
  "Write-Output ('{\"width\":' + $w + ',\"height\":' + $h + ',\"rect\":[' + $r.L + ',' + $r.T + ',' + $r.R + ',' + $r.B + ']}')",
].join("\n");

export interface GuiDeps {
  run?: PowerShellRunner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  artifactsDir?: () => string;
  watchdog?: ModalWatchdog;
  /** Parsed policy.json (deny lists, the `gui` gates); read from the census folder when absent. */
  policy?: () => unknown;
  now?: () => Date;
  /** The census folder (ledger, current-build.json, locators/); the repo's when absent. */
  censusRoot?: string;
  /** The current build tag; current-build.json when absent. */
  build?: () => string | null;
  /** The ledger's ui rows; ledger.jsonl when absent. */
  rows?: () => Map<string, CensusRowLite>;
  /** The locator records of a build; locators/<build>.jsonl when absent. */
  locators?: (build: string) => Map<string, LocatorRecord>;
  /** Wait after an act before the read-back (ms). */
  settleMs?: number;
}

type Raw = Record<string, unknown>;

// ── Deny list ───────────────────────────────────────────────────────────────────────────────────

function readPolicy(root: string = DEFAULT_CENSUS_ROOT): unknown {
  const file = join(root, "policy.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

/** ExecuteAction's deny list: `execute_action.deny_list_seed` and every `deny_lists.*.labels`. */
export function denyLabels(policy: unknown): string[] {
  const p = (policy ?? {}) as {
    execute_action?: { deny_list_seed?: unknown };
    deny_lists?: Record<string, { labels?: unknown }>;
  };
  const out = new Set<string>();
  const seed = p.execute_action?.deny_list_seed;
  if (Array.isArray(seed)) for (const s of seed) if (typeof s === "string") out.add(s);
  for (const [k, list] of Object.entries(p.deny_lists ?? {})) {
    if (k.startsWith("$") || !list || !Array.isArray(list.labels)) continue;
    for (const s of list.labels) if (typeof s === "string") out.add(s.replace(/:confirm$/, ""));
  }
  return [...out];
}

/** Null when no label is a deny-listed label or a dialog commit button; else why. */
export function gatedRefusal(labels: string[], deny: string[]): string | null {
  const denied = new Set(deny.map(normLabel));
  const commit = new Set(DIALOG_COMMIT_BUTTONS.map(normLabel));
  for (const l of labels) {
    if (denied.has(normLabel(l))) return `"${l}" is on the ExecuteAction deny list`;
    if (commit.has(normLabel(l))) return `"${l}" is a dialog commit button; a human commits`;
  }
  return null;
}

/** Rule 1.2.2 for a row: its risk class, then every label it or its locator carries. */
export function rowDenyRefusal(
  row: CensusRowLite,
  rec: LocatorRecord | null,
  deny: string[],
  extra: string[] = [],
): string | null {
  if (row.risk && (RISK_DENY as readonly string[]).includes(row.risk)) {
    return `the census marks ${row.id} as risk "${row.risk}"; it is never pressed by a tool`;
  }
  const labels = [
    ...(row.label ? [row.label] : []),
    ...(row.locator?.menuPath ?? []),
    ...(rec ? [rec.name, ...(rec.path ?? [])] : []),
    ...extra,
  ].filter((s) => typeof s === "string" && s.length > 0);
  return gatedRefusal(labels, deny);
}

// ── Gates (policy.json `gui`; rule 1.2.7) ───────────────────────────────────────────────────────

export interface GuiGateEntry {
  id: string;
  build?: string;
  evidence?: string;
}

/** policy.json `gui`: `actions_enabled` (strings) and `rows_enabled` (ids or entries). */
export function guiGates(policy: unknown): {
  actions: Set<string>;
  rows: Array<GuiGateEntry & { bare: boolean }>;
} {
  const g = ((policy ?? {}) as { gui?: { actions_enabled?: unknown; rows_enabled?: unknown } }).gui;
  const actions = new Set<string>(
    Array.isArray(g?.actions_enabled)
      ? g.actions_enabled.filter((x): x is string => typeof x === "string")
      : [],
  );
  const rows: Array<GuiGateEntry & { bare: boolean }> = [];
  if (Array.isArray(g?.rows_enabled)) {
    for (const e of g.rows_enabled) {
      if (typeof e === "string" && e) rows.push({ id: e, bare: true });
      else if (e && typeof e === "object" && typeof (e as GuiGateEntry).id === "string") {
        const x = e as GuiGateEntry;
        rows.push({
          id: x.id,
          ...(typeof x.build === "string" ? { build: x.build } : {}),
          ...(typeof x.evidence === "string" ? { evidence: x.evidence } : {}),
          bare: false,
        });
      }
    }
  }
  return { actions, rows };
}

function entryMatches(id: string, rowId: string): boolean {
  return id.endsWith("*") ? rowId.startsWith(id.slice(0, -1)) : id === rowId;
}

/**
 * Null when the action may run on the row; else GATED (the action, or the row, is not enabled)
 * or UNPROVEN (the row is enabled but has no evidence recorded on `build`).
 */
export function gateRefusal(
  policy: unknown,
  action: string,
  rowId: string | null,
  build: string,
): { code: "GATED" | "UNPROVEN"; message: string } | null {
  const g = guiGates(policy);
  if (!g.actions.has(action)) {
    return {
      code: "GATED",
      message: `wb_gui ${action} is not enabled: policy.json gui.actions_enabled does not list it (P-W8-01, P-W8-03); nothing was sent`,
    };
  }
  if (rowId === null) return null;
  const hits = g.rows.filter((e) => entryMatches(e.id, rowId));
  if (!hits.length) {
    return {
      code: "GATED",
      message: `the row is not enabled: policy.json gui.rows_enabled does not list ${rowId}; nothing was sent`,
    };
  }
  const proven = hits.some((e) => !e.bare && e.build === build && /^EV-/.test(e.evidence ?? ""));
  if (!proven) {
    return {
      code: "UNPROVEN",
      message: `the row is enabled in policy.json gui.rows_enabled but has no evidence recorded on ${build}; nothing was sent`,
    };
  }
  return null;
}

/** The row opens a dialog: recorded by the probe, or a label in "…" (the Qt convention). */
export function opensDialog(row: CensusRowLite, rec: LocatorRecord): boolean {
  if (rec.opensDialog === true) return true;
  if (rec.opensDialog === false) return false;
  return [row.label ?? "", rec.name].some((l) => /(\.\.\.|…)\s*$/.test(l));
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

function targetString(t: Partial<SnapshotTarget>): string {
  if (t.pid === undefined) return "desktop";
  const parts = [`pid:${t.pid}`];
  if (t.hwnd !== undefined) parts.push(`hwnd:${t.hwnd}`);
  if (t.className !== undefined) parts.push(`class:${t.className}`);
  if (t.titlePattern !== undefined) parts.push(`title:/${t.titlePattern}/`);
  return parts.join(" ");
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

function safeLabel(label: unknown, fallback: string): string {
  const s = typeof label === "string" ? label : "";
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 48) || fallback;
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The tree cut to `depth` levels, with the counts of what was cut. */
export function outline(n: UiaNode, depth: number): UiaNode {
  if (!n.children) return n;
  if (depth <= 0) {
    const { children, ...rest } = n;
    return { ...rest, childCountAtLeast: n.childCount ?? children.length };
  }
  return { ...n, children: n.children.map((c) => outline(c, depth - 1)) };
}

function intArg(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) ? v : undefined;
}

function strArg(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const STATE_FIELDS = ["value", "toggleState", "expandState", "selected", "enabled"] as const;

/** The state fields that differ between the two reads. */
export function stateChanges(
  rowId: string,
  before: ElementState | null,
  after: ElementState | null,
): Change[] {
  if (!before || !after) return [];
  return STATE_FIELDS.filter((k) => before[k] !== after[k]).map((k) => ({
    path: `${rowId}#${k}`,
    before: before[k],
    after: after[k],
  }));
}

function stateFields(s: ElementState | null): Record<string, unknown> {
  if (!s) return {};
  return {
    name: s.name,
    controlType: s.controlType,
    enabled: s.enabled,
    value: s.value,
    readOnly: s.readOnly,
    toggleState: s.toggleState,
    expandState: s.expandState,
    selected: s.selected,
  };
}

/** A driver failure as a refusal: the element moved, refused, or the driver failed. */
function driverFailure(action: string, tgt: string, r: DriverResult, acted: boolean): GuiError {
  if (r.code === "mismatch" || r.code === "gone") {
    return fail(action, tgt, "LOCATOR_STALE", `${r.reason ?? r.code}; nothing was acted on`);
  }
  if (r.code === "disabled" || r.code === "no-pattern" || r.code === "read-only") {
    return fail(action, tgt, "INVALID_ARGUMENT", `${r.reason ?? r.code}; nothing was acted on`);
  }
  return fail(
    action,
    tgt,
    "HANDLER_ERROR",
    `the driver did not finish (${r.reason ?? "no answer"})`,
    acted
      ? "The act may have happened: read the row back (wb_gui read) and check wb_gui modals before any retry."
      : "Retry once; if the window is not responding, check wb_gui modals.",
  );
}

// ── Row actions: read and the drive actions ─────────────────────────────────────────────────────

interface RowCtx {
  run: PowerShellRunner;
  deps: GuiDeps;
  root: string;
}

async function rowAction(action: GuiAction, args: Raw, ctx: RowCtx): Promise<GuiResponse> {
  const { run, deps, root } = ctx;
  const rowId = strArg(args.rowId);
  const tgt = rowId ? `row:${rowId}` : "row";
  const drive = (DRIVE_ACTIONS as readonly string[]).includes(action);
  if (!rowId) {
    return fail(
      action,
      tgt,
      "INVALID_ARGUMENT",
      `${action} takes a census row id (rowId), never a free name or path; tree and find are the free-form reads`,
    );
  }
  if (action === "setValue" && typeof args.value !== "string") {
    return fail(action, tgt, "INVALID_ARGUMENT", "setValue needs value (text)");
  }

  let rows: Map<string, CensusRowLite>;
  let build: string | null;
  try {
    rows = (deps.rows ?? (() => loadCensusRows(root)))();
    build = (deps.build ?? (() => readCurrentBuild(root)))();
  } catch (e) {
    return fail(action, tgt, "HANDLER_ERROR", `the census could not be read: ${String(e)}`);
  }
  if (!build) {
    return fail(action, tgt, "HANDLER_ERROR", "no current build (current-build.json)");
  }
  const row = rows.get(rowId);
  if (!row) {
    return fail(
      action,
      tgt,
      "INVALID_ARGUMENT",
      `no ui row "${rowId}" in the census`,
      "Use a ui: row id the census holds (wb_census), or find to look by name.",
    );
  }
  const policy = (deps.policy ?? (() => readPolicy(root)))();
  const deny = denyLabels(policy);

  // Rule 1.2.2: the deny list runs first, whatever else holds.
  if (drive) {
    const why = rowDenyRefusal(row, null, deny);
    if (why) return fail(action, tgt, "NOT_ALLOWLISTED", `${why}; nothing was sent`);
  }
  const pid = intArg(args.pid);
  if (pid === undefined || pid <= 0) {
    return fail(
      action,
      tgt,
      "INVALID_ARGUMENT",
      "pid is required (never the foreground window, never a title alone)",
      "Pass the Workbench pid (wb_state or the launch report).",
    );
  }

  let records: Map<string, LocatorRecord>;
  try {
    records = (deps.locators ?? ((b: string) => loadLocatorRecords(root, b)))(build);
  } catch (e) {
    return fail(action, tgt, "HANDLER_ERROR", String(e instanceof Error ? e.message : e));
  }
  const rec = records.get(rowId) ?? null;
  const ledgerBuild = row.locator?.build ?? null;

  let before: WindowInfo[] = [];
  if (drive) {
    if (!rec) {
      return fail(
        action,
        tgt,
        "NO_LOCATOR",
        ledgerBuild
          ? `no ${build} locator for ${rowId}: the census holds one captured at ${ledgerBuild}, which P-W8-02 re-resolves before any drive (OD-3); nothing was sent`
          : `no ${build} locator for ${rowId}; nothing was sent`,
      );
    }
    const why = rowDenyRefusal(row, rec, deny);
    if (why) return fail(action, tgt, "NOT_ALLOWLISTED", `${why}; nothing was sent`);
    const gate = gateRefusal(policy, action, rowId, build);
    if (gate) return fail(action, tgt, gate.code, gate.message);
    if (opensDialog(row, rec) && rec.cancelProven !== true) {
      return fail(
        action,
        tgt,
        "MODAL_HAZARD",
        "the row opens a dialog and no Cancel is proven for it on this build (P-W8-03); nothing was sent",
        "Open it by hand, or wait for P-W8-03 to record its Cancel.",
      );
    }
    const pre = await checkDialogs(pid, { run });
    if (!pre.ok) {
      return fail(action, tgt, "HANDLER_ERROR", pre.error ?? "the window list failed");
    }
    if (pre.dialogs.length) {
      return fail(
        action,
        tgt,
        "MODAL_OPEN",
        `a dialog is open (${pre.dialogs.map((w) => `"${describeDialog(w).title}"`).join(", ")}); nothing was sent`,
        "Close it first (wb_gui dismiss presses Cancel, Close or No), then call again.",
      );
    }
    before = pre.windows;
  }

  // The window and the locator spec: the build file's record, else (read only) the ledger's.
  let target: SnapshotTarget;
  let spec: LocatorSpec;
  let source: "build-file" | "ledger";
  let locBuild: string;
  let win: LocatorWindow;
  if (rec) {
    source = "build-file";
    locBuild = rec.build;
    win = rec.window;
    target = {
      pid,
      className: rec.window.className,
      titlePattern: rec.window.titlePattern,
      ...(rec.window.allowOwned ? { allowOwned: true } : {}),
    };
    spec = {
      ...(rec.automationId ? { automationId: rec.automationId } : {}),
      ...(rec.ordinal !== undefined ? { ordinal: rec.ordinal } : {}),
      ...(rec.itemPath ? { itemPath: rec.itemPath } : {}),
      ...(rec.path ? { path: rec.path } : {}),
      name: rec.name,
      controlType: rec.controlType,
    };
  } else {
    const ls = ledgerSpec(row);
    if (!ls || !row.locator?.windowClass) {
      return fail(action, tgt, "NO_LOCATOR", `the census holds no locator for ${rowId}`);
    }
    const title = strArg(args.windowTitle);
    const hwnd = intArg(args.hwnd);
    if (title === undefined && hwnd === undefined) {
      return fail(
        action,
        tgt,
        "INVALID_ARGUMENT",
        `the ${ledgerBuild ?? "census"} locator names the window class only; pass windowTitle (a regular expression of the whole title) or hwnd`,
      );
    }
    if (title !== undefined) {
      try {
        new RegExp(title);
      } catch {
        return fail(action, tgt, "INVALID_ARGUMENT", "windowTitle does not compile");
      }
    }
    source = "ledger";
    locBuild = ledgerBuild ?? "unknown";
    target = {
      pid,
      className: row.locator.windowClass,
      ...(title !== undefined ? { titlePattern: title } : {}),
      ...(hwnd !== undefined ? { hwnd } : {}),
    };
    win = { className: row.locator.windowClass, titlePattern: title ?? "" };
    spec = ls;
  }

  const snap = await snapshot(target, { view: "control" }, { run });
  if (!snap.ok || !snap.tree || !snap.window) {
    return snap.window
      ? fail(action, tgt, "HANDLER_ERROR", snap.reason ?? "the snapshot failed")
      : fail(
          action,
          tgt,
          "MODULE_NOT_OPEN",
          `${snap.reason ?? "no window"}; nothing was sent`,
          "Open the row's module first (wb_module open), then call again.",
        );
  }
  if (!win.titlePattern) win = { ...win, titlePattern: `^${escapeRx(snap.window.title)}$` };
  const res = resolveLocator(snap.tree, spec);
  if (!res.ok || !res.hit) {
    return fail(
      action,
      tgt,
      "LOCATOR_STALE",
      `the ${locBuild} locator resolves to ${res.count} elements (${res.reason}); nothing was sent`,
    );
  }
  const node = res.hit.node;
  // A label-folded row is judged on the UIA name the walker saw (DEC-084 option B, censusName;
  // review round 1, W8-GUI-01), as carryLocators judges it.
  const expectedName = rec ? rec.name : censusName(row);
  const expectedType = rec ? rec.controlType : (row.locator?.controlType ?? null);
  const mismatch =
    censusMismatch(node, { name: expectedName, controlType: expectedType }) ??
    (rec ? censusMismatch(node, { name: censusName(row) }) : null);
  if (mismatch) {
    return fail(
      action,
      tgt,
      "LOCATOR_STALE",
      `the ${locBuild} locator resolves to an element that differs from the census (${mismatch}); nothing was sent`,
    );
  }
  const warnings: string[] = [];
  if (res.narrowed) {
    warnings.push(
      `${res.count} elements share the automation id; the census name and type picked one`,
    );
  }
  if (snap.stopReason) warnings.push(`the walk stopped early (${snap.stopReason})`);

  if (drive) {
    const why = rowDenyRefusal(row, rec, deny, [node.name]);
    if (why) return fail(action, tgt, "NOT_ALLOWLISTED", `${why}; nothing was sent`);
    const pattern = ACTION_PATTERN[action as DriveAction];
    if (!node.patterns.includes(pattern)) {
      return fail(
        action,
        tgt,
        "INVALID_ARGUMENT",
        `the element offers no ${pattern} pattern (it offers: ${node.patterns.join(", ") || "none"}); nothing was sent`,
      );
    }
  }

  const confirm = args.confirm === true;
  const op = drive && confirm ? (action as DriveAction) : "read";
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const r = await runDriver(
    {
      pid,
      hwnd: snap.window.hwnd,
      path: res.hit.path,
      expect: { automationId: node.automationId, name: node.name, controlType: node.controlType },
      op,
      ...(op === "setValue" ? { value: args.value as string } : {}),
      settleMs,
    },
    { run },
  );
  if (!r.ok) {
    const err = driverFailure(action, tgt, r, op !== "read");
    if (op !== "read" && r.code === "runner") {
      const post = await checkDialogs(pid, { run });
      if (post.ok && post.dialogs.length) {
        err.warnings.push(
          `dialogs open now: ${post.dialogs.map((w) => `"${describeDialog(w).title}"`).join(", ")}`,
        );
      }
    }
    return err;
  }

  const locator = {
    source,
    build: locBuild,
    ...(spec.automationId ? { automationId: spec.automationId } : {}),
    ...(spec.path ? { path: spec.path } : {}),
    window: win,
    ...(rec ? { evidence: rec.evidence } : {}),
  };

  if (action === "read") {
    return {
      ok: true,
      action,
      target: tgt,
      changed: null,
      readback: {
        rowId,
        locator,
        build: locBuild,
        current: source === "build-file" && locBuild === build,
        resolved: res.count,
        ...stateFields(r.before),
        capture: {
          rowId,
          window: win,
          ...(spec.automationId ? { automationId: spec.automationId } : {}),
          ...(spec.path ? { path: spec.path } : {}),
          resolved: res.count,
          name: node.name,
          controlType: node.controlType,
        },
      },
      ...(source === "ledger"
        ? {
            next: `This is the ${locBuild} census locator; drive actions need a ${build} locator (P-W8-02 records this read).`,
          }
        : {}),
      warnings,
    };
  }

  if (op === "read") {
    return {
      ok: true,
      action,
      target: tgt,
      changed: null,
      readback: {
        rowId,
        dryRun: true,
        acted: false,
        would: `${ACTION_PATTERN[action as DriveAction]} on "${node.name}" (${node.controlType})`,
        locator,
        before: stateFields(r.before),
        ...(action === "setValue" ? { previous: r.before?.value ?? null } : {}),
      },
      next: "Dry run: nothing was acted on. Pass confirm: true to act.",
      warnings,
    };
  }

  // After the act: the dialogs open now that were not open before (rule 1.2.5).
  const known = new Set(before.map((w) => w.hwnd));
  const post = await checkDialogs(pid, { run });
  const raised = post.ok ? post.dialogs.filter((w) => !known.has(w.hwnd)) : [];
  if (!post.ok) warnings.push(`the dialog check after the act failed: ${post.error}`);
  if (raised.length) {
    warnings.push(
      `a dialog opened: ${raised.map((w) => `"${describeDialog(w).title}"`).join(", ")}; no handler call is made while it is open`,
    );
  }
  return {
    ok: true,
    action,
    target: tgt,
    changed: stateChanges(rowId, r.before, r.after),
    readback: {
      rowId,
      acted: r.acted,
      locator,
      before: stateFields(r.before),
      after: stateFields(r.after),
      modals: raised.map(describeDialog),
      ...(action === "setValue"
        ? { previous: r.before?.value ?? null, readback: r.after?.value ?? null }
        : {}),
    },
    ...(raised.length
      ? {
          next: "Close the dialog with wb_gui dismiss (Cancel, Close or No) before any other call.",
        }
      : {}),
    warnings,
  };
}

// ── dismiss ─────────────────────────────────────────────────────────────────────────────────────

async function dismiss(
  args: Raw,
  pid: number,
  tgt: string,
  run: PowerShellRunner,
  deps: GuiDeps,
  root: string,
): Promise<GuiResponse> {
  const action = "dismiss";
  const policy = (deps.policy ?? (() => readPolicy(root)))();
  const build = (deps.build ?? (() => readCurrentBuild(root)))() ?? "unknown";
  const gate = gateRefusal(policy, action, null, build);
  if (gate) return fail(action, tgt, gate.code, gate.message);

  const pre = await checkDialogs(pid, { run });
  if (!pre.ok) return fail(action, tgt, "HANDLER_ERROR", pre.error ?? "the window list failed");
  const title = typeof args.dialog === "string" ? args.dialog : undefined;
  const shown = pre.dialogs.map((w) => `"${describeDialog(w).title}"`).join(", ") || "none";
  const cands =
    title === undefined
      ? pre.dialogs
      : pre.dialogs.filter((w) => w.title === title || describeDialog(w).title === title);
  if (cands.length !== 1) {
    return fail(
      action,
      tgt,
      "INVALID_ARGUMENT",
      cands.length === 0
        ? `no open dialog${title !== undefined ? ` titled "${title}"` : ""} (open: ${shown})`
        : `${cands.length} dialogs are open (${shown}); pass dialog (its exact title)`,
    );
  }
  const dlg = cands[0];
  const dtitle = describeDialog(dlg).title;
  if (dlg.title === AUTH_WINDOW_TITLE) {
    return fail(
      action,
      tgt,
      "NOT_ALLOWLISTED",
      `"${AUTH_WINDOW_TITLE}" is never answered by a tool; the owner answers it`,
    );
  }
  const snap = await snapshot(
    { pid, hwnd: dlg.hwnd, allowOwned: true },
    { bounds: { maxDepth: DIALOG_READ_DEPTH, maxNodes: 500, budgetMs: 10_000 }, view: "control" },
    { run },
  );
  if (!snap.ok || !snap.tree || !snap.window) {
    return fail(action, tgt, "HANDLER_ERROR", snap.reason ?? "the dialog could not be read");
  }
  const buttons = find(snap.tree, { controlType: "Button", limit: FIND_LIMIT_MAX }).hits;
  let chosen: (typeof buttons)[number] | null = null;
  let pressed: string | null = null;
  for (const want of DISMISS_BUTTONS) {
    const m = buttons.filter((b) => normLabel(b.node.name) === normLabel(want));
    if (m.length > 1) {
      return fail(
        action,
        tgt,
        "INVALID_ARGUMENT",
        `${m.length} "${want}" buttons in "${dtitle}"; refusing to choose`,
      );
    }
    if (m.length === 1) {
      chosen = m[0];
      pressed = want;
      break;
    }
  }
  if (!chosen || !pressed) {
    const names = [...new Set(buttons.map((b) => b.node.name).filter(Boolean))];
    return fail(
      action,
      tgt,
      "NOT_ALLOWLISTED",
      `"${dtitle}" has no Cancel, Close or No button (it shows: ${names.map((n) => `"${n}"`).join(", ") || "none"}); nothing else is ever pressed`,
      "Close the dialog by hand.",
    );
  }
  // Belt and braces: the chosen button is never a commit button.
  if (gatedRefusal([chosen.node.name], [])) {
    return fail(action, tgt, "NOT_ALLOWLISTED", `"${chosen.node.name}" is a commit button`);
  }
  if (!chosen.node.patterns.includes("Invoke")) {
    return fail(action, tgt, "INVALID_ARGUMENT", `"${pressed}" offers no Invoke pattern`);
  }
  const r = await runDriver(
    {
      pid,
      hwnd: dlg.hwnd,
      path: chosen.path,
      expect: {
        automationId: chosen.node.automationId,
        name: chosen.node.name,
        controlType: chosen.node.controlType,
      },
      op: "invoke",
      settleMs: deps.settleMs ?? DEFAULT_SETTLE_MS,
    },
    { run },
  );
  if (!r.ok) return driverFailure(action, tgt, r, false);
  const post = await checkDialogs(pid, { run });
  const dismissed = post.ok ? !post.windows.some((w) => w.hwnd === dlg.hwnd && w.visible) : null;
  const warnings: string[] = [];
  if (!post.ok) warnings.push(`the window check after the press failed: ${post.error}`);
  return {
    ok: true,
    action,
    target: tgt,
    changed: [{ path: `dialog:${dtitle}`, before: "open", after: dismissed ? "closed" : "open" }],
    readback: {
      dialog: dtitle,
      pressed,
      dismissed,
      modals: post.ok ? post.dialogs.map(describeDialog) : [],
    },
    ...(dismissed === false
      ? { next: "The dialog is still open: look at it (wb_gui modals) and close it by hand." }
      : {}),
    warnings,
  };
}

// ── The handler ─────────────────────────────────────────────────────────────────────────────────

let sharedWatchdog: ModalWatchdog | null = null;

/**
 * screenshot with a pid: one top-level window of that process only (hwnd, else the one visible
 * unowned window whose whole title matches windowTitle), never the desktop.
 */
async function windowScreenshot(
  args: Raw,
  target: Partial<SnapshotTarget>,
  tgt: string,
  run: PowerShellRunner,
  deps: GuiDeps,
  env: NodeJS.ProcessEnv,
): Promise<GuiResponse> {
  const action = "screenshot";
  const pid = target.pid as number;
  if (pid <= 0) return fail(action, tgt, "INVALID_ARGUMENT", "pid must be a positive integer");
  if (target.hwnd === undefined && target.titlePattern === undefined) {
    return fail(
      action,
      tgt,
      "INVALID_ARGUMENT",
      "a window screenshot needs windowTitle or hwnd with the pid",
      "Pass windowTitle (a regular expression of the whole title) or hwnd; omit pid for the desktop.",
    );
  }
  let rx: RegExp | null = null;
  if (target.titlePattern !== undefined) {
    try {
      rx = new RegExp(target.titlePattern);
    } catch {
      return fail(action, tgt, "INVALID_ARGUMENT", "windowTitle does not compile");
    }
  }
  const listed = await listWindows(pid, { run });
  if (!listed.ok) {
    return fail(action, tgt, "HANDLER_ERROR", listed.error ?? "the window list failed");
  }
  const hits = listed.windows.filter(
    (w) =>
      w.visible &&
      (target.hwnd !== undefined
        ? w.hwnd === target.hwnd
        : !w.owned &&
          (rx as RegExp).test(w.title) &&
          (target.className === undefined || w.className === target.className)),
  );
  if (hits.length !== 1) {
    return fail(
      action,
      tgt,
      "INVALID_ARGUMENT",
      hits.length === 0
        ? "no visible window of the pid matches; nothing was captured"
        : `${hits.length} windows match (${hits.map((w) => `"${w.title}"`).join(", ")}); nothing was captured`,
      "Narrow windowTitle or pass hwnd.",
    );
  }
  const w = hits[0];
  const dir = (deps.artifactsDir ?? (() => defaultArtifactsDir(env)))();
  const rel = `gui/window-${safeLabel(args.label, "capture")}-${stamp((deps.now ?? (() => new Date()))())}.png`;
  mkdirSync(join(dir, "gui"), { recursive: true });
  const r = await run(WINDOW_CAPTURE_SCRIPT, {
    timeoutMs: 30_000,
    env: { [CAPTURE_PATH_ENV]: join(dir, ...rel.split("/")), [CAPTURE_HWND_ENV]: String(w.hwnd) },
  });
  if (!r.ok) {
    return fail(
      action,
      tgt,
      "HANDLER_ERROR",
      "the window capture failed",
      "Retry once; check the desktop is unlocked and the window is not minimised.",
    );
  }
  const warnings: string[] = [];
  let size: unknown = null;
  try {
    size = JSON.parse(lastLine(r.stdout) ?? "null");
  } catch {
    warnings.push("the capture printed no size");
  }
  return {
    ok: true,
    action,
    target: `hwnd:${w.hwnd}`,
    changed: null,
    readback: {
      file: rel,
      relativeTo: "artifacts",
      size,
      window: { hwnd: w.hwnd, title: w.title, className: w.className },
    },
    warnings: [
      ...warnings,
      "the window's screen rectangle: a window in front of it is captured too; front it first",
    ],
  };
}

export async function runGui(args: Raw, deps: GuiDeps = {}): Promise<GuiResponse> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const action = String(args.action ?? "") as GuiAction;
  const root = deps.censusRoot ?? DEFAULT_CENSUS_ROOT;
  const target: Partial<SnapshotTarget> = {
    pid: intArg(args.pid),
    hwnd: intArg(args.hwnd),
    className: strArg(args.className),
    titlePattern: strArg(args.windowTitle),
  };
  const tgt = targetString(target);

  if (!(ACTIONS as readonly string[]).includes(action)) {
    return fail(action, tgt, "INVALID_ARGUMENT", `unknown action "${action}"`);
  }
  if (env[WB_GUI_ENV] !== "1") {
    return fail(
      action,
      tgt,
      "GATED",
      "wb_gui is opt-in and off",
      `set ${WB_GUI_ENV}=1 in the MCP server's environment and restart it`,
    );
  }
  if (platform !== "win32") {
    return fail(action, tgt, "GATED", "wb_gui is Windows-only", "Run the server on Windows.");
  }

  const run = deps.run ?? runPowerShell;
  if (action === "read" || (DRIVE_ACTIONS as readonly string[]).includes(action)) {
    return rowAction(action, args, { run, deps, root });
  }

  const warnings: string[] = [];

  if (action === "screenshot" && target.pid !== undefined) {
    return windowScreenshot(args, target, tgt, run, deps, env);
  }

  if (action === "screenshot") {
    const dir = (deps.artifactsDir ?? (() => defaultArtifactsDir(env)))();
    const rel = `gui/desktop-${safeLabel(args.label, "capture")}-${stamp((deps.now ?? (() => new Date()))())}.png`;
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(join(dir, "gui"), { recursive: true });
    const r = await run(CAPTURE_SCRIPT, { timeoutMs: 30_000, env: { [CAPTURE_PATH_ENV]: abs } });
    if (!r.ok) {
      return fail(
        action,
        "desktop",
        "HANDLER_ERROR",
        "the capture failed",
        "Retry once; check the desktop is unlocked.",
      );
    }
    let size: unknown = null;
    try {
      size = JSON.parse(lastLine(r.stdout) ?? "null");
    } catch {
      warnings.push("the capture printed no size");
    }
    return {
      ok: true,
      action,
      target: "desktop",
      changed: null,
      readback: { file: rel, relativeTo: "artifacts", size },
      warnings: [
        ...warnings,
        "the full desktop, all monitors: it may show other windows; it stays in the artifacts folder",
      ],
    };
  }

  if (target.pid === undefined || target.pid <= 0) {
    return fail(
      action,
      tgt,
      "INVALID_ARGUMENT",
      "pid is required (never the foreground window, never a title alone)",
      "Pass the Workbench pid (wb_state or the launch report), and windowTitle to pick a window.",
    );
  }
  const pidTarget = target as SnapshotTarget;

  if (action === "dismiss") return dismiss(args, pidTarget.pid, tgt, run, deps, root);

  if (action === "context") {
    const c = await readOpenContextMenu(pidTarget.pid, { run });
    if (!c.ok) {
      if (c.refusal === "auth") return fail(action, tgt, "MODAL_OPEN", c.reason ?? "");
      if (c.refusal === "none" || c.refusal === "several") {
        return fail(
          action,
          tgt,
          "INVALID_ARGUMENT",
          c.reason ?? "",
          c.refusal === "none"
            ? "Open the context menu by hand (right-click), then call context again."
            : "Close the extra popups by hand (Esc), then call again.",
        );
      }
      return fail(action, tgt, "HANDLER_ERROR", c.reason ?? "the read failed");
    }
    return {
      ok: true,
      action,
      target: tgt,
      changed: null,
      readback: { popup: c.popup, items: c.items, menus: c.menus, truncated: c.truncated },
      next: "The menu is left open: close it by hand (Esc). Nothing was sent.",
      warnings: c.truncated ? ["the menu has more items than were read"] : [],
    };
  }

  if (action === "modals") {
    const wd = deps.watchdog ?? (sharedWatchdog ??= new ModalWatchdog({ run }));
    const rep = await wd.watch(pidTarget.pid, { rebaseline: args.rebaseline === true });
    if (!rep.ok) {
      return fail(
        action,
        tgt,
        "HANDLER_ERROR",
        rep.error ?? "the window list failed",
        "Check the pid.",
      );
    }
    if (rep.baselineTaken) {
      warnings.push(
        "first look at this pid: baseline taken; later calls report windows new since now (known modal titles are reported at once)",
      );
    }
    return {
      ok: true,
      action,
      target: tgt,
      changed: null,
      readback: {
        windows: rep.windows,
        policy: rep.policy,
        modals: rep.modals,
        newWindows: rep.newWindows,
      },
      ...(rep.modals.length
        ? { next: "A modal is open: nothing is sent while it is; ask the owner to close it." }
        : rep.newWindows.length
          ? {
              next: "newWindows are not dialogs (a module window is unowned); once looked at, call modals with rebaseline: true.",
            }
          : {}),
      warnings,
    };
  }

  // tree / find. walker.py select_window needs class AND title (or one hwnd); when the caller
  // gives pid + title, the class is derived from the pid's windows whose title fully matches,
  // and only when they share exactly one class (review GUI-02).
  if (pidTarget.hwnd === undefined && pidTarget.className === undefined) {
    if (pidTarget.titlePattern === undefined) {
      return fail(
        action,
        tgt,
        "INVALID_ARGUMENT",
        "name the window: windowTitle (with className, or the class is derived), or hwnd",
      );
    }
    let rx: RegExp;
    try {
      rx = new RegExp(`^(?:${pidTarget.titlePattern})$`);
    } catch {
      return fail(action, tgt, "INVALID_ARGUMENT", "windowTitle does not compile");
    }
    const listed = await listWindows(pidTarget.pid, { run });
    if (!listed.ok) {
      return fail(
        action,
        tgt,
        "HANDLER_ERROR",
        listed.error ?? "the window list failed",
        "Check the pid.",
      );
    }
    const classes = [
      ...new Set(
        listed.windows
          .filter((w) => w.pid === pidTarget.pid && w.visible && rx.test(w.title))
          .map((w) => w.className),
      ),
    ];
    if (classes.length !== 1) {
      return fail(
        action,
        tgt,
        "INVALID_ARGUMENT",
        classes.length === 0
          ? "no visible window of the pid has a title matching windowTitle"
          : `${classes.length} window classes match windowTitle; pass className or hwnd`,
      );
    }
    pidTarget.className = classes[0];
  }
  const depth = intArg(args.depth);
  const rowSampling = intArg(args.rowSampling);
  const view = args.view === "raw" ? "raw" : "control";
  const snap = await snapshot(
    pidTarget,
    {
      bounds: {
        ...(depth !== undefined ? { maxDepth: depth } : {}),
        ...(rowSampling !== undefined ? { rowSample: rowSampling } : {}),
      },
      view,
    },
    { run },
  );
  if (!snap.ok || !snap.tree) {
    return fail(
      action,
      tgt,
      snap.window ? "HANDLER_ERROR" : "INVALID_ARGUMENT",
      snap.reason ?? "the snapshot failed",
      snap.window
        ? "Retry once; if the window is not responding, check wb_gui modals."
        : "Name one window: windowTitle (a regular expression matched against the whole title), className or hwnd.",
    );
  }
  if (snap.stopReason)
    warnings.push(`the walk stopped early (${snap.stopReason}); the tree is partial`);
  const win = {
    hwnd: snap.window!.hwnd,
    title: snap.window!.title,
    className: snap.window!.className,
    owned: snap.window!.owned,
  };

  if (action === "find") {
    const q = {
      text: strArg(args.query),
      controlType: strArg(args.controlType),
      automationId: strArg(args.automationId),
      name: strArg(args.name),
      limit: intArg(args.limit),
    };
    if (!q.text && !q.controlType && !q.automationId && !q.name) {
      return fail(
        action,
        tgt,
        "INVALID_ARGUMENT",
        "find needs query, controlType, automationId or name",
      );
    }
    const res = find(snap.tree, q);
    if (res.total > res.hits.length)
      warnings.push(
        `${res.total} matches; ${res.hits.length} shown (limit up to ${FIND_LIMIT_MAX})`,
      );
    return {
      ok: true,
      action,
      target: tgt,
      changed: null,
      readback: { window: win, nodes: snap.nodes, total: res.total, hits: res.hits },
      warnings,
    };
  }

  // tree
  const full = JSON.stringify(snap.tree);
  if (full.length <= INLINE_TREE_MAX_CHARS) {
    return {
      ok: true,
      action,
      target: tgt,
      changed: null,
      readback: { window: win, nodes: snap.nodes, elapsedMs: snap.elapsedMs, tree: snap.tree },
      warnings,
    };
  }
  const dir = (deps.artifactsDir ?? (() => defaultArtifactsDir(env)))();
  const rel = `gui/tree-${safeLabel(args.label, `pid${pidTarget.pid}`)}-${stamp((deps.now ?? (() => new Date()))())}.json`;
  mkdirSync(join(dir, "gui"), { recursive: true });
  writeFileSync(
    join(dir, ...rel.split("/")),
    JSON.stringify({ window: win, tree: snap.tree }, null, 1),
    {
      encoding: "utf-8",
      flag: "wx",
    },
  );
  warnings.push(
    `the tree (${full.length} chars) is in the artifacts folder; the outline shows ${OUTLINE_DEPTH} levels`,
  );
  return {
    ok: true,
    action,
    target: tgt,
    changed: null,
    readback: {
      window: win,
      nodes: snap.nodes,
      counted: countNodes(snap.tree),
      file: rel,
      relativeTo: "artifacts",
      outline: outline(snap.tree, OUTLINE_DEPTH),
    },
    next: "Use find to locate one element instead of reading the file.",
    warnings,
  };
}

// ── Registration (main registers it in src/server.ts) ───────────────────────────────────────────

export const WB_GUI_INPUT = {
  action: z.enum(ACTIONS),
  pid: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Workbench process id (required except screenshot; with screenshot, windowTitle or hwnd: that window only)"),
  rowId: z.string().optional().describe("read and drive actions: a ui census row id"),
  confirm: CONFIRM_SCHEMA.optional().describe("drive actions: act (else a dry run)"),
  value: z.string().optional().describe("setValue: the text"),
  dialog: z.string().optional().describe("dismiss: the dialog's exact title"),
  windowTitle: z
    .string()
    .optional()
    .describe("Regular expression matched against the whole window title"),
  className: z.string().optional().describe("Win32 window class"),
  hwnd: z.number().int().positive().optional(),
  depth: z.number().int().min(1).max(200).optional().describe("tree: maximum depth (default 40)"),
  rowSampling: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("rows read per list or tree (default 40)"),
  view: z.enum(["control", "raw"]).optional(),
  query: z.string().optional().describe("find: substring of name or automation id"),
  controlType: z.string().optional(),
  automationId: z.string().optional(),
  name: z.string().optional(),
  limit: z.number().int().min(1).max(FIND_LIMIT_MAX).optional(),
  label: z.string().optional().describe("screenshot/tree file label"),
  rebaseline: z.boolean().optional().describe("modals: take the windows open now as the baseline"),
};

/** The drive actions act on the GUI (when enabled and confirmed): not read-only, not idempotent. */
export const WB_GUI_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export function registerWbGui(server: McpServer, deps: GuiDeps = {}): void {
  server.registerTool(
    "wb_gui",
    { description: WB_GUI_DESCRIPTION, inputSchema: WB_GUI_INPUT, annotations: WB_GUI_ANNOTATIONS },
    async (args: Raw) => {
      const res = await runGui(args, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
