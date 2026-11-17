/**
 * The action-plan checker of the dry-run gate (plan 6.2, BATTERY-AUTHOR row):
 * every live script has a dry-run mode against a mocked NET and accessibility
 * layer that fails if it would issue an invoke on a menu leaf, an Enter or
 * accelerator key, or a deny-listed path. The only exceptions are named
 * entries in `policy.json` (`dry_run.exceptions`), written by the main session.
 *
 * An action plan is a JSON array of `{ kind, target, ... }`:
 *
 *   net-call        { kind, target: "<APIFunc>" | { apiFunc }, params? }
 *   menu-open       { kind, target: { path: [...labels], window? } }
 *   invoke          { kind, target: { path | automationId, window? }, dialog?, role? }
 *   key             { kind, keys: "Ctrl+S" | "Enter" | ..., target?: { window } }
 *   execute-action  { kind, target: { path: [...labels], module? } }
 *   screenshot      { kind, target? }
 *   uia-read        { kind, target: { pid, window: { className, titlePattern,
 *                     allowOwned?, hwnd? } }, readOnly: true, view, bounds: { maxDepth,
 *                     maxNodes, budgetMs, rowSample, maxChildren, countCap,
 *                     callTimeoutMs, slowCallMs, maxConsecutiveErrors } }
 *                   the passive accessibility read of tools/uia/walk.ts. `pid` is
 *                   the Workbench pid, or "lane-recorded" in a plan written before
 *                   the launch (walk.ts refuses every pid but the one the lane
 *                   recorded)
 *   uia-menu        { kind, target: { window: { className, title } }, pid, menus: [...titles],
 *                     depth: 0 | 1, calls: ["Expand", "Collapse"], allowForeground?, timeoutMs }
 *                   the active menu tool of tools/uia/menus.ts (S-F blocker B4, owner ruling
 *                   Q4): ExpandCollapse Expand and Collapse only, on titles of the policy's
 *                   `live_lane.uia_menu.titles`; risk reversible (a Collapse undoes an Expand).
 *                   An optional `module` (a census module id) takes the titles from
 *                   `live_lane.uia_menu.titles_by_module[module]` instead (Phase 4, D11)
 *   uia-context     { kind, target: { pid, window: { className, titlePattern }, path: [...labels] },
 *                     calls: ["ShowContextMenu", "Collapse"], timeoutMs, module? }
 *                   one context menu shown on one right-click target and collapsed again
 *                   (Phase 4 L05, design 2.2): IUIAutomationElement3 ShowContextMenu and
 *                   ExpandCollapse Collapse only, on a target of `live_lane.uia_context.targets`
 *   uia-dialog-cancel
 *                   { kind, target: { pid, window: { className, title, owned: true } },
 *                     button: "Cancel" | "Close", titleBar?: true, calls: ["Invoke"] }
 *                   one Invoke on the button named exactly Cancel (or the title-bar Close) of
 *                   an owned window the step opened (Phase 4 L04/L06, design 2.2, D14); every
 *                   other label, and every wb_gui DIALOG_COMMIT_BUTTONS label, is refused; each
 *                   dialog needs a dry_run exception lifting uia-dialog-cancel-not-allow-listed
 *                   for its exact class and title
 *   ini-edit        { kind, command: "drop-section" | "set" | "read-keys", in, out?,
 *                     artifacts, keys?: [...key names], workbenchRunning: false }
 *                   one scratch-ini edit of scripts/live/ini-edit.ts (S-F blocker B6)
 *   lsp             { kind, host: "127.0.0.1", port, netPort, plan: "session" |
 *                     "second-client", methods: [...], hoverUri? }
 *                   one LSP client run of scripts/live/lsp-probe.ts (S-F blocker B5)
 *   launch          { kind, target: { gproj }, args: [...], precondition?: {
 *                     launcherLast: "EMCP2_decoy" }, ownerGo?: "scriptAuthorizeAll" }
 *                   one Workbench process start; `args` are the arguments after
 *                   the executable, `gproj` the project they name
 *
 * Any action may name `exception: "<policy exception id>"`.
 *
 * Rules (the first four are the policy's `dry_run.forbidden` names):
 *   invoke-menu-leaf    an invoke or menu-open whose target resolves to a
 *                       MenuItem with no children
 *   key-enter           Enter in any spelling (Enter, Return, {ENTER}, ~, VK_RETURN)
 *   key-accelerator     an Alt or Ctrl combination, Alt or Ctrl alone, SendKeys
 *                       `%` or `^` prefixes, or F10 (activates the menu bar)
 *   deny-listed-path    an invoke or execute-action whose path or label is on a
 *                       deny list; `<dialog>:confirm` entries match an invoke
 *                       with `dialog` and `role: "confirm"`
 *   not-allow-listed    an execute-action whose path is not on
 *                       `execute_action.allow_list` (plan 5.3); one marked
 *                       `candidate: true` is checked against
 *                       `execute_action.candidates` instead (DEC-100: a live
 *                       battery's candidate override, through the probe pack)
 *   dialog-opener-observed
 *                       an execute-action, or a net-call to an ExecuteAction
 *                       handler, whose path is on `execute_action.dialog_openers`
 *                       (a live run saw it open a dialog, DEC-100); no exception
 *                       lifts it
 *   deny-listed-api     a net-call to a never-on-a-live-instance or
 *                       development-only API
 *   unresolved-target   an invoke or menu-open whose target cannot be found in
 *                       the mocked accessibility tree (a leaf cannot be ruled out)
 *   uia-read-untargeted a uia-read whose pid is not a positive integer (or
 *                       "lane-recorded"), whose window class or title pattern is
 *                       missing or empty, that names the foreground window, or
 *                       whose allowOwned is not a boolean or hwnd not a positive
 *                       integer
 *   uia-read-unbounded  a uia-read with one of the nine bounds missing, not a
 *                       positive integer, or above its cap in
 *                       `live_lane.uia_read` (no cap in the policy: refused)
 *   uia-read-not-read-only
 *                       a uia-read whose readOnly is not true, or that carries an
 *                       element target (path, automationId), an apiFunc, keys,
 *                       key, dialog, role or params
 *   deny-listed-switch  a launch argument whose switch (up to `=`, without case)
 *                       is on `deny_lists.*.cli_switches`; the one exception is
 *                       the exact token `-scriptAuthorizeAll`, accepted on any
 *                       launch (owner ruling 2026-11-06, the 2.0 release standard;
 *                       a launch that still carries `ownerGo: "scriptAuthorizeAll"`,
 *                       plan 5.7 / DEC-041, is accepted as before)
 *   launch-not-sandbox  a launch whose project is not the 2.0 sandbox
 *                       (`.../EMCP2_sandbox/EMCP2_sandbox.gproj` or
 *                       `<sandbox>/EMCP2_sandbox.gproj`), that names no project or
 *                       more than one, whose `target.gproj` is not the project of
 *                       its arguments, or that names the project with the old
 *                       `-wbProjectPath` switch without the precondition
 *                       `launcherLast: "EMCP2_decoy"` (the switch may be ignored
 *                       and the launcher then opens its preselected project;
 *                       DEC-029, session S-A)
 *   uia-menu-untargeted a uia-menu whose pid is not a positive integer (or
 *                       "lane-recorded"), or whose window class or title is missing
 *   uia-menu-not-allow-listed
 *                       a uia-menu with no titles, a title twice, a title not on
 *                       `live_lane.uia_menu.titles`, more than `maxMenus` titles, or
 *                       no uia_menu block in the policy
 *   uia-menu-unbounded  a uia-menu whose depth is not an integer from 0 to `maxDepth`
 *                       (never above 1), or whose timeoutMs is missing, above `totalMs`
 *                       or above `perMenuMs` times the titles (times 4 at depth 1)
 *   uia-menu-not-expand-only
 *                       a uia-menu whose calls are not Expand and Collapse only (any
 *                       Invoke, Toggle, Select, SetValue, SetFocus, key or click), or
 *                       that carries an element target, apiFunc, keys, key, dialog, role
 *                       or params
 *   uia-context-untargeted
 *                       a uia-context whose pid is not a positive integer (or "lane-recorded"),
 *                       whose window class or title pattern is missing, or whose target path
 *                       is not a non-empty list of labels
 *   uia-context-not-allow-listed
 *                       a uia-context whose target path is not on `live_lane.uia_context.targets`
 *                       (for its module when the entry names one), or no uia_context block
 *   uia-context-unbounded
 *                       a uia-context whose timeoutMs is missing or above `perTargetMs`
 *   uia-context-not-show-only
 *                       a uia-context whose calls are not ShowContextMenu then optionally
 *                       Collapse (any Invoke, Expand, Select, key or click), or that carries
 *                       an automationId, apiFunc, keys, key, dialog, role, button or params
 *   uia-dialog-cancel-untargeted
 *                       a uia-dialog-cancel whose pid is not a positive integer (or
 *                       "lane-recorded"), whose window class or title is missing, or whose
 *                       window is not owned (owned: true)
 *   uia-dialog-cancel-refused
 *                       a uia-dialog-cancel whose button is not exactly "Cancel" or "Close", a
 *                       Close without titleBar: true, a button on DIALOG_COMMIT_BUTTONS, calls
 *                       other than exactly ["Invoke"], or that carries a path, automationId,
 *                       apiFunc, keys, key, role or params
 *   uia-dialog-cancel-not-allow-listed
 *                       every uia-dialog-cancel, unless a dry_run exception for this script,
 *                       class and title lifts it (the D14 exception per dialog)
 *   dialog-opener-not-listed
 *                       an execute-action with opensDialog whose path is not on
 *                       `live_lane.dialog_openers.paths` (an opener is checked against that list,
 *                       not execute_action.allow_list), or whose opensDialog is not true
 *   ini-edit-refused    an ini-edit whose command is not drop-section, set or
 *                       read-keys; whose in, out or artifacts is missing; whose in or out
 *                       is not inside artifacts; whose out is its in (or missing for an
 *                       edit); that sets a NetAPI_* key; or whose workbenchRunning is not
 *                       false (Workbench holds the ini and writes it back)
 *   lsp-refused         an lsp action whose host is not 127.0.0.1, whose port is not a
 *                       port number or equals netPort, whose plan is not session or
 *                       second-client, or whose methods are missing or name didSave,
 *                       didChange, willSave, applyEdit, executeCommand, shutdown or exit,
 *                       or whose hoverUri is not a file inside the 2.0 sandbox
 *   unknown-kind        any kind not listed above
 *
 * An exception lifts exactly the rule it names (`allows`) for an action that
 * names it, only when the action's target window class and title equal the
 * exception's `target.windowClassMatches` and `target.titleMatches` exactly,
 * only for the script the exception names, and at most once per plan (the
 * modal test may post ONE Enter). Exact equality, not a pattern, is deliberate.
 * No exception lifts a rule of a uia-read, a uia-menu, a uia-context, an ini-edit, an lsp or a
 * launch, nor the untargeted or refused rules of a uia-dialog-cancel.
 *
 * Usage:
 *   npx tsx scripts/live/dry-run.ts <plan.json> [--uia <tree.json>] [--script <path>]
 *       [--policy <policy.json>]
 * Exit code 0 on pass, 1 on fail.
 */

