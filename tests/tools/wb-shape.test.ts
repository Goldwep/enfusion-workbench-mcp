import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import {
  EDIT_OPEN,
  EDIT_OPS,
  HANDLER,
  PARALLEL_OPEN,
  applyEditPlan,
  editRangeProblem,
  planEdit,
  type EditOp,
  type EditStep,
  SHAPE_CONTRACT,
  TERRAIN_HANDLER,
  VIEW_HANDLER,
  WB_SHAPE_DESCRIPTION,
  num,
  prepareRequest,
  runShape,
  truthy,
} from "../../src/tools/wb-shape.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { circlePoints } from "../../src/formats/shape-area.js";
import {
  writeDbf,
  writeShp,
  writeShx,
  type DbfFile,
  type ShpFile,
  type ShpRecord,
} from "../../src/formats/shapefile.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

type Answer = (
  fn: string,
  p: Record<string, unknown>,
  n: number,
) => Record<string, unknown> | Error;

/** A client whose call() answers from a function and records what was sent. */
function fakeClient(answer: Answer): { client: WorkbenchClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(fn, params, sent.length - 1);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const A = "id:0x00000000000000aa";
const created = (n: number) =>
  ok({
    id: `id:0x00000000000000${(n + 16).toString(16)}`,
    className: "PolylineShapeEntity",
    total: 0,
    undoName: "EMCP wb_shape create",
  });

/** Terrain answers: y = x + z on the terrain, except x < 0 (off it). */
function heightsOf(p: Record<string, unknown>) {
  const rows = (p.points as string[]).map((s) => {
    const [x, z] = s.split(" ").map(Number);
    return x < 0 ? `${x}|${z}|false|0` : `${x}|${z}|true|${x + z}`;
  });
  return ok({ rows });
}

describe("wb_shape contract", () => {
  it("loads, and its description fits the 400-char budget", () => {
    expect(SHAPE_CONTRACT.tool).toBe("wb_shape");
    expect(SHAPE_CONTRACT.handler).toBe(HANDLER);
    expect(WB_SHAPE_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(SHAPE_CONTRACT.actions.map((a) => a.name)).toEqual([
      "points",
      "create",
      "area",
      "import",
      "parallel",
      "edit",
    ]);
  });

  it("parallel is gated by default and NOT_A_SHAPE is carried locally", () => {
    expect(PARALLEL_OPEN).toBe(false);
    expect(ERROR_CODES.NOT_A_SHAPE).toMatch(/ShapeEntity/);
  });

  it("helpers: truthy and num", () => {
    expect([true, 1, "1", "true"].every(truthy)).toBe(true);
    expect([false, 0, "0", "false", undefined].some(truthy)).toBe(false);
    expect(num(-0)).toBe("0");
    expect(num(1e-7)).toBe("0");
    expect(num(1.23456789)).toBe("1.234568");
    expect(num(3.0000000000000004e-16)).toBe("0");
  });
});

describe("prepareRequest refuses before sending", () => {
  const refuse = (input: unknown, re: RegExp, code = "INVALID_ARGUMENT") => {
    const p = prepareRequest(input);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe(code);
      expect(p.error.message).toMatch(re);
    }
  };

  it("bad shapes of input", () => {
    refuse({ action: "nope" }, /action/);
    refuse({ action: "points" }, /entity/);
    refuse({ action: "points", entity: A, bogus: 1 }, /bogus|Unrecognized/);
    refuse({ action: "points", entity: "garbage" }, /entity/);
    refuse({ action: "points", entity: A, cursor: "x" }, /cursor/);
    refuse({ action: "points", entity: A, cursor: "5:2" }, /cursor/);
    refuse({ action: "points", entity: A, limit: 201 }, /limit/);
  });

  it("create: point count, vectors, closed, color, parent", () => {
    refuse({ action: "create", points: ["0 0 0"] }, /2 to 2000/);
    refuse({ action: "create", points: Array(2001).fill("0 0 0") }, /2 to 2000/);
    refuse({ action: "create", points: ["0 0 0", "1 2"] }, /points\[1\]/);
    refuse({ action: "create", points: ["0 0 0", "1 2 x"] }, /points\[1\]/);
    refuse({ action: "create", points: ["0 0 0", "1 2 3"], closed: true }, /at least 3/);
    refuse({ action: "create", points: ["0 0 0", "1 2 3"], color: "1 0 0" }, /color/);
    refuse({ action: "create", points: ["0 0 0", "1 2 3"], color: "1 0 0 2" }, /color/);
    refuse({ action: "create", points: ["0 0 0", "1 2 3"], parent: "nope" }, /parent/);
  });

  it("area: shape, sizes, counts, centre", () => {
    refuse({ action: "area", shape: "hexagon", width: 5 }, /shape/);
    refuse({ action: "area", shape: "circle", width: 0 }, /width/);
    refuse({ action: "area", shape: "circle", width: 5, segments: 2 }, /segments/);
    refuse({ action: "area", shape: "circle", width: 5, segments: 2001 }, /2001 points/);
    refuse({ action: "area", shape: "rectangle", width: 5, segments: 501 }, /2004 points/);
    refuse({ action: "area", shape: "star", width: 5, innerRatio: 2 }, /innerRatio/);
    refuse({ action: "area", shape: "circle", width: 5, centre: "1 2" }, /centre/);
  });

  it("import: path, extension, offset, paging", () => {
    refuse({ action: "import", path: "C:/x/a.shp" }, /absolute/, "ABSOLUTE_PATH");
    refuse({ action: "import", path: "../a.shp" }, /\.\./, "ABSOLUTE_PATH");
    refuse({ action: "import", path: "data/a.dbf" }, /\.shp/);
    refuse({ action: "import", path: "a.shp", offset: "1 2" }, /offset/);
    refuse({ action: "import", path: "a.shp", limit: 0 }, /limit/);
    refuse({ action: "import", path: "a.shp", color: "red" }, /color/);
  });

  it("parallel answers GATED with its reason while the switch is off", () => {
    refuse({ action: "parallel", entity: A, offsets: ["5"] }, /P-W6-16/, "GATED");
  });

  it("parallel with the switch on: offsets and minDistance", () => {
    const open = { parallelOpen: true };
    const p0 = prepareRequest({ action: "parallel", entity: A, offsets: [] }, open);
    expect(!p0.ok && p0.error.message).toMatch(/1 to 16/);
    const p1 = prepareRequest(
      { action: "parallel", entity: A, offsets: Array(17).fill("1") },
      open,
    );
    expect(!p1.ok && p1.error.message).toMatch(/1 to 16/);
    const p2 = prepareRequest({ action: "parallel", entity: A, offsets: ["5", "x"] }, open);
    expect(!p2.ok && p2.error.message).toMatch(/offsets\[1\]/);
    const p3 = prepareRequest(
      { action: "parallel", entity: A, offsets: ["1"], minDistance: -1 },
      open,
    );
    expect(!p3.ok && p3.error.message).toMatch(/minDistance/);
    const p4 = prepareRequest(
      { action: "parallel", entity: A, offsets: [" 5 ", "-2.5"], minDistance: 2 },
      open,
    );
    expect(p4.ok && p4.params).toMatchObject({ offsets: ["5", "-2.5"], minDistance: "2" });
  });
});

describe("points", () => {
  it("sends a read with the canonical ref and maps the page", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        id: A,
        className: "SplineShapeEntity",
        closed: 1,
        total: 3,
        nextCursor: "2:3",
        points: ["1 2 3", "4 5 6"],
      }),
    );
    const res = await runShape(client, { action: "points", entity: "id:0xAA", limit: 2 });
    expect(sent[0].fn).toBe(HANDLER);
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({ action: "points", entity: A, limit: 2 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.target).toBe(`entity:${A}`);
      expect(res.readback).toEqual({
        id: A,
        className: "SplineShapeEntity",
        closed: true,
        total: 3,
        points: ["1 2 3", "4 5 6"],
        nextCursor: "2:3",
      });
      expect(res.next).toMatch(/2:3/);
    }
  });

  it("the last page has no cursor; a changed total is STALE_CURSOR", async () => {
    const { client } = fakeClient(() => ok({ id: A, closed: 0, total: 3, points: ["1 2 3"] }));
    const last = await runShape(client, { action: "points", entity: A, cursor: "2:3" });
    expect(last.ok && (last.readback as { nextCursor: unknown }).nextCursor).toBeNull();
    const stale = await runShape(client, { action: "points", entity: A, cursor: "2:5" });
    expect(!stale.ok && stale.code).toBe("STALE_CURSOR");
  });

  it("maps a handler NOT_A_SHAPE refusal with the local next step", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NOT_A_SHAPE",
      message: "the entity is a GenericEntity",
    }));
    const res = await runShape(client, { action: "points", entity: A });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("NOT_A_SHAPE");
      expect(res.next).toBe(ERROR_CODES.NOT_A_SHAPE);
    }
  });

  it.each(["LOST", "MODAL_OPEN", "WEDGED", "TIMEOUT"] as const)(
    "maps WorkbenchError %s",
    async (code) => {
      const { client } = fakeClient(() => new WorkbenchError("x", code));
      const res = await runShape(client, { action: "points", entity: A });
      expect(!res.ok && res.code).toBe(code);
      if (!res.ok) expect(res.next.length).toBeGreaterThan(0);
    },
  );
});

