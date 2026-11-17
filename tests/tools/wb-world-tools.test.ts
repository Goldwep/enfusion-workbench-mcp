import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { formatCsv, type ObjectRow } from "../../src/formats/object-import-csv.js";
import {
  ACTIONS,
  HANDLER,
  MAX_ROWS,
  TOOL_NAME,
  WORLD_TOOLS_CONTRACT,
  anglesToVector,
  flatInputShape,
  floatText,
  lookOf,
  mapCameraY,
  mapMultiplier,
  parseCoordsText,
  planReplacements,
  prepareRequest,
  registerWbWorldTools,
  runWorldTools,
  seededRandom,
  wbWorldToolsDescription,
  weightedIndex,
} from "../../src/tools/wb-world-tools.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a function and records what was sent. */
function fakeClient(
  answer: (fn: string, p: Record<string, unknown>, n: number) => Record<string, unknown> | Error,
): { client: WorkbenchClient; sent: Sent[] } {
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
const PREFAB = "{0123456789ABCDEF}Prefabs/Rocks/Rock_01.et";
const PREFAB2 = "{FEDCBA9876543210}Prefabs/Rocks/Rock_02.et";
const ROW = `${PREFAB};100 10 200;0 0 0 1;1`;

async function refusesBeforeSending(input: unknown, code: string, why?: RegExp) {
  const { client, sent } = fakeClient(() => ok());
  const r = await runWorldTools(client, input, { projectPath: "C:/nonexistent/proj" });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe(code);
    if (why) expect(r.message).toMatch(why);
  }
  expect(sent).toHaveLength(0);
}

describe("wb_world_tools contract", () => {
  it("names the eight actions of the handler", () => {
    expect(WORLD_TOOLS_CONTRACT.tool).toBe(TOOL_NAME);
    expect(HANDLER).toBe("EMCP_WB_WorldTools");
    expect([...ACTIONS].sort()).toEqual(
      [
        "exportObjects",
        "floaters",
        "goToCoords",
        "importObjects",
        "replaceEntities",
        "resetFlags",
        "snapToTerrain",
        "stats",
      ].sort(),
    );
  });

  it("its description fits the 400-char budget", () => {
    expect(wbWorldToolsDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("the flat input shape carries every request key but path-less ones as arrays where typed", () => {
    const shape = flatInputShape();
    for (const k of WORLD_TOOLS_CONTRACT.request) {
      if (k === "action") continue;
      expect(Object.keys(shape)).toContain(k);
    }
    expect(shape.entities!.safeParse(["id:1"]).success).toBe(true);
    expect(shape.radius!.safeParse(12.5).success).toBe(true);
  });

  it("registers and answers through the captured handler", async () => {
    const { client, sent } = fakeClient(() => ok({ scanned: 3, total: 0, rows: [] }));
    const h = captureTool((s) => registerWbWorldTools(s, makeConfig({}), client));
    const res = await h({ action: "floaters", radius: undefined });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res)).readback.scanned).toBe(3);
    expect(sent[0]!.params).toEqual({ action: "floaters" });
  });
});

