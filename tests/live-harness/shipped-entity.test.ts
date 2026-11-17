/**
 * EMCP_WB_Entity.c (wave W1, phase5-w1-spec.md section 2.1) checked over its Enforce text
 * offline: the contract matches the structs and the per-action reads and writes, every engine
 * call is the one the spec's action table names (the 1.x entity handlers already make the proven
 * ones), every edit sits behind the project and mode guard and inside one entity action, and no
 * forbidden call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { checkedDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Entity.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Entity.json"));
const old = (name: string) => readFileSync(join(DIR, `EMCP_WB_${name}.c`), "utf-8");

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

const C = code(src);

/** Action -> the method its dispatch branch calls. */
const METHOD: Record<string, string> = {
  list: "ListEntities",
  get: "GetOne",
  children: "ListChildren",
  query: "QueryWorld",
  create: "CreateOne",
  clone: "CloneOne",
  delete: "DeleteMany",
  parent: "ParentMany",
  unparent: "UnparentMany",
  rename: "RenameOne",
  transform: "TransformOne",
  setLayer: "SetLayerMany",
};
const READS = ["list", "get", "children", "query"];
const EDITS = [
  "create",
  "clone",
  "delete",
  "parent",
  "unparent",
  "rename",
  "transform",
  "setLayer",
];

describe("EMCP_WB_Entity structs and contract", () => {
  it("request and response RegV keys are the contract's, in order", () => {
    expect(regVKeys(src, "EMCP_WB_EntityRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_EntityResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action, each to its own method, and nothing else", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*(\w+)\(req, resp\)/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    for (const m of branches) expect(m[2], m[1]).toBe(METHOD[m[1]]);
  });

  it("marks the reads read-only and every edit mutating and project-only; the reads page", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(EDITS.includes(a.name));
      expect(a.projectOnly, a.name).toBe(EDITS.includes(a.name));
      expect(a.paging, a.name).toBe(["list", "children", "query"].includes(a.name));
    }
  });

  it("keeps the tool description within its 400-char budget", () => {
    expect(checkedDescription(contract).length).toBeLessThanOrEqual(400);
  });
});

describe("forbidden calls", () => {
  it("no FindFiles, Dialog, RunCommandline, Configure or FileIO", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    const noStrings = C.replace(/"[^"\n]*"/g, '""');
    for (const banned of [
      "FindFiles",
      "FileIO",
      "Workbench.Dialog",
      "RunCmd",
      "RunCommandline",
      "Configure(",
      "SaveContainer",
      ".Save(",
      "SetOpenedResource",
      "BeginEditSequence",
    ]) {
      expect(noStrings, banned).not.toContain(banned);
    }
  });

  it("names no sandbox and no project", () => {
    expect(src).not.toMatch(/EMCP2_sandbox|_throwaway|sandbox/i);
  });

  it("uses no ternary operator", () => {
    expect(C.replace(/"[^"\n]*"/g, '""')).not.toContain("?");
  });
});

