import { describe, it, expect } from "vitest";
import { cloneArea, parseCoords, type GuidSwap } from "../clone-area.js";
import { parseCst, type CstObject } from "../../formats/enfusion-cst.js";

// Synthetic multi-root .layer fixture: three top-level entities at known
// positions.
const SAMPLE_LAYER = `GenericEntity : "{AABB000000000001}Prefabs/Cover/Sandbag.et" {
 ID "1234567890ABCDEF"
 coords 100 0 200
}
GenericEntity : "{AABB000000000002}Prefabs/Cover/Barrier.et" {
 ID "FEDCBA0987654321"
 coords 105 0 205
 components {
  EditableEntityComponent "{CCCCCCCCCCCCCCCC}" {
  }
 }
}
GenericEntity : "{AABB000000000001}Prefabs/Cover/Sandbag.et" {
 ID "AAAAAAAA11111111"
 coords 1000 0 1000
}
`;

const ALL = { minX: -1e9, minZ: -1e9, maxX: 1e9, maxZ: 1e9 };

/** Puts the old GUIDs back, so the rest of the text can be compared byte for byte. */
function unswap(text: string, swaps: GuidSwap[]): string {
  let out = text;
  for (const s of swaps) out = out.split(s.new).join(s.old);
  return out;
}

function entities(text: string): CstObject[] {
  const doc = parseCst(text);
  expect(doc.diagnostics).toEqual([]);
  return doc.root.children.filter((c): c is CstObject => c.kind === "object");
}

describe("parseCoords", () => {
  it("parses a valid coords triple", () => {
    expect(parseCoords("100 0 200")).toEqual([100, 0, 200]);
  });

  it("handles negative and decimal values", () => {
    expect(parseCoords("-15.5 0 200.25")).toEqual([-15.5, 0, 200.25]);
  });

  it("returns null for malformed input", () => {
    expect(parseCoords("not a coord")).toBeNull();
    expect(parseCoords("1 2")).toBeNull();
  });
});