describe("refusals before anything is sent", () => {
  it.each<[Record<string, unknown>, string, RegExp?]>([
    [{ action: "nope" }, "INVALID_ARGUMENT", /unknown action/],
    [{ action: "stats", bogus: 1 }, "INVALID_ARGUMENT", /bogus|Unrecognized/],
    [{ action: "exportObjects", entities: ["foo"] }, "INVALID_ARGUMENT", /entity reference/],
    [
      { action: "exportObjects", entities: ["id:1"], layer: "Default" },
      "INVALID_ARGUMENT",
      /not both/,
    ],
    [{ action: "exportObjects", cursor: "x" }, "INVALID_ARGUMENT", /cursor/],
    [{ action: "exportObjects", limit: 0 }, "INVALID_ARGUMENT", /limit/],
    [{ action: "stats", limit: 201 }, "INVALID_ARGUMENT", /limit/],
    [{ action: "stats", gridSize: 65 }, "INVALID_ARGUMENT", /gridSize/],
    [{ action: "floaters", radius: 0 }, "INVALID_ARGUMENT", /radius/],
    [{ action: "floaters", radius: 5001 }, "INVALID_ARGUMENT", /radius/],
    [{ action: "floaters", minOffset: 5, maxOffset: 1 }, "INVALID_ARGUMENT", /minOffset/],
    [{ action: "goToCoords" }, "INVALID_ARGUMENT", /text/],
    [{ action: "goToCoords", text: "somewhere" }, "INVALID_ARGUMENT", /enfusion link/],
    [{ action: "goToCoords", text: "12345" }, "INVALID_ARGUMENT", /even count/],
    [{ action: "goToCoords", text: "1,2;3" }, "INVALID_ARGUMENT", /three numbers/],
    [{ action: "importObjects" }, "INVALID_ARGUMENT", /rows or a project CSV/],
    [{ action: "importObjects", rows: [ROW], path: "a.csv" }, "INVALID_ARGUMENT", /not both/],
    [{ action: "importObjects", rows: [] }, "INVALID_ARGUMENT", /empty/],
    [
      { action: "importObjects", rows: ["x;1 2 3;0 0 0 1;1"] },
      "INVALID_ARGUMENT",
      /rows\[0\].*GUID/,
    ],
    [
      { action: "importObjects", rows: [`${PREFAB};1 2;0 0 0 1;1`] },
      "INVALID_ARGUMENT",
      /position/,
    ],
    [{ action: "importObjects", path: "C:/x/a.csv" }, "ABSOLUTE_PATH"],
    [{ action: "importObjects", path: "../a.csv" }, "ABSOLUTE_PATH"],
    [{ action: "importObjects", path: "data/a.txt" }, "INVALID_ARGUMENT", /\.csv/],
    [{ action: "resetFlags", flags: ["NOPE"] }, "INVALID_ARGUMENT", /EntityFlags/],
    [{ action: "resetFlags", categories: ["walls"] }, "INVALID_ARGUMENT", /categories\[0\]/],
    [{ action: "resetFlags", entities: ["id:1"], allWorld: true }, "INVALID_ARGUMENT", /not both/],
    [{ action: "resetFlags", allWorld: true, categories: ["any"] }, "INVALID_ARGUMENT", /any/],
    [{ action: "replaceEntities" }, "INVALID_ARGUMENT", /pairs/],
    [{ action: "replaceEntities", pairs: [] }, "INVALID_ARGUMENT", /empty/],
    [{ action: "replaceEntities", pairs: ["id:1"] }, "INVALID_ARGUMENT", /ref=prefab/],
    [{ action: "replaceEntities", pairs: ["id:1=Prefabs/A.et"] }, "INVALID_ARGUMENT", /GUID/],
    [{ action: "replaceEntities", pairs: [`bad=${PREFAB}`] }, "INVALID_ARGUMENT", /pairs\[0\]/],
  ])("%j answers %s", async (input, code, why) => {
    await refusesBeforeSending(input, code, why);
  });

  it("over 200 refs, rows or pairs", async () => {
    const refs = Array.from({ length: 201 }, (_, i) => `index:${i}`);
    await refusesBeforeSending(
      { action: "snapToTerrain", entities: refs },
      "INVALID_ARGUMENT",
      /200/,
    );
    const rows = Array.from({ length: MAX_ROWS + 1 }, () => ROW);
    await refusesBeforeSending({ action: "importObjects", rows }, "INVALID_ARGUMENT", /200/);
    const pairs = Array.from({ length: 201 }, (_, i) => `index:${i}=${PREFAB}`);
    await refusesBeforeSending({ action: "replaceEntities", pairs }, "INVALID_ARGUMENT", /200/);
  });
});

