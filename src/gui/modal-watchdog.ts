/**
 * Modal watchdog of the GUI layer (plan 8 work package 3.5), generalising
 * `src/workbench/launcher-nudge.ts` (which looks for one known modal title, "Missing Addon
 * Dependencies", among a pid's windows and never blind-clicks it).
 *
 * Detection follows DEC-042 U6: "a blocked queue plus a new unowned window of the pid is a
 * modal; the pending calls are lost, the session survives" (engine reset after about 120 s).
 * `watch(pid)` lists the pid's top-level windows (src/gui/uia.ts `listWindows`), compares them
 * with the baseline it took on its first call for that pid, and reports each new visible window
 * that is not a menu popup (menus.py `is_popup` classes: Qt `…QWindowPopup…` and the untitled
 * `SysShadow`): unowned top-level windows and owned dialogs alike. Known modal titles (the
 * authorization prompt, the missing-dependencies modal) are reported even with no baseline.
 * Each report carries the button names read from the window's accessibility tree.
 *
 * Answering: ONLY by an explicit rule of data/census/policy.json (`live_lane.modal_watchdog` or
 * `dry_run.modal_watchdog`, `answers: [{ titleMatches, classMatches?, button }]`, exact
 * equality). policy.json now carries `live_lane.modal_watchdog` with an empty `answers` list,
 * so the behaviour is report and wait (DEC-047 L3, DEC-046 U6 row); DEFAULT_POLICY (the same
 * behaviour) applies only when both blocks are absent. Even a rule never answers "Script Authorization Required"
 * (plan 5.7: the owner answers that prompt). The watchdog itself sends no input: a decision to
 * answer is returned as data; pressing a button is `wb_gui invoke`, which is GATED in Phase 3.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CENSUS_ROOT } from "../census/ledger-io.js";
import {
  find,
  isMenuPopup,
  listWindows,
  redactText,
  snapshot,
  type UiaDeps,
  type WindowInfo,
} from "./uia.js";

/** menus.ts / menus.py AUTH_WINDOW_TITLE: never answered by any tool. */
export const AUTH_WINDOW_TITLE = "Script Authorization Required";
/** launcher-nudge.ts MISSING_DEPS_WINDOW_TITLE. */
export const MISSING_DEPS_WINDOW_TITLE = "Missing Addon Dependencies";
/** Titles reported as modals even without a baseline. */
export const KNOWN_MODAL_TITLES = [AUTH_WINDOW_TITLE, MISSING_DEPS_WINDOW_TITLE] as const;

/** Depth of the button read inside a modal (a dialog's buttons sit a few levels down). */
export const BUTTON_READ_DEPTH = 8;

export interface ModalReport {
  hwnd: number;
  title: string;
  className: string;
  owned: boolean;
  /** Button names read from the tree; null when the read failed (`buttonsError` says why). */
  buttons: string[] | null;
  buttonsError?: string;
  /** "baseline": new since the first watch of this pid; "known-title": a known modal title. */
  basis: "baseline" | "known-title" | "new-window";
  authorization: boolean;
}

export interface AnswerRule {
  titleMatches: string;
  classMatches?: string;
  button: string;
}

export interface ModalPolicy {
  /** Where the rules came from ("default" when the policy carries no watchdog block). */
  source: string;
  answers: AnswerRule[];
}

export type ModalDecision =
  | { decision: "report-and-wait"; reason: string }
  | { decision: "answer"; button: string; rule: AnswerRule; note: string };

export interface WatchReport {
  ok: boolean;
  pid: number;
  error: string | null;
  /** True on the call that took the baseline (nothing new can be seen yet). */
  baselineTaken: boolean;
  windows: number;
  modals: Array<ModalReport & { decision: ModalDecision }>;
  /** New since the baseline and not dialog-like; listed until a rebaseline takes them in. */
  newWindows: Array<Pick<ModalReport, "hwnd" | "title" | "className" | "owned">>;
  policy: string;
}

// ── Policy ──────────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_POLICY: ModalPolicy = { source: "default: report and wait", answers: [] };

