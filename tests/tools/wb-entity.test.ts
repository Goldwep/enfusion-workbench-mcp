import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import {
  ENTITY_CONTRACT,
  WB_ENTITY_DESCRIPTION,
  flatInputShape,
  parseRow,
  prepareRequest,
  rowsToObjects,
  runEntity,
} from "../../src/tools/wb-entity.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a function and records what was sent. */
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
const A = "id:0x00000000000000aa";
const B = "id:0x00000000000000bb";
const rowOf = (id: string, name: string) => `${id}|${name}|GenericEntity||worlds/a.layer|0|2`;

describe("wb_entity contract", () => {
  it("loads, and its description fits the 400-char budget", () => {
    expect(ENTITY_CONTRACT.tool).toBe("wb_entity");
    expect(ENTITY_CONTRACT.handler).toBe("EMCP_WB_Entity");
    expect(WB_ENTITY_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("has the twelve actions, reads not mutating, writes projectOnly", () => {
    expect(ENTITY_CONTRACT.actions.map((a) => a.name)).toEqual([
      "list",
      "get",
      "children",
      "query",
      "create",
      "clone",
      "delete",
      "parent",
      "unparent",
      "rename",
      "transform",
      "setLayer",
    ]);
    for (const a of ENTITY_CONTRACT.actions) {
      expect(a.mutating, a.name).toBe(!["list", "get", "children", "query"].includes(a.name));
      expect(a.projectOnly, a.name).toBe(a.mutating);
    }
  });

  it("gives registerTool a flat shape with every param key and no confirm", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "entity",
      "entities",
      "parent",
      "cursor",
      "limit",
      "keepWorldTransform",
    ])
      expect(shape[k], k).toBeDefined();
    expect(shape.confirm).toBeUndefined();
  });
});

describe("prepareRequest (nothing sent on refusal)", () => {
  const refused: Array<[string, Record<string, unknown>]> = [
    ["unknown key for the action", { action: "get", entity: A, name: "x" }],
    ["no confirm key exists", { action: "delete", entities: [A], confirm: true }],
    ["missing entity", { action: "get" }],
    ["bad reference scheme", { action: "get", entity: "42" }],
    ["id that is not hex", { action: "get", entity: "id:zz" }],
    ["empty name ref", { action: "get", entity: "name:" }],
    ["signed index", { action: "get", entity: "index:-1" }],
    ["bad parent reference", { action: "create", prefab: "GenericEntity", parent: "foo" }],
    ["empty entities", { action: "delete", entities: [] }],
    ["bad member of entities", { action: "delete", entities: [A, "nope"] }],
    ["over 200 entities", { action: "delete", entities: Array.from({ length: 201 }, () => A) }],
    ["parent among entities", { action: "parent", parent: A, entities: [B, "id:0xAA"] }],
    ["malformed cursor", { action: "list", cursor: "5" }],
    ["cursor start past count", { action: "list", cursor: "9:3" }],
    ["limit 0", { action: "list", limit: 0 }],
    ["limit over 200", { action: "children", entity: A, limit: 201 }],
    ["negative subScene", { action: "list", subScene: -1 }],
    ["fractional subScene", { action: "list", subScene: 1.5 }],
    ["query with no shape", { action: "query" }],
    [
      "query with both shapes",
      { action: "query", center: "0 0 0", radius: 1, mins: "0 0 0", maxs: "1 1 1" },
    ],
    ["sphere without radius", { action: "query", center: "0 0 0" }],
    ["sphere with radius 0", { action: "query", center: "0 0 0", radius: 0 }],
    ["box with one corner", { action: "query", mins: "0 0 0" }],
    ["center with two numbers", { action: "query", center: "1 2", radius: 3 }],
    ["center that is not numeric", { action: "query", center: "a b c", radius: 3 }],
    ["create without prefab", { action: "create" }],
    ["create with blank prefab", { action: "create", prefab: "  " }],
    ["create with bad coords", { action: "create", prefab: "X", coords: "1,2" }],
    ["rename with empty name", { action: "rename", entity: A, name: "" }],
    ["transform with nothing", { action: "transform", entity: A }],
    ["transform scale 0", { action: "transform", entity: A, scale: 0 }],
    ["transform scale negative", { action: "transform", entity: A, scale: -2 }],
    ["transform bad angles", { action: "transform", entity: A, angles: "1 2 3 4" }],
    ["setLayer without layer", { action: "setLayer", entities: [A] }],
    ["setLayer with empty layer", { action: "setLayer", entities: [A], layer: "" }],
    ["clone cloneChildren not a bool", { action: "clone", entity: A, cloneChildren: "yes" }],
    ["unknown action", { action: "explode" }],
  ];
  for (const [label, input] of refused) {
    it(`refuses ${label} with INVALID_ARGUMENT`, async () => {
      const p = prepareRequest(input);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
      const { client, sent } = fakeClient(() => ok());
      const res = await runEntity(client, input);
      expect(res.ok).toBe(false);
      expect(sent).toHaveLength(0);
    });
  }

  it("canonicalises every reference to id:0x<16 hex> and keeps name: and index:", () => {
    const p = prepareRequest({
      action: "parent",
      parent: "id:AB",
      entities: ["id:0xcd", "name:Tree 1", "index:7"],
    });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.params.parent).toBe("id:0x00000000000000ab");
      expect(p.params.entities).toEqual(["id:0x00000000000000cd", "name:Tree 1", "index:7"]);
    }
  });

  it("targets the entity for single-entity actions and the world otherwise", () => {
    const get = prepareRequest({ action: "get", entity: "name:Rock" });
    expect(get.ok && get.target).toBe("entity:name:Rock");
    const list = prepareRequest({ action: "list" });
    expect(list.ok && list.target).toBe("open:WorldEditor");
    const del = prepareRequest({ action: "delete", entities: [A] });
    expect(del.ok && del.target).toBe("open:WorldEditor");
  });

  it("accepts comma vectors, scientific numbers and the full limit", () => {
    expect(
      prepareRequest({ action: "create", prefab: "X", coords: "1, 2.5, -3e2", angles: "0 90 0" })
        .ok,
    ).toBe(true);
    expect(prepareRequest({ action: "list", limit: 200, cursor: "50:300" }).ok).toBe(true);
    expect(prepareRequest({ action: "query", mins: "0 0 0", maxs: "5 5 5" }).ok).toBe(true);
  });

  it("marks reads read and writes mutate", () => {
    const names = ENTITY_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name);
    expect(names).toHaveLength(8);
  });
});

