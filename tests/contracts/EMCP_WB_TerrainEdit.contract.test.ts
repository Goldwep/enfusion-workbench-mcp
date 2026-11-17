/**
 * The W7 terrain-edit handler (EMCP_WB_TerrainEdit.c) checked over its Enforce text offline
 * (phase5-w7-spec.md sections 1.2 and 2.1, DEC-075): the contract matches the structs and the
 * dispatch, every gate flag is false, a confirmed write passes its gate, then the throwaway world gate
 * (OD-5), then ENGINE_BUSY, before the one terrain action; the dry run answers before any gate; the
 * engine calls are the spec's (AddTerrainFlatterEntity with 7 arguments); the refusal codes are the
 * vocabulary's or the two W7 adds; and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_TerrainEdit.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_TerrainEdit.json"));

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` up to the next method separator or the class end. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`static \\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const classEnd = s.slice(at).search(/\r?\n}\r?\n/);
  const ends = [s.indexOf("//-----", at), classEnd >= 0 ? at + classEnd : -1].filter((e) => e >= 0);
  return code(s.slice(at, ends.length ? Math.min(...ends) : undefined));
}

/** Index of each text in body; all present and in the given order. */
function inOrder(body: string, texts: string[], label: string): void {
  const at = texts.map((t) => body.indexOf(t));
  texts.forEach((t, i) => expect(at[i], `${label}: ${t}`).toBeGreaterThanOrEqual(0));
  expect(
    [...at].sort((a, b) => a - b),
    label,
  ).toEqual(at);
}

const c = code(src);
const ACTIONS = [
  "tileRead",
  "tileWrite",
  "brush",
  "flatter",
  "maps",
  "exportMasks",
  "backup",
  "restore",
];
const MUTATING = ACTIONS.filter((a) => a !== "tileRead");
const TS_SERVED = ["brush", "backup", "restore"];
/** Terrain writes that take confirm (spec 1.2 rule 6; backup is a copy out and takes none). */
const CONFIRMED = ["tileWrite", "brush", "flatter", "maps", "exportMasks", "restore"];
/** Codes W7 adds to the vocabulary (spec 1.2 rule 13); Main lands them. */
const W7_NEW_CODES = ["ENGINE_BUSY", "TERRAIN_ACTION_REFUSED", "NO_BACKUP", "WORLD_OPEN"];
/** Every gate flag (spec 1.2 rule 9, DEC-075 OD-5) and its probe; all false until Main flips one. */
const GATES = {
  TERRAIN_WRITE_OPEN: "P-W7-01",
  FLATTER_OPEN: "P-W7-06",
  MAPS_OPEN: "P-W7-07",
  MASKS_OPEN: "P-W7-08",
  ANY_WORLD_OPEN: "OI-W7-6",
};

describe("EMCP_WB_TerrainEdit structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_TerrainEditRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_TerrainEditResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 8 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
  });

  it("every action but tileRead is mutating and project-only; the terrain writes take confirm", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(MUTATING.includes(a.name));
      expect(a.projectOnly, a.name).toBe(MUTATING.includes(a.name));
      const keys = a.params.map((p) => p.key);
      if (CONFIRMED.includes(a.name)) expect(keys, a.name).toContain("confirm");
      else expect(keys, a.name).not.toContain("confirm");
    }
  });

  it("brush, backup and restore are TS-served; the handler's writes are GATED in the contract", () => {
    const by = new Map(contract.actions.map((a) => [a.name, a]));
    for (const n of TS_SERVED) expect(by.get(n)!.refuses, n).toMatch(/TS tool/);
    expect(by.get("tileWrite")!.refuses).toMatch(/^GATED until P-W7-01.*_throwaway/);
    expect(by.get("flatter")!.refuses).toMatch(/^GATED until P-W7-06.*_throwaway/);
    expect(by.get("maps")!.refuses).toMatch(/^GATED until P-W7-07.*_throwaway/);
    expect(by.get("exportMasks")!.refuses).toMatch(/^GATED until P-W7-08/);
    expect(by.get("exportMasks")!.refuses).not.toMatch(/_throwaway/);
    expect(by.get("tileRead")!.refuses).toBeUndefined();
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("the contract's $schema points at the promoted schema", () => {
    const raw = JSON.parse(readFileSync(join("contracts", "EMCP_WB_TerrainEdit.json"), "utf-8"));
    expect(raw.$schema).toBe("./_schema/contract.schema.json");
    expect(raw.source).toBe(LINT_PATH);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntitySource|IEntity|ShapeEntity|BaseContainer|WorldEditorAPI|BaseContainerList)\b/,
    );
    expect(c).not.toMatch(/\bout\s+[\w<> ]+\s+\w+\s*=\s*null/);
  });

  it("float values never travel through a request field", () => {
    const req = /class EMCP_WB_TerrainEditRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    expect(req).not.toMatch(/\bvector\b/);
  });
});

