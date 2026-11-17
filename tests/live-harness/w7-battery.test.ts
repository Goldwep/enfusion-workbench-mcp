import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { REPO_ROOT, SANDBOX_NAME } from "../../scripts/live/paths.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { BUSY_GRACE_MS } from "../../scripts/census/live/common.js";
import {
  TerrainBackupRecord,
  prepareRequest as prepareTerrainEdit,
} from "../../src/tools/wb-terrain-edit.js";
import { prepareRequest as prepareGenerator } from "../../src/tools/wb-generator.js";
import { prepareRequest as prepareShape } from "../../src/tools/wb-shape.js";
import { prepareRequest as prepareTerrain, runTerrain } from "../../src/tools/wb-terrain.js";
import { prepareRequest as prepareEntity } from "../../src/tools/wb-entity.js";
import { WORLD_REQUEST_SCHEMA } from "../../src/tools/wb-world.js";
import {
  BACKUP_FILE,
  BATTERY_SNAPSHOT_FILE,
  CLOSABLE_STEP,
  DEFAULT_QUEUE,
  ENGINE_ACCEPT,
  ENTITY_WORLD,
  EXIT,
  FILE_WRITE_ACTIONS,
  GATE_STEP,
  H1_STEP,
  LAUNCH_ARGS,
  MASKS_DIR,
  NETZERO_STEP,
  NOT_EXERCISED,
  NOT_TESTABLE,
  ORDERS,
  PLANT_FILE,
  PROBE_IDS,
  SCRIPT_PATH,
  TERRAIN_GO,
  TERRAIN_WRITES,
  TS_ONLY_ACTIONS,
  W7_CONTRACTS,
  W7_ROOT,
  WORLDS_DIR,
  backupFilesOf,
  buildActionPlan,
  buildQueue,
  buildSteps,
  dryRunCheck,
  estimateMisses,
  exercisedBy,
  gateFlagsOf,
  handAnswer,
  isGuardedCall,
  isTerrainWorldRel,
  main,
  markerCells,
  netZeroDiff,
  observedStats,
  orderKey,
  orderMatches,
  ownerBlock,
  ownerGoOf,
  parseTileRows,
  runBattery,
  WATCH_OPTIONS,
  layoutMismatch,
  infoGrid,
  tileSamplesOf,
  wrongModeCheck,
  runPlant,
  runRollback,
  sampleWorld,
  selectSteps,
  sharedEdges,
  terrainEditOptions,
  throwawayRefusal,
  underW7,
  worldRelOf,
  type Grid,
  type OfflineIo,
  type StepDef,
  type ToolResponse,
  type W7Deps,
  type W7Options,
  type W7Tool,
} from "../live/w7.live.js";

const policy = loadPolicy();
const TMP = mkdtempSync(join(tmpdir(), "emcp-w7-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PID = 4242;
const TERRAIN = `${W7_ROOT}/T/W7_Terrain.ent`;
const GO = `2026-11-12 owner: OI-W7-2 go for ${TERRAIN}, steps W7.0 and W7.4 to W7.7, backup first`;

type Raw = Record<string, unknown>;

function contractActions(handler: string): string[] {
  const c = JSON.parse(readFileSync(join(REPO_ROOT, "contracts", `${handler}.json`), "utf-8")) as {
    actions: Array<{ name?: string; action?: string }>;
  };
  return c.actions.map((a) => String(a.name ?? a.action));
}

const firstIndex = (steps: StepDef[], probe: string): number =>
  steps.findIndex((s) => s.probes.includes(probe));

describe("W7 battery: the dry-run gate", () => {
  it("the action plan passes checkPlan and the queue validates", () => {
    const r = checkPlan(buildActionPlan(), policy, { script: SCRIPT_PATH });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(dryRunCheck(policy).ok).toBe(true);
    expect(() => validateQueue(buildQueue(), false)).not.toThrow();
  });

  it("the default (no --really) is a dry run that exits 0", async () => {
    const lines: string[] = [];
    const code = await main([], { out: (l) => lines.push(l), policy });
    expect(code).toBe(EXIT.done);
    expect(lines.join("\n")).toMatch(/PASS/);
  });

  it("the queue file equals the generated queue", () => {
    expect(existsSync(DEFAULT_QUEUE)).toBe(true);
    const onDisk = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8")) as unknown;
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(buildQueue())));
  });

  it("the launch carries the sandbox, the scratch profile and -scriptAuthorizeAll, no probe pack", () => {
    expect(LAUNCH_ARGS).toContain("-scriptAuthorizeAll");
    expect(LAUNCH_ARGS.join(" ")).toContain(`${SANDBOX_NAME}.gproj`);
    expect(LAUNCH_ARGS.join(" ")).toContain("w7-scratch.ini");
    expect(buildQueue().launch_packs).toEqual([]);
  });

  it("step ids are unique, w7-NN-..., the gate first and the closable step last", () => {
    const steps = buildSteps();
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^w7-\d\d-[a-z0-9-]+$/);
    expect(ids[0]).toBe(GATE_STEP);
    expect(ids[ids.length - 1]).toBe(CLOSABLE_STEP);
    for (const s of steps) {
      expect(s.expected.length, s.id).toBeGreaterThan(10);
      expect(s.kill_criterion.length, s.id).toBeGreaterThan(5);
    }
  });

  it("the hand steps are contiguous, H1 first, before only the net-zero and closable steps", () => {
    const steps = buildSteps();
    const hand = steps.map((s, i) => (s.hand ? i : -1)).filter((i) => i >= 0);
    expect(hand.length).toBe(2);
    expect(steps[hand[0]!]!.id).toBe(H1_STEP);
    expect(hand[1]).toBe(hand[0]! + 1);
    expect(steps.slice(hand[1]! + 1).map((s) => s.id)).toEqual([NETZERO_STEP, CLOSABLE_STEP]);
  });

  it("the test-bed check lives in the battery, never in a shipped handler or tool", () => {
    const src = readFileSync(join(REPO_ROOT, SCRIPT_PATH), "utf-8");
    expect(src).toContain('"aborted"');
    expect(src).toContain("projectName !== SANDBOX_NAME");
    for (const dir of ["src/tools", "mod/Scripts/WorkbenchGame/EnfusionMCP"]) {
      const walk = (d: string): string[] =>
        readdirSync(join(REPO_ROOT, d), { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
        );
      for (const f of walk(dir))
        expect(readFileSync(join(REPO_ROOT, f), "utf-8"), f).not.toContain(SANDBOX_NAME);
    }
  });
});

