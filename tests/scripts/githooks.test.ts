import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PRE_PUSH = join(ROOT, ".githooks", "pre-push");
const PRE_COMMIT = join(ROOT, ".githooks", "pre-commit");
const ZERO = "0".repeat(40);

const HAS_SH = spawnSync("sh", ["-c", "exit 0"]).status === 0;
const HAS_GIT = spawnSync("git", ["--version"]).status === 0;

/** Git environment isolated from any user or system configuration. */
function gitEnv(dir: string): NodeJS.ProcessEnv {
  const cfg = join(dir, "empty.gitconfig");
  writeFileSync(cfg, "");
  return {
    PATH: process.env.PATH,
    GIT_CONFIG_GLOBAL: cfg,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Hook Test",
    GIT_AUTHOR_EMAIL: "hook-test@example.invalid",
    GIT_COMMITTER_NAME: "Hook Test",
    GIT_COMMITTER_EMAIL: "hook-test@example.invalid",
  };
}

/**
 * A scratch repository with three commits on main's history: a, b (child of a)
 * and c (child of a, not of b), plus an orphan history p, q (child of p) that
 * shares no ancestor with main, the shape scripts/export-public.ts produces.
 */
function scratchRepo(): {
  dir: string;
  env: NodeJS.ProcessEnv;
  a: string;
  b: string;
  c: string;
  p: string;
  q: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "emcp-hooks-"));
  const env = gitEnv(dir);
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const g = (...args: string[]): string =>
    execFileSync("git", args, { cwd: repo, env, encoding: "utf-8" }).trim();
  g("init", "-q", "-b", "main");
  g("commit", "-q", "--allow-empty", "-m", "a");
  const a = g("rev-parse", "HEAD");
  g("commit", "-q", "--allow-empty", "-m", "b");
  const b = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "side", a);
  g("commit", "-q", "--allow-empty", "-m", "c");
  const c = g("rev-parse", "HEAD");
  g("checkout", "-q", "--orphan", "pub");
  g("commit", "-q", "--allow-empty", "-m", "p");
  const p = g("rev-parse", "HEAD");
  g("commit", "-q", "--allow-empty", "-m", "q");
  const q = g("rev-parse", "HEAD");
  g("checkout", "-q", "main");
  return { dir: repo, env, a, b, c, p, q };
}

function prePush(lines: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync("sh", [PRE_PUSH, "origin", "scratch-url"], {
    cwd,
    env,
    input: lines.map((l) => l + "\n").join(""),
    encoding: "utf-8",
  });
  return { code: r.status, err: r.stderr };
}