describe("gates", () => {
  it("every gate flag is a static const bool and false", () => {
    for (const flag of Object.keys(GATES)) {
      expect(src, flag).toMatch(new RegExp(`static const bool ${flag} = false;`));
    }
    expect(
      [...c.matchAll(/static const bool (\w+) = (true|false);/g)].map((m) => m[1]).sort(),
    ).toEqual(Object.keys(GATES).sort());
  });

  it("each confirmed write names its own gate and probe", () => {
    expect(method(src, "TileWrite")).toContain(
      'WriteGate(TERRAIN_WRITE_OPEN, "P-W7-01 (U18)", true,',
    );
    expect(method(src, "Flatter")).toContain('WriteGate(FLATTER_OPEN, "P-W7-06", true,');
    expect(method(src, "BuildMaps")).toContain('WriteGate(MAPS_OPEN, "P-W7-07", true,');
    // exportMasks writes into a new project folder: not behind the world gate (DEC-075 OD-5).
    expect(method(src, "ExportMasks")).toContain('WriteGate(MASKS_OPEN, "P-W7-08", false, false,');
  });

  it("WriteGate refuses the probe gate first, then a world outside _throwaway/ unless ANY_WORLD_OPEN", () => {
    inOrder(
      method(src, "WriteGate"),
      [
        "if (!open)",
        'Refuse(resp, GATED, "this write waits for probe "',
        "worldGate && !ANY_WORLD_OPEN && !throwaway",
        "Refuse(resp, GATED, \"terrain writes outside the project's _throwaway/ folder",
      ],
      "WriteGate",
    );
    expect(src).toContain('static const string THROWAWAY_FOLDER = "_throwaway/";');
    expect(method(src, "IsThrowaway")).toContain("EMCP_WB_Guard.Fold(rel)");
    expect(method(src, "IsThrowaway")).toContain(".StartsWith(THROWAWAY_FOLDER)");
  });

  it("the world path is taken relative to the project and checked clean", () => {
    inOrder(
      method(src, "WorldRelative"),
      [
        "EMCP_WB_Guard.Project(addonId, projectDir, why)",
        "api.GetWorldPath(worldPath)",
        "worldPath.StartsWith(prefix)",
        "EMCP_WB_Guard.IsUnder(worldPath, projectDir)",
        "EMCP_WB_Guard.CleanRelative(tail, clean, cleanWhy)",
      ],
      "WorldRelative",
    );
  });

  it("each terrain write: dry run answered before the gate, then the gate, ENGINE_BUSY, one action", () => {
    for (const [m, undo] of [
      ["TileWrite", '"tileWrite"'],
      ["Flatter", '"flatter"'],
    ]) {
      inOrder(
        method(src, m),
        [
          "EditApi(resp)",
          "ProjectWorld(api, resp, throwaway)",
          "if (!wantWrite)",
          "WriteGate(",
          "NotBusy(api, resp)",
          `UNDO_PREFIX + ${undo}`,
          "api.BeginTerrainAction(undoName)",
          "Refuse(resp, TERRAIN_ACTION_REFUSED",
          "api.EndTerrainAction(undoName)",
          "resp.undoName = undoName",
        ],
        m,
      );
    }
    inOrder(
      method(src, "BuildMaps"),
      [
        "EditApi(resp)",
        "ProjectWorld(api, resp, throwaway)",
        "if (!wantWrite)",
        "WriteGate(",
        "NotBusy(api, resp)",
        "api.BuildShoreMap()",
      ],
      "maps",
    );
    inOrder(
      method(src, "ExportMasks"),
      [
        "EditApi(resp)",
        "EMCP_WB_Guard.NewTargetInProject(directory, absDir, why)",
        "if (!wantWrite)",
        "WriteGate(",
        "NotBusy(api, resp)",
        "api.ExportSurfaceMasks(terrainIndex, absDir)",
      ],
      "exportMasks",
    );
  });

  it("ENGINE_BUSY: inside another edit action or an undo", () => {
    inOrder(
      method(src, "NotBusy"),
      ["api.IsDoingEditAction()", "api.UndoOrRedoIsRestoring()", "Refuse(resp, ENGINE_BUSY"],
      "NotBusy",
    );
  });
});

