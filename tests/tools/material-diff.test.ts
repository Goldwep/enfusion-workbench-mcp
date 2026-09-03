import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  diffMaterials,
  extractMaterialShape,
  formatMaterialDiff,
} from "../../src/tools/material-diff.js";

const MATERIAL_A = `MaterialPBR {
 Texture0 "{AAAA000000000001}Textures/diffuse_v1.edds"
 NormalMap "{AAAA000000000002}Textures/normal.edds"
 Roughness "0.5"
 Metallic "0"
}`;

const MATERIAL_B = `MaterialPBR {
 Texture0 "{AAAA000000000099}Textures/diffuse_v2.edds"
 NormalMap "{AAAA000000000002}Textures/normal.edds"
 EmissiveMap "{AAAA000000000003}Textures/emissive.edds"
 Roughness "0.5"
 Metallic "1"
}`;

describe("material-diff: extractMaterialShape", () => {
  it("buckets texture-slot values away from numeric parameters", () => {
    const shape = extractMaterialShape(parse(MATERIAL_A));
    expect(shape.shaderClass).toBe("MaterialPBR");
    expect(Object.keys(shape.textures).sort()).toEqual(["NormalMap", "Texture0"]);
    expect(Object.keys(shape.parameters).sort()).toEqual(["Metallic", "Roughness"]);
    expect(shape.inheritance).toBeNull();
  });

  it("captures inheritance separately from textures and parameters", () => {
    const shape = extractMaterialShape(
      parse("MaterialPBR : \"{BBBB000000000099}Materials/base.emat\" {\n Metallic \"1\"\n}"),
    );
    expect(shape.inheritance).toBe("{BBBB000000000099}Materials/base.emat");
    expect(shape.textures).toEqual({});
    expect(shape.parameters.Metallic).toBe("1");
  });
});

describe("material-diff: diffMaterials", () => {
  const before = { path: "main/Test.emat", shape: extractMaterialShape(parse(MATERIAL_A)) };
  const after = { path: "beta/Test.emat", shape: extractMaterialShape(parse(MATERIAL_B)) };
  const summary = diffMaterials(before, after);

  it("flags texture additions, removals, and changes by slot name", () => {
    expect(summary.texturesChanged).toEqual([
      {
        key: "Texture0",
        before: "{AAAA000000000001}Textures/diffuse_v1.edds",
        after: "{AAAA000000000099}Textures/diffuse_v2.edds",
      },
    ]);
    expect(summary.texturesAdded).toEqual([
      { key: "EmissiveMap", value: "{AAAA000000000003}Textures/emissive.edds" },
    ]);
    expect(summary.texturesRemoved).toEqual([]);
  });

  it("reports parameter deltas", () => {
    expect(summary.parametersChanged).toEqual([{ key: "Metallic", before: "0", after: "1" }]);
    expect(summary.parametersAdded).toEqual([]);
    expect(summary.parametersRemoved).toEqual([]);
  });

  it("treats inheritance change as a top-level flag, not a parameter diff", () => {
    const a = { path: "a", shape: extractMaterialShape(parse(MATERIAL_A)) };
    const b = {
      path: "b",
      shape: extractMaterialShape(
        parse(
          "MaterialPBR : \"{NEWBASE000000000}Materials/new.emat\" {\n" +
            " Metallic \"0\"\n Roughness \"0.5\"\n" +
            " Texture0 \"{AAAA000000000001}Textures/diffuse_v1.edds\"\n" +
            " NormalMap \"{AAAA000000000002}Textures/normal.edds\"\n}",
        ),
      ),
    };
    const s = diffMaterials(a, b);
    expect(s.inheritanceChanged).toBe(true);
    expect(s.parametersChanged).toEqual([]);
  });

  it("returns zero changes for identical materials", () => {
    const s = diffMaterials(before, before);
    expect(s.shaderClassChanged).toBe(false);
    expect(s.texturesAdded).toEqual([]);
    expect(s.texturesChanged).toEqual([]);
    expect(s.parametersChanged).toEqual([]);
  });
});

describe("material-diff: formatMaterialDiff", () => {
  it("renders all sections when populated", () => {
    const before = { path: "main/Test.emat", shape: extractMaterialShape(parse(MATERIAL_A)) };
    const after = { path: "beta/Test.emat", shape: extractMaterialShape(parse(MATERIAL_B)) };
    const text = formatMaterialDiff(diffMaterials(before, after));

    expect(text).toContain("## Material diff: Test.emat -> Test.emat");
    expect(text).toContain("Shader class: MaterialPBR -> MaterialPBR  [unchanged]");
    expect(text).toContain("### Textures");
    expect(text).toContain("+ EmissiveMap = ");
    expect(text).toContain(
      "~ Texture0: \"{AAAA000000000001}Textures/diffuse_v1.edds\" -> \"{AAAA000000000099}Textures/diffuse_v2.edds\"",
    );
    expect(text).toContain("### Parameters");
    expect(text).toContain("~ Metallic: \"0\" -> \"1\"");
  });

  it("reports a no-diff message for identical materials", () => {
    const s = {
      before: { path: "a", shape: extractMaterialShape(parse(MATERIAL_A)) },
      after: { path: "b", shape: extractMaterialShape(parse(MATERIAL_A)) },
      shaderClassChanged: false,
      classNameChanged: false,
      inheritanceChanged: false,
      texturesAdded: [],
      texturesRemoved: [],
      texturesChanged: [],
      parametersAdded: [],
      parametersRemoved: [],
      parametersChanged: [],
    };
    const text = formatMaterialDiff(s);
    expect(text).toContain("No semantic differences detected.");
  });
});