import { readFileSync } from "node:fs";
import { DIALOG_COMMIT_BUTTONS } from "../../src/tools/wb-gui.js";
import { isMainModule, parseArgs } from "./cli.js";
import { MockUia, isMenuLeaf, normalizeLabel, type UiaNode } from "./mock/uia.js";
import { DECOY_NAME, SANDBOX_NAME } from "./paths.js";
import {
  deniedApi,
  deniedApiNames,
  deniedLabels,
  deniedSwitch,
  loadPolicy,
  type CensusPolicy,
  type DryRunException,
} from "./policy.js";

// ── Types ────────────────────────────────────────────────────────────────────

export const ACTION_KINDS = [
  "net-call",
  "menu-open",
  "invoke",
  "key",
  "execute-action",
  "screenshot",
  "uia-read",
  "uia-menu",
  "uia-context",
  "uia-dialog-cancel",
  "ini-edit",
  "lsp",
  "launch",
] as const;

/** The nine bounds of a passive accessibility read (tools/uia/walk.ts WalkBounds). */
export const UIA_READ_BOUNDS = [
  "maxDepth",
  "maxNodes",
  "budgetMs",
  "rowSample",
  "maxChildren",
  "countCap",
  "callTimeoutMs",
  "slowCallMs",
  "maxConsecutiveErrors",
] as const;

/** A uia-read pid in a plan written before the launch: the Workbench pid the lane recorded. */
export const LANE_RECORDED_PID = "lane-recorded";

/**
 * Names (lower case, without the dash) of the switches that name the project of
 * a launch; `wbprojectpath` is the old form (S-A-1). A matcher, never an argv:
 * the names are written without the dash so the flag test
 * (tests/census/cli-flags.test.ts) counts only switches the code passes.
 */
export const PROJECT_SWITCHES = ["gproj", "wbprojectpath"] as const;

/** The old project switch, which may be ignored (DEC-024, DEC-029). */
const OLD_PROJECT_SWITCH = "wbprojectpath";

export type ActionKind = (typeof ACTION_KINDS)[number];

export interface ActionWindow {
  className?: string;
  title?: string;
  /** uia-read and uia-context: the window title as a pattern. */
  titlePattern?: string;
  /** uia-dialog-cancel: the dialog is an owned window. */
  owned?: boolean;
}

export interface ActionTarget {
  /** uia-read, uia-context, uia-dialog-cancel: the Workbench pid or "lane-recorded". */
  pid?: number | string;
  path?: string[] | string;
  automationId?: string;
  apiFunc?: string;
  module?: string;
  window?: ActionWindow;
}

export interface PlanAction {
  kind: string;
  target?: ActionTarget | string;
  keys?: string;
  key?: string;
  dialog?: string;
  role?: string;
  exception?: string;
  [extra: string]: unknown;
}