describe("create", () => {
  it("sends a mutate and maps the created shape", async () => {
    const { client, sent } = fakeClient(() => created(1));
    const res = await runShape(client, {
      action: "create",
      points: ["0 0 0", "1,2,3", "4 5 6"],
      closed: true,
      spline: false,
      color: "1 0 0 1",
      parent: "id:0xaa",
      layer: "default",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toMatchObject({
      action: "create",
      parent: A,
      closed: true,
      color: "1 0 0 1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([
        { path: "id:0x0000000000000011", before: null, after: "PolylineShapeEntity" },
      ]);
      expect(res.readback).toMatchObject({
        className: "PolylineShapeEntity",
        undoName: "EMCP wb_shape create",
      });
      expect(res.next).toMatch(/wb_undo_redo/);
    }
  });

  it("keeps what an ENGINE_FALSE answer filled before it failed", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "created, but 1 of 2 points read back",
      next: "read it with wb_shape points",
      id: A,
      className: "PolylineShapeEntity",
      undoName: "EMCP wb_shape create",
    }));
    const res = await runShape(client, { action: "create", points: ["0 0 0", "1 1 1"] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.next).toBe("read it with wb_shape points");
      expect(res.readback).toEqual({
        id: A,
        className: "PolylineShapeEntity",
        undoName: "EMCP wb_shape create",
      });
    }
  });

  it("a NOT_IN_PROJECT refusal passes through", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NOT_IN_PROJECT",
      message: "no project",
    }));
    const res = await runShape(client, { action: "create", points: ["0 0 0", "1 1 1"] });
    expect(!res.ok && res.code).toBe("NOT_IN_PROJECT");
  });
});

