/**
 * Plan 5.1 guards on WorkbenchClient: the Workbench lease, the refusal to
 * auto-launch without an explicit project (and while the no-autolaunch marker
 * exists), and handler recovery that targets the open project or refuses.
 *
 * Every test runs against temporary directories: projectPath, lease and
 * marker are temp files, and workbenchPath is a directory that does not
 * exist, so no Workbench executable can ever be found or spawned.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "../../src/config.js";
import {
  LEASE_SESSION,
  WorkbenchClient,
  WorkbenchError,
  findDefaultModGproj,
  resolveLoadedProjectGproj,
} from "../../src/workbench/client.js";
import { readLease, type WorkbenchLease } from "../../src/workbench/lease.js";
import {
  decodeInt32LE,
  decodePascalString,
  encodePascalString,
} from "../../src/workbench/protocol.js";

const OUR_SESSION = LEASE_SESSION;
const T0 = Date.parse("2026-10-01T12:00:00.000Z");

/** Reply from the mock: a JSON payload, or a bare error status string. */
type MockReply = { json: unknown } | { status: string };

/** Mock Workbench NET API server that records every API function it is asked for. */
function createMockWorkbench(handler: (apiFunc: string) => MockReply): {
  port: number;
  requests: string[];
  close: () => Promise<void>;
} {
  const requests: string[] = [];
  const server: Server = createServer((socket: Socket) => {
    const chunks: Buffer[] = [];
    socket.on("error", () => {});
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      const buf = Buffer.concat(chunks);
      let offset = decodeInt32LE(buf, 0).bytesRead;
      offset += decodePascalString(buf, offset).bytesRead;
      offset += decodePascalString(buf, offset).bytesRead;
      const { APIFunc } = JSON.parse(decodePascalString(buf, offset).value) as {
        APIFunc: string;
      };
      requests.push(APIFunc);
      const reply = handler(APIFunc);
      if ("status" in reply) {
        socket.end(encodePascalString(reply.status));
      } else {
        socket.end(
          Buffer.concat([encodePascalString("Ok"), encodePascalString(JSON.stringify(reply.json))]),
        );
      }
    });
  });
  server.listen(0);
  const addr = server.address();
  const port = addr && typeof addr !== "string" ? addr.port : 0;
  return { port, requests, close: () => new Promise((r) => server.close(() => r())) };
}

/** A port that was bound and released, so connecting to it is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = addr && typeof addr !== "string" ? addr.port : 0;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

interface Sandbox {
  root: string;
  addons: string;
  leasePath: string;
  markerPath: string;
  config: Config;
}

function makeSandbox(overrides: Partial<Config> = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "emcp-guards-"));
  const addons = join(root, "addons");
  mkdirSync(addons, { recursive: true });
  const leasePath = join(root, "state", "workbench.lease.json");
  const markerPath = join(root, "state", "no-autolaunch");
  const config = {
    workbenchPath: join(root, "absent-tools"),
    projectPath: addons,
    gamePath: join(root, "absent-game"),
    leasePath,
    noAutolaunchPath: markerPath,
    ...overrides,
  } as unknown as Config;
  return { root, addons, leasePath, markerPath, config };
}

/** Create `<addons>/<name>/<name>.gproj` and return the .gproj path. */
function makeAddon(addons: string, name: string): string {
  mkdirSync(join(addons, name), { recursive: true });
  const gproj = join(addons, name, `${name}.gproj`);
  writeFileSync(gproj, "GameProject {}");
  return gproj;
}

function handlerDir(modDir: string): string {
  return join(modDir, "Scripts", "WorkbenchGame", "EnfusionMCP");
}

/** True when any directory under `root` holds an installed handler folder. */
function anyHandlersUnder(root: string): boolean {
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 6) return false;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "EnfusionMCP") return true;
      if (walk(join(dir, e.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(root, 0);
}

function writeLease(path: string, lease: WorkbenchLease): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(lease), "utf-8");
}

function otherLease(heartbeatAt: number, wbPid: number | null = null): WorkbenchLease {
  return {
    session: "other",
    purpose: "live-session",
    started_at: new Date(heartbeatAt).toISOString(),
    heartbeat_at: new Date(heartbeatAt).toISOString(),
    wb_pid: wbPid,
    project: null,
  };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof WorkbenchError) return e.code;
    throw e;
  }
  throw new Error("expected a WorkbenchError, but the call succeeded");
}

