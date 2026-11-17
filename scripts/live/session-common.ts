/**
 * What the three live session scripts (S-A `s-a-headless.ts`, S-B `s-b-scratch-profile.ts`, S-C
 * `s-c-natives.ts`) share since the pre-sitting reads (DEC-030, DEC-031, DEC-032). Moved here from
 * the S-A script, which re-exports every name, so each pattern exists once:
 *
 *   - the process table (`Win32_Process`, read only) with parent links and creation times, and
 *     the per-process end: no tree flag anywhere, an image check before each `taskkill /PID <p> /F`,
 *     descendants only when created after their parent and of a Workbench, CrashReporter or
 *     WerFault image (DEC-031, M-2);
 *   - started markers (`<run>/<step>.started`, with the pid and its creation time) and their
 *     owner-acknowledged rename;
 *   - `recover`, the recorded recovery (plan 5.3): the lease's pid, its image, its creation time
 *     against a started marker, at most three per sitting counted across every run folder born
 *     since the lease was taken, a forced-kill record for post-flight;
 *   - the launcher's project lists, one per Steam app number, and the rule that the sandbox is
 *     registered only when EVERY list names it (DEC-031, M-1);
 *   - the artifacts-folder rule for run folders, and the caps a caller's command timeout has.
 *
 * Nothing here runs a process or reads the registry on its own: the callers inject the process
 * operations, and their real forms run only behind the live gate.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { liveGateReason } from "./cli.js";
import type { Lane } from "./lane.js";
import { WORKBENCH_EXE, formatCommandLine } from "./launch.js";
import { insideGitWorkTree, toPlaceholders, type PlaceholderContext } from "./paths.js";
import { leaseStartMs, recordForcedKill, sittingFolders } from "./postflight.js";
import { lastLine, runPowerShell, type PowerShellResult } from "./powershell.js";
import {
  CRASH_REPORTER_IMAGE,
  defaultExec,
  processByPid,
  processesByImage,
  type ExecFn,
} from "./win.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** How long to wait for an ended pid to be gone before stopping for the main session. */
export const KILL_WAIT_MS = 30_000;
/** Plan 5.3: three recoveries per session, then stop and reassess. */
export const MAX_RECOVERIES = 3;
/** The caller's shell tool: a foreground command is cut off after this long. */
export const FOREGROUND_CAP_MS = 600_000;
/** The caller's shell tool: a background command is cut off after this long. */
export const BACKGROUND_CAP_MS = 7_200_000;

// ── Spawning with the exit seen ──────────────────────────────────────────────

export interface ProcessExit {
  code: number | null;
  signal: string | null;
  error?: string;
}

export interface SpawnedProcess {
  pid: number;
  /** Resolves when the process exits. */
  exited: Promise<ProcessExit>;
  /** Let this script end while the process keeps running (the session stopped). */
  release: () => void;
}

/**
 * Start Workbench detached, keeping the handle so the exit code is seen. The `error` listener
 * is attached before anything can throw: a spawn that fails (the pid is undefined and Node
 * emits `error` on the next tick) then ends as a refusal, never as an unhandled error that
 * kills the script without its final line.
 */
export function spawnWithExit(exe: string, args: string[], cwd: string): SpawnedProcess {
  const child = spawn(exe, args, { cwd, detached: true, stdio: "ignore", windowsHide: false });
  const exited = new Promise<ProcessExit>((resolvePromise) => {
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
    child.once("error", (e) => resolvePromise({ code: null, signal: null, error: e.message }));
  });
  if (child.pid === undefined)
    throw new Error(`Workbench did not start: ${formatCommandLine(exe, args)}`);
  return { pid: child.pid, exited, release: () => child.unref() };
}

// ── The process table and the per-process end ───────────────────────────────

/**
 * What a kill did. DEC-031 (M-2): processes are ended one at a time, never with a tree flag;
 * `ended` is true only when this kill ended a live process (each one is in `ended_pids`).
 */
export interface KillResult {
  ended: boolean;
  /** Pids this kill ended, children first and the started pid last. */
  ended_pids: number[];
  /** Descendants left running and reported: another image, created before their parent, or an image that changed. */
  left: Array<{ pid: number; image: string }>;
  /** The process table could not be read, so the descendants are unknown. */
  descendants_unknown: boolean;
  detail: string;
}

/**
 * One row of the process table: pid, parent pid, image, creation time (epoch ms) or null, and
 * the CPU time the process has used so far (kernel plus user, ms) or null when it is not known
 * (DEC-033: S-A's idle end rule reads it; nothing ends a process on it).
 */
export interface ProcRow {
  pid: number;
  ppid: number;
  name: string;
  created: number | null;
  cpu_ms?: number | null;
}

/** Images a kill may end below the started pid (DEC-031). */
export const END_IMAGES: ReadonlySet<string> = new Set(
  [WORKBENCH_EXE, CRASH_REPORTER_IMAGE, "WerFault.exe"].map((s) => s.toLowerCase()),
);

