/**
 * Regression: terrain_inspect once took `client.call` as a bare reference, so the real
 * WorkbenchClient threw "Cannot read properties of undefined (reading 'claimLease')".
 * The fake client in terrain-legacy.test.ts never touched `this`, so it missed it.
 * This fake is a class instance whose `call` reads a `this` field: an unbound call throws.
 */
import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { registerTerrainInspect } from "../../src/tools/terrain-inspect.js";
import { registerTerrainNavmeshStatus } from "../../src/tools/terrain-navmesh-status.js";
import { registerTerrainRoadExportGraph } from "../../src/tools/terrain-road-export-graph.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: { type: string; text: string }[];
}>;

class ThisReadingClient {
  readonly lease = { claimed: 0 };
  readonly sent: string[] = [];
  async call(api: string, _params: Record<string, unknown> = {}, _opts?: unknown) {
    this.lease.claimed++; // throws "reading 'lease'" when detached
    this.sent.push(api);
    if (api === "EMCP_WB_World") return { status: "ok", worldPath: "$ArmaReforger:worlds/A.ent" };
    return { status: "ok", payload: '{"bounds":{"min":[0,0,0],"max":[10,10,10]}}' };
  }
}

function setup() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (n: string, _m: unknown, h: Handler) => void tools.set(n, h),
  } as unknown as McpServer;
  const client = new ThisReadingClient();
  const wc = client as unknown as WorkbenchClient;
  registerTerrainInspect(server, wc);
  registerTerrainNavmeshStatus(server, wc);
  registerTerrainRoadExportGraph(server, wc);
  return { tools, client };
}

describe("terrain tools keep `this` on client.call", () => {
  it("the fake really throws when call is detached", async () => {
    const { call } = new ThisReadingClient();
    await expect(call("x")).rejects.toThrow();
  });

  it("terrain_inspect answers normally against a this-reading client", async () => {
    const { tools, client } = setup();
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/A.ent" });
    expect(r.content[0].text).not.toContain("Cannot read properties");
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("## terrain_inspect: worlds/A.ent");
    expect(client.sent).toEqual(["EMCP_WB_World", "EMCP_WB_Terrain"]);
    expect(client.lease.claimed).toBe(2);
  });
});
