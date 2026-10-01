/**
 * wb_launch under the plan 5.1 guards: no project means a refusal (never a
 * guessed addon), an explicit project works while the no-autolaunch marker
 * exists, and the Workbench lease is honoured.
 *
 * workbenchPath is a directory that does not exist and the port is closed,
 * so every launch that gets past the guards fails at "Cannot find ...exe"
 * without spawning anything.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import { WorkbenchClient } from "../../src/workbench/client.js";
import { readLease } from "../../src/workbench/lease.js";
import { registerWbLaunch } from "../../src/tools/wb-launch.js";
import { textOf, type ToolHandler } from "./_tool-harness.js";

/** registerWbLaunch registers two tools; capture the one named `name`. */
function captureNamed(register: (server: McpServer) => void, name: string): ToolHandler {
  const handlers = new Map<string, ToolHandler>();
  const fake = {
    registerTool: (toolName: string, _def: unknown, h: ToolHandler) => {
      handlers.set(toolName, h);
    },
  } as unknown as McpServer;
  register(fake);
  const handler = handlers.get(name);
  if (!handler) throw new Error(`register() did not register ${name}`);
  return handler;
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = addr && typeof addr !== "string" ? addr.port : 0;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

interface Setup {
  root: string;
  addons: string;
  leasePath: string;
  markerPath: string;
  config: Config;
  client: WorkbenchClient;
  launch: ToolHandler;
}

async function setup(overrides: Partial<Config> = {}): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "emcp-wblaunch-"));
  const addons = join(root, "addons");
  mkdirSync(addons, { recursive: true });
  const leasePath = join(root, "state", "workbench.lease.json");
  const markerPath = join(root, "state", "no-autolaunch");
  const config = {
    workbenchPath: join(root, "absent-tools"),
    projectPath: addons,
    gamePath: join(root, "absent-game"),
    workbenchHost: "127.0.0.1",
    workbenchPort: await closedPort(),
    leasePath,
    noAutolaunchPath: markerPath,
    ...overrides,
  } as unknown as Config;
  const client = new WorkbenchClient(config.workbenchHost, config.workbenchPort, config);
  const launch = captureNamed((s) => registerWbLaunch(s, config, client), "wb_launch");
  return { root, addons, leasePath, markerPath, config, client, launch };
}

function makeAddon(addons: string, name: string): string {
  mkdirSync(join(addons, name), { recursive: true });
  const gproj = join(addons, name, `${name}.gproj`);
  writeFileSync(gproj, "GameProject {}");
  return gproj;
}

function handlerDir(modDir: string): string {
  return join(modDir, "Scripts", "WorkbenchGame", "EnfusionMCP");
}

describe("wb_launch", () => {
  let s: Setup;

  afterEach(() => {
    rmSync(s.root, { recursive: true, force: true });
  });

  it("refuses without gprojPath and without defaultMod, and installs nothing", async () => {
    s = await setup();
    makeAddon(s.addons, "OnlyAddon");

    const r = await s.launch({});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Launch Refused — no project given");
    expect(textOf(r)).toContain("gprojPath");
    expect(existsSync(handlerDir(join(s.addons, "OnlyAddon")))).toBe(false);
    expect(existsSync(s.leasePath)).toBe(false);
  });

  it("refuses when defaultMod names an addon without a .gproj", async () => {
    s = await setup();
    mkdirSync(join(s.addons, "Empty"), { recursive: true });
    s.config.defaultMod = "Empty";

    const r = await s.launch({});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('default mod "Empty" has no .gproj');
  });

  it("uses the defaultMod project when gprojPath is omitted", async () => {
    s = await setup();
    const gproj = makeAddon(s.addons, "ModA");
    s.config.defaultMod = "ModA";

    const r = await s.launch({});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Launch Failed");
    expect(textOf(r)).toContain("Cannot find");
    expect(readLease(s.leasePath)!.project).toBe(resolve(gproj));
  });

  it("launches an explicit project while the no-autolaunch marker exists", async () => {
    s = await setup();
    const gproj = makeAddon(s.addons, "ModA");
    mkdirSync(join(s.root, "state"), { recursive: true });
    writeFileSync(s.markerPath, "");

    const r = await s.launch({ gprojPath: gproj });
    expect(textOf(r)).toContain("Cannot find");
    expect(textOf(r)).not.toContain("Launch Refused");
    expect(existsSync(handlerDir(join(s.addons, "ModA")))).toBe(true);
  });

  it("refuses an explicit project while another session holds the lease", async () => {
    s = await setup();
    const gproj = makeAddon(s.addons, "ModA");
    s.config.defaultMod = "Previous";
    const iso = new Date().toISOString();
    mkdirSync(join(s.root, "state"), { recursive: true });
    writeFileSync(
      s.leasePath,
      JSON.stringify({
        session: "other",
        purpose: "live-session",
        started_at: iso,
        heartbeat_at: iso,
        wb_pid: null,
        project: null,
      }),
    );

    const r = await s.launch({ gprojPath: gproj });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Workbench lease held by another session");
    expect(textOf(r)).toContain("other (live-session");
    expect(existsSync(handlerDir(join(s.addons, "ModA")))).toBe(false);
    expect(s.config.defaultMod).toBe("Previous");
    expect(readLease(s.leasePath)!.session).toBe("other");
  });
});
