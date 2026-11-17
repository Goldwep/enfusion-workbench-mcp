/**
 * The Shape handler (EMCP_WB_Shape.c) checked over its Enforce text offline (W6:
 * phase5-w6-spec.md section 2.3, DEC-069 OD-2; W7: phase5-w7-spec.md section 2.3, DEC-075): the
 * contract matches the structs and the dispatch, the guards come in the order the spec asks, the
 * engine calls are the spec's, parallel stays GATED until P-W6-16 and edit until P-W7-14, the
 * refusal codes are the vocabulary's, and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Shape.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Shape.json"));

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
const MUTATING = ["create", "edit", "area", "import", "parallel"];
const ACTIONS = ["points", ...MUTATING];
/** Codes the spec adds to the vocabulary with W6 (section 1.2 rule 12); Main lands them. */
const W6_NEW_CODES = ["NOT_A_SHAPE"];

describe("EMCP_WB_Shape structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_ShapeRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ShapeResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 6 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
  });

  it("mutating actions are project-only and take no confirm (in-memory edits, DEC-061 OD-3)", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(MUTATING.includes(a.name));
      expect(a.projectOnly, a.name).toBe(MUTATING.includes(a.name));
      expect(
        a.params.map((p) => p.key),
        a.name,
      ).not.toContain("confirm");
    }
  });

  it("area and import are TS-served, parallel and edit are GATED in the contract", () => {
    const by = new Map(contract.actions.map((a) => [a.name, a]));
    expect(by.get("area")!.refuses).toMatch(/TS tool/);
    expect(by.get("import")!.refuses).toMatch(/TS tool/);
    expect(by.get("parallel")!.refuses).toMatch(/GATED.*P-W6-16/);
    expect(by.get("edit")!.refuses).toMatch(/GATED.*P-W7-14/);
    for (const n of ["points", "create"]) expect(by.get(n)!.refuses, n).toBeUndefined();
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntitySource|IEntity|ShapeEntity|BaseContainer|WorldEditorAPI|BaseContainerList)\b/,
    );
    // ...and nothing declares an `out X = null` default of its own (spec 1.2 rule 3).
    expect(c).not.toMatch(/\bout\s+[\w<> ]+\s+\w+\s*=\s*null/);
  });

  it("float values never travel through a request field", () => {
    const req = /class EMCP_WB_ShapeRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    expect(req).not.toMatch(/\bvector\b/);
  });

  it("every refusal code is the vocabulary's or one W6 adds", () => {
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
        code in ERROR_CODES || W6_NEW_CODES.includes(code),
        `code ${code} is not in vocabulary.ts`,
      ).toBe(true);
    }
    expect([...used]).toContain("NOT_A_SHAPE");
    expect([...used]).toContain("GATED");
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
      "GeoShapeLoader",
      "Sleep(",
      "EMCP2_sandbox",
      "_throwaway",
      "OpenResource",
      "SetOpenedResource",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("no reserved identifier (Wait, vanilla) and no ternary operator", () => {
    expect(c).not.toMatch(/\b(?:Wait|vanilla)\b/);
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });
});

describe("guards", () => {
  it("every World Editor call goes through the shared world-loaded check", () => {
    inOrder(
      method(src, "EditorApi"),
      ["Workbench.GetModule(WorldEditor)", "worldEditor.GetApi()", "EMCP_WB_Common.NoWorldReason"],
      "EditorApi",
    );
    inOrder(
      method(src, "EditApi"),
      ["EMCP_WB_Guard.IsProjectFound()", "EditorApi(resp)", "api.IsGameMode()"],
      "EditApi",
    );
  });

  it("points reads with EditorApi and no project guard; the edits use EditApi", () => {
    const read = method(src, "ReadPoints");
    expect(read).toContain("EditorApi(resp)");
    expect(read).not.toContain("EditApi(resp)");
    expect(read).not.toContain("BeginEntityAction");
    for (const m of ["CreateShape", "ParallelShapes", "EditShape"]) {
      const body = method(src, m);
      const guard = body.indexOf("EditApi(resp)");
      expect(guard, m).toBeGreaterThanOrEqual(0);
      expect(guard, m).toBeLessThan(body.indexOf("api.BeginEntityAction"));
    }
  });

  it("create checks every input before the guard and the one entity action", () => {
    inOrder(
      method(src, "CreateShape"),
      [
        "MIN_POINTS",
        "EMCP_WB_Common.ParseVectorString",
        "ParseColor(req.color",
        "EditApi(resp)",
        "EMCP_WB_LayersUtil.LayerIdOf",
        "api.BeginEntityAction(UNDO_CREATE)",
        "BuildShape(",
        "api.EndEntityAction()",
      ],
      "create",
    );
  });

  it("parallel refuses GATED before anything else, then computes every copy before the edit", () => {
    const body = method(src, "ParallelShapes");
    inOrder(
      body,
      [
        "if (!PARALLEL_OPEN)",
        "Refuse(resp, GATED",
        "MAX_OFFSETS",
        "EditApi(resp)",
        "ShapeOf(api, src, resp)",
        "SCR_ParallelShapeHelper.GetAnchorsAndTesselatedPointsFromShape(",
        "api.BeginEntityAction(UNDO_PARALLEL)",
        "BuildShape(",
        "api.EndEntityAction()",
      ],
      "parallel",
    );
    expect(src).toMatch(/static const bool PARALLEL_OPEN = false;/);
  });

  it("edit checks its arguments, then refuses GATED, then guards, before the one entity action", () => {
    inOrder(
      method(src, "EditShape"),
      [
        'req.entity == ""',
        "takesPoints",
        "MIN_POINTS",
        "req.index < 0",
        "EMCP_WB_Common.ParseVectorString",
        "if (!EDIT_OPEN)",
        "Refuse(resp, GATED",
        "EditApi(resp)",
        "ResolveOne(api, req.entity, resp)",
        "ShapeOf(api, src, resp)",
        "int before = SourcePointCount(src)",
        "rangeWhy",
        "api.TryGetTerrainSurfaceY(",
        "shapeEnt.CoordToLocal(worldPoint)",
        "api.BeginEntityAction(undoText)",
        "ApplyEdit(api, src, editOp, req.index, before, localPoints)",
        "int after = SourcePointCount(src)",
        "api.EndEntityAction()",
      ],
      "edit",
    );
    expect(src).toMatch(/static const bool EDIT_OPEN = false;/);
    expect(src).toContain('static const string UNDO_EDIT = "EMCP wb_shape edit";');
  });
});

