/**
 * Session S-B: the scratch-profile bootstrap (plan 8 Phase 2 table; plan 5.3
 * "Pre-flight variants", scratch-profile; plan 7 U12 and U35; the crash-report
 * flags). One dedicated launch. Nothing else rides on it: no handler install,
 * no probe pack, one native NET call.
 *
 * DRY RUN BY DEFAULT. Without --really the script touches nothing: it prints
 * the session plan and the ACTION PLAN (the JSON array `scripts/live/dry-run.ts`
 * checks) and writes the action plan to --out. A real run needs --really, a
 * win32 host and the lease already held by the lane given with --id (the gate
 * of `cli.ts`, the same one every harness script uses). It is run only by the
 * main session, with the owner present, after the owner's go for S-B.
 *
 * The real run, in order (each step writes one evidence record through the
 * evidence writer, with placeholders, naming the probe ids it answers, into
 * `<artifacts>/sessions/S-B/<stamp>/evidence/`):
 *
 *   0 sandbox       refused unless the sandbox folder is `<addons>\EMCP2_sandbox`
 *                   directly under the configured addons folder and the project
 *                   is `<that folder>\EMCP2_sandbox.gproj` (plan 5.1): the harness
 *                   never launches the owner's own projects.
 *   1 pre-flight    steps 1 to 7 of `preflight.ts` (scratch-profile variant)
 *                   through its own step functions. Step 5 is the one place a
 *                   registry key is exported; this file only consumes that file.
 *                   Deviation, recorded for the main session: the export (step
 *                   5) and the after-export (post-flight step 3) are `reg export`
 *                   reads run inside this process by the harness's own pre-flight
 *                   and post-flight code, behind the same live gate; this file
 *                   holds no registry call of its own. The file-only route now
 *                   exists (`preflight.ts --until 7` prints the export,
 *                   `postflight.ts --graceful-exit-evidence` accepts a close the
 *                   session saw), but this script keeps the in-process steps
 *                   (DEC-029): the U12 verdict needs the after-export inside the
 *                   sitting, which the file route would move to a later
 *                   invocation, and the step-4 abort paths close and compare in
 *                   the same flow.
 *   2 scratch ini   the ini is built from the step-5 export: every path and
 *                   personal value scrubbed, the NET API keys kept, written to
 *                   the run folder. Kill: no `Workbench\NetAPI_Enabled` in the
 *                   export, the API disabled there, or the personal-data gate.
 *   3 launch        `-gproj <sandbox> -forceSettings <ini>` plus the crash-report
 *                   flags (-disableCrashReport, -noThrow; -silentCrashReport only
 *                   with --owner-go-silent-crash-report, see below). Spawned
 *                   once; the pid is recorded in the lease.
 *   4 assert        the opened project is read from the new session log (E13's
 *                   pattern unless --opened-project-pattern). Another project:
 *                   abort, close through the post-flight WM_CLOSE path, compare
 *                   the registry, stop. No line before the deadline: the timeout
 *                   path (below); if the launcher window is up (the sandbox is
 *                   new to the launcher under the scratch profile) it is the
 *                   step-9 abort instead: close it gracefully, compare, stop.
 *   5 NET ready     wait until the started pid listens on the NET port (read
 *                   from the listener table, no NET call), then list its windows
 *                   (first-run dialog check). The launcher or the missing-
 *                   dependencies modal stops the session for the main session.
 *   6 NET call      ONE call of the native `IsWorkbenchRunning` (no handler
 *                   needed; E04 NetApiDocs.c, E05 executable string; DEC-024).
 *   7 close         post-flight step 2: CloseMainWindow on the started pid only,
 *                   wait with a timeout; a window still open is a hazard dialog,
 *                   reported and never answered; then the CrashReporter check.
 *   8 registry      post-flight step 3 exports the key again (its code, not
 *                   this file's); the two exports are compared by a pure
 *                   function and every difference is reported. Valid only after
 *                   the graceful exit of step 7.
 *   9 ini back      did Workbench write the scratch ini back at exit?
 *  10 verdict       U12 per criterion; the plan's branch when it fails.
 *
 * Plan 5.3 "During", to the letter: one call at a time; on ANY timeout no
 * retry: capture the desktop (capture.ts), list the top-level windows
 * (EnumWindows: class, title, owner pid), write both, and stop for the main
 * session with Workbench left as it is and the lease kept. That includes the
 * close timeout of step 7 and a window probe that fails or times out (an empty
 * window list is never read as "no dialog"). An exception after the run folder
 * exists is recorded as a STOP evidence record with its step; the report still
 * carries the run folder, the started pid and the registry-before path. No key is ever
 * pressed: this file sends no keystroke, no Enter, no accelerator, and posts
 * no window message other than the post-flight's CloseMainWindow. The session
 * run never terminates a process: the scratch-profile variant names no kill.
 * The recorded recovery is the `recover` subcommand (the shared one of
 * `session-common.ts`, DEC-032): the lease's pid, its image, its creation time
 * against `<run>/S-B.started`, one process at a time and never a tree flag, a
 * forced-kill record, three per sitting. U35 is observed on the next start
 * after such a kill; this script never kills to observe it. The lease is not
 * released here: `postflight.ts` does the net-zero check and the release
 * afterwards.
 *
 * One launch per sitting (DEC-032, S-B read M2): `<run>/S-B.started` is written
 * before the spawn (the pid and its creation time after it) and `<run>/S-B.json`
 * when the run ends. Before anything is exported the run is refused while the
 * lease records a Workbench pid (a stopped S-B's Workbench: recover first), and
 * while a started marker of S-B exists in any run folder of the sitting, unless
 * the owner acknowledged a repeat (`--owner-ack-repeat`). It is refused too
 * unless EVERY launcher project list names the sandbox (OA-3 in both ways,
 * DEC-031 M-1): the launch is a direct start with working directory `<game>`.
 * The real invocation's worst case is `invocationWorstCaseMs` (an estimate);
 * the runbook runs it as a background command with a timeout above it, and its
 * last line is `S-B done` or `STOPPED`.
 *
 * -silentCrashReport: Bohemia documents it as sending the crash report
 * automatically without any prompt (E07, E08). A crash report carries the
 * session logs and the settings dump. It is therefore not added unless the
 * owner gave an explicit go for that in chat for this sitting, passed as
 * --owner-go-silent-crash-report. -disableCrashReport (the report is cancelled)
 * and -noThrow (no error dialogs) ride by default, as plan 7 U12 says.
 *
 * Every operation that touches a process, a socket, the registry (through the
 * pre-flight and post-flight code), the desktop, or a file outside the
 * artifacts folder goes through `SessionDeps`, so the whole control flow runs
 * against mocks in `tests/live-harness/s-b-scratch-profile.test.ts`.
 *
 * [unverified]: the QSettings ini format Workbench reads with -forceSettings
 * (built here to Qt's IniFormat rules: [General] for the root, group names and
 * keys escaped, sub-keys joined with a backslash, values as QSettings writes a
 * string); that the registry key below is the whole settings store (E06 read an
 * export of it); that E13's autosave line names the opened project by its addon
 * folder name; the Workbench main window title.
 *
 * Usage:
 *   npx --no tsx scripts/live/s-b-scratch-profile.ts [--out <plan.json>]
 *       [--preview-from <file.reg>]                    (dry run, the default)
 *   npx --no tsx scripts/live/s-b-scratch-profile.ts --really --id <lane id>
 *       --registry-key <HKCU\...> (required: never taken from the environment)
 *       [--queue docs/v2/sessions/queues/S-B-queue.json]
 *       [--sandbox <dir>] [--gproj <file>] [--addons-path <addons>]
 *       [--workbench-path <tools>] [--game-path <game>]
 *       [--logs-path <dir>] [--port 5775] [--opened-project-pattern <regex>]
 *       [--assert-timeout-ms 180000] [--net-ready-timeout-ms 120000]
 *       [--net-call-timeout-ms 30000] [--close-timeout-ms 120000] [--poll-ms 2000]
 *       [--owner-go-silent-crash-report] [--after-forced-kill] [--owner-ack-repeat]
 *       [--lease-path <file>] [--marker-path <file>]
 *   npx --no tsx scripts/live/s-b-scratch-profile.ts recover --run <run dir> --id <lane id>
 *       [--owner-go <pid>] [--really]
 * Exit: 0 completed or dry run (the verdict is printed; it may be a fail), 1
 * stopped or refused, 2 usage.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import {
  LAUNCHER_WINDOW_TITLE,
  MISSING_DEPS_WINDOW_TITLE,
  inspectProcessWindows,
} from "../../src/workbench/launcher-nudge.js";
import {
  decodeRegText,
  gateScan,
  parseRegText,
  personalContextFromEnv,
  personalReason,
  subtreeReason,
  type PersonalContext,
  type RegExport,
  type RegValue,
} from "../census/enumerators/e06-settings-store.js";
import { OPENED_PROJECT_PATTERN, parseLogLine } from "../census/enumerators/e13-launch-logs.js";
import { captureDesktop, type CaptureResult } from "./capture.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { writeEvidence } from "./evidence.js";
import { Lane } from "./lane.js";
import {
  WORKBENCH_EXE,
  buildLaunch,
  defaultSandboxGproj,
  formatCommandLine,
  spawnWorkbench,
  type LaunchPlan,
} from "./launch.js";
import { netCall, type NetCallOptions, type NetCallResult } from "./netcall.js";
import {
  DECOY_NAME,
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import {
  deniedApi,
  deniedApiNames,
  deniedSwitch,
  loadPolicy,
  type CensusPolicy,
} from "./policy.js";
import {
  closeStep,
  leaseStartMs,
  registryStep,
  type PostflightContext,
  type PostStep,
} from "./postflight.js";
import { runPowerShell, lastLine, type PowerShellResult } from "./powershell.js";
import {
  newestSessionLog,
  openedProjectFromLog,
  runPreflight,
  stepLease,
  stepPortOwner,
  stepProbeQueue,
  stepRegistryExport,
  stepSnapshot,
  stepToolsBuild,
  stepWorkbenchRunning,
  type PreflightContext,
  type PreflightStep,
  type StepResult,
} from "./preflight.js";
import {
  childWorkbenchRows,
  defaultRecoverDeps,
  listsLine,
  profileDirOf,
  readProcessTable,
  readProjectLists,
  registration,
  runRecover,
  sittingStartedMarkers,
  startedMarkerPath,
  summarizeLists,
  writeStartedMarker,
  type ListSummary,
  type ProcRow,
  type ProjectListFile,
  type RecoverDeps,
} from "./session-common.js";
import { sha256File } from "./snapshot.js";
import {
  CRASH_REPORTER_IMAGE,
  defaultExec,
  portListeners,
  processByPid,
  processesByImage,
  type ExecFn,
} from "./win.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Session id of this sitting (evidence ids `EV-S-B-<seq>` in the run folder). */
export const SESSION = "S-B";

/** This script, as the dry-run checker and policy exceptions name it. */
export const SCRIPT_PATH = "scripts/live/s-b-scratch-profile.ts";

/** The session's probe queue (plan 5.3 pre-flight step 7). */
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "S-B-queue.json");

/**
 * The Workbench settings key. E06 read an export of exactly this key (its
 * header); preflight.ts still calls the name [unverified] and takes it as an
 * argument, so --registry-key overrides it.
 */
export const DEFAULT_REGISTRY_KEY = "HKCU\\Software\\Bohemia Interactive\\Arma Reforger Workbench";

/** The one native call: no handler needed, no parameters, read-only (E04, E05, DEC-024). */
export const NATIVE_CALL = "IsWorkbenchRunning";

/** Crash-report flags that ride on the launch by default (plan 7 U12). */
export const CRASH_FLAGS: readonly string[] = ["-disableCrashReport", "-noThrow"];

/** Sends the crash report without a prompt (E07, E08): only with the owner's go. */
export const SILENT_CRASH_FLAG = "-silentCrashReport";

/** Registry section and value-name prefix of the NET API settings (E06: `Workbench\NetAPI_Enabled`). */
export const NET_API_SECTION = "Workbench";
export const NET_API_ENABLED = "NetAPI_Enabled";
const NET_API_NAME = /^NetAPI_/i;

/** Probe ids this sitting answers (docs/v2/sessions/probe-schedule.md, S-B). */
export const PROBES = {
  u12: ["P-U12", "P-E01-gui-census-feasibility-L693", "P-E01-mcp-inventory-L273"],
  format: "P-E01-resource-manager-L685",
  isolation: "P-E01-plugins-netapi-cli-L466",
  store: "P-E01-script-string-dialogue-L420",
  crashOrphan: "P-E01-mcp-inventory-L345",
  u35: "P-U35",
  crashFlags: "P-SB-crash-report-flags",
} as const;

