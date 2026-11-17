import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  BOX_MAX,
  HANDLER,
  HANDLER_ACTIONS,
  NAVMESH_CONTRACT,
  REBUILD_WEAK_ORACLE,
  flatInputShape,
  parseTileRows,
  parseVector,
  prepareRequest,
  registerWbNavmesh,
  runNavmesh,
  wbNavmeshDescription,
} from "../../src/tools/wb-navmesh.js";
import { captureTool, textOf } from "./_tool-harness.js";

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

const ENT = "id:0x00000000000000ab";

describe("wb_navmesh contract", () => {
  it("loads and names the six handler actions", () => {
    expect(NAVMESH_CONTRACT.tool).toBe("wb_navmesh");
    expect(HANDLER).toBe("EMCP_WB_Navmesh");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      ["load", "reachable", "rebuild", "rebuildEntity", "status", "tile"].sort(),
    );
  });

  it("its description fits the 400-char budget", () => {
    expect(wbNavmeshDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("the flat input shape carries every request key of the contract", () => {
    const keys = Object.keys(flatInputShape());
    for (const k of NAVMESH_CONTRACT.request) expect(keys).toContain(k);
  });

  it("status keeps the keys the terrain_navmesh_status alias forwards", () => {
    const status = NAVMESH_CONTRACT.actions.find((a) => a.name === "status")!;
    expect(status.params.map((p) => p.key).sort()).toEqual(
      ["cursor", "limit", "project", "step"].sort(),
    );
    expect(status.paging).toBe(true);
    expect(status.mutating).toBe(false);
  });

  it("answers the four W5 navmesh codes from the vocabulary", () => {
    for (const c of ["BOX_TOO_LARGE", "NOT_SCR_AI_WORLD", "NO_AI_WORLD", "NO_NAVMESH_COMPONENT"])
      expect(ERROR_CODES).toHaveProperty(c);
    expect(ERROR_CODES.BOX_TOO_LARGE).toContain(`${BOX_MAX} m`);
  });
});

describe("parseVector and parseTileRows", () => {
  it("parses x y z with spaces or commas", () => {
    expect(parseVector("p", "1 2.5 -3")).toEqual([1, 2.5, -3]);
    expect(parseVector("p", "1, 2, 3")).toEqual([1, 2, 3]);
  });
  it("refuses other shapes with the key named", () => {
    expect(parseVector("position", "1 2")).toMatch(/position must be three numbers/);
    expect(parseVector("position", "1 2 x")).toMatch(/position/);
    expect(parseVector("position", "")).toMatch(/position/);
  });
  it("parses grid rows and counts the bad ones", () => {
    const r = parseTileRows(["10|20|1|0|1", "x|20|1|0|1", "1|2|1", "0|0|0|0|0"]);
    expect(r.rows).toEqual([
      { x: 10, z: 20, loaded: true, valid: false, requested: true },
      { x: 0, z: 0, loaded: false, valid: false, requested: false },
    ]);
    expect(r.bad).toBe(2);
  });
});

describe("prepareRequest refusals (nothing is sent)", () => {
  const refuse = (input: unknown, code: string, text?: RegExp) => {
    const p = prepareRequest(input);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe(code);
      if (text) expect(p.error.message).toMatch(text);
    }
  };

  it("an unknown action", () => refuse({ action: "bake" }, "INVALID_ARGUMENT", /unknown action/));
  it("a key the action does not take", () =>
    refuse({ action: "tile", position: "1 2 3", step: 5 }, "INVALID_ARGUMENT"));
  it("status limit out of range", () => {
    refuse({ action: "status", limit: 0 }, "INVALID_ARGUMENT", /limit/);
    refuse({ action: "status", limit: 201 }, "INVALID_ARGUMENT", /limit/);
  });
  it("status step below 1 or not a number", () => {
    refuse({ action: "status", step: "0.5" }, "INVALID_ARGUMENT", /step/);
    refuse({ action: "status", step: "wide" }, "INVALID_ARGUMENT", /step/);
  });
  it("status with a malformed or backwards cursor", () => {
    refuse({ action: "status", cursor: "abc" }, "INVALID_ARGUMENT", /cursor/);
    refuse({ action: "status", cursor: "9:3" }, "INVALID_ARGUMENT", /past/);
  });
  it("an empty project", () =>
    refuse({ action: "status", project: " " }, "INVALID_ARGUMENT", /project/));
  it("tile, load and reachable need a vector position", () => {
    refuse({ action: "tile" }, "INVALID_ARGUMENT", /position/);
    refuse({ action: "load", position: "1 2" }, "INVALID_ARGUMENT", /position/);
    refuse(
      { action: "reachable", position: "a b c", distance: "5" },
      "INVALID_ARGUMENT",
      /position/,
    );
  });
  it("reachable distance out of (0, 500]", () => {
    refuse(
      { action: "reachable", position: "1 2 3", distance: "0" },
      "INVALID_ARGUMENT",
      /distance/,
    );
    refuse(
      { action: "reachable", position: "1 2 3", distance: 501 },
      "INVALID_ARGUMENT",
      /distance/,
    );
    refuse({ action: "reachable", position: "1 2 3" }, "INVALID_ARGUMENT", /distance/);
  });
  it("rebuild with a malformed or inverted box", () => {
    refuse({ action: "rebuild", min: "0 0", max: "1 1 1" }, "INVALID_ARGUMENT", /min/);
    refuse({ action: "rebuild", min: "0 0 0", max: "x" }, "INVALID_ARGUMENT", /max/);
    refuse({ action: "rebuild", min: "10 0 10", max: "0 5 20" }, "INVALID_ARGUMENT", /above min/);
    refuse({ action: "rebuild", min: "0 5 0", max: "10 0 10" }, "INVALID_ARGUMENT", /above min/);
  });
  it("rebuild above 512 m a side is BOX_TOO_LARGE", () => {
    refuse({ action: "rebuild", min: "0 0 0", max: "513 10 10" }, "BOX_TOO_LARGE", /axis 0/);
    refuse({ action: "rebuild", min: "0 0 0", max: "10 10 600" }, "BOX_TOO_LARGE", /axis 2/);
  });
  it("rebuildEntity with a malformed entity", () => {
    refuse({ action: "rebuildEntity" }, "INVALID_ARGUMENT", /entity/);
    refuse({ action: "rebuildEntity", entity: "foo" }, "INVALID_ARGUMENT", /entity reference/);
  });
});

describe("prepareRequest accepts and normalizes", () => {
  it("sends step and distance as text and confirm explicit on the two rebuilds", () => {
    const s = prepareRequest({ action: "status", step: 32, limit: 50, cursor: "100:900" });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.params).toEqual({ action: "status", step: "32", limit: 50, cursor: "100:900" });
      expect(s.mutating).toBe(false);
    }
    const r = prepareRequest({ action: "reachable", position: "1 2 3", distance: 50 });
    expect(r.ok && r.params.distance).toBe("50");
    // Plain decimal text, never an exponent (review W5-03).
    const tiny = prepareRequest({ action: "reachable", position: "1 2 3", distance: 1e-7 });
    expect(tiny.ok && tiny.params.distance).toBe("0.0000001");
    const b = prepareRequest({ action: "rebuild", min: "0 0 0", max: "512 20 512" });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.params.confirm).toBe(false);
      expect(b.mutating).toBe(true);
    }
    const e = prepareRequest({ action: "rebuildEntity", entity: "id:AB", confirm: true });
    expect(e.ok).toBe(true);
    if (e.ok) {
      expect(e.params).toEqual({ action: "rebuildEntity", entity: ENT, confirm: true });
      expect(e.target).toBe(`entity:${ENT}`);
    }
    const l = prepareRequest({ action: "load", position: "1 2 3" });
    expect(l.ok && l.params).toEqual({ action: "load", position: "1 2 3" });
    expect(l.ok && l.mutating).toBe(true);
  });

  it("the box limit is exactly BOX_MAX", () => {
    expect(BOX_MAX).toBe(512);
    expect(prepareRequest({ action: "rebuild", min: "0 0 0", max: "512 512 512" }).ok).toBe(true);
  });
});

