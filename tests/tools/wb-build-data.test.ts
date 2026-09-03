import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import type { RunOptions, RunResult } from "../../src/workbench/cli-runner.js";

// Mock only the spawn side; finishRun / tailLines stay real.
vi.mock("../../src/workbench/cli-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/workbench/cli-runner.js")>();
  return { ...actual, runWorkbench: vi.fn() };
});
vi.mock("../../src/workbench/wb-deps.js", () => ({
  checkWorkbenchVisibleDeps: () => ({
    gprojPath: "",
    wbAddonsDir: "",
    workshopDir: null,
    findings: [],
    allWbVisible: true,
    scannedRoots: [],
  }),
}));

import { runWorkbench } from "../../src/workbench/cli-runner.js";
import {
  BUILD_PLATFORMS,
  DEFAULT_BUILD_TIMEOUT_S,
  buildBuildDataArgs,
  buildDataArtefactCheck,
  countOutputFiles,
  registerWbBuildData,
} from "../../src/tools/wb-build-data.js";

const mockedRun = vi.mocked(runWorkbench);

function baseResult(over: Partial<RunResult> = {}): RunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "building...\ndone\n",
    stderr: "",
    durationMs: 3210,
    timedOut: false,
    earlySignal: null,
    ...over,
  };
}

const root = mkdtempSync(join(tmpdir(), "wb-build-data-test-"));
const gproj = join(root, "addon.gproj");
writeFileSync(gproj, "GameProject {}\n");
mkdirSync(join(root, "logs"), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const config = {
  workbenchPath: root,
  projectPath: root,
  gamePath: root,
  dataDir: root,
  patternsDir: root,
  workbenchHost: "127.0.0.1",
  workbenchPort: 5775,
  projectIndexPath: join(root, "idx.db"),
  corePath: root,
  logsPath: join(root, "logs"),
} as unknown as Config;

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

function captureTool(): { schema: z.ZodObject<z.ZodRawShape>; call: Handler } {
  let captured: { def: { inputSchema: z.ZodRawShape }; handler: Handler } | null = null;
  const server = {
    registerTool: (_name: string, def: { inputSchema: z.ZodRawShape }, handler: Handler) => {
      captured = { def, handler };
    },
  } as unknown as McpServer;
  registerWbBuildData(server, config);
  if (!captured) throw new Error("tool not registered");
  const { def, handler } = captured as { def: { inputSchema: z.ZodRawShape }; handler: Handler };
  const schema = z.object(def.inputSchema);
  return { schema, call: (args) => handler(schema.parse(args)) };
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("wb_build_data: argv (H9)", () => {
  it("leads with -wbModule=ResourceManager per BIKI and keeps paths as separate entries", () => {
    const out = "C:\\Data\\PC Data";
    const gp = "C:\\Users\\<you>\\Documents\\My Games\\addon.gproj";
    const args = buildBuildDataArgs("PC", out, gp);
    expect(args[0]).toBe("-wbModule=ResourceManager");
    expect(args.slice(1, 4)).toEqual(["-buildData", "PC", out]);
    const i = args.indexOf("-wbProjectPath");
    expect(args[i + 1]).toBe(gp);
    expect(args.some((a) => a.startsWith("-wbProjectPath="))).toBe(false);
    expect(args).toContain("-noPause");
  });

  it("the handler passes that argv as an array to runWorkbench (no shell)", async () => {
    const outDir = join(root, "out-argv");
    mockedRun.mockImplementation(async (opts: RunOptions) => {
      writeFileSync(join(outDir, "resourceDatabase.rdb"), "x");
      return baseResult();
    });
    const { call } = captureTool();
    const res = await call({ gproj_path: gproj, out_dir: outDir });
    expect(res.isError).toBeUndefined();
    const opts = mockedRun.mock.calls[0][0];
    expect(Array.isArray(opts.args)).toBe(true);
    expect(opts.args[0]).toBe("-wbModule=ResourceManager");
    expect(opts.args).toContain(gproj);
    expect(opts.args).toContain(outDir);
    expect((opts as unknown as Record<string, unknown>).shell).toBeUndefined();
    expect(opts.timeoutMs).toBe(DEFAULT_BUILD_TIMEOUT_S * 1000);
  });

  it("default timeout fits an MCP client window (H11)", () => {
    expect(DEFAULT_BUILD_TIMEOUT_S).toBeLessThanOrEqual(110);
    const { schema } = captureTool();
    expect(schema.parse({}).timeout_seconds).toBe(DEFAULT_BUILD_TIMEOUT_S);
    expect(BUILD_PLATFORMS).toContain("PC");
  });
});

describe("wb_build_data: artefact check (H10)", () => {
  it("countOutputFiles distinguishes fresh from stale files", () => {
    const d = join(root, "count");
    mkdirSync(join(d, "sub"), { recursive: true });
    writeFileSync(join(d, "sub", "a.pak"), "a");
    const before = countOutputFiles(d, Date.now() + 60_000);
    expect(before.total).toBe(1);
    expect(before.fresh).toBe(0);
    const now = countOutputFiles(d, Date.now() - 60_000);
    expect(now.fresh).toBe(1);
    expect(countOutputFiles(join(root, "missing"), 0)).toEqual({ total: 0, fresh: 0 });
  });

  it("buildDataArtefactCheck fails on an empty out_dir", () => {
    const d = join(root, "empty");
    mkdirSync(d, { recursive: true });
    const c = buildDataArtefactCheck(d, Date.now() - 1000);
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("0 files written");
  });

  it("exit 0 with an empty out_dir is isError with the tail", async () => {
    const outDir = join(root, "out-empty");
    mockedRun.mockResolvedValue(baseResult({ stdout: "GUI booted\nnothing built\n" }));
    const { call } = captureTool();
    const res = await call({ gproj_path: gproj, out_dir: outDir });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("exit 0 but no output produced");
    expect(res.content[0].text).toContain("nothing built");
  });

  it("exit 0 with a file written during the run is success", async () => {
    const outDir = join(root, "out-ok");
    mockedRun.mockImplementation(async () => {
      writeFileSync(join(outDir, "resourceDatabase.rdb"), "x");
      return baseResult();
    });
    const { call } = captureTool();
    const res = await call({ gproj_path: gproj, out_dir: outDir });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("✅ Build complete");
    expect(res.content[0].text).toContain("1 written this run");
  });

  it("non-zero exit is isError even if stale files exist", async () => {
    const outDir = join(root, "out-nonzero");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "old.pak"), "x");
    mockedRun.mockResolvedValue(baseResult({ exitCode: 2, stderr: "fatal: pak writer\n" }));
    const { call } = captureTool();
    const res = await call({ gproj_path: gproj, out_dir: outDir });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("exit code 2");
    expect(res.content[0].text).toContain("fatal: pak writer");
  });

  it("timeout is isError and points at timeout_seconds / action:start", async () => {
    const outDir = join(root, "out-timeout");
    mockedRun.mockResolvedValue(
      baseResult({ exitCode: null, signal: "SIGKILL", timedOut: true, durationMs: 100_000 }),
    );
    const { call } = captureTool();
    const res = await call({ gproj_path: gproj, out_dir: outDir });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("TIMEOUT");
    expect(res.content[0].text).toContain("process tree killed");
    expect(res.content[0].text).toContain('action:"start"');
  });
});

