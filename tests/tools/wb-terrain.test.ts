import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  HANDLER_ACTIONS,
  LEGACY_ACTIONS,
  LEGACY_MAP,
  MAX_POINTS,
  OTHER_TOOL_ACTIONS,
  TERRAIN_CONTRACT,
  checkPoint,
  flatInputShape,
  parseHeightRows,
  prepareRequest,
  runTerrain,
  wbTerrainDescription,
} from "../../src/tools/wb-terrain.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

function fakeClient(
  answer: (p: Record<string, unknown>, n: number) => Record<string, unknown> | Error,
): { client: WorkbenchClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(params, sent.length - 1);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = "no", next = "fix it") => ({
  status: "refused",
  code,
  message,
  next,
});

const INFO = {
  action: "info",
  hasTerrain: 1,
  resolutionX: 2048,
  resolutionY: 2048,
  tilesX: 4,
  tilesY: 4,
  unitScale: 2,
  boundsMin: "0 -50 0",
  boundsMax: "4096 300 4096",
  minY: -12.5,
  maxY: 210,
  landArea: 0,
  surfaces: ["{AAA}Surfaces/Grass.emat", "{BBB}Surfaces/Rock.emat"],
};

describe("wb_terrain contract", () => {
  it("loads, names the three read actions, and every one is a read", () => {
    expect(TERRAIN_CONTRACT.tool).toBe("wb_terrain");
    expect([...HANDLER_ACTIONS].sort()).toEqual(["heights", "info", "tile"]);
    for (const a of TERRAIN_CONTRACT.actions) {
      expect(a.mutating, a.name).toBe(false);
      expect(a.projectOnly, a.name).toBe(false);
    }
  });

  it("declares the 1.x terrain_* tools' actions with their 1.x keys; wb_terrain does not offer them", () => {
    expect([...OTHER_TOOL_ACTIONS].sort()).toEqual([
      "inspect",
      "navmesh_status",
      "road_export_graph",
    ]);
    for (const n of OTHER_TOOL_ACTIONS) {
      const a = TERRAIN_CONTRACT.actions.find((x) => x.name === n);
      expect(a, n).toBeDefined();
      expect(a!.params.map((p) => p.key)).toEqual(["world_path"]);
      expect(HANDLER_ACTIONS).not.toContain(n);
      expect(flatInputShape().action!.safeParse(n).success, n).toBe(false);
    }
    const inspect = TERRAIN_CONTRACT.actions.find((x) => x.name === "inspect")!;
    expect(inspect.response.map((r) => r.key)).toContain("payload");
    expect(wbTerrainDescription()).not.toMatch(/inspect|navmesh|road/);
    expect(prepareRequest({ action: "inspect", world_path: "worlds/A.ent" }).ok).toBe(false);
  });

  it("its description fits the 400-char budget", () => {
    expect(wbTerrainDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("gives registerTool a flat shape with every key and the 1.x names", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "terrainIndex",
      "landArea",
      "minMax",
      "points",
      "tileX",
      "tileY",
      "cursor",
      "limit",
      "x",
      "z",
    ])
      expect(shape[k], k).toBeDefined();
    for (const n of LEGACY_ACTIONS) expect(shape.action!.safeParse(n).success, n).toBe(true);
  });
});

describe("checkPoint", () => {
  it("accepts 'x z' and 'x, z' and normalises them", () => {
    expect(checkPoint("6400 5200")).toEqual({ point: "6400 5200" });
    expect(checkPoint("  12.5,  -3 ")).toEqual({ point: "12.5 -3" });
    expect(checkPoint("1e3 2")).toEqual({ point: "1000 2" });
  });

  it("refuses anything else", () => {
    for (const t of ["", "1", "1 2 3", "a b", "1 NaN", "Infinity 2", "1e12 3", "0x10 2"]) {
      expect(checkPoint(t), t).toHaveProperty("why");
    }
  });
});

