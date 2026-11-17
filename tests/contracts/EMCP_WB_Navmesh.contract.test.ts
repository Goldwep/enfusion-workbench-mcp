/**
 * The W5 Navmesh handler (EMCP_WB_Navmesh.c) checked over its Enforce text offline
 * (phase5-w5-spec.md section 2.3, DEC-068): the contract matches the structs and the dispatch, the
 * guards come in the order the spec's guard column asks, the engine calls are the spec's, the
 * probe-gated calls (P-W5-14 GetReachablePoint, P-W5-15 RequestNavmeshRebuild) keep their weak
 * oracles, a navmesh project reaches the engine only when the AIWorld declares it, and no banned
 * call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Navmesh.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Navmesh.json"));

/** The W5 codes this handler uses that the integrator adds to vocabulary.ts (spec section 1.3). */
const W5_CODES = ["NO_AI_WORLD", "NO_NAVMESH_COMPONENT", "NOT_SCR_AI_WORLD", "BOX_TOO_LARGE"];

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
const MUTATING = ["load", "rebuild", "rebuildEntity"];
const PROJECT_ONLY = ["rebuild", "rebuildEntity"];
const ACTIONS = ["status", "tile", "reachable", ...MUTATING];

describe("EMCP_WB_Navmesh structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_NavmeshRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_NavmeshResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 6 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
  });

  it("load is a runtime memory change without confirm; the rebuilds are project-only with confirm", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(MUTATING.includes(a.name));
      expect(a.projectOnly, a.name).toBe(PROJECT_ONLY.includes(a.name));
      const keys = a.params.map((p) => p.key);
      expect(keys.includes("confirm"), a.name).toBe(PROJECT_ONLY.includes(a.name));
    }
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntitySource|IEntity|AIWorld|SCR_AIWorld|NavmeshWorldComponent|BaseContainer|WorldEditorAPI|WorldEditor|IEntityComponentSource)\b/,
    );
  });

  it("float values never travel through a request field", () => {
    const req = /class EMCP_WB_NavmeshRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    expect(req).not.toMatch(/\bvector\b/);
  });

  it("every refusal code is in the vocabulary or among the W5 codes the integrator adds", () => {
    const known = new Set([...Object.keys(ERROR_CODES), ...W5_CODES]);
    const consts = [...c.matchAll(/static const string ([A-Z_]+) = "([A-Z_]+)";/g)]
      .filter((m) => m[1] === m[2])
      .map((m) => m[2]);
    expect(consts.length).toBeGreaterThan(5);
    for (const k of consts) expect(known.has(k), k).toBe(true);
    for (const k of W5_CODES) expect(consts, k).toContain(k);
  });
});

describe("no banned call", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, RunProcess, Configure, FileIO or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "RunCommandline",
      "RunCmd",
      "RunProcess",
      "Configure(",
      "FileIO",
      "EMCP2_sandbox",
      "_throwaway",
      "NavmeshGeneratorMain",
      "OpenResource",
      "RequestNavmeshLoad",
      "RequestNavmeshRebuildAreas",
      "Save(",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("no ternary operator and no reserved name", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
    expect(c).not.toMatch(/\b(?:Wait|vanilla)\b/);
  });

  it("no entity action is opened: a navmesh rebuild is not an entity edit", () => {
    expect(c).not.toContain("BeginEntityAction");
    expect(c).not.toContain("EndEntityAction");
  });
});

