import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, Socket, type Server } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { Config } from "../../src/config.js";
import {
  WorkbenchClient,
  WorkbenchError,
  handlerSetDigest,
  isOurStandaloneAddon,
} from "../../src/workbench/client.js";
import {
  decodePascalString,
  decodeInt32LE,
  encodePascalString,
} from "../../src/workbench/protocol.js";

/**
 * Create a mock Workbench NET API server that:
 * 1. Reads the full request
 * 2. Parses the APIFunc from the payload
 * 3. Calls the handler to produce a response
 * 4. Sends the response as a Pascal string and closes
 */
function createMockWorkbench(
  handler: (apiFunc: string, params: Record<string, unknown>) => unknown,
): { server: Server; port: number; close: () => Promise<void> } {
  const server = createServer((socket: Socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      try {
        const buf = Buffer.concat(chunks);

        // Parse: int32 protocolVer + pascal clientId + pascal contentType + pascal payload
        let offset = 0;
        const { bytesRead: b0 } = decodeInt32LE(buf, offset);
        offset += b0;
        const { bytesRead: b1 } = decodePascalString(buf, offset);
        offset += b1;
        const { bytesRead: b2 } = decodePascalString(buf, offset);
        offset += b2;
        const { value: payload } = decodePascalString(buf, offset);

        const parsed = JSON.parse(payload);
        const { APIFunc, ...params } = parsed;
        const response = handler(APIFunc, params);
        // Match real Workbench format: pascal("Ok") + pascal(JSON)
        const statusBuf = encodePascalString("Ok");
        const payloadBuf = encodePascalString(JSON.stringify(response));
        socket.end(Buffer.concat([statusBuf, payloadBuf]));
      } catch (e) {
        // Error: just send error status string (no payload)
        const errBuf = encodePascalString(`Error: ${String(e)}`);
        socket.end(errBuf);
      }
    });
  });

  let resolvedPort = 0;
  server.listen(0); // OS-assigned port
  const addr = server.address();
  if (addr && typeof addr !== "string") {
    resolvedPort = addr.port;
  }

  return {
    server,
    port: resolvedPort,
    close: () => new Promise((res) => server.close(() => res())),
  };
}