describe("runEntity reads", () => {
  it("list sends a read call with the filters and maps the rows", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        rows: [rowOf(A, "Rock"), rowOf(B, "Tree")],
        total: 2,
        nextCursor: "",
      }),
    );
    const res = await runEntity(client, {
      action: "list",
      className: "Generic",
      name: "o",
      topLevel: true,
      limit: 2,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_Entity");
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toMatchObject({
      action: "list",
      className: "Generic",
      name: "o",
      topLevel: true,
      limit: 2,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toBeNull();
      expect(res.next).toBeUndefined();
      expect(res.readback).toMatchObject({
        total: 2,
        nextCursor: null,
        rows: [
          {
            id: A,
            name: "Rock",
            class: "GenericEntity",
            parent: "",
            layer: "worlds/a.layer",
            sub: 0,
            kids: 2,
          },
          { id: B, name: "Tree" },
        ],
      });
    }
  });

  it("list pages: a next page carries nextCursor and says how to continue", async () => {
    const { client } = fakeClient(() =>
      ok({ rows: [rowOf(A, "Rock")], total: 3, nextCursor: "1:3" }),
    );
    const res = await runEntity(client, { action: "list", limit: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.readback as Record<string, unknown>).nextCursor).toBe("1:3");
      expect(res.next).toContain("1:3");
    }
  });

  it("list with a cursor passes it through and reads the next page", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ rows: [rowOf(B, "Tree")], total: 2, nextCursor: "" }),
    );
    const res = await runEntity(client, { action: "list", limit: 1, cursor: "1:2" });
    expect(sent[0].params.cursor).toBe("1:2");
    expect(res.ok).toBe(true);
  });

  it("answers STALE_CURSOR from the handler, and also when the total moved under a cursor", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "STALE_CURSOR",
      next: "read again without a cursor",
      message: "STALE_CURSOR: the cursor was issued for 3 items, the list now has 4",
    }));
    const res = await runEntity(client, { action: "list", cursor: "1:3" });
    expect(res).toMatchObject({
      ok: false,
      code: "STALE_CURSOR",
      next: "read again without a cursor",
    });

    // A handler that answers ok with a different total is caught here too.
    const { client: c2 } = fakeClient(() => ok({ rows: [], total: 4, nextCursor: "" }));
    const r2 = await runEntity(c2, { action: "children", entity: A, cursor: "1:3" });
    expect(r2).toMatchObject({ ok: false, code: "STALE_CURSOR" });
  });

  it("children sends the canonical entity and maps rows", async () => {
    const { client, sent } = fakeClient(() => ok({ rows: [rowOf(B, "Wheel")], total: 1 }));
    const res = await runEntity(client, { action: "children", entity: "id:AA" });
    expect(sent[0].params).toMatchObject({ action: "children", entity: A });
    expect(sent[0].options.access).toBe("read");
    expect(res.ok && res.target).toBe(`entity:${A}`);
    expect(res.ok && (res.readback as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("query maps a sphere and warns when the handler's cap was hit", async () => {
    const { client, sent } = fakeClient(() => ok({ rows: [rowOf(A, "Rock")], total: 20000 }));
    const res = await runEntity(client, {
      action: "query",
      center: "10 0 10",
      radius: 5,
    });
    expect(sent[0].params).toMatchObject({ center: "10 0 10", radius: "5" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings.join(" ")).toContain("20000");
  });

  it("query maps a box", async () => {
    const { client, sent } = fakeClient(() => ok({ rows: [], total: 0 }));
    const res = await runEntity(client, { action: "query", mins: "0 0 0", maxs: "9 9 9" });
    expect(sent[0].params).toMatchObject({ mins: "0 0 0", maxs: "9 9 9" });
    expect(res.ok && (res.readback as { total: number }).total).toBe(0);
  });

  it("get maps the detail, the 1/0 bools and the components", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        id: A,
        name: "Rock",
        niceName: "Rock (Prefab)",
        className: "GenericEntity",
        ancestor: "{AAAA}Prefabs/Rock.et",
        parentId: "",
        layer: "worlds/a.layer",
        subScene: 0,
        coords: "1 2 3",
        angles: "0 90 0",
        visible: 1,
        selected: 0,
        childCount: 0,
        components: ["0|MeshObject", "1|RigidBody"],
      }),
    );
    const res = await runEntity(client, { action: "get", entity: "name:Rock" });
    expect(sent[0].params).toEqual({ action: "get", entity: "name:Rock" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.readback).toMatchObject({
        id: A,
        ancestor: "{AAAA}Prefabs/Rock.et",
        parentId: null,
        visible: true,
        selected: false,
        components: [
          { index: 0, class: "MeshObject" },
          { index: 1, class: "RigidBody" },
        ],
      });
    }
  });

  it("a missing entity is ENTITY_NOT_FOUND with the handler's next", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENTITY_NOT_FOUND",
      next: "list the entities (wb_entity list) and pass the id: it answers",
      message: "no entity named Rock",
    }));
    const res = await runEntity(client, { action: "get", entity: "name:Rock" });
    expect(res).toMatchObject({
      ok: false,
      code: "ENTITY_NOT_FOUND",
      target: "entity:name:Rock",
      next: "list the entities (wb_entity list) and pass the id: it answers",
    });
  });
});