const STATUS_ANSWER = {
  aiWorld: ENT,
  aiWorldClass: "SCR_AIWorld",
  aiWorldFrom: "game",
  project: "Navmesh_Everon",
  projects: ["Navmesh_Everon", "Navmesh_Tall"],
  component: 1,
  boundsMin: "0 0 0",
  boundsMax: "1000 100 1000",
  step: "24",
  rows: ["0|0|1|1|0", "24|0|0|0|1"],
  total: 1764,
  count: 2,
  nextCursor: "2:1764",
};

describe("runNavmesh: status", () => {
  it("sends only the given keys as a read and shapes the grid", async () => {
    const { client, sent } = fakeClient(() => ok(STATUS_ANSWER));
    const r = await runNavmesh(client, { action: "status", limit: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe(HANDLER);
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({ action: "status", limit: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBeNull();
      expect(r.readback).toMatchObject({
        aiWorld: ENT,
        aiWorldClass: "SCR_AIWorld",
        aiWorldFrom: "game",
        project: "Navmesh_Everon",
        projects: ["Navmesh_Everon", "Navmesh_Tall"],
        component: true,
        boundsMin: "0 0 0",
        step: "24",
        total: 1764,
        count: 2,
        nextCursor: "2:1764",
        rows: [
          { x: 0, z: 0, loaded: true, valid: true, requested: false },
          { x: 24, z: 0, loaded: false, valid: false, requested: true },
        ],
      });
      expect(r.next).toMatch(/cursor "2:1764"/);
    }
  });

  it("the last page has no nextCursor", async () => {
    const { client } = fakeClient(() => ok({ ...STATUS_ANSWER, nextCursor: "", count: 2 }));
    const r = await runNavmesh(client, { action: "status", cursor: "1762:1764" });
    expect(r.ok && (r.readback as { nextCursor: unknown }).nextCursor).toBeNull();
    expect(r.ok && r.next).toMatch(/tile/);
  });

  it("pages: a second call carries the cursor the first one answered", async () => {
    const { client, sent } = fakeClient((p) =>
      p.cursor
        ? ok({ ...STATUS_ANSWER, rows: ["48|0|0|0|0"], count: 1, nextCursor: "" })
        : ok(STATUS_ANSWER),
    );
    const first = await runNavmesh(client, { action: "status" });
    const cursor = first.ok ? (first.readback as { nextCursor: string }).nextCursor : "";
    const second = await runNavmesh(client, { action: "status", cursor });
    expect(sent[1].params).toEqual({ action: "status", cursor: "2:1764" });
    expect(second.ok && (second.readback as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("a handler STALE_CURSOR is passed through with the read-again advice", async () => {
    const { client } = fakeClient(() =>
      refused("STALE_CURSOR", "the grid now has 900 points", "read again without a cursor"),
    );
    const r = await runNavmesh(client, { action: "status", cursor: "2:1764" });
    expect(!r.ok && r.code).toBe("STALE_CURSOR");
    expect(!r.ok && r.next).toBe("read again without a cursor");
  });

  it("a cursor whose count differs from the answered total is STALE_CURSOR even if the handler let it by", async () => {
    const { client } = fakeClient(() => ok({ ...STATUS_ANSWER, total: 900 }));
    const r = await runNavmesh(client, { action: "status", cursor: "2:1764" });
    expect(!r.ok && r.code).toBe("STALE_CURSOR");
    expect(!r.ok && r.message).toMatch(/1764.*900/);
  });

  it("a world with no navmesh project answers no grid and says what to add", async () => {
    const { client } = fakeClient(() =>
      ok({ aiWorld: ENT, aiWorldClass: "AIWorld", aiWorldFrom: "editor", component: 0 }),
    );
    const r = await runNavmesh(client, { action: "status" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toMatchObject({ component: false, rows: [], total: 0, project: null });
      expect(r.next).toMatch(/NavmeshWorldComponent/);
    }
  });

  it("warns about rows that do not parse", async () => {
    const { client } = fakeClient(() => ok({ ...STATUS_ANSWER, rows: ["junk"], nextCursor: "" }));
    const r = await runNavmesh(client, { action: "status" });
    expect(r.ok && r.warnings[0]).toMatch(/1 grid row/);
  });
});

describe("runNavmesh: tile, load, reachable", () => {
  it("tile answers the three flags", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ position: "5 0 5", loaded: 1, valid: 1, requested: 0 }),
    );
    const r = await runNavmesh(client, { action: "tile", position: "5 0 5", project: "Navmesh_A" });
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({ action: "tile", position: "5 0 5", project: "Navmesh_A" });
    expect(r.ok && r.readback).toMatchObject({ loaded: true, valid: true, requested: false });
  });

  it("load is a mutate call and warns when the tile is not loaded yet", async () => {
    const { client, sent } = fakeClient(() => ok({ position: "5 0 5", requested: 1, loaded: 0 }));
    const r = await runNavmesh(client, { action: "load", position: "5 0 5" });
    expect(sent[0].options.access).toBe("mutate");
    expect(r.ok && r.warnings[0]).toMatch(/many frames/);
    const refusedLoad = fakeClient(() => ok({ position: "5 0 5", requested: 0, loaded: 0 }));
    const r2 = await runNavmesh(refusedLoad.client, { action: "load", position: "5 0 5" });
    expect(r2.ok && r2.warnings[0]).toMatch(/refused the load/);
  });

  it("reachable answers found with the point, or found with none and a warning", async () => {
    const a = fakeClient(() => ok({ position: "5 0 5", found: 1, point: "6 0 7" }));
    const ra = await runNavmesh(a.client, { action: "reachable", position: "5 0 5", distance: 20 });
    expect(a.sent[0].params).toEqual({ action: "reachable", position: "5 0 5", distance: "20" });
    expect(ra.ok && ra.readback).toMatchObject({ found: true, point: "6 0 7" });
    const b = fakeClient(() => ok({ position: "5 0 5", found: 1 }));
    const rb = await runNavmesh(b.client, { action: "reachable", position: "5 0 5", distance: 20 });
    expect(rb.ok && rb.readback).toMatchObject({ found: true, point: null });
    expect(rb.ok && rb.warnings).toHaveLength(1);
    const c = fakeClient(() => ok({ position: "5 0 5", found: 0 }));
    const rc = await runNavmesh(c.client, { action: "reachable", position: "5 0 5", distance: 20 });
    expect(rc.ok && rc.readback).toMatchObject({ found: false });
  });
});

describe("runNavmesh: rebuild and rebuildEntity", () => {
  it("rebuild dry run sends confirm false and asks for confirm", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ min: "0 0 0", max: "64 10 64", requested: 0, dryRun: 1 }),
    );
    const r = await runNavmesh(client, { action: "rebuild", min: "0 0 0", max: "64 10 64" });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({
      action: "rebuild",
      min: "0 0 0",
      max: "64 10 64",
      confirm: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBeNull();
      expect(r.readback).toMatchObject({ dryRun: true, requested: false });
      expect(r.next).toMatch(/confirm: true/);
    }
  });

  it("a confirmed rebuild says it is in memory and unconfirmed, with the P-W5-15 weak-oracle warning", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ min: "0 0 0", max: "64 10 64", requested: 1, dryRun: 0 }),
    );
    const r = await runNavmesh(client, {
      action: "rebuild",
      min: "0 0 0",
      max: "64 10 64",
      confirm: true,
    });
    expect(sent[0].params.confirm).toBe(true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toEqual([]);
      expect(r.readback).toMatchObject({ dryRun: false, requested: true });
      expect(r.next).toMatch(/Nothing is saved/);
      // Fix-up 1: P-W5-15 KILLED (no observable change), so a confirmed request carries the warning.
      expect(r.warnings).toEqual([REBUILD_WEAK_ORACLE]);
    }
  });

  it("rebuildEntity: dry run, confirmed, and no areas", async () => {
    const dry = fakeClient(() => ok({ entity: ENT, areas: 2, requested: 0, dryRun: 1 }));
    const d = await runNavmesh(dry.client, { action: "rebuildEntity", entity: ENT });
    expect(dry.sent[0].params).toEqual({ action: "rebuildEntity", entity: ENT, confirm: false });
    expect(d.ok && d.readback).toMatchObject({ dryRun: true, areas: 2 });
    expect(d.ok && d.next).toMatch(/confirm: true/);

    const real = fakeClient(() => ok({ entity: ENT, areas: 2, requested: 1, dryRun: 0 }));
    const r = await runNavmesh(real.client, {
      action: "rebuildEntity",
      entity: ENT,
      confirm: true,
    });
    expect(real.sent[0].params.confirm).toBe(true);
    expect(r.ok && r.changed).toEqual([]);
    expect(r.ok && r.warnings).toEqual([REBUILD_WEAK_ORACLE]);

    const none = fakeClient(() => ok({ entity: ENT, areas: 0, requested: 0, dryRun: 0 }));
    const n = await runNavmesh(none.client, {
      action: "rebuildEntity",
      entity: ENT,
      confirm: true,
    });
    expect(n.ok && n.warnings[0]).toMatch(/no rebuild areas/);
  });

  it("a lost rebuild says it cannot be read back and never retries", async () => {
    const { client, sent } = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r = await runNavmesh(client, {
      action: "rebuild",
      min: "0 0 0",
      max: "64 10 64",
      confirm: true,
    });
    expect(sent).toHaveLength(1);
    expect(!r.ok && r.code).toBe("LOST");
    expect(!r.ok && r.next).toMatch(/in memory only/);
  });
});

