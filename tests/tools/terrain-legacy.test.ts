/**
 * The 1.x extended terrain tool terrain_inspect keeps working against the W1 EMCP_WB_Terrain handler:
 * the handler dispatches its action with the 1.x keys (world_path in, payload out), and the tool
 * turns the answer into the 1.x result. terrain_road_export_graph is a TypeScript composition of
 * wb_generator list and wb_shape points since W7 (OD-10) and no longer calls the handler. terrain_navmesh_status is an alias of wb_navmesh status since W5 (DEC-068 OD-1); the
 * handler's navmesh_status branch stays as a refusal.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { regVKeys } from "../../src/manifest/contract.js";
import { registerTerrainInspect } from "../../src/tools/terrain-inspect.js";
import { registerTerrainNavmeshStatus } from "../../src/tools/terrain-navmesh-status.js";
import {
  buildGraph,
  parsePoint,
  registerTerrainRoadExportGraph,
  sameWorld,
} from "../../src/tools/terrain-road-export-graph.js";
import { WorkbenchError } from "../../src/workbench/client.js";

type Handler = (a: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

const HANDLER_SOURCE = readFileSync(
  new URL("../../mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c", import.meta.url),
  "utf8",
);

/** What the handler answers for navmesh_status and road_export_graph (EMCP_WB_Terrain.NotImplemented). */
const notImplemented = (action: string) => ({
  status: "error",
  message: `not implemented: action '${action}' is planned for L7 but not yet implemented in the Workbench handler. See docs/L7-PLAN.md.`,
});

/** What EMCP_WB_World state answers by default: worlds/A.ent is open. */
const OPEN_A = { status: "ok", worldPath: "$ArmaReforger:worlds/A.ent" };

function setup(answer: Record<string, unknown>, worldState: Record<string, unknown> = OPEN_A) {
  const tools = new Map<string, Handler>();
  const sent: { api: string; params: Record<string, unknown> }[] = [];
  const server = {
    registerTool: (n: string, _m: unknown, h: Handler) => void tools.set(n, h),
  } as unknown as McpServer;
  const client = {
    async call(api: string, params: Record<string, unknown> = {}) {
      sent.push({ api, params });
      return api === "EMCP_WB_World" ? worldState : answer;
    },
  } as unknown as WorkbenchClient;
  registerTerrainInspect(server, client);
  registerTerrainNavmeshStatus(server, client);
  registerTerrainRoadExportGraph(server, client);
  return { tools, sent };
}

describe("EMCP_WB_Terrain keeps the 1.x terrain_* actions", () => {
  it("dispatches inspect, navmesh_status and road_export_graph", () => {
    for (const a of ["inspect", "navmesh_status", "road_export_graph"]) {
      expect(HANDLER_SOURCE, a).toContain(`req.action == "${a}"`);
    }
  });

  it("registers world_path in the request and payload in the response", () => {
    expect(regVKeys(HANDLER_SOURCE, "EMCP_WB_TerrainRequest")).toContain("world_path");
    expect(regVKeys(HANDLER_SOURCE, "EMCP_WB_TerrainResponse")).toContain("payload");
  });

  it("inspect answers the open world it read (open_world), home-scrubbed", () => {
    const body = HANDLER_SOURCE.slice(HANDLER_SOURCE.indexOf("static void Inspect("));
    const end = body.indexOf("resp.payload = json;");
    const inspect = body.slice(0, end);
    expect(inspect).toContain("api.GetWorldPath(openWorld)");
    expect(inspect).toContain('\\"open_world\\":');
    expect(inspect).toContain("EMCP_WB_Guard.ScrubHome(openWorld)");
  });

  it("answers the placeholders with status error and a message starting 'not implemented'", () => {
    expect(HANDLER_SOURCE).toContain('resp.message = "not implemented: action \'" + req.action');
  });
});

