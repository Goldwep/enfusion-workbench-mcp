import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { captureTool } from "./_tool-harness.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import {
  GATE_OF,
  GENERATOR_CONTRACT,
  HANDLER,
  POINT_DATA_FALLBACK,
  checkPrefab,
  parseRows,
  pointDataClasses,
  prepareRequest,
  registerWbGenerator,
  roadGeneratorClasses,
  runGenerator,
  truthy,
  wbGeneratorDescription,
  type GeneratorClient,
} from "../../src/tools/wb-generator.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

type Answer = Record<string, unknown> | Error;

function fakeClient(answer: Answer | ((p: Record<string, unknown>) => Answer)) {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = typeof answer === "function" ? answer(params) : answer;
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as GeneratorClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = "m", next = "n") => ({
  status: "refused",
  code,
  message,
  next,
});
const SHAPE = "id:0x00000000000000aa";
const PREFAB = "{0123456789ABCDEF}Prefabs/Generators/Road.et";

describe("wb_generator contract and description", () => {
  it("loads, and the description fits 400 characters", () => {
    expect(GENERATOR_CONTRACT.tool).toBe("wb_generator");
    expect(GENERATOR_CONTRACT.handler).toBe(HANDLER);
    expect(wbGeneratorDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(wbGeneratorDescription()).not.toMatch(/sandbox/i);
  });

  it("names the six actions of the contract, and the five gated ones carry a probe and a switch", () => {
    expect(GENERATOR_CONTRACT.actions.map((a) => a.name)).toEqual([
      "list",
      "attach",
      "detach",
      "regenerate",
      "pointData",
      "events",
    ]);
    expect(Object.keys(GATE_OF).sort()).toEqual([
      "attach",
      "detach",
      "events",
      "pointData",
      "regenerate",
    ]);
  });

  it("answers NOT_A_GENERATOR from vocabulary.ts (landed by the W7 integration)", () => {
    expect(ERROR_CODES.NOT_A_GENERATOR).toMatch(/GeneratorBaseEntity/);
  });

  it("registers as wb_generator with a flat input shape", () => {
    let name = "";
    let shape: Record<string, unknown> = {};
    const server = {
      registerTool: (n: string, def: { inputSchema: Record<string, unknown> }) => {
        name = n;
        shape = def.inputSchema;
      },
    };
    registerWbGenerator(server as never, {} as never);
    expect(name).toBe("wb_generator");
    expect(Object.keys(shape).sort()).toEqual(
      [
        "action",
        "cursor",
        "dataClass",
        "dataIndex",
        "enabled",
        "entity",
        "index",
        "limit",
        "name",
        "op",
        "prefab",
        "shape",
      ].sort(),
    );
  });

  it("the registered handler drops undefined keys and answers the JSON text", async () => {
    const { client, sent } = fakeClient(ok({ rows: [], total: 0, eventsEnabled: 1 }));
    const run = captureTool((s) => registerWbGenerator(s, client as never));
    const r = await run({ action: "list", shape: undefined, cursor: undefined });
    expect(sent[0].params).toEqual({ action: "list" });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text).ok).toBe(true);
  });
});

