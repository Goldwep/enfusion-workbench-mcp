/**
 * Live-lane post-flight (plan 5.3 "Post-flight"):
 *
 *   1 net-zero   snapshot diff is empty or every difference is on the expected-
 *                noise list (or explained in LIVE-LOG.md: reported, never hidden).
 *                The root's top-level entry list is compared too (a manifest
 *                records it as `top_level`), so a new file or folder at the root
 *                that no declared path covers is seen. Extra snapshot roots
 *                (--extra-before, one manifest each, for example S-A's decoy
 *                addon) are diffed the same way. Without --noise, the list is
 *                `docs/v2/sessions/queues/expected-noise.json` when that file
 *                exists; the net-zero line names the list and how many
 *                differences it explained (DEC-034).
 *   2 close      if this session started Workbench: WM_CLOSE to each visible
 *                top-level main window of THAT pid only, one at a time, the
 *                module windows first and "Enfusion Workbench - <project>" last
 *                (DEC-064: one WM_CLOSE left the Resource Manager window and the
 *                process alive), each waited for; a dialog-like window stops it
 *                and is reported. Then wait for the exit with a timeout. Any
 *                window still open after the timeout is
 *                reported as a hazard dialog and never answered. taskkill is
 *                only the recorded recovery path and is never run here. Then
 *                check for an orphaned CrashReporter.exe (report only). When the
 *                session script closed Workbench itself and saw it exit, it
 *                hands that over with --graceful-exit-evidence <file> (written
 *                by `writeGracefulExit`): the file must name the pid this lane
 *                recorded, a close after the lease was taken, and that pid must
 *                be gone; then the exit counts as graceful.
 *   3 registry   compare with the pre-flight export and report differences.
 *                Valid only after a graceful exit. A restore is a registry
 *                write and is NEVER performed here. A session script that
 *                ended a process by force records it in `forced-kills.jsonl`
 *                in its run folder. Any such record, and any started marker
 *                with no result (`<step>.started`, a step the script never
 *                finished), in the folder of the --before manifest or in a
 *                sibling folder born since the lease was taken, makes the
 *                comparison not valid for the sitting.
 *   4 probe pack the mutating probe pack in the sandbox
 *                (`Scripts/WorkbenchGame/EnfusionCensus/ECEN_ProbeMut*.c`).
 *                With --remove-probe-mut (session S-E's post-flight, plan 5.4
 *                item 7) the files are deleted, only in the 2.0 sandbox, only
 *                once Workbench is gone, and checked gone; otherwise reported.
 *                With --remove-probe (session S-D's post-flight, a second
 *                deviation from plan 5.1 recorded with S-D) EVERY probe-pack
 *                script (`ECEN_Probe*.c`, the read-only pack and any mutating
 *                one) is deleted from that folder, only in the 2.0 sandbox, only
 *                while no Workbench image runs at all, checked gone, and the
 *                removal recorded (`removed-probe-<stamp>.json` in the artifacts
 *                folder: file names and their SHA-256).
 *   5 release    release the lease through Lane.end() (removes only the marker
 *                the lane created) unless the Workbench it started is still
 *                running, or (on win32) ANY Workbench image is running, whatever
 *                pid the lease holds (plan 5.1 guard 1: never dropped while its
 *                Workbench lives). A Workbench the lane did not record is
 *                reported and ended only on the owner's word for that sitting
 *                (plan 5.7), after an image check. Then write the session-log
 *                skeleton (docs/v2/sessions/<NNN>-<date>.md) to stdout or --out.
 *
 * With --partial <steps> (session S-F's close between its two launches; DEC-044
 * and DEC-045 record why a post-flight that always releases could not run there)
 * only the listed steps of 1 net-zero, 2 close, 3 registry run; the others of
 * them are reported as skipped. Steps 4 and 5 never run in this mode, whatever
 * other flags say, so the lease is kept and the probe pack stays. Step 2 sends
 * NO close in this mode (the owner closes that launch by hand): it only checks
 * that the recorded pid is gone. The report carries partial, stepsRun and
 * released false; instead of the session-log skeleton one line "partial
 * post-flight, lease kept" is printed. --partial with 4 or 5, --remove-probe,
 * --remove-probe-mut, --out or --session-number is refused (exit 2).
 *
 * Real operations need --really, win32 and the lease held by this lane;
 * otherwise each step reports what it would do.
 *
 * Usage:
 *   npx tsx scripts/live/postflight.ts --id <lane id> [--before <snapshot.json>]
 *       [--extra-before <snapshot.json>[,<snapshot.json>]] [--noise <list.json>]
 *       [--registry-before <file.reg>] [--registry-key <key>]
 *       [--graceful-exit-evidence <file.json>] [--sandbox <dir>] [--remove-probe-mut]
 *       [--remove-probe] [--close-timeout-ms 120000] [--session-number NNN] [--out <file.md>] [--really]
 *   npx tsx scripts/live/postflight.ts --id <lane id> --partial 1,2,3 [--before ...]
 *       [--registry-before <file.reg>] [--registry-key <key>]
 *       [--graceful-exit-evidence <file.json>] [--sandbox <dir>] [--really]
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { KNOWN_MODAL_TITLES } from "../../src/gui/modal-watchdog.js";
import { inspectProcessWindows } from "../../src/workbench/launcher-nudge.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane } from "./lane.js";
import { WORKBENCH_EXE, probeMutFiles, probePackTarget } from "./launch.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { validateRegistryKey } from "./preflight.js";
import { lastLine, runPowerShell, type PowerShellResult } from "./powershell.js";
import {
  diff,
  diffTopLevel,
  formatDiff,
  isNetZero,
  readManifest,
  readNoiseList,
  takeSnapshot,
  topLevelEntries,
  type SnapshotDiff,
} from "./snapshot.js";
import {
  CRASH_REPORTER_IMAGE,
  defaultExec,
  processByPid,
  processesByImage,
  type ExecFn,
} from "./win.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PostStep {
  step: number;
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export interface PostflightContext {
  lane: Lane;
  really: boolean;
  platform: NodeJS.Platform;
  /** Pre-flight snapshot manifest file. */
  beforeManifest: string | null;
  /** Further snapshot manifests (other roots, e.g. S-A's decoy addon), diffed like the first. */
  extraManifests?: string[];
  noise: string[];
  /** Where `noise` came from, as printed on the net-zero line (null: no list was given). */
  noiseSource?: string | null;
  registryBefore: string | null;
  /**
   * A graceful-exit record the session script wrote when it closed Workbench
   * itself and saw it exit (`writeGracefulExit`). Null: the close step decides.
   */
  gracefulExitEvidence?: string | null;
  /** The 2.0 sandbox (step 4). Null: the root of the pre-flight snapshot, if any. */
  sandboxDir?: string | null;
  /** Step 4 deletes the mutating probe pack (session S-E's post-flight only). */
  removeProbeMut?: boolean;
  /**
   * Step 4 deletes every probe-pack script, `ECEN_Probe*.c` (session S-D's post-flight: the
   * read-only pack's eval channel never stays compiled in the sandbox between sittings).
   */
  removeProbe?: boolean;
  /**
   * Partial mode (S-F between launches): only these of steps 1 to 3 run; step 2 never sends a
   * close and only checks that the recorded pid is gone; steps 4 and 5 never run, the lease is
   * kept. Undefined: the full post-flight.
   */
  partial?: number[];
  /** Deletes one probe-pack file (step 4); unlinkSync when absent (a test seam). */
  unlink?: (path: string) => void;
  /** [unverified] registry key name (see preflight.ts). */
  registryKey: string | null;
  closeTimeoutMs: number;
  artifactsDir: string;
  exec: ExecFn;
  powershell: (script: string, env?: Record<string, string>) => Promise<PowerShellResult>;
  /** Titles of a pid's top-level windows (hazard-dialog report); never posts input. */
  windowTitles: (pid: number) => Promise<string[]>;
  now: () => Date;
}