export type RuleId =
  | "invoke-menu-leaf"
  | "key-enter"
  | "key-accelerator"
  | "deny-listed-path"
  | "not-allow-listed"
  | "deny-listed-api"
  | "unresolved-target"
  | "uia-read-untargeted"
  | "uia-read-unbounded"
  | "uia-read-not-read-only"
  | "uia-menu-untargeted"
  | "uia-menu-not-allow-listed"
  | "uia-menu-unbounded"
  | "uia-menu-not-expand-only"
  | "uia-context-untargeted"
  | "uia-context-not-allow-listed"
  | "uia-context-unbounded"
  | "uia-context-not-show-only"
  | "uia-dialog-cancel-untargeted"
  | "uia-dialog-cancel-refused"
  | "uia-dialog-cancel-not-allow-listed"
  | "dialog-opener-not-listed"
  | "dialog-opener-observed"
  | "ini-edit-refused"
  | "lsp-refused"
  | "deny-listed-switch"
  | "launch-not-sandbox"
  | "unknown-kind";

/** Rules no policy exception lifts. */
const UNLIFTABLE: ReadonlySet<RuleId> = new Set<RuleId>([
  "uia-read-untargeted",
  "uia-read-unbounded",
  "uia-read-not-read-only",
  "uia-menu-untargeted",
  "uia-menu-not-allow-listed",
  "uia-menu-unbounded",
  "uia-menu-not-expand-only",
  "uia-context-untargeted",
  "uia-context-not-allow-listed",
  "uia-context-unbounded",
  "uia-context-not-show-only",
  "uia-dialog-cancel-untargeted",
  "uia-dialog-cancel-refused",
  "dialog-opener-not-listed",
  "dialog-opener-observed",
  "ini-edit-refused",
  "lsp-refused",
  "deny-listed-switch",
  "launch-not-sandbox",
]);

/**
 * Kinds no exception touches at all, whatever rule they raise (review P4 F3: a uia-context's
 * deny-listed-path is a shared rule id, so the rule set alone did not hold the header's claim).
 */
const UNLIFTABLE_KINDS: ReadonlySet<string> = new Set([
  "uia-read",
  "uia-menu",
  "uia-context",
  "ini-edit",
  "lsp",
  "launch",
]);

export interface Violation {
  index: number;
  kind: string;
  rule: RuleId;
  detail: string;
}

export interface CheckOptions {
  /** Mocked accessibility tree the plan's targets resolve against. */
  uia?: UiaNode | MockUia;
  /** Repo-relative path of the script whose plan this is (for exceptions). */
  script?: string;
}

export interface CheckResult {
  ok: boolean;
  violations: Violation[];
  /** Exceptions applied, as `{ index, id, rule }`. */
  exceptionsUsed: Array<{ index: number; id: string; rule: RuleId }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function targetObject(action: PlanAction): ActionTarget {
  if (typeof action.target === "string") return { path: action.target };
  return action.target ?? {};
}

/** A path as a list of labels. Strings split on " > " or "/". */
export function pathOf(path: string[] | string | undefined): string[] {
  if (path === undefined) return [];
  if (Array.isArray(path)) return path;
  return path
    .split(/\s*>\s*|\//)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ENTER_TOKENS = new Set([
  "enter",
  "return",
  "{enter}",
  "~",
  "vk_return",
  "numpadenter",
  "{numpadenter}",
  "numpad_enter",
  "kp_enter",
  "vk_separator",
  "\n",
  "\r",
  "\r\n",
]);
const MODIFIER_TOKENS = new Set([
  "alt",
  "lalt",
  "ralt",
  "altgr",
  "menu",
  "vk_menu",
  "ctrl",
  "control",
  "lctrl",
  "rctrl",
  "vk_control",
  "{alt}",
  "{ctrl}",
]);

/** Classify a key spec: "enter", "accelerator" or null (plain key). */
export function classifyKey(spec: string): "enter" | "accelerator" | "mnemonic" | null {
  const raw = spec.trim();
  const lower = raw.toLowerCase();
  if (ENTER_TOKENS.has(lower) || lower.includes("{enter}") || lower.includes("numpadenter")) {
    return "enter";
  }
  if (raw.includes("~")) return "enter";
  // A bare letter or digit activates a mnemonic while a menu is open (plan
  // 4.5 L02: no accelerator keys during a walk); the dry run treats every
  // single printable character as one unless a named exception lifts it.
  if (/^[A-Za-z0-9]$/.test(raw)) return "mnemonic";
  const tokens = lower.split(/\s*\+\s*/).filter(Boolean);
  if (tokens.some((t) => ENTER_TOKENS.has(t))) return "enter";
  if (tokens.some((t) => MODIFIER_TOKENS.has(t))) return "accelerator";
  // SendKeys notation: ^ is Ctrl, % is Alt.
  if (/[\^%]/.test(raw)) return "accelerator";
  if (tokens.includes("f10") || tokens.includes("{f10}")) return "accelerator";
  return null;
}

function resolveTarget(uia: MockUia | null, t: ActionTarget): UiaNode | null {
  if (!uia) return null;
  let scope: UiaNode = uia.root;
  if (t.window && (t.window.title !== undefined || t.window.className !== undefined)) {
    const w = uia.findWindow(t.window);
    if (!w) return null;
    scope = w;
  }
  if (t.automationId) return uia.findByAutomationId(t.automationId, scope);
  const path = pathOf(t.path);
  if (path.length === 0) return null;
  return uia.findByPath(path, scope);
}

function allowListed(path: string[], allow: Array<string | string[]>): boolean {
  const key = path.map(normalizeLabel).join("/");
  return allow.some((entry) => pathOf(entry).map(normalizeLabel).join("/") === key);
}

function exceptionApplies(
  ex: DryRunException,
  rule: RuleId,
  action: PlanAction,
  script: string | undefined,
): boolean {
  if (ex.allows !== rule) return false;
  if (ex.script !== undefined && ex.script !== script) return false;
  const w = targetObject(action).window;
  if (!w) return false;
  const wantClass = ex.target?.windowClassMatches;
  const wantTitle = ex.target?.titleMatches;
  if (wantClass === undefined && wantTitle === undefined) return false;
  if (wantClass !== undefined && w.className !== wantClass) return false;
  if (wantTitle !== undefined && w.title !== wantTitle) return false;
  return true;
}

// ── uia-read and launch ──────────────────────────────────────────────────────

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * The caps of the nine uia-read bounds from `policy.live_lane.uia_read`. A key
 * with no positive integer cap is absent: a bound without a cap is refused.
 */
export function uiaReadCaps(policy: CensusPolicy): Partial<Record<string, number>> {
  const raw = policy.live_lane?.uia_read ?? {};
  const out: Partial<Record<string, number>> = {};
  for (const k of UIA_READ_BOUNDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (isPositiveInt(v)) out[k] = v;
  }
  return out;
}

/**
 * Violations of a passive accessibility read (the reference rule of
 * tools/uia/walk.ts `checkUiaReadAction`, which delegates here). `caps` maps
 * each bound to its ceiling; a bound with no cap is refused.
 */
export function uiaReadViolations(
  action: PlanAction,
  caps: Partial<Record<string, number>>,
): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const t = (typeof action.target === "object" && action.target ? action.target : {}) as Record<
    string,
    unknown
  >;
  const w = (typeof t.window === "object" && t.window ? t.window : {}) as Record<string, unknown>;
  if (!isPositiveInt(t.pid) && t.pid !== LANE_RECORDED_PID) {
    out.push({
      rule: "uia-read-untargeted",
      detail: `target.pid is not a positive integer or "${LANE_RECORDED_PID}"`,
    });
  }
  if (typeof w.className !== "string" || !w.className.trim()) {
    out.push({ rule: "uia-read-untargeted", detail: "target.window.className is missing" });
  }
  if (typeof w.titlePattern !== "string" || !w.titlePattern) {
    out.push({ rule: "uia-read-untargeted", detail: "target.window.titlePattern is missing" });
  }
  if (t.foreground !== undefined || w.foreground !== undefined || t.window === "foreground") {
    out.push({ rule: "uia-read-untargeted", detail: "the target names the foreground window" });
  }
  if (w.allowOwned !== undefined && typeof w.allowOwned !== "boolean") {
    out.push({ rule: "uia-read-untargeted", detail: "target.window.allowOwned is not a boolean" });
  }
  if (w.hwnd !== undefined && !isPositiveInt(w.hwnd)) {
    out.push({
      rule: "uia-read-untargeted",
      detail: "target.window.hwnd is not a positive integer",
    });
  }
  const b = (typeof action.bounds === "object" && action.bounds ? action.bounds : {}) as Record<
    string,
    unknown
  >;
  for (const k of UIA_READ_BOUNDS) {
    const cap = caps[k];
    if (cap === undefined) {
      out.push({
        rule: "uia-read-unbounded",
        detail: `bounds.${k} has no cap in policy live_lane.uia_read`,
      });
      continue;
    }
    const v = b[k];
    if (!isPositiveInt(v) || v > cap) {
      out.push({
        rule: "uia-read-unbounded",
        detail: `bounds.${k} must be an integer between 1 and ${cap}`,
      });
    }
  }
  if (action.readOnly !== true) {
    out.push({ rule: "uia-read-not-read-only", detail: "readOnly is not true" });
  }
  for (const k of ["path", "automationId", "apiFunc"]) {
    if (t[k] !== undefined) {
      out.push({
        rule: "uia-read-not-read-only",
        detail: `target.${k} names an element to act on`,
      });
    }
  }
  for (const k of ["keys", "key", "dialog", "role", "params"]) {
    if (action[k] !== undefined) {
      out.push({ rule: "uia-read-not-read-only", detail: `the action carries "${k}"` });
    }
  }
  return out;
}

