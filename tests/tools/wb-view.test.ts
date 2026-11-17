import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import {
  VIEW_CONTRACT,
  WB_VIEW_DESCRIPTION,
  flatInputShape,
  parseRow,
  prepareRequest,
  runView,
} from "../../src/tools/wb-view.js";
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
): {
  client: WorkbenchClient;
  sent: Sent[];
} {
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
const ID = "id:0x00000000000000ab";

describe("wb_view contract", () => {
  it("loads, and its description fits the 400-char budget", () => {
    expect(VIEW_CONTRACT.tool).toBe("wb_view");
    expect(WB_VIEW_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("marks every mutating action projectOnly and the reads not", () => {
    const mutating = ["select", "setVisible", "setCamera", "focus", "placeAtPixel"];
    for (const a of VIEW_CONTRACT.actions) {
      expect(a.mutating, a.name).toBe(mutating.includes(a.name));
      expect(a.projectOnly, a.name).toBe(a.mutating);
    }
  });

  it("gives registerTool a flat shape with every param key", () => {
    const shape = flatInputShape();
    for (const k of ["action", "cursor", "limit", "mode", "entities", "visible", "coords", "look"])
      expect(shape[k], k).toBeDefined();
    for (const k of [
      "entity",
      "distance",
      "x",
      "y",
      "flags",
      "clamped",
      "prefab",
      "layer",
      "window",
    ])
      expect(shape[k], k).toBeDefined();
    expect(shape.confirm).toBeUndefined();
  });
});

describe("prepareRequest (nothing sent on refusal)", () => {
  it("refuses an unknown action, a stray key and a missing required key", () => {
    const cases = [
      { action: "bogus" },
      { action: "camera", x: 1 },
      { action: "selection", confirm: true },
      { action: "select" },
      { action: "setVisible", entities: [ID] },
      { action: "setCamera", coords: "0 0 0" },
      { action: "focus" },
      { action: "trace", x: 1 },
      { action: "placeAtPixel", x: 1, y: 1 },
    ];
    for (const c of cases) {
      const p = prepareRequest(c);
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code, JSON.stringify(c)).toBe("INVALID_ARGUMENT");
    }
  });

  it("refuses a bad limit and a bad cursor", () => {
    for (const c of [
      { action: "selection", limit: 0 },
      { action: "selection", limit: 201 },
      { action: "selection", cursor: "abc" },
      { action: "selection", cursor: "9:3" },
      { action: "selection", cursor: "" },
    ]) {
      const p = prepareRequest(c);
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
    expect(prepareRequest({ action: "selection", cursor: "50:120", limit: 200 }).ok).toBe(true);
  });

  it("checks select mode and entities", () => {
    for (const c of [
      { action: "select", mode: "toggle", entities: [ID] },
      { action: "select", mode: "set" },
      { action: "select", mode: "add", entities: [] },
      { action: "select", mode: "clear", entities: [ID] },
      { action: "select", mode: "set", entities: ["entity:1"] },
      { action: "select", mode: "set", entities: ["id:zz"] },
      { action: "select", mode: "set", entities: ["index:-1"] },
      {
        action: "select",
        mode: "set",
        entities: Array.from({ length: 201 }, (_, i) => `index:${i}`),
      },
    ]) {
      const p = prepareRequest(c);
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("canonicalises entity references and keeps clear free of entities", () => {
    const p = prepareRequest({
      action: "select",
      mode: "set",
      entities: ["id:AB", "name:Tree", "index:3"],
    });
    expect(p.ok && p.params.entities).toEqual([ID, "name:Tree", "index:3"]);
    const c = prepareRequest({ action: "select", mode: "clear" });
    expect(c.ok && c.params).toEqual({ action: "select", mode: "clear" });
  });

  it("checks setVisible entities and passes visible false through", () => {
    const empty = prepareRequest({ action: "setVisible", entities: [], visible: true });
    expect(empty.ok).toBe(false);
    const p = prepareRequest({ action: "setVisible", entities: ["id:ab"], visible: false });
    expect(p.ok && p.params).toEqual({ action: "setVisible", entities: [ID], visible: false });
    expect(p.ok && p.mutating).toBe(true);
  });

  it("checks setCamera vectors", () => {
    for (const c of [
      { coords: "1 2", look: "0 0 1" },
      { coords: "1 2 x", look: "0 0 1" },
      { coords: "1,2,3", look: "0 0 1" },
      { coords: "1 2 3", look: "0 0 0" },
      { coords: "1 2 3", look: "0 0 1 0" },
      { coords: "1 2 Infinity", look: "0 0 1" },
    ]) {
      const p = prepareRequest({ action: "setCamera", ...c });
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
    const p = prepareRequest({ action: "setCamera", coords: " 1  2.5 -3 ", look: "0 -0.5 1" });
    expect(p.ok && p.params).toEqual({
      action: "setCamera",
      coords: "1 2.5 -3",
      look: "0 -0.5 1",
    });
  });

  it("checks focus entity and distance", () => {
    for (const c of [{ entity: "tree" }, { entity: "id:xyz" }, { entity: "id:ab", distance: -1 }]) {
      const p = prepareRequest({ action: "focus", ...c });
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
    const p = prepareRequest({ action: "focus", entity: "id:ab", distance: 0 });
    expect(p.ok && p.params).toEqual({ action: "focus", entity: ID, distance: "0" });
    expect(p.ok && p.target).toBe(ID);
  });

  it("checks trace pixels and flags, normalising the flag list", () => {
    for (const c of [
      { x: -1, y: 0 },
      { x: 0, y: -5 },
      { x: 1.5, y: 0 },
      { x: 1, y: 1, flags: "ENTS,NOPE" },
      { x: 1, y: 1, flags: "" },
    ]) {
      const p = prepareRequest({ action: "trace", ...c });
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
    const p = prepareRequest({ action: "trace", x: 10, y: 20, flags: "ents, world" });
    expect(p.ok && p.params.flags).toBe("ENTS,WORLD");
    expect(p.ok && p.mutating).toBe(false);
  });

  it("checks placeAtPixel", () => {
    for (const c of [
      { x: 1, y: 1, prefab: "  " },
      { x: -1, y: 1, prefab: "GenericEntity" },
      { x: 1, y: 1, prefab: "GenericEntity", window: -1 },
    ]) {
      const p = prepareRequest({ action: "placeAtPixel", ...c });
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
    const p = prepareRequest({
      action: "placeAtPixel",
      x: 5,
      y: 6,
      prefab: "{ABC}Prefabs/x.et",
      name: "n",
      layer: "Layer1",
      window: 0,
    });
    expect(p.ok && p.mutating).toBe(true);
  });
});

describe("runView request mapping and responses", () => {
  it("selection: sends a read call, parses rows and the next page", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        rows: [`${ID}|Tree|GenericEntity|id:0x0000000000000001|3|0|2`, "id:0x02|a/b|C||0|1|0"],
        mainId: ID,
        total: 120,
        nextCursor: "50:120",
      }),
    );
    const res = await runView(client, { action: "selection", limit: 50 });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_View");
    expect(sent[0].params).toEqual({ action: "selection", limit: 50 });
    expect(sent[0].options.access).toBe("read");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.action).toBe("selection");
    expect(res.target).toBe("open:WorldEditor");
    expect(res.changed).toBeNull();
    const rb = res.readback as Record<string, unknown>;
    expect(rb.total).toBe(120);
    expect(rb.mainId).toBe(ID);
    expect(rb.nextCursor).toBe("50:120");
    expect(rb.rows).toEqual([
      {
        id: ID,
        name: "Tree",
        class: "GenericEntity",
        parent: "id:0x0000000000000001",
        layer: 3,
        sub: 0,
        kids: 2,
      },
      { id: "id:0x02", name: "a/b", class: "C", parent: null, layer: 0, sub: 1, kids: 0 },
    ]);
    expect(res.next).toContain('cursor "50:120"');
  });

  it("selection: the last page has no next and no main", async () => {
    const { client } = fakeClient(() => ok({ rows: [], mainId: "", total: 0, nextCursor: "" }));
    const res = await runView(client, { action: "selection", cursor: "0:0" });
    expect(res.ok && res.next).toBeUndefined();
    expect(res.ok && (res.readback as Record<string, unknown>).mainId).toBeNull();
    expect(res.ok && (res.readback as Record<string, unknown>).nextCursor).toBeNull();
  });

  it("selection: a stale cursor comes back as STALE_CURSOR", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "STALE_CURSOR",
      next: "read again without a cursor",
      message: "STALE_CURSOR: the list changed",
    }));
    const res = await runView(client, { action: "selection", cursor: "50:120" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("STALE_CURSOR");
    expect(res.next).toBe("read again without a cursor");
  });

  it("select: mutate access, previous selection, missing refs as warnings", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ selectedCount: 2, missing: ["name:Gone"], previous: [ID] }),
    );
    const res = await runView(client, {
      action: "select",
      mode: "set",
      entities: ["id:ab", "name:Gone"],
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({ action: "select", mode: "set", entities: [ID, "name:Gone"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changed).toEqual([{ path: "selection", before: [ID], after: { count: 2 } }]);
    expect((res.readback as Record<string, unknown>).previous).toEqual([ID]);
    expect(res.warnings.join(" ")).toContain("name:Gone");
    expect(res.next).toContain("previous");
  });

  it("select clear: no entities sent, no next when nothing was selected", async () => {
    const { client, sent } = fakeClient(() => ok({ selectedCount: 0, previous: [] }));
    const res = await runView(client, { action: "select", mode: "clear" });
    expect(sent[0].params).toEqual({ action: "select", mode: "clear" });
    expect(res.ok && res.next).toBeUndefined();
  });

  it("setVisible: sends visible false, maps the read-back rows", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        changed: [`${ID}|false`, "id:0x02|false"],
        missing: [],
        undoName: "EMCP wb_view setVisible",
      }),
    );
    const res = await runView(client, {
      action: "setVisible",
      entities: ["id:ab", "id:2"],
      visible: false,
      recursive: false,
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toMatchObject({ visible: false, recursive: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changed).toEqual([
      { path: ID, before: null, after: { visible: false } },
      { path: "id:0x02", before: null, after: { visible: false } },
    ]);
    expect((res.readback as Record<string, unknown>).undoName).toBe("EMCP wb_view setVisible");
  });

  it("setVisible: a read-back mismatch is ENGINE_FALSE and keeps the rows", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      next: "read changed; undo with wb_undo_redo",
      message: "1 of 1 entities do not read back visible false",
      changed: [`${ID}|true`],
      missing: [],
      undoName: "EMCP wb_view setVisible",
    }));
    const res = await runView(client, {
      action: "setVisible",
      entities: ["id:ab"],
      visible: false,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("ENGINE_FALSE");
    expect(res.next).toBe("read changed; undo with wb_undo_redo");
    expect((res.readback as Record<string, unknown>).changed).toEqual([{ id: ID, visible: true }]);
  });

  it("camera: a read call with no parameters", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        coords: "1 2 3",
        angles: "0 90 0",
        direction: "0 0 1",
        screenWidth: 1920,
        screenHeight: 1080,
      }),
    );
    const res = await runView(client, { action: "camera" });
    expect(sent[0].params).toEqual({ action: "camera" });
    expect(sent[0].options.access).toBe("read");
    expect(res.ok && res.readback).toEqual({
      coords: "1 2 3",
      angles: "0 90 0",
      direction: "0 0 1",
      screenWidth: 1920,
      screenHeight: 1080,
    });
  });

  it("setCamera: before and after, and a warning that look is not returned", async () => {
    const { client, sent } = fakeClient(() => ok({ before: "0 0 0", after: "1 2 3" }));
    const res = await runView(client, { action: "setCamera", coords: "1 2 3", look: "0 0 1" });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({ action: "setCamera", coords: "1 2 3", look: "0 0 1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changed).toEqual([{ path: "camera.position", before: "0 0 0", after: "1 2 3" }]);
    expect(res.warnings.join(" ")).toContain("look direction");
  });

  it("focus: target is the entity, after is read back", async () => {
    const { client, sent } = fakeClient(() => ok({ id: ID, after: "4 5 6" }));
    const res = await runView(client, { action: "focus", entity: "id:ab", distance: 25 });
    expect(sent[0].params).toEqual({ action: "focus", entity: ID, distance: "25" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.target).toBe(ID);
    expect(res.changed).toEqual([{ path: "camera.position", before: null, after: "4 5 6" }]);
    expect((res.readback as Record<string, unknown>).distance).toBe(25);
  });

  it("focus without a distance: before, after and the framing distance the handler names", async () => {
    // W1.7 run 6: a fixed 10 m left a small prop invisible; the handler now frames the bounds.
    const { client, sent } = fakeClient(() =>
      ok({
        id: ID,
        before: "0 400 0",
        after: "0 0.1 -1.5",
        message:
          "camera at 0 0.1 -1.5 looking at id:ab (0 0.1 0, radius 0.12 m) from distance 1.5 m",
      }),
    );
    const res = await runView(client, { action: "focus", entity: "id:ab" });
    expect(sent[0].params).toEqual({ action: "focus", entity: ID });
    expect(res.ok && res.changed).toEqual([
      { path: "camera.position", before: "0 400 0", after: "0 0.1 -1.5" },
    ]);
    expect(res.ok && (res.readback as Record<string, unknown>).distance).toBe(1.5);
  });

  it("trace: hit arrives as 1/0 and a miss has no entity", async () => {
    const { client, sent } = fakeClient((_p, n) =>
      n === 0
        ? ok({ hit: 1, start: "0 0 0", end: "1 1 1", direction: "0 0 1", id: ID })
        : ok({ hit: 0, start: "0 0 0", end: "9 9 9", direction: "0 0 1", id: "" }),
    );
    const a = await runView(client, { action: "trace", x: 100, y: 50, flags: "ENTS" });
    expect(sent[0].params).toEqual({ action: "trace", x: 100, y: 50, flags: "ENTS" });
    expect(sent[0].options.access).toBe("read");
    expect(a.ok && a.readback).toMatchObject({ hit: true, entity: ID, end: "1 1 1" });
    const b = await runView(client, { action: "trace", x: 0, y: 0 });
    expect(b.ok && b.readback).toMatchObject({ hit: false, entity: null });
  });

  it("underCursor: pixel and entity", async () => {
    const { client, sent } = fakeClient(() => ok({ x: 640, y: 360, id: "" }));
    const res = await runView(client, { action: "underCursor", clamped: true });
    expect(sent[0].params).toEqual({ action: "underCursor", clamped: true });
    expect(res.ok && res.readback).toEqual({ x: 640, y: 360, entity: null });
  });

  it("placeAtPixel: mutate, creation reported with undo hint", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ id: ID, coords: "7 8 9", undoName: "EMCP wb_view placeAtPixel" }),
    );
    const res = await runView(client, {
      action: "placeAtPixel",
      x: 10,
      y: 20,
      prefab: "GenericEntity",
      name: "Marker",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({
      action: "placeAtPixel",
      x: 10,
      y: 20,
      prefab: "GenericEntity",
      name: "Marker",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changed).toEqual([{ path: ID, before: null, after: "created" }]);
    expect(res.readback).toEqual({
      id: ID,
      coords: "7 8 9",
      undoName: "EMCP wb_view placeAtPixel",
    });
    expect(res.next).toContain("undo");
  });

  it("an answer with no own undo point promises no undo (review F2)", async () => {
    const note =
      "; BeginEntityAction returned false (an edit action was already open), so no own undo point";
    const place = fakeClient(() =>
      ok({ id: ID, coords: "1 2 3", undoName: "EMCP wb_view placeAtPixel", message: `created${note}` }),
    );
    const p = await runView(place.client, { action: "placeAtPixel", x: 1, y: 1, prefab: "GenericEntity" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.next).not.toMatch(/wb_undo_redo/);
    expect(p.next).toContain(`wb_entity delete with entities ["${ID}"]`);
    expect(p.warnings.join(" ")).toMatch(/no undo point of its own/);

    const vis = fakeClient(() =>
      ok({ changed: [`${ID}|false`], undoName: "", message: "1 entities set visible false" }),
    );
    const v = await runView(vis.client, { action: "setVisible", entities: [ID], visible: false });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.next).not.toMatch(/wb_undo_redo/);
    expect(v.warnings.join(" ")).toMatch(/no undo point of its own/);
  });
});

