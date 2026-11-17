/**
 * Update drill (PLAN section 11 criterion 10, Phase 7 "update drill"): runs the offline part of
 * docs/UPDATE-PLAYBOOK.md "Census steps for a new build" end to end in a scratch folder, treating
 * `--to` as a newly landed build over `--from`. It never writes the committed ledger, the real
 * artifacts folder or any file of the source repository, and it never starts Workbench.
 *
 *   npx tsx scripts/census/update-drill.ts --from <old build> --to <new build> --scratch <dir>
 *       [--repo <source repo>] [--rev <rev>] [--from-rev <rev>] [--artifacts <artifacts dir>]
 *       [--fold-live] [--strict] [--only <id,...>] [--skip <id,...>] [--timeout <seconds>]
 *       [--plan] [--json]
 *   npx tsx scripts/census/update-drill.ts stale-t5 --old <census dir> [--new <census dir>] [--json]
 *
 * `stale-t5` (read-only) lists the T5 rows of the old ledger that are not T5 on the new one,
 * grouped by wave and battery: the batteries playbook step 5 re-runs (diff-builds' staleT5 block
 * gives the same list since 2026-11-14). Without --new it lists every old T5 row.
 *
 * --scratch   empty or missing folder OUTSIDE every git working tree; everything is written here
 * --repo       source repository (default: this checkout); read through git only
 * --rev        revision whose tree stands for "the repo when the new build landed" (default HEAD)
 * --from-rev   revision holding the old build's ledger (default: the parent of the oldest commit
 *              whose data/census/current-build.json names --to)
 * --artifacts  real artifacts folder to seed from (default: artifactsDir()); only its census/
 *              subtree is copied: every build but --to whole, and from --to only the registry
 *              export E06 reads (census/<to>/E06/workbench-registry.reg), which a maintainer takes
 *              by hand before the enumerators run
 * --fold-live  after the first build, copy the --rev tree's live-walker observation files of the
 *              new build (L*) into the scratch census and build again: stands in for playbook
 *              step 2, which needs Workbench
 * --strict     a gate that reports FAIL (reconcile, validate, citations: exit 1) fails the drill
 * --plan       print the steps and the Workbench-only steps, run nothing
 *
 * Scratch layout: <scratch>/repo (the --rev tree without the new build's observation files, its
 * current-build.json set back to the --from-rev copy), <scratch>/old/data/census (the --from-rev
 * census), <scratch>/artifacts (ENFUSION_ARTIFACTS_DIR of every child), <scratch>/baseline
 * (state.jsonl and probes.jsonl for validate's append-only check), <scratch>/logs/<step>.log and
 * <scratch>/drill-report.json.
 *
 * Exit: 0 every step passed; 1 a step exited outside its accepted codes, timed out or failed to
 * start; 2 usage (missing flag, scratch not empty or inside a git working tree, no such build
 * in git).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EXIT_FAIL, EXIT_OK, EXIT_USAGE, PROCESS_IO, isMainModule, type Io } from "./cli-common.js";
import { artifactsDir, insideGitWorkTree } from "../live/paths.js";
import { batteryOfRef } from "./diff-builds.js";
import { censusPaths, ledgerMissing, loadLedger } from "../../src/census/ledger-io.js";

/** The repository this script lives in (`<repo>/scripts/census/update-drill.ts`). */
export const TOOL_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CENSUS = "data/census";

// ── Steps ─────────────────────────────────────────────────────────────────────

export interface Step {
  /** Short id (`E02`, `build`, `validate`, ...); `--only` and `--skip` take these. */
  id: string;
  /** Playbook census step number (1 to 6). */
  phase: number;
  /** Script path relative to the tool repo (spawned with `node --import tsx`). */
  script: string;
  args: string[];
  /** Exit codes that count as a pass. */
  okExits: number[];
  /** A gate step: exit 1 is a gate verdict, not a pipeline failure (unless --strict). */
  gate?: boolean;
  /** Write stdout to this file as well as the log. */
  stdoutFile?: string;
}

/** A playbook step that needs a running Workbench: listed, never run. */
export interface LiveStep {
  id: string;
  phase: number;
  command: string;
  does: string;
}

