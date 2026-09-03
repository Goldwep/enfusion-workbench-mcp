import { describe, it, expect } from "vitest";
import {
  cloneArea,
  parseCoords,
  parseLayer,
  serializeLayer,
} from "../clone-area.js";

// Synthetic multi-root .layer fixture: three top-level entities at known
// positions. The parser wrapper in `parseLayer` handles the multi-root case
// transparently.
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

describe("parseLayer + serializeLayer", () => {
  it("round-trips a multi-root layer", () => {
    const root = parseLayer(SAMPLE_LAYER);
    expect(root.children.length).toBe(3);
    expect(root.children[0].type).toBe("GenericEntity");
    expect(root.children[0].inheritance).toBe("{AABB000000000001}Prefabs/Cover/Sandbag.et");

    const reserialized = serializeLayer(root);
    const reparsed = parseLayer(reserialized);
    expect(reparsed.children.length).toBe(3);
    expect(reparsed.children[1].properties.find((p) => p.key === "ID")?.value).toBe(
      "FEDCBA0987654321",
    );
  });
});

describe("cloneArea", () => {
  it("filters by world XZ rectangle", () => {
    const root = parseLayer(SAMPLE_LAYER);
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(result.clonedCount).toBe(2);
  });

  it("excludes entities outside the rectangle", () => {
    const root = parseLayer(SAMPLE_LAYER);
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 110, maxZ: 110 });
    // Entity at (100,200) — Z outside. Entity at (105,205) — Z outside.
    expect(result.clonedCount).toBe(0);
  });

  it("regenerates the ID property GUID on the cloned entity", () => {
    const root = parseLayer(SAMPLE_LAYER);
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(result.clonedCount).toBe(2);
    const newIds = result.clonedEntities.map(
      (e) => e.properties.find((p) => p.key === "ID")?.value,
    );
    expect(newIds[0]).not.toBe("1234567890ABCDEF");
    expect(newIds[1]).not.toBe("FEDCBA0987654321");
    for (const id of newIds) {
      expect(id).toMatch(/^[0-9A-F]{16}$/);
    }
  });

  it("regenerates GUIDs of nested component instances", () => {
    const root = parseLayer(SAMPLE_LAYER);
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    // Second cloned entity holds the EditableEntityComponent with id {CCCC...}.
    const second = result.clonedEntities[1];
    const comps = second.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    const editable = comps!.children[0];
    expect(editable.id).toBeDefined();
    expect(editable.id).not.toBe("{CCCCCCCCCCCCCCCC}");
    expect(editable.id).toMatch(/^\{[0-9A-F]{16}\}$/);
  });

  it("does not mutate the source root", () => {
    const root = parseLayer(SAMPLE_LAYER);
    cloneArea(root, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    // Source IDs unchanged.
    expect(root.children[0].properties.find((p) => p.key === "ID")?.value).toBe(
      "1234567890ABCDEF",
    );
    expect(root.children[1].properties.find((p) => p.key === "ID")?.value).toBe(
      "FEDCBA0987654321",
    );
  });

  it("applies translate to cloned coords", () => {
    const root = parseLayer(SAMPLE_LAYER);
    const result = cloneArea(
      root,
      { minX: 0, minZ: 0, maxX: 500, maxZ: 500 },
      { x: 50, z: -25 },
    );
    expect(result.clonedCount).toBe(2);
    expect(result.clonedEntities[0].properties.find((p) => p.key === "coords")?.value).toBe(
      "150 0 175",
    );
    expect(result.clonedEntities[1].properties.find((p) => p.key === "coords")?.value).toBe(
      "155 0 180",
    );
    expect(result.translate).toEqual({ x: 50, z: -25 });
  });

  it("rejects an inverted area", () => {
    const root = parseLayer(SAMPLE_LAYER);
    expect(() =>
      cloneArea(root, { minX: 100, minZ: 0, maxX: 50, maxZ: 100 }),
    ).toThrow(/Invalid area/);
    expect(() =>
      cloneArea(root, { minX: 0, minZ: 100, maxX: 100, maxZ: 50 }),
    ).toThrow(/Invalid area/);
  });

  it("returns guidSwaps with old → new mapping for cloned IDs", () => {
    const root = parseLayer(SAMPLE_LAYER);
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    expect(result.guidSwaps.length).toBeGreaterThanOrEqual(2);
    const oldGuids = result.guidSwaps.map((s) => s.old);
    expect(oldGuids).toContain("1234567890ABCDEF");
    expect(oldGuids).toContain("FEDCBA0987654321");
    for (const swap of result.guidSwaps) {
      expect(swap.new).toMatch(/^[0-9A-F]{16}$/);
      expect(swap.new).not.toBe(swap.old);
    }
  });

  it("handles the bare-split coords form that scenario_create_conflict emits", () => {
    // scenario_create_conflict writes `coords X Y Z` unquoted. The parser
    // splits that into multiple properties; cloneArea must still treat the
    // entity as having a single Vector3 coord.
    const BARE_LAYER = `GenericEntity : "{AABB000000000099}Prefabs/Bare.et" {
 ID "BARE00000000ABCD"
 coords 250 0 250
}
`;
    const root = parseLayer(BARE_LAYER);
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 }, { x: 10, z: 20 });
    expect(result.clonedCount).toBe(1);
    const coordsProp = result.clonedEntities[0].properties.find((p) => p.key === "coords");
    expect(coordsProp?.value).toBe("260 0 270");
  });

  it("produces a serializable destination layer", () => {
    const root = parseLayer(SAMPLE_LAYER);
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 500, maxZ: 500 });
    const destRoot: typeof root = {
      type: root.type,
      properties: [],
      values: [],
      children: result.clonedEntities,
    };
    const text = serializeLayer(destRoot);
    expect(text).toContain("GenericEntity");
    // Inline numeric vectors now serialize BARE to match real Reforger files
    // and the scenario template (`coords X Y Z`, not `coords "X Y Z"`). The
    // value still round-trips identically through the parser.
    expect(text).toContain("coords 100 0 200");
    // Re-parse the output to confirm it's well-formed.
    const reparsed = parseLayer(text);
    expect(reparsed.children.length).toBe(2);
    expect(reparsed.children[0].properties.find((p) => p.key === "coords")?.value).toBe(
      "100 0 200",
    );
  });
});