describe("guards", () => {
  it("an edit checks the project, then the API, then play mode, with the guard's codes", () => {
    const body = method(src, "EditApi");
    const project = body.indexOf("EMCP_WB_Guard.IsProjectFound()");
    const api = body.indexOf("EditorApi(resp)");
    const mode = body.indexOf("api.IsGameMode()");
    expect(project).toBeGreaterThanOrEqual(0);
    expect(project).toBeLessThan(api);
    expect(api).toBeLessThan(mode);
    expect(body).toMatch(/Refuse\(resp, EMCP_WB_Guard\.NOT_IN_PROJECT,/);
    expect(body).toMatch(/Refuse\(resp, WRONG_MODE,/);
    expect(src).toContain('static const string WRONG_MODE = "WRONG_MODE";');
  });

  it("a refusal is status refused with the guard's message form", () => {
    expect(method(src, "Refuse")).toContain(
      "Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep)",
    );
    const answer = method(src, "Answer");
    expect(answer).toContain("resp.next = nextStep;");
    expect(answer).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
  });

  it("every edit takes its API from EditApi before any other call", () => {
    for (const a of EDITS) {
      const body = method(src, METHOD[a]);
      const first = body.indexOf("{") + 1;
      expect(body.slice(first).trim().startsWith("WorldEditorAPI api = EditApi(resp);"), a).toBe(
        true,
      );
    }
  });

  it("the reads take no edit guard and open no entity action", () => {
    for (const a of READS) {
      const body = method(src, METHOD[a]);
      expect(body, a).toContain("EditorApi(resp)");
      expect(body, a).not.toContain("EditApi(");
      expect(body, a).not.toContain("BeginEntityAction");
    }
  });

  it("an action that BeginEntityAction did not open is refused ENGINE_FALSE, never ended (review E2)", () => {
    const body = method(src, "BeginEdit");
    expect(body).toContain("if (api.BeginEntityAction(pointName))");
    expect(body).toContain("Refuse(resp, ENGINE_FALSE,");
    expect(body).not.toContain("EndEntityAction");
  });

  it("every edit runs in one entity action with its own undo name, closed before any return", () => {
    for (const a of EDITS) {
      const body = method(src, METHOD[a]);
      expect(body, a).not.toMatch(/api\.BeginEntityAction\(/);
      // The refusal return of a failed begin closes nothing: nothing was opened.
      const begins = [...body.matchAll(/if \(!BeginEdit\(api, (UNDO_\w+), resp\)\)\s*return;/g)];
      expect(begins.length, a).toBe(1);
      const undo = begins[0][1];
      expect(body, a).toContain(`resp.undoName = ${undo};`);
      expect(src, a).toContain(`static const string ${undo} = "EMCP wb_entity ${a}";`);
      const at = (begins[0].index ?? 0) + begins[0][0].length;
      const end = body.indexOf("api.EndEntityAction();", at);
      expect(end, a).toBeGreaterThan(at);
      expect(body.slice(at, end), a).not.toContain("return");
      // Every return after the begin follows an end.
      const ends = [...body.matchAll(/api\.EndEntityAction\(\);/g)].map((m) => m.index ?? 0);
      for (const r of body.slice(at).matchAll(/\breturn\b/g)) {
        const ret = at + (r.index ?? 0);
        expect(
          ends.some((e) => e > at && e < ret),
          `${a}: return at ${ret}`,
        ).toBe(true);
      }
    }
  });
});

describe("engine calls are the spec's (section 2.1)", () => {
  const CALLS: Record<string, string[]> = {
    list: ["api.GetEditorEntityCount()", "api.GetEditorEntity(i)", "Page(req, resp, api, items"],
    get: [
      "api.GetEntityNiceName(src)",
      "api.SourceToEntity(src)",
      "ent.GetOrigin()",
      "src.GetComponentCount()",
      "src.GetComponent(c)",
    ],
    children: ["src.GetNumChildren()", "src.GetChild(i)", "childCont.ToEntitySource()"],
    query: [
      "api.GetWorld()",
      "world.QueryEntitiesBySphere(first, radiusValue, collector.AddEntity, null, EQueryEntitiesFlags.ALL)",
      "world.QueryEntitiesByAABB(first, second, collector.AddEntity, null, EQueryEntitiesFlags.ALL)",
      "api.EntityToSource(",
    ],
    create: [
      "api.CreateEntity(req.prefab, req.name, layerId, parentSrc, pos, rot)",
      "api.CreateEntityExt(req.prefab, req.name, layerId, parentSrc, pos, rot, traceFlags)",
    ],
    clone: ["api.CreateClonedEntity(src, req.name, parentSrc, req.cloneChildren)"],
    delete: ["api.DeleteEntity(found.Get(0))", "api.DeleteEntities(found)"],
    parent: [
      "api.ParentEntity(parentSrc, found.Get(0), toParentSpace)",
      "api.ParentEntities(parentSrc, found, toParentSpace)",
    ],
    unparent: ["api.RemoveEntityFromParent(child)"],
    rename: ["api.RenameEntity(src, req.name)"],
    transform: [
      'api.SetVariableValue(src, null, "coords", ',
      'api.SetVariableValue(src, null, "angles", ',
      'api.SetVariableValue(src, null, "scale", ',
    ],
    setLayer: [
      "api.SetEntitySubsceneLayer(targetSubScene, src, req.layer)",
      "api.GetEntitySubsceneLayer(targetSubScene, firstMoved)",
    ],
  };
  for (const [a, calls] of Object.entries(CALLS)) {
    it(a, () => {
      const body = method(src, METHOD[a]);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  it("delete and parent use the bulk call only for more than one entity", () => {
    expect(method(src, "DeleteMany")).toMatch(
      /if \(found\.Count\(\) == 1\)\s*deletedOk = api\.DeleteEntity\(found\.Get\(0\)\);\s*else\s*deletedOk = api\.DeleteEntities\(found\);/,
    );
    expect(method(src, "ParentMany")).toMatch(
      /if \(found\.Count\(\) == 1\)\s*parentedOk = api\.ParentEntity\([^;]*\);\s*else\s*parentedOk = api\.ParentEntities\(/,
    );
  });

  // Calls the removed 1.x EMCP_WB_ListEntities and EMCP_WB_GetEntity made (OD-1, session 023):
  // no 1.x text to compare with any more; W1 run 4 made them live itself (w1-12, w1-20).
  for (const mine of [
    "Workbench.GetModule(WorldEditor)",
    "worldEditor.GetApi()",
    "api.GetEditorEntityCount()",
    "api.SourceToEntity(src)",
    "src.GetComponent(c)",
  ])
    it(`${mine} (proven live by W1 run 4)`, () => expect(C).toContain(mine));

  // [call here, 1.x handler that already makes it live, the text there]
  const PROVEN: Array<[string, string, string]> = [
    ["api.CreateEntity(", "CreateEntity", "api.CreateEntity(req.prefab, entityName"],
    ["api.DeleteEntity(", "DeleteEntity", "api.DeleteEntity(entSrc)"],
    ["api.RenameEntity(", "ModifyEntity", "api.RenameEntity(entSrc, req.value)"],
    ["api.ParentEntity(", "ModifyEntity", "api.ParentEntity(parentSrc, entSrc, false)"],
    ["api.SetVariableValue(src, null, ", "ModifyEntity", "api.SetVariableValue(entSrc, null, "],
    ['src.Get("coords", pos)', "ModifyEntity", 'entSrc.Get("coords", coords)'],
    ["api.BeginEntityAction(", "CreateEntity", 'api.BeginEntityAction("CC: Create entity'],
    ["api.EndEntityAction();", "CreateEntity", "api.EndEntityAction();"],
  ];
  for (const [mine, where, theirs] of PROVEN) {
    it(`${mine} (as EMCP_WB_${where} makes it)`, () => {
      expect(C).toContain(mine);
      expect(code(old(where))).toContain(theirs);
    });
  }

  it("names entities through EMCP_WB_EntityRef only", () => {
    expect(C).toContain("EMCP_WB_EntityRef.Resolve(api, entityRef, resolved)");
    expect(C).toContain("resolver.Resolve(entityRef, resolved)");
    expect(C).toContain("EMCP_WB_EntityRef.Format(src)");
    expect(C).not.toContain("FindEntityByName");
    expect(C).not.toContain("FindEntityByID");
  });
});

describe("paging and refs", () => {
  it("limit default 50, max 200; at most 200 refs per call", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    expect(src).toContain("static const int MAX_REFS = 200;");
    for (const a of ["list", "children", "query"]) {
      const limit = contract.actions
        .find((x) => x.name === a)
        ?.params.find((p) => p.key === "limit");
      expect(limit?.note, a).toBe("default 50, max 200");
    }
  });

  it("the cursor is <start>:<count> and a changed total answers STALE_CURSOR", () => {
    const page = method(src, "Page");
    expect(page).toContain("ParseCursor(req.cursor, start, issuedFor)");
    expect(page).toMatch(/if \(issuedFor != total\)\s*\{\s*Answer\(resp, "error", STALE_CURSOR,/);
    expect(page).toContain('resp.nextCursor = end.ToString() + ":" + total.ToString();');
    expect(src).toContain('static const string STALE_CURSOR = "STALE_CURSOR";');
    const parse = method(src, "ParseCursor");
    expect(parse).toContain('cursorText.IndexOf(":")');
    expect(parse).toContain("if (startValue > countValue)");
  });

  it("list, children and query all page through Page", () => {
    for (const a of ["list", "children", "query"])
      expect(method(src, METHOD[a]), a).toMatch(/Page\(req, resp, api, items, "[^"]+"\);/);
  });

  it("a malformed ref fails the whole call; an unknown one goes to missing", () => {
    const many = method(src, "ResolveMany");
    expect(many).toContain("refCode == EMCP_WB_EntityRef.ENTITY_NOT_FOUND");
    expect(many).toContain("missingRefs.Insert(entityRef);");
    expect(many).toContain("refs.Count() > MAX_REFS");
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:api:WorldEditorAPI.BeginEntityAction/3
// census:api:WorldEditorAPI.CreateClonedEntity/4
// census:api:WorldEditorAPI.CreateEntity/6
// census:api:WorldEditorAPI.CreateEntityExt/7
// census:api:WorldEditorAPI.DeleteEntities/1
// census:api:WorldEditorAPI.DeleteEntity/1
// census:api:WorldEditorAPI.EndEntityAction/1
// census:api:WorldEditorAPI.EntityToSource/1
// census:api:WorldEditorAPI.FindEntityByName/1
// census:api:WorldEditorAPI.GetEditorEntity/1
// census:api:WorldEditorAPI.GetEditorEntityCount/0
// census:api:WorldEditorAPI.GetEntityNiceName/1
// census:api:WorldEditorAPI.GetEntitySubsceneLayer/2
// census:api:WorldEditorAPI.ParentEntities/3
// census:api:WorldEditorAPI.ParentEntity/3
// census:api:WorldEditorAPI.RemoveEntityFromParent/1
// census:api:WorldEditorAPI.RenameEntity/2
// census:api:WorldEditorAPI.SetEntitySubsceneLayer/3
// census:api:WorldEditorAPI.SetVariableValue/4
// census:api:WorldEditorAPI.SourceToEntity/1
// census:mcp:handler-action/EMCP_WB_Entity.children
// census:mcp:handler-action/EMCP_WB_Entity.clone
// census:mcp:handler-action/EMCP_WB_Entity.create
// census:mcp:handler-action/EMCP_WB_Entity.delete
// census:mcp:handler-action/EMCP_WB_Entity.get
// census:mcp:handler-action/EMCP_WB_Entity.list
// census:mcp:handler-action/EMCP_WB_Entity.parent
// census:mcp:handler-action/EMCP_WB_Entity.query
// census:mcp:handler-action/EMCP_WB_Entity.rename
// census:mcp:handler-action/EMCP_WB_Entity.setLayer
// census:mcp:handler-action/EMCP_WB_Entity.transform
// census:mcp:handler-action/EMCP_WB_Entity.unparent
// census:ui:WorldEditor/context-item/Hierarchy/entity/Remove from Parent
// census:ui:WorldEditor/context-item/Hierarchy/entity/Rename
// census:ui:WorldEditor/context-item/Hierarchy/entity/Set Layer
// census:ui:WorldEditor/context-item/Hierarchy/entity/Set Parent
// census:ui:WorldEditor/context-item/Viewport/Remove from Parent
// census:ui:WorldEditor/context-item/Viewport/Rename
// census:ui:WorldEditor/context-item/Viewport/Set Layer
// census:ui:WorldEditor/context-item/Viewport/Set Parent
// census:ui:WorldEditor/menu-item/Entities/Add Child Prefab/To World
// census:ui:WorldEditor/menu-item/Entities/Delete/From World Delete
// census:ui:WorldEditor/menu-item/Entities/Remove from Parent
// census:ui:WorldEditor/menu-item/Entities/Rename
// census:ui:WorldEditor/menu-item/Entities/Set Layer
// census:ui:WorldEditor/menu-item/Entities/Set Parent