export interface Layout {
  scratch: string;
  repo: string;
  data: string;
  oldData: string;
  artifacts: string;
  baseline: string;
  logs: string;
}

export function layoutOf(scratch: string): Layout {
  const s = resolve(scratch);
  return {
    scratch: s,
    repo: join(s, "repo"),
    data: join(s, "repo", "data", "census"),
    oldData: join(s, "old", "data", "census"),
    artifacts: join(s, "artifacts"),
    baseline: join(s, "baseline"),
    logs: join(s, "logs"),
  };
}

/**
 * Enumerators of playbook step 1, in an order their inputs allow:
 *   E02 first (its source index feeds E04, E08, E12, E15, E16 and the diag catalog);
 *   E05 before E04 (E04's net-function rows say whether E05 named them) and before E06;
 *   E08 and E19 before E04 (its Blender and docs cross-check artifacts);
 *   E02 to E05 before E11 (its covers proposals); E17 before E15 (E15's shared-id report);
 *   E15 before E16 (E16 reads E15's usage file).
 * E01 is the one-time Phase 0 recon import (it also seeds probes.jsonl) and is not re-run.
 */
export const ENUMERATORS: readonly { id: string; file: string }[] = [
  { id: "E02", file: "e02-script-source.ts" },
  { id: "E03", file: "e03-plugin-registry.ts" },
  { id: "E05", file: "e05-executable-tables.ts" },
  { id: "E06", file: "e06-settings-store.ts" },
  { id: "E07", file: "e07-wiki-tables.ts" },
  { id: "E08", file: "e08-shipped-docs.ts" },
  { id: "E19", file: "e19-blender-operators.ts" },
  { id: "E04", file: "e04-net-surface.ts" },
  { id: "E09", file: "e09-file-types.ts" },
  { id: "E10", file: "e10-data-schema.ts" },
  { id: "E11", file: "e11-mcp-inventory.ts" },
  { id: "E12", file: "e12-api-index.ts" },
  { id: "E13", file: "e13-launch-logs.ts" },
  { id: "E14", file: "e14-diag-menu.ts" },
  { id: "E17", file: "e17-workbench-data.ts" },
  { id: "E15", file: "e15-attribute-scan.ts" },
  { id: "E16", file: "e16-property-editors.ts" },
  { id: "E18", file: "e18-tool-gestures.ts" },
];

