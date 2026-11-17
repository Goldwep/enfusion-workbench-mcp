/**
 * The W1 Prefabs handler (EMCP_WB_Prefabs.c) checked over its Enforce text offline
 * (phase5-w1-spec.md section 2.7, DEC-061): the contract matches the structs and the dispatch, the
 * file writes are guarded (project, target, confirm) and the in-memory edits are undo steps refused
 * in play mode, the engine calls are the spec's, and no file method is called (the SCR_PrefabHelper
 * clone and child calls are made without the helper, which calls FileIO). Nothing here talks to
 * Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Prefabs.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Prefabs.json"));

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

/** All texts present in body, in the given order. */
function inOrder(body: string, texts: string[], label: string): void {
  const at = texts.map((t) => body.indexOf(t));
  texts.forEach((t, i) => expect(at[i], `${label}: ${t}`).toBeGreaterThanOrEqual(0));
  expect(
    [...at].sort((a, b) => a - b),
    label,
  ).toEqual(at);
}

const c = code(src);

describe("EMCP_WB_Prefabs structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_PrefabsRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_PrefabsResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
  });

  it("the 1.x keys are gone (entity references replace entityName; no addonName)", () => {
    expect(c).not.toMatch(/entityName|templatePath|addonName|FindEntityByName/);
  });

  it("reads are not project-only; every mutating action is", () => {
    for (const a of contract.actions) {
      const read = a.name === "getAncestor" || a.name === "editState";
      expect(a.mutating, a.name).toBe(!read);
      expect(a.projectOnly, a.name).toBe(!read);
    }
  });
});

describe("no banned call", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, Configure or FileIO, and not the FileIO helpers", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "RunCommandline",
      "RunCmd",
      "Configure(",
      "FileIO",
      "MakeDirectory",
      "SCR_PrefabHelper.",
      "EMCP2_sandbox",
      "_throwaway",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });
});

describe("file writes: project, target, dry run, then the engine", () => {
  it("a new prefab target is clean, an .et, inside the project with its folder, and not there yet", () => {
    const body = method(src, "NewPrefabTarget");
    inOrder(
      body,
      [
        "EMCP_WB_Guard.CleanRelative(rel, clean, why)",
        "lower.EndsWith(PREFAB_EXT)",
        "EMCP_WB_Guard.NewTargetInProject(clean, absolute, why)",
        'Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, existing, true)',
      ],
      "NewPrefabTarget",
    );
    expect(src).toContain('static const string PREFAB_EXT = ".et";');
  });

  it("createTemplate, clone and createChild: guards before confirm before the write", () => {
    const steps: Record<string, string[]> = {
      CreateTemplate: [
        "EMCP_WB_PrefabsUtil.ProjectRefused(resp)",
        "EMCP_WB_PrefabsUtil.PlayRefused(api, resp)",
        "EMCP_WB_EntityRef.Resolve(api, req.entity, resolved)",
        "EMCP_WB_PrefabsUtil.NewPrefabTarget(req.path, resp, absolute, clean)",
        "if (!req.confirm)",
        "EMCP_WB_PrefabsUtil.BeginEdit(api, ",
        "api.CreateEntityTemplate(src, absolute)",
        "api.EndEntityAction()",
      ],
      FromPrefab: [
        "EMCP_WB_PrefabsUtil.ProjectRefused(resp)",
        "EMCP_WB_PrefabsUtil.PlayRefused(api, resp)",
        "EMCP_WB_PrefabsUtil.NewPrefabTarget(req.path, resp, absolute, clean)",
        "if (!req.confirm)",
        "EMCP_WB_PrefabsUtil.BeginEdit(api, ",
        'api.CreateEntity(source, "", api.GetCurrentEntityLayerId(), null, vector.Zero, vector.Zero)',
        "api.CreateEntityTemplate(templateSource, absolute)",
        "api.DeleteEntity(instance)",
      ],
    };
    for (const [m, order] of Object.entries(steps)) inOrder(method(src, m), order, m);
    expect(method(src, "FromPrefab")).toContain(
      "templateSource = EMCP_WB_PrefabsUtil.AncestorSource(instance);",
    );
    expect(c).toContain("FromPrefab(req, resp, true)");
    expect(c).toContain("FromPrefab(req, resp, false)");
  });

  it("save: the prefab's file must already be a file of the project; dry run unless confirm", () => {
    inOrder(
      method(src, "SaveTemplate"),
      [
        "EMCP_WB_PrefabsUtil.ProjectRefused(resp)",
        "EMCP_WB_PrefabsUtil.PlayRefused(api, resp)",
        "SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource()",
        "EMCP_WB_PrefabsUtil.AncestorName(src)",
        "EMCP_WB_Guard.TargetExistsInProject(prefabPath, absolute, why)",
        "if (!req.confirm)",
        "EMCP_WB_PrefabsUtil.AncestorSource(src)",
        "!api.IsDoingEditAction()",
        "api.SaveEntityTemplate(prefabSide)",
      ],
      "SaveTemplate",
    );
  });

  it("every dry run says nothing was written", () => {
    for (const m of ["CreateTemplate", "SaveTemplate", "FromPrefab"]) {
      const body = method(src, m);
      expect(body, m).toContain("resp.dryRun = true;");
      expect(body, m).toContain("nothing was written");
    }
  });
});

