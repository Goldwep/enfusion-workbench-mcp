/**
 * The 2.0 live lane (plan 5.1 guard 3, 5.3): one strictly serial lane, owned by
 * the main session, around the machine-wide Workbench lease of
 * `src/workbench/lease.ts`. This file never re-implements the lease format; it
 * only calls the lease module, so the registered server and the harness cannot
 * disagree about it.
 *
 *   start(purpose)  acquire the lease as `v2-harness:<id>` and create the
 *                   no-autolaunch marker (only when it does not exist yet)
 *   heartbeat()     refresh the lease; startHeartbeat() repeats it on a timer
 *   record(pid, p)  record the Workbench pid and project this lane started
 *   end()           release the lease; the marker stays for the programme.
 *                   end({ removeMarker: true }) also removes the marker, but
 *                   only the marker this lane created (its content names the
 *                   session) — plan 5.1: removed at release, not per sitting
 *
 * A lease held by another session, an orphaned lease (heartbeat expired while
 * its Workbench is still running) and a corrupt lease all stop the lane with
 * the plan's instruction: ask the owner. An orphaned lease is never taken.
 *
 * Usage (lease and marker paths follow ENFUSION_LEASE_PATH and
 * ENFUSION_NO_AUTOLAUNCH_PATH, or --lease-path / --marker-path):
 *   npx tsx scripts/live/lane.ts status
 *   npx tsx scripts/live/lane.ts start --purpose "live session S-C" [--id <id>]
 *   npx tsx scripts/live/lane.ts heartbeat --id <id>
 *   npx tsx scripts/live/lane.ts record --id <id> --pid <wb pid> --project <gproj>
 *   npx tsx scripts/live/lane.ts end --id <id> [--release-programme]
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  LeaseError,
  acquireLease,
  checkLease,
  describeLease,
  heartbeatLease,
  readLease,
  releaseLease,
  resolveLeasePath,
  resolveNoAutolaunchPath,
  updateLease,
  type LeaseCheck,
  type LeaseDeps,
  type WorkbenchLease,
} from "../../src/workbench/lease.js";
import { isMainModule, parseArgs } from "./cli.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Session id prefix of every harness lane (plan 5.1: "v2-harness:<session>"). */
export const LANE_SESSION_PREFIX = "v2-harness:";

/** Default heartbeat interval: well inside the 15-minute staleness window. */
export const DEFAULT_HEARTBEAT_MS = 60_000;

/** Plan 5.3 pre-flight step 1, verbatim: what to do when the lease is not ours. */
export const PLAN_LEASE_HELD = "If someone else holds it, stop and tell the owner.";

/**
 * Plan 5.1 guard 1, verbatim: an expired heartbeat with a live Workbench is
 * never taken automatically.
 */
export const PLAN_LEASE_ORPHANED =
  "nobody takes the lease automatically: the next session asks the owner for a go to kill " +
  "that pid, then takes the lease.";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LaneOptions {
  /** Lane id; the lease session becomes `v2-harness:<id>`. Generated when omitted. */
  id?: string;
  /** Lease file. Defaults to ENFUSION_LEASE_PATH, then the lease module default. */
  leasePath?: string;
  /** No-autolaunch marker. Defaults to ENFUSION_NO_AUTOLAUNCH_PATH, then the default. */
  markerPath?: string;
  /** Clock and liveness probe, injectable for tests. */
  deps?: LeaseDeps;
}

export interface LaneStatus {
  session: string;
  lease: LeaseCheck;
  /** True when the lease is held by this lane. */
  heldByLane: boolean;
  marker: { path: string; exists: boolean; createdByLane: boolean };
}

export interface LaneEndResult {
  released: boolean;
  markerRemoved: boolean;
  /** Why the marker stayed, when it did. */
  markerNote: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Validate a lane id: it ends up in a file and in evidence names. */
export function validateLaneId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`Invalid lane id "${id}": use letters, digits, ".", "_" or "-" (max 64)`);
  }
  return id;
}

/**
 * The plan's wording for a lease this lane may not take, or null when the
 * lease is free, stale (may be taken) or already held by `session`.
 */
