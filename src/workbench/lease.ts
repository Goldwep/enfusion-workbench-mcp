/**
 * Machine-wide Workbench lease and no-autolaunch marker (2.0 plan, section 5.1).
 *
 * The lease is a small JSON file recording which MCP session is currently
 * driving Workbench:
 *
 *   %USERPROFILE%\.enfusion-mcp\workbench.lease.json   (ENFUSION_LEASE_PATH overrides)
 *   { session, purpose, started_at, heartbeat_at, wb_pid, project }
 *
 * Rules, as the plan states them:
 *   - Created exclusively; a second holder is refused.
 *   - Stale when the heartbeat is older than LEASE_STALE_MS (15 minutes) AND
 *     the recorded `wb_pid` is no longer running (or was never recorded). A
 *     stale lease may be taken over.
 *   - Heartbeat expired but the recorded process still running means the
 *     holding session ended mid-sitting. That lease is reported as "orphaned"
 *     and is never taken automatically; the owner decides what happens next.
 *   - A corrupt lease file is reported, never silently replaced.
 *
 * The no-autolaunch marker is a plain file:
 *   %USERPROFILE%\.enfusion-mcp\no-autolaunch          (ENFUSION_NO_AUTOLAUNCH_PATH overrides)
 * While it exists the registered server never auto-launches Workbench; an
 * explicit `wb_launch` with a project still works and still honours the lease.
 *
 * Both locations are overridable so a spawned test process can exercise the
 * guards against temporary files instead of the real ones.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isProcessAlive } from "../server-mgmt/launch.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Heartbeat age after which a lease counts as expired (plan 5.1: 15 minutes). */
export const LEASE_STALE_MS = 15 * 60_000;

/** Default lease file location. */
export const DEFAULT_LEASE_PATH = join(homedir(), ".enfusion-mcp", "workbench.lease.json");

/** Default no-autolaunch marker location. */
export const DEFAULT_NO_AUTOLAUNCH_PATH = join(homedir(), ".enfusion-mcp", "no-autolaunch");

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkbenchLease {
  /** Opaque holder id, e.g. "registered:<pid>" or "v2-harness:<session>". */
  session: string;
  /** Why the holder needs Workbench, e.g. "registered-server", "live-session S-C". */
  purpose: string;
  /** ISO 8601 time the lease was created. */
  started_at: string;
  /** ISO 8601 time of the last heartbeat. */
  heartbeat_at: string;
  /** Workbench process id once known, else null. */
  wb_pid: number | null;
  /** The .gproj the holder opened, else null. */
  project: string | null;
}

export type LeaseCheck =
  | { state: "free" }
  | { state: "held"; lease: WorkbenchLease; path: string }
  | { state: "stale"; lease: WorkbenchLease; path: string }
  | { state: "orphaned"; lease: WorkbenchLease; path: string }
  | { state: "corrupt"; path: string; reason: string };

export interface LeaseDeps {
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Process liveness probe, injectable for tests. */
  isAlive?: (pid: number) => boolean;
}

export interface AcquireLeaseOptions {
  session: string;
  purpose: string;
  wb_pid?: number | null;
  project?: string | null;
}

/**
 * Lease failures carry a code because callers branch on it: a held lease is
 * rendered as "wait or stop the other session", an orphaned one as "owner
 * decision needed", a corrupt one as "inspect the file".
 */
export class LeaseError extends Error {
  constructor(
    message: string,
    public readonly code: "LEASE_HELD" | "LEASE_ORPHANED" | "LEASE_CORRUPT" | "LEASE_NOT_OWNER",
    public readonly lease?: WorkbenchLease,
  ) {
    super(message);
    this.name = "LeaseError";
  }
}

// ── Paths ────────────────────────────────────────────────────────────────────

/** Lease path: explicit config value, then ENFUSION_LEASE_PATH, then the default. */
export function resolveLeasePath(config?: { leasePath?: string }): string {
  return config?.leasePath || process.env.ENFUSION_LEASE_PATH || DEFAULT_LEASE_PATH;
}

/** Marker path: explicit config value, then ENFUSION_NO_AUTOLAUNCH_PATH, then the default. */
export function resolveNoAutolaunchPath(config?: { noAutolaunchPath?: string }): string {
  return (
    config?.noAutolaunchPath ||
    process.env.ENFUSION_NO_AUTOLAUNCH_PATH ||
    DEFAULT_NO_AUTOLAUNCH_PATH
  );
}

/** True while the no-autolaunch marker file exists. */
export function isNoAutolaunch(markerPath: string): boolean {
  return existsSync(markerPath);
}

// ── Reading ──────────────────────────────────────────────────────────────────

function isLeaseShape(raw: unknown): raw is WorkbenchLease {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.session === "string" &&
    typeof r.purpose === "string" &&
    typeof r.started_at === "string" &&
    typeof r.heartbeat_at === "string" &&
    (r.wb_pid === null || typeof r.wb_pid === "number") &&
    (r.project === null || typeof r.project === "string")
  );
}

/**
 * Read the lease file. Returns null when absent. Throws LEASE_CORRUPT on
 * unparsable JSON or an unexpected shape.
 */
export function readLease(path: string): WorkbenchLease | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new LeaseError(`Lease file ${path} is not valid JSON: ${detail}`, "LEASE_CORRUPT");
  }
  if (!isLeaseShape(raw)) {
    throw new LeaseError(
      `Lease file ${path} has an unexpected shape (expected { session, purpose, started_at, heartbeat_at, wb_pid, project })`,
      "LEASE_CORRUPT",
    );
  }
  return raw;
}

