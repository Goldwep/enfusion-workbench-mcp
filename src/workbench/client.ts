/**
 * TCP client for the Workbench NET API.
 *
 * Each rawCall() opens a fresh TCP connection, sends one request, reads the
 * response, and closes the socket (protocol requirement).
 *
 * call() wraps rawCall() with auto-launch: if Workbench isn't running,
 * it installs handler scripts, launches the exe, waits for the NET API,
 * and retries the original call.
 *
 * Guards (2.0 plan, section 5.1), active whenever the client holds a Config:
 *   - Lease. Every call() and every ensureRunning() first takes or refreshes
 *     the machine-wide Workbench lease (lease.ts) as session
 *     "registered:<pid>". Another session's lease (held, orphaned or
 *     corrupt) refuses with LEASE_HELD before any TCP traffic, handler
 *     install or spawn. ping() and diagnose() are read-only probes and stay
 *     lease-free.
 *   - No fallback project. Auto-launch on a refused connection only opens
 *     the addon named by config.defaultMod, never "the first addon found",
 *     and never while the no-autolaunch marker exists (AUTOLAUNCH_REFUSED).
 *   - Handler recovery asks Workbench which project is open
 *     (GetLoadedProjects) and installs into that project only, or refuses.
 */

import { Socket } from "node:net";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { findGameAcrossSteamLibraries, steamRootOf } from "../utils/steam.js";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { encodeRequest, decodeResponse } from "./protocol.js";
import { logger } from "../utils/logger.js";
import type { Config } from "../config.js";
import { killProcessTree, runningWorkbenchPids, tailLines } from "./cli-runner.js";
import {
  LeaseError,
  acquireLease,
  checkLease,
  heartbeatLease,
  isNoAutolaunch,
  leaseBlocker,
  releaseLease as releaseLeaseFile,
  resolveLeasePath,
  resolveNoAutolaunchPath,
  updateLease,
  type LeaseCheck,
  type LeaseDeps,
} from "./lease.js";
import { LaunchWatchdog } from "./launch-watchdog.js";
import { pruneStaleHandlers } from "./handler-prune.js";
import { inspectProcessWindows, nudgeEnfusionLauncher } from "./launcher-nudge.js";
import { WorkbenchLaunchTracker, snapshotSessionDirs } from "./launch-tracker.js";
import { buildPreflightNote, buildStuckReport, buildTimeoutDiagnostics } from "./launch-reports.js";
import { checkWorkbenchVisibleDeps, type WbDepsCheck } from "./wb-deps.js";

const DEFAULT_CLIENT_ID = "EnfusionMCP";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Maximum response size (10 MB) to prevent memory exhaustion from malformed/unexpected data. */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;
const WORKBENCH_EXE = "ArmaReforgerWorkbenchSteamDiag.exe";
const WORKBENCH_SUBDIR = "Workbench";
const HANDLER_FOLDER = "EnfusionMCP";
const LAUNCH_POLL_INTERVAL_MS = 3_000;
const LAUNCH_TIMEOUT_MS = 90_000;
/** How long to wait for Workbench to recompile handler scripts after installation. */
const HANDLER_RECOMPILE_TIMEOUT_MS = 30_000;
/** Interval between polls while waiting for handler script recompilation. */
const HANDLER_RECOMPILE_POLL_MS = 2_000;
/**
 * Substring of the NET API error returned when a handler isn't registered
 * (Workbench is up but our EMCP_* handlers haven't compiled). Used by both the
 * recovery path and diagnose() so they classify the same condition identically.
 */
const NO_HANDLERS_ERROR = "Undefined API func";
/**
 * Lease holder id of this server process (plan 5.1: "registered:<pid>"), with a
 * per-process nonce so a later server that happens to reuse a crashed server's
 * pid never mistakes that server's lease for its own.
 */
export const LEASE_SESSION = `registered:${process.pid}-${randomBytes(3).toString("hex")}`;
/** Lease purpose recorded by this server. */
const LEASE_PURPOSE = "registered-server";
/** Minimum interval between two heartbeat writes of our own lease. */
const LEASE_HEARTBEAT_MS = 60_000;

// ── Call queue constants (DEC-048 package A, from DEC-042 / DEC-047) ────────

/**
 * Back-off before each retry of a READ-ONLY call whose connection was
 * refused. U30 (DEC-042 sd-11, DEC-047): "the listener holds two pending
 * connections and queues nothing beyond them"; the five extra sockets were
 * refused in 3 ms while the two accepted calls answered in 16 and 22 ms, so a
 * short back-off clears a burst. Mutating calls are never retried.
 */
export const REFUSAL_RETRY_DELAYS_MS: readonly number[] = [25, 75, 200];

/**
 * A reset at or after this age (no bytes received) is read as the modal
 * reset of U6 (DEC-042 sd-21/sd-22): "both pending connections had been
 * reset after 120 s on the engine's side (`read ECONNRESET`)". The bound sits
 * below 120 s so clock skew does not misfile it.
 */
export const MODAL_RESET_MIN_MS = 100_000;

/**
 * Wedge threshold: an in-flight call with no answer and no reset past this
 * age is a wedge. U6 says a blocked queue is reset at about 120 s, so silence
 * well beyond that is not the modal case. The wedge is reported (WEDGED),
 * never retried.
 */
export const WEDGE_AFTER_MS = 150_000;

/**
 * Bundled handler file that will carry the build stamp once the Enforce side
 * lands (DEC-048 package A). It is left out of the bundle digest so the stamp
 * does not hash itself.
 */
export const BUILD_STAMP_FILE = "EMCP_WB_BuildStamp.c";

/** Ping: read-only, ahead of waiting calls, no auto-launch. */
const PING_OPTIONS: WorkbenchCallOptions = {
  timeout: 3000,
  skipAutoLaunch: true,
  access: "read",
  priority: "high",
};

export type WorkbenchMode = "edit" | "play" | "unknown";

export interface DiagnosticReport {
  host: string;
  port: number;
  workbenchExe: { path: string; exists: boolean } | null;
  projectPath: { path: string; exists: boolean } | null;
  defaultMod: string | null;
  bundledScripts: { path: string; exists: boolean };
  standaloneAddon: { path: string; exists: boolean; fileCount: number };
  installedMods: Array<{ modDir: string; handlerDir: string; fileCount: number }>;
  /** Result of the NET API probe. */
  netApi: "up_with_handlers" | "up_no_handlers" | "refused" | "timeout" | "error";
  netApiError?: string;
  /**
   * Workbench lease state (null when the client has no Config). `ours` is
   * true when the lease file names this server process as the holder.
   */
  lease: { path: string; check: LeaseCheck; ours: boolean; session: string } | null;
  /** No-autolaunch marker (null when the client has no Config). */
  noAutolaunch: { path: string; exists: boolean } | null;
}

export interface WorkbenchState {
  connected: boolean;
  mode: WorkbenchMode;
  lastUpdated: number;
}

export interface WorkbenchCallOptions {
  /** Timeout in milliseconds (default 10 000). Counted from dispatch, not from enqueue. */
  timeout?: number;
  /** Skip auto-launch on connection failure (used internally by ping). */
  skipAutoLaunch?: boolean;
  /**
   * What the call does. "read": a refused connection is retried with
   * back-off (U30) and a modal reset reports MODAL_OPEN. Anything else
   * (default "mutate", the conservative reading for an unclassified call):
   * never retried, and a reset connection reports LOST (U6, DEC-042).
   */
  access?: "read" | "mutate";
  /** Queue priority: "high" calls (liveness probes) go ahead of waiting "normal" ones. */
  priority?: "high" | "normal";
  /**
   * Accept an "Ok" status with no payload, or an empty one, as `{}`. For
   * native functions (DEC-040 sc-08); handlers keep the strict default.
   */
  allowEmptyPayload?: boolean;
}

export class WorkbenchError extends Error {
  /** Set on a LOST that came from an early reset: the connection died, Workbench may be gone. */
  connectionDropped = false;
  /** Set on a LOST that came from the client's own timer: no answer at all in the time given. */
  timedOut = false;

  constructor(
    message: string,
    public readonly code:
      | "CONNECTION_REFUSED"
      | "TIMEOUT"
      | "PROTOCOL_ERROR"
      | "API_ERROR"
      | "LAUNCH_FAILED"
      /**
       * A launch is already in flight for a DIFFERENT .gproj than the one
       * requested. The caller must wait for that launch (or stop Workbench)
       * rather than joining it — joining would report the wrong project as
       * launched. `message` names both projects.
       */
      | "LAUNCH_MISMATCH"
      /**
       * The machine-wide Workbench lease belongs to another session (held,
       * orphaned, or the lease file is corrupt). Nothing was sent to
       * Workbench, installed or spawned. `message` carries the lease
       * description so the caller can tell the owner who holds it.
       */
      | "LEASE_HELD"
      /**
       * Auto-launch was refused: the no-autolaunch marker exists, or no
       * explicit project is known (no usable config.defaultMod). Nothing was
       * installed or spawned. The remedy is wb_launch with an explicit
       * gprojPath. `message` names the reason (and the marker path).
       */
      | "AUTOLAUNCH_REFUSED"
      /**
       * A read-only call's connection was reset after about 120 s with no
       * answer: a modal dialog inside a handler blocks the NET queue and the
       * engine resets the pending connections (U6, DEC-042). Workbench is
       * still alive; the dialog needs a human. Not a timeout.
       */
      | "MODAL_OPEN"
      /**
       * A mutating (or unclassified) call's connection was reset before an
       * answer: whether the change was applied is unknown. Never retried
       * automatically; the caller reads the state back (U6, DEC-042).
       */
      | "LOST"
      /**
       * No answer and no reset past WEDGE_AFTER_MS, or the queue is held by
       * such a call. Reported, never retried.
       */
      | "WEDGED" = "API_ERROR",
  ) {
    super(message);
    this.name = "WorkbenchError";
  }
}

/**
 * Normalise a .gproj path for identity comparison (absolute, forward
 * slashes, case-folded on win32 where the file system is case-insensitive).
 */
