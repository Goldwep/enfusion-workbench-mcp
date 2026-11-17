/**
 * The GUI driver (W8 spec 2.1, rules 1.2.1 to 1.2.5 and 1.2.8; OD-2, OD-3, OD-4).
 *
 * One PowerShell script (the src/gui/uia.ts route: -EncodedCommand, values from the caller as
 * environment variables, never in the script text) that, on ONE element of ONE window:
 *
 *   1. walks the control view from the window root down a walker.py index path ("0/3/1") that a
 *      fresh snapshot resolved, and refuses unless the element there still carries the
 *      automation id, name and control type the snapshot showed (`mismatch`, `gone`);
 *   2. reads its state from properties only (value, read-only, toggle, expand/collapse,
 *      selected, enabled);
 *   3. for a drive operation, acts through one UI Automation pattern and nothing else:
 *      InvokePattern.Invoke, ExpandCollapsePattern.Expand, TogglePattern.Toggle,
 *      SelectionItemPattern.Select, ValuePattern.SetValue. A disabled element is refused;
 *   4. reads the state again after a settle.
 *
 * No input is synthesised: no SendInput, no keyboard or mouse event, no window message, no focus
 * or foreground change (OD-2: pixel recipes are the hand block's, never a shipped tool's).
 *
 * The module also carries the modal check of rule 1.2.5: `openDialogs` lists the dialog-like
 * windows of the pid (modal-watchdog.ts `isDialogLike`, plus the known modal titles), with no
 * baseline needed, so a dialog that was already open before the first look is still seen.
 */

import { isDialogLike, KNOWN_MODAL_TITLES } from "./modal-watchdog.js";
import {
  ENV_DRIVE,
  ENV_HWND,
  ENV_PID,
  ENV_VALUE,
  isMenuPopup,
  lastLine,
  listWindows,
  redactText,
  runPowerShell,
  type PowerShellRunner,
  type UiaDeps,
  type WindowInfo,
} from "./uia.js";

export const DRIVE_ACTIONS = ["invoke", "expand", "toggle", "select", "setValue"] as const;
export type DriveAction = (typeof DRIVE_ACTIONS)[number];
export type DriverOp = DriveAction | "read";

/** The UIA pattern each drive action uses (and that the element must offer). */
export const ACTION_PATTERN: Record<DriveAction, string> = {
  invoke: "Invoke",
  expand: "ExpandCollapse",
  toggle: "Toggle",
  select: "SelectionItem",
  setValue: "Value",
};

/** The only buttons `dismiss` presses, in order of preference (OD-4). */
export const DISMISS_BUTTONS = ["Cancel", "Close", "No"] as const;

/** Wait after the act before the state is read back. */
export const DEFAULT_SETTLE_MS = 300;
/** Beyond the settle: a cold Add-Type compile, the attach and the walk down the path. */
const DRIVER_TIMEOUT_MS = 30_000;