describe("WorkbenchClient guards", () => {
  let sb: Sandbox;

  afterEach(() => {
    rmSync(sb.root, { recursive: true, force: true });
  });

  describe("auto-launch refusal", () => {
    it("refuses with AUTOLAUNCH_REFUSED while the marker exists and writes no handler files", async () => {
      sb = makeSandbox();
      makeAddon(sb.addons, "ModA");
      sb.config.defaultMod = "ModA";
      mkdirSync(resolve(sb.markerPath, ".."), { recursive: true });
      writeFileSync(sb.markerPath, "");
      const client = new WorkbenchClient("127.0.0.1", await closedPort(), sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkbenchError);
      expect((err as WorkbenchError).code).toBe("AUTOLAUNCH_REFUSED");
      expect((err as WorkbenchError).message).toContain(sb.markerPath);
      expect((err as WorkbenchError).message).toContain("wb_launch");
      expect(anyHandlersUnder(sb.root)).toBe(false);
    });

    it("refuses without defaultMod instead of picking the first addon found", async () => {
      sb = makeSandbox();
      makeAddon(sb.addons, "OnlyAddon");
      const client = new WorkbenchClient("127.0.0.1", await closedPort(), sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("AUTOLAUNCH_REFUSED");
      expect((err as WorkbenchError).message).toContain("refusing to pick a fallback addon");
      expect(existsSync(handlerDir(join(sb.addons, "OnlyAddon")))).toBe(false);
      expect(existsSync(join(sb.addons, "EnfusionMCP"))).toBe(false);
    });

    it("launches the defaultMod project and records it in our lease", async () => {
      sb = makeSandbox();
      const gproj = makeAddon(sb.addons, "ModA");
      makeAddon(sb.addons, "AaaFirstAlphabetically");
      sb.config.defaultMod = "ModA";
      const client = new WorkbenchClient("127.0.0.1", await closedPort(), sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      // No executable under the absent tools dir: the launch fails before any spawn.
      expect((err as WorkbenchError).code).toBe("LAUNCH_FAILED");
      expect((err as WorkbenchError).message).toContain("Cannot find");
      const lease = readLease(sb.leasePath);
      expect(lease).not.toBeNull();
      expect(lease!.session).toBe(OUR_SESSION);
      expect(lease!.purpose).toBe("registered-server");
      expect(lease!.project).toBe(resolve(gproj));
      expect(lease!.wb_pid).toBeNull();
      expect(existsSync(handlerDir(join(sb.addons, "AaaFirstAlphabetically")))).toBe(false);
    });

    it("refuses when defaultMod names an addon without a .gproj", async () => {
      sb = makeSandbox();
      mkdirSync(join(sb.addons, "NoProject"), { recursive: true });
      makeAddon(sb.addons, "Other");
      sb.config.defaultMod = "NoProject";
      const client = new WorkbenchClient("127.0.0.1", await closedPort(), sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("AUTOLAUNCH_REFUSED");
      expect((err as WorkbenchError).message).toContain("NoProject");
      expect(anyHandlersUnder(sb.root)).toBe(false);
    });

    it("refuses ensureRunning() with no project and no defaultMod", async () => {
      sb = makeSandbox();
      makeAddon(sb.addons, "ModA");
      const client = new WorkbenchClient("127.0.0.1", await closedPort(), sb.config);

      expect(await codeOf(client.ensureRunning())).toBe("AUTOLAUNCH_REFUSED");
      expect(anyHandlersUnder(sb.root)).toBe(false);
    });

    it("launches an explicit project even while the marker exists", async () => {
      sb = makeSandbox();
      const gproj = makeAddon(sb.addons, "ModA");
      mkdirSync(resolve(sb.markerPath, ".."), { recursive: true });
      writeFileSync(sb.markerPath, "");
      const client = new WorkbenchClient("127.0.0.1", await closedPort(), sb.config);

      const err = await client.ensureRunning(gproj).catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LAUNCH_FAILED");
      expect((err as WorkbenchError).message).toContain("Cannot find");
      expect(readLease(sb.leasePath)!.project).toBe(resolve(gproj));
    });
  });

  describe("lease", () => {
    let mock: ReturnType<typeof createMockWorkbench>;

    beforeEach(() => {
      mock = createMockWorkbench(() => ({ json: { status: "ok", mode: "edit" } }));
    });

    afterEach(async () => {
      await mock.close();
    });

    it("refuses call() with LEASE_HELD before any traffic when another session holds the lease", async () => {
      sb = makeSandbox();
      writeLease(sb.leasePath, otherLease(Date.now()));
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LEASE_HELD");
      expect((err as WorkbenchError).message).toContain("other (live-session");
      expect(mock.requests).toEqual([]);
      expect(readLease(sb.leasePath)!.session).toBe("other");
    });

    it("refuses call() for an orphaned lease without taking it", async () => {
      sb = makeSandbox();
      writeLease(sb.leasePath, otherLease(T0 - 20 * 60_000, 4242));
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);
      client.leaseDeps = { now: () => T0, isAlive: () => true };

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LEASE_HELD");
      expect((err as WorkbenchError).message).toContain("LEASE_ORPHANED");
      expect(mock.requests).toEqual([]);
      expect(readLease(sb.leasePath)!.session).toBe("other");
    });

    it("refuses call() for a corrupt lease file and leaves it in place", async () => {
      sb = makeSandbox();
      mkdirSync(resolve(sb.leasePath, ".."), { recursive: true });
      writeFileSync(sb.leasePath, "{ not json");
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LEASE_HELD");
      expect((err as WorkbenchError).message).toContain("LEASE_CORRUPT");
      expect(mock.requests).toEqual([]);
      expect(existsSync(sb.leasePath)).toBe(true);
    });

    it("takes over a stale lease (expired heartbeat, no live Workbench)", async () => {
      sb = makeSandbox();
      writeLease(sb.leasePath, otherLease(T0 - 20 * 60_000, 4242));
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);
      client.leaseDeps = { now: () => T0, isAlive: () => false };

      await client.call("EMCP_WB_GetState");
      expect(readLease(sb.leasePath)!.session).toBe(OUR_SESSION);
      expect(mock.requests).toEqual(["EMCP_WB_GetState"]);
    });

    it("acquires a free lease on the first call and proceeds", async () => {
      sb = makeSandbox();
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      await client.call("EMCP_WB_GetState");
      const lease = readLease(sb.leasePath)!;
      expect(lease.session).toBe(OUR_SESSION);
      expect(lease.purpose).toBe("registered-server");
      expect(lease.wb_pid).toBeNull();
      expect(mock.requests).toEqual(["EMCP_WB_GetState"]);
    });

    it("refuses ensureRunning(explicit) under a held lease and installs nothing", async () => {
      sb = makeSandbox();
      const gproj = makeAddon(sb.addons, "ModA");
      writeLease(sb.leasePath, otherLease(Date.now()));
      const client = new WorkbenchClient("127.0.0.1", await closedPort(), sb.config);

      expect(await codeOf(client.ensureRunning(gproj))).toBe("LEASE_HELD");
      expect(anyHandlersUnder(sb.root)).toBe(false);
      expect(readLease(sb.leasePath)!.session).toBe("other");
    });

    it("keeps ping() and diagnose() lease-free and reports lease and marker state", async () => {
      sb = makeSandbox();
      writeLease(sb.leasePath, otherLease(Date.now()));
      mkdirSync(resolve(sb.markerPath, ".."), { recursive: true });
      writeFileSync(sb.markerPath, "");
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      expect(await client.ping()).toBe(true);
      const report = await client.diagnose();
      expect(report.lease).not.toBeNull();
      expect(report.lease!.check.state).toBe("held");
      expect(report.lease!.ours).toBe(false);
      expect(report.lease!.path).toBe(sb.leasePath);
      expect(report.noAutolaunch).toEqual({ path: sb.markerPath, exists: true });
      expect(readLease(sb.leasePath)!.session).toBe("other");
    });

    it("does not create a lease from diagnose() when none exists", async () => {
      sb = makeSandbox();
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      const report = await client.diagnose();
      expect(report.lease!.check.state).toBe("free");
      expect(report.noAutolaunch!.exists).toBe(false);
      expect(existsSync(sb.leasePath)).toBe(false);
    });

    it("rewrites heartbeat_at at most once per 60 s", async () => {
      sb = makeSandbox();
      let now = T0;
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);
      client.leaseDeps = { now: () => now };

      await client.call("EMCP_WB_GetState");
      expect(readLease(sb.leasePath)!.heartbeat_at).toBe(new Date(T0).toISOString());
      now = T0 + 30_000;
      await client.call("EMCP_WB_GetState");
      expect(readLease(sb.leasePath)!.heartbeat_at).toBe(new Date(T0).toISOString());
      now = T0 + 61_000;
      await client.call("EMCP_WB_GetState");
      expect(readLease(sb.leasePath)!.heartbeat_at).toBe(new Date(T0 + 61_000).toISOString());
      expect(readLease(sb.leasePath)!.started_at).toBe(new Date(T0).toISOString());
    });

    it("refreshes its own lease whose heartbeat expired instead of treating it as orphaned", async () => {
      sb = makeSandbox();
      writeLease(sb.leasePath, { ...otherLease(T0 - 20 * 60_000, 4242), session: OUR_SESSION });
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);
      client.leaseDeps = { now: () => T0, isAlive: () => true };

      await client.call("EMCP_WB_GetState");
      const lease = readLease(sb.leasePath)!;
      expect(lease.heartbeat_at).toBe(new Date(T0).toISOString());
      expect(lease.wb_pid).toBe(4242);
    });

    it("releaseLease() removes our lease", async () => {
      sb = makeSandbox();
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);
      await client.call("EMCP_WB_GetState");
      expect(existsSync(sb.leasePath)).toBe(true);

      expect(client.releaseLease()).toBe(true);
      expect(existsSync(sb.leasePath)).toBe(false);
      expect(client.releaseLease()).toBe(false);
    });

    it("releaseLease() leaves another session's lease alone and does not throw", () => {
      sb = makeSandbox();
      writeLease(sb.leasePath, otherLease(Date.now()));
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      expect(client.releaseLease()).toBe(false);
      expect(readLease(sb.leasePath)!.session).toBe("other");
    });
  });

  describe("handler recovery", () => {
    let mock: ReturnType<typeof createMockWorkbench> | undefined;

    afterEach(async () => {
      if (mock) await mock.close();
      mock = undefined;
    });

    it("installs handlers into the project Workbench reports as open", async () => {
      sb = makeSandbox();
      const openGproj = makeAddon(sb.addons, "OpenMod");
      makeAddon(sb.addons, "AaaOther");
      sb.config.defaultMod = "AaaOther";
      const openDir = join(sb.addons, "OpenMod");
      mock = createMockWorkbench((apiFunc) => {
        if (apiFunc === "GetLoadedProjects") {
          return { json: { "Loaded Projects": ["ArmaReforger", "OpenMod"] } };
        }
        // Handlers "compile" once they exist in the open project.
        return existsSync(join(handlerDir(openDir), "EMCP_WB_Ping.c"))
          ? { json: { status: "ok", mode: "edit" } }
          : { status: "Undefined API func" };
      });
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      const result = await client.call<{ mode: string }>("EMCP_WB_GetState");
      expect(result.mode).toBe("edit");
      expect(existsSync(join(handlerDir(openDir), "EMCP_WB_Ping.c"))).toBe(true);
      expect(existsSync(handlerDir(join(sb.addons, "AaaOther")))).toBe(false);
      expect(mock.requests).toContain("GetLoadedProjects");
      expect(openGproj).toContain("OpenMod");
    }, 20_000);

    it("refuses with LAUNCH_FAILED when the open project cannot be resolved", async () => {
      sb = makeSandbox();
      makeAddon(sb.addons, "SomeAddon");
      sb.config.defaultMod = "SomeAddon";
      mock = createMockWorkbench((apiFunc) =>
        apiFunc === "GetLoadedProjects"
          ? { json: { "Loaded Projects": ["ArmaReforger", "NotOnDisk"] } }
          : { status: "Undefined API func" },
      );
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LAUNCH_FAILED");
      expect((err as WorkbenchError).message).toContain("open project could not be resolved");
      expect((err as WorkbenchError).message).toContain("wb_launch");
      expect(anyHandlersUnder(sb.root)).toBe(false);
    });

    it("refuses when several loaded projects resolve to addons on disk", async () => {
      sb = makeSandbox();
      makeAddon(sb.addons, "ModA");
      makeAddon(sb.addons, "ModB");
      mock = createMockWorkbench((apiFunc) =>
        apiFunc === "GetLoadedProjects"
          ? { json: { "Loaded Projects": ["ArmaReforger", "ModA", "ModB"] } }
          : { status: "Undefined API func" },
      );
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LAUNCH_FAILED");
      expect((err as WorkbenchError).message).toContain("several loaded projects");
      expect(anyHandlersUnder(sb.root)).toBe(false);
    });

    it("refuses when GetLoadedProjects itself fails", async () => {
      sb = makeSandbox();
      makeAddon(sb.addons, "ModA");
      sb.config.defaultMod = "ModA";
      mock = createMockWorkbench(() => ({ status: "Undefined API func" }));
      const client = new WorkbenchClient("127.0.0.1", mock.port, sb.config);

      const err = await client.call("EMCP_WB_GetState").catch((e: unknown) => e);
      expect((err as WorkbenchError).code).toBe("LAUNCH_FAILED");
      expect((err as WorkbenchError).message).toContain("GetLoadedProjects failed");
      expect(anyHandlersUnder(sb.root)).toBe(false);
    });
  });
});

