/**
 * wb_terrain_edit (wave W7, phase5-w7-spec.md 2.1, 3.2, 4; DEC-075): every action against a fake
 * client, the refusals raised before anything is sent, paging, the response mapping, the three
 * write routes, the world gate, NO_BACKUP, and backup and restore on a temp folder. No live calls.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchCallOptions, WorkbenchClient } from "../../src/workbench/client.js";
import { globalOf, tileKey, type TileOrder } from "../../src/formats/terrain-brush.js";
import { parseAsc, readExportTerrain } from "../../src/formats/terrain-export.js";
import {
  EXPORT_TERRAIN_HANDLER,
  HANDLER,
  TERRAIN_EDIT_CONTRACT,
  TERRAIN_HANDLER,
  TerrainBackupRecord,
  WB_TERRAIN_EDIT_DESCRIPTION,
  WORLD_HANDLER,
  loadTerrainPolicy,
  prepareRequest,
  registerWbTerrainEdit,
  runTerrainEdit,
  terrainFileSet,
  truthy,
  type TerrainEditOptions,
  type TerrainPolicy,
  type TerrainEditResponse,
} from "../../src/tools/wb-terrain-edit.js";
import { captureTool, textOf } from "./_tool-harness.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

type Answer = (
  fn: string,
  p: Record<string, unknown>,
) => Record<string, unknown> | Error | undefined;

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });

const SIDE = 9;
const TILES = 2;
const UNIT = 2;
const ORDER: TileOrder = { order: "xMajor", flipZ: false };

/** A fake Workbench: a 2 x 2-tile terrain (side 9, 2 m), an open world, and a call log. */
class FakeWorkbench {
  sent: Sent[] = [];
  worldPath = "$Proj:_throwaway/W7/T.ent";
  mode = "edit";
  tiles = new Map<string, Float64Array>();
  override: Answer = () => undefined;
  client: WorkbenchClient;

  constructor() {
    for (let ty = 0; ty < TILES; ty++) {
      for (let tx = 0; tx < TILES; tx++) {
        const t = new Float64Array(SIDE * SIDE);
        for (let i = 0; i < t.length; i++) {
          const [gx, gz] = globalOf(
            { tilesX: TILES, tilesY: TILES, side: SIDE, unitScale: UNIT, originX: 0, originZ: 0 },
            ORDER,
            tx,
            ty,
            i,
          );
          t[i] = 10 + gx * 0.5 + gz * 0.25;
        }
        this.tiles.set(tileKey(tx, ty), t);
      }
    }
    this.client = {
      call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
        this.sent.push({ fn, params, options });
        const a = this.override(fn, params) ?? this.answer(fn, params);
        if (a instanceof Error) throw a;
        return a;
      },
    } as unknown as WorkbenchClient;
  }

  calls(fn: string, action?: string): Sent[] {
    return this.sent.filter(
      (s) => s.fn === fn && (action === undefined || s.params.action === action),
    );
  }

  answer(fn: string, p: Record<string, unknown>): Record<string, unknown> {
    if (fn === WORLD_HANDLER)
      return ok({ action: "state", worldPath: this.worldPath, mode: this.mode });
    if (fn === TERRAIN_HANDLER) {
      return ok({
        action: "info",
        tilesX: TILES,
        tilesY: TILES,
        resolutionX: TILES * SIDE,
        resolutionY: TILES * SIDE,
        unitScale: UNIT,
        boundsMin: "0 0 0",
        boundsMax: "36 100 36",
      });
    }
    if (fn === EXPORT_TERRAIN_HANDLER) return { Output: 1 };
    if (fn === HANDLER && p.action === "tileRead") {
      const t = this.tiles.get(tileKey(p.tileX as number, p.tileY as number))!;
      const start = typeof p.cursor === "string" ? Number(p.cursor.split(":")[0]) : 0;
      const stop = Math.min(SIDE, start + ((p.limit as number) || 16));
      const rows: string[] = [];
      for (let r = start; r < stop; r++) {
        rows.push(
          `${r}|${Array.from(t.slice(r * SIDE, r * SIDE + SIDE))
            .map(String)
            .join(" ")}`,
        );
      }
      return ok({
        action: "tileRead",
        side: SIDE,
        total: SIDE,
        rows,
        nextCursor: stop < SIDE ? `${stop}:${SIDE}` : "",
      });
    }
    if (fn === HANDLER && p.action === "tileWrite") {
      const n = (p.patches as string[]).length;
      return ok({
        action: "tileWrite",
        tiles: 1,
        samples: n,
        minDelta: "0.5",
        maxDelta: "1.5",
        meanDelta: "1",
        dryRun: p.confirm === true ? 0 : 1,
        undoName:
          p.confirm === true ? `EMCP wb_terrain_edit tileWrite ${p.undoLabel ?? ""}`.trim() : "",
        message: "dry run: 1 tiles",
      });
    }
    if (fn === HANDLER && p.action === "flatter") {
      return ok({
        action: "flatter",
        id: "id:0x00000000000000aa",
        dryRun: p.confirm === true ? 0 : 1,
        undoName: p.confirm === true ? "EMCP wb_terrain_edit flatter" : "",
      });
    }
    if (fn === HANDLER && p.action === "maps") {
      return ok({
        action: "maps",
        built: p.confirm === true ? 1 : 0,
        dryRun: p.confirm === true ? 0 : 1,
      });
    }
    if (fn === HANDLER && p.action === "exportMasks") {
      return ok({
        action: "exportMasks",
        exported: p.confirm === true ? 1 : 0,
        dryRun: p.confirm === true ? 0 : 1,
      });
    }
    return {
      status: "error",
      code: "INVALID_ARGUMENT",
      message: `fake: no answer for ${fn} ${String(p.action)}`,
    };
  }
}

const POLICY =
  (route?: TerrainPolicy["route"], anyWorld = false) =>
  (): TerrainPolicy => ({
    route,
    anyWorld,
    source: "policy.json",
  });