/**
 * Which descendants of `root` a kill may end, and which it must leave (DEC-031, M-2). A
 * descendant is ended only when it was created after its parent AND its image is the
 * Workbench executable, `CrashReporter.exe` or `WerFault.exe`, and only below a parent that is
 * ended too; a parent link that fails the creation-time check is a reused pid. Every other
 * descendant is left running and reported, and nothing below it is looked at. With `mayEnd`
 * false every child is left. `end` lists children before their parents: the order of the
 * kills (the root is not in it; it is ended last).
 */
export function descendantPlan(
  rows: readonly ProcRow[],
  root: number,
  mayEnd = true,
): { end: ProcRow[]; left: ProcRow[]; rootRow: ProcRow | null } {
  const rootRow = rows.find((r) => r.pid === root) ?? null;
  const end: ProcRow[] = [];
  const left: ProcRow[] = [];
  if (!rootRow) return { end, left, rootRow };
  const seen = new Set<number>([root]);
  const visit = (parent: ProcRow): void => {
    for (const r of rows) {
      if (r.ppid !== parent.pid || seen.has(r.pid)) continue;
      seen.add(r.pid);
      const after = r.created !== null && parent.created !== null && r.created > parent.created;
      if (mayEnd && after && END_IMAGES.has(r.name.toLowerCase())) {
        visit(r);
        end.push(r);
      } else {
        left.push(r);
      }
    }
  };
  visit(rootRow);
  return { end, left, rootRow };
}

/**
 * The Workbench images descended from `root` and created after their parent (a launcher stub's
 * engine, or a relaunch): what a check of "the started process" must look at besides `root`.
 */
export function childWorkbenchRows(rows: readonly ProcRow[], root: number): ProcRow[] {
  return descendantPlan(rows, root).end.filter(
    (r) => r.name.toLowerCase() === WORKBENCH_EXE.toLowerCase(),
  );
}

/**
 * End the Workbench this run started, one process at a time (DEC-031, M-2; this replaces
 * DEC-030's tree flag, which no code uses any more). The started pid's image is checked first
 * (another image throws, nothing ended). With `descendants` (the default) the process table is
 * read and the descendants `descendantPlan` allows are ended first, children before parents,
 * then the started pid. Each one is image-checked again immediately before its own
 * `taskkill /PID <p> /F`. Every other descendant is left running and reported in `left`; a
 * table that cannot be read sets `descendants_unknown`. A taskkill that reports an error for a
 * process that was alive at its image check and is gone afterwards counts as ended. Without
 * `descendants` only the pid itself is ended, and its children are reported as left.
 *
 * DEC-034 (the narrow read of fc5010b, m-1 and m-2): a process query that fails inside the
 * per-process loop never throws out of it. The pid it concerned is reported in `left` with a
 * note and the loop goes on, so the pids already ended are always returned and the caller
 * records them. With `expectCreated` (the creation time the run recorded for `pid`), the table
 * is read again just before the started pid's own image check and `taskkill`: a pid that the
 * table shows with another creation time is left running and reported, and so are its children
 * when the first read already shows another time. A table that cannot be read at that point
 * does not stop the end; the image check still runs and the note says so.
 */
