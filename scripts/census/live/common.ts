/**
 * Shared, main-owned parts of the Phase 4 live GUI census walkers (design
 * `docs/v2/design/phase4-live-census.md`, sections 1 and 2; plan 6.1). Every
 * `scripts/census/live/L<nn>-<name>.ts` imports from here and copies nothing:
 *
 *   - the observation line type (section 1.1) and `validateLine()`;
 *   - the kind-from-controlType table (section 1.2, D6) as `kindOf()`;
 *   - identity (section 1.3, D7; plan 4.4): `objectNameOf()`, `chooseKey()`, `deriveId()`;
 *   - the window rule and the abortable step (moved without a change of behaviour from
 *     `tests/live/train2.live.ts`, which re-exports them): `isDialogWindow`,
 *     `isBenignToolWindow`, `isExpectedWindow`, `windowVerdict`, `baselineRefusal`, `watched`,
 *     plus the popup pair of the menu walks and the expected dialog of L04 (section 2.3);
 *   - the walker step runner `runWalkerSteps()` (started markers, records, raw obs files,
 *     heartbeat) and the CLI entry `runWalker()` (section 2.1; exit codes as train2).
 *
 * Nothing here launches Workbench or sends anything to it: a walker's step does its kernel calls
 * through `ctx.call()`, which a window verdict cuts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { KNOWN_MODAL_TITLES } from "../../../src/gui/modal-watchdog.js";
import { compareCodeUnits, jsonlLine } from "../../../src/census/canon.js";
import { deriveId as deriveRowId, normalizeLabel } from "../../../src/census/ids.js";
import {
  observationSchema,
  observedStateSchema,
  type Observation,
} from "../../../src/census/schemas.js";
import { isMainModule as isMain, liveGateReason, parseArgs } from "../../live/cli.js";
import { checkPlan, formatResult, type PlanAction } from "../../live/dry-run.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "../../live/evidence.js";
import { Lane } from "../../live/lane.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "../../live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../live/policy.js";
import { runPowerShell } from "../../live/powershell.js";
import { DEFAULT_PORT } from "../../live/netcall.js";
import {
  WINDOWS_SCRIPT,
  parseWindows,
  rawNetCall,
  windowChanges,
  type RawCallResult,
  type WindowInfo,
} from "../../live/s-c-natives.js";
import {
  acknowledgedMarkerPath,
  outsideArtifacts,
  startedMarkerPath,
} from "../../live/session-common.js";
import { defaultExec, processByPid } from "../../live/win.js";

export { isMain as isMainModule };

// ── Exit codes and window constants (moved from train2) ──────────────────────

export const EXIT = { done: 0, refused: 1, usage: 2, stopped: 3, aborted: 4, handoff: 5 } as const;

/**
 * The Qt window class every Workbench editor window carried in S-E's se-24 record (EV-S-E-044). An
 * expected window must have this class, no owner and be enabled; its title must match exactly.
 */
export const EDITOR_WINDOW_CLASS = "Qt683QWindowIcon";

/** How often a watched step lists the pid's windows. */
export const WINDOW_POLL_MS = 2_000;

/** The lane heartbeat interval (scripts/live/lane.ts DEFAULT_HEARTBEAT_MS). */
export const HEARTBEAT_MS = 60_000;

// ── The window rule (moved from train2 without a change of behaviour) ───────

/**
 * Is a window one the owner must handle (nothing is ever sent to it): a Win32 dialog, a known modal
 * title, an OWNED window (how a Qt modal shows: Qt does not disable the owner, s-c-natives
 * isDialogLike) or a disabled window, whatever its title.
 */
export function isDialogWindow(w: WindowInfo): boolean {
  if (isTooltipWindow(w)) return false;
  return (
    w.className === "#32770" ||
    (KNOWN_MODAL_TITLES as readonly string[]).includes(w.title) ||
    w.owner !== 0 ||
    w.enabled === false
  );
}

/**
 * Window classes that only ever draw a tooltip: the Win32 common-controls tooltip
 * (`tooltips_class32`), the shell's `MicrosoftWindowsTooltip`, and Qt's tooltip windows
 * (Qt 6.8.3 registers `Qt683QWindowToolTipSaveBits` and `Qt683QWindowToolTipDropShadowSaveBits`).
 */
export const TOOLTIP_WINDOW_CLASSES: readonly string[] = [
  "MicrosoftWindowsTooltip",
  "tooltips_class32",
  "Qt683QWindowToolTipSaveBits",
  "Qt683QWindowToolTipDropShadowSaveBits",
];

/**
 * A tooltip (W3 fix-up 1): a tooltip class, untitled, enabled. W3 run 1 (2026-11-12) cut
 * w3-03 and w3-11 on a `MicrosoftWindowsTooltip ""`, owner 0, enabled: the mouse rested over a
 * control after the w3-02 hand step. A tooltip is never a dialog and never a stop, whatever its
 * owner (a Win32 tooltip control is a WS_POPUP owned by the window it serves); it is recorded in
 * a step's windowsAdded like any change, never a verdict. A disabled or titled window of these classes stays under the rules below.
 */
export function isTooltipWindow(w: WindowInfo): boolean {
  return TOOLTIP_WINDOW_CLASSES.includes(w.className) && w.title === "" && w.enabled !== false;
}

/**
 * A Qt tool window of the main app that appears when the Script Editor opens: unowned, enabled,
 * class Qt683QWindowToolSaveBits, titled exactly "Arma Reforger Workbench" (P3-3 gate 1 launch 1,
 * 2026-10-10). Benign in every step: recorded in windowsAdded, never a stop. The dialog rule is
 * checked first.
 */
export const BENIGN_TOOL_WINDOW_CLASS = "Qt683QWindowToolSaveBits";
export const BENIGN_TOOL_WINDOW_TITLE = "Arma Reforger Workbench";

/**
 * Also benign: a transient unowned enabled Qt683QWindowIcon titled exactly "Arma Reforger Workbench"
 * (a module window before it took its title; P3-3 gate 2 launch 1, 2026-10-10; the World Editor then
 * showed as "World Editor - Unnamed empty world"). Recorded, never a stop.
 */
export function isBenignToolWindow(w: WindowInfo): boolean {
  return (
    !isDialogWindow(w) &&
    w.title === BENIGN_TOOL_WINDOW_TITLE &&
    (w.className === BENIGN_TOOL_WINDOW_CLASS ||
      w.className === EDITOR_WINDOW_CLASS ||
      // A tooltip while the owner hovers a menu (P4-1 remainder, 2026-10-12).
      w.className === "Qt683QWindowToolTipDropShadowSaveBits")
  );
}

/**
 * A window disabled by a busy Workbench, not a dialog (W5 fix-up 2): unowned, disabled, of the
 * editor class or the tool-window class, not #32770 and not a known modal title. W5 run 2
 * (2026-11-12) cut w5-60 on a Qt683QWindowToolSaveBits "Arma Reforger Workbench", owner 0, while
 * GM_Arland loaded (console.log 04:33:42 "Entities load", 04:33:49 "LoadWorld: 6663 ms"); by the
 * rule above only `enabled === false` could have made it dialog-like (owner 0, no #32770, title not
 * a known modal). A screenshot right after showed no dialog. The post-flight close then met the
 * World Editor window (Qt683QWindowIcon, unowned) disabled, and passed on a retry about 30 s later.
 * The same tool window, enabled, came and went in w5-10 of that run with no verdict. A real modal
 * is a window of its own (owned, #32770, a known title or an unexpected new window), each still
 * a verdict at once; a busy window alone is judged by its lifetime (`BUSY_GRACE_MS`), and nothing
 * is ever sent to it.
 */
export function isBusyWindow(w: WindowInfo): boolean {
  return (
    w.owner === 0 &&
    w.enabled === false &&
    w.className !== "#32770" &&
    !(KNOWN_MODAL_TITLES as readonly string[]).includes(w.title) &&
    (w.className === EDITOR_WINDOW_CLASS || w.className === BENIGN_TOOL_WINDOW_CLASS)
  );
}

/**
 * How long a busy-only change may last before it is a handoff (opt-in, `busyGraceMs`). W5 run 2:
 * the load of GM_Arland took 6.7 s by the log and every window was enabled again within about
 * 30 s of the cut (the post-flight retry); 60 s bounds that with room.
 */
export const BUSY_GRACE_MS = 60_000;

/**
 * Whether a window change is busy windows only: at least one busy window, every newly disabled
 * window busy, and the change with each busy window taken as enabled gives no verdict (so an
 * unexpected or owned window beside it still stops or hands off at once).
 */
export function isBusyOnlyChange(
  change: { added: WindowInfo[]; disabled: WindowInfo[] },
  expects: readonly RegExp[] | undefined,
  opts: VerdictOptions = {},
): boolean {
  const progress = (w: WindowInfo): boolean => opts.progressWindows === true && isProgressWindow(w);
  const graced = (w: WindowInfo): boolean => isBusyWindow(w) || progress(w);
  const busy = [...change.added, ...change.disabled].filter(graced);
  if (!busy.length || !change.disabled.every(graced)) return false;
  const rest = change.added
    .filter((w) => !progress(w))
    .map((w) => (isBusyWindow(w) ? { ...w, enabled: true } : w));
  return windowVerdict({ added: rest, disabled: [] }, expects, opts) === null;
}