describe("what is sent", () => {
  it("reads go as access read, floats as text, refs canonical", async () => {
    const { client, sent } = fakeClient(() => ok({ scanned: 0, total: 0, rows: [] }));
    await runWorldTools(client, {
      action: "floaters",
      entities: ["id:ABC", "name:Tree 1", "index:3"],
      radius: 250.5,
      minOffset: 0.1,
      maxOffset: 20,
      vegetation: true,
      limit: 10,
    });
    expect(sent[0]!.fn).toBe(HANDLER);
    expect(sent[0]!.options.access).toBe("read");
    expect(sent[0]!.params).toEqual({
      action: "floaters",
      entities: ["id:0x0000000000000abc", "name:Tree 1", "index:3"],
      radius: "250.5",
      minOffset: "0.1",
      maxOffset: "20",
      vegetation: true,
      limit: 10,
    });
  });

  it("writes go as access mutate; flags upper-cased, categories lower-cased", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ scanned: 2, changed: 1, cleared: 1, undoName: "u" }),
    );
    await runWorldTools(client, {
      action: "resetFlags",
      allWorld: true,
      flags: ["static", "Visible"],
      categories: ["Rocks"],
    });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(sent[0]!.params).toMatchObject({ flags: ["STATIC", "VISIBLE"], categories: ["rocks"] });
  });

  it("rows are normalised to the handler form and the path key is never sent", async () => {
    const { client, sent } = fakeClient(() => ok({ created: 1, ids: ["id:0x01"], undoName: "u" }));
    await runWorldTools(client, {
      action: "importObjects",
      rows: [`${PREFAB};100,10,200;0,0,0,1;1`],
      relativeY: true,
    });
    expect(sent[0]!.params).toEqual({ action: "importObjects", rows: [ROW], relativeY: true });
  });

  it("pairs are split at the last = with the ref canonical", async () => {
    const { client, sent } = fakeClient(() => ok({ replaced: 1, ids: ["id:0x02"], undoName: "u" }));
    await runWorldTools(client, {
      action: "replaceEntities",
      pairs: [`id:1=${PREFAB}`],
      keepChildren: false,
    });
    expect(sent[0]!.params).toEqual({
      action: "replaceEntities",
      pairs: [`id:0x0000000000000001=${PREFAB}`],
      keepChildren: false,
    });
  });
});