export interface PostflightReport {
  steps: PostStep[];
  /** Hazard dialogs seen during the close; never answered. */
  hazards: string[];
  graceful: boolean;
  released: boolean;
  /** Set in partial mode (--partial): the steps that ran. */
  partial?: boolean;
  stepsRun?: number[];
}

/** Parse `--partial`: a comma list from {1,2,3}; throws on anything else. */
export function parsePartialSteps(value: string): number[] {
  const items = value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error("--partial needs a comma list from 1,2,3");
  const steps: number[] = [];
  for (const it of items) {
    if (!/^[123]$/.test(it)) {
      throw new Error(
        `--partial ${it} refused: only steps 1 (net-zero), 2 (close check), 3 (registry) run in partial mode; probe pack and release never do`,
      );
    }
    if (!steps.includes(Number(it))) steps.push(Number(it));
  }
  return steps.sort((a, b) => a - b);
}

// ── Step 1: net-zero ─────────────────────────────────────────────────────────

/** The programme's expected-noise list, read by default when `--noise` is not given (DEC-034). */
export const DEFAULT_NOISE_LIST = join(
  REPO_ROOT,
  "docs",
  "v2",
  "sessions",
  "queues",
  "expected-noise.json",
);

/**
 * The expected-noise list post-flight uses: the `--noise` file when given; otherwise the
 * default list when that file exists; otherwise none. `source` is the file read, or null.
 */
export function resolveNoiseList(
  option: string | undefined,
  defaultPath: string = DEFAULT_NOISE_LIST,
): { noise: string[]; source: string | null } {
  if (option) return { noise: readNoiseList(option), source: option };
  if (existsSync(defaultPath)) return { noise: readNoiseList(defaultPath), source: defaultPath };
  return { noise: [], source: null };
}

/** A noise-list path as the net-zero line prints it: repository-relative when inside it. */
function noiseSourceLabel(source: string): string {
  const rel = relative(REPO_ROOT, resolve(source));
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : source;
}

/** The W1 sitting's expected-noise list (W1.md step 6). */
export const W1_NOISE_LIST = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "w1-noise.json");
export const W1_THROWAWAY_PREFIX = "_throwaway/W1/";

/**
 * The hint the net-zero line carries when a difference lies under `_throwaway/W1/` and the W1
 * list was not the one read. Every W1 post-flight of 2026-11-11 (sittings 023, c, d, f, g) read
 * the programme's default list (no `--noise`): the battery's own files under `_throwaway/W1/`,
 * which only the rollback after the post-flight removes, then made the line NO although the test
 * bed was git-clean after the rollback. The hint names the list; nothing is hidden. Null: no hint.
 */
export function w1NoiseHint(d: SnapshotDiff, noiseSource: string | null): string | null {
  if (noiseSource && resolve(noiseSource) === resolve(W1_NOISE_LIST)) return null;
  const inW1 = [...d.added, ...d.removed, ...d.changed].filter((p) =>
    p.startsWith(W1_THROWAWAY_PREFIX),
  );
  if (inW1.length === 0) return null;
  return (
    `hint: ${inW1.length} difference(s) lie under ${W1_THROWAWAY_PREFIX}, the W1 battery's folder, ` +
    "which the rollback removes after this post-flight; a W1 sitting runs the post-flight with " +
    "--noise docs/v2/sessions/queues/w1-noise.json (W1.md step 6)"
  );
}

export function netZeroStep(ctx: PostflightContext): PostStep {
  if (!ctx.beforeManifest) {
    return {
      step: 1,
      name: "net-zero",
      ok: false,
      detail: "no pre-flight snapshot given (--before)",
    };
  }
  const manifests = [ctx.beforeManifest, ...(ctx.extraManifests ?? [])];
  let ok = true;
  const parts: string[] = [];
  for (const file of manifests) {
    const before = readManifest(file);
    const after = takeSnapshot(before.root, before.declared, ctx.now());
    const d = diff(before, after, ctx.noise);
    // The root's entry list: a new file or folder no declared path covers.
    const tl = Array.isArray(before.top_level)
      ? diffTopLevel(before.top_level, topLevelEntries(before.root), before.declared, ctx.noise)
      : null;
    const tlZero = tl === null || (tl.added.length === 0 && tl.removed.length === 0);
    const zero = isNetZero(d) && tlZero;
    ok = ok && zero;
    // The net-zero line names how many differences the expected-noise list explained.
    const explained = d.noise.length + (tl?.noise.length ?? 0);
    const counted = `${explained} difference${explained === 1 ? "" : "s"}`;
    const head =
      `net-zero: ${zero ? "yes" : "NO"} (` +
      (ctx.noiseSource
        ? `expected-noise list ${noiseSourceLabel(ctx.noiseSource)} explained ${counted})`
        : ctx.noise.length > 0
          ? `the expected-noise list explained ${counted})`
          : `no expected-noise list given; ${counted} explained)`);
    let text = isNetZero(d) ? head : [head, ...formatDiff(d).split("\n").slice(1)].join("\n");
    const w1Hint = w1NoiseHint(d, ctx.noiseSource ?? null);
    if (w1Hint) text += `\n${w1Hint}`;
    if (tl === null) {
      text += "\ntop-level entries: not compared (the manifest records no top-level listing)";
    } else if (!tlZero) {
      text += `\ntop-level entries added: ${tl.added.join(", ") || "none"}; removed: ${tl.removed.join(", ") || "none"}`;
    } else if (tl.noise.length > 0) {
      text += `\ntop-level entries on the expected-noise list: ${tl.noise.join(", ")}`;
    }
    parts.push(manifests.length > 1 ? `[${before.root}] ${text}` : text);
  }
  return {
    step: 1,
    name: "net-zero",
    ok,
    detail:
      parts.join("\n") +
      (ok
        ? ""
        : "\nEvery difference must be on the expected-noise list or explained in LIVE-LOG.md."),
  };
}

// ── Step 2: graceful close ───────────────────────────────────────────────────

/**
 * PowerShell: CloseMainWindow on the pid in $env:EMCP_PID and wait up to
 * $env:EMCP_TIMEOUT_MS for it to exit. Prints { closeSent, exited }.
 */
export const CLOSE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$p = Get-Process -Id ([int]$env:EMCP_PID)",
  "$sent = $p.CloseMainWindow()",
  "$exited = $p.WaitForExit([int]$env:EMCP_TIMEOUT_MS)",
  "[pscustomobject]@{ closeSent = $sent; exited = $exited } | ConvertTo-Json -Compress",
].join("\n");