describe("in-memory prefab edits", () => {
  it("members need prefab edit mode; all three are one undo step refused in play mode", () => {
    const calls: Record<string, string> = {
      AddMembers: "api.AddPrefabMembers(prefabSide, sources)",
      RemoveMembers: "api.RemovePrefabMembers(sources)",
      MoveToPrefab: "api.MoveEntitiesToPrefab(instance, inPrefab, sources, convert)",
    };
    for (const [m, call] of Object.entries(calls)) {
      const body = method(src, m);
      const order = [
        "EMCP_WB_PrefabsUtil.ProjectRefused(resp)",
        "EMCP_WB_PrefabsUtil.PlayRefused(api, resp)",
      ];
      if (m !== "MoveToPrefab") order.push("EMCP_WB_PrefabsUtil.NotPrefabEditRefused(resp)");
      if (m === "AddMembers")
        order.push("BaseContainerTools.CreateContainer(", "sources.Insert(fresh)");
      else if (m === "RemoveMembers")
        order.push(
          "EMCP_WB_PrefabsUtil.ResolveMany(api, req.entities, resp, instances, ids)",
          "EMCP_WB_PrefabsUtil.PrefabSideMember(",
          "if (sources.Count() == 0)",
        );
      else
        order.push(
          "EMCP_WB_PrefabsUtil.ResolveMany(api, req.entities, resp, sources, ids)",
          "EMCP_WB_PrefabsUtil.InHierarchyOf(",
        );
      order.push(
        "if (!EMCP_WB_PrefabsUtil.BeginEdit(api, undo, resp))",
        "resp.undoName = undo;",
        call,
        "api.EndEntityAction()",
      );
      inOrder(body, order, m);
      expect(body, m).not.toContain("api.BeginEntityAction(");
    }
    // A begin that opened no action is refused ENGINE_FALSE and never ended (review P2).
    const begin = method(src, "BeginEdit");
    expect(begin).toContain("if (api.BeginEntityAction(pointName))");
    expect(begin).toContain('Refuse(resp, "ENGINE_FALSE",');
    expect(begin).not.toContain("EndEntityAction");
    // The ancestor's entity source by ToEntitySource, not IEntitySource.Cast (review P1).
    expect(method(src, "AncestorSource")).toContain("return ancestor.ToEntitySource();");
    expect(src).not.toContain("IEntitySource.Cast(");
    expect(method(src, "NotPrefabEditRefused")).toContain("worldEditor.IsPrefabEditMode()");
  });

  it("ResolveMany caps at 200 references and resolves them through one EMCP_WB_EntityRefResolver", () => {
    expect(src).toContain("static const int MAX_ENTITIES = 200;");
    const body = method(src, "ResolveMany");
    expect(body).toContain("refs.Count() > MAX_ENTITIES");
    expect(body).toContain(
      "EMCP_WB_EntityRefResolver resolver = new EMCP_WB_EntityRefResolver(api);",
    );
    expect(body).toContain("resolver.Resolve(refs.Get(i), resolved)");
  });

  it("fix-up 2: member calls take the vanilla shapes; nothing unchecked reaches the engine", () => {
    // RemovePrefabMembers crashed Workbench with a world entity: each entity is mapped to the
    // prefab-side child at its index under the parent instance and must be its own ancestor.
    inOrder(
      method(src, "PrefabSideMember"),
      [
        "instanceChild.GetParent()",
        "AncestorSource(parentSrc)",
        "parentSrc.GetChild(i)",
        "index >= prefabSide.GetNumChildren()",
        "prefabSide.GetChild(index)",
        "AncestorSource(instanceChild)",
        "member != ownAncestor",
      ],
      "PrefabSideMember",
    );
    // AddPrefabMembers gets a fresh container with the prefab as ancestor, on the prefab side.
    inOrder(
      method(src, "AddMembers"),
      [
        "EMCP_WB_PrefabsUtil.IsPrefabName(prefabName)",
        "EMCP_WB_PrefabsUtil.AncestorSource(resolved.m_Src)",
        'BaseContainerTools.CreateContainer("GenericEntity")',
        "fresh.SetAncestor(prefabName)",
        "api.AddPrefabMembers(prefabSide, sources)",
      ],
      "AddMembers",
    );
    expect(method(src, "AddMembers")).not.toContain("ResolveMany");
    // Every file write that opens an entity action reports its undo step (the battery counts it).
    for (const m of ["CreateTemplate", "FromPrefab"])
      inOrder(method(src, m), ["BeginEdit(api, undo, resp)", "resp.undoName = undo;"], m);
  });

  it("editState reads prefab edit mode and the helper's root", () => {
    const body = method(src, "EditState");
    expect(body).toContain("worldEditor.IsPrefabEditMode()");
    expect(body).toContain("SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource()");
    expect(body).not.toMatch(/BeginEntityAction|ProjectRefused/);
  });
});

