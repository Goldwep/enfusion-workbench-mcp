import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeRequest } from "../../src/workbench/protocol.js";
import { HARNESS_CLIENT_ID, describeFrame, netCall } from "../../scripts/live/netcall.js";
import { MockNet, startMockNetServer } from "../../scripts/live/mock/net.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");

describe("netCall", () => {
  it("sends one frame to a local listener and decodes an Ok response", async () => {
    const server = await startMockNetServer({ EMCP_WB_Ping: { status: "pong", n: 1 } });
    try {
      const r = await netCall("EMCP_WB_Ping", { a: 1 }, { port: server.port, timeoutMs: 2_000 });
      expect(r.ok).toBe(true);
      expect(r.response).toEqual({ status: "pong", n: 1 });
      expect(r.bytesSent).toBe(encodeRequest(HARNESS_CLIENT_ID, "EMCP_WB_Ping", { a: 1 }).length);
      expect(server.mock.calls).toEqual([
        { apiFunc: "EMCP_WB_Ping", params: { a: 1 }, clientId: HARNESS_CLIENT_ID },
      ]);
    } finally {
      await server.close();
    }
  });

  it("reports a scripted error status as a Workbench error", async () => {
    const server = await startMockNetServer({ Broken: { error: "Undefined API func" } });
    try {
      const r = await netCall("Broken", {}, { port: server.port, timeoutMs: 2_000 });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("Workbench error: Undefined API func");
    } finally {
      await server.close();
    }
  });

  it("times out without retrying", async () => {
    const server = await startMockNetServer({}, { silentFor: ["Slow"] });
    try {
      const r = await netCall("Slow", {}, { port: server.port, timeoutMs: 150 });
      expect(r.timedOut).toBe(true);
      expect(r.error).toContain("not retried");
      expect(server.mock.calls).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("reports a refused connection", async () => {
    const server = await startMockNetServer({});
    const port = server.port;
    await server.close();
    const r = await netCall("X", {}, { port, timeoutMs: 1_000 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("refused");
  });
});

describe("describeFrame", () => {
  it("gives the frame length and the JSON payload", () => {
    const f = describeFrame("GetLoadedProjects", { x: "y" });
    expect(f.bytes).toBe(encodeRequest(HARNESS_CLIENT_ID, "GetLoadedProjects", { x: "y" }).length);
    expect(f.payload).toBe('{"x":"y","APIFunc":"GetLoadedProjects"}');
  });
});

describe("MockNet", () => {
  it("consumes a response list in order and repeats the last", () => {
    const m = new MockNet({ A: [{ i: 1 }, { i: 2 }] });
    expect([m.call("A"), m.call("A"), m.call("A")]).toEqual([{ i: 1 }, { i: 2 }, { i: 2 }]);
    expect(() => m.call("B")).toThrow("Undefined API func");
  });
});

describe("netcall.ts CLI", () => {
  it("prints the frame on --dry-run and opens no socket", () => {
    const r = spawnSync(
      tsx,
      [
        join(repoRoot, "scripts", "live", "netcall.ts"),
        "EMCP_WB_Ping",
        "--params",
        '{"k":2}',
        "--dry-run",
      ],
      { encoding: "utf-8" },
    );
    expect(r.status).toBe(0);
    const f = describeFrame("EMCP_WB_Ping", { k: 2 });
    expect(r.stdout).toContain(`frame: ${f.bytes} bytes`);
    expect(r.stdout).toContain(`payload: ${f.payload}`);
    expect(r.stdout).toContain("dry run");
  });

  it("refuses an API that is never called on a live instance", () => {
    const r = spawnSync(
      tsx,
      [join(repoRoot, "scripts", "live", "netcall.ts"), "RunCommandline", "--dry-run"],
      {
        encoding: "utf-8",
      },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("deny list");
  });
});