/** Every offline step, in run order. `fold-live` and `build-after-fold` only with --fold-live. */
export function planSteps(l: Layout, from: string, to: string, foldLive: boolean): Step[] {
  const d = ["--data", l.data];
  const steps: Step[] = [];
  for (const e of ENUMERATORS) {
    steps.push({
      id: e.id,
      phase: 1,
      script: `scripts/census/enumerators/${e.file}`,
      args: d,
      okExits: [0],
    });
    if (e.id === "E02") {
      steps.push({
        id: "diag-catalog",
        phase: 1,
        script: "scripts/census/gen-diag-catalog.ts",
        args: d,
        okExits: [0],
      });
    }
  }
  // build.ts exits 1 when state names rows no observation produces; on a new build before the
  // live walks are folded that is expected (rows only the new build's walks produce), so it is
  // a gate here and its problem count is reported.
  steps.push({
    id: "build",
    phase: 3,
    script: "scripts/census/build.ts",
    args: d,
    okExits: [0],
    gate: true,
  });
  if (foldLive) {
    steps.push({
      id: "build-after-fold",
      phase: 3,
      script: "scripts/census/build.ts",
      args: d,
      okExits: [0],
    });
    steps.push({
      id: "build-check",
      phase: 3,
      script: "scripts/census/build.ts",
      args: [...d, "--check"],
      okExits: [0],
    });
  }
  steps.push({
    id: "reconcile",
    phase: 3,
    script: "scripts/census/reconcile.ts",
    args: d,
    okExits: [0],
    gate: true,
  });
  steps.push({
    id: "validate",
    phase: 3,
    script: "scripts/census/validate.ts",
    args: [
      "--all",
      ...d,
      "--baseline-state",
      join(l.baseline, "state.jsonl"),
      "--baseline-probes",
      join(l.baseline, "probes.jsonl"),
    ],
    okExits: [0],
    gate: true,
  });
  steps.push({
    id: "diff-builds",
    phase: 4,
    script: "scripts/census/diff-builds.ts",
    args: ["--from", from, "--to", to, ...d, "--from-ledger", l.oldData],
    okExits: [0],
  });
  steps.push({
    id: "diff-builds-json",
    phase: 4,
    script: "scripts/census/diff-builds.ts",
    args: ["--from", from, "--to", to, ...d, "--from-ledger", l.oldData, "--json"],
    okExits: [0],
    stdoutFile: join(l.scratch, "diff-builds.json"),
  });
  const kbOut = join(l.repo, "data", "kb", "census");
  steps.push({
    id: "gen-kb",
    phase: 6,
    script: "scripts/census/gen-kb.ts",
    args: [...d, "--out", kbOut],
    okExits: [0],
  });
  steps.push({
    id: "gen-kb-check",
    phase: 6,
    script: "scripts/census/gen-kb.ts",
    args: [...d, "--out", kbOut, "--check"],
    okExits: [0],
  });
  const coverage = join(l.repo, "docs", "v2", "COVERAGE.md");
  steps.push({
    id: "report",
    phase: 6,
    script: "scripts/census/report.ts",
    args: [...d, "--out", coverage],
    okExits: [0],
  });
  steps.push({
    id: "report-summary",
    phase: 6,
    script: "scripts/census/report.ts",
    args: [...d, "--summary"],
    okExits: [0],
  });
  steps.push({
    id: "citations",
    phase: 6,
    script: "scripts/census/check-doc-citations.ts",
    args: [
      join(l.repo, "README.md"),
      join(l.repo, "docs", "UPDATE-PLAYBOOK.md"),
      join(l.repo, "docs", "WORKBENCH-OPERATIONS.md"),
      ...d,
    ],
    okExits: [0],
    gate: true,
  });
  return steps;
}

/** Playbook steps that need Workbench or a person: what a real update runs there. */
export const LIVE_STEPS: readonly LiveStep[] = [
  {
    id: "registry-export",
    phase: 1,
    command:
      'reg export "HKCU\\Software\\Bohemia Interactive\\Arma Reforger Workbench" <artifacts>/census/<new>/E06/workbench-registry.reg',
    does: "the export E06 reads; taken after Workbench of the new build has run once (no Workbench needed while exporting)",
  },
  {
    id: "live-walkers",
    phase: 2,
    command:
      "npx tsx scripts/census/live/<Lnn>.ts --really --id <lane> --sandbox <dir> --run-dir <dir> (L01 adds --module <m> --only <step>) for L01 L02 L03 L04 L05 L06 L07 L09 L10 L11 L14 L15 L17",
    does: "drives Workbench on the sandbox and writes a run folder per walker",
  },
  {
    id: "normalise",
    phase: 2,
    command:
      "npx --no tsx scripts/census/live/normalise.ts --enumerator <Lnn> [--check] <run folder>",
    does: "folds each run folder into observations/<Lnn>/<new>.jsonl",
  },
  {
    id: "locators-carry",
    phase: 4,
    command: "npx tsx scripts/census/locators-carry.ts --results <p-w8-02.jsonl> --write",
    does: "rewrites locators/<new>.jsonl from a P-W8-02 locator sweep run in Workbench",
  },
  {
    id: "stale-t5-batteries",
    phase: 5,
    command:
      "re-run every battery `update-drill.ts stale-t5 --old <old census> --new data/census` lists, then promote.ts <id> --evidence EV-... (or --batch) per passing row, dispose.ts for a failing or missing one",
    does: "earns fresh T5 evidence on the new build; the batteries drive Workbench",
  },
];

// ── Git and scratch setup ─────────────────────────────────────────────────────

export type GitRunner = (args: string[], env?: NodeJS.ProcessEnv) => string;

