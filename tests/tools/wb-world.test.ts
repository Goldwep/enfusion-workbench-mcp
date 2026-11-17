import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkbenchError } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX, buildDescription } from "../../src/manifest/generate.js";
import { parseCst } from "../../src/formats/enfusion-cst.js";
import {
  HANDLER,
  HANDLER_ACTIONS,
  OFFLINE_ACTIONS,
  OFFLINE_LINE,
  WORLD_CONTRACT,
  flatInputShape,
  newWorldTexts,
  prepareRequest,
  replaceWorldEntity,
  runWorld,
  truthy,
  wbWorldDescription,
  type WorldClient,
  type WorldDeps,
} from "../../src/tools/wb-world.js";

interface Sent {
  api: string;
  params: Record<string, unknown>;
  access?: string;
}

type Answer = Record<string, unknown> | Error;

/** A client that records each call and answers from a function of the request (or throws). */
function fake(answer: (api: string, p: Record<string, unknown>, n: number) => Answer = () => ok()) {
  const sent: Sent[] = [];
  const client = {
    async call(api: string, params: Record<string, unknown> = {}, opts: { access?: string } = {}) {
      sent.push({ api, params, access: opts.access });
      const a = answer(api, params, sent.length - 1);
      if (a instanceof Error) throw a;
      return a;
    },
    async probe() {
      throw new Error("probe not expected");
    },
  } as unknown as WorldClient;
  return { client, sent };
}

/** Answers from a queue in order. */
function queue(...answers: Answer[]) {
  return fake(() => answers.shift() ?? ok());
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = `${code}: x`, next = "do y") => ({
  status: "refused",
  code,
  message,
  next,
});

const noSleep: WorldDeps = { sleep: async () => {}, pollIntervalMs: 0, pollTries: 3 };

// ── Contract and description ─────────────────────────────────────────────────