export async function killOwnWorkbench(
  io: { exec: ExecFn; processTable: () => Promise<ProcRow[]> },
  pid: number,
  opts: { descendants?: boolean; expectCreated?: number | null } = {},
): Promise<KillResult> {
  const out: KillResult = {
    ended: false,
    ended_pids: [],
    left: [],
    descendants_unknown: false,
    detail: "",
  };
  const root = processByPid(io.exec, pid);
  if (!root) {
    out.detail = `pid ${pid} is no longer running; nothing killed`;
    return out;
  }
  if (root.image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
    throw new Error(`pid ${pid} is ${root.image}, not ${WORKBENCH_EXE}; nothing killed`);
  }
  const expected = typeof opts.expectCreated === "number" ? opts.expectCreated : null;
  const notes: string[] = [];
  const otherTime = (created: number | null | undefined): boolean =>
    expected !== null && typeof created === "number" && created !== expected;
  let plan: { end: ProcRow[]; left: ProcRow[] } = { end: [], left: [] };
  try {
    const p = descendantPlan(await io.processTable(), pid, opts.descendants !== false);
    if (p.rootRow === null) out.descendants_unknown = true;
    else if (otherTime(p.rootRow.created)) {
      // Not the process the run started: end nothing of it, its children included.
      out.left.push({ pid, image: root.image });
      out.detail =
        `pid ${pid} was created at another time than the run recorded (${p.rootRow.created}, not ${expected}): ` +
        "a reused pid; nothing ended, left running";
      return out;
    } else plan = p;
  } catch {
    out.descendants_unknown = true;
  }
  for (const l of plan.left) out.left.push({ pid: l.pid, image: l.name });
  const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const endOne = (p: number, image: string, what: string): void => {
    let now: ReturnType<typeof processByPid>;
    try {
      now = processByPid(io.exec, p);
    } catch (e) {
      out.left.push({ pid: p, image });
      notes.push(
        `${what} pid ${p}: the process list could not be read before its end (${errText(e)}): left running`,
      );
      return;
    }
    if (!now) {
      notes.push(`${what} pid ${p} already gone`);
      return;
    }
    if (now.image.toLowerCase() !== image.toLowerCase()) {
      out.left.push({ pid: p, image: now.image });
      notes.push(`${what} pid ${p} is now ${now.image}, not ${image}: left running`);
      return;
    }
    try {
      io.exec("taskkill", ["/PID", String(p), "/F"]);
      out.ended_pids.push(p);
      notes.push(`taskkill /PID ${p} /F (${what}, ${now.image})`);
    } catch (e) {
      const why = errText(e);
      let after: ReturnType<typeof processByPid>;
      try {
        after = processByPid(io.exec, p);
      } catch (e2) {
        out.left.push({ pid: p, image: now.image });
        notes.push(
          `taskkill /PID ${p} /F (${what}) reported an error (${why}) and the process list could not be read ` +
            `afterwards (${errText(e2)}): its state is unknown, counted as left running`,
        );
        return;
      }
      if (!after) {
        out.ended_pids.push(p);
        notes.push(
          `taskkill /PID ${p} /F (${what}) reported an error but the process is gone: ${why}`,
        );
      } else {
        out.left.push({ pid: p, image: now.image });
        notes.push(`taskkill /PID ${p} /F (${what}) failed and the process still runs: ${why}`);
      }
    }
  };
  for (const c of plan.end) endOne(c.pid, c.name, "child");
  // m-2: the started pid's creation time, read again right before its own end.
  let rootIsOurs = true;
  if (expected !== null) {
    try {
      const row = (await io.processTable()).find((r) => r.pid === pid);
      if (row && otherTime(row.created)) {
        rootIsOurs = false;
        out.left.push({ pid, image: root.image });
        notes.push(
          `started pid ${pid} was created at another time than the run recorded (${row.created}, not ${expected}) ` +
            "when read just before its end: a reused pid; left running",
        );
      } else if (!row || typeof row.created !== "number") {
        notes.push(
          `started pid ${pid}: its creation time could not be read again before its end; image check only`,
        );
      }
    } catch (e) {
      notes.push(
        `started pid ${pid}: the process table could not be read again before its end (${errText(e)}); image check only`,
      );
    }
  }
  if (rootIsOurs) endOne(pid, WORKBENCH_EXE, "started pid");
  out.ended = out.ended_pids.length > 0;
  if (out.left.length > 0) {
    notes.push(`left running: ${out.left.map((l) => `pid ${l.pid} ${l.image}`).join(", ")}`);
  }
  if (out.descendants_unknown)
    notes.push("the process table could not be read: descendants unknown");
  out.detail = notes.join("; ");
  return out;
}

/**
 * PowerShell: every process as { pid, ppid, name, created, cpu_ms } (Win32_Process; read only),
 * `created` in epoch milliseconds or null, `cpu_ms` the kernel plus user time in milliseconds
 * (`KernelModeTime` and `UserModeTime` are in 100 ns units) or null.
 */