describe("runView refusals and failures", () => {
  it("sends nothing when a request is refused in TypeScript", async () => {
    const { client, sent } = fakeClient(() => ok());
    const res = await runView(client, { action: "setCamera", coords: "x", look: "0 0 1" });
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("maps handler refusals to their vocabulary codes", async () => {
    const codes = [
      "NOT_IN_PROJECT",
      "WRONG_MODE",
      "NO_WORLD",
      "MODULE_NOT_OPEN",
      "ENTITY_NOT_FOUND",
      "PATH_NOT_FOUND",
      "INVALID_ARGUMENT",
    ];
    for (const code of codes) {
      const { client } = fakeClient(() => ({
        status: "refused",
        code,
        next: "do the next thing",
        message: `${code}: nothing was changed`,
      }));
      const res = await runView(client, { action: "select", mode: "clear" });
      expect(res.ok, code).toBe(false);
      if (res.ok) continue;
      expect(res.code).toBe(code);
      expect(res.next).toBe("do the next thing");
      expect(res.message).toContain(code);
    }
  });

  it("falls back to the table's next, and flags an unknown code", async () => {
    const { client } = fakeClient(() => ({ status: "refused", code: "WRONG_MODE", message: "m" }));
    const res = await runView(client, { action: "select", mode: "clear" });
    expect(!res.ok && res.next).toContain("edit mode");
    const odd = fakeClient(() => ({ status: "refused", code: "MYSTERY", message: "m" }));
    const r2 = await runView(odd.client, { action: "camera" });
    expect(!r2.ok && r2.code).toBe("INVALID_ARGUMENT");
    expect(!r2.ok && r2.warnings.join(" ")).toContain("MYSTERY");
    const err = fakeClient(() => ({ status: "error", code: "", message: "boom" }));
    const r3 = await runView(err.client, { action: "camera" });
    expect(!r3.ok && r3.code).toBe("HANDLER_ERROR");
  });

  it("maps LOST, MODAL_OPEN and WEDGED, and never retries", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError(`${code} happened`, code));
      const res = await runView(client, { action: "select", mode: "clear" });
      expect(res.ok, code).toBe(false);
      if (!res.ok) expect(res.code).toBe(code);
      expect(sent).toHaveLength(1);
    }
    const lost = fakeClient(() => new WorkbenchError("gone", "LOST"));
    const m = await runView(lost.client, { action: "select", mode: "clear" });
    expect(!m.ok && m.next).toContain("never retried");
    const r = await runView(lost.client, { action: "camera" });
    expect(!r.ok && r.next).not.toContain("never retried");
  });

  it("maps any other client error to UNREACHABLE", async () => {
    const { client } = fakeClient(() => new WorkbenchError("no answer", "TIMEOUT"));
    const res = await runView(client, { action: "camera" });
    expect(!res.ok && res.code).toBe("UNREACHABLE");
  });
});

describe("parseRow", () => {
  it("fills missing trailing cells", () => {
    expect(parseRow(`${ID}|n`)).toEqual({
      id: ID,
      name: "n",
      class: "",
      parent: null,
      layer: 0,
      sub: 0,
      kids: 0,
    });
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:mcp:action/wb_view.camera
// census:mcp:action/wb_view.focus
// census:mcp:action/wb_view.placeAtPixel
// census:mcp:action/wb_view.select
// census:mcp:action/wb_view.selection
// census:mcp:action/wb_view.setCamera
// census:mcp:action/wb_view.setVisible
// census:mcp:action/wb_view.trace
// census:mcp:action/wb_view.underCursor