describe.skipIf(!HAS_SH || !HAS_GIT)("pre-push hook", () => {
  const { dir, env, a, b, c, p, q } = HAS_SH && HAS_GIT ? scratchRepo() : ({} as never);

  it("rejects main and names the ref", () => {
    const r = prePush([`refs/heads/main ${a} refs/heads/main ${ZERO}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("REJECTED refs/heads/main -> origin");
    expect(r.err).toContain("only refs/heads/public-release is pushable");
  });

  it("rejects v2", () => {
    const r = prePush([`refs/heads/v2 ${a} refs/heads/v2 ${ZERO}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("REJECTED refs/heads/v2");
  });

  it("rejects a tag", () => {
    const r = prePush([`refs/tags/v2.0.0 ${a} refs/tags/v2.0.0 ${ZERO}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("REJECTED refs/tags/v2.0.0");
    expect(r.err).toContain("tags stay local");
  });

  it("rejects deleting a remote ref, public-release included", () => {
    const r = prePush([`(delete) ${ZERO} refs/heads/public-release ${a}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("REJECTED refs/heads/public-release");
    expect(r.err).toContain("deleting a remote ref is never allowed");
  });

  it("allows a new public-release", () => {
    const r = prePush(
      [`refs/heads/public-release ${p} refs/heads/public-release ${ZERO}`],
      dir,
      env,
    );
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
  });

  it("allows a fast-forward of public-release", () => {
    const r = prePush([`refs/heads/public-release ${q} refs/heads/public-release ${p}`], dir, env);
    expect(r.code).toBe(0);
  });

  it("rejects a public-release that carries main history", () => {
    // b is main's tip: pushing it (or any descendant) would publish the
    // pre-scrub history (plan 5.2).
    const r = prePush(
      [`refs/heads/public-release ${b} refs/heads/public-release ${ZERO}`],
      dir,
      env,
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("shares history with local main");
  });

  it("rejects a public-release that branches off an older main commit", () => {
    // c descends from a but not from main's tip b: main is not an ancestor
    // of it, yet pushing it would still publish a.
    const r = prePush(
      [`refs/heads/public-release ${c} refs/heads/public-release ${ZERO}`],
      dir,
      env,
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("shares history with local main");
  });

  it("rejects a non-fast-forward of public-release", () => {
    const r = prePush([`refs/heads/public-release ${p} refs/heads/public-release ${q}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("would not fast-forward");
  });

  it("rejects another local branch pushed onto public-release", () => {
    const r = prePush([`refs/heads/v2 ${a} refs/heads/public-release ${ZERO}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("only the local refs/heads/public-release branch");
  });

  it("rejects the whole push when one of several refs is refused", () => {
    const r = prePush(
      [
        `refs/heads/public-release ${p} refs/heads/public-release ${ZERO}`,
        `refs/heads/v2 ${a} refs/heads/v2 ${ZERO}`,
      ],
      dir,
      env,
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("REJECTED refs/heads/v2");
    expect(r.err).not.toContain("REJECTED refs/heads/public-release");
  });

  it("blocks a real push of v2 to a local bare repository and lets public-release through", () => {
    const bare = join(dirname(dir), "bare.git");
    execFileSync("git", ["init", "-q", "--bare", bare], { env });
    const hooks = join(dirname(dir), "hooks");
    mkdirSync(hooks);
    copyFileSync(PRE_PUSH, join(hooks, "pre-push"));
    execFileSync("chmod", ["+x", join(hooks, "pre-push")]);
    const g = (...args: string[]) =>
      spawnSync("git", ["-c", `core.hooksPath=${hooks}`, ...args], {
        cwd: dir,
        env,
        encoding: "utf-8",
      });
    expect(g("branch", "v2", a).status).toBe(0);
    expect(g("branch", "public-release", p).status).toBe(0);
    const v2 = g("push", bare, "v2");
    expect(v2.status).not.toBe(0);
    expect(v2.stderr).toContain("REJECTED refs/heads/v2");
    const pub = g("push", bare, "public-release");
    expect(pub.status).toBe(0);
  });
});

describe.skipIf(!HAS_SH || !HAS_GIT)("pre-push hook, public-release tracking a remote main", () => {
  // The owner's layout: local public-release publishes to the remote's main.
  const { dir, env, a, p, q } = HAS_SH && HAS_GIT ? scratchRepo() : ({} as never);
  if (HAS_SH && HAS_GIT) {
    execFileSync("git", ["config", "branch.public-release.merge", "refs/heads/main"], {
      cwd: dir,
      env,
    });
  }

  it("allows public-release onto the remote main as a fast-forward", () => {
    const r = prePush([`refs/heads/public-release ${q} refs/heads/main ${p}`], dir, env);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
  });

  it("rejects local main pushed to the remote main", () => {
    const r = prePush([`refs/heads/main ${a} refs/heads/main ${ZERO}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("only the local refs/heads/public-release branch");
  });

  it("rejects public-release pushed to a remote branch of its own name", () => {
    const r = prePush(
      [`refs/heads/public-release ${q} refs/heads/public-release ${ZERO}`],
      dir,
      env,
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("only refs/heads/main is pushable");
  });

  it("rejects a non-fast-forward of the remote main", () => {
    const r = prePush([`refs/heads/public-release ${p} refs/heads/main ${q}`], dir, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("would not fast-forward");
  });
});

describe.skipIf(!HAS_SH || !HAS_GIT)("pre-commit hook", () => {
  it("is a no-op that lets any staged file through (DEC-060)", () => {
    const { dir, env } = scratchRepo();
    writeFileSync(join(dir, "notes.md"), "anything\n");
    execFileSync("git", ["add", "notes.md"], { cwd: dir, env });
    const r = spawnSync("sh", [PRE_COMMIT], { cwd: dir, env, encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
});