describe("response mapping", () => {
  it("exportObjects pages, answers rows and CSV text", async () => {
    const { client } = fakeClient(() =>
      ok({
        total: 3,
        rows: [ROW, `${PREFAB2};1 2 3;0 0.5 0 0.5;2`],
        nextCursor: "2:3",
        missing: ["id:0x09"],
      }),
    );
    const r = await runWorldTools(client, { action: "exportObjects", limit: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rb = r.readback as Record<string, unknown>;
    expect(rb.total).toBe(3);
    expect(rb.nextCursor).toBe("2:3");
    expect(rb.csv).toBe(
      `Prefab,x,y,z,qx,qy,qz,qw,scale\n${PREFAB},100,10,200,0,0,0,1,1\n${PREFAB2},1,2,3,0,0.5,0,0.5,2\n`,
    );
    expect(r.next).toContain('cursor "2:3"');
    expect(r.warnings.join()).toContain("missing");
  });

  it("exportObjects later page has no CSV header", async () => {
    const { client } = fakeClient(() => ok({ total: 3, rows: [ROW], nextCursor: "" }));
    const r = await runWorldTools(client, { action: "exportObjects", cursor: "2:3" });
    expect(r.ok && (r.readback as { csv: string }).csv).toBe(`${PREFAB},100,10,200,0,0,0,1,1\n`);
    expect(r.ok && r.next).toContain("importObjects");
  });

  it("floaters rows to objects", async () => {
    const { client } = fakeClient(() =>
      ok({ scanned: 40, total: 2, rows: ["id:0x0a;1.25;floating", "id:0x0b;-0.5;below terrain"] }),
    );
    const r = await runWorldTools(client, { action: "floaters" });
    expect(r.ok && r.readback).toEqual({
      scanned: 40,
      total: 2,
      hits: [
        { id: "id:0x0a", gap: 1.25, reason: "floating" },
        { id: "id:0x0b", gap: -0.5, reason: "below terrain" },
      ],
      missing: [],
    });
  });

  it("stats rows, layers, grid and cellSize", async () => {
    const { client } = fakeClient(() =>
      ok({
        scanned: 9,
        total: 2,
        rows: [`${PREFAB};5`, `${PREFAB2};4`],
        layers: ["default;9"],
        grid: ["1 2", "3 3"],
        cellSize: "6400",
        nextCursor: "",
      }),
    );
    const r = await runWorldTools(client, { action: "stats", gridSize: 2 });
    expect(r.ok && r.readback).toEqual({
      scanned: 9,
      total: 2,
      prefabs: [
        { prefab: PREFAB, count: 5 },
        { prefab: PREFAB2, count: 4 },
      ],
      layers: [{ layer: "default", count: 9 }],
      grid: [
        [1, 2],
        [3, 3],
      ],
      cellSize: 6400,
      nextCursor: null,
    });
  });

  it("importObjects answers ids, failed and the undo point", async () => {
    const { client } = fakeClient(() =>
      ok({
        created: 1,
        ids: ["id:0x01"],
        failed: ["1;RESOURCE_NOT_FOUND no such GUID"],
        undoName: "EMCP wb_world_tools importObjects",
      }),
    );
    const r = await runWorldTools(client, { action: "importObjects", rows: [ROW, ROW] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toEqual([{ path: "id:0x01", before: null, after: "created" }]);
    expect((r.readback as { failed: unknown }).failed).toEqual([
      { at: "1", reason: "RESOURCE_NOT_FOUND no such GUID" },
    ]);
    expect(r.next).toContain("wb_undo_redo");
  });

  it("an ok answer's handler notes are not dropped (review W6-01)", async () => {
    const imp = fakeClient(() =>
      ok({
        created: 1,
        ids: ["id:1"],
        failed: [],
        undoName: "MCP import",
        message: "created 1 of 1; SetVariableValue scale returned false for 1; undo with wb_undo_redo",
      }),
    );
    const i = await runWorldTools(imp.client, { action: "importObjects", rows: [ROW] });
    expect(i.ok).toBe(true);
    if (!i.ok) return;
    expect(i.warnings.join(" ")).toMatch(/1 entit\(ies\) kept at scale 1/);

    const reset = fakeClient(() =>
      ok({
        changed: 1,
        scanned: 1,
        total: 1,
        undoName: "r",
        message: "reset flags on 1 of 1 entities of the world (0 cleared to inherit); 1 RELATIVE_Y changes kept coords (no terrain under them); undo with wb_undo_redo",
      }),
    );
    const f = await runWorldTools(reset.client, { action: "resetFlags" });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.warnings.join(" ")).toMatch(/1 RELATIVE_Y change\(s\) kept their coords/);
  });

  it("snapToTerrain, resetFlags and replaceEntities counts", async () => {
    const snap = fakeClient(() =>
      ok({ moved: 2, failed: ["id:0x03;no runtime entity"], missing: ["name:x"], undoName: "s" }),
    );
    const s = await runWorldTools(snap.client, { action: "snapToTerrain" });
    expect(s.ok && s.readback).toEqual({
      moved: 2,
      missing: ["name:x"],
      failed: [{ at: "id:0x03", reason: "no runtime entity" }],
      undoName: "s",
    });
    const flags = fakeClient(() => ok({ scanned: 5, changed: 0, cleared: 0 }));
    const f = await runWorldTools(flags.client, { action: "resetFlags", entities: ["index:1"] });
    expect(f.ok && f.changed).toEqual([]);
    expect(f.ok && (f.readback as { walked: number | null }).walked).toBeNull();
    // W6 run 1: allWorld on a prop-only world walked entities but none passed the categories filter.
    const none = fakeClient(() => ok({ total: 2, scanned: 0, changed: 0, cleared: 0 }));
    const n = await runWorldTools(none.client, { action: "resetFlags", allWorld: true });
    expect(n.ok && n.readback).toMatchObject({ walked: 2, scanned: 0 });
    expect(n.ok && n.warnings.some((w) => w.includes("none passed the filter"))).toBe(true);
    const rep =fakeClient(() => ok({ replaced: 1, ids: ["id:0x05"], undoName: "r" }));
    const p = await runWorldTools(rep.client, {
      action: "replaceEntities",
      pairs: [`index:0=${PREFAB}`],
    });
    expect(p.ok && (p.readback as { replaced: number }).replaced).toBe(1);
  });

  it.each([
    "NO_WORLD",
    "WRONG_MODE",
    "NOT_IN_PROJECT",
    "NO_TERRAIN",
    "STALE_CURSOR",
    "PATH_NOT_FOUND",
    "ENGINE_FALSE",
    "RESOURCE_NOT_FOUND",
  ])("a handler %s keeps its code and next", async (code) => {
    const { client } = fakeClient(() => ({ status: "error", code, message: "m", next: "do x" }));
    const r = await runWorldTools(client, { action: "stats" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(code);
      expect(r.next).toBe("do x");
    }
  });

  it("an error with failed rows carries them; an unknown code is HANDLER_ERROR with a warning", async () => {
    const a = fakeClient(() => ({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
      message: "no row is valid",
      failed: ["0;RESOURCE_NOT_FOUND x"],
    }));
    const r = await runWorldTools(a.client, { action: "importObjects", rows: [ROW] });
    expect(!r.ok && (r as { readback?: unknown }).readback).toEqual({
      failed: [{ at: "0", reason: "RESOURCE_NOT_FOUND x" }],
      missing: [],
      undoName: null,
    });
    const b = fakeClient(() => ({ status: "error", code: "WHAT", message: "m" }));
    const u = await runWorldTools(b.client, { action: "stats" });
    expect(!u.ok && u.code).toBe("HANDLER_ERROR");
    expect(u.warnings.join()).toContain("WHAT");
    const c = fakeClient(() => ({ status: "weird" }));
    const w = await runWorldTools(c.client, { action: "stats" });
    expect(!w.ok && w.code).toBe("UNREACHABLE");
  });

  it.each(["LOST", "MODAL_OPEN", "WEDGED"] as const)(
    "WorkbenchError %s maps to its code",
    async (code) => {
      const { client } = fakeClient(() => new WorkbenchError(`boom ${code}`, code));
      const r = await runWorldTools(client, { action: "snapToTerrain" });
      expect(!r.ok && r.code).toBe(code);
      if (code === "LOST") expect(!r.ok && r.next).toContain("never retried");
    },
  );

  it("a refused connection is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new WorkbenchError("refused", "CONNECTION_REFUSED"));
    const r = await runWorldTools(client, { action: "stats" });
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });

  it("the handler's own goToCoords answer is never reached: TS serves it", async () => {
    const { sent, client } = fakeClient((fn) =>
      fn === "EMCP_WB_View" ? ok({ before: "0 0 0", after: "1 2 3" }) : ok(),
    );
    await runWorldTools(client, { action: "goToCoords", text: "1,2,3" });
    expect(sent.map((s) => s.fn)).toEqual(["EMCP_WB_View"]);
  });
});

describe("importObjects from a project CSV", () => {
  let root: string;
  const rows = (n: number): ObjectRow[] =>
    Array.from({ length: n }, (_, i) => ({
      prefab: PREFAB,
      position: [String(i), "1.5", String(-i)] as [string, string, string],
      quaternion: ["0", "0", "0", "1"] as [string, string, string, string],
      scale: "1",
    }));

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "wbwt-"));
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "big.csv"), formatCsv(rows(450)));
    writeFileSync(
      join(root, "data", "small.csv"),
      formatCsv(rows(3), { header: false, eol: "\r\n" }),
    );
    writeFileSync(
      join(root, "data", "bad.csv"),
      `Prefab,x,y,z,qx,qy,qz,qw,scale\n${PREFAB},1,2,3,0,0,0,1,1\nnot a row\n`,
    );
    writeFileSync(join(root, "data", "empty.csv"), "Prefab,x,y,z,qx,qy,qz,qw,scale\n");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("sends 450 rows in calls of 200, 200 and 50 and maps failed rows to CSV lines", async () => {
    let id = 0;
    const { client, sent } = fakeClient((_fn, p, n) => {
      const count = (p.rows as string[]).length;
      const ids = Array.from(
        { length: count - (n === 1 ? 1 : 0) },
        () => `id:0x${(++id).toString(16)}`,
      );
      return ok({
        created: ids.length,
        ids,
        failed: n === 1 ? ["5;ENGINE_FALSE CreateEntity returned null"] : [],
        undoName: "EMCP wb_world_tools importObjects",
      });
    });
    const r = await runWorldTools(
      client,
      { action: "importObjects", path: "data/big.csv", layer: "Imported" },
      { projectPath: root },
    );
    expect(sent.map((s) => (s.params.rows as string[]).length)).toEqual([200, 200, 50]);
    expect(sent.every((s) => s.options.access === "mutate" && s.params.layer === "Imported")).toBe(
      true,
    );
    expect(sent.every((s) => !("path" in s.params))).toBe(true);
    expect((sent[0]!.params.rows as string[])[1]).toBe(`${PREFAB};1 1.5 -1;0 0 0 1;1`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rb = r.readback as Record<string, unknown>;
    expect(rb.created).toBe(449);
    expect(rb.calls).toBe(3);
    expect(rb.header).toBe(true);
    // Row 205 of the file (index 205), line 207 (header on line 1).
    expect(rb.failed).toEqual([
      { at: "205", line: 207, reason: "ENGINE_FALSE CreateEntity returned null" },
    ]);
    expect(r.warnings.join("|")).toMatch(/3 undo points/);
    expect(r.warnings.join("|")).toMatch(/relativeY was not given/);
    expect(r.next).toContain("3 times");
  });

  it("a small CSV without header is one call; relativeY is passed through", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ created: 3, ids: ["id:0x1", "id:0x2", "id:0x3"], undoName: "u" }),
    );
    const r = await runWorldTools(
      client,
      { action: "importObjects", path: "data/small.csv", relativeY: false },
      { projectPath: root },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params.relativeY).toBe(false);
    expect(r.ok && r.warnings).toEqual([]);
  });

  it("a failed later call answers what the earlier calls created", async () => {
    const { client } = fakeClient((_fn, p, n) =>
      n === 0
        ? ok({
            created: 200,
            ids: Array.from({ length: 200 }, (_, i) => `id:0x${i + 1}`),
            undoName: "u",
          })
        : new WorkbenchError("lost", "LOST"),
    );
    const r = await runWorldTools(
      client,
      { action: "importObjects", path: "data/big.csv" },
      { projectPath: root },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("LOST");
    expect(r.message).toMatch(/call 2 of 3 failed after 200/);
    expect((r as { readback?: { created: number } }).readback?.created).toBe(200);
    expect(r.next).toMatch(/undo 1 time/);
  });

  it("refuses invalid lines, an empty file, a missing file and no project, sending nothing", async () => {
    const { client, sent } = fakeClient(() => ok());
    const bad = await runWorldTools(
      client,
      { action: "importObjects", path: "data/bad.csv" },
      { projectPath: root },
    );
    expect(!bad.ok && bad.code).toBe("INVALID_ARGUMENT");
    expect(!bad.ok && bad.message).toMatch(/line 3/);
    const empty = await runWorldTools(
      client,
      { action: "importObjects", path: "data/empty.csv" },
      { projectPath: root },
    );
    expect(!empty.ok && empty.message).toMatch(/no rows/);
    const missing = await runWorldTools(
      client,
      { action: "importObjects", path: "data/none.csv" },
      { projectPath: root },
    );
    expect(!missing.ok && missing.code).toBe("PATH_NOT_FOUND");
    const noRoot = await runWorldTools(
      client,
      { action: "importObjects", path: "data/big.csv" },
      {},
    );
    expect(!noRoot.ok && noRoot.code).toBe("NOT_IN_PROJECT");
    expect(sent).toHaveLength(0);
  });
});