function rulesFrom(block: unknown): AnswerRule[] | null {
  const answers = (block as { answers?: unknown } | undefined)?.answers;
  if (!Array.isArray(answers)) return null;
  return answers.filter(
    (a): a is AnswerRule =>
      !!a &&
      typeof (a as AnswerRule).titleMatches === "string" &&
      typeof (a as AnswerRule).button === "string" &&
      ((a as AnswerRule).classMatches === undefined ||
        typeof (a as AnswerRule).classMatches === "string"),
  );
}

/** Read the watchdog rules from a parsed policy.json; the default when no block exists. */
export function modalPolicyFrom(policy: unknown): ModalPolicy {
  const p = (policy ?? {}) as {
    live_lane?: { modal_watchdog?: unknown };
    dry_run?: { modal_watchdog?: unknown };
  };
  const live = rulesFrom(p.live_lane?.modal_watchdog);
  if (live) return { source: "policy.json live_lane.modal_watchdog", answers: live };
  const dry = rulesFrom(p.dry_run?.modal_watchdog);
  if (dry) return { source: "policy.json dry_run.modal_watchdog", answers: dry };
  return DEFAULT_POLICY;
}

/** policy.json from the census folder; the default policy when it is missing or unreadable. */
export function loadModalPolicy(
  file: string = join(DEFAULT_CENSUS_ROOT, "policy.json"),
): ModalPolicy {
  if (!existsSync(file)) return DEFAULT_POLICY;
  try {
    return modalPolicyFrom(JSON.parse(readFileSync(file, "utf-8")));
  } catch {
    return DEFAULT_POLICY;
  }
}

/**
 * The decision for one modal. The authorization prompt is never answered, whatever the
 * policy says. Otherwise a rule answers only on exact title (and class, when given) equality
 * and only with a button the tree actually showed.
 */
export function decide(m: ModalReport, policy: ModalPolicy): ModalDecision {
  if (m.authorization || m.title === AUTH_WINDOW_TITLE) {
    return {
      decision: "report-and-wait",
      reason: `"${AUTH_WINDOW_TITLE}" is never answered by a tool; the owner answers it`,
    };
  }
  const rule = policy.answers.find(
    (r) =>
      r.titleMatches === m.title &&
      (r.classMatches === undefined || r.classMatches === m.className) &&
      r.titleMatches !== AUTH_WINDOW_TITLE,
  );
  if (!rule) return { decision: "report-and-wait", reason: `no answer rule (${policy.source})` };
  if (!m.buttons || !m.buttons.includes(rule.button)) {
    return {
      decision: "report-and-wait",
      reason: `the rule names "${rule.button}" but the dialog shows no such button`,
    };
  }
  return {
    decision: "answer",
    button: rule.button,
    rule,
    note: "decision only: pressing it is wb_gui invoke, gated in Phase 3; nothing was sent",
  };
}

// ── Detection ───────────────────────────────────────────────────────────────────────────────────

/**
 * The windows of `current` that count as modals: new since `baseline` (by hwnd), visible, not a
 * menu popup; plus any visible window with a known modal title. `baseline` null: only the
 * known titles.
 */
/**
 * A window that can be a prompt (the live harness's rule, scripts/live/s-c-natives.ts
 * isDialogLike): the Win32 dialog class, or an owned window that is not a Qt tool window. A
 * module window is unowned and of the main window's class (DEC-053), so it is not one.
 */
export function isDialogLike(w: Pick<WindowInfo, "className" | "owned">): boolean {
  if (w.className === "#32770") return true;
  return w.owned && !/QWindowTool/i.test(w.className);
}

/**
 * Windows of the pid to report. "known-title": a known modal title, baseline or not.
 * "baseline": new since the baseline and dialog-like, a modal. "new-window": new since the
 * baseline and not dialog-like (a module window the owner opened, or an unowned box): reported
 * apart from the modals, since it does not show that anything is blocked.
 */