export const PROCESS_TREE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$rows = @(Get-CimInstance Win32_Process | ForEach-Object { $c = $null; if ($_.CreationDate) { $c = [long]([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }; $u = $null; if ($null -ne $_.KernelModeTime -and $null -ne $_.UserModeTime) { $u = [long](([UInt64]$_.KernelModeTime + [UInt64]$_.UserModeTime) / 10000) }; [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; created = $c; cpu_ms = $u } })",
  "ConvertTo-Json -Compress -InputObject $rows",
].join("\n");

/** Parse `PROCESS_TREE_SCRIPT`'s last line into rows. */
export function parseProcessTable(line: string): ProcRow[] {
  const parsed = JSON.parse(line) as Array<Partial<ProcRow>> | Partial<ProcRow>;
  return (Array.isArray(parsed) ? parsed : [parsed]).map((r) => ({
    pid: Number(r.pid),
    ppid: Number(r.ppid),
    name: String(r.name ?? ""),
    created: typeof r.created === "number" ? r.created : null,
    cpu_ms: typeof r.cpu_ms === "number" ? r.cpu_ms : null,
  }));
}

/** The process table through PowerShell (read only); throws when it cannot be read. */
export async function readProcessTable(
  powershell: (script: string) => Promise<PowerShellResult> = (s) => runPowerShell(s),
): Promise<ProcRow[]> {
  const r = await powershell(PROCESS_TREE_SCRIPT);
  const line = r.ok ? lastLine(r.stdout) : null;
  if (!line) throw new Error(`could not read the process table: ${r.error ?? r.stderr}`);
  return parseProcessTable(line);
}

/** A process's creation time from the table, or null when it is not there or cannot be read. */
export async function creationTimeOf(
  pid: number,
  processTable: () => Promise<ProcRow[]>,
): Promise<number | null> {
  try {
    return (await processTable()).find((p) => p.pid === pid)?.created ?? null;
  } catch {
    return null;
  }
}

// ── Launcher project lists (DEC-031, M-1) ────────────────────────────────────

/**
 * One launcher project-list file, `.projectList_app<N>_user<M>.conf` in the Workbench profile
 * folder. `app` is the Steam app number N (1874880 the game, 1874910 the Tools [inferred from
 * the `steam_appid.txt` files, DEC-031]); the user number is never kept. A file that cannot be
 * read, or that holds text but no `FilePath` entry (another encoding or format), is unreadable.
 */
export interface ProjectListFile {
  app: string;
  readable: boolean;
  /** The `FilePath` entries, in file order. */
  entries: string[];
  mtimeMs: number | null;
}

/** A project-list file as a step result records it: counts and flags only, never a name. */
export interface ListSummary {
  app: string;
  readable: boolean;
  entries: number;
  sandbox: boolean;
  decoy: boolean;
  first: "sandbox" | "decoy" | "other" | "none";
  modified: string | null;
}

/** Launcher project-list files in the Workbench profile folder (`wb-deps.ts` reads the same). */
const PROJECT_LIST_FILE_RE = /^\.projectList_app(\d+)_user\d+\.conf$/;

/** The Workbench profile folder beside a configured addons folder (`wb-deps.ts`'s rule). */
export function profileDirOf(addonsPath: string): string {
  return join(dirname(resolve(addonsPath)), "profile");
}

/** Every launcher project-list file of a profile folder, in file-name order (file reads only). */
export function readProjectLists(profileDir: string): ProjectListFile[] {
  let names: string[];
  try {
    names = readdirSync(profileDir).sort();
  } catch {
    return [];
  }
  const out: ProjectListFile[] = [];
  for (const n of names) {
    const m = PROJECT_LIST_FILE_RE.exec(n);
    if (!m) continue;
    const p = join(profileDir, n);
    let text: string | null = null;
    let mtimeMs: number | null = null;
    try {
      const st = statSync(p);
      mtimeMs = st.mtimeMs;
      if (st.isFile()) text = readFileSync(p, "utf-8");
    } catch {
      text = null;
    }
    const entries =
      text === null ? [] : [...text.matchAll(/FilePath\s+"([^"]+)"/g)].map((x) => x[1]);
    const readable = text !== null && (entries.length > 0 || text.trim().length === 0);
    out.push({ app: m[1], readable, entries, mtimeMs });
  }
  return out;
}

/** A `.gproj` path in one comparable spelling (resolved, backslashes, lower case). */
export function normGproj(p: string): string {
  return resolve(p).replace(/\//g, "\\").toLowerCase();
}

/**
 * Whether the launcher's project lists name `gproj` (DEC-031, M-1): "registered" only when
 * EVERY project-list file names it, because which list a launch reads is not known (one file
 * per Steam app number; a direct start from `<game>` most likely reads the game's [inferred]).
 * "not-registered" when a readable list lacks it; "unknown" when there is no list, or a list
 * that cannot be read and no readable one lacks it.
 */
export function registration(
  lists: readonly ProjectListFile[],
  gproj: string,
): "registered" | "not-registered" | "unknown" {
  if (lists.length === 0) return "unknown";
  const want = normGproj(gproj);
  if (lists.some((l) => l.readable && !l.entries.some((e) => normGproj(e) === want))) {
    return "not-registered";
  }
  return lists.some((l) => !l.readable) ? "unknown" : "registered";
}

/** The project lists as a step result records them: per app number, counts and flags only. */
export function summarizeLists(
  lists: readonly ProjectListFile[],
  gproj: string,
  decoyGprojPath: string,
): ListSummary[] {
  const sandbox = normGproj(gproj);
  const decoy = normGproj(decoyGprojPath);
  return lists.map((l) => {
    const names = l.entries.map(normGproj);
    return {
      app: l.app,
      readable: l.readable,
      entries: l.entries.length,
      sandbox: names.includes(sandbox),
      decoy: names.includes(decoy),
      first:
        names.length === 0
          ? "none"
          : names[0] === sandbox
            ? "sandbox"
            : names[0] === decoy
              ? "decoy"
              : "other",
      modified: l.mtimeMs === null ? null : new Date(l.mtimeMs).toISOString(),
    };
  });
}

/** One line per app number: does each list name `gproj`? (No entry is ever printed.) */
export function listsLine(lists: readonly ProjectListFile[], gproj: string): string {
  if (lists.length === 0) return "no project-list file could be read";
  const want = normGproj(gproj);
  return lists
    .map(
      (l) =>
        `app ${l.app}: ${!l.readable ? "unreadable" : l.entries.some((e) => normGproj(e) === want) ? "names it" : "does NOT name it"}`,
    )
    .join("; ");
}

// ── Run folders ──────────────────────────────────────────────────────────────

/**
 * Why `dir` may not hold this session's output, or null: it must lie strictly inside the
 * artifacts folder and outside every git working tree (plan 4.2; plan 5.3 Headless CLI).
 */
export function outsideArtifacts(dir: string, artifactsRoot: string): string | null {
  const rel = relative(resolve(artifactsRoot), resolve(dir));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return `${dir} is not inside the artifacts folder ${artifactsRoot}`;
  }
  if (insideGitWorkTree(dir)) return `${dir} lies inside a git working tree`;
  return null;
}

// ── Started markers ──────────────────────────────────────────────────────────

/** `<run>/<step>.started`: written before a step's first side effect, with the pid once known. */
export function startedMarkerPath(runDir: string, id: string): string {
  return join(runDir, `${id}.started`);
}

/** A started marker the owner acknowledged (`acknowledge` subcommand): it blocks no other step. */
export function acknowledgedMarkerPath(runDir: string, id: string): string {
  return `${startedMarkerPath(runDir, id)}.acknowledged`;
}

/** Content of a started marker. */
export interface StartedMarker {
  step: string;
  started_at: string;
  pid: number | null;
  /** The process's creation time (epoch ms) from the process table, or null (DEC-031). */
  created: number | null;
}

/** Read a started marker, or null when it is missing or unreadable. */
export function readStartedMarker(path: string): StartedMarker | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StartedMarker;
  } catch {
    return null;
  }
}

