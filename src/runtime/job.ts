/**
 * Long-running task pattern (L2-6).
 *
 * `JobStore` is the in-process registry for async jobs that outlive a single
 * MCP tool call. First consumer: `wb_build_data` `action:"start"|"poll"`
 * (src/tools/wb-build-data.ts, review 2026-09 H11). Future tools (navmesh
 * bake, publish, bulk-export — all O(seconds-to-minutes)) reuse it rather
 * than reinventing async-with-poll plumbing per tool.
 *
 * Lifecycle:
 *
 *   spawn()   → status: "queued" → "running"
 *   workFn()  → resolves → status: "done"
 *               throws   → status: "failed" with `error` message
 *               cancel() → status: "cancelled" once workFn observes the flag
 *
 * Callers spawn a job, get back an opaque `jobId`, and subsequent tool calls
 * poll `status(jobId)` for progress, log lines, and the final result. The
 * underlying `workFn(ctx)` is responsible for observing `ctx.isCancelled()`
 * at appropriate yield points — cancellation is cooperative, not forced.
 *
 * Storage is purely in-memory. Jobs DO NOT survive a server restart. The
 * registry caps total job count (FIFO eviction) so a long-running server
 * doesn't grow without bound.
 */

import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";

// ── Public types ─────────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Snapshot of one job — what tools return to the caller. */
export interface JobInfo<T = unknown> {
  /** Opaque ID — 16 hex chars. Pass to status()/cancel(). */
  id: string;
  /** Optional human-readable kind tag (e.g. "navmesh-bake", "build-data"). */
  kind: string | null;
  status: JobStatus;
  /** Wall-clock ms-since-epoch the job was registered. */
  createdAt: number;
  /** When the workFn began executing. `null` while queued. */
  startedAt: number | null;
  /** When the workFn settled (done / failed / cancelled). `null` otherwise. */
  completedAt: number | null;
  /**
   * Rolling log buffer — most recent {@link LOG_BUFFER_CAP} lines emitted via
   * `ctx.log()`. Older lines are dropped FIFO.
   */
  logs: string[];
  /** Set only when status === "done". */
  result?: T;
  /** Set only when status === "failed". */
  error?: string;
}

/** Handed to the workFn so it can emit logs and observe cancellation. */
export interface JobContext {
  /** Append one line to the job's rolling log buffer. */
  log(line: string): void;
  /** Cooperative cancellation flag. Check at yield points. */
  isCancelled(): boolean;
}

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Max lines retained per job. Older lines fall off the front. */
const LOG_BUFFER_CAP = 500;

/** Max jobs retained in the store. Older completed jobs get evicted FIFO. */
const JOB_STORE_CAP = 50;

// ── Internal entry ───────────────────────────────────────────────────────────

interface JobEntry<T = unknown> {
  info: JobInfo<T>;
  /** Cooperative cancellation flag — flipped by cancel(), polled by workFn. */
  cancelled: boolean;
}

// ── JobStore ─────────────────────────────────────────────────────────────────

export class JobStore {
  private readonly jobs: Map<string, JobEntry> = new Map();

  /**
   * Spawn a new job. The work function starts asynchronously on the next
   * microtask — `spawn()` returns immediately with the new job's ID.
   *
   * If the workFn throws or rejects, the job moves to `failed` and the error
   * message is captured. If the workFn returns normally and was not
   * cancelled, the job moves to `done` and the resolved value is stored as
   * `result`.
   *
   * @param workFn The async unit of work. Takes a context for logging +
   *   cancellation checks. Resolve with the final result; reject to mark
   *   the job as failed.
   * @param kind Optional human-readable tag (e.g. "navmesh-bake"). Useful
   *   for `list()` output and operator debugging.
   */
  spawn<T>(workFn: (ctx: JobContext) => Promise<T>, kind: string | null = null): string {
    const id = generateJobId();
    const entry: JobEntry<T> = {
      info: {
        id,
        kind,
        status: "queued",
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        logs: [],
      },
      cancelled: false,
    };
    this.jobs.set(id, entry as JobEntry);
    this.evictIfFull();

    // Kick off async. Errors inside `run()` are caught and reflected in
    // entry.info — they never escape to the caller.
    setImmediate(() => {
      void this.run(entry, workFn);
    });

    logger.debug(`[job] spawned ${id}${kind ? ` (${kind})` : ""}`);
    return id;
  }

