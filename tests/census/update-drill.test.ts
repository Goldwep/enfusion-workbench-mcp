import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { memoryIo } from "../../scripts/census/cli-common.js";
import {
  ENUMERATORS,
  TOOL_REPO,
  demotedT5,
  layoutOf,
  planSteps,
  realExec,
  run,
  type Exec,
  type Step,
} from "../../scripts/census/update-drill.js";

// Fixtures live in the OS temp folder (outside every git working tree); nothing is deleted.
const ROOT = mkdtempSync(join(tmpdir(), "update-drill-test-"));

function git(repo: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=drill", "-c", "user.email=drill@example.invalid", "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function write(file: string, text: string): void {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

/** A fixture repository: build 1.0 committed, then build 2.0 with its observations. */
function fixtureRepo(name: string): string {
  const repo = join(ROOT, name);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  const c = join(repo, "data", "census");
  write(join(c, "current-build.json"), JSON.stringify({ tag: "1.0", branch: "stable" }) + "\n");
  write(join(c, "observations", "E02", "1.0.jsonl"), '{"$header":1,"build":"1.0"}\n');
  write(join(c, "ledger.jsonl"), '{"id":"r:a","tier":"T5","tier_evidence":[{"tier":"T5","ref":"w1-10-fx state@1.0"}]}\n');
  write(join(c, "state.jsonl"), '{"id":"r:a"}\n');
  write(join(repo, "README.md"), "fixture\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "build 1.0");
  write(join(c, "current-build.json"), JSON.stringify({ tag: "2.0", branch: "stable", carry_over: [{ from: "1.0", enumerators: ["L01"] }] }) + "\n");
  write(join(c, "observations", "E02", "2.0.jsonl"), '{"$header":1,"build":"2.0"}\n');
  write(join(c, "observations", "L01", "2.0.jsonl"), '{"$header":1,"build":"2.0","enumerator":"L01"}\n');
  write(join(c, "ledger.jsonl"), '{"id":"r:a","tier":"T5","tier_evidence":[{"tier":"T5","ref":"w1-10-fx state@2.0"}]}\n');
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "build 2.0");
  write(join(c, "probes.jsonl"), "");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "later work at 2.0");
  return repo;
}

function fixtureArtifacts(name: string): string {
  const a = join(ROOT, name);
  write(join(a, "census", "1.0", "E02", "source-index.jsonl"), "{}\n");
  write(join(a, "census", "2.0", "E02", "source-index.jsonl"), "{}\n");
  write(join(a, "census", "2.0", "E06", "workbench-registry.reg"), "Windows Registry Editor Version 5.00\n");
  return a;
}

/** Fake runner: records the steps and answers with the given exit code per step id. */
function fakeExec(codes: Record<string, number> = {}): Exec & { seen: Step[]; envs: NodeJS.ProcessEnv[] } {
  const seen: Step[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const f = ((step: Step, env: NodeJS.ProcessEnv) => {
    seen.push(step);
    envs.push(env);
    const code = codes[step.id] ?? 0;
    return { code, stdout: `${step.id} ran\n${step.id.startsWith("build") && code === 1 ? "problem r:x: state names a row\n" : ""}`, stderr: "", ms: 5 };
  }) as unknown as Exec & { seen: Step[]; envs: NodeJS.ProcessEnv[] };
  f.seen = seen;
  f.envs = envs;
  return f;
}

describe("update-drill plan", () => {
  const l = layoutOf(join(ROOT, "plan-scratch"));
  const steps = planSteps(l, "1.0", "2.0", true);
  const order = steps.map((s) => s.id);

  it("runs the enumerators in an order their inputs allow, without E01", () => {
    const at = (id: string) => order.indexOf(id);
    expect(at("E01")).toBe(-1);
    for (const e of ENUMERATORS) expect(at(e.id)).toBeGreaterThanOrEqual(0);
    for (const after of ["E04", "E15", "E16", "diag-catalog"]) expect(at("E02")).toBeLessThan(at(after));
    expect(at("E05")).toBeLessThan(at("E06"));
    // E04 reads E05's observation file and E08's and E19's outputs.
    for (const before of ["E05", "E08", "E19"]) expect(at(before)).toBeLessThan(at("E04"));
    // E11 reads E02 to E05 for its covers proposals.
    for (const before of ["E02", "E03", "E04", "E05"]) expect(at(before)).toBeLessThan(at("E11"));
    expect(at("E17")).toBeLessThan(at("E15"));
    expect(at("E15")).toBeLessThan(at("E16"));
    for (const e of ENUMERATORS) expect(at(e.id)).toBeLessThan(at("build"));
    expect(at("build")).toBeLessThan(at("build-after-fold"));
    expect(at("build-after-fold")).toBeLessThan(at("diff-builds"));
    expect(at("diff-builds")).toBeLessThan(at("gen-kb"));
  });

  it("points every step at the scratch census and every writer inside the scratch folder", () => {
    for (const s of steps) {
      const i = s.args.indexOf("--data");
      expect(i, s.id).toBeGreaterThanOrEqual(0);
      expect(s.args[i + 1]).toBe(l.data);
      const out = s.args.indexOf("--out");
      if (out >= 0) expect(s.args[out + 1]!.startsWith(l.scratch), s.id).toBe(true);
    }
    // gen-kb's and report's defaults write into the repository: the drill always passes --out.
    for (const id of ["gen-kb", "gen-kb-check", "report"]) {
      expect(steps.find((s) => s.id === id)!.args).toContain("--out");
    }
    const diff = steps.find((s) => s.id === "diff-builds")!;
    expect(diff.args).toEqual(expect.arrayContaining(["--from", "1.0", "--to", "2.0", "--from-ledger", l.oldData]));
    const validate = steps.find((s) => s.id === "validate")!;
    expect(validate.args).toEqual(expect.arrayContaining(["--baseline-state", "--baseline-probes"]));
  });

  it("adds the fold-and-rebuild steps only with --fold-live", () => {
    const plain = planSteps(l, "1.0", "2.0", false).map((s) => s.id);
    expect(plain).not.toContain("build-after-fold");
    expect(plain).not.toContain("build-check");
  });

  it("--plan prints the offline steps and the Workbench-only steps and runs nothing", () => {
    const io = memoryIo();
    const exec = fakeExec();
    expect(run(["--from", "1.0", "--to", "2.0", "--scratch", l.scratch, "--plan"], io, { exec })).toBe(0);
    expect(exec.seen).toHaveLength(0);
    expect(io.stdout()).toContain("needs Workbench or a person");
    expect(io.stdout()).toContain("live-walkers");
    expect(existsSync(l.scratch)).toBe(false);
  });
});

describe("update-drill demotedT5", () => {
  const oldRows = [
    { id: "r:a", tier: "T5", tier_evidence: [{ tier: "T5", ref: "w1-10-fx state@1.0" }] },
    { id: "r:b", tier: "T5", tier_evidence: [{ tier: "T5", ref: "w3-02-other readback@1.0" }] },
    { id: "r:c", tier: "T5", tier_evidence: [{ tier: "T5", ref: "hand note@1.0" }] },
    { id: "r:d", tier: "T4" },
    { id: "r:e", tier: "T5", tier_evidence: [{ tier: "T5", ref: "w1-10-fx state@1.0" }] },
  ];

  it("lists old-side T5 rows that lost T5, grouped by wave and battery", () => {
    const newRows = [{ id: "r:a", tier: "T4" }, { id: "r:b", tier: "T2" }, { id: "r:c", tier: "T4" }, { id: "r:e", tier: "T5" }];
    const r = demotedT5(oldRows, newRows);
    expect(r.count).toBe(3);
    expect(r.byWave).toEqual({
      "(unnamed)": { "(unnamed)": ["r:c"] },
      w1: { "w1-10-fx": ["r:a"] },
      w3: { "w3-02-other": ["r:b"] },
    });
  });

  it("lists every old T5 row when no new ledger is given", () => {
    expect(demotedT5(oldRows, null).count).toBe(4);
  });
});

describe("update-drill run", () => {
  it("refuses missing flags, a scratch folder inside a git working tree and a non-empty one", () => {
    const io = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0"], io, { exec: fakeExec() })).toBe(2);
    const repo = fixtureRepo("refuse-repo");
    const io2 = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0", "--scratch", join(repo, "scratch"), "--repo", repo], io2, { exec: fakeExec() })).toBe(2);
    expect(io2.stderr()).toContain("inside a git working tree");
    const full = join(ROOT, "not-empty");
    write(join(full, "x.txt"), "x");
    const io3 = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0", "--scratch", full, "--repo", repo], io3, { exec: fakeExec() })).toBe(2);
    expect(io3.stderr()).toContain("not empty");
  });

  it("refuses a --to that the revision does not record", () => {
    const repo = fixtureRepo("wrong-to");
    const io = memoryIo();
    expect(run(["--from", "1.0", "--to", "3.0", "--scratch", join(ROOT, "wrong-to-scratch"), "--repo", repo], io, { exec: fakeExec() })).toBe(2);
    expect(io.stderr()).toContain("not 3.0");
  });

  it("prepares the scratch folder from git and passes the scratch artifacts folder to every step", () => {
    const repo = fixtureRepo("ok-repo");
    const before = git(repo, "status", "--porcelain");
    const scratch = join(ROOT, "ok-scratch");
    const exec = fakeExec({ build: 1, reconcile: 1, validate: 1 });
    const io = memoryIo();
    const code = run(
      ["--from", "1.0", "--to", "2.0", "--scratch", scratch, "--repo", repo, "--artifacts", fixtureArtifacts("ok-art"), "--fold-live"],
      io,
      { exec, env: {} },
    );
    expect(code, io.stdout() + io.stderr()).toBe(0);
    const l = layoutOf(scratch);
    // The new build's observation files are taken out, the live one is folded back after the first build.
    expect(existsSync(join(l.data, "observations", "E02", "2.0.jsonl"))).toBe(false);
    expect(existsSync(join(l.data, "observations", "E02", "1.0.jsonl"))).toBe(true);
    expect(existsSync(join(l.data, "observations", "L01", "2.0.jsonl"))).toBe(true);
    expect(JSON.parse(readFileSync(join(l.data, "current-build.json"), "utf8")).tag).toBe("2.0");
    // The old census comes from the parent of the commit that set 2.0.
    expect(readFileSync(join(l.oldData, "ledger.jsonl"), "utf8")).toContain("@1.0");
    // (checkout-index follows the host's core.autocrlf, so compare line ends normalised)
    expect(readFileSync(join(l.baseline, "state.jsonl"), "utf8").replace(/\r\n/g, "\n")).toBe('{"id":"r:a"}\n');
    // Artifacts: the old build whole, from the new build only the registry export.
    expect(existsSync(join(l.artifacts, "census", "1.0", "E02", "source-index.jsonl"))).toBe(true);
    expect(existsSync(join(l.artifacts, "census", "2.0", "E06", "workbench-registry.reg"))).toBe(true);
    expect(existsSync(join(l.artifacts, "census", "2.0", "E02"))).toBe(false);
    for (const env of exec.envs) expect(env.ENFUSION_ARTIFACTS_DIR).toBe(l.artifacts);
    // The source repository is untouched.
    expect(git(repo, "status", "--porcelain")).toBe(before);
    const report = JSON.parse(readFileSync(join(scratch, "drill-report.json"), "utf8"));
    expect(report.ok).toBe(true);
    const verdicts = Object.fromEntries(report.steps.map((s: { id: string; verdict: string }) => [s.id, s.verdict]));
    expect(verdicts.build).toBe("gate-fail");
    expect(verdicts.validate).toBe("gate-fail");
    expect(verdicts["build-after-fold"]).toBe("pass");
    expect(io.stdout()).toContain("1 problem line(s)");
    expect(existsSync(join(l.logs, "E02.log"))).toBe(true);
  });

  it("exits 1 on a step failure and skips the steps after it", () => {
    const repo = fixtureRepo("fail-repo");
    const scratch = join(ROOT, "fail-scratch");
    const exec = fakeExec({ E05: 3 });
    const io = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0", "--scratch", scratch, "--repo", repo, "--artifacts", fixtureArtifacts("fail-art")], io, { exec, env: {} })).toBe(1);
    expect(exec.seen.map((s) => s.id)).not.toContain("E06");
    const report = JSON.parse(readFileSync(join(scratch, "drill-report.json"), "utf8"));
    const e05 = report.steps.find((s: { id: string }) => s.id === "E05");
    expect(e05).toMatchObject({ verdict: "fail", exit: 3 });
    expect(report.steps.find((s: { id: string }) => s.id === "E06").verdict).toBe("skipped");
    expect(io.stdout()).toContain("1 step(s) failed: E05");
  });

  it("--strict counts a failing gate as a failure", () => {
    const repo = fixtureRepo("strict-repo");
    const io = memoryIo();
    const code = run(
      ["--from", "1.0", "--to", "2.0", "--scratch", join(ROOT, "strict-scratch"), "--repo", repo, "--artifacts", fixtureArtifacts("strict-art"), "--strict"],
      io,
      { exec: fakeExec({ reconcile: 1 }), env: {} },
    );
    expect(code).toBe(1);
    expect(io.stdout()).toContain("failed: reconcile");
  });

  it("reports a missing registry export at setup", () => {
    const repo = fixtureRepo("noreg-repo");
    const art = join(ROOT, "noreg-art");
    write(join(art, "census", "1.0", "E02", "source-index.jsonl"), "{}\n");
    const io = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0", "--scratch", join(ROOT, "noreg-scratch"), "--repo", repo, "--artifacts", art], io, { exec: fakeExec(), env: {} })).toBe(0);
    expect(io.stdout()).toContain("registry export MISSING");
  });
});

describe("update-drill realExec", () => {
  it("spawns a census script through tsx from the tool repo and returns its exit code", () => {
    const r = realExec({ id: "diff-usage", phase: 4, script: "scripts/census/diff-builds.ts", args: ["--no-such-flag"], okExits: [2] }, process.env, 60_000);
    expect(existsSync(join(TOOL_REPO, "scripts", "census", "diff-builds.ts"))).toBe(true);
    expect(r.code).toBe(2);
  }, 90_000);
});
