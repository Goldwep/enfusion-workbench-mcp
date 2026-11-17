import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import {
  FOLDER_PERSIST_WARNING,
  HANDLER_ACTIONS,
  LAYERS_CONTRACT,
  LEGACY_ACTIONS,
  LEGACY_MAP,
  flatInputShape,
  parseListRows,
  parseTreeRows,
  prepareRequest,
  runLayers,
  wbLayersDescription,
} from "../../src/tools/wb-layers.js";

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
const refused = (code: string, message = "no", next = "fix it") => ({
  status: "refused",
  code,
  message,
  next,
});

const LIST_ROWS = ["0|Default|true|false|12", "3|Props/Trees|true|true|40"];

describe("wb_layers contract", () => {
  it("loads and names the ten handler actions", () => {
    expect(LAYERS_CONTRACT.tool).toBe("wb_layers");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      [
        "create",
        "createFolder",
        "delete",
        "list",
        "lock",
        "move",
        "rename",
        "setActive",
        "tree",
        "unlock",
      ].sort(),
    );
  });

  // The contract's own summaries are 509 chars (budget 400): shorten them in
  // contracts/EMCP_WB_Layers.json, which this tool's author does not own.
  it("its description fits the 400-char budget", () => {
    expect(wbLayersDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("marks every mutating action projectOnly and the reads not", () => {
    for (const a of LAYERS_CONTRACT.actions) {
      expect(a.projectOnly, a.name).toBe(a.mutating);
      expect(a.mutating, a.name).toBe(!["list", "tree"].includes(a.name));
    }
  });

  it("gives registerTool a flat shape with every key and the 1.x names", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "subScene",
      "cursor",
      "limit",
      "name",
      "parentPath",
      "layer",
      "confirm",
      "withContents",
      "layerID",
      "entityName",
    ])
      expect(shape[k], k).toBeDefined();
    for (const n of LEGACY_ACTIONS) expect(shape.action!.safeParse(n).success, n).toBe(true);
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

  it("refuses an unknown action and lists the names", () => {
    refuses({ action: "nope" }, "INVALID_ARGUMENT", /one of list, tree.*toggleLock/);
  });

  it("refuses a missing required param per action", () => {
    refuses({ action: "create" }, "INVALID_ARGUMENT", /name/);
    refuses({ action: "createFolder" }, "INVALID_ARGUMENT", /name/);
    refuses({ action: "rename", layer: "A" }, "INVALID_ARGUMENT", /name/);
    refuses({ action: "rename", name: "B" }, "INVALID_ARGUMENT", /layer/);
    refuses({ action: "delete" }, "INVALID_ARGUMENT", /layer/);
    refuses({ action: "move", layer: "A" }, "INVALID_ARGUMENT", /parentPath/);
    refuses({ action: "setActive" }, "INVALID_ARGUMENT", /layer/);
    refuses({ action: "lock" }, "INVALID_ARGUMENT", /layer/);
    refuses({ action: "unlock" }, "INVALID_ARGUMENT", /layer/);
  });

  it("refuses a key the action does not take (confirm only rides on delete)", () => {
    refuses({ action: "create", name: "A", confirm: true }, "INVALID_ARGUMENT");
    refuses({ action: "lock", layer: "A", confirm: true }, "INVALID_ARGUMENT");
    refuses({ action: "list", cursor: "0:5" }, "INVALID_ARGUMENT");
    refuses({ action: "tree", layerID: 1 }, "INVALID_ARGUMENT");
  });

  it("refuses bad names, empty paths, bad sub-scenes and bad limits", () => {
    refuses({ action: "create", name: "" }, "INVALID_ARGUMENT", /empty/);
    refuses({ action: "create", name: "a/b" }, "INVALID_ARGUMENT", /must not hold/);
    refuses({ action: "createFolder", name: "a\\b" }, "INVALID_ARGUMENT", /must not hold/);
    refuses({ action: "rename", layer: "A", name: "x|y" }, "INVALID_ARGUMENT", /must not hold/);
    refuses({ action: "lock", layer: " " }, "INVALID_ARGUMENT", /layer is empty/);
    refuses({ action: "list", subScene: -1 }, "INVALID_ARGUMENT", /subScene/);
    refuses({ action: "tree", limit: 0 }, "INVALID_ARGUMENT", /limit/);
    refuses({ action: "tree", limit: 201 }, "INVALID_ARGUMENT", /limit/);
    refuses({ action: "tree", limit: 1.5 }, "INVALID_ARGUMENT");
  });

  it("refuses a malformed cursor with INVALID_ARGUMENT", () => {
    for (const c of ["abc", "5", "9:3", "-1:4", "1:2:3"]) {
      refuses({ action: "tree", cursor: c }, "INVALID_ARGUMENT", /cursor/);
    }
  });

  it("accepts a well-formed request and classifies read versus mutate", () => {
    const t = prepareRequest({ action: "tree", cursor: "50:120", limit: 50 });
    expect(t.ok && t.mutating).toBe(false);
    const d = prepareRequest({ action: "delete", layer: "A/B", confirm: true });
    expect(d.ok && d.mutating).toBe(true);
    if (d.ok) expect(d.params).toEqual({ action: "delete", layer: "A/B", confirm: true });
  });

  it("allows an empty parentPath on move (the root) and create", () => {
    expect(prepareRequest({ action: "move", layer: "A", parentPath: "" }).ok).toBe(true);
    expect(prepareRequest({ action: "create", name: "A", parentPath: "" }).ok).toBe(true);
  });
});

describe("rows", () => {
  it("parses list rows", () => {
    expect(parseListRows(LIST_ROWS)).toEqual([
      { id: 0, path: "Default", visible: true, locked: false, entityCount: 12 },
      { id: 3, path: "Props/Trees", visible: true, locked: true, entityCount: 40 },
    ]);
  });

  it("parses tree rows; a folder has no lock or count", () => {
    expect(
      parseTreeRows(["0|Props|-1|folder|true|||", "0|Props/Trees|3|layer|true|false|true|40"]),
    ).toEqual([
      {
        subScene: 0,
        path: "Props",
        id: -1,
        kind: "folder",
        visible: true,
        locked: null,
        lockedHierarchy: null,
        entityCount: null,
      },
      {
        subScene: 0,
        path: "Props/Trees",
        id: 3,
        kind: "layer",
        visible: true,
        locked: false,
        lockedHierarchy: true,
        entityCount: 40,
      },
    ]);
  });
});

describe("runLayers: reads", () => {
  it("list sends the request as a read and maps the rows", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ action: "list", currentSubScene: 1, rows: LIST_ROWS }),
    );
    const r = await runLayers(client, { action: "list", subScene: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.fn).toBe("EMCP_WB_Layers");
    expect(sent[0]!.params).toEqual({ action: "list", subScene: 1 });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("list");
      expect(r.target).toBe("subscene:1");
      expect(r.changed).toBeNull();
      expect(r.readback).toMatchObject({ currentSubScene: 1 });
      expect((r.readback as { layers: unknown[] }).layers).toHaveLength(2);
    }
  });

  it("tree pages: the cursor is passed through and nextCursor comes back with a next step", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        action: "tree",
        subScenes: 2,
        activeLayer: "Default",
        rows: ["0|Default|0|layer|true|false|false|3"],
        total: 120,
        nextCursor: "50:120",
      }),
    );
    const r = await runLayers(client, { action: "tree", limit: 50 });
    expect(sent[0]!.params).toEqual({ action: "tree", limit: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toMatchObject({
        subScenes: 2,
        activeLayer: "Default",
        total: 120,
        nextCursor: "50:120",
      });
      expect(r.next).toContain("50:120");
    }
  });

  it("tree on the last page has a null nextCursor and no next", async () => {
    const { client } = fakeClient(() =>
      ok({ action: "tree", subScenes: 1, activeLayer: "", rows: [], total: 0, nextCursor: "" }),
    );
    const r = await runLayers(client, { action: "tree", cursor: "100:120" });
    expect(r.ok && r.readback).toMatchObject({ nextCursor: null });
    expect(r.ok && r.next).toBeFalsy();
  });

  it("a stale cursor answered by the handler comes back as STALE_CURSOR", async () => {
    const { client } = fakeClient(() =>
      refused("STALE_CURSOR", "the layer tree changed", "read again without a cursor"),
    );
    const r = await runLayers(client, { action: "tree", cursor: "50:120" });
    expect(r).toMatchObject({
      ok: false,
      code: "STALE_CURSOR",
      next: "read again without a cursor",
    });
  });
});