describe("refusals", () => {
  it("Refuse uses the guard's status and message form with next set", () => {
    const body = method(src, "Refuse");
    expect(body).toContain("resp.status = EMCP_WB_Guard.REFUSED;");
    expect(body).toContain("resp.next = nextStep;");
    expect(body).toContain("EMCP_WB_Guard.RefusalMessage(code,");
  });

  it("every literal refusal code is in the vocabulary", () => {
    const codes = [
      ...c.matchAll(/(?:Refuse\(resp, |resp\.code = |RefusalMessage\()"([A-Z_]+)"/g),
    ].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    for (const k of codes) expect(Object.keys(ERROR_CODES), k).toContain(k);
    for (const k of [
      "WRONG_MODE",
      "NO_WORLD",
      "MODULE_NOT_OPEN",
      "ENGINE_FALSE",
      "INVALID_ARGUMENT",
    ])
      expect(codes, k).toContain(k);
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:api:SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource/0
// census:api:WorldEditor.IsPrefabEditMode/0
// census:api:WorldEditorAPI.AddPrefabMembers/2
// census:api:WorldEditorAPI.CreateEntityTemplate/2
// census:api:WorldEditorAPI.MoveEntitiesToPrefab/4
// census:api:WorldEditorAPI.RemovePrefabMembers/1
// census:api:WorldEditorAPI.SaveEntityTemplate/1
// census:mcp:handler-action/EMCP_WB_Prefabs.addMembers
// census:mcp:handler-action/EMCP_WB_Prefabs.clone
// census:mcp:handler-action/EMCP_WB_Prefabs.createChild
// census:mcp:handler-action/EMCP_WB_Prefabs.createTemplate
// census:mcp:handler-action/EMCP_WB_Prefabs.editState
// census:mcp:handler-action/EMCP_WB_Prefabs.getAncestor
// census:mcp:handler-action/EMCP_WB_Prefabs.moveToPrefab
// census:mcp:handler-action/EMCP_WB_Prefabs.removeMembers
// census:mcp:handler-action/EMCP_WB_Prefabs.save
// census:ui:WorldEditor/context-item/Hierarchy/entity/Apply Changes to Prefab
// census:ui:WorldEditor/context-item/Viewport/Apply Changes to Prefab
// census:ui:WorldEditor/menu-item/Entities/Add Child Prefab/To Prefab
// census:ui:WorldEditor/menu-item/Entities/Apply Changes to Prefab
// census:ui:WorldEditor/menu-item/Entities/Delete/From Prefab Shift+Delete
