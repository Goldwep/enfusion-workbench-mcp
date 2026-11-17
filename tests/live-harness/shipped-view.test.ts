/**
 * EMCP_WB_View.c checked over its Enforce text offline (wave W1, phase5-w1-spec.md section 2.3):
 * the contract matches the structs and the dispatch, every action makes the engine calls the spec
 * names (each checked against the 1.9.0.37 index by scripts/enforce-lint.ts), the mutating actions
 * run the project guard and the play-mode check before any engine call, undoable edits sit inside
 * BeginEntityAction / EndEntityAction, and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_View.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_View.json"));

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

/** Offsets of the texts in body, each required to be present. */
function at(body: string, texts: string[]): number[] {
  return texts.map((t) => {
    const i = body.indexOf(t);
    expect(i, t).toBeGreaterThanOrEqual(0);
    return i;
  });
}

const C = code(src);

const READS: Record<string, string> = {
  selection: "ReadSelection",
  camera: "ReadCamera",
  trace: "TracePixel",
  underCursor: "ReadUnderCursor",
};
const EDITS: Record<string, string> = {
  select: "ChangeSelection",
  setVisible: "SetVisibility",
  setCamera: "MoveCamera",
  focus: "FocusEntity",
  placeAtPixel: "PlaceAtPixel",
};

describe("EMCP_WB_View structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_ViewRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ViewResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action to its method and nothing else", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*\n\s*(\w+)\(/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    for (const m of branches) expect(m[2]).toBe({ ...READS, ...EDITS }[m[1]]);
  });

  it("marks exactly the mutating actions projectOnly", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(a.name in EDITS);
      expect(a.projectOnly, a.name).toBe(a.name in EDITS);
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

  it("uses no ternary operator", () => {
    const noStrings = C.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    expect(noStrings).not.toMatch(/\?/);
  });
});