describe("parallel (switch on)", () => {
  it("sends offsets and minDistance as text and maps the copies", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ created: 2, ids: [A, "id:0x00000000000000bb"], undoName: "EMCP wb_shape parallel" }),
    );
    const res = await runShape(
      client,
      { action: "parallel", entity: A, offsets: ["5", "-5"], minDistance: 1.5, asChild: true },
      { parallelOpen: true },
    );
    expect(sent[0].params).toEqual({
      action: "parallel",
      entity: A,
      offsets: ["5", "-5"],
      minDistance: "1.5",
      asChild: true,
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(res.ok && res.readback).toEqual({
      created: 2,
      ids: [A, "id:0x00000000000000bb"],
      undoName: "EMCP wb_shape parallel",
    });
    expect(res.ok && res.changed).toHaveLength(2);
  });

  it("sends nothing while gated", async () => {
    const { client, sent } = fakeClient(() => ok());
    const res = await runShape(client, { action: "parallel", entity: A, offsets: ["5"] });
    expect(!res.ok && res.code).toBe("GATED");
    expect(sent).toHaveLength(0);
  });
});

describe("area", () => {
  it("a given centre: one create with the outline moved there, closed by default", async () => {
    const { client, sent } = fakeClient(() => created(2));
    const res = await runShape(client, {
      action: "area",
      shape: "circle",
      width: 10,
      segments: 4,
      centre: "100 5 200",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe(HANDLER);
    expect(sent[0].params).toEqual({
      action: "create",
      points: ["100 5 205", "105 5 200", "100 5 195", "95 5 200"],
      closed: true,
      spline: false,
    });
    expect(res.ok && res.readback).toMatchObject({
      shape: "circle",
      centre: "100 5 200",
      centreFrom: "given",
      pointCount: 4,
      segments: 4,
    });
  });

  it("no centre: camera, then the screen-centre trace with WORLD, then create", async () => {
    const { client, sent } = fakeClient((fn, p) => {
      if (fn === VIEW_HANDLER && p.action === "camera")
        return ok({ screenWidth: 1001, screenHeight: 600 });
      if (fn === VIEW_HANDLER && p.action === "trace") return ok({ hit: 1, end: "10 2 20" });
      return created(3);
    });
    const res = await runShape(client, {
      action: "area",
      shape: "rectangle",
      width: 4,
      length: 2,
      closed: false,
      spline: true,
      layer: "L",
    });
    expect(sent.map((s) => `${s.fn}:${s.params.action}`)).toEqual([
      `${VIEW_HANDLER}:camera`,
      `${VIEW_HANDLER}:trace`,
      `${HANDLER}:create`,
    ]);
    expect(sent[0].options.access).toBe("read");
    expect(sent[1].params).toEqual({ action: "trace", x: 500, y: 300, flags: "WORLD" });
    expect(sent[2].params).toEqual({
      action: "create",
      points: ["12 2 21", "12 2 19", "8 2 19", "8 2 21"],
      closed: false,
      spline: true,
      layer: "L",
    });
    expect(res.ok && res.readback).toMatchObject({ centreFrom: "camera trace at (500, 300)" });
  });

  it("a trace that hits nothing creates nothing", async () => {
    const { client, sent } = fakeClient((fn, p) =>
      p.action === "camera"
        ? ok({ screenWidth: 800, screenHeight: 600 })
        : ok({ hit: 0, end: "0 0 0" }),
    );
    const res = await runShape(client, { action: "area", shape: "star", width: 5 });
    expect(!res.ok && res.code).toBe("INVALID_ARGUMENT");
    expect(!res.ok && res.next).toMatch(/centre/);
    expect(sent.some((s) => s.params.action === "create")).toBe(false);
  });

  it("a zero viewport refuses; a camera failure passes through", async () => {
    const zero = fakeClient(() => ok({ screenWidth: 0, screenHeight: 0 }));
    const r0 = await runShape(zero.client, { action: "area", shape: "circle", width: 5 });
    expect(!r0.ok && r0.message).toMatch(/viewport/);
    const noWorld = fakeClient(() => ({ status: "error", code: "NO_WORLD", message: "no world" }));
    const r1 = await runShape(noWorld.client, { action: "area", shape: "circle", width: 5 });
    expect(!r1.ok && r1.code).toBe("NO_WORLD");
  });

  it("snapToGround reads heights in batches of 200 and keeps y off the terrain", async () => {
    const { client, sent } = fakeClient((fn, p) =>
      fn === TERRAIN_HANDLER ? heightsOf(p) : created(4),
    );
    const res = await runShape(client, {
      action: "area",
      shape: "circle",
      width: 100,
      segments: 300,
      centre: "0 7 0",
      snapToGround: true,
    });
    const heights = sent.filter((s) => s.fn === TERRAIN_HANDLER);
    expect(heights.map((s) => (s.params.points as string[]).length)).toEqual([200, 100]);
    expect(heights[0].options.access).toBe("read");
    const pts = (sent.at(-1)!.params.points as string[]).map((s) => s.split(" ").map(Number));
    const local = circlePoints(100, 100, 300);
    pts.forEach(([x, y, z], i) => {
      const lx = Number(num(local[i][0]));
      const lz = Number(num(local[i][2]));
      expect(x).toBeCloseTo(lx, 5);
      expect(z).toBeCloseTo(lz, 5);
      expect(y).toBeCloseTo(lx < 0 ? 7 : lx + lz, 4);
    });
    expect(res.ok && res.warnings[0]).toMatch(/off the terrain/);
  });

  it("a heights failure creates nothing", async () => {
    const { client, sent } = fakeClient((fn) =>
      fn === TERRAIN_HANDLER
        ? { status: "refused", code: "NO_TERRAIN", message: "none" }
        : created(5),
    );
    const res = await runShape(client, {
      action: "area",
      shape: "circle",
      width: 5,
      centre: "0 0 0",
      snapToGround: true,
    });
    expect(!res.ok && res.code).toBe("NO_TERRAIN");
    expect(sent.some((s) => s.fn === HANDLER)).toBe(false);
  });
});

describe("import", () => {
  let root: string;
  const shpOf = (type: number, records: ShpRecord[]): ShpFile => ({
    header: {
      unused: [0, 0, 0, 0, 0],
      fileLengthWords: 0,
      version: 1000,
      shapeType: type,
      bbox: [0, 0, 0, 0, 0, 0, 0, 0],
    },
    records,
    trailing: new Uint8Array(),
  });
  const save = (
    rel: string,
    file: ShpFile,
    opts: { shx?: Uint8Array | false; dbf?: DbfFile } = {},
  ) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, writeShp(file));
    if (opts.shx !== false)
      writeFileSync(abs.replace(/\.shp$/, ".shx"), opts.shx ?? writeShx(file));
    if (opts.dbf) writeFileSync(abs.replace(/\.shp$/, ".dbf"), writeDbf(opts.dbf));
  };
  const ring = (x: number, y: number, s: number) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
    { x, y },
  ];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "wb-shape-"));
    // Mixed: polyline with two parts, polygon with two rings, point, null, a 1-point polyline.
    save(
      "shapes/mixed.shp",
      shpOf(3, [
        {
          number: 1,
          type: 3,
          parts: [0, 2],
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
            { x: 5, y: 6 },
            { x: 7, y: 8 },
          ],
        },
        { number: 2, type: 5, parts: [0, 5], points: [...ring(10, 10, 5), ...ring(11, 11, 1)] },
        { number: 3, type: 1, points: [{ x: 9, y: 9 }] },
        { number: 4, type: 0, points: [] },
        { number: 5, type: 3, parts: [0], points: [{ x: 1, y: 1 }] },
      ]),
      {
        dbf: {
          head: new Uint8Array(32).fill(0).map((_, i) => (i === 0 ? 3 : 0)),
          fields: [{ name: "NAME", type: "C", length: 8, decimals: 0 }],
          headerPad: new Uint8Array(),
          records: ["road", "lake", "tower", "", "x"].map((n) => ({
            flag: 0x20,
            cells: [n.padEnd(8)],
          })),
          tail: new Uint8Array([0x1a]),
        },
      },
    );
    // Z polyline, no .shx.
    save(
      "z.shp",
      shpOf(13, [
        {
          number: 1,
          type: 13,
          parts: [0],
          points: [
            { x: -1, y: 0, z: 50 },
            { x: -2, y: 0, z: 60 },
          ],
          zRange: [50, 60],
          hasM: false,
        },
      ]),
      { shx: false },
    );
    // Three polylines for paging; the .shx is corrupted.
    const three = shpOf(
      3,
      [0, 1, 2].map((i) => ({
        number: i + 1,
        type: 3,
        parts: [0],
        points: [
          { x: i, y: 0 },
          { x: i, y: 1 },
        ],
      })),
    );
    const shx = writeShx(three);
    new DataView(shx.buffer).setInt32(108, 77, false);
    save("three.shp", three, { shx });
    writeFileSync(join(root, "broken.shp"), Buffer.alloc(40));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const answer: Answer = (fn, p, n) => (fn === TERRAIN_HANDLER ? heightsOf(p) : created(n));

  it("refuses without a project, outside it, or when the file is missing or unreadable", async () => {
    const { client, sent } = fakeClient(answer);
    const r0 = await runShape(client, { action: "import", path: "shapes/mixed.shp" });
    expect(!r0.ok && r0.code).toBe("NOT_IN_PROJECT");
    const r1 = await runShape(
      client,
      { action: "import", path: "nope.shp" },
      { projectPath: root },
    );
    expect(!r1.ok && r1.code).toBe("PATH_NOT_FOUND");
    const r2 = await runShape(
      client,
      { action: "import", path: "broken.shp" },
      { projectPath: root },
    );
    expect(!r2.ok && r2.code).toBe("INVALID_ARGUMENT");
    expect(!r2.ok && r2.message).toMatch(/not a readable shapefile/);
    expect(sent).toHaveLength(0);
  });

  it("parts become creates, points are reported, nulls and short parts skipped", async () => {
    const { client, sent } = fakeClient(answer);
    const res = await runShape(
      client,
      {
        action: "import",
        path: "shapes/mixed.shp",
        offset: "100 1 200",
        color: "0 1 0 1",
        spline: true,
        layer: "L",
      },
      { projectPath: root },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Heights first, all vertices in one batch, before any create.
    expect(sent[0].fn).toBe(TERRAIN_HANDLER);
    expect(sent[0].params.points).toEqual([
      "101 202",
      "103 204",
      "105 206",
      "107 208",
      "110 210",
      "115 210",
      "115 215",
      "110 215",
      "111 211",
      "112 211",
      "112 212",
      "111 212",
    ]);
    const creates = sent.filter((s) => s.fn === HANDLER);
    expect(creates).toHaveLength(4);
    expect(creates.every((s) => s.options.access === "mutate")).toBe(true);
    // x + offset, terrain y (x + z) + offset y, shapefile y + offset z.
    expect(creates[0].params).toEqual({
      action: "create",
      points: ["101 304 202", "103 308 204"],
      closed: false,
      spline: true,
      color: "0 1 0 1",
      layer: "L",
    });
    expect(creates[2].params.points).toEqual([
      "110 321 210",
      "115 326 210",
      "115 331 215",
      "110 326 215",
    ]);
    expect(creates[2].params.closed).toBe(true);
    const rb = res.readback as Record<string, unknown>;
    expect(rb).toMatchObject({
      path: "shapes/mixed.shp",
      shapeType: 3,
      records: 5,
      from: 0,
      to: 5,
      nextCursor: null,
    });
    expect(
      (rb.created as unknown[]).map((c) => c as { record: number; part: number }),
    ).toMatchObject([
      { record: 1, part: 0 },
      { record: 1, part: 1 },
      { record: 2, part: 0 },
      { record: 2, part: 1 },
    ]);
    expect(rb.reported).toEqual([
      {
        record: 3,
        kind: "point",
        count: 1,
        points: [{ x: 109, z: 209 }],
        attributes: { NAME: "tower" },
      },
    ]);
    expect((rb.skipped as Array<{ record: number }>).map((s) => s.record)).toEqual([4, 5]);
    expect(res.changed).toHaveLength(4);
    expect(res.next).toMatch(/undo step/);
  });

  it("pages by record with limit and cursor; a changed file is STALE_CURSOR; a bad .shx warns", async () => {
    const { client, sent } = fakeClient(answer);
    const p1 = await runShape(
      client,
      { action: "import", path: "three.shp", limit: 2 },
      { projectPath: root },
    );
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect((p1.readback as { nextCursor: string }).nextCursor).toBe("2:3");
    expect(p1.warnings.join(" ")).toMatch(/\.shx disagrees.*record 2/);
    expect(sent.filter((s) => s.fn === HANDLER)).toHaveLength(2);
    const p2 = await runShape(
      client,
      { action: "import", path: "three.shp", cursor: "2:3" },
      { projectPath: root },
    );
    expect(p2.ok && (p2.readback as { from: number; created: unknown[] }).from).toBe(2);
    expect(p2.ok && (p2.readback as { created: unknown[] }).created).toHaveLength(1);
    const stale = await runShape(
      client,
      { action: "import", path: "three.shp", cursor: "1:9" },
      { projectPath: root },
    );
    expect(!stale.ok && stale.code).toBe("STALE_CURSOR");
  });

  it("off-terrain vertices of a Z file take its z; no .shx is a warning", async () => {
    const { client, sent } = fakeClient(answer);
    const res = await runShape(
      client,
      { action: "import", path: "z.shp", offset: "0 2 0" },
      { projectPath: root },
    );
    expect(res.ok).toBe(true);
    expect(sent.find((s) => s.fn === HANDLER)!.params.points).toEqual(["-1 52 0", "-2 62 0"]);
    expect(res.ok && res.warnings.join(" ")).toMatch(/no \.shx/);
    expect(res.ok && res.warnings.join(" ")).toMatch(/off the terrain/);
  });

  it("a world with no terrain falls back to z; another heights error stops before any create", async () => {
    const noTerrain = fakeClient((fn, _p, n) =>
      fn === TERRAIN_HANDLER
        ? { status: "refused", code: "NO_TERRAIN", message: "none" }
        : created(n),
    );
    const r0 = await runShape(
      noTerrain.client,
      { action: "import", path: "z.shp" },
      { projectPath: root },
    );
    expect(r0.ok).toBe(true);
    expect(noTerrain.sent.at(-1)!.params.points).toEqual(["-1 50 0", "-2 60 0"]);
    expect(r0.ok && r0.warnings.join(" ")).toMatch(/no terrain/);

    const lost = fakeClient((fn) =>
      fn === TERRAIN_HANDLER ? new WorkbenchError("gone", "LOST") : created(0),
    );
    const r1 = await runShape(
      lost.client,
      { action: "import", path: "z.shp" },
      { projectPath: root },
    );
    expect(!r1.ok && r1.code).toBe("LOST");
    expect(lost.sent.some((s) => s.fn === HANDLER)).toBe(false);
  });

  it("a failed create stops, keeps what was made and the resume cursor", async () => {
    let creates = 0;
    const { client } = fakeClient((fn, p, n) => {
      if (fn === TERRAIN_HANDLER) return heightsOf(p);
      creates++;
      return creates === 3
        ? { status: "error", code: "ENGINE_FALSE", message: "CreateEntity returned null" }
        : created(n);
    });
    const res = await runShape(
      client,
      { action: "import", path: "shapes/mixed.shp" },
      { projectPath: root },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("ENGINE_FALSE");
    expect(res.message).toMatch(/record 2 part 0: .*2 shape\(s\) were created/);
    expect(res.readback).toMatchObject({ resumeCursor: "1:5" });
    expect((res.readback as { created: unknown[] }).created).toHaveLength(2);
    expect(res.next).toMatch(/1:5/);
  });

  it("a lost create is not retried and gives no resume advice", async () => {
    const { client, sent } = fakeClient((fn, p) =>
      fn === TERRAIN_HANDLER ? heightsOf(p) : new WorkbenchError("lost", "LOST"),
    );
    const res = await runShape(
      client,
      { action: "import", path: "three.shp" },
      { projectPath: root },
    );
    expect(!res.ok && res.code).toBe("LOST");
    expect(sent.filter((s) => s.fn === HANDLER)).toHaveLength(1);
    expect(!res.ok && res.next).not.toMatch(/Resume/);
  });
});

