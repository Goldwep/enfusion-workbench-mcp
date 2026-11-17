/**
 * `server_launch` takes the scenario from the server.json (KD-005 fixed): the
 * argv carries `-config <path>` and the extras only, a requested scenario must
 * equal `game.scenarioId`, and a file without one is refused. `spawn` and the
 * exe probe are mocked; no process starts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

const FAKE_EXE = "C:\\fake\\Arma Reforger Server\\ArmaReforgerServer.exe";
vi.mock("../../src/server-mgmt/launch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server-mgmt/launch.js")>();
  return { ...actual, probeServerExe: () => ({ path: FAKE_EXE, exists: true }) };
});

import { registerServerLaunch } from "../../src/tools/server-launch.js";

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
  pid = 4242;
  unref = vi.fn();
}

const TEST_DIR = resolve(import.meta.dirname, "../../tmp-test-server-launch-scenario");
const SCENARIO = "{ABCD1234DEAD5678}Missions/M.conf";

function writeServerJson(scenarioId: string | undefined): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const p = join(TEST_DIR, "server.json");
  const game: Record<string, unknown> = {
    name: "test",
    password: "",
    maxPlayers: 8,
    visible: true,
    gameProperties: {},
    mods: [],
  };
  if (scenarioId !== undefined) game.scenarioId = scenarioId;
  writeFileSync(
    p,
    JSON.stringify({
      bindAddress: "0.0.0.0",
      bindPort: 2001,
      a2s: { address: "0.0.0.0", port: 17777 },
      game,
      operating: {},
    }),
  );
  return p;
}

beforeEach(() => spawnMock.mockReset());
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("server_launch — the scenario rides in server.json (KD-005 fixed)", () => {
  it("spawns with -config and the extras only, and records the file's scenario", async () => {
    const configPath = writeServerJson(SCENARIO);
    spawnMock.mockImplementation(() => {
      const child = new FakeChild();
      setImmediate(() => child.emit("spawn"));
      return child;
    });
    const out = await captureTool()({
      server_config_path: configPath,
      extra_args: ["-maxFPS=60"],
      dry_run: false,
      force: true,
    });
    expect(out.isError).toBeUndefined();
    const [, argv] = spawnMock.mock.calls[0] as [string, string[]];
    expect(argv).toEqual(["-config", resolve(configPath), "-maxFPS=60"]);
    expect(argv.some((a) => /^-scenario/i.test(a))).toBe(false);
  });

  it("dry run names the file's scenario and an argv without a scenario switch", async () => {
    const configPath = writeServerJson(SCENARIO);
    const out = await captureTool()({
      server_config_path: configPath,
      dry_run: true,
      force: false,
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(out.isError).toBeUndefined();
    expect(out.content[0].text).toContain(`game.scenarioId):** \`${SCENARIO}\``);
    expect(out.content[0].text).not.toMatch(/-scenarioId/i);
  });

  it("refuses a requested scenario that differs from the file's", async () => {
    const configPath = writeServerJson(SCENARIO);
    const out = await captureTool()({
      server_config_path: configPath,
      scenario_id: "{1111222233334444}Missions/X.conf",
      dry_run: true,
      force: false,
    });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/differs from the server\.json's game\.scenarioId/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("refuses a server.json with no game.scenarioId", async () => {
    const configPath = writeServerJson(undefined);
    const out = await captureTool()({
      server_config_path: configPath,
      dry_run: false,
      force: true,
    });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/no game\.scenarioId/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