/**
 * PowerShell: the graceful close of every main window of the pid in $env:EMCP_PID (DEC-064).
 * Live W1 runs 1 and 3 (2026-11-11): CloseMainWindow closed the World Editor, but the Resource
 * Manager window "Enfusion Workbench - <project>" stayed and kept the process alive; closing that
 * window by hand ended it at once with no prompt. So: WM_CLOSE to each remaining visible top-level
 * main window (a Qt...QWindowIcon with a title, unowned, enabled), one at a time, the module
 * windows first and the "Enfusion Workbench" window last, waiting for each to go (at most 30 s);
 * a dialog-like window of the pid (class #32770, an owned or disabled window, or a title in
 * $env:EMCP_MODAL_TITLES, "|"-separated) stops it at once and is reported, never answered. Nothing
 * is ever ended by force. Waits up to $env:EMCP_TIMEOUT_MS in all. Prints
 * { closeSent, exited, sent, dialog, remaining } as one JSON line.
 *
 * W5 fix-up 2: a busy window (unowned, disabled, of class Qt<n>QWindowIcon or
 * Qt<n>QWindowToolSaveBits, not #32770 and not a modal title; scripts/census/live/common.ts
 * isBusyWindow) is not a dialog at once. While one is up and no dialog is, nothing is sent and
 * the script waits; it becomes the reported dialog once it has lasted $env:EMCP_BUSY_GRACE_MS.
 * W5 run 2: the close met the World Editor window disabled during the tail of the GM_Arland load
 * and stopped; a retry about 30 s later closed it with no prompt.
 */
export const CLOSE_ALL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;",
  "public static class EmcpCloseAll {",
  "  private delegate bool EnumProc(IntPtr h, IntPtr l);",
  '  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);',
  '  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr h);',
  '  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);',
  '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);',
  '  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);',
  "  public class W { public long H; public string T; public string C; public long O; public bool E; }",
  "  public static List<W> List(uint want) {",
  "    var o = new List<W>();",
  "    EnumWindows(delegate(IntPtr h, IntPtr l) {",
  "      if (!IsWindowVisible(h)) return true;",
  "      uint pid; GetWindowThreadProcessId(h, out pid);",
  "      if (pid != want) return true;",
  "      var t = new StringBuilder(512); GetWindowText(h, t, 512);",
  "      var c = new StringBuilder(256); GetClassName(h, c, 256);",
  "      o.Add(new W { H = h.ToInt64(), T = t.ToString(), C = c.ToString(), O = GetWindow(h, 4).ToInt64(), E = IsWindowEnabled(h) });",
  "      return true;",
  "    }, IntPtr.Zero);",
  "    return o;",
  "  }",
  "  public static bool Close(long h) { return PostMessage(new IntPtr(h), 0x0010, IntPtr.Zero, IntPtr.Zero); }",
  "  public static bool Alive(long h) { var p = new IntPtr(h); return IsWindow(p) && IsWindowVisible(p); }",
  "}",
  "'@",
  "$target = [int]$env:EMCP_PID",
  "$deadline = (Get-Date).AddMilliseconds([int]$env:EMCP_TIMEOUT_MS)",
  "$modal = @(($env:EMCP_MODAL_TITLES -split '\\|') | Where-Object { $_ -ne '' })",
  "$p = Get-Process -Id $target",
  "function Is-Busy($w) { $w.O -eq 0 -and -not $w.E -and $w.C -ne '#32770' -and -not ($modal -contains $w.T) -and ($w.C -match '^Qt\\d+QWindow(Icon|ToolSaveBits)$') }",
  "function Find-Dialog { [EmcpCloseAll]::List([uint32]$target) | Where-Object { -not (Is-Busy $_) -and ($_.C -eq '#32770' -or $_.O -ne 0 -or -not $_.E -or ($modal -contains $_.T)) } | Select-Object -First 1 }",
  "function Find-Busy { [EmcpCloseAll]::List([uint32]$target) | Where-Object { Is-Busy $_ } | Select-Object -First 1 }",
  "$busyGrace = [int]$env:EMCP_BUSY_GRACE_MS; $busySince = $null",
  "$sent = @(); $dialog = $null; $tried = @{}",
  "while ((Get-Date) -lt $deadline -and -not $p.HasExited) {",
  "  $d = Find-Dialog",
  '  if ($d) { $dialog = "$($d.T) [$($d.C)]"; break }',
  "  $b = Find-Busy",
  "  if ($b) {",
  "    if ($null -eq $busySince) { $busySince = Get-Date }",
  '    if (((Get-Date) - $busySince).TotalMilliseconds -ge $busyGrace) { $dialog = "$($b.T) [$($b.C)] (disabled, unowned, for $busyGrace ms)"; break }',
  "    Start-Sleep -Milliseconds 500; continue",
  "  }",
  "  $busySince = $null",
  "  $main = @([EmcpCloseAll]::List([uint32]$target) | Where-Object { $_.C -match '^Qt\\d+QWindowIcon$' -and $_.T -ne '' -and $_.O -eq 0 -and $_.E -and -not $tried.ContainsKey($_.H) })",
  "  if ($main.Count -eq 0) { Start-Sleep -Milliseconds 500; continue }",
  "  $others = @($main | Where-Object { $_.T -notlike 'Enfusion Workbench*' })",
  "  if ($others.Count -gt 0) { $w = $others[0] } else { $w = $main[0] }",
  "  $tried[$w.H] = $true",
  "  [void][EmcpCloseAll]::Close($w.H)",
  "  $sent += $w.T",
  "  $until = (Get-Date).AddMilliseconds(30000)",
  "  if ($until -gt $deadline) { $until = $deadline }",
  "  while ((Get-Date) -lt $until -and -not $p.HasExited -and [EmcpCloseAll]::Alive($w.H)) {",
  "    $d = Find-Dialog",
  '    if ($d) { $dialog = "$($d.T) [$($d.C)]"; break }',
  "    Start-Sleep -Milliseconds 250",
  "  }",
  "  if ($dialog) { break }",
  "}",
  "$exited = $p.HasExited",
  "$remaining = @()",
  'if (-not $exited) { $remaining = @([EmcpCloseAll]::List([uint32]$target) | ForEach-Object { "$($_.T) [$($_.C)]" }) }',
  "[pscustomobject]@{ closeSent = ($sent.Count -gt 0); exited = $exited; sent = @($sent); dialog = $dialog; remaining = @($remaining) } | ConvertTo-Json -Compress",
].join("\n");

/** How long the close waits out a busy window (common.ts BUSY_GRACE_MS, not imported: no cycle). */
export const CLOSE_BUSY_GRACE_MS = 60_000;

/**
 * The engine's save prompt on a world close or reload: a window titled "Loading world" whose text
 * is "Do you want to save changes?" (Yes / No / Cancel). W8 run 8's close report named it only by
 * its title; the report now says what it is and which answer leaves the files unchanged.
 */
export const SAVE_PROMPT_TITLE = "Loading world";
export const SAVE_PROMPT_TEXT = "Do you want to save changes?";