describe("cloneArea", () => {
  it("filters by world XZ rectangle", () => {
    const result = cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(result.clonedCount).toBe(2);
    expect(entities(result.text).length).toBe(2);
    expect(result.text).not.toContain("coords 1000 0 1000");
  });

  it("excludes entities outside the rectangle", () => {
    const result = cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 0, maxX: 110, maxZ: 110 });
    // Entity at (100,200) — Z outside. Entity at (105,205) — Z outside.
    expect(result.clonedCount).toBe(0);
  });

  it("keeps every byte of the kept entities except the GUIDs it regenerates", () => {
    const result = cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    const kept = SAMPLE_LAYER.slice(0, SAMPLE_LAYER.indexOf('GenericEntity : "{AABB000000000001}', 10));
    expect(unswap(result.text, result.guidSwaps)).toBe(kept);
  });

  it("gives the source back byte for byte (GUIDs aside) when every entity is inside", () => {
    const result = cloneArea(SAMPLE_LAYER, ALL);
    expect(result.clonedCount).toBe(3);
    expect(unswap(result.text, result.guidSwaps)).toBe(SAMPLE_LAYER);
  });

  it("regenerates the ID property GUID on the cloned entity, keeping it quoted", () => {
    const result = cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(result.text).not.toContain("1234567890ABCDEF");
    expect(result.text).not.toContain("FEDCBA0987654321");
    const ids = [...result.text.matchAll(/ ID "([0-9A-F]{16})"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
  });

  it("regenerates GUIDs of nested component instances, keeping the braces", () => {
    const result = cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(result.text).not.toContain("{CCCCCCCCCCCCCCCC}");
    expect(result.text).toMatch(/EditableEntityComponent "\{[0-9A-F]{16}\}" \{/);
  });

  it("never touches a base reference after the colon", () => {
    const result = cloneArea(SAMPLE_LAYER, ALL);
    expect(result.text).toContain('"{AABB000000000001}Prefabs/Cover/Sandbag.et"');
    expect(result.text).toContain('"{AABB000000000002}Prefabs/Cover/Barrier.et"');
  });

  it("keeps an entity's class and instance name", () => {
    const named = 'GenericEntity Lamp_1 : "{AAAAAAAAAAAAAAAA}Prefabs/Props/Lamp.et" {\n ID "1234567890ABCDEF"\n coords 100 0 100\n}\n';
    const result = cloneArea(named, ALL);
    expect(unswap(result.text, result.guidSwaps)).toBe(named);
    expect(result.text.startsWith("GenericEntity Lamp_1 : ")).toBe(true);
  });

  it("does not change the source text", () => {
    const src = SAMPLE_LAYER.slice();
    cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(SAMPLE_LAYER).toBe(src);
  });

  it("applies translate to cloned coords, in the bare form the source wrote", () => {
    const result = cloneArea(
      SAMPLE_LAYER,
      { minX: 0, minZ: 0, maxX: 500, maxZ: 500 },
      { x: 50, z: -25 },
    );
    expect(result.clonedCount).toBe(2);
    expect(result.text).toContain("\n coords 150 0 175\n");
    expect(result.text).toContain("\n coords 155 0 180\n");
    expect(result.translate).toEqual({ x: 50, z: -25 });
  });

  it("translates the quoted form in place and keeps Y as written", () => {
    const quoted = 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords "1.5 0.250 2"\n}\n';
    const result = cloneArea(quoted, ALL, { x: 1, z: 0 });
    expect(result.text).toBe('GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords "2.5 0.250 2"\n}\n');
  });

  it("leaves coords bytes alone without a translate", () => {
    const odd = 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 100.000 0 100.500\n}\n';
    expect(cloneArea(odd, ALL).text).toBe(odd);
  });

  it("rejects an inverted area", () => {
    expect(() => cloneArea(SAMPLE_LAYER, { minX: 100, minZ: 0, maxX: 50, maxZ: 100 })).toThrow(
      /Invalid area/,
    );
    expect(() => cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 100, maxX: 100, maxZ: 50 })).toThrow(
      /Invalid area/,
    );
  });

  it("returns guidSwaps with old → new mapping for cloned IDs", () => {
    const result = cloneArea(SAMPLE_LAYER, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(result.guidSwaps.length).toBe(3); // two IDs + one component instance
    const oldGuids = result.guidSwaps.map((s) => s.old);
    expect(oldGuids).toContain("1234567890ABCDEF");
    expect(oldGuids).toContain("FEDCBA0987654321");
    expect(oldGuids).toContain("CCCCCCCCCCCCCCCC");
    for (const swap of result.guidSwaps) {
      expect(swap.new).toMatch(/^[0-9A-F]{16}$/);
      expect(swap.new).not.toBe(swap.old);
    }
  });

  it("handles the bare coords form that scenario_create_conflict emits", () => {
    const BARE_LAYER = `GenericEntity : "{AABB000000000099}Prefabs/Bare.et" {
 ID "BARE00000000ABCD"
 coords 250 0 250
}
`;
    const result = cloneArea(BARE_LAYER, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 }, { x: 10, z: 20 });
    expect(result.clonedCount).toBe(1);
    expect(result.text).toContain("\n coords 260 0 270\n");
  });

  it("keeps CRLF line ends and tab indents", () => {
    const crlf =
      'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\r\n\tID "1234567890ABCDEF"\r\n\tcoords 1 0 1\r\n}\r\n' +
      'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\r\n\tcoords 900 0 900\r\n}\r\n';
    const result = cloneArea(crlf, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 });
    expect(unswap(result.text, result.guidSwaps)).toBe(crlf.slice(0, crlf.indexOf("}\r\n") + 3));
  });

  it("removes a last entity written without a final line end cleanly", () => {
    const noEol =
      'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 1 0 1\n}\n' +
      'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 900 0 900\n}';
    const result = cloneArea(noEol, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 });
    expect(result.text).toBe('GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 1 0 1\n}');
  });

  it("merges the cuts when several trailing entities without a final line end go", () => {
    const noEol =
      'A : "{AAAAAAAAAAAAAAAA}x.et" {\n coords 1 0 1\n}\n' +
      'B : "{AAAAAAAAAAAAAAAA}x.et" {\n coords 900 0 900\n}\n' +
      'C : "{AAAAAAAAAAAAAAAA}x.et" {\n coords 901 0 901\n}';
    const result = cloneArea(noEol, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 });
    expect(result.text).toBe('A : "{AAAAAAAAAAAAAAAA}x.et" {\n coords 1 0 1\n}');
  });

  it("keeps a single-entity .layer's entity (the root is the block, not the entity)", () => {
    const one = 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n components {\n }\n coords 1 0 1\n}';
    const result = cloneArea(one, ALL);
    expect(result.clonedCount).toBe(1);
    expect(result.text).toBe(one);
  });

  it("refuses a source the CST cannot parse cleanly", () => {
    expect(() => cloneArea('GenericEntity {\n coords 1 0 1\n', ALL)).toThrow(/does not parse cleanly/);
  });
});

// Synthetic single-root .conf fixture: a SCR_MissionHeaderCampaign wrapper
// with header-level properties (m_sName etc.) and two coord-bearing child
// entities. Models the audit fix H-4 regression case.
const SAMPLE_SINGLE_ROOT_CONF = `SCR_MissionHeaderCampaign {
 m_sName "Mission Foo"
 m_iPlayerCountMax 32
 m_sScenarioName "Foo Scenario"
 GenericEntity : "{AABB000000000010}Prefabs/Cover/Sandbag.et" {
  ID "1010101010101010"
  coords 50 0 50
 }
 GenericEntity : "{AABB000000000011}Prefabs/Cover/Barrier.et" {
  ID "1111111111111111"
  coords 999 0 999
 }
}
`;

describe("cloneArea on a single-root .conf (audit fix H-4)", () => {
  it("keeps the root header's properties as written and drops the out-of-area entity", () => {
    const result = cloneArea(
      SAMPLE_SINGLE_ROOT_CONF,
      { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
      undefined,
      { singleRoot: true },
    );
    expect(result.clonedCount).toBe(1);
    const expected = SAMPLE_SINGLE_ROOT_CONF.replace(
      / GenericEntity : "\{AABB000000000011\}[\s\S]*?\n }\n/,
      "",
    );
    expect(unswap(result.text, result.guidSwaps)).toBe(expected);
    expect(result.text).toContain('m_sName "Mission Foo"');
    expect(result.text).toContain("m_iPlayerCountMax 32");
    expect(result.text).not.toContain("Prefabs/Cover/Barrier.et");
    expect(result.text.startsWith("SCR_MissionHeaderCampaign {")).toBe(true);
  });

  it("without singleRoot treats the header as one entity without coords", () => {
    const result = cloneArea(SAMPLE_SINGLE_ROOT_CONF, ALL);
    expect(result.clonedCount).toBe(0);
  });
});