describe("WorkbenchClient", () => {
  let mockServer: ReturnType<typeof createMockWorkbench>;
  let client: WorkbenchClient;

  beforeEach(() => {
    mockServer = createMockWorkbench((apiFunc, _params) => {
      if (apiFunc === "EMCP_WB_Ping") {
        return { status: "ok", mode: "edit", message: "EnfusionMCP Workbench bridge active" };
      }
      if (apiFunc === "GetLoadedProjects") {
        return { "Loaded Projects": ["ArmaReforger", "TestMod"] };
      }
      if (apiFunc === "ReloadScripts") {
        return { status: "ok" };
      }
      if (apiFunc === "EMCP_WB_ListEntities") {
        return {
          count: 2,
          entities: [
            { name: "Tree_01", className: "SCR_DestructibleEntity" },
            { name: "House_02", className: "BuildingEntity" },
          ],
        };
      }
      return { error: `Unknown function: ${apiFunc}` };
    });
    client = new WorkbenchClient("127.0.0.1", mockServer.port);
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it("calls a built-in function", async () => {
    const result = await client.call<{ status: string }>("ReloadScripts");
    expect(result.status).toBe("ok");
  });

  it("calls a custom handler with params", async () => {
    const result = await client.call<{
      count: number;
      entities: Array<{ name: string; className: string }>;
    }>("EMCP_WB_ListEntities", { offset: 0, limit: 50 });
    expect(result.count).toBe(2);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe("Tree_01");
  });

  it("ping returns true when server is running", async () => {
    const ok = await client.ping();
    expect(ok).toBe(true);
  });

  it("ping returns false when server is down", async () => {
    await mockServer.close();
    const deadClient = new WorkbenchClient("127.0.0.1", 1); // port 1 should refuse
    const ok = await deadClient.ping();
    expect(ok).toBe(false);
  });

  it("throws CONNECTION_REFUSED on bad port", async () => {
    const badClient = new WorkbenchClient("127.0.0.1", 1);
    await expect(badClient.call("ReloadScripts", {}, { skipAutoLaunch: true })).rejects.toThrow(
      WorkbenchError,
    );
    try {
      await badClient.call("ReloadScripts", {}, { skipAutoLaunch: true });
    } catch (e) {
      expect(e).toBeInstanceOf(WorkbenchError);
      expect((e as WorkbenchError).code).toBe("CONNECTION_REFUSED");
    }
  });

  it("throws TIMEOUT on slow response", async () => {
    // Create a server that never responds.
    // allowHalfOpen prevents Node auto-ending when client sends FIN.
    const openSockets: Socket[] = [];
    const slowServer = createServer({ allowHalfOpen: true }, (socket) => {
      openSockets.push(socket);
      socket.on("data", () => {});
    });
    slowServer.listen(0);
    const addr = slowServer.address();
    const port = addr && typeof addr !== "string" ? addr.port : 0;
    const slowClient = new WorkbenchClient("127.0.0.1", port);

    await expect(
      slowClient.call("ReloadScripts", {}, { timeout: 200, skipAutoLaunch: true }),
    ).rejects.toThrow("timed out");

    // Destroy all held sockets so server.close() doesn't hang
    for (const s of openSockets) s.destroy();
    await new Promise<void>((res) => slowServer.close(() => res()));
  });

  it("toString shows host and port", () => {
    expect(client.toString()).toContain("127.0.0.1");
    expect(client.toString()).toContain(String(mockServer.port));
  });

  // -- State caching tests --

  it("state starts as disconnected/unknown", () => {
    const freshClient = new WorkbenchClient("127.0.0.1", 1);
    expect(freshClient.state.connected).toBe(false);
    expect(freshClient.state.mode).toBe("unknown");
    expect(freshClient.state.lastUpdated).toBe(0);
  });

  it("state.connected becomes true after successful call", async () => {
    expect(client.state.connected).toBe(false);
    await client.call("ReloadScripts");
    expect(client.state.connected).toBe(true);
    expect(client.state.lastUpdated).toBeGreaterThan(0);
  });

  it("state.mode is extracted from response with mode field", async () => {
    // EMCP_WB_Ping returns { mode: "edit" }
    await client.call("EMCP_WB_Ping");
    expect(client.state.mode).toBe("edit");
    expect(client.state.connected).toBe(true);
  });

  it("state.mode stays unknown for responses without mode field", async () => {
    // ReloadScripts returns { status: "ok" } — no mode field
    await client.call("ReloadScripts");
    expect(client.state.mode).toBe("unknown");
    expect(client.state.connected).toBe(true);
  });

  it("state.connected becomes false on connection refused", async () => {
    // First connect successfully
    await client.call("ReloadScripts");
    expect(client.state.connected).toBe(true);

    // Now try a dead client
    const badClient = new WorkbenchClient("127.0.0.1", 1);
    try {
      await badClient.call("ReloadScripts", {}, { skipAutoLaunch: true });
    } catch {
      /* expected */
    }
    expect(badClient.state.connected).toBe(false);
    expect(badClient.state.mode).toBe("unknown");
  });

  it("state tracks mode changes across calls", async () => {
    // Set up a server that changes mode based on the API call
    await mockServer.close();
    mockServer = createMockWorkbench((apiFunc) => {
      if (apiFunc === "EMCP_WB_EditorControl") {
        return { status: "ok", mode: "play" };
      }
      if (apiFunc === "EMCP_WB_GetState") {
        return { mode: "edit", entityCount: 5 };
      }
      return { status: "ok" };
    });
    const stateClient = new WorkbenchClient("127.0.0.1", mockServer.port);

    // Start with "play" mode from EditorControl
    await stateClient.call("EMCP_WB_EditorControl", { action: "play" });
    expect(stateClient.state.mode).toBe("play");

    // Then "edit" mode from GetState
    await stateClient.call("EMCP_WB_GetState");
    expect(stateClient.state.mode).toBe("edit");
  });

  it("refreshState updates cached state", async () => {
    await mockServer.close();
    mockServer = createMockWorkbench((apiFunc) => {
      if (apiFunc === "EMCP_WB_GetState") {
        return { mode: "play", entityCount: 10 };
      }
      return { status: "ok" };
    });
    const stateClient = new WorkbenchClient("127.0.0.1", mockServer.port);

    expect(stateClient.state.mode).toBe("unknown");
    const state = await stateClient.refreshState();
    expect(state.mode).toBe("play");
    expect(state.connected).toBe(true);
    expect(stateClient.state.mode).toBe("play");
  });

  it("refreshState returns disconnected on failure", async () => {
    const badClient = new WorkbenchClient("127.0.0.1", 1);
    const state = await badClient.refreshState();
    expect(state.connected).toBe(false);
    expect(state.mode).toBe("unknown");
  });
});

describe("cleanupHandlerScripts", () => {
  let modDir: string;

  beforeEach(() => {
    modDir = mkdtempSync(join(tmpdir(), "emcp-cleanup-"));
    const handlerDir = join(modDir, "Scripts", "WorkbenchGame", "EnfusionMCP");
    mkdirSync(handlerDir, { recursive: true });
    writeFileSync(join(handlerDir, "EMCP_WB_Core.c"), "// dummy handler");
    writeFileSync(join(handlerDir, "EMCP_WB_State.c"), "// dummy handler");
  });

  afterEach(() => {
    rmSync(modDir, { recursive: true, force: true });
  });

  it("returns true and removes the handler dir when handlers are present", () => {
    const client = new WorkbenchClient("127.0.0.1", 1);
    const removed = client.cleanupHandlerScripts(modDir);
    expect(removed).toBe(true);
    expect(existsSync(join(modDir, "Scripts", "WorkbenchGame", "EnfusionMCP"))).toBe(false);
    // empty WorkbenchGame parent is pruned too
    expect(existsSync(join(modDir, "Scripts", "WorkbenchGame"))).toBe(false);
  });

  it("returns false on a second call once handlers are gone", () => {
    const client = new WorkbenchClient("127.0.0.1", 1);
    expect(client.cleanupHandlerScripts(modDir)).toBe(true);
    expect(client.cleanupHandlerScripts(modDir)).toBe(false);
  });

  it("returns true with a trailing-separator mod path", () => {
    const client = new WorkbenchClient("127.0.0.1", 1);
    expect(client.cleanupHandlerScripts(modDir + sep)).toBe(true);
    expect(existsSync(join(modDir, "Scripts", "WorkbenchGame", "EnfusionMCP"))).toBe(false);
  });

  it("returns true with a mixed-case drive letter / case-differing path on win32", () => {
    const flipped =
      modDir[0] === modDir[0].toUpperCase()
        ? modDir[0].toLowerCase() + modDir.slice(1)
        : modDir[0].toUpperCase() + modDir.slice(1);
    const client = new WorkbenchClient("127.0.0.1", 1);
    expect(client.cleanupHandlerScripts(flipped)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Socket lifecycle (M1 / M23): chunked, oversized, close-without-end,
// reset-after-end. Client sockets are captured by spying on Socket.prototype
// .connect so the tests can observe/poke the exact socket rawCall() used.
// ---------------------------------------------------------------------------

function captureClientSockets(): { sockets: Socket[]; restore: () => void } {
  const sockets: Socket[] = [];
  const original = Socket.prototype.connect;
  const spy = vi.spyOn(Socket.prototype, "connect").mockImplementation(function (
    this: Socket,
    ...args: unknown[]
  ) {
    sockets.push(this);
    return (original as unknown as (...a: unknown[]) => Socket).apply(this, args);
  });
  return { sockets, restore: () => spy.mockRestore() };
}

function listen(server: Server): number {
  server.listen(0);
  const addr = server.address();
  return addr && typeof addr !== "string" ? addr.port : 0;
}

describe("WorkbenchClient socket lifecycle", () => {
  const okResponse = () =>
    Buffer.concat([
      encodePascalString("Ok"),
      encodePascalString(JSON.stringify({ status: "ok", value: 42 })),
    ]);

  it("reassembles a response delivered in two chunks 50 ms apart", async () => {
    const held: Socket[] = [];
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      held.push(socket);
      socket.on("error", () => {});
      socket.on("data", () => {}); // keep the readable flowing so EOF → 'end' fires
      socket.on("end", () => {
        socket.write(encodePascalString("Ok"));
        setTimeout(() => {
          socket.end(encodePascalString(JSON.stringify({ status: "ok", value: 42 })));
        }, 50);
      });
    });
    const port = listen(server);
    try {
      const client = new WorkbenchClient("127.0.0.1", port);
      const result = await client.call<{ value: number }>("X", {}, { skipAutoLaunch: true });
      expect(result.value).toBe(42);
    } finally {
      for (const s of held) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rejects PROTOCOL_ERROR on an oversized (>10 MB) response without crashing", async () => {
    const held: Socket[] = [];
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      held.push(socket);
      socket.on("error", () => {});
      socket.on("data", () => {}); // keep the readable flowing so EOF → 'end' fires
      socket.on("end", () => {
        // 11 MB of garbage after a valid status prefix.
        socket.write(encodePascalString("Ok"));
        socket.write(Buffer.alloc(11 * 1024 * 1024, 0x41));
      });
    });
    const port = listen(server);
    try {
      const client = new WorkbenchClient("127.0.0.1", port);
      try {
        await client.call("X", {}, { skipAutoLaunch: true, timeout: 10_000 });
        expect.unreachable("should have rejected");
      } catch (e) {
        expect(e).toBeInstanceOf(WorkbenchError);
        expect((e as WorkbenchError).code).toBe("PROTOCOL_ERROR");
        expect((e as WorkbenchError).message).toMatch(/exceeded/);
      }
    } finally {
      for (const s of held) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("decodes buffered data when the socket closes without an 'end' event", async () => {
    const { sockets, restore } = captureClientSockets();
    const held: Socket[] = [];
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      held.push(socket);
      socket.on("error", () => {});
      socket.on("data", () => {}); // keep the readable flowing so EOF → 'end' fires
      socket.on("end", () => {
        socket.write(okResponse()); // no end/FIN — server keeps the socket open
      });
    });
    const port = listen(server);
    try {
      const client = new WorkbenchClient("127.0.0.1", port);
      const pending = client.call<{ value: number }>("X", {}, { skipAutoLaunch: true });
      // Wait for the client socket to receive the data, then drop it locally
      // → 'close' (hadError=false) fires with no preceding 'end'.
      await new Promise<void>((r) => {
        const poll = () => {
          const sock = sockets[0];
          if (sock) {
            sock.once("data", () =>
              setImmediate(() => {
                sock.destroy();
                r();
              }),
            );
          } else {
            setTimeout(poll, 5);
          }
        };
        poll();
      });
      const result = await pending;
      expect(result.value).toBe(42);
    } finally {
      restore();
      for (const s of held) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("a late ECONNRESET after 'end' is swallowed — no unhandled 'error', promise already resolved", async () => {
    const { sockets, restore } = captureClientSockets();
    const server = createServer((socket) => {
      socket.on("data", () => {});
      socket.on("end", () => socket.end(okResponse()));
    });
    const port = listen(server);
    try {
      const client = new WorkbenchClient("127.0.0.1", port);
      const result = await client.call<{ value: number }>("X", {}, { skipAutoLaunch: true });
      expect(result.value).toBe(42);
      const sock = sockets[0];
      expect(sock).toBeDefined();
      // Socket was torn down on the 'end' path.
      expect(sock.destroyed).toBe(true);
      // A late error must have SOME listener, otherwise EventEmitter throws.
      expect(sock.listenerCount("error")).toBeGreaterThan(0);
      const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      expect(() => sock.emit("error", reset)).not.toThrow();
    } finally {
      restore();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ---------------------------------------------------------------------------
// Launch coordination (M2 / M3)
// ---------------------------------------------------------------------------

describe("ensureRunning launch coordination", () => {
  let tmp: string;
  let config: Config;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "emcp-launch-"));
    mkdirSync(join(tmp, "ModA"), { recursive: true });
    mkdirSync(join(tmp, "ModB"), { recursive: true });
    writeFileSync(join(tmp, "ModA", "ModA.gproj"), "GameProject {}");
    writeFileSync(join(tmp, "ModB", "ModB.gproj"), "GameProject {}");
    // workbenchPath points at an empty dir → findWorkbenchExe() returns null →
    // launchWorkbench throws LAUNCH_FAILED before any spawn. logsPath unset →
    // no tracker. Port 1 → ping refused immediately. The lease and the
    // no-autolaunch marker live in the temp dir (ensureRunning takes the
    // lease), never at the real per-user location.
    config = {
      workbenchPath: join(tmp, "no-tools-here"),
      projectPath: tmp,
      leasePath: join(tmp, "lease", "workbench.lease.json"),
      noAutolaunchPath: join(tmp, "lease", "no-autolaunch"),
    } as unknown as Config;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses a concurrent launch for a DIFFERENT gproj with LAUNCH_MISMATCH", async () => {
    const client = new WorkbenchClient("127.0.0.1", 1, config);
    const a = join(tmp, "ModA", "ModA.gproj");
    const b = join(tmp, "ModB", "ModB.gproj");
    const first = client.ensureRunning(a);
    first.catch(() => {}); // expected LAUNCH_FAILED (no exe) — not under test
    expect(client.inFlightLaunchTarget).toBe(a);
    await expect(client.ensureRunning(b)).rejects.toMatchObject({
      name: "WorkbenchError",
      code: "LAUNCH_MISMATCH",
    });
    await expect(client.ensureRunning(b)).rejects.toThrow(/ModA\.gproj/);
    await expect(first).rejects.toMatchObject({ code: "LAUNCH_FAILED" });
    expect(client.inFlightLaunchTarget).toBeNull();
  });

  it("joins the in-flight launch for the SAME gproj (case/separator-insensitive) or no gproj", async () => {
    const client = new WorkbenchClient("127.0.0.1", 1, config);
    const a = join(tmp, "ModA", "ModA.gproj");
    let launches = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Stub the real launcher: count invocations and hold until released.
    (client as unknown as { launchWorkbench: (g?: string) => Promise<void> }).launchWorkbench =
      async () => {
        launches++;
        await gate;
      };
    const first = client.ensureRunning(a);
    const sameSpelledDifferently =
      process.platform === "win32" ? a.replace(/\\/g, "/").toUpperCase() : a;
    const joinedSame = client.ensureRunning(sameSpelledDifferently);
    const joinedAny = client.ensureRunning();
    expect(launches).toBe(1);
    expect(client.inFlightLaunchTarget).toBe(a);
    release();
    await Promise.all([first, joinedSame, joinedAny]);
    expect(launches).toBe(1);
    expect(client.inFlightLaunchTarget).toBeNull();
    // Once settled, a new request starts a fresh launch.
    await client.ensureRunning(a);
    expect(launches).toBe(2);
  });

  it("recoverMissingHandlers is single-flight", async () => {
    const client = new WorkbenchClient("127.0.0.1", 1, config);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Stub the worker so the test doesn't wait on a real 30 s recompile poll.
    (
      client as unknown as { doRecoverMissingHandlers: () => Promise<void> }
    ).doRecoverMissingHandlers = async () => {
      calls++;
      await gate;
    };
    const priv = client as unknown as { recoverMissingHandlers: () => Promise<void> };
    const p1 = priv.recoverMissingHandlers();
    const p2 = priv.recoverMissingHandlers();
    expect(p1).toBe(p2);
    expect(calls).toBe(1);
    release();
    await p1;
    // After settling, a new call starts a fresh recovery.
    const p3 = priv.recoverMissingHandlers();
    expect(p3).not.toBe(p1);
    await p3;
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Handler install / standalone cleanup guards (L1)
// ---------------------------------------------------------------------------

describe("isOurStandaloneAddon", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "emcp-standalone-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("is false for a user directory that merely shares the name", () => {
    const dir = join(tmp, "EnfusionMCP");
    mkdirSync(join(dir, "Scripts", "Game"), { recursive: true });
    writeFileSync(join(dir, "EnfusionMCP.gproj"), 'GameProject { TITLE "My own addon" }');
    writeFileSync(join(dir, "Scripts", "Game", "Thing.c"), "class Thing {}");
    expect(isOurStandaloneAddon(dir)).toBe(false);
  });

  it("is true when our Ping handler is present", () => {
    const dir = join(tmp, "EnfusionMCP");
    mkdirSync(join(dir, "Scripts", "WorkbenchGame", "EnfusionMCP"), { recursive: true });
    writeFileSync(join(dir, "Scripts", "WorkbenchGame", "EnfusionMCP", "EMCP_WB_Ping.c"), "//");
    expect(isOurStandaloneAddon(dir)).toBe(true);
  });

  it("is true when the generated .gproj carries our title", () => {
    const dir = join(tmp, "EnfusionMCP");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "EnfusionMCP.gproj"), 'GameProject { TITLE "EnfusionMCP Handlers" }');
    expect(isOurStandaloneAddon(dir)).toBe(true);
  });
});

describe("handlerSetDigest", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "emcp-digest-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function fill(dir: string, files: Record<string, string>): void {
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  }

  it("returns null for a missing or empty directory", () => {
    expect(handlerSetDigest(join(tmp, "nope"))).toBeNull();
    mkdirSync(join(tmp, "empty"));
    expect(handlerSetDigest(join(tmp, "empty"))).toBeNull();
  });

  it("is equal for identical sets and differs when any handler changes", () => {
    fill(join(tmp, "a"), { "EMCP_WB_Ping.c": "v1", "EMCP_WB_Core.c": "core" });
    fill(join(tmp, "b"), { "EMCP_WB_Ping.c": "v1", "EMCP_WB_Core.c": "core" });
    fill(join(tmp, "c"), { "EMCP_WB_Ping.c": "v2", "EMCP_WB_Core.c": "core" });
    fill(join(tmp, "d"), { "EMCP_WB_Ping.c": "v1" }); // missing a file
    const a = handlerSetDigest(join(tmp, "a"));
    expect(a).toBe(handlerSetDigest(join(tmp, "b")));
    expect(a).not.toBe(handlerSetDigest(join(tmp, "c")));
    expect(a).not.toBe(handlerSetDigest(join(tmp, "d")));
  });

  it("ignores non-.c files", () => {
    fill(join(tmp, "a"), { "EMCP_WB_Ping.c": "v1" });
    fill(join(tmp, "b"), { "EMCP_WB_Ping.c": "v1", "notes.txt": "irrelevant" });
    expect(handlerSetDigest(join(tmp, "a"))).toBe(handlerSetDigest(join(tmp, "b")));
  });
});
