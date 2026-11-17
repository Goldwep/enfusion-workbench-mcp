import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The live-battery harness tests (tests/live-harness) check the batteries against their runbooks,
// queues and baselines, which live in the 2.0 programme record under docs/v2. The public export
// leaves docs/v2 out, so without it those tests are not collected.
const ROOT = dirname(fileURLToPath(import.meta.url));
const LIVE_HARNESS = existsSync(join(ROOT, "docs", "v2", "sessions"))
  ? []
  : ["tests/live-harness/**"];

// Keep vitest scoped to the real test tree. Without an explicit exclude,
// stale worktree copies under .claude/worktrees/** get collected too and
// the suite count doubles (2,216 vs ~1,030 as of 2026-09-03).
export default defineConfig({
  test: {
    exclude: ["**/.claude/**", "**/node_modules/**", "**/dist/**", ...LIVE_HARNESS],
    // The census and hook tests build ledgers and spawn git and node; several
    // cross the 5 s default on Windows whenever the machine is busy.
    testTimeout: 30_000,
    // Tests must never read the machine's real Workbench lease or
    // no-autolaunch marker: a live Workbench session on the dev box holds the
    // lease and would make every lease-aware tool refuse. Tests that need a
    // lease pass their own leasePath in Config.
    env: {
      ENFUSION_LEASE_PATH: join(tmpdir(), "emcp-vitest", "absent.lease.json"),
      ENFUSION_NO_AUTOLAUNCH_PATH: join(tmpdir(), "emcp-vitest", "absent-no-autolaunch"),
    },
  },
});
