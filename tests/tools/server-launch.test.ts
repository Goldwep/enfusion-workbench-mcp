/**
 * `server_launch` tool wrapper — spawn error handling (H14) and stdio
 * isolation (M21). `node:child_process.spawn` is mocked; no real process is
 * ever started. `probeServerExe` is mocked so the "exe exists" branch runs
 * without a real ArmaReforgerServer.exe on the box.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";

// ---- mocks (hoisted by vitest) --------------------------------------------

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

const FAKE_EXE = "C:\\fake\\Arma Reforger Server\\ArmaReforgerServer.exe";
vi.mock("../../src/server-mgmt/launch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server-mgmt/launch.js")>();
  return {
    ...actual,
    probeServerExe: () => ({ path: FAKE_EXE, exists: true }),
  };
});

import { registerServerLaunch } from "../../src/tools/server-launch.js";
import { PID_FILE_NAME } from "../../src/server-mgmt/launch.js";

// ---- helpers ----------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function captureTool(): ToolHandler {
  let handler: ToolHandler | null = null;
  const fake = {
    registerTool: (_name: string, _def: unknown, h: ToolHandler) => {
      handler = h;
    },
  } as unknown as McpServer;
  registerServerLaunch(fake, {} as Config);
  if (!handler) throw new Error("server_launch did not register");
  return handler;
}

class FakeChild extends EventEmitter {
  pid: number | undefined;
  unref = vi.fn();
  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }
}

const TEST_DIR = resolve(import.meta.dirname, "../../tmp-test-server-launch");
const SCENARIO = "{ABCD1234DEAD5678}Missions/M.conf";

function writeServerJson(): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const p = join(TEST_DIR, "server.json");
  writeFileSync(
    p,
    JSON.stringify({
      bindAddress: "0.0.0.0",
      bindPort: 2001,
      a2s: { address: "0.0.0.0", port: 17777 },
      game: {
        name: "test",
        password: "",
        scenarioId: SCENARIO,
        maxPlayers: 8,
        visible: true,
        gameProperties: {},
        mods: [],
      },
      operating: {},
    }),
  );
  return p;
}

beforeEach(() => {
  spawnMock.mockReset();
});
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

// ---- tests ------------------------------------------------------------------

describe("server_launch — spawn wiring", () => {
  it("spawns with all three stdio streams ignored (never inherits the MCP's stdout)", async () => {
    const configPath = writeServerJson();
    const child = new FakeChild(31337);
    spawnMock.mockImplementation(() => {
      setImmediate(() => child.emit("spawn"));
      return child;
    });
    const tool = captureTool();
    const out = await tool({
      server_config_path: configPath,
      scenario_id: SCENARIO,
      dry_run: false,
      force: false,
    });
    expect(out.isError).toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [exe, argv, opts] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(exe).toBe(FAKE_EXE);
    expect(argv.slice(0, 4)).toEqual(["-config", resolve(configPath), "-scenarioId", SCENARIO]);
    expect(opts.stdio).toEqual(["ignore", "ignore", "ignore"]);
    expect(opts.shell).toBe(false);
    expect(opts.detached).toBe(true);
    expect(out.content[0].text).toMatch(/\*\*PID:\*\* 31337/);
    expect(existsSync(join(TEST_DIR, PID_FILE_NAME))).toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it("keeps an 'error' listener attached after a successful spawn (late errors never go unhandled)", async () => {
    const configPath = writeServerJson();
    const child = new FakeChild(1);
    spawnMock.mockImplementation(() => {
      setImmediate(() => child.emit("spawn"));
      return child;
    });
    const tool = captureTool();
    await tool({ server_config_path: configPath, scenario_id: SCENARIO, dry_run: false, force: false });
    expect(child.listenerCount("error")).toBeGreaterThan(0);
    expect(() => child.emit("error", Object.assign(new Error("late"), { code: "EPERM" }))).not.toThrow();
  });

  it("reports isError with the errno code on a spawn 'error' and leaves no PID file", async () => {
    const configPath = writeServerJson();
    const child = new FakeChild(undefined);
    spawnMock.mockImplementation(() => {
      setImmediate(() =>
        child.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" })),
      );
      return child;
    });
    const tool = captureTool();
    const out = await tool({
      server_config_path: configPath,
      scenario_id: SCENARIO,
      dry_run: false,
      force: false,
    });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/spawn failed/);
    expect(out.content[0].text).toMatch(/EACCES/);
    expect(existsSync(join(TEST_DIR, PID_FILE_NAME))).toBe(false);
    // The tool never claims a running server.
    expect(out.content[0].text).not.toMatch(/Server is running/);
  });

  it("does not spawn on dry_run (default)", async () => {
    const configPath = writeServerJson();
    const tool = captureTool();
    const out = await tool({ server_config_path: configPath, scenario_id: SCENARIO, dry_run: true, force: false });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(out.content[0].text).toMatch(/dry run/);
  });
});