describe("W7 battery: coverage and order", () => {
  const steps = buildSteps();
  const exercised = new Set(steps.flatMap(exercisedBy));

  it("every action of the three W7 contracts is exercised or in NOT_EXERCISED with a reason", () => {
    const missing: string[] = [];
    for (const [handler, tool] of Object.entries(W7_CONTRACTS)) {
      const actions = contractActions(handler);
      expect(actions.length, handler).toBeGreaterThan(0);
      for (const a of actions) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
    for (const reason of Object.values(NOT_EXERCISED)) expect(reason.length).toBeGreaterThan(10);
    for (const key of Object.keys(NOT_EXERCISED)) expect(exercised.has(key), key).toBe(false);
  });

  it("every TS-only action of the wave's tools is exercised or in NOT_EXERCISED", () => {
    const missing: string[] = [];
    for (const [tool, actions] of Object.entries(TS_ONLY_ACTIONS))
      for (const a of actions) {
        const key = `${tool}.${a}`;
        if (!exercised.has(key) && !NOT_EXERCISED[key]) missing.push(key);
      }
    expect(missing).toEqual([]);
  });

  it("every probe P-W7-01..16 is assigned to a step or listed as not testable with a reason", () => {
    expect(PROBE_IDS).toHaveLength(16);
    const assigned = new Set(steps.flatMap((s) => s.probes));
    for (const id of PROBE_IDS) {
      const ok = assigned.has(id) || (NOT_TESTABLE[id] ?? "").length > 10;
      expect(ok, id).toBe(true);
    }
    for (const id of Object.keys(NOT_TESTABLE)) expect(assigned.has(id), id).toBe(false);
    for (const s of steps) for (const d of s.dependsOn ?? []) expect(PROBE_IDS).toContain(d);
  });

  it("every offline tool of spec section 4 has its engine-accept step, or a not-testable probe", () => {
    expect(Object.keys(ENGINE_ACCEPT).sort()).toEqual([
      "terrain-brush.brush-maths",
      "terrain-brush.patch-codec",
      "terrain-export.asc-writer",
      "terrain-export.k1-binary",
      "wb-shape.edit-planner",
      "wb-terrain-edit.backup-manifest",
    ]);
    for (const [tool, e] of Object.entries(ENGINE_ACCEPT)) {
      expect(e.proof.length, tool).toBeGreaterThan(20);
      if (e.step === null) {
        expect(NOT_TESTABLE[e.probe ?? ""], tool).toBeTruthy();
        continue;
      }
      const s = steps.find((x) => x.id === e.step);
      expect(s, tool).toBeDefined();
      expect(s!.risk, tool).not.toBe("read-only");
      if (e.probe) expect(s!.probes, tool).toContain(e.probe);
    }
  });

  it("every probe of the inbox file is one of P-W7-01..16", () => {
    const lines = readFileSync(join(REPO_ROOT, "docs/v2/inbox/w7/probes.jsonl"), "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    const ids = lines.map((l) => String((JSON.parse(l) as Raw).id));
    expect([...ids].sort()).toEqual([...PROBE_IDS].sort());
  });

  it("the terrain probes run in the order of spec 3.1 (03, 05, 01, 02, 04; 06, 08, 07)", () => {
    const at = (p: string): number => firstIndex(steps, p);
    const chain = ["P-W7-03", "P-W7-05", "P-W7-01", "P-W7-02", "P-W7-04"];
    for (let i = 1; i < chain.length; i++)
      expect(at(chain[i]!), chain[i]).toBeGreaterThan(at(chain[i - 1]!));
    expect(at("P-W7-08")).toBeGreaterThan(at("P-W7-06"));
    expect(at("P-W7-07")).toBeGreaterThan(at("P-W7-08"));
    expect(at("P-W7-06")).toBeGreaterThan(at("P-W7-01"));
  });

  it("the entity probes P-W7-10 to -14 run on the entity world, never on the terrain world", () => {
    for (const p of ["P-W7-10", "P-W7-11", "P-W7-12", "P-W7-13", "P-W7-14"]) {
      const s = steps[firstIndex(steps, p)]!;
      const opens = s
        .plan()
        .filter((a) => (a as Raw).toolAction === "setResource")
        .map((a) => String(((a as Raw).params as Raw).path));
      expect(opens, p).toEqual([ENTITY_WORLD]);
      expect(s.owner ?? [], p).toEqual([]);
    }
  });
});

describe("W7 battery: writes stay under _throwaway/W7/ and wait for the owner", () => {
  const steps = buildSteps();

  it("every declared write lies under _throwaway/W7/", () => {
    for (const s of steps)
      for (const w of s.writes) expect(underW7(`${w}/x`), `${s.id} ${w}`).toBe(true);
  });

  it("every file-writing confirmed call in the plan names a path under _throwaway/W7/", () => {
    for (const a of buildActionPlan() as Array<Raw & { params?: Raw }>) {
      const key = `${String(a.tool)}.${String(a.toolAction)}`;
      if (!FILE_WRITE_ACTIONS.has(key)) continue;
      const p = a.params ?? {};
      const target = (p.path ?? p.directory) as string | undefined;
      if (target === undefined || p.confirm !== true) continue;
      expect(underW7(target), `${String(a.step)} ${key} ${target}`).toBe(true);
    }
  });

  it("every step that confirms a terrain write needs both OI-W7-1 and OI-W7-2", () => {
    for (const s of steps) {
      const writes = s
        .plan()
        .some(
          (a) =>
            (a as Raw).tool === "wb_terrain_edit" &&
            TERRAIN_WRITES.has(String((a as Raw).toolAction)) &&
            ((a as Raw).params as Raw).confirm === true,
        );
      if (writes) for (const oi of TERRAIN_GO) expect(s.owner ?? [], s.id).toContain(oi);
    }
    for (const id of [
      "w7-03-terrain-setup",
      "w7-40-tile-markers",
      "w7-50-maps",
      "w7-70-restore",
      H1_STEP,
    ])
      expect(steps.find((s) => s.id === id)!.owner).toEqual(TERRAIN_GO);
  });

  it("no plan entry calls a denied API", () => {
    const denied = /RunCommandline|Workbench\.Exit|RunCmd|RunProcess/;
    for (const a of buildActionPlan()) expect(JSON.stringify(a)).not.toMatch(denied);
  });
});

describe("W7 battery: owner items and the harness guard (pure)", () => {
  it("worldRelOf strips the project id and the sandbox prefix", () => {
    expect(worldRelOf("$EMCP2_sandbox:_throwaway/W7/T/a.ent", "C:/s")).toBe(
      "_throwaway/W7/T/a.ent",
    );
    expect(worldRelOf("C:\\s\\_throwaway\\W7\\a.ent", "C:\\s")).toBe("_throwaway/W7/a.ent");
    expect(worldRelOf("worlds/Arland/EmptyArland.ent", "C:/s")).toBe(
      "worlds/Arland/EmptyArland.ent",
    );
  });

  it("the guard passes only worlds under _throwaway/W7/", () => {
    expect(throwawayRefusal("$x:_throwaway/W7/T/a.ent", "C:/s")).toBeNull();
    expect(throwawayRefusal("$x:worlds/Arland/EmptyArland.ent", "C:/s")).toMatch(/not under/);
    expect(throwawayRefusal("$x:_throwaway/W6/a.ent", "C:/s")).toMatch(/not under/);
    expect(throwawayRefusal("$x:_throwaway/W7/../../a.ent", "C:/s")).toMatch(/not under/);
    expect(throwawayRefusal("", "C:/s")).toMatch(/no world/);
  });

  it("guarded calls: confirmed terrain writes and every save; reads and dry runs are not", () => {
    expect(isGuardedCall("wb_terrain_edit", { action: "tileWrite", confirm: true })).toBe(true);
    expect(isGuardedCall("wb_terrain_edit", { action: "restore", confirm: true })).toBe(true);
    expect(isGuardedCall("wb_terrain_edit", { action: "tileWrite" })).toBe(false);
    expect(isGuardedCall("wb_terrain_edit", { action: "tileRead", confirm: true })).toBe(false);
    expect(isGuardedCall("wb_module", { action: "save" })).toBe(true);
  });

  it("the terrain world must be an .ent under _throwaway/W7/ outside the battery's worlds folder", () => {
    expect(isTerrainWorldRel(TERRAIN)).toBe(true);
    expect(isTerrainWorldRel(ENTITY_WORLD)).toBe(false);
    expect(isTerrainWorldRel("worlds/Arland/EmptyArland.ent")).toBe(false);
    expect(isTerrainWorldRel(`${W7_ROOT}/T/a.layer`)).toBe(false);
  });

  it("ownerBlock names the missing item; the go line needs OI-W7-2, go and the world", () => {
    const x = { terrainWorld: TERRAIN, worldPresent: true, logText: GO };
    expect(ownerBlock(TERRAIN_GO, x)).toBeNull();
    expect(ownerBlock(TERRAIN_GO, { ...x, terrainWorld: null })).toMatch(/^blocked:OI-W7-1/);
    expect(ownerBlock(TERRAIN_GO, { ...x, worldPresent: false })).toMatch(/^blocked:OI-W7-1/);
    expect(ownerBlock(TERRAIN_GO, { ...x, logText: null })).toMatch(/^blocked:OI-W7-2/);
    expect(ownerBlock(TERRAIN_GO, { ...x, logText: "OI-W7-2 go for another.ent" })).toMatch(
      /^blocked:OI-W7-2/,
    );
    expect(ownerBlock(["OI-W7-1"], { ...x, logText: null })).toBeNull();
    expect(ownerGoOf(GO, TERRAIN).waivesH3).toBe(false);
    expect(ownerGoOf(`${GO}; waive H3`, TERRAIN).waivesH3).toBe(true);
  });

  it("gateFlagsOf reads static const bool flags, null when absent", () => {
    const f = gateFlagsOf((h) =>
      h === "EMCP_WB_TerrainEdit"
        ? "static const bool TERRAIN_WRITE_OPEN = false;\nstatic const bool MAPS_OPEN = true;"
        : null,
    );
    expect(f.TERRAIN_WRITE_OPEN).toBe(false);
    expect(f.MAPS_OPEN).toBe(true);
    expect(f.ATTACH_OPEN).toBeNull();
  });

  it("the real handler sources hold every flag false (nothing opened before its probe)", () => {
    const f = gateFlagsOf((h) => {
      const p = join(REPO_ROOT, "mod/Scripts/WorkbenchGame/EnfusionMCP", `${h}.c`);
      return existsSync(p) ? readFileSync(p, "utf-8") : null;
    });
    for (const [k, v] of Object.entries(f)) if (v !== null) expect(v, k).toBe(false);
  });
});

describe("W7 battery: tile maths (pure)", () => {
  const g: Grid = {
    side: 8,
    tilesX: 2,
    tilesY: 2,
    resX: 15,
    resY: 15,
    unitScale: 1,
    minX: 0,
    minZ: 0,
    maxX: 14,
    maxZ: 14,
  };

  it("shared edges, sampleWorld and the four order hypotheses", () => {
    expect(sharedEdges(g)).toBe(true);
    expect(sampleWorld(g, 1, 0, 1, 6, ORDERS[0]!)).toEqual([8, 6]);
    expect(sampleWorld(g, 1, 0, 1, 6, ORDERS[2]!)).toEqual([13, 1]);
    expect(sampleWorld(g, 1, 0, 1, 6, ORDERS[1]!)).toEqual([8, 8]);
    expect(sharedEdges({ ...g, resX: 16 })).toBe(false);
  });

  it("markerCells sit one in from each corner, offsets 1..4", () => {
    expect(markerCells(8)).toEqual([
      { row: 1, col: 1, offset: 1 },
      { row: 1, col: 6, offset: 2 },
      { row: 6, col: 1, offset: 3 },
      { row: 6, col: 6, offset: 4 },
    ]);
  });

  it("orderMatches keeps only hypotheses whose four deltas are the offsets", () => {
    const m = orderMatches(
      { xMajor: [1, 2, 3, 4], zMajor: [1, 3, 2, 4], "xMajor+flipZ": [null, 0, 0, 0] },
      [1, 2, 3, 4],
    );
    expect(m).toEqual(["xMajor"]);
    expect(orderKey(ORDERS[3]!)).toBe("zMajor+flipZ");
  });

  it("parseTileRows reads 'r|v v v' rows", () => {
    const m = parseTileRows(["0|1 2 3", "1| 4.5 5 6 ", "junk"]);
    expect(m.get(0)).toEqual([1, 2, 3]);
    expect(m.get(1)).toEqual([4.5, 5, 6]);
    expect(m.size).toBe(2);
  });

  it("estimateMisses holds the samples exactly and the deltas to 1 mm", () => {
    const seen = observedStats([1, 2, 3, 4]);
    expect(seen).toMatchObject({ samples: 4, minDelta: 1, maxDelta: 4, meanDelta: 2.5 });
    const est = { tiles: 1, samples: 4, minDelta: 1.0005, maxDelta: 4, meanDelta: 2.5 };
    expect(estimateMisses(est, seen)).toEqual([]);
    expect(estimateMisses({ ...est, minDelta: 1.01 }, seen)).toHaveLength(1);
    expect(estimateMisses({ ...est, samples: 5 }, seen)).toHaveLength(1);
  });
});

// ── A fake Workbench with a terrain ─────────────────────────────────────────

interface FakeTerrain {
  heights: number[][];
  history: number[][][];
  worldPath: string;
  gated: boolean;
}

/** Side 8, 2 x 2 tiles with shared edges, 1 m per sample; tile arrays x-major, z not flipped. */
function terrainTool(t: FakeTerrain, name: W7Tool, args: Raw): ToolResponse {
  const a = String(args.action);
  const side = 8;
  const cell = (tx: number, ty: number, r: number, c: number): [number, number] => [
    tx * (side - 1) + r,
    ty * (side - 1) + c,
  ];
  if (name === "wb_world" && a === "state")
    return { ok: true, readback: { worldPath: t.worldPath, mode: "edit" } };
  if (name === "wb_module") return { ok: true, readback: {} };
  if (name === "wb_terrain" && a === "info")
    return {
      ok: true,
      readback: {
        // The tool's reshaped answer (wb-terrain.ts infoReadback), not the handler's flat keys.
        hasTerrain: true,
        resolution: { x: 15, y: 15 },
        tiles: { x: 2, y: 2 },
        unitScale: 1,
        bounds: { min: "0 0 0", max: "14 0 14", sizeX: 14, sizeZ: 14 },
        surfaces: [],
      },
    };
  if (name === "wb_terrain" && a === "heights") {
    // The tool's reshaped answer (wb-terrain.ts shapeOk heights): points, not the handler's rows.
    const points = (args.points as string[]).map((p) => {
      const [x, z] = p.split(" ").map(Number) as [number, number];
      const gx = Math.round(x);
      const gz = Math.round(z);
      const on = gx >= 0 && gz >= 0 && gx < 15 && gz < 15;
      return { x, z, onTerrain: on, y: on ? t.heights[gx]![gz]! : null };
    });
    return {
      ok: true,
      readback: { points, onTerrain: points.filter((p) => p.onTerrain).length },
    };
  }
  if (name === "wb_terrain" && a === "tile") {
    // The tool's reshaped answer (wb-terrain.ts shapeOk tile): samples, row-major, one page.
    const tx = Number(args.tileX);
    const ty = Number(args.tileY);
    const samples: number[] = [];
    for (let r = 0; r < side; r++)
      for (let c = 0; c < side; c++) {
        const [gx, gz] = cell(tx, ty, r, c);
        samples.push(t.heights[gx]![gz]!);
      }
    return {
      ok: true,
      readback: {
        tile: { x: tx, y: ty },
        sampleCount: side * side,
        total: side * side,
        first: 0,
        samples,
        nextCursor: null,
      },
    };
  }
  if (name === "wb_terrain_edit" && a === "tileRead") {
    const tx = Number(args.tileX);
    const ty = Number(args.tileY);
    const rows: string[] = [];
    for (let r = 0; r < side; r++) {
      const v: number[] = [];
      for (let c = 0; c < side; c++) {
        const [gx, gz] = cell(tx, ty, r, c);
        v.push(t.heights[gx]![gz]!);
      }
      rows.push(`${r}|${v.join(" ")}`);
    }
    return {
      ok: true,
      readback: { side, layout: "sharedEdge", total: side, rows, nextCursor: "" },
    };
  }
  if (name === "wb_terrain_edit" && a === "backup")
    return { ok: true, readback: { backupId: "b1", files: [] } };
  if (name === "wb_terrain_edit" && a === "tileWrite") {
    const patches = (args.patches as string[]).map((p) => {
      const [head, vals] = p.split("|") as [string, string];
      const [tx, ty, r, c] = head.split(" ").map(Number) as [number, number, number, number];
      return { tx, ty, r, c, v: vals.split(" ").map(Number) };
    });
    if (args.confirm !== true)
      return { ok: true, readback: { dryRun: true, tiles: 1, samples: patches.length } };
    if (t.gated) return { ok: false, code: "GATED", message: "TERRAIN_WRITE_OPEN is false" };
    t.history.push(t.heights.map((col) => [...col]));
    for (const p of patches)
      p.v.forEach((v, k) => {
        const [gx, gz] = cell(p.tx, p.ty, p.r, p.c + k);
        t.heights[gx]![gz] = v;
      });
    return { ok: true, readback: { undoName: "W7 tileWrite", dryRun: false } };
  }
  return { ok: true, readback: {} };
}

function newTerrain(over: Partial<FakeTerrain> = {}): FakeTerrain {
  const heights = Array.from({ length: 15 }, (_, x) =>
    Array.from({ length: 15 }, (_, z) => 10 + x * 0.25 + z * 0.5),
  );
  return { heights, history: [], worldPath: `$${SANDBOX_NAME}:${TERRAIN}`, gated: false, ...over };
}

function fakeDeps(over: {
  info?: Raw | null;
  tool?: (name: W7Tool, args: Raw) => ToolResponse;
  terrain?: FakeTerrain;
  files?: Map<string, Buffer>;
}): W7Deps & { files: Map<string, Buffer>; sent: Array<[string, Raw]> } {
  const files = over.files ?? new Map<string, Buffer>();
  const sent: Array<[string, Raw]> = [];
  const norm = (p: string): string => p.replace(/\\/g, "/");
  return {
    files,
    sent,
    tool: async (name, args) => {
      sent.push([name, args]);
      if (over.tool) return over.tool(name, args);
      if (over.terrain) return terrainTool(over.terrain, name, args);
      return { ok: true, readback: {} };
    },
    undo: async () => {
      const t = over.terrain;
      if (t) {
        const prev = t.history.pop();
        if (prev) t.heights = prev;
      }
      return { ok: true, message: "Undo executed" };
    },
    info: async () =>
      over.info === undefined ? { projectFound: 1, projectName: SANDBOX_NAME } : over.info,
    ping: async () => ({ buildStamp: "abc" }),
    bundleDigest: () => "abc",
    windows: async (): Promise<WindowInfo[]> => [],
    recordedPid: () => PID,
    handlerSource: () => "static const bool TERRAIN_WRITE_OPEN = false;",
    readBytes: (p) => {
      const b = files.get(norm(p));
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    writeBytes: (p, b) => {
      files.set(norm(p), b);
    },
    exists: (p) => files.has(norm(p)),
    listTree: (dir) => {
      const d = norm(dir).replace(/\/$/, "") + "/";
      return [...files.keys()].filter((k) => k.startsWith(d)).map((k) => k.slice(d.length));
    },
    now: () => Date.now(),
    sleep: async () => undefined,
    log: () => undefined,
  };
}

function opts(name: string, extra: Partial<W7Options> = {}): W7Options {
  const sitting = join(TMP, name);
  const runDir = join(sitting, "run-1");
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    sittingDir: sitting,
    sandboxDir: join(TMP, name, SANDBOX_NAME),
    evidenceDir: null,
    ph: { v2: REPO_ROOT } as W7Options["ph"],
    build: "test",
    terrainWorld: null,
    sessionLog: null,
    ...extra,
  };
}

const key = (p: string): string => p.replace(/\\/g, "/");

/** The owner's items present: the terrain world on disk, the go in the log, the sitting backup. */
function withOwner(o: W7Options, deps: { files: Map<string, Buffer> }, goLine = GO): W7Options {
  const log = join(o.sittingDir, "session.md");
  deps.files.set(key(join(o.sandboxDir, ...TERRAIN.split("/"))), Buffer.from("world"));
  deps.files.set(key(log), Buffer.from(`# log\n${goLine}\n`));
  deps.files.set(
    key(join(o.sittingDir, BACKUP_FILE)),
    Buffer.from(
      JSON.stringify({
        backupId: "20261112T080000000Z-w7-sitting",
        world: TERRAIN,
        takenAt: "",
        manifest: {},
        files: [],
      }),
    ),
  );
  return { ...o, terrainWorld: TERRAIN, sessionLog: log };
}

function only(id: string): StepDef[] {
  const s = selectSteps(buildSteps(), { only: id });
  if (typeof s === "string") throw new Error(s);
  return s;
}

function win(over: Partial<WindowInfo>): WindowInfo {
  return {
    hwnd: 1,
    pid: PID,
    className: "Qt683QWindowIcon",
    title: "Enfusion Workbench",
    owner: 0,
    enabled: true,
    rect: [0, 0, 10, 10],
    monitor: [0, 0, 10, 10],
    primary: true,
    ...over,
  };
}

/** A one-call step that sends a confirmed tileWrite (the guard's subject). */
const writeStep: StepDef = {
  ...only("w7-40-tile-markers")[0]!,
  id: "w7-49-guard-probe",
  owner: [],
  run: async (ctx) => {
    const r = await ctx.tool("wb_terrain_edit", {
      action: "tileWrite",
      patches: ["0 0 1 1|1.0000"],
      confirm: true,
    });
    return { status: r.ok ? "PASS" : "FAIL", detail: "sent", evidence: {} };
  },
};

describe("W7 battery: the harness guard and the owner items in the runner", () => {
  it("a confirmed terrain write on a vanilla world is refused before it is sent: the battery stops", async () => {
    const o = opts("guard-vanilla");
    const t = newTerrain({ worldPath: "$ArmaReforger:worlds/Arland/EmptyArland.ent" });
    const deps = fakeDeps({ terrain: t });
    const r = await runBattery([writeStep], deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.status).toBe("STOPPED");
    expect(r.records[0]!.detail).toMatch(/harness guard/);
    expect(deps.sent.some(([n, a]) => n === "wb_terrain_edit" && a.action === "tileWrite")).toBe(
      false,
    );
    expect(t.history).toHaveLength(0);
  });

  it("the same write on a world under _throwaway/W7/ is sent", async () => {
    const o = opts("guard-throwaway");
    const t = newTerrain();
    const deps = fakeDeps({ terrain: t });
    const r = await runBattery([writeStep], deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).toBe("PASS");
    expect(deps.sent.some(([n, a]) => n === "wb_terrain_edit" && a.action === "tileWrite")).toBe(
      true,
    );
  });

  it("a terrain step without the terrain world records blocked:OI-W7-1 and sends nothing", async () => {
    const o = opts("blocked-1");
    const deps = fakeDeps({ terrain: newTerrain() });
    const r = await runBattery(only("w7-40-tile-markers"), deps, o);
    expect(r.records[0]!.status).toBe("BLOCKED");
    expect(r.records[0]!.detail).toMatch(/^blocked:OI-W7-1/);
    expect(deps.sent).toEqual([]);
    expect(r.exit).toBe(EXIT.done);
  });

  it("a terrain step without the go in the session log records blocked:OI-W7-2", async () => {
    const o0 = opts("blocked-2");
    const deps = fakeDeps({ terrain: newTerrain() });
    const o = withOwner(o0, deps, "owner: looks fine");
    const r = await runBattery(only("w7-50-maps"), deps, o);
    expect(r.records[0]!.status).toBe("BLOCKED");
    expect(r.records[0]!.detail).toMatch(/^blocked:OI-W7-2/);
    expect(deps.sent).toEqual([]);
    const result = JSON.parse(
      deps.files.get(key(join(o.sittingDir, "w7-result.json")))!.toString(),
    ) as {
      probes: Record<string, { result: string }>;
    };
    expect(result.probes["P-W7-07"]!.result).toBe("blocked:OI-W7-2");
    expect(result.probes["P-W7-09"]!.result).toBe("NOT-TESTABLE");
  });

  it("w7-40 settles P-W7-01 with the order x-major and the samples restored by one undo", async () => {
    const o0 = opts("markers");
    const t = newTerrain();
    const deps = fakeDeps({ terrain: t });
    const before = JSON.stringify(t.heights);
    const o = withOwner(o0, deps);
    const r = (await runBattery(only("w7-40-tile-markers"), deps, o)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
    const p = r.probes.find((x) => x.id === "P-W7-01")!;
    expect(p.result, p.note).toBe("SETTLED");
    expect((p.observed as Raw).matches).toEqual(["xMajor"]);
    expect(JSON.stringify(t.heights)).toBe(before);
    expect(deps.sent.some(([n, a]) => n === "wb_terrain_edit" && a.action === "backup")).toBe(true);
  });

  it("w7-40 while TERRAIN_WRITE_OPEN is false: P-W7-01 PARTIAL and the tile unchanged", async () => {
    const o0 = opts("markers-gated");
    const t = newTerrain({ gated: true });
    const deps = fakeDeps({ terrain: t });
    const before = JSON.stringify(t.heights);
    const o = withOwner(o0, deps);
    const r = (await runBattery(only("w7-40-tile-markers"), deps, o)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
    expect(r.probes[0]!.result).toBe("PARTIAL");
    expect(r.probes[0]!.note).toMatch(/GATED/);
    expect(JSON.stringify(t.heights)).toBe(before);
  });

  it("H3 is NOT-RUN when the go waives it, and no hand request is written", async () => {
    const o0 = opts("h3-waived");
    const deps = fakeDeps({ terrain: newTerrain() });
    const o = withOwner(o0, deps, `${GO}; waive H3`);
    const r = (await runBattery(only("w7-90-h3-look"), deps, o)).records[0]!;
    expect(r.status).toBe("NOT-RUN");
    expect(r.detail).toMatch(/waived/);
    expect([...deps.files.keys()].some((k) => k.includes("hand"))).toBe(false);
  });

  it("H1 is NOT-RUN unless P-W7-01 was KILLED and a K2 .asc was recorded", async () => {
    const o0 = opts("h1");
    const deps = fakeDeps({ terrain: newTerrain() });
    const o = withOwner(o0, deps);
    const r = (await runBattery(only(H1_STEP), deps, o)).records[0]!;
    expect(r.status).toBe("NOT-RUN");
    expect(r.detail).toMatch(/K2 only/);
  });
});

describe("W7 battery: runner stop rules", () => {
  function planted(name: string): W7Options {
    return opts(name);
  }
  function plant(o: W7Options, deps: { files: Map<string, Buffer> }): void {
    deps.files.set(key(join(o.sittingDir, PLANT_FILE)), Buffer.from("{}"));
  }

  it("refuses to start unless the open project is the test bed", async () => {
    const o = planted("notbed");
    const deps = fakeDeps({ info: { projectFound: 1, projectName: "SomeOtherMod" } });
    plant(o, deps);
    const r = await runBattery(buildSteps().slice(0, 1), deps, o);
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.records[0]!.status).toBe("ABORTED");
    expect(deps.sent).toEqual([]);
  });

  it("the gate stops without the plant record and passes with it, naming the owner items", async () => {
    const o = planted("gate");
    const deps = fakeDeps({});
    expect((await runBattery(buildSteps().slice(0, 1), deps, o)).exit).toBe(EXIT.stopped);
    plant(o, deps);
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    const r = (await runBattery(buildSteps().slice(0, 1), deps, o2)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
    expect(String((r.evidence.owner as Raw)["OI-W7-1"])).toMatch(/^blocked:OI-W7-1/);
    expect(deps.exists(join(o.sittingDir, BATTERY_SNAPSHOT_FILE))).toBe(true);
  });

  it("a LOST client code stops the battery and is not retried", async () => {
    const o = planted("lost");
    const deps = fakeDeps({
      tool: () => ({ ok: false, code: "LOST", message: "connection lost" }),
    });
    const r = await runBattery(only("w7-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0]!.status).toBe("STOPPED");
    expect(deps.sent).toHaveLength(1);
  });

  it("MODAL_OPEN is a HANDOFF (H2) and the closable step is not run over it", async () => {
    const o = planted("modal");
    const deps = fakeDeps({ tool: () => ({ ok: false, code: "MODAL_OPEN", message: "a modal" }) });
    const r = await runBattery(only("w7-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records.map((x) => x.status)).toEqual(["HANDOFF"]);
  });

  it("a dialog-like window already up is a HANDOFF that never answers Save", async () => {
    const o = planted("dialogup");
    const deps = fakeDeps({});
    deps.windows = async () => [win({ hwnd: 9, className: "#32770", title: "Loading world" })];
    const r = await runBattery(only("w7-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.message).toContain("Loading world");
    expect(r.message).not.toMatch(/press Save/);
    expect(deps.sent).toEqual([]);
    const h = handAnswer('a dialog "Loading world" is up', "w7-01-handlers");
    expect(h.answer).toBe("No");
  });

  it("three consecutive FAILs in one block stop the battery, and the closable step still runs", async () => {
    const o = planted("threefails");
    const deps = fakeDeps({});
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = ["w7-10-vanilla-reads", "w7-11-throwaway-reads", "w7-12-entity-reads"];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => ({ ...s, owner: [], run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual([...ids, CLOSABLE_STEP]);
  });

  it("FAILs in the independent blocks never add up", async () => {
    const o = planted("unitfails");
    const deps = fakeDeps({});
    const fail = async () => ({ status: "FAIL" as const, detail: "x", evidence: {} });
    const ids = [
      "w7-30-shape-edit",
      "w7-31-generator-attach",
      "w7-32-generator-regenerate",
      "w7-33-point-data",
    ];
    const steps = buildSteps()
      .filter((s) => ids.includes(s.id))
      .map((s) => ({ ...s, run: fail }));
    const r = await runBattery(steps, deps, o);
    expect(r.message ?? "").not.toMatch(/three consecutive/);
    expect(r.records.map((x) => x.step)).toEqual(ids);
  });

  it("a step that depends on a killed probe is SKIPPED with the reason", async () => {
    const o0 = planted("skip");
    const deps = fakeDeps({ terrain: newTerrain() });
    const o = withOwner(o0, deps);
    const kill = {
      step: "w7-40-tile-markers",
      probes: [{ id: "P-W7-01", result: "KILLED", observed: {}, note: "undo did not restore" }],
    };
    deps.files.set(
      key(join(o.runDir, "w7-40-tile-markers.json")),
      Buffer.from(JSON.stringify(kill)),
    );
    const r = await runBattery(only("w7-41-seams"), deps, o);
    expect(r.records[0]!.status).toBe("SKIPPED");
    expect(r.records[0]!.detail).toContain("P-W7-01");
    expect(deps.sent).toEqual([]);
  });

  it("a step is never run twice in one run folder", async () => {
    const o = planted("twice");
    const deps = fakeDeps({});
    deps.files.set(key(join(o.runDir, "w7-01-handlers.json")), Buffer.from("{}"));
    const r = await runBattery(only("w7-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.refused);
  });

  it("--skip-hand records the hand steps HELD and sends nothing", async () => {
    const o0 = planted("skiphand");
    const deps = fakeDeps({ terrain: newTerrain() });
    const o = { ...withOwner(o0, deps), skipHand: true };
    const r = await runBattery(only(H1_STEP), deps, o);
    expect(r.records[0]!.status).toBe("HELD");
    expect(deps.sent).toEqual([]);
  });
});

describe("W7 battery: net-zero", () => {
  function realFsDeps(): W7Deps {
    const base = fakeDeps({});
    const walk = (dir: string, rel = ""): string[] =>
      readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
        const r = rel ? `${rel}/${e.name}` : e.name;
        return e.isDirectory() ? walk(dir, r) : [r];
      });
    return {
      ...base,
      readBytes: (p) => readFileSync(p),
      writeBytes: (p, b) => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, b);
      },
      exists: (p) => existsSync(p),
      listTree: (dir) => (existsSync(dir) ? walk(dir) : []),
    };
  }
  function put(root: string, rel: string, data: string | Buffer): void {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  }
  function sandbox(name: string): W7Options {
    const o = opts(name);
    put(o.sandboxDir, `${SANDBOX_NAME}.gproj`, "GameProject {}\n");
    put(o.sandboxDir, "Scripts/a.c", "class A {}\n");
    put(o.sittingDir, PLANT_FILE, "{}\n");
    return o;
  }

  it("changes under _throwaway/W7/ are no change; resourceDatabase.rdb is recorded, not failed", async () => {
    const o = sandbox("nz-ok");
    const deps = realFsDeps();
    expect((await runBattery(only(GATE_STEP), deps, o)).records[0]!.status).toBe("PASS");
    put(o.sandboxDir, `${WORLDS_DIR}/EMCP_W7_Entities.ent`, "new\n");
    put(o.sandboxDir, `${MASKS_DIR}/m.png`, "png\n");
    put(o.sandboxDir, "resourceDatabase.rdb", "db\n");
    expect(netZeroDiff(o.sittingDir, o.sandboxDir, deps)?.changed).toEqual([
      "resourceDatabase.rdb",
    ]);
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only(NETZERO_STEP), deps, o2)).records[0]!;
    expect(r.status, r.detail).toBe("PASS");
  });

  it("a real change outside _throwaway/W7/ fails, and so does a terrain file off its manifest", async () => {
    const o = sandbox("nz-bad");
    const deps = realFsDeps();
    await runBattery(only(GATE_STEP), deps, o);
    put(o.sandboxDir, "Scripts/a.c", "changed\n");
    const o2 = { ...o, runDir: join(o.sittingDir, "run-2") };
    mkdirSync(o2.runDir, { recursive: true });
    const r = (await runBattery(only(NETZERO_STEP), deps, o2)).records[0]!;
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Scripts/a.c");

    const o3 = sandbox("nz-manifest");
    await runBattery(only(GATE_STEP), deps, o3);
    const hm = join(o3.sandboxDir, W7_ROOT, "T", "height.bin");
    put(o3.sandboxDir, `${W7_ROOT}/T/height.bin`, "after\n");
    put(
      o3.sittingDir,
      BACKUP_FILE,
      JSON.stringify({
        backupId: "b",
        world: TERRAIN,
        takenAt: "",
        manifest: { [hm]: "0".repeat(64) },
        files: [],
      }),
    );
    const o4 = { ...o3, runDir: join(o3.sittingDir, "run-2") };
    mkdirSync(o4.runDir, { recursive: true });
    const r2 = (await runBattery(only(NETZERO_STEP), deps, o4)).records[0]!;
    expect(r2.status).toBe("FAIL");
    expect(r2.detail).toMatch(/manifest/);
  });
});

describe("W7 battery: plant and rollback", () => {
  function memIo(
    running: number[] = [],
  ): OfflineIo & { files: Map<string, Buffer>; dirs: Set<string> } {
    const files = new Map<string, Buffer>();
    const dirs = new Set<string>();
    const n = (p: string): string => p.replace(/\\/g, "/");
    return {
      files,
      dirs,
      workbenchPids: () => running,
      exists: (p) =>
        files.has(n(p)) ||
        dirs.has(n(p)) ||
        [...files.keys()].some((k) => k.startsWith(n(p) + "/")),
      listDir: (p) => [...files.keys()].filter((k) => k.startsWith(n(p) + "/")),
      listTree: (p) =>
        [...files.keys()]
          .filter((k) => k.startsWith(n(p) + "/"))
          .map((k) => k.slice(n(p).length + 1)),
      readBytes: (p) => {
        const b = files.get(n(p));
        if (!b) throw new Error(`ENOENT ${p}`);
        return b;
      },
      writeBytes: (p, b) => void files.set(n(p), b),
      makeDir: (p) => void dirs.add(n(p)),
      removeTree: (p) => {
        for (const k of [...files.keys()])
          if (k === n(p) || k.startsWith(n(p) + "/")) files.delete(k);
        for (const d of [...dirs]) if (d === n(p) || d.startsWith(n(p) + "/")) dirs.delete(d);
      },
      log: () => undefined,
    };
  }
  const SB = `C:/x/${SANDBOX_NAME}`;
  const SIT = "C:/x/sitting";

  it("a dry run writes nothing", async () => {
    const io = memIo();
    expect(await runPlant(SB, SIT, false, io)).toBe(EXIT.done);
    expect(io.files.size).toBe(0);
  });

  it("plants the worlds folder and the record; refuses while Workbench runs or when planted", async () => {
    const io = memIo();
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.done);
    expect(io.dirs.has(`${SB}/${WORLDS_DIR}`)).toBe(true);
    expect(io.files.has(`${SIT}/${PLANT_FILE}`)).toBe(true);
    expect([...io.files.keys()].filter((k) => k.startsWith(`${SB}/`))).toEqual([]);
    io.files.set(`${SB}/${WORLDS_DIR}/x.ent`, Buffer.from("w"));
    expect(await runPlant(SB, SIT, true, io)).toBe(EXIT.refused);
    expect(await runPlant(SB, SIT, true, memIo([7]))).toBe(EXIT.refused);
  });

  it("rollback removes the battery's worlds and masks, never the owner's terrain world", async () => {
    const io = memIo();
    io.files.set(`${SB}/${SANDBOX_NAME}.gproj`, Buffer.from("GameProject {}"));
    await runPlant(SB, SIT, true, io);
    io.files.set(`${SB}/${ENTITY_WORLD}`, Buffer.from("w"));
    io.files.set(`${SB}/${MASKS_DIR}/m.png`, Buffer.from("m"));
    io.files.set(`${SB}/${TERRAIN}`, Buffer.from("terrain"));
    expect(runRollback(SB, SIT, true, io)).toBe(EXIT.done);
    expect(io.files.has(`${SB}/${ENTITY_WORLD}`)).toBe(false);
    expect(io.files.has(`${SB}/${MASKS_DIR}/m.png`)).toBe(false);
    expect(io.files.has(`${SB}/${TERRAIN}`)).toBe(true);
    expect(io.files.has(`${SIT}/throwaway-w7-listing.json`)).toBe(true);
  });

  it("plant refuses a sandbox that is not the test bed", async () => {
    const code = await main(["plant", "--sandbox", "C:/x/OtherMod", "--sitting-dir", SIT], {
      out: () => undefined,
      offlineIo: memIo(),
    });
    expect(code).toBe(EXIT.usage);
  });

  it("--really refuses a terrain world outside _throwaway/W7/ before anything runs", async () => {
    const lines: string[] = [];
    const code = await main(
      [
        "--really",
        "--id",
        "lane",
        "--sandbox",
        SB,
        "--sitting-dir",
        SIT,
        "--terrain-world",
        "worlds/Arland/EmptyArland.ent",
      ],
      { out: (l) => lines.push(l), policy, leaseHeld: true, platform: "win32" },
    );
    expect(code).toBe(EXIT.usage);
    expect(lines.join("\n")).toMatch(/_throwaway\/W7/);
  });
});

// ── Every call the battery sends passes the shipped tool's own request check ──

/** The shipped tools' request checks (nothing is sent; INVALID_ARGUMENT is the battery's bug). */
function shippedCheck(name: W7Tool, args: Raw): string | null {
  const err = (r: { ok: boolean; error?: { code: string; message: string } }): string | null =>
    r.ok || !r.error || r.error.code !== "INVALID_ARGUMENT" ? null : r.error.message;
  switch (name) {
    case "wb_terrain_edit":
      return err(prepareTerrainEdit(args));
    case "wb_generator":
      return err(prepareGenerator(args));
    case "wb_shape":
      return err(prepareShape(args, { editOpen: true, parallelOpen: true }));
    case "wb_terrain":
      return err(prepareTerrain(args));
    case "wb_entity":
      return err(prepareEntity(args));
    case "wb_world": {
      const r = WORLD_REQUEST_SCHEMA.safeParse(args);
      return r.success ? null : r.error.issues.map((i) => i.message).join("; ");
    }
    default:
      return null;
  }
}

/** A fake Workbench that answers ids, shapes and generators so the entity steps run through. */
function entityTool(t: FakeTerrain): (name: W7Tool, args: Raw) => ToolResponse {
  let n = 0;
  let total = 3;
  return (name, args) => {
    const a = String(args.action);
    if (name === "wb_entity" && a === "create") {
      total++;
      return { ok: true, readback: { id: `id:${++n}` } };
    }
    if (name === "wb_entity" && a === "list") return { ok: true, readback: { total, rows: [] } };
    if (name === "wb_shape" && a === "create") {
      total++;
      return { ok: true, readback: { id: `id:${++n}`, total: 4 } };
    }
    if (name === "wb_shape" && a === "points")
      return {
        ok: true,
        readback: {
          id: args.entity,
          closed: 1,
          total: 4,
          points: ["0 0 0", "10 0 0", "10 0 10", "0 0 10"],
          tangents: [],
          nextCursor: "",
        },
      };
    if (name === "wb_shape" && a === "edit")
      return { ok: true, readback: { id: args.entity, total: 4, undoName: "W7 edit" } };
    if (name === "wb_generator" && a === "list")
      return { ok: true, readback: { rows: [], eventsEnabled: 1, total: 0, nextCursor: "" } };
    if (name === "wb_generator" && a === "attach")
      return { ok: true, readback: { id: `id:${++n}`, className: "ForestGeneratorEntity" } };
    if (name === "wb_generator" && a === "events")
      return { ok: true, readback: { eventsEnabled: args.enabled ? 1 : 0, was: 1 } };
    if (name === "wb_module" && a === "setResource") {
      t.worldPath = `$${SANDBOX_NAME}:${String(args.target).replace(/^path:/, "")}`;
      return { ok: true, readback: {} };
    }
    return terrainTool(t, name, args);
  };
}

const ALL_GATES_CLOSED = [
  "TERRAIN_WRITE_OPEN",
  "FLATTER_OPEN",
  "MAPS_OPEN",
  "MASKS_OPEN",
  "ATTACH_OPEN",
  "REGENERATE_OPEN",
  "POINTDATA_OPEN",
  "EVENTS_OPEN",
  "EDIT_OPEN",
  "PARALLEL_OPEN",
]
  .map((f) => `static const bool ${f} = false;`)
  .join(" ");

describe("W7 battery: the shipped wb_terrain_edit's backup form", () => {
  it("backupFilesOf reads the manifest.json the answer names (files is a count)", () => {
    const sb = join(TMP, "bf", SANDBOX_NAME);
    const mf = join(TMP, "bf", "artifacts", "manifest.json");
    const files = new Map<string, Buffer>([
      [
        key(mf),
        Buffer.from(
          JSON.stringify({
            version: 1,
            files: [{ rel: `${W7_ROOT}/T/W7_Terrain.ent`, size: 5, sha256: "aa" }],
          }),
        ),
      ],
    ]);
    const io = {
      exists: (p: string) => files.has(key(p)),
      readBytes: (p: string) => files.get(key(p))!,
    };
    const got = backupFilesOf({ backupId: "x", files: 1, manifest: mf }, sb, io);
    expect(got.paths.map(key)).toEqual([key(join(sb, W7_ROOT, "T", "W7_Terrain.ent"))]);
    expect(Object.values(got.toolHashes)).toEqual(["aa"]);
    expect(backupFilesOf({ files: 1, manifest: join(TMP, "nope.json") }, sb, io).paths).toEqual([]);
  });

  it("the tool runs with the sandbox as project and its backups outside the sandbox", () => {
    const sb = join(TMP, "opts", SANDBOX_NAME);
    const o = terrainEditOptions(sb, new TerrainBackupRecord());
    expect(o.projectPath).toBe(sb);
    expect(key(o.artifactsDir!).startsWith(key(sb))).toBe(false);
    expect(o.session).toBeInstanceOf(TerrainBackupRecord);
    expect(o.policy).toBeUndefined();
  });
});

describe("W7 battery: the calls match the shipped tools", () => {
  it("no call of any step is refused INVALID_ARGUMENT by the tool's own request check", async () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    let checked = 0;
    // Each step twice: with the open flags of the fake (its probe paths) and with every gate
    // closed (the GATED refusals of w7-24 and w7-25).
    const runs = buildSteps().flatMap((step) => [
      { step, source: null as string | null },
      { step, source: ALL_GATES_CLOSED },
    ]);
    for (const [i, { step, source }] of runs.entries()) {
      const o0 = opts(`conform-${i}-${step.id}`);
      const t = newTerrain();
      const deps = fakeDeps({ terrain: t, tool: entityTool(t) });
      if (source !== null) deps.handlerSource = () => source;
      // A virtual clock: every poll loop (open, state, windows) ends at its timeout at once.
      let clock = 0;
      deps.now = () => clock;
      deps.sleep = async (ms) => void (clock += ms);
      const o = { ...withOwner(o0, deps), skipHand: true };
      deps.files.set(key(join(o.sittingDir, PLANT_FILE)), Buffer.from("{}"));
      deps.files.set(key(join(o.sandboxDir, ...ENTITY_WORLD.split("/"))), Buffer.from("world"));
      await runBattery([step], deps, o);
      for (const [name, args] of deps.sent) {
        const m = shippedCheck(name as W7Tool, args);
        checked++;
        seen.add(`${name}.${String(args.action)}`);
        if (m) bad.push(`${step.id} ${name}.${String(args.action)}: ${m}`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(bad).toEqual([]);
    // The check reached every action of the wave but the NOT_EXERCISED ones.
    const reached = Object.entries(W7_CONTRACTS).flatMap(([h, tool]) =>
      contractActions(h).map((a) => `${tool}.${a}`),
    );
    const unreached = reached.filter((a) => !seen.has(a) && !(a in NOT_EXERCISED));
    expect(unreached).toEqual([]);
  });
});

describe("W7 fix-up 1: the play-mode transition and the tile layout", () => {
  const MAIN = [
    win({ hwnd: 1, title: "Enfusion Workbench - EMCP2 sandbox (2.0 live lane)" }),
    win({
      hwnd: 2,
      title: "World Editor - EMCP2_sandbox/_throwaway/W7/worlds/EMCP_W7_Entities.ent",
    }),
  ];
  /** Run 1's w7-22 change: both main windows disabled, the tool window added disabled. */
  const PLAY = [
    ...MAIN.map((w) => ({ ...w, enabled: false })),
    win({
      hwnd: 3,
      className: "Qt683QWindowToolSaveBits",
      title: "Arma Reforger Workbench",
      enabled: false,
    }),
  ];
  /** The windows: MAIN, then `busy` reads of PLAY from the first tool call on. */
  function playWindows(
    deps: { windows: () => Promise<WindowInfo[]>; tool: unknown },
    busy: number,
  ) {
    let left = -1;
    const tool = deps.tool as (n: W7Tool, a: Raw) => Promise<ToolResponse>;
    deps.tool = async (n: W7Tool, a: Raw) => {
      if (left < 0) left = busy;
      return tool(n, a);
    };
    deps.windows = async () => {
      if (left > 0) {
        left--;
        return PLAY;
      }
      return MAIN;
    };
  }

  it("every polled step watches with the W5 busy-window grace", () => {
    expect(WATCH_OPTIONS).toEqual({ popups: false, busyGraceMs: BUSY_GRACE_MS });
    expect(BUSY_GRACE_MS).toBe(60_000);
  });

  it("run 1's play transition that clears inside the grace is waited out, not a handoff", async () => {
    const o = opts("play-busy-clears");
    const deps = fakeDeps({});
    playWindows(deps, 5);
    const r = await runBattery(only("w7-01-handlers"), deps, o);
    expect(r.records[0]!.status, r.records[0]!.detail).not.toBe("HANDOFF");
    expect(r.exit).not.toBe(EXIT.handoff);
  });

  it("the same windows past the grace are a handoff that says so", async () => {
    const o = opts("play-busy-stays");
    const deps = fakeDeps({});
    playWindows(deps, Number.MAX_SAFE_INTEGER);
    const r = await runBattery(only("w7-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.status).toBe("HANDOFF");
    expect(r.records[0]!.detail).toMatch(/past the 60000 ms grace/);
  });

  it("an owned window beside the play transition is a handoff at once", async () => {
    const o = opts("play-busy-owned");
    const deps = fakeDeps({});
    let calls = 0;
    deps.windows = async () => {
      calls++;
      return calls === 1 ? MAIN : [...PLAY, win({ hwnd: 4, title: "Save changes?", owner: 2 })];
    };
    const r = await runBattery(only("w7-01-handlers"), deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records[0]!.detail).toMatch(/Save changes\?/);
    expect(r.records[0]!.detail).not.toMatch(/grace/);
  });

  it("layoutMismatch: EmptyArland (2049 in 16, side 129) is sharedEdge; disjoint and single too", () => {
    const g = {
      side: 129,
      tilesX: 16,
      tilesY: 16,
      resX: 2049,
      resY: 2049,
      unitScale: 2,
      minX: 0,
      minZ: 0,
      maxX: 4096,
      maxZ: 4096,
    };
    expect(layoutMismatch(g, "sharedEdge")).toBe("");
    expect(layoutMismatch(g, "disjoint")).toMatch(/sharedEdge expected/);
    expect(layoutMismatch(g, "")).toMatch(/sharedEdge expected/);
    expect(layoutMismatch({ ...g, side: 128, resX: 2048, resY: 2048 }, "disjoint")).toBe("");
    expect(layoutMismatch({ ...g, tilesX: 1, tilesY: 1, resX: 129, resY: 129 }, "single")).toBe("");
    expect(layoutMismatch({ ...g, side: 100 }, "sharedEdge")).toMatch(/fits neither/);
  });

  it("infoGrid (fix-up 2): the handler's info keys are what wb_terrain_edit reads, and the battery reads wb_terrain's reshaped answer", async () => {
    // 1. EMCP_WB_Terrain.c registers the flat keys and the contract declares them.
    const src = readFileSync(
      join(REPO_ROOT, "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c"),
      "utf8",
    );
    const regd = new Set([...src.matchAll(/RegV\("(\w+)"\)/g)].map((m) => m[1]!));
    const contract = JSON.parse(
      readFileSync(join(REPO_ROOT, "contracts/EMCP_WB_Terrain.json"), "utf8"),
    ) as { actions: Array<{ name: string; response: Array<{ key: string }> }> };
    const declared = new Set(
      contract.actions.find((a) => a.name === "info")!.response.map((k) => k.key),
    );
    // 2. wb-terrain-edit.ts readGrid reads exactly these keys of the handler's info answer.
    const edit = readFileSync(join(REPO_ROOT, "src/tools/wb-terrain-edit.ts"), "utf8");
    const body = edit.slice(edit.indexOf("async function readGrid("));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    const read = new Set([...fn.matchAll(/\br\.(\w+)/g)].map((m) => m[1]!));
    expect([...read].sort()).toEqual(
      ["boundsMin", "resolutionX", "resolutionY", "tilesX", "tilesY", "unitScale"].sort(),
    );
    for (const k of read) {
      expect(regd.has(k), `EMCP_WB_Terrain.c registers ${k}`).toBe(true);
      expect(declared.has(k), `the contract declares ${k}`).toBe(true);
    }
    // 3. Run 2's EmptyArland answer through wb_terrain info: the battery reads the nested shape.
    const answer = {
      status: "ok",
      code: "",
      action: "info",
      hasTerrain: 1,
      resolutionX: 2049,
      resolutionY: 2049,
      tilesX: 16,
      tilesY: 16,
      unitScale: 2,
      boundsMin: "0 -163 0",
      boundsMax: "4096 148.375 4096",
      minY: 0,
      maxY: 0,
      landArea: 0,
      surfaces: [],
    };
    for (const k of Object.keys(answer))
      if (k !== "status" && k !== "code") expect(declared.has(k)).toBe(true);
    const client = { call: async () => answer } as unknown as Parameters<typeof runTerrain>[0];
    const r = await runTerrain(client, { action: "info" });
    expect(r.ok).toBe(true);
    const g = infoGrid((r as { readback: Record<string, unknown> }).readback);
    expect(g).toEqual({
      tilesX: 16,
      tilesY: 16,
      resX: 2049,
      resY: 2049,
      unitScale: 2,
      minX: 0,
      minZ: 0,
      maxX: 4096,
      maxZ: 4096,
    });
    expect(layoutMismatch({ side: 129, ...g! }, "sharedEdge")).toBe("");
    // The flat keys run 2 read are absent from the tool's answer.
    expect((r as { readback: Record<string, unknown> }).readback.tilesX).toBeUndefined();
  });

  it("tileSamplesOf (fix-up 3): the battery reads wb_terrain tile's reshaped samples, not the handler's rows", async () => {
    // The handler's tile answer (EMCP_WB_Terrain.c ReadTile), run 3's first values of tile 0,0.
    const contract = JSON.parse(
      readFileSync(join(REPO_ROOT, "contracts/EMCP_WB_Terrain.json"), "utf8"),
    ) as { actions: Array<{ name: string; response: Array<{ key: string }> }> };
    const declared = new Set(
      contract.actions.find((a) => a.name === "tile")!.response.map((k) => k.key),
    );
    const answer = {
      status: "ok",
      code: "",
      action: "tile",
      rows: ["-144.531", "-144.531", "-144.562"],
      sampleCount: 16641,
      total: 16641,
      nextCursor: "3:16641",
    };
    for (const k of Object.keys(answer)) expect(declared.has(k), k).toBe(true);
    const client = { call: async () => answer } as unknown as Parameters<typeof runTerrain>[0];
    const r = await runTerrain(client, { action: "tile", tileX: 0, tileY: 0, limit: 3 });
    expect(r.ok).toBe(true);
    const rbk = (r as { readback: Record<string, unknown> }).readback;
    expect(tileSamplesOf(rbk)).toEqual([-144.531, -144.531, -144.562]);
    expect(rbk.nextCursor).toBe("3:16641");
    // The key run 3 read is absent from the tool's answer.
    expect(rbk.rows).toBeUndefined();
    expect(tileSamplesOf({ rows: ["1"] })).toEqual([]);
  });

  it("w7-10 (fix-up 3): tileRead against wb_terrain tile passes on the fake terrain", async () => {
    const t = newTerrain({ worldPath: "$ArmaReforger:worlds/Arland/EmptyArland.ent" });
    const deps = fakeDeps({
      tool: (n, a) =>
        n === "wb_bi"
          ? { ok: false, code: "NOT_ALLOWLISTED", message: "nothing was sent" }
          : terrainTool(t, n, a),
    });
    const r = (await runBattery(only("w7-10-vanilla-reads"), deps, opts("w7-10-oracle")))
      .records[0]!;
    expect(r.detail).not.toMatch(/differ|samples|no terrain|did not open/);
    expect(r.status).toBe("PASS");
    expect(deps.sent.some(([n, a]) => n === "wb_terrain" && a.action === "tile")).toBe(true);
  });

  it("wrongModeCheck (fix-up 2): GATED is accepted while the gate is closed and WRONG_MODE stays unproven; an open gate needs WRONG_MODE", () => {
    const gated = { ok: false, code: "GATED", message: "events waits for probe P-W7-12" };
    const wrong = { ok: false, code: "WRONG_MODE", message: "play mode" };
    const closed = gateFlagsOf(
      (h) =>
        ({
          EMCP_WB_Generator: "static const bool EVENTS_OPEN = false;",
          EMCP_WB_Shape: "static const bool EDIT_OPEN = false;",
        })[h] ?? null,
    );
    // Run 2: both gates closed, both GATED.
    expect(
      wrongModeCheck(
        [
          { key: "events", flag: "EVENTS_OPEN", r: gated },
          { key: "edit", flag: "EDIT_OPEN", r: gated },
        ],
        closed,
      ),
    ).toEqual({ fails: [], unproven: ["events", "edit"] });
    // A closed gate may still answer WRONG_MODE (proven, not unproven).
    expect(wrongModeCheck([{ key: "events", flag: "EVENTS_OPEN", r: wrong }], closed)).toEqual({
      fails: [],
      unproven: [],
    });
    const open = { ...closed, EVENTS_OPEN: true };
    // An open gate answering GATED fails; WRONG_MODE passes.
    expect(
      wrongModeCheck([{ key: "events", flag: "EVENTS_OPEN", r: gated }], open).fails[0],
    ).toMatch(/EVENTS_OPEN true.*GATED/);
    expect(wrongModeCheck([{ key: "events", flag: "EVENTS_OPEN", r: wrong }], open)).toEqual({
      fails: [],
      unproven: [],
    });
    // ok in play always fails; an unknown flag fails.
    expect(
      wrongModeCheck([{ key: "edit", flag: "EDIT_OPEN", r: { ok: true } }], closed).fails,
    ).toEqual(["edit in play: ok"]);
    expect(
      wrongModeCheck([{ key: "edit", flag: "EDIT_OPEN", r: gated }], { ...closed, EDIT_OPEN: null })
        .fails[0],
    ).toMatch(/not found/);
  });
});
