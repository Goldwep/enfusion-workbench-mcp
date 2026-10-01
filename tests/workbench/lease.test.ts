import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LEASE_STALE_MS,
  LeaseError,
  acquireLease,
  checkLease,
  heartbeatLease,
  isNoAutolaunch,
  readLease,
  releaseLease,
  resolveLeasePath,
  resolveNoAutolaunchPath,
  updateLease,
  type WorkbenchLease,
} from "../../src/workbench/lease.js";

function tmpLease(): string {
  return join(mkdtempSync(join(tmpdir(), "emcp-lease-")), "nested", "workbench.lease.json");
}

function writeRaw(path: string, lease: WorkbenchLease): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(lease), "utf-8");
}

const T0 = Date.parse("2026-10-01T12:00:00.000Z");

describe("lease", () => {
  describe("acquireLease", () => {
    it("creates the lease when free, including the parent directory", () => {
      const path = tmpLease();
      const lease = acquireLease(path, { session: "a", purpose: "test" }, { now: () => T0 });
      expect(existsSync(path)).toBe(true);
      expect(lease.session).toBe("a");
      expect(lease.wb_pid).toBeNull();
      expect(lease.project).toBeNull();
      expect(readLease(path)).toEqual(lease);
    });

    it("refuses a second session while the heartbeat is fresh", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test" }, { now: () => T0 });
      expect(() =>
        acquireLease(path, { session: "b", purpose: "test" }, { now: () => T0 + 60_000 }),
      ).toThrow(/held by a/);
      try {
        acquireLease(path, { session: "b", purpose: "test" }, { now: () => T0 + 60_000 });
      } catch (e) {
        expect(e).toBeInstanceOf(LeaseError);
        expect((e as LeaseError).code).toBe("LEASE_HELD");
      }
    });

    it("is re-entrant for the same session and refreshes the heartbeat", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test" }, { now: () => T0 });
      const again = acquireLease(
        path,
        { session: "a", purpose: "test" },
        { now: () => T0 + 5_000 },
      );
      expect(again.heartbeat_at).toBe(new Date(T0 + 5_000).toISOString());
      expect(again.started_at).toBe(new Date(T0).toISOString());
    });

    it("takes over a stale lease (expired heartbeat, no running pid)", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test", wb_pid: 4242 }, { now: () => T0 });
      const later = T0 + LEASE_STALE_MS + 1;
      const lease = acquireLease(
        path,
        { session: "b", purpose: "test" },
        { now: () => later, isAlive: () => false },
      );
      expect(lease.session).toBe("b");
      expect(readLease(path)?.session).toBe("b");
    });

    it("never takes an orphaned lease (expired heartbeat, pid still running)", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test", wb_pid: 4242 }, { now: () => T0 });
      const later = T0 + LEASE_STALE_MS + 1;
      expect(() =>
        acquireLease(
          path,
          { session: "b", purpose: "test" },
          { now: () => later, isAlive: () => true },
        ),
      ).toThrow(/still running/);
      expect(readLease(path)?.session).toBe("a");
    });

    it("refuses to replace a corrupt lease file", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test" }, { now: () => T0 });
      writeFileSync(path, "{not json", "utf-8");
      expect(() => acquireLease(path, { session: "b", purpose: "test" })).toThrow(/not valid JSON/);
      expect(readFileSync(path, "utf-8")).toBe("{not json");
    });
  });

  describe("checkLease", () => {
    it("reports free when no file exists", () => {
      expect(checkLease(tmpLease())).toEqual({ state: "free" });
    });

    it("reports held while the heartbeat is fresh even if the pid is gone", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test", wb_pid: 1 }, { now: () => T0 });
      const check = checkLease(path, { now: () => T0 + 1_000, isAlive: () => false });
      expect(check.state).toBe("held");
    });

    it("reports stale and orphaned by the pid rule once the heartbeat expired", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test", wb_pid: 1 }, { now: () => T0 });
      const later = T0 + LEASE_STALE_MS + 1;
      expect(checkLease(path, { now: () => later, isAlive: () => false }).state).toBe("stale");
      expect(checkLease(path, { now: () => later, isAlive: () => true }).state).toBe("orphaned");
    });

    it("treats a null pid with an expired heartbeat as stale", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test" }, { now: () => T0 });
      const later = T0 + LEASE_STALE_MS + 1;
      expect(checkLease(path, { now: () => later, isAlive: () => true }).state).toBe("stale");
    });

    it("reports corrupt for a wrong shape", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test" });
      writeFileSync(path, JSON.stringify({ session: "a" }), "utf-8");
      const check = checkLease(path);
      expect(check.state).toBe("corrupt");
    });
  });

  describe("heartbeat, update, release", () => {
    it("refreshes the heartbeat for the owner only", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test" }, { now: () => T0 });
      const beat = heartbeatLease(path, "a", { now: () => T0 + 9_000 });
      expect(beat.heartbeat_at).toBe(new Date(T0 + 9_000).toISOString());
      expect(() => heartbeatLease(path, "b")).toThrow(/belongs to a/);
    });

    it("records pid and project", () => {
      const path = tmpLease();
      acquireLease(path, { session: "a", purpose: "test" }, { now: () => T0 });
      const updated = updateLease(path, "a", { wb_pid: 777, project: "X/X.gproj" });
      expect(updated.wb_pid).toBe(777);
      expect(updated.project).toBe("X/X.gproj");
      const kept = updateLease(path, "a", { project: null });
      expect(kept.wb_pid).toBe(777);
      expect(kept.project).toBeNull();
    });

    it("releases only the owner's lease", () => {
      const path = tmpLease();
      expect(releaseLease(path, "a")).toBe(false);
      acquireLease(path, { session: "a", purpose: "test" });
      expect(() => releaseLease(path, "b")).toThrow(LeaseError);
      expect(releaseLease(path, "a")).toBe(true);
      expect(existsSync(path)).toBe(false);
    });

    it("keeps the raw file identical on a failed takeover", () => {
      const path = tmpLease();
      const original: WorkbenchLease = {
        session: "a",
        purpose: "test",
        started_at: new Date(T0).toISOString(),
        heartbeat_at: new Date(T0).toISOString(),
        wb_pid: null,
        project: null,
      };
      writeRaw(path, original);
      expect(() => acquireLease(path, { session: "b", purpose: "t" }, { now: () => T0 })).toThrow();
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(original);
    });
  });

  describe("paths and marker", () => {
    it("prefers config, then the environment, then the default", () => {
      const saved = process.env.ENFUSION_LEASE_PATH;
      const savedMarker = process.env.ENFUSION_NO_AUTOLAUNCH_PATH;
      try {
        process.env.ENFUSION_LEASE_PATH = "/env/lease.json";
        process.env.ENFUSION_NO_AUTOLAUNCH_PATH = "/env/marker";
        expect(resolveLeasePath({ leasePath: "/cfg/lease.json" })).toBe("/cfg/lease.json");
        expect(resolveLeasePath({})).toBe("/env/lease.json");
        expect(resolveNoAutolaunchPath({ noAutolaunchPath: "/cfg/marker" })).toBe("/cfg/marker");
        expect(resolveNoAutolaunchPath()).toBe("/env/marker");
        delete process.env.ENFUSION_LEASE_PATH;
        delete process.env.ENFUSION_NO_AUTOLAUNCH_PATH;
        expect(resolveLeasePath()).toMatch(/workbench\.lease\.json$/);
        expect(resolveNoAutolaunchPath()).toMatch(/no-autolaunch$/);
      } finally {
        if (saved === undefined) delete process.env.ENFUSION_LEASE_PATH;
        else process.env.ENFUSION_LEASE_PATH = saved;
        if (savedMarker === undefined) delete process.env.ENFUSION_NO_AUTOLAUNCH_PATH;
        else process.env.ENFUSION_NO_AUTOLAUNCH_PATH = savedMarker;
      }
    });

    it("detects the marker file", () => {
      const dir = mkdtempSync(join(tmpdir(), "emcp-marker-"));
      const marker = join(dir, "no-autolaunch");
      expect(isNoAutolaunch(marker)).toBe(false);
      writeFileSync(marker, "", "utf-8");
      expect(isNoAutolaunch(marker)).toBe(true);
    });
  });
});