function normalizeGprojKey(p: string): string {
  const abs = resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/** A classified Ping answer (WorkbenchClient.pingStatus). */
export type PingStatus =
  | { kind: "up" }
  | { kind: "refused" | "no_handlers" | "timeout" | "error"; message: string };

/** Options of ensureRunning() / launchWorkbench(). */
export interface LaunchOptions {
  /** `-forceSettings <ini>` for a scratch-profile launch (U12). */
  forceSettings?: string;
  /**
   * When Workbench already answers: refuse (LAUNCH_MISMATCH) unless the
   * requested .gproj is loaded in it, instead of joining any project
   * (wb_launch's explicit gprojPath; live-client-04).
   */
  requireProject?: boolean;
}

/** The refusal for a Workbench that runs but did not answer Ping as expected. */
function runningNotAnsweringError(
  status: Exclude<PingStatus, { kind: "up" } | { kind: "refused" }>,
): WorkbenchError {
  const why =
    status.kind === "no_handlers"
      ? "it answers, but the EnfusionMCP handlers are not loaded in it"
      : status.kind === "timeout"
        ? "it did not answer Ping within 3 s (busy, e.g. loading a world)"
        : `its Ping answer was not usable (${status.message})`;
  return new WorkbenchError(
    `Workbench is already running: ${why}. No second Workbench was started: Steam's launcher ` +
      "would forward the arguments to the open one and drop its session. Retry when it is " +
      "idle, or close it first.",
    "LAUNCH_FAILED",
  );
}

/** Title written into the generated standalone addon .gproj (marker for cleanup). */
const STANDALONE_GPROJ_TITLE = "EnfusionMCP Handlers";

/** A handler script the installer copies (the bundle's file names). */
const HANDLER_SCRIPT_NAME = /^EMCP_[A-Za-z0-9_]+\.c$/;

/** Plain entries of `dir` (null when unreadable), each tagged as directory or not. */
function listEntries(dir: string): { name: string; dir: boolean }[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      dir: e.isDirectory(),
    }));
  } catch {
    return null;
  }
}

/**
 * True when `dir` is the standalone addon an earlier release of THIS package
 * generated (1.x wrote `<projectPath>/EnfusionMCP/` as a fallback addon), and
 * holds nothing but what that generator wrote:
 *   EnfusionMCP.gproj carrying the generated TITLE "EnfusionMCP Handlers", and
 *   optionally Scripts/WorkbenchGame/EnfusionMCP/ holding only EMCP_*.c files.
 * The handler scripts alone prove nothing: the installer copies them into
 * every project it launches, a user project named EnfusionMCP included
 * (total audit live-client-01). Any other file or folder means a user has
 * worked in it, and the directory must survive. Exported for tests.
 */
export function isOurStandaloneAddon(dir: string): boolean {
  const top = listEntries(dir);
  if (!top) return false;
  const gprojName = `${HANDLER_FOLDER}.gproj`;
  let sawGproj = false;
  for (const e of top) {
    if (!e.dir && e.name === gprojName) {
      sawGproj = true;
    } else if (!(e.dir && e.name === "Scripts")) {
      return false;
    }
  }
  if (!sawGproj) return false;
  let gprojText: string;
  try {
    gprojText = readFileSync(join(dir, gprojName), "utf-8");
  } catch {
    return false;
  }
  if (!new RegExp(`^\\s*TITLE\\s+"${STANDALONE_GPROJ_TITLE}"\\s*$`, "m").test(gprojText)) {
    return false;
  }
  if (!top.some((e) => e.name === "Scripts")) return true;
  // Scripts/ may hold only WorkbenchGame/EnfusionMCP/EMCP_*.c (or stop empty on the way).
  let cur = join(dir, "Scripts");
  for (const child of ["WorkbenchGame", HANDLER_FOLDER]) {
    const entries = listEntries(cur);
    if (!entries) return false;
    if (entries.length === 0) return true;
    if (entries.length !== 1 || !entries[0].dir || entries[0].name !== child) return false;
    cur = join(cur, child);
  }
  const scripts = listEntries(cur);
  if (!scripts) return false;
  return scripts.every((e) => !e.dir && HANDLER_SCRIPT_NAME.test(e.name));
}

/** True when `a` and `b` are the same directory, or one lies inside the other. */
function pathsOverlap(a: string, b: string): boolean {
  const ka = normalizeGprojKey(a);
  const kb = normalizeGprojKey(b);
  return ka === kb || ka.startsWith(`${kb}/`) || kb.startsWith(`${ka}/`);
}

/**
 * Content digest of the `.c` handler set in `dir` (name + bytes of every
 * file, sorted). Returns null when the directory is missing/unreadable, so a
 * missing install never compares equal to the bundled set. Exported for tests.
 */
export function handlerSetDigest(dir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((f) => f.endsWith(".c"))
      .sort();
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const h = createHash("sha1");
  for (const name of names) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      return null;
    }
    h.update(name);
    h.update("\0");
    h.update(bytes);
    h.update("\0");
  }
  return h.digest("hex");
}

/**
 * The .gproj inside one addon directory: `<name>.gproj` when present,
 * otherwise the alphabetically first .gproj (a project file need not match
 * its folder name). Null when the directory is missing or holds none.
 */
function findGprojInDir(dir: string, name?: string): string | null {
  let gprojs: string[];
  try {
    gprojs = readdirSync(dir, { withFileTypes: true })
      .filter((f) => !f.isDirectory() && f.name.toLowerCase().endsWith(".gproj"))
      .map((f) => f.name)
      .sort();
  } catch {
    return null;
  }
  if (gprojs.length === 0) return null;
  const preferred = name
    ? gprojs.find((f) => f.toLowerCase() === `${name.toLowerCase()}.gproj`)
    : undefined;
  return join(dir, preferred ?? gprojs[0]);
}

/**
 * The explicit auto-launch project: the .gproj of the addon that
 * `config.defaultMod` names under `config.projectPath`. Null when either is
 * unset or the addon holds no .gproj. Never falls back to another addon.
 */
export function findDefaultModGproj(config: Config | undefined): string | null {
  const addonsDir = config?.projectPath;
  const mod = config?.defaultMod;
  if (!addonsDir || !mod) return null;
  return findGprojInDir(join(addonsDir, mod), mod);
}

/** Outcome of mapping a GetLoadedProjects payload onto .gproj files on disk. */
export interface OpenProjectResolution {
  /** The single resolved .gproj, or null when none or several resolved. */
  gproj: string | null;
  /** Every distinct .gproj a loaded-project entry resolved to. */
  candidates: string[];
  /** The entries Workbench reported, rendered as text for messages. */
  entries: string[];
}

/** True for a bare addon name (no separators, not "." or ".."). */
function isPlainName(s: string): boolean {
  return s.length > 0 && s !== "." && s !== ".." && !/[\\/]/.test(s);
}

/**
 * Map the built-in GetLoadedProjects response onto the open project's
 * .gproj. Live-verified shape (see tools/wb-projects.ts):
 * `{ "Loaded Projects": ["ArmaReforger", "<addon>"] }` — names only, the
 * base game plus the open project (and its dependencies). The `projects` /
 * `addons` arrays and `{ name, path }` entries are the variants
 * formatLoadedProjects() also accepts [unverified].
 *
 * A name resolves only to `<projectPath>/<name>/` holding a .gproj; an entry
 * with a `path` resolves to that .gproj (or the .gproj inside that
 * directory). Exactly one distinct result is required: several (the open
 * project plus a user-addon dependency) are ambiguous because the entry
 * order is [unverified], so the caller refuses rather than guesses.
 * Exported for tests.
 */
export function resolveLoadedProjectGproj(
  result: Record<string, unknown>,
  projectPath: string | undefined,
): OpenProjectResolution {
  const loaded = result["Loaded Projects"];
  const list: unknown[] = Array.isArray(loaded)
    ? loaded
    : Array.isArray(result.projects)
      ? result.projects
      : Array.isArray(result.addons)
        ? result.addons
        : [];

  const byName = (name: string): string | null =>
    projectPath && isPlainName(name) ? findGprojInDir(join(projectPath, name), name) : null;
  const byPath = (p: string, name?: string): string | null => {
    if (p.toLowerCase().endsWith(".gproj")) return existsSync(p) ? resolve(p) : null;
    try {
      return statSync(p).isDirectory() ? findGprojInDir(p, name) : null;
    } catch {
      return null;
    }
  };

  const entries: string[] = [];
  const found = new Map<string, string>();
  for (const entry of list) {
    let gproj: string | null = null;
    if (typeof entry === "string") {
      entries.push(entry);
      gproj = entry.toLowerCase().endsWith(".gproj") ? byPath(entry) : byName(entry);
    } else if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const name =
        typeof e.name === "string" ? e.name : typeof e.id === "string" ? e.id : undefined;
      const path = typeof e.path === "string" ? e.path : undefined;
      entries.push(JSON.stringify(entry));
      gproj = path ? byPath(path, name) : name ? byName(name) : null;
    } else {
      entries.push(String(entry));
    }
    if (gproj) found.set(normalizeGprojKey(gproj), gproj);
  }
  const candidates = [...found.values()];
  return { gproj: candidates.length === 1 ? candidates[0] : null, candidates, entries };
}

// ── Serial call queue (U30, U6; DEC-048 package A) ───────────────────────────