/**
 * The progress window of a script reload (W3 fix-up 3, opt-in `progressWindows`): the editor class,
 * titled exactly like the app ("Arma Reforger Workbench"), OWNED, not #32770. W3 run 3 (2026-11-12)
 * cut w3-62 on `Qt683QWindowIcon "Arma Reforger Workbench", owner 9636142, enabled` at 10:45:19.9Z,
 * inside the reload the log times at 05:45:16.3 "Reloading game scripts" to 05:45:21.5 "Reloading
 * game scripts took: 5188 ms" (local = UTC-5); a screenshot seconds later showed no dialog, only the
 * toast "Game Scripts reloaded". The real dialog of the same run (w3-61, the "Reload" prompt with
 * Yes / Yes to All / No) was the same class, owned and enabled too: what told them apart was its own
 * title and its lifetime (it stayed until the hand pressed Yes). So a progress window is judged by
 * the title and a bounded lifetime (`busyGraceMs`): one that outlives the grace is a handoff. Any
 * other owned window (another title) is still a dialog at once.
 */
export function isProgressWindow(w: WindowInfo): boolean {
  return (
    w.owner !== 0 &&
    w.className === EDITOR_WINDOW_CLASS &&
    w.title === BENIGN_TOOL_WINDOW_TITLE &&
    !(KNOWN_MODAL_TITLES as readonly string[]).includes(w.title)
  );
}

/** An expected editor window: the editor class, unowned, enabled, its title matched exactly. */
export function isExpectedWindow(w: WindowInfo, expects: readonly RegExp[] | undefined): boolean {
  return (
    w.className === EDITOR_WINDOW_CLASS &&
    !isDialogWindow(w) &&
    (expects ?? []).some((re) => re.test(w.title))
  );
}

/** The popup window of a Qt menu (sf-13): unowned, enabled. */
export const POPUP_WINDOW_CLASS = "Qt683QWindowPopupDropShadowSaveBits";
/** Its drop shadow: unowned, untitled. */
export const POPUP_SHADOW_CLASS = "SysShadow";

/**
 * The popup pair of a menu or context-menu walk (L02, L05, L14 only; design 2.3): a
 * `Qt683QWindowPopupDropShadowSaveBits` window with no owner, or an untitled `SysShadow` with no
 * owner. Never a dialog (an owned or disabled one stays a handoff).
 */
export function isPopupPairWindow(w: WindowInfo): boolean {
  if (w.owner !== 0 || w.enabled === false) return false;
  if (w.className === POPUP_WINDOW_CLASS) return true;
  return w.className === POPUP_SHADOW_CLASS && w.title === "";
}

/** A dialog a step opens itself (L04): matched by exact title and owned flag, and class if given. */
export interface ExpectedDialog {
  title: string;
  owned: boolean;
  className?: string;
}

export function isExpectedDialog(
  w: WindowInfo,
  dialogs: readonly ExpectedDialog[] | undefined,
): boolean {
  // A known modal (authorization, missing deps) is never expected, whatever a step lists (D13 rule 2).
  if ((KNOWN_MODAL_TITLES as readonly string[]).includes(w.title)) return false;
  // Titles compare case-insensitively: the wiki writes "Create World", the live dialog is
  // "Create world" (P4-1 remainder, 2026-10-12).
  return (dialogs ?? []).some(
    (d) =>
      w.title.toLowerCase() === d.title.toLowerCase() &&
      (w.owner !== 0) === d.owned &&
      w.enabled !== false &&
      w.className !== "#32770" &&
      (d.className === undefined || w.className === d.className),
  );
}

/** What a step lets appear besides its expected editor windows (walkers only; train2 passes none). */
export interface VerdictOptions {
  /** L02, L05, L14: the menu popup pair is recorded, never a stop. */
  popups?: boolean;
  /** L04: the dialog the step opens is expected, not a handoff. */
  dialogs?: readonly ExpectedDialog[];
  /**
   * `watched` only (W5 fix-up 2): a busy-only change (`isBusyOnlyChange`) is a handoff only once
   * it has lasted this long; before that nothing is cut, and the step's end waits for it to clear.
   * Absent: every disabled window is a handoff at once (the rule unchanged).
   */
  busyGraceMs?: number;
  /**
   * With `busyGraceMs` only (W3 fix-up 3, a script reload): an owned progress window
   * (`isProgressWindow`) is graced like a busy window; past the grace it is a handoff.
   */
  progressWindows?: boolean;
}

/**
 * The stop rule over one window change: a dialog-like or disabled window is a handoff; a new window
 * that is not an expected editor window is a stop; an expected one is recorded. Null: go on.
 * `opts` (walkers) admits the popup pair and the step's own expected dialog; without it the rule is
 * train2's exactly.
 */
export function windowVerdict(
  change: { added: WindowInfo[]; disabled: WindowInfo[] },
  expects: readonly RegExp[] | undefined,
  opts: VerdictOptions = {},
): { kind: "stopped" | "handoff"; message: string } | null {
  // The window named is the most dialog-like one: W3 run 3's w3-61 handoff named the disabled
  // tool window "Arma Reforger Workbench" and not the "Reload" prompt beside it (fix-up 3). The
  // verdict is the same either way; only the name the hand is given changes.
  const dialogs = change.added.filter(
    (w) => isDialogWindow(w) && !isExpectedDialog(w, opts.dialogs),
  );
  const dialog = dialogs.find((w) => !isBusyWindow(w)) ?? dialogs[0];
  if (dialog)
    return {
      kind: "handoff",
      message: `a dialog-like window appeared (${dialog.className} "${dialog.title}", owner ${dialog.owner}): owner hand, nothing is sent to it`,
    };
  // A modal disables the window that owns it (and Qt's application-modal dialogs disable every
  // top-level window). When the step's own expected dialog is in `added`, the disabled windows it
  // explains (its owner, or an unowned top-level window) are that dialog's doing, not a second
  // modal: session 017's b-060 handed off twice on exactly this (DEC-057). A disabled window that
  // is itself owned (another dialog), or any disabled window without an expected dialog up,
  // stays a handoff.
  const expectedUp = change.added.filter((w) => isExpectedDialog(w, opts.dialogs));
  const unexplained = expectedUp.length
    ? change.disabled.filter((w) => w.owner !== 0 && !expectedUp.some((d) => d.owner === w.hwnd))
    : change.disabled;
  if (unexplained.length)
    return {
      kind: "handoff",
      message: `a window became disabled (${unexplained.map((w) => `"${w.title}"`).join(", ")}): a modal is up; owner hand`,
    };
  const unexpected = change.added.filter(
    (w) =>
      !isExpectedWindow(w, expects) &&
      !isBenignToolWindow(w) &&
      !isTooltipWindow(w) &&
      !isExpectedDialog(w, opts.dialogs) &&
      !(opts.popups === true && isPopupPairWindow(w)),
  );
  if (unexpected.length)
    return {
      kind: "stopped",
      message: `a new window: ${unexpected.map((w) => `${w.className} "${w.title}"`).join(", ")} (stop and record)`,
    };
  return null;
}

/** Why a step must not start: a dialog-like or disabled window of the pid is already up (TRAIN2-03). */
export function baselineRefusal(windows: readonly WindowInfo[], pid: number): string | null {
  const bad = windows.filter((w) => w.pid === pid && isDialogWindow(w));
  if (!bad.length) return null;
  return `a dialog-like or disabled window is already up (${bad.map((w) => `${w.className} "${w.title}", owner ${w.owner}`).join("; ")}): owner hand before any step`;
}

export class StopBattery extends Error {
  constructor(
    readonly kind: "stopped" | "aborted" | "handoff",
    message: string,
    readonly evidence: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StopBattery";
  }
}

/** Thrown inside a cut step by its next call or wait. */
export class StepCut extends Error {
  constructor() {
    super("the step was cut by the window poller: no further call sent");
  }
}