describe("terrain_inspect works", () => {
  it("sends inspect with world_path and formats the payload", async () => {
    const { tools, sent } = setup({
      status: "ok",
      message: "Terrain inspect complete",
      payload: '{"bounds":{"min":[0,-50,0],"max":[4096,300,4096]},"world_path":"worlds/A.ent"}',
    });
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/A.ent" });
    expect(sent).toEqual([
      { api: "EMCP_WB_World", params: { action: "state" } },
      { api: "EMCP_WB_Terrain", params: { action: "inspect", world_path: "worlds/A.ent" } },
    ]);
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("## terrain_inspect: worlds/A.ent");
    expect(r.content[0].text).toContain("**Open world:** $ArmaReforger:worlds/A.ent");
    expect(r.content[0].text).toContain('**Bounds:** {"min":[0,-50,0],"max":[4096,300,4096]}');
  });

  it("refuses a world_path that is not the open world, without calling inspect", async () => {
    const { tools, sent } = setup({ status: "ok", payload: '{"bounds":null}' });
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/B.ent" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(
      "the open world is $ArmaReforger:worlds/A.ent, not worlds/B.ent",
    );
    expect(sent.map((s) => s.api)).toEqual(["EMCP_WB_World"]);
  });

  it("refuses when no world is open", async () => {
    const { tools } = setup({ status: "ok", payload: "{}" }, { status: "ok", worldPath: "" });
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/A.ent" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no world is open");
  });

  it("passes the handler's refusal message through (it sets message, not error)", async () => {
    const { tools } = setup({ status: "error", message: "WorldEditor module not available" });
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/A.ent" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("EMCP handler returned error: WorldEditor module not available");
  });

  it("refuses when the handler read a different world than world_path (opened meanwhile)", async () => {
    const { tools } = setup({
      status: "ok",
      payload:
        '{"bounds":null,"world_path":"worlds/A.ent","open_world":"$ArmaReforger:worlds/B.ent"}',
    });
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/A.ent" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("read from $ArmaReforger:worlds/B.ent, not worlds/A.ent");
  });

  it("shows the handler's open_world when it matches", async () => {
    const { tools } = setup({
      status: "ok",
      payload: '{"bounds":null,"world_path":"worlds/A.ent","open_world":"$MyMod:worlds/A.ent"}',
    });
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/A.ent" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("**Open world:** $MyMod:worlds/A.ent");
  });

  it("says so when the open world has no terrain", async () => {
    const { tools } = setup({
      status: "ok",
      payload: '{"bounds":null,"world_path":"worlds/A.ent"}',
    });
    const r = await tools.get("terrain_inspect")!({ world_path: "worlds/A.ent" });
    expect(r.content[0].text).toContain("none (the open world has no terrain)");
  });
});

describe("terrain_navmesh_status is an alias of wb_navmesh status (W5 OD-1)", () => {
  it("sends EMCP_WB_Navmesh status for the open world", async () => {
    const { tools, sent } = setup({
      status: "ok",
      code: "",
      message: "status",
      action: "status",
      rows: [],
      total: 0,
      count: 0,
    });
    await tools.get("terrain_navmesh_status")!({});
    expect(sent[0].api).toBe("EMCP_WB_Navmesh");
    expect(sent[0].params).toMatchObject({ action: "status" });
    expect(sent[0].params).not.toHaveProperty("world_path");
  });

  it("refuses world_path (no equivalent) and sends nothing", async () => {
    const { tools, sent } = setup(notImplemented("navmesh_status"));
    const r = await tools.get("terrain_navmesh_status")!({ world_path: "worlds/A.ent" });
    expect(sent).toEqual([]);
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0].text) as { code: string; message: string };
    expect(body.code).toBe("INVALID_ARGUMENT");
    expect(body.message).toContain("world_path has no equivalent");
  });
});

