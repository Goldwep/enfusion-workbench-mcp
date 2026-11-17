/**
 * The GUI layer's accessibility reads (plan 8 work package 3.5, DEC-047 L5 "tree-based").
 *
 * Three read-only operations over one Workbench process, all through the PowerShell route of
 * `src/workbench/launcher-nudge.ts` (script as -EncodedCommand, an Add-Type C# 5 helper, values
 * from the caller as environment variables, never interpolated into the script text):
 *
 *   listWindows(pid)  the pid's top-level windows with class, title, visibility, owner and hung
 *                     state: the fields of `tools/uia/uia_com.py` `windows()` (EnumWindows,
 *                     GetWindowThreadProcessId, GetClassNameW, GetWindowTextW, IsWindowVisible,
 *                     GetWindow(GW_OWNER), IsHungAppWindow), the enumeration S-C and S-F used live.
 *   snapshot(target)  the accessibility tree of ONE window chosen by pid, Win32 class and title
 *                     fullmatch together (`tools/uia/walker.py` `select_window`), as nodes of the
 *                     walker's record shape (`walker.py` `Walk.shape` and `Walk.node`):
 *                     controlType, name, automationId, className, rect, enabled, offscreen,
 *                     patterns, children, childCount | childCountAtLeast, truncated, sampled.
 *                     Data containers (List, Tree, Table, DataGrid and their rows) keep the first
 *                     `rowSample` children (walker.py DATA_CONTAINER_TYPES / DATA_ROW_TYPES).
 *   find(snapshot, q) a pure search over a snapshot (no second read).
 *
 * The route differs from the walker's in one respect, recorded here and in the hand-off: the
 * walker reads through COM IUIAutomation via comtypes (Python); this module reads through the
 * managed System.Windows.Automation client (UIAutomationClient.dll, the same UIA core) so the
 * server needs no Python. Pattern availability is read from the Is<Pattern>PatternAvailable
 * properties only (never a pattern object), as the walker does; the managed client has no
 * LegacyIAccessible properties and no client timeouts, so `budgetMs` and the PowerShell timeout
 * bound the read instead. [unverified live: this managed route has not read the Workbench yet.]
 *
 * Every script this module runs is also exposed as data (`buildListWindowsScript`,
 * `buildSnapshotScript`); `snapshotPlanAction` describes a snapshot as a `uia-read` action of
 * scripts/live/dry-run.ts. That plan is ADVISORY data for a harness or a test: src cannot import
 * scripts/, so snapshot() does not run the checker before it walks (review GUI-03).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ── PowerShell runner (the launcher-nudge.ts / scripts/live/powershell.ts route) ──────────────

export interface PowerShellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Non-null when PowerShell could not run or exited non-zero. */
  error: string | null;
}

/** Runs one script; injected in tests (no real UI Automation there). */
export type PowerShellRunner = (
  script: string,
  opts: { timeoutMs: number; env: Record<string, string> },
) => Promise<PowerShellResult>;

/** Full path of Windows PowerShell 5.1 when present, else the bare name (as launcher-nudge.ts). */
export function powershellExe(env: NodeJS.ProcessEnv = process.env): string {
  const sysRoot = env.SystemRoot ?? "C:\\Windows";
  const full = join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(full) ? full : "powershell.exe";
}

/** The argv PowerShell starts with (base64 UTF-16LE -EncodedCommand, as launcher-nudge.ts). */
export function powershellArgs(script: string): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

export const runPowerShell: PowerShellRunner = (script, opts) => {
  if (process.platform !== "win32") {
    return Promise.resolve({
      ok: false,
      stdout: "",
      stderr: "",
      error: "the GUI layer is Windows-only",
    });
  }
  return new Promise((resolvePromise) => {
    execFile(
      powershellExe(),
      powershellArgs(script),
      {
        timeout: opts.timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ...opts.env },
      },
      (err, stdout, stderr) => {
        resolvePromise({
          ok: !err,
          stdout: String(stdout),
          stderr: redactText(String(stderr)).slice(0, STDERR_MAX),
          // Never err.message: it carries the whole argv (the encoded script) and raw stderr
          // (review GUI-05). Built from the exit code, the kill flag and redacted stderr.
          error: err ? processError(err, String(stderr)) : null,
        });
      },
    );
  });
};

/** Longest stderr excerpt that may reach an answer. */
export const STDERR_MAX = 300;