describe("engine calls", () => {
  it("points: GetPointsPositions through the world transform, IsClosed, NOT_A_SHAPE by cast", () => {
    inOrder(
      method(src, "ReadPoints"),
      [
        "shapeEnt.GetPointsPositions(",
        "shapeEnt.GetWorldTransform(mat)",
        "shapeEnt.IsClosed()",
        ".Multiply4(mat)",
      ],
      "points",
    );
    inOrder(
      method(src, "ShapeOf"),
      ["api.SourceToEntity(src)", "ShapeEntity.Cast(ent)", "Refuse(resp, NOT_A_SHAPE"],
      "ShapeOf",
    );
  });

  it("points: tesselated from a local array; spline tangents from GetTangents and the explicit flag", () => {
    const read = method(src, "ReadPoints");
    inOrder(
      read,
      [
        "array<vector> localPoints = {};",
        "shapeEnt.GenerateTesselatedShape(localPoints)",
        "shapeEnt.GetPointsPositions(localPoints)",
        "SplineShapeEntity.Cast(shapeEnt)",
        "splineEnt && !req.tesselated",
        "splineEnt.GetTangents(t, inTangent, outTangent)",
        "splineEnt.HasPointExplicitTangents(t)",
        "resp.tangents.Insert(",
      ],
      "points",
    );
  });

  it("edit makes SCR_ShapeAreaTool's calls: append the new points, then remove the old from the end", () => {
    const apply = method(src, "ApplyEdit");
    inOrder(
      apply,
      [
        'api.SetVariableValue(src, null, "IsClosed", "1")',
        'api.ClearVariableValue(src, null, "IsClosed")',
        'api.RemoveObjectArrayVariableMember(src, null, "Points", at)',
        "SetPointPosition(api, src, at, localPoints.Get(0))",
        "first = before;",
        'api.CreateObjectArrayVariableMember(src, null, "Points", "ShapePoint", slot)',
        "SetPointPosition(api, src, slot, localPoints.Get(i))",
        "oldSlot = before - 1; oldSlot >= 0; oldSlot--",
        'api.RemoveObjectArrayVariableMember(src, null, "Points", oldSlot)',
      ],
      "ApplyEdit",
    );
    inOrder(
      method(src, "SetPointPosition"),
      [
        'new ContainerIdPathEntry("Points", slot)',
        'api.SetVariableValue(src, slotPath, "Position"',
      ],
      "SetPointPosition",
    );
    // No confirm on an in-memory edit (DEC-075 OD-12).
    expect(method(src, "EditShape")).not.toContain("confirm");
  });

  it("BuildShape makes the import plugin's calls in its order and cleans up a half-built shape", () => {
    inOrder(
      method(src, "BuildShape"),
      [
        "api.CreateEntity(shapeClass, entityName, layerId, parentSrc, origin, vector.Zero)",
        'api.CreateObjectArrayVariableMember(made, null, "Points", "ShapePoint", i)',
        'new ContainerIdPathEntry("Points", i)',
        'api.SetVariableValue(made, pointPath, "Position"',
        '"IsClosed", "1"',
        '"LineColor", colorText',
        "api.DeleteEntity(made)",
        'made.GetObjectArray("Points")',
      ],
      "BuildShape",
    );
    expect(src).toContain('static const string POLYLINE_CLASS = "PolylineShapeEntity";');
    expect(src).toContain('static const string SPLINE_CLASS = "SplineShapeEntity";');
  });

  it("parallel calls the /5 helper with a local array<int> last, never the null default", () => {
    const body = method(src, "ParallelShapes");
    expect(body).toContain("array<int> anchorIndices = {};");
    const call =
      /SCR_ParallelShapeHelper\.GetAnchorsAndTesselatedPointsFromShape\(([^\n]*)\)\)\s*$/m.exec(
        body,
      );
    expect(call).not.toBeNull();
    const args = call![1].split(",").map((a) => a.trim());
    expect(args).toHaveLength(5);
    expect(args[4]).toBe("anchorIndices");
    expect(body).toContain(
      "SCR_ParallelShapeHelper.SnapRelativePointsToGround(shapeEnt, relPoints)",
    );
    expect(body).toContain("SCR_ParallelShapeHelper.ReducePointsDensity(thinning, relPoints)");
    // asChild: the source is the parent and the copy sits at its origin (SCR_ParallelShapeTool).
    expect(body).toContain(
      'BuildShape(api, shapeClass, "", sourceLayerId, src, vector.Zero, relCopy',
    );
  });
});

// Census rows this file tests (W6 close-out, EV-W6-113).
// census:mcp:handler-action/EMCP_WB_Shape.area
// census:mcp:handler-action/EMCP_WB_Shape.create
// census:mcp:handler-action/EMCP_WB_Shape.import
// census:mcp:handler-action/EMCP_WB_Shape.points

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Shape.edit
// census:mcp:handler-action/EMCP_WB_Shape.parallel