export const DRIVER_CSHARP = String.raw`
using System;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class EmcpGuiDrive {
  static string J(string s) {
    if (s == null) return "";
    var sb = new StringBuilder();
    foreach (char c in s) {
      if (c == '\\') sb.Append("\\\\");
      else if (c == '"') sb.Append("\\\"");
      else if (c < ' ') sb.Append(' ');
      else sb.Append(c);
    }
    return sb.ToString();
  }
  static object P(AutomationElement el, AutomationProperty p) {
    object v = el.GetCurrentPropertyValue(p, true);
    return v == AutomationElement.NotSupported ? null : v;
  }
  static string S(AutomationElement el, AutomationProperty p) { var v = P(el, p) as string; return v ?? ""; }
  static bool On(AutomationElement el, AutomationProperty p) { var v = P(el, p); return v is bool && (bool)v; }
  static string Q(string s) { return s == null ? "null" : "\"" + J(s) + "\""; }
  static string Bn(object v) { return v is bool ? ((bool)v ? "true" : "false") : "null"; }
  static string Norm(string s) { return (s ?? "").Replace("&", "").Trim().ToLowerInvariant(); }
  static string Type(AutomationElement el) {
    var ct = P(el, AutomationElement.ControlTypeProperty) as ControlType;
    return ct == null ? "" : ct.ProgrammaticName.Replace("ControlType.", "");
  }

  // Properties only: no pattern object is retrieved to read the state.
  static string State(AutomationElement el) {
    var o = new StringBuilder("{");
    o.Append("\"name\":").Append(Q(S(el, AutomationElement.NameProperty)));
    o.Append(",\"controlType\":").Append(Q(Type(el)));
    o.Append(",\"automationId\":").Append(Q(S(el, AutomationElement.AutomationIdProperty)));
    o.Append(",\"enabled\":").Append(Bn(P(el, AutomationElement.IsEnabledProperty)));
    bool hasValue = On(el, AutomationElement.IsValuePatternAvailableProperty);
    o.Append(",\"value\":").Append(hasValue ? Q(P(el, ValuePattern.ValueProperty) as string) : "null");
    o.Append(",\"readOnly\":").Append(hasValue ? Bn(P(el, ValuePattern.IsReadOnlyProperty)) : "null");
    object t = On(el, AutomationElement.IsTogglePatternAvailableProperty) ? P(el, TogglePattern.ToggleStateProperty) : null;
    o.Append(",\"toggleState\":").Append(t == null ? "null" : Q(t.ToString()));
    object x = On(el, AutomationElement.IsExpandCollapsePatternAvailableProperty) ? P(el, ExpandCollapsePattern.ExpandCollapseStateProperty) : null;
    o.Append(",\"expandState\":").Append(x == null ? "null" : Q(x.ToString()));
    o.Append(",\"selected\":").Append(On(el, AutomationElement.IsSelectionItemPatternAvailableProperty) ? Bn(P(el, SelectionItemPattern.IsSelectedProperty)) : "null");
    return o.Append("}").ToString();
  }

  static string Fail(string code, string reason, string before) {
    return "{\"ok\":false,\"code\":\"" + code + "\",\"reason\":" + Q(reason) + ",\"acted\":false,\"before\":" + (before ?? "null") + ",\"after\":null}";
  }

  public static string Run(long hwnd, int pid, string path, string expId, string expName, string expType, string op, string value, int settleMs) {
    AutomationElement el;
    try {
      el = AutomationElement.FromHandle(new IntPtr(hwnd));
      object rpid = P(el, AutomationElement.ProcessIdProperty);
      if (!(rpid is int) || (int)rpid != pid) return Fail("mismatch", "the window is not of the pid", null);
      var walker = TreeWalker.ControlViewWalker;
      var parts = (path ?? "").Split('/');
      if (parts.Length == 0 || parts[0] != "0") return Fail("error", "bad path", null);
      for (int i = 1; i < parts.Length; i++) {
        int idx = int.Parse(parts[i]);
        var c = walker.GetFirstChild(el);
        for (int k = 0; k < idx && c != null; k++) c = walker.GetNextSibling(c);
        if (c == null) return Fail("gone", "no element at the resolved path", null);
        el = c;
      }
      if (S(el, AutomationElement.AutomationIdProperty) != (expId ?? "") || Type(el) != (expType ?? "") ||
          Norm(S(el, AutomationElement.NameProperty)) != Norm(expName)) {
        return Fail("mismatch", "the element at the path is not the resolved one", State(el));
      }
    } catch (ElementNotAvailableException) {
      return Fail("gone", "the element is no longer available", null);
    }
    string before = State(el);
    if (op == "read") return "{\"ok\":true,\"acted\":false,\"before\":" + before + ",\"after\":null}";
    if (!On(el, AutomationElement.IsEnabledProperty)) return Fail("disabled", "the element is disabled", before);
    try {
      if (op == "invoke") ((InvokePattern)el.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
      else if (op == "expand") ((ExpandCollapsePattern)el.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand();
      else if (op == "toggle") ((TogglePattern)el.GetCurrentPattern(TogglePattern.Pattern)).Toggle();
      else if (op == "select") ((SelectionItemPattern)el.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
      else if (op == "setValue") {
        var vp = (ValuePattern)el.GetCurrentPattern(ValuePattern.Pattern);
        if (vp.Current.IsReadOnly) return Fail("read-only", "the value is read-only", before);
        vp.SetValue(value ?? "");
      }
      else return Fail("error", "unknown operation", before);
    } catch (InvalidOperationException e) {
      return Fail("no-pattern", "the pattern refused: " + e.GetType().Name, before);
    } catch (ElementNotAvailableException) {
      return Fail("gone", "the element vanished before the act", before);
    }
    Thread.Sleep(settleMs);
    string after = "null";
    try { after = State(el); } catch (ElementNotAvailableException) { after = "null"; }
    return "{\"ok\":true,\"acted\":true,\"before\":" + before + ",\"after\":" + after + "}";
  }
}
`;

/** The driver's script; every caller value comes from $env, never from the script text. */
export function buildDriverScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase -TypeDefinition @'",
    DRIVER_CSHARP,
    "'@",
    `$d = $env:${ENV_DRIVE} | ConvertFrom-Json`,
    `[EmcpGuiDrive]::Run([long]$env:${ENV_HWND}, [int]$env:${ENV_PID}, [string]$d.path, [string]$d.automationId, [string]$d.name, [string]$d.controlType, [string]$d.op, [string]$env:${ENV_VALUE}, [int]$d.settleMs)`,
  ].join("\n");
}

export interface ElementState {
  name: string;
  controlType: string;
  automationId: string;
  enabled: boolean | null;
  value: string | null;
  readOnly: boolean | null;
  toggleState: string | null;
  expandState: string | null;
  selected: boolean | null;
}