/** An execFile failure as exit code or kill (timeout), plus a redacted stderr excerpt. */
export function processError(err: { code?: unknown; killed?: boolean }, stderr: string): string {
  const head = err.killed
    ? "PowerShell was killed (timeout)"
    : typeof err.code === "number"
      ? `PowerShell exited with code ${err.code}`
      : "PowerShell could not run";
  const tail = redactText(stderr).replace(/\s+/g, " ").trim().slice(0, STDERR_MAX);
  return tail ? `${head}: ${tail}` : head;
}

// ── Redaction (walker.py's placeholder rules) ───────────────────────────────────────────────────

function escapeRx(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * walker.py Redactor / walk.ts `secondPass` placeholders: %LOCALAPPDATA% and %USERPROFILE%
 * roots, the account and machine names (<user>, <host>), and the generic personal-data shapes (Windows home
 * paths <home-path>, e-mail <email>, steam64 ids <steam-id>).
 */
export function redactText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  const roots: Array<[string | undefined, string]> = [
    [env.LOCALAPPDATA, "%LOCALAPPDATA%"],
    [env.USERPROFILE, "%USERPROFILE%"],
  ];
  for (const [root, ph] of roots) {
    if (!root || root.length < 4) continue;
    const t = root.replace(/[\\/]+$/, "");
    const forms = [...new Set([t, t.replace(/\\/g, "/"), t.replace(/\//g, "\\")])];
    out = out.replace(new RegExp(forms.map(escapeRx).join("|"), "gi"), ph);
  }
  out = out.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"]+/gi, "<home-path>");
  out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>");
  out = out.replace(/\b7656119\d{10}\b/g, "<steam-id>");
  const tokens: Array<[string | undefined, string]> = [
    [env.USERNAME, "<user>"],
    [env.COMPUTERNAME, "<host>"],
  ];
  for (const [v, ph] of tokens) {
    if (v && v.length >= 3) out = out.replace(new RegExp(escapeRx(v), "gi"), ph);
  }
  return out;
}

const NODE_STRING_FIELDS = [
  "name",
  "automationId",
  "className",
  "frameworkId",
  "acceleratorKey",
  "accessKey",
  "helpText",
] as const;

/** Every string of a tree through `redactText` (walker.py `Walk.shape` redacts each one). */
export function redactTree(n: UiaNode, env: NodeJS.ProcessEnv = process.env): UiaNode {
  const out: UiaNode = { ...n };
  const rec = out as unknown as Record<string, unknown>;
  for (const k of NODE_STRING_FIELDS) {
    if (typeof rec[k] === "string") rec[k] = redactText(rec[k] as string, env);
  }
  if (n.children) out.children = n.children.map((c) => redactTree(c, env));
  return out;
}

/** A window's title and class through `redactText`. */
export function redactWindow(w: WindowInfo, env: NodeJS.ProcessEnv = process.env): WindowInfo {
  return { ...w, title: redactText(w.title, env), className: redactText(w.className, env) };
}

/** Last non-empty output line, where the scripts print their JSON. */
export function lastLine(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

// ── Shapes (walker.py's) ──────────────────────────────────────────────────────────────────────

/** One top-level window, as `uia_com.py` `windows()` reports a window of the pid. */
export interface WindowInfo {
  hwnd: number;
  pid: number;
  className: string;
  title: string;
  visible: boolean;
  owned: boolean;
  hung: boolean;
}

/** One element, as `walker.py` `Walk.shape` / `Walk.node` emit it. */
export interface UiaNode {
  controlType: string;
  name: string;
  automationId: string;
  className: string;
  /** [left, top, width, height] (UIA's BoundingRectangle as a VARIANT array), or null. */
  rect: number[] | null;
  enabled: boolean | null;
  offscreen: boolean | null;
  patterns: string[];
  frameworkId?: string;
  acceleratorKey?: string;
  accessKey?: string;
  helpText?: string;
  children?: UiaNode[];
  childCount?: number;
  childCountAtLeast?: number;
  truncated?: string;
  sampled?: { kept: number; rule: "data-container" | "fanout" };
  /** walker.py: a read that failed leaves `{ controlType: "", path, error }`. */
  error?: string;
  childError?: string;
}

export interface SnapshotBounds {
  maxDepth: number;
  maxNodes: number;
  budgetMs: number;
  rowSample: number;
  maxChildren: number;
}

/** The five bounds this route enforces, at walker.py DEFAULT_BOUNDS values (tools/uia/walk.ts). */
export const DEFAULT_SNAPSHOT_BOUNDS: SnapshotBounds = {
  maxDepth: 40,
  maxNodes: 5000,
  budgetMs: 60_000,
  rowSample: 40,
  maxChildren: 1000,
};

/** walker.py BOUND_CAPS / policy.json `live_lane.uia_read` for the same five keys. */
export const SNAPSHOT_BOUND_CAPS: SnapshotBounds = {
  maxDepth: 200,
  maxNodes: 100_000,
  budgetMs: 600_000,
  rowSample: 1000,
  maxChildren: 10_000,
};

/**
 * The four bounds walk.ts carries that this route cannot enforce (no client timeouts in the
 * managed client, no per-call timing), filled with walk.ts DEFAULT_BOUNDS so the `uia-read`
 * plan action carries all nine (dry-run.ts UIA_READ_BOUNDS).
 */
export const UNENFORCED_PLAN_BOUNDS = {
  countCap: 2000,
  callTimeoutMs: 2000,
  slowCallMs: 250,
  maxConsecutiveErrors: 3,
} as const;

export interface SnapshotTarget {
  pid: number;
  /** Win32 class of the window; when absent, any class (the title must then match). */
  className?: string;
  /** Regular expression matched against the whole title (walker.py: `rx.fullmatch`). */
  titlePattern?: string;
  hwnd?: number;
  /** Allow an owned window (a dialog or popup); walker.py refuses it without --allow-owned. */
  allowOwned?: boolean;
}

export interface SnapshotResult {
  ok: boolean;
  /** Set when no window, or more than one, matches; or the read failed. */
  reason: string | null;
  window: WindowInfo | null;
  tree: UiaNode | null;
  nodes: number;
  /** null when the walk finished inside every bound. */
  stopReason: "max-nodes" | "budget" | null;
  elapsedMs: number | null;
  /** The script that ran (or would run), as data for the dry-run checker. */
  script: string;
}

// ── Popup and selection rules (menus.py, walker.py) ────────────────────────────────────────────

/** menus.py POPUP_CLASS_MARK: Qt popup windows carry this in their class (Qt683QWindowPopup…). */
export const POPUP_CLASS_MARK = "QWindowPopup";
/** menus.py POPUP_SHADOW_CLASS: the drop-shadow helper of a Qt popup (unowned, untitled). */
export const POPUP_SHADOW_CLASS = "SysShadow";

/** menus.py `is_popup`: owned, of the Qt popup class, or an untitled SysShadow. */
export function isPopup(w: Pick<WindowInfo, "owned" | "className" | "title">): boolean {
  if (w.owned || (w.className ?? "").includes(POPUP_CLASS_MARK)) return true;
  return w.className === POPUP_SHADOW_CLASS && !w.title;
}

/** A menu popup in the narrow sense: the Qt popup class or its shadow, owned or not. */
export function isMenuPopup(w: Pick<WindowInfo, "className" | "title">): boolean {
  return (
    (w.className ?? "").includes(POPUP_CLASS_MARK) ||
    (w.className === POPUP_SHADOW_CLASS && !w.title)
  );
}

/** Null when `t` is a safe target (walker.py `select_window` preconditions; walk.ts `validateTarget`). */
export function validateSnapshotTarget(t: Partial<SnapshotTarget>): string | null {
  if (typeof t.pid !== "number" || !Number.isInteger(t.pid) || t.pid <= 0) {
    return "a positive integer pid is required (never the foreground window, never a title alone)";
  }
  // walker.py select_window (l.357-360): class AND title pattern together, or one exact hwnd.
  if (t.hwnd === undefined && (!t.className || t.titlePattern === undefined)) {
    return "name the window by className and titlePattern together, or by hwnd";
  }
  if (t.titlePattern !== undefined) {
    try {
      new RegExp(t.titlePattern);
    } catch (e) {
      return `titlePattern does not compile: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (t.hwnd !== undefined && (!Number.isInteger(t.hwnd) || t.hwnd <= 0)) {
    return "hwnd must be a positive integer";
  }
  return null;
}

/** Null when every bound is a positive integer within its cap. */
export function validateSnapshotBounds(b: SnapshotBounds): string | null {
  for (const k of Object.keys(DEFAULT_SNAPSHOT_BOUNDS) as Array<keyof SnapshotBounds>) {
    const v = b[k];
    if (!Number.isInteger(v) || v <= 0 || v > SNAPSHOT_BOUND_CAPS[k]) {
      return `${k} must be an integer between 1 and ${SNAPSHOT_BOUND_CAPS[k]}`;
    }
  }
  return null;
}

/**
 * walker.py `select_window` over a window list: exactly one visible window of the pid whose
 * class equals `className` (when given) and whose title fully matches `titlePattern` (when
 * given), not owned unless allowed, not hung. With neither class nor pattern, the pid's
 * windows that are not popups and carry a title are the candidates (the main window).
 */
export function selectWindow(
  windows: WindowInfo[],
  t: SnapshotTarget,
): { window: WindowInfo | null; reason: string | null; candidates: WindowInfo[] } {
  const rx = t.titlePattern !== undefined ? new RegExp(`^(?:${t.titlePattern})$`) : null;
  const matches = windows.filter((w) => {
    if (w.pid !== t.pid) return false;
    if (t.hwnd !== undefined && w.hwnd !== t.hwnd) return false;
    if (t.className !== undefined && w.className !== t.className) return false;
    if (rx && !rx.test(w.title ?? "")) return false;
    if (!w.visible) return false;
    if (w.owned && !t.allowOwned) return false;
    return true;
  });
  if (matches.length === 0) {
    return {
      window: null,
      reason: `no visible top-level window of pid ${t.pid} matches${t.className ? ` class "${t.className}"` : ""}${t.titlePattern !== undefined ? ` and title /${t.titlePattern}/` : ""}${t.allowOwned ? "" : " (owned windows excluded)"}`,
      candidates: [],
    };
  }
  if (matches.length > 1) {
    return {
      window: null,
      reason: `${matches.length} windows match; refusing to choose between them (name the title or hwnd)`,
      candidates: matches,
    };
  }
  if (matches[0].hung) {
    return {
      window: null,
      reason: "the window is not responding (IsHungAppWindow); not attaching",
      candidates: matches,
    };
  }
  return { window: matches[0], reason: null, candidates: matches };
}

// ── The PowerShell scripts (exposed as data) ────────────────────────────────────────────────────

/** Environment variables that carry the caller's values into the scripts. */
export const ENV_PID = "EMCP_GUI_PID";
export const ENV_HWND = "EMCP_GUI_HWND";
export const ENV_BOUNDS = "EMCP_GUI_BOUNDS";
/** The GUI driver's request (src/gui/driver.ts): index path, expected identity, operation. */
export const ENV_DRIVE = "EMCP_GUI_DRIVE";
/** The GUI driver's setValue text, kept apart from the request JSON. */
export const ENV_VALUE = "EMCP_GUI_VALUE";

/**
 * The Win32 half: the enumeration of `uia_com.py` `windows()` in launcher-nudge.ts's C# 5 form.
 * Reads only; posts and sends no message (IsHungAppWindow sends none either).
 */
export const WINDOWS_CSHARP = String.raw`
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class EmcpGuiWindows {
  private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int maxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int maxCount);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] private static extern bool IsHungAppWindow(IntPtr hWnd);
  private const uint GW_OWNER = 4;

  public static string J(string s) {
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

  public static string List(int pid) {
    var o = new StringBuilder("[");
    bool first = true;
    EnumWindows(delegate(IntPtr h, IntPtr lp) {
      uint wpid;
      GetWindowThreadProcessId(h, out wpid);
      if (wpid != (uint)pid) return true;
      var cls = new StringBuilder(256);
      GetClassName(h, cls, 256);
      var title = new StringBuilder(512);
      GetWindowText(h, title, 512);
      if (!first) o.Append(",");
      first = false;
      o.Append("{\"hwnd\":").Append(h.ToInt64());
      o.Append(",\"pid\":").Append(wpid);
      o.Append(",\"className\":\"").Append(J(cls.ToString())).Append("\"");
      o.Append(",\"title\":\"").Append(J(title.ToString())).Append("\"");
      o.Append(",\"visible\":").Append(IsWindowVisible(h) ? "true" : "false");
      o.Append(",\"owned\":").Append(GetWindow(h, GW_OWNER) != IntPtr.Zero ? "true" : "false");
      o.Append(",\"hung\":").Append(IsHungAppWindow(h) ? "true" : "false");
      o.Append("}");
      return true;
    }, IntPtr.Zero);
    return o.Append("]").ToString();
  }
}
`;

/**
 * The UI Automation half: walker.py's walk (first child / next sibling, read properties only,
 * data containers sampled, fan-out capped, node and time budgets) through the managed client.
 * No pattern object is ever retrieved: only Is<Pattern>PatternAvailable properties are read.
 */
export const WALK_CSHARP = String.raw`
using System;
using System.Text;
using System.Diagnostics;
using System.Windows.Automation;

public static class EmcpGuiWalk {
  static int maxDepth, maxNodes, budgetMs, rowSample, maxChildren, nodes;
  static string stop;
  static Stopwatch sw;
  static TreeWalker walker;

  static readonly string[] PatternNames = { "Invoke", "ExpandCollapse", "Toggle", "Value", "RangeValue",
    "Selection", "SelectionItem", "Grid", "GridItem", "Table", "TableItem", "Scroll", "ScrollItem",
    "Text", "Window", "Transform", "Dock", "MultipleView" };
  static readonly AutomationProperty[] PatternProps = {
    AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty,
    AutomationElement.IsTogglePatternAvailableProperty, AutomationElement.IsValuePatternAvailableProperty,
    AutomationElement.IsRangeValuePatternAvailableProperty, AutomationElement.IsSelectionPatternAvailableProperty,
    AutomationElement.IsSelectionItemPatternAvailableProperty, AutomationElement.IsGridPatternAvailableProperty,
    AutomationElement.IsGridItemPatternAvailableProperty, AutomationElement.IsTablePatternAvailableProperty,
    AutomationElement.IsTableItemPatternAvailableProperty, AutomationElement.IsScrollPatternAvailableProperty,
    AutomationElement.IsScrollItemPatternAvailableProperty, AutomationElement.IsTextPatternAvailableProperty,
    AutomationElement.IsWindowPatternAvailableProperty, AutomationElement.IsTransformPatternAvailableProperty,
    AutomationElement.IsDockPatternAvailableProperty, AutomationElement.IsMultipleViewPatternAvailableProperty };

  // Local copy: each Add-Type is its own in-memory assembly, so no class may reference another
  // script block's class (review GUI-01: CS0103 under Windows PowerShell 5.1).
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
  static string B(AutomationElement el, AutomationProperty p) { var v = P(el, p); return v is bool ? ((bool)v ? "true" : "false") : "null"; }

  static bool Over() {
    if (nodes >= maxNodes) { stop = "max-nodes"; return true; }
    if (sw.ElapsedMilliseconds >= budgetMs) { stop = "budget"; return true; }
    return false;
  }

  static void Node(AutomationElement el, int depth, string path, StringBuilder o) {
    nodes++;
    string ctype = "";
    bool data = false;
    // Every property read of this node is guarded: an element that vanished mid-walk
    // (ElementNotAvailableException) becomes walker.py's { controlType: "", path, error } node
    // and the walk goes on with its siblings (walker.py Walk.node l.588-593).
    var h = new StringBuilder();
    try {
      var ct = P(el, AutomationElement.ControlTypeProperty) as ControlType;
      if (ct != null) ctype = ct.ProgrammaticName.Replace("ControlType.", "");
      h.Append("{\"controlType\":\"").Append(J(ctype)).Append("\"");
      h.Append(",\"name\":\"").Append(J(S(el, AutomationElement.NameProperty))).Append("\"");
      h.Append(",\"automationId\":\"").Append(J(S(el, AutomationElement.AutomationIdProperty))).Append("\"");
      h.Append(",\"className\":\"").Append(J(S(el, AutomationElement.ClassNameProperty))).Append("\"");
      var r = P(el, AutomationElement.BoundingRectangleProperty);
      if (r is System.Windows.Rect && !((System.Windows.Rect)r).IsEmpty) {
        var rc = (System.Windows.Rect)r;
        h.Append(",\"rect\":[").Append((long)Math.Round(rc.Left)).Append(",").Append((long)Math.Round(rc.Top))
         .Append(",").Append((long)Math.Round(rc.Width)).Append(",").Append((long)Math.Round(rc.Height)).Append("]");
      } else h.Append(",\"rect\":null");
      h.Append(",\"enabled\":").Append(B(el, AutomationElement.IsEnabledProperty));
      h.Append(",\"offscreen\":").Append(B(el, AutomationElement.IsOffscreenProperty));
      h.Append(",\"patterns\":[");
      bool firstP = true;
      for (int i = 0; i < PatternProps.Length; i++) {
        var v = P(el, PatternProps[i]);
        if (v is bool && (bool)v) {
          if (!firstP) h.Append(",");
          firstP = false;
          h.Append("\"").Append(PatternNames[i]).Append("\"");
          if (PatternNames[i] == "Grid" || PatternNames[i] == "Table") data = true;
        }
      }
      h.Append("]");
      foreach (var f in new[] { new { k = "frameworkId", p = AutomationElement.FrameworkIdProperty },
                                new { k = "acceleratorKey", p = AutomationElement.AcceleratorKeyProperty },
                                new { k = "accessKey", p = AutomationElement.AccessKeyProperty },
                                new { k = "helpText", p = AutomationElement.HelpTextProperty } }) {
        var s = S(el, f.p);
        if (s.Length > 0) h.Append(",\"").Append(f.k).Append("\":\"").Append(J(s)).Append("\"");
      }
    } catch (Exception e) {
      o.Append("{\"controlType\":\"\",\"path\":\"").Append(path).Append("\",\"error\":\"")
       .Append(e is ElementNotAvailableException ? "element-not-available" : "read").Append("\"}");
      return;
    }
    o.Append(h.ToString());
    if (ctype == "List" || ctype == "Tree" || ctype == "Table" || ctype == "DataGrid" ||
        ctype == "ListItem" || ctype == "TreeItem" || ctype == "DataItem") data = true;

    AutomationElement child;
    try { child = walker.GetFirstChild(el); }
    catch (Exception) { o.Append(",\"childError\":\"navigation\"}"); return; }
    if (depth >= maxDepth) {
      if (child != null) o.Append(",\"truncated\":\"depth\"}"); else o.Append(",\"childCount\":0}");
      return;
    }
    int limit = data ? rowSample : maxChildren;
    o.Append(",\"children\":[");
    int walked = 0;
    while (child != null && walked < limit) {
      if (Over()) break;
      if (walked > 0) o.Append(",");
      Node(child, depth + 1, path + "/" + walked, o);
      walked++;
      try { child = walker.GetNextSibling(child); }
      catch (Exception) { o.Append("],\"childError\":\"navigation\",\"childCountAtLeast\":").Append(walked).Append("}"); return; }
    }
    o.Append("]");
    if (child == null) { o.Append(",\"childCount\":").Append(walked).Append("}"); return; }
    if (stop != null) { o.Append(",\"truncated\":\"").Append(stop).Append("\",\"childCountAtLeast\":").Append(walked + 1).Append("}"); return; }
    o.Append(",\"childCountAtLeast\":").Append(walked + 1);
    o.Append(",\"sampled\":{\"kept\":").Append(walked).Append(",\"rule\":\"").Append(data ? "data-container" : "fanout").Append("\"}}");
  }

  public static string Run(long hwnd, int d, int n, int b, int rs, int mc, bool raw) {
    maxDepth = d; maxNodes = n; budgetMs = b; rowSample = rs; maxChildren = mc; nodes = 0; stop = null;
    sw = Stopwatch.StartNew();
    walker = raw ? TreeWalker.RawViewWalker : TreeWalker.ControlViewWalker;
    var root = AutomationElement.FromHandle(new IntPtr(hwnd));
    object rpid = P(root, AutomationElement.ProcessIdProperty);
    object rh = P(root, AutomationElement.NativeWindowHandleProperty);
    var o = new StringBuilder();
    o.Append("{\"identity\":{\"pid\":").Append(rpid == null ? "null" : rpid.ToString());
    o.Append(",\"hwnd\":").Append(rh == null ? "null" : rh.ToString()).Append("},\"tree\":");
    Node(root, 0, "0", o);
    o.Append(",\"nodes\":").Append(nodes);
    o.Append(",\"stopReason\":").Append(stop == null ? "null" : "\"" + stop + "\"");
    o.Append(",\"elapsedMs\":").Append(sw.ElapsedMilliseconds).Append("}");
    return o.ToString();
  }
}
`;

/** listWindows' script: the pid comes from $env:EMCP_GUI_PID, never from the script text. */
export function buildListWindowsScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    WINDOWS_CSHARP,
    "'@",
    `[EmcpGuiWindows]::List([int]$env:${ENV_PID})`,
  ].join("\n");
}

/** snapshot's script: window list, then the walk of $env:EMCP_GUI_HWND with $env:EMCP_GUI_BOUNDS. */
export function buildSnapshotScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    WINDOWS_CSHARP,
    "'@",
    "Add-Type -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase -TypeDefinition @'",
    WALK_CSHARP,
    "'@",
    `$b = $env:${ENV_BOUNDS} | ConvertFrom-Json`,
    `[EmcpGuiWalk]::Run([long]$env:${ENV_HWND}, [int]$b.maxDepth, [int]$b.maxNodes, [int]$b.budgetMs, [int]$b.rowSample, [int]$b.maxChildren, [bool]$b.raw)`,
  ].join("\n");
}

/**
 * The snapshot as a `uia-read` plan action (scripts/live/dry-run.ts format; tools/uia/walk.ts
 * `buildActionPlan`). Advisory data only: nothing in src runs the checker on it (GUI-03). A
 * target named by hwnd alone takes the class and escaped exact title of the resolved window.
 */
export function snapshotPlanAction(
  target: SnapshotTarget,
  bounds: SnapshotBounds,
  resolved?: Pick<WindowInfo, "className" | "title" | "hwnd">,
  view: "raw" | "control" = "control",
): Record<string, unknown> {
  const className = target.className ?? resolved?.className ?? "";
  const titlePattern =
    target.titlePattern ?? (resolved ? resolved.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "");
  const window: Record<string, unknown> = {
    className,
    titlePattern,
    allowOwned: target.allowOwned === true,
  };
  const hwnd = target.hwnd ?? resolved?.hwnd;
  if (hwnd !== undefined) window.hwnd = hwnd;
  return {
    kind: "uia-read",
    target: { pid: target.pid, window },
    readOnly: true,
    view,
    bounds: { ...bounds, ...UNENFORCED_PLAN_BOUNDS },
  };
}

// ── Operations ──────────────────────────────────────────────────────────────────────────────────

export interface UiaDeps {
  run?: PowerShellRunner;
  /** PowerShell timeout for listWindows (Add-Type compiles cold in a few seconds). */
  listTimeoutMs?: number;
}

const LIST_TIMEOUT_MS = 20_000;
/** Beyond budgetMs: two cold Add-Type compiles and the attach. */
const SNAPSHOT_GRACE_MS = 20_000;

function isWindowInfo(v: unknown): v is WindowInfo {
  const w = v as WindowInfo;
  return (
    !!w &&
    typeof w.hwnd === "number" &&
    typeof w.pid === "number" &&
    typeof w.className === "string" &&
    typeof w.title === "string"
  );
}

/** The pid's top-level windows (owned and unowned, with class names). */
export async function listWindows(
  pid: number,
  deps: UiaDeps = {},
): Promise<{ ok: boolean; windows: WindowInfo[]; error: string | null; script: string }> {
  const script = buildListWindowsScript();
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, windows: [], error: "a positive integer pid is required", script };
  }
  const r = await (deps.run ?? runPowerShell)(script, {
    timeoutMs: deps.listTimeoutMs ?? LIST_TIMEOUT_MS,
    env: { [ENV_PID]: String(pid) },
  });
  if (!r.ok) return { ok: false, windows: [], error: r.error ?? r.stderr, script };
  const line = lastLine(r.stdout);
  try {
    const parsed = JSON.parse(line ?? "") as unknown;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return { ok: true, windows: parsed.filter(isWindowInfo), error: null, script };
  } catch {
    return {
      ok: false,
      windows: [],
      error: `unparseable window list: ${redactText((line ?? "").slice(0, 200))}`,
      script,
    };
  }
}

/** Read one window's accessibility tree within the bounds. Read-only. */
export async function snapshot(
  target: SnapshotTarget,
  opts: { bounds?: Partial<SnapshotBounds>; view?: "raw" | "control" } = {},
  deps: UiaDeps = {},
): Promise<SnapshotResult> {
  const script = buildSnapshotScript();
  const fail = (reason: string, window: WindowInfo | null = null): SnapshotResult => ({
    ok: false,
    reason,
    window: window ? redactWindow(window) : null,
    tree: null,
    nodes: 0,
    stopReason: null,
    elapsedMs: null,
    script,
  });
  const targetError = validateSnapshotTarget(target);
  if (targetError) return fail(targetError);
  const bounds: SnapshotBounds = { ...DEFAULT_SNAPSHOT_BOUNDS, ...(opts.bounds ?? {}) };
  const boundsError = validateSnapshotBounds(bounds);
  if (boundsError) return fail(boundsError);

  const listed = await listWindows(target.pid, deps);
  if (!listed.ok) return fail(listed.error ?? "the window list could not be read");
  const sel = selectWindow(listed.windows, target);
  if (!sel.window) return fail(sel.reason ?? "no window");

  const r = await (deps.run ?? runPowerShell)(script, {
    timeoutMs: bounds.budgetMs + SNAPSHOT_GRACE_MS,
    env: {
      [ENV_PID]: String(target.pid),
      [ENV_HWND]: String(sel.window.hwnd),
      [ENV_BOUNDS]: JSON.stringify({ ...bounds, raw: opts.view === "raw" }),
    },
  });
  if (!r.ok) return fail(r.error ?? r.stderr, sel.window);
  const line = lastLine(r.stdout);
  let doc: {
    identity?: { pid?: number | null; hwnd?: number | null };
    tree?: UiaNode;
    nodes?: number;
    stopReason?: "max-nodes" | "budget" | null;
    elapsedMs?: number;
  };
  try {
    doc = JSON.parse(line ?? "") as typeof doc;
  } catch {
    return fail(`unparseable snapshot: ${redactText((line ?? "").slice(0, 200))}`, sel.window);
  }
  // walker.py run_walk: the attached element must carry the chosen pid and hwnd.
  const id = doc.identity ?? {};
  const mismatch = (
    [
      ["pid", target.pid],
      ["hwnd", sel.window.hwnd],
    ] as const
  ).filter(([k, want]) => id[k] !== want);
  if (mismatch.length) {
    return fail(
      `the attached element is not the chosen window (${mismatch.map(([k]) => k).join(", ")} differ)`,
      sel.window,
    );
  }
  if (!doc.tree) return fail("the snapshot carried no tree", sel.window);
  return {
    ok: true,
    reason: null,
    window: redactWindow(sel.window),
    tree: redactTree(doc.tree),
    nodes: typeof doc.nodes === "number" ? doc.nodes : 0,
    stopReason: doc.stopReason ?? null,
    elapsedMs: typeof doc.elapsedMs === "number" ? doc.elapsedMs : null,
    script,
  };
}

// ── find ────────────────────────────────────────────────────────────────────────────────────────

export interface FindQuery {
  /** Case-insensitive substring of name or automation id. */
  text?: string;
  controlType?: string;
  automationId?: string;
  /** Exact name. */
  name?: string;
  limit?: number;
}

export interface FindHit {
  /** walker.py path form: "0/3/1" (child indexes from the root). */
  path: string;
  /** Names from the root, for reading ("Resource Manager > File > Open"). */
  names: string[];
  node: Omit<UiaNode, "children">;
}

export const FIND_LIMIT_DEFAULT = 50;
export const FIND_LIMIT_MAX = 500;

/** Search a snapshot depth-first; a hit carries the node without its children. */
export function find(tree: UiaNode, q: FindQuery): { hits: FindHit[]; total: number } {
  const limit = Math.min(Math.max(q.limit ?? FIND_LIMIT_DEFAULT, 1), FIND_LIMIT_MAX);
  const text = q.text?.toLowerCase();
  const ct = q.controlType?.toLowerCase();
  const hits: FindHit[] = [];
  let total = 0;
  const visit = (n: UiaNode, path: string, names: string[]): void => {
    const here = [...names, n.name || n.automationId || n.controlType];
    const match =
      (!text ||
        n.name.toLowerCase().includes(text) ||
        n.automationId.toLowerCase().includes(text)) &&
      (!ct || n.controlType.toLowerCase() === ct) &&
      (q.automationId === undefined || n.automationId === q.automationId) &&
      (q.name === undefined || n.name === q.name);
    if (match && (text || ct || q.automationId !== undefined || q.name !== undefined)) {
      total++;
      if (hits.length < limit) {
        const { children: _children, ...rest } = n;
        void _children;
        hits.push({ path, names: here, node: rest });
      }
    }
    (n.children ?? []).forEach((c, i) => visit(c, `${path}/${i}`, here));
  };
  visit(tree, "0", []);
  return { hits, total };
}

/** The node at a walker.py path ("0/3/1": child indexes from the root "0"); null if absent. */
export function nodeAtPath(tree: UiaNode, path: string): UiaNode | null {
  const parts = path.split("/");
  if (parts[0] !== "0") return null;
  let n: UiaNode | undefined = tree;
  for (const p of parts.slice(1)) {
    if (!/^\d+$/.test(p)) return null;
    n = n?.children?.[Number(p)];
    if (!n) return null;
  }
  return n ?? null;
}

/** Count the nodes of a tree (for summaries). */
export function countNodes(tree: UiaNode): number {
  return 1 + (tree.children ?? []).reduce((s, c) => s + countNodes(c), 0);
}