export const DEFAULT_TIMEOUTS = {
  /** Spawn to the session-log line that names the opened project. */
  assertMs: 180_000,
  /** Opened project to the started pid listening on the NET port. */
  netReadyMs: 120_000,
  /** The one NET call. */
  netCallMs: 30_000,
  /** CloseMainWindow to process exit (post-flight default). */
  closeMs: 120_000,
  /** Poll interval of the two waits (a file and the listener table; never a NET call). */
  pollMs: 2_000,
};

export type Timeouts = typeof DEFAULT_TIMEOUTS;

/** The step name of S-B's started marker and result file: `<run>/S-B.started`, `<run>/S-B.json`. */
export const MARKER_STEP = SESSION;

/**
 * An ESTIMATE of what the real invocation adds to its own waits: pre-flight steps 1 to 7
 * (PowerShell 30 s, tasklist, netstat and reg export 20 s each), the launcher-list reads, the
 * process-table reads (30 s each), the polls' own tasklist and netstat (20 s each), the window
 * lists (30 s), the capture and window list on a timeout, and the after-export. Not a bound
 * (DEC-032, S-B read M1).
 */
export const INVOCATION_MARGIN_MS = 350_000;

/**
 * The real invocation's worst case: the four waits (the close as the PowerShell runner allows
 * it) plus `INVOCATION_MARGIN_MS`. 830 s with the defaults: above the caller's 600 s foreground
 * cap, so the runbook runs it in the background with a timeout above this.
 */
export function invocationWorstCaseMs(t: Timeouts = DEFAULT_TIMEOUTS): number {
  return (
    t.assertMs + t.netReadyMs + t.netCallMs + powershellTimeoutMs(t.closeMs) + INVOCATION_MARGIN_MS
  );
}

/** The real run's last line when it completed; any other end prints a line starting `STOPPED`. */
export const DONE_LINE = "S-B done";

// ── The scratch ini (pure) ───────────────────────────────────────────────────

/** Why building the scratch ini was refused. The session stops before any launch. */
export class ScrubRefusal extends Error {}

export interface ScratchIni {
  /** The ini text (UTF-8, CRLF line ends). */
  text: string;
  /** Section names in the order written (escaped). */
  sections: string[];
  /** NET API values carried, by name (non-personal scalars). */
  netApi: Record<string, string>;
  kept: number;
  /** Dropped values by reason. */
  dropped: Record<string, number>;
}

const HEX = "0123456789ABCDEF";

/** A key or group name as QSettings IniFormat escapes it [unverified against Workbench]. */
export function iniEscapedKey(key: string): string {
  let out = "";
  for (const c of key) {
    const ch = c.codePointAt(0)!;
    if (c === "/") out += "\\";
    else if (/[A-Za-z0-9_.-]/.test(c)) out += c;
    else if (ch <= 0xff) out += "%" + HEX[ch >> 4] + HEX[ch & 15];
    else if (ch <= 0xffff) out += "%U" + ch.toString(16).toUpperCase().padStart(4, "0");
    else {
      for (let i = 0; i < c.length; i++) {
        out += "%U" + c.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
      }
    }
  }
  return out;
}

/** A string value as QSettings IniFormat writes it [unverified against Workbench]. */
export function iniEscapedString(s: string): string {
  let out = "";
  let needsQuotes = false;
  let escapeNextIfDigit = false;
  for (const c of s) {
    const ch = c.codePointAt(0)!;
    if (c === ";" || c === "," || c === "=") needsQuotes = true;
    if (escapeNextIfDigit && /[0-9A-Fa-f]/.test(c)) {
      out += "\\x" + ch.toString(16);
      continue;
    }
    escapeNextIfDigit = false;
    switch (c) {
      case "\0":
        out += "\\0";
        escapeNextIfDigit = true;
        break;
      case "\x07":
        out += "\\a";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\v":
        out += "\\v";
        break;
      case '"':
      case "\\":
        out += "\\" + c;
        break;
      default:
        if (ch <= 0x1f || ch === 0x7f) {
          out += "\\x" + ch.toString(16);
          escapeNextIfDigit = true;
        } else {
          out += c;
        }
    }
  }
  if (needsQuotes || out.startsWith(" ") || out.endsWith(" ")) out = `"${out}"`;
  return out;
}

/** Section name of a registry key path: the root's values go to [General]. */
export function iniSection(segments: readonly string[]): string {
  if (segments.length === 0) return "General";
  const head = iniEscapedKey(segments[0]);
  return head === "General" ? "%General" : head;
}

/** The scalar text of a value the ini carries, or null for a type it does not carry. */
export function scalarText(v: RegValue): string | null {
  switch (v.type) {
    case "REG_SZ":
      return v.text ?? "";
    case "REG_DWORD":
      return String(parseInt(v.text ?? "0", 16) >>> 0);
    case "REG_QWORD":
      return v.bytes && v.bytes.length === 8 ? v.bytes.readBigUInt64LE(0).toString() : null;
    default:
      return null;
  }
}

/**
 * A recent-items list or history, under any spelling (key segment or value name): recent, MRU,
 * history, and since DEC-032 (S-B read m7) a last-opened project, world or file list
 * (`LastOpenedProjects`, `lastWorld`, `opened`).
 */
const RECENT_LIST = /recent|mru|history|last.*(project|opened|world)|opened/i;

/** A value name that holds an identity rather than a setting (a Steam account, a user id). */
const IDENTITY_NAME = /steam|account|userid|user_id|\bsid\b/i;

/**
 * Why a key path (segments, unescaped) is dropped as a whole on its shape, or
 * null: a recent-items list under any spelling, a drive segment (`D:` when a
 * path was split into key segments) or an empty segment (a UNC prefix split
 * the same way).
 */
export function keyShapeReason(segs: readonly string[]): string | null {
  if (segs.some((s) => RECENT_LIST.test(s))) return "recent-list";
  if (segs.some((s) => /^[A-Za-z]:$/.test(s))) return "drive-segment";
  if (segs.some((s) => s === "")) return "unc-segment";
  return null;
}

/**
 * Why a value text is dropped on its shape, or null: a UNC path (another
 * machine), a GUID or device id, a long hex id, or a base64-like blob (which
 * may encode a path). Values that are plain words, numbers or flags pass.
 */