describe("goToCoords: SCR_CoordsTool forms", () => {
  it("map digits of 4, 6, 8 and 10 use multiplier 10^(5-half), x + 0.5m, rotation -45 0 0", () => {
    const cases: Array<[string, number, [number, number, number], number]> = [
      ["1234", 1000, [12 * 1000 + 500, 0, 34 * 1000], 1000],
      ["123 456", 100, [123 * 100 + 50, 0, 456 * 100], 100],
      ["0123 0456", 10, [123 * 10 + 5, 0, 456 * 10], 10],
      ["01234 05678", 1, [1234.5, 0, 5678], 5],
    ];
    for (const [text, m, pos, lift] of cases) {
      const p = parseCoordsText(text);
      expect(p.form).toBe("map");
      expect(p.map!.multiplier).toBe(m);
      expect(p.position).toEqual(pos);
      expect(p.rotation).toEqual([-45, 0, 0]);
      expect(p.map!.lift).toBe(lift);
    }
    expect(mapMultiplier(6)).toBe(0.1);
    expect(parseCoordsText("123456 654321").position[0]).toBeCloseTo(12345.65, 9);
  });

  it("Y lift is max(multiplier, 5) on the terrain height, or the lift alone at or below 0", () => {
    expect(mapCameraY(120, 1000)).toBe(1120);
    expect(mapCameraY(0, 100)).toBe(100);
    expect(mapCameraY(-3, 5)).toBe(5);
    expect(mapCameraY(null, 5)).toBe(5);
  });

  it("x,y,z;p,y,r and x,y,z", () => {
    expect(parseCoordsText("100.5,20,-300;10,90,0")).toEqual({
      form: "coords",
      position: [100.5, 20, -300],
      rotation: [10, 90, 0],
    });
    expect(parseCoordsText("1, 2, 3")).toEqual({
      form: "coords",
      position: [1, 2, 3],
      rotation: [0, 0, 0],
    });
    expect(parseCoordsText("1 2 3").form).toBe("coords");
    expect(parseCoordsText("1,2,3;").rotation).toEqual([0, 0, 0]);
  });

  it("enfusion link, with and without the redirect prefix", () => {
    const link = "enfusion://WorldEditor/worlds/Test/Test.ent;4800.5,30,6100;-20,45,0";
    const p = parseCoordsText(link);
    expect(p).toEqual({
      form: "link",
      position: [4800.5, 30, 6100],
      rotation: [-20, 45, 0],
      world: "worlds/Test/Test.ent",
    });
    expect(parseCoordsText(`https://enfusionengine.com/api/redirect?to=${link}`)).toEqual(p);
    expect(
      parseCoordsText(`https://enfusionengine.com/api/redirect?to=${encodeURIComponent(link)}`),
    ).toEqual(p);
    expect(() => parseCoordsText("enfusion://WorldEditor/worlds/Test/Test.ent")).toThrow(
      /no coordinates/,
    );
  });

  it("AnglesToVector matches the engine's documented examples", () => {
    const a = anglesToVector(45, 0);
    expect(a[0]).toBeCloseTo(0.707107, 6);
    expect(a[1]).toBeCloseTo(0, 9);
    expect(a[2]).toBeCloseTo(0.707107, 6);
    const b = anglesToVector(15, 60);
    expect(b[0]).toBeCloseTo(0.12941, 5);
    expect(b[1]).toBeCloseTo(0.866025, 6);
    expect(b[2]).toBeCloseTo(0.482963, 6);
    // SetCamera swaps pitch,yaw,roll to yaw,pitch,roll before AnglesToVector.
    expect(lookOf([60, 15, 0])).toEqual(anglesToVector(15, 60));
  });

  it("floatText never answers -0 or an exponent for ordinary values", () => {
    expect(floatText(-0)).toBe("0");
    expect(floatText(1e-9)).toBe("0");
    expect(floatText(0.7071067811865476)).toBe("0.707107");
  });

  it("map digits: reads the terrain height then sets the camera lifted and looking down 45 degrees", async () => {
    const { client, sent } = fakeClient((fn, p) => {
      if (fn === "EMCP_WB_Terrain")
        return ok({ rows: [`${(p.points as string[])[0]!.replace(" ", "|")}|true|42.5`] });
      return ok({ before: "0 0 0", after: "12350 142.5 45600" });
    });
    const r = await runWorldTools(client, { action: "goToCoords", text: "123 456" });
    expect(sent.map((s) => s.fn)).toEqual(["EMCP_WB_Terrain", "EMCP_WB_View"]);
    expect(sent[0]!.params).toEqual({ action: "heights", points: ["12350 45600"] });
    expect(sent[1]!.params.action).toBe("setCamera");
    expect(sent[1]!.params.coords).toBe("12350 142.5 45600");
    expect(sent[1]!.params.look).toBe("0 -0.707107 0.707107");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.action).toBe("goToCoords");
    expect((r.readback as { terrainY: number }).terrainY).toBe(42.5);
    expect(r.changed).toEqual([
      { path: "camera.position", before: "0 0 0", after: "12350 142.5 45600" },
    ]);
  });

  it("map digits off the terrain: lift only, with a warning", async () => {
    const { client, sent } = fakeClient((fn) =>
      fn === "EMCP_WB_Terrain"
        ? ok({ rows: ["99500|99000|false|0"] })
        : ok({ before: "", after: "" }),
    );
    const r = await runWorldTools(client, { action: "goToCoords", text: "99 99" });
    expect(sent[1]!.params.coords).toBe("99500 1000 99000");
    expect(r.warnings.join()).toMatch(/off the terrain/);
  });

  it("a terrain refusal stops before the camera moves", async () => {
    const { client, sent } = fakeClient(() => ({
      status: "error",
      code: "NO_TERRAIN",
      message: "none",
    }));
    const r = await runWorldTools(client, { action: "goToCoords", text: "1234" });
    expect(!r.ok && r.code).toBe("NO_TERRAIN");
    expect(r.action).toBe("goToCoords");
    expect(sent).toHaveLength(1);
  });

  it("a link warns that only the camera moved; a setCamera refusal is answered", async () => {
    const a = fakeClient(() => ok({ before: "1 1 1", after: "4800.5 30 6100" }));
    const r = await runWorldTools(a.client, {
      action: "goToCoords",
      text: "enfusion://WorldEditor/worlds/Test/Test.ent;4800.5,30,6100",
    });
    expect(a.sent[0]!.params).toEqual({
      action: "setCamera",
      coords: "4800.5 30 6100",
      look: "0 0 1",
    });
    expect(r.warnings.join()).toMatch(/names world/);
    const b = fakeClient(() => ({ status: "refused", code: "NOT_IN_PROJECT", message: "no" }));
    const n = await runWorldTools(b.client, { action: "goToCoords", text: "1,2,3" });
    expect(!n.ok && n.code).toBe("NOT_IN_PROJECT");
    expect(n.action).toBe("goToCoords");
  });
});