export interface DriverRequest {
  pid: number;
  hwnd: number;
  /** walker.py index path of the element in the control view. */
  path: string;
  /** What the snapshot showed there; the driver refuses unless the element still shows it. */
  expect: { automationId: string; name: string; controlType: string };
  op: DriverOp;
  value?: string;
  settleMs?: number;
}

export type DriverFailure = "mismatch" | "gone" | "disabled" | "no-pattern" | "read-only" | "error";

export interface DriverResult {
  ok: boolean;
  /** Set when ok is false: the driver's code, or "runner" when PowerShell itself failed. */
  code: DriverFailure | "runner" | null;
  reason: string | null;
  acted: boolean;
  before: ElementState | null;
  after: ElementState | null;
}

function redactState(s: unknown): ElementState | null {
  if (!s || typeof s !== "object") return null;
  const x = s as ElementState;
  const str = (v: unknown): string => (typeof v === "string" ? redactText(v) : "");
  const opt = (v: unknown): string | null => (typeof v === "string" ? redactText(v) : null);
  const b = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  return {
    name: str(x.name),
    controlType: str(x.controlType),
    automationId: str(x.automationId),
    enabled: b(x.enabled),
    value: opt(x.value),
    readOnly: b(x.readOnly),
    toggleState: opt(x.toggleState),
    expandState: opt(x.expandState),
    selected: b(x.selected),
  };
}

/** Run the driver once. The answer's strings pass through `redactText`. */
export async function runDriver(
  req: DriverRequest,
  deps: { run?: PowerShellRunner } = {},
): Promise<DriverResult> {
  const r = await (deps.run ?? runPowerShell)(buildDriverScript(), {
    timeoutMs: DRIVER_TIMEOUT_MS + (req.settleMs ?? DEFAULT_SETTLE_MS),
    env: {
      [ENV_PID]: String(req.pid),
      [ENV_HWND]: String(req.hwnd),
      [ENV_DRIVE]: JSON.stringify({
        path: req.path,
        automationId: req.expect.automationId,
        name: req.expect.name,
        controlType: req.expect.controlType,
        op: req.op,
        settleMs: req.settleMs ?? DEFAULT_SETTLE_MS,
      }),
      [ENV_VALUE]: req.value ?? "",
    },
  });
  if (!r.ok) {
    return {
      ok: false,
      code: "runner",
      reason: r.error ?? "the driver did not run",
      acted: false,
      before: null,
      after: null,
    };
  }
  const line = lastLine(r.stdout);
  let doc: {
    ok?: boolean;
    code?: DriverFailure;
    reason?: string;
    acted?: boolean;
    before?: unknown;
    after?: unknown;
  };
  try {
    doc = JSON.parse(line ?? "") as typeof doc;
  } catch {
    return {
      ok: false,
      code: "runner",
      reason: `unparseable driver output: ${redactText((line ?? "").slice(0, 200))}`,
      acted: false,
      before: null,
      after: null,
    };
  }
  return {
    ok: doc.ok === true,
    code: doc.ok === true ? null : (doc.code ?? "error"),
    reason: doc.ok === true ? null : redactText(doc.reason ?? "the driver refused"),
    acted: doc.acted === true,
    before: redactState(doc.before),
    after: redactState(doc.after),
  };
}

// ── Modal check (rule 1.2.5) ────────────────────────────────────────────────────────────────────

export interface DialogInfo {
  hwnd: number;
  title: string;
  className: string;
  owned: boolean;
}

/**
 * The dialog-like windows of the pid open now: visible, not a menu popup, and either dialog-like
 * (modal-watchdog.ts `isDialogLike`) or carrying a known modal title. No baseline is needed.
 */
export function openDialogs(windows: WindowInfo[], pid: number): WindowInfo[] {
  return windows.filter(
    (w) =>
      w.pid === pid &&
      w.visible &&
      !isMenuPopup(w) &&
      (isDialogLike(w) || (KNOWN_MODAL_TITLES as readonly string[]).includes(w.title)),
  );
}

/** A dialog for an answer: title and class redacted. */
export function describeDialog(w: WindowInfo): DialogInfo {
  return {
    hwnd: w.hwnd,
    title: redactText(w.title),
    className: redactText(w.className),
    owned: w.owned,
  };
}

/** One look at the pid's windows: the dialogs open now (raw windows, for comparison). */
export async function checkDialogs(
  pid: number,
  deps: UiaDeps = {},
): Promise<{ ok: boolean; error: string | null; dialogs: WindowInfo[]; windows: WindowInfo[] }> {
  const listed = await listWindows(pid, deps);
  if (!listed.ok) return { ok: false, error: listed.error, dialogs: [], windows: [] };
  return {
    ok: true,
    error: null,
    dialogs: openDialogs(listed.windows, pid),
    windows: listed.windows,
  };
}