export function identifierReason(text: string): string | null {
  const t = text.trim();
  if (
    /^\\\\/.test(t) ||
    /(^|[\s"'=])\/\/[A-Za-z0-9_.-]+\//.test(t) ||
    /\\\\[A-Za-z0-9_.-]+\\/.test(t)
  )
    return "unc-path";
  if (/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(t))
    return "guid";
  if (/^(0x)?[0-9a-f]{16,}$/i.test(t)) return "long-hex-id";
  // DEC-032 (S-B read m7): a SteamID3, a Windows SID, an IPv4 address.
  if (/\[U:\d+:\d+\]/i.test(t)) return "steamid3";
  if (/\bS-1-5-21(-\d+){1,}/i.test(t)) return "windows-sid";
  if (/\b(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/.test(t)) return "ipv4";
  if (
    t.length >= 16 &&
    t.length < 24 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(t) &&
    /[0-9]/.test(t) &&
    /[A-Z]/.test(t) &&
    /[a-z]/.test(t)
  )
    return "short-base64-like";
  if (
    t.length >= 24 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(t) &&
    (/[0-9+/]/.test(t) || t.endsWith("=")) &&
    /[A-Z]/.test(t) &&
    /[a-z]/.test(t)
  )
    return "base64-like";
  return null;
}

/**
 * A percent-encoded value decoded (a path written as `C%3A%5CUsers%5C...`), or null when it holds
 * no escape or does not decode. The personal-data rules then see the decoded text too.
 */
export function percentDecoded(text: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Build the scratch ini from a parsed registry export (pre-flight step 5's
 * file). Pure: the personal context and the placeholder context are inputs.
 *
 * Kept: REG_SZ, REG_DWORD and REG_QWORD values whose key path, name and text
 * hold nothing personal. Dropped and counted: E06's excluded subtrees (recent
 * files, world-path-keyed, file-id-keyed, user-named layouts), any recent,
 * MRU or history list under another spelling, every personal hit (path, file
 * name, account or machine name, e-mail, Steam id) in a key
 * segment, in the whole unescaped key path, in the value name or in the text,
 * a key path that holds a drive or UNC segment, a value shaped like a UNC
 * path, a GUID, a long hex id or a base64 blob, key default values, and the
 * types this file does not convert (REG_BINARY such as QMainWindow layout
 * states, REG_MULTI_SZ such as plugin settings, REG_EXPAND_SZ). The NET API
 * values of `Workbench` are kept as exported.
 *
 * The final gate (E06's output gate, the known-path check) runs twice: on the escaped ini text and on the same entries written
 * unescaped (`key\path\name=value`), because escaping hides a `:` or a space
 * from the gate.
 *
 * Throws ScrubRefusal when the export holds no `Workbench\NetAPI_Enabled`, when
 * it is not enabled there (enabling it would be a settings write, U22, and is
 * not this session's), or when the finished text fails the personal-data gate.
 */
export function buildScratchIni(
  reg: RegExport,
  personal: PersonalContext,
  placeholders: PlaceholderContext,
): ScratchIni {
  const dropped: Record<string, number> = {};
  const drop = (why: string): void => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };
  // E06's personal-data rules (the owner-pattern check was removed with the PII gate, DEC-060).
  const reasonOf = (text: string): string | null => personalReason(text, personal);
  const bySection = new Map<string, Array<[string, string]>>();
  const rawLines: string[] = [];
  const netApi: Record<string, string> = {};
  let kept = 0;
  for (const key of reg.keys) {
    const segs = key.segments;
    const subtree = subtreeReason(segs) ?? keyShapeReason(segs);
    const segReason =
      segs.map(reasonOf).find((r) => r !== null) ??
      (segs.length ? reasonOf(segs.join("\\")) : null);
    for (const v of key.values) {
      if (subtree) {
        drop(subtree);
        continue;
      }
      if (segReason) {
        drop(`personal-key:${segReason}`);
        continue;
      }
      if (v.name === "") {
        drop("default-value");
        continue;
      }
      if (RECENT_LIST.test(v.name)) {
        drop("recent-list");
        continue;
      }
      const nameReason = reasonOf(v.name) ?? reasonOf([...segs, v.name].join("\\"));
      if (nameReason) {
        drop(`personal-name:${nameReason}`);
        continue;
      }
      const text = scalarText(v);
      if (text === null) {
        drop(`type:${v.type}`);
        continue;
      }
      const textReason =
        reasonOf(text) ?? identifierReason(text) ?? reasonOf(percentDecoded(text) ?? "");
      if (textReason) {
        drop(`personal-value:${textReason}`);
        continue;
      }
      if (IDENTITY_NAME.test(v.name)) {
        // A bare number under a Steam or account name (a 32-bit account id) looks like any
        // setting; the name tells it apart (DEC-032, S-B read m7).
        drop("personal-name:identity-name");
        continue;
      }
      const section = iniSection(segs);
      const iniKey = [...segs.slice(1), v.name].map(iniEscapedKey).join("\\");
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section)!.push([iniKey, iniEscapedString(text)]);
      rawLines.push(`${[...segs, v.name].join("\\")}=${text}`);
      if (
        segs.length === 1 &&
        segs[0].toLowerCase() === NET_API_SECTION.toLowerCase() &&
        NET_API_NAME.test(v.name)
      ) {
        netApi[v.name] = text;
      }
      kept++;
    }
  }
  const enabled = netApi[NET_API_ENABLED];
  if (enabled === undefined) {
    throw new ScrubRefusal(
      `the export holds no ${NET_API_SECTION}\\${NET_API_ENABLED}: S-B cannot test that the scratch ` +
        "profile keeps the NET API enabled. Writing the key is a settings write (U22); ask the owner.",
    );
  }
  if (!/^(1|true)$/i.test(enabled.trim())) {
    throw new ScrubRefusal(
      `${NET_API_SECTION}\\${NET_API_ENABLED} is "${enabled}" in the export: the NET API is not ` +
        "enabled in the owner's settings. Enabling it is a settings write (U22); ask the owner.",
    );
  }
  const lines: string[] = [];
  const sections = [...bySection.keys()];
  for (const section of sections) {
    if (lines.length > 0) lines.push("");
    lines.push(`[${section}]`);
    const entries = bySection
      .get(section)!
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [k, val] of entries) lines.push(`${k}=${val}`);
  }
  const text = lines.join("\r\n") + "\r\n";
  // The same gate on the escaped text and on the unescaped entries.
  for (const [what, gated] of [
    ["the scratch ini", text],
    ["the scratch ini (unescaped)", rawLines.join("\n")],
  ] as const) {
    const hits = gateScan(gated, personal);
    if (hits.length > 0) {
      throw new ScrubRefusal(`${what} failed the personal-data gate: ${hits.join(", ")}`);
    }
    if (toPlaceholders(gated, placeholders) !== gated) {
      throw new ScrubRefusal(`${what} still holds a known absolute path`);
    }
  }
  return { text, sections, netApi, kept, dropped };
}

// ── Registry comparison (pure) ───────────────────────────────────────────────

export type RegChange =
  | "key-added"
  | "key-removed"
  | "value-added"
  | "value-removed"
  | "value-changed";

export interface RegDifference {
  change: RegChange;
  /** Key path below the Workbench root, segments joined with `\`; personal segments redacted. */
  key: string;
  value?: string;
  type?: string;
  before?: string;
  after?: string;
}

/**
 * One string as evidence may show it: `<redacted: reason>` when E06's rules
 * find anything personal in it, else unchanged. Pure.
 */
export function redact(text: string, personal: PersonalContext): string {
  const why = personalReason(text, personal);
  return why ? `<redacted: ${why}>` : text;
}

/**
 * Free text (a detail line, a JSON file) with every account or machine name
 * replaced in place. The last net before anything reaches the run folder;
 * paths are left to toPlaceholders.
 */
export function scrubFreeText(text: string, personal: PersonalContext): string {
  let out = text;
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [names, label] of [
    [personal.accountNames, "<account>"],
    [personal.hostNames, "<machine>"],
  ] as const) {
    for (const n of names) {
      if (n.length >= 3) out = out.replace(new RegExp(escape(n), "gi"), label);
    }
  }
  return out;
}

function keyLabel(segments: readonly string[], personal: PersonalContext): string {
  return segments.length === 0 ? "(root)" : segments.map((s) => redact(s, personal)).join("\\");
}

function valueFingerprint(v: RegValue): string {
  const scalar = scalarText(v);
  if (scalar !== null) return `${v.type}:${scalar}`;
  const b = v.bytes ?? Buffer.from(v.text ?? "", "utf-8");
  return `${v.type}:${createHash("sha256").update(b).digest("hex")}`;
}

function valueDisplay(v: RegValue, personal: PersonalContext): string {
  const scalar = scalarText(v);
  if (scalar !== null) return redact(scalar, personal);
  const b = v.bytes ?? Buffer.alloc(0);
  return `<${v.type}, ${b.length} bytes, sha256 ${createHash("sha256").update(b).digest("hex").slice(0, 12)}>`;
}

/**
 * Every difference between two parsed exports of the Workbench key: keys
 * added and removed, values added, removed and changed (type or data). Pure.
 * Key segments, value names and scalar data are shown only when E06's rules
 * find nothing personal in them.
 */
export function diffRegistryExports(
  before: RegExport,
  after: RegExport,
  personal: PersonalContext,
): RegDifference[] {
  const index = (
    r: RegExport,
  ): Map<string, { segments: string[]; values: Map<string, RegValue> }> => {
    const m = new Map<string, { segments: string[]; values: Map<string, RegValue> }>();
    for (const k of r.keys) {
      const id = k.segments.join("\\").toLowerCase();
      const entry = m.get(id) ?? { segments: k.segments, values: new Map<string, RegValue>() };
      for (const v of k.values) entry.values.set(v.name.toLowerCase(), v);
      m.set(id, entry);
    }
    return m;
  };
  const a = index(before);
  const b = index(after);
  const out: RegDifference[] = [];
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
  for (const id of ids) {
    const ka = a.get(id);
    const kb = b.get(id);
    const label = keyLabel((ka ?? kb)!.segments, personal);
    if (!ka) out.push({ change: "key-added", key: label });
    if (!kb) out.push({ change: "key-removed", key: label });
    const names = [...new Set([...(ka?.values.keys() ?? []), ...(kb?.values.keys() ?? [])])].sort();
    for (const n of names) {
      const va = ka?.values.get(n);
      const vb = kb?.values.get(n);
      const name = redact((va ?? vb)!.name || "(default)", personal);
      if (va && !vb) {
        out.push({
          change: "value-removed",
          key: label,
          value: name,
          type: va.type,
          before: valueDisplay(va, personal),
        });
      } else if (!va && vb) {
        out.push({
          change: "value-added",
          key: label,
          value: name,
          type: vb.type,
          after: valueDisplay(vb, personal),
        });
      } else if (va && vb && valueFingerprint(va) !== valueFingerprint(vb)) {
        out.push({
          change: "value-changed",
          key: label,
          value: name,
          type: va.type === vb.type ? va.type : `${va.type} -> ${vb.type}`,
          before: valueDisplay(va, personal),
          after: valueDisplay(vb, personal),
        });
      }
    }
  }
  return out;
}

// ── Opened project and windows (pure) ────────────────────────────────────────

const normPath = (p: string): string => resolve(p).replace(/\\/g, "/").toLowerCase();

/**
 * True when the value the opened-project pattern captured names the sandbox
 * and nothing else: the name `EMCP2_sandbox` (E13's pattern captures the
 * folder under `Projects`, a name, not a path), or a `.gproj` path equal to
 * `gproj` whose stem is `EMCP2_sandbox`. The launched project's own name is
 * never accepted on its own: the check is against the sandbox, not against
 * whatever was launched.
 */
export function namesSandbox(opened: string, gproj: string): boolean {
  const o = opened.trim();
  if (/\.gproj$/i.test(o)) {
    return (
      normPath(o) === normPath(gproj) &&
      basename(o)
        .replace(/\.gproj$/i, "")
        .toLowerCase() === SANDBOX_NAME.toLowerCase()
    );
  }
  return o.toLowerCase() === SANDBOX_NAME.toLowerCase();
}

/**
 * Why a run on these paths is refused (plan 5.1: the harness drives only the
 * 2.0 sandbox addon), or null. The sandbox folder must be named
 * `EMCP2_sandbox` and sit directly in the configured addons folder, and the
 * project must be `<sandbox>\EMCP2_sandbox.gproj`. Pure.
 */
export function sandboxRefusal(
  sandboxDir: string,
  gproj: string,
  addonsPath: string,
): string | null {
  if (basename(resolve(sandboxDir)).toLowerCase() !== SANDBOX_NAME.toLowerCase()) {
    return `the sandbox folder is not named ${SANDBOX_NAME}: S-B launches only the 2.0 sandbox (plan 5.1)`;
  }
  if (normPath(dirname(resolve(sandboxDir))) !== normPath(addonsPath)) {
    return `the sandbox folder is not directly in the configured addons folder: S-B launches only <addons>\\${SANDBOX_NAME} (plan 5.1)`;
  }
  if (normPath(gproj) !== normPath(join(sandboxDir, `${SANDBOX_NAME}.gproj`))) {
    return `the project is not <sandbox>\\${SANDBOX_NAME}.gproj: S-B launches only the 2.0 sandbox (plan 5.1)`;
  }
  return null;
}

export interface TopWindow {
  pid: number;
  className: string;
  title: string;
  /** The owner window handle (0: unowned); absent from older rows. */
  owner?: number;
  /** False for a hidden window; the script lists visible windows only, so absent means visible. */
  visible?: boolean;
}

/**
 * The visible top-level windows of `pids` as the first-run-dialog check reads them (DEC-032, S-B
 * read M4): hidden windows (a GUI thread's IME windows, "Default IME", "MSCTFIME UI") never count.
 */
export function visibleWindowsOf(rows: readonly TopWindow[], pids: readonly number[]): TopWindow[] {
  return rows.filter((r) => pids.includes(r.pid) && r.visible !== false);
}

/**
 * The window list as evidence: titles are kept only for the processes this
 * session cares about (the Workbench it started, CrashReporter); every other
 * window keeps its class and pid, with the title withheld (personal data).
 */
export function windowsForEvidence(
  rows: readonly TopWindow[],
  ours: readonly number[],
): TopWindow[] {
  return rows.map((r) => (ours.includes(r.pid) ? r : { ...r, title: "<other process: withheld>" }));
}

/** PowerShell: every visible top-level window as JSON lines {pid, className, title}. Reads only. */
export const TOP_WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;",
  "public static class EmcpTopWindows {",
  "  private delegate bool EnumProc(IntPtr h, IntPtr l);",
  '  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);',
  '  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder sb, int n);',
  '  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);',
  "  public static List<string[]> Run() {",
  "    var rows = new List<string[]>();",
  "    EnumWindows(delegate(IntPtr h, IntPtr l) {",
  "      if (!IsWindowVisible(h)) return true;",
  "      uint pid; GetWindowThreadProcessId(h, out pid);",
  "      var t = new StringBuilder(512); GetWindowText(h, t, 512);",
  "      var c = new StringBuilder(256); GetClassName(h, c, 256);",
  "      rows.Add(new string[] { pid.ToString(), c.ToString(), t.ToString(), GetWindow(h, 4).ToInt64().ToString() });",
  "      return true;",
  "    }, IntPtr.Zero);",
  "    return rows;",
  "  }",
  "}",
  "'@",
  "$out = @(foreach ($r in [EmcpTopWindows]::Run()) { [pscustomobject]@{ pid = [int]$r[0]; className = $r[1]; title = $r[2]; owner = [long]$r[3]; visible = $true } })",
  "ConvertTo-Json -Compress -InputObject $out",
].join("\n");

/** Parse the output of TOP_WINDOWS_SCRIPT. */
export function parseTopWindows(stdout: string): TopWindow[] {
  const line = lastLine(stdout);
  if (!line) return [];
  const raw = JSON.parse(line) as unknown;
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      pid: Number(r.pid),
      className: String(r.className ?? ""),
      title: String(r.title ?? ""),
      owner: Number(r.owner ?? 0),
      visible: r.visible !== false,
    }));
}

// ── U12 verdict (pure) ───────────────────────────────────────────────────────

export type CriterionResult = "pass" | "fail" | "not-observed" | "review";

export interface U12Observations {
  /** The opened project was the sandbox (null: never read). */
  openedSandbox: boolean | null;
  /** The launcher window held at its picker instead of opening the project. */
  launcherHeld: boolean | null;
  /** Titles of the started pid's windows once the NET port was open (null: not listed). */
  windowsAtReady: string[] | null;
  /** The native call answered (null: not made). */
  netAnswered: boolean | null;
  /** Workbench exited after CloseMainWindow (null: no close attempted). */
  graceful: boolean | null;
  /** Registry differences (null: not compared, or not valid). */
  registryDiff: RegDifference[] | null;
  /** The flags after the proven launch form (the -noThrow confound is stated when on). */
  launchFlags?: readonly string[];
  /** Step 9: the scratch ini was written back at exit (null: not checked, or gone). */
  iniWrittenBack?: boolean | null;
  /** Step 4: what the session log says about `-forceSettings` (null: not read). */
  forceSettings?: ForceSettingsEvidence | null;
  /** Every launcher project list named the sandbox before the launch (null: not read). */
  registeredBefore?: boolean | null;
}

/** What a session log shows about the `-forceSettings` switch [pattern unverified until S-B]. */
export interface ForceSettingsEvidence {
  /** The `CLI Params:` echo carries `-forceSettings`. */
  echoed: boolean;
  /** The echo's value, or another line, names the scratch ini by its file name. */
  namesIni: boolean;
  /** A line that names the switch or the ini also says unknown, invalid, failed, cannot or error. */
  rejection: boolean;
}

/**
 * Read a session log for the `-forceSettings` switch (DEC-032, S-B read M5): its `CLI Params:`
 * echo, any line naming the scratch ini's file name, and any line naming the switch or the ini
 * with a rejection word. The rejection words are a guess until the sitting shows Workbench's own
 * [unverified].
 */
export function forceSettingsEvidence(logText: string, iniPath: string): ForceSettingsEvidence {
  const iniName = basename(iniPath).toLowerCase();
  let echoed = false;
  let namesIni = false;
  let rejection = false;
  for (const raw of logText.split(/\r?\n/)) {
    const l = parseLogLine(raw);
    const msg = l.message.toLowerCase();
    if (/^cli params:/i.test(l.message) && /(^|\s)-forcesettings(\s|=|$)/i.test(l.message)) {
      echoed = true;
    }
    const mentions = msg.includes(iniName) || msg.includes("forcesettings");
    if (msg.includes(iniName)) namesIni = true;
    if (
      mentions &&
      /\b(unknown|invalid|unrecogni[sz]ed|ignor\w*|fail\w*|cannot|can't|could not|error)\b/.test(
        msg,
      )
    ) {
      rejection = true;
    }
  }
  return { echoed, namesIni, rejection };
}