/** What `watched` needs: the window list and a sleep. */
export interface WatchDeps {
  windows: () => Promise<WindowInfo[]>;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Run `fn` while the pid's window list is polled. The baseline is the list at the step's start and
 * is refused when a dialog-like window is already up. The first window verdict aborts `abort`: the
 * step's calls and waits then throw, so nothing more is sent (TRAIN2-01); the call in flight is
 * left (nothing is sent to a dialog).
 */
export async function watched<T>(
  deps: WatchDeps,
  pid: number,
  expects: readonly RegExp[] | undefined,
  abort: AbortController,
  fn: () => Promise<T>,
  opts: VerdictOptions = {},
): Promise<{ value: T; added: WindowInfo[] }> {
  const baseline = await deps.windows();
  const refusal = baselineRefusal(baseline, pid);
  if (refusal) throw new StopBattery("handoff", refusal);
  let done = false;
  let seen: WindowInfo[] = [];
  // Consecutive checks that saw a busy-only change (opts.busyGraceMs); about WINDOW_POLL_MS apart.
  let busyChecks = 0;
  const grace = opts.busyGraceMs ?? 0;
  /** True while a busy-only change is inside its grace; throws on any other verdict. */
  const check = async (): Promise<boolean> => {
    const now = await deps.windows();
    const ch = windowChanges(baseline, now, pid);
    seen = ch.added;
    let v = windowVerdict(ch, expects, opts);
    if (v && grace > 0 && isBusyOnlyChange(ch, expects, opts)) {
      busyChecks++;
      if (busyChecks * WINDOW_POLL_MS < grace) return true;
      v = {
        kind: "handoff",
        message: `${v.message}; a busy window (disabled, unowned) lasted ${busyChecks} checks, about ${busyChecks * WINDOW_POLL_MS} ms, past the ${grace} ms grace`,
      };
    } else busyChecks = 0;
    if (v) {
      abort.abort();
      throw new StopBattery(v.kind, v.message, {
        windowsAdded: ch.added.map((w) => ({
          className: w.className,
          title: w.title,
          owner: w.owner,
          enabled: w.enabled,
        })),
      });
    }
    return false;
  };
  const poller = (async (): Promise<never> => {
    for (;;) {
      await deps.sleep(WINDOW_POLL_MS);
      if (done) return new Promise<never>(() => undefined);
      await check();
    }
  })();
  const body = fn();
  body.catch(() => undefined);
  try {
    const value = await Promise.race([body, poller]);
    done = true;
    // A busy-only change at the step's end is waited out (within the grace) so the next step's
    // baseline is not taken mid-load; past the grace, check() hands off.
    while (await check()) await deps.sleep(WINDOW_POLL_MS);
    return { value, added: seen };
  } finally {
    done = true;
    poller.catch(() => undefined);
  }
}

// ── The observation line (section 1.1) ───────────────────────────────────────

export const LIVE_KINDS = [
  "window",
  "menu",
  "menu-item",
  "shortcut",
  "toolbar",
  "toolbar-button",
  "dock",
  "panel",
  "tab",
  "dialog",
  "control",
  "property-group",
  "property",
  "property-editor",
  "context-menu",
  "context-item",
  "status-item",
  "region",
  "tool",
  "tool-button",
  "option",
  "diag-menu",
  "diag-option",
  "debug-panel",
  "hazard-dialog",
  "canvas-gesture",
  "module",
  "plugin",
] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];
export type Risk = "safe" | "mutating" | "destructive" | "credential" | "external";
/** The key of a ui row (D7): what `chooseKey` and every ui walker builds. */
export type LiveKey = { object_name: string } | { path: string[] };
/** `{ class }`, only for plugin rows (L11: `plugin:<Class>`). */
export type PluginKey = { class: string };
export interface ObservedState {
  mode?: "edit" | "play" | "prefab-edit";
  selection?:
    | "none"
    | "entity"
    | "prefab-instance"
    | "shape"
    | "terrain"
    | "layer"
    | "folder"
    | "multi";
  resource_type?: string;
  world_type?: "with-terrain" | "without-terrain";
  script_debug?: "on" | "off";
}
export interface LiveObservation {
  dim: "ui" | "diag" | "schema" | "plugin";
  kind: LiveKind;
  module: string;
  key: LiveKey;
  parent_key: { dim: string; kind: LiveKind; module: string; key: LiveKey } | null;
  origin: "vanilla";
  label?: string;
  label_raw?: string;
  shortcut_default?: string;
  locator?: {
    automationId?: string;
    controlType?: string;
    windowClass?: string;
    menuPath?: string[];
    /** DEC-078: index among the walk's elements sharing automationId and controlType. */
    ordinal?: number;
    /** DEC-078: labels from the element named by automationId (a property grid) to the item. */
    itemPath?: string[];
    /** DEC-084 option B: the element's own UIA name when its label was folded from a sibling Text. */
    uiaName?: string;
  };
  observed_state: ObservedState;
  children_count?: number;
  control_type?: string;
  dismissed_by?: string;
  modal?: "none" | "opens" | "blocks";
  risk_hint?: Risk;
  risk_open_hint?: Risk;
  risk_commit_hint?: Risk;
  quote?: string;
  ref: string;
  confidence: "high" | "medium" | "low";
  unverified?: string[];
}