describe("runLayers: mutating actions", () => {
  it("create maps the request, sends as mutate and reports a change", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ action: "create", layer: "Props/New", layerId: 7, undoName: "EMCP wb_layers create" }),
    );
    const r = await runLayers(client, {
      action: "create",
      name: "New",
      parentPath: "Props",
      subScene: 0,
    });
    expect(sent[0]!.params).toEqual({
      action: "create",
      name: "New",
      parentPath: "Props",
      subScene: 0,
    });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toEqual([{ path: "Props/New", before: null, after: "layer" }]);
      expect(r.readback).toMatchObject({
        path: "Props/New",
        layerId: 7,
        undoName: "EMCP wb_layers create",
      });
      expect(r.next).toContain("wb_undo_redo");
    }
  });

  it("createFolder reports a folder change", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ action: "createFolder", layer: "Props", undoName: "EMCP wb_layers createFolder" }),
    );
    const r = await runLayers(client, { action: "createFolder", name: "Props" });
    expect(sent[0]!.params).toEqual({ action: "createFolder", name: "Props" });
    expect(r.ok && r.changed).toEqual([{ path: "Props", before: null, after: "folder" }]);
    // W1.7 run 6: an empty folder does not survive a save; the answer says so.
    expect(r.ok && r.warnings).toContain(FOLDER_PERSIST_WARNING);
  });

  it("rename and move report before and after, and warn that layer paths are unverified", async () => {
    for (const [input, before, after] of [
      [{ action: "rename", layer: "A/B", name: "C" }, "A/B", "A/C"],
      [{ action: "move", layer: "A/B", parentPath: "" }, "A/B", "B"],
    ] as const) {
      const { client, sent } = fakeClient(() =>
        ok({ action: input.action, before, after, undoName: "EMCP x" }),
      );
      const r = await runLayers(client, input);
      expect(sent[0]!.params).toEqual(input);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.changed).toEqual([{ path: before, before, after }]);
        expect(r.warnings.join(" ")).toContain("P-W1-08");
      }
    }
  });

  // W1.7 run 7: DeleteSubsceneFolder on a non-empty layer left a pathless layer with its entity.
  it("delete of a non-empty layer without withContents: the handler's NOT_EMPTY passes through", async () => {
    const { client, sent } = fakeClient(() =>
      refused(
        "NOT_EMPTY",
        "NOT_EMPTY: 'Props/Trees' holds 40 entities and 0 child layers or folders; nothing was deleted",
        "move the entities out (wb_entity setLayer) ..., or resend with withContents true and confirm true",
      ),
    );
    const r = await runLayers(client, { action: "delete", layer: "Props/Trees", confirm: true });
    expect(sent[0]!.params).toEqual({ action: "delete", layer: "Props/Trees", confirm: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("NOT_EMPTY");
      expect(r.next).toContain("withContents");
      expect(r.warnings).toEqual([]);
    }
    expect(ERROR_CODES.NOT_EMPTY).toContain("withContents: true");
  });

  it("delete withContents without confirm is a dry run naming what would go", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        action: "delete",
        entityCount: 40,
        childCount: 2,
        dryRun: 1,
        message: "dry run: holds 40",
      }),
    );
    const r = await runLayers(client, { action: "delete", layer: "Props", withContents: true });
    expect(sent[0]!.params).toEqual({ action: "delete", layer: "Props", withContents: true });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBeNull();
      expect(r.readback).toMatchObject({ dryRun: true, entityCount: 40, childCount: 2 });
      expect(r.next).toContain("withContents: true and confirm: true");
    }
  });

  it("delete withContents and confirm reports every item removed and the entity count", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        action: "delete",
        entityCount: 40,
        childCount: 1,
        entitiesDeleted: 40,
        rows: ["Props/Trees", "Props"],
        dryRun: 0,
        undoName: "EMCP wb_layers delete",
      }),
    );
    const input = { action: "delete", layer: "Props", withContents: true, confirm: true };
    const r = await runLayers(client, input);
    expect(sent[0]!.params).toEqual(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toEqual([
        { path: "Props/Trees", before: "present", after: null },
        { path: "Props", before: "present", after: null },
      ]);
      expect(r.readback).toMatchObject({
        dryRun: false,
        entityCount: 40,
        childCount: 1,
        entitiesDeleted: 40,
        deletedItems: ["Props/Trees", "Props"],
        undoName: "EMCP wb_layers delete",
      });
      // The handler reads the delete back now: no unverified-path warning on delete.
      expect(r.warnings.join(" ")).not.toContain("P-W1-08");
    }
  });

  it("delete of an empty item reports its removal", async () => {
    const { client } = fakeClient(() =>
      ok({ action: "delete", entityCount: 0, dryRun: 0, undoName: "EMCP wb_layers delete" }),
    );
    const r = await runLayers(client, { action: "delete", layer: "Empty" });
    expect(r.ok && r.changed).toEqual([{ path: "Empty", before: "present", after: null }]);
  });

  it("withContents rides on delete only, as a boolean", () => {
    for (const input of [
      { action: "create", name: "A", withContents: true },
      { action: "delete", layer: "A", withContents: "yes" },
    ]) {
      const p = prepareRequest(input);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
    expect(prepareRequest({ action: "delete", layer: "A", withContents: true }).ok).toBe(true);
  });

  it("setActive reports the active layer before and after", async () => {
    const { client } = fakeClient(() =>
      ok({ action: "setActive", before: "Default", after: "Props/Trees" }),
    );
    const r = await runLayers(client, { action: "setActive", layer: "Props/Trees" });
    expect(r.ok && r.changed).toEqual([
      { path: "activeLayer", before: "Default", after: "Props/Trees" },
    ]);
  });

  it("lock and unlock read the lock back as a bool (1/0 on the wire)", async () => {
    const lock = fakeClient(() => ok({ action: "lock", layerLocked: 1 }));
    const a = await runLayers(lock.client, { action: "lock", layer: "Default" });
    expect(lock.sent[0]!.params).toEqual({ action: "lock", layer: "Default" });
    expect(a.ok && a.readback).toEqual({ layer: "Default", locked: true });
    expect(a.ok && a.changed).toEqual([{ path: "Default.locked", before: null, after: true }]);

    const unlock = fakeClient(() => ok({ action: "unlock", layerLocked: 0 }));
    const b = await runLayers(unlock.client, { action: "unlock", layer: "Default" });
    expect(b.ok && b.readback).toEqual({ layer: "Default", locked: false });
  });
});