describe("wb_build_data: start / poll (H11 async)", () => {
  it("start returns a job id immediately; poll reports running then the final report", async () => {
    const outDir = join(root, "out-job");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockedRun.mockImplementation(async () => {
      await gate;
      writeFileSync(join(outDir, "resourceDatabase.rdb"), "x");
      return baseResult();
    });
    const { call } = captureTool();
    const started = await call({ action: "start", gproj_path: gproj, out_dir: outDir });
    expect(started.isError).toBeUndefined();
    const id = /job_id: ([0-9a-f]{16})/.exec(started.content[0].text)?.[1];
    expect(id).toBeDefined();

    // Let the JobStore's setImmediate fire and the workFn reach the gate.
    await new Promise((r) => setTimeout(r, 20));
    const mid = await call({ action: "poll", job_id: id });
    expect(mid.isError).toBeUndefined();
    expect(mid.content[0].text).toMatch(/Status: (queued|running)/);

    release();
    let done = mid;
    for (let i = 0; i < 100 && !/Status: done/.test(done.content[0].text); i++) {
      await new Promise((r) => setTimeout(r, 10));
      done = await call({ action: "poll", job_id: id });
    }
    expect(done.content[0].text).toContain("Status: done");
    expect(done.isError).toBeUndefined();
    expect(done.content[0].text).toContain("✅ Build complete");
  });

  it("a build that fails inside the job surfaces isError on poll", async () => {
    const outDir = join(root, "out-job-fail");
    mockedRun.mockResolvedValue(baseResult({ exitCode: 1 }));
    const { call } = captureTool();
    const started = await call({ action: "start", gproj_path: gproj, out_dir: outDir });
    const id = /job_id: ([0-9a-f]{16})/.exec(started.content[0].text)![1];
    let res = await call({ action: "poll", job_id: id });
    for (let i = 0; i < 100 && !/Status: done/.test(res.content[0].text); i++) {
      await new Promise((r) => setTimeout(r, 10));
      res = await call({ action: "poll", job_id: id });
    }
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("exit code 1");
  });

  it("poll without job_id, unknown job_id, and start without paths are errors", async () => {
    const { call } = captureTool();
    expect((await call({ action: "poll" })).isError).toBe(true);
    const unknown = await call({ action: "poll", job_id: "deadbeefdeadbeef" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain("Unknown job_id");
    expect((await call({ action: "start", gproj_path: gproj })).isError).toBe(true);
    expect((await call({})).isError).toBe(true);
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("wb_build_data: input guards", () => {
  it("rejects flag-shaped or quoted paths before spawning", async () => {
    const { call } = captureTool();
    expect((await call({ gproj_path: "-wbModule=x", out_dir: root })).isError).toBe(true);
    expect((await call({ gproj_path: gproj, out_dir: 'a"b' })).isError).toBe(true);
    expect((await call({ gproj_path: join(root, "nope.gproj"), out_dir: root })).isError).toBe(true);
    expect(mockedRun).not.toHaveBeenCalled();
  });
});
