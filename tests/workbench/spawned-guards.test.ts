/**
 * The spawned-process guard test of plan 5.1: start the server from src/ as
 * its own stdio process, made unable to launch or reach anything, and check
 * over MCP that
 *   A) with the no-autolaunch marker absent, wb_state refuses to auto-launch
 *      without an explicit project;
 *   B) with the marker present and a lease held by another session, wb_launch
 *      with an explicit project and wb_state are both refused by the lease.
 *
 * The cases and the sandboxed environment are shared with
 * scripts/guards-check.ts (which runs them against dist/ for the Phase 0
 * exit gate), so the test and the gate cannot drift apart.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import {
  createGuardSandbox,
  runGuardCases,
  sandboxProblems,
  type CaseResult,
  type GuardSandbox,
} from "../../scripts/guards-check.js";

describe("spawned server guards", () => {
  let sb: GuardSandbox;
  let results: CaseResult[];

  beforeAll(async () => {
    sb = await createGuardSandbox();
    // `node --import tsx src/index.ts`, resolved from the repository root.
    results = await runGuardCases([process.execPath, "--import", "tsx", "src/index.ts"], sb);
  }, 180_000);

  afterAll(() => {
    if (sb) rmSync(sb.root, { recursive: true, force: true });
  });

  it("builds a sandbox in which every override is set and confined", () => {
    expect(sandboxProblems(sb)).toEqual([]);
    expect(sb.env.ENFUSION_DEFAULT_MOD).toBeUndefined();
  });

  it("refuses auto-launch without an explicit project when the marker is absent", () => {
    const a = results.find((r) => r.name.startsWith("A:"));
    expect(a, JSON.stringify(results)).toBeDefined();
    expect(a!.pass, a!.detail).toBe(true);
  });

  it("refuses wb_launch and wb_state while another session holds the lease", () => {
    const b = results.find((r) => r.name.startsWith("B:"));
    expect(b, JSON.stringify(results)).toBeDefined();
    expect(b!.pass, b!.detail).toBe(true);
  });

  it("refuses to run with an override pointing outside the sandbox", async () => {
    const outside = { ...sb, env: { ...sb.env, ENFUSION_LEASE_PATH: "/elsewhere/lease.json" } };
    await expect(runGuardCases([process.execPath, "-e", ""], outside)).rejects.toThrow(
      /refusing to run: ENFUSION_LEASE_PATH points outside the sandbox/,
    );
  });
});