describe("resolveLoadedProjectGproj", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "emcp-loaded-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves the live-verified names-only shape against projectPath", () => {
    const gproj = makeAddon(root, "OpenMod");
    const r = resolveLoadedProjectGproj({ "Loaded Projects": ["ArmaReforger", "OpenMod"] }, root);
    expect(r.gproj).toBe(gproj);
    expect(r.entries).toEqual(["ArmaReforger", "OpenMod"]);
  });

  it("prefers <name>.gproj when an addon holds several project files", () => {
    mkdirSync(join(root, "Mod"), { recursive: true });
    writeFileSync(join(root, "Mod", "Aaa.gproj"), "GameProject {}");
    writeFileSync(join(root, "Mod", "Mod.gproj"), "GameProject {}");
    const r = resolveLoadedProjectGproj({ "Loaded Projects": ["Mod"] }, root);
    expect(r.gproj).toBe(join(root, "Mod", "Mod.gproj"));
  });

  it("accepts the projects and addons array variants", () => {
    const gproj = makeAddon(root, "OpenMod");
    expect(resolveLoadedProjectGproj({ projects: ["OpenMod"] }, root).gproj).toBe(gproj);
    expect(resolveLoadedProjectGproj({ addons: ["OpenMod"] }, root).gproj).toBe(gproj);
  });

  it("accepts object entries with a path to a .gproj or to an addon directory", () => {
    const gproj = makeAddon(root, "OpenMod");
    expect(
      resolveLoadedProjectGproj({ projects: [{ name: "x", path: gproj }] }, undefined).gproj,
    ).toBe(resolve(gproj));
    expect(
      resolveLoadedProjectGproj(
        { projects: [{ name: "OpenMod", path: join(root, "OpenMod") }] },
        undefined,
      ).gproj,
    ).toBe(gproj);
    expect(resolveLoadedProjectGproj({ projects: [{ name: "OpenMod" }] }, root).gproj).toBe(gproj);
  });

  it("does not resolve names containing path separators", () => {
    makeAddon(root, "OpenMod");
    const r = resolveLoadedProjectGproj({ "Loaded Projects": ["../OpenMod", "a/b"] }, root);
    expect(r.gproj).toBeNull();
    expect(r.candidates).toEqual([]);
  });

  it("returns null with no candidates for an unknown payload", () => {
    const r = resolveLoadedProjectGproj({ status: "ok" }, root);
    expect(r.gproj).toBeNull();
    expect(r.entries).toEqual([]);
  });

  it("returns null with every candidate when the result is ambiguous", () => {
    makeAddon(root, "ModA");
    makeAddon(root, "ModB");
    const r = resolveLoadedProjectGproj({ "Loaded Projects": ["ModA", "ModB"] }, root);
    expect(r.gproj).toBeNull();
    expect(r.candidates).toHaveLength(2);
  });

  it("counts the same project reported twice as one candidate", () => {
    const gproj = makeAddon(root, "ModA");
    const r = resolveLoadedProjectGproj(
      { projects: ["ModA", { name: "ModA", path: gproj }] },
      root,
    );
    expect(r.gproj).toBe(gproj);
  });
});

describe("findDefaultModGproj", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "emcp-defmod-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the defaultMod addon's .gproj", () => {
    const gproj = makeAddon(root, "ModA");
    makeAddon(root, "Aaa");
    const config = { projectPath: root, defaultMod: "ModA" } as unknown as Config;
    expect(findDefaultModGproj(config)).toBe(gproj);
  });

  it("returns null without defaultMod even when addons exist", () => {
    makeAddon(root, "ModA");
    expect(findDefaultModGproj({ projectPath: root } as unknown as Config)).toBeNull();
    expect(findDefaultModGproj(undefined)).toBeNull();
  });
});
