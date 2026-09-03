import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import type { RunResult } from "../../src/workbench/cli-runner.js";

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
  DEFAULT_CLI_TIMEOUT_S,
  planFor,
  registerWbCliRun,
  resolveTargetFor,
  validateResourceTarget,
} from "../../src/tools/wb-cli-run.js";

const mockedRun = vi.mocked(runWorkbench);

function baseResult(over: Partial<RunResult> = {}): RunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 2500,
    timedOut: false,
    earlySignal: null,
    ...over,
  };
}

const root = mkdtempSync(join(tmpdir(), "wb-cli-run-test-"));
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
  registerWbCliRun(server, config);
  if (!captured) throw new Error("tool not registered");
  const { def, handler } = captured as { def: { inputSchema: z.ZodRawShape }; handler: Handler };
  const schema = z.object(def.inputSchema);
  return { schema, call: (args) => handler(schema.parse(args)) };
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("wb_cli_run: target validation (L3)", () => {
  it("rejects flag-shaped, NUL, quoted, empty and dot-dot targets", () => {
    expect(validateResourceTarget("-wbModule=x")).toMatch(/'-'/);
    expect(validateResourceTarget("a\0b")).toMatch(/NULL/);
    expect(validateResourceTarget('a"b')).toMatch(/double quotes/);
    expect(validateResourceTarget("")).toMatch(/empty/);
    expect(validateResourceTarget("../secret/world.ent")).toMatch(/\.\./);
    expect(validateResourceTarget("worlds\\..\\x.ent")).toMatch(/\.\./);
  });

  it("accepts engine-relative resource paths and absolute paths", () => {
    expect(validateResourceTarget("worlds/MyWorld/MyWorld.ent")).toBeNull();
    expect(validateResourceTarget("Prefabs/Structures/Villa.et")).toBeNull();
    expect(validateResourceTarget("C:\\Data\\My Games\\world.ent")).toBeNull();
    expect(validateResourceTarget("worlds/x..y.ent")).toBeNull(); // '..' inside a name is fine
  });

  it("resolveTargetFor leaves engine-relative resource targets verbatim, resolves project targets", () => {
    expect(resolveTargetFor("navmeshGenerate", "worlds/MyWorld.ent")).toBe("worlds/MyWorld.ent");
    expect(resolveTargetFor("forceSaveAll", "Prefabs/Villa.et")).toBe("Prefabs/Villa.et");
    expect(resolveTargetFor("openProject", "addon.gproj")).toBe(resolve("addon.gproj"));
    expect(resolveTargetFor("buildScripts", "addon.gproj")).toBe(resolve("addon.gproj"));
    const abs = resolve(root, "w.ent");
    expect(resolveTargetFor("navmeshGenerate", abs)).toBe(abs);
  });

  it("planFor returns a bare argv array with the target as its own entry", () => {
    const args = planFor("navmeshGenerate", "worlds/MyWorld.ent", "PC");
    expect(args).toEqual([
      "-wbModule=NavmeshGeneratorMain",
      "-run",
      "-autogenerate",
      "worlds/MyWorld.ent",
      "-noPause",
    ]);
    expect(planFor("buildScripts", gproj, "HEADLESS")).toContain("-config=HEADLESS");
    expect(planFor("openProject", gproj, "PC").some((a) => a.startsWith("-wbProjectPath="))).toBe(false);
  });
});

describe("wb_cli_run: handler", () => {
  it("navmeshGenerate accepts an engine-relative path that does not exist on disk", async () => {
    mockedRun.mockResolvedValue(baseResult());
    const { call } = captureTool();
    const res = await call({ command: "navmeshGenerate", target: "worlds/MyWorld/MyWorld.ent" });
    expect(res.isError).toBeUndefined();
    const opts = mockedRun.mock.calls[0][0];
    expect(opts.args).toContain("worlds/MyWorld/MyWorld.ent");
    expect(opts.args[0]).toBe("-wbModule=NavmeshGeneratorMain");
  });

  it("forceSaveAll with an absolute path still requires it on disk", async () => {
    const { call } = captureTool();
    const res = await call({ command: "forceSaveAll", target: join(root, "missing.ent") });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not found on disk");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("openProject still requires the .gproj on disk", async () => {
    const { call } = captureTool();
    const res = await call({ command: "openProject", target: join(root, "nope.gproj") });
    expect(res.isError).toBe(true);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects '..' and flag-shaped targets before spawning", async () => {
    const { call } = captureTool();
    expect((await call({ command: "navmeshGenerate", target: "../x.ent" })).isError).toBe(true);
    expect((await call({ command: "openProject", target: "-wbModule=x" })).isError).toBe(true);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("buildScripts verdict 'failed' is isError (H10)", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ earlySignal: "failed", exitCode: null, signal: "SIGKILL" }),
    );
    const { call } = captureTool();
    const res = await call({ command: "buildScripts", target: gproj });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Script validation failed");
  });

  it("buildScripts verdict 'successful' is not an error despite the kill", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ earlySignal: "successful", exitCode: null, signal: "SIGKILL" }),
    );
    const { call } = captureTool();
    const res = await call({ command: "buildScripts", target: gproj });
    expect(res.isError).toBeUndefined();
  });

  it("timeout is isError and says the tree was killed (H11)", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ timedOut: true, exitCode: null, signal: "SIGKILL", durationMs: 100_000 }),
    );
    const { call } = captureTool();
    const res = await call({ command: "openProject", target: gproj });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("TIMEOUT (process tree killed)");
  });

  it("non-zero exit is isError with the stderr tail", async () => {
    mockedRun.mockResolvedValue(baseResult({ exitCode: 5, stderr: "navmesh: OOM\n" }));
    const { call } = captureTool();
    const res = await call({ command: "navmeshGenerate", target: "worlds/w.ent" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("exit code 5");
    expect(res.content[0].text).toContain("navmesh: OOM");
  });

  it("default timeout fits an MCP client window and is overridable", async () => {
    expect(DEFAULT_CLI_TIMEOUT_S).toBeLessThanOrEqual(110);
    mockedRun.mockResolvedValue(baseResult());
    const { schema, call } = captureTool();
    expect(schema.parse({ command: "openProject", target: "x" }).timeout_seconds).toBe(DEFAULT_CLI_TIMEOUT_S);
    await call({ command: "navmeshGenerate", target: "worlds/w.ent", timeout_seconds: 900 });
    expect(mockedRun.mock.calls[0][0].timeoutMs).toBe(900_000);
  });
});
