/**
 * Total audit live-client-02: a GUI launch never spawns a second Workbench.
 * A refused NET API port is no proof that none runs (starting, NET API off,
 * opened by hand), and an answer without our handlers, or an odd one, means
 * one runs for sure. `spawn` is mocked, so nothing is ever started; the
 * "executable" is an empty file in a temporary folder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

import type { Config } from "../../src/config.js";
import { WorkbenchClient, WorkbenchError } from "../../src/workbench/client.js";
import { decodeInt32LE, decodePascalString, encodePascalString } from "../../src/workbench/protocol.js";

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = addr && typeof addr !== "string" ? addr.port : 0;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

/** A NET API that answers every call with the bare status `status`. */
function statusServer(status: string): { port: number; close: () => Promise<void> } {
  const server: Server = createServer((socket: Socket) => {
    const chunks: Buffer[] = [];
    socket.on("error", () => {});
    socket.on("data", (c) => chunks.push(c));
    socket.on("end", () => {
      const buf = Buffer.concat(chunks);
      let offset = decodeInt32LE(buf, 0).bytesRead;
      offset += decodePascalString(buf, offset).bytesRead;
      offset += decodePascalString(buf, offset).bytesRead;
      decodePascalString(buf, offset);
      socket.end(encodePascalString(status));
    });
  });
  server.listen(0);
  const addr = server.address();
  const port = addr && typeof addr !== "string" ? addr.port : 0;
  return { port, close: () => new Promise((r) => server.close(() => r())) };
}

let root: string;
let config: Config;
let gproj: string;

beforeEach(() => {
  spawnMock.mockReset();
  root = mkdtempSync(join(tmpdir(), "emcp-spawn-guard-"));
  const tools = join(root, "tools");
  mkdirSync(join(tools, "Workbench"), { recursive: true });
  writeFileSync(join(tools, "Workbench", "ArmaReforgerWorkbenchSteamDiag.exe"), "");
  const addons = join(root, "addons");
  mkdirSync(join(addons, "ModA"), { recursive: true });
  gproj = join(addons, "ModA", "ModA.gproj");
  writeFileSync(gproj, "GameProject {}");
  config = {
    workbenchPath: tools,
    projectPath: addons,
    gamePath: join(root, "absent-game"),
    leasePath: join(root, "state", "workbench.lease.json"),
    noAutolaunchPath: join(root, "state", "no-autolaunch"),
  } as unknown as Config;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("GUI launch spawn guard (live-client-02)", () => {
  it("refuses to spawn while a Workbench process runs behind a refused port", async () => {
    const client = new WorkbenchClient("127.0.0.1", await closedPort(), config);
    client.workbenchPids = () => [4242];

    const err = await client.ensureRunning(gproj).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkbenchError);
    expect((err as WorkbenchError).code).toBe("LAUNCH_FAILED");
    expect((err as WorkbenchError).message).toContain("pid 4242");
    expect((err as WorkbenchError).message).toContain("No second Workbench was started");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("refuses to spawn while a Workbench answers without the handlers", async () => {
    const wb = statusServer("Undefined API func");
    try {
      const client = new WorkbenchClient("127.0.0.1", wb.port, config);
      client.workbenchPids = () => [];
      const err = await client.ensureRunning(gproj).catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LAUNCH_FAILED");
      expect((err as WorkbenchError).message).toContain("handlers are not loaded");
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      await wb.close();
    }
  });

  it("refuses to spawn while a Workbench gives an unusable Ping answer", async () => {
    const wb = statusServer("Some engine error");
    try {
      const client = new WorkbenchClient("127.0.0.1", wb.port, config);
      client.workbenchPids = () => [];
      const err = await client.ensureRunning(gproj).catch((e: unknown) => e);
      expect((err as WorkbenchError).message).toContain("Workbench is already running");
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      await wb.close();
    }
  });

  it("pingStatus tells a refused port from a running Workbench", async () => {
    const refused = new WorkbenchClient("127.0.0.1", await closedPort(), config);
    expect((await refused.pingStatus()).kind).toBe("refused");
    const wb = statusServer("Undefined API func");
    try {
      const up = new WorkbenchClient("127.0.0.1", wb.port, config);
      expect((await up.pingStatus()).kind).toBe("no_handlers");
      expect(await up.ping()).toBe(false);
    } finally {
      await wb.close();
    }
  });
});