describe("points: tesselated and tangents", () => {
  it("sends tesselated, keeps tangents of a spline page, marks the read", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        id: A,
        className: "SplineShapeEntity",
        closed: 0,
        total: 2,
        points: ["0 0 0", "1 0 0"],
        tangents: ["0 0 0|1 0 0|0", "-1 0 0|0 0 0|1"],
      }),
    );
    const res = await runShape(client, { action: "points", entity: A, tesselated: true });
    expect(sent[0].params).toEqual({ action: "points", entity: A, tesselated: true });
    expect(sent[0].options.access).toBe("read");
    expect(res.ok && res.readback).toMatchObject({
      tesselated: true,
      tangents: ["0 0 0|1 0 0|0", "-1 0 0|0 0 0|1"],
    });
  });

  it("a polyline answers no tangents key; tesselated pages like any page", async () => {
    const { client } = fakeClient(() =>
      ok({ id: A, closed: 1, total: 400, nextCursor: "200:400", points: ["1 2 3"] }),
    );
    const res = await runShape(client, {
      action: "points",
      entity: A,
      tesselated: true,
      limit: 200,
    });
    expect(res.ok && "tangents" in (res.readback as object)).toBe(false);
    expect(res.ok && res.next).toMatch(/200:400/);
    expect(res.ok && res.readback).toMatchObject({ nextCursor: "200:400", tesselated: true });
  });

  it("a non-bool tesselated is refused", () => {
    const p = prepareRequest({ action: "points", entity: A, tesselated: "yes" });
    expect(p.ok).toBe(false);
  });
});