describe("guards", () => {
  it("EditApi: project found, then the World Editor API, then play mode refused", () => {
    const body = method(src, "EditApi");
    const order = at(body, [
      "EMCP_WB_Guard.IsProjectFound()",
      "EMCP_WB_Guard.NOT_IN_PROJECT",
      "EditorApi(resp)",
      "api.IsGameMode()",
      "WRONG_MODE",
    ]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("every mutating action starts with EditApi; no read calls it", () => {
    for (const [action, m] of Object.entries(EDITS)) {
      const body = method(src, m);
      expect(body, action).toMatch(
        /\{\s*WorldEditorAPI api = EditApi\(resp\);\s*if \(!api\)\s*return;/,
      );
    }
    for (const [action, m] of Object.entries(READS)) {
      const body = method(src, m);
      expect(body, action).not.toContain("EditApi(");
      expect(body, action).not.toContain("IsProjectFound");
      expect(body, action).toContain("EditorApi(resp)");
    }
  });

  it("refusals use the guard's status and message form", () => {
    expect(method(src, "Refuse")).toContain("EMCP_WB_Guard.REFUSED");
    expect(method(src, "Answer")).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
    expect(method(src, "Answer")).toContain("resp.next = nextStep;");
  });

  it("entity references resolve through EMCP_WB_EntityRef (a list through one resolver)", () => {
    expect(method(src, "ResolveMany")).toContain("new EMCP_WB_EntityRefResolver(api)");
    expect(method(src, "ResolveMany")).toContain("resolver.Resolve(entityRef,");
    expect(method(src, "FocusEntity")).toContain("EMCP_WB_EntityRef.Resolve(api, req.entity,");
    expect(C).toContain("EMCP_WB_EntityRef.ENTITY_NOT_FOUND");
  });
});

describe("engine calls per action (spec section 2.3)", () => {
  const CALLS: Record<string, string[]> = {
    ReadSelection: [
      "api.GetSelectedEntitiesCount()",
      "api.GetSelectedEntity(i)",
      "api.IsEntitySelectedAsMain(src)",
    ],
    ChangeSelection: [
      "api.SetEntitySelection(",
      "api.AddToEntitySelection(",
      "api.RemoveFromEntitySelection(",
      "api.ClearEntitySelection()",
      "api.UpdateSelectionGui()",
    ],
    SetVisibility: [
      "api.SetEntityVisible(src, visible, recursive)",
      "api.IsEntityVisible(readSrc)",
    ],
    ReadCamera: ["api.GetWorld()", "api.GetScreenWidth()", "api.GetScreenHeight()"],
    CameraOf: ["world.GetCurrentCamera(camMat)", "Math3D.MatrixToAngles(rot)"],
    MoveCamera: ["api.SetCamera(pos, look.Normalized())"],
    FocusEntity: ["api.SourceToEntity(src)", "ent.GetOrigin()", "api.SetCamera(target, look)"],
    TracePixel: [
      "api.TraceWorldPos(px, py, flags, traceStart, traceEnd, traceDir, hitEntity)",
      "api.EntityToSource(hitEntity)",
    ],
    ReadUnderCursor: [
      "api.GetMousePosX(clamped)",
      "api.GetMousePosY(clamped)",
      "api.GetEntityUnderCursor()",
    ],
    PlaceAtPixel: [
      "api.CreateEntityInWindowEx(windowType, px, py, prefab, entityName, layerId)",
      "api.TraceWorldPos(",
      "api.CreateEntity(prefab, entityName, layerId, null, traceEnd, vector.Zero)",
    ],
  };
  for (const [m, calls] of Object.entries(CALLS)) {
    it(`${m} makes ${calls.length} call(s)`, () => {
      const body = method(src, m);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  it("the camera is read back after setCamera and focus", () => {
    for (const m of ["MoveCamera", "FocusEntity"]) {
      const body = method(src, m);
      const set = body.indexOf("api.SetCamera(");
      expect(body.lastIndexOf("EMCP_WB_ViewUtil.CameraOf(")).toBeGreaterThan(set);
      expect(body).toContain("resp.after = ");
    }
    expect(method(src, "MoveCamera").indexOf("resp.before = ")).toBeLessThan(
      method(src, "MoveCamera").indexOf("api.SetCamera("),
    );
  });

  it("focus frames the entity's world bounds and reads the camera before (W1.7 run 6)", () => {
    const body = method(src, "FocusEntity");
    expect(body).toContain("ent.GetWorldBounds(boundsMin, boundsMax);");
    expect(body).toContain("EMCP_WB_ViewUtil.FramingDistance(radius)");
    expect(body).toContain("vector target = centre - look * distance;");
    expect(body.indexOf("resp.before = ")).toBeLessThan(body.indexOf("api.SetCamera("));
    expect(src).toMatch(/static float FramingDistance\(float radius\)/);
  });

  it("select answers the previous selection before it changes it", () => {
    const body = method(src, "ChangeSelection");
    const [prev, clear, set, gui, count] = at(body, [
      "resp.previous.Insert(",
      "api.ClearEntitySelection()",
      "api.SetEntitySelection(",
      "api.UpdateSelectionGui()",
      "resp.selectedCount = api.GetSelectedEntitiesCount()",
    ]);
    expect(prev).toBeLessThan(clear);
    expect(prev).toBeLessThan(set);
    expect(gui).toBeGreaterThan(set);
    expect(count).toBeGreaterThan(gui);
  });

  it("setVisible and placeAtPixel run inside one named entity action", () => {
    for (const [m, undo] of [
      ["SetVisibility", "UNDO_SET_VISIBLE"],
      ["PlaceAtPixel", "UNDO_PLACE"],
    ]) {
      const body = method(src, m);
      // Through BeginEdit, which refuses when no action opened (review round 1, F2).
      const begin = body.indexOf(`if (!BeginEdit(api, ${undo}, resp))`);
      const end = body.indexOf(`api.EndEntityAction(${undo})`);
      expect(begin, m).toBeGreaterThanOrEqual(0);
      expect(end, m).toBeGreaterThan(begin);
      expect(body).toContain(`resp.undoName = ${undo};`);
      const mutate =
        m === "SetVisibility" ? "api.SetEntityVisible(" : "api.CreateEntityInWindowEx(";
      expect(body.indexOf(mutate)).toBeGreaterThan(begin);
      expect(body.indexOf(mutate)).toBeLessThan(end);
    }
    expect(src).toContain('static const string UNDO_SET_VISIBLE = "EMCP wb_view setVisible";');
    expect(src).toContain('static const string UNDO_PLACE = "EMCP wb_view placeAtPixel";');
  });

  it("makes no write of a file and no call the spec does not name", () => {
    for (const banned of [
      "SaveContainer",
      ".Save()",
      "SetVariableValue",
      "DeleteEntit",
      "BeginTerrainAction",
      "FindEntityByID",
    ]) {
      expect(C, banned).not.toContain(banned);
    }
  });
});

describe("paging and refusal codes", () => {
  it("cursor is <start>:<count>; a changed count is STALE_CURSOR; limit 50 default, 200 max", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    const body = method(src, "PageWindow");
    expect(body).toContain('cursor.Split(":", parts, false);');
    expect(body).toMatch(/if \(count != total \|\| at > total\)\s*\{\s*code = "STALE_CURSOR";/);
    expect(method(src, "NextCursor")).toContain('stop.ToString() + ":" + total.ToString()');
    expect(method(src, "ReadSelection")).toContain(
      "EMCP_WB_ViewUtil.PageWindow(req.cursor, req.limit, count, first, stop, code, why)",
    );
  });

  it("answers the W1 codes", () => {
    for (const c of [
      '"WRONG_MODE"',
      '"NO_WORLD"',
      '"ENGINE_FALSE"',
      '"PATH_NOT_FOUND"',
      '"INVALID_ARGUMENT"',
      '"MODULE_NOT_OPEN"',
    ])
      expect(src, c).toContain(c);
  });

  it("answers bools as bools", () => {
    expect(src).toMatch(/\n\s*bool hit;/);
    expect(method(src, "TracePixel")).toContain("resp.hit = hit;");
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:api:WorldEditorAPI.AddToEntitySelection/1
// census:api:WorldEditorAPI.ClearEntitySelection/0
// census:api:WorldEditorAPI.CreateEntityInWindowEx/6
// census:api:WorldEditorAPI.GetEntityUnderCursor/0
// census:api:WorldEditorAPI.GetMousePosX/1
// census:api:WorldEditorAPI.GetMousePosY/1
// census:api:WorldEditorAPI.GetScreenHeight/0
// census:api:WorldEditorAPI.GetScreenWidth/0
// census:api:WorldEditorAPI.GetSelectedEntitiesCount/0
// census:api:WorldEditorAPI.GetSelectedEntity/1
// census:api:WorldEditorAPI.GetWorld/0
// census:api:WorldEditorAPI.IsEntitySelected/1
// census:api:WorldEditorAPI.IsEntitySelectedAsMain/1
// census:api:WorldEditorAPI.IsEntityVisible/1
// census:api:WorldEditorAPI.RemoveFromEntitySelection/1
// census:api:WorldEditorAPI.SetCamera/2
// census:api:WorldEditorAPI.SetEntitySelection/1
// census:api:WorldEditorAPI.SetEntityVisible/3
// census:api:WorldEditorAPI.TraceWorldPos/7
// census:api:WorldEditorAPI.UpdateSelectionGui/0
// census:mcp:handler-action/EMCP_WB_View.camera
// census:mcp:handler-action/EMCP_WB_View.focus
// census:mcp:handler-action/EMCP_WB_View.placeAtPixel
// census:mcp:handler-action/EMCP_WB_View.select
// census:mcp:handler-action/EMCP_WB_View.selection
// census:mcp:handler-action/EMCP_WB_View.setCamera
// census:mcp:handler-action/EMCP_WB_View.setVisible
// census:mcp:handler-action/EMCP_WB_View.trace
// census:mcp:handler-action/EMCP_WB_View.underCursor
// census:ui:WorldEditor/context-item/Hierarchy/entity/Focus Selection
// census:ui:WorldEditor/context-item/Hierarchy/entity/Hide%2FShow
// census:ui:WorldEditor/context-item/Viewport/Focus Selection
// census:ui:WorldEditor/context-item/Viewport/Hide%2FShow
// census:ui:WorldEditor/menu-item/Entities/Focus Selection
// census:ui:WorldEditor/menu-item/Entities/Hide%2FShow
