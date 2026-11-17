/**
 * EMCP_WB_Terrain.c checked over its Enforce text offline (wave W1, phase5-w1-spec.md section 2.5):
 * one action surface (OD-6: the 1.x names are mapped in TypeScript), the contract matches the
 * structs and the dispatch, every action makes the engine calls the spec names (each checked
 * against the 1.9.0.37 index by scripts/enforce-lint.ts), every action answers NO_TERRAIN on empty
 * bounds, and no terrain writer is called. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Terrain.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Terrain.json"));

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of a method up to the next method separator. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`(?:static |protected )*\\b(?!return\\b)\\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const end = s.indexOf("//-----", at);
  return code(s.slice(at, end < 0 ? undefined : end));
}

const C = code(src);
const ACTIONS: Record<string, string> = {
  info: "ReadInfo",
  heights: "ReadHeights",
  tile: "ReadTile",
};

describe("EMCP_WB_Terrain structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_TerrainRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_TerrainResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action to its method and nothing else (OD-6)", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z_]+)"\)\s*\n\s*(\w+)\(/g)];
    const placeholders =
      /req\.action == "navmesh_status" \|\| req\.action == "road_export_graph"\)\s*\{\s*NotImplemented\(req, resp\);\s*\}/;
    expect(C).toMatch(placeholders);
    expect([...branches.map((m) => m[1]), "navmesh_status", "road_export_graph"].sort()).toEqual(
      contract.actions.map((a) => a.name).sort(),
    );
    for (const m of branches) expect(m[2]).toBe({ ...ACTIONS, inspect: "Inspect" }[m[1]]);
    // The 1.x wb_terrain names are mapped in TypeScript; the unused 1.x placeholders stay gone.
    for (const old of ["getHeight", "getBounds", "save_world_as", "navmesh_bake"])
      expect(C, old).not.toContain(`"${old}"`);
  });

  it("keeps the 1.x terrain_* actions as 1.x answered them", () => {
    const inspect = method(src, "Inspect");
    expect(inspect).toContain("worldEditor.GetTerrainBounds(boundsMinVec, boundsMaxVec)");
    expect(inspect).toContain('json += "\\"bounds\\":null";');
    expect(inspect).toContain("EMCP_WB_Common.JsonEscape(req.world_path)");
    expect(inspect).toContain("resp.payload = json;");
    const notImpl = method(src, "NotImplemented");
    expect(notImpl).toContain('resp.status = "error";');
    expect(notImpl).toContain('resp.message = "not implemented: action \'" + req.action');
  });

  it("every action is a read: not mutating, not projectOnly", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(false);
      expect(a.projectOnly, a.name).toBe(false);
    }
  });

  it("no FindFiles, FileIO, RunCmd, RunCommandline, Configure, Dialog or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "FileIO",
      "RunCmd",
      "RunCommandline",
      "Configure(",
      "Workbench.Dialog",
      "EMCP2_sandbox",
      "_throwaway",
    ]) {
      expect(C, banned).not.toContain(banned);
    }
  });

  it("calls no terrain writer and no guard (pure reads)", () => {
    for (const writer of [
      "BeginTerrainAction",
      "EndTerrainAction",
      "SetTerrainSurfaceTile",
      "ModifyHeightMap",
      "ModifyLayers",
      "ExportSurfaceMasks",
      "BeginEntityAction",
      "TerrainFlatter",
      "IsProjectFound",
    ]) {
      expect(C, writer).not.toContain(writer);
    }
  });

  it("uses no ternary operator", () => {
    const noStrings = C.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    expect(noStrings).not.toMatch(/\?/);
  });
});

describe("engine calls per action (spec section 2.5)", () => {
  const CALLS: Record<string, string[]> = {
    TerrainBounds: ["worldEditor.GetTerrainBounds(boundsMin, boundsMax)"],
    ReadInfo: [
      "api.GetTerrainResolutionX(terrainIndex)",
      "api.GetTerrainResolutionY(terrainIndex)",
      "api.GetTerrainTilesX(terrainIndex)",
      "api.GetTerrainTilesY(terrainIndex)",
      "api.GetTerrainUnitScale(terrainIndex)",
      "api.GetSurfaceMaterials(terrainIndex, materials)",
      "SCR_WorldEditorToolHelper.GetTerrainMinMaxY(lowest, highest)",
      "SCR_WorldEditorToolHelper.GetTerrainLandArea(terrainIndex)",
    ],
    ReadHeights: ["api.TryGetTerrainSurfaceY(sx, sz, sy)"],
    ReadTile: ["api.GetTerrainSurfaceTile(terrainIndex, tileX, tileY, samples)"],
  };
  for (const [m, calls] of Object.entries(CALLS)) {
    it(`${m} makes ${calls.length} call(s)`, () => {
      const body = method(src, m);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  it("every action checks the bounds and answers NO_TERRAIN before reading the terrain", () => {
    for (const m of Object.values(ACTIONS)) {
      const body = method(src, m);
      const check = body.indexOf("TerrainBounds(worldEditor, boundsMin, boundsMax)");
      expect(check, m).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("NO_TERRAIN"), m).toBeGreaterThan(check);
      const read = body.search(/api\.(GetTerrain|TryGetTerrain|GetSurface)/);
      expect(read, m).toBeGreaterThan(check);
    }
    expect(method(src, "TerrainBounds")).toContain("vector.Distance(boundsMin, boundsMax) > 0");
  });

  it("min/max height is computed only when asked (review T1)", () => {
    const body = method(src, "ReadInfo");
    expect(body).toMatch(
      /if \(req\.minMax\)\s*\{[^}]*SCR_WorldEditorToolHelper\.GetTerrainMinMaxY\(lowest, highest\);/,
    );
    expect(body.match(/GetTerrainMinMaxY/g) ?? []).toHaveLength(1);
  });

  it("land area is computed only when asked", () => {
    const body = method(src, "ReadInfo");
    expect(body).toMatch(
      /if \(req\.landArea\)\s*\{\s*resp\.landArea = SCR_WorldEditorToolHelper\.GetTerrainLandArea/,
    );
  });

  it("heights takes at most 200 points and refuses a malformed one", () => {
    expect(src).toContain("static const int MAX_POINTS = 200;");
    const body = method(src, "ReadHeights");
    expect(body).toContain("points.Count() > EMCP_WB_TerrainUtil.MAX_POINTS");
    expect(body).toContain("EMCP_WB_TerrainUtil.ParsePoint(point, px, pz, why)");
  });

  it("tile refuses a tile outside the tile counts before reading it", () => {
    const body = method(src, "ReadTile");
    expect(body.indexOf("tileX >= countX || tileY >= countY")).toBeLessThan(
      body.indexOf("api.GetTerrainSurfaceTile("),
    );
  });
});

describe("paging and refusal codes", () => {
  it("cursor is <start>:<count>; a changed count is STALE_CURSOR; limit 50 default, 200 max", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    expect(method(src, "PageWindow")).toMatch(
      /if \(count != total \|\| at > total\)\s*\{\s*code = "STALE_CURSOR";/,
    );
    expect(method(src, "ReadTile")).toContain(
      "EMCP_WB_TerrainUtil.PageWindow(req.cursor, req.limit, total, first, stop, code, why)",
    );
  });

  it("answers the W1 codes and the guard's refusal form", () => {
    for (const c of ['"NO_TERRAIN"', '"NO_WORLD"', '"ENGINE_FALSE"', '"INVALID_ARGUMENT"'])
      expect(src, c).toContain(c);
    expect(method(src, "Refuse")).toContain("EMCP_WB_Guard.REFUSED");
    expect(method(src, "Answer")).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
  });

  it("answers hasTerrain as a bool", () => {
    expect(src).toMatch(/\n\s*bool hasTerrain;/);
    expect(method(src, "ReadInfo")).toContain("resp.hasTerrain = has;");
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:api:SCR_WorldEditorToolHelper.GetTerrainMinMaxY/2
// census:api:WorldEditor.GetTerrainBounds/2
// census:api:WorldEditorAPI.GetSurfaceMaterials/2
// census:api:WorldEditorAPI.GetTerrainResolutionX/1
// census:api:WorldEditorAPI.GetTerrainResolutionY/1
// census:api:WorldEditorAPI.GetTerrainSurfaceTile/4
// census:api:WorldEditorAPI.GetTerrainTilesX/1
// census:api:WorldEditorAPI.GetTerrainTilesY/1
// census:api:WorldEditorAPI.GetTerrainUnitScale/1
// census:api:WorldEditorAPI.TryGetTerrainSurfaceY/3
// census:mcp:action/terrain_inspect.run
// census:mcp:handler-action/EMCP_WB_Terrain.heights
// census:mcp:handler-action/EMCP_WB_Terrain.info
// census:mcp:handler-action/EMCP_WB_Terrain.inspect
// census:mcp:handler-action/EMCP_WB_Terrain.tile