/** Clock and timers for the queue; injectable for tests. */
export interface CallQueueDeps {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface QueueJob {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  priority: "high" | "normal";
  label: string;
}

/**
 * One call at a time, plus one liveness probe. U30 (DEC-042, DEC-047 L1): the
 * listener holds two pending connections and refuses the rest, so "normal"
 * jobs run one at a time and "high" jobs (read-only probes: ping, liveness)
 * run one at a time on a lane of their own. A probe is therefore sent while a
 * long call is in flight instead of waiting behind it; never more than two
 * connections are open.
 *
 * Wedge detector: when the job in flight has had neither an answer nor a
 * reset for `wedgeAfterMs`, every waiting "normal" job and every new one is
 * rejected with WEDGED (reported, not retried) until the job in flight
 * settles. Probes still go out on their lane.
 */
export class CallQueue {
  private readonly waiting: QueueJob[] = [];
  private current: { label: string; startedAt: number; timer: unknown } | null = null;
  private wedged = false;
  /** Tail of the probe lane: "high" jobs chain on it, one at a time. */
  private probeTail: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly wedgeAfterMs: number = WEDGE_AFTER_MS,
    deps: CallQueueDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return t;
      });
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  }

  /** Jobs waiting behind the one in flight. */
  get depth(): number {
    return this.waiting.length;
  }

  /** The job in flight and its age, or null when idle. */
  inFlight(): { label: string; ageMs: number; wedged: boolean } | null {
    if (!this.current) return null;
    return {
      label: this.current.label,
      ageMs: this.now() - this.current.startedAt,
      wedged: this.wedged,
    };
  }

  run<T>(label: string, fn: () => Promise<T>, priority: "high" | "normal" = "normal"): Promise<T> {
    if (priority === "high") {
      // The probe lane: after the probe before it, whatever the normal lane does.
      const result = this.probeTail.then(fn, fn);
      this.probeTail = result.catch(() => undefined);
      return result;
    }
    if (this.wedged) return Promise.reject(this.wedgeError(label));
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        run: fn,
        resolve: resolve as (v: unknown) => void,
        reject,
        priority,
        label,
      });
      this.pump();
    });
  }

  private wedgeError(label: string): WorkbenchError {
    const cur = this.current;
    return new WorkbenchError(
      `Workbench call "${label}" not sent: "${cur?.label ?? "?"}" has had no answer and no reset ` +
        `for ${cur ? this.now() - cur.startedAt : 0} ms (wedge threshold ${this.wedgeAfterMs} ms). ` +
        "A modal would have reset the queue at about 120 s (U6); look at the Workbench window. Not retried.",
      "WEDGED",
    );
  }

  private pump(): void {
    if (this.current) return;
    const job = this.waiting.shift();
    if (!job) return;
    const timer = this.setTimer(() => {
      if (!this.current) return;
      this.wedged = true;
      for (const w of this.waiting.splice(0)) w.reject(this.wedgeError(w.label));
    }, this.wedgeAfterMs);
    this.current = { label: job.label, startedAt: this.now(), timer };
    let p: Promise<unknown>;
    try {
      p = job.run();
    } catch (e) {
      p = Promise.reject(e);
    }
    void p.then(job.resolve, job.reject).finally(() => {
      if (this.current) this.clearTimer(this.current.timer);
      this.current = null;
      this.wedged = false;
      this.pump();
    });
  }
}

/**
 * Error code for a connection reset before any answer (U6, DEC-042): a
 * mutating call is LOST whatever its age; a read-only call reset at or after
 * MODAL_RESET_MIN_MS is MODAL_OPEN; an early reset of a read-only call stays
 * a PROTOCOL_ERROR.
 */
export function classifyReset(
  access: "read" | "mutate",
  elapsedMs: number,
): "LOST" | "MODAL_OPEN" | "PROTOCOL_ERROR" {
  if (access !== "read") return "LOST";
  return elapsedMs >= MODAL_RESET_MIN_MS ? "MODAL_OPEN" : "PROTOCOL_ERROR";
}

/**
 * Error code for a call that timed out with no answer and no reset: past the
 * wedge threshold it is WEDGED (a modal would have reset it at about 120 s,
 * U6); before it a mutating (or unclassified) call is LOST, since whether it
 * took effect is unknown, and a read-only call a plain TIMEOUT.
 *
 * MODAL_OPEN needs the engine's reset to arrive before the client's own
 * timer, so only a call whose timeout exceeds MODAL_RESET_MIN_MS (in
 * practice the about-120 s reset: the compile natives' 140 s) can report it;
 * a 10 s default call blocked by a modal reports TIMEOUT or LOST.
 */
export function classifyTimeout(
  timeoutMs: number,
  wedgeAfterMs: number = WEDGE_AFTER_MS,
  access: "read" | "mutate" = "read",
): "TIMEOUT" | "WEDGED" | "LOST" {
  if (timeoutMs >= wedgeAfterMs) return "WEDGED";
  return access === "read" ? "TIMEOUT" : "LOST";
}

// ── Handler build stamp (DEC-048 package A) ──────────────────────────────────

/** The bundled handler folder inside this package. */
export function bundledHandlerDir(): string {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return join(packageRoot, "mod", "Scripts", "WorkbenchGame", HANDLER_FOLDER);
}

/**
 * Digest of the bundled handler set: sha1 over name and bytes of every `.c`
 * file in `dir`, sorted, BUILD_STAMP_FILE left out, CRLF read as LF. Null when unreadable.
 */
export function bundleDigest(dir: string = bundledHandlerDir()): string | null {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((f) => f.endsWith(".c") && f !== BUILD_STAMP_FILE)
      .sort();
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const h = createHash("sha1");
  for (const name of names) {
    try {
      h.update(name);
      h.update("\0");
      // CRLF folded to LF: the stamp must not depend on how git checked the tree out.
      h.update(normalizeEol(readFileSync(join(dir, name))));
      h.update("\0");
    } catch {
      return null;
    }
  }
  return h.digest("hex");
}

/** The bytes with every CRLF pair replaced by LF (other bytes untouched). */
function normalizeEol(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}

export interface BuildStampCheck {
  /** "absent": Ping carried no `buildStamp` (the Enforce side has not landed). */
  status: "match" | "mismatch" | "absent" | "no-bundle";
  stamp: string | null;
  bundle: string | null;
  warning?: string;
}

/**
 * Compare Ping's `buildStamp` with the bundle digest. A missing stamp is
 * tolerated with a warning: the Enforce side lands later (DEC-048 package A).
 */
export function checkBuildStamp(pingResponse: unknown, bundle: string | null): BuildStampCheck {
  const raw =
    typeof pingResponse === "object" && pingResponse !== null
      ? (pingResponse as Record<string, unknown>).buildStamp
      : undefined;
  const stamp = typeof raw === "string" && raw.length > 0 ? raw : null;
  if (!bundle) {
    return {
      status: "no-bundle",
      stamp,
      bundle,
      warning: "the bundled handler folder is missing or empty; no digest to compare",
    };
  }
  if (!stamp) {
    return {
      status: "absent",
      stamp,
      bundle,
      warning:
        "EMCP_WB_Ping carries no buildStamp: the loaded handlers cannot be matched to this server's bundle",
    };
  }
  if (stamp.toLowerCase() === bundle.toLowerCase()) return { status: "match", stamp, bundle };
  return {
    status: "mismatch",
    stamp,
    bundle,
    warning: `the loaded handlers (buildStamp ${stamp}) differ from this server's bundle (${bundle}): close Workbench and start it again with wb_launch, which reinstalls them (wb_launch does not reinstall into a running Workbench)`,
  };
}

// ── Launch arguments (DEC-047 L7) ────────────────────────────────────────────

/** The line `-validate=<CFG>` logs on success; it never exits by itself (DEC-035, DEC-047 L7). */
export const VALIDATE_SUCCESS_LINE = "Script validation successful.";

/** True for a log line that carries the `-validate` success line. */
export function isValidateSuccessLine(line: string): boolean {
  return line.includes(VALIDATE_SUCCESS_LINE);
}

export interface WorkbenchLaunchArgs {
  /** The project to open: always passed as `-gproj <path>` (DEC-047 L7). */
  gproj: string;
  /** `-exitAfterInit`: exits by itself, code 0 (DEC-047 U1). */
  exitAfterInit?: boolean;
  /** `-validate=<CFG>`: the caller ends the process on VALIDATE_SUCCESS_LINE. */
  validate?: string;
  /** `-plugin=<name>` and its arguments, each `-key=value` as ONE token (DEC-047 L7, U1). */
  plugin?: { name: string; args?: Record<string, string> };
  /** Scratch profile: `-forceSettings <ini>` (U12, DEC-038). */
  forceSettings?: string;
}

const FLAG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Authorises every script module, so no launch waits on the Workbench's per-addon script
 * authorisation prompt. On every Workbench this server starts, with a window or headless
 * (owner ruling 2026-11-06, the 2.0 release standard; it replaces the owner-go of plan 5.7).
 */
export const SCRIPT_AUTHORIZE_ALL = "-scriptAuthorizeAll";

/** False only when ENFUSION_NO_SCRIPT_AUTHORIZE_ALL=1 turns the standard off for this process. */
export function scriptAuthorizeAllEnabled(): boolean {
  return process.env.ENFUSION_NO_SCRIPT_AUTHORIZE_ALL !== "1";
}

/** `args` with SCRIPT_AUTHORIZE_ALL appended, once, unless it is turned off. */
export function withScriptAuthorizeAll(args: readonly string[]): string[] {
  const out = [...args];
  if (scriptAuthorizeAllEnabled() && !out.includes(SCRIPT_AUTHORIZE_ALL)) {
    out.push(SCRIPT_AUTHORIZE_ALL);
  }
  return out;
}

/**
 * The Workbench command line (DEC-047 L7). `-wbProjectPath`, `-config=` and
 * `-logCRC` are never produced. Throws on a flag-shaped path or a bad name.
 */
export function buildWorkbenchArgs(a: WorkbenchLaunchArgs): string[] {
  if (a.gproj.startsWith("-")) throw new Error(`Refusing flag-shaped project path: ${a.gproj}`);
  if (!a.gproj.toLowerCase().endsWith(".gproj")) {
    throw new Error(`Project path must be a .gproj file: ${a.gproj}`);
  }
  const args = withScriptAuthorizeAll(["-gproj", a.gproj]);
  if (a.forceSettings !== undefined) {
    if (a.forceSettings.startsWith("-")) {
      throw new Error(`Refusing flag-shaped settings path: ${a.forceSettings}`);
    }
    args.push("-forceSettings", a.forceSettings);
  }
  if (a.validate !== undefined) {
    if (!FLAG_NAME.test(a.validate)) throw new Error(`Bad -validate configuration: ${a.validate}`);
    args.push(`-validate=${a.validate}`);
  }
  if (a.plugin) {
    if (!FLAG_NAME.test(a.plugin.name)) throw new Error(`Bad plugin name: ${a.plugin.name}`);
    args.push(`-plugin=${a.plugin.name}`);
    for (const [k, v] of Object.entries(a.plugin.args ?? {})) {
      if (!FLAG_NAME.test(k)) throw new Error(`Bad plugin argument name: ${k}`);
      args.push(`-${k}=${v}`);
    }
  }
  if (a.exitAfterInit) args.push("-exitAfterInit");
  return args;
}

export class WorkbenchClient {
  private launchPromise: Promise<void> | null = null;
  /**
   * The .gproj the in-flight launch is opening (null while resolving, or
   * when no launch is in flight). Set from the caller's explicit request in
   * ensureRunning() and refined to the resolved defaultMod project inside
   * launchWorkbench(), so a later ensureRunning(otherGproj) can refuse.
   */
  private launchTarget: string | null = null;
  private recoverPromise: Promise<void> | null = null;
  private _state: WorkbenchState = { connected: false, mode: "unknown", lastUpdated: 0 };

  /**
   * Human-readable notes from the most recent launchWorkbench run (e.g.
   * "launcher picker was auto-confirmed", dependency warnings). Reset at
   * each launch; tools may surface them alongside their own output.
   */
  lastLaunchNotes: string[] = [];