/** The ref pattern every live enumerator registers in universes.json (D4). */
export const LIVE_REF_PATTERN = /^(artifact:[0-9a-f]{64}(#.+)?|ev:EV-[A-Za-z0-9_.-]+)$/;

/** Fields a walker never writes (D5): the build or the NORMALISER computes or forbids them. */
export const WALKER_FORBIDDEN_FIELDS = [
  "id",
  "what",
  "sources",
  "children_enumerated",
  "tier",
  "disposition",
  "paths",
] as const;

const UNIVERSES_PATH = join(REPO_ROOT, "data", "census", "universes.json");
let kindsCache: Record<string, string[]> | null = null;

/** The kinds universes.json registers for each enumerator. */
export function registeredKinds(path: string = UNIVERSES_PATH): Record<string, string[]> {
  if (path === UNIVERSES_PATH && kindsCache) return kindsCache;
  const u = JSON.parse(readFileSync(path, "utf-8")) as {
    enumerators: Record<string, { kinds?: string[] }>;
  };
  const out: Record<string, string[]> = {};
  for (const [id, e] of Object.entries(u.enumerators)) out[id] = e.kinds ?? [];
  if (path === UNIVERSES_PATH) kindsCache = out;
  return out;
}

/**
 * Problems of one raw observation line written by enumerator `enumerator` (`L01` and so on); empty
 * when the line is conformant. Checks the observation schema, the live kinds and the enumerator's
 * registered kinds, the D5 fields, `control_type`/`dismissed_by` from L01 only, `observed_state`
 * present (D8), `children_count` only with no sampling, the ref pattern, and the `label` as
 * `normalizeLabel(label_raw)`.
 */
export function validateLine(line: unknown, enumerator: string): string[] {
  const out: string[] = [];
  if (!line || typeof line !== "object" || Array.isArray(line)) return ["not a JSON object"];
  const o = line as Record<string, unknown>;
  for (const f of WALKER_FORBIDDEN_FIELDS)
    if (o[f] !== undefined) out.push(`a walker never writes "${f}" (D5)`);
  const parsed = observationSchema.safeParse(
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== "what" && k !== "id")),
  );
  if (!parsed.success)
    for (const i of parsed.error.issues) out.push(`${i.path.join(".") || "line"}: ${i.message}`);
  if (typeof o.kind !== "string" || !(LIVE_KINDS as readonly string[]).includes(o.kind))
    out.push(`kind ${JSON.stringify(o.kind)} is not a live kind`);
  else {
    const kinds = registeredKinds()[enumerator];
    if (!kinds) out.push(`${enumerator} is not a registered enumerator`);
    else if (!kinds.includes(o.kind))
      out.push(`kind ${o.kind} is not registered for ${enumerator} in universes.json`);
  }
  if (o.origin !== "vanilla") out.push('origin must be "vanilla"');
  if ((o.control_type !== undefined || o.dismissed_by !== undefined) && enumerator !== "L01")
    out.push("control_type and dismissed_by are only for L01");
  if (!o.observed_state || typeof o.observed_state !== "object")
    out.push("observed_state is missing (D8)");
  if (o.parent_key === undefined) out.push("parent_key is missing (null for a root)");
  if (typeof o.ref !== "string" || !LIVE_REF_PATTERN.test(o.ref))
    out.push(`ref ${JSON.stringify(o.ref)} does not match the live ref pattern (D4)`);
  const key = o.key as Record<string, unknown> | undefined;
  if (key && typeof key === "object") {
    const fields = Object.keys(key).sort();
    if (o.kind === "plugin") {
      if (!(fields.length === 1 && fields[0] === "class"))
        out.push("a plugin row's key must be exactly { class }");
    } else if (!(fields.length === 1 && (fields[0] === "object_name" || fields[0] === "path")))
      out.push("key must be exactly { object_name } or { path }");
  }
  if (
    typeof o.label_raw === "string" &&
    o.label !== undefined &&
    o.label !== normalizeLabel(o.label_raw)
  )
    out.push("label must equal normalizeLabel(label_raw)");
  if (out.length === 0) {
    try {
      deriveId(o as unknown as LiveObservation);
    } catch (e) {
      out.push(`id: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

// ── Identity (section 1.3, D7) ───────────────────────────────────────────────

export { normalizeLabel };

/** The row id of a line (plan 4.4): `ui:<Module>/<kind>/#<object_name>` or `.../<path...>`. */
export function deriveId(line: Pick<LiveObservation, "dim" | "kind" | "module" | "key">): string {
  return deriveRowId({
    dim: line.dim,
    kind: line.kind,
    module: line.module,
    key: line.key as Observation["key"],
  } as Parameters<typeof deriveRowId>[0]);
}

/** The build's state key: sorted `k=v` pairs joined by `;` (build-ledger stateKey). */
/**
 * The parent convention (D7, P4-FIX-F): a module's menu-bar titles, toolbars, docks and top-level
 * panels are children of the module window row `ui:<Module>/window/#<objectName>`, never of the
 * menu-bar or content region that holds them in the UIA tree. Every walker that emits such a row
 * uses this parent key; any walker may emit the window row itself (`windowLine`), and the
 * normaliser keeps one per (id, state).
 */
export function windowParentKey(
  module: string,
  objectName: string,
): NonNullable<LiveObservation["parent_key"]> {
  return { dim: "ui", kind: "window", module, key: { object_name: objectName } };
}

/** The module window row (a root): the parent every chrome row of the module names. */
export function windowLine(
  module: string,
  objectName: string,
  o: { ref: string; observed_state: ObservedState; windowClass?: string },
): LiveObservation {
  return {
    dim: "ui",
    kind: "window",
    module,
    key: { object_name: objectName },
    parent_key: null,
    origin: "vanilla",
    ...(o.windowClass ? { locator: { windowClass: o.windowClass } } : {}),
    observed_state: o.observed_state,
    ref: o.ref,
    confidence: "high",
  };
}

export function stateKey(s: ObservedState | undefined): string {
  if (!s) return "";
  return Object.keys(s)
    .sort(compareCodeUnits)
    .map((k) => `${k}=${(s as Record<string, string>)[k]}`)
    .join(";");
}

// ── Dock tab keys (DEC-090) ──────────────────────────────────────────────────

/** A QMainWindow dock tab strip's positional key segment (`@QMainWindowTabBar.<n>`). */
export const DOCK_TAB_STRIP = /^@QMainWindowTabBar\.\d+$/;
/** The strip segment of a dock tab keyed by its name: the class, no ordinal. */
export const DOCK_TAB_SEGMENT = "@QMainWindowTabBar";
export const DOCK_TAB_NOTE =
  "dock tab keyed by its name: the strip ordinal changes between launches (DEC-090)";

/**
 * DEC-090 (DEC-089's proposal): Qt numbers a main window's dock tab strips in an order that changes
 * between launches (P4-5 runs 1 and 2: Create and Hierarchy under strip 3, then strip 2), so a tab
 * keyed `[..., "@QMainWindowTabBar.<n>", name]` came back under a new id for the same tab. A dock
 * tab's name is its dock's title, unique in its window, so the key names the tab:
 * `[..., "@QMainWindowTabBar", name]`. A name that sits on two strips of one walk (same module,
 * state and walk artifact) keeps its ordinal key: only a duplicate needs the position. A child
 * line whose parent is a re-keyed tab follows it. Lines of several walks (a committed file) are
 * grouped by the walk artifact of their `ref`, so two sittings' strips never read as duplicates.
 * Mutates and returns the lines.
 */
export function rekeyDockTabs<T extends LiveObservation>(lines: T[]): T[] {
  const walkOf = (l: LiveObservation): string => l.ref.split("#")[0];
  const group = (l: LiveObservation, module: string): string =>
    `${module}\u0000${stateKey(l.observed_state)}\u0000${walkOf(l)}`;
  const isDockTab = (k: LiveKey, kind: string): k is { path: string[] } =>
    kind === "tab" &&
    "path" in k &&
    k.path.length >= 2 &&
    DOCK_TAB_STRIP.test(k.path[k.path.length - 2]);
  // Strips per (group, name).
  const strips = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!isDockTab(l.key, l.kind)) continue;
    const p = l.key.path;
    const g = `${group(l, l.module)}\u0000${p[p.length - 1]}`;
    const s = strips.get(g) ?? new Set<string>();
    s.add(p[p.length - 2]);
    strips.set(g, s);
  }
  const stable = (path: string[]): string[] => [
    ...path.slice(0, -2),
    DOCK_TAB_SEGMENT,
    path[path.length - 1],
  ];
  const rekeyed = new Set<string>();
  for (const l of lines) {
    if (!isDockTab(l.key, l.kind)) continue;
    const p = l.key.path;
    if ((strips.get(`${group(l, l.module)}\u0000${p[p.length - 1]}`)?.size ?? 0) > 1) continue;
    rekeyed.add(`${group(l, l.module)}\u0000${JSON.stringify(p)}`);
    l.key = { path: stable(p) };
    const un = [...(l.unverified ?? [])];
    if (!un.includes(DOCK_TAB_NOTE)) un.push(DOCK_TAB_NOTE);
    l.unverified = un;
  }
  for (const l of lines) {
    const pk = l.parent_key;
    if (!pk || !isDockTab(pk.key, pk.kind)) continue;
    if (rekeyed.has(`${group(l, pk.module)}\u0000${JSON.stringify(pk.key.path)}`))
      l.parent_key = { ...pk, key: { path: stable(pk.key.path) } };
  }
  return lines;
}

// ── State projection (D8) and module titles ─────────────────────────────────

const STATE_MATRIX_PATH = join(REPO_ROOT, "data", "census", "state-matrix.json");
const matrixCache = new Map<string, Array<{ kind: string; module?: string; axes: string[] }>>();

function matrixApplies(path: string): Array<{ kind: string; module?: string; axes: string[] }> {
  let a = matrixCache.get(path);
  if (!a) {
    a = (
      JSON.parse(readFileSync(path, "utf-8")) as {
        applies: Array<{ kind: string; module?: string; axes: string[] }>;
      }
    ).applies;
    matrixCache.set(path, a);
  }
  return a;
}

/**
 * D8: the state axes `state-matrix.json` declares for rows of `kind` in `module` (an entry with no
 * module applies to every module); sorted, no duplicates; `[]` when none is declared.
 */
export function stateAxes(
  module: string,
  kind: string,
  path: string = STATE_MATRIX_PATH,
): string[] {
  const out = new Set<string>();
  for (const e of matrixApplies(path))
    if (e.kind === kind && (e.module === undefined || e.module === module))
      for (const ax of e.axes) out.add(ax);
  return [...out].sort(compareCodeUnits);
}

/** The run state cut to `axes` (axes the state does not carry are left out). */
export function projectState(state: ObservedState, axes: readonly string[]): ObservedState {
  const out: Record<string, string> = {};
  for (const ax of axes) {
    const v = (state as Record<string, string | undefined>)[ax];
    if (v !== undefined) out[ax] = v;
  }
  return out as ObservedState;
}

/** D8 in one call: the `observed_state` of a row of `kind` in `module` during a run in `state`. */
export function stateFor(
  module: string,
  kind: string,
  state: ObservedState,
  path: string = STATE_MATRIX_PATH,
): ObservedState {
  return projectState(state, stateAxes(module, kind, path));
}

/**
 * The window title of each module's main window, as a regular expression source (plan actions carry
 * strings). `unverified` titles have not been read live yet: a different title is a STOP and the
 * title seen is recorded. ParticleEditor has none (DEC-042: never opened).
 */
export const MODULE_TITLES: Readonly<Record<string, { pattern: string; unverified: boolean }>> = {
  LocalizationEditor: { pattern: "^String Editor$", unverified: false },
  BehaviorEditor: { pattern: "^Behavior Editor - EMCP2_sandbox$", unverified: false },
  AudioEditor: { pattern: "^Audio Editor$", unverified: false },
  AnimEditor: { pattern: "^Animation Editor$", unverified: false },
  ProcAnimEditor: { pattern: "^Procedural Animation Editor$", unverified: false },
  ScriptEditor: {
    pattern:
      "^Script Editor( - (Debugging: ArmaReforgerWorkbenchSteamDiag\\.exe on port: \\d+ - )?Configuration: WORKBENCH)?$",
    unverified: false,
  },
  WorldEditor: { pattern: "^World Editor( - .+)?$", unverified: false },
  ResourceManager: { pattern: "^Enfusion Workbench( - .+)?$", unverified: true },
  // P4-1 2026-10-12: open/front/info ok and the one new Qt683QWindowIcon was "Arma Reforger
  // Workbench" (p4-l10-09 windowsAdded); the Script Editor's tool window shares the title but not
  // the class, and L10 matches the editor class only.
  NavmeshGeneratorMain: { pattern: "^Arma Reforger Workbench$", unverified: false },
  // Sitting P4-9 (guesses, [unverified]): the eight sub-editors are TABS of the Resource Manager's
  // main window (recon gui-census-feasibility: "native editor tab in Resource Manager"; the RM
  // Window menu has Next/Close Tab, P4-1 L02). S-C sc-08 (1.8.0.13) opened a .conf, .layout, .emat
  // and .xob with the native OpenResource: Opened true, no new top-level window. So each sub-editor
  // is read in the RM window (P4-1 L10: "Enfusion Workbench - <project>"); whether the title then
  // names the opened file is unknown, so the pattern takes either. P4-9's first open records it.
  ...Object.fromEntries(
    [
      "ResourceManager.Config",
      "ResourceManager.Layout",
      "ResourceManager.Imageset",
      "ResourceManager.Model",
      "ResourceManager.Texture",
      "ResourceManager.Material",
      "ResourceManager.Font",
      "ResourceManager.Styles",
    ].map((m) => [m, { pattern: "^Enfusion Workbench( - .+)?$", unverified: true }]),
  ),
};

/** `MODULE_TITLES[module]` as a RegExp, or null for a module with no known title. */
export function moduleTitle(module: string): RegExp | null {
  const t = MODULE_TITLES[module];
  return t ? new RegExp(t.pattern) : null;
}

/** Last segments that are never an object name (D7 rule 1). */
export const NOT_OBJECT_NAMES: ReadonlySet<string> = new Set(["TitleBar", "Close", "Float"]);

/** The application root every module window's automationId starts with. */
export const APP_ROOT_ID = "Arma4WorkbenchApp";

/**
 * The module window's object name (D7, P4-FIX-I): the segment after `Arma4WorkbenchApp.` of an
 * automationId, when it is a plain identifier not starting with `Q`. One rule for every walker:
 * L01/L03/L07 read it off the window node (`Arma4WorkbenchApp.AnimEditor`, whose UIA className is
 * also `AnimEditor`, which the general rule below would refuse), L02 off a popup's automationId
 * (`Arma4WorkbenchApp.AnimEditor.QMenuBar...`). With `rootOnly` only a two-segment id (the window
 * node itself) qualifies. Null: no object name; the caller keys the window by its title.
 */
export function moduleWindowObjectName(
  automationId: string | undefined,
  rootOnly = true,
): string | null {
  const segs = automationId?.split(".") ?? [];
  if (segs[0] !== APP_ROOT_ID || segs.length < 2 || (rootOnly && segs.length !== 2)) return null;
  const seg = segs[1];
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) && !seg.startsWith("Q") ? seg : null;
}

/**
 * The object-name candidate of a node: the last dotted segment of its automationId when it is not
 * a Qt class name (starts with `Q`), not the node's className, and not TitleBar, Close or Float.
 * Uniqueness among the module's nodes of the same kind is the caller's second test (`chooseKey`).
 */
export function objectNameOf(
  automationId: string | undefined,
  className: string | undefined,
): string | null {
  if (!automationId) return null;
  const seg = automationId.split(".").pop() ?? "";
  if (!seg || seg.startsWith("Q") || seg === className || NOT_OBJECT_NAMES.has(seg)) return null;
  return seg;
}

export interface IdentityInput {
  automationId?: string;
  className?: string;
  /** `label_raw` of the node's kinded ancestors from the module window down (menus: the menu path). */
  ancestorLabels: string[];
  /** The node's own UIA name ("" when empty). */
  name: string;
  /** 1-based ordinal among unnamed siblings of the same class (rule 3). */
  unnamedOrdinal?: number;
  /**
   * The node is a module's main window (not an owned dialog): its object name comes from
   * `moduleWindowObjectName` (P4-FIX-I), else its title, the same rule L02 applies to popup ids.
   */
  moduleWindow?: boolean;
}

export interface Identity {
  key: LiveKey;
  confidence?: "low";
  unverified?: string[];
}

/** The `unverified` note of an ordinal identity (D7 rule 3). */
export const ORDINAL_NOTE = "no accessible name; ordinal identity";

/**
 * D7: `object_name` when the candidate exists and is unique among the module's nodes of that kind
 * (`isUnique`), else the label path; an empty name gets `@<className>.<n>` with low confidence.
 */
export function chooseKey(n: IdentityInput, isUnique: (objectName: string) => boolean): Identity {
  if (n.moduleWindow) {
    const win = moduleWindowObjectName(n.automationId);
    if (win) return { key: { object_name: win } };
  }
  const cand = objectNameOf(n.automationId, n.className);
  if (cand && isUnique(cand)) return { key: { object_name: cand } };
  if (n.name.trim()) return { key: { path: [...n.ancestorLabels, n.name] } };
  const seg = `@${n.className ?? "unknown"}.${n.unnamedOrdinal ?? 1}`;
  return {
    key: { path: [...n.ancestorLabels, seg] },
    confidence: "low",
    unverified: [ORDINAL_NOTE],
  };
}

// ── Kind from controlType (section 1.2, D6) ─────────────────────────────────

/** One UIA node with the ancestry facts the table needs. */
export interface KindNode {
  controlType: string;
  className?: string;
  name?: string;
  /** The root window of a module's main window. */
  isModuleRoot?: boolean;
  /** An owned window. */
  owned?: boolean;
  /** A MenuItem directly under the application MenuBar. */
  underAppMenuBar?: boolean;
  /** A MenuItem inside a QMenu popup opened from a menu title. */
  inMenuPopup?: boolean;
  /** A MenuItem inside a popup opened on a right-click target (L05). */
  inContextPopup?: boolean;
  /** The menu item opens a sub-popup. */
  hasSubPopup?: boolean;
  /** Inside the MenuBar named System. */
  inSystemMenu?: boolean;
  /** A popup `Menu` opened on a right-click target. */
  contextPopup?: boolean;
  /** Under a ToolBar. */
  underToolBar?: boolean;
  /** A ListItem of a page list beside a QStackedWidget (Options pages). */
  pageListItem?: boolean;
  /** A dock's `*Contents` child. */
  dockContents?: boolean;
  /** A TreeItem of a PropertyGrid. */
  inPropertyGrid?: boolean;
  /** The TreeItem offers ExpandCollapse. */
  expandable?: boolean;
  /** A child of a StatusBar. */
  underStatusBar?: boolean;
  /** A Text node next to (labelling) an editable control: its name folds into that label. */
  labelsEditable?: boolean;
  /** The nearest kinded ancestor is a dock or a dialog. */
  underDockOrDialog?: boolean;
  /** The node's child count (an unnamed one-child Group is structural). */
  childCount?: number;
}

/**
 * The table's answer for one node:
 *   kind        a row of that kind for this enumerator;
 *   dismissed   structural, by the named G4 rule (`DISMISS_RULES`), L01 only (`dismissedLine`);
 *   foldLabel   a Text node whose name becomes the label of the editable control beside it;
 *   deferred    a ListItem or TreeItem outside a dock or dialog: data, sampled, deferred;
 *   outOfScope  a kind this enumerator does not register in universes.json (e.g. `property`
 *               from L01: L06 emits it).
 */
export type KindVerdict =
  | { kind: LiveKind; confidence?: "medium" }
  | { dismissed: string }
  | { foldLabel: true }
  | { deferred: string }
  | { outOfScope: LiveKind };

const STRUCTURAL_TYPES = new Set(["TitleBar", "ScrollBar", "Thumb", "Header"]);
const CONTROL_TYPES = new Set(["Button", "Edit", "ComboBox", "CheckBox", "List", "Tree"]);
/** The property-grid classes the live walks show (L06); any other `*PropertyGrid*` is medium. */
export const PROPERTY_GRID_CLASSES: ReadonlySet<string> = new Set([
  "PropertyGrid",
  "EntityPropertyGrid",
  "PropertyGridBC",
]);

/** A Tree or Table that is a property grid (exact class or the `*PropertyGrid*` fallback). */
export function isPropertyGrid(n: { controlType?: string; className?: string }): boolean {
  return (
    (n.controlType === "Tree" || n.controlType === "Table") &&
    (n.className ?? "").includes("PropertyGrid")
  );
}

/**
 * G4 dismissal rules the table names (plan 4.6; `data/census/g4-rules.json` schema: one
 * controlType per rule). Proposals for main to enter in g4-rules.json before the first L01 merge:
 * G4 fails a `dismissed_by` naming a rule that file lacks.
 */
export const DISMISS_RULES: ReadonlyArray<{ id: string; controlType: string; why: string }> = [
  {
    id: "system-menu",
    controlType: "MenuBar",
    why: "title-bar system menu; never walked (policy uia_menu)",
  },
  { id: "empty-label", controlType: "Text", why: "unnamed status-bar label" },
  { id: "text-label", controlType: "Text", why: "standalone static text, no control to label" },
  { id: "structural-titlebar", controlType: "TitleBar", why: "window chrome" },
  { id: "structural-scrollbar", controlType: "ScrollBar", why: "scroll chrome" },
  { id: "structural-thumb", controlType: "Thumb", why: "scroll or splitter thumb" },
  { id: "structural-header", controlType: "Header", why: "grid header chrome" },
  { id: "structural-separator", controlType: "Separator", why: "a separator line" },
  {
    id: "structural-separator-group",
    controlType: "Group",
    why: "QToolBarSeparator and other separators Qt exposes as an unnamed, childless Group (L01)",
  },
  {
    id: "structural-menubar",
    controlType: "MenuBar",
    why: "the application MenuBar itself; its titles are rows",
  },
  { id: "structural-group", controlType: "Group", why: "unnamed one-child wrapper" },
];

/** D6, applied top-down; the first match wins. Without `enumerator` every kind is in scope. */
export function kindOf(n: KindNode, enumerator?: string): KindVerdict {
  const v = rawKindOf(n);
  if (!("kind" in v) || enumerator === undefined) return v;
  const kinds = registeredKinds()[enumerator] ?? [];
  return kinds.includes(v.kind) ? v : { outOfScope: v.kind };
}

function rawKindOf(n: KindNode): KindVerdict {
  const ct = n.controlType;
  const cls = n.className ?? "";
  const name = n.name ?? "";
  if (n.inSystemMenu || (ct === "MenuBar" && name === "System"))
    return { dismissed: "system-menu" };
  if (ct === "Window") {
    if (n.isModuleRoot) return { kind: "window" };
    if (cls === "QDockWidget") return { kind: "dock" };
    // A right-click popup is a Window whose class is QMenu, not a `Menu` node (L05, sf-15).
    if (cls === "QMenu") return { kind: "context-menu" };
    if (n.owned || cls.endsWith("Dialog")) return { kind: "dialog" };
  }
  if (ct === "MenuItem") {
    if (n.underAppMenuBar) return { kind: "menu" };
    if (n.inContextPopup) return { kind: "context-item" };
    if (n.inMenuPopup) return { kind: n.hasSubPopup ? "menu" : "menu-item" };
  }
  if (ct === "ToolBar") return { kind: "toolbar" };
  if ((ct === "Button" || ct === "CheckBox") && cls === "QToolButton" && n.underToolBar)
    return { kind: "toolbar-button" };
  if (ct === "Tab" && (cls === "QMainWindowTabBar" || cls === "QTabBar")) return { kind: "panel" };
  if (ct === "TabItem" || (ct === "ListItem" && n.pageListItem)) return { kind: "tab" };
  if ((ct === "Group" || ct === "Custom") && (cls.endsWith("Panel") || n.dockContents))
    return { kind: "panel" };
  if (ct === "Tree" || ct === "Table") {
    if (PROPERTY_GRID_CLASSES.has(cls)) return { kind: "property-group" };
    if (cls.includes("PropertyGrid")) return { kind: "property-group", confidence: "medium" };
  }
  if (ct === "TreeItem" && n.inPropertyGrid)
    return { kind: n.expandable ? "property-group" : "property" };
  if (n.underStatusBar) return name.trim() ? { kind: "status-item" } : { dismissed: "empty-label" };
  if (ct === "Menu" && n.contextPopup) return { kind: "context-menu" };
  if (ct === "Text") return n.labelsEditable ? { foldLabel: true } : { dismissed: "text-label" };
  if (ct === "ListItem" || ct === "TreeItem")
    return n.underDockOrDialog
      ? { kind: "control" }
      : { deferred: "sampled: a data item outside a dock or dialog" };
  if (CONTROL_TYPES.has(ct)) return { kind: "control" };
  if (STRUCTURAL_TYPES.has(ct)) return { dismissed: `structural-${ct.toLowerCase()}` };
  if (ct === "Separator") return { dismissed: "structural-separator" };
  if (ct === "Group" && !name.trim() && (cls === "QToolBarSeparator" || n.childCount === 0))
    return { dismissed: "structural-separator-group" };
  if (cls === "QToolBarSeparator") return { dismissed: "structural-separator" };
  if (ct === "MenuBar") return { dismissed: "structural-menubar" };
  if (ct === "Group" && !name.trim() && n.childCount === 1)
    return { dismissed: "structural-group" };
  return { deferred: `unkinded ${ct}` };
}

/**
 * The line of a dismissed node, in the shape build.ts and G4 already read: an L01 line (only L01 may
 * carry control_type and dismissed_by) of kind `region`, its `control_type` the UIA control type the
 * rule names, `dismissed_by` the rule id, low confidence. `key` and `parent_key` as for any row.
 */
export function dismissedLine(
  base: Omit<LiveObservation, "kind" | "control_type" | "dismissed_by" | "confidence">,
  controlType: string,
  rule: string,
): LiveObservation {
  return {
    ...base,
    kind: "region",
    control_type: controlType,
    dismissed_by: rule,
    confidence: "low",
  };
}

// ── Walker steps ─────────────────────────────────────────────────────────────

export type WalkerStatus = "pass" | "observed" | "fail" | "stopped" | "aborted" | "handoff";

/** `<run>/<step>.json` (design 2.3). */
export interface WalkerRecord {
  step: string;
  module: string;
  state: ObservedState;
  status: WalkerStatus;
  summary: string;
  artifacts: Array<{ path: string; sha256: string }>;
  windowsAdded: Array<{ className: string; title: string; owner?: number }>;
  calls: Array<Record<string, unknown>>;
  cut: boolean;
  /**
   * The call that was awaiting its answer when the step stopped (P4-1 2026-10-12 L15: the window
   * poller cut the diag step while a read was out, and the calls tail showed only finished calls).
   */
  inFlight?: string;
  startedAt: string;
  endedAt: string;
  stop?: string;
}

export interface WalkerStepOutcome {
  status: "pass" | "observed" | "fail";
  summary: string;
  artifacts?: Array<{ path: string; sha256: string }>;
}

export interface WalkerOptions {
  enumerator: string;
  script: string;
  session: string;
  runDir: string;
  module: string;
  state: ObservedState;
  allowOwned: boolean;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** The lane of `--id`/`--lease-path`/`--marker-path` (a dry run or test: id ""). */
  lane?: WalkerLane;
  /** The handler port (`--port`, default DEFAULT_PORT). */
  port?: number;
}

/** The lane identity a kernel passes on (walk.ts `--really --id`, child processes). */
export interface WalkerLane {
  id: string;
  leasePath?: string;
  markerPath?: string;
}

/** The lane's flags for a child process (`--id <id> [--lease-path p] [--marker-path p]`). */
export function laneArgv(lane: WalkerLane): string[] {
  const out = ["--id", lane.id];
  if (lane.leasePath) out.push("--lease-path", lane.leasePath);
  if (lane.markerPath) out.push("--marker-path", lane.markerPath);
  return out;
}

/** A shipped TS tool a walker may call (train2's ToolName). */
export type WalkerToolName =
  | "wb_module"
  | "wb_container"
  | "wb_plugin"
  | "wb_bi"
  | "wb_gui"
  | "wb_resources";

/** What a shipped TS tool answers (train2's ToolResponse). */
export interface WalkerToolResponse {
  ok: boolean;
  action?: string;
  target?: string;
  code?: string;
  message?: string;
  changed?: unknown;
  readback?: unknown;
  next?: string;
  warnings?: string[];
  [extra: string]: unknown;
}

/** The tool client of a step, train2's shape: `tool(name, args)` and a raw `net(api, params, ms)`. */
export interface WalkerClient {
  tool: (name: WalkerToolName, args: Record<string, unknown>) => Promise<WalkerToolResponse>;
  net: (
    apiFunc: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<RawCallResult>;
}

export interface WalkerStepContext {
  opts: WalkerOptions;
  /** The pid the lane recorded at the launch (checked against the Workbench images). */
  pid: number;
  /** The lane id (`--id`); "" in a test. */
  laneId: string;
  /** The lane (`--id`, `--lease-path`, `--marker-path`); give `laneArgv(ctx.lane)` to a child. */
  lane: WalkerLane;
  /** The handler port (`--port`, default DEFAULT_PORT). */
  port: number;
  signal: AbortSignal;
  /** Run one kernel call; refused once the step is cut. Recorded in the step's calls. */
  call: <T>(what: string, fn: () => Promise<T>) => Promise<T>;
  /** A wait that ends the step once it is cut. */
  sleep: (ms: number) => Promise<void>;
  /** The current top-level window list (the watcher's own source); a cut step refuses it. */
  windows: () => Promise<WindowInfo[]>;
  /** A shipped TS tool through the client built once from `--port`; recorded, refused once cut. */
  tool: WalkerClient["tool"];
  /** One raw handler call on `--port`; recorded, refused once cut. */
  net: WalkerClient["net"];
  /**
   * Validate and redact observation lines and buffer them for this step's raw obs file (`file`
   * overrides it, e.g. L11's per-module file; it must lie inside the run folder, else the step
   * stops). They are written only when the step ends in pass or observed; otherwise they go to
   * `<run>/<step>.rejected.jsonl` with the reason.
   */
  emit: (lines: readonly LiveObservation[], file?: string) => void;
  /**
   * Write the buffered lines now, refused once the step is cut. Only for a step whose planned end is
   * a HANDOFF after a good read (L04: the owner presses Cancel): the step has checked the window
   * state itself. Lines emitted after it are buffered again.
   */
  commit: () => void;
  /** The raw obs file of this module and state. */
  obsPath: string;
  log: (line: string) => void;
}

export interface WalkerStep {
  id: string;
  title: string;
  /** Queue fields (scripts/live/preflight.ts validateQueue), emitted by `--emit-queue`. */
  risk: "read-only" | "reversible" | "mutating";
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  /** Editor titles the step may add (a module open); anything else stops it. */
  expectsWindows?: readonly RegExp[];
  /** L04: the dialog the step opens (exact title, owned flag). */
  expectsDialogs?: readonly ExpectedDialog[];
  /** L02, L05, L14: the menu popup pair is benign. */
  popups?: boolean;
  plan: (opts: Pick<WalkerOptions, "module" | "state" | "allowOwned">) => PlanAction[];
  run: (ctx: WalkerStepContext) => Promise<WalkerStepOutcome>;
}

export interface WalkerDeps extends WatchDeps {
  now: () => number;
  /** The pid the lane recorded at the launch, or null. */
  recordedPid: () => number | null;
  /** That pid's image name, or null when gone. */
  processImage: (pid: number) => string | null;
  /** Refresh the lease (first thing in every step). */
  heartbeat: () => void;
  exists: (path: string) => boolean;
  writeFile: (path: string, text: string, exclusive?: boolean) => void;
  appendFile: (path: string, text: string) => void;
  log: (line: string) => void;
  /** The tool client (built once per run from `--port`); a test may leave it out. */
  client?: WalkerClient;
}

/** Image names a recorded pid may carry (the Workbench executables). */
export const WORKBENCH_IMAGES: readonly RegExp[] = [/^ArmaReforgerWorkbench.*\.exe$/i];

export function walkerRecordPath(runDir: string, id: string): string {
  return join(runDir, `${id}.json`);
}

/** `<run>/<step>.rejected.jsonl`: the lines of a step that stopped, handed off, aborted or failed. */
export function rejectedPath(runDir: string, id: string): string {
  return join(runDir, `${id}.rejected.jsonl`);
}

/** `--state mode=edit,selection=entity` parsed and checked against the schema, or a problem. */
export function parseState(text: string | undefined): ObservedState | string {
  if (!text) return { mode: "edit", selection: "none" };
  // Launcher and Shared rows carry no state: `--state none` is the empty state.
  if (text === "none") return {};
  const o: Record<string, string> = {};
  for (const part of text.split(",")) {
    const [k, v, ...rest] = part.split("=");
    if (!k || !v || rest.length) return `--state: "${part}" is not key=value`;
    if (o[k] !== undefined) return `--state: ${k} given twice`;
    o[k] = v;
  }
  const r = observedStateSchema.safeParse(o);
  if (!r.success) return `--state: ${r.error.issues[0]?.message ?? "invalid"}`;
  return r.data as ObservedState;
}

/** True when `file` resolves to a path strictly inside `runDir` (the emit override check). */
export function insideRunDir(runDir: string, file: string): boolean {
  const rel = relative(resolve(runDir), resolve(runDir, file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** The state tag of a raw obs file name: sorted values joined by `-` (`edit-none`); `none` for `{}`. */
export function stateTag(s: ObservedState): string {
  const keys = Object.keys(s).sort(compareCodeUnits);
  return keys.length ? keys.map((k) => (s as Record<string, string>)[k]).join("-") : "none";
}

/** `<run>/L<nn>-<module>-<stateTag>.obs.jsonl` (D1). */
export function obsFilePath(
  runDir: string,
  enumerator: string,
  module: string,
  s: ObservedState,
): string {
  return join(runDir, `${enumerator}-${module}-${stateTag(s)}.obs.jsonl`);
}

/** The steps a real run names: `--only <step>` or `--from <step>`. */
export function selectWalkerSteps(
  steps: WalkerStep[],
  sel: { from?: string; only?: string },
): WalkerStep[] | string {
  if (sel.only && sel.from) return "--only excludes --from";
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  if (sel.only) {
    const i = idx(sel.only);
    return i === -1 ? `${sel.only} is not a step id` : [steps[i]];
  }
  if (!sel.from) return "a real run names its steps: --from <step> or --only <step>";
  const a = idx(sel.from);
  return a === -1 ? `${sel.from} is not a step id` : steps.slice(a);
}

/** Why the recorded pid may not be walked: none recorded, or not a Workbench image. */
export function pidRefusal(pid: number | null, image: string | null): string | null {
  if (pid === null) return "no recorded Workbench pid: the lane recorded no launch";
  if (image === null) return `the recorded pid ${pid} is gone`;
  if (!WORKBENCH_IMAGES.some((re) => re.test(image)))
    return `the recorded pid ${pid} is ${image}, not a Workbench image`;
  return null;
}

export interface WalkerReport {
  exit: number;
  records: WalkerRecord[];
  stoppedAt: string | null;
  message: string | null;
}

/**
 * Run walker steps in order (design 2.3): a step with a record or a started marker in the run folder
 * is refused (never run twice; a relaunch takes a new run folder); the started marker is written
 * before the first call; the heartbeat is refreshed first; the step runs watched against the pid the
 * lane recorded; the record is written redacted; the first stop ends the run with train2's exit code.
 */
export async function runWalkerSteps(
  steps: WalkerStep[],
  deps: WalkerDeps,
  opts: WalkerOptions,
): Promise<WalkerReport> {
  const records: WalkerRecord[] = [];
  const write = (r: WalkerRecord): void => {
    const clean = JSON.parse(toPlaceholders(JSON.stringify(r), opts.ph)) as WalkerRecord;
    const path = walkerRecordPath(opts.runDir, r.step);
    deps.writeFile(path, JSON.stringify(clean, null, 2) + "\n");
    records.push(clean);
    if (opts.evidenceDir) {
      writeEvidence(
        opts.evidenceDir,
        opts.session,
        {
          ran: `${opts.script} ${r.step}`,
          build: opts.build,
          result_summary: `${r.step}: ${r.status}${r.stop ? ` (${r.stop})` : ""}; ${r.summary}`,
          artifacts: [path, ...r.artifacts],
        },
        opts.ph,
      );
    }
  };
  for (const s of steps) {
    const marker = startedMarkerPath(opts.runDir, s.id);
    if (
      deps.exists(walkerRecordPath(opts.runDir, s.id)) ||
      deps.exists(marker) ||
      deps.exists(acknowledgedMarkerPath(opts.runDir, s.id))
    ) {
      return {
        exit: EXIT.refused,
        records,
        stoppedAt: s.id,
        message: `${s.id} already ran in this run folder: a step is never run twice (plan 5.3); a relaunch takes a new run folder`,
      };
    }
    deps.log(`step ${s.id}: ${s.title}`);
    const calls: Array<Record<string, unknown>> = [];
    /** The calls sent and not yet answered (recorded as `inFlight` when the step stops). */
    const pendingCalls = new Set<string>();
    const abort = new AbortController();
    const guard = (what: string): void => {
      if (abort.signal.aborted) {
        calls.push({ notSent: what });
        throw new StepCut();
      }
    };
    const startedAt = new Date(deps.now()).toISOString();
    const obsPath = obsFilePath(opts.runDir, opts.enumerator, opts.module, opts.state);
    const base = { step: s.id, module: opts.module, state: opts.state, startedAt };
    /** Lines emitted by the step, per target file, written once the step passes or observes. */
    const pending = new Map<string, string>();
    /** L03's finding: lines of a step that did not end in pass/observed never reach an obs file. */
    const reject = (reason: string): void => {
      if (pending.size === 0) return;
      const head = jsonlLine({ $rejected: s.id, reason: toPlaceholders(reason, opts.ph) }) + "\n";
      deps.appendFile(
        rejectedPath(opts.runDir, s.id),
        head + [...pending.entries()].map(([, t]) => t).join(""),
      );
      pending.clear();
    };
    try {
      deps.heartbeat();
      const pid = deps.recordedPid();
      const why = pidRefusal(pid, pid === null ? null : deps.processImage(pid));
      if (why || pid === null) throw new StopBattery("stopped", why ?? "no recorded Workbench pid");
      deps.writeFile(
        marker,
        JSON.stringify({ step: s.id, started_at: startedAt, pid, created: null }, null, 2) + "\n",
        true,
      );
      const lane = opts.lane ?? { id: "" };
      const call = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
        guard(what);
        const t0 = deps.now();
        pendingCalls.add(what);
        try {
          const v = await fn();
          calls.push({ call: what, ok: true, durationMs: deps.now() - t0 });
          return v;
        } catch (e) {
          calls.push({ call: what, ok: false, error: e instanceof Error ? e.message : String(e) });
          throw e;
        } finally {
          pendingCalls.delete(what);
        }
      };
      const client = (): WalkerClient => {
        if (!deps.client) throw new Error("this run has no tool client (a test gave none)");
        return deps.client;
      };
      const ctx: WalkerStepContext = {
        opts,
        pid,
        laneId: lane.id,
        lane,
        port: opts.port ?? DEFAULT_PORT,
        signal: abort.signal,
        obsPath,
        log: deps.log,
        windows: () => call("windows", () => deps.windows()),
        tool: (name, args) => call(`tool:${name}`, () => client().tool(name, args)),
        net: (api, params, ms) => call(`net:${api}`, () => client().net(api, params, ms)),
        sleep: async (ms) => {
          guard("sleep");
          await deps.sleep(ms);
          guard("sleep");
        },
        call,
        emit: (lines, file) => {
          const bad = lines
            .map((l, i) => ({ i, p: validateLine(l, opts.enumerator) }))
            .filter((x) => x.p.length);
          if (bad.length)
            throw new StopBattery(
              "stopped",
              `line ${bad[0].i} of ${lines.length} is not conformant: ${bad[0].p.join("; ")}`,
            );
          // Plan 5.3: raw lines stay inside the run folder, whatever path the walker names.
          if (file !== undefined && !insideRunDir(opts.runDir, file))
            throw new StopBattery(
              "stopped",
              `emit file ${file} is outside the run folder ${opts.runDir}; nothing written`,
            );
          const target = file ?? obsPath;
          const prior = pending.get(target) ?? "";
          pending.set(
            target,
            prior + lines.map((l) => toPlaceholders(jsonlLine(l), opts.ph) + "\n").join(""),
          );
        },
        commit: () => {
          guard("commit");
          for (const [p, text] of pending) deps.appendFile(p, text);
          pending.clear();
        },
      };
      const w = await watched(deps, pid, s.expectsWindows, abort, () => s.run(ctx), {
        popups: s.popups,
        dialogs: s.expectsDialogs,
      });
      if (w.value.status === "fail") reject(`the step ended in fail: ${w.value.summary}`);
      else for (const [p, text] of pending) deps.appendFile(p, text);
      pending.clear();
      write({
        ...base,
        status: w.value.status,
        summary: w.value.summary,
        artifacts: w.value.artifacts ?? [],
        windowsAdded: w.added.map((x) => ({
          className: x.className,
          title: x.title,
          owner: x.owner,
        })),
        calls,
        cut: false,
        endedAt: new Date(deps.now()).toISOString(),
      });
    } catch (e) {
      const stop = e instanceof StopBattery ? e : null;
      const kind = stop?.kind ?? "stopped";
      const message = e instanceof Error ? e.message : String(e);
      reject(`${kind.toUpperCase()}: ${message}`);
      const added = (stop?.evidence.windowsAdded ?? []) as WalkerRecord["windowsAdded"];
      write({
        ...base,
        status: kind,
        summary: message,
        artifacts: [],
        windowsAdded: added,
        calls,
        cut: abort.signal.aborted,
        ...(pendingCalls.size ? { inFlight: [...pendingCalls].join(", ") } : {}),
        endedAt: new Date(deps.now()).toISOString(),
        stop: message,
      });
      return {
        exit: kind === "aborted" ? EXIT.aborted : kind === "handoff" ? EXIT.handoff : EXIT.stopped,
        records,
        stoppedAt: s.id,
        message,
      };
    }
  }
  return { exit: EXIT.done, records, stoppedAt: null, message: null };
}

// ── The walker CLI (section 2.1) ─────────────────────────────────────────────

export interface WalkerDef {
  /** `L01` and so on. */
  enumerator: string;
  /** The sitting whose queue `--emit-queue` writes (`P4-1` ...); `--session` overrides it. */
  session: string;
  /** Repo-relative path of the walker script (dry-run exceptions are per script). */
  script: string;
  /** The module a dry run plans for when `--module` is not given. */
  defaultModule: string;
  steps: (opts: Pick<WalkerOptions, "module" | "state" | "allowOwned">) => WalkerStep[];
}

export interface RunWalkerOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  leaseHeld?: boolean;
  deps?: WalkerDeps;
  /** The artifacts root the run folder must lie in (default: artifactsDir()). */
  artifactsRoot?: string;
  session?: string;
  /** The evidence folder (default: --evidence-dir or DEFAULT_EVIDENCE_DIR); null writes none. */
  evidenceDir?: string | null;
}

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "id",
  "sandbox",
  "run-dir",
  "module",
  "state",
  "from",
  "only",
  "evidence-dir",
  "build",
  "session",
  "lease-path",
  "marker-path",
  "port",
] as const;
const FLAGS = ["really", "allow-owned"] as const;

/** The action plan of every step, in order. */
export function walkerPlan(
  steps: WalkerStep[],
  o: Pick<WalkerOptions, "module" | "state" | "allowOwned">,
): PlanAction[] {
  return steps.flatMap((s) => s.plan(o));
}

/** One line per step: id, title, and the plan kinds it uses. */
export function walkerOutline(
  def: WalkerDef,
  steps: WalkerStep[],
  o: Pick<WalkerOptions, "module" | "state" | "allowOwned">,
): string[] {
  return [
    `${def.enumerator} ${def.script}: module ${o.module}, state ${stateKey(o.state) || "none"}`,
    ...steps.map(
      (s) =>
        `  ${s.id}: ${s.title} [${s
          .plan(o)
          .map((a) => a.kind)
          .join(", ")}]`,
    ),
  ];
}

/**
 * The sitting queue of one walker's steps (`docs/v2/sessions/queues/P4-<n>-queue.json`), the shape
 * train2's `buildQueue` writes and scripts/live/preflight.ts `validateQueue` reads; steps are listed
 * in run order, which must already go read-only, reversible, mutating.
 */
export function buildWalkerQueue(
  def: WalkerDef,
  steps: WalkerStep[],
  session: string = def.session,
): Record<string, unknown> {
  return {
    $comment: `Generated by \`${def.script} --emit-queue\` from its step table. Validated by scripts/live/preflight.ts validateQueue, per launch.`,
    session,
    script: def.script,
    enumerator: def.enumerator,
    plan_refs: ["PLAN 5.3", "PLAN Phase 4", "docs/v2/design/phase4-live-census.md"],
    counts: { steps: steps.length },
    probes: steps.map((s) => ({
      id: s.id,
      title: s.title,
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
      ...(s.expectsWindows ? { expects_windows: s.expectsWindows.map((r) => r.source) } : {}),
      ...(s.expectsDialogs ? { expects_dialogs: s.expectsDialogs } : {}),
      ...(s.popups ? { popups: true } : {}),
    })),
  };
}

/**
 * The tool client of a real run, built once from the port: train2's `realDeps` tool and net shape
 * (a WorkbenchClient without a Config; the tool modules are loaded on first use).
 */
export function realWalkerClient(port: number): WalkerClient {
  type Client = import("../../../src/workbench/client.js").WorkbenchClient;
  let client: Client | null = null;
  const c = async (): Promise<Client> => {
    if (!client) {
      const { WorkbenchClient } = await import("../../../src/workbench/client.js");
      client = new WorkbenchClient("127.0.0.1", port);
    }
    return client;
  };
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_module": {
          const { runModule } = await import("../../../src/tools/wb-module.js");
          return (await runModule(
            await c(),
            args as unknown as Parameters<typeof runModule>[1],
          )) as unknown as WalkerToolResponse;
        }
        case "wb_container": {
          const { runContainer } = await import("../../../src/tools/wb-container.js");
          return (await runContainer(await c(), args)) as unknown as WalkerToolResponse;
        }
        case "wb_plugin": {
          const p = await import("../../../src/tools/wb-plugin.js");
          return (await p.runPlugin(args, {
            client: await c(),
            catalog: () => p.loadCatalog(),
            allowList: () => p.loadAllowList(),
          })) as unknown as WalkerToolResponse;
        }
        case "wb_bi": {
          const { runBi } = await import("../../../src/tools/wb-bi.js");
          return (await runBi(args, { client: await c() })) as unknown as WalkerToolResponse;
        }
        case "wb_gui": {
          const { runGui } = await import("../../../src/tools/wb-gui.js");
          return (await runGui(args, {
            env: { ...process.env, ENFUSION_GUI: "1" },
          })) as unknown as WalkerToolResponse;
        }
        case "wb_resources": {
          // rewalk-subeditors.ts: the search that picks a sub-editor's vanilla file (w8.live.ts).
          const { runResources } = await import("../../../src/tools/wb-resources.js");
          return (await runResources(await c(), args)) as unknown as WalkerToolResponse;
        }
      }
    },
    net: (apiFunc, params, timeoutMs) => rawNetCall(apiFunc, params, { port, timeoutMs }),
  };
}