// ── uia-menu ─────────────────────────────────────────────────────────────────

/** The only calls a uia-menu may carry. */
export const UIA_MENU_CALLS: ReadonlySet<string> = new Set(["Expand", "Collapse"]);

export interface UiaMenuCaps {
  titles: string[];
  /** Per census module (`titles_by_module`); a uia-menu naming `module` uses these. */
  titlesByModule: Record<string, string[]>;
  maxMenus: number;
  maxDepth: number;
  perMenuMs: number;
  totalMs: number;
}

/** `policy.live_lane.uia_menu`, or null when the block is missing or malformed (then refused). */
export function uiaMenuCaps(policy: CensusPolicy): UiaMenuCaps | null {
  const raw = policy.live_lane?.uia_menu as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const titles = raw.titles;
  if (!Array.isArray(titles) || !titles.every((t) => typeof t === "string" && t)) return null;
  const n = (k: string) => (Number.isInteger(raw[k]) ? (raw[k] as number) : null);
  const maxMenus = n("maxMenus");
  const maxDepth = n("maxDepth");
  const perMenuMs = n("perMenuMs");
  const totalMs = n("totalMs");
  if (maxMenus === null || maxDepth === null || perMenuMs === null || totalMs === null) return null;
  if (maxMenus < 1 || maxDepth < 0 || perMenuMs < 1 || totalMs < 1) return null;
  const byModule: Record<string, string[]> = {};
  const rawBy = raw.titles_by_module;
  if (rawBy !== undefined) {
    if (!rawBy || typeof rawBy !== "object" || Array.isArray(rawBy)) return null;
    for (const [m, list] of Object.entries(rawBy as Record<string, unknown>)) {
      if (!Array.isArray(list) || !list.every((t) => typeof t === "string" && t)) return null;
      byModule[m] = list as string[];
    }
  }
  return {
    titles: titles as string[],
    titlesByModule: byModule,
    maxMenus,
    maxDepth: Math.min(maxDepth, 1),
    perMenuMs,
    totalMs,
  };
}