  /** Clock and liveness probe passed to the lease module; injectable for tests. */
  leaseDeps: LeaseDeps = {};
  /** When this client last wrote our lease's heartbeat (lease clock, ms); 0 = never. */
  private lastHeartbeatAt = 0;

  /**
   * PIDs of running Workbench processes, checked right before a GUI spawn
   * (the same tasklist probe the headless runs use); replaceable for tests.
   */
  workbenchPids: () => number[] = () => runningWorkbenchPids();

  /** Serial queue every NET exchange goes through (U30); replaceable for tests. */
  queue: CallQueue = new CallQueue();
  /** Back-off before each retry of a refused read-only call; replaceable for tests. */
  refusalRetryDelaysMs: readonly number[] = REFUSAL_RETRY_DELAYS_MS;
  /** The last ping's build-stamp comparison (null before the first answered ping). */
  lastBuildCheck: BuildStampCheck | null = null;
  /** bundleDigest() of this process's bundle, read at the first answered ping. */
  private bundleDigestCache: string | null | undefined;

  /** Current cached connection state. Updated after every successful call. */
  get state(): Readonly<WorkbenchState> {
    return this._state;
  }

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly config?: Config,
    private readonly clientId: string = DEFAULT_CLIENT_ID,
  ) {}

  /**
   * Call a Workbench NET API function.
   * Takes or refreshes the Workbench lease first (LEASE_HELD when another
   * session holds it; nothing is sent). Auto-launches Workbench if not
   * running, but only for an explicit project (config.defaultMod) and never
   * while the no-autolaunch marker exists (AUTOLAUNCH_REFUSED).
   */
  async call<T = Record<string, unknown>>(
    apiFunc: string,
    params: Record<string, unknown> = {},
    options: WorkbenchCallOptions = {},
  ): Promise<T> {
    this.claimLease();
    try {
      const result = await this.rawCall<T>(apiFunc, params, options);
      this._state.connected = true;
      this._state.lastUpdated = Date.now();
      this.extractMode(result);
      return result;
    } catch (err) {
      if (err instanceof WorkbenchError) {
        if (
          err.code === "CONNECTION_REFUSED" ||
          err.code === "TIMEOUT" ||
          err.code === "PROTOCOL_ERROR" ||
          // A LOST with no answer (dropped or timed out) is no proof of a live
          // Workbench: the next answered call or ping sets the state again.
          (err.code === "LOST" && (err.connectionDropped || err.timedOut))
        ) {
          this._state = { connected: false, mode: "unknown", lastUpdated: Date.now() };
        }
        if (!options.skipAutoLaunch && this.config) {
          if (err.code === "CONNECTION_REFUSED") {
            // Workbench not running — launch the explicit project (or refuse),
            // install handlers into it, retry.
            const gproj = this.resolveAutoLaunchGproj();
            logger.info(`Workbench not running, auto-launching ${gproj}...`);
            await this.ensureRunning(gproj);
            const result = await this.rawCall<T>(apiFunc, params, options);
            this._state.connected = true;
            this._state.lastUpdated = Date.now();
            this.extractMode(result);
            return result;
          }
          if (err.code === "API_ERROR" && err.message.includes(NO_HANDLERS_ERROR)) {
            // Workbench is running but our custom handler scripts aren't compiled.
            // This happens when the user opened Workbench manually, or when handlers
            // were cleaned up but Workbench kept running.
            logger.info("Handler scripts not loaded in Workbench, recovering...");
            await this.recoverMissingHandlers();
            const result = await this.rawCall<T>(apiFunc, params, options);
            this._state.connected = true;
            this._state.lastUpdated = Date.now();
            this.extractMode(result);
            return result;
          }
        }
      }
      throw err;
    }
  }

  /**
   * Record the mode a successful play/stop switched to. EMCP_WB_EditorControl's answer carries
   * no `mode` field, so extractMode cannot see the switch (live-tools-a-07).
   */
  noteMode(mode: "edit" | "play"): void {
    this._state.mode = mode;
    this._state.lastUpdated = Date.now();
  }

  /**
   * Explicitly refresh cached state by calling EMCP_WB_GetState.
   */
  async refreshState(): Promise<WorkbenchState> {
    try {
      // GetState is a read (READ_ONLY_LABELS in wb-scripts.ts): a timeout is TIMEOUT, not LOST.
      await this.call<Record<string, unknown>>("EMCP_WB_GetState", {}, { access: "read" });
      return { ...this._state };
    } catch {
      this._state = { connected: false, mode: "unknown", lastUpdated: Date.now() };
      return { ...this._state };
    }
  }

  /**
   * Ensure Workbench is running. Installs handler scripts, launches exe,
   * and waits for NET API. Safe to call concurrently — deduplicates launches.
   * Takes the Workbench lease first (LEASE_HELD when another session holds
   * it; nothing is installed or spawned). An explicit project works even
   * while the no-autolaunch marker exists.
   * @param gprojPath .gproj file path to open directly (skips launcher). When
   *   omitted, only config.defaultMod's project is used, and only while the
   *   no-autolaunch marker is absent; otherwise AUTOLAUNCH_REFUSED.
   */
  async ensureRunning(gprojPath?: string, launchOptions: LaunchOptions = {}): Promise<void> {
    if (!this.config) {
      throw new WorkbenchError(
        "No config provided — cannot auto-launch Workbench.",
        "LAUNCH_FAILED",
      );
    }
    this.claimLease();

    // Deduplicate concurrent calls — callers that want ANY Workbench (no
    // gprojPath) or the SAME project join the in-flight launch. A caller
    // asking for a DIFFERENT project must not join: it would return once the
    // other project is up and let the tool report handlers installed into
    // the wrong mod. Refuse with LAUNCH_MISMATCH so the tool can render it.
    if (this.launchPromise) {
      if (gprojPath && this.launchTarget && normalizeGprojKey(gprojPath) !== this.launchTarget) {
        throw new WorkbenchError(
          "A Workbench launch is already in progress for a different project " +
            `(${this.launchTargetDisplay ?? this.launchTarget}); refusing to launch ${gprojPath}. ` +
            "Wait for the in-flight launch to finish (wb_state / wb_diagnose), then stop Workbench " +
            "with wb_stop before launching another project.",
          "LAUNCH_MISMATCH",
        );
      }
      return this.launchPromise;
    }

    // Record the project this session is about to open in the lease, so a
    // reader of the lease file sees what the holder is doing.
    if (gprojPath) this.recordLeaseLaunch({ project: resolve(gprojPath) });

    this.launchTarget = gprojPath ? normalizeGprojKey(gprojPath) : null;
    this.launchTargetDisplay = gprojPath ?? null;
    const promise = this.launchWorkbench(gprojPath, launchOptions).finally(() => {
      // Only clear if this is still the active promise (guards against re-entrant calls)
      if (this.launchPromise === promise) {
        this.launchPromise = null;
        this.launchTarget = null;
        this.launchTargetDisplay = null;
      }
    });

    this.launchPromise = promise;
    return promise;
  }

  /** Human-readable form of `launchTarget` (original path as given/resolved). */
  private launchTargetDisplay: string | null = null;

  /**
   * The .gproj an in-flight launch is opening, or null when no launch is in
   * progress. Tools can use this to explain a LAUNCH_MISMATCH refusal.
   */
  get inFlightLaunchTarget(): string | null {
    return this.launchPromise ? this.launchTargetDisplay : null;
  }

  /**
   * Quick health check. Returns true if Workbench responds, false otherwise.
   * Does NOT auto-launch.
   *
   * Uses our custom EMCP_WB_Ping handler (not the built-in GetLoadedProjects)
   * so the launch poller only succeeds once the mod's handler scripts have
   * finished compiling — avoiding a race where the NET API socket is up but
   * custom handlers aren't loaded yet.
   */
  async ping(): Promise<boolean> {
    return (await this.pingStatus()).kind === "up";
  }

  /**
   * The Ping answer, classified. Only "refused" means no NET API listens; a
   * Workbench without our handlers ("no_handlers"), one too busy to answer
   * in 3 s ("timeout") or one that answered oddly ("error") is RUNNING, and a
   * launch must not spawn a second one (total audit live-client-02).
   */
  async pingStatus(): Promise<PingStatus> {
    try {
      const r = await this.rawCall("EMCP_WB_Ping", {}, PING_OPTIONS);
      this.recordBuildCheck(r);
      return { kind: "up" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof WorkbenchError) {
        if (err.code === "CONNECTION_REFUSED") return { kind: "refused", message };
        if (err.code === "TIMEOUT") return { kind: "timeout", message };
        if (err.code === "API_ERROR" && err.message.includes(NO_HANDLERS_ERROR)) {
          return { kind: "no_handlers", message };
        }
      }
      return { kind: "error", message };
    }
  }

  /**
   * Which project the running Workbench has open, compared with `gprojPath`
   * (built-in GetLoadedProjects, read-only, works without our handlers).
   *   "loaded"   the project is among the loaded projects (open, or loaded
   *              as a dependency of the open one: the entry order is
   *              [unverified], so the two cannot be told apart)
   *   "other"    Workbench answered and the project is not loaded
   *   "unknown"  the question could not be asked or answered
   * Never throws. Total audit live-client-04.
   */
  async openProjectMatch(
    gprojPath: string,
  ): Promise<{ match: "loaded" | "other" | "unknown"; reported: string }> {
    let result: Record<string, unknown>;
    try {
      result = await this.probe<Record<string, unknown>>(
        "GetLoadedProjects",
        {},
        { timeout: 5000 },
      );
    } catch (e) {
      return {
        match: "unknown",
        reported: `GetLoadedProjects failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const resolution = resolveLoadedProjectGproj(result, this.config?.projectPath);
    const reported =
      resolution.entries.length > 0
        ? resolution.entries.join(", ")
        : `no project list (payload keys: ${Object.keys(result).join(", ") || "none"})`;
    if (resolution.entries.length === 0) return { match: "unknown", reported };
    const want = normalizeGprojKey(gprojPath);
    // An entry is a name (the folder name or the .gproj ID; which one is
    // [unverified]) or a path that resolved to a .gproj on disk.
    const names = new Set([basename(dirname(resolve(gprojPath))).toLowerCase()]);
    try {
      const id = /^\s*ID\s+"([^"\r\n]+)"/m.exec(readFileSync(gprojPath, "utf-8"));
      if (id) names.add(id[1].toLowerCase());
    } catch {
      /* unreadable .gproj: the folder name still counts */
    }
    const loaded =
      resolution.candidates.some((c) => normalizeGprojKey(c) === want) ||
      resolution.entries.some((e) => names.has(e.toLowerCase()));
    return { match: loaded ? "loaded" : "other", reported };
  }

  /**
   * LAUNCH_MISMATCH unless `gprojPath` is loaded in the running Workbench.
   * An unanswered question refuses too: claiming the project is open when it
   * may not be is the defect this guards (live-client-04).
   */
  async assertProjectLoaded(gprojPath: string): Promise<void> {
    const { match, reported } = await this.openProjectMatch(gprojPath);
    if (match === "loaded") return;
    const what =
      match === "other"
        ? `Workbench is running with a different project open (loaded: ${reported})`
        : `Workbench is running, but which project it has open could not be read (${reported})`;
    throw new WorkbenchError(
      `${what}; ${gprojPath} is not loaded in it. Nothing was installed, opened or launched. ` +
        "Stop that Workbench (wb_stop, or close it) before launching this project, or call " +
        "wb_launch without gprojPath to use the open project.",
      "LAUNCH_MISMATCH",
    );
  }

  /**
   * A read-only probe: no lease, no auto-launch, no handler recovery; the
   * call goes through the queue with refusal retry. For liveness natives
   * (A-3 review fix) the way diagnose() and ping() stay lease-free.
   */
  async probe<T = Record<string, unknown>>(
    apiFunc: string,
    params: Record<string, unknown> = {},
    options: WorkbenchCallOptions = {},
  ): Promise<T> {
    return this.rawCall<T>(apiFunc, params, {
      ...options,
      access: "read",
      skipAutoLaunch: true,
    });
  }

  /**
   * Compare the answered Ping's `buildStamp` with the bundle digest and keep
   * the result in `lastBuildCheck`; a warning is logged, never thrown.
   */
  private recordBuildCheck(pingResponse: unknown): void {
    // The bundle cannot change while this process runs: hash it once.
    if (this.bundleDigestCache === undefined) this.bundleDigestCache = bundleDigest();
    const check = checkBuildStamp(pingResponse, this.bundleDigestCache);
    const prev = this.lastBuildCheck;
    this.lastBuildCheck = check;
    if (check.warning && (prev?.status !== check.status || prev?.stamp !== check.stamp)) {
      logger.warn(`Handler build stamp: ${check.warning}`);
    }
  }

  /**
   * Remove injected handler scripts from a mod's directory.
   * Call this after Workbench work is done, before publishing the mod.
   * Deletes Scripts/WorkbenchGame/EnfusionMCP/ from the mod.
   * Safe to call even if scripts were never injected.
   */
  cleanupHandlerScripts(modDir: string): boolean {
    const handlerDir = resolve(modDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    logger.info(`Checking for handler scripts at: ${handlerDir}`);
    if (!existsSync(handlerDir)) {
      logger.info(`Handler scripts not found at ${handlerDir}`);
      return false;
    }
    try {
      rmSync(handlerDir, { recursive: true, force: true });
      logger.info(`Removed handler scripts from ${handlerDir}`);
    } catch (e) {
      logger.warn(`Failed to clean up handler scripts: ${e}`);
      return false;
    }
    // Prune the now-empty parent, best-effort: a failure here must not turn a
    // successful removal into a false "nothing was removed" report (plain
    // rmSync(dir) throws EISDIR, which previously did exactly that).
    try {
      const wbGameDir = join(modDir, "Scripts", "WorkbenchGame");
      if (existsSync(wbGameDir) && readdirSync(wbGameDir).length === 0) {
        rmdirSync(wbGameDir);
      }
    } catch (e) {
      logger.warn(`Could not prune empty WorkbenchGame dir: ${e}`);
    }
    return true;
  }

  /**
   * Collect a diagnostic snapshot: config, file system, and NET API state.
   * Does NOT auto-launch Workbench or throw — always returns a report.
   */
  async diagnose(): Promise<DiagnosticReport> {
    // --- Config info ---
    const host = this.host;
    const port = this.port;
    const defaultMod = this.config?.defaultMod ?? null;

    // Workbench exe
    let workbenchExe: DiagnosticReport["workbenchExe"] = null;
    if (this.config) {
      const exePath = this.findWorkbenchExe();
      const candidate = exePath ?? join(this.config.workbenchPath, WORKBENCH_SUBDIR, WORKBENCH_EXE);
      workbenchExe = { path: candidate, exists: existsSync(candidate) };
    }

    // Project path
    let projectPathInfo: DiagnosticReport["projectPath"] = null;
    if (this.config?.projectPath) {
      projectPathInfo = {
        path: this.config.projectPath,
        exists: existsSync(this.config.projectPath),
      };
    }

    // Bundled handler scripts (inside this package)
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const bundledDir = join(packageRoot, "mod", "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    const bundledScripts = { path: bundledDir, exists: existsSync(bundledDir) };

    // Standalone addon
    const standaloneBase = this.config?.projectPath
      ? join(this.config.projectPath, HANDLER_FOLDER)
      : join("<unknown>", HANDLER_FOLDER);
    const standaloneScriptsDir = join(standaloneBase, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    const standaloneFileCount = existsSync(standaloneScriptsDir)
      ? readdirSync(standaloneScriptsDir).filter((f) => f.endsWith(".c")).length
      : 0;
    const standaloneAddon = {
      path: standaloneBase,
      exists: existsSync(standaloneBase),
      fileCount: standaloneFileCount,
    };

    // Scan project path for mods that have handler scripts installed
    const installedMods: DiagnosticReport["installedMods"] = [];
    if (this.config?.projectPath && existsSync(this.config.projectPath)) {
      try {
        for (const entry of readdirSync(this.config.projectPath, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (entry.name === HANDLER_FOLDER) continue; // standalone, covered above
          const handlerDir = join(
            this.config.projectPath,
            entry.name,
            "Scripts",
            "WorkbenchGame",
            HANDLER_FOLDER,
          );
          if (existsSync(handlerDir)) {
            const fileCount = readdirSync(handlerDir).filter((f) => f.endsWith(".c")).length;
            installedMods.push({
              modDir: join(this.config.projectPath, entry.name),
              handlerDir,
              fileCount,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    // --- NET API probe ---
    let netApi: DiagnosticReport["netApi"] = "refused";
    let netApiError: string | undefined;
    try {
      await this.rawCall("EMCP_WB_Ping", {}, PING_OPTIONS);
      netApi = "up_with_handlers";
    } catch (err) {
      if (err instanceof WorkbenchError) {
        netApiError = err.message;
        if (err.code === "CONNECTION_REFUSED") {
          netApi = "refused";
        } else if (err.code === "TIMEOUT") {
          netApi = "timeout";
        } else if (err.code === "API_ERROR" && err.message.includes(NO_HANDLERS_ERROR)) {
          netApi = "up_no_handlers";
        } else {
          netApi = "error";
        }
      } else {
        netApi = "error";
        netApiError = String(err);
      }
    }

    // --- Lease and no-autolaunch marker (read-only; never takes the lease) ---
    let lease: DiagnosticReport["lease"] = null;
    let noAutolaunch: DiagnosticReport["noAutolaunch"] = null;
    if (this.config) {
      const leasePath = resolveLeasePath(this.config);
      const check = checkLease(leasePath, this.leaseDeps);
      lease = {
        path: leasePath,
        check,
        ours: "lease" in check && check.lease.session === LEASE_SESSION,
        session: LEASE_SESSION,
      };
      const markerPath = resolveNoAutolaunchPath(this.config);
      noAutolaunch = { path: markerPath, exists: isNoAutolaunch(markerPath) };
    }

    return {
      host,
      port,
      workbenchExe,
      projectPath: projectPathInfo,
      defaultMod,
      bundledScripts,
      standaloneAddon,
      installedMods,
      netApi,
      netApiError,
      lease,
      noAutolaunch,
    };
  }

  /**
   * Release the Workbench lease if this server process holds it and the
   * Workbench it recorded is not running any more. Best effort: never throws;
   * a lease held by another session is left alone, and so is our own lease
   * while its Workbench process lives. Returns true when the file was removed.
   * Called on server shutdown.
   */
  releaseLease(): boolean {
    if (!this.config) return false;
    this.lastHeartbeatAt = 0;
    try {
      return releaseLeaseFile(resolveLeasePath(this.config), LEASE_SESSION, this.leaseDeps);
    } catch (e) {
      // LEASE_ORPHANED here means the Workbench this server launched is still
      // running: the lease is kept on purpose so the next session asks the
      // owner instead of adopting that Workbench (plan 5.1).
      logger.debug(`Workbench lease not released: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Remove the standalone EnfusionMCP addon directory if it exists.
   * This prevents duplicate class name errors when handler scripts are injected
   * into a user's mod and the standalone folder is also present in the addons dir.
   */
  private cleanupStandaloneAddon(protectedDir: string): void {
    const fallbackBase = this.config?.projectPath;
    if (!fallbackBase) return;
    const standaloneDir = join(fallbackBase, HANDLER_FOLDER);
    if (!existsSync(standaloneDir)) return;
    // Never the project being launched or recovered, nor a folder holding it
    // or held by it: the handlers were just installed there (live-client-01).
    if (pathsOverlap(standaloneDir, protectedDir)) {
      logger.info(`Keeping ${standaloneDir}: it is the project handlers were installed into.`);
      return;
    }
    // Only delete a directory WE generated, and only while it holds nothing
    // but the generated .gproj and handler scripts (isOurStandaloneAddon).
    if (!isOurStandaloneAddon(standaloneDir)) {
      logger.warn(
        `Skipping ${standaloneDir}: not recognised as the generated EnfusionMCP addon ` +
          "(only the generated .gproj and EMCP_*.c handlers) — leaving it in place.",
      );
      return;
    }
    try {
      rmSync(standaloneDir, { recursive: true, force: true });
      logger.info(`Removed leftover standalone addon: ${standaloneDir}`);
    } catch (e) {
      logger.warn(`Failed to remove standalone addon: ${e}`);
    }
  }

  toString(): string {
    return `WorkbenchClient(${this.host}:${this.port})`;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Extract mode from a response object if it contains a `mode` field. */
  private extractMode(result: unknown): void {
    if (result && typeof result === "object" && "mode" in result) {
      const mode = (result as Record<string, unknown>).mode;
      if (mode === "edit") {
        this._state.mode = "edit";
      } else if (mode === "play" || mode === "game") {
        // Scripts return "game" when in play mode (WorldEditorAPI unavailable)
        this._state.mode = "play";
      }
      // "no_world_editor" and unrecognised values leave mode as-is (stays "unknown")
    }
  }

  /**
   * Take or refresh the Workbench lease before any live action.
   *   ours (any state) → heartbeat, at most once per LEASE_HEARTBEAT_MS
   *   free / stale     → acquired for this server (pid and project unknown)
   *   another session's (held / orphaned) or a corrupt file → LEASE_HELD
   * A client without a Config (unit tests, ad-hoc probes) cannot launch
   * Workbench and does not take part in the lease.
   */
  private claimLease(): void {
    if (!this.config) return;
    const path = resolveLeasePath(this.config);
    const now = (this.leaseDeps.now ?? Date.now)();
    try {
      const check = checkLease(path, this.leaseDeps);
      if ("lease" in check && check.lease.session === LEASE_SESSION) {
        // Our own lease: this process is alive, so an expired heartbeat is
        // not an orphan; refresh it (throttled).
        if (check.state !== "held" || now - this.lastHeartbeatAt >= LEASE_HEARTBEAT_MS) {
          heartbeatLease(path, LEASE_SESSION, this.leaseDeps);
          this.lastHeartbeatAt = now;
        }
        return;
      }
      acquireLease(path, { session: LEASE_SESSION, purpose: LEASE_PURPOSE }, this.leaseDeps);
      this.lastHeartbeatAt = now;
    } catch (e) {
      if (e instanceof LeaseError) {
        throw new WorkbenchError(
          `Workbench lease refused (${e.code}): ${e.message} ` +
            `Lease file: ${path}. Nothing was sent to Workbench, installed or launched.`,
          "LEASE_HELD",
        );
      }
      throw e;
    }
  }

  /**
   * Why wb_cleanup must not remove the handlers from `modDir` (live-client-08), or null.
   * Another session's lease (held or orphaned) blocks when it names this project's .gproj or no
   * project at all (it may be driving this one); a corrupt lease file blocks too, as it does for
   * every live action. A free or stale lease, our own, or one naming another project does not.
   * A client without a Config does not take part in the lease and never blocks.
   */
  cleanupLeaseBlocker(modDir: string): string | null {
    if (!this.config) return null;
    const path = resolveLeasePath(this.config);
    const check = checkLease(path, this.leaseDeps);
    const blocker = leaseBlocker(check, LEASE_SESSION);
    if (blocker === null) return null;
    if (check.state === "corrupt") return `${blocker} (lease file ${path})`;
    const project = "lease" in check ? check.lease.project : null;
    if (project !== null && resolve(dirname(project)).toLowerCase() !== resolve(modDir).toLowerCase()) {
      return null;
    }
    return `${blocker} (lease file ${path})`;
  }

  /** True when a lease check names this server process as the holder. */
  holdsLease(check: LeaseCheck): boolean {
    return "lease" in check && check.lease.session === LEASE_SESSION;
  }

  /** Record pid/project in our lease. Best effort: a failure is logged, not thrown. */
  private recordLeaseLaunch(patch: { wb_pid?: number | null; project?: string | null }): void {
    if (!this.config) return;
    try {
      updateLease(resolveLeasePath(this.config), LEASE_SESSION, patch, this.leaseDeps);
      this.lastHeartbeatAt = (this.leaseDeps.now ?? Date.now)();
    } catch (e) {
      logger.warn(
        `Could not record launch in Workbench lease: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * The project an implicit auto-launch may open, or AUTOLAUNCH_REFUSED.
   * Refuses while the no-autolaunch marker exists, and when config.defaultMod
   * does not name an addon under config.projectPath that holds a .gproj.
   * Never picks a fallback addon.
   */
  private resolveAutoLaunchGproj(): string {
    const markerPath = resolveNoAutolaunchPath(this.config);
    if (isNoAutolaunch(markerPath)) {
      throw new WorkbenchError(
        `Auto-launch refused: the no-autolaunch marker exists (${markerPath}). ` +
          "Workbench is not running and will not be started implicitly. " +
          "Call wb_launch with an explicit gprojPath to launch a specific project.",
        "AUTOLAUNCH_REFUSED",
      );
    }
    const gproj = findDefaultModGproj(this.config);
    if (!gproj) {
      const mod = this.config?.defaultMod;
      const why = mod
        ? `defaultMod "${mod}" has no .gproj under ${this.config?.projectPath ?? "(no projectPath)"}`
        : "no defaultMod is configured";
      throw new WorkbenchError(
        `Auto-launch refused: no explicit project (${why}); refusing to pick a fallback addon. ` +
          "Call wb_launch with an explicit gprojPath, or set ENFUSION_DEFAULT_MOD to an addon folder name.",
        "AUTOLAUNCH_REFUSED",
      );
    }
    logger.info(`Using defaultMod gproj to skip launcher: ${gproj}`);
    return gproj;
  }

  /**
   * Recover from "not existing Net API function" errors.
   * Workbench is running but our custom handler scripts aren't compiled.
   * Installs handlers into the mod directory and waits for Workbench to
   * auto-recompile them — without killing the running Workbench process.
   *
   * Previous behaviour killed Workbench with taskkill, which broke other
   * tools (e.g. the Enfusion Blender plugin) that share the same NET API.
   */
  /**
   * The call() recovery for a Workbench that runs without our handlers, for
   * wb_launch (live-client-02): takes the lease, installs into the project
   * Workbench has open (or refuses) and waits for the recompile.
   */
  async recoverHandlers(): Promise<void> {
    this.claimLease();
    await this.recoverMissingHandlers();
  }

  private recoverMissingHandlers(): Promise<void> {
    if (!this.config) {
      return Promise.reject(
        new WorkbenchError("No config provided — cannot recover handlers.", "LAUNCH_FAILED"),
      );
    }
    // Single-flight, same shape as ensureRunning(): concurrent callers that
    // all hit "Undefined API func" share one install + one recompile wait
    // instead of racing rmSync/copyFileSync and running N×30 s ping loops.
    if (this.recoverPromise) {
      return this.recoverPromise;
    }
    const promise = this.doRecoverMissingHandlers().finally(() => {
      if (this.recoverPromise === promise) {
        this.recoverPromise = null;
      }
    });
    this.recoverPromise = promise;
    return promise;
  }

  private async doRecoverMissingHandlers(): Promise<void> {
    // Inject into the project Workbench actually has open — never into
    // defaultMod or a scanned addon, which may not be the open project.
    const recoveryGproj = await this.resolveOpenProjectGproj();
    this.installHandlerScripts(dirname(recoveryGproj), true);
    this.cleanupStandaloneAddon(dirname(recoveryGproj));

    // Wait for Workbench to detect the new files and recompile scripts.
    // Workbench watches its script directories and recompiles automatically.
    // Poll with our custom EMCP_WB_Ping handler — it only succeeds once
    // the handler scripts are compiled and registered.
    logger.info("Handler scripts installed. Waiting for Workbench to recompile...");
    const deadline = Date.now() + HANDLER_RECOMPILE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, HANDLER_RECOMPILE_POLL_MS));
      if (await this.ping()) {
        logger.info("Handler scripts compiled and loaded.");
        return;
      }
    }

    throw new WorkbenchError(
      "Handler scripts were installed but Workbench did not recompile them within " +
        `${HANDLER_RECOMPILE_TIMEOUT_MS / 1000}s. Try recompiling scripts manually in ` +
        "Workbench (Plugins > Reload Scripts) or restart Workbench.",
      "LAUNCH_FAILED",
    );
  }

  /**
   * Ask the running Workbench which project is open (built-in
   * GetLoadedProjects; works without our handlers) and return its .gproj on
   * disk. Throws LAUNCH_FAILED when it cannot be resolved to exactly one
   * .gproj, so recovery installs nothing rather than guessing.
   */
  private async resolveOpenProjectGproj(): Promise<string> {
    const remedy =
      "No handler scripts were installed. Call wb_launch with an explicit gprojPath " +
      "for the project you want Workbench to have open.";
    let result: Record<string, unknown>;
    try {
      result = await this.rawCall<Record<string, unknown>>(
        "GetLoadedProjects",
        {},
        { skipAutoLaunch: true },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new WorkbenchError(
        "Handler recovery refused: could not ask Workbench which project is open " +
          `(GetLoadedProjects failed: ${msg}). ${remedy}`,
        "LAUNCH_FAILED",
      );
    }
    const resolution = resolveLoadedProjectGproj(result, this.config?.projectPath);
    if (resolution.gproj) {
      logger.info(`Open project resolved for handler recovery: ${resolution.gproj}`);
      return resolution.gproj;
    }
    const reported =
      resolution.entries.length > 0
        ? resolution.entries.join(", ")
        : `no project list (payload keys: ${Object.keys(result).join(", ") || "none"})`;
    const why =
      resolution.candidates.length > 1
        ? `several loaded projects resolve to addons on disk (${resolution.candidates.join(", ")}) ` +
          "and which one is open cannot be told apart"
        : `none of the loaded projects resolves to a .gproj under ${this.config?.projectPath ?? "(no projectPath)"}`;
    throw new WorkbenchError(
      `Handler recovery refused: the open project could not be resolved — ${why}. ` +
        `Workbench reported: ${reported}. ${remedy}`,
      "LAUNCH_FAILED",
    );
  }

  private async launchWorkbench(
    gprojPath?: string,
    launchOptions: LaunchOptions = {},
  ): Promise<void> {
    // 1. Check if already running (maybe it came up between the failed call and now)
    const status = await this.pingStatus();
    if (status.kind === "up") {
      logger.info("Workbench is already running.");
      if (gprojPath && launchOptions.requireProject) await this.assertProjectLoaded(gprojPath);
      return;
    }
    // Anything but a refused connection is a RUNNING Workbench (no handlers,
    // busy, odd answer): a second spawn would make the Steam launcher forward
    // the arguments to it and drop its session (live-client-02).
    if (status.kind !== "refused") throw runningNotAnsweringError(status);

    // 2. Resolve the target .gproj and inject handler scripts into that mod.
    //    Handler scripts must compile as part of the opened project — Workbench
    //    only compiles the active project and its declared dependencies, NOT every
    //    addon folder in the project directory.  A standalone sibling addon will
    //    never be compiled unless the user's project explicitly depends on it.
    //    Without an explicit project only config.defaultMod is used (and only
    //    while the no-autolaunch marker is absent); otherwise AUTOLAUNCH_REFUSED.
    //    There is no "first addon found" and no standalone-addon fallback.
    const resolvedGproj = gprojPath || this.resolveAutoLaunchGproj();
    if (!gprojPath) this.recordLeaseLaunch({ project: resolve(resolvedGproj) });
    // Build the command line first: a refused path (not a .gproj, flag-shaped)
    // must stop the launch before any handler is copied (A-6 review fix).
    let args: string[];
    try {
      args = buildWorkbenchArgs({
        gproj: resolvedGproj,
        forceSettings: launchOptions.forceSettings,
      });
    } catch (e) {
      throw new WorkbenchError(e instanceof Error ? e.message : String(e), "LAUNCH_FAILED");
    }
    this.installHandlerScripts(dirname(resolvedGproj));
    // Remove any leftover standalone addon to prevent duplicate class errors.
    // If a previous session created {projectPath}/EnfusionMCP/ it would be
    // picked up as a sibling addon and cause compile-time class name conflicts.
    this.cleanupStandaloneAddon(dirname(resolve(resolvedGproj)));
    // Record what this launch is actually opening so a concurrent
    // ensureRunning(<other gproj>) can refuse instead of joining.
    this.launchTarget = normalizeGprojKey(resolvedGproj);
    this.launchTargetDisplay = resolvedGproj;

    // 3. Find executable
    const exePath = this.findWorkbenchExe();
    if (!exePath) {
      const wbPath = this.config?.workbenchPath ?? "(not configured)";
      throw new WorkbenchError(
        `Cannot find ${WORKBENCH_EXE}. Install Arma Reforger Tools from Steam, ` +
          "or set ENFUSION_WORKBENCH_PATH. Searched:\n" +
          `  - ${join(wbPath, WORKBENCH_SUBDIR, WORKBENCH_EXE)}\n` +
          `  - ${join(wbPath, WORKBENCH_EXE)}`,
        "LAUNCH_FAILED",
      );
    }

    // 4. Spawn with -gproj to skip the launcher (DEC-047 L7), and
    //    -forceSettings <ini> for a scratch-profile launch (U12).

    // Use the game install directory as CWD so Workbench finds base game addons
    // (data/ArmaReforger.gproj with GUID 58D0FB3206B6F859) via ./addons resolution.
    const cwd = this.findGameDir() || dirname(exePath);

    // Warn-only dependency pre-flight (see tools/wb-validate-scripts.ts
    // for the rationale) + launcher watchdog: the launcher can hold at
    // its Projects picker instead of auto-opening the -gproj project
    // (field-diagnosed 2026-08-31) — without the watchdog that reads as
    // "NET API never responded" after the full launch timeout.
    this.lastLaunchNotes = [];
    let depCheck: WbDepsCheck | null = null;
    let depCheckError: string | undefined;
    if (resolvedGproj && this.config) {
      try {
        depCheck = checkWorkbenchVisibleDeps(resolvedGproj, this.config);
      } catch (e) {
        depCheckError = e instanceof Error ? e.message : String(e);
      }
    }
    const logsRoot = this.config?.logsPath;
    const tracker = logsRoot
      ? new WorkbenchLaunchTracker(logsRoot, snapshotSessionDirs(logsRoot))
      : null;
    if (tracker) {
      tracker.watchdog = new LaunchWatchdog({
        readConsoleLog: tracker.readConsoleLog,
        nudge: nudgeEnfusionLauncher,
        inspectWindows: inspectProcessWindows,
      });
    }

    // A refused port is no proof that no Workbench runs: it may be starting,
    // have the NET API off, or be another session's. Never spawn beside one.
    const pids = this.workbenchPids();
    if (pids.length > 0) {
      throw new WorkbenchError(
        `Workbench is already running (${WORKBENCH_EXE}, pid ${pids.join(", ")}) but its NET API ` +
          "refused the connection (still starting, NET API off, or opened by hand). No second " +
          "Workbench was started: Steam's launcher would forward the arguments to the open one " +
          "and drop its session. Wait and retry, enable File > Options > General > Net API, or " +
          "close that Workbench first.",
        "LAUNCH_FAILED",
      );
    }

    logger.info(
      `Launching Workbench: ${exePath}${args.length ? ` ${args.join(" ")}` : ""} (cwd: ${cwd})`,
    );
    const launchStartedAt = Date.now();
    const proc = spawn(exePath, args, {
      detached: true,
      stdio: "ignore",
      cwd,
    });
    proc.unref();
    // The lease now names the Workbench process this session started, so a
    // reader can tell a live sitting from an orphaned one.
    if (proc.pid) this.recordLeaseLaunch({ wb_pid: proc.pid, project: resolve(resolvedGproj) });

    // 5. Wait for NET API — track the last error type so the timeout message is actionable
    // The deadline is enforced after EVERY sub-step (ping, watchdog tick,
    // sleep) and each step is capped to the time remaining, so a 90 s
    // timeout means ≈90 s rather than 90 s + one full ping + one full sleep.
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    const remaining = () => deadline - Date.now();
    let lastErrorCode: WorkbenchError["code"] | undefined;
    while (remaining() > 0) {
      try {
        const pong = await this.rawCall(
          "EMCP_WB_Ping",
          {},
          { ...PING_OPTIONS, timeout: Math.max(1, Math.min(3000, remaining())) },
        );
        this.recordBuildCheck(pong);
        this._state.connected = true;
        this._state.lastUpdated = Date.now();
        logger.info("Workbench NET API is responding.");
        if (tracker?.watchdog?.nudgeOutcome?.enterPosted) {
          this.lastLaunchNotes.push(
            "Launcher project picker was auto-confirmed (launcher window restored, Enter posted on the preselected Open).",
          );
        }
        const preflightNote = buildPreflightNote(depCheck);
        if (preflightNote) this.lastLaunchNotes.push(preflightNote);
        return;
      } catch (err) {
        if (err instanceof WorkbenchError) {
          lastErrorCode = err.code;
          logger.debug(`Workbench poll (${err.code}): ${err.message}`);
        }
      }
      if (remaining() <= 0) break;
      if (tracker) {
        const stuck = await tracker.check({ pid: proc.pid });
        if (stuck === "stuck:launcher-picker" || stuck === "stuck:missing-deps") {
          // The whole tree (taskkill /T /F on win32), as cli-runner does: the spawned pid alone
          // may be the launcher stub, which leaves the real Workbench running (live-client-09).
          // killProcessTree never throws.
          if (proc.pid) await killProcessTree(proc.pid);
          throw new WorkbenchError(
            buildStuckReport(stuck, {
              toolLabel: "wb_launch",
              gprojPath: resolvedGproj ?? "(no project)",
              durationMs: Date.now() - launchStartedAt,
              sessionDir: tracker.sessionDir,
              logsRoot: logsRoot!,
              watchdog: tracker.watchdog!,
              consoleTail: tailLines(tracker.readConsoleLog(), 15),
              depCheck,
              depCheckError,
            }),
            "LAUNCH_FAILED",
          );
        }
      }
      const sleepMs = Math.min(LAUNCH_POLL_INTERVAL_MS, remaining());
      if (sleepMs <= 0) break;
      await new Promise((r) => setTimeout(r, sleepMs));
    }

    // Build a specific diagnostic based on what was failing at timeout.
    // The observed NET API error decides the primary hint:
    //   CONNECTION_REFUSED = NET API port never opened → NET API likely disabled.
    //   API_ERROR = NET API is up but EMCP_WB_Ping isn't registered → handler
    //               scripts didn't compile (script errors / wrong mod directory).
    // The launch-log heuristic (`CLI Params` never echoed → launcher never
    // accepted the project) is only appended when the tracker actually found
    // a log session for this run; with no session discovered the watchdog's
    // cliParamsSeen=false is merely "no evidence", not "engine rejected it".
    let hint: string;
    if (lastErrorCode === "API_ERROR") {
      hint =
        "Workbench NET API responded but handler scripts did not load. " +
        "Check for script compilation errors in Workbench (Script Editor). " +
        "Fix any errors in the project's scripts so the EnfusionMCP handlers can compile, " +
        "then try again.";
    } else {
      hint =
        "NET API port never responded. Ensure NET API is enabled in Workbench: " +
        "File > Options > General > Net API (checkbox must be on).";
    }
    if (tracker && tracker.sessionDir && tracker.watchdog && !tracker.watchdog.cliParamsSeen) {
      hint +=
        "\n\n" +
        buildTimeoutDiagnostics({
          watchdog: tracker.watchdog,
          consoleTail: tailLines(tracker.readConsoleLog(), 15),
          depCheck,
          depCheckError,
        }).join("\n");
    }

    throw new WorkbenchError(
      `Workbench launched but did not connect within ${LAUNCH_TIMEOUT_MS / 1000}s.\n\n${hint}`,
      "LAUNCH_FAILED",
    );
  }

  private findWorkbenchExe(): string | null {
    if (!this.config) return null;
    const subPath = join(this.config.workbenchPath, WORKBENCH_SUBDIR, WORKBENCH_EXE);
    if (existsSync(subPath)) return subPath;

    const rootPath = join(this.config.workbenchPath, WORKBENCH_EXE);
    if (existsSync(rootPath)) return rootPath;

    return null;
  }

  /**
   * Derive the Arma Reforger game install directory.
   * Checks ENFUSION_GAME_PATH env var first, then walks up from workbenchPath.
   * workbenchPath may point to the Tools root OR the Workbench subdirectory,
   * so we try both one and two levels up.
   */
  private findGameDir(): string | null {
    // Explicit env var takes priority
    const envGamePath = process.env.ENFUSION_GAME_PATH;
    if (envGamePath && existsSync(join(envGamePath, "addons"))) {
      logger.info(`Using game directory from ENFUSION_GAME_PATH: ${envGamePath}`);
      return envGamePath;
    }

    if (!this.config) return null;

    // Resolved config value next — covers ~/.enfusion-mcp/config.json users
    // and any case where loadConfig derived a valid path the raw env lacks.
    if (this.config.gamePath && existsSync(join(this.config.gamePath, "addons"))) {
      logger.info(`Using game directory from config.gamePath: ${this.config.gamePath}`);
      return this.config.gamePath;
    }

    const toolsDir = this.config.workbenchPath;
    // workbenchPath may be "Arma Reforger Tools" or "Arma Reforger Tools\Workbench"
    const candidates = [
      resolve(toolsDir, "..", "Arma Reforger"),
      resolve(toolsDir, "..", "ArmaReforger"),
      resolve(toolsDir, "..", "..", "Arma Reforger"),
      resolve(toolsDir, "..", "..", "ArmaReforger"),
    ];
    for (const candidate of candidates) {
      if (existsSync(join(candidate, "addons"))) {
        logger.info(`Using game directory as CWD: ${candidate}`);
        return candidate;
      }
    }

    // Cross-drive discovery: the game is often in a DIFFERENT Steam library
    // than the Tools (e.g. Tools on C:\, game on D:\SteamLibrary). Parse
    // Steam's libraryfolders.vdf for every library root and probe each for
    // the game. Without this, Workbench launches with a CWD whose ./addons
    // lacks the base-game data addon (GUID 58D0FB3206B6F859) and blocks on
    // a "Missing Addon" modal — the NET API never comes up.
    const fromSteam = findGameAcrossSteamLibraries("Arma Reforger", [steamRootOf(toolsDir)]);
    if (fromSteam) {
      logger.info(`Using game directory from Steam library scan: ${fromSteam}`);
      return fromSteam;
    }

    logger.warn(
      "Could not find Arma Reforger game directory. Workbench may fail to resolve base game addon.",
    );
    return null;
  }

  /**
   * Copy handler scripts into a mod directory so they compile as part of that mod.
   * Always an explicit project directory: there is no standalone-addon fallback.
   */
  private installHandlerScripts(modDir: string, force = false): void {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const bundledDir = join(packageRoot, "mod", "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    if (!existsSync(bundledDir)) {
      logger.warn("Bundled handler scripts not found in package.");
      return;
    }

    const targetScriptsDir = join(modDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);

    // Already installed AND identical to the bundled set? Skip unless
    // force-reinstalling. Compared by content digest (not just Ping.c
    // presence) so a package upgrade that changes any handler re-copies.
    if (!force && handlerSetDigest(targetScriptsDir) === handlerSetDigest(bundledDir)) {
      return;
    }

    logger.info(`Installing handler scripts to ${targetScriptsDir}`);
    mkdirSync(targetScriptsDir, { recursive: true });

    const files = readdirSync(bundledDir).filter((f) => f.endsWith(".c"));
    try {
      for (const file of files) {
        copyFileSync(join(bundledDir, file), join(targetScriptsDir, file));
      }
    } catch (e) {
      // Partial installation — clean up to avoid broken state on next attempt
      logger.error(`Failed to install handler scripts, rolling back: ${e}`);
      try {
        rmSync(targetScriptsDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
      throw e;
    }

    logger.info(`Installed ${files.length} handler scripts.`);
    // Copy alone left retired handlers compiling (session 023: two 1.x handlers removed from the
    // bundle stayed in the test project): delete the EMCP_WB_*.c files the bundle no longer holds.
    try {
      const removed = pruneStaleHandlers(targetScriptsDir, files, { really: true });
      if (removed.length > 0)
        logger.info(
          `Removed ${removed.length} stale handler script(s) not in the bundle: ${removed.join(", ")}`,
        );
    } catch (e) {
      logger.warn(`Could not remove stale handler scripts from ${targetScriptsDir}: ${e}`);
    }
  }

  /**
   * Raw TCP call through the serial queue (U30): no auto-launch. A refused
   * connection of a READ-ONLY call is retried after each
   * REFUSAL_RETRY_DELAYS_MS back-off; a mutating or unclassified call is never
   * retried.
   */
  private rawCall<T = Record<string, unknown>>(
    apiFunc: string,
    params: Record<string, unknown> = {},
    options: WorkbenchCallOptions = {},
  ): Promise<T> {
    // bind, not a closure: the contract scanner resolves a forwarded APIFunc
    // through named methods only (tests/contracts/bi-handlers.contract.test.ts).
    return this.queue.run(
      apiFunc,
      this.sendWithRetry.bind(this, apiFunc, params, options) as () => Promise<T>,
      // Only a read-only call may take the probe lane beside a call in flight.
      options.priority === "high" && options.access === "read" ? "high" : "normal",
    );
  }

  /** The queued job of rawCall(): exchange(), with the read-only refusal retry. */
  private async sendWithRetry<T = Record<string, unknown>>(
    apiFunc: string,
    params: Record<string, unknown>,
    options: WorkbenchCallOptions,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.exchange<T>(apiFunc, params, options);
      } catch (err) {
        const delay = this.refusalRetryDelaysMs[attempt];
        if (
          options.access === "read" &&
          err instanceof WorkbenchError &&
          err.code === "CONNECTION_REFUSED" &&
          delay !== undefined
        ) {
          logger.debug(`"${apiFunc}" refused; retry ${attempt + 1} in ${delay} ms (U30)`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  /** One request on a fresh socket; no queue, no retry. */
  private exchange<T = Record<string, unknown>>(
    apiFunc: string,
    params: Record<string, unknown> = {},
    options: WorkbenchCallOptions = {},
  ): Promise<T> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const access = options.access ?? "mutate";
    const decodeOpts = { allowEmptyPayload: options.allowEmptyPayload === true };
    const startedAt = Date.now();
    const requestBuf = encodeRequest(this.clientId, apiFunc, params);

    return new Promise<T>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;

      const socket = new Socket();

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          socket.destroy();
          const code = classifyTimeout(timeout, WEDGE_AFTER_MS, access);
          const e = new WorkbenchError(
            code === "WEDGED"
              ? `Workbench call "${apiFunc}" had no answer and no reset after ${timeout}ms: ` +
                  "Workbench looks wedged (a modal resets at about 120 s, U6). Not retried."
              : code === "LOST"
                ? `Workbench call "${apiFunc}" timed out after ${timeout}ms with no answer: ` +
                  "whether it took effect is unknown (LOST, not retried). Read the state back."
                : `Workbench call "${apiFunc}" timed out after ${timeout}ms`,
            code,
          );
          e.timedOut = true;
          reject(e);
        }
      }, timeout);

      // Once settled we stop caring about the socket, but the socket may
      // still emit (a late ECONNRESET after 'end', for instance). An 'error'
      // event with no listener is thrown by EventEmitter and would take the
      // whole MCP process down — so a no-op 'error' listener stays attached
      // for the socket's lifetime, and the socket is torn down explicitly.
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.on("error", () => {
          /* settled — swallow late socket errors */
        });
      };

      socket.on("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ECONNREFUSED") {
          reject(
            new WorkbenchError(
              `Cannot connect to Workbench at ${this.host}:${this.port}.`,
              "CONNECTION_REFUSED",
            ),
          );
        } else if (code === "ECONNRESET" && totalBytes === 0) {
          // U6 (DEC-042): a modal inside a handler blocks the queue and the
          // pending connections are reset after about 120 s.
          const elapsed = Date.now() - startedAt;
          const kind = classifyReset(access, elapsed);
          if (kind === "LOST") {
            const e = new WorkbenchError(
              `Workbench call "${apiFunc}" was reset after ${elapsed}ms with no answer: ` +
                "whether it took effect is unknown (LOST, not retried). Read the state back" +
                (elapsed >= MODAL_RESET_MIN_MS
                  ? "; a reset at this age usually means a modal dialog in Workbench (U6)."
                  : "."),
              "LOST",
            );
            // An early reset is a dead connection, not a modal (A-2 review fix).
            e.connectionDropped = elapsed < MODAL_RESET_MIN_MS;
            reject(e);
          } else if (kind === "MODAL_OPEN") {
            reject(
              new WorkbenchError(
                `Workbench call "${apiFunc}" was reset after ${elapsed}ms with no answer: ` +
                  "a modal dialog is blocking the NET queue (U6). Workbench is alive; a human must close the dialog.",
                "MODAL_OPEN",
              ),
            );
          } else {
            reject(new WorkbenchError(`Connection error: ${err.message}`, "PROTOCOL_ERROR"));
          }
        } else {
          reject(new WorkbenchError(`Connection error: ${err.message}`, "PROTOCOL_ERROR"));
        }
      });

      socket.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_SIZE) {
          if (!settled) {
            settled = true;
            cleanup();
            socket.destroy();
            reject(
              new WorkbenchError(
                `Response for "${apiFunc}" exceeded ${MAX_RESPONSE_SIZE} bytes — possible malformed data`,
                "PROTOCOL_ERROR",
              ),
            );
          }
          return;
        }
        chunks.push(chunk);
      });

      socket.on("end", () => {
        if (settled) return;
        settled = true;
        cleanup();
        // We already half-closed our side in connect(); the peer's FIN means
        // the exchange is over. Destroy now rather than leaving the socket to
        // linger until 'close' with nobody watching it.
        socket.destroy();

        const responseBuf = Buffer.concat(chunks);
        if (responseBuf.length === 0) {
          reject(
            new WorkbenchError(
              `Empty response from Workbench for "${apiFunc}" — connection closed without data`,
              "PROTOCOL_ERROR",
            ),
          );
          return;
        }

        try {
          const result = decodeResponse<T>(responseBuf, decodeOpts);
          logger.debug(`Workbench response for "${apiFunc}":`, result);
          resolve(result);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isApiError = errMsg.startsWith("Workbench error:");
          reject(
            new WorkbenchError(
              isApiError ? errMsg : `Failed to decode response for "${apiFunc}": ${errMsg}`,
              isApiError ? "API_ERROR" : "PROTOCOL_ERROR",
            ),
          );
        }
      });

      socket.on("close", (hadError) => {
        if (settled) return;
        // close fired without end — connection dropped unexpectedly
        settled = true;
        cleanup();

        if (hadError) {
          reject(
            new WorkbenchError(
              `Connection to Workbench closed with error for "${apiFunc}"`,
              "PROTOCOL_ERROR",
            ),
          );
          return;
        }

        // No end event + no error = unusual. Try to decode what we have.
        const responseBuf = Buffer.concat(chunks);
        if (responseBuf.length === 0) {
          reject(
            new WorkbenchError(
              `Connection closed without response for "${apiFunc}"`,
              "PROTOCOL_ERROR",
            ),
          );
          return;
        }

        try {
          const result = decodeResponse<T>(responseBuf, decodeOpts);
          resolve(result);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isApiError = errMsg.startsWith("Workbench error:");
          reject(
            new WorkbenchError(
              isApiError ? errMsg : `Failed to decode response for "${apiFunc}": ${errMsg}`,
              isApiError ? "API_ERROR" : "PROTOCOL_ERROR",
            ),
          );
        }
      });

      socket.connect(this.port, this.host, () => {
        logger.debug(`Connected to Workbench at ${this.host}:${this.port}, calling "${apiFunc}"`);
        socket.end(requestBuf);
      });
    });
  }
}
