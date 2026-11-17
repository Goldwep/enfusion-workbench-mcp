/**
 * EMCP_WB_Info.c checked over the Enforce text offline (DEC-048 package 3.3, Info unit). Nothing
 * here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const info = readFileSync(join(DIR, "EMCP_WB_Info.c"), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const c = code(info);

describe("EMCP_WB_Info", () => {
  it("is a NetApiHandler answering the build stamp", () => {
    expect(c).toMatch(/^class EMCP_WB_Info : NetApiHandler\s*$/m);
    expect(c).toContain("resp.buildStamp = EMCP_WB_BuildStamp.VALUE;");
  });

  it("reads the project state only through the shared guard (DEC-058)", () => {
    expect(c).toContain("resp.projectFound = EMCP_WB_Guard.IsProjectFound();");
    expect(c).toContain("resp.projectName = EMCP_WB_Guard.ProjectId();");
    expect(c).not.toContain("isSandbox");
  });

  it("reads modules through ModuleTypeForRead, never the Particle Editor", () => {
    expect(c).toContain("EMCP_WB_Guard.ModuleTypeForRead(moduleName)");
    expect(c).not.toMatch(/GetModule\(ParticleEditor\)/);
    expect(c).not.toMatch(/ModuleTypeForOpen|\bModuleType\(/);
    // No GetModule at all: it opens a closed module's window (sitting P3-3 gate 1).
    expect(c).not.toMatch(/Workbench\.GetModule\(/);
    for (const n of [
      "AnimEditor",
      "AudioEditor",
      "BehaviorEditor",
      "LocalizationEditor",
      "ParticleEditor",
      "ProcAnimEditor",
      "ResourceManager",
      "ScriptEditor",
      "WorldEditor",
    ]) {
      expect(c).toContain(`"${n}"`);
    }
    expect(c).not.toContain("DialogueEditor");
    expect(c).not.toContain('"NavmeshGeneratorMain"'); // W5 OD-5 (DEC-068)
  });

  it("opens, loads, writes nothing and uses no banned call", () => {
    for (const banned of [
      "OpenModule",
      "OpenResource",
      "SetOpenedResource",
      "Save",
      "FileIO.",
      "FindFiles",
      "Workbench.Dialog",
      "RunCommandline",
      "Configure",
      "BeginEntityAction",
      "GetContainer",
      "ScriptDialog",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("does not read the world path (GetModule(WorldEditor) would open the World Editor)", () => {
    expect(c).not.toContain("GetWorldPath");
    expect(c).toContain('resp.worldPathForm = "unread";');
    expect(c).toContain('resp.worldPath = "";');
  });

  it("keeps the file-prompt hazard flag true (U27 unsettled)", () => {
    expect(c).toContain("resp.filePromptHazard = true;");
  });

  it("lists exactly the handler classes of the folder, itself included, with a matching count", () => {
    const list = /HANDLERS = "([^"]+)"/.exec(c)![1].split(",");
    const count = Number(/HANDLER_COUNT = (\d+);/.exec(c)![1]);
    expect(list).toHaveLength(count);
    expect(new Set(list).size).toBe(count);
    expect(list).toContain("EMCP_WB_Info");
    const shipped = new Set<string>();
    for (const f of readdirSync(DIR).filter((f) => f.endsWith(".c"))) {
      const src = readFileSync(join(DIR, f), "utf-8");
      for (const m of src.matchAll(/^class (\w+) : NetApiHandler/gm)) shipped.add(m[1]);
    }
    expect([...shipped].sort()).toEqual([...list].sort());
    expect(c).toContain('resp.handlerSource = "compiled constant";');
  });

  it("refuses an unknown action in the guard's refusal form", () => {
    expect(c).toContain('req.action != "" && req.action != "info"');
    expect(c).toContain('EMCP_WB_Guard.RefusalMessage("INVALID_ARGUMENT"');
  });

  it("matches its per-action contract", () => {
    const contract = loadContract(join("contracts", "EMCP_WB_Info.json"));
    expect(contract.actions.map((a) => a.name)).toEqual(["info"]);
    expect(contract.actions[0].mutating).toBe(false);
    expect(regVKeys(info, "EMCP_WB_InfoRequest").sort()).toEqual([...contract.request].sort());
    expect(regVKeys(info, "EMCP_WB_InfoResponse").sort()).toEqual([...contract.response].sort());
  });
});
