/**
 * EMCP_WB_Meta.c (wave W2, phase5-w2-spec.md section 2.2) checked over its Enforce text offline: the
 * contract matches the structs and the per-action reads and writes, every engine call is the one the
 * spec's action table names, every write sits behind the project guard and a dry run, every meta is
 * opened by its absolute path and released before the call ends, and no forbidden call is made.
 * Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { checkedDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Meta.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Meta.json"));
const other = (name: string) => readFileSync(join(DIR, `EMCP_WB_${name}.c`), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `<type> <name>(` (static or not) up to the next method separator or the class end. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`\\b\\w+ ${name}\\([^)]*\\)\\r?\\n\\t\\{`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const classEnd = s.slice(at).search(/\r?\n}\r?\n/);
  const ends = [s.indexOf("//-----", at), classEnd >= 0 ? at + classEnd : -1].filter((e) => e >= 0);
  return code(s.slice(at, ends.length ? Math.min(...ends) : undefined));
}

const C = code(src);
const NO_STRINGS = C.replace(/"[^"\n]*"/g, '""');

/** Action -> the method its dispatch branch calls. */
const METHOD: Record<string, string> = {
  get: "GetMeta",
  vars: "ListVars",
  set: "SetVar",
  clear: "ClearVar",
  setAncestor: "SetAncestorOf",
  assignMaterial: "AssignMaterial",
};
const READS = ["get", "vars"];
const WRITES = ["set", "clear", "setAncestor", "assignMaterial"];

describe("EMCP_WB_Meta structs and contract", () => {
  it("request and response RegV keys are the contract's, in order", () => {
    expect(regVKeys(src, "EMCP_WB_MetaRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_MetaResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action, each to its own method, and nothing else", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*(\w+)\(req, resp\)/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    for (const m of branches) expect(m[2], m[1]).toBe(METHOD[m[1]]);
  });

  it("marks the reads read-only and every write mutating and project-only; vars pages", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(WRITES.includes(a.name));
      expect(a.projectOnly, a.name).toBe(WRITES.includes(a.name));
      expect(a.paging, a.name).toBe(a.name === "vars");
    }
  });

  it("every write takes confirm; the source file is the path of every action", () => {
    for (const a of contract.actions) {
      const keys = a.params.map((p) => p.key);
      expect(keys, a.name).toContain("path");
      expect(a.params.find((p) => p.key === "path")?.required, a.name).toBe(true);
      expect(keys.includes("confirm"), a.name).toBe(WRITES.includes(a.name));
    }
  });

  it("keeps the tool description within its 400-char budget", () => {
    expect(checkedDescription(contract).length).toBeLessThanOrEqual(400);
  });
});

describe("forbidden calls", () => {
  it("no FindFiles, Dialog, RunCommandline, Configure, FileIO or BI's GetMetaFileFromString", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "FileIO",
      "Workbench.Dialog",
      "RunCmd",
      "RunCommandline",
      "Configure(",
      "GetMetaFileFromString",
      "SaveContainer",
      "RegisterResourceFile",
      "RebuildResourceFile",
      "SetOpenedResource",
    ]) {
      expect(NO_STRINGS, banned).not.toContain(banned);
    }
  });

  it("names no sandbox and no project", () => {
    expect(src).not.toMatch(/EMCP2_sandbox|_throwaway|sandbox/i);
  });

  it("uses no ternary operator", () => {
    expect(NO_STRINGS).not.toContain("?");
  });

  it("carries engine pointers in EMCP_WB_MetaTarget, never through an out parameter", () => {
    expect(C).not.toMatch(
      /out\s+(MetaFile|BaseContainer|BaseContainerList|Resource|ResourceManager)\b/,
    );
    expect(C).toContain("class EMCP_WB_MetaTarget");
    // A member set to null goes through a null local (the EMCP_WB_EntityRefResult form).
    expect(method(src, "Close")).toMatch(/MetaFile none = null;\s*m_Meta = none;/);
  });
});