export function uiaMenuViolations(
  action: PlanAction,
  caps: UiaMenuCaps | null,
): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const t = (typeof action.target === "object" && action.target ? action.target : {}) as Record<
    string,
    unknown
  >;
  const w = (typeof t.window === "object" && t.window ? t.window : {}) as Record<string, unknown>;
  if (!isPositiveInt(action.pid) && action.pid !== LANE_RECORDED_PID) {
    out.push({
      rule: "uia-menu-untargeted",
      detail: `pid is not a positive integer or "${LANE_RECORDED_PID}"`,
    });
  }
  if (typeof w.className !== "string" || !w.className.trim()) {
    out.push({ rule: "uia-menu-untargeted", detail: "target.window.className is missing" });
  }
  if (typeof w.title !== "string" || !w.title) {
    out.push({ rule: "uia-menu-untargeted", detail: "target.window.title is missing" });
  }
  if (!caps) {
    out.push({
      rule: "uia-menu-not-allow-listed",
      detail: "policy live_lane.uia_menu is missing or malformed",
    });
  }
  const menus = action.menus;
  let titles = caps?.titles ?? [];
  let listName = "live_lane.uia_menu.titles";
  if (action.module !== undefined) {
    listName = `live_lane.uia_menu.titles_by_module.${String(action.module)}`;
    const forModule =
      typeof action.module === "string" &&
      caps &&
      Object.prototype.hasOwnProperty.call(caps.titlesByModule, action.module)
        ? caps.titlesByModule[action.module]
        : undefined;
    if (caps && forModule === undefined)
      out.push({
        rule: "uia-menu-not-allow-listed",
        detail: `module ${JSON.stringify(action.module)} has no titles_by_module entry`,
      });
    titles = forModule ?? [];
  }
  if (!Array.isArray(menus) || menus.length === 0) {
    out.push({ rule: "uia-menu-not-allow-listed", detail: "menus names no title" });
  } else {
    if (new Set(menus).size !== menus.length) {
      out.push({ rule: "uia-menu-not-allow-listed", detail: "menus names a title twice" });
    }
    if (caps) {
      for (const m of menus) {
        if (typeof m !== "string" || !titles.includes(m)) {
          out.push({
            rule: "uia-menu-not-allow-listed",
            detail: `menu title ${JSON.stringify(m)} is not on ${listName}`,
          });
        }
      }
      // A plan naming a module is capped by that module's own title count (Phase 4 D11).
      const maxMenus = action.module !== undefined ? titles.length : caps.maxMenus;
      if (menus.length > maxMenus) {
        out.push({
          rule: "uia-menu-not-allow-listed",
          detail: `${menus.length} titles, more than the cap ${maxMenus}`,
        });
      }
    }
  }
  const depth = action.depth;
  const maxDepth = caps ? caps.maxDepth : 0;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0 || depth > maxDepth) {
    out.push({
      rule: "uia-menu-unbounded",
      detail: `depth must be an integer from 0 to ${maxDepth}`,
    });
  }
  if (caps) {
    const count = Array.isArray(menus) ? menus.length : 0;
    const ceiling = Math.min(
      caps.totalMs,
      caps.perMenuMs * Math.max(1, count) * (depth === 1 ? 4 : 1),
    );
    if (!isPositiveInt(action.timeoutMs) || action.timeoutMs > ceiling) {
      out.push({
        rule: "uia-menu-unbounded",
        detail: `timeoutMs must be an integer between 1 and ${ceiling}`,
      });
    }
  }
  const calls = action.calls;
  if (
    !Array.isArray(calls) ||
    calls.length === 0 ||
    !calls.every((c) => UIA_MENU_CALLS.has(String(c)))
  ) {
    out.push({
      rule: "uia-menu-not-expand-only",
      detail:
        "calls must be Expand and Collapse only (never Invoke, Toggle, Select, SetValue, SetFocus, a key or a click)",
    });
  }
  for (const k of ["path", "automationId", "apiFunc"]) {
    if (t[k] !== undefined) {
      out.push({
        rule: "uia-menu-not-expand-only",
        detail: `target.${k} names an element to act on`,
      });
    }
  }
  for (const k of ["keys", "key", "dialog", "role", "params"]) {
    if (action[k] !== undefined) {
      out.push({ rule: "uia-menu-not-expand-only", detail: `the action carries "${k}"` });
    }
  }
  if (action.allowForeground !== undefined && typeof action.allowForeground !== "boolean") {
    out.push({ rule: "uia-menu-untargeted", detail: "allowForeground is not a boolean" });
  }
  return out;
}

// ── uia-context and uia-dialog-cancel (Phase 4, design 2.2) ─────────────────

/** The only calls a uia-context may carry, in this order (Collapse optional). */
export const UIA_CONTEXT_CALLS: readonly string[] = ["ShowContextMenu", "Collapse"];

export interface UiaContextCaps {
  targets: Array<{ module?: string; path: string[] }>;
  perTargetMs: number;
}

/** `policy.live_lane.uia_context`, or null when missing or malformed (then refused). */
export function uiaContextCaps(policy: CensusPolicy): UiaContextCaps | null {
  const raw = policy.live_lane?.uia_context as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  if (!isPositiveInt(raw.perTargetMs) || !Array.isArray(raw.targets)) return null;
  const targets: UiaContextCaps["targets"] = [];
  for (const t of raw.targets as unknown[]) {
    const e = (t ?? {}) as Record<string, unknown>;
    if (
      !Array.isArray(e.path) ||
      !e.path.length ||
      !e.path.every((x) => typeof x === "string" && x)
    )
      return null;
    if (e.module !== undefined && typeof e.module !== "string") return null;
    targets.push({ module: e.module as string | undefined, path: e.path as string[] });
  }
  return { targets, perTargetMs: raw.perTargetMs };
}

export function uiaContextViolations(
  action: PlanAction,
  caps: UiaContextCaps | null,
): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const t = (typeof action.target === "object" && action.target ? action.target : {}) as Record<
    string,
    unknown
  >;
  const w = (typeof t.window === "object" && t.window ? t.window : {}) as Record<string, unknown>;
  if (!isPositiveInt(t.pid) && t.pid !== LANE_RECORDED_PID)
    out.push({
      rule: "uia-context-untargeted",
      detail: `target.pid is not a positive integer or "${LANE_RECORDED_PID}"`,
    });
  if (typeof w.className !== "string" || !w.className.trim())
    out.push({ rule: "uia-context-untargeted", detail: "target.window.className is missing" });
  if (typeof w.titlePattern !== "string" || !w.titlePattern)
    out.push({ rule: "uia-context-untargeted", detail: "target.window.titlePattern is missing" });
  const path = t.path;
  const pathOk =
    Array.isArray(path) && path.length > 0 && path.every((x) => typeof x === "string" && x);
  if (!pathOk)
    out.push({ rule: "uia-context-untargeted", detail: "target.path is not a list of labels" });
  if (!caps) {
    out.push({
      rule: "uia-context-not-allow-listed",
      detail: "policy live_lane.uia_context is missing or malformed",
    });
  } else {
    if (pathOk) {
      const key = (path as string[]).map(normalizeLabel).join("/");
      const listed = caps.targets.some(
        (e) =>
          e.path.map(normalizeLabel).join("/") === key &&
          (e.module === undefined || e.module === action.module),
      );
      if (!listed)
        out.push({
          rule: "uia-context-not-allow-listed",
          detail: `target "${(path as string[]).join(" > ")}" is not on live_lane.uia_context.targets`,
        });
    }
    if (!isPositiveInt(action.timeoutMs) || action.timeoutMs > caps.perTargetMs)
      out.push({
        rule: "uia-context-unbounded",
        detail: `timeoutMs must be an integer between 1 and ${caps.perTargetMs}`,
      });
  }
  const calls = action.calls;
  const callsOk =
    Array.isArray(calls) &&
    calls.length >= 1 &&
    calls.length <= 2 &&
    calls.every((c, i) => c === UIA_CONTEXT_CALLS[i]);
  if (!callsOk)
    out.push({
      rule: "uia-context-not-show-only",
      detail:
        'calls must be ["ShowContextMenu"] or ["ShowContextMenu", "Collapse"] (never Invoke, Expand, Select, a key or a click)',
    });
  for (const k of ["automationId", "apiFunc"])
    if (t[k] !== undefined)
      out.push({
        rule: "uia-context-not-show-only",
        detail: `target.${k} names an element to act on`,
      });
  for (const k of ["keys", "key", "dialog", "role", "button", "params"])
    if (action[k] !== undefined)
      out.push({ rule: "uia-context-not-show-only", detail: `the action carries "${k}"` });
  return out;
}

/** The only buttons a uia-dialog-cancel may press: exactly these labels. */
export const DIALOG_CANCEL_BUTTONS: readonly string[] = ["Cancel", "Close"];