export function laneRefusal(check: LeaseCheck, session: string): string | null {
  switch (check.state) {
    case "free":
    case "stale":
      return null;
    case "held":
      if (check.lease.session === session) return null;
      return `Workbench lease is held by ${describeLease(check.lease)}. ${PLAN_LEASE_HELD}`;
    case "orphaned":
      return (
        `Workbench lease at ${check.path} is orphaned: its heartbeat expired but Workbench ` +
        `(pid ${check.lease.wb_pid}) is still running: ${describeLease(check.lease)}. ` +
        `Never taken automatically; ${PLAN_LEASE_ORPHANED}`
      );
    case "corrupt":
      return (
        `Workbench lease file ${check.path} is corrupt (${check.reason}). Stop and ask the owner; ` +
        "never replace it silently."
      );
  }
}

// ── Lane ─────────────────────────────────────────────────────────────────────

export class Lane {
  readonly id: string;
  readonly session: string;
  readonly leasePath: string;
  readonly markerPath: string;
  private readonly deps: LeaseDeps;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: LaneOptions = {}) {
    this.id = validateLaneId(opts.id ?? randomBytes(4).toString("hex"));
    this.session = `${LANE_SESSION_PREFIX}${this.id}`;
    this.leasePath = opts.leasePath ?? resolveLeasePath();
    this.markerPath = opts.markerPath ?? resolveNoAutolaunchPath();
    this.deps = opts.deps ?? {};
  }

  /** Lease and marker state, without changing anything. */
  status(): LaneStatus {
    const lease = checkLease(this.leasePath, this.deps);
    return {
      session: this.session,
      lease,
      heldByLane: lease.state === "held" && lease.lease.session === this.session,
      marker: {
        path: this.markerPath,
        exists: existsSync(this.markerPath),
        createdByLane: this.markerOwnedByLane(),
      },
    };
  }

  /** True when this lane holds a live (not expired) lease. */
  holdsLease(): boolean {
    return this.status().heldByLane;
  }

  /**
   * Acquire the lease for `purpose` and create the no-autolaunch marker.
   * Throws LeaseError, carrying the plan's wording, when the lease is held by
   * someone else, orphaned or corrupt.
   */
  start(purpose: string): WorkbenchLease {
    if (!purpose.trim()) throw new Error("A purpose is required to start the lane");
    const check = checkLease(this.leasePath, this.deps);
    const refusal = laneRefusal(check, this.session);
    if (refusal) {
      const code =
        check.state === "orphaned"
          ? "LEASE_ORPHANED"
          : check.state === "corrupt"
            ? "LEASE_CORRUPT"
            : "LEASE_HELD";
      throw new LeaseError(refusal, code, "lease" in check ? check.lease : undefined);
    }
    let lease: WorkbenchLease;
    try {
      lease = acquireLease(this.leasePath, { session: this.session, purpose }, this.deps);
    } catch (e) {
      if (e instanceof LeaseError && e.code === "LEASE_HELD") {
        throw new LeaseError(`${e.message} ${PLAN_LEASE_HELD}`, e.code, e.lease);
      }
      throw e;
    }
    try {
      this.createMarker();
    } catch (e) {
      releaseLease(this.leasePath, this.session);
      throw e;
    }
    return lease;
  }

  /** Refresh the lease heartbeat. Throws LEASE_NOT_OWNER unless this lane holds it. */
  heartbeat(): WorkbenchLease {
    return heartbeatLease(this.leasePath, this.session, this.deps);
  }

  /**
   * Heartbeat every `intervalMs` until stopHeartbeat() or end(). The timer is
   * unref'd so it never keeps a script alive on its own. A failed heartbeat
   * stops the timer and is reported through `onError`.
   */
  startHeartbeat(
    intervalMs: number = DEFAULT_HEARTBEAT_MS,
    onError: (e: unknown) => void = () => {},
  ): void {
    this.stopHeartbeat();
    const tick = (): void => {
      try {
        this.heartbeat();
      } catch (e) {
        this.timer = null;
        onError(e);
        return;
      }
      this.timer = setTimeout(tick, intervalMs);
      this.timer.unref();
    };
    this.timer = setTimeout(tick, intervalMs);
    this.timer.unref();
  }

  /** Stop the heartbeat timer, if any. */
  stopHeartbeat(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** True while the heartbeat timer is armed. */
  get heartbeating(): boolean {
    return this.timer !== null;
  }

  /** Record the Workbench pid and project this lane started. */
  record(wbPid: number | null, project: string | null): WorkbenchLease {
    if (wbPid !== null && (!Number.isInteger(wbPid) || wbPid <= 0)) {
      throw new Error(`Invalid Workbench pid: ${wbPid}`);
    }
    return updateLease(this.leasePath, this.session, { wb_pid: wbPid, project }, this.deps);
  }

  /** The Workbench pid recorded in this lane's lease, if any. */
  recordedPid(): number | null {
    const lease = readLease(this.leasePath);
    return lease && lease.session === this.session ? lease.wb_pid : null;
  }

  /**
   * Release the lease and remove the no-autolaunch marker this lane created.
   * A marker created by anyone else is left in place. A lease held by another
   * session is not touched (LEASE_NOT_OWNER propagates) and the marker stays.
   */
  end(opts: { removeMarker?: boolean } = {}): LaneEndResult {
    this.stopHeartbeat();
    // releaseLease refuses (LEASE_ORPHANED) while the recorded Workbench is
    // still running; that error propagates so the caller reports it.
    const released = releaseLease(this.leasePath, this.session, this.deps);
    if (!existsSync(this.markerPath)) {
      return { released, markerRemoved: false, markerNote: "no marker present" };
    }
    if (!opts.removeMarker) {
      // Plan 5.1 guard 3: the marker stays for the whole programme and is
      // removed at release, not after every sitting.
      return {
        released,
        markerRemoved: false,
        markerNote: "kept for the programme (lane.ts end --release-programme removes it)",
      };
    }
    if (!this.markerOwnedByLane()) {
      return {
        released,
        markerRemoved: false,
        markerNote: "marker was not created by this lane; left in place",
      };
    }
    unlinkSync(this.markerPath);
    return { released, markerRemoved: true, markerNote: null };
  }

  private markerOwnedByLane(): boolean {
    try {
      return readFileSync(this.markerPath, "utf-8").trim() === this.session;
    } catch {
      return false;
    }
  }

  /** Create the marker exclusively with this session as its content; keep an existing one. */
  private createMarker(): boolean {
    mkdirSync(dirname(this.markerPath), { recursive: true });
    let fd: number;
    try {
      fd = openSync(this.markerPath, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
    try {
      writeSync(fd, `${this.session}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function formatStatus(s: LaneStatus): string {
  const lines: string[] = [];
  lines.push(`lane session: ${s.session}`);
  switch (s.lease.state) {
    case "free":
      lines.push("lease: free");
      break;
    case "corrupt":
      lines.push(`lease: corrupt (${s.lease.reason})`);
      break;
    default:
      lines.push(`lease: ${s.lease.state}: ${describeLease(s.lease.lease)}`);
  }
  lines.push(`held by this lane: ${s.heldByLane ? "yes" : "no"}`);
  lines.push(
    `no-autolaunch marker: ${s.marker.exists ? "present" : "absent"}` +
      (s.marker.exists ? (s.marker.createdByLane ? " (created by this lane)" : " (not ours)") : ""),
  );
  return lines.join("\n");
}

export function main(argv: string[]): number {
  let args;
  try {
    args = parseArgs(argv, ["purpose", "id", "pid", "project", "lease-path", "marker-path"]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const cmd = args.positional[0] ?? "status";
  const needsId = cmd === "heartbeat" || cmd === "record" || cmd === "end";
  if (needsId && !args.options.id) {
    console.error(`lane ${cmd} needs --id <id> (printed by "lane start")`);
    return 2;
  }
  try {
    const lane = new Lane({
      id: args.options.id,
      leasePath: args.options["lease-path"],
      markerPath: args.options["marker-path"],
    });
    switch (cmd) {
      case "status":
        console.log(formatStatus(lane.status()));
        return 0;
      case "start": {
        const purpose = args.options.purpose;
        if (!purpose) {
          console.error("lane start needs --purpose <text>");
          return 2;
        }
        const lease = lane.start(purpose);
        console.log(`lease acquired: ${describeLease(lease)}`);
        console.log(`lane id: ${lane.id} (pass --id ${lane.id} to heartbeat, record and end)`);
        return 0;
      }
      case "heartbeat":
        console.log(`heartbeat: ${describeLease(lane.heartbeat())}`);
        return 0;
      case "record": {
        const pid = args.options.pid ? Number(args.options.pid) : null;
        const lease = lane.record(pid, args.options.project ?? null);
        console.log(`recorded: ${describeLease(lease)}`);
        return 0;
      }
      case "end": {
        const r = lane.end({ removeMarker: args.flags.has("release-programme") });
        console.log(`lease released: ${r.released ? "yes" : "no lease present"}`);
        console.log(`marker removed: ${r.markerRemoved ? "yes" : `no (${r.markerNote})`}`);
        return 0;
      }
      default:
        console.error("Usage: lane.ts status | start --purpose <p> | heartbeat | record | end");
        return 2;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
