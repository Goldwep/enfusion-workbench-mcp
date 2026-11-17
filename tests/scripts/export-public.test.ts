import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TRANSFORMS,
  applyTransforms,
  filterEntries,
  globToRegExp,
  loadExportAllow,
  parseExportArgs,
  redactE05Ledger,
  runExport,
  transformsFor,
  withheldQuote,
  withheldRef,
  type ExportOptions,
  type TreeEntry,
} from "../../scripts/export-public.js";
import { rowSchema } from "../../src/census/schemas.js";

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
  base: Pick<ExportOptions, "repo" | "allowPath" | "print">;
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
  // Windows checkouts run with core.fileMode=false, so the index would record
  // 100644 whatever chmod did; set the mode in the index explicitly.
  g("update-index", "--chmod=+x", ".githooks/pre-push");
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
      join(dirname(fileURLToPath(import.meta.url)), "../../scripts/export-allow.json"),
    );
    expect(allow.exclude).toEqual([...ALLOW.exclude, "docs/v2/**"]);
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
    expect(included.map((e) => e.path)).not.toContain("docs/v2/PLAN.md");
  });
});

// Executable-derived strings are assembled at run time, so this file scans clean when exported.
const EXE_REF = "exe" + ":0x2b9e200";
const EXE_REF_2 = "exe" + ":0x2c28e30";
const RTTI = "." + "?AV" + "QPlantedWindow@@";

function ledgerRow(id: string, sources: Record<string, unknown>[], extra = {}): string {
  return JSON.stringify({
    id,
    shard: "core",
    dim: "cli",
    kind: "cli-switch",
    module: "none",
    parent: null,
    label: id.slice(4),
    risk_confirmed: false,
    origin: "vanilla",
    aggregate: false,
    provisional: false,
    sources,
    build: { first_seen: "1.8.0.13", last_seen: "1.9.0.37" },
    children_enumerated: "n/a",
    observed_states: [],
    status: "active",
    paths: [{ path: "cli", status: "candidate" }],
    tier: "T2",
    target_tier: "T5",
    target_tier_source: "policy",
    tier_evidence: [
      { ref: "E05@1.8.0.13", tier: "T0" },
      { ref: EXE_REF, tier: "T1" },
      { ref: "E05@1.9.0.37", tier: "T2" },
    ],
    weak_only: false,
    mcp: [],
    mcp_proposed: [],
    tests: [],
    unverified: [{ claim: `named in the executable: yes (E05 ${EXE_REF_2})` }],
    ...extra,
  });
}

const E07 = {
  build: "1.8.0.13",
  confidence: "high",
  enumerator: "E07",
  quote: "-planted documented text",
  ref: "wiki:Startup_Parameters#planted",
};

const LEDGER =
  [
    ledgerRow("cli:-planted", [
      {
        build: "1.8.0.13",
        confidence: "high",
        enumerator: "E05",
        quote: `"%1" -planted "%2" ${RTTI}`,
        ref: EXE_REF,
      },
      {
        build: "1.9.0.37",
        confidence: "high",
        enumerator: "E05",
        quote: `"%1" -planted "%2" ${RTTI}`,
        ref: EXE_REF_2,
      },
      E07,
    ]),
    ledgerRow("cli:-other", [E07], { tier_evidence: [], unverified: [] }),
  ].join("\n") + "\n";