export function uiaDialogCancelViolations(
  action: PlanAction,
): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const t = (typeof action.target === "object" && action.target ? action.target : {}) as Record<
    string,
    unknown
  >;
  const w = (typeof t.window === "object" && t.window ? t.window : {}) as Record<string, unknown>;
  if (!isPositiveInt(t.pid) && t.pid !== LANE_RECORDED_PID)
    out.push({
      rule: "uia-dialog-cancel-untargeted",
      detail: `target.pid is not a positive integer or "${LANE_RECORDED_PID}"`,
    });
  if (typeof w.className !== "string" || !w.className.trim())
    out.push({
      rule: "uia-dialog-cancel-untargeted",
      detail: "target.window.className is missing",
    });
  if (typeof w.title !== "string" || !w.title)
    out.push({ rule: "uia-dialog-cancel-untargeted", detail: "target.window.title is missing" });
  if (w.owned !== true)
    out.push({
      rule: "uia-dialog-cancel-untargeted",
      detail: "target.window.owned is not true (only an owned window the step opened)",
    });
  const button = action.button;
  const commit = new Set(DIALOG_COMMIT_BUTTONS.map((b) => normalizeLabel(b).toLowerCase()));
  if (typeof button !== "string" || !DIALOG_CANCEL_BUTTONS.includes(button))
    out.push({
      rule: "uia-dialog-cancel-refused",
      detail: `button ${JSON.stringify(button)} is not exactly "Cancel" or "Close"`,
    });
  if (typeof button === "string" && commit.has(normalizeLabel(button).toLowerCase()))
    out.push({
      rule: "uia-dialog-cancel-refused",
      detail: `button "${button}" is a commit button (DIALOG_COMMIT_BUTTONS)`,
    });
  if (button === "Close" && action.titleBar !== true)
    out.push({
      rule: "uia-dialog-cancel-refused",
      detail: "Close is pressed only on the title bar (titleBar: true)",
    });
  if (action.titleBar !== undefined && (action.titleBar !== true || button !== "Close"))
    out.push({ rule: "uia-dialog-cancel-refused", detail: "titleBar: true goes with Close only" });
  const calls = action.calls;
  if (!Array.isArray(calls) || calls.length !== 1 || calls[0] !== "Invoke")
    out.push({ rule: "uia-dialog-cancel-refused", detail: 'calls must be exactly ["Invoke"]' });
  for (const k of ["path", "automationId", "apiFunc"])
    if (t[k] !== undefined)
      out.push({ rule: "uia-dialog-cancel-refused", detail: `target.${k} names another element` });
  for (const k of ["keys", "key", "role", "params"])
    if (action[k] !== undefined)
      out.push({ rule: "uia-dialog-cancel-refused", detail: `the action carries "${k}"` });
  out.push({
    rule: "uia-dialog-cancel-not-allow-listed",
    detail: `a scripted Cancel on "${String(w.title)}" needs its dry_run exception (D14)`,
  });
  return out;
}

// ── ini-edit and lsp ─────────────────────────────────────────────────────────

export const INI_EDIT_COMMANDS: ReadonlySet<string> = new Set(["drop-section", "set", "read-keys"]);

/** Inside `root` (both resolved; either slash style), never `root` itself. */
function pathInside(path: string, root: string): boolean {
  const norm = (x: string) => x.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const p = norm(path);
  const r = norm(root);
  if (!p || !r || p === r || !p.startsWith(`${r}/`)) return false;
  return !p
    .slice(r.length + 1)
    .split("/")
    .some((seg) => seg === ".." || seg === ".");
}

export function iniEditViolations(action: PlanAction): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const bad = (detail: string) => out.push({ rule: "ini-edit-refused", detail });
  const cmd = action.command;
  if (typeof cmd !== "string" || !INI_EDIT_COMMANDS.has(cmd)) {
    bad(`command ${JSON.stringify(cmd)} is not drop-section, set or read-keys`);
  }
  const art = typeof action.artifacts === "string" ? action.artifacts : "";
  const inp = typeof action.in === "string" ? action.in : "";
  const outp = typeof action.out === "string" ? action.out : "";
  if (!art) bad("artifacts is missing");
  if (!inp) bad("in is missing");
  else if (art && !pathInside(inp, art)) bad("in is not inside the artifacts folder");
  if (cmd !== "read-keys") {
    if (!outp) bad("out is missing");
    else if (art && !pathInside(outp, art)) bad("out is not inside the artifacts folder");
    if (
      outp &&
      inp &&
      outp.replace(/\\/g, "/").toLowerCase() === inp.replace(/\\/g, "/").toLowerCase()
    ) {
      bad("out is in");
    }
  }
  // An ini-edit's `keys` is a list of key names (PlanAction types `keys` as a key string).
  const keys = action.keys as unknown;
  if (keys !== undefined && !Array.isArray(keys)) bad("keys is not a list of key names");
  if (action.key !== undefined) bad("an ini-edit carries no key press");
  if (Array.isArray(keys)) {
    for (const k of keys) {
      if (typeof k !== "string" || /^NetAPI_/i.test(k)) {
        bad(`key ${JSON.stringify(k)} is refused (the NET API keys are the harness's channel)`);
      }
    }
  }
  if (action.workbenchRunning !== false) {
    bad("workbenchRunning is not false: no edit while Workbench holds the ini");
  }
  return out;
}

export const LSP_HOST_ONLY = "127.0.0.1";
export const LSP_FORBIDDEN_METHODS: ReadonlySet<string> = new Set([
  "textDocument/didSave",
  "textDocument/didChange",
  "textDocument/willSave",
  "textDocument/willSaveWaitUntil",
  "workspace/applyEdit",
  "workspace/executeCommand",
  "shutdown",
  "exit",
]);

function isPort(v: unknown): v is number {
  return isPositiveInt(v) && v <= 65535;
}

export function lspViolations(action: PlanAction): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const bad = (detail: string) => out.push({ rule: "lsp-refused", detail });
  if (action.host !== LSP_HOST_ONLY)
    bad(`host ${JSON.stringify(action.host)} is not ${LSP_HOST_ONLY}`);
  if (!isPort(action.port)) bad("port is not a port number");
  if (!isPort(action.netPort)) bad("netPort is not a port number");
  if (isPort(action.port) && action.port === action.netPort) {
    bad("port equals netPort (one NET call at a time; never a second NET connection)");
  }
  if (action.plan !== "session" && action.plan !== "second-client") {
    bad(`plan ${JSON.stringify(action.plan)} is not session or second-client`);
  }
  if (action.hoverUri !== undefined) {
    // Matches lsp-probe.ts (review F-H1/F-H4): hover and completion only on a file in the sandbox.
    const u = typeof action.hoverUri === "string" ? action.hoverUri.replace(/\\/g, "/") : "";
    const segs = u.split("/");
    const at = segs.findIndex((x) => x === SANDBOX_NAME || x === "<sandbox>");
    if (
      !(u.startsWith("file:///") || u.startsWith("<sandbox>/")) ||
      at === -1 ||
      at === segs.length - 1 ||
      segs.some((x) => x === ".." || x === "." || /^%2e/i.test(x))
    ) {
      bad("hoverUri is not a file inside the 2.0 sandbox");
    }
  }
  const methods = action.methods;
  if (!Array.isArray(methods) || methods.length === 0) bad("methods is missing");
  else {
    for (const m of methods) {
      if (typeof m !== "string" || LSP_FORBIDDEN_METHODS.has(m)) {
        bad(`method ${JSON.stringify(m)} is never sent`);
      }
    }
  }
  return out;
}