export function realGit(repo: string): GitRunner {
  return (args, env) => {
    const r = spawnSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (r.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed: ${(r.stderr || "").trim() || `exit ${r.status}`}`,
      );
    }
    return r.stdout;
  };
}

/** `tag` of data/census/current-build.json at `rev`, or null when the file is absent there. */
export function buildTagAt(git: GitRunner, rev: string): string | null {
  try {
    const text = git(["show", `${rev}:${CENSUS}/current-build.json`]);
    const tag = (JSON.parse(text) as { tag?: unknown }).tag;
    return typeof tag === "string" ? tag : null;
  } catch {
    return null;
  }
}

/** Parent of the oldest commit (reachable from `rev`) whose current-build.json names `to`. */
export function findFromRev(git: GitRunner, rev: string, from: string, to: string): string {
  const commits = git([
    "log",
    "--format=%H",
    "--reverse",
    rev,
    "--",
    `${CENSUS}/current-build.json`,
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  for (const c of commits) {
    if (buildTagAt(git, c) !== to) continue;
    const parent = git(["rev-parse", `${c}^`]).trim();
    const tag = buildTagAt(git, parent);
    if (tag !== from) {
      throw new Error(
        `the commit before ${to} was recorded (${parent.slice(0, 10)}) is at build ${tag}, not ${from}`,
      );
    }
    return parent;
  }
  throw new Error(`no commit reachable from ${rev} sets current-build.json to ${to}`);
}

/** Writes the tree of `rev` (or its subtree `sub`) under `dest` through a private index. */
export function exportTree(
  git: GitRunner,
  rev: string,
  dest: string,
  indexFile: string,
  sub?: string,
): void {
  mkdirSync(dest, { recursive: true });
  const env = { GIT_INDEX_FILE: indexFile };
  git(["read-tree", sub ? `${rev}:${sub}` : rev], env);
  const prefix = resolve(dest).split("\\").join("/") + "/";
  git(["checkout-index", "-a", "-f", `--prefix=${prefix}`], env);
  if (existsSync(indexFile)) unlinkSync(indexFile);
}

function dirIsEmpty(dir: string): boolean {
  return !existsSync(dir) || (statSync(dir).isDirectory() && readdirSync(dir).length === 0);
}

/** Observation files of build `build` under a census root, as [enumerator, path]. */
export function observationFiles(data: string, build: string): [string, string][] {
  const root = join(data, "observations");
  if (!existsSync(root)) return [];
  const out: [string, string][] = [];
  for (const e of readdirSync(root).sort()) {
    const f = join(root, e, `${build}.jsonl`);
    if (existsSync(f)) out.push([e, f]);
  }
  return out;
}

export interface SetupResult {
  fromRev: string;
  removed: string[];
  artifactsCopied: string[];
  registryExport: boolean;
}

/**
 * Prepares the scratch folder: the --rev tree with the new build's observation files taken out
 * and current-build.json set back to the old build, the old census, the seeded artifacts folder
 * and the append-only baselines; then sets current-build.json to the new build (the playbook's
 * first instruction, here copied from --rev instead of typed).
 */
export function prepareScratch(
  git: GitRunner,
  l: Layout,
  opts: { rev: string; fromRev: string; to: string; artifactsSrc: string | null },
): SetupResult {
  mkdirSync(l.scratch, { recursive: true });
  const idx = join(l.scratch, "drill.index");
  exportTree(git, opts.rev, l.repo, idx);
  exportTree(git, opts.fromRev, l.oldData, idx, CENSUS);
  const removed: string[] = [];
  for (const [e, f] of observationFiles(l.data, opts.to)) {
    unlinkSync(f);
    removed.push(e);
  }
  writeFileSync(
    join(l.data, "current-build.json"),
    git(["show", `${opts.fromRev}:${CENSUS}/current-build.json`]),
  );
  mkdirSync(l.baseline, { recursive: true });
  for (const f of ["state.jsonl", "probes.jsonl"]) {
    const src = join(l.data, f);
    if (existsSync(src)) copyFileSync(src, join(l.baseline, f));
    else writeFileSync(join(l.baseline, f), "");
  }
  const artifactsCopied: string[] = [];
  let registryExport = false;
  mkdirSync(join(l.artifacts, "census"), { recursive: true });
  const srcCensus = opts.artifactsSrc ? join(opts.artifactsSrc, "census") : null;
  if (srcCensus && existsSync(srcCensus)) {
    for (const b of readdirSync(srcCensus).sort()) {
      if (b === opts.to) continue;
      cpSync(join(srcCensus, b), join(l.artifacts, "census", b), { recursive: true });
      artifactsCopied.push(b);
    }
    const reg = join(srcCensus, opts.to, "E06", "workbench-registry.reg");
    if (existsSync(reg)) {
      mkdirSync(join(l.artifacts, "census", opts.to, "E06"), { recursive: true });
      copyFileSync(reg, join(l.artifacts, "census", opts.to, "E06", "workbench-registry.reg"));
      registryExport = true;
    }
  }
  // Playbook: "set that file to the new build first".
  writeFileSync(
    join(l.data, "current-build.json"),
    git(["show", `${opts.rev}:${CENSUS}/current-build.json`]),
  );
  mkdirSync(l.logs, { recursive: true });
  return { fromRev: opts.fromRev, removed, artifactsCopied, registryExport };
}

/** Stand-in for playbook step 2: the --rev tree's live observation files of the new build. */
export function foldLive(git: GitRunner, l: Layout, rev: string, to: string): string[] {
  const listed = git(["ls-tree", "-r", "--name-only", rev, "--", `${CENSUS}/observations`])
    .split(/\r?\n/)
    .filter((p) => /\/observations\/L[0-9]+\//.test(p) && p.endsWith(`/${to}.jsonl`));
  const done: string[] = [];
  for (const p of listed) {
    const dest = join(l.repo, ...p.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, git(["show", `${rev}:${p}`]));
    done.push(p.split("/").slice(-2, -1)[0]!);
  }
  return done;
}

// ── Stale T5 from the old side ────────────────────────────────────────────────

export interface DemotedT5 {
  count: number;
  byWave: Record<string, Record<string, string[]>>;
}

type RowLike = { id?: unknown; tier?: unknown; tier_evidence?: unknown };

/**
 * T5 rows of the old ledger that are not T5 in the new one, grouped by wave and battery.
 * build.ts stamps every T5 with the current build and earns it only from a live result on that
 * build (src/census/tier.ts), so a ledger rebuilt on a new build holds no carried T5 row: the
 * batteries to re-run are the old side's T5 rows. diff-builds' `staleT5` counts the same rows
 * since 2026-11-14 (it used to look only at the new side and read 0 after a rebuild).
 */
export function demotedT5(
  oldRows: readonly RowLike[],
  newRows: readonly RowLike[] | null,
): DemotedT5 {
  const newTier = new Map<string, unknown>();
  for (const r of newRows ?? []) if (typeof r.id === "string") newTier.set(r.id, r.tier);
  const byWave = new Map<string, Map<string, string[]>>();
  let count = 0;
  for (const r of oldRows) {
    if (r.tier !== "T5" || typeof r.id !== "string") continue;
    if (newRows && newTier.get(r.id) === "T5") continue;
    count++;
    const refs = (Array.isArray(r.tier_evidence) ? r.tier_evidence : [])
      .filter(
        (e): e is { tier: string; ref: string } =>
          !!e &&
          typeof e === "object" &&
          (e as { tier?: unknown }).tier === "T5" &&
          typeof (e as { ref?: unknown }).ref === "string",
      )
      .map((e) => e.ref);
    const named = refs.map(batteryOfRef).filter((x): x is NonNullable<typeof x> => x !== null);
    const targets = named.length > 0 ? named : [{ wave: "(unnamed)", battery: "(unnamed)" }];
    for (const { wave, battery } of targets) {
      const w = byWave.get(wave) ?? new Map<string, string[]>();
      const list = w.get(battery) ?? [];
      if (!list.includes(r.id)) list.push(r.id);
      w.set(battery, list);
      byWave.set(wave, w);
    }
  }
  const out: Record<string, Record<string, string[]>> = {};
  for (const wave of [...byWave.keys()].sort()) {
    out[wave] = {};
    const w = byWave.get(wave)!;
    for (const b of [...w.keys()].sort()) out[wave][b] = [...w.get(b)!].sort();
  }
  return { count, byWave: out };
}

function loadRows(censusDir: string): RowLike[] {
  return loadLedger(censusPaths(resolve(censusDir))).rows as unknown as RowLike[];
}

/** `stale-t5 --old <census dir> [--new <census dir>] [--json]`: read-only. */
export function runStaleT5(argv: string[], io: Io): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { old: { type: "string" }, new: { type: "string" }, json: { type: "boolean" } },
      strict: true,
    }));
  } catch (e) {
    io.err(`update-drill stale-t5: ${(e as Error).message}`);
    return EXIT_USAGE;
  }
  if (!values.old) {
    io.err("update-drill stale-t5: --old <census dir> is required");
    return EXIT_USAGE;
  }
  for (const dir of [values.old, values.new].filter((x): x is string => !!x)) {
    if (ledgerMissing(censusPaths(resolve(dir)))) {
      io.err(`update-drill stale-t5: no ledger in ${dir}`);
      return EXIT_USAGE;
    }
  }
  const r = demotedT5(loadRows(values.old), values.new ? loadRows(values.new) : null);
  if (values.json) io.out(JSON.stringify(r, null, 2));
  else {
    const batteries = Object.values(r.byWave).reduce((n, w) => n + Object.keys(w).length, 0);
    io.out(
      `T5 rows on the old ledger${values.new ? " not T5 on the new one" : ""}: ${r.count} in ${batteries} batteries`,
    );
    for (const [wave, w] of Object.entries(r.byWave)) {
      io.out(`  ${wave}: ${Object.keys(w).length} batteries`);
      for (const [b, rows] of Object.entries(w)) io.out(`    ${b}: ${rows.length}`);
    }
  }
  return EXIT_OK;
}

// ── Running ───────────────────────────────────────────────────────────────────

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  error?: string;
}

export type Exec = (step: Step, env: NodeJS.ProcessEnv, timeoutMs: number) => ExecResult;

/** Spawns `node --import tsx <script> ...args` from the tool repo. */
export const realExec: Exec = (step, env, timeoutMs) => {
  const t0 = Date.now();
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", join(TOOL_REPO, step.script), ...step.args],
    {
      cwd: TOOL_REPO,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  return {
    code: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    ms: Date.now() - t0,
    error: r.error ? r.error.message : undefined,
  };
};

export interface StepResult {
  id: string;
  phase: number;
  command: string;
  exit: number | null;
  ok: boolean;
  verdict: "pass" | "gate-fail" | "fail" | "skipped";
  seconds: number;
  tail: string[];
  note?: string;
}

export function commandLine(step: Step): string {
  const q = (a: string) => (/[\s"]/.test(a) ? JSON.stringify(a) : a);
  return ["npx", "tsx", step.script, ...step.args].map(q).join(" ");
}

function tailLines(text: string, n: number): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((x) => x.trim() !== "")
    .slice(-n);
}

/** Runs the steps in order; stops after the first failure. */
export function runSteps(
  steps: Step[],
  exec: Exec,
  env: NodeJS.ProcessEnv,
  opts: {
    timeoutMs: number;
    strict: boolean;
    logs: string | null;
    between?: (after: Step) => string | null;
  },
): StepResult[] {
  const results: StepResult[] = [];
  let failed = false;
  for (const step of steps) {
    if (failed) {
      results.push({
        id: step.id,
        phase: step.phase,
        command: commandLine(step),
        exit: null,
        ok: false,
        verdict: "skipped",
        seconds: 0,
        tail: [],
      });
      continue;
    }
    const r = exec(step, env, opts.timeoutMs);
    const all = r.stdout + (r.stderr ? (r.stdout ? "\n" : "") + r.stderr : "");
    if (opts.logs) writeFileSync(join(opts.logs, `${step.id}.log`), all);
    if (step.stdoutFile) writeFileSync(step.stdoutFile, r.stdout);
    let verdict: StepResult["verdict"];
    if (r.code !== null && step.okExits.includes(r.code)) verdict = "pass";
    else if (step.gate && r.code === 1 && !opts.strict) verdict = "gate-fail";
    else verdict = "fail";
    const res: StepResult = {
      id: step.id,
      phase: step.phase,
      command: commandLine(step),
      exit: r.code,
      ok: verdict !== "fail",
      verdict,
      seconds: Math.round(r.ms / 100) / 10,
      tail: tailLines(all, 4),
    };
    if (r.error) res.note = r.error;
    if (step.id.startsWith("build")) {
      const n = (all.match(/^problem /gm) ?? []).length;
      if (n > 0) res.note = `${n} problem line(s)`;
    }
    results.push(res);
    if (!res.ok) failed = true;
    else if (opts.between) {
      const note = opts.between(step);
      if (note)
        results.push({
          id: `after-${step.id}`,
          phase: step.phase,
          command: "(in-process)",
          exit: 0,
          ok: true,
          verdict: "pass",
          seconds: 0,
          tail: [note],
        });
    }
  }
  return results;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

export interface Deps {
  git?: GitRunner;
  exec?: Exec;
  artifactsDefault?: () => string;
  env?: NodeJS.ProcessEnv;
}

const ids = (s: string | undefined) =>
  new Set(
    (s ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

export function run(argv: string[], io: Io = PROCESS_IO, deps: Deps = {}): number {
  if (argv[0] === "stale-t5") return runStaleT5(argv.slice(1), io);
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        from: { type: "string" },
        to: { type: "string" },
        scratch: { type: "string" },
        repo: { type: "string" },
        rev: { type: "string" },
        "from-rev": { type: "string" },
        artifacts: { type: "string" },
        "fold-live": { type: "boolean" },
        strict: { type: "boolean" },
        only: { type: "string" },
        skip: { type: "string" },
        timeout: { type: "string" },
        plan: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (e) {
    io.err(`update-drill: ${(e as Error).message}`);
    return EXIT_USAGE;
  }
  if (values.help) {
    io.out(
      "usage: update-drill.ts --from <old build> --to <new build> --scratch <dir> [--repo <dir>] [--rev <rev>] [--from-rev <rev>] [--artifacts <dir>] [--fold-live] [--strict] [--only ids] [--skip ids] [--timeout s] [--plan] [--json]",
    );
    return EXIT_OK;
  }
  const { from, to, scratch } = values;
  if (!from || !to || !scratch) {
    io.err("update-drill: --from, --to and --scratch are required");
    return EXIT_USAGE;
  }
  const l = layoutOf(scratch);
  const foldLiveOn = values["fold-live"] === true;
  const only = ids(values.only);
  const skip = ids(values.skip);
  const steps = planSteps(l, from, to, foldLiveOn).filter(
    (s) => (only.size === 0 || only.has(s.id)) && !skip.has(s.id),
  );

  if (values.plan) {
    if (values.json) io.out(JSON.stringify({ steps, live: LIVE_STEPS }, null, 2));
    else {
      for (const s of steps) io.out(`[${s.phase}] ${s.id}: ${commandLine(s)}`);
      io.out("needs Workbench or a person (not run):");
      for (const s of LIVE_STEPS) io.out(`[${s.phase}] ${s.id}: ${s.command}`);
    }
    return EXIT_OK;
  }

  if (insideGitWorkTree(l.scratch)) {
    io.err(
      `update-drill: --scratch ${l.scratch} lies inside a git working tree; use a folder outside every checkout`,
    );
    return EXIT_USAGE;
  }
  if (!dirIsEmpty(l.scratch)) {
    io.err(`update-drill: --scratch ${l.scratch} is not empty; give a new folder`);
    return EXIT_USAGE;
  }
  const timeoutSec = values.timeout ? Number(values.timeout) : 1200;
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    io.err("update-drill: --timeout takes a positive number of seconds");
    return EXIT_USAGE;
  }
  const repo = resolve(values.repo ?? TOOL_REPO);
  const git = deps.git ?? realGit(repo);
  const rev = values.rev ?? "HEAD";

  let setup: SetupResult;
  const t0 = Date.now();
  try {
    if (buildTagAt(git, rev) !== to) {
      io.err(`update-drill: current-build.json at ${rev} is not ${to}`);
      return EXIT_USAGE;
    }
    const fromRev = values["from-rev"] ?? findFromRev(git, rev, from, to);
    if (buildTagAt(git, fromRev) !== from) {
      io.err(`update-drill: current-build.json at ${fromRev} is not ${from}`);
      return EXIT_USAGE;
    }
    let artifactsSrc: string | null = values.artifacts ? resolve(values.artifacts) : null;
    if (!artifactsSrc) {
      try {
        artifactsSrc = (deps.artifactsDefault ?? (() => artifactsDir()))();
      } catch {
        artifactsSrc = null;
      }
    }
    setup = prepareScratch(git, l, { rev, fromRev, to, artifactsSrc });
  } catch (e) {
    io.err(`update-drill: setup failed: ${(e as Error).message}`);
    return EXIT_USAGE;
  }
  const setupSeconds = Math.round((Date.now() - t0) / 100) / 10;

  const env: NodeJS.ProcessEnv = {
    ...(deps.env ?? process.env),
    ENFUSION_ARTIFACTS_DIR: l.artifacts,
  };
  const between = foldLiveOn
    ? (after: Step) =>
        after.id === "build"
          ? `fold-live: copied ${foldLive(git, l, rev, to).join(", ") || "nothing"}`
          : null
    : undefined;
  const results = runSteps(steps, deps.exec ?? realExec, env, {
    timeoutMs: timeoutSec * 1000,
    strict: values.strict === true,
    logs: l.logs,
    between,
  });
  const failed = results.filter((r) => r.verdict === "fail");
  // Playbook step 5's battery list, from the old side (see demotedT5).
  let staleT5: DemotedT5 | { error: string } | null = null;
  if (
    failed.length === 0 &&
    results.some((r) => r.id.startsWith("build") && r.verdict !== "skipped")
  ) {
    try {
      staleT5 = demotedT5(loadRows(l.oldData), loadRows(l.data));
    } catch (e) {
      staleT5 = { error: (e as Error).message };
    }
  }
  const report = {
    from,
    to,
    rev,
    fromRev: setup.fromRev,
    scratch: l.scratch,
    setup: { ...setup, seconds: setupSeconds },
    steps: results,
    staleT5,
    live: LIVE_STEPS,
    ok: failed.length === 0,
  };
  writeFileSync(join(l.scratch, "drill-report.json"), JSON.stringify(report, null, 2) + "\n");
  if (values.json) io.out(JSON.stringify(report, null, 2));
  else {
    io.out(
      `update drill ${from} -> ${to} in ${l.scratch} (from-rev ${setup.fromRev.slice(0, 10)})`,
    );
    io.out(
      `setup ${setupSeconds}s: took out ${setup.removed.length} new-build observation file(s); artifacts seeded from ${setup.artifactsCopied.join(", ") || "nothing"}; registry export ${setup.registryExport ? "present" : "MISSING (E06 will report NO DATA)"}`,
    );
    for (const r of results) {
      io.out(
        `[${r.phase}] ${r.id.padEnd(18)} ${r.verdict.padEnd(9)} exit=${r.exit ?? "-"} ${r.seconds}s${r.note ? `  (${r.note})` : ""}`,
      );
    }
    if (staleT5 && "count" in staleT5) {
      const n = Object.values(staleT5.byWave).reduce((k, w) => k + Object.keys(w).length, 0);
      io.out(
        `[5] stale T5 (old-side T5 rows not T5 on the new build): ${staleT5.count} rows in ${n} batteries`,
      );
    } else if (staleT5) io.out(`[5] stale T5: not computed (${staleT5.error})`);
    io.out("needs Workbench or a person (not run):");
    for (const s of LIVE_STEPS) io.out(`[${s.phase}] ${s.id}: ${s.command}`);
    io.out(
      failed.length === 0
        ? "drill: every offline step passed"
        : `drill: ${failed.length} step(s) failed: ${failed.map((r) => r.id).join(", ")}`,
    );
  }
  return failed.length === 0 ? EXIT_OK : EXIT_FAIL;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
