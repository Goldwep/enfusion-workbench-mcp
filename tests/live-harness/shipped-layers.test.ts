/**
 * EMCP_WB_Layers.c checked over its Enforce text offline (wave W1, phase5-w1-spec.md section 2.4):
 * one action surface (OD-6: the 1.x names are mapped in TypeScript), the contract matches the
 * structs and the dispatch, every action makes the engine calls the spec names (each checked
 * against the 1.9.0.37 index by scripts/enforce-lint.ts), the mutating actions run the project
 * guard and the play-mode check first, structural edits sit inside BeginEntityAction /
 * EndEntityAction, and a delete of a layer that holds entities is a dry run without confirm.
 * Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Layers.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Layers.json"));

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

const READS: Record<string, string> = { list: "ListLayers", tree: "ReadTree" };
const EDITS: Record<string, string> = {
  create: "CreateLayer",
  createFolder: "CreateFolder",
  rename: "RenameItem",
  delete: "DeleteItem",
  move: "MoveItem",
  setActive: "SetActive",
  lock: "SetLocked",
  unlock: "SetLocked",
};

describe("EMCP_WB_Layers structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_LayersRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_LayersResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action to its method and nothing else (OD-6)", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*\n\s*(\w+)\(/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    for (const m of branches) expect(m[2]).toBe({ ...READS, ...EDITS }[m[1]]);
    for (const old of ["getActive", "getEntityLayer", "isVisible", "getInfo", "toggleLock"])
      expect(C, old).not.toContain(`"${old}"`);
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
      "SaveContainer",
      ".Save()",
    ]) {
      expect(C, banned).not.toContain(banned);
    }
  });

  it("uses no ternary operator", () => {
    const noStrings = C.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    expect(noStrings).not.toMatch(/\?/);
  });

  it("does not call the 1.8 layer calls that 1.9 lacks", () => {
    for (const gone of ["RenameSubsceneLayer", "DeleteSubsceneLayer", "SetSubsceneLayerParent"])
      expect(C, gone).not.toContain(gone);
  });
});

describe("guards", () => {
  it("EditApi: project found, then the World Editor API, then play mode refused", () => {
    const body = method(src, "EditApi");
    const order = [
      "EMCP_WB_Guard.IsProjectFound()",
      "EMCP_WB_Guard.NOT_IN_PROJECT",
      "EditorApi(resp)",
      "api.IsGameMode()",
      "WRONG_MODE",
    ].map((t) => body.indexOf(t));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("every mutating action starts with EditApi; no read calls it", () => {
    for (const m of new Set(Object.values(EDITS))) {
      expect(method(src, m), m).toMatch(
        /\{\s*WorldEditorAPI api = EditApi\(resp\);\s*if \(!api\)\s*return;/,
      );
    }
    for (const m of Object.values(READS)) {
      const body = method(src, m);
      expect(body, m).not.toContain("EditApi(");
      expect(body, m).not.toContain("IsProjectFound");
      expect(body, m).toContain("EditorApi(resp)");
    }
  });

  it("refusals use the guard's status and message form", () => {
    expect(method(src, "Refuse")).toContain("EMCP_WB_Guard.REFUSED");
    expect(method(src, "Answer")).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
  });

  it("a sub-scene out of range is refused; the current one when left out", () => {
    const body = method(src, "SubSceneOf");
    expect(body).toContain("api.GetCurrentSubScene()");
    expect(body).toContain("api.GetNumSubScenes()");
    expect(body).toContain("INVALID_ARGUMENT");
    expect(src).toMatch(/subScene = -1;/);
  });
});

describe("engine calls per action (spec section 2.4)", () => {
  const CALLS: Record<string, string[]> = {
    ListLayers: [
      "api.GetSubsceneLayerPath(sub, lid)",
      "EMCP_WB_LayersUtil.LayerIdOf(api, sub, item)",
      "api.IsEntityLayerVisible(sub, lid)",
      "api.IsEntityLayerLocked(sub, lid)",
    ],
    ReadTree: [
      "api.GetNumSubScenes()",
      "EMCP_WB_LayersUtil.LayerIdOf(api, s, item)",
      "api.IsSubsceneLayerVisible(s, item)",
      "api.IsEntityLayerLocked(s, itemId)",
      "api.IsEntityLayerLockedHierarchy(s, itemId)",
      "api.GetActiveSubsceneLayer(current)",
    ],
    LayerIdOf: ["api.GetSubsceneLayerId(sub, path)", "api.GetSubsceneLayerPath(sub, lid)"],
    ItemPaths: ["api.GetSubsceneFolders(sub, outPaths)"],
    EntityCounts: ["api.GetEditorEntity(i)", "src.GetSubScene()", "src.GetLayerID()"],
    CreateLayer: ["api.CreateSubsceneLayer(sub, itemName, parentPath)"],
    CreateFolder: ["api.CreateSubsceneFolder(sub, itemName, parentPath)"],
    RenameItem: ["api.RenameSubsceneFolder(sub, path, itemName)"],
    DeleteItem: ["api.DeleteSubsceneFolder(sub, path)"],
    MoveItem: ["api.SetSubsceneFolderParent(sub, path, parentPath)"],
    SetActive: ["api.SetActiveSubsceneLayer(sub, path)", "api.GetActiveSubsceneLayer(sub)"],
    SetLocked: [
      "EMCP_WB_LayersUtil.LayerIdOf(api, sub, path)",
      "api.LockEntityLayer(sub, lid)",
      "api.UnlockEntityLayer(sub, lid)",
      "api.IsEntityLayerLocked(sub, lid)",
    ],
  };
  for (const [m, calls] of Object.entries(CALLS)) {
    it(`${m} makes ${calls.length} call(s)`, () => {
      const body = method(src, m);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  const WRAPPED: Array<[string, string, string]> = [
    ["CreateLayer", "UNDO_CREATE", "api.CreateSubsceneLayer("],
    ["CreateFolder", "UNDO_CREATE_FOLDER", "api.CreateSubsceneFolder("],
    ["RenameItem", "UNDO_RENAME", "api.RenameSubsceneFolder("],
    ["DeleteItem", "UNDO_DELETE", "api.DeleteSubsceneFolder("],
    ["MoveItem", "UNDO_MOVE", "api.SetSubsceneFolderParent("],
  ];
  for (const [m, undo, call] of WRAPPED) {
    it(`${m} runs ${call} inside one named entity action`, () => {
      const body = method(src, m);
      const begin = body.indexOf(`api.BeginEntityAction(${undo})`);
      const end = body.indexOf(`api.EndEntityAction(${undo})`);
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(body.indexOf(call)).toBeGreaterThan(begin);
      expect(end).toBeGreaterThan(body.indexOf(call));
      expect(body).toContain(`resp.undoName = ${undo};`);
    });
  }

  // W1.7 run 7 (1.9.0.37): DeleteSubsceneFolder on a layer holding W1_D1 answered true and left a
  // pathless layer still holding the entity; the save then dropped it.
  describe("delete: refuses a non-empty item unless withContents (W1.7 run 7)", () => {
    const body = method(src, "DeleteItem");
    const at = (s: string) => body.indexOf(s);

    it("reads what the item holds before any engine write", () => {
      expect(
        at("EMCP_WB_LayersUtil.Contents(api, sub, path, layerIds, childItems)"),
      ).toBeGreaterThan(0);
      expect(at("EMCP_WB_LayersUtil.EntitiesOn(api, sub, layerIds, held)")).toBeGreaterThan(
        at("EMCP_WB_LayersUtil.Contents("),
      );
      expect(at("EMCP_WB_LayersUtil.EntitiesOn(")).toBeLessThan(at("api.BeginEntityAction("));
    });

    it("entities or child items without withContents: NOT_EMPTY, nothing sent to the engine", () => {
      const gate = at("if ((heldCount > 0 || childTotal > 0) && !req.withContents)");
      expect(gate).toBeGreaterThan(0);
      expect(gate).toBeLessThan(at("api.BeginEntityAction("));
      expect(body.slice(gate, at("api.BeginEntityAction("))).toMatch(
        /Refuse\(resp, NOT_EMPTY, [\s\S]*NEXT_NOT_EMPTY\);\s*return;/,
      );
      expect(src).toContain('static const string NOT_EMPTY = "NOT_EMPTY";');
      expect(src).toMatch(/NEXT_NOT_EMPTY = "[^"]*withContents true and confirm true/);
    });

    it("an entity elsewhere under a held entity is refused; withContents without confirm is a dry run", () => {
      const foreign = at("EMCP_WB_LayersUtil.ForeignDescendant(api, held)");
      const dry = at("if (heldCount > 0 && !req.confirm)");
      const begin = at("api.BeginEntityAction(");
      expect(foreign).toBeGreaterThan(at("!req.withContents"));
      expect(dry).toBeGreaterThan(foreign);
      expect(begin).toBeGreaterThan(dry);
      expect(body.slice(dry, begin)).toMatch(/resp\.dryRun = true;[\s\S]*return;/);
    });

    it("refuses when it cannot open its own action: one undo must restore it all", () => {
      expect(body).toMatch(
        /if \(!api\.BeginEntityAction\(UNDO_DELETE\)\)\s*\{\s*resp\.undoName = "";\s*Refuse\(resp, ENGINE_FALSE, "BeginEntityAction returned false[^\n]*\n\s*return;/,
      );
    });

    it("withContents: entities, then child items deepest first, then the item, inside one action", () => {
      const begin = at("api.BeginEntityAction(UNDO_DELETE)");
      const one = at("api.DeleteEntity(top.Get(0))");
      const many = at("api.DeleteEntities(top)");
      const child = at("api.DeleteSubsceneFolder(sub, child)");
      const item = at("deleted = api.DeleteSubsceneFolder(sub, path)");
      const end = at("api.EndEntityAction(UNDO_DELETE)");
      expect(one).toBeGreaterThan(begin);
      expect(many).toBeGreaterThan(one);
      expect(child).toBeGreaterThan(many);
      expect(item).toBeGreaterThan(child);
      expect(end).toBeGreaterThan(item);
      // The top-most held entities: a held child goes with its held parent.
      expect(at("EMCP_WB_LayersUtil.TopOf(held, top)")).toBeLessThan(begin);
      // No deleted source is read after the delete.
      expect(body.slice(many, end)).toContain("held.Clear();");
      expect(method(src, "Contents")).toContain("for (int level = deepest; level >= 0; level--)");
    });

    it("reads back: no item, no child item, no entity left on a removed layer id, the count fell by what it held", () => {
      const end = at("api.EndEntityAction(UNDO_DELETE)");
      const tail = body.slice(end);
      expect(tail).toContain("resp.entitiesDeleted = countBefore - api.GetEditorEntityCount();");
      expect(tail).toContain("EMCP_WB_LayersUtil.Exists(api, sub, path)");
      expect(tail).toContain("EMCP_WB_LayersUtil.Exists(api, sub, gone)");
      expect(tail).toContain("EMCP_WB_LayersUtil.LeftOn(api, sub, layerIds)");
      expect(tail).toContain("if (resp.entitiesDeleted != heldCount)");
      expect(tail).toMatch(/if \(left != ""\)\s*\{\s*Answer\(resp, "error", ENGINE_FALSE,/);
    });

    it("the request and response carry withContents, childCount and entitiesDeleted", () => {
      expect(src).toContain('RegV("withContents");');
      expect(src).toContain("withContents = false;");
      expect(src).toContain('RegV("childCount");');
      expect(src).toContain('RegV("entitiesDeleted");');
    });
  });

  it("lock and unlock read the lock state back", () => {
    const body = method(src, "SetLocked");
    expect(body.indexOf("api.IsEntityLayerLocked(sub, lid)")).toBeGreaterThan(
      body.indexOf("api.UnlockEntityLayer(sub, lid)"),
    );
    expect(body).toContain("resp.layerLocked = now;");
  });
});

describe("paging and refusal codes", () => {
  it("cursor is <start>:<count>; a changed count is STALE_CURSOR; limit 50 default, 200 max", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    const body = method(src, "PageWindow");
    expect(body).toMatch(/if \(count != total \|\| at > total\)\s*\{\s*code = "STALE_CURSOR";/);
    expect(method(src, "ReadTree")).toContain(
      "EMCP_WB_LayersUtil.PageWindow(req.cursor, req.limit, total, first, stop, code, why)",
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
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:api:WorldEditorAPI.CreateSubsceneFolder/3
// census:api:WorldEditorAPI.CreateSubsceneLayer/3
// census:api:WorldEditorAPI.DeleteSubsceneFolder/2
// census:api:WorldEditorAPI.GetActiveSubsceneLayer/1
// census:api:WorldEditorAPI.GetCurrentEntityLayerId/0
// census:api:WorldEditorAPI.GetCurrentSubScene/0
// census:api:WorldEditorAPI.GetNumSubScenes/0
// census:api:WorldEditorAPI.GetSubsceneFolders/2
// census:api:WorldEditorAPI.GetSubsceneLayerId/2
// census:api:WorldEditorAPI.GetSubsceneLayerPath/2
// census:api:WorldEditorAPI.IsEntityLayerLocked/2
// census:api:WorldEditorAPI.IsEntityLayerLockedHierarchy/2
// census:api:WorldEditorAPI.IsEntityLayerVisible/2
// census:api:WorldEditorAPI.IsSubsceneLayerVisible/2
// census:api:WorldEditorAPI.LockEntityLayer/2
// census:api:WorldEditorAPI.RenameSubsceneFolder/3
// census:api:WorldEditorAPI.SetActiveSubsceneLayer/2
// census:api:WorldEditorAPI.SetSubsceneFolderParent/3
// census:api:WorldEditorAPI.UnlockEntityLayer/2
// census:mcp:handler-action/EMCP_WB_Layers.create
// census:mcp:handler-action/EMCP_WB_Layers.createFolder
// census:mcp:handler-action/EMCP_WB_Layers.delete
// census:mcp:handler-action/EMCP_WB_Layers.list
// census:mcp:handler-action/EMCP_WB_Layers.lock
// census:mcp:handler-action/EMCP_WB_Layers.move
// census:mcp:handler-action/EMCP_WB_Layers.rename
// census:mcp:handler-action/EMCP_WB_Layers.setActive
// census:mcp:handler-action/EMCP_WB_Layers.tree
// census:mcp:handler-action/EMCP_WB_Layers.unlock
// census:ui:WorldEditor/context-item/Hierarchy/default/Lock
// census:ui:WorldEditor/context-item/Hierarchy/default/Rename
// census:ui:WorldEditor/context-item/Hierarchy/default/Set as active
// census:ui:WorldEditor/context-item/Hierarchy/world/Create folder
// census:ui:WorldEditor/context-item/Hierarchy/world/Create layer
