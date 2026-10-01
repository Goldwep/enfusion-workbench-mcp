/**
 * Fixture helpers for the census tests: a temporary repository with a
 * `data/census` root seeded from the committed configuration files, writers
 * for observation files, evidence records and live results, and in-process
 * or spawned runners for the census scripts. No mocks (CONVENTIONS 7).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { censusPaths, type CensusPaths } from "../../src/census/ledger-io.js";
import { memoryIo, type Io } from "../../scripts/census/cli-common.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REAL_CENSUS = join(REPO_ROOT, "data", "census");

export interface Fixture {
  /** Temporary repository root. */
  repo: string;
  /** `<repo>/data/census`. */
  root: string;
  paths: CensusPaths;
}

/** A temporary repository whose census root holds the committed configuration and empty logs. */
export function makeCensus(build = "1.0.0.1"): Fixture {
  const repo = mkdtempSync(join(tmpdir(), "census-"));
  const root = join(repo, "data", "census");
  mkdirSync(join(root, "observations"), { recursive: true });
  mkdirSync(join(root, "evidence"), { recursive: true });
  mkdirSync(join(root, "live-results"), { recursive: true });
  for (const f of [
    "policy.json",
    "universes.json",
    "state-matrix.json",
    "g4-rules.json",
    "aliases.json",
    "known-defects.json",
  ]) {
    copyFileSync(join(REAL_CENSUS, f), join(root, f));
  }
  writeFileSync(
    join(root, "current-build.json"),
    JSON.stringify(
      { tag: build, branch: "stable", ui_language: "en", recorded_by: "test" },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(root, "state.jsonl"), "");
  writeFileSync(join(root, "probes.jsonl"), "");
  return { repo, root, paths: censusPaths(root) };
}

const GENERATORS: Record<string, string> = Object.fromEntries(
  Object.entries(
    (
      JSON.parse(readFileSync(join(REAL_CENSUS, "universes.json"), "utf-8")) as {
        enumerators: Record<string, { generator: string }>;
      }
    ).enumerators,
  ).map(([k, v]) => [k, v.generator]),
);

/** Writes `observations/<enumerator>/<build>.jsonl` with a correct header (overridable). */
export function writeObservations(
  fx: Fixture,
  enumerator: string,
  build: string,
  lines: readonly unknown[],
  header: Record<string, unknown> = {},
): string {
  const dir = join(fx.root, "observations", enumerator);
  mkdirSync(dir, { recursive: true });
  const h = {
    $header: 1,
    enumerator,
    build,
    generator: GENERATORS[enumerator],
    provisional: enumerator === "E01",
    row_count: lines.length,
    ...header,
  };
  const file = join(dir, `${build}.jsonl`);
  writeFileSync(
    file,
    [h, ...lines].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n",
  );
  return file;
}

/** Writes an evidence record `evidence/<id>.json` in the harness writer's shape. */
export function writeEvidence(fx: Fixture, id: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(fx.root, "evidence", `${id}.json`),
    JSON.stringify(
      { id, ran: "test", build: "1.0.0.1", result_summary: "test", artifacts: [], ...extra },
      null,
      2,
    ) + "\n",
  );
}

/** Writes `live-results/<build>.jsonl`. */
export function writeLiveResults(fx: Fixture, build: string, lines: readonly unknown[]): void {
  writeFileSync(
    join(fx.root, "live-results", `${build}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

/** Writes a repo file (a test file carrying a `census:<id>` marker, a cited source, ...). */
export function writeRepoFile(fx: Fixture, rel: string, text: string): void {
  const file = join(fx.repo, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a script's exported `run(argv, io)` in-process with `--data` pointed at the fixture. */
export function runIn(
  fx: Fixture,
  run: (argv: string[], io: Io) => number,
  argv: readonly string[],
): RunResult {
  const io = memoryIo();
  const code = run([...argv, "--data", fx.root], io);
  return { code, stdout: io.stdout(), stderr: io.stderr() };
}

/** Spawns a census script through tsx, as a user would run it. */
export function spawnScript(
  script: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): RunResult {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", join(REPO_ROOT, script), ...argv],
      {
        cwd: REPO_ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      code: err.status ?? -1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

// ── Observation builders ──────────────────────────────────────────────────────

export function apiClass(
  cls: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    dim: "api",
    kind: "class",
    module: "Shared",
    key: { class: cls },
    parent_key: null,
    class_name: cls,
    what: `The ${cls} class`,
    risk_hint: "safe",
    origin: "vanilla",
    ref: `pak:scripts/${cls}.c#L1`,
    confidence: "high",
    paths_proposed: [{ path: "net-api-handler" }],
    ...extra,
  };
}

export function apiMethod(
  cls: string,
  method: string,
  arity: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    dim: "api",
    kind: "method",
    module: "Shared",
    key: { class: cls, method, arity },
    parent_key: { dim: "api", kind: "class", module: "Shared", key: { class: cls } },
    signature: `${method}(${Array.from({ length: arity }, (_, i) => `int a${i}`).join(", ")})`,
    what: `${cls}.${method}`,
    risk_hint: "safe",
    origin: "vanilla",
    ref: `pak:scripts/${cls}.c#L10`,
    confidence: "high",
    paths_proposed: [{ path: "net-api-handler" }],
    ...extra,
  };
}

export function mcpTool(
  tool: string,
  actions: readonly string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return [
    {
      dim: "mcp",
      kind: "mcp-tool",
      module: "none",
      key: { tool },
      parent_key: null,
      what: `MCP tool ${tool}`,
      risk_hint: "safe",
      origin: "vanilla",
      ref: `<repo>/src/tools/${tool}.ts#L1`,
      quote: "registerTool",
      confidence: "high",
      children_count: actions.length,
      paths_proposed: [{ path: "net-api-handler" }],
      ...extra,
    },
    ...actions.map((action) => ({
      dim: "mcp",
      kind: "mcp-action",
      module: "none",
      key: { tool, action },
      parent_key: { dim: "mcp", kind: "mcp-tool", module: "none", key: { tool } },
      what: `${tool} ${action}`,
      risk_hint: "safe",
      origin: "vanilla",
      ref: `<repo>/src/tools/${tool}.ts#L2`,
      quote: action,
      confidence: "high",
      paths_proposed: [{ path: "net-api-handler" }],
    })),
  ];
}

export function uiItem(
  module: string,
  kind: string,
  path: readonly string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    dim: "ui",
    kind,
    module,
    key: { path: [...path] },
    label: path[path.length - 1],
    origin: "vanilla",
    ref: "wiki:Workbench_Menu#File",
    confidence: "medium",
    ...extra,
  };
}

/**
 * Planted machine paths, assembled at run time so no committed file carries
 * one (plan 5.2: fixtures with a planted path are generated at test time).
 */
export function plantedWindowsPath(...rest: string[]): string {
  return ["C:", "Users", "someone", ...rest].join("\\");
}

export function plantedPosixPath(...rest: string[]): string {
  return "/" + ["home", "someone", ...rest].join("/");
}
