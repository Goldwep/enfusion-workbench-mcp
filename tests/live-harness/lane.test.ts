import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLease, readLease } from "../../src/workbench/lease.js";
import {
  Lane,
  PLAN_LEASE_HELD,
  PLAN_LEASE_ORPHANED,
  laneRefusal,
} from "../../scripts/live/lane.js";

function tempPaths(): { dir: string; leasePath: string; markerPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "emcp-lane-"));
  return { dir, leasePath: join(dir, "lease.json"), markerPath: join(dir, "no-autolaunch") };
}

describe("Lane", () => {
  it("runs the lifecycle: start, heartbeat, record, end", () => {
    const { dir, leasePath, markerPath } = tempPaths();
    let t = Date.parse("2026-10-01T10:00:00Z");
    const deps = { now: () => t, isAlive: () => false };
    try {
      const lane = new Lane({ id: "t1", leasePath, markerPath, deps });
      const lease = lane.start("live session S-C");
      expect(lease.session).toBe("v2-harness:t1");
      expect(lease.purpose).toBe("live session S-C");
      expect(readFileSync(markerPath, "utf-8").trim()).toBe("v2-harness:t1");
      expect(lane.holdsLease()).toBe(true);

      t += 60_000;
      expect(lane.heartbeat().heartbeat_at).toBe("2026-10-01T10:01:00.000Z");

      lane.record(4242, "C:/sandbox/EMCP2_sandbox.gproj");
      expect(readLease(leasePath)).toMatchObject({
        wb_pid: 4242,
        project: "C:/sandbox/EMCP2_sandbox.gproj",
      });
      expect(lane.recordedPid()).toBe(4242);

      expect(lane.end()).toMatchObject({ released: true, markerRemoved: false });
      expect(existsSync(markerPath)).toBe(true);
      lane.start("S-C again");
      expect(lane.end({ removeMarker: true })).toEqual({
        released: true,
        markerRemoved: true,
        markerNote: null,
      });
      expect(existsSync(leasePath)).toBe(false);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("heartbeats on a timer until stopped", async () => {
    const { dir, leasePath, markerPath } = tempPaths();
    try {
      const lane = new Lane({ id: "t2", leasePath, markerPath });
      const first = lane.start("timer").heartbeat_at;
      lane.startHeartbeat(20);
      expect(lane.heartbeating).toBe(true);
      await new Promise((r) => setTimeout(r, 120));
      expect(readLease(leasePath)!.heartbeat_at > first).toBe(true);
      lane.end();
      expect(lane.heartbeating).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a lease held by another session with the plan's wording", () => {
    const { dir, leasePath, markerPath } = tempPaths();
    try {
      acquireLease(leasePath, { session: "registered:1", purpose: "registered-server" });
      const lane = new Lane({ id: "t3", leasePath, markerPath });
      expect(() => lane.start("S-C")).toThrow(PLAN_LEASE_HELD);
      expect(existsSync(markerPath)).toBe(false);
      expect(readLease(leasePath)!.session).toBe("registered:1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never takes an orphaned lease", () => {
    const { dir, leasePath, markerPath } = tempPaths();
    const t0 = Date.parse("2026-10-01T10:00:00Z");
    try {
      acquireLease(
        leasePath,
        { session: "v2-harness:dead", purpose: "S-C", wb_pid: 999 },
        { now: () => t0 },
      );
      const lane = new Lane({
        id: "t4",
        leasePath,
        markerPath,
        deps: { now: () => t0 + 16 * 60_000, isAlive: (pid) => pid === 999 },
      });
      expect(() => lane.start("S-C")).toThrow(PLAN_LEASE_ORPHANED);
      expect(readLease(leasePath)!.session).toBe("v2-harness:dead");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops on a corrupt lease without replacing it", () => {
    const { dir, leasePath, markerPath } = tempPaths();
    try {
      writeFileSync(leasePath, "{ not json");
      const lane = new Lane({ id: "t5", leasePath, markerPath });
      expect(() => lane.start("S-C")).toThrow("corrupt");
      expect(readFileSync(leasePath, "utf-8")).toBe("{ not json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not remove a marker it did not create", () => {
    const { dir, leasePath, markerPath } = tempPaths();
    try {
      writeFileSync(markerPath, "");
      const lane = new Lane({ id: "t6", leasePath, markerPath });
      lane.start("S-C");
      const r = lane.end();
      expect(r.released).toBe(true);
      expect(r.markerRemoved).toBe(false);
      expect(existsSync(markerPath)).toBe(true);
      expect(readFileSync(markerPath, "utf-8")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not let another lane id end this lane's lease or marker", () => {
    const { dir, leasePath, markerPath } = tempPaths();
    try {
      new Lane({ id: "owner", leasePath, markerPath }).start("S-C");
      const other = new Lane({ id: "other", leasePath, markerPath });
      expect(() => other.end()).toThrow("belongs to");
      expect(existsSync(leasePath)).toBe(true);
      expect(existsSync(markerPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an id with path characters", () => {
    expect(() => new Lane({ id: "../x" })).toThrow("Invalid lane id");
  });
});

describe("laneRefusal", () => {
  it("allows a free lease and the lane's own lease", () => {
    expect(laneRefusal({ state: "free" }, "v2-harness:a")).toBeNull();
    const lease = {
      session: "v2-harness:a",
      purpose: "p",
      started_at: "x",
      heartbeat_at: "x",
      wb_pid: null,
      project: null,
    };
    expect(laneRefusal({ state: "held", lease, path: "p" }, "v2-harness:a")).toBeNull();
    expect(laneRefusal({ state: "held", lease, path: "p" }, "v2-harness:b")).toContain(
      PLAN_LEASE_HELD,
    );
  });
});