describe("runNavmesh: handler refusals and failures", () => {
  const codes = [
    "NO_WORLD",
    "WRONG_MODE",
    "NO_AI_WORLD",
    "NO_NAVMESH_COMPONENT",
    "NOT_SCR_AI_WORLD",
    "BOX_TOO_LARGE",
    "NOT_IN_PROJECT",
    "ENTITY_NOT_FOUND",
    "STALE_CURSOR",
    "INVALID_ARGUMENT",
  ];
  for (const code of codes) {
    it(`maps a handler ${code} refusal, keeping its message and next`, async () => {
      const { client } = fakeClient(() => refused(code, `why ${code}`, "do this"));
      const r = await runNavmesh(client, { action: "status" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(r.message).toBe(`why ${code}`);
        expect(r.next).toBe("do this");
      }
    });
  }

  it("a refusal with no next falls back to the table text", async () => {
    const { client } = fakeClient(() => ({ status: "refused", code: "NO_AI_WORLD" }));
    const r = await runNavmesh(client, { action: "status" });
    expect(!r.ok && r.next).toBe(ERROR_CODES.NO_AI_WORLD);
  });

  it("an error status with an unknown code is HANDLER_ERROR with a warning", async () => {
    const { client } = fakeClient(() => ({ status: "error", code: "WEIRD", message: "boom" }));
    const r = await runNavmesh(client, { action: "status" });
    expect(!r.ok && r.code).toBe("HANDLER_ERROR");
    expect(!r.ok && r.warnings[0]).toMatch(/WEIRD/);
  });

  it("an unknown status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "maybe" }));
    const r = await runNavmesh(client, { action: "status" });
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });

  it("maps WorkbenchError LOST, MODAL_OPEN and WEDGED to their names", async () => {
    for (const c of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client } = fakeClient(() => new WorkbenchError(`bad ${c}`, c));
      const r = await runNavmesh(client, { action: "status" });
      expect(!r.ok && r.code).toBe(c);
    }
  });

  it("any other client error is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new Error("socket closed"));
    const r = await runNavmesh(client, { action: "status" });
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });

  it("a refusal before sending sends nothing", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runNavmesh(client, { action: "rebuild", min: "0 0 0", max: "600 1 1" });
    expect(!r.ok && r.code).toBe("BOX_TOO_LARGE");
    expect(sent).toHaveLength(0);
  });
});

describe("registerWbNavmesh", () => {
  it("registers wb_navmesh, drops undefined keys and answers JSON", async () => {
    const { client, sent } = fakeClient(() => ok(STATUS_ANSWER));
    const handler = captureTool((s) => registerWbNavmesh(s, client));
    const res = await handler({ action: "status", project: undefined, step: undefined, limit: 10 });
    expect(sent[0].params).toEqual({ action: "status", limit: 10 });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, action: "status" });
  });

  it("flags a refusal as an error result", async () => {
    const { client } = fakeClient(() => ok());
    const handler = captureTool((s) => registerWbNavmesh(s, client));
    const res = await handler({ action: "tile", position: "1 2" });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:action/wb_navmesh.load
// census:mcp:action/wb_navmesh.reachable
// census:mcp:action/wb_navmesh.status
// census:mcp:action/wb_navmesh.tile