/** The real deps of a walker run on `lane` and `port` (also rewalk-subeditors.ts's base). */
export function realWalkerDeps(lane: Lane, port: number): WalkerDeps {
  return {
    client: realWalkerClient(port),
    windows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    recordedPid: () => lane.recordedPid(),
    processImage: (pid) => processByPid(defaultExec, pid)?.image ?? null,
    heartbeat: () => {
      lane.heartbeat();
    },
    exists: existsSync,
    writeFile: (p, t, exclusive) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t, { encoding: "utf-8", flag: exclusive ? "wx" : "w" });
    },
    appendFile: (p, t) => {
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, t, "utf-8");
    },
    log: (l) => console.log(l),
  };
}

/**
 * The CLI of every L-script. Without `--really`: print the outline, build the ACTION PLAN, check it
 * against policy.json, write `--out`/`--outline`; exit 0 on a pass, 1 on a violation. With
 * `--really`: the live gate (win32, the lease held by `--id`), the sandbox folder, the run folder inside the artifacts folder, then the steps named by `--from`/`--only`
 * against the pid the lane recorded, the heartbeat running for the whole run.
 */
export async function runWalker(
  def: WalkerDef,
  argv: string[],
  over: RunWalkerOverrides = {},
): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const unknown = [...args.flags].filter((f) => !(FLAGS as readonly string[]).includes(f));
  if (unknown.length || args.positional.length) {
    say(`unknown option(s): ${[...unknown.map((f) => `--${f}`), ...args.positional].join(", ")}`);
    return EXIT.usage;
  }
  const o = args.options;
  const really = args.flags.has("really");
  const state = parseState(o.state);
  if (typeof state === "string") {
    say(state);
    return EXIT.usage;
  }
  const module = o.module ?? def.defaultModule;
  if (!observationSchema.shape.module.safeParse(module).success) {
    say(`--module ${module} is not a census module`);
    return EXIT.usage;
  }
  const sel = { module, state, allowOwned: args.flags.has("allow-owned") };
  const steps = def.steps(sel);
  const plan = walkerPlan(steps, sel);
  const check = checkPlan(plan, over.policy ?? loadPolicy(), { script: def.script });
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  const outline = walkerOutline(def, steps, sel);
  if (o.outline) writeFileSync(o.outline, outline.join("\n") + "\n", "utf-8");
  if (o["emit-queue"]) {
    mkdirSync(dirname(resolve(o["emit-queue"])), { recursive: true });
    writeFileSync(
      o["emit-queue"],
      JSON.stringify(buildWalkerQueue(def, steps, o.session ?? def.session), null, 2) + "\n",
      "utf-8",
    );
  }
  if (!really) {
    for (const l of outline) say(l);
    say(formatResult(check));
    return check.ok ? EXIT.done : EXIT.refused;
  }
  if (!check.ok) {
    say(formatResult(check));
    return EXIT.refused;
  }
  if (!o.module) {
    say("--really needs --module <ModuleId>");
    return EXIT.usage;
  }
  const selected = selectWalkerSteps(steps, { from: o.from, only: o.only });
  if (typeof selected === "string") {
    say(selected);
    return EXIT.usage;
  }
  if (!o.id || !o.sandbox || !o["run-dir"]) {
    say("--really needs --id <lane id>, --sandbox <the 2.0 sandbox folder> and --run-dir <dir>");
    return EXIT.usage;
  }
  if (basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    say(`aborted: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}`);
    return EXIT.aborted;
  }
  const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  const gate = liveGateReason({
    really,
    platform: over.platform ?? process.platform,
    leaseHeld: over.leaseHeld ?? lane.holdsLease(),
  });
  if (gate) {
    say(gate);
    return EXIT.refused;
  }
  const runDir = resolve(o["run-dir"]);
  const outside = outsideArtifacts(runDir, over.artifactsRoot ?? artifactsDir());
  if (outside) {
    say(toPlaceholders(`refused: ${outside}`, ph));
    return EXIT.refused;
  }
  mkdirSync(runDir, { recursive: true });
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    say(`--port ${o.port} is not a port`);
    return EXIT.usage;
  }
  const deps = over.deps ?? realWalkerDeps(lane, port);
  if (!over.deps) lane.startHeartbeat(HEARTBEAT_MS);
  try {
    const r = await runWalkerSteps(selected, deps, {
      enumerator: def.enumerator,
      script: def.script,
      session: over.session ?? o.session ?? def.session,
      runDir,
      module,
      state,
      allowOwned: sel.allowOwned,
      evidenceDir:
        over.evidenceDir !== undefined
          ? over.evidenceDir
          : (o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR),
      ph: { ...ph, sandbox: resolve(o.sandbox) },
      build: o.build ?? "unrecorded",
      lane: { id: lane.id, leasePath: o["lease-path"], markerPath: o["marker-path"] },
      port,
    });
    for (const rec of r.records) say(`${rec.step}: ${rec.status}`);
    if (r.message)
      say(
        toPlaceholders(
          `${r.exit === EXIT.handoff ? "HANDOFF" : r.exit === EXIT.refused ? "REFUSED" : "STOPPED"}: ${r.message}`,
          ph,
        ),
      );
    say(toPlaceholders(`run folder: ${runDir}`, ph));
    return r.exit;
  } finally {
    if (!over.deps) lane.stopHeartbeat();
  }
}