describe("guards", () => {
  it("every World Editor call goes through the shared world-loaded check, then the terrain check", () => {
    inOrder(
      method(src, "TerrainApi"),
      [
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason",
        "worldEditor.GetTerrainBounds(boundsMin, boundsMax)",
        "Refuse(resp, NO_TERRAIN",
      ],
      "TerrainApi",
    );
    inOrder(
      method(src, "EditApi"),
      ["EMCP_WB_Guard.IsProjectFound()", "TerrainApi(resp)", "Refuse(resp, WRONG_MODE"],
      "EditApi",
    );
  });

  it("tileRead reads with TerrainApi and no project guard; the writes use EditApi", () => {
    const read = method(src, "TileRead");
    expect(read).toContain("TerrainApi(resp)");
    expect(read).not.toContain("EditApi(resp)");
    expect(read).not.toContain("BeginTerrainAction");
    for (const m of ["TileWrite", "Flatter", "BuildMaps", "ExportMasks"]) {
      expect(method(src, m), m).toContain("EditApi(resp)");
    }
  });

  it("tileWrite parses every run, checks the tiles, confirms the side on the first tile, then the rows", () => {
    inOrder(
      method(src, "TileWrite"),
      [
        "MAX_PATCHES",
        "MAX_LABEL",
        "ParsePatch(req.patches.Get(p), parsed, patchWhy)",
        "EditApi(resp)",
        "Grid(api, terrainIndex, resp, grid)",
        "tileCheck.m_TileX >= grid.m_TilesX",
        "ReadTileInto(api, terrainIndex, firstRun.m_TileX, firstRun.m_TileY, grid,",
        "int side = grid.m_Side;",
        "resp.layout = grid.m_Layout;",
        "check.m_Col + check.m_Values.Count() > side",
        "resp.dryRun = true",
        "if (!wantWrite)",
      ],
      "tileWrite",
    );
    expect(method(src, "ParsePatch")).toContain("MAX_ABS_HEIGHT");
  });

  it("fix-up 1: Grid offers both layouts; the side is confirmed by a tile's sample count", () => {
    const grid = method(src, "Grid");
    // disjoint: res = tiles * side; sharedEdge: res = tiles * (side - 1) + 1 (EmptyArland 2049 / 16)
    expect(grid).toContain("evenX * countX == resX");
    expect(grid).toContain("strideX * countX + 1 == resX");
    expect(grid).toContain("grid.m_SharedSide = strideX + 1;");
    expect(grid).not.toMatch(/grid.m_Side = [^0]/);
    expect(grid).toContain("UNPROVEN");
    const confirm = method(src, "ConfirmSide");
    inOrder(
      confirm,
      [
        "if (grid.m_Side > 0)",
        "sampleCount == shared * shared",
        "sampleCount == disjoint * disjoint",
        'grid.m_Layout = "single";',
        'grid.m_Layout = "sharedEdge";',
        'grid.m_Layout = "disjoint";',
        "not side * side for side",
      ],
      "ConfirmSide",
    );
    expect(method(src, "ReadTileInto")).toContain(
      "ConfirmSide(grid, got.Count(), tileX, tileY, resp)",
    );
    expect(method(src, "TileRead")).toContain("resp.layout = grid.m_Layout;");
  });

  it("exportMasks refuses a folder that exists (no file read can show it is empty)", () => {
    inOrder(
      method(src, "ExportMasks"),
      [
        "EMCP_WB_Guard.NewTargetInProject(directory, absDir, why)",
        "Workbench.GetAbsolutePath(",
        "exists already",
        "if (!wantWrite)",
      ],
      "exportMasks",
    );
  });
});

