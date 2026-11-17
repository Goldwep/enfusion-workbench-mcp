/**
 * The shipped guard (EMCP_WB_Guard.c) and the Ping build stamp, checked over the Enforce text
 * offline (DEC-048 package 3.3). Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const guard = readFileSync(join(DIR, "EMCP_WB_Guard.c"), "utf-8");
const ping = readFileSync(join(DIR, "EMCP_WB_Ping.c"), "utf-8");
const probeGuard = readFileSync(join("mod-dev", "probe-mut", "ECEN_ProbeMutGuard.c"), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` up to the next method separator. */
function method(src: string, name: string): string {
  const at = src.search(new RegExp(`static \\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("//-----", at);
  return src.slice(at, end < 0 ? undefined : end);
}

/** Module names a ModuleType-style method maps, from its `name == "X"` tests. */
function moduleNames(body: string): string[] {
  // NavmeshGeneratorMain is resolved by name (name.ToType()): its class is absent from build
  // 1.9.0.37 on, and a class named as a type would not compile there.
  return [...body.matchAll(/name == "([A-Za-z]+)"\)\s*moduleType = ([\w.()]+);/g)].map((m) => {
    if (m[1] === "NavmeshGeneratorMain") expect(m[2]).toBe("name.ToType()");
    else expect(m[1]).toBe(m[2]);
    return m[1];
  });
}

const PRESENT = [
  "AnimEditor",
  "AudioEditor",
  "BehaviorEditor",
  "LocalizationEditor",
  "ParticleEditor",
  "ProcAnimEditor",
  "ResourceManager",
  "ScriptEditor",
  "WorldEditor",
];

describe("EMCP_WB_Guard", () => {
  it("is one static class with the API the handlers call", () => {
    expect(guard).toMatch(/^class EMCP_WB_Guard\s*$/m);
    for (const sig of [
      "static bool Project(out string addonId, out string projectDir, out string why)",
      "static bool ProjectDir(out string projectDir, out string why)",
      "static bool IsProjectFound()",
      "static string ProjectId()",
      "static bool TargetInsideProject(string rel, out string absolute, out string why)",
      "static bool NewTargetInProject(string rel, out string absolute, out string why)",
      "static bool SourceAddonsAreOnly(BaseContainer cont, string addon, out string sourceAddons)",
      "static typename ModuleType(string name)",
      "static typename ModuleTypeForRead(string name)",
      "static typename ModuleTypeForOpen(string name)",
      "static string RefusalMessage(string code, string text, string nextStep)",
    ]) {
      expect(guard).toContain(sig);
    }
  });

  it("contains no FileIO.FindFiles, Workbench.Dialog, RunCommandline or Configure call", () => {
    const c = code(guard);
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "RunCommandline",
      "Configure",
      "FileIO.",
    ]) {
      expect(c).not.toContain(banned);
    }
  });

  it("ModuleType maps exactly the 9 present modules, no Dialogue Editor or NavmeshGeneratorMain", () => {
    const names = moduleNames(method(guard, "ModuleType"));
    expect([...names].sort()).toEqual(PRESENT);
    expect(guard).not.toMatch(/moduleType = DialogueEditor/);
    // W5 OD-5 (DEC-068): the class is gone from 1.9.0.37.
    expect(method(guard, "ModuleType")).not.toContain("NavmeshGeneratorMain");
  });

  it("reads refuse the Particle Editor, open allows it", () => {
    const read = method(guard, "ModuleTypeForRead");
    expect(read).toContain('if (name != "ParticleEditor")');
    expect(read).toContain("moduleType = ModuleType(name);");
    expect(method(guard, "ModuleTypeForOpen")).toContain("return ModuleType(name);");
  });

  it("the path rules occur in both guards", () => {
    for (const line of [
      "if (!FilePath.IsAbsolutePath(dir))",
      'if (s.Contains(":"))',
      'if (part == "" || part == "." || part == "..")',
      'if (a.Contains("/../") || a.EndsWith("/..") || a.Contains("/./") || a.EndsWith("/."))',
      'return a.StartsWith(f + "/");',
    ]) {
      expect(probeGuard, line).toContain(line);
      expect(guard, line).toContain(line);
    }
  });

  // DEC-058: no project name is compiled in; the project is the one loaded addon that carries
  // the handler set as loose files, so the guard holds for whatever project the user opened.
  it("finds the project by the handler set, not by a compiled-in name (DEC-058)", () => {
    expect(guard).toContain(
      'static const string SELF_PATH = "Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Guard.c";',
    );
    expect(guard).toContain('static const string NOT_IN_PROJECT = "NOT_IN_PROJECT";');
    const body = method(guard, "Project");
    expect(body).toContain("GameProject.GetLoadedAddons(addons);");
    expect(body).toContain("string id = GameProject.GetAddonID(addons.Get(i));");
    expect(body).toContain(
      'if (!Workbench.GetAbsolutePath("$" + id + ":" + SELF_PATH, file, true))',
    );
    expect(body).toContain("if (found == 1)");
    for (const gone of [
      "SANDBOX_FOLDER",
      "SANDBOX_GPROJ",
      "THROWAWAY",
      "SandboxDir",
      "IsSandboxProject",
      "OpenedProjectName",
      "TargetInsideThrowaway",
      "EMCP2_sandbox",
      "_throwaway",
      "NOT_SANDBOX",
    ]) {
      expect(code(guard), gone).not.toContain(gone);
    }
  });

  it("CleanRelative, Fold and IsUnder equal the probe's bodies, why-strings aside", () => {
    const norm = (body: string) =>
      code(body)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("why = "))
        .join("\n");
    for (const name of ["CleanRelative", "Fold", "IsUnder"]) {
      expect(norm(method(guard, name)), name).toBe(norm(method(probeGuard, name)));
    }
  });

  it("TargetInsideProject admits any clean path inside the project folder, reads and writes (DEC-058)", () => {
    const body = method(guard, "TargetInsideProject");
    expect(body).toContain('string candidate = projectDir + "/" + clean;');
    expect(body).toContain("if (!IsUnder(candidate, projectDir))");
    expect(body).not.toContain("StartsWith(");
  });

  it("TargetInsideProject checks the project, then the relative path, then containment", () => {
    const body = method(guard, "TargetInsideProject");
    const at = [
      "ProjectDir(projectDir, why)",
      "CleanRelative(rel, clean, why)",
      "IsUnder(candidate, projectDir)",
    ].map((s) => body.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  // W1 spec section 1: a new file is clean, inside the project, and its parent folder exists
  // per Workbench.GetAbsolutePath(..., true); never a FileIO call (DEC-053/U27).
  it("NewTargetInProject: clean, under the project, parent folder resolved by the engine", () => {
    expect(guard).toContain(
      "static bool NewTargetInProject(string rel, out string absolute, out string why)",
    );
    const body = method(guard, "NewTargetInProject");
    const at = [
      "Project(addonId, projectDir, why)",
      "CleanRelative(rel, clean, why)",
      "IsUnder(candidate, projectDir)",
      'clean.LastIndexOf("/")',
      'Workbench.GetAbsolutePath("$" + addonId + ":" + parentRel, parentAbs, true)',
      "IsUnder(parentAbs, projectDir)",
      "absolute = candidate;",
    ].map((s) => body.indexOf(s));
    expect(
      at.every((i) => i >= 0),
      JSON.stringify(at),
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(body).toContain('string candidate = projectDir + "/" + clean;');
    expect(body).toContain("string parentRel = clean.Substring(0, slash);");
    expect(body).toMatch(/absolute = "";\s*why = "";/);
    expect(code(body)).not.toContain("FileIO");
    expect(code(body)).not.toContain("FileExists");
  });

  it("SourceAddonsAreOnly refuses any other addon and a null container, allows an empty list, and joins the list", () => {
    const body = method(guard, "SourceAddonsAreOnly");
    expect(body).toContain("if (!cont)");
    expect(body).toContain("cont.GetSourceAddons(names);");
    expect(body).toContain("bool allowed = true;");
    expect(body).toMatch(/if \(name != addon\)\s*allowed = false;/);
    expect(body).toContain('sourceAddons += ",";');
    expect(body).not.toContain("Count() == 1");
  });

  it("the refusal message has the fixed 'CODE: text | next: step' form", () => {
    const body = method(guard, "RefusalMessage");
    expect(body).toContain('string message = code + ": " + text;');
    expect(body).toContain('message = message + " | next: " + nextStep;');
    expect(guard).toContain('static const string REFUSED = "refused";');
  });

  it("carries no home path and does not take the game project for the addon", () => {
    expect(guard).not.toMatch(/[A-Za-z]:[\\/]Users[\\/]/i);
    expect(code(guard)).not.toContain("GetCurrentGameProjectFile");
  });
});

describe("EMCP_WB_Ping build stamp", () => {
  const contract = loadContract(join("contracts", "EMCP_WB_Ping.json"));

  it("the contract loads and matches the RegV keys of the handler", () => {
    expect(contract.handler).toBe("EMCP_WB_Ping");
    expect(regVKeys(ping, "EMCP_WB_PingRequest")).toEqual(contract.request);
    expect(regVKeys(ping, "EMCP_WB_PingResponse")).toEqual(contract.response);
    expect(contract.actions.map((a) => a.name)).toEqual(["ping"]);
    expect(contract.actions[0].mutating).toBe(false);
  });

  it("keeps the 1.x fields and answers the generated constant as buildStamp", () => {
    const keys = regVKeys(ping, "EMCP_WB_PingResponse");
    for (const key of ["status", "mode", "message", "buildStamp"]) expect(keys).toContain(key);
    expect(ping).toContain("resp.buildStamp = EMCP_WB_BuildStamp.VALUE;");
    const stamp = readFileSync(join(DIR, "EMCP_WB_BuildStamp.c"), "utf-8");
    expect(stamp).toMatch(/static const string VALUE = "[0-9a-f]{40}";/);
  });
});
