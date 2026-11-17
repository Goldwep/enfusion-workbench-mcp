/**
 * The W2 Resources handler (EMCP_WB_Resources.c) checked over its Enforce text offline
 * (phase5-w2-spec.md section 2.1, DEC-063): the contract matches the structs and the dispatch, the
 * guards come in the order the spec's guard column asks, the engine calls are the spec's, the refusal
 * codes are the vocabulary's, and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Resources.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Resources.json"));

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
const MUTATING = ["register", "rebuild", "import", "create", "prefabFromModel"];
const ACTIONS = ["search", "selection", "resolve", "addons", "newGuid", "wait", ...MUTATING];

describe("EMCP_WB_Resources structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_ResourcesRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ResourcesResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 11 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
  });

  it("the 1.x open and browse are not handler actions (open is wb_module setResource, browse is search)", () => {
    for (const old of ["open", "browse"]) {
      expect(c).not.toContain(`req.action == "${old}"`);
      expect(contract.actions.map((a) => a.name)).not.toContain(old);
    }
    expect(c).not.toContain("SetOpenedResource");
  });

  it("mutating actions are project-only, reads are not (spec guard column)", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(MUTATING.includes(a.name));
      expect(a.projectOnly, a.name).toBe(MUTATING.includes(a.name));
      if (a.mutating)
        expect(
          a.params.map((p) => p.key),
          a.name,
        ).toContain("confirm");
    }
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntitySource|BaseContainer|Resource|MetaFile|WBModuleDef|ResourceManager|WorldEditorAPI|IEntityComponentSource)\b/,
    );
  });

  it("float values never travel through a request field", () => {
    const req = /class EMCP_WB_ResourcesRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
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
      "RunCommandline",
      "RunCmd",
      "Configure(",
      "FileIO",
      "EMCP2_sandbox",
      "_throwaway",
      "GetMetaFileFromString",
      "SCR_PrefabHelper",
      "Workbench.SearchResources",
      "CheckGUID",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("no ternary operator", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });
});

describe("guards", () => {
  it("every mutating action checks the project first", () => {
    for (const m of ["Register", "Rebuild", "Import", "Create", "PrefabFromModel"]) {
      const body = method(src, m);
      const guard = body.indexOf("EMCP_WB_ResourcesUtil.ProjectRefused(resp)");
      expect(guard, m).toBeGreaterThanOrEqual(0);
      const engine = body.search(/resourceManager\.|api\.|BaseContainerTools\./);
      expect(guard, m).toBeLessThan(engine);
    }
    for (const m of ["Search", "Selection", "Resolve", "Addons", "NewGuid", "WaitForResource"])
      expect(method(src, m), m).not.toContain("ProjectRefused");
  });

  it("writes to existing files go through TargetExistsInProject and refuse a .meta", () => {
    const body = method(src, "ExistingTarget");
    inOrder(
      body,
      [
        "EMCP_WB_Guard.CleanRelative(rel, clean, why)",
        'lower.EndsWith(".meta")',
        "EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why)",
      ],
      "ExistingTarget",
    );
    for (const m of ["Register", "Import"])
      expect(method(src, m), m).toContain(
        "EMCP_WB_ResourcesUtil.ExistingTarget(req.path, resp, absolute, clean)",
      );
    expect(method(src, "Rebuild")).toContain(
      "EMCP_WB_ResourcesUtil.ExistingTarget(rel, resp, absolute, clean)",
    );
  });

  it("new files go through NewTargetInProject, never exist yet, and have a known extension", () => {
    const body = method(src, "NewTarget");
    inOrder(
      body,
      [
        "EMCP_WB_Guard.CleanRelative(rel, clean, why)",
        "lower.EndsWith(ext)",
        '"UNSUPPORTED_TYPE"',
        "EMCP_WB_Guard.NewTargetInProject(clean, absolute, why)",
        'Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, existing, true)',
        "the file exists already",
      ],
      "NewTarget",
    );
    expect(method(src, "Create")).toContain(
      'EMCP_WB_ResourcesUtil.NewTarget(req.path, ".conf,.emat,.layout", resp, absolute, clean)',
    );
    expect(method(src, "PrefabFromModel")).toContain(
      "EMCP_WB_ResourcesUtil.NewTarget(req.path, EMCP_WB_ResourcesUtil.PREFAB_EXT, resp, absolute, clean)",
    );
  });

  it("every mutating action is a dry run unless confirm, checked before the first write", () => {
    const writes: Record<string, string> = {
      Register: "resourceManager.RegisterResourceFile(",
      Rebuild: "resourceManager.RebuildResourceFile",
      Create: "BaseContainerTools.CreateContainer(",
      PrefabFromModel: "api.CreateEntity(",
    };
    for (const [m, write] of Object.entries(writes)) {
      const body = method(src, m);
      inOrder(body, ["if (!req.confirm)", "resp.dryRun = true;", write], m);
    }
    // import: the dry run before register when no .meta exists, and before the Sets otherwise.
    inOrder(
      method(src, "Import"),
      [
        "if (!req.confirm)",
        "resp.dryRun = true;",
        "resourceManager.RegisterResourceFile(absolute, false)",
        "bool doWrite = applied && req.confirm;",
        "meta.Save();",
        "resourceManager.RebuildResourceFile(absolute, rebuildConfig, false)",
      ],
      "Import",
    );
    // The meta is saved (confirm only) and released on every path that got one.
    expect(method(src, "Import")).toMatch(
      /if \(doWrite\)\s*meta\.Save\(\);\s*meta\.Release\(false\);\s*if \(!doWrite\)\s*return;/,
    );
    inOrder(
      method(src, "ApplySettings"),
      [
        "target.GetVarIndex(varName)",
        "EMCP_WB_Container.IsScalar(varType)",
        "EMCP_WB_Container.CheckText(varType, text, why)",
        "if (!req.confirm)",
        "resp.dryRun = true;",
        "EMCP_WB_Container.WriteFromText(",
      ],
      "ApplySettings",
    );
  });

  it("prefabFromModel checks the world (NO_WORLD) and play mode, and runs in one entity action", () => {
    const api = method(src, "Api");
    inOrder(
      api,
      [
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
      ],
      "Api",
    );
    expect(api).toContain("GetModule may have opened the World Editor");
    const body = method(src, "PrefabFromModel");
    inOrder(
      body,
      [
        "EMCP_WB_ResourcesUtil.ProjectRefused(resp)",
        "EMCP_WB_ResourcesUtil.IsResourceNameOf(model, EMCP_WB_ResourcesUtil.MODEL_EXT)",
        "EMCP_WB_ResourcesUtil.ResourceExists(model)",
        "EMCP_WB_ResourcesUtil.NewTarget(",
        "EMCP_WB_ResourcesUtil.Api(resp)",
        "EMCP_WB_ResourcesUtil.PlayRefused(api, resp)",
        "if (!req.confirm)",
        "EMCP_WB_ResourcesUtil.BeginEdit(api, undo, resp)",
        'api.CreateEntity(entityClass, "", api.GetCurrentEntityLayerId(), null, vector.Zero, vector.Zero)',
        "EMCP_WB_ResourcesUtil.MeshComponent(api, instance)",
        "api.SetVariableValue(instance, meshPath, EMCP_WB_ResourcesUtil.MESH_VARIABLE, model)",
        "api.CreateEntityTemplate(instance, absolute)",
        "api.DeleteEntity(instance)",
      ],
      "PrefabFromModel",
    );
    expect(body).toMatch(/api\.DeleteEntity\(instance\);\s*api\.EndEntityAction\(\);/);
    // BeginEdit opened the action: every path after it ends it once (failed create, or the end).
    expect((body.match(/api\.EndEntityAction\(\)/g) ?? []).length).toBe(2);
    expect(body).not.toContain("api.BeginEntityAction(");
    const begin = method(src, "BeginEdit");
    expect(begin).toContain("if (api.BeginEntityAction(pointName))");
    expect(begin).not.toContain("EndEntityAction");
    // Play mode and prefab edit mode are both refused WRONG_MODE.
    const play = method(src, "PlayRefused");
    expect(play).toMatch(/if \(api\.IsGameMode\(\)\)\s*\{\s*Refuse\(resp, "WRONG_MODE",/);
    expect(play).toMatch(/if \(api\.IsPrefabEditMode\(\)\)\s*\{\s*Refuse\(resp, "WRONG_MODE",/);
  });

  it("a missing request is refused before it is read", () => {
    expect(src).toMatch(
      /if \(!req\)\s*\{\s*EMCP_WB_ResourcesUtil\.Refuse\(resp, "INVALID_ARGUMENT", "no request", "send action"\);\s*return resp;\s*\}\s*resp\.action = req\.action;/,
    );
  });
});

describe("engine calls are the spec's", () => {
  it("search: ResourceDatabase.SearchResources with the BI callback form, sorted, paged", () => {
    const body = method(src, "Search");
    inOrder(
      body,
      [
        "new SearchResourcesFilter()",
        "filter.rootPath = rootCheck;",
        "filter.fileExtensions = exts;",
        "filter.searchStr = words;",
        "filter.tags = tagNames;",
        "filter.recursive = req.recursive;",
        "ResourceDatabase.SearchResources(filter, CollectHit)",
        "collected.Sort();",
        "STALE_CURSOR",
        'resp.nextCursor = last.ToString() + ":" + total.ToString();',
      ],
      "Search",
    );
    expect(body).toContain('"ABSOLUTE_PATH"');
  });

  it("search: a relative rootPath is searched as $<id>:<folder> in each loaded addon (W2 run 1)", () => {
    const body = method(src, "Search");
    inOrder(
      body,
      [
        "if (relativeRoot)",
        "GameProject.GetLoadedAddons(loadedAddons);",
        "GameProject.GetAddonID(addonGuid)",
        'filter.rootPath = "$" + addonId + ":" + rootFolder;',
        "ResourceDatabase.SearchResources(filter, CollectHit)",
      ],
      "Search relative",
    );
  });

  it("search: an unregistered hit (ResourceName.Empty) answers its exact path (BI SearchWorkbenchFiles)", () => {
    expect(src).toMatch(
      /protected static bool CollectHit\(ResourceName resourceName, string exactPath = ""\)\s*\{\s*string hitText = resourceName;\s*if \(hitText == ""\)\s*\{\s*s_iUnregistered\+\+;\s*hitText = exactPath;/,
    );
  });

  it("import: an INTEGER setting takes an enum name through EMCP_WB_Meta.IntegerText (W2 run 1)", () => {
    const body = method(src, "ApplySettings");
    inOrder(
      body,
      [
        "if (varType == DataVarType.INTEGER)",
        "EMCP_WB_Meta.IntegerText(target, varIndex, text, number)",
        "text = number;",
        "EMCP_WB_Container.CheckText(varType, text, why)",
      ],
      "ApplySettings",
    );
  });

  it("selection: the Resource Manager's browser selection, capped", () => {
    const body = method(src, "Selection");
    expect(body).toContain("resourceManager.GetResourceBrowserSelection(picked.Insert, expand)");
    expect(body).toContain("i < EMCP_WB_ResourcesUtil.SELECTION_MAX");
    expect(src).toContain("static const int SELECTION_MAX = 2000;");
  });

  it("resolve: GetResourceName, GetPath, GetAbsolutePath, GetMetaFile, GetSourceFilePath, Release", () => {
    inOrder(
      method(src, "Resolve"),
      [
        "Workbench.GetResourceName(input)",
        "named.GetPath()",
        "EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, sourceAbs)",
        '"RESOURCE_NOT_FOUND"',
        "Workbench.GetAbsolutePath(rel, abs, true)",
        "resourceManager.GetMetaFile(abs)",
        "meta.GetSourceFilePath()",
        "meta.Release(false);",
      ],
      "Resolve",
    );
  });

  it("addons: the static GameProject calls and the game project file", () => {
    const body = method(src, "Addons");
    for (const call of [
      "GameProject.GetLoadedAddons(loaded)",
      "GameProject.GetAvailableAddons(availableGuids)",
      "GameProject.GetAddonID(addonGuid)",
      "GameProject.GetAddonTitle(addonGuid)",
      "GameProject.IsVanillaAddon(addonGuid)",
      "Workbench.GetCurrentGameProjectFile()",
    ])
      expect(body, call).toContain(call);
  });

  it("newGuid and wait", () => {
    expect(method(src, "NewGuid")).toContain("Workbench.GenerateGloballyUniqueID64()");
    inOrder(
      method(src, "WaitForResource"),
      [
        "EMCP_WB_Guard.TargetInsideProject(req.path, absolute, why)",
        "EMCP_WB_ResourcesUtil.TimeoutOf(req.timeoutMs, resp)",
        "resourceManager.WaitForFile(absolute, timeout)",
      ],
      "WaitForResource",
    );
    expect(src).toContain("static const int WAIT_MAX = 10000;");
  });

  it("register: GetMetaFile before RegisterResourceFile, then GetMetaFile again", () => {
    inOrder(
      method(src, "Register"),
      [
        "string existingId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute)",
        "if (!req.confirm)",
        "resourceManager.RegisterResourceFile(absolute, buildRuntime)",
        "string newId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute)",
      ],
      "Register",
    );
    inOrder(
      method(src, "MetaIdOf"),
      ["resourceManager.GetMetaFile(absolute)", "meta.GetResourceID()", "meta.Release(false);"],
      "MetaIdOf",
    );
  });

  it("rebuild: registered files only, one or many, then WaitForFile per file; no FileExists", () => {
    inOrder(
      method(src, "Rebuild"),
      [
        "EMCP_WB_ResourcesUtil.ConfigurationOf(req.configuration, resp)",
        "asked.Count() > EMCP_WB_ResourcesUtil.PATHS_MAX",
        '"META_NOT_FOUND"',
        "if (!req.confirm)",
        "resourceManager.RebuildResourceFile(absList.Get(0), config, false)",
        "resourceManager.RebuildResourceFiles(absList, config)",
        "int waitStart = System.GetTickCount();",
        "resourceManager.WaitForFile(absList.Get(i), waitMs)",
      ],
      "Rebuild",
    );
    // One WAIT_MAX budget for the whole list, not WAIT_MAX per file.
    expect(method(src, "Rebuild")).toContain(
      "EMCP_WB_ResourcesUtil.WAIT_MAX - (System.GetTickCount() - waitStart)",
    );
    expect(src).toContain('static const string DEFAULT_CONFIGURATION = "PC";');
    expect(method(src, "ConfigurationOf")).toContain("IsConfiguration(name)");
  });

  it("import: the Configurations array of the meta", () => {
    const body = method(src, "ApplySettings");
    inOrder(
      body,
      [
        "meta.GetObjectArray(EMCP_WB_ResourcesUtil.CONFIGURATIONS)",
        "configs.Count()",
        "configs.Get(i)",
        "conf.GetName()",
      ],
      "ApplySettings",
    );
    expect(src).toContain('static const string CONFIGURATIONS = "Configurations";');
  });

  it("create: CreateContainer, SetAncestor, SaveContainer with the relative path, then register", () => {
    inOrder(
      method(src, "Create"),
      [
        "EMCP_WB_ResourcesUtil.IsIdentifier(rootClass)",
        "EMCP_WB_ResourcesUtil.ResourceExists(ancestor)",
        "BaseContainerTools.CreateContainer(rootClass)",
        "created.IsValid()",
        "created.GetResource()",
        "createdObject.ToBaseContainer()",
        "cont.SetAncestor(ancestorName)",
        "BaseContainerTools.SaveContainer(cont, noResourceName, clean)",
        '"SAVE_FAILED"',
        "resourceManager.RegisterResourceFile(absolute, false)",
        "EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute)",
      ],
      "Create",
    );
  });

  // W2 run 2 (w2-40): GetAbsolutePath answers false for a packed file, so the vanilla ancestor
  // {6B819A076E1A5674}Configs/Hints/Editor.conf was refused PATH_NOT_FOUND. A packed resource is
  // looked up by GUID (BI's CheckTextures test: GetResourceName answers an unknown GUID unchanged).
  it("ResourceExists: a loose file, else a GUID the resource database knows with that path", () => {
    const body = method(src, "ResourceExists");
    inOrder(
      body,
      [
        "named.GetPath()",
        "Workbench.GetAbsolutePath(rel, abs, true)",
        "return true;",
        "GuidOf(value)",
        'string braced = "{" + guid + "}";',
        "Workbench.GetResourceName(braced)",
        "knownText == braced",
        "known.GetPath()",
        "return knownPath == wanted;",
      ],
      "ResourceExists",
    );
    expect(body).toMatch(/if \(knownText == "" \|\| knownText == braced\)\s*return false;/);
    expect(body).not.toMatch(/FileIO|FileExists|Resource\.Load|LoadContainer/);
  });

  it("prefabFromModel: MeshObject found on the entity or created", () => {
    inOrder(
      method(src, "MeshComponent"),
      [
        "src.GetComponentCount()",
        "src.GetComponent(i)",
        "component.GetClassName() == MESH_COMPONENT",
        "api.CreateComponent(src, MESH_COMPONENT)",
      ],
      "MeshComponent",
    );
    expect(src).toContain('static const string MESH_COMPONENT = "MeshObject";');
    expect(src).toContain('static const string MESH_VARIABLE = "Object";');
    expect(src).toContain('static const string ROOT_ENTITY_CLASS = "GenericEntity";');
  });

  it("every GetMetaFile is released in the same call", () => {
    const gets = (c.match(/\.GetMetaFile\(/g) ?? []).length;
    const releases = (c.match(/meta\.Release\(false\)/g) ?? []).length;
    expect(gets).toBeGreaterThan(0);
    expect(releases).toBeGreaterThanOrEqual(gets);
  });
});

describe("refusals and paging", () => {
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
    expect(codes.length).toBeGreaterThan(10);
    for (const k of codes) expect(Object.keys(ERROR_CODES), k).toContain(k);
    for (const k of [
      "INVALID_ARGUMENT",
      "MODULE_NOT_OPEN",
      "NO_WORLD",
      "WRONG_MODE",
      "ENGINE_FALSE",
      "STALE_CURSOR",
      "PATH_NOT_FOUND",
      "RESOURCE_NOT_FOUND",
      "META_NOT_FOUND",
      "UNSUPPORTED_TYPE",
      "ABSOLUTE_PATH",
      "SAVE_FAILED",
    ])
      expect(codes, k).toContain(k);
  });

  it("search pages by <start>:<count>, default 50, max 200", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    expect(method(src, "ParseCursor")).toContain('raw.Split(":", parts, false)');
    expect(method(src, "Search")).toMatch(
      /if \(cursorText != "" && cursorCount != total\)\s*\{\s*EMCP_WB_ResourcesUtil\.Refuse\(resp, "STALE_CURSOR",/,
    );
  });
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:api:ResourceManager.RebuildResourceFile/3
// census:api:ResourceManager.RebuildResourceFiles/2
// census:api:ResourceManager.RegisterResourceFile/2
// census:api:ResourceManager.WaitForFile/2
// census:mcp:handler-action/EMCP_WB_Resources.addons
// census:mcp:handler-action/EMCP_WB_Resources.create
// census:mcp:handler-action/EMCP_WB_Resources.import
// census:mcp:handler-action/EMCP_WB_Resources.newGuid
// census:mcp:handler-action/EMCP_WB_Resources.prefabFromModel
// census:mcp:handler-action/EMCP_WB_Resources.rebuild
// census:mcp:handler-action/EMCP_WB_Resources.register
// census:mcp:handler-action/EMCP_WB_Resources.resolve
// census:mcp:handler-action/EMCP_WB_Resources.wait