describe("wb_world contract", () => {
  it("loads with the nine handler actions and the four offline ones", () => {
    expect(WORLD_CONTRACT.handler).toBe(HANDLER);
    expect(WORLD_CONTRACT.tool).toBe("wb_world");
    expect([...HANDLER_ACTIONS]).toEqual([
      "state",
      "browserSelection",
      "register",
      "play",
      "stop",
      "playEvents",
      "comments",
      "addComment",
      "annotate",
    ]);
    expect([...OFFLINE_ACTIONS]).toEqual(["new", "duplicate", "saveAs", "setWorldEntity"]);
  });

  it("builds the description from the contract plus the offline line, within budget", () => {
    const contractText = buildDescription(WORLD_CONTRACT);
    expect(contractText.length + 1 + OFFLINE_LINE.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const d = wbWorldDescription();
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d.startsWith(contractText)).toBe(true);
    expect(d.endsWith(OFFLINE_LINE)).toBe(true);
  });

  it("gives registerTool a flat shape with every key", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "recursive",
      "path",
      "confirm",
      "debugMode",
      "fullScreen",
      "after",
      "cursor",
      "limit",
      "text",
      "coords",
      "color",
      "size",
      "layer",
      "entity",
      "mode",
      "category",
      "to",
      "prefab",
      "overwrite",
    ])
      expect(shape[k], k).toBeDefined();
  });

  it("reads Enforce booleans as 1/0", () => {
    expect([1, "1", true, "true"].map(truthy)).toEqual([true, true, true, true]);
    expect([0, "0", false, undefined, "yes"].map(truthy)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

// ── Refusals before anything is sent ─────────────────────────────────────────

describe("prepareRequest refuses before sending", () => {
  const refuses = async (input: Record<string, unknown>, code: string, re?: RegExp) => {
    const { client, sent } = fake();
    const r = await runWorld(client, input, noSleep);
    expect(r.ok, JSON.stringify(input)).toBe(false);
    if (!r.ok) {
      expect(r.code, JSON.stringify(input)).toBe(code);
      if (re) expect(r.message).toMatch(re);
      expect(r.next).toBeTruthy();
    }
    expect(sent).toHaveLength(0);
  };

  it("an unknown key or action or a wrong type is INVALID_ARGUMENT", async () => {
    await refuses({ action: "state", bogus: 1 }, "INVALID_ARGUMENT");
    await refuses({ action: "explode" }, "INVALID_ARGUMENT");
    await refuses({ action: "browserSelection", recursive: "yes" }, "INVALID_ARGUMENT");
    await refuses({ action: "register" }, "INVALID_ARGUMENT", /path/);
  });

  it("register: absolute and .. paths are ABSOLUTE_PATH, a .meta is INVALID_ARGUMENT", async () => {
    for (const p of ["C:/x/W.ent", "/abs/W.ent", "$profile:W.ent", "../W.ent", "a/../../W.ent"])
      await refuses({ action: "register", path: p }, "ABSOLUTE_PATH");
    await refuses({ action: "register", path: "Worlds/W.ent.meta" }, "INVALID_ARGUMENT", /\.meta/);
  });

  it("playEvents: a negative after", async () => {
    await refuses({ action: "playEvents", after: -1 }, "INVALID_ARGUMENT", /after/);
  });

  it("comments: a malformed cursor and a limit out of range", async () => {
    for (const c of ["abc", "5", "3:2", "-1:4"])
      await refuses({ action: "comments", cursor: c }, "INVALID_ARGUMENT", /cursor/);
    await refuses({ action: "comments", limit: 0 }, "INVALID_ARGUMENT", /limit/);
    await refuses({ action: "comments", limit: 201 }, "INVALID_ARGUMENT", /limit/);
  });

  it("addComment: text, coords, color, size and layer", async () => {
    await refuses({ action: "addComment", text: " ", coords: "1 2 3" }, "INVALID_ARGUMENT", /text/);
    await refuses({ action: "addComment", text: "t", coords: "1 2" }, "INVALID_ARGUMENT", /coords/);
    await refuses(
      { action: "addComment", text: "t", coords: "1 x 3" },
      "INVALID_ARGUMENT",
      /coords/,
    );
    await refuses(
      { action: "addComment", text: "t", coords: "1 2 3", color: "1 2 0" },
      "INVALID_ARGUMENT",
      /0\.\.1/,
    );
    await refuses(
      { action: "addComment", text: "t", coords: "1 2 3", color: "1 1 1 1" },
      "INVALID_ARGUMENT",
      /color/,
    );
    await refuses(
      { action: "addComment", text: "t", coords: "1 2 3", size: 0 },
      "INVALID_ARGUMENT",
      /size/,
    );
    await refuses(
      { action: "addComment", text: "t", coords: "1 2 3", layer: "" },
      "INVALID_ARGUMENT",
      /layer/,
    );
  });

  it("annotate: entity reference, mode and mode-only keys", async () => {
    await refuses(
      { action: "annotate", entity: "foo", mode: "add", text: "t" },
      "INVALID_ARGUMENT",
      /entity reference/,
    );
    await refuses(
      { action: "annotate", entity: "id:xyz", mode: "add", text: "t" },
      "INVALID_ARGUMENT",
      /hex/,
    );
    await refuses(
      { action: "annotate", entity: "index:1", mode: "pin" },
      "INVALID_ARGUMENT",
      /mode/,
    );
    await refuses(
      { action: "annotate", entity: "index:1", mode: "add" },
      "INVALID_ARGUMENT",
      /text/,
    );
    await refuses(
      { action: "annotate", entity: "index:1", mode: "remove", text: "t" },
      "INVALID_ARGUMENT",
      /add only/,
    );
    await refuses(
      { action: "annotate", entity: "index:1", mode: "add", text: "t", coords: "1 2 3" },
      "INVALID_ARGUMENT",
      /move only/,
    );
    await refuses(
      { action: "annotate", entity: "index:1", mode: "move" },
      "INVALID_ARGUMENT",
      /coords/,
    );
    await refuses(
      { action: "annotate", entity: "index:1", mode: "add", text: "t", color: "2 0 0" },
      "INVALID_ARGUMENT",
      /0\.\.1/,
    );
  });

  it("prepareRequest normalises what it sends", () => {
    const p = prepareRequest({
      action: "annotate",
      entity: "id:ABC",
      mode: "add",
      text: "t",
      color: "1,0,0",
    });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.params).toEqual({
        action: "annotate",
        entity: "id:0x0000000000000abc",
        mode: "add",
        text: "t",
        color: "1 0 0",
      });
      expect(p.target).toBe("entity:id:0x0000000000000abc");
      expect(p.mutating).toBe(true);
    }
    const r = prepareRequest({ action: "register", path: "Worlds\\W.ent" });
    expect(r.ok && r.params).toEqual({ action: "register", path: "Worlds/W.ent", confirm: false });
  });
});

// ── Request mapping and response mapping per handler action ──────────────────

describe("handler actions", () => {
  it("state: a read; bools from 1/0; no world path suggests setResource", async () => {
    const { client, sent } = queue(
      ok({
        worldPath: "$Proj:Worlds/W.ent",
        worldName: "W",
        mode: "edit",
        editAction: 0,
        restoring: 0,
        modifying: 1,
        creatingInWindow: 0,
        generatorEvents: 1,
        toolName: "Select",
        subScenes: 1,
        currentSubScene: 0,
        entityCount: 12,
      }),
      ok({ worldPath: "", mode: "unknown" }),
    );
    const r = await runWorld(client, { action: "state" });
    expect(sent[0]).toEqual({ api: HANDLER, params: { action: "state" }, access: "read" });
    expect(r).toMatchObject({
      ok: true,
      action: "state",
      target: "open:WorldEditor",
      changed: null,
      readback: {
        worldPath: "$Proj:Worlds/W.ent",
        mode: "edit",
        editAction: false,
        modifying: true,
        generatorEvents: true,
        toolName: "Select",
        subScenes: 1,
        entityCount: 12,
      },
    });
    const r2 = await runWorld(client, { action: "state" });
    expect(r2.ok && r2.readback).toMatchObject({ worldPath: null });
    expect(r2.ok && r2.next).toMatch(/setResource/);
  });

  it("browserSelection: sends recursive, warns at the cap", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => `{0000000000000000}r${i}.et`);
    const { client, sent } = queue(
      ok({ rows: ["{A}a.et"] }),
      ok({ rows, message: "2500 resources selected" }),
    );
    const r = await runWorld(client, { action: "browserSelection", recursive: true });
    expect(sent[0].params).toEqual({ action: "browserSelection", recursive: true });
    expect(sent[0].access).toBe("read");
    expect(r.ok && r.readback).toEqual({ resources: ["{A}a.et"], count: 1 });
    const r2 = await runWorld(client, { action: "browserSelection" });
    expect(r2.ok && r2.warnings.join()).toMatch(/at most 2000/);
  });

  it("playEvents: rows split into fields, next names the eventSeq", async () => {
    const { client, sent } = queue(
      ok({ rows: ["3|1000|started|$P:W.ent|GameMode|1 2 3", "4|2000|ended|||"], eventSeq: 4 }),
    );
    const r = await runWorld(client, { action: "playEvents", after: 2 });
    expect(sent[0]).toMatchObject({ params: { action: "playEvents", after: 2 }, access: "read" });
    expect(r.ok && r.readback).toEqual({
      events: [
        {
          seq: 3,
          tick: 1000,
          event: "started",
          world: "$P:W.ent",
          mode: "GameMode",
          camera: "1 2 3",
        },
        { seq: 4, tick: 2000, event: "ended", world: "", mode: "", camera: "" },
      ],
      eventSeq: 4,
    });
    expect(r.ok && r.next).toMatch(/after: 4/);
  });

  it("comments: paging forward, text keeps its bars, last page has no cursor", async () => {
    const { client, sent } = queue(
      ok({ rows: ["id:0x01|1 0 0|2|a|b"], categories: ["Notes"], total: 2, nextCursor: "1:2" }),
      ok({ rows: ["id:0x02|0 0 0|1|c"], categories: ["Notes"], total: 2, nextCursor: "" }),
    );
    const r = await runWorld(client, { action: "comments", limit: 1 });
    expect(sent[0].params).toEqual({ action: "comments", limit: 1 });
    expect(r.ok && r.readback).toEqual({
      rows: [{ id: "id:0x01", color: "1 0 0", size: 2, text: "a|b" }],
      categories: ["Notes"],
      total: 2,
      nextCursor: "1:2",
    });
    expect(r.ok && r.next).toMatch(/cursor: 1:2/);
    const r2 = await runWorld(client, { action: "comments", cursor: "1:2", limit: 1 });
    expect(sent[1].params).toEqual({ action: "comments", cursor: "1:2", limit: 1 });
    expect(r2.ok && r2.readback).toMatchObject({ nextCursor: null });
    expect(r2.ok && r2.next).toBeUndefined();
  });

  it("comments: STALE_CURSOR from the handler", async () => {
    const { client } = queue(
      refused("STALE_CURSOR", "STALE_CURSOR: count changed", "read again without a cursor"),
    );
    const r = await runWorld(client, { action: "comments", cursor: "1:2" });
    expect(r).toMatchObject({
      ok: false,
      code: "STALE_CURSOR",
      next: "read again without a cursor",
    });
  });

  it("register: confirm passes through; dry run, already registered and written", async () => {
    const { client, sent } = queue(
      ok({ dryRun: 1, alreadyRegistered: 0 }),
      ok({ dryRun: 1, alreadyRegistered: 1, resourceName: "{AB}Worlds/W.ent" }),
      ok({ dryRun: 0, alreadyRegistered: 0, resourceName: "{AB}Worlds/W.ent" }),
    );
    const dry = await runWorld(client, { action: "register", path: "Worlds/W.ent" });
    expect(sent[0]).toMatchObject({
      params: { action: "register", path: "Worlds/W.ent", confirm: false },
      access: "mutate",
    });
    expect(dry).toMatchObject({
      ok: true,
      target: "path:Worlds/W.ent",
      changed: null,
      readback: { dryRun: true },
    });
    expect(dry.ok && dry.next).toMatch(/confirm: true/);
    const already = await runWorld(client, { action: "register", path: "Worlds/W.ent" });
    expect(already).toMatchObject({
      changed: null,
      readback: { alreadyRegistered: true, resourceName: "{AB}Worlds/W.ent" },
    });
    const done = await runWorld(client, {
      action: "register",
      path: "Worlds/W.ent",
      confirm: true,
    });
    expect(sent[2].params.confirm).toBe(true);
    expect(done).toMatchObject({
      ok: true,
      changed: [{ path: "Worlds/W.ent.meta", before: null, after: "{AB}Worlds/W.ent" }],
    });
  });

  it("play: polls state until the mode lands", async () => {
    const { client, sent } = queue(
      ok({ mode: "edit", eventSeq: 7 }),
      ok({ mode: "edit" }),
      ok({ mode: "play" }),
    );
    const r = await runWorld(
      client,
      { action: "play", debugMode: true, fullScreen: false },
      noSleep,
    );
    expect(sent[0]).toMatchObject({
      params: { action: "play", debugMode: true, fullScreen: false },
      access: "mutate",
    });
    expect(sent.slice(1).map((s) => [s.params.action, s.access])).toEqual([
      ["state", "read"],
      ["state", "read"],
    ]);
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "WorldEditor.mode", before: "edit", after: "play" }],
      readback: { mode: "play", settled: true, stateReads: 2, eventSeq: 7 },
    });
  });

  it("stop: a mode that never lands is a warning, not an error", async () => {
    const { client } = fake((_api, p) =>
      p.action === "stop" ? ok({ mode: "play", eventSeq: 8 }) : ok({ mode: "play" }),
    );
    const r = await runWorld(client, { action: "stop" }, noSleep);
    expect(r).toMatchObject({
      ok: true,
      readback: { mode: "play", settled: false, stateReads: 3 },
    });
    expect(r.ok && r.warnings.join()).toMatch(/may still land/);
    expect(r.ok && r.next).toMatch(/wb_world state/);
  });

  it("play: an answer already in play needs no poll", async () => {
    const { client, sent } = queue(ok({ mode: "play", eventSeq: 1 }));
    const r = await runWorld(client, { action: "play" }, noSleep);
    expect(sent).toHaveLength(1);
    expect(r).toMatchObject({ readback: { settled: true, stateReads: 0 } });
  });

  it("play: WRONG_MODE and MODAL_OPEN", async () => {
    const a = queue(refused("WRONG_MODE", "WRONG_MODE: already in play", "wb_world stop"));
    expect(await runWorld(a.client, { action: "play" }, noSleep)).toMatchObject({
      ok: false,
      code: "WRONG_MODE",
      next: "wb_world stop",
    });
    const b = queue(new WorkbenchError("modal", "MODAL_OPEN"));
    expect(await runWorld(b.client, { action: "play" }, noSleep)).toMatchObject({
      ok: false,
      code: "MODAL_OPEN",
    });
  });

  it("addComment: wire params, change and undo hint; ENGINE_FALSE keeps the id", async () => {
    const { client, sent } = queue(
      ok({ id: "id:0x00000000000000ff", undoName: "EMCP wb_world addComment" }),
      {
        status: "error",
        code: "ENGINE_FALSE",
        message: "ENGINE_FALSE: m_Size",
        next: "wb_undo_redo undo",
        id: "id:0x01",
        undoName: "u",
      },
    );
    const r = await runWorld(client, {
      action: "addComment",
      text: "hi",
      coords: "1, 2, 3",
      color: "1 0 0",
      size: 2,
      layer: "L",
    });
    expect(sent[0]).toMatchObject({
      params: {
        action: "addComment",
        text: "hi",
        coords: "1 2 3",
        color: "1 0 0",
        size: "2",
        layer: "L",
      },
      access: "mutate",
    });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "id:0x00000000000000ff", before: null, after: "CommentEntity" }],
      readback: { id: "id:0x00000000000000ff", undoName: "EMCP wb_world addComment" },
    });
    expect(r.ok && r.next).toMatch(/undo/);
    const e = await runWorld(client, { action: "addComment", text: "hi", coords: "1 2 3" });
    expect(e).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
      next: "wb_undo_redo undo",
      readback: { id: "id:0x01" },
    });
  });

  it("annotate: add/move/remove mapping", async () => {
    // W1.7 run 6: the note is a CommentEntity (AddCommentEntity drew nothing); the handler names
    // where it put or moved it, and id is the note's.
    const { client, sent } = fake((_a, p) =>
      ok({
        id: "id:0x0000000000000009",
        undoName: `EMCP wb_world annotate ${String(p.mode)}`,
        message:
          p.mode === "add"
            ? "note EMCP_Note_Tree added on name:Tree at 1 2.5 3"
            : p.mode === "move"
              ? "note EMCP_Note_Tree moved to 4 5 6"
              : "note EMCP_Note_Tree removed from index:3",
      }),
    );
    const add = await runWorld(client, {
      action: "annotate",
      entity: "name:Tree",
      mode: "add",
      text: "t",
      category: "c",
      color: "1 1 1 0.5",
    });
    expect(sent[0].params).toEqual({
      action: "annotate",
      entity: "name:Tree",
      mode: "add",
      text: "t",
      category: "c",
      color: "1 1 1 0.5",
    });
    expect(add).toMatchObject({
      ok: true,
      target: "entity:name:Tree",
      changed: [{ path: "id:0x0000000000000009", before: null, after: "CommentEntity" }],
      readback: {
        id: "id:0x0000000000000009",
        entity: "name:Tree",
        mode: "add",
        at: "1 2.5 3",
        undoName: "EMCP wb_world annotate add",
      },
    });
    expect(add.ok && add.warnings.join()).toMatch(/category/);
    const move = await runWorld(client, {
      action: "annotate",
      entity: "index:3",
      mode: "move",
      coords: "4 5 6",
    });
    expect(sent[1].params).toEqual({
      action: "annotate",
      entity: "index:3",
      mode: "move",
      coords: "4 5 6",
    });
    expect(move.ok && move.readback).toMatchObject({ mode: "move", at: "4 5 6" });
    const rem = await runWorld(client, { action: "annotate", entity: "index:3", mode: "remove" });
    expect(sent[2].params).toEqual({ action: "annotate", entity: "index:3", mode: "remove" });
    expect(rem.ok && rem.changed).toEqual([
      { path: "id:0x0000000000000009", before: "note", after: null },
    ]);
  });

  it("annotate add: size goes as text, and the readback records what was applied (W1.7 run 7)", async () => {
    // Run 7: a fixed 0.5 m height drew "W1 hand note" so large that only "hand no" fitted.
    const { client, sent } = fake(() =>
      ok({
        id: "id:0x0000000000000009",
        undoName: "EMCP wb_world annotate add",
        noteSize: 0.06,
        noteCoords: "1 0.21 3",
        noteColor: "1 1 1 1",
        noteDistance: 1.5,
        message: "note EMCP_Note_Glass added on name:Glass, 0.06 m high, at 1 0.21 3",
      }),
    );
    const scaled = await runWorld(client, {
      action: "annotate",
      entity: "name:Glass",
      mode: "add",
      text: "W1 hand note",
    });
    expect(sent[0].params).not.toHaveProperty("size");
    expect(scaled.ok && scaled.readback).toMatchObject({
      at: "1 0.21 3",
      applied: { size: 0.06, color: "1 1 1 1", sizeFrom: "the framing distance 1.5 m" },
    });
    const given = await runWorld(client, {
      action: "annotate",
      entity: "name:Glass",
      mode: "add",
      text: "t",
      size: 2,
      color: "1 0 0",
    });
    expect(sent[1].params).toMatchObject({ size: "2", color: "1 0 0" });
    expect(given.ok && given.readback).toMatchObject({ applied: { sizeFrom: "request" } });
    for (const size of [0, -1, 101]) {
      const r = await runWorld(client, {
        action: "annotate",
        entity: "name:Glass",
        mode: "add",
        text: "t",
        size,
      });
      expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    }
    const moveWithSize = await runWorld(client, {
      action: "annotate",
      entity: "name:Glass",
      mode: "move",
      coords: "1 2 3",
      size: 1,
    });
    expect(moveWithSize).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(2);
  });

  it("handler refusals keep their code and next; an unknown code is INVALID_ARGUMENT with a warning", async () => {
    for (const code of ["NOT_IN_PROJECT", "MODULE_NOT_OPEN", "NO_WORLD", "ENTITY_NOT_FOUND"]) {
      const { client } = queue(refused(code, `${code}: why`, "step"));
      const r = await runWorld(client, { action: "annotate", entity: "index:0", mode: "remove" });
      expect(r).toMatchObject({ ok: false, code, message: `${code}: why`, next: "step" });
    }
    const { client } = queue(refused("WEIRD"));
    const r = await runWorld(client, { action: "state" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(!r.ok && r.warnings.join()).toMatch(/unknown code 'WEIRD'/);
    const s = queue({ status: "" });
    expect(await runWorld(s.client, { action: "state" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("client failures: LOST, MODAL_OPEN, WEDGED keep names; others are UNREACHABLE", async () => {
    const lost = queue(new WorkbenchError("reset", "LOST"));
    const r = await runWorld(lost.client, { action: "addComment", text: "t", coords: "0 0 0" });
    expect(r).toMatchObject({ ok: false, code: "LOST" });
    expect(!r.ok && r.next).toMatch(/never retried/);
    const lostRead = queue(new WorkbenchError("reset", "LOST"));
    expect(await runWorld(lostRead.client, { action: "state" })).toMatchObject({ code: "LOST" });
    const wedged = queue(new WorkbenchError("wedge", "WEDGED"));
    expect(await runWorld(wedged.client, { action: "state" })).toMatchObject({ code: "WEDGED" });
    const refusedConn = queue(new WorkbenchError("no", "CONNECTION_REFUSED"));
    expect(await runWorld(refusedConn.client, { action: "state" })).toMatchObject({
      code: "UNREACHABLE",
    });
  });
});

// ── Offline writers ──────────────────────────────────────────────────────────

const PREFAB = "{0123456789ABCDEF}Prefabs/World/MyWorld.et";

describe("offline writers", () => {
  let base: string;
  let root: string;
  let artifacts: string;
  let deps: WorldDeps;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "wb-world-"));
    root = join(base, "Proj");
    artifacts = join(base, "artifacts");
    mkdirSync(root);
    deps = {
      ...noSleep,
      projectRoot: root,
      artifactsRoot: artifacts,
      now: () => new Date("2026-11-11T10:00:00Z"),
    };
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const write = (rel: string, text: string) => {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
  };
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const registerAnswer = (_api: string, p: Record<string, unknown>) =>
    ok({ resourceName: `{FFFFFFFFFFFFFFFF}${String(p.path)}`, alreadyRegistered: 0, dryRun: 0 });

  it("the fresh world texts are what CreateWorld writes, and parse cleanly", () => {
    const t = newWorldTexts();
    expect(t.ent).toBe("Layer default {\n Index 0\n}\n");
    expect(t.layer).toBe("GenericWorldEntity world {\n}\n");
    expect(newWorldTexts(PREFAB).layer).toBe(`GenericWorldEntity world : "${PREFAB}" {\n}\n`);
    expect(parseCst(t.ent).diagnostics).toEqual([]);
  });

  describe("new", () => {
    it("dry run writes nothing and sends nothing", async () => {
      const { client, sent } = fake();
      const r = await runWorld(
        client,
        { action: "new", path: "Worlds/A.ent", prefab: PREFAB },
        deps,
      );
      expect(r).toMatchObject({
        ok: true,
        action: "new",
        target: "path:Worlds/A.ent",
        changed: null,
      });
      expect(r.ok && r.readback).toMatchObject({
        dryRun: true,
        wouldWrite: [
          { path: "Worlds/A.ent", register: true },
          { path: "Worlds/A_Layers/default.layer", register: false },
        ],
      });
      expect(r.ok && r.next).toMatch(/confirm: true/);
      expect(existsSync(join(root, "Worlds"))).toBe(false);
      expect(sent).toHaveLength(0);
    });

    it("confirm writes both files and registers the .ent", async () => {
      const { client, sent } = fake(registerAnswer);
      const r = await runWorld(
        client,
        { action: "new", path: "Worlds/A.ent", confirm: true },
        deps,
      );
      expect(read("Worlds/A.ent")).toBe("Layer default {\n Index 0\n}\n");
      expect(read("Worlds/A_Layers/default.layer")).toBe("GenericWorldEntity world {\n}\n");
      expect(sent).toEqual([
        {
          api: HANDLER,
          params: { action: "register", path: "Worlds/A.ent", confirm: true },
          access: "mutate",
        },
      ]);
      expect(r).toMatchObject({
        ok: true,
        changed: [
          { path: "Worlds/A.ent", before: null, after: "written" },
          { path: "Worlds/A_Layers/default.layer", before: null, after: "written" },
        ],
        readback: {
          registered: [{ path: "Worlds/A.ent", resourceName: "{FFFFFFFFFFFFFFFF}Worlds/A.ent" }],
        },
      });
      expect(r.ok && r.next).toMatch(/setResource path:Worlds\/A.ent/);
    });

    it("refuses to overwrite without the flag; overwrites with it", async () => {
      write("Worlds/A.ent", "old");
      const { client, sent } = fake(registerAnswer);
      const r = await runWorld(
        client,
        { action: "new", path: "Worlds/A.ent", confirm: true },
        deps,
      );
      expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(!r.ok && r.message).toMatch(/overwrite: true/);
      expect(read("Worlds/A.ent")).toBe("old");
      expect(sent).toHaveLength(0);
      const r2 = await runWorld(
        client,
        { action: "new", path: "Worlds/A.ent", confirm: true, overwrite: true },
        deps,
      );
      expect(r2).toMatchObject({
        ok: true,
        changed: [{ path: "Worlds/A.ent", before: "existed" }, {}],
      });
      expect(read("Worlds/A.ent")).toMatch(/^Layer default/);
    });

    it("a failed register leaves the files and says how to register", async () => {
      const { client } = fake(() => new WorkbenchError("down", "CONNECTION_REFUSED"));
      const r = await runWorld(
        client,
        { action: "new", path: "Worlds/A.ent", confirm: true },
        deps,
      );
      expect(r.ok).toBe(true);
      expect(existsSync(join(root, "Worlds/A.ent"))).toBe(true);
      expect(r.ok && r.warnings.join()).toMatch(/register Worlds\/A.ent: UNREACHABLE/);
      expect(r.ok && r.next).toMatch(/wb_world register path: Worlds\/A.ent confirm: true/);
    });

    it("refuses bad paths, names and prefabs before writing", async () => {
      const { client, sent } = fake();
      const bad: [Record<string, unknown>, string][] = [
        [{ action: "new", path: "C:/x/A.ent" }, "ABSOLUTE_PATH"],
        [{ action: "new", path: "../A.ent" }, "ABSOLUTE_PATH"],
        [{ action: "new", path: "Worlds/A.et" }, "INVALID_ARGUMENT"],
        [{ action: "new", path: "Worlds/a:b.ent" }, "INVALID_ARGUMENT"],
        [{ action: "new", path: "Worlds/A.ent", prefab: "Prefabs/x.et" }, "INVALID_ARGUMENT"],
        [
          { action: "new", path: "Worlds/A.ent", prefab: '{0123456789ABCDEF}a".et' },
          "INVALID_ARGUMENT",
        ],
        [{ action: "new", path: "Worlds/A.ent", to: "x" }, "INVALID_ARGUMENT"],
      ];
      for (const [input, code] of bad) {
        const r = await runWorld(client, { ...input, confirm: true }, deps);
        expect(r, JSON.stringify(input)).toMatchObject({ ok: false, code });
      }
      expect(readdirSync(root)).toEqual([]);
      expect(sent).toHaveLength(0);
    });

    it("refuses a target that escapes the project through a junction", async () => {
      const outside = join(base, "outside");
      mkdirSync(outside);
      const { symlinkSync } = await import("node:fs");
      try {
        symlinkSync(outside, join(root, "Link"), "junction");
      } catch {
        return; // no junction rights on this machine: the guard is covered by path-guard tests
      }
      const { client } = fake();
      const r = await runWorld(client, { action: "new", path: "Link/A.ent", confirm: true }, deps);
      expect(r).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
      expect(readdirSync(outside)).toEqual([]);
    });

    it("refuses with NOT_IN_PROJECT when no project folder is configured", async () => {
      const { client } = fake();
      const r = await runWorld(
        client,
        { action: "new", path: "Worlds/A.ent" },
        { ...deps, projectRoot: undefined },
      );
      expect(r).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
      const r2 = await runWorld(
        client,
        { action: "new", path: "Worlds/A.ent" },
        { ...deps, projectRoot: join(base, "nope") },
      );
      expect(r2).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
    });
  });

  describe("duplicate", () => {
    beforeEach(() => {
      write("Worlds/Src.ent", "Layer default {\n Index 0\n}\n");
      write("Worlds/Src.ent.meta", "META");
      write("Worlds/Src_Layers/default.layer", "GenericWorldEntity world {\n}\n");
      write("Worlds/Src_Layers/Extra.layer", "x\n");
      write("Worlds/Src_Layers/Extra.layer.meta", "META");
      write("Worlds/Src_Layers/Sub/Deep.layer", "d\n");
    });

    it("dry run lists the copy, no .meta, and sends nothing", async () => {
      const { client, sent } = fake();
      const r = await runWorld(
        client,
        { action: "duplicate", path: "Worlds/Src.ent", to: "Copies/Dst.ent" },
        deps,
      );
      expect(r).toMatchObject({ ok: true, target: "path:Copies/Dst.ent", changed: null });
      const would = r.ok
        ? (r.readback as { wouldWrite: { path: string; register: boolean }[] }).wouldWrite
        : [];
      expect(would.map((w) => [w.path, w.register]).sort()).toEqual(
        [
          ["Copies/Dst.ent", true],
          ["Copies/Dst_Layers/default.layer", false],
          ["Copies/Dst_Layers/Extra.layer", true],
          ["Copies/Dst_Layers/Sub/Deep.layer", false],
        ].sort(),
      );
      expect(existsSync(join(root, "Copies"))).toBe(false);
      expect(sent).toHaveLength(0);
    });

    it("confirm copies byte for byte and registers the .ent and files that had a .meta", async () => {
      const { client, sent } = fake(registerAnswer);
      const r = await runWorld(
        client,
        { action: "duplicate", path: "Worlds/Src.ent", to: "Copies/Dst.ent", confirm: true },
        deps,
      );
      expect(r.ok).toBe(true);
      expect(read("Copies/Dst.ent")).toBe(read("Worlds/Src.ent"));
      expect(read("Copies/Dst_Layers/Sub/Deep.layer")).toBe("d\n");
      expect(existsSync(join(root, "Copies/Dst.ent.meta"))).toBe(false);
      expect(existsSync(join(root, "Copies/Dst_Layers/Extra.layer.meta"))).toBe(false);
      expect(sent.map((s) => s.params.path).sort()).toEqual([
        "Copies/Dst.ent",
        "Copies/Dst_Layers/Extra.layer",
      ]);
      expect(sent.every((s) => s.params.confirm === true && s.access === "mutate")).toBe(true);
    });

    it("refuses an existing destination without overwrite, a missing source and itself", async () => {
      write("Copies/Dst.ent", "keep");
      const { client, sent } = fake(registerAnswer);
      const r = await runWorld(
        client,
        { action: "duplicate", path: "Worlds/Src.ent", to: "Copies/Dst.ent", confirm: true },
        deps,
      );
      expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(read("Copies/Dst.ent")).toBe("keep");
      const missing = await runWorld(
        client,
        { action: "duplicate", path: "Worlds/None.ent", to: "Copies/X.ent" },
        deps,
      );
      expect(missing).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
      const self = await runWorld(
        client,
        { action: "duplicate", path: "Worlds/Src.ent", to: "Worlds/Src.ent" },
        deps,
      );
      expect(self).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(
        await runWorld(client, { action: "duplicate", path: "Worlds/Src.ent" }, deps),
      ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(sent).toHaveLength(0);
      write("Copies/Dst_Layers/Stale.layer", "s");
      const over = await runWorld(
        client,
        {
          action: "duplicate",
          path: "Worlds/Src.ent",
          to: "Copies/Dst.ent",
          confirm: true,
          overwrite: true,
        },
        deps,
      );
      expect(over.ok).toBe(true);
      expect(read("Copies/Dst.ent")).toBe(read("Worlds/Src.ent"));
      expect(over.ok && over.warnings.join()).toMatch(/Stale.layer/);
    });

    it("warns that terrain data is not copied", async () => {
      write("Worlds/Src.topo", "t");
      const { client } = fake();
      const r = await runWorld(
        client,
        { action: "duplicate", path: "Worlds/Src.ent", to: "Copies/Dst.ent" },
        deps,
      );
      expect(r.ok && r.warnings.join()).toMatch(/terrain data is not copied \(Src.topo\)/);
    });
  });

  describe("saveAs", () => {
    beforeEach(() => {
      write("Worlds/Src.ent", "Layer default {\n Index 0\n}\n");
      write("Worlds/Src_Layers/default.layer", "GenericWorldEntity world {\n}\n");
    });
    const stateOk = ok({ worldPath: "$Proj:Worlds/Src.ent", mode: "edit" });

    it("dry run reads state only", async () => {
      const { client, sent } = queue(stateOk);
      const r = await runWorld(client, { action: "saveAs", to: "Worlds/New.ent" }, deps);
      expect(sent).toEqual([{ api: HANDLER, params: { action: "state" }, access: "read" }]);
      expect(r).toMatchObject({
        ok: true,
        changed: null,
        readback: { dryRun: true, from: "Worlds/Src.ent" },
      });
      expect(existsSync(join(root, "Worlds/New.ent"))).toBe(false);
    });

    it("confirm: save, copy, register, setResource, in that order", async () => {
      const { client, sent } = fake((api, p) => {
        if (api === HANDLER && p.action === "state") return stateOk;
        if (api === HANDLER) return registerAnswer(api, p);
        if (p.action === "save")
          return ok({ dryRun: 0, result: 1, worldPath: "$Proj:Worlds/Src.ent" });
        return ok({ path: String(p.path), result: 1, openedIn: "WorldEditor" });
      });
      const r = await runWorld(
        client,
        { action: "saveAs", to: "Worlds/New.ent", confirm: true },
        deps,
      );
      expect(sent.map((s) => `${s.api}.${String(s.params.action)}`)).toEqual([
        "EMCP_WB_World.state",
        "EMCP_WB_Module.save",
        "EMCP_WB_World.register",
        "EMCP_WB_Module.setResource",
      ]);
      expect(sent[1].params).toMatchObject({ moduleName: "WorldEditor", confirm: true });
      expect(sent[3].params).toMatchObject({ moduleName: "WorldEditor", path: "Worlds/New.ent" });
      expect(read("Worlds/New_Layers/default.layer")).toBe("GenericWorldEntity world {\n}\n");
      expect(r).toMatchObject({ ok: true, readback: { opened: true } });
      const changed = r.ok ? (r.changed ?? []) : [];
      expect(changed[0]).toEqual({ path: "Worlds/Src.ent", before: null, after: "saved" });
      expect(changed[changed.length - 1]).toEqual({
        path: "WorldEditor.openedResource",
        before: "Worlds/Src.ent",
        after: "Worlds/New.ent",
      });
    });

    it("a failed save stops before any write", async () => {
      const { client, sent } = fake((api, p) =>
        api === HANDLER && p.action === "state"
          ? stateOk
          : refused("NOT_IN_PROJECT", "NOT_IN_PROJECT: no", "step"),
      );
      const r = await runWorld(
        client,
        { action: "saveAs", to: "Worlds/New.ent", confirm: true },
        deps,
      );
      expect(r).toMatchObject({ ok: false, action: "saveAs", code: "NOT_IN_PROJECT" });
      expect(sent).toHaveLength(2);
      expect(existsSync(join(root, "Worlds/New.ent"))).toBe(false);
    });

    it("refuses with no world, in play, a world outside the project, and an existing target", async () => {
      const noWorld = queue(ok({ worldPath: "", mode: "unknown" }));
      expect(
        await runWorld(noWorld.client, { action: "saveAs", to: "W/N.ent" }, deps),
      ).toMatchObject({ code: "NO_WORLD" });
      const play = queue(ok({ worldPath: "$Proj:Worlds/Src.ent", mode: "play" }));
      expect(await runWorld(play.client, { action: "saveAs", to: "W/N.ent" }, deps)).toMatchObject({
        code: "WRONG_MODE",
      });
      const vanilla = queue(ok({ worldPath: "$ArmaReforger:worlds/Eden/Eden.ent", mode: "edit" }));
      expect(
        await runWorld(vanilla.client, { action: "saveAs", to: "W/N.ent" }, deps),
      ).toMatchObject({ code: "NOT_IN_PROJECT" });
      write("Worlds/New.ent", "x");
      const exists = fake((api, p) => (api === HANDLER && p.action === "state" ? stateOk : ok()));
      const r = await runWorld(
        exists.client,
        { action: "saveAs", to: "Worlds/New.ent", confirm: true },
        deps,
      );
      expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(exists.sent).toHaveLength(1);
    });

    it("a copy that fails after the save says the world was saved (review F8)", async () => {
      const { client } = fake((api, p) => {
        if (api === HANDLER && p.action === "state") return stateOk;
        if (api === HANDLER) return registerAnswer(api, p);
        if (p.action === "save") {
          // The destination becomes unwritable between the check and the copy.
          mkdirSync(join(root, "Worlds/New.ent"), { recursive: true });
          return ok({ dryRun: 0, result: 1, worldPath: "$Proj:Worlds/Src.ent" });
        }
        return ok({ path: String(p.path), result: 1, openedIn: "WorldEditor" });
      });
      const r = await runWorld(
        client,
        { action: "saveAs", to: "Worlds/New.ent", confirm: true, overwrite: true },
        deps,
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.message).toMatch(/was saved \(wb_module save\); the copy to Worlds\/New\.ent failed/);
      expect(r.next).not.toMatch(/Nothing was kept/);
      expect(r.code).not.toBe("INVALID_ARGUMENT");
      expect(existsSync(join(root, "Worlds/New_Layers/default.layer"))).toBe(false);
    });

    it("state LOST is LOST", async () => {
      const { client } = queue(new WorkbenchError("reset", "LOST"));
      expect(await runWorld(client, { action: "saveAs", to: "W/N.ent" }, deps)).toMatchObject({
        ok: false,
        code: "LOST",
      });
    });
  });

  describe("setWorldEntity", () => {
    const LAYER =
      "// head\r\nGenericWorldEntity world {\r\n m_x 1\r\n}\r\nGenericEntity tree {\r\n}\r\n";
    beforeEach(() => {
      write("Worlds/W.ent", "Layer default {\n Index 0\n}\n");
      write("Worlds/W_Layers/default.layer", LAYER);
    });

    it("dry run shows the header before and after, writes nothing", async () => {
      const { client, sent } = fake();
      const r = await runWorld(
        client,
        { action: "setWorldEntity", path: "Worlds/W.ent", prefab: PREFAB },
        deps,
      );
      expect(r).toMatchObject({
        ok: true,
        changed: null,
        readback: {
          dryRun: true,
          file: "Worlds/W_Layers/default.layer",
          wouldChange: [
            {
              path: "Worlds/W_Layers/default.layer:GenericWorldEntity",
              before: "GenericWorldEntity world {",
              after: `GenericWorldEntity world : "${PREFAB}" {`,
            },
          ],
        },
      });
      expect(read("Worlds/W_Layers/default.layer")).toBe(LAYER);
      expect(sent).toHaveLength(0);
    });

    it("confirm edits only the header, keeps CRLF, snapshots the original", async () => {
      const { client } = fake();
      const r = await runWorld(
        client,
        { action: "setWorldEntity", path: "Worlds/W.ent", prefab: PREFAB, confirm: true },
        deps,
      );
      expect(read("Worlds/W_Layers/default.layer")).toBe(
        LAYER.replace("GenericWorldEntity world {", `GenericWorldEntity world : "${PREFAB}" {`),
      );
      expect(r).toMatchObject({
        ok: true,
        readback: { snapshot: expect.stringMatching(/^<artifacts>\/world\/.*-W-default\.layer$/) },
      });
      const snaps = readdirSync(join(artifacts, "world"));
      expect(snaps).toHaveLength(1);
      expect(readFileSync(join(artifacts, "world", snaps[0]), "utf8")).toBe(LAYER);
      expect(r.ok && r.warnings.join()).toMatch(/in-memory copy/);
      // and back to the plain entity
      const back = await runWorld(
        client,
        { action: "setWorldEntity", path: "Worlds/W.ent", confirm: true },
        deps,
      );
      expect(back.ok).toBe(true);
      expect(read("Worlds/W_Layers/default.layer")).toBe(LAYER);
    });

    it("a layer that cannot be written is left unchanged and named, with the snapshot (review F8, F9)", async () => {
      const { client } = fake();
      const layer = join(root, "Worlds/W_Layers/default.layer");
      chmodSync(layer, 0o444);
      try {
        const r = await runWorld(
          client,
          { action: "setWorldEntity", path: "Worlds/W.ent", prefab: PREFAB, confirm: true },
          deps,
        );
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.code).toBe("SAVE_FAILED");
        expect(r.message).toMatch(/is unchanged/);
        expect(r.next).toMatch(/<artifacts>\/world\/.*-W-default\.layer/);
      } finally {
        chmodSync(layer, 0o666);
      }
      expect(read("Worlds/W_Layers/default.layer")).toBe(LAYER);
    });

    it("an unchanged header is no change", async () => {
      const { client } = fake();
      const r = await runWorld(
        client,
        { action: "setWorldEntity", path: "Worlds/W.ent", confirm: true },
        deps,
      );
      expect(r).toMatchObject({ ok: true, changed: null, readback: { unchanged: true } });
    });

    it("refuses a missing world, layer or world entity, and a bad prefab", async () => {
      const { client } = fake();
      expect(
        await runWorld(client, { action: "setWorldEntity", path: "Worlds/X.ent" }, deps),
      ).toMatchObject({ code: "PATH_NOT_FOUND" });
      write("Worlds/Y.ent", "x");
      expect(
        await runWorld(client, { action: "setWorldEntity", path: "Worlds/Y.ent" }, deps),
      ).toMatchObject({ code: "PATH_NOT_FOUND" });
      write("Worlds/Y_Layers/default.layer", "GenericEntity a {\n}\n");
      const none = await runWorld(client, { action: "setWorldEntity", path: "Worlds/Y.ent" }, deps);
      expect(none).toMatchObject({ code: "PATH_NOT_FOUND" });
      expect(!none.ok && none.message).toMatch(/GenericWorldEntity/);
      expect(
        await runWorld(
          client,
          { action: "setWorldEntity", path: "Worlds/W.ent", prefab: "nope" },
          deps,
        ),
      ).toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(
        await runWorld(
          client,
          { action: "setWorldEntity", path: "Worlds/W.ent", overwrite: true },
          deps,
        ),
      ).toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("replaceWorldEntity replaces an existing base", () => {
      const old = "{1111111111111111}Old.et";
      const doc = parseCst(`GenericWorldEntity world : "${old}" {\n}\n`);
      const e = replaceWorldEntity(doc, PREFAB);
      expect(e.doc.serialize()).toBe(`GenericWorldEntity world : "${PREFAB}" {\n}\n`);
      expect(e.before).toBe(`GenericWorldEntity world : "${old}" {`);
    });
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:mcp:action/wb_world.addComment
// census:mcp:action/wb_world.annotate
// census:mcp:action/wb_world.browserSelection
// census:mcp:action/wb_world.comments
// census:mcp:action/wb_world.play
// census:mcp:action/wb_world.playEvents
// census:mcp:action/wb_world.register
// census:mcp:action/wb_world.state
// census:mcp:action/wb_world.stop
