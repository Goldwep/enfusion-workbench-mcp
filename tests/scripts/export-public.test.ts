import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  filterEntries,
  globToRegExp,
  loadExportAllow,
  parseExportArgs,
  runExport,
  type ExportOptions,
  type TreeEntry,
} from "../../scripts/export-public.js";

const HAS_GIT = spawnSync("git", ["--version"]).status === 0;

// Isolate every git call made by this file (including the ones inside runExport)
// from user and system configuration, and give commits a neutral identity.
const ISOLATION = mkdtempSync(join(tmpdir(), "emcp-export-cfg-"));
writeFileSync(join(ISOLATION, "empty.gitconfig"), "");
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: join(ISOLATION, "empty.gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Export Test",
  GIT_AUTHOR_EMAIL: "export-test@example.invalid",
  GIT_COMMITTER_NAME: "Export Test",
  GIT_COMMITTER_EMAIL: "export-test@example.invalid",
});

const PLANTED_PATH = ["C:", "Users", "zq" + "plantedowner", "Documents"].join("\\");

const FILES: Record<string, string> = {
  "README.md": "# scratch\n",
  "src/a.ts": "export const a = 1;\n",
  ".githooks/pre-push": "#!/bin/sh\nexit 0\n",
  "docs/v2/PLAN.md": "plan\n",
  "docs/v2/STATE.md": "state\n",
  "docs/v2/LIVE-LOG.md": "log\n",
  "docs/v2/sessions/s1.md": "session\n",
  "docs/v2/inbox/note.md": "inbox\n",
  "data/census/evidence/e1.json": "{}\n",
  "data/census/observations/E05-gui/o.json": "{}\n",
  "data/census/observations/E01-recon/o.json": "{}\n",
  "data/labels/menu-labels.json": "{}\n",
};

const ALLOW = {
  include: ["**"],
  exclude: [
    "docs/v2/STATE.md",
    "docs/v2/LIVE-LOG.md",
    "docs/v2/sessions/**",
    "docs/v2/inbox/**",
    "data/census/evidence/**",
    "data/census/observations/E05*/**",
  ],
  tags: { "executable-derived": ["data/labels/**"] },
  excludeTags: ["executable-derived"],
};

const EXCLUDED = [
  "docs/v2/STATE.md",
  "docs/v2/LIVE-LOG.md",
  "docs/v2/sessions/s1.md",
  "docs/v2/inbox/note.md",
  "data/census/evidence/e1.json",
  "data/census/observations/E05-gui/o.json",
  "data/labels/menu-labels.json",
];

const INCLUDED = [
  "README.md",
  "src/a.ts",
  ".githooks/pre-push",
  "docs/v2/PLAN.md",
  "data/census/observations/E01-recon/o.json",
];

interface Scratch {
  repo: string;
  dir: string;
  g: (...args: string[]) => string;
  base: Pick<ExportOptions, "repo" | "allowPath" | "piiAllowPath" | "env" | "print">;
  lines: string[];
}

function scratchRepo(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "emcp-export-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const g = (...args: string[]): string =>
    execFileSync("git", args, { cwd: repo, encoding: "utf-8" }).trim();
  g("init", "-q", "-b", "main");
  for (const [p, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), text);
  }
  chmodSync(join(repo, ".githooks/pre-push"), 0o755);
  g("add", "-A");
  g("commit", "-q", "-m", "first");
  g("tag", "gate-1");
  const allowPath = join(dir, "export-allow.json");
  writeFileSync(allowPath, JSON.stringify(ALLOW));
  const lines: string[] = [];
  return {
    repo,
    dir,
    g,
    lines,
    base: {
      repo,
      allowPath,
      piiAllowPath: join(dir, "no-pii-allow.json"),
      env: { CI: "1", ENFUSION_PII_PATTERNS: join(dir, "missing-patterns.txt") },
      print: (l) => lines.push(l),
    },
  };
}

function lsTree(g: Scratch["g"], rev: string): string[] {
  return g("ls-tree", "-r", "--name-only", rev).split("\n").filter(Boolean);
}

describe("globToRegExp", () => {
  it("lets ** span directories and keeps * within one segment", () => {
    expect(globToRegExp("docs/v2/sessions/**").test("docs/v2/sessions/a/b.md")).toBe(true);
    expect(
      globToRegExp("data/census/observations/E05*/**").test(
        "data/census/observations/E05-x/o.json",
      ),
    ).toBe(true);
    expect(
      globToRegExp("data/census/observations/E05*/**").test("data/census/observations/E01/o.json"),
    ).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("**/*.md").test("README.md")).toBe(true);
    expect(globToRegExp("**").test(".githooks/pre-push")).toBe(true);
  });
});

