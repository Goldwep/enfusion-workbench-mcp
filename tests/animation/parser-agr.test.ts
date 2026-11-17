import { describe, it, expect } from "vitest";
import { parseAgrToStruct } from "../../src/animation/parser.js";
import type { ParsedAgr } from "../../src/animation/types.js";

const SAMPLE_AGR = `AnimSrcGraph {
 AnimSetTemplate "{ABC123}path/to/file.ast"
 ControlTemplate AnimSrcGCT "{DEF456}" {
  Variables {
   AnimSrcGCTVarFloat Speed {
    MinValue 0
    MaxValue 30
    DefaultValue 0
   }
   AnimSrcGCTVarBool IsActive {
   }
   AnimSrcGCTVarInt GearIndex {
    MaxValue 6
   }
  }
  Commands {
   AnimSrcGCTCmd CMD_GetIn {
   }
   AnimSrcGCTCmd CMD_GetOut {
   }
  }
  IkChains {
   AnimSrcGCTIkChain LeftLeg {
    Joints {
     "thigh_l"
     "calf_l"
     "foot_l"
    }
    MiddleJoint "calf_l"
    ChainAxis "+y"
   }
  }
  BoneMasks {
   AnimSrcGCTBoneMask UpperBody {
    BoneNames {
     "spine_01"
     "spine_02"
    }
   }
  }
 }
 GlobalTags {
  "Vehicle"
  "Wheeled"
 }
 GraphFilesResourceNames {
  "{GHI789}path/to/file.agf"
 }
 DefaultRunNode "MasterQueue"
}`;

describe("parseAgrToStruct", () => {
  it("parses variables by type", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    expect(result.variables).toHaveLength(3);
    const speed = result.variables.find((v) => v.name === "Speed");
    expect(speed).toBeDefined();
    expect(speed!.type).toBe("Float");
    expect(speed!.min).toBe("0");
    expect(speed!.max).toBe("30");
    expect(speed!.defaultValue).toBe("0");
  });

  it("parses bool and int variables", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    const isActive = result.variables.find((v) => v.name === "IsActive");
    expect(isActive!.type).toBe("Bool");
    const gear = result.variables.find((v) => v.name === "GearIndex");
    expect(gear!.type).toBe("Int");
    expect(gear!.max).toBe("6");
  });

  it("parses commands", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    expect(result.commands).toHaveLength(2);
    expect(result.commands.map((c) => c.name)).toContain("CMD_GetIn");
  });

  it("parses IK chains with joints", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    expect(result.ikChains).toHaveLength(1);
    expect(result.ikChains[0].name).toBe("LeftLeg");
    expect(result.ikChains[0].joints).toEqual(["thigh_l", "calf_l", "foot_l"]);
    expect(result.ikChains[0].middleJoint).toBe("calf_l");
    expect(result.ikChains[0].chainAxis).toBe("+y");
  });

  it("parses bone masks", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    expect(result.boneMasks).toHaveLength(1);
    expect(result.boneMasks[0].name).toBe("UpperBody");
    expect(result.boneMasks[0].bones).toEqual(["spine_01", "spine_02"]);
  });

  it("parses global tags", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    expect(result.globalTags).toEqual(["Vehicle", "Wheeled"]);
  });

  it("parses DefaultRunNode and AGF references", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    expect(result.defaultRunNode).toBe("MasterQueue");
    expect(result.agfReferences).toHaveLength(1);
    expect(result.agfReferences[0]).toContain("path/to/file.agf");
  });

  it("parses AST reference", () => {
    const result = parseAgrToStruct(SAMPLE_AGR);
    expect(result.astReference).toContain("path/to/file.ast");
  });

  it("handles empty AGR gracefully", () => {
    const result = parseAgrToStruct("AnimSrcGraph {\n}");
    expect(result.variables).toHaveLength(0);
    expect(result.commands).toHaveLength(0);
    expect(result.defaultRunNode).toBeNull();
  });
});

describe("parseAgrToStruct on the 1.9 layout (CST reader)", () => {
  const AGR = `AnimSrcGraph {
 ControlTemplate AnimSrcGCT "{667283173DEFA51C}" {
  Variables {
   AnimSrcGCTVarString Label {
   }
  }
  BoneMasks {
   AnimSrcGCTBoneMask Upper {
    Bones {
     "spine1"
     "spine2"
    }
   }
  }
 }
 DefaultRunNode "MasterControl"
}`;

  it("reads String variables, Bones masks and the absence of GlobalTags", () => {
    const r = parseAgrToStruct(AGR);
    expect(r.variables).toEqual([
      { name: "Label", type: "String", min: null, max: null, defaultValue: null },
    ]);
    expect(r.boneMasks).toEqual([{ name: "Upper", bones: ["spine1", "spine2"] }]);
    expect(r.hasGlobalTags).toBe(false);
    expect(r.globalTags).toEqual([]);
    expect(r.defaultRunNode).toBe("MasterControl");
  });
});