let tmp: string;
let project: string;
let artifacts: string;
let wb: FakeWorkbench;

function writeWorld(rel: string, extra: Record<string, string> = {}): void {
  const files: Record<string, string> = {
    [`${rel}.ent`]: "World {}\n",
    [`${rel}.ent.meta`]: "MetaFileClass {}\n",
    [`${rel}_Layers/default.layer`]: "layer\n",
    [`${rel}/terrain/tile_0_0.bin`]: "AAAA",
    ...extra,
  };
  for (const [p, text] of Object.entries(files)) {
    const abs = join(project, ...p.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, text);
  }
}

function opts(extra: TerrainEditOptions = {}): TerrainEditOptions {
  return {
    projectPath: project,
    artifactsDir: artifacts,
    session: new TerrainBackupRecord(),
    policy: POLICY("handler"),
    now: () => new Date(Date.UTC(2026, 10, 12, 10, 0, 0, 0)),
    ...extra,
  };
}

function bad(r: TerrainEditResponse) {
  if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r)}`);
  return r;
}

function good(r: TerrainEditResponse) {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}

const rb = (r: TerrainEditResponse) => good(r).readback as Record<string, unknown>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wb-terrain-edit-"));
  project = join(tmp, "proj");
  artifacts = join(tmp, "art");
  mkdirSync(project, { recursive: true });
  writeWorld("_throwaway/W7/T");
  writeWorld("worlds/Real");
  wb = new FakeWorkbench();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── Contract ─────────────────────────────────────────────────────────────────

describe("wb_terrain_edit contract", () => {
  it("loads, and its description fits the 400-char budget", () => {
    expect(TERRAIN_EDIT_CONTRACT.tool).toBe("wb_terrain_edit");
    expect(TERRAIN_EDIT_CONTRACT.handler).toBe(HANDLER);
    expect(WB_TERRAIN_EDIT_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(TERRAIN_EDIT_CONTRACT.actions.map((a) => a.name)).toEqual([
      "tileRead",
      "tileWrite",
      "brush",
      "flatter",
      "maps",
      "exportMasks",
      "backup",
      "restore",
    ]);
  });

  it("answers the four W7 codes from the vocabulary (landed by the W7 integration)", () => {
    for (const code of ["ENGINE_BUSY", "NO_BACKUP", "TERRAIN_ACTION_REFUSED", "WORLD_OPEN"]) {
      expect((ERROR_CODES as Record<string, string>)[code]).toBeTruthy();
    }
  });

  it("truthy reads Enforce's 1/0 booleans", () => {
    expect([true, 1, "1", "true"].every(truthy)).toBe(true);
    expect([false, 0, "0", "", undefined].some(truthy)).toBe(false);
  });

  it("registers wb_terrain_edit and answers through the tool handler", async () => {
    const handler = captureTool((s) =>
      registerWbTerrainEdit(s, wb.client, { projectPath: project }, { artifactsDir: artifacts }),
    );
    const res = await handler({ action: "tileRead", tileX: 0, tileY: 0, limit: undefined });
    expect(res.isError).toBe(false);
    expect(JSON.parse(textOf(res)).readback.side).toBe(SIDE);
  });
});

// ── Refusals before anything is sent ─────────────────────────────────────────

describe("wb_terrain_edit request checks (nothing is sent)", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["unknown action", { action: "paint" }, "INVALID_ARGUMENT"],
    ["unknown key", { action: "tileRead", tileX: 0, tileY: 0, foo: 1 }, "INVALID_ARGUMENT"],
    ["negative tile", { action: "tileRead", tileX: -1, tileY: 0 }, "INVALID_ARGUMENT"],
    ["limit over 64", { action: "tileRead", tileX: 0, tileY: 0, limit: 65 }, "INVALID_ARGUMENT"],
    ["bad cursor", { action: "tileRead", tileX: 0, tileY: 0, cursor: "x" }, "INVALID_ARGUMENT"],
    [
      "negative terrain",
      { action: "tileRead", tileX: 0, tileY: 0, terrainIndex: -1 },
      "INVALID_ARGUMENT",
    ],
    ["empty patches", { action: "tileWrite", patches: [] }, "INVALID_ARGUMENT"],
    ["bad patch", { action: "tileWrite", patches: ["1 2 3|4"] }, "INVALID_ARGUMENT"],
    ["patch height", { action: "tileWrite", patches: ["0 0 0 0|99999"] }, "INVALID_ARGUMENT"],
    [
      "65 patches",
      { action: "tileWrite", patches: Array.from({ length: 65 }, () => "0 0 0 0|1") },
      "INVALID_ARGUMENT",
    ],
    [
      "long undo label",
      { action: "tileWrite", patches: ["0 0 0 0|1"], undoLabel: "x".repeat(65) },
      "INVALID_ARGUMENT",
    ],
    [
      "brush mode",
      { action: "brush", mode: "paint", centre: "1 1", radius: "2" },
      "INVALID_ARGUMENT",
    ],
    [
      "brush centre",
      { action: "brush", mode: "sculpt", centre: "1", radius: "2", delta: "1" },
      "INVALID_ARGUMENT",
    ],
    [
      "brush radius",
      { action: "brush", mode: "sculpt", centre: "1 1", radius: "0", delta: "1" },
      "INVALID_ARGUMENT",
    ],
    [
      "sculpt delta",
      { action: "brush", mode: "sculpt", centre: "1 1", radius: "2" },
      "INVALID_ARGUMENT",
    ],
    [
      "brush falloff",
      { action: "brush", mode: "smooth", centre: "1 1", radius: "2", falloff: "cubic" },
      "INVALID_ARGUMENT",
    ],
    [
      "brush strength",
      { action: "brush", mode: "smooth", centre: "1 1", radius: "2", strength: "2" },
      "INVALID_ARGUMENT",
    ],
    [
      "smooth passes",
      { action: "brush", mode: "smooth", centre: "1 1", radius: "2", passes: 9 },
      "INVALID_ARGUMENT",
    ],
    ["flatter op", { action: "flatter", op: "move", entity: "index:0" }, "INVALID_ARGUMENT"],
    ["flatter entity", { action: "flatter", op: "remove", entity: "zzz" }, "INVALID_ARGUMENT"],
    ["flatter box", { action: "flatter", op: "add", entity: "index:0" }, "INVALID_ARGUMENT"],
    [
      "flatter mins > maxs",
      { action: "flatter", op: "add", entity: "index:0", mins: "5 0 0", maxs: "1 1 1" },
      "INVALID_ARGUMENT",
    ],
    [
      "flatter falloff",
      {
        action: "flatter",
        op: "add",
        entity: "index:0",
        mins: "0 0 0",
        maxs: "1 1 1",
        falloff: "-1",
      },
      "INVALID_ARGUMENT",
    ],
    ["maps kind", { action: "maps", kind: "rivers" }, "INVALID_ARGUMENT"],
    ["absolute directory", { action: "exportMasks", directory: "C:/out" }, "ABSOLUTE_PATH"],
    ["dotdot directory", { action: "exportMasks", directory: "a/../../b" }, "ABSOLUTE_PATH"],
    ["backup label", { action: "backup", label: "a b" }, "INVALID_ARGUMENT"],
    ["restore id", { action: "restore", backupId: "../x" }, "INVALID_ARGUMENT"],
  ];
  for (const [name, input, code] of cases) {
    it(`${name}: ${code}`, async () => {
      const r = bad(await runTerrainEdit(wb.client, input, opts()));
      expect(r.code).toBe(code);
      expect(wb.sent).toHaveLength(0);
    });
  }

  it("prepareRequest sends confirm explicitly on the writes that take it", () => {
    const p = prepareRequest({ action: "maps", kind: "shore" });
    expect(p.ok && p.params.confirm).toBe(false);
    const b = prepareRequest({ action: "backup" });
    expect(b.ok && "confirm" in b.params).toBe(false);
    const t = prepareRequest({ action: "tileWrite", patches: ["0  0 1 2|1.00000 -0.5"] });
    expect(t.ok && t.params.patches).toEqual(["0 0 1 2|1 -0.5"]);
  });
});

// ── tileRead ─────────────────────────────────────────────────────────────────

describe("tileRead", () => {
  it("forwards as a read and maps rows, side, total and the next cursor", async () => {
    const r = await runTerrainEdit(
      wb.client,
      { action: "tileRead", tileX: 1, tileY: 0, limit: 4 },
      opts(),
    );
    const back = rb(r);
    expect(back.side).toBe(SIDE);
    expect(back.total).toBe(SIDE);
    expect(back.rows).toHaveLength(4);
    expect(back.nextCursor).toBe(`4:${SIDE}`);
    expect(good(r).next).toContain(`4:${SIDE}`);
    expect(wb.sent[0].options.access).toBe("read");
    expect(wb.sent[0].params).toEqual({ action: "tileRead", tileX: 1, tileY: 0, limit: 4 });
  });

  it("the last page has no cursor; a stale cursor is refused", async () => {
    const last = rb(
      await runTerrainEdit(
        wb.client,
        { action: "tileRead", tileX: 0, tileY: 0, cursor: `8:${SIDE}` },
        opts(),
      ),
    );
    expect(last.rows).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    const stale = bad(
      await runTerrainEdit(
        wb.client,
        { action: "tileRead", tileX: 0, tileY: 0, cursor: "0:5" },
        opts(),
      ),
    );
    expect(stale.code).toBe("STALE_CURSOR");
  });

  it("a handler refusal keeps its code and next; kernel failures map to their codes", async () => {
    wb.override = () => ({
      status: "refused",
      code: "NO_TERRAIN",
      message: "NO_TERRAIN: none",
      next: "open one",
    });
    const r = bad(
      await runTerrainEdit(wb.client, { action: "tileRead", tileX: 0, tileY: 0 }, opts()),
    );
    expect([r.code, r.next]).toEqual(["NO_TERRAIN", "open one"]);
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      wb.override = () => new WorkbenchError(`kernel ${code}`, code);
      const k = bad(
        await runTerrainEdit(wb.client, { action: "tileRead", tileX: 0, tileY: 0 }, opts()),
      );
      expect(k.code).toBe(code);
      expect(k.next).toBe(ERROR_CODES[code]);
    }
    wb.override = () => new WorkbenchError("refused", "CONNECTION_REFUSED");
    expect(
      bad(await runTerrainEdit(wb.client, { action: "tileRead", tileX: 0, tileY: 0 }, opts())).code,
    ).toBe("UNREACHABLE");
  });
});

// ── tileWrite ────────────────────────────────────────────────────────────────

const PATCH = ["0 0 2 3|11 12 13"];

describe("tileWrite", () => {
  it("dry run: the handler's estimate with confirm false, plus the area in m2", async () => {
    const r = good(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: PATCH },
        opts({ policy: POLICY() }),
      ),
    );
    const w = wb.calls(HANDLER, "tileWrite")[0];
    expect(w.params.confirm).toBe(false);
    expect(w.options.access).toBe("mutate");
    expect(r.readback).toMatchObject({
      samples: 1,
      minDelta: "0.5",
      dryRun: true,
      areaM2: 4,
      route: null,
    });
    expect(r.changed).toBeNull();
    expect(r.warnings.join(" ")).toContain("terrain_write_route");
    expect(wb.calls(WORLD_HANDLER)).toHaveLength(0);
  });

  it("confirmed with no route: GATED naming the policy switch, nothing sent", async () => {
    const r = bad(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: PATCH, confirm: true },
        opts({ policy: POLICY() }),
      ),
    );
    expect(r.code).toBe("GATED");
    expect(r.message).toContain("P-W7-01");
    expect(r.next).toContain("terrain_write_route");
    expect(wb.sent).toHaveLength(0);
  });

  it("confirmed before backup: NO_BACKUP after one state read", async () => {
    const r = bad(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: PATCH, confirm: true },
        opts(),
      ),
    );
    expect(r.code).toBe("NO_BACKUP");
    expect(wb.sent.map((s) => s.fn)).toEqual([WORLD_HANDLER]);
  });

  it("confirmed on a world outside _throwaway/: GATED (world gate) unless any_world", async () => {
    wb.worldPath = "$Proj:worlds/Real.ent";
    const o = opts();
    const r = bad(
      await runTerrainEdit(wb.client, { action: "tileWrite", patches: PATCH, confirm: true }, o),
    );
    expect(r.code).toBe("GATED");
    expect(r.next).toContain("terrain_edit.any_world");
    expect(r.next).toContain("ANY_WORLD_OPEN");
    const any = bad(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: PATCH, confirm: true },
        { ...o, policy: POLICY("handler", true) },
      ),
    );
    expect(any.code).toBe("NO_BACKUP");
  });

  it("refuses NO_WORLD, WRONG_MODE and NOT_IN_PROJECT from the world state", async () => {
    wb.worldPath = "";
    expect(
      bad(
        await runTerrainEdit(
          wb.client,
          { action: "tileWrite", patches: PATCH, confirm: true },
          opts(),
        ),
      ).code,
    ).toBe("NO_WORLD");
    wb.worldPath = "$Proj:_throwaway/W7/T.ent";
    wb.mode = "play";
    expect(
      bad(
        await runTerrainEdit(
          wb.client,
          { action: "tileWrite", patches: PATCH, confirm: true },
          opts(),
        ),
      ).code,
    ).toBe("WRONG_MODE");
    wb.mode = "edit";
    wb.worldPath = "$ArmaReforger:worlds/Eden/Eden.ent";
    expect(
      bad(
        await runTerrainEdit(
          wb.client,
          { action: "tileWrite", patches: PATCH, confirm: true },
          opts(),
        ),
      ).code,
    ).toBe("NOT_IN_PROJECT");
    expect(
      bad(
        await runTerrainEdit(
          wb.client,
          { action: "tileWrite", patches: PATCH, confirm: true },
          opts({ projectPath: undefined }),
        ),
      ).code,
    ).toBe("NOT_IN_PROJECT");
  });

  it("handler route after backup: sends confirm true and maps the undo name", async () => {
    const o = opts();
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    const r = good(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: PATCH, confirm: true, undoLabel: "m" },
        o,
      ),
    );
    const w = wb.calls(HANDLER, "tileWrite")[0];
    expect(w.params).toMatchObject({ confirm: true, undoLabel: "m", patches: PATCH });
    expect(r.readback).toMatchObject({
      dryRun: false,
      undoName: "EMCP wb_terrain_edit tileWrite m",
      route: "handler",
    });
    expect(r.changed).toHaveLength(1);
    expect(r.next).toContain("wb_undo_redo");
  });

  it("handler refusals pass through: GATED, ENGINE_BUSY (local next), LOST never retried", async () => {
    const o = opts();
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    wb.override = (fn, p) =>
      fn === HANDLER && p.action === "tileWrite"
        ? {
            status: "refused",
            code: "GATED",
            message: "GATED: waits for P-W7-01",
            next: "the main session opens it",
            dryRun: 1,
            samples: 1,
          }
        : undefined;
    const g = bad(
      await runTerrainEdit(wb.client, { action: "tileWrite", patches: PATCH, confirm: true }, o),
    );
    expect([g.code, g.next]).toEqual(["GATED", "the main session opens it"]);
    expect(g.readback).toMatchObject({ dryRun: true, samples: 1 });

    wb.override = (fn, p) =>
      fn === HANDLER && p.action === "tileWrite"
        ? { status: "refused", code: "ENGINE_BUSY", message: "busy" }
        : undefined;
    const busy = bad(
      await runTerrainEdit(wb.client, { action: "tileWrite", patches: PATCH, confirm: true }, o),
    );
    expect([busy.code, busy.next]).toEqual(["ENGINE_BUSY", ERROR_CODES.ENGINE_BUSY]);

    wb.override = (fn, p) =>
      fn === HANDLER && p.action === "tileWrite" ? new WorkbenchError("lost", "LOST") : undefined;
    const before = wb.calls(HANDLER, "tileWrite").length;
    const lost = bad(
      await runTerrainEdit(wb.client, { action: "tileWrite", patches: PATCH, confirm: true }, o),
    );
    expect(lost.code).toBe("LOST");
    expect(lost.next).toContain("never retried");
    expect(wb.calls(HANDLER, "tileWrite").length).toBe(before + 1);
  });

  it("K1 route: writes the ExportTerrain binary and sends ExportTerrain with the open world's path", async () => {
    const o = opts({ policy: POLICY("exportTerrain") });
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    const r = good(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: ["1 0 2 3|11 12 13", "0 1 0 0|5"], confirm: true },
        o,
      ),
    );
    expect(wb.calls(HANDLER, "tileWrite")).toHaveLength(0);
    const et = wb.calls(EXPORT_TERRAIN_HANDLER)[0];
    expect(et.params).toMatchObject({ area: SIDE * SIDE, worldPath: wb.worldPath, count: 2 });
    expect(et.options.access).toBe("mutate");
    const recs = readExportTerrain(readFileSync(et.params.path as string), SIDE * SIDE, 2);
    expect(recs.map((x) => [x.tileX, x.tileY])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    const t10 = wb.tiles.get(tileKey(1, 0))!;
    expect(recs[0].heights[2 * SIDE + 3]).toBe(11);
    expect(recs[0].heights[2 * SIDE + 6]).toBe(Math.fround(t10[2 * SIDE + 6]));
    expect(recs[1].heights[0]).toBe(5);
    expect(r.readback).toMatchObject({ route: "exportTerrain", records: 2, dryRun: false });
    expect((r.readback as Record<string, unknown>).samples).toBeGreaterThan(0);
  });

  it("K1 route: Output false is ENGINE_FALSE; terrain index 1 is refused", async () => {
    const o = opts({ policy: POLICY("exportTerrain") });
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    wb.override = (fn) => (fn === EXPORT_TERRAIN_HANDLER ? { Output: 0 } : undefined);
    const f = bad(
      await runTerrainEdit(wb.client, { action: "tileWrite", patches: PATCH, confirm: true }, o),
    );
    expect(f.code).toBe("ENGINE_FALSE");
    expect(f.readback?.binary).toBeTruthy();
    const i = bad(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: PATCH, confirm: true, terrainIndex: 1 },
        o,
      ),
    );
    expect(i.code).toBe("INVALID_ARGUMENT");
    expect(i.message).toContain("index 0 only");
  });

  it("K2 route: GATED on P-W7-01 without the order; with it, an .asc and GATED naming its path", async () => {
    const o = opts({ policy: POLICY("asc") });
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    const g = bad(
      await runTerrainEdit(wb.client, { action: "tileWrite", patches: PATCH, confirm: true }, o),
    );
    expect(g.code).toBe("GATED");
    expect(g.message).toContain("P-W7-01");
    expect(g.next).toContain("TILE_ORDER");

    const r = bad(
      await runTerrainEdit(
        wb.client,
        { action: "tileWrite", patches: PATCH, confirm: true },
        { ...o, tileOrder: ORDER },
      ),
    );
    expect(r.code).toBe("GATED");
    const asc = r.readback?.asc as string;
    expect(r.next).toContain(asc);
    expect(r.next).toContain("OI-W7-4");
    const grid = parseAsc(readFileSync(asc, "utf8"));
    expect([grid.ncols, grid.nrows, grid.cellsize]).toEqual([TILES * SIDE, TILES * SIDE, UNIT]);
    // Tile 0,0 row 2 col 3 is gx 3, gz 2: asc row nrows - 1 - 2.
    expect(grid.values[(grid.nrows - 3) * grid.ncols + 3]).toBe(11);
    expect(wb.calls(HANDLER, "tileWrite")).toHaveLength(0);
    expect(wb.calls(EXPORT_TERRAIN_HANDLER)).toHaveLength(0);
  });
});

// ── brush ────────────────────────────────────────────────────────────────────

const SCULPT = {
  action: "brush",
  mode: "sculpt",
  centre: "18 18",
  radius: "6",
  delta: "2",
  strength: "1",
};

describe("brush", () => {
  it("TILE_ORDER unset: GATED naming P-W7-01 and the switch, nothing sent", async () => {
    const r = bad(await runTerrainEdit(wb.client, { ...SCULPT, confirm: true }, opts()));
    expect(r.code).toBe("GATED");
    expect(r.message).toContain("P-W7-01");
    expect(r.next).toContain("TILE_ORDER");
    expect(wb.sent).toHaveLength(0);
  });

  it("dry run: reads the tiles under the radius page by page and answers the estimate", async () => {
    const r = good(
      await runTerrainEdit(wb.client, SCULPT, opts({ tileOrder: ORDER, policy: POLICY() })),
    );
    const back = r.readback as Record<string, unknown>;
    expect(back.dryRun).toBe(true);
    expect(back.mode).toBe("sculpt");
    expect(back.tiles).toBe(4);
    expect(back.samples).toBeGreaterThan(0);
    expect(Number(back.maxDelta)).toBeLessThanOrEqual(2);
    expect(Number(back.minDelta)).toBeGreaterThan(0);
    expect(back.areaM2).toBe((back.samples as number) * UNIT * UNIT);
    expect(wb.calls(HANDLER, "tileWrite")).toHaveLength(0);
    // side 9 with 64 rows per page: one page per tile.
    expect(wb.calls(HANDLER, "tileRead")).toHaveLength(4);
    expect(wb.calls(WORLD_HANDLER)).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("terrain_write_route");
  });

  it("a brush that changes nothing answers ok with no write", async () => {
    const r = good(
      await runTerrainEdit(
        wb.client,
        { action: "brush", mode: "smooth", centre: "9 9", radius: "6" },
        opts({ tileOrder: ORDER }),
      ),
    );
    expect((r.readback as Record<string, unknown>).samples).toBe(0);
    expect(r.warnings[0]).toContain("changes no sample");
  });

  it("a brush off the terrain is refused", async () => {
    const r = bad(
      await runTerrainEdit(
        wb.client,
        { ...SCULPT, centre: "-500 -500" },
        opts({ tileOrder: ORDER }),
      ),
    );
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(r.message).toContain("does not reach the terrain");
  });

  it("confirmed, handler route: tileWrite calls of at most maxPatchesPerCall runs, one undo each", async () => {
    const o = opts({ tileOrder: ORDER, maxPatchesPerCall: 5 });
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    const r = good(await runTerrainEdit(wb.client, { ...SCULPT, confirm: true }, o));
    const writes = wb.calls(HANDLER, "tileWrite");
    expect(writes.length).toBeGreaterThan(1);
    for (const w of writes) {
      expect((w.params.patches as string[]).length).toBeLessThanOrEqual(5);
      expect(w.params.confirm).toBe(true);
    }
    const back = r.readback as Record<string, unknown>;
    expect(back.calls).toBe(writes.length);
    expect(back.undoNames).toHaveLength(writes.length);
    expect(String(writes[0].params.undoLabel)).toContain("brush sculpt 1/");
  });

  it("confirmed: a failure part way names what was written", async () => {
    const o = opts({ tileOrder: ORDER, maxPatchesPerCall: 5 });
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    let n = 0;
    wb.override = (fn, p) =>
      fn === HANDLER && p.action === "tileWrite" && ++n === 2
        ? { status: "error", code: "ENGINE_FALSE", message: "SetTerrainSurfaceTile returned false" }
        : undefined;
    const r = bad(await runTerrainEdit(wb.client, { ...SCULPT, confirm: true }, o));
    expect(r.code).toBe("ENGINE_FALSE");
    expect(r.message).toContain("call 2 of");
    expect(r.readback).toMatchObject({ written: 1 });
    expect(r.next).toContain("restore from the backup");
  });

  it("confirmed: no route is GATED, no backup is NO_BACKUP", async () => {
    const gated = bad(
      await runTerrainEdit(
        wb.client,
        { ...SCULPT, confirm: true },
        opts({ tileOrder: ORDER, policy: POLICY() }),
      ),
    );
    expect(gated.code).toBe("GATED");
    expect(wb.sent).toHaveLength(0);
    const nb = bad(
      await runTerrainEdit(wb.client, { ...SCULPT, confirm: true }, opts({ tileOrder: ORDER })),
    );
    expect(nb.code).toBe("NO_BACKUP");
  });

  it("confirmed, K1 route: one ExportTerrain call with the four touched tiles", async () => {
    const o = opts({ tileOrder: ORDER, policy: POLICY("exportTerrain") });
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    const r = good(await runTerrainEdit(wb.client, { ...SCULPT, confirm: true }, o));
    const et = wb.calls(EXPORT_TERRAIN_HANDLER);
    expect(et).toHaveLength(1);
    expect(et[0].params.count).toBe(4);
    expect((r.readback as Record<string, unknown>).route).toBe("exportTerrain");
  });

  it("confirmed, K2 route: an .asc and GATED", async () => {
    const o = opts({ tileOrder: ORDER, policy: POLICY("asc") });
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    const r = bad(await runTerrainEdit(wb.client, { ...SCULPT, confirm: true }, o));
    expect(r.code).toBe("GATED");
    expect(existsSync(r.readback?.asc as string)).toBe(true);
  });
});

// ── flatter, maps, exportMasks ───────────────────────────────────────────────

describe("flatter, maps, exportMasks", () => {
  it("dry runs forward confirm false and need no backup", async () => {
    const f = good(
      await runTerrainEdit(
        wb.client,
        {
          action: "flatter",
          op: "add",
          entity: "id:aa",
          mins: "0 0 0",
          maxs: "1 1 1",
          falloff: "2",
        },
        opts(),
      ),
    );
    expect(wb.calls(HANDLER, "flatter")[0].params).toMatchObject({
      entity: "id:0x00000000000000aa",
      confirm: false,
      falloff: "2",
    });
    expect(f.readback).toMatchObject({ dryRun: true, id: "id:0x00000000000000aa" });
    const m = good(
      await runTerrainEdit(wb.client, { action: "maps", kind: "flow", preview: true }, opts()),
    );
    expect(m.readback).toMatchObject({ dryRun: true, built: false });
    expect(wb.calls(WORLD_HANDLER)).toHaveLength(0);
  });

  it("confirmed flatter and maps need the backup and the world gate", async () => {
    const o = opts();
    expect(
      bad(await runTerrainEdit(wb.client, { action: "maps", kind: "shore", confirm: true }, o))
        .code,
    ).toBe("NO_BACKUP");
    expect(wb.calls(HANDLER, "maps")).toHaveLength(0);
    good(await runTerrainEdit(wb.client, { action: "backup" }, o));
    const m = good(
      await runTerrainEdit(wb.client, { action: "maps", kind: "shore", confirm: true }, o),
    );
    expect(m.readback).toMatchObject({ dryRun: false, built: true });
    expect(m.next).toContain("no undo");
    const f = good(
      await runTerrainEdit(
        wb.client,
        { action: "flatter", op: "remove", entity: "index:3", confirm: true },
        o,
      ),
    );
    expect(f.readback).toMatchObject({ dryRun: false, undoName: "EMCP wb_terrain_edit flatter" });
    wb.worldPath = "$Proj:worlds/Real.ent";
    expect(
      bad(
        await runTerrainEdit(
          wb.client,
          { action: "flatter", op: "remove", entity: "index:3", confirm: true },
          o,
        ),
      ).code,
    ).toBe("GATED");
  });

  it("confirmed exportMasks is not behind the backup or the world gate", async () => {
    wb.worldPath = "$Proj:worlds/Real.ent";
    const r = good(
      await runTerrainEdit(
        wb.client,
        { action: "exportMasks", directory: "masks\\out", confirm: true },
        opts(),
      ),
    );
    expect(wb.calls(HANDLER, "exportMasks")[0].params).toMatchObject({
      directory: "masks/out",
      confirm: true,
    });
    expect(r.readback).toMatchObject({ exported: true, dryRun: false });
    expect(wb.calls(WORLD_HANDLER)).toHaveLength(0);
  });
});

// ── backup and restore ───────────────────────────────────────────────────────

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("backup and restore", () => {
  it("the file set: the .ent, its siblings and the <name> and <name>_<word> folders", () => {
    writeWorld("_throwaway/W7/T_Big", {});
    writeFileSync(join(project, "_throwaway", "W7", "T.desc"), "desc");
    const rels = terrainFileSet(project, "_throwaway/W7/T.ent").map((f) => f.rel);
    expect(rels).toEqual([
      "_throwaway/W7/T.desc",
      "_throwaway/W7/T.ent",
      "_throwaway/W7/T.ent.meta",
      "_throwaway/W7/T/terrain/tile_0_0.bin",
      "_throwaway/W7/T_Layers/default.layer",
    ]);
  });

  it("backup copies the set with a sha256 manifest and opens confirmed writes for the session", async () => {
    const o = opts({ policy: POLICY("handler") });
    const r = good(await runTerrainEdit(wb.client, { action: "backup", label: "pre" }, o));
    const back = r.readback as Record<string, unknown>;
    expect(back.backupId).toBe("20261112T100000000Z-pre");
    expect(back.files).toBe(4);
    const manifest = JSON.parse(readFileSync(back.manifest as string, "utf8"));
    expect(manifest.worldRel).toBe("_throwaway/W7/T.ent");
    expect(manifest.worldPath).toBe(wb.worldPath);
    for (const f of manifest.files) {
      expect(f.sha256).toBe(sha(join(project, ...f.rel.split("/"))));
      expect(sha(join(back.folder as string, "files", ...f.rel.split("/")))).toBe(f.sha256);
    }
    expect(o.session!.backupOf("_THROWAWAY/w7/t.ent")).toBe("20261112T100000000Z-pre");
    // A second backup at the same instant gets its own id.
    const again = good(await runTerrainEdit(wb.client, { action: "backup", label: "pre" }, o));
    expect((again.readback as Record<string, unknown>).backupId).toBe("20261112T100000000Z-pre-2");
  });

  it("backup refuses with no world or a world outside the project", async () => {
    wb.worldPath = "";
    expect(bad(await runTerrainEdit(wb.client, { action: "backup" }, opts())).code).toBe(
      "NO_WORLD",
    );
    wb.worldPath = "$ArmaReforger:worlds/Eden/Eden.ent";
    expect(bad(await runTerrainEdit(wb.client, { action: "backup" }, opts())).code).toBe(
      "NOT_IN_PROJECT",
    );
  });

  it("restore: the dry run detects a changed file; confirm restores byte-exact, world closed", async () => {
    const o = opts();
    const id = rb(await runTerrainEdit(wb.client, { action: "backup" }, o)).backupId as string;
    const tile = join(project, "_throwaway", "W7", "T", "terrain", "tile_0_0.bin");
    const before = sha(tile);
    writeFileSync(tile, "CHANGED");
    rmSync(join(project, "_throwaway", "W7", "T_Layers", "default.layer"));
    writeFileSync(join(project, "_throwaway", "W7", "T", "terrain", "new.bin"), "new");

    const dry = good(await runTerrainEdit(wb.client, { action: "restore", backupId: id }, o));
    expect(dry.readback).toMatchObject({
      dryRun: true,
      files: 2,
      changedFiles: ["_throwaway/W7/T/terrain/tile_0_0.bin"],
      missingFiles: ["_throwaway/W7/T_Layers/default.layer"],
      extra: ["_throwaway/W7/T/terrain/new.bin"],
    });
    expect(dry.warnings.join(" ")).toContain("is open in the World Editor");
    expect(sha(tile)).not.toBe(before);

    const open = bad(
      await runTerrainEdit(wb.client, { action: "restore", backupId: id, confirm: true }, o),
    );
    expect(open.code).toBe("WORLD_OPEN");
    expect(open.next).toBe(ERROR_CODES.WORLD_OPEN);

    wb.worldPath = "";
    const r = good(
      await runTerrainEdit(wb.client, { action: "restore", backupId: id, confirm: true }, o),
    );
    expect(sha(tile)).toBe(before);
    expect(existsSync(join(project, "_throwaway", "W7", "T_Layers", "default.layer"))).toBe(true);
    expect(r.readback).toMatchObject({ dryRun: false, verified: true, files: 2 });
    const safety = (r.readback as Record<string, unknown>).safetyBackup as string;
    expect(safety).toContain("prerestore");
    expect(wb.calls(WORLD_HANDLER, "state").at(-1)!.options.skipAutoLaunch).toBe(true);
  });

  it("restore: Workbench not running counts as closed; other state failures refuse", async () => {
    const o = opts();
    const id = rb(await runTerrainEdit(wb.client, { action: "backup" }, o)).backupId as string;
    wb.override = (fn) =>
      fn === WORLD_HANDLER ? new WorkbenchError("no", "CONNECTION_REFUSED") : undefined;
    const r = good(
      await runTerrainEdit(wb.client, { action: "restore", backupId: id, confirm: true }, o),
    );
    expect(r.warnings.join(" ")).toContain("not running");
    wb.override = (fn) =>
      fn === WORLD_HANDLER ? new WorkbenchError("modal", "MODAL_OPEN") : undefined;
    expect(
      bad(await runTerrainEdit(wb.client, { action: "restore", backupId: id, confirm: true }, o))
        .code,
    ).toBe("MODAL_OPEN");
  });

  it("restore: a file that cannot be written answers SAVE_FAILED with what was restored (review W7-TE-01)", async () => {
    const o = opts();
    const id = rb(await runTerrainEdit(wb.client, { action: "backup" }, o)).backupId as string;
    const tile = join(project, "_throwaway", "W7", "T", "terrain", "tile_0_0.bin");
    const before = sha(tile);
    writeFileSync(tile, "CHANGED");
    // The layer file is missing and its folder is now a plain file: its copy cannot be written.
    const layers = join(project, "_throwaway", "W7", "T_Layers");
    rmSync(layers, { recursive: true, force: true });
    writeFileSync(layers, "not a folder");
    wb.worldPath = "";
    const r = bad(
      await runTerrainEdit(wb.client, { action: "restore", backupId: id, confirm: true }, o),
    );
    expect(r.code).toBe("SAVE_FAILED");
    const back = r.readback as Record<string, unknown>;
    expect(back.failed).toEqual(["_throwaway/W7/T_Layers/default.layer"]);
    expect(back.restored).toEqual(["_throwaway/W7/T/terrain/tile_0_0.bin"]);
    expect(String(back.safetyBackup)).toContain("prerestore");
    expect(sha(tile)).toBe(before);
    rmSync(layers, { force: true });
  });

  it("restore refuses a backup whose copies no longer match the manifest", async () => {
    const o = opts();
    const back = rb(await runTerrainEdit(wb.client, { action: "backup" }, o));
    writeFileSync(join(back.folder as string, "files", "_throwaway", "W7", "T.ent"), "tampered");
    wb.worldPath = "";
    const r = bad(
      await runTerrainEdit(
        wb.client,
        { action: "restore", backupId: back.backupId, confirm: true },
        o,
      ),
    );
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(r.message).toContain("does not match its manifest");
    expect(r.readback?.mismatched).toEqual(["_throwaway/W7/T.ent"]);
  });

  it("restore of a world outside _throwaway/ is GATED; an unknown id is PATH_NOT_FOUND", async () => {
    wb.worldPath = "$Proj:worlds/Real.ent";
    const o = opts();
    const id = rb(await runTerrainEdit(wb.client, { action: "backup" }, o)).backupId as string;
    wb.worldPath = "";
    const g = bad(
      await runTerrainEdit(wb.client, { action: "restore", backupId: id, confirm: true }, o),
    );
    expect(g.code).toBe("GATED");
    expect(g.next).toContain("terrain_edit.any_world");
    const dry = good(await runTerrainEdit(wb.client, { action: "restore", backupId: id }, o));
    expect(dry.warnings.join(" ")).toContain("GATED");
    const missing = bad(
      await runTerrainEdit(wb.client, { action: "restore", backupId: "20200101T000000000Z" }, o),
    );
    expect(missing.code).toBe("PATH_NOT_FOUND");
  });

  it("restore refuses a backup of another project", async () => {
    const o = opts();
    const id = rb(await runTerrainEdit(wb.client, { action: "backup" }, o)).backupId as string;
    const other = join(tmp, "other");
    mkdirSync(other);
    const r = bad(
      await runTerrainEdit(
        wb.client,
        { action: "restore", backupId: id },
        { ...o, projectPath: other },
      ),
    );
    expect(r.code).toBe("NOT_IN_PROJECT");
  });
});

// ── Policy ───────────────────────────────────────────────────────────────────

describe("loadTerrainPolicy", () => {
  it("absent keys: no route, any_world false; set keys are read; bad values are ignored", () => {
    const p = join(tmp, "policy.json");
    writeFileSync(p, JSON.stringify({ tiers: [] }));
    expect(loadTerrainPolicy(p)).toEqual({
      route: undefined,
      anyWorld: false,
      source: "policy.json",
    });
    writeFileSync(
      p,
      JSON.stringify({ terrain_write_route: "exportTerrain", terrain_edit: { any_world: true } }),
    );
    expect(loadTerrainPolicy(p)).toEqual({
      route: "exportTerrain",
      anyWorld: true,
      source: "policy.json",
    });
    writeFileSync(
      p,
      JSON.stringify({ terrain_write_route: "gui", terrain_edit: { any_world: "yes" } }),
    );
    expect(loadTerrainPolicy(p)).toMatchObject({ route: undefined, anyWorld: false });
    expect(loadTerrainPolicy(join(tmp, "missing.json"))).toEqual({
      anyWorld: false,
      source: "policy file unreadable",
    });
  });

  it("the repo's policy.json leaves the route absent and any_world off", () => {
    const p = loadTerrainPolicy();
    expect(p.route).toBeUndefined();
    expect(p.anyWorld).toBe(false);
  });
});

describe("fix-up 1: the tile layout (EmptyArland 2049 in 16 tiles of 129)", () => {
  /** info answers the resolution `res`; tileRead adds `layout`. */
  function grid(res: number, layout: string): void {
    wb.override = (fn, p) => {
      if (fn === TERRAIN_HANDLER) {
        return ok({
          action: "info",
          tilesX: TILES,
          tilesY: TILES,
          resolutionX: res,
          resolutionY: res,
          unitScale: UNIT,
          boundsMin: "0 0 0",
          boundsMax: "36 100 36",
        });
      }
      if (fn === HANDLER && p.action === "tileRead") {
        return { ...wb.answer(fn, p), layout };
      }
      return undefined;
    };
  }

  it("a sharedEdge grid (res = tiles * (side - 1) + 1) is read and the layout answered", async () => {
    grid(TILES * (SIDE - 1) + 1, "sharedEdge");
    const r = good(
      await runTerrainEdit(wb.client, SCULPT, opts({ tileOrder: ORDER, policy: POLICY() })),
    );
    expect((r.readback as Record<string, unknown>).layout).toBe("sharedEdge");
    expect(wb.calls(HANDLER, "tileRead").length).toBeGreaterThan(0);
  });

  it("a disjoint grid answers layout disjoint", async () => {
    grid(TILES * SIDE, "disjoint");
    const r = good(
      await runTerrainEdit(wb.client, SCULPT, opts({ tileOrder: ORDER, policy: POLICY() })),
    );
    expect((r.readback as Record<string, unknown>).layout).toBe("disjoint");
  });

  it("a tileRead whose layout disagrees with the resolution is refused before any write", async () => {
    grid(TILES * SIDE, "sharedEdge");
    const r = bad(
      await runTerrainEdit(wb.client, SCULPT, opts({ tileOrder: ORDER, policy: POLICY() })),
    );
    expect(r.code).toBe("HANDLER_ERROR");
    expect(r.message).toContain("layout 'sharedEdge'");
    expect(wb.calls(HANDLER, "tileWrite")).toHaveLength(0);
  });

  it("a resolution that fits neither layout is UNPROVEN with no tile read", async () => {
    // with two tiles one formula always fits a resolution of 3 or more; 2 fits neither (side 1)
    grid(2, "disjoint");
    const r = bad(
      await runTerrainEdit(wb.client, SCULPT, opts({ tileOrder: ORDER, policy: POLICY() })),
    );
    expect(r.code).toBe("UNPROVEN");
    expect(wb.calls(HANDLER, "tileRead")).toHaveLength(0);
  });

  it("tileRead forwards the handler's layout", async () => {
    grid(TILES * (SIDE - 1) + 1, "sharedEdge");
    const r = good(
      await runTerrainEdit(wb.client, { action: "tileRead", tileX: 0, tileY: 0 }, opts()),
    );
    expect((r.readback as Record<string, unknown>).layout).toBe("sharedEdge");
  });
});

// Census rows this file tests (W7 close-out, EV-W7-107).
// census:mcp:action/wb_terrain_edit.tileRead