describe("filterEntries", () => {
  it("applies include, then exclude, then excluded tags", () => {
    const entries: TreeEntry[] = Object.keys(FILES).map((path) => ({
      mode: "100644",
      type: "blob",
      oid: "0".repeat(40),
      path,
    }));
    entries.push({ mode: "160000", type: "commit", oid: "0".repeat(40), path: "vendor/sub" });
    const { included, excluded } = filterEntries(entries, ALLOW);
    expect(included.map((e) => e.path).sort()).toEqual([...INCLUDED].sort());
    expect(excluded.find((x) => x.path === "data/labels/menu-labels.json")?.reason).toBe(
      "tagged executable-derived",
    );
    expect(excluded.find((x) => x.path === "vendor/sub")?.reason).toBe("not a file (commit)");
  });

  it("ships a default allow-list with the plan's exclusions and .githooks included", () => {
    const allow = loadExportAllow(
      join(dirname(new URL(import.meta.url).pathname), "../../scripts/export-allow.json"),
    );
    expect(allow.exclude).toEqual(ALLOW.exclude);
    expect(allow.excludeTags).toEqual(["executable-derived"]);
    const entries: TreeEntry[] = Object.keys(FILES).map((path) => ({
      mode: "100644",
      type: "blob",
      oid: "0".repeat(40),
      path,
    }));
    const { included } = filterEntries(entries, allow);
    expect(included.map((e) => e.path)).toContain(".githooks/pre-push");
    expect(included.map((e) => e.path)).not.toContain("docs/v2/STATE.md");
  });
});

describe("parseExportArgs", () => {
  it("requires --repo and --tag", () => {
    expect(() => parseExportArgs(["--tag", "t"])).toThrow("--repo");
    expect(() => parseExportArgs(["--repo", "r"])).toThrow("--tag");
  });

  it("reads the write flag and dry run", () => {
    const o = parseExportArgs([
      "--repo",
      "r",
      "--tag",
      "t",
      "--dry-run",
      "--i-know-this-writes-the-public-branch",
    ]);
    expect(o.dryRun).toBe(true);
    expect(o.writeFlag).toBe(true);
  });
});