/**
 * True when `path` names the 2.0 sandbox project: its file is
 * `EMCP2_sandbox.gproj` and its folder `EMCP2_sandbox`, or the `<sandbox>`
 * placeholder a printed plan carries. Either slash style; case ignored.
 */
export function isSandboxProject(path: string): boolean {
  const segs = path
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .split(/[\\/]+/)
    .filter(Boolean);
  if (segs.length < 2) return false;
  const file = segs[segs.length - 1].toLowerCase();
  const folder = segs[segs.length - 2].toLowerCase();
  if (file !== `${SANDBOX_NAME}.gproj`.toLowerCase()) return false;
  return folder === SANDBOX_NAME.toLowerCase() || folder === "<sandbox>";
}

/** The project arguments of a launch: `{ switch, value }` for each `-gproj` or `-wbProjectPath`. */
export function projectArguments(args: readonly string[]): Array<{ sw: string; value: string }> {
  const out: Array<{ sw: string; value: string }> = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) continue;
    const eq = a.indexOf("=");
    const name = (eq === -1 ? a : a.slice(0, eq)).replace(/^-+/, "").toLowerCase();
    if (!(PROJECT_SWITCHES as readonly string[]).includes(name)) continue;
    const value = eq === -1 ? (args[i + 1] ?? "") : a.slice(eq + 1);
    if (eq === -1) i++;
    out.push({ sw: `-${name}`, value });
  }
  return out;
}

function samePath(a: string, b: string): boolean {
  const n = (s: string): string =>
    s
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .toLowerCase();
  return n(a) === n(b);
}

/** The one deny-listed switch every launch may carry (owner ruling 2026-11-06, the 2.0 release standard). */
export const SCRIPT_AUTHORIZE_ALL_SWITCH = "-scriptAuthorizeAll";

/** The launch action's legacy `ownerGo` value for `-scriptAuthorizeAll` (DEC-041); no longer required. */
export const OWNER_GO_SCRIPT_AUTHORIZE_ALL = "scriptAuthorizeAll";

/** Violations of a launch: denied switches, and a project that is not the 2.0 sandbox. */
export function launchViolations(
  action: PlanAction,
  policy: CensusPolicy,
): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const args = action.args;
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
    out.push({ rule: "launch-not-sandbox", detail: "args is not a list of strings" });
    return out;
  }
  // Owner ruling 2026-11-06 (the 2.0 release standard): the exact token -scriptAuthorizeAll passes on
  // any launch, with or without the legacy ownerGo (plan 5.7, DEC-041). Every other switch stays denied.
  for (const a of args as string[]) {
    if (a === SCRIPT_AUTHORIZE_ALL_SWITCH) continue;
    const hit = deniedSwitch([a], policy);
    if (hit) out.push({ rule: "deny-listed-switch", detail: `switch ${hit} is on a deny list` });
  }
  const projects = projectArguments(args as string[]);
  const t = (typeof action.target === "object" && action.target ? action.target : {}) as Record<
    string,
    unknown
  >;
  const gproj = typeof t.gproj === "string" ? t.gproj : null;
  if (projects.length === 0) {
    out.push({ rule: "launch-not-sandbox", detail: "the launch names no project" });
    return out;
  }
  if (projects.length > 1) {
    out.push({
      rule: "launch-not-sandbox",
      detail: `the launch names ${projects.length} projects (${projects.map((p) => p.sw).join(", ")})`,
    });
  }
  for (const p of projects) {
    if (!isSandboxProject(p.value)) {
      out.push({
        rule: "launch-not-sandbox",
        detail: `${p.sw} ${p.value || "(no value)"} is not the 2.0 sandbox project`,
      });
    }
    if (gproj === null || !samePath(gproj, p.value)) {
      out.push({
        rule: "launch-not-sandbox",
        detail: `target.gproj ${gproj ?? "(missing)"} is not the project the arguments name`,
      });
    }
    if (p.sw === `-${OLD_PROJECT_SWITCH}`) {
      const pre = (
        typeof action.precondition === "object" && action.precondition ? action.precondition : {}
      ) as Record<string, unknown>;
      if (pre.launcherLast !== DECOY_NAME) {
        out.push({
          rule: "launch-not-sandbox",
          detail:
            "-wbProjectPath may be ignored and the launcher then opens its preselected project; " +
            `this launch needs the precondition launcherLast: "${DECOY_NAME}"`,
        });
      }
    }
  }
  return out;
}

// ── Checker ──────────────────────────────────────────────────────────────────