/** Write a started marker (exclusive when `create`, else replacing the one this run wrote). */
export function writeStartedMarker(path: string, marker: StartedMarker, create: boolean): void {
  writeFileSync(path, JSON.stringify(marker, null, 2) + "\n", {
    encoding: "utf-8",
    flag: create ? "wx" : "w",
  });
}

/** Started-marker file names: `<step>.started` and `<step>.started.acknowledged`. */
const MARKER_RE = /^(.+)\.started(\.acknowledged)?$/;

/**
 * The started processes this run folder's markers name: pid, creation time (null when the
 * process table could not be read at the spawn) and step. A step result alone never makes a pid
 * this run's own: only a marker with a creation time can be compared (DEC-031).
 */
export function runStartedPids(
  runDir: string,
): Array<{ step: string; pid: number; created: number | null }> {
  if (!existsSync(runDir)) return [];
  const out: Array<{ step: string; pid: number; created: number | null }> = [];
  for (const f of readdirSync(runDir).sort()) {
    const m = MARKER_RE.exec(f);
    if (!m) continue;
    const marker = readStartedMarker(join(runDir, f));
    if (!marker || typeof marker.pid !== "number" || !Number.isInteger(marker.pid)) continue;
    out.push({
      step: m[1],
      pid: marker.pid,
      created: typeof marker.created === "number" ? marker.created : null,
    });
  }
  return out;
}

/** The pids of `runStartedPids`, sorted (what a dry run prints). */
export function runOwnPids(runDir: string): number[] {
  return [...new Set(runStartedPids(runDir).map((m) => m.pid))].sort((a, b) => a - b);
}

/**
 * Started markers of a whole sitting whose step name matches `stepRe`: every run folder born
 * since the lease was taken (`sittingFolders`), so a new run folder never resets a count.
 */
export function sittingStartedMarkers(
  runDir: string,
  leaseStart: number | null,
  stepRe: RegExp,
): Array<{ folder: string; file: string }> {
  const out: Array<{ folder: string; file: string }> = [];
  for (const folder of sittingFolders(runDir, leaseStart)) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    for (const n of names.sort()) {
      const m = MARKER_RE.exec(n);
      if (m && stepRe.test(m[1])) out.push({ folder, file: n });
    }
  }
  return out;
}

// ── recover ──────────────────────────────────────────────────────────────────

/** One `recover` call, written to `<run>/recover-<n>.json`. */
export interface RecoverRecord {
  pid: number;
  image: string;
  /** A started marker of this run names the pid with the creation time the process has now. */
  own: boolean;
  /** The pid the owner's word named (`--owner-go <pid>`), or null. */
  owner_go: number | null;
  /** The pid's qualifying descendants were ended too (only for a pid this run started). */
  descendants: boolean;
  at: string;
  /** The kill ended a live process: this counts as one of the three recoveries. */
  ended: boolean;
  /** Every pid this call ended, children first. */
  ended_pids: number[];
  /** Descendants left running and reported. */
  left: Array<{ pid: number; image: string }>;
  /** The pid was gone within the wait. */
  gone: boolean;
  /** Workbench pids still running afterwards (null: the list could not be read). */
  leftovers: number[] | null;
  detail: string;
}