describe("the index class lists", () => {
  it("point-data classes come from the index (ForestGeneratorPointData and its relatives)", () => {
    const list = pointDataClasses();
    for (const c of POINT_DATA_FALLBACK) expect(list).toContain(c);
    expect(list).toContain("ForestGeneratorPointData");
    expect(list).not.toContain("ShapePointDataScriptBase");
  });

  it("falls back to the built-in five when the index is missing", () => {
    expect(pointDataClasses(join(tmpdir(), "no-such-data-dir-w7"))).toEqual(
      [...POINT_DATA_FALLBACK].sort(),
    );
  });

  it("reads a hierarchy from a data dir: descendants of the base and *PointData names", () => {
    const dir = mkdtempSync(join(tmpdir(), "wbgen-"));
    try {
      mkdirSync(join(dir, "api"));
      writeFileSync(
        join(dir, "api", "hierarchy.json"),
        JSON.stringify([
          { name: "ShapePointDataScriptBase", children: ["ModPoints"] },
          { name: "ModPoints", children: [] },
          { name: "OddPointData", children: [] },
          { name: "RoadGeneratorEntity", children: ["ModRoad"] },
          { name: "ModRoad", children: [] },
        ]),
      );
      const list = pointDataClasses(dir);
      expect(list).toContain("ModPoints");
      expect(list).toContain("OddPointData");
      expect([...roadGeneratorClasses(dir)].sort()).toEqual(["ModRoad", "RoadGeneratorEntity"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("road generator classes include RoadGeneratorEntity from the shipped index", () => {
    expect(roadGeneratorClasses().has("RoadGeneratorEntity")).toBe(true);
  });
});

describe("prepareRequest refuses before anything is sent", () => {
  const refuse = (input: unknown) => {
    const p = prepareRequest(input);
    expect(p.ok).toBe(false);
    return p.ok ? undefined : p.error;
  };

  it("an unknown action and an unknown key", () => {
    expect(refuse({ action: "nope" })?.code).toBe("INVALID_ARGUMENT");
    expect(refuse({ action: "list", confirm: true })?.code).toBe("INVALID_ARGUMENT");
  });

  it("takes no confirm on any action (OD-12)", () => {
    for (const a of GENERATOR_CONTRACT.actions) {
      expect(a.params.map((p) => p.key)).not.toContain("confirm");
    }
  });

  it("required keys per action", () => {
    expect(refuse({ action: "attach", shape: SHAPE })?.message).toContain("prefab");
    expect(refuse({ action: "detach" })?.message).toContain("entity");
    expect(refuse({ action: "regenerate" })?.message).toContain("shape");
    expect(refuse({ action: "events" })?.message).toContain("enabled");
    expect(refuse({ action: "pointData", shape: SHAPE, op: "add" })?.message).toContain("index");
  });

  it("entity references, limit and cursor", () => {
    expect(refuse({ action: "list", shape: "banana" })?.code).toBe("INVALID_ARGUMENT");
    expect(refuse({ action: "list", limit: 0 })?.message).toContain("limit");
    expect(refuse({ action: "list", limit: 201 })?.message).toContain("limit");
    expect(refuse({ action: "list", cursor: "x" })?.code).toBe("INVALID_ARGUMENT");
    expect(refuse({ action: "list", cursor: "9:3" })?.code).toBe("INVALID_ARGUMENT");
    expect(refuse({ action: "detach", entity: "index:x" })?.code).toBe("INVALID_ARGUMENT");
  });

  it("attach: prefab form, extension and name", () => {
    expect(refuse({ action: "attach", shape: SHAPE, prefab: "{12}x.et" })?.message).toContain(
      "GUID",
    );
    expect(
      refuse({ action: "attach", shape: SHAPE, prefab: "Prefabs/Road.layer" })?.message,
    ).toContain(".et");
    expect(refuse({ action: "attach", shape: SHAPE, prefab: "../Road.et" })?.code).toBe(
      "ABSOLUTE_PATH",
    );
    expect(
      refuse({ action: "attach", shape: SHAPE, prefab: "C:/Road.et" })?.code,
    ).not.toBeUndefined();
    expect(
      refuse({ action: "attach", shape: SHAPE, prefab: PREFAB, name: " " })?.message,
    ).toContain("name");
  });

  it("pointData: op, index, dataClass against the index, dataIndex", () => {
    const base = { action: "pointData", shape: SHAPE, index: 0 };
    expect(refuse({ ...base, op: "swap" })?.message).toContain("op");
    expect(refuse({ ...base, op: "add" })?.message).toContain("dataClass is required");
    expect(refuse({ ...base, op: "add", dataClass: "Foo bar" })?.message).toContain(
      "ForestGeneratorPointData",
    );
    expect(refuse({ ...base, op: "add", dataClass: "1Foo" })?.code).toBe("INVALID_ARGUMENT");
    expect(refuse({ ...base, op: "add", dataClass: "ShapePointDataScriptBase" })?.code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(refuse({ ...base, index: -1, op: "remove" })?.message).toContain("index");
    expect(refuse({ ...base, op: "remove", dataIndex: -1 })?.message).toContain("dataIndex");
    expect(
      refuse({ ...base, op: "add", dataClass: "ForestGeneratorPointData", dataIndex: 0 })?.message,
    ).toContain("remove");
    expect(
      refuse({ ...base, op: "remove", dataClass: "ForestGeneratorPointData" })?.message,
    ).toContain("op add");
  });

  it("a refused request sends nothing through runGenerator", async () => {
    const { client, sent } = fakeClient(ok());
    const r = await runGenerator(client, {
      action: "pointData",
      shape: SHAPE,
      index: 0,
      op: "add",
      dataClass: "No-pe",
    });
    expect(r.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("a plain class name outside the index goes to the handler with a warning (review W7-GEN-02)", async () => {
    const { client, sent } = fakeClient(ok());
    const r = await runGenerator(client, {
      action: "pointData",
      shape: SHAPE,
      index: 0,
      op: "add",
      dataClass: "MyFencePointData",
    });
    expect(sent).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/MyFencePointData' is not in the API index/);
  });

  it("accepts every valid action and canonicalizes references", () => {
    const p = prepareRequest({ action: "list", shape: "id:AA" });
    expect(p.ok && p.params.shape).toBe("id:0x00000000000000aa");
    expect(p.ok && p.target).toBe("entity:id:0x00000000000000aa");
    expect(prepareRequest({ action: "detach", entity: "name:Road_1" }).ok).toBe(true);
    expect(prepareRequest({ action: "attach", shape: SHAPE, prefab: PREFAB, name: "R1" }).ok).toBe(
      true,
    );
    expect(prepareRequest({ action: "attach", shape: SHAPE, prefab: "Prefabs/Road.et" }).ok).toBe(
      true,
    );
    expect(prepareRequest({ action: "regenerate", shape: SHAPE }).ok).toBe(true);
    expect(
      prepareRequest({ action: "pointData", shape: SHAPE, index: 2, op: "remove", dataIndex: 1 })
        .ok,
    ).toBe(true);
    expect(prepareRequest({ action: "events", enabled: false }).ok).toBe(true);
  });

  it("checkPrefab keeps the GUID prefix and converts backslashes", () => {
    expect(checkPrefab(PREFAB)).toBe(PREFAB);
    expect(checkPrefab("Prefabs\\Road.et")).toBe("Prefabs/Road.et");
    expect(checkPrefab("{0123456789ABCDEF}")).toBe("{0123456789ABCDEF}");
  });
});

describe("list", () => {
  it("sends a read call and parses the rows", async () => {
    const { client, sent } = fakeClient(
      ok({
        rows: [`id:0x1|RoadGeneratorEntity|${PREFAB}|${SHAPE}`, "id:0x2|ForestGeneratorEntity||"],
        total: 2,
        eventsEnabled: 1,
      }),
    );
    const r = await runGenerator(client, { action: "list", shape: SHAPE, limit: 50 });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe(HANDLER);
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({ action: "list", shape: SHAPE, limit: 50 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBeNull();
    expect(r.readback).toEqual({
      eventsEnabled: true,
      total: 2,
      rows: [
        { id: "id:0x1", className: "RoadGeneratorEntity", prefab: PREFAB, shapeId: SHAPE },
        { id: "id:0x2", className: "ForestGeneratorEntity", prefab: "", shapeId: "" },
      ],
      nextCursor: null,
    });
    expect(r.next).toBeUndefined();
  });

  it("pages: nextCursor in readback and next", async () => {
    const { client } = fakeClient(
      ok({ rows: ["id:0x1|A||"], total: 5, nextCursor: "1:5", eventsEnabled: 0 }),
    );
    const r = await runGenerator(client, { action: "list", limit: 1 });
    expect(r.ok && (r.readback as { nextCursor: string }).nextCursor).toBe("1:5");
    expect(r.ok && r.next).toContain('cursor "1:5"');
    expect(r.ok && (r.readback as { eventsEnabled: boolean }).eventsEnabled).toBe(false);
  });

  it("a cursor is sent, and a total that moved answers STALE_CURSOR even when the handler did not", async () => {
    const { client, sent } = fakeClient(ok({ rows: [], total: 4, eventsEnabled: 1 }));
    const r = await runGenerator(client, { action: "list", cursor: "2:5" });
    expect(sent[0].params.cursor).toBe("2:5");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("STALE_CURSOR");
  });

  it("maps the handler's STALE_CURSOR, NO_WORLD, NOT_A_SHAPE and ENTITY_NOT_FOUND", async () => {
    for (const code of ["STALE_CURSOR", "NO_WORLD", "NOT_A_SHAPE", "ENTITY_NOT_FOUND"]) {
      const { client } = fakeClient({ status: "error", code, message: `m ${code}`, next: "nx" });
      const r = await runGenerator(client, { action: "list", shape: SHAPE });
      expect(!r.ok && r.code).toBe(code);
      expect(!r.ok && r.message).toBe(`m ${code}`);
      expect(!r.ok && r.next).toBe("nx");
    }
  });

  it("parseRows tolerates short rows", () => {
    expect(parseRows(["id:0x1|X"])).toEqual([
      { id: "id:0x1", className: "X", prefab: "", shapeId: "" },
    ]);
  });
});

describe("attach", () => {
  it("sends a mutate call and answers the new generator and the undo name", async () => {
    const { client, sent } = fakeClient(
      ok({ id: "id:0x9", className: "RoadGeneratorEntity", undoName: "EMCP wb_generator attach" }),
    );
    const r = await runGenerator(client, {
      action: "attach",
      shape: SHAPE,
      prefab: PREFAB,
      name: "R1",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({ action: "attach", shape: SHAPE, prefab: PREFAB, name: "R1" });
    expect(sent[0].params).not.toHaveProperty("confirm");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toEqual([{ path: "id:0x9", before: null, after: "RoadGeneratorEntity" }]);
    expect(r.readback).toEqual({
      id: "id:0x9",
      className: "RoadGeneratorEntity",
      undoName: "EMCP wb_generator attach",
    });
    expect(r.next).toContain("wb_undo_redo");
  });

  it("passes the handler's rename note on as a warning", async () => {
    const { client } = fakeClient(
      ok({
        id: "id:0x9",
        className: "RoadGeneratorEntity",
        undoName: "u",
        message:
          "attached RoadGeneratorEntity to the shape (the editor named it 'R1_1', not 'R1'); undo with wb_undo_redo",
      }),
    );
    const r = await runGenerator(client, {
      action: "attach",
      shape: SHAPE,
      prefab: PREFAB,
      name: "R1",
    });
    expect(r.ok && r.warnings[0]).toContain("R1_1");
  });

  it("passes GATED through with the probe and the switch in next", async () => {
    const { client } = fakeClient(
      refused("GATED", "GATED: attach waits", "the main session opens it after P-W7-10 passes"),
    );
    const r = await runGenerator(client, { action: "attach", shape: SHAPE, prefab: PREFAB });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("GATED");
    expect(r.message).toBe("GATED: attach waits");
    expect(r.next).toContain("P-W7-10");
    expect(r.next).toContain("ATTACH_OPEN");
  });

  it("maps NOT_A_GENERATOR (local), RESOURCE_NOT_FOUND, NOT_A_SHAPE and NOT_IN_PROJECT", async () => {
    for (const code of ["NOT_A_GENERATOR", "RESOURCE_NOT_FOUND", "NOT_A_SHAPE", "NOT_IN_PROJECT"]) {
      const { client } = fakeClient(refused(code, `m ${code}`, ""));
      const r = await runGenerator(client, { action: "attach", shape: SHAPE, prefab: PREFAB });
      expect(!r.ok && r.code).toBe(code);
      expect(!r.ok && r.warnings).toEqual([]);
      expect(!r.ok && r.next.length).toBeGreaterThan(0);
    }
  });

  it("an error after the action keeps what the handler read", async () => {
    const { client } = fakeClient({
      status: "error",
      code: "ENGINE_FALSE",
      message: "CreateEntity returned null",
      next: "read the log",
      undoName: "EMCP wb_generator attach",
    });
    const r = await runGenerator(client, { action: "attach", shape: SHAPE, prefab: PREFAB });
    expect(!r.ok && r.code).toBe("ENGINE_FALSE");
    expect(!r.ok && r.readback).toEqual({ undoName: "EMCP wb_generator attach" });
  });
});

describe("detach", () => {
  it("answers the deleted id and the undo name", async () => {
    const { client, sent } = fakeClient(
      ok({ id: "id:0x9", undoName: "EMCP wb_generator detach", message: "deleted 1 generator(s)" }),
    );
    const r = await runGenerator(client, { action: "detach", entity: "id:9" });
    expect(sent[0].params).toEqual({ action: "detach", entity: "id:0x0000000000000009" });
    expect(sent[0].options.access).toBe("mutate");
    expect(r.ok && r.changed).toEqual([{ path: "id:0x9", before: "present", after: null }]);
    expect(r.ok && r.next).toContain("wb_undo_redo");
  });

  it("GATED names P-W7-10, NOT_A_GENERATOR passes through", async () => {
    let r = await runGenerator(fakeClient(refused("GATED")).client, {
      action: "detach",
      entity: SHAPE,
    });
    expect(!r.ok && r.next).toContain("P-W7-10");
    r = await runGenerator(fakeClient(refused("NOT_A_GENERATOR", "not one")).client, {
      action: "detach",
      entity: SHAPE,
    });
    expect(!r.ok && r.code).toBe("NOT_A_GENERATOR");
  });
});

describe("regenerate", () => {
  it("answers the generators reached and the undo name", async () => {
    const { client, sent } = fakeClient(
      ok({
        generators: 2,
        undoName: "EMCP wb_generator regenerate",
        message: "regenerated 2 of 2",
      }),
    );
    const r = await runGenerator(client, { action: "regenerate", shape: SHAPE });
    expect(sent[0].options.access).toBe("mutate");
    expect(r.ok && r.readback).toMatchObject({
      generators: 2,
      undoName: "EMCP wb_generator regenerate",
    });
    expect(r.ok && r.changed).toHaveLength(1);
    expect(r.ok && r.warnings).toEqual([]);
  });

  it("zero generators is ok with a warning and no change", async () => {
    const { client } = fakeClient(
      ok({ generators: 0, message: "the shape has no generator children" }),
    );
    const r = await runGenerator(client, { action: "regenerate", shape: SHAPE });
    expect(r.ok && r.changed).toEqual([]);
    expect(r.ok && r.warnings[0]).toContain("no generator children");
  });

  it("warns when route B reports events off", async () => {
    const { client } = fakeClient(
      ok({
        generators: 1,
        undoName: "u",
        message:
          "regenerated 1 of 1; generator events are off, so route B may not have rebuilt anything",
      }),
    );
    const r = await runGenerator(client, { action: "regenerate", shape: SHAPE });
    expect(r.ok && r.warnings.join(" ")).toContain("events are off");
  });

  it("GATED names P-W7-11 and REGENERATE_OPEN; ENGINE_FALSE and NOT_A_SHAPE map", async () => {
    let r = await runGenerator(fakeClient(refused("GATED")).client, {
      action: "regenerate",
      shape: SHAPE,
    });
    expect(!r.ok && r.next).toContain("P-W7-11");
    expect(!r.ok && r.next).toContain("REGENERATE_OPEN");
    r = await runGenerator(
      fakeClient({ status: "error", code: "ENGINE_FALSE", message: "x", generators: 1 }).client,
      {
        action: "regenerate",
        shape: SHAPE,
      },
    );
    expect(!r.ok && r.code).toBe("ENGINE_FALSE");
    expect(!r.ok && r.readback).toEqual({ generators: 1 });
    r = await runGenerator(fakeClient(refused("NOT_A_SHAPE")).client, {
      action: "regenerate",
      shape: SHAPE,
    });
    expect(!r.ok && r.code).toBe("NOT_A_SHAPE");
  });
});

describe("pointData", () => {
  it("add sends the class and reads the count back", async () => {
    const { client, sent } = fakeClient(ok({ count: 1, undoName: "EMCP wb_generator pointData" }));
    const r = await runGenerator(client, {
      action: "pointData",
      shape: SHAPE,
      op: "add",
      index: 3,
      dataClass: "ForestGeneratorPointData",
    });
    expect(sent[0].params).toEqual({
      action: "pointData",
      shape: SHAPE,
      op: "add",
      index: 3,
      dataClass: "ForestGeneratorPointData",
    });
    expect(r.ok && r.readback).toEqual({
      op: "add",
      index: 3,
      count: 1,
      undoName: "EMCP wb_generator pointData",
    });
    expect(r.ok && r.changed).toEqual([
      { path: `${SHAPE}.Points[3].Data.count`, before: 0, after: 1 },
    ]);
  });

  it("remove sends dataIndex", async () => {
    const { client, sent } = fakeClient(ok({ count: 0, undoName: "u" }));
    const r = await runGenerator(client, {
      action: "pointData",
      shape: SHAPE,
      op: "remove",
      index: 0,
      dataIndex: 0,
    });
    expect(sent[0].params.dataIndex).toBe(0);
    expect(r.ok && r.changed).toEqual([
      { path: `${SHAPE}.Points[0].Data.count`, before: 1, after: 0 },
    ]);
  });

  it("GATED names P-W7-13; INVALID_ARGUMENT from the handler (no such point) maps", async () => {
    const args = { action: "pointData", shape: SHAPE, op: "remove", index: 9 };
    let r = await runGenerator(fakeClient(refused("GATED")).client, args);
    expect(!r.ok && r.next).toContain("P-W7-13");
    expect(!r.ok && r.next).toContain("POINTDATA_OPEN");
    r = await runGenerator(
      fakeClient({
        status: "error",
        code: "INVALID_ARGUMENT",
        message: "the shape has no point 9",
        next: "",
      }).client,
      args,
    );
    expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
    expect(!r.ok && r.message).toContain("no point 9");
  });
});

describe("events", () => {
  it("sends enabled as a JSON boolean and answers was and the state after", async () => {
    const on = fakeClient(ok({ eventsEnabled: 1, was: 0 }));
    const r = await runGenerator(on.client, { action: "events", enabled: true });
    expect(on.sent[0].params).toEqual({ action: "events", enabled: true });
    expect(on.sent[0].options.access).toBe("mutate");
    expect(r.ok && r.readback).toEqual({ eventsEnabled: true, was: false });
    expect(r.ok && r.changed).toEqual([{ path: "generatorEvents", before: false, after: true }]);
    expect(r.ok && r.next).toContain("enabled: false");

    const off = fakeClient(ok({ eventsEnabled: 0, was: 1 }));
    await runGenerator(off.client, { action: "events", enabled: false });
    expect(off.sent[0].params).toEqual({ action: "events", enabled: false });
  });

  it("GATED names P-W7-12; WRONG_MODE and ENGINE_FALSE map", async () => {
    let r = await runGenerator(fakeClient(refused("GATED")).client, {
      action: "events",
      enabled: true,
    });
    expect(!r.ok && r.next).toContain("P-W7-12");
    expect(!r.ok && r.next).toContain("EVENTS_OPEN");
    r = await runGenerator(fakeClient(refused("WRONG_MODE")).client, {
      action: "events",
      enabled: true,
    });
    expect(!r.ok && r.code).toBe("WRONG_MODE");
    r = await runGenerator(
      fakeClient({ status: "error", code: "ENGINE_FALSE", message: "x" }).client,
      {
        action: "events",
        enabled: true,
      },
    );
    expect(!r.ok && r.code).toBe("ENGINE_FALSE");
  });
});

describe("handler and client failures", () => {
  it("an unknown handler code becomes HANDLER_ERROR (error) or INVALID_ARGUMENT (refused) with a warning", async () => {
    let r = await runGenerator(fakeClient({ status: "error", code: "WHAT", message: "x" }).client, {
      action: "list",
    });
    expect(!r.ok && r.code).toBe("HANDLER_ERROR");
    expect(!r.ok && r.warnings[0]).toContain("WHAT");
    r = await runGenerator(fakeClient({ status: "refused", code: "WHAT", message: "x" }).client, {
      action: "list",
    });
    expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
  });

  it("an unexpected status is UNREACHABLE", async () => {
    const r = await runGenerator(fakeClient({ status: "weird" }).client, { action: "list" });
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });

  it("maps WorkbenchError LOST, MODAL_OPEN and WEDGED, and never retries", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(new WorkbenchError(`boom ${code}`, code));
      const r = await runGenerator(client, { action: "attach", shape: SHAPE, prefab: PREFAB });
      expect(!r.ok && r.code).toBe(code);
      expect(sent).toHaveLength(1);
      if (code === "LOST") expect(!r.ok && r.next).toContain("never retried");
    }
  });

  it("a lost events call points at list for the state; a lost read has no read-back hint", async () => {
    const ev = await runGenerator(fakeClient(new WorkbenchError("x", "LOST")).client, {
      action: "events",
      enabled: true,
    });
    expect(!ev.ok && ev.next).toContain("eventsEnabled");
    const rd = await runGenerator(fakeClient(new WorkbenchError("x", "LOST")).client, {
      action: "list",
    });
    expect(!rd.ok && rd.next).not.toContain("never retried");
  });

  it("another client error is UNREACHABLE", async () => {
    const r = await runGenerator(
      fakeClient(new WorkbenchError("no socket", "CONNECTION_REFUSED")).client,
      {
        action: "list",
      },
    );
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });
});

describe("truthy", () => {
  it("reads 1, '1', true and 'true'", () => {
    for (const v of [1, "1", true, "true"]) expect(truthy(v)).toBe(true);
    for (const v of [0, "0", false, "", undefined, null]) expect(truthy(v)).toBe(false);
  });
});