describe.skipIf(!HAS_GIT)("runExport", () => {
  it("dry-runs without creating the target branch", () => {
    const s = scratchRepo();
    const r = runExport({ ...s.base, tag: "gate-1", dryRun: true });
    expect(r.code).toBe(0);
    expect(r.included.sort()).toEqual([...INCLUDED].sort());
    expect(r.excluded.map((x) => x.path).sort()).toEqual([...EXCLUDED].sort());
    expect(s.lines.join("\n")).toContain("Would-be diff stat:");
    expect(s.lines.join("\n")).toContain("5 files changed");
    expect(s.g("branch", "--list", "public-release")).toBe("");
  });

  it("refuses a real export without the write flag and names a github.com origin", () => {
    const s = scratchRepo();
    s.g("remote", "add", "origin", "https://github.com/example/scratch.git");
    const r = runExport({ ...s.base, tag: "gate-1" });
    expect(r.code).toBe(2);
    expect(r.message).toContain("github.com");
    expect(r.message).toContain("--i-know-this-writes-the-public-branch");
    expect(s.g("branch", "--list", "public-release")).toBe("");
  });

  it("writes exactly one additive commit per export, never touching the checked-out branch", () => {
    const s = scratchRepo();
    const head = s.g("rev-parse", "HEAD");
    const r = runExport({ ...s.base, tag: "gate-1", writeFlag: true });
    expect(r.code).toBe(0);
    expect(s.g("rev-list", "--count", "public-release")).toBe("1");
    expect(s.g("log", "-1", "--format=%s%n%b", "public-release")).toBe(
      "Export gate-1 to public-release",
    );
    const tree = lsTree(s.g, "public-release");
    for (const p of INCLUDED) expect(tree).toContain(p);
    for (const p of EXCLUDED) expect(tree).not.toContain(p);
    expect(s.g("ls-tree", "public-release", ".githooks/pre-push")).toMatch(/^100755 /);
    expect(s.g("rev-parse", "HEAD")).toBe(head);
    expect(s.g("worktree", "list").split("\n")).toHaveLength(1);

    // A second gate tag extends the branch with one more commit on top of the first.
    const first = s.g("rev-parse", "public-release");
    writeFileSync(join(s.repo, "src/b.ts"), "export const b = 2;\n");
    s.g("add", "-A");
    s.g("commit", "-q", "-m", "second");
    s.g("tag", "gate-2");
    const r2 = runExport({ ...s.base, tag: "gate-2", writeFlag: true });
    expect(r2.code).toBe(0);
    expect(s.g("rev-list", "--count", "public-release")).toBe("2");
    expect(s.g("rev-parse", "public-release^")).toBe(first);
    expect(lsTree(s.g, "public-release")).toContain("src/b.ts");

    // Re-exporting the same tree writes nothing.
    const r3 = runExport({ ...s.base, tag: "gate-2", writeFlag: true });
    expect(r3.code).toBe(0);
    expect(r3.commit).toBeUndefined();
    expect(s.g("rev-list", "--count", "public-release")).toBe("2");
  });

  it("aborts on a planted PII path and leaves the target untouched", () => {
    const s = scratchRepo();
    expect(runExport({ ...s.base, tag: "gate-1", writeFlag: true }).code).toBe(0);
    const before = s.g("rev-parse", "public-release");
    writeFileSync(
      join(s.repo, "src/leak.ts"),
      `export const p = ${JSON.stringify(PLANTED_PATH)};\n`,
    );
    s.g("add", "-A");
    s.g("commit", "-q", "-m", "leak");
    s.g("tag", "gate-bad");
    const r = runExport({ ...s.base, tag: "gate-bad", writeFlag: true });
    expect(r.code).toBe(1);
    expect(r.findings.map((f) => f.path)).toEqual(["src/leak.ts"]);
    expect(s.lines.join("\n")).toContain("src/leak.ts:1: windows-home-path: C***");
    expect(s.lines.join("\n")).not.toContain("plantedowner");
    expect(s.g("rev-parse", "public-release")).toBe(before);
  });

  it("does not scan excluded files", () => {
    const s = scratchRepo();
    writeFileSync(join(s.repo, "docs/v2/STATE.md"), `${PLANTED_PATH}\n`);
    s.g("add", "-A");
    s.g("commit", "-q", "-m", "state");
    s.g("tag", "gate-state");
    expect(runExport({ ...s.base, tag: "gate-state", dryRun: true }).code).toBe(0);
  });

  it("is a configuration error when the owner pattern file is missing without CI", () => {
    const s = scratchRepo();
    const r = runExport({
      ...s.base,
      env: { ENFUSION_PII_PATTERNS: join(s.dir, "missing.txt") },
      tag: "gate-1",
      dryRun: true,
    });
    expect(r.code).toBe(2);
    expect(r.message).toContain("owner pattern file not found");
  });

  it("refuses while the target branch is checked out", () => {
    const s = scratchRepo();
    expect(runExport({ ...s.base, tag: "gate-1", writeFlag: true }).code).toBe(0);
    s.g("checkout", "-q", "public-release");
    const r = runExport({ ...s.base, tag: "gate-1", writeFlag: true });
    expect(r.code).toBe(2);
    expect(r.message).toContain("checked out");
  });

  it("refuses an unknown tag", () => {
    const s = scratchRepo();
    const r = runExport({ ...s.base, tag: "no-such-tag", dryRun: true });
    expect(r.code).toBe(2);
    expect(r.message).toContain("tag not found");
  });

  it("creates the branch from origin/public-release when only the remote-tracking ref exists", () => {
    const s = scratchRepo();
    expect(runExport({ ...s.base, tag: "gate-1", writeFlag: true }).code).toBe(0);
    const tip = s.g("rev-parse", "public-release");
    s.g("update-ref", "refs/remotes/origin/public-release", tip);
    s.g("branch", "-D", "public-release");
    writeFileSync(join(s.repo, "src/c.ts"), "export const c = 3;\n");
    s.g("add", "-A");
    s.g("commit", "-q", "-m", "third");
    s.g("tag", "gate-3");
    const r = runExport({ ...s.base, tag: "gate-3", writeFlag: true });
    expect(r.code).toBe(0);
    expect(s.g("rev-parse", "public-release^")).toBe(tip);
  });

  it("refuses when local public-release does not contain origin/public-release", () => {
    const s = scratchRepo();
    expect(runExport({ ...s.base, tag: "gate-1", writeFlag: true }).code).toBe(0);
    const tree = s.g("rev-parse", "public-release^{tree}");
    const other = execFileSync("git", ["commit-tree", tree, "-m", "elsewhere"], {
      cwd: s.repo,
      encoding: "utf-8",
    }).trim();
    s.g("update-ref", "refs/remotes/origin/public-release", other);
    const r = runExport({ ...s.base, tag: "gate-1", writeFlag: true });
    expect(r.code).toBe(2);
    expect(r.message).toContain("does not contain origin/public-release");
  });
});