describe("prepareRequest (nothing sent on refusal)", () => {
  const refuses = (input: unknown, code: string, text?: RegExp) => {
    const p = prepareRequest(input);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe(code);
      if (text) expect(p.error.message).toMatch(text);
    }
  };

  it("refuses an unknown action", () => {
    refuses(
      { action: "nope" },
      "INVALID_ARGUMENT",
      /one of info, heights, tile, getHeight, getBounds/,
    );
  });

  it("refuses missing and foreign keys per action", () => {
    refuses({ action: "heights" }, "INVALID_ARGUMENT", /points/);
    refuses({ action: "tile", tileX: 0 }, "INVALID_ARGUMENT", /tileY/);
    refuses({ action: "tile", tileY: 0 }, "INVALID_ARGUMENT", /tileX/);
    refuses({ action: "info", points: ["1 2"] }, "INVALID_ARGUMENT");
    refuses({ action: "heights", points: ["1 2"], terrainIndex: 0 }, "INVALID_ARGUMENT");
    refuses({ action: "info", cursor: "0:1" }, "INVALID_ARGUMENT");
  });

  it("refuses negative indices, bad limits and bad cursors", () => {
    refuses({ action: "info", terrainIndex: -1 }, "INVALID_ARGUMENT", /terrainIndex/);
    refuses({ action: "tile", tileX: -1, tileY: 0 }, "INVALID_ARGUMENT", /tileX/);
    refuses({ action: "tile", tileX: 0, tileY: -2 }, "INVALID_ARGUMENT", /tileY/);
    refuses({ action: "tile", tileX: 0, tileY: 0, limit: 0 }, "INVALID_ARGUMENT", /limit/);
    refuses({ action: "tile", tileX: 0, tileY: 0, limit: 201 }, "INVALID_ARGUMENT", /limit/);
    refuses({ action: "tile", tileX: 0, tileY: 0, cursor: "x" }, "INVALID_ARGUMENT", /cursor/);
    refuses({ action: "tile", tileX: 0, tileY: 0, cursor: "9:3" }, "INVALID_ARGUMENT", /cursor/);
  });

  it("refuses zero points, over 200 points and a bad point", () => {
    refuses({ action: "heights", points: [] }, "INVALID_ARGUMENT", /at least one/);
    refuses(
      { action: "heights", points: Array.from({ length: MAX_POINTS + 1 }, () => "1 2") },
      "INVALID_ARGUMENT",
      /at most 200/,
    );
    refuses({ action: "heights", points: ["1 2", "oops"] }, "INVALID_ARGUMENT", /"x z"/);
  });

  it("accepts exactly 200 points and normalises them", () => {
    const p = prepareRequest({
      action: "heights",
      points: Array.from({ length: MAX_POINTS }, (_, i) => `${i}, ${i + 1}`),
    });
    expect(p.ok).toBe(true);
    if (p.ok) expect((p.params.points as string[])[3]).toBe("3 4");
  });
});