describe("replaceEntities helper (SCR_EntityReplacerTool, OD-10)", () => {
  it("weightedIndex follows SCR_ArrayHelper.GetWeightedIndex", () => {
    expect(weightedIndex([], 0.5)).toBe(-1);
    expect(weightedIndex([50, 50], 0)).toBe(0);
    expect(weightedIndex([50, 50], 0.49)).toBe(0);
    expect(weightedIndex([50, 50], 0.5)).toBe(1);
    expect(weightedIndex([0, 10], 0.1)).toBe(1);
    expect(weightedIndex([1, 1], 1)).toBe(0);
    expect(weightedIndex([1, 3], 1.5)).toBe(1);
  });

  const cands = [
    { ref: "id:1", prefab: PREFAB },
    { ref: "index:2", prefab: "{0123456789abcdef}Other/Path.et" },
    { ref: "name:skip", prefab: "{1111111111111111}X.et" },
  ];
  const A = "{AAAAAAAAAAAAAAAA}A.et";
  const B = "{BBBBBBBBBBBBBBBB}B.et";

  it("in order: item n replaced with item n; GUID matches case-insensitively", () => {
    const pairs = planReplacements(cands, [{ prefab: PREFAB }], [{ prefab: A }, { prefab: B }], {
      inOrder: true,
      random: () => 0.5,
    });
    expect(pairs).toEqual([`id:0x0000000000000001=${A}`, `index:2=${A}`]);
  });

  it("percentage 0 replaces nothing; weights pick by the random value", () => {
    expect(
      planReplacements(cands, [{ prefab: PREFAB, percentage: 0 }], [{ prefab: A }], {
        random: () => 0.01,
      }),
    ).toEqual([]);
    const seq = [0, 0.9, 0, 0.05];
    let i = 0;
    const pairs = planReplacements(
      cands,
      [{ prefab: PREFAB }],
      [
        { prefab: A, weight: 10 },
        { prefab: B, weight: 90 },
      ],
      {
        random: () => seq[i++]!,
      },
    );
    expect(pairs).toEqual([`id:0x0000000000000001=${B}`, `index:2=${A}`]);
  });

  it("a seeded plan is reproducible and refuses bad input", () => {
    const run = () =>
      planReplacements(
        cands,
        [{ prefab: PREFAB, percentage: 50 }],
        [{ prefab: A }, { prefab: B }],
        {
          random: seededRandom(7),
        },
      );
    expect(run()).toEqual(run());
    expect(() => planReplacements(cands, [], [{ prefab: A }])).toThrow(/toReplace/);
    expect(() => planReplacements(cands, [{ prefab: PREFAB }], [])).toThrow(/replaceWith/);
    expect(() =>
      planReplacements(cands, [{ prefab: PREFAB, percentage: 101 }], [{ prefab: A }]),
    ).toThrow(/percentage/);
    expect(() =>
      planReplacements(cands, [{ prefab: PREFAB }], [{ prefab: A, weight: -1 }]),
    ).toThrow(/weight/);
    expect(() => planReplacements(cands, [{ prefab: PREFAB }], [{ prefab: "A.et" }])).toThrow(
      /GUID/,
    );
  });
});

describe("prepareRequest", () => {
  it("answers the target and mutating flag", () => {
    const p = prepareRequest({ action: "snapToTerrain", entities: ["index:0"] });
    expect(p.ok && [p.target, p.mutating]).toEqual(["open:WorldEditor", true]);
    const q = prepareRequest({ action: "stats" });
    expect(q.ok && q.mutating).toBe(false);
  });
});

// Census rows this file tests (W6 close-out, EV-W6-113).
// census:mcp:action/wb_world_tools.exportObjects
// census:mcp:action/wb_world_tools.floaters
// census:mcp:action/wb_world_tools.goToCoords
// census:mcp:action/wb_world_tools.importObjects
// census:mcp:action/wb_world_tools.replaceEntities
// census:mcp:action/wb_world_tools.stats