/** Classify the lease file at `path` by the plan's staleness rule. */
export function checkLease(path: string, deps: LeaseDeps = {}): LeaseCheck {
  let lease: WorkbenchLease | null;
  try {
    lease = readLease(path);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { state: "corrupt", path, reason };
  }
  if (!lease) return { state: "free" };

  const now = (deps.now ?? Date.now)();
  const heartbeat = Date.parse(lease.heartbeat_at);
  const expired = Number.isNaN(heartbeat) || now - heartbeat > LEASE_STALE_MS;
  if (!expired) return { state: "held", lease, path };

  const alive = deps.isAlive ?? isProcessAlive;
  const pidRunning = lease.wb_pid !== null && alive(lease.wb_pid);
  return pidRunning ? { state: "orphaned", lease, path } : { state: "stale", lease, path };
}

/** One-line description of a lease for error messages and reports. */
export function describeLease(lease: WorkbenchLease): string {
  const pid = lease.wb_pid === null ? "no pid" : `pid ${lease.wb_pid}`;
  const project = lease.project ?? "no project";
  return `${lease.session} (${lease.purpose}; since ${lease.started_at}; heartbeat ${lease.heartbeat_at}; ${pid}; ${project})`;
}

// ── Writing ──────────────────────────────────────────────────────────────────

function writeAtomic(path: string, lease: WorkbenchLease): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(lease, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

function createExclusive(path: string, lease: WorkbenchLease): boolean {
  mkdirSync(dirname(path), { recursive: true });
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  try {
    writeSync(fd, JSON.stringify(lease, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Take the lease for `session`.
 *
 *   free      → created exclusively
 *   stale     → replaced
 *   held by this session → heartbeat refreshed (re-entrant)
 *   held by another session → LEASE_HELD
 *   orphaned  → LEASE_ORPHANED (owner decision; never taken automatically)
 *   corrupt   → LEASE_CORRUPT
 */
export function acquireLease(
  path: string,
  opts: AcquireLeaseOptions,
  deps: LeaseDeps = {},
): WorkbenchLease {
  const now = (deps.now ?? Date.now)();
  const iso = new Date(now).toISOString();
  const fresh: WorkbenchLease = {
    session: opts.session,
    purpose: opts.purpose,
    started_at: iso,
    heartbeat_at: iso,
    wb_pid: opts.wb_pid ?? null,
    project: opts.project ?? null,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const check = checkLease(path, deps);
    switch (check.state) {
      case "free":
        if (createExclusive(path, fresh)) return fresh;
        continue; // lost a race; re-check once
      case "stale":
        try {
          unlinkSync(path);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (createExclusive(path, fresh)) return fresh;
        continue;
      case "held":
        if (check.lease.session === opts.session) {
          const refreshed = { ...check.lease, heartbeat_at: iso };
          writeAtomic(path, refreshed);
          return refreshed;
        }
        throw new LeaseError(
          `Workbench lease is held by ${describeLease(check.lease)}. ` +
            "Wait for that session to finish or ask it to release the lease.",
          "LEASE_HELD",
          check.lease,
        );
      case "orphaned":
        throw new LeaseError(
          `Workbench lease ${path} belongs to a session whose heartbeat expired, but its Workbench ` +
            `(pid ${check.lease.wb_pid}) is still running: ${describeLease(check.lease)}. ` +
            "Not taking it automatically. The owner must decide whether that Workbench can be closed.",
          "LEASE_ORPHANED",
          check.lease,
        );
      case "corrupt":
        throw new LeaseError(check.reason, "LEASE_CORRUPT");
    }
  }
  throw new LeaseError(
    `Could not acquire Workbench lease at ${path} (lost two races)`,
    "LEASE_HELD",
  );
}

function readOwned(path: string, session: string): WorkbenchLease {
  const lease = readLease(path);
  if (!lease) {
    throw new LeaseError(`No Workbench lease exists at ${path}`, "LEASE_NOT_OWNER");
  }
  if (lease.session !== session) {
    throw new LeaseError(
      `Workbench lease at ${path} belongs to ${describeLease(lease)}, not to ${session}`,
      "LEASE_NOT_OWNER",
      lease,
    );
  }
  return lease;
}

/** Refresh `heartbeat_at`. Throws LEASE_NOT_OWNER unless `session` holds the lease. */
export function heartbeatLease(
  path: string,
  session: string,
  deps: LeaseDeps = {},
): WorkbenchLease {
  const lease = readOwned(path, session);
  const updated = { ...lease, heartbeat_at: new Date((deps.now ?? Date.now)()).toISOString() };
  writeAtomic(path, updated);
  return updated;
}

/** Record the Workbench pid and/or project once known. Also refreshes the heartbeat. */
export function updateLease(
  path: string,
  session: string,
  patch: { wb_pid?: number | null; project?: string | null },
  deps: LeaseDeps = {},
): WorkbenchLease {
  const lease = readOwned(path, session);
  const updated: WorkbenchLease = {
    ...lease,
    wb_pid: patch.wb_pid === undefined ? lease.wb_pid : patch.wb_pid,
    project: patch.project === undefined ? lease.project : patch.project,
    heartbeat_at: new Date((deps.now ?? Date.now)()).toISOString(),
  };
  writeAtomic(path, updated);
  return updated;
}

/**
 * Release the lease held by `session`. Returns false when no lease exists.
 * Throws LEASE_NOT_OWNER when another session holds it.
 */
export function releaseLease(path: string, session: string): boolean {
  if (!existsSync(path)) return false;
  readOwned(path, session);
  try {
    unlinkSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
  return true;
}