describe("guards", () => {
  it("the world guard: GetModule, GetApi, NoWorldReason, prefab edit mode and play mode, then bounds", () => {
    const body = method(src, "OpenWorld");
    inOrder(
      body,
      [
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
        "worldEditor.IsPrefabEditMode()",
        'Refuse(resp, WRONG_MODE, "the World Editor is in prefab edit mode',
        "api.IsGameMode()",
        'Refuse(resp, WRONG_MODE, "the World Editor is in play mode',
        "worldEditor.GetTerrainBounds(boundsLow, boundsHigh)",
      ],
      "OpenWorld",
    );
    expect(src).toContain("GetModule may have opened");
  });

  it("project+world: the project first, then the world guard, then the world under the project", () => {
    inOrder(
      method(src, "ProjectWorld"),
      [
        "EMCP_WB_Guard.Project(addonId, projectDir, why)",
        "Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, why",
        "OpenWorld(ctx, resp)",
        "ctx.m_Api.GetWorldPath(worldPath)",
        'worldPath.StartsWith("$" + addonId + ":")',
        "EMCP_WB_Guard.IsUnder(worldPath, projectDir)",
        '"the open world is not a world of the open project',
      ],
      "ProjectWorld",
    );
  });

  it("the reads and load take the world guard, never the project guard", () => {
    for (const m of ["Status", "Tile", "Load", "Reachable"]) {
      const body = method(src, m);
      expect(body, m).toContain("OpenWorld(ctx, resp)");
      expect(body, m).not.toContain("ProjectWorld");
      expect(body, m).not.toContain("req.confirm");
    }
  });

  it("the rebuilds take project+world and are a dry run unless confirm, checked before the call", () => {
    inOrder(
      method(src, "Rebuild"),
      [
        "ProjectWorld(ctx, resp)",
        "EMCP_WB_Common.ParseVectorString(req.min, lo, error)",
        "EMCP_WB_Common.ParseVectorString(req.max, hi, error)",
        'BoxFits(lo, hi, "the box", resp)',
        "FindAIWorld(ctx, resp)",
        "if (!req.confirm)",
        "resp.dryRun = true;",
        "ctx.m_AIWorld.RequestNavmeshRebuild(lo, hi);",
        "resp.requested = true;",
      ],
      "Rebuild",
    );
    inOrder(
      method(src, "RebuildEntity"),
      [
        "ProjectWorld(ctx, resp)",
        "EMCP_WB_EntityRef.Resolve(ctx.m_Api, req.entity, resolved)",
        "ctx.m_Api.SourceToEntity(target)",
        '"the entity has no runtime entity in the edited world',
        "FindAIWorld(ctx, resp)",
        "SCR_AIWorld.Cast(ctx.m_AIWorld)",
        "NOT_SCR_AI_WORLD",
        "scriptedWorld.GetNavmeshRebuildAreas(live, boxes, redoRoads);",
        "BoxFits(box.param1, box.param2,",
        "if (!req.confirm)",
        "resp.dryRun = true;",
        "scriptedWorld.RequestNavmeshRebuildEntity(live);",
        "resp.requested = true;",
      ],
      "RebuildEntity",
    );
  });

  it("BOX_TOO_LARGE above 512 m on any side", () => {
    expect(src).toContain("static const float BOX_MAX = 512;");
    expect(method(src, "BoxFits")).toMatch(
      /if \(side > BOX_MAX\)\s*\{\s*Refuse\(resp, BOX_TOO_LARGE,/,
    );
  });

  it("a missing request is refused before it is read", () => {
    expect(src).toMatch(
      /if \(!req\)\s*\{\s*Answer\(resp, "error", INVALID_ARGUMENT, "no request", "send action"\);\s*return resp;\s*\}\s*resp\.action = req\.action;/,
    );
  });
});

describe("engine calls are the spec's", () => {
  it("the AIWorld: GetGame().GetAIWorld() of the edited world, else the editor entity scan", () => {
    inOrder(
      method(src, "FindAIWorld"),
      [
        "GetGame()",
        "game.GetAIWorld()",
        "api.EntityToSource(gameWorld)",
        "api.GetEditorEntityCount()",
        "api.GetEditorEntity(e)",
        "candidateType.IsInherited(AIWorld)",
        "api.SourceToEntity(candidate)",
        "AIWorld.Cast(live)",
        "NO_AI_WORLD",
        "ReadProjects(ctx)",
      ],
      "FindAIWorld",
    );
  });

  it("projects come from the AIWorld's source; an undeclared name never reaches the engine", () => {
    inOrder(
      method(src, "ReadProjects"),
      [
        "src.GetComponentCount()",
        "src.GetComponent(c)",
        "compType.IsInherited(NavmeshWorldComponent)",
        "comp.GetObject(SETTINGS_OBJECT)",
        "settings.Get(PROJECT_VARIABLE, projectName)",
      ],
      "ReadProjects",
    );
    inOrder(
      method(src, "ChooseComponent"),
      [
        "ctx.m_Projects.Find(chosen) < 0",
        '"the AIWorld declares no navmesh project',
        "ctx.m_AIWorld.GetNavmeshWorldComponent(chosen)",
        'returned null", "check the AIWorld',
      ],
      "ChooseComponent",
    );
    expect((c.match(/\.GetNavmeshWorldComponent\(/g) ?? []).length).toBe(1);
  });

  it("status: a paged grid of IsTileLoaded, IsTileValid, IsTileRequested capped at 40,000 points", () => {
    expect(src).toContain("static const int GRID_MAX = 40000;");
    expect(src).toContain("static const int PAGE_DEFAULT = 100;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    inOrder(
      method(src, "Status"),
      [
        "OpenWorld(ctx, resp)",
        "FindAIWorld(ctx, resp)",
        "ChooseComponent(ctx, req.project, resp)",
        "ChooseGridStep(ctx, req.step, gridStep, resp)",
        "STALE_CURSOR",
        "navmesh.IsTileLoaded(point)",
        "navmesh.IsTileValid(point)",
        "navmesh.IsTileRequested(point)",
        'resp.nextCursor = end.ToString() + ":" + totalPoints.ToString();',
      ],
      "Status",
    );
    expect(method(src, "ChooseGridStep")).toContain("givenX * givenZ > GRID_MAX");
  });

  it("tile and load: the position is checked before the AIWorld is reached", () => {
    inOrder(
      method(src, "Tile"),
      [
        "ReadPosition(ctx, req.position,",
        "FindAIWorld(ctx, resp)",
        "ChooseComponent(ctx, req.project, resp)",
        "ctx.m_Component.IsTileLoaded(at)",
        "ctx.m_Component.IsTileValid(at)",
        "ctx.m_Component.IsTileRequested(at)",
      ],
      "Tile",
    );
    inOrder(
      method(src, "Load"),
      [
        "ReadPosition(ctx, req.position,",
        "FindAIWorld(ctx, resp)",
        "ChooseComponent(ctx, req.project, resp)",
        "ctx.m_Component.LoadTileIn(at)",
        "ctx.m_Component.IsTileLoaded(at)",
      ],
      "Load",
    );
  });

  it("reachable (P-W5-14): the point is answered only when the engine wrote it back", () => {
    inOrder(
      method(src, "Reachable"),
      [
        "ReadPosition(ctx, req.position,",
        "EMCP_WB_Common.ParseFloat(req.distance, reach)",
        "reach > REACH_MAX",
        "unwritten[1] = origin[1] + UNWRITTEN_OFFSET;",
        "ctx.m_Component.GetReachablePoint(origin, reach, reached)",
        "!SameVector(reached, unwritten)",
        "if (resp.found && written)",
        "resp.point = EMCP_WB_Common.VectorToString(reached);",
      ],
      "Reachable",
    );
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:handler-action/EMCP_WB_Navmesh.load
// census:mcp:handler-action/EMCP_WB_Navmesh.reachable
// census:mcp:handler-action/EMCP_WB_Navmesh.status
// census:mcp:handler-action/EMCP_WB_Navmesh.tile

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Navmesh.rebuild
// census:mcp:handler-action/EMCP_WB_Navmesh.rebuildEntity
