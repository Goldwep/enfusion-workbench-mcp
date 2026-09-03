import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  extractMaterialSummary,
  formatMaterialSummary,
} from "../../src/tools/material-inspect.js";

// Synthetic `.emat` body — shape mirrors what BI emits: shader-class root,
// quoted texture slots with `{GUID}path/foo.edds`, and scalar parameters.
const PBR_MATERIAL = `MaterialPBR {
 Texture0 "{AAAA000000000001}Textures/diffuse.edds"
 NormalMap "{AAAA000000000002}Textures/normal.edds"
 Roughness "0.45"
 Metallic "1"
 TintColor "1 0.5 0.2"
}`;

// Material with no textures — pure parameter block, plus inheritance.
const TUNED_MATERIAL = `MaterialEmissive : "{BBBB000000000099}Materials/base.emat" {
 EmissiveScale "2.5"
 EmissiveColor "1 1 1"
}`;

describe("material-inspect: extractMaterialSummary", () => {
  it("splits texture refs from tunable parameters", () => {
    const root = parse(PBR_MATERIAL);
    const s = extractMaterialSummary(root);

    expect(s.shaderClass).toBe("MaterialPBR");
    expect(s.textures).toHaveLength(2);
    expect(s.textures[0]).toEqual({
      key: "Texture0",
      guid: "AAAA000000000001",
      path: "Textures/diffuse.edds",
      resolvedFilePath: null,
    });
    expect(s.textures[1].key).toBe("NormalMap");
    expect(s.parameters.map((p) => p.key)).toEqual(["Roughness", "Metallic", "TintColor"]);
  });

  it("resolves texture GUIDs via the supplied resolver", () => {
    const root = parse(PBR_MATERIAL);
    const resolver = (guid: string): string | null =>
      guid === "AAAA000000000001" ? "Resolved/diffuse.edds" : null;
    const s = extractMaterialSummary(root, resolver);

    expect(s.textures[0].resolvedFilePath).toBe("Resolved/diffuse.edds");
    expect(s.textures[1].resolvedFilePath).toBeNull();
  });

  it("hoists inheritance into a synthetic :inheritance parameter", () => {
    const root = parse(TUNED_MATERIAL);
    const s = extractMaterialSummary(root);

    expect(s.textures).toEqual([]);
    expect(s.parameters[0]).toEqual({
      key: ":inheritance",
      value: "{BBBB000000000099}Materials/base.emat",
    });
    expect(s.parameters.find((p) => p.key === "EmissiveScale")?.value).toBe("2.5");
  });

  it("returns empty arrays for a bare material body", () => {
    const root = parse("MaterialPBR {\n}");
    const s = extractMaterialSummary(root);

    expect(s.shaderClass).toBe("MaterialPBR");
    expect(s.textures).toEqual([]);
    expect(s.parameters).toEqual([]);
  });
});

describe("material-inspect: formatMaterialSummary", () => {
  it("renders shader class, textures, and parameters as scannable markdown", () => {
    const root = parse(PBR_MATERIAL);
    const s = extractMaterialSummary(root, (g) =>
      g === "AAAA000000000001" ? "Resolved/diffuse.edds" : null,
    );
    const out = formatMaterialSummary(s, "Test.emat");

    expect(out).toContain("## Material: Test.emat");
    expect(out).toContain("**Shader class**: MaterialPBR");
    expect(out).toContain("**Texture refs**: 2");
    expect(out).toContain("Texture0: {AAAA000000000001}Textures/diffuse.edds — resolved: Resolved/diffuse.edds");
    expect(out).toContain("NormalMap: {AAAA000000000002}Textures/normal.edds");
    expect(out).toContain("Roughness: \"0.45\"");
  });

  it("uses (none) placeholders when sections are empty", () => {
    const root = parse("MaterialPBR {\n}");
    const out = formatMaterialSummary(extractMaterialSummary(root), "Empty.emat");

    expect(out).toContain("**Texture refs**: 0");
    expect(out).toContain("### Textures\n  (none)");
    expect(out).toContain("### Parameters\n  (none)");
    expect(out).not.toContain("undefined");
  });
});