/** A close-report window entry ("<title> [<class>]..."), named when it is the save prompt. */
export function nameCloseWindow(entry: string): string {
  const title = entry.replace(/\s*\[[^\]]*\].*$/, "").trim();
  return title === SAVE_PROMPT_TITLE
    ? `${entry} (the engine's save prompt "${SAVE_PROMPT_TEXT}", Yes / No / Cancel: No is the answer that leaves the files unchanged; never Yes)`
    : entry;
}

/** The close script's answer (CLOSE_ALL_SCRIPT; CLOSE_SCRIPT gave only the first two). */
export interface CloseAllResult {
  closeSent: boolean;
  exited: boolean;
  sent?: string[];
  dialog?: string | null;
  remaining?: string[];
}

export async function closeStep(ctx: PostflightContext): Promise<{
  step: PostStep;
  graceful: boolean;
  stillRunning: boolean;
  hazards: string[];
  /** True when the recorded pid was already gone: the close was not seen here. */
  gone?: boolean;
}> {
  const name = "graceful close";
  const pid = ctx.lane.recordedPid();
  if (pid === null) {
    return {
      step: {
        step: 2,
        name,
        ok: true,
        detail: "this session started no Workbench; nothing to close",
      },
      graceful: true,
      stillRunning: false,
      hazards: [],
    };
  }
  const reason = liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
  if (reason) {
    return {
      step: {
        step: 2,
        name,
        ok: true,
        skipped: true,
        detail: ctx.partial
          ? `${reason}; partial mode: would check that pid ${pid} is gone and send no close`
          : `${reason}; would send WM_CLOSE to each main window of pid ${pid} in turn and wait ${ctx.closeTimeoutMs} ms`,
      },
      graceful: false,
      stillRunning: false,
      hazards: [],
    };
  }
  // A pid alone is not an identity: confirm the image before sending anything.
  const proc = processByPid(ctx.exec, pid);
  if (!proc) {
    return {
      step: { step: 2, name, ok: true, detail: `pid ${pid} is no longer running` },
      graceful: false,
      stillRunning: false,
      hazards: [],
      gone: true,
    };
  }
  if (proc.image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
    return {
      step: {
        step: 2,
        name,
        ok: false,
        detail: `pid ${pid} is ${proc.image}, not ${WORKBENCH_EXE}; nothing sent`,
      },
      graceful: false,
      stillRunning: false,
      hazards: [],
    };
  }
  if (ctx.partial) {
    // S-F: the launch before the second one is closed by the owner's hand (DEC-044); this mode
    // never sends a close, it only reports that the pid still runs.
    const hazards = await ctx.windowTitles(pid);
    return {
      step: {
        step: 2,
        name,
        ok: false,
        detail:
          `pid ${pid} is still running; partial mode sends no close: the owner closes it by hand, ` +
          "then run this again" +
          (hazards.length
            ? `; open window(s), not answered: ${hazards.map(nameCloseWindow).join(" | ")}`
            : ""),
      },
      graceful: false,
      stillRunning: true,
      hazards,
    };
  }
  const r = await ctx.powershell(CLOSE_ALL_SCRIPT, {
    EMCP_PID: String(pid),
    EMCP_TIMEOUT_MS: String(ctx.closeTimeoutMs),
    EMCP_MODAL_TITLES: (KNOWN_MODAL_TITLES as readonly string[]).join("|"),
    EMCP_BUSY_GRACE_MS: String(CLOSE_BUSY_GRACE_MS),
  });
  const line = r.ok ? lastLine(r.stdout) : null;
  const res = line ? (JSON.parse(line) as CloseAllResult) : null;
  const sentList = Array.isArray(res?.sent) ? res.sent : [];
  const sentNote = sentList.length
    ? `; WM_CLOSE sent to ${sentList.length} window(s) in turn: ${sentList.join(" | ")}`
    : "";
  const crash = processesByImage(ctx.exec, CRASH_REPORTER_IMAGE).map((c) => c.pid);
  const crashNote = crash.length
    ? `; ${CRASH_REPORTER_IMAGE} still running (pid ${crash.join(", ")}), report it`
    : "";
  if (res?.exited) {
    return {
      step: {
        step: 2,
        name,
        ok: true,
        detail: `pid ${pid} exited after WM_CLOSE to its main windows${sentNote}${crashNote}`,
      },
      graceful: true,
      stillRunning: false,
      hazards: [],
    };
  }
  // A result other than exited=true (a PowerShell failure, or Get-Process throwing because the
  // process exited between the image check and the script) is not "still running" until the
  // process list says so (DEC-032, S-B read m4).
  const after = processByPid(ctx.exec, pid);
  if (!after || after.image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
    return {
      step: {
        step: 2,
        name,
        ok: true,
        detail:
          `pid ${pid} is ${after ? `now ${after.image}` : "gone"}, but the close script did not report a ` +
          `graceful exit${r.error ? ` (${r.error})` : res ? ` (closeSent ${res.closeSent}, exited ${res.exited})` : ""}: ` +
          `exited, not counted as graceful${crashNote}`,
      },
      graceful: false,
      stillRunning: false,
      hazards: [],
      gone: true,
    };
  }
  const hazards = await ctx.windowTitles(pid);
  if (res?.dialog && !hazards.includes(res.dialog)) hazards.unshift(res.dialog);
  return {
    step: {
      step: 2,
      name,
      ok: false,
      detail:
        (res?.dialog
          ? `pid ${pid} still running: the close stopped at a dialog-like window, not answered: ${nameCloseWindow(res.dialog)}`
          : `pid ${pid} did not exit within ${ctx.closeTimeoutMs} ms`) +
        sentNote +
        (res?.remaining?.length ? `; visible windows left: ${res.remaining.join(" | ")}` : "") +
        (r.error ? ` (${r.error})` : "") +
        (hazards.length
          ? `; hazard dialog(s), not answered: ${hazards.map((h) => (h === res?.dialog ? h : nameCloseWindow(h))).join(" | ")}`
          : "") +
        crashNote +
        ". Ending it, one process at a time after an image check, is the recorded recovery path " +
        "(the session script's recover subcommand: s-a-headless.ts recover, s-b-scratch-profile.ts " +
        "recover, s-c-natives.ts recover); it is not run here.",
    },
    graceful: false,
    stillRunning: true,
    hazards,
  };
}

// ── Graceful-exit evidence (step 2) ──────────────────────────────────────────

/** Record kind of a graceful-exit file. */
export const GRACEFUL_EXIT_KIND = "graceful-exit";

/**
 * What a session script writes when it closed the Workbench this lane started
 * and saw the process exit (S-B closes inside the sitting, plan 5.3 step 2).
 */
export interface GracefulExitRecord {
  kind: typeof GRACEFUL_EXIT_KIND;
  /** The lane session that held the lease (`v2-harness:<id>`). */
  lane: string;
  /** The Workbench pid the lane recorded and the script closed. */
  pid: number;
  /** When the exit was seen, ISO time. */
  closed_at: string;
  /** How it was closed, e.g. "CloseMainWindow, exit seen within 120000 ms". */
  how: string;
}