export function detectModals(
  baseline: WindowInfo[] | null,
  current: WindowInfo[],
  pid: number,
): Array<{ window: WindowInfo; basis: ModalReport["basis"] }> {
  const before = new Set((baseline ?? []).map((w) => w.hwnd));
  const out: Array<{ window: WindowInfo; basis: ModalReport["basis"] }> = [];
  for (const w of current) {
    if (w.pid !== pid || !w.visible) continue;
    if ((KNOWN_MODAL_TITLES as readonly string[]).includes(w.title)) {
      out.push({ window: w, basis: "known-title" });
      continue;
    }
    if (baseline === null || before.has(w.hwnd) || isMenuPopup(w)) continue;
    out.push({ window: w, basis: isDialogLike(w) ? "baseline" : "new-window" });
  }
  return out;
}

/** Button names of one window, read from its accessibility tree (read-only). */
export async function readButtons(
  pid: number,
  w: WindowInfo,
  deps: UiaDeps = {},
): Promise<{ buttons: string[] | null; error?: string }> {
  const snap = await snapshot(
    { pid, hwnd: w.hwnd, allowOwned: true },
    { bounds: { maxDepth: BUTTON_READ_DEPTH, maxNodes: 500, budgetMs: 10_000 } },
    deps,
  );
  if (!snap.ok || !snap.tree) return { buttons: null, error: snap.reason ?? "read failed" };
  const names = find(snap.tree, { controlType: "Button", limit: 100 }).hits.map((h) => h.node.name);
  return { buttons: [...new Set(names.filter(Boolean))] };
}

// ── The watchdog ────────────────────────────────────────────────────────────────────────────────

export class ModalWatchdog {
  private baselines = new Map<number, WindowInfo[]>();

  constructor(
    private deps: UiaDeps = {},
    private policy: () => ModalPolicy = () => loadModalPolicy(),
  ) {}

  /** Forget the baseline of `pid` (the next watch takes a new one). */
  reset(pid?: number): void {
    if (pid === undefined) this.baselines.clear();
    else this.baselines.delete(pid);
  }

  /** Whether a baseline exists for `pid`. */
  hasBaseline(pid: number): boolean {
    return this.baselines.has(pid);
  }

  /** One look at the pid's windows: report every modal and the policy's decision on it. */
  /**
   * One look. `rebaseline` takes the windows open now as the new baseline (the caller has
   * looked at what `newWindows` listed); known modal titles are reported either way.
   */
  async watch(pid: number, opts: { rebaseline?: boolean } = {}): Promise<WatchReport> {
    const policy = this.policy();
    const listed = await listWindows(pid, this.deps);
    if (!listed.ok) {
      return {
        ok: false,
        pid,
        error: listed.error,
        baselineTaken: false,
        windows: 0,
        modals: [],
        newWindows: [],
        policy: policy.source,
      };
    }
    const baseline = opts.rebaseline ? null : (this.baselines.get(pid) ?? null);
    const baselineTaken = baseline === null;
    if (baselineTaken) {
      // The baseline excludes known modal titles, so a modal already open stays reported.
      this.baselines.set(
        pid,
        listed.windows.filter((w) => !(KNOWN_MODAL_TITLES as readonly string[]).includes(w.title)),
      );
    }
    const found = detectModals(baseline, listed.windows, pid);
    const modals: WatchReport["modals"] = [];
    const newWindows: WatchReport["newWindows"] = [];
    for (const { window: w, basis } of found) {
      if (basis === "new-window") {
        newWindows.push({
          hwnd: w.hwnd,
          title: redactText(w.title),
          className: redactText(w.className),
          owned: w.owned,
        });
        continue;
      }
      const b = await readButtons(pid, w, this.deps);
      const report: ModalReport = {
        hwnd: w.hwnd,
        title: w.title,
        className: w.className,
        owned: w.owned,
        buttons: b.buttons,
        ...(b.error ? { buttonsError: b.error } : {}),
        basis,
        authorization: w.title === AUTH_WINDOW_TITLE,
      };
      // Decide on the raw title (exact policy match), answer with redacted strings (GUI-04).
      modals.push({
        ...report,
        title: redactText(report.title),
        className: redactText(report.className),
        buttons: report.buttons ? report.buttons.map((x) => redactText(x)) : null,
        decision: decide(report, policy),
      });
    }
    return {
      ok: true,
      pid,
      error: null,
      baselineTaken,
      windows: listed.windows.length,
      modals,
      newWindows,
      policy: policy.source,
    };
  }
}
