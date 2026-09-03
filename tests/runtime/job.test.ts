import { describe, it, expect } from "vitest";
import { JobStore, type JobContext } from "../../src/runtime/job.js";

/** Poll the job until it settles or `timeoutMs` elapses. Polls every ~5ms. */
async function waitForSettled(
  store: JobStore,
  id: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = store.status(id);
    if (
      info &&
      (info.status === "done" ||
        info.status === "failed" ||
        info.status === "cancelled")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Job ${id} did not settle within ${timeoutMs}ms`);
}

describe("JobStore", () => {
  it("spawns a job, runs it, surfaces the result", async () => {
    const store = new JobStore();
    const id = store.spawn<number>(async () => 42);

    // Either still queued, just-running, or already done depending on timing.
    const initial = store.status(id);
    expect(initial).not.toBeNull();
    expect(["queued", "running", "done"]).toContain(initial!.status);

    await waitForSettled(store, id);

    const final = store.status<number>(id);
    expect(final).not.toBeNull();
    expect(final!.status).toBe("done");
    expect(final!.result).toBe(42);
    expect(final!.startedAt).not.toBeNull();
    expect(final!.completedAt).not.toBeNull();
    expect(final!.error).toBeUndefined();
  });

  it("surfaces a thrown error as failed + captures the message", async () => {
    const store = new JobStore();
    const id = store.spawn(async () => {
      throw new Error("boom");
    });

    await waitForSettled(store, id);

    const final = store.status(id);
    expect(final!.status).toBe("failed");
    expect(final!.error).toBe("boom");
    expect(final!.result).toBeUndefined();
  });

  it("cancels a job that observes the flag", async () => {
    const store = new JobStore();
    const id = store.spawn(async (ctx: JobContext) => {
      // Loop, periodically yielding + checking cancellation.
      for (let i = 0; i < 100; i++) {
        if (ctx.isCancelled()) return "halted";
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return "finished naturally";
    });

    // Cancel immediately. Worker observes on next tick.
    expect(store.cancel(id)).toBe(true);

    await waitForSettled(store, id);

    const final = store.status<string>(id);
    expect(final!.status).toBe("cancelled");
  });

  it("cancel() returns false for a job that already settled", async () => {
    const store = new JobStore();
    const id = store.spawn(async () => "ok");
    await waitForSettled(store, id);
    expect(store.cancel(id)).toBe(false);
  });

  it("cancel() returns false for an unknown id", () => {
    const store = new JobStore();
    expect(store.cancel("0000000000000000")).toBe(false);
  });

  it("status() returns null for an unknown id", () => {
    const store = new JobStore();
    expect(store.status("0000000000000000")).toBeNull();
  });

  it("log buffer captures lines emitted by the workFn", async () => {
    const store = new JobStore();
    const id = store.spawn(async (ctx: JobContext) => {
      ctx.log("step 1");
      ctx.log("step 2");
      ctx.log("step 3");
      return "done";
    });

    await waitForSettled(store, id);

    const final = store.status(id);
    expect(final!.logs).toEqual(["step 1", "step 2", "step 3"]);
  });

  it("log buffer evicts oldest lines past the cap", async () => {
    const store = new JobStore();
    const id = store.spawn(async (ctx: JobContext) => {
      // Cap is 500. Emit 600 lines; first 100 should be dropped.
      for (let i = 0; i < 600; i++) {
        ctx.log(`line ${i}`);
      }
      return null;
    });

    await waitForSettled(store, id);

    const final = store.status(id);
    expect(final!.logs.length).toBe(500);
    // Oldest retained line should be line 100 (lines 0-99 dropped).
    expect(final!.logs[0]).toBe("line 100");
    expect(final!.logs[final!.logs.length - 1]).toBe("line 599");
  });

  it("status() returns a defensive copy of the logs array", async () => {
    const store = new JobStore();
    const id = store.spawn(async (ctx: JobContext) => {
      ctx.log("one");
      return null;
    });
    await waitForSettled(store, id);

    const snap1 = store.status(id)!;
    // Mutate the snapshot's logs — should not affect the store.
    snap1.logs.push("INJECTED");

    const snap2 = store.status(id)!;
    expect(snap2.logs).toEqual(["one"]);
  });

  it("list() returns snapshots of every tracked job", async () => {
    const store = new JobStore();
    const id1 = store.spawn(async () => 1, "first");
    const id2 = store.spawn(async () => 2, "second");
    await waitForSettled(store, id1);
    await waitForSettled(store, id2);

    const all = store.list();
    expect(all.length).toBe(2);
    const ids = all.map((j) => j.id).sort();
    expect(ids).toEqual([id1, id2].sort());
    const kinds = all.map((j) => j.kind);
    expect(kinds).toContain("first");
    expect(kinds).toContain("second");
  });

  it("remove() works for settled jobs, refuses running/queued", async () => {
    const store = new JobStore();
    // A job that resolves immediately.
    const idDone = store.spawn(async () => 1);
    await waitForSettled(store, idDone);
    expect(store.remove(idDone)).toBe(true);
    expect(store.status(idDone)).toBeNull();

    // A running job — cannot remove without cancel + settle.
    const idRunning = store.spawn(async (ctx: JobContext) => {
      while (!ctx.isCancelled()) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return null;
    });
    // Give it a tick to start.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.remove(idRunning)).toBe(false);

    // Clean up the running job so the test process can exit.
    store.cancel(idRunning);
    await waitForSettled(store, idRunning);
    expect(store.remove(idRunning)).toBe(true);
  });
});