/** `recover` records of a run folder, in order. */
export function recoverRecords(runDir: string): RecoverRecord[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .filter((f) => /^recover-\d+\.json$/.test(f))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(runDir, f), "utf-8")) as RecoverRecord;
      } catch {
        // An unreadable record counts as a recovery that ended a process.
        return { ended: true } as RecoverRecord;
      }
    });
}

/** What `recover` needs of its session: the lane, the run folder and how to print paths. */
export interface RecoverConfig {
  lane: Lane;
  really: boolean;
  runDir: string;
  artifactsRoot: string;
  ph: PlaceholderContext;
}

/** The process operations `recover` uses (all injected; tests drive them with mocks). */
export interface RecoverDeps {
  platform: NodeJS.Platform;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Image name of a pid, or null when it is gone. */
  imageOfPid: (pid: number) => string | null;
  /** End `pid` after an image check, one process at a time (`killOwnWorkbench`). */
  kill: (
    pid: number,
    opts?: { descendants?: boolean; expectCreated?: number | null },
  ) => Promise<KillResult>;
  /** Pids of every running Workbench image. */
  workbenchPids: () => number[];
  /** Every process with its parent and creation time (Win32_Process; read only). */
  processTable: () => Promise<ProcRow[]>;
  log: (line: string) => void;
}

/** The real process operations of `recover` (used only after the live gate has passed). */
export function defaultRecoverDeps(log: (line: string) => void = console.log): RecoverDeps {
  const processTable = (): Promise<ProcRow[]> => readProcessTable();
  return {
    platform: process.platform,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    imageOfPid: (pid) => processByPid(defaultExec, pid)?.image ?? null,
    kill: (pid, opts) => killOwnWorkbench({ exec: defaultExec, processTable }, pid, opts),
    workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid),
    processTable,
    log,
  };
}

/**
 * `recover`, the recorded recovery (B1 of DEC-030; per process since DEC-031; shared by S-A, S-B
 * and S-C since DEC-032). It reads the Workbench pid from this lane's lease and confirms with
 * the process list that its image is the Workbench executable. The pid is this run's own only
 * when a started marker of the run folder names it AND the process now under that pid has the
 * creation time the marker recorded (a reused pid is not ours). Then it ends, one process at a
 * time with `taskkill /PID <p> /F`, the pid's descendants that were created after their parent
 * and are the Workbench executable, CrashReporter.exe or WerFault.exe (children first, each
 * image-checked again just before), and the pid last, and waits for them to go. Every other
 * descendant is reported and left running. A pid that is not this run's own needs
 * `--owner-go <pid>` naming that same pid (plan 5.7) and is ended alone. It refuses, saying what
 * it saw, in every other case: no pid in the lease, a pid that is gone or is another image, a
 * run folder outside the artifacts folder, or three recoveries already in the sitting (plan
 * 5.3), counted across every run folder born since the lease was taken. A dry run unless the
 * live gate passes. On success the lease no longer records a pid; the lane keeps the lease.
 * `next` is the session's own instruction after a recovery.
 */