/**
 * Whether this run shows that Workbench used the scratch ini: the step-9 write-back, or a session
 * log that names the scratch ini (its echo or another line) with no rejection line.
 */
export function iniUseShown(o: U12Observations): "write-back" | "log" | null {
  if (o.iniWrittenBack === true) return "write-back";
  const f = o.forceSettings;
  if (f && f.namesIni && !f.rejection) return "log";
  return null;
}

export interface U12Verdict {
  verdict: "pass" | "fail" | "incomplete";
  criteria: Array<{ name: string; result: CriterionResult; detail: string }>;
  /**
   * "yes" only when the launcher held although every launcher list named the sandbox before the
   * launch; a hold on an unregistered project answers nothing about the scratch profile.
   */
  launcherTreatsSandboxAsNew:
    | "yes"
    | "no"
    | "not observed"
    | "not observed (the launcher held on an unregistered project)";
  /**
   * Whether this run shows that Workbench used the scratch ini. Not one of the
   * four criteria, but a pass needs it (DEC-032): a NET answer is only
   * consistent with the ini being read (the NET API might be on by default,
   * and the registry might not be ignored), so only the step-9 write-back, or
   * a session log that names the ini with no line rejecting it, shows it.
   */
  iniConsumed: string;
  /** What follows from the verdict (plan 7 U12, "If yes" / "If no"). */
  consequence: string;
}

export const U12_PASS_CONSEQUENCE =
  "U12 passed: all later live sessions use the scratch profile (plan 7). Record the verdict in " +
  "DECISIONS.md before any session relies on it.";

export const U12_FAIL_CONSEQUENCE =
  "U12 failed: stop and get the owner's decision on registry save and restore before any GUI " +
  "census session (plan 7 U12, 'If no'). A registry restore is a registry write: it needs the " +
  "owner's go for that session, runs only after the Workbench process is confirmed gone, and is " +
  "followed by a diff (plan 5.3 post-flight step 3).";

export const U12_INCOMPLETE_CONSEQUENCE =
  "U12 is not settled by this run: the main session reads the evidence and decides whether the " +
  "sitting is repeated. No later session uses the scratch profile until U12 has a pass.";

/** The U12 verdict from what was observed. Pure. */
export function u12Verdict(o: U12Observations): U12Verdict {
  const criteria: U12Verdict["criteria"] = [];
  const runs: CriterionResult =
    o.openedSandbox === false
      ? "fail"
      : o.openedSandbox === true && o.graceful === true
        ? "pass"
        : o.openedSandbox === true && o.graceful === false
          ? "review"
          : "not-observed";
  criteria.push({
    name: "runs normally (opens the sandbox, exits on WM_CLOSE)",
    result: runs,
    detail: `opened sandbox: ${o.openedSandbox ?? "not read"}; graceful exit: ${o.graceful ?? "no close attempted"}`,
  });
  criteria.push({
    name: "keeps the NET API enabled (the native call answers)",
    result: o.netAnswered === null ? "not-observed" : o.netAnswered ? "pass" : "fail",
    detail: o.netAnswered === null ? "no call made" : o.netAnswered ? "answered" : "no answer",
  });
  const extra = (o.windowsAtReady ?? []).filter((t) => t.trim() !== "");
  const dialog =
    o.windowsAtReady === null
      ? "not-observed"
      : extra.some(
            (t) => t.includes(LAUNCHER_WINDOW_TITLE) || t.includes(MISSING_DEPS_WINDOW_TITLE),
          )
        ? "fail"
        : extra.length <= 1
          ? "pass"
          : "review";
  const noThrow = (o.launchFlags ?? []).some((f) => f.toLowerCase() === "-nothrow");
  criteria.push({
    name: "shows no first-run dialog",
    result: dialog,
    detail:
      (o.windowsAtReady === null
        ? "windows not listed"
        : `${extra.length} titled window(s) of the started pid: ${extra.join(" | ") || "none"}` +
          (dialog === "review"
            ? " (more than one window: the main session reads the capture)"
            : "")) +
      (noThrow && o.windowsAtReady !== null
        ? " (observed with -noThrow on: the flag may also hide a first-run dialog)"
        : ""),
  });
  criteria.push({
    name: "leaves the registry untouched (valid only after a graceful exit)",
    result:
      o.registryDiff === null || o.graceful !== true
        ? "not-observed"
        : o.registryDiff.length === 0
          ? "pass"
          : "fail",
    detail:
      o.registryDiff === null
        ? "not compared"
        : o.graceful !== true
          ? `${o.registryDiff.length} difference(s), NOT VALID without a graceful exit`
          : `${o.registryDiff.length} difference(s)`,
  });
  const results = criteria.map((c) => c.result);
  // DEC-032 (S-B read M5): a pass needs evidence that the scratch ini was used; four passing
  // criteria on the owner's registry (the switch ignored) would otherwise read as U12 passed.
  const used = iniUseShown(o);
  const verdict = results.includes("fail")
    ? "fail"
    : results.every((r) => r === "pass") && used !== null
      ? "pass"
      : "incomplete";
  const fs = o.forceSettings ?? null;
  return {
    verdict,
    criteria,
    launcherTreatsSandboxAsNew:
      o.launcherHeld === true
        ? o.registeredBefore === true
          ? "yes"
          : "not observed (the launcher held on an unregistered project)"
        : o.openedSandbox === true
          ? "no"
          : "not observed",
    iniConsumed:
      used === "write-back"
        ? "yes: Workbench wrote the scratch ini back at exit"
        : used === "log"
          ? "yes by the session log: it names the scratch ini and no line rejects it (the write-back was not seen)"
          : fs?.rejection
            ? "NO: a session-log line naming -forceSettings or the ini rejects it; U12 is not settled"
            : o.iniWrittenBack === false
              ? "not shown: the scratch ini was unchanged at exit and the session log does not name it; a NET answer " +
                "is only consistent with it being read, so U12 cannot pass on this run"
              : "not observed",
    consequence:
      verdict === "pass"
        ? U12_PASS_CONSEQUENCE
        : verdict === "fail"
          ? U12_FAIL_CONSEQUENCE
          : U12_INCOMPLETE_CONSEQUENCE,
  };
}

// ── Session plan and action plan ─────────────────────────────────────────────

export interface PlanAction {
  kind: string;
  target?: unknown;
  params?: Record<string, unknown>;
  [extra: string]: unknown;
}

/** Launch arguments after the proven form (crash-report flags; plan 7 U12). */
export function launchFlags(ownerGoSilentCrashReport: boolean): string[] {
  return ownerGoSilentCrashReport ? [...CRASH_FLAGS, SILENT_CRASH_FLAG] : [...CRASH_FLAGS];
}

/** Flags on any policy deny list (the shared rule of policy.ts: switch names, case ignored). */
export function deniedFlags(flags: readonly string[], policy: CensusPolicy): string[] {
  return flags.filter((f) => deniedSwitch([f], policy) !== null);
}

/** The launch as the printed plan shows it: placeholders for the sandbox and the run folder. */
export function planLaunch(silentCrashReport = false): { gproj: string; args: string[] } {
  const gproj = join("<sandbox>", `${SANDBOX_NAME}.gproj`);
  return {
    gproj,
    args: [
      "-gproj",
      gproj,
      "-forceSettings",
      join("<artifacts>", "sessions", SESSION, "<stamp>", "scratch.ini"),
      ...launchFlags(silentCrashReport),
    ],
  };
}

/**
 * The ACTION PLAN in the format `scripts/live/dry-run.ts` checks: the one
 * launch (its switches against the deny lists, its project against the 2.0
 * sandbox), the one NET call, and the desktop capture that runs only on a
 * timeout. The close and the registry compare are not action kinds of the
 * checker; they are in the printed session plan. There is no key, invoke, menu
 * or execute-action entry.
 */
export function actionPlan(
  timeouts: Timeouts = DEFAULT_TIMEOUTS,
  launch: { gproj: string; args: string[] } = planLaunch(false),
): PlanAction[] {
  return [
    {
      kind: "launch",
      target: { gproj: launch.gproj },
      args: [...launch.args],
      step: 3,
      spawns: 1,
      probes: [...PROBES.u12, PROBES.crashFlags],
      note: "the one launch of the sitting: the scratch ini and the crash-report flags",
    },
    {
      kind: "net-call",
      target: { apiFunc: NATIVE_CALL },
      params: {},
      step: 6,
      timeout_ms: timeouts.netCallMs,
      retry: false,
      probes: [...PROBES.u12],
      note: "the only NET call of the sitting; native, no handler",
    },
    {
      kind: "screenshot",
      target: { scope: "full desktop" },
      when:
        "only on a timeout (steps 4 to 7, including a failed or timed-out window probe), then the " +
        "session stops for the main session; also when the launcher or a dependency window is up " +
        "(steps 4 and 5)",
      probes: [...PROBES.u12],
    },
  ];
}

/** Human-readable session plan (paths through placeholders). */
export function sessionPlanLines(input: {
  launch: LaunchPlan;
  registryKey: string;
  timeouts: Timeouts;
  silentCrashReport: boolean;
  placeholders: PlaceholderContext;
}): string[] {
  const t = input.timeouts;
  const ph = (s: string): string => toPlaceholders(s, input.placeholders);
  return [
    "S-B scratch-profile bootstrap: one dedicated launch, nothing else rides on it",
    `0 refuse unless the project is <addons>\\${SANDBOX_NAME}\\${SANDBOX_NAME}.gproj (plan 5.1); refuse while the ` +
      "lease records a Workbench pid, while a started marker of S-B is in any run folder of the sitting (without " +
      "--owner-ack-repeat), and unless every launcher project list names the sandbox (OA-3 in both ways)",
    "1 pre-flight steps 1-7 (scratch-profile variant): lease, Tools build, no foreign Workbench, port " +
      `owner, export ${input.registryKey} to the run folder, sandbox snapshot, probe queue`,
    "2 build the scratch ini from the step-5 export (paths scrubbed, NET API keys kept) in the run folder",
    `3 launch once: ${ph(input.launch.commandLine)} (cwd ${ph(input.launch.cwd)})` +
      (input.silentCrashReport ? "" : `; ${SILENT_CRASH_FLAG} withheld (no owner go)`),
    `4 assert the opened project from the new session log within ${t.assertMs} ms; other project: ` +
      "abort and close; launcher held: close; timeout: capture, list windows, stop",
    `5 wait up to ${t.netReadyMs} ms for the started pid to listen on the NET port; list its windows`,
    `6 one native call ${NATIVE_CALL} with a ${t.netCallMs} ms timeout, never retried`,
    `7 CloseMainWindow on the started pid, wait ${t.closeMs} ms; hazard dialogs reported, never answered`,
    "8 post-flight registry export again; compare with the step-5 export; report every difference",
    "9 has Workbench written the scratch ini back at exit?",
    "10 U12 verdict per criterion; the lease stays held for postflight.ts (net-zero, release)",
    "never: Enter, any key or accelerator, a retry after a timeout, a kill, a registry write",
    `the real invocation's worst case (an estimate): ${invocationWorstCaseMs(t)} ms; run it in the background ` +
      `with a timeout above it; its last line is "${DONE_LINE}" or starts "STOPPED"`,
    "recovery after a stop with Workbench running: s-b-scratch-profile.ts recover --run <run folder> --id <lane id> " +
      "(image and creation-time checks, one process at a time, never a tree flag)",
  ];
}

// ── Session runner ───────────────────────────────────────────────────────────

/** Everything that touches a process, a socket, the desktop, the registry or a file outside the artifacts folder. */
export interface SessionDeps {
  platform: NodeJS.Platform;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** tasklist, netstat, and the pre-flight's and post-flight's `reg export`. */
  exec: ExecFn;
  /** The pre-flight's file-version read and the post-flight's CloseMainWindow. */
  powershell: (script: string, env?: Record<string, string>) => Promise<PowerShellResult>;
  /** Start Workbench and record its pid in the lane's lease. */
  spawn: (plan: LaunchPlan, lane: Lane, gproj: string) => number;
  netCall: (
    apiFunc: string,
    params: Record<string, unknown>,
    opts: NetCallOptions,
  ) => Promise<NetCallResult>;
  /** Full-desktop capture into `dir` (capture.ts). */
  capture: (label: string, dir: string) => Promise<CaptureResult>;
  /** Every visible top-level window (EnumWindows). */
  topWindows: () => Promise<TopWindow[]>;
  /**
   * Titles of one pid's top-level windows (no input posted). Throws when the
   * probe fails or times out: an empty list always means "no window".
   */
  processWindows: (pid: number) => Promise<string[]>;
  /** Newest session console.log created after `after` (ms), or null. */
  findSessionLog: (logsPath: string, after: number) => string | null;
  /** Read a session log (outside the artifacts folder). */
  readText: (path: string) => string;
  /** Every launcher project-list file (file reads only; DEC-031 M-1, DEC-032). */
  projectLists: () => ProjectListFile[];
  /** Every process with its parent and creation time (Win32_Process; read only; DEC-032). */
  processTable: () => Promise<ProcRow[]>;
}