describe("meta lifecycle and guards", () => {
  it("a read resolves the absolute path with mustExist before any meta call", () => {
    const body = method(src, "OpenRead");
    const source = body.indexOf("EMCP_WB_Meta.SourcePath(path, clean, why)");
    const abs = body.indexOf("Workbench.GetAbsolutePath(clean, absolute, true)");
    const open = body.indexOf("return OpenAbsolute();");
    expect(source).toBeGreaterThanOrEqual(0);
    expect(source).toBeLessThan(abs);
    expect(abs).toBeLessThan(open);
    expect(body).toContain("m_Code = EMCP_WB_Meta.META_NOT_FOUND;");
  });

  it("a write resolves an existing file inside the project (TargetExistsInProject)", () => {
    const body = method(src, "OpenWrite");
    expect(body).toContain("EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why)");
    expect(body).toContain("m_Code = EMCP_WB_Guard.NOT_IN_PROJECT;");
    expect(body).not.toContain("GetAbsolutePath");
  });

  it("GetMetaFile takes the absolute path only, the form W1 made live", () => {
    expect([...C.matchAll(/\.GetMetaFile\(([^)]*)\)/g)].map((m) => m[1])).toEqual(["m_Abs"]);
    expect(code(other("World"))).toContain("resourceManager.GetMetaFile(absolute)");
    expect(method(src, "OpenAbsolute")).toContain("m_Code = EMCP_WB_Meta.META_NOT_FOUND;");
  });

  it("the source path drops a GUID, is cleaned by the guard and never names the .meta", () => {
    const body = method(src, "SourcePath");
    expect(body).toContain("named.GetPath()");
    expect(body).toContain("EMCP_WB_Guard.CleanRelative(text, clean, why)");
    expect(body).toContain('lowerPath.EndsWith(".meta")');
  });

  it("Close releases with Release(false), once", () => {
    expect(method(src, "Close")).toContain("m_Meta.Release(false);");
    expect([...C.matchAll(/\.Release\(/g)].length).toBe(1);
  });

  for (const a of [...READS, ...WRITES]) {
    it(`${a}: every return after the open closes the meta first`, () => {
      const body = method(src, METHOD[a]);
      const opened = body.search(/if \(!t\.Open(Read|Write)\(req\.path\)\)/);
      expect(opened, a).toBeGreaterThanOrEqual(0);
      // Past the open's own failure block, which has nothing to close.
      const after = body.indexOf("}", body.indexOf("OpenFailed(t, resp);", opened)) + 1;
      const rest = body.slice(after);
      let last = 0;
      for (const r of rest.matchAll(/\breturn\b/g)) {
        const stretch = rest.slice(last, r.index);
        expect(stretch, `${a}: return at ${r.index}`).toContain("t.Close();");
        last = (r.index ?? 0) + 6;
      }
      // The ok answer closes too.
      expect(rest.slice(last), a).toContain("t.Close();");
    });
  }

  it("the reads open for read, take no project guard and never save", () => {
    for (const a of READS) {
      const body = method(src, METHOD[a]);
      expect(body, a).toContain("t.OpenRead(req.path)");
      expect(body, a).not.toContain("ProjectRefused");
      expect(body, a).not.toContain("OpenWrite");
      expect(body, a).not.toContain(".Save(");
    }
  });

  it("every write checks the project first, opens for write, saves once and only after the dry run", () => {
    for (const a of WRITES) {
      const body = method(src, METHOD[a]);
      const first = body.indexOf("{") + 1;
      expect(body.slice(first).trim().startsWith("if (ProjectRefused(resp))"), a).toBe(true);
      expect(body, a).toContain("t.OpenWrite(req.path)");
      const dry = body.indexOf("if (!req.confirm)");
      const dryReturn = body.indexOf("return;", body.indexOf("resp.dryRun = true;", dry));
      const saves = [...body.matchAll(/t\.m_Meta\.Save\(\);/g)];
      expect(dry, a).toBeGreaterThanOrEqual(0);
      expect(saves.length, a).toBe(1);
      expect(saves[0].index, a).toBeGreaterThan(dryReturn);
      expect(body.slice(saves[0].index), a).toMatch(/t\.m_Meta\.Save\(\);\s*resp\.saved = true;/);
      // Nothing is written before the dry-run branch.
      for (const w of ["WriteFromText", "ClearVariable(", "SetAncestor(", "SetObjectArray("])
        if (body.includes(w)) expect(body.indexOf(w), `${a} ${w}`).toBeGreaterThan(dryReturn);
    }
  });

  it("ProjectRefused refuses with the guard's code; OpenFailed refuses NOT_IN_PROJECT", () => {
    expect(method(src, "ProjectRefused")).toContain(
      "Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT,",
    );
    expect(method(src, "OpenFailed")).toMatch(
      /if \(t\.m_Code == EMCP_WB_Guard\.NOT_IN_PROJECT\)\s*\{\s*Answer\(resp, EMCP_WB_Guard\.REFUSED, t\.m_Code,/,
    );
    const answer = method(src, "Answer");
    expect(answer).toContain("resp.next = nextStep;");
    expect(answer).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
  });
});

describe("engine calls are the spec's (section 2.2)", () => {
  const CALLS: Record<string, string[]> = {
    get: [
      "meta.GetResourceID()",
      "meta.GetSourceFilePath()",
      "meta.GetObjectArray(CONFIGURATIONS)",
      "list.Count()",
      "list.Get(i)",
      "config.GetName()",
      "config.GetClassName()",
      "AncestorName(config)",
      'meta.Get("Tags", tagText)',
    ],
    vars: ["config.GetNumVars()", "VarCells(config, i, cells)", "Selected(t.m_Meta,"],
    set: [
      "config.GetVarIndex(req.name)",
      "EMCP_WB_Container.CheckText(dataType, text, why)",
      "EMCP_WB_Container.WriteFromText(target, req.name, writeType, texts.Get(w), why)",
      "Selected(t.m_Meta, req.platform, req.allPlatforms, picked, why)",
    ],
    clear: [
      "target.ClearVariable(req.name)",
      "Selected(t.m_Meta, req.platform, req.allPlatforms, picked, why)",
    ],
    setAncestor: [
      "BaseContainerTools.LoadContainer(ancestorName)",
      "config.SetAncestor(ancestorName)",
      "Selected(t.m_Meta, req.platform, false, picked, why)",
    ],
    assignMaterial: [
      "t.m_Meta.GetObjectArray(CONFIGURATIONS)",
      "configs.Get(0)",
      "config.GetVarIndex(MATERIAL_ASSIGNS)",
      "config.SetObjectArray(MATERIAL_ASSIGNS)",
      "BaseContainerTools.CreateContainer(MATERIAL_ASSIGN_CLASS)",
      "created.Set(SOURCE_MATERIAL, req.name)",
      "created.Set(ASSIGNED_MATERIAL, material)",
      "assign.Set(ASSIGNED_MATERIAL, material)",
      "assigns.Insert(created, -1)",
      "BaseContainerTools.LoadContainer(material)",
    ],
  };
  for (const [a, calls] of Object.entries(CALLS)) {
    it(a, () => {
      const body = method(src, METHOD[a]);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  it("a variable's schema: the spec's ten calls, each on the types it answers for", () => {
    const body = method(src, "VarCells");
    for (const call of [
      "config.GetVarName(varIndex)",
      "config.GetDataVarType(varIndex)",
      "config.GetDefaultAsString(varName, defaultText)",
      "config.IsVariableSet(varName)",
      "config.IsVariableSetDirectly(varName)",
      "config.GetUIWidget(varIndex)",
      "config.GetLimits(varIndex, low, high, step)",
      "config.GetEnumValues(varIndex, enumNames, enumValues)",
      "config.GetObjectBaseClass(varIndex)",
      "ValueText(config, varName, dataType)",
    ])
      expect(body, call).toContain(call);
    expect(body).toMatch(
      /if \(dataType == DataVarType\.SCALAR \|\| dataType == DataVarType\.INTEGER\)\s*\{[^}]*GetLimits/,
    );
    expect(body).toMatch(/if \(dataType == DataVarType\.INTEGER\)\s*\{[^]*?GetEnumValues/);
    expect(body).toMatch(
      /if \(dataType == DataVarType\.OBJECT \|\| dataType == DataVarType\.OBJECT_ARRAY\)\s*objectClass = config\.GetObjectBaseClass/,
    );
    expect(src).toContain(
      'static const string ALL_COLUMNS = "name,type,default,set,setDirectly,value,widget,limits,enum,objectClass";',
    );
  });

  it("values go through the shipped EMCP_WB_Container text helpers", () => {
    const container = code(other("Container"));
    for (const helper of ["ReadAsText", "WriteFromText", "CheckText", "IsScalar"])
      expect(container, helper).toMatch(new RegExp(`static \\w+ ${helper}\\(`));
    expect(method(src, "ValueText")).toContain(
      "EMCP_WB_Guard.ScrubHome(EMCP_WB_Container.ReadAsText(cont, varName, dataType))",
    );
  });

  it("set checks every configuration before writing any", () => {
    const body = method(src, "SetVar");
    expect(body.indexOf("CheckText")).toBeLessThan(body.indexOf("if (!req.confirm)"));
    expect(body.indexOf("WriteFromText")).toBeGreaterThan(body.indexOf("if (!req.confirm)"));
    expect(body).toContain("IntegerText(config, varIndex, req.value, text)");
  });

  it("setAncestor refuses an ancestor that is not a loadable {GUID}path before opening the meta", () => {
    const body = method(src, "SetAncestorOf");
    const guid = body.indexOf('if (!req.value.StartsWith("{"))');
    const load = body.indexOf("if (!ancestorHolder || !ancestorHolder.IsValid())");
    const open = body.indexOf("t.OpenWrite(req.path)");
    expect(guid).toBeGreaterThanOrEqual(0);
    expect(guid).toBeLessThan(load);
    expect(load).toBeLessThan(open);
  });

  it("assignMaterial writes a model's meta only, and a lost slot refuses the save", () => {
    const body = method(src, "AssignMaterial");
    expect(body).toMatch(
      /if \(!config \|\| config\.GetVarIndex\(MATERIAL_ASSIGNS\) == -1\)\s*\{\s*t\.Close\(\);\s*Answer\(resp, "error", UNSUPPORTED_TYPE,/,
    );
    expect(body).toContain('lowerValue.EndsWith(".emat")');
    const lost = body.indexOf("if (afterSlots.Find(had) < 0)");
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(body.indexOf("t.m_Meta.Save();"));
    expect(src).toContain('static const string MATERIAL_ASSIGN_CLASS = "MaterialAssignClass";');
  });
});

describe("paging", () => {
  it("limit default 50, max 200", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    const limit = contract.actions
      .find((x) => x.name === "vars")
      ?.params.find((p) => p.key === "limit");
    expect(limit?.note).toBe("default 50, max 200");
  });

  it("the cursor is <start>:<count> and a changed total answers STALE_CURSOR", () => {
    const body = method(src, "ListVars");
    expect(body).toContain("ParseCursor(req.cursor, start, issuedFor)");
    expect(body).toMatch(
      /if \(issuedFor != total\)\s*\{\s*t\.Close\(\);\s*Answer\(resp, "error", STALE_CURSOR,/,
    );
    expect(body).toContain('resp.nextCursor = end.ToString() + ":" + total.ToString();');
    const parse = method(src, "ParseCursor");
    expect(parse).toContain('cursorText.IndexOf(":")');
    expect(parse).toContain("if (startValue > countValue)");
  });

  it("fields keeps known columns only", () => {
    const body = method(src, "KeptColumns");
    expect(body).toContain("int at = all.Find(trimmed);");
    expect(body).toMatch(/if \(at < 0\)\s*\{\s*why = "unknown column/);
  });
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:api:ResourceManager.GetMetaFile/1
// census:mcp:handler-action/EMCP_WB_Meta.clear
// census:mcp:handler-action/EMCP_WB_Meta.get
// census:mcp:handler-action/EMCP_WB_Meta.set
// census:mcp:handler-action/EMCP_WB_Meta.setAncestor
// census:mcp:handler-action/EMCP_WB_Meta.vars
