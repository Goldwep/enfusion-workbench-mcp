/**
 * Enfusion Workbench Launcher window nudge (Windows-only).
 *
 * When a project is new to the launcher's registry/scan, spawning
 * `ArmaReforgerWorkbenchSteamDiag.exe -wbProjectPath <gproj>` does NOT
 * auto-open the project: the launcher holds at its Projects picker with
 * the CLI-specified project preselected and waits for a human click on
 * Open — while the window itself sits MINIMIZED (rect -32000), so
 * nothing is visible and the session console.log freezes right after
 * `Workbench Create Engine took` (live-diagnosed 2026-08-31, EC29).
 *
 * The remedy (proven twice in that session): restore the launcher
 * window via WM_SYSCOMMAND/SC_RESTORE and post VK_RETURN — Enter
 * activates the preselected Open button. Both messages are POSTED (never
 * sent), so a hung window can't block us.
 *
 * Node has no Win32 API access without native modules, so the work runs
 * in a one-shot Windows PowerShell child: an Add-Type C# helper
 * enumerates the pid's top-level windows, optionally nudges the one
 * matching the launcher title, and prints a JSON summary. The script is
 * passed via -EncodedCommand (base64 UTF-16LE) to sidestep command-line
 * quoting entirely. Nothing caller-controlled is interpolated except the
 * validated numeric pid.
 *
 * The enumeration also reports whether any window matches the launcher's
 * "Missing Addon Dependencies" modal — the second launch-blocker, popped
 * after Open when a .gproj dependency GUID can't be located. If the
 * modal is already up, the Enter post is skipped (the modal is evidence
 * to report, not something to blind-click).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";

/** Title of the launcher's project-picker window. */
export const LAUNCHER_WINDOW_TITLE = "Enfusion Workbench Launcher";
/** Title of the modal popped when a .gproj dependency GUID can't be located. */
export const MISSING_DEPS_WINDOW_TITLE = "Missing Addon Dependencies";

const DEFAULT_TIMEOUT_MS = 20_000; // Add-Type cold compile can take a few seconds

export interface NudgeOutcome {
  /** A top-level window matching the launcher title exists for the pid. */
  windowFound: boolean;
  windowTitle: string | null;
  /** The matched window was minimized when found (the field signature). */
  wasMinimized: boolean;
  /** SC_RESTORE was posted to the matched window. */
  restored: boolean;
  /** VK_RETURN down/up was posted to the matched window. */
  enterPosted: boolean;
  /** A window matching MISSING_DEPS_WINDOW_TITLE exists for the pid. */
  modalDetected: boolean;
  /** All non-empty top-level window titles owned by the pid (evidence). */
  windowTitles: string[];
  /** Non-null when the PowerShell probe itself failed. */
  error: string | null;
}

function failedOutcome(error: string): NudgeOutcome {
  return {
    windowFound: false,
    windowTitle: null,
    wasMinimized: false,
    restored: false,
    enterPosted: false,
    modalDetected: false,
    windowTitles: [],
    error,
  };
}

// C# 5 syntax only — Windows PowerShell 5.1 compiles Add-Type with CodeDom.
// IntPtr lParam values use unchecked int casts so the code also compiles in
// a 32-bit host; sign-extension garbage in the high dword is ignored by key
// message handling (only bits 0-31 are defined).
const NUDGE_CSHARP = String.raw`
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class EmcpWindowNudge {
  private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int maxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  private const uint WM_SYSCOMMAND = 0x0112;
  private const int SC_RESTORE = 0xF120;
  private const uint WM_KEYDOWN = 0x0100;
  private const uint WM_KEYUP = 0x0101;
  private const int VK_RETURN = 0x0D;

  private static string J(string s) {
    var sb = new StringBuilder();
    foreach (char c in s) {
      if (c == '\\') sb.Append("\\\\");
      else if (c == '"') sb.Append("\\\"");
      else if (c < ' ') sb.Append(' ');
      else sb.Append(c);
    }
    return sb.ToString();
  }

  public static string Run(int pid, string targetTitle, string modalTitle, bool doNudge) {
    var titles = new List<string>();
    IntPtr target = IntPtr.Zero;
    string foundTitle = null;
    bool modal = false;
    bool iconic = false;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lp) {
      uint wpid;
      GetWindowThreadProcessId(hWnd, out wpid);
      if (wpid != (uint)pid) return true;
      int len = GetWindowTextLength(hWnd);
      if (len <= 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      string t = sb.ToString();
      titles.Add(t);
      if (t.IndexOf(modalTitle, StringComparison.OrdinalIgnoreCase) >= 0) modal = true;
      if (target == IntPtr.Zero && t.IndexOf(targetTitle, StringComparison.OrdinalIgnoreCase) >= 0) {
        target = hWnd;
        foundTitle = t;
        iconic = IsIconic(hWnd);
      }
      return true;
    }, IntPtr.Zero);
    bool restored = false;
    bool posted = false;
    if (doNudge && !modal && target != IntPtr.Zero) {
      PostMessage(target, WM_SYSCOMMAND, new IntPtr(SC_RESTORE), IntPtr.Zero);
      restored = true;
      posted = PostMessage(target, WM_KEYDOWN, new IntPtr(VK_RETURN), new IntPtr(0x001C0001));
      PostMessage(target, WM_KEYUP, new IntPtr(VK_RETURN), new IntPtr(unchecked((int)0xC01C0001)));
    }
    var o = new StringBuilder();
    o.Append("{\"windowFound\":").Append(target != IntPtr.Zero ? "true" : "false");
    o.Append(",\"windowTitle\":");
    if (foundTitle == null) o.Append("null");
    else o.Append("\"").Append(J(foundTitle)).Append("\"");
    o.Append(",\"wasMinimized\":").Append(iconic ? "true" : "false");
    o.Append(",\"restored\":").Append(restored ? "true" : "false");
    o.Append(",\"enterPosted\":").Append(posted ? "true" : "false");
    o.Append(",\"modalDetected\":").Append(modal ? "true" : "false");
    o.Append(",\"windowTitles\":[");
    for (int i = 0; i < titles.Count; i++) {
      if (i > 0) o.Append(",");
      o.Append("\"").Append(J(titles[i])).Append("\"");
    }
    o.Append("]}");
    return o.ToString();
  }
}
`;

