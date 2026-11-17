/**
 * The shipped Module handler (EMCP_WB_Module.c) checked over its Enforce text offline (DEC-048
 * package 3.3): the contract matches the structs, every engine call is one the probe pack or a
 * shipped handler already makes, the deny and allow checks are the probe's, and the refusals
 * the design asks for are present. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Module.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Module.json"));
const probeModules = readFileSync(join("mod-dev", "probe", "ECEN_ProbeModules.c"), "utf-8");
const probeUtil = readFileSync(join("mod-dev", "probe", "ECEN_ProbeUtil.c"), "utf-8");
const probeWorld = readFileSync(join("mod-dev", "probe", "ECEN_ProbeWorld.c"), "utf-8");
const editorControl = readFileSync(join(DIR, "EMCP_WB_EditorControl.c"), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` up to the next method separator or the class end. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`static \\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  // The class end, with either line ending (the shipped files are checked out with CRLF).
  const classEnd = s.slice(at).search(/\r?\n}\r?\n/);
  const ends = [s.indexOf("//-----", at), classEnd >= 0 ? at + classEnd : -1].filter((e) => e >= 0);
  return s.slice(at, ends.length ? Math.min(...ends) : undefined);
}

/** Code lines of a body, trimmed, braces and blank lines dropped. */
function statements(body: string): string[] {
  return code(body)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && l !== "{" && l !== "}");
}

const c = code(src);

describe("EMCP_WB_Module structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_ModuleRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ModuleResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("no FindFiles, Dialog, RunCommandline, Configure or FileIO", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "RunCommandline",
      "Configure(",
      "FileIO",
    ]) {
      expect(c).not.toContain(banned);
    }
  });

  it("dispatches every contract action and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
  });
});