describe("runTerrain: handler actions", () => {
  it("info sends the request as a read and shapes the facts", async () => {
    const { client, sent } = fakeClient(() => ok(INFO));
    const r = await runTerrain(client, { action: "info", terrainIndex: 0 });
    expect(sent[0]!.fn).toBe("EMCP_WB_Terrain");
    expect(sent[0]!.params).toEqual({ action: "info", terrainIndex: 0 });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toBe("terrain:0");
      expect(r.changed).toBeNull();
      expect(r.readback).toEqual({
        hasTerrain: true,
        resolution: { x: 2048, y: 2048 },
        tiles: { x: 4, y: 4 },
        unitScale: 2,
        bounds: { min: "0 -50 0", max: "4096 300 4096", sizeX: 4096, sizeZ: 4096 },
        // minMax not asked: the handler did not compute them (review T1)
        minY: null,
        maxY: null,
        landArea: null,
        surfaces: ["{AAA}Surfaces/Grass.emat", "{BBB}Surfaces/Rock.emat"],
      });
    }
  });

  it("info with minMax passes it through, reports minY/maxY, and gets the longer timeout", async () => {
    const { client, sent } = fakeClient(() => ok(INFO));
    const r = await runTerrain(client, { action: "info", minMax: true });
    expect(sent[0]!.params).toEqual({ action: "info", minMax: true });
    expect(sent[0]!.options.timeout).toBeGreaterThan(30_000);
    expect(r.ok && r.readback).toMatchObject({ minY: -12.5, maxY: 210 });
  });

  it("info without minMax gets the short timeout", async () => {
    const { client, sent } = fakeClient(() => ok(INFO));
    await runTerrain(client, { action: "info" });
    expect(sent[0]!.options.timeout).toBe(30_000);
  });

  it("info with landArea passes it through, reports it, and gets the longer timeout", async () => {
    const { client, sent } = fakeClient(() => ok({ ...INFO, landArea: 12345.5 }));
    const r = await runTerrain(client, { action: "info", landArea: true });
    expect(sent[0]!.params).toEqual({ action: "info", landArea: true });
    expect(sent[0]!.options.timeout).toBeGreaterThan(30_000);
    expect(r.ok && r.readback).toMatchObject({ landArea: 12345.5 });
  });

  it("info on a world without terrain answers NO_TERRAIN", async () => {
    const { client } = fakeClient(() =>
      refused("NO_TERRAIN", "the open world has no terrain", "open a world that has a terrain"),
    );
    const r = await runTerrain(client, { action: "info" });
    expect(r).toMatchObject({
      ok: false,
      code: "NO_TERRAIN",
      next: "open a world that has a terrain",
    });
  });

  it("heights sends normalised points and maps rows; an off-terrain y is null, never 0", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ action: "heights", rows: ["100|200|true|31.5", "-5|9|false|0"] }),
    );
    const r = await runTerrain(client, { action: "heights", points: ["100, 200", "-5 9"] });
    expect(sent[0]!.params).toEqual({ action: "heights", points: ["100 200", "-5 9"] });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toEqual({
        points: [
          { x: 100, z: 200, onTerrain: true, y: 31.5 },
          { x: -5, z: 9, onTerrain: false, y: null },
        ],
        onTerrain: 1,
      });
      expect(r.warnings.join(" ")).toContain("off the terrain");
    }
  });

  it("tile pages: first page, cursor, and the next cursor", async () => {
    const first = fakeClient(() =>
      ok({ action: "tile", rows: ["1.5", "2.5"], sampleCount: 5, total: 5, nextCursor: "2:5" }),
    );
    const a = await runTerrain(first.client, { action: "tile", tileX: 1, tileY: 2, limit: 2 });
    expect(first.sent[0]!.params).toEqual({ action: "tile", tileX: 1, tileY: 2, limit: 2 });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.target).toBe("terrain:0/tile:1,2");
      expect(a.readback).toEqual({
        tile: { x: 1, y: 2 },
        sampleCount: 5,
        total: 5,
        first: 0,
        samples: [1.5, 2.5],
        nextCursor: "2:5",
      });
      expect(a.next).toContain("2:5");
    }

    const last = fakeClient(() =>
      ok({ action: "tile", rows: ["9"], sampleCount: 5, total: 5, nextCursor: "" }),
    );
    const b = await runTerrain(last.client, {
      action: "tile",
      tileX: 1,
      tileY: 2,
      cursor: "4:5",
      terrainIndex: 1,
    });
    expect(last.sent[0]!.params).toEqual({
      action: "tile",
      tileX: 1,
      tileY: 2,
      cursor: "4:5",
      terrainIndex: 1,
    });
    expect(b.ok && b.readback).toMatchObject({ first: 4, samples: [9], nextCursor: null });
    expect(b.ok && b.next).toBeFalsy();
  });

  it("a stale cursor and an out-of-range tile come back as the handler's codes", async () => {
    const stale = fakeClient(() => refused("STALE_CURSOR", "the tile changed"));
    expect(
      await runTerrain(stale.client, { action: "tile", tileX: 0, tileY: 0, cursor: "2:5" }),
    ).toMatchObject({
      ok: false,
      code: "STALE_CURSOR",
    });
    const range = fakeClient(() =>
      refused("INVALID_ARGUMENT", "tile 9,9 is outside the 4x4 tiles"),
    );
    expect(await runTerrain(range.client, { action: "tile", tileX: 9, tileY: 9 })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });

  it("a handler error status is ENGINE_FALSE", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "GetTerrainSurfaceTile returned false",
      next: "read the tile counts with wb_terrain info",
    }));
    expect(await runTerrain(client, { action: "tile", tileX: 0, tileY: 0 })).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
    });
  });

  it("maps NO_WORLD and MODULE_NOT_OPEN, and an unknown code to INVALID_ARGUMENT with a warning", async () => {
    for (const code of ["NO_WORLD", "MODULE_NOT_OPEN"]) {
      const { client } = fakeClient(() => refused(code));
      expect(await runTerrain(client, { action: "info" })).toMatchObject({ ok: false, code });
    }
    const { client } = fakeClient(() => refused("WEIRD"));
    const r = await runTerrain(client, { action: "info" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(r.warnings.join(" ")).toContain("WEIRD");
  });

  it("an answer with no status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({}));
    expect(await runTerrain(client, { action: "info" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("keeps LOST, MODAL_OPEN and WEDGED; any other client failure is UNREACHABLE", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client } = fakeClient(() => new WorkbenchError(`boom ${code}`, code));
      expect(await runTerrain(client, { action: "info" })).toMatchObject({ ok: false, code });
    }
    const { client } = fakeClient(() => new WorkbenchError("refused", "CONNECTION_REFUSED"));
    expect(await runTerrain(client, { action: "info" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("sends nothing when the request is refused in TypeScript", async () => {
    const { client, sent } = fakeClient(() => ok());
    expect(await runTerrain(client, { action: "heights", points: [] })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
    expect(sent).toHaveLength(0);
  });
});

describe("1.x action names (OD-6): one test per mapped name", () => {
  it("lists exactly the two 1.x names and neither is a handler action", () => {
    expect([...LEGACY_ACTIONS].sort()).toEqual(["getBounds", "getHeight"]);
    for (const n of LEGACY_ACTIONS) expect(HANDLER_ACTIONS).not.toContain(n);
    expect([...LEGACY_ACTIONS].sort()).toEqual(Object.keys(LEGACY_MAP).sort());
    expect(LEGACY_MAP).toEqual({ getHeight: "heights", getBounds: "info" });
  });

  it("getHeight is a heights read of one point and answers one height", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ action: "heights", rows: ["6400|5200|true|88.25"] }),
    );
    const r = await runTerrain(client, { action: "getHeight", x: 6400, z: 5200 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toEqual({ action: "heights", points: ["6400 5200"] });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("getHeight");
      expect(r.readback).toEqual({ x: 6400, z: 5200, onTerrain: true, height: 88.25 });
      expect(r.warnings[0]).toContain("sent as heights");
    }
  });

  it("getHeight on a point off the terrain has height null, not 0", async () => {
    const { client } = fakeClient(() => ok({ rows: ["-9999|5|false|0"] }));
    const r = await runTerrain(client, { action: "getHeight", x: -9999, z: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toEqual({ x: -9999, z: 5, onTerrain: false, height: null });
      expect(r.next).toContain("off the terrain");
    }
  });

  it("getHeight refuses a missing x or z, a foreign key and a huge value before sending", async () => {
    const { client, sent } = fakeClient(() => ok());
    for (const input of [
      { action: "getHeight" },
      { action: "getHeight", x: 1 },
      { action: "getHeight", z: 1 },
      { action: "getHeight", x: 1, z: 2, terrainIndex: 0 },
      { action: "getHeight", x: 1e12, z: 2 },
    ]) {
      expect(await runTerrain(client, input)).toMatchObject({
        ok: false,
        code: "INVALID_ARGUMENT",
      });
    }
    expect(sent).toHaveLength(0);
  });

  it("getHeight with a fractional or tiny coordinate sends plain decimal text, never an exponent", async () => {
    const { client, sent } = fakeClient(() => ok({ rows: ["0|0|true|1"] }));
    await runTerrain(client, { action: "getHeight", x: 1e-7, z: -12.5 });
    expect(sent[0]!.params).toEqual({ action: "heights", points: ["0 -12.5"] });
  });

  it("getHeight passes a handler refusal through under the 1.x name", async () => {
    const { client } = fakeClient(() => refused("NO_TERRAIN"));
    expect(await runTerrain(client, { action: "getHeight", x: 1, z: 2 })).toMatchObject({
      ok: false,
      action: "getHeight",
      code: "NO_TERRAIN",
    });
  });

  it("getBounds is an info read and answers the bounds with their size", async () => {
    const { client, sent } = fakeClient(() => ok(INFO));
    const r = await runTerrain(client, { action: "getBounds" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toEqual({ action: "info" });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("getBounds");
      expect(r.readback).toMatchObject({
        bounds: { min: "0 -50 0", max: "4096 300 4096", sizeX: 4096, sizeZ: 4096 },
      });
      expect(r.warnings[0]).toContain("sent as info");
    }
  });

  it("getBounds refuses extra keys and passes NO_TERRAIN through under the 1.x name", async () => {
    const none = fakeClient(() => ok());
    expect(await runTerrain(none.client, { action: "getBounds", x: 1 })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
    expect(none.sent).toHaveLength(0);
    const { client } = fakeClient(() => refused("NO_TERRAIN"));
    expect(await runTerrain(client, { action: "getBounds" })).toMatchObject({
      ok: false,
      action: "getBounds",
      code: "NO_TERRAIN",
    });
  });
});

describe("parseHeightRows", () => {
  it("reads rows and nulls y off the terrain", () => {
    expect(parseHeightRows(["1|2|true|3", "4|5|false|0"])).toEqual([
      { x: 1, z: 2, onTerrain: true, y: 3 },
      { x: 4, z: 5, onTerrain: false, y: null },
    ]);
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:mcp:action/wb_terrain.getBounds
// census:mcp:action/wb_terrain.getHeight
// census:mcp:action/wb_terrain.heights
// census:mcp:action/wb_terrain.info
// census:mcp:action/wb_terrain.tile
// census:mcp:handler-action/EMCP_WB_Terrain.heights
// census:mcp:handler-action/EMCP_WB_Terrain.info
// census:mcp:handler-action/EMCP_WB_Terrain.tile