describe("runEntity writes (all mutate, no confirm, undo named)", () => {
  it("create maps the request and the new entity", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        id: A,
        name: "Rock1",
        className: "GenericEntity",
        parentId: "",
        layer: "worlds/a.layer",
        undoName: "EMCP wb_entity create",
      }),
    );
    const res = await runEntity(client, {
      action: "create",
      prefab: "{AAAA}Prefabs/Rock.et",
      name: "Rock1",
      coords: "1 2 3",
      angles: "0 0 0",
      layer: "worlds/a.layer",
      placement: false,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toMatchObject({
      action: "create",
      prefab: "{AAAA}Prefabs/Rock.et",
      name: "Rock1",
      coords: "1 2 3",
      placement: false,
    });
    expect(sent[0].params.confirm).toBeUndefined();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: A, before: null, after: "GenericEntity" }]);
      expect(res.readback).toMatchObject({ id: A, undoName: "EMCP wb_entity create" });
      expect(res.next).toMatch(/wb_undo_redo/);
    }
  });

  it("create under a parent sends the canonical parent", async () => {
    const { client, sent } = fakeClient(() => ok({ id: B, className: "X", undoName: "u" }));
    await runEntity(client, { action: "create", prefab: "X", parent: "id:aa" });
    expect(sent[0].params.parent).toBe(A);
  });

  it("clone maps the request and the copy", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ id: B, name: "Rock2", childCount: 3, undoName: "EMCP wb_entity clone" }),
    );
    const res = await runEntity(client, {
      action: "clone",
      entity: A,
      name: "Rock2",
      cloneChildren: false,
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toMatchObject({ entity: A, name: "Rock2", cloneChildren: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: B, before: null, after: "Rock2" }]);
      expect(res.readback).toMatchObject({ id: B, childCount: 3 });
    }
  });

  it("delete sends the refs and reports deleted ids, with skipped refs as a warning", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ deleted: [A, B], missing: ["name:Gone"], undoName: "EMCP wb_entity delete" }),
    );
    const res = await runEntity(client, { action: "delete", entities: [A, "id:BB", "name:Gone"] });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params.entities).toEqual([A, B, "name:Gone"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([
        { path: A, before: "present", after: null },
        { path: B, before: "present", after: null },
      ]);
      expect(res.readback).toMatchObject({ missing: ["name:Gone"] });
      expect(res.warnings.join(" ")).toContain("name:Gone");
    }
  });

  it("parent passes keepWorldTransform and reports the parented ids", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ parented: [B], missing: [], undoName: "EMCP wb_entity parent" }),
    );
    const res = await runEntity(client, {
      action: "parent",
      parent: A,
      entities: [B],
      keepWorldTransform: false,
    });
    expect(sent[0].params).toMatchObject({ parent: A, entities: [B], keepWorldTransform: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: B, before: null, after: `parent ${A}` }]);
      expect(res.readback).toMatchObject({ parent: A, parented: [B] });
    }
  });

  it("unparent reports the ids that left their parent", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ unparented: [A], missing: [], undoName: "EMCP wb_entity unparent" }),
    );
    const res = await runEntity(client, { action: "unparent", entities: [A] });
    expect(sent[0].params).toMatchObject({ action: "unparent", entities: [A] });
    expect(res.ok && res.changed).toEqual([{ path: A, before: "parented", after: null }]);
  });

  it("unparent with nothing to do is ok and changes nothing", async () => {
    const { client } = fakeClient(() =>
      ok({ message: "nothing to do: no named entity has a parent" }),
    );
    const res = await runEntity(client, { action: "unparent", entities: [A] });
    expect(res.ok && res.changed).toEqual([]);
  });

  it("rename answers the before and after name", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ id: A, before: "Rock", after: "Boulder", undoName: "EMCP wb_entity rename" }),
    );
    const res = await runEntity(client, { action: "rename", entity: A, name: "Boulder" });
    expect(sent[0].params).toMatchObject({ entity: A, name: "Boulder" });
    expect(res.ok && res.changed).toEqual([{ path: A, before: "Rock", after: "Boulder" }]);
  });

  it("rename that the engine refused is ENGINE_FALSE with the read-back kept", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      next: "pick another name",
      message: "ENGINE_FALSE: RenameEntity returned false (name in use?)",
      id: A,
      before: "Rock",
      after: "Rock",
      undoName: "EMCP wb_entity rename",
    }));
    const res = await runEntity(client, { action: "rename", entity: A, name: "Tree" });
    expect(res).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
      next: "pick another name",
      readback: { id: A, before: "Rock", after: "Rock" },
    });
  });

  it("transform sends only the given keys and answers per-key changes", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        id: A,
        before: "0 0 0|0 0 0|1",
        after: "5 0 5|0 0 0|2",
        undoName: "EMCP wb_entity transform",
      }),
    );
    const res = await runEntity(client, {
      action: "transform",
      entity: A,
      coords: "5 0 5",
      scale: 2,
    });
    // Floats go as text: a JSON integer never reaches a float field (W1 fix-up 1).
    expect(sent[0].params).toEqual({ action: "transform", entity: A, coords: "5 0 5", scale: "2" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([
        { path: `${A}.coords`, before: "0 0 0", after: "5 0 5" },
        { path: `${A}.scale`, before: "1", after: "2" },
      ]);
      expect(res.readback).toMatchObject({ coords: "5 0 5", angles: "0 0 0", scale: 2 });
    }
  });

  it("transform warns for a key that kept its value", async () => {
    const { client } = fakeClient(() =>
      ok({ id: A, before: "1 1 1|0 0 0|1", after: "1 1 1|0 0 0|1", undoName: "u" }),
    );
    const res = await runEntity(client, { action: "transform", entity: A, coords: "1 1 1" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([]);
      expect(res.warnings.join(" ")).toContain("coords is unchanged");
    }
  });

  it("setLayer maps the layer, the sub-scene and the moved ids", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        moved: [A, B],
        missing: [],
        layer: "worlds/b.layer",
        undoName: "EMCP wb_entity setLayer",
      }),
    );
    const res = await runEntity(client, {
      action: "setLayer",
      entities: [A, B],
      layer: "worlds/b.layer",
      subScene: 1,
    });
    expect(sent[0].params).toMatchObject({
      layer: "worlds/b.layer",
      subScene: 1,
      entities: [A, B],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([
        { path: A, before: null, after: "layer worlds/b.layer" },
        { path: B, before: null, after: "layer worlds/b.layer" },
      ]);
      expect(res.readback).toMatchObject({ layer: "worlds/b.layer", moved: [A, B] });
    }
  });
});