export interface SessionOptions {
  really: boolean;
  lane: Lane;
  workbenchPath: string;
  gamePath: string;
  /** The configured addons folder; the sandbox must sit directly in it. */
  addonsPath: string;
  sandboxDir: string;
  gproj: string;
  logsPath: string;
  port: number;
  registryKey: string;
  ledgerMetaPath: string;
  queuePath: string;
  /** Artifacts root; the run folder is `<root>/sessions/S-B/<stamp>/`. */
  artifactsRoot: string;
  openedProjectPattern: string;
  silentCrashReport: boolean;
  /** This start follows a forced kill (this or an earlier sitting): its observations also answer U35. */
  afterForcedKill: boolean;
  /**
   * The owner acknowledged a second S-B launch in this sitting (`--owner-ack-repeat`): without it
   * a started marker of S-B in any run folder of the sitting refuses the run (DEC-032, M2).
   */
  ownerAckRepeat?: boolean;
  timeouts: Timeouts;
  personal: PersonalContext;
  placeholders: PlaceholderContext;
  policy: CensusPolicy;
}

export interface SessionStep {
  step: number;
  name: string;
  ok: boolean;
  detail: string;
  probes: string[];
  evidence?: string;
}

export interface SessionReport {
  outcome: "dry-run" | "refused" | "stopped" | "completed";
  reason?: string;
  runDir?: string;
  steps: SessionStep[];
  verdict?: U12Verdict;
  /** For the main session's postflight.ts run. */
  snapshotFile?: string;
  registryBefore?: string;
  startedPid?: number;
  /** Counters the tests assert on: never more than one of each. */
  spawns: number;
  netCalls: number;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What the close and the registry compare came to. */
type CloseResult = "closed" | "not-closed" | "compare-failed";

export const NOT_CLOSED_REASON =
  "Workbench did not exit after CloseMainWindow; Workbench is left as it is and the lease is kept " +
  "(do not run postflight.ts yet). The recorded recovery is s-b-scratch-profile.ts recover --run " +
  "<run folder> --id <lane id> (image and creation-time checks, one process at a time), run by the " +
  "main session; the next start after it is U35's observation.";

export const COMPARE_FAILED_REASON =
  "Workbench exited after CloseMainWindow, but the registry compare failed (see the step-8 " +
  "evidence); U12's registry criterion is not observed. Run postflight.ts; the main session decides " +
  "whether a fresh after-export is taken.";

/** Run the sitting. With `really` false nothing is touched and the plan is returned. */
export async function runSession(opts: SessionOptions, deps: SessionDeps): Promise<SessionReport> {
  const report: SessionReport = { outcome: "dry-run", steps: [], spawns: 0, netCalls: 0 };
  const flags = launchFlags(opts.silentCrashReport);
  const deniedHere = deniedFlags(flags, opts.policy);
  if (deniedHere.length > 0) {
    return {
      ...report,
      outcome: "refused",
      reason: `launch flag(s) on a policy deny list: ${deniedHere.join(", ")}`,
    };
  }
  if (deniedApi(NATIVE_CALL, deniedApiNames(opts.policy))) {
    return { ...report, outcome: "refused", reason: `${NATIVE_CALL} is on a policy deny list` };
  }
  const notSandbox = sandboxRefusal(opts.sandboxDir, opts.gproj, opts.addonsPath);
  if (notSandbox) return { ...report, outcome: "refused", reason: notSandbox };
  if (!opts.really) return report;
  const gate = liveGateReason({
    really: opts.really,
    platform: deps.platform,
    leaseHeld: opts.lane.holdsLease(),
  });
  if (gate) return { ...report, outcome: "refused", reason: gate };

  const runDir = join(opts.artifactsRoot, "sessions", SESSION, stamp(deps.now()));
  // DEC-032 (S-B read M2): one launch per sitting. A Workbench the lease still records (a stopped
  // S-B's own) must be recovered first; pre-flight step 3 would otherwise take it for ours and a
  // second Workbench would overwrite its pid in the lease.
  const leasePid = opts.lane.recordedPid();
  if (leasePid !== null) {
    return {
      ...report,
      outcome: "refused",
      reason:
        `the lease still records Workbench pid ${leasePid}: a Workbench of this lane may still run. Recover it ` +
        "first (s-b-scratch-profile.ts recover --run <the run folder that started it> --id <lane id>), check " +
        "git -C <sandbox> status --short, and stop and ask the owner; nothing was exported or launched",
    };
  }
  const earlier = sittingStartedMarkers(runDir, leaseStartMs(opts.lane), /^S-B$/);
  if (earlier.length > 0 && opts.ownerAckRepeat !== true) {
    return {
      ...report,
      outcome: "refused",
      reason:
        `${earlier.length} S-B launch${earlier.length === 1 ? "" : "es"} already started in this sitting (a started ` +
        "marker in a run folder born since the lease was taken): S-B is one dedicated launch. A repeat needs the " +
        "owner's acknowledgement for this sitting (--owner-ack-repeat); nothing was exported or launched",
    };
  }
  // DEC-032 (S-B read M3): the launch is a direct start with working directory <game>, so its list
  // is most likely the game's (DEC-031, [inferred]); every list must name the sandbox, or a hold
  // at the picker would be misread as the scratch profile treating the sandbox as new.
  let listsBefore: ProjectListFile[] = [];
  try {
    listsBefore = deps.projectLists();
  } catch {
    listsBefore = [];
  }
  const reg = registration(listsBefore, opts.gproj);
  if (reg !== "registered") {
    return {
      ...report,
      outcome: "refused",
      reason:
        `the launcher's project lists (read only) do not all name the sandbox (${reg}: ` +
        `${listsLine(listsBefore, opts.gproj)}): OA-3 is not done in both ways. The owner opens the sandbox once from ` +
        "Steam's Tools launcher and once from the direct start (S-A.md section 2, step 2); nothing was exported or launched",
    };
  }
  mkdirSync(runDir, { recursive: true });
  report.runDir = runDir;
  const decoyPath = join(dirname(opts.sandboxDir), DECOY_NAME, `${DECOY_NAME}.gproj`);
  const listSummary = (lists: readonly ProjectListFile[]): ListSummary[] =>
    summarizeLists(lists, opts.gproj, decoyPath);
  writeFileSync(
    join(runDir, "launcher-lists-before.json"),
    JSON.stringify(listSummary(listsBefore), null, 2) + "\n",
    { encoding: "utf-8", flag: "wx" },
  );
  const evidenceDir = join(runDir, "evidence");
  /** Placeholders first (a home path becomes %USERPROFILE%), then the account and machine names. */
  const ph = (s: string): string =>
    scrubFreeText(toPlaceholders(s, opts.placeholders), opts.personal);
  /** One name or title: shown whole, or `<redacted: reason>`. */
  const red = (s: string): string => redact(s, opts.personal);
  const u35 = opts.afterForcedKill ? [PROBES.u35] : [];
  const obs: U12Observations = {
    openedSandbox: null,
    launcherHeld: null,
    windowsAtReady: null,
    netAnswered: null,
    graceful: null,
    registryDiff: null,
    launchFlags: flags,
    iniWrittenBack: null,
    forceSettings: null,
    // Refused above unless every list named the sandbox.
    registeredBefore: true,
  };
  /** The started marker, once written: every end of the run then writes `S-B.json` beside it. */
  const markerPath = startedMarkerPath(runDir, MARKER_STEP);
  let markerWritten = false;
  /** Where the run is, for the STOP record of an unexpected exception. */
  let at: { step: number; name: string; probes: string[] } = {
    step: 1,
    name: "pre-flight 1-7",
    probes: [PROBES.crashOrphan, ...u35],
  };

  /** Write a JSON or text file into the run folder through the placeholders. */
  const writeRaw = (name: string, content: unknown): string => {
    const path = join(runDir, name);
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n";
    writeFileSync(path, ph(text), { encoding: "utf-8", flag: "wx" });
    return path;
  };

  let build = "unknown (pre-flight step 2 not run)";
  const record = (
    step: number,
    name: string,
    ok: boolean,
    detail: string,
    probes: string[],
    artifacts: string[] = [],
  ): SessionStep => {
    const { record: ev } = writeEvidence(
      evidenceDir,
      SESSION,
      {
        ran: `S-B step ${step} ${name} (probes: ${probes.join(", ") || "none"})`,
        build,
        result_summary: `${ok ? "ok" : "STOP"}: ${ph(detail)}`,
        artifacts,
      },
      opts.placeholders,
      deps.now(),
    );
    const s: SessionStep = { step, name, ok, detail: ph(detail), probes, evidence: ev.id };
    report.steps.push(s);
    return s;
  };

  const stop = (reason: string): SessionReport => {
    opts.lane.stopHeartbeat();
    report.outcome = "stopped";
    report.reason = ph(reason);
    return report;
  };

  /**
   * Plan 5.3 "During", on any timeout: capture the full desktop and write the
   * top-level window list (titles of other processes withheld).
   */
  const captureAndList = async (step: number): Promise<{ note: string; artifacts: string[] }> => {
    const cap = await deps.capture(`s-b-timeout-step${step}`, runDir);
    const pid = report.startedPid;
    let windowsFile: string;
    let launcher = false;
    try {
      const rows = await deps.topWindows();
      const ours = pid !== undefined ? [pid] : [];
      const crash = processesByImage(deps.exec, CRASH_REPORTER_IMAGE).map((c) => c.pid);
      const shown = windowsForEvidence(rows, [...ours, ...crash]);
      launcher = shown.some((w) => ours.includes(w.pid) && w.title.includes(LAUNCHER_WINDOW_TITLE));
      windowsFile = writeRaw(`windows-step${step}.json`, shown);
    } catch (e) {
      windowsFile = writeRaw(`windows-step${step}.json`, { error: errorText(e) });
    }
    return {
      note:
        `Desktop capture: ${cap.ok ? cap.path : `failed (${cap.detail})`}. ` +
        `Top-level windows: ${windowsFile}${launcher ? " (the launcher window of the started pid is up)" : ""}.`,
      artifacts: [windowsFile, ...(cap.ok && !cap.skipped ? [cap.path] : [])],
    };
  };

  /** Plan 5.3: on any timeout, no retry; capture, list windows, stop for the main session. */
  const timeoutStop = async (
    step: number,
    what: string,
    probes: string[],
  ): Promise<SessionReport> => {
    const { note, artifacts } = await captureAndList(step);
    record(
      step,
      "timeout",
      false,
      `${what}; not retried. ${note} Workbench is left as it is and the lease is kept: the main ` +
        "session decides.",
      probes,
      artifacts,
    );
    return stop(`timeout at step ${step}: ${what}`);
  };

  /** The started process's creation time, read once after the spawn (null: not read). */
  let startedCreated: number | null = null;

  /**
   * Workbench images that are not the started pid but appeared after the launch (pre-flight step 3
   * saw none): a launcher stub's engine, or a relaunch by Steam (DEC-030 open question; DEC-032,
   * S-B read m6). Read from the process table; the started pid's own children, when it still
   * runs, and any Workbench created after it otherwise.
   */
  const otherWorkbenches = async (pid: number): Promise<ProcRow[]> => {
    let rows: ProcRow[];
    try {
      rows = await deps.processTable();
    } catch {
      return [];
    }
    if (rows.some((r) => r.pid === pid)) return childWorkbenchRows(rows, pid);
    return rows.filter(
      (r) =>
        r.pid !== pid &&
        r.name.toLowerCase() === WORKBENCH_EXE.toLowerCase() &&
        (startedCreated === null || r.created === null || r.created >= startedCreated),
    );
  };

  /** The started Workbench is gone without a close: record what is left, stop. */
  const exitedByItself = async (
    step: number,
    name: string,
    pid: number,
    when: string,
  ): Promise<SessionReport> => {
    const crash = processesByImage(deps.exec, CRASH_REPORTER_IMAGE).map((c) => c.pid);
    const holders = portListeners(deps.exec, opts.port);
    const others = await otherWorkbenches(pid);
    const othersText = others.length
      ? `; ${WORKBENCH_EXE} pid ${others.map((o) => o.pid).join(", ")} appeared after the launch and STILL RUNS ` +
        "(a stub's engine or a relaunch: not recorded in the lease, ended only through recover with the owner's word)"
      : `; no other ${WORKBENCH_EXE} appeared after the launch`;
    record(
      step,
      name,
      false,
      `Workbench pid ${pid} exited by itself ${when}; ${CRASH_REPORTER_IMAGE}: ` +
        `${crash.length ? `pid ${crash.join(", ")}` : "none"}; port ${opts.port} held by: ` +
        `${holders.join(", ") || "nobody"}${othersText}`,
      [...PROBES.u12, PROBES.crashOrphan, PROBES.crashFlags, ...u35],
    );
    return stop(
      "Workbench exited by itself; the main session reads the logs (registry compare not valid)" +
        (others.length
          ? `; ${WORKBENCH_EXE} pid ${others.map((o) => o.pid).join(", ")} still runs: record it with lane.ts record ` +
            "and end it with recover --owner-go <pid> only on the owner's word"
          : ""),
    );
  };

  const body = async (): Promise<SessionReport> => {
    // ── 1 pre-flight steps 1-7 (preflight.ts's own step functions) ────────────
    const pctx: PreflightContext = {
      variant: "scratch-profile",
      lane: opts.lane,
      purpose: "S-B scratch-profile bootstrap (U12, crash-report flags, U35)",
      really: true,
      platform: deps.platform,
      workbenchPath: opts.workbenchPath,
      gamePath: opts.gamePath,
      port: opts.port,
      sandboxDir: opts.sandboxDir,
      gproj: opts.gproj,
      artifactsDir: runDir,
      ledgerMetaPath: opts.ledgerMetaPath,
      queuePath: opts.queuePath,
      snapshotPaths: null,
      registryKey: opts.registryKey,
      u12Passed: false,
      lint: null,
      probePack: false,
      headlessArgs: [],
      launcherKnowsSandbox: false,
      ownerYesAboveMutating: false,
      openedProjectPattern: opts.openedProjectPattern,
      sessionLog: null,
      exec: deps.exec,
      powershell: deps.powershell,
      now: deps.now,
      state: {},
    };
    const preSteps: PreflightStep[] = [
      stepLease,
      stepToolsBuild,
      stepWorkbenchRunning,
      stepPortOwner,
      stepRegistryExport,
      stepSnapshot,
      stepProbeQueue,
    ];
    const pre = await runPreflight(pctx, preSteps);
    const buildStep = pre.results.find((r) => r.step === 2 && r.ok);
    const buildMatch = buildStep ? /^build ([^\s;]+)/.exec(buildStep.detail) : null;
    if (buildMatch) build = buildMatch[1];
    const preDetail = pre.results
      .map((r: StepResult) => `${r.step} ${r.name}: ${r.ok ? "ok" : "FAIL"} (${r.detail})`)
      .join("; ");
    const preArtifacts = [pctx.state.snapshotFile].filter((p): p is string => !!p);
    report.snapshotFile = pctx.state.snapshotFile;
    report.registryBefore = pctx.state.registryExport;
    record(1, "pre-flight 1-7", pre.ok, preDetail, [PROBES.crashOrphan, ...u35], preArtifacts);
    if (!pre.ok) {
      const failed = pre.results[pre.results.length - 1];
      return stop(
        `pre-flight step ${failed.step} (${failed.name}) failed: ${failed.instruction ?? failed.detail}`,
      );
    }
    const before = pctx.state.registryExport;
    if (!before || !existsSync(before)) return stop("pre-flight step 5 wrote no registry export");

    // ── 2 the scratch ini (consumes the step-5 file) ──────────────────────────
    at = { step: 2, name: "scratch ini", probes: [...PROBES.u12, PROBES.format] };
    let ini: ScratchIni;
    try {
      ini = buildScratchIni(
        parseRegText(decodeRegText(readFileSync(before))),
        opts.personal,
        opts.placeholders,
      );
    } catch (e) {
      const m = errorText(e);
      record(2, "scratch ini", false, m, at.probes);
      return stop(`scratch ini refused: ${m}`);
    }
    const iniPath = join(runDir, "scratch.ini");
    writeFileSync(iniPath, ini.text, { encoding: "utf-8", flag: "wx" });
    const iniHash = sha256Text(ini.text);
    const scrubFile = writeRaw("scratch-ini-scrub.json", {
      sections: ini.sections,
      kept: ini.kept,
      dropped: ini.dropped,
      net_api: ini.netApi,
      sha256: iniHash,
    });
    record(
      2,
      "scratch ini",
      true,
      `${ini.kept} values in ${ini.sections.length} sections; dropped ${JSON.stringify(ini.dropped)}; ` +
        `NET API kept: ${JSON.stringify(ini.netApi)}`,
      at.probes,
      [iniPath, scrubFile],
    );

    // ── 3 launch, once ────────────────────────────────────────────────────────
    at = { step: 3, name: "launch", probes: [...PROBES.u12, PROBES.crashFlags, ...u35] };
    let plan: LaunchPlan;
    try {
      const base = buildLaunch({
        workbenchPath: opts.workbenchPath,
        gamePath: opts.gamePath,
        gproj: opts.gproj,
        forceSettings: iniPath,
      });
      const args = [...base.args, ...flags];
      plan = { ...base, args, commandLine: formatCommandLine(base.exe, args) };
    } catch (e) {
      const m = errorText(e);
      record(3, "launch", false, `launch refused: ${m}; nothing was started`, at.probes);
      return stop(`launch refused: ${m}`);
    }
    // The started marker, before the spawn (DEC-032, S-B read B1): a script that is cut off
    // leaves it with no result, and `recover` can show the pid is this run's own by its creation
    // time. A marker that cannot be written refuses the launch.
    const startedIso = deps.now().toISOString();
    try {
      writeStartedMarker(
        markerPath,
        { step: MARKER_STEP, started_at: startedIso, pid: null, created: null },
        true,
      );
      markerWritten = true;
    } catch (e) {
      const m = errorText(e);
      record(3, "launch", false, `could not write S-B.started before the spawn: ${m}`, at.probes);
      return stop(`launch refused: the started marker could not be written (${m})`);
    }
    let pid: number;
    try {
      report.spawns++;
      pid = deps.spawn(plan, opts.lane, opts.gproj);
    } catch (e) {
      const m = errorText(e);
      // Nothing started: the marker goes, so the failed spawn is not counted as the sitting's launch.
      try {
        unlinkSync(markerPath);
        markerWritten = false;
      } catch {
        // A marker left behind refuses a repeat; S-B.json below says why.
      }
      record(3, "launch", false, `the spawn failed: ${m}`, at.probes);
      return stop(`launch failed: ${m}`);
    }
    report.startedPid = pid;
    const launchedAt = deps.now().getTime();
    try {
      startedCreated = (await deps.processTable()).find((p) => p.pid === pid)?.created ?? null;
    } catch {
      startedCreated = null;
    }
    try {
      writeStartedMarker(
        markerPath,
        { step: MARKER_STEP, started_at: startedIso, pid, created: startedCreated },
        false,
      );
    } catch {
      // The lease records the pid as well; the step-3 evidence names it.
    }
    record(
      3,
      "launch",
      true,
      `started pid ${pid}: ${plan.commandLine}` +
        (opts.silentCrashReport ? "" : `; ${SILENT_CRASH_FLAG} withheld (no owner go)`) +
        `; creation time ${startedCreated === null ? "not read" : "recorded in S-B.started"}`,
      at.probes,
    );

    /** Visible windows of the started pid and of the Workbench images it brought up. */
    const visibleWindows = async (pids: readonly number[]): Promise<TopWindow[]> =>
      visibleWindowsOf(await deps.topWindows(), pids);

    // Close through the post-flight and compare the registry: the abort paths
    // of step 4 and the normal end share it.
    const frozen = { at: deps.now() };
    const postCtx: PostflightContext = {
      lane: opts.lane,
      really: true,
      platform: deps.platform,
      beforeManifest: null,
      noise: [],
      registryBefore: before,
      registryKey: opts.registryKey,
      closeTimeoutMs: opts.timeouts.closeMs,
      artifactsDir: runDir,
      exec: deps.exec,
      powershell: deps.powershell,
      // Visible windows only (DEC-032, S-B read M4): a hidden IME window is never a hazard. A
      // failed probe is a hazard of its own, never an empty list.
      windowTitles: async (p) => {
        try {
          return (await visibleWindows([p])).map((w) => w.title);
        } catch (e) {
          return [`<window probe failed: ${errorText(e)}>`];
        }
      },
      now: () => frozen.at,
    };

    const closeAndCompare = async (why: string): Promise<CloseResult> => {
      // 7 close
      at = {
        step: 7,
        name: "close",
        probes: [...PROBES.u12, PROBES.crashOrphan, PROBES.crashFlags],
      };
      const close = await closeStep(postCtx);
      const crash = processesByImage(deps.exec, CRASH_REPORTER_IMAGE).map((c) => c.pid);
      const holders = portListeners(deps.exec, opts.port).map((p) => ({
        pid: p,
        image: processByPid(deps.exec, p)?.image ?? "unknown",
      }));
      obs.graceful = close.graceful && !close.stillRunning;
      // A close that timed out is a timeout like any other: capture and list.
      const shot = close.stillRunning ? await captureAndList(7) : { note: "", artifacts: [] };
      record(
        7,
        "close",
        !close.stillRunning,
        `${why}: ${close.step.detail}; ${CRASH_REPORTER_IMAGE} after the close: ` +
          `${crash.length ? `pid ${crash.join(", ")}` : "none"}; port ${opts.port} after the close: ` +
          `${holders.length ? holders.map((h) => `${h.image} pid ${h.pid}`).join(", ") : "free"}` +
          (close.hazards.length
            ? `; hazard dialog(s), not answered: ${close.hazards.map(red).join(" | ")}`
            : "") +
          (close.stillRunning
            ? `; not retried. ${shot.note} Workbench is left as it is and the lease is kept.`
            : ""),
        at.probes,
        shot.artifacts,
      );
      if (close.stillRunning) return "not-closed";
      // The started pid is gone: the lease stops recording it, so post-flight's close never sends
      // a WM_CLOSE to a process that later got the same number (DEC-032, S-B read i1).
      try {
        opts.lane.record(null, opts.gproj);
      } catch {
        // The lease keeps the old pid; post-flight's close checks the image before sending anything.
      }
      // 8 registry
      at = {
        step: 8,
        name: "registry compare",
        probes: [...PROBES.u12, PROBES.isolation, PROBES.store],
      };
      frozen.at = deps.now();
      const afterPath = join(runDir, `registry-after-${stamp(frozen.at)}.reg`);
      let reg: PostStep | null = null;
      let failure: string | null = null;
      try {
        reg = registryStep(postCtx, obs.graceful);
      } catch (e) {
        failure = errorText(e);
      }
      if (failure === null && reg !== null && !reg.ok) failure = reg.detail;
      if (failure === null && !existsSync(afterPath)) failure = "no after-export was written";
      let diffs: RegDifference[] = [];
      if (failure === null) {
        try {
          diffs = diffRegistryExports(
            parseRegText(decodeRegText(readFileSync(before))),
            parseRegText(decodeRegText(readFileSync(afterPath))),
            opts.personal,
          );
        } catch (e) {
          failure = `the exports could not be compared: ${errorText(e)}`;
        }
      }
      if (failure !== null) {
        record(
          8,
          "registry compare",
          false,
          `${failure}. Workbench exited (step 7); the comparison is not made.`,
          at.probes,
        );
        return "compare-failed";
      }
      obs.registryDiff = diffs;
      const diffFile = writeRaw("registry-diff.json", {
        graceful: obs.graceful,
        differences: diffs,
      });
      record(
        8,
        "registry compare",
        true,
        `${diffs.length} difference(s)` +
          (obs.graceful ? "" : " NOT VALID: no graceful exit") +
          (diffs.length
            ? `: ${diffs
                .slice(0, 20)
                .map((d) => `${d.change} ${d.key}${d.value ? ` "${d.value}"` : ""}`)
                .join(
                  "; ",
                )}${diffs.length > 20 ? `; ${diffs.length - 20} more in registry-diff.json` : ""}`
            : "") +
          ". Report only: a restore is a registry write and needs the owner's go.",
        at.probes,
        [before, afterPath, diffFile],
      );
      // 9 ini written back?
      at = {
        step: 9,
        name: "scratch ini after exit",
        probes: [PROBES.isolation, PROBES.store, PROBES.format],
      };
      const nowHash = existsSync(iniPath) ? sha256File(iniPath) : null;
      const afterText = nowHash !== null ? readFileSync(iniPath, "utf-8") : "";
      const sectionsAfter = [...afterText.matchAll(/^\[([^\]\r\n]+)\]/gm)].map((m) => m[1]);
      obs.iniWrittenBack = nowHash === null ? null : nowHash !== iniHash;
      const newSections = sectionsAfter.filter((s) => !ini.sections.includes(s)).map(red);
      record(
        9,
        "scratch ini after exit",
        true,
        nowHash === null
          ? "the scratch ini is gone"
          : nowHash === iniHash
            ? "unchanged: Workbench did not write the scratch ini back"
            : `written back: ${afterText.split(/\r?\n/).length} lines, sections ` +
              `${sectionsAfter.length} (new: ${newSections.join(", ") || "none"})`,
        at.probes,
        nowHash !== null ? [iniPath] : [],
      );
      return "closed";
    };

    const finish = (): SessionReport => {
      at = {
        step: 10,
        name: "verdict",
        probes: [...PROBES.u12, PROBES.format, PROBES.isolation, PROBES.store, ...u35],
      };
      const verdict = u12Verdict(obs);
      report.verdict = verdict;
      const verdictFile = writeRaw("u12-verdict.json", verdict);
      record(
        10,
        "verdict",
        true,
        `U12 ${verdict.verdict}; launcher treats the sandbox as new: ${verdict.launcherTreatsSandboxAsNew}; ` +
          verdict.criteria.map((c) => `${c.name}: ${c.result}`).join("; ") +
          `; ini consumed: ${verdict.iniConsumed}. ${verdict.consequence}`,
        at.probes,
        [verdictFile],
      );
      opts.lane.stopHeartbeat();
      report.outcome = "completed";
      return report;
    };

    /** The verdict, then the stop reason a close result calls for. */
    const endAfterAbort = (r: CloseResult, closedReason: string): SessionReport => {
      finish();
      if (r === "not-closed") return stop(NOT_CLOSED_REASON);
      if (r === "compare-failed") return stop(COMPARE_FAILED_REASON);
      return stop(closedReason);
    };

    // ── 4 opened-project assertion ────────────────────────────────────────────
    at = { step: 4, name: "assert project", probes: [...PROBES.u12, ...u35] };
    const assertDeadline = launchedAt + opts.timeouts.assertMs;
    let opened: string | null = null;
    let logPath: string | null = null;
    for (;;) {
      logPath = deps.findSessionLog(opts.logsPath, launchedAt);
      if (logPath) opened = openedProjectFromLog(deps.readText(logPath), opts.openedProjectPattern);
      if (opened !== null) break;
      if (!processByPid(deps.exec, pid)) {
        return exitedByItself(
          4,
          "assert project",
          pid,
          "before the session log named the opened project",
        );
      }
      if (deps.now().getTime() >= assertDeadline) break;
      await deps.sleep(opts.timeouts.pollMs);
    }
    if (opened === null) {
      const noLine =
        `no session-log line naming the opened project within ${opts.timeouts.assertMs} ms` +
        (logPath ? ` (log ${logPath})` : " (no new session log)");
      let titles: string[];
      try {
        const others = await otherWorkbenches(pid);
        titles = (await visibleWindows([pid, ...others.map((o) => o.pid)])).map((w) => w.title);
      } catch (e) {
        return timeoutStop(4, `${noLine}; the window probe failed (${errorText(e)})`, at.probes);
      }
      if (titles.some((t) => t.includes(LAUNCHER_WINDOW_TITLE))) {
        // Every launcher list named the sandbox before the launch (refused otherwise), so a hold
        // here means the launcher treats the sandbox as new under the scratch profile: plan 5.3
        // step 9, not the sandbox opened, so abort and close. Enter is never pressed.
        obs.launcherHeld = true;
        obs.openedSandbox = null;
        const cap = await deps.capture("s-b-launcher-held", runDir);
        record(
          4,
          "assert project",
          false,
          `no project opened within ${opts.timeouts.assertMs} ms; the launcher window is up ` +
            `(titles: ${titles.map(red).join(" | ")}) although every launcher list named the sandbox ` +
            "before the launch: the launcher treats the sandbox as new under the scratch profile",
          at.probes,
          cap.ok && !cap.skipped ? [cap.path] : [],
        );
        const r = await closeAndCompare("abort: launcher held at its picker");
        return endAfterAbort(
          r,
          "the launcher held at its picker; closed gracefully (see the verdict)",
        );
      }
      return timeoutStop(4, noLine, at.probes);
    }
    if (!namesSandbox(opened, opts.gproj)) {
      // Another project's name is never printed (DEC-030's rule; DEC-032, S-B read m3): the
      // evidence keeps a short hash of it, enough to tell two runs apart.
      obs.openedSandbox = false;
      obs.launcherHeld = false;
      const tag = sha256Text(opened.toLowerCase()).slice(0, 12);
      record(
        4,
        "assert project",
        false,
        `the session log names a project other than the sandbox (name withheld, sha256 ${tag})`,
        at.probes,
      );
      const r = await closeAndCompare("abort: wrong project opened (plan 5.3 step 9)");
      return endAfterAbort(
        r,
        "a project other than the sandbox opened; aborted and closed gracefully",
      );
    }
    obs.openedSandbox = true;
    obs.launcherHeld = false;
    // DEC-032 (S-B read M5): what the log says about -forceSettings decides whether a pass can
    // stand without the step-9 write-back.
    obs.forceSettings = forceSettingsEvidence(logPath ? deps.readText(logPath) : "", iniPath);
    const fsNote = obs.forceSettings.rejection
      ? "a line naming -forceSettings or the ini REJECTS it"
      : obs.forceSettings.namesIni
        ? "the log names the scratch ini, no line rejects it"
        : obs.forceSettings.echoed
          ? "the echo carries -forceSettings but no line names the scratch ini"
          : "the log does not show -forceSettings";
    writeRaw("force-settings-log.json", obs.forceSettings);
    record(
      4,
      "assert project",
      true,
      `the session log names ${opened} (${logPath}); -forceSettings: ${fsNote}`,
      at.probes,
    );

    // ── 5 NET port ready, then the started pid's windows ──────────────────────
    at = { step: 5, name: "NET ready", probes: [...PROBES.u12, ...u35] };
    const readyDeadline = deps.now().getTime() + opts.timeouts.netReadyMs;
    let listener: number | null = null;
    let children: number[] = [];
    for (;;) {
      if (!processByPid(deps.exec, pid)) {
        return exitedByItself(5, "NET ready", pid, "before the NET port opened");
      }
      const holders = portListeners(deps.exec, opts.port);
      if (holders.includes(pid)) {
        listener = pid;
        break;
      }
      if (holders.length > 0) {
        // A launcher stub's engine may own the port (DEC-032, S-B read m6): a listener counts
        // when it is a Workbench image the started pid brought up after itself.
        children = (await otherWorkbenches(pid)).map((r) => r.pid);
        const child = holders.find((h) => children.includes(h));
        if (child !== undefined) {
          listener = child;
          break;
        }
      }
      if (deps.now().getTime() >= readyDeadline) break;
      await deps.sleep(opts.timeouts.pollMs);
    }
    if (listener === null) {
      return timeoutStop(
        5,
        `the started pid did not listen on port ${opts.port} within ${opts.timeouts.netReadyMs} ms ` +
          "(the NET API may be disabled under the scratch profile, or a dialog holds the start)",
        at.probes,
      );
    }
    let wins: TopWindow[];
    try {
      wins = await visibleWindows([pid, ...children]);
    } catch (e) {
      // An empty list would read as "no first-run dialog": a failed probe is a stop.
      return timeoutStop(
        5,
        `pid ${listener} listens on ${opts.port}, but the window probe failed (${errorText(e)}): a ` +
          "dialog cannot be ruled out",
        at.probes,
      );
    }
    // Visible windows only (DEC-032, S-B read M4): class, title and owner are recorded.
    const titles = wins.map((w) => w.title);
    obs.windowsAtReady = titles;
    const windowsFile = writeRaw(
      "windows-at-ready.json",
      wins.map((w) => ({ ...w, title: red(w.title) })),
    );
    const blocking = titles.filter(
      (t) => t.includes(LAUNCHER_WINDOW_TITLE) || t.includes(MISSING_DEPS_WINDOW_TITLE),
    );
    record(
      5,
      "NET ready",
      blocking.length === 0,
      `pid ${listener} listens on ${opts.port}` +
        (listener !== pid ? ` (a Workbench image the started pid ${pid} brought up)` : "") +
        `; visible windows: ${wins.map((w) => `${w.className} "${red(w.title)}"${w.owner ? " owned" : ""}`).join(" | ") || "none"}`,
      at.probes,
      [windowsFile],
    );
    if (blocking.length > 0) {
      const cap = await deps.capture("s-b-dialog-at-ready", runDir);
      return stop(
        `a launcher or dependency window is up (${blocking.map(red).join(" | ")}); capture ` +
          `${cap.path}; nothing was answered: the main session decides`,
      );
    }

    // ── 6 the one NET call ────────────────────────────────────────────────────
    at = { step: 6, name: "NET call", probes: [...PROBES.u12] };
    opts.lane.heartbeat();
    report.netCalls++;
    const r = await deps.netCall(
      NATIVE_CALL,
      {},
      { port: opts.port, timeoutMs: opts.timeouts.netCallMs },
    );
    if (r.timedOut) {
      return timeoutStop(
        6,
        `${NATIVE_CALL} timed out after ${opts.timeouts.netCallMs} ms`,
        at.probes,
      );
    }
    // A status other than Ok is still an answer: the NET API is listening and enabled.
    const statusAnswer = !r.ok && (r.error ?? "").startsWith("Workbench error");
    obs.netAnswered = r.ok || statusAnswer;
    const callFile = writeRaw("net-call.json", { apiFunc: NATIVE_CALL, ...r });
    record(
      6,
      "NET call",
      true,
      r.ok
        ? `${NATIVE_CALL} answered in ${r.durationMs} ms: ${JSON.stringify(r.response)}`
        : statusAnswer
          ? `${NATIVE_CALL} answered with an error status in ${r.durationMs} ms: ${r.error}`
          : `${NATIVE_CALL} did not answer: ${r.error}`,
      at.probes,
      [callFile],
    );

    // ── 7-9 close, registry, ini ──────────────────────────────────────────────
    const closed = await closeAndCompare("normal end");
    if (closed === "closed") return finish();
    return endAfterAbort(closed, "closed");
  };