/** Write a graceful-exit record (created exclusively; an existing file is never replaced). */
export function writeGracefulExit(
  file: string,
  input: { lane: string; pid: number; closedAt: Date; how: string },
): GracefulExitRecord {
  if (!Number.isInteger(input.pid) || input.pid <= 0) throw new Error(`Invalid pid ${input.pid}`);
  const record: GracefulExitRecord = {
    kind: GRACEFUL_EXIT_KIND,
    lane: input.lane,
    pid: input.pid,
    closed_at: input.closedAt.toISOString(),
    how: input.how,
  };
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { encoding: "utf-8", flag: "wx" });
  return record;
}

/**
 * Whether a graceful-exit record makes the exit graceful for this lane: it is
 * a `graceful-exit` record of this lane, for the pid the lane recorded, seen
 * after the lease was taken and not in the future; and, on a real run, that pid
 * is gone. Never a reason to skip the close step: it is read only when the
 * close step found the pid already gone.
 */
export function gracefulExitCheck(
  ctx: PostflightContext,
  file: string,
): { ok: boolean; detail: string } {
  let rec: Partial<GracefulExitRecord>;
  try {
    rec = JSON.parse(readFileSync(file, "utf-8")) as Partial<GracefulExitRecord>;
  } catch (e) {
    return {
      ok: false,
      detail: `graceful-exit record unreadable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const why = (s: string): { ok: false; detail: string } => ({
    ok: false,
    detail: `graceful-exit record not accepted: ${s}`,
  });
  if (!rec || rec.kind !== GRACEFUL_EXIT_KIND) return why(`kind is not "${GRACEFUL_EXIT_KIND}"`);
  if (rec.lane !== ctx.lane.session)
    return why(`lane ${String(rec.lane)} is not ${ctx.lane.session}`);
  const recorded = ctx.lane.recordedPid();
  if (!Number.isInteger(rec.pid) || rec.pid !== recorded) {
    return why(`pid ${String(rec.pid)} is not the pid this lane recorded (${recorded ?? "none"})`);
  }
  const closedAt = Date.parse(String(rec.closed_at));
  if (Number.isNaN(closedAt)) return why("closed_at is not a time");
  const lease = ctx.lane.status().lease;
  const startedAt = "lease" in lease ? Date.parse(lease.lease.started_at) : Number.NaN;
  if (Number.isNaN(startedAt)) return why("the lane's lease start cannot be read");
  if (closedAt < startedAt) return why("the close is older than this lane's lease");
  if (closedAt > ctx.now().getTime() + 60_000) return why("the close lies in the future");
  const reason = liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
  if (reason)
    return {
      ok: true,
      detail: `${reason}; would accept the graceful exit of pid ${rec.pid} (${rec.how})`,
    };
  if (processByPid(ctx.exec, rec.pid as number)) return why(`pid ${rec.pid} is still running`);
  return {
    ok: true,
    detail: `graceful exit of pid ${rec.pid} seen by the session script at ${rec.closed_at} (${rec.how})`,
  };
}

// ── Forced kills (step 3) ────────────────────────────────────────────────────

/** File in a run folder that lists every process the sitting ended by force, one JSON line each. */
export const FORCED_KILLS_FILE = "forced-kills.jsonl";

/** One process a session script ended by force (a kill criterion or a recovery). */
export interface ForcedKillRecord {
  pid: number;
  /** The step or command that ended it, e.g. "S-A-1" or "recover". */
  by: string;
  /** ISO time of the kill. */
  at: string;
  /** What was run, e.g. "taskkill /PID 42 /F". */
  how: string;
}

/** Append one forced-kill record to `<runDir>/forced-kills.jsonl`. */
export function recordForcedKill(runDir: string, rec: ForcedKillRecord): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(join(runDir, FORCED_KILLS_FILE), JSON.stringify(rec) + "\n", "utf-8");
}

/** The forced-kill records of a run folder; an unreadable line still counts as a kill. */
export function readForcedKills(runDir: string): ForcedKillRecord[] {
  const file = join(runDir, FORCED_KILLS_FILE);
  if (!existsSync(file)) return [];
  const out: ForcedKillRecord[] = [];
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ForcedKillRecord);
    } catch {
      out.push({ pid: 0, by: "unreadable record", at: "", how: "" });
    }
  }
  return out;
}

/** When this lane's lease was taken, in ms, or null when the lane holds no readable lease. */
export function leaseStartMs(lane: Lane): number | null {
  const check = lane.status().lease;
  if (!("lease" in check) || check.lease.session !== lane.session) return null;
  const t = Date.parse(check.lease.started_at);
  return Number.isNaN(t) ? null : t;
}

/**
 * The run folders of a sitting: `runDir` itself and every sibling folder BORN at or after
 * `sinceMs` (the lease's start). A new run folder therefore never resets what a sitting counts
 * (forced kills, recoveries, unfinished steps; DEC-031). With no lease start, `runDir` alone.
 */
export function sittingFolders(runDir: string, sinceMs: number | null): string[] {
  const own = resolve(runDir);
  const out = [own];
  if (sinceMs === null) return out;
  const parent = dirname(own);
  let names: string[];
  try {
    names = readdirSync(parent).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(parent, n);
    if (p.toLowerCase() === own.toLowerCase()) continue;
    try {
      const st = statSync(p);
      if (st.isDirectory() && st.birthtimeMs >= sinceMs) out.push(p);
    } catch {
      // A folder that vanished counts for nothing.
    }
  }
  return out;
}

/**
 * Started markers with no result in a run folder: `<step>.started` or
 * `<step>.started.acknowledged` and no `<step>.json`. The session script ended during that
 * step, so how its Workbench ended is unknown (DEC-031).
 */
export function danglingStartedMarkers(runDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(runDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    const m = /^(.+)\.started(\.acknowledged)?$/.exec(n);
    if (m && !names.includes(`${m[1]}.json`)) out.push(n);
  }
  return out.sort();
}

// ── Step 3: registry compare ─────────────────────────────────────────────────

/** Read a `reg export` file (UTF-16LE with BOM, or UTF-8) as text lines. */
export function readRegFile(path: string): string[] {
  const buf = readFileSync(path);
  const text =
    buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
      ? buf.subarray(2).toString("utf16le")
      : buf.toString("utf-8").replace(/^﻿/, "");
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/** Lines only in `before` (removed) and only in `after` (added). Report-only. */
export function compareReg(
  before: string[],
  after: string[],
): { removed: string[]; added: string[] } {
  const a = new Set(after);
  const b = new Set(before);
  return { removed: before.filter((l) => !a.has(l)), added: after.filter((l) => !b.has(l)) };
}

/**
 * `notValid`, when given, says why the comparison is not valid although the
 * close was graceful (a process the sitting ended by force).
 */
export function registryStep(
  ctx: PostflightContext,
  graceful: boolean,
  notValid: string | null = null,
): PostStep {
  const name = "registry compare";
  if (!ctx.registryBefore) {
    return {
      step: 3,
      name,
      ok: true,
      skipped: true,
      detail: "no pre-flight registry export given; nothing to compare",
    };
  }
  const reason = liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
  if (reason) {
    return {
      step: 3,
      name,
      ok: true,
      skipped: true,
      detail: `${reason}; would export the key again and compare`,
    };
  }
  if (!ctx.registryKey)
    return { step: 3, name, ok: false, detail: "no registry key given (--registry-key)" };
  validateRegistryKey(ctx.registryKey);
  mkdirSync(ctx.artifactsDir, { recursive: true });
  const after = join(
    ctx.artifactsDir,
    `registry-after-${ctx.now().toISOString().replace(/[:.]/g, "-")}.reg`,
  );
  ctx.exec("reg", ["export", ctx.registryKey, after]);
  const d = compareReg(readRegFile(ctx.registryBefore), readRegFile(after));
  const validity = notValid
    ? ` NOT VALID: ${notValid} (a forced kill skips the settings write)`
    : graceful
      ? ""
      : " NOT VALID: Workbench did not exit gracefully (a forced kill skips the settings write)";
  return {
    step: 3,
    name,
    ok: true,
    detail:
      `${d.removed.length} lines removed, ${d.added.length} added (after: ${after})${validity}. ` +
      "Report only: a restore is a registry write and needs the owner's go for that session.",
  };
}

// ── Step 4: the mutating probe pack ──────────────────────────────────────────

/**
 * Report, or with `removeProbeMut` delete, the mutating probe pack's scripts
 * in the 2.0 sandbox (plan 5.4 item 7: installed only for S-E; S-E's
 * post-flight removes it). The deletion touches only files named
 * `ECEN_ProbeMut*.c` directly in `<sandbox>/Scripts/WorkbenchGame/EnfusionCensus/`,
 * only in a folder named `EMCP2_sandbox`, only once the Workbench this lane
 * started is gone, and is checked afterwards.
 */
export function probePackStep(ctx: PostflightContext, stillRunning: boolean): PostStep {
  if (ctx.removeProbe) return removeProbeStep(ctx, stillRunning);
  const name = "probe pack";
  const sandbox =
    ctx.sandboxDir ?? (ctx.beforeManifest ? readManifest(ctx.beforeManifest).root : null);
  if (!sandbox) {
    return {
      step: 4,
      name,
      ok: !ctx.removeProbeMut,
      skipped: true,
      detail: "no sandbox given (--sandbox or --before); the mutating probe pack is not checked",
    };
  }
  const files = probeMutFiles(sandbox);
  const where = toPlaceholders(probePackTarget(sandbox), defaultPlaceholderContext({ sandbox }));
  if (!ctx.removeProbeMut) {
    return files.length === 0
      ? { step: 4, name, ok: true, detail: `no ECEN_ProbeMut*.c file in ${where}` }
      : {
          step: 4,
          name,
          ok: false,
          detail:
            `the mutating probe pack is installed (${files.join(", ")} in ${where}); it belongs to ` +
            "S-E only: S-E's post-flight removes it with --remove-probe-mut, and until then every " +
            "other session's pre-flight refuses to launch",
        };
  }
  if (basename(resolve(sandbox)) !== SANDBOX_NAME) {
    return {
      step: 4,
      name,
      ok: false,
      detail: `refused: ${sandbox} is not the 2.0 sandbox (${SANDBOX_NAME}); nothing deleted`,
    };
  }
  if (stillRunning) {
    return {
      step: 4,
      name,
      ok: false,
      detail: "the Workbench this session started is still running; the pack is not removed",
    };
  }
  if (files.length === 0) {
    return {
      step: 4,
      name,
      ok: true,
      detail: `no ECEN_ProbeMut*.c file in ${where}; nothing to remove`,
    };
  }
  const reason = liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
  if (reason) {
    return {
      step: 4,
      name,
      ok: true,
      skipped: true,
      detail: `${reason}; would delete ${files.join(", ")} from ${where} and check they are gone`,
    };
  }
  const dir = probePackTarget(sandbox);
  for (const f of files) unlinkSync(join(dir, f));
  const left = probeMutFiles(sandbox);
  return left.length === 0
    ? { step: 4, name, ok: true, detail: `deleted ${files.join(", ")} from ${where}; none is left` }
    : {
        step: 4,
        name,
        ok: false,
        detail: `deleted ${files.join(", ")} from ${where}, but ${left.join(", ")} is still there`,
      };
}

/** Every probe-pack script installed in the sandbox (`ECEN_Probe*.c`, case ignored), sorted. */
export function probeFiles(sandboxDir: string): string[] {
  const dir = probePackTarget(sandboxDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^ECEN_Probe.*\.c$/i.test(f))
    .sort();
}

/**
 * Step 4 with `removeProbe` (S-D's post-flight): delete every `ECEN_Probe*.c` directly in
 * `<sandbox>/Scripts/WorkbenchGame/EnfusionCensus/`. Refused outside a folder named
 * `EMCP2_sandbox`, while the Workbench this lane started runs, and while ANY Workbench image runs
 * (or the process list cannot be read). After the deletion the folder is listed again; the
 * removal is recorded in `removed-probe-<stamp>.json` in the artifacts folder (names and SHA-256
 * of each file, and what is left). Nothing else in the folder is touched.
 */
export function removeProbeStep(ctx: PostflightContext, stillRunning: boolean): PostStep {
  const name = "probe pack";
  const sandbox =
    ctx.sandboxDir ?? (ctx.beforeManifest ? readManifest(ctx.beforeManifest).root : null);
  if (!sandbox) {
    return {
      step: 4,
      name,
      ok: false,
      detail: "no sandbox given (--sandbox or --before); --remove-probe removes nothing",
    };
  }
  if (basename(resolve(sandbox)) !== SANDBOX_NAME) {
    return {
      step: 4,
      name,
      ok: false,
      detail: `refused: ${sandbox} is not the 2.0 sandbox (${SANDBOX_NAME}); nothing deleted`,
    };
  }
  const where = toPlaceholders(probePackTarget(sandbox), defaultPlaceholderContext({ sandbox }));
  if (stillRunning) {
    return {
      step: 4,
      name,
      ok: false,
      detail: "the Workbench this session started is still running; the probe pack is not removed",
    };
  }
  const files = probeFiles(sandbox);
  if (files.length === 0) {
    return {
      step: 4,
      name,
      ok: true,
      detail: `no ECEN_Probe*.c file in ${where}; nothing to remove`,
    };
  }
  const reason = liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
  if (reason) {
    return {
      step: 4,
      name,
      ok: true,
      skipped: true,
      detail: `${reason}; would delete ${files.join(", ")} from ${where} once no Workbench image runs, and check they are gone`,
    };
  }
  let running: number[];
  try {
    running = processesByImage(ctx.exec, WORKBENCH_EXE).map((p) => p.pid);
  } catch (e) {
    return {
      step: 4,
      name,
      ok: false,
      detail: `could not list ${WORKBENCH_EXE} processes (${e instanceof Error ? e.message : String(e)}); nothing deleted`,
    };
  }
  if (running.length > 0) {
    return {
      step: 4,
      name,
      ok: false,
      detail: `${WORKBENCH_EXE} is running (pid ${running.join(", ")}); the probe pack is not removed while any Workbench image runs`,
    };
  }
  const dir = probePackTarget(sandbox);
  const intent = files.map((f) => ({
    file: f,
    sha256: createHash("sha256")
      .update(readFileSync(join(dir, f)))
      .digest("hex"),
  }));
  // m7: the record (intent and hashes) is written BEFORE anything is deleted, then updated after
  // each file, so an interrupted removal still says what was meant and what is gone.
  mkdirSync(ctx.artifactsDir, { recursive: true });
  const record = join(
    ctx.artifactsDir,
    `removed-probe-${ctx.now().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const removed: Array<{ file: string; sha256: string }> = [];
  let failed: { file: string; error: string } | null = null;
  const write = (status: string, left: string[] | null, flag: "wx" | "w"): void => {
    writeFileSync(
      record,
      JSON.stringify(
        {
          kind: "removed-probe",
          lane: ctx.lane.session,
          folder: where,
          status,
          intent,
          removed,
          ...(failed ? { failed } : {}),
          ...(left ? { left } : {}),
        },
        null,
        2,
      ) + "\n",
      { encoding: "utf-8", flag },
    );
  };
  write("intent", null, "wx");
  for (const f of intent) {
    try {
      (ctx.unlink ?? unlinkSync)(join(dir, f.file));
    } catch (e) {
      failed = { file: f.file, error: e instanceof Error ? e.message : String(e) };
      break;
    }
    removed.push(f);
    write("removing", null, "w");
  }
  const left = probeFiles(sandbox);
  write(left.length === 0 && !failed ? "done" : "incomplete", left, "w");
  const recordShown = toPlaceholders(record, defaultPlaceholderContext({ sandbox }));
  return left.length === 0 && !failed
    ? {
        step: 4,
        name,
        ok: true,
        detail: `deleted ${files.join(", ")} from ${where}; none is left (record ${recordShown})`,
      }
    : {
        step: 4,
        name,
        ok: false,
        detail: `deleted ${removed.map((r) => r.file).join(", ") || "nothing"} from ${where}, but ${left.join(", ")} is still there${failed ? ` (${failed.file}: ${failed.error})` : ""} (record ${recordShown})`,
      };
}

// ── Step 5: release and session log ──────────────────────────────────────────

export function releaseStep(
  ctx: PostflightContext,
  stillRunning: boolean,
): { step: PostStep; released: boolean } {
  const name = "release";
  if (stillRunning) {
    return {
      step: {
        step: 5,
        name,
        ok: false,
        detail:
          "the Workbench this session started is still running; the lease is kept so nobody adopts it. Ask the owner.",
      },
      released: false,
    };
  }
  if (!ctx.really) {
    return {
      step: {
        step: 5,
        name,
        ok: true,
        skipped: true,
        detail: `dry run; would release ${ctx.lane.session} unless a Workbench image is running`,
      },
      released: false,
    };
  }
  // Plan 5.1 guard 1: the lease is never dropped while a Workbench lives, whatever pid it
  // records (a respawn or a launcher's engine is never written into the lease).
  if (ctx.platform === "win32") {
    let running: number[];
    try {
      running = processesByImage(ctx.exec, WORKBENCH_EXE).map((p) => p.pid);
    } catch (e) {
      return {
        step: {
          step: 5,
          name,
          ok: false,
          detail:
            `could not list ${WORKBENCH_EXE} processes (${e instanceof Error ? e.message : String(e)}); ` +
            "the lease is kept",
        },
        released: false,
      };
    }
    if (running.length > 0) {
      const recorded = ctx.lane.recordedPid();
      const unrecorded = running.filter((p) => p !== recorded);
      return {
        step: {
          step: 5,
          name,
          ok: false,
          detail:
            `${WORKBENCH_EXE} is running (pid ${running.join(", ")}; the lease records ${recorded ?? "no pid"}): ` +
            "the lease is kept so nobody adopts it. " +
            (unrecorded.length > 0
              ? `pid ${unrecorded.join(", ")} was not recorded by this lane: it is ended only on the owner's ` +
                "word for this sitting (plan 5.7), after an image check. "
              : "") +
            "Ask the owner.",
        },
        released: false,
      };
    }
  }
  let r;
  try {
    r = ctx.lane.end();
  } catch (e) {
    return {
      step: { step: 5, name, ok: false, detail: e instanceof Error ? e.message : String(e) },
      released: false,
    };
  }
  return {
    step: {
      step: 5,
      name,
      ok: true,
      detail: `lease ${r.released ? "released" : "was not present"}; marker ${r.markerRemoved ? "removed" : `kept (${r.markerNote})`}`,
    },
    released: r.released,
  };
}

/** Next session number from `docs/v2/sessions/NNN-*.md` files. */
export function nextSessionNumber(dir: string): number {
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = /^(\d{3,})-.*\.md$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Session-log skeleton (plan 13.1: written in placeholder form). */
export function sessionLogSkeleton(input: {
  number: number;
  date: string;
  laneSession: string;
  report: PostflightReport;
}): string {
  const nnn = String(input.number).padStart(3, "0");
  const lines: string[] = [];
  lines.push(`# Session ${nnn}, ${input.date}`);
  lines.push("");
  lines.push(`- Lane: ${input.laneSession}`);
  lines.push("- Variant: <default | headless-cli | scratch-profile | launcher-walk>");
  lines.push("- Build: <Tools build id>");
  lines.push(`- Probe queue: docs/v2/sessions/${nnn}-queue.json`);
  lines.push("- Pre-flight: <result per step>");
  lines.push("");
  lines.push("## Probes");
  lines.push("");
  lines.push("| Probe | Expected | Result | Evidence |");
  lines.push("|---|---|---|---|");
  lines.push("| <id> | <expected> | <result> | EV-<session>-<seq> |");
  lines.push("");
  lines.push("## Post-flight");
  lines.push("");
  for (const s of input.report.steps) {
    const status = !s.ok ? "FAIL" : s.skipped ? "skipped" : "ok";
    lines.push(`- ${s.step} ${s.name} (${status}): ${s.detail.split("\n").join(" / ")}`);
  }
  lines.push(
    `- Hazard dialogs (never answered): ${input.report.hazards.length ? input.report.hazards.join(" | ") : "none"}`,
  );
  lines.push("");
  lines.push("## Observations and decisions");
  lines.push("");
  lines.push("- <what was learned; decision entries for DECISIONS.md>");
  lines.push("");
  return lines.join("\n");
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runPostflight(ctx: PostflightContext): Promise<PostflightReport> {
  const steps: PostStep[] = [];
  const runs = (n: number) => !ctx.partial || ctx.partial.includes(n);
  const notListed = (n: number, name: string): PostStep => ({
    step: n,
    name,
    ok: true,
    skipped: true,
    detail: "partial mode: not in --partial",
  });
  if (!runs(1)) steps.push(notListed(1, "net-zero"));
  else
    try {
      steps.push(netZeroStep(ctx));
    } catch (e) {
      steps.push({
        step: 1,
        name: "net-zero",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  const close = runs(2)
    ? await closeStep(ctx)
    : {
        step: notListed(2, "graceful close"),
        graceful: false,
        stillRunning: false,
        hazards: [] as string[],
        gone: false,
      };
  let graceful = close.graceful;
  // The session script closed Workbench itself and saw it exit: its record,
  // checked, makes the registry comparison valid (plan 5.3 step 2).
  if (ctx.gracefulExitEvidence && !close.graceful && !close.stillRunning) {
    const check = close.gone
      ? gracefulExitCheck(ctx, ctx.gracefulExitEvidence)
      : close.step.skipped
        ? { ok: false, detail: "would read the graceful-exit record once the pid is found gone" }
        : {
            ok: false,
            detail: "graceful-exit record not read: the close step did not find the pid gone",
          };
    if (close.gone && check.ok) graceful = true;
    close.step.detail += `; ${check.detail}`;
  }
  steps.push(close.step);
  // A process the sitting ended by force (a kill criterion or a recovery), or a step the session
  // script never finished (its Workbench's exit is unknown), makes the registry comparison not
  // valid, even when the last close was graceful or nothing was left to close. Every run folder
  // of the sitting counts: the --before manifest's and its siblings born since the lease start.
  let notValid: string | null = null;
  if (ctx.beforeManifest) {
    const folders = sittingFolders(dirname(resolve(ctx.beforeManifest)), leaseStartMs(ctx.lane));
    const kills = folders.flatMap((f) => readForcedKills(f));
    const dangling = folders.flatMap((f) => danglingStartedMarkers(f));
    const why: string[] = [];
    if (kills.length > 0) {
      why.push(
        `the sitting ended ${kills.length} process${kills.length === 1 ? "" : "es"} by force ` +
          `(${FORCED_KILLS_FILE}: ${kills.map((k) => `pid ${k.pid} by ${k.by}`).join(", ")})`,
      );
    }
    if (dangling.length > 0) {
      why.push(
        `${dangling.length} step${dangling.length === 1 ? "" : "s"} started and never finished, so how ` +
          `${dangling.length === 1 ? "its" : "their"} Workbench ended is unknown (${dangling.join(", ")})`,
      );
    }
    if (why.length > 0) {
      graceful = false;
      notValid = why.join("; ");
    }
  }
  if (!runs(3)) steps.push(notListed(3, "registry compare"));
  else
    try {
      steps.push(registryStep(ctx, graceful, notValid));
    } catch (e) {
      steps.push({
        step: 3,
        name: "registry compare",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  if (ctx.partial) {
    // Steps 4 and 5 never run in partial mode, whatever other flags say.
    steps.push({
      step: 4,
      name: "probe pack",
      ok: true,
      skipped: true,
      detail: "partial mode: the probe pack is left in place for the next launch",
    });
    steps.push({
      step: 5,
      name: "release",
      ok: true,
      skipped: true,
      detail: `partial mode: the lease of ${ctx.lane.session} is kept`,
    });
    return {
      steps,
      hazards: close.hazards,
      graceful,
      released: false,
      partial: true,
      stepsRun: [...ctx.partial],
    };
  }
  try {
    steps.push(probePackStep(ctx, close.stillRunning));
  } catch (e) {
    steps.push({
      step: 4,
      name: "probe pack",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  const rel = releaseStep(ctx, close.stillRunning);
  steps.push(rel.step);
  return { steps, hazards: close.hazards, graceful, released: rel.released };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, [
      "id",
      "before",
      "extra-before",
      "noise",
      "registry-before",
      "registry-key",
      "graceful-exit-evidence",
      "sandbox",
      "close-timeout-ms",
      "session-number",
      "partial",
      "out",
      "lease-path",
      "marker-path",
    ]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  if (!o.id) {
    console.error("postflight needs --id <lane id>");
    return 2;
  }
  let partial: number[] | undefined;
  if (o.partial !== undefined) {
    try {
      partial = parsePartialSteps(o.partial);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 2;
    }
    const clash = [
      args.flags.has("remove-probe") ? "--remove-probe" : null,
      args.flags.has("remove-probe-mut") ? "--remove-probe-mut" : null,
      o.out ? "--out" : null,
      o["session-number"] ? "--session-number" : null,
    ].filter((x): x is string => x !== null);
    if (clash.length > 0) {
      console.error(`--partial runs steps 1 to 3 only; refused with ${clash.join(", ")}`);
      return 2;
    }
  }
  // Every printed path in placeholder form (plan 5.2).
  const ph: PlaceholderContext = defaultPlaceholderContext(
    o.sandbox ? { sandbox: resolve(o.sandbox) } : {},
  );
  try {
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    const closeTimeoutMs = o["close-timeout-ms"] ? Number(o["close-timeout-ms"]) : 120_000;
    if (!Number.isInteger(closeTimeoutMs) || closeTimeoutMs <= 0) {
      throw new Error("--close-timeout-ms must be a positive integer");
    }
    const ctx: PostflightContext = {
      lane,
      really: args.flags.has("really"),
      platform: process.platform,
      beforeManifest: o.before ?? null,
      extraManifests: o["extra-before"]
        ? o["extra-before"]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      // DEC-034: the programme's expected-noise list when --noise is not given and it exists.
      ...(() => {
        const n = resolveNoiseList(o.noise);
        return { noise: n.noise, noiseSource: n.source };
      })(),
      registryBefore: o["registry-before"] ?? null,
      registryKey: o["registry-key"] ?? process.env.ENFUSION_WB_REGISTRY_KEY ?? null,
      gracefulExitEvidence: o["graceful-exit-evidence"] ?? null,
      sandboxDir: o.sandbox ?? null,
      removeProbeMut: args.flags.has("remove-probe-mut"),
      removeProbe: args.flags.has("remove-probe"),
      partial,
      closeTimeoutMs,
      artifactsDir: artifactsDir(),
      exec: defaultExec,
      powershell: (script, env) =>
        runPowerShell(script, { env, timeoutMs: closeTimeoutMs + 30_000 }),
      windowTitles: async (pid) => (await inspectProcessWindows(pid)).windowTitles,
      now: () => new Date(),
    };
    const report = await runPostflight(ctx);
    if (partial) {
      for (const s of report.steps) {
        console.error(
          toPlaceholders(
            `[${!s.ok ? "FAIL" : s.skipped ? "skip" : "ok  "}] ${s.step} ${s.name}: ${s.detail}`,
            ph,
          ),
        );
      }
      console.log(
        `partial post-flight, lease kept (steps run: ${report.stepsRun?.join(",")}; released: false)`,
      );
      return report.steps.every((s) => s.ok) ? 0 : 1;
    }
    const sessionsDir = join(REPO_ROOT, "docs", "v2", "sessions");
    const number = o["session-number"]
      ? Number(o["session-number"])
      : nextSessionNumber(sessionsDir);
    const date = ctx.now().toISOString().slice(0, 10);
    const log = toPlaceholders(
      sessionLogSkeleton({ number, date, laneSession: lane.session, report }),
      ph,
    );
    for (const s of report.steps) {
      console.error(
        toPlaceholders(
          `[${!s.ok ? "FAIL" : s.skipped ? "skip" : "ok  "}] ${s.step} ${s.name}: ${s.detail}`,
          ph,
        ),
      );
    }
    if (o.out) {
      writeFileSync(o.out, log, { encoding: "utf-8", flag: "wx" });
      console.log(`session log skeleton written to ${toPlaceholders(o.out, ph)}`);
    } else {
      process.stdout.write(log);
    }
    return report.steps.every((s) => s.ok) ? 0 : 1;
  } catch (e) {
    console.error(toPlaceholders(e instanceof Error ? e.message : String(e), ph));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