describe("engine calls are proven ones", () => {
  // [call in this file, file that already makes it, the text there]
  const PROVEN: Array<[string, "probe" | "editor" | "world", string]> = [
    ["Workbench.GetModule(moduleType)", "probe", "Workbench.GetModule(moduleType)"],
    ["Workbench.OpenModule(moduleType)", "probe", "Workbench.OpenModule(moduleType)"],
    ["wbModule.GetNumContainers()", "probe", "wbModule.GetNumContainers()"],
    ["wbModule.GetContainer(c)", "probe", "wbModule.GetContainer(c)"],
    ["cont.GetClassName()", "probe", "cont.GetClassName()"],
    [
      "wbModule.ExecuteAction(menuPath, keepFocus)",
      "probe",
      "wbModule.ExecuteAction(path, keepFocus)",
    ],
    ["Workbench.GetModule(WorldEditor)", "editor", "Workbench.GetModule(WorldEditor)"],
    // setResource opens through the shared by-type route (EMCP_WB_OpenResource), which the editor
    // handler's openResource also takes and which makes the SetOpenedResource calls.
    [
      "EMCP_WB_OpenResource.OpenIn(owner, clean)",
      "editor",
      "EMCP_WB_OpenResource.OpenInOwningModule(req.path)",
    ],
    // EditorControl's own 1.x Save() call (the live proof) is retired in review round 1 (F11,
    // DEC-099); its save branch now refuses and points at this module's save.
    ["worldEditor.Save()", "editor", "use EMCP_WB_Module save"],
    ["worldEditor.GetApi()", "world", "worldEditor.GetApi()"],
    ["api.GetWorldPath(worldPath)", "world", "api.GetWorldPath(worldPath)"],
  ];
  for (const [mine, where, theirs] of PROVEN) {
    it(`${mine} (as ${where} makes it)`, () => {
      expect(c).toContain(mine);
      const there =
        where === "probe" ? probeModules : where === "editor" ? editorControl : probeWorld;
      expect(code(there)).toContain(theirs);
    });
  }

  it("makes no Close, BringModuleWindowToFront or IsModuleOpen call", () => {
    expect(c).not.toMatch(/\.Close\(/);
    expect(c).not.toContain("BringModuleWindowToFront(");
    expect(c).not.toContain("IsModuleOpen");
  });
});

describe("the deny and allow checks are the probe's", () => {
  for (const name of ["NormLabel", "Words", "DeniedSegment", "PathAllowed"]) {
    it(`${name} matches ECEN_ProbeUtil.${name} statement by statement`, () => {
      const mine = statements(method(src, name)).map((l) =>
        l.replace(/EMCP_WB_ActionAllowList/g, "LIST").replace(/\bmenuPath\b/g, "path"),
      );
      const theirs = statements(method(probeUtil, name)).map((l) =>
        l.replace(/ECEN_ProbeAllowList/g, "LIST"),
      );
      expect(mine).toEqual(theirs);
    });
  }
});

describe("refusals", () => {
  it("use the guard's status and message form", () => {
    const refuse = method(src, "Refuse");
    expect(refuse).toContain("resp.status = EMCP_WB_Guard.REFUSED;");
    expect(refuse).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
  });

  it("reads use ModuleTypeForRead, open/front/close ModuleTypeForOpen", () => {
    for (const m of ["ListModules", "InfoModule", "RunAction"]) {
      expect(method(src, m)).toContain("EMCP_WB_Guard.ModuleTypeForRead(");
      expect(method(src, m)).not.toContain("EMCP_WB_Guard.ModuleTypeForOpen(");
    }
    for (const m of ["OpenOne", "FrontOne", "CloseOne"]) {
      expect(method(src, m)).toContain("EMCP_WB_Guard.ModuleTypeForOpen(");
    }
  });

  it("open calls GetModule only with the read type (never the Particle Editor)", () => {
    const calls = [...method(src, "OpenOne").matchAll(/Workbench\.GetModule\((\w+)\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) expect(m[1]).toBe("readType");
  });

  it("front and close refuse without an engine call", () => {
    for (const m of ["FrontOne", "CloseOne"]) {
      const body = code(method(src, m));
      expect(body).toContain("EMCP_WB_ModuleUtil.NOT_SUPPORTED");
      expect(body).not.toMatch(/Workbench\.(?!Guard)|wbModule\.|worldEditor\./);
    }
    expect(method(src, "CloseOne")).toContain('"the owner closes by hand"');
    expect(method(src, "FrontOne")).toContain("bringModuleWindowToFront");
  });

  // DEC-058: setResource needs no project (opening is not a write; the engine resolves the
  // path across addons) and checks the path with CleanRelative only; save needs the project.
  it("save: World Editor only, then its guard, then the engine", () => {
    const body = code(method(src, "SaveWorld"));
    const weOnly = body.indexOf('req.moduleName != "WorldEditor"');
    const guard = body.indexOf("EMCP_WB_Guard.ProjectId()");
    const engine = body.indexOf("Workbench.GetModule(WorldEditor)");
    expect(weOnly).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(weOnly);
    expect(engine).toBeGreaterThan(guard);
    expect(body).toContain("EMCP_WB_ModuleUtil.WAITS_P3_1");
    expect(body).not.toMatch(/IsSandboxProject|NOT_SANDBOX|SANDBOX_FOLDER/);
  });

  // W2 run 2 (w2-50, 1.9.0.37): a .conf handed to the World Editor raised the modal "Cannot open
  // prefabs at this time (not implemented)". A module is handed only a file type it owns.
  it("setResource: module name, path guard, owner check, refusal before any module, then the owner only", () => {
    const set = code(method(src, "SetResource"));
    const order = [
      "EMCP_WB_Guard.ModuleType(req.moduleName)",
      "EMCP_WB_Guard.CleanRelative(req.path, clean, why)",
      "EMCP_WB_OpenResource.OwnerOf(clean)",
      "if (owner != req.moduleName)",
      "Workbench.GetModule(WorldEditor)",
      "EMCP_WB_OpenResource.OpenIn(owner, clean)",
    ].map((s) => set.indexOf(s));
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The mismatch is INVALID_ARGUMENT and names the owning module in nextStep.
    expect(set).toMatch(
      /if \(owner != req\.moduleName\)\s*\{[\s\S]*?EMCP_WB_ModuleUtil\.Refuse\(resp, "INVALID_ARGUMENT", [\s\S]*?"wb_module setResource module " \+ owner[\s\S]*?\);\s*return;/,
    );
    expect(set).toContain("the World Editor opens only a world (.ent) or a prefab (.et)");
    // A .ptc is refused before any module is touched.
    expect(set.indexOf("EMCP_WB_OpenResource.PARTICLE_EDITOR")).toBeLessThan(
      set.indexOf("EMCP_WB_OpenResource.OpenIn("),
    );
    expect(set).not.toMatch(/\.SetOpenedResource\(/);
    expect(set).not.toMatch(/IsProjectFound|ProjectId|TargetInsideProject/);
    expect(set).not.toContain("WAITS_P3_1");
    expect(src).toContain('static const string WAITS_P3_1 = "waits for sitting P3-1";');
    expect(src).toContain('static const string NOT_SUPPORTED = "MODULE_NOT_SUPPORTED";');
  });

  it("action: deny check, allow-list, open module, then ExecuteAction; no project check (DEC-058)", () => {
    const body = code(method(src, "RunAction"));
    expect(body).not.toMatch(
      /IsSandboxProject|IsProjectFound|ProjectId\(|NOT_SANDBOX|NOT_IN_PROJECT/,
    );
    const order = [
      "EMCP_WB_ModuleUtil.DeniedSegment(",
      "EMCP_WB_ModuleUtil.PathAllowed(",
      "Workbench.GetModule(moduleType)",
      "wbModule.ExecuteAction(",
    ].map((s) => body.indexOf(s));
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect((body.match(/"NOT_ALLOWLISTED"/g) ?? []).length).toBe(2);
  });

  // W5 OD-5 (DEC-068): NavmeshGeneratorMain is listed only when its type resolves (no class in
  // 1.9.0.37), so the list holds 9 names on that build.
  it("the module list is the guard's present modules, NavmeshGeneratorMain only when its type resolves", () => {
    const body = code(method(src, "ModuleNames"));
    const names = [...body.matchAll(/Insert\("(\w+)"\)/g)].map((m) => m[1]);
    expect(names).toEqual([
      "AnimEditor",
      "AudioEditor",
      "BehaviorEditor",
      "LocalizationEditor",
      "ParticleEditor",
      "ProcAnimEditor",
      "ResourceManager",
      "ScriptEditor",
      "WorldEditor",
    ]);
    expect(src).toContain('static const string NAVMESH = "NavmeshGeneratorMain";');
    expect(body).toMatch(
      /typename navmeshType = EMCP_WB_Guard\.ModuleType\(NAVMESH\);\s*if \(navmeshType\)\s*outNames\.Insert\(NAVMESH\);/,
    );
    // In name order: between LocalizationEditor and ParticleEditor.
    expect(body.indexOf('Insert("LocalizationEditor")')).toBeLessThan(body.indexOf("NAVMESH"));
    expect(body.indexOf("Insert(NAVMESH)")).toBeLessThan(body.indexOf('Insert("ParticleEditor")'));
    expect(src).not.toContain("10 present");
  });

  it("save is a dry run without confirm, and saves only a world of the open project", () => {
    const body = code(method(src, "SaveWorld"));
    const at = (t: string) => body.indexOf(t);
    expect(at("api.GetWorldPath(worldPath)")).toBeGreaterThan(at("EMCP_WB_Guard.ProjectId()"));
    expect(body).toMatch(
      /if \(projectId == ""\)\s*\{\s*EMCP_WB_ModuleUtil\.Refuse\(resp, EMCP_WB_Guard\.NOT_IN_PROJECT,/,
    );
    expect(body).toContain('string projectPrefix = "$" + projectId + ":";');
    expect(body).toContain('resp.worldPathForm = "project";');
    expect(at("if (!req.confirm)")).toBeGreaterThan(at("api.GetWorldPath(worldPath)"));
    expect(at('resp.worldPathForm != "project"')).toBeGreaterThan(at("if (!req.confirm)"));
    expect(at("worldEditor.Save()")).toBeGreaterThan(at('resp.worldPathForm != "project"'));
    expect(body).toContain("resp.dryRun = true;");
  });

  it("setResource sends the guard-cleaned path", () => {
    const body = code(method(src, "SetResource"));
    // DEC-058: CleanRelative is the whole path check now; a dirty path is refused, not sent.
    expect(body).toMatch(
      /if \(!EMCP_WB_Guard\.CleanRelative\(req\.path, clean, why\)\)\s*\{\s*EMCP_WB_ModuleUtil\.Refuse\(resp, "INVALID_ARGUMENT", why,/,
    );
    expect(body).toContain("OpenIn(owner, clean)");
    expect(body).not.toContain("SetOpenedResource(req.path)");
  });
});

// Wave W4 (phase5-w4-spec.md 2.3, DEC-067). The new engine calls are in the 1.9.0.37 index
// (enforce-lint resolves them) but no shipped handler has made them live: each sits behind a gate
// that stays false until its probe passes, and no engine call precedes the gate.
describe("W4: docPath, editor saves and the setResource route", () => {
  const GATES = [
    "DOC_READ_ANIM",
    "DOC_READ_BEHAVIOR",
    "DOC_READ_PROCANIM",
    "SAVE_ANIM",
    "SAVE_BEHAVIOR",
    "SAVE_PROCANIM",
    "RELATIVE_OPEN_ANIM",
    "RELATIVE_OPEN_PROCANIM",
  ];

  it("every W4 gate is a static const bool and false in the shipped file", () => {
    for (const g of GATES) expect(src).toContain(`static const bool ${g} = false;`);
    expect(src).toContain('static const string GATED = "GATED";');
  });

  it("the gates name their probes", () => {
    const read = code(method(src, "DocReadGate"));
    expect(read).toMatch(
      /if \(name == "WorldEditor" \|\| name == "ResourceManager"\)\s*return "";/,
    );
    // P-W4-10 killed (W4 fix-up 1): the W4 editors answer the kill reason.
    expect(read).toContain("NoDocumentWhy(name)");
    expect(code(method(src, "NoDocumentWhy"))).toContain("P-W4-10 killed");
    const save = code(method(src, "SaveGate"));
    expect(save.indexOf("DocReadGate(name)")).toBeLessThan(save.indexOf("SAVE_ANIM"));
    for (const [flag, probe] of [
      ["SAVE_ANIM", "P-W4-11"],
      ["SAVE_BEHAVIOR", "P-W4-13"],
      ["SAVE_PROCANIM", "P-W4-12"],
    ]) {
      expect(save).toContain(`!${flag})`);
      expect(save).toContain(probe);
    }
    const rel = code(method(src, "RelativeOpenProven"));
    expect(rel).toMatch(/if \(name == "AnimEditor"\)\s*return RELATIVE_OPEN_ANIM;/);
    expect(rel).toMatch(/if \(name == "ProcAnimEditor"\)\s*return RELATIVE_OPEN_PROCANIM;/);
    expect(rel.trimEnd()).toMatch(/return true;\s*\}$/);
  });

  it("DocPath reads the resource name the way open:ResourceManager does, null-checked", () => {
    const body = code(method(src, "DocPath"));
    expect(body.indexOf("if (!doc)")).toBeLessThan(body.indexOf("doc.GetResourceName()"));
    expect(body).toContain("ResourceName opened = doc.GetResourceName();");
    expect(body).toContain("string openedPath = opened.GetPath();");
    const container = readFileSync(join(DIR, "EMCP_WB_Container.c"), "utf-8");
    expect(code(container)).toContain("ResourceName opened = m_Root.GetResourceName();");
    expect(code(container)).toContain("string openedPath = opened.GetPath();");
  });

  it("info answers docPath only behind DocReadGate and scrubs the home folder", () => {
    const body = code(method(src, "InfoModule"));
    const gate = body.indexOf("EMCP_WB_ModuleUtil.DocReadGate(req.moduleName)");
    const read = body.indexOf("wbModule.GetContainer(0)");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(read);
    expect(body).toMatch(
      /if \(readGate == ""\)\s*\{\s*BaseContainer firstDoc = wbModule\.GetContainer\(0\);/,
    );
    expect(body).toContain(
      "resp.docPath = EMCP_WB_Guard.ScrubHome(EMCP_WB_ModuleUtil.DocPath(firstDoc));",
    );
  });

  it("save routes the three editors to SaveDocument and every other module to SaveWorld", () => {
    const body = code(method(src, "SaveOne"));
    expect(body).toMatch(
      /if \(EMCP_WB_ModuleUtil\.IsW4Editor\(req\.moduleName\)\)\s*SaveDocument\(req, resp\);\s*else\s*SaveWorld\(req, resp\);/,
    );
    expect(code(method(src, "IsW4Editor"))).toContain(
      'return name == "AnimEditor" || name == "BehaviorEditor" || name == "ProcAnimEditor";',
    );
  });

  it("SaveDocument: gate, project, module, one container, its path in the project, dry run, then Save", () => {
    const body = code(method(src, "SaveDocument"));
    const order = [
      "EMCP_WB_ModuleUtil.DocReadGate(req.moduleName)",
      "EMCP_WB_ModuleUtil.SaveGate(req.moduleName)",
      "EMCP_WB_Guard.IsProjectFound()",
      "Workbench.GetModule(moduleType)",
      "wbModule.GetNumContainers()",
      "if (count != 1)",
      "wbModule.GetContainer(0)",
      "if (!doc)",
      "EMCP_WB_Guard.CleanRelative(openedPath, clean, why)",
      "EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why)",
      "if (!req.confirm)",
      "wbModule.Save()",
    ].map((s) => body.indexOf(s));
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The gate refuses GATED before any engine call.
    const gate = body.slice(0, body.indexOf("EMCP_WB_Guard.IsProjectFound()"));
    expect(gate).toContain("EMCP_WB_ModuleUtil.GATED");
    // P-W4-10 killed: NO_DOCUMENT before the GATED check, still before any engine call.
    expect(gate.indexOf('"NO_DOCUMENT"')).toBeGreaterThanOrEqual(0);
    expect(gate.indexOf('"NO_DOCUMENT"')).toBeLessThan(gate.indexOf("EMCP_WB_ModuleUtil.GATED"));
    expect(gate).not.toMatch(/Workbench\.|wbModule\./);
    expect(body).toContain('"NO_DOCUMENT"');
    expect(body).toContain('resp.code = "SAVE_FAILED";');
    expect(body).toContain("OD-6");
    expect(body).not.toMatch(/IsSandboxProject|NOT_SANDBOX|SANDBOX_FOLDER/);
    // Exactly one WBModuleDef.Save in the file, here.
    expect((c.match(/wbModule\.Save\(\)/g) ?? []).length).toBe(1);
  });

  it("setResource: AnimEditor and ProcAnimEditor take Workbench.OpenResource until their probe, before OpenIn", () => {
    const body = code(method(src, "SetResource"));
    const owner = body.indexOf("if (owner != req.moduleName)");
    const gate = body.indexOf("if (!EMCP_WB_ModuleUtil.RelativeOpenProven(owner))");
    const route = body.indexOf("Workbench.OpenResource(clean)");
    const openIn = body.indexOf("EMCP_WB_OpenResource.OpenIn(owner, clean)");
    expect(owner).toBeLessThan(gate);
    expect(gate).toBeLessThan(route);
    expect(route).toBeLessThan(openIn);
    expect((c.match(/Workbench\.OpenResource\(/g) ?? []).length).toBe(1);
  });

  it("an unknown module name says the type does not exist for NavmeshGeneratorMain", () => {
    const body = code(method(src, "RefuseModule"));
    expect(body).toContain("if (name == NAVMESH)");
    expect(body).toContain("moduleName must be one of the present modules");
  });
});

// The shared by-type route. The World Editor takes a .ent (a world) and a .et (prefab edit mode,
// W1 w1-43 PASS on 1.9.0.37) and nothing else (W2 run 2: a .conf raised a modal).
describe("EMCP_WB_OpenResource: no module is handed a file type it cannot open", () => {
  const OR = readFileSync(join(DIR, "EMCP_WB_OpenResource.c"), "utf-8");
  const orCode = code(OR);

  it("OwnerOf gives the World Editor .ent and .et only, and the Resource Manager the rest", () => {
    const owner = code(method(OR, "OwnerOf"));
    expect(owner).toMatch(
      /if \(lower\.EndsWith\("\.ent"\) \|\| lower\.EndsWith\("\.et"\)\)\s*return WORLD_EDITOR;/,
    );
    expect((owner.match(/return WORLD_EDITOR;/g) ?? []).length).toBe(1);
    expect(owner.trimEnd()).toMatch(/return RESOURCE_MANAGER;\s*\}$/);
    for (const [ext, mod] of [
      [".bt", "BehaviorEditor"],
      [".c", "ScriptEditor"],
      [".st", "LocalizationEditor"],
      [".ptc", "PARTICLE_EDITOR"],
    ]) {
      expect(owner).toMatch(new RegExp(`EndsWith\\("\\${ext}"\\)\\)\\s*return "?${mod}"?;`));
    }
  });

  it("the World Editor's SetOpenedResource is called once, in OpenIn's WorldEditor branch", () => {
    expect((orCode.match(/worldEditor\.SetOpenedResource\(/g) ?? []).length).toBe(1);
    const openIn = code(method(OR, "OpenIn"));
    expect(openIn).toMatch(
      /if \(moduleName == WORLD_EDITOR\)\s*\{\s*WorldEditor worldEditor = Workbench\.GetModule\(WorldEditor\);\s*if \(worldEditor && worldEditor\.SetOpenedResource\(path\)\)\s*return WORLD_EDITOR;\s*return "";/,
    );
    // The Particle Editor is never asked; the only fallback is a .bt to the Resource Manager.
    expect(openIn.indexOf("PARTICLE_EDITOR")).toBeLessThan(openIn.indexOf("SetOpenedResource"));
    expect(openIn).toMatch(
      /if \(moduleName == "BehaviorEditor"\)\s*return OpenInResourceManager\(path\);\s*return "";/,
    );
    expect(code(method(OR, "OpenInOwningModule"))).toContain("return OpenIn(OwnerOf(path), path);");
  });

  it("no other shipped handler hands the World Editor a resource", () => {
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith(".c") || f === "EMCP_WB_OpenResource.c") continue;
      const text = code(readFileSync(join(DIR, f), "utf-8"));
      expect(text, f).not.toMatch(
        /worldEditor\.SetOpenedResource|WorldEditor\)\.SetOpenedResource/,
      );
    }
  });

  it("no next step points a Particle Editor caller at close", () => {
    expect(src).not.toContain("open, front or close");
  });
});