describe("handler refusals and client failures", () => {
  it("maps a project refusal and a play-mode refusal to their codes and next", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NOT_IN_PROJECT",
      next: "install the handlers in the project you have open",
      message:
        "NOT_IN_PROJECT: mutating actions need the handlers installed in the open project; nothing was changed | next: install the handlers in the project you have open",
    }));
    const res = await runEntity(client, { action: "delete", entities: [A] });
    expect(res).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
      next: "install the handlers in the project you have open",
    });

    const { client: c2 } = fakeClient(() => ({
      status: "refused",
      code: "WRONG_MODE",
      next: "stop play first (wb_world stop)",
      message: "WRONG_MODE: the World Editor is in play mode; nothing was changed",
    }));
    const r2 = await runEntity(c2, { action: "rename", entity: A, name: "x" });
    expect(r2).toMatchObject({
      ok: false,
      code: "WRONG_MODE",
      next: "stop play first (wb_world stop)",
    });
  });

  it("falls back to the vocabulary next when the handler sends none", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "NO_WORLD",
      next: "",
      message: "no API",
    }));
    const res = await runEntity(client, { action: "list" });
    expect(res).toMatchObject({ ok: false, code: "NO_WORLD" });
    if (!res.ok) expect(res.next).toMatch(/open one first/);
  });

  it("an answer with no code is HANDLER_ERROR", async () => {
    const { client } = fakeClient(() => ({ status: "error", message: "boom" }));
    const res = await runEntity(client, { action: "list" });
    expect(res).toMatchObject({ ok: false, code: "HANDLER_ERROR", message: "boom" });
  });

  it("keeps the partial result of a delete the engine refused", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      next: "list the entities to see what is left; undo with wb_undo_redo",
      message: "ENGINE_FALSE: the delete call returned false",
      missing: ["name:Gone"],
      undoName: "EMCP wb_entity delete",
    }));
    const res = await runEntity(client, { action: "delete", entities: [A, "name:Gone"] });
    expect(res).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
      readback: { missing: ["name:Gone"], undoName: "EMCP wb_entity delete" },
    });
  });

  it("LOST, MODAL_OPEN and WEDGED keep their names and are never retried", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError("x", code));
      const res = await runEntity(client, { action: "delete", entities: [A] });
      expect(sent).toHaveLength(1);
      expect(res).toMatchObject({ ok: false, code });
      if (!res.ok) expect(res.next).toBeTruthy();
    }
  });

  it("rethrows an error that is not a WorkbenchError", async () => {
    const { client } = fakeClient(() => new TypeError("bug"));
    await expect(runEntity(client, { action: "list" })).rejects.toThrow("bug");
  });
});

describe("rows", () => {
  it("parseRow reads seven cells and refuses any other count", () => {
    expect(parseRow(rowOf(A, "Rock"))).toEqual({
      id: A,
      name: "Rock",
      class: "GenericEntity",
      parent: "",
      layer: "worlds/a.layer",
      sub: 0,
      kids: 2,
    });
    expect(parseRow("a|b|c")).toBeUndefined();
    expect(rowsToObjects(["a|b|c"])).toEqual([{ raw: "a|b|c" }]);
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:mcp:action/wb_entity.children
// census:mcp:action/wb_entity.clone
// census:mcp:action/wb_entity.create
// census:mcp:action/wb_entity.delete
// census:mcp:action/wb_entity.get
// census:mcp:action/wb_entity.list
// census:mcp:action/wb_entity.parent
// census:mcp:action/wb_entity.query
// census:mcp:action/wb_entity.rename
// census:mcp:action/wb_entity.setLayer
// census:mcp:action/wb_entity.transform
// census:mcp:action/wb_entity.unparent