// The TS planner against SCR_ShapeAreaTool.SetShapePoints (append, then remove from the end).
describe("edit planner (shape edit order)", () => {
  const pts = (n: number, tag = "p") => Array.from({ length: n }, (_, i) => `${tag}${i}`);
  const label = (s: EditStep): string =>
    s.call === "CreateObjectArrayVariableMember"
      ? `C${s.slot}`
      : s.call === "RemoveObjectArrayVariableMember"
        ? `R${s.slot}`
        : s.call === "ClearVariableValue"
          ? "clearClosed"
          : s.variable === "IsClosed"
            ? "setClosed"
            : `P${s.slot}<-${s.point}`;

  it("set: append the new points at before + i, then remove the old from the end", () => {
    const plan = planEdit({ op: "set", before: 3, count: 2, closed: false });
    expect(plan.steps.map(label)).toEqual(["C3", "P3<-0", "C4", "P4<-1", "R2", "R1", "R0"]);
    expect(plan.expected).toBe(2);
    const done = applyEditPlan(pts(3), false, plan.steps, pts(2, "n"));
    expect(done.points).toEqual(["n0", "n1"]);
  });

  it("insert, remove and move are the same calls at one index", () => {
    const ins = planEdit({ op: "insert", before: 4, index: 1, count: 2, closed: false });
    expect(ins.steps.map(label)).toEqual(["C1", "P1<-0", "C2", "P2<-1"]);
    expect(applyEditPlan(pts(4), false, ins.steps, ["a", "b"]).points).toEqual([
      "p0",
      "a",
      "b",
      "p1",
      "p2",
      "p3",
    ]);
    const app = planEdit({ op: "insert", before: 4, index: 4, count: 1, closed: false });
    expect(app.steps.map(label)).toEqual(["C4", "P4<-0"]);
    const rem = planEdit({ op: "remove", before: 4, index: 2, count: 0, closed: false });
    expect(rem.steps.map(label)).toEqual(["R2"]);
    expect(applyEditPlan(pts(4), false, rem.steps, []).points).toEqual(["p0", "p1", "p3"]);
    const mov = planEdit({ op: "move", before: 4, index: 3, count: 1, closed: true });
    expect(mov.steps.map(label)).toEqual(["P3<-0"]);
    expect(applyEditPlan(pts(4), true, mov.steps, ["z"]).points).toEqual(["p0", "p1", "p2", "z"]);
  });

  it("open and close change one variable, and plan nothing when already so", () => {
    expect(planEdit({ op: "close", before: 3, count: 0, closed: false }).steps.map(label)).toEqual([
      "setClosed",
    ]);
    expect(planEdit({ op: "open", before: 3, count: 0, closed: true }).steps.map(label)).toEqual([
      "clearClosed",
    ]);
    expect(planEdit({ op: "close", before: 3, count: 0, closed: true }).steps).toEqual([]);
    expect(planEdit({ op: "open", before: 3, count: 0, closed: false }).steps).toEqual([]);
    expect(
      applyEditPlan(
        pts(3),
        false,
        planEdit({ op: "close", before: 3, count: 0, closed: false }).steps,
        [],
      ).closed,
    ).toBe(true);
  });

  it("every op over many sizes yields what the plain array operation yields", () => {
    for (let before = 2; before <= 6; before++) {
      for (let count = 1; count <= 4; count++) {
        const have = pts(before);
        const given = pts(count, "n");
        const set = planEdit({ op: "set", before, count: Math.max(count, 2), closed: false });
        expect(set.steps.filter((s) => s.call === "CreateObjectArrayVariableMember")).toHaveLength(
          Math.max(count, 2),
        );
        expect(set.steps.filter((s) => s.call === "RemoveObjectArrayVariableMember")).toHaveLength(
          before,
        );
        expect(applyEditPlan(have, false, set.steps, pts(Math.max(count, 2), "n")).points).toEqual(
          pts(Math.max(count, 2), "n"),
        );
        for (let index = 0; index <= before; index++) {
          const ins = planEdit({ op: "insert", before, index, count, closed: false });
          const want = [...have];
          want.splice(index, 0, ...given);
          expect(applyEditPlan(have, false, ins.steps, given).points).toEqual(want);
          expect(ins.expected).toBe(want.length);
        }
        for (let index = 0; index < before; index++) {
          const mov = planEdit({ op: "move", before, index, count: 1, closed: false });
          const want = [...have];
          want[index] = "z";
          expect(applyEditPlan(have, false, mov.steps, ["z"]).points).toEqual(want);
          if (before > 2) {
            const rem = planEdit({ op: "remove", before, index, count: 0, closed: false });
            const left = [...have];
            left.splice(index, 1);
            expect(applyEditPlan(have, false, rem.steps, []).points).toEqual(left);
            expect(rem.expected).toBe(before - 1);
          }
        }
      }
    }
  });

  it("refuses what does not fit the shape, as the handler does", () => {
    const why = (
      o: EditOp,
      before: number,
      index: number | undefined,
      count: number,
      closed = false,
    ) => editRangeProblem({ op: o, before, index, count, closed });
    expect(why("insert", 3, 4, 1)).toMatch(/past the end/);
    expect(why("insert", 1999, 0, 2)).toMatch(/at most 2000/);
    expect(why("remove", 3, 3, 0)).toMatch(/out of range/);
    expect(why("remove", 2, 0, 0)).toMatch(/too few/);
    expect(why("remove", 3, 0, 0, true)).toMatch(/too few/);
    expect(why("move", 3, 3, 1)).toMatch(/out of range/);
    expect(why("set", 5, undefined, 2, true)).toMatch(/at least 3/);
    expect(why("close", 2, undefined, 0)).toMatch(/at least 3/);
    expect(() => planEdit({ op: "remove", before: 3, index: 9, count: 0, closed: false })).toThrow(
      /out of range/,
    );
    expect(why("set", 5, undefined, 3, true)).toBeUndefined();
  });

  it("the applier rejects a plan that names a missing slot", () => {
    expect(() =>
      applyEditPlan(pts(2), false, [{ call: "RemoveObjectArrayVariableMember", slot: 2 }], []),
    ).toThrow(/slot 2/);
    expect(() =>
      applyEditPlan(pts(2), false, [{ call: "CreateObjectArrayVariableMember", slot: 3 }], []),
    ).toThrow(/slot 3/);
  });
});