describe("redact-e05 export transform", () => {
  it("withholds E05 quotes and exe refs and keeps ids, tiers and other sources", () => {
    const r = redactE05Ledger(LEDGER);
    expect(r.changed).toBe(1);
    const [before, after] = [LEDGER, r.text].map((t) =>
      t
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    );
    const row = after[0];
    expect(row.id).toBe(before[0].id);
    expect(row.label).toBe(before[0].label);
    expect(row.tier).toBe("T2");
    expect(row.tier_evidence.map((e: { tier: string }) => e.tier)).toEqual(["T0", "T1", "T2"]);
    const e05 = row.sources.filter((s: { enumerator: string }) => s.enumerator === "E05");
    expect(e05).toHaveLength(2);
    for (const s of e05) {
      expect(s.quote).toMatch(/^withheld \(D2\): 39 chars, sha256 [0-9a-f]{16}$/);
      expect(s.ref).toMatch(/^exe:withheld-[0-9a-f]{16}$/);
    }
    expect(e05[0].quote).toBe(withheldQuote(before[0].sources[0].quote));
    expect(e05[0].ref).toBe(withheldRef(EXE_REF));
    expect(row.tier_evidence[1].ref).toBe(e05[0].ref);
    expect(row.unverified[0].claim).toBe(
      `named in the executable: yes (E05 ${withheldRef(EXE_REF_2)})`,
    );
    expect(row.sources[2]).toEqual(E07);
    expect(r.text).not.toContain(RTTI);
    expect(r.text).not.toMatch(/exe:0x/);
    for (const o of after) expect(rowSchema.safeParse(o).success).toBe(true);
    // A line without E05 sources keeps its exact bytes.
    expect(r.text.split("\n")[1]).toBe(LEDGER.split("\n")[1]);
  });

  it("is deterministic and idempotent, and keeps CRLF line endings", () => {
    const crlf = LEDGER.replace(/\n/g, "\r\n");
    const a = redactE05Ledger(crlf);
    const b = redactE05Ledger(crlf);
    expect(a).toEqual(b);
    expect(a.text.split("\r\n")).toHaveLength(3);
    expect(redactE05Ledger(a.text)).toEqual({ text: a.text, changed: 0 });
    expect(redactE05Ledger("")).toEqual({ text: "", changed: 0 });
  });

  it("fails closed on a line it must inspect that is not JSON", () => {
    expect(() => redactE05Ledger('{"enumerator":"E05", broken\n')).toThrow(/line 1 is not JSON/);
  });

  it("applies only to the configured paths and returns the same bytes elsewhere", () => {
    const allow = { ...ALLOW, transforms: DEFAULT_TRANSFORMS as Record<string, string[]> };
    const body = Buffer.from(LEDGER, "utf-8");
    expect(transformsFor("data/census/ledger.jsonl", allow)).toEqual(["redact-e05"]);
    expect(transformsFor("data/census/ledger.diag.jsonl", allow)).toEqual(["redact-e05"]);
    expect(transformsFor("data/census/state.jsonl", allow)).toEqual([]);
    expect(applyTransforms("docs/x.jsonl", body, allow).body).toBe(body);
    const t = applyTransforms("data/census/ledger.jsonl", body, allow);
    expect(t.records).toEqual([
      { path: "data/census/ledger.jsonl", transform: "redact-e05", changed: 1 },
    ]);
    const clean = Buffer.from(LEDGER.split("\n")[1] + "\n", "utf-8");
    expect(applyTransforms("data/census/ledger.jsonl", clean, allow).body).toBe(clean);
  });

  it("loads the default transforms, refuses an unknown one, and ships redact-e05", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-export-allow-"));
    const plain = join(dir, "plain.json");
    writeFileSync(plain, JSON.stringify({ include: ["**"] }));
    expect(loadExportAllow(plain).transforms).toEqual(DEFAULT_TRANSFORMS);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ include: ["**"], transforms: { "no-such": ["**"] } }));
    expect(() => loadExportAllow(bad)).toThrow(/unknown transform "no-such"/);
    const shipped = loadExportAllow(
      join(dirname(fileURLToPath(import.meta.url)), "../../scripts/export-allow.json"),
    );
    expect(shipped.transforms).toEqual({ "redact-e05": ["data/census/ledger*.jsonl"] });
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

// Every case builds a scratch repository and runs a dozen or more git
// processes; on Windows that alone takes 2-5 s, past the 5 s default.
describe.skipIf(!HAS_GIT)("runExport", { timeout: 30_000 }, () => {
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

  it("exports a file holding a home path: there is no PII scan (DEC-060)", () => {
    const s = scratchRepo();
    writeFileSync(
      join(s.repo, "src/leak.ts"),
      `export const p = ${JSON.stringify(PLANTED_PATH)};\n`,
    );
    s.g("add", "-A");
    s.g("commit", "-q", "-m", "leak");
    s.g("tag", "gate-path");
    const r = runExport({ ...s.base, tag: "gate-path", writeFlag: true });
    expect(r.code).toBe(0);
    expect(lsTree(s.g, "public-release")).toContain("src/leak.ts");
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

  it("exports the ledger with E05 quotes withheld and leaves the source blob alone", () => {
    const s = scratchRepo();
    mkdirSync(join(s.repo, "data/census"), { recursive: true });
    writeFileSync(join(s.repo, "data/census/ledger.jsonl"), LEDGER);
    s.g("add", "-A");
    s.g("commit", "-q", "-m", "ledger");
    s.g("tag", "gate-ledger");
    const sourceBlob = s.g("rev-parse", "gate-ledger:data/census/ledger.jsonl");

    const dry = runExport({ ...s.base, tag: "gate-ledger", dryRun: true });
    expect(dry.code).toBe(0);
    expect(dry.transformed).toEqual([
      { path: "data/census/ledger.jsonl", transform: "redact-e05", changed: 1 },
    ]);
    expect(s.lines.join("\n")).toContain("~ data/census/ledger.jsonl  [redact-e05: 1 changed]");

    const r = runExport({ ...s.base, tag: "gate-ledger", writeFlag: true });
    expect(r.code).toBe(0);
    const exported = s.g("show", "public-release:data/census/ledger.jsonl");
    expect(exported).not.toContain(EXE_REF);
    expect(exported).not.toContain(RTTI);
    expect(exported).toContain(withheldRef(EXE_REF));
    expect(exported.split("\n")[1]).toBe(LEDGER.split("\n")[1]);
    expect(s.g("rev-parse", "gate-ledger:data/census/ledger.jsonl")).toBe(sourceBlob);
    expect(s.g("cat-file", "-p", sourceBlob)).toContain(EXE_REF);
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