describe("terrain_road_export_graph is a composition of wb_generator list and wb_shape points (W7 OD-10)", () => {
  const WORLD = "$Proj:worlds/A.ent";
  const SHAPE_A = "id:0x00000000000000a1";
  const SHAPE_B = "id:0x00000000000000b1";
  const ROAD = "RoadGeneratorEntity";

  type Route = (api: string, p: Record<string, unknown>) => Record<string, unknown> | Error;

  /** A client whose answer depends on the handler called; records every call. */
  function setupRoads(route: Route) {
    const sent: { api: string; params: Record<string, unknown> }[] = [];
    let handler: Handler | undefined;
    const server = {
      registerTool: (n: string, _m: unknown, h: Handler) => {
        if (n === "terrain_road_export_graph") handler = h;
      },
    } as unknown as McpServer;
    const client = {
      async call(api: string, params: Record<string, unknown> = {}) {
        sent.push({ api, params });
        const a = route(api, params);
        if (a instanceof Error) throw a;
        return a;
      },
    } as unknown as WorkbenchClient;
    registerTerrainRoadExportGraph(server, client);
    return { run: handler!, sent };
  }

  const world = { status: "ok", worldPath: WORLD };
  const points = (rows: string[], closed = false, nextCursor = "") => ({
    status: "ok",
    id: SHAPE_A,
    className: "PolylineShapeEntity",
    closed: closed ? 1 : 0,
    total: rows.length,
    points: rows,
    nextCursor,
  });
  const list = (rows: string[], nextCursor = "") => ({
    status: "ok",
    rows,
    total: rows.length,
    eventsEnabled: 1,
    nextCursor,
  });

  /** Two roads that meet at (10, 0, 0). */
  const twoRoads: Route = (api, p) => {
    if (api === "EMCP_WB_World") return world;
    if (api === "EMCP_WB_Generator") {
      return list([
        `id:0x1|${ROAD}|{AAAAAAAAAAAAAAAA}Prefabs/Road.et|${SHAPE_A}`,
        `id:0x2|ForestGeneratorEntity|{BBBBBBBBBBBBBBBB}Prefabs/Forest.et|${SHAPE_A}`,
        `id:0x3|${ROAD}|{AAAAAAAAAAAAAAAA}Prefabs/Road.et|${SHAPE_B}`,
      ]);
    }
    if (api === "EMCP_WB_Shape") {
      return p.entity === SHAPE_A
        ? points(["0 0 0", "5 0 0", "10 0 0"])
        : points(["10 0.4 0.3", "10 0 20"]);
    }
    return new Error(`unexpected ${api}`);
  };

  const body = (r: { content: { text: string }[] }) => {
    const m = /```json\n([\s\S]*?)\n```/.exec(r.content[0].text);
    return JSON.parse(m![1]) as {
      roads: { id: string; shape: string; closed: boolean; points: number }[];
      nodes: { id: string; x: number; y: number; z: number }[];
      edges: { from: string; to: string; road: string; length: number }[];
    };
  };

  it("no longer calls EMCP_WB_Terrain and no longer answers 'not implemented'", async () => {
    const { run, sent } = setupRoads(twoRoads);
    const r = await run({ world_path: "worlds/A.ent", format: "json" });
    expect(sent.map((s) => s.api)).not.toContain("EMCP_WB_Terrain");
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).not.toContain("not yet implemented");
  });

  it("lists generators, keeps the road ones, reads each shape once, tessellated", async () => {
    const { run, sent } = setupRoads(twoRoads);
    await run({ format: "json" });
    expect(sent[0]).toEqual({ api: "EMCP_WB_World", params: { action: "state" } });
    expect(sent[1]).toEqual({ api: "EMCP_WB_Generator", params: { action: "list", limit: 200 } });
    const shapeCalls = sent.filter((s) => s.api === "EMCP_WB_Shape");
    expect(shapeCalls.map((s) => s.params)).toEqual([
      { action: "points", entity: SHAPE_A, tesselated: true },
      { action: "points", entity: SHAPE_B, tesselated: true },
    ]);
  });

  it("builds nodes (points within 1 m merge) and edges with lengths", async () => {
    const { run } = setupRoads(twoRoads);
    const g = body(await run({ world_path: "worlds/A.ent", format: "json" }));
    expect(g.roads.map((r) => r.id)).toEqual(["id:0x1", "id:0x3"]);
    // A: (0,0,0) (5,0,0) (10,0,0); B: (10,0.4,0.3) merges into A's last node, then (10,0,20).
    expect(g.nodes.map((n) => [n.x, n.y, n.z])).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
      [10, 0, 20],
    ]);
    expect(g.edges).toEqual([
      { from: "n0", to: "n1", road: "id:0x1", length: 5 },
      { from: "n1", to: "n2", road: "id:0x1", length: 5 },
      { from: "n2", to: "n3", road: "id:0x3", length: 19.704 },
    ]);
  });

  it("renders mermaid edges with their lengths", async () => {
    const { run } = setupRoads(twoRoads);
    const r = await run({ format: "mermaid" });
    expect(r.content[0].text).toContain("graph LR");
    expect(r.content[0].text).toContain("n0 -->|5m| n1");
    expect(r.content[0].text).toContain("Roads: 2, Nodes: 4, Edges: 3");
  });

  it("says no width is read", async () => {
    const { run } = setupRoads(twoRoads);
    const r = await run({ format: "json" });
    expect(r.content[0].text).toContain("road width is not read");
  });

  it("closes a closed shape and reads a shape shared by two road generators once", async () => {
    const { run, sent } = setupRoads((api) => {
      if (api === "EMCP_WB_World") return world;
      if (api === "EMCP_WB_Generator") {
        return list([`id:0x1|${ROAD}||${SHAPE_A}`, `id:0x2|${ROAD}||${SHAPE_A}`]);
      }
      return points(["0 0 0", "10 0 0", "10 0 10"], true);
    });
    const g = body(await run({ format: "json" }));
    expect(sent.filter((s) => s.api === "EMCP_WB_Shape")).toHaveLength(1);
    expect(g.roads).toHaveLength(1);
    expect(g.roads[0].closed).toBe(true);
    expect(g.edges).toHaveLength(3);
    expect(g.edges[2]).toMatchObject({ from: "n2", to: "n0" });
  });

  it("follows the pages of the generator list and of the shape points", async () => {
    const { run, sent } = setupRoads((api, p) => {
      if (api === "EMCP_WB_World") return world;
      if (api === "EMCP_WB_Generator") {
        return p.cursor === "1:2"
          ? { ...list([`id:0x2|${ROAD}||${SHAPE_B}`]), total: 2 }
          : { ...list([`id:0x1|${ROAD}||${SHAPE_A}`]), total: 2, nextCursor: "1:2" };
      }
      return p.cursor === "2:4"
        ? { ...points(["20 0 0", "30 0 0"]), total: 4 }
        : { ...points(["0 0 0", "10 0 0"]), total: 4, nextCursor: "2:4" };
    });
    const g = body(await run({ format: "json" }));
    expect(sent.filter((s) => s.api === "EMCP_WB_Generator").map((s) => s.params.cursor)).toEqual([
      undefined,
      "1:2",
    ]);
    expect(g.roads).toHaveLength(2);
    expect(g.roads[0].points).toBe(4);
  });

  it("an empty world gives an empty graph with a note", async () => {
    const { run } = setupRoads((api) => (api === "EMCP_WB_World" ? world : list([])));
    const r = await run({ format: "json" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("Roads: 0, Nodes: 0, Edges: 0");
    expect(r.content[0].text).toContain("no road generators");
  });

  it("skips a road with no parent shape or a parent that is not a shape, with a note", async () => {
    const { run } = setupRoads((api, p) => {
      if (api === "EMCP_WB_World") return world;
      if (api === "EMCP_WB_Generator") {
        return list([
          `id:0x1|${ROAD}||`,
          `id:0x2|${ROAD}||${SHAPE_B}`,
          `id:0x3|${ROAD}||${SHAPE_A}`,
        ]);
      }
      return p.entity === SHAPE_B
        ? { status: "refused", code: "NOT_A_SHAPE", message: "not a shape", next: "" }
        : points(["0 0 0", "3 0 4"]);
    });
    const r = await run({ format: "json" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("id:0x1 (RoadGeneratorEntity) has no parent shape");
    expect(r.content[0].text).toContain("NOT_A_SHAPE");
    expect(body(r).edges).toEqual([{ from: "n0", to: "n1", road: "id:0x3", length: 5 }]);
  });

  it("accepts a world_path that names the open world, in either form, and refuses another", async () => {
    for (const wp of [
      "worlds/A.ent",
      "worlds\\A.ent",
      "$Proj:worlds/A.ent",
      "{0123456789ABCDEF}worlds/A.ent",
    ]) {
      const { run } = setupRoads(twoRoads);
      expect((await run({ world_path: wp, format: "json" })).isError, wp).toBeUndefined();
    }
    const { run, sent } = setupRoads(twoRoads);
    const r = await run({ world_path: "worlds/B.ent", format: "json" });
    expect(r.isError).toBe(true);
    const e = JSON.parse(r.content[0].text) as { code: string; message: string };
    expect(e.code).toBe("INVALID_ARGUMENT");
    expect(e.message).toContain("worlds/B.ent");
    expect(sent.map((s) => s.api)).toEqual(["EMCP_WB_World"]);
  });

  it("refuses a world_path that starts with '-' before sending anything", async () => {
    const { run, sent } = setupRoads(twoRoads);
    const r = await run({ world_path: "-rf", format: "json" });
    expect(r.isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it("answers NO_WORLD when no world is open", async () => {
    const { run, sent } = setupRoads(() => ({ status: "ok", worldPath: "" }));
    const r = await run({ format: "json" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).code).toBe("NO_WORLD");
    expect(sent).toHaveLength(1);
  });

  it("maps a handler refusal of the list, a lost call and a modal", async () => {
    let { run } = setupRoads((api) =>
      api === "EMCP_WB_World"
        ? world
        : { status: "error", code: "NO_WORLD", message: "m", next: "open one" },
    );
    let r = await run({ format: "json" });
    expect(JSON.parse(r.content[0].text)).toMatchObject({
      ok: false,
      code: "NO_WORLD",
      next: "open one",
    });

    ({ run } = setupRoads((api) =>
      api === "EMCP_WB_World" ? world : new WorkbenchError("gone", "LOST"),
    ));
    r = await run({ format: "json" });
    expect(JSON.parse(r.content[0].text).code).toBe("LOST");

    ({ run } = setupRoads(() => new WorkbenchError("modal", "MODAL_OPEN")));
    r = await run({ format: "json" });
    expect(JSON.parse(r.content[0].text).code).toBe("MODAL_OPEN");
  });

  it("maps a refusal of the shape read other than NOT_A_SHAPE as an error", async () => {
    const { run } = setupRoads((api) => {
      if (api === "EMCP_WB_World") return world;
      if (api === "EMCP_WB_Generator") return list([`id:0x1|${ROAD}||${SHAPE_A}`]);
      return { status: "error", code: "NO_WORLD", message: "closed meanwhile", next: "" };
    });
    const r = await run({ format: "json" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).code).toBe("NO_WORLD");
  });

  it("retries the list once from the start on STALE_CURSOR", async () => {
    let n = 0;
    const { run, sent } = setupRoads((api) => {
      if (api === "EMCP_WB_World") return world;
      if (api === "EMCP_WB_Generator") {
        n++;
        if (n === 1)
          return { ...list([`id:0x1|${ROAD}||${SHAPE_A}`]), total: 2, nextCursor: "1:2" };
        if (n === 2) return { status: "error", code: "STALE_CURSOR", message: "moved", next: "" };
        return list([`id:0x1|${ROAD}||${SHAPE_A}`]);
      }
      return points(["0 0 0", "1 0 0"]);
    });
    const r = await run({ format: "json" });
    expect(r.isError).toBeUndefined();
    expect(sent.filter((s) => s.api === "EMCP_WB_Generator")).toHaveLength(3);
  });
});

describe("road graph helpers", () => {
  it("buildGraph merges points inside the tolerance across cube cells and drops zero-length edges", () => {
    const meta = (id: string) => ({
      id,
      shape: "s",
      className: "RoadGeneratorEntity",
      prefab: "",
      closed: false,
      points: 0,
    });
    const g = buildGraph(
      [
        {
          meta: meta("a"),
          points: [
            [0.9, 0, 0],
            [0.95, 0, 0],
            [5, 0, 0],
          ],
        },
        {
          meta: meta("b"),
          points: [
            [1.4, 0, 0],
            [9, 0, 0],
          ],
        },
      ],
      1,
    );
    // 0.9 and 0.95 merge (no edge); 1.4 is 0.5 m from the first node, in another cube, and merges too.
    expect(g.nodes).toHaveLength(3);
    expect(g.edges.map((e) => `${e.road}:${e.from}>${e.to}`)).toEqual(["a:n0>n1", "b:n0>n2"]);
  });

  it("parsePoint and sameWorld", () => {
    expect(parsePoint("1 2.5 -3")).toEqual([1, 2.5, -3]);
    expect(parsePoint("1 2")).toBeUndefined();
    expect(parsePoint("a b c")).toBeUndefined();
    expect(sameWorld("$P:worlds/A/Main.ent", "A/Main.ent")).toBe(true);
    expect(sameWorld("$P:worlds/A.ent", "worlds/B.ent")).toBe(false);
  });
});