describe("edit", () => {
  const closedOk = (extra: Record<string, unknown> = {}) =>
    ok({ id: A, total: 3, closed: 1, undoName: "EMCP wb_shape edit set", ...extra });
  const open = { editOpen: true };

  it("is gated while EDIT_OPEN is false: valid arguments answer GATED with P-W7-14, nothing is sent", async () => {
    expect(EDIT_OPEN).toBe(false);
    const { client, sent } = fakeClient(() => closedOk());
    const res = await runShape(client, {
      action: "edit",
      entity: A,
      op: "set",
      points: ["0 0 0", "1 0 0", "1 0 1"],
    });
    expect(sent).toHaveLength(0);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("GATED");
      expect(res.message).toMatch(/P-W7-14/);
      expect(res.next).toMatch(/P-W7-14/);
      expect(res.target).toBe(`entity:${A}`);
    }
  });

  it("invalid arguments refuse INVALID_ARGUMENT before the gate", () => {
    const refuse = (input: unknown, re: RegExp) => {
      const p = prepareRequest(input, open);
      expect(p.ok).toBe(false);
      if (!p.ok) {
        expect(p.error.code).toBe("INVALID_ARGUMENT");
        expect(p.error.message).toMatch(re);
      }
      const g = prepareRequest(input);
      expect(g.ok === false && g.error.code).toBe("INVALID_ARGUMENT");
    };
    refuse({ action: "edit", entity: A }, /op/);
    refuse({ action: "edit", entity: A, op: "twist" }, /op/);
    refuse({ action: "edit", op: "open" }, /entity/);
    refuse({ action: "edit", entity: A, op: "set", points: ["0 0 0"] }, /set takes 2 to 2000/);
    refuse(
      { action: "edit", entity: A, op: "set", points: Array(2001).fill("0 0 0") },
      /set takes 2 to 2000/,
    );
    refuse({ action: "edit", entity: A, op: "insert", index: 0 }, /insert takes 1/);
    refuse({ action: "edit", entity: A, op: "insert", points: ["0 0 0"] }, /index/);
    refuse(
      { action: "edit", entity: A, op: "insert", index: -1, points: ["0 0 0"] },
      /index|>=|too_small|Too small/i,
    );
    refuse(
      { action: "edit", entity: A, op: "move", index: 0, points: ["0 0 0", "1 1 1"] },
      /exactly 1/,
    );
    refuse({ action: "edit", entity: A, op: "move", index: 0, points: ["0 0"] }, /points\[0\]/);
    refuse({ action: "edit", entity: A, op: "remove", points: ["0 0 0"], index: 0 }, /no points/);
    refuse({ action: "edit", entity: A, op: "remove" }, /index/);
    refuse({ action: "edit", entity: A, op: "close", index: 1 }, /no index/);
    refuse({ action: "edit", entity: A, op: "open", points: ["0 0 0"] }, /no points/);
    refuse({ action: "edit", entity: A, op: "set", points: ["0 0 0", "1 0 x"] }, /points\[1\]/);
    refuse({ action: "edit", entity: "nope", op: "open" }, /entity/);
    refuse({ action: "edit", entity: A, op: "open", confirm: true }, /confirm|Unrecognized/);
    refuse({ action: "edit", entity: A, op: "open", closed: true }, /closed|Unrecognized/);
  });

  it.each(EDIT_OPS)("op %s with the switch on is a mutate with the canonical ref", async (op) => {
    const { client, sent } = fakeClient(() => closedOk());
    const input: Record<string, unknown> = { action: "edit", entity: "id:0xAA", op };
    if (op === "set") input.points = ["0 0 0", "1 0 0", "1 0 1"];
    if (op === "insert") {
      input.points = ["0 0 0"];
      input.index = 1;
    }
    if (op === "move") {
      input.points = ["5 5 5"];
      input.index = 0;
    }
    if (op === "remove") input.index = 2;
    const res = await runShape(client, input, open);
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe(HANDLER);
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({ ...input, entity: A });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.readback).toEqual({
        id: A,
        op,
        total: 3,
        closed: true,
        undoName: "EMCP wb_shape edit set",
      });
      expect(res.changed).toEqual([{ path: A, before: null, after: `${op}: 3 points` }]);
      expect(res.next).toMatch(/wb_undo_redo/);
    }
  });

  it("snapToGround is passed to the handler as given", async () => {
    const { client, sent } = fakeClient(() => closedOk());
    await runShape(
      client,
      { action: "edit", entity: A, op: "move", index: 1, points: ["5 0 5"], snapToGround: true },
      open,
    );
    expect(sent[0].params.snapToGround).toBe(true);
  });

  it("an already open or closed shape is ok with no change and the handler's message", async () => {
    const { client } = fakeClient(() =>
      ok({
        id: A,
        total: 4,
        closed: 1,
        message: "the shape is already closed; nothing was changed",
      }),
    );
    const res = await runShape(client, { action: "edit", entity: A, op: "close" }, open);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toBeNull();
      expect(res.next).toBeUndefined();
      expect(res.warnings[0]).toMatch(/already closed/);
    }
  });

  it("maps handler refusals and keeps what a failed edit left", async () => {
    const refusal = (code: string, extra: Record<string, unknown> = {}) =>
      fakeClient(() => ({ status: "refused", code, message: `m ${code}`, next: "n", ...extra }));
    for (const code of [
      "NOT_A_SHAPE",
      "NOT_IN_PROJECT",
      "INVALID_ARGUMENT",
      "WRONG_MODE",
      "GATED",
    ]) {
      const { client } = refusal(code);
      const res = await runShape(client, { action: "edit", entity: A, op: "open" }, open);
      expect(!res.ok && res.code).toBe(code);
      if (!res.ok && code === "NOT_A_SHAPE") expect(res.next).toBe("n");
    }
    const { client } = refusal("ENGINE_FALSE", { id: A, undoName: "EMCP wb_shape edit set" });
    const res = await runShape(
      client,
      { action: "edit", entity: A, op: "set", points: ["0 0 0", "1 0 0"] },
      open,
    );
    expect(!res.ok && res.readback).toEqual({ id: A, undoName: "EMCP wb_shape edit set" });
  });

  it.each(["LOST", "MODAL_OPEN", "WEDGED", "TIMEOUT"] as const)(
    "maps WorkbenchError %s and does not retry",
    async (code) => {
      const { client, sent } = fakeClient(() => new WorkbenchError("x", code));
      const res = await runShape(client, { action: "edit", entity: A, op: "open" }, open);
      expect(!res.ok && res.code).toBe(code);
      expect(sent).toHaveLength(1);
    },
  );
});