describe("runLayers: handler refusals and client failures", () => {
  it("maps every guard code the handler answers and keeps its next step", async () => {
    for (const code of [
      "NOT_IN_PROJECT",
      "WRONG_MODE",
      "NO_WORLD",
      "PATH_NOT_FOUND",
      "MODULE_NOT_OPEN",
    ]) {
      const { client } = fakeClient(() => refused(code, `msg ${code}`, `next ${code}`));
      const r = await runLayers(client, { action: "lock", layer: "A" });
      expect(r).toMatchObject({ ok: false, code, message: `msg ${code}`, next: `next ${code}` });
    }
  });

  it("an unknown handler code becomes INVALID_ARGUMENT with a warning", async () => {
    const { client } = fakeClient(() => refused("WEIRD"));
    const r = await runLayers(client, { action: "list" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(r.warnings.join(" ")).toContain("WEIRD");
  });

  it("a handler error status is ENGINE_FALSE and carries the undo point", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "CreateSubsceneLayer answered an empty path",
      next: "list the layers",
      undoName: "EMCP wb_layers create",
    }));
    const r = await runLayers(client, { action: "create", name: "X" });
    expect(r).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
      next: "list the layers",
      readback: { undoName: "EMCP wb_layers create" },
    });
  });

  it("an answer with no status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({}));
    expect(await runLayers(client, { action: "list" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("keeps LOST, MODAL_OPEN and WEDGED, and never retries a lost mutation", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError(`boom ${code}`, code));
      const r = await runLayers(client, { action: "create", name: "X" });
      expect(r).toMatchObject({ ok: false, code });
      expect(sent).toHaveLength(1);
      if (code === "LOST") expect(r.ok === false && r.next).toContain("never retried");
    }
  });

  it("any other client failure is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new WorkbenchError("refused", "CONNECTION_REFUSED"));
    expect(await runLayers(client, { action: "tree" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("sends nothing when the request is refused in TypeScript", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runLayers(client, { action: "create", name: "a/b" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(0);
  });
});

describe("1.x action names (OD-6): one test per mapped name", () => {
  it("lists exactly the five 1.x names", () => {
    expect(LEGACY_ACTIONS.sort()).toEqual(
      ["getActive", "getEntityLayer", "getInfo", "isVisible", "toggleLock"].sort(),
    );
    for (const n of LEGACY_ACTIONS) expect(HANDLER_ACTIONS).not.toContain(n);
    expect([...LEGACY_ACTIONS].sort()).toEqual(Object.keys(LEGACY_MAP).sort());
    expect(Object.keys(LEGACY_MAP)).toHaveLength(5);
  });

  it("getActive is a tree read of one row and answers the active layer", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        action: "tree",
        subScenes: 2,
        activeLayer: "Default",
        rows: [],
        total: 9,
        nextCursor: "1:9",
      }),
    );
    const r = await runLayers(client, { action: "getActive", subScene: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toEqual({ action: "tree", limit: 1, subScene: 1 });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("getActive");
      expect(r.readback).toEqual({ activeLayer: "Default", subScenes: 2 });
      expect(r.warnings[0]).toContain("sent as tree");
    }
  });

  it("getActive without subScene leaves it out (the current sub-scene)", async () => {
    const { client, sent } = fakeClient(() => ok({ activeLayer: "", subScenes: 1 }));
    await runLayers(client, { action: "getActive" });
    expect(sent[0]!.params).toEqual({ action: "tree", limit: 1 });
  });

  it("getEntityLayer has no handler action: refused before sending, pointing at wb_entity", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runLayers(client, { action: "getEntityLayer", entityName: "Tree_01" });
    expect(sent).toHaveLength(0);
    expect(r).toMatchObject({ ok: false, action: "getEntityLayer", code: "INVALID_ARGUMENT" });
    expect(r.ok === false && r.next).toContain("wb_entity get");
  });

  it("getEntityLayer still needs entityName", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runLayers(client, { action: "getEntityLayer" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(0);
  });

  it("isVisible is a list read; the row is found by layerID", async () => {
    const { client, sent } = fakeClient(() => ok({ currentSubScene: 0, rows: LIST_ROWS }));
    const r = await runLayers(client, { action: "isVisible", layerID: 3 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toEqual({ action: "list" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("isVisible");
      expect(r.target).toBe("layer:Props/Trees");
      expect(r.readback).toEqual({ layerID: 3, path: "Props/Trees", visible: true });
      expect(r.warnings[0]).toContain("sent as list");
    }
  });

  it("isVisible and getInfo refuse a missing layerID and a layer that is not listed", async () => {
    const none = fakeClient(() => ok());
    for (const a of ["isVisible", "getInfo"]) {
      expect(await runLayers(none.client, { action: a })).toMatchObject({
        ok: false,
        code: "INVALID_ARGUMENT",
      });
    }
    expect(none.sent).toHaveLength(0);

    const { client } = fakeClient(() => ok({ currentSubScene: 0, rows: LIST_ROWS }));
    for (const a of ["isVisible", "getInfo", "toggleLock"]) {
      const r = await runLayers(client, { action: a, layerID: 99 });
      expect(r, a).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
    }
  });

  it("getInfo reads list for the row and tree for the active layer", async () => {
    const { client, sent } = fakeClient((p) =>
      p.action === "list"
        ? ok({ currentSubScene: 0, rows: LIST_ROWS })
        : ok({ subScenes: 1, activeLayer: "Props/Trees", rows: [], total: 0, nextCursor: "" }),
    );
    const r = await runLayers(client, { action: "getInfo", layerID: 3, subScene: 0 });
    expect(sent.map((s) => s.params)).toEqual([
      { action: "list", subScene: 0 },
      { action: "tree", limit: 1, subScene: 0 },
    ]);
    expect(sent.every((s) => s.options.access === "read")).toBe(true);
    expect(r.ok && r.readback).toEqual({
      layerID: 3,
      path: "Props/Trees",
      visible: true,
      locked: true,
      active: true,
      entityCount: 40,
    });
  });

  it("getInfo keeps the row when the active-layer read fails, and says so", async () => {
    const { client } = fakeClient((p) =>
      p.action === "list"
        ? ok({ currentSubScene: 0, rows: LIST_ROWS })
        : refused("NO_WORLD", "no world"),
    );
    const r = await runLayers(client, { action: "getInfo", layerID: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toMatchObject({ layerID: 0, active: null, entityCount: 12 });
      expect(r.warnings.join(" ")).toContain("active layer was not read");
    }
  });

  it("toggleLock locks an unlocked layer: list as read, then lock as mutate", async () => {
    const { client, sent } = fakeClient((p) =>
      p.action === "list"
        ? ok({ currentSubScene: 0, rows: LIST_ROWS })
        : ok({ action: "lock", layerLocked: 1 }),
    );
    const r = await runLayers(client, { action: "toggleLock", layerID: 0 });
    expect(sent.map((s) => s.params)).toEqual([
      { action: "list" },
      { action: "lock", layer: "Default" },
    ]);
    expect(sent.map((s) => s.options.access)).toEqual(["read", "mutate"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("toggleLock");
      expect(r.changed).toEqual([{ path: "Default.locked", before: false, after: true }]);
      expect(r.readback).toMatchObject({ layerID: 0, locked: true, sentAs: "lock" });
    }
  });

  it("toggleLock unlocks a locked layer, found by layerID or by layer path", async () => {
    for (const input of [
      { action: "toggleLock", layerID: 3 },
      { action: "toggleLock", layer: "Props/Trees" },
    ]) {
      const { client, sent } = fakeClient((p) =>
        p.action === "list" ? ok({ currentSubScene: 0, rows: LIST_ROWS }) : ok({ layerLocked: 0 }),
      );
      const r = await runLayers(client, input);
      expect(sent[1]!.params).toEqual({ action: "unlock", layer: "Props/Trees" });
      expect(r.ok && r.changed).toEqual([
        { path: "Props/Trees.locked", before: true, after: false },
      ]);
    }
  });

  it("toggleLock needs layerID or layer, and sends nothing without one", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runLayers(client, { action: "toggleLock" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(0);
  });

  it("toggleLock sends no lock call when the list read is refused, and passes the lock refusal through", async () => {
    const a = fakeClient(() => refused("NO_WORLD"));
    expect(await runLayers(a.client, { action: "toggleLock", layerID: 0 })).toMatchObject({
      ok: false,
      code: "NO_WORLD",
    });
    expect(a.sent).toHaveLength(1);

    const b = fakeClient((p) =>
      p.action === "list"
        ? ok({ currentSubScene: 0, rows: LIST_ROWS })
        : refused("WRONG_MODE", "play mode"),
    );
    expect(await runLayers(b.client, { action: "toggleLock", layerID: 0 })).toMatchObject({
      ok: false,
      action: "toggleLock",
      code: "WRONG_MODE",
    });
    expect(b.sent).toHaveLength(2);
  });

  it("a 1.x call with a key its name does not take is refused", async () => {
    const { client, sent } = fakeClient(() => ok());
    for (const input of [
      { action: "isVisible", layerID: 1, entityName: "x" },
      { action: "getActive", layerID: 1 },
      { action: "toggleLock", layerID: -1 },
    ]) {
      expect(await runLayers(client, input)).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    }
    expect(sent).toHaveLength(0);
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:mcp:action/wb_layers.create
// census:mcp:action/wb_layers.createFolder
// census:mcp:action/wb_layers.delete
// census:mcp:action/wb_layers.getActive
// census:mcp:action/wb_layers.getInfo
// census:mcp:action/wb_layers.isVisible
// census:mcp:action/wb_layers.list
// census:mcp:action/wb_layers.lock
// census:mcp:action/wb_layers.move
// census:mcp:action/wb_layers.rename
// census:mcp:action/wb_layers.setActive
// census:mcp:action/wb_layers.tree
// census:mcp:action/wb_layers.unlock