export async function runRecover(
  cfg: RecoverConfig,
  deps: RecoverDeps,
  opts: { ownerGo: number | null; next?: string } = { ownerGo: null },
): Promise<number> {
  const log = (s: string): void => deps.log(toPlaceholders(s, cfg.ph));
  const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const gate = liveGateReason({
    really: cfg.really,
    platform: deps.platform,
    leaseHeld: cfg.lane.holdsLease(),
  });
  const pid = cfg.lane.recordedPid();
  const marked = pid === null ? undefined : runStartedPids(cfg.runDir).find((m) => m.pid === pid);
  const folders = sittingFolders(cfg.runDir, leaseStartMs(cfg.lane));
  const done = folders.flatMap((f) => recoverRecords(f)).filter((r) => r.ended).length;
  log(
    `recover: the lease of ${cfg.lane.session} records Workbench pid ${pid ?? "none"}` +
      (pid === null
        ? ""
        : marked
          ? ` (a started marker of ${marked.step} names it${marked.created === null ? ", with no creation time" : ""})`
          : " (no started marker of this run names it)") +
      `; recoveries in this sitting so far: ${done} of ${MAX_RECOVERIES} (${folders.length} run folder${folders.length === 1 ? "" : "s"})`,
  );
  if (gate) {
    log(
      `${gate}; would confirm that pid ${pid ?? "<none>"} is ${WORKBENCH_EXE} and compare its creation time ` +
        "with the started marker's; if it is this run's own, end its descendants created after their parent " +
        `(${WORKBENCH_EXE}, ${CRASH_REPORTER_IMAGE}, WerFault.exe) one at a time with taskkill /PID <p> /F, ` +
        `children first, then taskkill /PID ${pid ?? "<pid>"} /F, and wait for them to go`,
    );
    return cfg.really ? 1 : 0;
  }
  const outside = outsideArtifacts(cfg.runDir, cfg.artifactsRoot);
  if (outside) {
    log(`refused: ${outside}; nothing ended`);
    return 1;
  }
  if (!existsSync(cfg.runDir)) {
    log(`refused: the run folder ${cfg.runDir} does not exist; nothing ended`);
    return 1;
  }
  if (done >= MAX_RECOVERIES) {
    log(
      `refused: ${done} recoveries already ended a process in this sitting; plan 5.3 allows three per ` +
        "session: stop and ask the owner; nothing ended",
    );
    return 1;
  }
  const others = (): string => {
    try {
      const running = deps.workbenchPids().filter((p) => p !== pid);
      return running.length === 0
        ? "no other Workbench image is running"
        : `${WORKBENCH_EXE} pid ${running.join(", ")} is running and not recorded in the lease: it is ended only ` +
            "on the owner's word for this sitting (plan 5.7): record it with lane.ts record --id <lane id> --pid <pid> " +
            "--project <sandbox gproj>, then run recover --owner-go <pid>";
    } catch (e) {
      return `the Workbench processes could not be listed (${errText(e)})`;
    }
  };
  if (pid === null) {
    log(`refused: the lease records no Workbench pid; nothing ended; ${others()}`);
    return 1;
  }
  if (opts.ownerGo !== null && opts.ownerGo !== pid) {
    log(
      `refused: --owner-go names pid ${opts.ownerGo}, but the lease records pid ${pid}; the owner's word covers ` +
        "the pid it names only; nothing ended",
    );
    return 1;
  }
  let image: string | null;
  try {
    image = deps.imageOfPid(pid);
  } catch (e) {
    log(`refused: the process list could not be read (${errText(e)}); nothing ended`);
    return 1;
  }
  if (image === null) {
    log(
      `refused: the process list shows no pid ${pid}: it is no longer running; nothing ended; ${others()}`,
    );
    return 1;
  }
  if (image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
    log(
      `refused: pid ${pid} is ${image}, not ${WORKBENCH_EXE} (the pid may have been reused); nothing ended`,
    );
    return 1;
  }
  // This run's own only with the same creation time as the marker recorded (DEC-031).
  let nowCreated: number | null = null;
  let tableNote = "";
  try {
    nowCreated = (await deps.processTable()).find((p) => p.pid === pid)?.created ?? null;
  } catch (e) {
    tableNote = `the process table could not be read (${errText(e)})`;
  }
  const own =
    marked !== undefined &&
    marked.created !== null &&
    nowCreated !== null &&
    marked.created === nowCreated;
  if (!own && opts.ownerGo === null) {
    const why = !marked
      ? "no started marker in the run folder names it"
      : marked.created === null
        ? "its started marker has no creation time to compare"
        : nowCreated === null
          ? tableNote || "its creation time could not be read"
          : "the process under that pid was created at another time than the one the run started (a reused pid)";
    log(
      `refused: pid ${pid} is not shown to be one this run started (${why}); ending a process this session did ` +
        "not start needs the owner's word for this sitting (plan 5.7): pass --owner-go <pid> naming that pid once " +
        "the owner gave it; nothing ended",
    );
    return 1;
  }
  let res: KillResult;
  try {
    // m-2 (DEC-034): the kill reads the creation time again just before the pid's own end: the
    // marker's for a pid this run started, the one just read for a pid the owner's word names.
    res = await deps.kill(pid, {
      descendants: own,
      expectCreated: own ? (marked?.created ?? null) : nowCreated,
    });
  } catch (e) {
    log(`refused by the kill's own image check: ${errText(e)}; nothing ended`);
    return 1;
  }
  const at = new Date(deps.now()).toISOString();
  for (const p of res.ended_pids) {
    try {
      recordForcedKill(cfg.runDir, { pid: p, by: "recover", at, how: `taskkill /PID ${p} /F` });
    } catch (e) {
      log(`a forced kill could not be recorded for post-flight: ${errText(e)}`);
    }
  }
  // Wait for the pid and everything this call ended to go before listing leftovers.
  const waitFor = [...new Set([pid, ...res.ended_pids])];
  const alive = (p: number): boolean => {
    try {
      return deps.imageOfPid(p) !== null;
    } catch {
      return true;
    }
  };
  const deadline = deps.now() + KILL_WAIT_MS;
  while (waitFor.some(alive) && deps.now() < deadline) await deps.sleep(1_000);
  const gone = !alive(pid);
  let leftovers: number[] | null = null;
  try {
    leftovers = deps.workbenchPids();
  } catch {
    leftovers = null;
  }
  const ok =
    gone &&
    leftovers !== null &&
    leftovers.length === 0 &&
    res.left.length === 0 &&
    !res.descendants_unknown;
  const detail =
    `${res.detail}; pid ${pid} ${gone ? "is gone" : `is still running after ${KILL_WAIT_MS} ms`}; ` +
    (leftovers === null
      ? "the Workbench processes could not be listed"
      : leftovers.length === 0
        ? "no Workbench image is running"
        : `${WORKBENCH_EXE} pid ${leftovers.join(", ")} is still running: not recorded; it is ended only on the ` +
          "owner's word for this sitting (plan 5.7), after an image check");
  const rec: RecoverRecord = {
    pid,
    image,
    own,
    owner_go: opts.ownerGo,
    descendants: own,
    at,
    ended: res.ended,
    ended_pids: res.ended_pids,
    left: res.left,
    gone,
    leftovers,
    detail,
  };
  try {
    writeFileSync(
      join(cfg.runDir, `recover-${recoverRecords(cfg.runDir).length + 1}.json`),
      JSON.stringify(rec, null, 2) + "\n",
      { encoding: "utf-8", flag: "wx" },
    );
  } catch (e) {
    log(`the recover record could not be written: ${errText(e)}`);
  }
  if (ok) {
    try {
      cfg.lane.record(null, null);
    } catch (e) {
      log(`${detail}; the lease's pid could not be cleared: ${errText(e)}`);
      return 1;
    }
    log(
      `recovered (${res.ended ? done + 1 : done} of ${MAX_RECOVERIES}): ${detail}; the lane keeps the lease and ` +
        `it no longer records a pid. Next: ${opts.next ?? "git -C <sandbox> status --short, then stop and ask the owner"}`,
    );
    return 0;
  }
  log(`NOT recovered: ${detail}; the lease is unchanged. Stop and ask the owner`);
  return 1;
}