describe("area with target", () => {
  const open = { editOpen: true };
  const base = { action: "area", shape: "circle", width: 10, segments: 4, centre: "100 5 200" };

  it("is gated while EDIT_OPEN is false, before any call", async () => {
    const { client, sent } = fakeClient(() => ok());
    const res = await runShape(client, { ...base, target: A, snapToGround: true });
    expect(sent).toHaveLength(0);
    expect(!res.ok && res.code).toBe("GATED");
    expect(!res.ok && res.next).toMatch(/P-W7-14/);
  });

  it("replaces the target's points through one edit set, never a create", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ id: A, total: 4, closed: 1, undoName: "EMCP wb_shape edit set" }),
    );
    const res = await runShape(client, { ...base, target: "id:0xAA" }, open);
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe(HANDLER);
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({
      action: "edit",
      entity: A,
      op: "set",
      points: ["100 5 205", "105 5 200", "100 5 195", "95 5 200"],
    });
    expect(res.ok && res.target).toBe(`entity:${A}`);
    expect(res.ok && res.readback).toMatchObject({
      op: "set",
      total: 4,
      shape: "circle",
      centreFrom: "given",
      pointCount: 4,
    });
  });

  it("with snapToGround reads heights first and sends the snapped points", async () => {
    const { client, sent } = fakeClient((fn, p) =>
      fn === TERRAIN_HANDLER ? heightsOf(p) : ok({ id: A, total: 4, closed: 1, undoName: "u" }),
    );
    await runShape(client, { ...base, target: A, snapToGround: true }, open);
    expect(sent.map((s) => s.fn)).toEqual([TERRAIN_HANDLER, HANDLER]);
    expect(sent[1].params.points).toEqual([
      "100 305 205",
      "105 305 200",
      "100 295 195",
      "95 295 200",
    ]);
  });

  it("closed, spline and layer do not combine with target", () => {
    for (const extra of [{ closed: true }, { spline: true }, { layer: "a.layer" }]) {
      const p = prepareRequest({ ...base, target: A, ...extra }, open);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error.message).toMatch(/does not apply with target/);
    }
  });

  it("a bad target ref refuses; an edit refusal passes through with nothing created", async () => {
    const bad = prepareRequest({ ...base, target: "nope" }, open);
    expect(!bad.ok && bad.error.message).toMatch(/target/);
    const { client, sent } = fakeClient(() => ({
      status: "refused",
      code: "NOT_A_SHAPE",
      message: "the entity is a GenericEntity",
    }));
    const res = await runShape(client, { ...base, target: A }, open);
    expect(!res.ok && res.code).toBe("NOT_A_SHAPE");
    expect(sent.filter((s) => (s.params as { action?: string }).action === "create")).toHaveLength(
      0,
    );
  });

  it("without target the W6 create path is unchanged", async () => {
    const { client, sent } = fakeClient(() => created(7));
    await runShape(client, base, open);
    expect(sent[0].params).toMatchObject({ action: "create", closed: true, spline: false });
  });
});

// Census rows this file tests (W6 close-out, EV-W6-113; W7 edit, tesselated, target).
// census:mcp:action/wb_shape.edit
// census:mcp:action/wb_shape.area
// census:mcp:action/wb_shape.create
// census:mcp:action/wb_shape.import
// census:mcp:action/wb_shape.points