  /**
   * Snapshot of one job. Returns `null` when the id is unknown (already
   * evicted or never spawned). The returned object is a defensive copy
   * — mutating it does not affect store state, and the `logs` array is
   * cloned so a slow reader can't trip over a concurrent push.
   */
  status<T = unknown>(id: string): JobInfo<T> | null {
    const entry = this.jobs.get(id) as JobEntry<T> | undefined;
    if (!entry) return null;
    return { ...entry.info, logs: [...entry.info.logs] };
  }

  /**
   * Request cancellation. Returns `true` if the job is known and was not
   * already settled; `false` otherwise (already done/failed/cancelled or
   * unknown). Cancellation is cooperative — the workFn must observe
   * `ctx.isCancelled()` and exit voluntarily.
   */
  cancel(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry) return false;
    const s = entry.info.status;
    if (s === "done" || s === "failed" || s === "cancelled") return false;
    entry.cancelled = true;
    logger.debug(`[job] cancel requested for ${id}`);
    return true;
  }

  /** List all currently-tracked jobs (snapshots). Order is insertion order. */
  list(): JobInfo[] {
    return [...this.jobs.values()].map((e) => ({
      ...e.info,
      logs: [...e.info.logs],
    }));
  }

  /**
   * Remove a job from the store. Returns `true` if removed. Settled jobs
   * (done/failed/cancelled) are always removable. Running/queued jobs
   * cannot be evicted via this method — call cancel() first and wait.
   */
  remove(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry) return false;
    const s = entry.info.status;
    if (s === "running" || s === "queued") return false;
    return this.jobs.delete(id);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async run<T>(
    entry: JobEntry<T>,
    workFn: (ctx: JobContext) => Promise<T>,
  ): Promise<void> {
    // If cancelled before we even started, short-circuit.
    if (entry.cancelled) {
      entry.info.status = "cancelled";
      entry.info.completedAt = Date.now();
      return;
    }

    entry.info.status = "running";
    entry.info.startedAt = Date.now();

    const ctx: JobContext = {
      log: (line: string): void => {
        // Ring buffer: cap retained lines at LOG_BUFFER_CAP.
        entry.info.logs.push(line);
        if (entry.info.logs.length > LOG_BUFFER_CAP) {
          entry.info.logs.shift();
        }
      },
      isCancelled: (): boolean => entry.cancelled,
    };

    try {
      const result = await workFn(ctx);
      if (entry.cancelled) {
        entry.info.status = "cancelled";
      } else {
        entry.info.status = "done";
        entry.info.result = result;
      }
    } catch (e) {
      if (entry.cancelled) {
        // If the workFn threw because cancellation triggered an abort,
        // record it as cancelled rather than failed — the cancel was
        // user-intent, the throw was the implementation detail.
        entry.info.status = "cancelled";
      } else {
        entry.info.status = "failed";
        entry.info.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      entry.info.completedAt = Date.now();
    }
  }

  /**
   * Evict the oldest completed job when the store is over capacity. Never
   * evicts running/queued jobs even if that pushes us over cap — better
   * to grow temporarily than to lose tracking of in-flight work.
   */
  private evictIfFull(): void {
    if (this.jobs.size <= JOB_STORE_CAP) return;
    for (const [id, entry] of this.jobs) {
      const s = entry.info.status;
      if (s === "done" || s === "failed" || s === "cancelled") {
        this.jobs.delete(id);
        logger.debug(`[job] evicted ${id} (store at cap)`);
        if (this.jobs.size <= JOB_STORE_CAP) return;
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 16-hex-char opaque ID. Crypto random — no chance of collision in practice. */
function generateJobId(): string {
  return randomBytes(8).toString("hex");
}