describe("engine calls", () => {
  it("tiles are read into a local array and written by the spec's /4 calls", () => {
    const readBody = method(src, "ReadTileInto");
    expect(readBody).toContain("array<float> got = {};");
    expect(readBody).toContain("api.GetTerrainSurfaceTile(terrainIndex, tileX, tileY, got)");
    expect(method(src, "TileWrite")).toContain(
      "api.SetTerrainSurfaceTile(terrainIndex, writeTile.m_TileX, writeTile.m_TileY, writeTile.m_Heights)",
    );
  });

  it("BeginTerrainAction takes the undo name only and EndTerrainAction the same name", () => {
    for (const m of [...c.matchAll(/BeginTerrainAction\(([^)]*)\)/g)])
      expect(m[1]).toBe("undoName");
    for (const m of [...c.matchAll(/EndTerrainAction\(([^)]*)\)/g)]) expect(m[1]).toBe("undoName");
    expect(src).toContain('static const string UNDO_PREFIX = "EMCP wb_terrain_edit ";');
  });

  it("AddTerrainFlatterEntity is called with 7 arguments, bForceUpdate true, never a null array", () => {
    const call = /api\.AddTerrainFlatterEntity\(([^;]*)\);/.exec(c);
    expect(call).not.toBeNull();
    const args = call![1].split(",").map((a) => a.trim());
    expect(args).toHaveLength(7);
    expect(args[0]).toBe("ent");
    expect(args[6]).toBe("true");
    expect(args).not.toContain("null");
    expect(c).toContain("api.RemoveTerrainFlatterEntity(ent, true)");
  });

  it("maps: BuildShoreMap, or RegenerateFlowMaps(preview, save, synchronous, no warning)", () => {
    const body = method(src, "BuildMaps");
    expect(body).toContain("api.BuildShoreMap()");
    expect(body).toContain("api.RegenerateFlowMaps(preview, true, false, true)");
  });
});

describe("codes", () => {
  it("every refusal code is the vocabulary's or one W7 adds", () => {
    const consts = new Map(
      [...c.matchAll(/static const string (\w+) = "([A-Z_]+)";/g)].map((m) => [m[1], m[2]]),
    );
    const used = new Set<string>();
    for (const m of c.matchAll(/(?:Answer|Refuse)\(resp, (?:"\w+", )?(\w+|"[A-Z_]+"),/g)) {
      const raw = m[1];
      if (raw.startsWith('"')) used.add(raw.slice(1, -1));
      else if (consts.has(raw)) used.add(consts.get(raw)!);
    }
    used.add("NOT_IN_PROJECT");
    used.add("ENTITY_NOT_FOUND");
    for (const code of used) {
      if (code === "") continue;
      expect(
        code in ERROR_CODES || W7_NEW_CODES.includes(code),
        `code ${code} is not in vocabulary.ts`,
      ).toBe(true);
    }
    for (const want of [
      "GATED",
      "ENGINE_BUSY",
      "TERRAIN_ACTION_REFUSED",
      "NO_TERRAIN",
      "NO_WORLD",
      "WRONG_MODE",
      "STALE_CURSOR",
      "INVALID_ARGUMENT",
      "ENGINE_FALSE",
    ]) {
      expect([...used], want).toContain(want);
    }
    // NO_BACKUP and WORLD_OPEN are the TS tool's (per-session backup record, restore); never here.
    expect(c).not.toContain("NO_BACKUP");
    expect(c).not.toContain('WORLD_OPEN"');
  });
});

describe("no banned call", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, Configure, FileIO or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "ScriptDialog",
      "WBProgressDialog",
      "RunCommandline",
      "RunCmd",
      "RunProcess",
      "Configure(",
      "FileIO",
      "Sleep(",
      "EMCP2_sandbox",
      "OpenResource",
      "SetOpenedResource",
      "ModifyHeightMap",
      "ModifyLayers",
      "ExportTerrain",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("no reserved identifier (Wait, vanilla) and no ternary operator", () => {
    expect(c).not.toMatch(/\b(?:Wait|vanilla)\b/);
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });
});

// Census rows this file tests (W7 close-out, EV-W7-107).
// census:mcp:handler-action/EMCP_WB_TerrainEdit.tileRead

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_TerrainEdit.backup
// census:mcp:handler-action/EMCP_WB_TerrainEdit.brush
// census:mcp:handler-action/EMCP_WB_TerrainEdit.exportMasks
// census:mcp:handler-action/EMCP_WB_TerrainEdit.flatter
// census:mcp:handler-action/EMCP_WB_TerrainEdit.maps
// census:mcp:handler-action/EMCP_WB_TerrainEdit.restore
// census:mcp:handler-action/EMCP_WB_TerrainEdit.tileWrite