  /**
   * `<run>/S-B.json`, written at every end once the started marker exists: post-flight then knows
   * the run finished (a marker with no result means the script was cut off; DEC-031, DEC-032).
   */
  const writeResult = (r: SessionReport): SessionReport => {
    if (!markerWritten) return r;
    try {
      writeFileSync(
        join(runDir, `${MARKER_STEP}.json`),
        ph(
          JSON.stringify(
            {
              session: SESSION,
              outcome: r.outcome,
              reason: r.reason ?? null,
              started_pid: r.startedPid ?? null,
              verdict: r.verdict?.verdict ?? null,
              steps: r.steps.map((s) => ({
                step: s.step,
                name: s.name,
                ok: s.ok,
                evidence: s.evidence,
              })),
            },
            null,
            2,
          ) + "\n",
        ),
        { encoding: "utf-8", flag: "wx" },
      );
    } catch {
      // A missing result reads as a cut-off run to post-flight: the safe side.
    }
    return r;
  };

  opts.lane.startHeartbeat();
  try {
    return writeResult(await body());
  } catch (e) {
    const m = errorText(e);
    const left =
      report.startedPid !== undefined
        ? `Workbench pid ${report.startedPid} is left as it is and the lease is kept`
        : "nothing was launched; the lease is kept";
    try {
      record(
        at.step,
        at.name,
        false,
        `exception: ${m}; ${left}: the main session decides`,
        at.probes,
      );
    } catch {
      // The evidence writer failed too: the report still carries the reason.
    }
    return writeResult(stop(`exception at step ${at.step} (${at.name}): ${m}; ${left}`));
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/**
 * Production dependencies (never used by the tests). The PowerShell runner's
 * own timeout follows the close timeout, so the runner never ends the close
 * script while WaitForExit is still waiting.
 */
export function defaultDeps(
  closeMs: number = DEFAULT_TIMEOUTS.closeMs,
  addonsPath: string | null = null,
): SessionDeps {
  return {
    // Read only: the launcher's project lists, from the profile next to the addons folder.
    projectLists: () => (addonsPath ? readProjectLists(profileDirOf(addonsPath)) : []),
    processTable: () => readProcessTable(),
    platform: process.platform,
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    exec: defaultExec,
    powershell: (script, env) =>
      runPowerShell(script, { env, timeoutMs: powershellTimeoutMs(closeMs) }),
    spawn: (plan, lane, gproj) => spawnWorkbench(plan, lane, gproj),
    netCall: (apiFunc, params, o) => netCall(apiFunc, params, o),
    capture: (label, dir) => captureDesktop({ label, dir, gateReason: null }),
    topWindows: async () => {
      const r = await runPowerShell(TOP_WINDOWS_SCRIPT);
      if (!r.ok) throw new Error(r.error ?? r.stderr);
      return parseTopWindows(r.stdout);
    },
    processWindows: async (pid) => {
      const outcome = await inspectProcessWindows(pid);
      // failedOutcome() carries an empty list: never let that read as "no window".
      if (outcome.error) throw new Error(outcome.error);
      return outcome.windowTitles;
    },
    findSessionLog: (logsPath, after) => newestSessionLog(logsPath, after),
    readText: (path) => (existsSync(path) ? readFileSync(path, "utf-8") : ""),
  };
}

/** The PowerShell runner's timeout for a given close timeout (the close script waits that long). */
export function powershellTimeoutMs(closeMs: number): number {
  return closeMs + 30_000;
}

const VALUED = [
  "out",
  "preview-from",
  "id",
  "queue",
  "registry-key",
  "sandbox",
  "gproj",
  "addons-path",
  "workbench-path",
  "game-path",
  "logs-path",
  "port",
  "opened-project-pattern",
  "ledger-meta",
  "assert-timeout-ms",
  "net-ready-timeout-ms",
  "net-call-timeout-ms",
  "close-timeout-ms",
  "poll-ms",
  "lease-path",
  "marker-path",
  "run",
  "owner-go",
] as const;

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
  return n;
}

/** Overrides of `recover`'s process operations (tests only). */
export interface MainOverrides {
  recoverDeps?: Partial<RecoverDeps>;
  artifactsRoot?: string;
}

export async function main(
  argv: string[],
  injected?: SessionDeps,
  log: (line: string) => void = (l) => console.log(l),
  over: MainOverrides = {},
): Promise<number> {
  // Every printed path in placeholder form (plan 5.2; DEC-032, S-B read m2), refusals and the
  // catch included.
  let placeholders: PlaceholderContext = defaultPlaceholderContext({ v2: REPO_ROOT });
  const err = (s: string): void => console.error(toPlaceholders(s, placeholders));
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  const cmd = args.positional[0] ?? "run";
  if (cmd !== "run" && cmd !== "recover") {
    err(
      "Usage: s-b-scratch-profile.ts [run] [options] | recover --run <run dir> --id <lane id> [--owner-go <pid>] [--really]",
    );
    return 2;
  }
  const really = args.flags.has("really");
  /** The real run's last line: `S-B done` or `STOPPED: ...` (DEC-032, S-B read M1). */
  let realRun = false;
  const stopped = (reason: string): void => {
    if (realRun) log(toPlaceholders(`STOPPED: ${reason}`, placeholders));
  };
  try {
    if (cmd === "recover") {
      // The shared recovery (session-common.ts): the lease's pid, its image, its creation time
      // against <run>/S-B.started, one process at a time, never a tree flag (DEC-032, S-B read B1).
      if (!o.run || !o.id) {
        err("recover needs --run <run dir> and --id <lane id>");
        return 2;
      }
      let ownerGo: number | null = null;
      if (o["owner-go"] !== undefined) {
        ownerGo = Number(o["owner-go"]);
        if (!Number.isInteger(ownerGo) || ownerGo <= 0) {
          err("--owner-go takes the pid the owner's word names");
          return 2;
        }
      }
      const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
      const deps: RecoverDeps = { ...defaultRecoverDeps(log), ...over.recoverDeps };
      return await runRecover(
        {
          lane,
          really,
          runDir: resolve(o.run),
          artifactsRoot: over.artifactsRoot ?? artifactsDir(),
          ph: placeholders,
        },
        deps,
        {
          ownerGo,
          next:
            "git -C <sandbox> status --short, then postflight.ts --id <lane id> --before <the snapshot S-B printed>; " +
            "the registry comparison of that sitting is not valid",
        },
      );
    }
    const timeouts: Timeouts = {
      assertMs: positiveInt("assert-timeout-ms", o["assert-timeout-ms"], DEFAULT_TIMEOUTS.assertMs),
      netReadyMs: positiveInt(
        "net-ready-timeout-ms",
        o["net-ready-timeout-ms"],
        DEFAULT_TIMEOUTS.netReadyMs,
      ),
      netCallMs: positiveInt(
        "net-call-timeout-ms",
        o["net-call-timeout-ms"],
        DEFAULT_TIMEOUTS.netCallMs,
      ),
      closeMs: positiveInt("close-timeout-ms", o["close-timeout-ms"], DEFAULT_TIMEOUTS.closeMs),
      pollMs: positiveInt("poll-ms", o["poll-ms"], DEFAULT_TIMEOUTS.pollMs),
    };
    const silent = args.flags.has("owner-go-silent-crash-report");
    const plan = actionPlan(timeouts, planLaunch(silent));

    if (!really) {
      // Dry run: no config is required and nothing outside --out is written.
      let config: ReturnType<typeof loadConfig> | null = null;
      try {
        config = loadConfig();
      } catch {
        config = null;
      }
      const gproj =
        o.gproj ??
        (o.sandbox
          ? join(o.sandbox, `${SANDBOX_NAME}.gproj`)
          : config
            ? defaultSandboxGproj(config.projectPath)
            : `<addons>\\${SANDBOX_NAME}\\${SANDBOX_NAME}.gproj`);
      const workbenchPath = o["workbench-path"] ?? config?.workbenchPath ?? "<tools>";
      const gamePath = o["game-path"] ?? config?.gamePath ?? "<game>";
      placeholders = defaultPlaceholderContext({
        tools: workbenchPath,
        game: gamePath,
        sandbox: dirname(gproj),
        v2: REPO_ROOT,
      });
      const ph = (s: string): string => toPlaceholders(s, placeholders);
      const dryRefusal = sandboxRefusal(
        o.sandbox ?? dirname(gproj),
        gproj,
        o["addons-path"] ?? config?.projectPath ?? dirname(o.sandbox ?? dirname(gproj)),
      );
      if (dryRefusal) {
        err(`the real run would refuse: ${dryRefusal}`);
        return 1;
      }
      const base = buildLaunch({
        workbenchPath,
        gamePath,
        gproj,
        forceSettings: join("<artifacts>", "sessions", SESSION, "<stamp>", "scratch.ini"),
      });
      const args2 = [...base.args, ...launchFlags(silent)];
      const launch = { ...base, args: args2, commandLine: formatCommandLine(base.exe, args2) };
      log(
        "S-B scratch-profile bootstrap [dry run: nothing is acquired, exported, launched or sent]",
      );
      for (const line of sessionPlanLines({
        launch,
        registryKey: o["registry-key"] ?? DEFAULT_REGISTRY_KEY,
        timeouts,
        silentCrashReport: silent,
        placeholders,
      })) {
        log(`  ${line}`);
      }
      log(`invocation worst case (an estimate): ${invocationWorstCaseMs(timeouts)} ms`);
      log("action plan (the format scripts/live/dry-run.ts checks):");
      log(JSON.stringify(plan, null, 2));
      if (o["preview-from"]) {
        // Offline preview of the scrub on an export the main session points at.
        const ini = buildScratchIni(
          parseRegText(decodeRegText(readFileSync(o["preview-from"]))),
          personalContextFromEnv(),
          placeholders,
        );
        log(
          `scratch ini preview: ${ini.kept} values in ${ini.sections.length} sections ` +
            `(${ini.sections.join(", ")}); dropped ${JSON.stringify(ini.dropped)}; NET API ` +
            `${JSON.stringify(ini.netApi)}; nothing written`,
        );
      }
      if (o.out) {
        writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
        log(`action plan written to ${ph(o.out)}`);
      }
      return 0;
    }

    realRun = true;
    if (!o.id) {
      err("a real run needs --id <lane id> (the lane that holds the lease)");
      stopped("usage: no --id");
      return 2;
    }
    if (!o["registry-key"]) {
      // Never from the environment: ENFUSION_WB_REGISTRY_KEY could silently replace the key the
      // runbook names (DEC-032, S-B read m1).
      err(
        `a real run needs --registry-key "${DEFAULT_REGISTRY_KEY}" (the key the runbook names; never taken from the environment)`,
      );
      stopped("usage: no --registry-key");
      return 2;
    }
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    const deps0 = injected;
    const gate = liveGateReason({
      really,
      platform: deps0?.platform ?? process.platform,
      leaseHeld: lane.holdsLease(),
    });
    if (gate) {
      err(`refused: ${gate}`);
      stopped(`refused: ${gate}`);
      return 1;
    }
    const needConfig =
      !o["workbench-path"] || !o["game-path"] || !o["logs-path"] || !o["addons-path"];
    const config = needConfig ? loadConfig() : null;
    const addonsPath = o["addons-path"] ?? config!.projectPath;
    const sandboxDir = o.sandbox ?? (o.gproj ? dirname(o.gproj) : join(addonsPath, SANDBOX_NAME));
    const gproj = o.gproj ?? join(sandboxDir, `${SANDBOX_NAME}.gproj`);
    // Plan 5.1: only the 2.0 sandbox, refused before anything is read or touched.
    const notSandbox = sandboxRefusal(sandboxDir, gproj, addonsPath);
    if (notSandbox) {
      err(`refused: ${notSandbox}`);
      stopped(`refused: ${notSandbox}`);
      return 1;
    }
    const workbenchPath = o["workbench-path"] ?? config!.workbenchPath;
    const gamePath = o["game-path"] ?? config!.gamePath;
    placeholders = defaultPlaceholderContext({
      tools: workbenchPath,
      game: gamePath,
      sandbox: sandboxDir,
      v2: REPO_ROOT,
    });
    const ph = (s: string): string => toPlaceholders(s, placeholders);
    const deps = injected ?? defaultDeps(timeouts.closeMs, addonsPath);
    const opts: SessionOptions = {
      really,
      lane,
      workbenchPath,
      gamePath,
      addonsPath,
      sandboxDir,
      gproj,
      logsPath: o["logs-path"] ?? config!.logsPath,
      port: positiveInt("port", o.port, config?.workbenchPort ?? 5775),
      registryKey: o["registry-key"],
      ledgerMetaPath: o["ledger-meta"] ?? join(REPO_ROOT, "data", "census", "ledger.meta.json"),
      queuePath: o.queue ?? DEFAULT_QUEUE,
      artifactsRoot: over.artifactsRoot ?? artifactsDir(),
      openedProjectPattern: o["opened-project-pattern"] ?? OPENED_PROJECT_PATTERN,
      silentCrashReport: silent,
      afterForcedKill: args.flags.has("after-forced-kill"),
      ownerAckRepeat: args.flags.has("owner-ack-repeat"),
      timeouts,
      personal: personalContextFromEnv(),
      placeholders,
      policy: loadPolicy(),
    };
    const report = await runSession(opts, deps);
    for (const s of report.steps) {
      log(`[${s.ok ? "ok  " : "STOP"}] ${s.step} ${s.name} (${s.evidence}): ${s.detail}`);
    }
    if (report.verdict) {
      log(`U12 ${report.verdict.verdict}: ${report.verdict.consequence}`);
    }
    log(`outcome: ${report.outcome}${report.reason ? ` (${ph(report.reason)})` : ""}`);
    if (report.runDir) log(`run folder: ${ph(report.runDir)}`);
    if (report.startedPid !== undefined) log(`started pid: ${report.startedPid}`);
    if (report.snapshotFile) log(`postflight --before ${ph(report.snapshotFile)}`);
    // The valid registry comparison is this script's step 8; postflight.ts runs
    // without --registry-before so the key is not exported a third time.
    if (report.registryBefore) log(`registry before (step 5): ${ph(report.registryBefore)}`);
    if (report.outcome === "completed") {
      log(`${DONE_LINE}: outcome completed, U12 ${report.verdict?.verdict ?? "not decided"}`);
      return 0;
    }
    stopped(`outcome ${report.outcome}${report.reason ? `: ${report.reason}` : ""}`);
    return 1;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    err(m);
    stopped(`exception: ${m}`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
