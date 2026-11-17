/**
 * EMCP_WB_Validate.c (wave W2, phase5-w2-spec.md section 2.3, ruling OD-7: replaces the 1.x route
 * through BI's MaterialValidator and TextureValidator handlers and closes KD-011) checked over its
 * Enforce text offline: the contract matches the structs and the per-action reads and writes, BI's
 * checks run in BI's order with BI's constants, every input BI dereferences unchecked is checked
 * first, the texture type is found without reaching FileIO, and the fix sits behind the project
 * guard and a dry run. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { checkedDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Validate.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Validate.json"));
const meta = readFileSync(join(DIR, "EMCP_WB_Meta.c"), "utf-8");

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

/** Positions of each needle in body, in the order given; every one present and strictly rising. */
function inOrder(body: string, needles: string[], label: string): void {
  let last = -1;
  for (const n of needles) {
    const at = body.indexOf(n, last + 1);
    expect(at, `${label}: ${n}`).toBeGreaterThan(last);
    last = at;
  }
}

const C = code(src);
const NO_STRINGS = C.replace(/"[^"\n]*"/g, '""');

const METHOD: Record<string, string> = {
  material: "ValidateMaterial",
  texture: "ValidateTexture",
  fixTexture: "FixTexture",
};
const CHECKS = [
  "CheckConfigurations",
  "CheckAncestors",
  "CheckUnnecessarySettingInPc",
  "CheckSuspiciousNonPcSetting",
  "CheckWrongPropertyValues",
];

describe("EMCP_WB_Validate structs and contract", () => {
  it("request and response RegV keys are the contract's, in order", () => {
    expect(regVKeys(src, "EMCP_WB_ValidateRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ValidateResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action, each to its own method, and nothing else", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*(\w+)\(req, resp\)/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    for (const m of branches) expect(m[2], m[1]).toBe(METHOD[m[1]]);
  });

  it("material and texture read; fixTexture is mutating and project-only; nothing pages", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(a.name === "fixTexture");
      expect(a.projectOnly, a.name).toBe(a.name === "fixTexture");
      expect(a.paging, a.name).toBe(false);
      expect(a.params.map((p) => p.key).includes("confirm"), a.name).toBe(a.name === "fixTexture");
    }
  });

  it("keeps the tool description within its 400-char budget", () => {
    expect(checkedDescription(contract).length).toBeLessThanOrEqual(400);
  });
});

describe("forbidden calls", () => {
  it("no FindFiles, Dialog, RunCommandline, Configure, FileIO, and none of BI's dialog-bound paths", () => {
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
      // KD-011: the BI handlers and the static array only the plugin's dialog fills.
      "ValidateMaterialPlugin",
      "MaterialValidator(",
      "TextureValidator",
      "TextureImportSettings",
      // DoChecks runs FindTextureType again on its own and would ignore typeName.
      "DoChecks",
      "RebuildResourceFiles",
    ]) {
      expect(NO_STRINGS, banned).not.toContain(banned);
    }
  });

  it("names no sandbox and no project", () => {
    expect(src).not.toMatch(/EMCP2_sandbox|_throwaway|sandbox/i);
  });

  it("uses no ternary operator and no out parameter of an engine type", () => {
    expect(NO_STRINGS).not.toContain("?");
    expect(C).not.toMatch(
      /out\s+(MetaFile|BaseContainer|BaseContainerList|Resource|ResourceManager)\b/,
    );
  });
});

