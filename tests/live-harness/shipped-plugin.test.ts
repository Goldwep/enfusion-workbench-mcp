/**
 * The shipped plugin handler (EMCP_WB_Plugin.c), checked over the Enforce text offline (DEC-048
 * package 3.3, Plugin unit). Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { NEVER_CALLED, loadAllowList } from "../../src/tools/wb-plugin.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const src = readFileSync(join(DIR, "EMCP_WB_Plugin.c"), "utf-8");
const probe = readFileSync(join("mod-dev", "probe", "ECEN_ProbeModules.c"), "utf-8");
const probeUtil = readFileSync(join("mod-dev", "probe", "ECEN_ProbeUtil.c"), "utf-8");
// The one ScrubHome of the shipped handlers; Plugin and Container call it.
const guard = readFileSync(join(DIR, "EMCP_WB_Guard.c"), "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Plugin.json"));

/** Source with comments and string literals blanked, so only code counts as a call. */
function code(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** Body of `static <type> <name>(` up to the next method separator. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`static [\\w<>]+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const end = s.indexOf("//-----", at);
  return s.slice(at, end < 0 ? undefined : end);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("EMCP_WB_Plugin.c", () => {
  it("never calls RunCommandline, Configure, Workbench.Dialog, FileIO or a writer", () => {
    const c = code(src);
    for (const re of [
      /RunCommandline\s*\(/,
      /Configure\s*\(/,
      /Workbench\.Dialog/,
      /FileIO\./,
      /OpenModule/,
      /SetVariableValue/,
    ]) {
      expect(c, String(re)).not.toMatch(re);
    }
  });

  it("calls Run once, in RunPlugin, after the modal, allow-list, precondition and proof checks (W6)", () => {
    expect(code(src).match(/\.Run\s*\(/g)).toHaveLength(1);
    const body = method(src, "RunPlugin");
    const at = (s: string) => body.indexOf(s);
    expect(at("plugin.Run();")).toBeGreaterThan(0);
    for (const before of [
      "if (NeverCalled(pluginClass))",
      "if (IsModal(pluginClass))",
      "if (!RunListed(moduleName, pluginClass))",
      "if (!EMCP_WB_Guard.IsProjectFound())",
      "if (!Preconditions(pluginClass, unmetCode, unmetWhy))",
      "if (!req.confirm)",
      "if (!RunProven(pluginClass))",
      "WorkbenchPlugin plugin = wbModule.GetPlugin(pluginType);",
    ]) {
      expect(at(before), before).toBeGreaterThan(0);
      expect(at(before), before).toBeLessThan(at("plugin.Run();"));
    }
    // RunProven is true only for the three live-proven DEC-103 classes; the other ten stay false (DEC-069).
    const proven = method(src, "RunProven");
    expect(proven.match(/return true;/g)).toHaveLength(3);
    expect(
      [...proven.matchAll(/if \(pluginClass == "(\w+)"\)\s*return true; \/\/ DEC-103/g)]
        .map((m) => m[1])
        .sort(),
    ).toEqual(["CameraOrientationTool", "SCR_CheckRuinModelsAndUsagePlugin", "SCR_LocLengthPlugin"]);
  });

  it("refuses RunCommandline and Configure by name, with the pinned text", () => {
    expect(method(src, "NeverCalled")).toContain(
      'return entryPoint == "RunCommandline" || entryPoint == "Configure";',
    );
    expect(method(src, "FindPlugin")).toContain("if (NeverCalled(pluginClass))");
    expect(src).toContain(`static const string NEVER_CALLED = "${NEVER_CALLED}";`);
    // The P3 GATED path retired with W6 (spec 1.1).
    expect(src).not.toContain("RefuseGated");
    expect(src).not.toContain("GATED_NEXT");
  });

  it("setSettings with confirm refuses NO_SETTER and writes nothing (P-W6-03, DEC-069 OD-4)", () => {
    const body = method(src, "SetSettings");
    expect(body).toContain("resp.Refuse(NO_SETTER, NO_SETTER_TEXT");
    expect(code(body)).not.toMatch(/SetVariableValue|SetClassVar/);
  });

  it("the compiled allow-list equals policy.json plugin_read_allow_list.allow_list", () => {
    const listed = [
      ...method(src, "Listed").matchAll(/moduleId == "(\w+)" && pluginClass == "(\w+)"/g),
    ].map((m) => ({ module: m[1], className: m[2] }));
    expect(listed).toEqual(loadAllowList());
    const rows = [...method(src, "ListPlugins").matchAll(/AddPlugin\("(\w+)", "(\w+)"\)/g)].map(
      (m) => ({ module: m[1], className: m[2] }),
    );
    expect(rows).toEqual(loadAllowList());
  });

  it("FindPlugin checks the read module enum and the allow-list before resolving", () => {
    const body = method(src, "FindPlugin");
    const at = (s: string) => body.indexOf(s);
    expect(at("EMCP_WB_Guard.ModuleTypeForRead(moduleName)")).toBeGreaterThan(0);
    expect(at('"NOT_ALLOWLISTED"')).toBeGreaterThan(at("ModuleTypeForRead"));
    expect(at("pluginClass.ToType()")).toBeGreaterThan(at('"NOT_ALLOWLISTED"'));
    expect(at("wbModule.GetPlugin(pluginType)")).toBeGreaterThan(at("pluginClass.ToType()"));
  });

  it("every engine statement is one the probe pack makes", () => {
    for (const stmt of [
      "if (!pluginType.IsInherited(WorkbenchPlugin))",
      "WBModuleDef wbModule = Workbench.GetModule(moduleType);",
      "WorkbenchPlugin plugin = wbModule.GetPlugin(pluginType);",
      "typename instanceType = plugin.Type();",
      "int count = instanceType.GetVariableCount();",
      "instanceType.GetVariableAttributes(i, attrs);",
      "Attribute attr = Attribute.Cast(attrs.Get(a));",
      "string name = instanceType.GetVariableName(i);",
      "typename varType = instanceType.GetVariableType(i);",
      "if (owner.GetVariableValue(inst, i, vectorValue))",
      "return vectorValue.ToString(false);",
    ]) {
      expect(src, stmt).toContain(stmt);
      expect(probe, stmt).toContain(stmt);
    }
    expect(src).toContain("typename pluginType = pluginClass.ToType();");
    expect(probe).toContain("typename pluginType = className.ToType();");
    expect(src).toContain("resp.instanceClass = plugin.ClassName();");
    expect(probe).toContain('resp.Fact("instanceClass", plugin.ClassName());');
    expect(squash(method(src, "VariableValue"))).toBe(squash(method(probe, "VariableValue")));
    expect(squash(method(guard, "ScrubHome"))).toBe(squash(method(probeUtil, "ScrubHome")));
    expect(method(src, "ScrubHome")).toContain("return EMCP_WB_Guard.ScrubHome(text);");
  });

  it("no method parameter shadows a member of its class", () => {
    const members = new Set([...src.matchAll(/^	(?:ref )?[\w<>]+ (\w+);$/gm)].map((m) => m[1]));
    for (const m of src.matchAll(/^	(?:static |override )?[\w<>]+ \w+\(([^)]*)\)$/gm)) {
      for (const p of m[1].split(",").filter((x) => x.trim())) {
        const name = p.trim().split(/\s+/).pop()!;
        expect(members.has(name), `${m[0].trim()} shadows ${name}`).toBe(false);
      }
    }
  });

  it("getSettings is an error when GetPlugin returns null; ParticleEditor refusal gives the reason", () => {
    expect(squash(method(src, "GetSettings"))).toContain(
      'if (resp.status == "ok") resp.status = "error";',
    );
    expect(method(src, "FindPlugin")).toContain(
      'resp.Refuse("MODULE_NOT_SUPPORTED", "the Particle Editor is never read (its module read crashed the Workbench, DEC-042)"',
    );
  });

  it("request and response RegV keys equal the contract's (packed row keys aside)", () => {
    expect(regVKeys(src, "EMCP_WB_PluginRequest")).toEqual(contract.request);
    // name, type and value are top-level setSettings keys since W6; attribute is a row key only.
    const packed = ["plugins", "settings", "attribute"];
    expect(regVKeys(src, "EMCP_WB_PluginResponse")).toEqual(
      contract.response.filter((k) => !packed.includes(k)),
    );
  });
});
