/**
 * EMCP_WB_Container.c checked over its Enforce text offline (DEC-048 package 3.3, Container unit).
 * Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const src = readFileSync(join(DIR, "EMCP_WB_Container.c"), "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Container.json"));
const probeMut = readFileSync(join("mod-dev", "probe-mut", "ECEN_ProbeMutActions.c"), "utf-8");
const probeContainers = readFileSync(join("mod-dev", "probe", "ECEN_ProbeContainers.c"), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` (or `bool <name>(`) up to the next method separator. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`(?:static |protected )*\\b(?!return\\b)\\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const end = s.indexOf("//-----", at);
  return s.slice(at, end < 0 ? undefined : end);
}

/** The statement block of the `req.action == "<name>"` branch. */
function branch(name: string): string {
  const c = code(src);
  const at = c.indexOf(`req.action == "${name}"`);
  expect(at, `branch ${name}`).toBeGreaterThanOrEqual(0);
  const next = c.indexOf("else", at);
  return c.slice(at, next);
}

const C = code(src);

describe("EMCP_WB_Container", () => {
  it("registers exactly the contract's request and response keys", () => {
    expect(regVKeys(src, "EMCP_WB_ContainerRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ContainerResponse")).toEqual(contract.response);
  });

  it("has one dispatch branch per contract action", () => {
    for (const a of contract.actions) expect(C, a.name).toContain(`req.action == "${a.name}"`);
  });

  it("calls no banned or unproven engine method", () => {
    const noStrings = C.replace(/"[^"\n]*"/g, '""');
    for (const banned of [
      "FindFiles",
      "FileIO.",
      "Workbench.Dialog",
      "RunCommandline",
      "RunCmd",
      "Configure(",
      "SetOpenedResource",
      "OpenModule",
      // W2: the one module save is ModuleSave's (asserted below).
      "wbModule.Save()",
      "worldEditor.Save()",
      // W1: arrayMove on an entity refuses; the spec's call names no array slot (P-W1-22).
      "SetObjectVariableMember",
      // Not in the spec's rows for wb_container.
      "CloneContainer",
      "SetObjectArray",
      "ClearVariables(",
    ]) {
      expect(noStrings, banned).not.toContain(banned);
    }
    // Enforce rules the handler authors keep: no ternary operator, no sandbox name.
    expect(noStrings).not.toMatch(/\?[^;\n]*:/);
    expect(C).not.toContain("EMCP2_sandbox");
    // The only .Save() is the Resource Manager module's, in ModuleSave.
    expect((noStrings.match(/\.Save\(\)/g) ?? []).length).toBe(1);
    expect(method(C, "ModuleSave")).toContain("resp.saved = t.m_Module.Save();");
  });

  it("answers UNPROVEN with the gate-2 next only for the World Editor container, the RM container's other writes and entity arrayMove", () => {
    expect(src).toContain('static const string UNPROVEN_NEXT = "waits for train #2 gate 2";');
    expect(method(src, "Unproven")).toContain('"UNPROVEN"');
    expect((C.match(/Unproven\(resp, /g) ?? []).length).toBe(6);
    expect((C.match(/Unproven\(resp, WORLD_WRITE_UNPROVEN\)/g) ?? []).length).toBe(4);
    expect((C.match(/Unproven\(resp, RM_WRITE_UNPROVEN\)/g) ?? []).length).toBe(1);
    expect(src).toMatch(
      /static const string ENTITY_MOVE_UNPROVEN = "arrayMove on an entity: SetObjectVariableMember\/4/,
    );
    const move = method(code(src), "ArrayMove");
    const project = move.indexOf("ProjectRefused(resp)");
    const entity = move.indexOf('req.target.StartsWith("entity:")');
    const refuse = move.indexOf("Unproven(resp, ENTITY_MOVE_UNPROVEN)");
    expect(project).toBeGreaterThanOrEqual(0);
    expect(project).toBeLessThan(entity);
    expect(entity).toBeLessThan(refuse);
    expect(refuse).toBeLessThan(move.indexOf("OpenForWrite("));
  });

  it("dispatches the five W1 writes to their methods", () => {
    for (const [a, fn] of [
      ["clear", "ClearVar"],
      ["arrayAdd", "ArrayAdd"],
      ["arrayRemove", "ArrayRemove"],
      ["arrayMove", "ArrayMove"],
      ["setClass", "SetClass"],
    ]) {
      expect(branch(a), a).toContain(`${fn}(req, resp);`);
    }
  });

  it("every W1 write drops the kept walk and checks the project before opening its target", () => {
    for (const name of ["ClearVar", "ArrayAdd", "ArrayRemove", "ArrayMove", "SetClass"]) {
      const body = method(code(src), name);
      const drop = body.indexOf("DropWalk();");
      const project = body.indexOf("if (ProjectRefused(resp))");
      const open = body.indexOf("OpenForWrite(req.target, resp)");
      expect(drop, name).toBeGreaterThanOrEqual(0);
      expect(drop, name).toBeLessThan(project);
      expect(project, name).toBeLessThan(open);
    }
    // set on an entity: target goes through SetPath's project and empty-value checks first.
    const setBody = method(src, "SetPath");
    expect(setBody.indexOf("ProjectRefused(resp)")).toBeLessThan(
      setBody.indexOf('req.target.StartsWith("entity:")'),
    );
    expect(setBody.indexOf("req.emptyValue")).toBeLessThan(
      setBody.indexOf('req.target.StartsWith("entity:")'),
    );
    expect(method(src, "SetEntity")).toContain("OpenForWrite(req.target, resp)");
  });

  it("OpenForWrite refuses the World Editor container, then opens, then guards by target kind", () => {
    const body = method(code(src), "OpenForWrite");
    const world = body.indexOf('if (target == "open:WorldEditor")');
    const open = body.indexOf("t.Open(target)");
    const may = body.indexOf("MayWrite(t, resp)");
    expect(world).toBeGreaterThanOrEqual(0);
    expect(world).toBeLessThan(open);
    expect(open).toBeLessThan(may);
    const mayWrite = method(code(src), "MayWrite");
    // path: the DEC-058 guard (project, existing file in the project); entity: play mode refused.
    expect(mayWrite).toMatch(/if \(!t\.m_IsEntity\)\s*return WriteAllowed\(t, resp\);/);
    expect(mayWrite).toMatch(
      /if \(t\.m_Api\.IsGameMode\(\)\)\s*\{\s*Answer\(resp, EMCP_WB_Guard\.REFUSED, "WRONG_MODE"/,
    );
  });

  it("entity: targets resolve through EMCP_WB_EntityRef and the World Editor API", () => {
    const open = method(code(src), "Open");
    expect(open).toContain('if (target.StartsWith("entity:"))');
    const entity = method(code(src), "OpenEntity");
    expect(entity).toContain("Workbench.GetModule(WorldEditor)");
    expect(entity).toContain("m_Api = worldEditor.GetApi();");
    expect(entity).toContain("EMCP_WB_EntityRef.Resolve(m_Api, entityRef, resolved)");
    expect(entity).toContain("IEntitySource entSrc = resolved.m_Src;");
    expect(entity).toContain("m_Root = entSrc;");
  });

  it("each entity write is one undo step: Begin and End around exactly one WorldEditorAPI write", () => {
    const writes = [
      "SetVariableValue",
      "ClearVariableValue",
      "CreateObjectArrayVariableMember",
      "RemoveObjectArrayVariableMember",
      "ChangeObjectClass",
      "CreateObjectVariableMember",
    ];
    const c = code(src);
    for (const w of writes) {
      for (const m of c.matchAll(new RegExp(`t\\.m_Api\\.${w}\\(`, "g"))) {
        const at = m.index ?? 0;
        const begin = c.lastIndexOf("if (!BeginEdit(t.m_Api, undoName, resp))", at);
        const end = c.indexOf("t.m_Api.EndEntityAction();", at);
        expect(begin, w).toBeGreaterThanOrEqual(0);
        expect(end, w).toBeGreaterThan(at);
        // No other End between the Begin and the write.
        expect(c.slice(begin, at), w).not.toContain("EndEntityAction");
      }
    }
    expect((c.match(/if \(!BeginEdit\(t\.m_Api, undoName, resp\)\)\s*return;/g) ?? []).length).toBe(
      5,
    );
    expect((c.match(/t\.m_Api\.EndEntityAction\(\);/g) ?? []).length).toBe(5);
    // A begin that opened no action is refused ENGINE_FALSE and never ended (review C1).
    expect(c).toMatch(
      /if \(api\.BeginEntityAction\(pointName\)\)\s*return true;\s*resp\.undoName = "";\s*Answer\(resp, EMCP_WB_Guard\.REFUSED, "ENGINE_FALSE",/,
    );
    expect(src).toContain('static const string UNDO_PREFIX = "EMCP wb_container ";');
    for (const a of ["set", "clear", "arrayAdd", "arrayRemove", "setClass"])
      expect(src, a).toContain(`string undoName = UNDO_PREFIX + "${a}";`);
  });

  it("calls each WorldEditorAPI write with the 1.9.0.37 arity, the 1.x live forms where they exist", () => {
    const modify = readFileSync(join(DIR, "EMCP_WB_ModifyEntity.c"), "utf-8");
    for (const [call, live] of [
      [
        "t.m_Api.SetVariableValue(t.m_Root, PathOrNull(idPath), leafName, req.value)",
        "api.SetVariableValue(",
      ],
      [
        "t.m_Api.ClearVariableValue(t.m_Root, PathOrNull(idPath), leafName)",
        "api.ClearVariableValue(",
      ],
      [
        "t.m_Api.CreateObjectArrayVariableMember(top, PathOrNull(callPath), leafName, req.className, at)",
        "api.CreateObjectArrayVariableMember(",
      ],
      [
        "t.m_Api.RemoveObjectArrayVariableMember(top, PathOrNull(callPath), leafName, req.index)",
        "api.RemoveObjectArrayVariableMember(",
      ],
      ["t.m_Api.ChangeObjectClass(t.m_Root, idPath, req.className)", "api.ChangeObjectClass("],
    ]) {
      expect(src, call).toContain(call);
      expect(modify, live).toContain(live);
    }
    // E02 and src only (spec 2.2): an empty object variable gets a new object.
    expect(src).toContain(
      "t.m_Api.CreateObjectVariableMember(t.m_Root, PathOrNull(idPath), leafName, req.className)",
    );
    // A components[...] path puts the component on top for the array calls (the 1.x live form).
    const top = method(code(src), "ArrayTop");
    expect(top).toContain('path.StartsWith("components[")');
    expect(top).toContain("top = steps.Get(0);");
  });

  it("refuses to remove from an array whose elements are all inherited (the 1.x crash guard)", () => {
    const body = method(code(src), "ArrayRemove");
    expect(body.indexOf("InheritedOnly(holder, leafName, itemCount)")).toBeLessThan(
      body.indexOf("RemoveObjectArrayVariableMember("),
    );
    const guard = method(code(src), "InheritedOnly");
    for (const call of [
      "holder.IsVariableSetDirectly(varName)",
      "holder.GetAncestor()",
      "ancestor.GetObjectArray(varName)",
    ])
      expect(guard, call).toContain(call);
  });

  it("path writes keep a dry run before any change and save through SaveWrite", () => {
    for (const [name, mutate] of [
      ["ClearVar", "holder.ClearVariable(leafName);"],
      ["ArrayAdd", "list.Insert(item, at)"],
      ["ArrayRemove", "list.Remove(item)"],
      ["ArrayMove", "list.Remove(item)"],
      ["SetClass", "holder.SetObject(leafName, item)"],
    ]) {
      const body = method(code(src), name);
      const confirm = body.indexOf("if (!req.confirm)");
      const change = body.indexOf(mutate);
      const save = body.indexOf("SaveWrite(t, resp)");
      expect(confirm, name).toBeGreaterThanOrEqual(0);
      expect(confirm, name).toBeLessThan(change);
      expect(change, name).toBeLessThan(save);
      expect(body.slice(confirm, change), name).toContain("resp.dryRun = true;");
    }
    expect(method(code(src), "SaveWrite")).toContain(
      "BaseContainerTools.SaveContainer(t.m_Root, noResourceName, t.m_Rel)",
    );
    // arrayMove: Get, Remove, Insert on the same element (spec 2.2).
    const move = method(code(src), "ArrayMove");
    expect(move).toContain("BaseContainer item = list.Get(req.index);");
    expect(move).toContain("resp.written = list.Insert(item, req.toIndex);");
    // arrayAdd and setClass by path: CreateContainer -> GetResource -> ToBaseContainer (spec 2.2).
    for (const name of ["ArrayAdd", "SetClass"]) {
      const body = method(code(src), name);
      expect(body, name).toContain("created = BaseContainerTools.CreateContainer(req.className);");
      expect(body, name).toContain("created.GetResource()");
      expect(body, name).toContain("createdObject.ToBaseContainer()");
      // The resource is held at method scope so it outlives the save.
      expect(body.indexOf("Resource created = null;"), name).toBeLessThan(
        body.indexOf("if (t.m_IsEntity)"),
      );
    }
  });

  it("paths take one index or one class per segment, and the entity writes get the containerIdPath", () => {
    const split = method(code(src), "SplitSegment");
    expect(split).toContain("className = digits;");
    const resolve = method(code(src), "Resolve");
    expect(resolve).toContain("index = ClassIndex(cur.GetObjectArray(name), className);");
    expect(resolve).toContain("idPath.Insert(new ContainerIdPathEntry(name, index));");
    expect(resolve).toContain("idPath.Insert(new ContainerIdPathEntry(name));");
  });

  it("get answers the instance flags and the default of the variable", () => {
    const body = method(src, "GetPath");
    for (const line of [
      "resp.isSet = holder.IsVariableSet(leafName);",
      "resp.isSetDirectly = holder.IsVariableSetDirectly(leafName);",
      "if (holder.GetDefaultAsString(leafName, defaultText))",
      "resp.defaultValue = ScrubHome(defaultText);",
    ])
      expect(body, line).toContain(line);
  });

  it("the contract marks only arrayMove as refusing, for entity targets", () => {
    const refusing = contract.actions.filter((a) => a.refuses !== undefined).map((a) => a.name);
    expect(refusing).toEqual(["arrayMove"]);
    const move = contract.actions.find((a) => a.name === "arrayMove");
    expect(move?.refuses).toMatch(/^UNPROVEN for an entity:<ref> target/);
  });

  it("every mutating action checks the project before loading anything", () => {
    for (const name of ["SetPath", "SaveTarget"]) {
      const body = method(src, name);
      const sandbox = body.indexOf("ProjectRefused(resp)");
      const open = body.indexOf("t.Open(req.target)");
      const allowed = body.indexOf("WriteAllowed(t, resp)");
      const save = body.indexOf("SaveContainer(");
      expect(sandbox, name).toBeGreaterThanOrEqual(0);
      const world = body.indexOf('if (req.target == "open:WorldEditor")');
      expect(sandbox, name).toBeLessThan(world);
      expect(world, name).toBeLessThan(open);
      expect(open, name).toBeLessThan(allowed);
      expect(allowed, name).toBeLessThan(save);
    }
  });

  it("scrubs the home folder from every value it answers", () => {
    expect(src).toContain("static string ScrubHome(string value)");
    for (const s of [
      "all.Insert(ScrubHome(defaultText));",
      "all.Insert(ScrubHome(current));",
      "resp.value = ScrubHome(ReadValueText(holder, leafName, dataType));",
      "resp.before = ScrubHome(ReadAsText(holder, leafName, dataType));",
      "resp.after = ScrubHome(ReadAsText(holder, leafName, dataType));",
      "resp.after = ScrubHome(req.value);",
    ])
      expect(src, s).toContain(s);
  });

  it("a false Set with no parse reason answers ENGINE_FALSE", () => {
    expect(method(src, "SetPath")).toContain('"ENGINE_FALSE", "BaseContainer.Set returned false');
  });

  it("WriteAllowed holds the guard's three checks and refuses the World Editor container", () => {
    const body = method(src, "WriteAllowed");
    expect(body).toContain("ProjectRefused(resp)");
    expect(body).toMatch(/if \(t\.m_IsWorld\)\s*\{\s*Unproven\(resp,/);
    // DEC-058: a write may land anywhere inside the open project, not only a _throwaway/ folder.
    // The deciding guard is physical: the target is an existing file inside the project's folder.
    expect(body).toContain("EMCP_WB_Guard.TargetExistsInProject(t.m_Rel, absolute, why)");
    // One for a target outside the project, one for an RM opened resource with no path (W2).
    expect((body.match(/EMCP_WB_Guard\.NOT_IN_PROJECT/g) ?? []).length).toBe(2);
    expect(code(src)).not.toMatch(/NOT_SANDBOX|_throwaway|TargetInsideThrowaway|SANDBOX_FOLDER/);
    expect(body).toContain('"TargetExistsInProject: " + why');
    // The source-addon list is reported and decides nothing: live on 1.9.0.37 it names the game
    // beside the project for a mod's own config (DEC-058 ruling 2).
    expect(body).toContain("resp.sourceAddons = sourceAddons;");
    expect(body).not.toContain("sourceOk");
    expect(body.indexOf("TargetExistsInProject")).toBeLessThan(
      body.indexOf("resp.sourceAddons = sourceAddons;"),
    );
    const refused = method(src, "ProjectRefused");
    expect(refused).toContain("if (EMCP_WB_Guard.IsProjectFound())");
    expect(refused).toContain("EMCP_WB_Guard.NOT_IN_PROJECT");
    expect(refused).toContain(
      '"ProjectRefused: mutating actions need the handlers installed in the open project',
    );
  });

  it("the response registers sourceAddons", () => {
    expect(src).toContain("	string sourceAddons;");
    expect(src).toContain('RegV("sourceAddons");');
  });

  it("writes only behind confirm, and saves with the project-relative path and an empty resource name", () => {
    for (const name of ["SetPath", "SaveTarget"]) {
      const body = method(src, name);
      const confirm = body.indexOf("if (!req.confirm)");
      expect(confirm, name).toBeGreaterThanOrEqual(0);
      expect(confirm, name).toBeLessThan(body.indexOf("SaveContainer("));
      expect(body, name).toContain(
        "BaseContainerTools.SaveContainer(t.m_Root, noResourceName, t.m_Rel)",
      );
    }
    const setBody = method(src, "SetPath");
    expect(setBody.indexOf("if (!req.confirm)")).toBeLessThan(setBody.indexOf("WriteFromText("));
    // SetPath, SaveTarget and SaveWrite (the W1 path writes).
    expect((C.match(/SaveContainer\(/g) ?? []).length).toBe(3);
  });

  it("loads by path only through the probe's LoadContainer chain, never a world file", () => {
    const open = method(src, "Open");
    expect(open).toContain("EMCP_WB_Guard.CleanRelative(rel, clean, why)");
    expect(open).toContain('lowerPath.EndsWith(".ent")');
    for (const call of [
      "BaseContainerTools.LoadContainer(resourceName)",
      ".IsValid()",
      ".GetResource()",
      ".ToBaseContainer()",
    ]) {
      expect(open, call).toContain(call);
      expect(probeContainers, call).toContain(call.replace("m_Holder", "holder"));
    }
  });

  it("reaches the World Editor container as containerDump does, through the guard's module enum", () => {
    const world = method(src, "OpenWorld");
    expect(world).toContain('EMCP_WB_Guard.ModuleTypeForRead("WorldEditor")');
    for (const call of ["Workbench.GetModule(moduleType)", ".GetNumContainers()", ".GetContainer("])
      expect(probeContainers, call).toContain(call);
    expect(world).toContain("wbModule.GetContainer(0)");
  });

  it("ReadAsText and WriteFromText keep the mutating pack's calls", () => {
    for (const line of [
      "if (cont.Get(varName, floatValue))",
      "if (cont.Get(varName, intValue))",
      "if (cont.Get(varName, boolValue))",
      "if (cont.Get(varName, stringValue))",
      "if (cont.Get(varName, resourceValue))",
      "return cont.Set(varName, floatValue);",
      "return cont.Set(varName, intValue);",
      "return cont.Set(varName, boolValue);",
      "return cont.Set(varName, text);",
      "return cont.Set(varName, resourceValue);",
    ]) {
      expect(src, line).toContain(line);
      expect(probeMut, line).toContain(line);
    }
  });

  it("the walk uses only the probe dump's container calls and its caps", () => {
    const walk = method(src, "Walk");
    for (const call of [
      "cont.GetNumVars()",
      "cont.GetVarName(i)",
      "cont.GetDataVarType(i)",
      "cont.GetDefaultAsString(varName, defaultText)",
      "cont.IsVariableSet(varName)",
      "cont.IsVariableSetDirectly(varName)",
      "cont.GetObjectBaseClass(i)",
      "cont.GetObject(varName)",
      "cont.GetObjectArray(varName)",
      "list.Get(k)",
    ]) {
      expect(walk, call).toContain(call);
      expect(probeContainers, call).toContain(call);
    }
    expect(src).toContain("static const int PAGE_ROWS = 200;");
    expect(src).toContain("static const int MAX_ROWS = 20000;");
    expect(src).toContain("static const int MAX_DEPTH = 4;");
  });

  // ---- Wave W2 (phase5-w2-spec.md 2.4): open:ResourceManager, class:<Name>, schema fields ----

  it("W2: Open dispatches the two new targets before the path: form", () => {
    const open = method(code(src), "Open");
    const rm = open.indexOf('if (target == "open:ResourceManager")');
    const cls = open.indexOf('if (target.StartsWith("class:"))');
    const path = open.indexOf('if (!target.StartsWith("path:"))');
    expect(rm).toBeGreaterThanOrEqual(0);
    expect(cls).toBeGreaterThanOrEqual(0);
    expect(rm).toBeLessThan(path);
    expect(cls).toBeLessThan(path);
    expect(open).toContain('return OpenDocumentIn("ResourceManager");');
    expect(open).toContain("return OpenClass(target.Substring(6, target.Length() - 6));");
  });

  it("W2: open:ResourceManager counts the containers before GetContainer(0) and takes the guard path from the resource's own name", () => {
    // W4 (phase5-w4-spec.md 2.3): one reader for the Resource Manager and the three editor targets.
    const body = method(code(src), "OpenDocumentIn");
    expect(body).toContain("EMCP_WB_Guard.ModuleTypeForRead(moduleName)");
    expect(body.indexOf("if (!moduleType)")).toBeLessThan(
      body.indexOf("Workbench.GetModule(moduleType)"),
    );
    expect(body).toContain("Workbench.GetModule(moduleType)");
    const count = body.indexOf("wbModule.GetNumContainers()");
    const get = body.indexOf("wbModule.GetContainer(0)");
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThan(get);
    expect(body.slice(count, get)).toContain('m_Code = "NO_OPEN_RESOURCE";');
    // Every engine object is null-checked before use.
    expect(body).toContain("if (!wbModule)");
    expect(body).toContain("if (!m_Root)");
    expect(body.indexOf("if (!m_Root)")).toBeLessThan(body.indexOf("m_Root.GetResourceName()"));
    expect(body).toContain("ResourceName opened = m_Root.GetResourceName();");
    expect(body).toContain("string openedPath = opened.GetPath();");
    expect(body).toContain("EMCP_WB_Guard.CleanRelative(openedPath, clean, why)");
  });

  it("W2: open:ResourceManager writes: set and save through ModuleSave behind WriteAllowed and confirm; the other writes refuse UNPROVEN", () => {
    const allowed = method(code(src), "WriteAllowed");
    const noPath = allowed.indexOf('if (t.m_IsModule && t.m_Rel == "")');
    expect(noPath).toBeGreaterThanOrEqual(0);
    expect(noPath).toBeLessThan(allowed.indexOf("EMCP_WB_Guard.TargetExistsInProject("));
    for (const name of ["SetPath", "SaveTarget"]) {
      const body = method(code(src), name);
      const guard = body.indexOf("WriteAllowed(t, resp)");
      const branch = body.indexOf("if (t.m_IsModule)");
      const save = body.indexOf("ModuleSave(t, resp)");
      expect(guard, name).toBeGreaterThanOrEqual(0);
      expect(guard, name).toBeLessThan(branch);
      expect(branch, name).toBeLessThan(save);
      // A dry run answers before the module save.
      const confirm = body.lastIndexOf("if (!req.confirm)", save);
      expect(confirm, name).toBeGreaterThan(guard);
      // The module branch never reaches SaveContainer.
      expect(body.indexOf("SaveContainer("), name).toBeGreaterThan(save);
    }
    // set writes the value (WriteFromText) before the module save.
    const set = method(code(src), "SetPath");
    expect(set.indexOf("WriteFromText(")).toBeLessThan(set.indexOf("ModuleSave(t, resp)"));
    const openForWrite = method(code(src), "OpenForWrite");
    expect(openForWrite).toMatch(
      /if \(EMCP_WB_ContainerTarget\.IsModuleTarget\(target\)\)\s*\{\s*Unproven\(resp, RM_WRITE_UNPROVEN\);\s*return null;/,
    );
    expect(openForWrite.indexOf("RM_WRITE_UNPROVEN")).toBeLessThan(
      openForWrite.indexOf("t.Open(target)"),
    );
  });

  it("W2: class:<Name> is read only: the name is checked before CreateContainer, every write refuses WRONG_MODE before opening", () => {
    const isName = method(code(src), "IsClassName");
    expect(isName).toContain("name.ToAscii(i)");
    const open = method(code(src), "OpenClass");
    expect(open.indexOf("if (!IsClassName(className))")).toBeLessThan(
      open.indexOf("BaseContainerTools.CreateContainer(className)"),
    );
    expect(open).toContain("m_Holder = BaseContainerTools.CreateContainer(className);");
    expect(open).toContain("if (!m_Holder || !m_Holder.IsValid())");
    expect(open).toContain("m_Root = createdObject.ToBaseContainer();");
    expect(method(code(src), "ClassRefused")).toContain('"WRONG_MODE", CLASS_READ_ONLY');
    for (const name of ["SetPath", "SaveTarget"]) {
      const body = method(code(src), name);
      const project = body.indexOf("ProjectRefused(resp)");
      const cls = body.indexOf('if (req.target.StartsWith("class:"))');
      expect(project, name).toBeLessThan(cls);
      expect(body.slice(cls), name).toMatch(
        /^if \(req\.target\.StartsWith\("class:"\)\)\s*\{\s*ClassRefused\(resp\);/,
      );
      expect(cls, name).toBeLessThan(body.indexOf("t.Open(req.target)"));
    }
    const openForWrite = method(code(src), "OpenForWrite");
    expect(openForWrite.indexOf("ClassRefused(resp);")).toBeLessThan(
      openForWrite.indexOf("t.Open(target)"),
    );
    expect(method(code(src), "WriteAllowed")).toMatch(
      /if \(t\.m_IsClass\)\s*\{\s*ClassRefused\(resp\);/,
    );
  });

  it("W2: describe's schema columns follow the eight W1 columns, and the kept walk is reused only with the same fields", () => {
    expect(src).toContain("static const int SCHEMA_COLUMNS = 11;");
    const names = src.match(/static const string SCHEMA_COLUMN_NAMES = "([^"]+)";/)?.[1] ?? "";
    const base = src.match(/static const string COLUMN_NAMES = "([^"]+)";/)?.[1] ?? "";
    expect(names.split(",")).toHaveLength(11);
    expect(names).toBe(`${base},widget,limits,enumValues`);
    const describeBody = method(code(src), "Describe");
    expect(describeBody).toContain("bool schema = WantsSchema(req.fields);");
    expect(describeBody).toContain("resp.columns = SCHEMA_COLUMN_NAMES;");
    expect(describeBody).toContain(
      'if (mode == "page" && req.cursor != "" && s_WalkRows && s_WalkTarget == req.target && s_WalkSchema == schema && KeepsWalk(req.target))',
    );
    expect(describeBody).toContain('Walk(t.m_Root, "", MAX_DEPTH, all, schema);');
    expect(describeBody).toContain("s_WalkSchema = schema;");
    expect(method(code(src), "DropWalk")).toContain("s_WalkSchema = false;");
    const walk = method(code(src), "Walk");
    expect(walk).toMatch(
      /if \(schema\)\s*\{\s*all\.Insert\(cont\.GetUIWidget\(i\)\);\s*all\.Insert\(LimitsText\(cont, i, dataType\)\);/,
    );
    expect(walk).toContain("EnumPairs(cont, i, dataType, pairs);");
    // Element rows are padded to the schema stride.
    expect(walk).toMatch(
      /if \(schema\)\s*\{\s*all\.Insert\(""\);\s*all\.Insert\(""\);\s*all\.Insert\(""\);\s*\}/,
    );
    // The probe dump made GetUIWidget live per variable.
    expect(probeContainers).toContain("cont.GetUIWidget(i)");
    expect(method(code(src), "WantsSchema")).toContain('if (token == "schema")');
  });

  it("W2: GetLimits only on scalar and integer variables, GetEnumValues only on integers", () => {
    const limits = method(code(src), "LimitsText");
    expect(
      limits.indexOf("if (dataType != DataVarType.SCALAR && dataType != DataVarType.INTEGER)"),
    ).toBeLessThan(limits.indexOf("cont.GetLimits(varIndex, minValue, maxValue, stepValue)"));
    const pairs = method(code(src), "EnumPairs");
    expect(pairs.indexOf("if (dataType != DataVarType.INTEGER)")).toBeLessThan(
      pairs.indexOf("cont.GetEnumValues(varIndex, enumNames, enumNumbers)"),
    );
    expect(pairs).toContain("if (!enumNames || !enumNumbers)");
  });

  it("W2: get answers the variable's widget, limits and enum entries", () => {
    const body = method(code(src), "GetPath");
    for (const line of [
      "resp.widget = holder.GetUIWidget(varIndex);",
      "resp.limits = LimitsText(holder, varIndex, dataType);",
      "EnumPairs(holder, varIndex, dataType, resp.enumValues);",
    ])
      expect(body, line).toContain(line);
  });

  it("W2: the contract names the new targets and its description stays within 400 characters", () => {
    // W4 folds open:WorldEditor, open:ResourceManager and the three editors into open:<module>.
    expect(contract.purpose).toContain("open:<module>");
    expect(contract.purpose).toContain("class:<Name>");
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
    const describeAction = contract.actions.find((a) => a.name === "describe");
    expect(describeAction?.params.find((p) => p.key === "fields")?.note).toMatch(/schema/);
    const get = contract.actions.find((a) => a.name === "get");
    expect(get?.response.map((r) => r.key)).toEqual(
      expect.arrayContaining(["widget", "limits", "enumValues"]),
    );
  });

  // ---- Wave W4 (phase5-w4-spec.md 2.3, DEC-067): open:AnimEditor, open:BehaviorEditor, open:ProcAnimEditor ----

  it("W4: the three editor gates are static const bools, false in the shipped file", () => {
    for (const g of ["EDITOR_OPEN_ANIM", "EDITOR_OPEN_BEHAVIOR", "EDITOR_OPEN_PROCANIM"])
      expect(src).toContain(`static const bool ${g} = false;`);
    const gate = method(code(src), "EditorGate");
    expect(gate).toContain("P-W4-10 and P-W4-29");
    expect(gate).toMatch(/if \(!IsEditorTarget\(target\)\)\s*return "";/);
    expect(method(code(src), "IsEditorTarget")).toContain(
      'return target == "open:AnimEditor" || target == "open:BehaviorEditor" || target == "open:ProcAnimEditor";',
    );
    expect(method(code(src), "IsModuleTarget")).toContain(
      'return target == "open:ResourceManager" || IsEditorTarget(target);',
    );
  });

  it("W4: a gated editor target is refused GATED before dispatch, before any engine call", () => {
    const body = method(code(src), "GetResponse");
    const gate = body.indexOf("EMCP_WB_ContainerTarget.EditorGate(req.target)");
    const dispatch = body.indexOf('if (req.action == "describe")');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(dispatch);
    expect(body.slice(gate, dispatch)).toMatch(
      /Answer\(resp, EMCP_WB_Guard\.REFUSED, EMCP_WB_ContainerTarget\.GATED, gateWhy, EMCP_WB_ContainerTarget\.GATED_NEXT\);\s*return resp;/,
    );
    expect(body.slice(0, dispatch)).not.toMatch(/Workbench\.|GetModule|GetContainer/);
  });

  it("W4: Open checks the gate again, then reads the editor's document as the Resource Manager's", () => {
    const open = method(code(src), "Open");
    const editor = open.indexOf("if (IsEditorTarget(target))");
    const gate = open.indexOf("EditorGate(target)", editor);
    const read = open.indexOf("return OpenDocumentIn(target.Substring(5, target.Length() - 5));");
    expect(editor).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(editor);
    expect(read).toBeGreaterThan(gate);
    expect(open.slice(gate, read)).toContain("m_Code = GATED;");
    expect(editor).toBeLessThan(open.indexOf('if (!target.StartsWith("path:"))'));
  });

  it("W4: the editor targets take the module-target write rules (one document, its own path, set and save only)", () => {
    const allowed = method(code(src), "WriteAllowed");
    expect(allowed).toContain('if (t.m_IsModule && t.m_Rel == "")');
    expect(allowed).toContain("if (t.m_IsModule && t.m_ModuleCount != 1)");
    expect(method(code(src), "OpenDocumentIn")).toContain("m_IsModule = true;");
    expect(method(code(src), "ModuleSave")).toContain("t.m_ModuleName");
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:api:WorldEditorAPI.ChangeObjectClass/3
// census:api:WorldEditorAPI.ClearVariableValue/3
// census:api:WorldEditorAPI.CreateObjectArrayVariableMember/5
// census:api:WorldEditorAPI.RemoveObjectArrayVariableMember/4
// census:mcp:handler-action/EMCP_WB_Container.arrayAdd
// census:mcp:handler-action/EMCP_WB_Container.arrayMove
// census:mcp:handler-action/EMCP_WB_Container.arrayRemove
// census:mcp:handler-action/EMCP_WB_Container.clear
// census:mcp:handler-action/EMCP_WB_Container.describe
// census:mcp:handler-action/EMCP_WB_Container.get
// census:mcp:handler-action/EMCP_WB_Container.save
// census:mcp:handler-action/EMCP_WB_Container.set
// census:mcp:handler-action/EMCP_WB_Container.setClass
