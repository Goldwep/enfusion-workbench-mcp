/**
 * The Container handler (EMCP_WB_Container.c) checked over its Enforce text offline: the contract
 * matches the structs, the per-action linter finds nothing, and the read path (Walk's value cell,
 * GetPath's value) answers through ReadValueText, which adds VECTOR2/VECTOR3 and the scalar arrays
 * while the set paths keep ReadAsText unchanged (W11 run 6 follow-up). Nothing here talks to
 * Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { actionFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Container.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Container.json"));

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

const c = code(src);

describe("EMCP_WB_Container structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_ContainerRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ContainerResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("the get and describe value notes name the read path's types", () => {
    const text = readFileSync(join("contracts", "EMCP_WB_Container.json"), "utf-8");
    expect(text).toContain("scalar, VECTOR2/3, scalar array as text");
    expect(text).toContain("row-major cells; vectors, arrays as text");
  });
});

describe("EMCP_WB_Container read path", () => {
  const body = method(src, "ReadValueText");

  it("ReadValueText starts from ReadAsText for the scalar types", () => {
    expect(body.indexOf("if (IsScalar(dataType))")).toBeGreaterThanOrEqual(0);
    expect(body).toContain("return ReadAsText(cont, varName, dataType);");
  });

  it("vectors read into a vector, two or three components", () => {
    expect(body).toContain('typeName == "VECTOR2" || typeName == "VECTOR3"');
    expect(body).toContain("vector vectorValue;");
    expect(body).toContain("cont.Get(varName, vectorValue)");
    expect(body).toContain('if (typeName == "VECTOR3")');
  });

  it("each scalar array reads into its typed array and joins with ','", () => {
    for (const [match, decl] of [
      ["dataType == DataVarType.STRING_ARRAY", "array<string> stringList = {};"],
      ['typeName == "RESOURCE_NAME_ARRAY"', "array<ResourceName> resourceList = {};"],
      ["dataType == DataVarType.INTEGER_ARRAY", "array<int> intList = {};"],
      ['typeName == "SCALAR_ARRAY"', "array<float> floatList = {};"],
      ["dataType == DataVarType.BOOLEAN_ARRAY", "array<bool> boolList = {};"],
    ]) {
      expect(body, match).toContain(match);
      expect(body, decl).toContain(decl);
    }
    expect(body.match(/\+= ",";/g)?.length).toBe(5);
    expect(body.trimEnd().endsWith('return "";\n\t}') || /return "";\s*}\s*$/.test(body)).toBe(true);
  });

  it("names no DataVarType member the mod has not compiled against", () => {
    expect(body).not.toMatch(/DataVarType\.(VECTOR\d|SCALAR_ARRAY|RESOURCE_NAME_ARRAY)/);
  });

  it("no ternary in the helper", () => {
    expect(body).not.toMatch(/\?[^"]*:/);
  });

  it("Walk and GetPath read through ReadValueText; the set paths keep ReadAsText", () => {
    expect(method(src, "Walk")).toContain("string current = ReadValueText(cont, varName, dataType);");
    expect(c).toContain("resp.value = ScrubHome(ReadValueText(holder, leafName, dataType));");
    expect(c.match(/ReadValueText\(/g)?.length).toBe(3);
    expect(c.match(/resp\.before = ScrubHome\(ReadAsText\(/g)?.length).toBe(3);
    expect(c.match(/resp\.after = ScrubHome\(ReadAsText\(/g)?.length).toBe(3);
  });

  it("ReadAsText and IsScalar are unchanged", () => {
    const read = method(src, "ReadAsText");
    expect(read).toContain('return "<" + typename.EnumToString(DataVarType, dataType) + ">";');
    expect(method(src, "IsScalar")).toContain(
      "return dataType == DataVarType.SCALAR || dataType == DataVarType.INTEGER || dataType == DataVarType.BOOLEAN || dataType == DataVarType.STRING || dataType == DataVarType.RESOURCE_NAME;",
    );
  });
});
