import { describe, it, expect } from "vitest";
import { parseAstToStruct, parseAsiToStruct, parseAwToStruct } from "../../src/animation/parser.js";

// Layout taken from vanilla Binoculars_B12.ast / B12_player.asi (corpus sample).
const SAMPLE_AST = `AnimSetTemplateSource {
 Groups {
  AnimSetTemplateSource_AnimationGroup "{54967D07EAF68C5D}" {
   Name "Locomotion"
   Animations {
    "Idle"
    "WalkF"
    "WalkB"
   }
   Columns {
    "Erc"
    "Cro"
   }
  }
  AnimSetTemplateSource_AnimationGroup "{54967D07EAF68C5E}" {
   Name "Actions"
   Animations {
    "Reload"
   }
   Columns {
    "Default"
   }
  }
 }
}`;

const SAMPLE_ASI = `AnimSetInstanceSource "{5D92904FBEB1F100}" {
 Template "{11E615DD64637C57}ws/t.ast"
 Lines {
  AnimSetInstanceSource_Line "Locomotion.Erc.Idle" {
   Resource "{E026D5F801FAF110}Anims/idle_erc.anm"
  }
  AnimSetInstanceSource_Line "Locomotion.Erc.WalkB" {
  }
 }
}`;

const SAMPLE_AW = `AnimSrcWorkspace {
 AnimGraph "{ABC}path/to/graph.agr"
 AnimSetTemplate "{DEF}path/to/template.ast"
 AnimSetInstances {
  "{G1}path/to/instance1.asi"
  "{G2}path/to/instance2.asi"
 }
 AnimSrcWorkspacePreviewModel "{563EF338E13AB791}" {
  Model "{M1}Assets/Characters/main.xob"
 }
 AnimSrcWorkspaceChildPreviewModel weapon {
  Model "{M2}Assets/Weapons/rifle.xob"
  Bone "RightHandProp"
  Enabled 1
 }
 AnimSrcWorkspaceChildPreviewModel mag {
  Model "{M3}Assets/Weapons/mag.xob"
  Bone "magazine"
  Enabled 0
 }
}`;

describe("parseAstToStruct", () => {
  it("parses animation groups with names and columns", () => {
    const result = parseAstToStruct(SAMPLE_AST);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].name).toBe("Locomotion");
    expect(result.groups[0].animationNames).toEqual(["Idle", "WalkF", "WalkB"]);
    expect(result.groups[0].columnNames).toEqual(["Erc", "Cro"]);
    expect(result.groups[1].name).toBe("Actions");
  });

  it("handles empty AST", () => {
    const result = parseAstToStruct("AnimSetTemplate {\n}");
    expect(result.groups).toHaveLength(0);
  });
});

describe("parseAsiToStruct", () => {
  it("parses animation mappings from column instances", () => {
    const result = parseAsiToStruct(SAMPLE_ASI);
    expect(result.mappings.length).toBeGreaterThanOrEqual(2);
    const idleMapping = result.mappings.find(
      (m) => m.group === "Locomotion" && m.column === "Erc" && m.animation === "Idle",
    );
    expect(idleMapping).toBeDefined();
    expect(idleMapping!.anmPath).toBe("Anims/idle_erc.anm");
  });

  it("marks empty slots as unmapped", () => {
    const result = parseAsiToStruct(SAMPLE_ASI);
    const walkB = result.mappings.find(
      (m) => m.group === "Locomotion" && m.column === "Erc" && m.animation === "WalkB",
    );
    expect(walkB).toBeDefined();
    expect(walkB!.anmPath).toBeNull();
  });
});

describe("parseAwToStruct", () => {
  it("parses workspace references", () => {
    const result = parseAwToStruct(SAMPLE_AW);
    expect(result.animGraph).toContain("path/to/graph.agr");
    expect(result.animSetTemplate).toContain("path/to/template.ast");
    expect(result.animSetInstances).toHaveLength(2);
  });

  it("parses preview models", () => {
    const result = parseAwToStruct(SAMPLE_AW);
    expect(result.previewModels).toHaveLength(1);
    expect(result.previewModels[0]).toContain("main.xob");
  });

  it("parses child preview models with bone and enabled state", () => {
    const result = parseAwToStruct(SAMPLE_AW);
    expect(result.childPreviewModels).toHaveLength(2);
    expect(result.childPreviewModels[0].bone).toBe("RightHandProp");
    expect(result.childPreviewModels[0].enabled).toBe(true);
    expect(result.childPreviewModels[1].enabled).toBe(false);
  });

  it("handles empty AW", () => {
    const result = parseAwToStruct("AnimSrcWorkspace {\n}");
    expect(result.animGraph).toBeNull();
    expect(result.previewModels).toHaveLength(0);
  });
});