/**
 * Build the PowerShell script for one probe/nudge invocation. Exported
 * for tests. Titles are module constants (never caller input); they must
 * not contain single quotes, which would break the PS literal.
 */
export function buildNudgeScript(
  pid: number,
  targetTitle: string,
  modalTitle: string,
  doNudge: boolean,
): string {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid pid for launcher nudge: ${pid}`);
  }
  if (targetTitle.includes("'") || modalTitle.includes("'")) {
    throw new Error("Window titles for the nudge script must not contain single quotes");
  }
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    NUDGE_CSHARP,
    "'@",
    `[EmcpWindowNudge]::Run(${pid}, '${targetTitle}', '${modalTitle}', $${doNudge})`,
  ].join("\n");
}

function powershellExe(): string {
  const sysRoot = process.env.SystemRoot ?? "C:\\Windows";
  const full = join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(full) ? full : "powershell.exe";
}

/**
 * Enumerate a process's top-level windows and (optionally) restore +
 * Enter-confirm the one titled like the Workbench launcher.
 */
export function nudgeWindowByTitle(
  pid: number,
  opts: {
    targetTitle: string;
    modalTitle?: string;
    doNudge: boolean;
    timeoutMs?: number;
  },
): Promise<NudgeOutcome> {
  if (process.platform !== "win32") {
    return Promise.resolve(failedOutcome("launcher nudge is Windows-only"));
  }
  let script: string;
  try {
    script = buildNudgeScript(
      pid,
      opts.targetTitle,
      opts.modalTitle ?? MISSING_DEPS_WINDOW_TITLE,
      opts.doNudge,
    );
  } catch (e) {
    return Promise.resolve(failedOutcome(e instanceof Error ? e.message : String(e)));
  }
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise<NudgeOutcome>((resolvePromise) => {
    execFile(
      powershellExe(),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          logger.debug(`[launcher-nudge] powershell failed: ${err.message} ${stderr}`);
          resolvePromise(failedOutcome(`powershell probe failed: ${err.message}`));
          return;
        }
        const lastLine = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .pop();
        if (!lastLine) {
          resolvePromise(failedOutcome("powershell probe produced no output"));
          return;
        }
        try {
          const parsed = JSON.parse(lastLine) as Omit<NudgeOutcome, "error">;
          resolvePromise({ ...parsed, error: null });
        } catch {
          resolvePromise(failedOutcome(`unparseable probe output: ${lastLine.slice(0, 200)}`));
        }
      },
    );
  });
}

/** Restore the launcher picker (if present) and post Enter on its preselected Open. */
export function nudgeEnfusionLauncher(pid: number): Promise<NudgeOutcome> {
  return nudgeWindowByTitle(pid, { targetTitle: LAUNCHER_WINDOW_TITLE, doNudge: true });
}

/** Titles-only probe of the pid's windows — no input is posted. */
export function inspectProcessWindows(pid: number): Promise<NudgeOutcome> {
  return nudgeWindowByTitle(pid, { targetTitle: LAUNCHER_WINDOW_TITLE, doNudge: false });
}