/** Rule violations of one action, before exceptions. */
function actionViolations(
  action: PlanAction,
  policy: CensusPolicy,
  uia: MockUia | null,
): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const t = targetObject(action);
  const denied = deniedLabels(policy).map((l) => [normalizeLabel(l), l] as const);
  const deniedHit = (labels: string[]): string | null => {
    for (const label of labels) {
      const n = normalizeLabel(label);
      const hit = denied.find(([d]) => d === n);
      if (hit) return hit[1];
    }
    return null;
  };

  switch (action.kind) {
    case "screenshot":
      break;
    case "net-call": {
      const apiFunc = typeof action.target === "string" ? action.target : (t.apiFunc ?? "");
      const hit = deniedApi(apiFunc, deniedApiNames(policy));
      if (hit) out.push({ rule: "deny-listed-api", detail: `${apiFunc} is denied (${hit})` });
      // The shipped EMCP_WB_ExecuteAction handler runs an arbitrary menu path:
      // its path parameter is checked exactly like an execute-action entry.
      if (/executeaction/i.test(apiFunc)) {
        const params = (action.params ?? {}) as Record<string, unknown>;
        const rawPath = params.menuPath ?? params.path ?? params.action ?? params.actionPath;
        const path = pathOf(rawPath as string | string[] | undefined);
        const pathHit = deniedHit(path);
        if (pathHit)
          out.push({ rule: "deny-listed-path", detail: `"${pathHit}" is on a deny list` });
        if (allowListed(path, policy.execute_action?.dialog_openers ?? []))
          out.push({
            rule: "dialog-opener-observed",
            detail: `ExecuteAction path "${path.join(" > ")}" via ${apiFunc} is on execute_action.dialog_openers (a live run saw it open a dialog)`,
          });
        if (!allowListed(path, policy.execute_action?.allow_list ?? [])) {
          out.push({
            rule: "not-allow-listed",
            detail: `ExecuteAction path "${path.join(" > ")}" via ${apiFunc} is not on execute_action.allow_list`,
          });
        }
      }
      break;
    }
    case "key": {
      const spec = action.keys ?? action.key ?? "";
      const cls = classifyKey(spec);
      if (cls === "enter") out.push({ rule: "key-enter", detail: `key "${spec}" is Enter` });
      if (cls === "accelerator") {
        out.push({ rule: "key-accelerator", detail: `key "${spec}" is an accelerator` });
      }
      if (cls === "mnemonic") {
        out.push({
          rule: "key-accelerator",
          detail: `key "${spec}" is a bare character that activates a menu mnemonic`,
        });
      }
      break;
    }
    case "menu-open":
    case "invoke": {
      const path = pathOf(t.path);
      if (action.kind === "invoke") {
        const labels = [...path];
        if (action.dialog && action.role === "confirm") labels.push(`${action.dialog}:confirm`);
        const hit = deniedHit(labels);
        if (hit) out.push({ rule: "deny-listed-path", detail: `"${hit}" is on a deny list` });
      }
      const node = resolveTarget(uia, t);
      if (!node) {
        const what = t.automationId ? `automationId ${t.automationId}` : path.join(" > ");
        out.push({
          rule: "unresolved-target",
          detail: `target ${what || "(none)"} not found in the accessibility tree`,
        });
      } else {
        if (node.name && action.kind === "invoke") {
          const hit = deniedHit([node.name]);
          if (hit && !out.some((v) => v.rule === "deny-listed-path")) {
            out.push({ rule: "deny-listed-path", detail: `"${hit}" is on a deny list` });
          }
        }
        if (isMenuLeaf(node)) {
          out.push({
            rule: "invoke-menu-leaf",
            detail: `"${node.name}" is a MenuItem with no children`,
          });
        }
      }
      break;
    }
    case "execute-action": {
      const path = pathOf(t.path);
      const hit = deniedHit(path);
      if (hit) out.push({ rule: "deny-listed-path", detail: `"${hit}" is on a deny list` });
      if (allowListed(path, policy.execute_action?.dialog_openers ?? []))
        out.push({
          rule: "dialog-opener-observed",
          detail: `ExecuteAction path "${path.join(" > ")}" is on execute_action.dialog_openers (a live run saw it open a dialog)`,
        });
      if (action.opensDialog !== undefined) {
        const openers = (policy.live_lane?.dialog_openers as { paths?: unknown } | undefined)
          ?.paths;
        if (action.opensDialog !== true)
          out.push({ rule: "dialog-opener-not-listed", detail: "opensDialog is not true" });
        else if (!Array.isArray(openers) || !allowListed(path, openers as Array<string | string[]>))
          out.push({
            rule: "dialog-opener-not-listed",
            detail: `dialog opener "${path.join(" > ")}" is not on live_lane.dialog_openers.paths`,
          });
        break;
      }
      if (action.candidate === true) {
        // DEC-100: a candidate runs only through the probe pack's candidate override.
        if (!allowListed(path, policy.execute_action?.candidates ?? []))
          out.push({
            rule: "not-allow-listed",
            detail: `candidate ExecuteAction path "${path.join(" > ")}" is not on execute_action.candidates`,
          });
        break;
      }
      if (!allowListed(path, policy.execute_action?.allow_list ?? [])) {
        out.push({
          rule: "not-allow-listed",
          detail: `ExecuteAction path "${path.join(" > ")}" is not on execute_action.allow_list`,
        });
      }
      break;
    }
    case "uia-read":
      out.push(...uiaReadViolations(action, uiaReadCaps(policy)));
      break;
    case "uia-menu":
      out.push(...uiaMenuViolations(action, uiaMenuCaps(policy)));
      break;
    case "uia-context": {
      out.push(...uiaContextViolations(action, uiaContextCaps(policy)));
      const p = (action.target as Record<string, unknown> | undefined)?.path;
      const hit = Array.isArray(p) ? deniedHit(p.map(String)) : null;
      if (hit) out.push({ rule: "deny-listed-path", detail: `"${hit}" is on a deny list` });
      break;
    }
    case "uia-dialog-cancel":
      out.push(...uiaDialogCancelViolations(action));
      break;
    case "ini-edit":
      out.push(...iniEditViolations(action));
      break;
    case "lsp":
      out.push(...lspViolations(action));
      break;
    case "launch":
      out.push(...launchViolations(action, policy));
      break;
    default:
      out.push({ rule: "unknown-kind", detail: `unknown action kind "${action.kind}"` });
  }
  return out;
}

/**
 * Check an action plan against the policy. Fails on any violation that no
 * named exception lifts. Pure apart from reading nothing: the policy and the
 * accessibility tree are passed in.
 */
export function checkPlan(
  plan: PlanAction[],
  policy: CensusPolicy,
  opts: CheckOptions = {},
): CheckResult {
  if (!Array.isArray(plan)) throw new Error("An action plan must be a JSON array");
  const uia = opts.uia ? (opts.uia instanceof MockUia ? opts.uia : new MockUia(opts.uia)) : null;
  const exceptions = policy.dry_run?.exceptions ?? [];
  const used = new Set<string>();
  const result: CheckResult = { ok: true, violations: [], exceptionsUsed: [] };

  plan.forEach((action, index) => {
    const kind = action && typeof action.kind === "string" ? action.kind : String(action?.kind);
    for (const v of actionViolations(action ?? { kind }, policy, uia)) {
      const ex =
        action?.exception && !UNLIFTABLE.has(v.rule) && !UNLIFTABLE_KINDS.has(kind)
          ? exceptions.find((e) => e.id === action.exception)
          : undefined;
      if (ex && !used.has(ex.id) && exceptionApplies(ex, v.rule, action, opts.script)) {
        used.add(ex.id);
        result.exceptionsUsed.push({ index, id: ex.id, rule: v.rule });
        continue;
      }
      result.violations.push({ index, kind, rule: v.rule, detail: v.detail });
    }
  });
  result.ok = result.violations.length === 0;
  return result;
}

/** Human-readable verdict. */
export function formatResult(r: CheckResult): string {
  const lines: string[] = [];
  lines.push(
    r.ok ? "PASS" : `FAIL: ${r.violations.length} violation${r.violations.length !== 1 ? "s" : ""}`,
  );
  for (const v of r.violations)
    lines.push(`  action ${v.index} (${v.kind}): ${v.rule}: ${v.detail}`);
  for (const e of r.exceptionsUsed)
    lines.push(`  action ${e.index}: exception ${e.id} lifted ${e.rule}`);
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  try {
    const args = parseArgs(argv, ["uia", "script", "policy"]);
    const planPath = args.positional[0];
    if (!planPath) {
      console.error(
        "Usage: dry-run.ts <plan.json> [--uia <tree.json>] [--script <path>] [--policy <p>]",
      );
      return 2;
    }
    const plan = JSON.parse(readFileSync(planPath, "utf-8")) as PlanAction[];
    const policy = loadPolicy(args.options.policy);
    const uia = args.options.uia
      ? (JSON.parse(readFileSync(args.options.uia, "utf-8")) as UiaNode)
      : undefined;
    const r = checkPlan(plan, policy, { uia, script: args.options.script });
    console.log(formatResult(r));
    return r.ok ? 0 : 1;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