// ── acknowledge ──────────────────────────────────────────────────────────────

/**
 * `acknowledge` (DEC-031; shared since DEC-032): the one way to clear a started marker that has
 * no result. With the owner's acknowledgement for this sitting (`ownerAck`) it renames
 * `<run>/<step>.started` to `<step>.started.acknowledged`, so the other steps of the run folder
 * may run again; the step itself never runs again in that run, and post-flight still counts it
 * as a step whose Workbench exit is unknown. It refuses while any Workbench image runs (recover
 * first), while `extraRefusal` names a reason (an open plant, say), when the step has a result
 * (`resultFile`) or no marker, and outside the artifacts folder. A dry run unless the live gate
 * passes; `would` is the dry-run sentence's tail.
 */
export function acknowledgeMarker(
  cfg: RecoverConfig,
  deps: { platform: NodeJS.Platform; workbenchPids: () => number[]; log: (line: string) => void },
  opts: {
    step: string;
    ownerAck: boolean;
    resultFile: string;
    would: string;
    extraRefusal?: () => string | null;
  },
): number {
  const log = (s: string): void => deps.log(toPlaceholders(s, cfg.ph));
  const gate = liveGateReason({
    really: cfg.really,
    platform: deps.platform,
    leaseHeld: cfg.lane.holdsLease(),
  });
  const marker = startedMarkerPath(cfg.runDir, opts.step);
  if (gate) {
    log(
      `${gate}; would rename ${opts.step}.started to ${opts.step}.started.acknowledged once the owner's ` +
        `acknowledgement is given (--owner-ack), ${opts.would}`,
    );
    return cfg.really ? 1 : 0;
  }
  const outside = outsideArtifacts(cfg.runDir, cfg.artifactsRoot);
  if (outside) {
    log(`refused: ${outside}`);
    return 1;
  }
  if (!existsSync(marker)) {
    log(`refused: ${opts.step} has no started marker in this run folder; nothing to acknowledge`);
    return 1;
  }
  if (existsSync(opts.resultFile)) {
    log(`refused: ${opts.step} has a result; its marker is not a harness error`);
    return 1;
  }
  if (!opts.ownerAck) {
    log(
      "refused: clearing a started marker needs the owner's acknowledgement for this sitting (--owner-ack)",
    );
    return 1;
  }
  let running: number[];
  try {
    running = deps.workbenchPids();
  } catch (e) {
    log(
      `refused: the Workbench processes could not be listed (${e instanceof Error ? e.message : String(e)})`,
    );
    return 1;
  }
  if (running.length > 0) {
    log(`refused: Workbench is running (pid ${running.join(", ")}); end it with recover first`);
    return 1;
  }
  const extra = opts.extraRefusal?.() ?? null;
  if (extra) {
    log(`refused: ${extra}`);
    return 1;
  }
  renameSync(marker, acknowledgedMarkerPath(cfg.runDir, opts.step));
  log(
    `acknowledged: ${opts.step}.started is now ${opts.step}.started.acknowledged; ${opts.step} is not run again in ` +
      "this run, the other steps may run, and post-flight counts it as a step whose Workbench exit is unknown",
  );
  return 0;
}