// Synthetic single-root .conf fixture: a SCR_MissionHeaderCampaign wrapper
// with header-level properties (m_sName etc.) and two coord-bearing child
// entities. Models the audit fix H-4 regression case — previously the
// sentinel wrap dropped m_sName, m_iPlayerCountMax, etc. when the tool
// rebuilt destRoot.
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

describe("parseLayer single-root mode (audit fix H-4)", () => {
  it("default (multi-root) wraps a typed single-root in the sentinel", () => {
    const root = parseLayer(SAMPLE_SINGLE_ROOT_CONF);
    // Sentinel container with the SCR_MissionHeaderCampaign as its one child.
    expect(root.type).toMatch(/__EMCP_LAYER_ROOT__/);
    expect(root.children.length).toBe(1);
    expect(root.children[0].type).toBe("SCR_MissionHeaderCampaign");
  });

  it("singleRoot:true unwraps the real root and preserves its properties", () => {
    const root = parseLayer(SAMPLE_SINGLE_ROOT_CONF, { singleRoot: true });
    expect(root.type).toBe("SCR_MissionHeaderCampaign");
    const nameProp = root.properties.find((p) => p.key === "m_sName");
    expect(nameProp?.value).toBe("Mission Foo");
    const playerCount = root.properties.find((p) => p.key === "m_iPlayerCountMax");
    expect(playerCount?.value).toBe("32");
    expect(root.children.length).toBe(2);
  });

  it("singleRoot:true with multi-root content falls back to sentinel", () => {
    // SAMPLE_LAYER has 3 top-level entities — singleRoot can't unwrap that
    // cleanly, so the sentinel container is kept and the caller doesn't lose
    // any of the three nodes.
    const root = parseLayer(SAMPLE_LAYER, { singleRoot: true });
    expect(root.type).toMatch(/__EMCP_LAYER_ROOT__/);
    expect(root.children.length).toBe(3);
  });
});

describe("cloneArea + serializeLayer on single-root .conf (audit fix H-4)", () => {
  it("preserves the root header's m_sName when the caller rebuilds destRoot", () => {
    const root = parseLayer(SAMPLE_SINGLE_ROOT_CONF, { singleRoot: true });
    expect(root.type).toBe("SCR_MissionHeaderCampaign");

    // Clone just the entity at (50, 50) — the (999, 999) entity sits outside.
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 100, maxZ: 100 });
    expect(result.clonedCount).toBe(1);

    // Rebuild destRoot the way scenario-clone-area.ts does after the fix:
    // preserve the original root's type/properties/values, replace children
    // with the filtered clones.
    const destRoot: typeof root = {
      type: root.type,
      id: root.id,
      className: root.className,
      inheritance: root.inheritance,
      properties: root.properties.map((p) =>
        typeof p.value === "string"
          ? { key: p.key, value: p.value }
          : { key: p.key, value: JSON.parse(JSON.stringify(p.value)) as typeof p.value },
      ),
      values: [...root.values],
      children: result.clonedEntities,
    };

    const text = serializeLayer(destRoot);
    // The header's properties survived — this is the load-bearing assertion.
    expect(text).toContain('m_sName "Mission Foo"');
    expect(text).toContain("m_iPlayerCountMax 32");
    expect(text).toContain('m_sScenarioName "Foo Scenario"');
    // The cloned entity made it in.
    expect(text).toContain("GenericEntity");
    expect(text).toContain("Prefabs/Cover/Sandbag.et");
    // The out-of-area entity did NOT.
    expect(text).not.toContain("Prefabs/Cover/Barrier.et");
    // Round-trip cleanly.
    const reparsed = parseLayer(text, { singleRoot: true });
    expect(reparsed.type).toBe("SCR_MissionHeaderCampaign");
    expect(reparsed.children.length).toBe(1);
    expect(reparsed.properties.find((p) => p.key === "m_sName")?.value).toBe("Mission Foo");
  });

  it("emits the destination as a single-root file (not a sentinel)", () => {
    const root = parseLayer(SAMPLE_SINGLE_ROOT_CONF, { singleRoot: true });
    const result = cloneArea(root, { minX: 0, minZ: 0, maxX: 100, maxZ: 100 });
    const destRoot: typeof root = {
      type: root.type,
      properties: root.properties.map((p) =>
        typeof p.value === "string"
          ? { key: p.key, value: p.value }
          : { key: p.key, value: JSON.parse(JSON.stringify(p.value)) as typeof p.value },
      ),
      values: [...root.values],
      children: result.clonedEntities,
    };
    const text = serializeLayer(destRoot);
    // Sentinel must not leak into the output.
    expect(text).not.toContain("__EMCP_LAYER_ROOT__");
    expect(text.trimStart().startsWith("SCR_MissionHeaderCampaign")).toBe(true);
  });
});