describe("material: BI's five checks (ValidateMaterialPlugin.c, MaterialValidator.GetResponse)", () => {
  const body = method(src, "ValidateMaterial");

  it("loads the .emat with LoadContainer and null-checks every step", () => {
    inOrder(
      body,
      [
        'lowerPath.EndsWith(".emat")',
        "BaseContainerTools.LoadContainer(materialName)",
        "if (!holder || !holder.IsValid())",
        "holder.GetResource()",
        "if (!resourceObject)",
        "resourceObject.ToBaseContainer()",
        "if (!mat)",
      ],
      "load",
    );
  });

  it("runs the checks in BI's order with BI's constants", () => {
    inOrder(
      body,
      [
        "new MaterialValidatorUtils()",
        "new MaterialValidatorResponse()",
        "utils.ValidateUVs(mat, UV_MIN, UV_MAX, report)",
        "utils.CheckDefaults(mat, report)",
        "utils.CheckExtremes(mat, EXTREME_MIN, EXTREME_MAX, report)",
        "utils.CheckDependencies(mat, report)",
        "utils.CheckTextures(mat, report)",
      ],
      "checks",
    );
    expect(src).toContain("static const float UV_MIN = 0;");
    expect(src).toContain("static const float UV_MAX = 5;");
    expect(src).toContain("static const float EXTREME_MIN = 5;");
    expect(src).toContain("static const float EXTREME_MAX = 95;");
  });

  it("CheckTextures runs only when TextureHazard finds nothing, else the skip is reported", () => {
    expect(body).toMatch(
      /string hazard = TextureHazard\(mat\);\s*if \(hazard == ""\)\s*utils\.CheckTextures\(mat, report\);/,
    );
    expect(body).toMatch(/if \(hazard != ""\)\s*resp\.reports\.Insert\(SKIPPED \+/);
  });

  it("answers BI's reports with their severity, the highest as severity, textures scrubbed", () => {
    expect(body).toContain("report.severity.Get(i)");
    expect(body).toContain("if (reportSeverity > highest)");
    expect(body).toContain("resp.severity = highest;");
    expect(body).toContain("EMCP_WB_Guard.ScrubHome(texturePath)");
    expect(body).toContain("report.abs_textures");
  });

  it("TextureHazard checks what CheckTextures dereferences unchecked, with its own calls", () => {
    const hazard = method(src, "TextureHazard");
    for (const check of [
      'texture.Contains(".edds")',
      'texturePath.EndsWith(" 0")',
      "if (texturePath.Length() < 18)",
      "Workbench.GetResourceName(guid) == guid",
      "resourceManager.GetMetaFile(stripped.GetPath())",
      "if (!configs || configs.Count() == 0 || !configs.Get(0))",
      "configs.Get(0).GetClassName().Length() < 3",
      "meta.Release(false);",
      'fileName.LastIndexOf("_")',
      "if (dot < 0 || dot - underscore - 1 < 1)",
    ])
      expect(hazard, check).toContain(check);
  });
});

describe("texture checks (TextureImportTool.c, BatchTextureProcessorPlugin order)", () => {
  it("RunChecks calls the five checks in order and stops at the first fatal one", () => {
    const body = method(src, "RunChecks");
    inOrder(
      body,
      [
        "types.CheckConfigurations(op, resourceName, meta)",
        "types.CheckAncestors(op, resourceName, meta, texType)",
        "types.CheckUnnecessarySettingInPc(op, resourceName, meta)",
        "types.CheckSuspiciousNonPcSetting(op, resourceName, meta)",
        "types.CheckWrongPropertyValues(op, resourceName, meta, texType)",
      ],
      "checks",
    );
    expect([...body.matchAll(/if \(!stop\)/g)].length).toBe(4);
    expect(body).toContain('resp.checks.Insert(names.Get(i) + "=" + SKIPPED);');
    for (const c of CHECKS) expect(body, c).toContain(`"${c}"`);
    const record = method(src, "Record");
    expect(record).toContain("typename.EnumToString(TextureCheckResult, result)");
    expect(record).toMatch(
      /if \(result == TextureCheckResult\.UnfixedFatalIssue\)\s*\{\s*resp\.fatal = true;/,
    );
  });

  it("texture runs with Ignore and never saves", () => {
    const body = method(src, "ValidateTexture");
    expect(body).toContain("t.OpenRead(req.path)");
    expect(body).toContain(
      "RunChecks(types, TextureIssueOp.Ignore, resourceName, t.m_Meta, texType, resp)",
    );
    expect(body).not.toContain("ReportAndFix");
    expect(body).not.toContain(".Save(");
    expect(body).toContain("Workbench.GetResourceName(t.m_Rel)");
  });

  it("the meta is checked to be a texture's before the type is picked or a check runs", () => {
    const body = method(src, "Prepare");
    inOrder(
      body,
      ["TextureMetaProblem(t.m_Meta)", "PickType(types, req.typeName, t.m_Rel, why)"],
      "prepare",
    );
    const problem = method(src, "TextureMetaProblem");
    expect(problem).toContain("if (!configs || configs.Count() == 0)");
    expect(problem).toContain("if (!configs.Get(i))");
    for (const cls of ["PNGResourceClass", "TIFFResourceClass", "EDDSResourceClass"])
      expect(problem, cls).toContain(`"${cls}"`);
  });

  it("FindTextureType is called only once a non-font suffix matched (no FileIO.FileExists)", () => {
    const body = method(src, "PickType");
    inOrder(
      body,
      [
        'if (typeName != "")',
        "named.m_PostFix == wanted",
        "FontTextureType.Cast(candidate)",
        "SuffixMatches(candidate.m_PostFix, path)",
        "return candidate;",
        "detecting the font or unspecified type would call FileIO.FileExists",
      ],
      "pick",
    );
    // FindTextureType is not called: its walk is replayed with the font type skipped (FileIO never reachable).
    expect([...C.matchAll(/FindTextureType\(/g)].length).toBe(0);
    const suffix = method(src, "SuffixMatches");
    expect(suffix).toContain("FilePath.StripExtension(path)");
    expect(suffix).toContain("pathNoExt.ToLower();");
    expect(suffix).toContain("return pathNoExt.EndsWith(postFix);");
  });

  it("every return after the meta is opened releases it first", () => {
    for (const a of ["texture", "fixTexture"]) {
      const body = method(src, METHOD[a]);
      const after = body.indexOf("}", body.indexOf("OpenFailed(t, resp);")) + 1;
      const rest = body.slice(after);
      let last = 0;
      for (const r of rest.matchAll(/\breturn\b/g)) {
        expect(rest.slice(last, r.index), `${a}: return at ${r.index}`).toContain("t.Close();");
        last = (r.index ?? 0) + 6;
      }
      expect(rest.slice(last), a).toContain("t.Close();");
    }
  });
});

describe("fixTexture", () => {
  const body = method(src, "FixTexture");

  it("checks the project first and opens an existing file of the project", () => {
    const first = body.indexOf("{") + 1;
    expect(body.slice(first).trim().startsWith("if (!EMCP_WB_Guard.IsProjectFound())")).toBe(true);
    expect(body).toContain("EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT,");
    expect(body).toContain("t.OpenWrite(req.path)");
    expect(method(meta, "OpenWrite")).toContain("EMCP_WB_Guard.TargetExistsInProject(");
  });

  it("the dry run runs Ignore and answers the current values; the fix runs only on confirm", () => {
    const dry = body.indexOf("if (!req.confirm)");
    const dryReturn = body.indexOf("return;", dry);
    const dryPart = body.slice(dry, dryReturn);
    expect(dryPart).toContain("TextureIssueOp.Ignore");
    expect(dryPart).toContain("resp.dryRun = true;");
    expect(dryPart).not.toContain("Save(");
    const fix = body.indexOf("TextureIssueOp.ReportAndFix");
    expect(fix).toBeGreaterThan(dryReturn);
  });

  it("saves once, only when a check changed something, then answers the changed values", () => {
    const saves = [...body.matchAll(/t\.m_Meta\.Save\(\);/g)];
    expect(saves.length).toBe(1);
    expect(body).toMatch(
      /if \(!changed\)\s*\{\s*t\.Close\(\);\s*Answer\(resp, "ok", "", "nothing to fix/,
    );
    inOrder(
      body,
      [
        "Snapshot(t.m_Meta, beforeLines)",
        "bool changed = RunChecks(types, TextureIssueOp.ReportAndFix,",
        "Snapshot(t.m_Meta, afterLines)",
        "t.m_Meta.Save();",
        "resp.saved = true;",
      ],
      "fix",
    );
  });

  it("rebuilds only when asked and only after the save", () => {
    inOrder(
      body,
      [
        "t.m_Meta.Save();",
        "if (req.rebuild)",
        "t.m_Manager.RebuildResourceFile(t.m_Abs, REBUILD_CONFIGURATION, false)",
        "resp.rebuilt = t.m_Manager.WaitForFile(t.m_Abs, REBUILD_WAIT_MS)",
      ],
      "rebuild",
    );
    expect(src).toContain('static const string REBUILD_CONFIGURATION = "PC";');
  });
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:handler-action/EMCP_WB_Validate.fixTexture
// census:mcp:handler-action/EMCP_WB_Validate.material
// census:mcp:handler-action/EMCP_WB_Validate.texture
