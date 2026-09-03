import { defineConfig } from "vitest/config";

// Keep vitest scoped to the real test tree. Without an explicit exclude,
// stale worktree copies under .claude/worktrees/** get collected too and
// the suite count doubles (2,216 vs ~1,030 as of 2026-09-03).
export default defineConfig({
  test: {
    exclude: ["**/.claude/**", "**/node_modules/**", "**/dist/**"],
  },
});
